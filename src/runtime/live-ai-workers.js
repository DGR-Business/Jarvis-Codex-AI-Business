const CONFIG = require("../config");
const { all, fromJson, get, insertEvent, now, randomId, run, toJson } = require("../db");
const { buildAgentContextSnapshot, persistAgentContextSnapshot } = require("./agent-context");
const { AI_TEAM_DEFINITIONS, ensureAiTeam } = require("./ai-team");
const { buildWorkerModelPacket } = require("./agent-model-contracts");
const { buildAgentsSdkCapabilityPlan, buildVisualAssetApprovalBinding } = require("./agent-sdk-capabilities");
const {
  buildAgentHarnessDescriptor,
  buildAgentTraceGroup,
} = require("./agent-harness");
const {
  canonicalWorkerApprovalPolicy,
  createExecutionDescriptor,
  scopeHash,
  validateApprovalScope,
  workerDefinitionHash,
} = require("./approval-scope");
const {
  estimateInputTokensUpperBound,
  worstCaseExecutionCostAud,
} = require("./model-pricing");
const {
  createModelRouteSignature,
  readModelRouteHistory,
  selectModelRoute,
} = require("./model-routing");
const { createCommandPlan } = require("./planner");
const { ensureSpendApproval } = require("./spend-gate");
const { spendCostId, stableIdSegment } = require("./stable-id");
const {
  canPrepareReviewedRetry,
} = require("./live-ai-retry-policy");
const { configuredEnvironmentName } = require("../adapters/pantheon-environment");
const {
  preflightCommercialWrite,
  requireExistingCommercialTaskBinding,
} = require("./commercial-prewrite-guard");

const MIN_LIVE_AI_WORKER_BUDGET_CENTS = 40;
const MAX_LIVE_AI_WORKER_BUDGET_CENTS = 5000;
const DEMAND_VALIDATOR_FIXTURE_CAPABILITY = "demand_validator.reasoning_on_supplied_evidence";
const SUPPLIED_EVIDENCE_CONTEXT_EXCEPTION = Object.freeze({
  schema: "pantheon.agent-context-exception.v1",
  id: "demand-validator-versioned-supplied-evidence",
  policyVersion: "2026-07-17.1",
});
// Earlier Chief assignment records keep their original schema so in-flight
// work remains resumable after the Pantheon rename.
const CHIEF_ASSIGNMENT_SCHEMAS = new Set([
  "pantheon.chief-specialist-assignment.v1",
  "jarvis.chief-specialist-assignment.v1",
]);
const SUPPLIED_EVIDENCE_EXPECTED_OUTPUT = "A structured recommendation with evidence, counterevidence, assumptions, price/channel hypothesis, smallest test, metric, stop rule, confidence and risks.";
const SUPPLIED_EVIDENCE_EXPECTED_METRIC = "Deterministic scope, source, structure and cost checks pass; Daniel separately judges commercial usefulness.";
const SUPPLIED_EVIDENCE_TRACE_PURPOSE = "Make the supplied fixture and structured recommendation reviewable in OpenAI traces while retaining the local audit record.";
const MAX_WORK_BRIEF_ASSET_PROMPT_CHARS = 12000;

function safeId(value) {
  return stableIdSegment(value, 72, "workflow");
}

function withSavepoint(db, prefix, operation) {
  const name = `${prefix}_${randomId().replace(/[^a-zA-Z0-9]/g, "")}`;
  db.exec(`SAVEPOINT ${name}`);
  try {
    const value = operation();
    db.exec(`RELEASE SAVEPOINT ${name}`);
    return value;
  } catch (error) {
    db.exec(`ROLLBACK TO SAVEPOINT ${name}`);
    db.exec(`RELEASE SAVEPOINT ${name}`);
    throw error;
  }
}

function hydrateTask(row) {
  if (!row) return null;
  return { ...row, payload: fromJson(row.payload), result: fromJson(row.result) };
}

function hydrateWorkflow(row) {
  if (!row) return null;
  return { ...row, metadata: fromJson(row.metadata) };
}

function normalizeBudgetCents(value) {
  const fallback = Number(CONFIG.liveModelDefaultBudgetCents || 100);
  const parsed = Number(value);
  const selected = Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  return Math.max(MIN_LIVE_AI_WORKER_BUDGET_CENTS, Math.min(MAX_LIVE_AI_WORKER_BUDGET_CENTS, Math.round(selected)));
}

function normalizeTracePolicy(options = {}) {
  const requested = options.tracePolicy || {};
  return {
    providerResponseStored: requested.providerResponseStored === true,
    providerTraceContent: requested.providerTraceContent === true,
    localReviewStored: true,
    dataClass: String(requested.dataClass || "business_internal"),
    purpose: String(requested.purpose || "Keep a local operator and developer review record for this run."),
  };
}

function cleanWorkBrief(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const string = (input, max) => String(input || "").replace(/\s+/g, " ").trim().slice(0, max);
  const list = (input, maxItems = 6) => (
    Array.isArray(input) ? input.filter(Boolean).map((item) => string(item, 500)).filter(Boolean).slice(0, maxItems) : []
  );
  const assetPrompt = String(value.assetPrompt || "").replace(/\s+/g, " ").trim();
  if (assetPrompt.length > MAX_WORK_BRIEF_ASSET_PROMPT_CHARS) {
    throw new Error(
      `The worker asset context is ${assetPrompt.length} characters, above the ${MAX_WORK_BRIEF_ASSET_PROMPT_CHARS}-character review limit. Supply a concise complete context instead of clipping structured business records.`,
    );
  }
  const brief = {
    objective: string(value.objective, 800),
    deliverable: string(value.deliverable, 800),
    assetPrompt,
    requiredCorrections: list(value.requiredCorrections),
    constraints: list(value.constraints),
    acceptanceCriteria: list(value.acceptanceCriteria),
  };
  return Object.values(brief).some((item) => Array.isArray(item) ? item.length : item) ? brief : null;
}

function requestedToolControls(options = {}) {
  const tools = [...new Set(Array.isArray(options.tools) ? options.tools.filter(Boolean).map(String) : [])];
  const hasSearch = tools.some((toolId) => ["research_adapter", "live_web_with_approval"].includes(toolId));
  const hasImageGeneration = tools.includes("image_generation_spend");
  const flags = [configuredEnvironmentName("enableLiveModels")];
  if (hasSearch) flags.push(configuredEnvironmentName("enableLiveResearch"));
  if (hasImageGeneration) flags.push(configuredEnvironmentName("enableImageGeneration"));
  return {
    tools,
    flags,
    maxTurns: Number(options.maxTurns || (hasSearch ? 4 : hasImageGeneration ? 2 : 1)),
    maxToolCalls: Number(options.maxToolCalls ?? (hasSearch ? 3 : hasImageGeneration ? 1 : 0)),
    deadlineMs: Number(options.deadlineMs || (hasImageGeneration ? 180000 : hasSearch ? 120000 : 60000)),
  };
}

const LOCAL_CONTEXT_TOOLS = new Set([
  "product_file_factory",
  "visual_asset_review",
]);

function stableWorkerPacketHash(packet) {
  const copy = JSON.parse(JSON.stringify(packet || {}));
  delete copy.packetHash;
  delete copy.date;
  if (copy.workflow) {
    delete copy.workflow.status;
    delete copy.workflow.currentStep;
  }
  return scopeHash(copy);
}

function latestCommand(db, workflowId) {
  return get(db, "SELECT * FROM commands WHERE workflow_id = ? ORDER BY created_at DESC LIMIT 1", [workflowId]);
}

function sourceWorkerTask(db, workflowId) {
  return hydrateTask(
    get(
      db,
      `SELECT * FROM tasks
       WHERE workflow_id = ? AND kind IN ('operator_pack_qc', 'offer_architecture', 'conversion_copy', 'distribution_plan', 'commercial_analysis')
       ORDER BY CASE status WHEN 'completed' THEN 0 ELSE 1 END, priority ASC, created_at ASC LIMIT 1`,
      [workflowId],
    ),
  );
}

function workerMatches(definition, value) {
  const key = String(value || "").toLowerCase();
  if (!key) return false;
  return String(definition.id || "").toLowerCase() === key
    || String(definition.name || "").toLowerCase() === key
    || (definition.aliases || []).some((alias) => String(alias || "").toLowerCase() === key);
}

function normalizeRequestedWorker(options = {}, sourceTask = null) {
  const explicitWorker = options.worker || options.requestedWorker || null;
  const requested = explicitWorker || sourceTask?.agent || "chief_of_staff";
  const definition = AI_TEAM_DEFINITIONS.find((candidate) => workerMatches(candidate, requested));
  if (definition) return definition;
  if (explicitWorker) {
    throw new Error(`Unknown AI worker: ${explicitWorker}. Choose one of the registered AI Team workers.`);
  }
  return AI_TEAM_DEFINITIONS.find((candidate) => candidate.id === "chief_of_staff");
}

