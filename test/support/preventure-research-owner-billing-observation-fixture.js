"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { openDatabase, seedDatabase } = require("../../src/db");
const { sha256 } = require("../../src/runtime/commercial-test-contract");
const {
  createLocalSecurity,
} = require("../../src/runtime/local-security");
const {
  STORE_TIME,
  authority,
  sealPopulatedEarlyStopRound,
} = require("./preventure-research-early-stop-fixture");
const {
  addMilliseconds,
  buildRecoveryInput,
  createTerminalRecoveryFixture,
  prepareDispatchedExecution,
  retainProviderArtifact,
  revokeAuthority,
} = require("./preventure-research-terminal-recovery-fixture");

const ACTION_KIND = "owner_attested_provider_billing_observation";
const OBSERVATION_SCHEMA = "pantheon.owner-attested-provider-billing-observation.v1";
const TRUTH_STATUS = "owner_attested_not_provider_settled";
const TERMINAL_DISPATCHED_AT = "2026-08-02T06:30:00.000Z";
const BILLING_OBSERVED_AT = "2026-09-05T01:15:00.000Z";
const BILLING_RECORDED_AT = "2026-09-05T01:16:00.000Z";

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, canonical(value[key])]),
    );
  }
  return value ?? null;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function latestCostEvent(db, assignmentHash, costKey) {
  return db.prepare(
    `SELECT * FROM preventure_research_cost_events
     WHERE assignment_hash = ? AND cost_key = ?
     ORDER BY sequence DESC LIMIT 1`,
  ).get(assignmentHash, costKey);
}

function receiptHash(value) {
  if (value === null || value === undefined) return null;
  const text = String(value);
  return text.startsWith("sha256:") ? text : `sha256:${text}`;
}

function terminalRecoveryBillingFixture(options = {}) {
  const fx = createTerminalRecoveryFixture({
    ...(options.artifactRoot ? { artifactRoot: options.artifactRoot } : {}),
  });
  try {
    const execution = prepareDispatchedExecution(fx, {
      dispatchedAt: options.dispatchedAt || TERMINAL_DISPATCHED_AT,
      productionRunIdentity: true,
    });
    const artifact = retainProviderArtifact(fx, execution, {
      providerRequestId: Object.hasOwn(options, "providerRequestId")
        ? options.providerRequestId
        : null,
      retainedAt: addMilliseconds(execution.dispatchedAt, 1_000),
    });
    const terminal = revokeAuthority(
      fx,
      execution,
      addMilliseconds(execution.dispatchedAt, 2_000),
    );
    const recoveryInput = buildRecoveryInput(fx, execution, terminal, artifact, {
      recoveredAt: addMilliseconds(execution.dispatchedAt, 3_000),
    });
    assert.equal(typeof fx.store.commitTerminalRetainedRecovery, "function");
    const recovered = fx.store.commitTerminalRetainedRecovery(
      execution.assignment.assignmentHash,
      recoveryInput,
    );
    assert.equal(recovered.created, true);
    const prior = latestCostEvent(
      fx.db,
      execution.assignment.assignmentHash,
      execution.ids.costKey,
    );
    assert.equal(prior.event_type, "unknown");
    assert.equal(prior.exposure_aud_cents, execution.assignment.maxCostAudCents);
    const originalCost = fx.db.prepare(
      `SELECT * FROM preventure_research_cost_events
       WHERE assignment_hash = ? AND cost_key = ?
       ORDER BY sequence ASC LIMIT 1`,
    ).get(execution.assignment.assignmentHash, execution.ids.costKey);
    assert.ok(originalCost);
    const receipt = fx.db.prepare(
      `SELECT * FROM agent_run_receipts
       WHERE attempt_id = ? ORDER BY sequence DESC LIMIT 1`,
    ).get(execution.ids.attemptId);
    assert.ok(receipt);
    fx.setClock(options.recordedAt || BILLING_RECORDED_AT);
    return {
      ...fx,
      assignment: execution.assignment,
      execution,
      artifact,
      terminal,
      recoveryInput,
      recovered,
      predecessor: {
        kind: "terminal_recovery",
        hash: recovered.recovery.recoveryHash,
        expectedPreviousReceiptHash: prior.receipt_hash,
      },
      costBinding: {
        costKey: execution.ids.costKey,
        budgetReservationId: execution.ids.reservationId,
        costId: execution.ids.costId,
      },
      identityBinding: {
        taskAttemptId: execution.ids.attemptId,
        modelCallId: execution.ids.modelCallId,
        agentRunReceiptId: receipt.id,
        agentRunReceiptHash: receiptHash(receipt.receipt_hash),
        clientRequestId: execution.ids.clientRequestId,
        providerRequestId: artifact.retained.providerRequestId,
        providerResponseId: artifact.retained.providerResponseId,
      },
      originalUsageAt: originalCost.occurred_at,
      originalCostEvent: originalCost,
      priorCostEvent: prior,
    };
  } catch (error) {
    fx.close();
    throw error;
  }
}

