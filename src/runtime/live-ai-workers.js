const CONFIG = require("../config");
const { all, fromJson, get, insertEvent, now, randomId, run, toJson } = require("../db");
const { buildAgentContextSnapshot, persistAgentContextSnapshot } = require("./agent-context");
const { AI_TEAM_DEFINITIONS, ensureAiTeam } = require("./ai-team");
const { buildWorkerModelPacket } = require("./agent-model-contracts");
const { buildAgentsSdkCapabilityPlan, buildVisualAssetApprovalBinding } = require("./agent-sdk-capabilities");
const {
  canonicalWorkerApprovalPolicy,
  createExecutionDescriptor,
  scopeHash,
  validateApprovalScope,
  workerDefinitionHash,
} = require("./approval-scope");
const { worstCaseExecutionCostAud } = require("./model-pricing");
const {
  createModelRouteSignature,
  readModelRouteHistory,
  selectModelRoute,
} = require("./model-routing");
const { createCommandPlan } = require("./planner");
const { ensureSpendApproval } = require("./spend-gate");

const MIN_LIVE_AI_WORKER_BUDGET_CENTS = 40;
const MAX_LIVE_AI_WORKER_BUDGET_CENTS = 5000;
const DEMAND_VALIDATOR_FIXTURE_CAPABILITY = "demand_validator.reasoning_on_supplied_evidence";
const SUPPLIED_EVIDENCE_CONTEXT_EXCEPTION = Object.freeze({
  schema: "jarvis.agent-context-exception.v1",
  id: "demand-validator-versioned-supplied-evidence",
  policyVersion: "2026-07-17.1",
});
const SUPPLIED_EVIDENCE_EXPECTED_OUTPUT = "A structured recommendation with evidence, counterevidence, assumptions, price/channel hypothesis, smallest test, metric, stop rule, confidence and risks.";
const SUPPLIED_EVIDENCE_EXPECTED_METRIC = "Deterministic scope, source, structure and cost checks pass; Daniel separately judges commercial usefulness.";
const SUPPLIED_EVIDENCE_TRACE_PURPOSE = "Make the supplied fixture and structured recommendation reviewable in OpenAI traces while retaining the local audit record.";

function safeId(value) {
  return String(value || "workflow")
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .slice(0, 72);
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
  const brief = {
    objective: string(value.objective, 800),
    deliverable: string(value.deliverable, 800),
    assetPrompt: string(value.assetPrompt, 2400),
    constraints: list(value.constraints),
    acceptanceCriteria: list(value.acceptanceCriteria),
  };
  return Object.values(brief).some((item) => Array.isArray(item) ? item.length : item) ? brief : null;
}

function requestedToolControls(options = {}) {
  const tools = [...new Set(Array.isArray(options.tools) ? options.tools.filter(Boolean).map(String) : [])];
  const hasSearch = tools.some((toolId) => ["research_adapter", "live_web_with_approval"].includes(toolId));
  const hasImageGeneration = tools.includes("image_generation_spend");
  const flags = ["JARVIS_ENABLE_LIVE_MODELS"];
  if (hasSearch) flags.push("JARVIS_ENABLE_LIVE_RESEARCH");
  if (hasImageGeneration) flags.push("JARVIS_ENABLE_IMAGE_GENERATION");
  return {
    tools,
    flags,
    maxTurns: Number(options.maxTurns || (hasSearch ? 4 : hasImageGeneration ? 2 : 1)),
    maxToolCalls: Number(options.maxToolCalls ?? (hasSearch ? 3 : hasImageGeneration ? 1 : 0)),
    deadlineMs: Number(options.deadlineMs || (hasImageGeneration ? 180000 : hasSearch ? 120000 : 60000)),
  };
}

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

