const { all, fromJson, get, insertEvent, now, randomId, run, toJson } = require("../db");
const { createCommercialExperiment, getCommercialExperiment } = require("./commercial-results");

const FRAMEWORKS = [
  "Money Move Contract",
  "AARRR funnel",
  "ICE prioritisation",
  "Unit Economics Gate",
  "Build Measure Learn",
];

function asText(value, fallback = "") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function asMoney(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : fallback;
}

function safeSlug(value) {
  return String(value || "test")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "test";
}

function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, Math.round(Number(value) || 0)));
}

function parseRows(rows) {
  return rows.map((row) => ({ ...row, metadata: fromJson(row.metadata) }));
}

function compactText(value, limit = 700) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > limit ? `${text.slice(0, limit - 3).trim()}...` : text;
}

function workflowContext(db, workflowId) {
  const workflow = workflowId ? get(db, "SELECT * FROM workflows WHERE id = ?", [workflowId]) : null;
  if (!workflow && workflowId) throw new Error(`Workflow not found: ${workflowId}`);
  const metadata = fromJson(workflow?.metadata);
  return {
    workflow: workflow ? { ...workflow, metadata } : null,
    ventureId: workflow?.venture_id || null,
    title: workflow?.title || "Commercial test plan",
    buyer: metadata.buyer || metadata.targetCustomer || "A specific reachable buyer",
    problem: metadata.problem || metadata.pain || "A painful business or personal problem",
    offer: metadata.offer || metadata.subject || workflow?.title || "A focused digital product offer",
    channel: metadata.channel || "A low-cost owned or community channel",
    priceCents: asMoney(metadata.priceCents || workflow?.expected_profit_cents || 1900, 1900),
  };
}

function inferTitle(input, context) {
  return asText(input.title, asText(input.idea, context.title)).slice(0, 120);
}

function inferBuyer(input, context) {
  return asText(input.buyer, context.buyer);
}

function inferProblem(input, context) {
  return asText(input.problem, context.problem);
}

function inferOffer(input, context) {
  return asText(input.offer, context.offer);
}

function inferChannel(input, context) {
  return asText(input.channel, context.channel);
}

function evidencePoints({ buyer, problem, offer, channel, evidenceSummary, priceCents, costCapCents, targetValue }) {
  return {
    buyer: buyer && !buyer.toLowerCase().includes("specific reachable") ? 14 : 6,
    problem: problem && !problem.toLowerCase().includes("painful business") ? 14 : 6,
    offer: offer && !offer.toLowerCase().includes("focused digital") ? 14 : 8,
    channel: channel && !channel.toLowerCase().includes("low-cost") ? 12 : 8,
    evidence: evidenceSummary ? 14 : 4,
    price: priceCents > 0 ? 10 : 2,
    unitEconomics: priceCents > costCapCents ? 10 : 4,
    measurability: targetValue > 0 ? 8 : 4,
    lowSpend: costCapCents <= 500 ? 4 : 0,
  };
}

function scoreCandidate(candidate) {
  const points = evidencePoints(candidate);
  return clamp(Object.values(points).reduce((sum, value) => sum + value, 0));
}

function confidenceFor(score) {
  if (score >= 78) return "medium";
  if (score >= 58) return "low_medium";
  return "low";
}

function marginFor(priceCents, costCapCents) {
  const fulfillmentEstimate = Math.max(0, Math.round(priceCents * 0.08));
  return Math.max(0, priceCents - fulfillmentEstimate - costCapCents);
}

