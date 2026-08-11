"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const dbModule = require("../src/db");
const { sha256 } = require("../src/runtime/commercial-test-contract");
const { monthlyBudgetExposure } = require("../src/runtime/cost-ledger");
const localSecurity = require("../src/runtime/local-security");
const { createApp } = require("../src/server");
const {
  historicalV1TestRegistry,
} = require("./support/preventure-research-test-registry");
const {
  authenticatedOwnerSecurityForTest,
} = require("./support/authenticated-owner-session-attestation");
const {
  ACTION_KIND,
  OBSERVATION_SCHEMA,
  TRUTH_STATUS,
  clone,
  createBillingSecurity,
  expectedObservationBody,
  issueOwnerBillingAttestation,
  observationInput,
  observationTableSnapshot,
  sealedDecisionBillingFixture,
  terminalRecoveryBillingFixture,
} = require("./support/preventure-research-owner-billing-observation-fixture");

const ROUTE = "/api/preventure-research/provider-billing-observations";
const securityBootstrapSecrets = new WeakMap();
const ERROR = Object.freeze({
  alreadyRecorded: "preventure_research_owner_billing_observation_already_recorded",
  attestationInvalid: "preventure_owner_billing_observation_attestation_invalid",
  bindingChanged: "preventure_research_owner_billing_observation_binding_changed",
  costChanged: "preventure_research_owner_billing_observation_cost_changed",
  invalid: "preventure_research_owner_billing_observation_invalid",
  required: "preventure_research_owner_billing_observation_required",
});

function exactCode(code) {
  return (error) => error?.code === code;
}

function exactSqlCapabilityError(error) {
  return error instanceof Error
    && error.message
      === "Owner-attested provider billing observations require the exact database capability.";
}

function assertProductionSeams(subject, security = null) {
  assert.equal(
    typeof subject.store.recordOwnerAttestedProviderBillingObservation,
    "function",
    "Required production seam: store.recordOwnerAttestedProviderBillingObservation.",
  );
  assert.equal(
    typeof dbModule.withPreventureOwnerBillingObservationCapability,
    "function",
    "Required production seam: one-shot DB owner-billing observation capability.",
  );
  assert.equal(
    typeof localSecurity.bindAuthenticatedOwnerBillingObservationIssuer,
    "function",
    "Required production seam: distinct DB-bound owner-billing issuer.",
  );
  assert.equal(
    typeof localSecurity.consumeAuthenticatedOwnerBillingObservationAttestation,
    "function",
    "Required production seam: one-use owner-billing attestation consumer.",
  );
  if (security) {
    assert.equal(
      typeof security.issueAuthenticatedOwnerBillingObservationAttestation,
      "function",
      "Required production seam: exact protected-route owner-billing issuer action.",
    );
  }
  const table = subject.db.prepare(
    `SELECT name FROM sqlite_schema
     WHERE type = 'table'
       AND name = 'preventure_research_provider_billing_observations'`,
  ).get();
  assert.equal(
    table?.name,
    "preventure_research_provider_billing_observations",
    "Required schema seam: immutable provider billing observation table.",
  );
}

function bindIssuer(subject, security) {
  assertProductionSeams(subject, security);
  return localSecurity.bindAuthenticatedOwnerBillingObservationIssuer(
    subject.db,
    security,
  );
}

function issue(subject, security, input) {
  return issueOwnerBillingAttestation(
    security,
    securityBootstrapSecrets.get(security) || "owner-billing-observation-bootstrap",
    input,
    subject.assignment.assignmentHash,
  );
}

function securityForSubject(subject) {
  const existing = authenticatedOwnerSecurityForTest(subject.db);
  const bootstrapSecret = existing.bootstrapSecret;
  const security = existing.security;
  securityBootstrapSecrets.set(security, bootstrapSecret);
  bindIssuer(subject, security);
  return security;
}

function recordObservation(subject, input, attestation, assignmentHash) {
  assertProductionSeams(subject);
  return subject.store.recordOwnerAttestedProviderBillingObservation(
    assignmentHash || subject.assignment.assignmentHash,
    input,
    { ownerSessionAttestation: attestation },
  );
}

