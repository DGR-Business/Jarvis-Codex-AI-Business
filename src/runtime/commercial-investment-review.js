const crypto = require("node:crypto");
const CONFIG = require("../config");
const { all, fromJson, get, insertEvent, now, randomId, run, toJson } = require("../db");
const {
  COMMERCIAL_CONSTITUTION_VERSION,
  INVESTMENT_CRITERIA,
} = require("../../config/commercial-constitution");
const { approveInternalWorkWithinMandate } = require("./pantheon-policy");
const { requestLiveAiWorker } = require("./live-ai-workers");
const { selectVentureKit } = require("./venture-kit-registry");

const DIRECT_DEMAND_PATTERN = /\b(bought|buyer|purchase|purchased|paid|payment|order|orders|sales|sold|revenue|transaction|checkout|conversion|enquiry|inquiry|waitlist|review|reviews|rating|ratings|downloaded|subscribers?)\b/i;
const NUMERIC_PATTERN = /(?:A?\$|USD|AUD|%|\b)\s*\d+(?:[.,]\d+)?/i;

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, canonical(value[key])]),
    );
  }
  return value ?? null;
}

function hash(value) {
  return crypto.createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
}

function text(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function operatorReviewSummary(value) {
  return text(value)
    .replace(
      /\bthe finance analysis failed\b/gi,
      "the finance case did not clear its investment gate",
    );
}

function parseOpportunity(row) {
  if (!row) return null;
  return {
    ...row,
    evidence_ids: fromJson(row.evidence_ids, []),
    metadata: fromJson(row.metadata, {}),
  };
}

function evidenceRows(db, opportunity) {
  if (!opportunity.evidence_ids.length) return [];
  const rows = opportunity.evidence_ids
    .map((id) => get(db, "SELECT * FROM commercial_evidence WHERE id = ?", [id]))
    .filter(Boolean);
  return rows.map((row) => ({
    ...row,
    metadata: fromJson(row.metadata, {}),
  }));
}

function result(status, reason, evidence = [], missing = []) {
  return {
    status,
    passed: status === "passed",
    reason,
    evidence,
    missing,
  };
}

function directDemandSignals(opportunity, evidence) {
  const validation = opportunity.metadata.validation || {};
  const statements = [
    ...(Array.isArray(validation.evidence) ? validation.evidence : []),
    ...(Array.isArray(opportunity.metadata.demandEvidence) ? opportunity.metadata.demandEvidence : []),
  ].map(text).filter(Boolean);
  const attributableSources = [
    ...(Array.isArray(validation.sources) ? validation.sources : []),
    ...evidence.filter((item) => /^https?:\/\//i.test(item.source_url || "")).map((item) => ({
      url: item.source_url,
      title: item.title,
    })),
  ];
  const sourceUrls = [...new Set(attributableSources.map((item) => text(item.url)).filter(Boolean))];
  const directStatements = statements.filter((statement) => DIRECT_DEMAND_PATTERN.test(statement));
  return {
    statements,
    directStatements,
    sourceUrls,
    supported: directStatements.length >= 2 && sourceUrls.length >= 2,
  };
}

function financeDecision(db, finance) {
  const recorded = text(finance.decision || finance.operatorDecision).toLowerCase();
  if (recorded) return recorded;
  if (!finance.taskId) return "";
  const task = get(db, "SELECT result FROM tasks WHERE id = ?", [finance.taskId]);
  const taskResult = fromJson(task?.result, {});
  return text(taskResult.output?.operatorDecision).toLowerCase();
}

function economicsSignals(db, opportunity) {
  const finance = opportunity.metadata.finance || {};
  const work = finance.work || {};
  const values = {
    price: text(work.price),
    marginLogic: text(work.marginLogic),
    breakEven: text(work.breakEven),
    costCap: text(work.costCap),
    financialRisk: text(work.financialRisk),
    decisionSignal: text(work.decisionSignal || finance.recommendation),
  };
  const numericFields = ["price", "marginLogic", "breakEven", "costCap"]
    .filter((key) => NUMERIC_PATTERN.test(values[key]));
  const complete = Object.values(values).every((value) => value.length >= 8);
  const decision = financeDecision(db, finance);
  const denied = ["deny", "denied", "reject", "rejected"].includes(decision);
  const approved = decision === "approve";
  return { finance, values, numericFields, complete, decision, denied, approved };
}

