"use strict";

const {
  AUTHORITY_OUTCOMES,
  REQUIRED_ASSIGNMENT_IDS,
  REQUIRED_READINESS_GATE_IDS,
  validatePreventureResearchAuthority,
  validatePreventureResearchDecision,
} = require("./preventure-research-contract");
const {
  evaluatePreventureResearchReadiness,
} = require("./preventure-research-readiness");
const {
  createPreventureResearchStore,
  preventureResultingReadinessHash,
} = require("./preventure-research-store");
const {
  derivePreventureResearchPublicSourceBinding,
} = require("./preventure-research-source-identity");
const {
  defaultPreventureResearchAuthorityRegistry,
} = require("./preventure-research-authority-registry");
const {
  EVIDENCE_GAP_PRIORITY,
  createPreventureResearchTerminalStop,
  validatePreventureResearchTerminalStop,
} = require("./preventure-research-terminal-stop");
const { sha256 } = require("./commercial-test-contract");

const PREVENTURE_RESEARCH_FINALIZER_SCHEMA =
  "pantheon.preventure-research-finalizer-result.v1";
const PREVENTURE_RESEARCH_FINALIZATION_READINESS_SCHEMA =
  "pantheon.preventure-research-finalization-readiness.v1";
const HASH_PATTERN = /^sha256:[a-f0-9]{64}$/;
const EVIDENCE_DETAIL_KEYS = Object.freeze([
  "channelCase",
  "comparator",
  "buyerEvidence",
  "economicsCase",
  "formatCase",
  "readinessGate",
  "recommendation",
]);
const FORMAT_DISPOSITIONS = new Set(["retain", "revise", "reject"]);
const CHANNEL_STATES = new Set([
  "available",
  "conditional_unverified",
  "conditionally_preferred",
  "discovery_only",
  "not_selected",
  "not_verified",
  "protected_verification_required",
  "recommended",
  "rejected",
  "research_more",
]);
const ECONOMICS_STATES = new Set([
  "estimated",
  "known_zero",
  "unknown",
  "not_applicable",
]);
const READINESS_GATE_STATUSES = new Set([
  "supported",
  "partially_supported",
  "unresolved",
  "contradicted",
  "owner_input_recorded",
  "protected_verification_required",
]);
const RESEARCHABLE_GATE_STATUSES = new Set([
  "partially_supported",
  "unresolved",
  "protected_verification_required",
]);
const STRUCTURAL_REJECTION_GATES = new Set([
  "competition_entry",
  "direct_demand",
  "distribution",
  "offer_value",
  "operations",
  "provisional_economics",
  "risk",
]);
const REVISE_GATES = new Set([
  "distribution",
  "experiment",
  "format_usability",
  "offer_value",
  "operations",
  "provisional_economics",
  "risk",
]);
const KNOWN_FINAL_COST_EVENTS = new Set(["estimated", "incurred", "reconciled"]);
const RECOMMENDATION_KEYS = Object.freeze([
  "buyer",
  "channel",
  "evidenceStandard",
  "limitations",
  "materialContradictions",
  "nextMoneyMove",
  "offer",
  "outcome",
  "priceOrMargin",
  "problem",
  "reviseOrStopCriteria",
  "summary",
]);
const NON_OCCURRENCE_RECORD = Object.freeze({
  productBuilt: false,
  buyerContact: false,
  accountInspectedOrChanged: false,
  publishing: false,
  advertising: false,
  externalSpendAudCents: 0,
  orders: 0,
  revenueAudCents: 0,
  settledNetCashContribution: "not_settled",
});

class PreventureResearchFinalizerError extends Error {
  constructor(code, message, details = {}, statusCode = 409) {
    super(message);
    this.name = "PreventureResearchFinalizerError";
    this.code = code;
    this.details = details;
    this.statusCode = statusCode;
  }
}

function fail(code, message, details, statusCode) {
  throw new PreventureResearchFinalizerError(code, message, details, statusCode);
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (isObject(value)) {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, canonical(value[key])]),
    );
  }
  return value ?? null;
}

function sameCanonical(left, right) {
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
}

function resolveRegisteredAuthority(input = {}) {
  const authorityRegistry = input.authorityRegistry
    || defaultPreventureResearchAuthorityRegistry;
  if (
    !authorityRegistry
    || typeof authorityRegistry.resolveAuthorityEntry !== "function"
    || typeof authorityRegistry.resolveCandidateAuthorityEntry !== "function"
  ) {
    fail(
      "preventure_research_finalizer_authority_registry_invalid",
      "The immutable pre-venture authority registry is unavailable.",
      {},
      500,
    );
  }
  const suppliedAuthority = input.authority;
  const suppliedReadiness = input.readinessSpec;
  const requestedHash = input.authorityHash
    || suppliedAuthority?.authorityHash
    || null;
  let entry;
  try {
    entry = requestedHash
      ? authorityRegistry.resolveAuthorityEntry(
        requestedHash,
        suppliedAuthority
          ? { id: suppliedAuthority.id, version: suppliedAuthority.version }
          : {},
      )
      : authorityRegistry.resolveCandidateAuthorityEntry();
  } catch (error) {
    fail(
      error?.code || "preventure_research_finalizer_authority_unknown",
      String(error?.message || "The exact registered research authority is unavailable."),
      {},
      500,
    );
  }
  if (!entry?.authority || !entry?.readinessSpec) {
    fail(
      "preventure_research_finalizer_candidate_authority_missing",
      "No exact registered candidate research authority is configured for finalization.",
      {},
      500,
    );
  }
  if (
    (suppliedAuthority && !sameCanonical(suppliedAuthority, entry.authority))
    || (suppliedReadiness && !sameCanonical(suppliedReadiness, entry.readinessSpec))
  ) {
    fail(
      "preventure_research_finalizer_authority_changed",
      "The supplied authority or readiness record differs from its immutable registry entry.",
    );
  }
  return Object.freeze({
    authorityRegistry,
    authority: entry.authority,
    readinessSpec: entry.readinessSpec,
  });
}

function assertCurrentCandidateAuthority(registered) {
  let candidate;
  try {
    candidate = registered.authorityRegistry.resolveCandidateAuthorityEntry();
  } catch {
    candidate = null;
  }
  if (
    registered.authorityRegistry.candidateAuthorityHash
      !== registered.authority.authorityHash
    || candidate?.authority?.authorityHash !== registered.authority.authorityHash
    || !sameCanonical(candidate?.authority, registered.authority)
    || !sameCanonical(candidate?.readinessSpec, registered.readinessSpec)
  ) {
    fail(
      "preventure_research_finalizer_authority_not_candidate",
      "Only the registry's exact current candidate authority may seal a fresh diligence decision.",
    );
  }
}

function exactKeys(value, keys) {
  return isObject(value)
    && sameCanonical(Object.keys(value).sort(), [...keys].sort());
}

function valueFrom(record, camel, snake) {
  return record?.[camel] ?? record?.[snake] ?? null;
}

function modelCostStatusMatchesEvent(modelCostStatus, eventType) {
  if (["estimated", "incurred"].includes(eventType)) {
    return [eventType, "incurred_estimate"].includes(modelCostStatus);
  }
  return modelCostStatus === eventType;
}

function assertHash(value, label) {
  if (!HASH_PATTERN.test(String(value || ""))) {
    fail(
      "preventure_research_finalizer_hash_invalid",
      `${label} is not an exact Pantheon SHA-256 hash.`,
    );
  }
  return value;
}

function assertText(value, label, minimum = 1) {
  if (typeof value !== "string" || value.trim().length < minimum) {
    fail(
      "preventure_research_finalizer_evidence_incomplete",
      `${label} is missing from the retained evidence.`,
    );
  }
  return value.trim();
}

function assertStringList(value, label, minimum = 0, options = {}) {
  if (
    !Array.isArray(value)
    || value.length < minimum
    || value.some((item) => typeof item !== "string" || !item.trim())
    || new Set(value).size !== value.length
  ) {
    fail(
      "preventure_research_finalizer_evidence_incomplete",
      `${label} must be a retained, non-duplicated string list.`,
    );
  }
  if (options.sorted === true && !sameCanonical(value, [...value].sort())) {
    fail(
      "preventure_research_finalizer_evidence_incomplete",
      `${label} must remain in canonical sorted order.`,
    );
  }
  return value;
}

function parseArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return null;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function canonicalAgentReceiptHash(value, label = "Agent receipt hash") {
  const raw = String(value || "");
  const canonicalHash = HASH_PATTERN.test(raw)
    ? raw
    : /^[a-f0-9]{64}$/.test(raw) ? `sha256:${raw}` : null;
  if (!canonicalHash) {
    fail(
      "preventure_research_finalizer_receipt_incomplete",
      `${label} is not one canonical SHA-256 receipt hash.`,
    );
  }
  return canonicalHash;
}

function parseObject(value) {
  if (isObject(value)) return value;
  if (typeof value !== "string") return null;
  try {
    const parsed = JSON.parse(value);
    return isObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function exactTimestamp(value, label) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    fail(
      "preventure_research_finalizer_time_invalid",
      `${label} is not a retained timestamp.`,
    );
  }
  return new Date(value).toISOString();
}

function latestHeads(records, hashKey, supersedesKey, idKey, label) {
  const rows = Array.isArray(records) ? records : [];
  const byHash = new Map();
  for (const row of rows) {
    const hash = row?.[hashKey];
    assertHash(hash, `${label} hash`);
    if (byHash.has(hash)) {
      fail(
        "preventure_research_finalizer_ledger_ambiguous",
        `${label} contains a duplicated immutable hash.`,
      );
    }
    byHash.set(hash, row);
  }
  const superseded = new Set();
  for (const row of rows) {
    const predecessor = row?.[supersedesKey] || null;
    if (!predecessor) continue;
    if (!byHash.has(predecessor) || predecessor === row[hashKey]) {
      fail(
        "preventure_research_finalizer_ledger_ambiguous",
        `${label} has an invalid supersession chain.`,
      );
    }
    superseded.add(predecessor);
  }
  const heads = rows.filter((row) => !superseded.has(row[hashKey]));
  const byId = new Map();
  for (const row of heads) {
    const id = assertText(row?.[idKey], `${label} ID`);
    if (byId.has(id)) {
      fail(
        "preventure_research_finalizer_ledger_ambiguous",
        `${label} ${id} has more than one current version.`,
      );
    }
    byId.set(id, row);
  }
  return heads;
}

function latestCostHeads(costEvents) {
  const latest = new Map();
  for (const event of Array.isArray(costEvents) ? costEvents : []) {
    const assignmentHash = assertHash(event?.assignmentHash, "Cost assignment hash");
    const costKey = assertText(event?.costKey, "Cost key");
    const key = `${assignmentHash}\u0000${costKey}`;
    const prior = latest.get(key);
    if (!Number.isSafeInteger(event.sequence) || event.sequence < 1) {
      fail(
        "preventure_research_finalizer_cost_unknown",
        "A cost chain has an invalid sequence.",
      );
    }
    if (!prior || event.sequence > prior.sequence) latest.set(key, event);
  }
  return [...latest.values()];
}

function atOrBefore(record, cutoff, fields) {
  if (!cutoff) return true;
  const cutoffTime = Date.parse(cutoff);
  for (const field of fields) {
    const value = record?.[field];
    if (typeof value === "string" && Number.isFinite(Date.parse(value))) {
      return Date.parse(value) <= cutoffTime;
    }
  }
  return true;
}

function ledgerEvidenceSetHash(authorityHash, ledger) {
  return sha256({
    authorityHash,
    sourceSnapshotHashes: (ledger.sourceSnapshots || [])
      .map((item) => item.snapshotHash)
      .filter(Boolean)
      .sort(),
    evidenceHashes: (ledger.evidenceRecords || [])
      .map((item) => item.evidenceHash)
      .filter(Boolean)
      .sort(),
  });
}

function ledgerExecutionReceiptSetHash(authorityHash, ledger, cutoff = null) {
  const costs = (ledger.costEvents || []).filter(
    (item) => atOrBefore(item, cutoff, ["occurredAt", "occurred_at"]),
  );
  return sha256({
    authorityHash,
    costReceiptHashes: costs
      .map((item) => valueFrom(item, "receiptHash", "receipt_hash"))
      .filter(Boolean)
      .sort(),
    sourceSnapshotHashes: (ledger.sourceSnapshots || [])
      .map((item) => item.snapshotHash)
      .filter(Boolean)
      .sort(),
    agentRunReceiptHashes: (ledger.executionEvidence?.agentRunReceipts || [])
      .map((item) => valueFrom(item, "receiptHash", "receipt_hash"))
      .filter(Boolean)
      .sort(),
    taskAttemptIds: (ledger.executionEvidence?.taskAttempts || [])
      .map((item) => item.id)
      .filter(Boolean)
      .sort(),
    modelCallIds: (ledger.executionEvidence?.modelCalls || [])
      .map((item) => item.id)
      .filter(Boolean)
      .sort(),
  });
}