test("an attestation is consumed when the body or assignment changes after issue", () => {
  const subject = terminalRecoveryBillingFixture({ providerRequestId: null });
  try {
    const security = securityForSubject(subject, {
      secret: Buffer.alloc(32, 119),
      bootstrapSecret: "owner-billing-post-issue-mutation-bootstrap",
    });
    const exact = observationInput(subject, { amountAudCents: 0 });
    const bodyToken = issue(subject, security, exact);
    const changedBody = { ...clone(exact), providerResponseId: "resp_changed_after_issue" };
    assert.throws(
      () => recordObservation(subject, changedBody, bodyToken),
      exactCode(ERROR.attestationInvalid),
    );
    assert.throws(
      () => recordObservation(subject, exact, bodyToken),
      exactCode(ERROR.attestationInvalid),
    );

    const assignmentToken = issue(subject, security, exact);
    assert.throws(
      () => recordObservation(
        subject,
        exact,
        assignmentToken,
        subject.assignments[1].assignmentHash,
      ),
      exactCode(ERROR.attestationInvalid),
    );
    assert.throws(
      () => recordObservation(subject, exact, assignmentToken),
      exactCode(ERROR.attestationInvalid),
    );
    assert.equal(observationTableSnapshot(subject).observations.length, 0);
  } finally {
    subject.close();
  }
});

test("a cost-head race after issue fails closed and consumes the stale owner token", () => {
  const subject = terminalRecoveryBillingFixture();
  try {
    const security = securityForSubject(subject, {
      secret: Buffer.alloc(32, 120),
      bootstrapSecret: "owner-billing-cost-race-bootstrap",
    });
    const input = observationInput(subject, { amountAudCents: 6 });
    const staleToken = issue(subject, security, input);
    const winner = recordObservation(subject, input, issue(subject, security, input));
    assertSuccessfulObservation(subject, input, winner);
    const after = observationTableSnapshot(subject);
    assert.throws(
      () => recordObservation(subject, input, staleToken),
      exactCode(ERROR.alreadyRecorded),
    );
    assert.deepEqual(observationTableSnapshot(subject), after);
    assert.throws(
      () => recordObservation(subject, input, staleToken),
      exactCode(ERROR.attestationInvalid),
    );
  } finally {
    subject.close();
  }
});

function persistedObservation(subject, observationHash) {
  return subject.db.prepare(
    `SELECT * FROM preventure_research_provider_billing_observations
     WHERE observation_hash = ?`,
  ).get(observationHash);
}

