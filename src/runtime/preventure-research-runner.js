"use strict";

const { sha256 } = require("./commercial-test-contract");
const {
  OFFICIAL_OPENAI_RESPONSES_URL,
} = require("../adapters/openai-egress-policy");
const {
  calculatePreventureResearchWorstCaseExposureAud,
} = require("./preventure-research-contract");
const {
  assertPreventureResearchDispatchAuthority,
} = require("./preventure-research-authority");
const {
  createPreventureResearchAssignmentPlan,
} = require("./preventure-research-materializer");
const {
  executionCompletion,
  latestCostExposure,
} = require("./preventure-research-readiness");
const {
  canonicalPublicResearchUrl,
  derivePreventureResearchPublicSourceBinding,
  derivePreventureResearchSourceIdentity,
} = require("./preventure-research-source-identity");
const {
  PREVENTURE_OFFICIAL_RESPONSES_ENDPOINT_HASH,
  validatePreventureResearchTerminalStop,
} = require("./preventure-research-terminal-stop");

const PREVENTURE_RESEARCH_EXECUTION_DESCRIPTOR_SCHEMA =
  "pantheon.preventure-research-execution-descriptor.v1";
const PREVENTURE_RESEARCH_REQUEST_SCHEMA =
  "pantheon.preventure-research-request.v1";
const EXACT_TRANSPORT_KIND = "exact_openai_responses_web_search";
const EXACT_CLAIM_KIND = "preventure_exact_claims_v1";
const EXACT_OUTPUT_STORE_KIND = "immutable_preventure_provider_output_v1";
const EXACT_LOCAL_PARSER_KIND = "deterministic_local";
const PRIOR_EVIDENCE_CONTEXT_SCHEMA = "pantheon.preventure-research-prior-evidence.v1";
const READINESS_GATE_IDS = Object.freeze([
  "alternatives",
  "attribution_cash",
  "buyer_problem",
  "competition_entry",
  "direct_demand",
  "distribution",
  "experiment",
  "format_usability",
  "offer_value",
  "operations",
  "provisional_economics",
  "risk",
]);
const PUBLIC_GROUNDING_TYPES = new Set([
  "web_search_action_source",
  "url_citation",
]);

function runnerError(code, message, options = {}) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = options.statusCode || 409;
  error.providerDispatchStarted = options.providerDispatchStarted === true;
  error.providerOutcomeKnown = options.providerOutcomeKnown === true;
  error.claimChanged = options.claimChanged === true;
  return error;
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (isObject(value)) {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, canonical(value[key])]),
    );
  }
  return value ?? null;
}

function sameCanonical(left, right) {
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
}

function boundedText(value, label, maximum, options = {}) {
  if (value === null && options.nullable === true) return null;
  const result = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!result || result.length > maximum) {
    throw runnerError(
      "preventure_research_text_invalid",
      `${label} must contain between 1 and ${maximum} characters.`,
      { providerDispatchStarted: options.providerDispatchStarted === true,
        providerOutcomeKnown: options.providerOutcomeKnown === true },
    );
  }
  return result;
}

function boundedTextList(value, label, maximumItems, maximumLength, options = {}) {
  if (!Array.isArray(value) || value.length > maximumItems) {
    throw runnerError(
      "preventure_research_text_list_invalid",
      `${label} must contain at most ${maximumItems} item(s).`,
      { providerDispatchStarted: options.providerDispatchStarted === true,
        providerOutcomeKnown: options.providerOutcomeKnown === true },
    );
  }
  return value.map((item, index) => boundedText(
    item,
    `${label}[${index}]`,
    maximumLength,
    options,
  ));
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

function cleanTimestamp(value, label) {
  const result = value instanceof Date ? value.toISOString() : String(value || "").trim();
  if (!result || !Number.isFinite(Date.parse(result))) {
    throw runnerError("preventure_research_time_invalid", `${label} is not a valid timestamp.`, {
      statusCode: 400,
    });
  }
  return result;
}

function runtimeNow(clock) {
  if (typeof clock !== "function") {
    throw runnerError(
      "preventure_research_time_invalid",
      "The exact shared runtime clock is unavailable.",
      { statusCode: 500 },
    );
  }
  let value;
  try {
    value = clock();
  } catch {
    throw runnerError(
      "preventure_research_time_invalid",
      "The exact shared runtime clock is unavailable.",
      { statusCode: 500 },
    );
  }
  return cleanTimestamp(value, "Runtime clock");
}

function stableCostKey(assignmentHash) {
  if (!/^sha256:[a-f0-9]{64}$/.test(String(assignmentHash || ""))) {
    throw runnerError(
      "preventure_research_assignment_hash_invalid",
      "The exact assignment hash is invalid.",
      { statusCode: 400 },
    );
  }
  return `preventure_cost_${assignmentHash.slice("sha256:".length, "sha256:".length + 32)}`;
}

function pricedWorstCaseCost(authority, assignment) {
  const pricing = authority.provider?.pricingPolicy;
  if (
    !isObject(pricing)
    || authority.provider.pricingPolicyHash !== sha256(pricing)
    || pricing.model !== assignment.model
  ) {
    throw runnerError(
      "preventure_research_pricing_policy_invalid",
      "The exact reviewed provider pricing policy is unavailable or changed.",
    );
  }
  let priced;
  try {
    priced = calculatePreventureResearchWorstCaseExposureAud(pricing, {
      maxInputTokens: assignment.maxInputTokens,
      maxOutputTokens: assignment.maxOutputTokens,
      maxToolCalls: assignment.maxToolCalls,
      maximumModelPasses: assignment.maximumModelPasses,
    });
  } catch (error) {
    throw runnerError(
      "preventure_research_pricing_policy_invalid",
      `The exact reviewed provider pricing policy cannot price this assignment: ${String(error?.message || error)}.`,
    );
  }
  if (
    !isObject(assignment.worstCaseExposure)
    || sha256(assignment.worstCaseExposure) !== sha256(priced)
    || priced.amountAudCents > assignment.maxCostAudCents
  ) {
    throw runnerError(
      "preventure_research_worst_case_unfunded",
      "The exact multi-pass input, output, and web-search exposure does not fit the assignment's A$0.50 cap.",
    );
  }
  return deepFreeze({
    ...priced,
    pricingPolicyHash: authority.provider.pricingPolicyHash,
  });
}

function publicSourceInstruction(authority) {
  return [
    "Use only public, lawfully accessible read-only pages or documented public endpoints.",
    `Allowed source classes: ${authority.sourcePolicy.classes.join(", ")}.`,
    `Disallowed access: ${authority.sourcePolicy.disallowedAccess.join(", ")}.`,
    "Do not sign in, inspect an account, bypass CAPTCHA/paywalls/robots/rate limits/access controls, contact anyone, submit a form, upload a file, create or change an account, purchase, publish, advertise, or perform any external write.",
    "Responses web-search citations and action sources are partial grounding metadata, not retained page content: set captureStatus to partial, set source content to null, and classify conclusions drawn from them as model_inference rather than observed_fact.",
    "For public sources, both retained Pantheon hash fields must be null. Only a retained_pantheon_evidence source may select exactly one hash, and only from the server-supplied prior-evidence pack; never invent or transform a ledger hash.",
    "Treat listing visibility, ratings, review counts, carts, prices, and result counts only as displayed observations; they do not prove sales, demand, conversion, realised price, willingness to pay, or profitability.",
    "Keep observed facts, estimates, assumptions, model inference, contrary evidence, and unknowns distinct. Preserve material contradictions.",
  ].join(" ");
}

function serverOwnedPrompt(authority, template, priorEvidenceContext) {
  return {
    role: "commercial_diligence_researcher",
    objective: template.question,
    opportunity: {
      name: authority.opportunity.name,
      buyerHypothesis: authority.opportunity.buyer,
      problemHypothesis: authority.opportunity.problem,
      offerHypothesis: authority.opportunity.offer,
    },
    fixedComparisonScope: {
      comparatorMinimum: authority.comparatorScope.minimumOffers,
      comparatorMaximum: authority.comparatorScope.maximumOffers,
      formats: authority.formats,
      priceCasesAudCents: authority.priceCasesAudCents,
      channelsAndCashAlternative: authority.channelCases,
    },
    retainedPriorEvidence: priorEvidenceContext,
    researchBoundary: publicSourceInstruction(authority),
    requiredSourceClasses: template.requiredSourceClasses,
    requiredOutputSections: template.requiredOutputSections,
    requiredSearchPlan: [
      {
        call: 1,
        purpose: "marketplace_and_supporting_coverage",
        requiredQueryTerms: ["etsy", "gumroad"],
      },
      {
        call: 2,
        purpose: "contrary_and_missing_evidence_coverage",
        requiredQueryTerms: ["contrary"],
      },
    ],
    outputRules: [
      "Return structured JSON only.",
      "Every factual claim must point to retained source IDs and state its truth class, polarity, question ID, limitation, and confidence.",
      "Include an explicit disconfirming path and contrary evidence for the assignment question.",
      "Use exactly two completed web search actions. The first search query must explicitly include Etsy and Gumroad. The second must explicitly include the word contrary and seek disconfirming or missing evidence.",
      "Use unknown rather than zero or an invented value when evidence is absent.",
      "A build outcome can only recommend a separate proposal; it grants no build, commercial-test, or external-action authority.",
    ],
  };
}

function assignmentCriterionIds(authority, assignmentId) {
  if (assignmentId === "format_channel_and_economics") {
    return [
      ...authority.formats.map((id) => `format_case:${id}`),
      ...authority.channelCases.map((id) => `channel_case:${id}`),
      ...authority.channelCases.flatMap((channelId) => (
        authority.priceCasesAudCents.map((price) => `economics_case:${channelId}:${price}`)
      )),
    ];
  }
  if (assignmentId === "independent_readiness_review") {
    return READINESS_GATE_IDS.map((id) => `readiness_gate:${id}`);
  }
  return [];
}

function priorAssignmentIds(authority, assignmentId) {
  const index = authority.assignments.findIndex((item) => item.id === assignmentId);
  if (index < 0) {
    throw runnerError(
      "preventure_research_assignment_unknown",
      "The assignment is not part of the exact authority.",
    );
  }
  return authority.assignments.slice(0, index).map((item) => item.id);
}

function validatePriorEvidenceContext(authority, assignment, input) {
  const expectedIds = priorAssignmentIds(authority, assignment.id);
  const emptyBody = {
    schema: PRIOR_EVIDENCE_CONTEXT_SCHEMA,
    authorityHash: authority.authorityHash,
    assignmentId: assignment.id,
    completedAssignments: [],
    sourceSnapshots: [],
    evidenceRecords: [],
    requiredCaseSummaries: [],
    materialEvidenceSummary: {
      count: 0,
      setHash: sha256([]),
      fullGroupCount: 0,
      fullGroupSetHash: sha256([]),
      groups: [],
      omittedGroupCount: 0,
      omittedGroupSetHash: sha256([]),
      byQuestion: {},
      byPolarity: {},
      byTruthClass: {},
    },
    compaction: {
      algorithm: "pantheon_prior_evidence_compaction_v1",
      fullSourceSnapshotCount: 0,
      fullSourceSnapshotSetHash: sha256([]),
      selectedSourceSnapshotCount: 0,
      selectedSourceSnapshotSetHash: sha256([]),
      omittedSourceSnapshotCount: 0,
      omittedSourceSnapshotSetHash: sha256([]),
      fullEvidenceRecordCount: 0,
      fullEvidenceRecordSetHash: sha256([]),
      selectedEvidenceRecordCount: 0,
      selectedEvidenceRecordSetHash: sha256([]),
      omittedEvidenceRecordCount: 0,
      omittedEvidenceRecordSetHash: sha256([]),
      fullMaterialGroupCount: 0,
      fullMaterialGroupRepresentativeSetHash: sha256([]),
      selectedMaterialGroupRepresentativeCount: 0,
      selectedMaterialGroupRepresentativeSetHash: sha256([]),
      omittedMaterialGroupRepresentativeCount: 0,
      omittedMaterialGroupRepresentativeSetHash: sha256([]),
      fullRequiredCaseSummaryCount: 0,
      fullRequiredCaseSummarySetHash: sha256([]),
      selectedRequiredCaseSummaryCount: 0,
      selectedRequiredCaseSummarySetHash: sha256([]),
      omittedRequiredCaseSummaryCount: 0,
      omittedRequiredCaseSummarySetHash: sha256([]),
    },
    terminalReceiptHashes: [],
    costReceiptHashes: [],
  };
  const context = input || (expectedIds.length === 0
    ? { ...emptyBody, contextHash: sha256(emptyBody) }
    : null);
  if (!isObject(context)) {
    throw runnerError(
      "preventure_research_prior_evidence_required",
      "A later research assignment requires the exact retained results from every earlier assignment.",
    );
  }
  const { contextHash, ...body } = context;
  const materialGroups = Array.isArray(context.materialEvidenceSummary?.groups)
    ? context.materialEvidenceSummary.groups
    : [];
  const materialGroupKeys = materialGroups.map((group) => JSON.stringify(canonical({
    questionId: group?.questionId ?? null,
    criterionId: group?.criterionId ?? null,
    polarity: group?.polarity ?? null,
    truthClass: group?.truthClass ?? null,
  })));
  const materialGroupsValid = materialGroups.every((group) => (
    isObject(group)
    && sameCanonical(Object.keys(group).sort(), [
      "questionId", "criterionId", "polarity", "truthClass", "count", "memberSetHash",
      "representativeEvidenceHash", "groupHash",
    ].sort())
    && Number.isSafeInteger(group.count)
    && group.count > 0
    && /^sha256:[a-f0-9]{64}$/.test(String(group.memberSetHash || ""))
    && /^sha256:[a-f0-9]{64}$/.test(String(group.representativeEvidenceHash || ""))
    && group.groupHash === sha256({
      questionId: group.questionId ?? null,
      criterionId: group.criterionId ?? null,
      polarity: group.polarity ?? null,
      truthClass: group.truthClass ?? null,
      count: group.count,
      memberSetHash: group.memberSetHash,
      representativeEvidenceHash: group.representativeEvidenceHash,
    })
  ))
    && new Set(materialGroupKeys).size === materialGroupKeys.length
    && materialGroups.reduce((sum, group) => sum + Number(group.count || 0), 0)
      <= Number(context.materialEvidenceSummary?.count || 0);
  const fullMaterialGroupCount = Number(context.materialEvidenceSummary?.fullGroupCount);
  const omittedMaterialGroupCount = Number(context.materialEvidenceSummary?.omittedGroupCount);
  const materialRepresentativeHashes = materialGroups
    .map((group) => group.representativeEvidenceHash)
    .sort();
  const selectedEvidenceHashes = new Set(
    (context.evidenceRecords || []).map((item) => item.evidenceHash),
  );
  const selectedRequiredCaseSummaryHashes = (context.requiredCaseSummaries || [])
    .map((item) => sha256(item))
    .sort();
  const selectedMaterialRepresentativeHashes = materialRepresentativeHashes
    .filter((hash) => selectedEvidenceHashes.has(hash));
  const omittedMaterialRepresentativeCount = fullMaterialGroupCount
    - selectedMaterialRepresentativeHashes.length;
  if (
    context.schema !== PRIOR_EVIDENCE_CONTEXT_SCHEMA
    || context.authorityHash !== authority.authorityHash
    || context.assignmentId !== assignment.id
    || contextHash !== sha256(body)
    || !Array.isArray(context.completedAssignments)
    || !Array.isArray(context.sourceSnapshots)
    || !Array.isArray(context.evidenceRecords)
    || !Array.isArray(context.requiredCaseSummaries)
    || !isObject(context.materialEvidenceSummary)
    || !Array.isArray(context.materialEvidenceSummary.groups)
    || !materialGroupsValid
    || !Number.isSafeInteger(fullMaterialGroupCount)
    || !Number.isSafeInteger(omittedMaterialGroupCount)
    || omittedMaterialGroupCount < 0
    || fullMaterialGroupCount !== materialGroups.length + omittedMaterialGroupCount
    || !/^sha256:[a-f0-9]{64}$/.test(String(
      context.materialEvidenceSummary.fullGroupSetHash || "",
    ))
    || !/^sha256:[a-f0-9]{64}$/.test(String(
      context.materialEvidenceSummary.omittedGroupSetHash || "",
    ))
    || !isObject(context.compaction)
    || context.compaction.algorithm !== "pantheon_prior_evidence_compaction_v1"
    || context.compaction.selectedSourceSnapshotCount !== context.sourceSnapshots.length
    || context.compaction.selectedEvidenceRecordCount !== context.evidenceRecords.length
    || context.compaction.fullSourceSnapshotCount
      !== context.compaction.selectedSourceSnapshotCount
        + context.compaction.omittedSourceSnapshotCount
    || context.compaction.fullEvidenceRecordCount
      !== context.compaction.selectedEvidenceRecordCount
        + context.compaction.omittedEvidenceRecordCount
    || context.compaction.fullMaterialGroupCount !== fullMaterialGroupCount
    || !/^sha256:[a-f0-9]{64}$/.test(String(
      context.compaction.fullMaterialGroupRepresentativeSetHash || "",
    ))
    || context.compaction.selectedMaterialGroupRepresentativeCount
      !== selectedMaterialRepresentativeHashes.length
    || context.compaction.selectedMaterialGroupRepresentativeSetHash
      !== sha256(selectedMaterialRepresentativeHashes)
    || context.compaction.omittedMaterialGroupRepresentativeCount
      !== omittedMaterialRepresentativeCount
    || !/^sha256:[a-f0-9]{64}$/.test(String(
      context.compaction.omittedMaterialGroupRepresentativeSetHash || "",
    ))
    || context.compaction.fullMaterialGroupCount
      !== context.compaction.selectedMaterialGroupRepresentativeCount
        + context.compaction.omittedMaterialGroupRepresentativeCount
    || context.compaction.selectedRequiredCaseSummaryCount
      !== context.requiredCaseSummaries.length
    || context.compaction.selectedRequiredCaseSummarySetHash
      !== sha256(selectedRequiredCaseSummaryHashes)
    || context.compaction.fullRequiredCaseSummaryCount
      !== context.compaction.selectedRequiredCaseSummaryCount
        + context.compaction.omittedRequiredCaseSummaryCount
    || !/^sha256:[a-f0-9]{64}$/.test(String(
      context.compaction.fullRequiredCaseSummarySetHash || "",
    ))
    || !/^sha256:[a-f0-9]{64}$/.test(String(
      context.compaction.omittedRequiredCaseSummarySetHash || "",
    ))
    || context.compaction.selectedSourceSnapshotSetHash !== sha256(
      context.sourceSnapshots.map((item) => item.snapshotHash).sort(),
    )
    || context.compaction.selectedEvidenceRecordSetHash !== sha256(
      context.evidenceRecords.map((item) => item.evidenceHash).sort(),
    )
    || !/^sha256:[a-f0-9]{64}$/.test(String(context.compaction.fullSourceSnapshotSetHash || ""))
    || !/^sha256:[a-f0-9]{64}$/.test(String(context.compaction.omittedSourceSnapshotSetHash || ""))
    || !/^sha256:[a-f0-9]{64}$/.test(String(context.compaction.fullEvidenceRecordSetHash || ""))
    || !/^sha256:[a-f0-9]{64}$/.test(String(context.compaction.omittedEvidenceRecordSetHash || ""))
    || !/^sha256:[a-f0-9]{64}$/.test(String(context.materialEvidenceSummary.setHash || ""))
    || !Array.isArray(context.terminalReceiptHashes)
    || !Array.isArray(context.costReceiptHashes)
    || !sameCanonical(
      context.completedAssignments.map((item) => item.id),
      expectedIds,
    )
    || context.sourceSnapshots.length > expectedIds.length * 30
    || context.evidenceRecords.length > expectedIds.length * 60
  ) {
    throw runnerError(
      "preventure_research_prior_evidence_changed",
      "The retained prior-evidence pack is missing, stale, oversized, or outside the approved assignment order.",
    );
  }
  return deepFreeze(canonical(context));
}

function nullableSchema(schema) {
  return { anyOf: [{ type: "null" }, schema] };
}

function stringArraySchema(options = {}) {
  return {
    type: "array",
    minItems: options.minItems ?? 0,
    maxItems: options.maxItems ?? 20,
    items: { type: "string" },
  };
}

function formatCaseSchema(authority) {
  return {
    type: "object",
    additionalProperties: false,
    required: ["id", "disposition"],
    properties: {
      id: { type: "string", enum: authority.formats },
      disposition: { type: "string", enum: ["retain", "revise", "reject"] },
    },
  };
}

function channelCaseSchema(authority) {
  return {
    type: "object",
    additionalProperties: false,
    required: ["id", "state"],
    properties: {
      id: { type: "string", enum: authority.channelCases },
      state: {
        type: "string",
        enum: [
          "available", "conditional_unverified", "conditionally_preferred",
          "discovery_only", "not_selected", "not_verified",
          "protected_verification_required", "recommended", "rejected",
          "research_more",
        ],
      },
    },
  };
}

function economicsCaseSchema(authority, options = {}) {
  const properties = {
    channelId: { type: "string", enum: authority.channelCases },
    priceAudCents: { type: "integer", enum: authority.priceCasesAudCents },
    state: { type: "string", enum: ["estimated", "known_zero", "unknown", "not_applicable"] },
    estimatedNetCashContributionAudCents: { type: ["integer", "null"] },
    unknownCosts: stringArraySchema({ maxItems: 20 }),
  };
  const required = Object.keys(properties);
  if (options.includeEvidenceRefs === true) {
    properties.evidenceRefs = stringArraySchema({ maxItems: 20 });
    required.push("evidenceRefs");
  }
  return { type: "object", additionalProperties: false, required, properties };
}

function readinessGateSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["id", "required", "status"],
    properties: {
      id: { type: "string", enum: READINESS_GATE_IDS },
      required: { type: "boolean", enum: [true] },
      status: {
        type: "string",
        enum: [
          "supported", "partially_supported", "unresolved", "contradicted",
          "owner_input_recorded", "protected_verification_required",
        ],
      },
    },
  };
}

function buyerEvidenceSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: [
      "kind", "independenceGroup", "paidOfferId",
      "sellerOrPublisherId", "exactWorkflowRelevance",
    ],
    properties: {
      kind: {
        type: "string",
        enum: [
          "consequence",
          "workaround_or_spending_trigger",
          "purchaser_attributable_behaviour",
        ],
      },
      independenceGroup: { type: "string" },
      paidOfferId: { type: ["string", "null"] },
      sellerOrPublisherId: { type: "string" },
      exactWorkflowRelevance: { type: "boolean" },
    },
  };
}

function coverageGapSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: [
      "id", "subjectId", "comparison", "requiredCount", "actualCount",
      "constraint", "reason",
    ],
    properties: {
      id: { type: "string" },
      subjectId: { type: ["string", "null"] },
      comparison: { type: "string", enum: ["minimum", "maximum"] },
      requiredCount: { type: "integer", minimum: 0 },
      actualCount: { type: "integer", minimum: 0 },
      constraint: {
        type: "string",
        enum: [
          "authentication_required", "captcha", "insufficient_relevant_public_evidence",
          "paywall", "private_endpoint", "rate_limit", "robots_control",
          "source_quality_rejected",
        ],
      },
      reason: { type: "string" },
    },
  };
}

function sourceAttemptSchema(authority, template) {
  return {
    type: "object",
    additionalProperties: false,
    required: [
      "id", "questionId", "purpose", "sourceClass", "outcome",
      "constraint", "sourceIds", "detail",
    ],
    properties: {
      id: { type: "string" },
      questionId: {
        type: "string",
        enum: authority.researchQuestions.map((question) => question.id),
      },
      purpose: {
        type: "string",
        enum: [
          "buyer_problem", "comparator", "contrary", "direct_demand",
          "required_source_class", "supporting",
        ],
      },
      sourceClass: { type: "string", enum: template.requiredSourceClasses },
      outcome: {
        type: "string",
        enum: [
          "access_boundary", "no_relevant_public_evidence",
          "source_quality_rejected", "source_retained",
        ],
      },
      constraint: {
        type: "string",
        enum: [
          "authentication_required", "captcha", "insufficient_relevant_public_evidence",
          "none", "paywall", "private_endpoint", "rate_limit", "robots_control",
          "source_quality_rejected",
        ],
      },
      sourceIds: stringArraySchema({ maxItems: 10 }),
      detail: { type: "string" },
    },
  };
}

function nextEvidenceActionSchema(authority) {
  return {
    type: "object",
    additionalProperties: false,
    required: ["method", "questionId", "action", "maxCostAudCents", "whyDecisionChanging"],
    properties: {
      method: {
        type: "string",
        enum: [
          "documented_public_endpoint_research",
          "owner_provided_evidence",
          "separate_direct_source_capture",
        ],
      },
      questionId: {
        type: "string",
        enum: authority.researchQuestions.map((question) => question.id),
      },
      action: { type: "string" },
      maxCostAudCents: { type: "integer", minimum: 0, maximum: 50 },
      whyDecisionChanging: { type: "string" },
    },
  };
}

