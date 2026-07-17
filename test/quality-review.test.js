const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { all, get, openDatabase, run, seedDatabase, toJson } = require("../src/db");
const { ensureAiTeam, findAgentDefinition } = require("../src/runtime/ai-team");
const { ensureAgentTools } = require("../src/runtime/agent-tools");
const { buildWorkerModelPacket } = require("../src/runtime/agent-model-contracts");
const {
  prepareRequiredQualityReview,
  recordCompletedQualityReview,
} = require("../src/runtime/quality-review");

function makeRuntime() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-quality-review-"));
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

function hydrateTask(db, id) {
  const row = get(db, "SELECT * FROM tasks WHERE id = ?", [id]);
  return { ...row, payload: JSON.parse(row.payload), result: JSON.parse(row.result) };
}

function insertSourceOutput(db, suffix) {
  const ts = "2026-07-17T00:00:00.000Z";
  const workflowId = `wf-quality-${suffix}`;
  const taskId = `task-product-${suffix}`;
  const runId = `run-product-${suffix}`;
  const deliverableId = `deliverable-product-${suffix}`;
  run(
    db,
    `INSERT INTO workflows
     (id, venture_id, type, title, status, current_step, priority, metadata, created_at, updated_at)
     VALUES (?, 'venture-digital-products', 'product_build', 'Product draft',
      'agent_running', '', 1, '{}', ?, ?)`,
    [workflowId, ts, ts],
  );
  run(
    db,
    `INSERT INTO tasks
     (id, workflow_id, venture_id, title, kind, agent, status, priority, cost_budget_cents,
      payload, result, created_at, updated_at)
     VALUES (?, ?, 'venture-digital-products', 'Prepare smallest useful product',
      'live_ai_worker_execution', 'product_builder', 'completed', 1, 100, ?, '{}', ?, ?)`,
    [
      taskId,
      workflowId,
      toJson({
        liveSpendRequest: {
          parameters: { requiredReviewer: "quality_reviewer" },
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
     VALUES (?, 'product_builder', ?, ?, 'venture-digital-products',
      'openai-agents-sdk', 'completed', 'Prepare product', 'Product draft ready',
      1, '{}', ?, ?)`,
    [runId, workflowId, taskId, ts, ts],
  );
  run(
    db,
    `INSERT INTO deliverables
     (id, workflow_id, task_id, venture_id, title, human_name, audience, format,
      status, summary, metadata, content_hash, version, created_at, updated_at)
     VALUES (?, ?, ?, 'venture-digital-products', 'Product draft', 'Product draft',
      'Operator', 'application/pdf', 'draft', 'A concise paid product draft.',
      '{}', 'content-hash-v1', 1, ?, ?)`,
    [deliverableId, workflowId, taskId, ts, ts],
  );
  run(
    db,
    `INSERT INTO deliverable_sections
     (id, deliverable_id, task_id, sequence, content, created_at, updated_at)
     VALUES (?, ?, ?, 0, ?, ?, ?)`,
    [
      `section-${suffix}`,
      deliverableId,
      taskId,
      toJson({
        heading: "Product contents",
        summary: "A weekly cash-control checklist for freelancers.",
        evidence: ["The supplied research found repeated demand for a simple weekly routine."],
        risks: ["The result still needs a real buyer test."],
        nextAction: "Review before preparing a Publish Pack.",
      }),
      ts,
      ts,
    ],
  );
  return {
    task: hydrateTask(db, taskId),
    run: get(db, "SELECT * FROM agent_runs WHERE id = ?", [runId]),
    deliverableId,
    workflowId,
  };
}

function insertReviewRun(db, reviewTask, suffix) {
  const ts = "2026-07-17T01:00:00.000Z";
  const runId = `run-quality-${suffix}`;
  run(
    db,
    `INSERT INTO agent_runs
     (id, agent_id, workflow_id, task_id, venture_id, mode, status, input_summary,
      output_summary, approval_required, metadata, started_at, completed_at)
     VALUES (?, 'quality_reviewer', ?, ?, 'venture-digital-products',
      'openai-agents-sdk', 'completed', 'Review exact output', 'Quality verdict ready',
      1, '{}', ?, ?)`,
    [runId, reviewTask.workflow_id, reviewTask.id, ts, ts],
  );
  return get(db, "SELECT * FROM agent_runs WHERE id = ?", [runId]);
}

function passingOutput() {
  return {
    recommendation: "The exact output is clear and supported enough for Daniel's review.",
    nextAction: "Show the reviewed draft to Daniel.",
    operatorDecision: "approve",
    roleOutput: {
      qualityScore: 88,
      riskFindings: [],
      missingEvidence: [],
      claimSafety: "safe",
      operatorRecommendation: "Proceed to operator review without publishing.",
    },
  };
}

test("Quality Reviewer approval freezes and supplies the exact deliverable input without a model call", () => {
  const runtime = makeRuntime();
  try {
    const source = insertSourceOutput(runtime.db, "prepare");
    const result = prepareRequiredQualityReview(runtime.db, {
      ...source,
      output: { summary: "Product draft ready." },
      deliverableIds: [source.deliverableId],
    });
    assert.equal(result.status, "waiting_for_approval");
    assert.equal(result.task.agent, "quality_reviewer");
    assert.equal(result.task.status, "blocked");
    assert.equal(result.approval.status, "pending");
    assert.equal(get(runtime.db, "SELECT status FROM deliverables WHERE id = ?", [source.deliverableId]).status, "quality_review_pending");
    assert.equal(all(runtime.db, "SELECT * FROM model_calls").length, 0);

    const reviewBinding = result.task.payload.liveSpendRequest.parameters.reviewBindings[0];
    assert.equal(reviewBinding.deliverableId, source.deliverableId);
    assert.match(reviewBinding.inputHash, /^[a-f0-9]{64}$/);
    const packet = buildWorkerModelPacket(
      runtime.db,
      result.task,
      findAgentDefinition(runtime.db, result.task),
    );
    assert.equal(packet.qualityReviewTargets.length, 1);
    assert.equal(packet.qualityReviewTargets[0].approvedInputHash, reviewBinding.inputHash);
    assert.equal(
      packet.qualityReviewTargets[0].exactInput.sections[0].content.summary,
      "A weekly cash-control checklist for freelancers.",
    );
    assert.ok(
      result.task.payload.contextSnapshot.sections.production.records
        .some((record) => record.ref.id === source.deliverableId),
    );
  } finally {
    closeRuntime(runtime);
  }
});

test("A passing immutable Quality Reviewer record moves the exact output to operator review", () => {
  const runtime = makeRuntime();
  try {
    const source = insertSourceOutput(runtime.db, "pass");
    const prepared = prepareRequiredQualityReview(runtime.db, {
      ...source,
      output: { summary: "Product draft ready." },
      deliverableIds: [source.deliverableId],
    });
    const reviewRun = insertReviewRun(runtime.db, prepared.task, "pass");
    const result = recordCompletedQualityReview(runtime.db, {
      task: prepared.task,
      run: reviewRun,
      output: passingOutput(),
    });
    assert.equal(result.status, "passed");
    assert.equal(result.results[0].verdict, "passed");
    assert.equal(get(runtime.db, "SELECT status FROM deliverables WHERE id = ?", [source.deliverableId]).status, "ready_for_review");
    assert.equal(get(runtime.db, "SELECT status FROM workflows WHERE id = ?", [source.workflowId]).status, "ready_for_review");
    const repeated = recordCompletedQualityReview(runtime.db, {
      task: prepared.task,
      run: reviewRun,
      output: passingOutput(),
    });
    assert.equal(repeated.status, "passed");
    assert.equal(repeated.alreadyRecorded, true);
    assert.equal(repeated.results[0].id, result.results[0].id);
    assert.equal(all(runtime.db, "SELECT * FROM deliverable_quality_reviews").length, 1);
    assert.throws(
      () => run(runtime.db, "UPDATE deliverable_quality_reviews SET quality_score = 99 WHERE id = ?", [result.results[0].id]),
      /immutable/i,
    );
  } finally {
    closeRuntime(runtime);
  }
});

test("Changed output is blocked before a provider call and cannot inherit an old quality approval", () => {
  const runtime = makeRuntime();
  try {
    const source = insertSourceOutput(runtime.db, "changed");
    const prepared = prepareRequiredQualityReview(runtime.db, {
      ...source,
      output: { summary: "Product draft ready." },
      deliverableIds: [source.deliverableId],
    });
    run(
      runtime.db,
      "UPDATE deliverable_sections SET content = ?, updated_at = ? WHERE deliverable_id = ?",
      [
        toJson({
          heading: "Changed product",
          summary: "Materially different content added after approval.",
          evidence: [],
          risks: [],
          nextAction: "Prepare a new review.",
        }),
        "2026-07-17T02:00:00.000Z",
        source.deliverableId,
      ],
    );
    assert.throws(
      () => buildWorkerModelPacket(
        runtime.db,
        prepared.task,
        findAgentDefinition(runtime.db, prepared.task),
      ),
      /changed after approval/i,
    );

    const reviewRun = insertReviewRun(runtime.db, prepared.task, "changed");
    const result = recordCompletedQualityReview(runtime.db, {
      task: prepared.task,
      run: reviewRun,
      output: passingOutput(),
    });
    assert.equal(result.status, "changes_required");
    assert.equal(result.results[0].verdict, "blocked");
    assert.equal(get(runtime.db, "SELECT status FROM deliverables WHERE id = ?", [source.deliverableId]).status, "needs_changes");
  } finally {
    closeRuntime(runtime);
  }
});
