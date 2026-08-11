const OFFICIAL_OPENAI_API_BASE_URL = "https://api.openai.com/v1";
const OFFICIAL_OPENAI_RESPONSES_URL = `${OFFICIAL_OPENAI_API_BASE_URL}/responses`;
const MAX_OPENAI_RESPONSE_BYTES = 5 * 1024 * 1024;
const MAX_OPENAI_ERROR_CHARACTERS = 1200;
const DEFINITE_PRE_EFFECT_HTTP_STATUSES = new Set([400, 401, 403, 404, 405, 413, 415, 422]);

function normalizedExactUrl(value) {
  try {
    return new URL(String(value || "")).href;
  } catch {
    return null;
  }
}

function matchesOfficialUrl(value, expected) {
  const normalized = normalizedExactUrl(value);
  if (!normalized) return false;
  const parsed = new URL(normalized);
  return normalized === expected
    && parsed.protocol === "https:"
    && parsed.hostname === "api.openai.com"
    && parsed.port === ""
    && parsed.username === ""
    && parsed.password === ""
    && parsed.search === ""
    && parsed.hash === "";
}

function inspectOpenAiEgressPolicy(options = {}) {
  const configuredResponsesUrl = options.responsesUrl
    ?? process.env.OPENAI_RESPONSES_URL
    ?? OFFICIAL_OPENAI_RESPONSES_URL;
  const configuredBaseUrl = options.baseUrl
    ?? process.env.OPENAI_BASE_URL
    ?? OFFICIAL_OPENAI_API_BASE_URL;
  const blockers = [];

  if (!matchesOfficialUrl(configuredResponsesUrl, OFFICIAL_OPENAI_RESPONSES_URL)) {
    blockers.push({
      code: "responses_endpoint_not_official",
      message: "The OpenAI Responses destination is not the exact approved official endpoint.",
    });
  }
  if (!matchesOfficialUrl(configuredBaseUrl, OFFICIAL_OPENAI_API_BASE_URL)) {
    blockers.push({
      code: "api_base_endpoint_not_official",
      message: "The OpenAI API base destination is not the exact approved official endpoint.",
    });
  }
  if (String(process.env.NODE_TLS_REJECT_UNAUTHORIZED || "").trim() === "0") {
    blockers.push({
      code: "tls_verification_disabled",
      message: "TLS certificate verification is disabled for this process.",
    });
  }

  return {
    ready: blockers.length === 0,
    status: blockers.length === 0 ? "ready" : "blocked",
    endpoint: OFFICIAL_OPENAI_RESPONSES_URL,
    apiBaseUrl: OFFICIAL_OPENAI_API_BASE_URL,
    redirectsAllowed: false,
    blockers,
  };
}

function assertOpenAiResponsesEgress(options = {}) {
  const policy = inspectOpenAiEgressPolicy(options);
  if (!policy.ready) {
    const error = new Error(
      "OpenAI work is blocked because its network destination or TLS policy is not the exact approved secure configuration.",
    );
    error.code = "OPENAI_EGRESS_POLICY_BLOCKED";
    error.errorKind = "openai_egress_policy_blocked";
    error.providerDispatchStatus = "not_dispatched";
    error.providerCallOccurred = false;
    error.outcomeUnknown = false;
    error.egressPolicy = policy;
    throw error;
  }
  return OFFICIAL_OPENAI_RESPONSES_URL;
}

function responseHeader(response, name) {
  if (!response?.headers || typeof response.headers.get !== "function") return null;
  const value = response.headers.get(name);
  return value === null || value === undefined ? null : String(value).trim() || null;
}

function providerRequestIdFromResponse(response, payload = {}) {
  const candidate = responseHeader(response, "x-request-id")
    || responseHeader(response, "request-id")
    || String(payload?.request_id || payload?.error?.request_id || "").trim()
    || null;
  return safeProviderRequestId(candidate);
}

function safeProviderRequestId(candidate) {
  if (!candidate) return null;
  const bounded = compactProviderText(candidate, 200);
  if (/^sk-/i.test(bounded)) return null;
  return bounded.replace(/[^A-Za-z0-9_.:-]/g, "_") || null;
}