function exactSuppliedEvidenceFixtureException(
  db,
  workflow,
  command,
  sourceTask,
  workerDefinition,
  options,
  controls,
) {
  if (!options.fixtureInput) return null;
  if (workerDefinition.id !== "demand_validator") {
    throw new Error("Only the Demand Validator versioned supplied-evidence fixture may omit venture context.");
  }
  const fixtureId = String(options.fixtureInput.id || "").trim();
  const fixture = fixtureId
    ? get(db, "SELECT * FROM agent_pilot_fixtures WHERE id = ?", [fixtureId])
    : null;
  if (!fixture || !["ready", "prepared"].includes(fixture.status)) {
    throw new Error("The supplied-evidence context exception needs an active persisted pilot fixture.");
  }
  const fixtureVersion = Number(fixture.fixture_version);
  const sources = fromJson(fixture.sources, []);
  const constraints = fromJson(fixture.constraints, {});
  const expectedInput = {
    id: fixture.id,
    version: fixtureVersion,
    hash: fixture.fixture_hash,
    question: fixture.question,
    buyer: fixture.buyer,
    hypothesis: fixture.hypothesis,
    sources,
    constraints,
  };
  const calculatedFixtureHash = scopeHash({
    fixtureVersion,
    question: fixture.question,
    buyer: fixture.buyer,
    hypothesis: fixture.hypothesis,
    sources,
    constraints,
  });
  if (!Number.isInteger(fixtureVersion)
      || fixtureVersion < 1
      || calculatedFixtureHash !== fixture.fixture_hash
      || scopeHash(options.fixtureInput) !== scopeHash(expectedInput)
      || options.fixtureHash !== fixture.fixture_hash) {
    throw new Error("The supplied-evidence fixture version or hash does not match its persisted record.");
  }
  const comparison = options.comparisonSource || {};
  if (comparison.type !== "versioned_agent_pilot_fixture"
      || comparison.fixtureId !== fixture.id
      || comparison.fixtureHash !== fixture.fixture_hash) {
    throw new Error("The supplied-evidence context exception needs its exact versioned comparison source.");
  }
  const workflowMetadata = workflow.metadata || {};
  const commandMetadata = fromJson(command?.metadata, {});
  if (workflow.type !== "agent_sdk_pilot"
      || workflow.venture_id !== fixture.venture_id
      || workflow.title !== "Demand Validator controlled proof"
      || workflowMetadata.fixtureId !== fixture.id
      || workflowMetadata.fixtureHash !== fixture.fixture_hash
      || workflowMetadata.capabilityKey !== DEMAND_VALIDATOR_FIXTURE_CAPABILITY
      || workflowMetadata.baselineExcludedFromWorker !== true
      || sourceTask
      || command?.source !== "agent-pilot"
      || command?.intent !== "evaluate_supplied_evidence"
      || command?.raw_text !== fixture.question
      || commandMetadata.fixtureId !== fixture.id
      || commandMetadata.fixtureHash !== fixture.fixture_hash
      || commandMetadata.baselineExcludedFromWorker !== true) {
    throw new Error("The supplied-evidence context exception is restricted to its exact agent-pilot workflow.");
  }
  const constraintTools = Array.isArray(constraints.tools) ? constraints.tools : [];
  const constraintHandoffs = Array.isArray(constraints.handoffs) ? constraints.handoffs : [];
  const protectedEvidence = sources.map((source) => `${source.title}: ${source.summary}`);
  const optionParameters = options.parameters || {};
  const parameterKeys = Object.keys(optionParameters);
  const retryParameterKeys = new Set([
    "attemptNumber",
    "technicalRetry",
    "retryOfTaskId",
    "priorOutcome",
    "priorOutcomeAcknowledged",
  ]);
  const validRetryParameters = parameterKeys.length === 0
    || (
      parameterKeys.every((key) => retryParameterKeys.has(key))
      && optionParameters.technicalRetry === true
      && Number.isInteger(Number(optionParameters.attemptNumber))
      && Number(optionParameters.attemptNumber) >= 2
      && String(optionParameters.retryOfTaskId || "").trim()
      && optionParameters.priorOutcome === "unknown"
      && optionParameters.priorOutcomeAcknowledged === true
    );
  const businessContext = options.businessContext || {};
  if (constraintTools.length
      || constraintHandoffs.length
      || Number(constraints.maxTurns) !== 1
      || !Number.isInteger(Number(constraints.maxOutputTokens))
      || Number(constraints.maxOutputTokens) < 1
      || Number(constraints.maxOutputTokens) > 1200
      || !Number.isInteger(Number(constraints.maxCostCents))
      || Number(constraints.maxCostCents) < 1
      || Number(constraints.maxCostCents) > 100
      || constraints.externalActionsAllowed !== false
      || controls.tools.length
      || controls.maxTurns !== 1
      || controls.maxToolCalls !== 0
      || controls.maxOutputTokens > Number(constraints.maxOutputTokens)
      || controls.amountCents > Number(constraints.maxCostCents)
      || (Array.isArray(options.effects) && options.effects.length)
      || Object.keys(options.toolArguments || {}).length
      || Object.values(businessContext).some((value) => value !== null && value !== undefined && value !== "")
      || options.workBrief
      || options.contextClasses
      || options.includePersonalData === true
      || options.taskTitle !== "Demand Validator controlled proof"
      || options.approvalTitle !== "Approve this Demand Validator proof"
      || options.expectedOutput !== SUPPLIED_EVIDENCE_EXPECTED_OUTPUT
      || options.expectedMetric !== SUPPLIED_EVIDENCE_EXPECTED_METRIC
      || scopeHash(options.protectedEvidence || []) !== scopeHash(protectedEvidence)
      || !validRetryParameters
      || options.model
      || options.highConsequence === true
      || options.qualityEscalation === true
      || options.tracePolicy?.providerResponseStored !== true
      || options.tracePolicy?.providerTraceContent !== true
      || options.tracePolicy?.localReviewStored !== true
      || options.tracePolicy?.dataClass !== "controlled_fixture_no_personal_data"
      || options.tracePolicy?.purpose !== SUPPLIED_EVIDENCE_TRACE_PURPOSE) {
    throw new Error("The supplied-evidence context exception is limited to the no-tool, one-turn, non-personal Demand Validator proof.");
  }
  return {
    binding: {
      ...SUPPLIED_EVIDENCE_CONTEXT_EXCEPTION,
      capabilityKey: DEMAND_VALIDATOR_FIXTURE_CAPABILITY,
      fixtureId: fixture.id,
      fixtureVersion,
      fixtureHash: fixture.fixture_hash,
      ventureContextOmitted: true,
    },
    fixtureInput: expectedInput,
  };
}

function modelCapabilityKey(options, workerDefinition, contextException, proofMode = false) {
  let capabilityKey;
  if (contextException) capabilityKey = DEMAND_VALIDATOR_FIXTURE_CAPABILITY;
  const explicit = String(options.capabilityKey || "").trim();
  if (!capabilityKey && explicit) capabilityKey = explicit;
  if (!capabilityKey && workerDefinition.id === "chief_of_staff" && options.chiefOrchestration?.enabled === true) {
    capabilityKey = "chief_of_staff.next_bounded_specialist";
  }
  if (!capabilityKey && workerDefinition.id === "quality_reviewer" && options.parameters?.reviewOfTaskId) {
    capabilityKey = "quality_reviewer.exact_deliverable_review";
  }
  if (!capabilityKey && CHIEF_ASSIGNMENT_SCHEMAS.has(options.parameters?.chiefAssignment?.schema)) {
    capabilityKey = `${workerDefinition.id}.chief_bounded_specialist`;
  }
  if (!capabilityKey) capabilityKey = `${workerDefinition.id}.live_assignment`;
  return proofMode ? `${capabilityKey}.system_proof` : capabilityKey;
}

function approvalIdForRequest(db, taskId, workflowId, requestedAt) {
  const existing = hydrateTask(get(db, "SELECT * FROM tasks WHERE id = ?", [taskId]));
  const existingApprovalId = existing?.payload?.liveSpendRequest?.approvalId;
  if (existingApprovalId) {
    const approval = get(db, "SELECT status FROM approvals WHERE id = ?", [existingApprovalId]);
    if (!approval || ["pending", "approved"].includes(approval.status)) return existingApprovalId;
  }
  return `appr_live_worker_${safeId(workflowId)}_${safeId(requestedAt)}`;
}

function requestKeyForTask(task) {
  const explicit = String(task?.payload?.requestKey || "").trim();
  if (explicit) return explicit;
  const prefix = `task_live_worker_${safeId(task?.workflow_id)}`;
  const taskId = String(task?.id || "");
  return taskId.startsWith(`${prefix}_`) ? taskId.slice(prefix.length + 1) : undefined;
}

function originalRequestParameters(parameters = {}) {
  const copy = JSON.parse(JSON.stringify(parameters || {}));
  delete copy.approvedAssetBinding;
  delete copy.contextSnapshot;
  delete copy.modelRoute;
  delete copy.requiredReviewer;
  delete copy.ventureContextException;
  return copy;
}

function originalToolArguments(toolArguments = {}) {
  const copy = JSON.parse(JSON.stringify(toolArguments || {}));
  if (copy.visual_asset_review && typeof copy.visual_asset_review === "object") {
    delete copy.visual_asset_review.approvedAssetBinding;
  }
  return copy;
}

