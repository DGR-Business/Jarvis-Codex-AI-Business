"use strict";

const { DatabaseSync } = require("node:sqlite");
const {
  LAST_RELEASED_SCHEMA_VERSION,
} = require("../../src/runtime/backup");

const LEGACY_SCHEMA_VERSION = 24;
const LEGACY_SCHEMA_25_VERSION = 25;
const PREVENTURE_TRIGGER_PREFIX = "trg_preventure_research_";
const PREVENTURE_TRIGGER_GLOB = `${PREVENTURE_TRIGGER_PREFIX}*`;
const PREVENTURE_TABLE_GLOB = "preventure_research_*";
const SAFE_PREVENTURE_TRIGGER = /^trg_preventure_research_[a-z0-9_]+$/;
const SAFE_PREVENTURE_TABLE = /^preventure_research_[a-z0-9_]+$/;
const SAFE_FIXED_IDENTIFIER = /^[a-z][a-z0-9_]*$/;
const SCHEMA_27_CROSS_NAMESPACE_TRIGGERS = Object.freeze([
  "trg_commercial_test_lifecycle_preventure_approval_insert",
]);
const LEGACY_VENTURE_OWNER_TRIGGERS = Object.freeze([
  ["trg_approvals_venture_owner", "approvals", true],
  ["trg_events_venture_owner", "events", false],
  ["trg_workflows_venture_owner", "workflows", false],
  ["trg_tasks_venture_owner", "tasks", true],
  ["trg_task_attempts_venture_owner", "task_attempts", true],
  ["trg_model_calls_venture_owner", "model_calls", true],
  ["trg_research_runs_venture_owner", "research_runs", true],
  ["trg_costs_venture_owner", "costs", true],
  ["trg_agent_runs_venture_owner", "agent_runs", true],
  ["trg_budget_reservations_venture_owner", "budget_reservations", true],
]);

function quoteFixedIdentifier(name) {
  if (!SAFE_FIXED_IDENTIFIER.test(name)) {
    throw new Error(`Unsafe schema fixture identifier: ${name}`);
  }
  return `"${name}"`;
}

function restoreLegacyVentureOwnerTriggers(db) {
  const activeVentureSql = `COALESCE(
    (SELECT id FROM ventures WHERE is_active = 1 ORDER BY created_at ASC LIMIT 1),
    (SELECT id FROM ventures ORDER BY created_at ASC LIMIT 1)
  )`;
  for (const [triggerName, tableName, preferWorkflowVenture] of LEGACY_VENTURE_OWNER_TRIGGERS) {
    const quotedTrigger = quoteFixedIdentifier(triggerName);
    const quotedTable = quoteFixedIdentifier(tableName);
    const ownerSql = preferWorkflowVenture
      ? `COALESCE(
          (SELECT venture_id FROM workflows WHERE workflows.id = NEW.workflow_id),
          ${activeVentureSql}
        )`
      : activeVentureSql;
    db.exec(`
      DROP TRIGGER IF EXISTS ${quotedTrigger};
      CREATE TRIGGER ${quotedTrigger}
      AFTER INSERT ON ${quotedTable}
      FOR EACH ROW WHEN NEW.venture_id IS NULL
      BEGIN
        UPDATE ${quotedTable}
        SET venture_id = ${ownerSql}
        WHERE id = NEW.id;
      END;
    `);
  }
}