function candidateTemplates(base) {
  const price = base.priceCents || 1900;
  const buyer = base.buyer;
  const problem = base.problem;
  const offer = base.offer;
  const channel = base.channel;
  const evidence = base.evidenceSummary;
  const sourceResearchRunId = base.sourceResearchRunId || null;
  const sourceLearningId = base.sourceLearningId || null;
  const sourceExecutionPackId = base.sourceExecutionPackId || null;
  const source = base.source || "operator";
  return [
    {
      title: `Small audience offer test: ${offer}`,
      buyer,
      problem,
      offer,
      channel,
      priceCents: price,
      costCapCents: 0,
      targetValue: 3,
      targetUnit: "leads",
      expectedMetric: "At least 3 qualified leads or one paid sale from a small audience sample.",
      successMetric: "3 qualified leads or 1 paid sale with no paid traffic.",
      smallestAction: "Put the offer in front of a small relevant audience and capture clicks, leads, objections, and sales.",
      killCriteria: "Stop or rewrite if 100 targeted views produce no clicks, leads, useful replies, or sales.",
      risk: "low",
      acquisitionStage: "Acquisition",
      rationale: "Best first move because it tests buyer and promise before spending money or building more assets.",
    },
    {
      title: `Paid-demand preorder test: ${offer}`,
      buyer,
      problem,
      offer: `${offer} with a simple preorder or checkout promise`,
      channel: channel.includes("checkout") ? channel : `${channel} plus a simple checkout link`,
      priceCents: price,
      costCapCents: 0,
      targetValue: 1,
      targetUnit: "sales",
      expectedMetric: "At least 1 paid order or a clear purchase objection from targeted traffic.",
      successMetric: "1 sale, or a specific price/product objection from a reachable buyer.",
      smallestAction: "Create a lightweight checkout/preorder path and send targeted traffic to it without paid ads.",
      killCriteria: "Do not build more if targeted visitors click but nobody attempts purchase or explains why.",
      risk: "medium",
      acquisitionStage: "Revenue",
      rationale: "Useful once the offer is clear because payment intent beats vague interest.",
    },
    {
      title: `Problem-interview proof test: ${problem}`,
      buyer,
      problem,
      offer: `A sharper version of ${offer} based on buyer wording`,
      channel: "Direct outreach or existing audience replies",
      priceCents: price,
      costCapCents: 0,
      targetValue: 5,
      targetUnit: "leads",
      expectedMetric: "At least 5 useful replies, objections, or buyer-language signals.",
      successMetric: "5 useful replies that clarify the buyer, pain, promise, or price.",
      smallestAction: "Ask a focused buyer group about the problem and offer before building more.",
      killCriteria: "Rework the buyer or problem if replies show low pain, unclear value, or no willingness to pay.",
      risk: "low",
      acquisitionStage: "Activation",
      rationale: "Useful when evidence is thin because it improves copy, positioning, and product scope cheaply.",
    },
  ].map((candidate) => {
    const grossMarginCents = marginFor(candidate.priceCents, candidate.costCapCents);
    const evidenceScore = scoreCandidate({ ...candidate, evidenceSummary: evidence });
    return {
      ...candidate,
      grossMarginCents,
      evidenceScore,
      confidence: confidenceFor(evidenceScore),
      hypothesis: `If ${buyer} sees ${offer} through ${candidate.channel}, the test should produce ${candidate.successMetric.toLowerCase()}`,
      metadata: {
        frameworks: FRAMEWORKS,
        source,
        sourceResearchRunId,
        sourceLearningId,
        sourceExecutionPackId,
        aarrrStage: candidate.acquisitionStage,
        scoring: {
          model: "ICE-style readiness score",
          score: evidenceScore,
          evidenceSummary: evidence,
        },
        unitEconomics: {
          priceCents: candidate.priceCents,
          costCapCents: candidate.costCapCents,
          grossMarginCents,
        },
      },
    };
  });
}

function getBrief(db, id) {
  const row = get(db, "SELECT * FROM commercial_briefs WHERE id = ?", [id]);
  return row ? parseRows([row])[0] : null;
}

function getCandidate(db, id) {
  const row = get(db, "SELECT * FROM commercial_test_candidates WHERE id = ?", [id]);
  return row ? parseRows([row])[0] : null;
}

function candidatesForBrief(db, briefId) {
  return parseRows(
    all(
      db,
      "SELECT * FROM commercial_test_candidates WHERE brief_id = ? ORDER BY rank ASC, evidence_score DESC, created_at DESC",
      [briefId],
    ),
  );
}

function getResearchRun(db, researchRunId) {
  const row = get(db, "SELECT * FROM research_runs WHERE id = ?", [researchRunId]);
  return row ? { ...row, metadata: fromJson(row.metadata) } : null;
}

function sourceCountForResearchRun(db, researchRunId) {
  const row = get(db, "SELECT COUNT(*) AS count FROM research_sources WHERE run_id = ?", [researchRunId]);
  return Number(row?.count || 0);
}