function assertSuccessfulObservation(subject, input, result, options = {}) {
  assert.equal(result.created, true);
  const expectedBody = expectedObservationBody(subject, input);
  if (options.recordedAt) expectedBody.recordedAt = options.recordedAt;
  assert.deepEqual(result.observation, {
    ...expectedBody,
    observationHash: sha256(expectedBody),
  });
  assert.equal(result.observation.schema, OBSERVATION_SCHEMA);
  assert.equal(result.observation.actionKind, ACTION_KIND);
  assert.equal(result.observation.truth.status, TRUTH_STATUS);
  assert.match(result.observation.truth.statement, /not provider-settled/i);
  assert.equal(
    result.observation.executionIdentity.providerRequestId,
    input.providerRequestId,
  );
  assert.deepEqual(result.budgetBreach, result.observation.budgetComparison);

  const row = persistedObservation(subject, result.observation.observationHash);
  assert.ok(row);
  assert.equal(row.observation_hash, result.observation.observationHash);
  assert.deepEqual(JSON.parse(row.observation_json), result.observation);
  assert.equal(row.action_kind, ACTION_KIND);
  assert.equal(row.authority_hash, input.authorityHash);
  assert.equal(row.assignment_hash, subject.assignment.assignmentHash);
  assert.equal(row.predecessor_kind, input.predecessor.kind);
  assert.equal(row.predecessor_hash, input.predecessor.hash);
  assert.equal(
    row.expected_previous_receipt_hash,
    input.predecessor.expectedPreviousReceiptHash,
  );
  assert.equal(row.task_attempt_id, input.taskAttemptId);
  assert.equal(row.model_call_id, input.modelCallId);
  assert.equal(row.client_request_id, input.clientRequestId);
  assert.equal(row.provider_request_id, input.providerRequestId);
  assert.equal(row.provider_response_id, input.providerResponseId);
  assert.equal(row.currency, "AUD");
  assert.equal(row.amount_aud_cents, input.amountAudCents);
  assert.equal(row.observed_at, input.observedAt);
  assert.equal(row.original_cost_occurred_at, input.originalCostOccurredAt);
  assert.equal(row.provider_dispatched_at, input.providerDispatchedAt);
  assert.equal(row.recorded_at, options.recordedAt || subject.clock());
  assert.equal(Date.parse(row.observed_at) <= Date.parse(row.recorded_at), true);
  assert.equal(row.truth_status, TRUTH_STATUS);

  assert.equal(result.costEvent.eventType, "reconciled");
  assert.equal(
    result.costEvent.previousReceiptHash,
    input.predecessor.expectedPreviousReceiptHash,
  );
  assert.equal(result.costEvent.amountAudCents, input.amountAudCents);
  assert.equal(result.costEvent.exposureAudCents, input.amountAudCents);
  assert.equal(result.costEvent.occurredAt, input.originalCostOccurredAt);
  assert.notEqual(result.costEvent.occurredAt, input.observedAt);
  assert.equal(
    result.costEvent.ownerBillingObservationHash,
    result.observation.observationHash,
  );

  const projection = observationTableSnapshot(subject);
  assert.equal(projection.observations.length, 1);
  assert.equal(projection.costs.at(-2).receipt_hash, subject.priorCostEvent.receipt_hash);
  assert.equal(projection.costs.at(-2).event_type, subject.priorCostEvent.event_type);
  assert.equal(projection.costs.at(-1).receipt_hash, result.costEvent.receiptHash);
  assert.equal(projection.costs.at(-1).occurred_at, input.originalCostOccurredAt);
  assert.equal(projection.reservation.status, "reconciled");
  assert.equal(projection.reservation.amount_cents, input.amountAudCents);
  assert.equal(projection.cost.status, "reconciled");
  assert.equal(projection.cost.amount_cents, input.amountAudCents);
  assert.equal(projection.cost.occurred_at, input.originalCostOccurredAt);
  assert.equal(projection.modelCall.cost_status, "reconciled");
  assert.equal(projection.modelCall.actual_cost_cents, input.amountAudCents);
  assert.equal(projection.modelCall.reconciled_cost_cents, input.amountAudCents);
  for (const [label, rowValue] of [
    ["reservation", projection.reservation],
    ["cost", projection.cost],
    ["model call", projection.modelCall],
  ]) {
    const metadata = JSON.parse(rowValue.metadata);
    assert.equal(metadata.exactBillingPending, false, label);
    assert.equal(
      metadata.ownerBillingObservationHash,
      result.observation.observationHash,
      label,
    );
    assert.equal(metadata.billingTruthStatus, TRUTH_STATUS, label);
  }
  assert.equal(subject.store.verifyLedger().ok, true);
}

test("an authenticated owner observation reconciles terminal unknown cost at A$0 without claiming provider settlement", () => {
  const subject = terminalRecoveryBillingFixture({ providerRequestId: null });
  try {
    const security = securityForSubject(subject);
    const input = observationInput(subject, { amountAudCents: 0 });
    const recoveryBefore = subject.db.prepare(
      `SELECT * FROM preventure_research_terminal_recoveries
       WHERE recovery_hash = ?`,
    ).get(subject.predecessor.hash);
    const unknownBefore = clone(subject.priorCostEvent);
    const result = recordObservation(subject, input, issue(subject, security, input));
    assertSuccessfulObservation(subject, input, result);
    assert.equal(result.observation.executionIdentity.providerRequestId, null);
    assert.deepEqual(
      subject.db.prepare(
        `SELECT * FROM preventure_research_terminal_recoveries
         WHERE recovery_hash = ?`,
      ).get(subject.predecessor.hash),
      recoveryBefore,
    );
    assert.deepEqual(
      clone(subject.db.prepare(
        `SELECT * FROM preventure_research_cost_events
         WHERE receipt_hash = ?`,
      ).get(unknownBefore.receipt_hash)),
      unknownBefore,
    );

    const august = monthlyBudgetExposure(subject.db, { month: "2026-08" });
    const group = august.groups.find(
      (item) => item.entries.some((entry) => entry.taskId === subject.assignment.taskId),
    );
    assert.ok(group);
    assert.equal(group.amountCents, 0);
    assert.equal(group.realizedCents, 0);
    assert.equal(group.unresolvedCents, 0);
    assert.equal(group.countedAs, "realized");
    assert.equal(monthlyBudgetExposure(subject.db, { month: "2026-09" }).totalCents, 0);
  } finally {
    subject.close();
  }
});