function recommendationSchema(authority) {
  return {
    type: "object",
    additionalProperties: false,
    required: [
      "outcome", "summary", "buyer", "problem", "offer", "channel",
      "priceOrMargin", "evidenceStandard", "nextMoneyMove",
      "reviseOrStopCriteria", "materialContradictions", "limitations",
    ],
    properties: {
      outcome: { type: "string", enum: authority.allowedOutcomes },
      summary: { type: "string" },
      buyer: { type: "string" },
      problem: { type: "string" },
      offer: { type: "string" },
      channel: { type: "string" },
      priceOrMargin: { type: "string" },
      evidenceStandard: { type: "string" },
      nextMoneyMove: { type: "string" },
      reviseOrStopCriteria: stringArraySchema({ minItems: 1, maxItems: 20 }),
      materialContradictions: stringArraySchema({ maxItems: 20 }),
      limitations: stringArraySchema({ minItems: 1, maxItems: 20 }),
    },
  };
}

function researchSourceSchema(template, priorEvidenceContext) {
  const required = [
    "id", "sourceClass", "sourceTier", "captureStatus", "url", "title",
    "publisher", "publishedAt", "content", "retainedEvidenceHash",
    "retainedSourceSnapshotHash", "limitations",
  ];
  const common = {
    id: { type: "string" },
    sourceTier: { type: "integer", minimum: 1, maximum: 4 },
    limitations: { type: "array", maxItems: 8, items: { type: "string" } },
  };
  const publicClasses = template.requiredSourceClasses.filter(
    (sourceClass) => sourceClass !== "retained_pantheon_evidence",
  );
  const publicBranch = {
    type: "object",
    additionalProperties: false,
    required,
    properties: {
      ...common,
      sourceClass: { type: "string", enum: publicClasses },
      captureStatus: { type: "string", enum: ["partial", "unavailable", "blocked"] },
      url: { type: ["string", "null"] },
      title: { type: ["string", "null"] },
      publisher: { type: ["string", "null"] },
      publishedAt: { type: ["string", "null"] },
      content: { type: "null" },
      retainedEvidenceHash: { type: "null" },
      retainedSourceSnapshotHash: { type: "null" },
    },
  };
  if (!template.requiredSourceClasses.includes("retained_pantheon_evidence")) {
    return publicBranch;
  }
  const retainedCommon = {
    ...common,
    sourceClass: { type: "string", enum: ["retained_pantheon_evidence"] },
    captureStatus: { type: "string", enum: ["partial"] },
    url: { type: "null" },
    title: { type: "null" },
    publisher: { type: "null" },
    publishedAt: { type: "null" },
    content: { type: "null" },
  };
  return {
    anyOf: [
      publicBranch,
      {
        type: "object",
        additionalProperties: false,
        required,
        properties: {
          ...retainedCommon,
          retainedEvidenceHash: { type: "string" },
          retainedSourceSnapshotHash: { type: "null" },
        },
      },
      {
        type: "object",
        additionalProperties: false,
        required,
        properties: {
          ...retainedCommon,
          retainedEvidenceHash: { type: "null" },
          retainedSourceSnapshotHash: { type: "string" },
        },
      },
    ],
  };
}

function strictResearchOutputSchema(authority, template, priorEvidenceContext) {
  const sectionNames = [...new Set(
    template.requiredOutputSections.filter((section) => section !== "sources"),
  )];
  const properties = {
    sources: {
      type: "array",
      maxItems: 30,
      items: researchSourceSchema(template, priorEvidenceContext),
    },
    evidence: {
      type: "array",
      maxItems: 60,
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "id", "sourceId", "truthClass", "polarity", "questionId",
          "criterionId", "claim", "confidence", "limitations", "details",
        ],
        properties: {
          id: { type: "string" },
          sourceId: { type: ["string", "null"] },
          truthClass: {
            type: "string",
            enum: ["estimate", "model_inference", "unknown"],
          },
          polarity: { type: "string", enum: ["supporting", "contrary", "neutral", "unknown"] },
          questionId: {
            type: "string",
            enum: authority.researchQuestions.map((question) => question.id),
          },
          criterionId: {
            anyOf: [
              { type: "null" },
              { type: "string", enum: assignmentCriterionIds(authority, template.id) },
            ],
          },
          claim: { type: "string" },
          confidence: { type: "string", enum: ["low", "medium", "high", "unknown"] },
          limitations: { type: "array", maxItems: 8, items: { type: "string" } },
          details: {
            type: "object",
            additionalProperties: false,
            required: [
              "comparator", "buyerEvidence", "formatCase", "channelCase", "economicsCase",
              "readinessGate", "recommendation",
            ],
            properties: {
              comparator: {
                anyOf: [
                  { type: "null" },
                  {
                    type: "object",
                    additionalProperties: false,
                    required: [
                      "id", "category", "sellerId", "channelId", "formatIds",
                      "reviewObservationCount",
                    ],
                    properties: {
                      id: { type: "string" },
                      category: {
                        type: "string",
                        enum: ["direct_or_near_direct", "adjacent", "indirect"],
                      },
                      sellerId: { type: ["string", "null"] },
                      channelId: { type: "string" },
                      formatIds: {
                        type: "array",
                        minItems: 1,
                        items: { type: "string", enum: authority.formats },
                      },
                      reviewObservationCount: { type: "integer", minimum: 0 },
                    },
                  },
                ],
              },
              buyerEvidence: nullableSchema(buyerEvidenceSchema()),
              formatCase: nullableSchema(formatCaseSchema(authority)),
              channelCase: nullableSchema(channelCaseSchema(authority)),
              economicsCase: nullableSchema(economicsCaseSchema(authority)),
              readinessGate: nullableSchema(readinessGateSchema()),
              recommendation: nullableSchema(recommendationSchema(authority)),
            },
          },
        },
      },
    },
  };
  for (const section of sectionNames) {
    if (section === "formatCases") {
      properties[section] = {
        type: "array", minItems: authority.formats.length, maxItems: authority.formats.length,
        items: formatCaseSchema(authority),
      };
    } else if (section === "channelCases") {
      properties[section] = {
        type: "array", minItems: authority.channelCases.length, maxItems: authority.channelCases.length,
        items: channelCaseSchema(authority),
      };
    } else if (section === "economicsCases") {
      const count = authority.channelCases.length * authority.priceCasesAudCents.length;
      properties[section] = {
        type: "array", minItems: count, maxItems: count,
        items: economicsCaseSchema(authority, { includeEvidenceRefs: true }),
      };
    } else if (section === "readinessGates") {
      properties[section] = {
        type: "array", minItems: READINESS_GATE_IDS.length, maxItems: READINESS_GATE_IDS.length,
        items: readinessGateSchema(),
      };
    } else if (section === "recommendation") {
      properties[section] = recommendationSchema(authority);
    } else {
      properties[section] = stringArraySchema({ maxItems: 30 });
    }
  }
  return {
    type: "object",
    additionalProperties: false,
    required: ["sources", "evidence", ...sectionNames],
    properties,
  };
}

function assertSupportedStrictSchema(schema) {
  const unsupported = new Set([
    "allOf", "contains", "dependentRequired", "dependentSchemas", "else", "if",
    "maxContains", "maxLength", "minContains", "minLength", "not", "oneOf",
    "patternProperties", "propertyNames", "then", "unevaluatedProperties", "uniqueItems",
  ]);
  let propertyCount = 0;
  function visit(node, depth, path) {
    if (!isObject(node)) return;
    if (depth > 10) {
      throw runnerError(
        "preventure_research_schema_depth_exceeded",
        `The strict provider schema exceeds ten levels at ${path}.`,
      );
    }
    for (const key of Object.keys(node)) {
      if (unsupported.has(key)) {
        throw runnerError(
          "preventure_research_schema_keyword_unsupported",
          `The strict provider schema uses unsupported keyword ${key} at ${path}.`,
        );
      }
    }
    const objectType = node.type === "object"
      || (Array.isArray(node.type) && node.type.includes("object"));
    if (objectType) {
      const properties = node.properties;
      if (
        !isObject(properties)
        || node.additionalProperties !== false
        || !Array.isArray(node.required)
        || !sameCanonical([...node.required].sort(), Object.keys(properties).sort())
      ) {
        throw runnerError(
          "preventure_research_schema_object_not_strict",
          `Every provider-schema object must require every property and forbid extras at ${path}.`,
        );
      }
      propertyCount += Object.keys(properties).length;
      for (const [key, child] of Object.entries(properties)) {
        visit(child, depth + 1, `${path}.properties.${key}`);
      }
    }
    if (isObject(node.items)) visit(node.items, depth + 1, `${path}.items`);
    for (const [index, child] of (node.anyOf || []).entries()) {
      visit(child, depth + 1, `${path}.anyOf[${index}]`);
    }
  }
  if (!isObject(schema) || schema.type !== "object") {
    throw runnerError(
      "preventure_research_schema_root_invalid",
      "The strict provider schema root must be an object.",
    );
  }
  visit(schema, 1, "schema");
  if (propertyCount > 5_000) {
    throw runnerError(
      "preventure_research_schema_property_limit_exceeded",
      "The strict provider schema exceeds 5,000 total object properties.",
    );
  }
  return schema;
}

function createPreventureResearchExecutionDescriptor(
  authority,
  assignment,
  template,
  activationEvent,
  priorEvidenceContext = null,
) {
  if (
    !isObject(authority)
    || !isObject(assignment)
    || !isObject(template)
    || !isObject(activationEvent)
  ) {
    throw runnerError(
      "preventure_research_descriptor_input_invalid",
      "The exact authority, assignment, template, and activation event are required.",
      { statusCode: 400 },
    );
  }
  if (
    assignment.authorityHash !== authority.authorityHash
    || assignment.id !== template.id
    || assignment.templateHash !== sha256(template)
    || assignment.activationEventHash !== activationEvent.eventHash
    || activationEvent.eventType !== "activated"
  ) {
    throw runnerError(
      "preventure_research_descriptor_binding_invalid",
      "The execution descriptor inputs do not share one exact activated assignment.",
    );
  }
  const priorContext = validatePriorEvidenceContext(
    authority,
    assignment,
    priorEvidenceContext,
  );
  const prompt = serverOwnedPrompt(authority, template, priorContext);
  const worstCaseCost = pricedWorstCaseCost(authority, assignment);
  const requestPolicy = authority.provider?.requestPolicy;
  if (!isObject(requestPolicy) || !isObject(requestPolicy.text?.format)) {
    throw runnerError(
      "preventure_research_request_policy_invalid",
      "The reviewed provider request policy is unavailable.",
    );
  }
  const outputSchema = assertSupportedStrictSchema(
    strictResearchOutputSchema(authority, template, priorContext),
  );
  const requestBody = {
    model: assignment.model,
    store: requestPolicy.store,
    tools: canonical(requestPolicy.tools),
    tool_choice: requestPolicy.tool_choice,
    include: canonical(requestPolicy.include),
    max_tool_calls: assignment.maxToolCalls,
    max_output_tokens: assignment.maxOutputTokens,
    parallel_tool_calls: requestPolicy.parallel_tool_calls,
    background: requestPolicy.background,
    service_tier: requestPolicy.service_tier,
    reasoning: canonical(requestPolicy.reasoning),
    text: {
      format: {
        type: requestPolicy.text.format.type,
        name: requestPolicy.text.format.name,
        strict: requestPolicy.text.format.strict,
        schema: outputSchema,
      },
    },
    input: [
      {
        role: "system",
        content: [{ type: "input_text", text: JSON.stringify(prompt) }],
      },
    ],
    metadata: {
      authority_hash: authority.authorityHash.slice("sha256:".length),
      assignment_hash: assignment.assignmentHash.slice("sha256:".length),
      workflow_id: assignment.workflowId,
      task_id: assignment.taskId,
      adapter: "openai-responses-web-search",
      data_class: "business_internal",
    },
  };
  const providerVisibleInputUtf8ByteLength = Buffer.byteLength(
    JSON.stringify(canonical(requestBody)),
    "utf8",
  );
  if (
    !Number.isSafeInteger(providerVisibleInputUtf8ByteLength)
    || providerVisibleInputUtf8ByteLength < 1
    || providerVisibleInputUtf8ByteLength > assignment.localPromptPreflightMaxInputTokens
  ) {
    throw runnerError(
      "preventure_research_local_prompt_preflight_exceeded",
      "The full provider-visible request, including prior evidence, tool controls, and strict schema, exceeds the local 30,000-token safety bound.",
    );
  }
  const request = {
    schema: PREVENTURE_RESEARCH_REQUEST_SCHEMA,
    authorityHash: authority.authorityHash,
    assignmentHash: assignment.assignmentHash,
    provider: authority.provider.id,
    endpointPolicy: "official_openai_responses_only",
    method: "POST",
    endpointPath: "/v1/responses",
    responseStorage: false,
    providerTraceContent: false,
    providerVisibleInputUtf8ByteLength,
    localInputTokenUpperBound: providerVisibleInputUtf8ByteLength,
    requestBody,
    requestBodyHash: sha256(requestBody),
  };
  const body = {
    schema: PREVENTURE_RESEARCH_EXECUTION_DESCRIPTOR_SCHEMA,
    authorityHash: authority.authorityHash,
    activationEventHash: activationEvent.eventHash,
    assignmentId: assignment.id,
    assignmentHash: assignment.assignmentHash,
    templateHash: assignment.templateHash,
    workflowId: assignment.workflowId,
    taskId: assignment.taskId,
    provider: assignment.provider,
    model: assignment.model,
    method: "openai_responses_web_search",
    toolTypes: ["web_search"],
    limits: {
      maxCostAudCents: assignment.maxCostAudCents,
      maxAttempts: 1,
      maxToolCalls: assignment.maxToolCalls,
      maximumModelPasses: assignment.maximumModelPasses,
      maxInputTokens: assignment.maxInputTokens,
      localPromptPreflightMaxInputTokens: assignment.localPromptPreflightMaxInputTokens,
      maxOutputTokens: assignment.maxOutputTokens,
      maxTurns: assignment.maxTurns,
      deadlineMs: assignment.deadlineMs,
    },
    sourcePolicyHash: sha256(authority.sourcePolicy),
    providerPricingPolicyHash: authority.provider.pricingPolicyHash,
    worstCaseCost,
    prohibitedActionsHash: sha256(authority.prohibitedActions),
    expiresAt: authority.expiresAt,
    externalEffects: [],
    externalCommercialSpendCapAudCents: 0,
    promptHash: sha256(prompt),
    priorEvidenceContextHash: priorContext.contextHash,
    request,
    buildAuthorized: false,
    commercialTestAuthorized: false,
    externalActionAuthorized: false,
  };
  return deepFreeze({ ...body, descriptorHash: sha256(body) });
}

function validatePreventureResearchExecutionDescriptor(
  authority,
  assignment,
  template,
  activationEvent,
  descriptor,
  priorEvidenceContext = null,
) {
  const exact = createPreventureResearchExecutionDescriptor(
    authority,
    assignment,
    template,
    activationEvent,
    priorEvidenceContext,
  );
  if (
    !isObject(descriptor)
    || descriptor.descriptorHash !== sha256((({ descriptorHash: _hash, ...body }) => body)(descriptor))
    || sha256(descriptor) !== sha256(exact)
  ) {
    throw runnerError(
      "preventure_research_descriptor_changed",
      "The exact bounded web-search execution descriptor changed before dispatch.",
    );
  }
  return descriptor;
}

function recordValue(record, camel, snake) {
  return record?.[camel] ?? record?.[snake] ?? null;
}

function latestReceiptsByAttempt(receipts) {
  const latest = new Map();
  for (const receipt of receipts) {
    const attemptId = recordValue(receipt, "attemptId", "attempt_id");
    if (!attemptId) continue;
    const prior = latest.get(attemptId);
    if (!prior || Number(receipt.sequence || 0) > Number(prior.sequence || 0)) {
      latest.set(attemptId, receipt);
    }
  }
  return [...latest.values()];
}

function assignmentHasActivity(ledger, assignment) {
  const taskId = assignment.taskId;
  const assignmentHash = assignment.assignmentHash;
  const taskBoundCollections = [
    ledger.executionEvidence?.taskAttempts,
    ledger.executionEvidence?.modelCalls,
    ledger.executionEvidence?.agentRunReceipts,
    ledger.executionEvidence?.agentRuns,
    ledger.executionEvidence?.researchRuns,
    ledger.executionEvidence?.toolInvocations,
    ledger.executionEvidence?.budgetReservations,
    ledger.agentRuns,
    ledger.researchRuns,
    ledger.toolInvocations,
    ledger.budgetReservations,
  ];
  return taskBoundCollections.flatMap((records) => records || [])
    .some((record) => recordValue(record, "taskId", "task_id") === taskId)
    || (ledger.costEvents || []).some((record) => record.assignmentHash === assignmentHash)
    || (ledger.sourceSnapshots || []).some((record) => record.assignmentHash === assignmentHash)
    || (ledger.evidenceRecords || []).some((record) => record.assignmentHash === assignmentHash)
    || (ledger.assignmentSkips || []).some((record) => record.assignmentHash === assignmentHash)
    || (Boolean(assignmentHash)
      && ledger.terminalStopRecord?.triggerAssignmentHash === assignmentHash);
}

function buildPriorEvidenceContext(ledger, plan, assignment) {
  const index = plan.assignments.findIndex((item) => item.id === assignment.id);
  if (index < 0) {
    throw runnerError(
      "preventure_research_assignment_unknown",
      "The assignment is not part of the exact materialized plan.",
    );
  }
  for (const later of plan.assignments.slice(index + 1)) {
    if (assignmentHasActivity(ledger, later)) {
      throw runnerError(
        "preventure_research_assignment_order_corrupt",
        "A later research assignment contains activity before its approved turn. Dispatch is frozen.",
      );
    }
  }
  const prior = plan.assignments.slice(0, index);
  const completion = executionCompletion(ledger);
  const costHeads = latestCostExposure(ledger.costEvents).latest;
  const completedAssignments = [];
  const allPriorSourceSnapshots = [];
  const allPriorEvidenceRecords = [];
  const terminalReceiptHashes = [];
  const costReceiptHashes = [];
  for (const planned of prior) {
    const item = completion.items.find((candidate) => candidate.assignmentId === planned.id);
    const sources = (ledger.sourceSnapshots || []).filter(
      (record) => record.assignmentHash === planned.assignmentHash,
    );
    const evidence = (ledger.evidenceRecords || []).filter(
      (record) => record.assignmentHash === planned.assignmentHash,
    );
    const assignmentCosts = costHeads.filter(
      (record) => record.assignmentHash === planned.assignmentHash,
    );
    const receipts = latestReceiptsByAttempt(
      (ledger.executionEvidence?.agentRunReceipts || []).filter(
        (record) => recordValue(record, "taskId", "task_id") === planned.taskId,
      ),
    ).filter((receipt) => (
      receipt.status === "complete"
      && recordValue(receipt, "outcomeStatus", "outcome_status") === "known"
    ));
    if (
      !item?.complete
      || receipts.length !== 1
      || sources.length === 0
      || sources.some((source) => (
        !["partial", "captured"].includes(source.captureStatus)
        || !recordValue(source, "snapshotHash", "snapshot_hash")
        || !recordValue(source, "sourceRecordId", "source_record_id")
        || !recordValue(source, "provenanceId", "provenance_id")
        || !recordValue(source, "researchRunId", "research_run_id")
        || !recordValue(source, "agentRunReceiptId", "agent_run_receipt_id")
      ))
      || evidence.length === 0
      || assignmentCosts.length === 0
      || assignmentCosts.some((cost) => (
        !["estimated", "incurred", "reconciled"].includes(cost.eventType)
        || !recordValue(cost, "receiptHash", "receipt_hash")
      ))
    ) {
      throw runnerError(
        "preventure_research_assignment_order_blocked",
        `Assignment ${planned.id} must have known cost truth, retained evidence, and one final immutable receipt before later work.`,
      );
    }
    const receiptHash = recordValue(receipts[0], "receiptHash", "receipt_hash");
    const assignmentCostHashes = assignmentCosts
      .map((cost) => recordValue(cost, "receiptHash", "receipt_hash"))
      .sort();
    const sourceHashes = sources
      .map((source) => recordValue(source, "snapshotHash", "snapshot_hash"))
      .filter(Boolean)
      .sort();
    const evidenceHashes = evidence.map((record) => record.evidenceHash).filter(Boolean).sort();
    terminalReceiptHashes.push(receiptHash);
    costReceiptHashes.push(...assignmentCostHashes);
    completedAssignments.push({
      id: planned.id,
      assignmentHash: planned.assignmentHash,
      taskId: planned.taskId,
      terminalReceiptHash: receiptHash,
      costReceiptHashes: assignmentCostHashes,
      sourceSnapshotCount: sourceHashes.length,
      sourceSnapshotSetHash: sha256(sourceHashes),
      evidenceRecordCount: evidenceHashes.length,
      evidenceRecordSetHash: sha256(evidenceHashes),
    });
    allPriorSourceSnapshots.push(...sources.map((source) => ({
      id: source.id,
      assignmentHash: source.assignmentHash,
      snapshotHash: recordValue(source, "snapshotHash", "snapshot_hash"),
      sourceClass: source.sourceClass,
      sourceTier: source.sourceTier,
      captureStatus: source.captureStatus,
      url: source.url || null,
      title: source.title || null,
      publisher: source.publisher || null,
      contentHash: source.contentHash || null,
    })));
    allPriorEvidenceRecords.push(...evidence.map((record) => ({
      id: record.id,
      assignmentHash: record.assignmentHash,
      evidenceHash: record.evidenceHash,
      sourceSnapshotHash: record.sourceSnapshotHash || null,
      truthClass: record.truthClass,
      polarity: record.polarity,
      questionId: record.questionId,
      criterionId: record.criterionId || null,
      claim: boundedText(record.claim, "Retained prior-evidence claim", 500),
      confidence: record.confidence,
      details: isObject(record.details) ? record.details : {},
    })));
  }
  const sourceHashes = allPriorSourceSnapshots
    .map((item) => item.snapshotHash)
    .filter(Boolean)
    .sort();
  const evidenceHashes = allPriorEvidenceRecords
    .map((item) => item.evidenceHash)
    .filter(Boolean)
    .sort();
  const materialEvidence = allPriorEvidenceRecords.filter((item) => (
    item.polarity === "contrary"
    || item.polarity === "unknown"
    || item.truthClass === "unknown"
  ));
  const materialGroups = new Map();
  for (const item of materialEvidence) {
    const category = {
      questionId: item.questionId || null,
      criterionId: item.criterionId || null,
      polarity: item.polarity || null,
      truthClass: item.truthClass || null,
    };
    const key = JSON.stringify(canonical(category));
    const rows = materialGroups.get(key) || { category, hashes: [], items: [] };
    rows.hashes.push(item.evidenceHash);
    rows.items.push(item);
    materialGroups.set(key, rows);
  }
  const aggregate = (rows, field) => Object.fromEntries([...rows.reduce((map, item) => {
    const key = String(item[field] || "none");
    map.set(key, (map.get(key) || 0) + 1);
    return map;
  }, new Map()).entries()].sort());
  const caseByCriterion = new Map();
  for (const item of [...allPriorEvidenceRecords]
    .filter((record) => record.criterionId)
    .sort((left, right) => left.evidenceHash.localeCompare(right.evidenceHash))) {
    if (!caseByCriterion.has(item.criterionId)) {
      caseByCriterion.set(item.criterionId, {
        criterionId: item.criterionId,
        evidenceHash: item.evidenceHash,
        truthClass: item.truthClass,
        polarity: item.polarity,
      });
    }
  }
  const orderedMaterialGroups = [...materialGroups.entries()]
    .sort(([left], [right]) => left.localeCompare(right));
  const materialGroupRepresentatives = orderedMaterialGroups.map(([, group]) => (
    [...group.items].sort((left, right) => left.evidenceHash.localeCompare(right.evidenceHash))[0]
  ));
  const materialHashSet = new Set(materialEvidence.map((item) => item.evidenceHash));
  const criterionRepresentatives = [...caseByCriterion.values()]
    .map((summary) => allPriorEvidenceRecords.find(
      (item) => item.evidenceHash === summary.evidenceHash,
    ))
    .filter(Boolean)
    .sort((left, right) => left.evidenceHash.localeCompare(right.evidenceHash));
  const prioritizedEvidence = [
    ...materialGroupRepresentatives,
    ...criterionRepresentatives,
    ...[...allPriorEvidenceRecords]
      .filter((item) => materialHashSet.has(item.evidenceHash))
      .sort((left, right) => left.evidenceHash.localeCompare(right.evidenceHash)),
    ...[...allPriorEvidenceRecords].sort(
      (left, right) => left.evidenceHash.localeCompare(right.evidenceHash),
    ),
  ];
  const uniquePrioritizedEvidence = [];
  const prioritizedHashes = new Set();
  for (const item of prioritizedEvidence) {
    if (prioritizedHashes.has(item.evidenceHash)) continue;
    prioritizedHashes.add(item.evidenceHash);
    uniquePrioritizedEvidence.push(item);
  }
  const selectedEvidence = uniquePrioritizedEvidence.slice(0, 6).map((item) => ({
    id: item.id,
    assignmentHash: item.assignmentHash,
    evidenceHash: item.evidenceHash,
    sourceSnapshotHash: item.sourceSnapshotHash,
    truthClass: item.truthClass,
    polarity: item.polarity,
    questionId: item.questionId,
    criterionId: item.criterionId,
    claimPreview: item.claim.slice(0, 120),
    claimHash: sha256(item.claim),
    confidence: item.confidence,
    detailsHash: sha256(item.details),
  }));
  const selectedSourceHashSet = new Set(
    selectedEvidence.map((item) => item.sourceSnapshotHash).filter(Boolean),
  );
  const selectedSources = [...allPriorSourceSnapshots].sort((left, right) => {
    const rank = (item) => selectedSourceHashSet.has(item.snapshotHash) ? 0 : 1;
    return rank(left) - rank(right)
      || left.snapshotHash.localeCompare(right.snapshotHash);
  }).slice(0, 6).map((item) => ({
    ...item,
    title: item.title ? String(item.title).slice(0, 120) : null,
    publisher: item.publisher ? String(item.publisher).slice(0, 80) : null,
  }));
  const selectedSourceHashes = selectedSources.map((item) => item.snapshotHash).sort();
  const selectedEvidenceHashes = selectedEvidence.map((item) => item.evidenceHash).sort();
  const allRequiredCaseSummaries = [...caseByCriterion.values()].sort(
    (left, right) => left.criterionId.localeCompare(right.criterionId),
  );
  const selectedRequiredCaseSummaries = [...allRequiredCaseSummaries].sort((left, right) => {
    const leftRank = selectedEvidenceHashes.includes(left.evidenceHash) ? 0 : 1;
    const rightRank = selectedEvidenceHashes.includes(right.evidenceHash) ? 0 : 1;
    return leftRank - rightRank || left.criterionId.localeCompare(right.criterionId);
  }).slice(0, 6).sort((left, right) => left.criterionId.localeCompare(right.criterionId));
  const fullRequiredCaseSummaryHashes = allRequiredCaseSummaries.map((item) => sha256(item)).sort();
  const selectedRequiredCaseSummaryHashes = selectedRequiredCaseSummaries
    .map((item) => sha256(item))
    .sort();
  const omittedRequiredCaseSummaryHashes = fullRequiredCaseSummaryHashes.filter(
    (hash) => !selectedRequiredCaseSummaryHashes.includes(hash),
  );
  const materialRepresentativeHashes = materialGroupRepresentatives
    .map((item) => item.evidenceHash)
    .sort();
  const selectedMaterialRepresentativeHashes = materialRepresentativeHashes
    .filter((hash) => selectedEvidenceHashes.includes(hash));
  const omittedMaterialRepresentativeHashes = materialRepresentativeHashes
    .filter((hash) => !selectedEvidenceHashes.includes(hash));
  const materialGroupManifests = orderedMaterialGroups.map(([, group]) => {
    const representativeEvidenceHash = [...group.items]
      .sort((left, right) => left.evidenceHash.localeCompare(right.evidenceHash))[0]
      .evidenceHash;
    const manifest = {
      ...group.category,
      count: group.hashes.length,
      memberSetHash: sha256([...group.hashes].sort()),
      representativeEvidenceHash,
    };
    return { ...manifest, groupHash: sha256(manifest) };
  }).sort((left, right) => left.groupHash.localeCompare(right.groupHash));
  const selectedMaterialRepresentativeHashSet = new Set(selectedMaterialRepresentativeHashes);
  const selectedMaterialGroupManifests = materialGroupManifests.filter(
    (group) => selectedMaterialRepresentativeHashSet.has(group.representativeEvidenceHash),
  );
  const omittedMaterialGroupHashes = materialGroupManifests
    .filter((group) => !selectedMaterialRepresentativeHashSet.has(group.representativeEvidenceHash))
    .map((group) => group.groupHash)
    .sort();
  const fullMaterialGroupHashes = materialGroupManifests.map((group) => group.groupHash).sort();
  const omittedSourceHashes = sourceHashes.filter((hash) => !selectedSourceHashes.includes(hash));
  const omittedEvidenceHashes = evidenceHashes.filter((hash) => !selectedEvidenceHashes.includes(hash));
  const body = canonical({
    schema: PRIOR_EVIDENCE_CONTEXT_SCHEMA,
    authorityHash: ledger.authority.authorityHash,
    assignmentId: assignment.id,
    completedAssignments,
    sourceSnapshots: selectedSources.sort((left, right) => (
      String(left.snapshotHash).localeCompare(String(right.snapshotHash))
    )),
    evidenceRecords: selectedEvidence.sort((left, right) => (
      String(left.evidenceHash).localeCompare(String(right.evidenceHash))
    )),
    requiredCaseSummaries: selectedRequiredCaseSummaries,
    materialEvidenceSummary: {
      count: materialEvidence.length,
      setHash: sha256(materialEvidence.map((item) => item.evidenceHash).sort()),
      fullGroupCount: fullMaterialGroupHashes.length,
      fullGroupSetHash: sha256(fullMaterialGroupHashes),
      groups: selectedMaterialGroupManifests,
      omittedGroupCount: omittedMaterialGroupHashes.length,
      omittedGroupSetHash: sha256(omittedMaterialGroupHashes),
      byQuestion: aggregate(materialEvidence, "questionId"),
      byPolarity: aggregate(materialEvidence, "polarity"),
      byTruthClass: aggregate(materialEvidence, "truthClass"),
    },
    compaction: {
      algorithm: "pantheon_prior_evidence_compaction_v1",
      fullSourceSnapshotCount: sourceHashes.length,
      fullSourceSnapshotSetHash: sha256(sourceHashes),
      selectedSourceSnapshotCount: selectedSourceHashes.length,
      selectedSourceSnapshotSetHash: sha256(selectedSourceHashes),
      omittedSourceSnapshotCount: omittedSourceHashes.length,
      omittedSourceSnapshotSetHash: sha256(omittedSourceHashes),
      fullEvidenceRecordCount: evidenceHashes.length,
      fullEvidenceRecordSetHash: sha256(evidenceHashes),
      selectedEvidenceRecordCount: selectedEvidenceHashes.length,
      selectedEvidenceRecordSetHash: sha256(selectedEvidenceHashes),
      omittedEvidenceRecordCount: omittedEvidenceHashes.length,
      omittedEvidenceRecordSetHash: sha256(omittedEvidenceHashes),
      fullMaterialGroupCount: materialRepresentativeHashes.length,
      fullMaterialGroupRepresentativeSetHash: sha256(materialRepresentativeHashes),
      selectedMaterialGroupRepresentativeCount: selectedMaterialRepresentativeHashes.length,
      selectedMaterialGroupRepresentativeSetHash: sha256(selectedMaterialRepresentativeHashes),
      omittedMaterialGroupRepresentativeCount: omittedMaterialRepresentativeHashes.length,
      omittedMaterialGroupRepresentativeSetHash: sha256(omittedMaterialRepresentativeHashes),
      fullRequiredCaseSummaryCount: fullRequiredCaseSummaryHashes.length,
      fullRequiredCaseSummarySetHash: sha256(fullRequiredCaseSummaryHashes),
      selectedRequiredCaseSummaryCount: selectedRequiredCaseSummaryHashes.length,
      selectedRequiredCaseSummarySetHash: sha256(selectedRequiredCaseSummaryHashes),
      omittedRequiredCaseSummaryCount: omittedRequiredCaseSummaryHashes.length,
      omittedRequiredCaseSummarySetHash: sha256(omittedRequiredCaseSummaryHashes),
    },
    terminalReceiptHashes: terminalReceiptHashes.sort(),
    costReceiptHashes: costReceiptHashes.sort(),
  });
  return validatePriorEvidenceContext(
    ledger.authority,
    assignment,
    { ...body, contextHash: sha256(body) },
  );
}

