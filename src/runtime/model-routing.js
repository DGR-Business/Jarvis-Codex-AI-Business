const crypto = require("node:crypto");
const CONFIG = require("../config");
const { all, fromJson, get } = require("../db");

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

const ROUTE_REVIEW_STATUSES = new Set([
  "failed",
  "incomplete",
  "known_provider_result_needs_review",
  "needs_attention",
  "needs_review",
  "unknown",
  "waiting_for_review",
]);
const TERMINAL_RUN_STATUSES = new Set(["completed", "failed", "needs_attention"]);

function canonicalTools(value) {
  const tools = Array.isArray(value) ? value : value ? [value] : [];
  return [...new Set(tools.map((tool) => String(tool || "").trim()).filter(Boolean))].sort();
}

function routeDigest(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function createModelRouteSignature(options = {}) {
  const workerId = String(options.workerId || "").trim();
  const capabilityKey = String(options.capabilityKey || "").trim();
  if (!workerId || !capabilityKey) {
    throw new Error("Model routing needs an exact worker and capability key.");
  }
  if (!/^[a-z0-9][a-z0-9._:-]{2,159}$/i.test(capabilityKey)) {
    throw new Error("The model-route capability key is invalid.");
  }
  const tools = canonicalTools(options.tools);
  return {
    workerId,
    capabilityKey,
    tools,
    toolSignature: routeDigest(tools),
    historySignature: routeDigest({ workerId, capabilityKey, tools }),
  };
}

function taskRouteSignature(taskPayload = {}) {
  return taskPayload.liveSpendRequest?.modelRoute?.historySignature
    || taskPayload.liveSpendRequest?.parameters?.modelRoute?.historySignature
    || null;
}

function latestEvidenceForRun(db, runRecord) {
  const evaluation = get(
    db,
    "SELECT id, status, score, created_at FROM agent_eval_results WHERE run_id = ? ORDER BY created_at DESC, id DESC LIMIT 1",
    [runRecord.id],
  );
  const attempt = get(
    db,
    `SELECT id, status, outcome_status, completed_at
     FROM task_attempts
     WHERE agent_run_id = ?
     ORDER BY started_at DESC, id DESC LIMIT 1`,
    [runRecord.id],
  );
  const receipt = get(
    db,
    "SELECT id, status, outcome_status, sequence FROM agent_run_receipts WHERE run_id = ? ORDER BY sequence DESC LIMIT 1",
    [runRecord.id],
  );
  const qualityStatus = String(evaluation?.status || runRecord.eval_status || "not_evaluated");
  const outcomeStatus = String(receipt?.outcome_status || attempt?.outcome_status || runRecord.status || "not_started");
  const receiptStatus = String(receipt?.status || "");
  const attemptStatus = String(attempt?.status || "");
  const failed = runRecord.status === "failed";
  const needsReview = failed
    || ROUTE_REVIEW_STATUSES.has(qualityStatus)
    || ROUTE_REVIEW_STATUSES.has(outcomeStatus)
    || ROUTE_REVIEW_STATUSES.has(receiptStatus)
    || ROUTE_REVIEW_STATUSES.has(attemptStatus)
    || (runRecord.status === "completed" && qualityStatus !== "passed");
  const passed = runRecord.status === "completed"
    && qualityStatus === "passed"
    && !needsReview;
  return {
    decision: passed ? "normal" : needsReview ? "escalate" : "ignore",
    priorRunId: runRecord.id,
    priorTaskId: runRecord.task_id,
    runStatus: runRecord.status,
    qualityStatus,
    outcomeStatus,
    evaluationId: evaluation?.id || null,
    attemptId: attempt?.id || null,
    receiptId: receipt?.id || null,
  };
}

function readModelRouteHistory(db, signature) {
  if (!db || !signature?.workerId || !signature?.historySignature) {
    return { decision: "normal", matched: false };
  }
  const runs = all(
    db,
    `SELECT runs.*, tasks.payload AS task_payload
     FROM agent_runs AS runs
     JOIN tasks ON tasks.id = runs.task_id
     WHERE runs.agent_id = ?
       AND tasks.kind = 'live_ai_worker_execution'
     ORDER BY COALESCE(runs.completed_at, runs.started_at) DESC, runs.started_at DESC, runs.id DESC`,
    [signature.workerId],
  );
  for (const runRecord of runs) {
    if (!TERMINAL_RUN_STATUSES.has(String(runRecord.status || ""))) continue;
    const taskPayload = fromJson(runRecord.task_payload, {});
    if (taskRouteSignature(taskPayload) !== signature.historySignature) continue;
    const evidence = latestEvidenceForRun(db, runRecord);
    if (evidence.decision === "ignore") continue;
    return {
      ...evidence,
      matched: true,
      historySignature: signature.historySignature,
      capabilityKey: signature.capabilityKey,
      toolSignature: signature.toolSignature,
    };
  }
  return {
    decision: "normal",
    matched: false,
    historySignature: signature.historySignature,
    capabilityKey: signature.capabilityKey,
    toolSignature: signature.toolSignature,
  };
}

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
  if (options.proofMode === true) {
    return "Luna is being used for a supervised system proof that checks the workflow, not the quality of the final business judgement.";
  }
  if (options.modelLocked === true) {
    const label = MODEL_TIERS[tier]?.label || "The selected model";
    return `${label} is locked for this exact capped run; no automatic model escalation or fallback is allowed.`;
  }
  if (options.routeHistory?.decision === "escalate") {
    return "Sol was selected before approval because the latest reviewed result for this exact worker, capability, and tool set failed or needs review.";
  }
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
  const modelLocked = options.modelLocked === true;
  const forcedTier = options.proofMode === true
    ? "luna"
    : modelLocked
      ? null
    : options.routeHistory?.decision === "escalate"
    || options.qualityEscalation === true
    || options.highConsequence === true
      ? "sol"
      : null;
  const tier = forcedTier || tierForModel(explicitModel) || MODEL_CLASS_TIERS[modelClass] || "terra";
  const tierDefinition = MODEL_TIERS[tier];
  const model = options.proofMode === true
    ? MODEL_TIERS.luna.model()
    : explicitModel && !forcedTier
      ? explicitModel
      : tierDefinition.model();

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
    automaticRetryAllowed: false,
    proofMode: options.proofMode === true,
    modelLocked,
    routeHistory: options.routeHistory || null,
  };
}

module.exports = {
  MODEL_CLASS_TIERS,
  MODEL_ROUTING_POLICY_VERSION,
  MODEL_TIERS,
  createModelRouteSignature,
  readModelRouteHistory,
  selectModelRoute,
  tierForModel,
};
