const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { openDatabase, get, run, seedDatabase, toJson } = require("../src/db");
const { createCommandPlan } = require("../src/runtime/planner");
const { collectFindings, runMonitorCycle } = require("../src/runtime/monitor");
const { getCockpitState, getSystemState } = require("../src/runtime/cockpit-state");
const { ensureSchedulerJobs } = require("../src/runtime/scheduler");

function runtimeDb(name) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `jarvis-monitor-contract-${name}-`));
  const db = openDatabase(path.join(root, "runtime.sqlite"));
  seedDatabase(db);
  ensureSchedulerJobs(db);
  return { db, root };
}

function closeRuntime(runtime) {
  runtime.db.close();
  fs.rmSync(runtime.root, { recursive: true, force: true });
}

test("monitor surfaces stalled queue, unknown outcome, unsafe retry, denied continuation, and unknown cost", () => {
  const runtime = runtimeDb("coverage");
  try {
    const plan = createCommandPlan(runtime.db, {
      text: "Prepare a digital product evidence plan",
      mode: "plan_only",
      ventureId: "venture-digital-products",
    });
    const task = get(runtime.db, "SELECT * FROM tasks WHERE id = ?", [plan.tasks[0].id]);
    const queuedTask = get(runtime.db, "SELECT * FROM tasks WHERE id = ?", [plan.tasks[1].id]);
    const old = new Date(Date.now() - 26 * 60 * 60 * 1000).toISOString();
    const recent = new Date().toISOString();
    run(runtime.db, "UPDATE tasks SET updated_at = ? WHERE id = ?", [old, queuedTask.id]);
    run(
      runtime.db,
      `INSERT INTO task_attempts
       (id, task_id, workflow_id, venture_id, claim_token, status, outcome_status,
        provider_request_id, started_at, completed_at, metadata)
       VALUES ('attempt-unknown-proof', ?, ?, 'venture-digital-products', 'claim-unknown-proof',
               'needs_attention', 'unknown', 'response-unknown-proof', ?, ?, '{}')`,
      [task.id, task.workflow_id, old, old],
    );
    run(
      runtime.db,
      `INSERT INTO task_attempts
       (id, task_id, workflow_id, venture_id, claim_token, status, outcome_status,
        started_at, completed_at, metadata)
       VALUES ('attempt-unsafe-retry-proof', ?, ?, 'venture-digital-products', 'claim-retry-proof',
               'completed', 'known', ?, ?, '{}')`,
      [task.id, task.workflow_id, recent, recent],
    );
    run(
      runtime.db,
      `INSERT INTO approvals
       (id, workflow_id, venture_id, task_id, scope, title, status, risk_level,
        requested_by, requested_at, decided_at, payload)
       VALUES ('approval-denied-proof', ?, 'venture-digital-products', ?, 'test',
               'Stopped work', 'rejected', 'medium', 'test', ?, ?, '{}')`,
      [task.workflow_id, task.id, old, old],
    );
    run(
      runtime.db,
      "UPDATE tasks SET approval_id = 'approval-denied-proof', status = 'completed', updated_at = ? WHERE id = ?",
      [recent, task.id],
    );
    run(
      runtime.db,
      `INSERT INTO costs
       (id, workflow_id, venture_id, task_id, category, source, status,
        amount_cents, currency, occurred_at, metadata)
       VALUES ('cost-unknown-proof', ?, 'venture-digital-products', ?, 'ai_worker',
               'openai', 'unknown', 25, 'AUD', ?, ?)`,
      [task.workflow_id, task.id, recent, toJson({ reason: "provider outcome unresolved" })],
    );

    const findings = collectFindings(runtime.db, { staleQueuedMinutes: 60 });
    assert.ok(findings.some((item) => item.category === "queue" && item.entityId === queuedTask.id));
    assert.ok(findings.some((item) => item.category === "unknown_outcome" && item.entityId === "attempt-unknown-proof"));
    assert.ok(findings.some((item) => item.category === "unsafe_retry" && item.entityId === "attempt-unsafe-retry-proof"));
    assert.ok(findings.some((item) => item.category === "approval_integrity" && item.entityId === task.id));
    assert.ok(findings.some((item) => item.category === "cost" && item.entityId === "unknown_costs"));
  } finally {
    closeRuntime(runtime);
  }
});

