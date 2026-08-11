"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { DatabaseSync } = require("node:sqlite");

const CONFIG = require("../config");
const {
  applyPreventureResearchAuthorityMigration,
  openDatabase,
  verifyDatabase,
} = require("../db");
const { sha256 } = require("./commercial-test-contract");
const { decryptFile } = require("./backup");
const {
  HISTORICAL_PREVENTURE_APPROVAL_DECISIONS,
  HISTORICAL_PREVENTURE_APPROVAL_PRIOR_PENDING_KEYS,
  HISTORICAL_PREVENTURE_APPROVAL_RECEIPT_KEYS,
  HISTORICAL_PREVENTURE_SCHEMA27_SOURCE,
} = require("./preventure-research-historical-approval-manifest");

const RECOVERY_MANIFEST_SCHEMA = "pantheon.schema27-offline-recovery-candidate.v1";
const TEST_RECOVERY_MANIFEST_SCHEMA =
  "pantheon.schema27-offline-recovery-candidate.test-only.v1";
const MIGRATION_27_NAME = "pre-venture-research-authority-ledger";
const SPECIAL_PREVENTURE_TRIGGER =
  "trg_commercial_test_lifecycle_preventure_approval_insert";
const SPECIAL_PREVENTURE_INDEX = "idx_task_attempts_one_running_per_task";
const FINAL_NAMESPACE_TABLES = Object.freeze([
  "preventure_research_authorities",
  "preventure_research_approval_decisions",
  "preventure_research_lifecycle_events",
  "preventure_research_assignments",
  "preventure_research_cost_events",
  "preventure_research_terminal_recoveries",
  "preventure_research_provider_billing_observations",
  "preventure_research_terminal_stops",
  "preventure_research_assignment_skips",
  "preventure_research_source_snapshots",
  "preventure_research_evidence_records",
  "preventure_research_decisions",
]);
const FINAL_NAMESPACE_TABLE_SET = new Set(FINAL_NAMESPACE_TABLES);
const TEST_ONLY_SOURCE_CONTRACT_TOKEN = Object.freeze(Object.create(null));

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function sha256Text(value) {
  return crypto.createHash("sha256").update(String(value), "utf8").digest("hex");
}

function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  const fd = fs.openSync(filePath, "r");
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    let bytesRead;
    do {
      bytesRead = fs.readSync(fd, buffer, 0, buffer.length, null);
      if (bytesRead) hash.update(buffer.subarray(0, bytesRead));
    } while (bytesRead);
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest("hex");
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map(
      (key) => `${JSON.stringify(key)}:${stableJson(value[key])}`,
    ).join(",")}}`;
  }
  return JSON.stringify(value);
}

function normalizedPath(value) {
  const resolved = path.resolve(String(value || ""));
  let canonical = resolved;
  try {
    canonical = fs.realpathSync.native(resolved);
  } catch {
    const parent = path.dirname(resolved);
    if (fs.existsSync(parent)) {
      canonical = path.join(fs.realpathSync.native(parent), path.basename(resolved));
    }
  }
  return process.platform === "win32" ? canonical.toLowerCase() : canonical;
}

function samePath(left, right) {
  return normalizedPath(left) === normalizedPath(right);
}

function activeDatabaseIdentities() {
  const dbPath = path.resolve(CONFIG.dbPath);
  return [dbPath, `${dbPath}-wal`, `${dbPath}-shm`];
}

function immutableSqliteUri(filePath) {
  const url = pathToFileURL(path.resolve(filePath));
  url.searchParams.set("mode", "ro");
  url.searchParams.set("immutable", "1");
  return url.href;
}

function assertNotActiveDatabase(candidate, label) {
  if (activeDatabaseIdentities().some((activePath) => samePath(candidate, activePath))) {
    throw new Error(
      `${label} cannot be Pantheon's configured active database or one of its SQLite sidecars.`,
    );
  }
}

function assertNotHardLinkToActiveDatabase(candidate, label) {
  const activePath = path.resolve(CONFIG.dbPath);
  if (!fs.existsSync(activePath) || !fs.existsSync(candidate)) return;
  const activeStats = fs.statSync(activePath);
  const candidateStats = fs.statSync(candidate);
  if (
    activeStats.dev === candidateStats.dev
    && activeStats.ino !== 0
    && activeStats.ino === candidateStats.ino
  ) {
    throw new Error(`${label} cannot be a hard link to Pantheon's active database.`);
  }
}

function assertRegularStandaloneSource(sourcePath) {
  assertNotActiveDatabase(sourcePath, "Recovery source");
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`Recovery source does not exist: ${sourcePath}`);
  }
  const stats = fs.lstatSync(sourcePath);
  if (!stats.isFile() || stats.isSymbolicLink()) {
    throw new Error("Recovery source must be one regular, non-symbolic-link SQLite file.");
  }
  for (const suffix of ["-wal", "-shm"]) {
    if (fs.existsSync(`${sourcePath}${suffix}`)) {
      throw new Error(
        `Recovery source has a SQLite ${suffix.slice(1).toUpperCase()} sidecar; `
        + "create a new consistent standalone snapshot before recovery.",
      );
    }
  }
  assertNotHardLinkToActiveDatabase(sourcePath, "Recovery source");
}

function assertNewOutputPath(outputPath, label) {
  assertNotActiveDatabase(outputPath, label);
  if (fs.existsSync(outputPath)) throw new Error(`${label} already exists: ${outputPath}`);
  for (const suffix of ["-wal", "-shm"]) {
    if (fs.existsSync(`${outputPath}${suffix}`)) {
      throw new Error(`${label} has a pre-existing SQLite sidecar: ${outputPath}${suffix}`);
    }
  }
  const parent = path.dirname(outputPath);
  if (!fs.existsSync(parent) || !fs.statSync(parent).isDirectory()) {
    throw new Error(`${label} parent directory does not exist: ${parent}`);
  }
}

