const CONFIG = require("../config");
const { all, fromJson, get } = require("../db");

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

function getLiveResearchReadiness(db) {
  const integrations = parseRows(all(db, "SELECT * FROM integrations ORDER BY name ASC"));
  const approvals = parseRows(all(db, "SELECT * FROM approvals ORDER BY requested_at DESC"), ["payload"]);
  const tasks = parseRows(all(db, "SELECT * FROM tasks ORDER BY updated_at DESC"));
  const costs = parseRows(all(db, "SELECT * FROM costs ORDER BY occurred_at DESC LIMIT 120"));
  const budget = setting(db, "budget", { monthlyBudgetCents: CONFIG.monthlyBudgetCents, currency: CONFIG.currency });
  const monthlySpendCents = centsThisMonth(db);
  const remainingBudgetCents = Number(budget.monthlyBudgetCents || CONFIG.monthlyBudgetCents) - monthlySpendCents;
  const openaiIntegration = integrations.find((integration) => integration.id === "openai");
  const liveResearchIntegration = integrations.find((integration) => integration.id === "live_research");
  const liveResearchTasks = tasks.filter((task) => task.kind === "live_market_research");
  const pendingApprovals = approvals.filter((approval) => approval.scope === "live_research_spend" && approval.status === "pending");
  const approvedApprovals = approvals.filter((approval) => approval.scope === "live_research_spend" && approval.status === "approved");
  const completedRuns = all(db, "SELECT COUNT(*) AS count FROM research_runs WHERE status = 'completed_live'")[0]?.count || 0;
  const failedRuns = all(db, "SELECT COUNT(*) AS count FROM research_runs WHERE status = 'failed_live'")[0]?.count || 0;

  const credentialsConfigured = Boolean(process.env.OPENAI_API_KEY) && openaiIntegration?.health === "ok";
  const liveFlagEnabled = process.env.JARVIS_ENABLE_LIVE_RESEARCH === "1";
  const adapterReady = process.env.JARVIS_DISABLE_LIVE_RESEARCH_ADAPTER !== "1";
  const budgetReady = remainingBudgetCents >= Number(CONFIG.liveResearchDefaultBudgetCents || 0);
  const ready = credentialsConfigured && liveFlagEnabled && adapterReady && budgetReady;

  const blockers = [];
  if (!credentialsConfigured) blockers.push("OpenAI API key is not configured for this runtime process.");
  if (!liveFlagEnabled) blockers.push("JARVIS_ENABLE_LIVE_RESEARCH is not enabled.");
  if (!adapterReady) blockers.push("Live research adapter is disabled by JARVIS_DISABLE_LIVE_RESEARCH_ADAPTER.");
  if (!budgetReady) blockers.push("Monthly budget remaining is below the default live research cap.");

  return {
    provider: CONFIG.liveResearchProvider,
    model: CONFIG.liveResearchModel,
    currency: CONFIG.currency,
    defaultBudgetCents: Number(CONFIG.liveResearchDefaultBudgetCents || 0),
    monthlyBudgetCents: Number(budget.monthlyBudgetCents || CONFIG.monthlyBudgetCents),
    monthlySpendCents,
    remainingBudgetCents,
    credentialsConfigured,
    liveFlagEnabled,
    adapterReady,
    budgetReady,
    ready,
    status: ready ? "ready" : "blocked",
    blockers,
    canPrepareSmokeTest: true,
    canExecuteApprovedTask: ready && approvedApprovals.length > 0,
    pendingApprovals: pendingApprovals.length,
    approvedApprovals: approvedApprovals.length,
    smokeTests: liveResearchTasks.length,
    blockedTasks: liveResearchTasks.filter((task) => task.status === "blocked").length,
    completedLiveRuns: Number(completedRuns),
    failedLiveRuns: Number(failedRuns),
    latestTaskId: liveResearchTasks[0]?.id || null,
    latestApprovalId: pendingApprovals[0]?.id || approvedApprovals[0]?.id || null,
    integration: liveResearchIntegration || null,
    checklist: [
      checklistItem(
        "openai_key",
        "OpenAI API key",
        credentialsConfigured,
        credentialsConfigured ? "Configured in the runtime environment." : "Missing from this runtime process.",
        "Set OPENAI_API_KEY outside the repo.",
      ),
      checklistItem(
        "live_flag",
        "Live research flag",
        liveFlagEnabled,
        liveFlagEnabled ? "JARVIS_ENABLE_LIVE_RESEARCH=1." : "Live research is deliberately disabled.",
        "Set JARVIS_ENABLE_LIVE_RESEARCH=1 only when ready for approved spend.",
      ),
      checklistItem(
        "adapter",
        "Adapter code",
        adapterReady,
        adapterReady ? "OpenAI web-search adapter is available." : "Adapter is disabled by environment flag.",
        "Unset JARVIS_DISABLE_LIVE_RESEARCH_ADAPTER.",
      ),
      checklistItem(
        "budget",
        "Budget room",
        budgetReady,
        budgetReady ? "Default live research cap fits inside monthly remaining budget." : "Monthly budget remaining is below the default live research cap.",
        "Lower the cap or increase the monthly budget after review.",
      ),
      checklistItem(
        "approval",
        "Per-run approval",
        pendingApprovals.length > 0 || approvedApprovals.length > 0,
        pendingApprovals.length > 0
          ? `${pendingApprovals.length} live research approval waiting.`
          : approvedApprovals.length > 0
            ? `${approvedApprovals.length} live research approval approved.`
            : "No live research approval is currently queued.",
        "Prepare a smoke test or request live research from a workflow.",
      ),
    ],
  };
}

module.exports = {
  getLiveResearchReadiness,
};
