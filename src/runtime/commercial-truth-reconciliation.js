const {
  all,
  fromJson,
  get,
  insertEvent,
  now,
  run,
  toJson,
} = require("../db");

const RECONCILIATION_ID = "canonical-commercial-history-2026-07-29-v1";
const RECONCILIATION_SCHEMA = "pantheon.commercial-truth-reconciliation.v1";
const RECEIPT_EVENT_TYPE = "commercial_truth.canonical_history_reconciled";
const RECEIPT_ENTITY_ID = RECONCILIATION_ID;

const IDS = Object.freeze({
  venture: "venture-digital-products",
  ventureCase: "case_venture-digital-products",
  jobSearch: Object.freeze({
    command: "cmd_commercial_discovery_4308d9dc-71c4-4ae7-9a64-80ad29203b91",
    workflow: "wf_commercial_discovery_cf6e42af-8b5c-4792-a867-fc60ed314006",
    round: "opp_round_8b75c88c-d8c4-4412-b604-03cbf43afec0",
    opportunity: "opp_opp-round-8b75c88c-d8c4-_1_job-search-evidence-trac",
    candidate: "candidate_opp-opp-round-8b75c88c-d8c4-1-job-search",
    experiment: "exp_job-search-evidence-tracker-and-in_9376c680",
    plan: "catalogue_opp-opp-round-8b75c88c-d8c4-1-job-search",
    journey: "journey_production_6ef82f74-b8be-4052-880e-1f5cb3628e8b",
    brief: "brief_opp-opp-round-8b75c88c-d8c4-1-job-search-evi",
    scorecard: "score_wf_commercial_discovery_cf6e42af-8b5c-4792-a867-fc60ed314006",
  }),
  technicalFailures: Object.freeze([
    Object.freeze({
      command: "cmd_commercial_discovery_8c350cdc-256c-49b9-8f20-ff8ef642d0dc",
      workflow: "wf_commercial_discovery_2ff7bb56-a553-46b9-830d-0ec1dcdfacf1",
    }),
    Object.freeze({
      command: "cmd_commercial_discovery_a0dced17-2d7c-417c-93ee-a06042396117",
      workflow: "wf_commercial_discovery_93d95b8b-e8dd-4925-90a4-6bf4e1c8085e",
    }),
  ]),
  noInvestment: Object.freeze([
    Object.freeze({
      command: "cmd_commercial_discovery_0797e6c4-5bda-4483-8d30-4a6d514e5013",
      workflow: "wf_commercial_discovery_7232142a-ca32-4ce9-828d-6e00a5f9f9ec",
    }),
    Object.freeze({
      command: "cmd_commercial_discovery_2c8e5b60-7055-4126-8f35-d27a0bb8eb74",
      workflow: "wf_commercial_discovery_34b23075-d9df-4478-874e-0d3352dfb0b0",
    }),
    Object.freeze({
      command: "cmd_commercial_discovery_caa86880-0e74-46ad-87bf-cbdf11d00e11",
      workflow: "wf_commercial_discovery_ee2356a3-0dc1-4e21-a956-bf574f70d19f",
    }),
  ]),
  buyerIntent: Object.freeze({
    workflow: "wf_buyer_intent_social_media_manager_client_control_v1",
    opportunity: "opp_targeted_027363dc-2ff6-4df7-89ef-ec073dc1b3d3",
    candidate: "test_buyer_intent_social_media_manager_client_control_v1",
    experiment: "exp_buyer_intent_social_media_manager_client_control_v1",
    plan: "catalogue_validation_social_media_manager_client_control_v1",
    brief: "brief_buyer_intent_social_media_manager_client_control_v1",
  }),
  parkedAlternatives: Object.freeze([
    "opp_opp-round-8b75c88c-d8c4-_2_freelancer-scope-control",
    "opp_opp-round-8b75c88c-d8c4-_3_low-overwhelm-executive-",
  ]),
  reviewDeliverables: Object.freeze([
    "deliv_pdf_wf-commercial-discovery-cf6e42af-8b5c-4792",
    "deliv_job-search-evidence-tracker-and-interview-learning-sys-ready-to-_wf_commercial_discovery_",
    "deliv_job-search-evidence-tracker-and-interview-learning-sys-launch-pa_wf_commercial_discovery_",
    "deliv_job-search-evidence-tracker-and-interview-learning-sys-listing-c_wf_commercial_discovery_",
  ]),
  terminalFindings: Object.freeze([
    "finding_3727dc21-055c-404a-8353-cf250bf4ec87",
    "finding_df9a31a5-f952-467d-bcbd-a900e45c4aa9",
    "finding_a7df6438-033e-4089-9a5d-44ec5b321041",
    "finding_b79691b1-75e1-4dad-b24b-dc332897aa5d",
    "finding_0fd60c50-efb1-4c6f-a86c-c3a35419525e",
    "finding_6b0d4bd7-64f0-4fd1-b33a-cedb968bd633",
  ]),
  releasedCost:
    "cost_spend_task_live_worker_wf_buyer_intent_social_media_manager_client_control_v1_cat_579014de2c57",
});

