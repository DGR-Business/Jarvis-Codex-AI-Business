"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const { isDefinitePreEffectHttpStatus } = require("../adapters/openai-egress-policy");
const { sha256 } = require("./commercial-test-contract");
const { EXACT_OUTPUT_STORE_KIND } = require("./preventure-research-runner");

const OUTPUT_ARTIFACT_SCHEMA = "pantheon.preventure-provider-output.v1";
const MAX_RETAINED_OUTPUT_BYTES = 5 * 1024 * 1024;
const MAX_RETAINED_MANIFEST_BYTES = 24 * 1024 * 1024;
const HASH_PATTERN = /^sha256:[a-f0-9]{64}$/;
const REF_PATTERN = /^preventure-output:([a-f0-9]{64})$/;
const SAFE_PROVIDER_JSON_KEYS = new Set([
  "action", "adapter", "allowed_domains", "annotations", "assignment_hash", "authority_hash",
  "background", "billing", "cached_tokens",
  "city", "code", "completed_at", "content", "country", "created_at", "effort",
  "data_class", "end_index", "error", "external_web_access", "filters", "format", "id",
  "incomplete_details", "input_tokens", "input_tokens_details", "instructions", "logprobs",
  "max_output_tokens", "max_tool_calls", "message", "metadata", "model", "name", "object",
  "output", "output_tokens", "output_tokens_details", "parallel_tool_calls", "param", "pattern",
  "previous_response_id", "prompt", "prompt_cache_key", "publisher", "published_at", "reason",
  "publishedAt", "queries", "query", "reasoning", "reasoning_tokens", "refusal", "region",
  "return_token_budget", "role", "safety_identifier", "schema", "search_context_size",
  "sequence_number", "service_tier", "snippet", "sources", "start_index", "status", "store",
  "strict", "summary", "temperature", "text", "timezone", "title", "tool_choice", "tools",
  "top_logprobs", "top_p", "total_tokens", "truncation", "type", "url", "usage", "user",
  "user_location", "workflow_id", "task_id",
]);
const FORBIDDEN_PERSISTED_KEY = /^(?:authorization|proxy-authorization|headers?|cookies?|set-cookie|api[-_]?key|client[-_]?secret|access[-_]?token|refresh[-_]?token|csrf|xsrf|password|passwd|session|session[-_]?id)$/i;
const SECRET_TEXT_PATTERNS = Object.freeze([
  /\bBearer\s+[/A-Za-z0-9._~+-]{12,}={0,2}\b/i,
  /\bsk-(?:proj-)?[A-Za-z0-9_-]{12,}\b/i,
  /["']?(?:authorization|api[-_]?key|client[-_]?secret|access[-_]?token|refresh[-_]?token|csrf|xsrf|cookie|password)["']?\s*[:=]\s*["']?[^\s"',}]{8,}/i,
]);

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = 409;
  throw error;
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (isObject(value)) {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value ?? null;
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function sameCanonical(left, right) {
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
}

function exactKeys(value, allowed, required, label) {
  if (!isObject(value)) fail("preventure_output_shape_invalid", `${label} is invalid.`);
  const keys = Object.keys(value);
  if (
    keys.some((key) => !allowed.includes(key) || FORBIDDEN_PERSISTED_KEY.test(key))
    || required.some((key) => !Object.hasOwn(value, key))
  ) {
    fail("preventure_output_shape_invalid", `${label} contains unsupported fields.`);
  }
}

function safeBoundedText(value, label, maximum = 8192, nullable = true) {
  if (nullable && value === null) return null;
  if (typeof value !== "string" || value.length > maximum) {
    fail("preventure_output_shape_invalid", `${label} is invalid.`);
  }
  if (SECRET_TEXT_PATTERNS.some((pattern) => pattern.test(value))) {
    fail("preventure_output_sensitive_value", `${label} contains credential-shaped material.`);
  }
  return value;
}

function assertNoKnownSensitiveValue(input, exactRaw) {
  const sensitiveValues = Array.isArray(input.sensitiveValues)
    ? [...new Set(input.sensitiveValues.filter(
        (value) => typeof value === "string" && value.length >= 1,
      ))]
    : [];
  if (sensitiveValues.length < 1) return;
  const candidateText = [
    exactRaw.text,
    JSON.stringify(canonical(input.providerResponse)),
    JSON.stringify(canonical(input.groundedSources)),
    JSON.stringify(canonical(input.billing)),
    JSON.stringify(canonical(input.responseMetadata || {})),
    typeof input.output === "string" ? input.output : "",
    String(input.providerRequestId || ""),
    String(input.providerResponseId || ""),
    String(input.clientRequestId || ""),
    String(input.artifactKind || ""),
    String(input.authorityHash || ""),
    String(input.assignmentHash || ""),
    String(input.descriptorHash || ""),
    String(input.requestBodyHash || ""),
    String(input.providerResponseHash || ""),
    String(input.rawProviderBodyHash || ""),
    String(input.groundedSourceSetHash || ""),
    String(input.billingHash || ""),
  ].join("\n");
  if (sensitiveValues.some((value) => candidateText.includes(value))) {
    fail(
      "preventure_output_sensitive_value",
      "Provider output contains credential material and cannot enter immutable retention.",
    );
  }
}

function assertSafeProviderJson(value, pathLabel = "Provider response", depth = 0, state = { nodes: 0 }) {
  state.nodes += 1;
  if (depth > 20 || state.nodes > 50_000) {
    fail("preventure_output_shape_invalid", `${pathLabel} is too deeply nested or complex.`);
  }
  if (value === null || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail("preventure_output_shape_invalid", `${pathLabel} is invalid.`);
    return;
  }
  if (typeof value === "string") {
    safeBoundedText(value, pathLabel, MAX_RETAINED_OUTPUT_BYTES, false);
    return;
  }
  if (Array.isArray(value)) {
    if (value.length > 10_000) fail("preventure_output_shape_invalid", `${pathLabel} is too large.`);
    value.forEach((item, index) => assertSafeProviderJson(item, `${pathLabel}[${index}]`, depth + 1, state));
    return;
  }
  if (!isObject(value)) fail("preventure_output_shape_invalid", `${pathLabel} is invalid.`);
  const keys = Object.keys(value);
  if (
    keys.length > 200
    || keys.some((key) => FORBIDDEN_PERSISTED_KEY.test(key) || !SAFE_PROVIDER_JSON_KEYS.has(key))
  ) {
    fail("preventure_output_shape_invalid", `${pathLabel} contains unsupported fields.`);
  }
  for (const [key, child] of Object.entries(value)) {
    assertSafeProviderJson(child, `${pathLabel}.${key}`, depth + 1, state);
  }
}

function assertBilling(value, artifactKind) {
  if (artifactKind === "known_pre_effect_rejection") {
    exactKeys(value, [
      "costAudCents", "costStatus", "currency", "exactBillingPending", "exposureAudCents",
      "providerZeroBillingGuarantee",
    ], [
      "costAudCents", "costStatus", "currency", "exactBillingPending", "exposureAudCents",
      "providerZeroBillingGuarantee",
    ], "Provider billing");
    return;
  }
  exactKeys(
    value,
    ["costAudCents", "costStatus", "currency", "modelCallId"],
    ["costAudCents", "costStatus", "currency"],
    "Provider billing",
  );
  if (
    value.currency !== "AUD"
    || !["estimated", "incurred", "reconciled", "unknown"].includes(value.costStatus)
    || !(
      value.costAudCents === null
      || (Number.isSafeInteger(value.costAudCents) && value.costAudCents >= 0)
    )
    || (value.costStatus === "unknown") !== (value.costAudCents === null)
    || (Object.hasOwn(value, "modelCallId") && !(
      value.modelCallId === null
      || (typeof value.modelCallId === "string" && /^[A-Za-z0-9._:-]{1,200}$/.test(value.modelCallId))
    ))
  ) {
    fail("preventure_output_billing_invalid", "Provider billing is contradictory.");
  }
}

function assertGroundedSources(value) {
  if (!Array.isArray(value) || value.length > 200) {
    fail("preventure_output_grounding_invalid", "Provider grounding is invalid.");
  }
  for (const source of value) {
    exactKeys(source, [
      "provenance", "publishedAtValues", "publishers", "snippets", "titles", "url",
    ], [
      "provenance", "publishedAtValues", "publishers", "snippets", "titles", "url",
    ], "Grounded source");
    safeBoundedText(source.url, "Grounded source URL", 4096, false);
    let parsed;
    try { parsed = new URL(source.url); } catch {
      fail("preventure_output_grounding_invalid", "Grounded source URL is invalid.");
    }
    if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
      fail("preventure_output_grounding_invalid", "Grounded source URL is not a safe public HTTPS URL.");
    }
    for (const [key, maximumItems, maximumText] of [
      ["provenance", 4, 80],
      ["publishedAtValues", 20, 80],
      ["publishers", 20, 200],
      ["snippets", 20, 800],
      ["titles", 20, 300],
    ]) {
      const values = source[key];
      if (
        !Array.isArray(values)
        || values.length > maximumItems
        || new Set(values).size !== values.length
        || !sameCanonical(values, [...values].sort())
      ) fail("preventure_output_grounding_invalid", "Grounded source fields are invalid.");
      values.forEach((item) => safeBoundedText(item, `Grounded source ${key}`, maximumText, false));
    }
  }
}

function assertResponseMetadata(value, artifactKind, clientRequestId) {
  if (artifactKind === "known_pre_effect_rejection") return;
  exactKeys(value, [
    "canonicalResponseValid", "clientRequestId", "httpStatus", "pricingPolicyHash",
    "providerResponseJsonParsed", "responseIssues", "responseStatus", "usage",
  ], ["httpStatus"], "Provider response metadata");
  if (!Number.isSafeInteger(value.httpStatus) || value.httpStatus < 100 || value.httpStatus > 599) {
    fail("preventure_output_metadata_invalid", "Provider response status is invalid.");
  }
  for (const booleanKey of ["canonicalResponseValid", "providerResponseJsonParsed"]) {
    if (Object.hasOwn(value, booleanKey) && typeof value[booleanKey] !== "boolean") {
      fail("preventure_output_metadata_invalid", "Provider response metadata is invalid.");
    }
  }
  if (Object.hasOwn(value, "clientRequestId") && value.clientRequestId !== clientRequestId) {
    fail("preventure_output_metadata_invalid", "Client request identity changed in response metadata.");
  }
  if (Object.hasOwn(value, "pricingPolicyHash")) hash(value.pricingPolicyHash, "Pricing-policy hash");
  if (Object.hasOwn(value, "responseStatus")) {
    safeBoundedText(value.responseStatus, "Provider response status", 80, true);
  }
  if (Object.hasOwn(value, "responseIssues")) {
    if (
      !Array.isArray(value.responseIssues)
      || value.responseIssues.length > 50
      || new Set(value.responseIssues).size !== value.responseIssues.length
      || !sameCanonical(value.responseIssues, [...value.responseIssues].sort())
    ) fail("preventure_output_metadata_invalid", "Provider response issues are invalid.");
    value.responseIssues.forEach((issue) => safeBoundedText(issue, "Provider response issue", 200, false));
  }
  if (Object.hasOwn(value, "usage")) {
    exactKeys(
      value.usage,
      ["inputTokens", "outputTokens", "totalTokens"],
      ["inputTokens", "outputTokens", "totalTokens"],
      "Provider usage metadata",
    );
    if (
      !Number.isSafeInteger(value.usage.inputTokens)
      || value.usage.inputTokens < 0
      || !Number.isSafeInteger(value.usage.outputTokens)
      || value.usage.outputTokens < 0
      || value.usage.totalTokens !== value.usage.inputTokens + value.usage.outputTokens
    ) fail("preventure_output_metadata_invalid", "Provider usage metadata is invalid.");
  }
}

function hash(value, label, nullable = false) {
  if (nullable && (value === null || value === undefined)) return null;
  const result = String(value || "");
  if (!HASH_PATTERN.test(result)) fail("preventure_output_hash_invalid", `${label} is invalid.`);
  return result;
}

function providerId(value, label, nullable = false) {
  if (nullable && (value === null || value === undefined)) return null;
  const result = String(value || "");
  if (!/^[A-Za-z0-9._:-]{1,200}$/.test(result)) {
    fail("preventure_output_provider_id_invalid", `${label} is invalid.`);
  }
  return result;
}

function exactTimestamp(value) {
  const result = value instanceof Date ? value.toISOString() : String(value || "");
  if (!Number.isFinite(Date.parse(result)) || new Date(result).toISOString() !== result) {
    fail("preventure_output_time_invalid", "Retention time is invalid or non-canonical.");
  }
  return result;
}

function artifactRef(artifactHash) {
  return `preventure-output:${hash(artifactHash, "Artifact hash").slice(7)}`;
}

function hashFromReference(reference) {
  const values = isObject(reference)
    ? ["retainedOutputHash", "artifactRef", "location"]
      .filter((key) => reference[key] !== undefined && reference[key] !== null)
      .map((key) => String(reference[key]))
    : [String(reference || "")];
  const hashes = values.map((value) => REF_PATTERN.exec(value));
  if (hashes.length < 1 || hashes.some((match) => !match)) {
    fail(
      "preventure_output_reference_invalid",
      "Retained output must use its opaque immutable manifest hash, not a file path.",
    );
  }
  const unique = new Set(hashes.map((match) => match[1]));
  if (unique.size !== 1) {
    fail("preventure_output_reference_binding_changed", "Retained output aliases disagree.");
  }
  return `sha256:${hashes[0][1]}`;
}

function artifactPath(root, artifactHash) {
  const hex = hash(artifactHash, "Artifact hash").slice(7);
  const result = path.resolve(root, hex.slice(0, 2), `${hex}.json`);
  const relative = path.relative(root, result);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    fail("preventure_output_path_invalid", "The provider artifact escaped its dedicated root.");
  }
  return result;
}