function providerResponseTooLargeError(limitBytes) {
  const error = new Error(`OpenAI returned more than Pantheon's ${limitBytes}-byte response safety limit.`);
  error.code = "OPENAI_PROVIDER_RESPONSE_TOO_LARGE";
  error.errorKind = "provider_response_too_large";
  return error;
}

function assertResponseSize(size, limitBytes) {
  if (Number(size) > limitBytes) throw providerResponseTooLargeError(limitBytes);
}

async function boundedResponseBytes(response, limitBytes) {
  const contentLength = Number(responseHeader(response, "content-length"));
  if (Number.isFinite(contentLength) && contentLength >= 0) {
    assertResponseSize(contentLength, limitBytes);
  }

  if (response?.body && typeof response.body.getReader === "function") {
    const reader = response.body.getReader();
    const chunks = [];
    let total = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const bytes = Buffer.from(value || []);
        total += bytes.length;
        if (total > limitBytes) {
          await reader.cancel().catch(() => {});
          throw providerResponseTooLargeError(limitBytes);
        }
        chunks.push(bytes);
      }
    } finally {
      reader.releaseLock();
    }
    return Buffer.concat(chunks, total);
  }

  if (typeof response?.text === "function") {
    const text = await response.text();
    const bytes = Buffer.from(String(text || ""), "utf8");
    assertResponseSize(bytes.length, limitBytes);
    return bytes;
  }
  return null;
}

async function readBoundedJsonResponse(response, limitBytes = MAX_OPENAI_RESPONSE_BYTES) {
  const bytes = await boundedResponseBytes(response, limitBytes);
  if (bytes) {
    if (!bytes.length) return {};
    const text = bytes.toString("utf8");
    try {
      return JSON.parse(text);
    } catch {
      return { raw: text };
    }
  }

  if (typeof response?.json === "function") {
    const payload = await response.json();
    const serialized = JSON.stringify(payload ?? {});
    assertResponseSize(Buffer.byteLength(serialized, "utf8"), limitBytes);
    return payload ?? {};
  }
  return {};
}

function compactProviderText(value, maxCharacters = MAX_OPENAI_ERROR_CHARACTERS) {
  const printable = [...String(value || "")]
    .map((character) => {
      const codePoint = character.codePointAt(0);
      return codePoint < 32 || codePoint === 127 ? " " : character;
    })
    .join("");
  const compact = printable.replace(/\s+/g, " ").trim();
  if (compact.length <= maxCharacters) return compact;
  return `${compact.slice(0, Math.max(0, maxCharacters - 3))}...`;
}

function redactProviderText(value, secrets = []) {
  let redacted = String(value || "");
  for (const secret of secrets) {
    const exact = String(secret || "");
    if (exact) redacted = redacted.split(exact).join("[REDACTED]");
  }
  return redacted
    .replace(/\bBearer\s+[^\s,;]+/gi, "Bearer [REDACTED]")
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, "[REDACTED]");
}

function safeProviderErrorMessage(payload, status, options = {}) {
  const candidate = payload?.error?.message
    || payload?.message
    || payload?.raw
    || options.fallback
    || (status ? `HTTP ${status}` : "Provider request failed.");
  const redacted = redactProviderText(candidate, options.secrets);
  return compactProviderText(redacted) || (status ? `HTTP ${status}` : "Provider request failed.");
}

function isDefinitePreEffectHttpStatus(status) {
  return DEFINITE_PRE_EFFECT_HTTP_STATUSES.has(Number(status));
}

module.exports = {
  DEFINITE_PRE_EFFECT_HTTP_STATUSES,
  MAX_OPENAI_ERROR_CHARACTERS,
  MAX_OPENAI_RESPONSE_BYTES,
  OFFICIAL_OPENAI_API_BASE_URL,
  OFFICIAL_OPENAI_RESPONSES_URL,
  assertOpenAiResponsesEgress,
  inspectOpenAiEgressPolicy,
  isDefinitePreEffectHttpStatus,
  matchesOfficialUrl,
  providerRequestIdFromResponse,
  readBoundedJsonResponse,
  safeProviderErrorMessage,
  safeProviderRequestId,
};