function findBriefForResearchRun(db, researchRunId) {
  if (!researchRunId) return null;
  return parseRows(all(db, "SELECT * FROM commercial_briefs ORDER BY created_at DESC"))
    .find((brief) => String(brief.metadata?.sourceResearchRunId || "") === String(researchRunId)) || null;
}

function getLearningCycle(db, id) {
  const row = get(db, "SELECT * FROM commercial_learning_cycles WHERE id = ?", [id]);
  return row ? parseRows([row])[0] : null;
}

function findBriefForLearning(db, learningId) {
  if (!learningId) return null;
  return parseRows(all(db, "SELECT * FROM commercial_briefs ORDER BY created_at DESC"))
    .find((brief) => String(brief.metadata?.sourceLearningId || "") === String(learningId)) || null;
}

function researchFindingText(value) {
  if (!value) return "";
  if (typeof value === "string") return compactText(value, 220);
  if (typeof value === "object") {
    return compactText([value.finding, value.evidence].filter(Boolean).join(": "), 220);
  }
  return compactText(value, 220);
}

function researchBridgeInput(db, researchRun, options = {}) {
  const context = workflowContext(db, researchRun.workflow_id);
  const metadata = researchRun.metadata || {};
  const parsed = metadata.parsed || {};
  const workflowMetadata = context.workflow?.metadata || {};
  const sourceCount = sourceCountForResearchRun(db, researchRun.id);
  const subject = asText(metadata.subject || workflowMetadata.subject, context.title);
  const channel = asText(metadata.channel || workflowMetadata.channel, context.channel);
  const verdict = asText(parsed.verdict, "research_inconclusive");
  const confidence = asText(parsed.confidence, researchRun.status === "completed_live" ? "medium" : "low");
  const marketDemand = researchFindingText(parsed.marketDemand);
  const competitionPricing = researchFindingText(parsed.competitionPricing);
  const freshnessRisk = researchFindingText(parsed.freshnessRisk);
  const recommendation = compactText(parsed.recommendation || researchRun.summary || "", 240);
  const evidenceSummary = compactText(
    [
      `Live research verdict: ${verdict}.`,
      `Confidence: ${confidence}.`,
      `${sourceCount} cited source${sourceCount === 1 ? "" : "s"} recorded.`,
      researchRun.summary,
      marketDemand ? `Demand: ${marketDemand}` : "",
      competitionPricing ? `Pricing: ${competitionPricing}` : "",
      freshnessRisk ? `Risk: ${freshnessRisk}` : "",
    ].filter(Boolean).join(" "),
    1200,
  );
  const researchBasis = compactText(
    [
      researchRun.summary,
      marketDemand ? `Market demand: ${marketDemand}` : "",
      competitionPricing ? `Competition and pricing: ${competitionPricing}` : "",
      freshnessRisk ? `Freshness and risk: ${freshnessRisk}` : "",
      recommendation ? `Recommended next step: ${recommendation}` : "",
      Array.isArray(parsed.assumptions) && parsed.assumptions.length
        ? `Assumptions to validate: ${parsed.assumptions.join("; ")}`
        : "",
    ].filter(Boolean).join("\n"),
    1800,
  );

  return {
    workflowId: researchRun.workflow_id,
    source: "live_research",
    researchRunId: researchRun.id,
    title: `${subject} live-research test plan`,
    idea: compactText(`${subject}: ${researchRun.summary || recommendation}`, 600),
    buyer: context.buyer,
    problem: context.problem,
    offer: context.offer,
    channel,
    priceCents: context.priceCents,
    evidenceSummary,
    researchBasis,
    createdBy: options.createdBy || "research-agent",
    researchEvidence: {
      researchRunId: researchRun.id,
      researchStatus: researchRun.status,
      provider: researchRun.provider,
      mode: researchRun.mode,
      query: researchRun.query,
      verdict,
      confidence,
      sourceCount,
      recommendation,
      marketDemand,
      competitionPricing,
      freshnessRisk,
      exactBillingPending: Boolean(metadata.exactBillingPending),
      responseId: metadata.responseId || null,
      model: metadata.model || null,
    },
  };
}

function learningRevisionOffer(baseOffer, verdict) {
  const offer = asText(baseOffer, "the current offer");
  if (verdict === "continue") return `${offer} for the next controlled sample`;
  if (verdict === "kill_or_rework") return `A materially reworked version of ${offer}`;
  return `A sharper version of ${offer} using the latest market signal`;
}

