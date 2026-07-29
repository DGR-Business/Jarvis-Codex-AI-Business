const crypto = require("node:crypto");
const {
  all,
  fromJson,
  get,
  insertEvent,
  now,
  run,
  toJson,
} = require("../db");
const { finalizeAgentExecutionReceipt } = require("./agent-execution-evidence");
const { renderRetainedProductBuilderOutput } = require("./agent-runtime");
const {
  addAgentTrace,
  createAgentRun,
  evaluateAgentOutput,
  findAgentDefinition,
  finishAgentRun,
} = require("./ai-team");
const { canPrepareReviewedRetry } = require("./live-ai-retry-policy");
const { updateJourney } = require("./pantheon-journey");
const { projectCompletedCommercialTask } = require("./pantheon-opportunities");
const {
  assertQualityReviewRecheckAvailable,
  projectCompletedProductionTask,
} = require("./pantheon-production");

const RETAINED_OUTPUT_RECOVERY_SCHEMA = "pantheon.retained-provider-output-recovery.v1";
const LOCAL_FACTORY_RECOVERY_REVISION = "validation-final-local-correction-v9";
const RETAINED_COMMERCIAL_OUTPUT_RECOVERY_SCHEMA = "pantheon.retained-commercial-output-recovery.v1";
const RETAINED_PRODUCTION_OUTPUT_RECOVERY_SCHEMA = "pantheon.retained-production-output-recovery.v1";
const OFFER_EVALUATOR_RECOVERY_REVISION = "claim-negation-context-v1";
const PRODUCTION_EVALUATOR_RECOVERY_STAGES = new Set([
  "conversion_copy",
  "distribution_plan",
  "chief_brief",
]);

function withRecoverySavepoint(db, name, work) {
  const savepoint = `recovery_${String(name).replace(/[^a-zA-Z0-9_]/g, "_")}`;
  db.exec(`SAVEPOINT ${savepoint}`);
  try {
    const result = work();
    db.exec(`RELEASE SAVEPOINT ${savepoint}`);
    return result;
  } catch (error) {
    db.exec(`ROLLBACK TO SAVEPOINT ${savepoint}`);
    db.exec(`RELEASE SAVEPOINT ${savepoint}`);
    throw error;
  }
}

