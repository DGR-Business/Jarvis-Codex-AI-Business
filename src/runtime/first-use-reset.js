const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const CONFIG = require("../config");
const {
  all,
  fromJson,
  get,
  now,
  openDatabase,
  putSetting,
  run,
  seedDatabase,
  toJson,
  verifyDatabase,
} = require("../db");
const { ensureAgentWorkbench } = require("./agent-workbench");
const { ensureAgentTools } = require("./agent-tools");
const { ensureAiTeam } = require("./ai-team");
const { ensureCapabilityAutonomy } = require("./capability-autonomy");
const { DEFAULT_JOBS, ensureSchedulerJobs } = require("./scheduler");
const { ensureActiveVentureCase } = require("./venture-case");

const ACCOUNTING_SURVIVORS = Object.freeze({
  acct_chatgpt_pro_5x_recurring: { amountCents: 10000, status: "active" },
  acct_chatgpt_pro_upgrade_2026_07_05: { amountCents: 9468, status: "reconciled" },
  acct_openai_api_credit_2026_07_16: { amountCents: 1579, status: "reconciled" },
});

const USAGE_SURVIVORS = Object.freeze([
  {
    modelCallId: "model_cc0d5141-7b73-4a58-ae46-46262ff1aad8",
    taskId: "task_live_worker_wf_demand_validator_pilot_d49d9642",
    runId: "agent_run_20e97804-f6cb-4b49-9af3-49f71b6b89d6",
    amountCents: 3,
    status: "reconciled",
  },
  {
    modelCallId: "model_39fa5d59-bef8-4b97-b958-c3f26f75e1b5",
    taskId: "task_live_worker_wf_demand_validator_pilot_11493dc5",
    runId: "agent_run_977b9be7-9868-4150-89ac-f1e5f355470b",
    amountCents: 2,
    status: "reconciled",
  },
  {
    modelCallId: "model_pantheon_release_proof_2026_07_18",
    taskId: "task_pantheon_release_proof_2026_07_18",
    runId: "agent_run_pantheon_release_proof_2026_07_18",
    amountCents: 113,
    status: "incurred_estimate",
  },
]);

const USAGE_TOTAL_CENTS = USAGE_SURVIVORS.reduce(
  (total, item) => total + item.amountCents,
  0,
);

const STATIC_COUNTS = Object.freeze({
  ventures: 1,
  venture_cases: 1,
  accounting_entries: 3,
  costs: 3,
  agent_definitions: 11,
  agent_tools: 41,
  agent_tool_assignments: 38,
  agent_eval_datasets: 11,
  agent_eval_cases: 11,
  scheduler_jobs: DEFAULT_JOBS.length,
  integrations: 11,
  capability_autonomy: 2,
});

const EMPTY_OPERATIONAL_TABLES = Object.freeze([
  "workflows",
  "workflow_runs",
  "commands",
  "tasks",
  "task_attempts",
  "approvals",
  "approval_action_tokens",
  "deliverables",
  "deliverable_sections",
  "deliverable_quality_reviews",
  "model_calls",
  "research_runs",
  "research_sources",
  "commercial_experiments",
  "commercial_briefs",
  "commercial_test_candidates",
  "commercial_results",
  "commercial_feedback",
  "commercial_learning_cycles",
  "commercial_test_proof_evaluations",
  "commercial_test_evidence_records",
  "commercial_test_evidence_receipts",
  "commercial_test_lifecycle_events",
  "commercial_test_contracts",
  "commercial_evidence",
  "commercial_execution_packs",
  "preventure_research_provider_billing_observations",
  "preventure_research_terminal_recoveries",
  "preventure_research_assignment_skips",
  "preventure_research_evidence_records",
  "preventure_research_source_snapshots",
  "preventure_research_cost_events",
  "preventure_research_lifecycle_events",
  "preventure_research_decisions",
  "preventure_research_terminal_stops",
  "preventure_research_assignments",
  "preventure_research_approval_decisions",
  "preventure_research_authorities",
  "opportunity_rounds",
  "opportunities",
  "catalogue_plans",
  "catalogue_items",
  "commercial_diagnoses",
  "supervisor_cycles",
  "platform_sales",
  "revenue",
  "work_packages",
  "venture_scorecards",
  "agent_run_receipts",
  "agent_run_provenance",
  "agent_context_snapshots",
  "agent_runs",
  "agent_trace_events",
  "agent_eval_results",
  "agent_tool_invocations",
  "agent_handoffs",
  "agent_model_comparison_packets",
  "agent_model_readiness_packs",
  "agent_pilot_fixtures",
  "agent_pilot_reviews",
  "messages",
  "inbound_messages",
  "notification_outbox",
  "monitor_runs",
  "monitor_findings",
  "scheduler_runs",
  "executive_digests",
  "venture_records",
  "events",
]);

