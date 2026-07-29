"use strict";

const {
  fromJson,
  get,
  insertEvent,
  now,
  run,
} = require("../db");
const {
  COMMERCIAL_LIFECYCLE_APPROVAL_SCOPE_SCHEMA,
  commercialLifecycleApprovalScope,
  commercialLifecycleApprovalScopeHash,
} = require("./commercial-authority");
const {
  createCommercialTestStore,
} = require("./commercial-test-store");

const DECISIONS = Object.freeze({
  approve: "approved",
  changes: "needs_changes",
  reject: "rejected",
});
const LIFECYCLE_TRANSITIONS = Object.freeze({
  proposed: "accepted",
  accepted: "activated",
  paused: "accepted",
});

let transactionSequence = 0;

function lifecycleDecisionError(statusCode, code, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
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

function parsedPayload(row) {
  return fromJson(row?.payload, {});
}

function lifecycleScopeCandidates(payload) {
  return [
    payload.commercialTestApprovalScope,
    payload.commercialLifecycleApprovalScope,
    payload.approvalScope,
    payload.scope,
  ].filter(isObject);
}

function hasCommercialLifecycleApprovalPayload(row) {
  const payload = parsedPayload(row);
  return lifecycleScopeCandidates(payload).some(
    (candidate) => candidate.schema === COMMERCIAL_LIFECYCLE_APPROVAL_SCOPE_SCHEMA,
  ) || [
    "commercialTestApprovalScope",
    "commercialLifecycleApprovalScope",
  ].some((key) => Object.hasOwn(payload, key));
}

function exactScopeForApproval(row, store, expectedScopeHash) {
  const payload = parsedPayload(row);
  const candidates = lifecycleScopeCandidates(payload);
  if (
    candidates.length === 0
    || candidates.some(
      (candidate) => candidate.schema !== COMMERCIAL_LIFECYCLE_APPROVAL_SCOPE_SCHEMA,
    )
  ) {
    throw lifecycleDecisionError(
      409,
      "commercial_lifecycle_scope_invalid",
      "This commercial decision does not contain one valid lifecycle scope.",
    );
  }
  const candidate = candidates[0];
  if (candidates.some((value) => !sameCanonical(value, candidate))) {
    throw lifecycleDecisionError(
      409,
      "commercial_lifecycle_scope_ambiguous",
      "This commercial decision contains conflicting lifecycle scopes.",
    );
  }
  if (!["accepted", "activated"].includes(candidate.eventType)) {
    throw lifecycleDecisionError(
      409,
      "commercial_lifecycle_transition_invalid",
      "This commercial decision does not name an allowed lifecycle transition.",
    );
  }
  const contract = store.getContract(candidate.decisionHash);
  if (!contract) {
    throw lifecycleDecisionError(
      409,
      "commercial_contract_missing",
      "The exact commercial contract for this decision is unavailable.",
    );
  }
  const exactScope = commercialLifecycleApprovalScope(
    contract,
    candidate.eventType,
  );
  const exactHash = commercialLifecycleApprovalScopeHash(
    contract,
    candidate.eventType,
  );
  if (
    !sameCanonical(candidate, exactScope)
    || row.scope_hash !== exactHash
    || expectedScopeHash !== exactHash
  ) {
    throw lifecycleDecisionError(
      409,
      "commercial_lifecycle_scope_changed",
      "Refresh this commercial decision before acting; its exact scope does not match.",
    );
  }
  const assertedHashes = [
    payload.commercialTestApprovalScopeHash,
    payload.commercialLifecycleApprovalScopeHash,
    payload.approvalScopeHash,
  ].filter((value) => value !== undefined);
  if (assertedHashes.some((value) => value !== exactHash)) {
    throw lifecycleDecisionError(
      409,
      "commercial_lifecycle_scope_changed",
      "Refresh this commercial decision before acting; its stored scope hash does not match.",
    );
  }
  const scopeColumn = String(row.scope || "").trim();
  if (scopeColumn.startsWith("{")) {
    let parsed;
    try {
      parsed = JSON.parse(scopeColumn);
    } catch {
      parsed = null;
    }
    if (!parsed || !sameCanonical(parsed, exactScope)) {
      throw lifecycleDecisionError(
        409,
        "commercial_lifecycle_scope_changed",
        "Refresh this commercial decision before acting; its stored scope does not match.",
      );
    }
  } else if (scopeColumn !== `commercial_test_${candidate.eventType}`) {
    throw lifecycleDecisionError(
      409,
      "commercial_lifecycle_scope_changed",
      "Refresh this commercial decision before acting; its lifecycle action does not match.",
    );
  }
  return {
    contract,
    eventType: candidate.eventType,
    exactHash,
    exactScope,
  };
}

function withImmediateTransaction(db, operation) {
  if (db.isTransaction) {
    transactionSequence += 1;
    const savepoint = `commercial_lifecycle_decision_${transactionSequence}`;
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

function replayResult(db, approval, decisionStatus, details) {
  if (approval.status !== decisionStatus) {
    throw lifecycleDecisionError(
      409,
      "commercial_lifecycle_decision_already_recorded",
      "This commercial decision was already resolved differently.",
    );
  }
  if (decisionStatus !== "approved") {
    return {
      changed: false,
      approvalId: approval.id,
      decision: approval.status,
      lifecycleChanged: false,
      lifecycleStatus: null,
    };
  }
  const events = db.prepare(
    `SELECT event_type, decision_hash, approval_scope_hash
     FROM commercial_test_lifecycle_events
     WHERE approval_id = ?`,
  ).all(approval.id);
  if (
    events.length !== 1
    || events[0].event_type !== details.eventType
    || events[0].decision_hash !== details.contract.decisionHash
    || events[0].approval_scope_hash !== details.exactHash
  ) {
    throw lifecycleDecisionError(
      409,
      "commercial_lifecycle_decision_incomplete",
      "This decision is marked approved but its exact lifecycle event is missing or inconsistent.",
    );
  }
  return {
    changed: false,
    approvalId: approval.id,
    decision: approval.status,
    lifecycleChanged: false,
    lifecycleStatus: details.eventType,
  };
}

function decideCommercialLifecycleApproval(
  db,
  approvalId,
  decision,
  note = "",
  options = {},
) {
  const decisionStatus = DECISIONS[decision];
  if (!decisionStatus) {
    throw lifecycleDecisionError(
      400,
      "commercial_lifecycle_decision_invalid",
      "Decision must be approve, changes, or reject.",
    );
  }
  if (
    typeof options.expectedScopeHash !== "string"
    || options.expectedScopeHash.trim() === ""
  ) {
    throw lifecycleDecisionError(
      409,
      "commercial_lifecycle_scope_required",
      "Refresh this commercial decision before acting; its exact scope is missing.",
    );
  }

  return withImmediateTransaction(db, () => {
    const store = createCommercialTestStore(db, options.storeOptions || {});
    const approval = get(
      db,
      "SELECT * FROM approvals WHERE id = ?",
      [approvalId],
    );
    if (!approval) {
      throw lifecycleDecisionError(
        404,
        "commercial_lifecycle_decision_not_found",
        "This commercial lifecycle decision no longer exists.",
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
      throw lifecycleDecisionError(
        409,
        "commercial_lifecycle_decision_invalid",
        "This pending commercial decision has inconsistent decision state.",
      );
    }
    if (
      approval.expires_at
      && (
        Number.isNaN(Date.parse(approval.expires_at))
        || Date.parse(approval.expires_at) <= Date.now()
      )
    ) {
      throw lifecycleDecisionError(
        409,
        "commercial_lifecycle_decision_expired",
        "This commercial decision has expired. Prepare and review a fresh exact decision.",
      );
    }

    const ledger = store.readLedger(details.contract.decisionHash);
    const expectedEventType = LIFECYCLE_TRANSITIONS[ledger.state];
    if (decisionStatus === "approved" && expectedEventType !== details.eventType) {
      throw lifecycleDecisionError(
        409,
        "commercial_lifecycle_transition_invalid",
        "The commercial test is no longer at the lifecycle step shown in this decision.",
      );
    }

    const decidedAt = now();
    const updated = run(
      db,
      `UPDATE approvals
       SET status = ?, decided_at = ?, decision_note = ?
       WHERE id = ? AND status = 'pending'
         AND decided_at IS NULL AND consumed_at IS NULL`,
      [decisionStatus, decidedAt, note, approval.id],
    );
    if (updated.changes !== 1) {
      throw lifecycleDecisionError(
        409,
        "commercial_lifecycle_decision_concurrent",
        "This commercial decision was resolved by another action.",
      );
    }

    let lifecycleChanged = false;
    let lifecycleStatus = null;
    if (decisionStatus === "approved") {
      store.appendLifecycle(details.contract.decisionHash, {
        eventId: `commercial-lifecycle-${approval.id}`,
        eventType: details.eventType,
        approvalId: approval.id,
        approvalScope: details.exactScope,
        reason: note || `The owner approved the exact ${details.eventType} lifecycle step.`,
        occurredAt: decidedAt,
      });
      const consumed = run(
        db,
        `UPDATE approvals
         SET consumed_at = ?
         WHERE id = ? AND status = 'approved' AND consumed_at IS NULL`,
        [decidedAt, approval.id],
      );
      if (consumed.changes !== 1) {
        throw lifecycleDecisionError(
          409,
          "commercial_lifecycle_decision_concurrent",
          "The approved lifecycle decision could not be consumed exactly once.",
        );
      }
      lifecycleChanged = true;
      lifecycleStatus = details.eventType;
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
      type: `commercial_lifecycle.${decisionStatus}`,
      entityType: "approval",
      entityId: approval.id,
      message: decisionStatus === "approved"
        ? `The owner approved the exact ${details.eventType} commercial lifecycle step.`
        : "The owner resolved the commercial lifecycle decision without advancing the test.",
      metadata: {
        decision: decisionStatus,
        lifecycleChanged,
        lifecycleStatus,
      },
    });
    return {
      changed: true,
      approvalId: approval.id,
      decision: decisionStatus,
      lifecycleChanged,
      lifecycleStatus,
    };
  });
}

module.exports = {
  decideCommercialLifecycleApproval,
  hasCommercialLifecycleApprovalPayload,
};
