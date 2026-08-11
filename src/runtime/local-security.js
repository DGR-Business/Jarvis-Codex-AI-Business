const crypto = require("node:crypto");

const COOKIE_NAME = "pantheon_session";
const LEGACY_COOKIE_NAME = "jarvis_session";
const DEFAULT_SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const OWNER_SESSION_ATTESTATION_SCHEMA = "pantheon.authenticated-owner-session-attestation.v1";
const OWNER_BILLING_OBSERVATION_ACTION_KIND = "owner_attested_provider_billing_observation";
const OWNER_BILLING_OBSERVATION_ATTESTATION_SCHEMA =
  "pantheon.authenticated-owner-billing-observation-attestation.v1";

// Attestations deliberately have no serializable token. Their authority is
// the opaque object identity held in this process, and each object can be
// consumed only once by the protected pre-venture lifecycle path.
const ownerSessionAttestations = new WeakMap();
const ownerSessionAttestationIssuers = new WeakMap();
const boundOwnerSessionAttestationIssuers = new WeakMap();
const ownerBillingObservationAttestations = new WeakMap();
const ownerBillingObservationAttestationIssuers = new WeakMap();
const boundOwnerBillingObservationAttestationIssuers = new WeakMap();
const boundLocalSecurityInstances = new WeakMap();

function parseCookies(header = "") {
  return Object.fromEntries(
    String(header)
      .split(";")
      .map((part) => part.trim())
      .filter((part) => part.includes("="))
      .map((part) => {
        const index = part.indexOf("=");
        return [part.slice(0, index), decodeURIComponent(part.slice(index + 1))];
      }),
  );
}

