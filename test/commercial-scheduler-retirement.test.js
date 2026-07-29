const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { openDatabase, seedDatabase, toJson } = require("../src/db");
const {
  ensureSchedulerJobs,
  inspectSafeWorkflow,
  runDueSchedulerJobs,
  runSchedulerJob,
  setSchedulerJobStatus,
} = require("../src/runtime/scheduler");

function runtimeDatabase(name) {
  const dir = fs.mkdtempSync(
    path.join(os.tmpdir(), `pantheon-commercial-scheduler-${name}-`),
  );
  const db = openDatabase(path.join(dir, "runtime.sqlite"));
  seedDatabase(db, { includeDemoProof: false });
  return {
    db,
    close() {
      db.close();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

function schedulerJob(db, id) {
  return db.prepare("SELECT * FROM scheduler_jobs WHERE id = ?").get(id);
}

test("scheduler foundation permanently disables an existing legacy commercial supervisor", () => {
  const runtime = runtimeDatabase("foundation");
  try {
    ensureSchedulerJobs(runtime.db);
    let supervisor = schedulerJob(runtime.db, "job-pantheon-supervisor");
    assert.equal(supervisor.status, "disabled");
    assert.equal(supervisor.next_run_at, null);
    assert.equal(JSON.parse(supervisor.metadata).retired, true);

    runtime.db.prepare(`
      UPDATE scheduler_jobs
      SET status = 'enabled', next_run_at = '2026-07-29T00:00:00.000Z'
      WHERE id = 'job-pantheon-supervisor'
    `).run();
    ensureSchedulerJobs(runtime.db);

    supervisor = schedulerJob(runtime.db, "job-pantheon-supervisor");
    assert.equal(supervisor.status, "disabled");
    assert.equal(supervisor.next_run_at, null);
    assert.equal(schedulerJob(runtime.db, "job-monitor-cycle").status, "enabled");
    assert.equal(
      schedulerJob(runtime.db, "job-weekly-executive-digest").status,
      "enabled",
    );
  } finally {
    runtime.close();
  }
});

test("direct enable and force-run attempts cannot revive the retired supervisor", async () => {
  const runtime = runtimeDatabase("direct-bypass");
  try {
    ensureSchedulerJobs(runtime.db);
    assert.throws(
      () => setSchedulerJobStatus(
        runtime.db,
        "job-pantheon-supervisor",
        "enabled",
      ),
      (error) => (
        error.code === "scheduler_job_retired"
        && error.statusCode === 410
        && /permanently retired/i.test(error.message)
      ),
    );

    const forced = await runSchedulerJob(
      runtime.db,
      "job-pantheon-supervisor",
      {
        manual: true,
        force: true,
        allowDiscoveryStart: true,
      },
    );
    assert.equal(forced.status, "skipped");
    assert.equal(forced.result.status, "retired");
    assert.equal(
      forced.result.reason,
      "unscoped_commercial_supervisor_retired",
    );
    assert.equal(
      runtime.db.prepare(
        "SELECT COUNT(*) AS count FROM scheduler_runs WHERE job_id = ?",
      ).get("job-pantheon-supervisor").count,
      0,
    );
    assert.equal(
      runtime.db.prepare(
        "SELECT COUNT(*) AS count FROM events WHERE type = ?",
      ).get("scheduler.job.retired_run_blocked").count,
      1,
    );
  } finally {
    runtime.close();
  }
});

test("monitor, digest, and due-maintenance scheduling remain operational", async () => {
  const runtime = runtimeDatabase("maintenance");
  try {
    ensureSchedulerJobs(runtime.db);

    const monitor = await runSchedulerJob(
      runtime.db,
      "job-monitor-cycle",
      { manual: true },
    );
    assert.equal(monitor.status, "completed");
    assert.equal(monitor.result.kind, "monitor_cycle");
    assert.ok(monitor.result.monitorRunId);

    setSchedulerJobStatus(runtime.db, "job-monitor-cycle", "disabled");
    assert.equal(schedulerJob(runtime.db, "job-monitor-cycle").status, "disabled");
    setSchedulerJobStatus(runtime.db, "job-monitor-cycle", "enabled");
    assert.equal(schedulerJob(runtime.db, "job-monitor-cycle").status, "enabled");

    runtime.db.prepare(`
      UPDATE scheduler_jobs
      SET next_run_at = '2026-07-29T00:00:00.000Z'
      WHERE id IN ('job-monitor-cycle', 'job-weekly-executive-digest')
    `).run();
    const due = await runDueSchedulerJobs(runtime.db, {
      dueAt: "2026-07-29T00:00:01.000Z",
      limit: 10,
    });
    assert.equal(due.status, "completed");
    assert.deepEqual(
      due.runs.map((runRecord) => runRecord.jobId).sort(),
      ["job-monitor-cycle", "job-weekly-executive-digest"],
    );
    assert.ok(due.runs.every((runRecord) => runRecord.status === "completed"));
    assert.equal(
      due.runs.some(
        (runRecord) => runRecord.jobId === "job-pantheon-supervisor",
      ),
      false,
    );
  } finally {
    runtime.close();
  }
});

test("safe-work scheduler cannot execute an unbound commercial workflow", async () => {
  const runtime = runtimeDatabase("unbound-safe-work");
  try {
    ensureSchedulerJobs(runtime.db);
    const timestamp = "2026-07-29T00:00:00.000Z";
    runtime.db.prepare(`
      INSERT INTO workflows
      (id, venture_id, type, title, status, current_step, priority,
       quality_score, expected_profit_cents, cost_estimate_cents,
       approval_required, metadata, created_at, updated_at)
      VALUES (
        'workflow-unbound-commercial-safe-loop',
        'venture-digital-products',
        'commercial_test',
        'Unbound product test',
        'planned',
        '',
        1,
        0,
        0,
        0,
        0,
        ?,
        ?,
        ?
      )
    `).run(
      toJson({
        agentRunner: {
          mode: "plan_only",
          liveModels: false,
          liveTools: false,
        },
      }),
      timestamp,
      timestamp,
    );
    runtime.db.prepare(`
      INSERT INTO tasks
      (id, workflow_id, venture_id, title, kind, agent, status, priority,
       payload, result, created_at, updated_at)
      VALUES (
        'task-unbound-commercial-safe-loop',
        'workflow-unbound-commercial-safe-loop',
        'venture-digital-products',
        'Prepare product offer',
        'offer_preparation',
        'orchestrator',
        'planned',
        1,
        '{}',
        '{}',
        ?,
        ?
      )
    `).run(timestamp, timestamp);

    const inspection = inspectSafeWorkflow(
      runtime.db,
      "workflow-unbound-commercial-safe-loop",
    );
    assert.equal(inspection.safe, false);
    assert.equal(inspection.reason, "commercial_binding_required");

    setSchedulerJobStatus(runtime.db, "job-safe-work-loop", "enabled");
    const attempted = await runSchedulerJob(
      runtime.db,
      "job-safe-work-loop",
      {
        manual: true,
        workflowId: "workflow-unbound-commercial-safe-loop",
      },
    );
    assert.equal(attempted.status, "completed");
    assert.equal(attempted.result.status, "safety_blocked");
    assert.equal(
      attempted.result.reason,
      "commercial_binding_required",
    );
    assert.equal(
      runtime.db.prepare(
        "SELECT status FROM tasks WHERE id = 'task-unbound-commercial-safe-loop'",
      ).get().status,
      "planned",
    );
  } finally {
    runtime.close();
  }
});