const TERMINAL_BUILD_STATUSES = new Set([
  "inspection_evidence_recheck_failed_terminal",
  "inspection_evidence_recheck_declined_terminal",
]);

const HISTORICAL_WORKFLOW_IDS = new Set([
  IDS.jobSearch.workflow,
  IDS.buyerIntent.workflow,
  ...IDS.noInvestment.map((item) => item.workflow),
  ...IDS.technicalFailures.map((item) => item.workflow),
]);

const HISTORICAL_PLAN_IDS = new Set([
  IDS.jobSearch.plan,
  IDS.buyerIntent.plan,
]);

const HISTORICAL_OPPORTUNITY_IDS = new Set([
  IDS.jobSearch.opportunity,
  IDS.buyerIntent.opportunity,
  ...IDS.parkedAlternatives,
]);

const HISTORICAL_EXPERIMENT_IDS = new Set([
  IDS.jobSearch.experiment,
  IDS.buyerIntent.experiment,
]);

class CommercialTruthReconciliationBlockedError extends Error {
  constructor(message, details) {
    super(message);
    this.name = "CommercialTruthReconciliationBlockedError";
    this.code = "commercial_truth_reconciliation_blocked";
    this.details = details;
  }
}

function withSavepoint(db, operation) {
  const savepoint = "canonical_commercial_truth_reconciliation";
  db.exec(`SAVEPOINT ${savepoint}`);
  try {
    const result = operation();
    db.exec(`RELEASE SAVEPOINT ${savepoint}`);
    return result;
  } catch (error) {
    db.exec(`ROLLBACK TO SAVEPOINT ${savepoint}`);
    db.exec(`RELEASE SAVEPOINT ${savepoint}`);
    throw error;
  }
}

function placeholders(values) {
  return values.map(() => "?").join(", ");
}

function reconciliationMetadata(existing, {
  reason,
  terminal = true,
  historical = true,
  actionable = false,
  reconciledAt,
  extra = {},
} = {}) {
  const current = existing?.commercialTruth && typeof existing.commercialTruth === "object"
    ? existing.commercialTruth
    : {};
  const stableExtra = { ...extra };
  if (existing?.terminalAt && stableExtra.terminalAt) {
    stableExtra.terminalAt = existing.terminalAt;
  }
  return {
    ...existing,
    ...stableExtra,
    commercialTruth: {
      ...current,
      schema: RECONCILIATION_SCHEMA,
      reconciliationId: RECONCILIATION_ID,
      historical,
      terminal,
      actionable,
      reason,
      reconciledAt: current.reconciledAt || reconciledAt,
      noProviderCall: true,
      noExternalAction: true,
    },
  };
}

function comparable(value) {
  if (value === undefined) return null;
  return value;
}