function learningRevisionInput(db, learning, options = {}) {
  const experiment = learning.experiment_id ? getCommercialExperiment(db, learning.experiment_id) : null;
  const packet = learning.metadata?.outcomeDecisionPacket || {};
  const workflowId = learning.workflow_id || experiment?.workflow_id || null;
  const context = workflowContext(db, workflowId);
  const verdict = asText(learning.verdict, "needs_evidence");
  const buyer = asText(packet.buyer || experiment?.buyer, context.buyer);
  const problem = asText(packet.problem || experiment?.metadata?.problem, context.problem);
  const baseOffer = asText(packet.offer || experiment?.offer, context.offer);
  const offer = learningRevisionOffer(baseOffer, verdict);
  const channel = asText(packet.channel || experiment?.channel, context.channel);
  const nextAction = asText(packet.nextAction || learning.next_action, "Run the next smallest controlled test.");
  const improvement = asText(learning.improvement || packet.continuousImprovement?.improvement, "Change one assumption before widening effort.");
  const actualResult = asText(learning.actual_result || packet.continuousImprovement?.actualResult, "No actual result summary captured.");
  const learningSummary = asText(learning.learning || packet.continuousImprovement?.learning, "The result should improve the next test.");
  const evidenceSummary = compactText(
    [
      `Previous verdict: ${verdict}.`,
      `Actual result: ${actualResult}`,
      `Learning: ${learningSummary}`,
      `Recommended improvement: ${improvement}`,
      packet.moneyMove ? `Chief of Staff money move: ${packet.moneyMove}` : "",
    ].filter(Boolean).join(" "),
    1200,
  );
  return {
    workflowId,
    source: "learning_revision",
    title: `Revised test from learning: ${experiment?.name || baseOffer}`,
    idea: compactText(`${nextAction} ${improvement}`, 600),
    buyer,
    problem,
    offer,
    channel,
    priceCents: asMoney(packet.priceCents ?? experiment?.price_cents ?? context.priceCents, context.priceCents),
    evidenceSummary,
    researchBasis: compactText(
      [
        `Source learning cycle: ${learning.id}`,
        `Verdict: ${verdict}`,
        `Actual result: ${actualResult}`,
        `Learning: ${learningSummary}`,
        `Improvement: ${improvement}`,
        `Next action: ${nextAction}`,
      ].join("\n"),
      1800,
    ),
    sourceLearningId: learning.id,
    sourceExecutionPackId: packet.executionPackId || null,
    createdBy: options.createdBy || "chief-of-staff-learning",
    revisionEvidence: {
      learningId: learning.id,
      verdict,
      actualResult,
      learning: learningSummary,
      improvement,
      nextAction,
      outcomeDecisionPacketId: packet.chiefRunId || null,
      executionPackId: packet.executionPackId || null,
      resultId: packet.resultId || null,
      feedbackId: packet.feedbackId || null,
    },
  };
}

