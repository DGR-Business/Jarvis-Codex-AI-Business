const OPERATOR_COCKPIT_SCHEMA = "jarvis_operator_cockpit_v1";

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function first(items) {
  return asArray(items)[0] || null;
}

function moneyLabel(cents) {
  const value = Math.max(0, Number(cents) || 0);
  return value ? `$${Math.round(value / 100).toLocaleString("en-AU")}` : "$0";
}

function topBusinessTest(manualMarketCockpit = {}, candidates = [], packs = [], results = []) {
  const activeItem = first(manualMarketCockpit.items);
  if (activeItem) {
    return {
      status: manualMarketCockpit.status || "active",
      title: activeItem.title || activeItem.offer || "Manual market test",
      buyer: activeItem.buyer || "",
      channel: activeItem.channel || "",
      nextAction: activeItem.nextAction || activeItem.decisionNeeded || "Run or record the current market test.",
      evidence: asArray(activeItem.evidence).slice(0, 3),
      recordId: activeItem.executionPackId || activeItem.experimentId || activeItem.candidateId || null,
    };
  }
  const readyPack = asArray(packs).find((pack) => pack.status === "ready_to_test") || first(packs);
  if (readyPack) {
    return {
      status: readyPack.status,
      title: readyPack.title || "Execution pack ready",
      buyer: readyPack.buyer || readyPack.metadata?.buyer || "",
      channel: readyPack.channel || readyPack.metadata?.channel || "",
      nextAction: "Run the manual market test and record the result.",
      evidence: ["Execution pack is ready for operator-run testing."],
      recordId: readyPack.id,
    };
  }
  const candidate = first(candidates);
  return {
    status: candidate ? candidate.status : "needs_test_options",
    title: candidate?.title || "No active business test yet",
    buyer: candidate?.buyer || "",
    channel: candidate?.channel || "",
    nextAction: candidate ? "Promote the best test option or generate an execution pack." : "Generate or promote a small digital-product test.",
    evidence: results.length ? [`${results.length} result record${results.length === 1 ? "" : "s"} captured.`] : [],
    recordId: candidate?.id || null,
  };
}

function aiSummary(aiPilotReview = {}, preOpenAiReadiness = {}, liveAiWorkerReadiness = {}) {
  return {
    status: aiPilotReview.status || preOpenAiReadiness.status || "building_evidence",
    worker: aiPilotReview.workerName || "Demand Validator",
    pilotStatus: aiPilotReview.status || "not_started",
    readiness: preOpenAiReadiness.status || "needs_team_drill",
    providerReady: Boolean(liveAiWorkerReadiness.ready),
    sdkRunnerReady: Boolean(liveAiWorkerReadiness.sdkRunnerReady || liveAiWorkerReadiness.adapterReady),
    nextAction: aiPilotReview.recommendation || preOpenAiReadiness.summary || "Build protected proof before live AI testing.",
  };
}

function riskSummary(metrics = {}, runtime = {}, messages = [], liveResearch = {}, liveAiWorkers = {}) {
  const blockedActions = [
    runtime.health?.liveActionsLocked ? "External actions locked" : null,
    !liveAiWorkers.ready ? "Live AI worker execution blocked until setup and approval pass" : null,
    !liveResearch.ready ? "Live research blocked until setup and approval pass" : null,
    "Publishing, customer contact, account actions, legal decisions, and money movement remain hard stops",
  ].filter(Boolean);
  return {
    status: metrics.escalations?.urgent ? "attention" : "protected",
    openAlerts: Number(metrics.escalations?.open || messages.length || 0),
    urgentAlerts: Number(metrics.escalations?.urgent || 0),
    blockedActions,
  };
}

function buildOperatorCockpit({
  runtime = {},
  metrics = {},
  decisionInbox = {},
  commercialBrain = {},
  manualMarketCockpit = {},
  aiPilotReview = {},
  preOpenAiReadiness = {},
  liveResearchReadiness = {},
  liveAiWorkerReadiness = {},
  commercialTestCandidates = [],
  commercialExecutionPacks = [],
  commercialResults = [],
  commercialLearningCycles = [],
  messages = [],
} = {}) {
  const topDecision = first(decisionInbox.items);
  const moneyMove = first(commercialBrain.moneyMoves);
  const latestLearning = first(commercialLearningCycles);
  const budget = metrics.budget || {};
  const activeTest = topBusinessTest(manualMarketCockpit, commercialTestCandidates, commercialExecutionPacks, commercialResults);
  const ai = aiSummary(aiPilotReview, preOpenAiReadiness, liveAiWorkerReadiness);
  const risk = riskSummary(metrics, runtime, messages, liveResearchReadiness, liveAiWorkerReadiness);
  const status = topDecision ? "decision_waiting" : aiPilotReview.status === "live_output_ready_for_review" ? "pilot_review_waiting" : "clear";

  return {
    schema: OPERATOR_COCKPIT_SCHEMA,
    status,
    summary: topDecision
      ? topDecision.moneyMove || topDecision.decisionNeeded || "A decision is waiting."
      : aiPilotReview.status === "live_output_ready_for_review"
        ? "Demand Validator live output is ready for review."
        : "No urgent decision is waiting right now.",
    topDecision,
    moneyMove: moneyMove ? {
      title: moneyMove.title,
      recommendation: moneyMove.recommendation || moneyMove.moneyMove || "",
      risk: moneyMove.risk || "medium",
      expectedUpsideCents: Number(moneyMove.expectedUpsideCents || 0),
      costCapCents: Number(moneyMove.costCapCents || 0),
      workflowId: moneyMove.workflowId || null,
      approvalId: moneyMove.approvalId || null,
      handoffId: moneyMove.handoffId || null,
    } : null,
    activeBusinessTest: activeTest,
    aiTeam: ai,
    pilotReview: {
      status: aiPilotReview.status || "not_started",
      workerName: aiPilotReview.workerName || "Demand Validator",
      recommendation: aiPilotReview.recommendation || "No live AI pilot output is waiting yet.",
      costCapCents: Number(aiPilotReview.cost?.capCents || 0),
      actualCostCents: Number(aiPilotReview.cost?.actualCents || 0),
    },
    latestLearning: latestLearning ? {
      status: latestLearning.verdict || latestLearning.status || "learning_recorded",
      title: latestLearning.title || latestLearning.hypothesis || "Latest learning",
      actualResult: latestLearning.actual_result || latestLearning.actualResult || "",
      improvement: latestLearning.improvement || latestLearning.next_action || "",
    } : null,
    spend: {
      monthlyBudgetCents: Number(budget.monthlyBudgetCents || 0),
      monthlySpendCents: Number(budget.monthlySpendCents || 0),
      remainingCents: Number(budget.remainingCents || 0),
      display: `${moneyLabel(budget.monthlySpendCents)} spent; ${moneyLabel(budget.remainingCents)} remaining`,
    },
    risk,
  };
}

module.exports = {
  OPERATOR_COCKPIT_SCHEMA,
  buildOperatorCockpit,
};