function exactDescriptorContext(store, authorityHash, assignmentId, options = {}) {
  const dispatch = assertPreventureResearchDispatchAuthority(
    store,
    authorityHash,
    assignmentId,
    {
      expectedAssignmentHash: options.expectedAssignmentHash,
      at: options.at,
    },
  );
  const ledger = store.readLedger(authorityHash);
  const plan = createPreventureResearchAssignmentPlan(dispatch.authority, ledger.lifecycle);
  if (ledger.assignments.length !== plan.assignments.length) {
    throw runnerError(
      "preventure_research_assignment_set_incomplete",
      "Dispatch remains blocked until every exact accepted assignment is materialized.",
    );
  }
  for (const planned of plan.assignments) {
    const stored = ledger.assignments.find((candidate) => candidate.id === planned.id);
    if (
      !stored
      || stored.templateHash !== planned.templateHash
      || stored.workflowId !== planned.workflowId
      || stored.taskId !== planned.taskId
      || stored.maxCostAudCents !== planned.maxCostAudCents
    ) {
      throw runnerError(
        "preventure_research_assignment_set_changed",
        "The materialized assignment set changed after activation.",
      );
    }
  }
  const executionPlan = {
    ...plan,
    assignments: plan.assignments.map((planned) => ({
      ...planned,
      assignmentHash: ledger.assignments.find(
        (candidate) => candidate.id === planned.id,
      ).assignmentHash,
    })),
  };
  const activationEvent = ledger.lifecycle.find((event) => event.eventType === "activated");
  const priorEvidenceContext = buildPriorEvidenceContext(
    ledger,
    executionPlan,
    dispatch.assignment,
  );
  const descriptor = createPreventureResearchExecutionDescriptor(
    dispatch.authority,
    dispatch.assignment,
    dispatch.template,
    activationEvent,
    priorEvidenceContext,
  );
  if (options.expectedDescriptorHash && options.expectedDescriptorHash !== descriptor.descriptorHash) {
    throw runnerError(
      "preventure_research_descriptor_stale",
      "Refresh the exact research assignment; its execution descriptor changed.",
    );
  }
  return { ...dispatch, ledger, plan: executionPlan, priorEvidenceContext, descriptor };
}

function describePreventureResearchAssignment(input = {}) {
  const context = exactDescriptorContext(
    input.store,
    input.authorityHash,
    input.assignmentId,
    {
      expectedAssignmentHash: input.expectedAssignmentHash,
      expectedDescriptorHash: input.expectedDescriptorHash,
      at: runtimeNow(input.clock),
    },
  );
  return deepFreeze({
    authorityHash: context.authority.authorityHash,
    assignmentId: context.assignment.id,
    assignmentHash: context.assignment.assignmentHash,
    descriptorHash: context.descriptor.descriptorHash,
    requestBodyHash: context.descriptor.request.requestBodyHash,
    expiresAt: context.authority.expiresAt,
    limits: context.descriptor.limits,
    priorEvidenceContextHash: context.descriptor.priorEvidenceContextHash,
  });
}

function resolvePreventureResearchExecutionDescriptor(input = {}) {
  return exactDescriptorContext(
    input.store,
    input.authorityHash,
    input.assignmentId,
    {
      expectedAssignmentHash: input.expectedAssignmentHash,
      expectedDescriptorHash: input.expectedDescriptorHash,
      at: runtimeNow(input.clock),
    },
  ).descriptor;
}

function exactReprocessContext(store, authorityHash, assignmentId, options = {}) {
  const required = [
    "getAuthority", "listAssignments", "loadLifecycle", "readLedger", "readState", "verifyLedger",
  ];
  if (!isObject(store) || required.some((name) => typeof store[name] !== "function")) {
    throw runnerError(
      "preventure_research_reprocess_store_invalid",
      "The exact immutable research store is unavailable for local recovery.",
      { statusCode: 500 },
    );
  }
  const verified = store.verifyLedger();
  const authority = store.getAuthority(authorityHash);
  const assignment = store.listAssignments(authorityHash).find((item) => item.id === assignmentId);
  const lifecycle = store.loadLifecycle(authorityHash);
  const ledger = store.readLedger(authorityHash);
  const state = store.readState(authorityHash);
  if (
    !isObject(verified)
    || verified.ok !== true
    || !isObject(authority)
    || authority.authorityHash !== authorityHash
    || !isObject(assignment)
    || assignment.authorityHash !== authorityHash
    || ledger.decision
    || !["activated", "revoked", "expired"].includes(state.state)
  ) {
    throw runnerError(
      "preventure_research_reprocess_state_invalid",
      "Local retained-output recovery requires one verified activated, revoked, or expired authority with no sealed decision.",
    );
  }
  if (options.expectedAssignmentHash && options.expectedAssignmentHash !== assignment.assignmentHash) {
    throw runnerError(
      "preventure_research_assignment_stale",
      "Refresh the retained-output recovery; its exact assignment changed.",
    );
  }
  const activationIndex = lifecycle.findIndex(
    (event) => event.eventType === "activated"
      && event.eventHash === assignment.activationEventHash,
  );
  if (activationIndex < 0) {
    throw runnerError(
      "preventure_research_activation_missing",
      "The retained-output recovery cannot find its exact activation event.",
    );
  }
  const activationEvent = lifecycle[activationIndex];
  const activationLifecycle = lifecycle.slice(0, activationIndex + 1);
  const plan = createPreventureResearchAssignmentPlan(authority, activationLifecycle);
  const storedAssignments = store.listAssignments(authorityHash);
  const executionPlan = {
    ...plan,
    assignments: plan.assignments.map((item) => {
      const stored = storedAssignments.find((candidate) => candidate.id === item.id);
      if (
        !stored
        || stored.templateHash !== item.templateHash
        || stored.taskId !== item.taskId
        || stored.workflowId !== item.workflowId
      ) {
        throw runnerError(
          "preventure_research_reprocess_assignment_set_changed",
          "The retained-output recovery assignment set changed after activation.",
        );
      }
      return { ...item, assignmentHash: stored.assignmentHash };
    }),
  };
  const planned = plan.assignments.find((item) => item.id === assignment.id);
  const template = authority.assignments.find((item) => item.id === assignment.id);
  if (
    !planned
    || !template
    || assignment.templateHash !== sha256(template)
    || planned.templateHash !== assignment.templateHash
    || planned.activationEventHash !== assignment.activationEventHash
    || planned.taskId !== assignment.taskId
    || planned.workflowId !== assignment.workflowId
    || planned.provider !== assignment.provider
    || planned.model !== assignment.model
  ) {
    throw runnerError(
      "preventure_research_reprocess_binding_invalid",
      "The retained-output recovery no longer matches the exact materialized assignment.",
    );
  }
  const priorEvidenceContext = buildPriorEvidenceContext(ledger, executionPlan, assignment);
  const descriptor = createPreventureResearchExecutionDescriptor(
    authority,
    assignment,
    template,
    activationEvent,
    priorEvidenceContext,
  );
  if (options.expectedDescriptorHash && options.expectedDescriptorHash !== descriptor.descriptorHash) {
    throw runnerError(
      "preventure_research_descriptor_stale",
      "Refresh the retained-output recovery; its exact descriptor changed.",
    );
  }
  return {
    authority,
    assignment,
    template,
    activationEvent,
    ledger,
    plan: executionPlan,
    priorEvidenceContext,
    descriptor,
    state,
  };
}

function validateRuntimeDependencies(input, options = {}) {
  const transport = input.transport;
  const claims = input.claims;
  const outputStore = input.outputStore;
  const parser = input.parser;
  if (
    options.reprocessing !== true
    && (
      transport?.kind !== EXACT_TRANSPORT_KIND
      || typeof transport.dispatch !== "function"
      || typeof transport.preflight !== "function"
    )
  ) {
    throw runnerError(
      "preventure_research_transport_invalid",
      "The reviewed exact OpenAI web-search transport is unavailable.",
      { statusCode: 500 },
    );
  }
  const claimMethods = [
    ...(options.reprocessing === true
      ? [
        "commitReprocessedEvidence",
        "commitTerminalProviderArtifactCustody",
        "commitValidatedEarlyStop",
        "inspectProviderArtifactCustody",
      ]
      : [
        "assertProviderResultClaim",
        "claim",
        "commitKnownEvidence",
        "commitTerminalProviderArtifactCustody",
        "commitValidatedEarlyStop",
        "failBeforeDispatch",
        "markDefinitePreEffectFailure",
        "markKnownNeedsAttention",
        "markKnownNeedsReprocess",
        "markKnownResultUnknownCost",
        "markProviderDispatched",
        "markUnknown",
      ]),
  ];
  if (
    claims?.kind !== EXACT_CLAIM_KIND
    || claimMethods.some((name) => typeof claims[name] !== "function")
  ) {
    throw runnerError(
      "preventure_research_claims_invalid",
      "The exact exclusive pre-venture task-claim bridge is unavailable.",
      { statusCode: 500 },
    );
  }
  if (
    outputStore?.kind !== EXACT_OUTPUT_STORE_KIND
    || (options.reprocessing !== true && typeof outputStore.retain !== "function")
    || typeof outputStore.load !== "function"
  ) {
    throw runnerError(
      "preventure_research_output_store_invalid",
      "The immutable provider-output store is unavailable.",
      { statusCode: 500 },
    );
  }
  if (parser?.kind !== EXACT_LOCAL_PARSER_KIND || typeof parser.parse !== "function") {
    throw runnerError(
      "preventure_research_parser_invalid",
      "The deterministic local research parser is unavailable.",
      { statusCode: 500 },
    );
  }
}

async function assertExactTransportPreflight(transport, descriptor) {
  const result = await transport.preflight({
    descriptor,
    request: descriptor.request,
    expectedRequestBodyHash: descriptor.request.requestBodyHash,
  });
  if (
    !isObject(result)
    || result.ready !== true
    || result.provider !== descriptor.provider
    || result.endpoint !== OFFICIAL_OPENAI_RESPONSES_URL
    || result.method !== "POST"
    || result.requestBodyHash !== descriptor.request.requestBodyHash
    || result.responseStorage !== false
    || result.background !== false
    || result.canonicalResponseRetention !== true
    || descriptor.request.localInputTokenUpperBound
      !== descriptor.request.providerVisibleInputUtf8ByteLength
    || descriptor.request.localInputTokenUpperBound
      > descriptor.limits.localPromptPreflightMaxInputTokens
    || !Number.isSafeInteger(result.estimatedInputTokens)
    || result.estimatedInputTokens < 1
    || result.estimatedInputTokens > descriptor.limits.localPromptPreflightMaxInputTokens
    || !Array.isArray(result.toolTypes)
    || result.toolTypes.length !== 1
    || result.toolTypes[0] !== "web_search"
    || !sameCanonical(result.toolConfiguration, descriptor.request.requestBody.tools)
    || !sameCanonical(result.groundingSources, [
      "web_search_call.action.sources",
      "message.output_text.annotations.url_citation",
    ])
  ) {
    throw runnerError(
      "preventure_research_transport_preflight_failed",
      "The network transport does not match the exact official, bounded, web-search-only request.",
    );
  }
  return result;
}

function validateClaim(claim, descriptor) {
  if (
    !isObject(claim)
    || typeof claim.claimToken !== "string"
    || !claim.claimToken
    || claim.exclusive !== true
    || claim.activeAssignmentsBefore !== 0
    || claim.unresolvedAssignmentsBefore !== 0
    || claim.providerAttemptsForAssignmentBefore !== 0
    || claim.assignmentHash !== descriptor.assignmentHash
    || claim.descriptorHash !== descriptor.descriptorHash
    || typeof claim.clientRequestId !== "string"
    || !/^[A-Za-z0-9._:-]{1,200}$/.test(claim.clientRequestId)
  ) {
    throw runnerError(
      "preventure_research_claim_invalid",
      "Pantheon could not obtain one exact exclusive assignment claim.",
    );
  }
  return claim;
}

async function assertProviderResultClaim(claims, context, claim) {
  let result;
  try {
    result = await claims.assertProviderResultClaim({
      claimToken: claim.claimToken,
      authorityHash: context.authority.authorityHash,
      assignmentHash: context.assignment.assignmentHash,
      descriptorHash: context.descriptor.descriptorHash,
      taskId: context.assignment.taskId,
      taskAttemptId: claim.taskAttemptId,
      clientRequestId: claim.clientRequestId,
    });
  } catch {
    throw runnerError(
      "preventure_research_late_provider_result_ignored",
      "The assignment changed or emergency stop completed while the provider was running. The late result cannot change Pantheon state.",
      { providerDispatchStarted: true, claimChanged: true },
    );
  }
  if (
    !isObject(result)
    || result.current !== true
    || result.outcomeStatus !== "provider_dispatched"
    || result.claimToken !== claim.claimToken
    || result.assignmentHash !== context.assignment.assignmentHash
    || result.descriptorHash !== context.descriptor.descriptorHash
    || result.clientRequestId !== claim.clientRequestId
  ) {
    throw runnerError(
      "preventure_research_late_provider_result_ignored",
      "The assignment changed or emergency stop completed while the provider was running. The late result cannot change Pantheon state.",
      { providerDispatchStarted: true, claimChanged: true },
    );
  }
  return result;
}

async function commitTerminalProviderArtifactCustody(
  claims,
  context,
  claim,
  retainedOutput,
  providerResult,
  recordedAt,
  options = {},
) {
  const reprocessing = options.reprocessing === true;
  const clientRequestId = claim?.clientRequestId ?? retainedOutput?.clientRequestId ?? null;
  const providerRequestId = retainedOutput?.providerRequestId ?? null;
  const providerResponseId = retainedOutput?.providerResponseId ?? null;
  const reportedProviderRequestId = providerResult?.providerRequestId ?? providerRequestId;
  const reportedProviderResponseId = providerResult?.providerResponseId ?? providerResponseId;
  if (
    !isObject(retainedOutput)
    || retainedOutput.retained !== true
    || retainedOutput.assignmentMaxCostAudCents !== context.assignment.maxCostAudCents
    || retainedOutput.authorityHash !== context.authority.authorityHash
    || retainedOutput.assignmentHash !== context.assignment.assignmentHash
    || retainedOutput.descriptorHash !== context.descriptor.descriptorHash
    || retainedOutput.requestBodyHash !== context.descriptor.request.requestBodyHash
    || retainedOutput.clientRequestId !== clientRequestId
    || providerRequestId !== reportedProviderRequestId
    || providerResponseId !== reportedProviderResponseId
    || !/^sha256:[a-f0-9]{64}$/.test(String(retainedOutput.artifactHash || ""))
    || !/^sha256:[a-f0-9]{64}$/.test(String(retainedOutput.rawProviderBodyHash || ""))
  ) {
    throw runnerError(
      "preventure_research_terminal_custody_failed",
      "The retained provider artifact could not be bound to the original terminal dispatch.",
      { providerDispatchStarted: true, providerOutcomeKnown: true },
    );
  }
  let committed;
  try {
    committed = await claims.commitTerminalProviderArtifactCustody({
      reprocessing,
      claimToken: claim?.claimToken ?? null,
      authorityHash: context.authority.authorityHash,
      assignmentHash: context.assignment.assignmentHash,
      descriptorHash: context.descriptor.descriptorHash,
      requestBodyHash: context.descriptor.request.requestBodyHash,
      taskId: context.assignment.taskId,
      taskAttemptId: claim?.taskAttemptId ?? null,
      modelCallId: claim?.modelCallId || retainedOutput.billing?.modelCallId || null,
      clientRequestId,
      providerRequestId,
      providerResponseId,
      retainedOutput,
      recordedAt,
    });
  } catch {
    throw runnerError(
      "preventure_research_terminal_custody_failed",
      "The provider artifact remains immutable, but its terminal custody marker could not be recorded.",
      { providerDispatchStarted: true, providerOutcomeKnown: true },
    );
  }
  if (
    !isObject(committed)
    || committed.status !== "terminal_provider_artifact_retained_pending_reconciliation"
    || typeof committed.created !== "boolean"
    || !isObject(committed.custodyRecord)
    || committed.authorityHash !== context.authority.authorityHash
    || committed.assignmentHash !== context.assignment.assignmentHash
    || committed.descriptorHash !== context.descriptor.descriptorHash
    || committed.retainedOutputHash !== retainedOutput.artifactHash
    || committed.retainedOutputRef !== retainedOutput.artifactRef
    || !["revoked", "expired", "emergency_stopped"].includes(committed.terminalState)
    || typeof committed.emergencyStopped !== "boolean"
    || committed.emergencyStopped !== (committed.terminalState === "emergency_stopped")
    || (options.expectedTerminalState !== undefined
      && committed.terminalState !== options.expectedTerminalState)
    || (options.expectedEmergencyStopped !== undefined
      && committed.emergencyStopped !== options.expectedEmergencyStopped)
    || committed.accountingState !== "pending_reconciliation"
    || committed.additionalAiCostAudCents !== 0
    || committed.retryAuthorized !== false
  ) {
    throw runnerError(
      "preventure_research_terminal_custody_failed",
      "The terminal provider-artifact custody result was incomplete or contradictory.",
      { providerDispatchStarted: true, providerOutcomeKnown: true },
    );
  }
  return {
    ...committed,
    retainedOutput,
    providerRequestId,
    providerResponseId,
    costAudCents: null,
    costStatus: "unknown",
    exposureAudCents: context.assignment.maxCostAudCents,
    exactBillingPending: true,
    reprocessedLocally: reprocessing,
    retryAuthorized: false,
    additionalAiCostAudCents: 0,
  };
}

