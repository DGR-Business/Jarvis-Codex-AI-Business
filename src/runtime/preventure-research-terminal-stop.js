"use strict";

const { sha256 } = require("./commercial-test-contract");

const TERMINAL_STOP_SCHEMA = "pantheon.preventure-research-terminal-stop.v1";
const ASSIGNMENT_SKIP_SCHEMA = "pantheon.preventure-research-assignment-skip.v1";
const PREVENTURE_OFFICIAL_RESPONSES_ENDPOINT_HASH = sha256({
  method: "POST",
  url: "https://api.openai.com/v1/responses",
});
const DEFINITE_PRE_EFFECT_HTTP_STATUSES = new Set([
  400, 401, 403, 404, 405, 413, 415, 422,
]);
const HASH_PATTERN = /^sha256:[a-f0-9]{64}$/;
const SAFE_ID_PATTERN = /^[a-z0-9][a-z0-9._:-]{0,127}$/i;
const TRIGGER_OUTCOME_CLASSES = Object.freeze([
  "validated_evidence_shortfall",
  "known_failed_before_effect",
  "known_retained_unusable_provider_response",
]);
const EVIDENCE_GAP_PRIORITY = Object.freeze([
  "comparator_count_below_minimum",
  "comparator_direct_mix_below_minimum",
  "comparator_adjacent_mix_below_minimum",
  "comparator_indirect_mix_below_minimum",
  "comparator_seller_identity_incomplete",
  "comparator_per_format_coverage_incomplete",
  "comparator_etsy_coverage_missing",
  "comparator_gumroad_coverage_missing",
  "buyer_evidence_units_insufficient",
  "buyer_independence_insufficient",
  "buyer_consequence_insufficient",
  "buyer_workaround_trigger_insufficient",
  "purchaser_signals_insufficient",
  "paid_offer_diversity_insufficient",
  "purchaser_seller_diversity_insufficient",
  "exact_workflow_signals_insufficient",
  "lawful_source_access_exhausted",
]);
const EVIDENCE_GAP_DESCRIPTIONS = Object.freeze({
  comparator_count_below_minimum: "fewer than ten lawfully attributable comparator offers",
  comparator_direct_mix_below_minimum: "insufficient direct or near-direct comparator coverage",
  comparator_adjacent_mix_below_minimum: "insufficient adjacent comparator coverage",
  comparator_indirect_mix_below_minimum: "insufficient indirect alternative coverage",
  comparator_seller_identity_incomplete: "unverified seller identity across accepted comparator offers",
  comparator_per_format_coverage_incomplete: "insufficient comparator coverage for every approved format",
  comparator_etsy_coverage_missing: "missing attributable Etsy comparator coverage",
  comparator_gumroad_coverage_missing: "missing attributable Gumroad comparator coverage",
  buyer_evidence_units_insufficient: "insufficient exact-buyer problem evidence units",
  buyer_independence_insufficient: "insufficient independent exact-buyer evidence groups",
  buyer_consequence_insufficient: "insufficient buyer evidence describing operational or financial consequences",
  buyer_workaround_trigger_insufficient: "insufficient buyer workaround or spending-trigger evidence",
  purchaser_signals_insufficient: "insufficient purchaser-attributable behaviour",
  paid_offer_diversity_insufficient: "insufficient paid-offer diversity in purchaser evidence",
  purchaser_seller_diversity_insufficient: "insufficient verified seller diversity in purchaser evidence",
  exact_workflow_signals_insufficient: "insufficient purchaser evidence for the exact approval and scope workflow",
  lawful_source_access_exhausted: "the lawful public-source method could not add decision-grade evidence",
});

function stopError(code, message) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = 409;
  return error;
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (isObject(value)) {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value ?? null;
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

function same(left, right) {
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
}

function exactKeys(value, keys, label) {
  if (!isObject(value) || !same(Object.keys(value).sort(), [...keys].sort())) {
    throw stopError("preventure_research_terminal_stop_invalid", `${label} fields changed.`);
  }
}

function exactId(value, label) {
  if (typeof value !== "string" || !SAFE_ID_PATTERN.test(value)) {
    throw stopError("preventure_research_terminal_stop_invalid", `${label} is invalid.`);
  }
  return value;
}

function exactHash(value, label, nullable = false) {
  if (nullable && value === null) return null;
  if (!HASH_PATTERN.test(String(value || ""))) {
    throw stopError("preventure_research_terminal_stop_invalid", `${label} is invalid.`);
  }
  return value;
}

function exactTime(value, label) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    throw stopError("preventure_research_terminal_stop_invalid", `${label} is invalid.`);
  }
  return new Date(value).toISOString();
}

