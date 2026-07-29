const { all, fromJson } = require("../db");

const EVAL_FLEX_POLICY_VERSION = "pantheon-eval-flex-2026-07-28-v1";

function cacheUsageFromTokenEvidence(tokenUsage = {}) {
  const inputTokens = Number(tokenUsage.inputTokens);
  const cachedInputTokens = Number(tokenUsage.cachedInputTokens);
  const cacheWriteInputTokens = Number(tokenUsage.cacheWriteInputTokens);
  const inputKnown = Number.isFinite(inputTokens) && inputTokens >= 0;
  const cachedKnown = Number.isFinite(cachedInputTokens) && cachedInputTokens >= 0;
  const cacheWriteKnown = Number.isFinite(cacheWriteInputTokens) && cacheWriteInputTokens >= 0;
  return {
    status: inputKnown && cachedKnown ? "reported" : inputKnown ? "partial" : "unknown",
    inputTokens: inputKnown ? inputTokens : null,
    cachedInputTokens: cachedKnown ? cachedInputTokens : null,
    cacheWriteInputTokens: cacheWriteKnown ? cacheWriteInputTokens : null,
    cacheHitRate: inputKnown && cachedKnown && inputTokens > 0
      ? Number((cachedInputTokens / inputTokens).toFixed(4))
      : null,
  };
}

function getAgentCostObservability(db, options = {}) {
  const limit = Math.max(1, Math.min(Number(options.limit || 1000), 5000));
  const rows = all(
    db,
    `SELECT calls.id, calls.task_id, calls.estimated_cost_cents, calls.metadata,
            calls.created_at, tasks.agent
     FROM model_calls AS calls
     LEFT JOIN tasks ON tasks.id = calls.task_id
     WHERE calls.mode = 'live'
     ORDER BY calls.created_at DESC
     LIMIT ?`,
    [limit],
  );
  const groups = new Map();
  for (const row of rows) {
    const metadata = fromJson(row.metadata, {});
    if (metadata.provider !== "openai-agents-sdk") continue;
    const harnessHash = metadata.agentHarness?.harnessHash || metadata.harnessHash || "historical-unversioned";
    const workerId = row.agent || metadata.agentHarness?.worker?.id || "unknown-worker";
    const key = `${workerId}:${harnessHash}`;
    const group = groups.get(key) || {
      workerId,
      harnessHash,
      calls: 0,
      estimatedCostCents: 0,
      inputTokens: 0,
      cachedInputTokens: 0,
      cacheWriteInputTokens: 0,
      reportedInputCalls: 0,
      reportedCacheCalls: 0,
      latestAt: row.created_at,
    };
    const cache = cacheUsageFromTokenEvidence(metadata.tokenUsage || {});
    group.calls += 1;
    group.estimatedCostCents += Math.max(0, Number(row.estimated_cost_cents || 0));
    if (cache.inputTokens !== null) {
      group.inputTokens += cache.inputTokens;
      group.reportedInputCalls += 1;
    }
    if (cache.cachedInputTokens !== null) {
      group.cachedInputTokens += cache.cachedInputTokens;
      group.reportedCacheCalls += 1;
    }
    if (cache.cacheWriteInputTokens !== null) group.cacheWriteInputTokens += cache.cacheWriteInputTokens;
    groups.set(key, group);
  }
  const workerHarnesses = [...groups.values()].map((group) => ({
    ...group,
    cacheHitRate: group.inputTokens > 0
      ? Number((group.cachedInputTokens / group.inputTokens).toFixed(4))
      : null,
    measurementStatus: group.reportedInputCalls === group.calls && group.reportedCacheCalls === group.calls
      ? "reported"
      : group.reportedInputCalls
        ? "partial"
        : "unknown",
  }));
  return {
    schema: "pantheon.agent-cost-observability.v1",
    workerHarnesses,
    measuredCalls: workerHarnesses.reduce((sum, item) => sum + item.calls, 0),
    note: workerHarnesses.length
      ? "Cache metrics are measured provider usage, grouped by exact worker harness."
      : "No versioned live Agents SDK usage is available yet; no cache saving is assumed.",
  };
}

function resolveEvaluationProcessingPolicy(input = {}) {
  const requested = String(input.requested || "standard").toLowerCase();
  if (requested !== "flex") {
    return {
      policyVersion: EVAL_FLEX_POLICY_VERSION,
      requested,
      serviceTier: null,
      eligible: true,
      fallbackAllowed: false,
      reason: "Use standard processing.",
    };
  }
  const eligible = input.evalOnly === true
    && input.retrySafe === true
    && input.interactive !== true
    && input.externalEffects !== true;
  if (!eligible) {
    throw new Error("Flex processing is restricted to retry-safe, non-interactive evaluation work with no external effects.");
  }
  return {
    policyVersion: EVAL_FLEX_POLICY_VERSION,
    requested,
    serviceTier: "flex",
    eligible: true,
    fallbackAllowed: false,
    reason: "Use Flex only for this explicit evaluation. An unavailable result remains incomplete and is not retried or silently moved to standard processing.",
  };
}

module.exports = {
  EVAL_FLEX_POLICY_VERSION,
  cacheUsageFromTokenEvidence,
  getAgentCostObservability,
  resolveEvaluationProcessingPolicy,
};