test("the same owner-attested seam accepts an exact sealed-decision predecessor and preserves its decision-time truth", () => {
  const subject = sealedDecisionBillingFixture();
  try {
    const security = securityForSubject(subject, {
      secret: Buffer.alloc(32, 112),
      bootstrapSecret: "owner-billing-decision-bootstrap",
    });
    const input = observationInput(subject, { amountAudCents: 17 });
    const decisionBefore = subject.db.prepare(
      "SELECT * FROM preventure_research_decisions WHERE decision_hash = ?",
    ).get(subject.predecessor.hash);
    const result = recordObservation(subject, input, issue(subject, security, input));
    assertSuccessfulObservation(subject, input, result);
    assert.equal(result.observation.predecessor.kind, "sealed_decision");
    assert.deepEqual(
      subject.db.prepare(
        "SELECT * FROM preventure_research_decisions WHERE decision_hash = ?",
      ).get(subject.predecessor.hash),
      decisionBefore,
    );
  } finally {
    subject.close();
  }
});

test("an observed actual above the approved cap is retained in full and surfaced as a breach", () => {
  const subject = terminalRecoveryBillingFixture();
  try {
    const security = securityForSubject(subject, {
      secret: Buffer.alloc(32, 121),
      bootstrapSecret: "owner-billing-over-cap-bootstrap",
    });
    const actualAudCents = subject.assignment.maxCostAudCents + 37;
    const input = observationInput(subject, { amountAudCents: actualAudCents });
    const result = recordObservation(subject, input, issue(subject, security, input));
    assertSuccessfulObservation(subject, input, result);
    assert.deepEqual(result.budgetBreach, {
      approvedAssignmentCapAudCents: subject.assignment.maxCostAudCents,
      observedActualAudCents: actualAudCents,
      breached: true,
      overageAudCents: 37,
    });
    assert.equal(result.costEvent.amountAudCents, actualAudCents);
    assert.equal(result.costEvent.exposureAudCents, actualAudCents);
    const projection = observationTableSnapshot(subject);
    assert.equal(projection.cost.amount_cents, actualAudCents);
    assert.equal(projection.reservation.amount_cents, actualAudCents);
    assert.equal(projection.modelCall.actual_cost_cents, actualAudCents);
    assert.equal(
      monthlyBudgetExposure(subject.db, { month: "2026-08" }).totalCents,
      actualAudCents,
    );
  } finally {
    subject.close();
  }
});