function updateRecord(db, changes, {
  table,
  id,
  fields = {},
  reason,
  terminal = true,
  historical = true,
  actionable = false,
  metadataExtra = {},
  preserveExistingFields = [],
  reconciledAt,
  updatedAtColumn = "updated_at",
}) {
  const row = get(db, `SELECT * FROM ${table} WHERE id = ?`, [id]);
  if (!row) return false;

  const nextFields = Object.fromEntries(Object.entries(fields).map(([field, value]) => [
    field,
    preserveExistingFields.includes(field) && row[field] != null ? row[field] : value,
  ]));
  if (Object.prototype.hasOwnProperty.call(row, "metadata")) {
    nextFields.metadata = toJson(reconciliationMetadata(
      fromJson(row.metadata, {}),
      {
        reason,
        terminal,
        historical,
        actionable,
        reconciledAt,
        extra: metadataExtra,
      },
    ));
  }

  const changedFields = Object.entries(nextFields).filter(([field, value]) => (
    comparable(row[field]) !== comparable(value)
  ));
  if (!changedFields.length) return false;

  const prior = Object.fromEntries(changedFields.map(([field]) => [
    field,
    field === "metadata" ? undefined : row[field],
  ]).filter(([, value]) => value !== undefined));
  const next = Object.fromEntries(changedFields.map(([field, value]) => [
    field,
    field === "metadata" ? undefined : value,
  ]).filter(([, value]) => value !== undefined));
  const assignments = changedFields.map(([field]) => `${field} = ?`);
  const values = changedFields.map(([, value]) => value);
  if (updatedAtColumn && Object.prototype.hasOwnProperty.call(row, updatedAtColumn)) {
    assignments.push(`${updatedAtColumn} = ?`);
    values.push(reconciledAt);
  }
  values.push(id);
  run(
    db,
    `UPDATE ${table} SET ${assignments.join(", ")} WHERE id = ?`,
    values,
  );
  changes.push({ table, id, prior, next, reason });
  return true;
}

function reconciliationBlockers(db) {
  const experimentIds = [...HISTORICAL_EXPERIMENT_IDS];
  const workflowIds = [...HISTORICAL_WORKFLOW_IDS];
  const verifiedResults = all(
    db,
    `SELECT id, experiment_id, status, sales, revenue_cents, verified
     FROM commercial_results
     WHERE experiment_id IN (${placeholders(experimentIds)})
       AND verified = 1
     ORDER BY id`,
    experimentIds,
  );
  const unknownTasks = all(
    db,
    `SELECT id, workflow_id, status, outcome_status
     FROM tasks
     WHERE workflow_id IN (${placeholders(workflowIds)})
       AND outcome_status = 'unknown'
     ORDER BY id`,
    workflowIds,
  );
  const unknownAttempts = all(
    db,
    `SELECT attempts.id, attempts.task_id, tasks.workflow_id, attempts.status,
            attempts.outcome_status
     FROM task_attempts AS attempts
     JOIN tasks ON tasks.id = attempts.task_id
     WHERE tasks.workflow_id IN (${placeholders(workflowIds)})
       AND attempts.outcome_status = 'unknown'
     ORDER BY attempts.id`,
    workflowIds,
  );
  const unknownModelCalls = all(
    db,
    `SELECT id, task_id, workflow_id, status, outcome_status
     FROM model_calls
     WHERE workflow_id IN (${placeholders(workflowIds)})
       AND outcome_status = 'unknown'
     ORDER BY id`,
    workflowIds,
  );
  const unknownCosts = all(
    db,
    `SELECT id, task_id, workflow_id, status, amount_cents
     FROM costs
     WHERE workflow_id IN (${placeholders(workflowIds)})
       AND status = 'unknown'
     ORDER BY id`,
    workflowIds,
  );
  const unknownReservations = all(
    db,
    `SELECT id, task_id, workflow_id, status, amount_cents
     FROM budget_reservations
     WHERE workflow_id IN (${placeholders(workflowIds)})
       AND status = 'unknown'
     ORDER BY id`,
    workflowIds,
  );
  return {
    verifiedResults,
    unknownTasks,
    unknownAttempts,
    unknownModelCalls,
    unknownCosts,
    unknownReservations,
  };
}

function assertReconciliationSafe(db) {
  const blockers = reconciliationBlockers(db);
  const blockerCount = Object.values(blockers).reduce((sum, rows) => sum + rows.length, 0);
  if (blockerCount) {
    throw new CommercialTruthReconciliationBlockedError(
      "Canonical commercial history cannot be reconciled while verified buyer results or unknown provider outcomes exist.",
      blockers,
    );
  }
  return blockers;
}

function receipt(db) {
  return get(
    db,
    `SELECT * FROM events
     WHERE type = ? AND entity_type = 'runtime' AND entity_id = ?
     ORDER BY id LIMIT 1`,
    [RECEIPT_EVENT_TYPE, RECEIPT_ENTITY_ID],
  );
}

