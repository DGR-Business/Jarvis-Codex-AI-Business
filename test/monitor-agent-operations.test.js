const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { openDatabase, run, seedDatabase, toJson } = require("../src/db");
const { ensureAiTeam } = require("../src/runtime/ai-team");
const { ensureAgentTools } = require("../src/runtime/agent-tools");
const { generateWeeklyDigest } = require("../src/runtime/executive-digest");
const { requestLiveAiWorker } = require("../src/runtime/live-ai-workers");
const { collectFindings, runMonitorCycle } = require("../src/runtime/monitor");

function makeRuntime() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-monitor-agent-operations-"));
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

function insertWorkflow(db, id) {
  const ts = "2026-07-17T00:00:00.000Z";
  run(
    db,
    `INSERT INTO workflows
     (id, venture_id, type, title, status, current_step, priority, metadata, created_at, updated_at)
     VALUES (?, 'venture-digital-products', 'agent_operations', 'Agent operations proof',
      'agent_running', '', 1, '{}', ?, ?)`,
    [id, ts, ts],
  );
}

test("monitor finds broken quality, context, and Chief assignment links", () => {
  const runtime = makeRuntime();
  try {
    const ts = "2026-07-17T00:00:00.000Z";
    const workflowId = "wf-monitor-agent-links";
    insertWorkflow(runtime.db, workflowId);
    run(
      runtime.db,
      `INSERT INTO deliverables
       (id, workflow_id, venture_id, title, human_name, audience, format, status,
        summary, metadata, created_at, updated_at)
       VALUES ('deliv-monitor-quality', ?, 'venture-digital-products', 'Product draft',
        'Product Draft', 'operator', 'text/markdown', 'quality_review_pending',
        'Waiting for exact review.', '{}', ?, ?)`,
      [workflowId, ts, ts],
    );
    run(
      runtime.db,
      `INSERT INTO tasks
       (id, workflow_id, venture_id, title, kind, agent, status, priority, payload, result, created_at, updated_at)
       VALUES ('task-monitor-context', ?, 'venture-digital-products', 'Live context proof',
        'live_ai_worker_execution', 'demand_validator', 'blocked', 1, ?, '{}', ?, ?)`,
      [
        workflowId,
        toJson({
          contextSnapshot: { snapshotHash: "missing-context-hash" },
          liveSpendRequest: { parameters: { contextSnapshot: { hash: "missing-context-hash" } } },
        }),
        ts,
        ts,
      ],
    );
    run(
      runtime.db,
      `INSERT INTO tasks
       (id, workflow_id, venture_id, title, kind, agent, status, priority, payload, result, created_at, updated_at)
       VALUES ('task-monitor-chief', ?, 'venture-digital-products', 'Chief source',
        'live_ai_worker_execution', 'chief_of_staff', 'completed', 1, '{}', '{}', ?, ?)`,
      [workflowId, ts, ts],
    );
    run(
      runtime.db,
      `INSERT INTO agent_runs
       (id, agent_id, workflow_id, task_id, venture_id, mode, status, input_summary,
        output_summary, approval_required, metadata, started_at, completed_at)
       VALUES ('run-monitor-chief', 'chief_of_staff', ?, 'task-monitor-chief',
        'venture-digital-products', 'openai-agents-sdk', 'completed', 'Choose one worker',
        'Assignment prepared', 1, '{}', ?, ?)`,
      [workflowId, ts, ts],
    );
    run(
      runtime.db,
      `INSERT INTO agent_handoffs
       (id, workflow_id, task_id, from_run_id, from_agent_id, to_agent_id, status,
        reason, summary, decision_needed, risk_level, approval_required, metadata, created_at, updated_at)
       VALUES ('handoff-monitor-chief', ?, 'task-monitor-chief', 'run-monitor-chief',
        'chief_of_staff', 'finance_analyst', 'specialist_assignment_prepared',
        'Check economics.', 'Assignment open.', 'No operator action.', 'low', 0, ?, ?, ?)`,
      [workflowId, toJson({ childTaskId: "task-that-does-not-exist" }), ts, ts],
    );

    const findings = collectFindings(runtime.db);
    assert.ok(findings.some(
      (finding) => finding.category === "quality_review" && finding.entityId === "deliv-monitor-quality",
    ));
    assert.ok(findings.some(
      (finding) => finding.category === "agent_context" && finding.entityId === "task-monitor-context",
    ));
    assert.ok(findings.some(
      (finding) => finding.category === "chief_assignment" && finding.entityId === "handoff-monitor-chief",
    ));

    const monitored = runMonitorCycle(runtime.db);
    assert.equal(monitored.status, "critical");
    assert.ok(monitored.findings.some((finding) => finding.category === "quality_review"));
    assert.ok(monitored.findings.some((finding) => finding.category === "agent_context"));
    assert.ok(monitored.findings.some((finding) => finding.category === "chief_assignment"));
    const digest = generateWeeklyDigest(runtime.db, { at: "2026-07-17T12:00:00.000Z" });
    assert.ok(digest.metrics.operatingIssues >= 3);
    assert.ok(digest.nextActions.some((item) => /operating issue/i.test(item)));
  } finally {
    closeRuntime(runtime);
  }
});

test("monitor accepts a correctly stored task-scoped worker context", () => {
  const runtime = makeRuntime();
  try {
    const workflowId = "wf-monitor-valid-context";
    insertWorkflow(runtime.db, workflowId);
    const requested = requestLiveAiWorker(runtime.db, workflowId, {
      requestKey: "valid_context",
      worker: "demand_validator",
      estimatedCostCents: 100,
      expectedOutput: "Assess the supplied venture evidence.",
      contextClasses: ["venture", "evidence"],
      effects: [],
    });
    const contextFindings = collectFindings(runtime.db).filter(
      (finding) => finding.category === "agent_context" && finding.entityId === requested.task.id,
    );

    assert.deepEqual(contextFindings, []);
  } finally {
    closeRuntime(runtime);
  }
});
