const fs = require("node:fs");
const path = require("node:path");
const { createHash, randomUUID } = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");
const CONFIG = require("./config");
const { spendCostId } = require("./runtime/stable-id");
const {
  HISTORICAL_PREVENTURE_APPROVAL_DECISIONS,
} = require("./runtime/preventure-research-historical-approval-manifest");

const LATEST_SCHEMA_VERSION = 27;
let canonicalRecoverySchemaContractCache = null;
const preventureOwnerApprovalCapabilities = new WeakMap();
const preventureValidatedEarlyStopCapabilities = new WeakMap();
const preventureProviderCostReconciliationCapabilities = new WeakMap();
const RETIRED_PROVIDER_COST_RECONCILIATION_SENTINEL = Object.freeze(
  Object.create(null),
);
const preventureOwnerBillingObservationCapabilities = new WeakMap();
const preventureTerminalRetainedRecoveryCapabilities = new WeakMap();
const preventureTerminalReceiptCapabilities = new WeakMap();
const preventureEmergencyCostSafetyCapabilities = new WeakMap();
const SHA256_DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/;
const PREVENTURE_RESEARCH_COST_EVENT_SCHEMA = "pantheon.preventure-research-cost-event.v1";
const PREVENTURE_RESEARCH_EMERGENCY_COST_TRANSITION_SCHEMA =
  "pantheon.preventure-research-emergency-cost-transition.v1";

function sqliteTextLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

const HISTORICAL_PREVENTURE_APPROVAL_DECISION_SQL =
  HISTORICAL_PREVENTURE_APPROVAL_DECISIONS.map((entry) => `(
    decision_receipt_hash = ${sqliteTextLiteral(entry.receiptHash)}
    AND approval_id = ${sqliteTextLiteral(entry.approvalId)}
    AND authority_hash = ${sqliteTextLiteral(entry.authorityHash)}
    AND event_type = ${sqliteTextLiteral(entry.eventType)}
    AND scope_hash = ${sqliteTextLiteral(entry.scopeHash)}
    AND requested_by = ${sqliteTextLiteral(entry.requestedBy)}
    AND requested_at = ${sqliteTextLiteral(entry.requestedAt)}
    AND decided_by = ${sqliteTextLiteral(entry.decidedBy)}
    AND decision_source = ${sqliteTextLiteral(entry.decisionSource)}
    AND decision_status = ${sqliteTextLiteral(entry.decisionStatus)}
    AND decided_at = ${sqliteTextLiteral(entry.decidedAt)}
    AND created_at = ${sqliteTextLiteral(entry.createdAt)}
  )`).join(" OR ");

function canonicalCapabilityValue(value) {
  if (Array.isArray(value)) return value.map(canonicalCapabilityValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, canonicalCapabilityValue(value[key])]),
    );
  }
  return value ?? null;
}

function canonicalCapabilityJson(value) {
  return JSON.stringify(canonicalCapabilityValue(value));
}

function canonicalCapabilityHash(value) {
  return `sha256:${createHash("sha256")
    .update(Buffer.from(canonicalCapabilityJson(value), "utf8"))
    .digest("hex")}`;
}

function normalizePreventureOwnerApprovalCapability(binding) {
  const exactKeys = [
    "approvalId",
    "authorityHash",
    "eventType",
    "scopeHash",
    "decisionStatus",
    "decidedAt",
    "receiptHash",
  ];
  if (
    !binding
    || typeof binding !== "object"
    || Array.isArray(binding)
    || JSON.stringify(Object.keys(binding).sort()) !== JSON.stringify([...exactKeys].sort())
    || typeof binding.approvalId !== "string"
    || binding.approvalId.length < 1
    || binding.approvalId.length > 256
    || !SHA256_DIGEST_PATTERN.test(String(binding.authorityHash || ""))
    || !["accepted", "activated"].includes(binding.eventType)
    || !SHA256_DIGEST_PATTERN.test(String(binding.scopeHash || ""))
    || !["approved", "needs_changes", "rejected"].includes(binding.decisionStatus)
    || !Number.isFinite(Date.parse(binding.decidedAt))
    || !SHA256_DIGEST_PATTERN.test(String(binding.receiptHash || ""))
  ) {
    throw new Error("The pre-venture owner-session attestation capability binding is invalid.");
  }
  return Object.freeze({ ...binding });
}

function registerPreventureOwnerApprovalCapabilityFunction(db) {
  db.function("pantheon_preventure_owner_attestation_capability", (
    phaseValue,
    approvalIdValue,
    authorityHashValue,
    eventTypeValue,
    scopeHashValue,
    decisionStatusValue,
    decidedAtValue,
    receiptHashValue,
  ) => {
    const [
      phase,
      approvalId,
      authorityHash,
      eventType,
      scopeHash,
      decisionStatus,
      decidedAt,
      receiptHash,
    ] = [
      phaseValue,
      approvalIdValue,
      authorityHashValue,
      eventTypeValue,
      scopeHashValue,
      decisionStatusValue,
      decidedAtValue,
      receiptHashValue,
    ].map((value) => value === null || value === undefined ? null : String(value));
    const state = preventureOwnerApprovalCapabilities.get(db);
    if (!state) return 0;
    const expected = state.binding;
    if (
      approvalId !== expected.approvalId
      || authorityHash !== expected.authorityHash
      || eventType !== expected.eventType
      || scopeHash !== expected.scopeHash
      || decisionStatus !== expected.decisionStatus
      || decidedAt !== expected.decidedAt
    ) return 0;
    if (phase === "approval_update" && state.phase === "armed" && receiptHash === null) {
      state.phase = "approval_updated";
      return 1;
    }
    if (
      phase === "receipt_insert"
      && state.phase === "approval_updated"
      && receiptHash === expected.receiptHash
    ) {
      state.phase = "consumed";
      return 1;
    }
    return 0;
  });
}

function withPreventureOwnerApprovalCapability(db, binding, action) {
  if (!db || typeof db.prepare !== "function" || typeof action !== "function") {
    throw new Error("The pre-venture owner-session attestation requires one database action.");
  }
  if (preventureOwnerApprovalCapabilities.has(db)) {
    throw new Error("A pre-venture owner-session attestation is already in progress.");
  }
  const exactBinding = normalizePreventureOwnerApprovalCapability(binding);
  beginAtomic(db);
  preventureOwnerApprovalCapabilities.set(db, {
    binding: exactBinding,
    phase: "armed",
  });
  try {
    const result = action();
    if (result && typeof result.then === "function") {
      throw new Error("The pre-venture owner-session attestation action must be synchronous.");
    }
    const state = preventureOwnerApprovalCapabilities.get(db);
    if (!state || state.phase !== "consumed") {
      throw new Error(
        "The pre-venture owner-session attestation did not complete its exact approval and receipt pair.",
      );
    }
    preventureOwnerApprovalCapabilities.delete(db);
    commitAtomic(db);
    return result;
  } catch (error) {
    preventureOwnerApprovalCapabilities.delete(db);
    rollbackAtomic(db);
    throw error;
  } finally {
    preventureOwnerApprovalCapabilities.delete(db);
  }
}

function normalizePreventureValidatedEarlyStopCapability(binding) {
  const exactKeys = [
    "authorityHash",
    "earlyStopRecordHash",
    "decisionId",
    "completionEventId",
    "skippedAssignmentCount",
  ];
  if (
    !binding
    || typeof binding !== "object"
    || Array.isArray(binding)
    || JSON.stringify(Object.keys(binding).sort()) !== JSON.stringify([...exactKeys].sort())
    || !SHA256_DIGEST_PATTERN.test(String(binding.authorityHash || ""))
    || !SHA256_DIGEST_PATTERN.test(String(binding.earlyStopRecordHash || ""))
    || typeof binding.decisionId !== "string"
    || binding.decisionId.length < 1
    || binding.decisionId.length > 256
    || typeof binding.completionEventId !== "string"
    || binding.completionEventId.length < 1
    || binding.completionEventId.length > 256
    || !Number.isSafeInteger(binding.skippedAssignmentCount)
    || binding.skippedAssignmentCount < 0
    || binding.skippedAssignmentCount > 2
  ) {
    throw new Error("The validated early-stop database capability binding is invalid.");
  }
  return Object.freeze({ ...binding });
}

function registerPreventureValidatedEarlyStopCapabilityFunction(db) {
  db.function("pantheon_preventure_validated_early_stop_capability", (
    authorityHashValue,
    earlyStopRecordHashValue,
    decisionIdValue,
    completionEventIdValue,
    skippedAssignmentCountValue,
  ) => {
    const state = preventureValidatedEarlyStopCapabilities.get(db);
    if (!state || state.phase !== "armed") return 0;
    const actual = {
      authorityHash: String(authorityHashValue ?? ""),
      earlyStopRecordHash: String(earlyStopRecordHashValue ?? ""),
      decisionId: String(decisionIdValue ?? ""),
      completionEventId: String(completionEventIdValue ?? ""),
      skippedAssignmentCount: Number(skippedAssignmentCountValue),
    };
    if (
      actual.authorityHash !== state.binding.authorityHash
      || actual.earlyStopRecordHash !== state.binding.earlyStopRecordHash
      || actual.decisionId !== state.binding.decisionId
      || actual.completionEventId !== state.binding.completionEventId
      || actual.skippedAssignmentCount !== state.binding.skippedAssignmentCount
    ) return 0;
    state.phase = "consumed";
    return 1;
  });
}

function withPreventureValidatedEarlyStopCapability(db, binding, action) {
  if (!db || typeof db.prepare !== "function" || typeof action !== "function") {
    throw new Error("A validated early stop requires one exact synchronous database action.");
  }
  if (preventureValidatedEarlyStopCapabilities.has(db)) {
    throw new Error("A validated early-stop database action is already in progress.");
  }
  const exactBinding = normalizePreventureValidatedEarlyStopCapability(binding);
  beginAtomic(db);
  preventureValidatedEarlyStopCapabilities.set(db, {
    binding: exactBinding,
    phase: "armed",
  });
  try {
    const result = action();
    if (result && typeof result.then === "function") {
      throw new Error("The validated early-stop database action must be synchronous.");
    }
    const state = preventureValidatedEarlyStopCapabilities.get(db);
    const stop = db.prepare(
      `SELECT expected_decision_id, expected_completion_event_id
       FROM preventure_research_terminal_stops
       WHERE authority_hash = ? AND early_stop_record_hash = ?`,
    ).get(exactBinding.authorityHash, exactBinding.earlyStopRecordHash);
    const decision = db.prepare(
      `SELECT completion_mode, early_stop_record_hash
       FROM preventure_research_decisions
       WHERE authority_hash = ? AND decision_id = ?`,
    ).get(exactBinding.authorityHash, exactBinding.decisionId);
    const completion = db.prepare(
      `SELECT event_type FROM preventure_research_lifecycle_events
       WHERE authority_hash = ? AND id = ?`,
    ).get(exactBinding.authorityHash, exactBinding.completionEventId);
    const skippedCount = Number(db.prepare(
      `SELECT COUNT(*) AS count FROM preventure_research_assignment_skips
       WHERE authority_hash = ?`,
    ).get(exactBinding.authorityHash).count);
    if (
      !state
      || state.phase !== "consumed"
      || stop?.expected_decision_id !== exactBinding.decisionId
      || stop?.expected_completion_event_id !== exactBinding.completionEventId
      || decision?.completion_mode !== "validated_early_stop"
      || decision?.early_stop_record_hash !== exactBinding.earlyStopRecordHash
      || completion?.event_type !== "completed"
      || skippedCount !== exactBinding.skippedAssignmentCount
    ) {
      throw new Error(
        "The validated early stop did not atomically persist its exact stop, suffix, decision, and completion.",
      );
    }
    preventureValidatedEarlyStopCapabilities.delete(db);
    commitAtomic(db);
    return result;
  } catch (error) {
    preventureValidatedEarlyStopCapabilities.delete(db);
    rollbackAtomic(db);
    throw error;
  } finally {
    preventureValidatedEarlyStopCapabilities.delete(db);
  }
}

function normalizePreventureProviderCostReconciliationCapability(binding) {
  const exactKeys = [
    "authorityHash",
    "assignmentHash",
    "decisionHash",
    "costKey",
    "expectedPreviousReceiptHash",
    "reconciledReceiptHash",
    "taskAttemptId",
    "modelCallId",
    "agentRunReceiptId",
    "budgetReservationId",
    "costId",
    "amountAudCents",
    "occurredAt",
  ];
  const safeId = (value, maximum = 256) => (
    typeof value === "string"
    && value.length >= 1
    && value.length <= maximum
    && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value)
  );
  if (
    !binding
    || typeof binding !== "object"
    || Array.isArray(binding)
    || JSON.stringify(Object.keys(binding).sort()) !== JSON.stringify([...exactKeys].sort())
    || !SHA256_DIGEST_PATTERN.test(String(binding.authorityHash || ""))
    || !SHA256_DIGEST_PATTERN.test(String(binding.assignmentHash || ""))
    || !SHA256_DIGEST_PATTERN.test(String(binding.decisionHash || ""))
    || !safeId(binding.costKey, 128)
    || !SHA256_DIGEST_PATTERN.test(String(binding.expectedPreviousReceiptHash || ""))
    || !SHA256_DIGEST_PATTERN.test(String(binding.reconciledReceiptHash || ""))
    || !safeId(binding.taskAttemptId)
    || !safeId(binding.modelCallId)
    || !safeId(binding.agentRunReceiptId)
    || !safeId(binding.budgetReservationId)
    || !safeId(binding.costId)
    || !Number.isSafeInteger(binding.amountAudCents)
    || binding.amountAudCents < 0
    || !Number.isFinite(Date.parse(binding.occurredAt))
  ) {
    throw new Error("The pre-venture provider-cost reconciliation capability binding is invalid.");
  }
  return Object.freeze({ ...binding });
}

function registerPreventureProviderCostReconciliationCapabilityFunction(db) {
  db.function("pantheon_preventure_provider_cost_reconciliation_capability", (
    phaseValue,
    authorityHashValue,
    assignmentHashValue,
    decisionHashValue,
    objectIdValue,
    receiptHashValue,
    previousReceiptHashValue,
    amountAudCentsValue,
    occurredAtValue,
  ) => {
    const state = preventureProviderCostReconciliationCapabilities.get(db);
    if (!state) return 0;
    const phase = String(phaseValue ?? "");
    const expected = state.binding;
    const actual = {
      authorityHash: String(authorityHashValue ?? ""),
      assignmentHash: String(assignmentHashValue ?? ""),
      decisionHash: String(decisionHashValue ?? ""),
      objectId: String(objectIdValue ?? ""),
      receiptHash: String(receiptHashValue ?? ""),
      previousReceiptHash: String(previousReceiptHashValue ?? ""),
      amountAudCents: Number(amountAudCentsValue),
      occurredAt: String(occurredAtValue ?? ""),
    };
    if (
      actual.authorityHash !== expected.authorityHash
      || actual.assignmentHash !== expected.assignmentHash
      || actual.decisionHash !== expected.decisionHash
      || actual.receiptHash !== expected.reconciledReceiptHash
      || actual.previousReceiptHash !== expected.expectedPreviousReceiptHash
      || actual.amountAudCents !== expected.amountAudCents
      || actual.occurredAt !== expected.occurredAt
    ) return 0;
    const transitions = {
      cost_event_insert: ["armed", "cost_event_inserted", expected.costId],
      reservation_update: ["cost_event_inserted", "reservation_updated", expected.budgetReservationId],
      cost_update: ["reservation_updated", "cost_updated", expected.costId],
      model_call_update: ["cost_updated", "consumed", expected.modelCallId],
    };
    const transition = transitions[phase];
    if (!transition || state.phase !== transition[0] || actual.objectId !== transition[2]) return 0;
    state.phase = transition[1];
    return 1;
  });
}

function withPreventureProviderCostReconciliationCapability(db, binding, action) {
  if (binding !== RETIRED_PROVIDER_COST_RECONCILIATION_SENTINEL) {
    throw new Error(
      "Provider-cost reconciliation is retired; use an authenticated owner billing observation.",
    );
  }
  if (!db || typeof db.prepare !== "function" || typeof action !== "function") {
    throw new Error("Provider-cost reconciliation requires one exact synchronous database action.");
  }
  if (preventureProviderCostReconciliationCapabilities.has(db)) {
    throw new Error("A pre-venture provider-cost reconciliation is already in progress.");
  }
  const exactBinding = normalizePreventureProviderCostReconciliationCapability(binding);
  beginAtomic(db);
  preventureProviderCostReconciliationCapabilities.set(db, {
    binding: exactBinding,
    phase: "armed",
  });
  try {
    const result = action();
    if (result && typeof result.then === "function") {
      throw new Error("Provider-cost reconciliation must be synchronous.");
    }
    const state = preventureProviderCostReconciliationCapabilities.get(db);
    const costEvent = db.prepare(
      `SELECT authority_hash, assignment_hash, cost_key, previous_receipt_hash,
              event_type, amount_aud_cents, exposure_aud_cents,
              task_attempt_id, model_call_id, budget_reservation_id, cost_id,
              agent_run_receipt_id, occurred_at
       FROM preventure_research_cost_events WHERE receipt_hash = ?`,
    ).get(exactBinding.reconciledReceiptHash);
    const decision = db.prepare(
      `SELECT decision_hash FROM preventure_research_decisions
       WHERE authority_hash = ?`,
    ).get(exactBinding.authorityHash);
    const reservation = db.prepare(
      `SELECT task_id, status, amount_cents, currency, resolved_at
       FROM budget_reservations WHERE id = ?`,
    ).get(exactBinding.budgetReservationId);
    const cost = db.prepare(
      `SELECT task_id, model_call_id, status, amount_cents, currency, occurred_at
       FROM costs WHERE id = ?`,
    ).get(exactBinding.costId);
    const modelCall = db.prepare(
      `SELECT task_id, cost_status, actual_cost_cents, reconciled_cost_cents
       FROM model_calls WHERE id = ?`,
    ).get(exactBinding.modelCallId);
    const assignment = db.prepare(
      `SELECT task_id FROM preventure_research_assignments
       WHERE authority_hash = ? AND assignment_hash = ?`,
    ).get(exactBinding.authorityHash, exactBinding.assignmentHash);
    if (
      !state
      || state.phase !== "consumed"
      || decision?.decision_hash !== exactBinding.decisionHash
      || !assignment
      || costEvent?.authority_hash !== exactBinding.authorityHash
      || costEvent?.assignment_hash !== exactBinding.assignmentHash
      || costEvent?.cost_key !== exactBinding.costKey
      || costEvent?.previous_receipt_hash !== exactBinding.expectedPreviousReceiptHash
      || costEvent?.event_type !== "reconciled"
      || Number(costEvent?.amount_aud_cents) !== exactBinding.amountAudCents
      || Number(costEvent?.exposure_aud_cents) !== exactBinding.amountAudCents
      || costEvent?.task_attempt_id !== exactBinding.taskAttemptId
      || costEvent?.model_call_id !== exactBinding.modelCallId
      || costEvent?.budget_reservation_id !== exactBinding.budgetReservationId
      || costEvent?.cost_id !== exactBinding.costId
      || costEvent?.agent_run_receipt_id !== exactBinding.agentRunReceiptId
      || costEvent?.occurred_at !== exactBinding.occurredAt
      || reservation?.task_id !== assignment.task_id
      || reservation?.status !== "reconciled"
      || Number(reservation?.amount_cents) !== exactBinding.amountAudCents
      || reservation?.currency !== "AUD"
      || reservation?.resolved_at !== exactBinding.occurredAt
      || cost?.task_id !== assignment.task_id
      || cost?.model_call_id !== exactBinding.modelCallId
      || cost?.status !== "reconciled"
      || Number(cost?.amount_cents) !== exactBinding.amountAudCents
      || cost?.currency !== "AUD"
      || cost?.occurred_at !== exactBinding.occurredAt
      || modelCall?.task_id !== assignment.task_id
      || modelCall?.cost_status !== "reconciled"
      || Number(modelCall?.actual_cost_cents) !== exactBinding.amountAudCents
      || Number(modelCall?.reconciled_cost_cents) !== exactBinding.amountAudCents
    ) {
      throw new Error(
        "Provider-cost reconciliation did not atomically persist its exact receipt and projections.",
      );
    }
    preventureProviderCostReconciliationCapabilities.delete(db);
    commitAtomic(db);
    return result;
  } catch (error) {
    preventureProviderCostReconciliationCapabilities.delete(db);
    rollbackAtomic(db);
    throw error;
  } finally {
    preventureProviderCostReconciliationCapabilities.delete(db);
  }
}

function normalizePreventureOwnerBillingObservationCapability(binding) {
  const exactKeys = [
    "authorityHash",
    "assignmentHash",
    "observationHash",
    "observationJson",
    "costKey",
    "expectedPreviousReceiptHash",
    "reconciledReceiptHash",
    "taskAttemptId",
    "modelCallId",
    "agentRunReceiptId",
    "budgetReservationId",
    "costId",
    "amountAudCents",
    "originalCostOccurredAt",
    "recordedAt",
    "reservationMetadata",
    "costMetadata",
    "modelCallMetadata",
  ];
  const safeId = (value, maximum = 256) => (
    typeof value === "string"
    && value.length >= 1
    && value.length <= maximum
    && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value)
  );
  const exactJson = (value) => {
    if (typeof value !== "string") return false;
    try {
      return canonicalCapabilityJson(JSON.parse(value)) === value;
    } catch {
      return false;
    }
  };
  if (
    !binding
    || typeof binding !== "object"
    || Array.isArray(binding)
    || JSON.stringify(Object.keys(binding).sort()) !== JSON.stringify([...exactKeys].sort())
    || !SHA256_DIGEST_PATTERN.test(String(binding.authorityHash || ""))
    || !SHA256_DIGEST_PATTERN.test(String(binding.assignmentHash || ""))
    || !SHA256_DIGEST_PATTERN.test(String(binding.observationHash || ""))
    || !exactJson(binding.observationJson)
    || !safeId(binding.costKey, 128)
    || !SHA256_DIGEST_PATTERN.test(String(binding.expectedPreviousReceiptHash || ""))
    || !SHA256_DIGEST_PATTERN.test(String(binding.reconciledReceiptHash || ""))
    || !safeId(binding.taskAttemptId)
    || !safeId(binding.modelCallId)
    || !safeId(binding.agentRunReceiptId)
    || !safeId(binding.budgetReservationId)
    || !safeId(binding.costId)
    || !Number.isSafeInteger(binding.amountAudCents)
    || binding.amountAudCents < 0
    || !Number.isFinite(Date.parse(binding.originalCostOccurredAt))
    || !Number.isFinite(Date.parse(binding.recordedAt))
    || !exactJson(binding.reservationMetadata)
    || !exactJson(binding.costMetadata)
    || !exactJson(binding.modelCallMetadata)
  ) {
    throw new Error("The owner-attested provider billing observation capability binding is invalid.");
  }
  return Object.freeze({ ...binding });
}

function registerPreventureOwnerBillingObservationCapabilityFunction(db) {
  db.function("pantheon_preventure_owner_billing_observation_capability", (
    phaseValue,
    authorityHashValue,
    assignmentHashValue,
    objectIdValue,
    observationHashValue,
    receiptHashValue,
    previousReceiptHashValue,
    amountAudCentsValue,
    occurredAtValue,
    jsonValue,
  ) => {
    const state = preventureOwnerBillingObservationCapabilities.get(db);
    if (!state) return 0;
    const phase = String(phaseValue ?? "");
    const actual = {
      authorityHash: String(authorityHashValue ?? ""),
      assignmentHash: String(assignmentHashValue ?? ""),
      objectId: String(objectIdValue ?? ""),
      observationHash: String(observationHashValue ?? ""),
      receiptHash: receiptHashValue === null || receiptHashValue === undefined
        ? null
        : String(receiptHashValue),
      previousReceiptHash: previousReceiptHashValue === null || previousReceiptHashValue === undefined
        ? null
        : String(previousReceiptHashValue),
      amountAudCents: Number(amountAudCentsValue),
      occurredAt: String(occurredAtValue ?? ""),
      json: String(jsonValue ?? ""),
    };
    const expected = state.binding;
    if (
      actual.authorityHash !== expected.authorityHash
      || actual.assignmentHash !== expected.assignmentHash
      || actual.observationHash !== expected.observationHash
      || actual.amountAudCents !== expected.amountAudCents
    ) return 0;
    const matches = {
      observation_insert: actual.objectId === expected.observationHash
        && actual.receiptHash === null
        && actual.previousReceiptHash === null
        && actual.occurredAt === expected.recordedAt
        && actual.json === expected.observationJson,
      cost_event_insert: actual.objectId === expected.costId
        && actual.receiptHash === expected.reconciledReceiptHash
        && actual.previousReceiptHash === expected.expectedPreviousReceiptHash
        && actual.occurredAt === expected.originalCostOccurredAt,
      reservation_update: actual.objectId === expected.budgetReservationId
        && actual.receiptHash === expected.reconciledReceiptHash
        && actual.previousReceiptHash === expected.expectedPreviousReceiptHash
        && actual.occurredAt === expected.recordedAt
        && actual.json === expected.reservationMetadata,
      cost_update: actual.objectId === expected.costId
        && actual.receiptHash === expected.reconciledReceiptHash
        && actual.previousReceiptHash === expected.expectedPreviousReceiptHash
        && actual.occurredAt === expected.originalCostOccurredAt
        && actual.json === expected.costMetadata,
      model_call_update: actual.objectId === expected.modelCallId
        && actual.receiptHash === expected.reconciledReceiptHash
        && actual.previousReceiptHash === expected.expectedPreviousReceiptHash
        && actual.occurredAt === expected.recordedAt
        && actual.json === expected.modelCallMetadata,
    };
    const guardedPhase = phase.startsWith("guard_") ? phase.slice(6) : phase;
    if (!matches[guardedPhase]) return 0;
    if (phase.startsWith("guard_")) return 1;
    const transitions = {
      observation_insert: ["armed", "observation_inserted"],
      cost_event_insert: ["observation_inserted", "cost_event_inserted"],
      reservation_update: ["cost_event_inserted", "reservation_updated"],
      cost_update: ["reservation_updated", "cost_updated"],
      model_call_update: ["cost_updated", "consumed"],
    };
    const transition = transitions[phase];
    if (!transition || state.phase !== transition[0]) return 0;
    state.phase = transition[1];
    return 1;
  });
}

function withPreventureOwnerBillingObservationCapability(db, binding, action) {
  if (!db || typeof db.prepare !== "function" || typeof action !== "function") {
    throw new Error("Owner-attested provider billing requires one exact synchronous database action.");
  }
  if (preventureOwnerBillingObservationCapabilities.has(db)) {
    throw new Error("An owner-attested provider billing observation is already in progress.");
  }
  const exactBinding = normalizePreventureOwnerBillingObservationCapability(binding);
  beginAtomic(db);
  preventureOwnerBillingObservationCapabilities.set(db, {
    binding: exactBinding,
    phase: "armed",
  });
  try {
    const result = action();
    if (result && typeof result.then === "function") {
      throw new Error("Owner-attested provider billing must be synchronous.");
    }
    const state = preventureOwnerBillingObservationCapabilities.get(db);
    const observation = db.prepare(
      `SELECT * FROM preventure_research_provider_billing_observations
       WHERE observation_hash = ?`,
    ).get(exactBinding.observationHash);
    const costEvent = db.prepare(
      `SELECT * FROM preventure_research_cost_events WHERE receipt_hash = ?`,
    ).get(exactBinding.reconciledReceiptHash);
    const reservation = db.prepare(
      `SELECT * FROM budget_reservations WHERE id = ?`,
    ).get(exactBinding.budgetReservationId);
    const cost = db.prepare(
      `SELECT * FROM costs WHERE id = ?`,
    ).get(exactBinding.costId);
    const modelCall = db.prepare(
      `SELECT * FROM model_calls WHERE id = ?`,
    ).get(exactBinding.modelCallId);
    if (
      !state
      || state.phase !== "consumed"
      || observation?.authority_hash !== exactBinding.authorityHash
      || observation?.assignment_hash !== exactBinding.assignmentHash
      || observation?.observation_json !== exactBinding.observationJson
      || observation?.expected_previous_receipt_hash
        !== exactBinding.expectedPreviousReceiptHash
      || Number(observation?.amount_aud_cents) !== exactBinding.amountAudCents
      || observation?.original_cost_occurred_at !== exactBinding.originalCostOccurredAt
      || observation?.recorded_at !== exactBinding.recordedAt
      || costEvent?.authority_hash !== exactBinding.authorityHash
      || costEvent?.assignment_hash !== exactBinding.assignmentHash
      || costEvent?.cost_key !== exactBinding.costKey
      || costEvent?.previous_receipt_hash !== exactBinding.expectedPreviousReceiptHash
      || costEvent?.event_type !== "reconciled"
      || Number(costEvent?.amount_aud_cents) !== exactBinding.amountAudCents
      || Number(costEvent?.exposure_aud_cents) !== exactBinding.amountAudCents
      || costEvent?.task_attempt_id !== exactBinding.taskAttemptId
      || costEvent?.model_call_id !== exactBinding.modelCallId
      || costEvent?.budget_reservation_id !== exactBinding.budgetReservationId
      || costEvent?.cost_id !== exactBinding.costId
      || costEvent?.agent_run_receipt_id !== exactBinding.agentRunReceiptId
      || costEvent?.occurred_at !== exactBinding.originalCostOccurredAt
      || reservation?.status !== "reconciled"
      || Number(reservation?.amount_cents) !== exactBinding.amountAudCents
      || reservation?.currency !== "AUD"
      || reservation?.resolved_at !== exactBinding.recordedAt
      || reservation?.metadata !== exactBinding.reservationMetadata
      || cost?.model_call_id !== exactBinding.modelCallId
      || cost?.status !== "reconciled"
      || Number(cost?.amount_cents) !== exactBinding.amountAudCents
      || cost?.currency !== "AUD"
      || cost?.occurred_at !== exactBinding.originalCostOccurredAt
      || cost?.metadata !== exactBinding.costMetadata
      || modelCall?.cost_status !== "reconciled"
      || Number(modelCall?.actual_cost_cents) !== exactBinding.amountAudCents
      || Number(modelCall?.reconciled_cost_cents) !== exactBinding.amountAudCents
      || modelCall?.metadata !== exactBinding.modelCallMetadata
    ) {
      throw new Error(
        "Owner-attested provider billing did not atomically persist its observation, receipt, and projections.",
      );
    }
    preventureOwnerBillingObservationCapabilities.delete(db);
    commitAtomic(db);
    return result;
  } catch (error) {
    preventureOwnerBillingObservationCapabilities.delete(db);
    rollbackAtomic(db);
    throw error;
  } finally {
    preventureOwnerBillingObservationCapabilities.delete(db);
  }
}

function normalizePreventureTerminalRetainedRecoveryCapability(binding) {
  const exactKeys = [
    "authorityHash",
    "assignmentHash",
    "recoveryIntentHash",
    "recoveryHash",
    "taskAttemptId",
    "modelCallId",
    "terminalKind",
    "terminalRecordId",
    "terminalEventHash",
    "artifactHash",
    "priorCostReceiptHash",
    "terminalCostReceiptHash",
    "budgetReservationId",
    "costId",
    "assignmentCapAudCents",
    "appendUnknownCost",
    "recoveryJson",
    "recordedAt",
  ];
  const safeId = (value, maximum = 256) => (
    typeof value === "string"
    && value.length >= 1
    && value.length <= maximum
    && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value)
  );
  if (
    !binding
    || typeof binding !== "object"
    || Array.isArray(binding)
    || JSON.stringify(Object.keys(binding).sort()) !== JSON.stringify([...exactKeys].sort())
    || !SHA256_DIGEST_PATTERN.test(String(binding.authorityHash || ""))
    || !SHA256_DIGEST_PATTERN.test(String(binding.assignmentHash || ""))
    || !SHA256_DIGEST_PATTERN.test(String(binding.recoveryIntentHash || ""))
    || !SHA256_DIGEST_PATTERN.test(String(binding.recoveryHash || ""))
    || !safeId(binding.taskAttemptId)
    || !safeId(binding.modelCallId)
    || !["lifecycle", "runtime_emergency_stop"].includes(binding.terminalKind)
    || !safeId(String(binding.terminalRecordId || ""))
    || !SHA256_DIGEST_PATTERN.test(String(binding.terminalEventHash || ""))
    || !SHA256_DIGEST_PATTERN.test(String(binding.artifactHash || ""))
    || !SHA256_DIGEST_PATTERN.test(String(binding.priorCostReceiptHash || ""))
    || !SHA256_DIGEST_PATTERN.test(String(binding.terminalCostReceiptHash || ""))
    || !safeId(binding.budgetReservationId)
    || !safeId(binding.costId)
    || !Number.isSafeInteger(binding.assignmentCapAudCents)
    || binding.assignmentCapAudCents < 0
    || typeof binding.appendUnknownCost !== "boolean"
    || typeof binding.recoveryJson !== "string"
    || binding.recoveryJson.length < 2
    || binding.recoveryJson.length > 262144
    || !Number.isFinite(Date.parse(binding.recordedAt))
  ) {
    throw new Error("The terminal retained-output recovery capability binding is invalid.");
  }
  return Object.freeze({ ...binding });
}

function registerPreventureTerminalRetainedRecoveryCapabilityFunction(db) {
  db.function("pantheon_preventure_terminal_retained_recovery_capability", (
    phaseValue,
    authorityHashValue,
    assignmentHashValue,
    recoveryHashValue,
    objectIdValue,
    receiptHashValue,
    previousReceiptHashValue,
    terminalKindValue,
    terminalRecordIdValue,
    terminalEventHashValue,
    artifactHashValue,
    assignmentCapAudCentsValue,
    recoveryJsonValue,
    recordedAtValue,
  ) => {
    const state = preventureTerminalRetainedRecoveryCapabilities.get(db);
    if (!state) return 0;
    const phase = String(phaseValue ?? "");
    const expected = state.binding;
    const actual = {
      authorityHash: String(authorityHashValue ?? ""),
      assignmentHash: String(assignmentHashValue ?? ""),
      recoveryHash: String(recoveryHashValue ?? ""),
      objectId: String(objectIdValue ?? ""),
      receiptHash: String(receiptHashValue ?? ""),
      previousReceiptHash: String(previousReceiptHashValue ?? ""),
      terminalKind: String(terminalKindValue ?? ""),
      terminalRecordId: String(terminalRecordIdValue ?? ""),
      terminalEventHash: String(terminalEventHashValue ?? ""),
      artifactHash: String(artifactHashValue ?? ""),
      assignmentCapAudCents: Number(assignmentCapAudCentsValue),
      recoveryJson: recoveryJsonValue === null || recoveryJsonValue === undefined
        ? null
        : String(recoveryJsonValue),
      recordedAt: String(recordedAtValue ?? ""),
    };
    if (
      actual.authorityHash !== expected.authorityHash
      || actual.assignmentHash !== expected.assignmentHash
      || actual.recoveryHash !== (phase === "recovery_insert"
        ? expected.recoveryHash
        : expected.recoveryIntentHash)
      || actual.terminalKind !== expected.terminalKind
      || actual.terminalRecordId !== expected.terminalRecordId
      || actual.terminalEventHash !== expected.terminalEventHash
      || actual.artifactHash !== expected.artifactHash
      || actual.assignmentCapAudCents !== expected.assignmentCapAudCents
      || actual.recordedAt !== expected.recordedAt
    ) return 0;
    const transitions = expected.appendUnknownCost
      ? {
        cost_update: [
          "armed",
          "cost_updated",
          expected.costId,
          expected.terminalCostReceiptHash,
          expected.priorCostReceiptHash,
        ],
        cost_event_insert: [
          "cost_updated",
          "cost_event_inserted",
          expected.costId,
          expected.terminalCostReceiptHash,
          expected.priorCostReceiptHash,
        ],
        reservation_update: [
          "cost_event_inserted",
          "reservation_updated",
          expected.budgetReservationId,
          expected.terminalCostReceiptHash,
          expected.priorCostReceiptHash,
        ],
        model_call_update: [
          "reservation_updated",
          "model_call_updated",
          expected.modelCallId,
          expected.terminalCostReceiptHash,
          expected.priorCostReceiptHash,
        ],
        recovery_insert: [
          "model_call_updated",
          "consumed",
          expected.taskAttemptId,
          expected.terminalCostReceiptHash,
          expected.priorCostReceiptHash,
        ],
      }
      : {
        recovery_insert: [
          "armed",
          "consumed",
          expected.taskAttemptId,
          expected.terminalCostReceiptHash,
          expected.priorCostReceiptHash,
        ],
      };
    const transition = transitions[phase];
    if (
      !transition
      || state.phase !== transition[0]
      || actual.objectId !== transition[2]
      || actual.receiptHash !== transition[3]
      || actual.previousReceiptHash !== transition[4]
      || (phase === "recovery_insert"
        ? actual.recoveryJson !== expected.recoveryJson
        : actual.recoveryJson !== null)
    ) return 0;
    state.phase = transition[1];
    return 1;
  });
}

function withPreventureTerminalRetainedRecoveryCapability(db, binding, action) {
  if (!db || typeof db.prepare !== "function" || typeof action !== "function") {
    throw new Error("Terminal retained-output recovery requires one synchronous database action.");
  }
  if (preventureTerminalRetainedRecoveryCapabilities.has(db)) {
    throw new Error("A terminal retained-output recovery action is already in progress.");
  }
  const exactBinding = normalizePreventureTerminalRetainedRecoveryCapability(binding);
  beginAtomic(db);
  preventureTerminalRetainedRecoveryCapabilities.set(db, {
    binding: exactBinding,
    phase: "armed",
  });
  try {
    const result = action();
    if (result && typeof result.then === "function") {
      throw new Error("Terminal retained-output recovery must be synchronous.");
    }
    const state = preventureTerminalRetainedRecoveryCapabilities.get(db);
    const row = db.prepare(
      `SELECT recovery_intent_hash, authority_hash, assignment_hash, task_id, workflow_id,
              task_attempt_id, model_call_id,
              terminal_kind, terminal_record_id, terminal_event_hash,
              artifact_hash, prior_cost_receipt_hash, terminal_cost_receipt_hash,
              budget_reservation_id, cost_id, assignment_cap_aud_cents,
              recovery_json, recorded_at
       FROM preventure_research_terminal_recoveries WHERE recovery_hash = ?`,
    ).get(exactBinding.recoveryHash);
    const terminalCost = db.prepare(
      `SELECT event_type, amount_aud_cents, exposure_aud_cents,
              task_attempt_id, model_call_id, budget_reservation_id, cost_id,
              agent_run_receipt_id
       FROM preventure_research_cost_events WHERE receipt_hash = ?`,
    ).get(exactBinding.terminalCostReceiptHash);
    const reservation = db.prepare(
      "SELECT status, amount_cents FROM budget_reservations WHERE id = ?",
    ).get(exactBinding.budgetReservationId);
    const cost = db.prepare(
      "SELECT status, amount_cents, model_call_id FROM costs WHERE id = ?",
    ).get(exactBinding.costId);
    const recovery = row ? fromJson(row.recovery_json, null) : null;
    const closure = recovery?.executionClosure || null;
    const closureJson = closure ? JSON.stringify(closure) : null;
    const exactClosureMarker = (value) => {
      const marker = fromJson(value, {}).terminalRetainedExecution;
      return marker && JSON.stringify(marker) === closureJson;
    };
    const modelCall = db.prepare(
      `SELECT * FROM model_calls WHERE id = ?`,
    ).get(exactBinding.modelCallId);
    const task = row ? db.prepare(
      "SELECT * FROM tasks WHERE id = ?",
    ).get(row.task_id) : null;
    const attempt = db.prepare(
      "SELECT * FROM task_attempts WHERE id = ?",
    ).get(exactBinding.taskAttemptId);
    const agentRun = closure?.agentRunId
      ? db.prepare("SELECT * FROM agent_runs WHERE id = ?").get(closure.agentRunId)
      : null;
    const tool = closure?.toolInvocationId
      ? db.prepare("SELECT * FROM agent_tool_invocations WHERE id = ?").get(
        closure.toolInvocationId,
      )
      : null;
    const workflow = row ? db.prepare(
      "SELECT * FROM workflows WHERE id = ?",
    ).get(row.workflow_id) : null;
    const receipt = recovery?.executionReceipt?.id
      ? db.prepare("SELECT * FROM agent_run_receipts WHERE id = ?").get(
        recovery.executionReceipt.id,
      )
      : null;
    const latestReceipt = db.prepare(
      `SELECT * FROM agent_run_receipts WHERE attempt_id = ?
       ORDER BY sequence DESC, created_at DESC, id DESC LIMIT 1`,
    ).get(exactBinding.taskAttemptId);
    const expectedOutcome = recovery?.retainedArtifact?.artifactKind === "canonical_known_response"
      ? "known"
      : recovery?.retainedArtifact?.artifactKind;
    const expectedErrorKind = recovery?.terminalBinding?.kind === "runtime_emergency_stop"
      ? "operator_emergency_stop"
      : "terminal_retained_output_custody";
    const siblingClosureOk = Boolean(closure) && closure.siblingClosures.every((sibling) => {
      const siblingTask = db.prepare("SELECT * FROM tasks WHERE id = ?").get(sibling.taskId);
      const activity = db.prepare(
        `SELECT
           (SELECT COUNT(*) FROM task_attempts WHERE task_id = ?) +
           (SELECT COUNT(*) FROM model_calls WHERE task_id = ?) +
           (SELECT COUNT(*) FROM agent_runs WHERE task_id = ?) +
           (SELECT COUNT(*) FROM agent_run_receipts WHERE task_id = ?) +
           (SELECT COUNT(*) FROM agent_tool_invocations WHERE task_id = ?) +
           (SELECT COUNT(*) FROM budget_reservations WHERE task_id = ?) +
           (SELECT COUNT(*) FROM costs WHERE task_id = ?) +
           (SELECT COUNT(*) FROM preventure_research_cost_events WHERE assignment_hash = ?) +
           (SELECT COUNT(*) FROM preventure_research_source_snapshots WHERE assignment_hash = ?) +
           (SELECT COUNT(*) FROM preventure_research_evidence_records WHERE assignment_hash = ?)
           AS count`,
      ).get(
        sibling.taskId,
        sibling.taskId,
        sibling.taskId,
        sibling.taskId,
        sibling.taskId,
        sibling.taskId,
        sibling.taskId,
        sibling.assignmentHash,
        sibling.assignmentHash,
        sibling.assignmentHash,
      );
      return siblingTask?.status === "cancelled"
        && siblingTask.outcome_status === "cancelled_by_terminal_authority_custody"
        && siblingTask.claim_token === null
        && siblingTask.claimed_at === null
        && Number(siblingTask.attempt_count) === 0
        && Number(siblingTask.max_retries) === 0
        && siblingTask.completed_at === closure.closedAt
        && siblingTask.updated_at === closure.closedAt
        && exactClosureMarker(siblingTask.result)
        && Number(activity.count) === 0;
    });
    if (
      !state
      || state.phase !== "consumed"
      || row?.recovery_intent_hash !== exactBinding.recoveryIntentHash
      || row?.authority_hash !== exactBinding.authorityHash
      || row?.assignment_hash !== exactBinding.assignmentHash
      || row?.task_attempt_id !== exactBinding.taskAttemptId
      || row?.model_call_id !== exactBinding.modelCallId
      || row?.terminal_kind !== exactBinding.terminalKind
      || String(row?.terminal_record_id ?? "") !== exactBinding.terminalRecordId
      || row?.terminal_event_hash !== exactBinding.terminalEventHash
      || row?.artifact_hash !== exactBinding.artifactHash
      || row?.prior_cost_receipt_hash !== exactBinding.priorCostReceiptHash
      || row?.terminal_cost_receipt_hash !== exactBinding.terminalCostReceiptHash
      || row?.budget_reservation_id !== exactBinding.budgetReservationId
      || row?.cost_id !== exactBinding.costId
      || Number(row?.assignment_cap_aud_cents) !== exactBinding.assignmentCapAudCents
      || row?.recovery_json !== exactBinding.recoveryJson
      || row?.recorded_at !== exactBinding.recordedAt
      || terminalCost?.event_type !== "unknown"
      || terminalCost?.amount_aud_cents !== null
      || Number(terminalCost?.exposure_aud_cents) !== exactBinding.assignmentCapAudCents
      || terminalCost?.task_attempt_id !== exactBinding.taskAttemptId
      || terminalCost?.model_call_id !== exactBinding.modelCallId
      || terminalCost?.budget_reservation_id !== exactBinding.budgetReservationId
      || terminalCost?.cost_id !== exactBinding.costId
      || terminalCost?.agent_run_receipt_id !== recovery?.executionReceipt?.id
      || reservation?.status !== "unknown"
      || Number(reservation?.amount_cents) !== exactBinding.assignmentCapAudCents
      || cost?.status !== "unknown"
      || Number(cost?.amount_cents) !== exactBinding.assignmentCapAudCents
      || cost?.model_call_id !== exactBinding.modelCallId
      || modelCall?.cost_status !== "unknown"
      || modelCall?.status !== "needs_attention"
      || modelCall?.outcome_status !== expectedOutcome
      || modelCall?.provider_request_id !== recovery?.originalDispatch?.providerRequestId
      || modelCall?.error_kind !== expectedErrorKind
      || modelCall?.completed_at !== closure?.closedAt
      || Number(modelCall?.reserved_cost_cents) !== exactBinding.assignmentCapAudCents
      || Number(modelCall?.actual_cost_cents) !== 0
      || Number(modelCall?.reconciled_cost_cents) !== 0
      || !exactClosureMarker(modelCall?.metadata)
      || task?.status !== "needs_attention"
      || task?.outcome_status !== expectedOutcome
      || task?.claim_token !== null
      || task?.claimed_at !== null
      || Number(task?.max_retries) !== 0
      || task?.completed_at !== closure?.closedAt
      || !exactClosureMarker(task?.result)
      || attempt?.status !== "needs_attention"
      || attempt?.outcome_status !== expectedOutcome
      || attempt?.provider_request_id !== recovery?.originalDispatch?.providerRequestId
      || attempt?.error_kind !== expectedErrorKind
      || attempt?.completed_at !== closure?.closedAt
      || !exactClosureMarker(attempt?.metadata)
      || agentRun?.task_id !== row?.task_id
      || agentRun?.workflow_id !== row?.workflow_id
      || agentRun?.venture_id !== null
      || agentRun?.status !== "needs_attention"
      || agentRun?.model_call_id !== exactBinding.modelCallId
      || agentRun?.completed_at !== closure?.closedAt
      || !exactClosureMarker(agentRun?.metadata)
      || tool?.task_id !== row?.task_id
      || tool?.workflow_id !== row?.workflow_id
      || tool?.attempt_id !== exactBinding.taskAttemptId
      || tool?.status !== "needs_attention"
      || tool?.decision !== "terminal_custody_only"
      || tool?.resolved_at !== closure?.closedAt
      || !exactClosureMarker(tool?.metadata)
      || workflow?.status !== "needs_attention"
      || workflow?.current_step
        !== "Terminal provider output is held for custody and billing review only"
      || Number(workflow?.approval_required) !== 1
      || workflow?.updated_at !== closure?.closedAt
      || !exactClosureMarker(workflow?.metadata)
      || closure?.authorityHash !== exactBinding.authorityHash
      || closure?.assignmentHash !== exactBinding.assignmentHash
      || closure?.taskId !== row?.task_id
      || closure?.workflowId !== row?.workflow_id
      || closure?.taskAttemptId !== exactBinding.taskAttemptId
      || closure?.modelCallId !== exactBinding.modelCallId
      || closure?.terminalEventHash !== exactBinding.terminalEventHash
      || closure?.artifactHash !== exactBinding.artifactHash
      || closure?.outcomeStatus !== expectedOutcome
      || closure?.errorKind !== expectedErrorKind
      || closure?.resultingStatus !== "needs_attention"
      || closure?.claimCleared !== true
      || closure?.retryAuthorized !== false
      || closure?.evidenceEligible !== false
      || closure?.closedAt !== exactBinding.recordedAt
      || !Array.isArray(closure?.siblingClosures)
      || !siblingClosureOk
      || receipt?.attempt_id !== exactBinding.taskAttemptId
      || receipt?.run_id !== closure?.agentRunId
      || receipt?.status !== recovery?.executionReceipt?.status
      || receipt?.outcome_status !== recovery?.executionReceipt?.outcomeStatus
      || `sha256:${receipt?.receipt_hash}` !== recovery?.executionReceipt?.hash
      || latestReceipt?.id !== receipt?.id
    ) {
      throw new Error(
        "Terminal retained-output recovery did not persist its exact immutable custody record.",
      );
    }
    preventureTerminalRetainedRecoveryCapabilities.delete(db);
    commitAtomic(db);
    return result;
  } catch (error) {
    preventureTerminalRetainedRecoveryCapabilities.delete(db);
    rollbackAtomic(db);
    throw error;
  } finally {
    preventureTerminalRetainedRecoveryCapabilities.delete(db);
  }
}

function normalizePreventureTerminalReceiptCapability(binding) {
  const exactKeys = [
    "agentRunId",
    "assignmentHash",
    "authorityHash",
    "closureHash",
    "createdAt",
    "expectedSequence",
    "missingFieldsJson",
    "outcomeStatus",
    "previousReceiptHash",
    "receiptHash",
    "receiptId",
    "receiptJson",
    "snapshotHash",
    "status",
    "taskAttemptId",
    "taskId",
    "warningsJson",
  ];
  if (
    !binding
    || typeof binding !== "object"
    || Array.isArray(binding)
    || JSON.stringify(Object.keys(binding).sort()) !== JSON.stringify(exactKeys)
    || !SHA256_DIGEST_PATTERN.test(String(binding.authorityHash || ""))
    || !SHA256_DIGEST_PATTERN.test(String(binding.assignmentHash || ""))
    || !SHA256_DIGEST_PATTERN.test(String(binding.closureHash || ""))
    || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(String(binding.taskId || ""))
    || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(String(binding.taskAttemptId || ""))
    || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(String(binding.agentRunId || ""))
    || !Number.isInteger(binding.expectedSequence)
    || binding.expectedSequence < 1
    || !Number.isFinite(Date.parse(binding.createdAt))
    || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(String(binding.receiptId || ""))
    || !/^[a-f0-9]{64}$/.test(String(binding.snapshotHash || ""))
    || !/^[a-f0-9]{64}$/.test(String(binding.receiptHash || ""))
    || typeof binding.status !== "string"
    || binding.status.length < 1
    || typeof binding.outcomeStatus !== "string"
    || binding.outcomeStatus.length < 1
    || typeof binding.missingFieldsJson !== "string"
    || typeof binding.warningsJson !== "string"
    || typeof binding.receiptJson !== "string"
    || (binding.previousReceiptHash !== null
      && !/^[a-f0-9]{64}$/.test(String(binding.previousReceiptHash || "")))
  ) {
    throw new Error("The terminal execution-receipt capability binding is invalid.");
  }
  return Object.freeze({ ...binding });
}

function registerPreventureTerminalReceiptCapabilityFunction(db) {
  db.function("pantheon_preventure_terminal_receipt_capability", (
    authorityHashValue,
    assignmentHashValue,
    receiptIdValue,
    attemptIdValue,
    runIdValue,
    taskIdValue,
    sequenceValue,
    statusValue,
    outcomeStatusValue,
    snapshotHashValue,
    previousHashValue,
    receiptHashValue,
    missingFieldsJsonValue,
    warningsJsonValue,
    receiptJsonValue,
    createdAtValue,
    closureHashValue,
  ) => {
    const state = preventureTerminalReceiptCapabilities.get(db);
    if (!state || state.phase !== "armed") return 0;
    const expected = state.binding;
    let receipt;
    try {
      receipt = JSON.parse(String(receiptJsonValue || ""));
    } catch {
      return 0;
    }
    const inserted = {
      authorityHash: String(authorityHashValue || ""),
      assignmentHash: String(assignmentHashValue || ""),
      id: String(receiptIdValue || ""),
      attemptId: String(attemptIdValue || ""),
      runId: String(runIdValue || ""),
      taskId: String(taskIdValue || ""),
      sequence: Number(sequenceValue),
      status: String(statusValue || ""),
      outcomeStatus: String(outcomeStatusValue || ""),
      snapshotHash: String(snapshotHashValue || ""),
      previousHash: previousHashValue === null ? null : String(previousHashValue || ""),
      receiptHash: String(receiptHashValue || ""),
      missingFieldsJson: String(missingFieldsJsonValue || ""),
      warningsJson: String(warningsJsonValue || ""),
      receiptJson: String(receiptJsonValue || ""),
      createdAt: String(createdAtValue || ""),
      closureHash: String(closureHashValue || ""),
    };
    if (
      inserted.authorityHash !== expected.authorityHash
      || inserted.assignmentHash !== expected.assignmentHash
      || inserted.attemptId !== expected.taskAttemptId
      || inserted.runId !== expected.agentRunId
      || inserted.taskId !== expected.taskId
      || inserted.sequence !== expected.expectedSequence
      || inserted.previousHash !== expected.previousReceiptHash
      || inserted.closureHash !== expected.closureHash
      || inserted.id !== expected.receiptId
      || inserted.snapshotHash !== expected.snapshotHash
      || inserted.receiptHash !== expected.receiptHash
      || inserted.status !== expected.status
      || inserted.outcomeStatus !== expected.outcomeStatus
      || inserted.missingFieldsJson !== expected.missingFieldsJson
      || inserted.warningsJson !== expected.warningsJson
      || inserted.receiptJson !== expected.receiptJson
      || inserted.createdAt !== expected.createdAt
      || receipt?.schema !== "jarvis.agent-run-receipt.v2"
      || receipt?.attempt?.id !== expected.taskAttemptId
      || receipt?.run?.id !== expected.agentRunId
      || receipt?.task?.id !== expected.taskId
      || receipt?.attempt?.metadata?.terminalRetainedExecution?.closureHash
        !== expected.closureHash
      || receipt?.run?.metadata?.terminalRetainedExecution?.closureHash
        !== expected.closureHash
    ) return 0;
    state.phase = "consumed";
    state.receipt = Object.freeze(inserted);
    return 1;
  });
}

function withPreventureTerminalReceiptCapability(db, binding, action) {
  if (!db || typeof db.prepare !== "function" || typeof action !== "function") {
    throw new Error("Terminal execution-receipt admission requires one synchronous database action.");
  }
  if (preventureTerminalReceiptCapabilities.has(db)) {
    throw new Error("A terminal execution-receipt action is already in progress.");
  }
  const exactBinding = normalizePreventureTerminalReceiptCapability(binding);
  beginAtomic(db);
  preventureTerminalReceiptCapabilities.set(db, {
    binding: exactBinding,
    phase: "armed",
    receipt: null,
  });
  try {
    const result = action();
    if (result && typeof result.then === "function") {
      throw new Error("Terminal execution-receipt admission must be synchronous.");
    }
    const state = preventureTerminalReceiptCapabilities.get(db);
    const row = state?.receipt?.id
      ? db.prepare("SELECT * FROM agent_run_receipts WHERE id = ?").get(state.receipt.id)
      : null;
    const latest = db.prepare(
      `SELECT id FROM agent_run_receipts WHERE attempt_id = ?
       ORDER BY sequence DESC, created_at DESC, id DESC LIMIT 1`,
    ).get(exactBinding.taskAttemptId);
    if (
      !state
      || state.phase !== "consumed"
      || !row
      || latest?.id !== row.id
      || row.attempt_id !== exactBinding.taskAttemptId
      || row.run_id !== exactBinding.agentRunId
      || row.task_id !== exactBinding.taskId
      || Number(row.sequence) !== exactBinding.expectedSequence
      || row.previous_hash !== exactBinding.previousReceiptHash
      || row.receipt_hash !== state.receipt.receiptHash
      || row.snapshot_hash !== state.receipt.snapshotHash
      || row.status !== state.receipt.status
      || row.outcome_status !== state.receipt.outcomeStatus
      || row.missing_fields !== state.receipt.missingFieldsJson
      || row.warnings !== state.receipt.warningsJson
      || row.receipt !== state.receipt.receiptJson
      || row.created_at !== state.receipt.createdAt
    ) {
      throw new Error("Terminal execution-receipt admission did not consume its exact one-shot receipt.");
    }
    preventureTerminalReceiptCapabilities.delete(db);
    commitAtomic(db);
    return result;
  } catch (error) {
    preventureTerminalReceiptCapabilities.delete(db);
    rollbackAtomic(db);
    throw error;
  } finally {
    preventureTerminalReceiptCapabilities.delete(db);
  }
}

function normalizePreventureEmergencyCostSafetyCapability(binding) {
  const exactKeys = ["stoppedAt", "taskIds"];
  if (
    !binding
    || typeof binding !== "object"
    || Array.isArray(binding)
    || JSON.stringify(Object.keys(binding).sort()) !== JSON.stringify(exactKeys)
    || !Number.isFinite(Date.parse(binding.stoppedAt))
    || !Array.isArray(binding.taskIds)
    || binding.taskIds.length === 0
    || binding.taskIds.some((taskId) => (
      typeof taskId !== "string"
      || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(taskId)
    ))
    || new Set(binding.taskIds).size !== binding.taskIds.length
  ) {
    throw new Error("The emergency pre-venture cost-safety capability binding is invalid.");
  }
  return Object.freeze({
    stoppedAt: new Date(Date.parse(binding.stoppedAt)).toISOString(),
    taskIds: Object.freeze([...binding.taskIds].sort()),
  });
}

function preparePreventureEmergencyCostSafetyTask(db, taskId, assignment, stoppedAt) {
  const attempts = db.prepare(
    `SELECT * FROM task_attempts
     WHERE task_id = ? AND status = 'running'
     ORDER BY started_at, id`,
  ).all(taskId);
  const modelCalls = db.prepare(
    `SELECT * FROM model_calls
     WHERE task_id = ?
       AND (status IN ('dispatching', 'running')
         OR (completed_at IS NULL AND outcome_status IN ('provider_dispatched', 'unknown')))
     ORDER BY created_at, id`,
  ).all(taskId);
  const costHeads = db.prepare(
    `SELECT costs.* FROM preventure_research_cost_events AS costs
     WHERE costs.assignment_hash = ?
       AND NOT EXISTS (
         SELECT 1 FROM preventure_research_cost_events AS later
         WHERE later.assignment_hash = costs.assignment_hash
           AND later.cost_key = costs.cost_key
           AND later.sequence > costs.sequence
       )
     ORDER BY costs.cost_key`,
  ).all(assignment.assignment_hash);
  if (attempts.length !== 1 || modelCalls.length !== 1 || costHeads.length !== 1) {
    throw new Error(
      "Emergency pre-venture cost safety requires one exact running attempt, provider call, and cost head.",
    );
  }
  const attempt = attempts[0];
  const modelCall = modelCalls[0];
  const priorRow = costHeads[0];
  let prior;
  try {
    prior = JSON.parse(priorRow.cost_json);
  } catch {
    throw new Error("Emergency pre-venture cost safety found invalid immutable cost JSON.");
  }
  const { receiptHash: suppliedReceiptHash, ...priorBody } = prior || {};
  const cap = Number(assignment.max_cost_aud_cents);
  const reservation = prior?.budgetReservationId
    ? db.prepare("SELECT * FROM budget_reservations WHERE id = ?").get(prior.budgetReservationId)
    : null;
  const genericCost = prior?.costId
    ? db.prepare("SELECT * FROM costs WHERE id = ?").get(prior.costId)
    : null;
  let reservationMetadata;
  let costMetadata;
  let modelMetadata;
  try {
    reservationMetadata = JSON.parse(reservation?.metadata || "{}");
    costMetadata = JSON.parse(genericCost?.metadata || "{}");
    modelMetadata = JSON.parse(modelCall.metadata || "{}");
  } catch {
    throw new Error("Emergency pre-venture cost safety found invalid accounting metadata.");
  }
  const statusMap = {
    reserved: new Set(["reserved"]),
    estimated: new Set(["estimated", "incurred_estimate"]),
    incurred: new Set(["incurred", "incurred_estimate"]),
  };
  const expectedKnownAmount = prior?.amountAudCents ?? prior?.exposureAudCents;
  if (
    prior?.schema !== PREVENTURE_RESEARCH_COST_EVENT_SCHEMA
    || suppliedReceiptHash !== priorRow.receipt_hash
    || canonicalCapabilityHash(priorBody) !== priorRow.receipt_hash
    || prior.authorityHash !== assignment.authority_hash
    || prior.assignmentHash !== assignment.assignment_hash
    || prior.costKey !== priorRow.cost_key
    || prior.sequence !== Number(priorRow.sequence)
    || prior.previousReceiptHash !== priorRow.previous_receipt_hash
    || !statusMap[prior.eventType]
    || prior.exposureAudCents !== cap
    || prior.taskAttemptId !== attempt.id
    || (prior.modelCallId !== null && prior.modelCallId !== modelCall.id)
    || attempt.provider_dispatch_model_call_id !== modelCall.id
    || modelCall.attempt_id !== attempt.id
    || modelCall.cost_status !== prior.eventType
    || Number(modelCall.reserved_cost_cents) !== cap
    || Number(modelCall.actual_cost_cents) !== (prior.eventType === "incurred" ? prior.amountAudCents : 0)
    || Number(modelCall.reconciled_cost_cents) !== 0
    || modelMetadata.authorityHash !== assignment.authority_hash
    || modelMetadata.assignmentHash !== assignment.assignment_hash
    || !reservation
    || reservation.task_id !== taskId
    || reservation.workflow_id !== assignment.workflow_id
    || reservation.venture_id !== null
    || reservation.currency !== "AUD"
    || !statusMap[prior.eventType].has(reservation.status)
    || Number(reservation.amount_cents) !== cap
    || reservationMetadata.authorityHash !== assignment.authority_hash
    || reservationMetadata.assignmentHash !== assignment.assignment_hash
    || reservationMetadata.costKey !== prior.costKey
    || reservationMetadata.exposureAudCents !== cap
    || !genericCost
    || genericCost.task_id !== taskId
    || genericCost.workflow_id !== assignment.workflow_id
    || genericCost.venture_id !== null
    || genericCost.currency !== "AUD"
    || !statusMap[prior.eventType].has(genericCost.status)
    || Number(genericCost.amount_cents) !== Number(expectedKnownAmount)
    || (genericCost.model_call_id !== null && genericCost.model_call_id !== modelCall.id)
    || costMetadata.authorityHash !== assignment.authority_hash
    || costMetadata.assignmentHash !== assignment.assignment_hash
    || costMetadata.costKey !== prior.costKey
    || costMetadata.exposureAudCents !== cap
    || Date.parse(stoppedAt) < Date.parse(prior.occurredAt)
  ) {
    throw new Error("Emergency pre-venture cost safety found drifted execution or accounting truth.");
  }
  const transition = Object.freeze({
    schema: PREVENTURE_RESEARCH_EMERGENCY_COST_TRANSITION_SCHEMA,
    taskId,
    taskAttemptId: attempt.id,
    modelCallId: modelCall.id,
    priorCostReceiptHash: prior.receiptHash,
    stoppedAt,
    providerOutcomeKnown: false,
    exactBillingPending: true,
  });
  const eventBody = {
    schema: PREVENTURE_RESEARCH_COST_EVENT_SCHEMA,
    authorityHash: assignment.authority_hash,
    assignmentHash: assignment.assignment_hash,
    costKey: prior.costKey,
    sequence: prior.sequence + 1,
    previousReceiptHash: prior.receiptHash,
    eventType: "unknown",
    amountAudCents: null,
    exposureAudCents: cap,
    taskAttemptId: attempt.id,
    modelCallId: modelCall.id,
    budgetReservationId: reservation.id,
    costId: genericCost.id,
    agentRunReceiptId: prior.agentRunReceiptId ?? null,
    emergencyStop: transition,
    occurredAt: stoppedAt,
  };
  const costEvent = Object.freeze({
    ...eventBody,
    receiptHash: canonicalCapabilityHash(eventBody),
  });
  return {
    authorityHash: assignment.authority_hash,
    assignmentHash: assignment.assignment_hash,
    assignmentCapAudCents: cap,
    modelCallId: modelCall.id,
    modelCallIds: new Set([modelCall.id]),
    reservationId: reservation.id,
    reservationIds: new Set([reservation.id]),
    costId: genericCost.id,
    costIds: new Set([genericCost.id]),
    costEvent,
    costReceiptHashes: new Set([costEvent.receiptHash]),
  };
}

function registerPreventureEmergencyCostSafetyCapabilityFunction(db) {
  db.function("pantheon_preventure_emergency_cost_safety_capability", (
    phaseValue,
    taskIdValue,
    objectIdValue,
    authorityHashValue,
    assignmentHashValue,
    assignmentCapAudCentsValue,
    stoppedAtValue,
  ) => {
    const state = preventureEmergencyCostSafetyCapabilities.get(db);
    if (!state) return 0;
    const phase = String(phaseValue ?? "");
    const taskId = String(taskIdValue ?? "");
    const objectId = String(objectIdValue ?? "");
    const expectedTask = state.tasks.get(taskId);
    const objects = phase === "model_call_update"
      ? expectedTask?.modelCallIds
      : phase === "reservation_update"
        ? expectedTask?.reservationIds
        : phase === "cost_update"
          ? expectedTask?.costIds
          : phase === "cost_event_insert"
            ? expectedTask?.costReceiptHashes
            : null;
    if (
      !expectedTask
      || !objects?.has(objectId)
      || String(authorityHashValue ?? "") !== expectedTask.authorityHash
      || String(assignmentHashValue ?? "") !== expectedTask.assignmentHash
      || Number(assignmentCapAudCentsValue) !== expectedTask.assignmentCapAudCents
      || String(stoppedAtValue ?? "") !== state.binding.stoppedAt
    ) return 0;
    objects.delete(objectId);
    return 1;
  });
}

function recordPreventureEmergencyUnknownCost(db, taskId, stoppedAt) {
  const state = preventureEmergencyCostSafetyCapabilities.get(db);
  const expected = state?.tasks.get(String(taskId || ""));
  if (!expected || state.binding.stoppedAt !== stoppedAt) {
    throw new Error("Emergency pre-venture cost truth requires its exact armed safety capability.");
  }
  const metadata = JSON.stringify({
    emergencyStop: true,
    stoppedAt,
    providerOutcomeUnknown: true,
    exactBillingPending: true,
    exposureAudCents: expected.assignmentCapAudCents,
  });
  const changed = db.prepare(
    `UPDATE costs
     SET model_call_id = ?, status = 'unknown', amount_cents = ?,
         metadata = json_patch(CASE WHEN json_valid(metadata) THEN metadata ELSE '{}' END, ?)
     WHERE id = ? AND task_id = ?`,
  ).run(
    expected.modelCallId,
    expected.assignmentCapAudCents,
    metadata,
    expected.costId,
    taskId,
  );
  if (Number(changed.changes) !== 1) {
    throw new Error("Emergency pre-venture cost safety lost its exact Pantheon cost row.");
  }
  const event = expected.costEvent;
  db.prepare(
    `INSERT INTO preventure_research_cost_events
     (receipt_hash, authority_hash, assignment_hash, cost_key, sequence,
      previous_receipt_hash, event_type, amount_aud_cents, exposure_aud_cents,
      task_attempt_id, model_call_id, budget_reservation_id, cost_id,
      agent_run_receipt_id, cost_json, occurred_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'unknown', NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    event.receiptHash,
    event.authorityHash,
    event.assignmentHash,
    event.costKey,
    event.sequence,
    event.previousReceiptHash,
    event.exposureAudCents,
    event.taskAttemptId,
    event.modelCallId,
    event.budgetReservationId,
    event.costId,
    event.agentRunReceiptId,
    canonicalCapabilityJson(event),
    event.occurredAt,
    event.occurredAt,
  );
  return event;
}

function withPreventureEmergencyCostSafetyCapability(db, binding, action) {
  if (!db || typeof db.prepare !== "function" || typeof action !== "function") {
    throw new Error("Emergency pre-venture cost safety requires one synchronous database action.");
  }
  if (preventureEmergencyCostSafetyCapabilities.has(db)) {
    throw new Error("An emergency pre-venture cost-safety action is already in progress.");
  }
  const normalized = normalizePreventureEmergencyCostSafetyCapability(binding);
  const tasks = new Map();
  for (const taskId of normalized.taskIds) {
    const assignment = db.prepare(
      `SELECT assignments.authority_hash, assignments.assignment_hash,
              assignments.workflow_id, assignments.max_cost_aud_cents
       FROM preventure_research_assignments AS assignments
       WHERE assignments.task_id = ?`,
    ).get(taskId);
    if (!assignment) continue;
    tasks.set(
      taskId,
      preparePreventureEmergencyCostSafetyTask(db, taskId, assignment, normalized.stoppedAt),
    );
  }
  beginAtomic(db);
  preventureEmergencyCostSafetyCapabilities.set(db, { binding: normalized, tasks });
  try {
    const result = action();
    if (result && typeof result.then === "function") {
      throw new Error("Emergency pre-venture cost safety must be synchronous.");
    }
    for (const [taskId, expected] of tasks) {
      if (
        expected.modelCallIds.size
        || expected.reservationIds.size
        || expected.costIds.size
        || expected.costReceiptHashes.size
      ) {
        throw new Error(`Emergency cost safety did not consume every bound projection for ${taskId}.`);
      }
      const invalidModel = db.prepare(
        `SELECT 1 FROM model_calls
         WHERE task_id = ? AND error_kind = 'operator_emergency_stop'
           AND (status <> 'needs_attention' OR outcome_status <> 'unknown'
             OR cost_status <> 'unknown' OR reserved_cost_cents <> ?
             OR actual_cost_cents <> 0 OR reconciled_cost_cents <> 0
             OR json_extract(metadata, '$.emergencyStop') <> 1
             OR json_extract(metadata, '$.stoppedAt') IS NOT ?)
         LIMIT 1`,
      ).get(taskId, expected.assignmentCapAudCents, normalized.stoppedAt);
      const invalidReservation = db.prepare(
        `SELECT 1 FROM budget_reservations
         WHERE task_id = ? AND json_extract(metadata, '$.emergencyStop') = 1
           AND (status <> 'unknown' OR amount_cents <> ? OR resolved_at IS NOT NULL
             OR json_extract(metadata, '$.stoppedAt') IS NOT ?)
         LIMIT 1`,
      ).get(taskId, expected.assignmentCapAudCents, normalized.stoppedAt);
      const invalidCost = db.prepare(
        `SELECT 1 FROM costs
         WHERE id = ? AND (task_id <> ? OR model_call_id <> ? OR status <> 'unknown'
           OR amount_cents <> ? OR currency <> 'AUD'
           OR json_extract(metadata, '$.emergencyStop') <> 1
           OR json_extract(metadata, '$.providerOutcomeUnknown') <> 1
           OR json_extract(metadata, '$.exactBillingPending') <> 1
           OR json_extract(metadata, '$.stoppedAt') IS NOT ?)
         LIMIT 1`,
      ).get(
        expected.costId,
        taskId,
        expected.modelCallId,
        expected.assignmentCapAudCents,
        normalized.stoppedAt,
      );
      const costEvent = db.prepare(
        `SELECT * FROM preventure_research_cost_events
         WHERE receipt_hash = ? AND authority_hash = ? AND assignment_hash = ?
           AND event_type = 'unknown' AND amount_aud_cents IS NULL
           AND exposure_aud_cents = ? AND task_attempt_id = ?
           AND model_call_id = ? AND budget_reservation_id = ? AND cost_id = ?
           AND cost_json = ? AND occurred_at = ? AND created_at = ?`,
      ).get(
        expected.costEvent.receiptHash,
        expected.authorityHash,
        expected.assignmentHash,
        expected.assignmentCapAudCents,
        expected.costEvent.taskAttemptId,
        expected.modelCallId,
        expected.reservationId,
        expected.costId,
        canonicalCapabilityJson(expected.costEvent),
        normalized.stoppedAt,
        normalized.stoppedAt,
      );
      const terminalSnapshot = db.prepare(
        `SELECT 1
         FROM tasks
         WHERE id = ? AND claim_token IS NULL
           AND json_extract(result, '$.emergencyStop') = 1
           AND json_extract(result, '$.claimInvalidated') = 1
           AND json_extract(result, '$.stoppedAt') IS ?
           AND EXISTS (
             SELECT 1 FROM task_attempts AS attempts
             WHERE attempts.task_id = tasks.id
               AND attempts.error_kind = 'operator_emergency_stop'
               AND json_extract(attempts.metadata, '$.emergencyStop') = 1
               AND json_extract(attempts.metadata, '$.claimInvalidated') = 1
               AND json_extract(attempts.metadata, '$.stoppedAt') IS ?
           )
           AND EXISTS (
             SELECT 1 FROM events AS emergency
             WHERE emergency.type = 'runtime.emergency_stop_recorded'
               AND emergency.ts IS ?
               AND EXISTS (
                 SELECT 1 FROM json_each(emergency.metadata, '$.affectedTaskIds') AS affected
                 WHERE affected.value = tasks.id
               )
           )`,
      ).get(taskId, normalized.stoppedAt, normalized.stoppedAt, normalized.stoppedAt);
      if (invalidModel || invalidReservation || invalidCost || !costEvent || !terminalSnapshot) {
        throw new Error("Emergency pre-venture cost safety did not retain full unknown exposure.");
      }
    }
    preventureEmergencyCostSafetyCapabilities.delete(db);
    commitAtomic(db);
    return result;
  } catch (error) {
    preventureEmergencyCostSafetyCapabilities.delete(db);
    rollbackAtomic(db);
    throw error;
  } finally {
    preventureEmergencyCostSafetyCapabilities.delete(db);
  }
}

const COMMERCIAL_LEDGER_IMMUTABLE_TRIGGER_SQL = Object.freeze({
  trg_venture_kits_definition_immutable_update: `
    CREATE TRIGGER IF NOT EXISTS trg_venture_kits_definition_immutable_update
    BEFORE UPDATE OF id, version, name, business_models, eligibility_rules,
      evidence_requirements, capability_requirements, channel_policy,
      acceptance_criteria, metadata, content_hash, created_at
    ON venture_kits
    BEGIN
      SELECT RAISE(ABORT, 'Venture Kit definitions are immutable; register a new version.');
    END
  `,
  trg_venture_kits_definition_immutable_delete: `
    CREATE TRIGGER IF NOT EXISTS trg_venture_kits_definition_immutable_delete
    BEFORE DELETE ON venture_kits
    BEGIN
      SELECT RAISE(ABORT, 'Venture Kit definitions are immutable.');
    END
  `,
  trg_commercial_test_contracts_immutable_update: `
    CREATE TRIGGER IF NOT EXISTS trg_commercial_test_contracts_immutable_update
    BEFORE UPDATE ON commercial_test_contracts
    BEGIN
      SELECT RAISE(ABORT, 'Commercial test contracts are immutable; create a new version.');
    END
  `,
  trg_commercial_test_contracts_immutable_delete: `
    CREATE TRIGGER IF NOT EXISTS trg_commercial_test_contracts_immutable_delete
    BEFORE DELETE ON commercial_test_contracts
    BEGIN
      SELECT RAISE(ABORT, 'Commercial test contracts are immutable.');
    END
  `,
  trg_commercial_test_lifecycle_immutable_update: `
    CREATE TRIGGER IF NOT EXISTS trg_commercial_test_lifecycle_immutable_update
    BEFORE UPDATE ON commercial_test_lifecycle_events
    BEGIN
      SELECT RAISE(ABORT, 'Commercial test lifecycle events are append-only.');
    END
  `,
  trg_commercial_test_lifecycle_immutable_delete: `
    CREATE TRIGGER IF NOT EXISTS trg_commercial_test_lifecycle_immutable_delete
    BEFORE DELETE ON commercial_test_lifecycle_events
    BEGIN
      SELECT RAISE(ABORT, 'Commercial test lifecycle events are append-only.');
    END
  `,
  trg_commercial_test_lifecycle_resume_approval_fresh_insert: `
    CREATE TRIGGER IF NOT EXISTS trg_commercial_test_lifecycle_resume_approval_fresh_insert
    BEFORE INSERT ON commercial_test_lifecycle_events
    WHEN NEW.event_type IN ('accepted', 'activated')
      AND EXISTS (
        SELECT 1
        FROM commercial_test_lifecycle_events AS pauses
        WHERE pauses.decision_hash = NEW.decision_hash
          AND pauses.event_type = 'paused'
          AND pauses.sequence < NEW.sequence
      )
      AND NOT EXISTS (
        SELECT 1
        FROM approvals
        WHERE approvals.id = NEW.approval_id
          AND approvals.status = 'approved'
          AND julianday(approvals.decided_at) IS NOT NULL
          AND julianday(approvals.decided_at) > (
            SELECT julianday(pauses.occurred_at)
            FROM commercial_test_lifecycle_events AS pauses
            WHERE pauses.decision_hash = NEW.decision_hash
              AND pauses.event_type = 'paused'
              AND pauses.sequence < NEW.sequence
            ORDER BY pauses.sequence DESC
            LIMIT 1
          )
      )
    BEGIN
      SELECT RAISE(
        ABORT,
        'Commercial test resumption requires a fresh approval decided after the latest pause.'
      );
    END
  `,
  trg_commercial_test_receipts_immutable_update: `
    CREATE TRIGGER IF NOT EXISTS trg_commercial_test_receipts_immutable_update
    BEFORE UPDATE ON commercial_test_evidence_receipts
    BEGIN
      SELECT RAISE(ABORT, 'Commercial evidence receipts are immutable.');
    END
  `,
  trg_commercial_test_receipts_immutable_delete: `
    CREATE TRIGGER IF NOT EXISTS trg_commercial_test_receipts_immutable_delete
    BEFORE DELETE ON commercial_test_evidence_receipts
    BEGIN
      SELECT RAISE(ABORT, 'Commercial evidence receipts are immutable.');
    END
  `,
  trg_commercial_test_records_immutable_update: `
    CREATE TRIGGER IF NOT EXISTS trg_commercial_test_records_immutable_update
    BEFORE UPDATE ON commercial_test_evidence_records
    BEGIN
      SELECT RAISE(ABORT, 'Commercial evidence records are immutable; append a revision.');
    END
  `,
  trg_commercial_test_records_immutable_delete: `
    CREATE TRIGGER IF NOT EXISTS trg_commercial_test_records_immutable_delete
    BEFORE DELETE ON commercial_test_evidence_records
    BEGIN
      SELECT RAISE(ABORT, 'Commercial evidence records are immutable.');
    END
  `,
  trg_commercial_test_evaluations_immutable_update: `
    CREATE TRIGGER IF NOT EXISTS trg_commercial_test_evaluations_immutable_update
    BEFORE UPDATE ON commercial_test_proof_evaluations
    BEGIN
      SELECT RAISE(ABORT, 'Commercial proof evaluations are append-only.');
    END
  `,
  trg_commercial_test_evaluations_immutable_delete: `
    CREATE TRIGGER IF NOT EXISTS trg_commercial_test_evaluations_immutable_delete
    BEFORE DELETE ON commercial_test_proof_evaluations
    BEGIN
      SELECT RAISE(ABORT, 'Commercial proof evaluations are append-only.');
    END
  `,
});

const COMMERCIAL_LEDGER_REQUIRED_INDEX_SQL = Object.freeze({
  idx_venture_kits_content_identity: `
    CREATE UNIQUE INDEX IF NOT EXISTS idx_venture_kits_content_identity
    ON venture_kits(id, version, content_hash)
  `,
  idx_commercial_test_contract_program: `
    CREATE INDEX IF NOT EXISTS idx_commercial_test_contract_program
    ON commercial_test_contracts(program_id, program_version, created_at DESC)
  `,
  idx_commercial_test_contract_channel: `
    CREATE INDEX IF NOT EXISTS idx_commercial_test_contract_channel
    ON commercial_test_contracts(provider_namespace, account_hash, reporting_starts_at, reporting_ends_at)
  `,
  idx_commercial_test_lifecycle_latest: `
    CREATE INDEX IF NOT EXISTS idx_commercial_test_lifecycle_latest
    ON commercial_test_lifecycle_events(decision_hash, sequence DESC)
  `,
  idx_commercial_test_lifecycle_approval_once: `
    CREATE UNIQUE INDEX IF NOT EXISTS idx_commercial_test_lifecycle_approval_once
    ON commercial_test_lifecycle_events(approval_id)
    WHERE approval_id IS NOT NULL
      AND event_type IN ('accepted', 'activated')
  `,
  idx_commercial_test_receipt_source: `
    CREATE INDEX IF NOT EXISTS idx_commercial_test_receipt_source
    ON commercial_test_evidence_receipts(decision_hash, source_kind, source_id, captured_at)
  `,
  idx_commercial_test_evidence_time: `
    CREATE INDEX IF NOT EXISTS idx_commercial_test_evidence_time
    ON commercial_test_evidence_records(decision_hash, captured_at, evidence_id)
  `,
  idx_commercial_test_transaction_key: `
    CREATE INDEX IF NOT EXISTS idx_commercial_test_transaction_key
    ON commercial_test_evidence_records(decision_hash, transaction_key, transaction_chain_sequence)
    WHERE transaction_key IS NOT NULL
  `,
  idx_commercial_test_transaction_identity: `
    CREATE INDEX IF NOT EXISTS idx_commercial_test_transaction_identity
    ON commercial_test_evidence_records(decision_hash, transaction_id_hash)
    WHERE transaction_id_hash IS NOT NULL
  `,
  idx_commercial_test_buyer: `
    CREATE INDEX IF NOT EXISTS idx_commercial_test_buyer
    ON commercial_test_evidence_records(decision_hash, buyer_pseudonym)
    WHERE buyer_pseudonym IS NOT NULL
  `,
  idx_commercial_test_cost_key: `
    CREATE INDEX IF NOT EXISTS idx_commercial_test_cost_key
    ON commercial_test_evidence_records(decision_hash, cost_key, cost_chain_sequence)
    WHERE cost_key IS NOT NULL
  `,
  idx_commercial_test_cost_identity: `
    CREATE INDEX IF NOT EXISTS idx_commercial_test_cost_identity
    ON commercial_test_evidence_records(decision_hash, cost_id_hash)
    WHERE cost_id_hash IS NOT NULL
  `,
  idx_commercial_test_supersession: `
    CREATE UNIQUE INDEX IF NOT EXISTS idx_commercial_test_supersession
    ON commercial_test_evidence_records(supersedes_record_hash)
    WHERE supersedes_record_hash IS NOT NULL
  `,
  idx_commercial_test_proof_latest: `
    CREATE INDEX IF NOT EXISTS idx_commercial_test_proof_latest
    ON commercial_test_proof_evaluations(decision_hash, evaluated_at DESC, evaluation_hash)
  `,
});

const PREVENTURE_RESEARCH_IMMUTABLE_TRIGGER_SQL = Object.freeze({
  trg_preventure_research_provider_billing_observations_immutable_update: `
    CREATE TRIGGER IF NOT EXISTS trg_preventure_research_provider_billing_observations_immutable_update
    BEFORE UPDATE ON preventure_research_provider_billing_observations
    BEGIN
      SELECT RAISE(ABORT, 'Owner-attested provider billing observations are immutable.');
    END
  `,
  trg_preventure_research_provider_billing_observations_immutable_delete: `
    CREATE TRIGGER IF NOT EXISTS trg_preventure_research_provider_billing_observations_immutable_delete
    BEFORE DELETE ON preventure_research_provider_billing_observations
    BEGIN
      SELECT RAISE(ABORT, 'Owner-attested provider billing observations are immutable.');
    END
  `,
  trg_preventure_research_terminal_recoveries_immutable_update: `
    CREATE TRIGGER IF NOT EXISTS trg_preventure_research_terminal_recoveries_immutable_update
    BEFORE UPDATE ON preventure_research_terminal_recoveries
    BEGIN
      SELECT RAISE(ABORT, 'Terminal retained-output recovery records are immutable.');
    END
  `,
  trg_preventure_research_terminal_recoveries_immutable_delete: `
    CREATE TRIGGER IF NOT EXISTS trg_preventure_research_terminal_recoveries_immutable_delete
    BEFORE DELETE ON preventure_research_terminal_recoveries
    BEGIN
      SELECT RAISE(ABORT, 'Terminal retained-output recovery records are immutable.');
    END
  `,
  trg_preventure_research_terminal_recovery_event_immutable_update: `
    CREATE TRIGGER IF NOT EXISTS trg_preventure_research_terminal_recovery_event_immutable_update
    BEFORE UPDATE ON events
    WHEN EXISTS (
      SELECT 1 FROM preventure_research_terminal_recoveries AS recoveries
      WHERE recoveries.emergency_event_id = OLD.id
    )
    BEGIN
      SELECT RAISE(ABORT, 'A referenced emergency-stop event is immutable.');
    END
  `,
  trg_preventure_research_terminal_recovery_event_immutable_delete: `
    CREATE TRIGGER IF NOT EXISTS trg_preventure_research_terminal_recovery_event_immutable_delete
    BEFORE DELETE ON events
    WHEN EXISTS (
      SELECT 1 FROM preventure_research_terminal_recoveries AS recoveries
      WHERE recoveries.emergency_event_id = OLD.id
    )
    BEGIN
      SELECT RAISE(ABORT, 'A referenced emergency-stop event is immutable.');
    END
  `,
  trg_preventure_research_terminal_stops_immutable_update: `
    CREATE TRIGGER IF NOT EXISTS trg_preventure_research_terminal_stops_immutable_update
    BEFORE UPDATE ON preventure_research_terminal_stops
    BEGIN
      SELECT RAISE(ABORT, 'Pre-venture terminal-stop records are immutable.');
    END
  `,
  trg_preventure_research_terminal_stops_immutable_delete: `
    CREATE TRIGGER IF NOT EXISTS trg_preventure_research_terminal_stops_immutable_delete
    BEFORE DELETE ON preventure_research_terminal_stops
    BEGIN
      SELECT RAISE(ABORT, 'Pre-venture terminal-stop records are immutable.');
    END
  `,
  trg_preventure_research_assignment_skips_immutable_update: `
    CREATE TRIGGER IF NOT EXISTS trg_preventure_research_assignment_skips_immutable_update
    BEFORE UPDATE ON preventure_research_assignment_skips
    BEGIN
      SELECT RAISE(ABORT, 'Pre-venture assignment skip records are immutable.');
    END
  `,
  trg_preventure_research_assignment_skips_immutable_delete: `
    CREATE TRIGGER IF NOT EXISTS trg_preventure_research_assignment_skips_immutable_delete
    BEFORE DELETE ON preventure_research_assignment_skips
    BEGIN
      SELECT RAISE(ABORT, 'Pre-venture assignment skip records are immutable.');
    END
  `,
  trg_preventure_research_approval_decisions_immutable_update: `
    CREATE TRIGGER IF NOT EXISTS trg_preventure_research_approval_decisions_immutable_update
    BEFORE UPDATE ON preventure_research_approval_decisions
    BEGIN
      SELECT RAISE(ABORT, 'Pre-venture approval decision receipts are immutable.');
    END
  `,
  trg_preventure_research_approval_decisions_immutable_delete: `
    CREATE TRIGGER IF NOT EXISTS trg_preventure_research_approval_decisions_immutable_delete
    BEFORE DELETE ON preventure_research_approval_decisions
    BEGIN
      SELECT RAISE(ABORT, 'Pre-venture approval decision receipts are immutable.');
    END
  `,
  trg_preventure_research_authorities_immutable_update: `
    CREATE TRIGGER IF NOT EXISTS trg_preventure_research_authorities_immutable_update
    BEFORE UPDATE ON preventure_research_authorities
    BEGIN
      SELECT RAISE(ABORT, 'Pre-venture research authorities are immutable; create a new version.');
    END
  `,
  trg_preventure_research_authorities_immutable_delete: `
    CREATE TRIGGER IF NOT EXISTS trg_preventure_research_authorities_immutable_delete
    BEFORE DELETE ON preventure_research_authorities
    BEGIN
      SELECT RAISE(ABORT, 'Pre-venture research authorities are immutable.');
    END
  `,
  trg_preventure_research_lifecycle_immutable_update: `
    CREATE TRIGGER IF NOT EXISTS trg_preventure_research_lifecycle_immutable_update
    BEFORE UPDATE ON preventure_research_lifecycle_events
    BEGIN
      SELECT RAISE(ABORT, 'Pre-venture research lifecycle events are append-only.');
    END
  `,
  trg_preventure_research_lifecycle_immutable_delete: `
    CREATE TRIGGER IF NOT EXISTS trg_preventure_research_lifecycle_immutable_delete
    BEFORE DELETE ON preventure_research_lifecycle_events
    BEGIN
      SELECT RAISE(ABORT, 'Pre-venture research lifecycle events are append-only.');
    END
  `,
  trg_preventure_research_assignments_immutable_update: `
    CREATE TRIGGER IF NOT EXISTS trg_preventure_research_assignments_immutable_update
    BEFORE UPDATE ON preventure_research_assignments
    BEGIN
      SELECT RAISE(ABORT, 'Pre-venture research assignments are immutable.');
    END
  `,
  trg_preventure_research_assignments_immutable_delete: `
    CREATE TRIGGER IF NOT EXISTS trg_preventure_research_assignments_immutable_delete
    BEFORE DELETE ON preventure_research_assignments
    BEGIN
      SELECT RAISE(ABORT, 'Pre-venture research assignments are immutable.');
    END
  `,
  trg_preventure_research_cost_events_immutable_update: `
    CREATE TRIGGER IF NOT EXISTS trg_preventure_research_cost_events_immutable_update
    BEFORE UPDATE ON preventure_research_cost_events
    BEGIN
      SELECT RAISE(ABORT, 'Pre-venture research cost events are append-only.');
    END
  `,
  trg_preventure_research_cost_events_immutable_delete: `
    CREATE TRIGGER IF NOT EXISTS trg_preventure_research_cost_events_immutable_delete
    BEFORE DELETE ON preventure_research_cost_events
    BEGIN
      SELECT RAISE(ABORT, 'Pre-venture research cost events are append-only.');
    END
  `,
  trg_preventure_research_sources_immutable_update: `
    CREATE TRIGGER IF NOT EXISTS trg_preventure_research_sources_immutable_update
    BEFORE UPDATE ON preventure_research_source_snapshots
    BEGIN
      SELECT RAISE(ABORT, 'Pre-venture research source snapshots are immutable; append a revision.');
    END
  `,
  trg_preventure_research_sources_immutable_delete: `
    CREATE TRIGGER IF NOT EXISTS trg_preventure_research_sources_immutable_delete
    BEFORE DELETE ON preventure_research_source_snapshots
    BEGIN
      SELECT RAISE(ABORT, 'Pre-venture research source snapshots are immutable.');
    END
  `,
  trg_preventure_research_evidence_immutable_update: `
    CREATE TRIGGER IF NOT EXISTS trg_preventure_research_evidence_immutable_update
    BEFORE UPDATE ON preventure_research_evidence_records
    BEGIN
      SELECT RAISE(ABORT, 'Pre-venture research evidence is immutable; append a revision.');
    END
  `,
  trg_preventure_research_evidence_immutable_delete: `
    CREATE TRIGGER IF NOT EXISTS trg_preventure_research_evidence_immutable_delete
    BEFORE DELETE ON preventure_research_evidence_records
    BEGIN
      SELECT RAISE(ABORT, 'Pre-venture research evidence is immutable.');
    END
  `,
  trg_preventure_research_decisions_immutable_update: `
    CREATE TRIGGER IF NOT EXISTS trg_preventure_research_decisions_immutable_update
    BEFORE UPDATE ON preventure_research_decisions
    BEGIN
      SELECT RAISE(ABORT, 'Pre-venture research decisions are immutable.');
    END
  `,
  trg_preventure_research_decisions_immutable_delete: `
    CREATE TRIGGER IF NOT EXISTS trg_preventure_research_decisions_immutable_delete
    BEFORE DELETE ON preventure_research_decisions
    BEGIN
      SELECT RAISE(ABORT, 'Pre-venture research decisions are immutable.');
    END
  `,
});

function preventureExecutionVentureGuardTriggerSql(tableName) {
  return {
    [`trg_preventure_research_${tableName}_venture_insert`]: `
      CREATE TRIGGER IF NOT EXISTS trg_preventure_research_${tableName}_venture_insert
      BEFORE INSERT ON ${tableName}
      WHEN NEW.venture_id IS NOT NULL
        AND (
          EXISTS (
            SELECT 1 FROM tasks
            WHERE id = NEW.task_id AND kind = 'preventure_research'
          )
          OR EXISTS (
            SELECT 1 FROM workflows
            WHERE id = NEW.workflow_id AND type = 'preventure_research'
          )
        )
      BEGIN
        SELECT RAISE(ABORT, 'Pre-venture research execution cannot be assigned to a venture.');
      END
    `,
    [`trg_preventure_research_${tableName}_venture_update`]: `
      CREATE TRIGGER IF NOT EXISTS trg_preventure_research_${tableName}_venture_update
      BEFORE UPDATE OF venture_id, workflow_id, task_id ON ${tableName}
      WHEN NEW.venture_id IS NOT NULL
        AND (
          EXISTS (
            SELECT 1 FROM tasks
            WHERE id = NEW.task_id AND kind = 'preventure_research'
          )
          OR EXISTS (
            SELECT 1 FROM workflows
            WHERE id = NEW.workflow_id AND type = 'preventure_research'
          )
        )
      BEGIN
        SELECT RAISE(ABORT, 'Pre-venture research execution cannot be assigned to a venture.');
      END
    `,
  };
}

function preventureResearchEventOwnershipCondition(row = "NEW") {
  return `(
    (
      ${row}.entity_type = 'preventure_research_authority'
      AND ${row}.type IN (
        'preventure_research.proposed',
        'preventure_research.acceptance_requested',
        'preventure_research.accepted',
        'preventure_research.activation_requested',
        'preventure_research.activated',
        'preventure_research.assignments_materialized',
        'preventure_research.outcome_unknown',
        'preventure_research.revoked',
        'preventure_research.expired',
        'preventure_research.decision_completed'
      )
    )
    OR (
      ${row}.entity_type = 'preventure_research_assignment'
      AND ${row}.type IN (
        'preventure_research.assignment_started',
        'preventure_research.assignment_completed',
        'preventure_research.assignment_needs_reprocess'
      )
    )
  )`;
}

function preventureSkippedTaskActivityInsertTriggerSql(tableName) {
  return {
    [`trg_preventure_research_${tableName}_skipped_task_insert`]: `
      CREATE TRIGGER IF NOT EXISTS trg_preventure_research_${tableName}_skipped_task_insert
      BEFORE INSERT ON ${tableName}
      WHEN EXISTS (
        SELECT 1
        FROM preventure_research_assignment_skips AS skips
        WHERE skips.task_id = NEW.task_id
      )
      BEGIN
        SELECT RAISE(ABORT, 'A skipped pre-venture assignment cannot acquire later execution or cost activity.');
      END
    `,
    [`trg_preventure_research_${tableName}_skipped_task_update`]: `
      CREATE TRIGGER IF NOT EXISTS trg_preventure_research_${tableName}_skipped_task_update
      BEFORE UPDATE OF task_id ON ${tableName}
      WHEN EXISTS (
        SELECT 1
        FROM preventure_research_assignment_skips AS skips
        WHERE skips.task_id = NEW.task_id
      )
      BEGIN
        SELECT RAISE(ABORT, 'Existing execution or cost activity cannot be rebound to a skipped pre-venture assignment.');
      END
    `,
  };
}

function preventureTerminalRecoveryTaskActivityTriggerSql(tableName) {
  const ownerBillingUpdateGuard = {
    budget_reservations: `
      AND COALESCE(pantheon_preventure_owner_billing_observation_capability(
        'guard_reservation_update',
        json_extract(NEW.metadata, '$.authorityHash'),
        json_extract(NEW.metadata, '$.assignmentHash'),
        NEW.id,
        json_extract(NEW.metadata, '$.ownerBillingObservationHash'),
        json_extract(NEW.metadata, '$.ownerBillingCostReceiptHash'),
        json_extract(NEW.metadata, '$.ownerBillingPreviousReceiptHash'),
        NEW.amount_cents,
        NEW.resolved_at,
        NEW.metadata
      ), 0) <> 1`,
    costs: `
      AND COALESCE(pantheon_preventure_owner_billing_observation_capability(
        'guard_cost_update',
        json_extract(NEW.metadata, '$.authorityHash'),
        json_extract(NEW.metadata, '$.assignmentHash'),
        NEW.id,
        json_extract(NEW.metadata, '$.ownerBillingObservationHash'),
        json_extract(NEW.metadata, '$.ownerBillingCostReceiptHash'),
        json_extract(NEW.metadata, '$.ownerBillingPreviousReceiptHash'),
        NEW.amount_cents,
        NEW.occurred_at,
        NEW.metadata
      ), 0) <> 1`,
    model_calls: `
      AND COALESCE(pantheon_preventure_owner_billing_observation_capability(
        'guard_model_call_update',
        json_extract(NEW.metadata, '$.authorityHash'),
        json_extract(NEW.metadata, '$.assignmentHash'),
        NEW.id,
        json_extract(NEW.metadata, '$.ownerBillingObservationHash'),
        json_extract(NEW.metadata, '$.ownerBillingCostReceiptHash'),
        json_extract(NEW.metadata, '$.ownerBillingPreviousReceiptHash'),
        NEW.actual_cost_cents,
        json_extract(NEW.metadata, '$.ownerBillingRecordedAt'),
        NEW.metadata
      ), 0) <> 1`,
  }[tableName] || "";
  return {
    [`trg_preventure_research_${tableName}_terminal_recovery_insert`]: `
      CREATE TRIGGER IF NOT EXISTS trg_preventure_research_${tableName}_terminal_recovery_insert
      BEFORE INSERT ON ${tableName}
      WHEN EXISTS (
        SELECT 1
        FROM preventure_research_assignments AS assignments
        JOIN preventure_research_terminal_recoveries AS recoveries
          ON recoveries.authority_hash = assignments.authority_hash
        WHERE assignments.task_id = NEW.task_id
      )
      BEGIN
        SELECT RAISE(ABORT, 'Terminal retained-output custody cannot acquire later execution or cost activity.');
      END
    `,
    [`trg_preventure_research_${tableName}_terminal_recovery_update`]: `
      CREATE TRIGGER IF NOT EXISTS trg_preventure_research_${tableName}_terminal_recovery_update
      BEFORE UPDATE ON ${tableName}
      WHEN EXISTS (
        SELECT 1
        FROM preventure_research_assignments AS assignments
        JOIN preventure_research_terminal_recoveries AS recoveries
          ON recoveries.authority_hash = assignments.authority_hash
        WHERE assignments.task_id IN (OLD.task_id, NEW.task_id)
      )
      ${ownerBillingUpdateGuard}
      BEGIN
        SELECT RAISE(ABORT, 'Terminal retained-output custody freezes later execution and cost projections.');
      END
    `,
    [`trg_preventure_research_${tableName}_terminal_recovery_delete`]: `
      CREATE TRIGGER IF NOT EXISTS trg_preventure_research_${tableName}_terminal_recovery_delete
      BEFORE DELETE ON ${tableName}
      WHEN EXISTS (
        SELECT 1
        FROM preventure_research_assignments AS assignments
        JOIN preventure_research_terminal_recoveries AS recoveries
          ON recoveries.authority_hash = assignments.authority_hash
        WHERE assignments.task_id = OLD.task_id
      )
      BEGIN
        SELECT RAISE(ABORT, 'Terminal retained-output custody freezes later execution and cost projections.');
      END
    `,
  };
}

function preventureTerminalRecoveryIndirectChildTriggerSql(tableName, parentTable) {
  return {
    [`trg_preventure_research_${tableName}_terminal_recovery_insert`]: `
      CREATE TRIGGER IF NOT EXISTS trg_preventure_research_${tableName}_terminal_recovery_insert
      BEFORE INSERT ON ${tableName}
      WHEN EXISTS (
        SELECT 1
        FROM ${parentTable} AS parent
        JOIN preventure_research_assignments AS assignments
          ON assignments.task_id = parent.task_id
        JOIN preventure_research_terminal_recoveries AS recoveries
          ON recoveries.authority_hash = assignments.authority_hash
        WHERE parent.id = NEW.run_id
      )
      BEGIN
        SELECT RAISE(ABORT, 'Terminal retained-output custody freezes indirectly bound execution evidence.');
      END
    `,
    [`trg_preventure_research_${tableName}_terminal_recovery_update`]: `
      CREATE TRIGGER IF NOT EXISTS trg_preventure_research_${tableName}_terminal_recovery_update
      BEFORE UPDATE ON ${tableName}
      WHEN EXISTS (
        SELECT 1
        FROM ${parentTable} AS parent
        JOIN preventure_research_assignments AS assignments
          ON assignments.task_id = parent.task_id
        JOIN preventure_research_terminal_recoveries AS recoveries
          ON recoveries.authority_hash = assignments.authority_hash
        WHERE parent.id IN (OLD.run_id, NEW.run_id)
      )
      BEGIN
        SELECT RAISE(ABORT, 'Terminal retained-output custody freezes indirectly bound execution evidence.');
      END
    `,
    [`trg_preventure_research_${tableName}_terminal_recovery_delete`]: `
      CREATE TRIGGER IF NOT EXISTS trg_preventure_research_${tableName}_terminal_recovery_delete
      BEFORE DELETE ON ${tableName}
      WHEN EXISTS (
        SELECT 1
        FROM ${parentTable} AS parent
        JOIN preventure_research_assignments AS assignments
          ON assignments.task_id = parent.task_id
        JOIN preventure_research_terminal_recoveries AS recoveries
          ON recoveries.authority_hash = assignments.authority_hash
        WHERE parent.id = OLD.run_id
      )
      BEGIN
        SELECT RAISE(ABORT, 'Terminal retained-output custody freezes indirectly bound execution evidence.');
      END
    `,
  };
}

const PREVENTURE_RESEARCH_GUARD_TRIGGER_SQL = Object.freeze({
  trg_preventure_research_owner_billing_observation_admission_insert: `
    CREATE TRIGGER IF NOT EXISTS trg_preventure_research_owner_billing_observation_admission_insert
    BEFORE INSERT ON preventure_research_provider_billing_observations
    WHEN pantheon_preventure_owner_billing_observation_capability(
        'observation_insert',
        NEW.authority_hash,
        NEW.assignment_hash,
        NEW.observation_hash,
        NEW.observation_hash,
        NULL,
        NULL,
        NEW.amount_aud_cents,
        NEW.recorded_at,
        NEW.observation_json
      ) <> 1
      OR NOT EXISTS (
        SELECT 1
        FROM preventure_research_assignments AS assignment
        WHERE assignment.authority_hash = NEW.authority_hash
          AND assignment.assignment_hash = NEW.assignment_hash
          AND assignment.template_hash = NEW.assignment_template_hash
          AND assignment.task_id = NEW.task_id
      )
      OR NOT EXISTS (
        SELECT 1
        FROM preventure_research_cost_events AS predecessor
        WHERE predecessor.receipt_hash = NEW.expected_previous_receipt_hash
          AND predecessor.authority_hash = NEW.authority_hash
          AND predecessor.assignment_hash = NEW.assignment_hash
          AND predecessor.cost_key = NEW.cost_key
          AND predecessor.task_attempt_id = NEW.task_attempt_id
          AND predecessor.model_call_id = NEW.model_call_id
          AND predecessor.budget_reservation_id = NEW.budget_reservation_id
          AND predecessor.cost_id = NEW.cost_id
          AND predecessor.agent_run_receipt_id = NEW.agent_run_receipt_id
          AND NOT EXISTS (
            SELECT 1 FROM preventure_research_cost_events AS later
            WHERE later.assignment_hash = predecessor.assignment_hash
              AND later.cost_key = predecessor.cost_key
              AND later.sequence > predecessor.sequence
          )
          AND NEW.original_cost_occurred_at = (
            SELECT original.occurred_at
            FROM preventure_research_cost_events AS original
            WHERE original.assignment_hash = predecessor.assignment_hash
              AND original.cost_key = predecessor.cost_key
            ORDER BY original.sequence ASC
            LIMIT 1
          )
      )
      OR NOT (
        (
          NEW.predecessor_kind = 'terminal_recovery'
          AND EXISTS (
            SELECT 1 FROM preventure_research_terminal_recoveries AS recovery
            WHERE recovery.recovery_hash = NEW.predecessor_hash
              AND recovery.authority_hash = NEW.authority_hash
              AND recovery.assignment_hash = NEW.assignment_hash
              AND recovery.task_attempt_id = NEW.task_attempt_id
              AND recovery.model_call_id = NEW.model_call_id
              AND recovery.terminal_cost_receipt_hash
                = NEW.expected_previous_receipt_hash
          )
        )
        OR (
          NEW.predecessor_kind = 'sealed_decision'
          AND EXISTS (
            SELECT 1 FROM preventure_research_decisions AS decision
            WHERE decision.decision_hash = NEW.predecessor_hash
              AND decision.authority_hash = NEW.authority_hash
          )
        )
      )
      OR NOT EXISTS (
        SELECT 1
        FROM task_attempts AS attempt
        JOIN model_calls AS model ON model.id = NEW.model_call_id
        JOIN agent_run_receipts AS receipt ON receipt.id = NEW.agent_run_receipt_id
        JOIN budget_reservations AS reservation ON reservation.id = NEW.budget_reservation_id
        JOIN costs AS cost ON cost.id = NEW.cost_id
        WHERE attempt.id = NEW.task_attempt_id
          AND attempt.task_id = NEW.task_id
          AND model.task_id = NEW.task_id
          AND receipt.task_id = NEW.task_id
          AND receipt.attempt_id = NEW.task_attempt_id
          AND (
            CASE
              WHEN length(receipt.receipt_hash) = 64 THEN 'sha256:' || receipt.receipt_hash
              ELSE receipt.receipt_hash
            END
          ) = NEW.agent_run_receipt_hash
          AND reservation.task_id = NEW.task_id
          AND reservation.currency = 'AUD'
          AND cost.task_id = NEW.task_id
          AND cost.model_call_id = NEW.model_call_id
          AND cost.currency = 'AUD'
      )
    BEGIN
      SELECT RAISE(
        ABORT,
        'Owner-attested provider billing observations require the exact database capability.'
      );
    END
  `,
  trg_preventure_research_owner_billing_cost_event_insert: `
    CREATE TRIGGER IF NOT EXISTS trg_preventure_research_owner_billing_cost_event_insert
    BEFORE INSERT ON preventure_research_cost_events
    WHEN json_extract(NEW.cost_json, '$.ownerBillingObservationHash') IS NOT NULL
      AND pantheon_preventure_owner_billing_observation_capability(
        'cost_event_insert',
        NEW.authority_hash,
        NEW.assignment_hash,
        NEW.cost_id,
        json_extract(NEW.cost_json, '$.ownerBillingObservationHash'),
        NEW.receipt_hash,
        NEW.previous_receipt_hash,
        NEW.amount_aud_cents,
        NEW.occurred_at,
        NEW.cost_json
      ) <> 1
    BEGIN
      SELECT RAISE(ABORT, 'Owner-attested provider cost requires its exact observation capability.');
    END
  `,
  trg_preventure_research_owner_billing_reservation_update: `
    CREATE TRIGGER IF NOT EXISTS trg_preventure_research_owner_billing_reservation_update
    BEFORE UPDATE ON budget_reservations
    WHEN json_extract(NEW.metadata, '$.ownerBillingObservationHash') IS NOT NULL
      AND pantheon_preventure_owner_billing_observation_capability(
        'reservation_update',
        json_extract(NEW.metadata, '$.authorityHash'),
        json_extract(NEW.metadata, '$.assignmentHash'),
        NEW.id,
        json_extract(NEW.metadata, '$.ownerBillingObservationHash'),
        json_extract(NEW.metadata, '$.ownerBillingCostReceiptHash'),
        json_extract(NEW.metadata, '$.ownerBillingPreviousReceiptHash'),
        NEW.amount_cents,
        NEW.resolved_at,
        NEW.metadata
      ) <> 1
    BEGIN
      SELECT RAISE(ABORT, 'Owner-attested provider billing requires its exact reservation transition.');
    END
  `,
  trg_preventure_research_owner_billing_cost_update: `
    CREATE TRIGGER IF NOT EXISTS trg_preventure_research_owner_billing_cost_update
    BEFORE UPDATE ON costs
    WHEN json_extract(NEW.metadata, '$.ownerBillingObservationHash') IS NOT NULL
      AND pantheon_preventure_owner_billing_observation_capability(
        'cost_update',
        json_extract(NEW.metadata, '$.authorityHash'),
        json_extract(NEW.metadata, '$.assignmentHash'),
        NEW.id,
        json_extract(NEW.metadata, '$.ownerBillingObservationHash'),
        json_extract(NEW.metadata, '$.ownerBillingCostReceiptHash'),
        json_extract(NEW.metadata, '$.ownerBillingPreviousReceiptHash'),
        NEW.amount_cents,
        NEW.occurred_at,
        NEW.metadata
      ) <> 1
    BEGIN
      SELECT RAISE(ABORT, 'Owner-attested provider billing requires its exact cost transition.');
    END
  `,
  trg_preventure_research_owner_billing_model_call_update: `
    CREATE TRIGGER IF NOT EXISTS trg_preventure_research_owner_billing_model_call_update
    BEFORE UPDATE OF cost_status, reserved_cost_cents, actual_cost_cents,
                     reconciled_cost_cents, metadata ON model_calls
    WHEN json_extract(NEW.metadata, '$.ownerBillingObservationHash') IS NOT NULL
      AND pantheon_preventure_owner_billing_observation_capability(
        'model_call_update',
        json_extract(NEW.metadata, '$.authorityHash'),
        json_extract(NEW.metadata, '$.assignmentHash'),
        NEW.id,
        json_extract(NEW.metadata, '$.ownerBillingObservationHash'),
        json_extract(NEW.metadata, '$.ownerBillingCostReceiptHash'),
        json_extract(NEW.metadata, '$.ownerBillingPreviousReceiptHash'),
        NEW.actual_cost_cents,
        json_extract(NEW.metadata, '$.ownerBillingRecordedAt'),
        NEW.metadata
      ) <> 1
    BEGIN
      SELECT RAISE(ABORT, 'Owner-attested provider billing requires its exact model-cost transition.');
    END
  `,
  trg_preventure_research_terminal_receipt_admission_insert: `
    CREATE TRIGGER IF NOT EXISTS trg_preventure_research_terminal_receipt_admission_insert
    BEFORE INSERT ON agent_run_receipts
    WHEN EXISTS (
      SELECT 1
      FROM preventure_research_assignments AS assignment
      JOIN preventure_research_authorities AS authority
        ON authority.authority_hash = assignment.authority_hash
      WHERE assignment.task_id = NEW.task_id
        AND (
          julianday(pantheon_current_time()) >= julianday(authority.expires_at)
          OR EXISTS (
            SELECT 1
            FROM preventure_research_lifecycle_events AS lifecycle
            WHERE lifecycle.authority_hash = assignment.authority_hash
              AND lifecycle.event_type IN ('revoked', 'expired')
              AND NOT EXISTS (
                SELECT 1 FROM preventure_research_lifecycle_events AS later
                WHERE later.authority_hash = lifecycle.authority_hash
                  AND later.sequence > lifecycle.sequence
              )
          )
          OR EXISTS (
            SELECT 1 FROM events AS emergency
            WHERE emergency.type = 'runtime.emergency_stop_recorded'
              AND json_valid(emergency.metadata)
              AND EXISTS (
                SELECT 1 FROM json_each(emergency.metadata, '$.affectedTaskIds') AS affected
                WHERE affected.value = assignment.task_id
              )
          )
        )
    )
      AND pantheon_preventure_terminal_receipt_capability(
        (SELECT assignment.authority_hash
         FROM preventure_research_assignments AS assignment
         WHERE assignment.task_id = NEW.task_id LIMIT 1),
        (SELECT assignment.assignment_hash
         FROM preventure_research_assignments AS assignment
         WHERE assignment.task_id = NEW.task_id LIMIT 1),
        NEW.id,
        NEW.attempt_id,
        NEW.run_id,
        NEW.task_id,
        NEW.sequence,
        NEW.status,
        NEW.outcome_status,
        NEW.snapshot_hash,
        NEW.previous_hash,
        NEW.receipt_hash,
        NEW.missing_fields,
        NEW.warnings,
        NEW.receipt,
        NEW.created_at,
        json_extract(NEW.receipt, '$.attempt.metadata.terminalRetainedExecution.closureHash')
      ) <> 1
    BEGIN
      SELECT RAISE(ABORT, 'Terminal execution receipts require the exact one-shot custody capability.');
    END
  `,
  ...preventureSkippedTaskActivityInsertTriggerSql("task_attempts"),
  ...preventureSkippedTaskActivityInsertTriggerSql("model_calls"),
  ...preventureSkippedTaskActivityInsertTriggerSql("research_runs"),
  ...preventureSkippedTaskActivityInsertTriggerSql("agent_runs"),
  ...preventureSkippedTaskActivityInsertTriggerSql("agent_run_receipts"),
  ...preventureSkippedTaskActivityInsertTriggerSql("agent_tool_invocations"),
  ...preventureSkippedTaskActivityInsertTriggerSql("agent_eval_results"),
  ...preventureSkippedTaskActivityInsertTriggerSql("agent_run_provenance"),
  ...preventureSkippedTaskActivityInsertTriggerSql("budget_reservations"),
  ...preventureSkippedTaskActivityInsertTriggerSql("costs"),
  ...preventureTerminalRecoveryTaskActivityTriggerSql("task_attempts"),
  ...preventureTerminalRecoveryTaskActivityTriggerSql("model_calls"),
  ...preventureTerminalRecoveryTaskActivityTriggerSql("research_runs"),
  ...preventureTerminalRecoveryTaskActivityTriggerSql("agent_runs"),
  ...preventureTerminalRecoveryTaskActivityTriggerSql("agent_run_receipts"),
  ...preventureTerminalRecoveryTaskActivityTriggerSql("agent_tool_invocations"),
  ...preventureTerminalRecoveryTaskActivityTriggerSql("agent_eval_results"),
  ...preventureTerminalRecoveryTaskActivityTriggerSql("agent_run_provenance"),
  ...preventureTerminalRecoveryTaskActivityTriggerSql("budget_reservations"),
  ...preventureTerminalRecoveryTaskActivityTriggerSql("costs"),
  ...preventureTerminalRecoveryIndirectChildTriggerSql("agent_trace_events", "agent_runs"),
  ...preventureTerminalRecoveryIndirectChildTriggerSql("research_sources", "research_runs"),
  ...preventureTerminalRecoveryIndirectChildTriggerSql("agent_pilot_reviews", "agent_runs"),
  trg_preventure_research_terminal_recovery_task_update: `
    CREATE TRIGGER IF NOT EXISTS trg_preventure_research_terminal_recovery_task_update
    BEFORE UPDATE ON tasks
    WHEN EXISTS (
      SELECT 1
      FROM preventure_research_assignments AS assignments
      JOIN preventure_research_terminal_recoveries AS recoveries
        ON recoveries.authority_hash = assignments.authority_hash
      WHERE assignments.task_id IN (OLD.id, NEW.id)
    )
    BEGIN
      SELECT RAISE(ABORT, 'Terminal custody freezes every assignment task in its authority.');
    END
  `,
  trg_preventure_research_terminal_recovery_task_delete: `
    CREATE TRIGGER IF NOT EXISTS trg_preventure_research_terminal_recovery_task_delete
    BEFORE DELETE ON tasks
    WHEN EXISTS (
      SELECT 1
      FROM preventure_research_assignments AS assignments
      JOIN preventure_research_terminal_recoveries AS recoveries
        ON recoveries.authority_hash = assignments.authority_hash
      WHERE assignments.task_id = OLD.id
    )
    BEGIN
      SELECT RAISE(ABORT, 'Terminal retained-output custody freezes later execution and cost projections.');
    END
  `,
  trg_preventure_research_terminal_recovery_workflow_update: `
    CREATE TRIGGER IF NOT EXISTS trg_preventure_research_terminal_recovery_workflow_update
    BEFORE UPDATE ON workflows
    WHEN EXISTS (
      SELECT 1
      FROM preventure_research_assignments AS assignments
      JOIN preventure_research_terminal_recoveries AS recoveries
        ON recoveries.authority_hash = assignments.authority_hash
      WHERE assignments.workflow_id IN (OLD.id, NEW.id)
    )
    BEGIN
      SELECT RAISE(ABORT, 'Terminal custody freezes every assignment workflow in its authority.');
    END
  `,
  trg_preventure_research_terminal_recovery_workflow_delete: `
    CREATE TRIGGER IF NOT EXISTS trg_preventure_research_terminal_recovery_workflow_delete
    BEFORE DELETE ON workflows
    WHEN EXISTS (
      SELECT 1
      FROM preventure_research_assignments AS assignments
      JOIN preventure_research_terminal_recoveries AS recoveries
        ON recoveries.authority_hash = assignments.authority_hash
      WHERE assignments.workflow_id = OLD.id
    )
    BEGIN
      SELECT RAISE(ABORT, 'Terminal retained-output custody freezes later execution and cost projections.');
    END
  `,
  trg_preventure_research_terminal_recovery_cost_event_insert: `
    CREATE TRIGGER IF NOT EXISTS trg_preventure_research_terminal_recovery_cost_event_insert
    BEFORE INSERT ON preventure_research_cost_events
    WHEN (
      EXISTS (
        SELECT 1 FROM preventure_research_terminal_recoveries AS recoveries
        WHERE recoveries.authority_hash = NEW.authority_hash
      )
      OR EXISTS (
        SELECT 1 FROM preventure_research_authorities AS authorities
        WHERE authorities.authority_hash = NEW.authority_hash
          AND julianday(pantheon_current_time()) >= julianday(authorities.expires_at)
      )
      OR
      EXISTS (
        SELECT 1
        FROM preventure_research_lifecycle_events AS lifecycle
        WHERE lifecycle.authority_hash = NEW.authority_hash
          AND lifecycle.sequence = (
            SELECT MAX(sequence) FROM preventure_research_lifecycle_events
            WHERE authority_hash = NEW.authority_hash
          )
          AND lifecycle.event_type IN ('revoked', 'expired')
      )
      OR EXISTS (
        SELECT 1
        FROM preventure_research_assignments AS assignments
        JOIN task_attempts AS attempts ON attempts.task_id = assignments.task_id
        WHERE assignments.assignment_hash = NEW.assignment_hash
          AND attempts.error_kind = 'operator_emergency_stop'
      )
    )
      AND NOT (
        (
          NEW.event_type = 'unknown'
          AND NEW.amount_aud_cents IS NULL
          AND json_extract(NEW.cost_json, '$.terminalRecovery.schema')
            IS 'pantheon.preventure-research-terminal-cost-transition.v1'
          AND pantheon_preventure_terminal_retained_recovery_capability(
            'cost_event_insert',
            NEW.authority_hash,
            NEW.assignment_hash,
            json_extract(NEW.cost_json, '$.terminalRecovery.recoveryIntentHash'),
            NEW.cost_id,
            NEW.receipt_hash,
            NEW.previous_receipt_hash,
            json_extract(NEW.cost_json, '$.terminalRecovery.terminalKind'),
            json_extract(NEW.cost_json, '$.terminalRecovery.terminalRecordId'),
            json_extract(NEW.cost_json, '$.terminalRecovery.terminalEventHash'),
            json_extract(NEW.cost_json, '$.terminalRecovery.artifactHash'),
            NEW.exposure_aud_cents,
            NULL,
            NEW.occurred_at
          ) = 1
        )
        OR (
          NEW.event_type = 'unknown'
          AND NEW.amount_aud_cents IS NULL
          AND NEW.exposure_aud_cents = (
            SELECT max_cost_aud_cents FROM preventure_research_assignments
            WHERE assignment_hash = NEW.assignment_hash
          )
          AND json_extract(NEW.cost_json, '$.emergencyStop.schema')
            IS 'pantheon.preventure-research-emergency-cost-transition.v1'
          AND json_extract(NEW.cost_json, '$.emergencyStop.taskAttemptId')
            IS NEW.task_attempt_id
          AND json_extract(NEW.cost_json, '$.emergencyStop.modelCallId')
            IS NEW.model_call_id
          AND json_extract(NEW.cost_json, '$.emergencyStop.priorCostReceiptHash')
            IS NEW.previous_receipt_hash
          AND json_extract(NEW.cost_json, '$.emergencyStop.providerOutcomeKnown') IS 0
          AND json_extract(NEW.cost_json, '$.emergencyStop.exactBillingPending') IS 1
          AND json_extract(NEW.cost_json, '$.emergencyStop.stoppedAt') IS NEW.occurred_at
          AND pantheon_preventure_emergency_cost_safety_capability(
            'cost_event_insert',
            (SELECT task_id FROM preventure_research_assignments
             WHERE assignment_hash = NEW.assignment_hash),
            NEW.receipt_hash,
            NEW.authority_hash,
            NEW.assignment_hash,
            NEW.exposure_aud_cents,
            NEW.occurred_at
          ) = 1
        )
        OR (
          NEW.event_type = 'reconciled'
          AND NEW.amount_aud_cents IS NOT NULL
          AND NEW.exposure_aud_cents = NEW.amount_aud_cents
          AND json_extract(NEW.cost_json, '$.ownerBillingObservationHash') IS NOT NULL
          AND pantheon_preventure_owner_billing_observation_capability(
            'guard_cost_event_insert',
            NEW.authority_hash,
            NEW.assignment_hash,
            NEW.cost_id,
            json_extract(NEW.cost_json, '$.ownerBillingObservationHash'),
            NEW.receipt_hash,
            NEW.previous_receipt_hash,
            NEW.amount_aud_cents,
            NEW.occurred_at,
            NEW.cost_json
          ) = 1
        )
      )
    BEGIN
      SELECT RAISE(ABORT, 'Terminal pre-venture cost truth only accepts its exact custody-bound unknown successor.');
    END
  `,
  trg_preventure_research_terminal_recovery_reservation_update: `
    CREATE TRIGGER IF NOT EXISTS trg_preventure_research_terminal_recovery_reservation_update
    BEFORE UPDATE ON budget_reservations
    WHEN NOT EXISTS (
      SELECT 1 FROM preventure_research_terminal_recoveries AS recoveries
      WHERE recoveries.task_id = OLD.task_id
    )
      AND (
        EXISTS (
          SELECT 1
          FROM preventure_research_assignments AS assignments
          JOIN preventure_research_lifecycle_events AS lifecycle
            ON lifecycle.authority_hash = assignments.authority_hash
          WHERE assignments.task_id = OLD.task_id
            AND lifecycle.sequence = (
              SELECT MAX(sequence) FROM preventure_research_lifecycle_events
              WHERE authority_hash = assignments.authority_hash
            )
            AND lifecycle.event_type IN ('revoked', 'expired')
        )
        OR EXISTS (
          SELECT 1
          FROM preventure_research_assignments AS assignments
          JOIN preventure_research_authorities AS authorities
            ON authorities.authority_hash = assignments.authority_hash
          WHERE assignments.task_id = OLD.task_id
            AND julianday(pantheon_current_time()) >= julianday(authorities.expires_at)
        )
        OR EXISTS (
          SELECT 1
          FROM preventure_research_assignments AS assignments
          JOIN task_attempts AS attempts ON attempts.task_id = assignments.task_id
          WHERE assignments.task_id = OLD.task_id
            AND attempts.error_kind = 'operator_emergency_stop'
        )
      )
      AND COALESCE(pantheon_preventure_owner_billing_observation_capability(
        'guard_reservation_update',
        json_extract(NEW.metadata, '$.authorityHash'),
        json_extract(NEW.metadata, '$.assignmentHash'),
        NEW.id,
        json_extract(NEW.metadata, '$.ownerBillingObservationHash'),
        json_extract(NEW.metadata, '$.ownerBillingCostReceiptHash'),
        json_extract(NEW.metadata, '$.ownerBillingPreviousReceiptHash'),
        NEW.amount_cents,
        NEW.resolved_at,
        NEW.metadata
      ), 0) <> 1
      AND (
        NEW.id IS NOT OLD.id
        OR NEW.venture_id IS NOT OLD.venture_id
        OR NEW.workflow_id IS NOT OLD.workflow_id
        OR NEW.task_id IS NOT OLD.task_id
        OR NEW.approval_id IS NOT OLD.approval_id
        OR NEW.currency IS NOT OLD.currency
        OR NEW.reserved_at IS NOT OLD.reserved_at
        OR NEW.status <> 'unknown'
        OR NEW.amount_cents <> (
          SELECT max_cost_aud_cents FROM preventure_research_assignments
          WHERE task_id = OLD.task_id
        )
        OR NEW.resolved_at IS NOT NULL
        OR (
          pantheon_preventure_terminal_retained_recovery_capability(
            'reservation_update',
            (SELECT authority_hash FROM preventure_research_assignments WHERE task_id = OLD.task_id),
            (SELECT assignment_hash FROM preventure_research_assignments WHERE task_id = OLD.task_id),
            json_extract(NEW.metadata, '$.terminalRecovery.recoveryIntentHash'),
            NEW.id,
            json_extract(NEW.metadata, '$.terminalRecovery.terminalCostReceiptHash'),
            json_extract(NEW.metadata, '$.terminalRecovery.priorCostReceiptHash'),
            json_extract(NEW.metadata, '$.terminalRecovery.terminalKind'),
            json_extract(NEW.metadata, '$.terminalRecovery.terminalRecordId'),
            json_extract(NEW.metadata, '$.terminalRecovery.terminalEventHash'),
            json_extract(NEW.metadata, '$.terminalRecovery.artifactHash'),
            NEW.amount_cents,
            NULL,
            json_extract(NEW.metadata, '$.terminalRecovery.recordedAt')
          ) <> 1
          AND pantheon_preventure_emergency_cost_safety_capability(
            'reservation_update',
            OLD.task_id,
            NEW.id,
            (SELECT authority_hash FROM preventure_research_assignments WHERE task_id = OLD.task_id),
            (SELECT assignment_hash FROM preventure_research_assignments WHERE task_id = OLD.task_id),
            NEW.amount_cents,
            json_extract(NEW.metadata, '$.stoppedAt')
          ) <> 1
        )
      )
    BEGIN
      SELECT RAISE(ABORT, 'Terminal custody requires one exact unknown full-cap reservation projection.');
    END
  `,
  trg_preventure_research_terminal_recovery_cost_update: `
    CREATE TRIGGER IF NOT EXISTS trg_preventure_research_terminal_recovery_cost_update
    BEFORE UPDATE ON costs
    WHEN NOT EXISTS (
      SELECT 1 FROM preventure_research_terminal_recoveries AS recoveries
      WHERE recoveries.task_id = OLD.task_id
    )
      AND (
        EXISTS (
          SELECT 1
          FROM preventure_research_assignments AS assignments
          JOIN preventure_research_lifecycle_events AS lifecycle
            ON lifecycle.authority_hash = assignments.authority_hash
          WHERE assignments.task_id = OLD.task_id
            AND lifecycle.sequence = (
              SELECT MAX(sequence) FROM preventure_research_lifecycle_events
              WHERE authority_hash = assignments.authority_hash
            )
            AND lifecycle.event_type IN ('revoked', 'expired')
        )
        OR EXISTS (
          SELECT 1
          FROM preventure_research_assignments AS assignments
          JOIN preventure_research_authorities AS authorities
            ON authorities.authority_hash = assignments.authority_hash
          WHERE assignments.task_id = OLD.task_id
            AND julianday(pantheon_current_time()) >= julianday(authorities.expires_at)
        )
        OR EXISTS (
          SELECT 1
          FROM preventure_research_assignments AS assignments
          JOIN task_attempts AS attempts ON attempts.task_id = assignments.task_id
          WHERE assignments.task_id = OLD.task_id
            AND attempts.error_kind = 'operator_emergency_stop'
        )
      )
      AND COALESCE(pantheon_preventure_owner_billing_observation_capability(
        'guard_cost_update',
        json_extract(NEW.metadata, '$.authorityHash'),
        json_extract(NEW.metadata, '$.assignmentHash'),
        NEW.id,
        json_extract(NEW.metadata, '$.ownerBillingObservationHash'),
        json_extract(NEW.metadata, '$.ownerBillingCostReceiptHash'),
        json_extract(NEW.metadata, '$.ownerBillingPreviousReceiptHash'),
        NEW.amount_cents,
        NEW.occurred_at,
        NEW.metadata
      ), 0) <> 1
      AND (
        NEW.id IS NOT OLD.id
        OR NEW.workflow_id IS NOT OLD.workflow_id
        OR NEW.venture_id IS NOT OLD.venture_id
        OR NEW.run_id IS NOT OLD.run_id
        OR NEW.task_id IS NOT OLD.task_id
        OR NEW.category IS NOT OLD.category
        OR NEW.source IS NOT OLD.source
        OR NEW.currency IS NOT OLD.currency
        OR NEW.occurred_at IS NOT OLD.occurred_at
        OR NEW.status <> 'unknown'
        OR NEW.amount_cents <> (
          SELECT max_cost_aud_cents FROM preventure_research_assignments
          WHERE task_id = OLD.task_id
        )
        OR (
          pantheon_preventure_terminal_retained_recovery_capability(
            'cost_update',
            (SELECT authority_hash FROM preventure_research_assignments WHERE task_id = OLD.task_id),
            (SELECT assignment_hash FROM preventure_research_assignments WHERE task_id = OLD.task_id),
            json_extract(NEW.metadata, '$.terminalRecovery.recoveryIntentHash'),
            NEW.id,
            json_extract(NEW.metadata, '$.terminalRecovery.terminalCostReceiptHash'),
            json_extract(NEW.metadata, '$.terminalRecovery.priorCostReceiptHash'),
            json_extract(NEW.metadata, '$.terminalRecovery.terminalKind'),
            json_extract(NEW.metadata, '$.terminalRecovery.terminalRecordId'),
            json_extract(NEW.metadata, '$.terminalRecovery.terminalEventHash'),
            json_extract(NEW.metadata, '$.terminalRecovery.artifactHash'),
            NEW.amount_cents,
            NULL,
            json_extract(NEW.metadata, '$.terminalRecovery.recordedAt')
          ) <> 1
          AND pantheon_preventure_emergency_cost_safety_capability(
            'cost_update',
            OLD.task_id,
            NEW.id,
            (SELECT authority_hash FROM preventure_research_assignments WHERE task_id = OLD.task_id),
            (SELECT assignment_hash FROM preventure_research_assignments WHERE task_id = OLD.task_id),
            NEW.amount_cents,
            json_extract(NEW.metadata, '$.stoppedAt')
          ) <> 1
        )
      )
    BEGIN
      SELECT RAISE(ABORT, 'Terminal custody requires one exact unknown full-cap cost projection.');
    END
  `,
  trg_preventure_research_terminal_recovery_model_call_update: `
    CREATE TRIGGER IF NOT EXISTS trg_preventure_research_terminal_recovery_model_call_update
    BEFORE UPDATE OF cost_status, reserved_cost_cents, actual_cost_cents,
                     reconciled_cost_cents, metadata ON model_calls
    WHEN NOT EXISTS (
      SELECT 1 FROM preventure_research_terminal_recoveries AS recoveries
      WHERE recoveries.task_id = OLD.task_id
    )
      AND (
        EXISTS (
          SELECT 1
          FROM preventure_research_assignments AS assignments
          JOIN preventure_research_lifecycle_events AS lifecycle
            ON lifecycle.authority_hash = assignments.authority_hash
          WHERE assignments.task_id = OLD.task_id
            AND lifecycle.sequence = (
              SELECT MAX(sequence) FROM preventure_research_lifecycle_events
              WHERE authority_hash = assignments.authority_hash
            )
            AND lifecycle.event_type IN ('revoked', 'expired')
        )
        OR EXISTS (
          SELECT 1
          FROM preventure_research_assignments AS assignments
          JOIN preventure_research_authorities AS authorities
            ON authorities.authority_hash = assignments.authority_hash
          WHERE assignments.task_id = OLD.task_id
            AND julianday(pantheon_current_time()) >= julianday(authorities.expires_at)
        )
        OR EXISTS (
          SELECT 1
          FROM preventure_research_assignments AS assignments
          JOIN task_attempts AS attempts ON attempts.task_id = assignments.task_id
          WHERE assignments.task_id = OLD.task_id
            AND attempts.error_kind = 'operator_emergency_stop'
        )
      )
      AND COALESCE(pantheon_preventure_owner_billing_observation_capability(
        'guard_model_call_update',
        json_extract(NEW.metadata, '$.authorityHash'),
        json_extract(NEW.metadata, '$.assignmentHash'),
        NEW.id,
        json_extract(NEW.metadata, '$.ownerBillingObservationHash'),
        json_extract(NEW.metadata, '$.ownerBillingCostReceiptHash'),
        json_extract(NEW.metadata, '$.ownerBillingPreviousReceiptHash'),
        NEW.actual_cost_cents,
        json_extract(NEW.metadata, '$.ownerBillingRecordedAt'),
        NEW.metadata
      ), 0) <> 1
      AND (
        NEW.cost_status <> 'unknown'
        OR NEW.reserved_cost_cents <> (
          SELECT max_cost_aud_cents FROM preventure_research_assignments
          WHERE task_id = OLD.task_id
        )
        OR NEW.actual_cost_cents <> 0
        OR NEW.reconciled_cost_cents <> 0
        OR (
          pantheon_preventure_terminal_retained_recovery_capability(
            'model_call_update',
            (SELECT authority_hash FROM preventure_research_assignments WHERE task_id = OLD.task_id),
            (SELECT assignment_hash FROM preventure_research_assignments WHERE task_id = OLD.task_id),
            json_extract(NEW.metadata, '$.terminalRecovery.recoveryIntentHash'),
            NEW.id,
            json_extract(NEW.metadata, '$.terminalRecovery.terminalCostReceiptHash'),
            json_extract(NEW.metadata, '$.terminalRecovery.priorCostReceiptHash'),
            json_extract(NEW.metadata, '$.terminalRecovery.terminalKind'),
            json_extract(NEW.metadata, '$.terminalRecovery.terminalRecordId'),
            json_extract(NEW.metadata, '$.terminalRecovery.terminalEventHash'),
            json_extract(NEW.metadata, '$.terminalRecovery.artifactHash'),
            NEW.reserved_cost_cents,
            NULL,
            json_extract(NEW.metadata, '$.terminalRecovery.recordedAt')
          ) <> 1
          AND pantheon_preventure_emergency_cost_safety_capability(
            'model_call_update',
            OLD.task_id,
            NEW.id,
            (SELECT authority_hash FROM preventure_research_assignments WHERE task_id = OLD.task_id),
            (SELECT assignment_hash FROM preventure_research_assignments WHERE task_id = OLD.task_id),
            NEW.reserved_cost_cents,
            json_extract(NEW.metadata, '$.stoppedAt')
          ) <> 1
        )
      )
    BEGIN
      SELECT RAISE(ABORT, 'Terminal custody requires one exact unknown full-cap model projection.');
    END
  `,
  trg_preventure_research_terminal_recovery_admission_insert: `
    CREATE TRIGGER IF NOT EXISTS trg_preventure_research_terminal_recovery_admission_insert
    BEFORE INSERT ON preventure_research_terminal_recoveries
    WHEN pantheon_preventure_terminal_retained_recovery_capability(
        'recovery_insert',
        NEW.authority_hash,
        NEW.assignment_hash,
        NEW.recovery_hash,
        NEW.task_attempt_id,
        NEW.terminal_cost_receipt_hash,
        NEW.prior_cost_receipt_hash,
        NEW.terminal_kind,
        NEW.terminal_record_id,
        NEW.terminal_event_hash,
        NEW.artifact_hash,
        NEW.assignment_cap_aud_cents,
        NEW.recovery_json,
        NEW.recorded_at
      ) <> 1
      OR NOT EXISTS (
        SELECT 1
        FROM preventure_research_assignments AS assignments
        WHERE assignments.authority_hash = NEW.authority_hash
          AND assignments.assignment_hash = NEW.assignment_hash
          AND assignments.template_hash = NEW.assignment_template_hash
          AND assignments.max_cost_aud_cents = NEW.assignment_cap_aud_cents
          AND assignments.task_id = NEW.task_id
          AND assignments.workflow_id = NEW.workflow_id
      )
      OR NOT EXISTS (
        SELECT 1
        FROM preventure_research_assignments AS assignments
        JOIN task_attempts AS attempts ON attempts.task_id = assignments.task_id
        JOIN model_calls AS calls ON calls.id = NEW.model_call_id
        WHERE assignments.assignment_hash = NEW.assignment_hash
          AND attempts.id = NEW.task_attempt_id
          AND attempts.workflow_id = NEW.workflow_id
          AND attempts.venture_id IS NULL
          AND attempts.provider_dispatched_at = NEW.provider_dispatched_at
          AND attempts.provider_dispatch_model_call_id = NEW.model_call_id
          AND calls.task_id = NEW.task_id
          AND calls.workflow_id = NEW.workflow_id
          AND calls.venture_id IS NULL
          AND calls.attempt_id = NEW.task_attempt_id
          AND calls.provider = assignments.provider_id
          AND calls.selected_model = assignments.provider_model
      )
      OR julianday(NEW.provider_dispatched_at) >= julianday((
        SELECT expires_at FROM preventure_research_authorities
        WHERE authority_hash = NEW.authority_hash
      ))
      OR NOT EXISTS (
        SELECT 1
        FROM preventure_research_cost_events AS terminal_cost
        WHERE terminal_cost.receipt_hash = NEW.terminal_cost_receipt_hash
          AND terminal_cost.authority_hash = NEW.authority_hash
          AND terminal_cost.assignment_hash = NEW.assignment_hash
          AND terminal_cost.cost_key = NEW.cost_key
          AND terminal_cost.event_type = 'unknown'
          AND terminal_cost.amount_aud_cents IS NULL
          AND terminal_cost.exposure_aud_cents = NEW.assignment_cap_aud_cents
          AND terminal_cost.task_attempt_id = NEW.task_attempt_id
          AND terminal_cost.model_call_id = NEW.model_call_id
          AND terminal_cost.budget_reservation_id = NEW.budget_reservation_id
          AND terminal_cost.cost_id = NEW.cost_id
          AND NOT EXISTS (
            SELECT 1 FROM preventure_research_cost_events AS later
            WHERE later.assignment_hash = terminal_cost.assignment_hash
              AND later.cost_key = terminal_cost.cost_key
              AND later.sequence > terminal_cost.sequence
          )
      )
      OR NOT EXISTS (
        SELECT 1 FROM budget_reservations AS reservations
        WHERE reservations.id = NEW.budget_reservation_id
          AND reservations.task_id = NEW.task_id
          AND reservations.workflow_id = NEW.workflow_id
          AND reservations.venture_id IS NULL
          AND reservations.status = 'unknown'
          AND reservations.amount_cents = NEW.assignment_cap_aud_cents
          AND reservations.currency = 'AUD'
      )
      OR NOT EXISTS (
        SELECT 1 FROM costs
        WHERE costs.id = NEW.cost_id
          AND costs.task_id = NEW.task_id
          AND costs.workflow_id = NEW.workflow_id
          AND costs.venture_id IS NULL
          AND costs.model_call_id = NEW.model_call_id
          AND costs.status = 'unknown'
          AND costs.amount_cents = NEW.assignment_cap_aud_cents
          AND costs.currency = 'AUD'
      )
      OR (
        NEW.terminal_kind = 'lifecycle'
        AND NOT EXISTS (
          SELECT 1 FROM preventure_research_lifecycle_events AS lifecycle
          WHERE lifecycle.authority_hash = NEW.authority_hash
            AND lifecycle.id = NEW.lifecycle_event_id
            AND lifecycle.event_hash = NEW.terminal_event_hash
            AND lifecycle.event_type = NEW.terminal_event_type
            AND lifecycle.event_type IN ('revoked', 'expired')
            AND lifecycle.sequence = (
              SELECT MAX(sequence) FROM preventure_research_lifecycle_events
              WHERE authority_hash = NEW.authority_hash
            )
            AND NEW.terminal_at = CASE lifecycle.event_type
              WHEN 'expired' THEN (
                SELECT expires_at FROM preventure_research_authorities
                WHERE authority_hash = NEW.authority_hash
              )
              ELSE lifecycle.occurred_at
            END
        )
      )
      OR (
        NEW.terminal_kind = 'runtime_emergency_stop'
        AND NOT EXISTS (
          SELECT 1 FROM events AS emergency
          JOIN task_attempts AS attempts ON attempts.id = NEW.task_attempt_id
          JOIN tasks ON tasks.id = NEW.task_id
          WHERE emergency.id = NEW.emergency_event_id
            AND emergency.type = 'runtime.emergency_stop_recorded'
            AND emergency.ts = NEW.terminal_at
            AND EXISTS (
              SELECT 1 FROM json_each(emergency.metadata, '$.affectedTaskIds') AS affected
              WHERE affected.value = NEW.task_id
            )
            AND attempts.error_kind = 'operator_emergency_stop'
            AND json_extract(attempts.metadata, '$.emergencyStop') = 1
            AND json_extract(attempts.metadata, '$.claimInvalidated') = 1
            AND tasks.claim_token IS NULL
            AND json_extract(tasks.result, '$.emergencyStop') = 1
            AND json_extract(tasks.result, '$.claimInvalidated') = 1
        )
      )
      OR EXISTS (
        SELECT 1 FROM preventure_research_decisions
        WHERE authority_hash = NEW.authority_hash
      )
      OR EXISTS (
        SELECT 1 FROM preventure_research_terminal_stops
        WHERE authority_hash = NEW.authority_hash
      )
      OR EXISTS (
        SELECT 1 FROM preventure_research_source_snapshots
        WHERE assignment_hash = NEW.assignment_hash
      )
      OR EXISTS (
        SELECT 1 FROM preventure_research_evidence_records
        WHERE assignment_hash = NEW.assignment_hash
      )
      OR (
        NEW.agent_run_receipt_id IS NULL
        AND EXISTS (SELECT 1 FROM agent_run_receipts WHERE attempt_id = NEW.task_attempt_id)
      )
      OR (
        NEW.agent_run_receipt_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM agent_run_receipts AS receipts
          WHERE receipts.id = NEW.agent_run_receipt_id
            AND receipts.attempt_id = NEW.task_attempt_id
            AND receipts.task_id = NEW.task_id
            AND 'sha256:' || receipts.receipt_hash = NEW.agent_run_receipt_hash
            AND receipts.status = NEW.agent_run_receipt_status
            AND receipts.outcome_status = NEW.agent_run_receipt_outcome_status
            AND NOT EXISTS (
              SELECT 1 FROM agent_run_receipts AS later
              WHERE later.attempt_id = receipts.attempt_id
                AND (later.created_at > receipts.created_at
                  OR (later.created_at = receipts.created_at AND later.id > receipts.id))
            )
        )
      )
    BEGIN
      SELECT RAISE(ABORT, 'Terminal retained-output recovery must match exact dispatch, terminal, artifact, and unknown cost truth.');
    END
  `,
  trg_preventure_research_terminal_recovery_source_insert: `
    CREATE TRIGGER IF NOT EXISTS trg_preventure_research_terminal_recovery_source_insert
    BEFORE INSERT ON preventure_research_source_snapshots
    WHEN EXISTS (
      SELECT 1 FROM preventure_research_terminal_recoveries
      WHERE authority_hash = NEW.authority_hash
    )
    BEGIN
      SELECT RAISE(ABORT, 'Terminal custody is not commercial evidence.');
    END
  `,
  trg_preventure_research_terminal_recovery_evidence_insert: `
    CREATE TRIGGER IF NOT EXISTS trg_preventure_research_terminal_recovery_evidence_insert
    BEFORE INSERT ON preventure_research_evidence_records
    WHEN EXISTS (
      SELECT 1 FROM preventure_research_terminal_recoveries
      WHERE authority_hash = NEW.authority_hash
    )
    BEGIN
      SELECT RAISE(ABORT, 'Terminal custody cannot create commercial evidence.');
    END
  `,
  trg_preventure_research_terminal_recovery_decision_insert: `
    CREATE TRIGGER IF NOT EXISTS trg_preventure_research_terminal_recovery_decision_insert
    BEFORE INSERT ON preventure_research_decisions
    WHEN EXISTS (
      SELECT 1 FROM preventure_research_terminal_recoveries
      WHERE authority_hash = NEW.authority_hash
    )
    BEGIN
      SELECT RAISE(ABORT, 'Terminal custody cannot create a diligence decision.');
    END
  `,
  trg_preventure_research_terminal_recovery_completion_insert: `
    CREATE TRIGGER IF NOT EXISTS trg_preventure_research_terminal_recovery_completion_insert
    BEFORE INSERT ON preventure_research_lifecycle_events
    WHEN NEW.event_type = 'completed'
      AND EXISTS (
        SELECT 1 FROM preventure_research_terminal_recoveries
        WHERE authority_hash = NEW.authority_hash
      )
    BEGIN
      SELECT RAISE(ABORT, 'Terminal custody cannot complete the diligence lifecycle.');
    END
  `,
  trg_preventure_research_skipped_task_state_update: `
    CREATE TRIGGER IF NOT EXISTS trg_preventure_research_skipped_task_state_update
    BEFORE UPDATE OF status, outcome_status, attempt_count, claim_token, claimed_at,
                     cost_actual_cents ON tasks
    WHEN EXISTS (
      SELECT 1 FROM preventure_research_assignment_skips AS skips
      WHERE skips.task_id = OLD.id
    )
      AND (
        NEW.status <> 'skipped'
        OR NEW.outcome_status <> 'not_started'
        OR NEW.attempt_count <> 0
        OR NEW.claim_token IS NOT NULL
        OR NEW.claimed_at IS NOT NULL
        OR NEW.cost_actual_cents <> 0
      )
    BEGIN
      SELECT RAISE(ABORT, 'A skipped pre-venture assignment task must remain untouched.');
    END
  `,
  trg_preventure_research_skipped_cost_event_insert: `
    CREATE TRIGGER IF NOT EXISTS trg_preventure_research_skipped_cost_event_insert
    BEFORE INSERT ON preventure_research_cost_events
    WHEN EXISTS (
      SELECT 1 FROM preventure_research_assignment_skips AS skips
      WHERE skips.assignment_hash = NEW.assignment_hash
    )
    BEGIN
      SELECT RAISE(ABORT, 'A skipped pre-venture assignment cannot acquire a cost event.');
    END
  `,
  trg_preventure_research_skipped_source_insert: `
    CREATE TRIGGER IF NOT EXISTS trg_preventure_research_skipped_source_insert
    BEFORE INSERT ON preventure_research_source_snapshots
    WHEN EXISTS (
      SELECT 1 FROM preventure_research_assignment_skips AS skips
      WHERE skips.assignment_hash = NEW.assignment_hash
    )
    BEGIN
      SELECT RAISE(ABORT, 'A skipped pre-venture assignment cannot acquire a source snapshot.');
    END
  `,
  trg_preventure_research_skipped_evidence_insert: `
    CREATE TRIGGER IF NOT EXISTS trg_preventure_research_skipped_evidence_insert
    BEFORE INSERT ON preventure_research_evidence_records
    WHEN EXISTS (
      SELECT 1 FROM preventure_research_assignment_skips AS skips
      WHERE skips.assignment_hash = NEW.assignment_hash
    )
    BEGIN
      SELECT RAISE(ABORT, 'A skipped pre-venture assignment cannot acquire evidence.');
    END
  `,
  trg_preventure_research_terminal_stop_admission_insert: `
    CREATE TRIGGER IF NOT EXISTS trg_preventure_research_terminal_stop_admission_insert
    BEFORE INSERT ON preventure_research_terminal_stops
    WHEN pantheon_preventure_validated_early_stop_capability(
        NEW.authority_hash,
        NEW.early_stop_record_hash,
        NEW.expected_decision_id,
        NEW.expected_completion_event_id,
        json_array_length(NEW.skipped_assignments_json)
      ) <> 1
      OR NOT EXISTS (
        SELECT 1 FROM preventure_research_authorities
        WHERE authority_hash = NEW.authority_hash
      )
      OR 'activated' <> (
        SELECT event_type FROM preventure_research_lifecycle_events
        WHERE authority_hash = NEW.authority_hash
        ORDER BY sequence DESC LIMIT 1
      )
      OR julianday(pantheon_current_time()) >= julianday((
        SELECT expires_at FROM preventure_research_authorities
        WHERE authority_hash = NEW.authority_hash
      ))
      OR julianday(NEW.stopped_at) > julianday(pantheon_current_time())
      OR julianday(NEW.stopped_at) < julianday((
        SELECT approved_at FROM preventure_research_authorities
        WHERE authority_hash = NEW.authority_hash
      ))
      OR julianday(NEW.stopped_at) >= julianday((
        SELECT expires_at FROM preventure_research_authorities
        WHERE authority_hash = NEW.authority_hash
      ))
      OR NOT EXISTS (
        SELECT 1 FROM preventure_research_assignments AS assignments
        WHERE assignments.authority_hash = NEW.authority_hash
          AND assignments.assignment_id = NEW.trigger_assignment_id
          AND assignments.assignment_hash = NEW.trigger_assignment_hash
      )
      OR NEW.expected_decision_id <> (
        SELECT authority_id || '_decision'
        FROM preventure_research_authorities
        WHERE authority_hash = NEW.authority_hash
      )
      OR NEW.expected_completion_event_id <> (
        SELECT authority_id || '_completed'
        FROM preventure_research_authorities
        WHERE authority_hash = NEW.authority_hash
      )
      OR EXISTS (
        SELECT 1 FROM preventure_research_terminal_stops
        WHERE authority_hash = NEW.authority_hash
      )
      OR EXISTS (
        SELECT 1 FROM preventure_research_decisions
        WHERE authority_hash = NEW.authority_hash
      )
      OR json_array_length(NEW.skipped_assignments_json) <> (
        SELECT json_array_length(authorities.authority_json, '$.assignments')
                 - 1 - CAST(trigger_template.key AS INTEGER)
        FROM preventure_research_authorities AS authorities,
             json_each(authorities.authority_json, '$.assignments') AS trigger_template
        WHERE authorities.authority_hash = NEW.authority_hash
          AND json_extract(trigger_template.value, '$.id') = NEW.trigger_assignment_id
      )
      OR EXISTS (
        SELECT 1
        FROM json_each(NEW.skipped_assignments_json) AS skipped
        WHERE NOT EXISTS (
          SELECT 1
          FROM preventure_research_authorities AS authorities,
               json_each(authorities.authority_json, '$.assignments') AS template
          JOIN preventure_research_assignments AS assignments
            ON assignments.authority_hash = authorities.authority_hash
           AND assignments.assignment_id = json_extract(template.value, '$.id')
          WHERE authorities.authority_hash = NEW.authority_hash
            AND CAST(template.key AS INTEGER) > (
              SELECT CAST(trigger_template.key AS INTEGER)
              FROM json_each(authorities.authority_json, '$.assignments') AS trigger_template
              WHERE json_extract(trigger_template.value, '$.id') = NEW.trigger_assignment_id
            )
            AND json_extract(skipped.value, '$.authorityHash') = NEW.authority_hash
            AND json_extract(skipped.value, '$.terminalStopId') = NEW.terminal_stop_id
            AND json_extract(skipped.value, '$.triggerAssignmentHash') = NEW.trigger_assignment_hash
            AND json_extract(skipped.value, '$.assignmentId') = assignments.assignment_id
            AND json_extract(skipped.value, '$.assignmentHash') = assignments.assignment_hash
            AND json_extract(skipped.value, '$.assignmentOrder') = CAST(template.key AS INTEGER) + 1
            AND json_extract(skipped.value, '$.taskId') = assignments.task_id
            AND json_extract(skipped.value, '$.dispatchState') = 'not_dispatched'
            AND json_extract(skipped.value, '$.taskAttemptCount') = 0
            AND json_extract(skipped.value, '$.modelCallCount') = 0
            AND json_extract(skipped.value, '$.agentRunReceiptCount') = 0
            AND json_extract(skipped.value, '$.researchRunCount') = 0
            AND json_extract(skipped.value, '$.agentRunCount') = 0
            AND json_extract(skipped.value, '$.toolInvocationCount') = 0
            AND json_extract(skipped.value, '$.budgetReservationCount') = 0
            AND json_extract(skipped.value, '$.costRecordCount') = 0
            AND json_extract(skipped.value, '$.costEventCount') = 0
            AND json_extract(skipped.value, '$.sourceSnapshotCount') = 0
            AND json_extract(skipped.value, '$.evidenceRecordCount') = 0
            AND json_extract(skipped.value, '$.totalAudCostCents') = 0
        )
      )
      OR EXISTS (
        SELECT 1
        FROM preventure_research_authorities AS authorities,
             json_each(authorities.authority_json, '$.assignments') AS template
        WHERE authorities.authority_hash = NEW.authority_hash
          AND CAST(template.key AS INTEGER) > (
            SELECT CAST(trigger_template.key AS INTEGER)
            FROM json_each(authorities.authority_json, '$.assignments') AS trigger_template
            WHERE json_extract(trigger_template.value, '$.id') = NEW.trigger_assignment_id
          )
          AND NOT EXISTS (
            SELECT 1 FROM json_each(NEW.skipped_assignments_json) AS skipped
            WHERE json_extract(skipped.value, '$.assignmentId')
              = json_extract(template.value, '$.id')
          )
      )
    BEGIN
      SELECT RAISE(ABORT, 'A pre-venture terminal stop must bind the exact untouched authority-order suffix.');
    END
  `,
  trg_preventure_research_assignment_skip_admission_insert: `
    CREATE TRIGGER IF NOT EXISTS trg_preventure_research_assignment_skip_admission_insert
    BEFORE INSERT ON preventure_research_assignment_skips
    WHEN NOT EXISTS (
        SELECT 1
        FROM preventure_research_terminal_stops AS stops,
             json_each(stops.skipped_assignments_json) AS expected
        WHERE stops.authority_hash = NEW.authority_hash
          AND stops.terminal_stop_id = NEW.terminal_stop_id
          AND json_extract(expected.value, '$.skipRecordHash') = NEW.skip_record_hash
          AND json(expected.value) = json(NEW.skip_json)
      )
      OR EXISTS (
        SELECT 1 FROM preventure_research_decisions
        WHERE authority_hash = NEW.authority_hash
      )
      OR NOT EXISTS (
        SELECT 1 FROM tasks
        WHERE id = NEW.task_id
          AND status = 'skipped'
          AND outcome_status = 'not_started'
          AND attempt_count = 0
          AND claim_token IS NULL
          AND claimed_at IS NULL
          AND cost_actual_cents = 0
      )
      OR EXISTS (SELECT 1 FROM task_attempts WHERE task_id = NEW.task_id)
      OR EXISTS (SELECT 1 FROM model_calls WHERE task_id = NEW.task_id)
      OR EXISTS (SELECT 1 FROM agent_run_receipts WHERE task_id = NEW.task_id)
      OR EXISTS (SELECT 1 FROM research_runs WHERE task_id = NEW.task_id)
      OR EXISTS (SELECT 1 FROM agent_runs WHERE task_id = NEW.task_id)
      OR EXISTS (SELECT 1 FROM agent_tool_invocations WHERE task_id = NEW.task_id)
      OR EXISTS (SELECT 1 FROM agent_eval_results WHERE task_id = NEW.task_id)
      OR EXISTS (SELECT 1 FROM agent_run_provenance WHERE task_id = NEW.task_id)
      OR EXISTS (SELECT 1 FROM budget_reservations WHERE task_id = NEW.task_id)
      OR EXISTS (SELECT 1 FROM costs WHERE task_id = NEW.task_id)
      OR EXISTS (
        SELECT 1 FROM preventure_research_cost_events
        WHERE assignment_hash = NEW.assignment_hash
      )
      OR EXISTS (
        SELECT 1 FROM preventure_research_source_snapshots
        WHERE assignment_hash = NEW.assignment_hash
      )
      OR EXISTS (
        SELECT 1 FROM preventure_research_evidence_records
        WHERE assignment_hash = NEW.assignment_hash
      )
    BEGIN
      SELECT RAISE(ABORT, 'A skipped pre-venture assignment must be the exact zero-activity suffix record.');
    END
  `,
  trg_preventure_research_completed_stop_pair_insert: `
    CREATE TRIGGER IF NOT EXISTS trg_preventure_research_completed_stop_pair_insert
    BEFORE INSERT ON preventure_research_lifecycle_events
    WHEN NEW.event_type = 'completed'
      AND EXISTS (
        SELECT 1 FROM preventure_research_decisions AS decisions
        WHERE decisions.decision_hash = NEW.decision_hash
          AND decisions.completion_mode = 'validated_early_stop'
      )
      AND NOT EXISTS (
        SELECT 1
        FROM preventure_research_decisions AS decisions
        JOIN preventure_research_terminal_stops AS stops
          ON stops.authority_hash = decisions.authority_hash
         AND stops.early_stop_record_hash = decisions.early_stop_record_hash
        WHERE decisions.decision_hash = NEW.decision_hash
          AND decisions.authority_hash = NEW.authority_hash
          AND stops.expected_decision_id = decisions.decision_id
          AND stops.expected_completion_event_id = NEW.id
      )
    BEGIN
      SELECT RAISE(ABORT, 'The completed lifecycle event does not match its exact terminal stop and decision.');
    END
  `,
  trg_preventure_research_source_capture_grade_insert: `
    CREATE TRIGGER IF NOT EXISTS trg_preventure_research_source_capture_grade_insert
    BEFORE INSERT ON preventure_research_source_snapshots
    WHEN NEW.capture_status = 'captured'
    BEGIN
      SELECT RAISE(
        ABORT,
        'Web-search-only pre-venture research cannot claim independently captured page content.'
      );
    END
  `,
  trg_preventure_research_approval_pending_insert: `
    CREATE TRIGGER IF NOT EXISTS trg_preventure_research_approval_pending_insert
    BEFORE INSERT ON approvals
    WHEN (
      (
        json_valid(NEW.scope)
        AND json_extract(NEW.scope, '$.schema') IN (
          'pantheon.preventure-research-approval-scope.v1',
          'pantheon.preventure-research-approval-scope.v2'
        )
      )
      OR (
        json_valid(NEW.payload)
        AND json_extract(
          NEW.payload,
          '$.preventureResearchApprovalScope.schema'
        ) IN (
          'pantheon.preventure-research-approval-scope.v1',
          'pantheon.preventure-research-approval-scope.v2'
        )
      )
    )
      AND (
        NEW.status <> 'pending'
        OR NEW.requested_by <> 'jarvis'
        OR NEW.decided_at IS NOT NULL
        OR NEW.decided_by IS NOT NULL
        OR NEW.consumed_at IS NOT NULL
      )
    BEGIN
      SELECT RAISE(ABORT, 'Pre-venture owner approvals must enter through the exact pending decision path.');
    END
  `,
  trg_preventure_research_approval_decision_update: `
    CREATE TRIGGER IF NOT EXISTS trg_preventure_research_approval_decision_update
    BEFORE UPDATE OF status, decided_at, decided_by ON approvals
    WHEN (
      (
        json_valid(OLD.scope)
        AND json_extract(OLD.scope, '$.schema') IN (
          'pantheon.preventure-research-approval-scope.v1',
          'pantheon.preventure-research-approval-scope.v2'
        )
      )
      OR (
        json_valid(OLD.payload)
        AND json_extract(
          OLD.payload,
          '$.preventureResearchApprovalScope.schema'
        ) IN (
          'pantheon.preventure-research-approval-scope.v1',
          'pantheon.preventure-research-approval-scope.v2'
        )
      )
    )
      AND NEW.status IN ('approved', 'needs_changes', 'rejected')
      AND (
        OLD.status <> 'pending'
        OR OLD.decided_at IS NOT NULL
        OR OLD.decided_by IS NOT NULL
        OR NEW.requested_by <> 'jarvis'
        OR NEW.decided_at IS NULL
        OR NEW.decided_by <> 'owner'
        OR pantheon_preventure_owner_attestation_capability(
          'approval_update',
          NEW.id,
          COALESCE(
            json_extract(NEW.scope, '$.authority.hash'),
            json_extract(NEW.payload, '$.preventureResearchApprovalScope.authority.hash')
          ),
          COALESCE(
            json_extract(NEW.scope, '$.eventType'),
            json_extract(NEW.payload, '$.preventureResearchApprovalScope.eventType')
          ),
          NEW.scope_hash,
          NEW.status,
          NEW.decided_at,
          NULL
        ) <> 1
      )
    BEGIN
      SELECT RAISE(ABORT, 'Pre-venture owner approval decision identity is invalid.');
    END
  `,
  trg_preventure_research_approval_attestation_insert: `
    CREATE TRIGGER IF NOT EXISTS trg_preventure_research_approval_attestation_insert
    BEFORE INSERT ON preventure_research_approval_decisions
    WHEN NEW.decision_source <> 'authenticated_owner_session_attestation'
      OR pantheon_preventure_owner_attestation_capability(
        'receipt_insert',
        NEW.approval_id,
        NEW.authority_hash,
        NEW.event_type,
        NEW.scope_hash,
        NEW.decision_status,
        NEW.decided_at,
        NEW.decision_receipt_hash
      ) <> 1
    BEGIN
      SELECT RAISE(ABORT, 'Pre-venture owner decisions require one exact authenticated local owner-session attestation.');
    END
  `,
  trg_preventure_research_workflow_venture_insert: `
    CREATE TRIGGER IF NOT EXISTS trg_preventure_research_workflow_venture_insert
    BEFORE INSERT ON workflows
    WHEN NEW.type = 'preventure_research' AND NEW.venture_id IS NOT NULL
    BEGIN
      SELECT RAISE(ABORT, 'Pre-venture research workflow must remain outside venture ownership.');
    END
  `,
  trg_preventure_research_workflow_venture_update: `
    CREATE TRIGGER IF NOT EXISTS trg_preventure_research_workflow_venture_update
    BEFORE UPDATE OF type, venture_id ON workflows
    WHEN NEW.type = 'preventure_research' AND NEW.venture_id IS NOT NULL
    BEGIN
      SELECT RAISE(ABORT, 'Pre-venture research workflow must remain outside venture ownership.');
    END
  `,
  trg_preventure_research_task_venture_insert: `
    CREATE TRIGGER IF NOT EXISTS trg_preventure_research_task_venture_insert
    BEFORE INSERT ON tasks
    WHEN NEW.kind = 'preventure_research'
      AND (
        NEW.venture_id IS NOT NULL
        OR NEW.workflow_id IS NULL
        OR NOT EXISTS (
          SELECT 1 FROM workflows
          WHERE id = NEW.workflow_id
            AND type = 'preventure_research'
            AND venture_id IS NULL
        )
      )
    BEGIN
      SELECT RAISE(ABORT, 'Pre-venture research task requires one unowned pre-venture workflow.');
    END
  `,
  trg_preventure_research_task_venture_update: `
    CREATE TRIGGER IF NOT EXISTS trg_preventure_research_task_venture_update
    BEFORE UPDATE OF kind, venture_id, workflow_id ON tasks
    WHEN NEW.kind = 'preventure_research'
      AND (
        NEW.venture_id IS NOT NULL
        OR NEW.workflow_id IS NULL
        OR NOT EXISTS (
          SELECT 1 FROM workflows
          WHERE id = NEW.workflow_id
            AND type = 'preventure_research'
            AND venture_id IS NULL
        )
      )
    BEGIN
      SELECT RAISE(ABORT, 'Pre-venture research task requires one unowned pre-venture workflow.');
    END
  `,
  ...preventureExecutionVentureGuardTriggerSql("task_attempts"),
  ...preventureExecutionVentureGuardTriggerSql("model_calls"),
  ...preventureExecutionVentureGuardTriggerSql("research_runs"),
  ...preventureExecutionVentureGuardTriggerSql("costs"),
  ...preventureExecutionVentureGuardTriggerSql("agent_runs"),
  ...preventureExecutionVentureGuardTriggerSql("budget_reservations"),
  trg_preventure_research_event_venture_insert: `
    CREATE TRIGGER IF NOT EXISTS trg_preventure_research_event_venture_insert
    BEFORE INSERT ON events
    WHEN NEW.venture_id IS NOT NULL
      AND ${preventureResearchEventOwnershipCondition()}
    BEGIN
      SELECT RAISE(ABORT, 'Pre-venture research events must remain outside venture ownership.');
    END
  `,
  trg_preventure_research_event_venture_update: `
    CREATE TRIGGER IF NOT EXISTS trg_preventure_research_event_venture_update
    BEFORE UPDATE OF venture_id, type, entity_type ON events
    WHEN NEW.venture_id IS NOT NULL
      AND ${preventureResearchEventOwnershipCondition()}
    BEGIN
      SELECT RAISE(ABORT, 'Pre-venture research events must remain outside venture ownership.');
    END
  `,
  trg_preventure_research_lifecycle_transition_insert: `
    CREATE TRIGGER IF NOT EXISTS trg_preventure_research_lifecycle_transition_insert
    BEFORE INSERT ON preventure_research_lifecycle_events
    WHEN COALESCE((
      (
        NEW.sequence = 1
        AND NEW.previous_event_hash IS NULL
        AND NEW.event_type = 'proposed'
        AND NOT EXISTS (
          SELECT 1 FROM preventure_research_lifecycle_events
          WHERE authority_hash = NEW.authority_hash
        )
      )
      OR (
        NEW.sequence > 1
        AND NEW.previous_event_hash = (
          SELECT event_hash
          FROM preventure_research_lifecycle_events
          WHERE authority_hash = NEW.authority_hash
          ORDER BY sequence DESC
          LIMIT 1
        )
        AND NEW.sequence = 1 + (
          SELECT sequence
          FROM preventure_research_lifecycle_events
          WHERE authority_hash = NEW.authority_hash
          ORDER BY sequence DESC
          LIMIT 1
        )
        AND julianday(NEW.occurred_at) >= julianday((
          SELECT occurred_at
          FROM preventure_research_lifecycle_events
          WHERE authority_hash = NEW.authority_hash
          ORDER BY sequence DESC
          LIMIT 1
        ))
        AND CASE (
          SELECT event_type
          FROM preventure_research_lifecycle_events
          WHERE authority_hash = NEW.authority_hash
          ORDER BY sequence DESC
          LIMIT 1
        )
          WHEN 'proposed' THEN NEW.event_type IN ('accepted', 'revoked', 'expired', 'revised', 'superseded')
          WHEN 'accepted' THEN NEW.event_type IN ('activated', 'revoked', 'expired', 'revised', 'superseded')
          WHEN 'activated' THEN NEW.event_type IN ('completed', 'revoked', 'expired', 'revised', 'superseded')
          ELSE 0
        END
      )
    ), 0) = 0
    BEGIN
      SELECT RAISE(ABORT, 'Pre-venture research lifecycle transition is not contiguous or allowed.');
    END
  `,
  trg_preventure_research_renewal_predecessor_terminal_insert: `
    CREATE TRIGGER IF NOT EXISTS trg_preventure_research_renewal_predecessor_terminal_insert
    BEFORE INSERT ON preventure_research_lifecycle_events
    WHEN NEW.event_type IN ('proposed', 'accepted', 'activated')
      AND EXISTS (
        SELECT 1 FROM preventure_research_authorities AS authority
        WHERE authority.authority_hash = NEW.authority_hash
          AND authority.authority_schema = 'pantheon.preventure-research-authority.v2'
      )
      AND NOT EXISTS (
        SELECT 1
        FROM preventure_research_authorities AS authority
        JOIN preventure_research_lifecycle_events AS predecessor_event
          ON predecessor_event.authority_hash = authority.supersedes_authority_hash
        WHERE authority.authority_hash = NEW.authority_hash
          AND predecessor_event.sequence = (
            SELECT MAX(sequence)
            FROM preventure_research_lifecycle_events
            WHERE authority_hash = authority.supersedes_authority_hash
          )
          AND predecessor_event.event_type IN ('completed', 'revoked', 'expired')
      )
    BEGIN
      SELECT RAISE(ABORT, 'A renewal authority requires its exact predecessor to be durably terminal.');
    END
  `,
  trg_preventure_research_lifecycle_approval_insert: `
    CREATE TRIGGER IF NOT EXISTS trg_preventure_research_lifecycle_approval_insert
    BEFORE INSERT ON preventure_research_lifecycle_events
    WHEN NEW.event_type IN ('accepted', 'activated')
      AND NOT EXISTS (
        SELECT 1
        FROM approvals
        WHERE approvals.id = NEW.approval_id
          AND approvals.status = 'approved'
          AND approvals.scope_hash = NEW.approval_scope_hash
          AND approvals.requested_by = 'jarvis'
          AND approvals.decided_by = 'owner'
          AND approvals.consumed_at IS NULL
          AND approvals.decided_at IS NOT NULL
          AND julianday(approvals.decided_at) <= julianday(NEW.occurred_at)
          AND (approvals.expires_at IS NULL OR julianday(approvals.expires_at) > julianday(NEW.occurred_at))
          AND EXISTS (
            SELECT 1
            FROM preventure_research_approval_decisions AS decisions
            WHERE decisions.approval_id = approvals.id
              AND decisions.authority_hash = NEW.authority_hash
              AND decisions.event_type = NEW.event_type
              AND decisions.scope_hash = NEW.approval_scope_hash
              AND decisions.requested_by = 'jarvis'
              AND decisions.decided_by = 'owner'
              AND decisions.decision_source = 'authenticated_owner_session_attestation'
              AND decisions.decision_status = 'approved'
              AND decisions.decided_at = NEW.occurred_at
          )
      )
    BEGIN
      SELECT RAISE(ABORT, 'Pre-venture research acceptance or activation requires one exact current approval.');
    END
  `,
  trg_preventure_research_lifecycle_cross_approval_insert: `
    CREATE TRIGGER IF NOT EXISTS trg_preventure_research_lifecycle_cross_approval_insert
    BEFORE INSERT ON preventure_research_lifecycle_events
    WHEN NEW.approval_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM commercial_test_lifecycle_events
        WHERE approval_id = NEW.approval_id
          AND event_type IN ('accepted', 'activated')
      )
    BEGIN
      SELECT RAISE(ABORT, 'An approval cannot be reused across commercial authority ledgers.');
    END
  `,
  trg_commercial_test_lifecycle_preventure_approval_insert: `
    CREATE TRIGGER IF NOT EXISTS trg_commercial_test_lifecycle_preventure_approval_insert
    BEFORE INSERT ON commercial_test_lifecycle_events
    WHEN NEW.approval_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM preventure_research_lifecycle_events
        WHERE approval_id = NEW.approval_id
          AND event_type IN ('accepted', 'activated')
      )
    BEGIN
      SELECT RAISE(ABORT, 'An approval cannot be reused across commercial authority ledgers.');
    END
  `,
  trg_preventure_research_activation_guard_insert: `
    CREATE TRIGGER IF NOT EXISTS trg_preventure_research_activation_guard_insert
    BEFORE INSERT ON preventure_research_lifecycle_events
    WHEN NEW.event_type = 'activated'
      AND (
        julianday(pantheon_current_time()) >= julianday((
          SELECT expires_at FROM preventure_research_authorities
          WHERE authority_hash = NEW.authority_hash
        ))
        OR
        julianday(NEW.occurred_at) > julianday((
          SELECT expires_at FROM preventure_research_authorities
          WHERE authority_hash = NEW.authority_hash
        ))
        OR EXISTS (
          SELECT 1
          FROM preventure_research_authorities AS authorities
          WHERE authorities.authority_hash <> NEW.authority_hash
            AND (
              SELECT event_type
              FROM preventure_research_lifecycle_events AS events
              WHERE events.authority_hash = authorities.authority_hash
              ORDER BY sequence DESC
              LIMIT 1
            ) = 'activated'
        )
        OR EXISTS (
          SELECT 1
          FROM commercial_test_contracts AS contracts
          WHERE (
            SELECT event_type
            FROM commercial_test_lifecycle_events AS events
            WHERE events.decision_hash = contracts.decision_hash
            ORDER BY sequence DESC
            LIMIT 1
          ) = 'activated'
        )
      )
    BEGIN
      SELECT RAISE(ABORT, 'Pre-venture research activation is expired or conflicts with active commercial authority.');
    END
  `,
  trg_preventure_research_assignment_admission_insert: `
    CREATE TRIGGER IF NOT EXISTS trg_preventure_research_assignment_admission_insert
    BEFORE INSERT ON preventure_research_assignments
    WHEN COALESCE((
      NEW.activation_event_hash = (
        SELECT event_hash
        FROM preventure_research_lifecycle_events
        WHERE authority_hash = NEW.authority_hash
        ORDER BY sequence DESC
        LIMIT 1
      )
      AND 'activated' = (
        SELECT event_type
        FROM preventure_research_lifecycle_events
        WHERE authority_hash = NEW.authority_hash
        ORDER BY sequence DESC
        LIMIT 1
      )
      AND julianday(NEW.assigned_at) <= julianday(NEW.expires_at)
      AND julianday(pantheon_current_time()) < julianday(NEW.expires_at)
      AND NEW.expires_at = (
        SELECT expires_at FROM preventure_research_authorities
        WHERE authority_hash = NEW.authority_hash
      )
      AND NEW.provider_id = (
        SELECT provider_id FROM preventure_research_authorities
        WHERE authority_hash = NEW.authority_hash
      )
      AND NEW.provider_model = (
        SELECT provider_model FROM preventure_research_authorities
        WHERE authority_hash = NEW.authority_hash
      )
      AND NEW.max_cost_aud_cents <= (
        SELECT internal_ai_spend_cap_aud_cents
        FROM preventure_research_authorities
        WHERE authority_hash = NEW.authority_hash
      )
      AND NEW.max_cost_aud_cents + COALESCE((
        SELECT SUM(max_cost_aud_cents)
        FROM preventure_research_assignments
        WHERE authority_hash = NEW.authority_hash
      ), 0) <= (
        SELECT internal_ai_spend_cap_aud_cents
        FROM preventure_research_authorities
        WHERE authority_hash = NEW.authority_hash
      )
    ), 0) = 0
    BEGIN
      SELECT RAISE(ABORT, 'Pre-venture research assignment is outside active exact authority or its cost cap.');
    END
  `,
  trg_preventure_research_cost_chain_insert: `
    CREATE TRIGGER IF NOT EXISTS trg_preventure_research_cost_chain_insert
    BEFORE INSERT ON preventure_research_cost_events
    WHEN COALESCE((
      (
        NEW.sequence = 1
        AND NEW.previous_receipt_hash IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM preventure_research_cost_events
          WHERE assignment_hash = NEW.assignment_hash AND cost_key = NEW.cost_key
        )
      )
      OR (
        NEW.sequence > 1
        AND NEW.previous_receipt_hash = (
          SELECT receipt_hash
          FROM preventure_research_cost_events
          WHERE assignment_hash = NEW.assignment_hash AND cost_key = NEW.cost_key
          ORDER BY sequence DESC
          LIMIT 1
        )
        AND NEW.sequence = 1 + (
          SELECT sequence
          FROM preventure_research_cost_events
          WHERE assignment_hash = NEW.assignment_hash AND cost_key = NEW.cost_key
          ORDER BY sequence DESC
          LIMIT 1
        )
      )
    ), 0) = 0
    BEGIN
      SELECT RAISE(ABORT, 'Pre-venture research cost receipt chain is not contiguous.');
    END
  `,
  trg_preventure_research_cost_decision_freeze_insert: `
    CREATE TRIGGER IF NOT EXISTS trg_preventure_research_cost_decision_freeze_insert
    BEFORE INSERT ON preventure_research_cost_events
    WHEN EXISTS (
      SELECT 1 FROM preventure_research_decisions
      WHERE authority_hash = NEW.authority_hash
    )
      AND NOT (
        (
        NEW.event_type = 'reconciled'
        AND NEW.sequence > 1
        AND NEW.previous_receipt_hash IS NOT NULL
        AND NEW.amount_aud_cents IS NOT NULL
        AND NEW.exposure_aud_cents = NEW.amount_aud_cents
        AND EXISTS (
          SELECT 1
          FROM preventure_research_cost_events AS prior
          JOIN preventure_research_decisions AS decision
            ON decision.authority_hash = NEW.authority_hash
          WHERE prior.receipt_hash = NEW.previous_receipt_hash
            AND prior.assignment_hash = NEW.assignment_hash
            AND prior.cost_key = NEW.cost_key
            AND prior.event_type IN ('estimated', 'incurred')
            AND NEW.amount_aud_cents <= prior.exposure_aud_cents
            AND NEW.task_attempt_id IS prior.task_attempt_id
            AND NEW.model_call_id IS prior.model_call_id
            AND NEW.budget_reservation_id IS prior.budget_reservation_id
            AND NEW.cost_id IS prior.cost_id
            AND NEW.agent_run_receipt_id IS prior.agent_run_receipt_id
            AND julianday(NEW.occurred_at) > julianday(decision.decided_at)
            AND pantheon_preventure_provider_cost_reconciliation_capability(
              'cost_event_insert',
              NEW.authority_hash,
              NEW.assignment_hash,
              decision.decision_hash,
              NEW.cost_id,
              NEW.receipt_hash,
              NEW.previous_receipt_hash,
              NEW.amount_aud_cents,
              NEW.occurred_at
            ) = 1
        )
        )
        OR (
          NEW.event_type = 'reconciled'
          AND NEW.sequence > 1
          AND NEW.previous_receipt_hash IS NOT NULL
          AND NEW.amount_aud_cents IS NOT NULL
          AND NEW.exposure_aud_cents = NEW.amount_aud_cents
          AND json_extract(NEW.cost_json, '$.ownerBillingObservationHash') IS NOT NULL
          AND pantheon_preventure_owner_billing_observation_capability(
            'guard_cost_event_insert',
            NEW.authority_hash,
            NEW.assignment_hash,
            NEW.cost_id,
            json_extract(NEW.cost_json, '$.ownerBillingObservationHash'),
            NEW.receipt_hash,
            NEW.previous_receipt_hash,
            NEW.amount_aud_cents,
            NEW.occurred_at,
            NEW.cost_json
          ) = 1
        )
      )
    BEGIN
      SELECT RAISE(ABORT, 'A sealed diligence decision only permits bounded same-chain cost reconciliation.');
    END
  `,
  trg_preventure_research_reconciled_reservation_update: `
    CREATE TRIGGER IF NOT EXISTS trg_preventure_research_reconciled_reservation_update
    BEFORE UPDATE ON budget_reservations
    WHEN EXISTS (
      SELECT 1
      FROM preventure_research_assignments AS assignments
      JOIN preventure_research_decisions AS decisions
        ON decisions.authority_hash = assignments.authority_hash
      WHERE assignments.task_id = OLD.task_id
    )
      AND COALESCE(pantheon_preventure_owner_billing_observation_capability(
        'guard_reservation_update',
        json_extract(NEW.metadata, '$.authorityHash'),
        json_extract(NEW.metadata, '$.assignmentHash'),
        NEW.id,
        json_extract(NEW.metadata, '$.ownerBillingObservationHash'),
        json_extract(NEW.metadata, '$.ownerBillingCostReceiptHash'),
        json_extract(NEW.metadata, '$.ownerBillingPreviousReceiptHash'),
        NEW.amount_cents,
        NEW.resolved_at,
        NEW.metadata
      ), 0) <> 1
      AND (
        NEW.id IS NOT OLD.id
        OR NEW.venture_id IS NOT OLD.venture_id
        OR NEW.workflow_id IS NOT OLD.workflow_id
        OR NEW.task_id IS NOT OLD.task_id
        OR NEW.approval_id IS NOT OLD.approval_id
        OR NEW.currency IS NOT OLD.currency
        OR NEW.reserved_at IS NOT OLD.reserved_at
        OR NEW.metadata IS NOT OLD.metadata
        OR NEW.status <> 'reconciled'
        OR NEW.currency <> 'AUD'
        OR NEW.amount_cents < 0
        OR julianday(NEW.resolved_at) IS NULL
        OR COALESCE(pantheon_preventure_provider_cost_reconciliation_capability(
          'reservation_update',
          (SELECT assignments.authority_hash
           FROM preventure_research_assignments AS assignments
           WHERE assignments.task_id = OLD.task_id),
          (SELECT assignments.assignment_hash
           FROM preventure_research_assignments AS assignments
           WHERE assignments.task_id = OLD.task_id),
          (SELECT decisions.decision_hash
           FROM preventure_research_assignments AS assignments
           JOIN preventure_research_decisions AS decisions
             ON decisions.authority_hash = assignments.authority_hash
           WHERE assignments.task_id = OLD.task_id),
          NEW.id,
          (SELECT events.receipt_hash
           FROM preventure_research_cost_events AS events
           WHERE events.budget_reservation_id = NEW.id
             AND events.event_type = 'reconciled'
           ORDER BY events.sequence DESC LIMIT 1),
          (SELECT events.previous_receipt_hash
           FROM preventure_research_cost_events AS events
           WHERE events.budget_reservation_id = NEW.id
             AND events.event_type = 'reconciled'
           ORDER BY events.sequence DESC LIMIT 1),
          NEW.amount_cents,
          NEW.resolved_at
        ), 0) <> 1
      )
    BEGIN
      SELECT RAISE(ABORT, 'A sealed pre-venture reservation only accepts its exact provider-cost reconciliation.');
    END
  `,
  trg_preventure_research_reconciled_cost_update: `
    CREATE TRIGGER IF NOT EXISTS trg_preventure_research_reconciled_cost_update
    BEFORE UPDATE ON costs
    WHEN EXISTS (
      SELECT 1
      FROM preventure_research_assignments AS assignments
      JOIN preventure_research_decisions AS decisions
        ON decisions.authority_hash = assignments.authority_hash
      WHERE assignments.task_id = OLD.task_id
    )
      AND COALESCE(pantheon_preventure_owner_billing_observation_capability(
        'guard_cost_update',
        json_extract(NEW.metadata, '$.authorityHash'),
        json_extract(NEW.metadata, '$.assignmentHash'),
        NEW.id,
        json_extract(NEW.metadata, '$.ownerBillingObservationHash'),
        json_extract(NEW.metadata, '$.ownerBillingCostReceiptHash'),
        json_extract(NEW.metadata, '$.ownerBillingPreviousReceiptHash'),
        NEW.amount_cents,
        NEW.occurred_at,
        NEW.metadata
      ), 0) <> 1
      AND (
        NEW.id IS NOT OLD.id
        OR NEW.workflow_id IS NOT OLD.workflow_id
        OR NEW.venture_id IS NOT OLD.venture_id
        OR NEW.run_id IS NOT OLD.run_id
        OR NEW.task_id IS NOT OLD.task_id
        OR NEW.model_call_id IS NOT OLD.model_call_id
        OR NEW.category IS NOT OLD.category
        OR NEW.source IS NOT OLD.source
        OR NEW.currency IS NOT OLD.currency
        OR NEW.metadata IS NOT OLD.metadata
        OR NEW.status <> 'reconciled'
        OR NEW.currency <> 'AUD'
        OR NEW.amount_cents < 0
        OR julianday(NEW.occurred_at) IS NULL
        OR COALESCE(pantheon_preventure_provider_cost_reconciliation_capability(
          'cost_update',
          (SELECT assignments.authority_hash
           FROM preventure_research_assignments AS assignments
           WHERE assignments.task_id = OLD.task_id),
          (SELECT assignments.assignment_hash
           FROM preventure_research_assignments AS assignments
           WHERE assignments.task_id = OLD.task_id),
          (SELECT decisions.decision_hash
           FROM preventure_research_assignments AS assignments
           JOIN preventure_research_decisions AS decisions
             ON decisions.authority_hash = assignments.authority_hash
           WHERE assignments.task_id = OLD.task_id),
          NEW.id,
          (SELECT events.receipt_hash
           FROM preventure_research_cost_events AS events
           WHERE events.cost_id = NEW.id
             AND events.event_type = 'reconciled'
           ORDER BY events.sequence DESC LIMIT 1),
          (SELECT events.previous_receipt_hash
           FROM preventure_research_cost_events AS events
           WHERE events.cost_id = NEW.id
             AND events.event_type = 'reconciled'
           ORDER BY events.sequence DESC LIMIT 1),
          NEW.amount_cents,
          NEW.occurred_at
        ), 0) <> 1
      )
    BEGIN
      SELECT RAISE(ABORT, 'A sealed pre-venture cost only accepts its exact provider-cost reconciliation.');
    END
  `,
  trg_preventure_research_reconciled_model_call_update: `
    CREATE TRIGGER IF NOT EXISTS trg_preventure_research_reconciled_model_call_update
    BEFORE UPDATE OF cost_status, actual_cost_cents, reconciled_cost_cents ON model_calls
    WHEN EXISTS (
      SELECT 1
      FROM preventure_research_assignments AS assignments
      JOIN preventure_research_decisions AS decisions
        ON decisions.authority_hash = assignments.authority_hash
      WHERE assignments.task_id = OLD.task_id
    )
      AND COALESCE(pantheon_preventure_owner_billing_observation_capability(
        'guard_model_call_update',
        json_extract(NEW.metadata, '$.authorityHash'),
        json_extract(NEW.metadata, '$.assignmentHash'),
        NEW.id,
        json_extract(NEW.metadata, '$.ownerBillingObservationHash'),
        json_extract(NEW.metadata, '$.ownerBillingCostReceiptHash'),
        json_extract(NEW.metadata, '$.ownerBillingPreviousReceiptHash'),
        NEW.actual_cost_cents,
        json_extract(NEW.metadata, '$.ownerBillingRecordedAt'),
        NEW.metadata
      ), 0) <> 1
      AND (
        NEW.cost_status <> 'reconciled'
        OR NEW.actual_cost_cents < 0
        OR NEW.actual_cost_cents <> NEW.reconciled_cost_cents
        OR COALESCE(pantheon_preventure_provider_cost_reconciliation_capability(
          'model_call_update',
          (SELECT assignments.authority_hash
           FROM preventure_research_assignments AS assignments
           WHERE assignments.task_id = OLD.task_id),
          (SELECT assignments.assignment_hash
           FROM preventure_research_assignments AS assignments
           WHERE assignments.task_id = OLD.task_id),
          (SELECT decisions.decision_hash
           FROM preventure_research_assignments AS assignments
           JOIN preventure_research_decisions AS decisions
             ON decisions.authority_hash = assignments.authority_hash
           WHERE assignments.task_id = OLD.task_id),
          NEW.id,
          (SELECT events.receipt_hash
           FROM preventure_research_cost_events AS events
           WHERE events.model_call_id = NEW.id
             AND events.event_type = 'reconciled'
           ORDER BY events.sequence DESC LIMIT 1),
          (SELECT events.previous_receipt_hash
           FROM preventure_research_cost_events AS events
           WHERE events.model_call_id = NEW.id
             AND events.event_type = 'reconciled'
           ORDER BY events.sequence DESC LIMIT 1),
          NEW.actual_cost_cents,
          (SELECT events.occurred_at
           FROM preventure_research_cost_events AS events
           WHERE events.model_call_id = NEW.id
             AND events.event_type = 'reconciled'
           ORDER BY events.sequence DESC LIMIT 1)
        ), 0) <> 1
      )
    BEGIN
      SELECT RAISE(ABORT, 'A sealed pre-venture model call only accepts its exact provider-cost reconciliation.');
    END
  `,
  trg_preventure_research_source_decision_freeze_insert: `
    CREATE TRIGGER IF NOT EXISTS trg_preventure_research_source_decision_freeze_insert
    BEFORE INSERT ON preventure_research_source_snapshots
    WHEN EXISTS (
      SELECT 1 FROM preventure_research_decisions
      WHERE authority_hash = NEW.authority_hash
    )
    BEGIN
      SELECT RAISE(ABORT, 'A sealed diligence decision freezes its exact source snapshot set.');
    END
  `,
  trg_preventure_research_evidence_decision_freeze_insert: `
    CREATE TRIGGER IF NOT EXISTS trg_preventure_research_evidence_decision_freeze_insert
    BEFORE INSERT ON preventure_research_evidence_records
    WHEN EXISTS (
      SELECT 1 FROM preventure_research_decisions
      WHERE authority_hash = NEW.authority_hash
    )
    BEGIN
      SELECT RAISE(ABORT, 'A sealed diligence decision freezes its exact evidence set.');
    END
  `,
  trg_preventure_research_model_call_decision_freeze_insert: `
    CREATE TRIGGER IF NOT EXISTS trg_preventure_research_model_call_decision_freeze_insert
    BEFORE INSERT ON model_calls
    WHEN EXISTS (
      SELECT 1
      FROM preventure_research_assignments AS assignments
      JOIN preventure_research_decisions AS decisions
        ON decisions.authority_hash = assignments.authority_hash
      WHERE assignments.task_id = NEW.task_id
    )
    BEGIN
      SELECT RAISE(ABORT, 'A sealed diligence decision freezes its exact provider receipt set.');
    END
  `,
  trg_preventure_research_agent_receipt_decision_freeze_insert: `
    CREATE TRIGGER IF NOT EXISTS trg_preventure_research_agent_receipt_decision_freeze_insert
    BEFORE INSERT ON agent_run_receipts
    WHEN EXISTS (
      SELECT 1
      FROM preventure_research_assignments AS assignments
      JOIN preventure_research_decisions AS decisions
        ON decisions.authority_hash = assignments.authority_hash
      WHERE assignments.task_id = NEW.task_id
    )
    BEGIN
      SELECT RAISE(ABORT, 'A sealed diligence decision freezes its exact agent receipt set.');
    END
  `,
  trg_preventure_research_cost_lifecycle_insert: `
    CREATE TRIGGER IF NOT EXISTS trg_preventure_research_cost_lifecycle_insert
    BEFORE INSERT ON preventure_research_cost_events
    WHEN COALESCE((
      'activated' = (
        SELECT event_type
        FROM preventure_research_lifecycle_events
        WHERE authority_hash = NEW.authority_hash
        ORDER BY sequence DESC
        LIMIT 1
      )
      AND julianday(pantheon_current_time()) < julianday((
        SELECT expires_at FROM preventure_research_authorities
        WHERE authority_hash = NEW.authority_hash
      ))
    ), 0) = 0
      AND NOT (
        NEW.event_type IN ('unknown', 'reconciled', 'released')
        AND EXISTS (
          SELECT 1 FROM preventure_research_cost_events
          WHERE assignment_hash = NEW.assignment_hash
            AND cost_key = NEW.cost_key
        )
      )
    BEGIN
      SELECT RAISE(ABORT, 'New cost work requires active authority; only late truth reconciliation may append after stop.');
    END
  `,
  trg_preventure_research_source_lifecycle_insert: `
    CREATE TRIGGER IF NOT EXISTS trg_preventure_research_source_lifecycle_insert
    BEFORE INSERT ON preventure_research_source_snapshots
    WHEN COALESCE((
      'activated' = (
        SELECT event_type
        FROM preventure_research_lifecycle_events
        WHERE authority_hash = NEW.authority_hash
        ORDER BY sequence DESC
        LIMIT 1
      )
      AND julianday(pantheon_current_time()) < julianday((
        SELECT expires_at FROM preventure_research_authorities
        WHERE authority_hash = NEW.authority_hash
      ))
    ), 0) = 0
    BEGIN
      SELECT RAISE(ABORT, 'Source capture requires active unexpired pre-venture research authority.');
    END
  `,
  trg_preventure_research_evidence_lifecycle_insert: `
    CREATE TRIGGER IF NOT EXISTS trg_preventure_research_evidence_lifecycle_insert
    BEFORE INSERT ON preventure_research_evidence_records
    WHEN COALESCE((
      'activated' = (
        SELECT event_type
        FROM preventure_research_lifecycle_events
        WHERE authority_hash = NEW.authority_hash
        ORDER BY sequence DESC
        LIMIT 1
      )
      AND julianday(pantheon_current_time()) < julianday((
        SELECT expires_at FROM preventure_research_authorities
        WHERE authority_hash = NEW.authority_hash
      ))
    ), 0) = 0
    BEGIN
      SELECT RAISE(ABORT, 'Evidence capture requires active unexpired pre-venture research authority.');
    END
  `,
  trg_preventure_research_task_attempt_admission_insert: `
    CREATE TRIGGER IF NOT EXISTS trg_preventure_research_task_attempt_admission_insert
    BEFORE INSERT ON task_attempts
    WHEN EXISTS (
      SELECT 1 FROM preventure_research_assignments
      WHERE task_id = NEW.task_id
    )
      AND (
        EXISTS (
          SELECT 1 FROM task_attempts
          WHERE task_id = NEW.task_id
        )
        OR 'activated' <> (
          SELECT events.event_type
          FROM preventure_research_assignments AS assignments
          JOIN preventure_research_lifecycle_events AS events
            ON events.authority_hash = assignments.authority_hash
          WHERE assignments.task_id = NEW.task_id
          ORDER BY events.sequence DESC
          LIMIT 1
        )
        OR julianday(pantheon_current_time()) >= julianday((
          SELECT expires_at FROM preventure_research_assignments
          WHERE task_id = NEW.task_id
        ))
        OR EXISTS (
          SELECT 1
          FROM preventure_research_assignments AS assignment
          JOIN preventure_research_assignments AS sibling
            ON sibling.authority_hash = assignment.authority_hash
          JOIN task_attempts AS attempts ON attempts.task_id = sibling.task_id
          WHERE assignment.task_id = NEW.task_id
            AND attempts.outcome_status = 'unknown'
        )
        OR EXISTS (
          SELECT 1
          FROM preventure_research_assignments AS assignment
          JOIN preventure_research_assignments AS sibling
            ON sibling.authority_hash = assignment.authority_hash
          JOIN model_calls AS calls ON calls.task_id = sibling.task_id
          WHERE assignment.task_id = NEW.task_id
            AND (calls.outcome_status = 'unknown' OR calls.cost_status = 'unknown')
        )
        OR EXISTS (
          SELECT 1
          FROM preventure_research_assignments AS assignment
          JOIN preventure_research_cost_events AS costs
            ON costs.authority_hash = assignment.authority_hash
          WHERE assignment.task_id = NEW.task_id
            AND costs.event_type = 'unknown'
            AND NOT EXISTS (
              SELECT 1
              FROM preventure_research_cost_events AS later
              WHERE later.assignment_hash = costs.assignment_hash
                AND later.cost_key = costs.cost_key
                AND later.sequence > costs.sequence
            )
        )
      )
    BEGIN
      SELECT RAISE(ABORT, 'Pre-venture research permits one provider attempt and freezes dispatch on expiry or unknown truth.');
    END
  `,
  trg_preventure_research_cost_admission_insert: `
    CREATE TRIGGER IF NOT EXISTS trg_preventure_research_cost_admission_insert
    BEFORE INSERT ON preventure_research_cost_events
    WHEN COALESCE(pantheon_preventure_owner_billing_observation_capability(
        'guard_cost_event_insert',
        NEW.authority_hash,
        NEW.assignment_hash,
        NEW.cost_id,
        json_extract(NEW.cost_json, '$.ownerBillingObservationHash'),
        NEW.receipt_hash,
        NEW.previous_receipt_hash,
        NEW.amount_aud_cents,
        NEW.occurred_at,
        NEW.cost_json
      ), 0) <> 1
      AND (
      NEW.authority_hash <> (
        SELECT authority_hash FROM preventure_research_assignments
        WHERE assignment_hash = NEW.assignment_hash
      )
      OR NEW.exposure_aud_cents > (
        SELECT max_cost_aud_cents FROM preventure_research_assignments
        WHERE assignment_hash = NEW.assignment_hash
      )
      OR (
        NEW.amount_aud_cents IS NOT NULL
        AND NEW.amount_aud_cents > (
          SELECT max_cost_aud_cents FROM preventure_research_assignments
          WHERE assignment_hash = NEW.assignment_hash
        )
      )
      OR NEW.exposure_aud_cents + COALESCE((
        SELECT SUM(costs.exposure_aud_cents)
        FROM preventure_research_cost_events AS costs
        WHERE costs.assignment_hash = NEW.assignment_hash
          AND costs.cost_key <> NEW.cost_key
          AND NOT EXISTS (
            SELECT 1 FROM preventure_research_cost_events AS later
            WHERE later.assignment_hash = costs.assignment_hash
              AND later.cost_key = costs.cost_key
              AND later.sequence > costs.sequence
          )
      ), 0) > (
        SELECT max_cost_aud_cents FROM preventure_research_assignments
        WHERE assignment_hash = NEW.assignment_hash
      )
      OR COALESCE(NEW.amount_aud_cents, 0) + COALESCE((
        SELECT SUM(COALESCE(costs.amount_aud_cents, 0))
        FROM preventure_research_cost_events AS costs
        WHERE costs.assignment_hash = NEW.assignment_hash
          AND costs.cost_key <> NEW.cost_key
          AND NOT EXISTS (
            SELECT 1 FROM preventure_research_cost_events AS later
            WHERE later.assignment_hash = costs.assignment_hash
              AND later.cost_key = costs.cost_key
              AND later.sequence > costs.sequence
          )
      ), 0) > (
        SELECT max_cost_aud_cents FROM preventure_research_assignments
        WHERE assignment_hash = NEW.assignment_hash
      )
      OR NEW.exposure_aud_cents + COALESCE((
        SELECT SUM(costs.exposure_aud_cents)
        FROM preventure_research_cost_events AS costs
        WHERE costs.authority_hash = NEW.authority_hash
          AND NOT (
            costs.assignment_hash = NEW.assignment_hash
            AND costs.cost_key = NEW.cost_key
          )
          AND NOT EXISTS (
            SELECT 1 FROM preventure_research_cost_events AS later
            WHERE later.assignment_hash = costs.assignment_hash
              AND later.cost_key = costs.cost_key
              AND later.sequence > costs.sequence
          )
      ), 0) > (
        SELECT MIN(
          authorities.internal_ai_spend_cap_aud_cents,
          COALESCE((
            SELECT SUM(assignments.max_cost_aud_cents)
            FROM preventure_research_assignments AS assignments
            WHERE assignments.authority_hash = NEW.authority_hash
          ), 0)
        )
        FROM preventure_research_authorities AS authorities
        WHERE authorities.authority_hash = NEW.authority_hash
      )
      OR COALESCE(NEW.amount_aud_cents, 0) + COALESCE((
        SELECT SUM(COALESCE(costs.amount_aud_cents, 0))
        FROM preventure_research_cost_events AS costs
        WHERE costs.authority_hash = NEW.authority_hash
          AND NOT (
            costs.assignment_hash = NEW.assignment_hash
            AND costs.cost_key = NEW.cost_key
          )
          AND NOT EXISTS (
            SELECT 1 FROM preventure_research_cost_events AS later
            WHERE later.assignment_hash = costs.assignment_hash
              AND later.cost_key = costs.cost_key
              AND later.sequence > costs.sequence
          )
      ), 0) > (
        SELECT MIN(
          authorities.internal_ai_spend_cap_aud_cents,
          COALESCE((
            SELECT SUM(assignments.max_cost_aud_cents)
            FROM preventure_research_assignments AS assignments
            WHERE assignments.authority_hash = NEW.authority_hash
          ), 0)
        )
        FROM preventure_research_authorities AS authorities
        WHERE authorities.authority_hash = NEW.authority_hash
      )
      )
    BEGIN
      SELECT RAISE(ABORT, 'Pre-venture research cost truth exceeds its immutable assignment authority.');
    END
  `,
  trg_preventure_research_cost_generic_binding_insert: `
    CREATE TRIGGER IF NOT EXISTS trg_preventure_research_cost_generic_binding_insert
    BEFORE INSERT ON preventure_research_cost_events
    WHEN (
      NEW.budget_reservation_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM preventure_research_assignments AS assignments
        JOIN budget_reservations AS reservations
          ON reservations.id = NEW.budget_reservation_id
        WHERE assignments.assignment_hash = NEW.assignment_hash
          AND reservations.task_id = assignments.task_id
          AND reservations.workflow_id = assignments.workflow_id
          AND reservations.venture_id IS NULL
          AND reservations.currency = 'AUD'
      )
    ) OR (
      NEW.cost_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM preventure_research_assignments AS assignments
        JOIN costs ON costs.id = NEW.cost_id
        WHERE assignments.assignment_hash = NEW.assignment_hash
          AND costs.task_id = assignments.task_id
          AND costs.workflow_id = assignments.workflow_id
          AND costs.venture_id IS NULL
          AND costs.currency = 'AUD'
          AND (NEW.model_call_id IS NULL OR costs.model_call_id = NEW.model_call_id)
      )
    )
    BEGIN
      SELECT RAISE(ABORT, 'Pre-venture cost receipts must bind the exact unowned Pantheon accounting rows.');
    END
  `,
  trg_preventure_research_decision_admission_insert: `
    CREATE TRIGGER IF NOT EXISTS trg_preventure_research_decision_admission_insert
    BEFORE INSERT ON preventure_research_decisions
    WHEN NOT EXISTS (
        SELECT 1
        FROM preventure_research_lifecycle_events
        WHERE authority_hash = NEW.authority_hash
      )
      OR 'activated' <> (
        SELECT event_type
        FROM preventure_research_lifecycle_events
        WHERE authority_hash = NEW.authority_hash
        ORDER BY sequence DESC
        LIMIT 1
      )
      OR julianday(pantheon_current_time()) >= julianday((
        SELECT expires_at FROM preventure_research_authorities
        WHERE authority_hash = NEW.authority_hash
      ))
      OR NEW.estimated_internal_ai_cost_aud_cents
           + NEW.reconciled_internal_ai_cost_aud_cents > (
        SELECT internal_ai_spend_cap_aud_cents
        FROM preventure_research_authorities
        WHERE authority_hash = NEW.authority_hash
      )
      OR NEW.external_commercial_spend_aud_cents <> 0
      OR EXISTS (
        SELECT 1
        FROM preventure_research_assignments AS assignments
        JOIN task_attempts AS attempts ON attempts.task_id = assignments.task_id
        WHERE assignments.authority_hash = NEW.authority_hash
          AND attempts.outcome_status = 'unknown'
      )
      OR EXISTS (
        SELECT 1
        FROM preventure_research_assignments AS assignments
        JOIN model_calls AS calls ON calls.task_id = assignments.task_id
        WHERE assignments.authority_hash = NEW.authority_hash
          AND (calls.outcome_status = 'unknown' OR calls.cost_status = 'unknown')
      )
      OR EXISTS (
        SELECT 1
        FROM preventure_research_cost_events AS costs
        WHERE costs.authority_hash = NEW.authority_hash
          AND costs.event_type = 'unknown'
          AND NOT EXISTS (
            SELECT 1
            FROM preventure_research_cost_events AS later
            WHERE later.assignment_hash = costs.assignment_hash
              AND later.cost_key = costs.cost_key
              AND later.sequence > costs.sequence
          )
      )
      OR EXISTS (
        SELECT 1
        FROM preventure_research_assignments AS assignments
        WHERE assignments.authority_hash = NEW.authority_hash
          AND NOT (
            NEW.completion_mode = 'validated_early_stop'
            AND EXISTS (
              SELECT 1
              FROM preventure_research_assignment_skips AS skips
              WHERE skips.authority_hash = NEW.authority_hash
                AND skips.assignment_hash = assignments.assignment_hash
            )
          )
          AND NOT EXISTS (
            SELECT 1
            FROM preventure_research_cost_events AS costs
            WHERE costs.assignment_hash = assignments.assignment_hash
              AND costs.budget_reservation_id IS NOT NULL
              AND costs.cost_id IS NOT NULL
              AND NOT EXISTS (
                SELECT 1
                FROM preventure_research_cost_events AS later
                WHERE later.assignment_hash = costs.assignment_hash
                  AND later.cost_key = costs.cost_key
                  AND later.sequence > costs.sequence
              )
          )
      )
    BEGIN
      SELECT RAISE(ABORT, 'Pre-venture research decision requires active unexpired authority and fully known provider/cost truth.');
    END
  `,
  trg_preventure_research_early_decision_pair_insert: `
    CREATE TRIGGER IF NOT EXISTS trg_preventure_research_early_decision_pair_insert
    BEFORE INSERT ON preventure_research_decisions
    WHEN NEW.completion_mode = 'validated_early_stop'
      AND (
        NOT EXISTS (
          SELECT 1
          FROM preventure_research_terminal_stops AS stops
          WHERE stops.authority_hash = NEW.authority_hash
            AND stops.early_stop_record_hash = NEW.early_stop_record_hash
            AND stops.expected_decision_id = NEW.decision_id
            AND stops.next_evidence_action_json = NEW.next_evidence_action_json
            AND stops.prior_evidence_set_hash = NEW.evidence_set_hash
        )
        OR NEW.outcome <> 'research_more'
        OR json_array_length(NEW.skipped_assignment_record_hashes_json) <> (
          SELECT COUNT(*)
          FROM preventure_research_assignment_skips AS skips
          WHERE skips.authority_hash = NEW.authority_hash
        )
        OR json_array_length(NEW.skipped_assignment_record_hashes_json) <> (
          SELECT json_array_length(stops.skipped_assignments_json)
          FROM preventure_research_terminal_stops AS stops
          WHERE stops.authority_hash = NEW.authority_hash
            AND stops.early_stop_record_hash = NEW.early_stop_record_hash
        )
        OR EXISTS (
          SELECT 1
          FROM json_each(NEW.skipped_assignment_record_hashes_json) AS supplied
          WHERE NOT EXISTS (
            SELECT 1
            FROM preventure_research_assignment_skips AS skips
            WHERE skips.authority_hash = NEW.authority_hash
              AND skips.skip_record_hash = supplied.value
          )
        )
        OR EXISTS (
          SELECT 1
          FROM preventure_research_assignment_skips AS skips
          WHERE skips.authority_hash = NEW.authority_hash
            AND NOT EXISTS (
              SELECT 1
              FROM json_each(NEW.skipped_assignment_record_hashes_json) AS supplied
              WHERE supplied.value = skips.skip_record_hash
            )
        )
        OR EXISTS (
          SELECT 1
          FROM json_each(NEW.skipped_assignment_record_hashes_json) AS left_hash
          JOIN json_each(NEW.skipped_assignment_record_hashes_json) AS right_hash
            ON CAST(left_hash.key AS INTEGER) < CAST(right_hash.key AS INTEGER)
          WHERE left_hash.value >= right_hash.value
        )
      )
    BEGIN
      SELECT RAISE(ABORT, 'A validated early-stop decision must match its exact stop, untouched suffix, and next evidence action.');
    END
  `,
});

const PREVENTURE_RESEARCH_OWNER_BILLING_OBSERVATION_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS preventure_research_provider_billing_observations (
    observation_hash TEXT PRIMARY KEY
      CHECK (
        length(observation_hash) = 71
        AND substr(observation_hash, 1, 7) = 'sha256:'
        AND substr(observation_hash, 8) NOT GLOB '*[^0-9a-f]*'
      ),
    action_kind TEXT NOT NULL
      CHECK (action_kind = 'owner_attested_provider_billing_observation'),
    authority_hash TEXT NOT NULL,
    assignment_hash TEXT NOT NULL UNIQUE,
    assignment_template_hash TEXT NOT NULL,
    task_id TEXT NOT NULL,
    predecessor_kind TEXT NOT NULL
      CHECK (predecessor_kind IN ('sealed_decision', 'terminal_recovery')),
    predecessor_hash TEXT NOT NULL,
    expected_previous_receipt_hash TEXT NOT NULL UNIQUE,
    task_attempt_id TEXT NOT NULL,
    model_call_id TEXT NOT NULL,
    agent_run_receipt_id TEXT NOT NULL,
    agent_run_receipt_hash TEXT NOT NULL,
    cost_key TEXT NOT NULL,
    budget_reservation_id TEXT NOT NULL,
    cost_id TEXT NOT NULL,
    client_request_id TEXT NOT NULL,
    provider_request_id TEXT,
    provider_response_id TEXT NOT NULL,
    provider TEXT NOT NULL,
    provider_account_reference_hash TEXT NOT NULL,
    billing_record_reference_hash TEXT NOT NULL,
    currency TEXT NOT NULL CHECK (currency = 'AUD'),
    amount_aud_cents INTEGER NOT NULL CHECK (amount_aud_cents >= 0),
    observed_at TEXT NOT NULL CHECK (julianday(observed_at) IS NOT NULL),
    original_cost_occurred_at TEXT NOT NULL
      CHECK (julianday(original_cost_occurred_at) IS NOT NULL),
    provider_dispatched_at TEXT NOT NULL
      CHECK (julianday(provider_dispatched_at) IS NOT NULL),
    allocation_basis_json TEXT NOT NULL
      CHECK (json_valid(allocation_basis_json) AND json_type(allocation_basis_json) = 'object'),
    limitations_json TEXT NOT NULL
      CHECK (json_valid(limitations_json) AND json_type(limitations_json) = 'array'),
    budget_comparison_json TEXT NOT NULL
      CHECK (json_valid(budget_comparison_json) AND json_type(budget_comparison_json) = 'object'),
    truth_status TEXT NOT NULL
      CHECK (truth_status = 'owner_attested_not_provider_settled'),
    observation_json TEXT NOT NULL
      CHECK (
        json_valid(observation_json)
        AND json_extract(observation_json, '$.observationHash') IS observation_hash
        AND json_extract(observation_json, '$.schema')
          IS 'pantheon.owner-attested-provider-billing-observation.v1'
        AND json_extract(observation_json, '$.actionKind') IS action_kind
        AND json_extract(observation_json, '$.authorityHash') IS authority_hash
        AND json_extract(observation_json, '$.assignmentHash') IS assignment_hash
        AND json_extract(observation_json, '$.assignmentTemplateHash') IS assignment_template_hash
        AND json_extract(observation_json, '$.taskId') IS task_id
        AND json_extract(observation_json, '$.predecessor.kind') IS predecessor_kind
        AND json_extract(observation_json, '$.predecessor.hash') IS predecessor_hash
        AND json_extract(observation_json, '$.predecessor.expectedPreviousReceiptHash')
          IS expected_previous_receipt_hash
        AND json_extract(observation_json, '$.executionIdentity.taskAttemptId') IS task_attempt_id
        AND json_extract(observation_json, '$.executionIdentity.modelCallId') IS model_call_id
        AND json_extract(observation_json, '$.executionIdentity.agentRunReceiptId')
          IS agent_run_receipt_id
        AND json_extract(observation_json, '$.executionIdentity.agentRunReceiptHash')
          IS agent_run_receipt_hash
        AND json_extract(observation_json, '$.executionIdentity.clientRequestId') IS client_request_id
        AND json_extract(observation_json, '$.executionIdentity.providerRequestId')
          IS provider_request_id
        AND json_extract(observation_json, '$.executionIdentity.providerResponseId')
          IS provider_response_id
        AND json_extract(observation_json, '$.executionIdentity.providerDispatchedAt')
          IS provider_dispatched_at
        AND json_extract(observation_json, '$.costBinding.costKey') IS cost_key
        AND json_extract(observation_json, '$.costBinding.expectedPreviousReceiptHash')
          IS expected_previous_receipt_hash
        AND json_extract(observation_json, '$.costBinding.budgetReservationId')
          IS budget_reservation_id
        AND json_extract(observation_json, '$.costBinding.costId') IS cost_id
        AND json_extract(observation_json, '$.billingObservation.provider') IS provider
        AND json_extract(observation_json, '$.billingObservation.providerAccountReferenceHash')
          IS provider_account_reference_hash
        AND json_extract(observation_json, '$.billingObservation.billingRecordReferenceHash')
          IS billing_record_reference_hash
        AND json_extract(observation_json, '$.billingObservation.currency') IS currency
        AND json_extract(observation_json, '$.billingObservation.amountAudCents')
          IS amount_aud_cents
        AND json_extract(observation_json, '$.billingObservation.observedAt') IS observed_at
        AND json_extract(observation_json, '$.billingObservation.originalCostOccurredAt')
          IS original_cost_occurred_at
        AND json_extract(observation_json, '$.billingObservation.allocationBasis')
          IS allocation_basis_json
        AND json_extract(observation_json, '$.billingObservation.limitations')
          IS limitations_json
        AND json_extract(observation_json, '$.budgetComparison') IS budget_comparison_json
        AND json_extract(observation_json, '$.truth.source')
          IS 'authenticated_owner_session_attestation'
        AND json_extract(observation_json, '$.truth.status') IS truth_status
        AND json_extract(observation_json, '$.truth.statement')
          IS 'Owner-attested provider billing observation; not provider-settled.'
        AND json_extract(observation_json, '$.recordedAt') IS recorded_at
      ),
    recorded_at TEXT NOT NULL CHECK (julianday(recorded_at) IS NOT NULL),
    created_at TEXT NOT NULL CHECK (julianday(created_at) IS NOT NULL),
    UNIQUE (provider, provider_account_reference_hash, billing_record_reference_hash),
    CHECK (julianday(provider_dispatched_at) <= julianday(observed_at)),
    CHECK (julianday(observed_at) <= julianday(recorded_at)),
    CHECK (created_at = recorded_at),
    FOREIGN KEY (authority_hash)
      REFERENCES preventure_research_authorities(authority_hash),
    FOREIGN KEY (assignment_hash)
      REFERENCES preventure_research_assignments(assignment_hash),
    FOREIGN KEY (authority_hash, assignment_hash)
      REFERENCES preventure_research_assignments(authority_hash, assignment_hash),
    FOREIGN KEY (task_id) REFERENCES tasks(id),
    FOREIGN KEY (task_attempt_id) REFERENCES task_attempts(id),
    FOREIGN KEY (model_call_id) REFERENCES model_calls(id),
    FOREIGN KEY (agent_run_receipt_id) REFERENCES agent_run_receipts(id),
    FOREIGN KEY (budget_reservation_id) REFERENCES budget_reservations(id),
    FOREIGN KEY (cost_id) REFERENCES costs(id),
    FOREIGN KEY (expected_previous_receipt_hash)
      REFERENCES preventure_research_cost_events(receipt_hash)
  );
`;

const PREVENTURE_RESEARCH_TERMINAL_RECOVERY_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS preventure_research_terminal_recoveries (
    recovery_hash TEXT PRIMARY KEY
      CHECK (
        length(recovery_hash) = 71
        AND substr(recovery_hash, 1, 7) = 'sha256:'
        AND substr(recovery_hash, 8) NOT GLOB '*[^0-9a-f]*'
      ),
    recovery_intent_hash TEXT NOT NULL UNIQUE
      CHECK (
        length(recovery_intent_hash) = 71
        AND substr(recovery_intent_hash, 1, 7) = 'sha256:'
        AND substr(recovery_intent_hash, 8) NOT GLOB '*[^0-9a-f]*'
      ),
    authority_hash TEXT NOT NULL,
    assignment_hash TEXT NOT NULL UNIQUE,
    assignment_template_hash TEXT NOT NULL
      CHECK (
        length(assignment_template_hash) = 71
        AND substr(assignment_template_hash, 1, 7) = 'sha256:'
        AND substr(assignment_template_hash, 8) NOT GLOB '*[^0-9a-f]*'
      ),
    assignment_cap_aud_cents INTEGER NOT NULL CHECK (assignment_cap_aud_cents >= 0),
    task_id TEXT NOT NULL,
    workflow_id TEXT NOT NULL,
    task_attempt_id TEXT NOT NULL UNIQUE,
    model_call_id TEXT NOT NULL UNIQUE,
    terminal_kind TEXT NOT NULL
      CHECK (terminal_kind IN ('lifecycle', 'runtime_emergency_stop')),
    terminal_record_id TEXT NOT NULL,
    terminal_event_type TEXT NOT NULL
      CHECK (terminal_event_type IN ('revoked', 'expired', 'runtime.emergency_stop_recorded')),
    terminal_event_hash TEXT NOT NULL
      CHECK (
        length(terminal_event_hash) = 71
        AND substr(terminal_event_hash, 1, 7) = 'sha256:'
        AND substr(terminal_event_hash, 8) NOT GLOB '*[^0-9a-f]*'
      ),
    lifecycle_event_id TEXT,
    emergency_event_id INTEGER,
    terminal_at TEXT NOT NULL CHECK (julianday(terminal_at) IS NOT NULL),
    original_claim_token_hash TEXT NOT NULL
      CHECK (
        length(original_claim_token_hash) = 71
        AND substr(original_claim_token_hash, 1, 7) = 'sha256:'
        AND substr(original_claim_token_hash, 8) NOT GLOB '*[^0-9a-f]*'
      ),
    descriptor_hash TEXT NOT NULL
      CHECK (
        length(descriptor_hash) = 71
        AND substr(descriptor_hash, 1, 7) = 'sha256:'
        AND substr(descriptor_hash, 8) NOT GLOB '*[^0-9a-f]*'
      ),
    request_body_hash TEXT NOT NULL
      CHECK (
        length(request_body_hash) = 71
        AND substr(request_body_hash, 1, 7) = 'sha256:'
        AND substr(request_body_hash, 8) NOT GLOB '*[^0-9a-f]*'
      ),
    client_request_id TEXT NOT NULL,
    provider_request_id TEXT,
    provider_response_id TEXT,
    provider_dispatched_at TEXT NOT NULL CHECK (julianday(provider_dispatched_at) IS NOT NULL),
    artifact_hash TEXT NOT NULL UNIQUE
      CHECK (
        length(artifact_hash) = 71
        AND substr(artifact_hash, 1, 7) = 'sha256:'
        AND substr(artifact_hash, 8) NOT GLOB '*[^0-9a-f]*'
      ),
    artifact_ref TEXT NOT NULL UNIQUE,
    artifact_kind TEXT NOT NULL
      CHECK (artifact_kind IN (
        'canonical_known_response',
        'known_effect_invalid',
        'known_pre_effect_rejection'
      )),
    retained_at TEXT NOT NULL CHECK (julianday(retained_at) IS NOT NULL),
    provider_response_hash TEXT,
    raw_provider_body_hash TEXT NOT NULL,
    raw_provider_bytes_hash TEXT NOT NULL,
    output_hash TEXT NOT NULL,
    grounded_source_set_hash TEXT NOT NULL,
    billing_hash TEXT NOT NULL,
    response_metadata_hash TEXT NOT NULL,
    agent_run_receipt_id TEXT,
    agent_run_receipt_hash TEXT,
    agent_run_receipt_status TEXT,
    agent_run_receipt_outcome_status TEXT,
    cost_key TEXT NOT NULL,
    prior_cost_receipt_hash TEXT NOT NULL
      CHECK (
        length(prior_cost_receipt_hash) = 71
        AND substr(prior_cost_receipt_hash, 1, 7) = 'sha256:'
        AND substr(prior_cost_receipt_hash, 8) NOT GLOB '*[^0-9a-f]*'
      ),
    terminal_cost_receipt_hash TEXT NOT NULL
      CHECK (
        length(terminal_cost_receipt_hash) = 71
        AND substr(terminal_cost_receipt_hash, 1, 7) = 'sha256:'
        AND substr(terminal_cost_receipt_hash, 8) NOT GLOB '*[^0-9a-f]*'
      ),
    prior_cost_event_type TEXT NOT NULL
      CHECK (prior_cost_event_type IN ('reserved', 'estimated', 'incurred', 'reconciled', 'unknown')),
    prior_cost_amount_aud_cents INTEGER,
    prior_cost_exposure_aud_cents INTEGER NOT NULL
      CHECK (prior_cost_exposure_aud_cents BETWEEN 0 AND assignment_cap_aud_cents),
    budget_reservation_id TEXT NOT NULL,
    budget_reservation_status TEXT NOT NULL,
    budget_reservation_amount_aud_cents INTEGER NOT NULL
      CHECK (budget_reservation_amount_aud_cents = assignment_cap_aud_cents),
    cost_id TEXT NOT NULL,
    generic_cost_status TEXT NOT NULL,
    generic_cost_amount_aud_cents INTEGER NOT NULL
      CHECK (generic_cost_amount_aud_cents BETWEEN 0 AND assignment_cap_aud_cents),
    cost_truth TEXT NOT NULL CHECK (cost_truth = 'unknown'),
    known_cost_aud_cents INTEGER CHECK (known_cost_aud_cents IS NULL),
    exposure_aud_cents INTEGER NOT NULL CHECK (exposure_aud_cents = assignment_cap_aud_cents),
    exact_billing_pending INTEGER NOT NULL CHECK (exact_billing_pending = 1),
    commercial_inference TEXT NOT NULL CHECK (commercial_inference = 'none'),
    evidence_eligible INTEGER NOT NULL CHECK (evidence_eligible = 0),
    decision_eligible INTEGER NOT NULL CHECK (decision_eligible = 0),
    completion_eligible INTEGER NOT NULL CHECK (completion_eligible = 0),
    retry_authorized INTEGER NOT NULL CHECK (retry_authorized = 0),
    additional_network_calls INTEGER NOT NULL CHECK (additional_network_calls = 0),
    additional_ai_cost_aud_cents INTEGER NOT NULL CHECK (additional_ai_cost_aud_cents = 0),
    terminal_binding_json TEXT NOT NULL
      CHECK (json_valid(terminal_binding_json) AND json_type(terminal_binding_json) = 'object'),
    original_dispatch_json TEXT NOT NULL
      CHECK (json_valid(original_dispatch_json) AND json_type(original_dispatch_json) = 'object'),
    retained_artifact_json TEXT NOT NULL
      CHECK (json_valid(retained_artifact_json) AND json_type(retained_artifact_json) = 'object'),
    execution_receipt_json TEXT
      CHECK (
        execution_receipt_json IS NULL
        OR (json_valid(execution_receipt_json) AND json_type(execution_receipt_json) = 'object')
      ),
    cost_snapshot_json TEXT NOT NULL
      CHECK (json_valid(cost_snapshot_json) AND json_type(cost_snapshot_json) = 'object'),
    controls_json TEXT NOT NULL
      CHECK (json_valid(controls_json) AND json_type(controls_json) = 'object'),
    recovery_json TEXT NOT NULL
      CHECK (
        json_valid(recovery_json)
        AND json_extract(recovery_json, '$.schema')
          IS 'pantheon.preventure-research-terminal-retained-recovery.v1'
        AND json_extract(recovery_json, '$.recoveryHash') IS recovery_hash
        AND json_extract(recovery_json, '$.recoveryIntentHash') IS recovery_intent_hash
        AND json_extract(recovery_json, '$.authorityHash') IS authority_hash
        AND json_extract(recovery_json, '$.assignmentHash') IS assignment_hash
        AND json_extract(recovery_json, '$.assignmentTemplateHash') IS assignment_template_hash
        AND json_extract(recovery_json, '$.assignmentCapAudCents') IS assignment_cap_aud_cents
        AND json_extract(recovery_json, '$.taskId') IS task_id
        AND json_extract(recovery_json, '$.workflowId') IS workflow_id
        AND json_extract(recovery_json, '$.terminalBinding') IS terminal_binding_json
        AND json_extract(recovery_json, '$.originalDispatch') IS original_dispatch_json
        AND json_extract(recovery_json, '$.retainedArtifact') IS retained_artifact_json
        AND json_extract(recovery_json, '$.executionReceipt') IS execution_receipt_json
        AND json_extract(recovery_json, '$.costSnapshot') IS cost_snapshot_json
        AND json_extract(recovery_json, '$.controls') IS controls_json
        AND json_extract(recovery_json, '$.recordedAt') IS recorded_at
      ),
    recorded_at TEXT NOT NULL CHECK (julianday(recorded_at) IS NOT NULL),
    created_at TEXT NOT NULL CHECK (julianday(created_at) IS NOT NULL),
    CHECK (
      (
        terminal_kind = 'lifecycle'
        AND terminal_event_type IN ('revoked', 'expired')
        AND lifecycle_event_id IS terminal_record_id
        AND emergency_event_id IS NULL
      )
      OR (
        terminal_kind = 'runtime_emergency_stop'
        AND terminal_event_type = 'runtime.emergency_stop_recorded'
        AND lifecycle_event_id IS NULL
        AND CAST(emergency_event_id AS TEXT) IS terminal_record_id
      )
    ),
    CHECK (
      (agent_run_receipt_id IS NULL AND agent_run_receipt_hash IS NULL
       AND agent_run_receipt_status IS NULL AND agent_run_receipt_outcome_status IS NULL
       AND execution_receipt_json IS NULL)
      OR
      (agent_run_receipt_id IS NOT NULL AND agent_run_receipt_hash IS NOT NULL
       AND agent_run_receipt_status IS NOT NULL AND agent_run_receipt_outcome_status IS NOT NULL
       AND execution_receipt_json IS NOT NULL)
    ),
    CHECK (
      artifact_ref = 'preventure-output:' || substr(artifact_hash, 8)
      AND julianday(provider_dispatched_at) < julianday(terminal_at)
      AND julianday(provider_dispatched_at) < julianday(retained_at)
      AND julianday(terminal_at) <= julianday(recorded_at)
      AND julianday(retained_at) <= julianday(recorded_at)
    ),
    CHECK (
      (artifact_kind = 'canonical_known_response'
       AND provider_response_id IS NOT NULL AND provider_response_hash IS NOT NULL)
      OR
      (artifact_kind = 'known_pre_effect_rejection'
       AND provider_response_id IS NULL AND provider_response_hash IS NOT NULL)
      OR
      (artifact_kind = 'known_effect_invalid'
       AND ((provider_response_id IS NULL AND provider_response_hash IS NULL)
         OR (provider_response_id IS NOT NULL AND provider_response_hash IS NOT NULL)))
    ),
    FOREIGN KEY (authority_hash)
      REFERENCES preventure_research_authorities(authority_hash),
    FOREIGN KEY (authority_hash, assignment_hash)
      REFERENCES preventure_research_assignments(authority_hash, assignment_hash),
    FOREIGN KEY (task_id) REFERENCES tasks(id),
    FOREIGN KEY (task_attempt_id) REFERENCES task_attempts(id),
    FOREIGN KEY (model_call_id) REFERENCES model_calls(id),
    FOREIGN KEY (authority_hash, lifecycle_event_id)
      REFERENCES preventure_research_lifecycle_events(authority_hash, id),
    FOREIGN KEY (emergency_event_id) REFERENCES events(id),
    FOREIGN KEY (agent_run_receipt_id) REFERENCES agent_run_receipts(id),
    FOREIGN KEY (prior_cost_receipt_hash)
      REFERENCES preventure_research_cost_events(receipt_hash),
    FOREIGN KEY (terminal_cost_receipt_hash)
      REFERENCES preventure_research_cost_events(receipt_hash),
    FOREIGN KEY (budget_reservation_id) REFERENCES budget_reservations(id),
    FOREIGN KEY (cost_id) REFERENCES costs(id)
  );
`;

const PREVENTURE_RESEARCH_TERMINAL_STOP_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS preventure_research_terminal_stops (
    early_stop_record_hash TEXT PRIMARY KEY
      CHECK (
        length(early_stop_record_hash) = 71
        AND substr(early_stop_record_hash, 1, 7) = 'sha256:'
        AND substr(early_stop_record_hash, 8) NOT GLOB '*[^0-9a-f]*'
      ),
    terminal_stop_id TEXT NOT NULL,
    authority_hash TEXT NOT NULL UNIQUE,
    expected_decision_id TEXT NOT NULL,
    expected_completion_event_id TEXT NOT NULL,
    trigger_assignment_id TEXT NOT NULL,
    trigger_assignment_hash TEXT NOT NULL,
    trigger_outcome_class TEXT NOT NULL
      CHECK (trigger_outcome_class IN (
        'validated_evidence_shortfall',
        'known_failed_before_effect',
        'known_retained_unusable_provider_response'
      )),
    reason_class TEXT NOT NULL CHECK (reason_class IN ('evidence', 'technical')),
    reason_code TEXT NOT NULL,
    commercial_inference TEXT NOT NULL CHECK (commercial_inference = 'none'),
    provider_evidence_json TEXT NOT NULL
      CHECK (json_valid(provider_evidence_json) AND json_type(provider_evidence_json) = 'object'),
    actual_coverage_json TEXT NOT NULL
      CHECK (json_valid(actual_coverage_json) AND json_type(actual_coverage_json) = 'object'),
    gap_codes_json TEXT NOT NULL
      CHECK (json_valid(gap_codes_json) AND json_type(gap_codes_json) = 'array'),
    skipped_assignments_json TEXT NOT NULL
      CHECK (json_valid(skipped_assignments_json) AND json_type(skipped_assignments_json) = 'array'),
    next_evidence_action_json TEXT NOT NULL
      CHECK (json_valid(next_evidence_action_json) AND json_type(next_evidence_action_json) = 'object'),
    prior_evidence_set_hash TEXT NOT NULL
      CHECK (
        length(prior_evidence_set_hash) = 71
        AND substr(prior_evidence_set_hash, 1, 7) = 'sha256:'
        AND substr(prior_evidence_set_hash, 8) NOT GLOB '*[^0-9a-f]*'
      ),
    prior_receipt_set_hash TEXT NOT NULL
      CHECK (
        length(prior_receipt_set_hash) = 71
        AND substr(prior_receipt_set_hash, 1, 7) = 'sha256:'
        AND substr(prior_receipt_set_hash, 8) NOT GLOB '*[^0-9a-f]*'
      ),
    stopped_at TEXT NOT NULL CHECK (julianday(stopped_at) IS NOT NULL),
    stop_json TEXT NOT NULL
      CHECK (
        json_valid(stop_json)
        AND json_extract(stop_json, '$.schema')
          IS 'pantheon.preventure-research-terminal-stop.v1'
        AND json_extract(stop_json, '$.id') IS terminal_stop_id
        AND json_extract(stop_json, '$.authorityHash') IS authority_hash
        AND json_extract(stop_json, '$.triggerAssignmentId') IS trigger_assignment_id
        AND json_extract(stop_json, '$.triggerAssignmentHash') IS trigger_assignment_hash
        AND json_extract(stop_json, '$.triggerOutcomeClass') IS trigger_outcome_class
        AND json_extract(stop_json, '$.reasonClass') IS reason_class
        AND json_extract(stop_json, '$.reasonCode') IS reason_code
        AND json_extract(stop_json, '$.commercialInference') IS commercial_inference
        AND json_extract(stop_json, '$.providerEvidence') IS provider_evidence_json
        AND json_extract(stop_json, '$.actualCoverage') IS actual_coverage_json
        AND json_extract(stop_json, '$.gapCodes') IS gap_codes_json
        AND json_extract(stop_json, '$.skippedAssignments') IS skipped_assignments_json
        AND json_extract(stop_json, '$.nextEvidenceAction') IS next_evidence_action_json
        AND json_extract(stop_json, '$.stoppedAt') IS stopped_at
        AND json_extract(stop_json, '$.earlyStopRecordHash') IS early_stop_record_hash
        AND json_extract(actual_coverage_json, '$.evidenceSetHash') IS prior_evidence_set_hash
        AND json_extract(actual_coverage_json, '$.executionReceiptSetHash') IS prior_receipt_set_hash
      ),
    created_at TEXT NOT NULL CHECK (julianday(created_at) IS NOT NULL),
    CHECK (
      (trigger_outcome_class = 'validated_evidence_shortfall' AND reason_class = 'evidence')
      OR (
        trigger_outcome_class IN (
          'known_failed_before_effect',
          'known_retained_unusable_provider_response'
        )
        AND reason_class = 'technical'
      )
    ),
    UNIQUE (authority_hash, terminal_stop_id),
    UNIQUE (authority_hash, early_stop_record_hash),
    FOREIGN KEY (authority_hash)
      REFERENCES preventure_research_authorities(authority_hash),
    FOREIGN KEY (authority_hash, trigger_assignment_hash)
      REFERENCES preventure_research_assignments(authority_hash, assignment_hash),
    FOREIGN KEY (authority_hash, expected_decision_id)
      REFERENCES preventure_research_decisions(authority_hash, decision_id)
      DEFERRABLE INITIALLY DEFERRED,
    FOREIGN KEY (authority_hash, expected_completion_event_id)
      REFERENCES preventure_research_lifecycle_events(authority_hash, id)
      DEFERRABLE INITIALLY DEFERRED
  );

  CREATE TABLE IF NOT EXISTS preventure_research_assignment_skips (
    skip_record_hash TEXT PRIMARY KEY
      CHECK (
        length(skip_record_hash) = 71
        AND substr(skip_record_hash, 1, 7) = 'sha256:'
        AND substr(skip_record_hash, 8) NOT GLOB '*[^0-9a-f]*'
      ),
    terminal_stop_id TEXT NOT NULL,
    authority_hash TEXT NOT NULL,
    trigger_assignment_hash TEXT NOT NULL,
    assignment_id TEXT NOT NULL,
    assignment_hash TEXT NOT NULL UNIQUE,
    assignment_order INTEGER NOT NULL CHECK (assignment_order BETWEEN 1 AND 3),
    task_id TEXT NOT NULL,
    dispatch_state TEXT NOT NULL CHECK (dispatch_state = 'not_dispatched'),
    task_attempt_count INTEGER NOT NULL CHECK (task_attempt_count = 0),
    model_call_count INTEGER NOT NULL CHECK (model_call_count = 0),
    agent_run_receipt_count INTEGER NOT NULL CHECK (agent_run_receipt_count = 0),
    research_run_count INTEGER NOT NULL CHECK (research_run_count = 0),
    agent_run_count INTEGER NOT NULL CHECK (agent_run_count = 0),
    tool_invocation_count INTEGER NOT NULL CHECK (tool_invocation_count = 0),
    budget_reservation_count INTEGER NOT NULL CHECK (budget_reservation_count = 0),
    cost_record_count INTEGER NOT NULL CHECK (cost_record_count = 0),
    cost_event_count INTEGER NOT NULL CHECK (cost_event_count = 0),
    source_snapshot_count INTEGER NOT NULL CHECK (source_snapshot_count = 0),
    evidence_record_count INTEGER NOT NULL CHECK (evidence_record_count = 0),
    total_aud_cost_cents INTEGER NOT NULL CHECK (total_aud_cost_cents = 0),
    skipped_at TEXT NOT NULL CHECK (julianday(skipped_at) IS NOT NULL),
    skip_json TEXT NOT NULL
      CHECK (
        json_valid(skip_json)
        AND json_extract(skip_json, '$.schema')
          IS 'pantheon.preventure-research-assignment-skip.v1'
        AND json_extract(skip_json, '$.terminalStopId') IS terminal_stop_id
        AND json_extract(skip_json, '$.authorityHash') IS authority_hash
        AND json_extract(skip_json, '$.triggerAssignmentHash') IS trigger_assignment_hash
        AND json_extract(skip_json, '$.assignmentId') IS assignment_id
        AND json_extract(skip_json, '$.assignmentHash') IS assignment_hash
        AND json_extract(skip_json, '$.assignmentOrder') IS assignment_order
        AND json_extract(skip_json, '$.taskId') IS task_id
        AND json_extract(skip_json, '$.dispatchState') IS dispatch_state
        AND json_extract(skip_json, '$.taskAttemptCount') IS task_attempt_count
        AND json_extract(skip_json, '$.modelCallCount') IS model_call_count
        AND json_extract(skip_json, '$.agentRunReceiptCount') IS agent_run_receipt_count
        AND json_extract(skip_json, '$.researchRunCount') IS research_run_count
        AND json_extract(skip_json, '$.agentRunCount') IS agent_run_count
        AND json_extract(skip_json, '$.toolInvocationCount') IS tool_invocation_count
        AND json_extract(skip_json, '$.budgetReservationCount') IS budget_reservation_count
        AND json_extract(skip_json, '$.costRecordCount') IS cost_record_count
        AND json_extract(skip_json, '$.costEventCount') IS cost_event_count
        AND json_extract(skip_json, '$.sourceSnapshotCount') IS source_snapshot_count
        AND json_extract(skip_json, '$.evidenceRecordCount') IS evidence_record_count
        AND json_extract(skip_json, '$.totalAudCostCents') IS total_aud_cost_cents
        AND json_extract(skip_json, '$.skippedAt') IS skipped_at
        AND json_extract(skip_json, '$.skipRecordHash') IS skip_record_hash
      ),
    created_at TEXT NOT NULL CHECK (julianday(created_at) IS NOT NULL),
    UNIQUE (authority_hash, terminal_stop_id, assignment_hash),
    FOREIGN KEY (authority_hash, terminal_stop_id)
      REFERENCES preventure_research_terminal_stops(authority_hash, terminal_stop_id)
      DEFERRABLE INITIALLY DEFERRED,
    FOREIGN KEY (authority_hash, trigger_assignment_hash)
      REFERENCES preventure_research_assignments(authority_hash, assignment_hash),
    FOREIGN KEY (authority_hash, assignment_hash)
      REFERENCES preventure_research_assignments(authority_hash, assignment_hash),
    FOREIGN KEY (task_id) REFERENCES tasks(id)
  );
`;

const PREVENTURE_RESEARCH_REQUIRED_INDEX_SQL = Object.freeze({
  idx_preventure_research_authority_version: `
    CREATE UNIQUE INDEX IF NOT EXISTS idx_preventure_research_authority_version
    ON preventure_research_authorities(authority_id, authority_version)
  `,
  idx_preventure_research_authority_readiness: `
    CREATE INDEX IF NOT EXISTS idx_preventure_research_authority_readiness
    ON preventure_research_authorities(readiness_id, readiness_version, created_at DESC)
  `,
  idx_preventure_research_authority_supersession: `
    CREATE UNIQUE INDEX IF NOT EXISTS idx_preventure_research_authority_supersession
    ON preventure_research_authorities(supersedes_authority_hash)
    WHERE supersedes_authority_hash IS NOT NULL
  `,
  idx_preventure_research_lifecycle_latest: `
    CREATE INDEX IF NOT EXISTS idx_preventure_research_lifecycle_latest
    ON preventure_research_lifecycle_events(authority_hash, sequence DESC)
  `,
  idx_preventure_research_lifecycle_approval_once: `
    CREATE UNIQUE INDEX IF NOT EXISTS idx_preventure_research_lifecycle_approval_once
    ON preventure_research_lifecycle_events(approval_id)
    WHERE approval_id IS NOT NULL AND event_type IN ('accepted', 'activated')
  `,
  idx_preventure_research_assignment_identity: `
    CREATE UNIQUE INDEX IF NOT EXISTS idx_preventure_research_assignment_identity
    ON preventure_research_assignments(authority_hash, assignment_id, assignment_version)
  `,
  idx_preventure_research_assignment_task: `
    CREATE UNIQUE INDEX IF NOT EXISTS idx_preventure_research_assignment_task
    ON preventure_research_assignments(task_id)
  `,
  idx_task_attempts_one_running_per_task: `
    CREATE UNIQUE INDEX IF NOT EXISTS idx_task_attempts_one_running_per_task
    ON task_attempts(task_id)
    WHERE status = 'running'
  `,
  idx_preventure_research_cost_chain: `
    CREATE INDEX IF NOT EXISTS idx_preventure_research_cost_chain
    ON preventure_research_cost_events(assignment_hash, cost_key, sequence DESC)
  `,
  idx_preventure_research_cost_predecessor: `
    CREATE UNIQUE INDEX IF NOT EXISTS idx_preventure_research_cost_predecessor
    ON preventure_research_cost_events(previous_receipt_hash)
    WHERE previous_receipt_hash IS NOT NULL
  `,
  idx_preventure_research_terminal_recovery_authority: `
    CREATE INDEX IF NOT EXISTS idx_preventure_research_terminal_recovery_authority
    ON preventure_research_terminal_recoveries(authority_hash, recorded_at, recovery_hash)
  `,
  idx_preventure_research_terminal_recovery_event: `
    CREATE INDEX IF NOT EXISTS idx_preventure_research_terminal_recovery_event
    ON preventure_research_terminal_recoveries(terminal_kind, terminal_record_id, recorded_at)
  `,
  idx_preventure_research_owner_billing_observation_time: `
    CREATE INDEX IF NOT EXISTS idx_preventure_research_owner_billing_observation_time
    ON preventure_research_provider_billing_observations(
      authority_hash, original_cost_occurred_at, recorded_at, observation_hash
    )
  `,
  idx_preventure_research_source_assignment: `
    CREATE INDEX IF NOT EXISTS idx_preventure_research_source_assignment
    ON preventure_research_source_snapshots(assignment_hash, retrieved_at, snapshot_hash)
  `,
  idx_preventure_research_source_supersession: `
    CREATE UNIQUE INDEX IF NOT EXISTS idx_preventure_research_source_supersession
    ON preventure_research_source_snapshots(supersedes_snapshot_hash)
    WHERE supersedes_snapshot_hash IS NOT NULL
  `,
  idx_preventure_research_source_identity: `
    CREATE UNIQUE INDEX IF NOT EXISTS idx_preventure_research_source_identity
    ON preventure_research_source_snapshots(authority_hash, source_identity_hash)
    WHERE source_identity_hash IS NOT NULL
  `,
  idx_preventure_research_offer_identity: `
    CREATE UNIQUE INDEX IF NOT EXISTS idx_preventure_research_offer_identity
    ON preventure_research_source_snapshots(authority_hash, offer_identity_key)
    WHERE offer_identity_key IS NOT NULL
  `,
  idx_preventure_research_evidence_question: `
    CREATE INDEX IF NOT EXISTS idx_preventure_research_evidence_question
    ON preventure_research_evidence_records(authority_hash, question_id, captured_at, evidence_hash)
  `,
  idx_preventure_research_evidence_source: `
    CREATE INDEX IF NOT EXISTS idx_preventure_research_evidence_source
    ON preventure_research_evidence_records(source_snapshot_hash)
    WHERE source_snapshot_hash IS NOT NULL
  `,
  idx_preventure_research_evidence_supersession: `
    CREATE UNIQUE INDEX IF NOT EXISTS idx_preventure_research_evidence_supersession
    ON preventure_research_evidence_records(supersedes_evidence_hash)
    WHERE supersedes_evidence_hash IS NOT NULL
  `,
  idx_preventure_research_decision_authority: `
    CREATE UNIQUE INDEX IF NOT EXISTS idx_preventure_research_decision_authority
    ON preventure_research_decisions(authority_hash)
  `,
  idx_preventure_research_decision_identity: `
    CREATE UNIQUE INDEX IF NOT EXISTS idx_preventure_research_decision_identity
    ON preventure_research_decisions(authority_hash, decision_id)
  `,
  idx_preventure_research_terminal_stop_assignment: `
    CREATE UNIQUE INDEX IF NOT EXISTS idx_preventure_research_terminal_stop_assignment
    ON preventure_research_terminal_stops(authority_hash, trigger_assignment_hash)
  `,
  idx_preventure_research_assignment_skip_order: `
    CREATE UNIQUE INDEX IF NOT EXISTS idx_preventure_research_assignment_skip_order
    ON preventure_research_assignment_skips(authority_hash, assignment_order)
  `,
  idx_preventure_research_decision_outcome: `
    CREATE INDEX IF NOT EXISTS idx_preventure_research_decision_outcome
    ON preventure_research_decisions(outcome, decided_at DESC)
  `,
});

const PREVENTURE_RESEARCH_OWNERSHIP_TRIGGER_SQL = Object.freeze({
  trg_approvals_venture_owner: `
    CREATE TRIGGER IF NOT EXISTS trg_approvals_venture_owner
    AFTER INSERT ON approvals
    FOR EACH ROW
    WHEN NEW.venture_id IS NULL
      AND NOT (
        json_valid(NEW.scope)
        AND json_extract(NEW.scope, '$.schema') IN (
          'pantheon.preventure-research-approval-scope.v1',
          'pantheon.preventure-research-approval-scope.v2'
        )
      )
      AND NOT (
        json_valid(NEW.payload)
        AND json_extract(
          NEW.payload,
          '$.preventureResearchApprovalScope.schema'
        ) IN (
          'pantheon.preventure-research-approval-scope.v1',
          'pantheon.preventure-research-approval-scope.v2'
        )
      )
    BEGIN
      UPDATE approvals
      SET venture_id = COALESCE(
        (SELECT venture_id FROM workflows WHERE workflows.id = NEW.workflow_id),
        (SELECT id FROM ventures WHERE is_active = 1 ORDER BY created_at ASC LIMIT 1),
        (SELECT id FROM ventures ORDER BY created_at ASC LIMIT 1)
      )
      WHERE id = NEW.id;
    END
  `,
  trg_events_venture_owner: `
    CREATE TRIGGER IF NOT EXISTS trg_events_venture_owner
    AFTER INSERT ON events
    FOR EACH ROW
    WHEN NEW.venture_id IS NULL
      AND NOT ${preventureResearchEventOwnershipCondition()}
    BEGIN
      UPDATE events
      SET venture_id = COALESCE(
        (SELECT id FROM ventures WHERE is_active = 1 ORDER BY created_at ASC LIMIT 1),
        (SELECT id FROM ventures ORDER BY created_at ASC LIMIT 1)
      )
      WHERE id = NEW.id;
    END
  `,
  trg_workflows_venture_owner: `
    CREATE TRIGGER IF NOT EXISTS trg_workflows_venture_owner
    AFTER INSERT ON workflows
    FOR EACH ROW
    WHEN NEW.venture_id IS NULL AND NEW.type <> 'preventure_research'
    BEGIN
      UPDATE workflows
      SET venture_id = COALESCE(
        (SELECT id FROM ventures WHERE is_active = 1 ORDER BY created_at ASC LIMIT 1),
        (SELECT id FROM ventures ORDER BY created_at ASC LIMIT 1)
      )
      WHERE id = NEW.id;
    END
  `,
  trg_tasks_venture_owner: `
    CREATE TRIGGER IF NOT EXISTS trg_tasks_venture_owner
    AFTER INSERT ON tasks
    FOR EACH ROW
    WHEN NEW.venture_id IS NULL
      AND NEW.kind <> 'preventure_research'
      AND NOT EXISTS (
        SELECT 1 FROM workflows
        WHERE id = NEW.workflow_id AND type = 'preventure_research'
      )
    BEGIN
      UPDATE tasks
      SET venture_id = COALESCE(
        (SELECT venture_id FROM workflows WHERE workflows.id = NEW.workflow_id),
        (SELECT id FROM ventures WHERE is_active = 1 ORDER BY created_at ASC LIMIT 1),
        (SELECT id FROM ventures ORDER BY created_at ASC LIMIT 1)
      )
      WHERE id = NEW.id;
    END
  `,
  trg_task_attempts_venture_owner: `
    CREATE TRIGGER IF NOT EXISTS trg_task_attempts_venture_owner
    AFTER INSERT ON task_attempts
    FOR EACH ROW
    WHEN NEW.venture_id IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM tasks
        WHERE id = NEW.task_id AND kind = 'preventure_research'
      )
      AND NOT EXISTS (
        SELECT 1 FROM workflows
        WHERE id = NEW.workflow_id AND type = 'preventure_research'
      )
    BEGIN
      UPDATE task_attempts
      SET venture_id = COALESCE(
        (SELECT venture_id FROM workflows WHERE workflows.id = NEW.workflow_id),
        (SELECT id FROM ventures WHERE is_active = 1 ORDER BY created_at ASC LIMIT 1),
        (SELECT id FROM ventures ORDER BY created_at ASC LIMIT 1)
      )
      WHERE id = NEW.id;
    END
  `,
  trg_model_calls_venture_owner: `
    CREATE TRIGGER IF NOT EXISTS trg_model_calls_venture_owner
    AFTER INSERT ON model_calls
    FOR EACH ROW
    WHEN NEW.venture_id IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM tasks
        WHERE id = NEW.task_id AND kind = 'preventure_research'
      )
      AND NOT EXISTS (
        SELECT 1 FROM workflows
        WHERE id = NEW.workflow_id AND type = 'preventure_research'
      )
    BEGIN
      UPDATE model_calls
      SET venture_id = COALESCE(
        (SELECT venture_id FROM workflows WHERE workflows.id = NEW.workflow_id),
        (SELECT id FROM ventures WHERE is_active = 1 ORDER BY created_at ASC LIMIT 1),
        (SELECT id FROM ventures ORDER BY created_at ASC LIMIT 1)
      )
      WHERE id = NEW.id;
    END
  `,
  trg_research_runs_venture_owner: `
    CREATE TRIGGER IF NOT EXISTS trg_research_runs_venture_owner
    AFTER INSERT ON research_runs
    FOR EACH ROW
    WHEN NEW.venture_id IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM tasks
        WHERE id = NEW.task_id AND kind = 'preventure_research'
      )
      AND NOT EXISTS (
        SELECT 1 FROM workflows
        WHERE id = NEW.workflow_id AND type = 'preventure_research'
      )
    BEGIN
      UPDATE research_runs
      SET venture_id = COALESCE(
        (SELECT venture_id FROM workflows WHERE workflows.id = NEW.workflow_id),
        (SELECT id FROM ventures WHERE is_active = 1 ORDER BY created_at ASC LIMIT 1),
        (SELECT id FROM ventures ORDER BY created_at ASC LIMIT 1)
      )
      WHERE id = NEW.id;
    END
  `,
  trg_costs_venture_owner: `
    CREATE TRIGGER IF NOT EXISTS trg_costs_venture_owner
    AFTER INSERT ON costs
    FOR EACH ROW
    WHEN NEW.venture_id IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM tasks
        WHERE id = NEW.task_id AND kind = 'preventure_research'
      )
      AND NOT EXISTS (
        SELECT 1 FROM workflows
        WHERE id = NEW.workflow_id AND type = 'preventure_research'
      )
    BEGIN
      UPDATE costs
      SET venture_id = COALESCE(
        (SELECT venture_id FROM workflows WHERE workflows.id = NEW.workflow_id),
        (SELECT id FROM ventures WHERE is_active = 1 ORDER BY created_at ASC LIMIT 1),
        (SELECT id FROM ventures ORDER BY created_at ASC LIMIT 1)
      )
      WHERE id = NEW.id;
    END
  `,
  trg_agent_runs_venture_owner: `
    CREATE TRIGGER IF NOT EXISTS trg_agent_runs_venture_owner
    AFTER INSERT ON agent_runs
    FOR EACH ROW
    WHEN NEW.venture_id IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM tasks
        WHERE id = NEW.task_id AND kind = 'preventure_research'
      )
      AND NOT EXISTS (
        SELECT 1 FROM workflows
        WHERE id = NEW.workflow_id AND type = 'preventure_research'
      )
    BEGIN
      UPDATE agent_runs
      SET venture_id = COALESCE(
        (SELECT venture_id FROM workflows WHERE workflows.id = NEW.workflow_id),
        (SELECT id FROM ventures WHERE is_active = 1 ORDER BY created_at ASC LIMIT 1),
        (SELECT id FROM ventures ORDER BY created_at ASC LIMIT 1)
      )
      WHERE id = NEW.id;
    END
  `,
  trg_budget_reservations_venture_owner: `
    CREATE TRIGGER IF NOT EXISTS trg_budget_reservations_venture_owner
    AFTER INSERT ON budget_reservations
    FOR EACH ROW
    WHEN NEW.venture_id IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM tasks
        WHERE id = NEW.task_id AND kind = 'preventure_research'
      )
      AND NOT EXISTS (
        SELECT 1 FROM workflows
        WHERE id = NEW.workflow_id AND type = 'preventure_research'
      )
    BEGIN
      UPDATE budget_reservations
      SET venture_id = COALESCE(
        (SELECT venture_id FROM workflows WHERE workflows.id = NEW.workflow_id),
        (SELECT id FROM ventures WHERE is_active = 1 ORDER BY created_at ASC LIMIT 1),
        (SELECT id FROM ventures ORDER BY created_at ASC LIMIT 1)
      )
      WHERE id = NEW.id;
    END
  `,
});

const REQUIRED_SCHEMA_SHAPE = Object.freeze({
  settings: ["key", "value", "updated_at"],
  ventures: ["id", "status", "lifecycle_stage", "is_active", "metadata"],
  commands: ["id", "status", "workflow_id", "venture_id", "metadata"],
  workflows: ["id", "venture_id", "status", "metadata", "updated_at"],
  tasks: ["id", "workflow_id", "venture_id", "claim_token", "outcome_status"],
  approvals: [
    "id", "workflow_id", "venture_id", "task_id", "scope_hash", "consumed_at", "decided_by",
  ],
  task_attempts: ["id", "task_id", "claim_token", "status", "outcome_status"],
  deliverables: ["id", "workflow_id", "venture_id", "status", "file_path", "content_hash", "metadata"],
  deliverable_quality_reviews: [
    "id",
    "deliverable_id",
    "verdict",
    "input_hash",
    "findings",
    "created_at",
  ],
  model_calls: [
    "id",
    "task_id",
    "provider_request_id",
    "cost_status",
    "outcome_status",
    "error",
    "completed_at",
  ],
  commercial_results: [
    "id",
    "venture_id",
    "revenue_cents",
    "refund_amount_cents",
    "platform_fee_cents",
    "fulfilment_cost_cents",
    "product_cost_cents",
    "tool_cost_cents",
    "attributed_ai_cost_cents",
    "other_cost_cents",
    "verified",
  ],
  platform_sales: [
    "id",
    "venture_id",
    "platform",
    "platform_purchase_id",
    "buyer_hash",
    "status",
    "gross_cents",
    "currency",
    "aud_gross_cents",
    "aud_net_cents",
  ],
  accounting_entries: [
    "id",
    "venture_id",
    "entry_type",
    "effect_sign",
    "amount_cents",
    "currency",
    "status",
    "source",
    "metadata",
  ],
  costs: [
    "id",
    "venture_id",
    "status",
    "amount_cents",
    "currency",
    "metadata",
  ],
  revenue: ["id", "venture_id", "status", "amount_cents", "currency", "metadata"],
  events: ["id", "ts", "actor", "type", "entity_type", "entity_id", "metadata", "venture_id"],
  commercial_evidence: [
    "id",
    "venture_id",
    "source_type",
    "source_url",
    "claim",
    "metric",
    "measured_value",
    "measured_unit",
    "market",
    "geography",
    "observed_at",
    "sample_size",
  ],
  opportunity_rounds: ["id", "status", "mode", "prompt", "created_at"],
  opportunities: ["id", "round_id", "source_type", "status", "overall_score", "evidence_ids"],
  catalogue_plans: ["id", "venture_id", "opportunity_id", "status", "target_item_count"],
  catalogue_items: ["id", "plan_id", "venture_id", "status", "quality_status"],
  commercial_diagnoses: ["id", "experiment_id", "status", "primary_constraint", "dimensions"],
  operating_mandates: ["id", "period_start", "period_end", "budget_cap_cents", "status"],
  supervisor_cycles: ["id", "status", "trigger_type", "next_action_type", "created_at"],
  pantheon_journeys: ["id", "venture_id", "status", "active_stage", "workflow_id", "metadata"],
  commercial_knowledge: [
    "id",
    "source_id",
    "knowledge_class",
    "domain",
    "proposition",
    "confidence",
    "review_date",
    "status",
    "version",
  ],
  commercial_decision_cases: [
    "id",
    "status",
    "recommendation",
    "criteria",
    "missing_evidence",
    "decision_hash",
  ],
  service_trials: ["id", "service_name", "status", "cap_cents", "hypothesis", "retention_thresholds"],
  venture_kits: [
    "id",
    "version",
    "status",
    "business_models",
    "acceptance_criteria",
    "content_hash",
  ],
  capability_assurance_records: [
    "id",
    "capability_key",
    "proof_kind",
    "source_framework",
    "source_record_id",
    "status",
  ],
  agent_run_receipts: [
    "id",
    "attempt_id",
    "run_id",
    "task_id",
    "status",
    "outcome_status",
    "snapshot_hash",
    "receipt_hash",
    "receipt",
    "created_at",
  ],
  agent_run_provenance: [
    "id",
    "fingerprint",
    "run_id",
    "task_id",
    "kind",
    "input_hash",
    "output_hash",
    "metadata",
  ],
  venture_records: [
    "id",
    "venture_id",
    "record_class",
    "record_type",
    "content_hash",
    "metadata",
    "created_at",
  ],
  data_retention_policy_activations: [
    "id",
    "policy_id",
    "policy_hash",
    "approval_id",
    "proof_hash",
    "activated_at",
  ],
  commercial_test_contracts: [
    "decision_hash",
    "contract_schema",
    "program_id",
    "program_version",
    "test_id",
    "test_version",
    "venture_id",
    "venture_kit_id",
    "venture_kit_version",
    "venture_kit_hash",
    "offer_id",
    "offer_version",
    "offer_hash",
    "offer_sku",
    "experiment_id",
    "experiment_version",
    "cohort_id",
    "channel_id",
    "provider_namespace",
    "account_hash",
    "adapter_id",
    "adapter_version",
    "adapter_hash",
    "reporting_starts_at",
    "reporting_ends_at",
    "buyer_key_id",
    "buyer_key_version",
    "buyer_independence_basis",
    "price_aud_cents",
    "operator_role",
    "external_spend_cap_cents",
    "contract_json",
  ],
  commercial_test_lifecycle_events: [
    "id",
    "decision_hash",
    "sequence",
    "previous_event_hash",
    "event_type",
    "event_hash",
    "approval_scope_hash",
    "event_json",
    "occurred_at",
  ],
  commercial_test_evidence_receipts: [
    "decision_hash",
    "receipt_id",
    "receipt_schema",
    "source_kind",
    "source_id",
    "provider_namespace",
    "account_hash",
    "source_system",
    "export_type",
    "source_hash",
    "receipt_hash",
    "location_reference",
    "verification_status",
    "reporting_starts_at",
    "reporting_ends_at",
    "coverage_basis",
    "coverage_declared_row_count",
    "coverage_control_hash",
    "generated_at",
    "imported_at",
    "import_batch_id",
    "manual_reference_hash",
    "attested_by",
    "attestation_note",
    "entry_reason",
    "receipt_json",
    "captured_at",
  ],
  commercial_test_evidence_records: [
    "record_hash",
    "evidence_schema",
    "decision_hash",
    "evidence_id",
    "evidence_version",
    "kind",
    "source_kind",
    "source_id",
    "provider_namespace",
    "account_hash",
    "source_system",
    "export_type",
    "source_hash",
    "source_row_hash",
    "receipt_id",
    "receipt_hash",
    "verification_status",
    "reporting_starts_at",
    "reporting_ends_at",
    "coverage_basis",
    "coverage_declared_row_count",
    "coverage_control_hash",
    "captured_at",
    "supersedes_record_hash",
    "transaction_key",
    "transaction_id_hash",
    "transaction_economic_hash",
    "buyer_pseudonym",
    "buyer_key_id",
    "buyer_key_version",
    "buyer_independence_basis",
    "transaction_event_type",
    "transaction_chain_sequence",
    "transaction_status",
    "settlement_state",
    "settlement_reference_hash",
    "occurred_at",
    "settled_at",
    "gross_revenue_original_minor_units",
    "gross_revenue_currency",
    "gross_revenue_aud_cents",
    "refunds_original_minor_units",
    "refunds_currency",
    "refunds_aud_cents",
    "cost_key",
    "cost_id_hash",
    "cost_economic_hash",
    "cost_event_type",
    "cost_chain_sequence",
    "cost_category",
    "cost_state",
    "cost_original_minor_units",
    "cost_currency",
    "cost_aud_cents",
    "attribution_status",
    "record_json",
  ],
  commercial_test_proof_evaluations: [
    "evaluation_hash",
    "proof_schema",
    "decision_hash",
    "evidence_set_hash",
    "outcome",
    "proof_reached",
    "buyer_signal_only",
    "distinct_positive_buyers",
    "settled_revenue_aud_cents",
    "refunds_aud_cents",
    "reconciled_costs_aud_cents",
    "actual_net_cash_contribution_aud_cents",
    "evaluation_json",
    "evaluated_at",
  ],
  preventure_research_authorities: [
    "authority_hash",
    "authority_schema",
    "authority_id",
    "authority_version",
    "readiness_id",
    "readiness_version",
    "readiness_hash",
    "provider_id",
    "provider_model",
    "approved_at",
    "expires_at",
    "internal_ai_spend_cap_aud_cents",
    "total_worst_case_exposure_aud_cents",
    "external_commercial_spend_cap_aud_cents",
    "authority_json",
    "readiness_json",
  ],
  preventure_research_approval_decisions: [
    "decision_receipt_hash",
    "approval_id",
    "authority_hash",
    "event_type",
    "scope_hash",
    "requested_by",
    "requested_at",
    "decided_by",
    "decision_source",
    "decision_status",
    "decided_at",
    "receipt_json",
  ],
  preventure_research_lifecycle_events: [
    "id",
    "authority_hash",
    "sequence",
    "previous_event_hash",
    "event_type",
    "event_hash",
    "approval_id",
    "approval_scope_hash",
    "decision_hash",
    "successor_authority_hash",
    "event_json",
    "occurred_at",
  ],
  preventure_research_assignments: [
    "assignment_hash",
    "authority_hash",
    "activation_event_hash",
    "assignment_id",
    "assignment_version",
    "template_hash",
    "workflow_id",
    "task_id",
    "provider_id",
    "provider_model",
    "max_cost_aud_cents",
    "max_attempts",
    "max_tool_calls",
    "maximum_model_passes",
    "max_input_tokens",
    "local_prompt_preflight_max_input_tokens",
    "max_output_tokens",
    "max_turns",
    "deadline_ms",
    "worst_case_exposure_json",
    "expires_at",
    "assignment_json",
  ],
  preventure_research_cost_events: [
    "receipt_hash",
    "authority_hash",
    "assignment_hash",
    "cost_key",
    "sequence",
    "previous_receipt_hash",
    "event_type",
    "amount_aud_cents",
    "exposure_aud_cents",
    "budget_reservation_id",
    "cost_id",
    "cost_json",
    "occurred_at",
  ],
  preventure_research_terminal_recoveries: [
    "recovery_hash",
    "authority_hash",
    "assignment_hash",
    "assignment_template_hash",
    "task_id",
    "workflow_id",
    "task_attempt_id",
    "model_call_id",
    "terminal_kind",
    "terminal_record_id",
    "terminal_event_type",
    "terminal_event_hash",
    "lifecycle_event_id",
    "emergency_event_id",
    "terminal_at",
    "original_claim_token_hash",
    "descriptor_hash",
    "request_body_hash",
    "client_request_id",
    "provider_request_id",
    "provider_response_id",
    "provider_dispatched_at",
    "artifact_hash",
    "artifact_ref",
    "artifact_kind",
    "retained_at",
    "prior_cost_receipt_hash",
    "cost_truth",
    "exposure_aud_cents",
    "exact_billing_pending",
    "recovery_json",
    "recorded_at",
  ],
  preventure_research_provider_billing_observations: [
    "observation_hash",
    "action_kind",
    "authority_hash",
    "assignment_hash",
    "assignment_template_hash",
    "task_id",
    "predecessor_kind",
    "predecessor_hash",
    "expected_previous_receipt_hash",
    "task_attempt_id",
    "model_call_id",
    "agent_run_receipt_id",
    "agent_run_receipt_hash",
    "cost_key",
    "budget_reservation_id",
    "cost_id",
    "client_request_id",
    "provider_request_id",
    "provider_response_id",
    "provider",
    "provider_account_reference_hash",
    "billing_record_reference_hash",
    "currency",
    "amount_aud_cents",
    "observed_at",
    "original_cost_occurred_at",
    "provider_dispatched_at",
    "allocation_basis_json",
    "limitations_json",
    "budget_comparison_json",
    "truth_status",
    "observation_json",
    "recorded_at",
    "created_at",
  ],
  preventure_research_terminal_stops: [
    "early_stop_record_hash",
    "terminal_stop_id",
    "authority_hash",
    "expected_decision_id",
    "expected_completion_event_id",
    "trigger_assignment_id",
    "trigger_assignment_hash",
    "trigger_outcome_class",
    "reason_class",
    "reason_code",
    "commercial_inference",
    "provider_evidence_json",
    "actual_coverage_json",
    "gap_codes_json",
    "skipped_assignments_json",
    "next_evidence_action_json",
    "prior_evidence_set_hash",
    "prior_receipt_set_hash",
    "stopped_at",
    "stop_json",
  ],
  preventure_research_assignment_skips: [
    "skip_record_hash",
    "terminal_stop_id",
    "authority_hash",
    "trigger_assignment_hash",
    "assignment_id",
    "assignment_hash",
    "assignment_order",
    "task_id",
    "dispatch_state",
    "task_attempt_count",
    "model_call_count",
    "agent_run_receipt_count",
    "research_run_count",
    "agent_run_count",
    "tool_invocation_count",
    "budget_reservation_count",
    "cost_record_count",
    "cost_event_count",
    "source_snapshot_count",
    "evidence_record_count",
    "total_aud_cost_cents",
    "skipped_at",
    "skip_json",
  ],
  preventure_research_source_snapshots: [
    "snapshot_hash",
    "authority_hash",
    "assignment_hash",
    "source_id",
    "source_version",
    "source_class",
    "source_tier",
    "capture_status",
    "canonical_url",
    "canonical_host",
    "source_identity_url",
    "source_identity_hash",
    "marketplace_channel_id",
    "offer_identity_key",
    "seller_identity_key",
    "identity_derivation",
    "publisher_identity_key",
    "buyer_independence_group",
    "content_hash",
    "limitations_json",
    "retrieved_at",
    "snapshot_json",
  ],
  preventure_research_evidence_records: [
    "evidence_hash",
    "authority_hash",
    "assignment_hash",
    "evidence_id",
    "evidence_version",
    "source_snapshot_hash",
    "truth_class",
    "polarity",
    "question_id",
    "claim",
    "limitations_json",
    "evidence_json",
    "captured_at",
  ],
  preventure_research_decisions: [
    "decision_hash",
    "decision_schema",
    "authority_hash",
    "decision_id",
    "decision_version",
    "outcome",
    "completion_mode",
    "early_stop_record_hash",
    "skipped_assignment_record_hashes_json",
    "next_evidence_action_json",
    "comparator_count",
    "estimated_internal_ai_cost_aud_cents",
    "reconciled_internal_ai_cost_aud_cents",
    "exact_billing_pending",
    "external_commercial_spend_aud_cents",
    "provenance_complete",
    "unknown_provider_outcome_count",
    "unknown_cost_count",
    "evidence_set_hash",
    "receipt_set_hash",
    "decision_json",
    "decided_at",
  ],
});

function now() {
  return new Date().toISOString();
}

function toJson(value) {
  return JSON.stringify(value ?? {});
}

function fromJson(value, fallback = {}) {
  if (value === null || value === undefined || value === "") return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function prepareArgs(params) {
  if (Array.isArray(params)) return params;
  if (params && typeof params === "object") return [params];
  return [];
}

function run(db, sql, params = []) {
  return db.prepare(sql).run(...prepareArgs(params));
}

function get(db, sql, params = []) {
  return db.prepare(sql).get(...prepareArgs(params));
}

function all(db, sql, params = []) {
  return db.prepare(sql).all(...prepareArgs(params));
}

function openDatabase(dbPath = CONFIG.dbPath, options = {}) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  const clock = typeof options.clock === "function"
    ? options.clock
    : () => new Date().toISOString();
  db.function("pantheon_current_time", () => {
    const value = clock();
    const parsed = value instanceof Date ? value.toISOString() : String(value || "");
    if (!Number.isFinite(Date.parse(parsed))) {
      throw new Error("Pantheon database clock returned an invalid timestamp.");
    }
    return new Date(parsed).toISOString();
  });
  registerPreventureOwnerApprovalCapabilityFunction(db);
  registerPreventureValidatedEarlyStopCapabilityFunction(db);
  registerPreventureProviderCostReconciliationCapabilityFunction(db);
  registerPreventureOwnerBillingObservationCapabilityFunction(db);
  registerPreventureTerminalRetainedRecoveryCapabilityFunction(db);
  registerPreventureTerminalReceiptCapabilityFunction(db);
  registerPreventureEmergencyCostSafetyCapabilityFunction(db);
  const ownerAttestationProbe = db.prepare(
    `SELECT pantheon_preventure_owner_attestation_capability(
       NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL
     ) AS authorized`,
  ).get();
  if (Number(ownerAttestationProbe.authorized) !== 0) {
    db.close();
    throw new Error("Pantheon owner-session attestation guard did not fail closed.");
  }
  const earlyStopProbe = db.prepare(
    `SELECT pantheon_preventure_validated_early_stop_capability(
       NULL, NULL, NULL, NULL, NULL
     ) AS authorized`,
  ).get();
  if (Number(earlyStopProbe.authorized) !== 0) {
    db.close();
    throw new Error("Pantheon validated early-stop database guard did not fail closed.");
  }
  const providerCostReconciliationProbe = db.prepare(
    `SELECT pantheon_preventure_provider_cost_reconciliation_capability(
       NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL
     ) AS authorized`,
  ).get();
  if (Number(providerCostReconciliationProbe.authorized) !== 0) {
    db.close();
    throw new Error("Pantheon provider-cost reconciliation guard did not fail closed.");
  }
  const ownerBillingObservationProbe = db.prepare(
    `SELECT pantheon_preventure_owner_billing_observation_capability(
       NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL
     ) AS authorized`,
  ).get();
  if (Number(ownerBillingObservationProbe.authorized) !== 0) {
    db.close();
    throw new Error("Pantheon owner-billing observation guard did not fail closed.");
  }
  const terminalRetainedRecoveryProbe = db.prepare(
    `SELECT pantheon_preventure_terminal_retained_recovery_capability(
       NULL, NULL, NULL, NULL, NULL, NULL, NULL,
       NULL, NULL, NULL, NULL, NULL, NULL, NULL
     ) AS authorized`,
  ).get();
  if (Number(terminalRetainedRecoveryProbe.authorized) !== 0) {
    db.close();
    throw new Error("Pantheon terminal retained-output recovery guard did not fail closed.");
  }
  const terminalReceiptProbe = db.prepare(
    `SELECT pantheon_preventure_terminal_receipt_capability(
       NULL, NULL, NULL, NULL, NULL, NULL, NULL,
       NULL, NULL, NULL, NULL, NULL, NULL, NULL,
       NULL, NULL, NULL
     ) AS authorized`,
  ).get();
  if (Number(terminalReceiptProbe.authorized) !== 0) {
    db.close();
    throw new Error("Pantheon terminal execution-receipt guard did not fail closed.");
  }
  const emergencyCostSafetyProbe = db.prepare(
    `SELECT pantheon_preventure_emergency_cost_safety_capability(
       NULL, NULL, NULL, NULL, NULL, NULL, NULL
     ) AS authorized`,
  ).get();
  if (Number(emergencyCostSafetyProbe.authorized) !== 0) {
    db.close();
    throw new Error("Pantheon emergency cost-safety guard did not fail closed.");
  }
  db.exec("PRAGMA busy_timeout = 5000;");
  db.exec("PRAGMA foreign_keys = ON;");
  try {
    migrate(db);
    verifyDatabase(db);
    db.exec("PRAGMA journal_mode = WAL;");
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

function normalizeSchemaSql(value) {
  const input = String(value || "").trim().replace(/;\s*$/, "");
  let output = "";
  let outside = "";
  let quote = null;
  const flushOutside = () => {
    output += outside
      .replace(/\bIF\s+NOT\s+EXISTS\b/gi, "")
      .replace(/\s+/g, " ")
      .toLowerCase();
    outside = "";
  };
  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (quote !== null) {
      output += character;
      const closing = quote === "[" ? "]" : quote;
      if (character === closing) {
        if (quote !== "[" && input[index + 1] === closing) {
          output += input[index + 1];
          index += 1;
        } else {
          quote = null;
        }
      }
      continue;
    }
    if (["'", '"', "`", "["].includes(character)) {
      flushOutside();
      quote = character;
      output += character;
    } else {
      outside += character;
    }
  }
  flushOutside();
  return output.trim();
}

function recoverySchemaObjects(db) {
  return all(
    db,
    `SELECT type, name, tbl_name, sql
     FROM sqlite_master
     WHERE type IN ('table', 'index', 'trigger', 'view')
       AND sql IS NOT NULL
       AND name NOT LIKE 'sqlite_%'
     ORDER BY type, name`,
  ).map((row) => ({
    type: String(row.type),
    name: String(row.name),
    tableName: String(row.tbl_name),
    sql: normalizeSchemaSql(row.sql),
  }));
}

function canonicalRecoverySchemaContract() {
  if (canonicalRecoverySchemaContractCache) return canonicalRecoverySchemaContractCache;
  const reference = new DatabaseSync(":memory:");
  try {
    reference.exec("PRAGMA foreign_keys = ON");
    migrate(reference, { verifyBeforeCommit: false });
    canonicalRecoverySchemaContractCache = Object.freeze({
      schemaVersion: LATEST_SCHEMA_VERSION,
      migrations: Object.freeze(
        all(
          reference,
          "SELECT version, name FROM schema_migrations ORDER BY version",
        ).map((row) => Object.freeze({
          version: Number(row.version),
          name: String(row.name),
        })),
      ),
      objects: Object.freeze(
        recoverySchemaObjects(reference).map((row) => Object.freeze(row)),
      ),
    });
    return canonicalRecoverySchemaContractCache;
  } finally {
    reference.close();
  }
}

function verifyCanonicalRecoverySchema(db) {
  const expected = canonicalRecoverySchemaContract();
  const actualMigrations = all(
    db,
    "SELECT version, name FROM schema_migrations ORDER BY version",
  ).map((row) => ({
    version: Number(row.version),
    name: String(row.name),
  }));
  if (JSON.stringify(actualMigrations) !== JSON.stringify(expected.migrations)) {
    throw new Error("Runtime schema migration history does not match the exact supported release.");
  }

  const expectedObjects = new Map(expected.objects.map((object) => [object.name, object]));
  const actualObjects = new Map(recoverySchemaObjects(db).map((object) => [object.name, object]));
  const unexpectedObjects = [...actualObjects.keys()]
    .filter((name) => !expectedObjects.has(name))
    .sort();
  if (unexpectedObjects.length > 0) {
    throw new Error(
      `Runtime schema contains unsupported object(s): ${unexpectedObjects.join(", ")}.`,
    );
  }
  for (const [name, expectedObject] of expectedObjects) {
    const actualObject = actualObjects.get(name);
    if (!actualObject) {
      throw new Error(
        `Runtime schema is missing required ${expectedObject.type} ${name}.`,
      );
    }
    if (
      actualObject.type !== expectedObject.type
      || actualObject.tableName !== expectedObject.tableName
      || actualObject.sql !== expectedObject.sql
    ) {
      throw new Error(
        `Runtime schema ${expectedObject.type} ${name} does not match the exact supported definition.`,
      );
    }
  }
  return {
    migrationCount: expected.migrations.length,
    objectCount: expected.objects.length,
  };
}

function verifyDatabase(db) {
  const quickCheck = get(db, "PRAGMA quick_check");
  if (!quickCheck || Object.values(quickCheck)[0] !== "ok") {
    throw new Error(`SQLite quick check failed: ${JSON.stringify(quickCheck || {})}`);
  }
  const foreignKeyFailures = all(db, "PRAGMA foreign_key_check");
  if (foreignKeyFailures.length) {
    throw new Error(`SQLite foreign-key check failed with ${foreignKeyFailures.length} violation(s).`);
  }
  const current = Number(get(db, "SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations")?.version || 0);
  if (current !== LATEST_SCHEMA_VERSION) {
    throw new Error(`Runtime schema ${current} does not match supported schema ${LATEST_SCHEMA_VERSION}.`);
  }
  for (const [tableName, requiredColumns] of Object.entries(REQUIRED_SCHEMA_SHAPE)) {
    const table = get(
      db,
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
      [tableName],
    );
    if (!table) throw new Error(`Runtime schema is missing required table ${tableName}.`);
    const columns = tableColumns(db, tableName);
    const missing = requiredColumns.filter((column) => !columns.has(column));
    if (missing.length) {
      throw new Error(`Runtime schema table ${tableName} is missing: ${missing.join(", ")}.`);
    }
  }
  const requiredTriggerNames = [
    "trg_tasks_venture_match_insert",
    "trg_tasks_venture_match_update",
    "trg_approvals_venture_match_insert",
    "trg_approvals_venture_match_update",
    "trg_accounting_reconciled_immutable_update",
    "trg_accounting_reconciled_immutable_delete",
    "trg_agent_run_receipts_immutable_update",
    "trg_agent_run_receipts_immutable_delete",
    "trg_agent_run_provenance_immutable_update",
    "trg_agent_run_provenance_immutable_delete",
    "trg_venture_records_immutable_update",
    "trg_venture_records_immutable_delete",
    "trg_deliverable_quality_reviews_immutable_update",
    "trg_deliverable_quality_reviews_immutable_delete",
    ...Object.keys(COMMERCIAL_LEDGER_IMMUTABLE_TRIGGER_SQL),
    ...Object.keys(PREVENTURE_RESEARCH_IMMUTABLE_TRIGGER_SQL),
    ...Object.keys(PREVENTURE_RESEARCH_GUARD_TRIGGER_SQL),
  ];
  for (const triggerName of requiredTriggerNames) {
    const trigger = get(
      db,
      "SELECT name, sql FROM sqlite_master WHERE type = 'trigger' AND name = ?",
      [triggerName],
    );
    if (!trigger) throw new Error(`Runtime schema is missing required fail-closed trigger ${triggerName}.`);
    if (!/\bBEFORE\b/i.test(trigger.sql || "") || !/RAISE\s*\(\s*ABORT\b/i.test(trigger.sql || "")) {
      throw new Error(`Runtime schema trigger ${triggerName} does not retain its fail-closed abort contract.`);
    }
  }
  for (const [triggerName, expectedSql] of Object.entries(
    COMMERCIAL_LEDGER_IMMUTABLE_TRIGGER_SQL,
  )) {
    const actualSql = get(
      db,
      "SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = ?",
      [triggerName],
    )?.sql;
    if (normalizeSchemaSql(actualSql) !== normalizeSchemaSql(expectedSql)) {
      throw new Error(
        `Runtime schema trigger ${triggerName} does not match its exact immutable definition.`,
      );
    }
  }
  for (const [indexName, expectedSql] of Object.entries(
    COMMERCIAL_LEDGER_REQUIRED_INDEX_SQL,
  )) {
    const actualSql = get(
      db,
      "SELECT sql FROM sqlite_master WHERE type = 'index' AND name = ?",
      [indexName],
    )?.sql;
    if (normalizeSchemaSql(actualSql) !== normalizeSchemaSql(expectedSql)) {
      throw new Error(
        `Runtime schema index ${indexName} does not match its required ledger definition.`,
      );
    }
  }
  for (const [triggerName, expectedSql] of Object.entries({
    ...PREVENTURE_RESEARCH_IMMUTABLE_TRIGGER_SQL,
    ...PREVENTURE_RESEARCH_GUARD_TRIGGER_SQL,
  })) {
    const actualSql = get(
      db,
      "SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = ?",
      [triggerName],
    )?.sql;
    if (normalizeSchemaSql(actualSql) !== normalizeSchemaSql(expectedSql)) {
      throw new Error(
        `Runtime schema trigger ${triggerName} does not match its exact pre-venture research definition.`,
      );
    }
  }
  for (const [indexName, expectedSql] of Object.entries(
    PREVENTURE_RESEARCH_REQUIRED_INDEX_SQL,
  )) {
    const actualSql = get(
      db,
      "SELECT sql FROM sqlite_master WHERE type = 'index' AND name = ?",
      [indexName],
    )?.sql;
    if (normalizeSchemaSql(actualSql) !== normalizeSchemaSql(expectedSql)) {
      throw new Error(
        `Runtime schema index ${indexName} does not match its required pre-venture research definition.`,
      );
    }
  }
  for (const [triggerName, expectedSql] of Object.entries(
    PREVENTURE_RESEARCH_OWNERSHIP_TRIGGER_SQL,
  )) {
    const actualSql = get(
      db,
      "SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = ?",
      [triggerName],
    )?.sql;
    if (normalizeSchemaSql(actualSql) !== normalizeSchemaSql(expectedSql)) {
      throw new Error(
        `Runtime schema trigger ${triggerName} does not match its exact pre-venture ownership definition.`,
      );
    }
  }
  verifyCanonicalRecoverySchema(db);
  const {
    ventureKitContentHash,
  } = require("./runtime/venture-kit-definition");
  for (const kit of all(db, "SELECT * FROM venture_kits ORDER BY id, version")) {
    let expectedHash;
    try {
      expectedHash = ventureKitContentHash(kit);
    } catch (error) {
      throw new Error(
        `Runtime Venture Kit ${kit.id}@${kit.version} cannot be verified: ${error.message}`,
      );
    }
    if (kit.content_hash !== expectedHash) {
      throw new Error(
        `Runtime Venture Kit ${kit.id}@${kit.version} does not match its immutable content hash.`,
      );
    }
  }
  const {
    verifyPreventureResearchLedger,
  } = require("./runtime/preventure-research-store");
  verifyPreventureResearchLedger(db, { artifactVerification: "structural" });
  return { quickCheck: "ok", foreignKeyFailures: 0, schemaVersion: current };
}

function migrationApplied(db, version) {
  return Boolean(get(db, "SELECT version FROM schema_migrations WHERE version = ?", [version]));
}

function recordMigration(db, version, name) {
  run(
    db,
    "INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)",
    [version, name, now()],
  );
}

function tableColumns(db, tableName) {
  return new Set(all(db, `PRAGMA table_info(${tableName})`).map((column) => column.name));
}

function addColumn(db, tableName, definition) {
  const columnName = definition.trim().split(/\s+/)[0];
  if (!tableColumns(db, tableName).has(columnName)) {
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${definition}`);
  }
}

function applyFoundationMigration(db) {
  if (migrationApplied(db, 2)) return;
  beginAtomic(db);
  try {
    addColumn(db, "ventures", "lifecycle_stage TEXT NOT NULL DEFAULT 'candidate'");
    addColumn(db, "ventures", "is_active INTEGER NOT NULL DEFAULT 0");
    addColumn(db, "ventures", "business_model TEXT NOT NULL DEFAULT 'digital_product'");
    addColumn(db, "commands", "venture_id TEXT");
    addColumn(db, "tasks", "venture_id TEXT");
    addColumn(db, "tasks", "claim_token TEXT");
    addColumn(db, "tasks", "claimed_at TEXT");
    addColumn(db, "tasks", "attempt_count INTEGER NOT NULL DEFAULT 0");
    addColumn(db, "tasks", "outcome_status TEXT NOT NULL DEFAULT 'not_started'");
    addColumn(db, "tasks", "setup_block_reason TEXT");
    addColumn(db, "approvals", "venture_id TEXT");
    addColumn(db, "approvals", "task_id TEXT");
    addColumn(db, "approvals", "scope_hash TEXT");
    addColumn(db, "approvals", "expires_at TEXT");
    addColumn(db, "approvals", "consumed_at TEXT");
    addColumn(db, "approvals", "expected_effects TEXT NOT NULL DEFAULT '[]'");
    addColumn(db, "deliverables", "venture_id TEXT");
    addColumn(db, "deliverables", "artifact_key TEXT");
    addColumn(db, "deliverables", "content_hash TEXT");
    addColumn(db, "deliverables", "version INTEGER NOT NULL DEFAULT 1");
    addColumn(db, "model_calls", "venture_id TEXT");
    addColumn(db, "model_calls", "provider_request_id TEXT");
    addColumn(db, "model_calls", "cost_status TEXT NOT NULL DEFAULT 'none'");
    addColumn(db, "model_calls", "reserved_cost_cents INTEGER NOT NULL DEFAULT 0");
    addColumn(db, "model_calls", "incurred_estimate_cents INTEGER NOT NULL DEFAULT 0");
    addColumn(db, "model_calls", "reconciled_cost_cents INTEGER NOT NULL DEFAULT 0");
    addColumn(db, "model_calls", "outcome_status TEXT NOT NULL DEFAULT 'not_started'");
    addColumn(db, "model_calls", "error_kind TEXT");
    addColumn(db, "research_runs", "venture_id TEXT");
    addColumn(db, "monitor_findings", "fingerprint TEXT");
    addColumn(db, "monitor_findings", "first_seen TEXT");
    addColumn(db, "monitor_findings", "last_seen TEXT");
    addColumn(db, "monitor_findings", "occurrence_count INTEGER NOT NULL DEFAULT 1");
    addColumn(db, "monitor_findings", "resolved_at TEXT");
    addColumn(db, "costs", "venture_id TEXT");
    addColumn(db, "commercial_results", "venture_id TEXT");
    addColumn(db, "commercial_results", "platform_fee_cents INTEGER NOT NULL DEFAULT 0");
    addColumn(db, "commercial_results", "product_cost_cents INTEGER NOT NULL DEFAULT 0");
    addColumn(db, "commercial_results", "tool_cost_cents INTEGER NOT NULL DEFAULT 0");
    addColumn(db, "commercial_results", "verified INTEGER NOT NULL DEFAULT 0");
    addColumn(db, "messages", "venture_id TEXT");
    addColumn(db, "agent_runs", "venture_id TEXT");

    db.exec(`
      CREATE TABLE IF NOT EXISTS task_attempts (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        workflow_id TEXT,
        venture_id TEXT,
        claim_token TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL,
        outcome_status TEXT NOT NULL DEFAULT 'not_started',
        provider_request_id TEXT,
        error_kind TEXT,
        error TEXT,
        started_at TEXT NOT NULL,
        completed_at TEXT,
        metadata TEXT NOT NULL DEFAULT '{}',
        FOREIGN KEY (task_id) REFERENCES tasks(id)
      );

      CREATE TABLE IF NOT EXISTS budget_reservations (
        id TEXT PRIMARY KEY,
        venture_id TEXT,
        workflow_id TEXT,
        task_id TEXT NOT NULL,
        approval_id TEXT,
        status TEXT NOT NULL,
        amount_cents INTEGER NOT NULL,
        currency TEXT NOT NULL DEFAULT 'AUD',
        reserved_at TEXT NOT NULL,
        resolved_at TEXT,
        metadata TEXT NOT NULL DEFAULT '{}',
        FOREIGN KEY (task_id) REFERENCES tasks(id)
      );

      CREATE TABLE IF NOT EXISTS deliverable_sections (
        id TEXT PRIMARY KEY,
        deliverable_id TEXT NOT NULL,
        task_id TEXT NOT NULL,
        sequence INTEGER NOT NULL DEFAULT 0,
        content TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(deliverable_id, task_id),
        FOREIGN KEY (deliverable_id) REFERENCES deliverables(id),
        FOREIGN KEY (task_id) REFERENCES tasks(id)
      );

      CREATE TABLE IF NOT EXISTS venture_cases (
        id TEXT PRIMARY KEY,
        venture_id TEXT NOT NULL UNIQUE,
        buyer TEXT NOT NULL DEFAULT '',
        problem TEXT NOT NULL DEFAULT '',
        offer TEXT NOT NULL DEFAULT '',
        price_cents INTEGER NOT NULL DEFAULT 0,
        channel TEXT NOT NULL DEFAULT '',
        evidence_standard TEXT NOT NULL DEFAULT '',
        contribution_assumption_cents INTEGER NOT NULL DEFAULT 0,
        active_experiment_id TEXT,
        deadline TEXT,
        expected_metric TEXT NOT NULL DEFAULT '',
        kill_rule TEXT NOT NULL DEFAULT '',
        next_money_move TEXT NOT NULL DEFAULT '',
        operator_decision TEXT NOT NULL DEFAULT '',
        latest_learning TEXT NOT NULL DEFAULT '',
        metadata TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (venture_id) REFERENCES ventures(id)
      );

      CREATE TABLE IF NOT EXISTS commercial_evidence (
        id TEXT PRIMARY KEY,
        venture_id TEXT NOT NULL,
        experiment_id TEXT,
        source_type TEXT NOT NULL,
        source_id TEXT,
        source_url TEXT,
        title TEXT NOT NULL,
        summary TEXT NOT NULL DEFAULT '',
        captured_at TEXT NOT NULL,
        verified_at TEXT,
        is_demo INTEGER NOT NULL DEFAULT 0,
        metadata TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        FOREIGN KEY (venture_id) REFERENCES ventures(id),
        FOREIGN KEY (experiment_id) REFERENCES commercial_experiments(id)
      );

      CREATE TABLE IF NOT EXISTS work_packages (
        id TEXT PRIMARY KEY,
        venture_id TEXT NOT NULL,
        workflow_id TEXT,
        experiment_id TEXT,
        kind TEXT NOT NULL,
        title TEXT NOT NULL,
        status TEXT NOT NULL,
        owner_group TEXT NOT NULL,
        decision_needed TEXT NOT NULL DEFAULT '',
        artifact_id TEXT,
        metadata TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (venture_id) REFERENCES ventures(id)
      );

      CREATE TABLE IF NOT EXISTS capability_autonomy (
        id TEXT PRIMARY KEY,
        capability_key TEXT NOT NULL UNIQUE,
        agent_id TEXT,
        risk_tier INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'supervised',
        consecutive_passes INTEGER NOT NULL DEFAULT 0,
        required_passes INTEGER NOT NULL DEFAULT 5,
        max_cost_cents INTEGER NOT NULL DEFAULT 0,
        promoted_at TEXT,
        suspended_at TEXT,
        last_review_at TEXT,
        metadata TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (agent_id) REFERENCES agent_definitions(id)
      );

      CREATE TABLE IF NOT EXISTS platform_sales (
        id TEXT PRIMARY KEY,
        venture_id TEXT NOT NULL,
        platform TEXT NOT NULL,
        platform_purchase_id TEXT NOT NULL,
        product_name TEXT NOT NULL,
        sold_at TEXT NOT NULL,
        currency TEXT NOT NULL,
        gross_cents INTEGER NOT NULL DEFAULT 0,
        platform_fee_cents INTEGER NOT NULL DEFAULT 0,
        net_cents INTEGER NOT NULL DEFAULT 0,
        refunded_cents INTEGER NOT NULL DEFAULT 0,
        referrer TEXT NOT NULL DEFAULT '',
        buyer_hash TEXT,
        status TEXT NOT NULL DEFAULT 'paid',
        metadata TEXT NOT NULL DEFAULT '{}',
        imported_at TEXT NOT NULL,
        UNIQUE(platform, platform_purchase_id),
        FOREIGN KEY (venture_id) REFERENCES ventures(id)
      );

      CREATE TABLE IF NOT EXISTS agent_pilot_fixtures (
        id TEXT PRIMARY KEY,
        venture_id TEXT NOT NULL,
        candidate_id TEXT,
        captured_at TEXT NOT NULL,
        question TEXT NOT NULL,
        buyer TEXT NOT NULL,
        hypothesis TEXT NOT NULL,
        sources TEXT NOT NULL DEFAULT '[]',
        constraints TEXT NOT NULL DEFAULT '{}',
        fixture_hash TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL DEFAULT 'ready',
        created_at TEXT NOT NULL,
        FOREIGN KEY (venture_id) REFERENCES ventures(id)
      );

      CREATE TABLE IF NOT EXISTS agent_pilot_reviews (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL UNIQUE,
        fixture_id TEXT NOT NULL,
        capability_key TEXT NOT NULL,
        deterministic_status TEXT NOT NULL,
        operator_verdict TEXT NOT NULL DEFAULT 'pending',
        usefulness_score INTEGER,
        note TEXT NOT NULL DEFAULT '',
        criteria TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        reviewed_at TEXT,
        FOREIGN KEY (run_id) REFERENCES agent_runs(id),
        FOREIGN KEY (fixture_id) REFERENCES agent_pilot_fixtures(id)
      );

      CREATE INDEX IF NOT EXISTS idx_tasks_runnable ON tasks(status, priority, created_at);
      CREATE INDEX IF NOT EXISTS idx_tasks_venture ON tasks(venture_id, status);
      CREATE INDEX IF NOT EXISTS idx_task_attempts_task ON task_attempts(task_id, started_at);
      CREATE INDEX IF NOT EXISTS idx_workflows_venture ON workflows(venture_id, status);
      CREATE INDEX IF NOT EXISTS idx_approvals_pending ON approvals(status, expires_at);
      CREATE INDEX IF NOT EXISTS idx_deliverables_workflow ON deliverables(workflow_id, updated_at);
      CREATE INDEX IF NOT EXISTS idx_events_recent ON events(ts DESC);
      CREATE INDEX IF NOT EXISTS idx_evidence_venture ON commercial_evidence(venture_id, captured_at);
      CREATE INDEX IF NOT EXISTS idx_sales_venture ON platform_sales(venture_id, sold_at);
      CREATE INDEX IF NOT EXISTS idx_work_packages_venture ON work_packages(venture_id, status);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_monitor_fingerprint ON monitor_findings(fingerprint) WHERE fingerprint IS NOT NULL;
    `);

    run(db, "UPDATE ventures SET lifecycle_stage = 'validating', is_active = CASE WHEN id = 'venture-digital-products' THEN 1 ELSE 0 END, business_model = 'digital_product'");
    run(db, "UPDATE workflows SET venture_id = 'venture-digital-products' WHERE venture_id IS NULL");
    for (const table of ["commands", "tasks", "approvals", "deliverables", "model_calls", "research_runs", "costs", "commercial_results", "agent_runs"]) {
      run(
        db,
        `UPDATE ${table} SET venture_id = COALESCE(venture_id, (SELECT venture_id FROM workflows WHERE workflows.id = ${table}.workflow_id), 'venture-digital-products') WHERE venture_id IS NULL`,
      );
    }
    run(db, "UPDATE messages SET venture_id = COALESCE((SELECT venture_id FROM tasks WHERE tasks.id = messages.task_id), 'venture-digital-products') WHERE venture_id IS NULL");
    recordMigration(db, 2, "foundation-truth-and-commercial-model");
    commitAtomic(db);
  } catch (error) {
    rollbackAtomic(db);
    throw error;
  }
}

function applyPilotEvidenceMigration(db) {
  if (migrationApplied(db, 3)) return;
  beginAtomic(db);
  try {
    addColumn(db, "agent_pilot_fixtures", "fixture_version INTEGER NOT NULL DEFAULT 1");
    addColumn(db, "agent_pilot_fixtures", "baseline_output TEXT NOT NULL DEFAULT '{}'");
    addColumn(db, "agent_pilot_fixtures", "baseline_hash TEXT");
    addColumn(db, "agent_pilot_reviews", "output_hash TEXT");
    addColumn(db, "agent_pilot_reviews", "provider TEXT NOT NULL DEFAULT 'openai-agents-sdk'");
    addColumn(db, "agent_pilot_reviews", "estimated_cost_cents INTEGER NOT NULL DEFAULT 0");
    addColumn(db, "agent_pilot_reviews", "incurred_estimate_cents INTEGER NOT NULL DEFAULT 0");
    addColumn(db, "agent_pilot_reviews", "reconciled_cost_cents INTEGER NOT NULL DEFAULT 0");
    addColumn(db, "agent_pilot_reviews", "trace_id TEXT");
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_pilot_fixtures_status
        ON agent_pilot_fixtures(venture_id, status, captured_at);
      CREATE INDEX IF NOT EXISTS idx_pilot_reviews_capability
        ON agent_pilot_reviews(capability_key, created_at);
    `);
    recordMigration(db, 3, "agents-sdk-pilot-evidence-ledger");
    commitAtomic(db);
  } catch (error) {
    rollbackAtomic(db);
    throw error;
  }
}

function applyVentureOwnershipMigration(db) {
  if (migrationApplied(db, 4)) return;
  beginAtomic(db);
  try {
    addColumn(db, "workflow_runs", "venture_id TEXT");
    addColumn(db, "events", "venture_id TEXT");
    addColumn(db, "monitor_findings", "venture_id TEXT");

    const activeVenture = `COALESCE(
      (SELECT id FROM ventures WHERE is_active = 1 ORDER BY created_at ASC LIMIT 1),
      (SELECT id FROM ventures ORDER BY created_at ASC LIMIT 1)
    )`;
    run(db, `UPDATE workflows SET venture_id = ${activeVenture} WHERE venture_id IS NULL`);

    const workflowOwned = [
      "commands",
      "tasks",
      "approvals",
      "deliverables",
      "model_calls",
      "research_runs",
      "costs",
      "commercial_results",
      "agent_runs",
      "workflow_runs",
      "task_attempts",
      "budget_reservations",
      "commercial_experiments",
      "commercial_briefs",
      "commercial_test_candidates",
      "commercial_execution_packs",
      "venture_scorecards",
    ];
    for (const table of workflowOwned) {
      run(
        db,
        `UPDATE ${table}
         SET venture_id = COALESCE(
           (SELECT venture_id FROM workflows WHERE workflows.id = ${table}.workflow_id),
           ${activeVenture}
         )
         WHERE venture_id IS NULL`,
      );
      db.exec(`
        CREATE TRIGGER IF NOT EXISTS trg_${table}_venture_owner
        AFTER INSERT ON ${table}
        FOR EACH ROW WHEN NEW.venture_id IS NULL
        BEGIN
          UPDATE ${table}
          SET venture_id = COALESCE(
            (SELECT venture_id FROM workflows WHERE workflows.id = NEW.workflow_id),
            ${activeVenture}
          )
          WHERE id = NEW.id;
        END;
      `);
    }

    run(
      db,
      `UPDATE messages
       SET venture_id = COALESCE(
         (SELECT venture_id FROM tasks WHERE tasks.id = messages.task_id),
         ${activeVenture}
       )
       WHERE venture_id IS NULL`,
    );
    db.exec(`
      CREATE TRIGGER IF NOT EXISTS trg_messages_venture_owner
      AFTER INSERT ON messages
      FOR EACH ROW WHEN NEW.venture_id IS NULL
      BEGIN
        UPDATE messages
        SET venture_id = COALESCE(
          (SELECT venture_id FROM tasks WHERE tasks.id = NEW.task_id),
          ${activeVenture}
        )
        WHERE id = NEW.id;
      END;

      CREATE TRIGGER IF NOT EXISTS trg_workflows_venture_owner
      AFTER INSERT ON workflows
      FOR EACH ROW WHEN NEW.venture_id IS NULL
      BEGIN
        UPDATE workflows SET venture_id = ${activeVenture} WHERE id = NEW.id;
      END;

      CREATE TRIGGER IF NOT EXISTS trg_events_venture_owner
      AFTER INSERT ON events
      FOR EACH ROW WHEN NEW.venture_id IS NULL
      BEGIN
        UPDATE events SET venture_id = ${activeVenture} WHERE id = NEW.id;
      END;

      CREATE TRIGGER IF NOT EXISTS trg_monitor_findings_venture_owner
      AFTER INSERT ON monitor_findings
      FOR EACH ROW WHEN NEW.venture_id IS NULL
      BEGIN
        UPDATE monitor_findings SET venture_id = ${activeVenture} WHERE id = NEW.id;
      END;
    `);
    run(db, `UPDATE events SET venture_id = ${activeVenture} WHERE venture_id IS NULL`);
    run(db, `UPDATE monitor_findings SET venture_id = ${activeVenture} WHERE venture_id IS NULL`);

    recordMigration(db, 4, "venture-ownership-backstops");
    commitAtomic(db);
  } catch (error) {
    rollbackAtomic(db);
    throw error;
  }
}

function applyExecutiveDigestMigration(db) {
  if (migrationApplied(db, 5)) return;
  beginAtomic(db);
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS executive_digests (
        id TEXT PRIMARY KEY,
        venture_id TEXT NOT NULL,
        period_start TEXT NOT NULL,
        period_end TEXT NOT NULL,
        status TEXT NOT NULL,
        title TEXT NOT NULL,
        summary TEXT NOT NULL,
        metrics TEXT NOT NULL DEFAULT '{}',
        decisions TEXT NOT NULL DEFAULT '[]',
        learning TEXT NOT NULL DEFAULT '[]',
        next_actions TEXT NOT NULL DEFAULT '[]',
        generated_at TEXT NOT NULL,
        UNIQUE(venture_id, period_start),
        FOREIGN KEY (venture_id) REFERENCES ventures(id)
      );
      CREATE INDEX IF NOT EXISTS idx_executive_digests_recent
        ON executive_digests(venture_id, period_end DESC);
    `);
    recordMigration(db, 5, "weekly-executive-digest");
    commitAtomic(db);
  } catch (error) {
    rollbackAtomic(db);
    throw error;
  }
}

function applyLegacyDemoSanitizationMigration(db) {
  if (migrationApplied(db, 6)) return;
  beginAtomic(db);
  try {
    const ts = now();
    db.exec(`
      CREATE TEMP TABLE migration6_stale_approvals (
        id TEXT PRIMARY KEY,
        workflow_id TEXT
      );
    `);
    run(
      db,
      `INSERT INTO migration6_stale_approvals (id, workflow_id)
       SELECT approvals.id, approvals.workflow_id
       FROM approvals
       WHERE approvals.scope IN ('live_ai_worker_spend', 'live_research_spend')
         AND approvals.status IN ('pending', 'approved')
         AND NOT EXISTS (
           SELECT 1 FROM model_calls
           WHERE model_calls.workflow_id = approvals.workflow_id
             AND model_calls.mode = 'live'
             AND model_calls.status IN ('completed', 'succeeded')
         )
         AND NOT EXISTS (
           SELECT 1 FROM research_runs
           WHERE research_runs.workflow_id = approvals.workflow_id
             AND research_runs.mode = 'live'
             AND research_runs.status IN ('completed', 'succeeded')
         )
         AND NOT EXISTS (
           SELECT 1 FROM costs
           WHERE costs.workflow_id = approvals.workflow_id
             AND costs.amount_cents > 0
             AND costs.status IN ('incurred', 'incurred_estimate', 'reconciled', 'paid')
         )`,
    );

    run(
      db,
      `UPDATE commercial_experiments
       SET status = 'cancelled',
           started_at = NULL,
           ended_at = COALESCE(ended_at, ?),
           metadata = json_set(
             CASE WHEN json_valid(metadata) THEN metadata ELSE '{}' END,
             '$.archivedReason', 'Pre-foundation protected or demo state; no verified real-world start.',
             '$.realStartConfirmed', json('false')
           ),
           updated_at = ?
       WHERE (
         COALESCE(json_extract(CASE WHEN json_valid(metadata) THEN metadata ELSE '{}' END, '$.dryRunOnly'), 0) = 1
         OR (
           status = 'running'
           AND COALESCE(json_extract(CASE WHEN json_valid(metadata) THEN metadata ELSE '{}' END, '$.realStartConfirmed'), 0) <> 1
           AND NOT EXISTS (
             SELECT 1 FROM commercial_results
             WHERE commercial_results.experiment_id = commercial_experiments.id
               AND commercial_results.verified = 1
           )
         )
         OR (
           status NOT IN ('candidate', 'ready', 'running', 'completed', 'cancelled')
           AND NOT EXISTS (
             SELECT 1 FROM commercial_results
             WHERE commercial_results.experiment_id = commercial_experiments.id
               AND commercial_results.verified = 1
           )
         )
       )`,
      [ts, ts],
    );

    run(
      db,
      `UPDATE messages
       SET status = 'resolved', resolved_at = COALESCE(resolved_at, ?)
       WHERE status = 'open'
         AND task_id IN (
           SELECT tasks.id FROM tasks
           WHERE tasks.approval_id IN (SELECT id FROM migration6_stale_approvals)
              OR tasks.workflow_id IN (
                SELECT workflow_id FROM migration6_stale_approvals WHERE workflow_id IS NOT NULL
              )
         )`,
      [ts],
    );
    run(
      db,
      `UPDATE tasks
       SET status = 'cancelled', outcome_status = 'cancelled',
           setup_block_reason = NULL, claim_token = NULL, claimed_at = NULL,
           completed_at = COALESCE(completed_at, ?), updated_at = ?
       WHERE status NOT IN ('completed', 'cancelled')
         AND (
           approval_id IN (SELECT id FROM migration6_stale_approvals)
           OR workflow_id IN (
             SELECT workflow_id FROM migration6_stale_approvals WHERE workflow_id IS NOT NULL
           )
         )`,
      [ts, ts],
    );
    run(
      db,
      `UPDATE workflows
       SET status = 'cancelled',
           current_step = 'Archived protected setup work; create a fresh scoped request when intentionally connecting a provider.',
           updated_at = ?
       WHERE status NOT IN ('completed', 'cancelled')
         AND id IN (
           SELECT workflow_id FROM migration6_stale_approvals WHERE workflow_id IS NOT NULL
         )`,
      [ts],
    );
    run(
      db,
      `UPDATE approvals
       SET status = 'superseded', decided_at = COALESCE(decided_at, ?),
           decision_note = 'Superseded by the foundation reset because no live provider outcome or spend was recorded.'
       WHERE id IN (SELECT id FROM migration6_stale_approvals)`,
      [ts],
    );
    db.exec("DROP TABLE migration6_stale_approvals");
    recordMigration(db, 6, "archive-unverified-legacy-demo-state");
    commitAtomic(db);
  } catch (error) {
    rollbackAtomic(db);
    throw error;
  }
}

function applyLegacyReviewQueueMigration(db) {
  if (migrationApplied(db, 7)) return;
  beginAtomic(db);
  try {
    const ts = now();
    const legacyCutoff = "2026-07-14T00:00:00.000Z";
    run(
      db,
      `UPDATE agent_handoffs
       SET status = 'archived', resolved_at = COALESCE(resolved_at, ?),
           metadata = json_set(
             CASE WHEN json_valid(metadata) THEN metadata ELSE '{}' END,
             '$.archivedReason', 'Historical protected rehearsal; retained outside the current decision queue.'
           ),
           updated_at = ?
       WHERE status IN ('needs_operator_decision', 'waiting_for_review', 'waiting_approval')
         AND created_at < ?
         AND (
           workflow_id IN (
             SELECT id FROM workflows
             WHERE status = 'cancelled'
                OR COALESCE(
                  json_extract(CASE WHEN json_valid(metadata) THEN metadata ELSE '{}' END, '$.agentRunner.mode'),
                  ''
                ) IN ('dry-run', 'protected')
           )
           OR json_extract(
             CASE WHEN json_valid(agent_handoffs.metadata) THEN agent_handoffs.metadata ELSE '{}' END,
             '$.experimentId'
           ) IN (SELECT id FROM commercial_experiments WHERE status = 'cancelled')
         )`,
      [ts, ts, legacyCutoff],
    );
    run(
      db,
      `UPDATE deliverables
       SET status = 'archived',
           metadata = json_set(
             CASE WHEN json_valid(metadata) THEN metadata ELSE '{}' END,
             '$.archivedReason', 'Historical protected or fixture output; available from System history.'
           ),
           updated_at = ?
       WHERE status = 'ready_for_review'
         AND created_at < ?
         AND (
           workflow_id IN (
             SELECT id FROM workflows
             WHERE status = 'cancelled'
                OR COALESCE(
                  json_extract(CASE WHEN json_valid(metadata) THEN metadata ELSE '{}' END, '$.agentRunner.mode'),
                  ''
                ) IN ('dry-run', 'protected')
           )
           OR COALESCE(
             json_extract(CASE WHEN json_valid(deliverables.metadata) THEN deliverables.metadata ELSE '{}' END, '$.source'),
             ''
           ) = 'agent_workbench'
           OR COALESCE(
             json_extract(CASE WHEN json_valid(deliverables.metadata) THEN deliverables.metadata ELSE '{}' END, '$.proofMode'),
             ''
           ) LIKE 'dry-run%'
         )`,
      [ts, legacyCutoff],
    );
    recordMigration(db, 7, "archive-legacy-review-queue-clutter");
    commitAtomic(db);
  } catch (error) {
    rollbackAtomic(db);
    throw error;
  }
}

function applyLegacyNotificationCleanupMigration(db) {
  if (migrationApplied(db, 8)) return;
  beginAtomic(db);
  try {
    const ts = now();
    const legacyCutoff = "2026-07-14T00:00:00.000Z";
    run(
      db,
      `UPDATE deliverables
       SET status = 'archived',
           metadata = json_set(
             CASE WHEN json_valid(metadata) THEN metadata ELSE '{}' END,
             '$.archivedReason', 'Historical dry-run proof; available from System history.'
           ),
           updated_at = ?
       WHERE status = 'ready_for_review'
         AND created_at < ?
         AND workflow_id IN (
           SELECT id FROM workflows
           WHERE COALESCE(
             json_extract(CASE WHEN json_valid(metadata) THEN metadata ELSE '{}' END, '$.proofMode'),
             ''
           ) LIKE 'dry-run%'
         )`,
      [ts, legacyCutoff],
    );
    run(
      db,
      `UPDATE messages
       SET status = 'resolved', resolved_at = COALESCE(resolved_at, ?)
       WHERE status = 'open'
         AND created_at < ?
         AND subject LIKE '% workflow planned'
         AND body LIKE '%Live model/tool execution is still locked%'`,
      [ts, legacyCutoff],
    );
    recordMigration(db, 8, "archive-legacy-proof-notifications");
    commitAtomic(db);
  } catch (error) {
    rollbackAtomic(db);
    throw error;
  }
}

function applyHistoricalWorkArchiveMigration(db) {
  if (migrationApplied(db, 9)) return;
  beginAtomic(db);
  try {
    const ts = now();
    const legacyCutoff = "2026-07-14T00:00:00.000Z";
    db.exec(`
      CREATE TEMP TABLE migration9_historical_workflows (
        id TEXT PRIMARY KEY
      );
    `);
    run(
      db,
      `INSERT INTO migration9_historical_workflows (id)
       SELECT workflows.id
       FROM workflows
       WHERE workflows.created_at < ?
         AND workflows.status IN ('cancelled', 'completed', 'dry_run_complete', 'ready_for_review')
         AND NOT EXISTS (
           SELECT 1 FROM commercial_results
           WHERE commercial_results.workflow_id = workflows.id
             AND commercial_results.verified = 1
         )
         AND NOT EXISTS (
           SELECT 1 FROM model_calls
           WHERE model_calls.workflow_id = workflows.id
             AND model_calls.mode = 'live'
             AND model_calls.status IN ('completed', 'succeeded')
         )
         AND NOT EXISTS (
           SELECT 1 FROM research_runs
           WHERE research_runs.workflow_id = workflows.id
             AND research_runs.mode = 'live'
             AND research_runs.status IN ('completed', 'succeeded')
         )`,
      [legacyCutoff],
    );
    run(
      db,
      `UPDATE deliverables
       SET status = 'archived',
           file_path = CASE
             WHEN file_path LIKE 'deliverables/%'
             THEN 'archive/historical/local-artifacts/legacy-generated-deliverables-pre-foundation/'
                  || substr(file_path, length('deliverables/') + 1)
             ELSE file_path
           END,
           metadata = json_set(
             CASE WHEN json_valid(metadata) THEN metadata ELSE '{}' END,
             '$.archivedReason', 'Historical pre-foundation work; retained in System history.'
           ),
           updated_at = ?
       WHERE workflow_id IN (SELECT id FROM migration9_historical_workflows)`,
      [ts],
    );
    run(
      db,
      `UPDATE approvals
       SET status = 'superseded', decided_at = COALESCE(decided_at, ?),
           decision_note = COALESCE(
             NULLIF(decision_note, ''),
             'Historical pre-foundation decision; create a fresh scoped request if work resumes.'
           )
       WHERE status IN ('pending', 'approved')
         AND workflow_id IN (SELECT id FROM migration9_historical_workflows)`,
      [ts],
    );
    run(
      db,
      `UPDATE tasks
       SET status = 'cancelled', outcome_status = 'cancelled',
           claim_token = NULL, claimed_at = NULL,
           completed_at = COALESCE(completed_at, ?), updated_at = ?
       WHERE status NOT IN ('completed', 'cancelled')
         AND workflow_id IN (SELECT id FROM migration9_historical_workflows)`,
      [ts, ts],
    );
    run(
      db,
      `UPDATE messages
       SET status = 'resolved', resolved_at = COALESCE(resolved_at, ?)
       WHERE status = 'open'
         AND task_id IN (
           SELECT id FROM tasks
           WHERE workflow_id IN (SELECT id FROM migration9_historical_workflows)
         )`,
      [ts],
    );
    run(
      db,
      `UPDATE workflows
       SET status = 'archived',
           current_step = 'Historical pre-foundation work; retained in System history.',
           updated_at = ?
       WHERE id IN (SELECT id FROM migration9_historical_workflows)`,
      [ts],
    );
    db.exec("DROP TABLE migration9_historical_workflows");
    recordMigration(db, 9, "archive-historical-work-and-output-paths");
    commitAtomic(db);
  } catch (error) {
    rollbackAtomic(db);
    throw error;
  }
}

function applyAccountingLedgerMigration(db) {
  if (migrationApplied(db, 10)) return;
  beginAtomic(db);
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS accounting_entries (
        id TEXT PRIMARY KEY,
        venture_id TEXT,
        entry_type TEXT NOT NULL,
        category TEXT NOT NULL,
        source TEXT NOT NULL,
        description TEXT NOT NULL,
        status TEXT NOT NULL,
        amount_cents INTEGER NOT NULL CHECK(amount_cents >= 0),
        currency TEXT NOT NULL DEFAULT 'AUD' CHECK(currency = 'AUD'),
        occurred_at TEXT NOT NULL,
        next_due_at TEXT,
        metadata TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (venture_id) REFERENCES ventures(id)
      );

      CREATE INDEX IF NOT EXISTS idx_accounting_entries_occurred
        ON accounting_entries(occurred_at DESC);
      CREATE INDEX IF NOT EXISTS idx_accounting_entries_type_status
        ON accounting_entries(entry_type, status);
    `);
    recordMigration(db, 10, "aud-accounting-ledger");
    commitAtomic(db);
  } catch (error) {
    rollbackAtomic(db);
    throw error;
  }
}

function applyCommercialDataTruthMigration(db) {
  if (migrationApplied(db, 11)) return;
  beginAtomic(db);
  try {
    addColumn(db, "costs", "run_id TEXT");
    addColumn(db, "costs", "task_id TEXT");
    addColumn(db, "costs", "model_call_id TEXT");
    addColumn(db, "commercial_results", "currency TEXT NOT NULL DEFAULT 'AUD' CHECK(currency = 'AUD')");
    addColumn(db, "commercial_results", "verified_at TEXT");
    addColumn(db, "commercial_results", "verification_evidence_id TEXT");
    addColumn(db, "commercial_feedback", "venture_id TEXT");
    addColumn(db, "commercial_feedback", "verified INTEGER NOT NULL DEFAULT 0");
    addColumn(db, "commercial_feedback", "verified_at TEXT");
    addColumn(db, "commercial_feedback", "verification_evidence_id TEXT");
    addColumn(db, "platform_sales", "aud_gross_cents INTEGER");
    addColumn(db, "platform_sales", "aud_platform_fee_cents INTEGER");
    addColumn(db, "platform_sales", "aud_net_cents INTEGER");
    addColumn(db, "platform_sales", "aud_refunded_cents INTEGER");
    addColumn(db, "platform_sales", "aud_conversion_rate REAL");
    addColumn(db, "platform_sales", "aud_conversion_evidence TEXT");
    addColumn(db, "platform_sales", "aud_conversion_at TEXT");
    addColumn(db, "accounting_entries", "effect_sign INTEGER NOT NULL DEFAULT 1 CHECK(effect_sign IN (-1, 1))");
    addColumn(db, "accounting_entries", "supersedes_entry_id TEXT");
    addColumn(db, "accounting_entries", "reverses_entry_id TEXT");
    addColumn(db, "accounting_entries", "revision_reason TEXT");

    run(
      db,
      `UPDATE platform_sales
       SET aud_gross_cents = gross_cents,
           aud_platform_fee_cents = platform_fee_cents,
           aud_net_cents = net_cents,
           aud_refunded_cents = refunded_cents,
           aud_conversion_rate = 1,
           aud_conversion_evidence = 'Native AUD platform export',
           aud_conversion_at = imported_at
       WHERE currency = 'AUD' AND aud_gross_cents IS NULL`,
    );
    run(
      db,
      `UPDATE commercial_feedback
       SET venture_id = COALESCE(
         (SELECT venture_id FROM commercial_experiments WHERE commercial_experiments.id = commercial_feedback.experiment_id),
         (SELECT venture_id FROM workflows WHERE workflows.id = commercial_feedback.workflow_id),
         (SELECT id FROM ventures WHERE is_active = 1 ORDER BY created_at ASC LIMIT 1)
       )
       WHERE venture_id IS NULL`,
    );
    run(
      db,
      `UPDATE costs
       SET model_call_id = COALESCE(
         CASE WHEN json_valid(metadata) THEN json_extract(metadata, '$.modelCallId') END,
         (SELECT model_calls.id
          FROM model_calls
          WHERE model_calls.workflow_id = costs.workflow_id
            AND (model_calls.reconciled_cost_cents = costs.amount_cents
              OR model_calls.actual_cost_cents = costs.amount_cents)
          ORDER BY model_calls.created_at DESC
          LIMIT 1)
       )
       WHERE model_call_id IS NULL`,
    );
    run(
      db,
      `UPDATE costs
       SET task_id = COALESCE(
         (SELECT task_id FROM model_calls WHERE model_calls.id = costs.model_call_id),
         (SELECT task_id FROM budget_reservations
          WHERE budget_reservations.workflow_id = costs.workflow_id
          ORDER BY reserved_at DESC LIMIT 1)
       )
       WHERE task_id IS NULL`,
    );
    run(
      db,
      `UPDATE costs
       SET run_id = (SELECT agent_runs.id FROM agent_runs
                     WHERE agent_runs.model_call_id = costs.model_call_id
                        OR (agent_runs.task_id = costs.task_id AND costs.model_call_id IS NULL)
                     ORDER BY agent_runs.started_at DESC LIMIT 1)
       WHERE run_id IS NULL`,
    );

    db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_ventures_one_active
        ON ventures(is_active) WHERE is_active = 1;
      CREATE INDEX IF NOT EXISTS idx_costs_run ON costs(run_id);
      CREATE INDEX IF NOT EXISTS idx_costs_task ON costs(task_id);
      CREATE INDEX IF NOT EXISTS idx_costs_model_call ON costs(model_call_id);
      CREATE INDEX IF NOT EXISTS idx_commercial_results_verified
        ON commercial_results(venture_id, verified, occurred_at DESC);
      CREATE INDEX IF NOT EXISTS idx_commercial_feedback_verified
        ON commercial_feedback(venture_id, verified, occurred_at DESC);
      CREATE INDEX IF NOT EXISTS idx_platform_sales_aud
        ON platform_sales(venture_id, aud_conversion_at, sold_at DESC);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_accounting_supersedes
        ON accounting_entries(supersedes_entry_id) WHERE supersedes_entry_id IS NOT NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS idx_accounting_reverses
        ON accounting_entries(reverses_entry_id) WHERE reverses_entry_id IS NOT NULL;

      CREATE TABLE IF NOT EXISTS runtime_resets (
        reset_id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        source_database_sha256 TEXT NOT NULL,
        backup_reference TEXT NOT NULL,
        manifest_sha256 TEXT NOT NULL,
        manifest TEXT NOT NULL,
        created_at TEXT NOT NULL,
        applied_at TEXT
      );

      CREATE TRIGGER IF NOT EXISTS trg_accounting_reconciled_immutable_update
      BEFORE UPDATE ON accounting_entries
      FOR EACH ROW WHEN OLD.status = 'reconciled'
      BEGIN
        SELECT RAISE(ABORT, 'Reconciled accounting entries are immutable; record a reversal or revision.');
      END;

      CREATE TRIGGER IF NOT EXISTS trg_accounting_reconciled_immutable_delete
      BEFORE DELETE ON accounting_entries
      FOR EACH ROW WHEN OLD.status = 'reconciled'
      BEGIN
        SELECT RAISE(ABORT, 'Reconciled accounting entries are immutable; record a reversal or revision.');
      END;
    `);

    recordMigration(db, 11, "commercial-data-truth-and-first-use-reset");
    commitAtomic(db);
  } catch (error) {
    rollbackAtomic(db);
    throw error;
  }
}

function applyAgentOperationsEvidenceMigration(db) {
  if (migrationApplied(db, 12)) return;
  beginAtomic(db);
  try {
    addColumn(db, "task_attempts", "provider_dispatched_at TEXT");
    addColumn(db, "task_attempts", "provider_dispatch_model_call_id TEXT");
    addColumn(db, "agent_eval_results", "evaluator_version TEXT NOT NULL DEFAULT 'local-structural-v1'");
    addColumn(db, "agent_eval_results", "subject_hash TEXT");

    db.exec(`
      CREATE TABLE IF NOT EXISTS agent_run_receipts (
        id TEXT PRIMARY KEY,
        attempt_id TEXT NOT NULL,
        run_id TEXT,
        task_id TEXT NOT NULL,
        sequence INTEGER NOT NULL,
        status TEXT NOT NULL,
        outcome_status TEXT NOT NULL,
        snapshot_hash TEXT NOT NULL,
        previous_hash TEXT,
        receipt_hash TEXT NOT NULL UNIQUE,
        missing_fields TEXT NOT NULL DEFAULT '[]',
        warnings TEXT NOT NULL DEFAULT '[]',
        receipt TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(attempt_id, snapshot_hash),
        UNIQUE(attempt_id, sequence),
        FOREIGN KEY (attempt_id) REFERENCES task_attempts(id),
        FOREIGN KEY (run_id) REFERENCES agent_runs(id),
        FOREIGN KEY (task_id) REFERENCES tasks(id)
      );

      CREATE TABLE IF NOT EXISTS agent_run_provenance (
        id TEXT PRIMARY KEY,
        fingerprint TEXT NOT NULL UNIQUE,
        run_id TEXT NOT NULL,
        attempt_id TEXT,
        task_id TEXT NOT NULL,
        model_call_id TEXT,
        tool_invocation_id TEXT,
        research_run_id TEXT,
        research_source_id TEXT,
        kind TEXT NOT NULL,
        provider_external_id TEXT,
        title TEXT,
        url TEXT,
        grounding_type TEXT NOT NULL,
        input_hash TEXT,
        output_hash TEXT,
        metadata TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        FOREIGN KEY (run_id) REFERENCES agent_runs(id),
        FOREIGN KEY (attempt_id) REFERENCES task_attempts(id),
        FOREIGN KEY (task_id) REFERENCES tasks(id),
        FOREIGN KEY (model_call_id) REFERENCES model_calls(id),
        FOREIGN KEY (tool_invocation_id) REFERENCES agent_tool_invocations(id),
        FOREIGN KEY (research_run_id) REFERENCES research_runs(id),
        FOREIGN KEY (research_source_id) REFERENCES research_sources(id)
      );

      CREATE INDEX IF NOT EXISTS idx_agent_run_receipts_run
        ON agent_run_receipts(run_id, sequence DESC);
      CREATE INDEX IF NOT EXISTS idx_agent_run_receipts_status
        ON agent_run_receipts(status, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_agent_run_provenance_run
        ON agent_run_provenance(run_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_agent_run_provenance_source
        ON agent_run_provenance(research_source_id);

      CREATE TRIGGER IF NOT EXISTS trg_agent_run_receipts_immutable_update
      BEFORE UPDATE ON agent_run_receipts
      BEGIN
        SELECT RAISE(ABORT, 'Agent run receipts are immutable; append a new receipt.');
      END;

      CREATE TRIGGER IF NOT EXISTS trg_agent_run_receipts_immutable_delete
      BEFORE DELETE ON agent_run_receipts
      BEGIN
        SELECT RAISE(ABORT, 'Agent run receipts are immutable; append a new receipt.');
      END;

      CREATE TRIGGER IF NOT EXISTS trg_agent_run_provenance_immutable_update
      BEFORE UPDATE ON agent_run_provenance
      BEGIN
        SELECT RAISE(ABORT, 'Agent run provenance is immutable.');
      END;

      CREATE TRIGGER IF NOT EXISTS trg_agent_run_provenance_immutable_delete
      BEFORE DELETE ON agent_run_provenance
      BEGIN
        SELECT RAISE(ABORT, 'Agent run provenance is immutable.');
      END;
    `);

    recordMigration(db, 12, "agent-operations-evidence-and-receipts");
    commitAtomic(db);
  } catch (error) {
    rollbackAtomic(db);
    throw error;
  }
}

function applyAgentContextMigration(db) {
  if (migrationApplied(db, 13)) return;
  beginAtomic(db);
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS venture_records (
        id TEXT PRIMARY KEY,
        venture_id TEXT NOT NULL,
        record_class TEXT NOT NULL,
        record_type TEXT NOT NULL,
        title TEXT NOT NULL,
        summary TEXT NOT NULL DEFAULT '',
        content TEXT NOT NULL DEFAULT '{}',
        sensitivity TEXT NOT NULL DEFAULT 'business_internal',
        provider_policy TEXT NOT NULL DEFAULT 'summary_only',
        source_kind TEXT NOT NULL DEFAULT 'operator_record',
        source_reference TEXT,
        content_hash TEXT NOT NULL,
        effective_at TEXT,
        expires_at TEXT,
        supersedes_record_id TEXT,
        metadata TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        FOREIGN KEY (venture_id) REFERENCES ventures(id),
        FOREIGN KEY (supersedes_record_id) REFERENCES venture_records(id),
        CHECK (record_class IN ('venture', 'evidence', 'finance', 'production', 'customer', 'legal', 'operations', 'learning')),
        CHECK (sensitivity IN ('public', 'business_internal', 'confidential', 'personal', 'restricted')),
        CHECK (provider_policy IN ('full', 'summary_only', 'local_only'))
      );

      CREATE TABLE IF NOT EXISTS agent_context_snapshots (
        id TEXT PRIMARY KEY,
        venture_id TEXT NOT NULL,
        workflow_id TEXT,
        task_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        policy_version TEXT NOT NULL,
        access_profile TEXT NOT NULL,
        record_classes TEXT NOT NULL,
        record_count INTEGER NOT NULL DEFAULT 0,
        snapshot_hash TEXT NOT NULL UNIQUE,
        snapshot TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (venture_id) REFERENCES ventures(id),
        FOREIGN KEY (workflow_id) REFERENCES workflows(id),
        FOREIGN KEY (task_id) REFERENCES tasks(id),
        FOREIGN KEY (agent_id) REFERENCES agent_definitions(id)
      );

      CREATE INDEX IF NOT EXISTS idx_venture_records_context
        ON venture_records(venture_id, record_class, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_agent_context_task
        ON agent_context_snapshots(task_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_agent_context_agent
        ON agent_context_snapshots(agent_id, created_at DESC);

      CREATE TRIGGER IF NOT EXISTS trg_venture_records_immutable_update
      BEFORE UPDATE ON venture_records
      BEGIN
        SELECT RAISE(ABORT, 'Venture records are immutable; add a superseding record.');
      END;

      CREATE TRIGGER IF NOT EXISTS trg_venture_records_immutable_delete
      BEFORE DELETE ON venture_records
      BEGIN
        SELECT RAISE(ABORT, 'Venture records are immutable; add a superseding record.');
      END;

      CREATE TRIGGER IF NOT EXISTS trg_agent_context_snapshots_immutable_update
      BEFORE UPDATE ON agent_context_snapshots
      BEGIN
        SELECT RAISE(ABORT, 'Agent context snapshots are immutable; prepare a new assignment.');
      END;

      CREATE TRIGGER IF NOT EXISTS trg_agent_context_snapshots_immutable_delete
      BEFORE DELETE ON agent_context_snapshots
      BEGIN
        SELECT RAISE(ABORT, 'Agent context snapshots are immutable.');
      END;
    `);

    recordMigration(db, 13, "task-scoped-agent-context");
    commitAtomic(db);
  } catch (error) {
    rollbackAtomic(db);
    throw error;
  }
}

function applyDeliverableQualityReviewMigration(db) {
  if (migrationApplied(db, 14)) return;
  beginAtomic(db);
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS deliverable_quality_reviews (
        id TEXT PRIMARY KEY,
        venture_id TEXT NOT NULL,
        workflow_id TEXT NOT NULL,
        deliverable_id TEXT NOT NULL,
        source_run_id TEXT,
        review_task_id TEXT NOT NULL,
        review_run_id TEXT NOT NULL,
        reviewer_agent_id TEXT NOT NULL,
        input_hash TEXT NOT NULL,
        verdict TEXT NOT NULL,
        quality_score INTEGER NOT NULL,
        findings TEXT NOT NULL DEFAULT '[]',
        operator_recommendation TEXT NOT NULL DEFAULT '',
        metadata TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        UNIQUE(deliverable_id, review_run_id),
        FOREIGN KEY (venture_id) REFERENCES ventures(id),
        FOREIGN KEY (workflow_id) REFERENCES workflows(id),
        FOREIGN KEY (deliverable_id) REFERENCES deliverables(id),
        FOREIGN KEY (source_run_id) REFERENCES agent_runs(id),
        FOREIGN KEY (review_task_id) REFERENCES tasks(id),
        FOREIGN KEY (review_run_id) REFERENCES agent_runs(id),
        FOREIGN KEY (reviewer_agent_id) REFERENCES agent_definitions(id),
        CHECK (verdict IN ('passed', 'changes_required', 'blocked'))
      );

      CREATE INDEX IF NOT EXISTS idx_deliverable_quality_current
        ON deliverable_quality_reviews(deliverable_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_deliverable_quality_workflow
        ON deliverable_quality_reviews(workflow_id, created_at DESC);

      CREATE TRIGGER IF NOT EXISTS trg_deliverable_quality_reviews_immutable_update
      BEFORE UPDATE ON deliverable_quality_reviews
      BEGIN
        SELECT RAISE(ABORT, 'Deliverable quality reviews are immutable; run a new review.');
      END;

      CREATE TRIGGER IF NOT EXISTS trg_deliverable_quality_reviews_immutable_delete
      BEFORE DELETE ON deliverable_quality_reviews
      BEGIN
        SELECT RAISE(ABORT, 'Deliverable quality reviews are immutable.');
      END;
    `);

    recordMigration(db, 14, "deliverable-quality-review-gate");
    commitAtomic(db);
  } catch (error) {
    rollbackAtomic(db);
    throw error;
  }
}

function applyDataRetentionPolicyMigration(db) {
  if (migrationApplied(db, 15)) return;
  beginAtomic(db);
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS data_retention_policies (
        id TEXT PRIMARY KEY,
        version INTEGER NOT NULL UNIQUE,
        title TEXT NOT NULL,
        policy TEXT NOT NULL,
        policy_hash TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS retention_tombstones (
        id TEXT PRIMARY KEY,
        policy_id TEXT NOT NULL,
        record_class TEXT NOT NULL,
        record_key_hash TEXT NOT NULL,
        reason TEXT NOT NULL,
        deleted_at TEXT NOT NULL,
        metadata TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        UNIQUE(policy_id, record_class, record_key_hash, deleted_at),
        FOREIGN KEY (policy_id) REFERENCES data_retention_policies(id)
      );

      CREATE INDEX IF NOT EXISTS idx_retention_tombstones_record
        ON retention_tombstones(record_class, record_key_hash, deleted_at DESC);

      CREATE TRIGGER IF NOT EXISTS trg_data_retention_policies_immutable_update
      BEFORE UPDATE ON data_retention_policies
      BEGIN
        SELECT RAISE(ABORT, 'Data-retention policies are immutable; create a new version.');
      END;

      CREATE TRIGGER IF NOT EXISTS trg_data_retention_policies_immutable_delete
      BEFORE DELETE ON data_retention_policies
      BEGIN
        SELECT RAISE(ABORT, 'Data-retention policies are immutable.');
      END;

      CREATE TRIGGER IF NOT EXISTS trg_retention_tombstones_immutable_update
      BEFORE UPDATE ON retention_tombstones
      BEGIN
        SELECT RAISE(ABORT, 'Retention deletion markers are immutable.');
      END;

      CREATE TRIGGER IF NOT EXISTS trg_retention_tombstones_immutable_delete
      BEFORE DELETE ON retention_tombstones
      BEGIN
        SELECT RAISE(ABORT, 'Retention deletion markers are immutable.');
      END;
    `);

    recordMigration(db, 15, "data-retention-policy-and-deletion-markers");
    commitAtomic(db);
  } catch (error) {
    rollbackAtomic(db);
    throw error;
  }
}

function applyExecutionEvidenceBindingMigration(db) {
  if (migrationApplied(db, 16)) return;
  beginAtomic(db);
  try {
    addColumn(db, "task_attempts", "agent_run_id TEXT REFERENCES agent_runs(id)");
    addColumn(db, "task_attempts", "model_call_id TEXT REFERENCES model_calls(id)");
    addColumn(db, "task_attempts", "evidence_binding_status TEXT NOT NULL DEFAULT 'exact_required'");
    addColumn(db, "model_calls", "attempt_id TEXT REFERENCES task_attempts(id)");
    addColumn(db, "agent_eval_results", "attempt_id TEXT REFERENCES task_attempts(id)");
    addColumn(db, "agent_tool_invocations", "attempt_id TEXT REFERENCES task_attempts(id)");
    addColumn(db, "agent_tool_invocations", "observed_attempt_id TEXT REFERENCES task_attempts(id)");

    // Rows that predate exact bindings may use the narrowly labelled compatibility path.
    run(
      db,
      `UPDATE task_attempts
       SET evidence_binding_status = 'legacy_compatibility',
           metadata = json_set(
             CASE WHEN json_valid(metadata) THEN metadata ELSE '{}' END,
             '$.evidenceBindingMigration',
             json_object(
               'schemaVersion', 16,
               'mode', 'legacy_compatibility',
               'note', 'Created before exact attempt evidence bindings were required.'
             )
           )`,
    );

    // Preserve explicit IDs already written into provider metadata. No timestamp matching is used.
    run(
      db,
      `UPDATE model_calls
       SET attempt_id = json_extract(metadata, '$.taskAttemptId')
       WHERE attempt_id IS NULL
         AND json_valid(metadata)
         AND json_type(metadata, '$.taskAttemptId') = 'text'
         AND EXISTS (
           SELECT 1 FROM task_attempts
           WHERE task_attempts.id = json_extract(model_calls.metadata, '$.taskAttemptId')
             AND task_attempts.task_id = model_calls.task_id
         )`,
    );
    run(
      db,
      `UPDATE model_calls
       SET attempt_id = (
         SELECT attempts.id FROM task_attempts AS attempts
         WHERE attempts.provider_dispatch_model_call_id = model_calls.id
           AND attempts.task_id = model_calls.task_id
         LIMIT 1
       )
       WHERE attempt_id IS NULL
         AND 1 = (
           SELECT COUNT(*) FROM task_attempts AS attempts
           WHERE attempts.provider_dispatch_model_call_id = model_calls.id
             AND attempts.task_id = model_calls.task_id
         )`,
    );
    run(
      db,
      `UPDATE task_attempts
       SET model_call_id = COALESCE(
         CASE WHEN EXISTS (
           SELECT 1 FROM model_calls
           WHERE model_calls.id = task_attempts.provider_dispatch_model_call_id
             AND model_calls.task_id = task_attempts.task_id
         ) THEN provider_dispatch_model_call_id END,
         (
           SELECT model_calls.id FROM model_calls
           WHERE model_calls.attempt_id = task_attempts.id
             AND model_calls.task_id = task_attempts.task_id
           ORDER BY model_calls.created_at DESC, model_calls.id DESC
           LIMIT 1
         )
       )
       WHERE model_call_id IS NULL`,
    );
    run(
      db,
      `UPDATE task_attempts
       SET agent_run_id = (
         SELECT json_extract(model_calls.metadata, '$.agentRunId')
         FROM model_calls
         JOIN agent_runs
           ON agent_runs.id = json_extract(model_calls.metadata, '$.agentRunId')
          AND agent_runs.task_id = task_attempts.task_id
         WHERE model_calls.attempt_id = task_attempts.id
           AND json_valid(model_calls.metadata)
           AND json_type(model_calls.metadata, '$.agentRunId') = 'text'
         ORDER BY model_calls.created_at DESC, model_calls.id DESC
         LIMIT 1
       )
       WHERE agent_run_id IS NULL
         AND EXISTS (
           SELECT 1 FROM model_calls
           JOIN agent_runs
             ON agent_runs.id = json_extract(model_calls.metadata, '$.agentRunId')
            AND agent_runs.task_id = task_attempts.task_id
           WHERE model_calls.attempt_id = task_attempts.id
             AND json_valid(model_calls.metadata)
             AND json_type(model_calls.metadata, '$.agentRunId') = 'text'
         )`,
    );
    run(
      db,
      `UPDATE task_attempts
       SET agent_run_id = (
         SELECT agent_runs.id FROM agent_runs
         WHERE agent_runs.model_call_id = task_attempts.model_call_id
           AND agent_runs.task_id = task_attempts.task_id
         LIMIT 1
       )
       WHERE agent_run_id IS NULL
         AND model_call_id IS NOT NULL
         AND 1 = (
           SELECT COUNT(*) FROM agent_runs
           WHERE agent_runs.model_call_id = task_attempts.model_call_id
             AND agent_runs.task_id = task_attempts.task_id
         )`,
    );
    run(
      db,
      `UPDATE agent_eval_results
       SET attempt_id = (
         SELECT attempts.id FROM task_attempts AS attempts
         WHERE attempts.agent_run_id = agent_eval_results.run_id
           AND attempts.task_id = agent_eval_results.task_id
         LIMIT 1
       )
       WHERE attempt_id IS NULL
         AND 1 = (
           SELECT COUNT(*) FROM task_attempts AS attempts
           WHERE attempts.agent_run_id = agent_eval_results.run_id
             AND attempts.task_id = agent_eval_results.task_id
         )`,
    );
    run(
      db,
      `UPDATE agent_tool_invocations
       SET attempt_id = json_extract(metadata, '$.taskAttemptId')
       WHERE attempt_id IS NULL
         AND json_valid(metadata)
         AND json_type(metadata, '$.taskAttemptId') = 'text'
         AND EXISTS (
           SELECT 1 FROM task_attempts
           WHERE task_attempts.id = json_extract(agent_tool_invocations.metadata, '$.taskAttemptId')
             AND task_attempts.task_id = agent_tool_invocations.task_id
         )`,
    );

    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_task_attempts_agent_run
        ON task_attempts(agent_run_id, completed_at DESC);
      CREATE INDEX IF NOT EXISTS idx_task_attempts_model_call
        ON task_attempts(model_call_id);
      CREATE INDEX IF NOT EXISTS idx_model_calls_attempt
        ON model_calls(attempt_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_agent_eval_results_attempt
        ON agent_eval_results(attempt_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_agent_tool_invocations_attempt
        ON agent_tool_invocations(attempt_id, requested_at);
      CREATE INDEX IF NOT EXISTS idx_agent_tool_invocations_observed_attempt
        ON agent_tool_invocations(observed_attempt_id, resolved_at);

      CREATE TRIGGER IF NOT EXISTS trg_task_attempt_agent_run_binding_immutable
      BEFORE UPDATE OF agent_run_id ON task_attempts
      FOR EACH ROW WHEN OLD.agent_run_id IS NOT NULL AND NEW.agent_run_id IS NOT OLD.agent_run_id
      BEGIN
        SELECT RAISE(ABORT, 'An attempt cannot be rebound to a different agent run.');
      END;

      CREATE TRIGGER IF NOT EXISTS trg_task_attempt_model_call_binding_immutable
      BEFORE UPDATE OF model_call_id ON task_attempts
      FOR EACH ROW WHEN OLD.model_call_id IS NOT NULL AND NEW.model_call_id IS NOT OLD.model_call_id
      BEGIN
        SELECT RAISE(ABORT, 'An attempt cannot be rebound to a different model call.');
      END;

      CREATE TRIGGER IF NOT EXISTS trg_model_call_attempt_binding_immutable
      BEFORE UPDATE OF attempt_id ON model_calls
      FOR EACH ROW WHEN OLD.attempt_id IS NOT NULL AND NEW.attempt_id IS NOT OLD.attempt_id
      BEGIN
        SELECT RAISE(ABORT, 'A model call cannot be rebound to a different attempt.');
      END;

      CREATE TRIGGER IF NOT EXISTS trg_agent_eval_attempt_binding_immutable
      BEFORE UPDATE OF attempt_id ON agent_eval_results
      FOR EACH ROW WHEN OLD.attempt_id IS NOT NULL AND NEW.attempt_id IS NOT OLD.attempt_id
      BEGIN
        SELECT RAISE(ABORT, 'An evaluation cannot be rebound to a different attempt.');
      END;

      CREATE TRIGGER IF NOT EXISTS trg_agent_tool_attempt_binding_immutable
      BEFORE UPDATE OF attempt_id ON agent_tool_invocations
      FOR EACH ROW WHEN OLD.attempt_id IS NOT NULL AND NEW.attempt_id IS NOT OLD.attempt_id
      BEGIN
        SELECT RAISE(ABORT, 'A tool request cannot be rebound to a different attempt.');
      END;

      CREATE TRIGGER IF NOT EXISTS trg_agent_tool_observation_binding_immutable
      BEFORE UPDATE OF observed_attempt_id ON agent_tool_invocations
      FOR EACH ROW WHEN OLD.observed_attempt_id IS NOT NULL AND NEW.observed_attempt_id IS NOT OLD.observed_attempt_id
      BEGIN
        SELECT RAISE(ABORT, 'A provider tool observation cannot be rebound to a different attempt.');
      END;
    `);

    recordMigration(db, 16, "exact-agent-execution-evidence-bindings");
    commitAtomic(db);
  } catch (error) {
    rollbackAtomic(db);
    throw error;
  }
}

function applyProviderAttemptReceiptBackfillMigration(db) {
  if (migrationApplied(db, 17)) return;
  beginAtomic(db);
  try {
    run(
      db,
      `UPDATE task_attempts
       SET provider_request_id = (
         SELECT model_calls.provider_request_id
         FROM model_calls
         WHERE model_calls.id = task_attempts.model_call_id
           AND model_calls.task_id = task_attempts.task_id
       ),
       metadata = json_set(
         CASE WHEN json_valid(metadata) THEN metadata ELSE '{}' END,
         '$.providerRequestIdBackfill',
         json_object(
           'schemaVersion', 17,
           'source', 'exact_model_call_binding'
         )
       )
       WHERE provider_request_id IS NULL
         AND model_call_id IS NOT NULL
         AND EXISTS (
           SELECT 1
           FROM model_calls
           WHERE model_calls.id = task_attempts.model_call_id
             AND model_calls.task_id = task_attempts.task_id
             AND model_calls.provider_request_id IS NOT NULL
         )`,
    );
    recordMigration(db, 17, "provider-request-attempt-receipt-backfill");
    commitAtomic(db);
  } catch (error) {
    rollbackAtomic(db);
    throw error;
  }
}

function applyStableSpendCostIdMigration(db) {
  if (migrationApplied(db, 18)) return;
  beginAtomic(db);
  try {
    const costs = all(
      db,
      `SELECT id, task_id, metadata
       FROM costs
       WHERE task_id IS NOT NULL
         AND category IN ('live_ai_worker', 'live_research')`,
    );
    for (const cost of costs) {
      const stableId = spendCostId(cost.task_id);
      if (cost.id === stableId) continue;
      const conflict = get(db, "SELECT id FROM costs WHERE id = ?", [stableId]);
      if (conflict) {
        run(
          db,
          "UPDATE costs SET metadata = ? WHERE id = ?",
          [
            toJson({
              ...fromJson(cost.metadata, {}),
              stableIdMigrationConflict: {
                targetId: stableId,
                schemaVersion: 18,
                requiresReview: true,
              },
            }),
            cost.id,
          ],
        );
        continue;
      }
      run(
        db,
        "UPDATE costs SET id = ?, metadata = ? WHERE id = ?",
        [
          stableId,
          toJson({
            ...fromJson(cost.metadata, {}),
            stableIdMigration: {
              previousId: cost.id,
              schemaVersion: 18,
            },
          }),
          cost.id,
        ],
      );
    }
    recordMigration(db, 18, "stable-spend-cost-identifiers");
    commitAtomic(db);
  } catch (error) {
    rollbackAtomic(db);
    throw error;
  }
}

function applyPantheonCommercialOperatingModelMigration(db) {
  if (migrationApplied(db, 19)) return;
  beginAtomic(db);
  try {
    addColumn(db, "commercial_results", "refund_amount_cents INTEGER NOT NULL DEFAULT 0");
    addColumn(db, "commercial_results", "fulfilment_cost_cents INTEGER NOT NULL DEFAULT 0");
    addColumn(db, "commercial_results", "attributed_ai_cost_cents INTEGER NOT NULL DEFAULT 0");
    addColumn(db, "commercial_results", "other_cost_cents INTEGER NOT NULL DEFAULT 0");

    addColumn(db, "commercial_evidence", "claim TEXT NOT NULL DEFAULT ''");
    addColumn(db, "commercial_evidence", "metric TEXT NOT NULL DEFAULT ''");
    addColumn(db, "commercial_evidence", "measured_value REAL");
    addColumn(db, "commercial_evidence", "measured_unit TEXT NOT NULL DEFAULT ''");
    addColumn(db, "commercial_evidence", "market TEXT NOT NULL DEFAULT ''");
    addColumn(db, "commercial_evidence", "geography TEXT NOT NULL DEFAULT ''");
    addColumn(db, "commercial_evidence", "observed_at TEXT");
    addColumn(db, "commercial_evidence", "sample_size INTEGER");
    addColumn(db, "commercial_evidence", "publisher TEXT NOT NULL DEFAULT ''");
    addColumn(db, "commercial_evidence", "extraction_method TEXT NOT NULL DEFAULT ''");
    addColumn(db, "commercial_evidence", "confidence TEXT NOT NULL DEFAULT 'unknown'");

    db.exec(`
      CREATE TABLE IF NOT EXISTS opportunity_rounds (
        id TEXT PRIMARY KEY,
        venture_id TEXT,
        status TEXT NOT NULL,
        mode TEXT NOT NULL,
        prompt TEXT NOT NULL,
        geography TEXT NOT NULL DEFAULT 'global',
        language TEXT NOT NULL DEFAULT 'English',
        max_candidates INTEGER NOT NULL DEFAULT 5,
        started_at TEXT,
        completed_at TEXT,
        created_by TEXT NOT NULL DEFAULT 'pantheon',
        metadata TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (venture_id) REFERENCES ventures(id)
      );

      CREATE TABLE IF NOT EXISTS opportunities (
        id TEXT PRIMARY KEY,
        round_id TEXT,
        venture_id TEXT,
        source_type TEXT NOT NULL,
        status TEXT NOT NULL,
        title TEXT NOT NULL,
        business_model TEXT NOT NULL,
        buyer TEXT NOT NULL DEFAULT '',
        problem TEXT NOT NULL DEFAULT '',
        offer_direction TEXT NOT NULL DEFAULT '',
        geography TEXT NOT NULL DEFAULT 'global',
        language TEXT NOT NULL DEFAULT 'English',
        channel TEXT NOT NULL DEFAULT '',
        demand_score INTEGER NOT NULL DEFAULT 0,
        supply_gap_score INTEGER NOT NULL DEFAULT 0,
        economics_score INTEGER NOT NULL DEFAULT 0,
        channel_fit_score INTEGER NOT NULL DEFAULT 0,
        execution_fit_score INTEGER NOT NULL DEFAULT 0,
        risk_score INTEGER NOT NULL DEFAULT 0,
        overall_score INTEGER NOT NULL DEFAULT 0,
        confidence TEXT NOT NULL DEFAULT 'low',
        recommendation TEXT NOT NULL DEFAULT '',
        smallest_validation TEXT NOT NULL DEFAULT '',
        evidence_ids TEXT NOT NULL DEFAULT '[]',
        metadata TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (round_id) REFERENCES opportunity_rounds(id),
        FOREIGN KEY (venture_id) REFERENCES ventures(id)
      );

      CREATE TABLE IF NOT EXISTS catalogue_plans (
        id TEXT PRIMARY KEY,
        venture_id TEXT NOT NULL,
        opportunity_id TEXT,
        status TEXT NOT NULL,
        title TEXT NOT NULL,
        rationale TEXT NOT NULL DEFAULT '',
        target_item_count INTEGER NOT NULL DEFAULT 1,
        target_variant_count INTEGER NOT NULL DEFAULT 0,
        audience_segments TEXT NOT NULL DEFAULT '[]',
        channels TEXT NOT NULL DEFAULT '[]',
        geographies TEXT NOT NULL DEFAULT '[]',
        languages TEXT NOT NULL DEFAULT '["English"]',
        price_floor_cents INTEGER NOT NULL DEFAULT 0,
        price_ceiling_cents INTEGER NOT NULL DEFAULT 0,
        estimated_build_cost_cents INTEGER NOT NULL DEFAULT 0,
        estimated_unit_cost_cents INTEGER NOT NULL DEFAULT 0,
        metadata TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (venture_id) REFERENCES ventures(id),
        FOREIGN KEY (opportunity_id) REFERENCES opportunities(id)
      );

      CREATE TABLE IF NOT EXISTS catalogue_items (
        id TEXT PRIMARY KEY,
        plan_id TEXT NOT NULL,
        venture_id TEXT NOT NULL,
        parent_item_id TEXT,
        status TEXT NOT NULL,
        quality_status TEXT NOT NULL DEFAULT 'not_reviewed',
        title TEXT NOT NULL,
        product_type TEXT NOT NULL,
        audience TEXT NOT NULL DEFAULT '',
        geography TEXT NOT NULL DEFAULT 'global',
        language TEXT NOT NULL DEFAULT 'English',
        offer TEXT NOT NULL DEFAULT '',
        price_cents INTEGER NOT NULL DEFAULT 0,
        deliverable_id TEXT,
        metadata TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (plan_id) REFERENCES catalogue_plans(id),
        FOREIGN KEY (venture_id) REFERENCES ventures(id),
        FOREIGN KEY (parent_item_id) REFERENCES catalogue_items(id),
        FOREIGN KEY (deliverable_id) REFERENCES deliverables(id)
      );

      CREATE TABLE IF NOT EXISTS commercial_diagnoses (
        id TEXT PRIMARY KEY,
        venture_id TEXT NOT NULL,
        experiment_id TEXT NOT NULL,
        result_id TEXT,
        status TEXT NOT NULL,
        primary_constraint TEXT NOT NULL,
        dimensions TEXT NOT NULL DEFAULT '{}',
        evidence_needed TEXT NOT NULL DEFAULT '[]',
        recommended_test TEXT NOT NULL DEFAULT '',
        decision TEXT NOT NULL DEFAULT '',
        metadata TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (venture_id) REFERENCES ventures(id),
        FOREIGN KEY (experiment_id) REFERENCES commercial_experiments(id),
        FOREIGN KEY (result_id) REFERENCES commercial_results(id)
      );

      CREATE TABLE IF NOT EXISTS operating_mandates (
        id TEXT PRIMARY KEY,
        period_start TEXT NOT NULL,
        period_end TEXT NOT NULL,
        currency TEXT NOT NULL DEFAULT 'AUD' CHECK(currency = 'AUD'),
        budget_cap_cents INTEGER NOT NULL,
        reinvestment_rate REAL NOT NULL DEFAULT 0.30,
        status TEXT NOT NULL,
        allowed_internal_actions TEXT NOT NULL DEFAULT '[]',
        protected_actions TEXT NOT NULL DEFAULT '[]',
        metadata TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS supervisor_cycles (
        id TEXT PRIMARY KEY,
        venture_id TEXT,
        workflow_id TEXT,
        trigger_type TEXT NOT NULL,
        trigger_id TEXT,
        status TEXT NOT NULL,
        decision_type TEXT,
        next_action_type TEXT,
        worker_id TEXT,
        task_id TEXT,
        approval_id TEXT,
        summary TEXT NOT NULL DEFAULT '',
        error TEXT,
        started_at TEXT,
        completed_at TEXT,
        metadata TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (venture_id) REFERENCES ventures(id),
        FOREIGN KEY (workflow_id) REFERENCES workflows(id),
        FOREIGN KEY (task_id) REFERENCES tasks(id),
        FOREIGN KEY (approval_id) REFERENCES approvals(id)
      );

      CREATE INDEX IF NOT EXISTS idx_opportunity_rounds_status
        ON opportunity_rounds(status, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_opportunities_rank
        ON opportunities(status, overall_score DESC, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_catalogue_items_plan
        ON catalogue_items(plan_id, status, created_at);
      CREATE INDEX IF NOT EXISTS idx_commercial_diagnoses_status
        ON commercial_diagnoses(venture_id, status, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_operating_mandates_period
        ON operating_mandates(status, period_start, period_end);
      CREATE INDEX IF NOT EXISTS idx_supervisor_cycles_status
        ON supervisor_cycles(status, created_at DESC);
    `);

    const workflowOwnedTables = [
      "commands",
      "tasks",
      "approvals",
      "deliverables",
      "model_calls",
      "research_runs",
      "costs",
      "commercial_results",
      "agent_runs",
      "workflow_runs",
      "task_attempts",
      "budget_reservations",
      "commercial_experiments",
      "commercial_briefs",
      "commercial_test_candidates",
      "commercial_execution_packs",
      "venture_scorecards",
    ];
    for (const tableName of workflowOwnedTables) {
      db.exec(`
        CREATE TRIGGER IF NOT EXISTS trg_${tableName}_venture_match_insert
        BEFORE INSERT ON ${tableName}
        FOR EACH ROW
        WHEN NEW.workflow_id IS NOT NULL
          AND NEW.venture_id IS NOT NULL
          AND NEW.venture_id <> (SELECT venture_id FROM workflows WHERE id = NEW.workflow_id)
        BEGIN
          SELECT RAISE(ABORT, 'Venture ownership does not match the workflow.');
        END;

        CREATE TRIGGER IF NOT EXISTS trg_${tableName}_venture_match_update
        BEFORE UPDATE OF workflow_id, venture_id ON ${tableName}
        FOR EACH ROW
        WHEN NEW.workflow_id IS NOT NULL
          AND NEW.venture_id IS NOT NULL
          AND NEW.venture_id <> (SELECT venture_id FROM workflows WHERE id = NEW.workflow_id)
        BEGIN
          SELECT RAISE(ABORT, 'Venture ownership does not match the workflow.');
        END;
      `);
    }

    recordMigration(db, 19, "pantheon-commercial-operating-model");
    commitAtomic(db);
  } catch (error) {
    rollbackAtomic(db);
    throw error;
  }
}

function applyRetentionActivationLedgerMigration(db) {
  if (migrationApplied(db, 20)) return;
  beginAtomic(db);
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS data_retention_policy_activations (
        id TEXT PRIMARY KEY,
        policy_id TEXT NOT NULL,
        policy_hash TEXT NOT NULL,
        approval_id TEXT,
        proof_hash TEXT NOT NULL UNIQUE,
        activated_at TEXT NOT NULL,
        activated_by TEXT NOT NULL DEFAULT 'operator',
        metadata TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        UNIQUE(policy_id, policy_hash),
        FOREIGN KEY (policy_id) REFERENCES data_retention_policies(id)
      );

      CREATE INDEX IF NOT EXISTS idx_retention_policy_activations_policy
        ON data_retention_policy_activations(policy_id, activated_at DESC);

      CREATE TRIGGER IF NOT EXISTS trg_retention_policy_activations_immutable_update
      BEFORE UPDATE ON data_retention_policy_activations
      BEGIN
        SELECT RAISE(ABORT, 'Data-retention policy activations are immutable.');
      END;

      CREATE TRIGGER IF NOT EXISTS trg_retention_policy_activations_immutable_delete
      BEFORE DELETE ON data_retention_policy_activations
      BEGIN
        SELECT RAISE(ABORT, 'Data-retention policy activations are immutable.');
      END;
    `);

    const legacyApprovals = all(
      db,
      `SELECT approvals.id AS approval_id, approvals.payload AS approval_payload,
              approvals.decision_note, approvals.decided_at,
              tasks.result AS task_result
       FROM approvals
       JOIN tasks ON tasks.id = approvals.task_id
       WHERE approvals.scope = 'data_retention_policy'
         AND approvals.status = 'approved'
         AND tasks.status = 'completed'
       ORDER BY approvals.decided_at DESC, approvals.requested_at DESC`,
    );
    for (const approval of legacyApprovals) {
      const payload = fromJson(approval.approval_payload, {});
      const result = fromJson(approval.task_result, {});
      if (result.retentionPolicyActivated !== true) continue;
      const policy = get(
        db,
        "SELECT id, policy_hash, version FROM data_retention_policies WHERE id = ? AND policy_hash = ?",
        [payload.policyId, payload.policyHash],
      );
      if (!policy) continue;
      const activatedAt = result.activatedAt || approval.decided_at || now();
      const proof = {
        policyId: policy.id,
        policyHash: policy.policy_hash,
        approvalId: approval.approval_id,
        activatedAt,
        source: "legacy-approved-activation",
      };
      const proofHash = createHash("sha256").update(JSON.stringify(proof)).digest("hex");
      run(
        db,
        `INSERT OR IGNORE INTO data_retention_policy_activations
         (id, policy_id, policy_hash, approval_id, proof_hash, activated_at,
          activated_by, metadata, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'operator', ?, ?)`,
        [
          `retention_activation_${policy.policy_hash.slice(0, 24)}`,
          policy.id,
          policy.policy_hash,
          approval.approval_id,
          proofHash,
          activatedAt,
          toJson({
            source: "schema-20-backfill",
            decisionNote: approval.decision_note || "",
            policyVersion: policy.version,
          }),
          now(),
        ],
      );
    }

    recordMigration(db, 20, "durable-retention-policy-activation-ledger");
    commitAtomic(db);
  } catch (error) {
    rollbackAtomic(db);
    throw error;
  }
}

function applyFullJourneyMigration(db) {
  if (migrationApplied(db, 21)) return;
  beginAtomic(db);
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS pantheon_journeys (
        id TEXT PRIMARY KEY,
        venture_id TEXT NOT NULL,
        mode TEXT NOT NULL CHECK(mode IN ('rehearsal', 'production')),
        status TEXT NOT NULL,
        active_stage TEXT NOT NULL,
        model TEXT NOT NULL,
        model_locked INTEGER NOT NULL DEFAULT 1 CHECK(model_locked IN (0, 1)),
        budget_cap_cents INTEGER NOT NULL CHECK(budget_cap_cents > 0),
        carried_exposure_cents INTEGER NOT NULL DEFAULT 0 CHECK(carried_exposure_cents >= 0),
        round_id TEXT,
        workflow_id TEXT,
        selected_opportunity_id TEXT,
        metadata TEXT NOT NULL DEFAULT '{}',
        started_at TEXT NOT NULL,
        completed_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (venture_id) REFERENCES ventures(id),
        FOREIGN KEY (round_id) REFERENCES opportunity_rounds(id),
        FOREIGN KEY (workflow_id) REFERENCES workflows(id),
        FOREIGN KEY (selected_opportunity_id) REFERENCES opportunities(id)
      );

      CREATE INDEX IF NOT EXISTS idx_pantheon_journeys_status
        ON pantheon_journeys(status, updated_at DESC);

      CREATE INDEX IF NOT EXISTS idx_pantheon_journeys_round
        ON pantheon_journeys(round_id);
    `);
    recordMigration(db, 21, "pantheon-full-commercial-journey");
    commitAtomic(db);
  } catch (error) {
    rollbackAtomic(db);
    throw error;
  }
}

function applyCommercialIntelligenceMigration(db) {
  if (migrationApplied(db, 22)) return;
  beginAtomic(db);
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS commercial_knowledge_sources (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        publisher TEXT NOT NULL,
        url TEXT NOT NULL,
        source_tier INTEGER NOT NULL CHECK(source_tier BETWEEN 1 AND 4),
        source_type TEXT NOT NULL,
        jurisdiction TEXT NOT NULL DEFAULT 'global',
        published_at TEXT,
        reviewed_at TEXT NOT NULL,
        expires_at TEXT,
        methodology TEXT NOT NULL DEFAULT '',
        licence TEXT NOT NULL DEFAULT '',
        metadata TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_commercial_knowledge_sources_url
        ON commercial_knowledge_sources(url);

      CREATE TABLE IF NOT EXISTS commercial_knowledge (
        id TEXT PRIMARY KEY,
        source_id TEXT NOT NULL,
        knowledge_class TEXT NOT NULL
          CHECK(knowledge_class IN ('doctrine', 'market_evidence', 'proven_learning')),
        domain TEXT NOT NULL,
        title TEXT NOT NULL,
        proposition TEXT NOT NULL,
        applicability TEXT NOT NULL,
        limitations TEXT NOT NULL,
        contrary_evidence TEXT NOT NULL DEFAULT '',
        confidence TEXT NOT NULL CHECK(confidence IN ('high', 'medium', 'low')),
        jurisdiction TEXT NOT NULL DEFAULT 'global',
        tags TEXT NOT NULL DEFAULT '[]',
        effective_at TEXT,
        review_date TEXT NOT NULL,
        expires_at TEXT,
        status TEXT NOT NULL DEFAULT 'active'
          CHECK(status IN ('draft', 'active', 'superseded', 'retired')),
        version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0),
        supersedes_id TEXT,
        source_quote_hash TEXT,
        metadata TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (source_id) REFERENCES commercial_knowledge_sources(id),
        FOREIGN KEY (supersedes_id) REFERENCES commercial_knowledge(id)
      );

      CREATE INDEX IF NOT EXISTS idx_commercial_knowledge_class_domain
        ON commercial_knowledge(knowledge_class, domain, status, review_date);

      CREATE VIRTUAL TABLE IF NOT EXISTS commercial_knowledge_fts USING fts5(
        knowledge_id UNINDEXED,
        title,
        proposition,
        applicability,
        limitations,
        tags,
        tokenize = 'porter unicode61'
      );

      CREATE TRIGGER IF NOT EXISTS trg_commercial_knowledge_fts_insert
      AFTER INSERT ON commercial_knowledge BEGIN
        INSERT INTO commercial_knowledge_fts
          (knowledge_id, title, proposition, applicability, limitations, tags)
        VALUES
          (new.id, new.title, new.proposition, new.applicability, new.limitations, new.tags);
      END;

      CREATE TRIGGER IF NOT EXISTS trg_commercial_knowledge_fts_update
      AFTER UPDATE ON commercial_knowledge BEGIN
        DELETE FROM commercial_knowledge_fts WHERE knowledge_id = old.id;
        INSERT INTO commercial_knowledge_fts
          (knowledge_id, title, proposition, applicability, limitations, tags)
        VALUES
          (new.id, new.title, new.proposition, new.applicability, new.limitations, new.tags);
      END;

      CREATE TRIGGER IF NOT EXISTS trg_commercial_knowledge_fts_delete
      AFTER DELETE ON commercial_knowledge BEGIN
        DELETE FROM commercial_knowledge_fts WHERE knowledge_id = old.id;
      END;

      CREATE TABLE IF NOT EXISTS commercial_decision_cases (
        id TEXT PRIMARY KEY,
        opportunity_id TEXT,
        venture_id TEXT,
        round_id TEXT,
        status TEXT NOT NULL
          CHECK(status IN ('draft', 'researching', 'ready_for_review', 'decided', 'parked', 'rejected')),
        stage TEXT NOT NULL,
        recommendation TEXT NOT NULL
          CHECK(recommendation IN ('advance', 'park', 'reject', 'research_more', 'no_investment')),
        model_route TEXT NOT NULL DEFAULT '{}',
        buyer TEXT NOT NULL DEFAULT '',
        problem TEXT NOT NULL DEFAULT '',
        offer TEXT NOT NULL DEFAULT '',
        evidence_summary TEXT NOT NULL DEFAULT '{}',
        economics TEXT NOT NULL DEFAULT '{}',
        channel_strategy TEXT NOT NULL DEFAULT '{}',
        alternatives TEXT NOT NULL DEFAULT '{}',
        criteria TEXT NOT NULL DEFAULT '{}',
        missing_evidence TEXT NOT NULL DEFAULT '[]',
        confidence TEXT NOT NULL DEFAULT 'low'
          CHECK(confidence IN ('high', 'medium', 'low')),
        rationale TEXT NOT NULL DEFAULT '',
        next_action TEXT NOT NULL DEFAULT '',
        decision_hash TEXT NOT NULL,
        reviewed_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (opportunity_id) REFERENCES opportunities(id),
        FOREIGN KEY (venture_id) REFERENCES ventures(id),
        FOREIGN KEY (round_id) REFERENCES opportunity_rounds(id)
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_commercial_decision_case_hash
        ON commercial_decision_cases(decision_hash);

      CREATE INDEX IF NOT EXISTS idx_commercial_decision_case_status
        ON commercial_decision_cases(status, updated_at DESC);

      CREATE TABLE IF NOT EXISTS service_trials (
        id TEXT PRIMARY KEY,
        service_name TEXT NOT NULL,
        vendor TEXT NOT NULL,
        status TEXT NOT NULL
          CHECK(status IN ('proposed', 'approved', 'running', 'completed', 'cancelled', 'retained', 'rejected')),
        hypothesis TEXT NOT NULL,
        baseline TEXT NOT NULL DEFAULT '{}',
        trial_start TEXT,
        trial_end TEXT,
        cap_cents INTEGER NOT NULL CHECK(cap_cents BETWEEN 0 AND 2500),
        actual_cost_cents INTEGER,
        evidence_quality_metrics TEXT NOT NULL DEFAULT '{}',
        retention_thresholds TEXT NOT NULL DEFAULT '{}',
        result TEXT NOT NULL DEFAULT '{}',
        decision TEXT NOT NULL DEFAULT '',
        delegated_vendor_capability INTEGER NOT NULL DEFAULT 0 CHECK(delegated_vendor_capability IN (0, 1)),
        renewal_at TEXT,
        metadata TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS venture_kits (
        id TEXT NOT NULL,
        version INTEGER NOT NULL CHECK(version > 0),
        status TEXT NOT NULL CHECK(status IN ('draft', 'active', 'retired')),
        name TEXT NOT NULL,
        business_models TEXT NOT NULL DEFAULT '[]',
        eligibility_rules TEXT NOT NULL DEFAULT '{}',
        evidence_requirements TEXT NOT NULL DEFAULT '{}',
        capability_requirements TEXT NOT NULL DEFAULT '[]',
        channel_policy TEXT NOT NULL DEFAULT '{}',
        acceptance_criteria TEXT NOT NULL DEFAULT '{}',
        metadata TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (id, version)
      );

      CREATE TABLE IF NOT EXISTS capability_assurance_records (
        id TEXT PRIMARY KEY,
        capability_key TEXT NOT NULL,
        proof_kind TEXT NOT NULL
          CHECK(proof_kind IN ('fixture', 'rehearsal', 'comparison', 'live', 'operational')),
        source_framework TEXT NOT NULL,
        source_record_id TEXT NOT NULL,
        status TEXT NOT NULL,
        input_hash TEXT,
        output_hash TEXT,
        provider TEXT,
        model TEXT,
        trace_id TEXT,
        cost_cents INTEGER,
        verdict TEXT NOT NULL DEFAULT '',
        criteria TEXT NOT NULL DEFAULT '{}',
        metadata TEXT NOT NULL DEFAULT '{}',
        occurred_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(source_framework, source_record_id)
      );

      CREATE INDEX IF NOT EXISTS idx_capability_assurance_capability
        ON capability_assurance_records(capability_key, occurred_at DESC, created_at DESC);
    `);
    recordMigration(db, 22, "commercial-intelligence-foundation");
    commitAtomic(db);
  } catch (error) {
    rollbackAtomic(db);
    throw error;
  }
}

function applyRuntimeStopEvidenceMigration(db) {
  if (migrationApplied(db, 23)) return;
  beginAtomic(db);
  try {
    addColumn(db, "model_calls", "error TEXT");
    addColumn(db, "model_calls", "completed_at TEXT");
    recordMigration(db, 23, "runtime-stop-evidence");
    commitAtomic(db);
  } catch (error) {
    rollbackAtomic(db);
    throw error;
  }
}

function applyModelCallCompletionTruthMigration(db) {
  if (migrationApplied(db, 24)) return;
  beginAtomic(db);
  try {
    db.exec(`
      UPDATE model_calls
      SET completed_at = COALESCE(
        (
          SELECT attempts.completed_at
          FROM task_attempts AS attempts
          WHERE attempts.completed_at IS NOT NULL
            AND attempts.task_id = model_calls.task_id
            AND (
              attempts.model_call_id = model_calls.id
              OR attempts.provider_dispatch_model_call_id = model_calls.id
            )
          ORDER BY attempts.completed_at DESC, attempts.id DESC
          LIMIT 1
        ),
        (
          SELECT runs.completed_at
          FROM agent_runs AS runs
          WHERE runs.completed_at IS NOT NULL
            AND runs.task_id = model_calls.task_id
            AND runs.model_call_id = model_calls.id
          ORDER BY runs.completed_at DESC, runs.id DESC
          LIMIT 1
        ),
        (
          SELECT tasks.completed_at
          FROM tasks
          WHERE tasks.id = model_calls.task_id
            AND tasks.completed_at IS NOT NULL
        )
      )
      WHERE model_calls.completed_at IS NULL
        AND model_calls.status IN (
          'completed', 'succeeded', 'provider_completed', 'waiting_approval',
          'failed', 'needs_attention', 'cancelled', 'abandoned', 'not_called'
        )
        AND (
          EXISTS (
            SELECT 1
            FROM task_attempts AS attempts
            WHERE attempts.completed_at IS NOT NULL
              AND attempts.task_id = model_calls.task_id
              AND (
                attempts.model_call_id = model_calls.id
                OR attempts.provider_dispatch_model_call_id = model_calls.id
              )
          )
          OR EXISTS (
            SELECT 1
            FROM agent_runs AS runs
            WHERE runs.completed_at IS NOT NULL
              AND runs.task_id = model_calls.task_id
              AND runs.model_call_id = model_calls.id
          )
          OR EXISTS (
            SELECT 1
            FROM tasks
            WHERE tasks.id = model_calls.task_id
              AND tasks.completed_at IS NOT NULL
          )
        );
    `);
    recordMigration(db, 24, "model-call-completion-truth");
    commitAtomic(db);
  } catch (error) {
    rollbackAtomic(db);
    throw error;
  }
}

function applyCommercialTestEvidenceLedgerMigration(db) {
  if (migrationApplied(db, 25)) return;
  beginAtomic(db);
  try {
    addColumn(db, "venture_kits", "content_hash TEXT");
    const {
      ventureKitContentHash,
    } = require("./runtime/venture-kit-definition");
    for (const kit of all(db, "SELECT * FROM venture_kits ORDER BY id, version")) {
      const expectedContentHash = ventureKitContentHash(kit);
      if (kit.content_hash && kit.content_hash !== expectedContentHash) {
        throw new Error(
          `Venture Kit ${kit.id}@${kit.version} has a content hash that does not match its definition.`,
        );
      }
      if (!kit.content_hash) {
        run(
          db,
          "UPDATE venture_kits SET content_hash = ? WHERE id = ? AND version = ?",
          [expectedContentHash, kit.id, kit.version],
        );
      }
    }
    db.exec(`
      CREATE TRIGGER IF NOT EXISTS trg_venture_kits_content_hash_insert
      BEFORE INSERT ON venture_kits
      WHEN NEW.content_hash IS NULL
        OR length(NEW.content_hash) <> 71
        OR substr(NEW.content_hash, 1, 7) <> 'sha256:'
        OR substr(NEW.content_hash, 8) GLOB '*[^0-9a-f]*'
      BEGIN
        SELECT RAISE(ABORT, 'A Venture Kit requires its exact immutable content hash.');
      END;

      CREATE TABLE IF NOT EXISTS commercial_test_contracts (
        decision_hash TEXT PRIMARY KEY
          CHECK(
            length(decision_hash) = 71
            AND substr(decision_hash, 1, 7) = 'sha256:'
            AND substr(decision_hash, 8) NOT GLOB '*[^0-9a-f]*'
          ),
        contract_schema TEXT NOT NULL
          CHECK(contract_schema = 'pantheon.commercial-test-contract.v2'),
        program_id TEXT NOT NULL,
        program_version TEXT NOT NULL,
        test_id TEXT NOT NULL,
        test_version TEXT NOT NULL,
        venture_id TEXT NOT NULL,
        venture_kit_id TEXT NOT NULL,
        venture_kit_version INTEGER NOT NULL CHECK(venture_kit_version > 0),
        venture_kit_hash TEXT NOT NULL
          CHECK(
            length(venture_kit_hash) = 71
            AND substr(venture_kit_hash, 1, 7) = 'sha256:'
            AND substr(venture_kit_hash, 8) NOT GLOB '*[^0-9a-f]*'
          ),
        offer_id TEXT NOT NULL,
        offer_version TEXT NOT NULL,
        offer_hash TEXT NOT NULL
          CHECK(
            length(offer_hash) = 71
            AND substr(offer_hash, 1, 7) = 'sha256:'
            AND substr(offer_hash, 8) NOT GLOB '*[^0-9a-f]*'
          ),
        offer_sku TEXT NOT NULL,
        experiment_id TEXT NOT NULL,
        experiment_version TEXT NOT NULL,
        cohort_id TEXT NOT NULL,
        channel_id TEXT NOT NULL,
        provider_namespace TEXT NOT NULL,
        account_hash TEXT NOT NULL
          CHECK(
            length(account_hash) = 71
            AND substr(account_hash, 1, 7) = 'sha256:'
            AND substr(account_hash, 8) NOT GLOB '*[^0-9a-f]*'
          ),
        adapter_id TEXT NOT NULL,
        adapter_version TEXT NOT NULL,
        adapter_hash TEXT NOT NULL
          CHECK(
            length(adapter_hash) = 71
            AND substr(adapter_hash, 1, 7) = 'sha256:'
            AND substr(adapter_hash, 8) NOT GLOB '*[^0-9a-f]*'
          ),
        reporting_starts_at TEXT NOT NULL,
        reporting_ends_at TEXT NOT NULL
          CHECK(reporting_ends_at > reporting_starts_at),
        buyer_key_id TEXT NOT NULL,
        buyer_key_version INTEGER NOT NULL CHECK(buyer_key_version > 0),
        buyer_independence_basis TEXT NOT NULL,
        price_aud_cents INTEGER NOT NULL CHECK(price_aud_cents > 0),
        operator_role TEXT NOT NULL
          CHECK(operator_role = 'approvals_and_guidance_only'),
        external_spend_cap_cents INTEGER NOT NULL
          CHECK(external_spend_cap_cents = 0),
        contract_json TEXT NOT NULL
          CHECK(
            json_valid(contract_json)
            AND json_extract(contract_json, '$.schema') IS contract_schema
            AND json_extract(contract_json, '$.decisionHash') IS decision_hash
            AND json_extract(contract_json, '$.programId') IS program_id
            AND json_extract(contract_json, '$.programVersion') IS program_version
            AND json_extract(contract_json, '$.testId') IS test_id
            AND json_extract(contract_json, '$.testVersion') IS test_version
            AND json_extract(contract_json, '$.ventureId') IS venture_id
            AND json_extract(contract_json, '$.ventureKit.id') IS venture_kit_id
            AND json_extract(contract_json, '$.ventureKit.version') IS venture_kit_version
            AND json_extract(contract_json, '$.ventureKit.hash') IS venture_kit_hash
            AND json_extract(contract_json, '$.offer.id') IS offer_id
            AND json_extract(contract_json, '$.offer.version') IS offer_version
            AND json_extract(contract_json, '$.offer.hash') IS offer_hash
            AND json_extract(contract_json, '$.offer.sku') IS offer_sku
            AND json_extract(contract_json, '$.offerId') IS offer_id
            AND json_extract(contract_json, '$.experiment.id') IS experiment_id
            AND json_extract(contract_json, '$.experiment.version') IS experiment_version
            AND json_extract(contract_json, '$.cohort.id') IS cohort_id
            AND json_extract(contract_json, '$.channel.id') IS channel_id
            AND json_extract(contract_json, '$.channel.providerNamespace') IS provider_namespace
            AND json_extract(contract_json, '$.channel.accountHash') IS account_hash
            AND json_extract(contract_json, '$.channel.adapter.id') IS adapter_id
            AND json_extract(contract_json, '$.channel.adapter.version') IS adapter_version
            AND json_extract(contract_json, '$.channel.adapter.hash') IS adapter_hash
            AND json_extract(contract_json, '$.reportingPeriod.startsAt') IS reporting_starts_at
            AND json_extract(contract_json, '$.reportingPeriod.endsAt') IS reporting_ends_at
            AND json_extract(contract_json, '$.buyerIdentity.keyId') IS buyer_key_id
            AND json_extract(contract_json, '$.buyerIdentity.keyVersion') IS buyer_key_version
            AND json_extract(contract_json, '$.buyerIdentity.independenceBasis')
              IS buyer_independence_basis
            AND json_extract(contract_json, '$.price.currency') IS 'AUD'
            AND json_extract(contract_json, '$.price.amountMinorUnits') IS price_aud_cents
            AND json_extract(contract_json, '$.price.amountAudCents') IS price_aud_cents
            AND json_extract(contract_json, '$.operatorRole') IS operator_role
            AND CAST(ROUND(json_extract(contract_json, '$.externalSpendCapAud') * 100) AS INTEGER)
              IS external_spend_cap_cents
          ),
        created_at TEXT NOT NULL,
        UNIQUE(program_id, program_version, test_id, test_version),
        FOREIGN KEY (venture_id) REFERENCES ventures(id),
        FOREIGN KEY (venture_kit_id, venture_kit_version, venture_kit_hash)
          REFERENCES venture_kits(id, version, content_hash)
      );

      CREATE TABLE IF NOT EXISTS commercial_test_lifecycle_events (
        id TEXT PRIMARY KEY,
        decision_hash TEXT NOT NULL,
        sequence INTEGER NOT NULL CHECK(sequence >= 0),
        previous_event_hash TEXT
          CHECK(
            previous_event_hash IS NULL
            OR (
              length(previous_event_hash) = 71
              AND substr(previous_event_hash, 1, 7) = 'sha256:'
              AND substr(previous_event_hash, 8) NOT GLOB '*[^0-9a-f]*'
            )
          ),
        event_type TEXT NOT NULL
          CHECK(event_type IN ('proposed', 'accepted', 'activated', 'paused', 'closed', 'stopped')),
        event_hash TEXT NOT NULL
          CHECK(
            length(event_hash) = 71
            AND substr(event_hash, 1, 7) = 'sha256:'
            AND substr(event_hash, 8) NOT GLOB '*[^0-9a-f]*'
          ),
        approval_id TEXT,
        approval_scope_hash TEXT
          CHECK(
            approval_scope_hash IS NULL
            OR (
              length(approval_scope_hash) = 71
              AND substr(approval_scope_hash, 1, 7) = 'sha256:'
              AND substr(approval_scope_hash, 8) NOT GLOB '*[^0-9a-f]*'
            )
          ),
        reason TEXT NOT NULL DEFAULT '',
        metadata TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(metadata)),
        event_json TEXT NOT NULL
          CHECK(
            json_valid(event_json)
            AND json_extract(event_json, '$.schema')
              IS 'pantheon.commercial-test-lifecycle-event.v2'
            AND json_extract(event_json, '$.id') IS id
            AND json_extract(event_json, '$.decisionHash') IS decision_hash
            AND json_extract(event_json, '$.sequence') IS sequence
            AND json_type(event_json, '$.previousEventHash') IS NOT NULL
            AND json_extract(event_json, '$.previousEventHash') IS previous_event_hash
            AND json_extract(event_json, '$.eventType') IS event_type
            AND json_extract(event_json, '$.eventHash') IS event_hash
            AND json_type(event_json, '$.approvalId') IS NOT NULL
            AND json_extract(event_json, '$.approvalId') IS approval_id
            AND json_type(event_json, '$.approvalScopeHash') IS NOT NULL
            AND json_extract(event_json, '$.approvalScopeHash') IS approval_scope_hash
            AND json_extract(event_json, '$.reason') IS reason
            AND json_type(event_json, '$.metadata') IS 'object'
            AND json_extract(event_json, '$.metadata') = json(metadata)
            AND json_extract(event_json, '$.occurredAt') IS occurred_at
          ),
        occurred_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(decision_hash, sequence),
        UNIQUE(decision_hash, event_hash),
        FOREIGN KEY (decision_hash) REFERENCES commercial_test_contracts(decision_hash),
        FOREIGN KEY (approval_id) REFERENCES approvals(id),
        FOREIGN KEY (decision_hash, previous_event_hash)
          REFERENCES commercial_test_lifecycle_events(decision_hash, event_hash),
        CHECK(
          (sequence = 0 AND previous_event_hash IS NULL AND event_type = 'proposed')
          OR (sequence > 0 AND previous_event_hash IS NOT NULL)
        )
      );

      CREATE TABLE IF NOT EXISTS commercial_test_evidence_receipts (
        decision_hash TEXT NOT NULL,
        receipt_id TEXT NOT NULL,
        receipt_schema TEXT NOT NULL
          CHECK(receipt_schema = 'pantheon.commercial-test-evidence-receipt.v2'),
        source_kind TEXT NOT NULL
          CHECK(source_kind IN ('imported_platform', 'operator_attested_manual')),
        source_id TEXT NOT NULL,
        provider_namespace TEXT NOT NULL,
        account_hash TEXT NOT NULL
          CHECK(
            length(account_hash) = 71
            AND substr(account_hash, 1, 7) = 'sha256:'
            AND substr(account_hash, 8) NOT GLOB '*[^0-9a-f]*'
          ),
        source_system TEXT NOT NULL,
        export_type TEXT NOT NULL,
        source_hash TEXT NOT NULL
          CHECK(
            length(source_hash) = 71
            AND substr(source_hash, 1, 7) = 'sha256:'
            AND substr(source_hash, 8) NOT GLOB '*[^0-9a-f]*'
          ),
        receipt_hash TEXT NOT NULL
          CHECK(
            length(receipt_hash) = 71
            AND substr(receipt_hash, 1, 7) = 'sha256:'
            AND substr(receipt_hash, 8) NOT GLOB '*[^0-9a-f]*'
          ),
        location_reference TEXT NOT NULL,
        verification_status TEXT NOT NULL
          CHECK(verification_status IN ('pending', 'verified', 'rejected')),
        reporting_starts_at TEXT NOT NULL,
        reporting_ends_at TEXT NOT NULL
          CHECK(reporting_ends_at > reporting_starts_at),
        coverage_basis TEXT NOT NULL
          CHECK(coverage_basis IN (
            'unfiltered_full_reporting_period',
            'single_retained_source'
          )),
        coverage_declared_row_count INTEGER NOT NULL
          CHECK(coverage_declared_row_count > 0),
        coverage_control_hash TEXT NOT NULL
          CHECK(
            length(coverage_control_hash) = 71
            AND substr(coverage_control_hash, 1, 7) = 'sha256:'
            AND substr(coverage_control_hash, 8) NOT GLOB '*[^0-9a-f]*'
          ),
        generated_at TEXT,
        imported_at TEXT,
        import_batch_id TEXT,
        manual_reference_hash TEXT
          CHECK(
            manual_reference_hash IS NULL
            OR (
              length(manual_reference_hash) = 71
              AND substr(manual_reference_hash, 1, 7) = 'sha256:'
              AND substr(manual_reference_hash, 8) NOT GLOB '*[^0-9a-f]*'
            )
          ),
        attested_by TEXT,
        attestation_note TEXT,
        entry_reason TEXT,
        receipt_json TEXT NOT NULL
          CHECK(
            json_valid(receipt_json)
            AND json_extract(receipt_json, '$.schema') IS receipt_schema
            AND json_extract(receipt_json, '$.decisionHash') IS decision_hash
            AND json_extract(receipt_json, '$.receiptId') IS receipt_id
            AND json_extract(receipt_json, '$.sourceKind') IS source_kind
            AND json_extract(receipt_json, '$.sourceId') IS source_id
            AND json_extract(receipt_json, '$.providerNamespace') IS provider_namespace
            AND json_extract(receipt_json, '$.accountHash') IS account_hash
            AND json_extract(receipt_json, '$.sourceSystem') IS source_system
            AND json_extract(receipt_json, '$.exportType') IS export_type
            AND json_extract(receipt_json, '$.sourceHash') IS source_hash
            AND json_extract(receipt_json, '$.receiptHash') IS receipt_hash
            AND json_extract(receipt_json, '$.locationReference') IS location_reference
            AND json_extract(receipt_json, '$.verificationStatus') IS verification_status
            AND json_extract(receipt_json, '$.reportingPeriod.startsAt') IS reporting_starts_at
            AND json_extract(receipt_json, '$.reportingPeriod.endsAt') IS reporting_ends_at
            AND json_extract(receipt_json, '$.coverage.basis') IS coverage_basis
            AND json_extract(receipt_json, '$.coverage.declaredRowCount')
              IS coverage_declared_row_count
            AND json_extract(receipt_json, '$.coverage.controlHash') IS coverage_control_hash
            AND json_extract(receipt_json, '$.capturedAt') IS captured_at
            AND json_type(receipt_json, '$.generatedAt') IS NOT NULL
            AND json_extract(receipt_json, '$.generatedAt') IS generated_at
            AND json_type(receipt_json, '$.importedAt') IS NOT NULL
            AND json_extract(receipt_json, '$.importedAt') IS imported_at
            AND json_type(receipt_json, '$.importBatchId') IS NOT NULL
            AND json_extract(receipt_json, '$.importBatchId') IS import_batch_id
            AND json_type(receipt_json, '$.manualReferenceHash') IS NOT NULL
            AND json_extract(receipt_json, '$.manualReferenceHash') IS manual_reference_hash
            AND json_type(receipt_json, '$.attestedBy') IS NOT NULL
            AND json_extract(receipt_json, '$.attestedBy') IS attested_by
            AND json_type(receipt_json, '$.attestationNote') IS NOT NULL
            AND json_extract(receipt_json, '$.attestationNote') IS attestation_note
            AND json_type(receipt_json, '$.entryReason') IS NOT NULL
            AND json_extract(receipt_json, '$.entryReason') IS entry_reason
          ),
        captured_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (decision_hash, receipt_id),
        UNIQUE(decision_hash, receipt_hash),
        UNIQUE(decision_hash, receipt_id, receipt_hash),
        UNIQUE(
          decision_hash,
          receipt_id,
          receipt_hash,
          source_kind,
          source_id,
          provider_namespace,
          account_hash,
          source_system,
          export_type,
          source_hash,
          verification_status,
          reporting_starts_at,
          reporting_ends_at,
          coverage_basis,
          coverage_declared_row_count,
          coverage_control_hash,
          captured_at
        ),
        FOREIGN KEY (decision_hash) REFERENCES commercial_test_contracts(decision_hash),
        CHECK(
          (
            source_kind = 'imported_platform'
            AND coverage_basis = 'unfiltered_full_reporting_period'
            AND generated_at IS NOT NULL
            AND imported_at IS NOT NULL
            AND imported_at >= generated_at
            AND import_batch_id IS NOT NULL
            AND manual_reference_hash IS NULL
            AND attested_by IS NULL
            AND attestation_note IS NULL
            AND entry_reason IS NULL
          )
          OR (
            source_kind = 'operator_attested_manual'
            AND coverage_basis = 'single_retained_source'
            AND coverage_declared_row_count = 1
            AND generated_at IS NULL
            AND imported_at IS NULL
            AND import_batch_id IS NULL
            AND manual_reference_hash IS NOT NULL
            AND attested_by IS NOT NULL
            AND attestation_note IS NOT NULL
            AND entry_reason IS NOT NULL
          )
        )
      );

      CREATE TABLE IF NOT EXISTS commercial_test_evidence_records (
        record_hash TEXT PRIMARY KEY
          CHECK(
            length(record_hash) = 71
            AND substr(record_hash, 1, 7) = 'sha256:'
            AND substr(record_hash, 8) NOT GLOB '*[^0-9a-f]*'
          ),
        evidence_schema TEXT NOT NULL
          CHECK(evidence_schema = 'pantheon.commercial-test-evidence.v2'),
        decision_hash TEXT NOT NULL,
        evidence_id TEXT NOT NULL,
        evidence_version TEXT NOT NULL,
        kind TEXT NOT NULL
          CHECK(kind IN (
            'transaction',
            'cost',
            'manual_verification',
            'terminal_stop',
            'evidence_set_manifest'
          )),
        source_kind TEXT NOT NULL
          CHECK(source_kind IN ('imported_platform', 'operator_attested_manual')),
        source_id TEXT NOT NULL,
        provider_namespace TEXT NOT NULL,
        account_hash TEXT NOT NULL
          CHECK(
            length(account_hash) = 71
            AND substr(account_hash, 1, 7) = 'sha256:'
            AND substr(account_hash, 8) NOT GLOB '*[^0-9a-f]*'
          ),
        source_system TEXT NOT NULL,
        export_type TEXT NOT NULL,
        source_hash TEXT NOT NULL
          CHECK(
            length(source_hash) = 71
            AND substr(source_hash, 1, 7) = 'sha256:'
            AND substr(source_hash, 8) NOT GLOB '*[^0-9a-f]*'
          ),
        source_row_hash TEXT NOT NULL
          CHECK(
            length(source_row_hash) = 71
            AND substr(source_row_hash, 1, 7) = 'sha256:'
            AND substr(source_row_hash, 8) NOT GLOB '*[^0-9a-f]*'
          ),
        receipt_id TEXT NOT NULL,
        receipt_hash TEXT NOT NULL
          CHECK(
            length(receipt_hash) = 71
            AND substr(receipt_hash, 1, 7) = 'sha256:'
            AND substr(receipt_hash, 8) NOT GLOB '*[^0-9a-f]*'
          ),
        verification_status TEXT NOT NULL
          CHECK(verification_status IN ('pending', 'verified', 'rejected')),
        reporting_starts_at TEXT NOT NULL,
        reporting_ends_at TEXT NOT NULL
          CHECK(reporting_ends_at > reporting_starts_at),
        coverage_basis TEXT NOT NULL
          CHECK(coverage_basis IN (
            'unfiltered_full_reporting_period',
            'single_retained_source'
          )),
        coverage_declared_row_count INTEGER NOT NULL
          CHECK(coverage_declared_row_count > 0),
        coverage_control_hash TEXT NOT NULL
          CHECK(
            length(coverage_control_hash) = 71
            AND substr(coverage_control_hash, 1, 7) = 'sha256:'
            AND substr(coverage_control_hash, 8) NOT GLOB '*[^0-9a-f]*'
          ),
        captured_at TEXT NOT NULL,
        supersedes_record_hash TEXT
          CHECK(
            supersedes_record_hash IS NULL
            OR (
              length(supersedes_record_hash) = 71
              AND substr(supersedes_record_hash, 1, 7) = 'sha256:'
              AND substr(supersedes_record_hash, 8) NOT GLOB '*[^0-9a-f]*'
            )
          ),
        transaction_key TEXT,
        transaction_id_hash TEXT,
        transaction_economic_hash TEXT,
        buyer_pseudonym TEXT,
        buyer_key_id TEXT,
        buyer_key_version INTEGER,
        buyer_independence_basis TEXT,
        transaction_event_type TEXT
          CHECK(
            transaction_event_type IS NULL
            OR transaction_event_type IN ('original', 'correction', 'refund', 'reversal')
          ),
        transaction_chain_sequence INTEGER,
        transaction_status TEXT
          CHECK(
            transaction_status IS NULL
            OR transaction_status IN ('pending', 'settled', 'refunded', 'disputed', 'cancelled')
          ),
        settlement_state TEXT
          CHECK(
            settlement_state IS NULL
            OR settlement_state IN (
              'pending',
              'platform_balance',
              'cash_settled',
              'unknown',
              'not_applicable'
            )
          ),
        settlement_reference_hash TEXT,
        occurred_at TEXT,
        settled_at TEXT,
        gross_revenue_original_minor_units INTEGER,
        gross_revenue_currency TEXT,
        gross_revenue_aud_cents INTEGER,
        refunds_original_minor_units INTEGER,
        refunds_currency TEXT,
        refunds_aud_cents INTEGER,
        cost_key TEXT,
        cost_id_hash TEXT,
        cost_economic_hash TEXT,
        cost_event_type TEXT
          CHECK(
            cost_event_type IS NULL
            OR cost_event_type IN ('original', 'correction', 'reversal')
          ),
        cost_chain_sequence INTEGER,
        cost_category TEXT
          CHECK(
            cost_category IS NULL
            OR cost_category IN (
              'platform_fees',
              'payment_fees',
              'tax',
              'advertising',
              'fulfilment',
              'paid_tools',
              'model_usage',
              'other_attributable'
            )
          ),
        cost_state TEXT
          CHECK(
            cost_state IS NULL
            OR cost_state IN ('unknown', 'estimated', 'incurred', 'reconciled')
          ),
        cost_original_minor_units INTEGER,
        cost_currency TEXT,
        cost_aud_cents INTEGER,
        attribution_status TEXT NOT NULL
          CHECK(attribution_status IN ('attributed', 'unattributed', 'unknown')),
        record_json TEXT NOT NULL
          CHECK(
            json_valid(record_json)
            AND json_extract(record_json, '$.schema') IS evidence_schema
            AND json_extract(record_json, '$.recordHash') IS record_hash
            AND json_extract(record_json, '$.testBinding.decisionHash') IS decision_hash
            AND json_extract(record_json, '$.evidenceId') IS evidence_id
            AND json_extract(record_json, '$.evidenceVersion') IS evidence_version
            AND json_extract(record_json, '$.kind') IS kind
            AND json_extract(record_json, '$.source.kind') IS source_kind
            AND json_extract(record_json, '$.source.sourceId') IS source_id
            AND json_extract(record_json, '$.source.providerNamespace') IS provider_namespace
            AND json_extract(record_json, '$.source.accountHash') IS account_hash
            AND json_extract(record_json, '$.source.sourceSystem') IS source_system
            AND json_extract(record_json, '$.source.exportType') IS export_type
            AND json_extract(record_json, '$.source.sourceHash') IS source_hash
            AND json_extract(record_json, '$.source.sourceRowHash') IS source_row_hash
            AND json_extract(record_json, '$.source.receipt.id') IS receipt_id
            AND json_extract(record_json, '$.source.receipt.hash') IS receipt_hash
            AND json_extract(record_json, '$.source.verificationStatus') IS verification_status
            AND json_extract(record_json, '$.source.reportingPeriod.startsAt')
              IS reporting_starts_at
            AND json_extract(record_json, '$.source.reportingPeriod.endsAt')
              IS reporting_ends_at
            AND json_extract(record_json, '$.source.coverage.basis') IS coverage_basis
            AND json_extract(record_json, '$.source.coverage.declaredRowCount')
              IS coverage_declared_row_count
            AND json_extract(record_json, '$.source.coverage.controlHash')
              IS coverage_control_hash
            AND json_extract(record_json, '$.source.capturedAt') IS captured_at
            AND json_type(record_json, '$.supersedesRecordHash') IS NOT NULL
            AND json_extract(record_json, '$.supersedesRecordHash') IS supersedes_record_hash
            AND json_extract(record_json, '$.attribution.status') IS attribution_status
          ),
        created_at TEXT NOT NULL,
        UNIQUE(decision_hash, evidence_id, evidence_version),
        FOREIGN KEY (decision_hash) REFERENCES commercial_test_contracts(decision_hash),
        FOREIGN KEY (
          decision_hash,
          receipt_id,
          receipt_hash,
          source_kind,
          source_id,
          provider_namespace,
          account_hash,
          source_system,
          export_type,
          source_hash,
          verification_status,
          reporting_starts_at,
          reporting_ends_at,
          coverage_basis,
          coverage_declared_row_count,
          coverage_control_hash,
          captured_at
        ) REFERENCES commercial_test_evidence_receipts(
          decision_hash,
          receipt_id,
          receipt_hash,
          source_kind,
          source_id,
          provider_namespace,
          account_hash,
          source_system,
          export_type,
          source_hash,
          verification_status,
          reporting_starts_at,
          reporting_ends_at,
          coverage_basis,
          coverage_declared_row_count,
          coverage_control_hash,
          captured_at
        ),
        FOREIGN KEY (supersedes_record_hash)
          REFERENCES commercial_test_evidence_records(record_hash),
        CHECK(
          (
            kind = 'transaction'
            AND transaction_key IS NOT NULL
            AND length(transaction_key) = 71
            AND substr(transaction_key, 1, 7) = 'sha256:'
            AND substr(transaction_key, 8) NOT GLOB '*[^0-9a-f]*'
            AND transaction_id_hash IS NOT NULL
            AND length(transaction_id_hash) = 71
            AND substr(transaction_id_hash, 1, 7) = 'sha256:'
            AND substr(transaction_id_hash, 8) NOT GLOB '*[^0-9a-f]*'
            AND transaction_economic_hash IS NOT NULL
            AND length(transaction_economic_hash) = 71
            AND substr(transaction_economic_hash, 1, 7) = 'sha256:'
            AND substr(transaction_economic_hash, 8) NOT GLOB '*[^0-9a-f]*'
            AND buyer_pseudonym IS NOT NULL
            AND length(buyer_pseudonym) = 70
            AND substr(buyer_pseudonym, 1, 6) = 'buyer_'
            AND substr(buyer_pseudonym, 7) NOT GLOB '*[^0-9a-f]*'
            AND buyer_key_id IS NOT NULL
            AND buyer_key_version > 0
            AND buyer_independence_basis IS NOT NULL
            AND transaction_event_type IS NOT NULL
            AND transaction_chain_sequence >= 0
            AND transaction_status IS NOT NULL
            AND settlement_state IS NOT NULL
            AND occurred_at IS NOT NULL
            AND gross_revenue_original_minor_units IS NOT NULL
            AND gross_revenue_original_minor_units >= 0
            AND length(gross_revenue_currency) = 3
            AND gross_revenue_aud_cents IS NOT NULL
            AND gross_revenue_aud_cents >= 0
            AND refunds_original_minor_units IS NOT NULL
            AND refunds_original_minor_units >= 0
            AND refunds_currency = gross_revenue_currency
            AND refunds_aud_cents IS NOT NULL
            AND refunds_aud_cents >= 0
            AND refunds_aud_cents <= gross_revenue_aud_cents
            AND json_type(record_json, '$.transaction') IS 'object'
            AND json_extract(record_json, '$.transaction.transactionKey') IS transaction_key
            AND json_extract(record_json, '$.transaction.transactionIdHash')
              IS transaction_id_hash
            AND json_extract(record_json, '$.transaction.transactionEconomicHash')
              IS transaction_economic_hash
            AND json_extract(record_json, '$.transaction.buyer.pseudonym') IS buyer_pseudonym
            AND json_extract(record_json, '$.transaction.buyer.keyId') IS buyer_key_id
            AND json_extract(record_json, '$.transaction.buyer.keyVersion')
              IS buyer_key_version
            AND json_extract(record_json, '$.transaction.buyer.independenceBasis')
              IS buyer_independence_basis
            AND json_extract(record_json, '$.transaction.eventType') IS transaction_event_type
            AND json_extract(record_json, '$.transaction.chain.sequence')
              IS transaction_chain_sequence
            AND json_type(record_json, '$.transaction.chain.predecessorRecordHash')
              IS NOT NULL
            AND json_extract(record_json, '$.transaction.chain.predecessorRecordHash')
              IS supersedes_record_hash
            AND json_extract(record_json, '$.transaction.status') IS transaction_status
            AND json_extract(record_json, '$.transaction.settlement.state') IS settlement_state
            AND json_type(record_json, '$.transaction.settlement.referenceHash')
              IS NOT NULL
            AND json_extract(record_json, '$.transaction.settlement.referenceHash')
              IS settlement_reference_hash
            AND json_extract(record_json, '$.transaction.occurredAt') IS occurred_at
            AND json_type(record_json, '$.transaction.settledAt') IS NOT NULL
            AND json_extract(record_json, '$.transaction.settledAt') IS settled_at
            AND json_extract(
              record_json,
              '$.transaction.grossRevenue.originalMinorUnits'
            ) IS gross_revenue_original_minor_units
            AND json_extract(record_json, '$.transaction.grossRevenue.currency')
              IS gross_revenue_currency
            AND json_extract(record_json, '$.transaction.grossRevenue.audCents')
              IS gross_revenue_aud_cents
            AND json_extract(record_json, '$.transaction.grossRevenueAudCents')
              IS gross_revenue_aud_cents
            AND json_extract(record_json, '$.transaction.refunds.originalMinorUnits')
              IS refunds_original_minor_units
            AND json_extract(record_json, '$.transaction.refunds.currency')
              IS refunds_currency
            AND json_extract(record_json, '$.transaction.refunds.audCents')
              IS refunds_aud_cents
            AND json_extract(record_json, '$.transaction.refundsAudCents')
              IS refunds_aud_cents
            AND json_type(record_json, '$.cost') IS 'null'
          )
          OR (
            kind <> 'transaction'
            AND transaction_key IS NULL
            AND transaction_id_hash IS NULL
            AND transaction_economic_hash IS NULL
            AND buyer_pseudonym IS NULL
            AND buyer_key_id IS NULL
            AND buyer_key_version IS NULL
            AND buyer_independence_basis IS NULL
            AND transaction_event_type IS NULL
            AND transaction_chain_sequence IS NULL
            AND transaction_status IS NULL
            AND settlement_state IS NULL
            AND settlement_reference_hash IS NULL
            AND settled_at IS NULL
            AND gross_revenue_original_minor_units IS NULL
            AND gross_revenue_currency IS NULL
            AND gross_revenue_aud_cents IS NULL
            AND refunds_original_minor_units IS NULL
            AND refunds_currency IS NULL
            AND refunds_aud_cents IS NULL
            AND json_type(record_json, '$.transaction') IS 'null'
          )
        ),
        CHECK(
          (
            kind = 'cost'
            AND cost_key IS NOT NULL
            AND length(cost_key) = 71
            AND substr(cost_key, 1, 7) = 'sha256:'
            AND substr(cost_key, 8) NOT GLOB '*[^0-9a-f]*'
            AND cost_id_hash IS NOT NULL
            AND length(cost_id_hash) = 71
            AND substr(cost_id_hash, 1, 7) = 'sha256:'
            AND substr(cost_id_hash, 8) NOT GLOB '*[^0-9a-f]*'
            AND cost_economic_hash IS NOT NULL
            AND length(cost_economic_hash) = 71
            AND substr(cost_economic_hash, 1, 7) = 'sha256:'
            AND substr(cost_economic_hash, 8) NOT GLOB '*[^0-9a-f]*'
            AND cost_event_type IS NOT NULL
            AND cost_chain_sequence >= 0
            AND cost_category IS NOT NULL
            AND cost_state IS NOT NULL
            AND occurred_at IS NOT NULL
            AND (
              (
                cost_state = 'unknown'
                AND cost_original_minor_units IS NULL
                AND cost_currency IS NULL
                AND cost_aud_cents IS NULL
              )
              OR (
                cost_state <> 'unknown'
                AND cost_original_minor_units IS NOT NULL
                AND cost_original_minor_units >= 0
                AND length(cost_currency) = 3
                AND cost_aud_cents IS NOT NULL
                AND cost_aud_cents >= 0
              )
            )
            AND json_type(record_json, '$.cost') IS 'object'
            AND json_extract(record_json, '$.cost.costKey') IS cost_key
            AND json_extract(record_json, '$.cost.costIdHash') IS cost_id_hash
            AND json_extract(record_json, '$.cost.costEconomicHash') IS cost_economic_hash
            AND json_extract(record_json, '$.cost.eventType') IS cost_event_type
            AND json_extract(record_json, '$.cost.chain.sequence') IS cost_chain_sequence
            AND json_type(record_json, '$.cost.chain.predecessorRecordHash') IS NOT NULL
            AND json_extract(record_json, '$.cost.chain.predecessorRecordHash')
              IS supersedes_record_hash
            AND json_extract(record_json, '$.cost.category') IS cost_category
            AND json_extract(record_json, '$.cost.state') IS cost_state
            AND json_extract(record_json, '$.cost.occurredAt') IS occurred_at
            AND (
              (
                cost_state = 'unknown'
                AND json_type(record_json, '$.cost.amount') IS 'null'
                AND json_type(record_json, '$.cost.amountAudCents') IS 'null'
              )
              OR (
                cost_state <> 'unknown'
                AND json_extract(record_json, '$.cost.amount.originalMinorUnits')
                  IS cost_original_minor_units
                AND json_extract(record_json, '$.cost.amount.currency') IS cost_currency
                AND json_extract(record_json, '$.cost.amount.audCents') IS cost_aud_cents
                AND json_extract(record_json, '$.cost.amountAudCents') IS cost_aud_cents
              )
            )
          )
          OR (
            kind <> 'cost'
            AND cost_key IS NULL
            AND cost_id_hash IS NULL
            AND cost_economic_hash IS NULL
            AND cost_event_type IS NULL
            AND cost_chain_sequence IS NULL
            AND cost_category IS NULL
            AND cost_state IS NULL
            AND cost_original_minor_units IS NULL
            AND cost_currency IS NULL
            AND cost_aud_cents IS NULL
            AND json_type(record_json, '$.cost') IS 'null'
          )
        ),
        CHECK(
          (
            kind IN ('transaction', 'cost')
            AND (
              (
                source_kind = 'operator_attested_manual'
                AND verification_status = 'pending'
              )
              OR source_kind = 'imported_platform'
            )
          )
          OR (
            kind = 'manual_verification'
            AND source_kind = 'operator_attested_manual'
            AND verification_status IN ('verified', 'rejected')
            AND supersedes_record_hash IS NULL
            AND occurred_at IS NULL
          )
          OR (
            kind IN ('terminal_stop', 'evidence_set_manifest')
            AND verification_status = 'verified'
            AND occurred_at IS NULL
          )
        ),
        CHECK(
          (
            transaction_event_type = 'original'
            AND transaction_chain_sequence = 0
            AND supersedes_record_hash IS NULL
            AND json_type(record_json, '$.transaction.chain.reversesRecordHash') IS 'null'
          )
          OR (
            transaction_event_type IN ('correction', 'refund')
            AND transaction_chain_sequence > 0
            AND supersedes_record_hash IS NOT NULL
            AND json_type(record_json, '$.transaction.chain.reversesRecordHash') IS 'null'
          )
          OR (
            transaction_event_type = 'reversal'
            AND transaction_chain_sequence > 0
            AND supersedes_record_hash IS NOT NULL
            AND json_type(record_json, '$.transaction.chain.reversesRecordHash') IS 'text'
          )
          OR transaction_event_type IS NULL
        ),
        CHECK(
          (
            cost_event_type = 'original'
            AND cost_chain_sequence = 0
            AND supersedes_record_hash IS NULL
            AND json_type(record_json, '$.cost.chain.reversesRecordHash') IS 'null'
          )
          OR (
            cost_event_type = 'correction'
            AND cost_chain_sequence > 0
            AND supersedes_record_hash IS NOT NULL
            AND json_type(record_json, '$.cost.chain.reversesRecordHash') IS 'null'
          )
          OR (
            cost_event_type = 'reversal'
            AND cost_chain_sequence > 0
            AND supersedes_record_hash IS NOT NULL
            AND json_type(record_json, '$.cost.chain.reversesRecordHash') IS 'text'
          )
          OR cost_event_type IS NULL
        ),
        CHECK(
          (
            settlement_state = 'cash_settled'
            AND transaction_status IN ('settled', 'refunded')
            AND settled_at IS NOT NULL
            AND settlement_reference_hash IS NOT NULL
            AND length(settlement_reference_hash) = 71
            AND substr(settlement_reference_hash, 1, 7) = 'sha256:'
            AND substr(settlement_reference_hash, 8) NOT GLOB '*[^0-9a-f]*'
          )
          OR (
            settlement_state IN ('pending', 'platform_balance', 'unknown')
            AND settled_at IS NULL
            AND settlement_reference_hash IS NULL
          )
          OR (
            settlement_state = 'not_applicable'
            AND transaction_status = 'cancelled'
            AND settled_at IS NULL
            AND settlement_reference_hash IS NULL
            AND gross_revenue_aud_cents = 0
            AND refunds_aud_cents = 0
          )
          OR settlement_state IS NULL
        ),
        CHECK(
          (
            kind = 'manual_verification'
            AND json_type(record_json, '$.manualVerification') IS 'object'
            AND json_type(record_json, '$.terminalStop') IS 'null'
            AND json_type(record_json, '$.manifest') IS 'null'
          )
          OR (
            kind = 'terminal_stop'
            AND json_type(record_json, '$.manualVerification') IS 'null'
            AND json_type(record_json, '$.terminalStop') IS 'object'
            AND json_type(record_json, '$.manifest') IS 'null'
          )
          OR (
            kind = 'evidence_set_manifest'
            AND json_type(record_json, '$.manualVerification') IS 'null'
            AND json_type(record_json, '$.terminalStop') IS 'null'
            AND json_type(record_json, '$.manifest') IS 'object'
          )
          OR (
            kind IN ('transaction', 'cost')
            AND json_type(record_json, '$.manualVerification') IS 'null'
            AND json_type(record_json, '$.terminalStop') IS 'null'
            AND json_type(record_json, '$.manifest') IS 'null'
          )
        )
      );

      CREATE TABLE IF NOT EXISTS commercial_test_proof_evaluations (
        evaluation_hash TEXT PRIMARY KEY
          CHECK(
            length(evaluation_hash) = 71
            AND substr(evaluation_hash, 1, 7) = 'sha256:'
            AND substr(evaluation_hash, 8) NOT GLOB '*[^0-9a-f]*'
          ),
        proof_schema TEXT NOT NULL
          CHECK(proof_schema = 'pantheon.commercial-test-proof-evaluation.v2'),
        decision_hash TEXT NOT NULL,
        evidence_set_hash TEXT NOT NULL
          CHECK(
            length(evidence_set_hash) = 71
            AND substr(evidence_set_hash, 1, 7) = 'sha256:'
            AND substr(evidence_set_hash, 8) NOT GLOB '*[^0-9a-f]*'
          ),
        outcome TEXT NOT NULL
          CHECK(outcome IN ('pass', 'revise', 'inconclusive', 'stop')),
        proof_reached INTEGER NOT NULL CHECK(proof_reached IN (0, 1)),
        buyer_signal_only INTEGER NOT NULL CHECK(buyer_signal_only IN (0, 1)),
        distinct_positive_buyers INTEGER NOT NULL CHECK(distinct_positive_buyers >= 0),
        settled_revenue_aud_cents INTEGER NOT NULL CHECK(settled_revenue_aud_cents >= 0),
        refunds_aud_cents INTEGER NOT NULL CHECK(refunds_aud_cents >= 0),
        reconciled_costs_aud_cents INTEGER NOT NULL CHECK(reconciled_costs_aud_cents >= 0),
        actual_net_cash_contribution_aud_cents INTEGER NOT NULL,
        evaluation_json TEXT NOT NULL
          CHECK(
            json_valid(evaluation_json)
            AND json_extract(evaluation_json, '$.schema') IS proof_schema
            AND json_extract(evaluation_json, '$.evaluationHash') IS evaluation_hash
            AND json_extract(evaluation_json, '$.decisionHash') IS decision_hash
            AND json_extract(evaluation_json, '$.evidenceSetHash') IS evidence_set_hash
            AND json_extract(evaluation_json, '$.outcome') IS outcome
            AND json_extract(evaluation_json, '$.proofReached') IS proof_reached
            AND json_extract(evaluation_json, '$.buyerSignalOnly') IS buyer_signal_only
            AND json_extract(evaluation_json, '$.evidence.distinctPositiveBuyers')
              IS distinct_positive_buyers
            AND json_extract(evaluation_json, '$.financials.settledRevenueAudCents')
              IS settled_revenue_aud_cents
            AND json_extract(evaluation_json, '$.financials.refundsAudCents')
              IS refunds_aud_cents
            AND json_extract(evaluation_json, '$.financials.reconciledCostsAudCents')
              IS reconciled_costs_aud_cents
            AND json_extract(
              evaluation_json,
              '$.financials.actualNetCashContributionAudCents'
            ) IS actual_net_cash_contribution_aud_cents
          ),
        evaluated_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(decision_hash, evidence_set_hash, evaluation_hash),
        FOREIGN KEY (decision_hash) REFERENCES commercial_test_contracts(decision_hash)
      );

    `);
    db.exec(Object.values(COMMERCIAL_LEDGER_REQUIRED_INDEX_SQL).join(";\n"));
    db.exec(Object.values(COMMERCIAL_LEDGER_IMMUTABLE_TRIGGER_SQL).join(";\n"));
    recordMigration(db, 25, "commercial-test-contract-evidence-ledger");
    commitAtomic(db);
  } catch (error) {
    rollbackAtomic(db);
    throw error;
  }
}

function ensureCommercialLifecycleApprovalGuards(db) {
  const approvalIndex = get(
    db,
    `SELECT name FROM sqlite_master
     WHERE type = 'index' AND name = 'idx_commercial_test_lifecycle_approval_once'`,
  );
  const freshnessTrigger = get(
    db,
    `SELECT name FROM sqlite_master
     WHERE type = 'trigger'
       AND name = 'trg_commercial_test_lifecycle_resume_approval_fresh_insert'`,
  );
  if (approvalIndex && freshnessTrigger) return;

  beginAtomic(db);
  try {
    const replay = get(
      db,
      `SELECT approval_id, COUNT(*) AS uses
       FROM commercial_test_lifecycle_events
       WHERE approval_id IS NOT NULL
         AND event_type IN ('accepted', 'activated')
       GROUP BY approval_id
       HAVING COUNT(*) > 1
       ORDER BY approval_id
       LIMIT 1`,
    );
    if (replay) {
      throw new Error(
        `Commercial lifecycle approval ${replay.approval_id} is already bound to ${replay.uses} lifecycle events; approval history must be reconciled before startup.`,
      );
    }
    db.exec(COMMERCIAL_LEDGER_REQUIRED_INDEX_SQL
      .idx_commercial_test_lifecycle_approval_once);
    db.exec(COMMERCIAL_LEDGER_IMMUTABLE_TRIGGER_SQL
      .trg_commercial_test_lifecycle_resume_approval_fresh_insert);
    commitAtomic(db);
  } catch (error) {
    rollbackAtomic(db);
    throw error;
  }
}

function applyCanonicalCommercialTruthReconciliationMigration(db) {
  // Schema 26 is the last released contract. Re-assert its guards for
  // supported released databases before applying later migrations.
  ensureCommercialLifecycleApprovalGuards(db);
  if (migrationApplied(db, 26)) return;
  beginAtomic(db);
  try {
    // Loaded lazily to avoid a module-initialization cycle: the reconciliation
    // module uses the database helpers exported by this file.
    const {
      reconcileCanonicalHistoricalTruth,
    } = require("./runtime/commercial-truth-reconciliation");
    reconcileCanonicalHistoricalTruth(db);
    recordMigration(db, 26, "canonical-commercial-truth-reconciliation");
    commitAtomic(db);
  } catch (error) {
    rollbackAtomic(db);
    throw error;
  }
}

const atomicScopes = new WeakMap();
let atomicScopeSequence = 0;

function beginAtomic(db) {
  const scopes = atomicScopes.get(db) || [];
  if (db.isTransaction) {
    const savepoint = `pantheon_atomic_${++atomicScopeSequence}`;
    db.exec(`SAVEPOINT ${savepoint}`);
    scopes.push(savepoint);
  } else {
    db.exec("BEGIN " + "IMMEDIATE");
    scopes.push(null);
  }
  atomicScopes.set(db, scopes);
}

function commitAtomic(db) {
  const scopes = atomicScopes.get(db) || [];
  const scope = scopes.at(-1);
  if (scope === undefined) throw new Error("Pantheon atomic scope is missing.");
  if (scope === null) db.exec("COM" + "MIT");
  else db.exec(`RELEASE SAVEPOINT ${scope}`);
  scopes.pop();
  if (scopes.length === 0) atomicScopes.delete(db);
}

function rollbackAtomic(db) {
  const scopes = atomicScopes.get(db) || [];
  const scope = scopes.pop();
  if (scope === undefined) throw new Error("Pantheon atomic scope is missing.");
  if (scope === null) {
    db.exec("ROLL" + "BACK");
  } else {
    db.exec(`ROLLBACK TO SAVEPOINT ${scope}`);
    db.exec(`RELEASE SAVEPOINT ${scope}`);
  }
  if (scopes.length === 0) atomicScopes.delete(db);
}

function applyPreventureResearchAuthorityMigration(db) {
  // Schema 27 has never been released. Once its migration row exists, startup
  // must verify the exact candidate instead of mutating or "repairing" it.
  // This preserves the rejected database byte-for-byte for operator recovery.
  if (migrationApplied(db, 27)) return;
  beginAtomic(db);
  try {
    addColumn(db, "approvals", "decided_by TEXT");
    db.exec(`
      CREATE TABLE IF NOT EXISTS preventure_research_authorities (
        authority_hash TEXT PRIMARY KEY
          CHECK (
            length(authority_hash) = 71
            AND substr(authority_hash, 1, 7) = 'sha256:'
            AND substr(authority_hash, 8) NOT GLOB '*[^0-9a-f]*'
          ),
        authority_schema TEXT NOT NULL
          CHECK (authority_schema IN (
            'pantheon.preventure-research-authority.v1',
            'pantheon.preventure-research-authority.v2'
          )),
        authority_id TEXT NOT NULL,
        authority_version TEXT NOT NULL,
        readiness_id TEXT NOT NULL,
        readiness_version TEXT NOT NULL,
        readiness_hash TEXT NOT NULL
          CHECK (
            length(readiness_hash) = 71
            AND substr(readiness_hash, 1, 7) = 'sha256:'
            AND substr(readiness_hash, 8) NOT GLOB '*[^0-9a-f]*'
          ),
        provider_id TEXT NOT NULL,
        provider_model TEXT NOT NULL,
        approved_at TEXT NOT NULL CHECK (julianday(approved_at) IS NOT NULL),
        expires_at TEXT NOT NULL
          CHECK (
            julianday(expires_at) IS NOT NULL
            AND julianday(expires_at) > julianday(approved_at)
          ),
        internal_ai_spend_cap_aud_cents INTEGER NOT NULL
          CHECK (internal_ai_spend_cap_aud_cents BETWEEN 1 AND 200),
        total_worst_case_exposure_aud_cents INTEGER NOT NULL
          CHECK (total_worst_case_exposure_aud_cents = 150),
        external_commercial_spend_cap_aud_cents INTEGER NOT NULL
          CHECK (external_commercial_spend_cap_aud_cents = 0),
        supersedes_authority_hash TEXT,
        authority_json TEXT NOT NULL
          CHECK (
            json_valid(authority_json)
            AND json_extract(authority_json, '$.authorityHash') IS authority_hash
            AND json_extract(authority_json, '$.schema') IS authority_schema
            AND json_extract(authority_json, '$.id') IS authority_id
            AND json_extract(authority_json, '$.version') IS authority_version
            AND json_extract(authority_json, '$.readinessBinding.id') IS readiness_id
            AND json_extract(authority_json, '$.readinessBinding.version') IS readiness_version
            AND json_extract(authority_json, '$.readinessBinding.hash') IS readiness_hash
            AND json_extract(authority_json, '$.provider.id') IS provider_id
            AND json_extract(authority_json, '$.provider.model') IS provider_model
            AND json_extract(authority_json, '$.approvedAt') IS approved_at
            AND json_extract(authority_json, '$.expiresAt') IS expires_at
            AND json_extract(authority_json, '$.internalAiSpendCapAudCents')
              IS internal_ai_spend_cap_aud_cents
            AND json_extract(authority_json, '$.totalWorstCaseExposureAudCents')
              IS total_worst_case_exposure_aud_cents
            AND json_extract(authority_json, '$.externalCommercialSpendCapAudCents')
              IS external_commercial_spend_cap_aud_cents
            AND (
              (
                authority_schema = 'pantheon.preventure-research-authority.v1'
                AND supersedes_authority_hash IS NULL
                AND json_type(authority_json, '$.supersedesAuthorityHash') IS NULL
              )
              OR (
                authority_schema = 'pantheon.preventure-research-authority.v2'
                AND supersedes_authority_hash IS NOT NULL
                AND supersedes_authority_hash <> authority_hash
                AND json_extract(authority_json, '$.supersedesAuthorityHash')
                  IS supersedes_authority_hash
              )
            )
          ),
        readiness_json TEXT NOT NULL
          CHECK (
            json_valid(readiness_json)
            AND json_extract(readiness_json, '$.id') IS readiness_id
            AND json_extract(readiness_json, '$.version') IS readiness_version
          ),
        created_at TEXT NOT NULL CHECK (julianday(created_at) IS NOT NULL),
        FOREIGN KEY (supersedes_authority_hash)
          REFERENCES preventure_research_authorities(authority_hash)
      );

      CREATE TABLE IF NOT EXISTS preventure_research_approval_decisions (
        decision_receipt_hash TEXT PRIMARY KEY
          CHECK (
            length(decision_receipt_hash) = 71
            AND substr(decision_receipt_hash, 1, 7) = 'sha256:'
            AND substr(decision_receipt_hash, 8) NOT GLOB '*[^0-9a-f]*'
          ),
        approval_id TEXT NOT NULL UNIQUE,
        authority_hash TEXT NOT NULL,
        event_type TEXT NOT NULL CHECK (event_type IN ('accepted', 'activated')),
        scope_hash TEXT NOT NULL
          CHECK (
            length(scope_hash) = 71
            AND substr(scope_hash, 1, 7) = 'sha256:'
            AND substr(scope_hash, 8) NOT GLOB '*[^0-9a-f]*'
          ),
        requested_by TEXT NOT NULL CHECK (requested_by = 'jarvis'),
        requested_at TEXT NOT NULL CHECK (julianday(requested_at) IS NOT NULL),
        decided_by TEXT NOT NULL CHECK (decided_by = 'owner'),
        decision_source TEXT NOT NULL
          CHECK (decision_source IN (
            'authenticated_owner_session_attestation',
            'signed_local_owner_session'
          )),
        decision_status TEXT NOT NULL
          CHECK (decision_status IN ('approved', 'needs_changes', 'rejected')),
        decided_at TEXT NOT NULL CHECK (julianday(decided_at) IS NOT NULL),
        receipt_json TEXT NOT NULL
          CHECK (
            json_valid(receipt_json)
            AND json_extract(receipt_json, '$.receiptHash') IS decision_receipt_hash
            AND json_extract(receipt_json, '$.approvalId') IS approval_id
            AND json_extract(receipt_json, '$.authorityHash') IS authority_hash
            AND json_extract(receipt_json, '$.eventType') IS event_type
            AND json_extract(receipt_json, '$.scopeHash') IS scope_hash
            AND json_extract(receipt_json, '$.priorPending.requestedBy') IS requested_by
            AND json_extract(receipt_json, '$.priorPending.requestedAt') IS requested_at
            AND json_extract(receipt_json, '$.decidedBy') IS decided_by
            AND json_extract(receipt_json, '$.decisionSource') IS decision_source
            AND json_extract(receipt_json, '$.decisionStatus') IS decision_status
            AND json_extract(receipt_json, '$.decidedAt') IS decided_at
            AND (
              (
                json_extract(receipt_json, '$.schema')
                  IS 'pantheon.preventure-research-approval-decision.v2'
                AND decision_source = 'authenticated_owner_session_attestation'
                AND length(json_extract(receipt_json, '$.decisionNoteHash')) = 71
                AND substr(json_extract(receipt_json, '$.decisionNoteHash'), 1, 7)
                  = 'sha256:'
                AND substr(json_extract(receipt_json, '$.decisionNoteHash'), 8)
                  NOT GLOB '*[^0-9a-f]*'
              )
              OR (
                json_extract(receipt_json, '$.schema')
                  IS 'pantheon.preventure-research-approval-decision.v1'
                AND decision_source = 'signed_local_owner_session'
                AND json_type(receipt_json, '$.decisionNoteHash') IS NULL
              )
            )
          ),
        created_at TEXT NOT NULL CHECK (julianday(created_at) IS NOT NULL),
        CHECK (
          decision_source = 'authenticated_owner_session_attestation'
          OR (${HISTORICAL_PREVENTURE_APPROVAL_DECISION_SQL})
        ),
        FOREIGN KEY (approval_id) REFERENCES approvals(id),
        FOREIGN KEY (authority_hash)
          REFERENCES preventure_research_authorities(authority_hash)
      );

      CREATE TABLE IF NOT EXISTS preventure_research_decisions (
        decision_hash TEXT PRIMARY KEY
          CHECK (
            length(decision_hash) = 71
            AND substr(decision_hash, 1, 7) = 'sha256:'
            AND substr(decision_hash, 8) NOT GLOB '*[^0-9a-f]*'
          ),
        decision_schema TEXT NOT NULL
          CHECK (decision_schema = 'pantheon.preventure-research-decision.v1'),
        authority_hash TEXT NOT NULL,
        decision_id TEXT NOT NULL,
        decision_version TEXT NOT NULL,
        outcome TEXT NOT NULL
          CHECK (outcome IN ('build', 'research_more', 'revise', 'reject', 'no_investment')),
        completion_mode TEXT NOT NULL
          CHECK (completion_mode IN ('full_round', 'validated_early_stop')),
        early_stop_record_hash TEXT
          CHECK (
            early_stop_record_hash IS NULL
            OR (
              length(early_stop_record_hash) = 71
              AND substr(early_stop_record_hash, 1, 7) = 'sha256:'
              AND substr(early_stop_record_hash, 8) NOT GLOB '*[^0-9a-f]*'
            )
          ),
        skipped_assignment_record_hashes_json TEXT NOT NULL
          CHECK (
            json_valid(skipped_assignment_record_hashes_json)
            AND json_type(skipped_assignment_record_hashes_json) = 'array'
          ),
        next_evidence_action_json TEXT
          CHECK (
            next_evidence_action_json IS NULL
            OR (
              json_valid(next_evidence_action_json)
              AND json_type(next_evidence_action_json) = 'object'
            )
          ),
        comparator_count INTEGER NOT NULL CHECK (comparator_count BETWEEN 0 AND 15),
        estimated_internal_ai_cost_aud_cents INTEGER NOT NULL
          CHECK (estimated_internal_ai_cost_aud_cents BETWEEN 0 AND 200),
        reconciled_internal_ai_cost_aud_cents INTEGER NOT NULL
          CHECK (reconciled_internal_ai_cost_aud_cents BETWEEN 0 AND 200),
        exact_billing_pending INTEGER NOT NULL CHECK (exact_billing_pending IN (0, 1)),
        external_commercial_spend_aud_cents INTEGER NOT NULL
          CHECK (external_commercial_spend_aud_cents = 0),
        provenance_complete INTEGER NOT NULL CHECK (provenance_complete IN (0, 1)),
        unknown_provider_outcome_count INTEGER NOT NULL
          CHECK (unknown_provider_outcome_count >= 0),
        unknown_cost_count INTEGER NOT NULL CHECK (unknown_cost_count >= 0),
        evidence_set_hash TEXT NOT NULL
          CHECK (
            length(evidence_set_hash) = 71
            AND substr(evidence_set_hash, 1, 7) = 'sha256:'
            AND substr(evidence_set_hash, 8) NOT GLOB '*[^0-9a-f]*'
          ),
        receipt_set_hash TEXT NOT NULL
          CHECK (
            length(receipt_set_hash) = 71
            AND substr(receipt_set_hash, 1, 7) = 'sha256:'
            AND substr(receipt_set_hash, 8) NOT GLOB '*[^0-9a-f]*'
          ),
        decision_json TEXT NOT NULL
          CHECK (
            json_valid(decision_json)
            AND json_extract(decision_json, '$.decisionHash') IS decision_hash
            AND json_extract(decision_json, '$.schema') IS decision_schema
            AND json_extract(decision_json, '$.authorityHash') IS authority_hash
            AND json_extract(decision_json, '$.id') IS decision_id
            AND json_extract(decision_json, '$.version') IS decision_version
            AND json_extract(decision_json, '$.outcome') IS outcome
            AND json_extract(decision_json, '$.completionMode') IS completion_mode
            AND json_extract(decision_json, '$.earlyStopRecordHash') IS early_stop_record_hash
            AND json_extract(decision_json, '$.skippedAssignmentRecordHashes')
              IS skipped_assignment_record_hashes_json
            AND json_extract(decision_json, '$.nextEvidenceAction') IS next_evidence_action_json
            AND json_extract(decision_json, '$.comparatorCount') IS comparator_count
            AND json_extract(decision_json, '$.estimatedInternalAiCostAudCents')
              IS estimated_internal_ai_cost_aud_cents
            AND json_extract(decision_json, '$.reconciledInternalAiCostAudCents')
              IS reconciled_internal_ai_cost_aud_cents
            AND json_extract(decision_json, '$.exactBillingPending')
              IS exact_billing_pending
            AND json_extract(decision_json, '$.externalCommercialSpendAudCents')
              IS external_commercial_spend_aud_cents
            AND json_extract(decision_json, '$.provenanceComplete') IS provenance_complete
            AND json_extract(decision_json, '$.unknownProviderOutcomeCount')
              IS unknown_provider_outcome_count
            AND json_extract(decision_json, '$.unknownCostCount') IS unknown_cost_count
            AND json_extract(decision_json, '$.evidenceSetHash') IS evidence_set_hash
            AND json_extract(decision_json, '$.receiptSetHash') IS receipt_set_hash
          ),
        decided_at TEXT NOT NULL CHECK (julianday(decided_at) IS NOT NULL),
        created_at TEXT NOT NULL CHECK (julianday(created_at) IS NOT NULL),
        CHECK (
          estimated_internal_ai_cost_aud_cents + reconciled_internal_ai_cost_aud_cents <= 200
        ),
        CHECK (
          estimated_internal_ai_cost_aud_cents = 0
          OR exact_billing_pending = 1
        ),
        CHECK (
          (
            completion_mode = 'full_round'
            AND early_stop_record_hash IS NULL
            AND skipped_assignment_record_hashes_json = '[]'
            AND next_evidence_action_json IS NULL
            AND comparator_count BETWEEN 10 AND 15
          )
          OR (
            completion_mode = 'validated_early_stop'
            AND early_stop_record_hash IS NOT NULL
            AND outcome = 'research_more'
            AND json_array_length(skipped_assignment_record_hashes_json) BETWEEN 0 AND 2
            AND next_evidence_action_json IS NOT NULL
          )
        ),
        CHECK (
          outcome <> 'build'
          OR (
            provenance_complete = 1
            AND unknown_provider_outcome_count = 0
            AND unknown_cost_count = 0
          )
        ),
        FOREIGN KEY (authority_hash)
          REFERENCES preventure_research_authorities(authority_hash),
        FOREIGN KEY (authority_hash, early_stop_record_hash)
          REFERENCES preventure_research_terminal_stops(authority_hash, early_stop_record_hash)
          DEFERRABLE INITIALLY DEFERRED,
        UNIQUE (authority_hash, decision_id)
      );

      CREATE TABLE IF NOT EXISTS preventure_research_lifecycle_events (
        id TEXT PRIMARY KEY,
        authority_hash TEXT NOT NULL,
        sequence INTEGER NOT NULL CHECK (sequence >= 1),
        previous_event_hash TEXT,
        event_type TEXT NOT NULL
          CHECK (event_type IN (
            'proposed', 'accepted', 'activated', 'completed',
            'revoked', 'expired', 'revised', 'superseded'
          )),
        event_hash TEXT NOT NULL
          CHECK (
            length(event_hash) = 71
            AND substr(event_hash, 1, 7) = 'sha256:'
            AND substr(event_hash, 8) NOT GLOB '*[^0-9a-f]*'
          ),
        approval_id TEXT,
        approval_scope_hash TEXT
          CHECK (
            approval_scope_hash IS NULL
            OR (
              length(approval_scope_hash) = 71
              AND substr(approval_scope_hash, 1, 7) = 'sha256:'
              AND substr(approval_scope_hash, 8) NOT GLOB '*[^0-9a-f]*'
            )
          ),
        actor TEXT NOT NULL,
        reason TEXT NOT NULL,
        metadata TEXT NOT NULL CHECK (json_valid(metadata)),
        decision_hash TEXT,
        successor_authority_hash TEXT,
        event_json TEXT NOT NULL
          CHECK (
            json_valid(event_json)
            AND json_extract(event_json, '$.id') IS id
            AND json_extract(event_json, '$.authorityHash') IS authority_hash
            AND json_extract(event_json, '$.sequence') IS sequence
            AND json_extract(event_json, '$.previousEventHash') IS previous_event_hash
            AND json_extract(event_json, '$.eventType') IS event_type
            AND json_extract(event_json, '$.eventHash') IS event_hash
            AND json_extract(event_json, '$.approvalId') IS approval_id
            AND json_extract(event_json, '$.approvalScopeHash') IS approval_scope_hash
            AND json_extract(event_json, '$.actor') IS actor
            AND json_extract(event_json, '$.reason') IS reason
            AND json_extract(event_json, '$.metadata.decisionHash') IS decision_hash
            AND json_extract(event_json, '$.metadata.successorAuthorityHash')
              IS successor_authority_hash
            AND json_extract(event_json, '$.occurredAt') IS occurred_at
          ),
        occurred_at TEXT NOT NULL CHECK (julianday(occurred_at) IS NOT NULL),
        created_at TEXT NOT NULL CHECK (julianday(created_at) IS NOT NULL),
        UNIQUE (authority_hash, sequence),
        UNIQUE (authority_hash, event_hash),
        UNIQUE (authority_hash, id),
        CHECK (
          (event_type IN ('accepted', 'activated') AND approval_id IS NOT NULL AND approval_scope_hash IS NOT NULL)
          OR (event_type NOT IN ('accepted', 'activated') AND approval_id IS NULL AND approval_scope_hash IS NULL)
        ),
        CHECK ((event_type = 'completed') = (decision_hash IS NOT NULL)),
        CHECK ((event_type IN ('revised', 'superseded')) = (successor_authority_hash IS NOT NULL)),
        FOREIGN KEY (authority_hash)
          REFERENCES preventure_research_authorities(authority_hash),
        FOREIGN KEY (authority_hash, previous_event_hash)
          REFERENCES preventure_research_lifecycle_events(authority_hash, event_hash),
        FOREIGN KEY (approval_id) REFERENCES approvals(id),
        FOREIGN KEY (decision_hash) REFERENCES preventure_research_decisions(decision_hash),
        FOREIGN KEY (successor_authority_hash)
          REFERENCES preventure_research_authorities(authority_hash)
      );

      CREATE TABLE IF NOT EXISTS preventure_research_assignments (
        assignment_hash TEXT PRIMARY KEY
          CHECK (
            length(assignment_hash) = 71
            AND substr(assignment_hash, 1, 7) = 'sha256:'
            AND substr(assignment_hash, 8) NOT GLOB '*[^0-9a-f]*'
          ),
        authority_hash TEXT NOT NULL,
        activation_event_hash TEXT NOT NULL,
        assignment_id TEXT NOT NULL,
        assignment_version TEXT NOT NULL,
        template_hash TEXT NOT NULL,
        workflow_id TEXT NOT NULL,
        task_id TEXT NOT NULL,
        provider_id TEXT NOT NULL,
        provider_model TEXT NOT NULL,
        max_cost_aud_cents INTEGER NOT NULL CHECK (max_cost_aud_cents = 50),
        max_attempts INTEGER NOT NULL CHECK (max_attempts = 1),
        max_tool_calls INTEGER NOT NULL CHECK (max_tool_calls = 2),
        maximum_model_passes INTEGER NOT NULL CHECK (maximum_model_passes = 3),
        max_input_tokens INTEGER NOT NULL CHECK (max_input_tokens = 272000),
        local_prompt_preflight_max_input_tokens INTEGER NOT NULL
          CHECK (local_prompt_preflight_max_input_tokens = 30000),
        max_output_tokens INTEGER NOT NULL CHECK (max_output_tokens = 12000),
        max_turns INTEGER NOT NULL CHECK (max_turns = 1),
        deadline_ms INTEGER NOT NULL CHECK (deadline_ms BETWEEN 5000 AND 180000),
        worst_case_exposure_json TEXT NOT NULL
          CHECK (
            json_valid(worst_case_exposure_json)
            AND json_extract(worst_case_exposure_json, '$.method')
              IS 'integer_ceiling_published_standard_price_v1'
            AND json_extract(worst_case_exposure_json, '$.currency') IS 'AUD'
            AND json_extract(worst_case_exposure_json, '$.amountAudCents') IS max_cost_aud_cents
            AND json_extract(worst_case_exposure_json, '$.maxInputTokensPerModelPass') IS max_input_tokens
            AND json_extract(worst_case_exposure_json, '$.maximumModelPasses') IS maximum_model_passes
            AND json_extract(worst_case_exposure_json, '$.maximumBillableInputTokens') IS 816000
            AND json_extract(worst_case_exposure_json, '$.maxOutputTokens') IS max_output_tokens
            AND json_extract(worst_case_exposure_json, '$.maxToolCalls') IS max_tool_calls
            AND json_extract(worst_case_exposure_json, '$.inputCostUsdMicros') IS 204000
            AND json_extract(worst_case_exposure_json, '$.outputCostUsdMicros') IS 24000
            AND json_extract(worst_case_exposure_json, '$.webSearchCostUsdMicros') IS 20000
            AND json_extract(worst_case_exposure_json, '$.totalCostUsdMicros') IS 248000
            AND json_extract(worst_case_exposure_json, '$.audPerUsdCeilingMicros') IS 2000000
            AND json_extract(worst_case_exposure_json, '$.exactBillingPending') IS 1
          ),
        expires_at TEXT NOT NULL CHECK (julianday(expires_at) IS NOT NULL),
        assignment_json TEXT NOT NULL
          CHECK (
            json_valid(assignment_json)
            AND json_extract(assignment_json, '$.assignmentHash') IS assignment_hash
            AND json_extract(assignment_json, '$.authorityHash') IS authority_hash
            AND json_extract(assignment_json, '$.activationEventHash') IS activation_event_hash
            AND json_extract(assignment_json, '$.id') IS assignment_id
            AND json_extract(assignment_json, '$.version') IS assignment_version
            AND json_extract(assignment_json, '$.templateHash') IS template_hash
            AND json_extract(assignment_json, '$.workflowId') IS workflow_id
            AND json_extract(assignment_json, '$.taskId') IS task_id
            AND json_extract(assignment_json, '$.provider') IS provider_id
            AND json_extract(assignment_json, '$.model') IS provider_model
            AND json_extract(assignment_json, '$.maxCostAudCents') IS max_cost_aud_cents
            AND json_extract(assignment_json, '$.maxAttempts') IS max_attempts
            AND json_extract(assignment_json, '$.maxToolCalls') IS max_tool_calls
            AND json_extract(assignment_json, '$.maximumModelPasses') IS maximum_model_passes
            AND json_extract(assignment_json, '$.maxInputTokens') IS max_input_tokens
            AND json_extract(assignment_json, '$.localPromptPreflightMaxInputTokens')
              IS local_prompt_preflight_max_input_tokens
            AND json_extract(assignment_json, '$.maxOutputTokens') IS max_output_tokens
            AND json_extract(assignment_json, '$.maxTurns') IS max_turns
            AND json_extract(assignment_json, '$.deadlineMs') IS deadline_ms
            AND json_extract(assignment_json, '$.worstCaseExposure') IS worst_case_exposure_json
            AND json_extract(assignment_json, '$.expiresAt') IS expires_at
            AND json_extract(assignment_json, '$.assignedAt') IS assigned_at
          ),
        assigned_at TEXT NOT NULL CHECK (julianday(assigned_at) IS NOT NULL),
        created_at TEXT NOT NULL CHECK (julianday(created_at) IS NOT NULL),
        UNIQUE (authority_hash, assignment_hash),
        FOREIGN KEY (authority_hash)
          REFERENCES preventure_research_authorities(authority_hash),
        FOREIGN KEY (authority_hash, activation_event_hash)
          REFERENCES preventure_research_lifecycle_events(authority_hash, event_hash),
        FOREIGN KEY (workflow_id) REFERENCES workflows(id),
        FOREIGN KEY (task_id) REFERENCES tasks(id)
      );

      CREATE TABLE IF NOT EXISTS preventure_research_cost_events (
        receipt_hash TEXT PRIMARY KEY
          CHECK (
            length(receipt_hash) = 71
            AND substr(receipt_hash, 1, 7) = 'sha256:'
            AND substr(receipt_hash, 8) NOT GLOB '*[^0-9a-f]*'
          ),
        authority_hash TEXT NOT NULL,
        assignment_hash TEXT NOT NULL,
        cost_key TEXT NOT NULL,
        sequence INTEGER NOT NULL CHECK (sequence >= 1),
        previous_receipt_hash TEXT,
        event_type TEXT NOT NULL
          CHECK (event_type IN ('reserved', 'estimated', 'incurred', 'reconciled', 'released', 'unknown')),
        amount_aud_cents INTEGER
          CHECK (amount_aud_cents IS NULL OR amount_aud_cents >= 0),
        exposure_aud_cents INTEGER NOT NULL CHECK (exposure_aud_cents >= 0),
        task_attempt_id TEXT,
        model_call_id TEXT,
        budget_reservation_id TEXT,
        cost_id TEXT,
        agent_run_receipt_id TEXT,
        cost_json TEXT NOT NULL
          CHECK (
            json_valid(cost_json)
            AND json_extract(cost_json, '$.receiptHash') IS receipt_hash
            AND json_extract(cost_json, '$.authorityHash') IS authority_hash
            AND json_extract(cost_json, '$.assignmentHash') IS assignment_hash
            AND json_extract(cost_json, '$.costKey') IS cost_key
            AND json_extract(cost_json, '$.sequence') IS sequence
            AND json_extract(cost_json, '$.previousReceiptHash') IS previous_receipt_hash
            AND json_extract(cost_json, '$.eventType') IS event_type
            AND json_extract(cost_json, '$.amountAudCents') IS amount_aud_cents
            AND json_extract(cost_json, '$.exposureAudCents') IS exposure_aud_cents
            AND json_extract(cost_json, '$.taskAttemptId') IS task_attempt_id
            AND json_extract(cost_json, '$.modelCallId') IS model_call_id
            AND json_extract(cost_json, '$.budgetReservationId') IS budget_reservation_id
            AND json_extract(cost_json, '$.costId') IS cost_id
            AND json_extract(cost_json, '$.agentRunReceiptId') IS agent_run_receipt_id
            AND json_extract(cost_json, '$.occurredAt') IS occurred_at
          ),
        occurred_at TEXT NOT NULL CHECK (julianday(occurred_at) IS NOT NULL),
        created_at TEXT NOT NULL CHECK (julianday(created_at) IS NOT NULL),
        UNIQUE (assignment_hash, cost_key, sequence),
        UNIQUE (assignment_hash, cost_key, receipt_hash),
        CHECK ((event_type = 'unknown') = (amount_aud_cents IS NULL)),
        FOREIGN KEY (authority_hash)
          REFERENCES preventure_research_authorities(authority_hash),
        FOREIGN KEY (assignment_hash)
          REFERENCES preventure_research_assignments(assignment_hash),
        FOREIGN KEY (authority_hash, assignment_hash)
          REFERENCES preventure_research_assignments(authority_hash, assignment_hash),
        FOREIGN KEY (assignment_hash, cost_key, previous_receipt_hash)
          REFERENCES preventure_research_cost_events(assignment_hash, cost_key, receipt_hash),
        FOREIGN KEY (task_attempt_id) REFERENCES task_attempts(id),
        FOREIGN KEY (model_call_id) REFERENCES model_calls(id),
        FOREIGN KEY (budget_reservation_id) REFERENCES budget_reservations(id),
        FOREIGN KEY (cost_id) REFERENCES costs(id),
        FOREIGN KEY (agent_run_receipt_id) REFERENCES agent_run_receipts(id)
      );

      CREATE TABLE IF NOT EXISTS preventure_research_source_snapshots (
        snapshot_hash TEXT PRIMARY KEY
          CHECK (
            length(snapshot_hash) = 71
            AND substr(snapshot_hash, 1, 7) = 'sha256:'
            AND substr(snapshot_hash, 8) NOT GLOB '*[^0-9a-f]*'
          ),
        authority_hash TEXT NOT NULL,
        assignment_hash TEXT NOT NULL,
        source_id TEXT NOT NULL,
        source_version TEXT NOT NULL,
        source_class TEXT NOT NULL,
        source_tier INTEGER NOT NULL CHECK (source_tier BETWEEN 1 AND 4),
        capture_status TEXT NOT NULL
          CHECK (capture_status IN ('captured', 'partial', 'unavailable', 'blocked')),
        url TEXT,
        canonical_url TEXT,
        canonical_host TEXT,
        source_identity_url TEXT,
        source_identity_hash TEXT
          CHECK (
            source_identity_hash IS NULL
            OR (
              length(source_identity_hash) = 71
              AND substr(source_identity_hash, 1, 7) = 'sha256:'
              AND substr(source_identity_hash, 8) NOT GLOB '*[^0-9a-f]*'
            )
          ),
        marketplace_channel_id TEXT
          CHECK (marketplace_channel_id IS NULL OR marketplace_channel_id IN ('etsy', 'gumroad')),
        offer_identity_key TEXT,
        seller_identity_key TEXT CHECK (seller_identity_key IS NULL),
        identity_derivation TEXT
          CHECK (identity_derivation IS NULL OR identity_derivation = 'provider_grounded_url_v1'),
        publisher_identity_key TEXT,
        buyer_independence_group TEXT
          CHECK (
            buyer_independence_group IS NULL
            OR (
              buyer_independence_group = publisher_identity_key
              AND buyer_independence_group GLOB 'public-publisher-host:*'
              AND length(buyer_independence_group) BETWEEN 24 AND 277
            )
          ),
        title TEXT,
        publisher TEXT,
        published_at TEXT CHECK (published_at IS NULL OR julianday(published_at) IS NOT NULL),
        content_hash TEXT,
        content_location TEXT,
        research_run_id TEXT,
        source_record_id TEXT,
        provenance_id TEXT,
        agent_run_receipt_id TEXT,
        limitations_json TEXT NOT NULL
          CHECK (json_valid(limitations_json) AND json_type(limitations_json) = 'array'),
        supersedes_snapshot_hash TEXT,
        retrieved_at TEXT NOT NULL CHECK (julianday(retrieved_at) IS NOT NULL),
        snapshot_json TEXT NOT NULL
          CHECK (
            json_valid(snapshot_json)
            AND json_extract(snapshot_json, '$.snapshotHash') IS snapshot_hash
            AND json_extract(snapshot_json, '$.authorityHash') IS authority_hash
            AND json_extract(snapshot_json, '$.assignmentHash') IS assignment_hash
            AND json_extract(snapshot_json, '$.id') IS source_id
            AND json_extract(snapshot_json, '$.version') IS source_version
            AND json_extract(snapshot_json, '$.sourceClass') IS source_class
            AND json_extract(snapshot_json, '$.sourceTier') IS source_tier
            AND json_extract(snapshot_json, '$.captureStatus') IS capture_status
            AND json_extract(snapshot_json, '$.url') IS url
            AND json_extract(snapshot_json, '$.canonicalUrl') IS canonical_url
            AND json_extract(snapshot_json, '$.canonicalHost') IS canonical_host
            AND json_extract(snapshot_json, '$.sourceIdentityUrl') IS source_identity_url
            AND json_extract(snapshot_json, '$.sourceIdentityHash') IS source_identity_hash
            AND json_extract(snapshot_json, '$.marketplaceChannelId') IS marketplace_channel_id
            AND json_extract(snapshot_json, '$.offerIdentityKey') IS offer_identity_key
            AND json_extract(snapshot_json, '$.sellerIdentityKey') IS seller_identity_key
            AND json_extract(snapshot_json, '$.identityDerivation') IS identity_derivation
            AND json_extract(snapshot_json, '$.publisherIdentityKey') IS publisher_identity_key
            AND json_extract(snapshot_json, '$.buyerIndependenceGroup')
              IS buyer_independence_group
            AND json_extract(snapshot_json, '$.title') IS title
            AND json_extract(snapshot_json, '$.publisher') IS publisher
            AND json_extract(snapshot_json, '$.publishedAt') IS published_at
            AND json_extract(snapshot_json, '$.contentHash') IS content_hash
            AND json_extract(snapshot_json, '$.contentLocation') IS content_location
            AND json_extract(snapshot_json, '$.researchRunId') IS research_run_id
            AND json_extract(snapshot_json, '$.sourceRecordId') IS source_record_id
            AND json_extract(snapshot_json, '$.provenanceId') IS provenance_id
            AND json_extract(snapshot_json, '$.agentRunReceiptId') IS agent_run_receipt_id
            AND json_extract(snapshot_json, '$.limitations') IS limitations_json
            AND json_extract(snapshot_json, '$.supersedesSnapshotHash') IS supersedes_snapshot_hash
            AND json_extract(snapshot_json, '$.retrievedAt') IS retrieved_at
          ),
        created_at TEXT NOT NULL CHECK (julianday(created_at) IS NOT NULL),
        UNIQUE (authority_hash, source_id, source_version),
        UNIQUE (authority_hash, assignment_hash, snapshot_hash),
        CHECK (
          capture_status <> 'captured'
          OR (url IS NOT NULL AND content_hash IS NOT NULL AND content_location IS NOT NULL)
        ),
        CHECK (
          (
            url IS NULL
            AND canonical_url IS NULL
            AND canonical_host IS NULL
            AND source_identity_url IS NULL
            AND source_identity_hash IS NULL
            AND marketplace_channel_id IS NULL
            AND offer_identity_key IS NULL
            AND seller_identity_key IS NULL
            AND identity_derivation IS NULL
            AND publisher_identity_key IS NULL
            AND buyer_independence_group IS NULL
          )
          OR (
            url IS NOT NULL
            AND canonical_url IS NOT NULL
            AND canonical_host IS NOT NULL
            AND source_identity_url IS NOT NULL
            AND source_identity_hash IS NOT NULL
            AND seller_identity_key IS NULL
            AND identity_derivation = 'provider_grounded_url_v1'
            AND publisher_identity_key IS NOT NULL
            AND buyer_independence_group IS NOT NULL
          )
        ),
        FOREIGN KEY (authority_hash)
          REFERENCES preventure_research_authorities(authority_hash),
        FOREIGN KEY (assignment_hash)
          REFERENCES preventure_research_assignments(assignment_hash),
        FOREIGN KEY (authority_hash, assignment_hash)
          REFERENCES preventure_research_assignments(authority_hash, assignment_hash),
        FOREIGN KEY (research_run_id) REFERENCES research_runs(id),
        FOREIGN KEY (source_record_id) REFERENCES research_sources(id),
        FOREIGN KEY (provenance_id) REFERENCES agent_run_provenance(id),
        FOREIGN KEY (agent_run_receipt_id) REFERENCES agent_run_receipts(id),
        FOREIGN KEY (supersedes_snapshot_hash)
          REFERENCES preventure_research_source_snapshots(snapshot_hash)
      );

      CREATE TABLE IF NOT EXISTS preventure_research_evidence_records (
        evidence_hash TEXT PRIMARY KEY
          CHECK (
            length(evidence_hash) = 71
            AND substr(evidence_hash, 1, 7) = 'sha256:'
            AND substr(evidence_hash, 8) NOT GLOB '*[^0-9a-f]*'
          ),
        authority_hash TEXT NOT NULL,
        assignment_hash TEXT NOT NULL,
        evidence_id TEXT NOT NULL,
        evidence_version TEXT NOT NULL,
        source_snapshot_hash TEXT,
        truth_class TEXT NOT NULL
          CHECK (truth_class IN (
            'assumption', 'estimate', 'model_inference', 'observed_fact',
            'owner_attestation', 'owner_preference', 'proven_pantheon_learning', 'unknown'
          )),
        polarity TEXT NOT NULL CHECK (polarity IN ('supporting', 'contrary', 'neutral', 'unknown')),
        question_id TEXT NOT NULL,
        criterion_id TEXT,
        claim TEXT NOT NULL,
        confidence TEXT NOT NULL CHECK (confidence IN ('low', 'medium', 'high', 'unknown')),
        limitations_json TEXT NOT NULL
          CHECK (json_valid(limitations_json) AND json_type(limitations_json) = 'array'),
        supersedes_evidence_hash TEXT,
        evidence_json TEXT NOT NULL
          CHECK (
            json_valid(evidence_json)
            AND json_extract(evidence_json, '$.evidenceHash') IS evidence_hash
            AND json_extract(evidence_json, '$.authorityHash') IS authority_hash
            AND json_extract(evidence_json, '$.assignmentHash') IS assignment_hash
            AND json_extract(evidence_json, '$.id') IS evidence_id
            AND json_extract(evidence_json, '$.version') IS evidence_version
            AND json_extract(evidence_json, '$.sourceSnapshotHash') IS source_snapshot_hash
            AND json_extract(evidence_json, '$.truthClass') IS truth_class
            AND json_extract(evidence_json, '$.polarity') IS polarity
            AND json_extract(evidence_json, '$.questionId') IS question_id
            AND json_extract(evidence_json, '$.criterionId') IS criterion_id
            AND json_extract(evidence_json, '$.claim') IS claim
            AND json_extract(evidence_json, '$.confidence') IS confidence
            AND json_extract(evidence_json, '$.limitations') IS limitations_json
            AND json_extract(evidence_json, '$.supersedesEvidenceHash') IS supersedes_evidence_hash
            AND json_extract(evidence_json, '$.capturedAt') IS captured_at
          ),
        captured_at TEXT NOT NULL CHECK (julianday(captured_at) IS NOT NULL),
        created_at TEXT NOT NULL CHECK (julianday(created_at) IS NOT NULL),
        UNIQUE (authority_hash, evidence_id, evidence_version),
        CHECK (truth_class <> 'observed_fact' OR source_snapshot_hash IS NOT NULL),
        FOREIGN KEY (authority_hash)
          REFERENCES preventure_research_authorities(authority_hash),
        FOREIGN KEY (assignment_hash)
          REFERENCES preventure_research_assignments(assignment_hash),
        FOREIGN KEY (authority_hash, assignment_hash)
          REFERENCES preventure_research_assignments(authority_hash, assignment_hash),
        FOREIGN KEY (authority_hash, assignment_hash, source_snapshot_hash)
          REFERENCES preventure_research_source_snapshots(
            authority_hash, assignment_hash, snapshot_hash
          ),
        FOREIGN KEY (supersedes_evidence_hash)
          REFERENCES preventure_research_evidence_records(evidence_hash)
      );
    `);
    db.exec(PREVENTURE_RESEARCH_TERMINAL_RECOVERY_TABLE_SQL);
    db.exec(PREVENTURE_RESEARCH_OWNER_BILLING_OBSERVATION_TABLE_SQL);
    db.exec(PREVENTURE_RESEARCH_TERMINAL_STOP_TABLE_SQL);
    for (const triggerName of Object.keys(PREVENTURE_RESEARCH_OWNERSHIP_TRIGGER_SQL)) {
      db.exec(`DROP TRIGGER IF EXISTS ${triggerName}`);
    }
    db.exec(Object.values(PREVENTURE_RESEARCH_OWNERSHIP_TRIGGER_SQL).join(";\n"));
    db.exec(Object.values(PREVENTURE_RESEARCH_REQUIRED_INDEX_SQL).join(";\n"));
    db.exec(Object.values(PREVENTURE_RESEARCH_IMMUTABLE_TRIGGER_SQL).join(";\n"));
    db.exec(Object.values(PREVENTURE_RESEARCH_GUARD_TRIGGER_SQL).join(";\n"));
    recordMigration(db, 27, "pre-venture-research-authority-ledger");
    commitAtomic(db);
  } catch (error) {
    rollbackAtomic(db);
    throw error;
  }
}

function migrate(db, options = {}) {
  const migrationTable = get(
    db,
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'",
  );
  const currentVersion = migrationTable
    ? Number(get(
        db,
        "SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations",
      )?.version || 0)
    : 0;
  if (currentVersion > LATEST_SCHEMA_VERSION) {
    throw new Error(`Runtime schema ${currentVersion} is newer than supported schema ${LATEST_SCHEMA_VERSION}.`);
  }
  if (currentVersion === LATEST_SCHEMA_VERSION) return;

  const reservedCandidateObjects = all(
    db,
    `SELECT type, name FROM sqlite_master
     WHERE name GLOB 'preventure_research_*'
        OR name GLOB 'trg_preventure_research_*'
        OR name GLOB 'idx_preventure_research_*'
        OR name IN (
          'idx_task_attempts_one_running_per_task',
          'trg_commercial_test_lifecycle_preventure_approval_insert'
        )
     ORDER BY type, name`,
  );
  const approvalsHasCandidateColumn = Boolean(get(
    db,
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'approvals'",
  )) && tableColumns(db, "approvals").has("decided_by");
  if (reservedCandidateObjects.length > 0 || approvalsHasCandidateColumn) {
    const names = reservedCandidateObjects.map((item) => item.name);
    if (approvalsHasCandidateColumn) names.push("approvals.decided_by");
    throw new Error(
      `Runtime schema ${currentVersion} contains unreleased schema-27 object(s): ${names.join(", ")}.`,
    );
  }

  beginAtomic(db);
  try {
    db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);
  if (!migrationApplied(db, 1)) {
    beginAtomic(db);
    try {
      db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ventures (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      stage INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL,
      summary TEXT NOT NULL DEFAULT '',
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS commands (
      id TEXT PRIMARY KEY,
      source TEXT NOT NULL,
      raw_text TEXT NOT NULL,
      intent TEXT NOT NULL,
      status TEXT NOT NULL,
      workflow_id TEXT,
      summary TEXT NOT NULL DEFAULT '',
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (workflow_id) REFERENCES workflows(id)
    );

    CREATE TABLE IF NOT EXISTS workflows (
      id TEXT PRIMARY KEY,
      venture_id TEXT,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      status TEXT NOT NULL,
      current_step TEXT NOT NULL DEFAULT '',
      priority INTEGER NOT NULL DEFAULT 3,
      quality_score INTEGER NOT NULL DEFAULT 0,
      expected_profit_cents INTEGER NOT NULL DEFAULT 0,
      cost_estimate_cents INTEGER NOT NULL DEFAULT 0,
      approval_required INTEGER NOT NULL DEFAULT 0,
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (venture_id) REFERENCES ventures(id)
    );

    CREATE TABLE IF NOT EXISTS workflow_runs (
      id TEXT PRIMARY KEY,
      workflow_id TEXT,
      mode TEXT NOT NULL,
      status TEXT NOT NULL,
      stopped_by TEXT,
      steps_run INTEGER NOT NULL DEFAULT 0,
      started_at TEXT NOT NULL,
      completed_at TEXT,
      metadata TEXT NOT NULL DEFAULT '{}',
      FOREIGN KEY (workflow_id) REFERENCES workflows(id)
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      workflow_id TEXT,
      title TEXT NOT NULL,
      kind TEXT NOT NULL,
      agent TEXT NOT NULL,
      status TEXT NOT NULL,
      priority INTEGER NOT NULL DEFAULT 3,
      retries INTEGER NOT NULL DEFAULT 0,
      max_retries INTEGER NOT NULL DEFAULT 2,
      approval_id TEXT,
      cost_budget_cents INTEGER NOT NULL DEFAULT 0,
      cost_actual_cents INTEGER NOT NULL DEFAULT 0,
      payload TEXT NOT NULL DEFAULT '{}',
      result TEXT NOT NULL DEFAULT '{}',
      error TEXT,
      due_at TEXT,
      started_at TEXT,
      completed_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (workflow_id) REFERENCES workflows(id)
    );

    CREATE TABLE IF NOT EXISTS approvals (
      id TEXT PRIMARY KEY,
      workflow_id TEXT,
      scope TEXT NOT NULL,
      title TEXT NOT NULL,
      status TEXT NOT NULL,
      risk_level TEXT NOT NULL DEFAULT 'medium',
      requested_by TEXT NOT NULL,
      requested_at TEXT NOT NULL,
      decided_at TEXT,
      decision_note TEXT,
      payload TEXT NOT NULL DEFAULT '{}',
      FOREIGN KEY (workflow_id) REFERENCES workflows(id)
    );

    CREATE TABLE IF NOT EXISTS deliverables (
      id TEXT PRIMARY KEY,
      workflow_id TEXT,
      command_id TEXT,
      task_id TEXT,
      title TEXT NOT NULL,
      human_name TEXT NOT NULL,
      audience TEXT NOT NULL,
      format TEXT NOT NULL,
      status TEXT NOT NULL,
      file_path TEXT,
      summary TEXT NOT NULL DEFAULT '',
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (workflow_id) REFERENCES workflows(id),
      FOREIGN KEY (command_id) REFERENCES commands(id),
      FOREIGN KEY (task_id) REFERENCES tasks(id)
    );

    CREATE TABLE IF NOT EXISTS model_calls (
      id TEXT PRIMARY KEY,
      workflow_id TEXT,
      task_id TEXT,
      provider TEXT NOT NULL,
      model_class TEXT NOT NULL,
      selected_model TEXT NOT NULL,
      mode TEXT NOT NULL,
      status TEXT NOT NULL,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      estimated_cost_cents INTEGER NOT NULL DEFAULT 0,
      actual_cost_cents INTEGER NOT NULL DEFAULT 0,
      approval_required INTEGER NOT NULL DEFAULT 0,
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      FOREIGN KEY (workflow_id) REFERENCES workflows(id),
      FOREIGN KEY (task_id) REFERENCES tasks(id)
    );

    CREATE TABLE IF NOT EXISTS research_runs (
      id TEXT PRIMARY KEY,
      workflow_id TEXT,
      task_id TEXT,
      query TEXT NOT NULL,
      provider TEXT NOT NULL,
      mode TEXT NOT NULL,
      status TEXT NOT NULL,
      budget_cents INTEGER NOT NULL DEFAULT 0,
      actual_cents INTEGER NOT NULL DEFAULT 0,
      summary TEXT NOT NULL DEFAULT '',
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      completed_at TEXT,
      FOREIGN KEY (workflow_id) REFERENCES workflows(id),
      FOREIGN KEY (task_id) REFERENCES tasks(id)
    );

    CREATE TABLE IF NOT EXISTS research_sources (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      title TEXT NOT NULL,
      url TEXT,
      publisher TEXT,
      published_at TEXT,
      retrieved_at TEXT NOT NULL,
      relevance TEXT NOT NULL DEFAULT '',
      confidence TEXT NOT NULL DEFAULT 'unknown',
      metadata TEXT NOT NULL DEFAULT '{}',
      FOREIGN KEY (run_id) REFERENCES research_runs(id)
    );

    CREATE TABLE IF NOT EXISTS monitor_runs (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      severity TEXT NOT NULL,
      finding_count INTEGER NOT NULL DEFAULT 0,
      started_at TEXT NOT NULL,
      completed_at TEXT,
      metadata TEXT NOT NULL DEFAULT '{}'
    );

    CREATE TABLE IF NOT EXISTS monitor_findings (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      severity TEXT NOT NULL,
      category TEXT NOT NULL,
      entity_type TEXT,
      entity_id TEXT,
      title TEXT NOT NULL,
      detail TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL,
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      FOREIGN KEY (run_id) REFERENCES monitor_runs(id)
    );

    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts TEXT NOT NULL,
      level TEXT NOT NULL,
      actor TEXT NOT NULL,
      type TEXT NOT NULL,
      entity_type TEXT,
      entity_id TEXT,
      message TEXT NOT NULL,
      metadata TEXT NOT NULL DEFAULT '{}'
    );

    CREATE TABLE IF NOT EXISTS costs (
      id TEXT PRIMARY KEY,
      workflow_id TEXT,
      category TEXT NOT NULL,
      source TEXT NOT NULL,
      status TEXT NOT NULL,
      amount_cents INTEGER NOT NULL,
      currency TEXT NOT NULL DEFAULT 'AUD',
      occurred_at TEXT NOT NULL,
      metadata TEXT NOT NULL DEFAULT '{}',
      FOREIGN KEY (workflow_id) REFERENCES workflows(id)
    );

    CREATE TABLE IF NOT EXISTS revenue (
      id TEXT PRIMARY KEY,
      venture_id TEXT,
      source TEXT NOT NULL,
      status TEXT NOT NULL,
      amount_cents INTEGER NOT NULL,
      currency TEXT NOT NULL DEFAULT 'AUD',
      occurred_at TEXT NOT NULL,
      metadata TEXT NOT NULL DEFAULT '{}',
      FOREIGN KEY (venture_id) REFERENCES ventures(id)
    );

    CREATE TABLE IF NOT EXISTS commercial_experiments (
      id TEXT PRIMARY KEY,
      workflow_id TEXT,
      venture_id TEXT,
      name TEXT NOT NULL,
      status TEXT NOT NULL,
      hypothesis TEXT NOT NULL DEFAULT '',
      buyer TEXT NOT NULL DEFAULT '',
      offer TEXT NOT NULL DEFAULT '',
      channel TEXT NOT NULL DEFAULT '',
      price_cents INTEGER NOT NULL DEFAULT 0,
      expected_metric TEXT NOT NULL DEFAULT '',
      target_value REAL NOT NULL DEFAULT 0,
      target_unit TEXT NOT NULL DEFAULT '',
      cost_cap_cents INTEGER NOT NULL DEFAULT 0,
      started_at TEXT,
      ended_at TEXT,
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (workflow_id) REFERENCES workflows(id),
      FOREIGN KEY (venture_id) REFERENCES ventures(id)
    );

    CREATE TABLE IF NOT EXISTS commercial_briefs (
      id TEXT PRIMARY KEY,
      workflow_id TEXT,
      venture_id TEXT,
      source TEXT NOT NULL,
      status TEXT NOT NULL,
      title TEXT NOT NULL,
      idea TEXT NOT NULL DEFAULT '',
      buyer TEXT NOT NULL DEFAULT '',
      problem TEXT NOT NULL DEFAULT '',
      evidence_summary TEXT NOT NULL DEFAULT '',
      research_basis TEXT NOT NULL DEFAULT '',
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (workflow_id) REFERENCES workflows(id),
      FOREIGN KEY (venture_id) REFERENCES ventures(id)
    );

    CREATE TABLE IF NOT EXISTS commercial_test_candidates (
      id TEXT PRIMARY KEY,
      brief_id TEXT NOT NULL,
      workflow_id TEXT,
      venture_id TEXT,
      rank INTEGER NOT NULL,
      status TEXT NOT NULL,
      title TEXT NOT NULL,
      buyer TEXT NOT NULL DEFAULT '',
      problem TEXT NOT NULL DEFAULT '',
      offer TEXT NOT NULL DEFAULT '',
      channel TEXT NOT NULL DEFAULT '',
      price_cents INTEGER NOT NULL DEFAULT 0,
      gross_margin_cents INTEGER NOT NULL DEFAULT 0,
      cost_cap_cents INTEGER NOT NULL DEFAULT 0,
      evidence_score INTEGER NOT NULL DEFAULT 0,
      confidence TEXT NOT NULL DEFAULT 'low',
      hypothesis TEXT NOT NULL DEFAULT '',
      smallest_action TEXT NOT NULL DEFAULT '',
      expected_metric TEXT NOT NULL DEFAULT '',
      target_value REAL NOT NULL DEFAULT 0,
      target_unit TEXT NOT NULL DEFAULT '',
      success_metric TEXT NOT NULL DEFAULT '',
      kill_criteria TEXT NOT NULL DEFAULT '',
      risk TEXT NOT NULL DEFAULT 'low',
      rationale TEXT NOT NULL DEFAULT '',
      promoted_experiment_id TEXT,
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (brief_id) REFERENCES commercial_briefs(id),
      FOREIGN KEY (workflow_id) REFERENCES workflows(id),
      FOREIGN KEY (venture_id) REFERENCES ventures(id),
      FOREIGN KEY (promoted_experiment_id) REFERENCES commercial_experiments(id)
    );

    CREATE TABLE IF NOT EXISTS commercial_results (
      id TEXT PRIMARY KEY,
      experiment_id TEXT,
      workflow_id TEXT,
      source TEXT NOT NULL,
      status TEXT NOT NULL,
      views INTEGER NOT NULL DEFAULT 0,
      clicks INTEGER NOT NULL DEFAULT 0,
      leads INTEGER NOT NULL DEFAULT 0,
      sales INTEGER NOT NULL DEFAULT 0,
      refunds INTEGER NOT NULL DEFAULT 0,
      revenue_cents INTEGER NOT NULL DEFAULT 0,
      spend_cents INTEGER NOT NULL DEFAULT 0,
      time_spent_minutes INTEGER NOT NULL DEFAULT 0,
      notes TEXT NOT NULL DEFAULT '',
      occurred_at TEXT NOT NULL,
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      FOREIGN KEY (experiment_id) REFERENCES commercial_experiments(id),
      FOREIGN KEY (workflow_id) REFERENCES workflows(id)
    );

    CREATE TABLE IF NOT EXISTS commercial_feedback (
      id TEXT PRIMARY KEY,
      experiment_id TEXT,
      workflow_id TEXT,
      source TEXT NOT NULL,
      sentiment TEXT NOT NULL,
      rating INTEGER,
      summary TEXT NOT NULL DEFAULT '',
      objection TEXT NOT NULL DEFAULT '',
      request TEXT NOT NULL DEFAULT '',
      occurred_at TEXT NOT NULL,
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      FOREIGN KEY (experiment_id) REFERENCES commercial_experiments(id),
      FOREIGN KEY (workflow_id) REFERENCES workflows(id)
    );

    CREATE TABLE IF NOT EXISTS commercial_learning_cycles (
      id TEXT PRIMARY KEY,
      experiment_id TEXT,
      workflow_id TEXT,
      status TEXT NOT NULL,
      verdict TEXT NOT NULL,
      hypothesis TEXT NOT NULL DEFAULT '',
      expected_metric TEXT NOT NULL DEFAULT '',
      actual_result TEXT NOT NULL DEFAULT '',
      learning TEXT NOT NULL DEFAULT '',
      improvement TEXT NOT NULL DEFAULT '',
      next_action TEXT NOT NULL DEFAULT '',
      confidence TEXT NOT NULL DEFAULT 'low',
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      FOREIGN KEY (experiment_id) REFERENCES commercial_experiments(id),
      FOREIGN KEY (workflow_id) REFERENCES workflows(id)
    );

    CREATE TABLE IF NOT EXISTS commercial_execution_packs (
      id TEXT PRIMARY KEY,
      experiment_id TEXT NOT NULL,
      candidate_id TEXT,
      brief_id TEXT,
      workflow_id TEXT,
      venture_id TEXT,
      status TEXT NOT NULL,
      title TEXT NOT NULL,
      offer_page_copy TEXT NOT NULL DEFAULT '',
      product_description TEXT NOT NULL DEFAULT '',
      cta TEXT NOT NULL DEFAULT '',
      channel_plan TEXT NOT NULL DEFAULT '',
      tracking_plan TEXT NOT NULL DEFAULT '',
      result_checklist TEXT NOT NULL DEFAULT '',
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (experiment_id) REFERENCES commercial_experiments(id),
      FOREIGN KEY (candidate_id) REFERENCES commercial_test_candidates(id),
      FOREIGN KEY (brief_id) REFERENCES commercial_briefs(id),
      FOREIGN KEY (workflow_id) REFERENCES workflows(id),
      FOREIGN KEY (venture_id) REFERENCES ventures(id)
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      task_id TEXT,
      severity TEXT NOT NULL,
      status TEXT NOT NULL,
      subject TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL,
      resolved_at TEXT,
      metadata TEXT NOT NULL DEFAULT '{}',
      FOREIGN KEY (task_id) REFERENCES tasks(id)
    );

    CREATE TABLE IF NOT EXISTS notification_outbox (
      id TEXT PRIMARY KEY,
      message_id TEXT,
      approval_id TEXT,
      channel TEXT NOT NULL,
      recipient TEXT,
      subject TEXT NOT NULL,
      body TEXT NOT NULL,
      status TEXT NOT NULL,
      provider TEXT NOT NULL DEFAULT 'dry-run',
      mode TEXT NOT NULL DEFAULT 'dry-run',
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      sent_at TEXT,
      FOREIGN KEY (message_id) REFERENCES messages(id),
      FOREIGN KEY (approval_id) REFERENCES approvals(id)
    );

    CREATE TABLE IF NOT EXISTS inbound_messages (
      id TEXT PRIMARY KEY,
      channel TEXT NOT NULL,
      provider TEXT NOT NULL DEFAULT 'dry-run',
      sender TEXT,
      subject TEXT NOT NULL DEFAULT '',
      body TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL,
      approval_id TEXT,
      decision TEXT,
      received_at TEXT NOT NULL,
      processed_at TEXT,
      metadata TEXT NOT NULL DEFAULT '{}',
      FOREIGN KEY (approval_id) REFERENCES approvals(id)
    );

    CREATE TABLE IF NOT EXISTS approval_action_tokens (
      id TEXT PRIMARY KEY,
      approval_id TEXT NOT NULL,
      decision TEXT NOT NULL,
      token TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      used_at TEXT,
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      FOREIGN KEY (approval_id) REFERENCES approvals(id)
    );

    CREATE TABLE IF NOT EXISTS agent_definitions (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      role TEXT NOT NULL,
      status TEXT NOT NULL,
      mode TEXT NOT NULL,
      model_class TEXT NOT NULL,
      instructions TEXT NOT NULL DEFAULT '',
      tools TEXT NOT NULL DEFAULT '[]',
      guardrails TEXT NOT NULL DEFAULT '[]',
      handoff_targets TEXT NOT NULL DEFAULT '[]',
      input_contract TEXT NOT NULL DEFAULT '{}',
      output_contract TEXT NOT NULL DEFAULT '{}',
      approval_policy TEXT NOT NULL DEFAULT '{}',
      eval_criteria TEXT NOT NULL DEFAULT '[]',
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS agent_tools (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      status TEXT NOT NULL,
      mode TEXT NOT NULL,
      risk_level TEXT NOT NULL DEFAULT 'low',
      dry_run_available INTEGER NOT NULL DEFAULT 1,
      requires_approval INTEGER NOT NULL DEFAULT 0,
      external_action INTEGER NOT NULL DEFAULT 0,
      spend_possible INTEGER NOT NULL DEFAULT 0,
      hard_stop INTEGER NOT NULL DEFAULT 0,
      approval_scope TEXT,
      integration_id TEXT,
      provider_capability TEXT,
      live_flag TEXT,
      description TEXT NOT NULL DEFAULT '',
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (integration_id) REFERENCES integrations(id)
    );

    CREATE TABLE IF NOT EXISTS agent_tool_assignments (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      tool_id TEXT NOT NULL,
      status TEXT NOT NULL,
      permission TEXT NOT NULL,
      approval_scope TEXT,
      cost_cap_cents INTEGER NOT NULL DEFAULT 0,
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(agent_id, tool_id),
      FOREIGN KEY (agent_id) REFERENCES agent_definitions(id),
      FOREIGN KEY (tool_id) REFERENCES agent_tools(id)
    );

    CREATE TABLE IF NOT EXISTS agent_tool_invocations (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      run_id TEXT,
      task_id TEXT,
      workflow_id TEXT,
      tool_id TEXT NOT NULL,
      assignment_id TEXT,
      approval_id TEXT,
      requested_mode TEXT NOT NULL,
      status TEXT NOT NULL,
      decision TEXT NOT NULL,
      permission TEXT NOT NULL,
      risk_level TEXT NOT NULL DEFAULT 'medium',
      input_summary TEXT NOT NULL DEFAULT '',
      output_summary TEXT NOT NULL DEFAULT '',
      metadata TEXT NOT NULL DEFAULT '{}',
      requested_at TEXT NOT NULL,
      resolved_at TEXT,
      FOREIGN KEY (agent_id) REFERENCES agent_definitions(id),
      FOREIGN KEY (run_id) REFERENCES agent_runs(id),
      FOREIGN KEY (task_id) REFERENCES tasks(id),
      FOREIGN KEY (workflow_id) REFERENCES workflows(id),
      FOREIGN KEY (tool_id) REFERENCES agent_tools(id),
      FOREIGN KEY (assignment_id) REFERENCES agent_tool_assignments(id),
      FOREIGN KEY (approval_id) REFERENCES approvals(id)
    );

    CREATE TABLE IF NOT EXISTS agent_runs (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      workflow_id TEXT,
      task_id TEXT,
      mode TEXT NOT NULL,
      status TEXT NOT NULL,
      input_summary TEXT NOT NULL DEFAULT '',
      output_summary TEXT NOT NULL DEFAULT '',
      model_call_id TEXT,
      estimated_cost_cents INTEGER NOT NULL DEFAULT 0,
      actual_cost_cents INTEGER NOT NULL DEFAULT 0,
      approval_required INTEGER NOT NULL DEFAULT 0,
      handoff_to TEXT,
      eval_status TEXT NOT NULL DEFAULT 'not_evaluated',
      metadata TEXT NOT NULL DEFAULT '{}',
      started_at TEXT NOT NULL,
      completed_at TEXT,
      FOREIGN KEY (agent_id) REFERENCES agent_definitions(id),
      FOREIGN KEY (workflow_id) REFERENCES workflows(id),
      FOREIGN KEY (task_id) REFERENCES tasks(id),
      FOREIGN KEY (model_call_id) REFERENCES model_calls(id)
    );

    CREATE TABLE IF NOT EXISTS agent_trace_events (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      sequence INTEGER NOT NULL,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      detail TEXT NOT NULL DEFAULT '',
      metadata TEXT NOT NULL DEFAULT '{}',
      ts TEXT NOT NULL,
      FOREIGN KEY (run_id) REFERENCES agent_runs(id)
    );

    CREATE TABLE IF NOT EXISTS agent_eval_results (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      task_id TEXT,
      status TEXT NOT NULL,
      score INTEGER NOT NULL DEFAULT 0,
      criteria TEXT NOT NULL DEFAULT '[]',
      findings TEXT NOT NULL DEFAULT '[]',
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      FOREIGN KEY (run_id) REFERENCES agent_runs(id),
      FOREIGN KEY (agent_id) REFERENCES agent_definitions(id),
      FOREIGN KEY (task_id) REFERENCES tasks(id)
    );

    CREATE TABLE IF NOT EXISTS agent_eval_datasets (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      name TEXT NOT NULL,
      purpose TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL,
      minimum_cases INTEGER NOT NULL DEFAULT 1,
      pass_score INTEGER NOT NULL DEFAULT 80,
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (agent_id) REFERENCES agent_definitions(id)
    );

    CREATE TABLE IF NOT EXISTS agent_eval_cases (
      id TEXT PRIMARY KEY,
      dataset_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      title TEXT NOT NULL,
      input_summary TEXT NOT NULL DEFAULT '',
      expected_output TEXT NOT NULL DEFAULT '',
      criteria TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL,
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (dataset_id) REFERENCES agent_eval_datasets(id),
      FOREIGN KEY (agent_id) REFERENCES agent_definitions(id)
    );

    CREATE TABLE IF NOT EXISTS agent_model_readiness_packs (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL,
      readiness_score INTEGER NOT NULL DEFAULT 0,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      instructions_packet TEXT NOT NULL DEFAULT '{}',
      input_contract TEXT NOT NULL DEFAULT '{}',
      output_contract TEXT NOT NULL DEFAULT '{}',
      tool_plan TEXT NOT NULL DEFAULT '{}',
      approval_rules TEXT NOT NULL DEFAULT '{}',
      eval_plan TEXT NOT NULL DEFAULT '{}',
      fixtures TEXT NOT NULL DEFAULT '[]',
      failure_cases TEXT NOT NULL DEFAULT '[]',
      readiness_checks TEXT NOT NULL DEFAULT '[]',
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (agent_id) REFERENCES agent_definitions(id)
    );

    CREATE TABLE IF NOT EXISTS agent_model_comparison_packets (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      pack_id TEXT NOT NULL,
      workflow_id TEXT NOT NULL UNIQUE,
      task_id TEXT,
      approval_id TEXT,
      status TEXT NOT NULL,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      estimated_cost_cents INTEGER NOT NULL DEFAULT 0,
      currency TEXT NOT NULL DEFAULT 'AUD',
      fixture_id TEXT,
      fixture_title TEXT,
      protected_baseline TEXT NOT NULL DEFAULT '{}',
      comparison_plan TEXT NOT NULL DEFAULT '{}',
      eval_plan TEXT NOT NULL DEFAULT '{}',
      operator_decision TEXT NOT NULL DEFAULT '{}',
      hard_stops TEXT NOT NULL DEFAULT '[]',
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (agent_id) REFERENCES agent_definitions(id),
      FOREIGN KEY (pack_id) REFERENCES agent_model_readiness_packs(id),
      FOREIGN KEY (workflow_id) REFERENCES workflows(id),
      FOREIGN KEY (task_id) REFERENCES tasks(id),
      FOREIGN KEY (approval_id) REFERENCES approvals(id)
    );

    CREATE TABLE IF NOT EXISTS agent_handoffs (
      id TEXT PRIMARY KEY,
      workflow_id TEXT,
      task_id TEXT,
      from_run_id TEXT NOT NULL,
      from_agent_id TEXT NOT NULL,
      to_agent_id TEXT NOT NULL,
      status TEXT NOT NULL,
      reason TEXT NOT NULL DEFAULT '',
      summary TEXT NOT NULL DEFAULT '',
      decision_needed TEXT NOT NULL DEFAULT '',
      risk_level TEXT NOT NULL DEFAULT 'medium',
      approval_required INTEGER NOT NULL DEFAULT 0,
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      resolved_at TEXT,
      FOREIGN KEY (workflow_id) REFERENCES workflows(id),
      FOREIGN KEY (task_id) REFERENCES tasks(id),
      FOREIGN KEY (from_run_id) REFERENCES agent_runs(id),
      FOREIGN KEY (from_agent_id) REFERENCES agent_definitions(id),
      FOREIGN KEY (to_agent_id) REFERENCES agent_definitions(id)
    );

    CREATE TABLE IF NOT EXISTS integrations (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      kind TEXT NOT NULL,
      status TEXT NOT NULL,
      mode TEXT NOT NULL,
      health TEXT NOT NULL DEFAULT 'unknown',
      last_checked_at TEXT,
      metadata TEXT NOT NULL DEFAULT '{}',
      updated_at TEXT NOT NULL
    );


    CREATE TABLE IF NOT EXISTS scheduler_jobs (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      kind TEXT NOT NULL,
      status TEXT NOT NULL,
      interval_seconds INTEGER NOT NULL DEFAULT 900,
      priority INTEGER NOT NULL DEFAULT 3,
      next_run_at TEXT,
      last_run_at TEXT,
      locked_at TEXT,
      lock_owner TEXT,
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS scheduler_runs (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL,
      status TEXT NOT NULL,
      started_at TEXT NOT NULL,
      completed_at TEXT,
      result TEXT NOT NULL DEFAULT '{}',
      error TEXT,
      metadata TEXT NOT NULL DEFAULT '{}',
      FOREIGN KEY (job_id) REFERENCES scheduler_jobs(id)
    );


    CREATE TABLE IF NOT EXISTS venture_scorecards (
      id TEXT PRIMARY KEY,
      venture_id TEXT,
      workflow_id TEXT NOT NULL UNIQUE,
      command_id TEXT,
      channel TEXT NOT NULL,
      subject TEXT NOT NULL,
      status TEXT NOT NULL,
      verdict TEXT NOT NULL,
      recommendation TEXT NOT NULL,
      total_score INTEGER NOT NULL,
      confidence TEXT NOT NULL,
      dimensions TEXT NOT NULL DEFAULT '{}',
      risks TEXT NOT NULL DEFAULT '[]',
      next_actions TEXT NOT NULL DEFAULT '[]',
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (venture_id) REFERENCES ventures(id),
      FOREIGN KEY (workflow_id) REFERENCES workflows(id),
      FOREIGN KEY (command_id) REFERENCES commands(id)
    );
    `);
    run(
      db,
      `UPDATE workflows
       SET current_step = 'ready for dry-run agent execution'
       WHERE status = 'planned' AND current_step = 'waiting for agent runner implementation'`,
    );
      recordMigration(db, 1, "initial-runtime-schema");
      commitAtomic(db);
    } catch (error) {
      rollbackAtomic(db);
      throw error;
    }
  }
  applyFoundationMigration(db);
  applyPilotEvidenceMigration(db);
  applyVentureOwnershipMigration(db);
  applyExecutiveDigestMigration(db);
  applyLegacyDemoSanitizationMigration(db);
  applyLegacyReviewQueueMigration(db);
  applyLegacyNotificationCleanupMigration(db);
  applyHistoricalWorkArchiveMigration(db);
  applyAccountingLedgerMigration(db);
  applyCommercialDataTruthMigration(db);
  applyAgentOperationsEvidenceMigration(db);
  applyAgentContextMigration(db);
  applyDeliverableQualityReviewMigration(db);
  applyDataRetentionPolicyMigration(db);
  applyExecutionEvidenceBindingMigration(db);
  applyProviderAttemptReceiptBackfillMigration(db);
  applyStableSpendCostIdMigration(db);
  applyPantheonCommercialOperatingModelMigration(db);
  applyRetentionActivationLedgerMigration(db);
  applyFullJourneyMigration(db);
  applyCommercialIntelligenceMigration(db);
  applyRuntimeStopEvidenceMigration(db);
  applyModelCallCompletionTruthMigration(db);
  applyCommercialTestEvidenceLedgerMigration(db);
  applyCanonicalCommercialTruthReconciliationMigration(db);
  applyPreventureResearchAuthorityMigration(db);
    if (options.verifyBeforeCommit !== false) verifyDatabase(db);
    commitAtomic(db);
  } catch (error) {
    rollbackAtomic(db);
    throw error;
  }
}

function putSetting(db, key, value) {
  run(
    db,
    `INSERT INTO settings (key, value, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    [key, toJson(value), now()],
  );
}

function insertEvent(db, event) {
  run(
    db,
    `INSERT INTO events (ts, level, actor, type, entity_type, entity_id, message, metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      event.ts || now(),
      event.level || "info",
      event.actor || "runtime",
      event.type || "event",
      event.entityType || null,
      event.entityId || null,
      event.message,
      toJson(event.metadata),
    ],
  );
}

function seedDatabase(db, options = {}) {
  const existing = get(db, "SELECT value FROM settings WHERE key = ?", ["runtime.initialized"]);
  if (existing) return false;

  beginAtomic(db);
  try {
  const ts = now();
  const includeDemoProof = options.includeDemoProof === true;
  putSetting(db, "operator.preferences", {
    noCodeTouch: true,
    dashboardFirst: true,
    urgentChannels: ["email", "dashboard"],
    optionalChannels: ["slack", "clickup"],
  });
  putSetting(db, "autonomy", {
    stage: CONFIG.autonomyStage,
    promotionApprovalRate: CONFIG.targetFirstPassApprovalRate,
    capabilityPromotionMinimumRuns: 5,
    promotionMinimumApprovals: 5,
    exactCapabilityOnly: true,
    globalAgentPromotionDisabled: true,
    liveExternalActionsRequireApproval: true,
  });
  putSetting(db, "budget", {
    monthlyBudgetCents: CONFIG.monthlyBudgetCents,
    currency: CONFIG.currency,
    spendRequiresApproval: true,
    notes: "Pre-revenue cap: A$100/month. Each live AI run and market test also has its own explicit cap.",
  });
  putSetting(db, "operator.workload", {
    targetMinutesPerWeek: 480,
    intensiveWeekMaximumMinutes: 960,
    intensiveWeekRequiresApproval: true,
    timeValueCentsPerHour: 5000,
    longTermMode: "weekly digest plus important exceptions",
  });
  putSetting(db, "commercial.pilot", {
    businessModel: "evidence_selected",
    platform: "evidence_selected",
    oneActiveVenture: true,
    successBuyers: 3,
    requirePositiveCashContribution: true,
    publicIdentity: "faceless_and_voiceless",
  });

  run(
    db,
    `INSERT INTO ventures
     (id, name, stage, status, summary, metadata, created_at, updated_at, lifecycle_stage, is_active, business_model)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      "venture-digital-products",
      "First Venture",
      1,
      "validating",
      "The sole active venture until one evidence-selected offer proves three independent buyers and positive cash contribution.",
      toJson({
        channel: "Evidence-selected distribution",
        publicIdentity: "faceless_and_voiceless",
        successThreshold: "3 independent paid buyers and positive cash contribution",
      }),
      ts,
      ts,
      "validating",
      1,
      "unselected",
    ],
  );

  if (includeDemoProof) {
    run(
      db,
      `INSERT INTO workflows (id, venture_id, type, title, status, current_step, priority,
        quality_score, expected_profit_cents, cost_estimate_cents, approval_required, metadata, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        "wf-digital-product-pilot-proof",
        "venture-digital-products",
        "digital_product_publish",
        "Digital product pilot proof",
        "blocked_for_approval",
        "operator digital-product dry-run approval",
        1,
        88,
        1900,
        0,
        1,
        toJson({
          channel: "Digital Product",
          subject: "Digital product pilot proof",
          products: [
            { sku: "compact-desk-cable-template-v1", product: "Desk cable routing template", marginCents: 1900 },
            { sku: "small-business-launch-checklist-v1", product: "Launch checklist download", marginCents: 1200 },
          ],
          sourceFiles: [
            "deliverables/digital-products/compact-desk-cable-template-proof.md",
            "deliverables/digital-products/small-business-launch-checklist-proof.md",
          ],
          proofMode: "dry-run only; no live listing, file delivery, or paid asset generation is created",
        }),
        ts,
        ts,
      ],
    );

    const completedTasks = [
      ["task-market-validated", "Market research gate", "market_research", "researcher", { score: 70, verdict: "needs_live_research" }],
      ["task-finance-validated", "Unit economics and channel gate", "finance_model", "analyst", { marginFloor: "promising if marketplace fees stay modest" }],
      ["task-qc-validated", "Quality and IP gate", "design_qc", "quality-checker", { qualityScore: 88, ipRisk: "low" }],
    ];

    for (const [id, title, kind, agent, result] of completedTasks) {
      run(
        db,
        `INSERT INTO tasks (id, workflow_id, title, kind, agent, status, priority, cost_budget_cents,
          cost_actual_cents, payload, result, completed_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, "wf-digital-product-pilot-proof", title, kind, agent, "completed", 2, 0, 0, toJson({}), toJson(result), ts, ts, ts],
      );
    }

    run(
      db,
      `INSERT INTO approvals (id, workflow_id, scope, title, status, risk_level, requested_by,
        requested_at, payload)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        "appr-digital-product-dry-run",
        "wf-digital-product-pilot-proof",
        "dry_run_publish",
        "Approve digital product dry-run proof",
        "pending",
        "low",
        "orchestrator",
        ts,
        toJson({
          noExternalPublish: true,
          reason: "Proves workflow wiring, approval loop, file-delivery planning, and dashboard visibility before any live publishing or paid asset work.",
        }),
      ],
    );

    run(
      db,
      `INSERT INTO tasks (id, workflow_id, title, kind, agent, status, priority, approval_id,
        max_retries, payload, result, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        "task-digital-product-dry-run",
        "wf-digital-product-pilot-proof",
        "Prepare digital product listing and delivery plan in dry-run mode",
        "publish_digital_product_dry_run",
        "publisher",
        "blocked",
        1,
        "appr-digital-product-dry-run",
        2,
        toJson({ integration: "digital-products", mode: "dry-run" }),
        toJson({ blockedBy: "appr-digital-product-dry-run" }),
        ts,
        ts,
      ],
    );

    const seedDeliverables = [
      [
        "deliv-digital-product-concept-pack",
        "Digital Product Concept Pack",
        "Digital Product - Pilot Concept Pack (approved for dry-run proof)",
        "operator",
        "markdown",
        "approved",
        "deliverables/digital-products/pilot-concept-pack.md",
        "Approved concept pack for the first digital-product proof path.",
      ],
      [
        "deliv-digital-product-unit-economics",
        "Digital Product Unit Economics",
        "Digital Product - Unit Economics Snapshot (approved for dry-run proof)",
        "operator",
        "markdown",
        "approved",
        "deliverables/digital-products/unit-economics-snapshot.md",
        "Unit economics snapshot for the first digital-product proof path.",
      ],
    ];

    for (const deliverable of seedDeliverables) {
      run(
        db,
        `INSERT INTO deliverables (id, workflow_id, title, human_name, audience, format, status, file_path, summary, metadata, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [deliverable[0], "wf-digital-product-pilot-proof", ...deliverable.slice(1), toJson({ seeded: true }), ts, ts],
      );
    }
  }

  const integrations = [
    ["codex", "Codex", "engineering", "ready", "local", "ok", { role: "engineering/admin runtime maintainer" }],
    ["openai", "OpenAI API", "ai", process.env.OPENAI_API_KEY ? "configured" : "needs_credentials", "api", process.env.OPENAI_API_KEY ? "ok" : "not_configured", { use: "future agent workflows, tracing, image/API scale" }],
    ["live_research", "Live Research Adapter", "research", process.env.OPENAI_API_KEY && process.env.JARVIS_ENABLE_LIVE_RESEARCH === "1" ? "configured" : "planned", "openai-web-search", process.env.OPENAI_API_KEY && process.env.JARVIS_ENABLE_LIVE_RESEARCH === "1" ? "ok" : "not_configured", { use: "approved live market, competitor, pricing, and risk research" }],
    ["ai_workers", "AI Worker Execution", "ai", process.env.OPENAI_API_KEY && process.env.JARVIS_ENABLE_LIVE_MODELS === "1" ? "configured" : "planned", "openai-agents-sdk", process.env.OPENAI_API_KEY && process.env.JARVIS_ENABLE_LIVE_MODELS === "1" ? "ok" : "not_configured", { use: "approved live OpenAI-backed specialist worker execution" }],
    ["digital_products", "Digital Product Publishing", "marketplace", "ready", "dry-run", "ok", { use: "digital product listing, file-delivery, and approval-pack proof path" }],
    ["gelato", "Gelato", "supplier", process.env.GELATO_API_KEY ? "configured" : "needs_credentials", "api-or-dashboard", process.env.GELATO_API_KEY ? "ok" : "dry_run_only", { use: "POD product creation and supplier-push to Etsy" }],
    ["etsy", "Etsy", "marketplace", "via_gelato", "partner", "limited", { directApi: "denied; do not retry", liveActionRisk: "seller account visible action" }],
    ["xero", "Xero", "accounting", process.env.XERO_CLIENT_ID ? "configured" : "planned", "oauth", process.env.XERO_CLIENT_ID ? "ok" : "not_configured", { use: "finance reconciliation after commercial traction" }],
    ["email", "Email escalation", "notification", process.env.SMTP_HOST ? "configured" : "planned", "smtp-or-provider", process.env.SMTP_HOST ? "ok" : "not_configured", { use: "urgent approvals and escalations" }],
    ["slack", "Slack", "control-plane", process.env.SLACK_BOT_TOKEN ? "configured" : "optional", "api", process.env.SLACK_BOT_TOKEN ? "ok" : "not_configured", { use: "optional agent command channel" }],
    ["clickup", "ClickUp", "work-management", process.env.CLICKUP_API_TOKEN ? "configured" : "optional", "api", process.env.CLICKUP_API_TOKEN ? "ok" : "not_configured", { use: "optional task mirror; dashboard remains source of truth" }],
  ];

  for (const integration of integrations) {
    run(
      db,
      `INSERT INTO integrations (id, name, kind, status, mode, health, last_checked_at, metadata, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [...integration.slice(0, 6), ts, toJson(integration[6]), ts],
    );
  }

  if (includeDemoProof) {
    run(
      db,
      `INSERT INTO messages (id, task_id, severity, status, subject, body, created_at, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        "msg-first-proof-approval",
        "task-digital-product-dry-run",
        "approval",
        "open",
        "Digital product dry-run approval needed",
        "Approve the digital-product dry-run to prove the listing and delivery planning rail without creating a live listing or spending money.",
        ts,
        toJson({ channel: "dashboard" }),
      ],
    );
  }

  insertEvent(db, {
    level: "info",
    actor: "orchestrator",
    type: "runtime.seeded",
    entityType: "runtime",
    entityId: "v2",
    message: includeDemoProof
      ? "Pantheon test runtime seeded with explicit demo proof fixtures."
      : "Pantheon runtime initialized with one commercial venture, integrations, and cost controls.",
  });

  putSetting(db, "runtime.initialized", { at: ts, version: LATEST_SCHEMA_VERSION });
  commitAtomic(db);
  return true;
  } catch (error) {
    rollbackAtomic(db);
    throw error;
  }
}

module.exports = {
  LATEST_SCHEMA_VERSION,
  applyProviderAttemptReceiptBackfillMigration,
  applyPreventureResearchAuthorityMigration,
  applyCanonicalCommercialTruthReconciliationMigration,
  applyCommercialTestEvidenceLedgerMigration,
  applyCommercialIntelligenceMigration,
  applyModelCallCompletionTruthMigration,
  applyRuntimeStopEvidenceMigration,
  applyStableSpendCostIdMigration,
  all,
  fromJson,
  get,
  insertEvent,
  now,
  openDatabase,
  putSetting,
  randomId: randomUUID,
  recordPreventureEmergencyUnknownCost,
  run,
  seedDatabase,
  toJson,
  verifyDatabase,
  withPreventureOwnerApprovalCapability,
  withPreventureEmergencyCostSafetyCapability,
  withPreventureOwnerBillingObservationCapability,
  withPreventureProviderCostReconciliationCapability,
  withPreventureTerminalReceiptCapability,
  withPreventureTerminalRetainedRecoveryCapability,
  withPreventureValidatedEarlyStopCapability,
};