function hasCanonicalHistoricalTargets(db) {
  const checks = [
    ["commands", [
      IDS.jobSearch.command,
      ...IDS.technicalFailures.map((item) => item.command),
      ...IDS.noInvestment.map((item) => item.command),
    ]],
    ["workflows", [...HISTORICAL_WORKFLOW_IDS]],
    ["opportunity_rounds", [IDS.jobSearch.round]],
    ["opportunities", [...HISTORICAL_OPPORTUNITY_IDS]],
    ["commercial_test_candidates", [
      IDS.jobSearch.candidate,
      IDS.buyerIntent.candidate,
    ]],
    ["commercial_experiments", [...HISTORICAL_EXPERIMENT_IDS]],
    ["catalogue_plans", [...HISTORICAL_PLAN_IDS]],
    ["pantheon_journeys", [IDS.jobSearch.journey]],
    ["commercial_briefs", [IDS.jobSearch.brief, IDS.buyerIntent.brief]],
    ["venture_scorecards", [IDS.jobSearch.scorecard]],
    ["deliverables", [...IDS.reviewDeliverables]],
    ["monitor_findings", [...IDS.terminalFindings]],
    ["costs", [IDS.releasedCost]],
  ];
  return checks.some(([table, ids]) => get(
    db,
    `SELECT 1 AS present FROM ${table}
     WHERE id IN (${placeholders(ids)}) LIMIT 1`,
    ids,
  )?.present === 1);
}

function recordReceipt(db, changes, reconciledAt) {
  const existing = receipt(db);
  if (existing) return existing;
  insertEvent(db, {
    ts: reconciledAt,
    level: "info",
    actor: "jarvis",
    type: RECEIPT_EVENT_TYPE,
    entityType: "runtime",
    entityId: RECEIPT_ENTITY_ID,
    message: "Pantheon reconciled retained commercial history without provider, customer, publishing, or spend activity.",
    metadata: {
      schema: RECONCILIATION_SCHEMA,
      reconciliationId: RECONCILIATION_ID,
      reconciledAt,
      changeCount: changes.length,
      changes,
      operatingAuthority: "none",
      selectedWorkspaceVentureId: IDS.venture,
      noProviderCall: true,
      noExternalAction: true,
      immutableEvidencePreserved: true,
      accountingPreservedExceptZeroValueRelease: true,
    },
  });
  return receipt(db);
}

