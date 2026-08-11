"use strict";

const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { DatabaseSync } = require("node:sqlite");

const {
  LATEST_SCHEMA_VERSION,
  applyPreventureResearchAuthorityMigration,
  openDatabase,
  seedDatabase,
} = require("../src/db");
const {
  downgradeDatabaseToLastReleasedSchema26,
  downgradeDatabaseToLegacySchema24,
  downgradeDatabaseToLegacySchema25,
} = require("./support/released-schema-24-fixture");

const TEST_CLOCK = "2026-08-02T12:30:00.000+10:00";
const OWNER_TRIGGER_NAMES = Object.freeze([
  "trg_approvals_venture_owner",
  "trg_events_venture_owner",
  "trg_workflows_venture_owner",
  "trg_tasks_venture_owner",
  "trg_task_attempts_venture_owner",
  "trg_model_calls_venture_owner",
  "trg_research_runs_venture_owner",
  "trg_costs_venture_owner",
  "trg_agent_runs_venture_owner",
  "trg_budget_reservations_venture_owner",
]);
const DOWNGRADE_BY_VERSION = new Map([
  [24, downgradeDatabaseToLegacySchema24],
  [25, downgradeDatabaseToLegacySchema25],
  [26, downgradeDatabaseToLastReleasedSchema26],
]);

function currentFixture(t, name, options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `pantheon-schema27-${name}-`));
  const dbPath = path.join(root, "runtime.sqlite");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const db = openDatabase(dbPath, { clock: () => TEST_CLOCK });
  if (options.seed === true) seedDatabase(db, { seedDemoProofs: false });
  db.close();
  return { root, dbPath };
}

function checkpointToDeleteAndClose(db) {
  let mode;
  try {
    db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    const row = db.prepare("PRAGMA journal_mode = DELETE").get();
    mode = String(Object.values(row || {})[0] || "").toLowerCase();
  } finally {
    db.close();
  }
  assert.equal(mode, "delete");
}

function assertNoSqliteSidecars(dbPath) {
  assert.equal(fs.existsSync(`${dbPath}-wal`), false);
  assert.equal(fs.existsSync(`${dbPath}-shm`), false);
}

function rejectRecordedV27WithoutMutation(t, name, mutate, expected) {
  const fixture = currentFixture(t, name);
  const db = new DatabaseSync(fixture.dbPath);
  mutate(db);
  checkpointToDeleteAndClose(db);
  assertNoSqliteSidecars(fixture.dbPath);
  const before = fs.readFileSync(fixture.dbPath);

  assert.throws(
    () => openDatabase(fixture.dbPath, { clock: () => TEST_CLOCK }),
    expected,
  );

  assert.deepEqual(fs.readFileSync(fixture.dbPath), before);
  assertNoSqliteSidecars(fixture.dbPath);
}

function v27ArtifactRows(db) {
  return db.prepare(
    `SELECT type, name
     FROM sqlite_master
     WHERE name GLOB 'preventure_research_*'
        OR name GLOB 'trg_preventure_research_*'
        OR name GLOB 'idx_preventure_research_*'
        OR name IN (
          'idx_task_attempts_one_running_per_task',
          'trg_commercial_test_lifecycle_preventure_approval_insert'
        )
     ORDER BY type, name`,
  ).all();
}

function hasDecidedBy(db) {
  return db.prepare("PRAGMA table_info(approvals)").all()
    .some((column) => column.name === "decided_by");
}

function schemaDigest(db) {
  const rows = db.prepare(
    `SELECT type, name, tbl_name, sql
     FROM sqlite_master
     ORDER BY type, name`,
  ).all();
  return createHash("sha256").update(JSON.stringify(rows)).digest("hex");
}

