const COMMERCIAL_PRINCIPLES = [
  {
    id: "demand",
    name: "Demand first",
    rule: "Do not build beyond a small test until there is evidence that buyers already want the outcome.",
  },
  {
    id: "offer",
    name: "Clear offer",
    rule: "Every venture needs a named buyer, painful problem, concrete promise, price, and reason to buy now.",
  },
  {
    id: "distribution",
    name: "Distribution before polish",
    rule: "A product is not a business until there is a believable channel to reach buyers repeatedly.",
  },
  {
    id: "conversion",
    name: "Measure conversion",
    rule: "Track the buyer path from attention to click, checkout, sale, refund, and repeat purchase.",
  },
  {
    id: "unit_economics",
    name: "Profit after costs",
    rule: "Judge work by gross profit, time, tool spend, fulfilment effort, and opportunity cost.",
  },
  {
    id: "feedback",
    name: "Learn from reality",
    rule: "Treat every launch as a hypothesis, compare expected results to actual results, then improve or stop.",
  },
  {
    id: "simplicity",
    name: "Operator simplicity",
    rule: "Agents do the heavy processing; the operator should see the decision, evidence, expected upside, and buttons.",
  },
];

const COMMERCIAL_ROLES = [
  {
    id: "opportunity_scout",
    name: "Opportunity Scout",
    job: "Find buyer problems, search demand, trend signals, marketplace gaps, and underserved niches.",
  },
  {
    id: "demand_validator",
    name: "Demand Validator",
    job: "Check whether people already search, buy, complain, review, or pay for similar outcomes.",
  },
  {
    id: "offer_architect",
    name: "Offer Architect",
    job: "Turn an idea into buyer, promise, product format, price, positioning, and risk assumptions.",
  },
  {
    id: "product_builder",
    name: "Product Builder",
    job: "Create the smallest sellable digital product or asset required for the next test.",
  },
  {
    id: "conversion_writer",
    name: "Copy and Conversion Agent",
    job: "Write titles, descriptions, landing copy, thumbnails, emails, and calls to action.",
  },
  {
    id: "distribution_operator",
    name: "Distribution Agent",
    job: "Prepare and run channel tests across marketplace, search, owned audience, or social paths.",
  },
  {
    id: "finance_analyst",
    name: "Finance and Unit Economics Agent",
    job: "Track price, margin, cost, time, expected upside, break-even, and capital allocation.",
  },
  {
    id: "growth_analyst",
    name: "Growth Analyst",
    job: "Compare expected results to actual metrics and recommend scale, revise, pause, or kill.",
  },
  {
    id: "chief_of_staff",
    name: "Chief of Staff",
    job: "Compress agent work into money moves, evidence, risks, and operator decisions.",
  },
];

const IMPROVEMENT_STEPS = [
  "Hypothesis",
  "Smallest useful action",
  "Expected metric",
  "Actual result",
  "Learning",
  "Improvement",
];

function money(cents) {
  return Math.max(0, Math.round(Number(cents) || 0));
}

function moneyLabel(cents) {
  const amount = money(cents);
  if (!amount) return "no spend";
  return `$${(amount / 100).toFixed(2)}`;
}

function verdictLabel(verdict) {
  return {
    continue: "Continue",
    revise: "Revise",
    kill_or_rework: "Stop or rework",
    research_required: "Research needed",
    research_inconclusive: "Research inconclusive",
    not_generated: "Not scored yet",
    needs_live_research: "Needs live research",
  }[String(verdict || "").toLowerCase()] || String(verdict || "Unknown").replaceAll("_", " ");
}

function latestPdfForWorkflow(deliverables, workflowId) {
  return deliverables.find(
    (deliverable) => deliverable.workflow_id === workflowId && String(deliverable.format || "").toLowerCase() === "pdf" && deliverable.file_path,
  );
}

function pendingApprovalsForWorkflow(approvals, workflowId) {
  return approvals.filter((approval) => approval.workflow_id === workflowId && approval.status === "pending");
}

function scorecardForWorkflow(scorecards, workflowId) {
  return scorecards.find((scorecard) => scorecard.workflow_id === workflowId);
}

function commercialWorkflowCount(workflows) {
  return workflows.filter((workflow) => !["completed", "archived", "cancelled"].includes(workflow.status)).length;
}