function assessInvestmentCase(db, opportunityId) {
  const opportunity = parseOpportunity(get(db, "SELECT * FROM opportunities WHERE id = ?", [opportunityId]));
  if (!opportunity) throw new Error(`Opportunity not found: ${opportunityId}`);
  const round = get(db, "SELECT * FROM opportunity_rounds WHERE id = ?", [opportunity.round_id]);
  if (!round) throw new Error(`Opportunity round not found: ${opportunity.round_id}`);
  const roundMetadata = fromJson(round.metadata, {});
  const evidence = evidenceRows(db, opportunity);
  const validation = opportunity.metadata.validation || {};
  const demand = directDemandSignals(opportunity, evidence);
  const economics = economicsSignals(db, opportunity);
  const competition = Array.isArray(opportunity.metadata.competitionEvidence)
    ? opportunity.metadata.competitionEvidence.map(text).filter(Boolean)
    : [];
  const risks = [
    ...(Array.isArray(opportunity.metadata.risks) ? opportunity.metadata.risks : []),
    ...(Array.isArray(opportunity.metadata.finance?.risks) ? opportunity.metadata.finance.risks : []),
  ].map(text).filter(Boolean);
  const targetedReview = opportunity.metadata.targetedReview || {};
  const comparisonRoundId = targetedReview.comparisonRoundId || opportunity.round_id;
  const comparisonOpportunityId = targetedReview.parentOpportunityId || opportunity.id;
  const comparisonCompletedIds = Array.isArray(targetedReview.comparisonCompletedIds)
    ? targetedReview.comparisonCompletedIds
    : roundMetadata.validationCompletedIds || [];
  const alternatives = all(
    db,
    "SELECT id, title, overall_score, status FROM opportunities WHERE round_id = ? AND id <> ? ORDER BY overall_score DESC",
    [comparisonRoundId, comparisonOpportunityId],
  );
  const kit = selectVentureKit(db, opportunity);

  const criteria = {
    buyer_problem: text(opportunity.buyer).length >= 8 && text(opportunity.problem).length >= 12
      ? result("passed", "The candidate names a specific buyer and problem.", [opportunity.buyer, opportunity.problem])
      : result("failed", "The buyer or important problem is not specific enough.", [], ["specific buyer", "important problem"]),
    direct_demand: demand.supported
      ? result("passed", "At least two direct-demand observations are tied to at least two attributable sources.", demand.directStatements.slice(0, 5))
      : result(
        "failed",
        "The case does not yet contain enough attributable behavioural or transactional demand evidence.",
        demand.directStatements,
        ["two direct-demand observations", "two attributable source URLs"],
      ),
    competition_entry: competition.length >= 3 && text(opportunity.offer_direction).length >= 12
      ? result("passed", "The case includes a meaningful competitor or substitute sample and an entry direction.", competition.slice(0, 5))
      : result("failed", "Competition, substitutes, or the entry position are incomplete.", competition, ["three competitor or substitute observations", "entry position"]),
    offer_value: text(opportunity.offer_direction).length >= 20
      ? result("passed", "A specific offer direction is recorded for the buyer problem.", [opportunity.offer_direction])
      : result("failed", "The offer direction is too vague to evaluate.", [], ["credible offer", "buyer-relevant value"]),
    economics: economics.complete && economics.numericFields.length >= 4 && economics.approved
      ? result("passed", "The finance review contains numeric price, margin, break-even, and cost-cap logic.", Object.values(economics.values))
      : result(
        "failed",
        economics.denied
          ? "The finance review indicates the current case is not viable."
          : economics.complete && economics.numericFields.length >= 4
            ? "The finance review is quantified but still requires decision-grade evidence."
            : "The economics are incomplete or insufficiently quantified.",
        Object.values(economics.values).filter(Boolean),
        economics.complete && economics.numericFields.length >= 4
          ? ["finance approval based on verified economics"]
          : ["numeric price", "full cost stack", "contribution", "break-even", "downside"],
      ),
    distribution: text(opportunity.channel).length >= 3
      && text(validation.priceChannelHypothesis).length >= 20
      && demand.sourceUrls.length >= 2
      ? result("passed", "The proposed channel is connected to a price hypothesis and attributable market evidence.", [opportunity.channel, validation.priceChannelHypothesis])
      : result("failed", "The proposed channel is not yet supported by enough buyer, price, and access evidence.", [opportunity.channel], ["channel evidence", "price-channel hypothesis"]),
    operations: text(opportunity.business_model).length >= 3
      && Number(opportunity.execution_fit_score || 0) >= 60
      && text(opportunity.smallest_validation).length >= 15
      ? result(
        "passed",
        kit.buildableNow
          ? `Pantheon has a matching ${kit.selected.name} kit and the candidate has a viable validation path.`
          : "The candidate has a plausible validation path; a dedicated venture kit is required before production.",
        [opportunity.business_model, opportunity.smallest_validation],
      )
      : result("failed", "Execution requirements or the smallest viable validation path are incomplete.", [], ["operating requirements", "validation path"]),
    experiment: text(validation.smallestTest).length >= 30
      && text(validation.metric).length >= 20
      && text(validation.stopRule).length >= 20
      ? result("passed", "The case contains a bounded test, success metric, and stop rule.", [validation.smallestTest, validation.metric, validation.stopRule])
      : result("failed", "The smallest useful test, success metric, or stop rule is incomplete.", [], ["test", "metric", "revision rule", "kill rule"]),
    alternatives: alternatives.length >= 2 && comparisonCompletedIds.length >= 3
      ? result("passed", "The candidate is compared with at least two alternatives from the same discovery round.", alternatives.slice(0, 5))
      : result("failed", "The case has not completed a fair comparison with at least two alternatives.", alternatives, ["three comparable finalists", "doing-nothing comparison"]),
    risk: risks.length >= 2 && text(economics.values.financialRisk).length >= 12
      ? result("passed", "Material commercial and financial risks are stated.", risks.slice(0, 5))
      : result("failed", "Material risks or downside conditions are incomplete.", risks, ["commercial risks", "financial downside", "decision reversal conditions"]),
  };

  const required = INVESTMENT_CRITERIA.map((item) => item.id);
  const missingEvidence = required
    .filter((id) => !criteria[id]?.passed)
    .flatMap((id) => criteria[id]?.missing || [id]);
  const passedCount = required.filter((id) => criteria[id]?.passed).length;
  const structurallyRejected = economics.denied;
  const recommendation = structurallyRejected
    ? "reject"
    : passedCount === required.length
      ? "advance"
      : criteria.direct_demand.passed
        && economics.complete
        && economics.numericFields.length >= 4
        && !economics.denied
        ? "research_more"
        : "park";
  const confidence = passedCount >= 9 ? "high" : passedCount >= 7 ? "medium" : "low";

  return {
    constitutionVersion: COMMERCIAL_CONSTITUTION_VERSION,
    opportunity,
    round: { ...round, metadata: roundMetadata },
    evidence,
    demand,
    economics,
    kit,
    alternatives,
    criteria,
    passedCount,
    requiredCount: required.length,
    missingEvidence: [...new Set(missingEvidence)],
    recommendation,
    confidence,
  };
}