function refreshOptionsForTask(task, trigger) {
  const payload = task.payload || {};
  const request = payload.liveSpendRequest || {};
  const pilotFixture = payload.pilotFixture
    ? JSON.parse(JSON.stringify(payload.pilotFixture))
    : null;
  if (pilotFixture) delete pilotFixture.baselineExcluded;
  const route = request.modelRoute || request.parameters?.modelRoute || {};
  const isPilotFixture = Boolean(pilotFixture);
  const businessContext = isPilotFixture ? undefined : {
    subject: payload.subject || "",
    channel: payload.channel || "",
    buyer: payload.buyer || "",
    problem: payload.problem || "",
    offer: payload.offer || "",
    evidenceStandard: payload.evidenceStandard || "",
  };
  return {
    requestKey: requestKeyForTask(task),
    worker: payload.requestedWorker || request.worker?.id || task.agent,
    estimatedCostCents: Number(request.maxCostCents || request.estimatedCostCents || task.cost_budget_cents),
    requestedBy: trigger || "runtime-policy-refresh",
    model: isPilotFixture ? undefined : request.model,
    modelLocked: request.modelRoute?.modelLocked === true
      || request.parameters?.modelRoute?.modelLocked === true,
    taskTitle: task.title,
    approvalTitle: request.title,
    reason: request.reason,
    expectedOutput: payload.expectedOutput,
    expectedMetric: payload.expectedMetric,
    fixtureHash: request.fixtureHash || null,
    fixtureInput: pilotFixture,
    tools: Array.isArray(request.tools) ? request.tools : [],
    toolArguments: originalToolArguments(request.toolArguments),
    maxTurns: Number(request.maxTurns || 1),
    maxToolCalls: Number(request.maxToolCalls || 0),
    deadlineMs: Number(request.deadlineMs || 60000),
    maxInputTokens: Number(
      request.maxInputTokens
      || request.executionDescriptor?.limits?.maxInputTokens
      || 0,
    ) || undefined,
    repriceChangedInput: true,
    maxOutputTokens: Number(request.maxOutputTokens || CONFIG.liveModelMaxOutputTokens || 1200),
    tracePolicy: request.tracePolicy,
    parameters: originalRequestParameters(request.parameters),
    effects: Array.isArray(request.effects) ? request.effects : [],
    comparisonSource: payload.comparisonSource || request.comparisonSource || null,
    protectedEvidence: payload.protectedEvidence || request.protectedEvidence || [],
    businessContext,
    workBrief: payload.workBrief || undefined,
    chiefOrchestration: payload.chiefOrchestration || undefined,
    capabilityKey: route.capabilityKey || undefined,
    contextClasses: payload.contextSnapshot?.recordClasses || undefined,
    includePersonalData: payload.contextSnapshot?.includePersonalData === true,
    highConsequence: !isPilotFixture
      && route.tier === "sol"
      && /consequential|high consequence/i.test(String(route.reason || "")),
    qualityEscalation: !isPilotFixture
      && /quality escalation/i.test(String(route.reason || "")),
    audPerUsd: Number(request.executionDescriptor?.worstCaseCost?.audPerUsd || 0) || undefined,
  };
}

function preDispatchRecoveryStatus(db, taskInput) {
  const task = hydrateTask(taskInput);
  if (
    !task
    || task.kind !== "live_ai_worker_execution"
    || task.status !== "failed"
    || task.outcome_status !== "failed_before_effect"
  ) {
    return { available: false, reason: "This work did not finish as a verified pre-dispatch failure." };
  }
  const attempt = get(
    db,
    "SELECT * FROM task_attempts WHERE task_id = ? ORDER BY started_at DESC, id DESC LIMIT 1",
    [task.id],
  );
  const attemptMetadata = fromJson(attempt?.metadata, {});
  const taskModelCalls = Number(get(
    db,
    "SELECT COUNT(*) AS count FROM model_calls WHERE task_id = ?",
    [task.id],
  )?.count || 0);
  const taskCosts = Number(get(
    db,
    `SELECT COUNT(*) AS count FROM costs
     WHERE task_id = ? AND status NOT IN ('released', 'cancelled') AND amount_cents > 0`,
    [task.id],
  )?.count || 0);
  const unresolvedReservations = Number(get(
    db,
    `SELECT COUNT(*) AS count FROM budget_reservations
     WHERE task_id = ? AND status IN ('reserved', 'incurred_estimate', 'unknown')`,
    [task.id],
  )?.count || 0);
  const available = Boolean(
    attempt
    && attempt.outcome_status === "failed_before_effect"
    && !attempt.provider_dispatched_at
    && !attempt.provider_dispatch_model_call_id
    && !attempt.provider_request_id
    && attemptMetadata.providerCallOccurred !== true
    && taskModelCalls === 0
    && taskCosts === 0
    && unresolvedReservations === 0
  );
  return {
    available,
    attempt,
    reason: available
      ? "Pantheon stopped locally before any provider call or spend."
      : "Pantheon cannot prove that this failure happened before provider dispatch and spend.",
    evidence: {
      taskModelCalls,
      taskCosts,
      unresolvedReservations,
      providerDispatchedAt: attempt?.provider_dispatched_at || null,
      providerRequestId: attempt?.provider_request_id || null,
      providerCallOccurred: attemptMetadata.providerCallOccurred === true,
    },
  };
}