function dropSchema27PreventureObjects(db) {
  db.exec("DROP INDEX IF EXISTS idx_task_attempts_one_running_per_task");
  const triggerRows = db.prepare(
    `SELECT name
     FROM sqlite_master
     WHERE type = 'trigger' AND name GLOB ?
     ORDER BY name`,
  ).all(PREVENTURE_TRIGGER_GLOB);

  for (const { name } of triggerRows) {
    if (!SAFE_PREVENTURE_TRIGGER.test(name)) {
      throw new Error(`Unsafe pre-venture trigger name in schema fixture: ${name}`);
    }
    db.exec(`DROP TRIGGER ${quoteFixedIdentifier(name)}`);
  }

  for (const triggerName of SCHEMA_27_CROSS_NAMESPACE_TRIGGERS) {
    db.exec(`DROP TRIGGER IF EXISTS ${quoteFixedIdentifier(triggerName)}`);
  }
  const tableRows = db.prepare(
    `SELECT name
     FROM sqlite_master
     WHERE type = 'table' AND name GLOB ?
     ORDER BY name DESC`,
  ).all(PREVENTURE_TABLE_GLOB);
  for (const { name } of tableRows) {
    if (!SAFE_PREVENTURE_TABLE.test(name)) {
      throw new Error(`Unsafe pre-venture table name in schema fixture: ${name}`);
    }
    db.exec(`DROP TABLE ${quoteFixedIdentifier(name)}`);
  }
  restoreLegacyVentureOwnerTriggers(db);

  const approvalColumns = db.prepare("PRAGMA table_info(approvals)").all();
  if (approvalColumns.some((column) => column.name === "decided_by")) {
    db.exec("ALTER TABLE approvals DROP COLUMN decided_by");
  }
}

function dropSchema25CommercialLedger(db) {
  db.exec(`
    DROP TABLE IF EXISTS commercial_test_proof_evaluations;
    DROP TABLE IF EXISTS commercial_test_evidence_records;
    DROP TABLE IF EXISTS commercial_test_evidence_receipts;
    DROP TABLE IF EXISTS commercial_test_lifecycle_events;
    DROP TABLE IF EXISTS commercial_test_contracts;
    DROP TRIGGER IF EXISTS trg_venture_kits_content_hash_insert;
    DROP TRIGGER IF EXISTS trg_venture_kits_definition_immutable_update;
    DROP TRIGGER IF EXISTS trg_venture_kits_definition_immutable_delete;
    DROP INDEX IF EXISTS idx_venture_kits_content_identity;
    ALTER TABLE venture_kits DROP COLUMN content_hash;
  `);
}

function downgradeDatabase(dbPath, targetVersion) {
  if (![LEGACY_SCHEMA_VERSION, LEGACY_SCHEMA_25_VERSION, LAST_RELEASED_SCHEMA_VERSION]
    .includes(targetVersion)) {
    throw new Error(`Unsupported schema fixture target: ${targetVersion}`);
  }

  const db = new DatabaseSync(dbPath);
  try {
    db.exec("PRAGMA foreign_keys = OFF");
    db.exec("BEGIN IMMEDIATE");
    try {
      dropSchema27PreventureObjects(db);
      if (targetVersion < LEGACY_SCHEMA_25_VERSION) dropSchema25CommercialLedger(db);
      db.prepare("DELETE FROM schema_migrations WHERE version > ?").run(targetVersion);
      db.prepare(
        `UPDATE settings
         SET value = json_set(value, '$.version', ?)
         WHERE key = 'runtime.initialized' AND json_valid(value)`,
      ).run(targetVersion);
      const retainedVersion = db.prepare(
        "SELECT MAX(version) AS version FROM schema_migrations",
      ).get().version;
      if (retainedVersion !== targetVersion) {
        throw new Error(
          `Schema fixture retained version ${retainedVersion}; expected ${targetVersion}.`,
        );
      }
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    db.prepare("PRAGMA journal_mode = DELETE").get();
  } finally {
    db.close();
  }
}

function downgradeDatabaseToLegacySchema24(dbPath) {
  downgradeDatabase(dbPath, LEGACY_SCHEMA_VERSION);
}

function downgradeDatabaseToLegacySchema25(dbPath) {
  downgradeDatabase(dbPath, LEGACY_SCHEMA_25_VERSION);
}

function downgradeDatabaseToLastReleasedSchema26(dbPath) {
  downgradeDatabase(dbPath, LAST_RELEASED_SCHEMA_VERSION);
}

// Retain the old helper name for migration tests outside the backup lane.
const downgradeDatabaseToReleasedSchema24 = downgradeDatabaseToLegacySchema24;

module.exports = {
  LEGACY_SCHEMA_VERSION,
  LEGACY_SCHEMA_25_VERSION,
  downgradeDatabaseToLastReleasedSchema26,
  downgradeDatabaseToLegacySchema24,
  downgradeDatabaseToLegacySchema25,
  downgradeDatabaseToReleasedSchema24,
};
