const CONFIG = require("../config");
const { all, fromJson, get } = require("../db");
const { monthlyBudgetExposure } = require("./cost-ledger");
const { modelPricing } = require("./model-pricing");
const {
  environmentDisabled,
  environmentEnabled,
  preferredEnvironmentName,
} = require("../adapters/pantheon-environment");
const { inspectOpenAiEgressPolicy } = require("../adapters/openai-egress-policy");

function parseRows(rows, fields = ["metadata", "payload", "result"]) {
  return rows.map((row) => {
    const copy = { ...row };
    for (const field of fields) {
      if (field in copy) copy[field] = fromJson(copy[field]);
    }
    return copy;
  });
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
  const budget = setting(db, "budget", { monthlyBudgetCents: CONFIG.monthlyBudgetCents, currency: CONFIG.currency });
  const budgetExposure = monthlyBudgetExposure(db);
  const monthlySpendCents = budgetExposure.totalCents;
  const remainingBudgetCents = Number(budget.monthlyBudgetCents || CONFIG.monthlyBudgetCents) - budgetExposure.totalCents;
  const liveResearchIntegration = integrations.find((integration) => integration.id === "live_research");
  const liveResearchTasks = tasks.filter((task) => task.kind === "live_market_research");
  const pendingApprovals = approvals.filter((approval) => approval.scope === "live_research_spend" && approval.status === "pending");
  const approvedApprovals = approvals.filter((approval) => approval.scope === "live_research_spend"
    && approval.status === "approved"
    && !approval.consumed_at
    && (!approval.expires_at || approval.expires_at > new Date().toISOString()));
  const completedRuns = all(db, "SELECT COUNT(*) AS count FROM research_runs WHERE status = 'completed_live'")[0]?.count || 0;
  const failedRuns = all(db, "SELECT COUNT(*) AS count FROM research_runs WHERE status = 'failed_live'")[0]?.count || 0;

  const credentialsConfigured = Boolean(process.env.OPENAI_API_KEY);
  const egressPolicy = inspectOpenAiEgressPolicy();
  const egressReady = egressPolicy.ready;
  const liveFlagEnabled = environmentEnabled("enableLiveResearch");
  const adapterReady = !environmentDisabled("disableLiveResearchAdapter");
  const pricingReady = Boolean(modelPricing(CONFIG.liveResearchModel));
  const budgetReady = remainingBudgetCents >= Number(CONFIG.liveResearchDefaultBudgetCents || 0);
  const ready = credentialsConfigured
    && egressReady
    && liveFlagEnabled
    && adapterReady
    && pricingReady
    && budgetReady;

  const blockers = [];
  if (!credentialsConfigured) blockers.push("Pantheon is not connected to an OpenAI API key in this running session.");
  if (!egressReady) blockers.push("The OpenAI network destination or TLS policy is not the approved secure configuration.");
  if (!liveFlagEnabled) blockers.push("Live research is turned off for this Pantheon runtime.");
  if (!adapterReady) blockers.push(`Pantheon's research connection is disabled by ${preferredEnvironmentName("disableLiveResearchAdapter")}.`);
  if (!pricingReady) blockers.push("The selected research model has no registered AUD safety pricing.");
  if (!budgetReady) blockers.push("Monthly budget remaining is below the default live research cap.");

  return {
    provider: CONFIG.liveResearchProvider,
    model: CONFIG.liveResearchModel,
    currency: CONFIG.currency,
    defaultBudgetCents: Number(CONFIG.liveResearchDefaultBudgetCents || 0),
    monthlyBudgetCents: Number(budget.monthlyBudgetCents || CONFIG.monthlyBudgetCents),
    monthlySpendCents,
    monthlyRealizedCents: budgetExposure.realizedCents,
    monthlyUnresolvedCents: budgetExposure.unresolvedCents,
    budgetExposure,
    remainingBudgetCents,
    credentialsConfigured,
    egressReady,
    egressPolicy,
    liveFlagEnabled,
    adapterReady,
    pricingReady,
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
        "OpenAI connection",
        credentialsConfigured,
        credentialsConfigured ? "Pantheon can authenticate with OpenAI." : "Pantheon has no OpenAI API key in this running session.",
        "Connect OPENAI_API_KEY outside the repository, then restart Pantheon.",
      ),
      checklistItem(
        "openai_egress",
        "Secure OpenAI destination",
        egressReady,
        egressReady
          ? "Pantheon will send approved work only to the exact official OpenAI endpoint and will refuse redirects."
          : "Pantheon detected a changed OpenAI destination or disabled TLS certificate checking.",
        "Remove OpenAI endpoint overrides and restore normal TLS certificate verification, then restart Pantheon.",
      ),
      checklistItem(
        "live_flag",
        "Live research enabled",
        liveFlagEnabled,
        liveFlagEnabled ? "Approved live research calls are enabled." : "Live research is turned off.",
        `Set ${preferredEnvironmentName("enableLiveResearch")}=1 only when approved research should be allowed.`,
      ),
      checklistItem(
        "adapter",
        "Research connection",
        adapterReady,
        adapterReady ? "OpenAI web-search adapter is available." : "Adapter is disabled by environment flag.",
        `Leave ${preferredEnvironmentName("disableLiveResearchAdapter")} unset.`,
      ),
      checklistItem(
        "pricing",
        "AUD safety pricing",
        pricingReady,
        pricingReady ? "The selected research model has a registered worst-case AUD pricing rule." : "The selected research model is not priced and cannot be approved.",
        "Choose a registered model or add verified official pricing before preparing paid research.",
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
