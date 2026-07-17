const CONFIG = require("../config");
const { runMonitorCycle } = require("./monitor");
const { runOnce } = require("./orchestrator");
const { generateWeeklyDigest } = require("./executive-digest");
const { all, fromJson, get, insertEvent, now, randomId, run, toJson } = require("../db");

const DEFAULT_LEASE_SECONDS = 30 * 60;
const SAFE_WORKFLOW_MODES = new Set(["plan_only", "run_protected", "protected", "dry_run", "dry-run"]);
const TERMINAL_WORKFLOW_STATES = new Set([
  "ready_for_review",
  "dry_run_complete",
  "blocked_for_approval",
  "failed",
  "cancelled",
  "needs_changes",
  "needs_attention",
]);

const DEFAULT_JOBS = [
  {
    id: "job-monitor-cycle",
    name: "Runtime monitor cycle",
    kind: "monitor_cycle",
    status: "enabled",
    intervalSeconds: 15 * 60,
    priority: 1,
    metadata: {
      purpose: "Check approvals, urgent messages, stuck work, budget pressure, and integration readiness.",
      dryRunSafe: true,
      leaseSeconds: 15 * 60,
    },
  },
  {
    id: "job-weekly-executive-digest",
    name: "Weekly executive brief",
    kind: "weekly_executive_digest",
    status: "enabled",
    intervalSeconds: 7 * 24 * 60 * 60,
    priority: 2,
    metadata: {
      purpose: "Refresh one concise weekly business brief without creating an operator interruption.",
      internalOnly: true,
      leaseSeconds: 15 * 60,
    },
  },
  {
    id: "job-safe-work-loop",
    name: "Safe dry-run work loop",
    kind: "safe_work_loop",
    status: "disabled",
    intervalSeconds: 5 * 60,
    priority: 3,
    metadata: {
      purpose: "Run queued protected internal work until blocked, ready for review, idle, or the step limit.",
      maxSteps: 5,
      dryRunOnly: true,
      leaseSeconds: 30 * 60,
      enableWhen: "Operator approves narrow autopilot for protected internal work.",
    },
  },
];

function parseJob(row) {
  if (!row) return null;
  return { ...row, metadata: fromJson(row.metadata) };
}

function parseRun(row) {
  if (!row) return null;
  return { ...row, result: fromJson(row.result), metadata: fromJson(row.metadata) };
}

function nextRunAt(job, base = now()) {
  const intervalSeconds = Math.max(60, Number(job.interval_seconds || job.intervalSeconds || 900));
  return new Date(Date.parse(base) + intervalSeconds * 1000).toISOString();
}

function leaseSecondsFor(job, options = {}) {
  return Math.max(60, Number(options.leaseSeconds || job?.metadata?.leaseSeconds || DEFAULT_LEASE_SECONDS));
}

function leaseCutoff(referenceTime, leaseSeconds) {
  return new Date(Date.parse(referenceTime) - leaseSeconds * 1000).toISOString();
}

function ensureSchedulerJobs(db) {
  const ts = now();
  for (const job of DEFAULT_JOBS) {
    run(
      db,
      `INSERT INTO scheduler_jobs
       (id, name, kind, status, interval_seconds, priority, next_run_at, metadata, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         kind = excluded.kind,
         interval_seconds = excluded.interval_seconds,
         priority = excluded.priority,
         metadata = excluded.metadata,
         updated_at = excluded.updated_at`,
      [
        job.id,
        job.name,
        job.kind,
        job.status,
        job.intervalSeconds,
        job.priority,
        job.status === "enabled" ? ts : null,
        toJson(job.metadata),
        ts,
        ts,
      ],
    );
  }
}

function listSchedulerJobs(db) {
  ensureSchedulerJobs(db);
  return all(db, "SELECT * FROM scheduler_jobs ORDER BY priority ASC, name ASC").map(parseJob);
}

function listSchedulerRuns(db, limit = 80) {
  return all(db, "SELECT * FROM scheduler_runs ORDER BY started_at DESC LIMIT ?", [limit]).map(parseRun);
}