const SETTINGS_TO_PRESERVE = Object.freeze([
  "operator.preferences",
  "operator.workload",
  "commercial.pilot",
  "budget",
  "autonomy",
]);

function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(filePath));
  return hash.digest("hex");
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function countRows(db, table) {
  return Number(get(db, `SELECT COUNT(*) AS count FROM ${table}`)?.count || 0);
}

function validateResetId(resetId) {
  const value = String(resetId || "").trim();
  if (!/^[a-z0-9][a-z0-9._-]{7,79}$/i.test(value)) {
    throw new Error("Reset id must be 8-80 letters, numbers, dots, underscores or hyphens.");
  }
  return value;
}

function assertBackupReference(backupReference) {
  const resolved = path.resolve(String(backupReference || ""));
  if (!backupReference || !fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
    throw new Error("A verified encrypted database backup file is required before a first-use reset can be built.");
  }
  return resolved;
}

function sourceSurvivors(db) {
  const accounting = all(
    db,
    `SELECT * FROM accounting_entries
     WHERE id IN (${Object.keys(ACCOUNTING_SURVIVORS).map(() => "?").join(", ")})
     ORDER BY id`,
    Object.keys(ACCOUNTING_SURVIVORS),
  );
  if (accounting.length !== Object.keys(ACCOUNTING_SURVIVORS).length) {
    throw new Error("The source database does not contain the exact three approved accounting survivors.");
  }
  for (const row of accounting) {
    const expected = ACCOUNTING_SURVIVORS[row.id];
    if (!expected || Number(row.amount_cents) !== expected.amountCents || row.status !== expected.status || row.currency !== "AUD") {
      throw new Error(`Accounting survivor ${row.id} does not match the approved AUD record.`);
    }
  }

  const usage = USAGE_SURVIVORS.map((expected) => {
    const row = get(
      db,
      `SELECT * FROM costs
       WHERE model_call_id = ? AND status = ? AND currency = 'AUD' AND amount_cents = ?`,
      [expected.modelCallId, expected.status, expected.amountCents],
    );
    if (!row) throw new Error(`Preserved provider usage is missing for ${expected.modelCallId}.`);
    return { ...row, run_id: expected.runId, task_id: expected.taskId, model_call_id: expected.modelCallId };
  });
  if (usage.reduce((sum, row) => sum + Number(row.amount_cents), 0) !== USAGE_TOTAL_CENTS) {
    throw new Error(`Approved provider usage survivors must total exactly A$${(USAGE_TOTAL_CENTS / 100).toFixed(2)}.`);
  }

  const venture = get(db, "SELECT * FROM ventures WHERE id = 'venture-digital-products'");
  if (!venture) throw new Error("The Digital Products venture is missing from the source database.");
  const settings = all(
    db,
    `SELECT key, value, updated_at FROM settings
     WHERE key IN (${SETTINGS_TO_PRESERVE.map(() => "?").join(", ")})`,
    SETTINGS_TO_PRESERVE,
  );
  if (settings.length !== SETTINGS_TO_PRESERVE.length) {
    throw new Error("The source database is missing one or more approved operator settings.");
  }
  const retentionActivations = all(
    db,
    "SELECT * FROM data_retention_policy_activations ORDER BY activated_at, id",
  );
  const retentionPolicyIds = [...new Set(retentionActivations.map((row) => row.policy_id))];
  const retentionPolicies = retentionPolicyIds.length
    ? all(
        db,
        `SELECT * FROM data_retention_policies
         WHERE id IN (${retentionPolicyIds.map(() => "?").join(", ")})
         ORDER BY version, id`,
        retentionPolicyIds,
      )
    : [];
  if (retentionPolicies.length !== retentionPolicyIds.length) {
    throw new Error("A retained data-policy activation is missing its immutable policy record.");
  }
  return {
    accounting,
    usage,
    venture,
    settings,
    retentionPolicies,
    retentionActivations,
  };
}

