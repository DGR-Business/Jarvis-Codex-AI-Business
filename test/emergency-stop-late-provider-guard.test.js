const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  recordLiveWorkerModelCall,
  runLiveAiWorkerTask,
} = require("../src/adapters/live-ai-worker");
const { runResearchTask } = require("../src/adapters/research");
const { fromJson, get, now, openDatabase, run, seedDatabase } = require("../src/db");
const { generateApprovalPack } = require("../src/runtime/approval-pack");
const { resolveReservation } = require("../src/runtime/cost-ledger");
const { markEmergencyStopUnknown } = require("../src/runtime/runtime-supervisor");
const {
  assertTaskClaimActive,
  assertTaskClaimOwned,
  claimNextTask,
} = require("../src/runtime/task-claims");

const MANAGED_ENVIRONMENT = [
  "JARVIS_DISABLE_LIVE_AI_WORKER_ADAPTER",
  "JARVIS_DISABLE_LIVE_RESEARCH_ADAPTER",
  "JARVIS_ENABLE_LIVE_MODELS",
  "JARVIS_ENABLE_LIVE_RESEARCH",
  "NODE_TLS_REJECT_UNAUTHORIZED",
  "OPENAI_API_KEY",
  "OPENAI_BASE_URL",
  "OPENAI_RESPONSES_URL",
  "PANTHEON_DISABLE_LIVE_AI_WORKER_ADAPTER",
  "PANTHEON_DISABLE_LIVE_RESEARCH_ADAPTER",
  "PANTHEON_ENABLE_LIVE_MODELS",
  "PANTHEON_ENABLE_LIVE_RESEARCH",
];

function snapshotEnvironment() {
  return Object.fromEntries(MANAGED_ENVIRONMENT.map((name) => [name, process.env[name]]));
}

function restoreEnvironment(snapshot) {
  for (const name of MANAGED_ENVIRONMENT) {
    if (snapshot[name] === undefined) delete process.env[name];
    else process.env[name] = snapshot[name];
  }
}

function enableTestProviders() {
  process.env.OPENAI_API_KEY = "test-only-late-provider-key";
  process.env.PANTHEON_ENABLE_LIVE_MODELS = "1";
  process.env.PANTHEON_ENABLE_LIVE_RESEARCH = "1";
  delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  delete process.env.OPENAI_BASE_URL;
  delete process.env.OPENAI_RESPONSES_URL;
  delete process.env.PANTHEON_DISABLE_LIVE_AI_WORKER_ADAPTER;
  delete process.env.PANTHEON_DISABLE_LIVE_RESEARCH_ADAPTER;
  delete process.env.JARVIS_DISABLE_LIVE_AI_WORKER_ADAPTER;
  delete process.env.JARVIS_DISABLE_LIVE_RESEARCH_ADAPTER;
}

function runtimeDb(name, options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `pantheon-late-provider-${name}-`));
  const db = openDatabase(path.join(root, "runtime.sqlite"), {
    clock: options.clock,
  });
  seedDatabase(db);
  return { db, root };
}

test("emergency-stop custody uses one injected database timestamp across every projection", () => {
  const dispatchedAt = "2026-08-02T02:00:00.000Z";
  let clockValue = dispatchedAt;
  const runtime = runtimeDb("database-clock", { clock: () => clockValue });
  try {
    const proof = claimProviderTask(runtime.db, "database-clock");
    run(
      runtime.db,
      `UPDATE tasks
       SET started_at = ?, updated_at = ?, outcome_status = 'provider_dispatched'
       WHERE id = ?`,
      [dispatchedAt, dispatchedAt, proof.taskId],
    );
    run(
      runtime.db,
      `UPDATE task_attempts
       SET started_at = ?, outcome_status = 'provider_dispatched',
           provider_dispatched_at = ?,
           metadata = json_patch(
             CASE WHEN json_valid(metadata) THEN metadata ELSE '{}' END,
             ?
           )
       WHERE id = ?`,
      [
        dispatchedAt,
        dispatchedAt,
        JSON.stringify({ providerCallOccurred: true }),
        proof.claim.attemptId,
      ],
    );

    clockValue = "2026-08-02T02:00:00.001Z";
    assert.equal(
      get(runtime.db, "SELECT pantheon_current_time() AS value").value,
      clockValue,
    );
    assert.deepEqual(markEmergencyStopUnknown(runtime.db), {
      affectedTasks: 1,
      providerOutcomesUnknown: 1,
    });

    const task = get(
      runtime.db,
      "SELECT status, outcome_status, completed_at, updated_at, result FROM tasks WHERE id = ?",
      [proof.taskId],
    );
    const attempt = get(
      runtime.db,
      `SELECT status, outcome_status, error_kind, completed_at, metadata
       FROM task_attempts WHERE id = ?`,
      [proof.claim.attemptId],
    );
    const event = get(
      runtime.db,
      `SELECT ts, metadata FROM events
       WHERE type = 'runtime.emergency_stop_recorded'
       ORDER BY id DESC LIMIT 1`,
    );
    assert.deepEqual(
      [task.completed_at, task.updated_at, JSON.parse(task.result).stoppedAt],
      [clockValue, clockValue, clockValue],
    );
    assert.deepEqual(
      [attempt.completed_at, JSON.parse(attempt.metadata).stoppedAt, event.ts],
      [clockValue, clockValue, clockValue],
    );
    assert.deepEqual(JSON.parse(event.metadata).affectedTaskIds, [proof.taskId]);
    assert.equal(task.status, "needs_attention");
    assert.equal(task.outcome_status, "unknown");
    assert.equal(attempt.status, "needs_attention");
    assert.equal(attempt.outcome_status, "unknown");
    assert.equal(attempt.error_kind, "operator_emergency_stop");
  } finally {
    closeRuntime(runtime);
  }
});

