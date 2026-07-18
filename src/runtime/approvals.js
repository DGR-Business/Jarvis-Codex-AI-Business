const { all, fromJson, get, insertEvent, now, randomId, run, toJson } = require("../db");
const {
  TOOL_APPROVAL_SCOPE_SCHEMA,
  resolveAgentToolApproval,
  validateAgentToolApprovalScope,
} = require("./agent-tool-gate");
const { ensureApprovalScope, persistApprovalScope, validateApprovalScope } = require("./approval-scope");
const { isReviewedRetryableErrorKind } = require("./live-ai-retry-policy");

const DECISIONS = new Set(["approved", "rejected", "needs_changes"]);

function approvalConflict(reason) {
  const error = new Error(reason);
  error.statusCode = 409;
  error.code = "approval_refresh_required";
  return error;
}

function withSavepoint(db, prefix, operation) {
  const name = `${prefix}_${randomId().replace(/[^a-zA-Z0-9]/g, "")}`;
  db.exec(`SAVEPOINT ${name}`);
  try {
    const value = operation();
    db.exec(`RELEASE SAVEPOINT ${name}`);
    return value;
  } catch (error) {
    db.exec(`ROLLBACK TO SAVEPOINT ${name}`);
    db.exec(`RELEASE SAVEPOINT ${name}`);
    throw error;
  }
}

function parsedApproval(row) {
  return row ? { ...row, payload: fromJson(row.payload, {}) } : null;
}

function isExactToolApproval(approval) {
  return approval?.payload?.scopeSchema === TOOL_APPROVAL_SCOPE_SCHEMA;
}

function isLegacyInternalDryRun(db, approval) {
  const task = approval.task_id
    ? get(db, "SELECT * FROM tasks WHERE id = ?", [approval.task_id])
    : get(db, "SELECT * FROM tasks WHERE approval_id = ? ORDER BY created_at, id LIMIT 1", [approval.id]);
  const taskPayload = fromJson(task?.payload, {});
  const expectedEffects = fromJson(approval.expected_effects, []);
  return Boolean(
    task
      && approval.payload?.noExternalPublish === true
      && ["publish_digital_product_dry_run", "publish_gelato_dry_run"].includes(task.kind)
      && taskPayload.mode === "dry-run"
      && taskPayload.liveSpendRequest?.requested !== true
      && Number(task.cost_budget_cents || 0) === 0
      && expectedEffects.length === 0,
  );
}

function validateDecisionScope(db, approval, options) {
  if (isExactToolApproval(approval)) {
    return validateAgentToolApprovalScope(db, approval, {}, options.expectedScopeHash || null);
  }
  let ensured = ensureApprovalScope(db, approval.id);
  if (!ensured.persisted && isLegacyInternalDryRun(db, approval)) {
    persistApprovalScope(db, approval.id);
    ensured = ensureApprovalScope(db, approval.id);
  }
  const validation = validateApprovalScope(db, approval.id, null, options.expectedScopeHash);
  return validation.valid ? { ...validation, approval: ensured.approval } : validation;
}

function decisionTaskIds(db, approval) {
  const exactTaskId = approval.task_id || approval.payload?.taskId || null;
  if (exactTaskId) return [exactTaskId];
  return all(
    db,
    "SELECT id FROM tasks WHERE approval_id = ? ORDER BY priority, created_at, id",
    [approval.id],
  ).map((task) => task.id);
}

function closeReviewedRetryPredecessor(db, taskId, approval, ts) {
  const task = get(db, "SELECT payload FROM tasks WHERE id = ?", [taskId]);
  const retry = fromJson(task?.payload, {})?.liveSpendRequest?.parameters?.retry;
  if (
    retry?.operatorAuthorized !== true
    || !retry.priorTaskId
    || approval.task_id !== taskId
  ) {
    return null;
  }
  const prior = get(
    db,
    "SELECT id, status, outcome_status, error FROM tasks WHERE id = ?",
    [retry.priorTaskId],
  );
  if (
    !prior
    || prior.status !== "needs_attention"
    || prior.outcome_status !== "known_provider_result_needs_review"
  ) {
    return null;
  }
  const latestAttempt = get(
    db,
    "SELECT error_kind FROM task_attempts WHERE task_id = ? ORDER BY started_at DESC, id DESC LIMIT 1",
    [prior.id],
  );
  if (!isReviewedRetryableErrorKind(latestAttempt?.error_kind)) {
    return null;
  }
  run(
    db,
    `UPDATE tasks
     SET status = 'failed', updated_at = ?
     WHERE id = ? AND status = 'needs_attention'
       AND outcome_status = 'known_provider_result_needs_review'`,
    [ts, prior.id],
  );
  run(
    db,
    `UPDATE messages
     SET status = 'resolved', resolved_at = COALESCE(resolved_at, ?)
     WHERE task_id = ? AND status = 'open'`,
    [ts, prior.id],
  );
  insertEvent(db, {
    level: "info",
    actor: "operator",
    type: "task.reviewed_failure_closed_for_retry",
    entityType: "task",
    entityId: prior.id,
    message: "The reviewed unusable provider result was closed as a failed attempt when its exact retry was approved.",
    metadata: {
      retryTaskId: taskId,
      retryApprovalId: approval.id,
      outcomeStatus: prior.outcome_status,
      errorKind: latestAttempt.error_kind,
      priorError: prior.error || null,
    },
  });
  return prior.id;
}

