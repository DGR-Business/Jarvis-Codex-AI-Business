const { fromJson, get, now, randomId, run, toJson } = require("../db");

function hydrateTask(task) {
  if (!task) return null;
  return { ...task, payload: fromJson(task.payload), result: fromJson(task.result) };
}

function claimNextTask(db, options = {}) {
  const token = `claim_${randomId()}`;
  const attemptId = `attempt_${randomId()}`;
  const claimedAt = now();
  const workflowClause = options.workflowId ? "AND workflow_id = ?" : "";
  const params = [token, claimedAt, claimedAt];
  if (options.workflowId) params.push(options.workflowId);
  db.exec("BEGIN IMMEDIATE");
  try {
    const task = db.prepare(
      `UPDATE tasks
       SET status = 'running', claim_token = ?, claimed_at = ?, started_at = COALESCE(started_at, ?),
           attempt_count = attempt_count + 1, outcome_status = 'not_started', updated_at = ?
       WHERE id = (
         SELECT id FROM tasks
         WHERE status IN ('queued', 'planned') ${workflowClause}
         ORDER BY CASE status WHEN 'queued' THEN 0 ELSE 1 END, priority ASC, created_at ASC
         LIMIT 1
       ) AND status IN ('queued', 'planned')
       RETURNING *`,
    ).get(...[...params.slice(0, 3), claimedAt, ...params.slice(3)]);
    if (!task) {
      db.exec("COMMIT");
      return null;
    }
    run(
      db,
      `INSERT INTO task_attempts
       (id, task_id, workflow_id, venture_id, claim_token, status, outcome_status, started_at, metadata)
       VALUES (?, ?, ?, ?, ?, 'running', 'not_started', ?, ?)`,
      [attemptId, task.id, task.workflow_id, task.venture_id, token, claimedAt, toJson({ claimant: options.claimant || "orchestrator" })],
    );
    db.exec("COMMIT");
    return { task: hydrateTask(task), attemptId, claimToken: token };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function releaseTaskClaim(db, claim, status, options = {}) {
  const resolvedAt = now();
  const result = run(
    db,
    `UPDATE tasks
     SET status = ?, claim_token = NULL, claimed_at = NULL, outcome_status = ?,
         setup_block_reason = ?, error = COALESCE(?, error), updated_at = ?
     WHERE id = ? AND claim_token = ?`,
    [status, options.outcomeStatus || status, options.setupBlockReason || null, options.error || null, resolvedAt, claim.task.id, claim.claimToken],
  );
  run(
    db,
    `UPDATE task_attempts
     SET status = ?, outcome_status = ?, error_kind = ?, error = ?, completed_at = ?, metadata = ?
     WHERE id = ? AND claim_token = ?`,
    [status, options.outcomeStatus || status, options.errorKind || null, options.error || null, resolvedAt, toJson(options.metadata), claim.attemptId, claim.claimToken],
  );
  return result.changes === 1;
}

function completeTaskClaim(db, claim, options = {}) {
  const completedAt = options.completedAt || now();
  const result = run(
    db,
    `UPDATE tasks
     SET status = ?, result = ?, cost_actual_cents = ?, error = ?, completed_at = ?,
         claim_token = NULL, claimed_at = NULL, outcome_status = ?, updated_at = ?
     WHERE id = ? AND claim_token = ?`,
    [
      options.status || "completed",
      toJson(options.result),
      Number(options.reconciledCostCents || 0),
      options.error || null,
      completedAt,
      options.outcomeStatus || "known",
      completedAt,
      claim.task.id,
      claim.claimToken,
    ],
  );
  if (result.changes !== 1) throw new Error(`Task claim was lost before completion: ${claim.task.id}`);
  run(
    db,
    `UPDATE task_attempts
     SET status = ?, outcome_status = ?, provider_request_id = ?, error_kind = ?, error = ?, completed_at = ?, metadata = ?
     WHERE id = ? AND claim_token = ?`,
    [
      options.status || "completed",
      options.outcomeStatus || "known",
      options.providerRequestId || null,
      options.errorKind || null,
      options.error || null,
      completedAt,
      toJson(options.metadata),
      claim.attemptId,
      claim.claimToken,
    ],
  );
  return get(db, "SELECT * FROM tasks WHERE id = ?", [claim.task.id]);
}

module.exports = {
  claimNextTask,
  completeTaskClaim,
  releaseTaskClaim,
};