function earlyDecisionReceiptSetHash(authorityHash, stopRecord) {
  return sha256({
    authorityHash,
    executionReceiptSetHash: stopRecord.actualCoverage.executionReceiptSetHash,
    earlyStopRecordHash: stopRecord.earlyStopRecordHash,
    skippedAssignmentRecordHashes: stopRecord.skippedAssignments
      .map((item) => item.skipRecordHash)
      .sort(),
  });
}

function canonicalAssignments(ledger, authority) {
  const assignments = Array.isArray(ledger.assignments) ? ledger.assignments : [];
  if (
    assignments.length !== REQUIRED_ASSIGNMENT_IDS.length
    || !sameCanonical(
      assignments.map((assignment) => assignment.id).sort(),
      [...REQUIRED_ASSIGNMENT_IDS].sort(),
    )
  ) {
    fail(
      "preventure_research_finalizer_assignments_incomplete",
      "All three exact diligence assignments are required before a decision can be derived.",
    );
  }
  const authorityTemplates = new Map(authority.assignments.map((item) => [item.id, item]));
  const byId = new Map();
  const byHash = new Map();
  for (const assignment of assignments) {
    const template = authorityTemplates.get(assignment.id);
    if (
      !template
      || assignment.authorityHash !== authority.authorityHash
      || assignment.templateHash !== sha256(template)
      || assignment.provider !== template.provider
      || assignment.model !== template.model
      || assignment.maxAttempts !== 1
      || assignment.maxCostAudCents !== template.maxCostAudCents
    ) {
      fail(
        "preventure_research_finalizer_assignment_changed",
        `Assignment ${String(assignment.id || "unknown")} does not match the immutable authority.`,
      );
    }
    byId.set(assignment.id, assignment);
    byHash.set(assignment.assignmentHash, assignment);
  }
  return {
    assignments: authority.assignments.map((template) => byId.get(template.id)),
    byId,
    byHash,
  };
}

function canonicalExecutionAndCost(ledger, authority, assignments, options = {}) {
  const execution = isObject(ledger.executionEvidence) ? ledger.executionEvidence : {};
  const attempts = Array.isArray(execution.taskAttempts) ? execution.taskAttempts : [];
  const calls = Array.isArray(execution.modelCalls) ? execution.modelCalls : [];
  const receipts = Array.isArray(execution.agentRunReceipts)
    ? execution.agentRunReceipts
    : [];
  const costHeads = latestCostHeads((ledger.costEvents || []).filter(
    (item) => atOrBefore(item, options.cutoff || null, ["occurredAt", "occurred_at"]),
  ));
  const receiptByAssignmentHash = new Map();
  let estimatedAudCents = 0;
  let reconciledAudCents = 0;
  let knownExposureAudCents = 0;
  let exactBillingPending = false;

  const assignmentIds = options.assignmentIds || REQUIRED_ASSIGNMENT_IDS;
  for (const assignmentId of assignmentIds) {
    const assignment = assignments.byId.get(assignmentId);
    const assignmentAttempts = attempts.filter(
      (attempt) => valueFrom(attempt, "taskId", "task_id") === assignment.taskId,
    );
    const assignmentCalls = calls.filter(
      (call) => valueFrom(call, "taskId", "task_id") === assignment.taskId,
    );
    if (assignmentAttempts.length !== 1 || assignmentCalls.length !== 1) {
      fail(
        "preventure_research_finalizer_receipt_incomplete",
        `Assignment ${assignmentId} must have one exact provider attempt and model call.`,
      );
    }
    const attempt = assignmentAttempts[0];
    const modelCall = assignmentCalls[0];
    const modelCallMetadata = parseObject(modelCall.metadata);
    const providerResponseId = modelCallMetadata?.providerResponseId || null;
    const providerRequestId = valueFrom(
      modelCall,
      "providerRequestId",
      "provider_request_id",
    );
    if (
      attempt.status !== "completed"
      || valueFrom(attempt, "outcomeStatus", "outcome_status") !== "known"
      || !["completed", "succeeded"].includes(String(modelCall.status || ""))
      || valueFrom(modelCall, "outcomeStatus", "outcome_status") !== "known"
      || [null, "unknown"].includes(valueFrom(modelCall, "costStatus", "cost_status"))
      || typeof providerResponseId !== "string"
      || !/^resp_[A-Za-z0-9._:-]{1,195}$/.test(providerResponseId)
      || (providerRequestId !== null && (
        typeof providerRequestId !== "string"
        || !providerRequestId
        || providerRequestId === providerResponseId
        || providerRequestId.startsWith("resp_")
      ))
    ) {
      fail(
        "preventure_research_finalizer_receipt_incomplete",
        `Assignment ${assignmentId} does not have a known terminal provider result and cost.`,
      );
    }
    const receiptHistory = receipts
      .filter((receipt) => (
        valueFrom(receipt, "taskId", "task_id") === assignment.taskId
        && valueFrom(receipt, "attemptId", "attempt_id") === attempt.id
      ))
      .sort((left, right) => Number(left.sequence || 0) - Number(right.sequence || 0));
    const receipt = receiptHistory.at(-1);
    const missingFields = parseArray(valueFrom(receipt, "missingFields", "missing_fields"));
    const warnings = parseArray(valueFrom(receipt, "warnings", "warnings"));
    const receiptSnapshot = parseObject(receipt?.receipt);
    const receiptProviderResponseId = receiptSnapshot?.provider?.metadata?.providerResponseId;
    if (
      !receipt
      || receiptHistory.some((item, index) => (
        Number(item.sequence) !== index + 1
        || (valueFrom(item, "previousHash", "previous_hash") || null)
          !== (index === 0
            ? null
            : valueFrom(receiptHistory[index - 1], "receiptHash", "receipt_hash"))
        || (index < receiptHistory.length - 1 && item.status === "complete")
      ))
      || receipt.status !== "complete"
      || valueFrom(receipt, "outcomeStatus", "outcome_status") !== "known"
      || !Array.isArray(missingFields)
      || missingFields.length !== 0
      || !Array.isArray(warnings)
      || warnings.length !== 0
      || !HASH_PATTERN.test(String(valueFrom(receipt, "receiptHash", "receipt_hash") || ""))
      || receiptProviderResponseId !== providerResponseId
      || receiptSnapshot?.provider?.providerResponseId !== providerResponseId
      || receiptSnapshot?.provider?.providerRequestId !== providerRequestId
    ) {
      fail(
        "preventure_research_finalizer_receipt_incomplete",
        `Assignment ${assignmentId} lacks its final complete immutable receipt.`,
      );
    }
    const assignmentCosts = costHeads.filter(
      (event) => event.assignmentHash === assignment.assignmentHash,
    );
    if (assignmentCosts.length !== 1) {
      fail(
        "preventure_research_finalizer_cost_unknown",
        `Assignment ${assignmentId} must have one exact final cost receipt.`,
      );
    }
    const cost = assignmentCosts[0];
    const receiptId = valueFrom(receipt, "id", "id");
    if (
      !KNOWN_FINAL_COST_EVENTS.has(cost.eventType)
      || !Number.isSafeInteger(cost.amountAudCents)
      || cost.amountAudCents < 0
      || !Number.isSafeInteger(cost.exposureAudCents)
      || cost.exposureAudCents < 0
      || cost.amountAudCents > cost.exposureAudCents
      || cost.exposureAudCents > assignment.maxCostAudCents
      || !modelCostStatusMatchesEvent(
        valueFrom(modelCall, "costStatus", "cost_status"),
        cost.eventType,
      )
      || cost.taskAttemptId !== attempt.id
      || cost.modelCallId !== modelCall.id
      || cost.agentRunReceiptId !== receiptId
      || !cost.budgetReservationId
      || !cost.costId
    ) {
      fail(
        "preventure_research_finalizer_cost_unknown",
        `Assignment ${assignmentId} cost is not known and bound to its exact attempt, receipt, budget reservation, and cost record.`,
      );
    }
    if (cost.eventType === "reconciled") reconciledAudCents += cost.amountAudCents;
    else {
      estimatedAudCents += cost.amountAudCents;
      exactBillingPending = true;
    }
    knownExposureAudCents += cost.exposureAudCents;
    receiptByAssignmentHash.set(assignment.assignmentHash, receipt);
  }
  const internalAiCostAudCents = estimatedAudCents + reconciledAudCents;
  const assignmentCapAudCents = authority.assignments.reduce(
    (sum, assignment) => sum + assignment.maxCostAudCents,
    0,
  );
  if (
    internalAiCostAudCents > authority.internalAiSpendCapAudCents
    || knownExposureAudCents > authority.internalAiSpendCapAudCents
    || internalAiCostAudCents > assignmentCapAudCents
    || knownExposureAudCents > assignmentCapAudCents
  ) {
    fail(
      "preventure_research_finalizer_cost_cap_exceeded",
      "The known internal AI cost exceeds this authority's cap.",
    );
  }
  return {
    receiptByAssignmentHash,
    knownExposureAudCents,
    costTruth: {
      currency: "AUD",
      estimatedInternalAiCostAudCents: estimatedAudCents,
      reconciledInternalAiCostAudCents: reconciledAudCents,
      unknownCostCount: 0,
      exactBillingPending,
      externalCommercialSpendAudCents: 0,
      settledNetCashContribution: "not_settled",
    },
  };
}

function executionRowsForAssignment(ledger, assignment) {
  const execution = isObject(ledger.executionEvidence) ? ledger.executionEvidence : {};
  return {
    attempts: (execution.taskAttempts || []).filter(
      (item) => valueFrom(item, "taskId", "task_id") === assignment.taskId,
    ),
    modelCalls: (execution.modelCalls || []).filter(
      (item) => valueFrom(item, "taskId", "task_id") === assignment.taskId,
    ),
    receipts: (execution.agentRunReceipts || []).filter(
      (item) => valueFrom(item, "taskId", "task_id") === assignment.taskId,
    ),
  };
}

function assertOneExactCandidate(expected, candidates, label) {
  const retained = candidates.filter((value) => value !== undefined);
  if (retained.length < 1 || retained.some((value) => !sameCanonical(value, expected))) {
    fail(
      "preventure_research_finalizer_terminal_stop_changed",
      `${label} is not bound exactly to the immutable trigger execution.`,
    );
  }
}

function parseReceiptSnapshot(receipt) {
  return parseObject(receipt?.receipt) || {};
}

function taskResultFromReceipt(receipt) {
  const snapshot = parseReceiptSnapshot(receipt);
  return parseObject(snapshot?.task?.result) || snapshot?.task?.result || {};
}

