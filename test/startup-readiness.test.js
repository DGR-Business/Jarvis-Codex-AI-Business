const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { decideApproval } = require("../src/runtime/approvals");
const { runOnce } = require("../src/runtime/orchestrator");
const { createCommandPlan } = require("../src/runtime/planner");
const { requestLiveAiWorker } = require("../src/runtime/live-ai-workers");
const { ensureSchedulerJobs } = require("../src/runtime/scheduler");
const { createApp, startServer } = require("../src/server");
const { get, openDatabase, run, seedDatabase, toJson } = require("../src/db");
const {
  installActivatedCommercialTestFixture,
} = require("./support/commercial-authority-fixture");

test("the Windows launcher refreshes Pantheon when runtime source changes", () => {
  const launcher = fs.readFileSync(
    path.join(__dirname, "..", "scripts", "start-pantheon.ps1"),
    "utf8",
  );
  assert.match(launcher, /runtimeSourceFingerprint/);
  assert.match(launcher, /PANTHEON_RUNTIME_SOURCE=/);
  assert.match(launcher, /Refreshing Pantheon with the current approved connections and limits/);
});

test("the standby control shell does not claim that the working runtime is ready", () => {
  const standby = fs.readFileSync(
    path.join(__dirname, "..", "scripts", "pantheon-standby.js"),
    "utf8",
  );
  assert.match(standby, /runtimeReady:\s*false/);
  assert.match(standby, /readinessScope:\s*"standby_control_shell"/);
  assert.match(standby, /operationsReady:\s*false/);
  assert.match(standby, /operationsReadyAliasFor:\s*"runtimeReady"/);
  assert.match(standby, /workingReady:\s*Boolean\(health\?\.runtimeReady\)/);
  assert.doesNotMatch(standby, /workingReady:\s*Boolean\(health\?\.operationsReady\)/);
});

test("the standby working-start deadline covers the launcher's composed readiness windows", () => {
  const standby = fs.readFileSync(
    path.join(__dirname, "..", "scripts", "pantheon-standby.js"),
    "utf8",
  );
  const launcher = fs.readFileSync(
    path.join(__dirname, "..", "scripts", "start-pantheon.ps1"),
    "utf8",
  );
  const launcherCommon = fs.readFileSync(
    path.join(__dirname, "..", "scripts", "pantheon-launcher-common.ps1"),
    "utf8",
  );
  const lifecycleProof = fs.readFileSync(
    path.join(__dirname, "..", "scripts", "verify-runtime-cycles.ps1"),
    "utf8",
  );
  const lifecycleTest = fs.readFileSync(
    path.join(__dirname, "windows-launcher.test.js"),
    "utf8",
  );
  const workingStartMatch = standby.match(/const workingStartTimeoutMs = ([\d_]+);/);
  const terminationMatch = standby.match(/const powerShellTerminationTimeoutMs = ([\d_]+);/);
  const launcherLockMatch = launcherCommon.match(/\[int\]\$TimeoutSeconds = (\d+)/);
  const startupMatch = launcher.match(/\[int\]\$StartupTimeoutSeconds = (\d+)/);
  const readinessMatch = launcher.match(/\[int\]\$ReadyTimeoutSeconds = (\d+)/);
  const lifecycleMatch = lifecycleProof.match(/\[int\]\$CycleTimeoutSeconds = (\d+)/);
  const lifecycleRequestMatch = lifecycleTest.match(
    /const workingStartRequestTimeoutMs = ([\d_]+);/,
  );

  assert.ok(workingStartMatch);
  assert.ok(terminationMatch);
  assert.ok(launcherLockMatch);
  assert.ok(startupMatch);
  assert.ok(readinessMatch);
  assert.ok(lifecycleMatch);
  assert.ok(lifecycleRequestMatch);
  const workingStartTimeoutMs = Number(workingStartMatch[1].replaceAll("_", ""));
  const terminationTimeoutMs = Number(terminationMatch[1].replaceAll("_", ""));
  const launcherLockTimeoutMs = Number(launcherLockMatch[1]) * 1000;
  const composedLauncherTimeoutMs = (Number(startupMatch[1]) + Number(readinessMatch[1])) * 1000;
  const lifecycleTimeoutMs = Number(lifecycleMatch[1]) * 1000;
  const lifecycleRequestTimeoutMs = Number(lifecycleRequestMatch[1].replaceAll("_", ""));
  assert.ok(
    workingStartTimeoutMs
      >= launcherLockTimeoutMs + composedLauncherTimeoutMs + 30_000,
  );
  assert.ok(
    lifecycleRequestTimeoutMs
      >= workingStartTimeoutMs + terminationTimeoutMs + 10_000,
  );
  assert.ok(
    lifecycleTimeoutMs
      >= workingStartTimeoutMs + terminationTimeoutMs + 15_000,
  );
});