function percent(numerator, denominator) {
  if (!denominator) return 0;
  return Number(((numerator / denominator) * 100).toFixed(2));
}

function aggregateCommercialResults(results = []) {
  const totals = results.reduce(
    (acc, result) => ({
      views: acc.views + Number(result.views || 0),
      clicks: acc.clicks + Number(result.clicks || 0),
      leads: acc.leads + Number(result.leads || 0),
      sales: acc.sales + Number(result.sales || 0),
      refunds: acc.refunds + Number(result.refunds || 0),
      revenueCents: acc.revenueCents + Number(result.revenue_cents || 0),
      refundAmountCents: acc.refundAmountCents + Number(result.refund_amount_cents || 0),
      spendCents: acc.spendCents + Number(result.spend_cents || 0),
      platformFeeCents: acc.platformFeeCents + Number(result.platform_fee_cents || 0),
      fulfilmentCostCents: acc.fulfilmentCostCents + Number(result.fulfilment_cost_cents || 0),
      productCostCents: acc.productCostCents + Number(result.product_cost_cents || 0),
      toolCostCents: acc.toolCostCents + Number(result.tool_cost_cents || 0),
      attributedAiCostCents: acc.attributedAiCostCents + Number(result.attributed_ai_cost_cents || 0),
      otherCostCents: acc.otherCostCents + Number(result.other_cost_cents || 0),
      timeSpentMinutes: acc.timeSpentMinutes + Number(result.time_spent_minutes || 0),
    }),
    {
      views: 0,
      clicks: 0,
      leads: 0,
      sales: 0,
      refunds: 0,
      revenueCents: 0,
      refundAmountCents: 0,
      spendCents: 0,
      platformFeeCents: 0,
      fulfilmentCostCents: 0,
      productCostCents: 0,
      toolCostCents: 0,
      attributedAiCostCents: 0,
      otherCostCents: 0,
      timeSpentMinutes: 0,
    },
  );
  const totalCostCents = totals.refundAmountCents
    + totals.spendCents
    + totals.platformFeeCents
    + totals.fulfilmentCostCents
    + totals.productCostCents
    + totals.toolCostCents
    + totals.attributedAiCostCents
    + totals.otherCostCents;
  const cashContributionCents = totals.revenueCents - totalCostCents;
  return {
    ...totals,
    totalCostCents,
    cashContributionCents,
    profitCents: cashContributionCents,
    clickRate: percent(totals.clicks, totals.views),
    salesRate: percent(totals.sales, totals.clicks || totals.views),
    refundRate: percent(totals.refunds, totals.sales),
    roi: totalCostCents > 0 ? Number((cashContributionCents / totalCostCents).toFixed(2)) : null,
  };
}

function moveBase(overrides) {
  return {
    id: overrides.id,
    type: overrides.type,
    priority: overrides.priority,
    title: overrides.title,
    recommendation: overrides.recommendation,
    expectedUpsideCents: money(overrides.expectedUpsideCents),
    costCapCents: money(overrides.costCapCents),
    risk: overrides.risk || "low",
    decision: overrides.decision,
    evidence: overrides.evidence || [],
    hypothesis: overrides.hypothesis,
    action: overrides.action,
    successMetric: overrides.successMetric,
    killCriteria: overrides.killCriteria,
    learningSignal: overrides.learningSignal,
    workflowId: overrides.workflowId || null,
    approvalId: overrides.approvalId || null,
    taskId: overrides.taskId || null,
    deliverableId: overrides.deliverableId || null,
    candidateId: overrides.candidateId || null,
    briefId: overrides.briefId || null,
    experimentId: overrides.experimentId || null,
    executionPackId: overrides.executionPackId || null,
    learningId: overrides.learningId || null,
    resultId: overrides.resultId || null,
    feedbackId: overrides.feedbackId || null,
    handoffId: overrides.handoffId || null,
    source: overrides.source || "commercial-brain",
  };
}

