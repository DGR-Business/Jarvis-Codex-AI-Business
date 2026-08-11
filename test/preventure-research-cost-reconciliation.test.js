"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  withPreventureProviderCostReconciliationCapability,
} = require("../src/db");
const { sha256 } = require("../src/runtime/commercial-test-contract");
const {
  sealedDecisionBillingFixture,
} = require("./support/preventure-research-owner-billing-observation-fixture");

const REQUIRED_CODE = "preventure_research_owner_billing_observation_required";
const RECONCILED_AT = "2026-09-05T01:16:00.000Z";

function exactRequired(error) {
  return error?.code === REQUIRED_CODE;
}

function legacyInput(subject, amountAudCents = 7) {
  return {
    authorityHash: subject.assignment.authorityHash,
    assignmentTemplateHash: subject.assignment.templateHash,
    taskId: subject.assignment.taskId,
    costKey: subject.costBinding.costKey,
    expectedPreviousReceiptHash: subject.predecessor.expectedPreviousReceiptHash,
    taskAttemptId: subject.identityBinding.taskAttemptId,
    modelCallId: subject.identityBinding.modelCallId,
    agentRunReceiptId: subject.identityBinding.agentRunReceiptId,
    agentRunReceiptHash: subject.identityBinding.agentRunReceiptHash,
    budgetReservationId: subject.costBinding.budgetReservationId,
    costId: subject.costBinding.costId,
    clientRequestId: subject.identityBinding.clientRequestId,
    providerRequestId: subject.identityBinding.providerRequestId,
    providerResponseId: subject.identityBinding.providerResponseId,
    amountAudCents,
    billingEvidenceHash: sha256({
      source: "untrusted_caller_supplied_hash",
      amountAudCents,
    }),
    allocation: {
      currency: "AUD",
      amountAudCents,
      method: "provider_billing_evidence",
    },
    occurredAt: RECONCILED_AT,
  };
}

function snapshot(subject) {
  return {
    observations: subject.db.prepare(
      "SELECT * FROM preventure_research_provider_billing_observations ORDER BY observation_hash",
    ).all(),
    costEvents: subject.db.prepare(
      `SELECT * FROM preventure_research_cost_events
       WHERE assignment_hash = ? AND cost_key = ? ORDER BY sequence`,
    ).all(subject.assignment.assignmentHash, subject.costBinding.costKey),
    reservation: subject.db.prepare(
      "SELECT * FROM budget_reservations WHERE id = ?",
    ).get(subject.costBinding.budgetReservationId),
    cost: subject.db.prepare(
      "SELECT * FROM costs WHERE id = ?",
    ).get(subject.costBinding.costId),
    modelCall: subject.db.prepare(
      "SELECT * FROM model_calls WHERE id = ?",
    ).get(subject.identityBinding.modelCallId),
    decision: subject.db.prepare(
      "SELECT * FROM preventure_research_decisions WHERE decision_hash = ?",
    ).get(subject.predecessor.hash),
  };
}

function costProjection(costEvent) {
  return {
    receipt_hash: costEvent.receiptHash,
    authority_hash: costEvent.authorityHash,
    assignment_hash: costEvent.assignmentHash,
    cost_key: costEvent.costKey,
    sequence: costEvent.sequence,
    previous_receipt_hash: costEvent.previousReceiptHash,
    event_type: costEvent.eventType,
    amount_aud_cents: costEvent.amountAudCents,
    exposure_aud_cents: costEvent.exposureAudCents,
    task_attempt_id: costEvent.taskAttemptId,
    model_call_id: costEvent.modelCallId,
    budget_reservation_id: costEvent.budgetReservationId,
    cost_id: costEvent.costId,
    agent_run_receipt_id: costEvent.agentRunReceiptId,
    cost_json: JSON.stringify(costEvent),
    occurred_at: costEvent.occurredAt,
    created_at: RECONCILED_AT,
  };
}