test("aggregate approval finding keeps one identity when the pending count changes", () => {
  const runtime = runtimeDb("stable-fingerprint");
  const ts = new Date().toISOString();
  try {
    run(
      runtime.db,
      `INSERT INTO approvals
       (id, scope, title, status, risk_level, requested_by, requested_at, payload)
       VALUES ('approval-one', 'test', 'First decision', 'pending', 'low', 'test', ?, '{}')`,
      [ts],
    );
    runMonitorCycle(runtime.db);
    const first = get(
      runtime.db,
      "SELECT id, fingerprint, occurrence_count FROM monitor_findings WHERE category = 'approvals' AND status = 'open'",
    );

    run(
      runtime.db,
      `INSERT INTO approvals
       (id, scope, title, status, risk_level, requested_by, requested_at, payload)
       VALUES ('approval-two', 'test', 'Second decision', 'pending', 'low', 'test', ?, '{}')`,
      [ts],
    );
    runMonitorCycle(runtime.db);
    const second = get(
      runtime.db,
      "SELECT id, fingerprint, occurrence_count, title FROM monitor_findings WHERE category = 'approvals' AND status = 'open'",
    );
    assert.equal(second.id, first.id);
    assert.equal(second.fingerprint, first.fingerprint);
    assert.equal(second.occurrence_count, first.occurrence_count + 1);
    assert.equal(second.title, "2 approvals pending");
  } finally {
    closeRuntime(runtime);
  }
});

test("System Checks exposes current monitor findings with ordinary next actions", () => {
  const runtime = runtimeDb("operator-surface");
  const ts = new Date().toISOString();
  try {
    run(
      runtime.db,
      `INSERT INTO approvals
       (id, scope, title, status, risk_level, requested_by, requested_at, payload)
       VALUES ('approval-surface-proof', 'test', 'Review this exact test', 'pending',
               'medium', 'test', ?, '{}')`,
      [ts],
    );
    runMonitorCycle(runtime.db);
    const monitor = getSystemState(runtime.db).checks.monitor;
    const approvalFinding = monitor.items.find((item) => item.category === "approvals");
    assert.ok(monitor.openCount >= 1);
    assert.equal(approvalFinding.action.kind, "view");
    assert.equal(approvalFinding.action.id, "decisions");
    assert.equal(approvalFinding.action.label, "Review decisions");
  } finally {
    closeRuntime(runtime);
  }
});

test("Command Center presents one consequential choice while preserving the full Decisions queue", () => {
  const runtime = runtimeDb("one-choice");
  const ts = new Date().toISOString();
  try {
    for (const [id, title, risk] of [
      ["approval-choice-one", "Choose the first move", "high"],
      ["approval-choice-two", "Choose the second move", "medium"],
    ]) {
      run(
        runtime.db,
        `INSERT INTO approvals
         (id, scope, title, status, risk_level, requested_by, requested_at, payload)
         VALUES (?, 'test', ?, 'pending', ?, 'test', ?, '{}')`,
        [id, title, risk, ts],
      );
    }
    const cockpit = getCockpitState(runtime.db);
    const decisions = cockpit.importantWork.filter((item) => item.type === "decision");
    assert.equal(decisions.length, 1);
    assert.equal(decisions[0].id, "approval-choice-one");
    assert.equal(
      get(runtime.db, "SELECT COUNT(*) AS count FROM approvals WHERE status = 'pending'").count,
      2,
    );
  } finally {
    closeRuntime(runtime);
  }
});