function approvalMove(approval, workflow, deliverable) {
  const estimatedCost = money(approval.payload?.estimatedCostCents || approval.payload?.amountCents || approval.payload?.costBudgetCents);
  return moveBase({
    id: `money_move_${approval.id}`,
    type: "operator_decision",
    priority: 100,
    title: `Decide: ${approval.title}`,
    recommendation: "Make the smallest decision that unlocks evidence or protects capital.",
    expectedUpsideCents: workflow?.expected_profit_cents || 0,
    costCapCents: estimatedCost,
    risk: approval.risk_level || "low",
    decision: "Approve, request changes, or deny from the decision card.",
    evidence: [
      workflow ? `Workflow: ${workflow.title}` : null,
      deliverable ? `Review pack ready: ${deliverable.human_name}` : null,
      estimatedCost ? `Estimated cap: ${moneyLabel(estimatedCost)}` : "No live spend before approval.",
    ].filter(Boolean),
    hypothesis: "If this decision is approved, the system can gather better evidence or complete the next commercial step without losing control.",
    action: "Operator chooses approve, changes, or deny.",
    successMetric: "Decision recorded; next workflow state changes without unapproved spend.",
    killCriteria: "Deny or request changes if the upside, evidence, buyer, channel, or risk is unclear.",
    learningSignal: "Approval outcome teaches what the operator will accept for this class of work.",
    workflowId: approval.workflow_id || null,
    approvalId: approval.id,
    deliverableId: deliverable?.id || null,
  });
}

function learningMove(cycle, workflow, experiment) {
  const verdict = String(cycle.verdict || "needs_evidence");
  const copy = {
    continue: {
      title: `Continue carefully: ${experiment?.name || workflow?.title || "commercial test"}`,
      recommendation: "A real result is positive enough to prepare the next measured step, still with controls.",
      risk: "medium",
      priority: 96,
    },
    revise: {
      title: `Revise before scaling: ${experiment?.name || workflow?.title || "commercial test"}`,
      recommendation: "There is signal, but the offer, channel, price, or conversion path needs work before more effort.",
      risk: "medium",
      priority: 94,
    },
    kill_or_rework: {
      title: `Stop or rework: ${experiment?.name || workflow?.title || "commercial test"}`,
      recommendation: "The result is weak enough that more time should not be spent without a substantial change.",
      risk: "high",
      priority: 93,
    },
    needs_evidence: {
      title: `Get a measurable result: ${experiment?.name || workflow?.title || "commercial test"}`,
      recommendation: "The test does not yet have enough market contact to judge.",
      risk: "low",
      priority: 78,
    },
  }[verdict] || {
    title: `Review commercial learning: ${experiment?.name || workflow?.title || "commercial test"}`,
    recommendation: "Review the latest result and decide the next smallest commercial action.",
    risk: "medium",
    priority: 80,
  };
  const packet = cycle.metadata?.outcomeDecisionPacket || null;
  return moveBase({
    id: `money_move_learning_${cycle.id}`,
    type: "learning_signal",
    priority: packet ? Math.min(99, copy.priority + 1) : copy.priority,
    title: packet?.title || copy.title,
    recommendation: packet?.moneyMove || copy.recommendation,
    expectedUpsideCents: packet?.expectedUpsideCents || workflow?.expected_profit_cents || 0,
    costCapCents: packet?.costCapCents ?? experiment?.cost_cap_cents ?? 0,
    risk: packet?.risk || copy.risk,
    decision: packet?.decision || "Choose scale, revise, pause, or kill based on the learning card.",
    evidence: packet?.evidence || [
      cycle.actual_result ? `Actual result: ${cycle.actual_result}` : null,
      cycle.learning ? `Learning: ${cycle.learning}` : null,
      cycle.next_action ? `Next action: ${cycle.next_action}` : null,
    ].filter(Boolean),
    hypothesis: packet?.continuousImprovement?.hypothesis || cycle.hypothesis || experiment?.hypothesis || "A measurable result should improve the next business decision.",
    action: packet?.continuousImprovement?.smallestUsefulAction || cycle.next_action || "Record the next smallest commercial action.",
    successMetric: packet?.successMetric || cycle.expected_metric || experiment?.expected_metric || "A sale, lead, click, refund, cost, or customer signal changes.",
    killCriteria: packet?.killCriteria || "Stop or rework if the result shows weak demand, bad economics, refund pressure, or no reachable channel.",
    learningSignal: packet?.learningSignal || cycle.improvement || "Use the actual result to scale, revise, pause, or kill.",
    workflowId: cycle.workflow_id || workflow?.id || null,
    handoffId: packet?.handoffId || null,
    executionPackId: packet?.executionPackId || null,
    resultId: packet?.resultId || null,
    feedbackId: packet?.feedbackId || null,
    learningId: cycle.id,
    source: packet ? "chief_of_staff_outcome_packet" : "commercial-brain",
  });
}

