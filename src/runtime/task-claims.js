const { all, fromJson, get, now, randomId, run, toJson } = require("../db");
const { environmentValue } = require("../adapters/pantheon-environment");

const DEFAULT_CLAIM_LEASE_MS = 10 * 60 * 1000;
const RUNNABLE_WORKFLOW_STATUSES = new Set(["planned", "ready", "agent_running", "agent_retrying"]);

function hydrateTask(task) {
  if (!task) return null;
  return { ...task, payload: fromJson(task.payload), result: fromJson(task.result) };
}

function claimLeaseMs(options = {}) {
  const configured = Number(options.leaseMs || environmentValue("taskClaimLeaseMs") || DEFAULT_CLAIM_LEASE_MS);
  return Math.min(60 * 60 * 1000, Math.max(5_000, Number.isFinite(configured) ? configured : DEFAULT_CLAIM_LEASE_MS));
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

function taskClaimLostError(claim, operation = "continuation") {
  const taskId = claim?.task?.id || "unknown-task";
  const error = new Error(`Task claim was lost before ${operation}: ${taskId}`);
  error.code = "task_claim_lost";
  error.taskId = taskId;
  error.attemptId = claim?.attemptId || null;
  return error;
}

function assertTaskClaimOwned(db, claim, operation = "continuation") {
  const owned = claim && get(
    db,
    `SELECT tasks.id
     FROM tasks
     JOIN task_attempts
       ON task_attempts.id = ?
      AND task_attempts.task_id = tasks.id
      AND task_attempts.claim_token = ?
      AND task_attempts.status = 'running'
     WHERE tasks.id = ?
       AND tasks.claim_token = ?`,
    [claim.attemptId, claim.claimToken, claim.task?.id, claim.claimToken],
  );
  if (!owned) throw taskClaimLostError(claim, operation);
  return true;
}

function assertTaskClaimActive(db, claim, operation = "continuation") {
  const active = claim && get(
    db,
    `SELECT tasks.id
     FROM tasks
     JOIN task_attempts
       ON task_attempts.id = ?
      AND task_attempts.task_id = tasks.id
      AND task_attempts.claim_token = ?
      AND task_attempts.status = 'running'
     WHERE tasks.id = ?
       AND tasks.claim_token = ?
       AND tasks.status = 'running'`,
    [claim.attemptId, claim.claimToken, claim.task?.id, claim.claimToken],
  );
  if (!active) throw taskClaimLostError(claim, operation);
  return true;
}

function isTaskClaimLostError(error) {
  return error?.code === "task_claim_lost";
}

function preventureGenericClaimError(taskId) {
  const error = new Error(
    "Pre-venture research can only run through its exact dedicated authority bridge.",
  );
  error.code = "preventure_research_generic_claim_forbidden";
  error.statusCode = 409;
  error.taskId = taskId || null;
  return error;
}

function assertGenericClaimTargetAllowed(db, options = {}) {
  if (!options.taskId && !options.workflowId) return;
  const params = [];
  const clauses = [];
  if (options.taskId) {
    clauses.push("id = ?");
    params.push(options.taskId);
  }
  if (options.workflowId) {
    clauses.push("workflow_id = ?");
    params.push(options.workflowId);
  }
  const protectedTask = get(
    db,
    `SELECT tasks.id FROM tasks
     WHERE (
       tasks.kind = 'preventure_research'
       OR EXISTS (
         SELECT 1 FROM preventure_research_assignments AS protected_assignment
         WHERE protected_assignment.task_id = tasks.id
       )
     )
       ${clauses.length ? `AND ${clauses.join(" AND ")}` : ""}
     LIMIT 1`,
    params,
  );
  if (protectedTask) throw preventureGenericClaimError(protectedTask.id);
}

function claimCandidateFilter(options = {}) {
  const filters = [];
  const params = [];
  if (options.workflowId) {
    filters.push("candidate.workflow_id = ?");
    params.push(options.workflowId);
  }
  if (options.taskId) {
    filters.push("candidate.id = ?");
    params.push(options.taskId);
  }
  return {
    clause: filters.length ? `AND ${filters.join(" AND ")}` : "",
    params,
  };
}

function claimCandidateQuery(projection, filterClause = "") {
  return `SELECT ${projection}
    FROM tasks AS candidate
    JOIN workflows AS workflow ON workflow.id = candidate.workflow_id
    WHERE candidate.status IN ('queued', 'planned') ${filterClause}
      AND candidate.kind <> 'preventure_research'
      AND NOT EXISTS (
        SELECT 1 FROM preventure_research_assignments AS protected_assignment
        WHERE protected_assignment.task_id = candidate.id
      )
      AND workflow.status IN ('planned', 'ready', 'agent_running', 'agent_retrying')
      AND NOT EXISTS (
        SELECT 1 FROM tasks AS earlier
        WHERE earlier.workflow_id = candidate.workflow_id
          AND earlier.id <> candidate.id
          AND earlier.status IN (
            'planned',
            'queued',
            'running',
            'blocked',
            'waiting_approval',
            'needs_attention'
          )
          AND NOT (
            CASE
              WHEN json_valid(candidate.payload)
              THEN json_extract(
                candidate.payload,
                '$.liveSpendRequest.parameters.pantheonProduction.planId'
              )
              ELSE NULL
            END IS NOT NULL
            AND CASE
              WHEN json_valid(earlier.payload)
              THEN json_extract(
                earlier.payload,
                '$.liveSpendRequest.parameters.pantheonProduction.planId'
              )
              ELSE NULL
            END = CASE
              WHEN json_valid(candidate.payload)
              THEN json_extract(
                candidate.payload,
                '$.liveSpendRequest.parameters.pantheonProduction.planId'
              )
              ELSE NULL
            END
            AND EXISTS (
              SELECT 1
              FROM catalogue_plans AS recovered_plan,
                   json_each(
                     recovered_plan.metadata,
                     '$.recoverySupersededTaskIds'
                   ) AS superseded
              WHERE recovered_plan.id = CASE
                WHEN json_valid(candidate.payload)
                THEN json_extract(
                  candidate.payload,
                  '$.liveSpendRequest.parameters.pantheonProduction.planId'
                )
                ELSE NULL
              END
                AND superseded.value = earlier.id
            )
          )
          AND (
            earlier.priority < candidate.priority
            OR (
              earlier.priority = candidate.priority
              AND earlier.created_at < candidate.created_at
            )
            OR (
              earlier.priority = candidate.priority
              AND earlier.created_at = candidate.created_at
              AND earlier.id < candidate.id
            )
          )
      )
    ORDER BY CASE candidate.status WHEN 'queued' THEN 0 ELSE 1 END,
             candidate.priority ASC,
             candidate.created_at ASC,
             candidate.id ASC
    LIMIT 1`;
}

function attemptMayHaveReachedProvider(attempt) {
  if (!attempt) return false;
  const metadata = fromJson(attempt.metadata, {});
  return Boolean(
    attempt.provider_request_id
      || attempt.provider_dispatched_at
      || attempt.provider_dispatch_model_call_id
      || ["provider_dispatched", "unknown", "known"].includes(attempt.outcome_status)
      || metadata.providerCallOccurred === true
      || metadata.dispatchIntent?.status === "dispatched"
      || metadata.providerReceipt,
  );
}

function recoverStaleTaskClaims(db, options = {}) {
  const leaseMs = claimLeaseMs(options);
  const staleBefore = new Date(Date.now() - leaseMs).toISOString();
  const stale = all(
    db,
    `SELECT tasks.*
     FROM tasks
     WHERE tasks.status = 'running'
       AND tasks.claim_token IS NOT NULL
       AND (tasks.claimed_at IS NULL OR tasks.claimed_at <= ?)
     ORDER BY tasks.claimed_at ASC`,
    [staleBefore],
  );
  if (!stale.length) return [];

  return withSavepoint(db, "recover_task_claims", () => {
    const recoveredAt = now();
    const recovered = [];
    for (const task of stale) {
      const attempt = get(
        db,
        "SELECT * FROM task_attempts WHERE task_id = ? AND claim_token = ? ORDER BY started_at DESC LIMIT 1",
        [task.id, task.claim_token],
      );
      const providerOutcomeUnknown = attemptMayHaveReachedProvider(attempt);
      const taskStatus = providerOutcomeUnknown ? "needs_attention" : "queued";
      const outcomeStatus = providerOutcomeUnknown ? "unknown" : "failed_before_effect";
      const errorKind = providerOutcomeUnknown ? "stale_provider_attempt" : "stale_claim_recovered";
      const error = providerOutcomeUnknown
        ? "The worker stopped responding after a provider request may have started. Review the provider outcome before retrying."
        : "The worker stopped before provider dispatch. Pantheon recovered the task for a safe retry.";
      const metadata = {
        ...fromJson(attempt?.metadata, {}),
        recovery: { recoveredAt, leaseMs, staleBefore, providerOutcomeUnknown },
      };

      const taskUpdate = run(
        db,
        `UPDATE tasks
         SET status = ?, claim_token = NULL, claimed_at = NULL, outcome_status = ?, error = ?, updated_at = ?
         WHERE id = ? AND claim_token = ? AND status = 'running'`,
        [taskStatus, outcomeStatus, error, recoveredAt, task.id, task.claim_token],
      );
      if (taskUpdate.changes !== 1) continue;

      if (attempt) {
        run(
          db,
          `UPDATE task_attempts
           SET status = ?, outcome_status = ?, error_kind = ?, error = ?, completed_at = ?, metadata = ?
           WHERE id = ? AND claim_token = ?`,
          [taskStatus, outcomeStatus, errorKind, error, recoveredAt, toJson(metadata), attempt.id, task.claim_token],
        );
      }

      if (providerOutcomeUnknown && task.workflow_id) {
        run(
          db,
          `UPDATE workflows
           SET status = 'needs_attention', current_step = ?, approval_required = 1, updated_at = ?
           WHERE id = ? AND status NOT IN ('cancelled', 'failed', 'needs_changes', 'ready_for_review', 'dry_run_complete')`,
          [`Review the unknown provider outcome for ${task.title}`, recoveredAt, task.workflow_id],
        );
      } else if (task.workflow_id) {
        run(
          db,
          `UPDATE workflows
           SET status = 'agent_retrying', current_step = ?, updated_at = ?
           WHERE id = ? AND status IN ('planned', 'ready', 'agent_running', 'agent_retrying')`,
          [`Recovered ${task.title} after an expired worker lease`, recoveredAt, task.workflow_id],
        );
      }
      recovered.push({ taskId: task.id, attemptId: attempt?.id || null, status: taskStatus, outcomeStatus });
    }
    return recovered;
  });
}

function claimNextTask(db, options = {}) {
  assertGenericClaimTargetAllowed(db, options);
  if (options.recoverStale !== false) recoverStaleTaskClaims(db, options);
  const token = `claim_${randomId()}`;
  const attemptId = `attempt_${randomId()}`;
  const claimedAt = now();
  const leaseMs = claimLeaseMs(options);
  const leaseExpiresAt = new Date(Date.parse(claimedAt) + leaseMs).toISOString();
  const filter = claimCandidateFilter(options);
  db.exec("BEGIN IMMEDIATE");
  try {
    const candidate = db.prepare(
      claimCandidateQuery("candidate.*", filter.clause),
    ).get(...filter.params);
    if (!candidate) {
      db.exec("COMMIT");
      return null;
    }
    let guardResult = null;
    if (typeof options.guard === "function") {
      guardResult = options.guard(candidate);
      if (!guardResult?.safe) {
        db.exec("COMMIT");
        return {
          guardBlocked: true,
          task: hydrateTask(candidate),
          guardResult,
        };
      }
    }
    const task = db.prepare(
      `UPDATE tasks
       SET status = 'running', claim_token = ?, claimed_at = ?, started_at = COALESCE(started_at, ?),
           attempt_count = attempt_count + 1, outcome_status = 'not_started', updated_at = ?
       WHERE id = ? AND status IN ('queued', 'planned')
         AND kind <> 'preventure_research'
         AND NOT EXISTS (
           SELECT 1 FROM preventure_research_assignments AS protected_assignment
           WHERE protected_assignment.task_id = tasks.id
         )
       RETURNING *`,
    ).get(token, claimedAt, claimedAt, claimedAt, candidate.id);
    if (!task) {
      db.exec("COMMIT");
      return null;
    }
    run(
      db,
      `INSERT INTO task_attempts
       (id, task_id, workflow_id, venture_id, claim_token, status, outcome_status, started_at, metadata)
       VALUES (?, ?, ?, ?, ?, 'running', 'not_started', ?, ?)`,
      [
        attemptId,
        task.id,
        task.workflow_id,
        task.venture_id,
        token,
        claimedAt,
        toJson({ claimant: options.claimant || "orchestrator", leaseMs, leaseExpiresAt }),
      ],
    );
    db.exec("COMMIT");
    return {
      task: hydrateTask(task),
      attemptId,
      claimToken: token,
      leaseMs,
      leaseExpiresAt,
      guardResult,
    };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function renewTaskClaim(db, claim, options = {}) {
  const renewedAt = now();
  const leaseMs = claimLeaseMs({ leaseMs: options.leaseMs || claim.leaseMs });
  const leaseExpiresAt = new Date(Date.parse(renewedAt) + leaseMs).toISOString();
  return withSavepoint(db, "renew_task_claim", () => {
    const currentAttempt = get(db, "SELECT metadata FROM task_attempts WHERE id = ? AND claim_token = ?", [claim.attemptId, claim.claimToken]);
    const result = run(
      db,
      "UPDATE tasks SET claimed_at = ?, updated_at = ? WHERE id = ? AND claim_token = ? AND status = 'running'",
      [renewedAt, renewedAt, claim.task.id, claim.claimToken],
    );
    if (result.changes !== 1) throw new Error(`Task claim was lost before renewal: ${claim.task.id}`);
    run(
      db,
      "UPDATE task_attempts SET metadata = ? WHERE id = ? AND claim_token = ? AND status = 'running'",
      [toJson({ ...fromJson(currentAttempt?.metadata, {}), leaseMs, leaseExpiresAt, renewedAt }), claim.attemptId, claim.claimToken],
    );
    return { renewedAt, leaseMs, leaseExpiresAt };
  });
}

function markTaskAttemptProviderDispatched(db, claim, options = {}) {
  const dispatchedAt = options.dispatchedAt || now();
  return withSavepoint(db, "mark_provider_dispatch", () => {
    const attempt = get(
      db,
      "SELECT metadata FROM task_attempts WHERE id = ? AND claim_token = ?",
      [claim.attemptId, claim.claimToken],
    );
    if (!attempt) throw new Error(`Task attempt was lost before provider dispatch: ${claim.attemptId}`);
    const metadata = {
      ...fromJson(attempt.metadata, {}),
      providerCallOccurred: true,
      dispatchIntent: {
        status: "dispatched",
        recordedAt: dispatchedAt,
        modelCallId: options.modelCallId || null,
        provider: options.provider || null,
        model: options.model || null,
        traceId: options.traceId || null,
      },
    };
    const taskUpdate = run(
      db,
      `UPDATE tasks
       SET outcome_status = 'provider_dispatched', claimed_at = ?, updated_at = ?
       WHERE id = ? AND claim_token = ? AND status = 'running'`,
      [dispatchedAt, dispatchedAt, claim.task.id, claim.claimToken],
    );
    if (taskUpdate.changes !== 1) throw new Error(`Task claim was lost before provider dispatch: ${claim.task.id}`);
    const attemptUpdate = run(
      db,
      `UPDATE task_attempts
       SET outcome_status = 'provider_dispatched', provider_dispatched_at = ?,
           provider_dispatch_model_call_id = ?, metadata = ?
       WHERE id = ? AND claim_token = ? AND status = 'running'`,
      [
        dispatchedAt,
        options.modelCallId || null,
        toJson(metadata),
        claim.attemptId,
        claim.claimToken,
      ],
    );
    if (attemptUpdate.changes !== 1) throw new Error(`Task attempt was lost before provider dispatch: ${claim.attemptId}`);
    return { dispatchedAt, modelCallId: options.modelCallId || null };
  });
}

function releaseTaskClaim(db, claim, status, options = {}) {
  return withSavepoint(db, "release_task_claim", () => {
    const resolvedAt = now();
    const currentAttempt = get(
      db,
      "SELECT metadata FROM task_attempts WHERE id = ? AND claim_token = ? AND status = 'running'",
      [claim.attemptId, claim.claimToken],
    );
    if (!currentAttempt) throw taskClaimLostError(claim, "release");
    const result = run(
      db,
      `UPDATE tasks
       SET status = ?, claim_token = NULL, claimed_at = NULL, outcome_status = ?,
           setup_block_reason = ?, error = COALESCE(?, error), updated_at = ?
       WHERE id = ? AND claim_token = ? AND status IN ('running', ?)`,
      [
        status,
        options.outcomeStatus || status,
        options.setupBlockReason || null,
        options.error || null,
        resolvedAt,
        claim.task.id,
        claim.claimToken,
        status,
      ],
    );
    if (result.changes !== 1) throw taskClaimLostError(claim, "release");
    const attempt = run(
      db,
      `UPDATE task_attempts
       SET status = ?, outcome_status = ?, provider_request_id = COALESCE(?, provider_request_id),
           error_kind = ?, error = ?, completed_at = ?, metadata = ?
       WHERE id = ? AND claim_token = ? AND status = 'running'`,
      [
        status,
        options.outcomeStatus || status,
        options.providerRequestId || null,
        options.errorKind || null,
        options.error || null,
        resolvedAt,
        toJson({ ...fromJson(currentAttempt?.metadata, {}), ...(options.metadata || {}) }),
        claim.attemptId,
        claim.claimToken,
      ],
    );
    if (attempt.changes !== 1) throw taskClaimLostError(claim, "attempt release");
    return true;
  });
}

function completeTaskClaim(db, claim, options = {}) {
  return withSavepoint(db, "complete_task_claim", () => {
    const completedAt = options.completedAt || now();
    const currentAttempt = get(
      db,
      "SELECT metadata FROM task_attempts WHERE id = ? AND claim_token = ? AND status = 'running'",
      [claim.attemptId, claim.claimToken],
    );
    if (!currentAttempt) throw taskClaimLostError(claim, "completion");
    const result = run(
      db,
      `UPDATE tasks
       SET status = ?, result = ?, cost_actual_cents = ?, error = ?, completed_at = ?,
           claim_token = NULL, claimed_at = NULL, outcome_status = ?, updated_at = ?
       WHERE id = ? AND claim_token = ? AND status IN ('running', ?)`,
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
        options.status || "completed",
      ],
    );
    if (result.changes !== 1) throw taskClaimLostError(claim, "completion");
    const attempt = run(
      db,
      `UPDATE task_attempts
       SET status = ?, outcome_status = ?, provider_request_id = ?, error_kind = ?, error = ?, completed_at = ?, metadata = ?
       WHERE id = ? AND claim_token = ? AND status = 'running'`,
      [
        options.status || "completed",
        options.outcomeStatus || "known",
        options.providerRequestId || null,
        options.errorKind || null,
        options.error || null,
        completedAt,
        toJson({ ...fromJson(currentAttempt?.metadata, {}), ...(options.metadata || {}) }),
        claim.attemptId,
        claim.claimToken,
      ],
    );
    if (attempt.changes !== 1) throw taskClaimLostError(claim, "attempt completion");
    return get(db, "SELECT * FROM tasks WHERE id = ?", [claim.task.id]);
  });
}

module.exports = {
  DEFAULT_CLAIM_LEASE_MS,
  RUNNABLE_WORKFLOW_STATUSES,
  assertTaskClaimActive,
  assertTaskClaimOwned,
  claimNextTask,
  completeTaskClaim,
  isTaskClaimLostError,
  markTaskAttemptProviderDispatched,
  recoverStaleTaskClaims,
  releaseTaskClaim,
  renewTaskClaim,
};