function validateTerminalTriggerExecution(
  ledger,
  authority,
  assignment,
  stopRecord,
  baseExecution,
) {
  const provider = stopRecord.providerEvidence;
  const rows = executionRowsForAssignment(ledger, assignment);
  if (
    rows.attempts.length !== 1
    || rows.modelCalls.length !== 1
  ) {
    fail(
      "preventure_research_finalizer_terminal_stop_changed",
      "The terminal trigger must retain one exact attempt and model call.",
    );
  }
  const attempt = rows.attempts[0];
  const modelCall = rows.modelCalls[0];
  const receiptHistory = rows.receipts
    .filter((item) => valueFrom(item, "attemptId", "attempt_id") === attempt.id)
    .sort((left, right) => Number(left.sequence || 0) - Number(right.sequence || 0));
  const receipt = receiptHistory.at(-1);
  if (
    !receipt
    || rows.receipts.length !== receiptHistory.length
    || provider.agentRunReceiptId !== receipt.id
    || receiptHistory.some((item, index) => (
      Number(item.sequence) !== index + 1
      || (valueFrom(item, "previousHash", "previous_hash") || null)
        !== (index === 0
          ? null
          : valueFrom(receiptHistory[index - 1], "receiptHash", "receipt_hash"))
      || (index < receiptHistory.length - 1 && item.status === "complete")
    ))
  ) {
    fail(
      "preventure_research_finalizer_terminal_stop_changed",
      "The terminal trigger must retain one exact immutable receipt history and final receipt.",
    );
  }
  const modelMetadata = parseObject(modelCall.metadata) || {};
  const attemptMetadata = parseObject(attempt.metadata) || {};
  const receiptSnapshot = parseReceiptSnapshot(receipt);
  const taskResult = taskResultFromReceipt(receipt);
  const receiptHash = canonicalAgentReceiptHash(
    valueFrom(receipt, "receiptHash", "receipt_hash"),
    "Terminal agent receipt hash",
  );
  const evidenceShortfall = stopRecord.triggerOutcomeClass === "validated_evidence_shortfall";
  const missingFields = parseArray(valueFrom(receipt, "missingFields", "missing_fields"));
  if (
    provider.attemptId !== attempt.id
    || provider.modelCallId !== modelCall.id
    || valueFrom(receipt, "attemptId", "attempt_id") !== attempt.id
    || ["provider_dispatched", "unknown"].includes(
      valueFrom(attempt, "outcomeStatus", "outcome_status"),
    )
    || ["provider_dispatched", "unknown"].includes(
      valueFrom(modelCall, "outcomeStatus", "outcome_status"),
    )
    || valueFrom(modelCall, "costStatus", "cost_status") === "unknown"
    || (evidenceShortfall && (
      attempt.status !== "completed"
      || valueFrom(attempt, "outcomeStatus", "outcome_status") !== "known"
      || !["completed", "succeeded"].includes(String(modelCall.status || ""))
      || valueFrom(modelCall, "outcomeStatus", "outcome_status") !== "known"
      || receipt.status !== "complete"
      || valueFrom(receipt, "outcomeStatus", "outcome_status") !== "known"
      || !Array.isArray(missingFields)
      || missingFields.length !== 0
    ))
  ) {
    fail(
      "preventure_research_finalizer_terminal_stop_changed",
      "The terminal trigger receipt or provider outcome is no longer exact and known.",
    );
  }

  const providerRequestId = valueFrom(
    modelCall,
    "providerRequestId",
    "provider_request_id",
  );
  const providerResponseId = modelMetadata.providerResponseId ?? null;
  if (
    provider.providerRequestId !== providerRequestId
    || provider.providerResponseId !== providerResponseId
    || receiptSnapshot?.provider?.providerRequestId !== providerRequestId
    || (receiptSnapshot?.provider?.providerResponseId ?? null) !== providerResponseId
    || (receiptSnapshot?.provider?.metadata?.providerResponseId ?? null) !== providerResponseId
  ) {
    fail(
      "preventure_research_finalizer_terminal_stop_changed",
      "The terminal trigger changed the distinct HTTP request or Responses-body identity.",
    );
  }

  assertOneExactCandidate(provider.clientRequestHash, [
    modelMetadata.clientRequestHash,
    attemptMetadata.clientRequestHash,
    taskResult.clientRequestHash,
    typeof modelMetadata.clientRequestId === "string"
      ? sha256(modelMetadata.clientRequestId)
      : undefined,
    typeof attemptMetadata.clientRequestId === "string"
      ? sha256(attemptMetadata.clientRequestId)
      : undefined,
    typeof taskResult.clientRequestId === "string"
      ? sha256(taskResult.clientRequestId)
      : undefined,
  ], "Terminal client request hash");
  assertOneExactCandidate(provider.rawOutputArtifactHash, [
    modelMetadata.retainedOutputHash,
    taskResult.retainedOutputHash,
    taskResult.rawOutputArtifactHash,
  ], "Terminal raw-output artifact hash");
  assertOneExactCandidate(provider.responseIssuesHash, [
    modelMetadata.responseIssuesHash,
    taskResult.responseIssuesHash,
  ], "Terminal response-issues hash");
  if (stopRecord.triggerOutcomeClass === "known_failed_before_effect") {
    assertOneExactCandidate(provider.officialEndpointHash, [
      modelMetadata.officialEndpointHash,
      attemptMetadata.officialEndpointHash,
      taskResult.officialEndpointHash,
    ], "Official endpoint hash");
    assertOneExactCandidate(provider.httpStatus, [
      modelMetadata.httpStatus,
      attemptMetadata.httpStatus,
      taskResult.httpStatus,
    ], "Provider HTTP status");
    assertOneExactCandidate(provider.providerErrorType, [
      modelMetadata.providerErrorType,
      attemptMetadata.providerErrorType,
      taskResult.providerErrorType,
    ], "Provider error type");
    assertOneExactCandidate(provider.providerErrorCode, [
      modelMetadata.providerErrorCode,
      attemptMetadata.providerErrorCode,
      taskResult.providerErrorCode,
    ], "Provider error code");
    assertOneExactCandidate(provider.providerErrorBodyArtifactHash, [
      modelMetadata.providerErrorBodyArtifactHash,
      attemptMetadata.providerErrorBodyArtifactHash,
      taskResult.providerErrorBodyArtifactHash,
    ], "Provider error-body artifact hash");
    assertOneExactCandidate(provider.providerZeroBillingGuarantee, [
      modelMetadata.providerZeroBillingGuarantee,
      taskResult.providerZeroBillingGuarantee,
    ], "Provider zero-billing guarantee state");
  }

  const costs = latestCostHeads((ledger.costEvents || []).filter(
    (item) => item.assignmentHash === assignment.assignmentHash
      && atOrBefore(item, stopRecord.stoppedAt, ["occurredAt", "occurred_at"]),
  ));
  if (costs.length !== 1) {
    fail(
      "preventure_research_finalizer_cost_unknown",
      "The terminal trigger must retain one exact latest cost receipt.",
    );
  }
  const cost = costs[0];
  if (
    cost.eventType !== provider.costStatus
    || cost.amountAudCents !== provider.costAudCents
    || cost.exposureAudCents !== provider.exposureAudCents
    || !modelCostStatusMatchesEvent(
      valueFrom(modelCall, "costStatus", "cost_status"),
      cost.eventType,
    )
    || cost.taskAttemptId !== attempt.id
    || cost.modelCallId !== modelCall.id
    || cost.agentRunReceiptId !== receipt.id
    || !cost.budgetReservationId
    || !cost.costId
    || provider.exactBillingPending !== ["estimated", "incurred"].includes(cost.eventType)
  ) {
    fail(
      "preventure_research_finalizer_cost_unknown",
      "The terminal trigger cost is not bound to its exact attempt, receipt, exposure, and billing state.",
    );
  }
  const estimated = ["estimated", "incurred"].includes(cost.eventType)
    ? cost.amountAudCents
    : 0;
  const reconciled = cost.eventType === "reconciled" ? cost.amountAudCents : 0;
  const knownExposureAudCents = baseExecution.knownExposureAudCents + cost.exposureAudCents;
  if (
    knownExposureAudCents > authority.internalAiSpendCapAudCents
    || knownExposureAudCents > authority.assignments.reduce(
      (sum, item) => sum + item.maxCostAudCents,
      0,
    )
  ) {
    fail(
      "preventure_research_finalizer_cost_cap_exceeded",
      "The terminal-stop exposure exceeds the exact authority cap.",
    );
  }
  return {
    receipt,
    costTruth: {
      ...baseExecution.costTruth,
      estimatedInternalAiCostAudCents:
        baseExecution.costTruth.estimatedInternalAiCostAudCents + estimated,
      reconciledInternalAiCostAudCents:
        baseExecution.costTruth.reconciledInternalAiCostAudCents + reconciled,
      exactBillingPending:
        baseExecution.costTruth.exactBillingPending || provider.exactBillingPending,
    },
    knownExposureAudCents,
  };
}

function assertSkippedSuffixUntouched(ledger, assignments, stopRecord) {
  const skippedIds = new Set(stopRecord.skippedAssignments.map((item) => item.assignmentId));
  for (const assignmentId of skippedIds) {
    const assignment = assignments.byId.get(assignmentId);
    const rows = executionRowsForAssignment(ledger, assignment);
    const costs = (ledger.costEvents || []).filter(
      (item) => item.assignmentHash === assignment.assignmentHash,
    );
    const sources = (ledger.sourceSnapshots || []).filter(
      (item) => item.assignmentHash === assignment.assignmentHash,
    );
    const evidence = (ledger.evidenceRecords || []).filter(
      (item) => item.assignmentHash === assignment.assignmentHash,
    );
    if (
      rows.attempts.length !== 0
      || rows.modelCalls.length !== 0
      || rows.receipts.length !== 0
      || costs.length !== 0
      || sources.length !== 0
      || evidence.length !== 0
    ) {
      fail(
        "preventure_research_finalizer_skipped_assignment_changed",
        `Skipped assignment ${assignmentId} contains activity, evidence, or cost.`,
      );
    }
  }
}

function resolveTerminalStop(input, ledger, authority, assignments) {
  const stored = ledger.terminalStopRecord || null;
  const supplied = input.terminalStopInput || null;
  const candidate = stored || supplied;
  if (!candidate) {
    if (Array.isArray(ledger.assignmentSkips) && ledger.assignmentSkips.length > 0) {
      fail(
        "preventure_research_finalizer_terminal_stop_changed",
        "Skipped assignments exist without one immutable terminal stop.",
      );
    }
    return null;
  }
  const triggerAssignment = assignments.byId.get(candidate.triggerAssignmentId)
    || assignments.byHash.get(candidate.triggerAssignmentHash);
  if (!triggerAssignment) {
    fail(
      "preventure_research_finalizer_terminal_stop_changed",
      "The terminal stop trigger assignment is outside the exact authority.",
    );
  }
  let stopRecord;
  let draft = false;
  try {
    if (!candidate.earlyStopRecordHash && !candidate.actualCoverage) {
      if (
        !candidate.triggerOutcomeClass
        || !candidate.providerEvidence
        || !candidate.stoppedAt
      ) {
        throw new Error("The unpersisted terminal-stop trigger is incomplete.");
      }
      stopRecord = { ...candidate };
      draft = true;
    } else {
      stopRecord = candidate.earlyStopRecordHash
        ? validatePreventureResearchTerminalStop(candidate, {
            authority,
            triggerAssignment,
            assignments: assignments.assignments,
          })
        : createPreventureResearchTerminalStop({
            ...candidate,
            authority,
            triggerAssignment,
            assignments: assignments.assignments,
          });
    }
  } catch (error) {
    fail(
      error?.code || "preventure_research_finalizer_terminal_stop_changed",
      `The validated early stop is not exact: ${String(error?.message || error)}`,
    );
  }
  if (stored && supplied && (supplied.earlyStopRecordHash || supplied.actualCoverage)) {
    let suppliedRecord;
    try {
      suppliedRecord = supplied.earlyStopRecordHash
        ? validatePreventureResearchTerminalStop(supplied, {
            authority,
            triggerAssignment,
            assignments: assignments.assignments,
          })
        : createPreventureResearchTerminalStop({
            ...supplied,
            authority,
            triggerAssignment,
            assignments: assignments.assignments,
          });
    } catch (error) {
      fail(
        error?.code || "preventure_research_finalizer_terminal_stop_changed",
        `The replayed terminal stop is not exact: ${String(error?.message || error)}`,
      );
    }
    if (!sameCanonical(suppliedRecord, stopRecord)) {
      fail(
        "preventure_research_finalizer_terminal_stop_changed",
        "The supplied terminal stop differs from the immutable stored stop.",
      );
    }
  }
  if (
    stored
    && !sameCanonical(ledger.assignmentSkips || [], stopRecord.skippedAssignments)
  ) {
    fail(
      "preventure_research_finalizer_terminal_stop_changed",
      "The stored assignment-skip suffix differs from the immutable terminal stop.",
    );
  }
  return { stopRecord, triggerAssignment, draft };
}

