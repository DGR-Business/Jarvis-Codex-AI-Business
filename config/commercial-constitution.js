const COMMERCIAL_CONSTITUTION_VERSION = "2026.07.27-v1";

const COMMERCIAL_DOMAINS = Object.freeze([
  "customer_value",
  "market_structure",
  "competition",
  "positioning",
  "product_strategy",
  "pricing",
  "distribution",
  "unit_economics",
  "operations",
  "experimentation",
  "finance",
  "risk",
]);

const SOURCE_TIERS = Object.freeze({
  1: "Primary public data, official platform records, receipts, and audited information",
  2: "Peer-reviewed, academic, institutional, and established professional material",
  3: "Methodologically disclosed commercial research and marketplace observations",
  4: "Forums, social discussion, and model inference",
});

const INVESTMENT_CRITERIA = Object.freeze([
  {
    id: "buyer_problem",
    label: "Buyer and problem",
    required: true,
    question: "Is there a defined buyer with an important, specific problem?",
  },
  {
    id: "direct_demand",
    label: "Direct demand",
    required: true,
    question: "Is there attributable purchase, transaction, enquiry, review, waitlist, or comparable behavioural evidence?",
  },
  {
    id: "competition_entry",
    label: "Competition and entry",
    required: true,
    question: "Are direct and indirect alternatives understood, with a credible reason this entrant can win?",
  },
  {
    id: "offer_value",
    label: "Offer and value",
    required: true,
    question: "Is the offer useful, truthful, differentiated, and matched to the buyer's decision?",
  },
  {
    id: "economics",
    label: "Economics",
    required: true,
    question: "Do price, fees, production, acquisition, support, tax assumptions, contribution margin, break-even, and downside reconcile?",
  },
  {
    id: "distribution",
    label: "Distribution",
    required: true,
    question: "Is there evidence that the buyer can be reached through practical channels at acceptable cost and effort?",
  },
  {
    id: "operations",
    label: "Operations",
    required: true,
    question: "Can Pantheon produce, fulfil, support, measure, and maintain the offer reliably?",
  },
  {
    id: "experiment",
    label: "Test and learning",
    required: true,
    question: "Is there a smallest useful test with a metric, deadline, revision rule, kill rule, and named unknowns?",
  },
  {
    id: "alternatives",
    label: "Alternatives",
    required: true,
    question: "Does this beat the other shortlisted opportunities and doing nothing with the same capital and time?",
  },
  {
    id: "risk",
    label: "Risk",
    required: true,
    question: "Are material legal, platform, reputation, data, concentration, and execution risks identified and bounded?",
  },
]);

const DECISION_RULES = Object.freeze({
  advance: "Advance only when every required criterion is supported and no unresolved contradiction can materially reverse the case.",
  researchMore: "Request bounded research only when a decision-critical uncertainty has a realistic and economical path to resolution.",
  park: "Park when the case is currently weak, mistimed, or unsupported but new evidence could change the decision.",
  reject: "Reject when the economics, demand, entry position, operational fit, or risk is structurally unattractive.",
  noInvestment: "Prefer no investment when no candidate beats the alternatives and doing nothing on risk-adjusted expected contribution.",
  evidence: "Search interest, model opinion, or population size alone never proves willingness to pay.",
  truth: "Observed facts, estimates, assumptions, and model inferences must remain visibly distinct.",
  channels: "Select channels from buyer access, traffic quality, fees, ownership, integration burden, and operating economics; never from a platform default.",
  commercialOutcome: "Net cash contribution in AUD is primary. Operator-time-adjusted contribution is secondary and separately labelled.",
});

const MODEL_POLICY = Object.freeze({
  luna: "Extract, normalize, classify, and perform routine low-risk checks.",
  terra: "Conduct ordinary commercial analysis, compare evidence, and identify decision-critical gaps.",
  sol: "Perform final investment review, resolve material contradictions, and assess consequential service-retention decisions.",
});

module.exports = {
  COMMERCIAL_CONSTITUTION_VERSION,
  COMMERCIAL_DOMAINS,
  DECISION_RULES,
  INVESTMENT_CRITERIA,
  MODEL_POLICY,
  SOURCE_TIERS,
};
