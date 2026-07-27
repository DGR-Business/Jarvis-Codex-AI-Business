const CONFIG = require("../config");
const { all, fromJson, get, insertEvent, now, randomId, run, toJson } = require("../db");
const { journeyBudgetExposure } = require("./cost-ledger");
const { canPrepareReviewedRetry } = require("./live-ai-retry-policy");
const { preDispatchRecoveryStatus } = require("./live-ai-workers");
const { supersededRetryTaskIds } = require("./monitor");
const {
  combinedProofExposureFromDatabase,
  ensureProofExposureAtLeast,
  syncProofExposureFromDatabase,
} = require("./proof-exposure-ledger");

const ACTIVE_JOURNEY_STATUSES = new Set([
  "starting",
  "running",
  "waiting_for_operator",
  "needs_attention",
]);

const TERMINAL_JOURNEY_STATUSES = new Set([
  "completed",
  "cancelled",
  "stopped_after_correction",
  "stopped_unknown_outcome",
]);

const JOURNEY_STAGES = Object.freeze([
  "opportunity_scout",
  "demand_validation",
  "candidate_selection",
  "finance_analysis",
  "offer_architecture",
  "product_build",
  "storefront_visuals",
  "quality_review",
  "conversion_copy",
  "distribution_plan",
  "chief_brief",
  "launch_decision",
  "ready_to_publish",
]);

function parseJourney(row) {
  return row ? { ...row, metadata: fromJson(row.metadata, {}) } : null;
}

function taskCorrectionNumber(payload = {}) {
  const parameters = payload?.liveSpendRequest?.parameters || {};
  const stage = parameters.pantheonProduction?.stage || null;
  return stage === "product_build"
    ? Math.max(
      Number(parameters.retry?.number || 0),
      Number(parameters.pantheonProduction?.revisionNumber || 0),
    )
    : Number(parameters.retry?.number || 0);
}

function journeyById(db, journeyId) {
  return parseJourney(get(db, "SELECT * FROM pantheon_journeys WHERE id = ?", [journeyId]));
}

function journeyForRound(db, roundId) {
  return parseJourney(get(db, "SELECT * FROM pantheon_journeys WHERE round_id = ?", [roundId]));
}

function journeyForWorkflow(db, workflowId) {
  return parseJourney(get(db, "SELECT * FROM pantheon_journeys WHERE workflow_id = ?", [workflowId]));
}

function activeJourney(db) {
  const placeholders = [...ACTIVE_JOURNEY_STATUSES].map(() => "?").join(", ");
  return parseJourney(get(
    db,
    `SELECT * FROM pantheon_journeys
     WHERE status IN (${placeholders})
     ORDER BY created_at DESC LIMIT 1`,
    [...ACTIVE_JOURNEY_STATUSES],
  ));
}

function currentOperatorJourney(db) {
  return activeJourney(db)
    || parseJourney(get(
      db,
      "SELECT * FROM pantheon_journeys ORDER BY updated_at DESC, created_at DESC LIMIT 1",
    ));
}

function isTerminalJourneyStatus(status) {
  return TERMINAL_JOURNEY_STATUSES.has(String(status || ""));
}