function closeRuntime(runtime) {
  runtime.db.close();
  fs.rmSync(runtime.root, { recursive: true, force: true });
}

function claimProviderTask(db, suffix, kind = "live_ai_worker_execution", agent = "demand_validator") {
  const timestamp = now();
  const workflowId = `wf-late-provider-${suffix}`;
  const taskId = `task-late-provider-${suffix}`;
  run(
    db,
    `INSERT INTO workflows
     (id, venture_id, type, title, status, current_step, priority, metadata, created_at, updated_at)
     VALUES (?, 'venture-digital-products', 'runtime_proof', ?, 'ready',
             'provider call in progress', 1, '{}', ?, ?)`,
    [workflowId, `Late provider proof ${suffix}`, timestamp, timestamp],
  );
  run(
    db,
    `INSERT INTO tasks
     (id, workflow_id, venture_id, title, kind, agent, status, priority,
      cost_budget_cents, payload, result, outcome_status, created_at, updated_at)
     VALUES (?, ?, 'venture-digital-products', ?, ?, ?, 'queued', 1,
             100, '{}', '{}', 'not_started', ?, ?)`,
    [taskId, workflowId, `Late provider proof ${suffix}`, kind, agent, timestamp, timestamp],
  );
  const claim = claimNextTask(db, { taskId, claimant: "late-provider-guard-test" });
  assert.ok(claim);
  return { claim, workflowId, taskId };
}

function deferredFetch() {
  let resolveResponse;
  let rejectResponse;
  let notifyStarted;
  const started = new Promise((resolve) => {
    notifyStarted = resolve;
  });
  const fetchImpl = () => {
    notifyStarted();
    return new Promise((resolve, reject) => {
      resolveResponse = resolve;
      rejectResponse = reject;
    });
  };
  return {
    fetchImpl,
    started,
    complete(responseId) {
      resolveResponse({
        ok: true,
        status: 200,
        async json() {
          return {
            id: responseId,
            output: [],
            usage: { input_tokens: 3, output_tokens: 2, total_tokens: 5 },
          };
        },
      });
    },
    fail(error = new Error("provider connection failed late")) {
      rejectResponse(error);
    },
  };
}

test("claim ownership survives an intermediate blocked state but not a terminal attempt", () => {
  const runtime = runtimeDb("claim-ownership");
  try {
    const proof = claimProviderTask(runtime.db, "claim-ownership");
    run(runtime.db, "UPDATE tasks SET status = 'blocked' WHERE id = ?", [proof.taskId]);

    assert.equal(assertTaskClaimOwned(runtime.db, proof.claim, "blocked-state proof"), true);
    assert.throws(
      () => assertTaskClaimActive(runtime.db, proof.claim, "strict active proof"),
      (error) => error.code === "task_claim_lost" && error.taskId === proof.taskId,
    );

    run(
      runtime.db,
      "UPDATE task_attempts SET status = 'needs_attention' WHERE id = ?",
      [proof.claim.attemptId],
    );
    assert.throws(
      () => assertTaskClaimOwned(runtime.db, proof.claim, "terminal-attempt proof"),
      (error) => error.code === "task_claim_lost" && error.taskId === proof.taskId,
    );
  } finally {
    closeRuntime(runtime);
  }
});

