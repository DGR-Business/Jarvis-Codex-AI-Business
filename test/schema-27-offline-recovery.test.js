"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { DatabaseSync } = require("node:sqlite");

const authority = require("../config/preventure-research-authority-smm-scope-guard-v1");
const readinessSpec = require("../config/commercial-readiness-social-media-manager-scope-guard-v1");
const CONFIG = require("../src/config");
const { openDatabase, verifyDatabase } = require("../src/db");
const { encryptFile } = require("../src/runtime/backup");
const {
  buildSchema27RecoveryCandidate,
  buildSchema27RecoveryCandidateForTest,
  inspectSchema27RecoverySource,
  sourceContractFromReport,
} = require("../src/runtime/schema27-offline-recovery");
const {
  createPreventureResearchStore,
} = require("../src/runtime/preventure-research-store");
const {
  historicalV1TestRegistry,
} = require("./support/preventure-research-test-registry");
const {
  HISTORICAL_PREVENTURE_SCHEMA27_SOURCE,
} = require("../src/runtime/preventure-research-historical-approval-manifest");

const FIXTURE_TIME = "2026-08-02T03:00:00.000Z";
const PASSPHRASE = "schema27-offline-recovery-test-key-2026";

test("offline recovery freezes the authenticated production source-backup identity", () => {
  assert.equal(
    HISTORICAL_PREVENTURE_SCHEMA27_SOURCE.snapshotSha256,
    "668573b8aa5c4086e5eb36431eda2088030ef15bc4efe07a4a8f21c612e722f1",
  );
  assert.equal(
    HISTORICAL_PREVENTURE_SCHEMA27_SOURCE.encryptedBackupSha256,
    "8fbbea99edffeb296c49fb173a55effcddcfecb027e2f8a6be78a112efa01166",
  );
});

function sha256File(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function removeSidecars(filePath) {
  for (const suffix of ["-wal", "-shm"]) fs.rmSync(`${filePath}${suffix}`, { force: true });
}

function normalizeStandalone(filePath) {
  const db = new DatabaseSync(filePath);
  try {
    db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    const row = db.prepare("PRAGMA journal_mode = DELETE").get();
    assert.equal(String(Object.values(row)[0]).toLowerCase(), "delete");
  } finally {
    db.close();
  }
  removeSidecars(filePath);
}

async function recoveryFixture(t, label, options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `pantheon-schema27-offline-${label}-`));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const sourcePath = path.join(root, "source.sqlite");
  const backupPath = path.join(root, "source.sqlite.jbackup");
  const db = openDatabase(sourcePath, { clock: () => FIXTURE_TIME });
  try {
    db.prepare(
      `INSERT INTO settings (key, value, updated_at)
       VALUES ('schema27.recovery.sentinel', 'must-survive', ?)`,
    ).run(FIXTURE_TIME);
    const store = createPreventureResearchStore(db, {
      authorityRegistry: historicalV1TestRegistry,
      clock: () => FIXTURE_TIME,
    });
    store.registerAuthority(authority, readinessSpec);
    store.appendLifecycle(authority.authorityHash, {
      id: `event_schema27_recovery_${label}`,
      eventType: "proposed",
      occurredAt: FIXTURE_TIME,
      actor: "jarvis",
      reason: "Test-only offline recovery custody proof.",
      metadata: {},
    });
    if (options.addLegacyColumn) {
      db.exec(
        "ALTER TABLE preventure_research_authorities ADD COLUMN obsolete_candidate_value TEXT",
      );
    }
  } finally {
    db.close();
  }
  normalizeStandalone(sourcePath);
  const report = inspectSchema27RecoverySource(sourcePath, {
    expectedSource: null,
    expectedApprovalDecisions: [],
  });
  await encryptFile(sourcePath, backupPath, {
    kind: "database",
    passphrase: PASSPHRASE,
    createdAt: FIXTURE_TIME,
  });
  const backupSha256 = sha256File(backupPath);
  return {
    root,
    sourcePath,
    backupPath,
    backupSha256,
    expectedSource: Object.freeze({
      ...sourceContractFromReport(report),
      encryptedBackupSha256: backupSha256,
    }),
  };
}