function insertProjection(db, table, projection) {
  const columns = Object.keys(projection);
  db.prepare(
    `INSERT INTO ${table} (${columns.join(", ")})
     VALUES (${columns.map(() => "?").join(", ")})`,
  ).run(...columns.map((column) => projection[column] ?? null));
}

test("the caller-supplied provider-evidence reconciliation seam is retired for every prior cost shape", async (t) => {
  for (const scenario of [
    { name: "estimated", predecessorType: "estimated", amountAudCents: 7 },
    { name: "incurred", predecessorType: "incurred", amountAudCents: 7 },
    { name: "A$0", predecessorType: "estimated", amountAudCents: 0 },
  ]) {
    await t.test(scenario.name, () => {
      const subject = sealedDecisionBillingFixture({
        predecessorType: scenario.predecessorType,
      });
      try {
        const before = snapshot(subject);
        assert.throws(
          () => subject.store.reconcileProviderCost(
            subject.assignment.assignmentHash,
            legacyInput(subject, scenario.amountAudCents),
          ),
          exactRequired,
        );
        assert.deepEqual(snapshot(subject), before);
        assert.equal(subject.store.verifyLedger().ok, true);
      } finally {
        subject.close();
      }
    });
  }
});

test("arbitrary enumerable, inherited, and hidden attestation-shaped values cannot revive the retired seam", () => {
  const subject = sealedDecisionBillingFixture();
  try {
    const before = snapshot(subject);
    const candidates = [];

    const enumerable = legacyInput(subject);
    enumerable.ownerSessionAttestation = Object.freeze({});
    candidates.push(enumerable);

    const hidden = legacyInput(subject);
    Object.defineProperty(hidden, "ownerSessionAttestation", {
      value: Object.freeze({}),
      enumerable: false,
    });
    candidates.push(hidden);

    candidates.push(Object.assign(
      Object.create({ ownerSessionAttestation: Object.freeze({}) }),
      legacyInput(subject),
    ));

    for (const input of candidates) {
      assert.throws(
        () => subject.store.reconcileProviderCost(
          subject.assignment.assignmentHash,
          input,
        ),
        exactRequired,
      );
      assert.deepEqual(snapshot(subject), before);
    }
  } finally {
    subject.close();
  }
});

test("the retired database capability and direct SQL cannot append a reconciled successor", () => {
  const subject = sealedDecisionBillingFixture();
  try {
    const before = snapshot(subject);
    assert.throws(
      () => withPreventureProviderCostReconciliationCapability(
        subject.db,
        {},
        () => {},
      ),
      /retired.*authenticated owner billing observation/i,
    );

    const predecessor = JSON.parse(subject.priorCostEvent.cost_json);
    const body = {
      schema: predecessor.schema,
      authorityHash: predecessor.authorityHash,
      assignmentHash: predecessor.assignmentHash,
      costKey: predecessor.costKey,
      sequence: predecessor.sequence + 1,
      previousReceiptHash: predecessor.receiptHash,
      eventType: "reconciled",
      amountAudCents: 7,
      exposureAudCents: 7,
      taskAttemptId: predecessor.taskAttemptId,
      modelCallId: predecessor.modelCallId,
      budgetReservationId: predecessor.budgetReservationId,
      costId: predecessor.costId,
      agentRunReceiptId: predecessor.agentRunReceiptId,
      occurredAt: RECONCILED_AT,
      reconciliation: {
        schema: "pantheon.preventure-research-provider-cost-reconciliation.v1",
        billingEvidenceHash: sha256("untrusted-direct-sql-hash"),
      },
    };
    const directCost = { ...body, receiptHash: sha256(body) };
    assert.throws(
      () => insertProjection(
        subject.db,
        "preventure_research_cost_events",
        costProjection(directCost),
      ),
      /sealed diligence decision only permits bounded same-chain cost reconciliation/i,
    );
    assert.deepEqual(snapshot(subject), before);
    assert.equal(subject.store.verifyLedger().ok, true);
  } finally {
    subject.close();
  }
});