function canonicalEvidence(ledger, assignments, receiptByAssignmentHash) {
  const sources = latestHeads(
    ledger.sourceSnapshots,
    "snapshotHash",
    "supersedesSnapshotHash",
    "id",
    "Source snapshot",
  );
  const evidence = latestHeads(
    ledger.evidenceRecords,
    "evidenceHash",
    "supersedesEvidenceHash",
    "id",
    "Evidence record",
  );
  const sourcesByHash = new Map(sources.map((source) => [source.snapshotHash, source]));
  const evidenceIds = new Set();
  for (const record of evidence) {
    if (evidenceIds.has(record.id)) {
      fail(
        "preventure_research_finalizer_evidence_ambiguous",
        `Evidence ID ${record.id} is duplicated.`,
      );
    }
    evidenceIds.add(record.id);
  }
  for (const source of sources) {
    if (source.sourceClass === "retained_pantheon_evidence") {
      if (
        source.url !== null
        || source.canonicalUrl !== null
        || source.canonicalHost !== null
        || source.sourceIdentityUrl !== null
        || source.sourceIdentityHash !== null
        || source.marketplaceChannelId !== null
        || source.offerIdentityKey !== null
        || source.sellerIdentityKey !== null
        || source.publisherIdentityKey !== null
        || source.buyerIndependenceGroup !== null
        || source.identityDerivation !== "retained_pantheon_hash_v1"
      ) {
        fail(
          "preventure_research_finalizer_source_identity_invalid",
          `Retained Pantheon source ${String(source.id || "unknown")} changed its local immutable identity.`,
        );
      }
      continue;
    }
    let derivedIdentity;
    try {
      derivedIdentity = derivePreventureResearchPublicSourceBinding(source.url);
    } catch (error) {
      fail(
        "preventure_research_finalizer_source_identity_invalid",
        `Source ${String(source.id || "unknown")} does not retain one safe canonical public identity: ${String(error.message || error)}`,
      );
    }
    for (const [key, value] of Object.entries(derivedIdentity)) {
      if (!sameCanonical(source[key], value)) {
        fail(
          "preventure_research_finalizer_source_identity_invalid",
          `Source ${String(source.id || "unknown")} changed its server-derived ${key}.`,
        );
      }
    }
  }

  const assertBoundSource = (record, label, options = {}) => {
    const source = sourcesByHash.get(record.sourceSnapshotHash);
    const assignment = assignments.byHash.get(record.assignmentHash);
    const receipt = receiptByAssignmentHash.get(record.assignmentHash);
    if (
      !assignment
      || !source
      || !["captured", "partial"].includes(source.captureStatus)
      || (options.captured === true && source.captureStatus !== "captured")
      || source.assignmentHash !== record.assignmentHash
      || source.authorityHash !== record.authorityHash
      || source.agentRunReceiptId !== valueFrom(receipt, "id", "id")
    ) {
      fail(
        "preventure_research_finalizer_evidence_reference_invalid",
        `${label} is not bound to an admissible retained source and the final receipt for its exact assignment.`,
      );
    }
    return { source, assignment };
  };

  return { sources, evidence, sourcesByHash, assertBoundSource };
}

function assertEvidenceDetails(record, expectedKey, label, options = {}) {
  if (!exactKeys(record.details, EVIDENCE_DETAIL_KEYS)) {
    fail(
      "preventure_research_finalizer_case_detail_missing",
      `${label} lacks the exact retained structured detail envelope.`,
    );
  }
  const present = EVIDENCE_DETAIL_KEYS.filter((key) => record.details[key] !== null);
  const allowed = new Set([expectedKey, ...(options.allowWith || [])]);
  if (!present.includes(expectedKey) || present.some((key) => !allowed.has(key))) {
    fail(
      "preventure_research_finalizer_case_detail_missing",
      `${label} is only a criterion marker or is bound to the wrong structured detail.`,
    );
  }
  return record.details[expectedKey];
}

function deriveExactCase(evidenceState, criterionId, detailKey, validate, assignmentId) {
  const records = evidenceState.evidence.filter(
    (record) => record.criterionId === criterionId,
  );
  if (records.length < 1) {
    fail(
      "preventure_research_finalizer_case_missing",
      `Required decision case ${criterionId} is absent.`,
    );
  }
  let detail = null;
  for (const record of records) {
    const bound = evidenceState.assertBoundSource(record, `Decision case ${criterionId}`);
    if (bound.assignment.id !== assignmentId) {
      fail(
        "preventure_research_finalizer_evidence_reference_invalid",
        `Decision case ${criterionId} belongs to the wrong assignment.`,
      );
    }
    const current = assertEvidenceDetails(record, detailKey, `Decision case ${criterionId}`);
    validate(current);
    if (detail && !sameCanonical(detail, current)) {
      fail(
        "preventure_research_finalizer_case_conflict",
        `Decision case ${criterionId} has conflicting retained details.`,
      );
    }
    detail = current;
  }
  return {
    detail: canonical(detail),
    evidenceRefs: records.map((record) => record.id).sort(),
    records,
  };
}

function deriveFormatCases(authority, evidenceState) {
  return authority.formats.map((id) => deriveExactCase(
    evidenceState,
    `format_case:${id}`,
    "formatCase",
    (item) => {
      if (
        !exactKeys(item, ["id", "disposition"])
        || item.id !== id
        || !FORMAT_DISPOSITIONS.has(item.disposition)
      ) {
        fail(
          "preventure_research_finalizer_case_detail_invalid",
          `Format case ${id} changed its exact identity or disposition.`,
        );
      }
    },
    "format_channel_and_economics",
  ).detail);
}

function deriveChannelCases(authority, evidenceState) {
  return authority.channelCases.map((id) => deriveExactCase(
    evidenceState,
    `channel_case:${id}`,
    "channelCase",
    (item) => {
      if (
        !exactKeys(item, ["id", "state"])
        || item.id !== id
        || !CHANNEL_STATES.has(item.state)
      ) {
        fail(
          "preventure_research_finalizer_case_detail_invalid",
          `Channel case ${id} changed its exact identity or state.`,
        );
      }
    },
    "format_channel_and_economics",
  ).detail);
}

function validateEconomicsCase(item, channelId, priceAudCents) {
  if (
    !exactKeys(item, [
      "channelId",
      "estimatedNetCashContributionAudCents",
      "priceAudCents",
      "state",
      "unknownCosts",
    ])
    || item.channelId !== channelId
    || item.priceAudCents !== priceAudCents
    || !ECONOMICS_STATES.has(item.state)
  ) {
    fail(
      "preventure_research_finalizer_case_detail_invalid",
      `Economics case ${channelId}:${priceAudCents} changed its exact identity or state.`,
    );
  }
  assertStringList(item.unknownCosts, "Economics unknown costs", 0, { sorted: true });
  if (
    (["unknown", "not_applicable"].includes(item.state)
      && item.estimatedNetCashContributionAudCents !== null)
    || (!['unknown', 'not_applicable'].includes(item.state)
      && !Number.isSafeInteger(item.estimatedNetCashContributionAudCents))
    || (item.state === "known_zero" && item.estimatedNetCashContributionAudCents !== 0)
    || (item.state === "unknown" && item.unknownCosts.length < 1)
    || (channelId === "retain_cash" && (
      item.state !== "known_zero"
      || item.estimatedNetCashContributionAudCents !== 0
      || item.unknownCosts.length !== 0
    ))
  ) {
    fail(
      "preventure_research_finalizer_economics_truth_invalid",
      `Economics case ${channelId}:${priceAudCents} invents or changes cash truth.`,
    );
  }
}

function deriveEconomicsCases(authority, evidenceState) {
  return authority.channelCases.flatMap((channelId) => (
    authority.priceCasesAudCents.map((priceAudCents) => {
      const result = deriveExactCase(
        evidenceState,
        `economics_case:${channelId}:${priceAudCents}`,
        "economicsCase",
        (item) => validateEconomicsCase(item, channelId, priceAudCents),
        "format_channel_and_economics",
      );
      return {
        ...result.detail,
        evidenceRefs: result.evidenceRefs,
      };
    })
  ));
}

function deriveReadinessGates(evidenceState) {
  return REQUIRED_READINESS_GATE_IDS.map((id) => deriveExactCase(
    evidenceState,
    `readiness_gate:${id}`,
    "readinessGate",
    (item) => {
      if (
        !exactKeys(item, ["id", "required", "status"])
        || item.id !== id
        || item.required !== true
        || !READINESS_GATE_STATUSES.has(item.status)
      ) {
        fail(
          "preventure_research_finalizer_case_detail_invalid",
          `Readiness gate ${id} changed its exact identity or status.`,
        );
      }
    },
    "independent_readiness_review",
  ).detail);
}

function deriveAvailableFormatCases(authority, evidenceState) {
  return authority.formats.flatMap((id) => {
    if (!evidenceState.evidence.some((record) => record.criterionId === `format_case:${id}`)) {
      return [];
    }
    return deriveFormatCases({ ...authority, formats: [id] }, evidenceState);
  });
}

function deriveAvailableChannelCases(authority, evidenceState) {
  return authority.channelCases.flatMap((id) => {
    if (!evidenceState.evidence.some((record) => record.criterionId === `channel_case:${id}`)) {
      return [];
    }
    return deriveChannelCases({ ...authority, channelCases: [id] }, evidenceState);
  });
}

function deriveAvailableEconomicsCases(authority, evidenceState) {
  const rows = [];
  for (const channelId of authority.channelCases) {
    for (const priceAudCents of authority.priceCasesAudCents) {
      const criterionId = `economics_case:${channelId}:${priceAudCents}`;
      if (!evidenceState.evidence.some((record) => record.criterionId === criterionId)) continue;
      const result = deriveExactCase(
        evidenceState,
        criterionId,
        "economicsCase",
        (item) => validateEconomicsCase(item, channelId, priceAudCents),
        "format_channel_and_economics",
      );
      rows.push({ ...result.detail, evidenceRefs: result.evidenceRefs });
    }
  }
  return rows;
}

function deriveEarlyReadinessGates(evidenceState) {
  return REQUIRED_READINESS_GATE_IDS.map((id) => {
    const criterionId = `readiness_gate:${id}`;
    if (!evidenceState.evidence.some((record) => record.criterionId === criterionId)) {
      return { id, required: true, status: "unresolved" };
    }
    return deriveExactCase(
      evidenceState,
      criterionId,
      "readinessGate",
      (item) => {
        if (
          !exactKeys(item, ["id", "required", "status"])
          || item.id !== id
          || item.required !== true
          || !READINESS_GATE_STATUSES.has(item.status)
        ) {
          fail(
            "preventure_research_finalizer_case_detail_invalid",
            `Readiness gate ${id} changed its exact identity or status.`,
          );
        }
      },
      "independent_readiness_review",
    ).detail;
  });
}

function deriveRecommendation(authority, evidenceState) {
  const records = evidenceState.evidence.filter(
    (record) => record.details?.recommendation !== null
      && record.details?.recommendation !== undefined,
  );
  if (records.length !== 1) {
    fail(
      "preventure_research_finalizer_recommendation_ambiguous",
      "Exactly one retained independent recommendation is required.",
    );
  }
  const record = records[0];
  const bound = evidenceState.assertBoundSource(record, "Independent recommendation");
  const recommendation = assertEvidenceDetails(
    record,
    "recommendation",
    "Independent recommendation",
  );
  if (
    bound.assignment.id !== "independent_readiness_review"
    || record.criterionId !== null
    || !exactKeys(recommendation, RECOMMENDATION_KEYS)
    || !AUTHORITY_OUTCOMES.includes(recommendation.outcome)
  ) {
    fail(
      "preventure_research_finalizer_recommendation_invalid",
      "The independent recommendation is incomplete or outside this authority.",
    );
  }
  for (const [key, minimum] of Object.entries({
    summary: 20,
    buyer: 8,
    problem: 12,
    offer: 12,
    channel: 3,
    priceOrMargin: 3,
    evidenceStandard: 12,
    nextMoneyMove: 8,
  })) assertText(recommendation[key], `Recommendation ${key}`, minimum);
  assertStringList(
    recommendation.reviseOrStopCriteria,
    "Recommendation revise or stop criteria",
    1,
  );
  assertStringList(
    recommendation.materialContradictions,
    "Recommendation material contradictions",
  );
  assertStringList(recommendation.limitations, "Recommendation limitations", 1);
  return canonical(recommendation);
}

