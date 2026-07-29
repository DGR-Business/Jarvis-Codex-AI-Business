const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  all,
  fromJson,
  get,
  openDatabase,
  run,
  seedDatabase,
  toJson,
} = require("../src/db");
const {
  CommercialTruthReconciliationBlockedError,
  IDS,
  RECEIPT_ENTITY_ID,
  RECEIPT_EVENT_TYPE,
  getCanonicalTerminalView,
  hasCanonicalHistoricalTargets,
  reconcileCanonicalHistoricalTruth,
} = require("../src/runtime/commercial-truth-reconciliation");

const VENTURE_ID = IDS.venture;
const FIXTURE_AT = "2026-07-29T00:00:00.000Z";
const FIRST_RECONCILIATION_AT = "2026-07-29T06:00:00.000Z";
const SECOND_RECONCILIATION_AT = "2026-07-29T07:00:00.000Z";
const BUYER_TASK_ID =
  "task_live_worker_wf_buyer_intent_social_media_manager_client_control_v1_cat_579014de2c57";
const JOB_TASK_ID = "task_job_search_historical_proof";
const BUYER_ROUND_ID = "opp_round_buyer_intent_terminal_fixture";
const UNRELATED_WORKFLOW_ID = "wf_unrelated_active_work";
const UNRELATED_COMMAND_ID = "cmd_unrelated_active_work";
const UNRELATED_OPPORTUNITY_ID = "opp_unrelated_active_work";
const UNRELATED_PLAN_ID = "catalogue_unrelated_active_work";
const GENERIC_TERMINAL_PLAN_ID = "catalogue_generic_terminal_history";

function makeRuntime(name) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `pantheon-truth-${name}-`));
  const dbPath = path.join(root, "runtime.sqlite");
  const db = openDatabase(dbPath);
  seedDatabase(db);
  return { db, dbPath, root };
}

function closeRuntime(runtime) {
  runtime.db?.close();
  fs.rmSync(runtime.root, { recursive: true, force: true });
}

function insertWorkflow(db, id, status, currentStep) {
  run(
    db,
    `INSERT INTO workflows
     (id, venture_id, type, title, status, current_step, priority,
      approval_required, metadata, created_at, updated_at)
     VALUES (?, ?, 'commercial_discovery', ?, ?, ?, 1, 1, ?, ?, ?)`,
    [
      id,
      VENTURE_ID,
      `Historical workflow ${id}`,
      status,
      currentStep,
      toJson({ signedHistory: `workflow:${id}` }),
      FIXTURE_AT,
      FIXTURE_AT,
    ],
  );
}

function insertCommand(db, id, workflowId, status) {
  run(
    db,
    `INSERT INTO commands
     (id, source, raw_text, intent, status, workflow_id, summary, metadata,
      created_at, updated_at, venture_id)
     VALUES (?, 'operator', 'Historical commercial request', 'commercial_discovery',
             ?, ?, 'Original command summary', ?, ?, ?, ?)`,
    [
      id,
      status,
      workflowId,
      toJson({ signedHistory: `command:${id}` }),
      FIXTURE_AT,
      FIXTURE_AT,
      VENTURE_ID,
    ],
  );
}

function insertRound(db, id, status) {
  run(
    db,
    `INSERT INTO opportunity_rounds
     (id, venture_id, status, mode, prompt, metadata, created_at, updated_at)
     VALUES (?, ?, ?, 'production', 'Historical opportunity diligence', ?, ?, ?)`,
    [
      id,
      VENTURE_ID,
      status,
      toJson({ signedHistory: `round:${id}` }),
      FIXTURE_AT,
      FIXTURE_AT,
    ],
  );
}

function insertOpportunity(db, id, roundId, status) {
  run(
    db,
    `INSERT INTO opportunities
     (id, round_id, venture_id, source_type, status, title, business_model,
      buyer, problem, offer_direction, channel, metadata, created_at, updated_at)
     VALUES (?, ?, ?, 'public_research', ?, ?, 'digital_product',
             'Small business operator', 'Manual commercial administration',
             'Low-touch digital kit', 'marketplace', ?, ?, ?)`,
    [
      id,
      roundId,
      VENTURE_ID,
      status,
      `Historical opportunity ${id}`,
      toJson({ signedHistory: `opportunity:${id}` }),
      FIXTURE_AT,
      FIXTURE_AT,
    ],
  );
}

function insertBrief(db, id, workflowId, status) {
  run(
    db,
    `INSERT INTO commercial_briefs
     (id, workflow_id, venture_id, source, status, title, metadata,
      created_at, updated_at)
     VALUES (?, ?, ?, 'historical_fixture', ?, ?, ?, ?, ?)`,
    [
      id,
      workflowId,
      VENTURE_ID,
      status,
      `Historical brief ${id}`,
      toJson({ signedHistory: `brief:${id}` }),
      FIXTURE_AT,
      FIXTURE_AT,
    ],
  );
}

