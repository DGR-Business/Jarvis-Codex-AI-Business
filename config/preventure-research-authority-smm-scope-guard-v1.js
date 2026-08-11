"use strict";

const readinessSpec = require("./commercial-readiness-social-media-manager-scope-guard-v1");
const {
  COMMERCIAL_CONSTITUTION_VERSION,
} = require("./commercial-constitution");
const {
  AUTHORITY_OUTCOMES,
  calculatePreventureResearchWorstCaseExposureAud,
  createPreventureResearchAuthority,
} = require("../src/runtime/preventure-research-contract");
const { sha256 } = require("../src/runtime/commercial-test-contract");

const APPROVED_READINESS_HASH = "sha256:8c76765b27486c34a4727720cb48023d9d1da184e7e916dee9435f9566572cbe";
const APPROVED_COMMERCIAL_CONSTITUTION_VERSION = "2026.07.27-v1";
const APPROVED_AUTHORITY_HASH = "sha256:0b8dd7380f38a673e683482dd9fdbf0b4c1aff7c1eeb28341ca869927f0fa7ba";
const APPROVED_OUTCOMES = Object.freeze([
  "build",
  "research_more",
  "revise",
  "reject",
  "no_investment",
]);
const APPROVED_MODEL = "gpt-5-mini-2025-08-07";
const APPROVED_MODEL_CARD = Object.freeze({
  modelId: "gpt-5-mini",
  snapshot: APPROVED_MODEL,
  contextWindowTokens: 400000,
  maxInputTokens: 272000,
  maxOutputTokens: 128000,
  checkedAt: "2026-08-02T00:00:00Z",
  sourceUrl: "https://developers.openai.com/api/docs/models/gpt-5-mini",
});
const APPROVED_REQUEST_POLICY = Object.freeze({
  service_tier: "default",
  background: false,
  store: false,
  tools: [{
    type: "web_search",
    external_web_access: true,
    return_token_budget: "default",
    search_context_size: "medium",
  }],
  tool_choice: "required",
  include: ["web_search_call.action.sources"],
  parallel_tool_calls: false,
  reasoning: { effort: "low" },
  text: {
    format: {
      type: "json_schema",
      name: "preventure_research_result",
      strict: true,
      schemaBinding: "server_owned_assignment_schema",
    },
  },
});
const APPROVED_REQUEST_POLICY_SOURCE_URLS = Object.freeze([
  "https://developers.openai.com/api/docs/guides/structured-outputs",
  "https://developers.openai.com/api/docs/guides/tools-web-search#live-internet-access",
  "https://developers.openai.com/api/docs/guides/tools-web-search#output-and-citations",
  "https://developers.openai.com/api/docs/guides/tools-web-search#run-longer-web-research",
  "https://developers.openai.com/api/docs/guides/tools-web-search#search-context-size",
  "https://developers.openai.com/api/reference/resources/responses/methods/create",
]);
const APPROVED_PRICING_POLICY = Object.freeze({
  model: APPROVED_MODEL,
  pricingModel: "gpt-5-mini",
  pricingTier: "standard",
  inputUsdPerMillionTokens: 0.25,
  outputUsdPerMillionTokens: 2,
  webSearchUsdPerThousandCalls: 10,
  audPerUsdCeiling: 2,
  checkedAt: "2026-08-02T00:00:00Z",
  sourceUrls: [
    "https://developers.openai.com/api/docs/models/gpt-5-mini",
    "https://developers.openai.com/api/docs/pricing",
  ],
  exactBillingPending: true,
});
const APPROVED_ASSIGNMENT_LIMITS = Object.freeze({
  maxInputTokens: 272000,
  maxOutputTokens: 12000,
  maxToolCalls: 2,
  maximumModelPasses: 3,
});
const APPROVED_ASSIGNMENT_WORST_CASE_EXPOSURE = calculatePreventureResearchWorstCaseExposureAud(
  APPROVED_PRICING_POLICY,
  APPROVED_ASSIGNMENT_LIMITS,
);

if (sha256(readinessSpec) !== APPROVED_READINESS_HASH) {
  throw new Error("The approved readiness record changed; create a new authority version and obtain new approval.");
}
if (COMMERCIAL_CONSTITUTION_VERSION !== APPROVED_COMMERCIAL_CONSTITUTION_VERSION) {
  throw new Error("The Commercial Constitution changed; create a new authority version and obtain new approval.");
}
if (JSON.stringify(AUTHORITY_OUTCOMES) !== JSON.stringify(APPROVED_OUTCOMES)) {
  throw new Error("The diligence outcome policy changed; create a new authority version and obtain new approval.");
}