function prepareReviewedLiveAiWorkerRetry(db, taskId, options = {}) {
  const task = hydrateTask(get(db, "SELECT * FROM tasks WHERE id = ?", [taskId]));
  if (!task || task.kind !== "live_ai_worker_execution") {
    throw new Error("This recovery action is only available for a recorded AI worker run.");
  }
  const journeyTask = Boolean(task.payload?.liveSpendRequest?.parameters?.pantheonJourney?.journeyId);
  const boundedCommercialTask = task.payload?.liveSpendRequest?.parameters?.pantheonCommercial?.supervisorOwned === true;
  if (task.agent !== "demand_validator" && !journeyTask && !boundedCommercialTask) {
    throw new Error("The first dashboard recovery path is limited to Demand Validator system tests.");
  }

  const attempt = get(
    db,
    "SELECT * FROM task_attempts WHERE task_id = ? ORDER BY started_at DESC, id DESC LIMIT 1",
    [task.id],
  );
  const modelCall = attempt?.model_call_id
    ? get(db, "SELECT * FROM model_calls WHERE id = ? AND task_id = ?", [attempt.model_call_id, task.id])
    : null;
  const modelMetadata = fromJson(modelCall?.metadata, {});
  const providerResultKnown = modelCall?.outcome_status === "known"
    && Boolean(modelCall.provider_request_id || modelMetadata.providerResponseReceived === true);
  const evaluation = attempt?.id ? get(
    db,
    `SELECT evals.id, evals.run_id, evals.attempt_id, evals.status, evals.findings
     FROM agent_eval_results AS evals
     WHERE evals.attempt_id = ?
     ORDER BY evals.created_at DESC, evals.id DESC LIMIT 1`,
    [attempt.id],
  ) : null;
  const receipt = attempt?.id ? get(
    db,
    `SELECT id, run_id, attempt_id, status, outcome_status
     FROM agent_run_receipts
     WHERE attempt_id = ?
     ORDER BY sequence DESC LIMIT 1`,
    [attempt.id],
  ) : null;
  const unresolvedAttempts = all(
    db,
    `SELECT id FROM task_attempts
     WHERE task_id = ?
       AND (status = 'running' OR outcome_status = 'unknown')`,
    [task.id],
  );
  if (unresolvedAttempts.length) {
    throw new Error("An execution attempt still has an unresolved provider outcome. Reconcile it before retrying.");
  }
  const seenAncestors = new Set([task.id]);
  let ancestorTaskId = task.payload?.liveSpendRequest?.parameters?.retry?.priorTaskId || null;
  while (ancestorTaskId && !seenAncestors.has(ancestorTaskId)) {
    seenAncestors.add(ancestorTaskId);
    const unresolvedAncestor = get(
      db,
      `SELECT attempts.id
       FROM task_attempts AS attempts
       WHERE attempts.task_id = ?
         AND (attempts.status = 'running' OR attempts.outcome_status = 'unknown')
       LIMIT 1`,
      [ancestorTaskId],
    );
    if (unresolvedAncestor) {
      throw new Error("An earlier attempt in this retry chain still has an unresolved provider outcome.");
    }
    const ancestor = hydrateTask(get(db, "SELECT payload FROM tasks WHERE id = ?", [ancestorTaskId]));
    ancestorTaskId = ancestor?.payload?.liveSpendRequest?.parameters?.retry?.priorTaskId || null;
  }
  const knownResultFailure = task.status === "needs_attention"
    && task.outcome_status === "known_provider_result_needs_review";
  const reviewedQualityShortfall = task.status === "completed"
    && task.outcome_status === "known"
    && ["failed", "needs_review"].includes(evaluation?.status);
  const failedBeforeEffect = task.status === "failed"
    && task.outcome_status === "failed_before_effect";
  if (!knownResultFailure && !reviewedQualityShortfall && !failedBeforeEffect) {
    throw new Error("This AI result is not in a reviewed state that permits a safe corrected attempt.");
  }

  let retryReason;
  let requiredCorrections;
  if (failedBeforeEffect) {
    const recovery = preDispatchRecoveryStatus(db, task);
    if (!recovery.available) throw new Error(recovery.reason);
    requiredCorrections = [];
    retryReason = "Pantheon failed locally before any provider call or spend. Reissue the exact work under a fresh single-use approval.";
  } else if (knownResultFailure) {
    if (
      !attempt
      || attempt.outcome_status !== "known_provider_result_needs_review"
      || !providerResultKnown
    ) {
      throw new Error("Pantheon cannot prove that the prior provider outcome is known. Reconcile it before retrying.");
    }
    const errorKind = attempt.error_kind || modelCall.error_kind || modelMetadata.errorKind;
    if (!canPrepareReviewedRetry(task, errorKind)) {
      throw new Error("This result needs developer review before another provider call can be prepared.");
    }
    if (!receipt || receipt.attempt_id !== attempt.id) {
      throw new Error("The reviewed provider result does not have an exact immutable execution receipt.");
    }
    const findings = evaluation ? fromJson(evaluation.findings, []) : [];
    requiredCorrections = [
      task.error || modelMetadata.error || "The reviewed provider result could not be accepted locally.",
      ...findings,
    ].filter(Boolean);
    retryReason = [
      requiredCorrections[0],
      findings.length ? `Pantheon evidence check: ${findings.join(" ")}` : "",
    ].filter(Boolean).join(" ");
  } else {
    if (
      !attempt
      || attempt.status !== "completed"
      || attempt.outcome_status !== "known"
      || modelCall?.status !== "completed"
      || !providerResultKnown
      || evaluation?.attempt_id !== attempt.id
      || receipt?.status !== "complete"
      || receipt?.outcome_status !== "known"
    ) {
      throw new Error("Pantheon cannot prove a completed provider result and local evidence check for this retry.");
    }
    const findings = fromJson(evaluation.findings, []);
    requiredCorrections = findings.length
      ? findings
      : [`Pantheon evidence check status: ${evaluation.status}.`];
    retryReason = findings.length
      ? `Pantheon evidence check: ${findings.join(" ")}`
      : `Pantheon evidence check status: ${evaluation.status}.`;
  }

  const workflowTasks = all(
    db,
    "SELECT * FROM tasks WHERE workflow_id = ? AND kind = 'live_ai_worker_execution' ORDER BY created_at, id",
    [task.workflow_id],
  ).map(hydrateTask);
  const taskById = new Map(workflowTasks.map((candidate) => [candidate.id, candidate]));
  const retryChainRoot = (candidate) => {
    let current = candidate;
    const seen = new Set();
    while (current && !seen.has(current.id)) {
      seen.add(current.id);
      const priorTaskId = current.payload?.liveSpendRequest?.parameters?.retry?.priorTaskId;
      if (!priorTaskId) return current;
      current = taskById.get(priorTaskId) || hydrateTask(get(db, "SELECT * FROM tasks WHERE id = ?", [priorTaskId]));
    }
    return current || candidate;
  };
  const rootTask = retryChainRoot(task);
  const relatedTasks = workflowTasks.filter((candidate) => retryChainRoot(candidate)?.id === rootTask.id);
  const existingPrepared = relatedTasks.find((candidate) => {
    const retry = candidate.payload?.liveSpendRequest?.parameters?.retry;
    if (
      retry?.priorTaskId !== task.id
      || retry?.operatorAuthorized !== true
      || !["blocked", "waiting_approval", "queued"].includes(candidate.status)
    ) {
      return false;
    }
    const evidence = get(
      db,
      `SELECT
         (SELECT COUNT(*) FROM task_attempts WHERE task_id = ?) AS attempts,
         (SELECT COUNT(*) FROM model_calls WHERE task_id = ?) AS model_calls,
         (SELECT COUNT(*) FROM agent_runs WHERE task_id = ?) AS agent_runs`,
      [candidate.id, candidate.id, candidate.id],
    );
    return !Object.values(evidence || {}).some((count) => Number(count || 0) > 0);
  });
  if (existingPrepared) {
    const approval = existingPrepared.approval_id
      ? get(db, "SELECT * FROM approvals WHERE id = ?", [existingPrepared.approval_id])
      : null;
    return {
      status: "prepared",
      existing: true,
      priorTaskId: task.id,
      retryNumber: Number(existingPrepared.payload?.liveSpendRequest?.parameters?.retry?.sequence || 1),
      task: existingPrepared,
      approval,
      model: existingPrepared.payload?.liveSpendRequest?.model || null,
      maxCostCents: Number(existingPrepared.cost_budget_cents || 0),
    };
  }
  const retrySequence = 1 + relatedTasks.reduce((maximum, candidate) => Math.max(
    maximum,
    Number(candidate.payload?.liveSpendRequest?.parameters?.retry?.sequence || 0),
    Number(String(candidate.id).match(/_retry_(\d+)$/)?.[1] || 0),
  ), 0);
  const correctionNumber = failedBeforeEffect
    ? 0
    : 1 + relatedTasks.reduce((maximum, candidate) => {
      const retry = candidate.payload?.liveSpendRequest?.parameters?.retry || {};
      if (retry.technicalRecovery === true) return maximum;
      return Math.max(maximum, Number(retry.number || 0));
    }, 0);
  const retryLimit = journeyTask || boundedCommercialTask ? 1 : 5;
  const technicalRecoveryCount = relatedTasks.filter(
    (candidate) => candidate.payload?.liveSpendRequest?.parameters?.retry?.technicalRecovery === true,
  ).length;
  if (failedBeforeEffect && technicalRecoveryCount >= 3) {
    throw new Error("Three local pre-dispatch recoveries have failed. Jarvis must repair the underlying fault before another approval is prepared.");
  }
  if (!failedBeforeEffect && correctionNumber > retryLimit) {
    throw new Error(journeyTask || boundedCommercialTask
      ? "This commercial stage has used its one targeted correction. Stop and reassess before spending again."
      : "Five reviewed attempts have already been prepared. Stop and reassess this test before spending again.");
  }

  const baseRequestKey = String(requestKeyForTask(rootTask) || `reviewed_${rootTask.id}`).replace(/_retry_\d+$/, "");
  const retryOptions = refreshOptionsForTask(task, "operator-dashboard");
  retryOptions.requestKey = `${stableIdSegment(baseRequestKey, 55, "reviewed_task")}_retry_${retrySequence}`;
  retryOptions.requestedBy = "operator-dashboard";
  retryOptions.proofMode = options.proofMode === true
    || task.payload?.systemProof === true
    || CONFIG.systemProofMode === true;
  if (!failedBeforeEffect) {
    retryOptions.maxOutputTokens = Math.max(2400, Number(retryOptions.maxOutputTokens || 0));
  }
  const priorWorkBrief = retryOptions.workBrief && typeof retryOptions.workBrief === "object"
    ? retryOptions.workBrief
    : {};
  retryOptions.workBrief = failedBeforeEffect
    ? priorWorkBrief
    : {
      ...priorWorkBrief,
      requiredCorrections,
    };
  const productBuilderTools = Array.isArray(retryOptions.tools) ? retryOptions.tools : [];
  if (
    !failedBeforeEffect
    && task.agent === "product_builder"
    && productBuilderTools.includes("product_file_factory")
  ) {
    retryOptions.maxOutputTokens = Math.max(8000, retryOptions.maxOutputTokens);
    retryOptions.maxTurns = 1;
    retryOptions.maxToolCalls = 0;
    retryOptions.deadlineMs = Math.max(180000, Number(retryOptions.deadlineMs || 0));
    retryOptions.workBrief = {
      ...retryOptions.workBrief,
      assetPrompt: [
        "This is the single corrected Product Builder attempt. Resolve every item in requiredCorrections exactly; acknowledgement without implementing the missing field, formula, option, instruction, or status is a failure.",
        "Return one corrected strict productBlueprint for the exact approved catalogue. Pantheon will render, hash, reopen, preview, and package the customer files locally after validation.",
        "Resolve every claim-alignment finding exactly. Each customer-facing promise must be visibly implemented by a field, instruction, formula, checklist, validation option, or status; otherwise narrow the purpose to a literal functional description.",
        "Keep the blueprint compact: one short sentence per purpose, instruction, and field guide; one realistic sample row unless a second is essential; no repeated explanation.",
        "Use the calculations array only for supported row-level calculator logic. Supported operations are sum, subtract, multiply, and percent_of using columns from the same row and item. Never use grouping, cross-row totals, SUMIF or SUMIFS logic, lookups, counts, running totals, or date arithmetic; make aggregate totals user-entered reviewed fields instead.",
        "Every calculation target and input must exactly copy a column.name from the same item with no explanatory prose; percent_of requires exactly [numerator column name, denominator column name]. Put actual editable wording in an Email Body, Message Copy, Script Text, or Script Wording field when scripts are promised.",
        "Every column must return options: [] for non-status fields and the complete 2-12 value dropdown for status fields. Every item needs a dedicated Status or workflow-status field with a recognised successful value. Copy each sample status value character-for-character from that field's options; never append punctuation, translations, symbols, or commentary.",
        "For a promised sequence of up to three steps, include every step as a sample row and as a declared option. The Dashboard must use the dedicated workflow-status field, not a tone, timing, service, or sequence selector.",
        priorWorkBrief.assetPrompt,
      ].filter(Boolean).join(" "),
      constraints: [
        "Do not claim that files already exist or were created by the model.",
        "Return only the strict structured blueprint requested by the output schema.",
        "Do not use unmeasured promises such as better, fewer, faster, improved, reduced, guaranteed, or completed outcomes.",
        "Confirmation, verification, approval, completeness, and file-organization claims require an explicit matching mechanism.",
        ...(Array.isArray(priorWorkBrief.constraints) ? priorWorkBrief.constraints : []),
      ],
      acceptanceCriteria: [
        "Every requiredCorrections item is visibly resolved in the returned blueprint.",
        "Every exact approved catalogue item is represented once in the corrected blueprint.",
        "Every approved offer and returned purpose passes Pantheon's deterministic claim-to-product preflight.",
        "Every promised selector exposes its complete option set, every sample status value exactly equals one declared option, and every Dashboard metric uses a dedicated workflow-status field.",
        "Every calculation is row-level, uses a supported operation, and references exact same-item column names only.",
        ...(Array.isArray(priorWorkBrief.acceptanceCriteria) ? priorWorkBrief.acceptanceCriteria : []),
      ],
    };
  } else if (!failedBeforeEffect && task.agent === "demand_validator") {
    retryOptions.maxOutputTokens = Math.max(4000, retryOptions.maxOutputTokens);
    retryOptions.workBrief = {
      ...retryOptions.workBrief,
      assetPrompt: [
        "The prior strict demand-validation result was truncated. Return one complete, compact correction.",
        "Use no more than four short source-summary items, three counterevidence items, three assumptions, and four short evidence items overall.",
        "Keep each remaining field to one concise paragraph or sentence. Do not repeat source descriptions across fields.",
        priorWorkBrief.assetPrompt,
      ].filter(Boolean).join(" "),
      constraints: [
        "Return the complete strict structured response within the output limit.",
        "Keep observed demand evidence, inference, assumptions, and missing evidence clearly separated.",
        ...(Array.isArray(priorWorkBrief.constraints) ? priorWorkBrief.constraints : []),
      ],
      acceptanceCriteria: [
        "The demand verdict is complete, parseable, and tied to attributable sources.",
        "The result includes a smallest test, metric, stop rule, price-channel hypothesis, and honest counterevidence.",
        ...(Array.isArray(priorWorkBrief.acceptanceCriteria) ? priorWorkBrief.acceptanceCriteria : []),
      ],
    };
  } else if (!failedBeforeEffect && task.agent === "finance_analyst") {
    retryOptions.maxOutputTokens = Math.max(4000, retryOptions.maxOutputTokens);
    retryOptions.maxTurns = 1;
    retryOptions.maxToolCalls = 0;
    retryOptions.workBrief = {
      ...retryOptions.workBrief,
      assetPrompt: [
        "The prior strict finance result was truncated. Return one complete, compact correction.",
        "Use no more than three scenarios, three major risks, and three missing-evidence items. Keep each remaining field to one concise sentence or paragraph.",
        "Do not repeat demand evidence or source descriptions already supplied in the task context.",
        priorWorkBrief.assetPrompt,
      ].filter(Boolean).join(" "),
      constraints: [
        "Return the complete strict structured response within the output limit.",
        "Keep observed financial inputs, calculated outputs, estimates, and unknowns clearly separated.",
        ...(Array.isArray(priorWorkBrief.constraints) ? priorWorkBrief.constraints : []),
      ],
      acceptanceCriteria: [
        "The finance result is complete, parseable, and reconciles price, fees, variable costs, acquisition assumptions, contribution margin, break-even, and downside.",
        "Unknown economics remain explicitly unknown rather than being presented as observed facts.",
        ...(Array.isArray(priorWorkBrief.acceptanceCriteria) ? priorWorkBrief.acceptanceCriteria : []),
      ],
    };
  } else if (!failedBeforeEffect && task.agent === "opportunity_scout") {
    retryOptions.maxOutputTokens = Math.max(7000, retryOptions.maxOutputTokens);
    retryOptions.workBrief = {
      ...retryOptions.workBrief,
      assetPrompt: [
        "The prior strict structured result was truncated. Return one complete, compact correction.",
        "Return exactly five opportunity candidates. Use no more than two short demand-evidence items, two short competition-evidence items, and two short risks per candidate.",
        "Keep every other candidate field to one concise sentence. Put source URLs in tool evidence rather than repeating long source descriptions in the structured answer.",
        priorWorkBrief.assetPrompt,
      ].filter(Boolean).join(" "),
      constraints: [
        "Return the complete strict structured response within the output limit and do not repeat evidence across fields.",
        "Preserve the required five-model comparison and the Job Search Evidence Tracker benchmark.",
        ...(Array.isArray(priorWorkBrief.constraints) ? priorWorkBrief.constraints : []),
      ],
      acceptanceCriteria: [
        "Exactly five distinct business-model candidates are complete and parseable.",
        "Every candidate retains buyer, problem, offer, channel, evidence, economics, risk, and smallest-test fields.",
        ...(Array.isArray(priorWorkBrief.acceptanceCriteria) ? priorWorkBrief.acceptanceCriteria : []),
      ],
    };
  } else if (!failedBeforeEffect && task.agent === "offer_architect") {
    retryOptions.workBrief = {
      ...retryOptions.workBrief,
      assetPrompt: [
        "Resolve every item in requiredCorrections exactly in this corrected offer.",
        "Resolve every cited offer and catalogue claim-alignment finding exactly. If a promise or outcome says calculate, the matching includedTools entry must name the relevant fields and explicitly say sum, subtract, multiply, or percent_of. Otherwise narrow the promise to a literal function.",
        priorWorkBrief.assetPrompt,
      ].filter(Boolean).join(" "),
      constraints: [
        "Do not repeat an unsupported calculation claim. Tie each calculation to named fields and one explicit supported operation in includedTools.",
        ...(Array.isArray(priorWorkBrief.constraints) ? priorWorkBrief.constraints : []),
      ],
      acceptanceCriteria: [
        "Every requiredCorrections item is visibly resolved in the returned offer.",
        "Every calculation claim has an exact field-and-operation mechanism that Product Builder can implement.",
        ...(Array.isArray(priorWorkBrief.acceptanceCriteria) ? priorWorkBrief.acceptanceCriteria : []),
      ],
    };
  } else if (!failedBeforeEffect && task.agent === "quality_reviewer") {
    retryOptions.maxOutputTokens = Math.max(5000, retryOptions.maxOutputTokens);
    retryOptions.maxTurns = 1;
    retryOptions.maxToolCalls = 0;
    retryOptions.workBrief = {
      ...retryOptions.workBrief,
      assetPrompt: [
        "Resolve every item in requiredCorrections exactly in this corrected quality review.",
        "Return one compact strict quality-review result for the exact unchanged evidence packet. Use short factual sentences, no repeated findings, at most six risk findings, and at most six missing-evidence items.",
        priorWorkBrief.assetPrompt,
      ].filter(Boolean).join(" "),
      constraints: [
        "Do not repeat evidence or explain the same defect in multiple fields.",
        "Do not claim visual, formula, file-opening, or usability checks beyond the exact supplied evidence packet.",
        ...(Array.isArray(priorWorkBrief.constraints) ? priorWorkBrief.constraints : []),
      ],
      acceptanceCriteria: [
        "Every requiredCorrections item is visibly resolved in the returned review.",
        "The strict structured response completes without truncation and gives one unambiguous approve, revise, or deny verdict.",
        ...(Array.isArray(priorWorkBrief.acceptanceCriteria) ? priorWorkBrief.acceptanceCriteria : []),
      ],
    };
  } else if (!failedBeforeEffect && task.agent === "distribution_operator") {
    retryOptions.maxOutputTokens = Math.max(4000, retryOptions.maxOutputTokens);
    retryOptions.maxTurns = 1;
    retryOptions.maxToolCalls = 0;
    retryOptions.workBrief = {
      ...retryOptions.workBrief,
      assetPrompt: [
        "The prior structured launch plan was truncated. Return one complete, compact correction and resolve every item in requiredCorrections exactly.",
        "Use no more than six short channel steps and six short evidence items. Keep every other field to one concise paragraph or sentence.",
        priorWorkBrief.assetPrompt,
      ].filter(Boolean).join(" "),
      constraints: [
        "Return the complete strict structured response within the available output limit; do not repeat the product context or explain the same step twice.",
        ...(Array.isArray(priorWorkBrief.constraints) ? priorWorkBrief.constraints : []),
      ],
      acceptanceCriteria: [
        "The strict structured response completes without truncation.",
        "Every requiredCorrections item is resolved in the returned launch plan.",
        ...(Array.isArray(priorWorkBrief.acceptanceCriteria) ? priorWorkBrief.acceptanceCriteria : []),
      ],
    };
  } else if (
    !failedBeforeEffect
    && task.agent === "product_builder"
    && productBuilderTools.includes("image_generation_spend")
  ) {
    retryOptions.maxOutputTokens = Math.max(2400, retryOptions.maxOutputTokens);
    retryOptions.maxTurns = 2;
    retryOptions.maxToolCalls = 1;
    retryOptions.deadlineMs = Math.max(180000, Number(retryOptions.deadlineMs || 0));
    retryOptions.workBrief = {
      ...retryOptions.workBrief,
      assetPrompt: [
        "Resolve every item in requiredCorrections exactly in this corrected visual run.",
        "Create exactly one approved image, then return the compact strict visual-result JSON. Keep every text field to one short sentence and limitations to at most two short items.",
        priorWorkBrief.assetPrompt,
      ].filter(Boolean).join(" "),
    };
  }
  retryOptions.parameters = {
    ...(retryOptions.parameters || {}),
    retry: {
      number: correctionNumber,
      sequence: retrySequence,
      priorTaskId: task.id,
      reason: retryReason,
      operatorAuthorized: true,
      sourceAttemptId: attempt.id,
      sourceModelCallId: modelCall?.id || null,
      sourceEvaluationId: evaluation?.id || null,
      sourceReceiptId: receipt?.id || null,
      technicalRecovery: failedBeforeEffect,
      consumesCorrection: !failedBeforeEffect,
    },
  };

  const prepared = requestLiveAiWorker(db, task.workflow_id, retryOptions);
  insertEvent(db, {
    actor: "operator-dashboard",
    type: failedBeforeEffect
      ? "live_ai_worker.pre_dispatch_recovery_prepared"
      : "live_ai_worker.reviewed_retry_prepared",
    entityType: "task",
    entityId: prepared.task.id,
    message: failedBeforeEffect
      ? `A fresh ${task.agent.replaceAll("_", " ")} decision was prepared after a verified local pre-dispatch failure.`
      : `A corrected ${task.agent.replaceAll("_", " ")} attempt was prepared for an exact operator decision. No provider call occurred.`,
    metadata: {
      priorTaskId: task.id,
      retryTaskId: prepared.task.id,
      retrySequence,
      correctionNumber,
      technicalRecovery: failedBeforeEffect,
      approvalId: prepared.approval?.id || null,
      model: prepared.task.payload?.liveSpendRequest?.model || null,
      maxCostCents: prepared.estimatedCostCents,
      retryReason,
      priorEvaluationStatus: evaluation?.status || null,
      noProviderCall: true,
      noSpendOccurred: true,
    },
  });
  return {
    status: "prepared",
    priorTaskId: task.id,
    retryNumber: retrySequence,
    correctionNumber,
    technicalRecovery: failedBeforeEffect,
    task: prepared.task,
    approval: prepared.approval,
    model: prepared.task.payload?.liveSpendRequest?.model || null,
    maxCostCents: prepared.estimatedCostCents,
  };
}