function stableIdentityHash(semantic) {
  return sha256({
    schema: OUTPUT_ARTIFACT_SCHEMA,
    authorityHash: semantic.authorityHash,
    assignmentHash: semantic.assignmentHash,
    descriptorHash: semantic.descriptorHash,
    requestBodyHash: semantic.requestBodyHash,
  });
}

function stableClaimPath(root, identityHash) {
  const hex = hash(identityHash, "Stable artifact identity").slice(7);
  const result = path.resolve(root, "claims", hex.slice(0, 2), `${hex}.json`);
  const relative = path.relative(root, result);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    fail("preventure_output_path_invalid", "The provider artifact claim escaped its dedicated root.");
  }
  return result;
}

function assertDirectoryChain(root, directory) {
  assertUnlinkedAbsolutePrefix(root);
  const rootStat = fs.lstatSync(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    fail("preventure_output_path_invalid", "The provider artifact root is linked or not a directory.");
  }
  const rootReal = fs.realpathSync(root);
  const relative = path.relative(root, directory);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    fail("preventure_output_path_invalid", "The provider artifact directory escaped its root.");
  }
  let current = root;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    const stat = fs.lstatSync(current);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      fail("preventure_output_path_invalid", "The provider artifact path contains a linked component.");
    }
    const currentReal = fs.realpathSync(current);
    const escaped = path.relative(rootReal, currentReal);
    if (escaped.startsWith("..") || path.isAbsolute(escaped)) {
      fail("preventure_output_path_invalid", "The provider artifact path resolved outside its root.");
    }
  }
}

