const crypto = require("node:crypto");

const COOKIE_NAME = "pantheon_session";
const LEGACY_COOKIE_NAME = "jarvis_session";
const DEFAULT_SESSION_TTL_MS = 12 * 60 * 60 * 1000;

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

  return {
    enabled,
    bootstrapSecret,
    assertMutation,
    assertOrigin,
    assertRequestHost,
    assertWebSocket,
    createSession,
    csrfToken,
    requireSession,
    revokeSession,
    sessionForRequest,
  };
}

module.exports = {
  COOKIE_NAME,
  createLocalSecurity,
};
