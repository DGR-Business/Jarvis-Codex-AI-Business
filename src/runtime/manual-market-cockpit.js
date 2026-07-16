const MANUAL_MARKET_COCKPIT_SCHEMA = "jarvis_manual_market_test_cockpit_v1";

const ACTIVE_HANDOFF_STATUSES = new Set(["needs_operator_decision", "waiting_for_review", "waiting_approval"]);

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function firstText(...values) {
  for (const value of values) {
    const text = String(value || "").trim();
    if (text) return text;
  }
  return "";
}

function byId(items) {
  return new Map(asArray(items).map((item) => [item.id, item]));
}

function latestForPack(items, packId) {
  return asArray(items).find((item) => item.metadata?.executionPackId === packId) || null;
}

function latestLearningForPack({ pack, latestResult, latestFeedback, learningById, learningCycles }) {
  const packet = pack.metadata?.latestOutcomeDecisionPacket || null;
  if (packet?.learningId && learningById.has(packet.learningId)) return learningById.get(packet.learningId);
  const resultLearning = latestResult?.metadata?.outcomeDecisionPacket?.learningId;
  if (resultLearning && learningById.has(resultLearning)) return learningById.get(resultLearning);
  const feedbackLearning = latestFeedback?.metadata?.outcomeDecisionPacket?.learningId;
  if (feedbackLearning && learningById.has(feedbackLearning)) return learningById.get(feedbackLearning);
  return null;
}

function activeHandoffForPack(handoffs, pack, packet) {
  const packetHandoffId = packet?.handoffId || pack.metadata?.aiTeam?.chiefOfStaffPacket?.handoffId || null;
  return asArray(handoffs).find((handoff) => handoff.id === packetHandoffId && ACTIVE_HANDOFF_STATUSES.has(handoff.status))
    || asArray(handoffs).find((handoff) => (
      handoff.metadata?.executionPackId === pack.id
      && ACTIVE_HANDOFF_STATUSES.has(handoff.status)
    ))
    || null;
}

function packWorkerSummary(runs, packId) {
  const packRuns = asArray(runs).filter((run) => run.metadata?.executionPackId === packId);
  const workers = [...new Set(packRuns.map((run) => run.agent_name || run.agent_id).filter(Boolean))];
  return {
    runs: packRuns.length,
    passed: packRuns.filter((run) => run.eval_status === "passed").length,
    workers,
    actualCostCents: packRuns.reduce((sum, run) => sum + Number(run.actual_cost_cents || 0), 0),
  };
}

function packActions(pack, activeHandoff, latestLearning) {
  return [
    activeHandoff ? { label: "Approve", action: "handoff", decision: "approve", id: activeHandoff.id, tone: "success" } : null,
    activeHandoff ? { label: "Request Changes", action: "handoff", decision: "changes", id: activeHandoff.id, tone: "warning" } : null,
    activeHandoff ? { label: "Deny", action: "handoff", decision: "reject", id: activeHandoff.id, tone: "danger" } : null,
    { label: "Open Pack", action: "select-record", kind: "commercial_execution_pack", id: pack.id },
    { label: "Record Result", action: "open-result-entry", id: pack.workflow_id || "", workflowId: pack.workflow_id || "", experimentId: pack.experiment_id, executionPackId: pack.id, tone: "success" },
    { label: "Record Reply", action: "record-pack-reply", id: pack.id },
    { label: "Mark No Response", action: "record-pack-no-response", id: pack.id, tone: "warning" },
    latestLearning ? { label: "Create Revised Test", action: "create-revision-test-plan", id: latestLearning.id, tone: "success" } : null,
  ].filter(Boolean);
}