function nextTestMove(candidate, workflow, brief) {
  return moveBase({
    id: `money_move_next_test_${candidate.id}`,
    type: "next_test",
    priority: Math.max(86, 98 - Number(candidate.rank || 1)),
    title: `Run this test next: ${candidate.title}`,
    recommendation: candidate.rationale || "Promote the strongest test option into an active commercial experiment.",
    expectedUpsideCents: candidate.gross_margin_cents || workflow?.expected_profit_cents || 0,
    costCapCents: candidate.cost_cap_cents || 0,
    risk: candidate.risk || "low",
    decision: "Promote this test, revise it, or leave it parked until stronger evidence exists.",
    evidence: [
      candidate.buyer ? `Buyer: ${candidate.buyer}` : null,
      candidate.problem ? `Problem: ${candidate.problem}` : null,
      candidate.success_metric ? `Success metric: ${candidate.success_metric}` : null,
      candidate.kill_criteria ? `Kill rule: ${candidate.kill_criteria}` : null,
      brief?.evidence_summary ? `Evidence: ${brief.evidence_summary}` : null,
    ].filter(Boolean),
    hypothesis: candidate.hypothesis || "A small measurable test should reveal whether this offer deserves more time.",
    action: candidate.smallest_action || "Promote the candidate and record the first result.",
    successMetric: candidate.success_metric || candidate.expected_metric || "A clear buyer action, objection, lead, or sale is recorded.",
    killCriteria: candidate.kill_criteria || "Stop or rework if the test produces weak demand, bad economics, or no reachable channel.",
    learningSignal: "The first result should update the learning loop and scorecard.",
    workflowId: candidate.workflow_id || workflow?.id || null,
    candidateId: candidate.id,
    briefId: candidate.brief_id || brief?.id || null,
  });
}

function executionPackNeededMove(experiment, workflow, candidate) {
  return moveBase({
    id: `money_move_execution_pack_needed_${experiment.id}`,
    type: "execution_pack_needed",
    priority: 99,
    title: `Prepare the test pack: ${experiment.name}`,
    recommendation: "Turn the promoted test into one practical pack with copy, channel steps, tracking, and result shortcuts.",
    expectedUpsideCents: candidate?.gross_margin_cents || workflow?.expected_profit_cents || experiment.price_cents || 0,
    costCapCents: experiment.cost_cap_cents || candidate?.cost_cap_cents || 0,
    risk: candidate?.risk || "low",
    decision: "Generate the pack, then use it for a manual market-contact test.",
    evidence: [
      experiment.buyer ? `Buyer: ${experiment.buyer}` : null,
      experiment.offer ? `Offer: ${experiment.offer}` : null,
      experiment.channel ? `Channel: ${experiment.channel}` : null,
      experiment.expected_metric ? `Expected metric: ${experiment.expected_metric}` : null,
    ].filter(Boolean),
    hypothesis: experiment.hypothesis || "A promoted test needs a simple execution pack before market contact.",
    action: "Generate the execution pack and run the smallest manual channel test.",
    successMetric: candidate?.success_metric || experiment.expected_metric || "A measurable buyer signal is recorded.",
    killCriteria: candidate?.kill_criteria || experiment.metadata?.killCriteria || "Stop or rework if the test produces no useful signal.",
    learningSignal: "The pack makes the test easy to run and gives the learning loop a clean result capture path.",
    workflowId: experiment.workflow_id || workflow?.id || null,
    candidateId: candidate?.id || experiment.metadata?.candidateId || null,
    briefId: candidate?.brief_id || experiment.metadata?.briefId || null,
    experimentId: experiment.id,
  });
}