function assertRegularEncryptedBackup(backupPath) {
  assertNotActiveDatabase(backupPath, "Encrypted recovery-source backup");
  if (!fs.existsSync(backupPath)) {
    throw new Error(`Encrypted recovery-source backup does not exist: ${backupPath}`);
  }
  const stats = fs.lstatSync(backupPath);
  if (!stats.isFile() || stats.isSymbolicLink()) {
    throw new Error("Encrypted recovery-source backup must be one regular, non-symbolic-link file.");
  }
  assertNotHardLinkToActiveDatabase(backupPath, "Encrypted recovery-source backup");
}

// Keep this byte-for-byte aligned with db.js schema normalization. Quoted
// literals remain exact while insignificant unquoted whitespace and case do
// not create false schema drift.
function normalizeSchemaSql(value) {
  const input = String(value || "").trim().replace(/;\s*$/, "");
  let output = "";
  let outside = "";
  let quote = null;
  const flushOutside = () => {
    output += outside
      .replace(/\bIF\s+NOT\s+EXISTS\b/gi, "")
      .replace(/\s+/g, " ")
      .toLowerCase();
    outside = "";
  };
  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (quote !== null) {
      output += character;
      const closing = quote === "[" ? "]" : quote;
      if (character === closing) {
        if (quote !== "[" && input[index + 1] === closing) {
          output += input[index + 1];
          index += 1;
        } else {
          quote = null;
        }
      }
      continue;
    }
    if (["'", '"', "`", "["].includes(character)) {
      flushOutside();
      quote = character;
      output += character;
    } else {
      outside += character;
    }
  }
  flushOutside();
  return output.trim();
}

function schemaRows(db) {
  return db.prepare(
    `SELECT type, name, tbl_name, sql
     FROM sqlite_master
     WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'
     ORDER BY type, name`,
  ).all();
}

function schemaFingerprints(db) {
  const rows = schemaRows(db);
  const normalized = rows.map((row) => ({
    type: row.type,
    name: row.name,
    tbl_name: row.tbl_name,
    sql: normalizeSchemaSql(row.sql),
  }));
  return {
    rawSchemaSha256: sha256Text(JSON.stringify(rows)),
    normalizedSchemaSha256: sha256Text(JSON.stringify(normalized)),
    objectCount: rows.length,
  };
}

function canonicalSimple(value) {
  if (Array.isArray(value)) return value.map(canonicalSimple);
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
    return { blobBase64: Buffer.from(value).toString("base64") };
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, canonicalSimple(value[key])]),
    );
  }
  if (typeof value === "bigint") return { sqliteInteger: value.toString() };
  return value;
}

function tableColumns(db, tableName) {
  return db.prepare(`PRAGMA table_info(${quoteIdentifier(tableName)})`).all()
    .map((column) => ({
      name: String(column.name),
      primaryKeyOrder: Number(column.pk || 0),
    }));
}

function primaryKeyOrder(columns) {
  return columns
    .filter((column) => column.primaryKeyOrder > 0)
    .sort((left, right) => left.primaryKeyOrder - right.primaryKeyOrder)
    .map((column) => quoteIdentifier(column.name));
}

function namespaceLogicalRows(db, tableName) {
  const columns = tableColumns(db, tableName);
  const order = primaryKeyOrder(columns);
  return db.prepare(
    `SELECT * FROM ${quoteIdentifier(tableName)}`
    + (order.length ? ` ORDER BY ${order.join(", ")}` : ""),
  ).all();
}

function namespaceLogicalRowProof(db, tableName) {
  const rows = namespaceLogicalRows(db, tableName);
  return {
    count: rows.length,
    sha256: sha256Text(JSON.stringify(rows.map(canonicalSimple))),
  };
}

function encodeSqliteValue(value) {
  if (value === null) return ["null"];
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
    return ["blob", Buffer.from(value).toString("base64")];
  }
  if (typeof value === "bigint") return ["integer", value.toString()];
  if (typeof value === "number") {
    return [Number.isInteger(value) ? "integer" : "real", String(value)];
  }
  return ["text", String(value)];
}

function tableLogicalProof(db, tableName) {
  const columns = tableColumns(db, tableName);
  const columnNames = columns.map((column) => column.name);
  let rows;
  let rowidPreserved = true;
  try {
    rows = db.prepare(
      `SELECT rowid AS ${quoteIdentifier("__pantheon_recovery_rowid__")}, *
       FROM ${quoteIdentifier(tableName)} ORDER BY rowid`,
    ).all();
  } catch {
    rowidPreserved = false;
    const order = primaryKeyOrder(columns);
    rows = db.prepare(
      `SELECT * FROM ${quoteIdentifier(tableName)}`
      + (order.length ? ` ORDER BY ${order.join(", ")}` : ""),
    ).all();
  }
  const encodedRows = rows.map((row) => ({
    ...(rowidPreserved
      ? { rowid: encodeSqliteValue(row.__pantheon_recovery_rowid__) }
      : {}),
    values: columnNames.map((column) => encodeSqliteValue(row[column])),
  }));
  return {
    columns: columnNames,
    count: rows.length,
    rowidPreserved,
    sha256: sha256Text(stableJson({ columns: columnNames, rows: encodedRows })),
  };
}

function userTableNames(db) {
  return db.prepare(
    `SELECT name FROM sqlite_master
     WHERE type = 'table' AND sql IS NOT NULL AND name NOT LIKE 'sqlite_%'
     ORDER BY name`,
  ).all().map((row) => String(row.name));
}

function tableLogicalManifest(db) {
  return Object.fromEntries(
    userTableNames(db).map((tableName) => [tableName, tableLogicalProof(db, tableName)]),
  );
}

function namespaceTableNames(db) {
  return userTableNames(db).filter((tableName) => tableName.startsWith("preventure_research_"));
}