function setSchedulerJobStatus(db, jobId, status) {
  if (!["enabled", "disabled"].includes(status)) throw new Error("Scheduler job status must be enabled or disabled.");
  ensureSchedulerJobs(db);
  const job = parseJob(get(db, "SELECT * FROM scheduler_jobs WHERE id = ?", [jobId]));
  if (!job) throw new Error(`Scheduler job not found: ${jobId}`);
  const ts = now();
  run(
    db,
    `UPDATE scheduler_jobs
     SET status = ?, next_run_at = ?, updated_at = ?
     WHERE id = ?`,
    [status, status === "enabled" ? ts : null, ts, jobId],
  );
  insertEvent(db, {
    level: status === "enabled" ? "warn" : "info",
    actor: "scheduler",
    type: `scheduler.job.${status}`,
    entityType: "scheduler_job",
    entityId: jobId,
    message: `Scheduler job ${job.name} was ${status}.`,
  });
  return parseJob(get(db, "SELECT * FROM scheduler_jobs WHERE id = ?", [jobId]));
}

function recoverExpiredSchedulerLocks(db, options = {}) {
  ensureSchedulerJobs(db);
  const recoveredAt = options.recoveredAt || now();
  db.exec("BEGIN IMMEDIATE");
  try {
    const locked = all(
      db,
      `SELECT * FROM scheduler_jobs
       WHERE locked_at IS NOT NULL`,
    );
    const expired = locked.filter((row) => {
      const job = parseJob(row);
      const cutoff = leaseCutoff(recoveredAt, leaseSecondsFor(job, options));
      return !Number.isFinite(Date.parse(job.locked_at)) || job.locked_at <= cutoff;
    });
    for (const job of expired) {
      if (job.lock_owner) {
        run(
          db,
          `UPDATE scheduler_runs
           SET status = 'abandoned', completed_at = ?, error = ?
           WHERE id = ? AND status = 'running'`,
          [recoveredAt, "Scheduler lease expired before the job completed.", job.lock_owner],
        );
      }
      run(
        db,
        `UPDATE scheduler_jobs
         SET locked_at = NULL, lock_owner = NULL, updated_at = ?
         WHERE id = ? AND lock_owner IS ?`,
        [recoveredAt, job.id, job.lock_owner],
      );
    }
    db.exec("COMMIT");
    return expired.map((job) => ({ jobId: job.id, abandonedRunId: job.lock_owner || null }));
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function dueSchedulerJobs(db, options = {}) {
  ensureSchedulerJobs(db);
  const dueAt = options.dueAt || now();
  recoverExpiredSchedulerLocks(db, {
    recoveredAt: dueAt,
    leaseSeconds: options.leaseSeconds,
  });
  const limit = Math.max(1, Math.min(Number(options.limit || CONFIG.schedulerMaxJobsPerTick || 2), 10));
  return all(
    db,
    `SELECT * FROM scheduler_jobs
     WHERE status = 'enabled'
       AND locked_at IS NULL
       AND (next_run_at IS NULL OR next_run_at <= ?)
     ORDER BY priority ASC, next_run_at ASC
     LIMIT ?`,
    [dueAt, limit],
  ).map(parseJob);
}

function unsafeTaskReason(task) {
  const kind = String(task.kind || "").toLowerCase();
  const payload = fromJson(task.payload);
  if (task.approval_id) return "approval_bound_task";
  if (/(^|_)live($|_)|provider|spend|payment|purchase|account_creation|customer_contact|legal_agreement/.test(kind)) {
    return "live_or_external_task";
  }
  if (kind.includes("publish") && !kind.includes("dry_run")) return "publishing_task";
  if (payload.liveSpendRequest || payload.requiresRuntimeCapability) return "provider_or_spend_request";
  if (String(payload.researchMode || "").toLowerCase() === "live") return "live_research_request";
  if ([payload.mode, payload.executionMode, payload.actionMode].some((value) => String(value || "").toLowerCase() === "live")) {
    return "live_execution_mode";
  }
  const requestedTools = payload.requestedTools || payload.tools || payload.sdkCapabilities?.tools;
  if (Array.isArray(requestedTools) && requestedTools.length) return "tool_using_task";
  const effects = payload.externalEffects || payload.expectedEffects;
  if (Array.isArray(effects) && effects.length) return "external_effects";
  return null;
}

function inspectSafeWorkflow(db, workflowId) {
  const workflowRow = get(db, "SELECT * FROM workflows WHERE id = ?", [workflowId]);
  if (!workflowRow) return { safe: false, reason: "workflow_missing", workflow: null, tasks: [] };
  const workflow = { ...workflowRow, metadata: fromJson(workflowRow.metadata) };
  const runner = workflow.metadata.agentRunner || {};
  const mode = String(runner.mode || "").toLowerCase();
  if (!SAFE_WORKFLOW_MODES.has(mode) || runner.liveModels !== false || runner.liveTools !== false) {
    return { safe: false, reason: "workflow_not_explicitly_protected", workflow, tasks: [] };
  }
  const tasks = all(
    db,
    `SELECT * FROM tasks
     WHERE workflow_id = ?
       AND status IN ('planned', 'queued', 'blocked', 'running', 'waiting_approval', 'needs_attention')
     ORDER BY priority ASC, created_at ASC, id ASC`,
    [workflowId],
  );
  for (const task of tasks) {
    if (!["planned", "queued"].includes(task.status)) {
      return { safe: false, reason: `task_not_runnable:${task.status}`, workflow, tasks, unsafeTask: task };
    }
    const reason = unsafeTaskReason(task);
    if (reason) return { safe: false, reason, workflow, tasks, unsafeTask: task };
  }
  const providerCall = get(
    db,
    `SELECT id FROM model_calls
     WHERE workflow_id = ?
       AND status <> 'not_called'
       AND mode NOT IN ('dry-run', 'dry_run', 'protected')
     LIMIT 1`,
    [workflowId],
  );
  if (providerCall) return { safe: false, reason: "workflow_contains_provider_execution", workflow, tasks };
  return { safe: true, reason: null, workflow, tasks };
}

function findSafeWorkCandidate(db) {
  const workflows = all(
    db,
    `SELECT DISTINCT workflows.*
     FROM workflows
     JOIN tasks ON tasks.workflow_id = workflows.id
     WHERE tasks.status IN ('planned', 'queued')
       AND workflows.status IN ('planned', 'agent_running', 'agent_retrying')
     ORDER BY workflows.priority ASC, workflows.updated_at ASC`,
  );
  for (const workflow of workflows) {
    if (inspectSafeWorkflow(db, workflow.id).safe) return workflow.id;
  }
  return null;
}

function finishSafeWorkflowRun(db, runId, payload) {
  const completedAt = now();
  run(
    db,
    `UPDATE workflow_runs
     SET status = ?, stopped_by = ?, steps_run = ?, completed_at = ?, metadata = ?
     WHERE id = ?`,
    [
      payload.status,
      payload.stoppedBy,
      payload.stepsRun,
      completedAt,
      toJson({
        workflow: payload.workflow,
        stepStatuses: payload.steps.map((step) => step.status),
        safetyReason: payload.safetyReason || null,
      }),
      runId,
    ],
  );
  insertEvent(db, {
    level: payload.status === "safety_blocked" ? "warn" : "info",
    actor: "scheduler",
    type: "workflow_run.completed",
    entityType: "workflow_run",
    entityId: runId,
    message: `Scheduled protected work stopped with status ${payload.status} after ${payload.stepsRun} step${payload.stepsRun === 1 ? "" : "s"}.`,
    metadata: { workflowId: payload.workflow?.id || null, stoppedBy: payload.stoppedBy, safetyReason: payload.safetyReason || null },
  });
  return { ...payload, runId, completedAt };
}

async function runProtectedWorkflow(db, workflowId, options = {}) {
  const maxSteps = Math.max(1, Math.min(Number(options.maxSteps || 5), 20));
  const runId = `run_${randomId()}`;
  const startedAt = now();
  const steps = [];
  run(
    db,
    `INSERT INTO workflow_runs (id, workflow_id, mode, status, steps_run, started_at, metadata)
     VALUES (?, ?, 'scheduled_safe_loop', 'running', 0, ?, ?)`,
    [runId, workflowId, startedAt, toJson({ maxSteps, schedulerRunId: options.schedulerRunId || null })],
  );

  for (let index = 0; index < maxSteps; index += 1) {
    const inspection = inspectSafeWorkflow(db, workflowId);
    if (!inspection.safe) {
      return finishSafeWorkflowRun(db, runId, {
        status: "safety_blocked",
        stoppedBy: "safety_policy",
        safetyReason: inspection.reason,
        steps,
        stepsRun: steps.length,
        workflow: inspection.workflow,
        result: null,
      });
    }
    if (!inspection.tasks.length) {
      const workflow = get(db, "SELECT id, status, current_step FROM workflows WHERE id = ?", [workflowId]);
      return finishSafeWorkflowRun(db, runId, {
        status: workflow?.status || "idle",
        stoppedBy: "no_runnable_tasks",
        steps,
        stepsRun: steps.length,
        workflow,
        result: steps.at(-1) || null,
      });
    }

    const task = inspection.tasks[0];
    const result = await runOnce(db, {
      workflowId,
      taskId: task.id,
      claimant: "scheduler-safe-work",
    });
    steps.push(result);
    const workflow = get(db, "SELECT id, status, current_step FROM workflows WHERE id = ?", [workflowId]);
    if (!["completed", "queued"].includes(result.status) || TERMINAL_WORKFLOW_STATES.has(workflow?.status)) {
      return finishSafeWorkflowRun(db, runId, {
        status: workflow?.status || result.status,
        stoppedBy: result.status,
        steps,
        stepsRun: steps.length,
        workflow,
        result,
      });
    }
  }

  const workflow = get(db, "SELECT id, status, current_step FROM workflows WHERE id = ?", [workflowId]);
  return finishSafeWorkflowRun(db, runId, {
    status: "step_limit",
    stoppedBy: "max_steps",
    steps,
    stepsRun: steps.length,
    workflow,
    result: steps.at(-1) || null,
  });
}

async function executeSchedulerJob(db, job, options = {}) {
  if (job.kind === "monitor_cycle") {
    const result = runMonitorCycle(db, job.metadata.options || {});
    return {
      kind: job.kind,
      monitorRunId: result.id,
      status: result.status,
      severity: result.severity,
      findingCount: result.findingCount,
    };
  }

  if (job.kind === "safe_work_loop") {
    const workflowId = options.workflowId || job.metadata.workflowId || findSafeWorkCandidate(db);
    if (!workflowId) {
      return {
        kind: job.kind,
        status: "idle",
        message: "No protected internal workflow is eligible for scheduled work.",
      };
    }
    const inspection = inspectSafeWorkflow(db, workflowId);
    if (!inspection.safe) {
      return {
        kind: job.kind,
        status: "safety_blocked",
        workflowId,
        reason: inspection.reason,
        message: "Scheduled work stopped because this workflow is not strictly internal and protected.",
      };
    }
    const maxSteps = Math.max(1, Math.min(Number(options.maxSteps || job.metadata.maxSteps || 5), 20));
    const result = await runProtectedWorkflow(db, workflowId, {
      maxSteps,
      schedulerRunId: options.schedulerRunId,
    });
    return {
      kind: job.kind,
      status: result.status,
      workflowId,
      workflowRunId: result.runId,
      stoppedBy: result.stoppedBy,
      stepsRun: result.stepsRun,
      safetyReason: result.safetyReason || null,
    };
  }

  if (job.kind === "weekly_executive_digest") {
    const digest = generateWeeklyDigest(db, options);
    return {
      kind: job.kind,
      status: digest.status,
      digestId: digest.id,
      importantItems: Number(digest.metrics.openDecisions || 0) + Number(digest.metrics.unknownOutcomes || 0),
    };
  }

  throw new Error(`Unsupported scheduler job kind: ${job.kind}`);
}

function claimSchedulerJob(db, jobId, options = {}) {
  ensureSchedulerJobs(db);
  const startedAt = options.startedAt || now();
  const runId = `sched_${randomId()}`;
  db.exec("BEGIN IMMEDIATE");
  try {
    const job = parseJob(get(db, "SELECT * FROM scheduler_jobs WHERE id = ?", [jobId]));
    if (!job) {
      db.exec("COMMIT");
      throw new Error(`Scheduler job not found: ${jobId}`);
    }
    if (job.status !== "enabled" && !options.force) {
      db.exec("COMMIT");
      return { claimed: false, reason: "job_disabled", job };
    }
    const cutoff = leaseCutoff(startedAt, leaseSecondsFor(job, options));
    const previousOwner = job.lock_owner;
    const result = run(
      db,
      `UPDATE scheduler_jobs
       SET locked_at = ?, lock_owner = ?, updated_at = ?
       WHERE id = ?
         AND (status = 'enabled' OR ? = 1)
         AND (locked_at IS NULL OR locked_at <= ? OR julianday(locked_at) IS NULL)`,
      [startedAt, runId, startedAt, job.id, options.force ? 1 : 0, cutoff],
    );
    if (result.changes !== 1) {
      db.exec("COMMIT");
      return { claimed: false, reason: "job_already_running", job };
    }
    if (previousOwner) {
      run(
        db,
        `UPDATE scheduler_runs
         SET status = 'abandoned', completed_at = ?, error = ?
         WHERE id = ? AND status = 'running'`,
        [startedAt, "Scheduler lease expired before the job completed.", previousOwner],
      );
    }
    run(
      db,
      `INSERT INTO scheduler_runs (id, job_id, status, started_at, metadata, result)
       VALUES (?, ?, 'running', ?, ?, ?)`,
      [runId, job.id, startedAt, toJson({ manual: Boolean(options.manual), force: Boolean(options.force) }), toJson({})],
    );
    db.exec("COMMIT");
    return { claimed: true, job, runId, startedAt, previousOwner, leaseSeconds: leaseSecondsFor(job, options) };
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {
      // The transaction may already have been committed for a handled no-claim result.
    }
    throw error;
  }
}

function startLeaseHeartbeat(db, claim) {
  const intervalMs = Math.max(10_000, Math.min(60_000, Math.floor(claim.leaseSeconds * 1000 / 3)));
  let leaseLost = false;
  const renew = () => {
    try {
      const renewedAt = now();
      const result = run(
        db,
        `UPDATE scheduler_jobs
         SET locked_at = ?, updated_at = ?
         WHERE id = ? AND lock_owner = ?`,
        [renewedAt, renewedAt, claim.job.id, claim.runId],
      );
      if (result.changes !== 1) leaseLost = true;
    } catch {
      leaseLost = true;
    }
  };
  const timer = setInterval(renew, intervalMs);
  if (timer.unref) timer.unref();
  return {
    stop() {
      clearInterval(timer);
      return { leaseLost };
    },
  };
}

function finishSchedulerJob(db, claim, status, result, errorMessage = null) {
  const completedAt = now();
  db.exec("BEGIN IMMEDIATE");
  try {
    run(
      db,
      `UPDATE scheduler_runs
       SET status = ?, completed_at = ?, result = ?, error = ?
       WHERE id = ? AND status = 'running'`,
      [status, completedAt, toJson(result || {}), errorMessage, claim.runId],
    );
    const currentJob = parseJob(get(db, "SELECT * FROM scheduler_jobs WHERE id = ?", [claim.job.id]));
    const released = run(
      db,
      `UPDATE scheduler_jobs
       SET last_run_at = ?, next_run_at = ?, locked_at = NULL, lock_owner = NULL, updated_at = ?
       WHERE id = ? AND lock_owner = ?`,
      [
        completedAt,
        currentJob?.status === "enabled" ? nextRunAt(currentJob, completedAt) : null,
        completedAt,
        claim.job.id,
        claim.runId,
      ],
    );
    if (released.changes !== 1) {
      run(
        db,
        `UPDATE scheduler_runs
         SET status = 'needs_attention', error = ?
         WHERE id = ?`,
        ["Scheduler lease ownership changed before completion; review this job outcome.", claim.runId],
      );
      db.exec("COMMIT");
      return { completedAt, lockReleased: false };
    }
    db.exec("COMMIT");
    return { completedAt, lockReleased: true };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

async function runSchedulerJob(db, jobId, options = {}) {
  const claim = claimSchedulerJob(db, jobId, options);
  if (!claim.claimed) {
    return {
      id: null,
      jobId,
      status: "skipped",
      result: { status: "skipped", reason: claim.reason, jobId },
    };
  }

  const heartbeat = startLeaseHeartbeat(db, claim);
  try {
    const result = await executeSchedulerJob(db, claim.job, { ...options, schedulerRunId: claim.runId });
    heartbeat.stop();
    const finished = finishSchedulerJob(db, claim, "completed", result);
    const status = finished.lockReleased ? "completed" : "needs_attention";
    insertEvent(db, {
      level: status === "completed" ? "info" : "warn",
      actor: "scheduler",
      type: `scheduler.job.${status}`,
      entityType: "scheduler_job",
      entityId: claim.job.id,
      message: `Scheduler job ${claim.job.name} ${status === "completed" ? "completed" : "needs review"}.`,
      metadata: { runId: claim.runId, result },
    });
    return { id: claim.runId, jobId: claim.job.id, status, result };
  } catch (error) {
    heartbeat.stop();
    const finished = finishSchedulerJob(db, claim, "failed", {}, error.message);
    const status = finished.lockReleased ? "failed" : "needs_attention";
    insertEvent(db, {
      level: "error",
      actor: "scheduler",
      type: `scheduler.job.${status}`,
      entityType: "scheduler_job",
      entityId: claim.job.id,
      message: `Scheduler job ${claim.job.name} ${status === "failed" ? `failed: ${error.message}` : "needs review after losing its lease"}.`,
      metadata: { runId: claim.runId },
    });
    return { id: claim.runId, jobId: claim.job.id, status, error: error.message };
  }
}

async function runDueSchedulerJobs(db, options = {}) {
  const jobs = dueSchedulerJobs(db, options);
  const runs = [];
  for (const job of jobs) {
    runs.push(await runSchedulerJob(db, job.id, { ...options, manual: false }));
  }
  return {
    status: "completed",
    dueCount: jobs.length,
    claimedCount: runs.filter((item) => item.status !== "skipped").length,
    runs,
  };
}

function startSchedulerLoop(db, options = {}) {
  ensureSchedulerJobs(db);
  recoverExpiredSchedulerLocks(db, { leaseSeconds: options.leaseSeconds });
  const pollMs = Math.max(10_000, Number(options.pollMs || CONFIG.schedulerPollMs || 60_000));
  let active = false;
  const tick = async () => {
    if (active) return { status: "skipped", reason: "scheduler_already_running" };
    active = true;
    try {
      return await runDueSchedulerJobs(db, {
        limit: options.limit || CONFIG.schedulerMaxJobsPerTick || 2,
        leaseSeconds: options.leaseSeconds || DEFAULT_LEASE_SECONDS,
        actor: "scheduler-loop",
      });
    } catch (error) {
      insertEvent(db, {
        level: "error",
        actor: "scheduler",
        type: "scheduler.loop.failed",
        entityType: "scheduler",
        entityId: "local-loop",
        message: error.message,
      });
      return { status: "failed", error: error.message };
    } finally {
      active = false;
    }
  };
  const timer = setInterval(tick, pollMs);
  if (timer.unref) timer.unref();
  return {
    pollMs,
    tick,
    stop() {
      clearInterval(timer);
    },
  };
}

module.exports = {
  DEFAULT_JOBS,
  DEFAULT_LEASE_SECONDS,
  dueSchedulerJobs,
  ensureSchedulerJobs,
  inspectSafeWorkflow,
  listSchedulerJobs,
  listSchedulerRuns,
  recoverExpiredSchedulerLocks,
  runDueSchedulerJobs,
  runSchedulerJob,
  setSchedulerJobStatus,
  startSchedulerLoop,
  unsafeTaskReason,
};