function executionReadyMove(pack, workflow, experiment) {
  const packet = pack.metadata?.chiefOfStaffPacket || pack.metadata?.aiTeam?.chiefOfStaffPacket || null;
  return moveBase({
    id: `money_move_execution_ready_${pack.id}`,
    type: "execution_ready",
    priority: 97,
    title: packet?.title || `Run and record: ${pack.title}`,
    recommendation: packet?.moneyMove || "Use this pack for the manual test, then record the result, reply, or no-response signal from the same card.",
    expectedUpsideCents: packet?.expectedUpsideCents || experiment?.price_cents || workflow?.expected_profit_cents || 0,
    costCapCents: packet?.costCapCents ?? pack.metadata?.costCapCents ?? experiment?.cost_cap_cents ?? 0,
    risk: packet?.risk || "low",
    decision: packet?.decision || "Run the manual test, record the outcome, or mark no response.",
    evidence: packet?.evidence || [
      pack.metadata?.buyer ? `Buyer: ${pack.metadata.buyer}` : null,
      pack.metadata?.channel ? `Channel: ${pack.metadata.channel}` : null,
      pack.metadata?.successMetric ? `Success metric: ${pack.metadata.successMetric}` : null,
      "No automated sending, publishing, or spend is approved by this pack.",
    ].filter(Boolean),
    hypothesis: packet?.continuousImprovement?.hypothesis || experiment?.hypothesis || "A manual market-contact test should reveal whether the offer deserves more work.",
    action: packet?.continuousImprovement?.smallestUsefulAction || pack.channel_plan || "Run the smallest manual channel test and capture what happens.",
    successMetric: packet?.successMetric || pack.metadata?.successMetric || experiment?.expected_metric || "A measurable buyer signal is recorded.",
    killCriteria: packet?.killCriteria || pack.metadata?.killCriteria || experiment?.metadata?.killCriteria || "Stop or revise if there is no useful buyer signal.",
    learningSignal: packet?.learningSignal || "Outcome buttons feed the commercial results and learning loop.",
    workflowId: pack.workflow_id || experiment?.workflow_id || workflow?.id || null,
    candidateId: pack.candidate_id || null,
    briefId: pack.brief_id || null,
    experimentId: pack.experiment_id,
    executionPackId: pack.id,
    handoffId: packet?.handoffId || null,
    source: packet ? "chief_of_staff_packet" : "commercial-brain",
  });
}

function chiefOfStaffNextActionMove(task, action, workflow) {
  return moveBase({
    id: `money_move_${action.id || task.id}`,
    type: "chief_of_staff_next_action",
    priority: 98,
    title: action.title || "Chief of Staff next business action",
    recommendation: action.recommendation || "Review the next safe business move from the Chief of Staff.",
    expectedUpsideCents: action.expectedUpsideCents || workflow?.expected_profit_cents || 0,
    costCapCents: action.costCapCents || task.cost_budget_cents || 0,
    risk: action.risk || "medium",
    decision: "Open the follow-up, open the workflow, plan the next test, or generate a review pack.",
    evidence: action.evidence || [],
    hypothesis: action.hypothesis || "A clear next action should make the AI team easier to command.",
    action: action.action || "Open the workflow and choose the next protected commercial step.",
    successMetric: action.successMetric || "A buyer, offer, channel, metric, risk, and stop rule are visible before action.",
    killCriteria: action.killCriteria || "Request changes if the recommendation is vague or unsupported.",
    learningSignal: action.learningSignal || "The next result should improve future worker handoffs.",
    workflowId: action.workflowId || task.workflow_id || workflow?.id || null,
    taskId: action.taskId || task.id,
    source: "chief_of_staff",
  });
}

function packHasRecordedOutcome(pack, commercialResults = [], commercialFeedback = []) {
  return commercialResults.some((result) => result.metadata?.executionPackId === pack.id)
    || commercialFeedback.some((feedback) => feedback.metadata?.executionPackId === pack.id);
}

function researchMove(workflow, scorecard, approval, deliverable) {
  return moveBase({
    id: `money_move_research_${workflow.id}`,
    type: "evidence_gap",
    priority: approval ? 95 : 88,
    title: `Validate demand before building: ${scorecard.subject || workflow.title}`,
    recommendation: approval ? "Resolve the pending research approval." : "Prepare a capped live research test before paid creation or publishing.",
    expectedUpsideCents: workflow.expected_profit_cents || 0,
    costCapCents: approval?.payload?.estimatedCostCents || 0,
    risk: approval?.risk_level || "medium",
    decision: approval ? "Approve, request changes, or deny the research gate." : "Request a capped live research run.",
    evidence: [
      `Scorecard: ${scorecard.total_score}/100`,
      `Verdict: ${verdictLabel(scorecard.verdict)}`,
      "Live demand evidence is still missing.",
      deliverable ? `Review pack: ${deliverable.human_name}` : null,
    ].filter(Boolean),
    hypothesis: "If live demand, competitor, pricing, and risk evidence is positive, this opportunity may deserve a small sellable test.",
    action: "Run capped live research only after provider setup and approval.",
    successMetric: "Current demand, competitor/pricing evidence, risks, and keep/revise/kill recommendation captured with sources.",
    killCriteria: "Stop or rework if there is weak search/buyer demand, poor margin, high platform risk, or no reachable channel.",
    learningSignal: "Research result updates the scorecard and tells the system whether to build, revise, or stop.",
    workflowId: workflow.id,
    approvalId: approval?.id || null,
    deliverableId: deliverable?.id || null,
  });
}

