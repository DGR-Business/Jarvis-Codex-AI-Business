const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  applyStableSpendCostIdMigration,
  all,
  get,
  openDatabase,
  run,
  seedDatabase,
  toJson,
} = require("../src/db");
const { spendCostId } = require("../src/runtime/stable-id");
const { ensureAiTeam } = require("../src/runtime/ai-team");
const { ensureAgentTools } = require("../src/runtime/agent-tools");
const {
  bindAgentRunToAttempt,
  bindModelCallToAttempt,
  finalizeAgentExecutionReceipt,
  persistAgentsSdkResearchEvidence,
  verifyAgentRunReceiptChain,
} = require("../src/runtime/agent-execution-evidence");
const { extractAgentsSdkToolActivity } = require("../src/runtime/agent-sdk-capabilities");
const { getAgentRunDetail } = require("../src/runtime/cockpit-state");
const {
  claimNextTask,
  markTaskAttemptProviderDispatched,
  recoverStaleTaskClaims,
} = require("../src/runtime/task-claims");

function makeRuntime() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-agent-evidence-"));
  const dbPath = path.join(root, "runtime.sqlite");
  const db = openDatabase(dbPath);
  seedDatabase(db);
  ensureAiTeam(db);
  ensureAgentTools(db);
  return { root, dbPath, db };
}

function closeRuntime(runtime) {
  runtime.db.close();
  fs.rmSync(runtime.root, { recursive: true, force: true });
}

function insertWorkflow(db, id, status = "agent_running") {
  const ts = "2026-07-17T00:00:00.000Z";
  run(
    db,
    `INSERT INTO workflows
     (id, venture_id, type, title, status, current_step, priority, metadata, created_at, updated_at)
     VALUES (?, 'venture-digital-products', 'demand_validation', 'Demand proof', ?, '', 1, '{}', ?, ?)`,
    [id, status, ts, ts],
  );
}

test("Agents SDK search extraction retains provider sources, citations, and query lists", () => {
  const activity = extractAgentsSdkToolActivity({
    rawResponses: [{
      output: [
        {
          id: "search_1",
          type: "web_search_call",
          status: "completed",
          action: {
            type: "search",
            queries: ["buyer pain evidence", "competitor pricing"],
            sources: [{
              title: "Primary source",
              url: "https://example.com/primary",
              publisher: "Example",
            }],
          },
        },
        {
          type: "message",
          content: [{
            type: "output_text",
            text: "A cited result.",
            annotations: [{
              type: "url_citation",
              title: "Cited source",
              url: "https://example.com/cited",
            }],
          }],
        },
      ],
    }],
  });

  assert.equal(activity.length, 1);
  assert.deepEqual(activity[0].queries, ["buyer pain evidence", "competitor pricing"]);
  assert.equal(activity[0].sources.length, 2);
  assert.deepEqual(
    activity[0].sources.map((source) => source.groundingType).sort(),
    ["output_url_citation", "provider_search_source"],
  );
});

test("Agents SDK search extraction recognises the official hosted-tool item shape", () => {
  const activity = extractAgentsSdkToolActivity({
    newItems: [{
      rawItem: {
        id: "search_hosted_1",
        type: "hosted_tool_call",
        name: "web_search_call",
        status: "completed",
        providerData: {
          type: "web_search_call",
          action: {
            type: "search",
            query: "buyer demand evidence",
            sources: [{
              title: "Grounded source",
              url: "https://example.com/grounded",
            }],
          },
        },
      },
    }],
  });

  assert.equal(activity.length, 1);
  assert.equal(activity[0].type, "web_search");
  assert.deepEqual(activity[0].queries, ["buyer demand evidence"]);
  assert.equal(activity[0].sources[0].url, "https://example.com/grounded");
});

