const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  get,
  openDatabase,
  run,
  seedDatabase,
  toJson,
} = require("../src/db");
const {
  addVentureRecord,
  buildAgentContextSnapshot,
  persistAgentContextSnapshot,
  verifyAgentContextSnapshot,
} = require("../src/runtime/agent-context");
const { ensureAiTeam } = require("../src/runtime/ai-team");
const { ensureAgentTools } = require("../src/runtime/agent-tools");
const { validateMaterializedExecution } = require("../src/runtime/approval-scope");
const { requestLiveAiWorker } = require("../src/runtime/live-ai-workers");

function makeRuntime() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-agent-context-"));
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
     VALUES (?, 'venture-digital-products', 'digital_product', 'Focused context proof',
      'planned', '', 1, ?, ?, ?)`,
    [id, toJson({ subject: "A small commercial proof", channel: "Digital Product" }), ts, ts],
  );
}

test("task-scoped context exposes focused records without credentials or direct customer identifiers", () => {
  const runtime = makeRuntime();
  try {
    insertWorkflow(runtime.db, "wf-context");
    run(
      runtime.db,
      `INSERT INTO accounting_entries
       (id, venture_id, entry_type, category, source, description, status, amount_cents,
        currency, occurred_at, metadata, created_at, updated_at, effect_sign)
       VALUES ('acct-context', 'venture-digital-products', 'expense', 'OpenAI API',
        'operator_receipt', 'Controlled model credit', 'reconciled', 1579, 'AUD',
        '2026-07-17T00:00:00.000Z', '{}', '2026-07-17T00:00:00.000Z',
        '2026-07-17T00:00:00.000Z', -1)`,
    );
    addVentureRecord(runtime.db, {
      id: "legal-summary",
      ventureId: "venture-digital-products",
      recordClass: "legal",
      recordType: "platform_terms_note",
      title: "Platform terms review",
      summary: "Publishing requirements need confirmation before launch.",
      content: { requirement: "Review current Gumroad terms before publishing." },
      sensitivity: "confidential",
      providerPolicy: "full",
    });
    addVentureRecord(runtime.db, {
      id: "legal-local-only",
      ventureId: "venture-digital-products",
      recordClass: "legal",
      recordType: "identity_record",
      title: "Private identity record",
      summary: "Private operator identity evidence.",
      content: { reference: "Stored outside model context." },
      sensitivity: "restricted",
      providerPolicy: "local_only",
    });
    assert.throws(
      () => addVentureRecord(runtime.db, {
        ventureId: "venture-digital-products",
        recordClass: "operations",
        title: "Bad record",
        content: { api_key: "must-not-be-stored" },
      }),
      /Credentials and authentication secrets/,
    );

    const snapshot = buildAgentContextSnapshot(runtime.db, {
      ventureId: "venture-digital-products",
      workflowId: "wf-context",
      taskId: "task-context",
      agentId: "chief_of_staff",
      purpose: "Review the venture position.",
    });
    assert.equal(verifyAgentContextSnapshot(snapshot).valid, true);
    assert.equal(snapshot.sections.finance.records[0].facts.reconciledOutflowsAud, 15.79);
    assert.equal(snapshot.sections.legal.records.some((item) => item.ref.id === "legal-summary"), true);
    assert.equal(snapshot.sections.legal.records.some((item) => item.ref.id === "legal-local-only"), false);
    assert.equal(snapshot.sections.legal.withheldLocalOnly, 1);
    assert.equal(JSON.stringify(snapshot).includes("platform_purchase_id"), false);
    assert.equal(JSON.stringify(snapshot).includes("buyer_hash"), false);

    assert.throws(
      () => buildAgentContextSnapshot(runtime.db, {
        ventureId: "venture-digital-products",
        workflowId: "wf-context",
        taskId: "task-demand-overreach",
        agentId: "demand_validator",
        recordClasses: ["finance"],
      }),
      /cannot receive these context classes/,
    );

    run(
      runtime.db,
      `INSERT INTO tasks
       (id, workflow_id, venture_id, title, kind, agent, status, priority, payload, result, created_at, updated_at)
       VALUES ('task-context', 'wf-context', 'venture-digital-products', 'Review context',
        'live_ai_worker_execution', 'chief_of_staff', 'queued', 1, '{}', '{}',
        '2026-07-17T00:00:00.000Z', '2026-07-17T00:00:00.000Z')`,
    );
    const stored = persistAgentContextSnapshot(runtime.db, snapshot);
    assert.equal(stored.snapshot_hash, snapshot.snapshotHash);
    assert.throws(
      () => run(runtime.db, "UPDATE agent_context_snapshots SET record_count = 0 WHERE id = ?", [snapshot.id]),
      /immutable/,
    );
    assert.throws(
      () => run(runtime.db, "DELETE FROM venture_records WHERE id = 'legal-summary'"),
      /immutable/,
    );
  } finally {
    closeRuntime(runtime);
  }
});

test("live worker approvals bind a persisted context snapshot while supplied-evidence pilots stay isolated", () => {
  const runtime = makeRuntime();
  try {
    insertWorkflow(runtime.db, "wf-live-context");
    const requested = requestLiveAiWorker(runtime.db, "wf-live-context", {
      worker: "finance_analyst",
      requestedBy: "test",
      estimatedCostCents: 100,
      maxOutputTokens: 200,
      contextClasses: ["venture", "finance"],
      expectedOutput: "Check the current venture cost position.",
    });
    const task = requested.task;
    const snapshot = task.payload.contextSnapshot;
    assert.ok(snapshot);
    assert.deepEqual(snapshot.recordClasses, ["venture", "finance"]);
    assert.equal(task.payload.liveSpendRequest.parameters.contextSnapshot.hash, snapshot.snapshotHash);
    assert.ok(get(runtime.db, "SELECT id FROM agent_context_snapshots WHERE snapshot_hash = ?", [snapshot.snapshotHash]));
    assert.equal(
      validateMaterializedExecution(runtime.db, task, task.payload.liveSpendRequest.executionDescriptor).valid,
      true,
    );

    insertWorkflow(runtime.db, "wf-fixture-isolation");
    const fixture = requestLiveAiWorker(runtime.db, "wf-fixture-isolation", {
      worker: "demand_validator",
      requestedBy: "test",
      estimatedCostCents: 100,
      maxOutputTokens: 200,
      fixtureInput: {
        id: "fixture-only",
        question: "Does supplied evidence justify a test?",
        buyer: "A test buyer",
        hypothesis: "A bounded hypothesis",
        sources: [{ id: "source-1", title: "Fixture source", sourceType: "test_fixture", summary: "Controlled evidence." }],
      },
    });
    assert.equal(fixture.task.payload.contextSnapshot, null);
    assert.equal(fixture.task.payload.liveSpendRequest.parameters.contextSnapshot, undefined);
  } finally {
    closeRuntime(runtime);
  }
});