function assertUnlinkedAbsolutePrefix(target) {
  const absolute = path.resolve(target);
  const parsed = path.parse(absolute);
  let current = parsed.root;
  for (const segment of absolute.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    if (!fs.existsSync(current)) continue;
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink()) {
      fail("preventure_output_path_invalid", "The provider artifact root has a linked ancestor.");
    }
  }
}

function rawBody(input, maximumBytes) {
  if (typeof input.rawProviderBody !== "string") {
    fail("preventure_output_raw_body_required", "Exact raw provider response text is required.");
  }
  const bytes = Buffer.isBuffer(input.rawProviderBodyBytes)
    ? Buffer.from(input.rawProviderBodyBytes)
    : Buffer.from(input.rawProviderBody, "utf8");
  if (bytes.length > maximumBytes) {
    fail("preventure_output_artifact_too_large", "The provider response exceeds its byte limit.");
  }
  if (bytes.toString("utf8") !== input.rawProviderBody) {
    fail("preventure_output_raw_body_changed", "Raw provider bytes and decoded text differ.");
  }
  const textHash = sha256(input.rawProviderBody);
  const byteHash = sha256(bytes);
  if (input.rawProviderBodyHash !== undefined && input.rawProviderBodyHash !== textHash) {
    fail("preventure_output_raw_body_changed", "The declared raw provider text hash differs.");
  }
  if (input.rawProviderBytesHash !== undefined && input.rawProviderBytesHash !== byteHash) {
    fail("preventure_output_raw_body_changed", "The declared raw provider byte hash differs.");
  }
  return { bytes, text: input.rawProviderBody, textHash, byteHash };
}

