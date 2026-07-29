const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  get,
  openDatabase,
  run,
  seedDatabase,
  toJson,
} = require("../src/db");
const {
  AI_TEAM_DEFINITIONS,
  createAgentRun,
  decideAgentHandoff,
  ensureAiTeam,
  finishAgentRun,
} = require("../src/runtime/ai-team");
const {
  CommercialAuthorityError,
  assertCommercialAuthority,
} = require("../src/runtime/commercial-authority");
const {
  installActivatedCommercialTestFixture,
} = require("./support/commercial-authority-fixture");

function makeRuntime(name) {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), `pantheon-ai-team-commercial-${name}-`),
  );
  const db = openDatabase(path.join(root, "runtime.sqlite"));
  seedDatabase(db);
  ensureAiTeam(db);
  return { db, root };
}

function closeRuntime(runtime) {
  runtime.db.close();
  fs.rmSync(runtime.root, { recursive: true, force: true });
}

function createCommercialHandoff(db, suffix, authorityMode) {
  const timestamp = "2026-07-29T00:00:00.000Z";
  const workflowId = `workflow-commercial-handoff-${suffix}`;
  const taskId = `task-commercial-handoff-${suffix}`;
  run(
    db,
    `INSERT INTO workflows
     (id, venture_id, type, title, status, current_step, priority, metadata,
      created_at, updated_at)
     VALUES (?, 'venture-digital-products', 'commercial_test',
      'Commercial buyer test', 'agent_running', '', 1, '{}', ?, ?)`,
    [workflowId, timestamp, timestamp],
  );
  run(
    db,
    `INSERT INTO tasks
     (id, workflow_id, venture_id, title, kind, agent, status, priority,
      cost_budget_cents, payload, result, created_at, updated_at)
     VALUES (?, ?, 'venture-digital-products', 'Review exact buyer demand',
      'market_research', 'demand_validator', 'completed', 1, 0, ?, '{}', ?, ?)`,
    [
      taskId,
      workflowId,
      toJson({
        subject: "Low-touch client-control kit",
        buyer: "Independent social media managers",
        problem: "Client approvals and scope changes are fragmented",
        offer: "A low-touch operational control kit",
        channel: "One approved marketplace test",
      }),
      timestamp,
      timestamp,
    ],
  );

  let fixture = null;
  if (authorityMode !== "unbound") {
    fixture = installActivatedCommercialTestFixture(db, {
      suffix: `handoff-${suffix}`,
      workflowIds: [workflowId],
      taskIds: [taskId],
    });
  }
  if (authorityMode === "mismatched") {
    const task = get(db, "SELECT payload FROM tasks WHERE id = ?", [taskId]);
    const payload = JSON.parse(task.payload);
    payload.commercialTestContract.offerSku =
      `${payload.commercialTestContract.offerSku}_conflict`;
    run(
      db,
      "UPDATE tasks SET payload = ? WHERE id = ?",
      [toJson(payload), taskId],
    );
  }

  const task = get(db, "SELECT * FROM tasks WHERE id = ?", [taskId]);
  const definition = AI_TEAM_DEFINITIONS.find(
    (item) => item.id === "demand_validator",
  );
  const agentRun = createAgentRun(db, definition, task, {
    mode: "dry-run",
    inputSummary: "Review the exact buyer test.",
    approvalRequired: true,
  });
  finishAgentRun(db, agentRun.id, {
    status: "completed",
    outputSummary: "One bounded next step is ready for operator review.",
    approvalRequired: true,
    handoffTo: "chief_of_staff",
    evalStatus: "passed",
    metadata: {
      businessDecision: {
        buyer: "Independent social media managers",
        problem: "Client approvals and scope changes are fragmented",
        offer: "A low-touch operational control kit",
        channel: "One approved marketplace test",
        nextAction: "Prepare the next protected internal step.",
      },
    },
  });
  const handoff = get(
    db,
    "SELECT * FROM agent_handoffs WHERE from_run_id = ?",
    [agentRun.id],
  );
  assert.ok(handoff);
  return {
    fixture,
    handoff,
    taskId,
    workflowId,
  };
}

function writeSnapshot(db, handoffId, workflowId) {
  return {
    tasks: get(db, "SELECT COUNT(*) AS count FROM tasks").count,
    handoffs: get(db, "SELECT COUNT(*) AS count FROM agent_handoffs").count,
    approvals: get(db, "SELECT COUNT(*) AS count FROM approvals").count,
    events: get(db, "SELECT COUNT(*) AS count FROM events").count,
    messages: get(db, "SELECT COUNT(*) AS count FROM messages").count,
    handoff: get(
      db,
      "SELECT status, metadata, updated_at, resolved_at FROM agent_handoffs WHERE id = ?",
      [handoffId],
    ),
    workflow: get(
      db,
      "SELECT status, current_step, updated_at FROM workflows WHERE id = ?",
      [workflowId],
    ),
  };
}

test("approved commercial handoff automatically carries exact authority into its child", () => {
  const runtime = makeRuntime("bound");
  try {
    const source = createCommercialHandoff(runtime.db, "bound", "bound");
    const decision = decideAgentHandoff(
      runtime.db,
      source.handoff.id,
      "approve",
      "Prepare the next protected internal step.",
    );
    const child = get(
      runtime.db,
      "SELECT * FROM tasks WHERE id = ?",
      [decision.followupTask.id],
    );
    const payload = JSON.parse(child.payload);

    assert.equal(child.workflow_id, source.workflowId);
    assert.equal(child.venture_id, "venture-digital-products");
    assert.deepEqual(
      payload.commercialTestContract,
      source.fixture.binding,
    );
    assert.equal(
      assertCommercialAuthority(runtime.db, { taskId: child.id }).allowed,
      true,
    );
  } finally {
    closeRuntime(runtime);
  }
});

test("unbound or mismatched commercial handoffs fail before any decision write", () => {
  for (const item of [
    {
      suffix: "unbound",
      authorityMode: "unbound",
      expectedCode: "commercial_binding_required",
    },
    {
      suffix: "mismatched",
      authorityMode: "mismatched",
      expectedCode: "commercial_binding_conflict",
    },
  ]) {
    const runtime = makeRuntime(item.suffix);
    try {
      const source = createCommercialHandoff(
        runtime.db,
        item.suffix,
        item.authorityMode,
      );
      const before = writeSnapshot(
        runtime.db,
        source.handoff.id,
        source.workflowId,
      );
      assert.throws(
        () => decideAgentHandoff(
          runtime.db,
          source.handoff.id,
          "approve",
          "Prepare the next protected internal step.",
        ),
        (error) => {
          assert.ok(error instanceof CommercialAuthorityError);
          assert.equal(error.code, item.expectedCode);
          return true;
        },
      );
      assert.deepEqual(
        writeSnapshot(runtime.db, source.handoff.id, source.workflowId),
        before,
      );
      assert.equal(
        get(
          runtime.db,
          "SELECT COUNT(*) AS count FROM tasks WHERE kind = 'handoff_followup'",
        ).count,
        0,
      );
    } finally {
      closeRuntime(runtime);
    }
  }
});
