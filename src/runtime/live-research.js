const CONFIG = require("../config");
const { fromJson, get, insertEvent, now, randomId, run, toJson } = require("../db");
const { ensureSpendApproval } = require("./spend-gate");
const { createCommandPlan } = require("./planner");

const MIN_LIVE_RESEARCH_BUDGET_CENTS = 60;
const MAX_LIVE_RESEARCH_BUDGET_CENTS = 5000;

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
  const fallback = Number(CONFIG.liveResearchDefaultBudgetCents || 200);
  const parsed = Number(value);
  const selected = Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  return Math.max(MIN_LIVE_RESEARCH_BUDGET_CENTS, Math.min(MAX_LIVE_RESEARCH_BUDGET_CENTS, Math.round(selected)));
}

function latestCommand(db, workflowId) {
  return get(db, "SELECT * FROM commands WHERE workflow_id = ? ORDER BY created_at DESC LIMIT 1", [workflowId]);
}

function sourceResearchTask(db, workflowId) {
  return hydrateTask(
    get(
      db,
      `SELECT * FROM tasks
       WHERE workflow_id = ? AND kind = 'market_research'
       ORDER BY CASE status WHEN 'completed' THEN 0 ELSE 1 END, priority ASC, created_at ASC LIMIT 1`,
      [workflowId],
    ),
  );
}

function approvalIdForRequest(db, taskId, workflowId, requestedAt) {
  const existing = hydrateTask(get(db, "SELECT * FROM tasks WHERE id = ?", [taskId]));
  const existingApprovalId = existing?.payload?.liveSpendRequest?.approvalId;
  if (existingApprovalId) {
    const approval = get(db, "SELECT status FROM approvals WHERE id = ?", [existingApprovalId]);
    if (!approval || ["pending", "approved"].includes(approval.status)) return existingApprovalId;
  }
  return `appr_live_research_${safeId(workflowId)}_${safeId(requestedAt)}`;
}

function requestLiveResearch(db, workflowId, options = {}) {
  const workflow = hydrateWorkflow(get(db, "SELECT * FROM workflows WHERE id = ?", [workflowId]));
  if (!workflow) throw new Error(`Workflow not found: ${workflowId}`);

  const command = latestCommand(db, workflowId);
  const sourceTask = sourceResearchTask(db, workflowId);
  const subject = workflow.metadata.subject || sourceTask?.payload?.subject || workflow.title || "this business idea";
  const channel = workflow.metadata.channel || sourceTask?.payload?.channel || workflow.type || "Business Idea";
  const amountCents = normalizeBudgetCents(options.estimatedCostCents);
  const ts = now();
  const taskId = `task_live_research_${safeId(workflowId)}`;
  const approvalId = approvalIdForRequest(db, taskId, workflowId, ts);
  const title = `Live research evidence for ${subject}`;
  const reason = options.reason || "Current market, competitor, pricing, and risk evidence is required before treating this workflow as commercially validated.";
  const payload = {
    subject,
    channel,
    sourceTaskId: sourceTask?.id || null,
    commandId: command?.id || null,
    requestedAt: ts,
    requestedBy: options.requestedBy || "operator",
    researchMode: "live",
    liveSpendRequest: {
      requested: true,
      approvalId,
      type: "live_research",
      provider: options.provider || CONFIG.liveResearchProvider,
      scope: "live_research_spend",
      title: `Approve live research for ${subject}`,
      estimatedCostCents: amountCents,
      riskLevel: amountCents >= 500 ? "medium" : "low",
      reason,
      commercialPurpose: "Validate current demand, competitors, pricing, trend freshness, and risk before paid creation or publishing.",
      requiresProviderEnv: "OPENAI_API_KEY",
      requiresLiveFlag: "JARVIS_ENABLE_LIVE_RESEARCH",
      requiresRuntimeCapability: "live_research_adapter",
    },
  };
  const result = {
    note: "Live research requested. Execution is blocked until spend approval and provider readiness pass.",
    approvalId,
    estimatedCostCents: amountCents,
    provider: payload.liveSpendRequest.provider,
  };

  const existing = hydrateTask(get(db, "SELECT * FROM tasks WHERE id = ?", [taskId]));
  if (!existing) {
    run(
      db,
      `INSERT INTO tasks
       (id, workflow_id, title, kind, agent, status, priority, max_retries, approval_id, cost_budget_cents, payload, result, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        taskId,
        workflowId,
        title,
        "live_market_research",
        "researcher",
        "queued",
        2,
        1,
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
       SET title = ?, kind = 'live_market_research', agent = 'researcher', status = 'queued', priority = 2,
           max_retries = 1, approval_id = NULL, cost_budget_cents = ?, payload = ?, result = ?, error = NULL, updated_at = ?
       WHERE id = ?`,
      [title, amountCents, toJson(payload), toJson(result), ts, taskId],
    );
  }

  insertEvent(db, {
    level: "warn",
    actor: "operator",
    type: "live_research.requested",
    entityType: "workflow",
    entityId: workflowId,
    message: `Live research requested for ${subject}; approval and provider readiness are required before any spend.`,
    metadata: { workflowId, taskId, approvalId, estimatedCostCents: amountCents, provider: payload.liveSpendRequest.provider },
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
  };
}

function defaultSmokeInstruction() {
  return [
    "Live research smoke test: evaluate a low-risk digital product idea before any publishing or paid creation.",
    "Idea: premium Notion finance dashboard template for freelancers who want a simple monthly cashflow view.",
    "Goal: prove the live research adapter can capture current demand, competitor/pricing evidence, risks, and a keep/revise/kill recommendation with citations.",
  ].join(" ");
}

function createLiveResearchSmokeTest(db, options = {}) {
  const estimatedCostCents = normalizeBudgetCents(options.estimatedCostCents || Math.min(Number(CONFIG.liveResearchDefaultBudgetCents || 200), 100));
  const planned = createCommandPlan(db, {
    text: options.text || defaultSmokeInstruction(),
    source: "live-research-smoke-test",
    createFiles: false,
  });
  const liveResearch = requestLiveResearch(db, planned.workflow.id, {
    estimatedCostCents,
    requestedBy: "operator",
    reason: options.reason || "First live research smoke test. Keep the cap tiny and prove citations, cost logging, and approval controls before broader use.",
  });
  insertEvent(db, {
    level: "warn",
    actor: "operator",
    type: "live_research.smoke_test_prepared",
    entityType: "workflow",
    entityId: planned.workflow.id,
    message: "Prepared a capped live research smoke test. It remains blocked until approval and provider readiness pass.",
    metadata: { workflowId: planned.workflow.id, taskId: liveResearch.task?.id, approvalId: liveResearch.approval?.id, estimatedCostCents },
  });

  return {
    status: "prepared",
    command: planned.command,
    workflow: planned.workflow,
    liveResearch,
    estimatedCostCents,
  };
}

module.exports = {
  MIN_LIVE_RESEARCH_BUDGET_CENTS,
  createLiveResearchSmokeTest,
  requestLiveResearch,
};
