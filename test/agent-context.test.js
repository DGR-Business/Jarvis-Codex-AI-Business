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
const { createPilotFixture, prepareDemandValidatorPilot } = require("../src/runtime/agent-pilot");
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

test("selected-opportunity evidence and production records stay inside the exact workflow scope", () => {
  const runtime = makeRuntime();
  try {
    insertWorkflow(runtime.db, "wf-current-context");
    insertWorkflow(runtime.db, "wf-historical-context");
    const ts = "2026-07-17T01:00:00.000Z";
    run(
      runtime.db,
      `INSERT INTO commercial_evidence
       (id, venture_id, source_type, source_url, title, summary, captured_at, is_demo, metadata, created_at)
       VALUES
       ('evidence-selected', 'venture-digital-products', 'source_link', 'https://example.com/selected',
        'Selected source', 'Evidence for the selected opportunity.', ?, 0, '{}', ?),
       ('evidence-other', 'venture-digital-products', 'source_link', 'https://example.com/other',
        'Other source', 'Evidence for another opportunity.', ?, 0, '{}', ?)`,
      [ts, ts, ts, ts],
    );
    run(
      runtime.db,
      `INSERT INTO opportunities
       (id, venture_id, source_type, status, title, business_model, buyer, problem,
        offer_direction, channel, overall_score, confidence, recommendation, evidence_ids,
        metadata, created_at, updated_at)
       VALUES
       ('opp-selected', 'venture-digital-products', 'live_agent_research', 'selected_for_finance',
        'Selected opportunity', 'digital_product', 'Selected buyer', 'Selected problem',
        'Selected offer', 'Gumroad', 72, 'medium', 'Run the bounded test.', ?,
        ?, ?, ?),
       ('opp-other', 'venture-digital-products', 'live_agent_research', 'ranked_alternative',
        'Other opportunity', 'digital_product', 'Other buyer', 'Other problem',
        'Other offer', 'Marketplace', 65, 'medium', 'Retain for later.', ?,
        ?, ?, ?)`,
      [
        toJson(["evidence-selected"]),
        toJson({
          validation: {
            recommendation: "Selected validation conclusion.",
            verdict: "needs_evidence",
            confidence: "medium",
            evidence: ["Selected buyer problem is recurrent."],
            smallestTest: "Show the selected offer to qualified buyers.",
            metric: "Three independent paid buyers.",
            stopRule: "Stop after 50 qualified views and zero sales.",
          },
        }),
        ts,
        ts,
        toJson(["evidence-other"]),
        toJson({
          validation: {
            recommendation: "Other validation conclusion.",
            evidence: ["Unrelated evidence."],
          },
        }),
        ts,
        ts,
      ],
    );
    run(
      runtime.db,
      `INSERT INTO deliverables
       (id, workflow_id, venture_id, title, human_name, audience, format, status,
        summary, metadata, created_at, updated_at)
       VALUES
       ('deliverable-current', 'wf-current-context', 'venture-digital-products',
        'Current file', 'Current file', 'operator', 'application/pdf', 'ready',
        'Current workflow output.', '{}', ?, ?),
       ('deliverable-superseded', 'wf-current-context', 'venture-digital-products',
        'Superseded file', 'Superseded file', 'operator', 'text/markdown', 'superseded',
        'Old launch material retained only for audit.', '{}', ?, ?),
       ('deliverable-historical', 'wf-historical-context', 'venture-digital-products',
        'Historical file', 'Historical file', 'operator', 'application/pdf', 'needs_changes',
        'Old rehearsal output.', '{}', ?, ?)`,
      [ts, ts, ts, ts, ts, ts],
    );

    const snapshot = buildAgentContextSnapshot(runtime.db, {
      ventureId: "venture-digital-products",
      workflowId: "wf-current-context",
      taskId: "task-current-context",
      agentId: "product_builder",
      opportunityId: "opp-selected",
      purpose: "Build only the selected product.",
    });
    const evidenceRefs = snapshot.sections.evidence.records.map((item) => item.ref.id);
    const productionRefs = snapshot.sections.production.records.map((item) => item.ref.id);

    assert.ok(evidenceRefs.includes("opp-selected"));
    assert.ok(evidenceRefs.includes("evidence-selected"));
    assert.equal(evidenceRefs.includes("evidence-other"), false);
    assert.ok(productionRefs.includes("deliverable-current"));
    assert.equal(productionRefs.includes("deliverable-superseded"), false);
    assert.equal(productionRefs.includes("deliverable-historical"), false);
    assert.equal(snapshot.contextScope.opportunityId, "opp-selected");
    assert.equal(snapshot.dataPolicy.selectedOpportunityEvidenceOnly, true);
    assert.equal(snapshot.dataPolicy.workflowScopedOperationalRecords, true);
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

    insertWorkflow(runtime.db, "wf-context-disable-rejected");
    assert.throws(() => requestLiveAiWorker(runtime.db, "wf-context-disable-rejected", {
      worker: "finance_analyst",
      requestedBy: "test",
      estimatedCostCents: 100,
      maxOutputTokens: 200,
      disableVentureContext: true,
    }), /cannot be disabled/i);

    insertWorkflow(runtime.db, "wf-context-too-large");
    assert.throws(() => requestLiveAiWorker(runtime.db, "wf-context-too-large", {
      worker: "finance_analyst",
      requestedBy: "test",
      estimatedCostCents: 100,
      maxOutputTokens: 200,
      workBrief: {
        objective: "Review one exact structured record.",
        assetPrompt: JSON.stringify({ schema: "complete-record-v1", payload: "x".repeat(12_000) }),
      },
    }), /concise complete context instead of clipping structured business records/i);

    insertWorkflow(runtime.db, "wf-context-complete");
    const completeAssetPrompt = JSON.stringify({
      schema: "complete-record-v1",
      currentTruth: { status: "quality_passed", score: 93 },
    });
    const completeContext = requestLiveAiWorker(runtime.db, "wf-context-complete", {
      worker: "finance_analyst",
      requestedBy: "test",
      estimatedCostCents: 100,
      maxOutputTokens: 200,
      workBrief: {
        objective: "Review one exact structured record.",
        assetPrompt: completeAssetPrompt,
      },
    });
    assert.equal(completeContext.task.payload.workBrief.assetPrompt, completeAssetPrompt);

    const fixtureRecord = createPilotFixture(runtime.db, {
      id: "fixture-only",
      ventureId: "venture-digital-products",
      fixtureVersion: 1,
      question: "Does supplied evidence justify a test?",
      buyer: "A test buyer",
      hypothesis: "A bounded hypothesis",
      sources: [{
        id: "source-1",
        title: "Fixture source",
        sourceType: "test_fixture",
        summary: "Controlled evidence.",
      }],
      constraints: { evaluationOnly: true, realBusinessEvidence: false },
    });
    const fixture = prepareDemandValidatorPilot(runtime.db, fixtureRecord.id, {
      requestedBy: "test",
      estimatedCostCents: 100,
    }).requested;
    assert.equal(fixture.task.payload.contextSnapshot, null);
    assert.equal(fixture.task.payload.liveSpendRequest.parameters.contextSnapshot, undefined);
    assert.equal(
      fixture.task.payload.ventureContextException.id,
      "demand-validator-versioned-supplied-evidence",
    );
    assert.equal(fixture.task.payload.ventureContextException.fixtureHash, fixtureRecord.fixture_hash);
  } finally {
    closeRuntime(runtime);
  }
});
