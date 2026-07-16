const crypto = require("node:crypto");

const COOKIE_NAME = "jarvis_session";

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

  function sessionForRequest(req) {
    return decodeSession(parseCookies(req.headers.cookie)[COOKIE_NAME]);
  }

  function attachSession(req, res) {
    if (!enabled) return { id: "security-disabled", csrfToken: "security-disabled" };
    let sessionId = sessionForRequest(req);
    if (!sessionId) {
      sessionId = crypto.randomBytes(24).toString("base64url");
      res.setHeader(
        "set-cookie",
        `${COOKIE_NAME}=${encodeURIComponent(encodeSession(sessionId))}; Path=/; HttpOnly; SameSite=Strict`,
      );
    }
    return { id: sessionId, csrfToken: csrfToken(sessionId) };
  }

  function requestOrigin(req) {
    const host = String(req.headers.host || "").toLowerCase();
    if (!host) throw new Error("Missing Host header.");
    let parsed;
    try {
      parsed = new URL(`http://${host}`);
    } catch {
      throw new Error("Invalid Host header.");
    }
    if (!["127.0.0.1", "localhost", "::1", "[::1]"].includes(parsed.hostname.toLowerCase())) {
      throw new Error("Jarvis only accepts loopback requests.");
    }
    return `http://${host}`;
  }

  function assertOrigin(req) {
    const expected = requestOrigin(req);
    const origin = String(req.headers.origin || "").toLowerCase();
    if (!origin || origin !== expected) throw new Error("Request origin does not match this Jarvis session.");
    return expected;
  }

  function assertMutation(req, session) {
    if (!enabled || ["GET", "HEAD"].includes(req.method)) return;
    assertOrigin(req);
    if (!String(req.headers["content-type"] || "").toLowerCase().startsWith("application/json")) {
      throw new Error("State-changing requests must use JSON.");
    }
    if (!session?.id || !sameText(req.headers["x-jarvis-csrf"], csrfToken(session.id))) {
      throw new Error("This action needs a fresh Jarvis session token.");
    }
  }

  function assertWebSocket(req) {
    if (!enabled) return true;
    assertOrigin(req);
    if (!sessionForRequest(req)) throw new Error("A valid Jarvis session is required for live updates.");
    return true;
  }

  return {
    enabled,
    attachSession,
    assertMutation,
    assertWebSocket,
    csrfToken,
    sessionForRequest,
  };
}

module.exports = {
  COOKIE_NAME,
  createLocalSecurity,
};