function reviewPackMove(workflow, scorecard, deliverable) {
  return moveBase({
    id: `money_move_review_${deliverable.id}`,
    type: "review_output",
    priority: scorecard?.verdict === "continue" ? 84 : 74,
    title: `Review commercial pack: ${workflow.title}`,
    recommendation: "Use the pack to decide continue, revise, or stop; do not let it become paperwork.",
    expectedUpsideCents: workflow.expected_profit_cents || 0,
    costCapCents: 0,
    risk: "low",
    decision: "Preview the pack and choose the next commercial action.",
    evidence: [
      `Pack: ${deliverable.human_name}`,
      scorecard ? `Scorecard: ${scorecard.total_score}/100` : null,
      scorecard ? `Verdict: ${verdictLabel(scorecard.verdict)}` : null,
    ].filter(Boolean),
    hypothesis: "If the evidence and economics are coherent, the next move should be a measurable market test.",
    action: "Preview the pack, then approve next test, request changes, or stop.",
    successMetric: "A clear next action is recorded; no workflow stalls in review because evidence is hard to find.",
    killCriteria: "Stop if the pack cannot identify buyer, offer, channel, price, evidence, and next metric.",
    learningSignal: "Review outcome improves future pack quality and decision thresholds.",
    workflowId: workflow.id,
    deliverableId: deliverable.id,
  });
}

function controlMove(kind, details = {}) {
  const copy = {
    budget: {
      id: "money_move_budget_guard",
      title: "Protect cash while evidence is weak",
      recommendation: "Keep spend locked until demand and unit economics are proven.",
      hypothesis: "If spend stays capped while evidence improves, the system avoids expensive false positives.",
      action: "Review budget room and only approve spend tied to a measurable test.",
      successMetric: "No unapproved spend; every paid action has a commercial purpose and cap.",
      killCriteria: "Stop paid work if no buyer/channel/evidence metric exists.",
      learningSignal: "Spend outcomes update future approval thresholds.",
      priority: 62,
      type: "capital_control",
    },
    setup: {
      id: "money_move_setup_research",
      title: "Resolve live research setup when ready",
      recommendation: "Connect credentials only when the operator is ready for the first capped evidence run.",
      hypothesis: "If live research is connected behind approvals, the system can make better build/kill calls.",
      action: "Set provider credentials and live flag only when approving the capped research smoke test.",
      successMetric: "First live research run completes with sources, cost logging, and scorecard update.",
      killCriteria: "Do not enable if no capped approval or budget room exists.",
      learningSignal: "Provider readiness and first run result determine the next automation investment.",
      priority: 70,
      type: "setup_gate",
    },
  }[kind];
  return moveBase({ ...copy, ...details });
}