function makeRuntime(name) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `jarvis-startup-${name}-`));
  const db = openDatabase(path.join(root, "runtime.sqlite"));
  seedDatabase(db);
  return { root, db };
}

async function closeRuntime(runtime, started = null) {
  if (started) await started.server.shutdown();
  runtime.db.close();
  fs.rmSync(runtime.root, { recursive: true, force: true });
}

async function readHealth(started) {
  const response = await fetch(`${started.url}/api/health`);
  assert.equal(response.status, 200);
  return response.json();
}

test("startup completes one monitor cycle before reporting operations ready", async () => {
  const runtime = makeRuntime("monitor-ready");
  let started = null;
  try {
    started = await startServer({
      port: 0,
      db: runtime.db,
      security: false,
      schedulerEnabled: true,
      scheduler: { pollMs: 60_000 },
    });
    const health = await readHealth(started);

    assert.equal(health.alive, true);
    assert.equal(health.ok, true);
    assert.equal(health.installationReady, null);
    assert.equal(health.recoveryReady, null);
    assert.equal(health.runtimeReady, true);
    assert.equal(health.readinessScope, "runtime_monitoring");
    assert.equal(health.operationsReady, true);
    assert.equal(health.operationsReadyAliasFor, "runtimeReady");
    assert.deepEqual(
      { enabled: health.scheduler.enabled, running: health.scheduler.running },
      { enabled: true, running: true },
    );
    assert.equal(health.monitoring.ready, true);
    assert.equal(health.monitoring.recent, true);
    assert.equal(health.monitoring.overdue, false);
    assert.equal(health.monitoring.job.id, "job-monitor-cycle");
    assert.equal(health.monitoring.job.enabled, true);
    assert.equal(health.monitoring.startup.status, "completed");
    assert.ok(health.monitoring.latestCompletedCheck.completedAt);
    assert.equal(
      get(runtime.db, "SELECT COUNT(*) AS count FROM scheduler_runs WHERE job_id = 'job-monitor-cycle' AND status = 'completed'").count,
      1,
    );

    const staleAt = "2020-01-01T00:00:00.000Z";
    run(runtime.db, "UPDATE monitor_runs SET started_at = ?, completed_at = ?", [staleAt, staleAt]);
    run(runtime.db, "UPDATE scheduler_jobs SET next_run_at = ? WHERE id = 'job-monitor-cycle'", [staleAt]);
    const overdue = await readHealth(started);
    assert.equal(overdue.alive, true);
    assert.equal(overdue.ok, false);
    assert.equal(overdue.installationReady, null);
    assert.equal(overdue.recoveryReady, null);
    assert.equal(overdue.runtimeReady, false);
    assert.equal(overdue.readinessScope, "runtime_monitoring");
    assert.equal(overdue.operationsReady, false);
    assert.equal(overdue.operationsReadyAliasFor, "runtimeReady");
    assert.equal(overdue.monitoring.ready, false);
    assert.equal(overdue.monitoring.recent, false);
    assert.equal(overdue.monitoring.overdue, true);
    assert.equal(overdue.monitoring.reason, "monitor_check_overdue");
    assert.equal(overdue.monitoring.latestCompletedCheck.completedAt, staleAt);
  } finally {
    await closeRuntime(runtime, started);
  }
});