function exactSortedList(value, label, validate, minimum = 0) {
  if (
    !Array.isArray(value)
    || value.length < minimum
    || new Set(value).size !== value.length
    || !same(value, [...value].sort())
  ) {
    throw stopError("preventure_research_terminal_stop_invalid", `${label} is not exact and sorted.`);
  }
  value.forEach((item) => validate(item, label));
  return value;
}

function assignmentHash(value) {
  return value?.assignmentHash || value?.assignment_hash || null;
}

function preventureResearchTerminalStopId(
  authority,
  triggerAssignment,
  triggerOutcomeClass,
  providerEvidence,
) {
  const digest = sha256({
    schema: TERMINAL_STOP_SCHEMA,
    triggerOutcomeClass,
    authorityHash: authority?.authorityHash || null,
    triggerAssignmentHash: assignmentHash(triggerAssignment),
    providerEvidence: canonical(providerEvidence),
  }).slice("sha256:".length, "sha256:".length + 32);
  return `preventure_stop_${digest}`;
}

function derivePreventureResearchNextEvidenceAction({
  authority,
  triggerAssignment,
  triggerOutcomeClass,
  gapCodes = [],
}) {
  if (!TRIGGER_OUTCOME_CLASSES.includes(triggerOutcomeClass)) {
    throw stopError("preventure_research_terminal_stop_invalid", "Terminal-stop trigger class is unsupported.");
  }
  const cap = Math.min(
    Number(authority?.internalAiSpendCapAudCents || 0),
    Number(triggerAssignment?.maxCostAudCents || 0),
  );
  if (!Number.isSafeInteger(cap) || cap < 0) {
    throw stopError("preventure_research_terminal_stop_invalid", "Next evidence action has no exact cost ceiling.");
  }
  if (triggerOutcomeClass === "validated_evidence_shortfall") {
    const primaryGap = EVIDENCE_GAP_PRIORITY.find((gap) => gapCodes.includes(gap));
    if (!primaryGap) {
      throw stopError(
        "preventure_research_terminal_stop_invalid",
        "An evidence-shortfall stop requires one server-derived decision gap.",
      );
    }
    return deepFreeze({
      status: "proposed",
      id: `next_evidence_${primaryGap}`,
      action: `Run one separately approved captured-source diligence action focused on ${EVIDENCE_GAP_DESCRIPTIONS[primaryGap]}.`,
      evidenceGap: EVIDENCE_GAP_DESCRIPTIONS[primaryGap],
      method: "captured_public_source_diligence",
      maxInternalAiCostAudCents: cap,
      separateApprovalRequired: true,
    });
  }
  const failedBeforeEffect = triggerOutcomeClass === "known_failed_before_effect";
  return deepFreeze({
    status: "proposed",
    id: failedBeforeEffect
      ? "next_evidence_retry_after_transport_repair"
      : "next_evidence_retry_with_response_schema_guard",
    action: failedBeforeEffect
      ? "Repair the exact provider transport fault, then request separate approval for one bounded retry of the stopped assignment."
      : "Repair the provider response validation or retention fault, then request separate approval for one bounded retry of the stopped assignment.",
    evidenceGap: failedBeforeEffect
      ? "The assigned research produced no provider effect and therefore no commercial evidence."
      : "The retained provider effect was structurally unusable and contributes no commercial evidence.",
    method: failedBeforeEffect
      ? "repaired_openai_responses_web_search"
      : "openai_responses_web_search_with_response_schema_guard",
    maxInternalAiCostAudCents: cap,
    separateApprovalRequired: true,
  });
}

