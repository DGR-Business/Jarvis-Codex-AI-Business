"use strict";

const {
  fromJson,
  get,
  insertEvent,
  now,
  run,
  toJson,
  withPreventureOwnerApprovalCapability,
} = require("../db");
const {
  consumeAuthenticatedOwnerSessionAttestation,
} = require("./local-security");
const {
  PREVENTURE_RESEARCH_APPROVAL_SCOPE_SCHEMA,
  PREVENTURE_RESEARCH_APPROVAL_SCOPE_V2_SCHEMA,
  effectivePreventureLifecycleState,
  preventureResearchApprovalScope,
  preventureResearchApprovalScopeHash,
} = require("./preventure-research-contract");
const {
  createPreventureResearchStore,
} = require("./preventure-research-store");
const {
  validatePendingPreventureLifecycleApproval,
} = require("./preventure-research-owner-state");
const { sha256 } = require("./commercial-test-contract");

const APPROVAL_DECISION_RECEIPT_SCHEMA = "pantheon.preventure-research-approval-decision.v2";
const AUTHENTICATED_OWNER_SESSION_SOURCE = "authenticated_owner_session_attestation";
const PREVENTURE_RESEARCH_APPROVAL_SCOPE_SCHEMAS = new Set([
  PREVENTURE_RESEARCH_APPROVAL_SCOPE_SCHEMA,
  PREVENTURE_RESEARCH_APPROVAL_SCOPE_V2_SCHEMA,
]);

const DECISIONS = Object.freeze({
  approve: "approved",
  changes: "needs_changes",
  reject: "rejected",
});
const PRIOR_STATE = Object.freeze({ accepted: "proposed", activated: "accepted" });

let transactionSequence = 0;

function lifecycleError(code, message, statusCode = 409) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
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

function isPreventureApprovalScopeSchema(value) {
  return PREVENTURE_RESEARCH_APPROVAL_SCOPE_SCHEMAS.has(value);
}

