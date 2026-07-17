const { requestLiveAiWorker } = require("./live-ai-workers");

function shouldPrepareInterestResearch(task, action) {
  if (task.kind !== "handoff_followup") return false;
  if (task.payload?.fromAgentId !== "demand_validator") return false;
  const text = [
    task.payload?.handoffSummary,
    task.payload?.sourceBusinessDecision?.nextAction,
    task.payload?.sourceBusinessDecision?.evidenceSummary,
    action?.recommendation,
  ].filter(Boolean).join(" ").toLowerCase();
  return text.includes("interest test") || text.includes("live evidence") || text.includes("demand evidence");
}

function prepareDemandInterestResearch(db, task, action) {
  if (!shouldPrepareInterestResearch(task, action)) return null;
  const source = task.payload.sourceBusinessDecision || {};
  const buyer = source.buyer && !/needs stronger evidence/i.test(source.buyer)
    ? source.buyer
    : "Solo service-business owners who struggle to maintain a weekly cash-control routine.";
  const problem = source.problem && !/needs clearer evidence/i.test(source.problem)
    ? source.problem
    : "Missed invoice, expense, and cash-review tasks make weekly cash control inconsistent.";
  const offer = source.offer && !/no spend|test qualified interest/i.test(source.offer)
    ? source.offer
    : "A concise downloadable weekly cash-control checklist for solo service businesses.";

  return requestLiveAiWorker(db, task.workflow_id, {
    requestKey: `interest_test_${task.payload.handoffId || task.id}`,
    requestedBy: "chief_of_staff",
    worker: "demand_validator",
    taskTitle: "Research the audience for the weekly cash-control checklist interest test",
    approvalTitle: "Approve Demand Validator research for the interest test (up to A$2.00)",
    estimatedCostCents: 200,
    reason: "Use at most three read-only web searches to identify current buyer language, alternatives, price signals, and one suitable non-paid audience channel before any public test is prepared.",
    tools: ["research_adapter"],
    toolArguments: {
      research_adapter: {
        searchContextSize: "low",
        allowedDomains: [],
      },
    },
    maxTurns: 4,
    maxToolCalls: 3,
    deadlineMs: 120000,
    maxOutputTokens: 1800,
    expectedOutput: "A source-backed demand verdict and one tightly scoped non-paid interest-test design covering buyer, problem, concept message, channel, qualified-interest metric, time or audience limit, counterevidence, and stop rule.",
    expectedMetric: "Current sources support a reachable buyer and produce one measurable non-paid test with a five-qualified-signal threshold and an explicit stop rule.",
    protectedEvidence: [
      task.payload.handoffSummary,
      source.evidenceSummary,
      source.nextAction,
    ].filter(Boolean),
    businessContext: {
      buyer,
      problem,
      offer,
      channel: "One evidence-selected organic audience channel; no publishing or outreach in this research step.",
      evidenceStandard: "Use current attributable sources, distinguish observed facts from assumptions, include counterevidence, and do not claim willingness to pay without buyer evidence.",
    },
    tracePolicy: {
      providerResponseStored: true,
      providerTraceContent: true,
      localReviewStored: true,
      dataClass: "business_internal_non_personal",
      purpose: "Review and improve the first supervised Demand Validator web-research run for a non-paid interest test.",
    },
    effects: [],
  });
}

module.exports = {
  prepareDemandInterestResearch,
  shouldPrepareInterestResearch,
};