test("offline schema-27 recovery builds a verified new candidate without changing its source", async (t) => {
  const fixture = await recoveryFixture(t, "success");
  const candidatePath = path.join(fixture.root, "candidate.sqlite");
  const manifestPath = path.join(fixture.root, "candidate.manifest.json");
  const sourceBefore = fs.readFileSync(fixture.sourcePath);
  const backupBefore = fs.readFileSync(fixture.backupPath);

  const result = await buildSchema27RecoveryCandidateForTest({
    sourcePath: fixture.sourcePath,
    sourceBackupPath: fixture.backupPath,
    expectedSourceBackupSha256: fixture.backupSha256,
    backupPassphrase: PASSPHRASE,
    candidatePath,
    manifestPath,
    recoveryId: "schema27-test-success",
    expectedSource: fixture.expectedSource,
    expectedApprovalDecisions: [],
  });

  assert.equal(result.liveDatabaseChanged, false);
  assert.equal(result.schemaVersion, 27);
  assert.deepEqual(fs.readFileSync(fixture.sourcePath), sourceBefore);
  assert.deepEqual(fs.readFileSync(fixture.backupPath), backupBefore);
  assert.equal(fs.existsSync(`${fixture.sourcePath}-wal`), false);
  assert.equal(fs.existsSync(`${fixture.sourcePath}-shm`), false);
  assert.equal(fs.existsSync(candidatePath), true);
  assert.equal(fs.existsSync(`${candidatePath}-wal`), false);
  assert.equal(fs.existsSync(`${candidatePath}-shm`), false);

  const candidate = openDatabase(candidatePath, { clock: () => FIXTURE_TIME });
  try {
    assert.equal(verifyDatabase(candidate).schemaVersion, 27);
    assert.equal(
      candidate.prepare(
        "SELECT value FROM settings WHERE key = 'schema27.recovery.sentinel'",
      ).get().value,
      "must-survive",
    );
    assert.equal(
      candidate.prepare(
        "SELECT COUNT(*) AS count FROM preventure_research_authorities",
      ).get().count,
      1,
    );
    assert.equal(
      candidate.prepare(
        "SELECT COUNT(*) AS count FROM preventure_research_lifecycle_events",
      ).get().count,
      1,
    );
    assert.equal(
      candidate.prepare(
        "SELECT COUNT(*) AS count FROM preventure_research_terminal_recoveries",
      ).get().count,
      0,
    );
    assert.equal(
      candidate.prepare(
        "SELECT COUNT(*) AS count FROM preventure_research_provider_billing_observations",
      ).get().count,
      0,
    );
  } finally {
    candidate.close();
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  assert.equal(
    manifest.schema,
    "pantheon.schema27-offline-recovery-candidate.test-only.v1",
  );
  assert.equal(manifest.controls.sourceOpenedReadOnly, true);
  assert.equal(manifest.controls.authenticatedBackupPayloadWasBuildSource, true);
  assert.equal(manifest.controls.operatorSourceUsedForBuild, false);
  assert.equal(manifest.controls.operatorSourceCorroborationOnly, true);
  assert.equal(manifest.controls.liveDatabaseChanged, false);
  assert.equal(manifest.controls.liveReplacementAvailable, false);
  assert.equal(manifest.controls.syntheticTestOnly, true);
  assert.equal(manifest.controls.productionEligibleForSeparateSwapReview, false);
  assert.equal(result.syntheticTestOnly, true);
  assert.equal(result.productionEligibleForSeparateSwapReview, false);
  assert.equal(manifest.encryptedSourceBackup.authenticated, true);
  assert.equal(manifest.encryptedSourceBackup.sha256, fixture.backupSha256);
  assert.equal(manifest.encryptedSourceBackup.payloadSha256, sha256File(fixture.sourcePath));
  assert.equal(
    manifest.encryptedSourceBackup.restoredSha256,
    manifest.source.snapshotSha256,
  );
  assert.equal(
    manifest.standaloneSourceCorroboration.fullLogicalRowsSha256,
    manifest.source.fullLogicalRowsSha256,
  );
  assert.equal(
    manifest.standaloneSourceCorroboration.migrationRowsSha256,
    manifest.source.migrationRowsSha256,
  );
  assert.equal(manifest.candidate.migrationRowsSha256, manifest.source.migrationRowsSha256);
  assert.equal(manifest.source.nonNamespaceRowsSha256, manifest.candidate.nonNamespaceRowsSha256);
  assert.deepEqual(manifest.candidate.migration27, manifest.source.migration27);
  const sourceMigrations = new DatabaseSync(fixture.sourcePath, { readOnly: true });
  const candidateMigrations = new DatabaseSync(candidatePath, { readOnly: true });
  try {
    assert.deepEqual(
      candidateMigrations.prepare(
        "SELECT version, name, applied_at FROM schema_migrations ORDER BY version",
      ).all(),
      sourceMigrations.prepare(
        "SELECT version, name, applied_at FROM schema_migrations ORDER BY version",
      ).all(),
    );
  } finally {
    candidateMigrations.close();
    sourceMigrations.close();
  }
  assert.match(manifest.manifestSha256, /^[a-f0-9]{64}$/);
});

test("offline schema-27 recovery refuses active paths, sidecars, and existing outputs", async (t) => {
  const fixture = await recoveryFixture(t, "refusals");
  const candidatePath = path.join(fixture.root, "candidate.sqlite");
  const base = {
    sourcePath: fixture.sourcePath,
    sourceBackupPath: fixture.backupPath,
    expectedSourceBackupSha256: fixture.backupSha256,
    backupPassphrase: PASSPHRASE,
    candidatePath,
    recoveryId: "schema27-test-refusals",
    expectedSource: fixture.expectedSource,
    expectedApprovalDecisions: [],
  };

  await assert.rejects(
    buildSchema27RecoveryCandidate(base),
    /cannot override its frozen source contract/i,
  );
  await assert.rejects(
    buildSchema27RecoveryCandidateForTest({ ...base, sourcePath: CONFIG.dbPath }),
    /configured active database/i,
  );
  fs.writeFileSync(`${fixture.sourcePath}-wal`, "");
  await assert.rejects(buildSchema27RecoveryCandidateForTest(base), /WAL sidecar/i);
  fs.rmSync(`${fixture.sourcePath}-wal`, { force: true });

  fs.writeFileSync(candidatePath, "operator-owned-output");
  const existing = fs.readFileSync(candidatePath);
  await assert.rejects(buildSchema27RecoveryCandidateForTest(base), /candidate already exists/i);
  assert.deepEqual(fs.readFileSync(candidatePath), existing);

  const realOutput = path.join(fixture.root, "real-output");
  const aliasedOutput = path.join(fixture.root, "aliased-output");
  fs.mkdirSync(realOutput);
  fs.symlinkSync(realOutput, aliasedOutput, process.platform === "win32" ? "junction" : "dir");
  await assert.rejects(
    buildSchema27RecoveryCandidateForTest({
      ...base,
      candidatePath: path.join(realOutput, "same-target.sqlite"),
      manifestPath: path.join(aliasedOutput, "same-target.sqlite"),
    }),
    /candidate and manifest paths must be distinct/i,
  );

  const forbiddenCandidate = path.join(
    process.cwd(),
    ".schema27-synthetic-helper-must-not-write-here.sqlite",
  );
  await assert.rejects(
    buildSchema27RecoveryCandidateForTest({
      ...base,
      candidatePath: forbiddenCandidate,
      manifestPath: `${forbiddenCandidate}.json`,
    }),
    /test-only candidate must be inside the operating-system temporary directory/i,
  );
  assert.equal(fs.existsSync(forbiddenCandidate), false);
});

test("offline schema-27 recovery requires the exact authenticated database backup", async (t) => {
  const fixture = await recoveryFixture(t, "backup-proof");
  const candidatePath = path.join(fixture.root, "candidate.sqlite");
  const base = {
    sourcePath: fixture.sourcePath,
    sourceBackupPath: fixture.backupPath,
    expectedSourceBackupSha256: fixture.backupSha256,
    backupPassphrase: PASSPHRASE,
    candidatePath,
    recoveryId: "schema27-test-backup",
    expectedSource: fixture.expectedSource,
    expectedApprovalDecisions: [],
  };

  await assert.rejects(
    buildSchema27RecoveryCandidateForTest({
      ...base,
      expectedSourceBackupSha256: "0".repeat(64),
    }),
    /does not match the frozen recovery-source contract/i,
  );
  await assert.rejects(
    buildSchema27RecoveryCandidateForTest({
      ...base,
      backupPassphrase: "wrong-passphrase-value-000000",
    }),
    /could not be decrypted or authenticated/i,
  );
  assert.equal(fs.existsSync(candidatePath), false);
});

test("a divergent operator snapshot cannot replace the authenticated backup payload", async (t) => {
  const fixture = await recoveryFixture(t, "source-divergence");
  const candidatePath = path.join(fixture.root, "candidate.sqlite");
  const manifestPath = path.join(fixture.root, "candidate.manifest.json");
  const backupBefore = fs.readFileSync(fixture.backupPath);
  const changed = new DatabaseSync(fixture.sourcePath);
  try {
    changed.prepare(
      `UPDATE settings SET value = 'untrusted-path-replacement'
       WHERE key = 'schema27.recovery.sentinel'`,
    ).run();
  } finally {
    changed.close();
  }
  normalizeStandalone(fixture.sourcePath);

  await assert.rejects(
    buildSchema27RecoveryCandidateForTest({
      sourcePath: fixture.sourcePath,
      sourceBackupPath: fixture.backupPath,
      expectedSourceBackupSha256: fixture.backupSha256,
      backupPassphrase: PASSPHRASE,
      candidatePath,
      manifestPath,
      recoveryId: "schema27-test-source-divergence",
      expectedSource: fixture.expectedSource,
      expectedApprovalDecisions: [],
    }),
    /standalone recovery source SHA-256/i,
  );

  assert.deepEqual(fs.readFileSync(fixture.backupPath), backupBefore);
  assert.equal(fs.existsSync(candidatePath), false);
  assert.equal(fs.existsSync(manifestPath), false);
});

test("a late namespace projection failure deletes only the new candidate work", async (t) => {
  const fixture = await recoveryFixture(t, "late-failure", { addLegacyColumn: true });
  const candidatePath = path.join(fixture.root, "candidate.sqlite");
  const manifestPath = path.join(fixture.root, "candidate.manifest.json");
  const sourceBefore = fs.readFileSync(fixture.sourcePath);
  const backupBefore = fs.readFileSync(fixture.backupPath);

  await assert.rejects(
    buildSchema27RecoveryCandidateForTest({
      sourcePath: fixture.sourcePath,
      sourceBackupPath: fixture.backupPath,
      expectedSourceBackupSha256: fixture.backupSha256,
      backupPassphrase: PASSPHRASE,
      candidatePath,
      manifestPath,
      recoveryId: "schema27-test-late-failure",
      expectedSource: fixture.expectedSource,
      expectedApprovalDecisions: [],
    }),
    /columns do not match the exact historical projection/i,
  );

  assert.deepEqual(fs.readFileSync(fixture.sourcePath), sourceBefore);
  assert.deepEqual(fs.readFileSync(fixture.backupPath), backupBefore);
  assert.equal(fs.existsSync(candidatePath), false);
  assert.equal(fs.existsSync(manifestPath), false);
  assert.equal(
    fs.readdirSync(fixture.root).some((name) => name.includes(".partial")),
    false,
  );
});
