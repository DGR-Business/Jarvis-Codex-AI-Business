const CONFIG = require("../config");

const MODEL_ROUTING_POLICY_VERSION = "2026-07-17.1";

const MODEL_TIERS = {
  luna: {
    label: "Luna",
    model: () => CONFIG.lunaModel,
    purpose: "Fast, low-cost work with narrow scope and low ambiguity.",
  },
  terra: {
    label: "Terra",
    model: () => CONFIG.terraModel,
    purpose: "The normal business worker for balanced quality, speed, and cost.",
  },
  sol: {
    label: "Sol",
    model: () => CONFIG.solModel,
    purpose: "Deep research, consequential judgement, and quality escalation.",
  },
};

const MODEL_CLASS_TIERS = {
  "fast-general": "luna",
  "reasoning-medium": "terra",
  "creative-vision": "terra",
  "research-high": "sol",
  "reasoning-high": "sol",
  "quality-review-high": "sol",
};

function tierForModel(model) {
  const selected = String(model || "").trim();
  if (!selected) return null;
  for (const [tier, definition] of Object.entries(MODEL_TIERS)) {
    const configuredModel = String(definition.model() || "").trim();
    if (selected === configuredModel || selected.startsWith(`${configuredModel}-`)) return tier;
  }
  if (selected === "gpt-5.6") return "sol";
  return null;
}

function reasonForRoute(tier, modelClass, options = {}) {
  if (options.qualityEscalation === true) {
    return "Sol was selected before approval because an earlier result did not pass quality review.";
  }
  if (options.highConsequence === true) {
    return "Sol was selected before approval because this decision has material commercial, financial, legal, or reputational consequences.";
  }
  if (tier === "luna") {
    return "Luna is sufficient for this narrow, low-ambiguity task and keeps routine work economical.";
  }
  if (tier === "sol") {
    return modelClass === "quality-review-high"
      ? "Sol is used for the independent quality and risk review."
      : "Sol is used because this work requires deep research or consequential judgement.";
  }
  return "Terra is the default for normal business work because it balances quality, speed, and cost.";
}

function selectModelRoute(options = {}) {
  const modelClass = String(options.modelClass || "reasoning-medium");
  const explicitModel = String(options.model || "").trim();
  const forcedTier = options.qualityEscalation === true || options.highConsequence === true
    ? "sol"
    : null;
  const tier = forcedTier || tierForModel(explicitModel) || MODEL_CLASS_TIERS[modelClass] || "terra";
  const tierDefinition = MODEL_TIERS[tier];
  const model = explicitModel && !forcedTier ? explicitModel : tierDefinition.model();

  return {
    tier,
    label: tierDefinition.label,
    model,
    modelClass,
    reason: reasonForRoute(tier, modelClass, options),
    purpose: tierDefinition.purpose,
    policyVersion: MODEL_ROUTING_POLICY_VERSION,
    selectedBeforeApproval: true,
    automaticFallbackAllowed: false,
  };
}

module.exports = {
  MODEL_CLASS_TIERS,
  MODEL_ROUTING_POLICY_VERSION,
  MODEL_TIERS,
  selectModelRoute,
  tierForModel,
};
