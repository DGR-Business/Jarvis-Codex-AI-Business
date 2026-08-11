"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  OWNER_BILLING_OBSERVATION_ACTION_KIND,
  bindAuthenticatedOwnerBillingObservationIssuer,
  bindAuthenticatedOwnerSessionAttestationIssuer,
  consumeAuthenticatedOwnerBillingObservationAttestation,
  consumeAuthenticatedOwnerSessionAttestation,
  createLocalSecurity,
} = require("../src/runtime/local-security");

const BILLING_ROUTE = "/api/preventure-research/provider-billing-observations";
const ORIGIN = "http://127.0.0.1:5051";

function digest(character) {
  return `sha256:${character.repeat(64)}`;
}

function billingBinding(overrides = {}) {
  return {
    actionKind: OWNER_BILLING_OBSERVATION_ACTION_KIND,
    assignmentHash: digest("a"),
    authorityHash: digest("b"),
    expectedPreviousReceiptHash: digest("c"),
    observationIntentHash: digest("d"),
    observedAt: "2026-09-05T01:15:00.000Z",
    predecessorHash: digest("e"),
    predecessorKind: "terminal_recovery",
    ...overrides,
  };
}

function lifecycleBinding(overrides = {}) {
  return {
    approvalId: "approval_owner_security_test",
    decidedAt: "2026-09-05T01:16:00.000Z",
    decision: "approve",
    decisionNoteHash: digest("f"),
    expectedScopeHash: digest("1"),
    ...overrides,
  };
}

function security(bootstrapSecret, character) {
  return createLocalSecurity({
    enabled: true,
    bootstrapSecret,
    secret: Buffer.alloc(32, character.charCodeAt(0)),
  });
}

function authenticatedRequest(localSecurity, bootstrapSecret, pathname) {
  let cookie = "";
  const request = {
    method: "POST",
    url: "/api/session",
    headers: {
      host: "127.0.0.1:5051",
      origin: ORIGIN,
      "content-type": "application/json",
      "x-pantheon-bootstrap": bootstrapSecret,
    },
  };
  const response = {
    setHeader(name, value) {
      if (String(name).toLowerCase() === "set-cookie") {
        cookie = String(value).split(";", 1)[0];
      }
    },
  };
  const session = localSecurity.createSession(request, response);
  request.url = pathname;
  request.headers.cookie = cookie;
  request.headers["x-pantheon-csrf"] = session.csrfToken;
  return { request, session };
}

function issueBilling(localSecurity, bootstrapSecret, binding, pathname = BILLING_ROUTE) {
  const { request, session } = authenticatedRequest(
    localSecurity,
    bootstrapSecret,
    pathname,
  );
  return localSecurity.issueAuthenticatedOwnerBillingObservationAttestation(
    request,
    session,
    binding,
  );
}

function issueLifecycle(localSecurity, bootstrapSecret, binding) {
  const pathname = `/api/preventure-research/lifecycle-decisions/${binding.approvalId}/${binding.decision}`;
  const { request, session } = authenticatedRequest(
    localSecurity,
    bootstrapSecret,
    pathname,
  );
  return localSecurity.issueAuthenticatedOwnerSessionAttestation(
    request,
    session,
    binding,
  );
}

test("one local-security instance binds distinct lifecycle and owner-billing issuers", () => {
  const db = {};
  const bootstrapSecret = "owner-billing-primary-security";
  const localSecurity = security(bootstrapSecret, "a");
  assert.equal(bindAuthenticatedOwnerSessionAttestationIssuer(db, localSecurity), true);
  assert.equal(bindAuthenticatedOwnerBillingObservationIssuer(db, localSecurity), true);
  assert.equal(bindAuthenticatedOwnerSessionAttestationIssuer(db, localSecurity), true);
  assert.equal(bindAuthenticatedOwnerBillingObservationIssuer(db, localSecurity), true);

  const exactBilling = billingBinding();
  const billingAttestation = issueBilling(
    localSecurity,
    bootstrapSecret,
    exactBilling,
  );
  assert.equal(
    consumeAuthenticatedOwnerBillingObservationAttestation(
      billingAttestation,
      exactBilling,
      db,
    ),
    true,
  );
  assert.throws(
    () => consumeAuthenticatedOwnerBillingObservationAttestation(
      billingAttestation,
      exactBilling,
      db,
    ),
    /missing|reused|stale/i,
  );

  const exactLifecycle = lifecycleBinding();
  assert.equal(
    consumeAuthenticatedOwnerSessionAttestation(
      issueLifecycle(localSecurity, bootstrapSecret, exactLifecycle),
      exactLifecycle,
      db,
    ),
    true,
  );
});