function createResearchToExperimentPlan(db, input = {}) {
  const workflowId = input.workflowId || input.workflow_id || null;
  const context = workflowContext(db, workflowId);
  const ts = now();
  const title = inferTitle(input, context);
  const buyer = inferBuyer(input, context);
  const problem = inferProblem(input, context);
  const offer = inferOffer(input, context);
  const channel = inferChannel(input, context);
  const evidenceSummary = asText(input.evidenceSummary || input.evidence_summary);
  const researchBasis = asText(input.researchBasis || input.research_basis || input.idea, title);
  const providedPriceCents = asMoney(input.priceCents ?? input.price_cents, 0);
  const priceCents = providedPriceCents > 0 ? providedPriceCents : context.priceCents;
  const briefId = input.id || `brief_${safeSlug(title)}_${randomId().slice(0, 8)}`;
  const sourceResearchRunId = input.researchRunId || input.research_run_id || null;
  const source = asText(input.source, "operator");

  run(
    db,
    `INSERT INTO commercial_briefs
     (id, workflow_id, venture_id, source, status, title, idea, buyer, problem, evidence_summary,
      research_basis, metadata, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      briefId,
      context.workflow?.id || null,
      context.ventureId,
      source,
      "candidate_tests_ready",
      title,
      asText(input.idea, title),
      buyer,
      problem,
      evidenceSummary,
      researchBasis,
      toJson({
        frameworks: FRAMEWORKS,
        channel,
        offer,
        priceCents,
        dryRunOnly: true,
        sourceResearchRunId,
        sourceLearningId: input.sourceLearningId || input.source_learning_id || null,
        sourceExecutionPackId: input.sourceExecutionPackId || input.source_execution_pack_id || null,
        researchEvidence: input.researchEvidence || input.research_evidence || null,
        revisionEvidence: input.revisionEvidence || input.revision_evidence || null,
        createdBy: input.createdBy || input.created_by || null,
      }),
      ts,
      ts,
    ],
  );

  const base = {
    buyer,
    problem,
    offer,
    channel,
    priceCents,
    evidenceSummary,
    source,
    sourceResearchRunId,
    sourceLearningId: input.sourceLearningId || input.source_learning_id || null,
    sourceExecutionPackId: input.sourceExecutionPackId || input.source_execution_pack_id || null,
  };
  const generated = candidateTemplates(base)
    .sort((a, b) => b.evidenceScore - a.evidenceScore)
    .map((candidate, index) => ({ ...candidate, rank: index + 1 }));

  for (const candidate of generated) {
    const candidateId = `test_${safeSlug(candidate.title)}_${randomId().slice(0, 8)}`;
    run(
      db,
      `INSERT INTO commercial_test_candidates
       (id, brief_id, workflow_id, venture_id, rank, status, title, buyer, problem, offer, channel,
        price_cents, gross_margin_cents, cost_cap_cents, evidence_score, confidence, hypothesis,
        smallest_action, expected_metric, target_value, target_unit, success_metric, kill_criteria,
        risk, rationale, promoted_experiment_id, metadata, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        candidateId,
        briefId,
        context.workflow?.id || null,
        context.ventureId,
        candidate.rank,
        "planned_test",
        candidate.title,
        candidate.buyer,
        candidate.problem,
        candidate.offer,
        candidate.channel,
        candidate.priceCents,
        candidate.grossMarginCents,
        candidate.costCapCents,
        candidate.evidenceScore,
        candidate.confidence,
        candidate.hypothesis,
        candidate.smallestAction,
        candidate.expectedMetric,
        candidate.targetValue,
        candidate.targetUnit,
        candidate.successMetric,
        candidate.killCriteria,
        candidate.risk,
        candidate.rationale,
        null,
        toJson(candidate.metadata),
        ts,
        ts,
      ],
    );
  }

  insertEvent(db, {
    actor: "commercial-engine",
    type: "commercial_test.candidates_created",
    entityType: "commercial_brief",
    entityId: briefId,
    message: `Next test options prepared for ${title}.`,
    metadata: { workflowId: context.workflow?.id || null, candidateCount: generated.length, frameworks: FRAMEWORKS },
  });

  const candidates = candidatesForBrief(db, briefId);
  return {
    brief: getBrief(db, briefId),
    candidates,
    recommended: candidates[0] || null,
  };
}

function createResearchToExperimentPlanFromResearch(db, researchRunId, options = {}) {
  const researchRun = getResearchRun(db, researchRunId);
  if (!researchRun) throw new Error(`Research run not found: ${researchRunId}`);
  const allowedStatuses = new Set(["completed_live", "completed_live_needs_source_review"]);
  if (researchRun.mode !== "live" || !allowedStatuses.has(researchRun.status)) {
    return {
      researchRun,
      skipped: true,
      reason: "Only completed live research creates commercial test candidates.",
      alreadyCreated: false,
      brief: null,
      candidates: [],
      recommended: null,
    };
  }

  const existingBrief = findBriefForResearchRun(db, researchRun.id);
  if (existingBrief) {
    const existingCandidates = candidatesForBrief(db, existingBrief.id);
    return {
      researchRun,
      skipped: false,
      alreadyCreated: true,
      brief: existingBrief,
      candidates: existingCandidates,
      recommended: existingCandidates[0] || null,
    };
  }

  const plan = createResearchToExperimentPlan(db, researchBridgeInput(db, researchRun, options));
  insertEvent(db, {
    actor: "commercial-engine",
    type: "commercial_test.live_research_bridge_created",
    entityType: "research_run",
    entityId: researchRun.id,
    message: `Live research converted into ${plan.candidates.length} ranked next-test option${plan.candidates.length === 1 ? "" : "s"}.`,
    metadata: {
      workflowId: researchRun.workflow_id || null,
      taskId: researchRun.task_id || null,
      briefId: plan.brief.id,
      recommendedCandidateId: plan.recommended?.id || null,
      sourceCount: sourceCountForResearchRun(db, researchRun.id),
      createdBy: options.createdBy || "research-agent",
    },
  });

  return {
    researchRun,
    skipped: false,
    alreadyCreated: false,
    ...plan,
  };
}