function packCockpitItem({ pack, workflowsById, experimentsById, latestResult, latestFeedback, latestLearning, handoffs, runs }) {
  const workflow = workflowsById.get(pack.workflow_id) || null;
  const experiment = experimentsById.get(pack.experiment_id) || null;
  const packet = pack.metadata?.latestOutcomeDecisionPacket
    || pack.metadata?.chiefOfStaffPacket
    || pack.metadata?.aiTeam?.chiefOfStaffPacket
    || null;
  const activeHandoff = activeHandoffForPack(handoffs, pack, packet);
  const workerSummary = packWorkerSummary(runs, pack.id);
  const hasOutcome = Boolean(latestResult || latestFeedback || pack.metadata?.latestOutcomeDecisionPacket);
  const status = activeHandoff
    ? "decision_ready"
    : hasOutcome
      ? "learning_ready"
      : "ready_to_run";
  const outcomeLabel = latestFeedback
    ? `Buyer signal: ${latestFeedback.summary || "feedback recorded"}`
    : latestResult
      ? `${Number(latestResult.views || 0)} views, ${Number(latestResult.clicks || 0)} clicks, ${Number(latestResult.sales || 0)} sales`
      : "No market result recorded yet.";

  return {
    id: `pack:${pack.id}`,
    type: "execution_pack",
    status,
    title: pack.title,
    source: "Execution Pack",
    workflowId: pack.workflow_id || null,
    experimentId: pack.experiment_id,
    candidateId: pack.candidate_id || null,
    packId: pack.id,
    handoffId: activeHandoff?.id || packet?.handoffId || null,
    buyer: firstText(packet?.buyer, pack.metadata?.buyer, experiment?.buyer),
    problem: firstText(packet?.problem, pack.metadata?.problem),
    offer: firstText(packet?.offer, pack.metadata?.offer, experiment?.offer, pack.title),
    channel: firstText(packet?.channel, pack.metadata?.channel, experiment?.channel, "Manual channel"),
    moneyMove: firstText(packet?.moneyMove, "Run the manual market-contact test, then record the result, reply, or no response."),
    decisionNeeded: activeHandoff?.decision_needed || packet?.decision || "Run the test manually and record what actually happened.",
    nextAction: packet?.nextAction || latestLearning?.next_action || "Record a measurable result, buyer reply, objection, or no response.",
    successMetric: firstText(packet?.successMetric, pack.metadata?.successMetric, experiment?.expected_metric, "A measurable buyer signal is recorded."),
    killCriteria: firstText(packet?.killCriteria, pack.metadata?.killCriteria, experiment?.metadata?.killCriteria, "Stop or revise if there is no useful buyer signal."),
    expectedUpsideCents: Number(packet?.expectedUpsideCents || packet?.grossMarginCents || experiment?.price_cents || 0),
    costCapCents: Number(packet?.costCapCents ?? pack.metadata?.costCapCents ?? experiment?.cost_cap_cents ?? 0),
    priceCents: Number(packet?.priceCents ?? pack.metadata?.priceCents ?? experiment?.price_cents ?? 0),
    grossMarginCents: Number(packet?.grossMarginCents || 0),
    risk: packet?.risk || activeHandoff?.risk_level || "low",
    noSpendOccurred: workerSummary.actualCostCents === 0 && Number(packet?.costCapCents ?? pack.metadata?.costCapCents ?? 0) === 0,
    evidence: [
      `Buyer: ${firstText(packet?.buyer, pack.metadata?.buyer, experiment?.buyer, "not captured")}.`,
      `Channel: ${firstText(packet?.channel, pack.metadata?.channel, experiment?.channel, "manual channel")}.`,
      `Outcome: ${outcomeLabel}.`,
      `${workerSummary.passed}/${workerSummary.runs} protected worker checks passed.`,
    ].filter(Boolean),
    blockers: asArray(packet?.hardStops).slice(0, 5),
    workerSummary,
    copy: {
      callToAction: pack.cta || "",
      offerPageCopy: pack.offer_page_copy || "",
      channelPlan: pack.channel_plan || "",
      trackingPlan: pack.tracking_plan || "",
      resultChecklist: pack.result_checklist || "",
      outreachVariants: asArray(pack.metadata?.outreachVariants),
      objectionPrompts: asArray(pack.metadata?.objectionPrompts),
    },
    latestOutcome: {
      resultId: latestResult?.id || null,
      feedbackId: latestFeedback?.id || null,
      learningId: latestLearning?.id || null,
      verdict: latestLearning?.verdict || null,
      actualResult: latestLearning?.actual_result || outcomeLabel,
      learning: latestLearning?.learning || "",
      improvement: latestLearning?.improvement || "",
    },
    actions: packActions(pack, activeHandoff, latestLearning),
    priority: activeHandoff ? 100 : hasOutcome ? 84 : 92,
  };
}