function copyAccountingRows(db, rows) {
  for (const row of rows) {
    run(
      db,
      `INSERT INTO accounting_entries
       (id, venture_id, entry_type, category, source, description, status, amount_cents,
        currency, occurred_at, next_due_at, metadata, created_at, updated_at, effect_sign,
        supersedes_entry_id, reverses_entry_id, revision_reason)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        row.id,
        row.venture_id,
        row.entry_type,
        row.category,
        row.source,
        row.description,
        row.status,
        row.amount_cents,
        row.currency,
        row.occurred_at,
        row.next_due_at,
        row.metadata,
        row.created_at,
        row.updated_at,
        row.effect_sign,
        row.supersedes_entry_id,
        row.reverses_entry_id,
        row.revision_reason,
      ],
    );
  }
}

function copyUsageRows(db, rows) {
  for (const row of rows) {
    run(
      db,
      `INSERT INTO costs
       (id, workflow_id, category, source, status, amount_cents, currency, occurred_at,
        metadata, venture_id, run_id, task_id, model_call_id)
       VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        row.id,
        row.category,
        row.source,
        row.status,
        row.amount_cents,
        row.currency,
        row.occurred_at,
        row.metadata,
        "venture-digital-products",
        row.run_id,
        row.task_id,
        row.model_call_id,
      ],
    );
  }
}

function copyRetentionPolicyRows(db, rows) {
  for (const row of rows) {
    run(
      db,
      `INSERT INTO data_retention_policies
       (id, version, title, policy, policy_hash, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [row.id, row.version, row.title, row.policy, row.policy_hash, row.created_at],
    );
  }
}

function copyRetentionActivationRows(db, rows) {
  for (const row of rows) {
    run(
      db,
      `INSERT INTO data_retention_policy_activations
       (id, policy_id, policy_hash, approval_id, proof_hash, activated_at,
        activated_by, metadata, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        row.id,
        row.policy_id,
        row.policy_hash,
        row.approval_id,
        row.proof_hash,
        row.activated_at,
        row.activated_by,
        row.metadata,
        row.created_at,
      ],
    );
  }
}

