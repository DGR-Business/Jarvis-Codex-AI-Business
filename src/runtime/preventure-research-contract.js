"use strict";

const { sha256 } = require("./commercial-test-contract");

const USD_MICROS_PER_USD = 1_000_000n;
const AUD_MICROS_PER_AUD = 1_000_000n;
const AUD_CENTS_PER_AUD = 100n;
const TOKENS_PER_PRICING_UNIT = 1_000_000n;
const CALLS_PER_TOOL_PRICING_UNIT = 1_000n;
const EXACT_PREVENTURE_MODEL = "gpt-5-mini-2025-08-07";
const EXACT_PREVENTURE_PRICING_MODEL = "gpt-5-mini";
const EXACT_PREVENTURE_MODEL_CARD_URL = "https://developers.openai.com/api/docs/models/gpt-5-mini";
const EXACT_PREVENTURE_PRICING_URL = "https://developers.openai.com/api/docs/pricing";
const EXACT_PREVENTURE_WEB_SEARCH_GUIDE_URL = "https://developers.openai.com/api/docs/guides/tools-web-search";
const EXACT_PREVENTURE_STRUCTURED_OUTPUT_GUIDE_URL = "https://developers.openai.com/api/docs/guides/structured-outputs";
const EXACT_PREVENTURE_CHECKED_AT = "2026-08-02T00:00:00Z";
const PREVENTURE_RESEARCH_PROVIDER_REVIEW_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const PREVENTURE_RESEARCH_PROVIDER_REVIEW_VALIDITY_MS = 7 * 24 * 60 * 60 * 1000;
const EXACT_PROVIDER_MAX_INPUT_TOKENS = 272_000;
const EXACT_PROVIDER_MAX_OUTPUT_TOKENS = 128_000;
const EXACT_LOCAL_PROMPT_PREFLIGHT_MAX_INPUT_TOKENS = 30_000;
const EXACT_ASSIGNMENT_MAX_OUTPUT_TOKENS = 12_000;
const EXACT_ASSIGNMENT_MAX_TOOL_CALLS = 2;
const EXACT_MAXIMUM_MODEL_PASSES = EXACT_ASSIGNMENT_MAX_TOOL_CALLS + 1;
const EXACT_ASSIGNMENT_WORST_CASE_AUD_CENTS = 50;
const EXACT_TOTAL_WORST_CASE_AUD_CENTS = 150;

const PREVENTURE_RESEARCH_AUTHORITY_SCHEMA = "pantheon.preventure-research-authority.v1";
const PREVENTURE_RESEARCH_AUTHORITY_V2_SCHEMA = "pantheon.preventure-research-authority.v2";
const PREVENTURE_RESEARCH_LIFECYCLE_SCHEMA = "pantheon.preventure-research-lifecycle-event.v1";
const PREVENTURE_RESEARCH_DECISION_SCHEMA = "pantheon.preventure-research-decision.v1";
const PREVENTURE_RESEARCH_APPROVAL_SCOPE_SCHEMA = "pantheon.preventure-research-approval-scope.v1";
const PREVENTURE_RESEARCH_APPROVAL_SCOPE_V2_SCHEMA =
  "pantheon.preventure-research-approval-scope.v2";
const PREVENTURE_RESEARCH_PROVIDER_REVIEW_SCHEMA =
  "pantheon.preventure-research-provider-facts-review.v2";
const PREVENTURE_RESEARCH_PROVIDER_FACT_RECORD_SCHEMA =
  "pantheon.preventure-research-provider-fact-record.v1";
const PREVENTURE_RESEARCH_AUTHORITY_V1_FIELDS = Object.freeze([
  "schema",
  "id",
  "version",
  "approvedAt",
  "expiresAt",
  "commercialConstitutionVersion",
  "opportunity",
  "preparationOnly",
  "internalAiSpendCapAudCents",
  "externalCommercialSpendCapAudCents",
  "comparatorScope",
  "formats",
  "priceCasesAudCents",
  "channelCases",
  "allowedMethods",
  "provider",
  "sourcePolicy",
  "researchQuestions",
  "ownerInputs",
  "assignments",
  "totalWorstCaseExposureAudCents",
  "allowedOutcomes",
  "prohibitedActions",
  "completionRules",
  "readinessBinding",
  "authorityHash",
]);
const PREVENTURE_RESEARCH_AUTHORITY_V2_FIELDS = Object.freeze([
  ...PREVENTURE_RESEARCH_AUTHORITY_V1_FIELDS,
  "providerReview",
  "supersedesAuthorityHash",
]);

const AUTHORITY_OUTCOMES = Object.freeze([
  "build",
  "research_more",
  "revise",
  "reject",
  "no_investment",
]);

const PREVENTURE_RESEARCH_COMPLETION_MODES = Object.freeze([
  "full_round",
  "validated_early_stop",
]);

const LIFECYCLE_EVENT_TYPES = Object.freeze([
  "proposed",
  "accepted",
  "activated",
  "completed",
  "revoked",
  "expired",
  "revised",
  "superseded",
]);

const TERMINAL_EVENT_TYPES = new Set([
  "completed",
  "revoked",
  "expired",
  "revised",
  "superseded",
]);

// Renewal is deliberately narrower than generic terminality. Revised and
// superseded authorities already bind a different successor, so admitting
// either here would permit an ambiguous or forked renewal lineage.
const RENEWAL_ADMISSIBLE_PREDECESSOR_EVENTS = Object.freeze([
  "completed",
  "revoked",
  "expired",
]);

const LIFECYCLE_TRANSITIONS = Object.freeze({
  proposed: new Set(["accepted", "revoked", "expired", "revised", "superseded"]),
  accepted: new Set(["activated", "revoked", "expired", "revised", "superseded"]),
  activated: new Set(["completed", "revoked", "expired", "revised", "superseded"]),
  completed: new Set(),
  revoked: new Set(),
  expired: new Set(),
  revised: new Set(),
  superseded: new Set(),
});

const REQUIRED_PROHIBITED_ACTIONS = Object.freeze([
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
]);

const EXACT_FORMAT_IDS = Object.freeze([
  "notion_client_portal",
  "scripts_evidence_log_micro_kit",
  "spreadsheet_documents_no_login",
]);

const EXACT_PRICE_CASES = Object.freeze([1900, 2900, 3900]);
const REQUIRED_CHANNEL_IDS = Object.freeze([
  "etsy",
  "evidence_supported_lawful_alternative",
  "gumroad",
  "retain_cash",
]);

const REQUIRED_ASSIGNMENT_IDS = Object.freeze([
  "comparator_and_buyer_evidence",
  "format_channel_and_economics",
  "independent_readiness_review",
]);

const REQUIRED_RESEARCH_QUESTION_IDS = Object.freeze([
  "buyer_problem_and_direct_demand",
  "competition_entry_and_offer_value",
  "experiment_and_risk",
  "format_usability_and_operations",
  "price_channel_economics_and_cash",
]);