function applyCanonicalUpdates(db, reconciledAt) {
  const changes = [];
  const update = (input) => updateRecord(db, changes, { ...input, reconciledAt });

  update({
    table: "ventures",
    id: IDS.venture,
    fields: {
      status: "candidate",
      lifecycle_stage: "candidate",
      is_active: 1,
      summary: "Selected workspace with no active commercial program or authority to build, publish, contact buyers, or spend.",
    },
    reason: "no_active_commercial_program",
    terminal: false,
    historical: false,
    metadataExtra: {
      currentPilot: null,
      operatingAuthority: "none",
      commercialProgramActive: false,
      selectedWorkspaceOnly: true,
    },
  });
  update({
    table: "venture_cases",
    id: IDS.ventureCase,
    fields: {
      active_experiment_id: null,
      operator_decision: "No active commercial program or external-test authority.",
      latest_learning: "Portfolio diligence selected no investment, and the retained buyer-intent build stopped permanently at its quality boundary.",
      next_money_move: "Evaluate the separate Social Media Manager Client Approval & Scope Guard Kit in the Portfolio workspace; production and external testing require a new evidence-bound decision.",
      kill_rule: "No active commercial test. Define a venture-specific stop rule only after a separate candidate is approved.",
    },
    reason: "no_active_commercial_program",
    terminal: false,
    historical: false,
    metadataExtra: {
      oneActiveVenture: false,
      oneActiveOperatingVenture: false,
      operatingAuthority: "none",
      selectedWorkspaceOnly: true,
    },
  });

  update({
    table: "commands",
    id: IDS.jobSearch.command,
    fields: {
      status: "completed",
      summary: "Historical commercial discovery completed; the built Job Search package is parked and not authorised for publication.",
    },
    reason: "historical_job_search_package_parked",
    metadataExtra: { archivedFromOperator: true, commercialOutcome: "parked_without_market_test" },
  });
  update({
    table: "workflows",
    id: IDS.jobSearch.workflow,
    fields: {
      status: "archived",
      current_step: "Historical Job Search package parked; no build, publication, or buyer-test decision is active.",
      approval_required: 0,
    },
    reason: "historical_job_search_package_parked",
    metadataExtra: { archivedFromOperator: true, commercialOutcome: "parked_without_market_test" },
  });
  update({
    table: "opportunity_rounds",
    id: IDS.jobSearch.round,
    fields: { status: "completed" },
    reason: "historical_job_search_package_parked",
    metadataExtra: { archivedFromOperator: true, outcome: "parked_without_market_test" },
  });
  update({
    table: "commercial_test_candidates",
    id: IDS.jobSearch.candidate,
    fields: {
      status: "cancelled",
      promoted_experiment_id: IDS.jobSearch.experiment,
    },
    reason: "historical_job_search_test_cancelled",
    metadataExtra: { archivedFromOperator: true },
  });
  update({
    table: "commercial_experiments",
    id: IDS.jobSearch.experiment,
    fields: { status: "cancelled" },
    reason: "historical_job_search_test_cancelled",
    metadataExtra: { archivedFromOperator: true },
  });
  update({
    table: "catalogue_plans",
    id: IDS.jobSearch.plan,
    fields: { status: "archived" },
    reason: "historical_job_search_package_parked",
    metadataExtra: {
      archivedFromOperator: true,
      buildStatus: "historical_parked",
      publishingStatus: "not_published",
    },
  });
  update({
    table: "pantheon_journeys",
    id: IDS.jobSearch.journey,
    fields: { status: "completed" },
    reason: "historical_job_search_package_parked",
    metadataExtra: {
      archivedFromOperator: true,
      commercialOutcome: "parked_without_market_test",
    },
  });
  update({
    table: "commercial_briefs",
    id: IDS.jobSearch.brief,
    fields: { status: "archived" },
    reason: "historical_job_search_package_parked",
    metadataExtra: { archivedFromOperator: true },
  });
  update({
    table: "venture_scorecards",
    id: IDS.jobSearch.scorecard,
    fields: { status: "archived" },
    reason: "historical_job_search_package_parked",
    metadataExtra: { archivedFromOperator: true },
  });

  for (const item of IDS.technicalFailures) {
    update({
      table: "commands",
      id: item.command,
      fields: { status: "failed" },
      reason: "historical_technical_failure",
      metadataExtra: { archivedFromOperator: true },
    });
    update({
      table: "workflows",
      id: item.workflow,
      fields: { status: "failed", approval_required: 0 },
      reason: "historical_technical_failure",
      metadataExtra: { archivedFromOperator: true },
    });
  }

  for (const item of IDS.noInvestment) {
    update({
      table: "commands",
      id: item.command,
      fields: {
        status: "completed",
        summary: "Historical commercial diligence completed with no investment selected.",
      },
      reason: "historical_no_investment",
      metadataExtra: { archivedFromOperator: true, commercialOutcome: "no_investment" },
    });
    update({
      table: "workflows",
      id: item.workflow,
      fields: {
        status: "completed",
        current_step: "No investment selected; retained as historical commercial diligence.",
        approval_required: 0,
      },
      reason: "historical_no_investment",
      metadataExtra: { archivedFromOperator: true, commercialOutcome: "no_investment" },
    });
  }

  for (const opportunityId of IDS.parkedAlternatives) {
    update({
      table: "opportunities",
      id: opportunityId,
      fields: { status: "parked" },
      reason: "historical_alternative_not_selected",
      metadataExtra: { archivedFromOperator: true },
    });
  }
  update({
    table: "opportunities",
    id: IDS.buyerIntent.opportunity,
    fields: { status: "parked" },
    reason: "buyer_intent_quality_recheck_failed_terminal",
    metadataExtra: { archivedFromOperator: true },
  });
  update({
    table: "commercial_test_candidates",
    id: IDS.buyerIntent.candidate,
    fields: { status: "cancelled" },
    reason: "buyer_intent_quality_recheck_failed_terminal",
    metadataExtra: { archivedFromOperator: true },
  });
  update({
    table: "commercial_experiments",
    id: IDS.buyerIntent.experiment,
    fields: { status: "cancelled" },
    reason: "buyer_intent_quality_recheck_failed_terminal",
    metadataExtra: {
      terminalAt: reconciledAt,
      terminalReason: "inspection_evidence_recheck_failed_terminal",
    },
  });
  update({
    table: "catalogue_plans",
    id: IDS.buyerIntent.plan,
    fields: { status: "stopped_permanently" },
    reason: "buyer_intent_quality_recheck_failed_terminal",
    metadataExtra: {
      buildStatus: "inspection_evidence_recheck_failed_terminal",
      terminalAt: reconciledAt,
      terminalReason: "inspection_evidence_recheck_failed_terminal",
      archivedFromOperator: false,
    },
  });
  update({
    table: "workflows",
    id: IDS.buyerIntent.workflow,
    fields: {
      status: "cancelled",
      current_step: "Permanently stopped after the single inspection-evidence recheck did not pass.",
      approval_required: 0,
    },
    reason: "buyer_intent_quality_recheck_failed_terminal",
    metadataExtra: {
      archivedFromOperator: true,
      terminalAt: reconciledAt,
      terminalReason: "inspection_evidence_recheck_failed_terminal",
    },
  });
  update({
    table: "commercial_briefs",
    id: IDS.buyerIntent.brief,
    fields: { status: "archived" },
    reason: "buyer_intent_quality_recheck_failed_terminal",
    metadataExtra: { archivedFromOperator: true },
  });

  for (const deliverableId of IDS.reviewDeliverables) {
    update({
      table: "deliverables",
      id: deliverableId,
      fields: { status: "archived" },
      reason: "historical_job_search_review_closed",
      metadataExtra: { archivedFromOperator: true },
    });
  }

  for (const findingId of IDS.terminalFindings) {
    update({
      table: "monitor_findings",
      id: findingId,
      fields: {
        status: "resolved",
        resolved_at: reconciledAt,
      },
      reason: "terminal_build_stopped_unfixed",
      metadataExtra: {
        resolutionKind: "terminal_build_stopped_unfixed",
        findingRemainsHistoricallyTrue: true,
      },
      preserveExistingFields: ["resolved_at"],
      updatedAtColumn: null,
    });
  }

  const cost = get(db, "SELECT * FROM costs WHERE id = ?", [IDS.releasedCost]);
  if (cost) {
    const costMetadata = fromJson(cost.metadata, {});
    update({
      table: "costs",
      id: IDS.releasedCost,
      fields: {
        status: "released",
        amount_cents: 0,
        task_id: cost.task_id || costMetadata.taskId || null,
      },
      reason: "superseded_approval_no_provider_spend",
      metadataExtra: {
        noSpendOccurred: true,
        releaseReason: "The exact approval was superseded before provider dispatch.",
      },
      updatedAtColumn: null,
    });
  }

  return changes;
}