function sealedDecisionBillingFixture(options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pantheon-owner-billing-decision-"));
  const dbPath = path.join(dir, "runtime.sqlite");
  let clockValue = STORE_TIME;
  const clock = () => clockValue;
  const db = openDatabase(dbPath, { clock });
  try {
    seedDatabase(db, { includeDemoProof: false });
    const fx = sealPopulatedEarlyStopRound(db, {
      clock,
      cost: {
        eventType: options.predecessorType || "estimated",
        amountAudCents: options.predecessorAmountAudCents ?? 23,
        exposureAudCents: options.predecessorExposureAudCents ?? 50,
      },
    });
    const assignment = fx.assignments[0];
    const execution = fx.executions[0];
    const prior = latestCostEvent(fx.db, assignment.assignmentHash, execution.costKey);
    assert.ok(prior);
    clockValue = options.recordedAt || BILLING_RECORDED_AT;
    return {
      ...fx,
      dir,
      dbPath,
      clock,
      get clockValue() { return clockValue; },
      setClock(value) {
        clockValue = new Date(Date.parse(value)).toISOString();
        return clockValue;
      },
      close() {
        try { db.close(); } catch {}
        fs.rmSync(dir, { recursive: true, force: true });
      },
      assignment,
      execution,
      predecessor: {
        kind: "sealed_decision",
        hash: fx.recorded.decision.decisionHash,
        expectedPreviousReceiptHash: prior.receipt_hash,
      },
      costBinding: {
        costKey: execution.costKey,
        budgetReservationId: execution.budgetReservationId,
        costId: execution.costId,
      },
      identityBinding: {
        taskAttemptId: execution.attemptId,
        modelCallId: execution.modelCallId,
        agentRunReceiptId: execution.agentRunReceiptId,
        agentRunReceiptHash: receiptHash(execution.agentRunReceiptHash),
        clientRequestId: execution.clientRequestId,
        providerRequestId: Object.hasOwn(options, "providerRequestId")
          ? options.providerRequestId
          : execution.providerRequestId,
        providerResponseId: execution.providerResponseId,
      },
      originalUsageAt: prior.occurred_at,
      priorCostEvent: prior,
    };
  } catch (error) {
    try { db.close(); } catch {}
    fs.rmSync(dir, { recursive: true, force: true });
    throw error;
  }
}

function observationInput(subject, options = {}) {
  const amountAudCents = options.amountAudCents ?? 0;
  const observedAt = options.observedAt || BILLING_OBSERVED_AT;
  const originalCostOccurredAt = options.originalCostOccurredAt || subject.originalUsageAt;
  return canonical({
    actionKind: ACTION_KIND,
    authorityHash: authority.authorityHash,
    assignmentTemplateHash: subject.assignment.templateHash,
    taskId: subject.assignment.taskId,
    predecessor: subject.predecessor,
    ...subject.costBinding,
    ...subject.identityBinding,
    provider: subject.assignment.provider,
    providerDispatchedAt: subject.execution.dispatchedAt
      || subject.priorCostEvent.occurred_at,
    providerAccountReferenceHash: sha256("test-owner-visible-openai-account"),
    billingRecordReferenceHash: sha256({
      source: "test-owner-visible-provider-billing-record",
      predecessor: subject.predecessor,
    }),
    currency: "AUD",
    amountAudCents,
    observedAt,
    originalCostOccurredAt,
    allocationBasis: {
      method: "owner_observed_provider_billing_allocated_to_original_dispatch",
      amountAudCents,
      currency: "AUD",
      providerDispatchedAt: subject.execution.dispatchedAt
        || subject.priorCostEvent.occurred_at,
      originalCostOccurredAt,
    },
    limitations: [
      "This is an authenticated owner observation of provider billing, not a provider-settled API receipt.",
    ],
  });
}

function observationIntentHash(input) {
  return sha256(canonical(input));
}

function attestationBinding(input, assignmentHash) {
  return canonical({
    actionKind: ACTION_KIND,
    authorityHash: input.authorityHash,
    assignmentHash,
    predecessorKind: input.predecessor.kind,
    predecessorHash: input.predecessor.hash,
    expectedPreviousReceiptHash: input.predecessor.expectedPreviousReceiptHash,
    observationIntentHash: observationIntentHash(input),
    observedAt: input.observedAt,
  });
}