function createPreventureResearchAssignmentSkip(input = {}) {
  const body = {
    schema: ASSIGNMENT_SKIP_SCHEMA,
    id: exactId(input.id, "Assignment skip ID"),
    authorityHash: exactHash(input.authorityHash, "Assignment skip authority hash"),
    terminalStopId: exactId(input.terminalStopId, "Terminal stop ID"),
    triggerAssignmentHash: exactHash(
      input.triggerAssignmentHash,
      "Assignment skip trigger hash",
    ),
    assignmentId: exactId(input.assignmentId, "Skipped assignment ID"),
    assignmentHash: exactHash(input.assignmentHash, "Skipped assignment hash"),
    assignmentOrder: input.assignmentOrder,
    taskId: exactId(input.taskId, "Skipped assignment task ID"),
    dispatchState: input.dispatchState,
    taskAttemptCount: input.taskAttemptCount,
    modelCallCount: input.modelCallCount,
    agentRunReceiptCount: input.agentRunReceiptCount,
    agentRunCount: input.agentRunCount,
    researchRunCount: input.researchRunCount,
    toolInvocationCount: input.toolInvocationCount,
    budgetReservationCount: input.budgetReservationCount,
    costEventCount: input.costEventCount,
    costRecordCount: input.costRecordCount,
    sourceSnapshotCount: input.sourceSnapshotCount,
    evidenceRecordCount: input.evidenceRecordCount,
    totalAudCostCents: input.totalAudCostCents,
    skippedAt: exactTime(input.skippedAt, "Assignment skip time"),
  };
  if (
    body.dispatchState !== "not_dispatched"
    || !Number.isSafeInteger(body.assignmentOrder)
    || body.assignmentOrder < 1
    || body.taskAttemptCount !== 0
    || body.modelCallCount !== 0
    || body.agentRunReceiptCount !== 0
    || body.agentRunCount !== 0
    || body.researchRunCount !== 0
    || body.toolInvocationCount !== 0
    || body.budgetReservationCount !== 0
    || body.costEventCount !== 0
    || body.costRecordCount !== 0
    || body.sourceSnapshotCount !== 0
    || body.evidenceRecordCount !== 0
    || body.totalAudCostCents !== 0
  ) {
    throw stopError(
      "preventure_research_terminal_stop_invalid",
      "A skipped assignment must retain exact no-dispatch, no-attempt, and no-cost truth.",
    );
  }
  return deepFreeze({ ...body, skipRecordHash: sha256(body) });
}

function validatePreventureResearchAssignmentSkip(record, expected = {}) {
  exactKeys(record, [
    "schema", "id", "authorityHash", "terminalStopId", "triggerAssignmentHash",
    "assignmentId", "assignmentHash", "assignmentOrder", "taskId", "dispatchState",
    "taskAttemptCount", "modelCallCount", "agentRunReceiptCount", "agentRunCount",
    "researchRunCount", "toolInvocationCount", "budgetReservationCount", "costEventCount",
    "costRecordCount", "sourceSnapshotCount",
    "evidenceRecordCount", "totalAudCostCents", "skippedAt", "skipRecordHash",
  ], "Assignment skip record");
  const rebuilt = createPreventureResearchAssignmentSkip(record);
  if (!same(rebuilt, record)) {
    throw stopError("preventure_research_terminal_stop_invalid", "Assignment skip hash changed.");
  }
  for (const [key, value] of Object.entries(expected)) {
    if (value !== undefined && !same(record[key], value)) {
      throw stopError(
        "preventure_research_terminal_stop_invalid",
        `Assignment skip changed its expected ${key}.`,
      );
    }
  }
  return record;
}

