const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");
const CONFIG = require("./config");

const LATEST_SCHEMA_VERSION = 11;

function now() {
  return new Date().toISOString();
}

function toJson(value) {
  return JSON.stringify(value ?? {});
}

function fromJson(value, fallback = {}) {
  if (value === null || value === undefined || value === "") return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function prepareArgs(params) {
  if (Array.isArray(params)) return params;
  if (params && typeof params === "object") return [params];
  return [];
}

function run(db, sql, params = []) {
  return db.prepare(sql).run(...prepareArgs(params));
}

function get(db, sql, params = []) {
  return db.prepare(sql).get(...prepareArgs(params));
}

function all(db, sql, params = []) {
  return db.prepare(sql).all(...prepareArgs(params));
}

function openDatabase(dbPath = CONFIG.dbPath) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA busy_timeout = 5000;");
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  try {
    migrate(db);
    verifyDatabase(db);
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

function verifyDatabase(db) {
  const quickCheck = get(db, "PRAGMA quick_check");
  if (!quickCheck || Object.values(quickCheck)[0] !== "ok") {
    throw new Error(`SQLite quick check failed: ${JSON.stringify(quickCheck || {})}`);
  }
  const foreignKeyFailures = all(db, "PRAGMA foreign_key_check");
  if (foreignKeyFailures.length) {
    throw new Error(`SQLite foreign-key check failed with ${foreignKeyFailures.length} violation(s).`);
  }
  const current = Number(get(db, "SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations")?.version || 0);
  if (current !== LATEST_SCHEMA_VERSION) {
    throw new Error(`Runtime schema ${current} does not match supported schema ${LATEST_SCHEMA_VERSION}.`);
  }
  return { quickCheck: "ok", foreignKeyFailures: 0, schemaVersion: current };
}

function migrationApplied(db, version) {
  return Boolean(get(db, "SELECT version FROM schema_migrations WHERE version = ?", [version]));
}

function recordMigration(db, version, name) {
  run(
    db,
    "INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)",
    [version, name, now()],
  );
}

function tableColumns(db, tableName) {
  return new Set(all(db, `PRAGMA table_info(${tableName})`).map((column) => column.name));
}

function addColumn(db, tableName, definition) {
  const columnName = definition.trim().split(/\s+/)[0];
  if (!tableColumns(db, tableName).has(columnName)) {
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${definition}`);
  }
}

function applyFoundationMigration(db) {
  if (migrationApplied(db, 2)) return;
  db.exec("BEGIN IMMEDIATE");
  try {
    addColumn(db, "ventures", "lifecycle_stage TEXT NOT NULL DEFAULT 'candidate'");
    addColumn(db, "ventures", "is_active INTEGER NOT NULL DEFAULT 0");
    addColumn(db, "ventures", "business_model TEXT NOT NULL DEFAULT 'digital_product'");
    addColumn(db, "commands", "venture_id TEXT");
    addColumn(db, "tasks", "venture_id TEXT");
    addColumn(db, "tasks", "claim_token TEXT");
    addColumn(db, "tasks", "claimed_at TEXT");
    addColumn(db, "tasks", "attempt_count INTEGER NOT NULL DEFAULT 0");
    addColumn(db, "tasks", "outcome_status TEXT NOT NULL DEFAULT 'not_started'");
    addColumn(db, "tasks", "setup_block_reason TEXT");
    addColumn(db, "approvals", "venture_id TEXT");
    addColumn(db, "approvals", "task_id TEXT");
    addColumn(db, "approvals", "scope_hash TEXT");
    addColumn(db, "approvals", "expires_at TEXT");
    addColumn(db, "approvals", "consumed_at TEXT");
    addColumn(db, "approvals", "expected_effects TEXT NOT NULL DEFAULT '[]'");
    addColumn(db, "deliverables", "venture_id TEXT");
    addColumn(db, "deliverables", "artifact_key TEXT");
    addColumn(db, "deliverables", "content_hash TEXT");
    addColumn(db, "deliverables", "version INTEGER NOT NULL DEFAULT 1");
    addColumn(db, "model_calls", "venture_id TEXT");
    addColumn(db, "model_calls", "provider_request_id TEXT");
    addColumn(db, "model_calls", "cost_status TEXT NOT NULL DEFAULT 'none'");
    addColumn(db, "model_calls", "reserved_cost_cents INTEGER NOT NULL DEFAULT 0");
    addColumn(db, "model_calls", "incurred_estimate_cents INTEGER NOT NULL DEFAULT 0");
    addColumn(db, "model_calls", "reconciled_cost_cents INTEGER NOT NULL DEFAULT 0");
    addColumn(db, "model_calls", "outcome_status TEXT NOT NULL DEFAULT 'not_started'");
    addColumn(db, "model_calls", "error_kind TEXT");
    addColumn(db, "research_runs", "venture_id TEXT");
    addColumn(db, "monitor_findings", "fingerprint TEXT");
    addColumn(db, "monitor_findings", "first_seen TEXT");
    addColumn(db, "monitor_findings", "last_seen TEXT");
    addColumn(db, "monitor_findings", "occurrence_count INTEGER NOT NULL DEFAULT 1");
    addColumn(db, "monitor_findings", "resolved_at TEXT");
    addColumn(db, "costs", "venture_id TEXT");
    addColumn(db, "commercial_results", "venture_id TEXT");
    addColumn(db, "commercial_results", "platform_fee_cents INTEGER NOT NULL DEFAULT 0");
    addColumn(db, "commercial_results", "product_cost_cents INTEGER NOT NULL DEFAULT 0");
    addColumn(db, "commercial_results", "tool_cost_cents INTEGER NOT NULL DEFAULT 0");
    addColumn(db, "commercial_results", "verified INTEGER NOT NULL DEFAULT 0");
    addColumn(db, "messages", "venture_id TEXT");
    addColumn(db, "agent_runs", "venture_id TEXT");

    db.exec(`
      CREATE TABLE IF NOT EXISTS task_attempts (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        workflow_id TEXT,
        venture_id TEXT,
        claim_token TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL,
        outcome_status TEXT NOT NULL DEFAULT 'not_started',
        provider_request_id TEXT,
        error_kind TEXT,
        error TEXT,
        started_at TEXT NOT NULL,
        completed_at TEXT,
        metadata TEXT NOT NULL DEFAULT '{}',
        FOREIGN KEY (task_id) REFERENCES tasks(id)
      );

      CREATE TABLE IF NOT EXISTS budget_reservations (
        id TEXT PRIMARY KEY,
        venture_id TEXT,
        workflow_id TEXT,
        task_id TEXT NOT NULL,
        approval_id TEXT,
        status TEXT NOT NULL,
        amount_cents INTEGER NOT NULL,
        currency TEXT NOT NULL DEFAULT 'AUD',
        reserved_at TEXT NOT NULL,
        resolved_at TEXT,
        metadata TEXT NOT NULL DEFAULT '{}',
        FOREIGN KEY (task_id) REFERENCES tasks(id)
      );

      CREATE TABLE IF NOT EXISTS deliverable_sections (
        id TEXT PRIMARY KEY,
        deliverable_id TEXT NOT NULL,
        task_id TEXT NOT NULL,
        sequence INTEGER NOT NULL DEFAULT 0,
        content TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(deliverable_id, task_id),
        FOREIGN KEY (deliverable_id) REFERENCES deliverables(id),
        FOREIGN KEY (task_id) REFERENCES tasks(id)
      );

      CREATE TABLE IF NOT EXISTS venture_cases (
        id TEXT PRIMARY KEY,
        venture_id TEXT NOT NULL UNIQUE,
        buyer TEXT NOT NULL DEFAULT '',
        problem TEXT NOT NULL DEFAULT '',
        offer TEXT NOT NULL DEFAULT '',
        price_cents INTEGER NOT NULL DEFAULT 0,
        channel TEXT NOT NULL DEFAULT '',
        evidence_standard TEXT NOT NULL DEFAULT '',
        contribution_assumption_cents INTEGER NOT NULL DEFAULT 0,
        active_experiment_id TEXT,
        deadline TEXT,
        expected_metric TEXT NOT NULL DEFAULT '',
        kill_rule TEXT NOT NULL DEFAULT '',
        next_money_move TEXT NOT NULL DEFAULT '',
        operator_decision TEXT NOT NULL DEFAULT '',
        latest_learning TEXT NOT NULL DEFAULT '',
        metadata TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (venture_id) REFERENCES ventures(id)
      );

      CREATE TABLE IF NOT EXISTS commercial_evidence (
        id TEXT PRIMARY KEY,
        venture_id TEXT NOT NULL,
        experiment_id TEXT,
        source_type TEXT NOT NULL,
        source_id TEXT,
        source_url TEXT,
        title TEXT NOT NULL,
        summary TEXT NOT NULL DEFAULT '',
        captured_at TEXT NOT NULL,
        verified_at TEXT,
        is_demo INTEGER NOT NULL DEFAULT 0,
        metadata TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        FOREIGN KEY (venture_id) REFERENCES ventures(id),
        FOREIGN KEY (experiment_id) REFERENCES commercial_experiments(id)
      );

      CREATE TABLE IF NOT EXISTS work_packages (
        id TEXT PRIMARY KEY,
        venture_id TEXT NOT NULL,
        workflow_id TEXT,
        experiment_id TEXT,
        kind TEXT NOT NULL,
        title TEXT NOT NULL,
        status TEXT NOT NULL,
        owner_group TEXT NOT NULL,
        decision_needed TEXT NOT NULL DEFAULT '',
        artifact_id TEXT,
        metadata TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (venture_id) REFERENCES ventures(id)
      );

      CREATE TABLE IF NOT EXISTS capability_autonomy (
        id TEXT PRIMARY KEY,
        capability_key TEXT NOT NULL UNIQUE,
        agent_id TEXT,
        risk_tier INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'supervised',
        consecutive_passes INTEGER NOT NULL DEFAULT 0,
        required_passes INTEGER NOT NULL DEFAULT 5,
        max_cost_cents INTEGER NOT NULL DEFAULT 0,
        promoted_at TEXT,
        suspended_at TEXT,
        last_review_at TEXT,
        metadata TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (agent_id) REFERENCES agent_definitions(id)
      );

      CREATE TABLE IF NOT EXISTS platform_sales (
        id TEXT PRIMARY KEY,
        venture_id TEXT NOT NULL,
        platform TEXT NOT NULL,
        platform_purchase_id TEXT NOT NULL,
        product_name TEXT NOT NULL,
        sold_at TEXT NOT NULL,
        currency TEXT NOT NULL,
        gross_cents INTEGER NOT NULL DEFAULT 0,
        platform_fee_cents INTEGER NOT NULL DEFAULT 0,
        net_cents INTEGER NOT NULL DEFAULT 0,
        refunded_cents INTEGER NOT NULL DEFAULT 0,
        referrer TEXT NOT NULL DEFAULT '',
        buyer_hash TEXT,
        status TEXT NOT NULL DEFAULT 'paid',
        metadata TEXT NOT NULL DEFAULT '{}',
        imported_at TEXT NOT NULL,
        UNIQUE(platform, platform_purchase_id),
        FOREIGN KEY (venture_id) REFERENCES ventures(id)
      );

      CREATE TABLE IF NOT EXISTS agent_pilot_fixtures (
        id TEXT PRIMARY KEY,
        venture_id TEXT NOT NULL,
        candidate_id TEXT,
        captured_at TEXT NOT NULL,
        question TEXT NOT NULL,
        buyer TEXT NOT NULL,
        hypothesis TEXT NOT NULL,
        sources TEXT NOT NULL DEFAULT '[]',
        constraints TEXT NOT NULL DEFAULT '{}',
        fixture_hash TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL DEFAULT 'ready',
        created_at TEXT NOT NULL,
        FOREIGN KEY (venture_id) REFERENCES ventures(id)
      );

      CREATE TABLE IF NOT EXISTS agent_pilot_reviews (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL UNIQUE,
        fixture_id TEXT NOT NULL,
        capability_key TEXT NOT NULL,
        deterministic_status TEXT NOT NULL,
        operator_verdict TEXT NOT NULL DEFAULT 'pending',
        usefulness_score INTEGER,
        note TEXT NOT NULL DEFAULT '',
        criteria TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        reviewed_at TEXT,
        FOREIGN KEY (run_id) REFERENCES agent_runs(id),
        FOREIGN KEY (fixture_id) REFERENCES agent_pilot_fixtures(id)
      );

      CREATE INDEX IF NOT EXISTS idx_tasks_runnable ON tasks(status, priority, created_at);
      CREATE INDEX IF NOT EXISTS idx_tasks_venture ON tasks(venture_id, status);
      CREATE INDEX IF NOT EXISTS idx_task_attempts_task ON task_attempts(task_id, started_at);
      CREATE INDEX IF NOT EXISTS idx_workflows_venture ON workflows(venture_id, status);
      CREATE INDEX IF NOT EXISTS idx_approvals_pending ON approvals(status, expires_at);
      CREATE INDEX IF NOT EXISTS idx_deliverables_workflow ON deliverables(workflow_id, updated_at);
      CREATE INDEX IF NOT EXISTS idx_events_recent ON events(ts DESC);
      CREATE INDEX IF NOT EXISTS idx_evidence_venture ON commercial_evidence(venture_id, captured_at);
      CREATE INDEX IF NOT EXISTS idx_sales_venture ON platform_sales(venture_id, sold_at);
      CREATE INDEX IF NOT EXISTS idx_work_packages_venture ON work_packages(venture_id, status);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_monitor_fingerprint ON monitor_findings(fingerprint) WHERE fingerprint IS NOT NULL;
    `);

    run(db, "UPDATE ventures SET lifecycle_stage = 'validating', is_active = CASE WHEN id = 'venture-digital-products' THEN 1 ELSE 0 END, business_model = 'digital_product'");
    run(db, "UPDATE workflows SET venture_id = 'venture-digital-products' WHERE venture_id IS NULL");
    for (const table of ["commands", "tasks", "approvals", "deliverables", "model_calls", "research_runs", "costs", "commercial_results", "agent_runs"]) {
      run(
        db,
        `UPDATE ${table} SET venture_id = COALESCE(venture_id, (SELECT venture_id FROM workflows WHERE workflows.id = ${table}.workflow_id), 'venture-digital-products') WHERE venture_id IS NULL`,
      );
    }
    run(db, "UPDATE messages SET venture_id = COALESCE((SELECT venture_id FROM tasks WHERE tasks.id = messages.task_id), 'venture-digital-products') WHERE venture_id IS NULL");
    recordMigration(db, 2, "foundation-truth-and-commercial-model");
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function applyPilotEvidenceMigration(db) {
  if (migrationApplied(db, 3)) return;
  db.exec("BEGIN IMMEDIATE");
  try {
    addColumn(db, "agent_pilot_fixtures", "fixture_version INTEGER NOT NULL DEFAULT 1");
    addColumn(db, "agent_pilot_fixtures", "baseline_output TEXT NOT NULL DEFAULT '{}'");
    addColumn(db, "agent_pilot_fixtures", "baseline_hash TEXT");
    addColumn(db, "agent_pilot_reviews", "output_hash TEXT");
    addColumn(db, "agent_pilot_reviews", "provider TEXT NOT NULL DEFAULT 'openai-agents-sdk'");
    addColumn(db, "agent_pilot_reviews", "estimated_cost_cents INTEGER NOT NULL DEFAULT 0");
    addColumn(db, "agent_pilot_reviews", "incurred_estimate_cents INTEGER NOT NULL DEFAULT 0");
    addColumn(db, "agent_pilot_reviews", "reconciled_cost_cents INTEGER NOT NULL DEFAULT 0");
    addColumn(db, "agent_pilot_reviews", "trace_id TEXT");
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_pilot_fixtures_status
        ON agent_pilot_fixtures(venture_id, status, captured_at);
      CREATE INDEX IF NOT EXISTS idx_pilot_reviews_capability
        ON agent_pilot_reviews(capability_key, created_at);
    `);
    recordMigration(db, 3, "agents-sdk-pilot-evidence-ledger");
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function applyVentureOwnershipMigration(db) {
  if (migrationApplied(db, 4)) return;
  db.exec("BEGIN IMMEDIATE");
  try {
    addColumn(db, "workflow_runs", "venture_id TEXT");
    addColumn(db, "events", "venture_id TEXT");
    addColumn(db, "monitor_findings", "venture_id TEXT");

    const activeVenture = `COALESCE(
      (SELECT id FROM ventures WHERE is_active = 1 ORDER BY created_at ASC LIMIT 1),
      (SELECT id FROM ventures ORDER BY created_at ASC LIMIT 1)
    )`;
    run(db, `UPDATE workflows SET venture_id = ${activeVenture} WHERE venture_id IS NULL`);

    const workflowOwned = [
      "commands",
      "tasks",
      "approvals",
      "deliverables",
      "model_calls",
      "research_runs",
      "costs",
      "commercial_results",
      "agent_runs",
      "workflow_runs",
      "task_attempts",
      "budget_reservations",
      "commercial_experiments",
      "commercial_briefs",
      "commercial_test_candidates",
      "commercial_execution_packs",
      "venture_scorecards",
    ];
    for (const table of workflowOwned) {
      run(
        db,
        `UPDATE ${table}
         SET venture_id = COALESCE(
           (SELECT venture_id FROM workflows WHERE workflows.id = ${table}.workflow_id),
           ${activeVenture}
         )
         WHERE venture_id IS NULL`,
      );
      db.exec(`
        CREATE TRIGGER IF NOT EXISTS trg_${table}_venture_owner
        AFTER INSERT ON ${table}
        FOR EACH ROW WHEN NEW.venture_id IS NULL
        BEGIN
          UPDATE ${table}
          SET venture_id = COALESCE(
            (SELECT venture_id FROM workflows WHERE workflows.id = NEW.workflow_id),
            ${activeVenture}
          )
          WHERE id = NEW.id;
        END;
      `);
    }

    run(
      db,
      `UPDATE messages
       SET venture_id = COALESCE(
         (SELECT venture_id FROM tasks WHERE tasks.id = messages.task_id),
         ${activeVenture}
       )
       WHERE venture_id IS NULL`,
    );
    db.exec(`
      CREATE TRIGGER IF NOT EXISTS trg_messages_venture_owner
      AFTER INSERT ON messages
      FOR EACH ROW WHEN NEW.venture_id IS NULL
      BEGIN
        UPDATE messages
        SET venture_id = COALESCE(
          (SELECT venture_id FROM tasks WHERE tasks.id = NEW.task_id),
          ${activeVenture}
        )
        WHERE id = NEW.id;
      END;

      CREATE TRIGGER IF NOT EXISTS trg_workflows_venture_owner
      AFTER INSERT ON workflows
      FOR EACH ROW WHEN NEW.venture_id IS NULL
      BEGIN
        UPDATE workflows SET venture_id = ${activeVenture} WHERE id = NEW.id;
      END;

      CREATE TRIGGER IF NOT EXISTS trg_events_venture_owner
      AFTER INSERT ON events
      FOR EACH ROW WHEN NEW.venture_id IS NULL
      BEGIN
        UPDATE events SET venture_id = ${activeVenture} WHERE id = NEW.id;
      END;

      CREATE TRIGGER IF NOT EXISTS trg_monitor_findings_venture_owner
      AFTER INSERT ON monitor_findings
      FOR EACH ROW WHEN NEW.venture_id IS NULL
      BEGIN
        UPDATE monitor_findings SET venture_id = ${activeVenture} WHERE id = NEW.id;
      END;
    `);
    run(db, `UPDATE events SET venture_id = ${activeVenture} WHERE venture_id IS NULL`);
    run(db, `UPDATE monitor_findings SET venture_id = ${activeVenture} WHERE venture_id IS NULL`);

    recordMigration(db, 4, "venture-ownership-backstops");
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function applyExecutiveDigestMigration(db) {
  if (migrationApplied(db, 5)) return;
  db.exec("BEGIN IMMEDIATE");
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS executive_digests (
        id TEXT PRIMARY KEY,
        venture_id TEXT NOT NULL,
        period_start TEXT NOT NULL,
        period_end TEXT NOT NULL,
        status TEXT NOT NULL,
        title TEXT NOT NULL,
        summary TEXT NOT NULL,
        metrics TEXT NOT NULL DEFAULT '{}',
        decisions TEXT NOT NULL DEFAULT '[]',
        learning TEXT NOT NULL DEFAULT '[]',
        next_actions TEXT NOT NULL DEFAULT '[]',
        generated_at TEXT NOT NULL,
        UNIQUE(venture_id, period_start),
        FOREIGN KEY (venture_id) REFERENCES ventures(id)
      );
      CREATE INDEX IF NOT EXISTS idx_executive_digests_recent
        ON executive_digests(venture_id, period_end DESC);
    `);
    recordMigration(db, 5, "weekly-executive-digest");
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function applyLegacyDemoSanitizationMigration(db) {
  if (migrationApplied(db, 6)) return;
  db.exec("BEGIN IMMEDIATE");
  try {
    const ts = now();
    db.exec(`
      CREATE TEMP TABLE migration6_stale_approvals (
        id TEXT PRIMARY KEY,
        workflow_id TEXT
      );
    `);
    run(
      db,
      `INSERT INTO migration6_stale_approvals (id, workflow_id)
       SELECT approvals.id, approvals.workflow_id
       FROM approvals
       WHERE approvals.scope IN ('live_ai_worker_spend', 'live_research_spend')
         AND approvals.status IN ('pending', 'approved')
         AND NOT EXISTS (
           SELECT 1 FROM model_calls
           WHERE model_calls.workflow_id = approvals.workflow_id
             AND model_calls.mode = 'live'
             AND model_calls.status IN ('completed', 'succeeded')
         )
         AND NOT EXISTS (
           SELECT 1 FROM research_runs
           WHERE research_runs.workflow_id = approvals.workflow_id
             AND research_runs.mode = 'live'
             AND research_runs.status IN ('completed', 'succeeded')
         )
         AND NOT EXISTS (
           SELECT 1 FROM costs
           WHERE costs.workflow_id = approvals.workflow_id
             AND costs.amount_cents > 0
             AND costs.status IN ('incurred', 'incurred_estimate', 'reconciled', 'paid')
         )`,
    );

    run(
      db,
      `UPDATE commercial_experiments
       SET status = 'cancelled',
           started_at = NULL,
           ended_at = COALESCE(ended_at, ?),
           metadata = json_set(
             CASE WHEN json_valid(metadata) THEN metadata ELSE '{}' END,
             '$.archivedReason', 'Pre-foundation protected or demo state; no verified real-world start.',
             '$.realStartConfirmed', json('false')
           ),
           updated_at = ?
       WHERE (
         COALESCE(json_extract(CASE WHEN json_valid(metadata) THEN metadata ELSE '{}' END, '$.dryRunOnly'), 0) = 1
         OR (
           status = 'running'
           AND COALESCE(json_extract(CASE WHEN json_valid(metadata) THEN metadata ELSE '{}' END, '$.realStartConfirmed'), 0) <> 1
           AND NOT EXISTS (
             SELECT 1 FROM commercial_results
             WHERE commercial_results.experiment_id = commercial_experiments.id
               AND commercial_results.verified = 1
           )
         )
         OR (
           status NOT IN ('candidate', 'ready', 'running', 'completed', 'cancelled')
           AND NOT EXISTS (
             SELECT 1 FROM commercial_results
             WHERE commercial_results.experiment_id = commercial_experiments.id
               AND commercial_results.verified = 1
           )
         )
       )`,
      [ts, ts],
    );

    run(
      db,
      `UPDATE messages
       SET status = 'resolved', resolved_at = COALESCE(resolved_at, ?)
       WHERE status = 'open'
         AND task_id IN (
           SELECT tasks.id FROM tasks
           WHERE tasks.approval_id IN (SELECT id FROM migration6_stale_approvals)
              OR tasks.workflow_id IN (
                SELECT workflow_id FROM migration6_stale_approvals WHERE workflow_id IS NOT NULL
              )
         )`,
      [ts],
    );
    run(
      db,
      `UPDATE tasks
       SET status = 'cancelled', outcome_status = 'cancelled',
           setup_block_reason = NULL, claim_token = NULL, claimed_at = NULL,
           completed_at = COALESCE(completed_at, ?), updated_at = ?
       WHERE status NOT IN ('completed', 'cancelled')
         AND (
           approval_id IN (SELECT id FROM migration6_stale_approvals)
           OR workflow_id IN (
             SELECT workflow_id FROM migration6_stale_approvals WHERE workflow_id IS NOT NULL
           )
         )`,
      [ts, ts],
    );
    run(
      db,
      `UPDATE workflows
       SET status = 'cancelled',
           current_step = 'Archived protected setup work; create a fresh scoped request when intentionally connecting a provider.',
           updated_at = ?
       WHERE status NOT IN ('completed', 'cancelled')
         AND id IN (
           SELECT workflow_id FROM migration6_stale_approvals WHERE workflow_id IS NOT NULL
         )`,
      [ts],
    );
    run(
      db,
      `UPDATE approvals
       SET status = 'superseded', decided_at = COALESCE(decided_at, ?),
           decision_note = 'Superseded by the foundation reset because no live provider outcome or spend was recorded.'
       WHERE id IN (SELECT id FROM migration6_stale_approvals)`,
      [ts],
    );
    db.exec("DROP TABLE migration6_stale_approvals");
    recordMigration(db, 6, "archive-unverified-legacy-demo-state");
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function applyLegacyReviewQueueMigration(db) {
  if (migrationApplied(db, 7)) return;
  db.exec("BEGIN IMMEDIATE");
  try {
    const ts = now();
    const legacyCutoff = "2026-07-14T00:00:00.000Z";
    run(
      db,
      `UPDATE agent_handoffs
       SET status = 'archived', resolved_at = COALESCE(resolved_at, ?),
           metadata = json_set(
             CASE WHEN json_valid(metadata) THEN metadata ELSE '{}' END,
             '$.archivedReason', 'Historical protected rehearsal; retained outside the current decision queue.'
           ),
           updated_at = ?
       WHERE status IN ('needs_operator_decision', 'waiting_for_review', 'waiting_approval')
         AND created_at < ?
         AND (
           workflow_id IN (
             SELECT id FROM workflows
             WHERE status = 'cancelled'
                OR COALESCE(
                  json_extract(CASE WHEN json_valid(metadata) THEN metadata ELSE '{}' END, '$.agentRunner.mode'),
                  ''
                ) IN ('dry-run', 'protected')
           )
           OR json_extract(
             CASE WHEN json_valid(agent_handoffs.metadata) THEN agent_handoffs.metadata ELSE '{}' END,
             '$.experimentId'
           ) IN (SELECT id FROM commercial_experiments WHERE status = 'cancelled')
         )`,
      [ts, ts, legacyCutoff],
    );
    run(
      db,
      `UPDATE deliverables
       SET status = 'archived',
           metadata = json_set(
             CASE WHEN json_valid(metadata) THEN metadata ELSE '{}' END,
             '$.archivedReason', 'Historical protected or fixture output; available from System history.'
           ),
           updated_at = ?
       WHERE status = 'ready_for_review'
         AND created_at < ?
         AND (
           workflow_id IN (
             SELECT id FROM workflows
             WHERE status = 'cancelled'
                OR COALESCE(
                  json_extract(CASE WHEN json_valid(metadata) THEN metadata ELSE '{}' END, '$.agentRunner.mode'),
                  ''
                ) IN ('dry-run', 'protected')
           )
           OR COALESCE(
             json_extract(CASE WHEN json_valid(deliverables.metadata) THEN deliverables.metadata ELSE '{}' END, '$.source'),
             ''
           ) = 'agent_workbench'
           OR COALESCE(
             json_extract(CASE WHEN json_valid(deliverables.metadata) THEN deliverables.metadata ELSE '{}' END, '$.proofMode'),
             ''
           ) LIKE 'dry-run%'
         )`,
      [ts, legacyCutoff],
    );
    recordMigration(db, 7, "archive-legacy-review-queue-clutter");
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function applyLegacyNotificationCleanupMigration(db) {
  if (migrationApplied(db, 8)) return;
  db.exec("BEGIN IMMEDIATE");
  try {
    const ts = now();
    const legacyCutoff = "2026-07-14T00:00:00.000Z";
    run(
      db,
      `UPDATE deliverables
       SET status = 'archived',
           metadata = json_set(
             CASE WHEN json_valid(metadata) THEN metadata ELSE '{}' END,
             '$.archivedReason', 'Historical dry-run proof; available from System history.'
           ),
           updated_at = ?
       WHERE status = 'ready_for_review'
         AND created_at < ?
         AND workflow_id IN (
           SELECT id FROM workflows
           WHERE COALESCE(
             json_extract(CASE WHEN json_valid(metadata) THEN metadata ELSE '{}' END, '$.proofMode'),
             ''
           ) LIKE 'dry-run%'
         )`,
      [ts, legacyCutoff],
    );
    run(
      db,
      `UPDATE messages
       SET status = 'resolved', resolved_at = COALESCE(resolved_at, ?)
       WHERE status = 'open'
         AND created_at < ?
         AND subject LIKE '% workflow planned'
         AND body LIKE '%Live model/tool execution is still locked%'`,
      [ts, legacyCutoff],
    );
    recordMigration(db, 8, "archive-legacy-proof-notifications");
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function applyHistoricalWorkArchiveMigration(db) {
  if (migrationApplied(db, 9)) return;
  db.exec("BEGIN IMMEDIATE");
  try {
    const ts = now();
    const legacyCutoff = "2026-07-14T00:00:00.000Z";
    db.exec(`
      CREATE TEMP TABLE migration9_historical_workflows (
        id TEXT PRIMARY KEY
      );
    `);
    run(
      db,
      `INSERT INTO migration9_historical_workflows (id)
       SELECT workflows.id
       FROM workflows
       WHERE workflows.created_at < ?
         AND workflows.status IN ('cancelled', 'completed', 'dry_run_complete', 'ready_for_review')
         AND NOT EXISTS (
           SELECT 1 FROM commercial_results
           WHERE commercial_results.workflow_id = workflows.id
             AND commercial_results.verified = 1
         )
         AND NOT EXISTS (
           SELECT 1 FROM model_calls
           WHERE model_calls.workflow_id = workflows.id
             AND model_calls.mode = 'live'
             AND model_calls.status IN ('completed', 'succeeded')
         )
         AND NOT EXISTS (
           SELECT 1 FROM research_runs
           WHERE research_runs.workflow_id = workflows.id
             AND research_runs.mode = 'live'
             AND research_runs.status IN ('completed', 'succeeded')
         )`,
      [legacyCutoff],
    );
    run(
      db,
      `UPDATE deliverables
       SET status = 'archived',
           file_path = CASE
             WHEN file_path LIKE 'deliverables/%'
             THEN 'archive/historical/local-artifacts/legacy-generated-deliverables-pre-foundation/'
                  || substr(file_path, length('deliverables/') + 1)
             ELSE file_path
           END,
           metadata = json_set(
             CASE WHEN json_valid(metadata) THEN metadata ELSE '{}' END,
             '$.archivedReason', 'Historical pre-foundation work; retained in System history.'
           ),
           updated_at = ?
       WHERE workflow_id IN (SELECT id FROM migration9_historical_workflows)`,
      [ts],
    );
    run(
      db,
      `UPDATE approvals
       SET status = 'superseded', decided_at = COALESCE(decided_at, ?),
           decision_note = COALESCE(
             NULLIF(decision_note, ''),
             'Historical pre-foundation decision; create a fresh scoped request if work resumes.'
           )
       WHERE status IN ('pending', 'approved')
         AND workflow_id IN (SELECT id FROM migration9_historical_workflows)`,
      [ts],
    );
    run(
      db,
      `UPDATE tasks
       SET status = 'cancelled', outcome_status = 'cancelled',
           claim_token = NULL, claimed_at = NULL,
           completed_at = COALESCE(completed_at, ?), updated_at = ?
       WHERE status NOT IN ('completed', 'cancelled')
         AND workflow_id IN (SELECT id FROM migration9_historical_workflows)`,
      [ts, ts],
    );
    run(
      db,
      `UPDATE messages
       SET status = 'resolved', resolved_at = COALESCE(resolved_at, ?)
       WHERE status = 'open'
         AND task_id IN (
           SELECT id FROM tasks
           WHERE workflow_id IN (SELECT id FROM migration9_historical_workflows)
         )`,
      [ts],
    );
    run(
      db,
      `UPDATE workflows
       SET status = 'archived',
           current_step = 'Historical pre-foundation work; retained in System history.',
           updated_at = ?
       WHERE id IN (SELECT id FROM migration9_historical_workflows)`,
      [ts],
    );
    db.exec("DROP TABLE migration9_historical_workflows");
    recordMigration(db, 9, "archive-historical-work-and-output-paths");
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function applyAccountingLedgerMigration(db) {
  if (migrationApplied(db, 10)) return;
  db.exec("BEGIN IMMEDIATE");
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS accounting_entries (
        id TEXT PRIMARY KEY,
        venture_id TEXT,
        entry_type TEXT NOT NULL,
        category TEXT NOT NULL,
        source TEXT NOT NULL,
        description TEXT NOT NULL,
        status TEXT NOT NULL,
        amount_cents INTEGER NOT NULL CHECK(amount_cents >= 0),
        currency TEXT NOT NULL DEFAULT 'AUD' CHECK(currency = 'AUD'),
        occurred_at TEXT NOT NULL,
        next_due_at TEXT,
        metadata TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (venture_id) REFERENCES ventures(id)
      );

      CREATE INDEX IF NOT EXISTS idx_accounting_entries_occurred
        ON accounting_entries(occurred_at DESC);
      CREATE INDEX IF NOT EXISTS idx_accounting_entries_type_status
        ON accounting_entries(entry_type, status);
    `);
    recordMigration(db, 10, "aud-accounting-ledger");
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function applyCommercialDataTruthMigration(db) {
  if (migrationApplied(db, 11)) return;
  db.exec("BEGIN IMMEDIATE");
  try {
    addColumn(db, "costs", "run_id TEXT");
    addColumn(db, "costs", "task_id TEXT");
    addColumn(db, "costs", "model_call_id TEXT");
    addColumn(db, "commercial_results", "currency TEXT NOT NULL DEFAULT 'AUD' CHECK(currency = 'AUD')");
    addColumn(db, "commercial_results", "verified_at TEXT");
    addColumn(db, "commercial_results", "verification_evidence_id TEXT");
    addColumn(db, "commercial_feedback", "venture_id TEXT");
    addColumn(db, "commercial_feedback", "verified INTEGER NOT NULL DEFAULT 0");
    addColumn(db, "commercial_feedback", "verified_at TEXT");
    addColumn(db, "commercial_feedback", "verification_evidence_id TEXT");
    addColumn(db, "platform_sales", "aud_gross_cents INTEGER");
    addColumn(db, "platform_sales", "aud_platform_fee_cents INTEGER");
    addColumn(db, "platform_sales", "aud_net_cents INTEGER");
    addColumn(db, "platform_sales", "aud_refunded_cents INTEGER");
    addColumn(db, "platform_sales", "aud_conversion_rate REAL");
    addColumn(db, "platform_sales", "aud_conversion_evidence TEXT");
    addColumn(db, "platform_sales", "aud_conversion_at TEXT");
    addColumn(db, "accounting_entries", "effect_sign INTEGER NOT NULL DEFAULT 1 CHECK(effect_sign IN (-1, 1))");
    addColumn(db, "accounting_entries", "supersedes_entry_id TEXT");
    addColumn(db, "accounting_entries", "reverses_entry_id TEXT");
    addColumn(db, "accounting_entries", "revision_reason TEXT");

    run(
      db,
      `UPDATE platform_sales
       SET aud_gross_cents = gross_cents,
           aud_platform_fee_cents = platform_fee_cents,
           aud_net_cents = net_cents,
           aud_refunded_cents = refunded_cents,
           aud_conversion_rate = 1,
           aud_conversion_evidence = 'Native AUD platform export',
           aud_conversion_at = imported_at
       WHERE currency = 'AUD' AND aud_gross_cents IS NULL`,
    );
    run(
      db,
      `UPDATE commercial_feedback
       SET venture_id = COALESCE(
         (SELECT venture_id FROM commercial_experiments WHERE commercial_experiments.id = commercial_feedback.experiment_id),
         (SELECT venture_id FROM workflows WHERE workflows.id = commercial_feedback.workflow_id),
         (SELECT id FROM ventures WHERE is_active = 1 ORDER BY created_at ASC LIMIT 1)
       )
       WHERE venture_id IS NULL`,
    );
    run(
      db,
      `UPDATE costs
       SET model_call_id = COALESCE(
         CASE WHEN json_valid(metadata) THEN json_extract(metadata, '$.modelCallId') END,
         (SELECT model_calls.id
          FROM model_calls
          WHERE model_calls.workflow_id = costs.workflow_id
            AND (model_calls.reconciled_cost_cents = costs.amount_cents
              OR model_calls.actual_cost_cents = costs.amount_cents)
          ORDER BY model_calls.created_at DESC
          LIMIT 1)
       )
       WHERE model_call_id IS NULL`,
    );
    run(
      db,
      `UPDATE costs
       SET task_id = COALESCE(
         (SELECT task_id FROM model_calls WHERE model_calls.id = costs.model_call_id),
         (SELECT task_id FROM budget_reservations
          WHERE budget_reservations.workflow_id = costs.workflow_id
          ORDER BY reserved_at DESC LIMIT 1)
       )
       WHERE task_id IS NULL`,
    );
    run(
      db,
      `UPDATE costs
       SET run_id = (SELECT agent_runs.id FROM agent_runs
                     WHERE agent_runs.model_call_id = costs.model_call_id
                        OR (agent_runs.task_id = costs.task_id AND costs.model_call_id IS NULL)
                     ORDER BY agent_runs.started_at DESC LIMIT 1)
       WHERE run_id IS NULL`,
    );

    db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_ventures_one_active
        ON ventures(is_active) WHERE is_active = 1;
      CREATE INDEX IF NOT EXISTS idx_costs_run ON costs(run_id);
      CREATE INDEX IF NOT EXISTS idx_costs_task ON costs(task_id);
      CREATE INDEX IF NOT EXISTS idx_costs_model_call ON costs(model_call_id);
      CREATE INDEX IF NOT EXISTS idx_commercial_results_verified
        ON commercial_results(venture_id, verified, occurred_at DESC);
      CREATE INDEX IF NOT EXISTS idx_commercial_feedback_verified
        ON commercial_feedback(venture_id, verified, occurred_at DESC);
      CREATE INDEX IF NOT EXISTS idx_platform_sales_aud
        ON platform_sales(venture_id, aud_conversion_at, sold_at DESC);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_accounting_supersedes
        ON accounting_entries(supersedes_entry_id) WHERE supersedes_entry_id IS NOT NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS idx_accounting_reverses
        ON accounting_entries(reverses_entry_id) WHERE reverses_entry_id IS NOT NULL;

      CREATE TABLE IF NOT EXISTS runtime_resets (
        reset_id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        source_database_sha256 TEXT NOT NULL,
        backup_reference TEXT NOT NULL,
        manifest_sha256 TEXT NOT NULL,
        manifest TEXT NOT NULL,
        created_at TEXT NOT NULL,
        applied_at TEXT
      );

      CREATE TRIGGER IF NOT EXISTS trg_accounting_reconciled_immutable_update
      BEFORE UPDATE ON accounting_entries
      FOR EACH ROW WHEN OLD.status = 'reconciled'
      BEGIN
        SELECT RAISE(ABORT, 'Reconciled accounting entries are immutable; record a reversal or revision.');
      END;

      CREATE TRIGGER IF NOT EXISTS trg_accounting_reconciled_immutable_delete
      BEFORE DELETE ON accounting_entries
      FOR EACH ROW WHEN OLD.status = 'reconciled'
      BEGIN
        SELECT RAISE(ABORT, 'Reconciled accounting entries are immutable; record a reversal or revision.');
      END;
    `);

    recordMigration(db, 11, "commercial-data-truth-and-first-use-reset");
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);
  const currentVersion = Number(get(db, "SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations")?.version || 0);
  if (currentVersion > LATEST_SCHEMA_VERSION) {
    throw new Error(`Runtime schema ${currentVersion} is newer than supported schema ${LATEST_SCHEMA_VERSION}.`);
  }
  if (!migrationApplied(db, 1)) {
    db.exec("BEGIN IMMEDIATE");
    try {
      db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ventures (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      stage INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL,
      summary TEXT NOT NULL DEFAULT '',
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS commands (
      id TEXT PRIMARY KEY,
      source TEXT NOT NULL,
      raw_text TEXT NOT NULL,
      intent TEXT NOT NULL,
      status TEXT NOT NULL,
      workflow_id TEXT,
      summary TEXT NOT NULL DEFAULT '',
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (workflow_id) REFERENCES workflows(id)
    );

    CREATE TABLE IF NOT EXISTS workflows (
      id TEXT PRIMARY KEY,
      venture_id TEXT,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      status TEXT NOT NULL,
      current_step TEXT NOT NULL DEFAULT '',
      priority INTEGER NOT NULL DEFAULT 3,
      quality_score INTEGER NOT NULL DEFAULT 0,
      expected_profit_cents INTEGER NOT NULL DEFAULT 0,
      cost_estimate_cents INTEGER NOT NULL DEFAULT 0,
      approval_required INTEGER NOT NULL DEFAULT 0,
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (venture_id) REFERENCES ventures(id)
    );

    CREATE TABLE IF NOT EXISTS workflow_runs (
      id TEXT PRIMARY KEY,
      workflow_id TEXT,
      mode TEXT NOT NULL,
      status TEXT NOT NULL,
      stopped_by TEXT,
      steps_run INTEGER NOT NULL DEFAULT 0,
      started_at TEXT NOT NULL,
      completed_at TEXT,
      metadata TEXT NOT NULL DEFAULT '{}',
      FOREIGN KEY (workflow_id) REFERENCES workflows(id)
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      workflow_id TEXT,
      title TEXT NOT NULL,
      kind TEXT NOT NULL,
      agent TEXT NOT NULL,
      status TEXT NOT NULL,
      priority INTEGER NOT NULL DEFAULT 3,
      retries INTEGER NOT NULL DEFAULT 0,
      max_retries INTEGER NOT NULL DEFAULT 2,
      approval_id TEXT,
      cost_budget_cents INTEGER NOT NULL DEFAULT 0,
      cost_actual_cents INTEGER NOT NULL DEFAULT 0,
      payload TEXT NOT NULL DEFAULT '{}',
      result TEXT NOT NULL DEFAULT '{}',
      error TEXT,
      due_at TEXT,
      started_at TEXT,
      completed_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (workflow_id) REFERENCES workflows(id)
    );

    CREATE TABLE IF NOT EXISTS approvals (
      id TEXT PRIMARY KEY,
      workflow_id TEXT,
      scope TEXT NOT NULL,
      title TEXT NOT NULL,
      status TEXT NOT NULL,
      risk_level TEXT NOT NULL DEFAULT 'medium',
      requested_by TEXT NOT NULL,
      requested_at TEXT NOT NULL,
      decided_at TEXT,
      decision_note TEXT,
      payload TEXT NOT NULL DEFAULT '{}',
      FOREIGN KEY (workflow_id) REFERENCES workflows(id)
    );

    CREATE TABLE IF NOT EXISTS deliverables (
      id TEXT PRIMARY KEY,
      workflow_id TEXT,
      command_id TEXT,
      task_id TEXT,
      title TEXT NOT NULL,
      human_name TEXT NOT NULL,
      audience TEXT NOT NULL,
      format TEXT NOT NULL,
      status TEXT NOT NULL,
      file_path TEXT,
      summary TEXT NOT NULL DEFAULT '',
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (workflow_id) REFERENCES workflows(id),
      FOREIGN KEY (command_id) REFERENCES commands(id),
      FOREIGN KEY (task_id) REFERENCES tasks(id)
    );

    CREATE TABLE IF NOT EXISTS model_calls (
      id TEXT PRIMARY KEY,
      workflow_id TEXT,
      task_id TEXT,
      provider TEXT NOT NULL,
      model_class TEXT NOT NULL,
      selected_model TEXT NOT NULL,
      mode TEXT NOT NULL,
      status TEXT NOT NULL,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      estimated_cost_cents INTEGER NOT NULL DEFAULT 0,
      actual_cost_cents INTEGER NOT NULL DEFAULT 0,
      approval_required INTEGER NOT NULL DEFAULT 0,
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      FOREIGN KEY (workflow_id) REFERENCES workflows(id),
      FOREIGN KEY (task_id) REFERENCES tasks(id)
    );

    CREATE TABLE IF NOT EXISTS research_runs (
      id TEXT PRIMARY KEY,
      workflow_id TEXT,
      task_id TEXT,
      query TEXT NOT NULL,
      provider TEXT NOT NULL,
      mode TEXT NOT NULL,
      status TEXT NOT NULL,
      budget_cents INTEGER NOT NULL DEFAULT 0,
      actual_cents INTEGER NOT NULL DEFAULT 0,
      summary TEXT NOT NULL DEFAULT '',
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      completed_at TEXT,
      FOREIGN KEY (workflow_id) REFERENCES workflows(id),
      FOREIGN KEY (task_id) REFERENCES tasks(id)
    );

    CREATE TABLE IF NOT EXISTS research_sources (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      title TEXT NOT NULL,
      url TEXT,
      publisher TEXT,
      published_at TEXT,
      retrieved_at TEXT NOT NULL,
      relevance TEXT NOT NULL DEFAULT '',
      confidence TEXT NOT NULL DEFAULT 'unknown',
      metadata TEXT NOT NULL DEFAULT '{}',
      FOREIGN KEY (run_id) REFERENCES research_runs(id)
    );

    CREATE TABLE IF NOT EXISTS monitor_runs (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      severity TEXT NOT NULL,
      finding_count INTEGER NOT NULL DEFAULT 0,
      started_at TEXT NOT NULL,
      completed_at TEXT,
      metadata TEXT NOT NULL DEFAULT '{}'
    );

    CREATE TABLE IF NOT EXISTS monitor_findings (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      severity TEXT NOT NULL,
      category TEXT NOT NULL,
      entity_type TEXT,
      entity_id TEXT,
      title TEXT NOT NULL,
      detail TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL,
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      FOREIGN KEY (run_id) REFERENCES monitor_runs(id)
    );

    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts TEXT NOT NULL,
      level TEXT NOT NULL,
      actor TEXT NOT NULL,
      type TEXT NOT NULL,
      entity_type TEXT,
      entity_id TEXT,
      message TEXT NOT NULL,
      metadata TEXT NOT NULL DEFAULT '{}'
    );

    CREATE TABLE IF NOT EXISTS costs (
      id TEXT PRIMARY KEY,
      workflow_id TEXT,
      category TEXT NOT NULL,
      source TEXT NOT NULL,
      status TEXT NOT NULL,
      amount_cents INTEGER NOT NULL,
      currency TEXT NOT NULL DEFAULT 'AUD',
      occurred_at TEXT NOT NULL,
      metadata TEXT NOT NULL DEFAULT '{}',
      FOREIGN KEY (workflow_id) REFERENCES workflows(id)
    );

    CREATE TABLE IF NOT EXISTS revenue (
      id TEXT PRIMARY KEY,
      venture_id TEXT,
      source TEXT NOT NULL,
      status TEXT NOT NULL,
      amount_cents INTEGER NOT NULL,
      currency TEXT NOT NULL DEFAULT 'AUD',
      occurred_at TEXT NOT NULL,
      metadata TEXT NOT NULL DEFAULT '{}',
      FOREIGN KEY (venture_id) REFERENCES ventures(id)
    );

    CREATE TABLE IF NOT EXISTS commercial_experiments (
      id TEXT PRIMARY KEY,
      workflow_id TEXT,
      venture_id TEXT,
      name TEXT NOT NULL,
      status TEXT NOT NULL,
      hypothesis TEXT NOT NULL DEFAULT '',
      buyer TEXT NOT NULL DEFAULT '',
      offer TEXT NOT NULL DEFAULT '',
      channel TEXT NOT NULL DEFAULT '',
      price_cents INTEGER NOT NULL DEFAULT 0,
      expected_metric TEXT NOT NULL DEFAULT '',
      target_value REAL NOT NULL DEFAULT 0,
      target_unit TEXT NOT NULL DEFAULT '',
      cost_cap_cents INTEGER NOT NULL DEFAULT 0,
      started_at TEXT,
      ended_at TEXT,
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (workflow_id) REFERENCES workflows(id),
      FOREIGN KEY (venture_id) REFERENCES ventures(id)
    );

    CREATE TABLE IF NOT EXISTS commercial_briefs (
      id TEXT PRIMARY KEY,
      workflow_id TEXT,
      venture_id TEXT,
      source TEXT NOT NULL,
      status TEXT NOT NULL,
      title TEXT NOT NULL,
      idea TEXT NOT NULL DEFAULT '',
      buyer TEXT NOT NULL DEFAULT '',
      problem TEXT NOT NULL DEFAULT '',
      evidence_summary TEXT NOT NULL DEFAULT '',
      research_basis TEXT NOT NULL DEFAULT '',
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (workflow_id) REFERENCES workflows(id),
      FOREIGN KEY (venture_id) REFERENCES ventures(id)
    );

    CREATE TABLE IF NOT EXISTS commercial_test_candidates (
      id TEXT PRIMARY KEY,
      brief_id TEXT NOT NULL,
      workflow_id TEXT,
      venture_id TEXT,
      rank INTEGER NOT NULL,
      status TEXT NOT NULL,
      title TEXT NOT NULL,
      buyer TEXT NOT NULL DEFAULT '',
      problem TEXT NOT NULL DEFAULT '',
      offer TEXT NOT NULL DEFAULT '',
      channel TEXT NOT NULL DEFAULT '',
      price_cents INTEGER NOT NULL DEFAULT 0,
      gross_margin_cents INTEGER NOT NULL DEFAULT 0,
      cost_cap_cents INTEGER NOT NULL DEFAULT 0,
      evidence_score INTEGER NOT NULL DEFAULT 0,
      confidence TEXT NOT NULL DEFAULT 'low',
      hypothesis TEXT NOT NULL DEFAULT '',
      smallest_action TEXT NOT NULL DEFAULT '',
      expected_metric TEXT NOT NULL DEFAULT '',
      target_value REAL NOT NULL DEFAULT 0,
      target_unit TEXT NOT NULL DEFAULT '',
      success_metric TEXT NOT NULL DEFAULT '',
      kill_criteria TEXT NOT NULL DEFAULT '',
      risk TEXT NOT NULL DEFAULT 'low',
      rationale TEXT NOT NULL DEFAULT '',
      promoted_experiment_id TEXT,
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (brief_id) REFERENCES commercial_briefs(id),
      FOREIGN KEY (workflow_id) REFERENCES workflows(id),
      FOREIGN KEY (venture_id) REFERENCES ventures(id),
      FOREIGN KEY (promoted_experiment_id) REFERENCES commercial_experiments(id)
    );

    CREATE TABLE IF NOT EXISTS commercial_results (
      id TEXT PRIMARY KEY,
      experiment_id TEXT,
      workflow_id TEXT,
      source TEXT NOT NULL,
      status TEXT NOT NULL,
      views INTEGER NOT NULL DEFAULT 0,
      clicks INTEGER NOT NULL DEFAULT 0,
      leads INTEGER NOT NULL DEFAULT 0,
      sales INTEGER NOT NULL DEFAULT 0,
      refunds INTEGER NOT NULL DEFAULT 0,
      revenue_cents INTEGER NOT NULL DEFAULT 0,
      spend_cents INTEGER NOT NULL DEFAULT 0,
      time_spent_minutes INTEGER NOT NULL DEFAULT 0,
      notes TEXT NOT NULL DEFAULT '',
      occurred_at TEXT NOT NULL,
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      FOREIGN KEY (experiment_id) REFERENCES commercial_experiments(id),
      FOREIGN KEY (workflow_id) REFERENCES workflows(id)
    );

    CREATE TABLE IF NOT EXISTS commercial_feedback (
      id TEXT PRIMARY KEY,
      experiment_id TEXT,
      workflow_id TEXT,
      source TEXT NOT NULL,
      sentiment TEXT NOT NULL,
      rating INTEGER,
      summary TEXT NOT NULL DEFAULT '',
      objection TEXT NOT NULL DEFAULT '',
      request TEXT NOT NULL DEFAULT '',
      occurred_at TEXT NOT NULL,
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      FOREIGN KEY (experiment_id) REFERENCES commercial_experiments(id),
      FOREIGN KEY (workflow_id) REFERENCES workflows(id)
    );

    CREATE TABLE IF NOT EXISTS commercial_learning_cycles (
      id TEXT PRIMARY KEY,
      experiment_id TEXT,
      workflow_id TEXT,
      status TEXT NOT NULL,
      verdict TEXT NOT NULL,
      hypothesis TEXT NOT NULL DEFAULT '',
      expected_metric TEXT NOT NULL DEFAULT '',
      actual_result TEXT NOT NULL DEFAULT '',
      learning TEXT NOT NULL DEFAULT '',
      improvement TEXT NOT NULL DEFAULT '',
      next_action TEXT NOT NULL DEFAULT '',
      confidence TEXT NOT NULL DEFAULT 'low',
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      FOREIGN KEY (experiment_id) REFERENCES commercial_experiments(id),
      FOREIGN KEY (workflow_id) REFERENCES workflows(id)
    );

    CREATE TABLE IF NOT EXISTS commercial_execution_packs (
      id TEXT PRIMARY KEY,
      experiment_id TEXT NOT NULL,
      candidate_id TEXT,
      brief_id TEXT,
      workflow_id TEXT,
      venture_id TEXT,
      status TEXT NOT NULL,
      title TEXT NOT NULL,
      offer_page_copy TEXT NOT NULL DEFAULT '',
      product_description TEXT NOT NULL DEFAULT '',
      cta TEXT NOT NULL DEFAULT '',
      channel_plan TEXT NOT NULL DEFAULT '',
      tracking_plan TEXT NOT NULL DEFAULT '',
      result_checklist TEXT NOT NULL DEFAULT '',
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (experiment_id) REFERENCES commercial_experiments(id),
      FOREIGN KEY (candidate_id) REFERENCES commercial_test_candidates(id),
      FOREIGN KEY (brief_id) REFERENCES commercial_briefs(id),
      FOREIGN KEY (workflow_id) REFERENCES workflows(id),
      FOREIGN KEY (venture_id) REFERENCES ventures(id)
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      task_id TEXT,
      severity TEXT NOT NULL,
      status TEXT NOT NULL,
      subject TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL,
      resolved_at TEXT,
      metadata TEXT NOT NULL DEFAULT '{}',
      FOREIGN KEY (task_id) REFERENCES tasks(id)
    );

    CREATE TABLE IF NOT EXISTS notification_outbox (
      id TEXT PRIMARY KEY,
      message_id TEXT,
      approval_id TEXT,
      channel TEXT NOT NULL,
      recipient TEXT,
      subject TEXT NOT NULL,
      body TEXT NOT NULL,
      status TEXT NOT NULL,
      provider TEXT NOT NULL DEFAULT 'dry-run',
      mode TEXT NOT NULL DEFAULT 'dry-run',
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      sent_at TEXT,
      FOREIGN KEY (message_id) REFERENCES messages(id),
      FOREIGN KEY (approval_id) REFERENCES approvals(id)
    );

    CREATE TABLE IF NOT EXISTS inbound_messages (
      id TEXT PRIMARY KEY,
      channel TEXT NOT NULL,
      provider TEXT NOT NULL DEFAULT 'dry-run',
      sender TEXT,
      subject TEXT NOT NULL DEFAULT '',
      body TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL,
      approval_id TEXT,
      decision TEXT,
      received_at TEXT NOT NULL,
      processed_at TEXT,
      metadata TEXT NOT NULL DEFAULT '{}',
      FOREIGN KEY (approval_id) REFERENCES approvals(id)
    );

    CREATE TABLE IF NOT EXISTS approval_action_tokens (
      id TEXT PRIMARY KEY,
      approval_id TEXT NOT NULL,
      decision TEXT NOT NULL,
      token TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      used_at TEXT,
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      FOREIGN KEY (approval_id) REFERENCES approvals(id)
    );

    CREATE TABLE IF NOT EXISTS agent_definitions (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      role TEXT NOT NULL,
      status TEXT NOT NULL,
      mode TEXT NOT NULL,
      model_class TEXT NOT NULL,
      instructions TEXT NOT NULL DEFAULT '',
      tools TEXT NOT NULL DEFAULT '[]',
      guardrails TEXT NOT NULL DEFAULT '[]',
      handoff_targets TEXT NOT NULL DEFAULT '[]',
      input_contract TEXT NOT NULL DEFAULT '{}',
      output_contract TEXT NOT NULL DEFAULT '{}',
      approval_policy TEXT NOT NULL DEFAULT '{}',
      eval_criteria TEXT NOT NULL DEFAULT '[]',
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS agent_tools (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      status TEXT NOT NULL,
      mode TEXT NOT NULL,
      risk_level TEXT NOT NULL DEFAULT 'low',
      dry_run_available INTEGER NOT NULL DEFAULT 1,
      requires_approval INTEGER NOT NULL DEFAULT 0,
      external_action INTEGER NOT NULL DEFAULT 0,
      spend_possible INTEGER NOT NULL DEFAULT 0,
      hard_stop INTEGER NOT NULL DEFAULT 0,
      approval_scope TEXT,
      integration_id TEXT,
      provider_capability TEXT,
      live_flag TEXT,
      description TEXT NOT NULL DEFAULT '',
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (integration_id) REFERENCES integrations(id)
    );

    CREATE TABLE IF NOT EXISTS agent_tool_assignments (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      tool_id TEXT NOT NULL,
      status TEXT NOT NULL,
      permission TEXT NOT NULL,
      approval_scope TEXT,
      cost_cap_cents INTEGER NOT NULL DEFAULT 0,
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(agent_id, tool_id),
      FOREIGN KEY (agent_id) REFERENCES agent_definitions(id),
      FOREIGN KEY (tool_id) REFERENCES agent_tools(id)
    );

    CREATE TABLE IF NOT EXISTS agent_tool_invocations (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      run_id TEXT,
      task_id TEXT,
      workflow_id TEXT,
      tool_id TEXT NOT NULL,
      assignment_id TEXT,
      approval_id TEXT,
      requested_mode TEXT NOT NULL,
      status TEXT NOT NULL,
      decision TEXT NOT NULL,
      permission TEXT NOT NULL,
      risk_level TEXT NOT NULL DEFAULT 'medium',
      input_summary TEXT NOT NULL DEFAULT '',
      output_summary TEXT NOT NULL DEFAULT '',
      metadata TEXT NOT NULL DEFAULT '{}',
      requested_at TEXT NOT NULL,
      resolved_at TEXT,
      FOREIGN KEY (agent_id) REFERENCES agent_definitions(id),
      FOREIGN KEY (run_id) REFERENCES agent_runs(id),
      FOREIGN KEY (task_id) REFERENCES tasks(id),
      FOREIGN KEY (workflow_id) REFERENCES workflows(id),
      FOREIGN KEY (tool_id) REFERENCES agent_tools(id),
      FOREIGN KEY (assignment_id) REFERENCES agent_tool_assignments(id),
      FOREIGN KEY (approval_id) REFERENCES approvals(id)
    );

    CREATE TABLE IF NOT EXISTS agent_runs (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      workflow_id TEXT,
      task_id TEXT,
      mode TEXT NOT NULL,
      status TEXT NOT NULL,
      input_summary TEXT NOT NULL DEFAULT '',
      output_summary TEXT NOT NULL DEFAULT '',
      model_call_id TEXT,
      estimated_cost_cents INTEGER NOT NULL DEFAULT 0,
      actual_cost_cents INTEGER NOT NULL DEFAULT 0,
      approval_required INTEGER NOT NULL DEFAULT 0,
      handoff_to TEXT,
      eval_status TEXT NOT NULL DEFAULT 'not_evaluated',
      metadata TEXT NOT NULL DEFAULT '{}',
      started_at TEXT NOT NULL,
      completed_at TEXT,
      FOREIGN KEY (agent_id) REFERENCES agent_definitions(id),
      FOREIGN KEY (workflow_id) REFERENCES workflows(id),
      FOREIGN KEY (task_id) REFERENCES tasks(id),
      FOREIGN KEY (model_call_id) REFERENCES model_calls(id)
    );

    CREATE TABLE IF NOT EXISTS agent_trace_events (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      sequence INTEGER NOT NULL,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      detail TEXT NOT NULL DEFAULT '',
      metadata TEXT NOT NULL DEFAULT '{}',
      ts TEXT NOT NULL,
      FOREIGN KEY (run_id) REFERENCES agent_runs(id)
    );

    CREATE TABLE IF NOT EXISTS agent_eval_results (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      task_id TEXT,
      status TEXT NOT NULL,
      score INTEGER NOT NULL DEFAULT 0,
      criteria TEXT NOT NULL DEFAULT '[]',
      findings TEXT NOT NULL DEFAULT '[]',
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      FOREIGN KEY (run_id) REFERENCES agent_runs(id),
      FOREIGN KEY (agent_id) REFERENCES agent_definitions(id),
      FOREIGN KEY (task_id) REFERENCES tasks(id)
    );

    CREATE TABLE IF NOT EXISTS agent_eval_datasets (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      name TEXT NOT NULL,
      purpose TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL,
      minimum_cases INTEGER NOT NULL DEFAULT 1,
      pass_score INTEGER NOT NULL DEFAULT 80,
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (agent_id) REFERENCES agent_definitions(id)
    );

    CREATE TABLE IF NOT EXISTS agent_eval_cases (
      id TEXT PRIMARY KEY,
      dataset_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      title TEXT NOT NULL,
      input_summary TEXT NOT NULL DEFAULT '',
      expected_output TEXT NOT NULL DEFAULT '',
      criteria TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL,
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (dataset_id) REFERENCES agent_eval_datasets(id),
      FOREIGN KEY (agent_id) REFERENCES agent_definitions(id)
    );

    CREATE TABLE IF NOT EXISTS agent_model_readiness_packs (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL,
      readiness_score INTEGER NOT NULL DEFAULT 0,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      instructions_packet TEXT NOT NULL DEFAULT '{}',
      input_contract TEXT NOT NULL DEFAULT '{}',
      output_contract TEXT NOT NULL DEFAULT '{}',
      tool_plan TEXT NOT NULL DEFAULT '{}',
      approval_rules TEXT NOT NULL DEFAULT '{}',
      eval_plan TEXT NOT NULL DEFAULT '{}',
      fixtures TEXT NOT NULL DEFAULT '[]',
      failure_cases TEXT NOT NULL DEFAULT '[]',
      readiness_checks TEXT NOT NULL DEFAULT '[]',
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (agent_id) REFERENCES agent_definitions(id)
    );

    CREATE TABLE IF NOT EXISTS agent_model_comparison_packets (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      pack_id TEXT NOT NULL,
      workflow_id TEXT NOT NULL UNIQUE,
      task_id TEXT,
      approval_id TEXT,
      status TEXT NOT NULL,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      estimated_cost_cents INTEGER NOT NULL DEFAULT 0,
      currency TEXT NOT NULL DEFAULT 'AUD',
      fixture_id TEXT,
      fixture_title TEXT,
      protected_baseline TEXT NOT NULL DEFAULT '{}',
      comparison_plan TEXT NOT NULL DEFAULT '{}',
      eval_plan TEXT NOT NULL DEFAULT '{}',
      operator_decision TEXT NOT NULL DEFAULT '{}',
      hard_stops TEXT NOT NULL DEFAULT '[]',
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (agent_id) REFERENCES agent_definitions(id),
      FOREIGN KEY (pack_id) REFERENCES agent_model_readiness_packs(id),
      FOREIGN KEY (workflow_id) REFERENCES workflows(id),
      FOREIGN KEY (task_id) REFERENCES tasks(id),
      FOREIGN KEY (approval_id) REFERENCES approvals(id)
    );

    CREATE TABLE IF NOT EXISTS agent_handoffs (
      id TEXT PRIMARY KEY,
      workflow_id TEXT,
      task_id TEXT,
      from_run_id TEXT NOT NULL,
      from_agent_id TEXT NOT NULL,
      to_agent_id TEXT NOT NULL,
      status TEXT NOT NULL,
      reason TEXT NOT NULL DEFAULT '',
      summary TEXT NOT NULL DEFAULT '',
      decision_needed TEXT NOT NULL DEFAULT '',
      risk_level TEXT NOT NULL DEFAULT 'medium',
      approval_required INTEGER NOT NULL DEFAULT 0,
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      resolved_at TEXT,
      FOREIGN KEY (workflow_id) REFERENCES workflows(id),
      FOREIGN KEY (task_id) REFERENCES tasks(id),
      FOREIGN KEY (from_run_id) REFERENCES agent_runs(id),
      FOREIGN KEY (from_agent_id) REFERENCES agent_definitions(id),
      FOREIGN KEY (to_agent_id) REFERENCES agent_definitions(id)
    );

    CREATE TABLE IF NOT EXISTS integrations (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      kind TEXT NOT NULL,
      status TEXT NOT NULL,
      mode TEXT NOT NULL,
      health TEXT NOT NULL DEFAULT 'unknown',
      last_checked_at TEXT,
      metadata TEXT NOT NULL DEFAULT '{}',
      updated_at TEXT NOT NULL
    );


    CREATE TABLE IF NOT EXISTS scheduler_jobs (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      kind TEXT NOT NULL,
      status TEXT NOT NULL,
      interval_seconds INTEGER NOT NULL DEFAULT 900,
      priority INTEGER NOT NULL DEFAULT 3,
      next_run_at TEXT,
      last_run_at TEXT,
      locked_at TEXT,
      lock_owner TEXT,
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS scheduler_runs (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL,
      status TEXT NOT NULL,
      started_at TEXT NOT NULL,
      completed_at TEXT,
      result TEXT NOT NULL DEFAULT '{}',
      error TEXT,
      metadata TEXT NOT NULL DEFAULT '{}',
      FOREIGN KEY (job_id) REFERENCES scheduler_jobs(id)
    );


    CREATE TABLE IF NOT EXISTS venture_scorecards (
      id TEXT PRIMARY KEY,
      venture_id TEXT,
      workflow_id TEXT NOT NULL UNIQUE,
      command_id TEXT,
      channel TEXT NOT NULL,
      subject TEXT NOT NULL,
      status TEXT NOT NULL,
      verdict TEXT NOT NULL,
      recommendation TEXT NOT NULL,
      total_score INTEGER NOT NULL,
      confidence TEXT NOT NULL,
      dimensions TEXT NOT NULL DEFAULT '{}',
      risks TEXT NOT NULL DEFAULT '[]',
      next_actions TEXT NOT NULL DEFAULT '[]',
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (venture_id) REFERENCES ventures(id),
      FOREIGN KEY (workflow_id) REFERENCES workflows(id),
      FOREIGN KEY (command_id) REFERENCES commands(id)
    );
    `);
    run(
      db,
      `UPDATE workflows
       SET current_step = 'ready for dry-run agent execution'
       WHERE status = 'planned' AND current_step = 'waiting for agent runner implementation'`,
    );
      recordMigration(db, 1, "initial-runtime-schema");
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
  applyFoundationMigration(db);
  applyPilotEvidenceMigration(db);
  applyVentureOwnershipMigration(db);
  applyExecutiveDigestMigration(db);
  applyLegacyDemoSanitizationMigration(db);
  applyLegacyReviewQueueMigration(db);
  applyLegacyNotificationCleanupMigration(db);
  applyHistoricalWorkArchiveMigration(db);
  applyAccountingLedgerMigration(db);
  applyCommercialDataTruthMigration(db);
}

function putSetting(db, key, value) {
  run(
    db,
    `INSERT INTO settings (key, value, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    [key, toJson(value), now()],
  );
}

function insertEvent(db, event) {
  run(
    db,
    `INSERT INTO events (ts, level, actor, type, entity_type, entity_id, message, metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      event.ts || now(),
      event.level || "info",
      event.actor || "runtime",
      event.type || "event",
      event.entityType || null,
      event.entityId || null,
      event.message,
      toJson(event.metadata),
    ],
  );
}

function seedDatabase(db, options = {}) {
  const existing = get(db, "SELECT value FROM settings WHERE key = ?", ["runtime.initialized"]);
  if (existing) return false;

  db.exec("BEGIN IMMEDIATE");
  try {
  const ts = now();
  const includeDemoProof = options.includeDemoProof === true;
  putSetting(db, "operator.preferences", {
    noCodeTouch: true,
    dashboardFirst: true,
    urgentChannels: ["email", "dashboard"],
    optionalChannels: ["slack", "clickup"],
  });
  putSetting(db, "autonomy", {
    stage: CONFIG.autonomyStage,
    promotionApprovalRate: CONFIG.targetFirstPassApprovalRate,
    capabilityPromotionMinimumRuns: 5,
    promotionMinimumApprovals: 5,
    exactCapabilityOnly: true,
    globalAgentPromotionDisabled: true,
    liveExternalActionsRequireApproval: true,
  });
  putSetting(db, "budget", {
    monthlyBudgetCents: CONFIG.monthlyBudgetCents,
    currency: CONFIG.currency,
    spendRequiresApproval: true,
    notes: "Pre-revenue cap: A$100/month. Each live AI run and market test also has its own explicit cap.",
  });
  putSetting(db, "operator.workload", {
    targetMinutesPerWeek: 480,
    intensiveWeekMaximumMinutes: 960,
    intensiveWeekRequiresApproval: true,
    timeValueCentsPerHour: 5000,
    longTermMode: "weekly digest plus important exceptions",
  });
  putSetting(db, "commercial.pilot", {
    businessModel: "digital_product",
    platform: "gumroad_direct",
    oneActiveVenture: true,
    successBuyers: 3,
    requirePositiveCashContribution: true,
    publicIdentity: "faceless_and_voiceless",
  });

  run(
    db,
    `INSERT INTO ventures
     (id, name, stage, status, summary, metadata, created_at, updated_at, lifecycle_stage, is_active, business_model)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      "venture-digital-products",
      "Digital Products",
      1,
      "validating",
      "The sole active venture until one digital-product offer proves three independent buyers and positive cash contribution.",
      toJson({
        channel: "Gumroad Direct plus bounded organic distribution",
        publicIdentity: "faceless_and_voiceless",
        successThreshold: "3 independent paid buyers and positive cash contribution",
      }),
      ts,
      ts,
      "validating",
      1,
      "digital_product",
    ],
  );

  if (includeDemoProof) {
    run(
      db,
      `INSERT INTO workflows (id, venture_id, type, title, status, current_step, priority,
        quality_score, expected_profit_cents, cost_estimate_cents, approval_required, metadata, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        "wf-digital-product-pilot-proof",
        "venture-digital-products",
        "digital_product_publish",
        "Digital product pilot proof",
        "blocked_for_approval",
        "operator digital-product dry-run approval",
        1,
        88,
        1900,
        0,
        1,
        toJson({
          channel: "Digital Product",
          subject: "Digital product pilot proof",
          products: [
            { sku: "compact-desk-cable-template-v1", product: "Desk cable routing template", marginCents: 1900 },
            { sku: "small-business-launch-checklist-v1", product: "Launch checklist download", marginCents: 1200 },
          ],
          sourceFiles: [
            "deliverables/digital-products/compact-desk-cable-template-proof.md",
            "deliverables/digital-products/small-business-launch-checklist-proof.md",
          ],
          proofMode: "dry-run only; no live listing, file delivery, or paid asset generation is created",
        }),
        ts,
        ts,
      ],
    );

    const completedTasks = [
      ["task-market-validated", "Market research gate", "market_research", "researcher", { score: 70, verdict: "needs_live_research" }],
      ["task-finance-validated", "Unit economics and channel gate", "finance_model", "analyst", { marginFloor: "promising if marketplace fees stay modest" }],
      ["task-qc-validated", "Quality and IP gate", "design_qc", "quality-checker", { qualityScore: 88, ipRisk: "low" }],
    ];

    for (const [id, title, kind, agent, result] of completedTasks) {
      run(
        db,
        `INSERT INTO tasks (id, workflow_id, title, kind, agent, status, priority, cost_budget_cents,
          cost_actual_cents, payload, result, completed_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, "wf-digital-product-pilot-proof", title, kind, agent, "completed", 2, 0, 0, toJson({}), toJson(result), ts, ts, ts],
      );
    }

    run(
      db,
      `INSERT INTO approvals (id, workflow_id, scope, title, status, risk_level, requested_by,
        requested_at, payload)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        "appr-digital-product-dry-run",
        "wf-digital-product-pilot-proof",
        "dry_run_publish",
        "Approve digital product dry-run proof",
        "pending",
        "low",
        "orchestrator",
        ts,
        toJson({
          noExternalPublish: true,
          reason: "Proves workflow wiring, approval loop, file-delivery planning, and dashboard visibility before any live publishing or paid asset work.",
        }),
      ],
    );

    run(
      db,
      `INSERT INTO tasks (id, workflow_id, title, kind, agent, status, priority, approval_id,
        max_retries, payload, result, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        "task-digital-product-dry-run",
        "wf-digital-product-pilot-proof",
        "Prepare digital product listing and delivery plan in dry-run mode",
        "publish_digital_product_dry_run",
        "publisher",
        "blocked",
        1,
        "appr-digital-product-dry-run",
        2,
        toJson({ integration: "digital-products", mode: "dry-run" }),
        toJson({ blockedBy: "appr-digital-product-dry-run" }),
        ts,
        ts,
      ],
    );

    const seedDeliverables = [
      [
        "deliv-digital-product-concept-pack",
        "Digital Product Concept Pack",
        "Digital Product - Pilot Concept Pack (approved for dry-run proof)",
        "operator",
        "markdown",
        "approved",
        "deliverables/digital-products/pilot-concept-pack.md",
        "Approved concept pack for the first digital-product proof path.",
      ],
      [
        "deliv-digital-product-unit-economics",
        "Digital Product Unit Economics",
        "Digital Product - Unit Economics Snapshot (approved for dry-run proof)",
        "operator",
        "markdown",
        "approved",
        "deliverables/digital-products/unit-economics-snapshot.md",
        "Unit economics snapshot for the first digital-product proof path.",
      ],
    ];

    for (const deliverable of seedDeliverables) {
      run(
        db,
        `INSERT INTO deliverables (id, workflow_id, title, human_name, audience, format, status, file_path, summary, metadata, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [deliverable[0], "wf-digital-product-pilot-proof", ...deliverable.slice(1), toJson({ seeded: true }), ts, ts],
      );
    }
  }

  const integrations = [
    ["codex", "Codex", "engineering", "ready", "local", "ok", { role: "engineering/admin runtime maintainer" }],
    ["openai", "OpenAI API", "ai", process.env.OPENAI_API_KEY ? "configured" : "needs_credentials", "api", process.env.OPENAI_API_KEY ? "ok" : "not_configured", { use: "future agent workflows, tracing, image/API scale" }],
    ["live_research", "Live Research Adapter", "research", process.env.OPENAI_API_KEY && process.env.JARVIS_ENABLE_LIVE_RESEARCH === "1" ? "configured" : "planned", "openai-web-search", process.env.OPENAI_API_KEY && process.env.JARVIS_ENABLE_LIVE_RESEARCH === "1" ? "ok" : "not_configured", { use: "approved live market, competitor, pricing, and risk research" }],
    ["ai_workers", "AI Worker Execution", "ai", process.env.OPENAI_API_KEY && process.env.JARVIS_ENABLE_LIVE_MODELS === "1" ? "configured" : "planned", "openai-agents-sdk", process.env.OPENAI_API_KEY && process.env.JARVIS_ENABLE_LIVE_MODELS === "1" ? "ok" : "not_configured", { use: "approved live OpenAI-backed specialist worker execution" }],
    ["digital_products", "Digital Product Publishing", "marketplace", "ready", "dry-run", "ok", { use: "digital product listing, file-delivery, and approval-pack proof path" }],
    ["gelato", "Gelato", "supplier", process.env.GELATO_API_KEY ? "configured" : "needs_credentials", "api-or-dashboard", process.env.GELATO_API_KEY ? "ok" : "dry_run_only", { use: "POD product creation and supplier-push to Etsy" }],
    ["etsy", "Etsy", "marketplace", "via_gelato", "partner", "limited", { directApi: "denied; do not retry", liveActionRisk: "seller account visible action" }],
    ["xero", "Xero", "accounting", process.env.XERO_CLIENT_ID ? "configured" : "planned", "oauth", process.env.XERO_CLIENT_ID ? "ok" : "not_configured", { use: "finance reconciliation after commercial traction" }],
    ["email", "Email escalation", "notification", process.env.SMTP_HOST ? "configured" : "planned", "smtp-or-provider", process.env.SMTP_HOST ? "ok" : "not_configured", { use: "urgent approvals and escalations" }],
    ["slack", "Slack", "control-plane", process.env.SLACK_BOT_TOKEN ? "configured" : "optional", "api", process.env.SLACK_BOT_TOKEN ? "ok" : "not_configured", { use: "optional agent command channel" }],
    ["clickup", "ClickUp", "work-management", process.env.CLICKUP_API_TOKEN ? "configured" : "optional", "api", process.env.CLICKUP_API_TOKEN ? "ok" : "not_configured", { use: "optional task mirror; dashboard remains source of truth" }],
  ];

  for (const integration of integrations) {
    run(
      db,
      `INSERT INTO integrations (id, name, kind, status, mode, health, last_checked_at, metadata, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [...integration.slice(0, 6), ts, toJson(integration[6]), ts],
    );
  }

  if (includeDemoProof) {
    run(
      db,
      `INSERT INTO messages (id, task_id, severity, status, subject, body, created_at, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        "msg-first-proof-approval",
        "task-digital-product-dry-run",
        "approval",
        "open",
        "Digital product dry-run approval needed",
        "Approve the digital-product dry-run to prove the listing and delivery planning rail without creating a live listing or spending money.",
        ts,
        toJson({ channel: "dashboard" }),
      ],
    );
  }

  insertEvent(db, {
    level: "info",
    actor: "orchestrator",
    type: "runtime.seeded",
    entityType: "runtime",
    entityId: "v2",
    message: includeDemoProof
      ? "Jarvis-Codex test runtime seeded with explicit demo proof fixtures."
      : "Jarvis-Codex runtime initialized with one digital-product venture, integrations, and cost controls.",
  });

  putSetting(db, "runtime.initialized", { at: ts, version: LATEST_SCHEMA_VERSION });
  db.exec("COMMIT");
  return true;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

module.exports = {
  LATEST_SCHEMA_VERSION,
  all,
  fromJson,
  get,
  insertEvent,
  now,
  openDatabase,
  putSetting,
  randomId: randomUUID,
  run,
  seedDatabase,
  toJson,
  verifyDatabase,
};