function migrationHistory(db) {
  return db.prepare(
    "SELECT version, name, applied_at FROM schema_migrations ORDER BY version",
  ).all().map((row) => ({
    version: Number(row.version),
    name: String(row.name),
    appliedAt: String(row.applied_at),
  }));
}

function migrationHistorySha256(history) {
  return sha256Text(JSON.stringify(history.map((row) => ({
    version: row.version,
    name: row.name,
  }))));
}

function sqliteIntegrityProof(db) {
  const quick = db.prepare("PRAGMA quick_check").all();
  const integrity = db.prepare("PRAGMA integrity_check").all();
  const foreignKeys = db.prepare("PRAGMA foreign_key_check").all();
  const quickOk = quick.length === 1 && Object.values(quick[0])[0] === "ok";
  const integrityOk = integrity.length === 1 && Object.values(integrity[0])[0] === "ok";
  if (!quickOk || !integrityOk || foreignKeys.length > 0) {
    throw new Error(
      `Recovery source SQLite validation failed `
      + `(quick=${quickOk}, integrity=${integrityOk}, foreignKeys=${foreignKeys.length}).`,
    );
  }
  const journal = db.prepare("PRAGMA journal_mode").get();
  const journalMode = String(Object.values(journal || {})[0] || "").toLowerCase();
  if (journalMode !== "delete") {
    throw new Error(
      `Recovery source must use standalone DELETE journaling; found ${journalMode || "unknown"}.`,
    );
  }
  return {
    quickCheck: "ok",
    integrityCheck: "ok",
    foreignKeyViolations: 0,
    journalMode,
  };
}

function receiptProjection(row) {
  let receipt;
  try {
    receipt = JSON.parse(String(row.receipt_json));
  } catch (error) {
    throw new Error(`Historical approval ${row.approval_id} is not valid JSON: ${error.message}`);
  }
  return { row, receipt };
}

function sortedKeys(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? Object.keys(value).sort()
    : [];
}

function assertExactHistoricalReceipts(db, expectedEntries) {
  const rows = db.prepare(
    `SELECT * FROM preventure_research_approval_decisions
     ORDER BY approval_id`,
  ).all();
  if (rows.length !== expectedEntries.length) {
    throw new Error(
      `Historical approval receipt count changed (${rows.length}; expected ${expectedEntries.length}).`,
    );
  }
  const expectedByHash = new Map(expectedEntries.map((entry) => [entry.receiptHash, entry]));
  for (const { row, receipt } of rows.map(receiptProjection)) {
    const expected = expectedByHash.get(row.decision_receipt_hash);
    if (!expected) throw new Error(`Historical approval receipt ${row.decision_receipt_hash} is not pinned.`);
    const priorPending = receipt.priorPending;
    const exact = (
      JSON.stringify(sortedKeys(receipt))
        === JSON.stringify([...HISTORICAL_PREVENTURE_APPROVAL_RECEIPT_KEYS].sort())
      && JSON.stringify(sortedKeys(priorPending))
        === JSON.stringify([...HISTORICAL_PREVENTURE_APPROVAL_PRIOR_PENDING_KEYS].sort())
      && receipt.receiptHash === sha256((({ receiptHash: _ignored, ...body }) => body)(receipt))
      && receipt.receiptHash === expected.receiptHash
      && receipt.approvalId === expected.approvalId
      && receipt.authorityHash === expected.authorityHash
      && receipt.eventType === expected.eventType
      && receipt.scopeHash === expected.scopeHash
      && receipt.schema === expected.receiptSchema
      && receipt.decisionStatus === expected.decisionStatus
      && receipt.decidedBy === expected.decidedBy
      && receipt.decisionSource === expected.decisionSource
      && receipt.decidedAt === expected.decidedAt
      && priorPending?.status === "pending"
      && priorPending.requestedBy === expected.requestedBy
      && priorPending.requestedAt === expected.requestedAt
      && priorPending.decidedAt === null
      && priorPending.decidedBy === null
      && priorPending.consumedAt === null
      && row.approval_id === expected.approvalId
      && row.authority_hash === expected.authorityHash
      && row.event_type === expected.eventType
      && row.scope_hash === expected.scopeHash
      && row.requested_by === expected.requestedBy
      && row.requested_at === expected.requestedAt
      && row.decided_by === expected.decidedBy
      && row.decision_source === expected.decisionSource
      && row.decision_status === expected.decisionStatus
      && row.decided_at === expected.decidedAt
      && row.created_at === expected.createdAt
    );
    if (!exact) {
      throw new Error(`Historical approval receipt ${expected.receiptHash} changed from its exact pin.`);
    }
    const approval = db.prepare(
      `SELECT status, requested_by, requested_at, decided_by, decided_at,
              consumed_at, scope_hash
       FROM approvals WHERE id = ?`,
    ).get(expected.approvalId);
    if (
      !approval
      || approval.status !== "approved"
      || approval.requested_by !== expected.requestedBy
      || approval.requested_at !== expected.requestedAt
      || approval.decided_by !== expected.decidedBy
      || approval.decided_at !== expected.decidedAt
      || approval.consumed_at !== expected.decidedAt
      || approval.scope_hash !== expected.scopeHash
    ) {
      throw new Error(
        `Historical approval ${expected.approvalId} changed from its exact owner-decision custody.`,
      );
    }
  }
  return rows.map((row) => ({
    approvalId: row.approval_id,
    receiptHash: row.decision_receipt_hash,
  }));
}

function sourceContractFromReport(report) {
  return Object.freeze({
    snapshotSha256: report.snapshotSha256,
    normalizedSchemaSha256: report.schema.normalizedSchemaSha256,
    rawSchemaSha256: report.schema.rawSchemaSha256,
    migrationHistorySha256: report.migrationHistorySha256,
    namespaceRowCounts: Object.freeze(Object.fromEntries(
      Object.entries(report.namespaceRows).map(([name, proof]) => [name, proof.count]),
    )),
    namespaceLogicalRowSha256: Object.freeze(Object.fromEntries(
      Object.entries(report.namespaceRows).map(([name, proof]) => [name, proof.sha256]),
    )),
  });
}