function buildCommercialMetrics({
  tasks = [],
  workflows,
  approvals,
  scorecards,
  deliverables,
  researchSources,
  costs,
  revenue,
  commercialExperiments = [],
  commercialBriefs = [],
  commercialTestCandidates = [],
  commercialExecutionPacks = [],
  commercialResults = [],
  commercialFeedback = [],
  commercialLearningCycles = [],
}) {
  const spendCents = costs.reduce((sum, cost) => sum + Number(cost.amount_cents || 0), 0);
  const revenueCents = revenue.reduce((sum, item) => sum + Number(item.amount_cents || 0), 0);
  const profitCents = revenueCents - spendCents;
  const commercial = aggregateCommercialResults(commercialResults);
  return {
    revenueCents,
    spendCents,
    profitCents,
    roi: spendCents > 0 ? Number((profitCents / spendCents).toFixed(2)) : null,
    pendingDecisions: approvals.filter((approval) => approval.status === "pending").length,
    activeCommercialWorkflows: commercialWorkflowCount(workflows),
    scorecardsNeedingResearch: scorecards.filter((scorecard) => scorecard.verdict === "research_required").length,
    reviewPacksReady: deliverables.filter((deliverable) => String(deliverable.format || "").toLowerCase() === "pdf" && deliverable.status === "ready_for_review").length,
    liveEvidenceSources: researchSources.filter((source) => source.url || source.provider).length,
    activeExperiments: commercialExperiments.filter((experiment) => ["running", "measuring"].includes(experiment.status)).length,
    commercialBriefs: commercialBriefs.length,
    plannedTests: commercialTestCandidates.filter((candidate) => candidate.status === "planned_test").length,
    promotedTests: commercialTestCandidates.filter((candidate) => candidate.status === "promoted").length,
    executionPacks: commercialExecutionPacks.length,
    readyExecutionPacks: commercialExecutionPacks.filter((pack) => pack.status === "ready_to_test").length,
    topTestScore: commercialTestCandidates.find((candidate) => candidate.status === "planned_test")?.evidence_score || 0,
    commercialResults: commercialResults.length,
    customerFeedback: commercialFeedback.length,
    learningCycles: commercialLearningCycles.length,
    chiefOfStaffNextActions: tasks.filter((task) => task.kind === "handoff_followup" && task.status === "completed" && task.result?.output?.commercialNextAction).length,
    latestLearningVerdict: commercialLearningCycles[0]?.verdict || "none",
    commercial,
  };
}

function buildImprovementLoop(metrics, moves, commercialLearningCycles = []) {
  const topMove = moves[0] || null;
  const latestLearning = commercialLearningCycles[0] || null;
  const actualResult = latestLearning?.actual_result
    || (metrics.commercialResults > 0
      ? `${metrics.commercial.views} views, ${metrics.commercial.clicks} clicks, ${metrics.commercial.sales} sales, ${moneyLabel(metrics.commercial.revenueCents)} revenue, ${moneyLabel(metrics.commercial.cashContributionCents)} net cash contribution recorded.`
      : metrics.revenueCents > 0
        ? `${moneyLabel(metrics.revenueCents)} revenue and ${moneyLabel(metrics.profitCents)} net cash contribution recorded.`
        : "No revenue is recorded yet; the system is still in evidence-building mode.");
  return {
    model: "hypothesis_action_result_improvement",
    rule: "Every commercial action must state the expected buyer or business result, measure what happened, and improve the next action from the evidence.",
    steps: IMPROVEMENT_STEPS,
    currentCycle: {
      hypothesis: latestLearning?.hypothesis || topMove?.hypothesis || "A small measurable test will reveal whether this opportunity deserves more time or money.",
      action: latestLearning?.next_action || topMove?.action || "Choose the next smallest useful commercial action.",
      expectedMetric: latestLearning?.expected_metric || topMove?.successMetric || "A decision, sale, click, source-backed evidence, or kill signal is recorded.",
      actualResult,
      learning: latestLearning?.learning || (metrics.liveEvidenceSources > 0 ? "Live evidence exists and should update scorecards." : "Commercial judgement is limited until live evidence and buyer metrics are connected."),
      improvement: latestLearning?.improvement || topMove?.learningSignal || "Use the next result to scale, revise, pause, or kill the workflow.",
    },
  };
}

