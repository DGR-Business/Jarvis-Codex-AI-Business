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
const {
  installActivatedCommercialTestFixture,
} = require("./support/commercial-authority-fixture");

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
    installActivatedCommercialTestFixture(runtime.db, {
      suffix: "monitor-valid-context",
      workflowIds: [workflowId],
    });
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

test("monitor retires an older receipt warning after its exact retry completes cleanly", () => {
  const runtime = makeRuntime();
  try {
    const workflowId = "wf-monitor-reviewed-retry";
    const ts = "2026-07-17T01:00:00.000Z";
    insertWorkflow(runtime.db, workflowId);
    run(
      runtime.db,
      `INSERT INTO tasks
       (id, workflow_id, venture_id, title, kind, agent, status, outcome_status,
        priority, payload, result, created_at, updated_at)
       VALUES
       ('task-monitor-prior', ?, 'venture-digital-products', 'Prior research',
        'live_ai_worker_execution', 'demand_validator', 'failed',
        'known_provider_result_needs_review', 1, '{}', '{}', ?, ?),
       ('task-monitor-retry', ?, 'venture-digital-products', 'Corrected research',
        'live_ai_worker_execution', 'demand_validator', 'completed', 'known', 1, ?, '{}', ?, ?)`,
      [
        workflowId,
        ts,
        ts,
        workflowId,
        toJson({
          liveSpendRequest: {
            parameters: {
              retry: { number: 2, priorTaskId: "task-monitor-prior", operatorAuthorized: true },
            },
          },
        }),
        "2026-07-17T01:05:00.000Z",
        "2026-07-17T01:06:00.000Z",
      ],
    );
    run(
      runtime.db,
      `INSERT INTO task_attempts
       (id, task_id, workflow_id, venture_id, claim_token, status, outcome_status,
        started_at, completed_at, metadata)
       VALUES
       ('attempt-monitor-prior', 'task-monitor-prior', ?, 'venture-digital-products',
        'claim-monitor-prior', 'completed', 'known_provider_result_needs_review', ?, ?, '{}'),
       ('attempt-monitor-retry', 'task-monitor-retry', ?, 'venture-digital-products',
        'claim-monitor-retry', 'completed', 'known', ?, ?, '{}')`,
      [workflowId, ts, ts, workflowId, "2026-07-17T01:05:00.000Z", "2026-07-17T01:06:00.000Z"],
    );
    run(
      runtime.db,
      `INSERT INTO agent_runs
       (id, agent_id, workflow_id, task_id, venture_id, mode, status, input_summary,
        output_summary, eval_status, metadata, started_at, completed_at)
       VALUES
       ('run-monitor-prior', 'demand_validator', ?, 'task-monitor-prior',
        'venture-digital-products', 'openai-agents-sdk', 'failed', 'Prior input',
        'Unusable prior result', 'needs_review', '{}', ?, ?),
       ('run-monitor-retry', 'demand_validator', ?, 'task-monitor-retry',
        'venture-digital-products', 'openai-agents-sdk', 'completed', 'Corrected input',
        'Usable corrected result', 'passed', '{}', ?, ?)`,
      [
        workflowId,
        ts,
        ts,
        workflowId,
        "2026-07-17T01:05:00.000Z",
        "2026-07-17T01:06:00.000Z",
      ],
    );
    run(
      runtime.db,
      `INSERT INTO agent_eval_results
       (id, run_id, agent_id, task_id, status, score, criteria, findings, metadata, created_at)
       VALUES ('eval-monitor-retry', 'run-monitor-retry', 'demand_validator',
        'task-monitor-retry', 'passed', 100, '[]', '[]', '{}', ?)`,
      ["2026-07-17T01:06:00.000Z"],
    );
    run(
      runtime.db,
      `INSERT INTO agent_run_receipts
       (id, attempt_id, run_id, task_id, sequence, status, outcome_status,
        snapshot_hash, previous_hash, receipt_hash, missing_fields, warnings, receipt, created_at)
       VALUES
       ('receipt-monitor-prior', 'attempt-monitor-prior', 'run-monitor-prior',
        'task-monitor-prior', 1, 'needs_review', 'known_provider_result_needs_review',
        'snapshot-monitor-prior', NULL, 'hash-monitor-prior', '[]',
        '["No grounded sources."]', '{}', ?),
       ('receipt-monitor-retry', 'attempt-monitor-retry', 'run-monitor-retry',
        'task-monitor-retry', 1, 'complete', 'known',
        'snapshot-monitor-retry', NULL, 'hash-monitor-retry', '[]', '[]', '{}', ?)`,
      [ts, "2026-07-17T01:06:00.000Z"],
    );

    const findings = collectFindings(runtime.db);
    assert.equal(findings.some(
      (finding) => finding.category === "agent_receipts" && finding.entityId === "run-monitor-prior",
    ), false);
  } finally {
    closeRuntime(runtime);
  }
});