function normalizeProviderEvidence(value, triggerOutcomeClass, triggerAssignment) {
  exactKeys(value, [
    "attemptId", "modelCallId", "agentRunReceiptId", "effectState",
    "officialEndpointHash", "httpStatus", "providerErrorType", "providerErrorCode",
    "providerErrorBodyArtifactHash", "providerRequestId", "providerResponseId",
    "clientRequestHash", "rawOutputArtifactHash", "responseIssuesHash", "costStatus",
    "costAudCents", "exposureAudCents", "exactBillingPending",
    "providerZeroBillingGuarantee",
  ], "Terminal-stop provider evidence");
  const providerRequestId = value.providerRequestId === null
    ? null
    : exactId(value.providerRequestId, "Provider request ID");
  const providerResponseId = value.providerResponseId === null
    ? null
    : exactId(value.providerResponseId, "Provider response ID");
  if (
    (providerResponseId !== null && !providerResponseId.startsWith("resp_"))
    || (providerRequestId !== null && providerResponseId !== null
      && providerRequestId === providerResponseId)
    || (providerRequestId !== null && providerRequestId.startsWith("resp_"))
  ) {
    throw stopError(
      "preventure_research_terminal_stop_invalid",
      "Provider request and body response identities are not distinct and canonical.",
    );
  }
  const preEffect = triggerOutcomeClass === "known_failed_before_effect";
  const officialEndpointHash = exactHash(
    value.officialEndpointHash,
    "Official provider endpoint hash",
    !preEffect,
  );
  const httpStatus = Number(value.httpStatus);
  const providerErrorType = value.providerErrorType === null
    ? null
    : exactId(value.providerErrorType, "Provider error type");
  const providerErrorCode = value.providerErrorCode === null
    ? null
    : exactId(value.providerErrorCode, "Provider error code");
  const providerErrorBodyArtifactHash = exactHash(
    value.providerErrorBodyArtifactHash,
    "Provider error body artifact hash",
    !preEffect,
  );
  if (
    value.effectState !== (preEffect ? "definite_pre_effect" : "known_effect")
    || (triggerOutcomeClass === "validated_evidence_shortfall" && providerResponseId === null)
    || (preEffect && providerResponseId !== null)
    || (!preEffect && value.rawOutputArtifactHash === null)
  ) {
    throw stopError(
      "preventure_research_terminal_stop_invalid",
      "Terminal-stop provider effect identity contradicts its trigger class.",
    );
  }
  if (
    preEffect
      ? (
          officialEndpointHash !== PREVENTURE_OFFICIAL_RESPONSES_ENDPOINT_HASH
          || !DEFINITE_PRE_EFFECT_HTTP_STATUSES.has(httpStatus)
          || providerErrorType === null
          || providerErrorCode === null
          || providerErrorBodyArtifactHash === null
          || value.rawOutputArtifactHash === null
          || value.providerZeroBillingGuarantee !== false
        )
      : (
          officialEndpointHash !== null
          || !Number.isSafeInteger(httpStatus)
          || httpStatus < 200
          || httpStatus > 299
          || providerErrorType !== null
          || providerErrorCode !== null
          || providerErrorBodyArtifactHash !== null
          || value.providerZeroBillingGuarantee !== null
        )
  ) {
    throw stopError(
      "preventure_research_terminal_stop_invalid",
      "Terminal-stop provider endpoint or response proof contradicts its trigger class.",
    );
  }
  if (!["estimated", "incurred", "reconciled"].includes(value.costStatus)) {
    throw stopError("preventure_research_terminal_stop_invalid", "Terminal-stop cost is not known.");
  }
  if (
    !Number.isSafeInteger(value.costAudCents)
    || value.costAudCents < 0
    || !Number.isSafeInteger(value.exposureAudCents)
    || value.exposureAudCents < value.costAudCents
    || value.exposureAudCents > Number(triggerAssignment?.maxCostAudCents || 0)
    || value.exactBillingPending !== ["estimated", "incurred"].includes(value.costStatus)
    || (preEffect && (
      value.costStatus !== "estimated"
      || value.costAudCents !== 0
      || value.exposureAudCents !== Number(triggerAssignment?.maxCostAudCents || 0)
      || value.exactBillingPending !== true
    ))
  ) {
    throw stopError("preventure_research_terminal_stop_invalid", "Terminal-stop cost is invalid.");
  }
  return {
    attemptId: exactId(value.attemptId, "Terminal-stop attempt ID"),
    modelCallId: exactId(value.modelCallId, "Terminal-stop model call ID"),
    agentRunReceiptId: exactId(value.agentRunReceiptId, "Terminal-stop receipt ID"),
    effectState: value.effectState,
    officialEndpointHash,
    httpStatus,
    providerErrorType,
    providerErrorCode,
    providerErrorBodyArtifactHash,
    providerRequestId,
    providerResponseId,
    clientRequestHash: exactHash(value.clientRequestHash, "Provider client request hash"),
    rawOutputArtifactHash: exactHash(
      value.rawOutputArtifactHash,
      "Raw provider output artifact hash",
      preEffect,
    ),
    responseIssuesHash: exactHash(value.responseIssuesHash, "Provider response issues hash"),
    costStatus: value.costStatus,
    costAudCents: value.costAudCents,
    exposureAudCents: value.exposureAudCents,
    exactBillingPending: value.exactBillingPending,
    providerZeroBillingGuarantee: value.providerZeroBillingGuarantee,
  };
}