function assertExactMap(actual, expected, label) {
  if (stableJson(actual) !== stableJson(expected)) {
    throw new Error(`${label} does not match the frozen recovery contract.`);
  }
}

function assertExpectedSource(report, expectedSource) {
  for (const [label, actual, expected] of [
    ["snapshot SHA-256", report.snapshotSha256, expectedSource.snapshotSha256],
    ["normalized schema SHA-256", report.schema.normalizedSchemaSha256,
      expectedSource.normalizedSchemaSha256],
    ["raw schema SHA-256", report.schema.rawSchemaSha256, expectedSource.rawSchemaSha256],
    ["migration-history SHA-256", report.migrationHistorySha256,
      expectedSource.migrationHistorySha256],
  ]) {
    if (!expected || actual !== expected) {
      throw new Error(`Recovery source ${label} is ${actual}; expected ${expected || "a frozen pin"}.`);
    }
  }
  assertExactMap(
    Object.fromEntries(Object.entries(report.namespaceRows).map(([name, proof]) => [name, proof.count])),
    expectedSource.namespaceRowCounts,
    "Recovery source namespace row counts",
  );
  assertExactMap(
    Object.fromEntries(Object.entries(report.namespaceRows).map(([name, proof]) => [name, proof.sha256])),
    expectedSource.namespaceLogicalRowSha256,
    "Recovery source namespace logical row hashes",
  );
}

function inspectSchema27RecoverySource(sourcePath, options = {}) {
  const source = path.resolve(sourcePath);
  assertRegularStandaloneSource(source);
  const expectedApprovalDecisions = options.expectedApprovalDecisions === undefined
    ? HISTORICAL_PREVENTURE_APPROVAL_DECISIONS
    : options.expectedApprovalDecisions;
  const snapshotSha256 = sha256File(source);
  const db = new DatabaseSync(immutableSqliteUri(source), { readOnly: true });
  try {
    const integrity = sqliteIntegrityProof(db);
    const history = migrationHistory(db);
    if (
      history.length !== 27
      || history.at(-1)?.version !== 27
      || history.at(-1)?.name !== MIGRATION_27_NAME
    ) {
      throw new Error("Recovery source is not the exact recorded schema-27 candidate.");
    }
    const namespaces = namespaceTableNames(db);
    const unsupported = namespaces.filter((tableName) => !FINAL_NAMESPACE_TABLE_SET.has(tableName));
    if (unsupported.length > 0) {
      throw new Error(`Recovery source has unsupported namespace table(s): ${unsupported.join(", ")}.`);
    }
    const namespaceRows = Object.fromEntries(
      namespaces.map((tableName) => [tableName, namespaceLogicalRowProof(db, tableName)]),
    );
    const approvalReceipts = assertExactHistoricalReceipts(db, expectedApprovalDecisions);
    const approvalsColumn = db.prepare("PRAGMA table_info(approvals)").all()
      .find((column) => column.name === "decided_by");
    if (
      !approvalsColumn
      || String(approvalsColumn.type).toUpperCase() !== "TEXT"
      || Number(approvalsColumn.notnull) !== 0
      || approvalsColumn.dflt_value !== null
      || Number(approvalsColumn.pk) !== 0
    ) {
      throw new Error("Recovery source approvals.decided_by does not match nullable TEXT custody.");
    }
    const report = {
      sourcePath: source,
      snapshotSha256,
      bytes: fs.statSync(source).size,
      integrity,
      schema: schemaFingerprints(db),
      migrationHistory: history,
      migrationHistorySha256: migrationHistorySha256(history),
      migration27: history.at(-1),
      namespaceRows,
      approvalReceipts,
      approvalsDecidedBy: {
        cid: Number(approvalsColumn.cid),
        type: String(approvalsColumn.type),
        nullable: Number(approvalsColumn.notnull) === 0,
      },
      tableRows: tableLogicalManifest(db),
    };
    if (options.expectedSource !== null) {
      assertExpectedSource(
        report,
        options.expectedSource || HISTORICAL_PREVENTURE_SCHEMA27_SOURCE,
      );
    }
    return report;
  } finally {
    db.close();
  }
}

function tempStageName(tableName) {
  return `schema27_recovery_stage_${tableName.slice("preventure_research_".length)}`;
}

function stageNamespaceRows(db, tableNames) {
  const staged = [];
  for (const tableName of tableNames) {
    const columns = tableColumns(db, tableName).map((column) => column.name);
    const stageName = tempStageName(tableName);
    db.exec(
      `CREATE TEMP TABLE ${quoteIdentifier(stageName)} AS
       SELECT rowid AS ${quoteIdentifier("__pantheon_recovery_rowid__")}, *
       FROM main.${quoteIdentifier(tableName)}`,
    );
    staged.push({ tableName, stageName, columns });
  }
  return staged;
}

function dropPreventureTriggers(db) {
  const triggers = db.prepare(
    `SELECT name FROM sqlite_master
     WHERE type = 'trigger'
       AND (name GLOB 'trg_preventure_research_*' OR name = ?)
     ORDER BY name`,
  ).all(SPECIAL_PREVENTURE_TRIGGER);
  for (const trigger of triggers) db.exec(`DROP TRIGGER ${quoteIdentifier(trigger.name)}`);
}

function captureFinalPreventureTriggers(db) {
  return db.prepare(
    `SELECT name, sql FROM sqlite_master
     WHERE type = 'trigger'
       AND (name GLOB 'trg_preventure_research_*' OR name = ?)
     ORDER BY name`,
  ).all(SPECIAL_PREVENTURE_TRIGGER).map((row) => ({
    name: String(row.name),
    sql: String(row.sql),
  }));
}