test("monitor never hides an incomplete paid-attempt receipt behind a successful retry", () => {
  const runtime = makeRuntime();
  try {
    const workflowId = "wf-monitor-incomplete-ancestor";
    const ts = "2026-07-17T02:00:00.000Z";
    insertWorkflow(runtime.db, workflowId);
    const retryPayload = toJson({
      liveSpendRequest: {
        parameters: {
          retry: { number: 1, priorTaskId: "task-monitor-incomplete", operatorAuthorized: true },
        },
      },
    });
    run(
      runtime.db,
      `INSERT INTO tasks
       (id, workflow_id, venture_id, title, kind, agent, status, outcome_status,
        priority, payload, result, created_at, updated_at)
       VALUES
       ('task-monitor-incomplete', ?, 'venture-digital-products', 'Incomplete provider record',
        'live_ai_worker_execution', 'demand_validator', 'failed',
        'known_provider_result_needs_review', 1, '{}', '{}', ?, ?),
       ('task-monitor-complete-retry', ?, 'venture-digital-products', 'Successful retry',
        'live_ai_worker_execution', 'demand_validator', 'completed', 'known',
        1, ?, '{}', ?, ?)`,
      [workflowId, ts, ts, workflowId, retryPayload, ts, ts],
    );
    run(
      runtime.db,
      `INSERT INTO task_attempts
       (id, task_id, workflow_id, venture_id, claim_token, status, outcome_status,
        started_at, completed_at, metadata)
       VALUES
       ('attempt-monitor-incomplete', 'task-monitor-incomplete', ?, 'venture-digital-products',
        'claim-monitor-incomplete', 'completed', 'known_provider_result_needs_review', ?, ?, '{}'),
       ('attempt-monitor-complete-retry', 'task-monitor-complete-retry', ?, 'venture-digital-products',
        'claim-monitor-complete-retry', 'completed', 'known', ?, ?, '{}')`,
      [workflowId, ts, ts, workflowId, ts, ts],
    );
    run(
      runtime.db,
      `INSERT INTO agent_runs
       (id, agent_id, workflow_id, task_id, venture_id, mode, status, input_summary,
        output_summary, eval_status, metadata, started_at, completed_at)
       VALUES
       ('run-monitor-incomplete', 'demand_validator', ?, 'task-monitor-incomplete',
        'venture-digital-products', 'openai-agents-sdk', 'failed', 'Input',
        'Incomplete record', 'needs_review', '{}', ?, ?),
       ('run-monitor-complete-retry', 'demand_validator', ?, 'task-monitor-complete-retry',
        'venture-digital-products', 'openai-agents-sdk', 'completed', 'Input',
        'Accepted result', 'passed', '{}', ?, ?)`,
      [workflowId, ts, ts, workflowId, ts, ts],
    );
    run(
      runtime.db,
      `INSERT INTO agent_eval_results
       (id, run_id, agent_id, task_id, status, score, criteria, findings, metadata, created_at)
       VALUES ('eval-monitor-complete-retry', 'run-monitor-complete-retry', 'demand_validator',
        'task-monitor-complete-retry', 'passed', 100, '[]', '[]', '{}', ?)`,
      [ts],
    );
    run(
      runtime.db,
      `INSERT INTO agent_run_receipts
       (id, attempt_id, run_id, task_id, sequence, status, outcome_status,
        snapshot_hash, previous_hash, receipt_hash, missing_fields, warnings, receipt, created_at)
       VALUES
       ('receipt-monitor-incomplete', 'attempt-monitor-incomplete', 'run-monitor-incomplete',
        'task-monitor-incomplete', 1, 'incomplete', 'known_provider_result_needs_review',
        'snapshot-monitor-incomplete', NULL, 'hash-monitor-incomplete',
        '["providerRequestId"]', '[]', '{}', ?),
       ('receipt-monitor-complete-retry', 'attempt-monitor-complete-retry',
        'run-monitor-complete-retry', 'task-monitor-complete-retry', 1, 'complete', 'known',
        'snapshot-monitor-complete-retry', NULL, 'hash-monitor-complete-retry',
        '[]', '[]', '{}', ?)`,
      [ts, ts],
    );

    const findings = collectFindings(runtime.db);
    assert.equal(findings.some(
      (finding) => finding.category === "agent_receipts"
        && finding.entityId === "run-monitor-incomplete"
        && finding.severity === "error",
    ), true);
  } finally {
    closeRuntime(runtime);
  }
});