function persistInvestmentCase(db, opportunityId, options = {}) {
  const assessment = assessInvestmentCase(db, opportunityId);
  const timestamp = now();
  const decisionCore = {
    opportunityId,
    constitutionVersion: assessment.constitutionVersion,
    recommendation: assessment.recommendation,
    criteria: assessment.criteria,
    evidenceIds: assessment.opportunity.evidence_ids,
    finance: assessment.economics.values,
    alternatives: assessment.alternatives,
  };
  const decisionHash = hash(decisionCore);
  const existing = get(db, "SELECT id FROM commercial_decision_cases WHERE decision_hash = ?", [decisionHash]);
  const id = existing?.id || options.id || `investment_case_${randomId()}`;
  const status = assessment.recommendation === "advance" ? "ready_for_review" : "researching";
  run(
    db,
    `INSERT INTO commercial_decision_cases
     (id, opportunity_id, venture_id, round_id, status, stage, recommendation,
      model_route, buyer, problem, offer, evidence_summary, economics,
      channel_strategy, alternatives, criteria, missing_evidence, confidence,
      rationale, next_action, decision_hash, reviewed_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'commercial_investment_review', ?, '{}', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
     ON CONFLICT(decision_hash) DO UPDATE SET
       status = excluded.status,
       recommendation = excluded.recommendation,
       buyer = excluded.buyer,
       problem = excluded.problem,
       offer = excluded.offer,
       evidence_summary = excluded.evidence_summary,
       economics = excluded.economics,
       channel_strategy = excluded.channel_strategy,
       alternatives = excluded.alternatives,
       criteria = excluded.criteria,
       missing_evidence = excluded.missing_evidence,
       confidence = excluded.confidence,
       rationale = excluded.rationale,
       next_action = excluded.next_action,
       updated_at = excluded.updated_at`,
    [
      id,
      opportunityId,
      assessment.opportunity.venture_id,
      assessment.opportunity.round_id,
      status,
      assessment.recommendation,
      assessment.opportunity.buyer,
      assessment.opportunity.problem,
      assessment.opportunity.offer_direction,
      toJson({
        directDemandStatements: assessment.demand.directStatements,
        sourceUrls: assessment.demand.sourceUrls,
        evidenceIds: assessment.opportunity.evidence_ids,
      }),
      toJson(assessment.economics.values),
      toJson({
        channel: assessment.opportunity.channel,
        hypothesis: assessment.opportunity.metadata.validation?.priceChannelHypothesis || "",
      }),
      toJson({
        compared: assessment.alternatives,
        doingNothing: "Retain the A$100 monthly mandate for a stronger opportunity.",
      }),
      toJson(assessment.criteria),
      toJson(assessment.missingEvidence),
      assessment.confidence,
      `${assessment.passedCount} of ${assessment.requiredCount} mandatory commercial criteria passed.`,
      assessment.recommendation === "advance"
        ? "Run the Sol Commercial Investment Review."
        : "Close only the decision-critical evidence gaps or leave the opportunity parked.",
      decisionHash,
      timestamp,
      timestamp,
    ],
  );
  return getInvestmentCase(db, id);
}