function verifyFirstUseDatabase(db, options = {}) {
  const integrity = verifyDatabase(db);
  const counts = {};
  for (const [table, expected] of Object.entries(STATIC_COUNTS)) {
    counts[table] = countRows(db, table);
    if (counts[table] !== expected) throw new Error(`${table} has ${counts[table]} rows; expected ${expected}.`);
  }
  for (const table of EMPTY_OPERATIONAL_TABLES) {
    counts[table] = countRows(db, table);
    if (counts[table] !== 0) throw new Error(`${table} must be empty in the first-use runtime.`);
  }
  if (countRows(db, "ventures") !== 1 || countRows(db, "ventures WHERE is_active = 1") !== 1) {
    throw new Error("The first-use runtime must contain exactly one active venture.");
  }
  const accounting = all(db, "SELECT id, amount_cents, status, currency FROM accounting_entries ORDER BY id");
  for (const row of accounting) {
    const expected = ACCOUNTING_SURVIVORS[row.id];
    if (!expected || Number(row.amount_cents) !== expected.amountCents || row.status !== expected.status || row.currency !== "AUD") {
      throw new Error(`Unexpected accounting survivor: ${row.id}.`);
    }
  }
  const usage = all(db, "SELECT model_call_id, amount_cents, status, currency FROM costs ORDER BY model_call_id");
  if (
    usage.reduce((sum, row) => sum + Number(row.amount_cents), 0) !== USAGE_TOTAL_CENTS
    || usage.some((row) => row.currency !== "AUD")
  ) {
    throw new Error(`The first-use runtime must preserve exactly A$${(USAGE_TOTAL_CENTS / 100).toFixed(2)} of provider usage.`);
  }
  for (const expected of USAGE_SURVIVORS) {
    if (!usage.some((row) => (
      row.model_call_id === expected.modelCallId
      && Number(row.amount_cents) === expected.amountCents
      && row.status === expected.status
    ))) {
      throw new Error(`Provider usage attribution is missing for ${expected.modelCallId}.`);
    }
  }
  const autonomy = fromJson(get(db, "SELECT value FROM settings WHERE key = 'autonomy'")?.value, {});
  if (Number(autonomy.capabilityPromotionMinimumRuns) !== 5
    || Number(autonomy.promotionMinimumApprovals) !== 5
    || autonomy.exactCapabilityOnly !== true
    || autonomy.globalAgentPromotionDisabled !== true) {
    throw new Error("Autonomy must require five successful reviews for one exact capability.");
  }
  if (countRows(db, "capability_autonomy WHERE required_passes = 5 AND consecutive_passes = 0 AND status = 'supervised'") !== 2) {
    throw new Error("All first-use capabilities must start supervised at zero of five reviews.");
  }
  const schedulerJobIds = all(
    db,
    "SELECT id FROM scheduler_jobs ORDER BY id",
  ).map((row) => row.id);
  const expectedSchedulerJobIds = DEFAULT_JOBS.map((job) => job.id).sort();
  if (JSON.stringify(schedulerJobIds) !== JSON.stringify(expectedSchedulerJobIds)) {
    throw new Error("The first-use runtime must contain only the canonical scheduler controls.");
  }
  const preventureJob = get(
    db,
    `SELECT kind, status, metadata, next_run_at, last_run_at, locked_at, lock_owner
     FROM scheduler_jobs
     WHERE id = 'job-preventure-research'`,
  );
  const preventureJobMetadata = fromJson(preventureJob?.metadata, {});
  if (
    preventureJob?.kind !== "preventure_research"
    || preventureJob.status !== "disabled"
    || preventureJobMetadata.exactAuthorityOnly !== true
    || preventureJobMetadata.externalCommercialEffectsAllowed !== false
    || preventureJob.next_run_at !== null
    || preventureJob.last_run_at !== null
    || preventureJob.locked_at !== null
    || preventureJob.lock_owner !== null
  ) {
    throw new Error(
      "The first-use bounded-diligence scheduler must remain disabled, exact-authority-only, and unlocked.",
    );
  }
  const activationCount = countRows(db, "data_retention_policy_activations");
  if (
    options.expectedRetentionActivationCount !== undefined
    && activationCount !== Number(options.expectedRetentionActivationCount)
  ) {
    throw new Error(
      `The first-use runtime retained ${activationCount} data-policy activation record(s); expected ${options.expectedRetentionActivationCount}.`,
    );
  }
  const resetRows = countRows(db, "runtime_resets");
  if (options.resetId) {
    if (resetRows !== 1 || !get(db, "SELECT reset_id FROM runtime_resets WHERE reset_id = ?", [options.resetId])) {
      throw new Error("The first-use reset manifest is missing or ambiguous.");
    }
  } else if (resetRows !== 0) {
    throw new Error("A reset manifest was written before candidate verification completed.");
  }
  return { integrity, counts, resetRows };
}