function reconcileCanonicalHistoricalTruth(db, options = {}) {
  const reconciledAt = options.reconciledAt || now();
  if (!hasCanonicalHistoricalTargets(db)) {
    return {
      status: "no_matching_history",
      reconciliationId: RECONCILIATION_ID,
      reconciledAt,
      changeCount: 0,
      changes: [],
      receiptId: null,
      noProviderCall: true,
      noExternalAction: true,
      immutableEvidencePreserved: true,
    };
  }
  assertReconciliationSafe(db);
  return withSavepoint(db, () => {
    const existingReceipt = receipt(db);
    const changes = applyCanonicalUpdates(db, reconciledAt);
    const persistedReceipt = recordReceipt(db, changes, reconciledAt);
    return {
      status: changes.length
        ? "reconciled"
        : existingReceipt ? "already_reconciled" : "receipt_recorded",
      reconciliationId: RECONCILIATION_ID,
      reconciledAt,
      changeCount: changes.length,
      changes,
      receiptId: persistedReceipt?.id || null,
      noProviderCall: true,
      noExternalAction: true,
      immutableEvidencePreserved: true,
    };
  });
}

function resolveViewBindings(db, input = {}) {
  let workflowId = input.workflowId || null;
  let planId = input.planId || null;
  let opportunityId = input.opportunityId || null;
  let experimentId = input.experimentId || null;

  if (!workflowId && input.taskId) {
    workflowId = get(db, "SELECT workflow_id FROM tasks WHERE id = ?", [input.taskId])?.workflow_id || null;
  }
  if (!workflowId && input.deliverableId) {
    workflowId = get(
      db,
      "SELECT workflow_id FROM deliverables WHERE id = ?",
      [input.deliverableId],
    )?.workflow_id || null;
  }
  if (input.findingId) {
    const finding = get(
      db,
      "SELECT entity_type, entity_id, metadata FROM monitor_findings WHERE id = ?",
      [input.findingId],
    );
    const metadata = fromJson(finding?.metadata, {});
    workflowId = workflowId || metadata.workflowId || null;
    if (!workflowId && finding?.entity_type === "deliverable") {
      workflowId = get(
        db,
        "SELECT workflow_id FROM deliverables WHERE id = ?",
        [finding.entity_id],
      )?.workflow_id || null;
    }
  }
  if (planId) {
    const plan = get(db, "SELECT opportunity_id, metadata FROM catalogue_plans WHERE id = ?", [planId]);
    const metadata = fromJson(plan?.metadata, {});
    workflowId = workflowId || metadata.validationSample?.workflowId || null;
    opportunityId = opportunityId || plan?.opportunity_id || null;
    experimentId = experimentId || metadata.validationSample?.experimentId || null;
  }
  if (!planId && workflowId) {
    const plan = get(
      db,
      `SELECT id, opportunity_id, metadata
       FROM catalogue_plans
       WHERE json_extract(metadata, '$.validationSample.workflowId') = ?
       ORDER BY updated_at DESC LIMIT 1`,
      [workflowId],
    );
    planId = plan?.id || null;
    opportunityId = opportunityId || plan?.opportunity_id || null;
    experimentId = experimentId
      || fromJson(plan?.metadata, {}).validationSample?.experimentId
      || null;
  }
  return { workflowId, planId, opportunityId, experimentId };
}