test("completed SDK work receives an immutable grounded receipt that preserves historical output", () => {
  const runtime = makeRuntime();
  try {
    const ts = "2026-07-17T00:00:00.000Z";
    insertWorkflow(runtime.db, "wf-receipt", "completed");
    run(
      runtime.db,
      `INSERT INTO tasks
       (id, workflow_id, venture_id, title, kind, agent, status, priority, cost_budget_cents,
        payload, result, outcome_status, created_at, updated_at, started_at, completed_at)
       VALUES ('task-receipt', 'wf-receipt', 'venture-digital-products', 'Validate demand',
        'live_ai_worker_execution', 'demand_validator', 'completed', 1, 200, ?, ?, 'known', ?, ?, ?, ?)`,
      [
        toJson({
          subject: "Is the buyer problem strong enough to test?",
          liveSpendRequest: {
            provider: "openai-agents-sdk",
            model: "gpt-test",
            maxCostCents: 200,
            tools: ["research_adapter"],
          },
        }),
        toJson({ output: { summary: "Original grounded recommendation.", evidence: ["Grounded evidence."] } }),
        ts,
        ts,
        ts,
        "2026-07-17T00:00:05.000Z",
      ],
    );
    run(
      runtime.db,
      `INSERT INTO task_attempts
       (id, task_id, workflow_id, venture_id, claim_token, status, outcome_status,
        provider_request_id, started_at, completed_at, metadata, provider_dispatched_at,
        provider_dispatch_model_call_id)
       VALUES ('attempt-receipt', 'task-receipt', 'wf-receipt', 'venture-digital-products',
        'claim-receipt', 'completed', 'known', 'resp_receipt', ?, ?, '{}', ?, 'model-receipt')`,
      [ts, "2026-07-17T00:00:05.000Z", "2026-07-17T00:00:01.000Z"],
    );
    run(
      runtime.db,
      `INSERT INTO model_calls
       (id, workflow_id, task_id, venture_id, provider, model_class, selected_model, mode,
        status, input_tokens, output_tokens, estimated_cost_cents, actual_cost_cents,
        approval_required, metadata, created_at, provider_request_id, cost_status,
        reserved_cost_cents, incurred_estimate_cents, reconciled_cost_cents, outcome_status)
       VALUES ('model-receipt', 'wf-receipt', 'task-receipt', 'venture-digital-products',
        'openai', 'research-high', 'gpt-test', 'live', 'completed', 100, 50, 5, 0, 1,
        ?, ?, 'resp_receipt', 'incurred_estimate', 200, 5, 0, 'known')`,
      [toJson({ provider: "openai-agents-sdk", agentSdkTraceId: "trace_receipt", totalTokens: 150 }), ts],
    );
    run(
      runtime.db,
      `INSERT INTO agent_runs
       (id, agent_id, workflow_id, task_id, venture_id, mode, status, input_summary,
        output_summary, model_call_id, estimated_cost_cents, actual_cost_cents,
        approval_required, eval_status, metadata, started_at, completed_at)
       VALUES ('run-receipt', 'demand_validator', 'wf-receipt', 'task-receipt',
        'venture-digital-products', 'openai-agents-sdk', 'completed', 'Validate demand',
        'Original grounded recommendation.', 'model-receipt', 5, 0, 1, 'passed', ?, ?, ?)`,
      [
        toJson({
          agentSdkTraceId: "trace_receipt",
          liveWorkerResponseId: "resp_receipt",
          taskTitle: "Validate demand",
        }),
        ts,
        "2026-07-17T00:00:05.000Z",
      ],
    );
    bindAgentRunToAttempt(runtime.db, "attempt-receipt", "run-receipt");
    bindModelCallToAttempt(runtime.db, "attempt-receipt", "model-receipt");
    run(
      runtime.db,
      `INSERT INTO agent_eval_results
        (id, run_id, agent_id, task_id, attempt_id, status, score, criteria, findings, metadata,
         evaluator_version, subject_hash, created_at)
        VALUES ('eval-receipt', 'run-receipt', 'demand_validator', 'task-receipt', 'attempt-receipt',
         'passed', 95, '[]', '[]', '{}', 'local-structural-v2', 'subject-hash', ?)`,
      ["2026-07-17T00:00:04.000Z"],
    );
    run(
      runtime.db,
      `INSERT INTO agent_trace_events
       (id, run_id, sequence, type, title, detail, metadata, ts)
       VALUES ('trace-run-complete', 'run-receipt', 1, 'run_completed',
        'Worker completed', 'Completed safely.', '{}', ?)`,
      ["2026-07-17T00:00:05.000Z"],
    );

    const research = persistAgentsSdkResearchEvidence(runtime.db, {
      task: {
        id: "task-receipt",
        workflow_id: "wf-receipt",
        venture_id: "venture-digital-products",
        cost_budget_cents: 200,
        payload: { liveSpendRequest: { maxCostCents: 200 } },
      },
      runId: "run-receipt",
      attemptId: "attempt-receipt",
      modelCallId: "model-receipt",
      responseId: "resp_receipt",
      traceId: "trace_receipt",
      toolActivity: [{
        id: "search_1",
        type: "web_search",
        status: "completed",
        queries: ["buyer demand"],
        sources: [{
          title: "Grounded source",
          url: "https://example.com/demand",
          groundingType: "provider_search_source",
        }],
      }],
    });
    assert.equal(research.status, "completed_live");

    const receipt = finalizeAgentExecutionReceipt(runtime.db, {
      attemptId: "attempt-receipt",
      runId: "run-receipt",
    });
    assert.equal(receipt.status, "complete");
    assert.deepEqual(receipt.missing_fields, []);
    assert.equal(verifyAgentRunReceiptChain(runtime.db, "run-receipt").ok, true);
    assert.throws(
      () => run(runtime.db, "UPDATE agent_run_receipts SET status = 'incomplete' WHERE id = ?", [receipt.id]),
      /immutable/i,
    );
    assert.throws(
      () => run(runtime.db, "DELETE FROM agent_run_provenance WHERE run_id = 'run-receipt'"),
      /immutable/i,
    );

    run(
      runtime.db,
      "UPDATE tasks SET result = ? WHERE id = 'task-receipt'",
      [toJson({ output: { summary: "Later mutable task content." } })],
    );
    const detail = getAgentRunDetail(runtime.db, "run-receipt");
    assert.equal(detail.process.conclusion, "Original grounded recommendation.");
    assert.equal(detail.execution.sources.length, 1);
    assert.equal(detail.execution.sources[0].grounded, true);
    assert.equal(detail.receipt.status, "complete");
  } finally {
    closeRuntime(runtime);
  }
});