function insertExperiment(db, id, workflowId, status) {
  run(
    db,
    `INSERT INTO commercial_experiments
     (id, workflow_id, venture_id, name, status, hypothesis, buyer, offer,
      channel, price_cents, expected_metric, target_value, target_unit,
      cost_cap_cents, metadata, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'A bounded offer may attract qualified buyer intent',
             'Small business operator', 'Low-touch digital kit', 'marketplace',
             2900, 'paid buyers', 3, 'buyers', 0, ?, ?, ?)`,
    [
      id,
      workflowId,
      VENTURE_ID,
      `Historical experiment ${id}`,
      status,
      toJson({ signedHistory: `experiment:${id}` }),
      FIXTURE_AT,
      FIXTURE_AT,
    ],
  );
}

function insertCandidate(db, {
  id,
  briefId,
  workflowId,
  experimentId,
  status,
}) {
  run(
    db,
    `INSERT INTO commercial_test_candidates
     (id, brief_id, workflow_id, venture_id, rank, status, title, buyer,
      problem, offer, channel, price_cents, promoted_experiment_id, metadata,
      created_at, updated_at)
     VALUES (?, ?, ?, ?, 1, ?, ?, 'Small business operator',
             'Manual commercial administration', 'Low-touch digital kit',
             'marketplace', 2900, ?, ?, ?, ?)`,
    [
      id,
      briefId,
      workflowId,
      VENTURE_ID,
      status,
      `Historical candidate ${id}`,
      experimentId,
      toJson({ signedHistory: `candidate:${id}` }),
      FIXTURE_AT,
      FIXTURE_AT,
    ],
  );
}

function insertPlan(db, {
  id,
  opportunityId,
  status,
  workflowId,
  experimentId = null,
  buildStatus = null,
  archivedFromOperator,
}) {
  const metadata = {
    signedHistory: `plan:${id}`,
    validationSample: {
      workflowId,
      experimentId,
    },
  };
  if (buildStatus) metadata.buildStatus = buildStatus;
  if (archivedFromOperator !== undefined) {
    metadata.archivedFromOperator = archivedFromOperator;
  }
  run(
    db,
    `INSERT INTO catalogue_plans
     (id, venture_id, opportunity_id, status, title, rationale,
      target_item_count, target_variant_count, audience_segments, channels,
      geographies, languages, price_floor_cents, price_ceiling_cents,
      estimated_build_cost_cents, estimated_unit_cost_cents, metadata,
      created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'Retained historical plan', 1, 0, '[]',
             '["marketplace"]', '["Australia"]', '["English"]',
             2900, 2900, 0, 0, ?, ?, ?)`,
    [
      id,
      VENTURE_ID,
      opportunityId,
      status,
      `Historical plan ${id}`,
      toJson(metadata),
      FIXTURE_AT,
      FIXTURE_AT,
    ],
  );
}

function insertTask(db, id, workflowId, outcomeStatus) {
  run(
    db,
    `INSERT INTO tasks
     (id, workflow_id, title, kind, agent, status, priority, payload, result,
      created_at, updated_at, venture_id, claim_token, claimed_at,
      attempt_count, outcome_status)
     VALUES (?, ?, ?, 'commercial_analysis', 'jarvis', 'completed', 1,
             '{}', ?, ?, ?, ?, ?, ?, 1, ?)`,
    [
      id,
      workflowId,
      `Historical task ${id}`,
      toJson({ proof: `task-result:${id}` }),
      FIXTURE_AT,
      FIXTURE_AT,
      VENTURE_ID,
      `claim:${id}`,
      FIXTURE_AT,
      outcomeStatus,
    ],
  );
}