function validateComparatorCoverage(authority, evidenceState, options = {}) {
  const firstAssignment = "comparator_and_buyer_evidence";
  const comparatorRecords = evidenceState.evidence.filter(
    (record) => record.details?.comparator !== null
      && record.details?.comparator !== undefined,
  );
  const comparators = new Map();
  for (const record of comparatorRecords) {
    const bound = evidenceState.assertBoundSource(record, `Comparator ${record.id}`);
    const item = assertEvidenceDetails(
      record,
      "comparator",
      `Comparator ${record.id}`,
      { allowWith: ["buyerEvidence"] },
    );
    if (
      bound.assignment.id !== firstAssignment
      || bound.source.sourceClass !== "public_marketplace_listing_or_result_observation"
      || !bound.source.offerIdentityKey
      || !bound.source.marketplaceChannelId
      || record.criterionId !== null
      || !(
        (record.truthClass === "model_inference" && bound.source.captureStatus === "partial")
        || (record.truthClass === "observed_fact" && bound.source.captureStatus === "captured")
      )
      || !exactKeys(item, [
        "category", "channelId", "formatIds", "id", "reviewObservationCount", "sellerId",
      ])
      || item.id !== bound.source.offerIdentityKey
      || item.channelId !== bound.source.marketplaceChannelId
      || item.sellerId !== bound.source.sellerIdentityKey
      || !["direct_or_near_direct", "adjacent", "indirect"].includes(item.category)
      || !authority.channelCases.includes(item.channelId)
      || item.channelId === "retain_cash"
      || !Array.isArray(item.formatIds)
      || item.formatIds.length < 1
      || new Set(item.formatIds).size !== item.formatIds.length
      || item.formatIds.some((formatId) => !authority.formats.includes(formatId))
      || !Number.isSafeInteger(item.reviewObservationCount)
      || item.reviewObservationCount < 0
      || (bound.source.captureStatus === "partial" && item.reviewObservationCount !== 0)
    ) {
      fail(
        "preventure_research_finalizer_comparator_invalid",
        `Comparator ${record.id} is not one exact retained marketplace observation with an explicit evidence grade.`,
      );
    }
    assertText(item.id, "Comparator ID");
    if (item.sellerId !== null) assertText(item.sellerId, "Comparator seller ID");
    const prior = comparators.get(item.id);
    if (prior && !sameCanonical(prior, item)) {
      fail(
        "preventure_research_finalizer_comparator_conflict",
        `Comparator ${item.id} has conflicting retained identity details.`,
      );
    }
    comparators.set(item.id, item);
  }
  const values = [...comparators.values()];
  const scope = authority.comparatorScope;
  const categoryCount = (category) => values.filter((item) => item.category === category).length;
  const sellerCounts = new Map();
  for (const item of values) {
    if (item.sellerId === null) continue;
    sellerCounts.set(item.sellerId, (sellerCounts.get(item.sellerId) || 0) + 1);
  }
  const coverage = {
    comparatorCount: values.length,
    directOrNearDirectCount: categoryCount("direct_or_near_direct"),
    adjacentCount: categoryCount("adjacent"),
    indirectCount: categoryCount("indirect"),
    maximumAcceptedOffersPerSeller: Math.max(0, ...sellerCounts.values()),
    unknownSellerIdentityCount: values.filter((item) => item.sellerId === null).length,
    sellerIdentityComplete: values.every((item) => item.sellerId !== null),
    reviewObservationCount: values.reduce(
      (sum, item) => sum + item.reviewObservationCount,
      0,
    ),
    perFormatCounts: Object.fromEntries(authority.formats.map((formatId) => [
      formatId,
      values.filter((item) => item.formatIds.includes(formatId)).length,
    ])),
    observedChannelIds: [...new Set(values.map((item) => item.channelId))].sort(),
  };
  coverage.complete = !(
    values.length < scope.minimumOffers
    || values.length > scope.maximumOffers
    || coverage.directOrNearDirectCount < scope.directOrNearDirectMinimum
    || coverage.adjacentCount < scope.adjacentMinimum
    || coverage.indirectCount < scope.indirectMinimum
    || coverage.maximumAcceptedOffersPerSeller > scope.acceptedOffersPerSellerMaximum
    || coverage.unknownSellerIdentityCount > 0
    || coverage.reviewObservationCount > scope.reviewObservationMaximum
    || authority.formats.some(
      (formatId) => coverage.perFormatCounts[formatId] < scope.minimumPerApprovedFormat,
    )
    || !coverage.observedChannelIds.includes("etsy")
    || !coverage.observedChannelIds.includes("gumroad")
  );
  if (!coverage.complete && options.allowIncomplete !== true) {
    fail(
      "preventure_research_finalizer_comparator_coverage_incomplete",
      "The retained comparator ledger does not meet the exact 10-15, category, seller, format, Etsy, and Gumroad boundaries.",
      coverage,
    );
  }
  return coverage;
}

function validateBuyerEvidence(evidenceState) {
  const rows = evidenceState.evidence.filter(
    (record) => record.details?.buyerEvidence !== null
      && record.details?.buyerEvidence !== undefined,
  );
  const result = {
    total: 0,
    consequenceCount: 0,
    workaroundOrSpendingTriggerCount: 0,
    purchaserAttributableCount: 0,
    independenceGroupCount: 0,
    paidOfferCount: 0,
    sellerOrPublisherCount: 0,
    exactWorkflowRelevanceCount: 0,
  };
  const groups = new Set();
  const offers = new Set();
  const sellers = new Set();
  const usedSourceHashes = new Set();
  for (const record of rows) {
    const bound = evidenceState.assertBoundSource(record, `Buyer evidence ${record.id}`);
    const item = assertEvidenceDetails(
      record,
      "buyerEvidence",
      `Buyer evidence ${record.id}`,
      { allowWith: ["comparator"] },
    );
    if (
      bound.assignment.id !== "comparator_and_buyer_evidence"
      || !(
        (record.truthClass === "model_inference" && bound.source.captureStatus === "partial")
        || (record.truthClass === "observed_fact" && bound.source.captureStatus === "captured")
      )
      || record.polarity !== "supporting"
      || !exactKeys(item, [
        "exactWorkflowRelevance",
        "independenceGroup",
        "kind",
        "paidOfferId",
        "sellerOrPublisherId",
      ])
      || ![
        "consequence",
        "workaround_or_spending_trigger",
        "purchaser_attributable_behaviour",
      ].includes(item.kind)
      || typeof item.exactWorkflowRelevance !== "boolean"
      || (item.kind === "purchaser_attributable_behaviour" && !item.paidOfferId)
      || (item.kind !== "purchaser_attributable_behaviour" && item.paidOfferId !== null)
      || usedSourceHashes.has(bound.source.snapshotHash)
      || item.independenceGroup !== bound.source.buyerIndependenceGroup
      || (
        item.kind === "purchaser_attributable_behaviour"
        && (
          !bound.source.offerIdentityKey
          || item.paidOfferId !== bound.source.offerIdentityKey
          || item.sellerOrPublisherId !== bound.source.sellerIdentityKey
        )
      )
      || (
        item.kind !== "purchaser_attributable_behaviour"
        && (
          ![
            "public_practitioner_discussion",
            "established_professional_or_industry_material",
          ].includes(bound.source.sourceClass)
          || item.sellerOrPublisherId !== bound.source.publisherIdentityKey
        )
      )
    ) {
      fail(
        "preventure_research_finalizer_buyer_evidence_invalid",
        `Buyer evidence ${record.id} is not one exact retained fact or explicitly partial provider-grounded classification.`,
      );
    }
    assertText(item.independenceGroup, "Buyer-evidence independence group");
    if (item.sellerOrPublisherId !== null) {
      assertText(item.sellerOrPublisherId, "Buyer-evidence seller or publisher");
    }
    usedSourceHashes.add(bound.source.snapshotHash);
    const decisionGrade = bound.source.captureStatus === "captured"
      && record.truthClass === "observed_fact";
    if (!decisionGrade) continue;
    groups.add(item.independenceGroup);
    if (item.sellerOrPublisherId !== null) sellers.add(item.sellerOrPublisherId);
    if (item.paidOfferId) offers.add(item.paidOfferId);
    if (item.kind === "consequence") result.consequenceCount += 1;
    if (item.kind === "workaround_or_spending_trigger") {
      result.workaroundOrSpendingTriggerCount += 1;
    }
    if (item.kind === "purchaser_attributable_behaviour") {
      result.purchaserAttributableCount += 1;
    }
    if (item.exactWorkflowRelevance) result.exactWorkflowRelevanceCount += 1;
  }
  result.total = result.consequenceCount
    + result.workaroundOrSpendingTriggerCount
    + result.purchaserAttributableCount;
  result.independenceGroupCount = groups.size;
  result.paidOfferCount = offers.size;
  result.sellerOrPublisherCount = sellers.size;
  return result;
}

function expectedEvidenceGapCodes(authority, triggerAssignment, evidenceState, comparator, buyer) {
  const gaps = new Set();
  const scope = authority.comparatorScope;
  if (comparator.comparatorCount < scope.minimumOffers) {
    gaps.add("comparator_count_below_minimum");
  }
  if (comparator.directOrNearDirectCount < scope.directOrNearDirectMinimum) {
    gaps.add("comparator_direct_mix_below_minimum");
  }
  if (comparator.adjacentCount < scope.adjacentMinimum) {
    gaps.add("comparator_adjacent_mix_below_minimum");
  }
  if (comparator.indirectCount < scope.indirectMinimum) {
    gaps.add("comparator_indirect_mix_below_minimum");
  }
  if (!comparator.sellerIdentityComplete) {
    gaps.add("comparator_seller_identity_incomplete");
  }
  if (authority.formats.some(
    (id) => comparator.perFormatCounts[id] < scope.minimumPerApprovedFormat,
  )) {
    gaps.add("comparator_per_format_coverage_incomplete");
  }
  if (!comparator.observedChannelIds.includes("etsy")) {
    gaps.add("comparator_etsy_coverage_missing");
  }
  if (!comparator.observedChannelIds.includes("gumroad")) {
    gaps.add("comparator_gumroad_coverage_missing");
  }
  if (buyer.total < 6) gaps.add("buyer_evidence_units_insufficient");
  if (buyer.independenceGroupCount < 3) gaps.add("buyer_independence_insufficient");
  if (buyer.consequenceCount < 3) gaps.add("buyer_consequence_insufficient");
  if (buyer.workaroundOrSpendingTriggerCount < 2) {
    gaps.add("buyer_workaround_trigger_insufficient");
  }
  if (buyer.purchaserAttributableCount < 6) gaps.add("purchaser_signals_insufficient");
  if (buyer.paidOfferCount < 3) gaps.add("paid_offer_diversity_insufficient");
  if (buyer.sellerOrPublisherCount < 2) {
    gaps.add("purchaser_seller_diversity_insufficient");
  }
  if (buyer.exactWorkflowRelevanceCount < 3) {
    gaps.add("exact_workflow_signals_insufficient");
  }

  const triggerSources = evidenceState.sources.filter(
    (item) => item.assignmentHash === triggerAssignment.assignmentHash,
  );
  const presentSourceClasses = new Set(triggerSources.map((item) => item.sourceClass));
  const triggerTemplate = authority.assignments.find((item) => item.id === triggerAssignment.id);
  const missingSourceClass = (triggerTemplate?.requiredSourceClasses || []).some(
    (sourceClass) => !presentSourceClasses.has(sourceClass),
  );
  let requiredCriteria = [];
  if (triggerAssignment.id === "format_channel_and_economics") {
    requiredCriteria = [
      ...authority.formats.map((id) => `format_case:${id}`),
      ...authority.channelCases.map((id) => `channel_case:${id}`),
      ...authority.channelCases.flatMap((channelId) => authority.priceCasesAudCents.map(
        (price) => `economics_case:${channelId}:${price}`,
      )),
    ];
  } else if (triggerAssignment.id === "independent_readiness_review") {
    requiredCriteria = REQUIRED_READINESS_GATE_IDS.map((id) => `readiness_gate:${id}`);
  }
  const presentCriteria = new Set(evidenceState.evidence
    .filter((item) => item.assignmentHash === triggerAssignment.assignmentHash)
    .map((item) => item.criterionId)
    .filter(Boolean));
  const missingCriterion = requiredCriteria.some((item) => !presentCriteria.has(item));
  const missingContrary = triggerAssignment.id === "independent_readiness_review"
    && authority.researchQuestions.some((question) => !evidenceState.evidence.some(
      (item) => item.assignmentHash === triggerAssignment.assignmentHash
        && item.polarity === "contrary"
        && item.questionId === question.id,
    ));
  if (missingSourceClass || missingCriterion || missingContrary) {
    gaps.add("lawful_source_access_exhausted");
  }
  return [...gaps].sort();
}

function validatedCoverageFromTriggerReceipt(receipt) {
  const snapshot = parseReceiptSnapshot(receipt);
  const taskResult = taskResultFromReceipt(receipt);
  const candidates = [
    taskResult.validatedCoverage,
    snapshot?.attempt?.metadata?.validatedCoverage,
    snapshot?.provider?.metadata?.validatedCoverage,
  ].filter(isObject);
  if (candidates.length < 1 || candidates.some(
    (candidate) => !sameCanonical(candidate, candidates[0]),
  )) {
    fail(
      "preventure_research_finalizer_terminal_stop_changed",
      "The trigger receipt does not retain one exact server-derived coverage proof.",
    );
  }
  return candidates[0];
}