function normalizeActualCoverage(value) {
  exactKeys(value, [
    "sourceSnapshotHashes", "evidenceHashes", "comparatorIds",
    "comparatorCoverage", "buyerEvidenceCoverage", "sourceAttemptRefs",
    "evidenceSetHash", "executionReceiptSetHash", "completedAssignmentIds",
    "completedAssignmentReceipts", "retainedContradictionEvidenceIds",
    "retainedCaseCriterionIds",
  ], "Terminal-stop actual coverage");
  if (!isObject(value.comparatorCoverage) || !isObject(value.buyerEvidenceCoverage)) {
    throw stopError(
      "preventure_research_terminal_stop_invalid",
      "Terminal-stop comparator and buyer coverage must be server-derived objects.",
    );
  }
  if (!Array.isArray(value.completedAssignmentReceipts)) {
    throw stopError(
      "preventure_research_terminal_stop_invalid",
      "Completed assignment receipt bindings are absent.",
    );
  }
  const completedAssignmentReceipts = value.completedAssignmentReceipts.map((item) => {
    exactKeys(item, [
      "assignmentId", "assignmentHash", "agentRunReceiptId", "agentRunReceiptHash",
    ], "Completed assignment receipt");
    return {
      assignmentId: exactId(item.assignmentId, "Completed assignment receipt ID"),
      assignmentHash: exactHash(item.assignmentHash, "Completed assignment hash"),
      agentRunReceiptId: exactId(item.agentRunReceiptId, "Completed agent receipt ID"),
      agentRunReceiptHash: exactHash(item.agentRunReceiptHash, "Completed agent receipt hash"),
    };
  });
  const receiptIds = completedAssignmentReceipts.map((item) => item.assignmentId);
  if (new Set(receiptIds).size !== receiptIds.length
    || !same(receiptIds, [...receiptIds].sort())) {
    throw stopError(
      "preventure_research_terminal_stop_invalid",
      "Completed assignment receipt bindings must be unique and sorted.",
    );
  }
  return {
    sourceSnapshotHashes: exactSortedList(
      value.sourceSnapshotHashes,
      "Source snapshot hashes",
      (item) => exactHash(item, "Source snapshot hash"),
    ),
    evidenceHashes: exactSortedList(
      value.evidenceHashes,
      "Evidence hashes",
      (item) => exactHash(item, "Evidence hash"),
    ),
    comparatorIds: exactSortedList(
      value.comparatorIds,
      "Comparator IDs",
      (item) => exactId(item, "Comparator ID"),
    ),
    comparatorCoverage: canonical(value.comparatorCoverage),
    buyerEvidenceCoverage: canonical(value.buyerEvidenceCoverage),
    sourceAttemptRefs: exactSortedList(
      value.sourceAttemptRefs,
      "Source-attempt references",
      (item) => exactId(item, "Source-attempt reference"),
    ),
    evidenceSetHash: exactHash(value.evidenceSetHash, "Terminal-stop evidence-set hash"),
    executionReceiptSetHash: exactHash(
      value.executionReceiptSetHash,
      "Terminal-stop execution receipt-set hash",
    ),
    completedAssignmentIds: exactSortedList(
      value.completedAssignmentIds,
      "Completed assignment IDs",
      (item) => exactId(item, "Completed assignment ID"),
    ),
    completedAssignmentReceipts,
    retainedContradictionEvidenceIds: exactSortedList(
      value.retainedContradictionEvidenceIds,
      "Retained contradiction evidence IDs",
      (item) => exactId(item, "Retained contradiction evidence ID"),
    ),
    retainedCaseCriterionIds: exactSortedList(
      value.retainedCaseCriterionIds,
      "Retained case criterion IDs",
      (item) => exactId(item, "Retained case criterion ID"),
    ),
  };
}