function insertLegacySentinelRows(db, label, attemptStatuses) {
  const timestamp = "2026-07-01T00:00:00.000Z";
  const ventureId = `venture_${label}`;
  const workflowId = `workflow_${label}`;
  const taskId = `task_${label}`;
  const approvalId = `approval_${label}`;
  db.prepare(
    `INSERT INTO settings (key, value, updated_at)
     VALUES (?, ?, ?)`,
  ).run(`audit.${label}`, `preserve-${label}`, timestamp);
  db.prepare(
    `INSERT INTO ventures
     (id, name, status, metadata, created_at, updated_at, is_active)
     VALUES (?, ?, 'active', ?, ?, ?, 0)`,
  ).run(ventureId, `Audit ${label}`, JSON.stringify({ label }), timestamp, timestamp);
  db.prepare(
    `INSERT INTO workflows
     (id, venture_id, type, title, status, metadata, created_at, updated_at)
     VALUES (?, ?, 'audit_migration', ?, 'running', ?, ?, ?)`,
  ).run(workflowId, ventureId, `Audit workflow ${label}`, JSON.stringify({ label }), timestamp, timestamp);
  db.prepare(
    `INSERT INTO tasks
     (id, workflow_id, venture_id, title, kind, agent, status, payload, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'audit_migration', 'jarvis', 'running', ?, ?, ?)`,
  ).run(taskId, workflowId, ventureId, `Audit task ${label}`, JSON.stringify({ label }), timestamp, timestamp);
  db.prepare(
    `INSERT INTO approvals
     (id, workflow_id, venture_id, task_id, scope, title, status, risk_level,
      requested_by, requested_at, payload, scope_hash, expected_effects)
     VALUES (?, ?, ?, ?, ?, ?, 'pending', 'low', 'jarvis', ?, ?, ?, '[]')`,
  ).run(
    approvalId,
    workflowId,
    ventureId,
    taskId,
    `audit:${label}`,
    `Audit approval ${label}`,
    timestamp,
    JSON.stringify({ label }),
    `scope-${label}`,
  );
  for (const [index, status] of attemptStatuses.entries()) {
    db.prepare(
      `INSERT INTO task_attempts
       (id, task_id, workflow_id, venture_id, claim_token, status, outcome_status,
        started_at, completed_at, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      `attempt_${label}_${index + 1}`,
      taskId,
      workflowId,
      ventureId,
      `claim-${label}-${index + 1}`,
      status,
      status === "running" ? "not_started" : "succeeded",
      timestamp,
      status === "running" ? null : timestamp,
      JSON.stringify({ label, index: index + 1 }),
    );
  }
}

function legacySentinelSnapshot(db, label) {
  return {
    setting: db.prepare(
      "SELECT key, value, updated_at FROM settings WHERE key = ?",
    ).get(`audit.${label}`),
    venture: db.prepare(
      `SELECT id, name, status, metadata, created_at, updated_at, is_active
       FROM ventures WHERE id = ?`,
    ).get(`venture_${label}`),
    workflow: db.prepare(
      `SELECT id, venture_id, type, title, status, metadata, created_at, updated_at
       FROM workflows WHERE id = ?`,
    ).get(`workflow_${label}`),
    task: db.prepare(
      `SELECT id, workflow_id, venture_id, title, kind, agent, status, payload,
              created_at, updated_at
       FROM tasks WHERE id = ?`,
    ).get(`task_${label}`),
    approval: db.prepare(
      `SELECT id, workflow_id, venture_id, task_id, scope, title, status, risk_level,
              requested_by, requested_at, payload, scope_hash, expected_effects
       FROM approvals WHERE id = ?`,
    ).get(`approval_${label}`),
    attempts: db.prepare(
      `SELECT id, task_id, workflow_id, venture_id, claim_token, status,
              outcome_status, started_at, completed_at, metadata
       FROM task_attempts WHERE task_id = ? ORDER BY id`,
    ).all(`task_${label}`),
  };
}

function prepareLegacySource(t, name, version, attemptStatuses) {
  const fixture = currentFixture(t, name);
  DOWNGRADE_BY_VERSION.get(version)(fixture.dbPath);
  const db = new DatabaseSync(fixture.dbPath);
  db.exec("PRAGMA foreign_keys = ON");
  insertLegacySentinelRows(db, name, attemptStatuses);
  const snapshot = legacySentinelSnapshot(db, name);
  const sourceSchemaDigest = schemaDigest(db);
  checkpointToDeleteAndClose(db);
  return { ...fixture, snapshot, sourceSchemaDigest };
}

test("recorded schema 27 rejects malformed persistent objects without changing the database", async (t) => {
  await t.test("missing immutable trigger", (subtest) => {
    rejectRecordedV27WithoutMutation(
      subtest,
      "missing-trigger",
      (db) => db.exec("DROP TRIGGER trg_preventure_research_decisions_immutable_update"),
      /missing required fail-closed trigger trg_preventure_research_decisions_immutable_update/i,
    );
  });

  for (const [name, sql] of [
    ["unexpected-table", "CREATE TABLE rogue_schema27_table (value TEXT)"],
    ["unexpected-view", "CREATE VIEW rogue_schema27_view AS SELECT id FROM ventures"],
  ]) {
    await t.test(name, (subtest) => {
      rejectRecordedV27WithoutMutation(
        subtest,
        name,
        (db) => db.exec(sql),
        /unsupported object\(s\).*rogue_schema27/i,
      );
    });
  }
});

test("schema verification preserves quoted trigger literals exactly", async (t) => {
  const triggerName = "trg_preventure_research_approval_pending_insert";
  for (const [name, mutate] of [
    [
      "literal-case",
      (sql) => sql.replaceAll(
        "pantheon.preventure-research-approval-scope.v1",
        "PANTHEON.PREVENTURE-RESEARCH-APPROVAL-SCOPE.V1",
      ),
    ],
    [
      "literal-whitespace",
      (sql) => sql.replace(
        "Pre-venture owner approvals must enter",
        "Pre-venture  owner approvals must enter",
      ),
    ],
  ]) {
    await t.test(name, (subtest) => {
      rejectRecordedV27WithoutMutation(
        subtest,
        name,
        (db) => {
          const canonical = db.prepare(
            "SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = ?",
          ).get(triggerName).sql;
          const changed = mutate(canonical);
          assert.notEqual(changed, canonical);
          db.exec(`DROP TRIGGER ${triggerName}`);
          db.exec(changed);
        },
        /does not match its exact pre-venture research definition/i,
      );
    });
  }
});

test("an unreleased schema-27 database cannot be relabelled as schema 26", (t) => {
  const fixture = currentFixture(t, "row27-deleted-spoof");
  const db = new DatabaseSync(fixture.dbPath);
  db.prepare("DELETE FROM schema_migrations WHERE version = 27").run();
  checkpointToDeleteAndClose(db);
  const before = fs.readFileSync(fixture.dbPath);

  assert.throws(
    () => openDatabase(fixture.dbPath, { clock: () => TEST_CLOCK }),
    /schema 26 contains unreleased schema-27 object\(s\)/i,
  );
  assert.deepEqual(fs.readFileSync(fixture.dbPath), before);
  assertNoSqliteSidecars(fixture.dbPath);

  const unchanged = new DatabaseSync(fixture.dbPath, { readOnly: true });
  try {
    assert.equal(unchanged.prepare("SELECT MAX(version) AS version FROM schema_migrations").get().version, 26);
    assert.ok(v27ArtifactRows(unchanged).length > 0);
    assert.equal(hasDecidedBy(unchanged), true);
  } finally {
    unchanged.close();
  }
});

test("schema-27 verification failure rolls a schema-26 upgrade back with all rows intact", (t) => {
  const fixture = prepareLegacySource(t, "wrong_history", 26, ["completed"]);
  let db = new DatabaseSync(fixture.dbPath);
  db.prepare(
    "UPDATE schema_migrations SET name = 'wrong-release-name' WHERE version = 26",
  ).run();
  const expectedRows = legacySentinelSnapshot(db, "wrong_history");
  const expectedSchemaDigest = schemaDigest(db);
  checkpointToDeleteAndClose(db);
  const before = fs.readFileSync(fixture.dbPath);

  assert.throws(
    () => openDatabase(fixture.dbPath, { clock: () => TEST_CLOCK }),
    /migration history does not match the exact supported release/i,
  );
  assert.deepEqual(fs.readFileSync(fixture.dbPath), before);
  assertNoSqliteSidecars(fixture.dbPath);

  db = new DatabaseSync(fixture.dbPath, { readOnly: true });
  try {
    assert.equal(db.prepare("SELECT MAX(version) AS version FROM schema_migrations").get().version, 26);
    assert.equal(db.prepare("SELECT name FROM schema_migrations WHERE version = 26").get().name, "wrong-release-name");
    assert.deepEqual(legacySentinelSnapshot(db, "wrong_history"), expectedRows);
    assert.equal(schemaDigest(db), expectedSchemaDigest);
    assert.deepEqual(v27ArtifactRows(db), []);
    assert.equal(hasDecidedBy(db), false);
  } finally {
    db.close();
  }
});

test("schema 24 and 26 upgrades retain pre-existing operational rows", async (t) => {
  for (const version of [24, 26]) {
    await t.test(`schema ${version}`, (subtest) => {
      const label = `successful_${version}`;
      const fixture = prepareLegacySource(subtest, label, version, ["completed"]);
      const db = openDatabase(fixture.dbPath, { clock: () => TEST_CLOCK });
      try {
        assert.equal(db.prepare("SELECT MAX(version) AS version FROM schema_migrations").get().version, LATEST_SCHEMA_VERSION);
        assert.deepEqual(legacySentinelSnapshot(db, label), fixture.snapshot);
        assert.equal(
          db.prepare("SELECT decided_by FROM approvals WHERE id = ?").get(`approval_${label}`).decided_by,
          null,
        );
        assert.ok(v27ArtifactRows(db).length > 0);
      } finally {
        db.close();
      }
    });
  }
});

test("late schema-27 index failure rolls schema 24 and 26 fully back", async (t) => {
  for (const version of [24, 26]) {
    await t.test(`schema ${version}`, (subtest) => {
      const label = `duplicate_running_${version}`;
      const fixture = prepareLegacySource(subtest, label, version, ["running", "running"]);

      assert.throws(
        () => openDatabase(fixture.dbPath, { clock: () => TEST_CLOCK }),
        /UNIQUE constraint failed: task_attempts\.task_id/i,
      );
      assertNoSqliteSidecars(fixture.dbPath);

      const db = new DatabaseSync(fixture.dbPath, { readOnly: true });
      try {
        assert.equal(db.prepare("SELECT MAX(version) AS version FROM schema_migrations").get().version, version);
        assert.deepEqual(legacySentinelSnapshot(db, label), fixture.snapshot);
        assert.equal(schemaDigest(db), fixture.sourceSchemaDigest);
        assert.deepEqual(v27ArtifactRows(db), []);
        assert.equal(hasDecidedBy(db), false);
        if (version === 24) {
          assert.equal(
            db.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE name = 'commercial_test_contracts'").get().count,
            0,
          );
        }
      } finally {
        db.close();
      }
    });
  }
});

test("a deferred foreign-key COMMIT failure does not mask the error or strand schema 27", (t) => {
  const fixture = currentFixture(t, "deferred-commit");
  downgradeDatabaseToLastReleasedSchema26(fixture.dbPath);
  const db = new DatabaseSync(fixture.dbPath);
  try {
    db.exec("PRAGMA foreign_keys = ON");
    db.prepare(
      "INSERT INTO settings (key, value, updated_at) VALUES ('audit.deferred', 'preserve-deferred', ?)",
    ).run("2026-07-01T00:00:00.000Z");
    db.exec(`
      CREATE TABLE audit_deferred_parent (id INTEGER PRIMARY KEY);
      CREATE TABLE audit_deferred_child (
        parent_id INTEGER NOT NULL,
        FOREIGN KEY (parent_id) REFERENCES audit_deferred_parent(id)
          DEFERRABLE INITIALLY DEFERRED
      );
      CREATE TRIGGER audit_force_deferred_commit_failure
      AFTER INSERT ON schema_migrations
      WHEN NEW.version = 27
      BEGIN
        INSERT INTO audit_deferred_child (parent_id) VALUES (999);
      END;
    `);

    assert.throws(
      () => applyPreventureResearchAuthorityMigration(db),
      /FOREIGN KEY constraint failed/i,
    );
    assert.equal(db.isTransaction, false);
    assert.equal(db.prepare("SELECT MAX(version) AS version FROM schema_migrations").get().version, 26);
    assert.equal(db.prepare("SELECT value FROM settings WHERE key = 'audit.deferred'").get().value, "preserve-deferred");
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM audit_deferred_child").get().count, 0);
    assert.deepEqual(v27ArtifactRows(db), []);
    assert.equal(hasDecidedBy(db), false);
  } finally {
    db.close();
  }
});

test("downgrade fixtures contain only their declared released schema", async (t) => {
  for (const version of [24, 25, 26]) {
    await t.test(`schema ${version}`, (subtest) => {
      const fixture = currentFixture(subtest, `fixture-authenticity-${version}`, { seed: true });
      DOWNGRADE_BY_VERSION.get(version)(fixture.dbPath);
      const db = new DatabaseSync(fixture.dbPath, { readOnly: true });
      try {
        const migrations = db.prepare(
          "SELECT version, name FROM schema_migrations ORDER BY version",
        ).all();
        assert.deepEqual(
          migrations.map((migration) => migration.version),
          Array.from({ length: version }, (_, index) => index + 1),
        );
        assert.equal(migrations.at(-1).version, version);
        assert.equal(
          migrations.find((migration) => migration.version === 24).name,
          "model-call-completion-truth",
        );
        if (version >= 25) {
          assert.equal(
            migrations.find((migration) => migration.version === 25).name,
            "commercial-test-contract-evidence-ledger",
          );
        }
        if (version >= 26) {
          assert.equal(
            migrations.find((migration) => migration.version === 26).name,
            "canonical-commercial-truth-reconciliation",
          );
        }
        assert.deepEqual(v27ArtifactRows(db), []);
        assert.equal(hasDecidedBy(db), false);
        const initialized = JSON.parse(
          db.prepare("SELECT value FROM settings WHERE key = 'runtime.initialized'").get().value,
        );
        assert.equal(initialized.version, version);
        const ownerTriggers = db.prepare(
          `SELECT name, sql FROM sqlite_master
           WHERE type = 'trigger' AND name IN (${OWNER_TRIGGER_NAMES.map(() => "?").join(", ")})
           ORDER BY name`,
        ).all(...OWNER_TRIGGER_NAMES);
        assert.equal(ownerTriggers.length, OWNER_TRIGGER_NAMES.length);
        for (const trigger of ownerTriggers) assert.doesNotMatch(trigger.sql, /preventure/i);
      } finally {
        db.close();
      }
    });
  }
});