function expectedObservationBody(subject, input) {
  const overageAudCents = Math.max(
    0,
    input.amountAudCents - subject.assignment.maxCostAudCents,
  );
  return canonical({
    schema: OBSERVATION_SCHEMA,
    actionKind: ACTION_KIND,
    authorityHash: input.authorityHash,
    assignmentHash: subject.assignment.assignmentHash,
    assignmentTemplateHash: input.assignmentTemplateHash,
    taskId: input.taskId,
    predecessor: input.predecessor,
    executionIdentity: {
      taskAttemptId: input.taskAttemptId,
      modelCallId: input.modelCallId,
      agentRunReceiptId: input.agentRunReceiptId,
      agentRunReceiptHash: input.agentRunReceiptHash,
      clientRequestId: input.clientRequestId,
      providerRequestId: input.providerRequestId,
      providerResponseId: input.providerResponseId,
      providerDispatchedAt: input.providerDispatchedAt,
    },
    costBinding: {
      costKey: input.costKey,
      expectedPreviousReceiptHash: input.predecessor.expectedPreviousReceiptHash,
      budgetReservationId: input.budgetReservationId,
      costId: input.costId,
    },
    billingObservation: {
      provider: input.provider,
      providerAccountReferenceHash: input.providerAccountReferenceHash,
      billingRecordReferenceHash: input.billingRecordReferenceHash,
      currency: input.currency,
      amountAudCents: input.amountAudCents,
      observedAt: input.observedAt,
      originalCostOccurredAt: input.originalCostOccurredAt,
      allocationBasis: input.allocationBasis,
      limitations: input.limitations,
    },
    budgetComparison: {
      approvedAssignmentCapAudCents: subject.assignment.maxCostAudCents,
      observedActualAudCents: input.amountAudCents,
      breached: overageAudCents > 0,
      overageAudCents,
    },
    truth: {
      source: "authenticated_owner_session_attestation",
      status: TRUTH_STATUS,
      statement: "Owner-attested provider billing observation; not provider-settled.",
    },
    recordedAt: subject.clock(),
  });
}

function issueOwnerBillingAttestation(security, bootstrapSecret, input, assignmentHash) {
  assert.equal(
    typeof security.issueAuthenticatedOwnerBillingObservationAttestation,
    "function",
    "The distinct owner-billing attestation issuer is unavailable.",
  );
  const origin = "http://127.0.0.1:5051";
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
      if (String(name).toLowerCase() === "set-cookie") {
        cookie = String(value).split(";", 1)[0];
      }
    },
  };
  const session = security.createSession(request, response);
  request.url = "/api/preventure-research/provider-billing-observations";
  request.headers.cookie = cookie;
  request.headers["x-pantheon-csrf"] = session.csrfToken;
  return security.issueAuthenticatedOwnerBillingObservationAttestation(
    request,
    session,
    attestationBinding(input, assignmentHash),
  );
}

function createBillingSecurity(options = {}) {
  return createLocalSecurity({
    enabled: true,
    secret: options.secret || Buffer.alloc(32, 111),
    bootstrapSecret: options.bootstrapSecret || "owner-billing-observation-bootstrap",
  });
}

function observationTableSnapshot(subject) {
  const observations = subject.db.prepare(
    `SELECT * FROM preventure_research_provider_billing_observations
     ORDER BY observation_hash`,
  ).all();
  const costs = subject.db.prepare(
    `SELECT * FROM preventure_research_cost_events
     WHERE assignment_hash = ? AND cost_key = ? ORDER BY sequence`,
  ).all(subject.assignment.assignmentHash, subject.costBinding.costKey);
  return {
    observations,
    costs,
    reservation: subject.db.prepare(
      "SELECT * FROM budget_reservations WHERE id = ?",
    ).get(subject.costBinding.budgetReservationId),
    cost: subject.db.prepare(
      "SELECT * FROM costs WHERE id = ?",
    ).get(subject.costBinding.costId),
    modelCall: subject.db.prepare(
      "SELECT * FROM model_calls WHERE id = ?",
    ).get(subject.identityBinding.modelCallId),
  };
}

module.exports = Object.freeze({
  ACTION_KIND,
  BILLING_OBSERVED_AT,
  BILLING_RECORDED_AT,
  OBSERVATION_SCHEMA,
  STORE_TIME,
  TRUTH_STATUS,
  attestationBinding,
  canonical,
  clone,
  createBillingSecurity,
  expectedObservationBody,
  issueOwnerBillingAttestation,
  observationInput,
  observationIntentHash,
  observationTableSnapshot,
  sealedDecisionBillingFixture,
  terminalRecoveryBillingFixture,
});