function createPreventureResearchTerminalStop(input = {}) {
  const authority = input.authority;
  const triggerAssignment = input.triggerAssignment;
  const assignments = input.assignments;
  if (
    !authority?.authorityHash
    || !triggerAssignment?.id
    || !assignmentHash(triggerAssignment)
    || !Array.isArray(assignments)
    || assignments.length !== authority.assignments.length
  ) {
    throw stopError("preventure_research_terminal_stop_invalid", "Stop authority or trigger assignment is absent.");
  }
  const expectedAssignmentIds = authority.assignments.map((item) => item.id);
  if (!same(assignments.map((item) => item.id), expectedAssignmentIds)) {
    throw stopError(
      "preventure_research_terminal_stop_invalid",
      "Terminal-stop assignments changed their exact authority order.",
    );
  }
  const triggerIndex = assignments.findIndex(
    (item) => assignmentHash(item) === assignmentHash(triggerAssignment),
  );
  if (triggerIndex < 0 || assignments[triggerIndex].id !== triggerAssignment.id) {
    throw stopError("preventure_research_terminal_stop_invalid", "Trigger assignment is outside the round.");
  }
  const triggerOutcomeClass = input.triggerOutcomeClass;
  if (!TRIGGER_OUTCOME_CLASSES.includes(triggerOutcomeClass)) {
    throw stopError("preventure_research_terminal_stop_invalid", "Terminal-stop trigger class is unsupported.");
  }
  const gapCodes = triggerOutcomeClass === "validated_evidence_shortfall"
    ? exactSortedList(
        input.gapCodes,
        "Evidence gap codes",
        (item) => {
          if (!EVIDENCE_GAP_PRIORITY.includes(item)) {
            throw stopError("preventure_research_terminal_stop_invalid", "Evidence gap code is unsupported.");
          }
        },
        1,
      )
    : [triggerOutcomeClass === "known_failed_before_effect"
      ? "technical_provider_failure_before_effect"
      : "technical_provider_response_unusable"];
  const stoppedAt = exactTime(input.stoppedAt, "Terminal stop time");
  const providerEvidence = normalizeProviderEvidence(
    input.providerEvidence,
    triggerOutcomeClass,
    triggerAssignment,
  );
  const terminalStopId = preventureResearchTerminalStopId(
    authority,
    triggerAssignment,
    triggerOutcomeClass,
    providerEvidence,
  );
  if (input.id !== undefined && input.id !== terminalStopId) {
    throw stopError("preventure_research_terminal_stop_invalid", "Terminal stop ID was not server-derived.");
  }
  const expectedSkippedAssignments = assignments.slice(triggerIndex + 1).map(
    (assignment, suffixIndex) => createPreventureResearchAssignmentSkip({
      id: `preventure_skip_${sha256({
        terminalStopId,
        assignmentHash: assignmentHash(assignment),
      }).slice("sha256:".length, "sha256:".length + 32)}`,
      authorityHash: authority.authorityHash,
      terminalStopId,
      triggerAssignmentHash: assignmentHash(triggerAssignment),
      assignmentId: assignment.id,
      assignmentHash: assignmentHash(assignment),
      assignmentOrder: triggerIndex + suffixIndex + 2,
      taskId: assignment.taskId,
      dispatchState: "not_dispatched",
      taskAttemptCount: 0,
      modelCallCount: 0,
      agentRunReceiptCount: 0,
      agentRunCount: 0,
      researchRunCount: 0,
      toolInvocationCount: 0,
      budgetReservationCount: 0,
      costEventCount: 0,
      costRecordCount: 0,
      sourceSnapshotCount: 0,
      evidenceRecordCount: 0,
      totalAudCostCents: 0,
      skippedAt: stoppedAt,
    }),
  );
  if (input.skippedAssignments && !same(input.skippedAssignments, expectedSkippedAssignments)) {
    throw stopError(
      "preventure_research_terminal_stop_invalid",
      "Skipped assignments are not the exact untouched suffix after the trigger.",
    );
  }
  const skippedAssignments = expectedSkippedAssignments.map((record) => {
    validatePreventureResearchAssignmentSkip(record, {
      authorityHash: authority.authorityHash,
      terminalStopId,
      triggerAssignmentHash: assignmentHash(triggerAssignment),
    });
    return record;
  });
  const skipHashes = skippedAssignments.map((record) => record.skipRecordHash);
  if (new Set(skipHashes).size !== skipHashes.length) {
    throw stopError("preventure_research_terminal_stop_invalid", "Skipped assignment hashes are duplicated.");
  }
  const nextEvidenceAction = derivePreventureResearchNextEvidenceAction({
    authority,
    triggerAssignment,
    triggerOutcomeClass,
    gapCodes,
  });
  if (input.nextEvidenceAction && !same(input.nextEvidenceAction, nextEvidenceAction)) {
    throw stopError(
      "preventure_research_terminal_stop_invalid",
      "Next evidence action was not derived by the server from the immutable stop trigger.",
    );
  }
  const actualCoverage = normalizeActualCoverage(input.actualCoverage);
  const completedPrefixEnd = triggerOutcomeClass === "validated_evidence_shortfall"
    ? triggerIndex + 1
    : triggerIndex;
  const completedPrefix = assignments.slice(0, completedPrefixEnd);
  const expectedCompletedIds = completedPrefix.map((item) => item.id).sort();
  if (!same(actualCoverage.completedAssignmentIds, expectedCompletedIds)) {
    throw stopError(
      "preventure_research_terminal_stop_invalid",
      "Completed assignments are not the exact usable prefix before the terminal stop.",
    );
  }
  const receiptsByAssignmentId = new Map(
    actualCoverage.completedAssignmentReceipts.map((item) => [item.assignmentId, item]),
  );
  if (
    receiptsByAssignmentId.size !== completedPrefix.length
    || completedPrefix.some((assignment) => (
      receiptsByAssignmentId.get(assignment.id)?.assignmentHash !== assignmentHash(assignment)
    ))
  ) {
    throw stopError(
      "preventure_research_terminal_stop_invalid",
      "Completed assignment receipts do not bind the exact usable prefix.",
    );
  }
  const body = {
    schema: TERMINAL_STOP_SCHEMA,
    id: terminalStopId,
    authorityHash: exactHash(authority.authorityHash, "Terminal-stop authority hash"),
    triggerAssignmentId: exactId(triggerAssignment.id, "Trigger assignment ID"),
    triggerAssignmentHash: exactHash(
      assignmentHash(triggerAssignment),
      "Trigger assignment hash",
    ),
    triggerOutcomeClass,
    reasonClass: triggerOutcomeClass === "validated_evidence_shortfall"
      ? "evidence"
      : "technical",
    reasonCode: triggerOutcomeClass,
    commercialInference: "none",
    providerEvidence,
    actualCoverage,
    gapCodes,
    skippedAssignments,
    nextEvidenceAction,
    stoppedAt,
  };
  return deepFreeze({ ...body, earlyStopRecordHash: sha256(body) });
}

