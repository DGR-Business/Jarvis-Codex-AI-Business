"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const authority = require("../config/preventure-research-authority-smm-scope-guard-v1");
const { sha256 } = require("../src/runtime/commercial-test-contract");
const {
  PREVENTURE_OFFICIAL_RESPONSES_ENDPOINT_HASH,
  createPreventureResearchTerminalStop,
  preventureResearchTerminalStopId,
  validatePreventureResearchTerminalStop,
} = require("../src/runtime/preventure-research-terminal-stop");

const STOPPED_AT = "2026-08-02T05:00:00.000Z";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function assignments() {
  return authority.assignments.map((template, index) => ({
    id: template.id,
    taskId: `task_terminal_stop_${index + 1}`,
    assignmentHash: sha256({ id: template.id }),
    maxCostAudCents: template.maxCostAudCents,
  }));
}

function coverage(rows, triggerIndex, triggerClass) {
  const prefixEnd = triggerClass === "validated_evidence_shortfall"
    ? triggerIndex + 1
    : triggerIndex;
  const completed = rows.slice(0, prefixEnd);
  return {
    sourceSnapshotHashes: [],
    evidenceHashes: [],
    comparatorIds: [],
    comparatorCoverage: { comparatorCount: 0, complete: false },
    buyerEvidenceCoverage: { total: 0 },
    sourceAttemptRefs: [],
    evidenceSetHash: sha256({ evidence: [] }),
    executionReceiptSetHash: sha256({ receipts: completed.map((item) => item.id) }),
    completedAssignmentIds: completed.map((item) => item.id).sort(),
    completedAssignmentReceipts: completed.map((item, index) => ({
      assignmentId: item.id,
      assignmentHash: item.assignmentHash,
      agentRunReceiptId: `receipt_terminal_stop_${index + 1}`,
      agentRunReceiptHash: sha256({ receipt: item.id }),
    })).sort((left, right) => left.assignmentId.localeCompare(right.assignmentId)),
    retainedContradictionEvidenceIds: [],
    retainedCaseCriterionIds: [],
  };
}

function providerEvidence(triggerClass, assignment) {
  const preEffect = triggerClass === "known_failed_before_effect";
  return {
    attemptId: `attempt_${assignment.id}`,
    modelCallId: `model_call_${assignment.id}`,
    agentRunReceiptId: `receipt_${assignment.id}`,
    effectState: preEffect ? "definite_pre_effect" : "known_effect",
    officialEndpointHash: preEffect
      ? PREVENTURE_OFFICIAL_RESPONSES_ENDPOINT_HASH
      : null,
    httpStatus: preEffect ? 401 : 200,
    providerErrorType: preEffect ? "authentication_error" : null,
    providerErrorCode: preEffect ? "invalid_api_key" : null,
    providerErrorBodyArtifactHash: preEffect ? sha256({ errorBody: true }) : null,
    providerRequestId: null,
    providerResponseId: triggerClass === "validated_evidence_shortfall"
      ? "resp_terminal_stop_fixture"
      : null,
    clientRequestHash: sha256("pantheon-preventure-client-request"),
    rawOutputArtifactHash: sha256({ rawOutput: triggerClass }),
    responseIssuesHash: sha256([]),
    costStatus: "estimated",
    costAudCents: 0,
    exposureAudCents: preEffect ? assignment.maxCostAudCents : 0,
    exactBillingPending: true,
    providerZeroBillingGuarantee: preEffect ? false : null,
  };
}

function createStop(triggerIndex, triggerClass) {
  const rows = assignments();
  const triggerAssignment = rows[triggerIndex];
  const gapCodes = triggerClass === "validated_evidence_shortfall"
    ? ["buyer_evidence_units_insufficient"]
    : undefined;
  return createPreventureResearchTerminalStop({
    authority,
    assignments: rows,
    triggerAssignment,
    triggerOutcomeClass: triggerClass,
    providerEvidence: providerEvidence(triggerClass, triggerAssignment),
    actualCoverage: coverage(rows, triggerIndex, triggerClass),
    gapCodes,
    stoppedAt: STOPPED_AT,
  });
}

test("terminal stops derive the exact untouched suffix at positions one, two, and three", () => {
  for (const triggerIndex of [0, 1, 2]) {
    const stop = createStop(triggerIndex, "validated_evidence_shortfall");
    assert.equal(stop.skippedAssignments.length, 2 - triggerIndex);
    assert.deepEqual(
      stop.skippedAssignments.map((item) => item.assignmentId),
      assignments().slice(triggerIndex + 1).map((item) => item.id),
    );
    for (const skipped of stop.skippedAssignments) {
      for (const key of [
        "taskAttemptCount", "modelCallCount", "agentRunReceiptCount",
        "researchRunCount", "agentRunCount", "toolInvocationCount",
        "budgetReservationCount", "costEventCount", "costRecordCount",
        "sourceSnapshotCount", "evidenceRecordCount", "totalAudCostCents",
      ]) assert.equal(skipped[key], 0, `${triggerIndex}:${key}`);
    }
  }
});
test("terminal-stop identity binds schema and trigger outcome class", () => {
  const rows = assignments();
  const provider = providerEvidence("known_failed_before_effect", rows[0]);
  const preEffectId = preventureResearchTerminalStopId(
    authority,
    rows[0],
    "known_failed_before_effect",
    provider,
  );
  const unusableId = preventureResearchTerminalStopId(
    authority,
    rows[0],
    "known_retained_unusable_provider_response",
    provider,
  );
  assert.notEqual(preEffectId, unusableId);
});