function restoreStagedRows(db, staged) {
  for (const item of staged) {
    const finalColumns = tableColumns(db, item.tableName).map((column) => column.name);
    if (JSON.stringify(finalColumns) !== JSON.stringify(item.columns)) {
      throw new Error(
        `Final ${item.tableName} columns do not match the exact historical projection.`,
      );
    }
    const columns = item.columns.map(quoteIdentifier);
    db.exec(
      `INSERT INTO main.${quoteIdentifier(item.tableName)}
       (rowid, ${columns.join(", ")})
       SELECT ${quoteIdentifier("__pantheon_recovery_rowid__")}, ${columns.join(", ")}
       FROM temp.${quoteIdentifier(item.stageName)}
       ORDER BY ${quoteIdentifier("__pantheon_recovery_rowid__")}`,
    );
  }
}

function rebuildCandidateNamespace(candidatePath) {
  const db = new DatabaseSync(candidatePath);
  try {
    db.exec("PRAGMA busy_timeout = 5000");
    db.exec("PRAGMA foreign_keys = OFF");
    db.exec("BEGIN IMMEDIATE");
    try {
      const originalMigration27 = db.prepare(
        "SELECT version, name, applied_at FROM schema_migrations WHERE version = 27",
      ).get();
      if (
        Number(originalMigration27?.version) !== 27
        || originalMigration27?.name !== MIGRATION_27_NAME
        || !Number.isFinite(Date.parse(String(originalMigration27?.applied_at || "")))
      ) {
        throw new Error("Recovery candidate lacks the exact original schema-27 migration row.");
      }
      const existingTables = namespaceTableNames(db);
      const staged = stageNamespaceRows(db, existingTables);
      dropPreventureTriggers(db);
      db.exec(`DROP INDEX IF EXISTS ${quoteIdentifier(SPECIAL_PREVENTURE_INDEX)}`);
      for (const tableName of [...FINAL_NAMESPACE_TABLES].reverse()) {
        db.exec(`DROP TABLE IF EXISTS main.${quoteIdentifier(tableName)}`);
      }
      db.prepare("DELETE FROM schema_migrations WHERE version = 27").run();
      applyPreventureResearchAuthorityMigration(db);
      const restoredMigration = db.prepare(
        `UPDATE schema_migrations SET applied_at = ?
         WHERE version = 27 AND name = ?`,
      ).run(originalMigration27.applied_at, MIGRATION_27_NAME);
      if (Number(restoredMigration.changes) !== 1) {
        throw new Error("Recovery candidate could not preserve the original schema-27 migration row.");
      }

      const finalTriggers = captureFinalPreventureTriggers(db);
      dropPreventureTriggers(db);
      restoreStagedRows(db, staged);
      for (const trigger of finalTriggers) db.exec(trigger.sql);
      for (const item of staged) {
        db.exec(`DROP TABLE temp.${quoteIdentifier(item.stageName)}`);
      }
      db.exec("COMMIT");
      db.exec("PRAGMA foreign_keys = ON");
    } catch (error) {
      if (db.isTransaction) db.exec("ROLLBACK");
      throw error;
    }
    const foreignKeyFailures = db.prepare("PRAGMA foreign_key_check").all();
    if (foreignKeyFailures.length > 0) {
      throw new Error(
        `Recovered candidate has ${foreignKeyFailures.length} foreign-key violation(s).`,
      );
    }
    return verifyDatabase(db);
  } finally {
    db.close();
  }
}

function nonNamespaceRows(tableRows) {
  return Object.fromEntries(Object.entries(tableRows).filter(([tableName]) => (
    !tableName.startsWith("preventure_research_")
  )));
}

function assertCandidateRowCustody(sourceReport, candidateReport) {
  assertExactMap(
    nonNamespaceRows(candidateReport.tableRows),
    nonNamespaceRows(sourceReport.tableRows),
    "Recovered candidate non-namespace rows",
  );
  const sourceNamespaceRows = Object.fromEntries(
    Object.entries(sourceReport.namespaceRows).map(([name, proof]) => [name, proof]),
  );
  const candidatePreservedRows = Object.fromEntries(
    Object.keys(sourceNamespaceRows).map((name) => [name, candidateReport.namespaceRows[name]]),
  );
  assertExactMap(
    candidatePreservedRows,
    sourceNamespaceRows,
    "Recovered candidate namespace rows",
  );
  for (const tableName of FINAL_NAMESPACE_TABLES) {
    if (!sourceNamespaceRows[tableName] && candidateReport.namespaceRows[tableName]?.count !== 0) {
      throw new Error(`New final namespace table ${tableName} is not empty.`);
    }
  }
  assertExactMap(
    candidateReport.migrationHistory,
    sourceReport.migrationHistory,
    "Recovered candidate full migration rows",
  );
  if (
    candidateReport.migrationHistory.length !== 27
    || candidateReport.migration27.version !== 27
    || candidateReport.migration27.name !== MIGRATION_27_NAME
  ) {
    throw new Error("Recovered candidate did not retain the exact schema-27 migration identity.");
  }
}

function normalizeCandidateToDeleteJournal(candidatePath) {
  const db = openDatabase(candidatePath);
  let proof;
  try {
    proof = verifyDatabase(db);
    db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    const journal = db.prepare("PRAGMA journal_mode = DELETE").get();
    const mode = String(Object.values(journal || {})[0] || "").toLowerCase();
    if (mode !== "delete") throw new Error(`Recovered candidate journal remained ${mode}.`);
  } finally {
    db.close();
  }
  for (const suffix of ["-wal", "-shm"]) {
    if (fs.existsSync(`${candidatePath}${suffix}`)) fs.rmSync(`${candidatePath}${suffix}`, { force: true });
  }
  return proof;
}

