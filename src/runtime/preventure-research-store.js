"use strict";

const {
  withPreventureOwnerBillingObservationCapability,
  withPreventureProviderCostReconciliationCapability,
  withPreventureTerminalReceiptCapability,
  withPreventureTerminalRetainedRecoveryCapability,
  withPreventureValidatedEarlyStopCapability,
} = require("../db");
const {
  consumeAuthenticatedOwnerBillingObservationAttestation,
} = require("./local-security");
const {
  defaultPreventureResearchAuthorityRegistry,
} = require("./preventure-research-authority-registry");
const {
  HISTORICAL_PREVENTURE_APPROVAL_AUTHORITY,
  HISTORICAL_PREVENTURE_APPROVAL_DECISION_RECEIPT_SCHEMA,
  HISTORICAL_PREVENTURE_APPROVAL_DECISION_SOURCE,
  HISTORICAL_PREVENTURE_APPROVAL_DECISIONS,
  HISTORICAL_PREVENTURE_APPROVAL_PRIOR_PENDING_KEYS,
  HISTORICAL_PREVENTURE_APPROVAL_RECEIPT_KEYS,
  historicalPreventureApprovalDecisionEntry,
} = require("./preventure-research-historical-approval-manifest");
const {
  PREVENTURE_RESEARCH_APPROVAL_SCOPE_SCHEMA,
  PREVENTURE_RESEARCH_AUTHORITY_SCHEMA,
  PREVENTURE_RESEARCH_DECISION_SCHEMA,
  PREVENTURE_RESEARCH_LIFECYCLE_SCHEMA,
  RENEWAL_ADMISSIBLE_PREDECESSOR_EVENTS,
  REQUIRED_READINESS_GATE_IDS,
  TERMINAL_EVENT_TYPES,
  createPreventureLifecycleEvent,
  createPreventureResearchDecision,
  effectivePreventureLifecycleState,
  lifecycleState,
  preventureResearchApprovalScope,
  preventureResearchApprovalScopeHash,
  validatePreventureLifecycleChain,
  validatePreventureResearchAuthority,
  validatePreventureResearchDecision,
} = require("./preventure-research-contract");
const { sha256 } = require("./commercial-test-contract");
const {
  evaluatePreventureResearchReadiness,
} = require("./preventure-research-readiness");
const {
  derivePreventureResearchPublicSourceBinding,
} = require("./preventure-research-source-identity");
const {
  createPreventureResearchTerminalStop,
  validatePreventureResearchAssignmentSkip,
  validatePreventureResearchTerminalStop,
} = require("./preventure-research-terminal-stop");

const PREVENTURE_RESEARCH_ASSIGNMENT_SCHEMA = "pantheon.preventure-research-assignment.v1";
const PREVENTURE_RESEARCH_COST_SCHEMA = "pantheon.preventure-research-cost-event.v1";
const PREVENTURE_RESEARCH_PROVIDER_COST_RECONCILIATION_SCHEMA =
  "pantheon.preventure-research-provider-cost-reconciliation.v1";
const PREVENTURE_RESEARCH_OWNER_BILLING_OBSERVATION_SCHEMA =
  "pantheon.owner-attested-provider-billing-observation.v1";
const PREVENTURE_RESEARCH_OWNER_BILLING_ACTION_KIND =
  "owner_attested_provider_billing_observation";
const PREVENTURE_RESEARCH_OWNER_BILLING_TRUTH_STATUS =
  "owner_attested_not_provider_settled";
const PREVENTURE_RESEARCH_OWNER_BILLING_ALLOCATION_METHOD =
  "owner_observed_provider_billing_allocated_to_original_dispatch";
// The pre-attestation reconciliation implementation remains readable only so
// historical schema-27 receipts can still be verified. No caller can obtain
// this private sentinel, so every runtime write must use the owner-observation
// seam above instead.
const RETIRED_PROVIDER_COST_RECONCILIATION_SENTINEL = Object.freeze(
  Object.create(null),
);
const STRUCTURAL_ARTIFACT_VERIFICATION_TOKEN = Object.freeze(
  Object.create(null),
);
const PREVENTURE_RESEARCH_TERMINAL_RECOVERY_SCHEMA =
  "pantheon.preventure-research-terminal-retained-recovery.v1";
const PREVENTURE_RESEARCH_TERMINAL_COST_TRANSITION_SCHEMA =
  "pantheon.preventure-research-terminal-cost-transition.v1";
const IMMUTABLE_PREVENTURE_OUTPUT_STORE_KIND = "immutable_preventure_provider_output_v1";
const PREVENTURE_RESEARCH_SOURCE_SCHEMA = "pantheon.preventure-research-source-snapshot.v1";
const PREVENTURE_RESEARCH_EVIDENCE_SCHEMA = "pantheon.preventure-research-evidence.v1";

const LEDGER_TABLES = Object.freeze({
  authorities: "preventure_research_authorities",
  approvalDecisions: "preventure_research_approval_decisions",
  lifecycleEvents: "preventure_research_lifecycle_events",
  assignments: "preventure_research_assignments",
  costEvents: "preventure_research_cost_events",
  ownerBillingObservations: "preventure_research_provider_billing_observations",
  terminalRecoveries: "preventure_research_terminal_recoveries",
  terminalStops: "preventure_research_terminal_stops",
  assignmentSkips: "preventure_research_assignment_skips",
  sourceSnapshots: "preventure_research_source_snapshots",
  evidenceRecords: "preventure_research_evidence_records",
  decisions: "preventure_research_decisions",
});

const HASH_PATTERN = /^sha256:[a-f0-9]{64}$/;
const PROVIDER_RESPONSE_ID_PATTERN = /^resp_[A-Za-z0-9._:-]{1,195}$/;
const SAFE_ID_PATTERN = /^[a-z0-9][a-z0-9._:-]{0,127}$/i;
const COST_EVENT_TYPES = new Set([
  "reserved", "estimated", "incurred", "reconciled", "released", "unknown",
]);
const SOURCE_CAPTURE_STATUSES = new Set(["captured", "partial", "unavailable", "blocked"]);
const EVIDENCE_TRUTH_CLASSES = new Set([
  "assumption", "estimate", "model_inference", "observed_fact",
  "owner_attestation", "owner_preference", "proven_pantheon_learning", "unknown",
]);
const EVIDENCE_POLARITIES = new Set(["supporting", "contrary", "neutral", "unknown"]);
const EVIDENCE_CONFIDENCE = new Set(["low", "medium", "high", "unknown"]);
const COMPARATOR_CATEGORIES = new Set(["direct_or_near_direct", "adjacent", "indirect"]);
const EVIDENCE_DETAIL_KEYS = Object.freeze([
  "buyerEvidence",
  "channelCase",
  "comparator",
  "economicsCase",
  "formatCase",
  "readinessGate",
  "recommendation",
]);
const BUYER_EVIDENCE_KINDS = new Set([
  "consequence",
  "workaround_or_spending_trigger",
  "purchaser_attributable_behaviour",
]);
const FORMAT_DISPOSITIONS = new Set(["retain", "revise", "reject"]);
const CHANNEL_STATES = new Set([
  "available", "conditional_unverified", "conditionally_preferred", "discovery_only",
  "not_selected", "not_verified", "protected_verification_required", "recommended",
  "rejected", "research_more",
]);
const ECONOMICS_STATES = new Set(["estimated", "known_zero", "unknown", "not_applicable"]);
const READINESS_GATE_STATUSES = new Set([
  "supported", "partially_supported", "unresolved", "contradicted",
  "owner_input_recorded", "protected_verification_required",
]);

class PreventureResearchStoreError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "PreventureResearchStoreError";
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details) {
  throw new PreventureResearchStoreError(code, message, details);
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

function canonicalJson(value) {
  return JSON.stringify(canonical(value));
}

function sameCanonical(left, right) {
  return canonicalJson(left) === canonicalJson(right);
}

function emergencyStopEventHash(row) {
  return sha256({
    id: Number(row.id),
    ts: String(row.ts),
    level: String(row.level),
    actor: String(row.actor),
    type: String(row.type),
    entityType: row.entity_type === null ? null : String(row.entity_type),
    entityId: row.entity_id === null ? null : String(row.entity_id),
    message: String(row.message),
    metadata: parseObject(row.metadata, `Emergency event ${row.id} metadata`),
  });
}

function deriveSourceIdentityBinding(url, publisher) {
  if (!url) {
    return {
      canonicalUrl: null,
      canonicalHost: null,
      sourceIdentityUrl: null,
      sourceIdentityHash: null,
      marketplaceChannelId: null,
      offerIdentityKey: null,
      sellerIdentityKey: null,
      identityDerivation: null,
      publisherIdentityKey: null,
      buyerIndependenceGroup: null,
    };
  }
  // Public-source independence is an observable host binding. The retained
  // publisher label is useful evidence metadata, but it must not create a
  // second, store-only identity that contradicts the runner and finalizer.
  return derivePreventureResearchPublicSourceBinding(url);
}

function hasExactKeys(value, expected) {
  return isObject(value)
    && sameCanonical(Object.keys(value).sort(), [...expected].sort());
}

function boundedTextList(value, label, options = {}) {
  const minimum = options.minimum ?? 0;
  const maximum = options.maximum ?? 20;
  if (
    !Array.isArray(value)
    || value.length < minimum
    || value.length > maximum
    || new Set(value).size !== value.length
  ) {
    fail(
      "preventure_research_record_invalid",
      `${label} must contain ${minimum} to ${maximum} unique retained statements.`,
    );
  }
  return value.map((item, index) => cleanText(item, `${label} ${index + 1}`, 3));
}

function parseObject(value, label) {
  let parsed;
  try {
    parsed = JSON.parse(String(value));
  } catch {
    fail("preventure_research_ledger_integrity_failed", `${label} is not valid JSON.`);
  }
  if (!isObject(parsed)) {
    fail("preventure_research_ledger_integrity_failed", `${label} must contain one JSON object.`);
  }
  return parsed;
}

function cleanId(value, label) {
  const result = String(value ?? "").trim();
  if (!SAFE_ID_PATTERN.test(result)) fail("preventure_research_input_invalid", `${label} is invalid.`);
  return result;
}

function cleanText(value, label, minimum = 1) {
  const result = String(value ?? "").replace(/\s+/g, " ").trim();
  if (result.length < minimum) fail("preventure_research_input_invalid", `${label} is incomplete.`);
  return result;
}

function exactInteger(value, label, minimum = 0) {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < minimum) {
    fail("preventure_research_input_invalid", `${label} must be an integer of at least ${minimum}.`);
  }
  return result;
}

function exactTimestamp(value, label) {
  const result = value instanceof Date ? value.toISOString() : String(value ?? "").trim();
  if (!Number.isFinite(Date.parse(result))) {
    fail("preventure_research_input_invalid", `${label} must be a valid timestamp.`);
  }
  return result;
}

function exactHash(value, label, nullable = false) {
  if (nullable && (value === null || value === undefined)) return null;
  const result = String(value || "");
  if (!HASH_PATTERN.test(result)) fail("preventure_research_input_invalid", `${label} is invalid.`);
  return result;
}

function canonicalAgentReceiptHash(value) {
  const result = String(value || "");
  if (/^[a-f0-9]{64}$/.test(result)) return `sha256:${result}`;
  return exactHash(result, "Canonical agent receipt hash");
}

function sqlBoolean(value) {
  return value === true ? 1 : 0;
}

function assertProjection(row, expected, label, ignored = []) {
  const excluded = new Set(ignored);
  for (const [column, value] of Object.entries(expected)) {
    if (excluded.has(column)) continue;
    if (!sameCanonical(row[column] ?? null, value ?? null)) {
      fail(
        "preventure_research_ledger_integrity_failed",
        `${label} projection ${column} contradicts its immutable JSON.`,
      );
    }
  }
}

function insertProjection(db, table, projection) {
  const columns = Object.keys(projection);
  db.prepare(
    `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`,
  ).run(...columns.map((column) => projection[column] ?? null));
}

function createAtomicRunner(db) {
  let savepointSequence = 0;
  return function atomic(action) {
    if (db.isTransaction) {
      const savepoint = `preventure_research_store_${++savepointSequence}`;
      db.exec(`SAVEPOINT ${savepoint}`);
      try {
        const result = action();
        db.exec(`RELEASE SAVEPOINT ${savepoint}`);
        return result;
      } catch (error) {
        db.exec(`ROLLBACK TO SAVEPOINT ${savepoint}`);
        db.exec(`RELEASE SAVEPOINT ${savepoint}`);
        throw error;
      }
    }
    db.exec("BEGIN IMMEDIATE");
    try {
      const result = action();
      db.exec("COMMIT");
      return result;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  };
}

function hashBody(record, hashKey) {
  const { [hashKey]: _hash, ...body } = record;
  return body;
}

function sealedRecord(body, hashKey) {
  return Object.freeze({ ...body, [hashKey]: sha256(body) });
}

function authorityProjection(authority, readinessSpec, createdAt) {
  return {
    authority_hash: authority.authorityHash,
    authority_schema: authority.schema,
    authority_id: authority.id,
    authority_version: authority.version,
    readiness_id: authority.readinessBinding.id,
    readiness_version: authority.readinessBinding.version,
    readiness_hash: authority.readinessBinding.hash,
    provider_id: authority.provider.id,
    provider_model: authority.provider.model,
    approved_at: authority.approvedAt,
    expires_at: authority.expiresAt,
    internal_ai_spend_cap_aud_cents: authority.internalAiSpendCapAudCents,
    total_worst_case_exposure_aud_cents: authority.totalWorstCaseExposureAudCents,
    external_commercial_spend_cap_aud_cents: authority.externalCommercialSpendCapAudCents,
    supersedes_authority_hash: authority.supersedesAuthorityHash ?? null,
    authority_json: canonicalJson(authority),
    readiness_json: canonicalJson(readinessSpec),
    created_at: createdAt,
  };
}

function assertExactAuthority(
  authority,
  readinessSpec,
  authorityRegistry = defaultPreventureResearchAuthorityRegistry,
) {
  validatePreventureResearchAuthority(authority, readinessSpec);
  let entry;
  try {
    entry = authorityRegistry.resolveAuthorityEntry(authority.authorityHash, {
      id: authority.id,
      version: authority.version,
    });
  } catch (error) {
    fail(
      error?.code || "preventure_research_authority_not_pinned",
      String(error?.message || "The authority is not present in the immutable registry."),
    );
  }
  if (
    !sameCanonical(authority, entry.authority)
    || !sameCanonical(readinessSpec, entry.readinessSpec)
  ) {
    fail(
      "preventure_research_authority_not_pinned",
      "The authority or readiness record does not match the exact owner-approved configuration.",
    );
  }
  return entry;
}

function readAuthorityEntryRow(
  row,
  authorityRegistry = defaultPreventureResearchAuthorityRegistry,
) {
  const authority = parseObject(row.authority_json, "Pre-venture research authority JSON");
  const readinessSpec = parseObject(row.readiness_json, "Pre-venture research readiness JSON");
  const entry = assertExactAuthority(authority, readinessSpec, authorityRegistry);
  assertProjection(row, authorityProjection(authority, readinessSpec, row.created_at), "Authority");
  return entry;
}

function readAuthorityRow(
  row,
  authorityRegistry = defaultPreventureResearchAuthorityRegistry,
) {
  return readAuthorityEntryRow(row, authorityRegistry).authority;
}

function lifecycleProjection(event, createdAt) {
  return {
    id: event.id,
    authority_hash: event.authorityHash,
    sequence: event.sequence,
    previous_event_hash: event.previousEventHash,
    event_type: event.eventType,
    event_hash: event.eventHash,
    approval_id: event.approvalId,
    approval_scope_hash: event.approvalScopeHash,
    actor: event.actor,
    reason: event.reason,
    metadata: canonicalJson(event.metadata),
    decision_hash: event.metadata.decisionHash ?? null,
    successor_authority_hash: event.metadata.successorAuthorityHash ?? null,
    event_json: canonicalJson(event),
    occurred_at: event.occurredAt,
    created_at: createdAt,
  };
}

function approvalPayloadMatches(row, expectedScope, expectedHash) {
  const payload = parseObject(row.payload, "Pre-venture approval payload");
  const candidates = [
    payload.preventureResearchApprovalScope,
    payload.preventureLifecycleApprovalScope,
    payload.approvalScope,
    payload.scope,
  ].filter(isObject);
  if (candidates.length === 0 || !candidates.every((candidate) => sameCanonical(candidate, expectedScope))) {
    return false;
  }
  const hashes = [
    payload.preventureResearchApprovalScopeHash,
    payload.preventureLifecycleApprovalScopeHash,
    payload.approvalScopeHash,
  ].filter((value) => value !== undefined);
  return hashes.length > 0 && hashes.every((value) => value === expectedHash);
}

function exactHistoricalApprovalDecisionReceipt(stored, receipt, entry) {
  return Boolean(
    stored
    && receipt
    && entry
    && hasExactKeys(receipt, HISTORICAL_PREVENTURE_APPROVAL_RECEIPT_KEYS)
    && hasExactKeys(
      receipt.priorPending,
      HISTORICAL_PREVENTURE_APPROVAL_PRIOR_PENDING_KEYS,
    )
    && receipt.schema === entry.receiptSchema
    && receipt.receiptHash === entry.receiptHash
    && receipt.receiptHash === sha256(hashBody(receipt, "receiptHash"))
    && receipt.approvalId === entry.approvalId
    && receipt.authorityHash === entry.authorityHash
    && receipt.eventType === entry.eventType
    && receipt.scopeHash === entry.scopeHash
    && receipt.priorPending.status === "pending"
    && receipt.priorPending.requestedBy === entry.requestedBy
    && receipt.priorPending.requestedAt === entry.requestedAt
    && receipt.priorPending.decidedAt === null
    && receipt.priorPending.decidedBy === null
    && receipt.priorPending.consumedAt === null
    && receipt.decisionStatus === entry.decisionStatus
    && receipt.decidedBy === entry.decidedBy
    && receipt.decisionSource === entry.decisionSource
    && receipt.decidedAt === entry.decidedAt
    && stored.decision_receipt_hash === entry.receiptHash
    && stored.approval_id === entry.approvalId
    && stored.authority_hash === entry.authorityHash
    && stored.event_type === entry.eventType
    && stored.scope_hash === entry.scopeHash
    && stored.requested_by === entry.requestedBy
    && stored.requested_at === entry.requestedAt
    && stored.decided_by === entry.decidedBy
    && stored.decision_source === entry.decisionSource
    && stored.decision_status === entry.decisionStatus
    && stored.decided_at === entry.decidedAt
    && stored.created_at === entry.createdAt
  );
}

function assertExactHistoricalApprovalDecisionSet(db) {
  const rows = db.prepare(
    `SELECT * FROM preventure_research_approval_decisions
     WHERE decision_source = ?
        OR json_extract(receipt_json, '$.schema') = ?
     ORDER BY decision_receipt_hash`,
  ).all(
    HISTORICAL_PREVENTURE_APPROVAL_DECISION_SOURCE,
    HISTORICAL_PREVENTURE_APPROVAL_DECISION_RECEIPT_SCHEMA,
  );
  if (rows.length === 0) return;
  if (rows.length !== HISTORICAL_PREVENTURE_APPROVAL_DECISIONS.length) {
    fail(
      "preventure_research_approval_identity_invalid",
      "Historical pre-venture owner-decision evidence is not the exact complete pinned pair.",
    );
  }
  for (const entry of HISTORICAL_PREVENTURE_APPROVAL_DECISIONS) {
    const stored = rows.find((row) => row.decision_receipt_hash === entry.receiptHash);
    const receipt = stored
      ? parseObject(stored.receipt_json, "Historical pre-venture owner-decision receipt")
      : null;
    if (!exactHistoricalApprovalDecisionReceipt(stored, receipt, entry)) {
      fail(
        "preventure_research_approval_identity_invalid",
        "Historical pre-venture owner-decision evidence changed from its exact pinned record.",
      );
    }
  }
}

function assertApprovalDecisionReceipt(db, authority, eventType, approval, occurredAt) {
  const stored = db.prepare(
    "SELECT * FROM preventure_research_approval_decisions WHERE approval_id = ?",
  ).get(approval.id);
  const receipt = stored
    ? parseObject(stored.receipt_json, "Pre-venture owner-decision receipt")
    : null;
  const expectedScopeHash = preventureResearchApprovalScopeHash(authority, eventType);
  const historicalEntry = historicalPreventureApprovalDecisionEntry({
    receiptHash: stored?.decision_receipt_hash,
    approvalId: approval.id,
  });
  if (
    exactHistoricalApprovalDecisionReceipt(stored, receipt, historicalEntry)
    && authority.authorityHash === HISTORICAL_PREVENTURE_APPROVAL_AUTHORITY.authorityHash
    && authority.id === HISTORICAL_PREVENTURE_APPROVAL_AUTHORITY.authorityId
    && authority.version === HISTORICAL_PREVENTURE_APPROVAL_AUTHORITY.authorityVersion
    && authority.expiresAt === HISTORICAL_PREVENTURE_APPROVAL_AUTHORITY.expiresAt
    && eventType === historicalEntry.eventType
    && occurredAt === historicalEntry.decidedAt
    && expectedScopeHash === historicalEntry.scopeHash
    && approval.status === historicalEntry.decisionStatus
    && approval.requested_by === historicalEntry.requestedBy
    && approval.requested_at === historicalEntry.requestedAt
    && approval.decided_by === historicalEntry.decidedBy
    && approval.decided_at === historicalEntry.decidedAt
    && approval.expires_at === HISTORICAL_PREVENTURE_APPROVAL_AUTHORITY.expiresAt
  ) return receipt;
  if (
    !receipt
    || !hasExactKeys(receipt, [
      "schema", "approvalId", "authorityHash", "eventType", "scopeHash",
      "priorPending", "decisionStatus", "decidedBy", "decisionSource",
      "decisionNoteHash", "decidedAt", "receiptHash",
    ])
    || !hasExactKeys(receipt.priorPending, [
      "status", "requestedBy", "requestedAt", "decidedAt", "decidedBy", "consumedAt",
    ])
    || receipt.schema !== "pantheon.preventure-research-approval-decision.v2"
    || receipt.receiptHash !== sha256(hashBody(receipt, "receiptHash"))
    || receipt.approvalId !== approval.id
    || receipt.authorityHash !== authority.authorityHash
    || receipt.eventType !== eventType
    || receipt.scopeHash !== expectedScopeHash
    || receipt.priorPending.status !== "pending"
    || receipt.priorPending.requestedBy !== "jarvis"
    || receipt.priorPending.requestedAt !== approval.requested_at
    || receipt.priorPending.decidedAt !== null
    || receipt.priorPending.decidedBy !== null
    || receipt.priorPending.consumedAt !== null
    || receipt.decisionStatus !== "approved"
    || receipt.decidedBy !== "owner"
    || !HASH_PATTERN.test(String(receipt.decisionNoteHash || ""))
    || receipt.decisionSource !== "authenticated_owner_session_attestation"
    || receipt.decidedAt !== occurredAt
    || stored.decision_receipt_hash !== receipt.receiptHash
    || stored.authority_hash !== receipt.authorityHash
    || stored.event_type !== receipt.eventType
    || stored.scope_hash !== receipt.scopeHash
    || stored.requested_by !== receipt.priorPending.requestedBy
    || stored.requested_at !== receipt.priorPending.requestedAt
    || stored.decided_by !== receipt.decidedBy
    || stored.decision_source !== receipt.decisionSource
    || stored.decision_status !== receipt.decisionStatus
    || stored.decided_at !== receipt.decidedAt
  ) {
    fail(
      "preventure_research_approval_identity_invalid",
      "The lifecycle approval lacks its exact immutable owner-decision receipt.",
    );
  }
  return receipt;
}

function assertHistoricalApproval(db, authority, event) {
  if (!["accepted", "activated"].includes(event.eventType)) return;
  const expectedScope = preventureResearchApprovalScope(authority, event.eventType);
  const expectedHash = preventureResearchApprovalScopeHash(authority, event.eventType);
  const row = db.prepare(
    `SELECT id, venture_id, workflow_id, task_id, scope, title, status, risk_level,
            requested_by, requested_at, decided_by, scope_hash, payload, expected_effects,
            decided_at, expires_at, consumed_at
     FROM approvals WHERE id = ?`,
  ).get(event.approvalId);
  const expectedTitle = event.eventType === "accepted"
    ? "Accept this exact bounded research authority?"
    : "Activate this exact bounded internal research round?";
  if (
    !row
    || row.status !== "approved"
    || row.venture_id !== null
    || row.workflow_id !== null
    || row.task_id !== null
    || !sameCanonical(parseObject(row.scope, "Pre-venture approval scope"), expectedScope)
    || row.title !== expectedTitle
    || row.risk_level !== "high"
    || row.requested_by !== "jarvis"
    || row.decided_by !== "owner"
    || row.scope_hash !== expectedHash
    || !approvalPayloadMatches(row, expectedScope, expectedHash)
    || !sameCanonical(JSON.parse(String(row.expected_effects || "null")), [])
    || event.actor !== "owner"
    || row.decided_at !== event.occurredAt
    || row.consumed_at !== event.occurredAt
  ) {
    fail(
      "preventure_research_ledger_integrity_failed",
      `Lifecycle event ${event.id} does not retain its exact single-use approval evidence.`,
    );
  }
  const decidedAt = Date.parse(String(row.decided_at || ""));
  const occurredAt = Date.parse(event.occurredAt);
  const expiresAt = row.expires_at ? Date.parse(row.expires_at) : Number.POSITIVE_INFINITY;
  if (!Number.isFinite(decidedAt) || decidedAt > occurredAt || expiresAt <= occurredAt) {
    fail(
      "preventure_research_ledger_integrity_failed",
      `Lifecycle approval ${row.id} was not valid when it was consumed.`,
    );
  }
  assertApprovalDecisionReceipt(db, authority, event.eventType, row, event.occurredAt);
}

function loadLifecycleRows(db, authority) {
  assertExactHistoricalApprovalDecisionSet(db);
  const rows = db.prepare(
    `SELECT * FROM preventure_research_lifecycle_events
     WHERE authority_hash = ? ORDER BY sequence`,
  ).all(authority.authorityHash);
  const events = rows.map((row) => {
    const event = parseObject(row.event_json, "Pre-venture lifecycle event JSON");
    assertProjection(row, lifecycleProjection(event, row.created_at), `Lifecycle event ${row.id}`);
    assertHistoricalApproval(db, authority, event);
    return event;
  });
  validatePreventureLifecycleChain(authority, events);
  return events;
}

function assignmentProjection(assignment, createdAt) {
  return {
    assignment_hash: assignment.assignmentHash,
    authority_hash: assignment.authorityHash,
    activation_event_hash: assignment.activationEventHash,
    assignment_id: assignment.id,
    assignment_version: assignment.version,
    template_hash: assignment.templateHash,
    workflow_id: assignment.workflowId,
    task_id: assignment.taskId,
    provider_id: assignment.provider,
    provider_model: assignment.model,
    max_cost_aud_cents: assignment.maxCostAudCents,
    max_attempts: assignment.maxAttempts,
    max_tool_calls: assignment.maxToolCalls,
    maximum_model_passes: assignment.maximumModelPasses,
    max_input_tokens: assignment.maxInputTokens,
    local_prompt_preflight_max_input_tokens: assignment.localPromptPreflightMaxInputTokens,
    max_output_tokens: assignment.maxOutputTokens,
    max_turns: assignment.maxTurns,
    deadline_ms: assignment.deadlineMs,
    worst_case_exposure_json: canonicalJson(assignment.worstCaseExposure),
    expires_at: assignment.expiresAt,
    assignment_json: canonicalJson(assignment),
    assigned_at: assignment.assignedAt,
    created_at: createdAt,
  };
}

function expectedTaskEnvelope(assignment) {
  return {
    schema: "pantheon.preventure-research-task-envelope.v1",
    authorityHash: assignment.authorityHash,
    activationEventHash: assignment.activationEventHash,
    assignmentId: assignment.id,
    assignmentVersion: assignment.version,
    templateHash: assignment.templateHash,
    provider: assignment.provider,
    model: assignment.model,
    method: "openai_responses_web_search",
    tool: "web_search",
    limits: {
      maxCostAudCents: assignment.maxCostAudCents,
      maxAttempts: assignment.maxAttempts,
      maxToolCalls: assignment.maxToolCalls,
      maximumModelPasses: assignment.maximumModelPasses,
      maxInputTokens: assignment.maxInputTokens,
      localPromptPreflightMaxInputTokens: assignment.localPromptPreflightMaxInputTokens,
      maxOutputTokens: assignment.maxOutputTokens,
      maxTurns: assignment.maxTurns,
      deadlineMs: assignment.deadlineMs,
      worstCaseExposure: assignment.worstCaseExposure,
    },
    expiresAt: assignment.expiresAt,
    preparationOnly: true,
    externalEffects: [],
    externalCommercialSpendCapAudCents: 0,
    buildAuthorized: false,
    commercialTestAuthorized: false,
    externalActionAuthorized: false,
  };
}

function readAssignmentRow(db, row, authority) {
  const assignment = parseObject(row.assignment_json, "Pre-venture assignment JSON");
  if (
    assignment.schema !== PREVENTURE_RESEARCH_ASSIGNMENT_SCHEMA
    || assignment.assignmentHash !== sha256(hashBody(assignment, "assignmentHash"))
  ) {
    fail("preventure_research_ledger_integrity_failed", `Assignment ${row.assignment_id} hash is invalid.`);
  }
  const template = authority.assignments.find(
    (item) => item.id === assignment.id && item.version === assignment.version,
  );
  if (!template || assignment.templateHash !== sha256(template)) {
    fail(
      "preventure_research_ledger_integrity_failed",
      `Assignment ${row.assignment_id} is not the exact approved template.`,
    );
  }
  const templateFields = {
    provider: template.provider,
    model: template.model,
    maxCostAudCents: template.maxCostAudCents,
    maxAttempts: template.maxAttempts,
    maxToolCalls: template.maxToolCalls,
    maximumModelPasses: template.maximumModelPasses,
    maxInputTokens: template.maxInputTokens,
    localPromptPreflightMaxInputTokens: template.localPromptPreflightMaxInputTokens,
    maxOutputTokens: template.maxOutputTokens,
    maxTurns: template.maxTurns,
    deadlineMs: template.deadlineMs,
    worstCaseExposure: template.worstCaseExposure,
  };
  for (const [key, value] of Object.entries(templateFields)) {
    if (!sameCanonical(assignment[key], value)) {
      fail("preventure_research_ledger_integrity_failed", `Assignment ${row.assignment_id} changed ${key}.`);
    }
  }
  if (assignment.authorityHash !== authority.authorityHash || assignment.expiresAt !== authority.expiresAt) {
    fail("preventure_research_ledger_integrity_failed", `Assignment ${row.assignment_id} is outside its authority.`);
  }
  assertProjection(row, assignmentProjection(assignment, row.created_at), `Assignment ${row.assignment_id}`);
  const activation = db.prepare(
    `SELECT event_type FROM preventure_research_lifecycle_events
     WHERE authority_hash = ? AND event_hash = ?`,
  ).get(authority.authorityHash, assignment.activationEventHash);
  if (!activation || activation.event_type !== "activated") {
    fail("preventure_research_ledger_integrity_failed", `Assignment ${row.assignment_id} lacks its activation event.`);
  }
  const task = db.prepare(
    `SELECT workflow_id, venture_id, kind, agent, priority, max_retries,
            approval_id, cost_budget_cents, due_at, payload
     FROM tasks WHERE id = ?`,
  ).get(assignment.taskId);
  const workflow = db.prepare(
    "SELECT venture_id, type, metadata FROM workflows WHERE id = ?",
  ).get(assignment.workflowId);
  if (
    !task
    || task.workflow_id !== assignment.workflowId
    || task.venture_id !== null
    || task.kind !== "preventure_research"
    || task.agent !== "demand_validator"
    || Number(task.priority) !== 1
    || Number(task.max_retries) !== 0
    || task.approval_id !== null
    || Number(task.cost_budget_cents) !== assignment.maxCostAudCents
    || task.due_at !== assignment.expiresAt
    || !workflow
    || workflow.venture_id !== null
    || workflow.type !== "preventure_research"
  ) {
    fail("preventure_research_ledger_integrity_failed", `Assignment ${row.assignment_id} task binding is missing.`);
  }
  const payload = parseObject(task.payload, `Task ${assignment.taskId} payload`);
  const { preventureResearchAssignment, ...storedEnvelope } = payload;
  const workflowMetadata = parseObject(workflow.metadata, `Workflow ${assignment.workflowId} metadata`);
  if (
    !sameCanonical(preventureResearchAssignment, assignment)
    || !sameCanonical(storedEnvelope, expectedTaskEnvelope(assignment))
    || workflowMetadata.schema !== "pantheon.preventure-research-workflow.v1"
    || workflowMetadata.authorityHash !== assignment.authorityHash
    || workflowMetadata.activationEventHash !== assignment.activationEventHash
    || workflowMetadata.preparationOnly !== true
    || !sameCanonical(workflowMetadata.externalEffects, [])
    || workflowMetadata.externalCommercialSpendCapAudCents !== 0
    || workflowMetadata.buildAuthorized !== false
    || workflowMetadata.commercialTestAuthorized !== false
    || workflowMetadata.externalActionAuthorized !== false
  ) {
    fail("preventure_research_ledger_integrity_failed", `Task ${assignment.taskId} changed its exact execution envelope.`);
  }
  const attemptCount = Number(db.prepare(
    "SELECT COUNT(*) AS count FROM task_attempts WHERE task_id = ?",
  ).get(assignment.taskId).count);
  if (attemptCount > assignment.maxAttempts) {
    fail("preventure_research_ledger_integrity_failed", `Assignment ${row.assignment_id} exceeded one attempt.`);
  }
  return assignment;
}

function costProjection(costEvent, createdAt) {
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
    cost_json: canonicalJson(costEvent),
    occurred_at: costEvent.occurredAt,
    created_at: createdAt,
  };
}

function ownerBillingObservationProjection(observation, createdAt) {
  return {
    observation_hash: observation.observationHash,
    action_kind: observation.actionKind,
    authority_hash: observation.authorityHash,
    assignment_hash: observation.assignmentHash,
    assignment_template_hash: observation.assignmentTemplateHash,
    task_id: observation.taskId,
    predecessor_kind: observation.predecessor.kind,
    predecessor_hash: observation.predecessor.hash,
    expected_previous_receipt_hash:
      observation.predecessor.expectedPreviousReceiptHash,
    task_attempt_id: observation.executionIdentity.taskAttemptId,
    model_call_id: observation.executionIdentity.modelCallId,
    agent_run_receipt_id: observation.executionIdentity.agentRunReceiptId,
    agent_run_receipt_hash: observation.executionIdentity.agentRunReceiptHash,
    cost_key: observation.costBinding.costKey,
    budget_reservation_id: observation.costBinding.budgetReservationId,
    cost_id: observation.costBinding.costId,
    client_request_id: observation.executionIdentity.clientRequestId,
    provider_request_id: observation.executionIdentity.providerRequestId,
    provider_response_id: observation.executionIdentity.providerResponseId,
    provider: observation.billingObservation.provider,
    provider_account_reference_hash:
      observation.billingObservation.providerAccountReferenceHash,
    billing_record_reference_hash:
      observation.billingObservation.billingRecordReferenceHash,
    currency: observation.billingObservation.currency,
    amount_aud_cents: observation.billingObservation.amountAudCents,
    observed_at: observation.billingObservation.observedAt,
    original_cost_occurred_at:
      observation.billingObservation.originalCostOccurredAt,
    provider_dispatched_at: observation.executionIdentity.providerDispatchedAt,
    allocation_basis_json: canonicalJson(
      observation.billingObservation.allocationBasis,
    ),
    limitations_json: canonicalJson(observation.billingObservation.limitations),
    budget_comparison_json: canonicalJson(observation.budgetComparison),
    truth_status: observation.truth.status,
    observation_json: canonicalJson(observation),
    recorded_at: observation.recordedAt,
    created_at: createdAt,
  };
}