test("stale recovery never retries an attempt after provider dispatch was recorded", () => {
  const runtime = makeRuntime();
  try {
    insertWorkflow(runtime.db, "wf-stale");
    const ts = "2026-07-17T00:00:00.000Z";
    run(
      runtime.db,
      `INSERT INTO tasks
       (id, workflow_id, venture_id, title, kind, agent, status, priority, cost_budget_cents,
        payload, result, outcome_status, created_at, updated_at)
       VALUES ('task-stale', 'wf-stale', 'venture-digital-products', 'Stale provider task',
        'live_ai_worker_execution', 'demand_validator', 'queued', 1, 100,
        '{}', '{}', 'not_started', ?, ?)`,
      [ts, ts],
    );
    const claim = claimNextTask(runtime.db, { taskId: "task-stale", leaseMs: 5_000 });
    assert.ok(claim);
    markTaskAttemptProviderDispatched(runtime.db, claim, {
      modelCallId: null,
      provider: "openai-agents-sdk",
      model: "gpt-test",
      traceId: "trace-stale",
      dispatchedAt: "2026-07-17T00:00:01.000Z",
    });
    run(
      runtime.db,
      "UPDATE tasks SET claimed_at = '2026-07-17T00:00:00.000Z' WHERE id = 'task-stale'",
    );
    const recovered = recoverStaleTaskClaims(runtime.db, { leaseMs: 5_000 });
    assert.equal(recovered.length, 1);
    assert.equal(recovered[0].status, "needs_attention");
    assert.equal(get(runtime.db, "SELECT status FROM tasks WHERE id = 'task-stale'").status, "needs_attention");
    assert.equal(get(runtime.db, "SELECT outcome_status FROM task_attempts WHERE id = ?", [claim.attemptId]).outcome_status, "unknown");
  } finally {
    closeRuntime(runtime);
  }
});