async function inspectProviderArtifactCustody(claims, context, retainedOutput) {
  let inspected;
  try {
    inspected = await claims.inspectProviderArtifactCustody({
      reprocessing: true,
      claimToken: null,
      authorityHash: context.authority.authorityHash,
      assignmentHash: context.assignment.assignmentHash,
      descriptorHash: context.descriptor.descriptorHash,
      requestBodyHash: context.descriptor.request.requestBodyHash,
      taskId: context.assignment.taskId,
      taskAttemptId: null,
      modelCallId: retainedOutput.billing?.modelCallId || null,
      clientRequestId: retainedOutput.clientRequestId,
      providerRequestId: retainedOutput.providerRequestId,
      providerResponseId: retainedOutput.providerResponseId,
      retainedOutput,
    });
  } catch {
    throw runnerError(
      "preventure_research_terminal_custody_inspection_failed",
      "The retained provider artifact could not be matched to its original terminal or active recovery state.",
      { providerDispatchStarted: true, providerOutcomeKnown: true },
    );
  }
  if (
    !isObject(inspected)
    || inspected.inspected !== true
    || typeof inspected.custodyRequired !== "boolean"
    || typeof inspected.activeReprocessAllowed !== "boolean"
    || inspected.custodyRequired === inspected.activeReprocessAllowed
    || !["activated", "revoked", "expired", "emergency_stopped"]
      .includes(inspected.terminalState)
    || typeof inspected.emergencyStopped !== "boolean"
    || (inspected.custodyRequired && !["revoked", "expired", "emergency_stopped"]
      .includes(inspected.terminalState))
    || (inspected.activeReprocessAllowed && inspected.terminalState !== "activated")
    || inspected.emergencyStopped !== (inspected.terminalState === "emergency_stopped")
    || inspected.authorityHash !== context.authority.authorityHash
    || inspected.assignmentHash !== context.assignment.assignmentHash
    || inspected.descriptorHash !== context.descriptor.descriptorHash
    || inspected.requestBodyHash !== context.descriptor.request.requestBodyHash
    || inspected.taskId !== context.assignment.taskId
    || !/^[A-Za-z0-9._:-]{1,200}$/.test(String(inspected.taskAttemptId || ""))
    || !/^[A-Za-z0-9._:-]{1,200}$/.test(String(inspected.modelCallId || ""))
    || typeof inspected.claimToken !== "string"
    || !inspected.claimToken
    || inspected.clientRequestId !== retainedOutput.clientRequestId
    || inspected.providerRequestId !== retainedOutput.providerRequestId
    || inspected.providerResponseId !== retainedOutput.providerResponseId
    || inspected.retainedOutputHash !== retainedOutput.artifactHash
    || inspected.retainedOutputRef !== retainedOutput.artifactRef
    || !Number.isFinite(Date.parse(String(inspected.providerDispatchedAt || "")))
    || Date.parse(inspected.providerDispatchedAt) >= Date.parse(context.authority.expiresAt)
    || !(
      inspected.latestLifecycleEventHash === null
      || /^sha256:[a-f0-9]{64}$/.test(String(inspected.latestLifecycleEventHash || ""))
    )
  ) {
    throw runnerError(
      "preventure_research_terminal_custody_inspection_failed",
      "The retained provider-artifact custody inspection was incomplete or contradictory.",
      { providerDispatchStarted: true, providerOutcomeKnown: true },
    );
  }
  return inspected;
}

async function assertProviderResultClaimOrTerminalCustody(
  claims,
  context,
  claim,
  retainedOutput,
  providerResult,
  recordedAt,
) {
  try {
    await assertProviderResultClaim(claims, context, claim);
    return null;
  } catch (claimError) {
    if (!retainedOutput) throw claimError;
    return await commitTerminalProviderArtifactCustody(
      claims,
      context,
      claim,
      retainedOutput,
      providerResult,
      recordedAt,
    );
  }
}

function isDefinitePreEffectFailure(error, context, claim) {
  const status = Number(error?.httpStatus);
  const retained = error?.retainedOutput;
  return error?.kind === "definite_pre_effect_http_rejection"
    && error?.definitePreEffect === true
    && error?.providerOutcomeKnown === true
    && error?.costAudCents === 0
    && error?.costStatus === "estimated"
    && error?.exactBillingPending === true
    && error?.providerZeroBillingGuarantee === false
    && error?.exposureAudCents === context.assignment.maxCostAudCents
    && Number.isInteger(status)
    && status >= 400
    && status <= 499
    && ![408, 409, 429].includes(status)
    && typeof error?.providerErrorType === "string"
    && Boolean(error.providerErrorType)
    && typeof error?.providerErrorCode === "string"
    && Boolean(error.providerErrorCode)
    && isObject(retained)
    && retained.retained === true
    && retained.artifactKind === "known_pre_effect_rejection"
    && retained.assignmentMaxCostAudCents === context.assignment.maxCostAudCents
    && retained.authorityHash === context.authority.authorityHash
    && retained.assignmentHash === context.assignment.assignmentHash
    && retained.descriptorHash === context.descriptor.descriptorHash
    && retained.requestBodyHash === context.descriptor.request.requestBodyHash
    && retained.clientRequestId === claim.clientRequestId
    && retained.providerRequestId === (error.providerRequestId || null)
    && retained.providerResponseId === null
    && retained.responseMetadata?.httpStatus === status
    && retained.responseMetadata?.providerErrorType === error.providerErrorType
    && retained.responseMetadata?.providerErrorCode === error.providerErrorCode
    && sameCanonical(retained.billing, {
      currency: "AUD",
      costAudCents: 0,
      costStatus: "estimated",
      exactBillingPending: true,
      exposureAudCents: context.assignment.maxCostAudCents,
      providerZeroBillingGuarantee: false,
    });
}

function cleanProviderText(value, maximum = 2048) {
  if (value === null || value === undefined || value === "") return null;
  const text = String(value).replace(/\s+/g, " ").trim();
  return text ? text.slice(0, maximum) : null;
}

function validCompletedWebSearchCall(item) {
  if (
    !isObject(item)
    || item.type !== "web_search_call"
    || item.status !== "completed"
    || typeof item.id !== "string"
    || !item.id.trim()
  ) {
    return false;
  }
  const action = item.action;
  if (!isObject(action) || !["search", "open_page", "find_in_page"].includes(action.type)) {
    return false;
  }
  if (action.type === "search") {
    return true;
  }
  if (action.type === "open_page") {
    try {
      return Boolean(safePublicUrl(action.url));
    } catch {
      return false;
    }
  }
  try {
    return Boolean(safePublicUrl(action.url))
      && typeof action.pattern === "string"
      && action.pattern.trim().length > 0;
  } catch {
    return false;
  }
}

function exactSearchQueries(item) {
  if (!validCompletedWebSearchCall(item) || item.action.type !== "search") return [];
  const values = [
    ...(typeof item.action.query === "string" ? [item.action.query] : []),
    ...(Array.isArray(item.action.queries) ? item.action.queries : []),
  ].map((value) => cleanProviderText(value, 1000)).filter(Boolean);
  return [...new Set(values)].sort();
}

function providerWebSearchTruth(response) {
  const observed = (response?.output || []).filter((item) => item?.type === "web_search_call");
  const completedValid = observed.filter(validCompletedWebSearchCall);
  const completedSearchAttempts = completedValid.filter((item) => exactSearchQueries(item).length > 0);
  return {
    observed,
    completedValid,
    completedSearchAttempts,
  };
}

function providerGrounding(response, webTruth = providerWebSearchTruth(response)) {
  const byUrl = new Map();
  const issues = new Set();
  const validCallSourceUrls = new Set();
  const add = (source, provenance) => {
    if (!isObject(source) || !source.url || !PUBLIC_GROUNDING_TYPES.has(provenance)) return;
    let url;
    try {
      url = safePublicUrl(source.url);
    } catch {
      issues.add("unsafe_grounding_url");
      return;
    }
    const current = byUrl.get(url) || {
      url,
      provenance: [],
      titles: [],
      publishers: [],
      snippets: [],
      publishedAtValues: [],
    };
    current.provenance.push(provenance);
    const title = cleanProviderText(source.title, 300);
    const publisher = cleanProviderText(source.publisher, 200);
    const snippet = cleanProviderText(source.snippet, 800);
    const publishedAt = cleanProviderText(source.published_at || source.publishedAt, 80);
    if (title) current.titles.push(title);
    if (publisher) current.publishers.push(publisher);
    if (snippet) current.snippets.push(snippet);
    if (publishedAt) current.publishedAtValues.push(publishedAt);
    current.provenance = [...new Set(current.provenance)].sort();
    current.titles = [...new Set(current.titles)].sort();
    current.publishers = [...new Set(current.publishers)].sort();
    current.snippets = [...new Set(current.snippets)].sort();
    current.publishedAtValues = [...new Set(current.publishedAtValues)].sort();
    byUrl.set(url, current);
  };
  for (const item of webTruth.completedValid) {
    if (item.action?.sources) {
      for (const source of item.action?.sources || []) {
        add(source, "web_search_action_source");
        try {
          validCallSourceUrls.add(safePublicUrl(source?.url));
        } catch {
          issues.add("unsafe_grounding_url");
        }
      }
    }
  }
  for (const item of response.output || []) {
    if (item?.type !== "message" || item.status !== "completed") continue;
    for (const part of item.content || []) {
      for (const annotation of part.annotations || []) {
        if (annotation?.type !== "url_citation") continue;
        let url;
        try {
          url = safePublicUrl(annotation.url);
        } catch {
          issues.add("unsafe_grounding_url");
          continue;
        }
        if (!validCallSourceUrls.has(url)) {
          issues.add("citation_not_bound_to_completed_web_call");
          continue;
        }
        add(annotation, "url_citation");
      }
    }
  }
  return {
    sources: [...byUrl.values()].sort((left, right) => left.url.localeCompare(right.url)),
    issues: [...issues].sort(),
  };
}

function providerOutput(response) {
  const texts = [];
  const refusals = [];
  for (const item of response.output || []) {
    if (item?.type !== "message" || item.status !== "completed") continue;
    for (const part of item.content || []) {
      if (part?.type === "output_text" && typeof part.text === "string" && part.text.trim()) {
        texts.push(part.text);
      }
      if (part?.type === "refusal" || typeof part?.refusal === "string") {
        refusals.push(cleanProviderText(part.refusal || part.text || "Provider refusal", 1000));
      }
    }
  }
  return { texts, refusals: refusals.filter(Boolean) };
}

function deriveKnownEffectInvalidResponseIssues(input = {}) {
  const descriptor = input.descriptor;
  const rawProviderBody = input.rawProviderBody;
  const httpStatus = Number(input.httpStatus);
  const providerRequestId = input.providerRequestId ?? null;
  const providerRequestIdInvalid = input.providerRequestIdInvalid;
  if (
    typeof rawProviderBody !== "string"
    || !Number.isSafeInteger(httpStatus)
    || !(
      (httpStatus >= 200 && httpStatus <= 299)
      || (httpStatus >= 400 && httpStatus <= 499)
    )
    || !isObject(descriptor)
    || typeof descriptor.model !== "string"
    || !isObject(descriptor.limits)
    || !Number.isSafeInteger(descriptor.limits.maxInputTokens)
    || !Number.isSafeInteger(descriptor.limits.maximumModelPasses)
    || !Number.isSafeInteger(descriptor.limits.maxOutputTokens)
    || !Number.isSafeInteger(descriptor.limits.maxToolCalls)
    || typeof providerRequestIdInvalid !== "boolean"
    || !optionalProviderRequestId(providerRequestId)
    || (providerRequestIdInvalid && providerRequestId !== null)
  ) {
    throw runnerError(
      "preventure_research_invalid_issue_derivation_input",
      "Known-effect issue derivation requires one exact response and reviewed descriptor.",
      { providerDispatchStarted: true, providerOutcomeKnown: true },
    );
  }
  let payload = null;
  let payloadJsonParsed = false;
  try {
    payload = JSON.parse(rawProviderBody);
    payloadJsonParsed = true;
  } catch {}
  if (httpStatus >= 400) {
    const errorEnvelope = payloadJsonParsed && isObject(payload) && isObject(payload.error)
      ? payload.error
      : null;
    const providerErrorType = cleanProviderText(errorEnvelope?.type, 200);
    return Object.freeze([...new Set([
      `provider_http_${httpStatus}`,
      ...(providerRequestIdInvalid ? ["provider_request_id_invalid"] : []),
      ...(!payloadJsonParsed ? ["response_json_invalid"] : []),
      ...(payloadJsonParsed && !isObject(payload) ? ["response_shape_invalid"] : []),
      ...(!providerErrorType ? ["provider_error_type_missing"] : []),
    ])].sort());
  }
  const providerResponseId = isObject(payload)
    && /^[A-Za-z0-9._:-]{1,200}$/.test(String(payload.id || ""))
    ? String(payload.id)
    : null;
  const usage = payload?.usage;
  const inputTokens = Number(usage?.input_tokens);
  const outputTokens = Number(usage?.output_tokens);
  const totalTokens = Number(usage?.total_tokens);
  const maximumInput = descriptor.limits.maxInputTokens
    * descriptor.limits.maximumModelPasses;
  const usageValid = Number.isSafeInteger(inputTokens)
    && inputTokens >= 0
    && inputTokens <= maximumInput
    && Number.isSafeInteger(outputTokens)
    && outputTokens >= 0
    && outputTokens <= descriptor.limits.maxOutputTokens
    && Number.isSafeInteger(totalTokens)
    && totalTokens === inputTokens + outputTokens;
  const webSearchCalls = Array.isArray(payload?.output)
    ? payload.output.filter((item) => item?.type === "web_search_call").length
    : 0;
  return Object.freeze([...new Set([
    ...(providerRequestIdInvalid ? ["provider_request_id_invalid"] : []),
    ...(!payloadJsonParsed ? ["response_json_invalid"] : []),
    ...(payloadJsonParsed && !isObject(payload) ? ["response_shape_invalid"] : []),
    ...(isObject(payload) && payload.object !== "response" ? ["response_object_invalid"] : []),
    ...(!providerResponseId ? ["provider_response_id_missing"] : []),
    ...(isObject(payload) && payload.model !== descriptor.model ? ["provider_model_changed"] : []),
    ...(!Array.isArray(payload?.output) ? ["provider_output_invalid"] : []),
    ...(!usageValid ? ["provider_usage_unknown"] : []),
    ...(webSearchCalls > descriptor.limits.maxToolCalls ? ["web_search_limit_exceeded"] : []),
  ])].sort());
}

function normalizePreventureProviderResponse(response) {
  const webTruth = providerWebSearchTruth(response);
  const grounding = providerGrounding(response, webTruth);
  const output = providerOutput(response);
  const issues = [];
  if (response?.status !== "completed") issues.push("response_not_completed");
  if (response?.incomplete_details) issues.push("response_incomplete");
  if (output.refusals.length > 0) issues.push("provider_refusal");
  if (output.texts.length !== 1) issues.push("structured_output_missing_or_ambiguous");
  if (webTruth.observed.length < 1) issues.push("web_search_not_used");
  if (webTruth.completedValid.length !== webTruth.observed.length) {
    issues.push("web_search_call_incomplete_or_invalid");
  }
  if (grounding.sources.length < 1) issues.push("provider_grounding_missing");
  issues.push(...grounding.issues);
  return {
    grounding,
    output,
    webTruth,
    issues: [...new Set(issues)].sort(),
  };
}

function optionalProviderRequestId(value) {
  return value === null
    || (typeof value === "string" && /^[A-Za-z0-9._:-]{1,200}$/.test(value));
}

function optionalProviderResponseId(value) {
  return value === null
    || (typeof value === "string" && /^[A-Za-z0-9._:-]{1,200}$/.test(value));
}

function validateKnownEffectInvalidResult(result, descriptor, expectedClientRequestId) {
  const costKnown = Number.isSafeInteger(result?.costAudCents)
    && result.costAudCents >= 0
    && result.costAudCents <= descriptor.limits.maxCostAudCents;
  let parsedRaw = null;
  let rawJsonParsed = false;
  if (typeof result?.rawProviderBody === "string") {
    try {
      parsedRaw = JSON.parse(result.rawProviderBody);
      rawJsonParsed = true;
    } catch {}
  }
  const responseId = rawJsonParsed
    && isObject(parsedRaw)
    && /^[A-Za-z0-9._:-]{1,200}$/.test(String(parsedRaw.id || ""))
    ? String(parsedRaw.id)
    : null;
  if (
    !isObject(result)
    || result.outcomeStatus !== "known_effect_invalid"
    || result.provider !== descriptor.provider
    || result.model !== descriptor.model
    || result.endpoint !== OFFICIAL_OPENAI_RESPONSES_URL
    || result.requestBodyHash !== descriptor.request.requestBodyHash
    || result.clientRequestId !== expectedClientRequestId
    || !Number.isInteger(result.httpStatus)
    || !(
      (result.httpStatus >= 200 && result.httpStatus <= 299)
      || (result.httpStatus >= 400 && result.httpStatus <= 499)
    )
    || !optionalProviderRequestId(result.providerRequestId)
    || !optionalProviderResponseId(result.providerResponseId)
    || result.providerResponseJsonParsed !== rawJsonParsed
    || !sameCanonical(result.providerResponse, rawJsonParsed ? parsedRaw : null)
    || result.providerResponseHash !== (rawJsonParsed ? sha256(parsedRaw) : null)
    || responseId !== result.providerResponseId
    || result.providerRequestId === expectedClientRequestId
    || result.providerResponseId === expectedClientRequestId
    || (result.providerRequestId !== null
      && result.providerRequestId === result.providerResponseId)
    || typeof result.rawProviderBody !== "string"
    || result.rawProviderBodyHash !== sha256(result.rawProviderBody)
    || !Array.isArray(result.issues)
    || result.issues.length < 1
    || result.issues.some((issue) => typeof issue !== "string" || !issue.trim())
    || (costKnown && !["estimated", "incurred", "reconciled"].includes(result.costStatus))
    || (!costKnown && (result.costAudCents !== null || result.costStatus !== "unknown"))
  ) {
    throw runnerError(
      "preventure_research_known_effect_invalid_envelope",
      "A known provider effect could not be bound to one exact malformed 2xx response artifact.",
      { providerDispatchStarted: true, providerOutcomeKnown: true },
    );
  }
  return {
    ...result,
    costKnown,
    providerResponseHash: rawJsonParsed ? sha256(parsedRaw) : null,
    issues: [...new Set(result.issues.map((issue) => issue.trim()))].sort(),
  };
}

function validateTransportResult(result, descriptor, expectedClientRequestId) {
  if (
    !isObject(result)
    || result.outcomeStatus !== "known"
    || !optionalProviderRequestId(result.providerRequestId)
    || typeof result.providerResponseId !== "string"
    || !/^[A-Za-z0-9._:-]{1,200}$/.test(result.providerResponseId)
    || result.provider !== descriptor.provider
    || result.model !== descriptor.model
    || result.endpoint !== OFFICIAL_OPENAI_RESPONSES_URL
    || result.requestBodyHash !== descriptor.request.requestBodyHash
    || result.clientRequestId !== expectedClientRequestId
    || result.providerRequestId === expectedClientRequestId
    || result.providerResponseId === expectedClientRequestId
    || (result.providerRequestId !== null
      && result.providerRequestId === result.providerResponseId)
    || !isObject(result.providerResponse)
    || result.providerResponse.id !== result.providerResponseId
    || result.providerResponse.model !== descriptor.model
    || !Array.isArray(result.providerResponse.output)
  ) {
    throw runnerError(
      "preventure_research_provider_outcome_unknown",
      "The provider did not return one exact canonical known response.",
      { providerDispatchStarted: true },
    );
  }
  if (
    !Number.isSafeInteger(result.costAudCents)
    || result.costAudCents < 0
    || result.costAudCents > descriptor.limits.maxCostAudCents
  ) {
    throw runnerError(
      "preventure_research_provider_cost_unknown",
      "The provider result has an unknown or out-of-scope cost.",
      { providerDispatchStarted: true, providerOutcomeKnown: true },
    );
  }
  const webSearchCalls = result.providerResponse.output.filter(
    (item) => item?.type === "web_search_call",
  );
  const normalized = normalizePreventureProviderResponse(result.providerResponse);
  const webTruth = normalized.webTruth;
  if (
    !Number.isSafeInteger(result.toolCallCount)
    || result.toolCallCount !== webSearchCalls.length
    || result.toolCallCount > descriptor.limits.maxToolCalls
  ) {
    throw runnerError(
      "preventure_research_provider_outcome_unknown",
      "The retained response and transport disagree on exact web-search usage.",
      { providerDispatchStarted: true },
    );
  }
  const { grounding, output, issues } = normalized;
  if (result.rawProviderBody !== undefined && result.rawProviderBody !== null) {
    let parsedRaw;
    try {
      parsedRaw = JSON.parse(result.rawProviderBody);
    } catch {
      throw runnerError(
        "preventure_research_provider_raw_body_invalid",
        "The exact raw provider body does not contain the canonical known response.",
        { providerDispatchStarted: true, providerOutcomeKnown: true },
      );
    }
    if (
      typeof result.rawProviderBody !== "string"
      || result.rawProviderBodyHash !== sha256(result.rawProviderBody)
      || !sameCanonical(parsedRaw, result.providerResponse)
    ) {
      throw runnerError(
        "preventure_research_provider_raw_body_changed",
        "The exact raw provider body and canonical response do not match.",
        { providerDispatchStarted: true, providerOutcomeKnown: true },
      );
    }
  }
  return {
    ...result,
    output: output.texts.length === 1 ? output.texts[0] : null,
    providerResponseHash: sha256(result.providerResponse),
    groundedSources: grounding.sources,
    groundedSourceSetHash: sha256(grounding.sources),
    webSearchTruth: {
      observedWebSearchCallCount: webTruth.observed.length,
      completedValidWebSearchCallCount: webTruth.completedValid.length,
      completedValidSearchAttemptCount: webTruth.completedSearchAttempts.length,
      completedSearchAttempts: webTruth.completedSearchAttempts.map((item) => ({
        id: cleanProviderText(item.id, 200),
        status: item.status,
        actionType: item.action.type,
        queries: exactSearchQueries(item),
        sourceUrls: [...new Set((item.action.sources || []).map((source) => {
          try {
            return safePublicUrl(source?.url);
          } catch {
            return null;
          }
        }).filter(Boolean))].sort(),
      })),
    },
    responseIssues: [...new Set(issues)].sort(),
  };
}

function safePublicUrl(value) {
  if (!value) return null;
  return canonicalPublicResearchUrl(value).canonicalUrl;
}

function failKnownEvidence(code, message) {
  throw runnerError(code, message, {
    providerDispatchStarted: true,
    providerOutcomeKnown: true,
  });
}

function exactObjectKeys(value, expected) {
  return isObject(value)
    && sameCanonical(Object.keys(value).sort(), [...expected].sort());
}

const EVIDENCE_DETAIL_KEYS = Object.freeze([
  "comparator",
  "buyerEvidence",
  "formatCase",
  "channelCase",
  "economicsCase",
  "readinessGate",
  "recommendation",
]);