function terminalRecoveryProjection(recovery, createdAt) {
  const receipt = recovery.executionReceipt;
  return {
    recovery_hash: recovery.recoveryHash,
    recovery_intent_hash: recovery.recoveryIntentHash,
    authority_hash: recovery.authorityHash,
    assignment_hash: recovery.assignmentHash,
    assignment_template_hash: recovery.assignmentTemplateHash,
    assignment_cap_aud_cents: recovery.assignmentCapAudCents,
    task_id: recovery.taskId,
    workflow_id: recovery.workflowId,
    task_attempt_id: recovery.originalDispatch.taskAttemptId,
    model_call_id: recovery.originalDispatch.modelCallId,
    terminal_kind: recovery.terminalBinding.kind,
    terminal_record_id: recovery.terminalBinding.eventId,
    terminal_event_type: recovery.terminalBinding.eventType,
    terminal_event_hash: recovery.terminalBinding.eventHash,
    lifecycle_event_id: recovery.terminalBinding.kind === "lifecycle"
      ? recovery.terminalBinding.eventId
      : null,
    emergency_event_id: recovery.terminalBinding.kind === "runtime_emergency_stop"
      ? Number(recovery.terminalBinding.eventId)
      : null,
    terminal_at: recovery.terminalBinding.terminalAt,
    original_claim_token_hash: recovery.originalDispatch.originalClaimTokenHash,
    descriptor_hash: recovery.originalDispatch.descriptorHash,
    request_body_hash: recovery.originalDispatch.requestBodyHash,
    client_request_id: recovery.originalDispatch.clientRequestId,
    provider_request_id: recovery.originalDispatch.providerRequestId,
    provider_response_id: recovery.originalDispatch.providerResponseId,
    provider_dispatched_at: recovery.originalDispatch.providerDispatchedAt,
    artifact_hash: recovery.retainedArtifact.artifactHash,
    artifact_ref: recovery.retainedArtifact.artifactRef,
    artifact_kind: recovery.retainedArtifact.artifactKind,
    retained_at: recovery.retainedArtifact.retainedAt,
    provider_response_hash: recovery.retainedArtifact.providerResponseHash,
    raw_provider_body_hash: recovery.retainedArtifact.rawProviderBodyHash,
    raw_provider_bytes_hash: recovery.retainedArtifact.rawProviderBytesHash,
    output_hash: recovery.retainedArtifact.outputHash,
    grounded_source_set_hash: recovery.retainedArtifact.groundedSourceSetHash,
    billing_hash: recovery.retainedArtifact.billingHash,
    response_metadata_hash: recovery.retainedArtifact.responseMetadataHash,
    agent_run_receipt_id: receipt?.id || null,
    agent_run_receipt_hash: receipt?.hash || null,
    agent_run_receipt_status: receipt?.status || null,
    agent_run_receipt_outcome_status: receipt?.outcomeStatus || null,
    cost_key: recovery.costSnapshot.costKey,
    prior_cost_receipt_hash: recovery.costSnapshot.priorReceiptHash,
    terminal_cost_receipt_hash: recovery.costSnapshot.terminalReceiptHash,
    prior_cost_event_type: recovery.costSnapshot.priorEventType,
    prior_cost_amount_aud_cents: recovery.costSnapshot.priorAmountAudCents,
    prior_cost_exposure_aud_cents: recovery.costSnapshot.priorExposureAudCents,
    budget_reservation_id: recovery.costSnapshot.budgetReservationId,
    budget_reservation_status: recovery.costSnapshot.budgetReservationStatus,
    budget_reservation_amount_aud_cents: recovery.costSnapshot.budgetReservationAmountAudCents,
    cost_id: recovery.costSnapshot.costId,
    generic_cost_status: recovery.costSnapshot.genericCostStatus,
    generic_cost_amount_aud_cents: recovery.costSnapshot.genericCostAmountAudCents,
    cost_truth: recovery.costSnapshot.costTruth,
    known_cost_aud_cents: recovery.costSnapshot.knownCostAudCents,
    exposure_aud_cents: recovery.costSnapshot.exposureAudCents,
    exact_billing_pending: sqlBoolean(recovery.costSnapshot.exactBillingPending),
    commercial_inference: recovery.controls.commercialInference,
    evidence_eligible: sqlBoolean(recovery.controls.evidenceEligible),
    decision_eligible: sqlBoolean(recovery.controls.decisionEligible),
    completion_eligible: sqlBoolean(recovery.controls.completionEligible),
    retry_authorized: sqlBoolean(recovery.controls.retryAuthorized),
    additional_network_calls: recovery.controls.additionalNetworkCalls,
    additional_ai_cost_aud_cents: recovery.controls.additionalAiCostAudCents,
    terminal_binding_json: canonicalJson(recovery.terminalBinding),
    original_dispatch_json: canonicalJson(recovery.originalDispatch),
    retained_artifact_json: canonicalJson(recovery.retainedArtifact),
    execution_receipt_json: receipt === null ? null : canonicalJson(receipt),
    cost_snapshot_json: canonicalJson(recovery.costSnapshot),
    controls_json: canonicalJson(recovery.controls),
    recovery_json: canonicalJson(recovery),
    recorded_at: recovery.recordedAt,
    created_at: createdAt,
  };
}

function sourceProjection(source, createdAt) {
  return {
    snapshot_hash: source.snapshotHash,
    authority_hash: source.authorityHash,
    assignment_hash: source.assignmentHash,
    source_id: source.id,
    source_version: source.version,
    source_class: source.sourceClass,
    source_tier: source.sourceTier,
    capture_status: source.captureStatus,
    url: source.url,
    canonical_url: source.canonicalUrl,
    canonical_host: source.canonicalHost,
    source_identity_url: source.sourceIdentityUrl,
    source_identity_hash: source.sourceIdentityHash,
    marketplace_channel_id: source.marketplaceChannelId,
    offer_identity_key: source.offerIdentityKey,
    seller_identity_key: source.sellerIdentityKey,
    identity_derivation: source.identityDerivation,
    publisher_identity_key: source.publisherIdentityKey,
    buyer_independence_group: source.buyerIndependenceGroup,
    title: source.title,
    publisher: source.publisher,
    published_at: source.publishedAt,
    content_hash: source.contentHash,
    content_location: source.contentLocation,
    research_run_id: source.researchRunId,
    source_record_id: source.sourceRecordId,
    provenance_id: source.provenanceId,
    agent_run_receipt_id: source.agentRunReceiptId,
    limitations_json: canonicalJson(source.limitations),
    supersedes_snapshot_hash: source.supersedesSnapshotHash,
    retrieved_at: source.retrievedAt,
    snapshot_json: canonicalJson(source),
    created_at: createdAt,
  };
}

function evidenceProjection(evidence, createdAt) {
  return {
    evidence_hash: evidence.evidenceHash,
    authority_hash: evidence.authorityHash,
    assignment_hash: evidence.assignmentHash,
    evidence_id: evidence.id,
    evidence_version: evidence.version,
    source_snapshot_hash: evidence.sourceSnapshotHash,
    truth_class: evidence.truthClass,
    polarity: evidence.polarity,
    question_id: evidence.questionId,
    criterion_id: evidence.criterionId,
    claim: evidence.claim,
    confidence: evidence.confidence,
    limitations_json: canonicalJson(evidence.limitations),
    supersedes_evidence_hash: evidence.supersedesEvidenceHash,
    evidence_json: canonicalJson(evidence),
    captured_at: evidence.capturedAt,
    created_at: createdAt,
  };
}

function decisionProjection(decision, createdAt) {
  return {
    decision_hash: decision.decisionHash,
    decision_schema: decision.schema,
    authority_hash: decision.authorityHash,
    decision_id: decision.id,
    decision_version: decision.version,
    outcome: decision.outcome,
    completion_mode: decision.completionMode,
    early_stop_record_hash: decision.earlyStopRecordHash,
    skipped_assignment_record_hashes_json: canonicalJson(
      decision.skippedAssignmentRecordHashes,
    ),
    next_evidence_action_json: decision.nextEvidenceAction === null
      ? null
      : canonicalJson(decision.nextEvidenceAction),
    comparator_count: decision.comparatorCount,
    estimated_internal_ai_cost_aud_cents: decision.estimatedInternalAiCostAudCents,
    reconciled_internal_ai_cost_aud_cents: decision.reconciledInternalAiCostAudCents,
    exact_billing_pending: sqlBoolean(decision.exactBillingPending),
    external_commercial_spend_aud_cents: decision.externalCommercialSpendAudCents,
    provenance_complete: sqlBoolean(decision.provenanceComplete),
    unknown_provider_outcome_count: decision.unknownProviderOutcomeCount,
    unknown_cost_count: decision.unknownCostCount,
    evidence_set_hash: decision.evidenceSetHash,
    receipt_set_hash: decision.receiptSetHash,
    decision_json: canonicalJson(decision),
    decided_at: decision.decidedAt,
    created_at: createdAt,
  };
}

function terminalStopProjection(
  stopRecord,
  expectedDecisionId,
  expectedCompletionEventId,
  createdAt,
) {
  return {
    early_stop_record_hash: stopRecord.earlyStopRecordHash,
    terminal_stop_id: stopRecord.id,
    authority_hash: stopRecord.authorityHash,
    expected_decision_id: expectedDecisionId,
    expected_completion_event_id: expectedCompletionEventId,
    trigger_assignment_id: stopRecord.triggerAssignmentId,
    trigger_assignment_hash: stopRecord.triggerAssignmentHash,
    trigger_outcome_class: stopRecord.triggerOutcomeClass,
    reason_class: stopRecord.reasonClass,
    reason_code: stopRecord.reasonCode,
    commercial_inference: stopRecord.commercialInference,
    provider_evidence_json: canonicalJson(stopRecord.providerEvidence),
    actual_coverage_json: canonicalJson(stopRecord.actualCoverage),
    gap_codes_json: canonicalJson(stopRecord.gapCodes),
    skipped_assignments_json: canonicalJson(stopRecord.skippedAssignments),
    next_evidence_action_json: canonicalJson(stopRecord.nextEvidenceAction),
    prior_evidence_set_hash: stopRecord.actualCoverage.evidenceSetHash,
    prior_receipt_set_hash: stopRecord.actualCoverage.executionReceiptSetHash,
    stopped_at: stopRecord.stoppedAt,
    stop_json: canonicalJson(stopRecord),
    created_at: createdAt,
  };
}

function assignmentSkipProjection(skipRecord, createdAt) {
  return {
    skip_record_hash: skipRecord.skipRecordHash,
    terminal_stop_id: skipRecord.terminalStopId,
    authority_hash: skipRecord.authorityHash,
    trigger_assignment_hash: skipRecord.triggerAssignmentHash,
    assignment_id: skipRecord.assignmentId,
    assignment_hash: skipRecord.assignmentHash,
    assignment_order: skipRecord.assignmentOrder,
    task_id: skipRecord.taskId,
    dispatch_state: skipRecord.dispatchState,
    task_attempt_count: skipRecord.taskAttemptCount,
    model_call_count: skipRecord.modelCallCount,
    agent_run_receipt_count: skipRecord.agentRunReceiptCount,
    research_run_count: skipRecord.researchRunCount,
    agent_run_count: skipRecord.agentRunCount,
    tool_invocation_count: skipRecord.toolInvocationCount,
    budget_reservation_count: skipRecord.budgetReservationCount,
    cost_record_count: skipRecord.costRecordCount,
    cost_event_count: skipRecord.costEventCount,
    source_snapshot_count: skipRecord.sourceSnapshotCount,
    evidence_record_count: skipRecord.evidenceRecordCount,
    total_aud_cost_cents: skipRecord.totalAudCostCents,
    skipped_at: skipRecord.skippedAt,
    skip_json: canonicalJson(skipRecord),
    created_at: createdAt,
  };
}

function loadRowsByAuthority(db, table, authorityHash, orderBy) {
  return db.prepare(
    `SELECT * FROM ${table} WHERE authority_hash = ? ORDER BY ${orderBy}`,
  ).all(authorityHash);
}

function readCostRows(rows) {
  const chains = new Map();
  return rows.map((row) => {
    const event = parseObject(row.cost_json, "Pre-venture cost event JSON");
    if (
      event.schema !== PREVENTURE_RESEARCH_COST_SCHEMA
      || event.receiptHash !== sha256(hashBody(event, "receiptHash"))
    ) fail("preventure_research_ledger_integrity_failed", `Cost receipt ${row.receipt_hash} hash is invalid.`);
    assertProjection(row, costProjection(event, row.created_at), `Cost receipt ${row.receipt_hash}`);
    const key = `${event.assignmentHash}\u0000${event.costKey}`;
    const prior = chains.get(key) || [];
    if (event.sequence !== prior.length + 1 || event.previousReceiptHash !== prior.at(-1)?.receiptHash && prior.length) {
      fail("preventure_research_ledger_integrity_failed", `Cost receipt ${row.receipt_hash} chain is invalid.`);
    }
    if (!prior.length && event.previousReceiptHash !== null) {
      fail("preventure_research_ledger_integrity_failed", `Cost receipt ${row.receipt_hash} starts with a predecessor.`);
    }
    prior.push(event);
    chains.set(key, prior);
    return event;
  });
}

function readOwnerBillingObservationRows(rows) {
  return rows.map((row) => {
    const observation = parseObject(
      row.observation_json,
      "Owner-attested provider billing observation JSON",
    );
    if (
      observation.schema !== PREVENTURE_RESEARCH_OWNER_BILLING_OBSERVATION_SCHEMA
      || observation.actionKind !== PREVENTURE_RESEARCH_OWNER_BILLING_ACTION_KIND
      || observation.truth?.status !== PREVENTURE_RESEARCH_OWNER_BILLING_TRUTH_STATUS
      || observation.truth?.source !== "authenticated_owner_session_attestation"
      || observation.truth?.statement
        !== "Owner-attested provider billing observation; not provider-settled."
      || observation.observationHash !== sha256(hashBody(observation, "observationHash"))
    ) {
      fail(
        "preventure_research_owner_billing_observation_changed",
        `Owner billing observation ${row.observation_hash} is not canonical.`,
      );
    }
    assertProjection(
      row,
      ownerBillingObservationProjection(observation, row.created_at),
      `Owner billing observation ${row.observation_hash}`,
    );
    return observation;
  });
}

function readTerminalRecoveryRows(rows) {
  return rows.map((row) => {
    const recovery = parseObject(row.recovery_json, "Terminal retained-output recovery JSON");
    const recoveryIntent = {
      schema: "pantheon.preventure-research-terminal-recovery-intent.v1",
      authorityHash: recovery.authorityHash,
      assignmentHash: recovery.assignmentHash,
      assignmentTemplateHash: recovery.assignmentTemplateHash,
      assignmentCapAudCents: recovery.assignmentCapAudCents,
      taskId: recovery.taskId,
      workflowId: recovery.workflowId,
      terminalBinding: recovery.terminalBinding,
      originalDispatch: recovery.originalDispatch,
      retainedArtifact: recovery.retainedArtifact,
      executionReceipt: recovery.executionReceipt,
      executionClosure: recovery.executionClosure,
      priorCostReceiptHash: recovery.costSnapshot?.priorReceiptHash,
      costKey: recovery.costSnapshot?.costKey,
      budgetReservationId: recovery.costSnapshot?.budgetReservationId,
      costId: recovery.costSnapshot?.costId,
      recordedAt: recovery.recordedAt,
    };
    if (
      recovery.schema !== PREVENTURE_RESEARCH_TERMINAL_RECOVERY_SCHEMA
      || recovery.recoveryIntentHash !== sha256(recoveryIntent)
      || recovery.recoveryHash !== sha256(hashBody(recovery, "recoveryHash"))
    ) {
      fail(
        "preventure_research_terminal_recovery_changed",
        `Terminal retained-output recovery ${row.recovery_hash} hash is invalid.`,
      );
    }
    assertProjection(
      row,
      terminalRecoveryProjection(recovery, row.created_at),
      `Terminal retained-output recovery ${row.recovery_hash}`,
    );
    return recovery;
  });
}

function assertTerminalRecoveryArtifact(recovery, retainedOutputStore) {
  if (!retainedOutputStore) {
    fail(
      "preventure_research_terminal_recovery_resolver_required",
      "The immutable retained-output store is required to verify terminal custody.",
    );
  }
  let manifest;
  try {
    manifest = retainedOutputStore.load({
      artifactRef: recovery.retainedArtifact.artifactRef,
      authorityHash: recovery.authorityHash,
      assignmentHash: recovery.assignmentHash,
      descriptorHash: recovery.originalDispatch.descriptorHash,
    });
  } catch (error) {
    fail(
      "preventure_research_terminal_recovery_artifact_missing",
      `The immutable retained provider artifact cannot be verified: ${String(error?.message || error)}`,
    );
  }
  const expected = {
    artifactHash: manifest.artifactHash,
    artifactRef: manifest.artifactRef,
    artifactKind: manifest.artifactKind,
    retainedAt: manifest.retainedAt,
    providerResponseHash: manifest.providerResponseHash ?? null,
    rawProviderBodyHash: manifest.rawProviderBodyHash,
    rawProviderBytesHash: manifest.rawProviderBytesHash,
    outputHash: manifest.outputHash,
    groundedSourceSetHash: manifest.groundedSourceSetHash,
    billingHash: manifest.billingHash,
    responseMetadataHash: manifest.responseMetadataHash,
  };
  if (
    manifest.retained !== true
    || manifest.authorityHash !== recovery.authorityHash
    || manifest.assignmentHash !== recovery.assignmentHash
    || manifest.assignmentMaxCostAudCents !== recovery.assignmentCapAudCents
    || manifest.descriptorHash !== recovery.originalDispatch.descriptorHash
    || manifest.requestBodyHash !== recovery.originalDispatch.requestBodyHash
    || manifest.clientRequestId !== recovery.originalDispatch.clientRequestId
    || (manifest.providerRequestId ?? null) !== recovery.originalDispatch.providerRequestId
    || (manifest.providerResponseId ?? null) !== recovery.originalDispatch.providerResponseId
    || manifest.billing?.modelCallId !== recovery.originalDispatch.modelCallId
    || !sameCanonical(expected, recovery.retainedArtifact)
  ) {
    fail(
      "preventure_research_terminal_recovery_artifact_changed",
      "Terminal custody no longer matches the exact immutable provider artifact.",
    );
  }
  return manifest;
}

function terminalRecoveryPrefixRecord(db, assignment) {
  const ids = (table, orderBy = "id") => db.prepare(
    `SELECT id FROM ${table} WHERE task_id = ? ORDER BY ${orderBy}`,
  ).all(assignment.taskId).map((row) => row.id);
  const task = db.prepare(
    "SELECT status, outcome_status, completed_at FROM tasks WHERE id = ?",
  ).get(assignment.taskId);
  const receiptRows = db.prepare(
    `SELECT id, receipt_hash, sequence, status, outcome_status
     FROM agent_run_receipts WHERE task_id = ? ORDER BY sequence, id`,
  ).all(assignment.taskId).map((row) => ({
    id: row.id,
    hash: canonicalAgentReceiptHash(row.receipt_hash),
    sequence: Number(row.sequence),
    status: row.status,
    outcomeStatus: row.outcome_status,
  }));
  const costReceiptHashes = db.prepare(
    `SELECT receipt_hash FROM preventure_research_cost_events
     WHERE assignment_hash = ? ORDER BY cost_key, sequence`,
  ).all(assignment.assignmentHash).map((row) => row.receipt_hash);
  const sourceSnapshotHashes = db.prepare(
    `SELECT snapshot_hash FROM preventure_research_source_snapshots
     WHERE assignment_hash = ? ORDER BY retrieved_at, snapshot_hash`,
  ).all(assignment.assignmentHash).map((row) => row.snapshot_hash);
  const evidenceRecordHashes = db.prepare(
    `SELECT evidence_hash FROM preventure_research_evidence_records
     WHERE assignment_hash = ? ORDER BY captured_at, evidence_hash`,
  ).all(assignment.assignmentHash).map((row) => row.evidence_hash);
  return sealedRecord({
    schema: "pantheon.preventure-research-terminal-preserved-prefix.v1",
    assignmentId: assignment.id,
    assignmentHash: assignment.assignmentHash,
    taskId: assignment.taskId,
    taskStatus: task?.status || null,
    taskOutcomeStatus: task?.outcome_status || null,
    taskCompletedAt: task?.completed_at || null,
    taskAttemptIds: ids("task_attempts"),
    modelCallIds: ids("model_calls"),
    agentRunIds: ids("agent_runs"),
    toolInvocationIds: ids("agent_tool_invocations"),
    researchRunIds: ids("research_runs"),
    budgetReservationIds: ids("budget_reservations"),
    costIds: ids("costs"),
    executionReceipts: receiptRows,
    costReceiptHashes,
    sourceSnapshotHashes,
    evidenceRecordHashes,
    executionChildren: terminalRecoveryExecutionChildrenRecord(db, assignment),
  }, "prefixHash");
}

function terminalRecoveryExecutionChildrenRecord(db, assignment) {
  const digests = (rows) => rows.map((row) => ({
    id: row.id,
    rowHash: sha256(row),
  }));
  return sealedRecord({
    schema: "pantheon.preventure-research-terminal-execution-children.v1",
    authorityHash: assignment.authorityHash,
    assignmentHash: assignment.assignmentHash,
    taskId: assignment.taskId,
    traceEvents: digests(db.prepare(
      `SELECT traces.* FROM agent_trace_events AS traces
       JOIN agent_runs AS runs ON runs.id = traces.run_id
       WHERE runs.task_id = ? ORDER BY traces.id`,
    ).all(assignment.taskId)),
    evaluationResults: digests(db.prepare(
      "SELECT * FROM agent_eval_results WHERE task_id = ? ORDER BY id",
    ).all(assignment.taskId)),
    runProvenance: digests(db.prepare(
      "SELECT * FROM agent_run_provenance WHERE task_id = ? ORDER BY id",
    ).all(assignment.taskId)),
    researchRuns: digests(db.prepare(
      "SELECT * FROM research_runs WHERE task_id = ? ORDER BY id",
    ).all(assignment.taskId)),
    researchSources: digests(db.prepare(
      `SELECT sources.* FROM research_sources AS sources
       JOIN research_runs AS runs ON runs.id = sources.run_id
       WHERE runs.task_id = ? ORDER BY sources.id`,
    ).all(assignment.taskId)),
    pilotReviews: digests(db.prepare(
      `SELECT reviews.* FROM agent_pilot_reviews AS reviews
       JOIN agent_runs AS runs ON runs.id = reviews.run_id
       WHERE runs.task_id = ? ORDER BY reviews.id`,
    ).all(assignment.taskId)),
  }, "childrenHash");
}

function assertTerminalRecoveryExecutionClosure(db, recovery, assignments, terminalCost) {
  const closure = recovery.executionClosure;
  const expectedOutcome = recovery.retainedArtifact.artifactKind === "canonical_known_response"
    ? "known"
    : recovery.retainedArtifact.artifactKind;
  const expectedErrorKind = recovery.terminalBinding.kind === "runtime_emergency_stop"
    ? "operator_emergency_stop"
    : "terminal_retained_output_custody";
  if (
    !closure
    || closure.schema !== "pantheon.preventure-research-terminal-execution-closure.v1"
    || closure.closureHash !== sha256(hashBody(closure, "closureHash"))
    || closure.authorityHash !== recovery.authorityHash
    || closure.assignmentHash !== recovery.assignmentHash
    || closure.taskId !== recovery.taskId
    || closure.workflowId !== recovery.workflowId
    || closure.taskAttemptId !== recovery.originalDispatch.taskAttemptId
    || closure.modelCallId !== recovery.originalDispatch.modelCallId
    || closure.terminalEventHash !== recovery.terminalBinding.eventHash
    || closure.artifactHash !== recovery.retainedArtifact.artifactHash
    || closure.outcomeStatus !== expectedOutcome
    || closure.errorKind !== expectedErrorKind
    || closure.resultingStatus !== "needs_attention"
    || ![
      "provider_dispatched_active_claim",
      "emergency_stopped_unknown",
      "emergency_stopped_known_retained",
      "known_retained_needs_reprocess",
    ].includes(closure.prestateProfile)
    || closure.claimCleared !== true
    || closure.retryAuthorized !== false
    || closure.evidenceEligible !== false
    || closure.closedAt !== recovery.recordedAt
    || !sameCanonical(
      closure.executionChildren,
      terminalRecoveryExecutionChildrenRecord(
        db,
        assignments.find((assignment) => assignment.assignmentHash === recovery.assignmentHash),
      ),
    )
    || !Array.isArray(closure.siblingClosures)
    || !Array.isArray(closure.preservedPrefixAssignments)
    || recovery.controls.executionSealed !== true
  ) {
    fail(
      "preventure_research_terminal_recovery_changed",
      "Terminal custody changed its exact execution-closure proof.",
    );
  }
  const task = db.prepare("SELECT * FROM tasks WHERE id = ?").get(closure.taskId);
  const attempt = db.prepare("SELECT * FROM task_attempts WHERE id = ?").get(
    closure.taskAttemptId,
  );
  const modelCall = db.prepare("SELECT * FROM model_calls WHERE id = ?").get(
    closure.modelCallId,
  );
  const agentRun = db.prepare("SELECT * FROM agent_runs WHERE id = ?").get(closure.agentRunId);
  const tool = db.prepare("SELECT * FROM agent_tool_invocations WHERE id = ?").get(
    closure.toolInvocationId,
  );
  const workflow = db.prepare("SELECT * FROM workflows WHERE id = ?").get(closure.workflowId);
  const billingObservation = db.prepare(
    `SELECT observation_hash, amount_aud_cents
     FROM preventure_research_provider_billing_observations
     WHERE authority_hash = ? AND assignment_hash = ?`,
  ).get(recovery.authorityHash, recovery.assignmentHash);
  const reconciledAfterCustody = Boolean(
    billingObservation
    && modelCall?.cost_status === "reconciled"
    && Number(modelCall.actual_cost_cents) === Number(billingObservation.amount_aud_cents)
    && Number(modelCall.reconciled_cost_cents) === Number(billingObservation.amount_aud_cents)
    && db.prepare(
      `SELECT 1 FROM preventure_research_cost_events
       WHERE assignment_hash = ? AND previous_receipt_hash = ?
         AND event_type = 'reconciled'
         AND amount_aud_cents = ? AND exposure_aud_cents = ?
         AND json_extract(cost_json, '$.ownerBillingObservationHash') = ?`,
    ).get(
      recovery.assignmentHash,
      terminalCost.receiptHash,
      billingObservation.amount_aud_cents,
      billingObservation.amount_aud_cents,
      billingObservation.observation_hash,
    )
  );
  const closureMarkerMatches = (value, label) => sameCanonical(
    parseObject(value || "{}", label).terminalRetainedExecution,
    closure,
  );
  if (
    !task
    || task.workflow_id !== closure.workflowId
    || task.venture_id !== null
    || task.status !== "needs_attention"
    || task.outcome_status !== expectedOutcome
    || task.claim_token !== null
    || task.claimed_at !== null
    || Number(task.max_retries) !== 0
    || task.completed_at !== closure.closedAt
    || !closureMarkerMatches(task.result, `Task ${closure.taskId} result`)
    || !attempt
    || attempt.task_id !== closure.taskId
    || attempt.workflow_id !== closure.workflowId
    || attempt.venture_id !== null
    || attempt.status !== "needs_attention"
    || attempt.outcome_status !== expectedOutcome
    || attempt.provider_request_id !== recovery.originalDispatch.providerRequestId
    || attempt.error_kind !== expectedErrorKind
    || attempt.completed_at !== closure.closedAt
    || !closureMarkerMatches(attempt.metadata, `Attempt ${closure.taskAttemptId} metadata`)
    || !modelCall
    || modelCall.task_id !== closure.taskId
    || modelCall.workflow_id !== closure.workflowId
    || modelCall.venture_id !== null
    || modelCall.status !== "needs_attention"
    || modelCall.outcome_status !== expectedOutcome
    || modelCall.provider_request_id !== recovery.originalDispatch.providerRequestId
    || modelCall.error_kind !== expectedErrorKind
    || modelCall.completed_at !== closure.closedAt
    || (!reconciledAfterCustody && modelCall.cost_status !== "unknown")
    || (!reconciledAfterCustody
      && Number(modelCall.reserved_cost_cents) !== recovery.assignmentCapAudCents)
    || (!reconciledAfterCustody && Number(modelCall.actual_cost_cents) !== 0)
    || (!reconciledAfterCustody && Number(modelCall.reconciled_cost_cents) !== 0)
    || !closureMarkerMatches(modelCall.metadata, `Model call ${closure.modelCallId} metadata`)
    || !agentRun
    || agentRun.task_id !== closure.taskId
    || agentRun.workflow_id !== closure.workflowId
    || agentRun.venture_id !== null
    || agentRun.status !== "needs_attention"
    || agentRun.model_call_id !== closure.modelCallId
    || agentRun.completed_at !== closure.closedAt
    || !closureMarkerMatches(agentRun.metadata, `Agent run ${closure.agentRunId} metadata`)
    || !tool
    || tool.task_id !== closure.taskId
    || tool.workflow_id !== closure.workflowId
    || tool.attempt_id !== closure.taskAttemptId
    || tool.status !== "needs_attention"
    || tool.decision !== "terminal_custody_only"
    || tool.resolved_at !== closure.closedAt
    || !closureMarkerMatches(tool.metadata, `Tool invocation ${closure.toolInvocationId} metadata`)
    || !workflow
    || workflow.venture_id !== null
    || workflow.type !== "preventure_research"
    || workflow.status !== "needs_attention"
    || workflow.current_step
      !== "Terminal provider output is held for custody and billing review only"
    || Number(workflow.approval_required) !== 1
    || workflow.updated_at !== closure.closedAt
    || !closureMarkerMatches(workflow.metadata, `Workflow ${closure.workflowId} metadata`)
  ) {
    fail(
      "preventure_research_terminal_recovery_changed",
      "Terminal custody no longer matches its exact closed execution rows.",
    );
  }
  const closureAssignments = new Map(assignments.map((assignment) => (
    [assignment.assignmentHash, assignment]
  )));
  const currentPosition = assignments.findIndex(
    (assignment) => assignment.assignmentHash === recovery.assignmentHash,
  );
  const expectedPrefix = assignments.slice(0, currentPosition).map(
    (assignment) => terminalRecoveryPrefixRecord(db, assignment),
  );
  if (!sameCanonical(closure.preservedPrefixAssignments, expectedPrefix)) {
    fail(
      "preventure_research_terminal_recovery_changed",
      "Terminal custody changed its exact completed authority-order prefix.",
    );
  }
  const seenSiblingHashes = new Set();
  for (const sibling of closure.siblingClosures) {
    const assignment = closureAssignments.get(sibling.assignmentHash);
    const siblingTask = assignment
      ? db.prepare("SELECT * FROM tasks WHERE id = ?").get(assignment.taskId)
      : null;
    if (
      !assignment
      || assignment.authorityHash !== recovery.authorityHash
      || assignment.assignmentHash === recovery.assignmentHash
      || seenSiblingHashes.has(assignment.assignmentHash)
      || !sameCanonical(sibling, {
        assignmentId: assignment.id,
        assignmentHash: assignment.assignmentHash,
        taskId: assignment.taskId,
        priorStatus: "blocked",
        priorOutcomeStatus: "not_started",
        resultingStatus: "cancelled",
        resultingOutcomeStatus: "cancelled_by_terminal_authority_custody",
        zeroActivityCount: 0,
      })
      || !siblingTask
      || siblingTask.status !== "cancelled"
      || siblingTask.outcome_status !== "cancelled_by_terminal_authority_custody"
      || siblingTask.claim_token !== null
      || siblingTask.claimed_at !== null
      || Number(siblingTask.attempt_count) !== 0
      || Number(siblingTask.max_retries) !== 0
      || siblingTask.completed_at !== closure.closedAt
      || siblingTask.updated_at !== closure.closedAt
      || !closureMarkerMatches(siblingTask.result, `Task ${assignment.taskId} result`)
    ) {
      fail(
        "preventure_research_terminal_recovery_changed",
        "Terminal custody changed its exact untouched sibling cancellation set.",
      );
    }
    const activity = Number(db.prepare(
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
      assignment.taskId,
      assignment.taskId,
      assignment.taskId,
      assignment.taskId,
      assignment.taskId,
      assignment.taskId,
      assignment.taskId,
      assignment.assignmentHash,
      assignment.assignmentHash,
      assignment.assignmentHash,
    ).count);
    if (activity !== 0) {
      fail(
        "preventure_research_terminal_recovery_changed",
        "A terminal-cancelled sibling gained execution or commercial activity.",
      );
    }
    seenSiblingHashes.add(assignment.assignmentHash);
  }
  const expectedSuffixHashes = assignments.slice(currentPosition + 1)
    .map((assignment) => assignment.assignmentHash);
  if (
    seenSiblingHashes.size !== expectedSuffixHashes.length
    || expectedSuffixHashes.some((hash) => !seenSiblingHashes.has(hash))
  ) {
    fail(
      "preventure_research_terminal_recovery_changed",
      "Terminal custody lost its exact untouched authority-order suffix.",
    );
  }
  const remainingRunnable = assignments.some((assignment) => {
    const row = db.prepare("SELECT status FROM tasks WHERE id = ?").get(assignment.taskId);
    return !row || ["queued", "pending", "blocked", "running", "dispatching"].includes(row.status);
  });
  const receipt = recovery.executionReceipt;
  const latestReceipt = db.prepare(
    `SELECT * FROM agent_run_receipts WHERE attempt_id = ?
     ORDER BY sequence DESC, created_at DESC, id DESC LIMIT 1`,
  ).get(closure.taskAttemptId);
  if (
    remainingRunnable
    || !receipt
    || !latestReceipt
    || latestReceipt.id !== receipt.id
    || latestReceipt.run_id !== closure.agentRunId
    || canonicalAgentReceiptHash(latestReceipt.receipt_hash) !== receipt.hash
    || latestReceipt.status !== receipt.status
    || latestReceipt.outcome_status !== receipt.outcomeStatus
    || terminalCost.agentRunReceiptId !== receipt.id
  ) {
    fail(
      "preventure_research_terminal_recovery_changed",
      "Terminal custody lost its final receipt or left authority work runnable.",
    );
  }
}

function readSourceRows(rows) {
  return rows.map((row) => {
    const source = parseObject(row.snapshot_json, "Pre-venture source snapshot JSON");
    const expectedIdentity = deriveSourceIdentityBinding(source.url, source.publisher);
    if (
      source.schema !== PREVENTURE_RESEARCH_SOURCE_SCHEMA
      || source.snapshotHash !== sha256(hashBody(source, "snapshotHash"))
      || Object.entries(expectedIdentity).some(
        ([key, value]) => !sameCanonical(source[key], value),
      )
    ) fail("preventure_research_ledger_integrity_failed", `Source snapshot ${row.snapshot_hash} hash is invalid.`);
    assertProjection(row, sourceProjection(source, row.created_at), `Source snapshot ${row.snapshot_hash}`);
    return source;
  });
}

function readEvidenceRows(rows) {
  return rows.map((row) => {
    const evidence = parseObject(row.evidence_json, "Pre-venture evidence JSON");
    if (
      evidence.schema !== PREVENTURE_RESEARCH_EVIDENCE_SCHEMA
      || evidence.evidenceHash !== sha256(hashBody(evidence, "evidenceHash"))
    ) fail("preventure_research_ledger_integrity_failed", `Evidence ${row.evidence_hash} hash is invalid.`);
    assertProjection(row, evidenceProjection(evidence, row.created_at), `Evidence ${row.evidence_hash}`);
    return evidence;
  });
}

function readTerminalStopRows(rows, authority, assignments) {
  if (rows.length > 1) {
    fail(
      "preventure_research_ledger_integrity_failed",
      "A one-round authority contains more than one terminal-stop record.",
    );
  }
  return rows.map((row) => {
    const stopRecord = parseObject(row.stop_json, "Pre-venture terminal-stop JSON");
    const triggerAssignment = assignments.find(
      (assignment) => assignment.assignmentHash === stopRecord.triggerAssignmentHash,
    );
    if (!triggerAssignment) {
      fail(
        "preventure_research_ledger_integrity_failed",
        "The terminal stop is not bound to an exact research assignment.",
      );
    }
    validatePreventureResearchTerminalStop(stopRecord, {
      authority,
      triggerAssignment,
      assignments,
    });
    assertProjection(
      row,
      terminalStopProjection(
        stopRecord,
        row.expected_decision_id,
        row.expected_completion_event_id,
        row.created_at,
      ),
      `Terminal stop ${row.early_stop_record_hash}`,
    );
    return stopRecord;
  });
}

function readAssignmentSkipRows(rows, authority, assignments) {
  const assignmentsByHash = new Map(
    assignments.map((assignment) => [assignment.assignmentHash, assignment]),
  );
  return rows.map((row) => {
    const skipRecord = parseObject(row.skip_json, "Pre-venture assignment-skip JSON");
    const assignment = assignmentsByHash.get(skipRecord.assignmentHash);
    if (
      !assignment
      || assignment.id !== skipRecord.assignmentId
      || assignment.taskId !== skipRecord.taskId
      || skipRecord.authorityHash !== authority.authorityHash
    ) {
      fail(
        "preventure_research_ledger_integrity_failed",
        "A skipped assignment changed its exact authority binding.",
      );
    }
    validatePreventureResearchAssignmentSkip(skipRecord, {
      authorityHash: authority.authorityHash,
      assignmentId: assignment.id,
      assignmentHash: assignment.assignmentHash,
      taskId: assignment.taskId,
    });
    assertProjection(
      row,
      assignmentSkipProjection(skipRecord, row.created_at),
      `Assignment skip ${row.skip_record_hash}`,
    );
    return skipRecord;
  });
}

function assertSkippedAssignmentUntouched(db, skipRecord, options = {}) {
  const requireSkippedState = options.requireSkippedState !== false;
  const task = db.prepare(
    `SELECT status, outcome_status, attempt_count, claim_token, claimed_at,
            cost_actual_cents
     FROM tasks WHERE id = ?`,
  ).get(skipRecord.taskId);
  if (
    !task
    || (requireSkippedState
      ? task.status !== "skipped"
      : !["planned", "queued", "blocked"].includes(task.status))
    || task.outcome_status !== "not_started"
    || Number(task.attempt_count) !== 0
    || task.claim_token !== null
    || task.claimed_at !== null
    || Number(task.cost_actual_cents) !== 0
  ) {
    fail(
      "preventure_research_ledger_integrity_failed",
      `Skipped assignment ${skipRecord.assignmentId} changed its untouched task state.`,
    );
  }
  const counts = {
    taskAttemptCount: Number(db.prepare(
      "SELECT COUNT(*) AS count FROM task_attempts WHERE task_id = ?",
    ).get(skipRecord.taskId).count),
    modelCallCount: Number(db.prepare(
      "SELECT COUNT(*) AS count FROM model_calls WHERE task_id = ?",
    ).get(skipRecord.taskId).count),
    agentRunReceiptCount: Number(db.prepare(
      "SELECT COUNT(*) AS count FROM agent_run_receipts WHERE task_id = ?",
    ).get(skipRecord.taskId).count),
    agentRunCount: Number(db.prepare(
      "SELECT COUNT(*) AS count FROM agent_runs WHERE task_id = ?",
    ).get(skipRecord.taskId).count),
    researchRunCount: Number(db.prepare(
      "SELECT COUNT(*) AS count FROM research_runs WHERE task_id = ?",
    ).get(skipRecord.taskId).count),
    toolInvocationCount: Number(db.prepare(
      "SELECT COUNT(*) AS count FROM agent_tool_invocations WHERE task_id = ?",
    ).get(skipRecord.taskId).count),
    budgetReservationCount: Number(db.prepare(
      "SELECT COUNT(*) AS count FROM budget_reservations WHERE task_id = ?",
    ).get(skipRecord.taskId).count),
    costRecordCount: Number(db.prepare(
      "SELECT COUNT(*) AS count FROM costs WHERE task_id = ?",
    ).get(skipRecord.taskId).count),
    costEventCount: Number(db.prepare(
      "SELECT COUNT(*) AS count FROM preventure_research_cost_events WHERE assignment_hash = ?",
    ).get(skipRecord.assignmentHash).count),
    sourceSnapshotCount: Number(db.prepare(
      "SELECT COUNT(*) AS count FROM preventure_research_source_snapshots WHERE assignment_hash = ?",
    ).get(skipRecord.assignmentHash).count),
    evidenceRecordCount: Number(db.prepare(
      "SELECT COUNT(*) AS count FROM preventure_research_evidence_records WHERE assignment_hash = ?",
    ).get(skipRecord.assignmentHash).count),
  };
  counts.totalAudCostCents = Number(db.prepare(
    `SELECT COALESCE(SUM(amount_cents), 0) AS total
     FROM costs WHERE task_id = ?`,
  ).get(skipRecord.taskId).total) + Number(db.prepare(
    `SELECT COALESCE(SUM(amount_aud_cents), 0) AS total
     FROM preventure_research_cost_events WHERE assignment_hash = ?`,
  ).get(skipRecord.assignmentHash).total);
  for (const [key, value] of Object.entries(counts)) {
    if (value !== skipRecord[key]) {
      fail(
        "preventure_research_ledger_integrity_failed",
        `Skipped assignment ${skipRecord.assignmentId} contradicts its zero-effect ${key}.`,
      );
    }
  }
  for (const table of ["agent_eval_results", "agent_run_provenance"]) {
    if (Number(db.prepare(
      `SELECT COUNT(*) AS count FROM ${table} WHERE task_id = ?`,
    ).get(skipRecord.taskId).count) !== 0) {
      fail(
        "preventure_research_ledger_integrity_failed",
        `Skipped assignment ${skipRecord.assignmentId} acquired retained execution provenance.`,
      );
    }
  }
}