function refreshableApprovalReason(reason) {
  return [
    /execution descriptor has no exact worker policy binding/i,
    /worker approval policy changed after approval was requested/i,
    /worker definition changed after approval was requested/i,
    /paid work request uses an unsupported execution descriptor/i,
    /materialized model input changed after approval was requested/i,
  ].some((pattern) => pattern.test(String(reason || "")));
}

function refreshOutdatedLiveAiWorkerApproval(db, approvalId, options = {}) {
  const approval = get(db, "SELECT * FROM approvals WHERE id = ?", [approvalId]);
  if (!approval || approval.status !== "pending" || approval.consumed_at) {
    return { refreshed: false, reason: "The decision is not an unused pending approval." };
  }
  const taskRow = approval.task_id
    ? get(db, "SELECT * FROM tasks WHERE id = ?", [approval.task_id])
    : null;
  const task = hydrateTask(taskRow);
  if (!task || task.kind !== "live_ai_worker_execution" || task.payload?.liveSpendRequest?.requested !== true) {
    return { refreshed: false, reason: "The decision is not for a live AI worker." };
  }
  const executionCount = Number(get(
    db,
    `SELECT
       (SELECT COUNT(*) FROM task_attempts WHERE task_id = ?) +
       (SELECT COUNT(*) FROM model_calls WHERE task_id = ?) +
       (SELECT COUNT(*) FROM agent_runs WHERE task_id = ?) AS count`,
    [task.id, task.id, task.id],
  )?.count || 0);
  if (executionCount > 0
      || Number(task.attempt_count || 0) > 0
      || Number(task.cost_actual_cents || 0) > 0
      || !["", "not_started"].includes(String(task.outcome_status || ""))) {
    return { refreshed: false, reason: "Work has already started, so its evidence must be reviewed instead of refreshed." };
  }
  const validation = validateApprovalScope(db, approval.id, task);
  if (validation.valid) return { refreshed: false, reason: "The decision is already current." };
  if (!refreshableApprovalReason(validation.reason)) {
    return { refreshed: false, reason: validation.reason };
  }

  return withSavepoint(db, "refresh_live_worker_approval", () => {
    const refreshedAt = now();
    const refreshOptions = refreshOptionsForTask(
      task,
      options.trigger || "runtime-policy-refresh",
    );
    const superseded = run(
      db,
      `UPDATE approvals
       SET status = 'superseded', decided_at = ?, decision_note = ?
       WHERE id = ? AND status = 'pending' AND consumed_at IS NULL`,
      [
        refreshedAt,
        `Safely replaced before execution because ${validation.reason}`,
        approval.id,
      ],
    );
    if (superseded.changes !== 1) {
      throw new Error("The outdated decision changed while Pantheon was refreshing it.");
    }
    run(
      db,
      `UPDATE approval_action_tokens
       SET status = 'superseded', used_at = COALESCE(used_at, ?)
       WHERE approval_id = ? AND status = 'active'`,
      [refreshedAt, approval.id],
    );
    run(
      db,
      `UPDATE messages
       SET status = 'resolved', resolved_at = ?
       WHERE task_id = ? AND status = 'open'
         AND (
           severity = 'approval'
           OR (
             json_valid(metadata)
             AND json_extract(metadata, '$.approvalId') = ?
           )
         )`,
      [refreshedAt, task.id, approval.id],
    );
    run(
      db,
      `UPDATE tasks
       SET approval_id = NULL, setup_block_reason = NULL, outcome_status = 'not_started',
           error = NULL, updated_at = ?
       WHERE id = ?`,
      [refreshedAt, task.id],
    );

    const replacement = requestLiveAiWorker(db, task.workflow_id, refreshOptions);
    if (replacement.task?.id !== task.id) {
      throw new Error("The refreshed AI-work decision did not stay attached to the same work item.");
    }
    const costId = spendCostId(task.id);
    const cost = get(db, "SELECT * FROM costs WHERE id = ?", [costId]);
    if (cost && Number(cost.amount_cents || 0) === 0) {
      const metadata = fromJson(cost.metadata, {});
      const history = Array.isArray(metadata.approvalRefreshHistory)
        ? metadata.approvalRefreshHistory
        : [];
      const currentRequest = replacement.task.payload.liveSpendRequest;
      run(
        db,
        `UPDATE costs
         SET status = 'approval_requested', source = ?, metadata = ?
         WHERE id = ? AND amount_cents = 0`,
        [
          currentRequest.provider,
          toJson({
            ...metadata,
            approvalId: replacement.approval.id,
            executionDescriptorHash: currentRequest.executionDescriptor?.descriptorHash || null,
            noSpendOccurred: true,
            approvalRefreshHistory: [
              ...history,
              {
                priorApprovalId: approval.id,
                replacementApprovalId: replacement.approval.id,
                reason: validation.reason,
                refreshedAt,
              },
            ],
          }),
          costId,
        ],
      );
    }
    insertEvent(db, {
      level: "warn",
      actor: options.trigger || "runtime-policy-refresh",
      type: "approval.safely_refreshed",
      entityType: "approval",
      entityId: replacement.approval.id,
      message: "An outdated AI-work decision was safely replaced before execution. No provider call or spend occurred.",
      metadata: {
        priorApprovalId: approval.id,
        replacementApprovalId: replacement.approval.id,
        taskId: task.id,
        reason: validation.reason,
        noSpendOccurred: true,
      },
    });
    return {
      refreshed: true,
      reason: validation.reason,
      priorApprovalId: approval.id,
      replacementApprovalId: replacement.approval.id,
      approval: replacement.approval,
      task: replacement.task,
      noSpendOccurred: true,
    };
  });
}