function recoveryId(value) {
  const result = String(value || "").trim();
  if (!/^[a-z0-9][a-z0-9._-]{7,79}$/i.test(result)) {
    throw new Error("Recovery id must contain 8-80 letters, numbers, dots, underscores or hyphens.");
  }
  return result;
}

function cleanupOwnedPath(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return;
  try { fs.chmodSync(filePath, 0o600); } catch {}
  fs.rmSync(filePath, { force: true });
}

function regularFileIdentity(filePath, label) {
  const stats = fs.lstatSync(filePath);
  if (!stats.isFile() || stats.isSymbolicLink()) {
    throw new Error(`${label} is no longer the private regular file created by this recovery.`);
  }
  return Object.freeze({
    dev: stats.dev,
    ino: stats.ino,
  });
}

function assertRegularFileIdentity(filePath, expectedIdentity, label) {
  const actual = regularFileIdentity(filePath, label);
  if (actual.dev !== expectedIdentity.dev || actual.ino !== expectedIdentity.ino) {
    throw new Error(`${label} file identity changed during offline recovery.`);
  }
}

function pathIsStrictlyWithin(rootPath, candidatePath) {
  const root = normalizedPath(rootPath);
  const candidate = normalizedPath(candidatePath);
  const relative = path.relative(root, candidate);
  return Boolean(
    relative
    && relative !== "."
    && !relative.startsWith(`..${path.sep}`)
    && relative !== ".."
    && !path.isAbsolute(relative)
  );
}

function assertDisposableTestOnlyPaths(paths) {
  const temporaryRoot = os.tmpdir();
  for (const [label, candidatePath] of Object.entries(paths)) {
    if (!pathIsStrictlyWithin(temporaryRoot, candidatePath)) {
      throw new Error(
        `Test-only ${label} must be inside the operating-system temporary directory.`,
      );
    }
  }
}

function assertStandaloneSourceUnchanged(sourcePath, expectedSha256, stage) {
  assertRegularStandaloneSource(sourcePath);
  const actualSha256 = sha256File(sourcePath);
  if (actualSha256 !== expectedSha256) {
    throw new Error(
      `Recovery source changed ${stage}; found ${actualSha256}, expected ${expectedSha256}.`,
    );
  }
}

function assertFullSourceCorroboration(authoritativeReport, corroborationReport) {
  for (const [label, actual, expected] of [
    ["snapshot SHA-256", corroborationReport.snapshotSha256,
      authoritativeReport.snapshotSha256],
    ["byte length", corroborationReport.bytes, authoritativeReport.bytes],
    ["raw schema SHA-256", corroborationReport.schema.rawSchemaSha256,
      authoritativeReport.schema.rawSchemaSha256],
    ["normalized schema SHA-256", corroborationReport.schema.normalizedSchemaSha256,
      authoritativeReport.schema.normalizedSchemaSha256],
    ["migration-history SHA-256", corroborationReport.migrationHistorySha256,
      authoritativeReport.migrationHistorySha256],
  ]) {
    if (actual !== expected) {
      throw new Error(
        `Standalone recovery source ${label} does not match the authenticated backup payload.`,
      );
    }
  }
  assertExactMap(
    corroborationReport.migrationHistory,
    authoritativeReport.migrationHistory,
    "Standalone recovery source full migration rows",
  );
  assertExactMap(
    corroborationReport.namespaceRows,
    authoritativeReport.namespaceRows,
    "Standalone recovery source namespace rows",
  );
  assertExactMap(
    corroborationReport.tableRows,
    authoritativeReport.tableRows,
    "Standalone recovery source full logical table manifest",
  );
  assertExactMap(
    corroborationReport.approvalReceipts,
    authoritativeReport.approvalReceipts,
    "Standalone recovery source approval receipts",
  );
}

