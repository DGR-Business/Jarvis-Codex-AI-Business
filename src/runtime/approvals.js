const { fromJson, get, insertEvent, now, run, toJson } = require("../db");
const { resolveAgentToolApproval } = require("./agent-tool-gate");
const { ensureApprovalScope, validateApprovalScope } = require("./approval-scope");

const DECISIONS = new Set(["approved", "rejected", "needs_changes"]);

function decideApproval(db, approvalId, decision, note = "", options = {}) {
  if (!DECISIONS.has(decision)) {
    const allowed = Array.from(DECISIONS).join(", ");
    throw new Error(`Invalid approval decision. Use one of: ${allowed}.`);
  }

  let approval = get(db, "SELECT * FROM approvals WHERE id = ?", [approvalId]);
  if (!approval) throw new Error(`Approval not found: ${approvalId}`);
  approval = ensureApprovalScope(db, approvalId).approval;
  const validation = validateApprovalScope(db, approvalId, null, options.expectedScopeHash);
  if (!validation.valid) throw new Error(validation.reason);
  if (approval.status !== "pending") return { approval, changed: false };

  const ts = now();
  run(
    db,
    `UPDATE approvals SET status = ?, decided_at = ?, decision_note = ? WHERE id = ?`,
    [decision, ts, note, approvalId],
  );

  if (decision === "approved") {
    run(
      db,
      `UPDATE tasks
       SET status = 'queued', result = ?, updated_at = ?
       WHERE approval_id = ? AND status IN ('blocked', 'waiting_approval')`,
      [toJson({ approvedAt: ts, approvalId }), ts, approvalId],
    );
    run(
      db,
      `UPDATE workflows
       SET status = 'ready', current_step = 'queued safe execution', updated_at = ?
       WHERE id = ?`,
      [ts, approval.workflow_id],
    );
  } else {
    run(
      db,
      `UPDATE tasks
       SET status = ?, error = ?, updated_at = ?
       WHERE approval_id = ? AND status IN ('blocked', 'waiting_approval', 'queued')`,
      [decision === "rejected" ? "cancelled" : "needs_changes", note || decision, ts, approvalId],
    );
    run(
      db,
      `UPDATE workflows
       SET status = ?, current_step = ?, updated_at = ?
       WHERE id = ?`,
      [decision === "rejected" ? "cancelled" : "needs_changes", decision, ts, approval.workflow_id],
    );
  }

  run(
    db,
    `UPDATE messages
     SET status = 'resolved', resolved_at = ?
     WHERE task_id IN (SELECT id FROM tasks WHERE approval_id = ?) AND status = 'open'`,
    [ts, approvalId],
  );
  run(
    db,
    `UPDATE approval_action_tokens
     SET status = 'superseded', used_at = COALESCE(used_at, ?)
     WHERE approval_id = ? AND status = 'active'`,
    [ts, approvalId],
  );

  const toolApproval = resolveAgentToolApproval(db, approval, decision, note, { decidedAt: ts });

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
    approval: get(db, "SELECT * FROM approvals WHERE id = ?", [approvalId]),
    toolApproval,
    changed: true,
  };
}

function decideApprovalByToken(db, token, note = "") {
  const action = get(db, "SELECT * FROM approval_action_tokens WHERE token = ?", [token]);
  if (!action) throw new Error("Approval action token not found.");

  const approval = get(db, "SELECT * FROM approvals WHERE id = ?", [action.approval_id]);
  if (!approval) throw new Error(`Approval not found: ${action.approval_id}`);

  if (action.status !== "active") {
    return {
      approval,
      action: { ...action, metadata: fromJson(action.metadata) },
      changed: false,
    };
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

  const result = decideApproval(db, action.approval_id, action.decision, note || "Approval action link used.");
  const usedAt = now();
  const metadata = {
    ...fromJson(action.metadata),
    usedVia: "approval_action_token",
    note,
    decisionChangedApproval: result.changed,
  };
  run(
    db,
    `UPDATE approval_action_tokens SET status = ?, used_at = ?, metadata = ? WHERE id = ?`,
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
}

module.exports = {
  decideApproval,
  decideApprovalByToken,
};