function placeholders(values) {
  return values.map(() => "?").join(", ");
}

function executionEvidence(db, assignments) {
  const taskIds = assignments.map((assignment) => assignment.taskId);
  if (!taskIds.length) return { taskAttempts: [], modelCalls: [], agentRunReceipts: [] };
  const marker = placeholders(taskIds);
  return {
    taskAttempts: db.prepare(
      `SELECT * FROM task_attempts WHERE task_id IN (${marker}) ORDER BY started_at, id`,
    ).all(...taskIds),
    modelCalls: db.prepare(
      `SELECT * FROM model_calls WHERE task_id IN (${marker}) ORDER BY created_at, id`,
    ).all(...taskIds),
    agentRunReceipts: db.prepare(
      `SELECT * FROM agent_run_receipts WHERE task_id IN (${marker}) ORDER BY created_at, id`,
    ).all(...taskIds),
  };
}

function verifyExecutionReceiptChains(db, assignments, execution) {
  const {
    LEGACY_RECEIPT_SCHEMA,
    RECEIPT_SCHEMA,
    sha256: agentReceiptSha256,
  } = require("./agent-execution-evidence");
  const assignmentsByTask = new Map(assignments.map((assignment) => [assignment.taskId, assignment]));
  const assignmentTaskIds = new Set(assignmentsByTask.keys());
  const attempts = new Map(execution.taskAttempts.map((attempt) => [attempt.id, attempt]));
  const modelCalls = new Map(execution.modelCalls.map((call) => [call.id, call]));
  const byAttempt = new Map();
  for (const receipt of execution.agentRunReceipts) {
    const attempt = attempts.get(receipt.attempt_id);
    if (
      !attempt
      || attempt.task_id !== receipt.task_id
      || !assignmentTaskIds.has(receipt.task_id)
    ) {
      fail(
        "preventure_research_ledger_integrity_failed",
        `Agent receipt ${receipt.id} escaped its exact assignment attempt.`,
      );
    }
    const rows = byAttempt.get(receipt.attempt_id) || [];
    rows.push(receipt);
    byAttempt.set(receipt.attempt_id, rows);
  }
  for (const [attemptId, rows] of byAttempt) {
    rows.sort((left, right) => Number(left.sequence) - Number(right.sequence));
    let previousHash = null;
    rows.forEach((row, index) => {
      const isLatestReceipt = index === rows.length - 1;
      const snapshot = parseObject(row.receipt, `Agent receipt ${row.id} snapshot`);
      const snapshotHash = agentReceiptSha256(snapshot);
      const expectedReceiptHash = agentReceiptSha256({
        schema: snapshot.schema || LEGACY_RECEIPT_SCHEMA,
        attemptId,
        sequence: index + 1,
        previousHash,
        snapshotHash,
      });
      if (
        Number(row.sequence) !== index + 1
        || row.previous_hash !== previousHash
        || row.snapshot_hash !== snapshotHash
        || row.receipt_hash !== expectedReceiptHash
      ) {
        fail(
          "preventure_research_ledger_integrity_failed",
          `Agent receipt ${row.id} hash chain is invalid.`,
        );
      }
      const missingFields = JSON.parse(String(row.missing_fields || "null"));
      const warnings = JSON.parse(String(row.warnings || "null"));
      const assignment = assignmentsByTask.get(row.task_id);
      const attempt = attempts.get(row.attempt_id);
      const snapshotPayload = snapshot.task?.payload;
      const modelCallId = snapshot.attempt?.modelCallId;
      const modelCall = modelCallId ? modelCalls.get(modelCallId) : null;
      const modelCallMetadata = modelCall
        ? parseObject(modelCall.metadata, `Model call ${modelCall.id} metadata`)
        : null;
      const providerResponseId = modelCallMetadata?.providerResponseId;
      const clientRequestId = modelCallMetadata?.clientRequestId;
      const attemptMetadata = attempt
        ? parseObject(attempt.metadata, `Task attempt ${attempt.id} metadata`)
        : null;
      const agentRun = snapshot.attempt?.agentRunId
        ? db.prepare("SELECT * FROM agent_runs WHERE id = ?").get(snapshot.attempt.agentRunId)
        : null;
      const evaluation = snapshot.evaluation?.id
        ? db.prepare("SELECT * FROM agent_eval_results WHERE id = ?").get(snapshot.evaluation.id)
        : null;
      const decisionTimeCostStatus = snapshot.provider?.costStatus;
      const hasTerminalRecoveryReceipt = Boolean(db.prepare(
        `SELECT 1 FROM preventure_research_terminal_recoveries
         WHERE agent_run_receipt_id = ? AND task_attempt_id = ? LIMIT 1`,
      ).get(row.id, row.attempt_id));
      const hasLegacyReconciledSuccessor = Boolean(
        modelCall
        && modelCall.cost_status === "reconciled"
        && ["estimated", "incurred"].includes(decisionTimeCostStatus)
        && db.prepare(
          `SELECT 1
           FROM preventure_research_cost_events AS successor
           JOIN preventure_research_cost_events AS predecessor
             ON predecessor.receipt_hash = successor.previous_receipt_hash
            AND predecessor.assignment_hash = successor.assignment_hash
            AND predecessor.cost_key = successor.cost_key
           JOIN preventure_research_decisions AS decision
             ON decision.authority_hash = successor.authority_hash
           WHERE successor.assignment_hash = ?
             AND successor.event_type = 'reconciled'
             AND successor.model_call_id = ?
             AND successor.task_attempt_id = ?
             AND successor.agent_run_receipt_id = ?
             AND predecessor.event_type = ?
             AND julianday(successor.occurred_at) > julianday(decision.decided_at)
           LIMIT 1`,
        ).get(
          assignment?.assignmentHash,
          modelCall.id,
          attempt?.id,
          row.id,
          decisionTimeCostStatus,
        )
      );
      const hasOwnerBillingSuccessor = Boolean(
        modelCall
        && modelCall.cost_status === "reconciled"
        && db.prepare(
          `SELECT 1
           FROM preventure_research_cost_events AS successor
           JOIN preventure_research_provider_billing_observations AS observation
             ON observation.observation_hash = json_extract(
               successor.cost_json,
               '$.ownerBillingObservationHash'
             )
           WHERE successor.assignment_hash = ?
             AND successor.event_type = 'reconciled'
             AND successor.model_call_id = ?
             AND successor.task_attempt_id = ?
             AND successor.agent_run_receipt_id = ?
             AND observation.expected_previous_receipt_hash
               = successor.previous_receipt_hash
             AND observation.original_cost_occurred_at = successor.occurred_at
           LIMIT 1`,
        ).get(
          assignment?.assignmentHash,
          modelCall.id,
          attempt?.id,
          row.id,
        )
      );
      const hasExactReconciledSuccessor = hasLegacyReconciledSuccessor
        || hasOwnerBillingSuccessor;
      if (
        snapshot.schema !== RECEIPT_SCHEMA
        || !assignment
        || !isObject(snapshot.attempt)
        || !isObject(snapshot.task)
        || snapshot.attempt.id !== row.attempt_id
        || (isLatestReceipt && !hasTerminalRecoveryReceipt
          && snapshot.attempt.status !== attempt.status)
        || (isLatestReceipt && !hasTerminalRecoveryReceipt
          && snapshot.attempt.outcomeStatus !== attempt.outcome_status)
        || snapshot.task.id !== assignment.taskId
        || snapshot.task.workflowId !== assignment.workflowId
        || snapshot.task.ventureId !== null
        || snapshot.task.kind !== "preventure_research"
        || snapshot.task.agent !== "demand_validator"
        || !isObject(snapshotPayload)
        || !sameCanonical(snapshotPayload.preventureResearchAssignment, assignment)
        || snapshot.task.payloadHash !== agentReceiptSha256(snapshotPayload)
        || snapshot.task.resultHash !== agentReceiptSha256(snapshot.task.result)
        || row.outcome_status !== snapshot.attempt.outcomeStatus
        || !Array.isArray(missingFields)
        || !Array.isArray(warnings)
      ) {
        fail(
          "preventure_research_ledger_integrity_failed",
          `Agent receipt ${row.id} is not a canonical receipt for its exact assignment.`,
        );
      }
      if (row.status === "complete" && (
        !isLatestReceipt
        || missingFields.length !== 0
        || warnings.length !== 0
        || attempt.status !== "completed"
        || attempt.outcome_status !== "known"
        || !modelCall
        || modelCall.task_id !== assignment.taskId
        || modelCall.workflow_id !== assignment.workflowId
        || modelCall.venture_id !== null
        || modelCall.attempt_id !== attempt.id
        || modelCall.provider !== assignment.provider
        || modelCall.selected_model !== assignment.model
        || modelCall.provider_request_id !== attempt.provider_request_id
        || modelCall.outcome_status !== "known"
        || modelCall.cost_status === "unknown"
        || typeof providerResponseId !== "string"
        || !PROVIDER_RESPONSE_ID_PATTERN.test(providerResponseId)
        || typeof clientRequestId !== "string"
        || !SAFE_ID_PATTERN.test(clientRequestId)
        || attemptMetadata?.clientRequestId !== clientRequestId
        || snapshot.attempt?.metadata?.clientRequestId !== clientRequestId
        || snapshot.provider?.metadata?.clientRequestId !== clientRequestId
        || snapshot.provider?.metadata?.providerResponseId !== providerResponseId
        || snapshot.provider?.providerResponseId !== providerResponseId
        || (attempt.provider_request_id !== null && (
          attempt.provider_request_id === providerResponseId
          || attempt.provider_request_id.startsWith("resp_")
        ))
        || snapshot.provider?.modelCallId !== modelCall.id
        || snapshot.provider?.provider !== assignment.provider
        || snapshot.provider?.selectedModel !== assignment.model
        || snapshot.provider?.providerRequestId !== attempt.provider_request_id
        || snapshot.provider?.outcomeStatus !== modelCall.outcome_status
        || (
          snapshot.provider?.costStatus !== modelCall.cost_status
          && !hasExactReconciledSuccessor
        )
        || snapshot.evidenceBinding?.mode !== "exact"
        || snapshot.evidenceBinding?.run?.exact !== true
        || snapshot.evidenceBinding?.run?.id !== agentRun?.id
        || snapshot.evidenceBinding?.modelCall?.exact !== true
        || snapshot.evidenceBinding?.modelCall?.id !== modelCall.id
        || snapshot.evidenceBinding?.modelCall?.reverseAttemptId !== attempt.id
        || !agentRun
        || row.run_id !== agentRun.id
        || agentRun.task_id !== assignment.taskId
        || agentRun.workflow_id !== assignment.workflowId
        || agentRun.venture_id !== null
        || agentRun.agent_id !== "demand_validator"
        || agentRun.status !== "completed"
        || snapshot.run?.id !== agentRun.id
        || !evaluation
        || evaluation.attempt_id !== attempt.id
        || evaluation.run_id !== agentRun.id
        || evaluation.task_id !== assignment.taskId
        || evaluation.status !== "passed"
      )) {
        fail(
          "preventure_research_ledger_integrity_failed",
          `Complete agent receipt ${row.id} lacks exact terminal provider, run, or evaluation evidence.`,
        );
      }
      previousHash = row.receipt_hash;
    });
  }
}

function latestHeads(records, keySelector, supersedesSelector) {
  const superseded = new Set(records.map(supersedesSelector).filter(Boolean));
  const heads = records.filter((record) => !superseded.has(keySelector(record)));
  return heads;
}

function evidenceSetHash(authorityHash, evidenceRecords, sourceSnapshots = []) {
  return sha256({
    authorityHash,
    sourceSnapshotHashes: sourceSnapshots.map((item) => item.snapshotHash).filter(Boolean).sort(),
    evidenceHashes: evidenceRecords.map((item) => item.evidenceHash).sort(),
  });
}

function baseExecutionReceiptSetHash(authorityHash, ledger, options = {}) {
  const cutoff = options.cutoff ? Date.parse(options.cutoff) : null;
  const decisionCostEvents = cutoff === null
    ? ledger.costEvents
    : ledger.costEvents.filter(
      (item) => Date.parse(costTruthRecordedAt(item, ledger)) <= cutoff,
    );
  return sha256({
    authorityHash,
    costReceiptHashes: decisionCostEvents.map((item) => item.receiptHash).sort(),
    sourceSnapshotHashes: ledger.sourceSnapshots.map((item) => item.snapshotHash).sort(),
    agentRunReceiptHashes: ledger.executionEvidence.agentRunReceipts
      .map((item) => item.receipt_hash)
      .filter(Boolean)
      .sort(),
    taskAttemptIds: ledger.executionEvidence.taskAttempts.map((item) => item.id).sort(),
    modelCallIds: ledger.executionEvidence.modelCalls.map((item) => item.id).sort(),
  });
}

function receiptSetHash(authorityHash, ledger, options = {}) {
  const executionReceiptSetHash = baseExecutionReceiptSetHash(
    authorityHash,
    ledger,
    options,
  );
  if (!ledger.terminalStopRecord) return executionReceiptSetHash;
  return sha256({
    authorityHash,
    executionReceiptSetHash,
    earlyStopRecordHash: ledger.terminalStopRecord.earlyStopRecordHash,
    skippedAssignmentRecordHashes: ledger.assignmentSkips
      .map((item) => item.skipRecordHash)
      .sort(),
  });
}

function preventureResultingReadinessHash(
  decision,
  authorityRegistry = defaultPreventureResearchAuthorityRegistry,
) {
  const entry = authorityRegistry.resolveAuthorityEntry(decision.authorityHash);
  validatePreventureResearchDecision(entry.authority, decision);
  return sha256({
    schema: "pantheon.preventure-research-resulting-readiness.v1",
    authorityHash: decision.authorityHash,
    priorReadinessBinding: decision.readinessBinding,
    decisionHash: decision.decisionHash,
    outcome: decision.outcome,
    readinessGates: decision.readinessGates,
    evidenceSetHash: decision.evidenceSetHash,
    receiptSetHash: decision.receiptSetHash,
    decidedAt: decision.decidedAt,
  });
}

function latestCostHeads(costEvents) {
  const byKey = new Map();
  for (const item of costEvents) byKey.set(`${item.assignmentHash}\u0000${item.costKey}`, item);
  return [...byKey.values()];
}

function costTruthRecordedAt(cost, ledger) {
  const observationHash = cost.ownerBillingObservationHash;
  if (!observationHash) return cost.occurredAt;
  return ledger.ownerBillingObservations?.find(
    (item) => item.observationHash === observationHash,
  )?.recordedAt || cost.occurredAt;
}

function ledgerTruth(ledger, options = {}) {
  const cutoff = options.cutoff ? Date.parse(options.cutoff) : null;
  const unknownProvider = new Set();
  const unknownCost = new Set();
  for (const attempt of ledger.executionEvidence.taskAttempts) {
    if (["provider_dispatched", "unknown"].includes(attempt.outcome_status)) {
      unknownProvider.add(`attempt:${attempt.id}`);
    }
  }
  for (const call of ledger.executionEvidence.modelCalls) {
    if (["provider_dispatched", "unknown"].includes(call.outcome_status)) {
      unknownProvider.add(`model_call:${call.id}`);
    }
    if (call.cost_status === "unknown") unknownCost.add(`model_call:${call.id}`);
  }
  let estimatedInternalAiCostAudCents = 0;
  let reconciledInternalAiCostAudCents = 0;
  let exactBillingPending = false;
  const costRows = cutoff === null
    ? ledger.costEvents
    : ledger.costEvents.filter(
      (cost) => Date.parse(costTruthRecordedAt(cost, ledger)) <= cutoff,
    );
  for (const cost of latestCostHeads(costRows)) {
    if (cost.eventType === "unknown") {
      unknownCost.add(`cost:${cost.assignmentHash}:${cost.costKey}`);
      exactBillingPending = true;
    } else if (cost.eventType === "reconciled") {
      reconciledInternalAiCostAudCents += Number(cost.amountAudCents || 0);
    } else if (["estimated", "incurred"].includes(cost.eventType)) {
      estimatedInternalAiCostAudCents += Number(cost.amountAudCents || 0);
      exactBillingPending = true;
    }
  }
  return {
    estimatedInternalAiCostAudCents,
    reconciledInternalAiCostAudCents,
    exactBillingPending,
    unknownProviderOutcomeCount: unknownProvider.size,
    unknownCostCount: unknownCost.size,
  };
}

function deriveComparatorCoverage(authority, evidenceRecords, sourceSnapshots = []) {
  const heads = latestHeads(
    evidenceRecords,
    (record) => record.evidenceHash,
    (record) => record.supersedesEvidenceHash,
  );
  const sourceHeads = latestHeads(
    sourceSnapshots,
    (source) => source.snapshotHash,
    (source) => source.supersedesSnapshotHash,
  );
  const sourcesByHash = new Map(sourceHeads.map((source) => [source.snapshotHash, source]));
  const comparators = new Map();
  for (const evidence of heads) {
    const comparator = evidence.details?.comparator;
    if (!comparator) continue;
    const source = sourcesByHash.get(evidence.sourceSnapshotHash);
    const evidenceGradeValid = source && (
      (evidence.truthClass === "observed_fact" && source.captureStatus === "captured")
      || (evidence.truthClass === "model_inference" && source.captureStatus === "partial")
    );
    if (!evidenceGradeValid || source.assignmentHash !== evidence.assignmentHash) {
      fail(
        "preventure_research_comparator_unproven",
        `Comparator ${comparator.id} lacks its explicit captured-fact or partial-inference grade from the exact assignment.`,
      );
    }
    if (
      !source.offerIdentityKey
      || comparator.id !== source.offerIdentityKey
      || comparator.channelId !== source.marketplaceChannelId
      || comparator.sellerId !== source.sellerIdentityKey
      || (source.captureStatus === "partial" && comparator.reviewObservationCount !== 0)
    ) {
      fail(
        "preventure_research_comparator_identity_unproven",
        "Comparator identity, marketplace, seller, or review claims are not bound to the server-derived source identity.",
      );
    }
    const prior = comparators.get(source.offerIdentityKey);
    if (prior && !sameCanonical(prior, comparator)) {
      fail(
        "preventure_research_comparator_conflict",
        `Comparator ${comparator.id} has contradictory retained identity data.`,
      );
    }
    comparators.set(source.offerIdentityKey, comparator);
  }
  const values = [...comparators.values()];
  const reviewObservationCount = values.reduce(
    (sum, item) => sum + item.reviewObservationCount,
    0,
  );
  if (reviewObservationCount > authority.comparatorScope.reviewObservationMaximum) {
    fail(
      "preventure_research_comparator_scope_exceeded",
      "Retained comparator review observations exceed the immutable authority maximum.",
    );
  }
  const categoryCount = (category) => values.filter((item) => item.category === category).length;
  const sellerCounts = new Map();
  for (const comparator of values) {
    if (comparator.sellerId) {
      sellerCounts.set(comparator.sellerId, (sellerCounts.get(comparator.sellerId) || 0) + 1);
    }
  }
  return {
    comparatorIds: [...comparators.keys()].sort(),
    comparatorCoverage: {
      directOrNearDirectCount: categoryCount("direct_or_near_direct"),
      adjacentCount: categoryCount("adjacent"),
      indirectCount: categoryCount("indirect"),
      maximumAcceptedOffersPerSeller: Math.max(0, ...sellerCounts.values()),
      sellerIdentityComplete: values.every(
        (item) => typeof item.sellerId === "string" && item.sellerId.length > 0,
      ),
      perFormatCounts: Object.fromEntries(authority.formats.map((formatId) => [
        formatId,
        values.filter((item) => item.formatIds.includes(formatId)).length,
      ])),
      observedChannelIds: [...new Set(values.map((item) => item.channelId))].sort(),
      selectionMethodApplied: values.length > 0,
    },
  };
}