function updateJourney(db, journeyId, patch = {}) {
  const journey = journeyById(db, journeyId);
  if (!journey) throw new Error(`Pantheon journey not found: ${journeyId}`);
  const nextStatus = patch.status || journey.status;
  const exactLocalRecovery = journey.status === "stopped_after_correction"
    && patch.allowTerminalRecovery === true
    && ["running", "waiting_for_operator", "needs_attention"].includes(nextStatus);
  const exactAuditRepair = journey.status === "completed"
    && patch.allowTerminalAuditRepair === true
    && ["running", "waiting_for_operator", "needs_attention"].includes(nextStatus)
    && ["quality_review", "conversion_copy", "distribution_plan", "chief_brief"].includes(
      String(patch.activeStage || ""),
    );
  if (
    isTerminalJourneyStatus(journey.status)
    && nextStatus !== journey.status
    && !exactLocalRecovery
    && !exactAuditRepair
  ) {
    throw new Error("A finished Pantheon journey cannot return to active work.");
  }
  const metadata = { ...journey.metadata, ...(patch.metadata || {}) };
  if (patch.stageEvent) {
    const history = Array.isArray(metadata.stageHistory) ? metadata.stageHistory : [];
    const event = {
      stage: patch.stageEvent.stage || patch.activeStage || journey.active_stage,
      status: patch.stageEvent.status || patch.status || journey.status,
      taskId: patch.stageEvent.taskId || null,
      workerId: patch.stageEvent.workerId || null,
      note: patch.stageEvent.note || "",
      at: patch.stageEvent.at || now(),
    };
    metadata.stageHistory = [...history, event].slice(-80);
  }
  const status = nextStatus;
  const completedAt = patch.completedAt === undefined
    ? journey.completed_at
    : patch.completedAt;
  run(
    db,
    `UPDATE pantheon_journeys
     SET status = ?, active_stage = ?, round_id = COALESCE(?, round_id),
         workflow_id = COALESCE(?, workflow_id),
         selected_opportunity_id = COALESCE(?, selected_opportunity_id),
         metadata = ?, completed_at = ?, updated_at = ?
     WHERE id = ?`,
    [
      status,
      patch.activeStage || journey.active_stage,
      patch.roundId || null,
      patch.workflowId || null,
      patch.selectedOpportunityId || null,
      toJson(metadata),
      completedAt,
      now(),
      journeyId,
    ],
  );
  const updated = journeyById(db, journeyId);
  if (TERMINAL_JOURNEY_STATUSES.has(updated.status)) {
    syncProofExposureFromDatabase(db);
  }
  return updated;
}

function closeTerminalJourneyExecution(db, journey) {
  if (!journey || journey.status === "completed") return;
  const ts = now();
  const stoppedStatus = journey.status === "cancelled" ? "cancelled" : "failed";
  if (journey.workflow_id) {
    run(
      db,
      `UPDATE approvals
       SET status = 'cancelled', decided_at = COALESCE(decided_at, ?),
           decision_note = CASE
             WHEN decision_note IS NULL OR decision_note = ''
               THEN 'Closed with the superseded Pantheon journey.'
             ELSE decision_note
           END
       WHERE status = 'pending'
         AND task_id IN (SELECT id FROM tasks WHERE workflow_id = ?)`,
      [ts, journey.workflow_id],
    );
    run(
      db,
      `UPDATE agent_handoffs
       SET status = 'cancelled', updated_at = ?
       WHERE workflow_id = ?
         AND status IN ('needs_operator_decision', 'waiting_for_review', 'waiting_approval')`,
      [ts, journey.workflow_id],
    );
    run(
      db,
      `UPDATE tasks
       SET status = 'cancelled', updated_at = ?
       WHERE workflow_id = ?
         AND status IN ('planned', 'queued', 'running', 'blocked', 'waiting_approval')`,
      [ts, journey.workflow_id],
    );
    run(
      db,
      `UPDATE workflows
       SET status = ?, current_step = ?, approval_required = 0, updated_at = ?
       WHERE id = ? AND status NOT IN ('completed', 'failed', 'cancelled')`,
      [
        stoppedStatus,
        journey.status === "cancelled" ? "Closed before a clean restart" : "Stopped after failed proof",
        ts,
        journey.workflow_id,
      ],
    );
    run(
      db,
      `UPDATE commands SET status = ?, updated_at = ?
       WHERE workflow_id = ? AND status NOT IN ('completed', 'failed', 'cancelled')`,
      [stoppedStatus, ts, journey.workflow_id],
    );
  }
  if (journey.round_id) {
    run(
      db,
      `UPDATE opportunity_rounds SET status = ?, updated_at = ?
       WHERE id = ? AND status NOT IN ('completed', 'cancelled', 'stopped_after_correction', 'stopped_unknown_outcome')`,
      [journey.status, ts, journey.round_id],
    );
  }
}