test("health stays live but not ready when the scheduler or monitor job is disabled", async (t) => {
  await t.test("scheduler disabled", async () => {
    const runtime = makeRuntime("scheduler-disabled");
    let started = null;
    try {
      started = await startServer({ port: 0, db: runtime.db, security: false, schedulerEnabled: false });
      const health = await readHealth(started);
      assert.equal(health.alive, true);
      assert.equal(health.ok, false);
      assert.equal(health.runtimeReady, false);
      assert.equal(health.readinessScope, "runtime_monitoring");
      assert.equal(health.operationsReadyAliasFor, "runtimeReady");
      assert.equal(health.scheduler.enabled, false);
      assert.equal(health.scheduler.running, false);
      assert.equal(health.monitoring.ready, false);
      assert.equal(health.monitoring.reason, "scheduler_disabled");
      assert.equal(health.monitoring.startup.status, "disabled");
      assert.equal(get(runtime.db, "SELECT COUNT(*) AS count FROM monitor_runs").count, 0);
    } finally {
      await closeRuntime(runtime, started);
    }
  });

  await t.test("monitor job disabled", async () => {
    const runtime = makeRuntime("monitor-disabled");
    let started = null;
    try {
      ensureSchedulerJobs(runtime.db);
      run(runtime.db, "UPDATE scheduler_jobs SET status = 'disabled', next_run_at = NULL WHERE id = 'job-monitor-cycle'");
      started = await startServer({ port: 0, db: runtime.db, security: false, schedulerEnabled: true });
      const health = await readHealth(started);
      assert.equal(health.alive, true);
      assert.equal(health.ok, false);
      assert.equal(health.runtimeReady, false);
      assert.equal(health.readinessScope, "runtime_monitoring");
      assert.equal(health.operationsReadyAliasFor, "runtimeReady");
      assert.equal(health.scheduler.enabled, true);
      assert.equal(health.scheduler.running, true);
      assert.equal(health.monitoring.job.enabled, false);
      assert.equal(health.monitoring.ready, false);
      assert.equal(health.monitoring.reason, "monitor_job_disabled");
      assert.equal(health.monitoring.startup.status, "disabled");
      assert.equal(get(runtime.db, "SELECT COUNT(*) AS count FROM monitor_runs").count, 0);
    } finally {
      await closeRuntime(runtime, started);
    }
  });
});