function validateDecisionDetailBinding(context, evidence, source) {
  const details = evidence.details;
  const nonNull = EVIDENCE_DETAIL_KEYS.filter((key) => details[key] !== null);
  const criterionId = evidence.criterionId;
  let expectedDetail = null;
  if (criterionId?.startsWith("format_case:")) expectedDetail = "formatCase";
  if (criterionId?.startsWith("channel_case:")) expectedDetail = "channelCase";
  if (criterionId?.startsWith("economics_case:")) expectedDetail = "economicsCase";
  if (criterionId?.startsWith("readiness_gate:")) expectedDetail = "readinessGate";
  const assignmentOneEvidence = context.assignment.id === "comparator_and_buyer_evidence"
    && nonNull.length <= 2
    && nonNull.every((key) => ["comparator", "buyerEvidence"].includes(key));
  const independentRecommendation = context.assignment.id === "independent_readiness_review"
    && sameCanonical(nonNull, ["recommendation"]);
  if (
    (expectedDetail && (nonNull.length !== 1 || nonNull[0] !== expectedDetail))
    || (!expectedDetail && nonNull.length > 0
      && !assignmentOneEvidence && !independentRecommendation)
  ) {
    failKnownEvidence(
      "preventure_research_case_detail_mismatch",
      "Evidence criterion and exact structured case details do not match.",
    );
  }
  if (details.buyerEvidence) {
    const item = details.buyerEvidence;
    const kinds = [
      "consequence",
      "workaround_or_spending_trigger",
      "purchaser_attributable_behaviour",
    ];
    if (
      context.assignment.id !== "comparator_and_buyer_evidence"
      || !exactObjectKeys(item, [
        "kind", "independenceGroup", "paidOfferId",
        "sellerOrPublisherId", "exactWorkflowRelevance",
      ])
      || !kinds.includes(item.kind)
      || typeof item.exactWorkflowRelevance !== "boolean"
      || evidence.truthClass !== "model_inference"
      || evidence.polarity !== "supporting"
      || source?.captureStatus !== "partial"
      || (item.kind === "purchaser_attributable_behaviour" && !item.paidOfferId)
      || (item.kind !== "purchaser_attributable_behaviour" && item.paidOfferId !== null)
      || (item.kind === "purchaser_attributable_behaviour" && (
        !source?.offerIdentityKey
        || !source?.sellerIdentityKey
        || item.paidOfferId !== source.offerIdentityKey
        || item.sellerOrPublisherId !== source.sellerIdentityKey
        || item.independenceGroup !== source.sellerIdentityKey
      ))
      || (item.kind !== "purchaser_attributable_behaviour" && (
        !["public_practitioner_discussion", "established_professional_or_industry_material"]
          .includes(source?.sourceClass)
        || item.independenceGroup !== source.buyerIndependenceGroup
        || item.sellerOrPublisherId !== source.publisherIdentityKey
      ))
    ) {
      failKnownEvidence(
        "preventure_research_buyer_evidence_invalid",
        "Buyer and direct-demand evidence must be one exact captured attributable signal.",
      );
    }
    boundedText(item.independenceGroup, "Buyer-evidence independence group", 128, {
      providerDispatchStarted: true, providerOutcomeKnown: true,
    });
    boundedText(item.sellerOrPublisherId, "Buyer-evidence seller or publisher", 128, {
      providerDispatchStarted: true, providerOutcomeKnown: true,
    });
    if (item.paidOfferId) {
      boundedText(item.paidOfferId, "Buyer-evidence paid offer", 128, {
        providerDispatchStarted: true, providerOutcomeKnown: true,
      });
    }
  }
  if (details.formatCase) {
    const item = details.formatCase;
    if (
      !exactObjectKeys(item, ["id", "disposition"])
      || !context.authority.formats.includes(item.id)
      || !["retain", "revise", "reject"].includes(item.disposition)
      || criterionId !== `format_case:${item.id}`
    ) failKnownEvidence("preventure_research_format_case_invalid", "A format case is outside the exact comparison.");
  }
  if (details.channelCase) {
    const item = details.channelCase;
    const states = [
      "available", "conditional_unverified", "conditionally_preferred",
      "discovery_only", "not_selected", "not_verified",
      "protected_verification_required", "recommended", "rejected", "research_more",
    ];
    if (
      !exactObjectKeys(item, ["id", "state"])
      || !context.authority.channelCases.includes(item.id)
      || !states.includes(item.state)
      || criterionId !== `channel_case:${item.id}`
      || (["etsy", "gumroad"].includes(item.id)
        && source?.marketplaceChannelId !== item.id)
    ) failKnownEvidence("preventure_research_channel_case_invalid", "A channel case is outside the exact comparison.");
  }
  if (details.economicsCase) {
    const item = details.economicsCase;
    if (
      !exactObjectKeys(item, [
        "channelId", "priceAudCents", "state",
        "estimatedNetCashContributionAudCents", "unknownCosts",
      ])
      || !context.authority.channelCases.includes(item.channelId)
      || !context.authority.priceCasesAudCents.includes(item.priceAudCents)
      || !["estimated", "known_zero", "unknown", "not_applicable"].includes(item.state)
      || !Array.isArray(item.unknownCosts)
      || new Set(item.unknownCosts).size !== item.unknownCosts.length
      || criterionId !== `economics_case:${item.channelId}:${item.priceAudCents}`
      || (["etsy", "gumroad"].includes(item.channelId)
        && source?.marketplaceChannelId !== item.channelId)
      || (["unknown", "not_applicable"].includes(item.state)
        && item.estimatedNetCashContributionAudCents !== null)
      || (!["unknown", "not_applicable"].includes(item.state)
        && !Number.isSafeInteger(item.estimatedNetCashContributionAudCents))
      || (item.state === "known_zero" && item.estimatedNetCashContributionAudCents !== 0)
      || (item.state === "unknown" && item.unknownCosts.length < 1)
      || (item.channelId === "retain_cash" && (
        item.state !== "known_zero"
        || item.estimatedNetCashContributionAudCents !== 0
        || item.unknownCosts.length !== 0
      ))
    ) failKnownEvidence("preventure_research_economics_case_invalid", "An economics case invents or changes cash truth.");
  }
  if (details.readinessGate) {
    const item = details.readinessGate;
    const statuses = [
      "supported", "partially_supported", "unresolved", "contradicted",
      "owner_input_recorded", "protected_verification_required",
    ];
    if (
      !exactObjectKeys(item, ["id", "required", "status"])
      || !READINESS_GATE_IDS.includes(item.id)
      || item.required !== true
      || !statuses.includes(item.status)
      || criterionId !== `readiness_gate:${item.id}`
    ) failKnownEvidence("preventure_research_readiness_gate_invalid", "A readiness gate is outside the exact required set.");
  }
  if (details.recommendation) {
    const item = details.recommendation;
    if (
      context.assignment.id !== "independent_readiness_review"
      || criterionId !== null
      || !source
      || !exactObjectKeys(item, [
        "outcome", "summary", "buyer", "problem", "offer", "channel",
        "priceOrMargin", "evidenceStandard", "nextMoneyMove",
        "reviseOrStopCriteria", "materialContradictions", "limitations",
      ])
      || !context.authority.allowedOutcomes.includes(item.outcome)
      || !Array.isArray(item.reviseOrStopCriteria)
      || item.reviseOrStopCriteria.length < 1
      || !Array.isArray(item.materialContradictions)
      || !Array.isArray(item.limitations)
      || item.limitations.length < 1
    ) failKnownEvidence("preventure_research_recommendation_invalid", "The independent recommendation is incomplete or outside the allowed outcomes.");
  }
}

function structuredCaseMap(rows, detailKey, identity) {
  const result = new Map();
  for (const row of rows) {
    const value = row.details[detailKey];
    if (!value) continue;
    const key = identity(value);
    const prior = result.get(key);
    if (prior && !sameCanonical(prior, value)) {
      failKnownEvidence(
        "preventure_research_case_conflict",
        `Structured case ${key} has conflicting retained details.`,
      );
    }
    result.set(key, value);
  }
  return result;
}

function sortedCaseValues(map) {
  return [...map.entries()].sort(([left], [right]) => left.localeCompare(right))
    .map(([, value]) => value);
}

function validateStructuredDecisionEvidence(context, parsed, evidenceRows) {
  if (context.assignment.id === "format_channel_and_economics") {
    const formatMap = structuredCaseMap(evidenceRows, "formatCase", (item) => item.id);
    const channelMap = structuredCaseMap(evidenceRows, "channelCase", (item) => item.id);
    const economicsMap = structuredCaseMap(
      evidenceRows,
      "economicsCase",
      (item) => `${item.channelId}:${item.priceAudCents}`,
    );
    const topEconomics = new Map((parsed.economicsCases || []).map((item) => [
      `${item.channelId}:${item.priceAudCents}`,
      item,
    ]));
    if (
      !sameCanonical(
        [...formatMap.values()].sort((left, right) => left.id.localeCompare(right.id)),
        [...(parsed.formatCases || [])].sort((left, right) => left.id.localeCompare(right.id)),
      )
      || !sameCanonical(
        [...channelMap.values()].sort((left, right) => left.id.localeCompare(right.id)),
        [...(parsed.channelCases || [])].sort((left, right) => left.id.localeCompare(right.id)),
      )
      || economicsMap.size !== topEconomics.size
    ) {
      failKnownEvidence(
        "preventure_research_structured_case_mismatch",
        "The structured format, channel, or economics sections do not match their retained evidence details.",
      );
    }
    for (const [key, detail] of economicsMap) {
      const top = topEconomics.get(key);
      if (!top) {
        failKnownEvidence(
          "preventure_research_structured_case_mismatch",
          `Economics case ${key} is missing from the structured output.`,
        );
      }
      const { evidenceRefs, ...topDetail } = top;
      const expectedRefs = evidenceRows
        .filter((row) => sameCanonical(row.details.economicsCase, detail))
        .map((row) => row.providerEvidenceId)
        .sort();
      if (!sameCanonical(topDetail, detail) || !sameCanonical([...evidenceRefs].sort(), expectedRefs)) {
        failKnownEvidence(
          "preventure_research_structured_case_mismatch",
          `Economics case ${key} does not match its exact evidence references.`,
        );
      }
    }
  }
  if (context.assignment.id === "independent_readiness_review") {
    const gateMap = structuredCaseMap(evidenceRows, "readinessGate", (item) => item.id);
    const recommendations = evidenceRows
      .map((row) => row.details.recommendation)
      .filter(Boolean);
    if (
      !sameCanonical(
        sortedCaseValues(gateMap),
        [...(parsed.readinessGates || [])].sort((left, right) => left.id.localeCompare(right.id)),
      )
      || recommendations.length !== 1
      || !sameCanonical(recommendations[0], parsed.recommendation)
      || !sameCanonical(parsed.recommendation?.materialContradictions, parsed.materialContradictions)
      || !sameCanonical(parsed.recommendation?.reviseOrStopCriteria, parsed.whatWouldReverseDecision)
      || !sameCanonical(parsed.recommendation?.limitations, parsed.limitations)
    ) {
      failKnownEvidence(
        "preventure_research_recommendation_mismatch",
        "The independent recommendation, readiness gates, contradictions, reversal criteria, or limitations are not exactly retained in evidence.",
      );
    }
  }
}

function assignmentOneCoverage(context, evidenceRows, sourceRows) {
  const comparators = new Map();
  for (const evidence of evidenceRows) {
    const comparator = evidence.details.comparator;
    if (!comparator) continue;
    if (comparators.has(comparator.id)) {
      failKnownEvidence(
        "preventure_research_comparator_duplicate",
        `Comparator offer ${comparator.id} appears more than once.`,
      );
    }
    comparators.set(comparator.id, { comparator, evidence });
  }
  const observed = [...comparators.values()];
  const accepted = observed.filter(({ comparator }) => comparator.sellerId !== null);
  const values = accepted.map(({ comparator }) => comparator);
  const scope = context.authority.comparatorScope;
  if (observed.length > scope.maximumOffers) {
    failKnownEvidence(
      "preventure_research_comparator_scope_exceeded",
      "The provider returned more unique comparator offers than the immutable authority permits.",
    );
  }
  const categoryCount = (category) => values.filter((item) => item.category === category).length;
  const sellerCounts = new Map();
  for (const item of values) {
    sellerCounts.set(item.sellerId, (sellerCounts.get(item.sellerId) || 0) + 1);
  }
  if (Math.max(0, ...sellerCounts.values()) > scope.acceptedOffersPerSellerMaximum) {
    failKnownEvidence(
      "preventure_research_comparator_seller_scope_exceeded",
      "One server-bound seller exceeds the immutable accepted-offers-per-seller maximum.",
    );
  }
  const reviewObservationCount = values.reduce(
    (sum, item) => sum + item.reviewObservationCount,
    0,
  );
  if (reviewObservationCount > scope.reviewObservationMaximum) {
    failKnownEvidence(
      "preventure_research_review_scope_exceeded",
      "Retained comparator review observations exceed the immutable authority maximum.",
    );
  }
  const buyerRows = evidenceRows.map((item) => ({
    evidence: item,
    signal: item.details.buyerEvidence,
    source: sourceRows.find((source) => source.providerSourceId === item.sourceId) || null,
  })).filter((item) => item.signal);
  const inferredBuyerSignals = buyerRows.map((item) => item.signal);
  const decisionGradeBuyerRows = buyerRows.filter((item) => (
    item.source?.captureStatus === "captured"
    && item.evidence.truthClass === "observed_fact"
  ));
  const buyerSignals = decisionGradeBuyerRows.map((item) => item.signal);
  const buyerGroups = new Set(buyerSignals.map((item) => item.independenceGroup));
  const consequences = buyerSignals.filter((item) => item.kind === "consequence");
  const workarounds = buyerSignals.filter(
    (item) => item.kind === "workaround_or_spending_trigger",
  );
  const inferredPurchaserSignals = buyerRows.filter(
    (item) => item.signal.kind === "purchaser_attributable_behaviour",
  );
  const purchaserSignals = decisionGradeBuyerRows
    .filter((item) => item.signal.kind === "purchaser_attributable_behaviour")
    .map((item) => item.signal);
  const paidOfferIds = new Set(purchaserSignals.map((item) => item.paidOfferId));
  const purchaserSellers = new Set(
    purchaserSignals.map((item) => item.sellerOrPublisherId),
  );
  const sourceClassCounts = new Map();
  for (const source of sourceRows) {
    sourceClassCounts.set(source.sourceClass, (sourceClassCounts.get(source.sourceClass) || 0) + 1);
  }
  const gaps = [];
  const minimum = (id, subjectId, requiredCount, actualCount) => {
    if (actualCount < requiredCount) {
      gaps.push({
        id,
        subjectId,
        comparison: "minimum",
        requiredCount,
        actualCount,
        constraint: "insufficient_relevant_public_evidence",
        reasonCode: `${id}_below_minimum`,
        technicalReason: "The exact server-validated retained batch did not meet this minimum.",
      });
    }
  };
  minimum("comparator_count", null, scope.minimumOffers, values.length);
  minimum("comparator_category", "direct_or_near_direct", scope.directOrNearDirectMinimum, categoryCount("direct_or_near_direct"));
  minimum("comparator_category", "adjacent", scope.adjacentMinimum, categoryCount("adjacent"));
  minimum("comparator_category", "indirect", scope.indirectMinimum, categoryCount("indirect"));
  for (const formatId of context.authority.formats) {
    minimum(
      "format_coverage",
      formatId,
      scope.minimumPerApprovedFormat,
      values.filter((item) => item.formatIds.includes(formatId)).length,
    );
  }
  minimum(
    "channel_coverage",
    "etsy",
    1,
    observed.some(({ comparator }) => comparator.channelId === "etsy") ? 1 : 0,
  );
  minimum(
    "channel_coverage",
    "gumroad",
    1,
    observed.some(({ comparator }) => comparator.channelId === "gumroad") ? 1 : 0,
  );
  minimum("buyer_signal_count", null, 6, buyerSignals.length);
  minimum("buyer_independence_group_count", null, 3, buyerGroups.size);
  minimum("buyer_consequence_count", null, 3, consequences.length);
  minimum("buyer_workaround_trigger_count", null, 2, workarounds.length);
  minimum("purchaser_signal_count", null, 6, purchaserSignals.length);
  minimum("paid_offer_count", null, 3, paidOfferIds.size);
  minimum("purchaser_seller_count", null, 2, purchaserSellers.size);
  minimum(
    "exact_workflow_signal_count",
    null,
    3,
    purchaserSignals.filter((item) => item.exactWorkflowRelevance).length,
  );
  for (const sourceClass of context.template.requiredSourceClasses) {
    minimum("required_source_class", sourceClass, 1, sourceClassCounts.get(sourceClass) || 0);
  }
  return {
    gaps: gaps.sort((left, right) => (
      `${left.id}:${left.subjectId || ""}`.localeCompare(`${right.id}:${right.subjectId || ""}`)
    )),
    metrics: {
      comparatorCount: observed.length,
      decisionGradeComparatorCount: values.length,
      comparatorIds: observed.map(({ comparator }) => comparator.id).sort(),
      decisionGradeComparatorIds: values.map((item) => item.id).sort(),
      comparatorBindings: observed.map(({ comparator, evidence }) => {
        const source = sourceRows.find((item) => item.providerSourceId === evidence.sourceId);
        return {
          providerEvidenceId: evidence.providerEvidenceId,
          providerSourceId: evidence.sourceId,
          sourceIdentityHash: source?.sourceIdentityHash || null,
          marketplaceChannelId: source?.marketplaceChannelId || null,
          offerIdentityKey: source?.offerIdentityKey || null,
          sellerIdentityKey: source?.sellerIdentityKey || null,
          accepted: comparator.sellerId !== null,
        };
      }).sort((left, right) => String(left.offerIdentityKey).localeCompare(String(right.offerIdentityKey))),
      sourceIds: sourceRows.map((item) => item.providerSourceId).sort(),
      sourceIdentityHashes: sourceRows.map((item) => item.sourceIdentityHash).filter(Boolean).sort(),
      sourceClassCounts: Object.fromEntries([...sourceClassCounts.entries()].sort()),
      buyerSignalCount: buyerSignals.length,
      inferredBuyerSignalCount: inferredBuyerSignals.length,
      buyerIndependenceGroupCount: buyerGroups.size,
      purchaserSignalCount: purchaserSignals.length,
      inferredPurchaserSignalCount: inferredPurchaserSignals.length,
      paidOfferCount: paidOfferIds.size,
      purchaserSellerCount: purchaserSellers.size,
      reviewObservationCount,
      contraryEvidenceCount: evidenceRows.filter((item) => item.polarity === "contrary").length,
    },
  };
}

function unusedModelCoverageDeclaration(context, parsed, derived, sourceRows) {
  const status = parsed.coverageStatus;
  const declaredGaps = parsed.coverageGaps;
  const attempts = parsed.sourceAttempts;
  const nextAction = parsed.nextEvidenceAction;
  if (
    !["complete", "insufficient_evidence"].includes(status)
    || !Array.isArray(declaredGaps)
    || !Array.isArray(attempts)
    || attempts.length < 2
    || attempts.length > 20
    || (status === "insufficient_evidence" && context.assignment.id !== "comparator_and_buyer_evidence")
    || (status === "complete" && derived.gaps.length !== 0)
    || (status === "insufficient_evidence" && derived.gaps.length === 0)
    || (status === "complete" && nextAction !== null)
    || (status === "insufficient_evidence" && !isObject(nextAction))
  ) {
    failKnownEvidence(
      "preventure_research_coverage_status_invalid",
      "Coverage status does not match the server-derived evidence thresholds.",
    );
  }
  const expectedByKey = new Map(derived.gaps.map((gap) => [
    `${gap.id}:${gap.subjectId || ""}`,
    gap,
  ]));
  const normalizedGaps = [];
  const seenGaps = new Set();
  for (const gap of declaredGaps) {
    const key = `${gap?.id}:${gap?.subjectId || ""}`;
    const expected = expectedByKey.get(key);
    if (
      !exactObjectKeys(gap, [
        "id", "subjectId", "comparison", "requiredCount", "actualCount",
        "constraint", "reason",
      ])
      || !expected
      || seenGaps.has(key)
      || gap.comparison !== expected.comparison
      || gap.requiredCount !== expected.requiredCount
      || gap.actualCount !== expected.actualCount
    ) {
      failKnownEvidence(
        "preventure_research_coverage_gap_changed",
        "A declared coverage gap does not match the exact retained batch.",
      );
    }
    seenGaps.add(key);
    normalizedGaps.push({
      ...expected,
      constraint: gap.constraint,
      reason: boundedText(gap.reason, "Coverage gap reason", 500, {
        providerDispatchStarted: true, providerOutcomeKnown: true,
      }),
    });
  }
  if (seenGaps.size !== expectedByKey.size) {
    failKnownEvidence(
      "preventure_research_coverage_gap_incomplete",
      "Every server-derived coverage gap must be declared exactly once.",
    );
  }
  const sourceIds = new Set(sourceRows.map((source) => source.providerSourceId));
  const normalizedAttempts = [];
  const attemptIds = new Set();
  for (const attempt of attempts) {
    if (
      !exactObjectKeys(attempt, [
        "id", "questionId", "purpose", "sourceClass", "outcome",
        "constraint", "sourceIds", "detail",
      ])
      || attemptIds.has(attempt.id)
      || !context.authority.researchQuestions.some((item) => item.id === attempt.questionId)
      || !context.template.requiredSourceClasses.includes(attempt.sourceClass)
      || !Array.isArray(attempt.sourceIds)
      || new Set(attempt.sourceIds).size !== attempt.sourceIds.length
      || attempt.sourceIds.some((sourceId) => !sourceIds.has(sourceId))
      || (attempt.outcome === "source_retained" && (
        attempt.constraint !== "none" || attempt.sourceIds.length < 1
      ))
      || (attempt.outcome !== "source_retained" && attempt.constraint === "none")
      || (attempt.outcome === "no_relevant_public_evidence"
        && attempt.constraint !== "insufficient_relevant_public_evidence")
      || (attempt.outcome === "source_quality_rejected"
        && attempt.constraint !== "source_quality_rejected")
    ) {
      failKnownEvidence(
        "preventure_research_source_attempt_invalid",
        "The lawful source-attempt register is duplicated, unbound, or internally inconsistent.",
      );
    }
    attemptIds.add(attempt.id);
    normalizedAttempts.push({
      ...attempt,
      id: boundedText(attempt.id, "Source attempt ID", 128, {
        providerDispatchStarted: true, providerOutcomeKnown: true,
      }),
      detail: boundedText(attempt.detail, "Source attempt detail", 500, {
        providerDispatchStarted: true, providerOutcomeKnown: true,
      }),
    });
  }
  if (
    !normalizedAttempts.some((attempt) => attempt.purpose === "contrary")
    || (status === "insufficient_evidence" && !normalizedAttempts.some(
      (attempt) => attempt.outcome !== "source_retained",
    ))
    || normalizedGaps.some((gap) => gap.id === "required_source_class"
      && !normalizedAttempts.some((attempt) => (
        attempt.sourceClass === gap.subjectId && attempt.outcome !== "source_retained"
      )))
  ) {
    failKnownEvidence(
      "preventure_research_source_attempt_coverage_invalid",
      "The source-attempt register does not prove the contrary path and every missing source class.",
    );
  }
  let normalizedNextAction = null;
  if (nextAction) {
    if (
      !exactObjectKeys(nextAction, [
        "method", "questionId", "action", "maxCostAudCents", "whyDecisionChanging",
      ])
      || !context.authority.researchQuestions.some((item) => item.id === nextAction.questionId)
      || !Number.isSafeInteger(nextAction.maxCostAudCents)
      || nextAction.maxCostAudCents < 0
      || nextAction.maxCostAudCents > context.assignment.maxCostAudCents
    ) {
      failKnownEvidence(
        "preventure_research_next_evidence_action_invalid",
        "The proposed next evidence action is outside the exact affordable research boundary.",
      );
    }
    normalizedNextAction = {
      ...nextAction,
      action: boundedText(nextAction.action, "Next evidence action", 500, {
        providerDispatchStarted: true, providerOutcomeKnown: true,
      }),
      whyDecisionChanging: boundedText(
        nextAction.whyDecisionChanging,
        "Next evidence action decision value",
        500,
        { providerDispatchStarted: true, providerOutcomeKnown: true },
      ),
    };
  }
  return {
    status,
    gaps: normalizedGaps.sort((left, right) => (
      `${left.id}:${left.subjectId || ""}`.localeCompare(`${right.id}:${right.subjectId || ""}`)
    )),
    sourceAttempts: normalizedAttempts.sort((left, right) => left.id.localeCompare(right.id)),
    nextEvidenceAction: normalizedNextAction,
    metrics: derived.metrics,
  };
}

function unusedLegacyValidateParsedCoverage(context, parsed, evidenceRows, sourceRows) {
  const authority = context.authority;
  if (context.assignment.id === "comparator_and_buyer_evidence") {
    const comparators = new Map();
    for (const evidence of evidenceRows) {
      const comparator = evidence.details.comparator;
      if (!comparator) continue;
      const prior = comparators.get(comparator.id);
      if (prior && !sameCanonical(prior, comparator)) {
        failKnownEvidence(
          "preventure_research_comparator_conflict",
          `Comparator ${comparator.id} has conflicting identity details.`,
        );
      }
      comparators.set(comparator.id, comparator);
    }
    const values = [...comparators.values()];
    const scope = authority.comparatorScope;
    const categoryCount = (category) => values.filter((item) => item.category === category).length;
    const sellerCounts = new Map();
    for (const item of values) {
      sellerCounts.set(item.sellerId, (sellerCounts.get(item.sellerId) || 0) + 1);
    }
    const reviewObservationCount = values.reduce(
      (sum, item) => sum + item.reviewObservationCount,
      0,
    );
    const buyerSignals = evidenceRows
      .map((item) => item.details.buyerEvidence)
      .filter(Boolean);
    const uniqueSignals = new Set(
      buyerSignals.map((item) => JSON.stringify(canonical(item))),
    );
    const buyerGroups = new Set(buyerSignals.map((item) => item.independenceGroup));
    const consequences = buyerSignals.filter((item) => item.kind === "consequence");
    const workarounds = buyerSignals.filter(
      (item) => item.kind === "workaround_or_spending_trigger",
    );
    const purchaserSignals = buyerSignals.filter(
      (item) => item.kind === "purchaser_attributable_behaviour",
    );
    const paidOfferIds = new Set(purchaserSignals.map((item) => item.paidOfferId));
    const purchaserSellers = new Set(
      purchaserSignals.map((item) => item.sellerOrPublisherId),
    );
    if (
      values.length < scope.minimumOffers
      || values.length > scope.maximumOffers
      || categoryCount("direct_or_near_direct") < scope.directOrNearDirectMinimum
      || categoryCount("adjacent") < scope.adjacentMinimum
      || categoryCount("indirect") < scope.indirectMinimum
      || Math.max(0, ...sellerCounts.values()) > scope.acceptedOffersPerSellerMaximum
      || reviewObservationCount > scope.reviewObservationMaximum
      || uniqueSignals.size !== buyerSignals.length
      || buyerSignals.length < 6
      || buyerGroups.size < 3
      || consequences.length < 3
      || workarounds.length < 2
      || purchaserSignals.length < 6
      || paidOfferIds.size < 3
      || purchaserSellers.size < 2
      || purchaserSignals.filter((item) => item.exactWorkflowRelevance).length < 3
      || authority.formats.some((formatId) => (
        values.filter((item) => item.formatIds.includes(formatId)).length
          < scope.minimumPerApprovedFormat
      ))
      || !values.some((item) => item.channelId === "etsy")
      || !values.some((item) => item.channelId === "gumroad")
    ) {
      failKnownEvidence(
        "preventure_research_comparator_coverage_incomplete",
        "The retained comparator batch does not meet the exact 10–15, category, seller, format, Etsy, and Gumroad boundaries.",
      );
    }
  }
  const requiredCriteria = assignmentCriterionIds(authority, context.assignment.id);
  if (requiredCriteria.length > 0) {
    const present = new Set(evidenceRows.map((item) => item.criterionId).filter(Boolean));
    const missing = requiredCriteria.filter((criterionId) => !present.has(criterionId));
    if (missing.length > 0) {
      failKnownEvidence(
        "preventure_research_criterion_coverage_incomplete",
        `The retained evidence is missing exact case coverage: ${missing.join(", ")}.`,
      );
    }
  }
  if (context.assignment.id === "independent_readiness_review") {
    const contrary = new Set(
      evidenceRows.filter((item) => item.polarity === "contrary").map((item) => item.questionId),
    );
    const missing = authority.researchQuestions
      .map((item) => item.id)
      .filter((questionId) => !contrary.has(questionId));
    if (missing.length > 0) {
      failKnownEvidence(
        "preventure_research_contrary_coverage_incomplete",
        "The independent review does not retain contrary evidence for every approved research question.",
      );
    }
  }
  validateStructuredDecisionEvidence(context, parsed, evidenceRows);
}