function getInvestmentCase(db, id) {
  const row = get(db, "SELECT * FROM commercial_decision_cases WHERE id = ?", [id]);
  if (!row) return null;
  return {
    ...row,
    rationale: operatorReviewSummary(row.rationale),
    model_route: fromJson(row.model_route, {}),
    evidence_summary: fromJson(row.evidence_summary, {}),
    economics: fromJson(row.economics, {}),
    channel_strategy: fromJson(row.channel_strategy, {}),
    alternatives: fromJson(row.alternatives, {}),
    criteria: fromJson(row.criteria, {}),
    missing_evidence: fromJson(row.missing_evidence, []),
  };
}

function listInvestmentCases(db, options = {}) {
  const limit = Math.max(1, Math.min(Number(options.limit || 50), 200));
  return all(
    db,
    "SELECT id FROM commercial_decision_cases ORDER BY updated_at DESC LIMIT ?",
    [limit],
  ).map((row) => getInvestmentCase(db, row.id));
}

function queueCommercialInvestmentReview(db, caseId, options = {}) {
  const investmentCase = getInvestmentCase(db, caseId);
  if (!investmentCase) throw new Error(`Investment case not found: ${caseId}`);
  const opportunity = parseOpportunity(get(db, "SELECT * FROM opportunities WHERE id = ?", [investmentCase.opportunity_id]));
  const round = get(db, "SELECT * FROM opportunity_rounds WHERE id = ?", [investmentCase.round_id]);
  const roundMetadata = fromJson(round?.metadata, {});
  const workflowId = roundMetadata.workflowId;
  if (!workflowId) throw new Error("The investment case has no owning workflow.");
  const request = requestLiveAiWorker(db, workflowId, {
    requestKey: `${caseId}_sol_investment_review`,
    worker: "chief_of_staff",
    taskTitle: `Review the investment case for ${opportunity.title}`,
    approvalTitle: `Run final investment review for ${opportunity.title}`,
    requestedBy: "portfolio_controller",
    estimatedCostCents: Number(options.budgetCents || 300),
    provider: "openai-agents-sdk",
    model: CONFIG.solModel,
    modelLocked: true,
    maxOutputTokens: Number(options.maxOutputTokens || 2200),
    maxTurns: 1,
    maxToolCalls: 0,
    tools: [],
    effects: [],
    highConsequence: true,
    businessContext: {
      subject: opportunity.title,
      buyer: investmentCase.buyer,
      problem: investmentCase.problem,
      offer: investmentCase.offer,
      channel: investmentCase.channel_strategy.channel || opportunity.channel,
      jurisdiction: opportunity.geography || "global",
      evidenceStandard: "Apply the Commercial Constitution. Do not advance a case with failed mandatory gates, invented economics, or unsupported demand.",
    },
    workBrief: {
      objective: "Perform the final CEO-level commercial investment review without overriding deterministic evidence failures.",
      deliverable: "A concise invest, research more, park, reject, or no-investment recommendation with the decisive evidence, contradiction, downside, and next action.",
      constraints: [
        "No product building, publishing, account action, advertising, or customer contact.",
        "Treat doctrine as method, not market proof.",
        "Compare the candidate with the recorded alternatives and doing nothing.",
        "State which evidence would reverse the decision.",
      ],
      acceptanceCriteria: [
        "Recommendation is consistent with mandatory gates.",
        "Net contribution and downside are considered.",
        "Uncertainty is explicit.",
        "The operator can understand the decision without opening another document.",
      ],
    },
    parameters: {
      pantheonCommercial: {
        roundId: investmentCase.round_id,
        step: "commercial_investment_review",
        opportunityId: investmentCase.opportunity_id,
        investmentCaseId: investmentCase.id,
        supervisorOwned: true,
        externalEffectsAllowed: false,
      },
      commercialInvestmentCase: {
        id: investmentCase.id,
        decisionHash: investmentCase.decision_hash,
        deterministicRecommendation: investmentCase.recommendation,
        criteria: investmentCase.criteria,
        missingEvidence: investmentCase.missing_evidence,
        economics: investmentCase.economics,
        alternatives: investmentCase.alternatives,
      },
    },
    reason: "Pantheon is using Sol for one final internal investment review under the recorded monthly operating mandate. No external effect is permitted.",
    expectedMetric: "The final review must agree with mandatory evidence gates or identify a material, attributable contradiction.",
  });
  const mandate = request.approval?.id
    ? approveInternalWorkWithinMandate(db, request.approval.id)
    : { approved: false, reason: "approval_missing" };
  run(
    db,
    `UPDATE commercial_decision_cases
     SET status = 'ready_for_review',
         model_route = ?,
         next_action = ?,
         updated_at = ?
     WHERE id = ?`,
    [
      toJson({ provider: "openai-agents-sdk", model: CONFIG.solModel, taskId: request.task?.id || null }),
      mandate.approved ? "Pantheon is running the final investment review." : "The final investment review needs attention.",
      now(),
      caseId,
    ],
  );
  return { ...request, mandate, investmentCase: getInvestmentCase(db, caseId) };
}

