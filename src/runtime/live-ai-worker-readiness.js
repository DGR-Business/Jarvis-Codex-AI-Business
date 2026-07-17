const CONFIG = require("../config");
const { all, fromJson, get } = require("../db");
const { getAgentRuntimeReadiness } = require("./agent-runtime");
const { monthlyBudgetExposure } = require("./cost-ledger");
const { modelPricing } = require("./model-pricing");

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

function getLiveAiWorkerReadiness(db) {
  const integrations = parseRows(all(db, "SELECT * FROM integrations ORDER BY name ASC"));
  const approvals = parseRows(all(db, "SELECT * FROM approvals ORDER BY requested_at DESC"), ["payload"]);
  const tasks = parseRows(all(db, "SELECT * FROM tasks ORDER BY updated_at DESC"));
  const budget = setting(db, "budget", { monthlyBudgetCents: CONFIG.monthlyBudgetCents, currency: CONFIG.currency });
  const budgetExposure = monthlyBudgetExposure(db);
  const monthlySpendCents = budgetExposure.totalCents;
  const remainingBudgetCents = Number(budget.monthlyBudgetCents || CONFIG.monthlyBudgetCents) - budgetExposure.totalCents;
  const openaiIntegration = integrations.find((integration) => integration.id === "openai");
  const aiWorkerIntegration = integrations.find((integration) => integration.id === "ai_workers");
  const imageTool = get(
    db,
    `SELECT tools.status, tools.requires_approval, tools.live_flag, assignments.permission
     FROM agent_tools AS tools
     LEFT JOIN agent_tool_assignments AS assignments
       ON assignments.tool_id = tools.id AND assignments.agent_id = 'product_builder'
     WHERE tools.id = 'image_generation_spend'`,
  );
  const agentRuntime = getAgentRuntimeReadiness();
  const liveWorkerTasks = tasks.filter((task) => task.kind === "live_ai_worker_execution");
  const pendingApprovals = approvals.filter((approval) => approval.scope === "live_ai_worker_spend" && approval.status === "pending");
  const approvedApprovals = approvals.filter((approval) => approval.scope === "live_ai_worker_spend"
    && approval.status === "approved"
    && !approval.consumed_at
    && (!approval.expires_at || approval.expires_at > new Date().toISOString()));
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
  const pricingReady = Boolean(modelPricing(CONFIG.liveModel));
  const budgetReady = remainingBudgetCents >= Number(CONFIG.liveModelDefaultBudgetCents || 0);
  const ready = credentialsConfigured && liveFlagEnabled && adapterReady && pricingReady && budgetReady;
  const imageGenerationEnabled = process.env.JARVIS_ENABLE_IMAGE_GENERATION === "1";
  const imageToolReady = imageTool?.status === "pilot_ready"
    && imageTool?.permission === "requires_approval"
    && Number(imageTool?.requires_approval) === 1;
  const imageGenerationReady = ready && imageGenerationEnabled && imageToolReady;
  const imageGenerationBlockers = [];
  if (!credentialsConfigured) imageGenerationBlockers.push("The OpenAI connection is not available.");
  if (!liveFlagEnabled) imageGenerationBlockers.push("AI workers are not enabled.");
  if (!imageGenerationEnabled) imageGenerationBlockers.push("Product visual generation is not enabled for this runtime.");
  if (!adapterReady) imageGenerationBlockers.push("The Agents SDK runner is not ready.");
  if (!imageToolReady) imageGenerationBlockers.push("Product Builder does not have the required approval-controlled image tool.");

  const blockers = [];
  if (!credentialsConfigured) blockers.push("OpenAI API key is not configured for this runtime process.");
  if (!liveFlagEnabled) blockers.push("JARVIS_ENABLE_LIVE_MODELS is not enabled.");
  if (!adapterReady) blockers.push(...agentRuntime.blockers);
  if (!pricingReady) blockers.push("The selected model has no registered AUD safety pricing.");
  if (!budgetReady) blockers.push("Monthly budget remaining is below the default live AI worker cap.");

  return {
    provider: agentRuntime.primaryProvider,
    model: CONFIG.liveModel,
    currency: CONFIG.currency,
    defaultBudgetCents: Number(CONFIG.liveModelDefaultBudgetCents || 0),
    monthlyBudgetCents: Number(budget.monthlyBudgetCents || CONFIG.monthlyBudgetCents),
    monthlySpendCents,
    monthlyRealizedCents: budgetExposure.realizedCents,
    monthlyUnresolvedCents: budgetExposure.unresolvedCents,
    budgetExposure,
    remainingBudgetCents,
    credentialsConfigured,
    liveFlagEnabled,
    adapterReady,
    pricingReady,
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
    imageGeneration: {
      provider: "openai",
      model: "gpt-image-2",
      ready: imageGenerationReady,
      enabled: imageGenerationEnabled,
      approvalRequired: true,
      maxAssetsPerRun: 1,
      publishingAllowed: false,
      blockers: imageGenerationBlockers,
    },
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
        "pricing",
        "AUD safety pricing",
        pricingReady,
        pricingReady ? "The selected model has a registered worst-case AUD pricing rule." : "The selected model is not priced and cannot be approved.",
        "Choose a registered model or add verified official pricing before preparing paid work.",
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
