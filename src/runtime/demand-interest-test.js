const { requestLiveAiWorker } = require("./live-ai-workers");
const { fromJson, get } = require("../db");
const CONFIG = require("../config");

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

function sourceTaskCompletedLiveResearch(db, task) {
  const sourceTaskId = task.payload?.sourceTaskId;
  if (!sourceTaskId) return false;
  const sourceTask = get(
    db,
    "SELECT id, kind, status, payload FROM tasks WHERE id = ?",
    [sourceTaskId],
  );
  const request = fromJson(sourceTask?.payload, {})?.liveSpendRequest || {};
  if (
    sourceTask?.kind !== "live_ai_worker_execution"
    || sourceTask.status !== "completed"
    || !Array.isArray(request.tools)
    || !request.tools.some((toolId) => ["research_adapter", "live_web_with_approval"].includes(toolId))
  ) {
    return false;
  }
  const acceptedEvidence = get(
    db,
    `SELECT runs.id
     FROM agent_runs AS runs
     JOIN agent_eval_results AS evals
       ON evals.run_id = runs.id AND evals.status = 'passed'
     JOIN agent_run_receipts AS receipts
       ON receipts.run_id = runs.id
      AND receipts.status = 'complete'
      AND receipts.outcome_status = 'known'
     JOIN model_calls AS calls
       ON calls.task_id = runs.task_id
      AND calls.status = 'completed'
      AND calls.outcome_status = 'known'
      AND calls.provider_request_id IS NOT NULL
     JOIN research_runs AS research
       ON research.task_id = runs.task_id
      AND research.mode = 'live'
      AND research.status = 'completed_live'
     WHERE runs.task_id = ?
       AND runs.status = 'completed'
       AND EXISTS (
         SELECT 1
         FROM research_sources AS sources
         WHERE sources.run_id = research.id
           AND sources.url IS NOT NULL
           AND TRIM(sources.url) <> ''
           AND json_extract(
             CASE WHEN json_valid(sources.metadata) THEN sources.metadata ELSE '{}' END,
             '$.liveCaptured'
           ) = 1
       )
     ORDER BY runs.completed_at DESC, runs.id DESC
     LIMIT 1`,
    [sourceTaskId],
  );
  return Boolean(acceptedEvidence);
}

function prepareDemandInterestResearch(db, task, action, options = {}) {
  if (!shouldPrepareInterestResearch(task, action)) return null;
  if (sourceTaskCompletedLiveResearch(db, task)) return null;
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

  const proofMode = CONFIG.systemProofMode === true;
  const retryNumber = Math.max(0, Number(options.retryNumber || 0));
  const retrySuffix = retryNumber > 0 ? `_retry_${retryNumber}` : "";
  return requestLiveAiWorker(db, task.workflow_id, {
    requestKey: `interest_test_${task.payload.handoffId || task.id}${retrySuffix}`,
    proofMode,
    requestedBy: "chief_of_staff",
    worker: "demand_validator",
    taskTitle: "Research the audience for the weekly cash-control checklist interest test",
    approvalTitle: proofMode
      ? "Run the low-cost audience research system test (up to A$0.40)"
      : "Approve Demand Validator research for the interest test (up to A$2.00)",
    estimatedCostCents: proofMode ? 40 : 200,
    reason: proofMode
      ? "Use a small Luna run and at most two read-only searches to prove the research workflow, source capture, handoff, review, and cost records."
      : "Use at most three read-only web searches to identify current buyer language, alternatives, price signals, and one suitable non-paid audience channel before any public test is prepared.",
    tools: ["research_adapter"],
    toolArguments: {
      research_adapter: {
        searchContextSize: "low",
        allowedDomains: [],
      },
    },
    maxTurns: proofMode ? 2 : 4,
    maxToolCalls: proofMode ? 2 : 3,
    deadlineMs: proofMode ? 90000 : 120000,
    maxInputTokens: proofMode ? 12000 : undefined,
    maxOutputTokens: proofMode ? 2400 : 1800,
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
    parameters: retryNumber > 0 ? {
      retry: {
        number: retryNumber,
        priorTaskId: String(options.priorTaskId || ""),
        reason: String(options.retryReason || "A reviewed prior attempt did not produce usable structured output."),
        operatorAuthorized: options.operatorAuthorized === true,
      },
    } : {},
    tracePolicy: {
      providerResponseStored: false,
      providerTraceContent: false,
      localReviewStored: true,
      dataClass: "business_internal",
      purpose: "Keep the complete operator and developer review record locally while provider response and trace content remain off.",
    },
    effects: [],
  });
}

module.exports = {
  prepareDemandInterestResearch,
  sourceTaskCompletedLiveResearch,
  shouldPrepareInterestResearch,
};