function updateApprovedWork(db, approval, ts) {
  const taskIds = decisionTaskIds(db, approval);
  for (const taskId of taskIds) {
    const queued = run(
      db,
      `UPDATE tasks
       SET status = 'queued', result = ?, updated_at = ?
       WHERE id = ? AND approval_id = ? AND status IN ('blocked', 'waiting_approval')`,
      [toJson({ approvedAt: ts, approvalId: approval.id }), ts, taskId, approval.id],
    );
    if (queued.changes === 1) closeReviewedRetryPredecessor(db, taskId, approval, ts);
  }
  if (approval.workflow_id) {
    run(
      db,
      `UPDATE workflows
       SET status = 'ready', current_step = 'Approved work is ready to run', updated_at = ?
       WHERE id = ? AND status NOT IN ('cancelled', 'failed')`,
      [ts, approval.workflow_id],
    );
  }
  return taskIds.filter((taskId) => {
    const task = get(db, "SELECT status FROM tasks WHERE id = ?", [taskId]);
    return ["queued", "planned"].includes(task?.status);
  });
}

function stopWorkflowAfterDecision(db, approval, decision, note, ts) {
  const taskStatus = decision === "rejected" ? "cancelled" : "needs_changes";
  const error = note || (decision === "rejected" ? "Denied by operator" : "Operator requested changes");
  if (approval.workflow_id) {
    run(
      db,
      `UPDATE tasks
       SET status = ?, error = ?, claim_token = CASE WHEN status = 'running' THEN claim_token ELSE NULL END,
           claimed_at = CASE WHEN status = 'running' THEN claimed_at ELSE NULL END, updated_at = ?
       WHERE workflow_id = ?
         AND status IN ('planned', 'queued', 'blocked', 'waiting_approval', 'needs_attention', 'needs_changes')`,
      [taskStatus, error, ts, approval.workflow_id],
    );
    run(
      db,
      `UPDATE workflows
       SET status = ?, current_step = ?, approval_required = 0, updated_at = ?
       WHERE id = ?`,
      [taskStatus, decision === "rejected" ? "Stopped by operator" : "Changes requested by operator", ts, approval.workflow_id],
    );
    run(
      db,
      "UPDATE commands SET status = ?, updated_at = ? WHERE workflow_id = ? AND status NOT IN ('completed', 'archived')",
      [taskStatus, ts, approval.workflow_id],
    );
  } else {
    for (const taskId of decisionTaskIds(db, approval)) {
      run(
        db,
        `UPDATE tasks SET status = ?, error = ?, updated_at = ?
         WHERE id = ? AND status IN ('planned', 'queued', 'blocked', 'waiting_approval', 'needs_attention', 'needs_changes')`,
        [taskStatus, error, ts, taskId],
      );
    }
  }
}

