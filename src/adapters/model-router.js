const CONFIG = require("../config");
const { now, randomId, run, toJson } = require("../db");

const MODEL_CLASS_ROUTES = {
  "reasoning-medium": {
    provider: "openai",
    selectedModel: "gpt-5-mini-or-equivalent",
    estimatedInputTokens: 1200,
    estimatedOutputTokens: 700,
  },
  "research-high": {
    provider: "openai",
    selectedModel: "gpt-5-research-or-equivalent",
    estimatedInputTokens: 2400,
    estimatedOutputTokens: 1200,
  },
  "reasoning-high": {
    provider: "openai",
    selectedModel: "gpt-5-or-equivalent",
    estimatedInputTokens: 1800,
    estimatedOutputTokens: 900,
  },
  "creative-vision": {
    provider: "openai",
    selectedModel: "multimodal-design-model-pending",
    estimatedInputTokens: 1600,
    estimatedOutputTokens: 900,
  },
  "quality-review-high": {
    provider: "openai",
    selectedModel: "gpt-5-or-equivalent",
    estimatedInputTokens: 2200,
    estimatedOutputTokens: 900,
  },
  "fast-general": {
    provider: "openai",
    selectedModel: "fast-low-cost-model-pending",
    estimatedInputTokens: 800,
    estimatedOutputTokens: 400,
  },
};

function estimateCostCents(policy, route) {
  const policyCap = Number(policy.maxCostCents || 0);
  if (policyCap > 0) return Math.min(policyCap, Math.max(1, Math.ceil(policyCap * 0.55)));
  const tokens = route.estimatedInputTokens + route.estimatedOutputTokens;
  return Math.max(1, Math.ceil(tokens / 2000));
}

function liveModelCallsEnabled(options = {}) {
  return options.live === true && process.env.JARVIS_ENABLE_LIVE_MODELS === "1";
}

function recordModelCall(db, task, policy, options = {}) {
  const route = MODEL_CLASS_ROUTES[policy.modelClass] || MODEL_CLASS_ROUTES["fast-general"];
  const live = liveModelCallsEnabled(options);
  const callId = `model_${randomId()}`;
  const estimatedCostCents = estimateCostCents(policy, route);
  const ts = now();

  if (live) {
    throw new Error("Live model execution is not implemented yet. Add provider credentials, budget approval, token accounting, and response validation first.");
  }

  run(
    db,
    `INSERT INTO model_calls (id, workflow_id, task_id, provider, model_class, selected_model, mode, status,
      input_tokens, output_tokens, estimated_cost_cents, actual_cost_cents, approval_required, metadata, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      callId,
      task.workflow_id,
      task.id,
      route.provider,
      policy.modelClass,
      route.selectedModel,
      "dry-run",
      "not_called",
      route.estimatedInputTokens,
      route.estimatedOutputTokens,
      estimatedCostCents,
      0,
      0,
      toJson({
        currency: CONFIG.currency,
        reason: "Dry-run model routing proof. No paid model call was made.",
        liveModelsEnabled: false,
      }),
      ts,
    ],
  );

  return {
    id: callId,
    provider: route.provider,
    class: policy.modelClass,
    selectedModel: route.selectedModel,
    mode: "dry-run",
    status: "not_called",
    estimatedInputTokens: route.estimatedInputTokens,
    estimatedOutputTokens: route.estimatedOutputTokens,
    estimatedCostCents,
    actualCostCents: 0,
    currency: CONFIG.currency,
  };
}

module.exports = {
  MODEL_CLASS_ROUTES,
  recordModelCall,
};
