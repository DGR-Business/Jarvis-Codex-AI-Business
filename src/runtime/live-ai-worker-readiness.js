const CONFIG = require("../config");
const { all, fromJson, get } = require("../db");
const { getAgentRuntimeReadiness } = require("./agent-runtime");

function parseRows(rows, fields = ["metadata", "payload", "result"]) {
  return rows.map((row) => {
    const copy = { ...row };
    for (const field of fields) {
      if (field in copy) copy[field] = fromJson(copy[field]);
    }
    return copy;
  });
}

function centsThisMonth(db) {
  const prefix = new Date().toISOString().slice(0, 7);
  const row = get(
    db,
    `SELECT COALESCE(SUM(amount_cents), 0) AS total
     FROM costs
     WHERE occurred_at LIKE ?`,
    [`${prefix}%`],
  );
  return Number(row?.total || 0);
}

function setting(db, key, fallback = {}) {
  const row = get(db, "SELECT value FROM settings WHERE key = ?", [key]);
  return row ? fromJson(row.value, fallback) : fallback;
}

function checklistItem(id, label, ok, detail, action = null) {
  return {
    id,
    label,
    status: ok ? "ready" : "blocked",
    ok: Boolean(ok),
    detail,
    action,
  };
}

function getLiveAiWorkerReadiness(db) {
  const integrations = parseRows(all(db, "SELECT * FROM integrations ORDER BY name ASC"));
  const approvals = parseRows(all(db, "SELECT * FROM approvals ORDER BY requested_at DESC"), ["payload"]);
  const tasks = parseRows(all(db, "SELECT * FROM tasks ORDER BY updated_at DESC"));
  const budget = setting(db, "budget", { monthlyBudgetCents: CONFIG.monthlyBudgetCents, currency: CONFIG.currency });
  const monthlySpendCents = centsThisMonth(db);
  const remainingBudgetCents = Number(budget.monthlyBudgetCents || CONFIG.monthlyBudgetCents) - monthlySpendCents;
  const openaiIntegration = integrations.find((integration) => integration.id === "openai");
  const aiWorkerIntegration = integrations.find((integration) => integration.id === "ai_workers");
  const agentRuntime = getAgentRuntimeReadiness();
  const liveWorkerTasks = tasks.filter((task) => task.kind === "live_ai_worker_execution");
  const pendingApprovals = approvals.filter((approval) => approval.scope === "live_ai_worker_spend" && approval.status === "pending");
  const approvedApprovals = approvals.filter((approval) => approval.scope === "live_ai_worker_spend" && approval.status === "approved");
  const completedLiveRuns = all(
    db,
    "SELECT COUNT(*) AS count FROM agent_runs WHERE mode IN ('live-ai-worker', 'openai-agents-sdk', 'live-agent') AND status = 'completed'",
  )[0]?.count || 0;
  const failedLiveRuns = all(
    db,
    "SELECT COUNT(*) AS count FROM agent_runs WHERE mode IN ('live-ai-worker', 'openai-agents-sdk', 'live-agent') AND status = 'failed'",
  )[0]?.count || 0;

  const credentialsConfigured = Boolean(process.env.OPENAI_API_KEY) && openaiIntegration?.health === "ok";
  const liveFlagEnabled = process.env.JARVIS_ENABLE_LIVE_MODELS === "1";
  const adapterReady = agentRuntime.ready;
  const budgetReady = remainingBudgetCents >= Number(CONFIG.liveModelDefaultBudgetCents || 0);
  const ready = credentialsConfigured && liveFlagEnabled && adapterReady && budgetReady;

  const blockers = [];
  if (!credentialsConfigured) blockers.push("OpenAI API key is not configured for this runtime process.");
  if (!liveFlagEnabled) blockers.push("JARVIS_ENABLE_LIVE_MODELS is not enabled.");
  if (!adapterReady) blockers.push(...agentRuntime.blockers);
  if (!budgetReady) blockers.push("Monthly budget remaining is below the default live AI worker cap.");

  return {
    provider: agentRuntime.primaryProvider,
    model: CONFIG.liveModel,
    currency: CONFIG.currency,
    defaultBudgetCents: Number(CONFIG.liveModelDefaultBudgetCents || 0),
    monthlyBudgetCents: Number(budget.monthlyBudgetCents || CONFIG.monthlyBudgetCents),
    monthlySpendCents,
    remainingBudgetCents,
    credentialsConfigured,
    liveFlagEnabled,
    adapterReady,
    agentRuntime,
    sdkRunnerReady: agentRuntime.primaryReady,
    responsesFallbackReady: agentRuntime.fallbackReady,
    budgetReady,
    ready,
    status: ready ? "ready" : "blocked",
    blockers,
    canPrepareSmokeTest: true,
    canExecuteApprovedTask: ready && approvedApprovals.length > 0,
    pendingApprovals: pendingApprovals.length,
    approvedApprovals: approvedApprovals.length,
    smokeTests: liveWorkerTasks.length,
    blockedTasks: liveWorkerTasks.filter((task) => task.status === "blocked").length,
    completedLiveRuns: Number(completedLiveRuns),
    failedLiveRuns: Number(failedLiveRuns),
    latestTaskId: liveWorkerTasks[0]?.id || null,
    latestApprovalId: pendingApprovals[0]?.id || approvedApprovals[0]?.id || null,
    integration: aiWorkerIntegration || null,
    checklist: [
      checklistItem(
        "openai_key",
        "OpenAI API key",
        credentialsConfigured,
        credentialsConfigured ? "Configured in the runtime environment." : "Missing from this runtime process.",
        "Set OPENAI_API_KEY outside the repo.",
      ),
      checklistItem(
        "live_model_flag",
        "Live worker flag",
        liveFlagEnabled,
        liveFlagEnabled ? "JARVIS_ENABLE_LIVE_MODELS=1." : "Live AI workers are deliberately disabled.",
        "Set JARVIS_ENABLE_LIVE_MODELS=1 only after approval controls are accepted.",
      ),
      checklistItem(
        "agent_runtime",
        "Agents SDK runner",
        adapterReady,
        adapterReady ? "The OpenAI Agents SDK runner is available for review-controlled worker tests." : agentRuntime.blockers.join(" "),
        "Install @openai/agents and zod, then keep JARVIS_DISABLE_OPENAI_AGENTS_SDK and JARVIS_DISABLE_LIVE_AI_WORKER_ADAPTER unset.",
      ),
      checklistItem(
        "budget",
        "Budget room",
        budgetReady,
        budgetReady ? "Default live worker cap fits inside monthly remaining budget." : "Monthly budget remaining is below the default live worker cap.",
        "Lower the cap or increase the monthly budget after review.",
      ),
      checklistItem(
        "approval",
        "Per-run approval",
        pendingApprovals.length > 0 || approvedApprovals.length > 0,
        pendingApprovals.length > 0
          ? `${pendingApprovals.length} live worker approval waiting.`
          : approvedApprovals.length > 0
            ? `${approvedApprovals.length} live worker approval approved.`
            : "No live worker approval is currently queued.",
        "Prepare a worker smoke test or request a live worker from a workflow.",
      ),
    ],
  };
}

module.exports = {
  getLiveAiWorkerReadiness,
};