function decideApproval(db, approvalId, decision, note = "", options = {}) {
  if (!DECISIONS.has(decision)) {
    const allowed = Array.from(DECISIONS).join(", ");
    throw new Error(`Invalid approval decision. Use one of: ${allowed}.`);
  }

  return withSavepoint(db, "decide_approval", () => {
    let approval = parsedApproval(get(db, "SELECT * FROM approvals WHERE id = ?", [approvalId]));
    if (!approval) throw new Error(`Approval not found: ${approvalId}`);
    const validation = validateDecisionScope(db, approval, options);
    if (!validation.valid) throw approvalConflict(validation.reason);
    approval = parsedApproval(get(db, "SELECT * FROM approvals WHERE id = ?", [approvalId]));
    if (approval.status !== "pending") return { approval, changed: false };

    const ts = now();
    const decided = run(
      db,
      "UPDATE approvals SET status = ?, decided_at = ?, decision_note = ? WHERE id = ? AND status = 'pending'",
      [decision, ts, note, approvalId],
    );
    if (decided.changes !== 1) throw new Error("The approval was decided by another action.");

    const approvedTaskIds = decision === "approved"
      ? updateApprovedWork(db, approval, ts)
      : (stopWorkflowAfterDecision(db, approval, decision, note, ts), []);

    run(
      db,
      `UPDATE messages
       SET status = 'resolved', resolved_at = ?
       WHERE task_id IN (SELECT id FROM tasks WHERE workflow_id = ? OR approval_id = ?) AND status = 'open'`,
      [ts, approval.workflow_id || "", approvalId],
    );
    if (options.preserveActionTokenId) {
      run(
        db,
        `UPDATE approval_action_tokens
         SET status = 'superseded', used_at = COALESCE(used_at, ?)
         WHERE approval_id = ? AND status = 'active' AND id <> ?`,
        [ts, approvalId, options.preserveActionTokenId],
      );
    } else {
      run(
        db,
        `UPDATE approval_action_tokens
         SET status = 'superseded', used_at = COALESCE(used_at, ?)
         WHERE approval_id = ? AND status = 'active'`,
        [ts, approvalId],
      );
    }

    const decidedApproval = parsedApproval(get(db, "SELECT * FROM approvals WHERE id = ?", [approvalId]));
    const toolApproval = resolveAgentToolApproval(db, decidedApproval, decision, note, {
      decidedAt: ts,
      expectedScopeHash: options.expectedScopeHash || null,
    });
    if (isExactToolApproval(approval) && !toolApproval.handled) {
      throw new Error(toolApproval.reason || "The exact worker-tool approval could not be resolved.");
    }

    insertEvent(db, {
      level: decision === "approved" ? "info" : "warn",
      actor: "operator",
      type: `approval.${decision}`,
      entityType: "approval",
      entityId: approvalId,
      message: `Operator marked approval ${approvalId} as ${decision}.`,
      metadata: { note, toolApproval: toolApproval.handled ? toolApproval : null },
    });

    return {
      approval: parsedApproval(get(db, "SELECT * FROM approvals WHERE id = ?", [approvalId])),
      approvedTaskIds,
      toolApproval,
      changed: true,
    };
  });
}

function decideApprovalByToken(db, token, note = "") {
  return withSavepoint(db, "decide_approval_token", () => {
    const action = get(db, "SELECT * FROM approval_action_tokens WHERE token = ?", [token]);
    if (!action) throw new Error("Approval action token not found.");

    const approval = get(db, "SELECT * FROM approvals WHERE id = ?", [action.approval_id]);
    if (!approval) throw new Error(`Approval not found: ${action.approval_id}`);
    if (action.status !== "active") {
      return { approval, action: { ...action, metadata: fromJson(action.metadata) }, changed: false };
    }

    if (Date.parse(action.expires_at) <= Date.now()) {
      const expiredAt = now();
      run(db, "UPDATE approval_action_tokens SET status = 'expired', used_at = ? WHERE id = ?", [expiredAt, action.id]);
      insertEvent(db, {
        level: "warn",
        actor: "approval-action",
        type: "approval_action.expired",
        entityType: "approval",
        entityId: action.approval_id,
        message: `Expired approval action token was used for approval ${action.approval_id}.`,
      });
      throw new Error("Approval action token expired. Use the dashboard approval controls.");
    }

    const result = decideApproval(db, action.approval_id, action.decision, note || "Approval action link used.", {
      preserveActionTokenId: action.id,
    });
    const usedAt = now();
    const metadata = {
      ...fromJson(action.metadata),
      usedVia: "approval_action_token",
      note,
      decisionChangedApproval: result.changed,
    };
    run(
      db,
      "UPDATE approval_action_tokens SET status = ?, used_at = ?, metadata = ? WHERE id = ? AND status = 'active'",
      [result.changed ? "used" : "superseded", usedAt, toJson(metadata), action.id],
    );

    insertEvent(db, {
      level: result.changed ? "info" : "warn",
      actor: "approval-action",
      type: result.changed ? "approval_action.used" : "approval_action.ignored",
      entityType: "approval",
      entityId: action.approval_id,
      message: result.changed
        ? `Approval action token marked approval ${action.approval_id} as ${action.decision}.`
        : `Approval action token was ignored because approval ${action.approval_id} was already decided.`,
      metadata: { tokenId: action.id, decision: action.decision },
    });

    return {
      approval: get(db, "SELECT * FROM approvals WHERE id = ?", [action.approval_id]),
      action: { ...get(db, "SELECT * FROM approval_action_tokens WHERE id = ?", [action.id]), metadata },
      changed: result.changed,
    };
  });
}

module.exports = {
  decideApproval,
  decideApprovalByToken,
};