function semanticInput(input, maximumBytes, firstWrite, assignmentMaxCostAudCentsForHash) {
  const artifactKind = String(input.artifactKind || "");
  if (![
    "canonical_known_response",
    "known_effect_invalid",
    "known_pre_effect_rejection",
  ].includes(artifactKind)) {
    fail("preventure_output_kind_invalid", "The provider artifact kind is invalid.");
  }
  const assignmentHash = hash(input.assignmentHash, "Assignment hash");
  let expectedAssignmentMaxCostAudCents;
  try {
    expectedAssignmentMaxCostAudCents = Number(
      assignmentMaxCostAudCentsForHash(assignmentHash),
    );
  } catch {
    fail(
      "preventure_output_assignment_cap_unavailable",
      "The exact assignment cost cap is unavailable.",
    );
  }
  const assignmentMaxCostAudCents = Number(input.assignmentMaxCostAudCents);
  if (
    !Number.isSafeInteger(assignmentMaxCostAudCents)
    || assignmentMaxCostAudCents < 1
    || assignmentMaxCostAudCents > 10_000
    || !Number.isSafeInteger(expectedAssignmentMaxCostAudCents)
    || assignmentMaxCostAudCents !== expectedAssignmentMaxCostAudCents
  ) {
    fail(
      "preventure_output_assignment_cap_invalid",
      "The exact assignment cost cap is missing or invalid.",
    );
  }
  const requestBodyHash = hash(input.requestBodyHash, "Request-body hash", !firstWrite);
  const providerResponseHash = hash(
    input.providerResponseHash,
    "Provider response hash",
    artifactKind !== "canonical_known_response",
  );
  const exactRaw = rawBody(input, maximumBytes);
  assertNoKnownSensitiveValue(input, exactRaw);
  safeBoundedText(exactRaw.text, "Raw provider response", maximumBytes, false);
  let parsedRaw;
  let rawJsonParsed = false;
  try {
    parsedRaw = JSON.parse(exactRaw.text);
    rawJsonParsed = true;
  } catch {}
  const providerResponseId = providerId(
    input.providerResponseId,
    "Provider response ID",
    artifactKind !== "canonical_known_response",
  );
  const providerRequestId = providerId(input.providerRequestId, "Provider request ID", true);
  const clientRequestId = providerId(input.clientRequestId, "Client request ID");
  if (
    (providerResponseId !== null && providerResponseId === providerRequestId)
    || providerResponseId === clientRequestId
    || providerRequestId === clientRequestId
  ) {
    fail(
      "preventure_output_provider_id_collision",
      "Provider response, provider request, and client request identities must remain distinct.",
    );
  }
  if (rawJsonParsed) assertSafeProviderJson(parsedRaw);
  const parsedBodyId = isObject(parsedRaw)
    && /^[A-Za-z0-9._:-]{1,200}$/.test(String(parsedRaw.id || ""))
    ? String(parsedRaw.id)
    : null;
  if (artifactKind === "canonical_known_response") {
    if (
      !isObject(input.providerResponse)
      || !isObject(parsedRaw)
      || !sameCanonical(parsedRaw, input.providerResponse)
      || sha256(input.providerResponse) !== providerResponseHash
      || providerResponseId !== input.providerResponse.id
    ) {
      fail(
        "preventure_output_canonical_response_changed",
        "Raw text, parsed response, response hash, and Responses-body ID must match exactly.",
      );
    }
  } else if (!rawJsonParsed) {
    if (input.providerResponse !== null || providerResponseHash !== null || providerResponseId !== null) {
      fail(
        "preventure_output_invalid_effect_changed",
        "An unparsable known effect cannot claim a parsed response or response ID.",
      );
    }
  } else if (
    !sameCanonical(parsedRaw, input.providerResponse)
    || sha256(input.providerResponse) !== providerResponseHash
    || providerResponseId !== parsedBodyId
  ) {
    fail("preventure_output_invalid_effect_changed", "The retained known-effect response is contradictory.");
  }
  const groundedSourceSetHash = hash(input.groundedSourceSetHash, "Grounded source-set hash");
  const billingHash = hash(input.billingHash, "Billing hash");
  assertGroundedSources(input.groundedSources);
  assertBilling(input.billing, artifactKind);
  assertResponseMetadata(input.responseMetadata || {}, artifactKind, clientRequestId);
  if (input.output !== null && input.output !== undefined) {
    safeBoundedText(input.output, "Retained structured output", maximumBytes, false);
  }
  if (
    sha256(input.groundedSources) !== groundedSourceSetHash
    || sha256(input.billing) !== billingHash
    || (input.billing.costAudCents !== null
      && input.billing.costAudCents > assignmentMaxCostAudCents)
  ) {
    fail("preventure_output_binding_invalid", "Grounding or billing differs from its exact hash.");
  }
  if (artifactKind === "known_pre_effect_rejection") {
    const metadata = input.responseMetadata;
    const httpStatus = Number(metadata?.httpStatus);
    const boundedProviderError = (value) => value === null
      || (typeof value === "string" && value.length >= 1 && value.length <= 200);
    const errorEnvelope = rawJsonParsed && isObject(parsedRaw) && isObject(parsedRaw.error)
      ? parsedRaw.error
      : null;
    if (isObject(parsedRaw)) {
      exactKeys(parsedRaw, ["error"], ["error"], "Provider error response");
    }
    if (errorEnvelope) {
      exactKeys(
        errorEnvelope,
        ["code", "message", "param", "type"],
        ["code", "message", "type"],
        "Provider error envelope",
      );
      safeBoundedText(errorEnvelope.message, "Provider error message", 2048, false);
      if (Object.hasOwn(errorEnvelope, "param")) {
        safeBoundedText(errorEnvelope.param, "Provider error parameter", 200, true);
      }
    }
    const exactErrorType = typeof errorEnvelope?.type === "string" && errorEnvelope.type
      ? errorEnvelope.type
      : null;
    const exactErrorCode = typeof errorEnvelope?.code === "string" && errorEnvelope.code
      ? errorEnvelope.code
      : null;
    const metadataKeys = [
      "httpStatus",
      "observedWebSearchCallCount",
      "providerErrorCode",
      "providerErrorType",
      "usage",
    ];
    const billingKeys = [
      "costAudCents",
      "costStatus",
      "currency",
      "exactBillingPending",
      "exposureAudCents",
      "providerZeroBillingGuarantee",
    ];
    if (
      providerResponseId !== null
      || input.output !== null
      || !Array.isArray(input.groundedSources)
      || input.groundedSources.length !== 0
      || !errorEnvelope
      || exactErrorType === null
      || Object.hasOwn(parsedRaw, "id")
      || Object.hasOwn(parsedRaw, "usage")
      || Object.hasOwn(parsedRaw, "output")
      || !isObject(metadata)
      || !sameCanonical(Object.keys(metadata).sort(), metadataKeys)
      || !Number.isSafeInteger(httpStatus)
      || !isDefinitePreEffectHttpStatus(httpStatus)
      || !boundedProviderError(metadata.providerErrorType ?? null)
      || !boundedProviderError(metadata.providerErrorCode ?? null)
      || metadata.providerErrorType !== exactErrorType
      || metadata.providerErrorCode !== exactErrorCode
      || metadata.usage !== null
      || metadata.observedWebSearchCallCount !== 0
      || !isObject(input.billing)
      || !sameCanonical(Object.keys(input.billing).sort(), billingKeys)
      || input.billing.currency !== "AUD"
      || input.billing.costAudCents !== 0
      || input.billing.costStatus !== "estimated"
      || input.billing.exactBillingPending !== true
      || input.billing.providerZeroBillingGuarantee !== false
      || !Number.isSafeInteger(input.billing.exposureAudCents)
      || input.billing.exposureAudCents !== assignmentMaxCostAudCents
    ) {
      fail(
        "preventure_output_pre_effect_changed",
        "The retained official pre-effect rejection has contradictory effect or billing truth.",
      );
    }
  }
  return canonical({
    schema: OUTPUT_ARTIFACT_SCHEMA,
    artifactKind,
    assignmentMaxCostAudCents,
    authorityHash: hash(input.authorityHash, "Authority hash"),
    assignmentHash,
    descriptorHash: hash(input.descriptorHash, "Descriptor hash"),
    requestBodyHash,
    providerRequestId,
    providerResponseId,
    clientRequestId,
    providerResponse: input.providerResponse,
    providerResponseHash,
    rawProviderBodyBase64: exactRaw.bytes.toString("base64"),
    rawProviderBodyByteLength: exactRaw.bytes.length,
    rawProviderBodyHash: exactRaw.textHash,
    rawProviderBytesHash: exactRaw.byteHash,
    output: input.output ?? null,
    outputHash: sha256(input.output ?? null),
    groundedSources: input.groundedSources,
    groundedSourceSetHash,
    billing: input.billing,
    billingHash,
    responseMetadata: canonical(input.responseMetadata || {}),
    responseMetadataHash: sha256(input.responseMetadata || {}),
  });
}

