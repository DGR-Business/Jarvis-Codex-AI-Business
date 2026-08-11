"use strict";

const net = require("node:net");

const {
  MAX_OPENAI_RESPONSE_BYTES,
  OFFICIAL_OPENAI_RESPONSES_URL,
  assertOpenAiResponsesEgress,
  inspectOpenAiEgressPolicy,
  isDefinitePreEffectHttpStatus,
  safeProviderErrorMessage,
} = require("./openai-egress-policy");
const { sha256 } = require("../runtime/commercial-test-contract");
const {
  EXACT_LOCAL_PARSER_KIND,
  EXACT_TRANSPORT_KIND,
  deriveKnownEffectInvalidResponseIssues,
  normalizePreventureProviderResponse,
} = require("../runtime/preventure-research-runner");

const PREVENTURE_TRANSPORT_SCHEMA = "pantheon.preventure-openai-transport.v1";
const GROUNDING_SOURCES = Object.freeze([
  "web_search_call.action.sources",
  "message.output_text.annotations.url_citation",
]);

function transportError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.kind = details.kind || code;
  error.providerDispatchStarted = details.providerDispatchStarted === true;
  error.providerOutcomeKnown = details.providerOutcomeKnown === true;
  error.definitePreEffect = details.definitePreEffect === true;
  error.costAudCents = details.costAudCents;
  error.httpStatus = details.httpStatus;
  error.providerRequestId = details.providerRequestId || null;
  error.clientRequestId = details.clientRequestId || null;
  for (const key of [
    "costStatus", "exactBillingPending", "exposureAudCents", "providerErrorCode",
    "providerErrorType", "providerResponseId", "providerZeroBillingGuarantee",
    "rawProviderBody", "rawProviderBodyHash", "retainedOutput",
  ]) {
    if (Object.hasOwn(details, key)) error[key] = details[key];
  }
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

function canonicalBytes(value) {
  return Buffer.from(JSON.stringify(canonical(value)), "utf8");
}

function sameCanonical(left, right) {
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
}

function exactRequest(descriptor, authority) {
  if (
    !isObject(descriptor)
    || descriptor.authorityHash !== authority.authorityHash
    || descriptor.provider !== authority.provider.id
    || descriptor.model !== authority.provider.model
    || descriptor.request?.method !== "POST"
    || descriptor.request?.endpointPath !== "/v1/responses"
    || descriptor.request?.responseStorage !== false
    || descriptor.request?.providerTraceContent !== false
  ) {
    throw transportError(
      "preventure_transport_descriptor_invalid",
      "The exact approved provider descriptor is unavailable or changed.",
    );
  }
  const body = descriptor.request.requestBody;
  const policy = authority.provider.requestPolicy;
  const expectedKeys = [
    "background",
    "include",
    "input",
    "max_output_tokens",
    "max_tool_calls",
    "metadata",
    "model",
    "parallel_tool_calls",
    "reasoning",
    "service_tier",
    "store",
    "text",
    "tool_choice",
    "tools",
  ];
  if (
    !isObject(body)
    || !sameCanonical(Object.keys(body).sort(), expectedKeys)
    || body.model !== authority.provider.model
    || body.store !== false
    || body.background !== false
    || body.service_tier !== "default"
    || body.parallel_tool_calls !== false
    || body.tool_choice !== "required"
    || !sameCanonical(body.tools, policy.tools)
    || body.tools?.length !== 1
    || body.tools[0]?.type !== "web_search"
    || body.tools[0]?.external_web_access !== true
    || body.tools[0]?.return_token_budget !== "default"
    || body.tools[0]?.search_context_size !== "medium"
    || !sameCanonical(body.include, ["web_search_call.action.sources"])
    || !sameCanonical(body.reasoning, { effort: "low" })
    || body.text?.format?.type !== "json_schema"
    || body.text?.format?.strict !== true
    || !isObject(body.text.format.schema)
    || body.max_tool_calls !== descriptor.limits.maxToolCalls
    || body.max_output_tokens !== descriptor.limits.maxOutputTokens
  ) {
    throw transportError(
      "preventure_transport_request_policy_changed",
      "The provider request no longer matches the owner-approved public-web research policy.",
    );
  }
  const bytes = canonicalBytes(body);
  if (
    sha256(bytes) !== descriptor.request.requestBodyHash
    || bytes.length !== descriptor.request.providerVisibleInputUtf8ByteLength
    || bytes.length !== descriptor.request.localInputTokenUpperBound
    || bytes.length > descriptor.limits.localPromptPreflightMaxInputTokens
  ) {
    throw transportError(
      "preventure_transport_request_bytes_changed",
      "The exact canonical provider request bytes changed or exceed the local safety bound.",
    );
  }
  return { body, bytes };
}

function cleanProviderText(value, maximum = 2048) {
  if (value === null || value === undefined || value === "") return null;
  const text = String(value).replace(/\s+/g, " ").trim();
  return text ? text.slice(0, maximum) : null;
}

function isPrivateIpv4(address) {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) return true;
  return parts[0] === 0
    || parts[0] === 10
    || parts[0] === 127
    || (parts[0] === 169 && parts[1] === 254)
    || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
    || (parts[0] === 192 && parts[1] === 168)
    || parts[0] >= 224;
}

