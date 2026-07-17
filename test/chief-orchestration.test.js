const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { all, get, openDatabase, run, seedDatabase, toJson } = require("../src/db");
const { ensureAiTeam } = require("../src/runtime/ai-team");
const { ensureAgentTools } = require("../src/runtime/agent-tools");
const { runOnce } = require("../src/runtime/orchestrator");
const {
  prepareChiefSpecialistAssignment,
  requestChiefOrchestration,
  updateChiefAssignmentLifecycle,
  updateReviewedChiefAssignment,
} = require("../src/runtime/chief-orchestration");

function makeRuntime() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-chief-orchestration-"));
  const db = openDatabase(path.join(root, "runtime.sqlite"));
  seedDatabase(db);
  ensureAiTeam(db);
  ensureAgentTools(db);
  return { root, db };
}

function closeRuntime(runtime) {
  runtime.db.close();
  fs.rmSync(runtime.root, { recursive: true, force: true });
}

function insertChiefSource(db, suffix, policy = {}) {
  const ts = "2026-07-17T00:00:00.000Z";
  const workflowId = `wf-chief-${suffix}`;
  const taskId = `task-chief-${suffix}`;
  const runId = `run-chief-${suffix}`;
  run(
    db,
    `INSERT INTO workflows
     (id, venture_id, type, title, status, current_step, priority, metadata, created_at, updated_at)
     VALUES (?, 'venture-digital-products', 'chief_orchestration', 'Chief orchestration',
      'agent_running', '', 1, '{}', ?, ?)`,
    [workflowId, ts, ts],
  );
  run(
    db,
    `INSERT INTO tasks
     (id, workflow_id, venture_id, title, kind, agent, status, priority, cost_budget_cents,
      payload, result, created_at, updated_at)
     VALUES (?, ?, 'venture-digital-products', 'Choose the next specialist',
      'live_ai_worker_execution', 'chief_of_staff', 'completed', 1, 100, ?, '{}', ?, ?)`,
    [
      taskId,
      workflowId,
      toJson({
        subject: "A small digital product",
        chiefOrchestration: {
          enabled: true,
          policy: {
            allowedWorkers: policy.allowedWorkers || ["finance_analyst", "product_builder"],
            allowedModes: policy.allowedModes || ["protected", "supervised_live"],
            maxSpecialistCostCents: policy.maxSpecialistCostCents || 100,
          },
        },
      }),
      ts,
      ts,
    ],
  );
  run(
    db,
    `INSERT INTO agent_runs
     (id, agent_id, workflow_id, task_id, venture_id, mode, status, input_summary,
      output_summary, approval_required, metadata, started_at, completed_at)
     VALUES (?, 'chief_of_staff', ?, ?, 'venture-digital-products',
      'openai-agents-sdk', 'completed', 'Choose next specialist', 'Plan ready',
      1, '{}', ?, ?)`,
    [runId, workflowId, taskId, ts, ts],
  );
  return {
    task: {
      ...get(db, "SELECT * FROM tasks WHERE id = ?", [taskId]),
      payload: JSON.parse(get(db, "SELECT payload FROM tasks WHERE id = ?", [taskId]).payload),
    },
    run: get(db, "SELECT * FROM agent_runs WHERE id = ?", [runId]),
  };
}

function chiefOutput(values) {
  return {
    summary: "Chief selected one bounded next step.",
    recommendation: values.reason,
    roleOutput: {
      specialistNeeded: true,
      specialistWorker: values.workerId,
      specialistObjective: values.objective,
      specialistExpectedOutput: values.expectedOutput,
      specialistMode: values.mode,
      specialistContextClasses: values.contextClasses,
      specialistReason: values.reason,
    },
  };
}

test("Chief queues and closes exactly one fixed-team protected specialist without operator clutter", async () => {
  const runtime = makeRuntime();
  try {
    const source = insertChiefSource(runtime.db, "protected");
    const result = prepareChiefSpecialistAssignment(runtime.db, {
      ...source,
      output: chiefOutput({
        workerId: "finance_analyst",
        objective: "Check the price, cost, and break-even assumptions.",
        expectedOutput: "A short unit-economics recommendation.",
        mode: "protected",
        contextClasses: ["venture", "finance"],
        reason: "Economics should be checked before product work.",
      }),
    });
    assert.equal(result.status, "queued");
    assert.equal(result.assignment.workerId, "finance_analyst");
    assert.equal(result.assignment.requiredReviewer, "chief_of_staff");
    assert.equal(result.task.agent, "finance_analyst");
    assert.equal(result.task.kind, "workbench_proof");
    assert.equal(result.task.cost_budget_cents, 0);
    assert.equal(result.handoff.status, "specialist_assignment_prepared");
    assert.equal(all(runtime.db, "SELECT * FROM approvals").length, 0);

    const repeated = prepareChiefSpecialistAssignment(runtime.db, {
      ...source,
      output: chiefOutput({
        workerId: "finance_analyst",
        objective: "Check the price, cost, and break-even assumptions.",
        expectedOutput: "A short unit-economics recommendation.",
        mode: "protected",
        contextClasses: ["venture", "finance"],
        reason: "Economics should be checked before product work.",
      }),
    });
    assert.equal(repeated.alreadyPrepared, true);
    assert.equal(repeated.task.id, result.task.id);

    const completed = await runOnce(runtime.db, { taskId: result.task.id });
    const closedHandoff = get(runtime.db, "SELECT * FROM agent_handoffs WHERE id = ?", [result.handoff.id]);
    assert.equal(completed.status, "completed");
    assert.equal(closedHandoff.status, "specialist_work_completed");
    assert.ok(closedHandoff.resolved_at);
  } finally {
    closeRuntime(runtime);
  }
});