function sameText(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function exactOwnerAttestationBinding(binding) {
  if (!binding || typeof binding !== "object" || Array.isArray(binding)) {
    throw new Error("An exact owner-session attestation binding is required.");
  }
  const exactKeys = [
    "approvalId",
    "decidedAt",
    "decision",
    "decisionNoteHash",
    "expectedScopeHash",
  ];
  const keys = Object.keys(binding).sort();
  if (
    keys.length !== exactKeys.length
    || keys.some((key, index) => key !== exactKeys[index])
  ) {
    throw new Error("The owner-session attestation binding is incomplete or widened.");
  }
  if (
    typeof binding.approvalId !== "string"
    || binding.approvalId.length < 1
    || binding.approvalId.length > 200
    || !["approve", "changes", "reject"].includes(binding.decision)
    || !/^sha256:[a-f0-9]{64}$/.test(binding.expectedScopeHash)
    || !/^sha256:[a-f0-9]{64}$/.test(binding.decisionNoteHash)
    || !Number.isFinite(Date.parse(binding.decidedAt))
  ) {
    throw new Error("The owner-session attestation binding is invalid.");
  }
  return Object.freeze(Object.fromEntries(exactKeys.map((key) => [key, binding[key]])));
}

function exactOwnerBillingObservationAttestationBinding(binding) {
  if (!binding || typeof binding !== "object" || Array.isArray(binding)) {
    throw new Error("An exact owner-billing observation attestation binding is required.");
  }
  const exactKeys = [
    "actionKind",
    "assignmentHash",
    "authorityHash",
    "expectedPreviousReceiptHash",
    "observationIntentHash",
    "observedAt",
    "predecessorHash",
    "predecessorKind",
  ];
  const keys = Object.keys(binding).sort();
  if (
    keys.length !== exactKeys.length
    || keys.some((key, index) => key !== exactKeys[index])
  ) {
    throw new Error("The owner-billing observation attestation binding is incomplete or widened.");
  }
  const hashFields = [
    "assignmentHash",
    "authorityHash",
    "expectedPreviousReceiptHash",
    "observationIntentHash",
    "predecessorHash",
  ];
  if (
    binding.actionKind !== OWNER_BILLING_OBSERVATION_ACTION_KIND
    || !["sealed_decision", "terminal_recovery"].includes(binding.predecessorKind)
    || hashFields.some((field) => !/^sha256:[a-f0-9]{64}$/.test(binding[field]))
    || !Number.isFinite(Date.parse(binding.observedAt))
    || new Date(Date.parse(binding.observedAt)).toISOString() !== binding.observedAt
  ) {
    throw new Error("The owner-billing observation attestation binding is invalid.");
  }
  return Object.freeze(Object.fromEntries(exactKeys.map((key) => [key, binding[key]])));
}

function bindLocalSecurityInstance(db, security) {
  const current = boundLocalSecurityInstances.get(db);
  if (current && current !== security) {
    throw new Error("This database connection is already bound to another Pantheon local-security instance.");
  }
  if (!current) boundLocalSecurityInstances.set(db, security);
}

function bindAuthenticatedOwnerSessionAttestationIssuer(db, security) {
  if (!db || typeof db !== "object") {
    throw new Error("A live Pantheon database connection is required for owner-session binding.");
  }
  const issuer = ownerSessionAttestationIssuers.get(security);
  if (!issuer) {
    throw new Error("Only a Pantheon local-security instance can own this approval boundary.");
  }
  bindLocalSecurityInstance(db, security);
  const current = boundOwnerSessionAttestationIssuers.get(db);
  if (current && current !== issuer) {
    throw new Error("This database connection is already bound to another Pantheon owner-session issuer.");
  }
  if (!current) boundOwnerSessionAttestationIssuers.set(db, issuer);
  return true;
}

function bindAuthenticatedOwnerBillingObservationIssuer(db, security) {
  if (!db || typeof db !== "object") {
    throw new Error("A live Pantheon database connection is required for owner-billing binding.");
  }
  const issuer = ownerBillingObservationAttestationIssuers.get(security);
  if (!issuer) {
    throw new Error("Only a Pantheon local-security instance can own this billing boundary.");
  }
  bindLocalSecurityInstance(db, security);
  const current = boundOwnerBillingObservationAttestationIssuers.get(db);
  if (current && current !== issuer) {
    throw new Error("This database connection is already bound to another Pantheon owner-billing issuer.");
  }
  if (!current) boundOwnerBillingObservationAttestationIssuers.set(db, issuer);
  return true;
}

function consumeAuthenticatedOwnerSessionAttestation(attestation, expectedBinding, db) {
  if (!attestation || typeof attestation !== "object") {
    throw new Error("This protected decision requires an authenticated owner-session attestation.");
  }
  const record = ownerSessionAttestations.get(attestation);
  // Consume before comparing so a failed or stale attempt cannot reuse it.
  ownerSessionAttestations.delete(attestation);
  ownerBillingObservationAttestations.delete(attestation);
  const expected = exactOwnerAttestationBinding(expectedBinding);
  const expectedIssuer = db && typeof db === "object"
    ? boundOwnerSessionAttestationIssuers.get(db)
    : null;
  if (
    !record
    || !expectedIssuer
    || record.issuer !== expectedIssuer
    || record.schema !== OWNER_SESSION_ATTESTATION_SCHEMA
    || record.expiresAt <= Date.now()
    || JSON.stringify(record.binding) !== JSON.stringify(expected)
  ) {
    throw new Error("This owner-session attestation is missing, stale, reused, or bound to another decision.");
  }
  return true;
}

function consumeAuthenticatedOwnerBillingObservationAttestation(
  attestation,
  expectedBinding,
  db,
) {
  if (!attestation || typeof attestation !== "object") {
    throw new Error("This protected action requires an authenticated owner-billing attestation.");
  }
  const record = ownerBillingObservationAttestations.get(attestation);
  // Consume every opaque attestation kind before comparing. A failed,
  // cross-action, or stale attempt must never leave a retryable capability.
  ownerBillingObservationAttestations.delete(attestation);
  ownerSessionAttestations.delete(attestation);
  const expected = exactOwnerBillingObservationAttestationBinding(expectedBinding);
  const expectedIssuer = db && typeof db === "object"
    ? boundOwnerBillingObservationAttestationIssuers.get(db)
    : null;
  if (
    !record
    || !expectedIssuer
    || record.issuer !== expectedIssuer
    || record.schema !== OWNER_BILLING_OBSERVATION_ATTESTATION_SCHEMA
    || record.expiresAt <= Date.now()
    || JSON.stringify(record.binding) !== JSON.stringify(expected)
  ) {
    throw new Error(
      "This owner-billing attestation is missing, stale, reused, or bound to another observation.",
    );
  }
  return true;
}

function createLocalSecurity(options = {}) {
  const enabled = options.enabled !== false;
  const secret = options.secret || crypto.randomBytes(32);
  const bootstrapSecret = String(
    options.bootstrapSecret
      || process.env.PANTHEON_OPERATOR_BOOTSTRAP
      || process.env.JARVIS_OPERATOR_BOOTSTRAP
      || crypto.randomBytes(32).toString("base64url"),
  );
  const sessionTtlMs = Math.max(60_000, Number(options.sessionTtlMs || DEFAULT_SESSION_TTL_MS));
  const sessions = new Map();
  const ownerSessionAttestationIssuer = Object.freeze(Object.create(null));
  const ownerBillingObservationAttestationIssuer = Object.freeze(Object.create(null));

  function signature(sessionId) {
    return crypto.createHmac("sha256", secret).update(`session:${sessionId}`).digest("base64url");
  }

  function csrfToken(sessionId) {
    return crypto.createHmac("sha256", secret).update(`csrf:${sessionId}`).digest("base64url");
  }

  function encodeSession(sessionId) {
    return `${sessionId}.${signature(sessionId)}`;
  }

  function decodeSession(value) {
    const [sessionId, provided] = String(value || "").split(".");
    if (!sessionId || !provided || !sameText(provided, signature(sessionId))) return null;
    return sessionId;
  }

  function requestOrigin(req) {
    if (!enabled) return "http://127.0.0.1";
    const host = String(req.headers.host || "").toLowerCase();
    if (!host) throw new Error("Missing Host header.");
    let parsed;
    try {
      parsed = new URL(`http://${host}`);
    } catch {
      throw new Error("Invalid Host header.");
    }
    if (!["127.0.0.1", "localhost", "::1", "[::1]"].includes(parsed.hostname.toLowerCase())) {
      throw new Error("Pantheon only accepts loopback requests.");
    }
    return `http://${host}`;
  }

  function assertRequestHost(req) {
    requestOrigin(req);
    return true;
  }

  function sessionForRequest(req) {
    if (!enabled) return { id: "security-disabled", csrfToken: "security-disabled", expiresAt: null };
    const cookies = parseCookies(req.headers.cookie);
    const sessionId = decodeSession(cookies[COOKIE_NAME] || cookies[LEGACY_COOKIE_NAME]);
    if (!sessionId) return null;
    const record = sessions.get(sessionId);
    if (!record || record.expiresAt <= Date.now()) {
      sessions.delete(sessionId);
      return null;
    }
    record.lastSeenAt = Date.now();
    return { id: sessionId, csrfToken: csrfToken(sessionId), expiresAt: new Date(record.expiresAt).toISOString() };
  }

  function assertOrigin(req) {
    if (!enabled) return true;
    const expected = requestOrigin(req);
    const origin = String(req.headers.origin || "").toLowerCase();
    if (!origin || origin !== expected) throw new Error("Request origin does not match this Pantheon session.");
    return expected;
  }

  function createSession(req, res) {
    if (!enabled) return sessionForRequest(req);
    assertOrigin(req);
    const providedBootstrap = req.headers["x-pantheon-bootstrap"] || req.headers["x-jarvis-bootstrap"];
    if (!sameText(providedBootstrap, bootstrapSecret)) {
      throw new Error("Start Pantheon with the local launcher to authorise this browser.");
    }
    const sessionId = crypto.randomBytes(24).toString("base64url");
    const expiresAt = Date.now() + sessionTtlMs;
    sessions.set(sessionId, { createdAt: Date.now(), lastSeenAt: Date.now(), expiresAt });
    res.setHeader(
      "set-cookie",
      `${COOKIE_NAME}=${encodeURIComponent(encodeSession(sessionId))}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${Math.floor(sessionTtlMs / 1000)}`,
    );
    return { id: sessionId, csrfToken: csrfToken(sessionId), expiresAt: new Date(expiresAt).toISOString() };
  }

  function requireSession(req) {
    const session = sessionForRequest(req);
    if (!session) throw new Error("A valid Pantheon operator session is required.");
    return session;
  }

  function assertMutation(req, session) {
    if (!enabled || ["GET", "HEAD"].includes(req.method)) return;
    assertOrigin(req);
    if (!String(req.headers["content-type"] || "").toLowerCase().startsWith("application/json")) {
      throw new Error("State-changing requests must use JSON.");
    }
    const providedCsrf = req.headers["x-pantheon-csrf"] || req.headers["x-jarvis-csrf"];
    if (!session?.id || !sameText(providedCsrf, csrfToken(session.id))) {
      throw new Error("This action needs a fresh Pantheon session token.");
    }
  }

  function issueAuthenticatedOwnerSessionAttestation(req, session, binding) {
    if (!enabled) {
      throw new Error("Protected owner decisions require Pantheon local security.");
    }
    const current = requireSession(req);
    assertMutation(req, current);
    if (!session?.id || session.id !== current.id) {
      throw new Error("The owner-session attestation request does not match this session.");
    }
    const exactBinding = exactOwnerAttestationBinding(binding);
    const expectedPath = `/api/preventure-research/lifecycle-decisions/${encodeURIComponent(exactBinding.approvalId)}/${exactBinding.decision}`;
    const requestPath = new URL(String(req.url || ""), requestOrigin(req)).pathname;
    if (req.method !== "POST" || requestPath !== expectedPath) {
      throw new Error("The owner-session attestation is not bound to the exact protected route.");
    }
    const attestation = Object.freeze(Object.create(null));
    ownerSessionAttestations.set(attestation, Object.freeze({
      issuer: ownerSessionAttestationIssuer,
      schema: OWNER_SESSION_ATTESTATION_SCHEMA,
      binding: exactBinding,
      expiresAt: Math.min(Date.parse(current.expiresAt), Date.now() + 60_000),
    }));
    return attestation;
  }

  function issueAuthenticatedOwnerBillingObservationAttestation(req, session, binding) {
    if (!enabled) {
      throw new Error("Protected owner-billing observations require Pantheon local security.");
    }
    const current = requireSession(req);
    assertMutation(req, current);
    if (!session?.id || session.id !== current.id) {
      throw new Error("The owner-billing attestation request does not match this session.");
    }
    const exactBinding = exactOwnerBillingObservationAttestationBinding(binding);
    const expectedPath = "/api/preventure-research/provider-billing-observations";
    const requestPath = new URL(String(req.url || ""), requestOrigin(req)).pathname;
    if (req.method !== "POST" || requestPath !== expectedPath) {
      throw new Error("The owner-billing attestation is not bound to the exact protected route.");
    }
    const attestation = Object.freeze(Object.create(null));
    ownerBillingObservationAttestations.set(attestation, Object.freeze({
      issuer: ownerBillingObservationAttestationIssuer,
      schema: OWNER_BILLING_OBSERVATION_ATTESTATION_SCHEMA,
      binding: exactBinding,
      expiresAt: Math.min(Date.parse(current.expiresAt), Date.now() + 60_000),
    }));
    return attestation;
  }

  function assertWebSocket(req) {
    if (!enabled) return true;
    assertRequestHost(req);
    assertOrigin(req);
    requireSession(req);
    return true;
  }

  function revokeSession(req) {
    const cookies = parseCookies(req.headers.cookie);
    const sessionId = decodeSession(cookies[COOKIE_NAME] || cookies[LEGACY_COOKIE_NAME]);
    if (sessionId) sessions.delete(sessionId);
  }

  const security = Object.freeze({
    enabled,
    assertMutation,
    assertOrigin,
    assertRequestHost,
    assertWebSocket,
    createSession,
    csrfToken,
    issueAuthenticatedOwnerBillingObservationAttestation,
    issueAuthenticatedOwnerSessionAttestation,
    requireSession,
    revokeSession,
    sessionForRequest,
  });
  ownerSessionAttestationIssuers.set(security, ownerSessionAttestationIssuer);
  ownerBillingObservationAttestationIssuers.set(
    security,
    ownerBillingObservationAttestationIssuer,
  );
  return security;
}

module.exports = {
  COOKIE_NAME,
  OWNER_BILLING_OBSERVATION_ACTION_KIND,
  OWNER_BILLING_OBSERVATION_ATTESTATION_SCHEMA,
  OWNER_SESSION_ATTESTATION_SCHEMA,
  bindAuthenticatedOwnerBillingObservationIssuer,
  bindAuthenticatedOwnerSessionAttestationIssuer,
  consumeAuthenticatedOwnerBillingObservationAttestation,
  consumeAuthenticatedOwnerSessionAttestation,
  createLocalSecurity,
};
