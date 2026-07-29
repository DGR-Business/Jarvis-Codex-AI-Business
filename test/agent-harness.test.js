const test = require("node:test");
const assert = require("node:assert/strict");
const {
  AGENT_ASSURANCE_POLICY_VERSION,
  SDK_GUARDRAIL_POLICY_VERSION,
  WORKER_PROMPT_POLICY_VERSION,
  buildAgentHarnessDescriptor,
  buildAgentTraceGroup,
  verifyAgentHarnessDescriptor,
  verifyAgentTraceGroup,
} = require("../src/runtime/agent-harness");

function task(parameters = {}, overrides = {}) {
  return {
    id: "task-harness-proof",
    workflow_id: "workflow-harness-proof",
    venture_id: "venture-harness-proof",
    payload: {
      liveSpendRequest: {
        parameters,
      },
    },
    ...overrides,
  };
}

test("agent harness versions the complete approved operating environment", () => {
  const harness = buildAgentHarnessDescriptor({
    id: "demand_validator",
    definitionHash: "worker-definition-hash",
  });

  assert.equal(verifyAgentHarnessDescriptor(harness).valid, true);
  assert.equal(harness.versions.promptPolicy, WORKER_PROMPT_POLICY_VERSION);
  assert.equal(harness.versions.assurancePolicy, AGENT_ASSURANCE_POLICY_VERSION);
  assert.equal(harness.versions.guardrailPolicy, SDK_GUARDRAIL_POLICY_VERSION);
  assert.ok(harness.versions.commercialConstitution);
  assert.ok(harness.versions.modelPacket);
  assert.ok(harness.versions.workerOutput);
  assert.ok(harness.versions.sdkCapability);
  assert.ok(harness.versions.modelRouting);

  const changed = structuredClone(harness);
  changed.versions.promptPolicy = "future-policy";
  assert.equal(verifyAgentHarnessDescriptor(changed).valid, false);
  assert.match(verifyAgentHarnessDescriptor(changed).reason, /changed/i);
});

test("trace groups join a complete journey and separate unrelated work", () => {
  const first = buildAgentTraceGroup(task({
    pantheonJourney: { journeyId: "journey-1" },
    pantheonCommercial: { opportunityId: "opportunity-1", roundId: "round-1" },
  }));
  const second = buildAgentTraceGroup(task({
    pantheonJourney: { journeyId: "journey-1" },
    pantheonProduction: { opportunityId: "opportunity-1", stage: "product_build" },
  }, { id: "task-second", workflow_id: "workflow-second" }));
  const unrelated = buildAgentTraceGroup(task({
    pantheonJourney: { journeyId: "journey-2" },
  }, { id: "task-third", workflow_id: "workflow-third" }));

  assert.equal(first.scopeType, "journey");
  assert.equal(first.groupId, second.groupId);
  assert.notEqual(first.groupId, unrelated.groupId);
  assert.equal(verifyAgentTraceGroup(first).valid, true);
});

test("trace groups use opportunity, round, workflow, then task fallback scopes", () => {
  const opportunity = buildAgentTraceGroup(task({
    pantheonCommercial: { opportunityId: "opportunity-1", roundId: "round-1" },
  }));
  const round = buildAgentTraceGroup(task({
    pantheonCommercial: { roundId: "round-1" },
  }));
  const workflow = buildAgentTraceGroup(task({}));
  const taskOnly = buildAgentTraceGroup(task({}, { workflow_id: null }));

  assert.equal(opportunity.scopeType, "opportunity");
  assert.equal(round.scopeType, "discovery_round");
  assert.equal(workflow.scopeType, "workflow");
  assert.equal(taskOnly.scopeType, "task");
});

test("trace group validation rejects a task moved into another commercial scope", () => {
  const originalTask = task({
    pantheonCommercial: { opportunityId: "opportunity-1" },
  });
  const traceGroup = buildAgentTraceGroup(originalTask);
  const movedTask = task({
    pantheonCommercial: { opportunityId: "opportunity-2" },
  });
  const check = verifyAgentTraceGroup(traceGroup, movedTask);

  assert.equal(check.valid, false);
  assert.match(check.reason, /commercial work group changed/i);
});