test("Chief prepares one paid Product Builder approval and requires Quality Reviewer next", () => {
  const runtime = makeRuntime();
  try {
    const source = insertChiefSource(runtime.db, "live");
    const result = prepareChiefSpecialistAssignment(runtime.db, {
      ...source,
      output: chiefOutput({
        workerId: "product_builder",
        objective: "Prepare the smallest useful local product asset.",
        expectedOutput: "A local product draft and asset plan for review.",
        mode: "supervised_live",
        contextClasses: ["venture", "evidence", "production", "legal"],
        reason: "The accepted offer now needs a bounded product draft.",
      }),
    });
    assert.equal(result.status, "waiting_for_approval");
    assert.equal(result.assignment.requiredReviewer, "quality_reviewer");
    assert.equal(result.task.agent, "product_builder");
    assert.equal(result.task.status, "blocked");
    assert.equal(result.approval.status, "pending");
    assert.deepEqual(result.task.payload.contextSnapshot.recordClasses, ["venture", "evidence", "production", "legal"]);
    assert.equal(result.task.payload.liveSpendRequest.parameters.requiredReviewer, "quality_reviewer");
    assert.equal(all(runtime.db, "SELECT * FROM model_calls").length, 0);
    assert.equal(all(runtime.db, "SELECT * FROM agent_context_snapshots").length, 1);
  } finally {
    closeRuntime(runtime);
  }
});

test("Chief orchestration itself is a separate capped approval, not an automatic provider call", () => {
  const runtime = makeRuntime();
  try {
    const ts = "2026-07-17T00:00:00.000Z";
    run(
      runtime.db,
      `INSERT INTO workflows
       (id, venture_id, type, title, status, current_step, priority, metadata, created_at, updated_at)
       VALUES ('wf-chief-request', 'venture-digital-products', 'chief_orchestration',
        'Chief request', 'planned', '', 1, '{}', ?, ?)`,
      [ts, ts],
    );
    const result = requestChiefOrchestration(runtime.db, "wf-chief-request", {
      estimatedCostCents: 100,
      maxSpecialistCostCents: 100,
    });
    assert.equal(result.task.agent, "chief_of_staff");
    assert.equal(result.task.payload.chiefOrchestration.enabled, true);
    assert.equal(result.task.status, "blocked");
    assert.equal(result.approval.status, "pending");
    assert.equal(all(runtime.db, "SELECT * FROM model_calls").length, 0);
  } finally {
    closeRuntime(runtime);
  }
});

test("Chief assignment remains open for quality review and closes on the immutable verdict", () => {
  const runtime = makeRuntime();
  try {
    const source = insertChiefSource(runtime.db, "quality-lifecycle");
    const prepared = prepareChiefSpecialistAssignment(runtime.db, {
      ...source,
      output: chiefOutput({
        workerId: "product_builder",
        objective: "Prepare one exact product visual.",
        expectedOutput: "One local product visual ready for quality review.",
        mode: "supervised_live",
        contextClasses: ["venture", "evidence", "production", "legal"],
        reason: "The selected product needs one bounded visual.",
      }),
    });
    const pending = updateChiefAssignmentLifecycle(runtime.db, prepared.task, {
      status: "specialist_quality_review_pending",
      note: "Exact output is waiting for review.",
      childTaskStatus: "completed",
      resolved: false,
    });
    assert.equal(pending.status, "specialist_quality_review_pending");
    assert.equal(pending.resolved_at, null);

    const reviewTask = {
      payload: {
        liveSpendRequest: {
          parameters: { reviewOfTaskId: prepared.task.id },
        },
      },
    };
    const closed = updateReviewedChiefAssignment(runtime.db, reviewTask, { status: "passed" });
    assert.equal(closed.status, "specialist_work_completed");
    assert.ok(closed.resolved_at);
  } finally {
    closeRuntime(runtime);
  }
});