test("every cross-layer identity, date, currency, allocation, and action-kind mismatch is rejected atomically", () => {
  const subject = terminalRecoveryBillingFixture({ providerRequestId: null });
  try {
    const security = securityForSubject(subject, {
      secret: Buffer.alloc(32, 113),
      bootstrapSecret: "owner-billing-mismatch-bootstrap",
    });
    const exact = observationInput(subject, { amountAudCents: 0 });
    const before = observationTableSnapshot(subject);
    const wrongHash = sha256("wrong-owner-billing-binding");
    const cases = [
      [
        "action kind",
        { actionKind: "preventure_research_lifecycle" },
        ERROR.attestationInvalid,
      ],
      ["authority", { authorityHash: wrongHash }, ERROR.bindingChanged],
      ["template", { assignmentTemplateHash: wrongHash }, ERROR.bindingChanged],
      ["task", { taskId: "wrong_task" }, ERROR.bindingChanged],
      ["predecessor kind", { predecessor: { ...exact.predecessor, kind: "sealed_decision" } }, ERROR.bindingChanged],
      ["predecessor hash", { predecessor: { ...exact.predecessor, hash: wrongHash } }, ERROR.bindingChanged],
      ["cost predecessor", { predecessor: { ...exact.predecessor, expectedPreviousReceiptHash: wrongHash } }, ERROR.costChanged],
      ["attempt", { taskAttemptId: "wrong_attempt" }, ERROR.bindingChanged],
      ["model call", { modelCallId: "wrong_model" }, ERROR.bindingChanged],
      ["agent receipt", { agentRunReceiptId: "wrong_receipt" }, ERROR.bindingChanged],
      ["agent receipt hash", { agentRunReceiptHash: wrongHash }, ERROR.bindingChanged],
      ["client request", { clientRequestId: "wrong_client" }, ERROR.bindingChanged],
      ["nullable header request", { providerRequestId: "req_not_observed" }, ERROR.bindingChanged],
      ["body response", { providerResponseId: "resp_wrong" }, ERROR.bindingChanged],
      [
        "provider dispatch",
        {
          providerDispatchedAt: "2026-08-02T06:31:00.000Z",
          allocationBasis: {
            ...exact.allocationBasis,
            providerDispatchedAt: "2026-08-02T06:31:00.000Z",
          },
        },
        ERROR.bindingChanged,
      ],
      ["cost key", { costKey: "wrong_cost_key" }, ERROR.costChanged],
      ["reservation", { budgetReservationId: "wrong_reservation" }, ERROR.costChanged],
      ["cost", { costId: "wrong_cost" }, ERROR.costChanged],
      ["provider", { provider: "not-openai" }, ERROR.bindingChanged],
      ["currency", { currency: "USD" }, ERROR.invalid],
      ["negative amount", { amountAudCents: -1 }, ERROR.invalid],
      [
        "original cost date",
        {
          originalCostOccurredAt: "2026-09-05T01:15:00.000Z",
          allocationBasis: {
            ...exact.allocationBasis,
            originalCostOccurredAt: "2026-09-05T01:15:00.000Z",
          },
        },
        ERROR.costChanged,
      ],
      ["observed before dispatch", { observedAt: "2026-08-01T01:15:00.000Z" }, ERROR.invalid],
      ["observed after trusted recording time", { observedAt: "2026-09-05T01:17:00.000Z" }, ERROR.invalid],
      ["caller-supplied recording time", { recordedAt: exact.observedAt }, ERROR.invalid],
      ["allocation amount", { allocationBasis: { ...exact.allocationBasis, amountAudCents: 1 } }, ERROR.invalid],
      ["allocation method", { allocationBasis: { ...exact.allocationBasis, method: "estimate" } }, ERROR.invalid],
      ["limitations", { limitations: [] }, ERROR.invalid],
    ];
    for (const [label, changes, errorCode] of cases) {
      const input = { ...clone(exact), ...changes };
      const attestation = issue(subject, security, input);
      assert.throws(
        () => recordObservation(subject, input, attestation),
        exactCode(errorCode),
        label,
      );
      assert.deepEqual(observationTableSnapshot(subject), before, label);
    }
  } finally {
    subject.close();
  }
});