function refreshOutdatedLiveAiWorkerApprovals(db, options = {}) {
  const pending = all(
    db,
    `SELECT approvals.id
     FROM approvals
     JOIN tasks ON tasks.id = approvals.task_id
     WHERE approvals.status = 'pending'
       AND approvals.consumed_at IS NULL
       AND approvals.scope = 'live_ai_worker_spend'
       AND tasks.kind = 'live_ai_worker_execution'
     ORDER BY approvals.requested_at, approvals.id`,
  );
  const refreshed = [];
  const unchanged = [];
  for (const row of pending) {
    try {
      const result = refreshOutdatedLiveAiWorkerApproval(db, row.id, options);
      if (result.refreshed) refreshed.push(result);
      else unchanged.push({ approvalId: row.id, reason: result.reason });
    } catch (error) {
      unchanged.push({ approvalId: row.id, reason: error.message, failed: true });
      insertEvent(db, {
        level: "error",
        actor: options.trigger || "runtime-policy-refresh",
        type: "approval.refresh_failed",
        entityType: "approval",
        entityId: row.id,
        message: "Pantheon could not safely refresh an outdated AI-work decision. It remains blocked for review.",
        metadata: { approvalId: row.id, reason: error.message, noSpendOccurred: true },
      });
    }
  }
  return { refreshed, unchanged };
}