const authority = createPreventureResearchAuthority({
  id: "preventure_smm_scope_guard_diligence_2026_08_02",
  version: "2026.08.02-v1",
  approvedAt: "2026-08-02T11:29:40.4051170+10:00",
  expiresAt: "2026-08-09T11:29:40.4051170+10:00",
  commercialConstitutionVersion: APPROVED_COMMERCIAL_CONSTITUTION_VERSION,
  opportunity: {
    id: "opportunity_smm_client_approval_scope_guard_kit",
    name: "Social Media Manager Client Approval & Scope Guard Kit",
    buyer: "Solo or freelance social-media managers handling at least two retained clients.",
    problem: "Client approvals, scope changes, revisions, delivery acceptance, and evidence become fragmented across messages and tools, increasing delay, unpaid work, and dispute risk.",
    offer: "A low-touch, no-subscription operational-control kit for approvals, revisions, scope impacts, delivery acceptance, and retained evidence without legal-contract or guaranteed-outcome positioning.",
    distinctFromStoppedWork: true,
    stoppedWorkNotReopened: "Client Control and Profitability Workbook",
  },
  preparationOnly: true,
  internalAiSpendCapAudCents: 200,
  externalCommercialSpendCapAudCents: 0,
  totalWorstCaseExposureAudCents: APPROVED_ASSIGNMENT_WORST_CASE_EXPOSURE.amountAudCents * 3,
  comparatorScope: {
    minimumOffers: 10,
    maximumOffers: 15,
    directOrNearDirectMinimum: 4,
    adjacentMinimum: 3,
    indirectMinimum: 2,
    minimumPerApprovedFormat: 2,
    acceptedOffersPerSellerMaximum: 2,
    reviewObservationMaximum: 30,
    etsyEvidenceRequired: true,
    gumroadEvidenceRequired: true,
    lawfulAlternativeDiscoveryOnly: true,
  },
  formats: [
    "notion_client_portal",
    "scripts_evidence_log_micro_kit",
    "spreadsheet_documents_no_login",
  ],
  priceCasesAudCents: [1900, 2900, 3900],
  channelCases: [
    "etsy",
    "evidence_supported_lawful_alternative",
    "gumroad",
    "retain_cash",
  ],
  allowedMethods: [
    "deterministic_local_synthesis",
    "openai_responses_web_search",
  ],
  provider: {
    id: "openai-responses-web-search",
    model: APPROVED_MODEL,
    modelCard: APPROVED_MODEL_CARD,
    endpointPolicy: "official_openai_responses_only",
    tool: "web_search",
    externalWebAccess: true,
    responseStorage: false,
    providerTraceContent: false,
    localEvidenceStored: true,
    requestPolicy: APPROVED_REQUEST_POLICY,
    requestPolicySourceUrls: APPROVED_REQUEST_POLICY_SOURCE_URLS,
    pricingPolicy: APPROVED_PRICING_POLICY,
    pricingPolicyHash: sha256(APPROVED_PRICING_POLICY),
  },
  sourcePolicy: {
    tiers: [1, 2, 3, 4],
    classes: [
      "established_professional_or_industry_material",
      "official_platform_policy_or_pricing",
      "official_public_reference_data",
      "public_marketplace_listing_or_result_observation",
      "public_practitioner_discussion",
      "retained_pantheon_evidence",
    ],
    access: "public_lawful_read_only",
    disallowedAccess: [
      "authenticated_account",
      "captcha",
      "paywall",
      "private_endpoint",
      "rate_limit_bypass",
      "robots_control_bypass",
      "technical_access_control_bypass",
    ],
    factsRemainDistinct: [
      "assumption",
      "estimate",
      "model_inference",
      "observed_fact",
      "owner_attestation",
      "owner_preference",
      "proven_pantheon_learning",
      "unknown",
    ],
    listingVisibilityDoesNotProve: [
      "conversion",
      "demand",
      "profitability",
      "realised_price",
      "sales",
      "willingness_to_pay",
    ],
    contraryEvidenceRequired: true,
  },
  researchQuestions: [
    {
      id: "buyer_problem_and_direct_demand",
      question: "Do exact-buyer pain, operational consequences, current workarounds, spending triggers, and purchaser-attributable behaviour support this specific operational-control problem and offer direction?",
    },
    {
      id: "competition_entry_and_offer_value",
      question: "Across 10 to 15 relevant offers, what is crowded, commoditised, missing, contradicted, or poorly served, and is no subscription or new client login a buyer-relevant wedge?",
    },
    {
      id: "format_usability_and_operations",
      question: "Which of the three approved low-touch formats best balances buyer value, setup effort, accessibility, editability, evidence retention, support, maintenance, originality, and low routine owner work?",
    },
    {
      id: "price_channel_economics_and_cash",
      question: "At A$19, A$29, and A$39, how do Etsy, Gumroad, any evidence-supported lawful alternative, and retaining cash compare on buyer access, attribution, fees, payout, settlement, full-cost economics, owner burden, and implementation risk?",
    },
    {
      id: "experiment_and_risk",
      question: "Does current evidence support a later exact smallest test design and bound originality, AI disclosure, seller accountability, platform, claim, data, attribution, and settlement risks without inventing reach or duration rules?",
    },
  ],
  ownerInputs: [
    {
      id: "bounded_internal_research_budget",
      kind: "owner_preference",
      assertion: "Daniel approved no more than A$2.00 internal AI research and A$0 external commercial spend for this exact diligence round.",
      state: "confirmed",
      confirmedAt: "2026-08-02T11:29:40.4051170+10:00",
      source: "owner_instruction",
      secretsStored: false,
    },
    {
      id: "etsy_seller_account_exists",
      kind: "owner_attestation",
      assertion: "Daniel reported that he already has an Etsy business/seller account.",
      assertionScope: ["seller_account_exists"],
      verificationState: "owner_reported_unverified",
      evidenceAttached: false,
      confirmedAt: "2026-08-02T11:29:40.4051170+10:00",
      source: "owner_instruction",
      secretsStored: false,
    },
    {
      id: "etsy_owner_only_steps_if_selected",
      kind: "owner_preference",
      assertion: "Daniel will complete unavoidable owner-only Etsy identity, financial, security, legal, accountable-owner, original-design, and required AI-disclosure steps if Etsy is later selected.",
      state: "approved_in_principle_not_performed",
      confirmedAt: "2026-08-02T11:29:40.4051170+10:00",
      source: "owner_instruction",
      secretsStored: false,
    },
    {
      id: "better_lawful_channel_allowed",
      kind: "owner_preference",
      assertion: "Pantheon may recommend a better evidence-supported lawful channel instead of Etsy or Gumroad.",
      state: "confirmed",
      confirmedAt: "2026-08-02T11:29:40.4051170+10:00",
      source: "owner_instruction",
      secretsStored: false,
    },
  ],
  assignments: [
    {
      id: "comparator_and_buyer_evidence",
      version: "2026.08.02-v1",
      title: "Comparator and buyer-evidence ledger",
      question: "Build a consistently sampled ledger of 10 to 15 direct, adjacent, and indirect offers, plus attributable buyer-language and contrary evidence, without converting listings, ratings, reviews, carts, or visibility into assumed sales.",
      provider: "openai-responses-web-search",
      model: APPROVED_MODEL,
      maxCostAudCents: 50,
      maxAttempts: 1,
      maxToolCalls: APPROVED_ASSIGNMENT_LIMITS.maxToolCalls,
      maximumModelPasses: APPROVED_ASSIGNMENT_LIMITS.maximumModelPasses,
      maxInputTokens: APPROVED_ASSIGNMENT_LIMITS.maxInputTokens,
      localPromptPreflightMaxInputTokens: 30000,
      maxOutputTokens: APPROVED_ASSIGNMENT_LIMITS.maxOutputTokens,
      maxTurns: 1,
      deadlineMs: 180000,
      worstCaseExposure: APPROVED_ASSIGNMENT_WORST_CASE_EXPOSURE,
      requiredSourceClasses: [
        "public_marketplace_listing_or_result_observation",
        "public_practitioner_discussion",
        "established_professional_or_industry_material",
      ],
      requiredOutputSections: [
        "comparators",
        "buyerEvidence",
        "contraryEvidence",
        "sources",
        "limitations",
      ],
    },
    {
      id: "format_channel_and_economics",
      version: "2026.08.02-v1",
      title: "Format, channel, and economics comparison",
      question: "Compare all three formats and the A$19, A$29, and A$39 cases across Etsy, Gumroad, any evidence-supported lawful alternative, and retaining cash using current official policies, fees, payout rules, attribution capabilities, operating burden, and visibly incomplete cost assumptions.",
      provider: "openai-responses-web-search",
      model: APPROVED_MODEL,
      maxCostAudCents: 50,
      maxAttempts: 1,
      maxToolCalls: APPROVED_ASSIGNMENT_LIMITS.maxToolCalls,
      maximumModelPasses: APPROVED_ASSIGNMENT_LIMITS.maximumModelPasses,
      maxInputTokens: APPROVED_ASSIGNMENT_LIMITS.maxInputTokens,
      localPromptPreflightMaxInputTokens: 30000,
      maxOutputTokens: APPROVED_ASSIGNMENT_LIMITS.maxOutputTokens,
      maxTurns: 1,
      deadlineMs: 180000,
      worstCaseExposure: APPROVED_ASSIGNMENT_WORST_CASE_EXPOSURE,
      requiredSourceClasses: [
        "official_platform_policy_or_pricing",
        "official_public_reference_data",
        "public_marketplace_listing_or_result_observation",
      ],
      requiredOutputSections: [
        "formatCases",
        "channelCases",
        "economicsCases",
        "contraryEvidence",
        "sources",
        "limitations",
      ],
    },
    {
      id: "independent_readiness_review",
      version: "2026.08.02-v1",
      title: "Independent readiness and retain-cash review",
      question: "Challenge the combined buyer, problem, offer, format, price, channel, economics, distribution, operations, experiment, alternatives, attribution, cash, and risk case; recommend exactly build, research_more, revise, reject, or no_investment while treating exact-offer willingness to pay as unproved by read-only research.",
      provider: "openai-responses-web-search",
      model: APPROVED_MODEL,
      maxCostAudCents: 50,
      maxAttempts: 1,
      maxToolCalls: APPROVED_ASSIGNMENT_LIMITS.maxToolCalls,
      maximumModelPasses: APPROVED_ASSIGNMENT_LIMITS.maximumModelPasses,
      maxInputTokens: APPROVED_ASSIGNMENT_LIMITS.maxInputTokens,
      localPromptPreflightMaxInputTokens: 30000,
      maxOutputTokens: APPROVED_ASSIGNMENT_LIMITS.maxOutputTokens,
      maxTurns: 1,
      deadlineMs: 180000,
      worstCaseExposure: APPROVED_ASSIGNMENT_WORST_CASE_EXPOSURE,
      requiredSourceClasses: [
        "official_platform_policy_or_pricing",
        "public_marketplace_listing_or_result_observation",
        "retained_pantheon_evidence",
      ],
      requiredOutputSections: [
        "readinessGates",
        "materialContradictions",
        "whatWouldReverseDecision",
        "recommendation",
        "sources",
        "limitations",
      ],
    },
  ],
  allowedOutcomes: APPROVED_OUTCOMES,
  prohibitedActions: [
    "account_creation_or_change",
    "advertising",
    "authenticated_account_inspection",
    "buyer_contact",
    "call",
    "captcha_bypass",
    "checkout_or_payment",
    "email",
    "external_commercial_spend",
    "external_file_upload",
    "external_write_or_webhook",
    "fulfilment",
    "kyc",
    "legal_acceptance",
    "message",
    "mfa",
    "money_movement",
    "oauth",
    "product_build",
    "publication",
    "purchase",
    "refund_or_dispute",
    "social_interaction",
  ],
  completionRules: {
    oneRoundOnly: true,
    stopOnUnknownProviderOutcomeOrCost: true,
    noAutomaticRetryAfterDispatch: true,
    decisionMustCompareRetainingCash: true,
    buildMeansRecommendationOnly: true,
    separateBuildAuthorityRequired: true,
    separateCommercialTestAuthorityRequired: true,
    separateExternalActionAuthorityRequired: true,
  },
}, readinessSpec);

if (authority.authorityHash !== APPROVED_AUTHORITY_HASH) {
  throw new Error(`The approved authority content changed (${authority.authorityHash}); create a new version and obtain new approval.`);
}

module.exports = authority;