function deriveTerminalActualCoverage(
  ledger,
  authority,
  assignments,
  stopRecord,
  evidenceState,
  comparatorCoverage,
  buyerEvidenceCoverage,
  execution,
  triggerReceipt,
) {
  const completedAssignmentReceipts = [...execution.receiptByAssignmentHash.entries()]
    .map(([assignmentHash, receipt]) => {
      const assignment = assignments.byHash.get(assignmentHash);
      return {
        assignmentId: assignment.id,
        assignmentHash,
        agentRunReceiptId: valueFrom(receipt, "id", "id"),
        agentRunReceiptHash: canonicalAgentReceiptHash(
          valueFrom(receipt, "receiptHash", "receipt_hash"),
          `Completed assignment ${assignment.id} receipt hash`,
        ),
      };
    })
    .sort((left, right) => left.assignmentId.localeCompare(right.assignmentId));
  let sourceAttemptRefs = [];
  let expectedGapCodes = Array.isArray(stopRecord.gapCodes)
    ? stopRecord.gapCodes
    : [];
  if (stopRecord.triggerOutcomeClass !== "validated_evidence_shortfall") {
    expectedGapCodes = [stopRecord.triggerOutcomeClass === "known_failed_before_effect"
      ? "technical_provider_failure_before_effect"
      : "technical_provider_response_unusable"];
  }
  if (stopRecord.triggerOutcomeClass === "validated_evidence_shortfall") {
    const coverageProof = validatedCoverageFromTriggerReceipt(triggerReceipt);
    if (
      coverageProof.status !== "insufficient_evidence"
      || !Array.isArray(coverageProof.gapCodes)
      || !Array.isArray(coverageProof.searchAttemptProof?.attempts)
    ) {
      fail(
        "preventure_research_finalizer_terminal_stop_changed",
        "The trigger receipt does not prove a server-validated evidence shortfall.",
      );
    }
    expectedGapCodes = [...new Set(coverageProof.gapCodes)].sort();
    sourceAttemptRefs = coverageProof.searchAttemptProof.attempts
      .map((item) => item.id)
      .sort();
    if (
      new Set(sourceAttemptRefs).size !== sourceAttemptRefs.length
      || (Array.isArray(stopRecord.gapCodes)
        && !sameCanonical(expectedGapCodes, stopRecord.gapCodes))
    ) {
      fail(
        "preventure_research_finalizer_terminal_stop_changed",
        "The stop changed the server-derived evidence gaps or lawful search-attempt proof.",
      );
    }
    const independentlyDerived = expectedEvidenceGapCodes(
      authority,
      assignments.byId.get(stopRecord.triggerAssignmentId),
      evidenceState,
      comparatorCoverage,
      buyerEvidenceCoverage,
    );
    if (independentlyDerived.some((gap) => !expectedGapCodes.includes(gap))) {
      fail(
        "preventure_research_finalizer_terminal_stop_changed",
        "The retained stop omits a decision-critical server-derived evidence gap.",
      );
    }
  }
  const expected = {
    sourceSnapshotHashes: evidenceState.sources.map((item) => item.snapshotHash).sort(),
    evidenceHashes: evidenceState.evidence.map((item) => item.evidenceHash).sort(),
    comparatorIds: evidenceState.evidence
      .map((item) => item.details?.comparator?.id)
      .filter(Boolean)
      .filter((item, index, values) => values.indexOf(item) === index)
      .sort(),
    comparatorCoverage: canonical(comparatorCoverage),
    buyerEvidenceCoverage: canonical(buyerEvidenceCoverage),
    sourceAttemptRefs,
    evidenceSetHash: ledgerEvidenceSetHash(authority.authorityHash, ledger),
    executionReceiptSetHash: ledgerExecutionReceiptSetHash(
      authority.authorityHash,
      ledger,
      stopRecord.stoppedAt,
    ),
    completedAssignmentIds: completedAssignmentReceipts
      .map((item) => item.assignmentId)
      .sort(),
    completedAssignmentReceipts,
    retainedContradictionEvidenceIds: evidenceState.evidence
      .filter((item) => item.polarity === "contrary")
      .map((item) => item.id)
      .sort(),
    retainedCaseCriterionIds: [...new Set(evidenceState.evidence
      .map((item) => item.criterionId)
      .filter(Boolean))]
      .sort(),
  };
  if (stopRecord.actualCoverage && !sameCanonical(stopRecord.actualCoverage, expected)) {
    fail(
      "preventure_research_finalizer_terminal_stop_changed",
      "The terminal stop does not match the exact retained evidence, receipts, cases, and costs.",
    );
  }
  if (Array.isArray(stopRecord.gapCodes)
    && !sameCanonical(stopRecord.gapCodes, expectedGapCodes)) {
    fail(
      "preventure_research_finalizer_terminal_stop_changed",
      "The terminal-stop gap classification changed.",
    );
  }
  return { actualCoverage: expected, gapCodes: expectedGapCodes };
}

function validateContraryEvidence(authority, evidenceState) {
  const contrary = evidenceState.evidence.filter((record) => record.polarity === "contrary");
  for (const record of contrary) {
    evidenceState.assertBoundSource(record, `Contrary evidence ${record.id}`);
  }
  const covered = new Set(contrary.map((record) => record.questionId));
  const missing = authority.researchQuestions
    .map((question) => question.id)
    .filter((questionId) => !covered.has(questionId));
  if (missing.length > 0) {
    fail(
      "preventure_research_finalizer_contrary_evidence_incomplete",
      "The retained disconfirming pass does not cover every approved research question.",
      { missingQuestionIds: missing },
    );
  }
}

function validateNoExtraCaseCriteria(authority, evidenceState) {
  const expected = new Set([
    ...authority.formats.map((id) => `format_case:${id}`),
    ...authority.channelCases.map((id) => `channel_case:${id}`),
    ...authority.channelCases.flatMap((channelId) => authority.priceCasesAudCents.map(
      (price) => `economics_case:${channelId}:${price}`,
    )),
    ...REQUIRED_READINESS_GATE_IDS.map((id) => `readiness_gate:${id}`),
  ]);
  const extra = evidenceState.evidence
    .map((record) => record.criterionId)
    .filter((criterionId) => criterionId !== null && !expected.has(criterionId));
  if (extra.length > 0) {
    fail(
      "preventure_research_finalizer_case_scope_changed",
      "The evidence ledger contains a decision case outside the exact authority.",
      { extraCriterionIds: [...new Set(extra)].sort() },
    );
  }
}

function gateById(readinessGates) {
  return new Map(readinessGates.map((gate) => [gate.id, gate]));
}

function validateOutcomeGates(
  recommendation,
  formatCases,
  channelCases,
  economicsCases,
  readinessGates,
  caseEvidence,
) {
  const outcome = recommendation.outcome;
  const gates = gateById(readinessGates);
  const retainCash = channelCases.find((item) => item.id === "retain_cash");
  const nonCash = channelCases.filter((item) => item.id !== "retain_cash");
  const retainCashRecommended = retainCash?.state === "recommended";
  if (retainCashRecommended && outcome !== "no_investment") {
    fail(
      "preventure_research_finalizer_retain_cash_outcome_mismatch",
      "A retained recommendation to keep cash must map to no_investment.",
    );
  }
  if (outcome === "no_investment" && !retainCashRecommended) {
    fail(
      "preventure_research_finalizer_retain_cash_outcome_mismatch",
      "no_investment requires retaining cash to be the recommended comparison case.",
    );
  }

  if (outcome === "build") {
    const unsupported = readinessGates.filter((gate) => gate.status !== "supported");
    const recommendedChannels = nonCash.filter((item) => item.state === "recommended");
    const selectedChannelId = recommendedChannels[0]?.id || null;
    const selectedEconomics = economicsCases.filter(
      (item) => item.channelId === selectedChannelId,
    );
    if (
      unsupported.length > 0
      || recommendation.materialContradictions.length > 0
      || formatCases.every((item) => item.disposition !== "retain")
      || recommendedChannels.length !== 1
      || selectedEconomics.length !== 3
      || selectedEconomics.some((item) => item.state !== "estimated")
      || !selectedEconomics.some(
        (item) => item.estimatedNetCashContributionAudCents > 0,
      )
      || economicsCases.some((item) => item.state === "unknown")
      || caseEvidence.some((record) => record.truthClass === "unknown")
    ) {
      fail(
        "preventure_research_finalizer_build_not_supported",
        "A build recommendation requires every structured gate supported, no material contradiction, one retained format, one recommended non-cash channel, and known positive provisional economics. It remains proposal-only.",
      );
    }
  } else if (outcome === "research_more") {
    if (!readinessGates.some((gate) => RESEARCHABLE_GATE_STATUSES.has(gate.status))) {
      fail(
        "preventure_research_finalizer_research_more_not_supported",
        "research_more requires a structured decision-critical gap that another bounded action could address.",
      );
    }
  } else if (outcome === "revise") {
    const buyerProblem = gates.get("buyer_problem");
    const structuredRevision = readinessGates.some(
      (gate) => gate.status === "contradicted" && REVISE_GATES.has(gate.id),
    ) || formatCases.some((item) => item.disposition === "revise")
      || channelCases.some((item) => item.state === "rejected");
    if (
      buyerProblem?.status !== "supported"
      || recommendation.materialContradictions.length < 1
      || !structuredRevision
    ) {
      fail(
        "preventure_research_finalizer_revise_not_supported",
        "revise requires a supported core buyer problem plus a retained contradiction to the offer, format, channel, economics, operations, experiment, or risk case.",
      );
    }
  } else if (outcome === "reject") {
    if (!readinessGates.some(
      (gate) => gate.status === "contradicted" && STRUCTURAL_REJECTION_GATES.has(gate.id),
    )) {
      fail(
        "preventure_research_finalizer_reject_not_supported",
        "reject requires a retained structural contradiction in demand, entry, offer, economics, distribution, operations, or risk.",
      );
    }
  } else if (outcome === "no_investment") {
    if (
      gates.get("alternatives")?.status !== "supported"
      || nonCash.some((item) => ["recommended", "conditionally_preferred"].includes(item.state))
    ) {
      fail(
        "preventure_research_finalizer_no_investment_not_supported",
        "no_investment requires a supported alternatives comparison and no preferred non-cash channel.",
      );
    }
  }
}

function deterministicDecisionTime(ledger, authority) {
  const values = [authority.approvedAt];
  for (const event of ledger.lifecycle || []) values.push(event.occurredAt);
  for (const event of ledger.costEvents || []) values.push(event.occurredAt);
  for (const source of ledger.sourceSnapshots || []) values.push(source.retrievedAt);
  for (const evidence of ledger.evidenceRecords || []) values.push(evidence.capturedAt);
  for (const attempt of ledger.executionEvidence?.taskAttempts || []) {
    values.push(attempt.completed_at, attempt.finished_at, attempt.ended_at, attempt.started_at);
  }
  for (const call of ledger.executionEvidence?.modelCalls || []) {
    values.push(call.completed_at, call.finished_at, call.created_at);
  }
  for (const receipt of ledger.executionEvidence?.agentRunReceipts || []) {
    values.push(receipt.created_at);
  }
  const retained = values
    .filter((value) => typeof value === "string" && Number.isFinite(Date.parse(value)))
    .map((value) => ({ value, time: Date.parse(value) }))
    .sort((left, right) => left.time - right.time || left.value.localeCompare(right.value));
  if (retained.length === 0) {
    fail(
      "preventure_research_finalizer_time_invalid",
      "No immutable ledger timestamp can bind the deterministic decision.",
    );
  }
  const decidedAt = exactTimestamp(retained.at(-1).value, "Deterministic decision time");
  if (
    Date.parse(decidedAt) < Date.parse(authority.approvedAt)
    || Date.parse(decidedAt) >= Date.parse(authority.expiresAt)
  ) {
    fail(
      "preventure_research_finalizer_time_invalid",
      "The evidence-complete decision time is outside the approved authority window.",
    );
  }
  return decidedAt;
}

