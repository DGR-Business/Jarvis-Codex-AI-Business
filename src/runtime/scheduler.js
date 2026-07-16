const CONFIG = require("../config");
const { runMonitorCycle } = require("./monitor");
const { runUntilBlocked } = require("./orchestrator");
const { generateWeeklyDigest } = require("./executive-digest");
const { all, fromJson, get, insertEvent, now, randomId, run, toJson } = require("../db");

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
      purpose: "Run queued dry-run internal work until blocked, ready for review, idle, or step limit.",
      maxSteps: 5,
      dryRunOnly: true,
      enableWhen: "Operator approves narrow autopilot for dry-run internal work.",
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
     SET status = ?, next_run_at = ?, locked_at = NULL, lock_owner = NULL, updated_at = ?
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

function dueSchedulerJobs(db, options = {}) {
  ensureSchedulerJobs(db);
  const dueAt = options.dueAt || now();
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

function findSafeWorkCandidate(db) {
  const row = get(
    db,
    `SELECT workflows.id
     FROM workflows
     JOIN tasks ON tasks.workflow_id = workflows.id
     LEFT JOIN approvals ON approvals.id = tasks.approval_id
     WHERE tasks.status IN ('planned', 'queued')
       AND workflows.status IN ('planned', 'agent_running', 'agent_retrying')
       AND (tasks.approval_id IS NULL OR approvals.status = 'approved')
     ORDER BY workflows.priority ASC, workflows.updated_at ASC, tasks.priority ASC
     LIMIT 1`,
  );
  return row?.id || null;
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
    const workflowId = job.metadata.workflowId || findSafeWorkCandidate(db);
    if (!workflowId) {
      return {
        kind: job.kind,
        status: "idle",
        message: "No eligible dry-run workflow is queued for scheduled safe work.",
      };
    }
    const maxSteps = Math.max(1, Math.min(Number(options.maxSteps || job.metadata.maxSteps || 5), 20));
    const result = await runUntilBlocked(db, { workflowId, maxSteps });
    return {
      kind: job.kind,
      status: result.status,
      workflowId,
      workflowRunId: result.runId,
      stoppedBy: result.stoppedBy,
      stepsRun: result.stepsRun,
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

async function runSchedulerJob(db, jobId, options = {}) {
  ensureSchedulerJobs(db);
  const job = parseJob(get(db, "SELECT * FROM scheduler_jobs WHERE id = ?", [jobId]));
  if (!job) throw new Error(`Scheduler job not found: ${jobId}`);

  const startedAt = now();
  const runId = `sched_${randomId()}`;
  run(
    db,
    `INSERT INTO scheduler_runs (id, job_id, status, started_at, metadata, result)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [runId, job.id, "running", startedAt, toJson({ manual: Boolean(options.manual), force: Boolean(options.force) }), toJson({})],
  );
  run(
    db,
    `UPDATE scheduler_jobs SET locked_at = ?, lock_owner = ?, updated_at = ? WHERE id = ?`,
    [startedAt, runId, startedAt, job.id],
  );

  try {
    let result;
    let status = "completed";
    if (job.status !== "enabled" && !options.force) {
      status = "skipped";
      result = { status: "skipped", reason: "job_disabled", jobId: job.id };
    } else {
      result = await executeSchedulerJob(db, job, options);
    }

    const completedAt = now();
    run(
      db,
      `UPDATE scheduler_runs SET status = ?, completed_at = ?, result = ? WHERE id = ?`,
      [status, completedAt, toJson(result), runId],
    );
    run(
      db,
      `UPDATE scheduler_jobs
       SET last_run_at = ?, next_run_at = ?, locked_at = NULL, lock_owner = NULL, updated_at = ?
       WHERE id = ?`,
      [completedAt, job.status === "enabled" ? nextRunAt(job, completedAt) : null, completedAt, job.id],
    );
    insertEvent(db, {
      actor: "scheduler",
      type: `scheduler.job.${status}`,
      entityType: "scheduler_job",
      entityId: job.id,
      message: `Scheduler job ${job.name} ${status}.`,
      metadata: { runId, result },
    });
    return { id: runId, jobId: job.id, status, result };
  } catch (error) {
    const failedAt = now();
    run(
      db,
      `UPDATE scheduler_runs SET status = 'failed', completed_at = ?, error = ? WHERE id = ?`,
      [failedAt, error.message, runId],
    );
    run(
      db,
      `UPDATE scheduler_jobs
       SET last_run_at = ?, next_run_at = ?, locked_at = NULL, lock_owner = NULL, updated_at = ?
       WHERE id = ?`,
      [failedAt, job.status === "enabled" ? nextRunAt(job, failedAt) : null, failedAt, job.id],
    );
    insertEvent(db, {
      level: "error",
      actor: "scheduler",
      type: "scheduler.job.failed",
      entityType: "scheduler_job",
      entityId: job.id,
      message: `Scheduler job ${job.name} failed: ${error.message}`,
      metadata: { runId },
    });
    return { id: runId, jobId: job.id, status: "failed", error: error.message };
  }
}

async function runDueSchedulerJobs(db, options = {}) {
  const jobs = dueSchedulerJobs(db, options);
  const runs = [];
  for (const job of jobs) {
    runs.push(await runSchedulerJob(db, job.id, { ...options, manual: false }));
  }
  return { status: "completed", dueCount: jobs.length, runs };
}

function startSchedulerLoop(db, options = {}) {
  ensureSchedulerJobs(db);
  const pollMs = Math.max(10_000, Number(options.pollMs || CONFIG.schedulerPollMs || 60_000));
  let active = false;
  const tick = async () => {
    if (active) return { status: "skipped", reason: "scheduler_already_running" };
    active = true;
    try {
      return await runDueSchedulerJobs(db, {
        limit: options.limit || CONFIG.schedulerMaxJobsPerTick || 2,
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
  dueSchedulerJobs,
  ensureSchedulerJobs,
  listSchedulerJobs,
  listSchedulerRuns,
  runDueSchedulerJobs,
  runSchedulerJob,
  setSchedulerJobStatus,
  startSchedulerLoop,
};