function validateParsedCoverage(context, parsed, evidenceRows, sourceRows) {
  const authority = context.authority;
  let coverage;
  if (context.assignment.id === "comparator_and_buyer_evidence") {
    coverage = assignmentOneCoverage(context, evidenceRows, sourceRows);
  } else {
    const sourceClassCounts = new Map();
    for (const source of sourceRows) {
      sourceClassCounts.set(source.sourceClass, (sourceClassCounts.get(source.sourceClass) || 0) + 1);
    }
    coverage = {
      gaps: context.template.requiredSourceClasses
        .filter((sourceClass) => (sourceClassCounts.get(sourceClass) || 0) < 1)
        .map((sourceClass) => ({
          id: "required_source_class",
          subjectId: sourceClass,
          comparison: "minimum",
          requiredCount: 1,
          actualCount: 0,
          constraint: "insufficient_relevant_public_evidence",
          reasonCode: "required_source_class_below_minimum",
          technicalReason: "The exact server-validated retained batch did not include this required source class.",
        })),
      metrics: {
        sourceIds: sourceRows.map((item) => item.providerSourceId).sort(),
        sourceIdentityHashes: sourceRows.map((item) => item.sourceIdentityHash).filter(Boolean).sort(),
        sourceClassCounts: Object.fromEntries([...sourceClassCounts.entries()].sort()),
        evidenceRecordCount: evidenceRows.length,
        contraryEvidenceCount: evidenceRows.filter((item) => item.polarity === "contrary").length,
      },
    };
  }
  const requiredCriteria = assignmentCriterionIds(authority, context.assignment.id);
  const presentCriteria = new Set(evidenceRows.map((item) => item.criterionId).filter(Boolean));
  coverage.gaps.push(...requiredCriteria
    .filter((criterionId) => !presentCriteria.has(criterionId))
    .map((criterionId) => ({
      id: "required_criterion",
      subjectId: criterionId,
      comparison: "minimum",
      requiredCount: 1,
      actualCount: 0,
      constraint: "insufficient_relevant_public_evidence",
      reasonCode: "required_criterion_below_minimum",
      technicalReason: "The exact server-validated retained batch did not support this required case.",
    })));
  if (context.assignment.id === "independent_readiness_review") {
    const contrary = new Set(
      evidenceRows.filter((item) => item.polarity === "contrary").map((item) => item.questionId),
    );
    coverage.gaps.push(...authority.researchQuestions
      .map((item) => item.id)
      .filter((questionId) => !contrary.has(questionId))
      .map((questionId) => ({
        id: "contrary_question_coverage",
        subjectId: questionId,
        comparison: "minimum",
        requiredCount: 1,
        actualCount: 0,
        constraint: "insufficient_relevant_public_evidence",
        reasonCode: "contrary_question_coverage_below_minimum",
        technicalReason: "The exact server-validated batch did not include contrary evidence for this question.",
      })));
  }
  coverage.gaps.sort((left, right) => (
    `${left.id}:${left.subjectId || ""}`.localeCompare(`${right.id}:${right.subjectId || ""}`)
  ));
  if (coverage.gaps.length === 0) validateStructuredDecisionEvidence(context, parsed, evidenceRows);
  return {
    status: coverage.gaps.length === 0 ? "complete" : "insufficient_evidence",
    gaps: coverage.gaps,
    metrics: coverage.metrics,
  };
}

const COVERAGE_GAP_CODE = Object.freeze({
  comparator_count: "comparator_count_below_minimum",
  comparator_category_direct_or_near_direct: "comparator_direct_mix_below_minimum",
  comparator_category_adjacent: "comparator_adjacent_mix_below_minimum",
  comparator_category_indirect: "comparator_indirect_mix_below_minimum",
  seller_bound_comparator_count: "comparator_seller_identity_incomplete",
  format_coverage: "comparator_per_format_coverage_incomplete",
  channel_coverage_etsy: "comparator_etsy_coverage_missing",
  channel_coverage_gumroad: "comparator_gumroad_coverage_missing",
  buyer_signal_count: "buyer_evidence_units_insufficient",
  buyer_independence_group_count: "buyer_independence_insufficient",
  buyer_consequence_count: "buyer_consequence_insufficient",
  buyer_workaround_trigger_count: "buyer_workaround_trigger_insufficient",
  purchaser_signal_count: "purchaser_signals_insufficient",
  paid_offer_count: "paid_offer_diversity_insufficient",
  purchaser_seller_count: "purchaser_seller_diversity_insufficient",
  exact_workflow_signal_count: "exact_workflow_signals_insufficient",
});

function validatedCoverageGapCodes(gaps) {
  const result = new Set();
  for (const gap of gaps) {
    const exact = COVERAGE_GAP_CODE[`${gap.id}_${gap.subjectId || ""}`]
      || COVERAGE_GAP_CODE[gap.id]
      || "lawful_source_access_exhausted";
    result.add(exact);
  }
  return [...result].sort();
}

function validatedSearchAttemptProof(context, retained, sourceRows) {
  const truth = providerWebSearchTruth(retained.providerResponse);
  const byUrl = new Map(
    sourceRows.filter((source) => source.canonicalUrl).map((source) => [source.canonicalUrl, source]),
  );
  const attempts = truth.completedSearchAttempts.map((item, index) => {
    const queries = exactSearchQueries(item);
    const sourceUrls = [...new Set((item.action.sources || []).map((source) => {
      try {
        return safePublicUrl(source?.url);
      } catch {
        return null;
      }
    }).filter(Boolean))].sort();
    return {
      id: boundedText(item.id, "Completed web-search call ID", 128, {
        providerDispatchStarted: true,
        providerOutcomeKnown: true,
      }),
      callIndex: index + 1,
      status: "completed",
      actionType: "search",
      purpose: index === 0
        ? "marketplace_and_supporting_coverage"
        : "contrary_and_missing_evidence_coverage",
      targetSourceClasses: index === 0
        ? context.template.requiredSourceClasses.slice(0, 1)
        : context.template.requiredSourceClasses.slice(1),
      targetMarketplaceChannelIds: index === 0 ? ["etsy", "gumroad"] : [],
      queries,
      sourceUrls,
      sourceIdentityHashes: sourceUrls
        .map((url) => byUrl.get(url)?.sourceIdentityHash || null)
        .filter(Boolean)
        .sort(),
    };
  });
  const firstQuery = (attempts[0]?.queries || []).join(" ").toLowerCase();
  const secondQuery = (attempts[1]?.queries || []).join(" ").toLowerCase();
  const valid = truth.observed.length === context.assignment.maxToolCalls
    && truth.completedValid.length === context.assignment.maxToolCalls
    && truth.completedSearchAttempts.length === context.assignment.maxToolCalls
    && attempts.length === 2
    && firstQuery.includes("etsy")
    && firstQuery.includes("gumroad")
    && secondQuery.includes("contrary");
  return {
    valid,
    observedWebSearchCallCount: truth.observed.length,
    completedValidWebSearchCallCount: truth.completedValid.length,
    completedValidSearchAttemptCount: truth.completedSearchAttempts.length,
    attempts,
  };
}

function prepareParsedEvidence(context, parsed, retained, recordedAt) {
  if (!isObject(parsed) || !Array.isArray(parsed.sources) || !Array.isArray(parsed.evidence)) {
    throw runnerError(
      "preventure_research_output_invalid",
      "The retained provider result is missing structured sources or evidence.",
      { providerDispatchStarted: true, providerOutcomeKnown: true },
    );
  }
  const missingSection = context.template.requiredOutputSections.find(
    (section) => section !== "sources"
      && (section === "recommendation" ? !isObject(parsed[section]) : !Array.isArray(parsed[section])),
  );
  if (missingSection) {
    throw runnerError(
      "preventure_research_output_section_missing",
      `The retained provider result is missing the exact ${missingSection} section.`,
      { providerDispatchStarted: true, providerOutcomeKnown: true },
    );
  }
  if (
    !Array.isArray(retained.groundedSources)
    || retained.groundedSourceSetHash !== sha256(retained.groundedSources)
    || retained.providerResponseHash !== sha256(retained.providerResponse)
  ) {
    failKnownEvidence(
      "preventure_research_grounding_changed",
      "The retained provider grounding or canonical response changed before evidence validation.",
    );
  }
  const sourceClasses = new Set(context.template.requiredSourceClasses);
  const questionIds = new Set(context.authority.researchQuestions.map((question) => question.id));
  const allowedCriteria = new Set(assignmentCriterionIds(
    context.authority,
    context.assignment.id,
  ));
  const groundedByUrl = new Map(retained.groundedSources.map((source) => [source.url, source]));
  const priorEvidenceByHash = new Map(
    context.priorEvidenceContext.evidenceRecords.map((item) => [item.evidenceHash, item]),
  );
  const priorSourceByHash = new Map(
    context.priorEvidenceContext.sourceSnapshots.map((item) => [item.snapshotHash, item]),
  );
  const validatedSources = new Map();
  const publicSourceIdentityHashes = new Set();
  for (const [index, source] of parsed.sources.entries()) {
    if (
      !isObject(source)
      || !sourceClasses.has(source.sourceClass)
      || !Number.isInteger(source.sourceTier)
      || source.sourceTier < 1
      || source.sourceTier > 4
      || !["partial", "unavailable", "blocked"].includes(source.captureStatus)
    ) {
      failKnownEvidence(
        "preventure_research_source_class_changed",
        "The provider result contains a source outside the current assignment's exact source policy.",
      );
    }
    const providerSourceId = boundedText(
      source.id || `source_${index + 1}`,
      "Research source ID",
      128,
      { providerDispatchStarted: true, providerOutcomeKnown: true },
    );
    if (validatedSources.has(providerSourceId)) {
      failKnownEvidence(
        "preventure_research_source_duplicate",
        `Research source ${providerSourceId} is duplicated.`,
      );
    }
    const id = `${context.assignment.id}_${providerSourceId}`;
    const limitations = boundedTextList(
      source.limitations,
      "Research source limitations",
      8,
      250,
      { providerDispatchStarted: true, providerOutcomeKnown: true },
    );
    let normalized;
    if (source.sourceClass === "retained_pantheon_evidence") {
      const priorEvidence = source.retainedEvidenceHash
        ? priorEvidenceByHash.get(source.retainedEvidenceHash)
        : null;
      const priorSource = source.retainedSourceSnapshotHash
        ? priorSourceByHash.get(source.retainedSourceSnapshotHash)
        : null;
      if (
        source.url !== null
        || source.title !== null
        || source.publisher !== null
        || source.publishedAt !== null
        || source.captureStatus !== "partial"
        || (!priorEvidence && !priorSource)
        || (source.retainedEvidenceHash && !priorEvidence)
        || (source.retainedSourceSnapshotHash && !priorSource)
      ) {
        failKnownEvidence(
          "preventure_research_retained_source_invalid",
          "A retained-Pantheon source must resolve only to the exact bound prior-evidence pack.",
        );
      }
      normalized = {
        providerSourceId,
        id,
        sourceClass: source.sourceClass,
        sourceTier: source.sourceTier,
        captureStatus: "partial",
        url: null,
        title: priorEvidence
          ? `Retained Pantheon evidence ${priorEvidence.id}`
          : `Retained Pantheon source ${priorSource.id}`,
        publisher: "Pantheon immutable evidence ledger",
        publishedAt: null,
        limitations,
        contentHash: sha256({
          retainedEvidenceHash: source.retainedEvidenceHash || null,
          retainedSourceSnapshotHash: source.retainedSourceSnapshotHash || null,
        }),
        canonicalUrl: null,
        canonicalHost: null,
        sourceIdentityUrl: null,
        sourceIdentityHash: null,
        marketplaceChannelId: null,
        offerIdentityKey: null,
        sellerIdentityKey: null,
        publisherIdentityKey: null,
        buyerIndependenceGroup: null,
        identityDerivation: "retained_pantheon_hash_v1",
      };
    } else {
      if (source.retainedEvidenceHash !== null || source.retainedSourceSnapshotHash !== null) {
        failKnownEvidence(
          "preventure_research_public_source_binding_invalid",
          "A public source cannot claim an internal retained-evidence identity.",
        );
      }
      const url = safePublicUrl(source.url);
      const grounded = groundedByUrl.get(url);
      const sourceIdentity = derivePreventureResearchPublicSourceBinding(url);
      const title = source.title === null ? null : cleanProviderText(source.title, 300);
      const publisher = source.publisher === null ? null : cleanProviderText(source.publisher, 200);
      const publishedAt = source.publishedAt === null
        ? null
        : cleanProviderText(source.publishedAt, 80);
      if (
        !grounded
        || (title !== null && !grounded.titles.includes(title))
        || (publisher !== null && !grounded.publishers.includes(publisher))
        || (publishedAt !== null && !grounded.publishedAtValues.includes(publishedAt))
        || source.captureStatus !== "partial"
        || source.content !== null
      ) {
        failKnownEvidence(
          "preventure_research_source_not_provider_grounded",
          "Web-search grounding metadata must remain partial and cannot contain model-written page content.",
        );
      }
      if (publicSourceIdentityHashes.has(sourceIdentity.sourceIdentityHash)) {
        failKnownEvidence(
          "preventure_research_source_identity_duplicate",
          "One provider-grounded public URL cannot be multiplied into multiple source records.",
        );
      }
      publicSourceIdentityHashes.add(sourceIdentity.sourceIdentityHash);
      const normalizedPublisher = publisher || grounded.publishers[0] || null;
      normalized = {
        providerSourceId,
        id,
        sourceClass: source.sourceClass,
        sourceTier: source.sourceTier,
        captureStatus: "partial",
        url,
        title: title || grounded.titles[0] || url,
        publisher: normalizedPublisher,
        publishedAt: publishedAt || grounded.publishedAtValues[0] || null,
        limitations,
        contentHash: sha256({
          providerResponseHash: retained.providerResponseHash,
          groundedSource: grounded,
        }),
        ...sourceIdentity,
      };
    }
    validatedSources.set(providerSourceId, normalized);
  }
  const allowedProviderTruth = new Set([
    "estimate",
    "model_inference",
    "unknown",
  ]);
  const allowedPolarity = new Set(["supporting", "contrary", "neutral", "unknown"]);
  const allowedConfidence = new Set(["low", "medium", "high", "unknown"]);
  const validatedEvidence = [];
  const evidenceIds = new Set();
  const comparatorOfferIds = new Set();
  const buyerEvidenceSourceIds = new Set();
  for (const [index, evidence] of parsed.evidence.entries()) {
    const evidenceId = boundedText(
      evidence?.id || `evidence_${index + 1}`,
      "Research evidence ID",
      128,
      { providerDispatchStarted: true, providerOutcomeKnown: true },
    );
    const details = evidence?.details;
    if (
      !isObject(evidence)
      || evidenceIds.has(evidenceId)
      || !allowedProviderTruth.has(evidence.truthClass)
      || !allowedPolarity.has(evidence.polarity)
      || !allowedConfidence.has(evidence.confidence)
      || !questionIds.has(evidence.questionId)
      || !exactObjectKeys(details, EVIDENCE_DETAIL_KEYS)
      || (evidence.criterionId !== null && !allowedCriteria.has(evidence.criterionId))
    ) {
      failKnownEvidence(
        "preventure_research_evidence_scope_changed",
        "The provider result contains duplicated or out-of-scope evidence.",
      );
    }
    evidenceIds.add(evidenceId);
    const source = evidence.sourceId ? validatedSources.get(evidence.sourceId) : null;
    if (evidence.sourceId && !source) {
      failKnownEvidence(
        "preventure_research_evidence_source_missing",
        "Evidence points to a source outside the retained provider result.",
      );
    }
    if (
      evidence.truthClass === "observed_fact"
      && (!source || source.captureStatus !== "captured")
    ) {
      failKnownEvidence(
        "preventure_research_observed_fact_unproven",
        "An observed fact requires a captured provider-grounded or bound retained source.",
      );
    }
    if (evidence.criterionId && !source) {
      failKnownEvidence(
        "preventure_research_criterion_unproven",
        "Every format, channel, economics, or readiness criterion requires a retained source.",
      );
    }
    const comparator = details.comparator;
    if (comparator !== null) {
      if (
        context.assignment.id !== "comparator_and_buyer_evidence"
        || !exactObjectKeys(comparator, [
          "id", "category", "sellerId", "channelId", "formatIds",
          "reviewObservationCount",
        ])
        || !["direct_or_near_direct", "adjacent", "indirect"].includes(comparator.category)
        || !context.authority.channelCases.includes(comparator.channelId)
        || comparator.channelId === "retain_cash"
        || !source?.offerIdentityKey
        || comparator.id !== source.offerIdentityKey
        || comparator.channelId !== source.marketplaceChannelId
        || comparator.sellerId !== source.sellerIdentityKey
        || comparatorOfferIds.has(source.offerIdentityKey)
        || !Array.isArray(comparator.formatIds)
        || comparator.formatIds.length < 1
        || new Set(comparator.formatIds).size !== comparator.formatIds.length
        || comparator.formatIds.some((formatId) => !context.authority.formats.includes(formatId))
        || !Number.isSafeInteger(comparator.reviewObservationCount)
        || comparator.reviewObservationCount !== 0
        || evidence.truthClass !== "model_inference"
        || source?.captureStatus !== "partial"
        || source?.sourceClass !== "public_marketplace_listing_or_result_observation"
      ) {
        failKnownEvidence(
          "preventure_research_comparator_invalid",
          "Comparator identity must remain a partial, provider-grounded marketplace classification inside the exact scope.",
        );
      }
      comparatorOfferIds.add(source.offerIdentityKey);
      boundedText(comparator.id, "Comparator ID", 128, {
        providerDispatchStarted: true, providerOutcomeKnown: true,
      });
      if (comparator.sellerId !== null) {
        boundedText(comparator.sellerId, "Comparator seller ID", 128, {
          providerDispatchStarted: true, providerOutcomeKnown: true,
        });
      }
    }
    if (details.buyerEvidence !== null) {
      if (!source || buyerEvidenceSourceIds.has(source.providerSourceId)) {
        failKnownEvidence(
          "preventure_research_buyer_evidence_source_duplicate",
          "One partial provider-grounded source cannot be multiplied into multiple buyer-evidence units.",
        );
      }
      buyerEvidenceSourceIds.add(source.providerSourceId);
    }
    validateDecisionDetailBinding(context, evidence, source);
    validatedEvidence.push({
      providerEvidenceId: evidenceId,
      id: `${context.assignment.id}_${evidenceId}`,
      sourceId: evidence.sourceId || null,
      truthClass: evidence.truthClass,
      polarity: evidence.polarity,
      questionId: evidence.questionId,
      criterionId: evidence.criterionId,
      claim: boundedText(evidence.claim, "Research evidence claim", 500, {
        providerDispatchStarted: true, providerOutcomeKnown: true,
      }),
      confidence: evidence.confidence,
      limitations: boundedTextList(
        evidence.limitations,
        "Research evidence limitations",
        8,
        250,
        { providerDispatchStarted: true, providerOutcomeKnown: true },
      ),
      details,
    });
  }
  const coverage = validateParsedCoverage(
    context,
    parsed,
    validatedEvidence,
    [...validatedSources.values()],
  );
  const searchAttemptProof = validatedSearchAttemptProof(
    context,
    retained,
    [...validatedSources.values()],
  );
  if (coverage.status === "insufficient_evidence" && searchAttemptProof.valid !== true) {
    failKnownEvidence(
      "preventure_research_insufficient_attempt_proof_invalid",
      "Evidence shortfall cannot close the round because the exact two completed server-validated search attempts were not retained.",
    );
  }
  const validatedCoverage = {
    ...coverage,
    gapCodes: validatedCoverageGapCodes(coverage.gaps),
    searchAttemptProof,
  };
  const body = {
    schema: "pantheon.preventure-research-prepared-evidence.v1",
    authorityHash: context.authority.authorityHash,
    assignmentHash: context.assignment.assignmentHash,
    descriptorHash: context.descriptor.descriptorHash,
    retainedOutputHash: retained.outputHash,
    providerResponseHash: retained.providerResponseHash,
    groundedSourceSetHash: retained.groundedSourceSetHash,
    recordedAt,
    validatedCoverage,
    sourceSnapshots: [...validatedSources.values()].map((source) => ({
      ...source,
      contentLocation: source.contentHash
        ? `${retained.location}#grounding=${encodeURIComponent(source.url || source.id)}`
        : null,
    })),
    evidenceRecords: validatedEvidence,
  };
  return deepFreeze({ ...body, preparedEvidenceBatchHash: sha256(body) });
}

function persistPreparedEvidenceBatch(prepared, completion) {
  if (
    !isObject(prepared)
    || prepared.schema !== "pantheon.preventure-research-prepared-evidence.v1"
    || prepared.preparedEvidenceBatchHash
      !== sha256((({ preparedEvidenceBatchHash: _hash, ...body }) => body)(prepared))
    || !Array.isArray(prepared.sourceSnapshots)
    || !Array.isArray(prepared.evidenceRecords)
  ) {
    failKnownEvidence(
      "preventure_research_prepared_evidence_changed",
      "The fully validated evidence batch changed before its atomic commit.",
    );
  }
  if (
    !isObject(completion)
    || typeof completion.researchRunId !== "string"
    || !completion.researchRunId
    || typeof completion.agentRunReceiptId !== "string"
    || !completion.agentRunReceiptId
    || !Array.isArray(completion.sourceBindings)
    || typeof completion.recordSourceSnapshot !== "function"
    || typeof completion.recordEvidence !== "function"
  ) {
    failKnownEvidence(
      "preventure_research_completion_identity_missing",
      "The atomic completion bridge did not provide the final research run, canonical receipt, and evidence writers.",
    );
  }
  const sourceBindings = new Map();
  for (const binding of completion.sourceBindings) {
    const expected = prepared.sourceSnapshots.find(
      (source) => source.providerSourceId === binding?.providerSourceId,
    );
    if (
      !expected
      || sourceBindings.has(binding.providerSourceId)
      || typeof binding.sourceRecordId !== "string"
      || !binding.sourceRecordId
      || typeof binding.provenanceId !== "string"
      || !binding.provenanceId
      || binding.url !== expected.url
      || binding.contentHash !== expected.contentHash
      || binding.contentLocation !== expected.contentLocation
      || binding.researchRunId !== completion.researchRunId
      || binding.agentRunReceiptId !== completion.agentRunReceiptId
    ) {
      failKnownEvidence(
        "preventure_research_source_provenance_changed",
        "A generic source or provenance identity does not match the exact validated authority source.",
      );
    }
    sourceBindings.set(binding.providerSourceId, binding);
  }
  if (sourceBindings.size !== prepared.sourceSnapshots.length) {
    failKnownEvidence(
      "preventure_research_source_provenance_incomplete",
      "Every validated source requires one exact generic source and provenance binding.",
    );
  }
  const sourceResults = new Map();
  for (const source of prepared.sourceSnapshots) {
    const binding = sourceBindings.get(source.providerSourceId);
    const recorded = completion.recordSourceSnapshot(prepared.assignmentHash, {
      id: source.id,
      version: "v1",
      sourceClass: source.sourceClass,
      sourceTier: source.sourceTier,
      captureStatus: source.captureStatus,
      url: source.url,
      title: source.title,
      publisher: source.publisher,
      publishedAt: source.publishedAt,
      limitations: source.limitations,
      contentHash: source.contentHash,
      contentLocation: source.contentLocation,
      canonicalUrl: source.canonicalUrl,
      canonicalHost: source.canonicalHost,
      sourceIdentityUrl: source.sourceIdentityUrl,
      sourceIdentityHash: source.sourceIdentityHash,
      marketplaceChannelId: source.marketplaceChannelId,
      offerIdentityKey: source.offerIdentityKey,
      sellerIdentityKey: source.sellerIdentityKey,
      publisherIdentityKey: source.publisherIdentityKey,
      buyerIndependenceGroup: source.buyerIndependenceGroup,
      identityDerivation: source.identityDerivation,
      sourceRecordId: binding.sourceRecordId,
      provenanceId: binding.provenanceId,
      researchRunId: completion.researchRunId,
      agentRunReceiptId: completion.agentRunReceiptId,
      retrievedAt: prepared.recordedAt,
    });
    if (!isObject(recorded?.sourceSnapshot)) {
      failKnownEvidence(
        "preventure_research_source_commit_failed",
        "The atomic completion bridge did not return a persisted source snapshot.",
      );
    }
    sourceResults.set(source.providerSourceId, recorded.sourceSnapshot);
  }
  const evidenceResults = [];
  for (const evidence of prepared.evidenceRecords) {
    const source = evidence.sourceId ? sourceResults.get(evidence.sourceId) : null;
    const recorded = completion.recordEvidence(prepared.assignmentHash, {
      id: evidence.id,
      version: "v1",
      sourceSnapshotHash: source?.snapshotHash || source?.sourceSnapshotHash || null,
      truthClass: evidence.truthClass,
      polarity: evidence.polarity,
      questionId: evidence.questionId,
      criterionId: evidence.criterionId,
      claim: evidence.claim,
      confidence: evidence.confidence,
      limitations: evidence.limitations,
      details: evidence.details,
      capturedAt: prepared.recordedAt,
    });
    if (!isObject(recorded?.evidence)) {
      failKnownEvidence(
        "preventure_research_evidence_commit_failed",
        "The atomic completion bridge did not return a persisted evidence record.",
      );
    }
    evidenceResults.push(recorded.evidence);
  }
  return {
    sourceSnapshots: [...sourceResults.values()],
    evidenceRecords: evidenceResults,
  };
}