test("known pre-effect proof keeps zero estimate, full exposure, and billing pending", () => {
  const stop = createStop(0, "known_failed_before_effect");
  assert.equal(stop.providerEvidence.providerRequestId, null);
  assert.equal(stop.providerEvidence.providerResponseId, null);
  assert.equal(stop.providerEvidence.costAudCents, 0);
  assert.equal(stop.providerEvidence.exposureAudCents, authority.assignments[0].maxCostAudCents);
  assert.equal(stop.providerEvidence.exactBillingPending, true);
  assert.equal(stop.providerEvidence.providerZeroBillingGuarantee, false);

  for (const mutation of [
    (record) => { record.providerEvidence.costStatus = "released"; },
    (record) => { record.providerEvidence.exactBillingPending = false; },
    (record) => { record.providerEvidence.exposureAudCents = 0; },
    (record) => { record.providerEvidence.providerResponseId = "resp_invented"; },
    (record) => { record.providerEvidence.officialEndpointHash = sha256("other"); },
    (record) => { record.providerEvidence.httpStatus = 429; },
  ]) {
    const changed = clone(stop);
    mutation(changed);
    assert.throws(
      () => validatePreventureResearchTerminalStop(changed, {
        authority,
        assignments: assignments(),
        triggerAssignment: assignments()[0],
      }),
      (error) => error.code === "preventure_research_terminal_stop_invalid",
    );
  }
});

test("known 2xx shortfall requires a body response ID but permits a null HTTP request ID", () => {
  const stop = createStop(0, "validated_evidence_shortfall");
  assert.equal(stop.providerEvidence.providerRequestId, null);
  assert.equal(stop.providerEvidence.providerResponseId, "resp_terminal_stop_fixture");
  const changed = clone(stop);
  changed.providerEvidence.providerResponseId = null;
  assert.throws(
    () => validatePreventureResearchTerminalStop(changed, {
      authority,
      assignments: assignments(),
      triggerAssignment: assignments()[0],
    }),
    (error) => error.code === "preventure_research_terminal_stop_invalid",
  );
});

test("terminal stops, skips, coverage, and next actions are deeply immutable", () => {
  const stop = createStop(0, "validated_evidence_shortfall");
  assert.equal(Object.isFrozen(stop), true);
  assert.equal(Object.isFrozen(stop.providerEvidence), true);
  assert.equal(Object.isFrozen(stop.actualCoverage), true);
  assert.equal(Object.isFrozen(stop.actualCoverage.comparatorCoverage), true);
  assert.equal(Object.isFrozen(stop.skippedAssignments), true);
  assert.equal(Object.isFrozen(stop.skippedAssignments[0]), true);
  assert.equal(Object.isFrozen(stop.nextEvidenceAction), true);
  assert.throws(() => { stop.actualCoverage.comparatorCoverage.complete = true; }, TypeError);
  assert.throws(() => { stop.skippedAssignments[0].taskAttemptCount = 1; }, TypeError);
  assert.throws(() => { stop.nextEvidenceAction.action = "changed"; }, TypeError);
});

test("caller-controlled skip suffixes and next actions cannot change server derivation", () => {
  const stop = createStop(0, "validated_evidence_shortfall");
  const rows = assignments();
  assert.throws(
    () => createPreventureResearchTerminalStop({
      authority,
      assignments: rows,
      triggerAssignment: rows[0],
      triggerOutcomeClass: stop.triggerOutcomeClass,
      providerEvidence: stop.providerEvidence,
      actualCoverage: stop.actualCoverage,
      gapCodes: stop.gapCodes,
      stoppedAt: STOPPED_AT,
      skippedAssignments: [],
    }),
    (error) => error.code === "preventure_research_terminal_stop_invalid",
  );
  assert.throws(
    () => createPreventureResearchTerminalStop({
      authority,
      assignments: rows,
      triggerAssignment: rows[0],
      triggerOutcomeClass: stop.triggerOutcomeClass,
      providerEvidence: stop.providerEvidence,
      actualCoverage: stop.actualCoverage,
      gapCodes: stop.gapCodes,
      stoppedAt: STOPPED_AT,
      nextEvidenceAction: { ...stop.nextEvidenceAction, action: "Caller-controlled action." },
    }),
    (error) => error.code === "preventure_research_terminal_stop_invalid",
  );
});