function buildFirstUseDatabase(sourceDbPath, options = {}) {
  const sourcePath = path.resolve(sourceDbPath);
  const resetId = validateResetId(options.resetId);
  const backupReference = assertBackupReference(options.backupReference);
  if (!fs.existsSync(sourcePath)) throw new Error(`Source database not found: ${sourcePath}`);
  const candidatePath = path.resolve(options.candidatePath || path.join(path.dirname(sourcePath), `runtime.reset-${resetId}.sqlite`));
  if (candidatePath === sourcePath) throw new Error("Reset candidate path must differ from the active database path.");
  if (path.dirname(candidatePath) !== path.dirname(sourcePath)) {
    throw new Error("Reset candidate must be built beside the active database for an atomic replacement.");
  }
  if (fs.existsSync(candidatePath)) throw new Error(`Reset candidate already exists: ${candidatePath}`);

  let sourceDb;
  let targetDb;
  try {
    sourceDb = openDatabase(sourcePath);
    const existingReset = get(sourceDb, "SELECT * FROM runtime_resets WHERE reset_id = ? AND status = 'applied'", [resetId]);
    if (existingReset) {
      sourceDb.close();
      sourceDb = null;
      return { alreadyApplied: true, resetId, manifest: fromJson(existingReset.manifest), candidatePath: null };
    }
    const survivors = sourceSurvivors(sourceDb);
    sourceDb.exec("PRAGMA wal_checkpoint(FULL);");
    const sourceDatabaseSha256 = sha256File(sourcePath);
    const createdAt = now();
    const sourceOperationalCounts = Object.fromEntries(
      EMPTY_OPERATIONAL_TABLES.map((table) => [table, countRows(sourceDb, table)]),
    );

    targetDb = openDatabase(candidatePath);
    seedDatabase(targetDb);
    run(
      targetDb,
      `UPDATE ventures
       SET name = ?, stage = ?, status = 'validating', summary = ?, metadata = ?,
           lifecycle_stage = 'validating', is_active = 1, business_model = 'digital_product',
           created_at = ?, updated_at = ?
       WHERE id = 'venture-digital-products'`,
      [
        survivors.venture.name,
        survivors.venture.stage,
        survivors.venture.summary,
        survivors.venture.metadata,
        survivors.venture.created_at,
        survivors.venture.updated_at,
      ],
    );
    for (const setting of survivors.settings) {
      if (setting.key === "autonomy") continue;
      run(
        targetDb,
        `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
        [setting.key, setting.value, setting.updated_at],
      );
    }
    const sourceAutonomy = fromJson(survivors.settings.find((item) => item.key === "autonomy")?.value, {});
    putSetting(targetDb, "autonomy", {
      ...sourceAutonomy,
      capabilityPromotionMinimumRuns: 5,
      promotionMinimumApprovals: 5,
      exactCapabilityOnly: true,
      globalAgentPromotionDisabled: true,
      liveExternalActionsRequireApproval: true,
    });

    ensureActiveVentureCase(targetDb);
    ensureAiTeam(targetDb);
    ensureAgentTools(targetDb);
    ensureAgentWorkbench(targetDb);
    ensureSchedulerJobs(targetDb);
    ensureCapabilityAutonomy(targetDb);
    run(
      targetDb,
      `UPDATE capability_autonomy
       SET status = 'supervised', consecutive_passes = 0, required_passes = 5,
           promoted_at = NULL, suspended_at = NULL, last_review_at = NULL, updated_at = ?`,
      [createdAt],
    );
    run(
      targetDb,
      `UPDATE scheduler_jobs
       SET last_run_at = NULL, locked_at = NULL, lock_owner = NULL, updated_at = ?`,
      [createdAt],
    );
    copyAccountingRows(targetDb, survivors.accounting);
    copyUsageRows(targetDb, survivors.usage);
    copyRetentionPolicyRows(targetDb, survivors.retentionPolicies);
    copyRetentionActivationRows(targetDb, survivors.retentionActivations);
    run(targetDb, "DELETE FROM events");

    const verification = verifyFirstUseDatabase(targetDb, {
      expectedRetentionActivationCount: survivors.retentionActivations.length,
    });
    const manifest = {
      manifestVersion: 1,
      resetId,
      createdAt,
      sourceDatabaseSha256,
      backupReference,
      preservedAccountingIds: Object.keys(ACCOUNTING_SURVIVORS).sort(),
      preservedProviderUsage: USAGE_SURVIVORS.map((item) => ({
        modelCallId: item.modelCallId,
        amountCents: item.amountCents,
        status: item.status,
      })),
      providerUsageTotalCents: USAGE_TOTAL_CENTS,
      preservedRetentionPolicyIds: survivors.retentionPolicies.map((row) => row.id),
      preservedRetentionActivationIds: survivors.retentionActivations.map((row) => row.id),
      survivorCounts: STATIC_COUNTS,
      emptyOperationalTables: EMPTY_OPERATIONAL_TABLES,
      sourceOperationalCounts,
      verification,
    };
    const manifestText = stableJson(manifest);
    const manifestSha256 = crypto.createHash("sha256").update(manifestText).digest("hex");
    run(
      targetDb,
      `INSERT INTO runtime_resets
       (reset_id, status, source_database_sha256, backup_reference, manifest_sha256,
        manifest, created_at, applied_at)
       VALUES (?, 'built', ?, ?, ?, ?, ?, NULL)`,
      [resetId, sourceDatabaseSha256, backupReference, manifestSha256, JSON.stringify(manifest), createdAt],
    );
    verifyFirstUseDatabase(targetDb, { resetId });
    targetDb.close();
    targetDb = null;
    sourceDb.close();
    sourceDb = null;
    return {
      alreadyApplied: false,
      resetId,
      candidatePath,
      manifest,
      manifestSha256,
      candidateDatabaseSha256: sha256File(candidatePath),
    };
  } catch (error) {
    if (targetDb) targetDb.close();
    if (sourceDb) sourceDb.close();
    for (const filePath of [candidatePath, `${candidatePath}-wal`, `${candidatePath}-shm`]) {
      if (fs.existsSync(filePath)) fs.rmSync(filePath, { force: true });
    }
    throw error;
  }
}

function processIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function assertRuntimeStopped(sourceDbPath, options = {}) {
  const preferredPidPath = path.resolve(options.pidPath || path.join(CONFIG.rootDir, "tmp", "pantheon-server.pid"));
  const legacyPidPath = path.join(CONFIG.rootDir, "tmp", "jarvis-server.pid");
  const pidPath = fs.existsSync(preferredPidPath) ? preferredPidPath : legacyPidPath;
  if (fs.existsSync(pidPath)) {
    const pid = Number(fs.readFileSync(pidPath, "utf8").trim());
    if (Number.isInteger(pid) && pid > 0 && processIsAlive(pid)) {
      throw new Error(`Pantheon is still running as process ${pid}. Stop it before applying the reset.`);
    }
    throw new Error(`A stale server marker exists at ${pidPath}. Resolve it before applying the reset.`);
  }
  const db = new DatabaseSync(path.resolve(sourceDbPath));
  try {
    db.exec("PRAGMA busy_timeout = 1000;");
    db.exec("PRAGMA wal_checkpoint(TRUNCATE);");
    db.exec("BEGIN EXCLUSIVE;");
    db.exec("COMMIT;");
  } catch (error) {
    try { db.exec("ROLLBACK;"); } catch {}
    throw new Error(`The runtime database is busy; stop Pantheon before applying the reset. ${error.message}`);
  } finally {
    db.close();
  }
  return true;
}

function replaceWithFirstUseDatabase(sourceDbPath, candidatePath, options = {}) {
  const sourcePath = path.resolve(sourceDbPath);
  const candidate = path.resolve(candidatePath);
  const resetId = validateResetId(options.resetId);
  assertBackupReference(options.backupReference);
  if (path.dirname(sourcePath) !== path.dirname(candidate)) {
    throw new Error("Atomic reset replacement requires the candidate beside the active database.");
  }
  assertRuntimeStopped(sourcePath, options);
  const candidateDb = openDatabase(candidate);
  try {
    verifyFirstUseDatabase(candidateDb, { resetId });
  } finally {
    candidateDb.close();
  }
  for (const sidecar of [`${sourcePath}-wal`, `${sourcePath}-shm`]) {
    if (fs.existsSync(sidecar)) fs.rmSync(sidecar, { force: true });
  }
  const rollbackPath = `${sourcePath}.rollback-${resetId}`;
  if (fs.existsSync(rollbackPath)) throw new Error(`Reset rollback file already exists: ${rollbackPath}`);
  fs.renameSync(sourcePath, rollbackPath);
  try {
    fs.renameSync(candidate, sourcePath);
    const appliedDb = openDatabase(sourcePath);
    try {
      verifyFirstUseDatabase(appliedDb, { resetId });
      run(
        appliedDb,
        "UPDATE runtime_resets SET status = 'applied', applied_at = ? WHERE reset_id = ? AND status = 'built'",
        [now(), resetId],
      );
    } finally {
      appliedDb.close();
    }
    fs.rmSync(rollbackPath, { force: true });
    return { resetId, databasePath: sourcePath, status: "applied" };
  } catch (error) {
    const failedPath = `${candidate}.failed`;
    if (fs.existsSync(sourcePath) && !fs.existsSync(failedPath)) fs.renameSync(sourcePath, failedPath);
    if (fs.existsSync(rollbackPath)) fs.renameSync(rollbackPath, sourcePath);
    throw error;
  }
}

module.exports = {
  ACCOUNTING_SURVIVORS,
  EMPTY_OPERATIONAL_TABLES,
  SETTINGS_TO_PRESERVE,
  STATIC_COUNTS,
  USAGE_SURVIVORS,
  assertRuntimeStopped,
  buildFirstUseDatabase,
  replaceWithFirstUseDatabase,
  verifyFirstUseDatabase,
};