function validatePreventureResearchTerminalStop(record, context = {}) {
  exactKeys(record, [
    "schema", "id", "authorityHash", "triggerAssignmentId", "triggerAssignmentHash",
    "triggerOutcomeClass", "reasonClass", "reasonCode", "commercialInference",
    "providerEvidence", "actualCoverage", "gapCodes", "skippedAssignments",
    "nextEvidenceAction", "stoppedAt", "earlyStopRecordHash",
  ], "Terminal stop record");
  const rebuilt = createPreventureResearchTerminalStop({
    authority: context.authority,
    triggerAssignment: context.triggerAssignment,
    assignments: context.assignments,
    id: record.id,
    triggerOutcomeClass: record.triggerOutcomeClass,
    providerEvidence: record.providerEvidence,
    actualCoverage: record.actualCoverage,
    gapCodes: record.gapCodes,
    skippedAssignments: record.skippedAssignments,
    nextEvidenceAction: record.nextEvidenceAction,
    stoppedAt: record.stoppedAt,
  });
  if (!same(rebuilt, record)) {
    throw stopError("preventure_research_terminal_stop_invalid", "Terminal stop hash or body changed.");
  }
  return record;
}

module.exports = {
  ASSIGNMENT_SKIP_SCHEMA,
  EVIDENCE_GAP_DESCRIPTIONS,
  EVIDENCE_GAP_PRIORITY,
  PREVENTURE_OFFICIAL_RESPONSES_ENDPOINT_HASH,
  TERMINAL_STOP_SCHEMA,
  TRIGGER_OUTCOME_CLASSES,
  createPreventureResearchAssignmentSkip,
  createPreventureResearchTerminalStop,
  derivePreventureResearchNextEvidenceAction,
  validatePreventureResearchAssignmentSkip,
  validatePreventureResearchTerminalStop,
  preventureResearchTerminalStopId,
};