function modelCapabilityKey(options, workerDefinition, contextException) {
  if (contextException) return DEMAND_VALIDATOR_FIXTURE_CAPABILITY;
  const explicit = String(options.capabilityKey || "").trim();
  if (explicit) return explicit;
  if (workerDefinition.id === "chief_of_staff" && options.chiefOrchestration?.enabled === true) {
    return "chief_of_staff.next_bounded_specialist";
  }
  if (workerDefinition.id === "quality_reviewer" && options.parameters?.reviewOfTaskId) {
    return "quality_reviewer.exact_deliverable_review";
  }
  if (options.parameters?.chiefAssignment?.schema === "jarvis.chief-specialist-assignment.v1") {
    return `${workerDefinition.id}.chief_bounded_specialist`;
  }
  return `${workerDefinition.id}.live_assignment`;
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
    worker: payload.requestedWorker || request.worker?.id || task.agent,
    estimatedCostCents: Number(request.maxCostCents || request.estimatedCostCents || task.cost_budget_cents),
    requestedBy: trigger || "runtime-policy-refresh",
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

function refreshableApprovalReason(reason) {
  return [
    /execution descriptor has no exact worker policy binding/i,
    /worker approval policy changed after approval was requested/i,
    /worker definition changed after approval was requested/i,
    /paid work request uses an unsupported execution descriptor/i,
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
      throw new Error("The outdated decision changed while Jarvis was refreshing it.");
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
    const costId = `cost_spend_${safeId(task.id)}`;
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
        message: "Jarvis could not safely refresh an outdated AI-work decision. It remains blocked for review.",
        metadata: { approvalId: row.id, reason: error.message, noSpendOccurred: true },
      });
    }
  }
  return { refreshed, unchanged };
}

function requestLiveAiWorker(db, workflowId, options = {}) {
  const workflow = hydrateWorkflow(get(db, "SELECT * FROM workflows WHERE id = ?", [workflowId]));
  if (!workflow) throw new Error(`Workflow not found: ${workflowId}`);
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
  const requestSuffix = options.requestKey ? `_${safeId(options.requestKey)}` : "";
  const taskId = `task_live_worker_${safeId(workflowId)}${requestSuffix}`;
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
  const contextSnapshot = contextException
    ? null
    : buildAgentContextSnapshot(db, {
      ventureId: workflow.venture_id,
      workflowId,
      taskId,
      agentId: workerDefinition.id,
      purpose: options.contextPurpose || expectedOutput,
      recordClasses: options.contextClasses,
      includePersonalData: options.includePersonalData === true,
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
  const toolArguments = JSON.parse(JSON.stringify(options.toolArguments || {}));
  const workBrief = cleanWorkBrief(options.workBrief);
  const qualityReviewedWorker = ["product_builder", "copy_conversion_agent", "distribution_operator"].includes(workerDefinition.id);
  const requestParameters = {
    ...(options.parameters || {}),
    ...(qualityReviewedWorker ? { requiredReviewer: "quality_reviewer" } : {}),
  };
  const effects = Array.isArray(options.effects) ? options.effects : [];
  const provider = options.provider || CONFIG.liveModelProvider;
  const routeSignature = createModelRouteSignature({
    workerId: workerDefinition.id,
    capabilityKey: modelCapabilityKey(options, workerDefinition, contextException),
    tools: toolControls.tools,
  });
  const routeHistory = readModelRouteHistory(db, routeSignature);
  const selectedModelRoute = selectModelRoute({
    model: options.model,
    modelClass: workerDefinition.modelClass,
    highConsequence: options.highConsequence === true,
    qualityEscalation: options.qualityEscalation === true,
    routeHistory,
  });
  const modelRoute = {
    ...selectedModelRoute,
    capabilityKey: routeSignature.capabilityKey,
    toolSignature: routeSignature.toolSignature,
    historySignature: routeSignature.historySignature,
  };
  const model = modelRoute.model;
  const maxInputTokens = toolControls.tools.length
    ? Number(options.maxInputTokens || CONFIG.liveModelToolMaxInputTokens)
    : options.maxInputTokens;
  if (toolControls.tools.length && maxInputTokens > CONFIG.liveModelToolMaxInputTokens) {
    throw new Error("Live execution is blocked because the requested input ceiling exceeds the approved hosted-tool limit.");
  }
  const payload = {
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
  const worstCaseCost = worstCaseExecutionCostAud({
    model,
    materializedInput: materializedPacket,
    inputOverheadTokens: 2200,
    maxInputTokens,
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

  const existing = hydrateTask(get(db, "SELECT * FROM tasks WHERE id = ?", [taskId]));
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

function createLiveAiWorkerSmokeTest(db, options = {}) {
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

module.exports = {
  DEMAND_VALIDATOR_FIXTURE_CAPABILITY,
  MIN_LIVE_AI_WORKER_BUDGET_CENTS,
  SUPPLIED_EVIDENCE_CONTEXT_EXCEPTION,
  createLiveAiWorkerSmokeTest,
  refreshOutdatedLiveAiWorkerApproval,
  refreshOutdatedLiveAiWorkerApprovals,
  requestLiveAiWorker,
};