test("approval-pack rendering refuses to hold SQLite's writer transaction", () => {
  const runtime = runtimeDb("approval-pack-transaction-guard");
  try {
    runtime.db.exec("BEGIN IMMEDIATE");
    assert.throws(
      () => generateApprovalPack(
        runtime.db,
        "workflow-not-needed-for-transaction-proof",
        { requireOutsideTransaction: true },
      ),
      (error) => error.code === "approval_pack_transaction_unsafe",
    );
    assert.equal(runtime.db.isTransaction, true);
    runtime.db.exec("ROLLBACK");
    assert.equal(runtime.db.isTransaction, false);
  } finally {
    if (runtime.db.isTransaction) runtime.db.exec("ROLLBACK");
    closeRuntime(runtime);
  }
});

test("a late live-worker response cannot overwrite emergency-stop truth or resolve an unknown reservation", async () => {
  const previousEnvironment = snapshotEnvironment();
  const runtime = runtimeDb("live-worker");
  try {
    enableTestProviders();
    const proof = claimProviderTask(runtime.db, "live-worker");
    run(
      runtime.db,
      `INSERT INTO budget_reservations
       (id, venture_id, workflow_id, task_id, status, amount_cents, currency, reserved_at, metadata)
       VALUES ('reservation-late-provider-live-worker', 'venture-digital-products', ?, ?,
               'reserved', 100, 'AUD', ?, '{}')`,
      [proof.workflowId, proof.taskId, now()],
    );
    const deferred = deferredFetch();
    const execution = runLiveAiWorkerTask(
      runtime.db,
      proof.claim.task,
      {
        id: "demand_validator",
        name: "Demand Validator",
        role: "Validate supplied demand evidence.",
        instructions: "Return a bounded decision.",
        approval_policy: { mustPauseFor: [] },
        outputContract: { required: [] },
      },
      { allowedTools: [], blockedTools: [] },
      {
        apiKey: process.env.OPENAI_API_KEY,
        fetchImpl: deferred.fetchImpl,
        taskClaim: proof.claim,
      },
    );
    await deferred.started;

    const dispatchCall = get(
      runtime.db,
      "SELECT * FROM model_calls WHERE task_id = ? ORDER BY created_at DESC LIMIT 1",
      [proof.taskId],
    );
    assert.equal(dispatchCall.status, "dispatching");
    assert.deepEqual(markEmergencyStopUnknown(runtime.db), {
      affectedTasks: 1,
      providerOutcomesUnknown: 1,
    });

    deferred.complete("resp-late-live-worker");
    await assert.rejects(
      execution,
      (error) => error.code === "task_claim_lost" && error.taskId === proof.taskId,
    );

    const stoppedCall = get(runtime.db, "SELECT * FROM model_calls WHERE id = ?", [dispatchCall.id]);
    assert.equal(stoppedCall.status, "needs_attention");
    assert.equal(stoppedCall.outcome_status, "unknown");
    assert.equal(stoppedCall.cost_status, "unknown");
    assert.equal(stoppedCall.error_kind, "operator_emergency_stop");
    assert.equal(fromJson(stoppedCall.metadata).emergencyStop, true);
    assert.equal(get(runtime.db, "SELECT COUNT(*) AS count FROM costs WHERE task_id = ?", [proof.taskId]).count, 0);

    assert.throws(
      () => recordLiveWorkerModelCall(
        runtime.db,
        proof.claim.task,
        { id: "resp-late-live-worker", usage: { input_tokens: 3, output_tokens: 2 } },
        100,
        "gpt-test",
        "provider_completed",
        { modelCallId: dispatchCall.id, providerResponseReceived: true },
      ),
      (error) => error.code === "task_claim_lost" && error.modelCallId === dispatchCall.id,
    );
    assert.equal(
      get(runtime.db, "SELECT error_kind FROM model_calls WHERE id = ?", [dispatchCall.id]).error_kind,
      "operator_emergency_stop",
    );

    for (const status of ["released", "incurred_estimate"]) {
      assert.throws(
        () => resolveReservation(runtime.db, proof.taskId, status, { amountCents: 0 }),
        (error) => error.code === "reservation_reconciliation_required"
          && error.taskId === proof.taskId,
      );
    }
    assert.equal(
      get(runtime.db, "SELECT status FROM budget_reservations WHERE task_id = ?", [proof.taskId]).status,
      "unknown",
    );
    const reconciled = resolveReservation(runtime.db, proof.taskId, "reconciled", { amountCents: 35 });
    assert.equal(reconciled.status, "reconciled");
    assert.equal(reconciled.amount_cents, 35);
  } finally {
    closeRuntime(runtime);
    restoreEnvironment(previousEnvironment);
  }
});