function sha256(value) {
  const bytes = typeof value === "string" ? value : JSON.stringify(value);
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function parseTask(row) {
  return row ? {
    ...row,
    payload: fromJson(row.payload, {}),
    result: fromJson(row.result, {}),
  } : null;
}

function parseRun(row) {
  return row ? { ...row, metadata: fromJson(row.metadata, {}) } : null;
}

function productionMetadata(task) {
  return task?.payload?.liveSpendRequest?.parameters?.pantheonProduction || {};
}

function recoveryIdentity(
  sourceTaskId,
  sourceOutputHash,
  rendererRevision = LOCAL_FACTORY_RECOVERY_REVISION,
) {
  return sha256({
    schema: RETAINED_OUTPUT_RECOVERY_SCHEMA,
    sourceTaskId,
    sourceOutputHash,
    renderer: "pantheon-local-digital-product-factory-v1",
    rendererRevision,
  }).slice(0, 24);
}

function commercialRecoveryIdentity(
  sourceTaskId,
  sourceOutputHash,
  evaluatorRevision = OFFER_EVALUATOR_RECOVERY_REVISION,
) {
  return sha256({
    schema: RETAINED_COMMERCIAL_OUTPUT_RECOVERY_SCHEMA,
    sourceTaskId,
    sourceOutputHash,
    evaluatorRevision,
  }).slice(0, 24);
}

function productionRecoveryIdentity(sourceTaskId, sourceOutputHash, evaluatorRevision) {
  return sha256({
    schema: RETAINED_PRODUCTION_OUTPUT_RECOVERY_SCHEMA,
    sourceTaskId,
    sourceOutputHash,
    evaluatorRevision,
  }).slice(0, 24);
}

function exactRetainedOfferArchitectSource(db, sourceTaskId, options = {}) {
  const sourceTask = parseTask(get(db, "SELECT * FROM tasks WHERE id = ?", [sourceTaskId]));
  if (!sourceTask) throw new Error(`Offer Architect source task not found: ${sourceTaskId}`);
  const request = sourceTask.payload?.liveSpendRequest || {};
  const commercial = request.parameters?.pantheonCommercial || {};
  const providerReceipt = sourceTask.result?.providerReceipt || null;
  if (
    sourceTask.kind !== "live_ai_worker_execution"
    || sourceTask.agent !== "offer_architect"
    || !["failed", "needs_attention"].includes(sourceTask.status)
    || sourceTask.outcome_status !== "known_provider_result_needs_review"
    || commercial.step !== "offer_architecture"
    || providerReceipt?.provider !== "openai-agents-sdk"
    || providerReceipt?.status !== "completed"
    || !providerReceipt?.modelCallId
    || !providerReceipt?.providerRequestId
  ) {
    throw new Error("This task is not an eligible completed-provider Offer Architect result.");
  }

  const candidateRuns = all(
    db,
    "SELECT * FROM agent_runs WHERE task_id = ? ORDER BY started_at, id",
    [sourceTask.id],
  ).map(parseRun).filter((agentRun) => (
    agentRun.status === "failed"
    && agentRun.metadata?.localReviewOutput
    && agentRun.metadata?.providerReceipt?.status === "completed"
    && agentRun.metadata.providerReceipt.modelCallId === providerReceipt.modelCallId
    && agentRun.metadata.providerReceipt.providerRequestId === providerReceipt.providerRequestId
  ));
  const matchingRuns = options.sourceRunId
    ? candidateRuns.filter((agentRun) => agentRun.id === options.sourceRunId)
    : candidateRuns;
  if (matchingRuns.length !== 1) {
    throw new Error(`Expected exactly one retained Offer Architect provider result; found ${matchingRuns.length}.`);
  }
  const sourceRun = matchingRuns[0];
  const sourceAttemptId = sourceRun.metadata?.evaluation?.attemptId
    || get(
      db,
      "SELECT id FROM task_attempts WHERE task_id = ? AND model_call_id = ? LIMIT 1",
      [sourceTask.id, providerReceipt.modelCallId],
    )?.id
    || null;
  const sourceAttempt = sourceAttemptId
    ? get(db, "SELECT * FROM task_attempts WHERE id = ?", [sourceAttemptId])
    : null;
  const sourceModelCall = get(
    db,
    "SELECT * FROM model_calls WHERE id = ? AND task_id = ?",
    [providerReceipt.modelCallId, sourceTask.id],
  );
  const sourceModelMetadata = fromJson(sourceModelCall?.metadata, {});
  const sourceModelProvider = sourceModelMetadata.provider || sourceModelCall?.provider || null;
  const proofFailures = [
    [!sourceAttempt, "source attempt is missing"],
    [sourceAttempt && sourceAttempt.status !== "needs_attention", `source attempt status is ${sourceAttempt?.status || "missing"}`],
    [sourceAttempt && sourceAttempt.error_kind !== "worker_evaluation_failed", "source attempt error kind is not worker evaluation failed"],
    [sourceAttempt && sourceAttempt.outcome_status !== "known_provider_result_needs_review", "source attempt outcome is not a known provider result needing review"],
    [sourceAttempt && sourceAttempt.provider_request_id !== providerReceipt.providerRequestId, "source attempt provider request does not match the retained receipt"],
    [sourceAttempt && sourceAttempt.agent_run_id !== sourceRun.id, "source attempt is not bound to the retained worker run"],
    [sourceAttempt && sourceAttempt.model_call_id !== providerReceipt.modelCallId, "source attempt is not bound to the retained model call"],
    [!sourceModelCall, "source model call is missing"],
    [sourceModelCall && sourceModelProvider !== "openai-agents-sdk", "source model call did not use the Agents SDK"],
    [sourceModelCall && sourceModelCall.status !== "completed", `source model call status is ${sourceModelCall?.status || "missing"}`],
    [sourceModelCall && sourceModelCall.outcome_status !== "known", "source model call outcome is not known"],
    [sourceModelCall && sourceModelCall.provider_request_id !== providerReceipt.providerRequestId, "source model call provider request does not match the retained receipt"],
  ].filter(([failed]) => failed).map(([, reason]) => reason);
  if (proofFailures.length) {
    throw new Error(
      `Pantheon cannot prove the exact retained provider result, failed local check, and cost receipt: ${proofFailures.join("; ")}.`,
    );
  }
  const unexpectedDeliverables = get(
    db,
    "SELECT COUNT(*) AS count FROM deliverables WHERE task_id = ?",
    [sourceTask.id],
  );
  if (Number(unexpectedDeliverables?.count || 0) > 0) {
    throw new Error("The failed Offer Architect task already owns deliverables, so local recovery would be ambiguous.");
  }
  const retainedOutput = sourceRun.metadata.localReviewOutput;
  return {
    sourceTask,
    sourceRun,
    sourceAttempt,
    sourceModelCall,
    providerReceipt,
    retainedOutput,
    sourceOutputHash: sha256(retainedOutput),
  };
}

function exactRetainedProductionWorkerSource(db, sourceTaskId, options = {}) {
  const sourceTask = parseTask(get(db, "SELECT * FROM tasks WHERE id = ?", [sourceTaskId]));
  if (!sourceTask) throw new Error(`Production worker source task not found: ${sourceTaskId}`);
  const request = sourceTask.payload?.liveSpendRequest || {};
  const production = request.parameters?.pantheonProduction || {};
  const providerReceipt = sourceTask.result?.providerReceipt || null;
  if (
    sourceTask.kind !== "live_ai_worker_execution"
    || !["failed", "needs_attention"].includes(sourceTask.status)
    || sourceTask.outcome_status !== "known_provider_result_needs_review"
    || !PRODUCTION_EVALUATOR_RECOVERY_STAGES.has(production.stage)
    || providerReceipt?.provider !== "openai-agents-sdk"
    || providerReceipt?.status !== "completed"
    || !providerReceipt?.modelCallId
    || !providerReceipt?.providerRequestId
  ) {
    throw new Error("This task is not an eligible completed-provider production result.");
  }

  const candidateRuns = all(
    db,
    "SELECT * FROM agent_runs WHERE task_id = ? ORDER BY started_at, id",
    [sourceTask.id],
  ).map(parseRun).filter((agentRun) => (
    agentRun.status === "failed"
    && agentRun.metadata?.localReviewOutput
    && agentRun.metadata?.providerReceipt?.status === "completed"
    && agentRun.metadata.providerReceipt.modelCallId === providerReceipt.modelCallId
    && agentRun.metadata.providerReceipt.providerRequestId === providerReceipt.providerRequestId
  ));
  const matchingRuns = options.sourceRunId
    ? candidateRuns.filter((agentRun) => agentRun.id === options.sourceRunId)
    : candidateRuns;
  if (matchingRuns.length !== 1) {
    throw new Error(`Expected exactly one retained production provider result; found ${matchingRuns.length}.`);
  }
  const sourceRun = matchingRuns[0];
  const sourceAttemptId = sourceRun.metadata?.evaluation?.attemptId
    || get(
      db,
      "SELECT id FROM task_attempts WHERE task_id = ? AND model_call_id = ? LIMIT 1",
      [sourceTask.id, providerReceipt.modelCallId],
    )?.id
    || null;
  const sourceAttempt = sourceAttemptId
    ? get(db, "SELECT * FROM task_attempts WHERE id = ?", [sourceAttemptId])
    : null;
  const sourceModelCall = get(
    db,
    "SELECT * FROM model_calls WHERE id = ? AND task_id = ?",
    [providerReceipt.modelCallId, sourceTask.id],
  );
  const sourceModelMetadata = fromJson(sourceModelCall?.metadata, {});
  const sourceModelProvider = sourceModelMetadata.provider || sourceModelCall?.provider || null;
  const proofFailures = [
    [!sourceAttempt, "source attempt is missing"],
    [sourceAttempt && sourceAttempt.status !== "needs_attention", `source attempt status is ${sourceAttempt?.status || "missing"}`],
    [sourceAttempt && sourceAttempt.error_kind !== "worker_evaluation_failed", "source attempt error kind is not worker evaluation failed"],
    [sourceAttempt && sourceAttempt.outcome_status !== "known_provider_result_needs_review", "source attempt outcome is not a known provider result needing review"],
    [sourceAttempt && sourceAttempt.provider_request_id !== providerReceipt.providerRequestId, "source attempt provider request does not match the retained receipt"],
    [sourceAttempt && sourceAttempt.agent_run_id !== sourceRun.id, "source attempt is not bound to the retained worker run"],
    [sourceAttempt && sourceAttempt.model_call_id !== providerReceipt.modelCallId, "source attempt is not bound to the retained model call"],
    [!sourceModelCall, "source model call is missing"],
    [sourceModelCall && sourceModelProvider !== "openai-agents-sdk", "source model call did not use the Agents SDK"],
    [sourceModelCall && sourceModelCall.status !== "completed", `source model call status is ${sourceModelCall?.status || "missing"}`],
    [sourceModelCall && sourceModelCall.outcome_status !== "known", "source model call outcome is not known"],
    [sourceModelCall && sourceModelCall.provider_request_id !== providerReceipt.providerRequestId, "source model call provider request does not match the retained receipt"],
  ].filter(([failed]) => failed).map(([, reason]) => reason);
  if (proofFailures.length) {
    throw new Error(
      `Pantheon cannot prove the exact retained provider result, failed local check, and cost receipt: ${proofFailures.join("; ")}.`,
    );
  }
  const unexpectedDeliverables = get(
    db,
    "SELECT COUNT(*) AS count FROM deliverables WHERE task_id = ?",
    [sourceTask.id],
  );
  if (Number(unexpectedDeliverables?.count || 0) > 0) {
    throw new Error("The failed production task already owns deliverables, so local recovery would be ambiguous.");
  }
  const retainedOutput = sourceRun.metadata.localReviewOutput;
  return {
    sourceTask,
    sourceRun,
    sourceAttempt,
    sourceModelCall,
    providerReceipt,
    production,
    retainedOutput,
    sourceOutputHash: sha256(retainedOutput),
  };
}

function exactRetainedSource(db, sourceTaskId, options = {}) {
  const sourceTask = parseTask(get(db, "SELECT * FROM tasks WHERE id = ?", [sourceTaskId]));
  if (!sourceTask) throw new Error(`Product Builder source task not found: ${sourceTaskId}`);
  const request = sourceTask.payload?.liveSpendRequest || {};
  const production = request.parameters?.pantheonProduction || {};
  const providerReceipt = sourceTask.result?.providerReceipt || null;
  if (
    sourceTask.kind !== "live_ai_worker_execution"
    || sourceTask.agent !== "product_builder"
    || !["failed", "needs_attention"].includes(sourceTask.status)
    || sourceTask.outcome_status !== "known_provider_result_needs_review"
    || production.stage !== "product_build"
    || !request.parameters?.productBuildSpec
    || providerReceipt?.provider !== "openai-agents-sdk"
    || providerReceipt?.status !== "completed"
    || !providerReceipt?.modelCallId
    || !providerReceipt?.providerRequestId
  ) {
    throw new Error("This task is not an eligible completed-provider Product Builder result.");
  }

  const candidateRuns = all(
    db,
    "SELECT * FROM agent_runs WHERE task_id = ? ORDER BY started_at, id",
    [sourceTask.id],
  ).map(parseRun).filter((agentRun) => (
    agentRun.status === "failed"
    && agentRun.metadata?.localStructuredOutput?.work?.productBlueprint
    && agentRun.metadata?.providerReceipt?.status === "completed"
    && agentRun.metadata.providerReceipt.modelCallId === providerReceipt.modelCallId
    && agentRun.metadata.providerReceipt.providerRequestId === providerReceipt.providerRequestId
  ));
  const matchingRuns = options.sourceRunId
    ? candidateRuns.filter((agentRun) => agentRun.id === options.sourceRunId)
    : candidateRuns;
  if (matchingRuns.length !== 1) {
    throw new Error(`Expected exactly one retained Product Builder provider result; found ${matchingRuns.length}.`);
  }
  const sourceRun = matchingRuns[0];
  const sourceAttemptId = sourceRun.metadata?.evaluation?.attemptId
    || get(
      db,
      "SELECT id FROM task_attempts WHERE task_id = ? AND model_call_id = ? LIMIT 1",
      [sourceTask.id, providerReceipt.modelCallId],
    )?.id
    || null;
  const sourceAttempt = sourceAttemptId
    ? get(db, "SELECT * FROM task_attempts WHERE id = ?", [sourceAttemptId])
    : null;
  const sourceModelCall = get(
    db,
    "SELECT * FROM model_calls WHERE id = ? AND task_id = ?",
    [providerReceipt.modelCallId, sourceTask.id],
  );
  const sourceModelMetadata = fromJson(sourceModelCall?.metadata, {});
  const sourceModelProvider = sourceModelMetadata.provider || sourceModelCall?.provider || null;
  const proofFailures = [
    [!sourceAttempt, "source attempt is missing"],
    [sourceAttempt && sourceAttempt.error_kind !== "local_processing_after_provider_success", "source attempt error kind is not local processing after provider success"],
    [sourceAttempt && sourceAttempt.outcome_status !== "known_provider_result_needs_review", "source attempt outcome is not a known provider result needing review"],
    [sourceAttempt && sourceAttempt.provider_request_id !== providerReceipt.providerRequestId, "source attempt provider request does not match the retained receipt"],
    [sourceAttempt && sourceAttempt.agent_run_id !== sourceRun.id, "source attempt is not bound to the retained worker run"],
    [sourceAttempt && sourceAttempt.model_call_id !== providerReceipt.modelCallId, "source attempt is not bound to the retained model call"],
    [!sourceModelCall, "source model call is missing"],
    [sourceModelCall && sourceModelProvider !== "openai-agents-sdk", "source model call did not use the Agents SDK"],
    [sourceModelCall && sourceModelCall.status !== "needs_attention", `source model call status is ${sourceModelCall?.status || "missing"}`],
    [sourceModelCall && sourceModelCall.outcome_status !== "known", "source model call outcome is not known"],
    [sourceModelCall && sourceModelCall.error_kind !== "local_processing_after_provider_success", "source model call error kind is not local processing after provider success"],
    [sourceModelCall && sourceModelCall.provider_request_id !== providerReceipt.providerRequestId, "source model call provider request does not match the retained receipt"],
  ].filter(([failed]) => failed).map(([, reason]) => reason);
  if (proofFailures.length) {
    throw new Error(
      `Pantheon cannot prove the exact retained provider result, failed local check, and cost receipt: ${proofFailures.join("; ")}.`,
    );
  }
  const unexpectedDeliverables = get(
    db,
    "SELECT COUNT(*) AS count FROM deliverables WHERE task_id = ?",
    [sourceTask.id],
  );
  if (Number(unexpectedDeliverables?.count || 0) > 0) {
    throw new Error("The failed source task already owns deliverables, so local recovery would be ambiguous.");
  }
  const retainedOutput = sourceRun.metadata.localStructuredOutput;
  return {
    sourceTask,
    sourceRun,
    sourceAttempt,
    sourceModelCall,
    providerReceipt,
    retainedOutput,
    sourceOutputHash: sha256(retainedOutput),
  };
}

function buildRecoveryTask(source, recoveryId, rendererRevision) {
  const sourceRequest = source.sourceTask.payload.liveSpendRequest;
  const sourceParameters = sourceRequest.parameters || {};
  const id = `task_local_recovery_${recoveryId}`;
  return {
    id,
    workflow_id: source.sourceTask.workflow_id,
    venture_id: source.sourceTask.venture_id,
    title: `Recover validated product files from ${source.sourceTask.title}`,
    kind: "local_product_output_recovery",
    agent: "jarvis",
    status: "running",
    priority: Number(source.sourceTask.priority || 1),
    retries: 0,
    max_retries: 0,
    approval_id: null,
    cost_budget_cents: 0,
    cost_actual_cents: 0,
    payload: {
      schema: "pantheon.local-product-output-recovery-task.v1",
      commandId: source.sourceTask.payload?.commandId || null,
      recovery: {
        schema: RETAINED_OUTPUT_RECOVERY_SCHEMA,
        sourceTaskId: source.sourceTask.id,
        sourceRunId: source.sourceRun.id,
        sourceAttemptId: source.sourceAttempt.id,
        sourceModelCallId: source.sourceModelCall.id,
        sourceProviderRequestId: source.providerReceipt.providerRequestId,
        sourceOutputHash: source.sourceOutputHash,
        rendererRevision,
        noNewProviderCall: true,
        reason: "A tested local factory correction can process the exact retained provider output without another model call.",
      },
      liveSpendRequest: {
        schema: "pantheon.local-recovery-execution.v1",
        provider: "pantheon-local-runtime",
        model: sourceRequest.model,
        maxCostCents: 0,
        tools: ["product_file_factory"],
        toolArguments: {
          product_file_factory: {
            renderer: "pantheon-local-digital-product-factory-v1",
          },
        },
        effects: [],
        parameters: {
          productBuildSpec: sourceParameters.productBuildSpec,
          pantheonJourney: sourceParameters.pantheonJourney || null,
          pantheonProduction: {
            ...sourceParameters.pantheonProduction,
            supervisorOwned: true,
            recoverySourceTaskId: source.sourceTask.id,
            recoverySourceRunId: source.sourceRun.id,
          },
        },
      },
    },
  };
}

function localRecoveryResult(source, recoveryTask, rendered, receiptId = null) {
  const accepted = rendered.acceptedOutput;
  const rendererRevision = recoveryTask.payload.recovery.rendererRevision
    || LOCAL_FACTORY_RECOVERY_REVISION;
  return {
    id: `local_recovery_${recoveryIdentity(
      source.sourceTask.id,
      source.sourceOutputHash,
      rendererRevision,
    )}`,
    mode: "pantheon-local-runtime",
    provider: "pantheon-local-runtime",
    model: source.sourceTask.payload.liveSpendRequest.model,
    status: "completed",
    actualCents: 0,
    incurredEstimateCents: 0,
    reconciledCostCents: 0,
    costStatus: "none",
    exactBillingPending: false,
    output: {
      heading: "Retained Product Builder result recovered",
      summary: accepted.summary,
      evidence: [
        "The original OpenAI call and its cost remain recorded on the failed source attempt.",
        "No new provider call occurred during this recovery.",
        ...accepted.evidence,
      ],
      details: {
        "Recovery reason": "Pantheon's corrected local factory processed the exact retained provider output and recorded any deterministic structural normalization.",
        "New AI cost": "A$0.00",
        "External action": "None",
      },
      risks: accepted.risks,
      nextAction: accepted.nextAction,
      confidence: accepted.confidence,
      liveEvidence: false,
      modelGenerated: true,
      operatorDecision: accepted.operatorDecision,
      roleOutput: accepted.work,
      generatedFiles: rendered.generatedFiles,
      localRecovery: {
        ...recoveryTask.payload.recovery,
        receiptId,
      },
    },
    raw: {
      schema: RETAINED_OUTPUT_RECOVERY_SCHEMA,
      noNewProviderCall: true,
      providerCallOccurred: false,
      sourceProviderReceipt: source.providerReceipt,
      sourceTaskId: source.sourceTask.id,
      sourceRunId: source.sourceRun.id,
      sourceAttemptId: source.sourceAttempt.id,
      sourceModelCallId: source.sourceModelCall.id,
      sourceOutputHash: source.sourceOutputHash,
      generatedFileCount: rendered.generatedFiles.files.length,
      previewCount: rendered.generatedFiles.previews.length,
    },
  };
}

function insertRecoveryTask(db, task, attemptId, ts) {
  const recoverySchema = task.payload?.recovery?.schema || RETAINED_OUTPUT_RECOVERY_SCHEMA;
  run(
    db,
    `INSERT INTO tasks
     (id, workflow_id, venture_id, title, kind, agent, status, priority, retries, max_retries,
      approval_id, cost_budget_cents, cost_actual_cents, payload, result, started_at,
      created_at, updated_at, attempt_count, outcome_status)
     VALUES (?, ?, ?, ?, ?, ?, 'running', ?, 0, 0, NULL, 0, 0, ?, '{}', ?, ?, ?, 1, 'not_started')`,
    [
      task.id,
      task.workflow_id,
      task.venture_id,
      task.title,
      task.kind,
      task.agent,
      task.priority,
      toJson(task.payload),
      ts,
      ts,
      ts,
    ],
  );
  run(
    db,
    `INSERT INTO task_attempts
     (id, task_id, workflow_id, venture_id, claim_token, status, outcome_status,
      started_at, metadata, evidence_binding_status)
     VALUES (?, ?, ?, ?, ?, 'running', 'not_started', ?, ?, 'exact')`,
    [
      attemptId,
      task.id,
      task.workflow_id,
      task.venture_id,
      `local_recovery_${attemptId}`,
      ts,
      toJson({
        schema: recoverySchema,
        noProviderCall: true,
        sourceTaskId: task.payload.recovery.sourceTaskId,
        sourceRunId: task.payload.recovery.sourceRunId,
        sourceAttemptId: task.payload.recovery.sourceAttemptId,
        sourceModelCallId: task.payload.recovery.sourceModelCallId,
        sourceOutputHash: task.payload.recovery.sourceOutputHash,
      }),
    ],
  );
}

function closeRecoveredSourceTask(db, source, recoveryTask) {
  if (source.sourceTask.status !== "needs_attention") return false;
  const closedAt = now();
  run(
    db,
    `UPDATE tasks
     SET status = 'failed', result = ?, updated_at = ?
     WHERE id = ? AND status = 'needs_attention'`,
    [
      toJson({
        ...source.sourceTask.result,
        localRecoverySupersededByTaskId: recoveryTask.id,
        localRecoverySupersededAt: closedAt,
      }),
      closedAt,
      source.sourceTask.id,
    ],
  );
  run(
    db,
    `UPDATE messages SET status = 'resolved', resolved_at = COALESCE(resolved_at, ?)
     WHERE task_id = ? AND status = 'open'`,
    [closedAt, source.sourceTask.id],
  );
  insertEvent(db, {
    actor: "jarvis",
    type: "recovery.source_attempt_superseded",
    entityType: "task",
    entityId: source.sourceTask.id,
    message: "The failed provider attempt remains auditable but no longer blocks work recovered from its exact retained result.",
    metadata: {
      recoveryTaskId: recoveryTask.id,
      sourceTaskId: source.sourceTask.id,
      sourceOutcomeStatus: source.sourceTask.outcome_status,
      sourceError: source.sourceTask.error || null,
    },
  });
  return true;
}

function closeSupersededProductBuildRetries(db, source, recoveryTask) {
  closeRecoveredSourceTask(db, source, recoveryTask);
  const production = productionMetadata(recoveryTask);
  const staleRetries = all(
    db,
    `SELECT * FROM tasks
     WHERE workflow_id = ?
       AND kind = 'live_ai_worker_execution'
       AND id NOT IN (?, ?)
       AND status = 'needs_attention'
       AND json_extract(payload, '$.liveSpendRequest.parameters.pantheonProduction.planId') = ?
       AND json_extract(payload, '$.liveSpendRequest.parameters.pantheonProduction.stage') = 'product_build'
     ORDER BY created_at, id`,
    [
      recoveryTask.workflow_id,
      source.sourceTask.id,
      recoveryTask.id,
      production.planId,
    ],
  ).map(parseTask);
  const closedAt = now();
  for (const retry of staleRetries) {
    run(
      db,
      `UPDATE tasks
       SET status = 'failed', updated_at = ?
       WHERE id = ? AND status = 'needs_attention'`,
      [closedAt, retry.id],
    );
    run(
      db,
      `UPDATE messages
       SET status = 'resolved', resolved_at = COALESCE(resolved_at, ?)
       WHERE task_id = ? AND status = 'open'`,
      [closedAt, retry.id],
    );
    insertEvent(db, {
      level: "info",
      actor: "jarvis",
      type: "product_builder.failed_retry_superseded_by_recovery",
      entityType: "task",
      entityId: retry.id,
      message: "The reviewed Product Builder retry remains auditable but no longer blocks the recovered product package.",
      metadata: {
        recoveryTaskId: recoveryTask.id,
        sourceTaskId: source.sourceTask.id,
        preservedError: retry.error || null,
        preservedOutcomeStatus: retry.outcome_status,
      },
    });
  }
  const supersededTaskIds = [
    source.sourceTask.id,
    ...staleRetries.map((retry) => retry.id),
  ];
  const plan = get(db, "SELECT metadata FROM catalogue_plans WHERE id = ?", [production.planId]);
  if (plan) {
    const metadata = fromJson(plan.metadata, {});
    run(
      db,
      "UPDATE catalogue_plans SET metadata = ?, updated_at = ? WHERE id = ?",
      [
        toJson({
          ...metadata,
          recoverySupersededTaskIds: [
            ...new Set([...(metadata.recoverySupersededTaskIds || []), ...supersededTaskIds]),
          ],
        }),
        closedAt,
        production.planId,
      ],
    );
  }
  return supersededTaskIds;
}

function supersedePriorRecoveryDeliverables(db, source, recoveryTask) {
  const supersededAt = now();
  const prior = all(
    db,
    `SELECT * FROM deliverables
     WHERE workflow_id = ? AND task_id <> ? AND status <> 'superseded'
     ORDER BY created_at, id`,
    [recoveryTask.workflow_id, recoveryTask.id],
  ).filter((deliverable) => (
    fromJson(deliverable.metadata, {})?.localRecovery?.sourceTaskId === source.sourceTask.id
  ));
  for (const deliverable of prior) {
    run(
      db,
      "UPDATE deliverables SET status = 'superseded', metadata = ?, updated_at = ? WHERE id = ?",
      [
        toJson({
          ...fromJson(deliverable.metadata, {}),
          supersededByTaskId: recoveryTask.id,
          supersededAt,
        }),
        supersededAt,
        deliverable.id,
      ],
    );
  }
  if (prior.length) {
    insertEvent(db, {
      actor: "jarvis",
      type: "product_builder.recovered_files_superseded",
      entityType: "task",
      entityId: recoveryTask.id,
      message: "Pantheon retained the older recovered files as history and made the corrected package canonical.",
      metadata: {
        sourceTaskId: source.sourceTask.id,
        supersededDeliverableIds: prior.map((deliverable) => deliverable.id),
      },
    });
  }
  return prior.map((deliverable) => deliverable.id);
}

function recoveredJourneySuccessor(db, recoveryTask) {
  const production = productionMetadata(recoveryTask);
  const rows = all(
    db,
    `SELECT * FROM tasks
     WHERE workflow_id = ?
       AND kind = 'live_ai_worker_execution'
       AND id <> ?
       AND status IN ('queued', 'planned', 'blocked', 'waiting_approval', 'running', 'needs_attention')
       AND json_extract(payload, '$.liveSpendRequest.parameters.pantheonProduction.planId') = ?
       AND json_extract(payload, '$.liveSpendRequest.parameters.pantheonProduction.stage') <> 'product_build'
     ORDER BY created_at DESC, id DESC`,
    [recoveryTask.workflow_id, recoveryTask.id, production.planId],
  ).map(parseTask);
  return rows[0] || null;
}

function reopenJourneyForRecoveredTask(db, source, recoveryTask) {
  const production = productionMetadata(recoveryTask);
  const journeyId = production.journeyId
    || recoveryTask.payload.liveSpendRequest.parameters.pantheonJourney?.journeyId
    || null;
  const supersededTaskIds = closeSupersededProductBuildRetries(db, source, recoveryTask);
  const successor = recoveredJourneySuccessor(db, recoveryTask);
  const activeTask = successor || recoveryTask;
  const activeProduction = productionMetadata(activeTask);
  const activeStage = activeProduction.stage || "product_build";
  const workflowStatus = successor
    ? (["queued", "planned"].includes(successor.status)
      ? "ready"
      : successor.status === "running"
        ? "agent_running"
        : "blocked_for_approval")
    : "agent_running";
  const workflowStep = successor
    ? `${successor.title} is ${String(successor.status).replaceAll("_", " ")}`
    : "Retained Product Builder result recovered; Pantheon is incorporating the validated files";
  const ts = now();
  run(
    db,
    `UPDATE workflows
     SET status = ?, current_step = ?,
         approval_required = 0, updated_at = ?
     WHERE id = ?`,
    [workflowStatus, workflowStep, ts, recoveryTask.workflow_id],
  );
  run(
    db,
    `UPDATE commands SET status = 'running', updated_at = ?
     WHERE workflow_id = ? AND status IN ('failed', 'needs_attention', 'needs_changes', 'running')`,
    [ts, recoveryTask.workflow_id],
  );
  if (production.roundId) {
    run(
      db,
      `UPDATE opportunity_rounds
       SET status = 'building', updated_at = ?
       WHERE id = ? AND status = 'stopped_after_correction'`,
      [ts, production.roundId],
    );
  }
  if (production.opportunityId) {
    run(
      db,
      `UPDATE opportunities
       SET status = 'building', updated_at = ?
       WHERE id = ? AND status NOT IN ('ready_to_publish', 'paused')`,
      [ts, production.opportunityId],
    );
  }
  run(
    db,
    `UPDATE messages SET status = 'resolved', resolved_at = COALESCE(resolved_at, ?)
     WHERE task_id IN (?, ?) AND status = 'open'`,
    [ts, source.sourceTask.id, recoveryTask.id],
  );
  if (journeyId) {
    updateJourney(db, journeyId, {
      allowTerminalRecovery: true,
      status: successor?.status === "needs_attention" ? "needs_attention" : "running",
      activeStage,
      completedAt: null,
      metadata: {
        currentTaskId: activeTask.id,
        currentApprovalId: activeTask.approval_id || null,
        blocker: successor?.status === "needs_attention" ? successor.error || null : null,
        correctionLimitReached: false,
        recoveredSourceTaskId: source.sourceTask.id,
        recoveredSourceRunId: source.sourceRun.id,
        recoveredSourceOutputHash: source.sourceOutputHash,
        recoverySupersededTaskIds: supersededTaskIds,
      },
      stageEvent: {
        stage: activeStage,
        status: successor ? "recovery_state_restored" : "recovered_without_provider_call",
        taskId: activeTask.id,
        workerId: "jarvis",
        note: successor
          ? "Jarvis restored the genuine next production task after the retained output recovery. No new AI call or external action occurred."
          : "Jarvis applied the tested local factory correction to the exact retained provider output. No new AI call or external action occurred.",
      },
    });
  }
}

async function recoverRetainedProductBuilderResult(db, sourceTaskId, options = {}) {
  const source = exactRetainedSource(db, sourceTaskId, options);
  const rendererRevision = String(
    options.rendererRevision || LOCAL_FACTORY_RECOVERY_REVISION,
  );
  const identity = recoveryIdentity(
    source.sourceTask.id,
    source.sourceOutputHash,
    rendererRevision,
  );
  const recoveryTaskId = `task_local_recovery_${identity}`;
  const existing = parseTask(get(db, "SELECT * FROM tasks WHERE id = ?", [recoveryTaskId]));
  if (existing) {
    if (existing.status !== "completed") {
      throw new Error(`Existing local recovery ${recoveryTaskId} is ${existing.status}; review it before another attempt.`);
    }
    reopenJourneyForRecoveredTask(db, source, existing);
    const projection = projectCompletedProductionTask(db, existing.id);
    return { recovered: true, existing: true, source, task: existing, projection };
  }
  const production = productionMetadata(source.sourceTask);
  let reviewCapacityExhausted = false;
  if (production.planId) {
    try {
      assertQualityReviewRecheckAvailable(
        db,
        production.planId,
        Number(production.revisionNumber || 0),
      );
    } catch (error) {
      if (
        options.prepareUnreviewedCorrection === true
        && /stopped before creating another quality review/i.test(String(error.message || ""))
      ) {
        reviewCapacityExhausted = true;
      } else {
        throw error;
      }
    }
  }

  const recoveryTask = buildRecoveryTask(source, identity, rendererRevision);
  const attemptId = `attempt_local_recovery_${identity}`;
  const startedAt = now();
  insertRecoveryTask(db, recoveryTask, attemptId, startedAt);
  insertEvent(db, {
    actor: "jarvis",
    type: "product_builder.retained_output_recovery_started",
    entityType: "task",
    entityId: recoveryTask.id,
    message: "Jarvis started a zero-spend local recovery of an exact retained Product Builder provider result.",
    metadata: {
      ...recoveryTask.payload.recovery,
      recoveryTaskId: recoveryTask.id,
      recoveryAttemptId: attemptId,
    },
  });

  try {
    const rendered = await renderRetainedProductBuilderOutput(
      db,
      recoveryTask,
      source.retainedOutput,
      {
        sourceTaskId: source.sourceTask.id,
        sourceRunId: source.sourceRun.id,
        sourceAttemptId: source.sourceAttempt.id,
        sourceModelCallId: source.sourceModelCall.id,
        sourceProviderRequestId: source.providerReceipt.providerRequestId,
        sourceOutputHash: source.sourceOutputHash,
        artifactRoot: options.artifactRoot,
      },
    );
    const completedAt = now();
    let result = localRecoveryResult(source, recoveryTask, rendered);
    run(
      db,
      `UPDATE tasks
       SET status = 'completed', result = ?, error = NULL, outcome_status = 'known',
           completed_at = ?, updated_at = ?
       WHERE id = ? AND status = 'running'`,
      [toJson(result), completedAt, completedAt, recoveryTask.id],
    );
    run(
      db,
      `UPDATE task_attempts
       SET status = 'completed', outcome_status = 'known', completed_at = ?,
           metadata = ?
       WHERE id = ? AND status = 'running'`,
      [
        completedAt,
        toJson({
          schema: RETAINED_OUTPUT_RECOVERY_SCHEMA,
          noProviderCall: true,
          localResultRecovered: true,
          sourceTaskId: source.sourceTask.id,
          sourceRunId: source.sourceRun.id,
          sourceAttemptId: source.sourceAttempt.id,
          sourceModelCallId: source.sourceModelCall.id,
          sourceProviderRequestId: source.providerReceipt.providerRequestId,
          sourceOutputHash: source.sourceOutputHash,
          generatedFileIds: rendered.generatedFiles.files.map((file) => file.id),
          previewIds: rendered.generatedFiles.previews.map((preview) => preview.id),
        }),
        attemptId,
      ],
    );
    const receipt = finalizeAgentExecutionReceipt(db, { attemptId });
    if (receipt.status !== "complete") {
      throw new Error(`Local recovery receipt is ${receipt.status}: ${(receipt.missing_fields || []).join(", ") || "review required"}.`);
    }
    result = localRecoveryResult(source, recoveryTask, rendered, receipt.id);
    run(
      db,
      "UPDATE tasks SET result = ?, updated_at = ? WHERE id = ?",
      [toJson(result), now(), recoveryTask.id],
    );
    const completedTask = parseTask(get(db, "SELECT * FROM tasks WHERE id = ?", [recoveryTask.id]));
    if (reviewCapacityExhausted) {
      const plan = get(db, "SELECT metadata FROM catalogue_plans WHERE id = ?", [production.planId]);
      const planMetadata = fromJson(plan?.metadata, {});
      const generatedFiles = rendered.generatedFiles;
      const bundle = generatedFiles.files.find((file) => /\.zip$/i.test(file.humanName));
      supersedePriorRecoveryDeliverables(db, source, completedTask);
      run(
        db,
        `UPDATE catalogue_plans
         SET status = 'needs_attention', metadata = ?, updated_at = ?
         WHERE id = ?`,
        [
          toJson({
            ...planMetadata,
            productManifest: generatedFiles.manifest,
            generatedFileIds: generatedFiles.files.map((file) => file.id),
            storefrontPreviewIds: generatedFiles.previews.map((preview) => preview.id),
            qualityReviewImageIds: (generatedFiles.qualityReviewImages || []).map((image) => image.id),
            productBundleDeliverableId: bundle?.id || null,
            buildStatus: "local_correction_waiting_for_explicit_review",
            qualityReviewLimitReached: true,
            unreviewedCorrectionTaskId: completedTask.id,
            unreviewedCorrectionPreparedAt: now(),
          }),
          now(),
          production.planId,
        ],
      );
      result.output.localRecovery = {
        ...(result.output.localRecovery || {}),
        qualityReviewLimitReached: true,
        noFurtherPaidReviewPrepared: true,
      };
      result.raw.qualityReviewLimitReached = true;
      result.raw.projectionSkipped = true;
      run(
        db,
        "UPDATE tasks SET result = ?, updated_at = ? WHERE id = ?",
        [toJson(result), now(), completedTask.id],
      );
      insertEvent(db, {
        actor: "jarvis",
        type: "catalogue.local_correction_stopped_at_review_limit",
        entityType: "catalogue_plan",
        entityId: production.planId,
        message: "Jarvis retained the corrected local package but stopped at the review limit. No further paid review was prepared.",
        metadata: {
          recoveryTaskId: completedTask.id,
          generatedFileIds: generatedFiles.files.map((file) => file.id),
          previewIds: generatedFiles.previews.map((preview) => preview.id),
          qualityReviewImageIds: (generatedFiles.qualityReviewImages || []).map((image) => image.id),
          noProviderCall: true,
          reviewCapacityExhausted: true,
        },
      });
      return {
        recovered: true,
        existing: false,
        source,
        task: parseTask(get(db, "SELECT * FROM tasks WHERE id = ?", [completedTask.id])),
        receipt,
        generatedFiles,
        projection: {
          projected: false,
          reason: "review_limit_reached",
          noFurtherPaidReviewPrepared: true,
        },
      };
    }
    const projection = withRecoverySavepoint(db, identity, () => {
      reopenJourneyForRecoveredTask(db, source, completedTask);
      const projected = projectCompletedProductionTask(db, completedTask.id);
      supersedePriorRecoveryDeliverables(db, source, completedTask);
      return projected;
    });
    insertEvent(db, {
      actor: "jarvis",
      type: "product_builder.retained_output_recovered",
      entityType: "task",
      entityId: completedTask.id,
      message: "Pantheon rendered and projected the exact retained Product Builder output without another provider call.",
      metadata: {
        ...completedTask.payload.recovery,
        receiptId: receipt.id,
        generatedFileIds: rendered.generatedFiles.files.map((file) => file.id),
        previewIds: rendered.generatedFiles.previews.map((preview) => preview.id),
        projected: projection.projected === true,
      },
    });
    return {
      recovered: true,
      existing: false,
      source,
      task: completedTask,
      receipt,
      generatedFiles: rendered.generatedFiles,
      projection,
    };
  } catch (error) {
    const failedAt = now();
    run(
      db,
      `UPDATE deliverables
       SET status = 'superseded', updated_at = ?
       WHERE task_id = ? AND status <> 'superseded'`,
      [failedAt, recoveryTask.id],
    );
    run(
      db,
      `UPDATE tasks
       SET status = 'failed', result = ?, error = ?, outcome_status = 'failed_before_effect',
           completed_at = ?, updated_at = ?
       WHERE id = ?`,
      [toJson({ error: error.message, noProviderCall: true }), error.message, failedAt, failedAt, recoveryTask.id],
    );
    run(
      db,
      `UPDATE task_attempts
       SET status = 'failed', outcome_status = 'failed_before_effect',
           error_kind = 'local_recovery_failed', error = ?, completed_at = ?
       WHERE id = ?`,
      [error.message, failedAt, attemptId],
    );
    try {
      finalizeAgentExecutionReceipt(db, { attemptId });
    } catch {
      // The original paid attempt remains intact even if the local repair receipt needs manual inspection.
    }
    insertEvent(db, {
      level: "error",
      actor: "jarvis",
      type: "product_builder.retained_output_recovery_failed",
      entityType: "task",
      entityId: recoveryTask.id,
      message: `Pantheon could not recover the retained Product Builder output: ${error.message}`,
      metadata: {
        ...recoveryTask.payload.recovery,
        noProviderCall: true,
      },
    });
    throw error;
  }
}

function buildCommercialRecoveryTask(source, recoveryId, evaluatorRevision) {
  const sourceRequest = source.sourceTask.payload.liveSpendRequest;
  return {
    id: `task_local_commercial_recovery_${recoveryId}`,
    workflow_id: source.sourceTask.workflow_id,
    venture_id: source.sourceTask.venture_id,
    title: `Recover accepted offer from ${source.sourceTask.title}`,
    kind: "local_commercial_output_recovery",
    agent: "jarvis",
    status: "running",
    priority: Number(source.sourceTask.priority || 1),
    retries: 0,
    max_retries: 0,
    approval_id: null,
    cost_budget_cents: 0,
    cost_actual_cents: 0,
    payload: {
      schema: "pantheon.local-commercial-output-recovery-task.v1",
      commandId: source.sourceTask.payload?.commandId || null,
      recovery: {
        schema: RETAINED_COMMERCIAL_OUTPUT_RECOVERY_SCHEMA,
        sourceTaskId: source.sourceTask.id,
        sourceRunId: source.sourceRun.id,
        sourceAttemptId: source.sourceAttempt.id,
        sourceModelCallId: source.sourceModelCall.id,
        sourceProviderRequestId: source.providerReceipt.providerRequestId,
        sourceOutputHash: source.sourceOutputHash,
        evaluatorRevision,
        noNewProviderCall: true,
        reason: "A tested local evaluator correction now accepts the exact unchanged retained offer.",
      },
      liveSpendRequest: {
        schema: "pantheon.local-recovery-execution.v1",
        provider: "pantheon-local-runtime",
        model: sourceRequest.model,
        maxCostCents: 0,
        tools: [],
        effects: [],
        parameters: sourceRequest.parameters,
      },
    },
  };
}

function localCommercialRecoveryResult(source, recoveryTask, evaluation, receiptId = null) {
  return {
    id: `local_commercial_recovery_${commercialRecoveryIdentity(
      source.sourceTask.id,
      source.sourceOutputHash,
      recoveryTask.payload.recovery.evaluatorRevision,
    )}`,
    mode: "pantheon-local-runtime",
    provider: "pantheon-local-runtime",
    model: source.sourceTask.payload.liveSpendRequest.model,
    status: "completed",
    actualCents: 0,
    incurredEstimateCents: 0,
    reconciledCostCents: 0,
    costStatus: "none",
    exactBillingPending: false,
    output: source.retainedOutput,
    localRecovery: {
      ...recoveryTask.payload.recovery,
      evaluationId: evaluation.id,
      evaluationScore: evaluation.score,
      receiptId,
    },
    raw: {
      schema: RETAINED_COMMERCIAL_OUTPUT_RECOVERY_SCHEMA,
      noNewProviderCall: true,
      providerCallOccurred: false,
      sourceProviderReceipt: source.providerReceipt,
      sourceTaskId: source.sourceTask.id,
      sourceRunId: source.sourceRun.id,
      sourceAttemptId: source.sourceAttempt.id,
      sourceModelCallId: source.sourceModelCall.id,
      sourceOutputHash: source.sourceOutputHash,
    },
  };
}

function closeSupersededOfferAttempts(db, source, recoveryTask) {
  const parameters = recoveryTask.payload.liveSpendRequest.parameters || {};
  const roundId = parameters.pantheonCommercial?.roundId || null;
  const staleTasks = all(
    db,
    `SELECT * FROM tasks
     WHERE workflow_id = ?
       AND kind = 'live_ai_worker_execution'
       AND agent = 'offer_architect'
       AND status = 'needs_attention'
       AND json_extract(payload, '$.liveSpendRequest.parameters.pantheonCommercial.roundId') = ?
       AND json_extract(payload, '$.liveSpendRequest.parameters.pantheonCommercial.step') = 'offer_architecture'
     ORDER BY created_at, id`,
    [recoveryTask.workflow_id, roundId],
  ).map(parseTask);
  const closedAt = now();
  for (const staleTask of staleTasks) {
    run(
      db,
      `UPDATE tasks
       SET status = 'failed', result = ?, updated_at = ?
       WHERE id = ? AND status = 'needs_attention'`,
      [
        toJson({
          ...staleTask.result,
          localRecoverySupersededByTaskId: recoveryTask.id,
          localRecoverySupersededAt: closedAt,
        }),
        closedAt,
        staleTask.id,
      ],
    );
    run(
      db,
      `UPDATE messages SET status = 'resolved', resolved_at = COALESCE(resolved_at, ?)
       WHERE task_id = ? AND status = 'open'`,
      [closedAt, staleTask.id],
    );
  }
  if (staleTasks.length) {
    insertEvent(db, {
      actor: "jarvis",
      type: "offer_architect.failed_attempts_superseded_by_recovery",
      entityType: "task",
      entityId: recoveryTask.id,
      message: "The rejected offer attempts remain in history but no longer compete with the recovered build decision.",
      metadata: {
        recoveryTaskId: recoveryTask.id,
        sourceTaskId: source.sourceTask.id,
        supersededTaskIds: staleTasks.map((task) => task.id),
      },
    });
  }
  return staleTasks.map((task) => task.id);
}

function reopenJourneyForRecoveredOffer(db, source, recoveryTask) {
  const parameters = recoveryTask.payload.liveSpendRequest.parameters || {};
  const commercial = parameters.pantheonCommercial || {};
  const journeyId = parameters.pantheonJourney?.journeyId || null;
  const round = commercial.roundId
    ? get(db, "SELECT * FROM opportunity_rounds WHERE id = ?", [commercial.roundId])
    : null;
  if (!round) throw new Error("The retained offer is missing its exact opportunity round.");
  const roundMetadata = fromJson(round.metadata, {});
  const supersededTaskIds = closeSupersededOfferAttempts(db, source, recoveryTask);
  const ts = now();
  run(
    db,
    `UPDATE opportunity_rounds
     SET status = 'structuring_offer', completed_at = NULL, metadata = ?, updated_at = ?
     WHERE id = ? AND status IN ('stopped_after_correction', 'structuring_offer')`,
    [
      toJson({
        ...roundMetadata,
        currentTaskId: recoveryTask.id,
        recoveredSourceTaskId: source.sourceTask.id,
        recoveredSourceRunId: source.sourceRun.id,
        recoveredSourceOutputHash: source.sourceOutputHash,
        recoverySupersededTaskIds: [
          ...new Set([...(roundMetadata.recoverySupersededTaskIds || []), ...supersededTaskIds]),
        ],
      }),
      ts,
      round.id,
    ],
  );
  run(
    db,
    `UPDATE workflows
     SET status = 'agent_running', current_step = 'Retained offer passed the corrected local review',
         approval_required = 0, updated_at = ?
     WHERE id = ? AND status IN ('failed', 'agent_running', 'ready', 'needs_attention')`,
    [ts, recoveryTask.workflow_id],
  );
  run(
    db,
    `UPDATE commands SET status = 'running', updated_at = ?
     WHERE workflow_id = ? AND status IN ('failed', 'needs_attention', 'needs_changes', 'running')`,
    [ts, recoveryTask.workflow_id],
  );
  run(
    db,
    `UPDATE messages SET status = 'resolved', resolved_at = COALESCE(resolved_at, ?)
     WHERE task_id = ? AND status = 'open'`,
    [ts, source.sourceTask.id],
  );
  if (journeyId) {
    const journey = get(db, "SELECT * FROM pantheon_journeys WHERE id = ?", [journeyId]);
    if (!journey) throw new Error(`Pantheon journey not found: ${journeyId}`);
    if (!["stopped_after_correction", "running", "needs_attention", "waiting_for_operator"].includes(journey.status)) {
      throw new Error(`The retained offer journey is ${journey.status}; local recovery cannot change it.`);
    }
    if (journey.status === "stopped_after_correction") {
      updateJourney(db, journeyId, {
        allowTerminalRecovery: true,
        status: "running",
        activeStage: "offer_architecture",
        completedAt: null,
        metadata: {
          currentTaskId: recoveryTask.id,
          currentApprovalId: null,
          blocker: null,
          correctionLimitReached: false,
          recoveredSourceTaskId: source.sourceTask.id,
          recoveredSourceRunId: source.sourceRun.id,
          recoveredSourceOutputHash: source.sourceOutputHash,
        },
        stageEvent: {
          stage: "offer_architecture",
          status: "recovered_without_provider_call",
          taskId: recoveryTask.id,
          workerId: "jarvis",
          note: "Jarvis applied the tested evaluator correction to the exact retained offer. No new AI call or external action occurred.",
        },
      });
    }
  }
}

function recoverRetainedOfferArchitectResult(db, sourceTaskId, options = {}) {
  const source = exactRetainedOfferArchitectSource(db, sourceTaskId, options);
  const evaluatorRevision = String(
    options.evaluatorRevision || OFFER_EVALUATOR_RECOVERY_REVISION,
  );
  const identity = commercialRecoveryIdentity(
    source.sourceTask.id,
    source.sourceOutputHash,
    evaluatorRevision,
  );
  const recoveryTaskId = `task_local_commercial_recovery_${identity}`;
  const existing = parseTask(get(db, "SELECT * FROM tasks WHERE id = ?", [recoveryTaskId]));
  if (existing) {
    if (existing.status !== "completed") {
      throw new Error(`Existing local commercial recovery ${recoveryTaskId} is ${existing.status}; review it before another attempt.`);
    }
    reopenJourneyForRecoveredOffer(db, source, existing);
    const projection = projectCompletedCommercialTask(db, existing.id);
    return { recovered: true, existing: true, source, task: existing, projection };
  }

  const recoveryTask = buildCommercialRecoveryTask(source, identity, evaluatorRevision);
  const attemptId = `attempt_local_commercial_recovery_${identity}`;
  const startedAt = now();
  insertRecoveryTask(db, recoveryTask, attemptId, startedAt);
  let recoveryAgentRun = null;
  insertEvent(db, {
    actor: "jarvis",
    type: "offer_architect.retained_output_recovery_started",
    entityType: "task",
    entityId: recoveryTask.id,
    message: "Jarvis started a zero-spend local re-evaluation of an exact retained Offer Architect result.",
    metadata: {
      ...recoveryTask.payload.recovery,
      recoveryTaskId: recoveryTask.id,
      recoveryAttemptId: attemptId,
    },
  });

  try {
    const definition = findAgentDefinition(db, source.sourceTask);
    recoveryAgentRun = createAgentRun(db, definition, recoveryTask, {
      mode: "local-recovery",
      inputSummary: "Re-evaluate the exact retained Offer Architect output after a tested deterministic checker correction.",
      approvalRequired: false,
      attemptId,
    });
    addAgentTrace(
      db,
      recoveryAgentRun.id,
      "retained_output_bound",
      "Exact retained output bound",
      "Pantheon bound the original provider receipt and output hash before local re-evaluation.",
      recoveryTask.payload.recovery,
    );
    const evaluation = evaluateAgentOutput(
      db,
      definition,
      recoveryAgentRun,
      recoveryTask,
      source.retainedOutput,
      {
        attemptId,
        requiresApproval: true,
        deliverables: [],
        research: null,
      },
    );
    if (evaluation.status !== "passed") {
      throw new Error(
        `The exact retained offer still scores ${evaluation.score}/100 (${evaluation.status}): ${evaluation.findings.join(" ")}`,
      );
    }
    finishAgentRun(db, recoveryAgentRun.id, {
      status: "completed",
      outputSummary: source.retainedOutput.summary,
      modelCallId: null,
      estimatedCostCents: 0,
      actualCostCents: 0,
      approvalRequired: false,
      evalStatus: evaluation.status,
      metadata: {
        schema: RETAINED_COMMERCIAL_OUTPUT_RECOVERY_SCHEMA,
        noProviderCall: true,
        sourceTaskId: source.sourceTask.id,
        sourceRunId: source.sourceRun.id,
        sourceAttemptId: source.sourceAttempt.id,
        sourceModelCallId: source.sourceModelCall.id,
        sourceOutputHash: source.sourceOutputHash,
        evaluatorRevision,
        evaluationId: evaluation.id,
        evaluationScore: evaluation.score,
      },
    });
    const completedAt = now();
    let result = localCommercialRecoveryResult(source, recoveryTask, evaluation);
    run(
      db,
      `UPDATE tasks
       SET status = 'completed', result = ?, error = NULL, outcome_status = 'known',
           completed_at = ?, updated_at = ?
       WHERE id = ? AND status = 'running'`,
      [toJson(result), completedAt, completedAt, recoveryTask.id],
    );
    run(
      db,
      `UPDATE task_attempts
       SET status = 'completed', outcome_status = 'known', completed_at = ?, metadata = ?
       WHERE id = ? AND status = 'running'`,
      [
        completedAt,
        toJson({
          schema: RETAINED_COMMERCIAL_OUTPUT_RECOVERY_SCHEMA,
          noProviderCall: true,
          localResultRecovered: true,
          sourceTaskId: source.sourceTask.id,
          sourceRunId: source.sourceRun.id,
          sourceAttemptId: source.sourceAttempt.id,
          sourceModelCallId: source.sourceModelCall.id,
          sourceProviderRequestId: source.providerReceipt.providerRequestId,
          sourceOutputHash: source.sourceOutputHash,
          evaluatorRevision,
          evaluationId: evaluation.id,
        }),
        attemptId,
      ],
    );
    const receipt = finalizeAgentExecutionReceipt(db, { attemptId });
    if (receipt.status !== "complete") {
      throw new Error(`Local commercial recovery receipt is ${receipt.status}: ${(receipt.missing_fields || []).join(", ") || "review required"}.`);
    }
    result = localCommercialRecoveryResult(source, recoveryTask, evaluation, receipt.id);
    run(
      db,
      "UPDATE tasks SET result = ?, updated_at = ? WHERE id = ?",
      [toJson(result), now(), recoveryTask.id],
    );
    const completedTask = parseTask(get(db, "SELECT * FROM tasks WHERE id = ?", [recoveryTask.id]));
    reopenJourneyForRecoveredOffer(db, source, completedTask);
    const projection = projectCompletedCommercialTask(db, completedTask.id);
    insertEvent(db, {
      actor: "jarvis",
      type: "offer_architect.retained_output_recovered",
      entityType: "task",
      entityId: completedTask.id,
      message: "Pantheon accepted and projected the exact retained Offer Architect output without another provider call.",
      metadata: {
        ...completedTask.payload.recovery,
        receiptId: receipt.id,
        projected: projection.projected === true,
      },
    });
    return {
      recovered: true,
      existing: false,
      source,
      task: completedTask,
      receipt,
      evaluation,
      projection,
    };
  } catch (error) {
    const failedAt = now();
    const currentAgentRun = recoveryAgentRun
      ? get(db, "SELECT status FROM agent_runs WHERE id = ?", [recoveryAgentRun.id])
      : null;
    if (recoveryAgentRun && currentAgentRun?.status === "running") {
      finishAgentRun(db, recoveryAgentRun.id, {
        status: "failed",
        outputSummary: error.message,
        estimatedCostCents: 0,
        actualCostCents: 0,
        approvalRequired: false,
        evalStatus: "failed",
        metadata: { noProviderCall: true, error: error.message },
      });
    }
    run(
      db,
      `UPDATE tasks
       SET status = 'failed', result = ?, error = ?, outcome_status = 'failed_before_effect',
           completed_at = ?, updated_at = ?
       WHERE id = ?`,
      [toJson({ error: error.message, noProviderCall: true }), error.message, failedAt, failedAt, recoveryTask.id],
    );
    run(
      db,
      `UPDATE task_attempts
       SET status = 'failed', outcome_status = 'failed_before_effect',
           error_kind = 'local_recovery_failed', error = ?, completed_at = ?
       WHERE id = ?`,
      [error.message, failedAt, attemptId],
    );
    try {
      finalizeAgentExecutionReceipt(db, { attemptId });
    } catch {
      // The original paid attempt remains intact if the local recovery receipt also needs review.
    }
    insertEvent(db, {
      level: "error",
      actor: "jarvis",
      type: "offer_architect.retained_output_recovery_failed",
      entityType: "task",
      entityId: recoveryTask.id,
      message: `Pantheon could not recover the retained Offer Architect output: ${error.message}`,
      metadata: { ...recoveryTask.payload.recovery, noProviderCall: true },
    });
    throw error;
  }
}

function buildProductionEvaluationRecoveryTask(source, recoveryId, evaluatorRevision) {
  const sourceRequest = source.sourceTask.payload.liveSpendRequest;
  return {
    id: `task_local_production_recovery_${recoveryId}`,
    workflow_id: source.sourceTask.workflow_id,
    venture_id: source.sourceTask.venture_id,
    title: `Recover accepted result from ${source.sourceTask.title}`,
    kind: "local_production_output_recovery",
    agent: "jarvis",
    status: "running",
    priority: Number(source.sourceTask.priority || 1),
    retries: 0,
    max_retries: 0,
    approval_id: null,
    cost_budget_cents: 0,
    cost_actual_cents: 0,
    payload: {
      schema: "pantheon.local-production-output-recovery-task.v1",
      commandId: source.sourceTask.payload?.commandId || null,
      recovery: {
        schema: RETAINED_PRODUCTION_OUTPUT_RECOVERY_SCHEMA,
        sourceTaskId: source.sourceTask.id,
        sourceRunId: source.sourceRun.id,
        sourceAttemptId: source.sourceAttempt.id,
        sourceModelCallId: source.sourceModelCall.id,
        sourceProviderRequestId: source.providerReceipt.providerRequestId,
        sourceOutputHash: source.sourceOutputHash,
        evaluatorRevision,
        noNewProviderCall: true,
        reason: "A tested local evaluator correction now accepts the exact unchanged retained production result.",
      },
      liveSpendRequest: {
        schema: "pantheon.local-recovery-execution.v1",
        provider: "pantheon-local-runtime",
        model: sourceRequest.model,
        maxCostCents: 0,
        tools: [],
        effects: [],
        parameters: sourceRequest.parameters,
      },
    },
  };
}

function localProductionRecoveryResult(source, recoveryTask, evaluation, receiptId = null) {
  return {
    id: `local_production_recovery_${productionRecoveryIdentity(
      source.sourceTask.id,
      source.sourceOutputHash,
      recoveryTask.payload.recovery.evaluatorRevision,
    )}`,
    mode: "pantheon-local-runtime",
    provider: "pantheon-local-runtime",
    model: source.sourceTask.payload.liveSpendRequest.model,
    status: "completed",
    actualCents: 0,
    incurredEstimateCents: 0,
    reconciledCostCents: 0,
    costStatus: "none",
    exactBillingPending: false,
    output: source.retainedOutput,
    localRecovery: {
      ...recoveryTask.payload.recovery,
      evaluationId: evaluation.id,
      evaluationScore: evaluation.score,
      receiptId,
    },
    raw: {
      schema: RETAINED_PRODUCTION_OUTPUT_RECOVERY_SCHEMA,
      noNewProviderCall: true,
      providerCallOccurred: false,
      sourceProviderReceipt: source.providerReceipt,
      sourceTaskId: source.sourceTask.id,
      sourceRunId: source.sourceRun.id,
      sourceAttemptId: source.sourceAttempt.id,
      sourceModelCallId: source.sourceModelCall.id,
      sourceOutputHash: source.sourceOutputHash,
    },
  };
}

function reopenJourneyForRecoveredProduction(db, source, recoveryTask) {
  const parameters = recoveryTask.payload.liveSpendRequest.parameters || {};
  const production = parameters.pantheonProduction || {};
  const journeyId = production.journeyId || parameters.pantheonJourney?.journeyId || null;
  const ts = now();
  closeRecoveredSourceTask(db, source, recoveryTask);
  run(
    db,
    `UPDATE workflows
     SET status = 'agent_running', current_step = 'Retained production result passed the corrected local review',
         approval_required = 0, updated_at = ?
     WHERE id = ? AND status IN ('failed', 'agent_running', 'ready', 'needs_attention')`,
    [ts, recoveryTask.workflow_id],
  );
  run(
    db,
    `UPDATE commands SET status = 'running', updated_at = ?
     WHERE workflow_id = ? AND status IN ('failed', 'needs_attention', 'needs_changes', 'running')`,
    [ts, recoveryTask.workflow_id],
  );
  run(
    db,
    `UPDATE messages SET status = 'resolved', resolved_at = COALESCE(resolved_at, ?)
     WHERE task_id = ? AND status = 'open'`,
    [ts, source.sourceTask.id],
  );
  if (!journeyId) return null;
  const journey = get(db, "SELECT * FROM pantheon_journeys WHERE id = ?", [journeyId]);
  if (!journey) throw new Error(`Pantheon journey not found: ${journeyId}`);
  if (!["stopped_after_correction", "running", "needs_attention", "waiting_for_operator"].includes(journey.status)) {
    throw new Error(`The retained production journey is ${journey.status}; local recovery cannot change it.`);
  }
  return updateJourney(db, journeyId, {
    allowTerminalRecovery: journey.status === "stopped_after_correction",
    status: "running",
    activeStage: production.stage,
    completedAt: null,
    metadata: {
      currentTaskId: recoveryTask.id,
      currentApprovalId: null,
      blocker: null,
      correctionLimitReached: false,
      recoveredSourceTaskId: source.sourceTask.id,
      recoveredSourceRunId: source.sourceRun.id,
      recoveredSourceOutputHash: source.sourceOutputHash,
    },
    stageEvent: {
      stage: production.stage,
      status: "recovered_without_provider_call",
      taskId: recoveryTask.id,
      workerId: "jarvis",
      note: "Jarvis applied the tested evaluator correction to the exact retained production result. No new AI call or external action occurred.",
    },
  });
}

function recoverRetainedProductionWorkerResult(db, sourceTaskId, options = {}) {
  const source = exactRetainedProductionWorkerSource(db, sourceTaskId, options);
  const evaluatorRevision = String(options.evaluatorRevision || "production-evaluator-recovery-v1");
  const identity = productionRecoveryIdentity(
    source.sourceTask.id,
    source.sourceOutputHash,
    evaluatorRevision,
  );
  const recoveryTaskId = `task_local_production_recovery_${identity}`;
  const existing = parseTask(get(db, "SELECT * FROM tasks WHERE id = ?", [recoveryTaskId]));
  if (existing) {
    if (existing.status !== "completed") {
      throw new Error(`Existing local production recovery ${recoveryTaskId} is ${existing.status}; review it before another attempt.`);
    }
    reopenJourneyForRecoveredProduction(db, source, existing);
    const projection = projectCompletedProductionTask(db, existing.id);
    return { recovered: true, existing: true, source, task: existing, projection };
  }

  const recoveryTask = buildProductionEvaluationRecoveryTask(source, identity, evaluatorRevision);
  const attemptId = `attempt_local_production_recovery_${identity}`;
  const startedAt = now();
  insertRecoveryTask(db, recoveryTask, attemptId, startedAt);
  let recoveryAgentRun = null;
  insertEvent(db, {
    actor: "jarvis",
    type: "production.retained_output_recovery_started",
    entityType: "task",
    entityId: recoveryTask.id,
    message: "Jarvis started a zero-spend local re-evaluation of an exact retained production result.",
    metadata: {
      ...recoveryTask.payload.recovery,
      recoveryTaskId: recoveryTask.id,
      recoveryAttemptId: attemptId,
      stage: source.production.stage,
    },
  });

  try {
    const definition = findAgentDefinition(db, source.sourceTask);
    recoveryAgentRun = createAgentRun(db, definition, recoveryTask, {
      mode: "local-recovery",
      inputSummary: "Re-evaluate the exact retained production output after a tested deterministic checker correction.",
      approvalRequired: false,
      attemptId,
    });
    addAgentTrace(
      db,
      recoveryAgentRun.id,
      "retained_output_bound",
      "Exact retained output bound",
      "Pantheon bound the original provider receipt and output hash before local re-evaluation.",
      recoveryTask.payload.recovery,
    );
    const evaluation = evaluateAgentOutput(
      db,
      definition,
      recoveryAgentRun,
      recoveryTask,
      source.retainedOutput,
      {
        attemptId,
        requiresApproval: true,
        deliverables: [],
        research: null,
      },
    );
    if (evaluation.status !== "passed") {
      throw new Error(
        `The exact retained production result still scores ${evaluation.score}/100 `
        + `(${evaluation.status}): ${evaluation.findings.join(" ")}`,
      );
    }
    finishAgentRun(db, recoveryAgentRun.id, {
      status: "completed",
      outputSummary: source.retainedOutput.summary,
      modelCallId: null,
      estimatedCostCents: 0,
      actualCostCents: 0,
      approvalRequired: false,
      evalStatus: evaluation.status,
      metadata: {
        schema: RETAINED_PRODUCTION_OUTPUT_RECOVERY_SCHEMA,
        noProviderCall: true,
        sourceTaskId: source.sourceTask.id,
        sourceRunId: source.sourceRun.id,
        sourceAttemptId: source.sourceAttempt.id,
        sourceModelCallId: source.sourceModelCall.id,
        sourceOutputHash: source.sourceOutputHash,
        evaluatorRevision,
        evaluationId: evaluation.id,
        evaluationScore: evaluation.score,
      },
    });
    const completedAt = now();
    let result = localProductionRecoveryResult(source, recoveryTask, evaluation);
    run(
      db,
      `UPDATE tasks
       SET status = 'completed', result = ?, error = NULL, outcome_status = 'known',
           completed_at = ?, updated_at = ?
       WHERE id = ? AND status = 'running'`,
      [toJson(result), completedAt, completedAt, recoveryTask.id],
    );
    run(
      db,
      `UPDATE task_attempts
       SET status = 'completed', outcome_status = 'known', completed_at = ?, metadata = ?
       WHERE id = ? AND status = 'running'`,
      [
        completedAt,
        toJson({
          schema: RETAINED_PRODUCTION_OUTPUT_RECOVERY_SCHEMA,
          noProviderCall: true,
          localResultRecovered: true,
          sourceTaskId: source.sourceTask.id,
          sourceRunId: source.sourceRun.id,
          sourceAttemptId: source.sourceAttempt.id,
          sourceModelCallId: source.sourceModelCall.id,
          sourceProviderRequestId: source.providerReceipt.providerRequestId,
          sourceOutputHash: source.sourceOutputHash,
          evaluatorRevision,
          evaluationId: evaluation.id,
        }),
        attemptId,
      ],
    );
    const receipt = finalizeAgentExecutionReceipt(db, { attemptId });
    if (receipt.status !== "complete") {
      throw new Error(`Local production recovery receipt is ${receipt.status}: ${(receipt.missing_fields || []).join(", ") || "review required"}.`);
    }
    result = localProductionRecoveryResult(source, recoveryTask, evaluation, receipt.id);
    run(
      db,
      "UPDATE tasks SET result = ?, updated_at = ? WHERE id = ?",
      [toJson(result), now(), recoveryTask.id],
    );
    const completedTask = parseTask(get(db, "SELECT * FROM tasks WHERE id = ?", [recoveryTask.id]));
    reopenJourneyForRecoveredProduction(db, source, completedTask);
    const projection = projectCompletedProductionTask(db, completedTask.id);
    insertEvent(db, {
      actor: "jarvis",
      type: "production.retained_output_recovered",
      entityType: "task",
      entityId: completedTask.id,
      message: "Pantheon accepted and projected the exact retained production result without another provider call.",
      metadata: {
        ...completedTask.payload.recovery,
        receiptId: receipt.id,
        stage: source.production.stage,
        projected: projection.projected === true,
      },
    });
    return {
      recovered: true,
      existing: false,
      source,
      task: completedTask,
      receipt,
      evaluation,
      projection,
    };
  } catch (error) {
    const failedAt = now();
    const currentAgentRun = recoveryAgentRun
      ? get(db, "SELECT status FROM agent_runs WHERE id = ?", [recoveryAgentRun.id])
      : null;
    if (recoveryAgentRun && currentAgentRun?.status === "running") {
      finishAgentRun(db, recoveryAgentRun.id, {
        status: "failed",
        outputSummary: error.message,
        estimatedCostCents: 0,
        actualCostCents: 0,
        approvalRequired: false,
        evalStatus: "failed",
        metadata: { noProviderCall: true, error: error.message },
      });
    }
    run(
      db,
      `UPDATE tasks
       SET status = 'failed', result = ?, error = ?, outcome_status = 'failed_before_effect',
           completed_at = ?, updated_at = ?
       WHERE id = ?`,
      [toJson({ error: error.message, noProviderCall: true }), error.message, failedAt, failedAt, recoveryTask.id],
    );
    run(
      db,
      `UPDATE task_attempts
       SET status = 'failed', outcome_status = 'failed_before_effect',
           error_kind = 'local_recovery_failed', error = ?, completed_at = ?
       WHERE id = ?`,
      [error.message, failedAt, attemptId],
    );
    try {
      finalizeAgentExecutionReceipt(db, { attemptId });
    } catch {
      // The original paid attempt remains intact if the local recovery receipt also needs review.
    }
    insertEvent(db, {
      level: "error",
      actor: "jarvis",
      type: "production.retained_output_recovery_failed",
      entityType: "task",
      entityId: recoveryTask.id,
      message: `Pantheon could not recover the retained production output: ${error.message}`,
      metadata: {
        ...recoveryTask.payload.recovery,
        stage: source.production.stage,
        noProviderCall: true,
      },
    });
    throw error;
  }
}

function reopenJourneyAfterStageRetryAccountingRepair(db, journeyId) {
  const journey = get(db, "SELECT * FROM pantheon_journeys WHERE id = ?", [journeyId]);
  if (!journey) throw new Error(`Pantheon journey not found: ${journeyId}`);
  if (journey.status !== "stopped_after_correction") {
    throw new Error("This repair applies only to a journey stopped after a miscounted correction.");
  }
  const journeyMetadata = fromJson(journey.metadata, {});
  const task = parseTask(get(db, "SELECT * FROM tasks WHERE id = ?", [journeyMetadata.currentTaskId]));
  if (!task) throw new Error("The stopped journey has no exact current task to review.");
  const parameters = task.payload?.liveSpendRequest?.parameters || {};
  const production = parameters.pantheonProduction || {};
  const retryNumber = Number(parameters.retry?.number || 0);
  const packageRevision = Number(production.revisionNumber || 0);
  const attempt = get(
    db,
    "SELECT * FROM task_attempts WHERE task_id = ? ORDER BY started_at DESC, id DESC LIMIT 1",
    [task.id],
  );
  const existingRetry = get(
    db,
    `SELECT id FROM tasks
     WHERE workflow_id = ?
       AND json_extract(payload, '$.liveSpendRequest.parameters.retry.priorTaskId') = ?
       AND status IN ('blocked', 'waiting_approval', 'queued', 'running', 'completed')
     LIMIT 1`,
    [task.workflow_id, task.id],
  );
  if (
    task.kind !== "live_ai_worker_execution"
    || task.status !== "needs_attention"
    || task.outcome_status !== "known_provider_result_needs_review"
    || production.stage === "product_build"
    || !production.stage
    || packageRevision < 1
    || retryNumber !== 0
    || !attempt
    || attempt.status !== "needs_attention"
    || attempt.outcome_status !== "known_provider_result_needs_review"
    || !canPrepareReviewedRetry(task, attempt.error_kind)
    || existingRetry
  ) {
    throw new Error("Pantheon cannot prove that a package revision was incorrectly counted as this worker stage's retry.");
  }

  const ts = now();
  run(
    db,
    `UPDATE opportunity_rounds
     SET status = 'building', completed_at = NULL, updated_at = ?
     WHERE id = ? AND status = 'stopped_after_correction'`,
    [ts, production.roundId],
  );
  run(
    db,
    `UPDATE workflows
     SET status = 'needs_attention', current_step = ?, approval_required = 0, updated_at = ?
     WHERE id = ? AND status = 'failed'`,
    [`${task.title} needs one corrected worker response`, ts, task.workflow_id],
  );
  run(
    db,
    `UPDATE commands SET status = 'needs_attention', updated_at = ?
     WHERE workflow_id = ? AND status = 'failed'`,
    [ts, task.workflow_id],
  );
  const repaired = updateJourney(db, journey.id, {
    allowTerminalRecovery: true,
    status: "needs_attention",
    activeStage: production.stage,
    completedAt: null,
    metadata: {
      currentTaskId: task.id,
      currentApprovalId: task.approval_id || null,
      blocker: task.error,
      correctionLimitReached: false,
      retryAccountingRepair: {
        taskId: task.id,
        stage: production.stage,
        packageRevision,
        workerRetryNumber: retryNumber,
        repairedAt: ts,
      },
    },
    stageEvent: {
      stage: production.stage,
      status: "retry_accounting_repaired",
      taskId: task.id,
      workerId: "jarvis",
      note: "Jarvis separated the product package revision from this worker stage's unused retry. No provider call occurred.",
    },
  });
  insertEvent(db, {
    actor: "jarvis",
    type: "pantheon.stage_retry_accounting_repaired",
    entityType: "pantheon_journey",
    entityId: journey.id,
    message: "Pantheon restored the exact failed worker stage after proving that a product revision had been miscounted as its retry.",
    metadata: {
      taskId: task.id,
      stage: production.stage,
      packageRevision,
      workerRetryNumber: retryNumber,
      noProviderCall: true,
    },
  });
  return { repaired: true, journey: repaired, task, attempt };
}

module.exports = {
  OFFER_EVALUATOR_RECOVERY_REVISION,
  RETAINED_OUTPUT_RECOVERY_SCHEMA,
  RETAINED_COMMERCIAL_OUTPUT_RECOVERY_SCHEMA,
  RETAINED_PRODUCTION_OUTPUT_RECOVERY_SCHEMA,
  exactRetainedProductionWorkerSource,
  exactRetainedOfferArchitectSource,
  exactRetainedSource,
  reopenJourneyAfterStageRetryAccountingRepair,
  recoverRetainedOfferArchitectResult,
  recoverRetainedProductBuilderResult,
  recoverRetainedProductionWorkerResult,
};