function createRevisionPlanFromLearning(db, learningId, options = {}) {
  const learning = getLearningCycle(db, learningId);
  if (!learning) throw new Error(`Commercial learning cycle not found: ${learningId}`);
  const existingBrief = findBriefForLearning(db, learning.id);
  if (existingBrief) {
    const existingCandidates = candidatesForBrief(db, existingBrief.id);
    return {
      learning,
      alreadyCreated: true,
      brief: existingBrief,
      candidates: existingCandidates,
      recommended: existingCandidates[0] || null,
    };
  }

  const plan = createResearchToExperimentPlan(db, learningRevisionInput(db, learning, options));
  insertEvent(db, {
    actor: "commercial-engine",
    type: "commercial_learning.revision_plan_created",
    entityType: "commercial_learning",
    entityId: learning.id,
    message: `Learning converted into ${plan.candidates.length} revised test option${plan.candidates.length === 1 ? "" : "s"}.`,
    metadata: {
      workflowId: learning.workflow_id || null,
      experimentId: learning.experiment_id || null,
      briefId: plan.brief.id,
      recommendedCandidateId: plan.recommended?.id || null,
      createdBy: options.createdBy || "chief-of-staff-learning",
    },
  });
  return {
    learning,
    alreadyCreated: false,
    ...plan,
  };
}

function promoteCandidateToExperiment(db, candidateId, options = {}) {
  const candidate = getCandidate(db, candidateId);
  if (!candidate) throw new Error(`Commercial test candidate not found: ${candidateId}`);
  if (candidate.promoted_experiment_id) {
    return {
      candidate,
      experiment: getCommercialExperiment(db, candidate.promoted_experiment_id),
      alreadyPromoted: true,
    };
  }

  const experiment = createCommercialExperiment(db, {
    workflowId: candidate.workflow_id || undefined,
    name: candidate.title,
    status: "ready",
    hypothesis: candidate.hypothesis,
    buyer: candidate.buyer,
    offer: candidate.offer,
    channel: candidate.channel,
    priceCents: candidate.price_cents,
    expectedMetric: candidate.expected_metric,
    targetValue: candidate.target_value,
    targetUnit: candidate.target_unit,
    costCapCents: candidate.cost_cap_cents,
    metadata: {
      source: "research_to_experiment_bridge",
      candidateId: candidate.id,
      briefId: candidate.brief_id,
      smallestAction: candidate.smallest_action,
      successMetric: candidate.success_metric,
      killCriteria: candidate.kill_criteria,
      risk: candidate.risk,
      rationale: candidate.rationale,
      frameworks: FRAMEWORKS,
      dryRunOnly: true,
      promotedBy: options.promotedBy || "operator",
    },
  });
  const ts = now();
  run(
    db,
    "UPDATE commercial_test_candidates SET status = ?, promoted_experiment_id = ?, updated_at = ? WHERE id = ?",
    ["promoted", experiment.id, ts, candidate.id],
  );
  run(
    db,
    "UPDATE commercial_briefs SET status = ?, updated_at = ? WHERE id = ?",
    ["experiment_promoted", ts, candidate.brief_id],
  );
  insertEvent(db, {
    actor: "commercial-engine",
    type: "commercial_test.promoted",
    entityType: "commercial_test_candidate",
    entityId: candidate.id,
    message: `Next test promoted: ${candidate.title}.`,
    metadata: { workflowId: candidate.workflow_id || null, experimentId: experiment.id, briefId: candidate.brief_id },
  });

  return {
    candidate: getCandidate(db, candidate.id),
    experiment: getCommercialExperiment(db, experiment.id),
    alreadyPromoted: false,
  };
}

module.exports = {
  FRAMEWORKS,
  createResearchToExperimentPlan,
  createResearchToExperimentPlanFromResearch,
  createRevisionPlanFromLearning,
  getBrief,
  getCandidate,
  promoteCandidateToExperiment,
};