test("a late research response exits before it can rewrite emergency-stop evidence", async () => {
  const previousEnvironment = snapshotEnvironment();
  const runtime = runtimeDb("research");
  try {
    enableTestProviders();
    const proof = claimProviderTask(runtime.db, "research", "market_research", "researcher");
    const deferred = deferredFetch();
    const execution = runResearchTask(
      runtime.db,
      proof.claim.task,
      {
        id: proof.workflowId,
        title: "Late research response proof",
        metadata: { subject: "operator toolkit", channel: "digital marketplace" },
      },
      { raw_text: "Review the bounded opportunity." },
      {
        live: true,
        apiKey: process.env.OPENAI_API_KEY,
        fetchImpl: deferred.fetchImpl,
        taskClaim: proof.claim,
      },
    );
    await deferred.started;
    const dispatchCall = get(
      runtime.db,
      "SELECT * FROM model_calls WHERE task_id = ? ORDER BY created_at DESC LIMIT 1",
      [proof.taskId],
    );
    assert.equal(dispatchCall.status, "dispatching");

    markEmergencyStopUnknown(runtime.db);
    deferred.complete("resp-late-research");
    await assert.rejects(
      execution,
      (error) => error.code === "task_claim_lost" && error.taskId === proof.taskId,
    );

    const stoppedCall = get(runtime.db, "SELECT * FROM model_calls WHERE id = ?", [dispatchCall.id]);
    assert.equal(stoppedCall.status, "needs_attention");
    assert.equal(stoppedCall.outcome_status, "unknown");
    assert.equal(stoppedCall.cost_status, "unknown");
    assert.equal(stoppedCall.error_kind, "operator_emergency_stop");
    assert.equal(get(runtime.db, "SELECT COUNT(*) AS count FROM research_runs WHERE task_id = ?", [proof.taskId]).count, 0);
    assert.equal(get(runtime.db, "SELECT COUNT(*) AS count FROM costs WHERE task_id = ?", [proof.taskId]).count, 0);
  } finally {
    closeRuntime(runtime);
    restoreEnvironment(previousEnvironment);
  }
});

test("a late provider failure cannot replace emergency-stop evidence with an adapter failure", async () => {
  const previousEnvironment = snapshotEnvironment();
  const runtime = runtimeDb("late-failure");
  try {
    enableTestProviders();
    const proof = claimProviderTask(runtime.db, "late-failure");
    const deferred = deferredFetch();
    const execution = runLiveAiWorkerTask(
      runtime.db,
      proof.claim.task,
      {
        id: "demand_validator",
        name: "Demand Validator",
        role: "Validate supplied demand evidence.",
        instructions: "Return a bounded decision.",
        approval_policy: { mustPauseFor: [] },
        outputContract: { required: [] },
      },
      { allowedTools: [], blockedTools: [] },
      {
        apiKey: process.env.OPENAI_API_KEY,
        fetchImpl: deferred.fetchImpl,
        taskClaim: proof.claim,
      },
    );
    await deferred.started;
    const dispatchCall = get(
      runtime.db,
      "SELECT * FROM model_calls WHERE task_id = ? ORDER BY created_at DESC LIMIT 1",
      [proof.taskId],
    );
    assert.equal(dispatchCall.status, "dispatching");

    markEmergencyStopUnknown(runtime.db);
    deferred.fail();
    await assert.rejects(
      execution,
      (error) => error.code === "task_claim_lost" && error.taskId === proof.taskId,
    );

    const stoppedCall = get(runtime.db, "SELECT * FROM model_calls WHERE id = ?", [dispatchCall.id]);
    assert.equal(stoppedCall.status, "needs_attention");
    assert.equal(stoppedCall.outcome_status, "unknown");
    assert.equal(stoppedCall.cost_status, "unknown");
    assert.equal(stoppedCall.error_kind, "operator_emergency_stop");
    assert.match(stoppedCall.error, /emergency stop|provider dispatch/i);
    assert.equal(get(runtime.db, "SELECT COUNT(*) AS count FROM costs WHERE task_id = ?", [proof.taskId]).count, 0);
  } finally {
    closeRuntime(runtime);
    restoreEnvironment(previousEnvironment);
  }
});