test("migrations install receipt immutability, exact attempt bindings, and provider receipt repair", () => {
  const runtime = makeRuntime();
  try {
    assert.equal(get(runtime.db, "SELECT MAX(version) AS version FROM schema_migrations").version, 18);
    assert.equal(get(runtime.db, "SELECT name FROM schema_migrations WHERE version = 12").name, "agent-operations-evidence-and-receipts");
    assert.equal(get(runtime.db, "SELECT name FROM schema_migrations WHERE version = 16").name, "exact-agent-execution-evidence-bindings");
    assert.equal(get(runtime.db, "SELECT name FROM schema_migrations WHERE version = 17").name, "provider-request-attempt-receipt-backfill");
    assert.equal(get(runtime.db, "SELECT name FROM schema_migrations WHERE version = 18").name, "stable-spend-cost-identifiers");
    const tables = all(
      runtime.db,
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('agent_run_receipts', 'agent_run_provenance') ORDER BY name",
    ).map((row) => row.name);
    assert.deepEqual(tables, ["agent_run_provenance", "agent_run_receipts"]);
    const attemptColumns = all(runtime.db, "PRAGMA table_info(task_attempts)").map((row) => row.name);
    assert.ok(attemptColumns.includes("provider_dispatched_at"));
    assert.ok(attemptColumns.includes("provider_dispatch_model_call_id"));
    assert.ok(attemptColumns.includes("agent_run_id"));
    assert.ok(attemptColumns.includes("model_call_id"));
    assert.ok(attemptColumns.includes("evidence_binding_status"));

    const ts = "2026-07-17T00:00:00.000Z";
    insertWorkflow(runtime.db, "wf-provider-repair", "completed");
    run(
      runtime.db,
      `INSERT INTO tasks
       (id, workflow_id, venture_id, title, kind, agent, status, priority, payload, result,
        created_at, updated_at)
       VALUES ('task-provider-repair', 'wf-provider-repair', 'venture-digital-products',
        'Repair provider evidence', 'live_ai_worker_execution', 'demand_validator', 'completed',
        1, '{}', '{}', ?, ?)`,
      [ts, ts],
    );
    run(
      runtime.db,
      `INSERT INTO model_calls
       (id, workflow_id, task_id, venture_id, provider, model_class, selected_model, mode,
        status, approval_required, metadata, created_at, provider_request_id)
       VALUES ('model-provider-repair', 'wf-provider-repair', 'task-provider-repair',
        'venture-digital-products', 'openai', 'reasoning', 'gpt-test', 'live', 'completed',
        1, '{}', ?, 'resp_provider_repair')`,
      [ts],
    );
    run(
      runtime.db,
      `INSERT INTO task_attempts
       (id, task_id, workflow_id, venture_id, claim_token, status, outcome_status,
        started_at, completed_at, metadata, model_call_id)
       VALUES ('attempt-provider-repair', 'task-provider-repair', 'wf-provider-repair',
        'venture-digital-products', 'claim-provider-repair', 'completed', 'known',
        ?, ?, '{}', 'model-provider-repair')`,
      [ts, ts],
    );
    run(runtime.db, "DELETE FROM schema_migrations WHERE version = 17");
    runtime.db.close();
    runtime.db = openDatabase(runtime.dbPath);

    const repairedAttempt = get(
      runtime.db,
      "SELECT provider_request_id, metadata FROM task_attempts WHERE id = 'attempt-provider-repair'",
    );
    assert.equal(repairedAttempt.provider_request_id, "resp_provider_repair");
    assert.equal(JSON.parse(repairedAttempt.metadata).providerRequestIdBackfill.source, "exact_model_call_binding");
  } finally {
    closeRuntime(runtime);
  }
});

test("stable spend-cost migration upgrades a legacy truncated task identifier without duplication", () => {
  const runtime = makeRuntime();
  try {
    const taskId = `task_${"long_segment_".repeat(12)}retry_2`;
    const legacyId = `cost_spend_${taskId.replace(/[^a-zA-Z0-9_-]+/g, "_").slice(0, 88)}`;
    insertWorkflow(runtime.db, "wf-cost-id-upgrade");
    const ts = "2026-07-17T00:00:00.000Z";
    run(
      runtime.db,
      `INSERT INTO tasks
       (id, workflow_id, venture_id, title, kind, agent, status, priority,
        payload, result, created_at, updated_at)
       VALUES (?, 'wf-cost-id-upgrade', 'venture-digital-products', 'Legacy cost id',
        'live_ai_worker_execution', 'demand_validator', 'failed', 1, '{}', '{}', ?, ?)`,
      [taskId, ts, ts],
    );
    run(
      runtime.db,
      `INSERT INTO costs
       (id, workflow_id, venture_id, task_id, category, source, status,
        amount_cents, currency, occurred_at, metadata)
       VALUES (?, 'wf-cost-id-upgrade', 'venture-digital-products', ?,
        'live_ai_worker', 'openai-agents-sdk', 'incurred_estimate',
        3, 'AUD', ?, '{}')`,
      [legacyId, taskId, ts],
    );
    run(runtime.db, "DELETE FROM schema_migrations WHERE version = 18");
    applyStableSpendCostIdMigration(runtime.db);

    const upgraded = get(runtime.db, "SELECT * FROM costs WHERE task_id = ?", [taskId]);
    assert.equal(upgraded.id, spendCostId(taskId));
    assert.equal(get(runtime.db, "SELECT COUNT(*) AS count FROM costs WHERE task_id = ?", [taskId]).count, 1);
    assert.equal(JSON.parse(upgraded.metadata).stableIdMigration.previousId, legacyId);
  } finally {
    closeRuntime(runtime);
  }
});