async function buildSchema27RecoveryCandidateInternal(options = {}, sourceContractToken = null) {
  const sourcePath = path.resolve(String(options.sourcePath || ""));
  const sourceBackupPath = path.resolve(String(options.sourceBackupPath || ""));
  const candidatePath = path.resolve(String(options.candidatePath || ""));
  const manifestPath = path.resolve(
    String(options.manifestPath || `${candidatePath}.recovery.json`),
  );
  const id = recoveryId(options.recoveryId);
  if (
    !options.sourcePath
    || !options.sourceBackupPath
    || !options.expectedSourceBackupSha256
    || !options.candidatePath
  ) {
    throw new Error(
      "Recovery source, exact encrypted source backup, backup SHA-256, and candidate paths are required.",
    );
  }
  if (
    samePath(sourcePath, candidatePath)
    || samePath(sourcePath, manifestPath)
    || samePath(sourceBackupPath, candidatePath)
    || samePath(sourceBackupPath, manifestPath)
    || samePath(sourceBackupPath, sourcePath)
  ) {
    throw new Error(
      "Recovery source, encrypted backup, candidate, and manifest paths must be distinct.",
    );
  }
  if (samePath(candidatePath, manifestPath)) {
    throw new Error("Recovery candidate and manifest paths must be distinct.");
  }
  assertRegularStandaloneSource(sourcePath);
  assertRegularEncryptedBackup(sourceBackupPath);
  assertNewOutputPath(candidatePath, "Recovery candidate");
  assertNewOutputPath(manifestPath, "Recovery manifest");

  const testContractAllowed = sourceContractToken === TEST_ONLY_SOURCE_CONTRACT_TOKEN;
  if (
    !testContractAllowed
    && (
      Object.hasOwn(options, "expectedSource")
      || Object.hasOwn(options, "expectedApprovalDecisions")
    )
  ) {
    throw new Error("The production offline builder cannot override its frozen source contract.");
  }
  const expectedSource = testContractAllowed
    ? options.expectedSource
    : HISTORICAL_PREVENTURE_SCHEMA27_SOURCE;
  const expectedApprovalDecisions = testContractAllowed
    ? options.expectedApprovalDecisions
    : HISTORICAL_PREVENTURE_APPROVAL_DECISIONS;
  if (!expectedSource || !Array.isArray(expectedApprovalDecisions)) {
    throw new Error("Test-only recovery requires an explicit synthetic source contract.");
  }
  if (testContractAllowed) {
    assertDisposableTestOnlyPaths({
      source: sourcePath,
      backup: sourceBackupPath,
      candidate: candidatePath,
      manifest: manifestPath,
    });
  }
  const expectedSourceBackupSha256 = String(options.expectedSourceBackupSha256 || "").toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(expectedSourceBackupSha256)) {
    throw new Error("Encrypted recovery-source backup SHA-256 is invalid.");
  }
  if (
    expectedSource.encryptedBackupSha256
    && expectedSourceBackupSha256 !== expectedSource.encryptedBackupSha256
  ) {
    throw new Error(
      "Requested encrypted backup SHA-256 does not match the frozen recovery-source contract.",
    );
  }
  const sourceBackupSha256 = sha256File(sourceBackupPath);
  if (sourceBackupSha256 !== expectedSourceBackupSha256) {
    throw new Error(
      `Encrypted recovery-source backup SHA-256 is ${sourceBackupSha256}; `
      + `expected ${expectedSourceBackupSha256}.`,
    );
  }
  const workRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "pantheon-schema27-authenticated-recovery-"),
  );
  try { fs.chmodSync(workRoot, 0o700); } catch {}
  const authenticatedSourcePath = path.join(workRoot, "authenticated-source.sqlite");
  const corroborationPath = path.join(workRoot, "standalone-source-corroboration.sqlite");
  const partialPath = path.join(workRoot, "candidate.partial.sqlite");
  let finalCandidateCreated = false;
  let manifestCreated = false;
  try {
    const sourceBackupProof = await decryptFile(
      sourceBackupPath,
      authenticatedSourcePath,
      {
        ...(options.backupPassphrase ? { passphrase: options.backupPassphrase } : {}),
      },
    );
    if (
      sourceBackupProof.kind !== "database"
      || sourceBackupProof.payloadSha256 !== expectedSource.snapshotSha256
      || sourceBackupProof.restoredSha256 !== expectedSource.snapshotSha256
    ) {
      throw new Error(
        "Encrypted recovery-source backup does not authenticate the frozen standalone snapshot.",
      );
    }
    const authenticatedSourceIdentity = regularFileIdentity(
      authenticatedSourcePath,
      "Authenticated recovery source",
    );
    const sourceReport = inspectSchema27RecoverySource(authenticatedSourcePath, {
      expectedSource,
      expectedApprovalDecisions,
    });
    if (
      Number(sourceBackupProof.payloadBytes) !== sourceReport.bytes
      || Number(sourceBackupProof.restoredBytes) !== sourceReport.bytes
      || sha256File(authenticatedSourcePath) !== sourceReport.snapshotSha256
    ) {
      throw new Error(
        "Authenticated recovery-source payload size or hash changed after private restoration.",
      );
    }
    if (sha256File(sourceBackupPath) !== sourceBackupSha256) {
      throw new Error("Encrypted recovery-source backup changed during authentication.");
    }

    const sourceSha256Before = sha256File(sourcePath);
    if (sourceSha256Before !== sourceReport.snapshotSha256) {
      throw new Error(
        `Standalone recovery source SHA-256 is ${sourceSha256Before}; `
        + `expected authenticated payload ${sourceReport.snapshotSha256}.`,
      );
    }
    fs.copyFileSync(sourcePath, corroborationPath, fs.constants.COPYFILE_EXCL);
    assertStandaloneSourceUnchanged(
      sourcePath,
      sourceSha256Before,
      "while its private corroboration copy was captured",
    );
    const corroborationReport = inspectSchema27RecoverySource(corroborationPath, {
      expectedSource,
      expectedApprovalDecisions,
    });
    assertFullSourceCorroboration(sourceReport, corroborationReport);
    if (sha256File(sourceBackupPath) !== sourceBackupSha256) {
      throw new Error("Encrypted recovery-source backup changed during source corroboration.");
    }

    assertRegularFileIdentity(
      authenticatedSourcePath,
      authenticatedSourceIdentity,
      "Authenticated recovery source",
    );
    fs.copyFileSync(authenticatedSourcePath, partialPath, fs.constants.COPYFILE_EXCL);
    const partialIdentity = regularFileIdentity(partialPath, "Private candidate staging file");
    if (sha256File(partialPath) !== sourceReport.snapshotSha256) {
      throw new Error("Private candidate staging copy changed from its authenticated payload.");
    }

    assertRegularFileIdentity(partialPath, partialIdentity, "Private candidate staging file");
    const migrationProof = rebuildCandidateNamespace(partialPath);
    assertRegularFileIdentity(partialPath, partialIdentity, "Private candidate staging file");
    const startupProof = normalizeCandidateToDeleteJournal(partialPath);
    assertRegularFileIdentity(partialPath, partialIdentity, "Private candidate staging file");
    const candidateReport = inspectSchema27RecoverySource(partialPath, {
      expectedSource: null,
      expectedApprovalDecisions,
    });
    assertCandidateRowCustody(sourceReport, candidateReport);
    if (candidateReport.migrationHistorySha256 !== sourceReport.migrationHistorySha256) {
      throw new Error("Recovered candidate migration version/name history changed.");
    }
    if (candidateReport.schema.objectCount < sourceReport.schema.objectCount) {
      throw new Error("Recovered candidate did not install the complete final schema contract.");
    }
    assertStandaloneSourceUnchanged(
      sourcePath,
      sourceReport.snapshotSha256,
      "during candidate verification",
    );
    if (sha256File(sourceBackupPath) !== sourceBackupSha256) {
      throw new Error("Encrypted recovery-source backup changed during candidate verification.");
    }

    assertNewOutputPath(candidatePath, "Recovery candidate");
    fs.copyFileSync(partialPath, candidatePath, fs.constants.COPYFILE_EXCL);
    finalCandidateCreated = true;
    const candidateSha256 = sha256File(candidatePath);
    if (candidateSha256 !== sha256File(partialPath)) {
      throw new Error("Published recovery candidate does not match its verified staging file.");
    }

    const manifestBody = {
      schema: testContractAllowed ? TEST_RECOVERY_MANIFEST_SCHEMA : RECOVERY_MANIFEST_SCHEMA,
      recoveryId: id,
      builtAt: new Date().toISOString(),
      controls: {
        sourceOpenedReadOnly: true,
        authenticatedBackupPayloadWasBuildSource: true,
        operatorSourceUsedForBuild: false,
        operatorSourceCorroborationOnly: true,
        destinationCreatedNew: true,
        liveDatabaseChanged: false,
        liveReplacementAvailable: false,
        externalCommercialEffects: false,
        syntheticTestOnly: testContractAllowed,
        productionEligibleForSeparateSwapReview: !testContractAllowed,
      },
      source: {
        path: sourcePath,
        custodyAuthority: "authenticated_encrypted_backup_payload",
        standaloneSourceCorroborated: true,
        bytes: sourceReport.bytes,
        snapshotSha256: sourceReport.snapshotSha256,
        normalizedSchemaSha256: sourceReport.schema.normalizedSchemaSha256,
        rawSchemaSha256: sourceReport.schema.rawSchemaSha256,
        migrationHistorySha256: sourceReport.migrationHistorySha256,
        migrationRowsSha256: sha256Text(stableJson(sourceReport.migrationHistory)),
        migration27: sourceReport.migration27,
        namespaceRows: sourceReport.namespaceRows,
        fullLogicalRowsSha256: sha256Text(stableJson(sourceReport.tableRows)),
        nonNamespaceRowsSha256: sha256Text(stableJson(nonNamespaceRows(sourceReport.tableRows))),
        approvalReceipts: sourceReport.approvalReceipts,
        integrity: sourceReport.integrity,
      },
      standaloneSourceCorroboration: {
        path: sourcePath,
        bytes: corroborationReport.bytes,
        snapshotSha256: corroborationReport.snapshotSha256,
        migrationRowsSha256: sha256Text(stableJson(corroborationReport.migrationHistory)),
        fullLogicalRowsSha256: sha256Text(stableJson(corroborationReport.tableRows)),
        exactMatch: true,
      },
      encryptedSourceBackup: {
        path: sourceBackupPath,
        sha256: sourceBackupSha256,
        kind: sourceBackupProof.kind,
        keyId: sourceBackupProof.keyId || null,
        payloadBytes: sourceBackupProof.payloadBytes,
        payloadSha256: sourceBackupProof.payloadSha256,
        restoredBytes: sourceBackupProof.restoredBytes,
        restoredSha256: sourceBackupProof.restoredSha256,
        authenticated: true,
      },
      candidate: {
        path: candidatePath,
        bytes: fs.statSync(candidatePath).size,
        sha256: candidateSha256,
        schemaObjectCount: candidateReport.schema.objectCount,
        normalizedSchemaSha256: candidateReport.schema.normalizedSchemaSha256,
        rawSchemaSha256: candidateReport.schema.rawSchemaSha256,
        migrationHistorySha256: candidateReport.migrationHistorySha256,
        migrationRowsSha256: sha256Text(stableJson(candidateReport.migrationHistory)),
        migration27: candidateReport.migration27,
        namespaceRows: candidateReport.namespaceRows,
        fullLogicalRowsSha256: sha256Text(stableJson(candidateReport.tableRows)),
        nonNamespaceRowsSha256: sha256Text(stableJson(nonNamespaceRows(candidateReport.tableRows))),
        integrity: candidateReport.integrity,
        migrationProof,
        startupProof,
      },
    };
    const immutableManifest = {
      ...manifestBody,
      manifestSha256: sha256Text(stableJson(manifestBody)),
    };
    fs.writeFileSync(
      manifestPath,
      `${JSON.stringify(immutableManifest, null, 2)}\n`,
      { encoding: "utf8", flag: "wx", mode: 0o444 },
    );
    manifestCreated = true;
    try { fs.chmodSync(manifestPath, 0o444); } catch {}
    cleanupOwnedPath(partialPath);
    return Object.freeze({
      recoveryId: id,
      sourcePath,
      sourceSha256: sourceReport.snapshotSha256,
      candidatePath,
      candidateSha256,
      manifestPath,
      manifestSha256: immutableManifest.manifestSha256,
      schemaVersion: migrationProof.schemaVersion,
      liveDatabaseChanged: false,
      syntheticTestOnly: testContractAllowed,
      productionEligibleForSeparateSwapReview: !testContractAllowed,
    });
  } catch (error) {
    if (manifestCreated) cleanupOwnedPath(manifestPath);
    if (finalCandidateCreated) cleanupOwnedPath(candidatePath);
    for (const suffix of ["-wal", "-shm"]) cleanupOwnedPath(`${candidatePath}${suffix}`);
    throw error;
  } finally {
    fs.rmSync(workRoot, { recursive: true, force: true });
  }
}

function buildSchema27RecoveryCandidate(options = {}) {
  return buildSchema27RecoveryCandidateInternal(options);
}

function buildSchema27RecoveryCandidateForTest(options = {}) {
  return buildSchema27RecoveryCandidateInternal(options, TEST_ONLY_SOURCE_CONTRACT_TOKEN);
}

module.exports = {
  FINAL_NAMESPACE_TABLES,
  RECOVERY_MANIFEST_SCHEMA,
  buildSchema27RecoveryCandidate,
  buildSchema27RecoveryCandidateForTest,
  inspectSchema27RecoverySource,
  normalizeSchemaSql,
  sourceContractFromReport,
};