test("startup recovery only requeues exact approved setup-blocked work", async () => {
  const runtime = makeRuntime("setup-recovery");
  const previousKey = process.env.OPENAI_API_KEY;
  const previousLiveModels = process.env.JARVIS_ENABLE_LIVE_MODELS;
  const previousDisabledAdapter = process.env.JARVIS_DISABLE_LIVE_AI_WORKER_ADAPTER;
  const previousDisabledSdk = process.env.JARVIS_DISABLE_OPENAI_AGENTS_SDK;
  let app = null;
  delete process.env.OPENAI_API_KEY;
  process.env.JARVIS_ENABLE_LIVE_MODELS = "1";
  delete process.env.JARVIS_DISABLE_LIVE_AI_WORKER_ADAPTER;
  delete process.env.JARVIS_DISABLE_OPENAI_AGENTS_SDK;
  try {
    const planned = createCommandPlan(runtime.db, {
      text: "Evaluate a startup recovery checklist digital product",
      source: "test",
      createFiles: false,
      mode: "plan_only",
    });
    installActivatedCommercialTestFixture(runtime.db, {
      suffix: "startup-recovery",
      workflowIds: [planned.workflow.id],
    });
    run(runtime.db, "UPDATE tasks SET status = 'cancelled' WHERE workflow_id = ?", [planned.workflow.id]);
    const requested = requestLiveAiWorker(runtime.db, planned.workflow.id, {
      worker: "demand_validator",
      model: "gpt-5.6-terra",
      estimatedCostCents: 100,
      maxOutputTokens: 600,
    });
    decideApproval(runtime.db, requested.approval.id, "approved", "startup recovery proof", {
      expectedScopeHash: requested.approval.scope_hash,
    });
    const blocked = await runOnce(runtime.db, { taskId: requested.task.id });
    assert.equal(blocked.status, "blocked");

    const beforeTask = get(runtime.db, "SELECT status, attempt_count, setup_block_reason FROM tasks WHERE id = ?", [requested.task.id]);
    const beforeApproval = get(runtime.db, "SELECT status, consumed_at FROM approvals WHERE id = ?", [requested.approval.id]);
    const beforeAttempts = get(runtime.db, "SELECT COUNT(*) AS count FROM task_attempts WHERE task_id = ?", [requested.task.id]).count;
    const beforeModelCalls = get(runtime.db, "SELECT COUNT(*) AS count FROM model_calls WHERE task_id = ?", [requested.task.id]).count;
    assert.equal(beforeTask.status, "blocked");
    assert.ok(beforeTask.setup_block_reason);
    assert.equal(beforeApproval.status, "approved");
    assert.equal(beforeApproval.consumed_at, null);

    process.env.OPENAI_API_KEY = "configured-for-startup-recovery-test";
    app = createApp({ db: runtime.db, security: false, schedulerEnabled: false });

    const recoveredTask = get(runtime.db, "SELECT status, attempt_count, setup_block_reason, result FROM tasks WHERE id = ?", [requested.task.id]);
    const recoveredApproval = get(runtime.db, "SELECT status, consumed_at FROM approvals WHERE id = ?", [requested.approval.id]);
    assert.equal(recoveredTask.status, "queued");
    assert.equal(recoveredTask.setup_block_reason, null);
    assert.equal(recoveredTask.attempt_count, beforeTask.attempt_count);
    assert.ok(JSON.parse(recoveredTask.result).setupRecoveredAt);
    assert.equal(recoveredApproval.status, "approved");
    assert.equal(recoveredApproval.consumed_at, null);
    assert.equal(get(runtime.db, "SELECT COUNT(*) AS count FROM task_attempts WHERE task_id = ?", [requested.task.id]).count, beforeAttempts);
    assert.equal(get(runtime.db, "SELECT COUNT(*) AS count FROM model_calls WHERE task_id = ?", [requested.task.id]).count, beforeModelCalls);
  } finally {
    if (app) await app.server.shutdown();
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousKey;
    if (previousLiveModels === undefined) delete process.env.JARVIS_ENABLE_LIVE_MODELS;
    else process.env.JARVIS_ENABLE_LIVE_MODELS = previousLiveModels;
    if (previousDisabledAdapter === undefined) delete process.env.JARVIS_DISABLE_LIVE_AI_WORKER_ADAPTER;
    else process.env.JARVIS_DISABLE_LIVE_AI_WORKER_ADAPTER = previousDisabledAdapter;
    if (previousDisabledSdk === undefined) delete process.env.JARVIS_DISABLE_OPENAI_AGENTS_SDK;
    else process.env.JARVIS_DISABLE_OPENAI_AGENTS_SDK = previousDisabledSdk;
    await closeRuntime(runtime);
  }
});

function insertUnsafeTask(db, options) {
  const ts = options.createdAt;
  run(
    db,
    `INSERT INTO workflows
     (id, venture_id, type, title, status, current_step, priority, metadata, created_at, updated_at)
     VALUES (?, 'venture-digital-products', ?, ?, 'planned', 'queued', 1, ?, ?, ?)`,
    [
      options.workflowId,
      options.workflowType || "safety_test",
      options.title,
      toJson(options.workflowMetadata || {
        agentRunner: {
          mode: "run_protected",
          liveModels: false,
          liveTools: false,
        },
      }),
      ts,
      ts,
    ],
  );
  run(
    db,
    `INSERT INTO tasks
     (id, workflow_id, venture_id, title, kind, agent, status, priority, approval_id,
      cost_budget_cents, payload, result, created_at, updated_at)
     VALUES (?, ?, 'venture-digital-products', ?, ?, ?, 'queued', 1, ?, 100, ?, '{}', ?, ?)`,
    [
      options.taskId,
      options.workflowId,
      options.title,
      options.kind,
      options.agent || "demand_validator",
      options.approvalId || null,
      toJson(options.payload || {}),
      ts,
      ts,
    ],
  );
}

