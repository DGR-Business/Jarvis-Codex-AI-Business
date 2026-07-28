const test = require("node:test");
const assert = require("node:assert/strict");
const {
  cacheUsageFromTokenEvidence,
  resolveEvaluationProcessingPolicy,
} = require("../src/runtime/agent-cost-observability");
const {
  buildStableWorkerPrompt,
  buildWorkerTaskInstruction,
} = require("../src/adapters/live-ai-worker");

test("cache usage reports measured reads without inventing savings", () => {
  const measured = cacheUsageFromTokenEvidence({
    inputTokens: 1000,
    cachedInputTokens: 600,
    cacheWriteInputTokens: 100,
  });
  const unknown = cacheUsageFromTokenEvidence({});

  assert.equal(measured.status, "reported");
  assert.equal(measured.cacheHitRate, 0.6);
  assert.equal(unknown.status, "unknown");
  assert.equal(unknown.cacheHitRate, null);
});

test("Flex processing is restricted to explicit retry-safe evaluations", () => {
  const allowed = resolveEvaluationProcessingPolicy({
    requested: "flex",
    evalOnly: true,
    retrySafe: true,
    interactive: false,
    externalEffects: false,
  });
  assert.equal(allowed.serviceTier, "flex");
  assert.equal(allowed.fallbackAllowed, false);
  assert.throws(
    () => resolveEvaluationProcessingPolicy({
      requested: "flex",
      evalOnly: true,
      retrySafe: false,
    }),
    /retry-safe/i,
  );
});

test("stable worker policy is separated from dynamic run controls", () => {
  const definition = {
    id: "demand_validator",
    name: "Demand Validator",
    role: "specialist",
    instructions: "Assess demand honestly.",
    approval_policy: { mustPauseFor: ["publishing"] },
  };
  const policy = { allowedTools: ["runtime_state"], blockedTools: ["publishing"] };
  const firstTask = { payload: { expectedOutput: "First exact output." } };
  const secondTask = { payload: { expectedOutput: "Second exact output." } };

  assert.equal(buildStableWorkerPrompt(definition), buildStableWorkerPrompt(definition));
  assert.notEqual(
    buildWorkerTaskInstruction(firstTask, definition, policy),
    buildWorkerTaskInstruction(secondTask, definition, policy),
  );
  assert.doesNotMatch(buildStableWorkerPrompt(definition), /First exact output/);
});
