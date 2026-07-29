const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildAgentHarnessDescriptor,
  buildAgentTraceGroup,
} = require("../src/runtime/agent-harness");
const {
  buildAgentsSdkGuardrails,
  inputGuardrailResult,
  outputGuardrailResult,
} = require("../src/runtime/agent-sdk-guardrails");

function approvedTask(overrides = {}) {
  const task = {
    id: "task-sdk-guardrail",
    workflow_id: "workflow-sdk-guardrail",
    venture_id: "venture-sdk-guardrail",
    agent: "demand_validator",
    payload: {
      liveSpendRequest: {
        tools: ["research_adapter"],
        effects: [],
        parameters: {},
      },
    },
  };
  task.payload.liveSpendRequest.agentHarness = buildAgentHarnessDescriptor({
    id: "demand_validator",
    definitionHash: "definition-hash",
  });
  task.payload.liveSpendRequest.traceGroup = buildAgentTraceGroup(task);
  return {
    ...task,
    ...overrides,
    payload: overrides.payload || task.payload,
  };
}

const definition = { id: "demand_validator" };
const capabilityPlan = {
  requestedTools: ["research_adapter"],
  specs: [{ toolId: "research_adapter", sdkName: "web_search" }],
};

test("SDK input guardrail passes exact approved internal work", () => {
  const result = inputGuardrailResult(approvedTask(), definition, capabilityPlan);
  assert.equal(result.tripwireTriggered, false);
  assert.equal(result.outputInfo.status, "passed");
  assert.ok(result.outputInfo.checks.every((check) => check.status === "passed"));
});

test("SDK input guardrail blocks protected effects before dispatch", () => {
  const task = approvedTask();
  task.payload.liveSpendRequest.effects = ["publish the listing"];
  task.payload.liveSpendRequest.traceGroup = buildAgentTraceGroup(task);
  const result = inputGuardrailResult(task, definition, capabilityPlan);
  assert.equal(result.tripwireTriggered, true);
  assert.ok(result.outputInfo.findings.some((finding) => /protected external effects/i.test(finding)));
});

test("SDK output guardrail blocks invented completion and authority", () => {
  const result = outputGuardrailResult({
    summary: "We published the listing and contacted customers.",
    externalActionsAllowed: true,
  });
  assert.equal(result.tripwireTriggered, true);
  assert.ok(result.outputInfo.findings.some((finding) => /protected external action/i.test(finding)));
  assert.ok(result.outputInfo.findings.some((finding) => /expand its external-action authority/i.test(finding)));
});

test("SDK output guardrail accepts a bounded recommendation", () => {
  const result = outputGuardrailResult({
    summary: "The listing pack is ready for Daniel to review before publication.",
    nextAction: "Review the exact pack and approve or request changes.",
    externalActionsAllowed: false,
  });
  assert.equal(result.tripwireTriggered, false);
});

test("SDK guardrail definitions are non-parallel on input and structured on output", async () => {
  const guardrails = buildAgentsSdkGuardrails(approvedTask(), definition, capabilityPlan);
  assert.equal(guardrails.inputGuardrails[0].runInParallel, false);
  assert.equal((await guardrails.inputGuardrails[0].execute()).tripwireTriggered, false);
  assert.equal(
    (await guardrails.outputGuardrails[0].execute({ agentOutput: { summary: "Bounded review." } })).tripwireTriggered,
    false,
  );
});