test("generic runtime tick skips provider and approval-bound work", async () => {
  const runtime = makeRuntime("safe-runtime-tick");
  let app = null;
  try {
    const ts = "2026-01-01T00:00:00.000Z";
    insertUnsafeTask(runtime.db, {
      workflowId: "wf-runtime-tick-provider",
      taskId: "task-runtime-tick-provider",
      title: "Provider work must stay queued",
      kind: "live_ai_worker_execution",
      payload: { liveSpendRequest: { amountCents: 100, provider: "openai" } },
      createdAt: ts,
    });
    run(
      runtime.db,
      `INSERT INTO approvals
       (id, venture_id, scope, title, status, risk_level, requested_by,
        requested_at, payload, expected_effects)
       VALUES ('appr-runtime-tick', 'venture-digital-products',
        'runtime_tick_test', 'Approval-bound work', 'approved', 'medium', 'test', ?, '{}', '[]')`,
      [ts],
    );
    insertUnsafeTask(runtime.db, {
      workflowId: "wf-runtime-tick-approval",
      taskId: "task-runtime-tick-approval",
      title: "Approved work still needs an exact endpoint",
      kind: "market_research",
      approvalId: "appr-runtime-tick",
      createdAt: ts,
    });
    const safePlan = {
      workflow: { id: "wf-runtime-tick-integrity" },
      tasks: [{ id: "task-runtime-tick-integrity" }],
    };
    insertUnsafeTask(runtime.db, {
      workflowId: safePlan.workflow.id,
      taskId: safePlan.tasks[0].id,
      title: "Runtime database integrity assurance",
      workflowType: "runtime_assurance",
      workflowMetadata: {
        systemProof: true,
      },
      kind: "goal_planning",
      agent: "chief_of_staff",
      payload: {
        subject: "Runtime database integrity",
        systemProof: true,
      },
      createdAt: ts,
    });

    app = createApp({ db: runtime.db, security: false, schedulerEnabled: false });
    await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
    const baseUrl = `http://127.0.0.1:${app.server.address().port}`;
    const first = await fetch(`${baseUrl}/api/runtime/tick`, { method: "POST", body: "{}" }).then((response) => response.json());
    assert.equal(first.result.status, "completed");
    assert.equal(first.result.task.id, safePlan.tasks[0].id);
    assert.equal(get(runtime.db, "SELECT status FROM tasks WHERE id = 'task-runtime-tick-provider'").status, "queued");
    assert.equal(get(runtime.db, "SELECT status FROM tasks WHERE id = 'task-runtime-tick-approval'").status, "queued");
    assert.equal(get(runtime.db, "SELECT COUNT(*) AS count FROM task_attempts WHERE task_id = 'task-runtime-tick-provider'").count, 0);
    assert.equal(get(runtime.db, "SELECT COUNT(*) AS count FROM task_attempts WHERE task_id = 'task-runtime-tick-approval'").count, 0);
    assert.equal(get(runtime.db, "SELECT COUNT(*) AS count FROM model_calls WHERE task_id IN ('task-runtime-tick-provider', 'task-runtime-tick-approval')").count, 0);

    run(runtime.db, "UPDATE tasks SET status = 'cancelled' WHERE workflow_id = ? AND status IN ('planned', 'queued')", [safePlan.workflow.id]);
    run(runtime.db, "UPDATE workflows SET status = 'cancelled' WHERE id = ?", [safePlan.workflow.id]);
    const idle = await fetch(`${baseUrl}/api/runtime/tick`, { method: "POST", body: "{}" }).then((response) => response.json());
    assert.equal(idle.result.status, "idle");
    assert.equal(idle.result.reason, "no_safe_internal_task");
    assert.equal(idle.result.rejectedReasons.live_or_external_task, 1);
    assert.equal(idle.result.rejectedReasons.approval_bound_task, 1);
    assert.equal(get(runtime.db, "SELECT status FROM tasks WHERE id = 'task-runtime-tick-provider'").status, "queued");
    assert.equal(get(runtime.db, "SELECT consumed_at FROM approvals WHERE id = 'appr-runtime-tick'").consumed_at, null);
  } finally {
    if (app) await app.server.shutdown();
    await closeRuntime(runtime);
  }
});