function getCanonicalTerminalView(db, input = {}) {
  const bindings = resolveViewBindings(db, input);
  const workflow = bindings.workflowId
    ? get(db, "SELECT status, metadata FROM workflows WHERE id = ?", [bindings.workflowId])
    : null;
  const plan = bindings.planId
    ? get(db, "SELECT status, metadata FROM catalogue_plans WHERE id = ?", [bindings.planId])
    : null;
  const workflowMetadata = fromJson(workflow?.metadata, {});
  const planMetadata = fromJson(plan?.metadata, {});
  const buildStatus = planMetadata.buildStatus || null;
  const canonicalTerminalMetadata = (metadata) => (
    metadata?.commercialTruth?.schema === RECONCILIATION_SCHEMA
    && metadata.commercialTruth.reconciliationId === RECONCILIATION_ID
    && metadata.commercialTruth.historical === true
    && metadata.commercialTruth.terminal === true
    && metadata.commercialTruth.actionable === false
  );
  const exactHistorical = HISTORICAL_WORKFLOW_IDS.has(bindings.workflowId)
    || HISTORICAL_PLAN_IDS.has(bindings.planId)
    || HISTORICAL_OPPORTUNITY_IDS.has(bindings.opportunityId)
    || HISTORICAL_EXPERIMENT_IDS.has(bindings.experimentId);
  const metadataTerminal = canonicalTerminalMetadata(workflowMetadata)
    || canonicalTerminalMetadata(planMetadata);
  const terminalBuild = TERMINAL_BUILD_STATUSES.has(buildStatus);
  const terminal = exactHistorical || metadataTerminal || terminalBuild;
  const reason = planMetadata.commercialTruth?.reason
    || workflowMetadata.commercialTruth?.reason
    || (terminalBuild ? buildStatus : null)
    || (exactHistorical ? "canonical_historical_record" : null);
  return {
    ...bindings,
    terminal,
    historical: terminal,
    actionable: !terminal,
    reason,
    workflowStatus: workflow?.status || null,
    planStatus: plan?.status || null,
    buildStatus,
    reconciliationId: terminal ? RECONCILIATION_ID : null,
  };
}

function isCanonicalTerminalView(db, input = {}) {
  return getCanonicalTerminalView(db, input).terminal;
}

module.exports = {
  CommercialTruthReconciliationBlockedError,
  IDS,
  RECEIPT_ENTITY_ID,
  RECEIPT_EVENT_TYPE,
  RECONCILIATION_ID,
  RECONCILIATION_SCHEMA,
  TERMINAL_BUILD_STATUSES,
  assertReconciliationSafe,
  getCanonicalTerminalView,
  hasCanonicalHistoricalTargets,
  isCanonicalTerminalView,
  reconcileCanonicalHistoricalTruth,
  reconciliationBlockers,
};