test("owner attestations are one-use; exact replay, conflicts, arbitrary tokens, and a second issuer are rejected", () => {
  const subject = terminalRecoveryBillingFixture();
  try {
    const primary = securityForSubject(subject, {
      secret: Buffer.alloc(32, 114),
      bootstrapSecret: "owner-billing-primary-bootstrap",
    });
    assert.equal(
      localSecurity.bindAuthenticatedOwnerSessionAttestationIssuer(subject.db, primary),
      true,
      "The billing issuer must be distinct from, but compatible with, the lifecycle issuer.",
    );
    const input = observationInput(subject, { amountAudCents: 9 });
    const attestation = issue(subject, primary, input);
    const first = recordObservation(subject, input, attestation);
    assertSuccessfulObservation(subject, input, first);
    const after = observationTableSnapshot(subject);

    assert.throws(
      () => recordObservation(subject, input, attestation),
      exactCode(ERROR.attestationInvalid),
    );
    assert.deepEqual(observationTableSnapshot(subject), after);
    assert.throws(
      () => recordObservation(subject, input, issue(subject, primary, input)),
      exactCode(ERROR.alreadyRecorded),
    );
    assert.deepEqual(observationTableSnapshot(subject), after);

    const changed = observationInput(subject, { amountAudCents: 8 });
    assert.throws(
      () => recordObservation(subject, changed, issue(subject, primary, changed)),
      exactCode(ERROR.alreadyRecorded),
    );
    assert.deepEqual(observationTableSnapshot(subject), after);
    assert.throws(
      () => recordObservation(subject, input, Object.freeze({})),
      exactCode(ERROR.attestationInvalid),
    );

    const second = createBillingSecurity({
      secret: Buffer.alloc(32, 115),
      bootstrapSecret: "owner-billing-second-bootstrap",
    });
    assert.throws(
      () => localSecurity.bindAuthenticatedOwnerBillingObservationIssuer(
        subject.db,
        second,
      ),
      /already bound|another.*issuer/i,
    );
    const secondAttestation = issueOwnerBillingAttestation(
      second,
      "owner-billing-second-bootstrap",
      input,
      subject.assignment.assignmentHash,
    );
    assert.throws(
      () => recordObservation(subject, input, secondAttestation),
      exactCode(ERROR.attestationInvalid),
    );
    assert.deepEqual(observationTableSnapshot(subject), after);
  } finally {
    subject.close();
  }
});

test("a failed observation transaction rolls back every row and consumes the failed attestation", () => {
  const subject = terminalRecoveryBillingFixture();
  try {
    const security = securityForSubject(subject, {
      secret: Buffer.alloc(32, 116),
      bootstrapSecret: "owner-billing-rollback-bootstrap",
    });
    const input = observationInput(subject, { amountAudCents: 5 });
    const before = observationTableSnapshot(subject);
    const attestation = issue(subject, security, input);
    subject.db.exec(`
      CREATE TEMP TRIGGER owner_billing_observation_forced_rollback
      AFTER INSERT ON main.preventure_research_provider_billing_observations
      BEGIN
        SELECT RAISE(ABORT, 'forced owner billing observation rollback');
      END
    `);
    assert.throws(
      () => recordObservation(subject, input, attestation),
      /forced owner billing observation rollback/i,
    );
    subject.db.exec("DROP TRIGGER owner_billing_observation_forced_rollback");
    assert.deepEqual(observationTableSnapshot(subject), before);
    assert.throws(
      () => recordObservation(subject, input, attestation),
      exactCode(ERROR.attestationInvalid),
    );
    assert.deepEqual(observationTableSnapshot(subject), before);

    const recovered = recordObservation(subject, input, issue(subject, security, input));
    assertSuccessfulObservation(subject, input, recovered);
  } finally {
    subject.close();
  }
});

test("generic reconciliation and direct SQL cannot bypass the owner-attested observation capability", () => {
  const source = terminalRecoveryBillingFixture();
  const target = terminalRecoveryBillingFixture();
  try {
    const security = securityForSubject(source, {
      secret: Buffer.alloc(32, 117),
      bootstrapSecret: "owner-billing-direct-source-bootstrap",
    });
    assertProductionSeams(target);
    const input = observationInput(source, { amountAudCents: 4 });
    const result = recordObservation(source, input, issue(source, security, input));
    const row = persistedObservation(source, result.observation.observationHash);
    const columns = Object.keys(row);
    assert.throws(
      () => target.db.prepare(
        `INSERT INTO preventure_research_provider_billing_observations
         (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`,
      ).run(...columns.map((column) => row[column])),
      exactSqlCapabilityError,
    );
    assert.equal(observationTableSnapshot(target).observations.length, 0);

    const generic = {
      authorityHash: target.assignment.authorityHash,
      assignmentTemplateHash: target.assignment.templateHash,
      taskId: target.assignment.taskId,
      costKey: target.costBinding.costKey,
      expectedPreviousReceiptHash: target.predecessor.expectedPreviousReceiptHash,
      taskAttemptId: target.identityBinding.taskAttemptId,
      modelCallId: target.identityBinding.modelCallId,
      agentRunReceiptId: target.identityBinding.agentRunReceiptId,
      agentRunReceiptHash: target.identityBinding.agentRunReceiptHash,
      budgetReservationId: target.costBinding.budgetReservationId,
      costId: target.costBinding.costId,
      clientRequestId: target.identityBinding.clientRequestId,
      providerRequestId: target.identityBinding.providerRequestId,
      providerResponseId: target.identityBinding.providerResponseId,
      amountAudCents: 4,
      billingEvidenceHash: sha256("arbitrary-unattested-billing-evidence"),
      allocation: { currency: "AUD", amountAudCents: 4, method: "provider_billing_evidence" },
      occurredAt: target.originalUsageAt,
    };
    assert.throws(
      () => target.store.reconcileProviderCost(target.assignment.assignmentHash, generic),
      exactCode(ERROR.required),
    );
    assert.equal(observationTableSnapshot(target).observations.length, 0);
  } finally {
    source.close();
    target.close();
  }
});