function seedCanonicalStaleHistory(db) {
  run(
    db,
    `INSERT INTO venture_cases
     (id, venture_id, buyer, problem, offer, price_cents, channel,
      active_experiment_id, kill_rule, next_money_move, operator_decision,
      latest_learning, metadata, created_at, updated_at)
     VALUES (?, ?, 'Mixed historical buyers', 'Unreconciled operator state',
             'Historical offers', 2900, 'marketplace', NULL,
             'Old kill rule', 'Old next move', 'Old operating decision',
             'Old learning', ?, ?, ?)`,
    [
      IDS.ventureCase,
      VENTURE_ID,
      toJson({ signedHistory: "venture-case-original" }),
      FIXTURE_AT,
      FIXTURE_AT,
    ],
  );

  insertWorkflow(
    db,
    IDS.jobSearch.workflow,
    "agent_running",
    "Old Job Search package waiting in production",
  );
  IDS.technicalFailures.forEach((item) => {
    insertWorkflow(db, item.workflow, "failed", "Historical technical failure");
  });
  IDS.noInvestment.forEach((item, index) => {
    insertWorkflow(
      db,
      item.workflow,
      index === IDS.noInvestment.length - 1 ? "ready_for_review" : "agent_running",
      "No-investment diligence still shown as current",
    );
  });
  insertWorkflow(
    db,
    IDS.buyerIntent.workflow,
    "needs_changes",
    "Quality inspection evidence recheck failed",
  );
  insertWorkflow(db, UNRELATED_WORKFLOW_ID, "agent_running", "Separate active work");

  insertCommand(db, IDS.jobSearch.command, IDS.jobSearch.workflow, "running");
  IDS.technicalFailures.forEach((item) => {
    insertCommand(db, item.command, item.workflow, "failed");
  });
  IDS.noInvestment.forEach((item) => {
    insertCommand(db, item.command, item.workflow, "running");
  });
  insertCommand(db, UNRELATED_COMMAND_ID, UNRELATED_WORKFLOW_ID, "running");

  insertRound(db, IDS.jobSearch.round, "ready_to_publish");
  insertRound(db, BUYER_ROUND_ID, "completed");
  insertOpportunity(
    db,
    IDS.jobSearch.opportunity,
    IDS.jobSearch.round,
    "building",
  );
  IDS.parkedAlternatives.forEach((id) => {
    insertOpportunity(db, id, IDS.jobSearch.round, "test_ready_alternative");
  });
  insertOpportunity(
    db,
    IDS.buyerIntent.opportunity,
    BUYER_ROUND_ID,
    "building",
  );
  insertOpportunity(
    db,
    UNRELATED_OPPORTUNITY_ID,
    BUYER_ROUND_ID,
    "building",
  );

  insertBrief(db, IDS.jobSearch.brief, IDS.jobSearch.workflow, "ready");
  insertBrief(db, IDS.buyerIntent.brief, IDS.buyerIntent.workflow, "exact_test_ready");
  insertExperiment(db, IDS.jobSearch.experiment, IDS.jobSearch.workflow, "cancelled");
  insertExperiment(
    db,
    IDS.buyerIntent.experiment,
    IDS.buyerIntent.workflow,
    "cancelled",
  );
  insertCandidate(db, {
    id: IDS.jobSearch.candidate,
    briefId: IDS.jobSearch.brief,
    workflowId: IDS.jobSearch.workflow,
    experimentId: null,
    status: "recommended",
  });
  insertCandidate(db, {
    id: IDS.buyerIntent.candidate,
    briefId: IDS.buyerIntent.brief,
    workflowId: IDS.buyerIntent.workflow,
    experimentId: IDS.buyerIntent.experiment,
    status: "promoted",
  });

  insertPlan(db, {
    id: IDS.jobSearch.plan,
    opportunityId: IDS.jobSearch.opportunity,
    status: "ready_to_publish",
    workflowId: IDS.jobSearch.workflow,
    experimentId: IDS.jobSearch.experiment,
    archivedFromOperator: true,
  });
  insertPlan(db, {
    id: IDS.buyerIntent.plan,
    opportunityId: IDS.buyerIntent.opportunity,
    status: "needs_attention",
    workflowId: IDS.buyerIntent.workflow,
    experimentId: IDS.buyerIntent.experiment,
    buildStatus: "inspection_evidence_recheck_failed_terminal",
    archivedFromOperator: false,
  });
  insertPlan(db, {
    id: UNRELATED_PLAN_ID,
    opportunityId: UNRELATED_OPPORTUNITY_ID,
    status: "building",
    workflowId: UNRELATED_WORKFLOW_ID,
  });
  insertPlan(db, {
    id: GENERIC_TERMINAL_PLAN_ID,
    opportunityId: UNRELATED_OPPORTUNITY_ID,
    status: "needs_attention",
    workflowId: UNRELATED_WORKFLOW_ID,
    buildStatus: "inspection_evidence_recheck_declined_terminal",
  });

  insertTask(
    db,
    JOB_TASK_ID,
    IDS.jobSearch.workflow,
    "confirmed_success",
  );
  insertTask(
    db,
    BUYER_TASK_ID,
    IDS.buyerIntent.workflow,
    "confirmed_not_dispatched",
  );
  run(
    db,
    `INSERT INTO task_attempts
     (id, task_id, workflow_id, venture_id, claim_token, status,
      outcome_status, started_at, completed_at, metadata)
     VALUES ('attempt_historical_proof', ?, ?, ?, 'attempt-claim-historical-proof',
             'completed', 'confirmed_success', ?, ?, ?)`,
    [
      JOB_TASK_ID,
      IDS.jobSearch.workflow,
      VENTURE_ID,
      FIXTURE_AT,
      FIXTURE_AT,
      toJson({ immutableProof: "attempt-proof" }),
    ],
  );
  run(
    db,
    `INSERT INTO model_calls
     (id, workflow_id, task_id, provider, model_class, selected_model, mode,
      status, input_tokens, output_tokens, estimated_cost_cents,
      actual_cost_cents, approval_required, metadata, created_at, venture_id,
      provider_request_id, cost_status, reserved_cost_cents,
      incurred_estimate_cents, reconciled_cost_cents, outcome_status,
      attempt_id, completed_at)
     VALUES ('model_call_historical_proof', ?, ?, 'openai', 'reasoning',
             'historical-model', 'historical', 'completed', 20, 10, 2, 2, 0,
             ?, ?, ?, 'provider-request-historical-proof', 'reconciled',
             2, 2, 2, 'confirmed_success', 'attempt_historical_proof', ?)`,
    [
      IDS.jobSearch.workflow,
      JOB_TASK_ID,
      toJson({ immutableProof: "model-call-proof" }),
      FIXTURE_AT,
      VENTURE_ID,
      FIXTURE_AT,
    ],
  );

  IDS.reviewDeliverables.forEach((id, index) => {
    run(
      db,
      `INSERT INTO deliverables
       (id, workflow_id, command_id, task_id, title, human_name, audience,
        format, status, file_path, summary, metadata, created_at, updated_at,
        venture_id, artifact_key, content_hash, version)
       VALUES (?, ?, ?, ?, ?, ?, 'Job seekers', 'pdf', 'ready_for_review',
               ?, 'Immutable historical package output', ?, ?, ?, ?, ?, ?, 1)`,
      [
        id,
        IDS.jobSearch.workflow,
        IDS.jobSearch.command,
        JOB_TASK_ID,
        `Historical deliverable ${index + 1}`,
        `Historical deliverable ${index + 1}`,
        `artifacts/history/job-search-${index + 1}.pdf`,
        toJson({
          signedHistory: `deliverable:${id}`,
          immutableArtifactProof: true,
        }),
        FIXTURE_AT,
        FIXTURE_AT,
        VENTURE_ID,
        `historical-job-search-${index + 1}`,
        `sha256:historical-content-${index + 1}`,
      ],
    );
  });

  run(
    db,
    `INSERT INTO pantheon_journeys
     (id, venture_id, mode, status, active_stage, model, model_locked,
      budget_cap_cents, carried_exposure_cents, round_id, workflow_id,
      selected_opportunity_id, metadata, started_at, completed_at,
      created_at, updated_at)
     VALUES (?, ?, 'production', 'completed', 'commercial_build',
             'digital_product', 1, 10000, 0, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      IDS.jobSearch.journey,
      VENTURE_ID,
      IDS.jobSearch.round,
      IDS.jobSearch.workflow,
      IDS.jobSearch.opportunity,
      toJson({ signedHistory: "journey-original" }),
      FIXTURE_AT,
      FIXTURE_AT,
      FIXTURE_AT,
      FIXTURE_AT,
    ],
  );
  run(
    db,
    `INSERT INTO venture_scorecards
     (id, venture_id, workflow_id, command_id, channel, subject, status,
      verdict, recommendation, total_score, confidence, metadata,
      created_at, updated_at)
     VALUES (?, ?, ?, ?, 'marketplace', 'Historical Job Search offer',
             'ready_for_review', 'park', 'Retain for history', 55, 'medium',
             ?, ?, ?)`,
    [
      IDS.jobSearch.scorecard,
      VENTURE_ID,
      IDS.jobSearch.workflow,
      IDS.jobSearch.command,
      toJson({ signedHistory: "scorecard-original" }),
      FIXTURE_AT,
      FIXTURE_AT,
    ],
  );

  run(
    db,
    `INSERT INTO monitor_runs
     (id, status, severity, finding_count, started_at, completed_at, metadata)
     VALUES ('monitor_run_terminal_fixture', 'completed', 'warning', 6, ?, ?, '{}')`,
    [FIXTURE_AT, FIXTURE_AT],
  );
  IDS.terminalFindings.forEach((id, index) => {
    run(
      db,
      `INSERT INTO monitor_findings
       (id, run_id, severity, category, entity_type, entity_id, title, detail,
        status, metadata, created_at, fingerprint, first_seen, last_seen,
        occurrence_count, resolved_at, venture_id)
       VALUES (?, 'monitor_run_terminal_fixture', 'warning', 'quality',
               'catalogue_plan', ?, ?, 'Original quality finding remains true',
               'open', ?, ?, ?, ?, ?, 1, NULL, ?)`,
      [
        id,
        IDS.buyerIntent.plan,
        `Terminal quality finding ${index + 1}`,
        toJson({
          workflowId: IDS.buyerIntent.workflow,
          immutableFindingProof: `finding-proof-${index + 1}`,
        }),
        FIXTURE_AT,
        `terminal-fixture-${index + 1}`,
        FIXTURE_AT,
        FIXTURE_AT,
        VENTURE_ID,
      ],
    );
  });

  run(
    db,
    `INSERT INTO costs
     (id, workflow_id, category, source, status, amount_cents, currency,
      occurred_at, metadata, venture_id, task_id)
     VALUES (?, ?, 'model', 'approval_gate', 'approval_requested', 0, 'AUD',
             ?, ?, ?, NULL)`,
    [
      IDS.releasedCost,
      IDS.buyerIntent.workflow,
      FIXTURE_AT,
      toJson({
        taskId: BUYER_TASK_ID,
        noSpendOccurred: true,
        approvalSuperseded: true,
      }),
      VENTURE_ID,
    ],
  );
  run(
    db,
    `INSERT INTO costs
     (id, workflow_id, category, source, status, amount_cents, currency,
      occurred_at, metadata, venture_id, task_id, model_call_id)
     VALUES ('cost_historical_reconciled', ?, 'model', 'provider',
             'reconciled', 2, 'AUD', ?, ?, ?, ?, 'model_call_historical_proof')`,
    [
      IDS.jobSearch.workflow,
      FIXTURE_AT,
      toJson({ immutableProof: "cost-proof" }),
      VENTURE_ID,
      JOB_TASK_ID,
    ],
  );
  run(
    db,
    `INSERT INTO commercial_results
     (id, experiment_id, workflow_id, source, status, views, clicks, leads,
      sales, refunds, revenue_cents, spend_cents, time_spent_minutes, notes,
      occurred_at, metadata, created_at, venture_id, verified, currency)
     VALUES ('result_unverified_historical', ?, ?, 'internal_observation',
             'recorded', 0, 0, 0, 0, 0, 0, 0, 10,
             'No buyer result was verified', ?, ?, ?, ?, 0, 'AUD')`,
    [
      IDS.buyerIntent.experiment,
      IDS.buyerIntent.workflow,
      FIXTURE_AT,
      toJson({ immutableProof: "result-proof" }),
      FIXTURE_AT,
      VENTURE_ID,
    ],
  );
  run(
    db,
    `INSERT INTO commercial_evidence
     (id, venture_id, experiment_id, source_type, source_url, title, summary,
      captured_at, verified_at, is_demo, metadata, created_at, claim, metric,
      measured_value, measured_unit, market, geography, observed_at,
      sample_size, publisher, extraction_method, confidence)
     VALUES ('evidence_historical_terminal', ?, ?, 'inspection',
             'https://example.com/immutable-evidence',
             'Historical inspection evidence',
             'The inspection evidence that caused the build to stop.', ?, ?,
             0, ?, ?, 'The build did not pass inspection evidence.',
             'quality_pass', 0, 'boolean', 'digital products', 'Australia', ?,
             1, 'Pantheon', 'recorded inspection', 'high')`,
    [
      VENTURE_ID,
      IDS.buyerIntent.experiment,
      FIXTURE_AT,
      FIXTURE_AT,
      toJson({ immutableProof: "evidence-proof" }),
      FIXTURE_AT,
      FIXTURE_AT,
    ],
  );
  run(
    db,
    `INSERT INTO accounting_entries
     (id, venture_id, entry_type, category, source, description, status,
      amount_cents, currency, occurred_at, metadata, created_at, updated_at,
      effect_sign)
     VALUES ('acct_historical_immutable', ?, 'cash_outflow', 'model',
             'operator_receipt', 'Historical settled model cost', 'reconciled',
             2, 'AUD', ?, ?, ?, ?, 1)`,
    [
      VENTURE_ID,
      FIXTURE_AT,
      toJson({ immutableProof: "accounting-proof" }),
      FIXTURE_AT,
      FIXTURE_AT,
    ],
  );
}

function immutableProof(db) {
  return {
    accounting: all(db, "SELECT * FROM accounting_entries ORDER BY id"),
    evidence: all(db, "SELECT * FROM commercial_evidence ORDER BY id"),
    results: all(db, "SELECT * FROM commercial_results ORDER BY id"),
    tasks: all(db, "SELECT * FROM tasks ORDER BY id"),
    attempts: all(db, "SELECT * FROM task_attempts ORDER BY id"),
    modelCalls: all(db, "SELECT * FROM model_calls ORDER BY id"),
    artifactContent: all(
      db,
      `SELECT id, file_path, content_hash, version
       FROM deliverables ORDER BY id`,
    ),
    accountingTotal: get(
      db,
      `SELECT COALESCE(SUM(amount_cents * effect_sign), 0) AS amount_cents
       FROM accounting_entries
       WHERE status = 'reconciled'`,
    ).amount_cents,
    costTotal: get(
      db,
      "SELECT COALESCE(SUM(amount_cents), 0) AS amount_cents FROM costs",
    ).amount_cents,
  };
}

function reconciliationState(db) {
  const tables = [
    "ventures",
    "venture_cases",
    "commands",
    "workflows",
    "opportunity_rounds",
    "opportunities",
    "commercial_briefs",
    "commercial_experiments",
    "commercial_test_candidates",
    "catalogue_plans",
    "pantheon_journeys",
    "venture_scorecards",
    "deliverables",
    "monitor_findings",
    "costs",
    "events",
  ];
  return Object.fromEntries(tables.map((tableName) => [
    tableName,
    all(db, `SELECT * FROM ${tableName} ORDER BY id`),
  ]));
}

test("a fresh database has no reconciliation target and receives no receipt", () => {
  const runtime = makeRuntime("fresh-database");
  try {
    assert.equal(hasCanonicalHistoricalTargets(runtime.db), false);
    const result = reconcileCanonicalHistoricalTruth(runtime.db, {
      reconciledAt: FIRST_RECONCILIATION_AT,
    });
    assert.equal(result.status, "no_matching_history");
    assert.equal(result.changeCount, 0);
    assert.equal(result.receiptId, null);
    assert.equal(
      get(
        runtime.db,
        "SELECT COUNT(*) AS count FROM events WHERE type = ? AND entity_id = ?",
        [RECEIPT_EVENT_TYPE, RECEIPT_ENTITY_ID],
      ).count,
      0,
    );
  } finally {
    closeRuntime(runtime);
  }
});

test("schema 26 migration applies canonical reconciliation before the database is accepted", () => {
  const runtime = makeRuntime("migration-integration");
  try {
    seedCanonicalStaleHistory(runtime.db);
    run(runtime.db, "DELETE FROM schema_migrations WHERE version = 26");
    runtime.db.close();
    runtime.db = null;

    runtime.db = openDatabase(runtime.dbPath);

    assert.equal(
      get(
        runtime.db,
        "SELECT name FROM schema_migrations WHERE version = 26",
      ).name,
      "canonical-commercial-truth-reconciliation",
    );
    assert.equal(
      get(
        runtime.db,
        "SELECT status FROM catalogue_plans WHERE id = ?",
        [IDS.buyerIntent.plan],
      ).status,
      "stopped_permanently",
    );
    assert.equal(
      get(
        runtime.db,
        `SELECT COUNT(*) AS count FROM events
         WHERE type = ? AND entity_type = 'runtime' AND entity_id = ?`,
        [RECEIPT_EVENT_TYPE, RECEIPT_ENTITY_ID],
      ).count,
      1,
    );
  } finally {
    closeRuntime(runtime);
  }
});

test("canonical reconciliation closes only the audited history and is stable when repeated", () => {
  const runtime = makeRuntime("repeat-safe");
  try {
    seedCanonicalStaleHistory(runtime.db);
    const immutableBefore = immutableProof(runtime.db);
    const unrelatedBefore = {
      workflow: get(runtime.db, "SELECT * FROM workflows WHERE id = ?", [UNRELATED_WORKFLOW_ID]),
      command: get(runtime.db, "SELECT * FROM commands WHERE id = ?", [UNRELATED_COMMAND_ID]),
      opportunity: get(runtime.db, "SELECT * FROM opportunities WHERE id = ?", [UNRELATED_OPPORTUNITY_ID]),
      plan: get(runtime.db, "SELECT * FROM catalogue_plans WHERE id = ?", [UNRELATED_PLAN_ID]),
    };

    const first = reconcileCanonicalHistoricalTruth(runtime.db, {
      reconciledAt: FIRST_RECONCILIATION_AT,
    });
    assert.equal(first.status, "reconciled");
    assert.ok(first.changeCount > 0);
    assert.equal(first.noProviderCall, true);
    assert.equal(first.noExternalAction, true);

    const venture = get(runtime.db, "SELECT * FROM ventures WHERE id = ?", [VENTURE_ID]);
    assert.equal(venture.status, "candidate");
    assert.equal(venture.lifecycle_stage, "candidate");
    assert.equal(venture.is_active, 1);
    assert.equal(fromJson(venture.metadata).operatingAuthority, "none");
    assert.equal(fromJson(venture.metadata).selectedWorkspaceOnly, true);

    assert.equal(
      get(runtime.db, "SELECT status FROM commands WHERE id = ?", [IDS.jobSearch.command]).status,
      "completed",
    );
    assert.equal(
      get(runtime.db, "SELECT status FROM workflows WHERE id = ?", [IDS.jobSearch.workflow]).status,
      "archived",
    );
    assert.equal(
      get(runtime.db, "SELECT status FROM opportunity_rounds WHERE id = ?", [IDS.jobSearch.round]).status,
      "completed",
    );
    assert.equal(
      get(runtime.db, "SELECT status FROM catalogue_plans WHERE id = ?", [IDS.jobSearch.plan]).status,
      "archived",
    );
    IDS.noInvestment.forEach((item) => {
      assert.equal(
        get(runtime.db, "SELECT status FROM commands WHERE id = ?", [item.command]).status,
        "completed",
      );
      assert.equal(
        get(runtime.db, "SELECT status FROM workflows WHERE id = ?", [item.workflow]).status,
        "completed",
      );
    });
    IDS.technicalFailures.forEach((item) => {
      assert.equal(
        get(runtime.db, "SELECT status FROM commands WHERE id = ?", [item.command]).status,
        "failed",
      );
      assert.equal(
        get(runtime.db, "SELECT status FROM workflows WHERE id = ?", [item.workflow]).status,
        "failed",
      );
    });

    const buyerWorkflow = get(
      runtime.db,
      "SELECT * FROM workflows WHERE id = ?",
      [IDS.buyerIntent.workflow],
    );
    const buyerPlan = get(
      runtime.db,
      "SELECT * FROM catalogue_plans WHERE id = ?",
      [IDS.buyerIntent.plan],
    );
    const buyerExperiment = get(
      runtime.db,
      "SELECT * FROM commercial_experiments WHERE id = ?",
      [IDS.buyerIntent.experiment],
    );
    assert.equal(buyerWorkflow.status, "cancelled");
    assert.equal(buyerPlan.status, "stopped_permanently");
    assert.equal(buyerExperiment.status, "cancelled");
    assert.equal(fromJson(buyerPlan.metadata).archivedFromOperator, false);
    assert.equal(fromJson(buyerPlan.metadata).terminalAt, FIRST_RECONCILIATION_AT);
    assert.equal(fromJson(buyerExperiment.metadata).terminalAt, FIRST_RECONCILIATION_AT);
    assert.equal(
      get(runtime.db, "SELECT COUNT(*) AS count FROM commercial_experiments WHERE id = ?", [IDS.buyerIntent.experiment]).count,
      1,
    );
    assert.equal(
      get(runtime.db, "SELECT COUNT(*) AS count FROM catalogue_plans WHERE id = ?", [IDS.buyerIntent.plan]).count,
      1,
    );

    IDS.terminalFindings.forEach((id) => {
      const finding = get(runtime.db, "SELECT * FROM monitor_findings WHERE id = ?", [id]);
      assert.equal(finding.status, "resolved");
      assert.equal(finding.resolved_at, FIRST_RECONCILIATION_AT);
      assert.equal(
        fromJson(finding.metadata).resolutionKind,
        "terminal_build_stopped_unfixed",
      );
      assert.equal(fromJson(finding.metadata).findingRemainsHistoricallyTrue, true);
    });

    const releasedCost = get(runtime.db, "SELECT * FROM costs WHERE id = ?", [IDS.releasedCost]);
    assert.equal(releasedCost.status, "released");
    assert.equal(releasedCost.amount_cents, 0);
    assert.equal(releasedCost.task_id, BUYER_TASK_ID);
    assert.equal(fromJson(releasedCost.metadata).noSpendOccurred, true);

    assert.deepEqual(immutableProof(runtime.db), immutableBefore);
    assert.deepEqual(
      {
        workflow: get(runtime.db, "SELECT * FROM workflows WHERE id = ?", [UNRELATED_WORKFLOW_ID]),
        command: get(runtime.db, "SELECT * FROM commands WHERE id = ?", [UNRELATED_COMMAND_ID]),
        opportunity: get(runtime.db, "SELECT * FROM opportunities WHERE id = ?", [UNRELATED_OPPORTUNITY_ID]),
        plan: get(runtime.db, "SELECT * FROM catalogue_plans WHERE id = ?", [UNRELATED_PLAN_ID]),
      },
      unrelatedBefore,
    );

    const receiptRows = all(
      runtime.db,
      `SELECT * FROM events
       WHERE type = ? AND entity_type = 'runtime' AND entity_id = ?`,
      [RECEIPT_EVENT_TYPE, RECEIPT_ENTITY_ID],
    );
    assert.equal(receiptRows.length, 1);
    const receiptMetadata = fromJson(receiptRows[0].metadata);
    assert.equal(receiptMetadata.noProviderCall, true);
    assert.equal(receiptMetadata.noExternalAction, true);
    assert.equal(receiptMetadata.immutableEvidencePreserved, true);
    assert.equal(receiptMetadata.operatingAuthority, "none");

    const buyerTerminal = getCanonicalTerminalView(runtime.db, {
      planId: IDS.buyerIntent.plan,
    });
    assert.equal(buyerTerminal.terminal, true);
    assert.equal(buyerTerminal.historical, true);
    assert.equal(buyerTerminal.actionable, false);
    assert.equal(
      getCanonicalTerminalView(runtime.db, {
        deliverableId: IDS.reviewDeliverables[0],
      }).terminal,
      true,
    );
    assert.equal(
      getCanonicalTerminalView(runtime.db, {
        findingId: IDS.terminalFindings[0],
      }).terminal,
      true,
    );
    assert.equal(
      getCanonicalTerminalView(runtime.db, {
        planId: GENERIC_TERMINAL_PLAN_ID,
      }).terminal,
      true,
    );
    assert.equal(
      getCanonicalTerminalView(runtime.db, {
        planId: UNRELATED_PLAN_ID,
      }).terminal,
      false,
    );

    const afterFirst = reconciliationState(runtime.db);
    const second = reconcileCanonicalHistoricalTruth(runtime.db, {
      reconciledAt: SECOND_RECONCILIATION_AT,
    });
    assert.equal(second.status, "already_reconciled");
    assert.equal(second.changeCount, 0);
    assert.deepEqual(reconciliationState(runtime.db), afterFirst);
    assert.equal(
      get(
        runtime.db,
        `SELECT COUNT(*) AS count FROM events
         WHERE type = ? AND entity_type = 'runtime' AND entity_id = ?`,
        [RECEIPT_EVENT_TYPE, RECEIPT_ENTITY_ID],
      ).count,
      1,
    );
  } finally {
    closeRuntime(runtime);
  }
});

test("verified buyer results block reconciliation before any row changes", () => {
  const runtime = makeRuntime("verified-result-guard");
  try {
    seedCanonicalStaleHistory(runtime.db);
    run(
      runtime.db,
      `INSERT INTO commercial_results
       (id, experiment_id, workflow_id, source, status, views, clicks, leads,
        sales, refunds, revenue_cents, spend_cents, time_spent_minutes, notes,
        occurred_at, metadata, created_at, venture_id, verified, currency,
        verified_at)
       VALUES ('result_verified_buyer_guard', ?, ?, 'marketplace_receipt',
               'verified', 10, 2, 1, 1, 0, 2900, 0, 5,
               'A verified result must be handled explicitly', ?, '{}', ?, ?,
               1, 'AUD', ?)`,
      [
        IDS.buyerIntent.experiment,
        IDS.buyerIntent.workflow,
        FIXTURE_AT,
        FIXTURE_AT,
        VENTURE_ID,
        FIXTURE_AT,
      ],
    );
    const before = reconciliationState(runtime.db);

    let error;
    assert.throws(
      () => reconcileCanonicalHistoricalTruth(runtime.db, {
        reconciledAt: FIRST_RECONCILIATION_AT,
      }),
      (caught) => {
        error = caught;
        return caught instanceof CommercialTruthReconciliationBlockedError;
      },
    );
    assert.equal(error.code, "commercial_truth_reconciliation_blocked");
    assert.equal(error.details.verifiedResults.length, 1);
    assert.deepEqual(reconciliationState(runtime.db), before);
    assert.equal(
      get(
        runtime.db,
        "SELECT COUNT(*) AS count FROM events WHERE type = ? AND entity_id = ?",
        [RECEIPT_EVENT_TYPE, RECEIPT_ENTITY_ID],
      ).count,
      0,
    );
  } finally {
    closeRuntime(runtime);
  }
});

test("an unknown provider outcome blocks reconciliation before any row changes", () => {
  const runtime = makeRuntime("provider-outcome-guard");
  try {
    seedCanonicalStaleHistory(runtime.db);
    run(
      runtime.db,
      "UPDATE model_calls SET outcome_status = 'unknown' WHERE id = 'model_call_historical_proof'",
    );
    const before = reconciliationState(runtime.db);

    let error;
    assert.throws(
      () => reconcileCanonicalHistoricalTruth(runtime.db, {
        reconciledAt: FIRST_RECONCILIATION_AT,
      }),
      (caught) => {
        error = caught;
        return caught instanceof CommercialTruthReconciliationBlockedError;
      },
    );
    assert.equal(error.code, "commercial_truth_reconciliation_blocked");
    assert.equal(error.details.unknownModelCalls.length, 1);
    assert.deepEqual(reconciliationState(runtime.db), before);
    assert.equal(
      get(
        runtime.db,
        "SELECT COUNT(*) AS count FROM events WHERE type = ? AND entity_id = ?",
        [RECEIPT_EVENT_TYPE, RECEIPT_ENTITY_ID],
      ).count,
      0,
    );
  } finally {
    closeRuntime(runtime);
  }
});