const REQUIRED_READINESS_GATE_IDS = Object.freeze([
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

const REQUIRED_SOURCE_CLASSES = Object.freeze([
  "established_professional_or_industry_material",
  "official_platform_policy_or_pricing",
  "official_public_reference_data",
  "public_marketplace_listing_or_result_observation",
  "public_practitioner_discussion",
  "retained_pantheon_evidence",
]);

const REQUIRED_DISALLOWED_ACCESS = Object.freeze([
  "authenticated_account",
  "captcha",
  "paywall",
  "private_endpoint",
  "rate_limit_bypass",
  "robots_control_bypass",
  "technical_access_control_bypass",
]);

const REQUIRED_FACT_CLASSES = Object.freeze([
  "assumption",
  "estimate",
  "model_inference",
  "observed_fact",
  "owner_attestation",
  "owner_preference",
  "proven_pantheon_learning",
  "unknown",
]);

const VISIBILITY_DOES_NOT_PROVE = Object.freeze([
  "conversion",
  "demand",
  "profitability",
  "realised_price",
  "sales",
  "willingness_to_pay",
]);

const GATE_STATUSES = Object.freeze([
  "supported",
  "partially_supported",
  "unresolved",
  "contradicted",
  "owner_input_recorded",
  "protected_verification_required",
]);

const HASH_PATTERN = /^sha256:[a-f0-9]{64}$/;
const SAFE_ID_PATTERN = /^[a-z0-9][a-z0-9._:-]{0,127}$/i;

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function deepFreeze(value) {
  if (!value || typeof value !== "object") return value;
  if (!Object.isFrozen(value)) Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

function cleanText(value, label, minimumLength = 1) {
  const result = String(value ?? "").replace(/\s+/g, " ").trim();
  if (result.length < minimumLength) {
    throw new Error(`${label} must contain at least ${minimumLength} character${minimumLength === 1 ? "" : "s"}.`);
  }
  return result;
}

function safeId(value, label) {
  const result = cleanText(value, label);
  if (!SAFE_ID_PATTERN.test(result)) throw new Error(`${label} is not a safe identifier.`);
  return result;
}

function exactInteger(value, label, minimum = 0) {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < minimum) {
    throw new Error(`${label} must be an integer of at least ${minimum}.`);
  }
  return result;
}

function exactUsdMicros(value, label) {
  const number = Number(value);
  const scaled = number * Number(USD_MICROS_PER_USD);
  if (!Number.isFinite(number) || number <= 0 || !Number.isSafeInteger(scaled)) {
    throw new Error(`${label} must convert exactly to positive integer USD micros.`);
  }
  return BigInt(scaled);
}

function exactAudRateMicros(value, label) {
  const number = Number(value);
  const scaled = number * Number(AUD_MICROS_PER_AUD);
  if (!Number.isFinite(number) || number <= 0 || !Number.isSafeInteger(scaled)) {
    throw new Error(`${label} must convert exactly to positive integer AUD-per-USD micros.`);
  }
  return BigInt(scaled);
}

function ceilDivide(numerator, denominator) {
  if (numerator < 0n || denominator <= 0n) {
    throw new Error("Worst-case cost arithmetic requires a non-negative numerator and positive denominator.");
  }
  return (numerator + denominator - 1n) / denominator;
}

function safeNumberFromBigInt(value, label) {
  const number = Number(value);
  if (!Number.isSafeInteger(number)) throw new Error(`${label} exceeds safe integer storage.`);
  return number;
}

function calculatePreventureResearchWorstCaseExposureAud(pricingPolicy, limits = {}) {
  if (!isObject(pricingPolicy)) throw new Error("Worst-case pricing policy must be an object.");
  const maxInputTokensPerModelPass = exactInteger(
    limits.maxInputTokens,
    "Worst-case input tokens per model pass",
    1,
  );
  const maxOutputTokens = exactInteger(limits.maxOutputTokens, "Worst-case output tokens", 1);
  const maxToolCalls = exactInteger(limits.maxToolCalls, "Worst-case web-search calls", 1);
  const maximumModelPasses = exactInteger(
    limits.maximumModelPasses,
    "Worst-case maximum model passes",
    1,
  );
  if (maximumModelPasses !== maxToolCalls + 1) {
    throw new Error("Worst-case maximum model passes must include every hosted-tool call plus the final model pass.");
  }
  const maximumBillableInputTokens = BigInt(maxInputTokensPerModelPass) * BigInt(maximumModelPasses);
  const inputRateUsdMicros = exactUsdMicros(
    pricingPolicy.inputUsdPerMillionTokens,
    "Worst-case input price",
  );
  const outputRateUsdMicros = exactUsdMicros(
    pricingPolicy.outputUsdPerMillionTokens,
    "Worst-case output price",
  );
  const webSearchRateUsdMicros = exactUsdMicros(
    pricingPolicy.webSearchUsdPerThousandCalls,
    "Worst-case web-search price",
  );
  const audPerUsdCeilingMicros = exactAudRateMicros(
    pricingPolicy.audPerUsdCeiling,
    "Worst-case AUD/USD ceiling",
  );
  const inputCostUsdMicros = ceilDivide(
    maximumBillableInputTokens * inputRateUsdMicros,
    TOKENS_PER_PRICING_UNIT,
  );
  const outputCostUsdMicros = ceilDivide(
    BigInt(maxOutputTokens) * outputRateUsdMicros,
    TOKENS_PER_PRICING_UNIT,
  );
  const webSearchCostUsdMicros = ceilDivide(
    BigInt(maxToolCalls) * webSearchRateUsdMicros,
    CALLS_PER_TOOL_PRICING_UNIT,
  );
  const totalCostUsdMicros = inputCostUsdMicros + outputCostUsdMicros + webSearchCostUsdMicros;
  const amountAudCents = ceilDivide(
    totalCostUsdMicros * audPerUsdCeilingMicros * AUD_CENTS_PER_AUD,
    USD_MICROS_PER_USD * AUD_MICROS_PER_AUD,
  );
  return deepFreeze({
    method: "integer_ceiling_published_standard_price_v1",
    currency: "AUD",
    maxInputTokensPerModelPass,
    maximumModelPasses,
    maximumBillableInputTokens: safeNumberFromBigInt(
      maximumBillableInputTokens,
      "Worst-case billable input tokens",
    ),
    maxOutputTokens,
    maxToolCalls,
    inputCostUsdMicros: safeNumberFromBigInt(inputCostUsdMicros, "Worst-case input cost"),
    outputCostUsdMicros: safeNumberFromBigInt(outputCostUsdMicros, "Worst-case output cost"),
    webSearchCostUsdMicros: safeNumberFromBigInt(webSearchCostUsdMicros, "Worst-case web-search cost"),
    totalCostUsdMicros: safeNumberFromBigInt(totalCostUsdMicros, "Worst-case total cost"),
    audPerUsdCeilingMicros: safeNumberFromBigInt(audPerUsdCeilingMicros, "Worst-case AUD/USD rate"),
    amountAudCents: safeNumberFromBigInt(amountAudCents, "Worst-case AUD cents"),
    exactBillingPending: pricingPolicy.exactBillingPending === true,
  });
}

function signedInteger(value, label) {
  const result = Number(value);
  if (!Number.isSafeInteger(result)) throw new Error(`${label} must be a safe integer.`);
  return result;
}

function exactStringList(value, label, options = {}) {
  if (!Array.isArray(value) || value.length < Number(options.minimum || 0)) {
    throw new Error(`${label} must contain at least ${Number(options.minimum || 0)} item(s).`);
  }
  const items = value.map((item, index) => cleanText(item, `${label}[${index}]`));
  if (new Set(items).size !== items.length) throw new Error(`${label} must not contain duplicates.`);
  if (options.sorted === true && JSON.stringify(items) !== JSON.stringify([...items].sort())) {
    throw new Error(`${label} must be sorted so its authority hash is stable.`);
  }
  return items;
}

function exactTimestamp(value, label) {
  const result = cleanText(value, label);
  if (!Number.isFinite(Date.parse(result))) throw new Error(`${label} must be a valid timestamp.`);
  return result;
}

function sameValues(left, right) {
  return JSON.stringify([...left].sort()) === JSON.stringify([...right].sort());
}

function exactObjectKeys(value, expected, label) {
  if (!isObject(value)) throw new Error(`${label} must be an object.`);
  const actual = Object.keys(value).sort();
  const required = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(required)) {
    throw new Error(`${label} fields must be exactly: ${required.join(", ")}.`);
  }
  return value;
}

function exactBoolean(value, label, expected) {
  if (value !== expected) throw new Error(`${label} must remain ${expected}.`);
  return value;
}

function authorityHashBody(authority) {
  const { authorityHash: _authorityHash, ...body } = authority;
  return body;
}

function providerModelFacts(provider) {
  return {
    providerId: provider?.id,
    model: provider?.model,
    modelCard: provider?.modelCard,
  };
}

function providerToolPolicyFacts(provider) {
  return {
    providerId: provider?.id,
    endpointPolicy: provider?.endpointPolicy,
    tool: provider?.tool,
    externalWebAccess: provider?.externalWebAccess,
    responseStorage: provider?.responseStorage,
    providerTraceContent: provider?.providerTraceContent,
    localEvidenceStored: provider?.localEvidenceStored,
    requestPolicy: provider?.requestPolicy,
    requestPolicySourceUrls: provider?.requestPolicySourceUrls,
  };
}

function providerPricingFacts(provider) {
  return {
    providerId: provider?.id,
    model: provider?.model,
    pricingPolicy: provider?.pricingPolicy,
    pricingPolicyHash: provider?.pricingPolicyHash,
  };
}

function preventureResearchProviderFactHashes(provider) {
  if (!isObject(provider)) throw new Error("Provider fact hashing requires one provider object.");
  return deepFreeze({
    model: sha256(providerModelFacts(provider)),
    toolPolicy: sha256(providerToolPolicyFacts(provider)),
    pricing: sha256(providerPricingFacts(provider)),
  });
}

function providerReviewHashBody(review) {
  const { reviewHash: _reviewHash, ...body } = review;
  return body;
}

function officialProviderSourceUrl(value, label) {
  const result = cleanText(value, label);
  let parsed;
  try {
    parsed = new URL(result);
  } catch {
    throw new Error(`${label} must be one valid official HTTPS source URL.`);
  }
  if (
    parsed.protocol !== "https:"
    || parsed.hostname !== "developers.openai.com"
    || parsed.username
    || parsed.password
  ) {
    throw new Error(`${label} must remain an official developers.openai.com HTTPS reference.`);
  }
  return result;
}

function canonicalProviderFactTimestamp(value, label) {
  const timestamp = exactTimestamp(value, label);
  const canonicalTimestamp = new Date(timestamp).toISOString();
  if (timestamp !== canonicalTimestamp) {
    throw new Error(`${label} must use canonical ISO-8601 UTC bytes.`);
  }
  return timestamp;
}

function compareCanonicalText(left, right) {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function normalizeProviderReviewedFact(value, index) {
  exactObjectKeys(value, ["id", "statement"], `Provider reviewed fact ${index + 1}`);
  const id = safeId(value.id, `Provider reviewed fact ${index + 1} ID`);
  const statement = cleanText(
    value.statement,
    `Provider reviewed fact ${index + 1} statement`,
    8,
  );
  if (statement !== value.statement || statement.length > 280) {
    throw new Error("Provider reviewed facts must be canonical concise statements of at most 280 characters.");
  }
  return { id, statement };
}

function normalizeProviderFactAnchor(value, index) {
  exactObjectKeys(value, ["kind", "label"], `Provider fact anchor ${index + 1}`);
  const kind = cleanText(value.kind, `Provider fact anchor ${index + 1} kind`);
  if (!["field", "line_range", "section"].includes(kind)) {
    throw new Error("Provider fact anchors must identify one field, line range, or section.");
  }
  const label = cleanText(value.label, `Provider fact anchor ${index + 1} label`, 3);
  if (label !== value.label || label.length > 200) {
    throw new Error("Provider fact anchors must be canonical concise labels of at most 200 characters.");
  }
  return { kind, label };
}

function normalizedProviderFactContent(reviewedFacts, anchors) {
  if (!Array.isArray(reviewedFacts) || reviewedFacts.length < 1 || reviewedFacts.length > 20) {
    throw new Error("A provider fact record must retain between one and twenty concise reviewed facts.");
  }
  if (!Array.isArray(anchors) || anchors.length < 1 || anchors.length > 20) {
    throw new Error("A provider fact record must retain between one and twenty concise source anchors.");
  }
  const facts = reviewedFacts.map(normalizeProviderReviewedFact)
    .sort((left, right) => compareCanonicalText(left.id, right.id));
  const normalizedAnchors = anchors.map(normalizeProviderFactAnchor)
    .sort((left, right) => (
      compareCanonicalText(left.kind, right.kind)
      || compareCanonicalText(left.label, right.label)
    ));
  if (
    new Set(facts.map((fact) => fact.id)).size !== facts.length
    || new Set(normalizedAnchors.map((anchor) => `${anchor.kind}\u0000${anchor.label}`)).size
      !== normalizedAnchors.length
  ) {
    throw new Error("Provider fact records cannot repeat reviewed facts or source anchors.");
  }
  if (
    facts.reduce((sum, fact) => sum + fact.statement.length, 0) > 2_800
    || normalizedAnchors.reduce((sum, anchor) => sum + anchor.label.length, 0) > 1_600
  ) {
    throw new Error("Provider fact records must remain concise and cannot retain full source pages.");
  }
  return { reviewedFacts: facts, anchors: normalizedAnchors };
}

function providerFactRecordHashBody(record) {
  const { sourceRecordHash: _sourceRecordHash, ...body } = record;
  return body;
}

function validatePreventureResearchProviderFactRecord(record) {
  exactObjectKeys(record, [
    "schema",
    "id",
    "url",
    "retrievedAt",
    "checkedAt",
    "reviewedFactsHash",
    "reviewedFacts",
    "anchors",
    "contentFactHash",
    "sourceRecordHash",
  ], "Provider fact record");
  if (record.schema !== PREVENTURE_RESEARCH_PROVIDER_FACT_RECORD_SCHEMA) {
    throw new Error("Provider fact record schema is not supported.");
  }
  safeId(record.id, "Provider fact record ID");
  officialProviderSourceUrl(record.url, "Provider fact record URL");
  const retrievedAt = canonicalProviderFactTimestamp(
    record.retrievedAt,
    "Provider fact retrieval time",
  );
  const checkedAt = canonicalProviderFactTimestamp(record.checkedAt, "Provider fact check time");
  if (
    Date.parse(retrievedAt) > Date.parse(checkedAt)
    || Date.parse(checkedAt) - Date.parse(retrievedAt) > 24 * 60 * 60 * 1000
  ) {
    throw new Error("Provider fact review must occur within 24 hours after its retained retrieval record.");
  }
  if (!HASH_PATTERN.test(String(record.reviewedFactsHash || ""))) {
    throw new Error("Provider fact record must bind one exact reviewed provider-facts hash.");
  }
  const normalized = normalizedProviderFactContent(record.reviewedFacts, record.anchors);
  if (
    JSON.stringify(record.reviewedFacts) !== JSON.stringify(normalized.reviewedFacts)
    || JSON.stringify(record.anchors) !== JSON.stringify(normalized.anchors)
  ) {
    throw new Error("Provider fact record facts and anchors must use canonical sorted bytes.");
  }
  const contentFactHash = sha256(normalized);
  if (record.contentFactHash !== contentFactHash) {
    throw new Error("Provider fact content hash does not match its concise reviewed facts and anchors.");
  }
  if (
    !HASH_PATTERN.test(String(record.sourceRecordHash || ""))
    || record.sourceRecordHash !== sha256(providerFactRecordHashBody(record))
  ) {
    throw new Error("Provider fact source-record hash does not match its exact retained review bytes.");
  }
  return record;
}

function createPreventureResearchProviderFactRecord(input = {}) {
  exactObjectKeys(input, [
    "id",
    "url",
    "retrievedAt",
    "checkedAt",
    "reviewedFactsHash",
    "reviewedFacts",
    "anchors",
  ], "Provider fact record input");
  const normalized = normalizedProviderFactContent(input.reviewedFacts, input.anchors);
  const body = {
    schema: PREVENTURE_RESEARCH_PROVIDER_FACT_RECORD_SCHEMA,
    id: safeId(input.id, "Provider fact record ID"),
    url: officialProviderSourceUrl(input.url, "Provider fact record URL"),
    retrievedAt: canonicalProviderFactTimestamp(
      input.retrievedAt,
      "Provider fact retrieval time",
    ),
    checkedAt: canonicalProviderFactTimestamp(input.checkedAt, "Provider fact check time"),
    reviewedFactsHash: input.reviewedFactsHash,
    reviewedFacts: normalized.reviewedFacts,
    anchors: normalized.anchors,
    contentFactHash: sha256(normalized),
  };
  const record = { ...body, sourceRecordHash: sha256(body) };
  validatePreventureResearchProviderFactRecord(record);
  return deepFreeze(record);
}

function providerReviewSourceReferences(
  urls,
  checkedAt,
  reviewedFactsHash,
  sourceRecordHashes,
  label,
) {
  const expectedUrls = [...urls].map(
    (url, index) => officialProviderSourceUrl(url, `${label} source ${index + 1}`),
  ).sort();
  if (!isObject(sourceRecordHashes)) {
    throw new Error(`${label} immutable source-record hashes must be one object.`);
  }
  const suppliedUrls = Object.keys(sourceRecordHashes).sort();
  if (JSON.stringify(suppliedUrls) !== JSON.stringify(expectedUrls)) {
    throw new Error(`${label} immutable source records must match every exact reviewed source URL.`);
  }
  return expectedUrls.map((url) => {
    const sourceRecordHash = sourceRecordHashes[url];
    if (!HASH_PATTERN.test(String(sourceRecordHash || ""))) {
      throw new Error(`${label} source record for ${url} must be an immutable SHA-256 reference.`);
    }
    return {
      url,
      checkedAt,
      reviewedFactsHash,
      sourceRecordHash,
    };
  });
}

function createPreventureResearchProviderReviewV2(provider, input = {}) {
  exactObjectKeys(input, ["checkedAt", "sourceRecordHashes"], "Provider facts review input");
  exactObjectKeys(
    input.sourceRecordHashes,
    ["model", "toolPolicy", "pricing"],
    "Provider facts review source records",
  );
  const checkedAt = exactTimestamp(input.checkedAt, "Provider facts review time");
  const facts = preventureResearchProviderFactHashes(provider);
  const body = {
    schema: PREVENTURE_RESEARCH_PROVIDER_REVIEW_SCHEMA,
    model: {
      checkedAt,
      factsHash: facts.model,
      sourceReferences: providerReviewSourceReferences(
        [provider?.modelCard?.sourceUrl],
        checkedAt,
        facts.model,
        input.sourceRecordHashes.model,
        "Provider model review",
      ),
    },
    toolPolicy: {
      checkedAt,
      factsHash: facts.toolPolicy,
      sourceReferences: providerReviewSourceReferences(
        provider?.requestPolicySourceUrls || [],
        checkedAt,
        facts.toolPolicy,
        input.sourceRecordHashes.toolPolicy,
        "Provider tool-policy review",
      ),
    },
    pricing: {
      checkedAt,
      factsHash: facts.pricing,
      sourceReferences: providerReviewSourceReferences(
        provider?.pricingPolicy?.sourceUrls || [],
        checkedAt,
        facts.pricing,
        input.sourceRecordHashes.pricing,
        "Provider pricing review",
      ),
    },
  };
  return deepFreeze({ ...body, reviewHash: sha256(body) });
}

function validateProviderReviewCategory(category, expected, label) {
  exactObjectKeys(
    category,
    ["checkedAt", "factsHash", "sourceReferences"],
    label,
  );
  const checkedAt = exactTimestamp(category.checkedAt, `${label} check time`);
  if (category.factsHash !== expected.factsHash) {
    throw new Error(`${label} no longer binds the exact provider facts.`);
  }
  if (!Array.isArray(category.sourceReferences) || category.sourceReferences.length < 1) {
    throw new Error(`${label} requires immutable official source references.`);
  }
  const references = category.sourceReferences.map((reference, index) => {
    exactObjectKeys(
      reference,
      ["url", "checkedAt", "reviewedFactsHash", "sourceRecordHash"],
      `${label} source reference ${index + 1}`,
    );
    const url = officialProviderSourceUrl(reference.url, `${label} source reference ${index + 1}`);
    if (
      reference.checkedAt !== checkedAt
      || reference.reviewedFactsHash !== expected.factsHash
      || !HASH_PATTERN.test(String(reference.sourceRecordHash || ""))
    ) {
      throw new Error(`${label} contains an unbound or mutable source reference.`);
    }
    return url;
  });
  if (
    JSON.stringify(references) !== JSON.stringify([...references].sort())
    || new Set(references).size !== references.length
    || JSON.stringify(references) !== JSON.stringify([...expected.urls].sort())
  ) {
    throw new Error(`${label} sources must be the exact sorted provider references.`);
  }
  return checkedAt;
}

function validatePreventureResearchProviderReviewV2(authority) {
  const review = authority?.providerReview;
  exactObjectKeys(
    review,
    ["schema", "model", "toolPolicy", "pricing", "reviewHash"],
    "Provider facts review",
  );
  if (review.schema !== PREVENTURE_RESEARCH_PROVIDER_REVIEW_SCHEMA) {
    throw new Error("Provider facts review schema is not supported.");
  }
  const facts = preventureResearchProviderFactHashes(authority.provider);
  const modelCheckedAt = validateProviderReviewCategory(review.model, {
    factsHash: facts.model,
    urls: [authority.provider.modelCard.sourceUrl],
  }, "Provider model review");
  const toolCheckedAt = validateProviderReviewCategory(review.toolPolicy, {
    factsHash: facts.toolPolicy,
    urls: authority.provider.requestPolicySourceUrls,
  }, "Provider tool-policy review");
  const pricingCheckedAt = validateProviderReviewCategory(review.pricing, {
    factsHash: facts.pricing,
    urls: authority.provider.pricingPolicy.sourceUrls,
  }, "Provider pricing review");
  if (
    modelCheckedAt !== toolCheckedAt
    || modelCheckedAt !== pricingCheckedAt
    || authority.provider.modelCard.checkedAt !== modelCheckedAt
    || authority.provider.pricingPolicy.checkedAt !== pricingCheckedAt
  ) {
    throw new Error("Provider model, tool-policy, pricing, and source checks must share one exact review time.");
  }
  const checkedAtMs = Date.parse(modelCheckedAt);
  const approvedAtMs = Date.parse(exactTimestamp(authority.approvedAt, "Authority approval time"));
  const expiresAtMs = Date.parse(exactTimestamp(authority.expiresAt, "Authority expiry time"));
  if (
    checkedAtMs > approvedAtMs
    || approvedAtMs - checkedAtMs > PREVENTURE_RESEARCH_PROVIDER_REVIEW_MAX_AGE_MS
  ) {
    throw new Error("Provider facts must be reviewed no more than 24 hours before authority approval.");
  }
  if (expiresAtMs > checkedAtMs + PREVENTURE_RESEARCH_PROVIDER_REVIEW_VALIDITY_MS) {
    throw new Error("Authority expiry cannot outlive the seven-day provider-facts review horizon.");
  }
  if (
    !HASH_PATTERN.test(String(review.reviewHash || ""))
    || review.reviewHash !== sha256(providerReviewHashBody(review))
  ) {
    throw new Error("Provider facts review hash does not match its exact immutable content.");
  }
  return review;
}

function validateAssignment(assignment, authority) {
  exactObjectKeys(assignment, [
    "id",
    "version",
    "title",
    "question",
    "provider",
    "model",
    "maxCostAudCents",
    "maxAttempts",
    "maxToolCalls",
    "maximumModelPasses",
    "maxInputTokens",
    "localPromptPreflightMaxInputTokens",
    "maxOutputTokens",
    "maxTurns",
    "deadlineMs",
    "worstCaseExposure",
    "requiredSourceClasses",
    "requiredOutputSections",
  ], "Research assignment");
  safeId(assignment.id, "Research assignment ID");
  safeId(assignment.version, "Research assignment version");
  cleanText(assignment.title, "Research assignment title", 8);
  cleanText(assignment.question, "Research assignment question", 20);
  if (assignment.provider !== authority.provider.id) {
    throw new Error(`Research assignment ${assignment.id} does not match the authority provider.`);
  }
  if (assignment.model !== authority.provider.model) {
    throw new Error(`Research assignment ${assignment.id} does not match the authority model.`);
  }
  const cap = exactInteger(assignment.maxCostAudCents, `${assignment.id} cost cap`, 1);
  if (cap !== EXACT_ASSIGNMENT_WORST_CASE_AUD_CENTS) {
    throw new Error(`Research assignment ${assignment.id} cost cap must remain exactly A$0.50.`);
  }
  if (cap > authority.internalAiSpendCapAudCents) {
    throw new Error(`Research assignment ${assignment.id} exceeds the total authority cap.`);
  }
  if (exactInteger(assignment.maxAttempts, `${assignment.id} maximum attempts`, 1) !== 1) {
    throw new Error(`Research assignment ${assignment.id} must stop after one provider attempt.`);
  }
  const maxToolCalls = exactInteger(assignment.maxToolCalls, `${assignment.id} maximum tool calls`, 1);
  if (maxToolCalls !== EXACT_ASSIGNMENT_MAX_TOOL_CALLS) {
    throw new Error(`Research assignment ${assignment.id} must remain exactly two maximum web-search calls.`);
  }
  const maximumModelPasses = exactInteger(
    assignment.maximumModelPasses,
    `${assignment.id} maximum model passes`,
    1,
  );
  if (maximumModelPasses !== EXACT_MAXIMUM_MODEL_PASSES || maximumModelPasses !== maxToolCalls + 1) {
    throw new Error(`Research assignment ${assignment.id} must price every search turn plus the final model pass.`);
  }
  const maxInputTokens = exactInteger(assignment.maxInputTokens, `${assignment.id} maximum input tokens`, 1);
  if (maxInputTokens !== EXACT_PROVIDER_MAX_INPUT_TOKENS) {
    throw new Error(`Research assignment ${assignment.id} must price the official 272,000-token provider input maximum.`);
  }
  const localPromptPreflightMaxInputTokens = exactInteger(
    assignment.localPromptPreflightMaxInputTokens,
    `${assignment.id} local prompt preflight maximum input tokens`,
    1,
  );
  if (localPromptPreflightMaxInputTokens !== EXACT_LOCAL_PROMPT_PREFLIGHT_MAX_INPUT_TOKENS) {
    throw new Error(`Research assignment ${assignment.id} local prompt preflight must remain 30,000 tokens.`);
  }
  if (localPromptPreflightMaxInputTokens > maxInputTokens) {
    throw new Error(`Research assignment ${assignment.id} local prompt preflight exceeds the provider input maximum.`);
  }
  const maxOutputTokens = exactInteger(assignment.maxOutputTokens, `${assignment.id} maximum output tokens`, 1);
  if (maxOutputTokens !== EXACT_ASSIGNMENT_MAX_OUTPUT_TOKENS) {
    throw new Error(`Research assignment ${assignment.id} output limit must remain exactly 12,000 tokens.`);
  }
  if (exactInteger(assignment.maxTurns, `${assignment.id} maximum turns`, 1) !== 1) {
    throw new Error(`Research assignment ${assignment.id} must remain a single provider turn.`);
  }
  const deadlineMs = exactInteger(assignment.deadlineMs, `${assignment.id} deadline`, 5_000);
  if (deadlineMs > 180_000) throw new Error(`Research assignment ${assignment.id} exceeds the three-minute deadline.`);
  const sourceClasses = exactStringList(
    assignment.requiredSourceClasses,
    `${assignment.id} required source classes`,
    { minimum: 1 },
  );
  if (sourceClasses.some((sourceClass) => !REQUIRED_SOURCE_CLASSES.includes(sourceClass))) {
    throw new Error(`Research assignment ${assignment.id} contains an unapproved source class.`);
  }
  const requiredSectionsByAssignment = {
    comparator_and_buyer_evidence: ["buyerEvidence", "comparators", "contraryEvidence", "limitations", "sources"],
    format_channel_and_economics: ["channelCases", "contraryEvidence", "economicsCases", "formatCases", "limitations", "sources"],
    independent_readiness_review: ["limitations", "materialContradictions", "readinessGates", "recommendation", "sources", "whatWouldReverseDecision"],
  };
  const sections = exactStringList(
    assignment.requiredOutputSections,
    `${assignment.id} required output sections`,
    { minimum: 2 },
  );
  if (!sameValues(sections, requiredSectionsByAssignment[assignment.id] || [])) {
    throw new Error(`Research assignment ${assignment.id} output sections changed.`);
  }
  const worstCase = calculatePreventureResearchWorstCaseExposureAud(
    authority.provider.pricingPolicy,
    {
      maxInputTokens,
      maxOutputTokens,
      maxToolCalls,
      maximumModelPasses,
    },
  );
  if (
    !isObject(assignment.worstCaseExposure)
    || sha256(assignment.worstCaseExposure) !== sha256(worstCase)
  ) {
    throw new Error(`Research assignment ${assignment.id} persisted worst-case exposure changed.`);
  }
  if (
    worstCase.amountAudCents !== EXACT_ASSIGNMENT_WORST_CASE_AUD_CENTS
    || worstCase.amountAudCents > cap
  ) {
    throw new Error(`Research assignment ${assignment.id} worst-case priced exposure exceeds its exact cap.`);
  }
  return cap;
}

function validatePreventureResearchAuthorityV1(authority, readinessSpec) {
  exactObjectKeys(
    authority,
    PREVENTURE_RESEARCH_AUTHORITY_V1_FIELDS,
    "Pre-venture research authority",
  );
  if (authority.schema !== PREVENTURE_RESEARCH_AUTHORITY_SCHEMA) {
    throw new Error("Pre-venture research authority schema is not supported.");
  }
  safeId(authority.id, "Pre-venture research authority ID");
  safeId(authority.version, "Pre-venture research authority version");
  if (!HASH_PATTERN.test(String(authority.authorityHash || ""))) {
    throw new Error("Pre-venture research authority hash is invalid.");
  }
  if (!isObject(readinessSpec)) throw new Error("The bound readiness specification is unavailable.");
  exactObjectKeys(authority.readinessBinding, ["id", "version", "hash"], "Readiness binding");
  if (authority.readinessBinding.id !== readinessSpec.id || authority.readinessBinding.version !== readinessSpec.version) {
    throw new Error("The research authority names a different readiness record.");
  }
  const currentReadinessHash = sha256(readinessSpec);
  if (authority.readinessBinding.hash !== currentReadinessHash) {
    throw new Error("The research authority does not match the exact readiness record bytes.");
  }
  exactObjectKeys(authority.opportunity, [
    "id",
    "name",
    "buyer",
    "problem",
    "offer",
    "distinctFromStoppedWork",
    "stoppedWorkNotReopened",
  ], "Opportunity");
  safeId(authority.opportunity.id, "Opportunity ID");
  cleanText(authority.opportunity.name, "Opportunity name", 10);
  cleanText(authority.opportunity.buyer, "Opportunity buyer", 10);
  cleanText(authority.opportunity.problem, "Opportunity problem", 20);
  cleanText(authority.opportunity.offer, "Opportunity offer", 20);
  exactBoolean(authority.opportunity.distinctFromStoppedWork, "Opportunity distinction", true);
  cleanText(authority.opportunity.stoppedWorkNotReopened, "Stopped work boundary", 10);
  safeId(authority.commercialConstitutionVersion, "Commercial Constitution version");
  if (authority.preparationOnly !== true) throw new Error("Pre-venture research must remain preparation-only.");
  if (exactInteger(authority.externalCommercialSpendCapAudCents, "External commercial spend cap") !== 0) {
    throw new Error("Pre-venture research cannot authorize external commercial spend.");
  }
  const totalCap = exactInteger(authority.internalAiSpendCapAudCents, "Internal AI spend cap", 1);
  if (totalCap !== 200) throw new Error("The approved pre-venture research cap is exactly A$2.00.");
  const totalWorstCaseExposureAudCents = exactInteger(
    authority.totalWorstCaseExposureAudCents,
    "Total worst-case research exposure",
    1,
  );
  if (totalWorstCaseExposureAudCents !== EXACT_TOTAL_WORST_CASE_AUD_CENTS) {
    throw new Error("The three-assignment worst-case exposure must remain exactly A$1.50.");
  }
  if (totalWorstCaseExposureAudCents > totalCap) {
    throw new Error("The worst-case research exposure exceeds the A$2.00 authority cap.");
  }
  exactObjectKeys(authority.comparatorScope, [
    "minimumOffers",
    "maximumOffers",
    "directOrNearDirectMinimum",
    "adjacentMinimum",
    "indirectMinimum",
    "minimumPerApprovedFormat",
    "acceptedOffersPerSellerMaximum",
    "reviewObservationMaximum",
    "etsyEvidenceRequired",
    "gumroadEvidenceRequired",
    "lawfulAlternativeDiscoveryOnly",
  ], "Comparator scope");
  if (
    exactInteger(authority.comparatorScope.minimumOffers, "Comparator minimum", 1) !== 10
    || exactInteger(authority.comparatorScope.maximumOffers, "Comparator maximum", 1) !== 15
  ) {
    throw new Error("The comparator scope must remain 10 to 15 offers.");
  }
  if (
    exactInteger(authority.comparatorScope.directOrNearDirectMinimum, "Direct comparator minimum", 1) !== 4
    || exactInteger(authority.comparatorScope.adjacentMinimum, "Adjacent comparator minimum", 1) !== 3
    || exactInteger(authority.comparatorScope.indirectMinimum, "Indirect comparator minimum", 1) !== 2
    || exactInteger(authority.comparatorScope.minimumPerApprovedFormat, "Per-format comparator minimum", 1) !== 2
    || exactInteger(authority.comparatorScope.acceptedOffersPerSellerMaximum, "Per-seller comparator maximum", 1) !== 2
    || exactInteger(authority.comparatorScope.reviewObservationMaximum, "Review observation maximum", 1) !== 30
  ) {
    throw new Error("The approved comparator distribution or review boundary changed.");
  }
  exactBoolean(authority.comparatorScope.etsyEvidenceRequired, "Etsy evidence requirement", true);
  exactBoolean(authority.comparatorScope.gumroadEvidenceRequired, "Gumroad evidence requirement", true);
  exactBoolean(authority.comparatorScope.lawfulAlternativeDiscoveryOnly, "Alternative-channel discovery boundary", true);
  const formats = exactStringList(authority.formats, "Product formats", { minimum: 3, sorted: true });
  if (!sameValues(formats, EXACT_FORMAT_IDS)) throw new Error("The three approved product formats changed.");
  if (!Array.isArray(authority.priceCasesAudCents) || !sameValues(authority.priceCasesAudCents, EXACT_PRICE_CASES)) {
    throw new Error("The approved A$19, A$29, and A$39 cases changed.");
  }
  const channels = exactStringList(authority.channelCases, "Channel cases", { minimum: 4, sorted: true });
  if (!sameValues(channels, REQUIRED_CHANNEL_IDS)) throw new Error("The approved channel and retain-cash cases changed.");
  const prohibited = exactStringList(authority.prohibitedActions, "Prohibited actions", { minimum: REQUIRED_PROHIBITED_ACTIONS.length, sorted: true });
  for (const action of REQUIRED_PROHIBITED_ACTIONS) {
    if (!prohibited.includes(action)) throw new Error(`Pre-venture research must prohibit ${action}.`);
  }
  const methods = exactStringList(authority.allowedMethods, "Allowed research methods", { minimum: 2, sorted: true });
  const methodAllowlist = new Set(["deterministic_local_synthesis", "openai_responses_web_search"]);
  if (methods.some((method) => !methodAllowlist.has(method))) {
    throw new Error("The research authority contains an unapproved method.");
  }
  exactObjectKeys(authority.provider, [
    "id",
    "model",
    "modelCard",
    "endpointPolicy",
    "tool",
    "externalWebAccess",
    "responseStorage",
    "providerTraceContent",
    "localEvidenceStored",
    "requestPolicy",
    "requestPolicySourceUrls",
    "pricingPolicy",
    "pricingPolicyHash",
  ], "Provider binding");
  if (authority.provider.id !== "openai-responses-web-search") {
    throw new Error("The pre-venture provider is not the reviewed public web-search adapter.");
  }
  if (authority.provider.model !== EXACT_PREVENTURE_MODEL) {
    throw new Error("The research provider must remain the exact reviewed GPT-5 mini snapshot.");
  }
  exactObjectKeys(authority.provider.modelCard, [
    "modelId",
    "snapshot",
    "contextWindowTokens",
    "maxInputTokens",
    "maxOutputTokens",
    "checkedAt",
    "sourceUrl",
  ], "Provider model card");
  if (
    authority.provider.modelCard.modelId !== EXACT_PREVENTURE_PRICING_MODEL
    || authority.provider.modelCard.snapshot !== EXACT_PREVENTURE_MODEL
    || authority.provider.modelCard.contextWindowTokens !== 400_000
    || authority.provider.modelCard.maxInputTokens !== EXACT_PROVIDER_MAX_INPUT_TOKENS
    || authority.provider.modelCard.maxOutputTokens !== EXACT_PROVIDER_MAX_OUTPUT_TOKENS
    || authority.provider.modelCard.checkedAt !== EXACT_PREVENTURE_CHECKED_AT
    || authority.provider.modelCard.sourceUrl !== EXACT_PREVENTURE_MODEL_CARD_URL
  ) throw new Error("The exact reviewed provider model card or snapshot changed.");
  if (authority.provider.endpointPolicy !== "official_openai_responses_only") {
    throw new Error("The research provider endpoint policy is not fail-closed.");
  }
  if (authority.provider.tool !== "web_search") throw new Error("The research provider tool must remain web_search.");
  exactBoolean(authority.provider.externalWebAccess, "Provider public-web access", true);
  exactBoolean(authority.provider.responseStorage, "Provider response storage", false);
  exactBoolean(authority.provider.providerTraceContent, "Provider trace content", false);
  exactBoolean(authority.provider.localEvidenceStored, "Local evidence retention", true);
  exactObjectKeys(authority.provider.requestPolicy, [
    "service_tier",
    "background",
    "store",
    "tools",
    "tool_choice",
    "include",
    "parallel_tool_calls",
    "reasoning",
    "text",
  ], "Provider request policy");
  if (authority.provider.requestPolicy.service_tier !== "default") {
    throw new Error("Pre-venture research must use standard/default provider processing.");
  }
  exactBoolean(authority.provider.requestPolicy.background, "Provider background mode", false);
  exactBoolean(authority.provider.requestPolicy.store, "Provider request storage", false);
  exactBoolean(authority.provider.requestPolicy.parallel_tool_calls, "Provider parallel tool calls", false);
  exactObjectKeys(authority.provider.requestPolicy.reasoning, ["effort"], "Provider reasoning policy");
  if (authority.provider.requestPolicy.reasoning.effort !== "low") {
    throw new Error("Pre-venture research must keep the reviewed low reasoning effort within its output budget.");
  }
  if (authority.provider.requestPolicy.tool_choice !== "required") {
    throw new Error("Pre-venture research must require the reviewed web-search tool.");
  }
  if (
    !Array.isArray(authority.provider.requestPolicy.include)
    || JSON.stringify(authority.provider.requestPolicy.include) !== JSON.stringify(["web_search_call.action.sources"])
  ) throw new Error("Pre-venture research must include the complete provider web-search source list.");
  if (!Array.isArray(authority.provider.requestPolicy.tools) || authority.provider.requestPolicy.tools.length !== 1) {
    throw new Error("Pre-venture research must bind exactly one hosted provider tool.");
  }
  const [webSearchTool] = authority.provider.requestPolicy.tools;
  exactObjectKeys(webSearchTool, [
    "type",
    "external_web_access",
    "return_token_budget",
    "search_context_size",
  ], "Provider web-search tool policy");
  if (
    webSearchTool.type !== "web_search"
    || webSearchTool.external_web_access !== true
    || webSearchTool.return_token_budget !== "default"
    || webSearchTool.search_context_size !== "medium"
  ) throw new Error("The hosted web-search type or returned-context controls changed.");
  exactObjectKeys(authority.provider.requestPolicy.text, ["format"], "Provider text policy");
  exactObjectKeys(authority.provider.requestPolicy.text.format, [
    "type",
    "name",
    "strict",
    "schemaBinding",
  ], "Provider structured-output policy");
  if (
    authority.provider.requestPolicy.text.format.type !== "json_schema"
    || authority.provider.requestPolicy.text.format.name !== "preventure_research_result"
    || authority.provider.requestPolicy.text.format.strict !== true
    || authority.provider.requestPolicy.text.format.schemaBinding !== "server_owned_assignment_schema"
  ) throw new Error("The strict server-owned structured-output policy changed.");
  const expectedRequestPolicySourceUrls = [
    EXACT_PREVENTURE_STRUCTURED_OUTPUT_GUIDE_URL,
    `${EXACT_PREVENTURE_WEB_SEARCH_GUIDE_URL}#live-internet-access`,
    `${EXACT_PREVENTURE_WEB_SEARCH_GUIDE_URL}#output-and-citations`,
    `${EXACT_PREVENTURE_WEB_SEARCH_GUIDE_URL}#run-longer-web-research`,
    `${EXACT_PREVENTURE_WEB_SEARCH_GUIDE_URL}#search-context-size`,
    "https://developers.openai.com/api/reference/resources/responses/methods/create",
  ];
  if (
    JSON.stringify(exactStringList(
      authority.provider.requestPolicySourceUrls,
      "Provider request-policy sources",
      { minimum: expectedRequestPolicySourceUrls.length, sorted: true },
    )) !== JSON.stringify(expectedRequestPolicySourceUrls)
  ) throw new Error("The exact official provider request-policy sources changed.");
  exactObjectKeys(authority.provider.pricingPolicy, [
    "model",
    "pricingModel",
    "pricingTier",
    "inputUsdPerMillionTokens",
    "outputUsdPerMillionTokens",
    "webSearchUsdPerThousandCalls",
    "audPerUsdCeiling",
    "checkedAt",
    "sourceUrls",
    "exactBillingPending",
  ], "Provider pricing policy");
  if (
    authority.provider.pricingPolicy.model !== authority.provider.model
    || authority.provider.pricingPolicy.pricingModel !== EXACT_PREVENTURE_PRICING_MODEL
    || authority.provider.pricingPolicy.pricingTier !== "standard"
    || authority.provider.pricingPolicy.inputUsdPerMillionTokens !== 0.25
    || authority.provider.pricingPolicy.outputUsdPerMillionTokens !== 2
    || authority.provider.pricingPolicy.webSearchUsdPerThousandCalls !== 10
    || authority.provider.pricingPolicy.audPerUsdCeiling !== 2
  ) throw new Error("The reviewed worst-case provider pricing policy changed.");
  if (authority.provider.pricingPolicy.checkedAt !== EXACT_PREVENTURE_CHECKED_AT) {
    throw new Error("The reviewed provider pricing check date changed.");
  }
  const expectedPricingSourceUrls = [EXACT_PREVENTURE_MODEL_CARD_URL, EXACT_PREVENTURE_PRICING_URL];
  if (
    JSON.stringify(exactStringList(
      authority.provider.pricingPolicy.sourceUrls,
      "Provider pricing sources",
      { minimum: expectedPricingSourceUrls.length, sorted: true },
    )) !== JSON.stringify(expectedPricingSourceUrls)
  ) throw new Error("The exact official provider pricing sources changed.");
  exactBoolean(authority.provider.pricingPolicy.exactBillingPending, "Provider exact-billing state", true);
  if (
    !HASH_PATTERN.test(String(authority.provider.pricingPolicyHash || ""))
    || authority.provider.pricingPolicyHash !== sha256(authority.provider.pricingPolicy)
  ) throw new Error("The provider pricing-policy hash is invalid.");

  exactObjectKeys(authority.sourcePolicy, [
    "tiers",
    "classes",
    "access",
    "disallowedAccess",
    "factsRemainDistinct",
    "listingVisibilityDoesNotProve",
    "contraryEvidenceRequired",
  ], "Source policy");
  if (!sameValues(authority.sourcePolicy.tiers || [], [1, 2, 3, 4])) {
    throw new Error("The source-tier policy changed.");
  }
  if (!sameValues(authority.sourcePolicy.classes || [], REQUIRED_SOURCE_CLASSES)) {
    throw new Error("The source-class policy changed.");
  }
  if (authority.sourcePolicy.access !== "public_lawful_read_only") {
    throw new Error("Research access must remain public, lawful, and read-only.");
  }
  if (!sameValues(authority.sourcePolicy.disallowedAccess || [], REQUIRED_DISALLOWED_ACCESS)) {
    throw new Error("The prohibited-access boundary changed.");
  }
  if (!sameValues(authority.sourcePolicy.factsRemainDistinct || [], REQUIRED_FACT_CLASSES)) {
    throw new Error("The commercial evidence classes must remain distinct.");
  }
  if (!sameValues(authority.sourcePolicy.listingVisibilityDoesNotProve || [], VISIBILITY_DOES_NOT_PROVE)) {
    throw new Error("The marketplace visibility limitation changed.");
  }
  exactBoolean(authority.sourcePolicy.contraryEvidenceRequired, "Contrary-evidence requirement", true);

  if (!Array.isArray(authority.researchQuestions)) throw new Error("Research questions are missing.");
  const questionIds = authority.researchQuestions.map((item, index) => {
    exactObjectKeys(item, ["id", "question"], `Research question ${index}`);
    safeId(item.id, `Research question ${index} ID`);
    cleanText(item.question, `Research question ${index}`, 20);
    return item.id;
  });
  if (!sameValues(questionIds, REQUIRED_RESEARCH_QUESTION_IDS)) {
    throw new Error("The required diligence questions changed.");
  }

  if (!Array.isArray(authority.assignments) || authority.assignments.length !== REQUIRED_ASSIGNMENT_IDS.length) {
    throw new Error("The research authority must contain the three reviewed assignments.");
  }
  const assignmentIds = new Set();
  let assignedCap = 0;
  for (const assignment of authority.assignments) {
    if (assignmentIds.has(assignment.id)) throw new Error("Research assignment IDs must be unique.");
    assignmentIds.add(assignment.id);
    assignedCap += validateAssignment(assignment, authority);
  }
  if (!sameValues([...assignmentIds], REQUIRED_ASSIGNMENT_IDS)) {
    throw new Error("The reviewed research assignment set changed.");
  }
  if (assignedCap > totalCap) throw new Error("Assignment caps exceed the A$2.00 authority cap.");
  const computedWorstCaseExposureAudCents = authority.assignments.reduce(
    (sum, assignment) => sum + assignment.worstCaseExposure.amountAudCents,
    0,
  );
  if (
    computedWorstCaseExposureAudCents !== totalWorstCaseExposureAudCents
    || assignedCap !== totalWorstCaseExposureAudCents
  ) {
    throw new Error("Persisted assignment and authority worst-case exposures do not reconcile exactly.");
  }
  if (!Array.isArray(authority.ownerInputs) || authority.ownerInputs.length !== 4) {
    throw new Error("The exact owner inputs are missing from the authority.");
  }
  const ownerInputIds = new Set();
  for (const [index, ownerInput] of authority.ownerInputs.entries()) {
    if (!isObject(ownerInput)) throw new Error(`Owner input ${index} must be an object.`);
    safeId(ownerInput.id, `Owner input ${index} ID`);
    if (ownerInputIds.has(ownerInput.id)) throw new Error("Owner input IDs must be unique.");
    ownerInputIds.add(ownerInput.id);
    if (!['owner_attestation', 'owner_preference'].includes(ownerInput.kind)) {
      throw new Error(`Owner input ${ownerInput.id} has an unsupported evidence class.`);
    }
    cleanText(ownerInput.assertion, `Owner input ${ownerInput.id} assertion`, 12);
    exactTimestamp(ownerInput.confirmedAt, `Owner input ${ownerInput.id} confirmation time`);
    if (ownerInput.secretsStored !== false) throw new Error("Owner inputs cannot contain secrets.");
  }
  const requiredOwnerInputIds = [
    "better_lawful_channel_allowed",
    "bounded_internal_research_budget",
    "etsy_owner_only_steps_if_selected",
    "etsy_seller_account_exists",
  ];
  if (!sameValues([...ownerInputIds], requiredOwnerInputIds)) {
    throw new Error("The exact owner attestations and preferences changed.");
  }
  const budgetInput = authority.ownerInputs.find((item) => item.id === "bounded_internal_research_budget");
  const etsyInput = authority.ownerInputs.find((item) => item.id === "etsy_seller_account_exists");
  const ownerStepInput = authority.ownerInputs.find((item) => item.id === "etsy_owner_only_steps_if_selected");
  const channelInput = authority.ownerInputs.find((item) => item.id === "better_lawful_channel_allowed");
  if (budgetInput?.kind !== "owner_preference" || budgetInput?.state !== "confirmed") {
    throw new Error("The bounded research-budget owner preference is not confirmed.");
  }
  if (
    etsyInput?.kind !== "owner_attestation"
    || etsyInput?.verificationState !== "owner_reported_unverified"
    || etsyInput?.evidenceAttached !== false
    || !sameValues(etsyInput?.assertionScope || [], ["seller_account_exists"])
  ) {
    throw new Error("The Etsy account fact must remain owner-reported and unverified.");
  }
  if (ownerStepInput?.kind !== "owner_preference" || ownerStepInput?.state !== "approved_in_principle_not_performed") {
    throw new Error("Future Etsy owner-only steps must remain approved in principle but unperformed.");
  }
  if (channelInput?.kind !== "owner_preference" || channelInput?.state !== "confirmed") {
    throw new Error("The better-lawful-channel owner preference is not confirmed.");
  }
  const approvedAt = exactTimestamp(authority.approvedAt, "Authority approval time");
  const expiresAt = exactTimestamp(authority.expiresAt, "Authority expiry time");
  if (Date.parse(expiresAt) <= Date.parse(approvedAt)) throw new Error("Authority expiry must be after approval.");
  if (Date.parse(expiresAt) - Date.parse(approvedAt) > 7 * 24 * 60 * 60 * 1000) {
    throw new Error("Pre-venture research authority cannot remain active for more than seven days.");
  }
  if (!sameValues(authority.allowedOutcomes || [], AUTHORITY_OUTCOMES)) {
    throw new Error("The allowed diligence outcomes changed.");
  }
  exactObjectKeys(authority.completionRules, [
    "oneRoundOnly",
    "stopOnUnknownProviderOutcomeOrCost",
    "noAutomaticRetryAfterDispatch",
    "decisionMustCompareRetainingCash",
    "buildMeansRecommendationOnly",
    "separateBuildAuthorityRequired",
    "separateCommercialTestAuthorityRequired",
    "separateExternalActionAuthorityRequired",
  ], "Completion rules");
  for (const [key, value] of Object.entries(authority.completionRules)) {
    exactBoolean(value, `Completion rule ${key}`, true);
  }
  const expectedHash = sha256(authorityHashBody(authority));
  if (authority.authorityHash !== expectedHash) {
    throw new Error("The pre-venture research authority hash does not match its exact content.");
  }
  return authority;
}

function v1CompatibilityAuthorityForV2(authority) {
  const {
    authorityHash: _authorityHash,
    providerReview: _providerReview,
    supersedesAuthorityHash: _supersedesAuthorityHash,
    ...shared
  } = authority;
  const pricingPolicy = {
    ...authority.provider.pricingPolicy,
    checkedAt: EXACT_PREVENTURE_CHECKED_AT,
  };
  const body = {
    ...shared,
    schema: PREVENTURE_RESEARCH_AUTHORITY_SCHEMA,
    provider: {
      ...authority.provider,
      modelCard: {
        ...authority.provider.modelCard,
        checkedAt: EXACT_PREVENTURE_CHECKED_AT,
      },
      pricingPolicy,
      pricingPolicyHash: sha256(pricingPolicy),
    },
  };
  return { ...body, authorityHash: sha256(body) };
}

function validatePreventureResearchAuthorityV2(authority, readinessSpec) {
  exactObjectKeys(
    authority,
    PREVENTURE_RESEARCH_AUTHORITY_V2_FIELDS,
    "Pre-venture research authority v2",
  );
  if (authority.schema !== PREVENTURE_RESEARCH_AUTHORITY_V2_SCHEMA) {
    throw new Error("Pre-venture research authority v2 schema is not supported.");
  }
  if (
    !HASH_PATTERN.test(String(authority.authorityHash || ""))
    || authority.authorityHash !== sha256(authorityHashBody(authority))
  ) {
    throw new Error("Pre-venture research authority v2 hash does not match its exact content.");
  }
  if (
    !HASH_PATTERN.test(String(authority.supersedesAuthorityHash || ""))
    || authority.supersedesAuthorityHash === authority.authorityHash
  ) {
    throw new Error("Pre-venture research authority v2 requires one different exact predecessor hash.");
  }
  if (authority.provider?.pricingPolicyHash !== sha256(authority.provider?.pricingPolicy)) {
    throw new Error("Pre-venture research authority v2 pricing-policy hash is invalid.");
  }
  validatePreventureResearchProviderReviewV2(authority);
  validatePreventureResearchAuthorityV1(
    v1CompatibilityAuthorityForV2(authority),
    readinessSpec,
  );
  return authority;
}

function validatePreventureResearchAuthority(authority, readinessSpec) {
  if (authority?.schema === PREVENTURE_RESEARCH_AUTHORITY_SCHEMA) {
    return validatePreventureResearchAuthorityV1(authority, readinessSpec);
  }
  if (authority?.schema === PREVENTURE_RESEARCH_AUTHORITY_V2_SCHEMA) {
    return validatePreventureResearchAuthorityV2(authority, readinessSpec);
  }
  throw new Error("Pre-venture research authority schema is not supported.");
}

function createPreventureResearchAuthority(input, readinessSpec) {
  const body = {
    ...input,
    schema: PREVENTURE_RESEARCH_AUTHORITY_SCHEMA,
    readinessBinding: {
      id: readinessSpec?.id,
      version: readinessSpec?.version,
      hash: sha256(readinessSpec),
    },
  };
  const authority = { ...body, authorityHash: sha256(body) };
  validatePreventureResearchAuthority(authority, readinessSpec);
  return deepFreeze(authority);
}

function createPreventureResearchAuthorityV2(input, readinessSpec) {
  const body = {
    ...input,
    schema: PREVENTURE_RESEARCH_AUTHORITY_V2_SCHEMA,
    readinessBinding: {
      id: readinessSpec?.id,
      version: readinessSpec?.version,
      hash: sha256(readinessSpec),
    },
  };
  const authority = { ...body, authorityHash: sha256(body) };
  validatePreventureResearchAuthority(authority, readinessSpec);
  return deepFreeze(authority);
}

function lifecycleState(events = []) {
  if (!events.length) return "unregistered";
  return events.at(-1).eventType;
}

function effectivePreventureLifecycleState(authority, events = [], at = new Date().toISOString()) {
  validatePreventureLifecycleChain(authority, events);
  const state = lifecycleState(events);
  if (
    !["unregistered", ...TERMINAL_EVENT_TYPES].includes(state)
    && Date.parse(exactTimestamp(at, "Lifecycle evaluation time")) >= Date.parse(authority.expiresAt)
  ) return "expired";
  return state;
}

function preventureResearchApprovalScope(authority, eventType) {
  if (!isObject(authority) || authority.authorityHash !== sha256(authorityHashBody(authority))) {
    throw new Error("Approval scope requires an intact pre-venture research authority.");
  }
  if (!["accepted", "activated"].includes(eventType)) {
    throw new Error("Only acceptance or activation can establish pre-venture research authority.");
  }
  if (authority.schema === PREVENTURE_RESEARCH_AUTHORITY_V2_SCHEMA) {
    validatePreventureResearchProviderReviewV2(authority);
    return deepFreeze({
      schema: PREVENTURE_RESEARCH_APPROVAL_SCOPE_V2_SCHEMA,
      eventType,
      authority: {
        schema: authority.schema,
        id: authority.id,
        version: authority.version,
        hash: authority.authorityHash,
        supersedesAuthorityHash: authority.supersedesAuthorityHash,
      },
      readinessBinding: authority.readinessBinding,
      opportunityId: authority.opportunity.id,
      provider: {
        id: authority.provider.id,
        model: authority.provider.model,
        endpointPolicy: authority.provider.endpointPolicy,
        tool: authority.provider.tool,
        modelCheckedAt: authority.providerReview.model.checkedAt,
        modelFactsHash: authority.providerReview.model.factsHash,
        toolPolicyCheckedAt: authority.providerReview.toolPolicy.checkedAt,
        toolPolicyFactsHash: authority.providerReview.toolPolicy.factsHash,
        pricingCheckedAt: authority.providerReview.pricing.checkedAt,
        pricingFactsHash: authority.providerReview.pricing.factsHash,
        providerReviewHash: authority.providerReview.reviewHash,
        pricingPolicyHash: authority.provider.pricingPolicyHash,
      },
      assignmentsHash: sha256(authority.assignments),
      allowedMethodsHash: sha256(authority.allowedMethods),
      prohibitedActionsHash: sha256(authority.prohibitedActions),
      internalAiSpendCapAudCents: authority.internalAiSpendCapAudCents,
      totalWorstCaseExposureAudCents: authority.totalWorstCaseExposureAudCents,
      externalCommercialSpendCapAudCents: authority.externalCommercialSpendCapAudCents,
      expiresAt: authority.expiresAt,
      preparationOnly: true,
      buildAuthorized: false,
      commercialTestAuthorized: false,
      externalActionAuthorized: false,
    });
  }
  if (authority.schema !== PREVENTURE_RESEARCH_AUTHORITY_SCHEMA) {
    throw new Error("Approval scope requires a supported pre-venture research authority schema.");
  }
  return deepFreeze({
    schema: PREVENTURE_RESEARCH_APPROVAL_SCOPE_SCHEMA,
    eventType,
    authority: {
      id: authority.id,
      version: authority.version,
      hash: authority.authorityHash,
    },
    readinessBinding: authority.readinessBinding,
    opportunityId: authority.opportunity.id,
    provider: {
      id: authority.provider.id,
      model: authority.provider.model,
      endpointPolicy: authority.provider.endpointPolicy,
      tool: authority.provider.tool,
      pricingPolicyHash: authority.provider.pricingPolicyHash,
    },
    assignmentsHash: sha256(authority.assignments),
    allowedMethodsHash: sha256(authority.allowedMethods),
    prohibitedActionsHash: sha256(authority.prohibitedActions),
    internalAiSpendCapAudCents: authority.internalAiSpendCapAudCents,
    externalCommercialSpendCapAudCents: authority.externalCommercialSpendCapAudCents,
    expiresAt: authority.expiresAt,
    preparationOnly: true,
    buildAuthorized: false,
    commercialTestAuthorized: false,
    externalActionAuthorized: false,
  });
}

function preventureResearchApprovalScopeHash(authority, eventType) {
  return sha256(preventureResearchApprovalScope(authority, eventType));
}

function lifecycleEventHashBody(event) {
  const { eventHash: _eventHash, ...body } = event;
  return body;
}

function validatePreventureLifecycleChain(authority, events = []) {
  if (!Array.isArray(events)) throw new Error("Pre-venture lifecycle must be an array.");
  if (!isObject(authority) || authority.authorityHash !== sha256(authorityHashBody(authority))) {
    throw new Error("Lifecycle validation requires an intact authority.");
  }
  const seenIds = new Set();
  const seenHashes = new Set();
  const usedApprovalIds = new Set();
  const approvedAtMs = Date.parse(exactTimestamp(authority.approvedAt, "Authority approval time"));
  const expiresAtMs = Date.parse(exactTimestamp(authority.expiresAt, "Authority expiry time"));

  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    exactObjectKeys(event, [
      "schema",
      "id",
      "authorityHash",
      "sequence",
      "previousEventHash",
      "eventType",
      "approvalId",
      "approvalScopeHash",
      "actor",
      "reason",
      "occurredAt",
      "metadata",
      "eventHash",
    ], `Lifecycle event ${index + 1}`);
    if (event.schema !== PREVENTURE_RESEARCH_LIFECYCLE_SCHEMA) {
      throw new Error(`Lifecycle event ${index + 1} schema is unsupported.`);
    }
    safeId(event.id, `Lifecycle event ${index + 1} ID`);
    if (seenIds.has(event.id)) throw new Error("Lifecycle event IDs must be unique.");
    seenIds.add(event.id);
    if (event.authorityHash !== authority.authorityHash) {
      throw new Error(`Lifecycle event ${event.id} belongs to a different authority.`);
    }
    if (exactInteger(event.sequence, `Lifecycle event ${event.id} sequence`, 1) !== index + 1) {
      throw new Error("Pre-venture lifecycle sequence must be contiguous from one.");
    }
    const previous = events[index - 1] || null;
    const expectedPreviousHash = previous?.eventHash || null;
    if (event.previousEventHash !== expectedPreviousHash) {
      throw new Error(`Lifecycle event ${event.id} does not bind the previous event hash.`);
    }
    if (!LIFECYCLE_EVENT_TYPES.includes(event.eventType)) {
      throw new Error(`Lifecycle event ${event.id} type is unsupported.`);
    }
    if (index === 0 && event.eventType !== "proposed") {
      throw new Error("A pre-venture authority must begin with a proposed event.");
    }
    if (previous && !LIFECYCLE_TRANSITIONS[previous.eventType]?.has(event.eventType)) {
      throw new Error(`Pre-venture lifecycle cannot move from ${previous.eventType} to ${event.eventType}.`);
    }
    if (previous && TERMINAL_EVENT_TYPES.has(previous.eventType)) {
      throw new Error("A terminal pre-venture authority cannot reopen.");
    }
    cleanText(event.actor, `Lifecycle event ${event.id} actor`);
    cleanText(event.reason, `Lifecycle event ${event.id} reason`, 8);
    if (!isObject(event.metadata)) throw new Error(`Lifecycle event ${event.id} metadata must be an object.`);
    const occurredAtMs = Date.parse(exactTimestamp(event.occurredAt, `Lifecycle event ${event.id} time`));
    if (occurredAtMs < approvedAtMs) {
      throw new Error(`Lifecycle event ${event.id} predates the approved authority record.`);
    }
    if (previous && occurredAtMs < Date.parse(previous.occurredAt)) {
      throw new Error(`Lifecycle event ${event.id} moves backward in time.`);
    }
    if (event.eventType === "expired") {
      if (occurredAtMs < expiresAtMs) throw new Error("An expiry event cannot be recorded before authority expiry.");
    } else if (occurredAtMs >= expiresAtMs) {
      throw new Error(`Lifecycle event ${event.id} cannot occur after authority expiry.`);
    }
    if (["accepted", "activated"].includes(event.eventType)) {
      if (event.actor !== "owner") {
        throw new Error(`${event.eventType} must be recorded as an authenticated owner decision.`);
      }
      safeId(event.approvalId, `Lifecycle event ${event.id} approval ID`);
      if (usedApprovalIds.has(event.approvalId)) {
        throw new Error("Acceptance and activation must use distinct single-use approvals.");
      }
      usedApprovalIds.add(event.approvalId);
      const exactScopeHash = preventureResearchApprovalScopeHash(authority, event.eventType);
      if (event.approvalScopeHash !== exactScopeHash) {
        throw new Error(`${event.eventType} does not bind the exact approved pre-venture scope.`);
      }
    } else if (event.approvalId !== null || event.approvalScopeHash !== null) {
      throw new Error(`Lifecycle event ${event.id} cannot consume an approval.`);
    }
    if (event.eventType === "completed") {
      exactObjectKeys(event.metadata, [
        "decisionHash",
        "evidenceSetHash",
        "receiptSetHash",
        "resultingReadinessHash",
        "outcome",
      ], "Completed lifecycle metadata");
      for (const key of ["decisionHash", "evidenceSetHash", "receiptSetHash", "resultingReadinessHash"]) {
        if (!HASH_PATTERN.test(String(event.metadata[key] || ""))) {
          throw new Error(`Completed lifecycle ${key} is invalid.`);
        }
      }
      if (!AUTHORITY_OUTCOMES.includes(event.metadata.outcome)) {
        throw new Error("Completed lifecycle outcome is unsupported.");
      }
    }
    if (!HASH_PATTERN.test(String(event.eventHash || ""))) {
      throw new Error(`Lifecycle event ${event.id} hash is invalid.`);
    }
    if (event.eventHash !== sha256(lifecycleEventHashBody(event))) {
      throw new Error(`Lifecycle event ${event.id} hash does not match its exact content.`);
    }
    if (seenHashes.has(event.eventHash)) throw new Error("Lifecycle event hashes must be unique.");
    seenHashes.add(event.eventHash);
  }
  return events;
}

function createPreventureLifecycleEvent(authority, priorEvents, input = {}) {
  const events = Array.isArray(priorEvents) ? priorEvents : [];
  validatePreventureLifecycleChain(authority, events);
  const eventType = cleanText(input.eventType, "Lifecycle event type");
  if (!LIFECYCLE_EVENT_TYPES.includes(eventType)) throw new Error("Pre-venture lifecycle event type is unsupported.");
  const previousType = lifecycleState(events);
  if (events.length === 0 && eventType !== "proposed") {
    throw new Error("A pre-venture authority must begin with a proposed event.");
  }
  if (events.length && !LIFECYCLE_TRANSITIONS[previousType]?.has(eventType)) {
    throw new Error(`Pre-venture lifecycle cannot move from ${previousType} to ${eventType}.`);
  }
  const sequence = events.length + 1;
  const occurredAt = exactTimestamp(input.occurredAt, "Lifecycle event time");
  const previousEventHash = events.length ? events.at(-1).eventHash : null;
  const body = {
    schema: PREVENTURE_RESEARCH_LIFECYCLE_SCHEMA,
    id: safeId(input.id, "Lifecycle event ID"),
    authorityHash: authority.authorityHash,
    sequence,
    previousEventHash,
    eventType,
    approvalId: input.approvalId ? safeId(input.approvalId, "Lifecycle approval ID") : null,
    approvalScopeHash: input.approvalScopeHash || null,
    actor: cleanText(input.actor || "pantheon", "Lifecycle actor"),
    reason: cleanText(input.reason, "Lifecycle reason", 8),
    occurredAt,
    metadata: isObject(input.metadata) ? input.metadata : {},
  };
  if (["accepted", "activated"].includes(eventType)) {
    if (!body.approvalId || !HASH_PATTERN.test(String(body.approvalScopeHash || ""))) {
      throw new Error(`${eventType} requires an exact approved scope.`);
    }
  }
  const event = { ...body, eventHash: sha256(body) };
  validatePreventureLifecycleChain(authority, [...events, event]);
  return deepFreeze(event);
}

function normalizeComparatorCoverage(authority, value, comparatorCount, options = {}) {
  const allowIncomplete = options.allowIncomplete === true;
  exactObjectKeys(value, [
    "directOrNearDirectCount",
    "adjacentCount",
    "indirectCount",
    "maximumAcceptedOffersPerSeller",
    "sellerIdentityComplete",
    "perFormatCounts",
    "observedChannelIds",
    "selectionMethodApplied",
  ], "Comparator coverage");
  const direct = exactInteger(value.directOrNearDirectCount, "Direct comparator count");
  const adjacent = exactInteger(value.adjacentCount, "Adjacent comparator count");
  const indirect = exactInteger(value.indirectCount, "Indirect comparator count");
  if (direct + adjacent + indirect !== comparatorCount || (!allowIncomplete && (
    direct < authority.comparatorScope.directOrNearDirectMinimum
    || adjacent < authority.comparatorScope.adjacentMinimum
    || indirect < authority.comparatorScope.indirectMinimum
  ))) {
    throw new Error("Comparator coverage does not satisfy the approved category distribution.");
  }
  const maximumAcceptedOffersPerSeller = exactInteger(
    value.maximumAcceptedOffersPerSeller,
    "Maximum accepted offers per seller",
    comparatorCount > 0 ? 1 : 0,
  );
  if (maximumAcceptedOffersPerSeller > authority.comparatorScope.acceptedOffersPerSellerMaximum) {
    throw new Error("Comparator coverage exceeds the approved per-seller maximum.");
  }
  if (typeof value.sellerIdentityComplete !== "boolean") {
    throw new Error("Comparator seller-identity completeness must be explicit.");
  }
  if (!allowIncomplete && value.sellerIdentityComplete !== true) {
    throw new Error("Full comparator coverage requires exact seller identity for every accepted offer.");
  }
  exactObjectKeys(value.perFormatCounts, EXACT_FORMAT_IDS, "Per-format comparator coverage");
  const perFormatCounts = Object.fromEntries(EXACT_FORMAT_IDS.map((formatId) => {
    const count = exactInteger(value.perFormatCounts[formatId], `${formatId} comparator count`);
    if (!allowIncomplete && count < authority.comparatorScope.minimumPerApprovedFormat) {
      throw new Error(`Comparator coverage for ${formatId} is below the approved minimum.`);
    }
    if (count > comparatorCount) {
      throw new Error(`Comparator coverage for ${formatId} exceeds the accepted comparator ledger.`);
    }
    return [formatId, count];
  }));
  const observedChannelIds = exactStringList(
    value.observedChannelIds,
    "Observed comparator channels",
    { minimum: allowIncomplete ? 0 : 2, sorted: true },
  );
  if (observedChannelIds.some((id) => !REQUIRED_CHANNEL_IDS.includes(id) || id === "retain_cash")) {
    throw new Error("Observed comparator channels are outside the approved comparison.");
  }
  if (!allowIncomplete) {
    for (const required of ["etsy", "gumroad"]) {
      if (!observedChannelIds.includes(required)) {
        throw new Error(`Comparator coverage must include ${required}.`);
      }
    }
  }
  const selectionMethodApplied = !(allowIncomplete && comparatorCount === 0);
  exactBoolean(
    value.selectionMethodApplied,
    "Comparator selection method",
    selectionMethodApplied,
  );
  return {
    directOrNearDirectCount: direct,
    adjacentCount: adjacent,
    indirectCount: indirect,
    maximumAcceptedOffersPerSeller,
    sellerIdentityComplete: value.sellerIdentityComplete,
    perFormatCounts,
    observedChannelIds,
    selectionMethodApplied,
  };
}

function normalizeFormatCases(value, options = {}) {
  const allowPartial = options.allowPartial === true;
  if (!Array.isArray(value)
    || (!allowPartial && value.length !== EXACT_FORMAT_IDS.length)
    || (allowPartial && value.length > EXACT_FORMAT_IDS.length)) {
    throw new Error("All three format cases are required.");
  }
  const ids = value.map((item, index) => {
    exactObjectKeys(item, ["id", "disposition"], `Format case ${index}`);
    safeId(item.id, `Format case ${index} ID`);
    if (!['retain', 'revise', 'reject'].includes(item.disposition)) {
      throw new Error(`Format case ${item.id} disposition is unsupported.`);
    }
    return item.id;
  });
  if (
    new Set(ids).size !== ids.length
    || ids.some((id) => !EXACT_FORMAT_IDS.includes(id))
    || (!allowPartial && !sameValues(ids, EXACT_FORMAT_IDS))
  ) throw new Error("The exact format cases are required at most once each.");
  return value;
}

function normalizeChannelCases(value, options = {}) {
  const allowPartial = options.allowPartial === true;
  if (!Array.isArray(value)
    || (!allowPartial && value.length !== REQUIRED_CHANNEL_IDS.length)
    || (allowPartial && value.length > REQUIRED_CHANNEL_IDS.length)) {
    throw new Error("Etsy, Gumroad, an alternative, and retaining cash are required.");
  }
  const ids = value.map((item, index) => {
    exactObjectKeys(item, ["id", "state"], `Channel case ${index}`);
    safeId(item.id, `Channel case ${index} ID`);
    const allowedStates = new Set([
      "available",
      "conditional_unverified",
      "conditionally_preferred",
      "discovery_only",
      "not_selected",
      "not_verified",
      "protected_verification_required",
      "recommended",
      "rejected",
      "research_more",
    ]);
    if (!allowedStates.has(item.state)) throw new Error(`Channel case ${item.id} state is unsupported.`);
    return item.id;
  });
  if (
    new Set(ids).size !== ids.length
    || ids.some((id) => !REQUIRED_CHANNEL_IDS.includes(id))
    || (!allowPartial && !sameValues(ids, REQUIRED_CHANNEL_IDS))
  ) {
    throw new Error("The exact Etsy, Gumroad, lawful-alternative, and retain-cash cases are required once each.");
  }
  return value;
}

function normalizeReadinessGates(value) {
  if (!Array.isArray(value) || value.length !== REQUIRED_READINESS_GATE_IDS.length) {
    throw new Error("Every required pre-venture readiness gate must be recorded once.");
  }
  const ids = value.map((gate, index) => {
    exactObjectKeys(gate, ["id", "required", "status"], `Readiness gate ${index}`);
    safeId(gate.id, `Readiness gate ${index} ID`);
    if (gate.required !== true) throw new Error(`Readiness gate ${gate.id} must remain required.`);
    if (!GATE_STATUSES.includes(gate.status)) {
      throw new Error(`Readiness gate ${gate.id} status is unsupported.`);
    }
    return gate.id;
  });
  if (!sameValues(ids, REQUIRED_READINESS_GATE_IDS)) {
    throw new Error("The exact required pre-venture readiness gates changed.");
  }
  return value;
}

function normalizeEconomicsCases(value, options = {}) {
  const allowPartial = options.allowPartial === true;
  const expectedPairs = REQUIRED_CHANNEL_IDS.flatMap((channelId) => (
    EXACT_PRICE_CASES.map((priceAudCents) => `${channelId}:${priceAudCents}`)
  )).sort();
  if (!Array.isArray(value)
    || (!allowPartial && value.length !== expectedPairs.length)
    || (allowPartial && value.length > expectedPairs.length)) {
    throw new Error("Every approved channel and A$19/A$29/A$39 economics case must be recorded.");
  }
  const observedPairs = value.map((item, index) => {
    exactObjectKeys(item, [
      "channelId",
      "priceAudCents",
      "state",
      "estimatedNetCashContributionAudCents",
      "unknownCosts",
      "evidenceRefs",
    ], `Economics case ${index}`);
    if (!REQUIRED_CHANNEL_IDS.includes(item.channelId)) {
      throw new Error(`Economics case ${index} channel is outside the approved comparison.`);
    }
    const priceAudCents = exactInteger(item.priceAudCents, `Economics case ${index} price`, 1);
    if (!EXACT_PRICE_CASES.includes(priceAudCents)) {
      throw new Error(`Economics case ${index} price is outside A$19/A$29/A$39.`);
    }
    if (!["estimated", "known_zero", "unknown", "not_applicable"].includes(item.state)) {
      throw new Error(`Economics case ${index} state is unsupported.`);
    }
    const unknownCosts = exactStringList(
      item.unknownCosts,
      `Economics case ${index} unknown costs`,
      { minimum: item.state === "unknown" ? 1 : 0, sorted: true },
    );
    const evidenceRefs = exactStringList(
      item.evidenceRefs,
      `Economics case ${index} evidence references`,
      { minimum: item.state === "estimated" ? 1 : 0, sorted: true },
    );
    if (["unknown", "not_applicable"].includes(item.state)) {
      if (item.estimatedNetCashContributionAudCents !== null) {
        throw new Error(`Economics case ${index} cannot invent a contribution while ${item.state}.`);
      }
    } else {
      signedInteger(item.estimatedNetCashContributionAudCents, `Economics case ${index} contribution`);
    }
    if (item.channelId === "retain_cash") {
      if (item.state !== "known_zero" || item.estimatedNetCashContributionAudCents !== 0 || unknownCosts.length) {
        throw new Error("Retaining cash must remain the known A$0 comparison baseline.");
      }
    }
    return `${item.channelId}:${priceAudCents}`;
  });
  if (
    new Set(observedPairs).size !== observedPairs.length
    || observedPairs.some((pair) => !expectedPairs.includes(pair))
    || (!allowPartial
      && JSON.stringify([...observedPairs].sort()) !== JSON.stringify(expectedPairs))
  ) {
    throw new Error("The exact channel and price economics cases are required once each.");
  }
  return value;
}

function normalizeContraryEvidence(value, options = {}) {
  if (!Array.isArray(value) || (!options.allowEmpty && value.length < 1)) {
    throw new Error("The explicit contrary-evidence pass must be retained.");
  }
  const ids = value.map((item, index) => {
    exactObjectKeys(item, ["id", "status"], `Contrary evidence ${index}`);
    safeId(item.id, `Contrary evidence ${index} ID`);
    if (item.status !== "retained") throw new Error("Contrary evidence must remain retained.");
    return item.id;
  });
  if (new Set(ids).size !== ids.length) throw new Error("Contrary-evidence IDs must be unique.");
  return value;
}

function normalizeNonOccurrenceRecord(value) {
  exactObjectKeys(value, [
    "productBuilt",
    "buyerContact",
    "accountInspectedOrChanged",
    "publishing",
    "advertising",
    "externalSpendAudCents",
    "orders",
    "revenueAudCents",
    "settledNetCashContribution",
  ], "Diligence non-occurrence record");
  for (const key of [
    "productBuilt",
    "buyerContact",
    "accountInspectedOrChanged",
    "publishing",
    "advertising",
  ]) exactBoolean(value[key], `Diligence non-occurrence ${key}`, false);
  for (const key of ["externalSpendAudCents", "orders", "revenueAudCents"]) {
    if (exactInteger(value[key], `Diligence non-occurrence ${key}`) !== 0) {
      throw new Error(`Diligence non-occurrence ${key} must remain zero.`);
    }
  }
  if (value.settledNetCashContribution !== "not_settled") {
    throw new Error("Diligence cannot claim settled net cash contribution.");
  }
  return value;
}

function normalizeNextEvidenceAction(authority, value, earlyStop) {
  if (!earlyStop) {
    if (value !== null) throw new Error("A full diligence round cannot claim an early-stop evidence action.");
    return null;
  }
  exactObjectKeys(value, [
    "status",
    "id",
    "action",
    "evidenceGap",
    "method",
    "maxInternalAiCostAudCents",
    "separateApprovalRequired",
  ], "Next evidence action");
  if (value.status !== "proposed") {
    throw new Error("Next evidence action status is unsupported.");
  }
  const id = safeId(value.id, "Next evidence action ID");
  const action = cleanText(value.action, "Next evidence action", 12);
  const evidenceGap = cleanText(value.evidenceGap, "Next evidence gap", 12);
  exactBoolean(value.separateApprovalRequired, "Next evidence action approval", true);
  cleanText(value.method, "Next evidence action method", 3);
  const maximum = exactInteger(
    value.maxInternalAiCostAudCents,
    "Next evidence action maximum internal AI cost",
  );
  if (maximum > authority.internalAiSpendCapAudCents) {
    throw new Error("Next evidence action is not within this bounded-round affordability ceiling.");
  }
  return {
    status: value.status,
    id,
    action,
    evidenceGap,
    method: value.method,
    maxInternalAiCostAudCents: value.maxInternalAiCostAudCents,
    separateApprovalRequired: true,
  };
}

function validateDecisionOutcomeCases(
  outcome,
  formatCases,
  channelCases,
  economicsCases,
  readinessGates,
  materialContradictions,
  completionMode = "full_round",
) {
  if (completionMode === "validated_early_stop") {
    if (
      outcome !== "research_more"
      || !readinessGates.some((gate) => [
        "partially_supported",
        "unresolved",
        "contradicted",
        "protected_verification_required",
      ].includes(gate.status))
    ) {
      throw new Error(
        "A validated early stop may only record research_more, coherent prior case groups, and at least one exact unresolved or partial readiness gap.",
      );
    }
    return;
  }
  const gates = new Map(readinessGates.map((gate) => [gate.id, gate]));
  const retainCash = channelCases.find((item) => item.id === "retain_cash");
  const nonCash = channelCases.filter((item) => item.id !== "retain_cash");
  const retainCashRecommended = retainCash?.state === "recommended";
  if (retainCashRecommended && outcome !== "no_investment") {
    throw new Error("A retain-cash recommendation must map to no_investment.");
  }
  if (outcome === "no_investment" && !retainCashRecommended) {
    throw new Error("no_investment requires retaining cash to be the recommended case.");
  }
  if (outcome === "build") {
    const recommendedChannels = nonCash.filter((item) => item.state === "recommended");
    const selectedEconomics = economicsCases.filter(
      (item) => item.channelId === recommendedChannels[0]?.id,
    );
    if (
      readinessGates.some((gate) => gate.status !== "supported")
      || materialContradictions.length > 0
      || formatCases.every((item) => item.disposition !== "retain")
      || recommendedChannels.length !== 1
      || selectedEconomics.length !== EXACT_PRICE_CASES.length
      || selectedEconomics.some((item) => item.state !== "estimated")
      || !selectedEconomics.some(
        (item) => item.estimatedNetCashContributionAudCents > 0,
      )
      || economicsCases.some((item) => item.state === "unknown")
    ) {
      throw new Error(
        "A build recommendation requires supported gates, no material contradiction, one retained format, one recommended non-cash channel, and known positive provisional economics.",
      );
    }
  } else if (outcome === "research_more") {
    const researchable = new Set([
      "partially_supported",
      "unresolved",
      "protected_verification_required",
    ]);
    if (!readinessGates.some((gate) => researchable.has(gate.status))) {
      throw new Error("research_more requires a structured decision-critical gap.");
    }
  } else if (outcome === "revise") {
    const reviseGates = new Set([
      "distribution",
      "experiment",
      "format_usability",
      "offer_value",
      "operations",
      "provisional_economics",
      "risk",
    ]);
    const structuredRevision = readinessGates.some(
      (gate) => gate.status === "contradicted" && reviseGates.has(gate.id),
    ) || formatCases.some((item) => item.disposition === "revise")
      || channelCases.some((item) => item.state === "rejected");
    if (
      gates.get("buyer_problem")?.status !== "supported"
      || materialContradictions.length < 1
      || !structuredRevision
    ) {
      throw new Error(
        "revise requires a supported core buyer problem and a structured contradiction to the current case.",
      );
    }
  } else if (outcome === "reject") {
    const structuralGates = new Set([
      "competition_entry",
      "direct_demand",
      "distribution",
      "offer_value",
      "operations",
      "provisional_economics",
      "risk",
    ]);
    if (!readinessGates.some(
      (gate) => gate.status === "contradicted" && structuralGates.has(gate.id),
    )) {
      throw new Error("reject requires a retained structural commercial contradiction.");
    }
  } else if (outcome === "no_investment") {
    if (
      gates.get("alternatives")?.status !== "supported"
      || nonCash.some((item) => ["recommended", "conditionally_preferred"].includes(item.state))
    ) {
      throw new Error(
        "no_investment requires a supported alternatives comparison and no preferred non-cash channel.",
      );
    }
  }
}

function createPreventureResearchDecision(authority, input = {}) {
  const outcome = cleanText(input.outcome, "Diligence outcome");
  if (!AUTHORITY_OUTCOMES.includes(outcome)) throw new Error("Diligence outcome is not allowed.");
  const completionMode = cleanText(input.completionMode, "Diligence completion mode");
  if (!PREVENTURE_RESEARCH_COMPLETION_MODES.includes(completionMode)) {
    throw new Error("Diligence completion mode is unsupported.");
  }
  const earlyStopRecordHash = input.earlyStopRecordHash;
  if (completionMode === "full_round") {
    if (earlyStopRecordHash !== null) {
      throw new Error("A full diligence round cannot claim an early-stop record.");
    }
  } else if (!HASH_PATTERN.test(String(earlyStopRecordHash || ""))) {
    throw new Error("A validated early-stop decision requires its exact stop-record hash.");
  }
  const decisionId = safeId(input.id, "Diligence decision ID");
  const decisionVersion = safeId(input.version, "Diligence decision version");
  if (decisionId === authority.id || decisionVersion === authority.version || decisionVersion === authority.readinessBinding.version) {
    throw new Error("The diligence result must be a new version that supersedes the bound readiness record.");
  }
  const decidedAt = exactTimestamp(input.decidedAt, "Diligence decision time");
  if (Date.parse(decidedAt) < Date.parse(authority.approvedAt) || Date.parse(decidedAt) >= Date.parse(authority.expiresAt)) {
    throw new Error("The diligence decision must occur within the approved authority window.");
  }
  const comparatorCount = exactInteger(input.comparatorCount, "Comparator count");
  if (
    comparatorCount > authority.comparatorScope.maximumOffers
    || (completionMode === "full_round" && comparatorCount < authority.comparatorScope.minimumOffers)
  ) {
    throw new Error("The diligence decision is outside the approved 10 to 15 comparator scope.");
  }
  const estimatedInternalAiCostAudCents = exactInteger(
    input.estimatedInternalAiCostAudCents,
    "Estimated internal AI cost",
  );
  const reconciledInternalAiCostAudCents = exactInteger(
    input.reconciledInternalAiCostAudCents,
    "Reconciled internal AI cost",
  );
  if (
    estimatedInternalAiCostAudCents + reconciledInternalAiCostAudCents
      > authority.internalAiSpendCapAudCents
  ) {
    throw new Error("The diligence decision exceeds its internal AI cost cap.");
  }
  if (typeof input.exactBillingPending !== "boolean") {
    throw new Error("The diligence decision must state whether exact provider billing is pending.");
  }
  if (exactInteger(input.externalCommercialSpendAudCents, "External commercial spend") !== 0) {
    throw new Error("The diligence decision cannot contain external commercial spend.");
  }
  if (!HASH_PATTERN.test(String(input.evidenceSetHash || ""))) throw new Error("Diligence evidence-set hash is invalid.");
  if (!HASH_PATTERN.test(String(input.receiptSetHash || ""))) throw new Error("Diligence receipt-set hash is invalid.");
  if (input.provenanceComplete !== true) {
    throw new Error("A diligence decision requires complete retained provenance.");
  }
  const unknownProviderOutcomeCount = exactInteger(
    input.unknownProviderOutcomeCount,
    "Unknown provider outcome count",
  );
  const unknownCostCount = exactInteger(input.unknownCostCount, "Unknown cost count");
  if (unknownProviderOutcomeCount !== 0 || unknownCostCount !== 0) {
    throw new Error("A diligence decision cannot be sealed while provider or cost outcomes are unknown.");
  }
  const earlyStop = completionMode === "validated_early_stop";
  const skippedAssignmentRecordHashes = exactStringList(
    input.skippedAssignmentRecordHashes,
    "Skipped assignment record hashes",
    { minimum: 0, sorted: true },
  );
  if (
    (!earlyStop && skippedAssignmentRecordHashes.length !== 0)
    || skippedAssignmentRecordHashes.length > 2
    || skippedAssignmentRecordHashes.some((hash) => !HASH_PATTERN.test(hash))
  ) {
    throw new Error("Validated early-stop decisions may bind only the exact remaining assignment suffix hashes.");
  }
  const nextEvidenceAction = normalizeNextEvidenceAction(
    authority,
    input.nextEvidenceAction,
    earlyStop,
  );
  const comparatorCoverage = normalizeComparatorCoverage(
    authority,
    input.comparatorCoverage,
    comparatorCount,
    { allowIncomplete: earlyStop },
  );
  const formatCases = normalizeFormatCases(input.formatCases, { allowPartial: earlyStop });
  const channelCases = normalizeChannelCases(input.channelCases, { allowPartial: earlyStop });
  const economicsCases = normalizeEconomicsCases(input.economicsCases, { allowPartial: earlyStop });
  const contraryEvidence = normalizeContraryEvidence(
    input.contraryEvidence,
    { allowEmpty: earlyStop },
  );
  const readinessGates = normalizeReadinessGates(input.readinessGates);
  const nonOccurrenceRecord = normalizeNonOccurrenceRecord(input.nonOccurrenceRecord);
  const materialContradictions = exactStringList(
    input.materialContradictions,
    "Diligence material contradictions",
  );
  validateDecisionOutcomeCases(
    outcome,
    formatCases,
    channelCases,
    economicsCases,
    readinessGates,
    materialContradictions,
    completionMode,
  );
  const body = {
    schema: PREVENTURE_RESEARCH_DECISION_SCHEMA,
    authorityHash: authority.authorityHash,
    readinessBinding: authority.readinessBinding,
    id: decisionId,
    version: decisionVersion,
    outcome,
    completionMode,
    earlyStopRecordHash,
    skippedAssignmentRecordHashes,
    nextEvidenceAction,
    decidedAt,
    comparatorCount,
    estimatedInternalAiCostAudCents,
    reconciledInternalAiCostAudCents,
    exactBillingPending: input.exactBillingPending,
    externalCommercialSpendAudCents: 0,
    provenanceComplete: true,
    unknownProviderOutcomeCount,
    unknownCostCount,
    evidenceSetHash: input.evidenceSetHash,
    receiptSetHash: input.receiptSetHash,
    summary: cleanText(input.summary, "Diligence decision summary", 20),
    buyer: cleanText(input.buyer, "Diligence buyer", 8),
    problem: cleanText(input.problem, "Diligence problem", 12),
    offer: cleanText(input.offer, "Diligence offer", 12),
    channel: cleanText(input.channel, "Diligence channel", 3),
    priceOrMargin: cleanText(input.priceOrMargin, "Diligence price or margin", 3),
    evidenceStandard: cleanText(input.evidenceStandard, "Diligence evidence standard", 12),
    nextMoneyMove: cleanText(input.nextMoneyMove, "Diligence next money move", 8),
    reviseOrStopCriteria: exactStringList(input.reviseOrStopCriteria, "Diligence revise or stop criteria", { minimum: 1 }),
    sourceIds: exactStringList(
      input.sourceIds,
      "Diligence source IDs",
      { minimum: earlyStop ? 0 : 3, sorted: true },
    ),
    comparatorIds: exactStringList(
      input.comparatorIds,
      "Diligence comparator IDs",
      { minimum: earlyStop ? 0 : 10, sorted: true },
    ),
    comparatorCoverage,
    formatCases,
    channelCases,
    economicsCases,
    contraryEvidence,
    materialContradictions,
    readinessGates,
    limitations: exactStringList(input.limitations, "Diligence limitations", { minimum: 1 }),
    nonOccurrenceRecord,
    buildAuthorized: false,
    commercialTestAuthorized: false,
    externalActionAuthorized: false,
  };
  if (body.comparatorIds.length !== comparatorCount) throw new Error("Comparator count does not match the decision ledger.");
  const decision = { ...body, decisionHash: sha256(body) };
  return deepFreeze(decision);
}

function decisionHashBody(decision) {
  const { decisionHash: _decisionHash, ...body } = decision;
  return body;
}

function validatePreventureResearchDecision(authority, decision) {
  exactObjectKeys(decision, [
    "schema",
    "authorityHash",
    "readinessBinding",
    "id",
    "version",
    "outcome",
    "completionMode",
    "earlyStopRecordHash",
    "skippedAssignmentRecordHashes",
    "nextEvidenceAction",
    "decidedAt",
    "comparatorCount",
    "estimatedInternalAiCostAudCents",
    "reconciledInternalAiCostAudCents",
    "exactBillingPending",
    "externalCommercialSpendAudCents",
    "provenanceComplete",
    "unknownProviderOutcomeCount",
    "unknownCostCount",
    "evidenceSetHash",
    "receiptSetHash",
    "summary",
    "buyer",
    "problem",
    "offer",
    "channel",
    "priceOrMargin",
    "evidenceStandard",
    "nextMoneyMove",
    "reviseOrStopCriteria",
    "sourceIds",
    "comparatorIds",
    "comparatorCoverage",
    "formatCases",
    "channelCases",
    "economicsCases",
    "contraryEvidence",
    "materialContradictions",
    "readinessGates",
    "limitations",
    "nonOccurrenceRecord",
    "buildAuthorized",
    "commercialTestAuthorized",
    "externalActionAuthorized",
    "decisionHash",
  ], "Pre-venture research decision");
  if (!HASH_PATTERN.test(String(decision.decisionHash || ""))) {
    throw new Error("Pre-venture research decision hash is invalid.");
  }
  if (decision.decisionHash !== sha256(decisionHashBody(decision))) {
    throw new Error("Pre-venture research decision hash does not match its exact content.");
  }
  const rebuilt = createPreventureResearchDecision(authority, decisionHashBody(decision));
  if (sha256(rebuilt) !== sha256(decision)) {
    throw new Error("Pre-venture research decision contains unsupported or non-canonical content.");
  }
  return decision;
}

module.exports = {
  AUTHORITY_OUTCOMES,
  LIFECYCLE_EVENT_TYPES,
  PREVENTURE_RESEARCH_COMPLETION_MODES,
  PREVENTURE_RESEARCH_APPROVAL_SCOPE_SCHEMA,
  PREVENTURE_RESEARCH_APPROVAL_SCOPE_V2_SCHEMA,
  PREVENTURE_RESEARCH_AUTHORITY_SCHEMA,
  PREVENTURE_RESEARCH_AUTHORITY_V2_SCHEMA,
  PREVENTURE_RESEARCH_DECISION_SCHEMA,
  PREVENTURE_RESEARCH_LIFECYCLE_SCHEMA,
  PREVENTURE_RESEARCH_PROVIDER_FACT_RECORD_SCHEMA,
  PREVENTURE_RESEARCH_PROVIDER_REVIEW_SCHEMA,
  REQUIRED_ASSIGNMENT_IDS,
  REQUIRED_PROHIBITED_ACTIONS,
  REQUIRED_READINESS_GATE_IDS,
  RENEWAL_ADMISSIBLE_PREDECESSOR_EVENTS,
  TERMINAL_EVENT_TYPES,
  authorityHashBody,
  calculatePreventureResearchWorstCaseExposureAud,
  createPreventureLifecycleEvent,
  createPreventureResearchAuthority,
  createPreventureResearchAuthorityV2,
  createPreventureResearchDecision,
  createPreventureResearchProviderFactRecord,
  createPreventureResearchProviderReviewV2,
  decisionHashBody,
  effectivePreventureLifecycleState,
  lifecycleState,
  preventureResearchApprovalScope,
  preventureResearchApprovalScopeHash,
  preventureResearchProviderFactHashes,
  validatePreventureLifecycleChain,
  validatePreventureResearchAuthority,
  validatePreventureResearchAuthorityV1,
  validatePreventureResearchAuthorityV2,
  validatePreventureResearchDecision,
  validatePreventureResearchProviderFactRecord,
};