function deriveEarlyStopDecisionInput(ledger, authority, assignments, resolvedStop) {
  let { stopRecord } = resolvedStop;
  const { triggerAssignment, draft } = resolvedStop;
  const triggerIndex = assignments.assignments.findIndex(
    (item) => item.assignmentHash === triggerAssignment.assignmentHash,
  );
  const priorAssignmentIds = assignments.assignments
    .slice(0, triggerIndex)
    .map((item) => item.id);
  const baseExecution = canonicalExecutionAndCost(
    ledger,
    authority,
    assignments,
    { assignmentIds: priorAssignmentIds, cutoff: stopRecord.stoppedAt },
  );
  const terminal = validateTerminalTriggerExecution(
    ledger,
    authority,
    triggerAssignment,
    stopRecord,
    baseExecution,
  );
  if (stopRecord.triggerOutcomeClass !== "validated_evidence_shortfall") {
    const triggerSources = (ledger.sourceSnapshots || []).filter(
      (item) => item.assignmentHash === triggerAssignment.assignmentHash,
    );
    const triggerEvidence = (ledger.evidenceRecords || []).filter(
      (item) => item.assignmentHash === triggerAssignment.assignmentHash,
    );
    if (triggerSources.length > 0 || triggerEvidence.length > 0) {
      fail(
        "preventure_research_finalizer_terminal_stop_changed",
        "A technical terminal trigger cannot contribute commercial evidence.",
      );
    }
  }
  const receiptByAssignmentHash = new Map(baseExecution.receiptByAssignmentHash);
  if (stopRecord.triggerOutcomeClass === "validated_evidence_shortfall") {
    receiptByAssignmentHash.set(triggerAssignment.assignmentHash, terminal.receipt);
  }
  const execution = {
    receiptByAssignmentHash,
    knownExposureAudCents: terminal.knownExposureAudCents,
    costTruth: terminal.costTruth,
  };
  const evidenceState = canonicalEvidence(ledger, assignments, receiptByAssignmentHash);
  validateNoExtraCaseCriteria(authority, evidenceState);
  const comparatorCoverage = validateComparatorCoverage(
    authority,
    evidenceState,
    { allowIncomplete: true },
  );
  const buyerEvidenceCoverage = validateBuyerEvidence(evidenceState);
  const derivedCoverage = deriveTerminalActualCoverage(
    ledger,
    authority,
    assignments,
    stopRecord,
    evidenceState,
    comparatorCoverage,
    buyerEvidenceCoverage,
    execution,
    terminal.receipt,
  );
  if (draft) {
    try {
      stopRecord = createPreventureResearchTerminalStop({
        ...stopRecord,
        authority,
        triggerAssignment,
        assignments: assignments.assignments,
        actualCoverage: derivedCoverage.actualCoverage,
        gapCodes: derivedCoverage.gapCodes,
      });
    } catch (error) {
      fail(
        error?.code || "preventure_research_finalizer_terminal_stop_changed",
        `The derived terminal stop is invalid: ${String(error?.message || error)}`,
      );
    }
  }
  assertSkippedSuffixUntouched(ledger, assignments, stopRecord);
  const actualCoverage = derivedCoverage.actualCoverage;
  const formatCases = deriveAvailableFormatCases(authority, evidenceState);
  const channelCases = deriveAvailableChannelCases(authority, evidenceState);
  const economicsCases = deriveAvailableEconomicsCases(authority, evidenceState);
  const readinessGates = deriveEarlyReadinessGates(evidenceState);
  const materialContradictions = evidenceState.evidence
    .filter((record) => record.polarity === "contrary")
    .map((record) => `Retained contrary evidence ${record.id}.`)
    .sort();
  const limitations = [
    "The validated stop permits no commercial inference from the triggering response or technical failure.",
    `The bounded round stopped under ${stopRecord.reasonCode}; the named evidence gap remains unresolved.`,
  ];
  const decidedAt = exactTimestamp(stopRecord.stoppedAt, "Validated early-stop time");
  if (
    Date.parse(decidedAt) < Date.parse(authority.approvedAt)
    || Date.parse(decidedAt) >= Date.parse(authority.expiresAt)
  ) {
    fail(
      "preventure_research_finalizer_time_invalid",
      "The validated early stop is outside the approved authority window.",
    );
  }
  const decisionInput = {
    id: `${authority.id}_decision`,
    version: `${authority.version}-decision-v1`,
    outcome: "research_more",
    completionMode: "validated_early_stop",
    earlyStopRecordHash: stopRecord.earlyStopRecordHash,
    skippedAssignmentRecordHashes: stopRecord.skippedAssignments
      .map((item) => item.skipRecordHash)
      .sort(),
    nextEvidenceAction: stopRecord.nextEvidenceAction,
    decidedAt,
    summary: "The bounded diligence round ended at a validated evidence or provider stop and cannot support a commercial decision.",
    buyer: authority.opportunity.buyer,
    problem: authority.opportunity.problem,
    offer: authority.opportunity.offer,
    channel: "No commercial channel is selected or activated.",
    priceOrMargin: "A$19, A$29, and A$39 remain unverified planning hypotheses.",
    evidenceStandard: "Only immutable prior evidence and the exact validated stop proof are retained; no missing commercial fact is inferred.",
    nextMoneyMove: stopRecord.nextEvidenceAction.action,
    reviseOrStopCriteria: [
      "Proceed only if the separately approved bounded evidence action can economically resolve the named decision gap.",
    ],
    formatCases,
    channelCases,
    economicsCases,
    materialContradictions,
    readinessGates,
    limitations,
  };
  return {
    decisionInput,
    stopRecord,
    costTruth: execution.costTruth,
    evidenceSummary: {
      completionMode: "validated_early_stop",
      triggerOutcomeClass: stopRecord.triggerOutcomeClass,
      completedAssignmentCount: actualCoverage.completedAssignmentIds.length,
      skippedAssignmentCount: stopRecord.skippedAssignments.length,
      comparatorCount: comparatorCoverage.comparatorCount,
      reviewObservationCount: comparatorCoverage.reviewObservationCount,
      buyerEvidence: buyerEvidenceCoverage,
      sourceCount: evidenceState.sources.length,
      evidenceCount: evidenceState.evidence.length,
      formatCaseCount: formatCases.length,
      channelCaseCount: channelCases.length,
      economicsCaseCount: economicsCases.length,
      readinessGateCount: readinessGates.length,
    },
    expectedEvidenceSetHash: actualCoverage.evidenceSetHash,
    expectedReceiptSetHash: earlyDecisionReceiptSetHash(authority.authorityHash, stopRecord),
  };
}

function deriveDecisionInput(ledger, authority, options = {}) {
  const assignments = canonicalAssignments(ledger, authority);
  const terminalStop = resolveTerminalStop(options, ledger, authority, assignments);
  if (terminalStop) {
    return deriveEarlyStopDecisionInput(ledger, authority, assignments, terminalStop);
  }
  const execution = canonicalExecutionAndCost(
    ledger,
    authority,
    assignments,
    { cutoff: ledger.decision?.decidedAt || null },
  );
  const evidenceState = canonicalEvidence(
    ledger,
    assignments,
    execution.receiptByAssignmentHash,
  );
  validateNoExtraCaseCriteria(authority, evidenceState);
  const comparatorCoverage = validateComparatorCoverage(authority, evidenceState);
  const buyerEvidenceCoverage = validateBuyerEvidence(evidenceState);
  validateContraryEvidence(authority, evidenceState);
  const formatCases = deriveFormatCases(authority, evidenceState);
  const channelCases = deriveChannelCases(authority, evidenceState);
  const economicsCases = deriveEconomicsCases(authority, evidenceState);
  const readinessGates = deriveReadinessGates(evidenceState);
  const recommendation = deriveRecommendation(authority, evidenceState);
  const caseCriteria = new Set([
    ...authority.formats.map((id) => `format_case:${id}`),
    ...authority.channelCases.map((id) => `channel_case:${id}`),
    ...authority.channelCases.flatMap((channelId) => authority.priceCasesAudCents.map(
      (price) => `economics_case:${channelId}:${price}`,
    )),
    ...REQUIRED_READINESS_GATE_IDS.map((id) => `readiness_gate:${id}`),
  ]);
  const caseEvidence = evidenceState.evidence.filter(
    (record) => caseCriteria.has(record.criterionId),
  );
  validateOutcomeGates(
    recommendation,
    formatCases,
    channelCases,
    economicsCases,
    readinessGates,
    caseEvidence,
  );
  const decidedAt = ledger.decision?.decidedAt || deterministicDecisionTime(ledger, authority);
  const decisionInput = {
    id: `${authority.id}_decision`,
    version: `${authority.version}-decision-v1`,
    outcome: recommendation.outcome,
    completionMode: "full_round",
    earlyStopRecordHash: null,
    skippedAssignmentRecordHashes: [],
    nextEvidenceAction: null,
    decidedAt,
    summary: recommendation.summary,
    buyer: recommendation.buyer,
    problem: recommendation.problem,
    offer: recommendation.offer,
    channel: recommendation.channel,
    priceOrMargin: recommendation.priceOrMargin,
    evidenceStandard: recommendation.evidenceStandard,
    nextMoneyMove: recommendation.nextMoneyMove,
    reviseOrStopCriteria: recommendation.reviseOrStopCriteria,
    formatCases,
    channelCases,
    economicsCases,
    materialContradictions: recommendation.materialContradictions,
    readinessGates,
    limitations: recommendation.limitations,
  };
  return {
    decisionInput,
    costTruth: execution.costTruth,
    expectedEvidenceSetHash: ledgerEvidenceSetHash(authority.authorityHash, ledger),
    expectedReceiptSetHash: ledgerExecutionReceiptSetHash(
      authority.authorityHash,
      ledger,
      decidedAt,
    ),
    evidenceSummary: {
      comparatorCount: comparatorCoverage.comparatorCount,
      reviewObservationCount: comparatorCoverage.reviewObservationCount,
      buyerEvidence: buyerEvidenceCoverage,
      sourceCount: evidenceState.sources.length,
      evidenceCount: evidenceState.evidence.length,
      formatCaseCount: formatCases.length,
      channelCaseCount: channelCases.length,
      economicsCaseCount: economicsCases.length,
      readinessGateCount: readinessGates.length,
    },
  };
}

function assertAuthorityScope(authority, readinessSpec, authorityHash, registered) {
  try {
    validatePreventureResearchAuthority(authority, readinessSpec);
  } catch (error) {
    fail(
      "preventure_research_finalizer_authority_invalid",
      `The exact research authority or starting readiness binding is invalid: ${String(error.message || error)}`,
      {},
      500,
    );
  }
  if (
    authorityHash !== authority.authorityHash
    || !sameCanonical(authority, registered.authority)
    || !sameCanonical(readinessSpec, registered.readinessSpec)
  ) {
    fail(
      "preventure_research_finalizer_authority_changed",
      "The finalizer is bound only to the exact approved pre-venture authority and readiness record.",
    );
  }
}

function assertExpectedHashes(input, ledger, readiness, mode, derived) {
  const expectedEvidenceSetHash = input.expectedEvidenceSetHash;
  const expectedReceiptSetHash = input.expectedReceiptSetHash;
  const evidenceSetHash = ledger.decision?.evidenceSetHash
    || derived?.expectedEvidenceSetHash
    || readiness?.evidence?.evidenceSetHash;
  const receiptSetHash = ledger.decision?.receiptSetHash
    || derived?.expectedReceiptSetHash
    || readiness?.evidence?.receiptSetHash;
  if (
    readiness
    && (
      readiness.evidence?.evidenceSetHash !== evidenceSetHash
      || readiness.evidence?.receiptSetHash !== receiptSetHash
    )
  ) {
    fail(
      "preventure_research_finalizer_evidence_changed",
      "Readiness and the deterministic finalizer disagree on the exact evidence or receipt set.",
    );
  }
  if (mode !== "preview") {
    assertHash(expectedEvidenceSetHash, "Expected evidence-set hash");
    assertHash(expectedReceiptSetHash, "Expected receipt-set hash");
    assertHash(input.expectedResultingReadinessHash, "Expected resulting-readiness hash");
  }
  if (
    (expectedEvidenceSetHash && expectedEvidenceSetHash !== evidenceSetHash)
    || (expectedReceiptSetHash && expectedReceiptSetHash !== receiptSetHash)
  ) {
    fail(
      "preventure_research_finalizer_evidence_changed",
      "The immutable evidence or receipt set changed. Refresh the exact decision before sealing it.",
    );
  }
  return { evidenceSetHash, receiptSetHash };
}

function completionInput(authority, decisionInput, actor, existing) {
  if (existing) {
    return {
      id: existing.id,
      occurredAt: existing.occurredAt,
      actor: existing.actor,
      reason: existing.reason,
    };
  }
  return {
    id: `${authority.id}_completed`,
    occurredAt: decisionInput.decidedAt,
    actor: assertText(actor || "pantheon", "Diligence completion actor"),
    reason: "The deterministic bounded diligence decision and superseding readiness result were sealed from the verified immutable ledger.",
  };
}