function requestLiveAiWorker(db, workflowId, options = {}) {
  const workflowRow = get(db, "SELECT * FROM workflows WHERE id = ?", [workflowId]);
  const requestSuffix = options.requestKey ? `_${safeId(options.requestKey)}` : "";
  const taskId = `task_live_worker_${safeId(workflowId)}${requestSuffix}`;
  const authority = preflightCommercialWrite(db, {
    workflow: workflowRow,
    workflowId,
    options,
    rootTexts: [
      options.taskTitle,
      options.approvalTitle,
      options.reason,
      options.expectedOutput,
      options.expectedMetric,
    ],
    taskId,
    taskKind: "live_ai_worker_execution",
    taskTitle: options.taskTitle || "Live AI worker request",
  });
  const workflow = hydrateWorkflow(workflowRow);
  const commercialTestContract = authority.commercialTestContract;
  const existingTaskRow = get(db, "SELECT * FROM tasks WHERE id = ?", [taskId]);
  requireExistingCommercialTaskBinding(db, {
    task: existingTaskRow,
    workflow: workflowRow,
    workflowSafety: authority.workflowSafety,
  });
  ensureAiTeam(db);

  const command = latestCommand(db, workflowId);
  const sourceTask = sourceWorkerTask(db, workflowId);
  const workerDefinition = normalizeRequestedWorker(options, sourceTask);
  const persistedWorkerDefinition = get(db, "SELECT * FROM agent_definitions WHERE id = ?", [workerDefinition.id]);
  const actualWorkerDefinition = persistedWorkerDefinition || workerDefinition;
  const workerApprovalPolicy = canonicalWorkerApprovalPolicy(actualWorkerDefinition);
  const actualWorkerDefinitionHash = workerDefinitionHash(actualWorkerDefinition);
  if (options.disableVentureContext === true) {
    throw new Error("Task-scoped venture context cannot be disabled by a live-worker request.");
  }
  const businessContext = options.businessContext || {};
  const subject = businessContext.subject || workflow.metadata.subject || sourceTask?.payload?.subject || workflow.title || "this business idea";
  const channel = businessContext.channel || workflow.metadata.channel || sourceTask?.payload?.channel || workflow.type || "Business Idea";
  const amountCents = normalizeBudgetCents(options.estimatedCostCents);
  const ts = now();
  const approvalId = approvalIdForRequest(db, taskId, workflowId, ts);
  const title = options.taskTitle || `Live ${workerDefinition.name} test for ${subject}`;
  const reason = options.reason || "A live OpenAI-backed worker should only run after the dry-run path is reviewable, the cost cap is accepted, and provider readiness passes.";
  const expectedOutput = options.expectedOutput || "A concise operator decision summary with evidence, next money move, risk, cost, and review controls.";
  const protectedEvidence = Array.isArray(options.protectedEvidence) ? options.protectedEvidence.filter(Boolean).slice(0, 8) : [];
  const comparisonSource = options.comparisonSource || null;
  const expectedMetric = options.expectedMetric || "Compare live output quality, trace coverage, cost, and usefulness against protected worker proof.";
  const toolControls = requestedToolControls(options);
  const maxOutputTokens = Number(options.maxOutputTokens || CONFIG.liveModelMaxOutputTokens || 1200);
  const contextException = exactSuppliedEvidenceFixtureException(
    db,
    workflow,
    command,
    sourceTask,
    workerDefinition,
    options,
    {
      amountCents,
      maxOutputTokens,
      ...toolControls,
    },
  );
  const commercialContextScope = options.parameters?.pantheonCommercial || {};
  const productionContextScope = options.parameters?.pantheonProduction || {};
  const productBuildContextScope = options.parameters?.productBuildSpec || {};
  const journeyContextScope = options.parameters?.pantheonJourney || {};
  const contextSnapshot = contextException
    ? null
    : buildAgentContextSnapshot(db, {
      ventureId: workflow.venture_id,
      workflowId,
      taskId,
      agentId: workerDefinition.id,
      purpose: options.contextPurpose || expectedOutput,
      subject,
      buyer: businessContext.buyer,
      problem: businessContext.problem,
      offer: businessContext.offer,
      channel,
      jurisdiction: businessContext.jurisdiction || options.jurisdiction,
      recordClasses: options.contextClasses,
      includePersonalData: options.includePersonalData === true,
      journeyId: journeyContextScope.journeyId
        || commercialContextScope.journeyId
        || productionContextScope.journeyId,
      roundId: commercialContextScope.roundId
        || productionContextScope.roundId,
      opportunityId: productBuildContextScope.opportunityId
        || commercialContextScope.opportunityId
        || productionContextScope.opportunityId,
      planId: productBuildContextScope.planId
        || productionContextScope.planId,
    });
  const tracePolicy = normalizeTracePolicy(
    contextSnapshot?.includePersonalData
      ? {
        ...options,
        tracePolicy: {
          ...(options.tracePolicy || {}),
          providerResponseStored: false,
          providerTraceContent: false,
        },
      }
      : options,
  );
  const proofMode = options.proofMode === true || CONFIG.systemProofMode === true;
  const toolArguments = JSON.parse(JSON.stringify(options.toolArguments || {}));
  const workBrief = cleanWorkBrief(options.workBrief);
  const pantheonSupervisorOwned = options.parameters?.pantheonCommercial?.supervisorOwned === true
    || options.parameters?.pantheonProduction?.supervisorOwned === true;
  const qualityReviewedWorker = !pantheonSupervisorOwned
    && ["product_builder", "copy_conversion_agent", "distribution_operator"].includes(workerDefinition.id);
  const manualApprovalRequired = options.manualApprovalRequired === true
    || options.parameters?.manualApprovalRequired === true
    || options.parameters?.operatorChoiceRequired === true;
  const requestParameters = {
    ...(options.parameters || {}),
    ...(manualApprovalRequired ? { manualApprovalRequired: true } : {}),
    ...(qualityReviewedWorker ? { requiredReviewer: "quality_reviewer" } : {}),
  };
  const effects = Array.isArray(options.effects) ? options.effects : [];
  if (
    proofMode
    && (
      effects.length > 0
      || options.highConsequence === true
      || options.qualityEscalation === true
    )
  ) {
    throw new Error("System proof mode cannot run consequential work or any action with external effects.");
  }
  const provider = options.provider || CONFIG.liveModelProvider;
  const routeSignature = createModelRouteSignature({
    workerId: workerDefinition.id,
    capabilityKey: modelCapabilityKey(options, workerDefinition, contextException, proofMode),
    tools: toolControls.tools,
  });
  const routeHistory = readModelRouteHistory(db, routeSignature);
  const selectedModelRoute = selectModelRoute({
    model: proofMode ? CONFIG.lunaModel : options.model,
    modelClass: workerDefinition.modelClass,
    highConsequence: options.highConsequence === true,
    qualityEscalation: options.qualityEscalation === true,
    proofMode,
    modelLocked: options.modelLocked === true,
    routeHistory,
  });
  const modelRoute = {
    ...selectedModelRoute,
    capabilityKey: routeSignature.capabilityKey,
    toolSignature: routeSignature.toolSignature,
    historySignature: routeSignature.historySignature,
  };
  const model = modelRoute.model;
  const hasHostedTool = toolControls.tools.some((toolId) => !LOCAL_CONTEXT_TOOLS.has(toolId));
  const maxInputTokens = hasHostedTool
    ? Number(options.maxInputTokens || CONFIG.liveModelToolMaxInputTokens)
    : options.maxInputTokens;
  if (hasHostedTool && maxInputTokens > CONFIG.liveModelToolMaxInputTokens) {
    throw new Error("Live execution is blocked because the requested input ceiling exceeds the approved hosted-tool limit.");
  }
  const payload = {
    ...(commercialTestContract ? { commercialTestContract } : {}),
    requestKey: options.requestKey ? safeId(options.requestKey) : null,
    subject,
    channel,
    buyer: String(businessContext.buyer || ""),
    problem: String(businessContext.problem || ""),
    offer: String(businessContext.offer || ""),
    evidenceStandard: String(businessContext.evidenceStandard || ""),
    sourceTaskId: sourceTask?.id || null,
    commandId: command?.id || null,
    requestedAt: ts,
    requestedBy: options.requestedBy || "operator",
    systemProof: proofMode,
    workerMode: "live-ai-worker",
    requestedWorker: workerDefinition.id,
    requestedWorkerName: workerDefinition.name,
    requestedWorkerRole: workerDefinition.role,
    requestedWorkerModelClass: workerDefinition.modelClass,
    expectedOutput,
    comparisonSource,
    pilotFixture: contextException ? {
      ...contextException.fixtureInput,
      baselineExcluded: true,
    } : null,
    protectedEvidence,
    expectedMetric,
    contextSnapshot,
    ventureContextException: contextException?.binding || null,
    workBrief,
    ...(options.chiefOrchestration ? { chiefOrchestration: options.chiefOrchestration } : {}),
    liveSpendRequest: {
      requested: true,
      approvalId,
      type: "live_ai_worker",
      provider,
      model,
      modelRoute,
      scope: "live_ai_worker_spend",
      title: options.approvalTitle || `Approve live ${workerDefinition.name} test for ${subject}`,
      estimatedCostCents: amountCents,
      riskLevel: amountCents >= 500 ? "medium" : "low",
      reason,
      commercialPurpose: "Prove an OpenAI-backed specialist worker can produce a business decision output while respecting cost, trace, and approval controls.",
      comparisonSource,
      protectedEvidence,
      expectedMetric,
      fixtureHash: contextException?.binding.fixtureHash || null,
      tools: toolControls.tools,
      toolArguments,
      parameters: {
        ...requestParameters,
        ...(proofMode ? {
          systemProof: {
            enabled: true,
            purpose: "Check the operating path with the lowest-cost model.",
            commercialQualityClaimAllowed: false,
          },
        } : {}),
        ...(contextSnapshot ? {
          contextSnapshot: {
            id: contextSnapshot.id,
            hash: contextSnapshot.snapshotHash,
            policyVersion: contextSnapshot.policyVersion,
            accessProfile: contextSnapshot.accessProfile,
            recordClasses: contextSnapshot.recordClasses,
            recordCount: contextSnapshot.recordCount,
          },
        } : {}),
        ...(contextException ? { ventureContextException: contextException.binding } : {}),
        modelRoute: {
          tier: modelRoute.tier,
          policyVersion: modelRoute.policyVersion,
          reason: modelRoute.reason,
          capabilityKey: modelRoute.capabilityKey,
          toolSignature: modelRoute.toolSignature,
          historySignature: modelRoute.historySignature,
          routeHistory: modelRoute.routeHistory,
          selectedBeforeApproval: true,
          automaticFallbackAllowed: false,
          automaticRetryAllowed: false,
          proofMode,
          modelLocked: modelRoute.modelLocked === true,
        },
      },
      maxTurns: toolControls.maxTurns,
      maxToolCalls: toolControls.maxToolCalls,
      deadlineMs: toolControls.deadlineMs,
      maxInputTokens: maxInputTokens || null,
      maxOutputTokens,
      maxCostCents: amountCents,
      effects,
      tracePolicy,
      requiresProviderEnv: "OPENAI_API_KEY",
      requiresLiveFlag: toolControls.flags,
      requiresRuntimeCapability: "openai_agents_sdk_runner",
      worker: {
        id: workerDefinition.id,
        name: workerDefinition.name,
        role: workerDefinition.role,
        modelClass: workerDefinition.modelClass,
        outputContract: workerDefinition.outputContract,
        approvalPolicy: workerApprovalPolicy,
        approvalPolicyHash: scopeHash(workerApprovalPolicy),
        definitionHash: actualWorkerDefinitionHash,
      },
    },
  };
  const descriptorTask = {
    id: taskId,
    workflow_id: workflowId,
    venture_id: workflow.venture_id,
    title,
    kind: "live_ai_worker_execution",
    agent: workerDefinition.id,
    cost_budget_cents: amountCents,
    payload,
    result: {},
  };
  const agentHarness = buildAgentHarnessDescriptor({
    id: workerDefinition.id,
    definitionHash: actualWorkerDefinitionHash,
  });
  const traceGroup = buildAgentTraceGroup(descriptorTask);
  payload.liveSpendRequest.agentHarness = agentHarness;
  payload.liveSpendRequest.traceGroup = traceGroup;
  if (toolControls.tools.includes("visual_asset_review")) {
    const capabilityPlan = buildAgentsSdkCapabilityPlan(descriptorTask, workerDefinition);
    const approvedAssetBinding = buildVisualAssetApprovalBinding(db, descriptorTask, capabilityPlan);
    payload.liveSpendRequest.parameters.approvedAssetBinding = approvedAssetBinding;
    payload.liveSpendRequest.toolArguments.visual_asset_review = {
      ...(payload.liveSpendRequest.toolArguments.visual_asset_review || {}),
      approvedAssetBinding,
    };
  }
  const materializedPacket = buildWorkerModelPacket(db, descriptorTask, workerDefinition);
  const materializedInputTokens = estimateInputTokensUpperBound(materializedPacket, 2200);
  const pricedMaxInputTokens = options.repriceChangedInput === true
    ? Math.max(Number(maxInputTokens || 0), materializedInputTokens)
    : maxInputTokens;
  const worstCaseCost = worstCaseExecutionCostAud({
    model,
    materializedInput: materializedPacket,
    inputOverheadTokens: 2200,
    maxInputTokens: pricedMaxInputTokens,
    maxOutputTokens,
    maxTurns: toolControls.maxTurns,
    tools: toolControls.tools,
    toolArguments: payload.liveSpendRequest.toolArguments,
    maxToolCalls: toolControls.maxToolCalls,
    audPerUsd: options.audPerUsd,
  });
  if (worstCaseCost.amountCents > amountCents) {
    throw new Error(`Live execution is blocked because its priced worst-case cost is ${worstCaseCost.amountCents} AUD cents, above the ${amountCents}-cent cap.`);
  }
  payload.liveSpendRequest.maxInputTokens = worstCaseCost.maxInputTokensPerTurn;
  payload.liveSpendRequest.pricedWorstCaseCostCents = worstCaseCost.amountCents;
  payload.liveSpendRequest.executionDescriptor = createExecutionDescriptor({
    kind: "live_ai_worker",
    provider,
    model,
    workerId: workerDefinition.id,
    workerDefinitionHash: actualWorkerDefinitionHash,
    workerApprovalPolicy,
    workerApprovalPolicyHash: scopeHash(workerApprovalPolicy),
    agentHarness,
    traceGroup,
    materializedInputHash: scopeHash(materializedPacket),
    sourceStateHash: stableWorkerPacketHash(materializedPacket),
    materializedInput: materializedPacket,
    tools: toolControls.tools,
    toolArguments: payload.liveSpendRequest.toolArguments,
    parameters: payload.liveSpendRequest.parameters,
    limits: {
      maxInputTokens: worstCaseCost.maxInputTokensPerTurn,
      maxOutputTokens,
      maxTurns: toolControls.maxTurns,
      maxToolCalls: toolControls.maxToolCalls,
      deadlineMs: toolControls.deadlineMs,
    },
    tracePolicy,
    preflightRequirements: {
      providerEnv: ["OPENAI_API_KEY"],
      liveFlags: toolControls.flags,
      runtimeCapabilities: ["openai_agents_sdk_runner"],
    },
    externalEffects: effects,
    maxCostCents: amountCents,
    worstCaseCost,
  });
  const result = {
    note: `${workerDefinition.name} live worker requested. Execution is blocked until spend approval and provider readiness pass.`,
    approvalId,
    estimatedCostCents: amountCents,
    pricedWorstCaseCostCents: worstCaseCost.amountCents,
    provider: payload.liveSpendRequest.provider,
    model: payload.liveSpendRequest.model,
    modelRoute,
    requestedWorker: {
      id: workerDefinition.id,
      name: workerDefinition.name,
      role: workerDefinition.role,
      modelClass: workerDefinition.modelClass,
    },
    officialGuidance: "Use the OpenAI Agents SDK as the first-class runner for narrow workers, manager-controlled orchestration, traces, guardrails, and resumable approvals before wider live execution.",
    comparisonSource,
    protectedEvidence,
    expectedMetric,
    contextSnapshot: contextSnapshot ? {
      id: contextSnapshot.id,
      hash: contextSnapshot.snapshotHash,
      accessProfile: contextSnapshot.accessProfile,
      recordClasses: contextSnapshot.recordClasses,
      recordCount: contextSnapshot.recordCount,
    } : null,
    ventureContextException: contextException?.binding || null,
  };

  const existing = hydrateTask(existingTaskRow);
  if (!existing) {
    run(
      db,
      `INSERT INTO tasks
       (id, workflow_id, venture_id, title, kind, agent, status, priority, max_retries, approval_id, cost_budget_cents, payload, result, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        taskId,
        workflowId,
        workflow.venture_id,
        title,
        "live_ai_worker_execution",
        workerDefinition.id,
        "queued",
        3,
        0,
        null,
        amountCents,
        toJson(payload),
        toJson(result),
        ts,
        ts,
      ],
    );
  } else if (!["completed", "running"].includes(existing.status)) {
    const executionEvidence = get(
      db,
      `SELECT
         (SELECT COUNT(*) FROM task_attempts WHERE task_id = ?) AS attempts,
         (SELECT COUNT(*) FROM model_calls WHERE task_id = ?) AS model_calls,
         (SELECT COUNT(*) FROM agent_runs WHERE task_id = ?) AS agent_runs,
         (SELECT COUNT(*) FROM costs
          WHERE task_id = ? AND status IN ('incurred_estimate', 'unknown', 'reconciled')) AS costs`,
      [taskId, taskId, taskId, taskId],
    );
    if (Object.values(executionEvidence || {}).some((count) => Number(count || 0) > 0)) {
      throw new Error("This AI work item already has execution evidence and cannot be reused. Prepare a new exact request.");
    }
    run(
      db,
      `UPDATE tasks
       SET title = ?, kind = 'live_ai_worker_execution', agent = ?, status = 'queued', priority = 3,
           max_retries = 0, approval_id = NULL, cost_budget_cents = ?, payload = ?, result = ?, error = NULL, updated_at = ?
       WHERE id = ?`,
      [title, workerDefinition.id, amountCents, toJson(payload), toJson(result), ts, taskId],
    );
  }
  if (contextSnapshot) persistAgentContextSnapshot(db, contextSnapshot);

  insertEvent(db, {
    level: "warn",
    actor: "operator",
    type: "live_ai_worker.requested",
    entityType: "workflow",
    entityId: workflowId,
    message: `Live ${workerDefinition.name} test requested for ${subject}; approval and provider readiness are required before any spend.`,
    metadata: {
      workflowId,
      taskId,
      approvalId,
      estimatedCostCents: amountCents,
      provider: payload.liveSpendRequest.provider,
      model: payload.liveSpendRequest.model,
      modelTier: modelRoute.label,
      modelRouteReason: modelRoute.reason,
      workerId: workerDefinition.id,
      workerName: workerDefinition.name,
      contextSnapshotId: contextSnapshot?.id || null,
      contextSnapshotHash: contextSnapshot?.snapshotHash || null,
      contextRecordClasses: contextSnapshot?.recordClasses || [],
      contextRecordCount: contextSnapshot?.recordCount || 0,
      ventureContextExceptionId: contextException?.binding.id || null,
      modelRouteHistorySignature: modelRoute.historySignature,
      modelRoutePriorDecision: modelRoute.routeHistory?.decision || "normal",
    },
  });

  const task = hydrateTask(get(db, "SELECT * FROM tasks WHERE id = ?", [taskId]));
  const spendGate = ensureSpendApproval(db, task);
  const updatedTask = hydrateTask(get(db, "SELECT * FROM tasks WHERE id = ?", [taskId]));

  return {
    status: spendGate.required && !spendGate.approved ? "blocked" : "queued",
    task: updatedTask,
    approval: spendGate.approval || null,
    spendGate,
    estimatedCostCents: amountCents,
    provider: payload.liveSpendRequest.provider,
    model: payload.liveSpendRequest.model,
    modelRoute,
    worker: {
      id: workerDefinition.id,
      name: workerDefinition.name,
      role: workerDefinition.role,
      modelClass: workerDefinition.modelClass,
    },
  };
}

function defaultSmokeInstruction() {
  return [
    "Live AI worker smoke test: prepare a tiny digital-product business decision without publishing or spending beyond the approved model cap.",
    "Idea: premium Notion cashflow checklist for freelancers who want a weekly money-control habit.",
    "Goal: prove the live worker rail can request approval, respect cost caps, capture traces, and return a clear approve, revise, or deny recommendation.",
  ].join(" ");
}

function retiredLiveSmokeError(pathName) {
  const error = new Error(
    `${pathName} is permanently retired because caller-defined smoke text could create unbound commercial work, approvals, and cost records.`,
  );
  error.code = "commercial_route_retired";
  error.statusCode = 410;
  return error;
}

function runningUnderNodeTest() {
  return Boolean(process.env.NODE_TEST_CONTEXT)
    || process.execArgv.some((argument) => (
      argument === "--test" || argument.startsWith("--test-")
    ));
}

function createLiveAiWorkerSmokeTestOperation(db, options = {}) {
  const estimatedCostCents = normalizeBudgetCents(options.estimatedCostCents || Math.min(Number(CONFIG.liveModelDefaultBudgetCents || 100), 100));
  const planned = createCommandPlan(db, {
    text: options.text || defaultSmokeInstruction(),
    source: "live-ai-worker-smoke-test",
    createFiles: false,
  });
  const liveWorker = requestLiveAiWorker(db, planned.workflow.id, {
    estimatedCostCents,
    requestedBy: "operator",
    worker: options.worker || "demand_validator",
    reason: options.reason || "First live AI worker smoke test. Keep the cap tiny and prove approval, trace, and cost controls before any broader worker execution.",
  });
  insertEvent(db, {
    level: "warn",
    actor: "operator",
    type: "live_ai_worker.smoke_test_prepared",
    entityType: "workflow",
    entityId: planned.workflow.id,
    message: "Prepared a capped live AI worker smoke test. It remains blocked until approval and provider readiness pass.",
    metadata: { workflowId: planned.workflow.id, taskId: liveWorker.task?.id, approvalId: liveWorker.approval?.id, estimatedCostCents },
  });

  return {
    status: "prepared",
    command: planned.command,
    workflow: planned.workflow,
    liveWorker,
    estimatedCostCents,
  };
}

function createLiveAiWorkerSmokeTest() {
  throw retiredLiveSmokeError("createLiveAiWorkerSmokeTest");
}

function createLiveAiWorkerSmokeTestForTest(db, options = {}) {
  if (!runningUnderNodeTest()) {
    throw new Error("Live-AI smoke fixtures are available only inside Node's isolated test runner.");
  }
  return createLiveAiWorkerSmokeTestOperation(db, options);
}

module.exports = {
  DEMAND_VALIDATOR_FIXTURE_CAPABILITY,
  MIN_LIVE_AI_WORKER_BUDGET_CENTS,
  SUPPLIED_EVIDENCE_CONTEXT_EXCEPTION,
  createLiveAiWorkerSmokeTest,
  createLiveAiWorkerSmokeTestForTest,
  preDispatchRecoveryStatus,
  prepareReviewedLiveAiWorkerRetry,
  refreshOutdatedLiveAiWorkerApproval,
  refreshOutdatedLiveAiWorkerApprovals,
  requestLiveAiWorker,
};
