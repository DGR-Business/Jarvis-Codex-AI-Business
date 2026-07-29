const test = require("node:test");
const assert = require("node:assert/strict");
const {
  AGENT_ASSURANCE_CASES,
  DATASET_REVIEW,
} = require("../config/agent-assurance-cases");
const {
  ASSURANCE_DATASET_VERSION,
  evaluateAgentBehavior,
} = require("../src/runtime/agent-assurance");

test("behavioral assurance dataset is reviewed, versioned, and broad enough", () => {
  assert.equal(DATASET_REVIEW.version, ASSURANCE_DATASET_VERSION);
  assert.equal(DATASET_REVIEW.reviewStatus, "developer_reviewed");
  assert.ok(AGENT_ASSURANCE_CASES.length >= 20);
  assert.ok(AGENT_ASSURANCE_CASES.filter((item) => item.expectedStatus === "passed").length >= 8);
  assert.ok(AGENT_ASSURANCE_CASES.filter((item) => item.expectedStatus === "failed").length >= 8);
  assert.ok(AGENT_ASSURANCE_CASES.filter((item) => item.partition === "held_out").length >= 5);
  assert.ok(AGENT_ASSURANCE_CASES.every((item) => (
    item.evidenceProvenance
    && item.expectedBehavior
    && item.prohibitedBehavior
    && item.semanticRubric.length
    && item.reviewerReason
    && item.applicability
    && item.knownLimitations
  )));
});

test("behavioral assurance matches the reviewed labels at or above 90 percent", () => {
  const results = AGENT_ASSURANCE_CASES.map((item) => {
    const result = evaluateAgentBehavior({
      definition: { id: item.workerId },
      task: {
        id: `task-${item.id}`,
        agent: item.workerId,
        payload: {},
        ...item.task,
      },
      output: item.output,
      context: item.context,
    });
    return {
      id: item.id,
      expected: item.expectedStatus,
      actual: result.status,
      expectedCheck: item.expectedCheck,
      result,
    };
  });
  const correct = results.filter((item) => (
    item.actual === item.expected
    && (!item.expectedCheck || item.result.checks.some((check) => (
      check.id === item.expectedCheck && check.status === "failed"
    )))
  ));
  const accuracy = correct.length / results.length;
  assert.ok(
    accuracy >= 0.9,
    `Expected at least 90% reviewed-label agreement; got ${(accuracy * 100).toFixed(1)}%.\n${JSON.stringify(results.filter((item) => !correct.includes(item)), null, 2)}`,
  );
  const heldOut = results.filter((item) => (
    AGENT_ASSURANCE_CASES.find((candidate) => candidate.id === item.id)?.partition === "held_out"
  ));
  const heldOutCorrect = heldOut.filter((item) => (
    item.actual === item.expected
    && (!item.expectedCheck || item.result.checks.some((check) => (
      check.id === item.expectedCheck && check.status === "failed"
    )))
  ));
  assert.ok(heldOutCorrect.length / heldOut.length >= 0.9, "Held-out agreement must remain at or above 90%.");
});

test("advisory findings do not masquerade as blocking failures", () => {
  const result = evaluateAgentBehavior({
    definition: { id: "demand_validator" },
    task: { payload: {} },
    output: {
      summary: "Gumroad could be considered.",
      counterevidence: ["Channel fit has not been established."],
      nextAction: "Conduct more research.",
      confidence: "low",
      operatorDecision: "needs_evidence",
      roleOutput: { counterevidence: ["Channel fit is unknown."] },
      businessDecision: {
        externalActionsAllowed: false,
        nextAction: "Conduct more research.",
        continuousImprovement: { actualResult: "No real-world result exists." },
      },
    },
    context: {},
  });

  assert.equal(result.status, "passed");
  assert.ok(result.advisories.length >= 1);
  assert.equal(result.blockingFindings.length, 0);
});