function promotedTestItem({ experiment, candidate, pack }) {
  return {
    id: `experiment:${experiment.id}`,
    type: "promoted_test",
    status: "pack_needed",
    title: `Prepare execution pack: ${experiment.name}`,
    source: "Promoted Test",
    workflowId: experiment.workflow_id || null,
    experimentId: experiment.id,
    candidateId: candidate?.id || null,
    packId: null,
    buyer: firstText(candidate?.buyer, experiment.buyer),
    problem: firstText(candidate?.problem),
    offer: firstText(candidate?.offer, experiment.offer),
    channel: firstText(candidate?.channel, experiment.channel),
    moneyMove: "Turn the promoted test into one practical pack before market contact.",
    decisionNeeded: "Generate the execution pack so the operator can run and record the test cleanly.",
    nextAction: "Generate pack.",
    successMetric: firstText(candidate?.success_metric, experiment.expected_metric),
    killCriteria: firstText(candidate?.kill_criteria, experiment.metadata?.killCriteria),
    expectedUpsideCents: Number(candidate?.gross_margin_cents || experiment.price_cents || 0),
    costCapCents: Number(candidate?.cost_cap_cents || experiment.cost_cap_cents || 0),
    priceCents: Number(candidate?.price_cents || experiment.price_cents || 0),
    grossMarginCents: Number(candidate?.gross_margin_cents || 0),
    risk: candidate?.risk || "low",
    noSpendOccurred: true,
    evidence: [
      candidate?.rationale,
      candidate?.evidence_summary,
      experiment.hypothesis,
    ].filter(Boolean),
    blockers: ["Execution pack not generated yet."],
    actions: [
      { label: "Generate Pack", action: "generate-execution-pack", experimentId: experiment.id, candidateId: candidate?.id || "", tone: "success" },
      { label: "Open Test", action: "select-record", kind: "commercial_experiment", id: experiment.id },
    ],
    priority: pack ? 0 : 76,
  };
}

function plannedTestItem(candidate) {
  return {
    id: `candidate:${candidate.id}`,
    type: "planned_test",
    status: "test_options_ready",
    title: candidate.title,
    source: "Test Option",
    workflowId: candidate.workflow_id || null,
    candidateId: candidate.id,
    buyer: candidate.buyer || "",
    problem: candidate.problem || "",
    offer: candidate.offer || "",
    channel: candidate.channel || "",
    moneyMove: "Promote the strongest test option only if the buyer, offer, channel, metric, and stop rule are clear.",
    decisionNeeded: "Promote, revise, or leave this test option parked.",
    nextAction: candidate.smallest_action || "Promote test.",
    successMetric: candidate.success_metric || candidate.expected_metric || "",
    killCriteria: candidate.kill_criteria || "",
    expectedUpsideCents: Number(candidate.gross_margin_cents || 0),
    costCapCents: Number(candidate.cost_cap_cents || 0),
    priceCents: Number(candidate.price_cents || 0),
    grossMarginCents: Number(candidate.gross_margin_cents || 0),
    risk: candidate.risk || "low",
    noSpendOccurred: true,
    evidence: [candidate.rationale, `Evidence score: ${Number(candidate.evidence_score || 0)}/100.`].filter(Boolean),
    blockers: [],
    actions: [
      { label: "Promote Test", action: "promote-test-candidate", id: candidate.id, tone: "success" },
      { label: "Open Option", action: "select-record", kind: "commercial_test_candidate", id: candidate.id },
    ],
    priority: 54 + Number(candidate.evidence_score || 0) / 10,
  };
}

function overallStatus(items, metrics) {
  if (items.some((item) => item.status === "decision_ready")) return "decision_ready";
  if (metrics.readyPacks > 0) return "ready_to_run";
  if (metrics.promotedTestsNeedingPack > 0) return "pack_needed";
  if (metrics.plannedTests > 0) return "test_options_ready";
  if (metrics.learningCycles > 0) return "learning_ready";
  return "needs_test_options";
}