function preparedEvidenceResultHash(retained, prepared) {
  return sha256({
    outputHash: retained.outputHash,
    providerResponseHash: retained.providerResponseHash,
    groundedSourceSetHash: retained.groundedSourceSetHash,
    preparedEvidenceBatchHash: prepared.preparedEvidenceBatchHash,
  });
}

function validateCommittedEvidence(commit, prepared, resultHash) {
  const sourceSnapshots = commit?.sourceSnapshots;
  const evidenceRecords = commit?.evidenceRecords;
  const sourceHashes = Array.isArray(sourceSnapshots)
    ? sourceSnapshots.map((item) => item.snapshotHash || item.sourceSnapshotHash)
    : [];
  const evidenceHashes = Array.isArray(evidenceRecords)
    ? evidenceRecords.map((item) => item.evidenceHash)
    : [];
  if (
    !isObject(commit)
    || commit.status !== "complete"
    || typeof commit.researchRunId !== "string"
    || !commit.researchRunId
    || typeof commit.agentRunReceiptId !== "string"
    || !commit.agentRunReceiptId
    || commit.resultHash !== resultHash
    || !Array.isArray(sourceSnapshots)
    || sourceSnapshots.length !== prepared.sourceSnapshots.length
    || !Array.isArray(evidenceRecords)
    || evidenceRecords.length !== prepared.evidenceRecords.length
    || sourceHashes.some((hash) => !/^sha256:[a-f0-9]{64}$/.test(String(hash || "")))
    || evidenceHashes.some((hash) => !/^sha256:[a-f0-9]{64}$/.test(String(hash || "")))
  ) {
    failKnownEvidence(
      "preventure_research_atomic_completion_invalid",
      "The atomic completion bridge did not return one exact final receipt and evidence batch.",
    );
  }
  return commit;
}

function validateEarlyStopCommit(commit, context, resultHash, prepared = null) {
  if (
    !isObject(commit)
    || commit.status !== "validated_early_stop"
    || commit.completionMode !== "validated_early_stop"
    || commit.resultHash !== resultHash
    || !isObject(commit.stopRecord)
    || commit.earlyStopRecordHash !== commit.stopRecord.earlyStopRecordHash
    || !Array.isArray(commit.skippedAssignments)
    || !sameCanonical(commit.skippedAssignments, commit.stopRecord.skippedAssignments)
    || !sameCanonical(
      commit.skippedAssignmentRecordHashes,
      commit.stopRecord.skippedAssignments.map((item) => item.skipRecordHash),
    )
  ) {
    failKnownEvidence(
      "preventure_research_early_stop_commit_invalid",
      "The atomic completion bridge did not return one exact server-derived terminal stop and untouched assignment suffix.",
    );
  }
  validatePreventureResearchTerminalStop(commit.stopRecord, {
    authority: context.authority,
    triggerAssignment: context.assignment,
    assignments: context.plan.assignments,
  });
  const sourceSnapshots = commit.sourceSnapshots || [];
  const evidenceRecords = commit.evidenceRecords || [];
  if (
    !Array.isArray(sourceSnapshots)
    || !Array.isArray(evidenceRecords)
    || (prepared && (
      sourceSnapshots.length !== prepared.sourceSnapshots.length
      || evidenceRecords.length !== prepared.evidenceRecords.length
    ))
    || (!prepared && (sourceSnapshots.length !== 0 || evidenceRecords.length !== 0))
  ) {
    failKnownEvidence(
      "preventure_research_early_stop_evidence_invalid",
      "Terminal-stop evidence does not match the exact usable retained batch for its trigger class.",
    );
  }
  return commit;
}

function appendCost(store, assignmentHash, input) {
  if (typeof store.appendCostEvent !== "function") {
    throw runnerError(
      "preventure_research_cost_store_missing",
      "The immutable authority-scoped cost ledger is unavailable.",
      { statusCode: 500 },
    );
  }
  return store.appendCostEvent(assignmentHash, input);
}

async function commitKnownUnusableEarlyStop(input) {
  const {
    claims,
    context,
    claim,
    retainedOutput,
    responseIssues,
    costKey,
    costAudCents,
    costStatus,
    completedAt,
  } = input;
  const issues = [...new Set(responseIssues || [])].sort();
  const resultHash = sha256({
    triggerOutcomeClass: "known_retained_unusable_provider_response",
    authorityHash: context.authority.authorityHash,
    assignmentHash: context.assignment.assignmentHash,
    descriptorHash: context.descriptor.descriptorHash,
    rawOutputArtifactHash: retainedOutput.artifactHash,
    responseIssues: issues,
  });
  const committed = validateEarlyStopCommit(await claims.commitValidatedEarlyStop({
    mode: "known_effect_unusable",
    stopReason: "known_effect_unusable",
    triggerOutcomeClass: "known_retained_unusable_provider_response",
    claimToken: claim.claimToken,
    authorityHash: context.authority.authorityHash,
    assignmentHash: context.assignment.assignmentHash,
    descriptorHash: context.descriptor.descriptorHash,
    taskId: context.assignment.taskId,
    taskAttemptId: claim.taskAttemptId,
    modelCallId: claim.modelCallId || retainedOutput.billing?.modelCallId || null,
    clientRequestId: claim.clientRequestId,
    providerRequestId: retainedOutput.providerRequestId,
    providerResponseId: retainedOutput.providerResponseId,
    rawOutputArtifactHash: retainedOutput.artifactHash,
    retainedOutput,
    responseIssues: issues,
    responseIssuesHash: sha256(issues),
    costKey,
    costAudCents,
    costStatus,
    resultHash,
    validatedCoverage: null,
    preparedEvidenceBatchHash: null,
    preparedEvidenceBatch: null,
    completedAt,
  }), context, resultHash, null);
  return {
    status: "completed_validated_early_stop",
    completionMode: "validated_early_stop",
    triggerOutcomeClass: "known_retained_unusable_provider_response",
    authorityHash: context.authority.authorityHash,
    assignmentHash: context.assignment.assignmentHash,
    descriptorHash: context.descriptor.descriptorHash,
    resultHash,
    costAudCents,
    issues,
    earlyStopRecordHash: committed.earlyStopRecordHash,
    skippedAssignmentRecordHashes: committed.skippedAssignmentRecordHashes,
    nextEvidenceAction: committed.stopRecord.nextEvidenceAction,
    retainedOutput,
    retryAuthorized: false,
    additionalAiCostAudCents: 0,
  };
}

async function commitKnownPreEffectEarlyStop(input) {
  const {
    claims,
    context,
    claim,
    error,
    costKey,
    completedAt,
  } = input;
  const retainedOutput = error.retainedOutput;
  const responseIssues = [String(error.kind || "definite_pre_effect_http_rejection")].sort();
  const costTruth = {
    costStatus: "estimated",
    costAudCents: 0,
    exposureAudCents: context.assignment.maxCostAudCents,
    exactBillingPending: true,
    providerZeroBillingGuarantee: false,
  };
  const resultHash = sha256({
    triggerOutcomeClass: "known_failed_before_effect",
    authorityHash: context.authority.authorityHash,
    assignmentHash: context.assignment.assignmentHash,
    descriptorHash: context.descriptor.descriptorHash,
    requestBodyHash: context.descriptor.request.requestBodyHash,
    taskAttemptId: claim.taskAttemptId,
    modelCallId: claim.modelCallId || null,
    clientRequestId: claim.clientRequestId,
    providerRequestId: error.providerRequestId || null,
    providerResponseId: null,
    officialEndpointHash: PREVENTURE_OFFICIAL_RESPONSES_ENDPOINT_HASH,
    httpStatus: Number(error.httpStatus),
    providerErrorType: error.providerErrorType,
    providerErrorCode: error.providerErrorCode,
    rawOutputArtifactHash: retainedOutput.artifactHash,
    rawProviderBodyHash: retainedOutput.rawProviderBodyHash,
    responseIssues,
    costTruth,
  });
  const committed = validateEarlyStopCommit(await claims.commitValidatedEarlyStop({
    mode: "definite_pre_effect",
    stopReason: "known_failed_before_effect",
    triggerOutcomeClass: "known_failed_before_effect",
    claimToken: claim.claimToken,
    authorityHash: context.authority.authorityHash,
    assignmentHash: context.assignment.assignmentHash,
    descriptorHash: context.descriptor.descriptorHash,
    requestBodyHash: context.descriptor.request.requestBodyHash,
    taskId: context.assignment.taskId,
    taskAttemptId: claim.taskAttemptId,
    modelCallId: claim.modelCallId || null,
    clientRequestId: claim.clientRequestId,
    providerRequestId: error.providerRequestId || null,
    providerResponseId: null,
    officialEndpointHash: PREVENTURE_OFFICIAL_RESPONSES_ENDPOINT_HASH,
    httpStatus: Number(error.httpStatus),
    providerErrorType: error.providerErrorType,
    providerErrorCode: error.providerErrorCode,
    providerErrorBodyArtifactHash: retainedOutput.artifactHash,
    rawOutputArtifactHash: retainedOutput.artifactHash,
    rawProviderBodyHash: retainedOutput.rawProviderBodyHash,
    retainedOutput,
    responseIssues,
    responseIssuesHash: sha256(responseIssues),
    costKey,
    ...costTruth,
    resultHash,
    validatedCoverage: null,
    preparedEvidenceBatchHash: null,
    preparedEvidenceBatch: null,
    completedAt,
  }), context, resultHash, null);
  return {
    status: "completed_validated_early_stop",
    completionMode: "validated_early_stop",
    triggerOutcomeClass: "known_failed_before_effect",
    authorityHash: context.authority.authorityHash,
    assignmentHash: context.assignment.assignmentHash,
    descriptorHash: context.descriptor.descriptorHash,
    resultHash,
    httpStatus: Number(error.httpStatus),
    providerRequestId: error.providerRequestId || null,
    providerResponseId: null,
    costAudCents: 0,
    exposureAudCents: context.assignment.maxCostAudCents,
    exactBillingPending: true,
    earlyStopRecordHash: committed.earlyStopRecordHash,
    skippedAssignmentRecordHashes: committed.skippedAssignmentRecordHashes,
    nextEvidenceAction: committed.stopRecord.nextEvidenceAction,
    retainedOutput,
    retryAuthorized: false,
    additionalAiCostAudCents: 0,
  };
}