function startPantheonJourney(db, input = {}) {
  const existing = activeJourney(db);
  if (existing && input.force !== true) {
    return { journey: existing, alreadyRunning: true, state: getJourneyState(db, existing.id) };
  }
  if (existing && input.force === true) {
    const currentTask = existing.metadata?.currentTaskId
      ? get(db, "SELECT payload FROM tasks WHERE id = ?", [existing.metadata.currentTaskId])
      : null;
    const currentPayload = fromJson(currentTask?.payload, {});
    const correctionNumber = taskCorrectionNumber(currentPayload);
    const correctionLimit = Math.max(0, Number(existing.metadata?.correctionLimitPerStage || 1));
    const exhaustedCorrection = existing.status === "needs_attention"
      && (
        (correctionNumber > 0 && correctionNumber >= correctionLimit)
        || (
          existing.metadata?.currentTaskId === null
          && /correction|quality review/i.test(String(existing.metadata?.blocker || ""))
        )
      );
    updateJourney(db, existing.id, {
      status: exhaustedCorrection ? "stopped_after_correction" : "cancelled",
      completedAt: now(),
      metadata: {
        currentTaskId: null,
        currentApprovalId: null,
        supersededByCleanRestart: true,
      },
      stageEvent: {
        stage: existing.active_stage,
        status: exhaustedCorrection ? "stopped_after_correction" : "cancelled",
        note: exhaustedCorrection
          ? "The failed proof was preserved and a clean replacement journey was requested."
          : "The unfinished journey was closed before a clean replacement was requested.",
      },
    });
  }
  const previousJourneys = all(
    db,
    "SELECT * FROM pantheon_journeys ORDER BY created_at DESC",
  ).map(parseJourney);
  for (const previousJourney of previousJourneys) {
    if (isTerminalJourneyStatus(previousJourney.status)) {
      closeTerminalJourneyExecution(db, previousJourney);
    }
  }
  const venture = get(db, "SELECT id FROM ventures WHERE is_active = 1 ORDER BY updated_at DESC LIMIT 1");
  if (!venture) throw new Error("Pantheon needs one active venture before a full journey can begin.");
  const mode = input.mode === "rehearsal" ? "rehearsal" : "production";
  const model = String(input.model || CONFIG.lunaModel);
  if (model !== CONFIG.lunaModel) {
    throw new Error("The approved full-journey proof must use Luna for every agent.");
  }
  const budgetCapCents = Math.max(
    100,
    Math.min(
      CONFIG.journeyBudgetCapCents,
      Number(input.budgetCapCents || CONFIG.journeyBudgetCapCents),
    ),
  );
  const sharedExposure = syncProofExposureFromDatabase(db);
  const inferredCarriedExposureCents = previousJourneys.reduce(
    (highest, previousJourney) => Math.max(
      highest,
      journeyBudgetExposure(
        db,
        previousJourney.id,
        previousJourney.carried_exposure_cents,
      ).totalCents,
    ),
    0,
  );
  const carriedExposureCents = Math.max(
    0,
    inferredCarriedExposureCents,
    sharedExposure.totalCents,
    Number(input.carriedExposureCents || 0),
  );
  if (carriedExposureCents >= budgetCapCents) {
    throw new Error("The carried rehearsal exposure leaves no budget for another journey.");
  }
  ensureProofExposureAtLeast(db, carriedExposureCents, {
    reason: "Journey start cannot understate verified prior proof exposure",
    mode,
  });
  const id = `journey_${mode}_${randomId()}`;
  const ts = now();
  run(
    db,
    `INSERT INTO pantheon_journeys
     (id, venture_id, mode, status, active_stage, model, model_locked,
      budget_cap_cents, carried_exposure_cents, metadata, started_at, created_at, updated_at)
     VALUES (?, ?, ?, 'starting', 'opportunity_scout', ?, 1, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      venture.id,
      mode,
      model,
      budgetCapCents,
      carriedExposureCents,
      toJson({
        marketScope: "broad_scan_buildable_digital_winner",
        requiredValidatedCandidates: 3,
        catalogueMinimum: 3,
        catalogueMaximum: 6,
        externalActionsAllowed: false,
        automaticModelFallbackAllowed: false,
        correctionLimitPerStage: 1,
        stageHistory: [],
      }),
      ts,
      ts,
      ts,
    ],
  );
  const { startOpportunityRound } = require("./pantheon-opportunities");
  const started = startOpportunityRound(db, {
    prompt: input.prompt,
    idea: input.idea,
    geography: input.geography,
    language: input.language,
    maxCandidates: 5,
    source: input.source || "full-journey",
    createdBy: input.createdBy || "Daniel",
    force: input.force === true,
    journeyId: id,
    model,
    modelLocked: true,
  });
  const journey = updateJourney(db, id, {
    status: "running",
    activeStage: "opportunity_scout",
    roundId: started.round.id,
    workflowId: started.round.metadata.workflowId,
    metadata: {
      roundId: started.round.id,
      workflowId: started.round.metadata.workflowId,
      currentTaskId: started.queued?.task?.id || null,
    },
    stageEvent: {
      stage: "opportunity_scout",
      status: "waiting_to_start",
      taskId: started.queued?.task?.id || null,
      workerId: "opportunity_scout",
      note: "Broad opportunity research was prepared.",
    },
  });
  insertEvent(db, {
    actor: "pantheon",
    type: "pantheon.journey_started",
    entityType: "pantheon_journey",
    entityId: id,
    message: mode === "rehearsal"
      ? "Pantheon prepared an isolated Luna-only full-journey rehearsal."
      : "Pantheon prepared a Luna-only production-intent commercial journey.",
    metadata: {
      mode,
      model,
      budgetCapCents,
      carriedExposureCents,
      externalActionsAllowed: false,
    },
  });
  return { journey, started, alreadyRunning: false, state: getJourneyState(db, id) };
}

function getJourneyState(db, journeyId = null) {
  const { getRetentionPolicyState } = require("./retention-policy");
  const prerequisites = {
    dataProtection: getRetentionPolicyState(db),
  };
  const journey = journeyId
    ? journeyById(db, journeyId)
    : currentOperatorJourney(db);
  if (!journey) {
    return {
      schema: "pantheon_full_journey_state_v1",
      journey: null,
      recent: [],
      stages: JOURNEY_STAGES,
      exposure: null,
      currentTask: null,
      candidates: [],
      currentProduct: null,
      outputs: [],
      prerequisites,
      correction: null,
    };
  }
  const journeyExposure = journeyBudgetExposure(db, journey.id, journey.carried_exposure_cents);
  const combinedExposure = combinedProofExposureFromDatabase(db);
  const exposure = {
    ...journeyExposure,
    journeyTotalCents: journeyExposure.totalCents,
    sharedCents: combinedExposure.sharedCents,
    activeJourneyLocalCents: combinedExposure.activeJourneyLocalCents,
    totalCents: combinedExposure.totalCents,
    remainingCents: Math.max(0, Number(journey.budget_cap_cents) - combinedExposure.totalCents),
  };
  const tasks = all(
    db,
    `SELECT * FROM tasks
     WHERE COALESCE(
       json_extract(payload, '$.liveSpendRequest.parameters.pantheonJourney.journeyId'),
       json_extract(payload, '$.liveSpendRequest.parameters.pantheonCommercial.journeyId'),
       json_extract(payload, '$.liveSpendRequest.parameters.pantheonProduction.journeyId')
     ) = ?
     ORDER BY created_at, id`,
    [journey.id],
  ).map((row) => ({ ...row, payload: fromJson(row.payload, {}), result: fromJson(row.result, {}) }));
  const openStatuses = new Set(["queued", "planned", "blocked", "waiting_approval", "running", "needs_attention"]);
  const resolvedTaskIds = supersededRetryTaskIds(db);
  const isCurrentTask = (task) => task
    && !resolvedTaskIds.has(task.id)
    && (
      openStatuses.has(task.status)
      || preDispatchRecoveryStatus(db, task).available
    );
  const recordedTask = journey.metadata.currentTaskId
    ? tasks.find((task) => task.id === journey.metadata.currentTaskId) || null
    : null;
  const recordedCurrentTask = isCurrentTask(recordedTask) ? recordedTask : null;
  const currentTask = recordedCurrentTask
    || [...tasks].reverse().find(isCurrentTask)
    || null;
  const latestAttempt = ["needs_attention", "failed"].includes(currentTask?.status)
    ? get(
      db,
      "SELECT error_kind FROM task_attempts WHERE task_id = ? ORDER BY started_at DESC, id DESC LIMIT 1",
      [currentTask.id],
    )
    : null;
  const correctionNumber = taskCorrectionNumber(currentTask?.payload);
  const correctionLimit = Math.max(0, Number(journey.metadata.correctionLimitPerStage || 1));
  const preDispatchRecovery = currentTask
    ? preDispatchRecoveryStatus(db, currentTask)
    : { available: false };
  const correction = preDispatchRecovery.available
    ? {
      kind: "prepare_known_ai_retry",
      taskId: currentTask.id,
      label: `Try ${String(currentTask.agent || "this AI worker").replaceAll("_", " ")} again`,
      summary: "Pantheon stopped locally before contacting OpenAI. The issue is repaired, no API cost occurred, and a fresh exact approval can now be prepared.",
      technicalRecovery: true,
    }
    : correctionNumber < correctionLimit
      && canPrepareReviewedRetry(currentTask, latestAttempt?.error_kind)
      ? {
      kind: "prepare_known_ai_retry",
      taskId: currentTask.id,
      label: `Prepare one corrected ${String(currentTask.agent || "AI worker").replaceAll("_", " ")} attempt`,
      summary: /invalid output|unterminated string/i.test(String(currentTask.error || ""))
        ? "The AI answer was cut off before Pantheon could safely use it. The failed call and its estimated cost remain recorded."
        : "The AI call finished, but Pantheon could not safely use the result. One corrected attempt is available.",
      }
      : null;
  const candidateRows = journey.round_id
    ? all(
      db,
      "SELECT * FROM opportunities WHERE round_id = ? ORDER BY overall_score DESC, created_at",
      [journey.round_id],
    ).map((row) => ({ ...row, evidence_ids: fromJson(row.evidence_ids, []), metadata: fromJson(row.metadata, {}) }))
    : [];
  const candidateEvidenceIds = [...new Set(candidateRows.flatMap((candidate) => candidate.evidence_ids))];
  const candidateEvidence = candidateEvidenceIds.length
    ? all(
      db,
      `SELECT id, title, source_url, verified_at, metadata
       FROM commercial_evidence
       WHERE id IN (${candidateEvidenceIds.map(() => "?").join(", ")})`,
      candidateEvidenceIds,
    ).map((evidence) => ({ ...evidence, metadata: fromJson(evidence.metadata, {}) }))
    : [];
  const evidenceById = new Map(candidateEvidence.map((evidence) => [evidence.id, evidence]));
  const candidates = candidateRows.map((candidate) => ({
    ...candidate,
    sources: candidate.evidence_ids.map((id) => evidenceById.get(id)).filter(Boolean),
  }));
  const selectedPlanRow = journey.selected_opportunity_id
    ? get(
      db,
      `SELECT id, title, status, target_item_count, price_floor_cents, price_ceiling_cents, metadata
       FROM catalogue_plans
       WHERE opportunity_id = ?
       ORDER BY updated_at DESC, created_at DESC
       LIMIT 1`,
      [journey.selected_opportunity_id],
    )
    : null;
  const selectedPlanMetadata = fromJson(selectedPlanRow?.metadata, {});
  const selectedProductManifest = selectedPlanMetadata.productManifest || {};
  const currentProduct = selectedPlanRow
    ? {
      planId: selectedPlanRow.id,
      title: selectedProductManifest.packageTitle || selectedPlanRow.title,
      customerPromise: selectedProductManifest.customerPromise || "",
      deliveryFormat: selectedProductManifest.deliveryFormat || "",
      itemCount: Number(
        selectedProductManifest.catalogueItems?.length
          || selectedPlanRow.target_item_count
          || 0,
      ),
      status: selectedPlanRow.status,
      priceFloorCents: Number(selectedPlanRow.price_floor_cents || 0),
      priceCeilingCents: Number(selectedPlanRow.price_ceiling_cents || 0),
    }
    : null;
  const outputHistory = journey.workflow_id
    ? all(
      db,
      `SELECT id, title, human_name, format, status, file_path, summary, metadata, created_at, updated_at
       FROM deliverables WHERE workflow_id = ? ORDER BY created_at, id`,
      [journey.workflow_id],
    ).map((row) => ({ ...row, metadata: fromJson(row.metadata, {}) }))
    : [];
  const canonicalOutputKeys = new Set();
  const outputs = [];
  for (const output of [...outputHistory].reverse()) {
    if (output.status === "superseded") continue;
    const key = `${output.title}|${output.human_name}|${output.format}`;
    if (canonicalOutputKeys.has(key)) continue;
    canonicalOutputKeys.add(key);
    outputs.unshift(output);
  }
  return {
    schema: "pantheon_full_journey_state_v1",
    journey,
    stages: JOURNEY_STAGES,
    exposure,
    currentTask,
    tasks,
    candidates,
    currentProduct,
    outputs,
    prerequisites,
    correction,
    recent: all(
      db,
      "SELECT * FROM pantheon_journeys ORDER BY created_at DESC LIMIT 12",
    ).map(parseJourney),
  };
}

module.exports = {
  ACTIVE_JOURNEY_STATUSES,
  JOURNEY_STAGES,
  TERMINAL_JOURNEY_STATUSES,
  activeJourney,
  currentOperatorJourney,
  getJourneyState,
  isTerminalJourneyStatus,
  journeyById,
  journeyForRound,
  journeyForWorkflow,
  startPantheonJourney,
  updateJourney,
};