async function startHttpSubject(subject) {
  const existingSecurity = authenticatedOwnerSecurityForTest(subject.db);
  const bootstrapSecret = existingSecurity.bootstrapSecret;
  const app = createApp({
    db: subject.db,
    dbPath: path.join(subject.dir, "runtime.sqlite"),
    schedulerEnabled: false,
    security: true,
    localSecurity: existingSecurity.security,
    sessionSecret: Buffer.alloc(32, 118),
    bootstrapSecret,
    initializePreventureResearch: false,
    preventureResearchClock: subject.clock,
    preventureResearchAuthorityRegistry: historicalV1TestRegistry,
    preventureResearchRuntime: {
      retainedOutputStore: subject.retainedOutputStore,
    },
    preventureResearchArtifactRoot: subject.artifactRoot,
  });
  await new Promise((resolve, reject) => {
    app.server.once("error", reject);
    app.server.listen(0, "127.0.0.1", resolve);
  });
  return {
    ...app,
    bootstrapSecret,
    origin: `http://127.0.0.1:${app.server.address().port}`,
  };
}

async function stopHttpSubject(app) {
  for (const client of app.wss.clients) client.terminate();
  await new Promise((resolve) => app.server.close(resolve));
  app.wss.close();
}

async function sessionFor(app) {
  const response = await fetch(`${app.origin}/api/session`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: app.origin,
      "x-pantheon-bootstrap": app.bootstrapSecret,
    },
    body: "{}",
  });
  const payload = await response.json();
  assert.equal(response.status, 201, JSON.stringify(payload));
  return {
    cookie: response.headers.get("set-cookie").split(";", 1)[0],
    csrfToken: payload.csrfToken,
  };
}