async function runPreventureResearchAssignment(input = {}) {
  validateRuntimeDependencies(input);
  const {
    store,
    authorityHash,
    assignmentId,
    transport,
    claims,
    outputStore,
    parser,
  } = input;
  const preparedAt = runtimeNow(input.clock);
  let context = exactDescriptorContext(store, authorityHash, assignmentId, {
    expectedAssignmentHash: input.expectedAssignmentHash,
    expectedDescriptorHash: input.expectedDescriptorHash,
    at: preparedAt,
  });
  if (Date.parse(preparedAt) >= Date.parse(context.authority.expiresAt)) {
    throw runnerError(
      "preventure_research_authority_expired",
      "The fixed research deadline passed before assignment claim.",
    );
  }
  const exposure = latestCostExposure(context.ledger.costEvents).exposureAudCents;
  const projectedExposure = exposure + context.assignment.maxCostAudCents;
  if (
    projectedExposure > context.authority.internalAiSpendCapAudCents
    || projectedExposure > context.plan.totalAssignedCostAudCents
  ) {
    throw runnerError(
      "preventure_research_cap_exhausted",
      "The next exact assignment cannot fit inside the accepted aggregate cost ceiling.",
    );
  }
  await assertExactTransportPreflight(transport, context.descriptor);
  const claim = validateClaim(await claims.claim({
    authorityHash,
    assignmentId,
    assignmentHash: context.assignment.assignmentHash,
    taskId: context.assignment.taskId,
    descriptorHash: context.descriptor.descriptorHash,
    expiresAt: context.authority.expiresAt,
  }), context.descriptor);
  const costKey = stableCostKey(context.assignment.assignmentHash);
  let reserved = false;
  let providerDispatched = false;
  let knownProviderResult = null;
  let knownRetainedOutput = null;
  try {
    appendCost(store, context.assignment.assignmentHash, {
      costKey,
      eventType: "reserved",
      amountAudCents: context.assignment.maxCostAudCents,
      exposureAudCents: context.assignment.maxCostAudCents,
      taskAttemptId: claim.taskAttemptId || null,
      occurredAt: preparedAt,
    });
    reserved = true;

    context = exactDescriptorContext(store, authorityHash, assignmentId, {
      expectedAssignmentHash: context.assignment.assignmentHash,
      expectedDescriptorHash: context.descriptor.descriptorHash,
      at: runtimeNow(input.clock),
    });
    const dispatchAt = runtimeNow(input.clock);
    if (Date.parse(dispatchAt) >= Date.parse(context.authority.expiresAt)) {
      throw runnerError(
        "preventure_research_authority_expired",
        "The fixed research deadline passed before provider dispatch.",
      );
    }
    await assertExactTransportPreflight(transport, context.descriptor);
    const dispatchMarker = await claims.markProviderDispatched({
      claimToken: claim.claimToken,
      authorityHash,
      assignmentHash: context.assignment.assignmentHash,
      descriptorHash: context.descriptor.descriptorHash,
      requestBodyHash: context.descriptor.request.requestBodyHash,
      clientRequestId: claim.clientRequestId,
      markedAt: dispatchAt,
    });
    if (
      !isObject(dispatchMarker)
      || dispatchMarker.outcomeStatus !== "provider_dispatched"
      || dispatchMarker.clientRequestId !== claim.clientRequestId
    ) {
      throw runnerError(
        "preventure_research_dispatch_marker_failed",
        "Pantheon could not durably mark provider dispatch before the network effect.",
      );
    }
    providerDispatched = true;
    let transportResult;
    try {
      transportResult = await transport.dispatch({
        descriptor: context.descriptor,
        request: context.descriptor.request,
        claimToken: claim.claimToken,
        clientRequestId: claim.clientRequestId,
        taskId: context.assignment.taskId,
        taskAttemptId: claim.taskAttemptId,
        deadlineMs: context.assignment.deadlineMs,
      });
    } catch (error) {
      try {
        await assertProviderResultClaim(claims, context, claim);
      } catch (claimError) {
        if (error?.retainedOutput) {
          return await commitTerminalProviderArtifactCustody(
            claims,
            context,
            claim,
            error.retainedOutput,
            error,
            runtimeNow(input.clock),
          );
        }
        throw claimError;
      }
      throw error;
    }
    try {
      await assertProviderResultClaim(claims, context, claim);
    } catch (claimError) {
      if (transportResult?.retainedOutput) {
        return await commitTerminalProviderArtifactCustody(
          claims,
          context,
          claim,
          transportResult.retainedOutput,
          transportResult,
          runtimeNow(input.clock),
        );
      }
      throw claimError;
    }
    if (transportResult?.outcomeStatus === "known_effect_invalid") {
      const invalidResult = validateKnownEffectInvalidResult(
        transportResult,
        context.descriptor,
        claim.clientRequestId,
      );
      knownProviderResult = invalidResult;
      const invalidBilling = {
        currency: "AUD",
        costAudCents: invalidResult.costKnown ? invalidResult.costAudCents : null,
        costStatus: invalidResult.costKnown ? invalidResult.costStatus : "unknown",
        modelCallId: invalidResult.modelCallId || null,
      };
      const invalidPreRetained = invalidResult.retainedOutput || null;
      if (invalidPreRetained && (
        !isObject(invalidPreRetained)
        || invalidPreRetained.retained !== true
        || invalidPreRetained.assignmentMaxCostAudCents !== context.assignment.maxCostAudCents
        || invalidPreRetained.assignmentHash !== context.assignment.assignmentHash
        || invalidPreRetained.descriptorHash !== context.descriptor.descriptorHash
        || invalidPreRetained.requestBodyHash !== context.descriptor.request.requestBodyHash
        || invalidPreRetained.clientRequestId !== claim.clientRequestId
        || invalidPreRetained.providerRequestId !== invalidResult.providerRequestId
        || invalidPreRetained.providerResponseId !== invalidResult.providerResponseId
        || invalidPreRetained.rawProviderBodyHash !== invalidResult.rawProviderBodyHash
      )) {
        throw runnerError(
          "preventure_research_transport_artifact_changed",
          "The transport-retained malformed provider artifact changed before runner custody.",
          { providerDispatchStarted: true, providerOutcomeKnown: true },
        );
      }
      await assertProviderResultClaim(claims, context, claim);
      const retainedInvalid = await outputStore.retain({
        artifactKind: "known_effect_invalid",
        assignmentMaxCostAudCents: context.assignment.maxCostAudCents,
        authorityHash,
        assignmentHash: context.assignment.assignmentHash,
        descriptorHash: context.descriptor.descriptorHash,
        requestBodyHash: context.descriptor.request.requestBodyHash,
        existingRetainedOutput: invalidPreRetained,
        clientRequestId: claim.clientRequestId,
        providerRequestId: invalidResult.providerRequestId,
        providerResponseId: invalidResult.providerResponseId,
        providerResponse: invalidResult.providerResponse,
        providerResponseHash: invalidResult.providerResponseHash,
        rawProviderBody: invalidResult.rawProviderBody,
        rawProviderBodyHash: invalidResult.rawProviderBodyHash,
        output: null,
        groundedSources: [],
        groundedSourceSetHash: sha256([]),
        billing: invalidBilling,
        billingHash: sha256(invalidBilling),
        responseMetadata: {
          httpStatus: invalidResult.httpStatus,
          canonicalResponseValid: false,
          providerResponseJsonParsed: invalidResult.providerResponseJsonParsed,
          responseIssues: invalidResult.issues,
        },
        retainedAt: runtimeNow(input.clock),
      });
      if (
        !isObject(retainedInvalid)
        || retainedInvalid.retained !== true
      || retainedInvalid.artifactKind !== "known_effect_invalid"
      || retainedInvalid.assignmentMaxCostAudCents !== context.assignment.maxCostAudCents
        || typeof retainedInvalid.location !== "string"
        || !retainedInvalid.location
        || retainedInvalid.clientRequestId !== claim.clientRequestId
        || retainedInvalid.providerRequestId !== invalidResult.providerRequestId
        || retainedInvalid.providerResponseId !== invalidResult.providerResponseId
        || retainedInvalid.requestBodyHash !== context.descriptor.request.requestBodyHash
        || retainedInvalid.providerResponseHash !== invalidResult.providerResponseHash
        || retainedInvalid.rawProviderBodyHash !== invalidResult.rawProviderBodyHash
        || retainedInvalid.rawProviderBody !== invalidResult.rawProviderBody
        || retainedInvalid.billingHash !== sha256(invalidBilling)
        || !sameCanonical(retainedInvalid.billing, invalidBilling)
      ) {
        throw runnerError(
          "preventure_research_known_effect_not_retained",
          "The known malformed provider effect could not be retained immutably.",
          { providerDispatchStarted: true, providerOutcomeKnown: true },
        );
      }
      knownRetainedOutput = retainedInvalid;
      await assertProviderResultClaim(claims, context, claim);
      appendCost(store, context.assignment.assignmentHash, {
        costKey,
        eventType: invalidResult.costKnown
          ? invalidResult.costStatus === "reconciled"
            ? "reconciled"
            : invalidResult.costStatus === "incurred"
              ? "incurred"
              : "estimated"
          : "unknown",
        amountAudCents: invalidResult.costKnown ? invalidResult.costAudCents : null,
        exposureAudCents: invalidResult.costKnown
          ? invalidResult.costAudCents
          : context.assignment.maxCostAudCents,
        taskAttemptId: claim.taskAttemptId || null,
        modelCallId: invalidResult.modelCallId || null,
        occurredAt: runtimeNow(input.clock),
      });
      if (!invalidResult.costKnown) {
        await assertProviderResultClaim(claims, context, claim);
        await claims.markKnownResultUnknownCost({
          claimToken: claim.claimToken,
          authorityHash,
          assignmentHash: context.assignment.assignmentHash,
          descriptorHash: context.descriptor.descriptorHash,
          clientRequestId: claim.clientRequestId,
          providerRequestId: invalidResult.providerRequestId,
          providerResponseId: invalidResult.providerResponseId,
          retainedOutput: retainedInvalid,
          reason: "The malformed provider effect is retained, but its exact cost is unknown.",
          occurredAt: runtimeNow(input.clock),
        });
        return {
          status: "known_provider_effect_invalid",
          authorityHash,
          assignmentHash: context.assignment.assignmentHash,
          descriptorHash: context.descriptor.descriptorHash,
          retainedOutput: retainedInvalid,
          providerRequestId: invalidResult.providerRequestId,
          providerResponseId: invalidResult.providerResponseId,
          costAudCents: null,
          exposureAudCents: context.assignment.maxCostAudCents,
          retryAuthorized: false,
          additionalAiCostAudCents: 0,
        };
      }
      if (invalidResult.httpStatus < 200 || invalidResult.httpStatus > 299) {
        await assertProviderResultClaim(claims, context, claim);
        await claims.markKnownNeedsReprocess({
          claimToken: claim.claimToken,
          assignmentHash: context.assignment.assignmentHash,
          descriptorHash: context.descriptor.descriptorHash,
          retainedOutput: retainedInvalid,
          reason: `The retained HTTP ${invalidResult.httpStatus} provider effect is not a usable 2xx response and will not be retried.`,
        });
        return {
          status: "known_provider_effect_needs_attention",
          authorityHash,
          assignmentHash: context.assignment.assignmentHash,
          descriptorHash: context.descriptor.descriptorHash,
          httpStatus: invalidResult.httpStatus,
          retainedOutput: retainedInvalid,
          providerRequestId: invalidResult.providerRequestId,
          providerResponseId: invalidResult.providerResponseId,
          costAudCents: invalidResult.costAudCents,
          costStatus: invalidResult.costStatus,
          exposureAudCents: invalidResult.costAudCents,
          exactBillingPending: ["estimated", "incurred"].includes(invalidResult.costStatus),
          retryAuthorized: false,
          additionalAiCostAudCents: 0,
        };
      }
      await assertProviderResultClaim(claims, context, claim);
      return await commitKnownUnusableEarlyStop({
        claims,
        context,
        claim,
        retainedOutput: retainedInvalid,
        responseIssues: invalidResult.issues,
        costKey,
        costAudCents: invalidResult.costAudCents,
        costStatus: invalidResult.costStatus,
        completedAt: runtimeNow(input.clock),
      });
    }
    const providerResult = validateTransportResult(
      transportResult,
      context.descriptor,
      claim.clientRequestId,
    );
    knownProviderResult = providerResult;
    const billing = {
      currency: "AUD",
      costAudCents: providerResult.costAudCents,
      costStatus: providerResult.costStatus || "estimated",
      modelCallId: providerResult.modelCallId || null,
    };
    const preRetained = providerResult.retainedOutput || null;
    if (preRetained && (
      !isObject(preRetained)
      || preRetained.retained !== true
      || preRetained.assignmentMaxCostAudCents !== context.assignment.maxCostAudCents
      || preRetained.assignmentHash !== context.assignment.assignmentHash
      || preRetained.descriptorHash !== context.descriptor.descriptorHash
      || preRetained.requestBodyHash !== context.descriptor.request.requestBodyHash
      || preRetained.clientRequestId !== claim.clientRequestId
      || preRetained.providerRequestId !== providerResult.providerRequestId
      || preRetained.providerResponseId !== providerResult.providerResponseId
      || preRetained.providerResponseHash !== providerResult.providerResponseHash
      || preRetained.rawProviderBodyHash !== (providerResult.rawProviderBodyHash ?? null)
    )) {
      throw runnerError(
        "preventure_research_transport_artifact_changed",
        "The transport-retained canonical provider artifact changed before runner custody.",
        { providerDispatchStarted: true, providerOutcomeKnown: true },
      );
    }
    await assertProviderResultClaim(claims, context, claim);
    const retained = await outputStore.retain({
      artifactKind: "canonical_known_response",
      assignmentMaxCostAudCents: context.assignment.maxCostAudCents,
      authorityHash,
      assignmentHash: context.assignment.assignmentHash,
      descriptorHash: context.descriptor.descriptorHash,
      requestBodyHash: context.descriptor.request.requestBodyHash,
      existingRetainedOutput: preRetained,
      clientRequestId: claim.clientRequestId,
      providerRequestId: providerResult.providerRequestId,
      providerResponseId: providerResult.providerResponseId,
      providerResponse: providerResult.providerResponse,
      providerResponseHash: providerResult.providerResponseHash,
      rawProviderBody: providerResult.rawProviderBody ?? null,
      rawProviderBodyHash: providerResult.rawProviderBodyHash ?? null,
      output: providerResult.output,
      groundedSources: providerResult.groundedSources,
      groundedSourceSetHash: providerResult.groundedSourceSetHash,
      billing,
      billingHash: sha256(billing),
      responseMetadata: {
        ...(providerResult.responseMetadata || {}),
        responseStatus: providerResult.providerResponse.status,
        responseIssues: providerResult.responseIssues,
      },
      retainedAt: runtimeNow(input.clock),
    });
    if (
      !isObject(retained)
      || retained.retained !== true
      || retained.artifactKind !== "canonical_known_response"
      || retained.assignmentMaxCostAudCents !== context.assignment.maxCostAudCents
      || typeof retained.location !== "string"
      || !retained.location
      || retained.clientRequestId !== claim.clientRequestId
      || retained.providerRequestId !== providerResult.providerRequestId
      || retained.providerResponseId !== providerResult.providerResponseId
      || retained.requestBodyHash !== context.descriptor.request.requestBodyHash
      || retained.outputHash !== sha256(providerResult.output)
      || retained.providerResponseHash !== providerResult.providerResponseHash
      || sha256(retained.providerResponse) !== providerResult.providerResponseHash
      || retained.rawProviderBody !== (providerResult.rawProviderBody ?? null)
      || retained.rawProviderBodyHash !== (providerResult.rawProviderBodyHash ?? null)
      || retained.groundedSourceSetHash !== providerResult.groundedSourceSetHash
      || sha256(retained.groundedSources) !== providerResult.groundedSourceSetHash
      || retained.billingHash !== sha256(billing)
      || !sameCanonical(retained.billing, billing)
    ) {
      throw runnerError(
        "preventure_research_output_not_retained",
        "The known provider result could not be retained immutably before interpretation.",
        { providerDispatchStarted: true, providerOutcomeKnown: true },
      );
    }
    knownRetainedOutput = retained;
    await assertProviderResultClaim(claims, context, claim);
    const costEventType = providerResult.costStatus === "reconciled"
      ? "reconciled"
      : providerResult.costStatus === "incurred"
        ? "incurred"
        : "estimated";
    appendCost(store, context.assignment.assignmentHash, {
      costKey,
      eventType: costEventType,
      amountAudCents: providerResult.costAudCents,
      exposureAudCents: providerResult.costAudCents,
      taskAttemptId: claim.taskAttemptId || null,
      modelCallId: providerResult.modelCallId || null,
      agentRunReceiptId: retained.agentRunReceiptId || null,
      occurredAt: runtimeNow(input.clock),
    });
    if (providerResult.responseIssues.length > 0) {
      await assertProviderResultClaim(claims, context, claim);
      return await commitKnownUnusableEarlyStop({
        claims,
        context,
        claim,
        retainedOutput: retained,
        responseIssues: providerResult.responseIssues,
        costKey,
        costAudCents: providerResult.costAudCents,
        costStatus: providerResult.costStatus,
        completedAt: runtimeNow(input.clock),
      });
    }
    let parsed;
    try {
      parsed = await parser.parse(providerResult.output, {
        descriptor: context.descriptor,
        retainedOutput: retained,
      });
    } catch (error) {
      return await commitKnownUnusableEarlyStop({
        claims,
        context,
        claim,
        retainedOutput: retained,
        responseIssues: [
          "deterministic_parser_rejected",
          String(error?.code || "preventure_research_parser_rejected"),
        ],
        costKey,
        costAudCents: providerResult.costAudCents,
        costStatus: providerResult.costStatus,
        completedAt: runtimeNow(input.clock),
      });
    }
    let preparedEvidence;
    try {
      preparedEvidence = prepareParsedEvidence(
        context,
        parsed,
        retained,
        runtimeNow(input.clock),
      );
    } catch (error) {
      return await commitKnownUnusableEarlyStop({
        claims,
        context,
        claim,
        retainedOutput: retained,
        responseIssues: [
          "deterministic_evidence_validation_rejected",
          String(error?.code || "preventure_research_evidence_rejected"),
        ],
        costKey,
        costAudCents: providerResult.costAudCents,
        costStatus: providerResult.costStatus,
        completedAt: runtimeNow(input.clock),
      });
    }
    const resultHash = preparedEvidenceResultHash(retained, preparedEvidence);
    if (preparedEvidence.validatedCoverage.status === "insufficient_evidence") {
      await assertProviderResultClaim(claims, context, claim);
      const committedStop = validateEarlyStopCommit(await claims.commitValidatedEarlyStop({
        mode: "insufficient_evidence",
        stopReason: "insufficient_evidence",
        triggerOutcomeClass: "validated_evidence_shortfall",
        claimToken: claim.claimToken,
        authorityHash,
        assignmentHash: context.assignment.assignmentHash,
        descriptorHash: context.descriptor.descriptorHash,
        taskId: context.assignment.taskId,
        taskAttemptId: claim.taskAttemptId,
        modelCallId: claim.modelCallId || providerResult.modelCallId || null,
        clientRequestId: claim.clientRequestId,
        providerRequestId: providerResult.providerRequestId,
        providerResponseId: providerResult.providerResponseId,
        retainedOutput: retained,
        responseIssues: [],
        costKey,
        costAudCents: providerResult.costAudCents,
        costStatus: providerResult.costStatus,
        resultHash,
        validatedCoverage: preparedEvidence.validatedCoverage,
        preparedEvidenceBatchHash: preparedEvidence.preparedEvidenceBatchHash,
        preparedEvidenceBatch: preparedEvidence,
        completedAt: runtimeNow(input.clock),
        persistEvidence(completion) {
          return persistPreparedEvidenceBatch(preparedEvidence, completion);
        },
      }), context, resultHash, preparedEvidence);
      return {
        status: "completed_validated_early_stop",
        completionMode: "validated_early_stop",
        triggerOutcomeClass: "validated_evidence_shortfall",
        authorityHash,
        assignmentHash: context.assignment.assignmentHash,
        descriptorHash: context.descriptor.descriptorHash,
        resultHash,
        costAudCents: providerResult.costAudCents,
        earlyStopRecordHash: committedStop.earlyStopRecordHash,
        skippedAssignmentRecordHashes: committedStop.skippedAssignmentRecordHashes,
        nextEvidenceAction: committedStop.stopRecord.nextEvidenceAction,
        sourceSnapshotCount: committedStop.sourceSnapshots.length,
        evidenceRecordCount: committedStop.evidenceRecords.length,
        retainedOutput: retained,
      };
    }
    await assertProviderResultClaim(claims, context, claim);
    const committed = validateCommittedEvidence(await claims.commitKnownEvidence({
      claimToken: claim.claimToken,
      authorityHash,
      assignmentHash: context.assignment.assignmentHash,
      descriptorHash: context.descriptor.descriptorHash,
      taskId: context.assignment.taskId,
      retainedOutput: retained,
      resultHash,
      preparedEvidenceBatchHash: preparedEvidence.preparedEvidenceBatchHash,
      preparedEvidenceBatch: preparedEvidence,
      providerRequestId: providerResult.providerRequestId,
      providerResponseId: providerResult.providerResponseId,
      clientRequestId: claim.clientRequestId,
      completedAt: runtimeNow(input.clock),
      persistEvidence(completion) {
        return persistPreparedEvidenceBatch(preparedEvidence, completion);
      },
    }), preparedEvidence, resultHash);
    return {
      status: "completed",
      authorityHash,
      assignmentHash: context.assignment.assignmentHash,
      descriptorHash: context.descriptor.descriptorHash,
      resultHash,
      costAudCents: providerResult.costAudCents,
      researchRunId: committed.researchRunId,
      agentRunReceiptId: committed.agentRunReceiptId,
      sourceSnapshotCount: committed.sourceSnapshots.length,
      evidenceRecordCount: committed.evidenceRecords.length,
      retainedOutput: retained,
    };
  } catch (error) {
    if (error?.code === "preventure_research_terminal_custody_failed") throw error;
    if (error?.claimChanged === true) {
      if (knownRetainedOutput) {
        return await commitTerminalProviderArtifactCustody(
          claims,
          context,
          claim,
          knownRetainedOutput,
          knownProviderResult,
          runtimeNow(input.clock),
        );
      }
      throw error;
    }
    if (knownProviderResult && knownRetainedOutput) {
      const terminalCustody = await assertProviderResultClaimOrTerminalCustody(
        claims,
        context,
        claim,
        knownRetainedOutput,
        knownProviderResult,
        runtimeNow(input.clock),
      );
      if (terminalCustody) return terminalCustody;
      try {
        await claims.markKnownNeedsReprocess({
          claimToken: claim.claimToken,
          assignmentHash: context.assignment.assignmentHash,
          descriptorHash: context.descriptor.descriptorHash,
          retainedOutput: knownRetainedOutput,
          reason: String(error?.message || "The retained known response needs local recovery."),
        });
      } catch (recoveryError) {
        const racedCustody = await assertProviderResultClaimOrTerminalCustody(
          claims,
          context,
          claim,
          knownRetainedOutput,
          knownProviderResult,
          runtimeNow(input.clock),
        );
        if (racedCustody) return racedCustody;
        throw runnerError(
          "preventure_research_known_recovery_failed",
          `The provider response and billing are retained, but the local recovery marker failed: ${String(recoveryError?.message || recoveryError)}.`,
          { providerDispatchStarted: true, providerOutcomeKnown: true },
        );
      }
      return {
        status: "known_provider_result_needs_attention",
        authorityHash,
        assignmentHash: context.assignment.assignmentHash,
        descriptorHash: context.descriptor.descriptorHash,
        retainedOutput: knownRetainedOutput,
        costAudCents: knownProviderResult.costAudCents,
        error: String(error?.message || "Local post-retention processing failed."),
        additionalAiCostAudCents: 0,
      };
    }
    if (providerDispatched && isDefinitePreEffectFailure(error, context, claim)) {
      const terminalCustody = await assertProviderResultClaimOrTerminalCustody(
        claims,
        context,
        claim,
        error.retainedOutput,
        error,
        runtimeNow(input.clock),
      );
      if (terminalCustody) return terminalCustody;
      try {
        appendCost(store, context.assignment.assignmentHash, {
          costKey,
          eventType: "estimated",
          amountAudCents: 0,
          exposureAudCents: context.assignment.maxCostAudCents,
          taskAttemptId: claim.taskAttemptId || null,
          modelCallId: claim.modelCallId || null,
          occurredAt: runtimeNow(input.clock),
        });
        const racedCustody = await assertProviderResultClaimOrTerminalCustody(
          claims,
          context,
          claim,
          error.retainedOutput,
          error,
          runtimeNow(input.clock),
        );
        if (racedCustody) return racedCustody;
        return await commitKnownPreEffectEarlyStop({
          claims,
          context,
          claim,
          error,
          costKey,
          completedAt: runtimeNow(input.clock),
        });
      } catch (terminalError) {
        if (terminalError?.code === "preventure_research_terminal_custody_failed") {
          throw terminalError;
        }
        const racedCustody = await assertProviderResultClaimOrTerminalCustody(
          claims,
          context,
          claim,
          error.retainedOutput,
          error,
          runtimeNow(input.clock),
        );
        if (racedCustody) return racedCustody;
        throw terminalError;
      }
    }
    if (providerDispatched && (knownProviderResult || error?.providerOutcomeKnown === true)) {
      const retainedKnownEffect = knownRetainedOutput || error?.retainedOutput || null;
      const terminalCustody = await assertProviderResultClaimOrTerminalCustody(
        claims,
        context,
        claim,
        retainedKnownEffect,
        knownProviderResult || error,
        runtimeNow(input.clock),
      );
      if (terminalCustody) return terminalCustody;
      const knownCostAudCents = Number.isSafeInteger(knownProviderResult?.costAudCents)
        ? knownProviderResult.costAudCents
        : Number.isSafeInteger(error?.costAudCents)
          && error.costAudCents >= 0
          && error.costAudCents <= context.assignment.maxCostAudCents
          ? error.costAudCents
          : null;
      const knownCostStatus = knownProviderResult?.costStatus || error?.costStatus || "unknown";
      const eventType = knownCostAudCents === null
        ? "unknown"
        : knownCostStatus === "reconciled"
          ? "reconciled"
          : knownCostStatus === "incurred"
            ? "incurred"
            : "estimated";
      const knownExposureAudCents = Number.isSafeInteger(error?.exposureAudCents)
        && error.exposureAudCents >= (knownCostAudCents || 0)
        && error.exposureAudCents <= context.assignment.maxCostAudCents
        ? error.exposureAudCents
        : knownCostAudCents === null
          ? context.assignment.maxCostAudCents
          : knownCostAudCents;
      try {
        appendCost(store, context.assignment.assignmentHash, {
          costKey,
          eventType,
          amountAudCents: knownCostAudCents,
          exposureAudCents: knownExposureAudCents,
          taskAttemptId: claim.taskAttemptId || null,
          modelCallId: knownProviderResult?.modelCallId || error?.modelCallId || null,
          occurredAt: runtimeNow(input.clock),
        });
        await claims.markKnownNeedsAttention({
          claimToken: claim.claimToken,
          authorityHash,
          assignmentHash: context.assignment.assignmentHash,
          descriptorHash: context.descriptor.descriptorHash,
          requestBodyHash: context.descriptor.request.requestBodyHash,
          clientRequestId: claim.clientRequestId,
          providerRequestId:
            knownProviderResult?.providerRequestId ?? error?.providerRequestId ?? null,
          providerResponseId:
            knownProviderResult?.providerResponseId ?? error?.providerResponseId ?? null,
          retainedOutput: retainedKnownEffect,
          costAudCents: knownCostAudCents,
          costStatus: eventType,
          reason: String(error?.message || "A known provider effect could not be retained locally."),
          occurredAt: runtimeNow(input.clock),
        });
      } catch (recoveryError) {
        if (recoveryError?.code === "preventure_research_terminal_custody_failed") {
          throw recoveryError;
        }
        const racedCustody = await assertProviderResultClaimOrTerminalCustody(
          claims,
          context,
          claim,
          retainedKnownEffect,
          knownProviderResult || error,
          runtimeNow(input.clock),
        );
        if (racedCustody) return racedCustody;
        throw runnerError(
          "preventure_research_known_attention_failed",
          `The provider effect is known and will not retry, but its needs-attention marker failed: ${String(recoveryError?.message || recoveryError)}.`,
          { providerDispatchStarted: true, providerOutcomeKnown: true },
        );
      }
      return {
        status: "known_provider_effect_needs_attention",
        authorityHash,
        assignmentHash: context.assignment.assignmentHash,
        descriptorHash: context.descriptor.descriptorHash,
        retainedOutput: retainedKnownEffect,
        providerRequestId:
          knownProviderResult?.providerRequestId ?? error?.providerRequestId ?? null,
        providerResponseId:
          knownProviderResult?.providerResponseId ?? error?.providerResponseId ?? null,
        costAudCents: knownCostAudCents,
        exposureAudCents: knownExposureAudCents,
        exactBillingPending: error?.exactBillingPending === true,
        retryAuthorized: false,
        additionalAiCostAudCents: 0,
      };
    }
    if (!providerDispatched && error.providerDispatchStarted !== true) {
      if (reserved) {
        appendCost(store, context.assignment.assignmentHash, {
          costKey,
          eventType: "released",
          amountAudCents: 0,
          exposureAudCents: 0,
          taskAttemptId: claim.taskAttemptId || null,
          occurredAt: runtimeNow(input.clock),
        });
      }
      await claims.failBeforeDispatch({
        claimToken: claim.claimToken,
        assignmentHash: context.assignment.assignmentHash,
        descriptorHash: context.descriptor.descriptorHash,
        reason: String(error?.message || "Pre-dispatch validation failed."),
      });
      throw error;
    }
    await assertProviderResultClaim(claims, context, claim);
    appendCost(store, context.assignment.assignmentHash, {
      costKey,
      eventType: "unknown",
      amountAudCents: null,
      exposureAudCents: context.assignment.maxCostAudCents,
      taskAttemptId: claim.taskAttemptId || null,
      occurredAt: runtimeNow(input.clock),
    });
      await claims.markUnknown({
        claimToken: claim.claimToken,
        assignmentHash: context.assignment.assignmentHash,
        descriptorHash: context.descriptor.descriptorHash,
        clientRequestId: claim.clientRequestId,
        providerRequestId: error?.providerRequestId || null,
        providerResponseId: error?.providerResponseId || null,
        reason: String(error?.message || "Provider outcome or cost is unknown."),
      });
    throw runnerError(
      "preventure_research_outcome_frozen",
      "Provider outcome or cost is unknown. This authority is frozen and will not retry or dispatch later work.",
      { providerDispatchStarted: true },
    );
  }
}

async function reprocessRetainedPreventureOutput(input = {}) {
  if (Object.hasOwn(input, "transport")) {
    throw runnerError(
      "preventure_research_reprocess_transport_forbidden",
      "Retained-output reprocessing is local and cannot receive a network transport.",
      { statusCode: 400 },
    );
  }
  validateRuntimeDependencies(input, { reprocessing: true });
  const context = exactReprocessContext(
    input.store,
    input.authorityHash,
    input.assignmentId,
    {
      expectedAssignmentHash: input.expectedAssignmentHash,
      expectedDescriptorHash: input.expectedDescriptorHash,
    },
  );
  const retained = await input.outputStore.load(input.retainedOutputRef, {
    authorityHash: input.authorityHash,
    assignmentHash: context.assignment.assignmentHash,
    descriptorHash: context.descriptor.descriptorHash,
    requestBodyHash: context.descriptor.request.requestBodyHash,
  });
  if (
    !isObject(retained)
    || retained.retained !== true
    || ![
      "canonical_known_response",
      "known_effect_invalid",
      "known_pre_effect_rejection",
    ].includes(retained.artifactKind)
    || retained.assignmentMaxCostAudCents !== context.assignment.maxCostAudCents
    || retained.authorityHash !== context.authority.authorityHash
    || retained.assignmentHash !== context.assignment.assignmentHash
    || retained.descriptorHash !== context.descriptor.descriptorHash
    || retained.requestBodyHash !== context.descriptor.request.requestBodyHash
    || !/^sha256:[a-f0-9]{64}$/.test(String(retained.artifactHash || ""))
    || !/^sha256:[a-f0-9]{64}$/.test(String(retained.rawProviderBodyHash || ""))
    || !optionalProviderRequestId(retained.providerRequestId)
    || !optionalProviderRequestId(retained.providerResponseId)
    || typeof retained.clientRequestId !== "string"
    || !/^[A-Za-z0-9._:-]{1,200}$/.test(retained.clientRequestId)
    || retained.providerRequestId === retained.clientRequestId
    || retained.providerResponseId === retained.clientRequestId
    || (retained.providerRequestId !== null
      && retained.providerRequestId === retained.providerResponseId)
  ) {
    throw runnerError(
      "preventure_research_retained_output_changed",
      "The retained provider output does not match the exact assignment.",
    );
  }
  const custodyInspection = await inspectProviderArtifactCustody(
    input.claims,
    context,
    retained,
  );
  if (
    (
      ["revoked", "expired"].includes(context.state.state)
      || context.state.terminal === true
      || context.state.expired === true
      || custodyInspection.emergencyStopped === true
    )
    && custodyInspection.custodyRequired !== true
  ) {
    throw runnerError(
      "preventure_research_terminal_custody_inspection_failed",
      "Terminal retained output cannot enter normal evidence reprocessing.",
      { providerDispatchStarted: true, providerOutcomeKnown: true },
    );
  }
  if (custodyInspection.custodyRequired) {
    return await commitTerminalProviderArtifactCustody(
      input.claims,
      context,
      {
        claimToken: custodyInspection.claimToken,
        taskAttemptId: custodyInspection.taskAttemptId,
        modelCallId: custodyInspection.modelCallId,
        clientRequestId: custodyInspection.clientRequestId,
      },
      retained,
      retained,
      runtimeNow(input.clock),
      {
        reprocessing: true,
        expectedTerminalState: custodyInspection.terminalState,
        expectedEmergencyStopped: custodyInspection.emergencyStopped,
      },
    );
  }
  if (
    retained.artifactKind !== "canonical_known_response"
    || retained.outputHash !== sha256(retained.output)
    || retained.providerResponseHash !== sha256(retained.providerResponse)
    || retained.providerResponseId !== retained.providerResponse?.id
    || retained.groundedSourceSetHash !== sha256(retained.groundedSources)
    || retained.billingHash !== sha256(retained.billing)
    || !Number.isSafeInteger(retained.billing?.costAudCents)
    || retained.billing.costAudCents < 0
    || retained.billing.costAudCents > context.assignment.maxCostAudCents
    || !["estimated", "incurred", "reconciled"].includes(retained.billing.costStatus)
    || (retained.responseMetadata?.responseIssues || []).length > 0
  ) {
    throw runnerError(
      "preventure_research_retained_output_changed",
      "Only one exact usable canonical response can enter active local evidence reprocessing.",
    );
  }
  const parsed = await input.parser.parse(retained.output, {
    descriptor: context.descriptor,
    retainedOutput: retained,
  });
  const preparedEvidence = prepareParsedEvidence(
    context,
    parsed,
    retained,
    runtimeNow(input.clock),
  );
  const resultHash = preparedEvidenceResultHash(retained, preparedEvidence);
  if (preparedEvidence.validatedCoverage.status === "insufficient_evidence") {
    const completedAt = runtimeNow(input.clock);
    const committedStop = validateEarlyStopCommit(await input.claims.commitValidatedEarlyStop({
      mode: "insufficient_evidence",
      stopReason: "insufficient_evidence",
      triggerOutcomeClass: "validated_evidence_shortfall",
      reprocessing: true,
      authorityHash: input.authorityHash,
      assignmentHash: context.assignment.assignmentHash,
      descriptorHash: context.descriptor.descriptorHash,
      taskId: context.assignment.taskId,
      taskAttemptId: retained.responseMetadata?.taskAttemptId || null,
      modelCallId: retained.billing?.modelCallId || null,
      clientRequestId: retained.clientRequestId,
      providerRequestId: retained.providerRequestId,
      providerResponseId: retained.providerResponseId,
      httpStatus: retained.responseMetadata?.httpStatus,
      retainedOutput: retained,
      responseIssues: [],
      costAudCents: retained.billing.costAudCents,
      costStatus: retained.billing.costStatus,
      exposureAudCents: retained.billing.exposureAudCents
        ?? retained.billing.costAudCents,
      exactBillingPending: retained.billing.exactBillingPending
        ?? ["estimated", "incurred"].includes(retained.billing.costStatus),
      resultHash,
      validatedCoverage: preparedEvidence.validatedCoverage,
      preparedEvidenceBatchHash: preparedEvidence.preparedEvidenceBatchHash,
      preparedEvidenceBatch: preparedEvidence,
      completedAt,
      additionalAiCostAudCents: 0,
      persistEvidence(completion) {
        return persistPreparedEvidenceBatch(preparedEvidence, completion);
      },
    }), context, resultHash, preparedEvidence);
    return {
      status: "completed_validated_early_stop",
      completionMode: "validated_early_stop",
      triggerOutcomeClass: "validated_evidence_shortfall",
      authorityHash: input.authorityHash,
      assignmentHash: context.assignment.assignmentHash,
      descriptorHash: context.descriptor.descriptorHash,
      resultHash,
      costAudCents: retained.billing.costAudCents,
      earlyStopRecordHash: committedStop.earlyStopRecordHash,
      skippedAssignmentRecordHashes: committedStop.skippedAssignmentRecordHashes,
      nextEvidenceAction: committedStop.stopRecord.nextEvidenceAction,
      sourceSnapshotCount: committedStop.sourceSnapshots.length,
      evidenceRecordCount: committedStop.evidenceRecords.length,
      retainedOutput: retained,
      reprocessedLocally: true,
      additionalAiCostAudCents: 0,
    };
  }
  const committed = validateCommittedEvidence(await input.claims.commitReprocessedEvidence({
    authorityHash: input.authorityHash,
    assignmentHash: context.assignment.assignmentHash,
    descriptorHash: context.descriptor.descriptorHash,
    taskId: context.assignment.taskId,
    retainedOutput: retained,
    resultHash,
    preparedEvidenceBatchHash: preparedEvidence.preparedEvidenceBatchHash,
    preparedEvidenceBatch: preparedEvidence,
    providerRequestId: retained.providerRequestId,
    providerResponseId: retained.providerResponseId,
    clientRequestId: retained.clientRequestId,
    completedAt: runtimeNow(input.clock),
    additionalAiCostAudCents: 0,
    persistEvidence(completion) {
      return persistPreparedEvidenceBatch(preparedEvidence, completion);
    },
  }), preparedEvidence, resultHash);
  return {
    status: "completed_from_retained_output",
    assignmentHash: context.assignment.assignmentHash,
    descriptorHash: context.descriptor.descriptorHash,
    resultHash,
    researchRunId: committed.researchRunId,
    agentRunReceiptId: committed.agentRunReceiptId,
    sourceSnapshotCount: committed.sourceSnapshots.length,
    evidenceRecordCount: committed.evidenceRecords.length,
    additionalAiCostAudCents: 0,
  };
}

module.exports = {
  EXACT_CLAIM_KIND,
  EXACT_LOCAL_PARSER_KIND,
  EXACT_OUTPUT_STORE_KIND,
  EXACT_TRANSPORT_KIND,
  PREVENTURE_RESEARCH_EXECUTION_DESCRIPTOR_SCHEMA,
  PREVENTURE_RESEARCH_REQUEST_SCHEMA,
  createPreventureResearchExecutionDescriptor,
  deriveKnownEffectInvalidResponseIssues,
  describePreventureResearchAssignment,
  normalizePreventureProviderResponse,
  resolvePreventureResearchExecutionDescriptor,
  pricedWorstCaseCost,
  reprocessRetainedPreventureOutput,
  runPreventureResearchAssignment,
  validatePreventureResearchExecutionDescriptor,
};
