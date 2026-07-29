const fs = require("node:fs");
const path = require("node:path");
const { createHash, randomUUID } = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");
const CONFIG = require("./config");
const { spendCostId } = require("./runtime/stable-id");

const LATEST_SCHEMA_VERSION = 26;
let canonicalRecoverySchemaContractCache = null;

const COMMERCIAL_LEDGER_IMMUTABLE_TRIGGER_SQL = Object.freeze({
  trg_venture_kits_definition_immutable_update: `
    CREATE TRIGGER IF NOT EXISTS trg_venture_kits_definition_immutable_update
    BEFORE UPDATE OF id, version, name, business_models, eligibility_rules,
      evidence_requirements, capability_requirements, channel_policy,
      acceptance_criteria, metadata, content_hash, created_at
    ON venture_kits
    BEGIN
      SELECT RAISE(ABORT, 'Venture Kit definitions are immutable; register a new version.');
    END
  `,
  trg_venture_kits_definition_immutable_delete: `
    CREATE TRIGGER IF NOT EXISTS trg_venture_kits_definition_immutable_delete
    BEFORE DELETE ON venture_kits
    BEGIN
      SELECT RAISE(ABORT, 'Venture Kit definitions are immutable.');
    END
  `,
  trg_commercial_test_contracts_immutable_update: `
    CREATE TRIGGER IF NOT EXISTS trg_commercial_test_contracts_immutable_update
    BEFORE UPDATE ON commercial_test_contracts
    BEGIN
      SELECT RAISE(ABORT, 'Commercial test contracts are immutable; create a new version.');
    END
  `,
  trg_commercial_test_contracts_immutable_delete: `
    CREATE TRIGGER IF NOT EXISTS trg_commercial_test_contracts_immutable_delete
    BEFORE DELETE ON commercial_test_contracts
    BEGIN
      SELECT RAISE(ABORT, 'Commercial test contracts are immutable.');
    END
  `,
  trg_commercial_test_lifecycle_immutable_update: `
    CREATE TRIGGER IF NOT EXISTS trg_commercial_test_lifecycle_immutable_update
    BEFORE UPDATE ON commercial_test_lifecycle_events
    BEGIN
      SELECT RAISE(ABORT, 'Commercial test lifecycle events are append-only.');
    END
  `,
  trg_commercial_test_lifecycle_immutable_delete: `
    CREATE TRIGGER IF NOT EXISTS trg_commercial_test_lifecycle_immutable_delete
    BEFORE DELETE ON commercial_test_lifecycle_events
    BEGIN
      SELECT RAISE(ABORT, 'Commercial test lifecycle events are append-only.');
    END
  `,
  trg_commercial_test_lifecycle_resume_approval_fresh_insert: `
    CREATE TRIGGER IF NOT EXISTS trg_commercial_test_lifecycle_resume_approval_fresh_insert
    BEFORE INSERT ON commercial_test_lifecycle_events
    WHEN NEW.event_type IN ('accepted', 'activated')
      AND EXISTS (
        SELECT 1
        FROM commercial_test_lifecycle_events AS pauses
        WHERE pauses.decision_hash = NEW.decision_hash
          AND pauses.event_type = 'paused'
          AND pauses.sequence < NEW.sequence
      )
      AND NOT EXISTS (
        SELECT 1
        FROM approvals
        WHERE approvals.id = NEW.approval_id
          AND approvals.status = 'approved'
          AND julianday(approvals.decided_at) IS NOT NULL
          AND julianday(approvals.decided_at) > (
            SELECT julianday(pauses.occurred_at)
            FROM commercial_test_lifecycle_events AS pauses
            WHERE pauses.decision_hash = NEW.decision_hash
              AND pauses.event_type = 'paused'
              AND pauses.sequence < NEW.sequence
            ORDER BY pauses.sequence DESC
            LIMIT 1
          )
      )
    BEGIN
      SELECT RAISE(
        ABORT,
        'Commercial test resumption requires a fresh approval decided after the latest pause.'
      );
    END
  `,
  trg_commercial_test_receipts_immutable_update: `
    CREATE TRIGGER IF NOT EXISTS trg_commercial_test_receipts_immutable_update
    BEFORE UPDATE ON commercial_test_evidence_receipts
    BEGIN
      SELECT RAISE(ABORT, 'Commercial evidence receipts are immutable.');
    END
  `,
  trg_commercial_test_receipts_immutable_delete: `
    CREATE TRIGGER IF NOT EXISTS trg_commercial_test_receipts_immutable_delete
    BEFORE DELETE ON commercial_test_evidence_receipts
    BEGIN
      SELECT RAISE(ABORT, 'Commercial evidence receipts are immutable.');
    END
  `,
  trg_commercial_test_records_immutable_update: `
    CREATE TRIGGER IF NOT EXISTS trg_commercial_test_records_immutable_update
    BEFORE UPDATE ON commercial_test_evidence_records
    BEGIN
      SELECT RAISE(ABORT, 'Commercial evidence records are immutable; append a revision.');
    END
  `,
  trg_commercial_test_records_immutable_delete: `
    CREATE TRIGGER IF NOT EXISTS trg_commercial_test_records_immutable_delete
    BEFORE DELETE ON commercial_test_evidence_records
    BEGIN
      SELECT RAISE(ABORT, 'Commercial evidence records are immutable.');
    END
  `,
  trg_commercial_test_evaluations_immutable_update: `
    CREATE TRIGGER IF NOT EXISTS trg_commercial_test_evaluations_immutable_update
    BEFORE UPDATE ON commercial_test_proof_evaluations
    BEGIN
      SELECT RAISE(ABORT, 'Commercial proof evaluations are append-only.');
    END
  `,
  trg_commercial_test_evaluations_immutable_delete: `
    CREATE TRIGGER IF NOT EXISTS trg_commercial_test_evaluations_immutable_delete
    BEFORE DELETE ON commercial_test_proof_evaluations
    BEGIN
      SELECT RAISE(ABORT, 'Commercial proof evaluations are append-only.');
    END
  `,
});

const COMMERCIAL_LEDGER_REQUIRED_INDEX_SQL = Object.freeze({
  idx_venture_kits_content_identity: `
    CREATE UNIQUE INDEX IF NOT EXISTS idx_venture_kits_content_identity
    ON venture_kits(id, version, content_hash)
  `,
  idx_commercial_test_contract_program: `
    CREATE INDEX IF NOT EXISTS idx_commercial_test_contract_program
    ON commercial_test_contracts(program_id, program_version, created_at DESC)
  `,
  idx_commercial_test_contract_channel: `
    CREATE INDEX IF NOT EXISTS idx_commercial_test_contract_channel
    ON commercial_test_contracts(provider_namespace, account_hash, reporting_starts_at, reporting_ends_at)
  `,
  idx_commercial_test_lifecycle_latest: `
    CREATE INDEX IF NOT EXISTS idx_commercial_test_lifecycle_latest
    ON commercial_test_lifecycle_events(decision_hash, sequence DESC)
  `,
  idx_commercial_test_lifecycle_approval_once: `
    CREATE UNIQUE INDEX IF NOT EXISTS idx_commercial_test_lifecycle_approval_once
    ON commercial_test_lifecycle_events(approval_id)
    WHERE approval_id IS NOT NULL
      AND event_type IN ('accepted', 'activated')
  `,
  idx_commercial_test_receipt_source: `
    CREATE INDEX IF NOT EXISTS idx_commercial_test_receipt_source
    ON commercial_test_evidence_receipts(decision_hash, source_kind, source_id, captured_at)
  `,
  idx_commercial_test_evidence_time: `
    CREATE INDEX IF NOT EXISTS idx_commercial_test_evidence_time
    ON commercial_test_evidence_records(decision_hash, captured_at, evidence_id)
  `,
  idx_commercial_test_transaction_key: `
    CREATE INDEX IF NOT EXISTS idx_commercial_test_transaction_key
    ON commercial_test_evidence_records(decision_hash, transaction_key, transaction_chain_sequence)
    WHERE transaction_key IS NOT NULL
  `,
  idx_commercial_test_transaction_identity: `
    CREATE INDEX IF NOT EXISTS idx_commercial_test_transaction_identity
    ON commercial_test_evidence_records(decision_hash, transaction_id_hash)
    WHERE transaction_id_hash IS NOT NULL
  `,
  idx_commercial_test_buyer: `
    CREATE INDEX IF NOT EXISTS idx_commercial_test_buyer
    ON commercial_test_evidence_records(decision_hash, buyer_pseudonym)
    WHERE buyer_pseudonym IS NOT NULL
  `,
  idx_commercial_test_cost_key: `
    CREATE INDEX IF NOT EXISTS idx_commercial_test_cost_key
    ON commercial_test_evidence_records(decision_hash, cost_key, cost_chain_sequence)
    WHERE cost_key IS NOT NULL
  `,
  idx_commercial_test_cost_identity: `
    CREATE INDEX IF NOT EXISTS idx_commercial_test_cost_identity
    ON commercial_test_evidence_records(decision_hash, cost_id_hash)
    WHERE cost_id_hash IS NOT NULL
  `,
  idx_commercial_test_supersession: `
    CREATE UNIQUE INDEX IF NOT EXISTS idx_commercial_test_supersession
    ON commercial_test_evidence_records(supersedes_record_hash)
    WHERE supersedes_record_hash IS NOT NULL
  `,
  idx_commercial_test_proof_latest: `
    CREATE INDEX IF NOT EXISTS idx_commercial_test_proof_latest
    ON commercial_test_proof_evaluations(decision_hash, evaluated_at DESC, evaluation_hash)
  `,
});

const REQUIRED_SCHEMA_SHAPE = Object.freeze({
  settings: ["key", "value", "updated_at"],
  ventures: ["id", "status", "lifecycle_stage", "is_active", "metadata"],
  commands: ["id", "status", "workflow_id", "venture_id", "metadata"],
  workflows: ["id", "venture_id", "status", "metadata", "updated_at"],
  tasks: ["id", "workflow_id", "venture_id", "claim_token", "outcome_status"],
  approvals: ["id", "workflow_id", "venture_id", "task_id", "scope_hash", "consumed_at"],
  task_attempts: ["id", "task_id", "claim_token", "status", "outcome_status"],
  deliverables: ["id", "workflow_id", "venture_id", "status", "file_path", "content_hash", "metadata"],
  deliverable_quality_reviews: [
    "id",
    "deliverable_id",
    "verdict",
    "input_hash",
    "findings",
    "created_at",
  ],
  model_calls: [
    "id",
    "task_id",
    "provider_request_id",
    "cost_status",
    "outcome_status",
    "error",
    "completed_at",
  ],
  commercial_results: [
    "id",
    "venture_id",
    "revenue_cents",
    "refund_amount_cents",
    "platform_fee_cents",
    "fulfilment_cost_cents",
    "product_cost_cents",
    "tool_cost_cents",
    "attributed_ai_cost_cents",
    "other_cost_cents",
    "verified",
  ],
  platform_sales: [
    "id",
    "venture_id",
    "platform",
    "platform_purchase_id",
    "buyer_hash",
    "status",
    "gross_cents",
    "currency",
    "aud_gross_cents",
    "aud_net_cents",
  ],
  accounting_entries: [
    "id",
    "venture_id",
    "entry_type",
    "effect_sign",
    "amount_cents",
    "currency",
    "status",
    "source",
    "metadata",
  ],
  costs: [
    "id",
    "venture_id",
    "status",
    "amount_cents",
    "currency",
    "metadata",
  ],
  revenue: ["id", "venture_id", "status", "amount_cents", "currency", "metadata"],
  events: ["id", "ts", "actor", "type", "entity_type", "entity_id", "metadata", "venture_id"],
  commercial_evidence: [
    "id",
    "venture_id",
    "source_type",
    "source_url",
    "claim",
    "metric",
    "measured_value",
    "measured_unit",
    "market",
    "geography",
    "observed_at",
    "sample_size",
  ],
  opportunity_rounds: ["id", "status", "mode", "prompt", "created_at"],
  opportunities: ["id", "round_id", "source_type", "status", "overall_score", "evidence_ids"],
  catalogue_plans: ["id", "venture_id", "opportunity_id", "status", "target_item_count"],
  catalogue_items: ["id", "plan_id", "venture_id", "status", "quality_status"],
  commercial_diagnoses: ["id", "experiment_id", "status", "primary_constraint", "dimensions"],
  operating_mandates: ["id", "period_start", "period_end", "budget_cap_cents", "status"],
  supervisor_cycles: ["id", "status", "trigger_type", "next_action_type", "created_at"],
  pantheon_journeys: ["id", "venture_id", "status", "active_stage", "workflow_id", "metadata"],
  commercial_knowledge: [
    "id",
    "source_id",
    "knowledge_class",
    "domain",
    "proposition",
    "confidence",
    "review_date",
    "status",
    "version",
  ],
  commercial_decision_cases: [
    "id",
    "status",
    "recommendation",
    "criteria",
    "missing_evidence",
    "decision_hash",
  ],
  service_trials: ["id", "service_name", "status", "cap_cents", "hypothesis", "retention_thresholds"],
  venture_kits: [
    "id",
    "version",
    "status",
    "business_models",
    "acceptance_criteria",
    "content_hash",
  ],
  capability_assurance_records: [
    "id",
    "capability_key",
    "proof_kind",
    "source_framework",
    "source_record_id",
    "status",
  ],
  agent_run_receipts: [
    "id",
    "attempt_id",
    "run_id",
    "task_id",
    "status",
    "outcome_status",
    "snapshot_hash",
    "receipt_hash",
    "receipt",
    "created_at",
  ],
  agent_run_provenance: [
    "id",
    "fingerprint",
    "run_id",
    "task_id",
    "kind",
    "input_hash",
    "output_hash",
    "metadata",
  ],
  venture_records: [
    "id",
    "venture_id",
    "record_class",
    "record_type",
    "content_hash",
    "metadata",
    "created_at",
  ],
  data_retention_policy_activations: [
    "id",
    "policy_id",
    "policy_hash",
    "approval_id",
    "proof_hash",
    "activated_at",
  ],
  commercial_test_contracts: [
    "decision_hash",
    "contract_schema",
    "program_id",
    "program_version",
    "test_id",
    "test_version",
    "venture_id",
    "venture_kit_id",
    "venture_kit_version",
    "venture_kit_hash",
    "offer_id",
    "offer_version",
    "offer_hash",
    "offer_sku",
    "experiment_id",
    "experiment_version",
    "cohort_id",
    "channel_id",
    "provider_namespace",
    "account_hash",
    "adapter_id",
    "adapter_version",
    "adapter_hash",
    "reporting_starts_at",
    "reporting_ends_at",
    "buyer_key_id",
    "buyer_key_version",
    "buyer_independence_basis",
    "price_aud_cents",
    "operator_role",
    "external_spend_cap_cents",
    "contract_json",
  ],
  commercial_test_lifecycle_events: [
    "id",
    "decision_hash",
    "sequence",
    "previous_event_hash",
    "event_type",
    "event_hash",
    "approval_scope_hash",
    "event_json",
    "occurred_at",
  ],
  commercial_test_evidence_receipts: [
    "decision_hash",
    "receipt_id",
    "receipt_schema",
    "source_kind",
    "source_id",
    "provider_namespace",
    "account_hash",
    "source_system",
    "export_type",
    "source_hash",
    "receipt_hash",
    "location_reference",
    "verification_status",
    "reporting_starts_at",
    "reporting_ends_at",
    "coverage_basis",
    "coverage_declared_row_count",
    "coverage_control_hash",
    "generated_at",
    "imported_at",
    "import_batch_id",
    "manual_reference_hash",
    "attested_by",
    "attestation_note",
    "entry_reason",
    "receipt_json",
    "captured_at",
  ],
  commercial_test_evidence_records: [
    "record_hash",
    "evidence_schema",
    "decision_hash",
    "evidence_id",
    "evidence_version",
    "kind",
    "source_kind",
    "source_id",
    "provider_namespace",
    "account_hash",
    "source_system",
    "export_type",
    "source_hash",
    "source_row_hash",
    "receipt_id",
    "receipt_hash",
    "verification_status",
    "reporting_starts_at",
    "reporting_ends_at",
    "coverage_basis",
    "coverage_declared_row_count",
    "coverage_control_hash",
    "captured_at",
    "supersedes_record_hash",
    "transaction_key",
    "transaction_id_hash",
    "transaction_economic_hash",
    "buyer_pseudonym",
    "buyer_key_id",
    "buyer_key_version",
    "buyer_independence_basis",
    "transaction_event_type",
    "transaction_chain_sequence",
    "transaction_status",
    "settlement_state",
    "settlement_reference_hash",
    "occurred_at",
    "settled_at",
    "gross_revenue_original_minor_units",
    "gross_revenue_currency",
    "gross_revenue_aud_cents",
    "refunds_original_minor_units",
    "refunds_currency",
    "refunds_aud_cents",
    "cost_key",
    "cost_id_hash",
    "cost_economic_hash",
    "cost_event_type",
    "cost_chain_sequence",
    "cost_category",
    "cost_state",
    "cost_original_minor_units",
    "cost_currency",
    "cost_aud_cents",
    "attribution_status",
    "record_json",
  ],
  commercial_test_proof_evaluations: [
    "evaluation_hash",
    "proof_schema",
    "decision_hash",
    "evidence_set_hash",
    "outcome",
    "proof_reached",
    "buyer_signal_only",
    "distinct_positive_buyers",
    "settled_revenue_aud_cents",
    "refunds_aud_cents",
    "reconciled_costs_aud_cents",
    "actual_net_cash_contribution_aud_cents",
    "evaluation_json",
    "evaluated_at",
  ],
});

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