function buildManualMarketCockpit({
  workflows = [],
  commercialExperiments = [],
  commercialTestCandidates = [],
  commercialExecutionPacks = [],
  commercialResults = [],
  commercialFeedback = [],
  commercialLearningCycles = [],
  handoffs = [],
  runs = [],
}) {
  const workflowsById = byId(workflows);
  const experimentsById = byId(commercialExperiments);
  const candidatesById = byId(commercialTestCandidates);
  const learningById = byId(commercialLearningCycles);
  const packsByExperiment = new Map(asArray(commercialExecutionPacks).map((pack) => [pack.experiment_id, pack]));
  const items = [];

  for (const pack of asArray(commercialExecutionPacks)) {
    const latestResult = latestForPack(commercialResults, pack.id);
    const latestFeedback = latestForPack(commercialFeedback, pack.id);
    const latestLearning = latestLearningForPack({ pack, latestResult, latestFeedback, learningById, learningCycles: commercialLearningCycles });
    items.push(packCockpitItem({
      pack,
      workflowsById,
      experimentsById,
      latestResult,
      latestFeedback,
      latestLearning,
      handoffs,
      runs,
    }));
  }

  for (const experiment of asArray(commercialExperiments).filter((item) => ["ready", "running", "measuring"].includes(item.status))) {
    const pack = packsByExperiment.get(experiment.id);
    if (pack) continue;
    const candidate = asArray(commercialTestCandidates).find((item) => item.promoted_experiment_id === experiment.id)
      || candidatesById.get(experiment.metadata?.candidateId);
    items.push(promotedTestItem({ experiment, candidate, pack }));
  }

  for (const candidate of asArray(commercialTestCandidates).filter((item) => item.status === "planned_test").slice(0, 6)) {
    items.push(plannedTestItem(candidate));
  }

  const sorted = items
    .filter((item) => item.priority > 0)
    .sort((a, b) => b.priority - a.priority)
    .slice(0, 12);

  const readyPacks = asArray(commercialExecutionPacks).filter((pack) => pack.status === "ready_to_test" && !latestForPack(commercialResults, pack.id) && !latestForPack(commercialFeedback, pack.id));
  const metrics = {
    items: sorted.length,
    plannedTests: asArray(commercialTestCandidates).filter((item) => item.status === "planned_test").length,
    promotedTests: asArray(commercialTestCandidates).filter((item) => item.status === "promoted").length,
    promotedTestsNeedingPack: asArray(commercialExperiments).filter((experiment) => ["ready", "running", "measuring"].includes(experiment.status) && !packsByExperiment.has(experiment.id)).length,
    executionPacks: asArray(commercialExecutionPacks).length,
    readyPacks: readyPacks.length,
    packsWithOutcomes: asArray(commercialExecutionPacks).filter((pack) => latestForPack(commercialResults, pack.id) || latestForPack(commercialFeedback, pack.id)).length,
    results: asArray(commercialResults).length,
    feedback: asArray(commercialFeedback).length,
    learningCycles: asArray(commercialLearningCycles).length,
    activeDecisions: sorted.filter((item) => item.status === "decision_ready").length,
    zeroSpendReadyPacks: readyPacks.filter((pack) => Number(pack.metadata?.costCapCents || 0) === 0).length,
  };
  const status = overallStatus(sorted, metrics);
  const topAction = sorted[0] || null;

  return {
    schema: MANUAL_MARKET_COCKPIT_SCHEMA,
    status,
    summary: topAction
      ? `${topAction.title}: ${topAction.moneyMove}`
      : "No manual market test is ready yet. Generate test options, promote one, then create an execution pack.",
    rule: "The operator runs any market contact manually; the AI team prepares the pack, evidence, economics, tracking, and next decision.",
    hardStops: [
      "No automated sending",
      "No external publishing",
      "No account action",
      "No paid spend",
      "No customer dispute, refund, legal, tax, compliance, or platform-risk decision",
    ],
    metrics,
    topAction,
    items: sorted,
  };
}

module.exports = {
  buildManualMarketCockpit,
  MANUAL_MARKET_COCKPIT_SCHEMA,
};