function exactResultTruth(authority, recorded, derived, expected, authorityRegistry) {
  const decision = recorded?.decision;
  if (!isObject(decision)) {
    fail(
      "preventure_research_finalizer_seal_failed",
      "The atomic store did not return a diligence decision.",
      {},
      500,
    );
  }
  try {
    validatePreventureResearchDecision(authority, decision);
  } catch (error) {
    fail(
      "preventure_research_finalizer_seal_failed",
      `The sealed diligence decision is invalid: ${String(error.message || error)}`,
      {},
      500,
    );
  }
  for (const [key, value] of Object.entries(derived.decisionInput)) {
    if (!sameCanonical(decision[key], value)) {
      fail(
        "preventure_research_finalizer_seal_failed",
        `The sealed decision changed its ledger-derived ${key}.`,
        {},
        500,
      );
    }
  }
  if (
    derived.decisionInput.completionMode === "validated_early_stop"
    && (
      !sameCanonical(recorded.stopRecord, derived.stopRecord)
      || !sameCanonical(recorded.skippedAssignments, derived.stopRecord.skippedAssignments)
    )
  ) {
    fail(
      "preventure_research_finalizer_seal_failed",
      "The atomic store changed the validated stop or exact skipped-assignment suffix.",
      {},
      500,
    );
  }
  if (
    decision.externalCommercialSpendAudCents !== 0
    || decision.estimatedInternalAiCostAudCents
      !== derived.costTruth.estimatedInternalAiCostAudCents
    || decision.reconciledInternalAiCostAudCents
      !== derived.costTruth.reconciledInternalAiCostAudCents
    || decision.unknownCostCount !== 0
    || decision.exactBillingPending !== derived.costTruth.exactBillingPending
    || decision.buildAuthorized !== false
    || decision.commercialTestAuthorized !== false
    || decision.externalActionAuthorized !== false
    || !sameCanonical(decision.nonOccurrenceRecord, NON_OCCURRENCE_RECORD)
    || !sameCanonical(decision.readinessBinding, authority.readinessBinding)
  ) {
    fail(
      "preventure_research_finalizer_non_occurrence_changed",
      "The sealed decision changed preparation-only authority or non-occurrence truth.",
      {},
      500,
    );
  }
  const resultingHash = preventureResultingReadinessHash(decision, authorityRegistry);
  if (
    recorded.resultingReadinessHash !== resultingHash
    || (expected.evidenceSetHash && decision.evidenceSetHash !== expected.evidenceSetHash)
    || (expected.receiptSetHash && decision.receiptSetHash !== expected.receiptSetHash)
  ) {
    fail(
      "preventure_research_finalizer_readiness_hash_changed",
      "The resulting readiness hash or its evidence binding changed while sealing.",
      {},
      500,
    );
  }
  return resultingHash;
}

function runTransaction(db, mode, operation) {
  if (!db || typeof db.exec !== "function") {
    fail(
      "preventure_research_finalizer_database_required",
      "The synchronous Pantheon database is required for an atomic final decision.",
      {},
      500,
    );
  }
  const nested = db.isTransaction === true;
  const savepoint = "preventure_research_finalizer";
  db.exec(nested ? `SAVEPOINT ${savepoint}` : "BEGIN IMMEDIATE");
  try {
    const result = operation();
    if (result && typeof result.then === "function") {
      fail(
        "preventure_research_finalizer_async_invalid",
        "The immutable decision transaction must complete synchronously.",
        {},
        500,
      );
    }
    if (mode === "preview") {
      if (nested) {
        db.exec(`ROLLBACK TO ${savepoint}`);
        db.exec(`RELEASE ${savepoint}`);
      } else {
        db.exec("ROLLBACK");
      }
    } else if (nested) {
      db.exec(`RELEASE ${savepoint}`);
    } else {
      db.exec("COMMIT");
    }
    return result;
  } catch (error) {
    try {
      if (nested) {
        db.exec(`ROLLBACK TO ${savepoint}`);
        db.exec(`RELEASE ${savepoint}`);
      } else if (db.isTransaction === true) {
        db.exec("ROLLBACK");
      }
    } catch {
      // Preserve the evidence or decision failure that caused the rollback.
    }
    throw error;
  }
}

function resolveStore(input, clock, authorityRegistry) {
  if (input.store) return input.store;
  const factory = input.storeFactory || createPreventureResearchStore;
  return factory(input.db, { clock, authorityRegistry });
}

function executeFinalizer(input = {}, mode = "commit") {
  const registered = resolveRegisteredAuthority(input);
  assertCurrentCandidateAuthority(registered);
  const { authority, readinessSpec, authorityRegistry } = registered;
  const authorityHash = input.authorityHash || authority.authorityHash;
  assertAuthorityScope(authority, readinessSpec, authorityHash, registered);
  const clock = typeof input.clock === "function" ? input.clock : () => new Date();
  const store = resolveStore(input, clock, authorityRegistry);
  for (const method of ["verifyLedger", "readLedger", "readState"]) {
    if (typeof store?.[method] !== "function") {
      fail(
        "preventure_research_finalizer_store_invalid",
        `The immutable research store is missing ${method}.`,
        {},
        500,
      );
    }
  }

  return runTransaction(input.db, mode, () => {
    const verifiedBefore = store.verifyLedger();
    if (!isObject(verifiedBefore) || verifiedBefore.ok !== true) {
      fail(
        "preventure_research_finalizer_ledger_invalid",
        "The pre-venture research ledger did not pass its integrity proof.",
        {},
        500,
      );
    }
    const ledger = store.readLedger(authorityHash);
    if (!sameCanonical(ledger.authority, authority)) {
      fail(
        "preventure_research_finalizer_authority_changed",
        "The stored research authority does not match the exact configured authority.",
      );
    }
    const derived = deriveDecisionInput(ledger, authority, input);
    if (ledger.decision) {
      for (const [key, value] of Object.entries(derived.decisionInput)) {
        if (!sameCanonical(ledger.decision[key], value)) {
          fail(
            "preventure_research_finalizer_replay_conflict",
            `The existing decision changed its ledger-derived ${key}.`,
          );
        }
      }
    }
    const state = store.readState(authorityHash);
    let readiness = null;
    if (!ledger.decision) {
      readiness = evaluatePreventureResearchReadiness(ledger, state, {
        generatedAt: derived.decisionInput.decidedAt,
        terminalStopRecord: derived.stopRecord || null,
      });
      if (
        !readiness.canSealDecision
        || (
          derived.decisionInput.completionMode === "full_round"
          && readiness.execution.completed !== REQUIRED_ASSIGNMENT_IDS.length
        )
        || readiness.execution.dispatchableAssignmentCount !== 0
      ) {
        fail(
          "preventure_research_finalizer_not_ready",
          `The bounded diligence round is not complete: ${readiness.completionBlockers.join(" ")}`,
        );
      }
      const outcomeBlockers = Array.isArray(
        readiness.outcomeBlockers?.[derived.decisionInput.outcome],
      ) ? readiness.outcomeBlockers[derived.decisionInput.outcome] : [];
      if (outcomeBlockers.length > 0) {
        fail(
          "preventure_research_finalizer_outcome_not_supported",
          `The immutable evidence cannot support ${derived.decisionInput.outcome}: ${outcomeBlockers.join(" ")}`,
        );
      }
    }
    const expected = assertExpectedHashes(input, ledger, readiness, mode, derived);
    const existingCompletion = ledger.lifecycle.find(
      (event) => event.eventType === "completed",
    ) || null;
    const completion = completionInput(
      authority,
      derived.decisionInput,
      input.actor,
      existingCompletion,
    );
    const earlyStop = derived.decisionInput.completionMode === "validated_early_stop";
    const recordMethod = earlyStop ? "recordValidatedEarlyStop" : "recordDecision";
    if (typeof store[recordMethod] !== "function") {
      fail(
        "preventure_research_finalizer_store_invalid",
        `The immutable research store is missing ${recordMethod}.`,
        {},
        500,
      );
    }
    const recorded = earlyStop
      ? store.recordValidatedEarlyStop(
          authorityHash,
          derived.stopRecord,
          derived.decisionInput,
          completion,
        )
      : store.recordDecision(
          authorityHash,
          derived.decisionInput,
          completion,
        );
    const resultingReadinessHash = exactResultTruth(
      authority,
      recorded,
      derived,
      expected,
      authorityRegistry,
    );
    if (
      mode !== "preview"
      && resultingReadinessHash !== input.expectedResultingReadinessHash
    ) {
      fail(
        "preventure_research_finalizer_readiness_hash_changed",
        "The exact resulting readiness hash changed. The decision was rolled back.",
      );
    }
    const verifiedAfter = store.verifyLedger();
    if (!isObject(verifiedAfter) || verifiedAfter.ok !== true) {
      fail(
        "preventure_research_finalizer_ledger_invalid",
        "The sealed decision did not pass the immutable ledger proof.",
        {},
        500,
      );
    }
    return {
      schema: PREVENTURE_RESEARCH_FINALIZER_SCHEMA,
      ...recorded,
      resultingReadinessHash,
      costTruth: derived.costTruth,
      evidenceSummary: derived.evidenceSummary,
      decisionEffect: {
        recommendationOnly: recorded.decision.outcome === "build",
        exactOfferWillingnessToPayProven: false,
        buyersProven: false,
        revenueProven: false,
        realisedContributionProven: false,
        buildAuthorized: false,
        commercialTestAuthorized: false,
        externalActionAuthorized: false,
        nextProtectedStep: recorded.decision.outcome === "build"
          ? "Prepare a separate smallest-build proposal for owner review."
          : recorded.decision.completionMode === "validated_early_stop"
            ? recorded.decision.nextEvidenceAction.action
            : null,
      },
      preview: mode === "preview",
      expectedEvidenceSetHash: recorded.decision.evidenceSetHash,
      expectedReceiptSetHash: recorded.decision.receiptSetHash,
      expectedResultingReadinessHash: resultingReadinessHash,
    };
  });
}

function finalizePreventureResearchDecision(input = {}) {
  return executeFinalizer(input, "commit");
}

function previewPreventureResearchDecision(input = {}) {
  return executeFinalizer(input, "preview");
}

function describePreventureResearchFinalization(input = {}) {
  let authorityHash = input.authorityHash || input.authority?.authorityHash || null;
  try {
    const registered = resolveRegisteredAuthority(input);
    authorityHash = registered.authority.authorityHash;
    const preview = previewPreventureResearchDecision(input);
    if (preview.created === false) {
      return {
        schema: PREVENTURE_RESEARCH_FINALIZATION_READINESS_SCHEMA,
        ready: false,
        completed: true,
        authorityHash,
        evidenceSetHash: preview.expectedEvidenceSetHash,
        receiptSetHash: preview.expectedReceiptSetHash,
        resultingReadinessHash: preview.expectedResultingReadinessHash,
        outcome: preview.decision.outcome,
        blockers: ["The bounded diligence result is already sealed."],
        code: "preventure_research_finalizer_already_completed",
        buildAuthorized: false,
        commercialTestAuthorized: false,
        externalActionAuthorized: false,
      };
    }
    return {
      schema: PREVENTURE_RESEARCH_FINALIZATION_READINESS_SCHEMA,
      ready: true,
      completed: false,
      authorityHash,
      evidenceSetHash: preview.expectedEvidenceSetHash,
      receiptSetHash: preview.expectedReceiptSetHash,
      resultingReadinessHash: preview.expectedResultingReadinessHash,
      outcome: preview.decision.outcome,
      blockers: [],
      buildAuthorized: false,
      commercialTestAuthorized: false,
      externalActionAuthorized: false,
    };
  } catch (error) {
    return {
      schema: PREVENTURE_RESEARCH_FINALIZATION_READINESS_SCHEMA,
      ready: false,
      completed: false,
      authorityHash,
      evidenceSetHash: null,
      receiptSetHash: null,
      resultingReadinessHash: null,
      outcome: null,
      blockers: [String(error?.message || "The deterministic final decision is not ready.")],
      code: error?.code || "preventure_research_finalizer_not_ready",
      buildAuthorized: false,
      commercialTestAuthorized: false,
      externalActionAuthorized: false,
    };
  }
}

function createPreventureResearchFinalizer(options = {}) {
  const registered = resolveRegisteredAuthority(options);
  const finalize = (input = {}) => finalizePreventureResearchDecision({
    ...options,
    ...input,
    authorityRegistry: registered.authorityRegistry,
    authority: registered.authority,
    readinessSpec: registered.readinessSpec,
    storeFactory: options.storeFactory || input.storeFactory,
  });
  Object.defineProperty(finalize, "preview", {
    enumerable: true,
    value: (input = {}) => previewPreventureResearchDecision({
      ...options,
      ...input,
      authorityRegistry: registered.authorityRegistry,
      authority: registered.authority,
      readinessSpec: registered.readinessSpec,
      storeFactory: options.storeFactory || input.storeFactory,
    }),
  });
  Object.defineProperty(finalize, "describeFinalization", {
    enumerable: true,
    value: (input = {}) => describePreventureResearchFinalization({
      ...options,
      ...input,
      authorityRegistry: registered.authorityRegistry,
      authority: registered.authority,
      readinessSpec: registered.readinessSpec,
      storeFactory: options.storeFactory || input.storeFactory,
    }),
  });
  return finalize;
}

module.exports = {
  NON_OCCURRENCE_RECORD,
  PREVENTURE_RESEARCH_FINALIZATION_READINESS_SCHEMA,
  PREVENTURE_RESEARCH_FINALIZER_SCHEMA,
  PreventureResearchFinalizerError,
  createPreventureResearchFinalizer,
  describePreventureResearchFinalization,
  finalizePreventureResearchDecision,
  previewPreventureResearchDecision,
};