function normalizeSchemaSql(value) {
  return String(value || "")
    .trim()
    .replace(/;\s*$/, "")
    .replace(/\bIF\s+NOT\s+EXISTS\b/gi, "")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function recoverySchemaObjects(db) {
  return all(
    db,
    `SELECT type, name, tbl_name, sql
     FROM sqlite_master
     WHERE type IN ('table', 'index', 'trigger')
       AND sql IS NOT NULL
       AND name NOT LIKE 'sqlite_%'
     ORDER BY type, name`,
  ).map((row) => ({
    type: String(row.type),
    name: String(row.name),
    tableName: String(row.tbl_name),
    sql: normalizeSchemaSql(row.sql),
  }));
}

function canonicalRecoverySchemaContract() {
  if (canonicalRecoverySchemaContractCache) return canonicalRecoverySchemaContractCache;
  const reference = new DatabaseSync(":memory:");
  try {
    reference.exec("PRAGMA foreign_keys = ON");
    migrate(reference);
    canonicalRecoverySchemaContractCache = Object.freeze({
      schemaVersion: LATEST_SCHEMA_VERSION,
      migrations: Object.freeze(
        all(
          reference,
          "SELECT version, name FROM schema_migrations ORDER BY version",
        ).map((row) => Object.freeze({
          version: Number(row.version),
          name: String(row.name),
        })),
      ),
      objects: Object.freeze(
        recoverySchemaObjects(reference).map((row) => Object.freeze(row)),
      ),
    });
    return canonicalRecoverySchemaContractCache;
  } finally {
    reference.close();
  }
}

function verifyCanonicalRecoverySchema(db) {
  const expected = canonicalRecoverySchemaContract();
  const actualMigrations = all(
    db,
    "SELECT version, name FROM schema_migrations ORDER BY version",
  ).map((row) => ({
    version: Number(row.version),
    name: String(row.name),
  }));
  if (JSON.stringify(actualMigrations) !== JSON.stringify(expected.migrations)) {
    throw new Error("Runtime schema migration history does not match the exact supported release.");
  }

  const expectedObjects = new Map(expected.objects.map((object) => [object.name, object]));
  const actualObjects = new Map(recoverySchemaObjects(db).map((object) => [object.name, object]));
  for (const [name, expectedObject] of expectedObjects) {
    const actualObject = actualObjects.get(name);
    if (!actualObject) {
      throw new Error(
        `Runtime schema is missing required ${expectedObject.type} ${name}.`,
      );
    }
    if (
      actualObject.type !== expectedObject.type
      || actualObject.tableName !== expectedObject.tableName
      || actualObject.sql !== expectedObject.sql
    ) {
      throw new Error(
        `Runtime schema ${expectedObject.type} ${name} does not match the exact supported definition.`,
      );
    }
  }
  return {
    migrationCount: expected.migrations.length,
    objectCount: expected.objects.length,
  };
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
  for (const [tableName, requiredColumns] of Object.entries(REQUIRED_SCHEMA_SHAPE)) {
    const table = get(
      db,
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
      [tableName],
    );
    if (!table) throw new Error(`Runtime schema is missing required table ${tableName}.`);
    const columns = tableColumns(db, tableName);
    const missing = requiredColumns.filter((column) => !columns.has(column));
    if (missing.length) {
      throw new Error(`Runtime schema table ${tableName} is missing: ${missing.join(", ")}.`);
    }
  }
  const requiredTriggerNames = [
    "trg_tasks_venture_match_insert",
    "trg_tasks_venture_match_update",
    "trg_approvals_venture_match_insert",
    "trg_approvals_venture_match_update",
    "trg_accounting_reconciled_immutable_update",
    "trg_accounting_reconciled_immutable_delete",
    "trg_agent_run_receipts_immutable_update",
    "trg_agent_run_receipts_immutable_delete",
    "trg_agent_run_provenance_immutable_update",
    "trg_agent_run_provenance_immutable_delete",
    "trg_venture_records_immutable_update",
    "trg_venture_records_immutable_delete",
    "trg_deliverable_quality_reviews_immutable_update",
    "trg_deliverable_quality_reviews_immutable_delete",
    ...Object.keys(COMMERCIAL_LEDGER_IMMUTABLE_TRIGGER_SQL),
  ];
  for (const triggerName of requiredTriggerNames) {
    const trigger = get(
      db,
      "SELECT name, sql FROM sqlite_master WHERE type = 'trigger' AND name = ?",
      [triggerName],
    );
    if (!trigger) throw new Error(`Runtime schema is missing required fail-closed trigger ${triggerName}.`);
    if (!/\bBEFORE\b/i.test(trigger.sql || "") || !/RAISE\s*\(\s*ABORT\b/i.test(trigger.sql || "")) {
      throw new Error(`Runtime schema trigger ${triggerName} does not retain its fail-closed abort contract.`);
    }
  }
  for (const [triggerName, expectedSql] of Object.entries(
    COMMERCIAL_LEDGER_IMMUTABLE_TRIGGER_SQL,
  )) {
    const actualSql = get(
      db,
      "SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = ?",
      [triggerName],
    )?.sql;
    if (normalizeSchemaSql(actualSql) !== normalizeSchemaSql(expectedSql)) {
      throw new Error(
        `Runtime schema trigger ${triggerName} does not match its exact immutable definition.`,
      );
    }
  }
  for (const [indexName, expectedSql] of Object.entries(
    COMMERCIAL_LEDGER_REQUIRED_INDEX_SQL,
  )) {
    const actualSql = get(
      db,
      "SELECT sql FROM sqlite_master WHERE type = 'index' AND name = ?",
      [indexName],
    )?.sql;
    if (normalizeSchemaSql(actualSql) !== normalizeSchemaSql(expectedSql)) {
      throw new Error(
        `Runtime schema index ${indexName} does not match its required ledger definition.`,
      );
    }
  }
  verifyCanonicalRecoverySchema(db);
  const {
    ventureKitContentHash,
  } = require("./runtime/venture-kit-definition");
  for (const kit of all(db, "SELECT * FROM venture_kits ORDER BY id, version")) {
    let expectedHash;
    try {
      expectedHash = ventureKitContentHash(kit);
    } catch (error) {
      throw new Error(
        `Runtime Venture Kit ${kit.id}@${kit.version} cannot be verified: ${error.message}`,
      );
    }
    if (kit.content_hash !== expectedHash) {
      throw new Error(
        `Runtime Venture Kit ${kit.id}@${kit.version} does not match its immutable content hash.`,
      );
    }
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

function applyAgentOperationsEvidenceMigration(db) {
  if (migrationApplied(db, 12)) return;
  db.exec("BEGIN IMMEDIATE");
  try {
    addColumn(db, "task_attempts", "provider_dispatched_at TEXT");
    addColumn(db, "task_attempts", "provider_dispatch_model_call_id TEXT");
    addColumn(db, "agent_eval_results", "evaluator_version TEXT NOT NULL DEFAULT 'local-structural-v1'");
    addColumn(db, "agent_eval_results", "subject_hash TEXT");

    db.exec(`
      CREATE TABLE IF NOT EXISTS agent_run_receipts (
        id TEXT PRIMARY KEY,
        attempt_id TEXT NOT NULL,
        run_id TEXT,
        task_id TEXT NOT NULL,
        sequence INTEGER NOT NULL,
        status TEXT NOT NULL,
        outcome_status TEXT NOT NULL,
        snapshot_hash TEXT NOT NULL,
        previous_hash TEXT,
        receipt_hash TEXT NOT NULL UNIQUE,
        missing_fields TEXT NOT NULL DEFAULT '[]',
        warnings TEXT NOT NULL DEFAULT '[]',
        receipt TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(attempt_id, snapshot_hash),
        UNIQUE(attempt_id, sequence),
        FOREIGN KEY (attempt_id) REFERENCES task_attempts(id),
        FOREIGN KEY (run_id) REFERENCES agent_runs(id),
        FOREIGN KEY (task_id) REFERENCES tasks(id)
      );

      CREATE TABLE IF NOT EXISTS agent_run_provenance (
        id TEXT PRIMARY KEY,
        fingerprint TEXT NOT NULL UNIQUE,
        run_id TEXT NOT NULL,
        attempt_id TEXT,
        task_id TEXT NOT NULL,
        model_call_id TEXT,
        tool_invocation_id TEXT,
        research_run_id TEXT,
        research_source_id TEXT,
        kind TEXT NOT NULL,
        provider_external_id TEXT,
        title TEXT,
        url TEXT,
        grounding_type TEXT NOT NULL,
        input_hash TEXT,
        output_hash TEXT,
        metadata TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        FOREIGN KEY (run_id) REFERENCES agent_runs(id),
        FOREIGN KEY (attempt_id) REFERENCES task_attempts(id),
        FOREIGN KEY (task_id) REFERENCES tasks(id),
        FOREIGN KEY (model_call_id) REFERENCES model_calls(id),
        FOREIGN KEY (tool_invocation_id) REFERENCES agent_tool_invocations(id),
        FOREIGN KEY (research_run_id) REFERENCES research_runs(id),
        FOREIGN KEY (research_source_id) REFERENCES research_sources(id)
      );

      CREATE INDEX IF NOT EXISTS idx_agent_run_receipts_run
        ON agent_run_receipts(run_id, sequence DESC);
      CREATE INDEX IF NOT EXISTS idx_agent_run_receipts_status
        ON agent_run_receipts(status, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_agent_run_provenance_run
        ON agent_run_provenance(run_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_agent_run_provenance_source
        ON agent_run_provenance(research_source_id);

      CREATE TRIGGER IF NOT EXISTS trg_agent_run_receipts_immutable_update
      BEFORE UPDATE ON agent_run_receipts
      BEGIN
        SELECT RAISE(ABORT, 'Agent run receipts are immutable; append a new receipt.');
      END;

      CREATE TRIGGER IF NOT EXISTS trg_agent_run_receipts_immutable_delete
      BEFORE DELETE ON agent_run_receipts
      BEGIN
        SELECT RAISE(ABORT, 'Agent run receipts are immutable; append a new receipt.');
      END;

      CREATE TRIGGER IF NOT EXISTS trg_agent_run_provenance_immutable_update
      BEFORE UPDATE ON agent_run_provenance
      BEGIN
        SELECT RAISE(ABORT, 'Agent run provenance is immutable.');
      END;

      CREATE TRIGGER IF NOT EXISTS trg_agent_run_provenance_immutable_delete
      BEFORE DELETE ON agent_run_provenance
      BEGIN
        SELECT RAISE(ABORT, 'Agent run provenance is immutable.');
      END;
    `);

    recordMigration(db, 12, "agent-operations-evidence-and-receipts");
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function applyAgentContextMigration(db) {
  if (migrationApplied(db, 13)) return;
  db.exec("BEGIN IMMEDIATE");
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS venture_records (
        id TEXT PRIMARY KEY,
        venture_id TEXT NOT NULL,
        record_class TEXT NOT NULL,
        record_type TEXT NOT NULL,
        title TEXT NOT NULL,
        summary TEXT NOT NULL DEFAULT '',
        content TEXT NOT NULL DEFAULT '{}',
        sensitivity TEXT NOT NULL DEFAULT 'business_internal',
        provider_policy TEXT NOT NULL DEFAULT 'summary_only',
        source_kind TEXT NOT NULL DEFAULT 'operator_record',
        source_reference TEXT,
        content_hash TEXT NOT NULL,
        effective_at TEXT,
        expires_at TEXT,
        supersedes_record_id TEXT,
        metadata TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        FOREIGN KEY (venture_id) REFERENCES ventures(id),
        FOREIGN KEY (supersedes_record_id) REFERENCES venture_records(id),
        CHECK (record_class IN ('venture', 'evidence', 'finance', 'production', 'customer', 'legal', 'operations', 'learning')),
        CHECK (sensitivity IN ('public', 'business_internal', 'confidential', 'personal', 'restricted')),
        CHECK (provider_policy IN ('full', 'summary_only', 'local_only'))
      );

      CREATE TABLE IF NOT EXISTS agent_context_snapshots (
        id TEXT PRIMARY KEY,
        venture_id TEXT NOT NULL,
        workflow_id TEXT,
        task_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        policy_version TEXT NOT NULL,
        access_profile TEXT NOT NULL,
        record_classes TEXT NOT NULL,
        record_count INTEGER NOT NULL DEFAULT 0,
        snapshot_hash TEXT NOT NULL UNIQUE,
        snapshot TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (venture_id) REFERENCES ventures(id),
        FOREIGN KEY (workflow_id) REFERENCES workflows(id),
        FOREIGN KEY (task_id) REFERENCES tasks(id),
        FOREIGN KEY (agent_id) REFERENCES agent_definitions(id)
      );

      CREATE INDEX IF NOT EXISTS idx_venture_records_context
        ON venture_records(venture_id, record_class, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_agent_context_task
        ON agent_context_snapshots(task_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_agent_context_agent
        ON agent_context_snapshots(agent_id, created_at DESC);

      CREATE TRIGGER IF NOT EXISTS trg_venture_records_immutable_update
      BEFORE UPDATE ON venture_records
      BEGIN
        SELECT RAISE(ABORT, 'Venture records are immutable; add a superseding record.');
      END;

      CREATE TRIGGER IF NOT EXISTS trg_venture_records_immutable_delete
      BEFORE DELETE ON venture_records
      BEGIN
        SELECT RAISE(ABORT, 'Venture records are immutable; add a superseding record.');
      END;

      CREATE TRIGGER IF NOT EXISTS trg_agent_context_snapshots_immutable_update
      BEFORE UPDATE ON agent_context_snapshots
      BEGIN
        SELECT RAISE(ABORT, 'Agent context snapshots are immutable; prepare a new assignment.');
      END;

      CREATE TRIGGER IF NOT EXISTS trg_agent_context_snapshots_immutable_delete
      BEFORE DELETE ON agent_context_snapshots
      BEGIN
        SELECT RAISE(ABORT, 'Agent context snapshots are immutable.');
      END;
    `);

    recordMigration(db, 13, "task-scoped-agent-context");
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function applyDeliverableQualityReviewMigration(db) {
  if (migrationApplied(db, 14)) return;
  db.exec("BEGIN IMMEDIATE");
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS deliverable_quality_reviews (
        id TEXT PRIMARY KEY,
        venture_id TEXT NOT NULL,
        workflow_id TEXT NOT NULL,
        deliverable_id TEXT NOT NULL,
        source_run_id TEXT,
        review_task_id TEXT NOT NULL,
        review_run_id TEXT NOT NULL,
        reviewer_agent_id TEXT NOT NULL,
        input_hash TEXT NOT NULL,
        verdict TEXT NOT NULL,
        quality_score INTEGER NOT NULL,
        findings TEXT NOT NULL DEFAULT '[]',
        operator_recommendation TEXT NOT NULL DEFAULT '',
        metadata TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        UNIQUE(deliverable_id, review_run_id),
        FOREIGN KEY (venture_id) REFERENCES ventures(id),
        FOREIGN KEY (workflow_id) REFERENCES workflows(id),
        FOREIGN KEY (deliverable_id) REFERENCES deliverables(id),
        FOREIGN KEY (source_run_id) REFERENCES agent_runs(id),
        FOREIGN KEY (review_task_id) REFERENCES tasks(id),
        FOREIGN KEY (review_run_id) REFERENCES agent_runs(id),
        FOREIGN KEY (reviewer_agent_id) REFERENCES agent_definitions(id),
        CHECK (verdict IN ('passed', 'changes_required', 'blocked'))
      );

      CREATE INDEX IF NOT EXISTS idx_deliverable_quality_current
        ON deliverable_quality_reviews(deliverable_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_deliverable_quality_workflow
        ON deliverable_quality_reviews(workflow_id, created_at DESC);

      CREATE TRIGGER IF NOT EXISTS trg_deliverable_quality_reviews_immutable_update
      BEFORE UPDATE ON deliverable_quality_reviews
      BEGIN
        SELECT RAISE(ABORT, 'Deliverable quality reviews are immutable; run a new review.');
      END;

      CREATE TRIGGER IF NOT EXISTS trg_deliverable_quality_reviews_immutable_delete
      BEFORE DELETE ON deliverable_quality_reviews
      BEGIN
        SELECT RAISE(ABORT, 'Deliverable quality reviews are immutable.');
      END;
    `);

    recordMigration(db, 14, "deliverable-quality-review-gate");
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function applyDataRetentionPolicyMigration(db) {
  if (migrationApplied(db, 15)) return;
  db.exec("BEGIN IMMEDIATE");
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS data_retention_policies (
        id TEXT PRIMARY KEY,
        version INTEGER NOT NULL UNIQUE,
        title TEXT NOT NULL,
        policy TEXT NOT NULL,
        policy_hash TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS retention_tombstones (
        id TEXT PRIMARY KEY,
        policy_id TEXT NOT NULL,
        record_class TEXT NOT NULL,
        record_key_hash TEXT NOT NULL,
        reason TEXT NOT NULL,
        deleted_at TEXT NOT NULL,
        metadata TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        UNIQUE(policy_id, record_class, record_key_hash, deleted_at),
        FOREIGN KEY (policy_id) REFERENCES data_retention_policies(id)
      );

      CREATE INDEX IF NOT EXISTS idx_retention_tombstones_record
        ON retention_tombstones(record_class, record_key_hash, deleted_at DESC);

      CREATE TRIGGER IF NOT EXISTS trg_data_retention_policies_immutable_update
      BEFORE UPDATE ON data_retention_policies
      BEGIN
        SELECT RAISE(ABORT, 'Data-retention policies are immutable; create a new version.');
      END;

      CREATE TRIGGER IF NOT EXISTS trg_data_retention_policies_immutable_delete
      BEFORE DELETE ON data_retention_policies
      BEGIN
        SELECT RAISE(ABORT, 'Data-retention policies are immutable.');
      END;

      CREATE TRIGGER IF NOT EXISTS trg_retention_tombstones_immutable_update
      BEFORE UPDATE ON retention_tombstones
      BEGIN
        SELECT RAISE(ABORT, 'Retention deletion markers are immutable.');
      END;

      CREATE TRIGGER IF NOT EXISTS trg_retention_tombstones_immutable_delete
      BEFORE DELETE ON retention_tombstones
      BEGIN
        SELECT RAISE(ABORT, 'Retention deletion markers are immutable.');
      END;
    `);

    recordMigration(db, 15, "data-retention-policy-and-deletion-markers");
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function applyExecutionEvidenceBindingMigration(db) {
  if (migrationApplied(db, 16)) return;
  db.exec("BEGIN IMMEDIATE");
  try {
    addColumn(db, "task_attempts", "agent_run_id TEXT REFERENCES agent_runs(id)");
    addColumn(db, "task_attempts", "model_call_id TEXT REFERENCES model_calls(id)");
    addColumn(db, "task_attempts", "evidence_binding_status TEXT NOT NULL DEFAULT 'exact_required'");
    addColumn(db, "model_calls", "attempt_id TEXT REFERENCES task_attempts(id)");
    addColumn(db, "agent_eval_results", "attempt_id TEXT REFERENCES task_attempts(id)");
    addColumn(db, "agent_tool_invocations", "attempt_id TEXT REFERENCES task_attempts(id)");
    addColumn(db, "agent_tool_invocations", "observed_attempt_id TEXT REFERENCES task_attempts(id)");

    // Rows that predate exact bindings may use the narrowly labelled compatibility path.
    run(
      db,
      `UPDATE task_attempts
       SET evidence_binding_status = 'legacy_compatibility',
           metadata = json_set(
             CASE WHEN json_valid(metadata) THEN metadata ELSE '{}' END,
             '$.evidenceBindingMigration',
             json_object(
               'schemaVersion', 16,
               'mode', 'legacy_compatibility',
               'note', 'Created before exact attempt evidence bindings were required.'
             )
           )`,
    );

    // Preserve explicit IDs already written into provider metadata. No timestamp matching is used.
    run(
      db,
      `UPDATE model_calls
       SET attempt_id = json_extract(metadata, '$.taskAttemptId')
       WHERE attempt_id IS NULL
         AND json_valid(metadata)
         AND json_type(metadata, '$.taskAttemptId') = 'text'
         AND EXISTS (
           SELECT 1 FROM task_attempts
           WHERE task_attempts.id = json_extract(model_calls.metadata, '$.taskAttemptId')
             AND task_attempts.task_id = model_calls.task_id
         )`,
    );
    run(
      db,
      `UPDATE model_calls
       SET attempt_id = (
         SELECT attempts.id FROM task_attempts AS attempts
         WHERE attempts.provider_dispatch_model_call_id = model_calls.id
           AND attempts.task_id = model_calls.task_id
         LIMIT 1
       )
       WHERE attempt_id IS NULL
         AND 1 = (
           SELECT COUNT(*) FROM task_attempts AS attempts
           WHERE attempts.provider_dispatch_model_call_id = model_calls.id
             AND attempts.task_id = model_calls.task_id
         )`,
    );
    run(
      db,
      `UPDATE task_attempts
       SET model_call_id = COALESCE(
         CASE WHEN EXISTS (
           SELECT 1 FROM model_calls
           WHERE model_calls.id = task_attempts.provider_dispatch_model_call_id
             AND model_calls.task_id = task_attempts.task_id
         ) THEN provider_dispatch_model_call_id END,
         (
           SELECT model_calls.id FROM model_calls
           WHERE model_calls.attempt_id = task_attempts.id
             AND model_calls.task_id = task_attempts.task_id
           ORDER BY model_calls.created_at DESC, model_calls.id DESC
           LIMIT 1
         )
       )
       WHERE model_call_id IS NULL`,
    );
    run(
      db,
      `UPDATE task_attempts
       SET agent_run_id = (
         SELECT json_extract(model_calls.metadata, '$.agentRunId')
         FROM model_calls
         JOIN agent_runs
           ON agent_runs.id = json_extract(model_calls.metadata, '$.agentRunId')
          AND agent_runs.task_id = task_attempts.task_id
         WHERE model_calls.attempt_id = task_attempts.id
           AND json_valid(model_calls.metadata)
           AND json_type(model_calls.metadata, '$.agentRunId') = 'text'
         ORDER BY model_calls.created_at DESC, model_calls.id DESC
         LIMIT 1
       )
       WHERE agent_run_id IS NULL
         AND EXISTS (
           SELECT 1 FROM model_calls
           JOIN agent_runs
             ON agent_runs.id = json_extract(model_calls.metadata, '$.agentRunId')
            AND agent_runs.task_id = task_attempts.task_id
           WHERE model_calls.attempt_id = task_attempts.id
             AND json_valid(model_calls.metadata)
             AND json_type(model_calls.metadata, '$.agentRunId') = 'text'
         )`,
    );
    run(
      db,
      `UPDATE task_attempts
       SET agent_run_id = (
         SELECT agent_runs.id FROM agent_runs
         WHERE agent_runs.model_call_id = task_attempts.model_call_id
           AND agent_runs.task_id = task_attempts.task_id
         LIMIT 1
       )
       WHERE agent_run_id IS NULL
         AND model_call_id IS NOT NULL
         AND 1 = (
           SELECT COUNT(*) FROM agent_runs
           WHERE agent_runs.model_call_id = task_attempts.model_call_id
             AND agent_runs.task_id = task_attempts.task_id
         )`,
    );
    run(
      db,
      `UPDATE agent_eval_results
       SET attempt_id = (
         SELECT attempts.id FROM task_attempts AS attempts
         WHERE attempts.agent_run_id = agent_eval_results.run_id
           AND attempts.task_id = agent_eval_results.task_id
         LIMIT 1
       )
       WHERE attempt_id IS NULL
         AND 1 = (
           SELECT COUNT(*) FROM task_attempts AS attempts
           WHERE attempts.agent_run_id = agent_eval_results.run_id
             AND attempts.task_id = agent_eval_results.task_id
         )`,
    );
    run(
      db,
      `UPDATE agent_tool_invocations
       SET attempt_id = json_extract(metadata, '$.taskAttemptId')
       WHERE attempt_id IS NULL
         AND json_valid(metadata)
         AND json_type(metadata, '$.taskAttemptId') = 'text'
         AND EXISTS (
           SELECT 1 FROM task_attempts
           WHERE task_attempts.id = json_extract(agent_tool_invocations.metadata, '$.taskAttemptId')
             AND task_attempts.task_id = agent_tool_invocations.task_id
         )`,
    );

    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_task_attempts_agent_run
        ON task_attempts(agent_run_id, completed_at DESC);
      CREATE INDEX IF NOT EXISTS idx_task_attempts_model_call
        ON task_attempts(model_call_id);
      CREATE INDEX IF NOT EXISTS idx_model_calls_attempt
        ON model_calls(attempt_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_agent_eval_results_attempt
        ON agent_eval_results(attempt_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_agent_tool_invocations_attempt
        ON agent_tool_invocations(attempt_id, requested_at);
      CREATE INDEX IF NOT EXISTS idx_agent_tool_invocations_observed_attempt
        ON agent_tool_invocations(observed_attempt_id, resolved_at);

      CREATE TRIGGER IF NOT EXISTS trg_task_attempt_agent_run_binding_immutable
      BEFORE UPDATE OF agent_run_id ON task_attempts
      FOR EACH ROW WHEN OLD.agent_run_id IS NOT NULL AND NEW.agent_run_id IS NOT OLD.agent_run_id
      BEGIN
        SELECT RAISE(ABORT, 'An attempt cannot be rebound to a different agent run.');
      END;

      CREATE TRIGGER IF NOT EXISTS trg_task_attempt_model_call_binding_immutable
      BEFORE UPDATE OF model_call_id ON task_attempts
      FOR EACH ROW WHEN OLD.model_call_id IS NOT NULL AND NEW.model_call_id IS NOT OLD.model_call_id
      BEGIN
        SELECT RAISE(ABORT, 'An attempt cannot be rebound to a different model call.');
      END;

      CREATE TRIGGER IF NOT EXISTS trg_model_call_attempt_binding_immutable
      BEFORE UPDATE OF attempt_id ON model_calls
      FOR EACH ROW WHEN OLD.attempt_id IS NOT NULL AND NEW.attempt_id IS NOT OLD.attempt_id
      BEGIN
        SELECT RAISE(ABORT, 'A model call cannot be rebound to a different attempt.');
      END;

      CREATE TRIGGER IF NOT EXISTS trg_agent_eval_attempt_binding_immutable
      BEFORE UPDATE OF attempt_id ON agent_eval_results
      FOR EACH ROW WHEN OLD.attempt_id IS NOT NULL AND NEW.attempt_id IS NOT OLD.attempt_id
      BEGIN
        SELECT RAISE(ABORT, 'An evaluation cannot be rebound to a different attempt.');
      END;

      CREATE TRIGGER IF NOT EXISTS trg_agent_tool_attempt_binding_immutable
      BEFORE UPDATE OF attempt_id ON agent_tool_invocations
      FOR EACH ROW WHEN OLD.attempt_id IS NOT NULL AND NEW.attempt_id IS NOT OLD.attempt_id
      BEGIN
        SELECT RAISE(ABORT, 'A tool request cannot be rebound to a different attempt.');
      END;

      CREATE TRIGGER IF NOT EXISTS trg_agent_tool_observation_binding_immutable
      BEFORE UPDATE OF observed_attempt_id ON agent_tool_invocations
      FOR EACH ROW WHEN OLD.observed_attempt_id IS NOT NULL AND NEW.observed_attempt_id IS NOT OLD.observed_attempt_id
      BEGIN
        SELECT RAISE(ABORT, 'A provider tool observation cannot be rebound to a different attempt.');
      END;
    `);

    recordMigration(db, 16, "exact-agent-execution-evidence-bindings");
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function applyProviderAttemptReceiptBackfillMigration(db) {
  if (migrationApplied(db, 17)) return;
  db.exec("BEGIN IMMEDIATE");
  try {
    run(
      db,
      `UPDATE task_attempts
       SET provider_request_id = (
         SELECT model_calls.provider_request_id
         FROM model_calls
         WHERE model_calls.id = task_attempts.model_call_id
           AND model_calls.task_id = task_attempts.task_id
       ),
       metadata = json_set(
         CASE WHEN json_valid(metadata) THEN metadata ELSE '{}' END,
         '$.providerRequestIdBackfill',
         json_object(
           'schemaVersion', 17,
           'source', 'exact_model_call_binding'
         )
       )
       WHERE provider_request_id IS NULL
         AND model_call_id IS NOT NULL
         AND EXISTS (
           SELECT 1
           FROM model_calls
           WHERE model_calls.id = task_attempts.model_call_id
             AND model_calls.task_id = task_attempts.task_id
             AND model_calls.provider_request_id IS NOT NULL
         )`,
    );
    recordMigration(db, 17, "provider-request-attempt-receipt-backfill");
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function applyStableSpendCostIdMigration(db) {
  if (migrationApplied(db, 18)) return;
  db.exec("BEGIN IMMEDIATE");
  try {
    const costs = all(
      db,
      `SELECT id, task_id, metadata
       FROM costs
       WHERE task_id IS NOT NULL
         AND category IN ('live_ai_worker', 'live_research')`,
    );
    for (const cost of costs) {
      const stableId = spendCostId(cost.task_id);
      if (cost.id === stableId) continue;
      const conflict = get(db, "SELECT id FROM costs WHERE id = ?", [stableId]);
      if (conflict) {
        run(
          db,
          "UPDATE costs SET metadata = ? WHERE id = ?",
          [
            toJson({
              ...fromJson(cost.metadata, {}),
              stableIdMigrationConflict: {
                targetId: stableId,
                schemaVersion: 18,
                requiresReview: true,
              },
            }),
            cost.id,
          ],
        );
        continue;
      }
      run(
        db,
        "UPDATE costs SET id = ?, metadata = ? WHERE id = ?",
        [
          stableId,
          toJson({
            ...fromJson(cost.metadata, {}),
            stableIdMigration: {
              previousId: cost.id,
              schemaVersion: 18,
            },
          }),
          cost.id,
        ],
      );
    }
    recordMigration(db, 18, "stable-spend-cost-identifiers");
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function applyPantheonCommercialOperatingModelMigration(db) {
  if (migrationApplied(db, 19)) return;
  db.exec("BEGIN IMMEDIATE");
  try {
    addColumn(db, "commercial_results", "refund_amount_cents INTEGER NOT NULL DEFAULT 0");
    addColumn(db, "commercial_results", "fulfilment_cost_cents INTEGER NOT NULL DEFAULT 0");
    addColumn(db, "commercial_results", "attributed_ai_cost_cents INTEGER NOT NULL DEFAULT 0");
    addColumn(db, "commercial_results", "other_cost_cents INTEGER NOT NULL DEFAULT 0");

    addColumn(db, "commercial_evidence", "claim TEXT NOT NULL DEFAULT ''");
    addColumn(db, "commercial_evidence", "metric TEXT NOT NULL DEFAULT ''");
    addColumn(db, "commercial_evidence", "measured_value REAL");
    addColumn(db, "commercial_evidence", "measured_unit TEXT NOT NULL DEFAULT ''");
    addColumn(db, "commercial_evidence", "market TEXT NOT NULL DEFAULT ''");
    addColumn(db, "commercial_evidence", "geography TEXT NOT NULL DEFAULT ''");
    addColumn(db, "commercial_evidence", "observed_at TEXT");
    addColumn(db, "commercial_evidence", "sample_size INTEGER");
    addColumn(db, "commercial_evidence", "publisher TEXT NOT NULL DEFAULT ''");
    addColumn(db, "commercial_evidence", "extraction_method TEXT NOT NULL DEFAULT ''");
    addColumn(db, "commercial_evidence", "confidence TEXT NOT NULL DEFAULT 'unknown'");

    db.exec(`
      CREATE TABLE IF NOT EXISTS opportunity_rounds (
        id TEXT PRIMARY KEY,
        venture_id TEXT,
        status TEXT NOT NULL,
        mode TEXT NOT NULL,
        prompt TEXT NOT NULL,
        geography TEXT NOT NULL DEFAULT 'global',
        language TEXT NOT NULL DEFAULT 'English',
        max_candidates INTEGER NOT NULL DEFAULT 5,
        started_at TEXT,
        completed_at TEXT,
        created_by TEXT NOT NULL DEFAULT 'pantheon',
        metadata TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (venture_id) REFERENCES ventures(id)
      );

      CREATE TABLE IF NOT EXISTS opportunities (
        id TEXT PRIMARY KEY,
        round_id TEXT,
        venture_id TEXT,
        source_type TEXT NOT NULL,
        status TEXT NOT NULL,
        title TEXT NOT NULL,
        business_model TEXT NOT NULL,
        buyer TEXT NOT NULL DEFAULT '',
        problem TEXT NOT NULL DEFAULT '',
        offer_direction TEXT NOT NULL DEFAULT '',
        geography TEXT NOT NULL DEFAULT 'global',
        language TEXT NOT NULL DEFAULT 'English',
        channel TEXT NOT NULL DEFAULT '',
        demand_score INTEGER NOT NULL DEFAULT 0,
        supply_gap_score INTEGER NOT NULL DEFAULT 0,
        economics_score INTEGER NOT NULL DEFAULT 0,
        channel_fit_score INTEGER NOT NULL DEFAULT 0,
        execution_fit_score INTEGER NOT NULL DEFAULT 0,
        risk_score INTEGER NOT NULL DEFAULT 0,
        overall_score INTEGER NOT NULL DEFAULT 0,
        confidence TEXT NOT NULL DEFAULT 'low',
        recommendation TEXT NOT NULL DEFAULT '',
        smallest_validation TEXT NOT NULL DEFAULT '',
        evidence_ids TEXT NOT NULL DEFAULT '[]',
        metadata TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (round_id) REFERENCES opportunity_rounds(id),
        FOREIGN KEY (venture_id) REFERENCES ventures(id)
      );

      CREATE TABLE IF NOT EXISTS catalogue_plans (
        id TEXT PRIMARY KEY,
        venture_id TEXT NOT NULL,
        opportunity_id TEXT,
        status TEXT NOT NULL,
        title TEXT NOT NULL,
        rationale TEXT NOT NULL DEFAULT '',
        target_item_count INTEGER NOT NULL DEFAULT 1,
        target_variant_count INTEGER NOT NULL DEFAULT 0,
        audience_segments TEXT NOT NULL DEFAULT '[]',
        channels TEXT NOT NULL DEFAULT '[]',
        geographies TEXT NOT NULL DEFAULT '[]',
        languages TEXT NOT NULL DEFAULT '["English"]',
        price_floor_cents INTEGER NOT NULL DEFAULT 0,
        price_ceiling_cents INTEGER NOT NULL DEFAULT 0,
        estimated_build_cost_cents INTEGER NOT NULL DEFAULT 0,
        estimated_unit_cost_cents INTEGER NOT NULL DEFAULT 0,
        metadata TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (venture_id) REFERENCES ventures(id),
        FOREIGN KEY (opportunity_id) REFERENCES opportunities(id)
      );

      CREATE TABLE IF NOT EXISTS catalogue_items (
        id TEXT PRIMARY KEY,
        plan_id TEXT NOT NULL,
        venture_id TEXT NOT NULL,
        parent_item_id TEXT,
        status TEXT NOT NULL,
        quality_status TEXT NOT NULL DEFAULT 'not_reviewed',
        title TEXT NOT NULL,
        product_type TEXT NOT NULL,
        audience TEXT NOT NULL DEFAULT '',
        geography TEXT NOT NULL DEFAULT 'global',
        language TEXT NOT NULL DEFAULT 'English',
        offer TEXT NOT NULL DEFAULT '',
        price_cents INTEGER NOT NULL DEFAULT 0,
        deliverable_id TEXT,
        metadata TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (plan_id) REFERENCES catalogue_plans(id),
        FOREIGN KEY (venture_id) REFERENCES ventures(id),
        FOREIGN KEY (parent_item_id) REFERENCES catalogue_items(id),
        FOREIGN KEY (deliverable_id) REFERENCES deliverables(id)
      );

      CREATE TABLE IF NOT EXISTS commercial_diagnoses (
        id TEXT PRIMARY KEY,
        venture_id TEXT NOT NULL,
        experiment_id TEXT NOT NULL,
        result_id TEXT,
        status TEXT NOT NULL,
        primary_constraint TEXT NOT NULL,
        dimensions TEXT NOT NULL DEFAULT '{}',
        evidence_needed TEXT NOT NULL DEFAULT '[]',
        recommended_test TEXT NOT NULL DEFAULT '',
        decision TEXT NOT NULL DEFAULT '',
        metadata TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (venture_id) REFERENCES ventures(id),
        FOREIGN KEY (experiment_id) REFERENCES commercial_experiments(id),
        FOREIGN KEY (result_id) REFERENCES commercial_results(id)
      );

      CREATE TABLE IF NOT EXISTS operating_mandates (
        id TEXT PRIMARY KEY,
        period_start TEXT NOT NULL,
        period_end TEXT NOT NULL,
        currency TEXT NOT NULL DEFAULT 'AUD' CHECK(currency = 'AUD'),
        budget_cap_cents INTEGER NOT NULL,
        reinvestment_rate REAL NOT NULL DEFAULT 0.30,
        status TEXT NOT NULL,
        allowed_internal_actions TEXT NOT NULL DEFAULT '[]',
        protected_actions TEXT NOT NULL DEFAULT '[]',
        metadata TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS supervisor_cycles (
        id TEXT PRIMARY KEY,
        venture_id TEXT,
        workflow_id TEXT,
        trigger_type TEXT NOT NULL,
        trigger_id TEXT,
        status TEXT NOT NULL,
        decision_type TEXT,
        next_action_type TEXT,
        worker_id TEXT,
        task_id TEXT,
        approval_id TEXT,
        summary TEXT NOT NULL DEFAULT '',
        error TEXT,
        started_at TEXT,
        completed_at TEXT,
        metadata TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (venture_id) REFERENCES ventures(id),
        FOREIGN KEY (workflow_id) REFERENCES workflows(id),
        FOREIGN KEY (task_id) REFERENCES tasks(id),
        FOREIGN KEY (approval_id) REFERENCES approvals(id)
      );

      CREATE INDEX IF NOT EXISTS idx_opportunity_rounds_status
        ON opportunity_rounds(status, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_opportunities_rank
        ON opportunities(status, overall_score DESC, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_catalogue_items_plan
        ON catalogue_items(plan_id, status, created_at);
      CREATE INDEX IF NOT EXISTS idx_commercial_diagnoses_status
        ON commercial_diagnoses(venture_id, status, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_operating_mandates_period
        ON operating_mandates(status, period_start, period_end);
      CREATE INDEX IF NOT EXISTS idx_supervisor_cycles_status
        ON supervisor_cycles(status, created_at DESC);
    `);

    const workflowOwnedTables = [
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
    for (const tableName of workflowOwnedTables) {
      db.exec(`
        CREATE TRIGGER IF NOT EXISTS trg_${tableName}_venture_match_insert
        BEFORE INSERT ON ${tableName}
        FOR EACH ROW
        WHEN NEW.workflow_id IS NOT NULL
          AND NEW.venture_id IS NOT NULL
          AND NEW.venture_id <> (SELECT venture_id FROM workflows WHERE id = NEW.workflow_id)
        BEGIN
          SELECT RAISE(ABORT, 'Venture ownership does not match the workflow.');
        END;

        CREATE TRIGGER IF NOT EXISTS trg_${tableName}_venture_match_update
        BEFORE UPDATE OF workflow_id, venture_id ON ${tableName}
        FOR EACH ROW
        WHEN NEW.workflow_id IS NOT NULL
          AND NEW.venture_id IS NOT NULL
          AND NEW.venture_id <> (SELECT venture_id FROM workflows WHERE id = NEW.workflow_id)
        BEGIN
          SELECT RAISE(ABORT, 'Venture ownership does not match the workflow.');
        END;
      `);
    }

    recordMigration(db, 19, "pantheon-commercial-operating-model");
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function applyRetentionActivationLedgerMigration(db) {
  if (migrationApplied(db, 20)) return;
  db.exec("BEGIN IMMEDIATE");
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS data_retention_policy_activations (
        id TEXT PRIMARY KEY,
        policy_id TEXT NOT NULL,
        policy_hash TEXT NOT NULL,
        approval_id TEXT,
        proof_hash TEXT NOT NULL UNIQUE,
        activated_at TEXT NOT NULL,
        activated_by TEXT NOT NULL DEFAULT 'operator',
        metadata TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        UNIQUE(policy_id, policy_hash),
        FOREIGN KEY (policy_id) REFERENCES data_retention_policies(id)
      );

      CREATE INDEX IF NOT EXISTS idx_retention_policy_activations_policy
        ON data_retention_policy_activations(policy_id, activated_at DESC);

      CREATE TRIGGER IF NOT EXISTS trg_retention_policy_activations_immutable_update
      BEFORE UPDATE ON data_retention_policy_activations
      BEGIN
        SELECT RAISE(ABORT, 'Data-retention policy activations are immutable.');
      END;

      CREATE TRIGGER IF NOT EXISTS trg_retention_policy_activations_immutable_delete
      BEFORE DELETE ON data_retention_policy_activations
      BEGIN
        SELECT RAISE(ABORT, 'Data-retention policy activations are immutable.');
      END;
    `);

    const legacyApprovals = all(
      db,
      `SELECT approvals.id AS approval_id, approvals.payload AS approval_payload,
              approvals.decision_note, approvals.decided_at,
              tasks.result AS task_result
       FROM approvals
       JOIN tasks ON tasks.id = approvals.task_id
       WHERE approvals.scope = 'data_retention_policy'
         AND approvals.status = 'approved'
         AND tasks.status = 'completed'
       ORDER BY approvals.decided_at DESC, approvals.requested_at DESC`,
    );
    for (const approval of legacyApprovals) {
      const payload = fromJson(approval.approval_payload, {});
      const result = fromJson(approval.task_result, {});
      if (result.retentionPolicyActivated !== true) continue;
      const policy = get(
        db,
        "SELECT id, policy_hash, version FROM data_retention_policies WHERE id = ? AND policy_hash = ?",
        [payload.policyId, payload.policyHash],
      );
      if (!policy) continue;
      const activatedAt = result.activatedAt || approval.decided_at || now();
      const proof = {
        policyId: policy.id,
        policyHash: policy.policy_hash,
        approvalId: approval.approval_id,
        activatedAt,
        source: "legacy-approved-activation",
      };
      const proofHash = createHash("sha256").update(JSON.stringify(proof)).digest("hex");
      run(
        db,
        `INSERT OR IGNORE INTO data_retention_policy_activations
         (id, policy_id, policy_hash, approval_id, proof_hash, activated_at,
          activated_by, metadata, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'operator', ?, ?)`,
        [
          `retention_activation_${policy.policy_hash.slice(0, 24)}`,
          policy.id,
          policy.policy_hash,
          approval.approval_id,
          proofHash,
          activatedAt,
          toJson({
            source: "schema-20-backfill",
            decisionNote: approval.decision_note || "",
            policyVersion: policy.version,
          }),
          now(),
        ],
      );
    }

    recordMigration(db, 20, "durable-retention-policy-activation-ledger");
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function applyFullJourneyMigration(db) {
  if (migrationApplied(db, 21)) return;
  db.exec("BEGIN IMMEDIATE");
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS pantheon_journeys (
        id TEXT PRIMARY KEY,
        venture_id TEXT NOT NULL,
        mode TEXT NOT NULL CHECK(mode IN ('rehearsal', 'production')),
        status TEXT NOT NULL,
        active_stage TEXT NOT NULL,
        model TEXT NOT NULL,
        model_locked INTEGER NOT NULL DEFAULT 1 CHECK(model_locked IN (0, 1)),
        budget_cap_cents INTEGER NOT NULL CHECK(budget_cap_cents > 0),
        carried_exposure_cents INTEGER NOT NULL DEFAULT 0 CHECK(carried_exposure_cents >= 0),
        round_id TEXT,
        workflow_id TEXT,
        selected_opportunity_id TEXT,
        metadata TEXT NOT NULL DEFAULT '{}',
        started_at TEXT NOT NULL,
        completed_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (venture_id) REFERENCES ventures(id),
        FOREIGN KEY (round_id) REFERENCES opportunity_rounds(id),
        FOREIGN KEY (workflow_id) REFERENCES workflows(id),
        FOREIGN KEY (selected_opportunity_id) REFERENCES opportunities(id)
      );

      CREATE INDEX IF NOT EXISTS idx_pantheon_journeys_status
        ON pantheon_journeys(status, updated_at DESC);

      CREATE INDEX IF NOT EXISTS idx_pantheon_journeys_round
        ON pantheon_journeys(round_id);
    `);
    recordMigration(db, 21, "pantheon-full-commercial-journey");
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function applyCommercialIntelligenceMigration(db) {
  if (migrationApplied(db, 22)) return;
  db.exec("BEGIN IMMEDIATE");
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS commercial_knowledge_sources (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        publisher TEXT NOT NULL,
        url TEXT NOT NULL,
        source_tier INTEGER NOT NULL CHECK(source_tier BETWEEN 1 AND 4),
        source_type TEXT NOT NULL,
        jurisdiction TEXT NOT NULL DEFAULT 'global',
        published_at TEXT,
        reviewed_at TEXT NOT NULL,
        expires_at TEXT,
        methodology TEXT NOT NULL DEFAULT '',
        licence TEXT NOT NULL DEFAULT '',
        metadata TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_commercial_knowledge_sources_url
        ON commercial_knowledge_sources(url);

      CREATE TABLE IF NOT EXISTS commercial_knowledge (
        id TEXT PRIMARY KEY,
        source_id TEXT NOT NULL,
        knowledge_class TEXT NOT NULL
          CHECK(knowledge_class IN ('doctrine', 'market_evidence', 'proven_learning')),
        domain TEXT NOT NULL,
        title TEXT NOT NULL,
        proposition TEXT NOT NULL,
        applicability TEXT NOT NULL,
        limitations TEXT NOT NULL,
        contrary_evidence TEXT NOT NULL DEFAULT '',
        confidence TEXT NOT NULL CHECK(confidence IN ('high', 'medium', 'low')),
        jurisdiction TEXT NOT NULL DEFAULT 'global',
        tags TEXT NOT NULL DEFAULT '[]',
        effective_at TEXT,
        review_date TEXT NOT NULL,
        expires_at TEXT,
        status TEXT NOT NULL DEFAULT 'active'
          CHECK(status IN ('draft', 'active', 'superseded', 'retired')),
        version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0),
        supersedes_id TEXT,
        source_quote_hash TEXT,
        metadata TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (source_id) REFERENCES commercial_knowledge_sources(id),
        FOREIGN KEY (supersedes_id) REFERENCES commercial_knowledge(id)
      );

      CREATE INDEX IF NOT EXISTS idx_commercial_knowledge_class_domain
        ON commercial_knowledge(knowledge_class, domain, status, review_date);

      CREATE VIRTUAL TABLE IF NOT EXISTS commercial_knowledge_fts USING fts5(
        knowledge_id UNINDEXED,
        title,
        proposition,
        applicability,
        limitations,
        tags,
        tokenize = 'porter unicode61'
      );

      CREATE TRIGGER IF NOT EXISTS trg_commercial_knowledge_fts_insert
      AFTER INSERT ON commercial_knowledge BEGIN
        INSERT INTO commercial_knowledge_fts
          (knowledge_id, title, proposition, applicability, limitations, tags)
        VALUES
          (new.id, new.title, new.proposition, new.applicability, new.limitations, new.tags);
      END;

      CREATE TRIGGER IF NOT EXISTS trg_commercial_knowledge_fts_update
      AFTER UPDATE ON commercial_knowledge BEGIN
        DELETE FROM commercial_knowledge_fts WHERE knowledge_id = old.id;
        INSERT INTO commercial_knowledge_fts
          (knowledge_id, title, proposition, applicability, limitations, tags)
        VALUES
          (new.id, new.title, new.proposition, new.applicability, new.limitations, new.tags);
      END;

      CREATE TRIGGER IF NOT EXISTS trg_commercial_knowledge_fts_delete
      AFTER DELETE ON commercial_knowledge BEGIN
        DELETE FROM commercial_knowledge_fts WHERE knowledge_id = old.id;
      END;

      CREATE TABLE IF NOT EXISTS commercial_decision_cases (
        id TEXT PRIMARY KEY,
        opportunity_id TEXT,
        venture_id TEXT,
        round_id TEXT,
        status TEXT NOT NULL
          CHECK(status IN ('draft', 'researching', 'ready_for_review', 'decided', 'parked', 'rejected')),
        stage TEXT NOT NULL,
        recommendation TEXT NOT NULL
          CHECK(recommendation IN ('advance', 'park', 'reject', 'research_more', 'no_investment')),
        model_route TEXT NOT NULL DEFAULT '{}',
        buyer TEXT NOT NULL DEFAULT '',
        problem TEXT NOT NULL DEFAULT '',
        offer TEXT NOT NULL DEFAULT '',
        evidence_summary TEXT NOT NULL DEFAULT '{}',
        economics TEXT NOT NULL DEFAULT '{}',
        channel_strategy TEXT NOT NULL DEFAULT '{}',
        alternatives TEXT NOT NULL DEFAULT '{}',
        criteria TEXT NOT NULL DEFAULT '{}',
        missing_evidence TEXT NOT NULL DEFAULT '[]',
        confidence TEXT NOT NULL DEFAULT 'low'
          CHECK(confidence IN ('high', 'medium', 'low')),
        rationale TEXT NOT NULL DEFAULT '',
        next_action TEXT NOT NULL DEFAULT '',
        decision_hash TEXT NOT NULL,
        reviewed_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (opportunity_id) REFERENCES opportunities(id),
        FOREIGN KEY (venture_id) REFERENCES ventures(id),
        FOREIGN KEY (round_id) REFERENCES opportunity_rounds(id)
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_commercial_decision_case_hash
        ON commercial_decision_cases(decision_hash);

      CREATE INDEX IF NOT EXISTS idx_commercial_decision_case_status
        ON commercial_decision_cases(status, updated_at DESC);

      CREATE TABLE IF NOT EXISTS service_trials (
        id TEXT PRIMARY KEY,
        service_name TEXT NOT NULL,
        vendor TEXT NOT NULL,
        status TEXT NOT NULL
          CHECK(status IN ('proposed', 'approved', 'running', 'completed', 'cancelled', 'retained', 'rejected')),
        hypothesis TEXT NOT NULL,
        baseline TEXT NOT NULL DEFAULT '{}',
        trial_start TEXT,
        trial_end TEXT,
        cap_cents INTEGER NOT NULL CHECK(cap_cents BETWEEN 0 AND 2500),
        actual_cost_cents INTEGER,
        evidence_quality_metrics TEXT NOT NULL DEFAULT '{}',
        retention_thresholds TEXT NOT NULL DEFAULT '{}',
        result TEXT NOT NULL DEFAULT '{}',
        decision TEXT NOT NULL DEFAULT '',
        delegated_vendor_capability INTEGER NOT NULL DEFAULT 0 CHECK(delegated_vendor_capability IN (0, 1)),
        renewal_at TEXT,
        metadata TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS venture_kits (
        id TEXT NOT NULL,
        version INTEGER NOT NULL CHECK(version > 0),
        status TEXT NOT NULL CHECK(status IN ('draft', 'active', 'retired')),
        name TEXT NOT NULL,
        business_models TEXT NOT NULL DEFAULT '[]',
        eligibility_rules TEXT NOT NULL DEFAULT '{}',
        evidence_requirements TEXT NOT NULL DEFAULT '{}',
        capability_requirements TEXT NOT NULL DEFAULT '[]',
        channel_policy TEXT NOT NULL DEFAULT '{}',
        acceptance_criteria TEXT NOT NULL DEFAULT '{}',
        metadata TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (id, version)
      );

      CREATE TABLE IF NOT EXISTS capability_assurance_records (
        id TEXT PRIMARY KEY,
        capability_key TEXT NOT NULL,
        proof_kind TEXT NOT NULL
          CHECK(proof_kind IN ('fixture', 'rehearsal', 'comparison', 'live', 'operational')),
        source_framework TEXT NOT NULL,
        source_record_id TEXT NOT NULL,
        status TEXT NOT NULL,
        input_hash TEXT,
        output_hash TEXT,
        provider TEXT,
        model TEXT,
        trace_id TEXT,
        cost_cents INTEGER,
        verdict TEXT NOT NULL DEFAULT '',
        criteria TEXT NOT NULL DEFAULT '{}',
        metadata TEXT NOT NULL DEFAULT '{}',
        occurred_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(source_framework, source_record_id)
      );

      CREATE INDEX IF NOT EXISTS idx_capability_assurance_capability
        ON capability_assurance_records(capability_key, occurred_at DESC, created_at DESC);
    `);
    recordMigration(db, 22, "commercial-intelligence-foundation");
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function applyRuntimeStopEvidenceMigration(db) {
  if (migrationApplied(db, 23)) return;
  db.exec("BEGIN IMMEDIATE");
  try {
    addColumn(db, "model_calls", "error TEXT");
    addColumn(db, "model_calls", "completed_at TEXT");
    recordMigration(db, 23, "runtime-stop-evidence");
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function applyModelCallCompletionTruthMigration(db) {
  if (migrationApplied(db, 24)) return;
  db.exec("BEGIN IMMEDIATE");
  try {
    db.exec(`
      UPDATE model_calls
      SET completed_at = COALESCE(
        (
          SELECT attempts.completed_at
          FROM task_attempts AS attempts
          WHERE attempts.completed_at IS NOT NULL
            AND attempts.task_id = model_calls.task_id
            AND (
              attempts.model_call_id = model_calls.id
              OR attempts.provider_dispatch_model_call_id = model_calls.id
            )
          ORDER BY attempts.completed_at DESC, attempts.id DESC
          LIMIT 1
        ),
        (
          SELECT runs.completed_at
          FROM agent_runs AS runs
          WHERE runs.completed_at IS NOT NULL
            AND runs.task_id = model_calls.task_id
            AND runs.model_call_id = model_calls.id
          ORDER BY runs.completed_at DESC, runs.id DESC
          LIMIT 1
        ),
        (
          SELECT tasks.completed_at
          FROM tasks
          WHERE tasks.id = model_calls.task_id
            AND tasks.completed_at IS NOT NULL
        )
      )
      WHERE model_calls.completed_at IS NULL
        AND model_calls.status IN (
          'completed', 'succeeded', 'provider_completed', 'waiting_approval',
          'failed', 'needs_attention', 'cancelled', 'abandoned', 'not_called'
        )
        AND (
          EXISTS (
            SELECT 1
            FROM task_attempts AS attempts
            WHERE attempts.completed_at IS NOT NULL
              AND attempts.task_id = model_calls.task_id
              AND (
                attempts.model_call_id = model_calls.id
                OR attempts.provider_dispatch_model_call_id = model_calls.id
              )
          )
          OR EXISTS (
            SELECT 1
            FROM agent_runs AS runs
            WHERE runs.completed_at IS NOT NULL
              AND runs.task_id = model_calls.task_id
              AND runs.model_call_id = model_calls.id
          )
          OR EXISTS (
            SELECT 1
            FROM tasks
            WHERE tasks.id = model_calls.task_id
              AND tasks.completed_at IS NOT NULL
          )
        );
    `);
    recordMigration(db, 24, "model-call-completion-truth");
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function applyCommercialTestEvidenceLedgerMigration(db) {
  if (migrationApplied(db, 25)) return;
  db.exec("BEGIN IMMEDIATE");
  try {
    addColumn(db, "venture_kits", "content_hash TEXT");
    const {
      ventureKitContentHash,
    } = require("./runtime/venture-kit-definition");
    for (const kit of all(db, "SELECT * FROM venture_kits ORDER BY id, version")) {
      const expectedContentHash = ventureKitContentHash(kit);
      if (kit.content_hash && kit.content_hash !== expectedContentHash) {
        throw new Error(
          `Venture Kit ${kit.id}@${kit.version} has a content hash that does not match its definition.`,
        );
      }
      if (!kit.content_hash) {
        run(
          db,
          "UPDATE venture_kits SET content_hash = ? WHERE id = ? AND version = ?",
          [expectedContentHash, kit.id, kit.version],
        );
      }
    }
    db.exec(`
      CREATE TRIGGER IF NOT EXISTS trg_venture_kits_content_hash_insert
      BEFORE INSERT ON venture_kits
      WHEN NEW.content_hash IS NULL
        OR length(NEW.content_hash) <> 71
        OR substr(NEW.content_hash, 1, 7) <> 'sha256:'
        OR substr(NEW.content_hash, 8) GLOB '*[^0-9a-f]*'
      BEGIN
        SELECT RAISE(ABORT, 'A Venture Kit requires its exact immutable content hash.');
      END;

      CREATE TABLE IF NOT EXISTS commercial_test_contracts (
        decision_hash TEXT PRIMARY KEY
          CHECK(
            length(decision_hash) = 71
            AND substr(decision_hash, 1, 7) = 'sha256:'
            AND substr(decision_hash, 8) NOT GLOB '*[^0-9a-f]*'
          ),
        contract_schema TEXT NOT NULL
          CHECK(contract_schema = 'pantheon.commercial-test-contract.v2'),
        program_id TEXT NOT NULL,
        program_version TEXT NOT NULL,
        test_id TEXT NOT NULL,
        test_version TEXT NOT NULL,
        venture_id TEXT NOT NULL,
        venture_kit_id TEXT NOT NULL,
        venture_kit_version INTEGER NOT NULL CHECK(venture_kit_version > 0),
        venture_kit_hash TEXT NOT NULL
          CHECK(
            length(venture_kit_hash) = 71
            AND substr(venture_kit_hash, 1, 7) = 'sha256:'
            AND substr(venture_kit_hash, 8) NOT GLOB '*[^0-9a-f]*'
          ),
        offer_id TEXT NOT NULL,
        offer_version TEXT NOT NULL,
        offer_hash TEXT NOT NULL
          CHECK(
            length(offer_hash) = 71
            AND substr(offer_hash, 1, 7) = 'sha256:'
            AND substr(offer_hash, 8) NOT GLOB '*[^0-9a-f]*'
          ),
        offer_sku TEXT NOT NULL,
        experiment_id TEXT NOT NULL,
        experiment_version TEXT NOT NULL,
        cohort_id TEXT NOT NULL,
        channel_id TEXT NOT NULL,
        provider_namespace TEXT NOT NULL,
        account_hash TEXT NOT NULL
          CHECK(
            length(account_hash) = 71
            AND substr(account_hash, 1, 7) = 'sha256:'
            AND substr(account_hash, 8) NOT GLOB '*[^0-9a-f]*'
          ),
        adapter_id TEXT NOT NULL,
        adapter_version TEXT NOT NULL,
        adapter_hash TEXT NOT NULL
          CHECK(
            length(adapter_hash) = 71
            AND substr(adapter_hash, 1, 7) = 'sha256:'
            AND substr(adapter_hash, 8) NOT GLOB '*[^0-9a-f]*'
          ),
        reporting_starts_at TEXT NOT NULL,
        reporting_ends_at TEXT NOT NULL
          CHECK(reporting_ends_at > reporting_starts_at),
        buyer_key_id TEXT NOT NULL,
        buyer_key_version INTEGER NOT NULL CHECK(buyer_key_version > 0),
        buyer_independence_basis TEXT NOT NULL,
        price_aud_cents INTEGER NOT NULL CHECK(price_aud_cents > 0),
        operator_role TEXT NOT NULL
          CHECK(operator_role = 'approvals_and_guidance_only'),
        external_spend_cap_cents INTEGER NOT NULL
          CHECK(external_spend_cap_cents = 0),
        contract_json TEXT NOT NULL
          CHECK(
            json_valid(contract_json)
            AND json_extract(contract_json, '$.schema') IS contract_schema
            AND json_extract(contract_json, '$.decisionHash') IS decision_hash
            AND json_extract(contract_json, '$.programId') IS program_id
            AND json_extract(contract_json, '$.programVersion') IS program_version
            AND json_extract(contract_json, '$.testId') IS test_id
            AND json_extract(contract_json, '$.testVersion') IS test_version
            AND json_extract(contract_json, '$.ventureId') IS venture_id
            AND json_extract(contract_json, '$.ventureKit.id') IS venture_kit_id
            AND json_extract(contract_json, '$.ventureKit.version') IS venture_kit_version
            AND json_extract(contract_json, '$.ventureKit.hash') IS venture_kit_hash
            AND json_extract(contract_json, '$.offer.id') IS offer_id
            AND json_extract(contract_json, '$.offer.version') IS offer_version
            AND json_extract(contract_json, '$.offer.hash') IS offer_hash
            AND json_extract(contract_json, '$.offer.sku') IS offer_sku
            AND json_extract(contract_json, '$.offerId') IS offer_id
            AND json_extract(contract_json, '$.experiment.id') IS experiment_id
            AND json_extract(contract_json, '$.experiment.version') IS experiment_version
            AND json_extract(contract_json, '$.cohort.id') IS cohort_id
            AND json_extract(contract_json, '$.channel.id') IS channel_id
            AND json_extract(contract_json, '$.channel.providerNamespace') IS provider_namespace
            AND json_extract(contract_json, '$.channel.accountHash') IS account_hash
            AND json_extract(contract_json, '$.channel.adapter.id') IS adapter_id
            AND json_extract(contract_json, '$.channel.adapter.version') IS adapter_version
            AND json_extract(contract_json, '$.channel.adapter.hash') IS adapter_hash
            AND json_extract(contract_json, '$.reportingPeriod.startsAt') IS reporting_starts_at
            AND json_extract(contract_json, '$.reportingPeriod.endsAt') IS reporting_ends_at
            AND json_extract(contract_json, '$.buyerIdentity.keyId') IS buyer_key_id
            AND json_extract(contract_json, '$.buyerIdentity.keyVersion') IS buyer_key_version
            AND json_extract(contract_json, '$.buyerIdentity.independenceBasis')
              IS buyer_independence_basis
            AND json_extract(contract_json, '$.price.currency') IS 'AUD'
            AND json_extract(contract_json, '$.price.amountMinorUnits') IS price_aud_cents
            AND json_extract(contract_json, '$.price.amountAudCents') IS price_aud_cents
            AND json_extract(contract_json, '$.operatorRole') IS operator_role
            AND CAST(ROUND(json_extract(contract_json, '$.externalSpendCapAud') * 100) AS INTEGER)
              IS external_spend_cap_cents
          ),
        created_at TEXT NOT NULL,
        UNIQUE(program_id, program_version, test_id, test_version),
        FOREIGN KEY (venture_id) REFERENCES ventures(id),
        FOREIGN KEY (venture_kit_id, venture_kit_version, venture_kit_hash)
          REFERENCES venture_kits(id, version, content_hash)
      );

      CREATE TABLE IF NOT EXISTS commercial_test_lifecycle_events (
        id TEXT PRIMARY KEY,
        decision_hash TEXT NOT NULL,
        sequence INTEGER NOT NULL CHECK(sequence >= 0),
        previous_event_hash TEXT
          CHECK(
            previous_event_hash IS NULL
            OR (
              length(previous_event_hash) = 71
              AND substr(previous_event_hash, 1, 7) = 'sha256:'
              AND substr(previous_event_hash, 8) NOT GLOB '*[^0-9a-f]*'
            )
          ),
        event_type TEXT NOT NULL
          CHECK(event_type IN ('proposed', 'accepted', 'activated', 'paused', 'closed', 'stopped')),
        event_hash TEXT NOT NULL
          CHECK(
            length(event_hash) = 71
            AND substr(event_hash, 1, 7) = 'sha256:'
            AND substr(event_hash, 8) NOT GLOB '*[^0-9a-f]*'
          ),
        approval_id TEXT,
        approval_scope_hash TEXT
          CHECK(
            approval_scope_hash IS NULL
            OR (
              length(approval_scope_hash) = 71
              AND substr(approval_scope_hash, 1, 7) = 'sha256:'
              AND substr(approval_scope_hash, 8) NOT GLOB '*[^0-9a-f]*'
            )
          ),
        reason TEXT NOT NULL DEFAULT '',
        metadata TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(metadata)),
        event_json TEXT NOT NULL
          CHECK(
            json_valid(event_json)
            AND json_extract(event_json, '$.schema')
              IS 'pantheon.commercial-test-lifecycle-event.v2'
            AND json_extract(event_json, '$.id') IS id
            AND json_extract(event_json, '$.decisionHash') IS decision_hash
            AND json_extract(event_json, '$.sequence') IS sequence
            AND json_type(event_json, '$.previousEventHash') IS NOT NULL
            AND json_extract(event_json, '$.previousEventHash') IS previous_event_hash
            AND json_extract(event_json, '$.eventType') IS event_type
            AND json_extract(event_json, '$.eventHash') IS event_hash
            AND json_type(event_json, '$.approvalId') IS NOT NULL
            AND json_extract(event_json, '$.approvalId') IS approval_id
            AND json_type(event_json, '$.approvalScopeHash') IS NOT NULL
            AND json_extract(event_json, '$.approvalScopeHash') IS approval_scope_hash
            AND json_extract(event_json, '$.reason') IS reason
            AND json_type(event_json, '$.metadata') IS 'object'
            AND json_extract(event_json, '$.metadata') = json(metadata)
            AND json_extract(event_json, '$.occurredAt') IS occurred_at
          ),
        occurred_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(decision_hash, sequence),
        UNIQUE(decision_hash, event_hash),
        FOREIGN KEY (decision_hash) REFERENCES commercial_test_contracts(decision_hash),
        FOREIGN KEY (approval_id) REFERENCES approvals(id),
        FOREIGN KEY (decision_hash, previous_event_hash)
          REFERENCES commercial_test_lifecycle_events(decision_hash, event_hash),
        CHECK(
          (sequence = 0 AND previous_event_hash IS NULL AND event_type = 'proposed')
          OR (sequence > 0 AND previous_event_hash IS NOT NULL)
        )
      );

      CREATE TABLE IF NOT EXISTS commercial_test_evidence_receipts (
        decision_hash TEXT NOT NULL,
        receipt_id TEXT NOT NULL,
        receipt_schema TEXT NOT NULL
          CHECK(receipt_schema = 'pantheon.commercial-test-evidence-receipt.v2'),
        source_kind TEXT NOT NULL
          CHECK(source_kind IN ('imported_platform', 'operator_attested_manual')),
        source_id TEXT NOT NULL,
        provider_namespace TEXT NOT NULL,
        account_hash TEXT NOT NULL
          CHECK(
            length(account_hash) = 71
            AND substr(account_hash, 1, 7) = 'sha256:'
            AND substr(account_hash, 8) NOT GLOB '*[^0-9a-f]*'
          ),
        source_system TEXT NOT NULL,
        export_type TEXT NOT NULL,
        source_hash TEXT NOT NULL
          CHECK(
            length(source_hash) = 71
            AND substr(source_hash, 1, 7) = 'sha256:'
            AND substr(source_hash, 8) NOT GLOB '*[^0-9a-f]*'
          ),
        receipt_hash TEXT NOT NULL
          CHECK(
            length(receipt_hash) = 71
            AND substr(receipt_hash, 1, 7) = 'sha256:'
            AND substr(receipt_hash, 8) NOT GLOB '*[^0-9a-f]*'
          ),
        location_reference TEXT NOT NULL,
        verification_status TEXT NOT NULL
          CHECK(verification_status IN ('pending', 'verified', 'rejected')),
        reporting_starts_at TEXT NOT NULL,
        reporting_ends_at TEXT NOT NULL
          CHECK(reporting_ends_at > reporting_starts_at),
        coverage_basis TEXT NOT NULL
          CHECK(coverage_basis IN (
            'unfiltered_full_reporting_period',
            'single_retained_source'
          )),
        coverage_declared_row_count INTEGER NOT NULL
          CHECK(coverage_declared_row_count > 0),
        coverage_control_hash TEXT NOT NULL
          CHECK(
            length(coverage_control_hash) = 71
            AND substr(coverage_control_hash, 1, 7) = 'sha256:'
            AND substr(coverage_control_hash, 8) NOT GLOB '*[^0-9a-f]*'
          ),
        generated_at TEXT,
        imported_at TEXT,
        import_batch_id TEXT,
        manual_reference_hash TEXT
          CHECK(
            manual_reference_hash IS NULL
            OR (
              length(manual_reference_hash) = 71
              AND substr(manual_reference_hash, 1, 7) = 'sha256:'
              AND substr(manual_reference_hash, 8) NOT GLOB '*[^0-9a-f]*'
            )
          ),
        attested_by TEXT,
        attestation_note TEXT,
        entry_reason TEXT,
        receipt_json TEXT NOT NULL
          CHECK(
            json_valid(receipt_json)
            AND json_extract(receipt_json, '$.schema') IS receipt_schema
            AND json_extract(receipt_json, '$.decisionHash') IS decision_hash
            AND json_extract(receipt_json, '$.receiptId') IS receipt_id
            AND json_extract(receipt_json, '$.sourceKind') IS source_kind
            AND json_extract(receipt_json, '$.sourceId') IS source_id
            AND json_extract(receipt_json, '$.providerNamespace') IS provider_namespace
            AND json_extract(receipt_json, '$.accountHash') IS account_hash
            AND json_extract(receipt_json, '$.sourceSystem') IS source_system
            AND json_extract(receipt_json, '$.exportType') IS export_type
            AND json_extract(receipt_json, '$.sourceHash') IS source_hash
            AND json_extract(receipt_json, '$.receiptHash') IS receipt_hash
            AND json_extract(receipt_json, '$.locationReference') IS location_reference
            AND json_extract(receipt_json, '$.verificationStatus') IS verification_status
            AND json_extract(receipt_json, '$.reportingPeriod.startsAt') IS reporting_starts_at
            AND json_extract(receipt_json, '$.reportingPeriod.endsAt') IS reporting_ends_at
            AND json_extract(receipt_json, '$.coverage.basis') IS coverage_basis
            AND json_extract(receipt_json, '$.coverage.declaredRowCount')
              IS coverage_declared_row_count
            AND json_extract(receipt_json, '$.coverage.controlHash') IS coverage_control_hash
            AND json_extract(receipt_json, '$.capturedAt') IS captured_at
            AND json_type(receipt_json, '$.generatedAt') IS NOT NULL
            AND json_extract(receipt_json, '$.generatedAt') IS generated_at
            AND json_type(receipt_json, '$.importedAt') IS NOT NULL
            AND json_extract(receipt_json, '$.importedAt') IS imported_at
            AND json_type(receipt_json, '$.importBatchId') IS NOT NULL
            AND json_extract(receipt_json, '$.importBatchId') IS import_batch_id
            AND json_type(receipt_json, '$.manualReferenceHash') IS NOT NULL
            AND json_extract(receipt_json, '$.manualReferenceHash') IS manual_reference_hash
            AND json_type(receipt_json, '$.attestedBy') IS NOT NULL
            AND json_extract(receipt_json, '$.attestedBy') IS attested_by
            AND json_type(receipt_json, '$.attestationNote') IS NOT NULL
            AND json_extract(receipt_json, '$.attestationNote') IS attestation_note
            AND json_type(receipt_json, '$.entryReason') IS NOT NULL
            AND json_extract(receipt_json, '$.entryReason') IS entry_reason
          ),
        captured_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (decision_hash, receipt_id),
        UNIQUE(decision_hash, receipt_hash),
        UNIQUE(decision_hash, receipt_id, receipt_hash),
        UNIQUE(
          decision_hash,
          receipt_id,
          receipt_hash,
          source_kind,
          source_id,
          provider_namespace,
          account_hash,
          source_system,
          export_type,
          source_hash,
          verification_status,
          reporting_starts_at,
          reporting_ends_at,
          coverage_basis,
          coverage_declared_row_count,
          coverage_control_hash,
          captured_at
        ),
        FOREIGN KEY (decision_hash) REFERENCES commercial_test_contracts(decision_hash),
        CHECK(
          (
            source_kind = 'imported_platform'
            AND coverage_basis = 'unfiltered_full_reporting_period'
            AND generated_at IS NOT NULL
            AND imported_at IS NOT NULL
            AND imported_at >= generated_at
            AND import_batch_id IS NOT NULL
            AND manual_reference_hash IS NULL
            AND attested_by IS NULL
            AND attestation_note IS NULL
            AND entry_reason IS NULL
          )
          OR (
            source_kind = 'operator_attested_manual'
            AND coverage_basis = 'single_retained_source'
            AND coverage_declared_row_count = 1
            AND generated_at IS NULL
            AND imported_at IS NULL
            AND import_batch_id IS NULL
            AND manual_reference_hash IS NOT NULL
            AND attested_by IS NOT NULL
            AND attestation_note IS NOT NULL
            AND entry_reason IS NOT NULL
          )
        )
      );

      CREATE TABLE IF NOT EXISTS commercial_test_evidence_records (
        record_hash TEXT PRIMARY KEY
          CHECK(
            length(record_hash) = 71
            AND substr(record_hash, 1, 7) = 'sha256:'
            AND substr(record_hash, 8) NOT GLOB '*[^0-9a-f]*'
          ),
        evidence_schema TEXT NOT NULL
          CHECK(evidence_schema = 'pantheon.commercial-test-evidence.v2'),
        decision_hash TEXT NOT NULL,
        evidence_id TEXT NOT NULL,
        evidence_version TEXT NOT NULL,
        kind TEXT NOT NULL
          CHECK(kind IN (
            'transaction',
            'cost',
            'manual_verification',
            'terminal_stop',
            'evidence_set_manifest'
          )),
        source_kind TEXT NOT NULL
          CHECK(source_kind IN ('imported_platform', 'operator_attested_manual')),
        source_id TEXT NOT NULL,
        provider_namespace TEXT NOT NULL,
        account_hash TEXT NOT NULL
          CHECK(
            length(account_hash) = 71
            AND substr(account_hash, 1, 7) = 'sha256:'
            AND substr(account_hash, 8) NOT GLOB '*[^0-9a-f]*'
          ),
        source_system TEXT NOT NULL,
        export_type TEXT NOT NULL,
        source_hash TEXT NOT NULL
          CHECK(
            length(source_hash) = 71
            AND substr(source_hash, 1, 7) = 'sha256:'
            AND substr(source_hash, 8) NOT GLOB '*[^0-9a-f]*'
          ),
        source_row_hash TEXT NOT NULL
          CHECK(
            length(source_row_hash) = 71
            AND substr(source_row_hash, 1, 7) = 'sha256:'
            AND substr(source_row_hash, 8) NOT GLOB '*[^0-9a-f]*'
          ),
        receipt_id TEXT NOT NULL,
        receipt_hash TEXT NOT NULL
          CHECK(
            length(receipt_hash) = 71
            AND substr(receipt_hash, 1, 7) = 'sha256:'
            AND substr(receipt_hash, 8) NOT GLOB '*[^0-9a-f]*'
          ),
        verification_status TEXT NOT NULL
          CHECK(verification_status IN ('pending', 'verified', 'rejected')),
        reporting_starts_at TEXT NOT NULL,
        reporting_ends_at TEXT NOT NULL
          CHECK(reporting_ends_at > reporting_starts_at),
        coverage_basis TEXT NOT NULL
          CHECK(coverage_basis IN (
            'unfiltered_full_reporting_period',
            'single_retained_source'
          )),
        coverage_declared_row_count INTEGER NOT NULL
          CHECK(coverage_declared_row_count > 0),
        coverage_control_hash TEXT NOT NULL
          CHECK(
            length(coverage_control_hash) = 71
            AND substr(coverage_control_hash, 1, 7) = 'sha256:'
            AND substr(coverage_control_hash, 8) NOT GLOB '*[^0-9a-f]*'
          ),
        captured_at TEXT NOT NULL,
        supersedes_record_hash TEXT
          CHECK(
            supersedes_record_hash IS NULL
            OR (
              length(supersedes_record_hash) = 71
              AND substr(supersedes_record_hash, 1, 7) = 'sha256:'
              AND substr(supersedes_record_hash, 8) NOT GLOB '*[^0-9a-f]*'
            )
          ),
        transaction_key TEXT,
        transaction_id_hash TEXT,
        transaction_economic_hash TEXT,
        buyer_pseudonym TEXT,
        buyer_key_id TEXT,
        buyer_key_version INTEGER,
        buyer_independence_basis TEXT,
        transaction_event_type TEXT
          CHECK(
            transaction_event_type IS NULL
            OR transaction_event_type IN ('original', 'correction', 'refund', 'reversal')
          ),
        transaction_chain_sequence INTEGER,
        transaction_status TEXT
          CHECK(
            transaction_status IS NULL
            OR transaction_status IN ('pending', 'settled', 'refunded', 'disputed', 'cancelled')
          ),
        settlement_state TEXT
          CHECK(
            settlement_state IS NULL
            OR settlement_state IN (
              'pending',
              'platform_balance',
              'cash_settled',
              'unknown',
              'not_applicable'
            )
          ),
        settlement_reference_hash TEXT,
        occurred_at TEXT,
        settled_at TEXT,
        gross_revenue_original_minor_units INTEGER,
        gross_revenue_currency TEXT,
        gross_revenue_aud_cents INTEGER,
        refunds_original_minor_units INTEGER,
        refunds_currency TEXT,
        refunds_aud_cents INTEGER,
        cost_key TEXT,
        cost_id_hash TEXT,
        cost_economic_hash TEXT,
        cost_event_type TEXT
          CHECK(
            cost_event_type IS NULL
            OR cost_event_type IN ('original', 'correction', 'reversal')
          ),
        cost_chain_sequence INTEGER,
        cost_category TEXT
          CHECK(
            cost_category IS NULL
            OR cost_category IN (
              'platform_fees',
              'payment_fees',
              'tax',
              'advertising',
              'fulfilment',
              'paid_tools',
              'model_usage',
              'other_attributable'
            )
          ),
        cost_state TEXT
          CHECK(
            cost_state IS NULL
            OR cost_state IN ('unknown', 'estimated', 'incurred', 'reconciled')
          ),
        cost_original_minor_units INTEGER,
        cost_currency TEXT,
        cost_aud_cents INTEGER,
        attribution_status TEXT NOT NULL
          CHECK(attribution_status IN ('attributed', 'unattributed', 'unknown')),
        record_json TEXT NOT NULL
          CHECK(
            json_valid(record_json)
            AND json_extract(record_json, '$.schema') IS evidence_schema
            AND json_extract(record_json, '$.recordHash') IS record_hash
            AND json_extract(record_json, '$.testBinding.decisionHash') IS decision_hash
            AND json_extract(record_json, '$.evidenceId') IS evidence_id
            AND json_extract(record_json, '$.evidenceVersion') IS evidence_version
            AND json_extract(record_json, '$.kind') IS kind
            AND json_extract(record_json, '$.source.kind') IS source_kind
            AND json_extract(record_json, '$.source.sourceId') IS source_id
            AND json_extract(record_json, '$.source.providerNamespace') IS provider_namespace
            AND json_extract(record_json, '$.source.accountHash') IS account_hash
            AND json_extract(record_json, '$.source.sourceSystem') IS source_system
            AND json_extract(record_json, '$.source.exportType') IS export_type
            AND json_extract(record_json, '$.source.sourceHash') IS source_hash
            AND json_extract(record_json, '$.source.sourceRowHash') IS source_row_hash
            AND json_extract(record_json, '$.source.receipt.id') IS receipt_id
            AND json_extract(record_json, '$.source.receipt.hash') IS receipt_hash
            AND json_extract(record_json, '$.source.verificationStatus') IS verification_status
            AND json_extract(record_json, '$.source.reportingPeriod.startsAt')
              IS reporting_starts_at
            AND json_extract(record_json, '$.source.reportingPeriod.endsAt')
              IS reporting_ends_at
            AND json_extract(record_json, '$.source.coverage.basis') IS coverage_basis
            AND json_extract(record_json, '$.source.coverage.declaredRowCount')
              IS coverage_declared_row_count
            AND json_extract(record_json, '$.source.coverage.controlHash')
              IS coverage_control_hash
            AND json_extract(record_json, '$.source.capturedAt') IS captured_at
            AND json_type(record_json, '$.supersedesRecordHash') IS NOT NULL
            AND json_extract(record_json, '$.supersedesRecordHash') IS supersedes_record_hash
            AND json_extract(record_json, '$.attribution.status') IS attribution_status
          ),
        created_at TEXT NOT NULL,
        UNIQUE(decision_hash, evidence_id, evidence_version),
        FOREIGN KEY (decision_hash) REFERENCES commercial_test_contracts(decision_hash),
        FOREIGN KEY (
          decision_hash,
          receipt_id,
          receipt_hash,
          source_kind,
          source_id,
          provider_namespace,
          account_hash,
          source_system,
          export_type,
          source_hash,
          verification_status,
          reporting_starts_at,
          reporting_ends_at,
          coverage_basis,
          coverage_declared_row_count,
          coverage_control_hash,
          captured_at
        ) REFERENCES commercial_test_evidence_receipts(
          decision_hash,
          receipt_id,
          receipt_hash,
          source_kind,
          source_id,
          provider_namespace,
          account_hash,
          source_system,
          export_type,
          source_hash,
          verification_status,
          reporting_starts_at,
          reporting_ends_at,
          coverage_basis,
          coverage_declared_row_count,
          coverage_control_hash,
          captured_at
        ),
        FOREIGN KEY (supersedes_record_hash)
          REFERENCES commercial_test_evidence_records(record_hash),
        CHECK(
          (
            kind = 'transaction'
            AND transaction_key IS NOT NULL
            AND length(transaction_key) = 71
            AND substr(transaction_key, 1, 7) = 'sha256:'
            AND substr(transaction_key, 8) NOT GLOB '*[^0-9a-f]*'
            AND transaction_id_hash IS NOT NULL
            AND length(transaction_id_hash) = 71
            AND substr(transaction_id_hash, 1, 7) = 'sha256:'
            AND substr(transaction_id_hash, 8) NOT GLOB '*[^0-9a-f]*'
            AND transaction_economic_hash IS NOT NULL
            AND length(transaction_economic_hash) = 71
            AND substr(transaction_economic_hash, 1, 7) = 'sha256:'
            AND substr(transaction_economic_hash, 8) NOT GLOB '*[^0-9a-f]*'
            AND buyer_pseudonym IS NOT NULL
            AND length(buyer_pseudonym) = 70
            AND substr(buyer_pseudonym, 1, 6) = 'buyer_'
            AND substr(buyer_pseudonym, 7) NOT GLOB '*[^0-9a-f]*'
            AND buyer_key_id IS NOT NULL
            AND buyer_key_version > 0
            AND buyer_independence_basis IS NOT NULL
            AND transaction_event_type IS NOT NULL
            AND transaction_chain_sequence >= 0
            AND transaction_status IS NOT NULL
            AND settlement_state IS NOT NULL
            AND occurred_at IS NOT NULL
            AND gross_revenue_original_minor_units IS NOT NULL
            AND gross_revenue_original_minor_units >= 0
            AND length(gross_revenue_currency) = 3
            AND gross_revenue_aud_cents IS NOT NULL
            AND gross_revenue_aud_cents >= 0
            AND refunds_original_minor_units IS NOT NULL
            AND refunds_original_minor_units >= 0
            AND refunds_currency = gross_revenue_currency
            AND refunds_aud_cents IS NOT NULL
            AND refunds_aud_cents >= 0
            AND refunds_aud_cents <= gross_revenue_aud_cents
            AND json_type(record_json, '$.transaction') IS 'object'
            AND json_extract(record_json, '$.transaction.transactionKey') IS transaction_key
            AND json_extract(record_json, '$.transaction.transactionIdHash')
              IS transaction_id_hash
            AND json_extract(record_json, '$.transaction.transactionEconomicHash')
              IS transaction_economic_hash
            AND json_extract(record_json, '$.transaction.buyer.pseudonym') IS buyer_pseudonym
            AND json_extract(record_json, '$.transaction.buyer.keyId') IS buyer_key_id
            AND json_extract(record_json, '$.transaction.buyer.keyVersion')
              IS buyer_key_version
            AND json_extract(record_json, '$.transaction.buyer.independenceBasis')
              IS buyer_independence_basis
            AND json_extract(record_json, '$.transaction.eventType') IS transaction_event_type
            AND json_extract(record_json, '$.transaction.chain.sequence')
              IS transaction_chain_sequence
            AND json_type(record_json, '$.transaction.chain.predecessorRecordHash')
              IS NOT NULL
            AND json_extract(record_json, '$.transaction.chain.predecessorRecordHash')
              IS supersedes_record_hash
            AND json_extract(record_json, '$.transaction.status') IS transaction_status
            AND json_extract(record_json, '$.transaction.settlement.state') IS settlement_state
            AND json_type(record_json, '$.transaction.settlement.referenceHash')
              IS NOT NULL
            AND json_extract(record_json, '$.transaction.settlement.referenceHash')
              IS settlement_reference_hash
            AND json_extract(record_json, '$.transaction.occurredAt') IS occurred_at
            AND json_type(record_json, '$.transaction.settledAt') IS NOT NULL
            AND json_extract(record_json, '$.transaction.settledAt') IS settled_at
            AND json_extract(
              record_json,
              '$.transaction.grossRevenue.originalMinorUnits'
            ) IS gross_revenue_original_minor_units
            AND json_extract(record_json, '$.transaction.grossRevenue.currency')
              IS gross_revenue_currency
            AND json_extract(record_json, '$.transaction.grossRevenue.audCents')
              IS gross_revenue_aud_cents
            AND json_extract(record_json, '$.transaction.grossRevenueAudCents')
              IS gross_revenue_aud_cents
            AND json_extract(record_json, '$.transaction.refunds.originalMinorUnits')
              IS refunds_original_minor_units
            AND json_extract(record_json, '$.transaction.refunds.currency')
              IS refunds_currency
            AND json_extract(record_json, '$.transaction.refunds.audCents')
              IS refunds_aud_cents
            AND json_extract(record_json, '$.transaction.refundsAudCents')
              IS refunds_aud_cents
            AND json_type(record_json, '$.cost') IS 'null'
          )
          OR (
            kind <> 'transaction'
            AND transaction_key IS NULL
            AND transaction_id_hash IS NULL
            AND transaction_economic_hash IS NULL
            AND buyer_pseudonym IS NULL
            AND buyer_key_id IS NULL
            AND buyer_key_version IS NULL
            AND buyer_independence_basis IS NULL
            AND transaction_event_type IS NULL
            AND transaction_chain_sequence IS NULL
            AND transaction_status IS NULL
            AND settlement_state IS NULL
            AND settlement_reference_hash IS NULL
            AND settled_at IS NULL
            AND gross_revenue_original_minor_units IS NULL
            AND gross_revenue_currency IS NULL
            AND gross_revenue_aud_cents IS NULL
            AND refunds_original_minor_units IS NULL
            AND refunds_currency IS NULL
            AND refunds_aud_cents IS NULL
            AND json_type(record_json, '$.transaction') IS 'null'
          )
        ),
        CHECK(
          (
            kind = 'cost'
            AND cost_key IS NOT NULL
            AND length(cost_key) = 71
            AND substr(cost_key, 1, 7) = 'sha256:'
            AND substr(cost_key, 8) NOT GLOB '*[^0-9a-f]*'
            AND cost_id_hash IS NOT NULL
            AND length(cost_id_hash) = 71
            AND substr(cost_id_hash, 1, 7) = 'sha256:'
            AND substr(cost_id_hash, 8) NOT GLOB '*[^0-9a-f]*'
            AND cost_economic_hash IS NOT NULL
            AND length(cost_economic_hash) = 71
            AND substr(cost_economic_hash, 1, 7) = 'sha256:'
            AND substr(cost_economic_hash, 8) NOT GLOB '*[^0-9a-f]*'
            AND cost_event_type IS NOT NULL
            AND cost_chain_sequence >= 0
            AND cost_category IS NOT NULL
            AND cost_state IS NOT NULL
            AND occurred_at IS NOT NULL
            AND (
              (
                cost_state = 'unknown'
                AND cost_original_minor_units IS NULL
                AND cost_currency IS NULL
                AND cost_aud_cents IS NULL
              )
              OR (
                cost_state <> 'unknown'
                AND cost_original_minor_units IS NOT NULL
                AND cost_original_minor_units >= 0
                AND length(cost_currency) = 3
                AND cost_aud_cents IS NOT NULL
                AND cost_aud_cents >= 0
              )
            )
            AND json_type(record_json, '$.cost') IS 'object'
            AND json_extract(record_json, '$.cost.costKey') IS cost_key
            AND json_extract(record_json, '$.cost.costIdHash') IS cost_id_hash
            AND json_extract(record_json, '$.cost.costEconomicHash') IS cost_economic_hash
            AND json_extract(record_json, '$.cost.eventType') IS cost_event_type
            AND json_extract(record_json, '$.cost.chain.sequence') IS cost_chain_sequence
            AND json_type(record_json, '$.cost.chain.predecessorRecordHash') IS NOT NULL
            AND json_extract(record_json, '$.cost.chain.predecessorRecordHash')
              IS supersedes_record_hash
            AND json_extract(record_json, '$.cost.category') IS cost_category
            AND json_extract(record_json, '$.cost.state') IS cost_state
            AND json_extract(record_json, '$.cost.occurredAt') IS occurred_at
            AND (
              (
                cost_state = 'unknown'
                AND json_type(record_json, '$.cost.amount') IS 'null'
                AND json_type(record_json, '$.cost.amountAudCents') IS 'null'
              )
              OR (
                cost_state <> 'unknown'
                AND json_extract(record_json, '$.cost.amount.originalMinorUnits')
                  IS cost_original_minor_units
                AND json_extract(record_json, '$.cost.amount.currency') IS cost_currency
                AND json_extract(record_json, '$.cost.amount.audCents') IS cost_aud_cents
                AND json_extract(record_json, '$.cost.amountAudCents') IS cost_aud_cents
              )
            )
          )
          OR (
            kind <> 'cost'
            AND cost_key IS NULL
            AND cost_id_hash IS NULL
            AND cost_economic_hash IS NULL
            AND cost_event_type IS NULL
            AND cost_chain_sequence IS NULL
            AND cost_category IS NULL
            AND cost_state IS NULL
            AND cost_original_minor_units IS NULL
            AND cost_currency IS NULL
            AND cost_aud_cents IS NULL
            AND json_type(record_json, '$.cost') IS 'null'
          )
        ),
        CHECK(
          (
            kind IN ('transaction', 'cost')
            AND (
              (
                source_kind = 'operator_attested_manual'
                AND verification_status = 'pending'
              )
              OR source_kind = 'imported_platform'
            )
          )
          OR (
            kind = 'manual_verification'
            AND source_kind = 'operator_attested_manual'
            AND verification_status IN ('verified', 'rejected')
            AND supersedes_record_hash IS NULL
            AND occurred_at IS NULL
          )
          OR (
            kind IN ('terminal_stop', 'evidence_set_manifest')
            AND verification_status = 'verified'
            AND occurred_at IS NULL
          )
        ),
        CHECK(
          (
            transaction_event_type = 'original'
            AND transaction_chain_sequence = 0
            AND supersedes_record_hash IS NULL
            AND json_type(record_json, '$.transaction.chain.reversesRecordHash') IS 'null'
          )
          OR (
            transaction_event_type IN ('correction', 'refund')
            AND transaction_chain_sequence > 0
            AND supersedes_record_hash IS NOT NULL
            AND json_type(record_json, '$.transaction.chain.reversesRecordHash') IS 'null'
          )
          OR (
            transaction_event_type = 'reversal'
            AND transaction_chain_sequence > 0
            AND supersedes_record_hash IS NOT NULL
            AND json_type(record_json, '$.transaction.chain.reversesRecordHash') IS 'text'
          )
          OR transaction_event_type IS NULL
        ),
        CHECK(
          (
            cost_event_type = 'original'
            AND cost_chain_sequence = 0
            AND supersedes_record_hash IS NULL
            AND json_type(record_json, '$.cost.chain.reversesRecordHash') IS 'null'
          )
          OR (
            cost_event_type = 'correction'
            AND cost_chain_sequence > 0
            AND supersedes_record_hash IS NOT NULL
            AND json_type(record_json, '$.cost.chain.reversesRecordHash') IS 'null'
          )
          OR (
            cost_event_type = 'reversal'
            AND cost_chain_sequence > 0
            AND supersedes_record_hash IS NOT NULL
            AND json_type(record_json, '$.cost.chain.reversesRecordHash') IS 'text'
          )
          OR cost_event_type IS NULL
        ),
        CHECK(
          (
            settlement_state = 'cash_settled'
            AND transaction_status IN ('settled', 'refunded')
            AND settled_at IS NOT NULL
            AND settlement_reference_hash IS NOT NULL
            AND length(settlement_reference_hash) = 71
            AND substr(settlement_reference_hash, 1, 7) = 'sha256:'
            AND substr(settlement_reference_hash, 8) NOT GLOB '*[^0-9a-f]*'
          )
          OR (
            settlement_state IN ('pending', 'platform_balance', 'unknown')
            AND settled_at IS NULL
            AND settlement_reference_hash IS NULL
          )
          OR (
            settlement_state = 'not_applicable'
            AND transaction_status = 'cancelled'
            AND settled_at IS NULL
            AND settlement_reference_hash IS NULL
            AND gross_revenue_aud_cents = 0
            AND refunds_aud_cents = 0
          )
          OR settlement_state IS NULL
        ),
        CHECK(
          (
            kind = 'manual_verification'
            AND json_type(record_json, '$.manualVerification') IS 'object'
            AND json_type(record_json, '$.terminalStop') IS 'null'
            AND json_type(record_json, '$.manifest') IS 'null'
          )
          OR (
            kind = 'terminal_stop'
            AND json_type(record_json, '$.manualVerification') IS 'null'
            AND json_type(record_json, '$.terminalStop') IS 'object'
            AND json_type(record_json, '$.manifest') IS 'null'
          )
          OR (
            kind = 'evidence_set_manifest'
            AND json_type(record_json, '$.manualVerification') IS 'null'
            AND json_type(record_json, '$.terminalStop') IS 'null'
            AND json_type(record_json, '$.manifest') IS 'object'
          )
          OR (
            kind IN ('transaction', 'cost')
            AND json_type(record_json, '$.manualVerification') IS 'null'
            AND json_type(record_json, '$.terminalStop') IS 'null'
            AND json_type(record_json, '$.manifest') IS 'null'
          )
        )
      );

      CREATE TABLE IF NOT EXISTS commercial_test_proof_evaluations (
        evaluation_hash TEXT PRIMARY KEY
          CHECK(
            length(evaluation_hash) = 71
            AND substr(evaluation_hash, 1, 7) = 'sha256:'
            AND substr(evaluation_hash, 8) NOT GLOB '*[^0-9a-f]*'
          ),
        proof_schema TEXT NOT NULL
          CHECK(proof_schema = 'pantheon.commercial-test-proof-evaluation.v2'),
        decision_hash TEXT NOT NULL,
        evidence_set_hash TEXT NOT NULL
          CHECK(
            length(evidence_set_hash) = 71
            AND substr(evidence_set_hash, 1, 7) = 'sha256:'
            AND substr(evidence_set_hash, 8) NOT GLOB '*[^0-9a-f]*'
          ),
        outcome TEXT NOT NULL
          CHECK(outcome IN ('pass', 'revise', 'inconclusive', 'stop')),
        proof_reached INTEGER NOT NULL CHECK(proof_reached IN (0, 1)),
        buyer_signal_only INTEGER NOT NULL CHECK(buyer_signal_only IN (0, 1)),
        distinct_positive_buyers INTEGER NOT NULL CHECK(distinct_positive_buyers >= 0),
        settled_revenue_aud_cents INTEGER NOT NULL CHECK(settled_revenue_aud_cents >= 0),
        refunds_aud_cents INTEGER NOT NULL CHECK(refunds_aud_cents >= 0),
        reconciled_costs_aud_cents INTEGER NOT NULL CHECK(reconciled_costs_aud_cents >= 0),
        actual_net_cash_contribution_aud_cents INTEGER NOT NULL,
        evaluation_json TEXT NOT NULL
          CHECK(
            json_valid(evaluation_json)
            AND json_extract(evaluation_json, '$.schema') IS proof_schema
            AND json_extract(evaluation_json, '$.evaluationHash') IS evaluation_hash
            AND json_extract(evaluation_json, '$.decisionHash') IS decision_hash
            AND json_extract(evaluation_json, '$.evidenceSetHash') IS evidence_set_hash
            AND json_extract(evaluation_json, '$.outcome') IS outcome
            AND json_extract(evaluation_json, '$.proofReached') IS proof_reached
            AND json_extract(evaluation_json, '$.buyerSignalOnly') IS buyer_signal_only
            AND json_extract(evaluation_json, '$.evidence.distinctPositiveBuyers')
              IS distinct_positive_buyers
            AND json_extract(evaluation_json, '$.financials.settledRevenueAudCents')
              IS settled_revenue_aud_cents
            AND json_extract(evaluation_json, '$.financials.refundsAudCents')
              IS refunds_aud_cents
            AND json_extract(evaluation_json, '$.financials.reconciledCostsAudCents')
              IS reconciled_costs_aud_cents
            AND json_extract(
              evaluation_json,
              '$.financials.actualNetCashContributionAudCents'
            ) IS actual_net_cash_contribution_aud_cents
          ),
        evaluated_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(decision_hash, evidence_set_hash, evaluation_hash),
        FOREIGN KEY (decision_hash) REFERENCES commercial_test_contracts(decision_hash)
      );

    `);
    db.exec(Object.values(COMMERCIAL_LEDGER_REQUIRED_INDEX_SQL).join(";\n"));
    db.exec(Object.values(COMMERCIAL_LEDGER_IMMUTABLE_TRIGGER_SQL).join(";\n"));
    recordMigration(db, 25, "commercial-test-contract-evidence-ledger");
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function ensureCommercialLifecycleApprovalGuards(db) {
  const approvalIndex = get(
    db,
    `SELECT name FROM sqlite_master
     WHERE type = 'index' AND name = 'idx_commercial_test_lifecycle_approval_once'`,
  );
  const freshnessTrigger = get(
    db,
    `SELECT name FROM sqlite_master
     WHERE type = 'trigger'
       AND name = 'trg_commercial_test_lifecycle_resume_approval_fresh_insert'`,
  );
  if (approvalIndex && freshnessTrigger) return;

  db.exec("BEGIN IMMEDIATE");
  try {
    const replay = get(
      db,
      `SELECT approval_id, COUNT(*) AS uses
       FROM commercial_test_lifecycle_events
       WHERE approval_id IS NOT NULL
         AND event_type IN ('accepted', 'activated')
       GROUP BY approval_id
       HAVING COUNT(*) > 1
       ORDER BY approval_id
       LIMIT 1`,
    );
    if (replay) {
      throw new Error(
        `Commercial lifecycle approval ${replay.approval_id} is already bound to ${replay.uses} lifecycle events; approval history must be reconciled before startup.`,
      );
    }
    db.exec(COMMERCIAL_LEDGER_REQUIRED_INDEX_SQL
      .idx_commercial_test_lifecycle_approval_once);
    db.exec(COMMERCIAL_LEDGER_IMMUTABLE_TRIGGER_SQL
      .trg_commercial_test_lifecycle_resume_approval_fresh_insert);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function applyCanonicalCommercialTruthReconciliationMigration(db) {
  // Schema 26 is still an unreleased candidate. Re-assert these guards so
  // disposable databases opened during candidate development gain the exact
  // release contract even when migration 26 was already recorded.
  ensureCommercialLifecycleApprovalGuards(db);
  if (migrationApplied(db, 26)) return;
  db.exec("BEGIN IMMEDIATE");
  try {
    // Loaded lazily to avoid a module-initialization cycle: the reconciliation
    // module uses the database helpers exported by this file.
    const {
      reconcileCanonicalHistoricalTruth,
    } = require("./runtime/commercial-truth-reconciliation");
    reconcileCanonicalHistoricalTruth(db);
    recordMigration(db, 26, "canonical-commercial-truth-reconciliation");
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
  applyAgentOperationsEvidenceMigration(db);
  applyAgentContextMigration(db);
  applyDeliverableQualityReviewMigration(db);
  applyDataRetentionPolicyMigration(db);
  applyExecutionEvidenceBindingMigration(db);
  applyProviderAttemptReceiptBackfillMigration(db);
  applyStableSpendCostIdMigration(db);
  applyPantheonCommercialOperatingModelMigration(db);
  applyRetentionActivationLedgerMigration(db);
  applyFullJourneyMigration(db);
  applyCommercialIntelligenceMigration(db);
  applyRuntimeStopEvidenceMigration(db);
  applyModelCallCompletionTruthMigration(db);
  applyCommercialTestEvidenceLedgerMigration(db);
  applyCanonicalCommercialTruthReconciliationMigration(db);
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
    businessModel: "evidence_selected",
    platform: "evidence_selected",
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
      "First Venture",
      1,
      "validating",
      "The sole active venture until one evidence-selected offer proves three independent buyers and positive cash contribution.",
      toJson({
        channel: "Evidence-selected distribution",
        publicIdentity: "faceless_and_voiceless",
        successThreshold: "3 independent paid buyers and positive cash contribution",
      }),
      ts,
      ts,
      "validating",
      1,
      "unselected",
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
      ? "Pantheon test runtime seeded with explicit demo proof fixtures."
      : "Pantheon runtime initialized with one commercial venture, integrations, and cost controls.",
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
  applyCanonicalCommercialTruthReconciliationMigration,
  applyCommercialTestEvidenceLedgerMigration,
  applyCommercialIntelligenceMigration,
  applyModelCallCompletionTruthMigration,
  applyRuntimeStopEvidenceMigration,
  applyStableSpendCostIdMigration,
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