test("a failed exact billing comparison consumes the one-use attestation", () => {
  const db = {};
  const bootstrapSecret = "owner-billing-consume-before-compare";
  const localSecurity = security(bootstrapSecret, "b");
  bindAuthenticatedOwnerBillingObservationIssuer(db, localSecurity);
  const exact = billingBinding();
  const attestation = issueBilling(localSecurity, bootstrapSecret, exact);

  assert.throws(
    () => consumeAuthenticatedOwnerBillingObservationAttestation(
      attestation,
      billingBinding({ observationIntentHash: digest("9") }),
      db,
    ),
    /another observation|missing|stale/i,
  );
  assert.throws(
    () => consumeAuthenticatedOwnerBillingObservationAttestation(
      attestation,
      exact,
      db,
    ),
    /missing|reused|stale/i,
  );
});

test("lifecycle and owner-billing attestations cannot cross protected actions", () => {
  const db = {};
  const bootstrapSecret = "owner-billing-cross-action";
  const localSecurity = security(bootstrapSecret, "c");
  bindAuthenticatedOwnerSessionAttestationIssuer(db, localSecurity);
  bindAuthenticatedOwnerBillingObservationIssuer(db, localSecurity);
  const exactBilling = billingBinding();
  const exactLifecycle = lifecycleBinding();

  const lifecycleAttestation = issueLifecycle(
    localSecurity,
    bootstrapSecret,
    exactLifecycle,
  );
  assert.throws(
    () => consumeAuthenticatedOwnerBillingObservationAttestation(
      lifecycleAttestation,
      exactBilling,
      db,
    ),
    /attestation|missing|stale/i,
  );
  assert.throws(
    () => consumeAuthenticatedOwnerSessionAttestation(
      lifecycleAttestation,
      exactLifecycle,
      db,
    ),
    /attestation|missing|reused/i,
  );

  const billingAttestation = issueBilling(localSecurity, bootstrapSecret, exactBilling);
  assert.throws(
    () => consumeAuthenticatedOwnerSessionAttestation(
      billingAttestation,
      exactLifecycle,
      db,
    ),
    /attestation|missing|stale/i,
  );
  assert.throws(
    () => consumeAuthenticatedOwnerBillingObservationAttestation(
      billingAttestation,
      exactBilling,
      db,
    ),
    /attestation|missing|reused/i,
  );
});

test("a database cannot mix local-security instances across owner boundaries", () => {
  const db = {};
  const primaryBootstrap = "owner-billing-bound-primary";
  const secondBootstrap = "owner-billing-bound-second";
  const primary = security(primaryBootstrap, "d");
  const second = security(secondBootstrap, "e");
  bindAuthenticatedOwnerSessionAttestationIssuer(db, primary);

  assert.throws(
    () => bindAuthenticatedOwnerBillingObservationIssuer(db, second),
    /already bound|another.*local-security/i,
  );
  assert.equal(bindAuthenticatedOwnerBillingObservationIssuer(db, primary), true);
  const exact = billingBinding();
  const secondAttestation = issueBilling(second, secondBootstrap, exact);
  assert.throws(
    () => consumeAuthenticatedOwnerBillingObservationAttestation(
      secondAttestation,
      exact,
      db,
    ),
    /attestation|another observation|stale/i,
  );
  assert.throws(
    () => consumeAuthenticatedOwnerBillingObservationAttestation(
      secondAttestation,
      exact,
      db,
    ),
    /attestation|reused|stale/i,
  );
});

test("owner-billing issuance requires the exact action, fields, and route", () => {
  const bootstrapSecret = "owner-billing-exact-route";
  const localSecurity = security(bootstrapSecret, "f");
  assert.throws(
    () => issueBilling(
      localSecurity,
      bootstrapSecret,
      billingBinding({ actionKind: "preventure_research_lifecycle" }),
    ),
    /binding is invalid/i,
  );
  assert.throws(
    () => issueBilling(
      localSecurity,
      bootstrapSecret,
      { ...billingBinding(), amountAudCents: 7 },
    ),
    /incomplete or widened/i,
  );
  assert.throws(
    () => issueBilling(
      localSecurity,
      bootstrapSecret,
      billingBinding(),
      "/api/system/spend/reconcile-provider-usage",
    ),
    /exact protected route/i,
  );
});