function validateRecord(
  stored,
  expectedHash = null,
  maximumBytes = MAX_RETAINED_OUTPUT_BYTES,
  assignmentMaxCostAudCentsForHash,
  sensitiveValues = [],
) {
  if (!isObject(stored) || stored.schema !== OUTPUT_ARTIFACT_SCHEMA) {
    fail("preventure_output_artifact_invalid", "The provider artifact schema is invalid.");
  }
  const { artifactHash, artifactRef: ref, location, retained, retainedAt, ...semantic } = stored;
  hash(artifactHash, "Artifact hash");
  const normalizedRetainedAt = exactTimestamp(retainedAt);
  if (
    artifactHash !== sha256({ ...semantic, retainedAt })
    || (expectedHash && artifactHash !== expectedHash)
    || ref !== artifactRef(artifactHash)
    || location !== ref
    || retained !== true
  ) {
    fail("preventure_output_artifact_changed", "The immutable provider manifest hash changed.");
  }
  const revalidatedSemantic = semanticInput({
    ...semantic,
    rawProviderBody: Buffer.from(semantic.rawProviderBodyBase64, "base64").toString("utf8"),
    rawProviderBodyBytes: Buffer.from(semantic.rawProviderBodyBase64, "base64"),
    sensitiveValues,
  }, maximumBytes, true, assignmentMaxCostAudCentsForHash);
  if (normalizedRetainedAt !== retainedAt || !sameCanonical(revalidatedSemantic, semantic)) {
    fail(
      "preventure_output_artifact_changed",
      "The immutable provider manifest contains contradictory content or derived hashes.",
    );
  }
  return deepFreeze({
    ...stored,
    retainedOutputHash: ref,
    rawProviderBody: Buffer.from(stored.rawProviderBodyBase64, "base64").toString("utf8"),
  });
}

