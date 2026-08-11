"use strict";

const {
  bindAuthenticatedOwnerSessionAttestationIssuer,
  createLocalSecurity,
} = require("../../src/runtime/local-security");
const { sha256 } = require("../../src/runtime/commercial-test-contract");

const securityByDatabase = new WeakMap();
const bootstrapSecret = "pantheon-owner-attestation-test-bootstrap";

function authenticatedOwnerSecurityForTest(db) {
  const security = securityByDatabase.get(db);
  if (!security) {
    throw new Error("This test database has not established its owner-security boundary.");
  }
  return Object.freeze({ security, bootstrapSecret });
}

function issueAuthenticatedOwnerSessionAttestationForTest(input) {
  const db = input?.db;
  if (!db || typeof db !== "object") {
    throw new Error("The owner-session test attestation requires its exact database connection.");
  }
  const origin = "http://127.0.0.1:5051";
  let security = securityByDatabase.get(db);
  if (!security) {
    security = createLocalSecurity({
      enabled: true,
      secret: Buffer.alloc(32, 73),
      bootstrapSecret,
    });
    bindAuthenticatedOwnerSessionAttestationIssuer(db, security);
    securityByDatabase.set(db, security);
  }
  let cookie = "";
  const request = {
    method: "POST",
    url: "/api/session",
    headers: {
      host: "127.0.0.1:5051",
      origin,
      "content-type": "application/json",
      "x-pantheon-bootstrap": bootstrapSecret,
    },
  };
  const response = {
    setHeader(name, value) {
      if (String(name).toLowerCase() === "set-cookie") cookie = String(value).split(";", 1)[0];
    },
  };
  const session = security.createSession(request, response);
  request.url = `/api/preventure-research/lifecycle-decisions/${encodeURIComponent(input.approvalId)}/${input.decision}`;
  request.headers.cookie = cookie;
  request.headers["x-pantheon-csrf"] = session.csrfToken;
  return security.issueAuthenticatedOwnerSessionAttestation(
    request,
    session,
    {
      approvalId: input.approvalId,
      decidedAt: input.decidedAt,
      decision: input.decision,
      decisionNoteHash: sha256(String(input.note || "")),
      expectedScopeHash: input.expectedScopeHash,
    },
  );
}

module.exports = {
  authenticatedOwnerSecurityForTest,
  issueAuthenticatedOwnerSessionAttestationForTest,
};