function isPrivateIpv6(address) {
  const normalized = address.toLowerCase().split("%")[0];
  return normalized === "::"
    || normalized === "::1"
    || normalized.startsWith("fc")
    || normalized.startsWith("fd")
    || normalized.startsWith("fe8")
    || normalized.startsWith("fe9")
    || normalized.startsWith("fea")
    || normalized.startsWith("feb")
    || normalized.startsWith("::ffff:127.")
    || normalized.startsWith("::ffff:10.")
    || normalized.startsWith("::ffff:192.168.");
}

function safePublicUrl(value) {
  let parsed;
  try {
    parsed = new URL(String(value || ""));
  } catch {
    return null;
  }
  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  const ipVersion = net.isIP(host);
  if (
    parsed.protocol !== "https:"
    || parsed.username
    || parsed.password
    || !host
    || !host.includes(".")
    || ipVersion !== 0
    || host === "localhost"
    || host.endsWith(".localhost")
    || host.endsWith(".local")
    || host.endsWith(".internal")
    || host.endsWith(".test")
    || host.endsWith(".invalid")
    || host.endsWith(".example")
    || host.endsWith(".home")
    || host.endsWith(".lan")
  ) return null;
  return parsed.toString();
}

function groundingFromResponse(response) {
  const byUrl = new Map();
  let unsafe = false;
  const add = (source, provenance) => {
    if (!isObject(source) || !source.url) return;
    const url = safePublicUrl(source.url);
    if (!url) {
      unsafe = true;
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
    for (const key of ["provenance", "titles", "publishers", "snippets", "publishedAtValues"]) {
      current[key] = [...new Set(current[key])].sort();
    }
    byUrl.set(url, current);
  };
  for (const item of response?.output || []) {
    if (item?.type === "web_search_call") {
      for (const source of item.action?.sources || []) add(source, "web_search_action_source");
    }
    if (item?.type !== "message") continue;
    for (const part of item.content || []) {
      for (const annotation of part.annotations || []) {
        if (annotation?.type === "url_citation") add(annotation, "url_citation");
      }
    }
  }
  return {
    sources: [...byUrl.values()].sort((left, right) => left.url.localeCompare(right.url)),
    unsafe,
  };
}

function providerOutput(response) {
  const texts = [];
  const refusals = [];
  for (const item of response?.output || []) {
    if (item?.type !== "message") continue;
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

function integerUsage(payload, descriptor) {
  const usage = payload?.usage;
  const inputTokens = Number(usage?.input_tokens);
  const outputTokens = Number(usage?.output_tokens);
  const totalTokens = Number(usage?.total_tokens);
  const maximumInput = descriptor.limits.maxInputTokens * descriptor.limits.maximumModelPasses;
  if (
    !Number.isSafeInteger(inputTokens)
    || inputTokens < 0
    || inputTokens > maximumInput
    || !Number.isSafeInteger(outputTokens)
    || outputTokens < 0
    || outputTokens > descriptor.limits.maxOutputTokens
    || !Number.isSafeInteger(totalTokens)
    || totalTokens !== inputTokens + outputTokens
  ) return null;
  return Object.freeze({ inputTokens, outputTokens, totalTokens });
}

function exactCostAudCents(usage, webSearchCalls, authority, descriptor) {
  const pricing = authority.provider.pricingPolicy;
  if (
    pricing.model !== descriptor.model
    || pricing.pricingTier !== "standard"
    || pricing.inputUsdPerMillionTokens !== 0.25
    || pricing.outputUsdPerMillionTokens !== 2
    || pricing.webSearchUsdPerThousandCalls !== 10
    || pricing.audPerUsdCeiling !== 2
    || authority.provider.pricingPolicyHash !== sha256(pricing)
  ) {
    throw transportError(
      "preventure_transport_pricing_changed",
      "The exact reviewed provider pricing policy changed.",
    );
  }
  const denominator = 100_000_000n;
  const numerator = (BigInt(usage.inputTokens) * 5_000n)
    + (BigInt(usage.outputTokens) * 40_000n)
    + (BigInt(webSearchCalls) * 200_000_000n);
  const amount = Number((numerator + denominator - 1n) / denominator);
  if (!Number.isSafeInteger(amount) || amount < 0 || amount > descriptor.limits.maxCostAudCents) {
    throw transportError(
      "preventure_transport_cost_out_of_scope",
      "Provider-reported usage cannot be priced inside the exact assignment cap.",
      { providerDispatchStarted: true, providerOutcomeKnown: true },
    );
  }
  return amount;
}

async function boundedResponseBodyUnsafe(response, maximumBytes) {
  const contentLength = Number(response?.headers?.get?.("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maximumBytes) {
    throw transportError(
      "preventure_transport_response_too_large",
      "The provider response exceeded the bounded retention limit.",
      { providerDispatchStarted: true },
    );
  }
  if (response?.body && typeof response.body.getReader === "function") {
    const reader = response.body.getReader();
    const chunks = [];
    let total = 0;
    try {
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        const bytes = Buffer.from(part.value || []);
        total += bytes.length;
        if (total > maximumBytes) {
          await reader.cancel().catch(() => {});
          throw transportError(
            "preventure_transport_response_too_large",
            "The provider response exceeded the bounded retention limit.",
            { providerDispatchStarted: true },
          );
        }
        chunks.push(bytes);
      }
    } finally {
      reader.releaseLock();
    }
    return Buffer.concat(chunks, total);
  }
  if (typeof response?.text === "function") {
    const bytes = Buffer.from(await response.text(), "utf8");
    if (bytes.length > maximumBytes) {
      throw transportError(
        "preventure_transport_response_too_large",
        "The provider response exceeded the bounded retention limit.",
        { providerDispatchStarted: true },
      );
    }
    return bytes;
  }
  throw transportError(
    "preventure_transport_response_unreadable",
    "The provider response body could not be read completely.",
    { providerDispatchStarted: true },
  );
}

async function boundedResponseBody(response, maximumBytes) {
  try {
    return await boundedResponseBodyUnsafe(response, maximumBytes);
  } catch (error) {
    if (String(error?.code || "").startsWith("preventure_transport_")) throw error;
    throw transportError(
      "preventure_transport_response_unreadable",
      "The provider response body failed while being read; outcome and cost are unknown.",
      { providerDispatchStarted: true },
    );
  }
}

function responseIssues(payload, grounding, output) {
  const issues = [];
  if (payload?.status !== "completed") issues.push("response_not_completed");
  if (payload?.incomplete_details) issues.push("response_incomplete");
  if (output.refusals.length > 0) issues.push("provider_refusal");
  if (output.texts.length !== 1) issues.push("structured_output_missing_or_ambiguous");
  const calls = (payload?.output || []).filter((item) => item?.type === "web_search_call");
  if (calls.length < 1) issues.push("web_search_not_used");
  if (grounding.sources.length < 1) issues.push("provider_grounding_missing");
  if (grounding.unsafe) issues.push("unsafe_grounding_url");
  return [...new Set(issues)].sort();
}

function safeRetentionFailureDetail(value, sensitiveValues) {
  if (typeof value !== "string") return true;
  const text = value.trim();
  if (!text) return true;
  if (/\b(?:authorization|api[-_ ]?key|cookie|csrf|client[-_ ]?secret)\b/i.test(text)) {
    return false;
  }
  if (/\bBearer\s+[A-Za-z0-9._~+/=-]+/i.test(text) || /\bsk-[A-Za-z0-9_-]{8,}\b/.test(text)) {
    return false;
  }
  return !(sensitiveValues || []).some((secret) => {
    const exact = String(secret || "").trim();
    return exact.length >= 1 && text.includes(exact);
  });
}

function exactProviderRequestIdFromResponse(response) {
  if (!response?.headers || typeof response.headers.get !== "function") {
    return Object.freeze({ providerRequestId: null, invalid: false });
  }
  let candidate = null;
  for (const name of ["x-request-id", "request-id"]) {
    const value = response.headers.get(name);
    if (value !== null && value !== undefined) {
      candidate = String(value);
      break;
    }
  }
  if (candidate === null) {
    return Object.freeze({ providerRequestId: null, invalid: false });
  }
  if (!/^[A-Za-z0-9._:-]{1,200}$/.test(candidate)) {
    return Object.freeze({ providerRequestId: null, invalid: true });
  }
  return Object.freeze({ providerRequestId: candidate, invalid: false });
}

function exactRetentionTimestamp(clock) {
  let value;
  try {
    value = clock();
  } catch {
    throw transportError(
      "preventure_transport_clock_invalid",
      "The exact runtime clock is unavailable for immutable provider-output custody.",
      { providerDispatchStarted: true, providerOutcomeKnown: true },
    );
  }
  const parsed = value instanceof Date
    ? new Date(value.getTime())
    : typeof value === "string" && value.trim()
      ? new Date(value)
      : new Date(Number.NaN);
  if (!Number.isFinite(parsed.getTime())) {
    throw transportError(
      "preventure_transport_clock_invalid",
      "The exact runtime clock is unavailable for immutable provider-output custody.",
      { providerDispatchStarted: true, providerOutcomeKnown: true },
    );
  }
  return parsed.toISOString();
}

function retainKnownArtifact(
  outputStore,
  input,
  costAudCents,
  sensitiveValues = [],
  failureDetails = {},
) {
  try {
    return outputStore.retain({ ...input, sensitiveValues });
  } catch (error) {
    error.providerDispatchStarted = true;
    error.providerOutcomeKnown = true;
    error.knownProviderRetentionFailed = true;
    error.costAudCents = Number.isSafeInteger(costAudCents) ? costAudCents : null;
    for (const key of [
      "costStatus", "exactBillingPending", "exposureAudCents", "httpStatus",
      "providerErrorCode", "providerErrorType", "providerRequestId", "providerResponseId",
      "providerZeroBillingGuarantee",
    ]) {
      if (
        Object.hasOwn(failureDetails, key)
        && safeRetentionFailureDetail(failureDetails[key], sensitiveValues)
      ) {
        error[key] = failureDetails[key];
      }
    }
    throw error;
  }
}

function createPreventureResearchOpenAiTransport(options = {}) {
  const authority = options.authority;
  const outputStore = options.outputStore;
  if (!isObject(authority) || !isObject(outputStore) || typeof outputStore.retain !== "function") {
    throw transportError(
      "preventure_transport_dependencies_invalid",
      "The exact authority and immutable output store are required.",
    );
  }
  const allowTestOverrides = options.allowTestOverrides === true;
  if (!allowTestOverrides && (options.fetchImpl || options.apiKey)) {
    throw transportError(
      "preventure_transport_test_override_forbidden",
      "Production research cannot receive injected credentials or network transports.",
    );
  }
  const fetchImpl = allowTestOverrides && options.fetchImpl ? options.fetchImpl : globalThis.fetch;
  const apiKey = () => (
    allowTestOverrides && options.apiKey !== undefined
      ? String(options.apiKey || "").trim()
      : String(process.env.OPENAI_API_KEY || "").trim()
  );
  const liveResearchEnabled = () => (
    allowTestOverrides
      ? options.liveResearchEnabled !== false
      : process.env.PANTHEON_ENABLE_LIVE_RESEARCH === "1"
  );

  if (
    typeof options.clientRequestIdForClaim !== "function"
    || typeof options.assertProviderRetentionBinding !== "function"
    || typeof options.clock !== "function"
  ) {
    throw transportError(
      "preventure_transport_retention_binding_invalid",
      "The exact original provider-dispatch binding is required before network-result retention.",
    );
  }

  function status(capturedCredential) {
    const egress = inspectOpenAiEgressPolicy();
    const artifact = outputStore.status?.() || { ready: false };
    const credentialConfigured = Boolean(
      capturedCredential === undefined ? apiKey() : capturedCredential,
    );
    const enabled = liveResearchEnabled();
    const blockers = [
      ...egress.blockers,
      ...(!credentialConfigured ? [{
        code: "openai_credential_not_configured",
        message: "Secure OpenAI access is not available to this Pantheon process.",
      }] : []),
      ...(!enabled ? [{
        code: "live_research_not_enabled",
        message: "The dedicated live-research process gate is not enabled.",
      }] : []),
      ...(!artifact.ready ? [{
        code: "provider_artifact_store_unavailable",
        message: "The private immutable provider-output store is unavailable.",
      }] : []),
    ];
    return Object.freeze({
      ready: blockers.length === 0,
      status: blockers.length === 0 ? "ready" : "blocked",
      credentialConfigured,
      liveResearchEnabled: enabled,
      egressReady: egress.ready,
      artifactStoreReady: artifact.ready === true,
      endpoint: OFFICIAL_OPENAI_RESPONSES_URL,
      blockers,
    });
  }

  function preflight(input = {}, capturedCredential) {
    const exact = exactRequest(input.descriptor, authority);
    if (input.expectedRequestBodyHash !== input.descriptor.request.requestBodyHash) {
      throw transportError(
        "preventure_transport_request_hash_stale",
        "Refresh the research request because its exact hash changed.",
      );
    }
    const health = status(capturedCredential);
    if (!health.ready) {
      throw transportError(
        "preventure_transport_not_ready",
        health.blockers.map((blocker) => blocker.message).join(" "),
      );
    }
    assertOpenAiResponsesEgress();
    return Object.freeze({
      ready: true,
      schema: PREVENTURE_TRANSPORT_SCHEMA,
      provider: input.descriptor.provider,
      endpoint: OFFICIAL_OPENAI_RESPONSES_URL,
      method: "POST",
      requestBodyHash: input.descriptor.request.requestBodyHash,
      requestBodyByteLength: exact.bytes.length,
      responseStorage: false,
      background: false,
      canonicalResponseRetention: true,
      estimatedInputTokens: exact.bytes.length,
      toolTypes: ["web_search"],
      toolConfiguration: canonical(exact.body.tools),
      groundingSources: [...GROUNDING_SOURCES],
      redirectsAllowed: false,
      retries: 0,
    });
  }

  function inspect(descriptor) {
    const health = status();
    let requestExact = false;
    let requestBodyHash = null;
    let requestBodyByteLength = null;
    const blockers = [...health.blockers];
    try {
      const exact = exactRequest(descriptor, authority);
      requestExact = true;
      requestBodyHash = descriptor.request.requestBodyHash;
      requestBodyByteLength = exact.bytes.length;
    } catch (error) {
      blockers.push({
        code: error.code || "preventure_transport_request_invalid",
        message: error.message,
      });
    }
    return Object.freeze({
      ...health,
      ready: health.ready && requestExact,
      status: health.ready && requestExact ? "ready" : "blocked",
      requestExact,
      requestBodyHash,
      requestBodyByteLength,
      blockers,
    });
  }

  async function assertRetentionBinding(input, descriptor, clientRequestId) {
    let binding;
    try {
      binding = await options.assertProviderRetentionBinding({
        claimToken: input.claimToken,
        authorityHash: descriptor.authorityHash,
        assignmentHash: descriptor.assignmentHash,
        descriptorHash: descriptor.descriptorHash,
        taskId: input.taskId,
        taskAttemptId: input.taskAttemptId,
        clientRequestId,
      });
    } catch {
      throw transportError(
        "preventure_transport_retention_binding_changed",
        "The provider response no longer matches one exact original pre-expiry dispatch.",
        { providerDispatchStarted: true },
      );
    }
    if (
      !isObject(binding)
      || binding.retentionBound !== true
      || typeof binding.current !== "boolean"
      || typeof binding.terminalRetention !== "boolean"
      || typeof binding.emergencyStopped !== "boolean"
      || binding.current === binding.terminalRetention
      || (binding.emergencyStopped && !binding.terminalRetention)
      || !["activated", "revoked", "expired"].includes(binding.lifecycleState)
      || !(
        binding.latestLifecycleEventHash === null
        || /^sha256:[a-f0-9]{64}$/.test(String(binding.latestLifecycleEventHash || ""))
      )
      || binding.claimToken !== input.claimToken
      || binding.authorityHash !== descriptor.authorityHash
      || binding.assignmentHash !== descriptor.assignmentHash
      || binding.descriptorHash !== descriptor.descriptorHash
      || binding.taskId !== input.taskId
      || binding.taskAttemptId !== input.taskAttemptId
      || !/^[A-Za-z0-9._:-]{1,200}$/.test(String(binding.modelCallId || ""))
      || binding.clientRequestId !== clientRequestId
      || !Number.isFinite(Date.parse(String(binding.providerDispatchedAt || "")))
      || Date.parse(binding.providerDispatchedAt) >= Date.parse(authority.expiresAt)
    ) {
      throw transportError(
        "preventure_transport_retention_binding_changed",
        "The provider response no longer matches one exact original pre-expiry dispatch.",
        { providerDispatchStarted: true },
      );
    }
    return binding;
  }

  async function dispatch(input = {}) {
    const descriptor = input.descriptor;
    const exact = exactRequest(descriptor, authority);
    const dispatchApiKey = apiKey();
    let retainedAt = null;
    const retentionTimestamp = (providerDispatchedAt) => {
      if (retainedAt === null) retainedAt = exactRetentionTimestamp(options.clock);
      if (
        !Number.isFinite(Date.parse(String(providerDispatchedAt || "")))
        || Date.parse(retainedAt) <= Date.parse(providerDispatchedAt)
      ) {
        throw transportError(
          "preventure_transport_clock_order_invalid",
          "The exact response-retention time did not follow its durable provider dispatch.",
          { providerDispatchStarted: true, providerOutcomeKnown: true },
        );
      }
      return retainedAt;
    };
    preflight({
      descriptor,
      request: input.request,
      expectedRequestBodyHash: descriptor.request.requestBodyHash,
    }, dispatchApiKey);
    const deadlineMs = Number(input.deadlineMs);
    if (
      !Number.isSafeInteger(deadlineMs)
      || deadlineMs < 1
      || deadlineMs !== descriptor.limits.deadlineMs
    ) {
      throw transportError(
        "preventure_transport_deadline_changed",
        "The exact provider deadline changed before dispatch.",
      );
    }
    const clientRequestId = typeof input.clientRequestId === "string"
      ? input.clientRequestId
      : "";
    if (
      !/^[A-Za-z0-9._:-]{1,200}$/.test(clientRequestId)
      || (dispatchApiKey && clientRequestId.includes(dispatchApiKey))
      || options.clientRequestIdForClaim(input.claimToken) !== clientRequestId
    ) {
      throw transportError(
        "preventure_transport_client_request_id_invalid",
        "The stable client request identity was absent or changed before dispatch.",
      );
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), deadlineMs);
    let response;
    try {
      response = await fetchImpl(OFFICIAL_OPENAI_RESPONSES_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${dispatchApiKey}`,
          "Content-Type": "application/json",
          "X-Client-Request-Id": clientRequestId,
        },
        body: exact.bytes,
        redirect: "manual",
        signal: controller.signal,
      });
    } catch (error) {
      clearTimeout(timer);
      throw transportError(
        "preventure_transport_network_outcome_unknown",
        error?.name === "AbortError"
          ? "The provider deadline passed after dispatch; outcome and cost are unknown."
          : "The provider connection failed after dispatch; outcome and cost are unknown.",
        {
          providerDispatchStarted: true,
          clientRequestId,
        },
      );
    }
    const providerRequestIdentity = exactProviderRequestIdFromResponse(response);
    const providerRequestId = providerRequestIdentity.providerRequestId;
    const safeFailureProviderRequestId = safeRetentionFailureDetail(
      providerRequestId,
      [dispatchApiKey],
    ) ? providerRequestId : null;
    let rawBytes;
    try {
      rawBytes = await boundedResponseBody(response, MAX_OPENAI_RESPONSE_BYTES);
    } catch (error) {
      error.providerRequestId = safeFailureProviderRequestId;
      error.clientRequestId = clientRequestId;
      throw error;
    } finally {
      clearTimeout(timer);
    }
    const rawProviderBody = rawBytes.toString("utf8");
    let payload = null;
    let payloadJsonParsed = false;
    try {
      payload = JSON.parse(rawProviderBody);
      payloadJsonParsed = true;
    } catch {
      payload = null;
    }
    const modelCallId = typeof options.modelCallIdForAssignment === "function"
      ? options.modelCallIdForAssignment(descriptor.assignmentHash)
      : null;
    if (!response?.ok) {
      const safeMessage = safeProviderErrorMessage(payload || { raw: rawProviderBody }, response?.status, {
        secrets: [dispatchApiKey],
      });
      const errorEnvelope = payloadJsonParsed && isObject(payload) && isObject(payload.error)
        ? payload.error
        : null;
      const providerErrorType = cleanProviderText(errorEnvelope?.type, 200);
      const providerErrorCode = cleanProviderText(errorEnvelope?.code, 200);
      if (
        isDefinitePreEffectHttpStatus(response?.status)
        && providerRequestIdentity.invalid !== true
        && providerErrorType
        && !Object.hasOwn(payload, "id")
        && !Object.hasOwn(payload, "usage")
        && !Object.hasOwn(payload, "output")
      ) {
        const billing = {
          currency: "AUD",
          costAudCents: 0,
          costStatus: "estimated",
          exactBillingPending: true,
          exposureAudCents: descriptor.limits.maxCostAudCents,
          providerZeroBillingGuarantee: false,
        };
        const responseMetadata = {
          httpStatus: Number(response.status),
          observedWebSearchCallCount: 0,
          providerErrorCode,
          providerErrorType,
          usage: null,
        };
        const retentionBinding = await assertRetentionBinding(
          input,
          descriptor,
          clientRequestId,
        );
        const retainedOutput = retainKnownArtifact(outputStore, {
          artifactKind: "known_pre_effect_rejection",
          assignmentMaxCostAudCents: descriptor.limits.maxCostAudCents,
          authorityHash: descriptor.authorityHash,
          assignmentHash: descriptor.assignmentHash,
          descriptorHash: descriptor.descriptorHash,
          requestBodyHash: descriptor.request.requestBodyHash,
          providerRequestId,
          providerResponseId: null,
          clientRequestId,
          providerResponse: payload,
          providerResponseHash: sha256(payload),
          rawProviderBody,
          rawProviderBodyBytes: rawBytes,
          rawProviderBodyHash: sha256(rawProviderBody),
          output: null,
          groundedSources: [],
          groundedSourceSetHash: sha256([]),
          billing,
          billingHash: sha256(billing),
          responseMetadata,
          retainedAt: retentionTimestamp(retentionBinding.providerDispatchedAt),
        }, 0, [dispatchApiKey], {
          costStatus: "estimated",
          exactBillingPending: true,
          exposureAudCents: descriptor.limits.maxCostAudCents,
          httpStatus: Number(response.status),
          providerErrorCode,
          providerErrorType,
          providerRequestId,
          providerResponseId: null,
          providerZeroBillingGuarantee: false,
        });
        throw transportError(
          "preventure_transport_definite_pre_effect_rejection",
          safeMessage,
          {
            kind: "definite_pre_effect_http_rejection",
            providerDispatchStarted: true,
            providerOutcomeKnown: true,
            definitePreEffect: true,
            costAudCents: 0,
            costStatus: "estimated",
            exactBillingPending: true,
            exposureAudCents: descriptor.limits.maxCostAudCents,
            httpStatus: Number(response.status),
            providerRequestId,
            providerResponseId: null,
            providerErrorCode,
            providerErrorType,
            providerZeroBillingGuarantee: false,
            rawProviderBody,
            rawProviderBodyHash: sha256(rawProviderBody),
            retainedOutput,
            clientRequestId,
          },
        );
      }
      if (Number(response?.status) >= 400 && Number(response?.status) <= 499) {
        const providerResponseId = isObject(payload)
          && /^[A-Za-z0-9._:-]{1,200}$/.test(String(payload.id || ""))
          ? String(payload.id)
          : null;
        const issues = deriveKnownEffectInvalidResponseIssues({
          rawProviderBody,
          httpStatus: Number(response.status),
          providerRequestId,
          providerRequestIdInvalid: providerRequestIdentity.invalid,
          descriptor,
        });
        const billing = {
          currency: "AUD",
          costAudCents: null,
          costStatus: "unknown",
          modelCallId,
        };
        const responseMetadata = {
          httpStatus: Number(response.status),
          canonicalResponseValid: false,
          providerResponseJsonParsed: payloadJsonParsed,
          responseIssues: issues,
        };
        const retentionBinding = await assertRetentionBinding(
          input,
          descriptor,
          clientRequestId,
        );
        const retainedOutput = retainKnownArtifact(outputStore, {
          artifactKind: "known_effect_invalid",
          assignmentMaxCostAudCents: descriptor.limits.maxCostAudCents,
          authorityHash: descriptor.authorityHash,
          assignmentHash: descriptor.assignmentHash,
          descriptorHash: descriptor.descriptorHash,
          requestBodyHash: descriptor.request.requestBodyHash,
          providerRequestId,
          providerResponseId,
          clientRequestId,
          providerResponse: payloadJsonParsed ? payload : null,
          providerResponseHash: payloadJsonParsed ? sha256(payload) : null,
          rawProviderBody,
          rawProviderBodyBytes: rawBytes,
          rawProviderBodyHash: sha256(rawProviderBody),
          output: null,
          groundedSources: [],
          groundedSourceSetHash: sha256([]),
          billing,
          billingHash: sha256(billing),
          responseMetadata,
          retainedAt: retentionTimestamp(retentionBinding.providerDispatchedAt),
        }, null, [dispatchApiKey], {
          costStatus: "unknown",
          exactBillingPending: true,
          exposureAudCents: descriptor.limits.maxCostAudCents,
          httpStatus: Number(response.status),
          providerErrorCode,
          providerErrorType,
          providerRequestId,
          providerResponseId,
        });
        return {
          outcomeStatus: "known_effect_invalid",
          provider: descriptor.provider,
          model: descriptor.model,
          endpoint: OFFICIAL_OPENAI_RESPONSES_URL,
          requestBodyHash: descriptor.request.requestBodyHash,
          httpStatus: Number(response.status),
          providerRequestId,
          providerResponseId,
          clientRequestId,
          providerResponse: payloadJsonParsed ? payload : null,
          providerResponseJsonParsed: payloadJsonParsed,
          providerResponseHash: payloadJsonParsed ? sha256(payload) : null,
          rawProviderBody,
          rawProviderBodyBytes: rawBytes,
          rawProviderBodyHash: sha256(rawProviderBody),
          costAudCents: null,
          costStatus: "unknown",
          modelCallId,
          issues,
          retainedOutput,
        };
      }
      throw transportError(
        "preventure_transport_http_outcome_unknown",
        safeMessage,
        {
          providerDispatchStarted: true,
          httpStatus: Number(response?.status || 0),
          providerRequestId: safeFailureProviderRequestId,
          clientRequestId,
        },
      );
    }
    if (Number(response.status) < 200 || Number(response.status) > 299) {
      throw transportError(
        "preventure_transport_redirect_outcome_unknown",
        "The provider returned a redirect after dispatch; Pantheon did not follow it and outcome is unknown.",
        {
          providerDispatchStarted: true,
          httpStatus: Number(response.status),
          providerRequestId: safeFailureProviderRequestId,
          clientRequestId,
        },
      );
    }
    const providerResponseId = isObject(payload) && /^[A-Za-z0-9._:-]{1,200}$/.test(payload.id)
      ? payload.id
      : null;
    const usage = integerUsage(payload, descriptor);
    const webSearchCalls = Array.isArray(payload?.output)
      ? payload.output.filter((item) => item?.type === "web_search_call").length
      : 0;
    let knownCost = null;
    try {
      if (usage && webSearchCalls <= descriptor.limits.maxToolCalls) {
        knownCost = exactCostAudCents(usage, webSearchCalls, authority, descriptor);
      }
    } catch (error) {
      if (error.providerOutcomeKnown) knownCost = null;
      else throw error;
    }
    const canonicalEnvelope = isObject(payload)
      && payload.object === "response"
      && providerResponseId !== null
      && payload.model === descriptor.model
      && Array.isArray(payload.output)
      && usage !== null
      && webSearchCalls <= descriptor.limits.maxToolCalls;
    if (!canonicalEnvelope) {
      const issues = deriveKnownEffectInvalidResponseIssues({
        rawProviderBody,
        httpStatus: Number(response.status),
        providerRequestId,
        providerRequestIdInvalid: providerRequestIdentity.invalid,
        descriptor,
      });
      const invalidResult = {
        outcomeStatus: "known_effect_invalid",
        provider: descriptor.provider,
        model: descriptor.model,
        endpoint: OFFICIAL_OPENAI_RESPONSES_URL,
        requestBodyHash: descriptor.request.requestBodyHash,
        httpStatus: Number(response.status),
        providerRequestId,
        providerResponseId,
        clientRequestId,
        providerResponse: payloadJsonParsed ? payload : null,
        providerResponseJsonParsed: payloadJsonParsed,
        providerResponseHash: payloadJsonParsed ? sha256(payload) : null,
        rawProviderBody,
        rawProviderBodyBytes: rawBytes,
        rawProviderBodyHash: sha256(rawProviderBody),
        costAudCents: knownCost,
        costStatus: knownCost === null ? "unknown" : "estimated",
        modelCallId,
        issues,
      };
      const billing = {
        currency: "AUD",
        costAudCents: knownCost,
        costStatus: knownCost === null ? "unknown" : "estimated",
        modelCallId,
      };
      const retentionBinding = await assertRetentionBinding(
        input,
        descriptor,
        clientRequestId,
      );
      const retainedOutput = retainKnownArtifact(outputStore, {
        artifactKind: "known_effect_invalid",
        assignmentMaxCostAudCents: descriptor.limits.maxCostAudCents,
        authorityHash: descriptor.authorityHash,
        assignmentHash: descriptor.assignmentHash,
        descriptorHash: descriptor.descriptorHash,
        requestBodyHash: descriptor.request.requestBodyHash,
        providerRequestId,
        providerResponseId,
        clientRequestId,
        providerResponse: invalidResult.providerResponse,
        providerResponseHash: invalidResult.providerResponseHash,
        rawProviderBody,
        rawProviderBodyBytes: rawBytes,
        rawProviderBodyHash: invalidResult.rawProviderBodyHash,
        output: null,
        groundedSources: [],
        groundedSourceSetHash: sha256([]),
        billing,
        billingHash: sha256(billing),
        responseMetadata: {
          httpStatus: Number(response.status),
          canonicalResponseValid: false,
          providerResponseJsonParsed: payloadJsonParsed,
          responseIssues: invalidResult.issues,
        },
        retainedAt: retentionTimestamp(retentionBinding.providerDispatchedAt),
      }, knownCost, [dispatchApiKey], {
        costStatus: knownCost === null ? "unknown" : "estimated",
        exactBillingPending: true,
        exposureAudCents: knownCost === null ? descriptor.limits.maxCostAudCents : knownCost,
        httpStatus: Number(response.status),
        providerRequestId,
        providerResponseId,
      });
      return { ...invalidResult, retainedOutput };
    }
    const normalized = normalizePreventureProviderResponse(payload);
    const grounding = normalized.grounding;
    const output = normalized.output;
    const issues = [...new Set([
      ...normalized.issues,
      ...(providerRequestIdentity.invalid ? ["provider_request_id_invalid"] : []),
    ])].sort();
    const result = {
      outcomeStatus: "known",
      provider: descriptor.provider,
      model: descriptor.model,
      endpoint: OFFICIAL_OPENAI_RESPONSES_URL,
      requestBodyHash: descriptor.request.requestBodyHash,
      providerRequestId,
      providerResponseId,
      clientRequestId,
      providerResponse: payload,
      rawProviderBody,
      rawProviderBodyBytes: rawBytes,
      rawProviderBodyHash: sha256(rawProviderBody),
      toolCallCount: webSearchCalls,
      usage,
      costAudCents: knownCost,
      costStatus: knownCost === null ? "unknown" : "estimated",
      modelCallId,
      responseMetadata: {
        httpStatus: Number(response.status),
        clientRequestId,
        usage,
        pricingPolicyHash: authority.provider.pricingPolicyHash,
      },
    };
    const billing = {
      currency: "AUD",
      costAudCents: knownCost,
      costStatus: knownCost === null ? "unknown" : "estimated",
      modelCallId,
    };
    const retentionBinding = await assertRetentionBinding(
      input,
      descriptor,
      clientRequestId,
    );
    const retainedOutput = retainKnownArtifact(outputStore, {
      artifactKind: "canonical_known_response",
      assignmentMaxCostAudCents: descriptor.limits.maxCostAudCents,
      authorityHash: descriptor.authorityHash,
      assignmentHash: descriptor.assignmentHash,
      descriptorHash: descriptor.descriptorHash,
      requestBodyHash: descriptor.request.requestBodyHash,
      providerRequestId,
      providerResponseId,
      clientRequestId,
      providerResponse: payload,
      providerResponseHash: sha256(payload),
      rawProviderBody,
      rawProviderBodyBytes: rawBytes,
      rawProviderBodyHash: result.rawProviderBodyHash,
      output: output.texts.length === 1 ? output.texts[0] : null,
      groundedSources: grounding.sources,
      groundedSourceSetHash: sha256(grounding.sources),
      billing,
      billingHash: sha256(billing),
      responseMetadata: {
        ...result.responseMetadata,
        responseStatus: payload.status,
        responseIssues: issues,
      },
      retainedAt: retentionTimestamp(retentionBinding.providerDispatchedAt),
    }, knownCost, [dispatchApiKey], {
      costStatus: knownCost === null ? "unknown" : "estimated",
      exactBillingPending: true,
      exposureAudCents: knownCost === null ? descriptor.limits.maxCostAudCents : knownCost,
      httpStatus: Number(response.status),
      providerRequestId,
      providerResponseId,
    });
    if (knownCost === null) {
      throw transportError(
        "preventure_transport_cost_unknown",
        "Provider usage could not be priced after a safely retained known response; outcome is frozen for reconciliation.",
        {
          providerDispatchStarted: true,
          providerOutcomeKnown: true,
          costAudCents: null,
          costStatus: "unknown",
          exactBillingPending: true,
          exposureAudCents: descriptor.limits.maxCostAudCents,
          providerRequestId,
          providerResponseId,
          clientRequestId,
          retainedOutput,
        },
      );
    }
    return { ...result, retainedOutput };
  }

  return Object.freeze({
    kind: EXACT_TRANSPORT_KIND,
    dispatch,
    inspect,
    preflight,
    status,
  });
}

function createDeterministicPreventureResearchParser() {
  return Object.freeze({
    kind: EXACT_LOCAL_PARSER_KIND,
    parse(value) {
      if (typeof value !== "string" || !value.trim()) {
        throw transportError(
          "preventure_parser_output_missing",
          "The retained structured provider output is empty.",
        );
      }
      let parsed;
      try {
        parsed = JSON.parse(value);
      } catch {
        throw transportError(
          "preventure_parser_json_invalid",
          "The retained structured provider output is not exact JSON.",
        );
      }
      if (!isObject(parsed)) {
        throw transportError(
          "preventure_parser_shape_invalid",
          "The retained structured provider output must be one JSON object.",
        );
      }
      return parsed;
    },
  });
}

module.exports = {
  GROUNDING_SOURCES,
  PREVENTURE_TRANSPORT_SCHEMA,
  createDeterministicPreventureResearchParser,
  createPreventureResearchOpenAiTransport,
  exactCostAudCents,
  safePublicUrl,
};