function createPreventureResearchOutputStore(options = {}) {
  const root = path.resolve(
    options.artifactRoot || path.join(process.cwd(), "data", "artifacts", "preventure-research"),
  );
  const maximumBytes = Number(options.maximumBytes || MAX_RETAINED_OUTPUT_BYTES);
  const maximumManifestBytes = Number(
    options.maximumManifestBytes || MAX_RETAINED_MANIFEST_BYTES,
  );
  const assignmentMaxCostAudCentsForHash = options.assignmentMaxCostAudCentsForHash;
  if (typeof assignmentMaxCostAudCentsForHash !== "function") {
    fail(
      "preventure_output_assignment_cap_resolver_invalid",
      "The exact assignment cost-cap resolver is required.",
    );
  }
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1024) {
    fail("preventure_output_limit_invalid", "The provider artifact byte limit is invalid.");
  }
  if (
    !Number.isSafeInteger(maximumManifestBytes)
    || maximumManifestBytes < (maximumBytes * 4) + (64 * 1024)
    || maximumManifestBytes > 128 * 1024 * 1024
  ) {
    fail("preventure_output_limit_invalid", "The provider manifest byte limit is invalid.");
  }
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  assertUnlinkedAbsolutePrefix(root);
  assertDirectoryChain(root, root);

  function readRegularJson(file, maximumSize, label) {
    assertDirectoryChain(root, path.dirname(file));
    const flags = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0);
    let descriptor;
    try {
      descriptor = fs.openSync(file, flags);
      const before = fs.fstatSync(descriptor);
      const pathStat = fs.lstatSync(file);
      if (
        !before.isFile()
        || pathStat.isSymbolicLink()
        || before.dev !== pathStat.dev
        || before.ino !== pathStat.ino
        || before.size < 2
        || before.size > maximumSize
      ) fail("preventure_output_artifact_invalid", `${label} is invalid.`);
      const rootReal = fs.realpathSync(root);
      const fileReal = fs.realpathSync(file);
      const relative = path.relative(rootReal, fileReal);
      if (relative.startsWith("..") || path.isAbsolute(relative)) {
        fail("preventure_output_path_invalid", `${label} resolved outside its root.`);
      }
      const text = fs.readFileSync(descriptor, "utf8");
      const after = fs.fstatSync(descriptor);
      const finalPathStat = fs.lstatSync(file);
      if (
        before.dev !== after.dev
        || before.ino !== after.ino
        || before.size !== after.size
        || after.dev !== finalPathStat.dev
        || after.ino !== finalPathStat.ino
      ) fail("preventure_output_artifact_changed", `${label} changed while it was read.`);
      try {
        return {
          value: JSON.parse(text),
          identity: Object.freeze({ dev: after.dev, ino: after.ino, size: after.size }),
        };
      } catch {
        fail("preventure_output_artifact_invalid", `${label} is not valid JSON.`);
      }
    } finally {
      if (descriptor !== undefined) {
        try { fs.closeSync(descriptor); } catch {}
      }
    }
  }

  function readHash(artifactHash) {
    const file = artifactPath(root, artifactHash);
    let read;
    try {
      read = readRegularJson(file, maximumManifestBytes, "The provider artifact");
    } catch (error) {
      if (error?.code === "ENOENT") {
        fail("preventure_output_artifact_missing", "The provider artifact is missing.");
      }
      throw error;
    }
    return validateRecord(
      read.value,
      artifactHash,
      maximumBytes,
      assignmentMaxCostAudCentsForHash,
    );
  }

  function readClaim(identityHash, sensitiveValues = []) {
    const file = stableClaimPath(root, identityHash);
    let claimRead;
    try {
      claimRead = readRegularJson(
        file,
        maximumManifestBytes,
        "The provider artifact claim",
      );
    } catch (error) {
      if (error?.code === "ENOENT") {
        fail("preventure_output_claim_missing", "The stable provider artifact claim is missing.");
      }
      throw error;
    }
    const record = validateRecord(
      claimRead.value,
      null,
      maximumBytes,
      assignmentMaxCostAudCentsForHash,
      sensitiveValues,
    );
    if (stableIdentityHash(record) !== identityHash) {
      fail("preventure_output_artifact_changed", "The provider artifact claim changed identity.");
    }
    const content = artifactPath(root, record.artifactHash);
    let contentRead;
    try {
      contentRead = readRegularJson(
        content,
        maximumManifestBytes,
        "The provider artifact claimed content",
      );
    } catch (error) {
      if (error?.code === "ENOENT") {
        fail("preventure_output_artifact_missing", "The claimed provider artifact is missing.");
      }
      throw error;
    }
    const contentRecord = validateRecord(
      contentRead.value,
      record.artifactHash,
      maximumBytes,
      assignmentMaxCostAudCentsForHash,
      sensitiveValues,
    );
    const claimStat = fs.lstatSync(file);
    const contentStat = fs.lstatSync(content);
    if (
      claimStat.isSymbolicLink()
      || contentStat.isSymbolicLink()
      || claimRead.identity.dev !== claimStat.dev
      || claimRead.identity.ino !== claimStat.ino
      || contentRead.identity.dev !== contentStat.dev
      || contentRead.identity.ino !== contentStat.ino
      || claimRead.identity.dev !== contentRead.identity.dev
      || claimRead.identity.ino !== contentRead.identity.ino
      || claimStat.dev !== contentStat.dev
      || claimStat.ino !== contentStat.ino
      || claimStat.nlink < 2
      || !sameCanonical(record, contentRecord)
    ) {
      fail(
        "preventure_output_artifact_changed",
        "The stable provider claim is not anchored to its immutable content artifact.",
      );
    }
    return record;
  }

  function load(reference) {
    const artifactHash = hashFromReference(reference);
    const record = readHash(artifactHash);
    const claimed = readClaim(stableIdentityHash(record));
    if (!sameCanonical(record, claimed)) {
      fail(
        "preventure_output_artifact_changed",
        "The referenced provider artifact differs from its stable immutable claim.",
      );
    }
    if (isObject(reference)) {
      for (const key of ["authorityHash", "assignmentHash", "descriptorHash"]) {
        if (reference[key] !== undefined && reference[key] !== record[key]) {
          fail("preventure_output_reference_binding_changed", `Retained output changed ${key}.`);
        }
      }
    }
    return claimed;
  }

  function loadByStableBinding(binding, lookupOptions = {}) {
    exactKeys(
      binding,
      ["assignmentHash", "authorityHash", "descriptorHash", "requestBodyHash"],
      ["assignmentHash", "authorityHash", "descriptorHash", "requestBodyHash"],
      "Stable provider artifact binding",
    );
    exactKeys(
      lookupOptions,
      ["sensitiveValues"],
      [],
      "Stable provider artifact lookup options",
    );
    const exactBinding = {
      authorityHash: hash(binding.authorityHash, "Authority hash"),
      assignmentHash: hash(binding.assignmentHash, "Assignment hash"),
      descriptorHash: hash(binding.descriptorHash, "Descriptor hash"),
      requestBodyHash: hash(binding.requestBodyHash, "Request-body hash"),
    };
    const sensitiveValues = lookupOptions.sensitiveValues === undefined
      ? []
      : lookupOptions.sensitiveValues;
    if (!Array.isArray(sensitiveValues)) {
      fail(
        "preventure_output_shape_invalid",
        "Stable provider artifact lookup options contain unsupported fields.",
      );
    }
    let record;
    try {
      record = readClaim(stableIdentityHash({
        schema: OUTPUT_ARTIFACT_SCHEMA,
        ...exactBinding,
      }), sensitiveValues);
    } catch (error) {
      if (error?.code === "preventure_output_claim_missing") return null;
      throw error;
    }
    for (const [key, value] of Object.entries(exactBinding)) {
      if (record[key] !== value) {
        fail(
          "preventure_output_reference_binding_changed",
          `Retained output changed ${key}.`,
        );
      }
    }
    return record;
  }

  function validateReplay(record, input) {
    const semantic = semanticInput(
      input,
      maximumBytes,
      false,
      assignmentMaxCostAudCentsForHash,
    );
    for (const [key, value] of Object.entries(semantic)) {
      if (value !== null && value !== undefined && !sameCanonical(record[key], value)) {
        fail("preventure_output_replay_conflict", `Provider artifact replay changed ${key}.`);
      }
    }
    if (input.requestBodyHash === undefined || input.requestBodyHash === null) {
      fail(
        "preventure_output_request_binding_required",
        "Every immutable replay requires the exact canonical request-body hash.",
      );
    }
    return record;
  }

  function writeTemporary(file, bytes) {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    assertDirectoryChain(root, path.dirname(file));
    const temporary = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
    let descriptor;
    try {
      descriptor = fs.openSync(temporary, "wx", 0o600);
      fs.writeFileSync(descriptor, bytes);
      fs.fsyncSync(descriptor);
      const identity = fs.fstatSync(descriptor);
      fs.closeSync(descriptor);
      descriptor = null;
      const pathIdentity = fs.lstatSync(temporary);
      if (
        !identity.isFile()
        || pathIdentity.isSymbolicLink()
        || identity.dev !== pathIdentity.dev
        || identity.ino !== pathIdentity.ino
        || identity.size !== bytes.length
      ) {
        fail("preventure_output_artifact_changed", "The provider artifact staging file changed.");
      }
      return { path: temporary, identity };
    } catch (error) {
      if (descriptor !== null && descriptor !== undefined) {
        try { fs.closeSync(descriptor); } catch {}
      }
      try { fs.rmSync(temporary, { force: true }); } catch {}
      throw error;
    }
  }

  function syncDirectory(directory) {
    let descriptor;
    try {
      descriptor = fs.openSync(directory, fs.constants.O_RDONLY);
      fs.fsyncSync(descriptor);
    } catch (error) {
      if (!["EPERM", "EINVAL", "EBADF", "ENOTSUP"].includes(error?.code)) throw error;
    } finally {
      if (descriptor !== undefined) {
        try { fs.closeSync(descriptor); } catch {}
      }
    }
  }

  function sameFileIdentity(file, identity) {
    try {
      const stat = fs.lstatSync(file);
      return stat.isFile()
        && !stat.isSymbolicLink()
        && stat.dev === identity.dev
        && stat.ino === identity.ino;
    } catch {
      return false;
    }
  }

  function unlinkOwned(file, identity) {
    if (!sameFileIdentity(file, identity)) return false;
    fs.unlinkSync(file);
    syncDirectory(path.dirname(file));
    return true;
  }

  function linkExclusive(source, destination) {
    fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
    assertDirectoryChain(root, path.dirname(destination));
    try {
      fs.linkSync(source, destination);
      syncDirectory(path.dirname(destination));
      return true;
    } catch (error) {
      if (error?.code === "EEXIST") return false;
      throw error;
    }
  }

  function retain(input = {}) {
    const semantic = semanticInput(
      input,
      maximumBytes,
      true,
      assignmentMaxCostAudCentsForHash,
    );
    const identityHash = stableIdentityHash(semantic);
    const retainedAt = exactTimestamp(input.retainedAt);
    const artifactHash = sha256({ ...semantic, retainedAt });
    const ref = artifactRef(artifactHash);
    const record = {
      ...semantic,
      retained: true,
      retainedAt,
      artifactHash,
      artifactRef: ref,
      location: ref,
    };
    const bytes = Buffer.from(JSON.stringify(canonical(record)), "utf8");
    if (bytes.length > maximumManifestBytes) {
      fail("preventure_output_artifact_too_large", "The complete provider manifest is too large.");
    }
    const claim = stableClaimPath(root, identityHash);
    const file = artifactPath(root, artifactHash);
    const temporary = writeTemporary(file, bytes);
    let contentCreated = false;
    let claimCreated = false;
    let contentIdentity = null;
    try {
      if (!sameFileIdentity(temporary.path, temporary.identity)) {
        fail("preventure_output_artifact_changed", "The provider artifact staging file changed.");
      }
      contentCreated = linkExclusive(temporary.path, file);
      if (!contentCreated) {
        const published = readHash(artifactHash);
        if (!sameCanonical(published, validateRecord(
          record,
          artifactHash,
          maximumBytes,
          assignmentMaxCostAudCentsForHash,
        ))) {
          fail("preventure_output_artifact_changed", "The retained provider artifact changed at publication.");
        }
      }
      contentIdentity = fs.lstatSync(file);
      claimCreated = linkExclusive(file, claim);
      if (!claimCreated) {
        const existing = readClaim(identityHash);
        try {
          return validateReplay(existing, input);
        } finally {
          if (contentCreated) {
            const claimStat = fs.lstatSync(claim);
            const contentStat = fs.lstatSync(file);
            if (claimStat.dev !== contentStat.dev || claimStat.ino !== contentStat.ino) {
              unlinkOwned(file, temporary.identity);
            }
          }
        }
      }
      const published = readHash(artifactHash);
      const claimed = readClaim(identityHash);
      if (!sameCanonical(published, claimed)) {
        fail("preventure_output_artifact_changed", "The provider claim and content artifact disagree.");
      }
      return published;
    } catch (error) {
      if (claimCreated && contentIdentity) unlinkOwned(claim, contentIdentity);
      if (contentCreated) unlinkOwned(file, temporary.identity);
      throw error;
    } finally {
      try { unlinkOwned(temporary.path, temporary.identity); } catch {}
    }
  }

  function status() {
    const probeId = `.hardlink-probe-${process.pid}-${crypto.randomUUID()}`;
    const content = path.join(root, "health-content", `${probeId}.content`);
    const claim = path.join(root, "health-claims", `${probeId}.claim`);
    let temporary = null;
    let contentCreated = false;
    let claimCreated = false;
    try {
      assertDirectoryChain(root, root);
      const bytes = Buffer.from("pantheon-preventure-hardlink-probe", "utf8");
      temporary = writeTemporary(content, bytes);
      contentCreated = linkExclusive(temporary.path, content);
      if (!contentCreated) {
        fail("preventure_output_health_probe_failed", "The content hard-link probe collided.");
      }
      claimCreated = linkExclusive(content, claim);
      if (!claimCreated) {
        fail("preventure_output_health_probe_failed", "The claim hard-link probe collided.");
      }
      const tempStat = fs.lstatSync(temporary.path);
      const contentStat = fs.lstatSync(content);
      const claimStat = fs.lstatSync(claim);
      const descriptor = fs.openSync(content, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
      let reread;
      let descriptorStat;
      try {
        reread = fs.readFileSync(descriptor);
        descriptorStat = fs.fstatSync(descriptor);
      } finally {
        fs.closeSync(descriptor);
      }
      if (
        !reread.equals(bytes)
        || tempStat.isSymbolicLink()
        || contentStat.isSymbolicLink()
        || claimStat.isSymbolicLink()
        || tempStat.dev !== contentStat.dev
        || tempStat.ino !== contentStat.ino
        || tempStat.dev !== claimStat.dev
        || tempStat.ino !== claimStat.ino
        || descriptorStat.dev !== tempStat.dev
        || descriptorStat.ino !== tempStat.ino
        || tempStat.nlink < 3
      ) {
        fail(
          "preventure_output_health_probe_failed",
          "The artifact filesystem did not preserve one exact hard-linked inode.",
        );
      }
      if (!unlinkOwned(claim, temporary.identity)) {
        fail("preventure_output_health_probe_failed", "The claim hard-link probe could not be cleaned.");
      }
      claimCreated = false;
      if (!unlinkOwned(content, temporary.identity)) {
        fail("preventure_output_health_probe_failed", "The content hard-link probe could not be cleaned.");
      }
      contentCreated = false;
      if (!unlinkOwned(temporary.path, temporary.identity)) {
        fail("preventure_output_health_probe_failed", "The staging hard-link probe could not be cleaned.");
      }
      temporary = null;
      return Object.freeze({
        ready: true,
        status: "ready",
        blocker: null,
        maximumBytes,
        maximumManifestBytes,
      });
    } catch {
      if (claimCreated && temporary) {
        try { unlinkOwned(claim, temporary.identity); } catch {}
      }
      if (contentCreated && temporary) {
        try { unlinkOwned(content, temporary.identity); } catch {}
      }
      if (temporary) {
        try { unlinkOwned(temporary.path, temporary.identity); } catch {}
      }
      return Object.freeze({
        ready: false,
        status: "blocked",
        blocker: "artifact_root_not_secure_writable_directory",
        maximumBytes,
        maximumManifestBytes,
      });
    }
  }

  return Object.freeze({
    kind: EXACT_OUTPUT_STORE_KIND,
    load,
    loadByStableBinding,
    retain,
    status,
  });
}

module.exports = {
  MAX_RETAINED_MANIFEST_BYTES,
  MAX_RETAINED_OUTPUT_BYTES,
  OUTPUT_ARTIFACT_SCHEMA,
  createPreventureResearchOutputStore,
};