function projectCommercialInvestmentReview(db, task, output) {
  const payload = fromJson(task.payload, {});
  const metadata = payload.liveSpendRequest?.parameters?.pantheonCommercial || {};
  const investmentCase = getInvestmentCase(db, metadata.investmentCaseId);
  if (!investmentCase) throw new Error("The completed investment review is not bound to a stored investment case.");
  if (investmentCase.decision_hash !== payload.liveSpendRequest?.parameters?.commercialInvestmentCase?.decisionHash) {
    throw new Error("The investment case changed after the final review was requested.");
  }
  const modelDecision = String(output.operatorDecision || "changes").toLowerCase();
  const modelSummary = operatorReviewSummary(
    output.summary || output.roleOutput?.moneyMove || "",
  );
  const deterministicAdvance = investmentCase.recommendation === "advance"
    && investmentCase.missing_evidence.length === 0;
  const finalRecommendation = deterministicAdvance && modelDecision === "approve"
    ? "advance"
    : investmentCase.recommendation === "reject" || modelDecision === "deny"
      ? "reject"
      : deterministicAdvance
        ? "research_more"
        : investmentCase.recommendation;
  const status = finalRecommendation === "advance"
    ? "decided"
    : finalRecommendation === "reject"
      ? "rejected"
      : "parked";
  run(
    db,
    `UPDATE commercial_decision_cases
     SET status = ?, recommendation = ?, rationale = ?, next_action = ?,
         reviewed_at = ?, updated_at = ?
     WHERE id = ?`,
    [
      status,
      finalRecommendation,
      modelSummary || investmentCase.rationale,
      finalRecommendation === "advance"
        ? "Prepare the venture-kit implementation goal; no production begins in this goal."
        : "Keep the opportunity parked unless decision-critical new evidence becomes available.",
      now(),
      now(),
      investmentCase.id,
    ],
  );
  run(
    db,
    "UPDATE opportunities SET status = ?, updated_at = ? WHERE id = ?",
    [finalRecommendation === "advance" ? "investment_approved" : "parked", now(), investmentCase.opportunity_id],
  );
  run(
    db,
    `UPDATE commercial_decision_cases
     SET status = CASE WHEN recommendation = 'reject' THEN 'rejected' ELSE 'parked' END,
         next_action = 'Keep this alternative parked unless decision-critical new evidence becomes available.',
         updated_at = ?
     WHERE round_id = ? AND id <> ?`,
    [now(), investmentCase.round_id, investmentCase.id],
  );
  run(
    db,
    `UPDATE opportunities
     SET status = 'parked', updated_at = ?
     WHERE id IN (
       SELECT opportunity_id FROM commercial_decision_cases
       WHERE round_id = ? AND id <> ?
     )`,
    [now(), investmentCase.round_id, investmentCase.id],
  );
  run(
    db,
    `UPDATE opportunity_rounds
     SET status = ?, completed_at = ?, metadata = json_set(metadata,
       '$.investmentCaseId', ?,
       '$.investmentRecommendation', ?,
       '$.outcome', ?),
       updated_at = ?
     WHERE id = ?`,
    [
      finalRecommendation === "advance" ? "completed" : "no_investment",
      now(),
      investmentCase.id,
      finalRecommendation,
      finalRecommendation === "advance"
        ? "One opportunity passed commercial investment review."
        : "No candidate currently qualifies for investment.",
      now(),
      investmentCase.round_id,
    ],
  );
  insertEvent(db, {
    actor: "portfolio_controller",
    type: "commercial.investment_review_completed",
    entityType: "commercial_decision_case",
    entityId: investmentCase.id,
    message: finalRecommendation === "advance"
      ? "Pantheon identified one evidence-supported investment candidate."
      : "Pantheon completed the review without forcing a weak investment.",
    metadata: {
      opportunityId: investmentCase.opportunity_id,
      finalRecommendation,
      deterministicRecommendation: investmentCase.recommendation,
      taskId: task.id,
    },
  });
  return getInvestmentCase(db, investmentCase.id);
}

function createCommercialInvestmentReview(db) {
  return Object.freeze({
    contract: "CommercialInvestmentReview.v1",
    assess: (opportunityId) => assessInvestmentCase(db, opportunityId),
    persist: (opportunityId, options) => persistInvestmentCase(db, opportunityId, options),
    get: (caseId) => getInvestmentCase(db, caseId),
    list: (options) => listInvestmentCases(db, options),
    queueFinalReview: (caseId, options) => queueCommercialInvestmentReview(db, caseId, options),
    projectFinalReview: (task, output) => projectCommercialInvestmentReview(db, task, output),
  });
}

module.exports = {
  assessInvestmentCase,
  createCommercialInvestmentReview,
  getInvestmentCase,
  listInvestmentCases,
  persistInvestmentCase,
  projectCommercialInvestmentReview,
  queueCommercialInvestmentReview,
};