async function post(app, pathname, body, session, options = {}) {
  const headers = { "content-type": "application/json", origin: app.origin };
  if (session) {
    headers.cookie = session.cookie;
    if (options.csrf !== false) headers["x-pantheon-csrf"] = session.csrfToken;
  }
  const response = await fetch(`${app.origin}${pathname}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  return { response, payload: await response.json() };
}

test("the HTTP route is owner-session protected, one-shot, exact, and rejects the generic provider route", async () => {
  const subject = terminalRecoveryBillingFixture({ providerRequestId: null });
  let app;
  try {
    assertProductionSeams(subject);
    app = await startHttpSubject(subject);
    const input = observationInput(subject, { amountAudCents: 0 });
    const body = { assignmentHash: subject.assignment.assignmentHash, ...input };
    assert.equal(Object.hasOwn(body, "recordedAt"), false);
    const before = observationTableSnapshot(subject);

    const unauthenticated = await post(app, ROUTE, body, null);
    assert.ok([401, 403].includes(unauthenticated.response.status));
    assert.deepEqual(observationTableSnapshot(subject), before);

    const session = await sessionFor(app);
    const noCsrf = await post(app, ROUTE, body, session, { csrf: false });
    assert.equal(noCsrf.response.status, 403);
    assert.deepEqual(observationTableSnapshot(subject), before);

    const exact = await post(app, ROUTE, body, session);
    assert.equal(exact.response.status, 201, JSON.stringify(exact.payload));
    assertSuccessfulObservation(subject, input, exact.payload.result, {
      recordedAt: exact.payload.result.observation.recordedAt,
    });
    assert.match(exact.payload.message, /not provider-settled/i);
    const after = observationTableSnapshot(subject);

    const replay = await post(app, ROUTE, body, session);
    assert.equal(replay.response.status, 409);
    assert.equal(replay.payload.code, ERROR.alreadyRecorded);
    assert.deepEqual(observationTableSnapshot(subject), after);

    const generic = await post(
      app,
      "/api/system/spend/reconcile-provider-usage",
      {
        batchId: "generic_route_must_not_reconcile_preventure",
        ventureId: "not-applicable-to-preventure",
        provider: subject.assignment.provider,
        totalAudCents: 0,
        evidence: { source: "unattested_generic_route" },
        allocations: [{
          taskId: subject.assignment.taskId,
          costId: subject.costBinding.costId,
          modelCallId: subject.identityBinding.modelCallId,
          amountCents: 0,
          responseId: subject.identityBinding.providerRequestId,
        }],
      },
      session,
    );
    assert.equal(generic.response.status, 409);
    assert.equal(
      generic.payload.code,
      "preventure_research_dedicated_reconciliation_required",
    );
    assert.deepEqual(observationTableSnapshot(subject), after);
  } finally {
    if (app) await stopHttpSubject(app);
    subject.close();
  }
});

test("the dashboard billing control sends only owner facts while the server derives every execution binding", async () => {
  const subject = terminalRecoveryBillingFixture({ providerRequestId: null });
  let app;
  try {
    app = await startHttpSubject(subject);
    const session = await sessionFor(app);
    const observedAt = observationInput(subject, { amountAudCents: 0 }).observedAt;
    const ownerFacts = {
      assignmentHash: subject.assignment.assignmentHash,
      amountAudCents: 0,
      observedAt,
      providerAccountReference: "Synthetic owner account label 2718",
      billingRecordReference: "Synthetic billing page 3141",
      confirm: "RECORD OWNER-ATTESTED PROVIDER BILLING",
    };
    assert.deepEqual(Object.keys(ownerFacts).sort(), [
      "amountAudCents",
      "assignmentHash",
      "billingRecordReference",
      "confirm",
      "observedAt",
      "providerAccountReference",
    ]);

    const exact = await post(app, ROUTE, ownerFacts, session);
    assert.equal(exact.response.status, 201, JSON.stringify(exact.payload));
    assert.equal(exact.payload.result.created, true);
    assert.equal(exact.payload.result.observation.actionKind, ACTION_KIND);
    assert.equal(exact.payload.result.observation.truth.status, TRUTH_STATUS);
    assert.equal(
      exact.payload.result.observation.executionIdentity.taskAttemptId,
      subject.identityBinding.taskAttemptId,
    );
    assert.equal(
      exact.payload.result.observation.executionIdentity.modelCallId,
      subject.identityBinding.modelCallId,
    );
    assert.equal(
      exact.payload.result.observation.executionIdentity.providerRequestId,
      null,
    );
    assert.equal(exact.payload.result.observation.billingObservation.amountAudCents, 0);
    assert.match(exact.payload.message, /not provider-settled/i);
    assert.equal(subject.store.verifyLedger().ok, true);

    const row = persistedObservation(
      subject,
      exact.payload.result.observation.observationHash,
    );
    const persistedAndReturned = `${JSON.stringify(row)}\n${JSON.stringify(exact.payload)}`;
    assert.doesNotMatch(persistedAndReturned, /Synthetic owner account label 2718/);
    assert.doesNotMatch(persistedAndReturned, /Synthetic billing page 3141/);

    const replay = await post(app, ROUTE, ownerFacts, session);
    assert.equal(replay.response.status, 409);
    assert.equal(replay.payload.code, ERROR.alreadyRecorded);
  } finally {
    if (app) await stopHttpSubject(app);
    subject.close();
  }
});