function deriveTerminalComparatorCoverage(authority, evidenceRecords) {
  const heads = latestHeads(
    evidenceRecords,
    (record) => record.evidenceHash,
    (record) => record.supersedesEvidenceHash,
  );
  const comparators = new Map();
  for (const record of heads) {
    const comparator = record.details?.comparator;
    if (!comparator) continue;
    const prior = comparators.get(comparator.id);
    if (prior && !sameCanonical(prior, comparator)) {
      fail(
        "preventure_research_comparator_conflict",
        `Comparator ${comparator.id} has contradictory terminal coverage.`,
      );
    }
    comparators.set(comparator.id, comparator);
  }
  const values = [...comparators.values()];
  const sellerCounts = new Map();
  for (const item of values) {
    if (item.sellerId === null) continue;
    sellerCounts.set(item.sellerId, (sellerCounts.get(item.sellerId) || 0) + 1);
  }
  const scope = authority.comparatorScope;
  const coverage = {
    comparatorCount: values.length,
    directOrNearDirectCount: values.filter(
      (item) => item.category === "direct_or_near_direct",
    ).length,
    adjacentCount: values.filter((item) => item.category === "adjacent").length,
    indirectCount: values.filter((item) => item.category === "indirect").length,
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
  return coverage;
}

function deriveTerminalBuyerEvidenceCoverage(evidenceRecords, sourceSnapshots = []) {
  const heads = latestHeads(
    evidenceRecords,
    (record) => record.evidenceHash,
    (record) => record.supersedesEvidenceHash,
  );
  const rows = heads.filter((record) => record.details?.buyerEvidence);
  const sourceHeads = latestHeads(
    sourceSnapshots,
    (source) => source.snapshotHash,
    (source) => source.supersedesSnapshotHash,
  );
  const sourcesByHash = new Map(sourceHeads.map((source) => [source.snapshotHash, source]));
  const groups = new Set();
  const offers = new Set();
  const sellers = new Set();
  const usedSources = new Set();
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
  for (const record of rows) {
    const item = record.details.buyerEvidence;
    if (usedSources.has(record.sourceSnapshotHash)) {
      fail(
        "preventure_research_buyer_identity_unproven",
        "Terminal buyer coverage reused one source as independent evidence.",
      );
    }
    usedSources.add(record.sourceSnapshotHash);
    const source = sourcesByHash.get(record.sourceSnapshotHash);
    if (source?.captureStatus !== "captured" || record.truthClass !== "observed_fact") {
      continue;
    }
    groups.add(item.independenceGroup);
    if (item.paidOfferId) offers.add(item.paidOfferId);
    if (item.sellerOrPublisherId) sellers.add(item.sellerOrPublisherId);
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

function validateEvidenceDetails(authority, assignment, criterionId, input) {
  if (!hasExactKeys(input, EVIDENCE_DETAIL_KEYS)) {
    fail(
      "preventure_research_evidence_invalid",
      `Evidence details must contain exactly: ${EVIDENCE_DETAIL_KEYS.join(", ")}.`,
    );
  }
  const details = canonical(input);
  const caseKeys = ["formatCase", "channelCase", "economicsCase", "readinessGate"];
  const presentCases = caseKeys.filter((key) => details[key] !== null);
  if (details.comparator !== null) {
    const comparator = details.comparator;
    if (
      assignment.id !== "comparator_and_buyer_evidence"
      || criterionId !== null
      || !hasExactKeys(comparator, [
        "id", "category", "sellerId", "channelId", "formatIds", "reviewObservationCount",
      ])
      || !COMPARATOR_CATEGORIES.has(comparator.category)
      || !authority.channelCases.includes(comparator.channelId)
      || comparator.channelId === "retain_cash"
      || !Array.isArray(comparator.formatIds)
      || comparator.formatIds.length < 1
      || new Set(comparator.formatIds).size !== comparator.formatIds.length
      || comparator.formatIds.some((formatId) => !authority.formats.includes(formatId))
      || (comparator.sellerId !== null && typeof comparator.sellerId !== "string")
      || !Number.isSafeInteger(comparator.reviewObservationCount)
      || comparator.reviewObservationCount < 0
      || comparator.reviewObservationCount > authority.comparatorScope.reviewObservationMaximum
    ) {
      fail("preventure_research_evidence_invalid", "Comparator details are outside the exact first assignment.");
    }
    cleanId(comparator.id, "Comparator ID");
    if (comparator.sellerId) cleanId(comparator.sellerId, "Comparator seller ID");
  }
  if (details.buyerEvidence !== null) {
    const buyerEvidence = details.buyerEvidence;
    if (
      assignment.id !== "comparator_and_buyer_evidence"
      || criterionId !== null
      || !hasExactKeys(buyerEvidence, [
        "kind", "independenceGroup", "paidOfferId",
        "sellerOrPublisherId", "exactWorkflowRelevance",
      ])
      || !BUYER_EVIDENCE_KINDS.has(buyerEvidence.kind)
      || typeof buyerEvidence.exactWorkflowRelevance !== "boolean"
      || (buyerEvidence.paidOfferId !== null && typeof buyerEvidence.paidOfferId !== "string")
      || (buyerEvidence.sellerOrPublisherId !== null
        && typeof buyerEvidence.sellerOrPublisherId !== "string")
      || (
        buyerEvidence.kind === "purchaser_attributable_behaviour"
        && !buyerEvidence.paidOfferId
      )
    ) {
      fail(
        "preventure_research_evidence_invalid",
        "Buyer evidence is outside the exact first assignment or has an invalid evidence class.",
      );
    }
    cleanId(buyerEvidence.independenceGroup, "Buyer evidence independence group");
    if (buyerEvidence.sellerOrPublisherId) {
      cleanId(buyerEvidence.sellerOrPublisherId, "Buyer evidence seller or publisher ID");
    }
    if (buyerEvidence.paidOfferId) cleanId(buyerEvidence.paidOfferId, "Buyer evidence paid offer ID");
  }
  if (criterionId) {
    if (
      presentCases.length !== 1
      || details.recommendation !== null
      || details.comparator !== null
      || details.buyerEvidence !== null
    ) {
      fail(
        "preventure_research_evidence_invalid",
        "Criterion evidence requires exactly one matching case detail and no recommendation.",
      );
    }
    if (criterionId.startsWith("format_case:")) {
      const expectedId = criterionId.slice("format_case:".length);
      const item = details.formatCase;
      if (
        assignment.id !== "format_channel_and_economics"
        || !hasExactKeys(item, ["id", "disposition"])
        || item.id !== expectedId
        || !authority.formats.includes(item.id)
        || !FORMAT_DISPOSITIONS.has(item.disposition)
      ) fail("preventure_research_evidence_invalid", "Format criterion and retained case detail do not match.");
    } else if (criterionId.startsWith("channel_case:")) {
      const expectedId = criterionId.slice("channel_case:".length);
      const item = details.channelCase;
      if (
        assignment.id !== "format_channel_and_economics"
        || !hasExactKeys(item, ["id", "state"])
        || item.id !== expectedId
        || !authority.channelCases.includes(item.id)
        || !CHANNEL_STATES.has(item.state)
      ) fail("preventure_research_evidence_invalid", "Channel criterion and retained case detail do not match.");
    } else if (criterionId.startsWith("economics_case:")) {
      const [, expectedChannelId, expectedPrice] = criterionId.split(":");
      const item = details.economicsCase;
      if (
        assignment.id !== "format_channel_and_economics"
        || !hasExactKeys(item, [
          "channelId", "priceAudCents", "state",
          "estimatedNetCashContributionAudCents", "unknownCosts",
        ])
        || item.channelId !== expectedChannelId
        || Number(item.priceAudCents) !== Number(expectedPrice)
        || !authority.channelCases.includes(item.channelId)
        || !authority.priceCasesAudCents.includes(item.priceAudCents)
        || !ECONOMICS_STATES.has(item.state)
        || !Array.isArray(item.unknownCosts)
        || new Set(item.unknownCosts).size !== item.unknownCosts.length
        || !item.unknownCosts.every((value) => typeof value === "string" && value.trim())
        || (["unknown", "not_applicable"].includes(item.state)
          ? item.estimatedNetCashContributionAudCents !== null
          : !Number.isSafeInteger(item.estimatedNetCashContributionAudCents))
        || (item.channelId === "retain_cash" && (
          item.state !== "known_zero"
          || item.estimatedNetCashContributionAudCents !== 0
          || item.unknownCosts.length !== 0
        ))
      ) fail("preventure_research_evidence_invalid", "Economics criterion and retained case detail do not match.");
    } else if (criterionId.startsWith("readiness_gate:")) {
      const expectedId = criterionId.slice("readiness_gate:".length);
      const item = details.readinessGate;
      if (
        assignment.id !== "independent_readiness_review"
        || !hasExactKeys(item, ["id", "required", "status"])
        || item.id !== expectedId
        || !REQUIRED_READINESS_GATE_IDS.includes(item.id)
        || item.required !== true
        || !READINESS_GATE_STATUSES.has(item.status)
      ) fail("preventure_research_evidence_invalid", "Readiness criterion and retained gate detail do not match.");
    } else {
      fail("preventure_research_evidence_invalid", "Evidence criterion is not a supported exact decision case.");
    }
  } else if (presentCases.length > 0) {
    fail("preventure_research_evidence_invalid", "Case details require their exact criterion ID.");
  }
  if (details.recommendation !== null) {
    const recommendation = details.recommendation;
    const recommendationKeys = [
      "outcome", "summary", "buyer", "problem", "offer", "channel", "priceOrMargin",
      "evidenceStandard", "nextMoneyMove", "reviseOrStopCriteria",
      "materialContradictions", "limitations",
    ];
    if (
      assignment.id !== "independent_readiness_review"
      || criterionId !== null
      || details.comparator !== null
      || details.buyerEvidence !== null
      || presentCases.length > 0
      || !hasExactKeys(recommendation, recommendationKeys)
      || !authority.allowedOutcomes.includes(recommendation.outcome)
      || !Array.isArray(recommendation.reviseOrStopCriteria)
      || recommendation.reviseOrStopCriteria.length < 1
      || !Array.isArray(recommendation.materialContradictions)
      || !Array.isArray(recommendation.limitations)
      || recommendation.limitations.length < 1
    ) fail("preventure_research_evidence_invalid", "Recommendation details are not one exact independent-review narrative.");
    for (const key of [
      "summary", "buyer", "problem", "offer", "channel", "priceOrMargin",
      "evidenceStandard", "nextMoneyMove",
    ]) cleanText(recommendation[key], `Recommendation ${key}`, 8);
  }
  return details;
}

function assertDecisionEvidenceBacked(decisionInput, evidenceRecords) {
  const heads = latestHeads(
    evidenceRecords,
    (record) => record.evidenceHash,
    (record) => record.supersedesEvidenceHash,
  );
  const assertExactCase = (criterionId, detailKey, expected, label) => {
    const records = heads.filter((record) => record.criterionId === criterionId);
    if (
      records.length === 0
      || records.some((record) => !sameCanonical(record.details?.[detailKey], expected))
    ) {
      fail(
        "preventure_research_decision_unbacked",
        `${label} does not match its exact retained evidence detail.`,
      );
    }
    return records;
  };
  for (const item of decisionInput.formatCases || []) {
    assertExactCase(`format_case:${item.id}`, "formatCase", item, `Format case ${item.id}`);
  }
  for (const item of decisionInput.channelCases || []) {
    assertExactCase(`channel_case:${item.id}`, "channelCase", item, `Channel case ${item.id}`);
  }
  for (const item of decisionInput.readinessGates || []) {
    assertExactCase(`readiness_gate:${item.id}`, "readinessGate", item, `Readiness gate ${item.id}`);
  }
  for (const item of decisionInput.economicsCases || []) {
    const { evidenceRefs: _evidenceRefs, ...caseDetail } = item;
    const records = assertExactCase(
      `economics_case:${item.channelId}:${item.priceAudCents}`,
      "economicsCase",
      caseDetail,
      `Economics case ${item.channelId}:${item.priceAudCents}`,
    );
    const derivedEvidenceRefs = records.map((record) => record.id).sort();
    if (!sameCanonical(item.evidenceRefs, derivedEvidenceRefs)) {
      fail(
        "preventure_research_decision_unbacked",
        `Economics case ${item.channelId}:${item.priceAudCents} evidence references are not ledger-derived.`,
      );
    }
  }
  const recommendationRecords = heads.filter((record) => record.details?.recommendation);
  const recommendation = {
    outcome: decisionInput.outcome,
    summary: decisionInput.summary,
    buyer: decisionInput.buyer,
    problem: decisionInput.problem,
    offer: decisionInput.offer,
    channel: decisionInput.channel,
    priceOrMargin: decisionInput.priceOrMargin,
    evidenceStandard: decisionInput.evidenceStandard,
    nextMoneyMove: decisionInput.nextMoneyMove,
    reviseOrStopCriteria: decisionInput.reviseOrStopCriteria,
    materialContradictions: decisionInput.materialContradictions,
    limitations: decisionInput.limitations,
  };
  if (
    recommendationRecords.length !== 1
    || !sameCanonical(recommendationRecords[0].details.recommendation, recommendation)
  ) {
    fail(
      "preventure_research_decision_unbacked",
      "The final decision narrative and outcome do not match one exact retained independent recommendation.",
    );
  }
}

function createPreventureResearchStore(db, options = {}) {
  if (!db || typeof db.prepare !== "function") {
    fail("preventure_research_database_required", "A synchronous Pantheon database is required.");
  }
  const authorityRegistry = options.authorityRegistry
    || defaultPreventureResearchAuthorityRegistry;
  if (
    !authorityRegistry
    || typeof authorityRegistry.resolveAuthorityEntry !== "function"
  ) {
    fail(
      "preventure_research_authority_registry_invalid",
      "The immutable pre-venture authority registry is unavailable.",
    );
  }
  const retainedOutputStore = options.retainedOutputStore || null;
  const allowUnresolvedTerminalRecoveries =
    options.structuralArtifactVerificationToken
      === STRUCTURAL_ARTIFACT_VERIFICATION_TOKEN;
  if (
    retainedOutputStore !== null
    && (
      retainedOutputStore.kind !== IMMUTABLE_PREVENTURE_OUTPUT_STORE_KIND
      || typeof retainedOutputStore.load !== "function"
    )
  ) {
    fail(
      "preventure_research_terminal_recovery_resolver_invalid",
      "Terminal retained-output recovery requires Pantheon's exact immutable output store.",
    );
  }
  const clock = typeof options.clock === "function" ? options.clock : () => new Date().toISOString();
  if (typeof options.clock === "function" && typeof db.function === "function") {
    db.function("pantheon_current_time", () => {
      const value = clock();
      const parsed = value instanceof Date ? value.toISOString() : String(value || "");
      if (!Number.isFinite(Date.parse(parsed))) {
        fail(
          "preventure_research_time_invalid",
          "The pre-venture store clock returned an invalid timestamp.",
        );
      }
      return new Date(parsed).toISOString();
    });
  }
  const atomic = createAtomicRunner(db);
  const timestamp = (value, label = "Timestamp") => {
    const result = exactTimestamp(value ?? clock(), label);
    const evaluatedAt = exactTimestamp(clock(), "Pre-venture store clock");
    if (Date.parse(result) > Date.parse(evaluatedAt)) {
      fail(
        "preventure_research_time_invalid",
        `${label} cannot be recorded in the future.`,
      );
    }
    return result;
  };

  function getAuthority(authorityHash) {
    const row = db.prepare(
      "SELECT * FROM preventure_research_authorities WHERE authority_hash = ?",
    ).get(authorityHash);
    return row ? readAuthorityRow(row, authorityRegistry) : null;
  }

  function getAuthorityEntry(authorityHash) {
    const row = db.prepare(
      "SELECT * FROM preventure_research_authorities WHERE authority_hash = ?",
    ).get(authorityHash);
    return row ? readAuthorityEntryRow(row, authorityRegistry) : null;
  }

  function requireAuthority(authorityHash) {
    const authority = getAuthority(authorityHash);
    if (!authority) {
      fail("preventure_research_authority_missing", "The exact pre-venture research authority is not registered.");
    }
    return authority;
  }

  function requireCandidateAuthority(authorityHash, actionLabel) {
    const candidate = authorityRegistry.resolveCandidateAuthorityEntry();
    if (!candidate || candidate.authority.authorityHash !== authorityHash) {
      fail(
        "preventure_research_candidate_authority_required",
        `${actionLabel} requires the registry's one explicit candidate authority.`,
      );
    }
    return requireAuthority(authorityHash);
  }

  function assertRenewalPredecessorTerminal(authority, actionLabel) {
    if (!authority.supersedesAuthorityHash) return;
    const predecessor = getAuthority(authority.supersedesAuthorityHash);
    if (!predecessor) {
      fail(
        "preventure_research_predecessor_missing",
        `${actionLabel} requires the exact registered predecessor authority.`,
      );
    }
    const predecessorState = lifecycleState(loadLifecycleRows(db, predecessor));
    if (!RENEWAL_ADMISSIBLE_PREDECESSOR_EVENTS.includes(predecessorState)) {
      fail(
        "preventure_research_predecessor_not_terminal",
        `${actionLabel} requires the predecessor's durable completed, revoked, or expired lifecycle event.`,
      );
    }
  }

  function listAuthorities() {
    return db.prepare(
      "SELECT * FROM preventure_research_authorities ORDER BY created_at, authority_hash",
    ).all().map((row) => readAuthorityRow(row, authorityRegistry));
  }

  function registerAuthority(authority, readinessSpec) {
    assertExactAuthority(authority, readinessSpec, authorityRegistry);
    return atomic(() => {
      const existing = getAuthority(authority.authorityHash);
      if (existing) {
        if (!sameCanonical(existing, authority)) {
          fail("preventure_research_authority_conflict", "The authority hash is already bound to different content.");
        }
        return { created: false, authority: existing };
      }
      const logical = db.prepare(
        `SELECT authority_hash FROM preventure_research_authorities
         WHERE authority_id = ? AND authority_version = ?`,
      ).get(authority.id, authority.version);
      if (logical) {
        fail(
          "preventure_research_authority_conflict",
          "The authority ID and version are already bound to a different hash.",
        );
      }
      insertProjection(
        db,
        "preventure_research_authorities",
        authorityProjection(authority, readinessSpec, timestamp(undefined, "Authority registration time")),
      );
      return { created: true, authority: getAuthority(authority.authorityHash) };
    });
  }

  function loadLifecycle(authorityHash) {
    const authority = requireAuthority(authorityHash);
    return loadLifecycleRows(db, authority);
  }

  function exactApprovedScope(authority, eventType, approvalId, suppliedScope, occurredAt) {
    const expectedScope = preventureResearchApprovalScope(authority, eventType);
    const expectedHash = preventureResearchApprovalScopeHash(authority, eventType);
    if (!sameCanonical(suppliedScope, expectedScope)) {
      fail(
        "preventure_research_approval_scope_mismatch",
        "The supplied approval scope is not the exact owner-approved pre-venture scope.",
      );
    }
    const row = db.prepare(
      `SELECT id, venture_id, workflow_id, task_id, scope, title, status, risk_level,
              requested_by, requested_at, decided_by, scope_hash, payload, expected_effects,
              decided_at, expires_at, consumed_at
       FROM approvals WHERE id = ?`,
    ).get(approvalId);
    if (!row || row.status !== "approved" || row.consumed_at !== null) {
      fail(
        "preventure_research_approval_required",
        "A distinct unused approved Pantheon approval is required.",
      );
    }
    if (
      row.scope_hash !== expectedHash
      || !row.expires_at
      || row.venture_id !== null
      || row.workflow_id !== null
      || row.task_id !== null
      || !sameCanonical(parseObject(row.scope, "Pre-venture approval scope"), expectedScope)
      || row.title !== (eventType === "accepted"
        ? "Accept this exact bounded research authority?"
        : "Activate this exact bounded internal research round?")
      || row.risk_level !== "high"
      || row.requested_by !== "jarvis"
      || row.decided_by !== "owner"
      || !sameCanonical(JSON.parse(String(row.expected_effects || "null")), [])
      || !approvalPayloadMatches(row, expectedScope, expectedHash)
    ) {
      fail(
        "preventure_research_approval_scope_mismatch",
        "The stored approval does not bind the exact authority, event, cap, provider, and expiry.",
      );
    }
    const decisionTime = Date.parse(String(row.decided_at || ""));
    const eventTime = Date.parse(occurredAt);
    if (
      !Number.isFinite(decisionTime)
      || row.decided_at !== occurredAt
      || decisionTime > eventTime
      || Date.parse(row.expires_at) <= eventTime
    ) {
      fail("preventure_research_approval_stale", "The approval was not current at the lifecycle event time.");
    }
    const priorPreventureUse = db.prepare(
      `SELECT id FROM preventure_research_lifecycle_events
       WHERE approval_id = ? AND event_type IN ('accepted', 'activated') LIMIT 1`,
    ).get(approvalId);
    const priorCommercialUse = db.prepare(
      `SELECT id FROM commercial_test_lifecycle_events
       WHERE approval_id = ? AND event_type IN ('accepted', 'activated') LIMIT 1`,
    ).get(approvalId);
    if (priorPreventureUse || priorCommercialUse) {
      fail("preventure_research_approval_already_used", "This approval has already established authority.");
    }
    assertApprovalDecisionReceipt(db, authority, eventType, row, occurredAt);
    return { row, scopeHash: expectedHash };
  }

  function lifecycleIntentMatches(event, input, occurredAt, scopeHash) {
    return event.eventType === input.eventType
      && event.occurredAt === occurredAt
      && event.approvalId === (input.approvalId ?? null)
      && event.approvalScopeHash === scopeHash
      && event.actor === cleanText(input.actor || "pantheon", "Lifecycle actor")
      && event.reason === cleanText(input.reason, "Lifecycle reason", 8)
      && sameCanonical(event.metadata, input.metadata || {});
  }

  function appendLifecycleInternal(authority, input = {}, allowCompletion = false) {
    const eventType = cleanText(input.eventType, "Lifecycle event type");
    if (eventType === "completed" && !allowCompletion) {
      fail(
        "preventure_research_atomic_completion_required",
        "Completion must be written atomically with its validated diligence decision.",
      );
    }
    const occurredAt = timestamp(input.occurredAt, "Lifecycle event time");
    const approvalRequired = ["accepted", "activated"].includes(eventType);
    if (approvalRequired && input.actor !== "owner") {
      fail(
        "preventure_research_approval_identity_invalid",
        "Acceptance and activation require the durable owner decision identity.",
      );
    }
    const scopeHash = approvalRequired
      ? preventureResearchApprovalScopeHash(authority, eventType)
      : null;
    if (input.id) {
      const existingRow = db.prepare(
        "SELECT authority_hash, event_json FROM preventure_research_lifecycle_events WHERE id = ?",
      ).get(input.id);
      if (existingRow) {
        if (existingRow.authority_hash !== authority.authorityHash) {
          fail("preventure_research_lifecycle_conflict", "The lifecycle ID belongs to another authority.");
        }
        const existing = parseObject(existingRow.event_json, "Pre-venture lifecycle replay JSON");
        if (!lifecycleIntentMatches(existing, input, occurredAt, scopeHash)) {
          fail("preventure_research_lifecycle_conflict", "The lifecycle ID is bound to a different event.");
        }
        return { created: false, event: existing };
      }
    }
    const currentTime = Date.parse(timestamp(undefined, "Current time"));
    const authorityExpiry = Date.parse(authority.expiresAt);
    if (["accepted", "activated"].includes(eventType) && currentTime >= authorityExpiry) {
      fail("preventure_research_authority_expired", "Expired authority cannot be accepted or activated.");
    }
    const events = loadLifecycleRows(db, authority);
    if (TERMINAL_EVENT_TYPES.has(lifecycleState(events))) {
      fail("preventure_research_authority_terminal", "A terminal pre-venture authority cannot reopen.");
    }
    const approval = approvalRequired
      ? exactApprovedScope(authority, eventType, input.approvalId, input.approvalScope, occurredAt)
      : null;
    if (["revised", "superseded"].includes(eventType)) {
      const successorHash = input.metadata?.successorAuthorityHash;
      if (!successorHash || !getAuthority(successorHash)) {
        fail(
          "preventure_research_successor_missing",
          "Revision or supersession requires a registered immutable successor authority.",
        );
      }
    }
    if (eventType === "completed") {
      const decisionHash = input.metadata?.decisionHash;
      const decision = db.prepare(
        "SELECT authority_hash FROM preventure_research_decisions WHERE decision_hash = ?",
      ).get(decisionHash);
      if (!decision || decision.authority_hash !== authority.authorityHash) {
        fail("preventure_research_decision_missing", "Completion lacks its exact validated decision.");
      }
    }
    const id = input.id || `preventure_lifecycle_${sha256({
      authorityHash: authority.authorityHash,
      sequence: events.length + 1,
      eventType,
      occurredAt,
    }).slice(7, 39)}`;
    const event = createPreventureLifecycleEvent(authority, events, {
      ...input,
      id,
      occurredAt,
      approvalScopeHash: scopeHash,
    });
    validatePreventureLifecycleChain(authority, [...events, event]);
    insertProjection(
      db,
      "preventure_research_lifecycle_events",
      lifecycleProjection(event, timestamp(undefined, "Lifecycle creation time")),
    );
    if (approval) {
      const changed = db.prepare(
        `UPDATE approvals SET consumed_at = ?
         WHERE id = ? AND consumed_at IS NULL AND status = 'approved'`,
      ).run(event.occurredAt, approval.row.id);
      if (Number(changed.changes) !== 1) {
        fail("preventure_research_approval_already_used", "The lifecycle approval was consumed concurrently.");
      }
    }
    return { created: true, event };
  }

  function appendLifecycle(authorityHash, input = {}) {
    return atomic(() => {
      const eventType = cleanText(input.eventType, "Lifecycle event type");
      const authority = ["accepted", "activated"].includes(eventType)
        ? requireCandidateAuthority(authorityHash, `Lifecycle ${eventType}`)
        : requireAuthority(authorityHash);
      if (["proposed", "accepted", "activated"].includes(eventType)) {
        assertRenewalPredecessorTerminal(authority, `Lifecycle ${eventType}`);
      }
      return appendLifecycleInternal(authority, input, false);
    });
  }

  function readAssignmentRows(authorityHash) {
    const authority = requireAuthority(authorityHash);
    const rows = loadRowsByAuthority(
      db,
      "preventure_research_assignments",
      authorityHash,
      "assignment_id, assignment_hash",
    );
    const rowsById = new Map(rows.map((row) => [row.assignment_id, row]));
    if (
      rowsById.size !== rows.length
      || rows.some((row) => !authority.assignments.some(
        (template) => template.id === row.assignment_id,
      ))
    ) {
      fail(
        "preventure_research_ledger_integrity_failed",
        "The materialized assignments do not match the immutable authority order.",
      );
    }
    return authority.assignments
      .filter((template) => rowsById.has(template.id))
      .map((template) => readAssignmentRow(db, rowsById.get(template.id), authority));
  }

  function getAssignment(assignmentHash) {
    const row = db.prepare(
      "SELECT * FROM preventure_research_assignments WHERE assignment_hash = ?",
    ).get(assignmentHash);
    if (!row) return null;
    return readAssignmentRow(db, row, requireAuthority(row.authority_hash));
  }

  function listAssignments(authorityHash) {
    return readAssignmentRows(authorityHash);
  }

  function createAssignment(authorityHash, assignmentId, input = {}) {
    return atomic(() => {
      const authority = requireCandidateAuthority(authorityHash, "Assignment materialization");
      const events = loadLifecycleRows(db, authority);
      const latest = events.at(-1);
      const assignedAt = timestamp(input.assignedAt, "Assignment time");
      if (
        latest?.eventType !== "activated"
        || latest.eventHash !== input.activationEventHash
        || Date.parse(timestamp(undefined, "Current time")) >= Date.parse(authority.expiresAt)
        || Date.parse(assignedAt) >= Date.parse(authority.expiresAt)
      ) {
        fail(
          "preventure_research_assignment_not_authorized",
          "Assignment creation requires the current exact activation and unexpired authority.",
        );
      }
      const template = authority.assignments.find((item) => item.id === assignmentId);
      if (!template) {
        fail("preventure_research_assignment_not_authorized", "The assignment is not in the approved authority.");
      }
      const workflowId = cleanId(input.workflowId, "Assignment workflow ID");
      const taskId = cleanId(input.taskId, "Assignment task ID");
      const task = db.prepare(
        `SELECT id, workflow_id, venture_id, kind, agent, status, priority,
                max_retries, approval_id, cost_budget_cents, due_at, payload
         FROM tasks WHERE id = ?`,
      ).get(taskId);
      const workflow = db.prepare(
        "SELECT id, venture_id, type, metadata FROM workflows WHERE id = ?",
      ).get(workflowId);
      if (
        !task
        || task.workflow_id !== workflowId
        || task.venture_id !== null
        || task.kind !== "preventure_research"
        || !workflow
        || workflow.venture_id !== null
        || workflow.type !== "preventure_research"
        || ["completed", "cancelled"].includes(task.status)
      ) {
        fail("preventure_research_assignment_task_invalid", "Assignment task is missing, mismatched, or terminal.");
      }
      const body = {
        schema: PREVENTURE_RESEARCH_ASSIGNMENT_SCHEMA,
        id: template.id,
        version: template.version,
        authorityHash: authority.authorityHash,
        activationEventHash: latest.eventHash,
        templateHash: sha256(template),
        workflowId,
        taskId,
        provider: template.provider,
        model: template.model,
        maxCostAudCents: template.maxCostAudCents,
        maxAttempts: template.maxAttempts,
        maxToolCalls: template.maxToolCalls,
        maximumModelPasses: template.maximumModelPasses,
        maxInputTokens: template.maxInputTokens,
        localPromptPreflightMaxInputTokens: template.localPromptPreflightMaxInputTokens,
        maxOutputTokens: template.maxOutputTokens,
        maxTurns: template.maxTurns,
        deadlineMs: template.deadlineMs,
        worstCaseExposure: template.worstCaseExposure,
        expiresAt: authority.expiresAt,
        assignedAt,
      };
      const assignment = sealedRecord(body, "assignmentHash");
      const logical = db.prepare(
        `SELECT * FROM preventure_research_assignments
         WHERE authority_hash = ? AND assignment_id = ? AND assignment_version = ?`,
      ).get(authority.authorityHash, template.id, template.version);
      if (logical) {
        const existing = readAssignmentRow(db, logical, authority);
        if (!sameCanonical(existing, assignment)) {
          fail("preventure_research_assignment_conflict", "The approved assignment is already bound differently.");
        }
        return { created: false, assignment: existing };
      }
      const payload = parseObject(task.payload, `Task ${taskId} payload`);
      const { preventureResearchAssignment: existingBinding, ...storedEnvelope } = payload;
      const workflowMetadata = parseObject(workflow.metadata, `Workflow ${workflowId} metadata`);
      if (
        (existingBinding && !sameCanonical(existingBinding, assignment))
        || task.agent !== "demand_validator"
        || Number(task.priority) !== 1
        || Number(task.max_retries) !== 0
        || task.approval_id !== null
        || Number(task.cost_budget_cents) !== assignment.maxCostAudCents
        || task.due_at !== assignment.expiresAt
        || !sameCanonical(storedEnvelope, expectedTaskEnvelope(assignment))
        || workflowMetadata.schema !== "pantheon.preventure-research-workflow.v1"
        || workflowMetadata.authorityHash !== assignment.authorityHash
        || workflowMetadata.activationEventHash !== assignment.activationEventHash
        || workflowMetadata.preparationOnly !== true
        || !sameCanonical(workflowMetadata.externalEffects, [])
        || workflowMetadata.externalCommercialSpendCapAudCents !== 0
        || workflowMetadata.buildAuthorized !== false
        || workflowMetadata.commercialTestAuthorized !== false
        || workflowMetadata.externalActionAuthorized !== false
      ) {
        fail(
          "preventure_research_assignment_conflict",
          "The task or workflow does not retain the exact protected execution envelope.",
        );
      }
      insertProjection(
        db,
        "preventure_research_assignments",
        assignmentProjection(assignment, timestamp(undefined, "Assignment creation time")),
      );
      db.prepare("UPDATE tasks SET payload = ?, updated_at = ? WHERE id = ?").run(
        canonicalJson({ ...payload, preventureResearchAssignment: assignment }),
        timestamp(undefined, "Task assignment update time"),
        taskId,
      );
      return { created: true, assignment: getAssignment(assignment.assignmentHash) };
    });
  }

  function isExactTechnicalTerminalReceipt(assignment, receiptRow) {
    if (
      receiptRow?.status !== "needs_review"
      || !["known", "failed_before_effect"].includes(receiptRow.outcome_status)
    ) return false;
    const latestReceipt = db.prepare(
      `SELECT id FROM agent_run_receipts
       WHERE attempt_id = ? ORDER BY sequence DESC LIMIT 1`,
    ).get(receiptRow.attempt_id);
    const attempt = db.prepare("SELECT * FROM task_attempts WHERE id = ?")
      .get(receiptRow.attempt_id);
    const task = attempt
      ? db.prepare("SELECT * FROM tasks WHERE id = ?").get(attempt.task_id)
      : null;
    const modelCall = attempt?.model_call_id
      ? db.prepare("SELECT * FROM model_calls WHERE id = ?").get(attempt.model_call_id)
      : null;
    const agentRun = receiptRow.run_id
      ? db.prepare("SELECT * FROM agent_runs WHERE id = ?").get(receiptRow.run_id)
      : null;
    const evaluation = db.prepare(
      `SELECT * FROM agent_eval_results
       WHERE attempt_id = ? ORDER BY created_at DESC, id DESC LIMIT 1`,
    ).get(receiptRow.attempt_id);
    const invocations = db.prepare(
      `SELECT * FROM agent_tool_invocations
       WHERE attempt_id = ? ORDER BY requested_at, id`,
    ).all(receiptRow.attempt_id);
    if (
      latestReceipt?.id !== receiptRow.id
      || !attempt
      || !task
      || !modelCall
      || !agentRun
      || !evaluation
      || attempt.task_id !== assignment.taskId
      || attempt.workflow_id !== assignment.workflowId
      || attempt.venture_id !== null
      || modelCall.task_id !== assignment.taskId
      || modelCall.workflow_id !== assignment.workflowId
      || modelCall.venture_id !== null
      || modelCall.attempt_id !== attempt.id
      || modelCall.provider !== assignment.provider
      || modelCall.selected_model !== assignment.model
      || agentRun.task_id !== assignment.taskId
      || agentRun.workflow_id !== assignment.workflowId
      || agentRun.venture_id !== null
      || agentRun.id !== attempt.agent_run_id
      || agentRun.status !== "failed"
      || evaluation.attempt_id !== attempt.id
      || evaluation.run_id !== agentRun.id
      || evaluation.task_id !== assignment.taskId
      || evaluation.status !== "failed"
      || task.status !== "completed"
      || task.claim_token !== null
      || Number(task.max_retries) !== 0
      || invocations.length !== 1
      || invocations[0].run_id !== agentRun.id
      || invocations[0].task_id !== assignment.taskId
      || invocations[0].workflow_id !== assignment.workflowId
      || invocations[0].status !== "completed"
    ) return false;
    const result = parseObject(task.result, `Task ${task.id} technical terminal result`);
    const responseIssues = result.responseIssues;
    if (
      result.schema !== "pantheon.preventure-research-task-result.v1"
      || result.authorityHash !== assignment.authorityHash
      || result.assignmentHash !== assignment.assignmentHash
      || !HASH_PATTERN.test(String(result.descriptorHash || ""))
      || !HASH_PATTERN.test(String(result.retainedOutputHash || ""))
      || result.rawOutputArtifactHash !== result.retainedOutputHash
      || !Array.isArray(responseIssues)
      || responseIssues.length < 1
      || !sameCanonical(responseIssues, [...new Set(responseIssues)].sort())
      || result.responseIssuesHash !== sha256(responseIssues)
      || !HASH_PATTERN.test(String(result.resultHash || ""))
      || result.retryAuthorized !== false
      || result.buildAuthorized !== false
      || result.commercialTestAuthorized !== false
      || result.externalActionAuthorized !== false
    ) return false;
    const preEffect = attempt.error_kind === "definite_pre_effect_http_rejection";
    const knownUnusable = attempt.error_kind === "known_provider_response_unusable";
    if (
      (preEffect && (
        receiptRow.outcome_status !== "failed_before_effect"
        || task.outcome_status !== "failed_before_effect"
        || attempt.status !== "failed"
        || attempt.outcome_status !== "failed_before_effect"
        || modelCall.status !== "failed"
        || modelCall.outcome_status !== "failed_before_effect"
        || modelCall.error_kind !== "definite_pre_effect_http_rejection"
        || result.providerResponseId !== null
        || result.providerZeroBillingGuarantee !== false
        || invocations[0].decision !== "provider_rejected_before_effect"
      ))
      || (knownUnusable && (
        receiptRow.outcome_status !== "known"
        || task.outcome_status !== "known"
        || attempt.status !== "completed"
        || attempt.outcome_status !== "known"
        || modelCall.status !== "completed"
        || modelCall.outcome_status !== "known"
        || modelCall.error_kind !== "known_provider_response_unusable"
        || invocations[0].decision !== "provider_response_unusable"
      ))
      || (!preEffect && !knownUnusable)
      || modelCall.cost_status === "unknown"
    ) return false;
    try {
      verifyExecutionReceiptChains(
        db,
        [assignment],
        executionEvidence(db, [assignment]),
      );
    } catch {
      return false;
    }
    return true;
  }

  function assertLinkedExecution(assignment, input, options = {}) {
    const bindings = [
      ["taskAttemptId", "task_attempts", "workflow_id, venture_id"],
      ["modelCallId", "model_calls", "workflow_id, venture_id, provider, selected_model AS model"],
      [
        "agentRunReceiptId",
        "agent_run_receipts",
        "attempt_id, run_id, sequence, status, outcome_status, receipt_hash, receipt",
      ],
    ];
    for (const [field, table, columns] of bindings) {
      if (!input[field]) continue;
      const row = db.prepare(`SELECT id, task_id, ${columns} FROM ${table} WHERE id = ?`).get(input[field]);
      if (
        !row
        || row.task_id !== assignment.taskId
        || (row.workflow_id !== undefined && row.workflow_id !== assignment.workflowId)
        || (row.venture_id !== undefined && row.venture_id !== null)
        || (field === "modelCallId" && (
          row.provider !== assignment.provider || row.model !== assignment.model
        ))
      ) {
        fail(
          "preventure_research_execution_binding_invalid",
          `${field} does not belong to the immutable assignment task.`,
        );
      }
      if (field === "agentRunReceiptId") {
        const attempt = db.prepare(
          "SELECT task_id, workflow_id, venture_id FROM task_attempts WHERE id = ?",
        ).get(row.attempt_id);
        if (
          !attempt
          || attempt.task_id !== assignment.taskId
          || attempt.workflow_id !== assignment.workflowId
          || attempt.venture_id !== null
          || (
            row.status !== "complete"
            && !(
              options.allowTechnicalTerminalReceipt === true
              && isExactTechnicalTerminalReceipt(assignment, row)
            )
            && !(
              options.allowTerminalRecoveryReceipt === true
              && Boolean(db.prepare(
                `SELECT 1
                 FROM preventure_research_terminal_recoveries
                 WHERE authority_hash = ? AND assignment_hash = ?
                   AND task_attempt_id = ? AND agent_run_receipt_id = ?
                   AND agent_run_receipt_hash = ?
                 LIMIT 1`,
              ).get(
                assignment.authorityHash,
                assignment.assignmentHash,
                row.attempt_id,
                row.id,
                canonicalAgentReceiptHash(row.receipt_hash),
              ))
            )
          )
        ) {
          fail(
            "preventure_research_execution_binding_invalid",
            "The linked agent receipt is not the final complete receipt for its immutable assignment attempt.",
          );
        }
      }
    }
    const costStatuses = {
      estimated: new Set(["estimated", "incurred_estimate"]),
      incurred: new Set(["incurred", "incurred_estimate"]),
      reconciled: new Set(["reconciled"]),
      released: new Set(["released"]),
      unknown: new Set(["unknown"]),
    };
    if (input.budgetReservationId) {
      const reservation = db.prepare(
        `SELECT id, task_id, workflow_id, venture_id, status, amount_cents, currency
         FROM budget_reservations WHERE id = ?`,
      ).get(input.budgetReservationId);
      const expectedReservationStatus = {
        reserved: "reserved",
        estimated: "incurred_estimate",
        incurred: "incurred_estimate",
        reconciled: "reconciled",
        released: "released",
        unknown: "unknown",
      }[input.eventType];
      const amountMatches = input.eventType === "released"
        ? input.amountAudCents === 0
          && input.exposureAudCents === 0
          && reservation?.amount_cents === 0
        : input.eventType === "unknown"
          ? input.amountAudCents === null && input.exposureAudCents === reservation?.amount_cents
          : ["estimated", "incurred"].includes(input.eventType)
            ? input.exposureAudCents === reservation?.amount_cents
              && input.amountAudCents <= input.exposureAudCents
            : input.amountAudCents === reservation?.amount_cents
              && input.exposureAudCents === reservation?.amount_cents;
      if (
        !reservation
        || reservation.task_id !== assignment.taskId
        || reservation.workflow_id !== assignment.workflowId
        || reservation.venture_id !== null
        || reservation.currency !== "AUD"
        || (expectedReservationStatus && reservation.status !== expectedReservationStatus)
        || (input.eventType && !amountMatches)
      ) {
        fail(
          "preventure_research_execution_binding_invalid",
          "The linked Pantheon budget reservation does not match the assignment or cost truth.",
        );
      }
    }
    if (input.costId) {
      const cost = db.prepare(
        `SELECT id, task_id, workflow_id, venture_id, model_call_id,
                status, amount_cents, currency
         FROM costs WHERE id = ?`,
      ).get(input.costId);
      const allowedStatuses = costStatuses[input.eventType];
      const amountMatches = input.eventType === "unknown"
        ? input.amountAudCents === null && input.exposureAudCents === cost?.amount_cents
        : input.eventType
          ? input.amountAudCents === cost?.amount_cents
          : true;
      if (
        !cost
        || cost.task_id !== assignment.taskId
        || cost.workflow_id !== assignment.workflowId
        || cost.venture_id !== null
        || cost.currency !== "AUD"
        || (input.modelCallId && cost.model_call_id !== input.modelCallId)
        || (cost.model_call_id && cost.model_call_id !== input.modelCallId)
        || (allowedStatuses && !allowedStatuses.has(cost.status))
        || !amountMatches
      ) {
        fail(
          "preventure_research_execution_binding_invalid",
          "The linked Pantheon cost record does not match the assignment or authoritative cost truth.",
        );
      }
    }
  }

  function assertSourceExecution(assignment, source) {
    assertLinkedExecution(assignment, { agentRunReceiptId: source.agentRunReceiptId });
    let receiptRow = null;
    let receiptSnapshot = null;
    if (source.agentRunReceiptId) {
      const execution = executionEvidence(db, [assignment]);
      verifyExecutionReceiptChains(db, [assignment], execution);
      receiptRow = execution.agentRunReceipts.find(
        (item) => item.id === source.agentRunReceiptId,
      );
      if (!receiptRow || receiptRow.status !== "complete") {
        fail(
          "preventure_research_source_invalid",
          "A retained source may only bind to the final complete canonical agent receipt.",
        );
      }
      receiptSnapshot = parseObject(receiptRow.receipt, "Agent source receipt");
    }
    const researchRun = source.researchRunId
      ? db.prepare(
        `SELECT id, workflow_id, task_id, venture_id, provider
         FROM research_runs WHERE id = ?`,
      ).get(source.researchRunId)
      : null;
    const groundedStatus = ["captured", "partial"].includes(source.captureStatus);
    if (
      groundedStatus
      && (
        !source.agentRunReceiptId
        || !researchRun
        || !source.sourceRecordId
        || !source.provenanceId
      )
    ) {
      fail(
        "preventure_research_source_invalid",
        "A grounded source requires its exact retained research run, source record, provenance row, and final canonical receipt.",
      );
    }
    if (researchRun && (
      researchRun.workflow_id !== assignment.workflowId
      || researchRun.task_id !== assignment.taskId
      || researchRun.venture_id !== null
      || researchRun.provider !== assignment.provider
    )) {
      fail(
        "preventure_research_source_invalid",
        "The retained research run escaped its immutable assignment.",
      );
    }
    if (receiptSnapshot && source.researchRunId) {
      if (!receiptSnapshot.research?.runs?.some((item) => item.id === source.researchRunId)) {
        fail(
          "preventure_research_source_invalid",
          "The canonical agent receipt does not retain the linked research run.",
        );
      }
    }
    let sourceRecord = null;
    if (source.sourceRecordId) {
      sourceRecord = db.prepare(
        `SELECT sources.id, sources.run_id, sources.title, sources.url,
                sources.publisher, sources.published_at, sources.retrieved_at,
                sources.metadata,
                runs.workflow_id, runs.task_id, runs.venture_id
         FROM research_sources AS sources
         JOIN research_runs AS runs ON runs.id = sources.run_id
         WHERE sources.id = ?`,
      ).get(source.sourceRecordId);
      if (
        !sourceRecord
        || sourceRecord.run_id !== source.researchRunId
        || sourceRecord.task_id !== assignment.taskId
        || sourceRecord.workflow_id !== assignment.workflowId
        || sourceRecord.venture_id !== null
        || (source.url && sourceRecord.url !== source.url)
      ) {
        fail(
          "preventure_research_source_invalid",
          "The linked public-source record does not belong to the retained assignment run.",
        );
      }
    }
    let provenance = null;
    if (source.provenanceId) {
      provenance = db.prepare(
        `SELECT id, run_id, task_id, attempt_id, model_call_id,
                research_run_id, research_source_id, kind, title, url,
                grounding_type, output_hash
         FROM agent_run_provenance WHERE id = ?`,
      ).get(source.provenanceId);
      if (
        !provenance
        || provenance.task_id !== assignment.taskId
        || (source.researchRunId && provenance.research_run_id !== source.researchRunId)
        || (source.sourceRecordId && provenance.research_source_id !== source.sourceRecordId)
      ) {
        fail(
          "preventure_research_source_invalid",
          "The linked provenance record does not belong to the exact assignment evidence chain.",
        );
      }
    }
    if (groundedStatus) {
      const metadata = parseObject(
        sourceRecord.metadata,
        `Grounded source ${source.sourceRecordId} metadata`,
      );
      const modelCallId = receiptSnapshot?.attempt?.modelCallId;
      if (
        sourceRecord.title !== source.title
        || sourceRecord.url !== source.url
        || sourceRecord.publisher !== source.publisher
        || sourceRecord.published_at !== source.publishedAt
        || sourceRecord.retrieved_at !== source.retrievedAt
        || metadata.providerGrounded !== true
        || metadata.contentHash !== source.contentHash
        || metadata.contentLocation !== source.contentLocation
        || metadata.canonicalUrl !== source.canonicalUrl
        || metadata.canonicalHost !== source.canonicalHost
        || metadata.sourceIdentityUrl !== source.sourceIdentityUrl
        || metadata.sourceIdentityHash !== source.sourceIdentityHash
        || metadata.marketplaceChannelId !== source.marketplaceChannelId
        || metadata.offerIdentityKey !== source.offerIdentityKey
        || metadata.sellerIdentityKey !== source.sellerIdentityKey
        || metadata.identityDerivation !== source.identityDerivation
        || metadata.publisherIdentityKey !== source.publisherIdentityKey
        || metadata.buyerIndependenceGroup !== source.buyerIndependenceGroup
        || !sameCanonical(metadata.limitations, source.limitations)
        || provenance.run_id !== receiptRow.run_id
        || provenance.attempt_id !== receiptRow.attempt_id
        || provenance.model_call_id !== modelCallId
        || provenance.kind !== "web_source"
        || provenance.title !== source.title
        || provenance.url !== source.url
        || !provenance.grounding_type
        || provenance.output_hash !== source.contentHash
        || !receiptSnapshot.research?.sources?.some((item) => item.id === source.sourceRecordId)
        || !receiptSnapshot.research?.provenance?.some((item) => item.id === source.provenanceId)
        || (source.captureStatus === "captured" && metadata.directArtifactCaptured !== true)
        || (source.captureStatus === "partial" && metadata.directArtifactCaptured === true)
      ) {
        fail(
          "preventure_research_source_invalid",
          "Grounded source fields are not identical to the source and provenance retained by the final receipt.",
        );
      }
    }
  }

  function assertEvidenceLedgerUnsealed(authorityHash) {
    if (db.prepare(
      "SELECT decision_hash FROM preventure_research_decisions WHERE authority_hash = ?",
    ).get(authorityHash) || db.prepare(
      "SELECT recovery_hash FROM preventure_research_terminal_recoveries WHERE authority_hash = ? LIMIT 1",
    ).get(authorityHash)) {
      fail(
        "preventure_research_ledger_sealed",
        "The diligence decision or terminal custody record sealed further commercial evidence.",
      );
    }
  }

  function activeResearchWrite(authorityHash) {
    if (db.prepare(
      "SELECT recovery_hash FROM preventure_research_terminal_recoveries WHERE authority_hash = ? LIMIT 1",
    ).get(authorityHash)) return false;
    const authority = requireCandidateAuthority(authorityHash, "Active research writing");
    const events = loadLifecycleRows(db, authority);
    return effectivePreventureLifecycleState(
      authority,
      events,
      timestamp(undefined, "Research write evaluation time"),
    ) === "activated";
  }

  function appendCostEvent(assignmentHash, input = {}) {
    return atomic(() => {
      const assignment = getAssignment(assignmentHash);
      if (!assignment) fail("preventure_research_assignment_missing", "The research assignment is not registered.");
      const eventType = cleanText(input.eventType, "Cost event type");
      if (!COST_EVENT_TYPES.has(eventType)) {
        fail("preventure_research_cost_invalid", "The cost event type is unsupported.");
      }
      const amountAudCents = eventType === "unknown"
        ? null
        : exactInteger(input.amountAudCents, "Cost amount");
      if (eventType === "unknown" && input.amountAudCents !== null && input.amountAudCents !== undefined) {
        fail("preventure_research_cost_invalid", "Unknown cost cannot carry an invented amount.");
      }
      const exposureAudCents = exactInteger(input.exposureAudCents, "Cost exposure");
      if (
        exposureAudCents > assignment.maxCostAudCents
        || (amountAudCents !== null && amountAudCents > assignment.maxCostAudCents)
      ) {
        fail("preventure_research_cost_cap_exceeded", "Cost truth exceeds the assignment cap.");
      }
      const normalized = {
        taskAttemptId: input.taskAttemptId ? cleanId(input.taskAttemptId, "Task attempt ID") : null,
        modelCallId: input.modelCallId ? cleanId(input.modelCallId, "Model call ID") : null,
        budgetReservationId: input.budgetReservationId
          ? cleanId(input.budgetReservationId, "Pantheon budget reservation ID")
          : null,
        costId: input.costId ? cleanId(input.costId, "Pantheon cost ID") : null,
        agentRunReceiptId: input.agentRunReceiptId
          ? cleanId(input.agentRunReceiptId, "Agent receipt ID")
          : null,
      };
      const costKey = cleanId(input.costKey, "Cost key");
      const priorRows = db.prepare(
        `SELECT * FROM preventure_research_cost_events
         WHERE assignment_hash = ? AND cost_key = ? ORDER BY sequence`,
      ).all(assignment.assignmentHash, costKey);
      const prior = readCostRows(priorRows);
      const occurredAt = timestamp(input.occurredAt, "Cost event time");
      const replayFields = {
        eventType,
        amountAudCents,
        exposureAudCents,
        ...normalized,
        occurredAt,
      };
      if (prior.length > 0 && Object.entries(replayFields).every(
        ([key, value]) => sameCanonical(prior.at(-1)[key], value),
      )) {
        return { created: false, costEvent: prior.at(-1) };
      }
      const sealedDecision = db.prepare(
        "SELECT decision_hash, decided_at FROM preventure_research_decisions WHERE authority_hash = ?",
      ).get(assignment.authorityHash);
      if (sealedDecision) {
        fail(
          "preventure_research_ledger_sealed",
          "A sealed decision only accepts provider billing through the dedicated reconciliation seam.",
        );
      }
      assertLinkedExecution(assignment, replayFields, {
        allowTechnicalTerminalReceipt: true,
      });
      if (
        !activeResearchWrite(assignment.authorityHash)
        && !(prior.length > 0 && ["unknown", "reconciled", "released"].includes(eventType))
      ) {
        fail(
          "preventure_research_ledger_not_active",
          "New cost work requires active unexpired authority; only late truth reconciliation may append after stop.",
        );
      }
      if (prior.length && Date.parse(occurredAt) < Date.parse(prior.at(-1).occurredAt)) {
        fail("preventure_research_cost_chain_invalid", "Cost truth cannot move backward in time.");
      }
      const body = {
        schema: PREVENTURE_RESEARCH_COST_SCHEMA,
        authorityHash: assignment.authorityHash,
        assignmentHash: assignment.assignmentHash,
        costKey,
        sequence: prior.length + 1,
        previousReceiptHash: prior.at(-1)?.receiptHash ?? null,
        eventType,
        amountAudCents,
        exposureAudCents,
        ...normalized,
        occurredAt,
      };
      const costEvent = sealedRecord(body, "receiptHash");
      const authority = requireAuthority(assignment.authorityHash);
      const authorityAssignments = listAssignments(assignment.authorityHash);
      const existingAuthorityCosts = readCostRows(loadRowsByAuthority(
        db,
        "preventure_research_cost_events",
        assignment.authorityHash,
        "assignment_hash, cost_key, sequence",
      ));
      const candidateHeads = latestCostHeads([...existingAuthorityCosts, costEvent]);
      for (const storedAssignment of authorityAssignments) {
        const assignmentHeads = candidateHeads.filter(
          (item) => item.assignmentHash === storedAssignment.assignmentHash,
        );
        const assignmentExposure = assignmentHeads.reduce(
          (sum, item) => sum + item.exposureAudCents,
          0,
        );
        const assignmentKnownCost = assignmentHeads.reduce(
          (sum, item) => sum + Number(item.amountAudCents || 0),
          0,
        );
        if (
          assignmentExposure > storedAssignment.maxCostAudCents
          || assignmentKnownCost > storedAssignment.maxCostAudCents
        ) {
          fail(
            "preventure_research_cost_cap_exceeded",
            `Latest cost truth for assignment ${storedAssignment.id} exceeds its immutable cap.`,
          );
        }
      }
      const totalExposure = candidateHeads.reduce(
        (sum, item) => sum + item.exposureAudCents,
        0,
      );
      const totalKnownCost = candidateHeads.reduce(
        (sum, item) => sum + Number(item.amountAudCents || 0),
        0,
      );
      const committedCap = authorityAssignments.reduce(
        (sum, item) => sum + item.maxCostAudCents,
        0,
      );
      if (
        totalExposure > authority.internalAiSpendCapAudCents
        || totalExposure > committedCap
        || totalKnownCost > authority.internalAiSpendCapAudCents
        || totalKnownCost > committedCap
      ) {
        fail(
          "preventure_research_cost_cap_exceeded",
          "Latest aggregate cost truth exceeds the authority or committed assignment ceiling.",
        );
      }
      const exact = db.prepare(
        "SELECT * FROM preventure_research_cost_events WHERE receipt_hash = ?",
      ).get(costEvent.receiptHash);
      if (exact) return { created: false, costEvent: readCostRows([exact])[0] };
      insertProjection(
        db,
        "preventure_research_cost_events",
        costProjection(costEvent, timestamp(undefined, "Cost receipt creation time")),
      );
      return { created: true, costEvent };
    });
  }

  function recordOwnerAttestedProviderBillingObservation(
    assignmentHash,
    input = {},
    options = {},
  ) {
    return atomic(() => {
      const rawPredecessor = isObject(input?.predecessor) ? input.predecessor : {};
      const attestationBinding = canonical({
        actionKind: input?.actionKind,
        authorityHash: input?.authorityHash,
        assignmentHash,
        predecessorKind: rawPredecessor.kind,
        predecessorHash: rawPredecessor.hash,
        expectedPreviousReceiptHash: rawPredecessor.expectedPreviousReceiptHash,
        observationIntentHash: sha256(canonical(input)),
        observedAt: input?.observedAt,
      });
      try {
        consumeAuthenticatedOwnerBillingObservationAttestation(
          options?.ownerSessionAttestation,
          attestationBinding,
          db,
        );
      } catch (cause) {
        fail(
          "preventure_owner_billing_observation_attestation_invalid",
          String(
            cause?.message
            || "This billing observation requires a fresh authenticated owner session.",
          ),
        );
      }

      const inputKeys = [
        "actionKind",
        "authorityHash",
        "assignmentTemplateHash",
        "taskId",
        "predecessor",
        "costKey",
        "taskAttemptId",
        "modelCallId",
        "agentRunReceiptId",
        "agentRunReceiptHash",
        "budgetReservationId",
        "costId",
        "clientRequestId",
        "providerRequestId",
        "providerResponseId",
        "provider",
        "providerDispatchedAt",
        "providerAccountReferenceHash",
        "billingRecordReferenceHash",
        "currency",
        "amountAudCents",
        "observedAt",
        "originalCostOccurredAt",
        "allocationBasis",
        "limitations",
      ];
      if (
        !hasExactKeys(input, inputKeys)
        || input.actionKind !== PREVENTURE_RESEARCH_OWNER_BILLING_ACTION_KIND
        || !hasExactKeys(rawPredecessor, [
          "kind",
          "hash",
          "expectedPreviousReceiptHash",
        ])
        || !["sealed_decision", "terminal_recovery"].includes(rawPredecessor.kind)
        || !hasExactKeys(input.allocationBasis, [
          "method",
          "amountAudCents",
          "currency",
          "providerDispatchedAt",
          "originalCostOccurredAt",
        ])
        || input.currency !== "AUD"
        || !Number.isSafeInteger(input.amountAudCents)
        || input.amountAudCents < 0
        || input.allocationBasis.method
          !== PREVENTURE_RESEARCH_OWNER_BILLING_ALLOCATION_METHOD
        || input.allocationBasis.currency !== "AUD"
        || input.allocationBasis.amountAudCents !== input.amountAudCents
        || input.allocationBasis.providerDispatchedAt !== input.providerDispatchedAt
        || input.allocationBasis.originalCostOccurredAt !== input.originalCostOccurredAt
        || !Array.isArray(input.limitations)
        || input.limitations.length !== 1
        || input.limitations[0]
          !== "This is an authenticated owner observation of provider billing, not a provider-settled API receipt."
        || !Number.isFinite(Date.parse(input.observedAt))
        || !Number.isFinite(Date.parse(input.originalCostOccurredAt))
        || !Number.isFinite(Date.parse(input.providerDispatchedAt))
        || Date.parse(input.observedAt) < Date.parse(input.providerDispatchedAt)
        || !HASH_PATTERN.test(String(input.providerAccountReferenceHash || ""))
        || !HASH_PATTERN.test(String(input.billingRecordReferenceHash || ""))
        || !HASH_PATTERN.test(String(rawPredecessor.hash || ""))
        || !HASH_PATTERN.test(String(rawPredecessor.expectedPreviousReceiptHash || ""))
        || !HASH_PATTERN.test(String(input.agentRunReceiptHash || ""))
        || !PROVIDER_RESPONSE_ID_PATTERN.test(String(input.providerResponseId || ""))
        || !SAFE_ID_PATTERN.test(String(input.clientRequestId || ""))
        || !(
          input.providerRequestId === null
          || (
            SAFE_ID_PATTERN.test(String(input.providerRequestId || ""))
            && !String(input.providerRequestId).startsWith("resp_")
          )
        )
      ) {
        fail(
          "preventure_research_owner_billing_observation_invalid",
          "The owner billing observation is incomplete, widened, or not valid AUD billing truth.",
        );
      }

      const assignment = getAssignment(assignmentHash);
      if (!assignment) {
        fail(
          "preventure_research_owner_billing_observation_binding_changed",
          "The owner billing observation no longer matches a registered assignment.",
        );
      }
      const existingObservation = db.prepare(
        `SELECT observation_hash
         FROM preventure_research_provider_billing_observations
         WHERE assignment_hash = ?`,
      ).get(assignment.assignmentHash);
      if (existingObservation) {
        fail(
          "preventure_research_owner_billing_observation_already_recorded",
          "This assignment already has an immutable owner-attested billing observation.",
        );
      }

      const ledger = readLedger(assignment.authorityHash);
      const chain = ledger.costEvents.filter((event) => (
        event.assignmentHash === assignment.assignmentHash
        && event.costKey === input.costKey
      )).sort((left, right) => left.sequence - right.sequence);
      const predecessor = chain.at(-1);
      if (
        input.costKey !== predecessor?.costKey
        || rawPredecessor.expectedPreviousReceiptHash !== predecessor?.receiptHash
      ) {
        fail(
          "preventure_research_owner_billing_observation_cost_changed",
          "The immutable cost head changed before this owner observation could be recorded.",
        );
      }
      const originalCost = chain[0];
      if (
        !originalCost
        || input.originalCostOccurredAt !== originalCost.occurredAt
        || predecessor.costId !== input.costId
        || predecessor.budgetReservationId !== input.budgetReservationId
      ) {
        fail(
          "preventure_research_owner_billing_observation_cost_changed",
          "The owner observation changed its original usage date or Pantheon cost identity.",
        );
      }

      const terminalRecovery = rawPredecessor.kind === "terminal_recovery"
        ? ledger.terminalRecoveries.find(
            (item) => item.recoveryHash === rawPredecessor.hash,
          )
        : null;
      const sealedDecision = rawPredecessor.kind === "sealed_decision"
        ? ledger.decision
        : null;
      const exactPredecessor = terminalRecovery
        ? terminalRecovery.costSnapshot.terminalReceiptHash === predecessor.receiptHash
        : sealedDecision?.decisionHash === rawPredecessor.hash;
      if (!exactPredecessor) {
        fail(
          "preventure_research_owner_billing_observation_binding_changed",
          "The owner observation no longer matches its exact terminal recovery or sealed decision.",
        );
      }

      const attempt = db.prepare("SELECT * FROM task_attempts WHERE id = ?")
        .get(input.taskAttemptId);
      const modelCall = db.prepare("SELECT * FROM model_calls WHERE id = ?")
        .get(input.modelCallId);
      const receipt = db.prepare("SELECT * FROM agent_run_receipts WHERE id = ?")
        .get(input.agentRunReceiptId);
      const reservation = db.prepare("SELECT * FROM budget_reservations WHERE id = ?")
        .get(input.budgetReservationId);
      const genericCost = db.prepare("SELECT * FROM costs WHERE id = ?")
        .get(input.costId);
      const canonicalReceiptHash = receipt
        ? canonicalAgentReceiptHash(receipt.receipt_hash)
        : null;
      const terminalDispatch = terminalRecovery?.originalDispatch || null;
      const expectedProviderDispatchedAt = terminalDispatch?.providerDispatchedAt
        || predecessor.occurredAt;
      const expectedClientRequestId = terminalDispatch?.clientRequestId
        || parseObject(modelCall?.metadata || "{}", "Provider model-call metadata")
          .clientRequestId;
      const expectedProviderRequestId = terminalDispatch
        ? terminalDispatch.providerRequestId
        : modelCall?.provider_request_id;
      const expectedProviderResponseId = terminalDispatch
        ? terminalDispatch.providerResponseId
        : parseObject(modelCall?.metadata || "{}", "Provider model-call metadata")
          .providerResponseId;
      if (
        input.authorityHash !== assignment.authorityHash
        || input.assignmentTemplateHash !== assignment.templateHash
        || input.taskId !== assignment.taskId
        || input.provider !== assignment.provider
        || predecessor.taskAttemptId !== input.taskAttemptId
        || predecessor.modelCallId !== input.modelCallId
        || predecessor.agentRunReceiptId !== input.agentRunReceiptId
        || !attempt
        || attempt.task_id !== assignment.taskId
        || !modelCall
        || modelCall.task_id !== assignment.taskId
        || modelCall.provider !== assignment.provider
        || modelCall.selected_model !== assignment.model
        || !receipt
        || receipt.task_id !== assignment.taskId
        || receipt.attempt_id !== input.taskAttemptId
        || canonicalReceiptHash !== input.agentRunReceiptHash
        || !reservation
        || reservation.task_id !== assignment.taskId
        || reservation.workflow_id !== assignment.workflowId
        || reservation.venture_id !== null
        || reservation.currency !== "AUD"
        || !genericCost
        || genericCost.task_id !== assignment.taskId
        || genericCost.workflow_id !== assignment.workflowId
        || genericCost.venture_id !== null
        || genericCost.model_call_id !== input.modelCallId
        || genericCost.currency !== "AUD"
        || input.clientRequestId !== expectedClientRequestId
        || input.providerRequestId !== expectedProviderRequestId
        || input.providerResponseId !== expectedProviderResponseId
        || input.providerDispatchedAt !== expectedProviderDispatchedAt
      ) {
        fail(
          "preventure_research_owner_billing_observation_binding_changed",
          "The owner observation changed its assignment, provider, execution, or accounting identity.",
        );
      }
      assertLinkedExecution(assignment, predecessor, {
        allowTechnicalTerminalReceipt: true,
        allowTerminalRecoveryReceipt: true,
      });

      const recordedAt = timestamp(undefined, "Owner billing observation recording time");
      if (Date.parse(input.observedAt) > Date.parse(recordedAt)) {
        fail(
          "preventure_research_owner_billing_observation_invalid",
          "An owner billing observation cannot be recorded before it was observed.",
        );
      }
      const overageAudCents = Math.max(
        0,
        input.amountAudCents - assignment.maxCostAudCents,
      );
      const budgetComparison = Object.freeze({
        approvedAssignmentCapAudCents: assignment.maxCostAudCents,
        observedActualAudCents: input.amountAudCents,
        breached: overageAudCents > 0,
        overageAudCents,
      });
      const observationBody = {
        schema: PREVENTURE_RESEARCH_OWNER_BILLING_OBSERVATION_SCHEMA,
        actionKind: PREVENTURE_RESEARCH_OWNER_BILLING_ACTION_KIND,
        authorityHash: assignment.authorityHash,
        assignmentHash: assignment.assignmentHash,
        assignmentTemplateHash: assignment.templateHash,
        taskId: assignment.taskId,
        predecessor: canonical(rawPredecessor),
        executionIdentity: canonical({
          taskAttemptId: input.taskAttemptId,
          modelCallId: input.modelCallId,
          agentRunReceiptId: input.agentRunReceiptId,
          agentRunReceiptHash: input.agentRunReceiptHash,
          clientRequestId: input.clientRequestId,
          providerRequestId: input.providerRequestId,
          providerResponseId: input.providerResponseId,
          providerDispatchedAt: input.providerDispatchedAt,
        }),
        costBinding: canonical({
          costKey: input.costKey,
          expectedPreviousReceiptHash: predecessor.receiptHash,
          budgetReservationId: input.budgetReservationId,
          costId: input.costId,
        }),
        billingObservation: canonical({
          provider: input.provider,
          providerAccountReferenceHash: input.providerAccountReferenceHash,
          billingRecordReferenceHash: input.billingRecordReferenceHash,
          currency: "AUD",
          amountAudCents: input.amountAudCents,
          observedAt: input.observedAt,
          originalCostOccurredAt: input.originalCostOccurredAt,
          allocationBasis: input.allocationBasis,
          limitations: input.limitations,
        }),
        budgetComparison,
        truth: Object.freeze({
          source: "authenticated_owner_session_attestation",
          status: PREVENTURE_RESEARCH_OWNER_BILLING_TRUTH_STATUS,
          statement: "Owner-attested provider billing observation; not provider-settled.",
        }),
        recordedAt,
      };
      const observation = sealedRecord(observationBody, "observationHash");
      const costBody = {
        schema: PREVENTURE_RESEARCH_COST_SCHEMA,
        authorityHash: assignment.authorityHash,
        assignmentHash: assignment.assignmentHash,
        costKey: input.costKey,
        sequence: predecessor.sequence + 1,
        previousReceiptHash: predecessor.receiptHash,
        eventType: "reconciled",
        amountAudCents: input.amountAudCents,
        exposureAudCents: input.amountAudCents,
        taskAttemptId: input.taskAttemptId,
        modelCallId: input.modelCallId,
        budgetReservationId: input.budgetReservationId,
        costId: input.costId,
        agentRunReceiptId: input.agentRunReceiptId,
        ownerBillingObservationHash: observation.observationHash,
        occurredAt: input.originalCostOccurredAt,
      };
      const costEvent = sealedRecord(costBody, "receiptHash");
      const billingMetadata = {
        authorityHash: assignment.authorityHash,
        assignmentHash: assignment.assignmentHash,
        costKey: input.costKey,
        exactBillingPending: false,
        ownerBillingObservationHash: observation.observationHash,
        ownerBillingCostReceiptHash: costEvent.receiptHash,
        ownerBillingPreviousReceiptHash: predecessor.receiptHash,
        ownerBillingRecordedAt: recordedAt,
        originalCostOccurredAt: input.originalCostOccurredAt,
        billingTruthStatus: PREVENTURE_RESEARCH_OWNER_BILLING_TRUTH_STATUS,
      };
      const reservationMetadata = canonicalJson({
        ...parseObject(reservation.metadata, "Budget reservation metadata"),
        ...billingMetadata,
      });
      const costMetadata = canonicalJson({
        ...parseObject(genericCost.metadata, "Pantheon cost metadata"),
        ...billingMetadata,
      });
      const modelCallMetadata = canonicalJson({
        ...parseObject(modelCall.metadata, "Model-call metadata"),
        ...billingMetadata,
      });

      return withPreventureOwnerBillingObservationCapability(db, {
        authorityHash: assignment.authorityHash,
        assignmentHash: assignment.assignmentHash,
        observationHash: observation.observationHash,
        observationJson: canonicalJson(observation),
        costKey: input.costKey,
        expectedPreviousReceiptHash: predecessor.receiptHash,
        reconciledReceiptHash: costEvent.receiptHash,
        taskAttemptId: input.taskAttemptId,
        modelCallId: input.modelCallId,
        agentRunReceiptId: input.agentRunReceiptId,
        budgetReservationId: input.budgetReservationId,
        costId: input.costId,
        amountAudCents: input.amountAudCents,
        originalCostOccurredAt: input.originalCostOccurredAt,
        recordedAt,
        reservationMetadata,
        costMetadata,
        modelCallMetadata,
      }, () => {
        insertProjection(
          db,
          "preventure_research_provider_billing_observations",
          ownerBillingObservationProjection(observation, recordedAt),
        );
        insertProjection(
          db,
          "preventure_research_cost_events",
          costProjection(costEvent, recordedAt),
        );
        const reservationChanged = db.prepare(
          `UPDATE budget_reservations
           SET status = 'reconciled', amount_cents = ?, resolved_at = ?, metadata = ?
           WHERE id = ? AND task_id = ? AND workflow_id = ? AND venture_id IS NULL
             AND currency = 'AUD'`,
        ).run(
          input.amountAudCents,
          recordedAt,
          reservationMetadata,
          input.budgetReservationId,
          assignment.taskId,
          assignment.workflowId,
        );
        const costChanged = db.prepare(
          `UPDATE costs
           SET status = 'reconciled', amount_cents = ?, occurred_at = ?, metadata = ?
           WHERE id = ? AND task_id = ? AND workflow_id = ? AND venture_id IS NULL
             AND model_call_id = ? AND currency = 'AUD'`,
        ).run(
          input.amountAudCents,
          input.originalCostOccurredAt,
          costMetadata,
          input.costId,
          assignment.taskId,
          assignment.workflowId,
          input.modelCallId,
        );
        const modelChanged = db.prepare(
          `UPDATE model_calls
           SET cost_status = 'reconciled', actual_cost_cents = ?,
               reconciled_cost_cents = ?, metadata = ?
           WHERE id = ? AND task_id = ? AND workflow_id = ? AND venture_id IS NULL`,
        ).run(
          input.amountAudCents,
          input.amountAudCents,
          modelCallMetadata,
          input.modelCallId,
          assignment.taskId,
          assignment.workflowId,
        );
        if (
          Number(reservationChanged.changes) !== 1
          || Number(costChanged.changes) !== 1
          || Number(modelChanged.changes) !== 1
        ) {
          fail(
            "preventure_research_owner_billing_observation_cost_changed",
            "The accounting projections changed before the owner observation could commit.",
          );
        }
        return {
          created: true,
          observation,
          costEvent,
          budgetBreach: budgetComparison,
        };
      });
    });
  }

  function normalizeProviderCostReconciliation(assignment, decision, input = {}) {
    const inputKeys = [
      "authorityHash",
      "assignmentTemplateHash",
      "taskId",
      "costKey",
      "expectedPreviousReceiptHash",
      "taskAttemptId",
      "modelCallId",
      "agentRunReceiptId",
      "agentRunReceiptHash",
      "budgetReservationId",
      "costId",
      "clientRequestId",
      "providerRequestId",
      "providerResponseId",
      "amountAudCents",
      "billingEvidenceHash",
      "allocation",
      "occurredAt",
    ];
    if (!hasExactKeys(input, inputKeys)) {
      fail(
        "preventure_research_reconciliation_invalid",
        "Provider-cost reconciliation requires one exact evidence and allocation binding.",
      );
    }
    if (!hasExactKeys(input.allocation, ["currency", "amountAudCents", "method"])) {
      fail(
        "preventure_research_reconciliation_invalid",
        "Provider-cost allocation must contain only currency, amount, and method.",
      );
    }
    const amountAudCents = exactInteger(input.amountAudCents, "Reconciled provider cost");
    const occurredAt = timestamp(input.occurredAt, "Provider billing reconciliation time");
    const normalized = {
      authorityHash: exactHash(input.authorityHash, "Reconciliation authority hash"),
      assignmentTemplateHash: exactHash(
        input.assignmentTemplateHash,
        "Reconciliation assignment-template hash",
      ),
      taskId: cleanId(input.taskId, "Reconciliation task ID"),
      costKey: cleanId(input.costKey, "Reconciliation cost key"),
      expectedPreviousReceiptHash: exactHash(
        input.expectedPreviousReceiptHash,
        "Reconciliation predecessor receipt hash",
      ),
      taskAttemptId: cleanId(input.taskAttemptId, "Reconciliation task-attempt ID"),
      modelCallId: cleanId(input.modelCallId, "Reconciliation model-call ID"),
      agentRunReceiptId: cleanId(input.agentRunReceiptId, "Reconciliation agent-receipt ID"),
      agentRunReceiptHash: exactHash(
        input.agentRunReceiptHash,
        "Reconciliation agent-receipt hash",
      ),
      budgetReservationId: cleanId(
        input.budgetReservationId,
        "Reconciliation budget-reservation ID",
      ),
      costId: cleanId(input.costId, "Reconciliation Pantheon cost ID"),
      clientRequestId: cleanId(input.clientRequestId, "Reconciliation client request ID"),
      providerRequestId: cleanId(input.providerRequestId, "Provider header request ID"),
      providerResponseId: String(input.providerResponseId || ""),
      amountAudCents,
      billingEvidenceHash: exactHash(input.billingEvidenceHash, "Provider billing evidence hash"),
      allocation: {
        currency: input.allocation.currency,
        amountAudCents: exactInteger(
          input.allocation.amountAudCents,
          "Provider billing allocation amount",
        ),
        method: input.allocation.method,
      },
      occurredAt,
    };
    if (
      normalized.authorityHash !== assignment.authorityHash
      || normalized.assignmentTemplateHash !== assignment.templateHash
      || normalized.taskId !== assignment.taskId
      || !PROVIDER_RESPONSE_ID_PATTERN.test(normalized.providerResponseId)
      || normalized.providerRequestId === normalized.providerResponseId
      || normalized.providerRequestId.startsWith("resp_")
      || normalized.allocation.currency !== "AUD"
      || normalized.allocation.amountAudCents !== amountAudCents
      || normalized.allocation.method !== "provider_billing_evidence"
      || Date.parse(occurredAt) <= Date.parse(decision.decidedAt)
    ) {
      fail(
        "preventure_research_reconciliation_invalid",
        "Provider-cost reconciliation changed its assignment, request identities, allocation, or decision-time boundary.",
      );
    }
    return normalized;
  }

  function assertProviderCostReconciliationTrail(
    assignment,
    decision,
    predecessor,
    costEvent,
    ledger,
  ) {
    const reconciliation = costEvent.reconciliation;
    const reconciliationKeys = [
      "schema",
      "authorityHash",
      "assignmentHash",
      "assignmentTemplateHash",
      "taskId",
      "decisionHash",
      "costKey",
      "expectedPreviousReceiptHash",
      "taskAttemptId",
      "modelCallId",
      "agentRunReceiptId",
      "agentRunReceiptHash",
      "budgetReservationId",
      "costId",
      "clientRequestId",
      "providerRequestId",
      "providerResponseId",
      "amountAudCents",
      "billingEvidenceHash",
      "allocation",
      "reconciledAt",
    ];
    if (
      !hasExactKeys(reconciliation, reconciliationKeys)
      || reconciliation.schema !== PREVENTURE_RESEARCH_PROVIDER_COST_RECONCILIATION_SCHEMA
      || !hasExactKeys(reconciliation.allocation, ["currency", "amountAudCents", "method"])
      || reconciliation.authorityHash !== assignment.authorityHash
      || reconciliation.assignmentHash !== assignment.assignmentHash
      || reconciliation.assignmentTemplateHash !== assignment.templateHash
      || reconciliation.taskId !== assignment.taskId
      || reconciliation.decisionHash !== decision.decisionHash
      || reconciliation.costKey !== costEvent.costKey
      || reconciliation.expectedPreviousReceiptHash !== predecessor.receiptHash
      || reconciliation.taskAttemptId !== costEvent.taskAttemptId
      || reconciliation.modelCallId !== costEvent.modelCallId
      || reconciliation.agentRunReceiptId !== costEvent.agentRunReceiptId
      || reconciliation.budgetReservationId !== costEvent.budgetReservationId
      || reconciliation.costId !== costEvent.costId
      || reconciliation.amountAudCents !== costEvent.amountAudCents
      || reconciliation.reconciledAt !== costEvent.occurredAt
      || !HASH_PATTERN.test(String(reconciliation.agentRunReceiptHash || ""))
      || !HASH_PATTERN.test(String(reconciliation.billingEvidenceHash || ""))
      || !SAFE_ID_PATTERN.test(String(reconciliation.clientRequestId || ""))
      || !SAFE_ID_PATTERN.test(String(reconciliation.providerRequestId || ""))
      || !PROVIDER_RESPONSE_ID_PATTERN.test(String(reconciliation.providerResponseId || ""))
      || reconciliation.providerRequestId === reconciliation.providerResponseId
      || reconciliation.providerRequestId.startsWith("resp_")
      || reconciliation.allocation.currency !== "AUD"
      || reconciliation.allocation.amountAudCents !== costEvent.amountAudCents
      || reconciliation.allocation.method !== "provider_billing_evidence"
    ) {
      fail(
        "preventure_research_reconciliation_changed",
        "The reconciled provider cost changed its exact evidence, allocation, or immutable chain binding.",
      );
    }
    const attempt = ledger.executionEvidence.taskAttempts.find(
      (item) => item.id === reconciliation.taskAttemptId,
    );
    const modelCall = ledger.executionEvidence.modelCalls.find(
      (item) => item.id === reconciliation.modelCallId,
    );
    const receipt = ledger.executionEvidence.agentRunReceipts.find(
      (item) => item.id === reconciliation.agentRunReceiptId,
    );
    const attemptMetadata = attempt
      ? parseObject(attempt.metadata, `Task attempt ${attempt.id} metadata`)
      : null;
    const modelMetadata = modelCall
      ? parseObject(modelCall.metadata, `Model call ${modelCall.id} metadata`)
      : null;
    const receiptSnapshot = receipt
      ? parseObject(receipt.receipt, `Agent receipt ${receipt.id}`)
      : null;
    if (
      !attempt
      || !modelCall
      || !receipt
      || attempt.task_id !== assignment.taskId
      || modelCall.task_id !== assignment.taskId
      || receipt.task_id !== assignment.taskId
      || attempt.provider_request_id !== reconciliation.providerRequestId
      || modelCall.provider_request_id !== reconciliation.providerRequestId
      || attemptMetadata.clientRequestId !== reconciliation.clientRequestId
      || modelMetadata.clientRequestId !== reconciliation.clientRequestId
      || modelMetadata.providerResponseId !== reconciliation.providerResponseId
      || receiptSnapshot.attempt?.metadata?.clientRequestId !== reconciliation.clientRequestId
      || receiptSnapshot.provider?.metadata?.clientRequestId !== reconciliation.clientRequestId
      || receiptSnapshot.provider?.providerRequestId !== reconciliation.providerRequestId
      || receiptSnapshot.provider?.providerResponseId !== reconciliation.providerResponseId
      || receiptSnapshot.provider?.metadata?.providerResponseId !== reconciliation.providerResponseId
      || canonicalAgentReceiptHash(receipt.receipt_hash) !== reconciliation.agentRunReceiptHash
    ) {
      fail(
        "preventure_research_reconciliation_changed",
        "The provider bill no longer matches its exact client, header-request, body-response, attempt, model, and receipt trail.",
      );
    }
  }

  function reconcileProviderCost(assignmentHash, input = {}) {
    if (input !== RETIRED_PROVIDER_COST_RECONCILIATION_SENTINEL) {
      fail(
        "preventure_research_owner_billing_observation_required",
        "Provider cost truth now requires the dedicated authenticated owner billing observation.",
      );
    }
    return atomic(() => {
      const assignment = getAssignment(assignmentHash);
      if (!assignment) {
        fail("preventure_research_assignment_missing", "The research assignment is not registered.");
      }
      const ledger = readLedger(assignment.authorityHash);
      if (!ledger.decision) {
        fail(
          "preventure_research_reconciliation_not_sealed",
          "Provider billing reconciliation requires one already sealed diligence decision.",
        );
      }
      const normalized = normalizeProviderCostReconciliation(
        assignment,
        ledger.decision,
        input,
      );
      const chain = ledger.costEvents.filter((item) => (
        item.assignmentHash === assignment.assignmentHash
        && item.costKey === normalized.costKey
      )).sort((left, right) => left.sequence - right.sequence);
      const predecessor = chain.find(
        (item) => item.receiptHash === normalized.expectedPreviousReceiptHash,
      );
      if (
        !predecessor
        || !["estimated", "incurred"].includes(predecessor.eventType)
        || predecessor.receiptHash !== chain[0]?.receiptHash
        || normalized.amountAudCents > predecessor.exposureAudCents
        || Date.parse(normalized.occurredAt) <= Date.parse(predecessor.occurredAt)
        || ![
          "taskAttemptId",
          "modelCallId",
          "agentRunReceiptId",
          "budgetReservationId",
          "costId",
        ].every((key) => normalized[key] === predecessor[key])
      ) {
        fail(
          "preventure_research_reconciliation_conflict",
          "Provider billing does not match one estimated or incurred decision-time predecessor.",
        );
      }
      const reconciliation = Object.freeze({
        schema: PREVENTURE_RESEARCH_PROVIDER_COST_RECONCILIATION_SCHEMA,
        authorityHash: assignment.authorityHash,
        assignmentHash: assignment.assignmentHash,
        assignmentTemplateHash: normalized.assignmentTemplateHash,
        taskId: normalized.taskId,
        decisionHash: ledger.decision.decisionHash,
        costKey: normalized.costKey,
        expectedPreviousReceiptHash: normalized.expectedPreviousReceiptHash,
        taskAttemptId: normalized.taskAttemptId,
        modelCallId: normalized.modelCallId,
        agentRunReceiptId: normalized.agentRunReceiptId,
        agentRunReceiptHash: normalized.agentRunReceiptHash,
        budgetReservationId: normalized.budgetReservationId,
        costId: normalized.costId,
        clientRequestId: normalized.clientRequestId,
        providerRequestId: normalized.providerRequestId,
        providerResponseId: normalized.providerResponseId,
        amountAudCents: normalized.amountAudCents,
        billingEvidenceHash: normalized.billingEvidenceHash,
        allocation: canonical(normalized.allocation),
        reconciledAt: normalized.occurredAt,
      });
      const body = {
        schema: PREVENTURE_RESEARCH_COST_SCHEMA,
        authorityHash: assignment.authorityHash,
        assignmentHash: assignment.assignmentHash,
        costKey: normalized.costKey,
        sequence: predecessor.sequence + 1,
        previousReceiptHash: predecessor.receiptHash,
        eventType: "reconciled",
        amountAudCents: normalized.amountAudCents,
        exposureAudCents: normalized.amountAudCents,
        taskAttemptId: normalized.taskAttemptId,
        modelCallId: normalized.modelCallId,
        budgetReservationId: normalized.budgetReservationId,
        costId: normalized.costId,
        agentRunReceiptId: normalized.agentRunReceiptId,
        occurredAt: normalized.occurredAt,
        reconciliation,
      };
      const costEvent = sealedRecord(body, "receiptHash");
      if (chain.length > 1) {
        const existing = chain.at(-1);
        if (chain.length !== 2 || !sameCanonical(existing, costEvent)) {
          fail(
            "preventure_research_reconciliation_conflict",
            "The provider-cost chain already has a different immutable successor.",
          );
        }
        assertProviderCostReconciliationTrail(
          assignment,
          ledger.decision,
          predecessor,
          existing,
          ledger,
        );
        return {
          created: false,
          costEvent: existing,
          reconciliation: existing.reconciliation,
          decisionHash: ledger.decision.decisionHash,
        };
      }
      assertLinkedExecution(assignment, predecessor, {
        allowTechnicalTerminalReceipt: true,
      });
      return withPreventureProviderCostReconciliationCapability(db, {
        authorityHash: assignment.authorityHash,
        assignmentHash: assignment.assignmentHash,
        decisionHash: ledger.decision.decisionHash,
        costKey: normalized.costKey,
        expectedPreviousReceiptHash: predecessor.receiptHash,
        reconciledReceiptHash: costEvent.receiptHash,
        taskAttemptId: normalized.taskAttemptId,
        modelCallId: normalized.modelCallId,
        agentRunReceiptId: normalized.agentRunReceiptId,
        budgetReservationId: normalized.budgetReservationId,
        costId: normalized.costId,
        amountAudCents: normalized.amountAudCents,
        occurredAt: normalized.occurredAt,
      }, () => {
        insertProjection(
          db,
          "preventure_research_cost_events",
          costProjection(costEvent, timestamp(undefined, "Reconciled cost receipt creation time")),
        );
        const reservationChanged = db.prepare(
          `UPDATE budget_reservations
           SET status = 'reconciled', amount_cents = ?, resolved_at = ?
           WHERE id = ? AND task_id = ? AND venture_id IS NULL
             AND status = ? AND amount_cents = ? AND currency = 'AUD'`,
        ).run(
          normalized.amountAudCents,
          normalized.occurredAt,
          normalized.budgetReservationId,
          assignment.taskId,
          predecessor.eventType === "estimated" ? "incurred_estimate" : "incurred_estimate",
          predecessor.exposureAudCents,
        );
        const costChanged = db.prepare(
          `UPDATE costs
           SET status = 'reconciled', amount_cents = ?, occurred_at = ?
           WHERE id = ? AND task_id = ? AND model_call_id = ? AND venture_id IS NULL
             AND status IN ('estimated', 'incurred', 'incurred_estimate')
             AND amount_cents = ? AND currency = 'AUD'`,
        ).run(
          normalized.amountAudCents,
          normalized.occurredAt,
          normalized.costId,
          assignment.taskId,
          normalized.modelCallId,
          predecessor.amountAudCents,
        );
        const modelChanged = db.prepare(
          `UPDATE model_calls
           SET cost_status = 'reconciled', actual_cost_cents = ?, reconciled_cost_cents = ?
           WHERE id = ? AND task_id = ? AND venture_id IS NULL
             AND cost_status = ? AND provider_request_id = ?`,
        ).run(
          normalized.amountAudCents,
          normalized.amountAudCents,
          normalized.modelCallId,
          assignment.taskId,
          predecessor.eventType,
          normalized.providerRequestId,
        );
        if (
          Number(reservationChanged.changes) !== 1
          || Number(costChanged.changes) !== 1
          || Number(modelChanged.changes) !== 1
        ) {
          fail(
            "preventure_research_reconciliation_conflict",
            "The provider-cost projections changed before exact reconciliation could commit.",
          );
        }
        const finalLedger = readLedger(assignment.authorityHash);
        const finalEvent = finalLedger.costEvents.find(
          (item) => item.receiptHash === costEvent.receiptHash,
        );
        if (!finalEvent) {
          fail(
            "preventure_research_reconciliation_changed",
            "The exact reconciled provider-cost receipt was not retained.",
          );
        }
        assertProviderCostReconciliationTrail(
          assignment,
          finalLedger.decision,
          predecessor,
          finalEvent,
          finalLedger,
        );
        return {
          created: true,
          costEvent: finalEvent,
          reconciliation: finalEvent.reconciliation,
          decisionHash: finalLedger.decision.decisionHash,
        };
      });
    });
  }

  function commitTerminalRetainedRecovery(assignmentHash, input = {}) {
    return atomic(() => {
      const inputKeys = [
        "authorityHash",
        "taskId",
        "taskAttemptId",
        "modelCallId",
        "claimToken",
        "descriptorHash",
        "requestBodyHash",
        "clientRequestId",
        "providerRequestId",
        "providerResponseId",
        "retainedOutputRef",
        "recordedAt",
      ];
      if (!hasExactKeys(input, inputKeys)) {
        fail(
          "preventure_research_terminal_recovery_invalid",
          "Terminal retained-output recovery requires one exact dispatch and artifact reference.",
        );
      }
      if (!retainedOutputStore) {
        fail(
          "preventure_research_terminal_recovery_resolver_required",
          "The immutable retained-output store is required to prove terminal artifact custody.",
        );
      }
      const assignment = getAssignment(assignmentHash);
      if (!assignment) {
        fail("preventure_research_assignment_missing", "The research assignment is not registered.");
      }
      const authority = requireAuthority(assignment.authorityHash);
      const providerId = (value, label, nullable = false) => {
        if (nullable && (value === null || value === undefined)) return null;
        const result = String(value || "");
        if (!/^[A-Za-z0-9._:-]{1,200}$/.test(result)) {
          fail("preventure_research_terminal_recovery_invalid", `${label} is invalid.`);
        }
        return result;
      };
      const normalized = {
        authorityHash: exactHash(input.authorityHash, "Recovery authority hash"),
        taskId: cleanId(input.taskId, "Recovery task ID"),
        taskAttemptId: cleanId(input.taskAttemptId, "Recovery task attempt ID"),
        modelCallId: cleanId(input.modelCallId, "Recovery model call ID"),
        claimToken: cleanText(input.claimToken, "Original recovery claim token"),
        descriptorHash: exactHash(input.descriptorHash, "Recovery descriptor hash"),
        requestBodyHash: exactHash(input.requestBodyHash, "Recovery request-body hash"),
        clientRequestId: providerId(input.clientRequestId, "Recovery client request ID"),
        providerRequestId: providerId(
          input.providerRequestId,
          "Recovery provider header-request ID",
          true,
        ),
        providerResponseId: providerId(
          input.providerResponseId,
          "Recovery provider body-response ID",
          true,
        ),
        retainedOutputRef: String(input.retainedOutputRef || ""),
        recordedAt: timestamp(input.recordedAt, "Terminal recovery time"),
      };
      if (
        normalized.authorityHash !== assignment.authorityHash
        || normalized.taskId !== assignment.taskId
        || !/^preventure-output:[a-f0-9]{64}$/.test(normalized.retainedOutputRef)
      ) {
        fail(
          "preventure_research_terminal_recovery_binding_changed",
          "Terminal recovery escaped its exact immutable authority, assignment, or artifact reference.",
        );
      }

      const loadRetained = (reference = normalized.retainedOutputRef) => {
        let manifest;
        try {
          manifest = retainedOutputStore.load({
            artifactRef: reference,
            authorityHash: assignment.authorityHash,
            assignmentHash: assignment.assignmentHash,
            descriptorHash: normalized.descriptorHash,
          });
        } catch (error) {
          fail(
            "preventure_research_terminal_recovery_artifact_missing",
            `The immutable retained provider artifact cannot be verified: ${String(error?.message || error)}`,
          );
        }
        return manifest;
      };
      const manifest = loadRetained();
      const retainedArtifact = {
        artifactHash: exactHash(manifest.artifactHash, "Retained artifact hash"),
        artifactRef: String(manifest.artifactRef || ""),
        artifactKind: String(manifest.artifactKind || ""),
        retainedAt: exactTimestamp(manifest.retainedAt, "Artifact retention time"),
        providerResponseHash: exactHash(
          manifest.providerResponseHash,
          "Provider response hash",
          true,
        ),
        rawProviderBodyHash: exactHash(manifest.rawProviderBodyHash, "Raw provider body hash"),
        rawProviderBytesHash: exactHash(manifest.rawProviderBytesHash, "Raw provider bytes hash"),
        outputHash: exactHash(manifest.outputHash, "Retained output hash"),
        groundedSourceSetHash: exactHash(
          manifest.groundedSourceSetHash,
          "Grounded source-set hash",
        ),
        billingHash: exactHash(manifest.billingHash, "Retained billing hash"),
        responseMetadataHash: exactHash(
          manifest.responseMetadataHash,
          "Provider response-metadata hash",
        ),
      };
      if (
        retainedArtifact.artifactRef !== normalized.retainedOutputRef
        || manifest.retained !== true
        || manifest.authorityHash !== assignment.authorityHash
        || manifest.assignmentHash !== assignment.assignmentHash
        || manifest.assignmentMaxCostAudCents !== assignment.maxCostAudCents
        || manifest.descriptorHash !== normalized.descriptorHash
        || manifest.requestBodyHash !== normalized.requestBodyHash
        || manifest.clientRequestId !== normalized.clientRequestId
        || manifest.billing?.modelCallId !== normalized.modelCallId
        || (manifest.providerRequestId ?? null) !== normalized.providerRequestId
        || (manifest.providerResponseId ?? null) !== normalized.providerResponseId
        || ![
          "canonical_known_response",
          "known_effect_invalid",
          "known_pre_effect_rejection",
        ].includes(retainedArtifact.artifactKind)
        || Date.parse(retainedArtifact.retainedAt) > Date.parse(normalized.recordedAt)
      ) {
        fail(
          "preventure_research_terminal_recovery_artifact_changed",
          "The retained provider artifact changed its exact dispatch, identity, cap, or retention binding.",
        );
      }

      const existingRow = db.prepare(
        "SELECT * FROM preventure_research_terminal_recoveries WHERE assignment_hash = ?",
      ).get(assignment.assignmentHash);
      if (existingRow) {
        const existing = readTerminalRecoveryRows([existingRow])[0];
        if (
          existing.authorityHash !== normalized.authorityHash
          || existing.taskId !== normalized.taskId
          || existing.originalDispatch.taskAttemptId !== normalized.taskAttemptId
          || existing.originalDispatch.modelCallId !== normalized.modelCallId
          || existing.originalDispatch.originalClaimTokenHash !== sha256(normalized.claimToken)
          || existing.originalDispatch.descriptorHash !== normalized.descriptorHash
          || existing.originalDispatch.requestBodyHash !== normalized.requestBodyHash
          || existing.originalDispatch.clientRequestId !== normalized.clientRequestId
          || existing.originalDispatch.providerRequestId !== normalized.providerRequestId
          || existing.originalDispatch.providerResponseId !== normalized.providerResponseId
          || existing.retainedArtifact.artifactHash !== retainedArtifact.artifactHash
          || existing.retainedArtifact.artifactRef !== retainedArtifact.artifactRef
        ) {
          fail(
            "preventure_research_terminal_recovery_conflict",
            "This assignment already has a different immutable terminal custody record.",
          );
        }
        return {
          created: false,
          recovery: existing,
          terminalState: existing.terminalBinding.eventType === "runtime.emergency_stop_recorded"
            ? "emergency_stopped"
            : existing.terminalBinding.eventType,
        };
      }

      const task = db.prepare("SELECT * FROM tasks WHERE id = ?").get(assignment.taskId);
      const attempt = db.prepare("SELECT * FROM task_attempts WHERE id = ?").get(
        normalized.taskAttemptId,
      );
      const modelCall = db.prepare("SELECT * FROM model_calls WHERE id = ?").get(
        normalized.modelCallId,
      );
      const attemptMetadata = attempt
        ? parseObject(attempt.metadata, `Task attempt ${normalized.taskAttemptId} metadata`)
        : null;
      const modelMetadata = modelCall
        ? parseObject(modelCall.metadata, `Model call ${normalized.modelCallId} metadata`)
        : null;
      const toolInvocation = db.prepare(
        `SELECT * FROM agent_tool_invocations
         WHERE task_id = ? AND attempt_id = ? AND tool_id = 'research_adapter'
         ORDER BY requested_at DESC, id DESC LIMIT 1`,
      ).get(assignment.taskId, normalized.taskAttemptId);
      const toolMetadata = toolInvocation
        ? parseObject(toolInvocation.metadata, `Tool invocation ${toolInvocation.id} metadata`)
        : null;
      const agentRun = toolInvocation?.run_id
        ? db.prepare("SELECT * FROM agent_runs WHERE id = ?").get(toolInvocation.run_id)
        : null;
      const workflow = db.prepare("SELECT * FROM workflows WHERE id = ?").get(
        assignment.workflowId,
      );
      let providerDispatchedAt = null;
      if (attempt?.provider_dispatched_at) {
        try {
          providerDispatchedAt = exactTimestamp(
            attempt.provider_dispatched_at,
            "Provider dispatch time",
          );
        } catch {
          providerDispatchedAt = null;
        }
      }
      if (
        !task
        || !attempt
        || !modelCall
        || !toolInvocation
        || !agentRun
        || !workflow
        || task.id !== normalized.taskId
        || task.workflow_id !== assignment.workflowId
        || task.venture_id !== null
        || attempt.task_id !== assignment.taskId
        || attempt.workflow_id !== assignment.workflowId
        || attempt.venture_id !== null
        || providerDispatchedAt === null
        || attempt.claim_token !== normalized.claimToken
        || attempt.provider_dispatch_model_call_id !== normalized.modelCallId
        || modelCall.task_id !== assignment.taskId
        || modelCall.workflow_id !== assignment.workflowId
        || modelCall.venture_id !== null
        || modelCall.attempt_id !== normalized.taskAttemptId
        || modelCall.provider !== assignment.provider
        || modelCall.selected_model !== assignment.model
        || agentRun.task_id !== assignment.taskId
        || agentRun.workflow_id !== assignment.workflowId
        || agentRun.venture_id !== null
        || agentRun.agent_id !== "demand_validator"
        || workflow.venture_id !== null
        || workflow.type !== "preventure_research"
        || attemptMetadata.descriptorHash !== normalized.descriptorHash
        || attemptMetadata.requestBodyHash !== normalized.requestBodyHash
        || attemptMetadata.clientRequestId !== normalized.clientRequestId
        || modelMetadata.descriptorHash !== normalized.descriptorHash
        || modelMetadata.requestBodyHash !== normalized.requestBodyHash
        || modelMetadata.clientRequestId !== normalized.clientRequestId
        || toolInvocation.workflow_id !== assignment.workflowId
        || toolInvocation.attempt_id !== normalized.taskAttemptId
        || toolMetadata.authorityHash !== assignment.authorityHash
        || toolMetadata.assignmentHash !== assignment.assignmentHash
        || toolMetadata.descriptorHash !== normalized.descriptorHash
        || toolMetadata.requestBodyHash !== normalized.requestBodyHash
        || toolMetadata.clientRequestId !== normalized.clientRequestId
        || Date.parse(providerDispatchedAt) >= Date.parse(authority.expiresAt)
        || Date.parse(providerDispatchedAt) >= Date.parse(retainedArtifact.retainedAt)
        || Date.parse(providerDispatchedAt) >= Date.parse(normalized.recordedAt)
      ) {
        fail(
          "preventure_research_terminal_recovery_dispatch_changed",
          "The retained artifact is not bound to one exact pre-expiry provider dispatch.",
        );
      }

      const taskResult = parseObject(task.result || "{}", `Task ${task.id} result`);
      const emergencyEvent = db.prepare(
        `SELECT * FROM events AS emergency
         WHERE emergency.type = 'runtime.emergency_stop_recorded'
           AND json_valid(emergency.metadata)
           AND julianday(emergency.ts) > julianday(?)
           AND EXISTS (
             SELECT 1 FROM json_each(emergency.metadata, '$.affectedTaskIds') AS affected
             WHERE affected.value = ?
           )
         ORDER BY emergency.ts, emergency.id LIMIT 1`,
      ).get(providerDispatchedAt, assignment.taskId);
      const emergencyStopped = attempt.error_kind === "operator_emergency_stop"
        || modelCall.error_kind === "operator_emergency_stop"
        || attemptMetadata.emergencyStop === true
        || taskResult.emergencyStop === true;
      const terminalCandidates = [];
      if (emergencyStopped) {
        if (
          !emergencyEvent
          || attempt.error_kind !== "operator_emergency_stop"
          || attemptMetadata.emergencyStop !== true
          || attemptMetadata.claimInvalidated !== true
          || taskResult.emergencyStop !== true
          || taskResult.claimInvalidated !== true
          || task.claim_token !== null
          || attemptMetadata.stoppedAt !== emergencyEvent.ts
          || taskResult.stoppedAt !== emergencyEvent.ts
        ) {
          fail(
            "preventure_research_terminal_recovery_emergency_changed",
            "Emergency custody lacks one exact durable claim-loss and stop record.",
          );
        }
        terminalCandidates.push({
          kind: "runtime_emergency_stop",
          eventId: String(emergencyEvent.id),
          eventHash: emergencyStopEventHash(emergencyEvent),
          eventType: "runtime.emergency_stop_recorded",
          terminalAt: exactTimestamp(emergencyEvent.ts, "Emergency stop time"),
          eventOccurredAt: exactTimestamp(emergencyEvent.ts, "Emergency event time"),
        });
      }
      let lifecycle = loadLifecycleRows(db, authority);
      let latest = lifecycle.at(-1) || null;
      if (
        latest?.eventType === "activated"
        && Date.parse(normalized.recordedAt) >= Date.parse(authority.expiresAt)
      ) {
        latest = appendLifecycleInternal(authority, {
          id: `preventure_expired_${authority.authorityHash.slice(7, 31)}`,
          eventType: "expired",
          occurredAt: normalized.recordedAt,
          actor: "pantheon",
          reason: "The fixed research deadline passed after an exact pre-expiry provider dispatch; retained output is custody-only.",
          metadata: {
            expectedPreviousEventHash: latest.eventHash,
            effectiveExpiredAt: authority.expiresAt,
            terminalRetainedRecovery: true,
            dispatchDisabled: true,
            buildAuthorized: false,
            commercialTestAuthorized: false,
            externalActionAuthorized: false,
          },
        }, false).event;
        lifecycle = [...lifecycle, latest];
      }
      if (latest && ["revoked", "expired"].includes(latest.eventType)) {
        terminalCandidates.push({
          kind: "lifecycle",
          eventId: latest.id,
          eventHash: latest.eventHash,
          eventType: latest.eventType,
          terminalAt: latest.eventType === "expired" ? authority.expiresAt : latest.occurredAt,
          eventOccurredAt: latest.occurredAt,
        });
      }
      if (terminalCandidates.length === 0) {
        fail(
          "preventure_research_terminal_recovery_not_terminal",
          "Retained-output custody requires exact revoked, expired, or emergency-stop truth.",
        );
      }
      const terminalRank = new Map([
        ["expired", 0],
        ["revoked", 1],
        ["runtime.emergency_stop_recorded", 2],
      ]);
      terminalCandidates.sort((left, right) => (
        Date.parse(left.terminalAt) - Date.parse(right.terminalAt)
        || terminalRank.get(left.eventType) - terminalRank.get(right.eventType)
        || left.eventId.localeCompare(right.eventId)
      ));
      const terminalBinding = terminalCandidates[0];
      const terminalState = terminalBinding.eventType === "runtime.emergency_stop_recorded"
        ? "emergency_stopped"
        : terminalBinding.eventType;
      if (
        Date.parse(providerDispatchedAt) >= Date.parse(terminalBinding.terminalAt)
        || Date.parse(terminalBinding.terminalAt) > Date.parse(normalized.recordedAt)
      ) {
        fail(
          "preventure_research_terminal_recovery_time_changed",
          "The terminal event does not follow the exact pre-expiry provider dispatch.",
        );
      }

      const activeDispatchProfile = (
        task.status === "running"
        && task.outcome_status === "provider_dispatched"
        && task.claim_token === normalized.claimToken
        && task.claimed_at !== null
        && task.completed_at === null
        && attempt.status === "running"
        && attempt.outcome_status === "provider_dispatched"
        && attempt.claim_token === normalized.claimToken
        && attempt.error_kind === null
        && attempt.completed_at === null
        && modelCall.status === "dispatching"
        && modelCall.outcome_status === "provider_dispatched"
        && modelCall.error_kind === null
        && modelCall.completed_at === null
        && agentRun.status === "running"
        && agentRun.completed_at === null
        && toolInvocation.status === "running"
        && toolInvocation.resolved_at === null
        && workflow.status === "blocked"
        && workflow.approval_required === 0
      );
      const emergencyUnknownProfile = (
        emergencyStopped
        && task.status === "needs_attention"
        && task.outcome_status === "unknown"
        && task.claim_token === null
        && task.claimed_at === null
        && task.completed_at === emergencyEvent?.ts
        && taskResult.emergencyOutcome === "unknown"
        && attempt.status === "needs_attention"
        && attempt.outcome_status === "unknown"
        && attempt.error_kind === "operator_emergency_stop"
        && attempt.completed_at === emergencyEvent?.ts
        && modelCall.status === "needs_attention"
        && modelCall.outcome_status === "unknown"
        && modelCall.error_kind === "operator_emergency_stop"
        && modelCall.completed_at === emergencyEvent?.ts
        && agentRun.status === "running"
        && agentRun.completed_at === null
        && toolInvocation.status === "running"
        && toolInvocation.resolved_at === null
        && workflow.status === "needs_attention"
        && workflow.approval_required === 1
      );
      const emergencyKnownProfile = (
        emergencyStopped
        && task.status === "needs_attention"
        && task.outcome_status === "known_provider_result_needs_review"
        && task.claim_token === null
        && task.claimed_at === null
        && task.completed_at === emergencyEvent?.ts
        && taskResult.emergencyOutcome === "known_provider_result_needs_review"
        && attempt.status === "needs_attention"
        && attempt.outcome_status === "known_provider_result_needs_review"
        && attempt.error_kind === "operator_emergency_stop"
        && attempt.completed_at === emergencyEvent?.ts
        && modelCall.status === "completed"
        && modelCall.outcome_status === "known"
        && modelCall.completed_at === retainedArtifact.retainedAt
        && modelMetadata.retainedArtifactHash === retainedArtifact.artifactHash
        && agentRun.status === "running"
        && agentRun.completed_at === null
        && toolInvocation.status === "running"
        && toolInvocation.resolved_at === null
        && workflow.status === "needs_attention"
        && workflow.approval_required === 1
      );
      const retainedKnownProfile = (
        task.status === "needs_attention"
        && task.outcome_status === "known_provider_result_needs_review"
        && task.claim_token === null
        && task.claimed_at === null
        && taskResult.schema === "pantheon.preventure-research-task-result.v1"
        && taskResult.authorityHash === assignment.authorityHash
        && taskResult.assignmentHash === assignment.assignmentHash
        && taskResult.descriptorHash === normalized.descriptorHash
        && taskResult.retainedOutputRef === retainedArtifact.artifactRef
        && taskResult.retainedOutputHash === retainedArtifact.artifactHash
        && taskResult.retryAuthorized === false
        && attempt.status === "needs_attention"
        && attempt.outcome_status === "known_provider_result_needs_review"
        && attempt.error_kind === "known_provider_result_needs_review"
        && attemptMetadata.retainedOutputRef === retainedArtifact.artifactRef
        && attemptMetadata.retainedOutputHash === retainedArtifact.artifactHash
        && modelCall.status === "needs_attention"
        && modelCall.outcome_status === "known"
        && modelCall.error_kind === "known_provider_result_needs_review"
        && modelMetadata.retainedOutputRef === retainedArtifact.artifactRef
        && modelMetadata.retainedOutputHash === retainedArtifact.artifactHash
        && agentRun.status === "failed"
        && agentRun.completed_at !== null
        && toolInvocation.status === "needs_review"
        && toolInvocation.decision === "provider_activity_retained"
        && toolInvocation.resolved_at !== null
        && workflow.status === "needs_attention"
      );
      const executionPrestateProfile = activeDispatchProfile
        ? "provider_dispatched_active_claim"
        : emergencyUnknownProfile
          ? "emergency_stopped_unknown"
          : emergencyKnownProfile
            ? "emergency_stopped_known_retained"
            : retainedKnownProfile
              ? "known_retained_needs_reprocess"
              : null;
      if (!executionPrestateProfile) {
        fail(
          "preventure_research_terminal_recovery_execution_changed",
          "Terminal custody refuses an execution state outside its exact retained-output profiles.",
        );
      }

      const receipts = db.prepare(
        `SELECT * FROM agent_run_receipts WHERE attempt_id = ?
         ORDER BY sequence DESC, created_at DESC, id DESC`,
      ).all(normalized.taskAttemptId);
      const receiptRow = receipts[0] || null;

      const priorCostEvents = readCostRows(db.prepare(
        `SELECT * FROM preventure_research_cost_events
         WHERE assignment_hash = ? ORDER BY cost_key, sequence`,
      ).all(assignment.assignmentHash));
      const priorHeads = latestCostHeads(priorCostEvents);
      if (priorHeads.length !== 1) {
        fail(
          "preventure_research_terminal_recovery_cost_missing",
          "Terminal custody requires one exact existing assignment cost chain.",
        );
      }
      const priorCost = priorHeads[0];
      if (
        !["reserved", "estimated", "incurred", "unknown"].includes(priorCost.eventType)
        || !priorCost.taskAttemptId
        || priorCost.taskAttemptId !== normalized.taskAttemptId
        || !priorCost.budgetReservationId
        || !priorCost.costId
        || priorCost.exposureAudCents > assignment.maxCostAudCents
        || Date.parse(priorCost.occurredAt) > Date.parse(normalized.recordedAt)
      ) {
        fail(
          "preventure_research_terminal_recovery_cost_changed",
          "The existing cost head cannot be conservatively sealed for terminal custody.",
        );
      }
      const reservation = db.prepare(
        "SELECT * FROM budget_reservations WHERE id = ?",
      ).get(priorCost.budgetReservationId);
      const genericCost = db.prepare("SELECT * FROM costs WHERE id = ?").get(priorCost.costId);
      if (
        !reservation
        || reservation.task_id !== assignment.taskId
        || reservation.workflow_id !== assignment.workflowId
        || reservation.venture_id !== null
        || reservation.currency !== "AUD"
        || !genericCost
        || genericCost.task_id !== assignment.taskId
        || genericCost.workflow_id !== assignment.workflowId
        || genericCost.venture_id !== null
        || genericCost.currency !== "AUD"
      ) {
        fail(
          "preventure_research_terminal_recovery_cost_changed",
          "The generic reservation or cost escaped its exact pre-venture assignment.",
        );
      }
      const reservationMetadata = parseObject(
        reservation.metadata,
        `Reservation ${reservation.id} metadata`,
      );
      const genericCostMetadata = parseObject(
        genericCost.metadata,
        `Cost ${genericCost.id} metadata`,
      );
      const exactBaseMetadata = (metadata) => (
        metadata.authorityHash === assignment.authorityHash
        && metadata.assignmentHash === assignment.assignmentHash
        && metadata.costKey === priorCost.costKey
      );
      const exactModelMetadata = modelMetadata.authorityHash === assignment.authorityHash
        && modelMetadata.assignmentHash === assignment.assignmentHash;
      const expectedGenericAmount = priorCost.amountAudCents ?? priorCost.exposureAudCents;
      const expectedModelActual = priorCost.eventType === "incurred"
        ? priorCost.amountAudCents
        : 0;
      const expectedModelEstimate = ["estimated", "incurred"].includes(priorCost.eventType)
        ? priorCost.amountAudCents
        : 0;
      const normalReservationStatuses = {
        reserved: new Set(["reserved"]),
        estimated: new Set(["incurred_estimate", "estimated"]),
        incurred: new Set(["incurred", "incurred_estimate"]),
        unknown: new Set(["unknown"]),
      };
      const normalCostStatuses = {
        reserved: new Set(["reserved"]),
        estimated: new Set(["estimated", "incurred_estimate"]),
        incurred: new Set(["incurred", "incurred_estimate"]),
        unknown: new Set(["unknown"]),
      };
      const emergencyProjectionPending = emergencyStopped
        && reservation.status === "unknown"
        && Number(reservation.amount_cents) === assignment.maxCostAudCents
        && reservationMetadata.emergencyStop === true
        && reservationMetadata.stoppedAt === emergencyEvent?.ts
        && reservationMetadata.providerOutcomeUnknown === true
        && modelCall.cost_status === "unknown"
        && Number(modelCall.reserved_cost_cents) === assignment.maxCostAudCents
        && Number(modelCall.actual_cost_cents) === 0
        && Number(modelCall.reconciled_cost_cents) === 0
        && modelMetadata.emergencyStop === true
        && modelMetadata.stoppedAt === emergencyEvent?.ts
        && modelMetadata.providerOutcomeUnknown === true;
      const emergencyProjectionClaimed = emergencyStopped
        && (reservation.status === "unknown" || modelCall.cost_status === "unknown");
      if (
        !exactBaseMetadata(reservationMetadata)
        || !exactBaseMetadata(genericCostMetadata)
        || reservationMetadata.exposureAudCents !== assignment.maxCostAudCents
        || genericCostMetadata.exposureAudCents !== assignment.maxCostAudCents
        || !exactModelMetadata
        || !normalCostStatuses[priorCost.eventType]?.has(genericCost.status)
        || Number(genericCost.amount_cents) !== expectedGenericAmount
        || (genericCost.model_call_id !== null
          && genericCost.model_call_id !== normalized.modelCallId)
        || genericCost.run_id !== agentRun.id
        || priorCost.modelCallId !== null && priorCost.modelCallId !== normalized.modelCallId
        || priorCost.agentRunReceiptId !== null
          && priorCost.agentRunReceiptId !== receiptRow?.id
        || Number(modelCall.incurred_estimate_cents) !== expectedModelEstimate
        || Number(modelCall.actual_cost_cents) !== expectedModelActual
        || Number(modelCall.reconciled_cost_cents) !== 0
        || (emergencyProjectionClaimed && !emergencyProjectionPending)
        || (!emergencyProjectionPending && (
          !normalReservationStatuses[priorCost.eventType]?.has(reservation.status)
          || Number(reservation.amount_cents) !== priorCost.exposureAudCents
          || modelCall.cost_status !== priorCost.eventType
          || Number(modelCall.reserved_cost_cents) !== priorCost.exposureAudCents
          || (priorCost.eventType === "reserved" && reservation.resolved_at !== null)
        ))
      ) {
        fail(
          "preventure_research_terminal_recovery_cost_changed",
          "Terminal custody refuses drifted accounting projections or cost identity.",
        );
      }
      if (
        db.prepare(
          "SELECT decision_hash FROM preventure_research_decisions WHERE authority_hash = ?",
        ).get(assignment.authorityHash)
        || db.prepare(
          "SELECT early_stop_record_hash FROM preventure_research_terminal_stops WHERE authority_hash = ?",
        ).get(assignment.authorityHash)
        || db.prepare(
          "SELECT snapshot_hash FROM preventure_research_source_snapshots WHERE assignment_hash = ? LIMIT 1",
        ).get(assignment.assignmentHash)
        || db.prepare(
          "SELECT evidence_hash FROM preventure_research_evidence_records WHERE assignment_hash = ? LIMIT 1",
        ).get(assignment.assignmentHash)
      ) {
        fail(
          "preventure_research_terminal_recovery_commercial_truth_exists",
          "Custody-only recovery cannot follow evidence, an early stop, or a diligence decision.",
        );
      }

      const originalDispatch = {
        taskAttemptId: normalized.taskAttemptId,
        modelCallId: normalized.modelCallId,
        originalClaimTokenHash: sha256(normalized.claimToken),
        descriptorHash: normalized.descriptorHash,
        requestBodyHash: normalized.requestBodyHash,
        clientRequestId: normalized.clientRequestId,
        providerRequestId: normalized.providerRequestId,
        providerResponseId: normalized.providerResponseId,
        providerDispatchedAt,
      };
      const custodyOutcomeStatus = retainedArtifact.artifactKind === "canonical_known_response"
        ? "known"
        : retainedArtifact.artifactKind;
      const custodyErrorKind = terminalBinding.kind === "runtime_emergency_stop"
        ? "operator_emergency_stop"
        : "terminal_retained_output_custody";
      const orderedAssignments = readAssignmentRows(assignment.authorityHash);
      const currentAssignmentPosition = orderedAssignments.findIndex(
        (candidate) => candidate.assignmentHash === assignment.assignmentHash,
      );
      const preservedPrefixAssignments = orderedAssignments
        .slice(0, currentAssignmentPosition)
        .map((prefixAssignment) => terminalRecoveryPrefixRecord(db, prefixAssignment));
      if (preservedPrefixAssignments.some((prefix) => (
        prefix.taskStatus !== "completed"
        || prefix.taskOutcomeStatus !== "known"
        || prefix.taskAttemptIds.length === 0
        || prefix.modelCallIds.length === 0
        || prefix.executionReceipts.length === 0
      ))) {
        fail(
          "preventure_research_terminal_recovery_prefix_changed",
          "Terminal custody requires an exact immutable completed authority-order prefix.",
        );
      }
      const siblingClosures = [];
      for (const sibling of orderedAssignments.slice(currentAssignmentPosition + 1)) {
        const siblingTask = db.prepare("SELECT * FROM tasks WHERE id = ?").get(sibling.taskId);
        const activityCount = Number(db.prepare(
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
        ).count);
        if (
          !siblingTask
          || siblingTask.status !== "blocked"
          || siblingTask.outcome_status !== "not_started"
          || Number(siblingTask.attempt_count) !== 0
          || siblingTask.claim_token !== null
          || siblingTask.claimed_at !== null
          || activityCount !== 0
        ) {
          fail(
            "preventure_research_terminal_recovery_sibling_changed",
            "Terminal custody can only cancel the exact untouched authority-order suffix.",
          );
        }
        siblingClosures.push({
          assignmentId: sibling.id,
          assignmentHash: sibling.assignmentHash,
          taskId: sibling.taskId,
          priorStatus: "blocked",
          priorOutcomeStatus: "not_started",
          resultingStatus: "cancelled",
          resultingOutcomeStatus: "cancelled_by_terminal_authority_custody",
          zeroActivityCount: 0,
        });
      }
      const executionClosure = sealedRecord({
        schema: "pantheon.preventure-research-terminal-execution-closure.v1",
        authorityHash: assignment.authorityHash,
        assignmentHash: assignment.assignmentHash,
        taskId: assignment.taskId,
        workflowId: assignment.workflowId,
        taskAttemptId: normalized.taskAttemptId,
        modelCallId: normalized.modelCallId,
        agentRunId: agentRun.id,
        toolInvocationId: toolInvocation.id,
        terminalEventHash: terminalBinding.eventHash,
        artifactHash: retainedArtifact.artifactHash,
        outcomeStatus: custodyOutcomeStatus,
        errorKind: custodyErrorKind,
        resultingStatus: "needs_attention",
        prestateProfile: executionPrestateProfile,
        preservedPrefixAssignments,
        siblingClosures,
        executionChildren: terminalRecoveryExecutionChildrenRecord(db, assignment),
        claimCleared: true,
        retryAuthorized: false,
        evidenceEligible: false,
        closedAt: normalized.recordedAt,
      }, "closureHash");
      const closureMetadata = (value, label) => canonicalJson({
        ...parseObject(value || "{}", label),
        terminalRetainedExecution: executionClosure,
      });
      const primaryTaskChanged = db.prepare(
        `UPDATE tasks
         SET status = 'needs_attention', outcome_status = ?, claim_token = NULL,
             claimed_at = NULL, completed_at = ?,
             updated_at = ?, max_retries = 0, error = COALESCE(error, ?),
             result = json_patch(CASE WHEN json_valid(result) THEN result ELSE '{}' END, ?)
         WHERE id = ? AND workflow_id = ? AND venture_id IS NULL`,
      ).run(
        custodyOutcomeStatus,
        normalized.recordedAt,
        normalized.recordedAt,
        "Provider output retained for terminal custody only; no commercial evidence was created.",
        canonicalJson({ terminalRetainedExecution: executionClosure }),
        assignment.taskId,
        assignment.workflowId,
      );
      const primaryAttemptChanged = db.prepare(
        `UPDATE task_attempts
         SET status = 'needs_attention', outcome_status = ?, provider_request_id = ?,
             error_kind = ?, error = COALESCE(error, ?),
             completed_at = ?, metadata = ?
         WHERE id = ? AND task_id = ? AND workflow_id = ? AND venture_id IS NULL`,
      ).run(
        custodyOutcomeStatus,
        normalized.providerRequestId,
        custodyErrorKind,
        "Provider output retained for terminal custody only.",
        normalized.recordedAt,
        closureMetadata(attempt.metadata, `Task attempt ${attempt.id} metadata`),
        normalized.taskAttemptId,
        assignment.taskId,
        assignment.workflowId,
      );
      const primaryModelChanged = db.prepare(
        `UPDATE model_calls
         SET status = 'needs_attention', outcome_status = ?, provider_request_id = ?,
             error_kind = ?, error = COALESCE(error, ?),
             completed_at = ?
         WHERE id = ? AND task_id = ? AND workflow_id = ? AND venture_id IS NULL`,
      ).run(
        custodyOutcomeStatus,
        normalized.providerRequestId,
        custodyErrorKind,
        "Provider output retained for terminal custody only.",
        normalized.recordedAt,
        normalized.modelCallId,
        assignment.taskId,
        assignment.workflowId,
      );
      const primaryAgentRunChanged = db.prepare(
        `UPDATE agent_runs
         SET status = 'needs_attention', model_call_id = ?,
             output_summary = 'Provider output retained for custody only; no commercial evidence created.',
             completed_at = ?, metadata = ?
         WHERE id = ? AND task_id = ? AND workflow_id = ? AND venture_id IS NULL`,
      ).run(
        normalized.modelCallId,
        normalized.recordedAt,
        closureMetadata(agentRun.metadata, `Agent run ${agentRun.id} metadata`),
        agentRun.id,
        assignment.taskId,
        assignment.workflowId,
      );
      const primaryToolChanged = db.prepare(
        `UPDATE agent_tool_invocations
         SET status = 'needs_attention', decision = 'terminal_custody_only',
             output_summary = 'Provider output retained for custody only; no commercial evidence created.',
             resolved_at = ?, metadata = ?
         WHERE id = ? AND task_id = ? AND workflow_id = ? AND attempt_id = ?`,
      ).run(
        normalized.recordedAt,
        closureMetadata(toolInvocation.metadata, `Tool invocation ${toolInvocation.id} metadata`),
        toolInvocation.id,
        assignment.taskId,
        assignment.workflowId,
        normalized.taskAttemptId,
      );
      const primaryWorkflowChanged = db.prepare(
        `UPDATE workflows
         SET status = 'needs_attention',
             current_step = 'Terminal provider output is held for custody and billing review only',
             approval_required = 1, updated_at = ?, metadata = ?
         WHERE id = ? AND venture_id IS NULL AND type = 'preventure_research'`,
      ).run(
        normalized.recordedAt,
        closureMetadata(workflow.metadata, `Workflow ${workflow.id} metadata`),
        assignment.workflowId,
      );
      for (const sibling of siblingClosures) {
        const changed = db.prepare(
          `UPDATE tasks
           SET status = 'cancelled', outcome_status = 'cancelled_by_terminal_authority_custody',
               completed_at = ?, updated_at = ?, max_retries = 0,
               result = json_patch(CASE WHEN json_valid(result) THEN result ELSE '{}' END, ?)
           WHERE id = ? AND status = 'blocked' AND outcome_status = 'not_started'
             AND attempt_count = 0 AND claim_token IS NULL AND claimed_at IS NULL`,
        ).run(
          normalized.recordedAt,
          normalized.recordedAt,
          canonicalJson({ terminalRetainedExecution: executionClosure }),
          sibling.taskId,
        );
        if (Number(changed.changes) !== 1) {
          fail(
            "preventure_research_terminal_recovery_sibling_changed",
            "An untouched sibling assignment changed before terminal cancellation.",
          );
        }
      }
      if ([
        primaryTaskChanged,
        primaryAttemptChanged,
        primaryModelChanged,
        primaryAgentRunChanged,
        primaryToolChanged,
        primaryWorkflowChanged,
      ].some((change) => Number(change.changes) !== 1)) {
        fail(
          "preventure_research_terminal_recovery_conflict",
          "The exact in-flight execution changed before terminal closure.",
        );
      }
      const {
        insertPreparedAgentExecutionReceipt,
        prepareAgentExecutionReceipt,
      } = require("./agent-execution-evidence");
      const preparedReceipt = prepareAgentExecutionReceipt(db, {
        attemptId: normalized.taskAttemptId,
        runId: agentRun.id,
        createdAt: normalized.recordedAt,
      });
      if (!preparedReceipt.created) {
        fail(
          "preventure_research_terminal_recovery_receipt_conflict",
          "Terminal execution closure did not produce one new canonical custody receipt.",
        );
      }
      const preparedRow = preparedReceipt.row;
      const finalizedReceipt = withPreventureTerminalReceiptCapability(db, {
        authorityHash: assignment.authorityHash,
        assignmentHash: assignment.assignmentHash,
        taskId: assignment.taskId,
        taskAttemptId: normalized.taskAttemptId,
        agentRunId: agentRun.id,
        closureHash: executionClosure.closureHash,
        receiptId: preparedRow.id,
        expectedSequence: preparedRow.sequence,
        status: preparedRow.status,
        outcomeStatus: preparedRow.outcome_status,
        snapshotHash: preparedRow.snapshot_hash,
        previousReceiptHash: preparedRow.previous_hash,
        receiptHash: preparedRow.receipt_hash,
        missingFieldsJson: canonicalJson(preparedRow.missing_fields),
        warningsJson: canonicalJson(preparedRow.warnings),
        receiptJson: canonicalJson(preparedRow.receipt),
        createdAt: preparedRow.created_at,
      }, () => insertPreparedAgentExecutionReceipt(db, preparedReceipt));
      const terminalReceiptRow = db.prepare(
        "SELECT * FROM agent_run_receipts WHERE id = ?",
      ).get(finalizedReceipt.id);
      if (!terminalReceiptRow || terminalReceiptRow.id === receiptRow?.id) {
        fail(
          "preventure_research_terminal_recovery_receipt_missing",
          "Terminal execution closure requires one new final custody receipt.",
        );
      }
      const executionReceipt = {
        id: terminalReceiptRow.id,
        hash: canonicalAgentReceiptHash(terminalReceiptRow.receipt_hash),
        status: String(terminalReceiptRow.status),
        outcomeStatus: String(terminalReceiptRow.outcome_status),
      };
      const recoveryIntentBody = {
        schema: "pantheon.preventure-research-terminal-recovery-intent.v1",
        authorityHash: assignment.authorityHash,
        assignmentHash: assignment.assignmentHash,
        assignmentTemplateHash: assignment.templateHash,
        assignmentCapAudCents: assignment.maxCostAudCents,
        taskId: assignment.taskId,
        workflowId: assignment.workflowId,
        terminalBinding,
        originalDispatch,
        retainedArtifact,
        executionReceipt,
        executionClosure,
        priorCostReceiptHash: priorCost.receiptHash,
        costKey: priorCost.costKey,
        budgetReservationId: priorCost.budgetReservationId,
        costId: priorCost.costId,
        recordedAt: normalized.recordedAt,
      };
      const recoveryIntentHash = sha256(recoveryIntentBody);
      const terminalTransition = {
        schema: PREVENTURE_RESEARCH_TERMINAL_COST_TRANSITION_SCHEMA,
        recoveryIntentHash,
        terminalKind: terminalBinding.kind,
        terminalRecordId: terminalBinding.eventId,
        terminalEventHash: terminalBinding.eventHash,
        artifactHash: retainedArtifact.artifactHash,
        recordedAt: normalized.recordedAt,
      };
      const terminalCost = sealedRecord({
        schema: PREVENTURE_RESEARCH_COST_SCHEMA,
        authorityHash: assignment.authorityHash,
        assignmentHash: assignment.assignmentHash,
        costKey: priorCost.costKey,
        sequence: priorCost.sequence + 1,
        previousReceiptHash: priorCost.receiptHash,
        eventType: "unknown",
        amountAudCents: null,
        exposureAudCents: assignment.maxCostAudCents,
        taskAttemptId: normalized.taskAttemptId,
        modelCallId: normalized.modelCallId,
        budgetReservationId: priorCost.budgetReservationId,
        costId: priorCost.costId,
        agentRunReceiptId: executionReceipt.id,
        terminalRecovery: terminalTransition,
        occurredAt: normalized.recordedAt,
      }, "receiptHash");
      const projectionTransition = {
        ...terminalTransition,
        terminalCostReceiptHash: terminalCost.receiptHash,
        priorCostReceiptHash: priorCost.receiptHash,
        modelCallId: normalized.modelCallId,
      };
      const costSnapshot = {
        costKey: priorCost.costKey,
        priorReceiptHash: priorCost.receiptHash,
        terminalReceiptHash: terminalCost.receiptHash,
        priorEventType: priorCost.eventType,
        priorAmountAudCents: priorCost.amountAudCents,
        priorExposureAudCents: priorCost.exposureAudCents,
        budgetReservationId: priorCost.budgetReservationId,
        budgetReservationStatus: "unknown",
        budgetReservationAmountAudCents: assignment.maxCostAudCents,
        costId: priorCost.costId,
        genericCostStatus: "unknown",
        genericCostAmountAudCents: assignment.maxCostAudCents,
        costTruth: "unknown",
        knownCostAudCents: null,
        exposureAudCents: assignment.maxCostAudCents,
        exactBillingPending: true,
      };
      const controls = {
        commercialInference: "none",
        evidenceEligible: false,
        decisionEligible: false,
        completionEligible: false,
        retryAuthorized: false,
        executionSealed: true,
        additionalNetworkCalls: 0,
        additionalAiCostAudCents: 0,
      };
      const recovery = sealedRecord({
        schema: PREVENTURE_RESEARCH_TERMINAL_RECOVERY_SCHEMA,
        recoveryIntentHash,
        authorityHash: assignment.authorityHash,
        assignmentHash: assignment.assignmentHash,
        assignmentTemplateHash: assignment.templateHash,
        assignmentCapAudCents: assignment.maxCostAudCents,
        taskId: assignment.taskId,
        workflowId: assignment.workflowId,
        terminalBinding,
        originalDispatch,
        retainedArtifact,
        executionReceipt,
        executionClosure,
        costSnapshot,
        controls,
        recordedAt: normalized.recordedAt,
      }, "recoveryHash");
      const transitionMetadata = (value, label) => canonicalJson({
        ...parseObject(value || "{}", label),
        terminalRecovery: projectionTransition,
        terminalRetainedExecution: executionClosure,
      });
      const recoveryJson = canonicalJson(recovery);
      return withPreventureTerminalRetainedRecoveryCapability(db, {
        authorityHash: assignment.authorityHash,
        assignmentHash: assignment.assignmentHash,
        recoveryIntentHash,
        recoveryHash: recovery.recoveryHash,
        taskAttemptId: normalized.taskAttemptId,
        modelCallId: normalized.modelCallId,
        terminalKind: terminalBinding.kind,
        terminalRecordId: terminalBinding.eventId,
        terminalEventHash: terminalBinding.eventHash,
        artifactHash: retainedArtifact.artifactHash,
        priorCostReceiptHash: priorCost.receiptHash,
        terminalCostReceiptHash: terminalCost.receiptHash,
        budgetReservationId: priorCost.budgetReservationId,
        costId: priorCost.costId,
        assignmentCapAudCents: assignment.maxCostAudCents,
        appendUnknownCost: true,
        recoveryJson,
        recordedAt: normalized.recordedAt,
      }, () => {
        const costChanged = db.prepare(
          `UPDATE costs
           SET model_call_id = ?, status = 'unknown', amount_cents = ?, metadata = ?
           WHERE id = ? AND task_id = ? AND workflow_id = ? AND venture_id IS NULL
             AND (model_call_id IS NULL OR model_call_id = ?)` ,
        ).run(
          normalized.modelCallId,
          assignment.maxCostAudCents,
          transitionMetadata(genericCost.metadata, `Cost ${genericCost.id} metadata`),
          priorCost.costId,
          assignment.taskId,
          assignment.workflowId,
          normalized.modelCallId,
        );
        insertProjection(
          db,
          "preventure_research_cost_events",
          costProjection(terminalCost, normalized.recordedAt),
        );
        const reservationChanged = db.prepare(
          `UPDATE budget_reservations
           SET status = 'unknown', amount_cents = ?, resolved_at = NULL, metadata = ?
           WHERE id = ? AND task_id = ? AND workflow_id = ? AND venture_id IS NULL`,
        ).run(
          assignment.maxCostAudCents,
          transitionMetadata(reservation.metadata, `Reservation ${reservation.id} metadata`),
          priorCost.budgetReservationId,
          assignment.taskId,
          assignment.workflowId,
        );
        const modelChanged = db.prepare(
          `UPDATE model_calls
           SET status = 'needs_attention', outcome_status = ?,
               provider_request_id = ?, error_kind = ?,
               error = COALESCE(error, 'Provider output retained for terminal custody only.'),
               completed_at = ?,
               cost_status = 'unknown', reserved_cost_cents = ?,
               actual_cost_cents = 0, reconciled_cost_cents = 0, metadata = ?
           WHERE id = ? AND task_id = ? AND workflow_id = ? AND venture_id IS NULL`,
        ).run(
          custodyOutcomeStatus,
          normalized.providerRequestId,
          custodyErrorKind,
          normalized.recordedAt,
          assignment.maxCostAudCents,
          transitionMetadata(modelCall.metadata, `Model call ${modelCall.id} metadata`),
          normalized.modelCallId,
          assignment.taskId,
          assignment.workflowId,
        );
        if (
          Number(reservationChanged.changes) !== 1
          || Number(costChanged.changes) !== 1
          || Number(modelChanged.changes) !== 1
        ) {
          fail(
            "preventure_research_terminal_recovery_conflict",
            "Terminal cost projections changed before exact custody could commit.",
          );
        }
        insertProjection(
          db,
          "preventure_research_terminal_recoveries",
          terminalRecoveryProjection(recovery, normalized.recordedAt),
        );
        const replayManifest = loadRetained(retainedArtifact.artifactRef);
        if (
          replayManifest.artifactHash !== retainedArtifact.artifactHash
          || replayManifest.artifactRef !== retainedArtifact.artifactRef
          || replayManifest.rawProviderBodyHash !== retainedArtifact.rawProviderBodyHash
          || replayManifest.rawProviderBytesHash !== retainedArtifact.rawProviderBytesHash
          || replayManifest.outputHash !== retainedArtifact.outputHash
        ) {
          fail(
            "preventure_research_terminal_recovery_artifact_changed",
            "The immutable provider artifact changed during custody commit.",
          );
        }
        const persisted = readTerminalRecoveryRows([db.prepare(
          "SELECT * FROM preventure_research_terminal_recoveries WHERE recovery_hash = ?",
        ).get(recovery.recoveryHash)])[0];
        return { created: true, recovery: persisted, terminalState };
      });
    });
  }

  function recordSourceSnapshot(assignmentHash, input = {}) {
    return atomic(() => {
      const assignment = getAssignment(assignmentHash);
      if (!assignment) fail("preventure_research_assignment_missing", "The research assignment is not registered.");
      assertEvidenceLedgerUnsealed(assignment.authorityHash);
      if (!activeResearchWrite(assignment.authorityHash)) {
        fail(
          "preventure_research_ledger_not_active",
          "New source capture requires active unexpired research authority.",
        );
      }
      const authority = requireAuthority(assignment.authorityHash);
      const sourceClass = cleanId(input.sourceClass, "Source class");
      if (!authority.sourcePolicy.classes.includes(sourceClass)) {
        fail("preventure_research_source_invalid", "The source class is outside the approved public-source policy.");
      }
      const assignmentTemplate = authority.assignments.find((item) => item.id === assignment.id);
      if (!assignmentTemplate?.requiredSourceClasses.includes(sourceClass)) {
        fail(
          "preventure_research_source_invalid",
          "The source class is outside this exact immutable assignment.",
        );
      }
      const sourceTier = exactInteger(input.sourceTier, "Source tier", 1);
      if (sourceTier > 4) fail("preventure_research_source_invalid", "Source tier must be between one and four.");
      const captureStatus = cleanId(input.captureStatus, "Source capture status");
      if (!SOURCE_CAPTURE_STATUSES.has(captureStatus)) {
        fail("preventure_research_source_invalid", "Source capture status is unsupported.");
      }
      if (captureStatus === "captured") {
        fail(
          "preventure_research_source_capture_unproven",
          "This web-search-only authority retains grounding metadata, not independently captured page content; record it as partial.",
        );
      }
      const retrievedAt = timestamp(input.retrievedAt, "Source retrieval time");
      const optionalId = (value, label) => value ? cleanId(value, label) : null;
      const rawUrl = input.url ? cleanText(input.url, "Source URL", 8) : null;
      const sourcePublisher = input.publisher
        ? cleanText(input.publisher, "Source publisher", 2)
        : null;
      const identity = deriveSourceIdentityBinding(rawUrl, sourcePublisher);
      for (const [key, value] of Object.entries(identity)) {
        if (Object.prototype.hasOwnProperty.call(input, key) && !sameCanonical(input[key], value)) {
          fail(
            "preventure_research_source_identity_changed",
            `Source ${key} does not match the server-derived public URL identity.`,
          );
        }
      }
      const body = {
        schema: PREVENTURE_RESEARCH_SOURCE_SCHEMA,
        authorityHash: assignment.authorityHash,
        assignmentHash: assignment.assignmentHash,
        id: cleanId(input.id, "Source ID"),
        version: cleanId(input.version, "Source version"),
        sourceClass,
        sourceTier,
        captureStatus,
        url: rawUrl,
        ...identity,
        title: input.title ? cleanText(input.title, "Source title", 3) : null,
        publisher: sourcePublisher,
        publishedAt: input.publishedAt ? timestamp(input.publishedAt, "Source publication time") : null,
        contentHash: input.contentHash ? exactHash(input.contentHash, "Source content hash") : null,
        contentLocation: input.contentLocation
          ? cleanText(input.contentLocation, "Source content location", 3)
          : null,
        researchRunId: optionalId(input.researchRunId, "Research run ID"),
        sourceRecordId: optionalId(input.sourceRecordId, "Research source record ID"),
        provenanceId: optionalId(input.provenanceId, "Provenance ID"),
        agentRunReceiptId: optionalId(input.agentRunReceiptId, "Agent receipt ID"),
        limitations: boundedTextList(
          input.limitations,
          "Source limitations",
          { minimum: captureStatus === "partial" ? 1 : 0, maximum: 12 },
        ),
        supersedesSnapshotHash: input.supersedesSnapshotHash
          ? exactHash(input.supersedesSnapshotHash, "Superseded source snapshot hash")
          : null,
        retrievedAt,
      };
      if (
        captureStatus === "captured"
        && (!body.url || !body.contentHash || !body.contentLocation)
      ) {
        fail(
          "preventure_research_source_invalid",
          "A captured source requires its public URL, content hash, and retained local location.",
        );
      }
      assertSourceExecution(assignment, body);
      if (body.supersedesSnapshotHash) {
        const prior = db.prepare(
          `SELECT authority_hash, assignment_hash, source_id
           FROM preventure_research_source_snapshots WHERE snapshot_hash = ?`,
        ).get(body.supersedesSnapshotHash);
        if (
          !prior
          || prior.authority_hash !== body.authorityHash
          || prior.assignment_hash !== body.assignmentHash
          || prior.source_id !== body.id
        ) fail("preventure_research_source_invalid", "Source supersession does not preserve identity and authority.");
      }
      const sourceSnapshot = sealedRecord(body, "snapshotHash");
      const logical = db.prepare(
        `SELECT * FROM preventure_research_source_snapshots
         WHERE authority_hash = ? AND source_id = ? AND source_version = ?`,
      ).get(body.authorityHash, body.id, body.version);
      if (logical) {
        const existing = readSourceRows([logical])[0];
        if (!sameCanonical(existing, sourceSnapshot)) {
          fail("preventure_research_source_conflict", "The source ID/version is already bound differently.");
        }
        return { created: false, sourceSnapshot: existing };
      }
      if (body.sourceIdentityHash && db.prepare(
        `SELECT 1 FROM preventure_research_source_snapshots
         WHERE authority_hash = ? AND source_identity_hash = ?`,
      ).get(body.authorityHash, body.sourceIdentityHash)) {
        fail(
          "preventure_research_source_identity_duplicate",
          "One canonical public URL cannot be multiplied into several research sources.",
        );
      }
      if (body.offerIdentityKey && db.prepare(
        `SELECT 1 FROM preventure_research_source_snapshots
         WHERE authority_hash = ? AND offer_identity_key = ?`,
      ).get(body.authorityHash, body.offerIdentityKey)) {
        fail(
          "preventure_research_offer_identity_duplicate",
          "One canonical marketplace offer cannot be multiplied through URL aliases.",
        );
      }
      insertProjection(
        db,
        "preventure_research_source_snapshots",
        sourceProjection(sourceSnapshot, timestamp(undefined, "Source snapshot creation time")),
      );
      return { created: true, sourceSnapshot };
    });
  }

  function recordEvidence(assignmentHash, input = {}) {
    return atomic(() => {
      const assignment = getAssignment(assignmentHash);
      if (!assignment) fail("preventure_research_assignment_missing", "The research assignment is not registered.");
      assertEvidenceLedgerUnsealed(assignment.authorityHash);
      if (!activeResearchWrite(assignment.authorityHash)) {
        fail(
          "preventure_research_ledger_not_active",
          "New evidence capture requires active unexpired research authority.",
        );
      }
      const authority = requireAuthority(assignment.authorityHash);
      const truthClass = cleanId(input.truthClass, "Evidence truth class");
      const polarity = cleanId(input.polarity, "Evidence polarity");
      const confidence = cleanId(input.confidence, "Evidence confidence");
      if (!EVIDENCE_TRUTH_CLASSES.has(truthClass)) {
        fail("preventure_research_evidence_invalid", "Evidence truth class is unsupported.");
      }
      if (!EVIDENCE_POLARITIES.has(polarity) || !EVIDENCE_CONFIDENCE.has(confidence)) {
        fail("preventure_research_evidence_invalid", "Evidence polarity or confidence is unsupported.");
      }
      const questionId = cleanId(input.questionId, "Research question ID");
      if (!authority.researchQuestions.some((question) => question.id === questionId)) {
        fail("preventure_research_evidence_invalid", "Evidence does not answer an approved research question.");
      }
      const sourceSnapshotHash = input.sourceSnapshotHash
        ? exactHash(input.sourceSnapshotHash, "Source snapshot hash")
        : null;
      if (truthClass === "observed_fact" && !sourceSnapshotHash) {
        fail("preventure_research_evidence_invalid", "Observed facts require retained source evidence.");
      }
      let source = null;
      if (sourceSnapshotHash) {
        source = db.prepare(
          `SELECT authority_hash, assignment_hash, source_class, capture_status,
                  source_identity_hash, marketplace_channel_id, offer_identity_key,
                  seller_identity_key, publisher, publisher_identity_key,
                  buyer_independence_group
           FROM preventure_research_source_snapshots
           WHERE snapshot_hash = ?`,
        ).get(sourceSnapshotHash);
        if (
          !source
          || source.authority_hash !== assignment.authorityHash
          || source.assignment_hash !== assignment.assignmentHash
        ) fail("preventure_research_evidence_invalid", "Evidence source belongs to another assignment.");
      }
      if (truthClass === "observed_fact" && source?.capture_status !== "captured") {
        fail(
          "preventure_research_evidence_invalid",
          "Observed facts require independently captured source content; partial grounding remains model inference.",
        );
      }
      const criterionId = input.criterionId
        ? cleanId(input.criterionId, "Evidence criterion ID")
        : null;
      const details = validateEvidenceDetails(authority, assignment, criterionId, input.details);
      const comparatorGroundingValid = details.comparator !== null && source
        && source.source_class === "public_marketplace_listing_or_result_observation"
        && (
          (truthClass === "observed_fact" && source.capture_status === "captured")
          || (truthClass === "model_inference" && source.capture_status === "partial")
        );
      if (details.comparator !== null && !comparatorGroundingValid) {
        fail(
          "preventure_research_evidence_invalid",
          "Comparator evidence must retain either captured observed content or explicit model inference over exact partial marketplace grounding.",
        );
      }
      if (details.comparator !== null && (
        !source.offer_identity_key
        || details.comparator.id !== source.offer_identity_key
        || details.comparator.channelId !== source.marketplace_channel_id
        || details.comparator.sellerId !== source.seller_identity_key
        || (source.capture_status === "partial"
          && details.comparator.reviewObservationCount !== 0)
      )) {
        fail(
          "preventure_research_comparator_identity_unproven",
          "Comparator offer, marketplace, seller, or review claims do not match the server-derived public source identity.",
        );
      }
      if (details.buyerEvidence !== null && !(
        source
        && (
          (truthClass === "observed_fact" && source.capture_status === "captured")
          || (truthClass === "model_inference" && source.capture_status === "partial")
        )
      )) {
        fail(
          "preventure_research_evidence_invalid",
          "Buyer evidence must retain its explicit captured-fact or partial-inference source grade.",
        );
      }
      if (details.buyerEvidence !== null && (
        details.buyerEvidence.independenceGroup !== source.buyer_independence_group
        || (details.buyerEvidence.paidOfferId !== null
          && details.buyerEvidence.paidOfferId !== source.offer_identity_key)
        || (details.buyerEvidence.sellerOrPublisherId !== null
          && details.buyerEvidence.sellerOrPublisherId !== source.seller_identity_key)
        || (
          details.buyerEvidence.kind === "purchaser_attributable_behaviour"
          && (
            !source.offer_identity_key
            || !source.seller_identity_key
            || details.buyerEvidence.paidOfferId !== source.offer_identity_key
            || details.buyerEvidence.sellerOrPublisherId !== source.seller_identity_key
          )
        )
      )) {
        fail(
          "preventure_research_buyer_identity_unproven",
          "Buyer evidence identity is not attributable to the exact server-derived source, offer, and seller.",
        );
      }
      if ((criterionId || details.recommendation !== null) && (
        !source
        || !["captured", "partial"].includes(source.capture_status)
        || (source.capture_status === "partial" && truthClass !== "model_inference")
      )) {
        fail(
          "preventure_research_evidence_invalid",
          "Decision case and recommendation evidence require captured fact evidence or explicit model inference over exact partial grounding.",
        );
      }
      const supersedesEvidenceHash = input.supersedesEvidenceHash
        ? exactHash(input.supersedesEvidenceHash, "Superseded evidence hash")
        : null;
      const id = cleanId(input.id, "Evidence ID");
      if (supersedesEvidenceHash) {
        const prior = db.prepare(
          `SELECT authority_hash, assignment_hash, evidence_id
           FROM preventure_research_evidence_records WHERE evidence_hash = ?`,
        ).get(supersedesEvidenceHash);
        if (
          !prior
          || prior.authority_hash !== assignment.authorityHash
          || prior.assignment_hash !== assignment.assignmentHash
          || prior.evidence_id !== id
        ) fail("preventure_research_evidence_invalid", "Evidence supersession does not preserve identity and authority.");
      }
      const body = {
        schema: PREVENTURE_RESEARCH_EVIDENCE_SCHEMA,
        authorityHash: assignment.authorityHash,
        assignmentHash: assignment.assignmentHash,
        id,
        version: cleanId(input.version, "Evidence version"),
        sourceSnapshotHash,
        truthClass,
        polarity,
        questionId,
        criterionId,
        claim: cleanText(input.claim, "Evidence claim", 12),
        confidence,
        limitations: boundedTextList(
          input.limitations,
          "Evidence limitations",
          { minimum: truthClass === "model_inference" ? 1 : 0, maximum: 12 },
        ),
        details,
        supersedesEvidenceHash,
        capturedAt: timestamp(input.capturedAt, "Evidence capture time"),
      };
      const evidence = sealedRecord(body, "evidenceHash");
      const logical = db.prepare(
        `SELECT * FROM preventure_research_evidence_records
         WHERE authority_hash = ? AND evidence_id = ? AND evidence_version = ?`,
      ).get(body.authorityHash, body.id, body.version);
      if (logical) {
        const existing = readEvidenceRows([logical])[0];
        if (!sameCanonical(existing, evidence)) {
          fail("preventure_research_evidence_conflict", "The evidence ID/version is already bound differently.");
        }
        return { created: false, evidence: existing };
      }
      insertProjection(
        db,
        "preventure_research_evidence_records",
        evidenceProjection(evidence, timestamp(undefined, "Evidence creation time")),
      );
      return { created: true, evidence };
    });
  }

  function receiptTaskResult(receiptRow) {
    const snapshot = parseObject(
      receiptRow.receipt,
      `Agent receipt ${receiptRow.id} snapshot`,
    );
    let result = snapshot.task?.result ?? null;
    if (typeof result === "string") {
      try {
        result = JSON.parse(result);
      } catch {
        result = null;
      }
    }
    return { snapshot, result: isObject(result) ? result : {} };
  }

  function assertExactTerminalCandidate(actual, candidates, label) {
    const present = candidates.filter((value) => value !== undefined && value !== null);
    if (present.length < 1 || present.some((value) => !sameCanonical(value, actual))) {
      fail(
        "preventure_research_terminal_stop_changed",
        `${label} is not identical across the immutable provider trail.`,
      );
    }
  }

  function assertTerminalTriggerLedger(stopRecord, triggerAssignment, ledger) {
    const provider = stopRecord.providerEvidence;
    const attempts = ledger.executionEvidence.taskAttempts.filter(
      (item) => item.task_id === triggerAssignment.taskId,
    );
    const modelCalls = ledger.executionEvidence.modelCalls.filter(
      (item) => item.task_id === triggerAssignment.taskId,
    );
    const receipts = ledger.executionEvidence.agentRunReceipts.filter(
      (item) => item.task_id === triggerAssignment.taskId,
    );
    const attempt = attempts.find((item) => item.id === provider.attemptId);
    const modelCall = modelCalls.find((item) => item.id === provider.modelCallId);
    const receipt = receipts.find((item) => item.id === provider.agentRunReceiptId);
    if (
      attempts.length !== 1
      || modelCalls.length !== 1
      || !attempt
      || !modelCall
      || !receipt
      || receipt.attempt_id !== attempt.id
      || modelCall.attempt_id !== attempt.id
      || ["provider_dispatched", "unknown"].includes(attempt.outcome_status)
      || ["provider_dispatched", "unknown"].includes(modelCall.outcome_status)
      || modelCall.cost_status === "unknown"
    ) {
      fail(
        "preventure_research_terminal_stop_changed",
        "The terminal stop is not bound to one exact known provider attempt, model call, and immutable receipt.",
      );
    }
    const modelMetadata = parseObject(
      modelCall.metadata,
      `Model call ${modelCall.id} metadata`,
    );
    const attemptMetadata = parseObject(
      attempt.metadata,
      `Task attempt ${attempt.id} metadata`,
    );
    const { snapshot, result } = receiptTaskResult(receipt);
    const providerRequestId = modelCall.provider_request_id ?? null;
    const providerResponseId = modelMetadata.providerResponseId ?? null;
    if (
      provider.providerRequestId !== providerRequestId
      || provider.providerResponseId !== providerResponseId
      || snapshot.provider?.providerRequestId !== providerRequestId
      || (snapshot.provider?.providerResponseId ?? null) !== providerResponseId
      || (snapshot.provider?.metadata?.providerResponseId ?? null) !== providerResponseId
    ) {
      fail(
        "preventure_research_terminal_stop_changed",
        "The terminal stop changed the HTTP request or Responses-body identity.",
      );
    }
    const clientRequestId = modelMetadata.clientRequestId;
    if (
      typeof clientRequestId !== "string"
      || !SAFE_ID_PATTERN.test(clientRequestId)
      || attemptMetadata.clientRequestId !== clientRequestId
      || snapshot.attempt?.metadata?.clientRequestId !== clientRequestId
      || snapshot.provider?.metadata?.clientRequestId !== clientRequestId
      || provider.clientRequestHash !== sha256(clientRequestId)
    ) {
      fail(
        "preventure_research_terminal_stop_changed",
        "The terminal stop changed its stable client request identity.",
      );
    }
    assertExactTerminalCandidate(provider.rawOutputArtifactHash, [
      modelMetadata.retainedOutputHash,
      result.retainedOutputHash,
      result.rawOutputArtifactHash,
    ], "Terminal raw-output artifact hash");
    assertExactTerminalCandidate(provider.responseIssuesHash, [
      modelMetadata.responseIssuesHash,
      result.responseIssuesHash,
    ], "Terminal response-issues hash");
    const technicalPreEffect = stopRecord.triggerOutcomeClass === "known_failed_before_effect";
    if (technicalPreEffect) {
      for (const [label, actual, candidates] of [
        ["Official endpoint hash", provider.officialEndpointHash, [
          modelMetadata.officialEndpointHash,
          attemptMetadata.officialEndpointHash,
          result.officialEndpointHash,
        ]],
        ["Provider HTTP status", provider.httpStatus, [
          modelMetadata.httpStatus,
          attemptMetadata.httpStatus,
          result.httpStatus,
        ]],
        ["Provider error type", provider.providerErrorType, [
          modelMetadata.providerErrorType,
          attemptMetadata.providerErrorType,
          result.providerErrorType,
        ]],
        ["Provider error code", provider.providerErrorCode, [
          modelMetadata.providerErrorCode,
          attemptMetadata.providerErrorCode,
          result.providerErrorCode,
        ]],
        ["Provider error artifact", provider.providerErrorBodyArtifactHash, [
          modelMetadata.providerErrorBodyArtifactHash,
          attemptMetadata.providerErrorBodyArtifactHash,
          result.providerErrorBodyArtifactHash,
        ]],
        ["Provider zero-billing guarantee", provider.providerZeroBillingGuarantee, [
          modelMetadata.providerZeroBillingGuarantee,
          result.providerZeroBillingGuarantee,
        ]],
      ]) assertExactTerminalCandidate(actual, candidates, label);
      const toolInvocations = db.prepare(
        `SELECT * FROM agent_tool_invocations
         WHERE task_id = ? ORDER BY requested_at, id`,
      ).all(triggerAssignment.taskId);
      const providerResearchRunCount = Number(db.prepare(
        "SELECT COUNT(*) AS count FROM research_runs WHERE task_id = ?",
      ).get(triggerAssignment.taskId).count);
      const invocation = toolInvocations[0];
      const invocationMetadata = invocation
        ? parseObject(
            invocation.metadata,
            `Technical terminal tool invocation ${invocation.id}`,
          )
        : null;
      if (
        attempt.outcome_status !== "failed_before_effect"
        || providerResponseId !== null
        || Number(modelCall.input_tokens || 0) !== 0
        || Number(modelCall.output_tokens || 0) !== 0
        || toolInvocations.length !== 1
        || invocation.task_id !== triggerAssignment.taskId
        || invocation.workflow_id !== triggerAssignment.workflowId
        || invocation.run_id !== receipt.run_id
        || invocation.attempt_id !== attempt.id
        || invocation.observed_attempt_id !== attempt.id
        || invocation.tool_id !== "research_adapter"
        || invocation.requested_mode !== "live"
        || invocation.status !== "completed"
        || invocation.decision !== "provider_rejected_before_effect"
        || invocationMetadata.authorityHash !== triggerAssignment.authorityHash
        || invocationMetadata.assignmentHash !== triggerAssignment.assignmentHash
        || invocationMetadata.descriptorHash !== modelMetadata.descriptorHash
        || invocationMetadata.clientRequestId !== clientRequestId
        || providerResearchRunCount !== 0
        || ledger.sourceSnapshots.some(
          (item) => item.assignmentHash === triggerAssignment.assignmentHash,
        )
        || ledger.evidenceRecords.some(
          (item) => item.assignmentHash === triggerAssignment.assignmentHash,
        )
      ) {
        fail(
          "preventure_research_terminal_stop_changed",
          "A known pre-effect failure contains a provider response, usage, observed provider activity, or commercial evidence.",
        );
      }
    }
    const decisionTimeCostHeads = latestCostHeads(ledger.costEvents.filter(
      (item) => Date.parse(costTruthRecordedAt(item, ledger))
        <= Date.parse(stopRecord.stoppedAt),
    )).filter(
      (item) => item.assignmentHash === triggerAssignment.assignmentHash,
    );
    if (decisionTimeCostHeads.length !== 1) {
      fail(
        "preventure_research_terminal_stop_changed",
        "The terminal trigger does not retain one exact decision-time cost head.",
      );
    }
    const cost = decisionTimeCostHeads[0];
    if (
      cost.eventType !== provider.costStatus
      || cost.amountAudCents !== provider.costAudCents
      || cost.exposureAudCents !== provider.exposureAudCents
      || cost.taskAttemptId !== attempt.id
      || cost.modelCallId !== modelCall.id
      || cost.agentRunReceiptId !== receipt.id
      || !cost.budgetReservationId
      || !cost.costId
    ) {
      fail(
        "preventure_research_terminal_stop_changed",
        "The terminal provider proof and its exact cost trail do not match.",
      );
    }
    assertLinkedExecution(triggerAssignment, {
      taskAttemptId: cost.taskAttemptId,
      modelCallId: cost.modelCallId,
      agentRunReceiptId: cost.agentRunReceiptId,
    }, {
      allowTechnicalTerminalReceipt: true,
    });
    const latestCost = latestCostHeads(ledger.costEvents).find(
      (item) => item.assignmentHash === cost.assignmentHash && item.costKey === cost.costKey,
    );
    if (latestCost?.receiptHash === cost.receiptHash) {
      assertLinkedExecution(triggerAssignment, cost, {
        allowTechnicalTerminalReceipt: true,
      });
    } else if (
      !latestCost
      || latestCost.eventType !== "reconciled"
      || latestCost.previousReceiptHash !== cost.receiptHash
      || Date.parse(costTruthRecordedAt(latestCost, ledger))
        <= Date.parse(stopRecord.stoppedAt)
      || latestCost.amountAudCents > cost.exposureAudCents
      || latestCost.exposureAudCents !== latestCost.amountAudCents
      || ![
        "taskAttemptId", "modelCallId", "budgetReservationId", "costId", "agentRunReceiptId",
      ].every((key) => sameCanonical(latestCost[key], cost[key]))
    ) {
      fail(
        "preventure_research_terminal_stop_changed",
        "The terminal trigger cost proof has an invalid post-decision reconciliation successor.",
      );
    } else {
      assertLinkedExecution(triggerAssignment, latestCost, {
        allowTechnicalTerminalReceipt: true,
      });
    }
    return receipt;
  }

  function assertTerminalActualCoverage(stopRecord, authority, assignments, ledger) {
    const sourceHeads = latestHeads(
      ledger.sourceSnapshots,
      (item) => item.snapshotHash,
      (item) => item.supersedesSnapshotHash,
    );
    const evidenceHeads = latestHeads(
      ledger.evidenceRecords,
      (item) => item.evidenceHash,
      (item) => item.supersedesEvidenceHash,
    );
    const completedAssignmentReceipts = stopRecord.actualCoverage.completedAssignmentIds.map(
      (assignmentId) => {
        const assignment = assignments.find((item) => item.id === assignmentId);
        const completeReceipts = ledger.executionEvidence.agentRunReceipts.filter(
          (item) => item.task_id === assignment?.taskId && item.status === "complete",
        );
        if (!assignment || completeReceipts.length !== 1) {
          fail(
            "preventure_research_terminal_stop_changed",
            `Completed prefix assignment ${assignmentId} lacks one exact complete receipt.`,
          );
        }
        const receipt = completeReceipts[0];
        return {
          assignmentId,
          assignmentHash: assignment.assignmentHash,
          agentRunReceiptId: receipt.id,
          agentRunReceiptHash: canonicalAgentReceiptHash(receipt.receipt_hash),
        };
      },
    ).sort((left, right) => left.assignmentId.localeCompare(right.assignmentId));
    let sourceAttemptRefs = [];
    if (stopRecord.triggerOutcomeClass === "validated_evidence_shortfall") {
      const receipt = ledger.executionEvidence.agentRunReceipts.find(
        (item) => item.id === stopRecord.providerEvidence.agentRunReceiptId,
      );
      const { snapshot, result } = receiptTaskResult(receipt);
      const candidates = [
        result.validatedCoverage,
        snapshot.attempt?.metadata?.validatedCoverage,
        snapshot.provider?.metadata?.validatedCoverage,
      ].filter(isObject);
      if (
        candidates.length < 1
        || candidates.some((candidate) => !sameCanonical(candidate, candidates[0]))
        || candidates[0].status !== "insufficient_evidence"
        || !Array.isArray(candidates[0].searchAttemptProof?.attempts)
      ) {
        fail(
          "preventure_research_terminal_stop_changed",
          "The terminal receipt does not retain one exact validated evidence-shortfall proof.",
        );
      }
      sourceAttemptRefs = candidates[0].searchAttemptProof.attempts
        .map((item) => item.id)
        .sort();
      if (!sameCanonical([...new Set(candidates[0].gapCodes)].sort(), stopRecord.gapCodes)) {
        fail(
          "preventure_research_terminal_stop_changed",
          "The terminal evidence gaps changed after provider validation.",
        );
      }
    }
    const comparatorCoverage = deriveTerminalComparatorCoverage(authority, evidenceHeads);
    const buyerEvidenceCoverage = deriveTerminalBuyerEvidenceCoverage(
      evidenceHeads,
      sourceHeads,
    );
    const expected = {
      sourceSnapshotHashes: sourceHeads.map((item) => item.snapshotHash).sort(),
      evidenceHashes: evidenceHeads.map((item) => item.evidenceHash).sort(),
      comparatorIds: [...new Set(evidenceHeads
        .map((item) => item.details?.comparator?.id)
        .filter(Boolean))].sort(),
      comparatorCoverage: canonical(comparatorCoverage),
      buyerEvidenceCoverage: canonical(buyerEvidenceCoverage),
      sourceAttemptRefs,
      evidenceSetHash: evidenceSetHash(
        authority.authorityHash,
        ledger.evidenceRecords,
        ledger.sourceSnapshots,
      ),
      executionReceiptSetHash: baseExecutionReceiptSetHash(
        authority.authorityHash,
        ledger,
        { cutoff: stopRecord.stoppedAt },
      ),
      completedAssignmentIds: completedAssignmentReceipts
        .map((item) => item.assignmentId)
        .sort(),
      completedAssignmentReceipts,
      retainedContradictionEvidenceIds: evidenceHeads
        .filter((item) => item.polarity === "contrary")
        .map((item) => item.id)
        .sort(),
      retainedCaseCriterionIds: [...new Set(evidenceHeads
        .map((item) => item.criterionId)
        .filter(Boolean))].sort(),
    };
    if (!sameCanonical(stopRecord.actualCoverage, expected)) {
      fail(
        "preventure_research_terminal_stop_changed",
        "The terminal stop changed the exact retained evidence, coverage, receipts, or completed prefix.",
      );
    }
  }

  function readLedger(authorityHash) {
    const authorityEntry = getAuthorityEntry(authorityHash);
    if (!authorityEntry) {
      fail("preventure_research_authority_missing", "The exact pre-venture research authority is not registered.");
    }
    const { authority, readinessSpec } = authorityEntry;
    const lifecycle = loadLifecycleRows(db, authority);
    const assignments = readAssignmentRows(authorityHash);
    const costEvents = readCostRows(loadRowsByAuthority(
      db,
      "preventure_research_cost_events",
      authorityHash,
      "assignment_hash, cost_key, sequence",
    ));
    const ownerBillingObservations = readOwnerBillingObservationRows(
      loadRowsByAuthority(
        db,
        "preventure_research_provider_billing_observations",
        authorityHash,
        "original_cost_occurred_at, recorded_at, observation_hash",
      ),
    );
    const terminalRecoveries = readTerminalRecoveryRows(loadRowsByAuthority(
      db,
      "preventure_research_terminal_recoveries",
      authorityHash,
      "recorded_at, recovery_hash",
    ));
    terminalRecoveries.forEach((recovery) => {
      if (retainedOutputStore) {
        assertTerminalRecoveryArtifact(recovery, retainedOutputStore);
      } else if (!allowUnresolvedTerminalRecoveries) {
        assertTerminalRecoveryArtifact(recovery, retainedOutputStore);
      }
      const assignment = assignments.find(
        (item) => item.assignmentHash === recovery.assignmentHash,
      );
      const predecessor = costEvents.find(
        (item) => item.receiptHash === recovery.costSnapshot.priorReceiptHash,
      );
      const terminalCost = costEvents.find(
        (item) => item.receiptHash === recovery.costSnapshot.terminalReceiptHash,
      );
      if (
        !assignment
        || recovery.authorityHash !== authorityHash
        || recovery.assignmentTemplateHash !== assignment.templateHash
        || recovery.assignmentCapAudCents !== assignment.maxCostAudCents
        || recovery.taskId !== assignment.taskId
        || recovery.workflowId !== assignment.workflowId
        || !predecessor
        || !terminalCost
        || terminalCost.previousReceiptHash !== predecessor.receiptHash
        || terminalCost.eventType !== "unknown"
        || terminalCost.amountAudCents !== null
        || terminalCost.exposureAudCents !== assignment.maxCostAudCents
        || terminalCost.taskAttemptId !== recovery.originalDispatch.taskAttemptId
        || terminalCost.modelCallId !== recovery.originalDispatch.modelCallId
        || terminalCost.budgetReservationId !== recovery.costSnapshot.budgetReservationId
        || terminalCost.costId !== recovery.costSnapshot.costId
        || terminalCost.terminalRecovery?.schema
          !== PREVENTURE_RESEARCH_TERMINAL_COST_TRANSITION_SCHEMA
        || terminalCost.terminalRecovery?.recoveryIntentHash !== recovery.recoveryIntentHash
        || terminalCost.terminalRecovery?.terminalEventHash
          !== recovery.terminalBinding.eventHash
        || terminalCost.terminalRecovery?.artifactHash !== recovery.retainedArtifact.artifactHash
      ) {
        fail(
          "preventure_research_terminal_recovery_changed",
          "Terminal custody lost its exact assignment, predecessor, or unknown full-cap cost chain.",
        );
      }
      const receipt = recovery.executionReceipt;
      const latestReceipt = db.prepare(
        `SELECT * FROM agent_run_receipts WHERE attempt_id = ?
         ORDER BY created_at DESC, id DESC LIMIT 1`,
      ).get(recovery.originalDispatch.taskAttemptId);
      if (
        (receipt === null) !== !latestReceipt
        || (receipt && (
          latestReceipt.id !== receipt.id
          || canonicalAgentReceiptHash(latestReceipt.receipt_hash) !== receipt.hash
          || latestReceipt.status !== receipt.status
          || latestReceipt.outcome_status !== receipt.outcomeStatus
        ))
      ) {
        fail(
          "preventure_research_terminal_recovery_changed",
          "Terminal custody no longer matches the latest immutable execution receipt.",
        );
      }
      assertTerminalRecoveryExecutionClosure(
        db,
        recovery,
        assignments,
        terminalCost,
      );
    });
    const sourceSnapshots = readSourceRows(loadRowsByAuthority(
      db,
      "preventure_research_source_snapshots",
      authorityHash,
      "retrieved_at, snapshot_hash",
    ));
    const evidenceRecords = readEvidenceRows(loadRowsByAuthority(
      db,
      "preventure_research_evidence_records",
      authorityHash,
      "captured_at, evidence_hash",
    ));
    const terminalStopRows = loadRowsByAuthority(
      db,
      "preventure_research_terminal_stops",
      authorityHash,
      "stopped_at, early_stop_record_hash",
    );
    const terminalStopRecord = readTerminalStopRows(
      terminalStopRows,
      authority,
      assignments,
    )[0] || null;
    const assignmentSkips = readAssignmentSkipRows(loadRowsByAuthority(
      db,
      "preventure_research_assignment_skips",
      authorityHash,
      "assignment_order, skip_record_hash",
    ), authority, assignments);
    if (
      (!terminalStopRecord && assignmentSkips.length > 0)
      || (terminalStopRecord && !sameCanonical(
        terminalStopRecord.skippedAssignments,
        assignmentSkips,
      ))
    ) {
      fail(
        "preventure_research_ledger_integrity_failed",
        "The terminal stop and its exact ordered skipped-assignment suffix do not match.",
      );
    }
    assignmentSkips.forEach((skipRecord) => assertSkippedAssignmentUntouched(db, skipRecord));
    const execution = executionEvidence(db, assignments);
    verifyExecutionReceiptChains(db, assignments, execution);
    for (const observation of ownerBillingObservations) {
      const assignment = assignments.find(
        (item) => item.assignmentHash === observation.assignmentHash,
      );
      const chain = costEvents.filter((item) => (
        item.assignmentHash === observation.assignmentHash
        && item.costKey === observation.costBinding.costKey
      )).sort((left, right) => left.sequence - right.sequence);
      const predecessor = chain.find(
        (item) => item.receiptHash
          === observation.predecessor.expectedPreviousReceiptHash,
      );
      const successor = chain.at(-1);
      const terminalRecovery = observation.predecessor.kind === "terminal_recovery"
        ? terminalRecoveries.find(
            (item) => item.recoveryHash === observation.predecessor.hash,
          )
        : null;
      const decisionMatch = observation.predecessor.kind === "sealed_decision"
        && db.prepare(
          `SELECT 1 FROM preventure_research_decisions
           WHERE authority_hash = ? AND decision_hash = ?`,
        ).get(authorityHash, observation.predecessor.hash);
      const reservation = db.prepare(
        "SELECT * FROM budget_reservations WHERE id = ?",
      ).get(observation.costBinding.budgetReservationId);
      const genericCost = db.prepare(
        "SELECT * FROM costs WHERE id = ?",
      ).get(observation.costBinding.costId);
      const modelCall = db.prepare(
        "SELECT * FROM model_calls WHERE id = ?",
      ).get(observation.executionIdentity.modelCallId);
      const receipt = db.prepare(
        "SELECT * FROM agent_run_receipts WHERE id = ?",
      ).get(observation.executionIdentity.agentRunReceiptId);
      const metadataRows = [reservation, genericCost, modelCall];
      const metadataMatches = metadataRows.every((row) => {
        if (!row) return false;
        const metadata = parseObject(row.metadata, "Owner billing projection metadata");
        return metadata.exactBillingPending === false
          && metadata.ownerBillingObservationHash === observation.observationHash
          && metadata.billingTruthStatus
            === PREVENTURE_RESEARCH_OWNER_BILLING_TRUTH_STATUS;
      });
      const overageAudCents = Math.max(
        0,
        observation.billingObservation.amountAudCents
          - Number(assignment?.maxCostAudCents || 0),
      );
      if (
        !assignment
        || observation.authorityHash !== authorityHash
        || observation.assignmentTemplateHash !== assignment.templateHash
        || observation.taskId !== assignment.taskId
        || !predecessor
        || !successor
        || successor.previousReceiptHash !== predecessor.receiptHash
        || successor.eventType !== "reconciled"
        || successor.ownerBillingObservationHash !== observation.observationHash
        || successor.amountAudCents !== observation.billingObservation.amountAudCents
        || successor.exposureAudCents !== observation.billingObservation.amountAudCents
        || successor.occurredAt
          !== observation.billingObservation.originalCostOccurredAt
        || chain[0]?.occurredAt !== observation.billingObservation.originalCostOccurredAt
        || successor.taskAttemptId !== observation.executionIdentity.taskAttemptId
        || successor.modelCallId !== observation.executionIdentity.modelCallId
        || successor.agentRunReceiptId
          !== observation.executionIdentity.agentRunReceiptId
        || successor.budgetReservationId !== observation.costBinding.budgetReservationId
        || successor.costId !== observation.costBinding.costId
        || (
          observation.predecessor.kind === "terminal_recovery"
          && terminalRecovery?.costSnapshot?.terminalReceiptHash !== predecessor.receiptHash
        )
        || (
          observation.predecessor.kind === "sealed_decision"
          && !decisionMatch
        )
        || !receipt
        || canonicalAgentReceiptHash(receipt.receipt_hash)
          !== observation.executionIdentity.agentRunReceiptHash
        || !metadataMatches
        || reservation.status !== "reconciled"
        || Number(reservation.amount_cents)
          !== observation.billingObservation.amountAudCents
        || genericCost.status !== "reconciled"
        || Number(genericCost.amount_cents)
          !== observation.billingObservation.amountAudCents
        || genericCost.occurred_at
          !== observation.billingObservation.originalCostOccurredAt
        || modelCall.cost_status !== "reconciled"
        || Number(modelCall.actual_cost_cents)
          !== observation.billingObservation.amountAudCents
        || Number(modelCall.reconciled_cost_cents)
          !== observation.billingObservation.amountAudCents
        || !sameCanonical(observation.budgetComparison, {
          approvedAssignmentCapAudCents: assignment.maxCostAudCents,
          observedActualAudCents: observation.billingObservation.amountAudCents,
          breached: overageAudCents > 0,
          overageAudCents,
        })
      ) {
        fail(
          "preventure_research_owner_billing_observation_changed",
          "Owner-attested billing no longer matches its predecessor, execution, cost, or accounting projections.",
        );
      }
      assertLinkedExecution(assignment, successor, {
        allowTechnicalTerminalReceipt: true,
        allowTerminalRecoveryReceipt: true,
      });
    }
    const terminalCostReceiptHashes = new Set(
      terminalRecoveries.map((item) => item.costSnapshot.terminalReceiptHash),
    );
    for (const cost of latestCostHeads(costEvents)) {
      const assignment = assignments.find((item) => item.assignmentHash === cost.assignmentHash);
      if (
        assignment
        && (cost.budgetReservationId || cost.costId)
        && !terminalCostReceiptHashes.has(cost.receiptHash)
      ) {
        assertLinkedExecution(assignment, cost, {
          allowTechnicalTerminalReceipt: true,
          allowTerminalRecoveryReceipt: Boolean(cost.ownerBillingObservationHash),
        });
      }
    }
    for (const source of sourceSnapshots) {
      const assignment = assignments.find((item) => item.assignmentHash === source.assignmentHash);
      if (assignment) assertSourceExecution(assignment, source);
    }
    const decisionRow = db.prepare(
      "SELECT * FROM preventure_research_decisions WHERE authority_hash = ?",
    ).get(authorityHash);
    let decision = null;
    if (decisionRow) {
      decision = parseObject(decisionRow.decision_json, "Pre-venture decision JSON");
      validatePreventureResearchDecision(authority, decision);
      assertProjection(
        decisionRow,
        decisionProjection(decision, decisionRow.created_at),
        `Decision ${decisionRow.decision_hash}`,
      );
    }
    const ledger = {
      authority,
      readinessSpec,
      lifecycle,
      assignments,
      costEvents,
      ownerBillingObservations,
      terminalRecoveries,
      sourceSnapshots,
      evidenceRecords,
      terminalStopRecord,
      assignmentSkips,
      decision,
      executionEvidence: execution,
    };
    if (decision) {
      for (const costEvent of costEvents.filter((item) => (
        item.eventType === "reconciled"
        && item.sequence > 1
        && Date.parse(item.occurredAt) > Date.parse(decision.decidedAt)
      ))) {
        const assignment = assignments.find(
          (item) => item.assignmentHash === costEvent.assignmentHash,
        );
        const predecessor = costEvents.find(
          (item) => item.receiptHash === costEvent.previousReceiptHash,
        );
        if (!assignment || !predecessor) {
          fail(
            "preventure_research_reconciliation_changed",
            "A post-decision reconciliation lost its exact assignment or predecessor.",
          );
        }
        assertProviderCostReconciliationTrail(
          assignment,
          decision,
          predecessor,
          costEvent,
          ledger,
        );
      }
    }
    if (terminalStopRecord) {
      const triggerAssignment = assignments.find(
        (assignment) => assignment.assignmentHash === terminalStopRecord.triggerAssignmentHash,
      );
      if (!triggerAssignment) {
        fail(
          "preventure_research_ledger_integrity_failed",
          "The terminal stop trigger assignment is missing.",
        );
      }
      assertTerminalTriggerLedger(terminalStopRecord, triggerAssignment, ledger);
      assertTerminalActualCoverage(terminalStopRecord, authority, assignments, ledger);
    }
    const completedLifecycle = lifecycle.find((event) => event.eventType === "completed");
    if (completedLifecycle && !decision) {
      fail(
        "preventure_research_ledger_integrity_failed",
        "A completed lifecycle is missing its atomically bound diligence decision.",
      );
    }
    if (decision) {
      const terminalStopRow = terminalStopRows[0] || null;
      if (
        (decision.completionMode === "validated_early_stop") !== Boolean(terminalStopRecord)
        || (terminalStopRecord && (
          terminalStopRow.expected_decision_id !== decision.id
          || decision.earlyStopRecordHash !== terminalStopRecord.earlyStopRecordHash
          || !sameCanonical(
            decision.skippedAssignmentRecordHashes,
            assignmentSkips.map((item) => item.skipRecordHash).sort(),
          )
          || !sameCanonical(decision.nextEvidenceAction, terminalStopRecord.nextEvidenceAction)
          || decision.outcome !== "research_more"
        ))
      ) {
        fail(
          "preventure_research_ledger_integrity_failed",
          "The diligence decision is not the exact decision paired to its terminal stop and skipped suffix.",
        );
      }
      if (
        decision.evidenceSetHash !== evidenceSetHash(authorityHash, evidenceRecords, sourceSnapshots)
        || decision.receiptSetHash !== receiptSetHash(
          authorityHash,
          ledger,
          { cutoff: decision.decidedAt },
        )
      ) {
        fail(
          "preventure_research_ledger_integrity_failed",
          "The diligence decision no longer matches its retained evidence and receipts.",
        );
      }
      const truth = ledgerTruth(ledger, { cutoff: decision.decidedAt });
      if (
        decision.estimatedInternalAiCostAudCents !== truth.estimatedInternalAiCostAudCents
        || decision.reconciledInternalAiCostAudCents !== truth.reconciledInternalAiCostAudCents
        || decision.exactBillingPending !== truth.exactBillingPending
        || decision.unknownProviderOutcomeCount !== truth.unknownProviderOutcomeCount
        || decision.unknownCostCount !== truth.unknownCostCount
      ) {
        fail(
          "preventure_research_ledger_integrity_failed",
          "The diligence decision contradicts provider or cost truth.",
        );
      }
      const completed = completedLifecycle;
      if (
        terminalStopRecord
        && terminalStopRows[0].expected_completion_event_id !== completed?.id
      ) {
        fail(
          "preventure_research_ledger_integrity_failed",
          "The terminal stop is not paired to its exact completed lifecycle event.",
        );
      }
      const expectedMetadata = {
        decisionHash: decision.decisionHash,
        evidenceSetHash: decision.evidenceSetHash,
        receiptSetHash: decision.receiptSetHash,
        resultingReadinessHash: preventureResultingReadinessHash(decision, authorityRegistry),
        outcome: decision.outcome,
      };
      if (!completed || !sameCanonical(completed.metadata, expectedMetadata)) {
        fail(
          "preventure_research_ledger_integrity_failed",
          "The decision is not atomically linked to its completed lifecycle and resulting readiness.",
        );
      }
    }
    ledger.state = readStateFromLedger(ledger);
    return ledger;
  }

  function readStateFromLedger(ledger) {
    const evaluatedAt = timestamp(undefined, "Lifecycle evaluation time");
    const state = effectivePreventureLifecycleState(
      ledger.authority,
      ledger.lifecycle,
      evaluatedAt,
    );
    const truth = ledgerTruth(ledger);
    const expired = Date.parse(evaluatedAt) >= Date.parse(ledger.authority.expiresAt);
    const terminal = TERMINAL_EVENT_TYPES.has(state) || ledger.terminalRecoveries.length > 0;
    return {
      authorityHash: ledger.authority.authorityHash,
      state,
      terminal,
      expired,
      dispatchAllowed: state === "activated"
        && !expired
        && ledger.terminalRecoveries.length === 0
        && !ledger.decision
        && !ledger.terminalStopRecord
        && truth.unknownProviderOutcomeCount === 0
        && truth.unknownCostCount === 0,
      decisionHash: ledger.decision?.decisionHash || null,
      earlyStopRecordHash: ledger.terminalStopRecord?.earlyStopRecordHash || null,
      assignmentCount: ledger.assignments.length,
      estimatedInternalAiCostAudCents: truth.estimatedInternalAiCostAudCents,
      reconciledInternalAiCostAudCents: truth.reconciledInternalAiCostAudCents,
      exactBillingPending: truth.exactBillingPending,
      unknownProviderOutcomeCount: truth.unknownProviderOutcomeCount,
      unknownCostCount: truth.unknownCostCount,
    };
  }

  function readState(authorityHash) {
    return readLedger(authorityHash).state;
  }

  function withAtomicEvidenceBatch(operation) {
    if (typeof operation !== "function") {
      fail(
        "preventure_research_batch_invalid",
        "An atomic evidence batch requires one synchronous operation callback.",
      );
    }
    return atomic(() => {
      const result = operation(Object.freeze({
        recordSourceSnapshot,
        recordEvidence,
      }));
      if (result && typeof result.then === "function") {
        fail(
          "preventure_research_batch_invalid",
          "Atomic evidence batches must finish synchronously before the transaction is released.",
        );
      }
      return result;
    });
  }

  function assertDerivedInput(input, key, expected) {
    if (Object.prototype.hasOwnProperty.call(input, key) && !sameCanonical(input[key], expected)) {
      fail(
        "preventure_research_decision_assertion_mismatch",
        `Caller-supplied ${key} contradicts the retained ledger.`,
      );
    }
  }

  function sealDecisionAndCompletion(
    authority,
    decisionInput,
    derived,
    completionInput,
  ) {
    for (const [key, value] of Object.entries(derived)) {
      assertDerivedInput(decisionInput, key, value);
    }
    const decision = createPreventureResearchDecision(authority, {
      ...decisionInput,
      ...derived,
      decidedAt: timestamp(decisionInput.decidedAt, "Diligence decision time"),
    });
    validatePreventureResearchDecision(authority, decision);
    insertProjection(
      db,
      "preventure_research_decisions",
      decisionProjection(decision, timestamp(undefined, "Decision creation time")),
    );
    const completionMetadata = {
      decisionHash: decision.decisionHash,
      evidenceSetHash: decision.evidenceSetHash,
      receiptSetHash: decision.receiptSetHash,
      resultingReadinessHash: preventureResultingReadinessHash(decision, authorityRegistry),
      outcome: decision.outcome,
    };
    if (
      completionInput.metadata
      && !sameCanonical(completionInput.metadata, completionMetadata)
    ) {
      fail(
        "preventure_research_completion_mismatch",
        "Caller completion metadata contradicts the validated decision and resulting readiness.",
      );
    }
    const completionAt = timestamp(
      completionInput.occurredAt || decision.decidedAt,
      "Diligence completion time",
    );
    if (Date.parse(completionAt) < Date.parse(decision.decidedAt)) {
      fail("preventure_research_completion_mismatch", "Completion cannot predate its decision.");
    }
    const completion = appendLifecycleInternal(authority, {
      id: completionInput.id,
      eventType: "completed",
      occurredAt: completionAt,
      actor: completionInput.actor || "pantheon",
      reason: completionInput.reason || "Diligence decision and resulting readiness sealed.",
      metadata: completionMetadata,
    }, true);
    return {
      created: true,
      decision,
      completionEvent: completion.event,
      resultingReadinessHash: completionMetadata.resultingReadinessHash,
    };
  }

  function recordValidatedEarlyStop(
    authorityHash,
    stopRecord = {},
    decisionInput = {},
    completionInput = {},
  ) {
    return atomic(() => {
      const authority = requireAuthority(authorityHash);
      const existingLedger = readLedger(authorityHash);
      if (existingLedger.terminalStopRecord || existingLedger.decision) {
        if (!existingLedger.terminalStopRecord || !existingLedger.decision) {
          fail(
            "preventure_research_ledger_integrity_failed",
            "A terminal stop, diligence decision, and completion must exist atomically.",
          );
        }
        if (
          !stopRecord?.earlyStopRecordHash
          || !decisionInput?.id
          || !decisionInput?.version
          || !completionInput?.id
        ) {
          fail(
            "preventure_research_early_stop_replay_incomplete",
            "Early-stop replay requires the exact prior stop, decision ID/version, and completion ID.",
          );
        }
        if (!sameCanonical(existingLedger.terminalStopRecord, stopRecord)) {
          fail(
            "preventure_research_terminal_stop_conflict",
            "Early-stop replay changed the immutable terminal-stop record.",
          );
        }
        for (const [key, value] of Object.entries(decisionInput)) {
          if (!sameCanonical(existingLedger.decision[key], value)) {
            fail("preventure_research_decision_conflict", `Early-stop replay changed decision ${key}.`);
          }
        }
        const completionEvent = existingLedger.lifecycle.find(
          (event) => event.eventType === "completed",
        );
        const completionComparisons = {
          id: completionEvent?.id,
          occurredAt: completionEvent?.occurredAt,
          actor: completionEvent?.actor,
          reason: completionEvent?.reason,
          metadata: completionEvent?.metadata,
        };
        for (const [key, value] of Object.entries(completionInput)) {
          if (!sameCanonical(completionComparisons[key], value)) {
            fail(
              "preventure_research_completion_mismatch",
              `Early-stop completion replay changed ${key}.`,
            );
          }
        }
        return {
          created: false,
          stopRecord: existingLedger.terminalStopRecord,
          skippedAssignments: existingLedger.assignmentSkips,
          decision: existingLedger.decision,
          completionEvent,
          resultingReadinessHash: preventureResultingReadinessHash(
            existingLedger.decision,
            authorityRegistry,
          ),
        };
      }
      if (
        lifecycleState(existingLedger.lifecycle) !== "activated"
        || Date.parse(timestamp(undefined, "Current time")) >= Date.parse(authority.expiresAt)
      ) {
        fail(
          "preventure_research_decision_not_authorized",
          "A validated early stop requires activated, unexpired pre-venture research authority.",
        );
      }
      requireCandidateAuthority(authorityHash, "Validated early-stop finalization");
      const assignments = existingLedger.assignments;
      if (
        assignments.length !== authority.assignments.length
        || !sameCanonical(
          assignments.map((assignment) => assignment.id),
          authority.assignments.map((assignment) => assignment.id),
        )
      ) {
        fail(
          "preventure_research_decision_incomplete",
          "Every exact approved assignment must be materialized in authority order before an early stop.",
        );
      }
      const triggerAssignment = assignments.find(
        (assignment) => assignment.assignmentHash === stopRecord?.triggerAssignmentHash,
      );
      if (!triggerAssignment || triggerAssignment.id !== stopRecord?.triggerAssignmentId) {
        fail(
          "preventure_research_terminal_stop_changed",
          "The terminal trigger is not one exact approved assignment.",
        );
      }
      validatePreventureResearchTerminalStop(stopRecord, {
        authority,
        triggerAssignment,
        assignments,
      });
      const stoppedAt = timestamp(stopRecord.stoppedAt, "Validated early-stop time");
      if (
        Date.parse(stoppedAt) < Date.parse(authority.approvedAt)
        || Date.parse(stoppedAt) >= Date.parse(authority.expiresAt)
      ) {
        fail(
          "preventure_research_terminal_stop_changed",
          "The validated early stop is outside its immutable authority window.",
        );
      }
      const expectedDecisionId = `${authority.id}_decision`;
      const expectedCompletionEventId = `${authority.id}_completed`;
      if (
        decisionInput.id !== expectedDecisionId
        || decisionInput.decidedAt !== stoppedAt
        || completionInput.id !== expectedCompletionEventId
      ) {
        fail(
          "preventure_research_terminal_stop_changed",
          "The terminal stop is not paired to its exact decision, time, and completion event.",
        );
      }
      assertTerminalTriggerLedger(stopRecord, triggerAssignment, existingLedger);
      assertTerminalActualCoverage(stopRecord, authority, assignments, existingLedger);
      for (const skipRecord of stopRecord.skippedAssignments) {
        validatePreventureResearchAssignmentSkip(skipRecord, {
          authorityHash,
          terminalStopId: stopRecord.id,
          triggerAssignmentHash: triggerAssignment.assignmentHash,
        });
        assertSkippedAssignmentUntouched(db, skipRecord, { requireSkippedState: false });
      }

      return withPreventureValidatedEarlyStopCapability(db, {
        authorityHash,
        earlyStopRecordHash: stopRecord.earlyStopRecordHash,
        decisionId: expectedDecisionId,
        completionEventId: expectedCompletionEventId,
        skippedAssignmentCount: stopRecord.skippedAssignments.length,
      }, () => {
      insertProjection(
        db,
        "preventure_research_terminal_stops",
        terminalStopProjection(
          stopRecord,
          expectedDecisionId,
          expectedCompletionEventId,
          timestamp(undefined, "Terminal-stop creation time"),
        ),
      );
      for (const skipRecord of stopRecord.skippedAssignments) {
        const updated = db.prepare(
          `UPDATE tasks
           SET status = 'skipped', outcome_status = 'not_started',
               completed_at = ?, updated_at = ?
           WHERE id = ?
             AND status IN ('planned', 'queued', 'blocked')
             AND outcome_status = 'not_started'
             AND attempt_count = 0
             AND claim_token IS NULL
             AND claimed_at IS NULL
             AND cost_actual_cents = 0`,
        ).run(stoppedAt, stoppedAt, skipRecord.taskId);
        if (Number(updated.changes) !== 1) {
          fail(
            "preventure_research_terminal_stop_changed",
            `Skipped assignment ${skipRecord.assignmentId} was no longer untouched.`,
          );
        }
        insertProjection(
          db,
          "preventure_research_assignment_skips",
          assignmentSkipProjection(
            skipRecord,
            timestamp(undefined, "Assignment-skip creation time"),
          ),
        );
      }

      const stoppedLedger = readLedger(authorityHash);
      const readiness = evaluatePreventureResearchReadiness(
        stoppedLedger,
        stoppedLedger.state,
        { generatedAt: stoppedAt, terminalStopRecord: stopRecord },
      );
      if (!readiness.canSealDecision || readiness.execution.dispatchableAssignmentCount !== 0) {
        fail(
          "preventure_research_decision_incomplete",
          `Validated early stop cannot close: ${readiness.completionBlockers.join(" ")}`,
        );
      }
      const outcomeBlockers = Array.isArray(readiness.outcomeBlockers?.research_more)
        ? readiness.outcomeBlockers.research_more
        : [];
      if (outcomeBlockers.length > 0) {
        fail(
          "preventure_research_outcome_unproven",
          `The retained stop cannot support research_more: ${outcomeBlockers.join(" ")}`,
        );
      }
      const truth = ledgerTruth(stoppedLedger, { cutoff: stoppedAt });
      if (truth.unknownProviderOutcomeCount || truth.unknownCostCount) {
        fail(
          "preventure_research_unknown_truth",
          "A validated early stop cannot seal unknown provider or cost truth.",
        );
      }
      const sourceHeads = latestHeads(
        stoppedLedger.sourceSnapshots,
        (source) => source.snapshotHash,
        (source) => source.supersedesSnapshotHash,
      ).filter((source) => ["captured", "partial"].includes(source.captureStatus));
      const evidenceHeads = latestHeads(
        stoppedLedger.evidenceRecords,
        (evidence) => evidence.evidenceHash,
        (evidence) => evidence.supersedesEvidenceHash,
      );
      const comparator = deriveComparatorCoverage(authority, evidenceHeads, sourceHeads);
      const contraryEvidence = evidenceHeads
        .filter((evidence) => evidence.polarity === "contrary")
        .map((evidence) => ({ id: evidence.id, status: "retained" }))
        .sort((left, right) => left.id.localeCompare(right.id));
      const derived = {
        outcome: "research_more",
        completionMode: "validated_early_stop",
        earlyStopRecordHash: stopRecord.earlyStopRecordHash,
        skippedAssignmentRecordHashes: stopRecord.skippedAssignments
          .map((item) => item.skipRecordHash)
          .sort(),
        nextEvidenceAction: stopRecord.nextEvidenceAction,
        decidedAt: stoppedAt,
        comparatorCount: comparator.comparatorIds.length,
        comparatorIds: comparator.comparatorIds,
        comparatorCoverage: comparator.comparatorCoverage,
        estimatedInternalAiCostAudCents: truth.estimatedInternalAiCostAudCents,
        reconciledInternalAiCostAudCents: truth.reconciledInternalAiCostAudCents,
        exactBillingPending: truth.exactBillingPending,
        externalCommercialSpendAudCents: 0,
        provenanceComplete: true,
        unknownProviderOutcomeCount: 0,
        unknownCostCount: 0,
        evidenceSetHash: stopRecord.actualCoverage.evidenceSetHash,
        receiptSetHash: receiptSetHash(authorityHash, stoppedLedger, { cutoff: stoppedAt }),
        sourceIds: [...new Set(sourceHeads.map((source) => source.id))].sort(),
        contraryEvidence,
        nonOccurrenceRecord: {
          productBuilt: false,
          buyerContact: false,
          accountInspectedOrChanged: false,
          publishing: false,
          advertising: false,
          externalSpendAudCents: 0,
          orders: 0,
          revenueAudCents: 0,
          settledNetCashContribution: "not_settled",
        },
      };
      const sealed = sealDecisionAndCompletion(
        authority,
        decisionInput,
        derived,
        completionInput,
      );
      const finalLedger = readLedger(authorityHash);
      if (
        !sameCanonical(finalLedger.terminalStopRecord, stopRecord)
        || !sameCanonical(finalLedger.assignmentSkips, stopRecord.skippedAssignments)
        || finalLedger.decision?.decisionHash !== sealed.decision.decisionHash
      ) {
        fail(
          "preventure_research_ledger_integrity_failed",
          "The validated stop, skipped suffix, decision, and completion did not seal atomically.",
        );
      }
      return {
        ...sealed,
        stopRecord: finalLedger.terminalStopRecord,
        skippedAssignments: finalLedger.assignmentSkips,
      };
      });
    });
  }

  function recordDecision(authorityHash, decisionInput = {}, completionInput = {}) {
    return atomic(() => {
      const authority = requireAuthority(authorityHash);
      const ledger = readLedger(authorityHash);
      if (ledger.decision) {
        if (!decisionInput.id || !decisionInput.version) {
          fail(
            "preventure_research_decision_replay_incomplete",
            "Decision replay requires the exact prior decision ID and version.",
          );
        }
        for (const [key, value] of Object.entries(decisionInput)) {
          if (!sameCanonical(ledger.decision[key], value)) {
            fail("preventure_research_decision_conflict", `Decision replay changed ${key}.`);
          }
        }
        const completionEvent = ledger.lifecycle.find((event) => event.eventType === "completed");
        const completionComparisons = {
          id: completionEvent.id,
          occurredAt: completionEvent.occurredAt,
          actor: completionEvent.actor,
          reason: completionEvent.reason,
          metadata: completionEvent.metadata,
        };
        for (const [key, value] of Object.entries(completionInput)) {
          if (!sameCanonical(completionComparisons[key], value)) {
            fail("preventure_research_completion_mismatch", `Completion replay changed ${key}.`);
          }
        }
        return {
          created: false,
          decision: ledger.decision,
          completionEvent,
          resultingReadinessHash: preventureResultingReadinessHash(
            ledger.decision,
            authorityRegistry,
          ),
        };
      }
      if (
        lifecycleState(ledger.lifecycle) !== "activated"
        || Date.parse(timestamp(undefined, "Current time")) >= Date.parse(authority.expiresAt)
      ) {
        fail(
          "preventure_research_decision_not_authorized",
          "A decision requires activated, unexpired pre-venture research authority.",
        );
      }
      requireCandidateAuthority(authorityHash, "Diligence decision finalization");
      const readiness = evaluatePreventureResearchReadiness(ledger, ledger.state, {
        generatedAt: timestamp(decisionInput.decidedAt, "Diligence decision time"),
      });
      if (!readiness.canSealDecision || readiness.execution.dispatchableAssignmentCount !== 0) {
        fail(
          "preventure_research_decision_incomplete",
          `Diligence cannot close: ${readiness.completionBlockers.join(" ")}`,
        );
      }
      const outcomeBlockers = Array.isArray(readiness.outcomeBlockers?.[decisionInput.outcome])
        ? readiness.outcomeBlockers[decisionInput.outcome]
        : [];
      if (outcomeBlockers.length > 0) {
        fail(
          "preventure_research_outcome_unproven",
          `The retained evidence cannot support ${String(decisionInput.outcome)}: ${outcomeBlockers.join(" ")}`,
        );
      }
      if (decisionInput.outcome === "build" && !readiness.canRecommendBuild) {
        fail(
          "preventure_research_build_unproven",
          `A build recommendation is not evidence-ready: ${readiness.buildBlockers.join(" ")}`,
        );
      }
      if (ledger.assignments.length !== authority.assignments.length) {
        fail(
          "preventure_research_decision_incomplete",
          "Every exact approved assignment must be materialized before diligence closes.",
        );
      }
      const expectedAssignmentIds = authority.assignments.map((item) => item.id).sort();
      if (!sameCanonical(ledger.assignments.map((item) => item.id).sort(), expectedAssignmentIds)) {
        fail("preventure_research_decision_incomplete", "The exact assignment set is incomplete.");
      }
      const decisionCostHeads = latestCostHeads(ledger.costEvents);
      for (const assignment of ledger.assignments) {
        const attempts = ledger.executionEvidence.taskAttempts.filter(
          (item) => item.task_id === assignment.taskId,
        );
        const receipts = ledger.executionEvidence.agentRunReceipts.filter(
          (item) => item.task_id === assignment.taskId,
        );
        if (attempts.length !== 1 || receipts.length < 1 || attempts[0].status === "running") {
          fail(
            "preventure_research_decision_incomplete",
            `Assignment ${assignment.id} lacks one terminal provider attempt and immutable receipt.`,
          );
        }
        const costHead = decisionCostHeads.find(
          (cost) => cost.assignmentHash === assignment.assignmentHash,
        );
        if (!costHead) {
          fail("preventure_research_decision_incomplete", `Assignment ${assignment.id} lacks cost truth.`);
        }
        if (
          !costHead.taskAttemptId
          || !costHead.modelCallId
          || !costHead.agentRunReceiptId
          || !costHead.budgetReservationId
          || !costHead.costId
        ) {
          fail(
            "preventure_research_decision_incomplete",
            `Assignment ${assignment.id} cost truth is not bound to its exact attempt, model call, final receipt, monthly budget, and cost ledgers.`,
          );
        }
        assertLinkedExecution(assignment, costHead, {
          allowTechnicalTerminalReceipt: true,
        });
      }
      const truth = ledgerTruth(ledger);
      if (truth.unknownProviderOutcomeCount || truth.unknownCostCount) {
        fail(
          "preventure_research_unknown_truth",
          "Provider or cost truth is unknown; further dispatch and diligence completion are frozen.",
        );
      }
      if (
        truth.estimatedInternalAiCostAudCents + truth.reconciledInternalAiCostAudCents
        > authority.internalAiSpendCapAudCents
      ) {
        fail("preventure_research_cost_cap_exceeded", "Retained internal AI cost exceeds authority.");
      }
      const sourceHeads = latestHeads(
        ledger.sourceSnapshots,
        (source) => source.snapshotHash,
        (source) => source.supersedesSnapshotHash,
      ).filter((source) => ["captured", "partial"].includes(source.captureStatus));
      const evidenceHeads = latestHeads(
        ledger.evidenceRecords,
        (evidence) => evidence.evidenceHash,
        (evidence) => evidence.supersedesEvidenceHash,
      );
      const sourceIds = [...new Set(sourceHeads.map((source) => source.id))].sort();
      const comparator = deriveComparatorCoverage(authority, evidenceHeads, sourceHeads);
      const contraryEvidence = evidenceHeads
        .filter((evidence) => evidence.polarity === "contrary")
        .map((evidence) => ({ id: evidence.id, status: "retained" }))
        .sort((left, right) => left.id.localeCompare(right.id));
      const provenanceComplete = ledger.assignments.every((assignment) => {
        const assignmentSources = sourceHeads.filter(
          (source) => source.assignmentHash === assignment.assignmentHash,
        );
        return assignmentSources.length > 0 && assignmentSources.every((source) => (
          source.agentRunReceiptId
          && source.provenanceId
          && source.researchRunId
          && source.sourceRecordId
        ));
      }) && evidenceHeads.every((evidence) => (
        !["observed_fact", "model_inference"].includes(evidence.truthClass)
        || Boolean(evidence.sourceSnapshotHash)
      ));
      if (!provenanceComplete) {
        fail("preventure_research_provenance_incomplete", "All assignments require retained source provenance.");
      }
      assertDecisionEvidenceBacked(decisionInput, evidenceHeads);
      const derived = {
        comparatorCount: comparator.comparatorIds.length,
        comparatorIds: comparator.comparatorIds,
        comparatorCoverage: comparator.comparatorCoverage,
        estimatedInternalAiCostAudCents: readiness.budget.estimatedAudCents,
        reconciledInternalAiCostAudCents: readiness.budget.reconciledAudCents,
        exactBillingPending: readiness.budget.exactBillingPending,
        externalCommercialSpendAudCents: 0,
        provenanceComplete: true,
        unknownProviderOutcomeCount: 0,
        unknownCostCount: 0,
        evidenceSetHash: readiness.evidence.evidenceSetHash,
        receiptSetHash: readiness.evidence.receiptSetHash,
        sourceIds,
        contraryEvidence,
        nonOccurrenceRecord: {
          productBuilt: false,
          buyerContact: false,
          accountInspectedOrChanged: false,
          publishing: false,
          advertising: false,
          externalSpendAudCents: 0,
          orders: 0,
          revenueAudCents: 0,
          settledNetCashContribution: "not_settled",
        },
      };
      return sealDecisionAndCompletion(
        authority,
        decisionInput,
        derived,
        completionInput,
      );
    });
  }

  return Object.freeze({
    registerAuthority,
    getAuthority,
    listAuthorities,
    loadLifecycle,
    appendLifecycle,
    createAssignment,
    getAssignment,
    listAssignments,
    appendCostEvent,
    recordOwnerAttestedProviderBillingObservation,
    reconcileProviderCost,
    commitTerminalRetainedRecovery,
    recordSourceSnapshot,
    recordEvidence,
    withAtomicEvidenceBatch,
    recordValidatedEarlyStop,
    recordDecision,
    readLedger,
    readState,
    withRetainedOutputStore: (nextRetainedOutputStore) => createPreventureResearchStore(db, {
      authorityRegistry,
      clock,
      retainedOutputStore: nextRetainedOutputStore,
    }),
    verifyLedger: () => verifyPreventureResearchLedger(db, {
      authorityRegistry,
      retainedOutputStore,
    }),
  });
}

function verifyPreventureResearchLedger(db, options = {}) {
  const authorityRegistry = options.authorityRegistry
    || defaultPreventureResearchAuthorityRegistry;
  const result = { ok: true };
  assertExactHistoricalApprovalDecisionSet(db);
  for (const [name, table] of Object.entries(LEDGER_TABLES)) {
    result[name] = Number(db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count);
  }
  const authorityRows = db.prepare(
    "SELECT * FROM preventure_research_authorities ORDER BY created_at, authority_hash",
  ).all();
  const store = createPreventureResearchStore(db, {
    authorityRegistry,
    retainedOutputStore: options.retainedOutputStore || null,
    ...(options.artifactVerification === "structural"
      ? { structuralArtifactVerificationToken: STRUCTURAL_ARTIFACT_VERIFICATION_TOKEN }
      : {}),
  });
  for (const row of authorityRows) {
    const authority = readAuthorityRow(row, authorityRegistry);
    const ledger = store.readLedger(authority.authorityHash);
    const completed = ledger.lifecycle.find((event) => event.eventType === "completed");
    if (Boolean(completed) !== Boolean(ledger.decision)) {
      fail(
        "preventure_research_ledger_integrity_failed",
        "A completed lifecycle and its diligence decision must exist atomically.",
      );
    }
    const assignmentHashes = new Set(ledger.assignments.map((item) => item.assignmentHash));
    for (const cost of ledger.costEvents) {
      if (!assignmentHashes.has(cost.assignmentHash) || cost.authorityHash !== authority.authorityHash) {
        fail("preventure_research_ledger_integrity_failed", "Cost receipt escaped its assignment authority.");
      }
      const assignment = ledger.assignments.find((item) => item.assignmentHash === cost.assignmentHash);
      const billingObservation = cost.ownerBillingObservationHash
        ? ledger.ownerBillingObservations.find(
            (item) => item.observationHash === cost.ownerBillingObservationHash,
          )
        : null;
      const exactOwnerObservedOverage = Boolean(
        billingObservation
        && cost.eventType === "reconciled"
        && cost.amountAudCents === billingObservation.billingObservation.amountAudCents
        && cost.exposureAudCents === billingObservation.billingObservation.amountAudCents
        && sameCanonical(billingObservation.budgetComparison, {
          approvedAssignmentCapAudCents: assignment.maxCostAudCents,
          observedActualAudCents: cost.amountAudCents,
          breached: true,
          overageAudCents: cost.amountAudCents - assignment.maxCostAudCents,
        })
      );
      if (
        (
          cost.exposureAudCents > assignment.maxCostAudCents
          || (cost.amountAudCents !== null && cost.amountAudCents > assignment.maxCostAudCents)
        )
        && !exactOwnerObservedOverage
      ) fail("preventure_research_ledger_integrity_failed", "Cost receipt exceeds its assignment cap.");
    }
    const sourceHashes = new Set(ledger.sourceSnapshots.map((item) => item.snapshotHash));
    for (const source of ledger.sourceSnapshots) {
      if (!assignmentHashes.has(source.assignmentHash) || source.authorityHash !== authority.authorityHash) {
        fail("preventure_research_ledger_integrity_failed", "Source snapshot escaped its assignment authority.");
      }
      if (source.supersedesSnapshotHash && !sourceHashes.has(source.supersedesSnapshotHash)) {
        fail("preventure_research_ledger_integrity_failed", "Source supersession predecessor is missing.");
      }
    }
    const evidenceHashes = new Set(ledger.evidenceRecords.map((item) => item.evidenceHash));
    for (const evidence of ledger.evidenceRecords) {
      if (!assignmentHashes.has(evidence.assignmentHash) || evidence.authorityHash !== authority.authorityHash) {
        fail("preventure_research_ledger_integrity_failed", "Evidence escaped its assignment authority.");
      }
      if (evidence.sourceSnapshotHash && !sourceHashes.has(evidence.sourceSnapshotHash)) {
        fail("preventure_research_ledger_integrity_failed", "Evidence source snapshot is missing.");
      }
      if (evidence.supersedesEvidenceHash && !evidenceHashes.has(evidence.supersedesEvidenceHash)) {
        fail("preventure_research_ledger_integrity_failed", "Evidence supersession predecessor is missing.");
      }
    }
    if (ledger.decision) {
      const evidenceHeads = latestHeads(
        ledger.evidenceRecords,
        (evidence) => evidence.evidenceHash,
        (evidence) => evidence.supersedesEvidenceHash,
      );
      const sourceHeads = latestHeads(
        ledger.sourceSnapshots,
        (source) => source.snapshotHash,
        (source) => source.supersedesSnapshotHash,
      ).filter((source) => ["captured", "partial"].includes(source.captureStatus));
      const comparator = deriveComparatorCoverage(authority, evidenceHeads, sourceHeads);
      const contraryEvidence = evidenceHeads
        .filter((evidence) => evidence.polarity === "contrary")
        .map((evidence) => ({ id: evidence.id, status: "retained" }))
        .sort((left, right) => left.id.localeCompare(right.id));
      if (
        !sameCanonical(ledger.decision.comparatorIds, comparator.comparatorIds)
        || !sameCanonical(ledger.decision.comparatorCoverage, comparator.comparatorCoverage)
        || !sameCanonical(ledger.decision.sourceIds, [...new Set(sourceHeads.map((item) => item.id))].sort())
        || !sameCanonical(ledger.decision.contraryEvidence, contraryEvidence)
      ) {
        fail(
          "preventure_research_ledger_integrity_failed",
          "The diligence decision comparator, source, or contrary-evidence coverage is not ledger-derived.",
        );
      }
      if (ledger.decision.completionMode === "full_round") {
        assertDecisionEvidenceBacked(ledger.decision, evidenceHeads);
      }
    }
  }
  if (options.artifactVerification === "structural") {
    result.externalArtifactVerificationRequired = result.terminalRecoveries;
  }
  return result;
}

module.exports = {
  PREVENTURE_RESEARCH_ASSIGNMENT_SCHEMA,
  PREVENTURE_RESEARCH_COST_SCHEMA,
  PREVENTURE_RESEARCH_PROVIDER_COST_RECONCILIATION_SCHEMA,
  PREVENTURE_RESEARCH_EVIDENCE_SCHEMA,
  PREVENTURE_RESEARCH_SOURCE_SCHEMA,
  PreventureResearchStoreError,
  createPreventureResearchStore,
  evidenceSetHash,
  preventureResultingReadinessHash,
  receiptSetHash,
  verifyPreventureResearchLedger,
};
