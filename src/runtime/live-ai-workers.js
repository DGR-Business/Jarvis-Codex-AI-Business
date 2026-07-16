const CONFIG = require("../config");
const { fromJson, get, insertEvent, now, run, toJson } = require("../db");
const { AI_TEAM_DEFINITIONS } = require("./ai-team");
const { createCommandPlan } = require("./planner");
const { ensureSpendApproval } = require("./spend-gate");

const MIN_LIVE_AI_WORKER_BUDGET_CENTS = 40;
const MAX_LIVE_AI_WORKER_BUDGET_CENTS = 5000;

function safeId(value) {
  return String(value || "workflow")
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .slice(0, 72);
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

function approvalIdForRequest(db, taskId, workflowId, requestedAt) {
  const existing = hydrateTask(get(db, "SELECT * FROM tasks WHERE id = ?", [taskId]));
  const existingApprovalId = existing?.payload?.liveSpendRequest?.approvalId;
  if (existingApprovalId) {
    const approval = get(db, "SELECT status FROM approvals WHERE id = ?", [existingApprovalId]);
    if (!approval || ["pending", "approved"].includes(approval.status)) return existingApprovalId;
  }
  return `appr_live_worker_${safeId(workflowId)}_${safeId(requestedAt)}`;
}

function requestLiveAiWorker(db, workflowId, options = {}) {
  const workflow = hydrateWorkflow(get(db, "SELECT * FROM workflows WHERE id = ?", [workflowId]));
  if (!workflow) throw new Error(`Workflow not found: ${workflowId}`);

  const command = latestCommand(db, workflowId);
  const sourceTask = sourceWorkerTask(db, workflowId);
  const workerDefinition = normalizeRequestedWorker(options, sourceTask);
  const subject = workflow.metadata.subject || sourceTask?.payload?.subject || workflow.title || "this business idea";
  const channel = workflow.metadata.channel || sourceTask?.payload?.channel || workflow.type || "Business Idea";
  const amountCents = normalizeBudgetCents(options.estimatedCostCents);
  const ts = now();
  const taskId = `task_live_worker_${safeId(workflowId)}`;
  const approvalId = approvalIdForRequest(db, taskId, workflowId, ts);
  const title = options.taskTitle || `Live ${workerDefinition.name} test for ${subject}`;
  const reason = options.reason || "A live OpenAI-backed worker should only run after the dry-run path is reviewable, the cost cap is accepted, and provider readiness passes.";
  const protectedEvidence = Array.isArray(options.protectedEvidence) ? options.protectedEvidence.filter(Boolean).slice(0, 8) : [];
  const comparisonSource = options.comparisonSource || null;
  const expectedMetric = options.expectedMetric || "Compare live output quality, trace coverage, cost, and usefulness against protected worker proof.";
  const payload = {
    subject,
    channel,
    sourceTaskId: sourceTask?.id || null,
    commandId: command?.id || null,
    requestedAt: ts,
    requestedBy: options.requestedBy || "operator",
    workerMode: "live-ai-worker",
    requestedWorker: workerDefinition.id,
    requestedWorkerName: workerDefinition.name,
    requestedWorkerRole: workerDefinition.role,
    requestedWorkerModelClass: workerDefinition.modelClass,
    expectedOutput: options.expectedOutput || "A concise operator decision summary with evidence, next money move, risk, cost, and review controls.",
    comparisonSource,
    pilotFixture: options.fixtureInput ? {
      ...options.fixtureInput,
      baselineExcluded: true,
    } : null,
    protectedEvidence,
    expectedMetric,
    liveSpendRequest: {
      requested: true,
      approvalId,
      type: "live_ai_worker",
      provider: options.provider || CONFIG.liveModelProvider,
      model: options.model || CONFIG.liveModel,
      scope: "live_ai_worker_spend",
      title: options.approvalTitle || `Approve live ${workerDefinition.name} test for ${subject}`,
      estimatedCostCents: amountCents,
      riskLevel: amountCents >= 500 ? "medium" : "low",
      reason,
      commercialPurpose: "Prove an OpenAI-backed specialist worker can produce a business decision output while respecting cost, trace, and approval controls.",
      comparisonSource,
      protectedEvidence,
      expectedMetric,
      fixtureHash: options.fixtureHash || null,
      tools: Array.isArray(options.tools) ? options.tools : [],
      toolArguments: options.toolArguments || {},
      parameters: options.parameters || {},
      maxTurns: Number(options.maxTurns || 1),
      maxOutputTokens: Number(options.maxOutputTokens || CONFIG.liveModelMaxOutputTokens || 1200),
      maxCostCents: amountCents,
      effects: Array.isArray(options.effects) ? options.effects : [],
      requiresProviderEnv: "OPENAI_API_KEY",
      requiresLiveFlag: "JARVIS_ENABLE_LIVE_MODELS",
      requiresRuntimeCapability: "openai_agents_sdk_runner",
      worker: {
        id: workerDefinition.id,
        name: workerDefinition.name,
        role: workerDefinition.role,
        modelClass: workerDefinition.modelClass,
        outputContract: workerDefinition.outputContract,
      },
    },
  };
  const result = {
    note: `${workerDefinition.name} live worker requested. Execution is blocked until spend approval and provider readiness pass.`,
    approvalId,
    estimatedCostCents: amountCents,
    provider: payload.liveSpendRequest.provider,
    model: CONFIG.liveModel,
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
      workerId: workerDefinition.id,
      workerName: workerDefinition.name,
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
    model: CONFIG.liveModel,
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
  MIN_LIVE_AI_WORKER_BUDGET_CENTS,
  createLiveAiWorkerSmokeTest,
  requestLiveAiWorker,
};