function withImmediateTransaction(db, operation) {
  if (db.isTransaction) {
    const savepoint = `preventure_research_lifecycle_${++transactionSequence}`;
    db.exec(`SAVEPOINT ${savepoint}`);
    try {
      const result = operation();
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
    const result = operation();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function lifecycleScopeCandidates(payload) {
  return [
    payload.preventureResearchApprovalScope,
    payload.preventureLifecycleApprovalScope,
    payload.approvalScope,
    payload.scope,
  ].filter(isObject);
}

function hasPreventureLifecycleApprovalPayload(row, options = {}) {
  const payload = fromJson(row?.payload, {});
  const rowScope = parseObject(row?.scope);
  if (isPreventureApprovalScopeSchema(rowScope?.schema)) return true;
  if (lifecycleScopeCandidates(payload).some(
    (candidate) => isPreventureApprovalScopeSchema(candidate.schema),
  ) || [
    "preventureResearchApprovalScope",
    "preventureLifecycleApprovalScope",
  ].some((key) => Object.hasOwn(payload, key))) return true;
  let authorities = Array.isArray(options.authorities) ? options.authorities : [];
  if (isObject(options.authority)) authorities = [...authorities, options.authority];
  if (authorities.length === 0 && options.db) {
    try {
      const store = createPreventureResearchStore(options.db, options.storeOptions || {});
      authorities = store.listAuthorities();
    } catch {
      authorities = [];
    }
  }
  return authorities.some((authority) => (
    ["accepted", "activated"].some((eventType) => {
      try {
        return row?.scope_hash === preventureResearchApprovalScopeHash(authority, eventType);
      } catch {
        return false;
      }
    })
  ));
}

function exactScopeForApproval(row, store, expectedScopeHash) {
  const payload = fromJson(row.payload, {});
  const candidates = lifecycleScopeCandidates(payload);
  if (
    candidates.length === 0
    || candidates.some(
      (candidate) => !isPreventureApprovalScopeSchema(candidate.schema),
    )
  ) {
    throw lifecycleError(
      "preventure_research_lifecycle_scope_invalid",
      "This owner decision does not contain one valid pre-venture lifecycle scope.",
    );
  }
  const candidate = candidates[0];
  if (candidates.some((value) => !sameCanonical(value, candidate))) {
    throw lifecycleError(
      "preventure_research_lifecycle_scope_ambiguous",
      "This owner decision contains conflicting pre-venture scopes.",
    );
  }
  const eventType = candidate.eventType;
  if (!Object.hasOwn(PRIOR_STATE, eventType)) {
    throw lifecycleError(
      "preventure_research_lifecycle_transition_invalid",
      "The owner decision is not an exact acceptance or activation.",
    );
  }
  const authorityHash = candidate.authority?.hash;
  const authority = store.getAuthority(authorityHash);
  if (!authority) {
    throw lifecycleError(
      "preventure_research_authority_missing",
      "The immutable authority for this owner decision is unavailable.",
    );
  }
  const exactScope = preventureResearchApprovalScope(authority, eventType);
  const exactHash = preventureResearchApprovalScopeHash(authority, eventType);
  const scopeColumn = parseObject(row.scope);
  const assertedHashes = [
    payload.preventureResearchApprovalScopeHash,
    payload.preventureLifecycleApprovalScopeHash,
    payload.approvalScopeHash,
  ].filter((value) => value !== undefined);
  if (
    row.status === "pending"
    && !validatePendingPreventureLifecycleApproval(row, authority, eventType).valid
  ) {
    throw lifecycleError(
      "preventure_research_lifecycle_scope_changed",
      "Refresh this owner decision before acting; its exact authority, cap, provider, assignment set, expiry, or control envelope changed.",
    );
  }
  if (
    !sameCanonical(candidate, exactScope)
    || !scopeColumn
    || !sameCanonical(scopeColumn, exactScope)
    || row.scope_hash !== exactHash
    || expectedScopeHash !== exactHash
    || assertedHashes.length === 0
    || assertedHashes.some((value) => value !== exactHash)
    || row.expires_at !== authority.expiresAt
    || row.venture_id !== null
    || row.workflow_id !== null
    || row.task_id !== null
    || row.risk_level !== "high"
    || row.requested_by !== "jarvis"
    || row.title !== (eventType === "accepted"
      ? "Accept this exact bounded research authority?"
      : "Activate this exact bounded internal research round?")
    || !sameCanonical(fromJson(row.expected_effects, null), [])
    || (row.status === "pending" && (
      row.decided_at !== null
      || row.decided_by !== null
      || row.consumed_at !== null
    ))
  ) {
    throw lifecycleError(
      "preventure_research_lifecycle_scope_changed",
      "Refresh this owner decision before acting; its exact authority, cap, provider, assignment set, or expiry changed.",
    );
  }
  return { authority, eventType, exactScope, exactHash };
}

function createPreventureLifecycleApproval(
  db,
  authorityHash,
  eventType,
  options = {},
) {
  return withImmediateTransaction(db, () => {
    if (options.requestedBy && options.requestedBy !== "jarvis") {
      throw lifecycleError(
        "preventure_research_lifecycle_requester_invalid",
        "Only Jarvis may request this exact owner lifecycle decision.",
      );
    }
    const store = createPreventureResearchStore(db, options.storeOptions || {});
    store.verifyLedger();
    const authority = store.getAuthority(authorityHash);
    if (!authority) {
      throw lifecycleError(
        "preventure_research_authority_missing",
        "The immutable authority is unavailable.",
        404,
      );
    }
    if (!Object.hasOwn(PRIOR_STATE, eventType)) {
      throw lifecycleError(
        "preventure_research_lifecycle_transition_invalid",
        "Only acceptance or activation can request owner approval.",
        400,
      );
    }
    const lifecycle = store.loadLifecycle(authorityHash);
    const requestedAt = String(options.requestedAt || now());
    const state = effectivePreventureLifecycleState(authority, lifecycle, requestedAt);
    if (state !== PRIOR_STATE[eventType]) {
      throw lifecycleError(
        "preventure_research_lifecycle_transition_stale",
        `The authority is ${state}, not ${PRIOR_STATE[eventType]}.`,
      );
    }
    if (Date.parse(requestedAt) >= Date.parse(authority.expiresAt)) {
      throw lifecycleError(
        "preventure_research_authority_expired",
        "The fixed research authority expired before this decision request.",
      );
    }
    const scope = preventureResearchApprovalScope(authority, eventType);
    const scopeHash = preventureResearchApprovalScopeHash(authority, eventType);
    const pending = db.prepare(
      `SELECT * FROM approvals WHERE status = 'pending' AND scope_hash = ? ORDER BY requested_at, id`,
    ).all(scopeHash);
    if (pending.length > 1) {
      throw lifecycleError(
        "preventure_research_lifecycle_scope_ambiguous",
        "More than one pending owner decision exists for this exact lifecycle step.",
      );
    }
    if (pending.length === 1) {
      exactScopeForApproval(pending[0], store, scopeHash);
      return { created: false, approval: pending[0], scope, scopeHash };
    }
    const returnedForChanges = db.prepare(
      `SELECT id FROM approvals WHERE status = 'needs_changes' AND scope_hash = ? LIMIT 1`,
    ).get(scopeHash);
    if (returnedForChanges) {
      throw lifecycleError(
        "preventure_research_replacement_required",
        "The owner requested changes to this exact authority. Register a new immutable version instead of asking for the same scope again.",
      );
    }
    const approvalId = options.approvalId
      || `approval_preventure_${eventType}_${scopeHash.slice("sha256:".length, "sha256:".length + 24)}`;
    const title = eventType === "accepted"
      ? "Accept this exact bounded research authority?"
      : "Activate this exact bounded internal research round?";
    db.prepare(
      `INSERT INTO approvals
        (id, venture_id, workflow_id, task_id, scope, title, status, risk_level,
         requested_by, requested_at, payload, scope_hash, expires_at, expected_effects)
       VALUES (?, NULL, NULL, NULL, ?, ?, 'pending', 'high', ?, ?, ?, ?, ?, '[]')`,
    ).run(
      approvalId,
      toJson(scope),
      title,
      "jarvis",
      requestedAt,
      toJson({
        preventureResearchApprovalScope: scope,
        preventureResearchApprovalScopeHash: scopeHash,
      }),
      scopeHash,
      authority.expiresAt,
    );
    return {
      created: true,
      approval: get(db, "SELECT * FROM approvals WHERE id = ?", [approvalId]),
      scope,
      scopeHash,
    };
  });
}

function replayResult(db, approval, decisionStatus, details) {
  if (approval.status !== decisionStatus) {
    throw lifecycleError(
      "preventure_research_lifecycle_decision_already_recorded",
      "This owner decision was already resolved differently.",
    );
  }
  if (decisionStatus === "approved") {
    if (approval.decided_by !== "owner") {
      throw lifecycleError(
        "preventure_research_lifecycle_decision_incomplete",
        "The approved decision is missing durable owner identity.",
      );
    }
    const receipt = db.prepare(
      `SELECT decision_status, decision_source, decided_at
       FROM preventure_research_approval_decisions WHERE approval_id = ?`,
    ).get(approval.id);
    if (
      !receipt
      || receipt.decision_status !== decisionStatus
      || receipt.decision_source !== AUTHENTICATED_OWNER_SESSION_SOURCE
      || receipt.decided_at !== approval.decided_at
    ) {
      throw lifecycleError(
        "preventure_research_lifecycle_decision_incomplete",
        "The approved decision is missing its immutable owner-decision receipt.",
      );
    }
    const events = db.prepare(
      `SELECT event_type, authority_hash, approval_scope_hash
       FROM preventure_research_lifecycle_events WHERE approval_id = ?`,
    ).all(approval.id);
    if (
      events.length !== 1
      || events[0].event_type !== details.eventType
      || events[0].authority_hash !== details.authority.authorityHash
      || events[0].approval_scope_hash !== details.exactHash
      || approval.consumed_at === null
    ) {
      throw lifecycleError(
        "preventure_research_lifecycle_decision_incomplete",
        "The approved decision is missing its exact consumed lifecycle event.",
      );
    }
  }
  return {
    changed: false,
    approvalId: approval.id,
    decision: approval.status,
    lifecycleChanged: false,
    lifecycleStatus: decisionStatus === "approved" ? details.eventType : null,
  };
}

function decidePreventureLifecycleApproval(
  db,
  approvalId,
  decision,
  note = "",
  options = {},
) {
  const decidedAt = String(options.decidedAt || now());
  const decisionNoteHash = sha256(String(note || ""));
  try {
    consumeAuthenticatedOwnerSessionAttestation(
      options.ownerSessionAttestation,
      {
        approvalId,
        decidedAt,
        decision,
        decisionNoteHash,
        expectedScopeHash: options.expectedScopeHash,
      },
      db,
    );
  } catch (cause) {
    throw lifecycleError(
      "preventure_research_lifecycle_owner_session_required",
      String(cause?.message || "This protected lifecycle decision requires an authenticated local owner session."),
      403,
    );
  }
  const decisionStatus = DECISIONS[decision];
  if (!decisionStatus) {
    throw lifecycleError(
      "preventure_research_lifecycle_decision_invalid",
      "Decision must be approve, changes, or reject.",
      400,
    );
  }
  if (options.actor && options.actor !== "owner") {
    throw lifecycleError(
      "preventure_research_lifecycle_decider_invalid",
      "This protected lifecycle decision must be attributed to the owner.",
    );
  }
  if (typeof options.expectedScopeHash !== "string" || !options.expectedScopeHash) {
    throw lifecycleError(
      "preventure_research_lifecycle_scope_required",
      "Refresh this owner decision before acting; its exact scope is missing.",
    );
  }
  return withImmediateTransaction(db, () => {
    const store = createPreventureResearchStore(db, options.storeOptions || {});
    store.verifyLedger();
    const approval = get(db, "SELECT * FROM approvals WHERE id = ?", [approvalId]);
    if (!approval) {
      throw lifecycleError(
        "preventure_research_lifecycle_decision_not_found",
        "This pre-venture owner decision no longer exists.",
        404,
      );
    }
    const details = exactScopeForApproval(
      approval,
      store,
      options.expectedScopeHash,
    );
    if (approval.status !== "pending") {
      return replayResult(db, approval, decisionStatus, details);
    }
    if (approval.decided_at !== null || approval.consumed_at !== null) {
      throw lifecycleError(
        "preventure_research_lifecycle_decision_invalid",
        "This pending owner decision has inconsistent decision state.",
      );
    }
    if (
      !Number.isFinite(Date.parse(decidedAt))
      || Date.parse(decidedAt) >= Date.parse(details.authority.expiresAt)
    ) {
      throw lifecycleError(
        "preventure_research_lifecycle_decision_expired",
        "This exact research decision expired.",
      );
    }
    const lifecycle = store.loadLifecycle(details.authority.authorityHash);
    const state = effectivePreventureLifecycleState(
      details.authority,
      lifecycle,
      decidedAt,
    );
    if (state !== PRIOR_STATE[details.eventType]) {
      throw lifecycleError(
        "preventure_research_lifecycle_transition_stale",
        "The authority is no longer at the lifecycle step shown in this owner decision.",
      );
    }
    const receiptBody = {
      schema: APPROVAL_DECISION_RECEIPT_SCHEMA,
      approvalId: approval.id,
      authorityHash: details.authority.authorityHash,
      eventType: details.eventType,
      scopeHash: details.exactHash,
      priorPending: {
        status: approval.status,
        requestedBy: approval.requested_by,
        requestedAt: approval.requested_at,
        decidedAt: approval.decided_at,
        decidedBy: approval.decided_by ?? null,
        consumedAt: approval.consumed_at,
      },
      decisionStatus,
      decidedBy: "owner",
      decisionSource: AUTHENTICATED_OWNER_SESSION_SOURCE,
      decisionNoteHash,
      decidedAt,
    };
    const decisionReceipt = {
      ...receiptBody,
      receiptHash: sha256(receiptBody),
    };
    return withPreventureOwnerApprovalCapability(db, {
      approvalId: decisionReceipt.approvalId,
      authorityHash: decisionReceipt.authorityHash,
      eventType: decisionReceipt.eventType,
      scopeHash: decisionReceipt.scopeHash,
      decisionStatus: decisionReceipt.decisionStatus,
      decidedAt: decisionReceipt.decidedAt,
      receiptHash: decisionReceipt.receiptHash,
    }, () => {
      const updated = run(
        db,
        `UPDATE approvals SET status = ?, decided_at = ?, decision_note = ?, decided_by = 'owner'
         WHERE id = ? AND status = 'pending' AND decided_at IS NULL AND consumed_at IS NULL`,
        [decisionStatus, decidedAt, note, approval.id],
      );
      if (updated.changes !== 1) {
        throw lifecycleError(
          "preventure_research_lifecycle_decision_concurrent",
          "This owner decision was resolved concurrently.",
        );
      }
      db.prepare(
        `INSERT INTO preventure_research_approval_decisions
         (decision_receipt_hash, approval_id, authority_hash, event_type, scope_hash,
          requested_by, requested_at, decided_by, decision_source,
          decision_status, decided_at, receipt_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        decisionReceipt.receiptHash,
        decisionReceipt.approvalId,
        decisionReceipt.authorityHash,
        decisionReceipt.eventType,
        decisionReceipt.scopeHash,
        decisionReceipt.priorPending.requestedBy,
        decisionReceipt.priorPending.requestedAt,
        decisionReceipt.decidedBy,
        decisionReceipt.decisionSource,
        decisionReceipt.decisionStatus,
        decisionReceipt.decidedAt,
        toJson(decisionReceipt),
        decisionReceipt.decidedAt,
      );

      let lifecycleChanged = false;
      let lifecycleStatus = null;
      if (decisionStatus === "approved") {
        const appended = store.appendLifecycle(details.authority.authorityHash, {
          id: `preventure_lifecycle_${details.eventType}_${approval.id}`,
          eventType: details.eventType,
          approvalId: approval.id,
          approvalScope: details.exactScope,
          occurredAt: decidedAt,
          actor: options.actor || "owner",
          reason: note || `The owner approved the exact ${details.eventType} research step.`,
          metadata: {},
        });
        lifecycleChanged = appended.created;
        lifecycleStatus = details.eventType;
      } else if (decisionStatus === "rejected") {
        const appended = store.appendLifecycle(details.authority.authorityHash, {
          id: `preventure_lifecycle_revoked_${approval.id}`,
          eventType: "revoked",
          occurredAt: decidedAt,
          actor: options.actor || "owner",
          reason: note || "The owner declined this exact bounded research authority.",
          metadata: {
            decisionApprovalId: approval.id,
            decisionScopeHash: details.exactHash,
          },
        });
        lifecycleChanged = appended.created;
        lifecycleStatus = "revoked";
      }

      run(
        db,
        `UPDATE approval_action_tokens
         SET status = 'superseded', used_at = COALESCE(used_at, ?)
         WHERE approval_id = ? AND status = 'active'`,
        [decidedAt, approval.id],
      );
      insertEvent(db, {
        level: decisionStatus === "approved" ? "info" : "warn",
        actor: String(options.actor || "operator"),
        type: `preventure_research_lifecycle.${decisionStatus}`,
        entityType: "approval",
        entityId: approval.id,
        message: decisionStatus === "approved"
          ? `The owner approved the exact ${details.eventType} bounded research step.`
          : "The owner resolved the bounded research decision without widening authority.",
        metadata: { decision: decisionStatus, lifecycleChanged, lifecycleStatus },
      });
      return {
        changed: true,
        approvalId: approval.id,
        decision: decisionStatus,
        lifecycleChanged,
        lifecycleStatus,
      };
    });
  });
}

module.exports = {
  createPreventureLifecycleApproval,
  decidePreventureLifecycleApproval,
  hasPreventureLifecycleApprovalPayload,
};