function buildMoneyMoves({
  tasks = [],
  workflows,
  approvals,
  scorecards,
  deliverables,
  liveResearchReadiness,
  metrics,
  commercialExperiments = [],
  commercialBriefs = [],
  commercialTestCandidates = [],
  commercialExecutionPacks = [],
  commercialResults = [],
  commercialFeedback = [],
  commercialLearningCycles = [],
}) {
  const moves = [];
  for (const approval of approvals.filter((item) => item.status === "pending")) {
    const workflow = workflows.find((item) => item.id === approval.workflow_id);
    moves.push(approvalMove(approval, workflow, workflow ? latestPdfForWorkflow(deliverables, workflow.id) : null));
  }

  for (const cycle of commercialLearningCycles.slice(0, 5)) {
    const workflow = workflows.find((item) => item.id === cycle.workflow_id);
    const experiment = commercialExperiments.find((item) => item.id === cycle.experiment_id);
    moves.push(learningMove(cycle, workflow, experiment));
  }

  for (const task of tasks.filter((item) => item.kind === "handoff_followup" && item.status === "completed" && item.result?.output?.commercialNextAction).slice(0, 4)) {
    const action = task.result.output.commercialNextAction;
    const workflow = workflows.find((item) => item.id === (action.workflowId || task.workflow_id));
    moves.push(chiefOfStaffNextActionMove(task, action, workflow));
  }

  const packsByExperiment = new Map(commercialExecutionPacks.map((pack) => [pack.experiment_id, pack]));
  for (const experiment of commercialExperiments.filter((item) => ["ready", "running", "measuring"].includes(item.status)).slice(0, 6)) {
    const existingPack = packsByExperiment.get(experiment.id);
    if (existingPack) continue;
    const workflow = workflows.find((item) => item.id === experiment.workflow_id);
    const candidate = commercialTestCandidates.find((item) => item.id === experiment.metadata?.candidateId || item.promoted_experiment_id === experiment.id);
    moves.push(executionPackNeededMove(experiment, workflow, candidate));
  }

  for (const pack of commercialExecutionPacks.filter((item) => item.status === "ready_to_test").slice(0, 6)) {
    if (packHasRecordedOutcome(pack, commercialResults, commercialFeedback)) continue;
    const workflow = workflows.find((item) => item.id === pack.workflow_id);
    const experiment = commercialExperiments.find((item) => item.id === pack.experiment_id);
    moves.push(executionReadyMove(pack, workflow, experiment));
  }

  for (const candidate of commercialTestCandidates.filter((item) => item.status === "planned_test").slice(0, 4)) {
    const workflow = workflows.find((item) => item.id === candidate.workflow_id);
    const brief = commercialBriefs.find((item) => item.id === candidate.brief_id);
    moves.push(nextTestMove(candidate, workflow, brief));
  }

  for (const scorecard of scorecards.filter((item) => item.verdict === "research_required").slice(0, 5)) {
    const workflow = workflows.find((item) => item.id === scorecard.workflow_id);
    if (!workflow) continue;
    const pendingApproval = pendingApprovalsForWorkflow(approvals, workflow.id)[0] || null;
    moves.push(researchMove(workflow, scorecard, pendingApproval, latestPdfForWorkflow(deliverables, workflow.id)));
  }

  for (const deliverable of deliverables.filter((item) => String(item.format || "").toLowerCase() === "pdf" && item.status === "ready_for_review").slice(0, 4)) {
    const workflow = workflows.find((item) => item.id === deliverable.workflow_id);
    if (!workflow) continue;
    moves.push(reviewPackMove(workflow, scorecardForWorkflow(scorecards, workflow.id), deliverable));
  }

  if (liveResearchReadiness && !liveResearchReadiness.ready && liveResearchReadiness.pendingApprovals > 0) {
    moves.push(controlMove("setup", {
      evidence: liveResearchReadiness.blockers || [],
      costCapCents: liveResearchReadiness.defaultBudgetCents || 0,
      risk: "medium",
    }));
  }

  if (metrics.revenueCents === 0 && metrics.spendCents === 0) {
    moves.push(controlMove("budget", {
      evidence: ["No revenue recorded yet.", "No actual spend recorded yet."],
      risk: "low",
    }));
  }

  const seen = new Set();
  return moves
    .filter((move) => {
      if (seen.has(move.id)) return false;
      seen.add(move.id);
      return true;
    })
    .sort((a, b) => b.priority - a.priority)
    .slice(0, 8);
}

function buildCommercialBrain(input) {
  const metrics = buildCommercialMetrics(input);
  const moneyMoves = buildMoneyMoves({ ...input, metrics });
  return {
    status: moneyMoves.some((move) => move.type === "operator_decision") ? "operator_decision_needed" : "building_evidence",
    headline: moneyMoves[0]?.title || "No urgent money move is waiting.",
    operatingRule: "Agents do the heavy work; the operator sees the money move, evidence, risk, expected upside, and decision buttons.",
    principles: COMMERCIAL_PRINCIPLES,
    roles: COMMERCIAL_ROLES,
    metrics,
    moneyMoves,
    improvementLoop: buildImprovementLoop(metrics, moneyMoves, input.commercialLearningCycles || []),
  };
}

module.exports = {
  COMMERCIAL_PRINCIPLES,
  COMMERCIAL_ROLES,
  IMPROVEMENT_STEPS,
  buildCommercialBrain,
};
