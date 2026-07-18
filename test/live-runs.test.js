const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  getAgentRunDetail,
  getAgentRunsState,
  getAiTeamState,
} = require("../src/runtime/cockpit-state");
const { ensureAiTeam } = require("../src/runtime/ai-team");
const { ensureAgentTools } = require("../src/runtime/agent-tools");
const { get, openDatabase, run, seedDatabase, toJson } = require("../src/db");

function makeRuntime() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-live-runs-"));
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

function insertTask(db, { id, status = "completed", outcomeStatus = "known", payload = {}, result = {}, error = null }) {
  const ts = "2026-07-17T00:00:00.000Z";
  run(
    db,
    `INSERT INTO tasks (
       id, workflow_id, venture_id, title, kind, agent, status, priority,
       cost_budget_cents, payload, result, error, outcome_status,
       created_at, updated_at, started_at, completed_at
     ) VALUES (?, 'wf-live-runs', 'venture-digital-products', ?, 'live_ai_worker_execution',
       'demand_validator', ?, 1, 100, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      id === "task-protected" ? "Internal rehearsal" : id === "task-live" ? "Demand validation" : "Uncertain provider call",
      status,
      toJson(payload),
      toJson(result),
      error,
      outcomeStatus,
      ts,
      ts,
      ts,
      status === "running" ? null : "2026-07-17T00:00:05.000Z",
    ],
  );
}

function insertModelCall(db, values) {
  run(
    db,
    `INSERT INTO model_calls (
       id, workflow_id, task_id, venture_id, provider, model_class, selected_model,
       mode, status, input_tokens, output_tokens, estimated_cost_cents,
       actual_cost_cents, approval_required, metadata, created_at,
       provider_request_id, cost_status, reconciled_cost_cents, outcome_status
     ) VALUES (?, 'wf-live-runs', ?, 'venture-digital-products', 'openai', 'research-high',
       ?, ?, ?, ?, ?, ?, ?, 0, ?, '2026-07-17T00:00:00.000Z', ?, ?, ?, ?)`,
    [
      values.id,
      values.taskId,
      values.model,
      values.mode,
      values.status,
      values.inputTokens,
      values.outputTokens,
      values.estimatedCents,
      values.actualCents,
      toJson(values.metadata),
      values.responseId,
      values.costStatus,
      values.reconciledCents,
      values.outcomeStatus,
    ],
  );
}

function insertRun(db, values) {
  run(
    db,
    `INSERT INTO agent_runs (
       id, agent_id, workflow_id, task_id, venture_id, mode, status,
       input_summary, output_summary, model_call_id, estimated_cost_cents,
       actual_cost_cents, approval_required, eval_status, metadata,
       started_at, completed_at
     ) VALUES (?, 'demand_validator', 'wf-live-runs', ?, 'venture-digital-products', ?, ?,
       'Validate supplied evidence', ?, ?, ?, ?, 0, ?, ?, ?, ?)`,
    [
      values.id,
      values.taskId,
      values.mode,
      values.status,
      values.summary,
      values.modelCallId,
      values.estimatedCents,
      values.actualCents,
      values.evalStatus || "not_evaluated",
      toJson(values.metadata),
      values.startedAt,
      values.completedAt,
    ],
  );
}

function seedRunEvidence(db) {
  const ts = "2026-07-17T00:00:00.000Z";
  run(
    db,
    `INSERT INTO workflows (
       id, venture_id, type, title, status, current_step, priority,
       metadata, created_at, updated_at
     ) VALUES ('wf-live-runs', 'venture-digital-products', 'demand_validation',
       'Live run test', 'completed', '', 1, '{}', ?, ?)`,
    [ts, ts],
  );

  insertTask(db, {
    id: "task-protected",
    payload: { liveSpendRequest: { provider: "openai", model: "planned-model", maxCostCents: 100 } },
    result: { output: { summary: "Internal result only." } },
  });
  insertModelCall(db, {
    id: "model-protected",
    taskId: "task-protected",
    model: "planned-model",
    mode: "dry-run",
    status: "not_called",
    inputTokens: 1800,
    outputTokens: 900,
    estimatedCents: 11,
    actualCents: 0,
    responseId: "resp_must_not_leak",
    costStatus: "none",
    reconciledCents: 0,
    outcomeStatus: "not_started",
    metadata: { responseId: "resp_must_not_leak", agentSdkTraceId: "trace_must_not_leak" },
  });
  insertRun(db, {
    id: "run-protected",
    taskId: "task-protected",
    mode: "dry-run",
    status: "completed",
    summary: "Internal result only.",
    modelCallId: "model-protected",
    estimatedCents: 11,
    actualCents: 0,
    metadata: { agentSdkTraceId: "trace_must_not_leak" },
    startedAt: ts,
    completedAt: "2026-07-17T00:00:01.000Z",
  });

  insertTask(db, {
    id: "task-live",
    payload: {
      subject: "Does this buyer problem justify a small test?",
      protectedEvidence: ["The supplied evidence describes a repeated buyer problem."],
      liveSpendRequest: {
        provider: "openai-agents-sdk",
        model: "gpt-test",
        maxOutputTokens: 1200,
        maxCostCents: 100,
        tools: ["research_adapter"],
        effects: [],
        tracePolicy: { providerResponseStored: true, providerTraceContent: true, localReviewStored: true },
      },
    },
    result: {
      output: {
        summary: "Demand is plausible but still requires a small real-world test.",
        evidence: ["Repeated problem evidence exists."],
        counterevidence: ["No paid buyer evidence exists."],
        smallestTest: "Run one capped interest test.",
      },
    },
  });
  insertModelCall(db, {
    id: "model-live",
    taskId: "task-live",
    model: "gpt-test",
    mode: "live",
    status: "completed",
    inputTokens: 1329,
    outputTokens: 335,
    estimatedCents: 2,
    actualCents: 2,
    responseId: "resp_live",
    costStatus: "reconciled",
    reconciledCents: 2,
    outcomeStatus: "known",
    metadata: { provider: "openai-agents-sdk", totalTokens: 1664, responseId: "resp_live", agentSdkTraceId: "trace_live" },
  });
  insertRun(db, {
    id: "run-live",
    taskId: "task-live",
    mode: "openai-agents-sdk",
    status: "completed",
    summary: "Demand is plausible but still requires a small real-world test.",
    modelCallId: "model-live",
    estimatedCents: 2,
    actualCents: 2,
    evalStatus: "passed",
    metadata: { agentSdkTraceId: "trace_live" },
    startedAt: "2026-07-17T00:01:00.000Z",
    completedAt: "2026-07-17T00:01:05.000Z",
  });
  run(
    db,
    `INSERT INTO costs (id, workflow_id, venture_id, category, source, status, amount_cents, currency, occurred_at, metadata)
     VALUES ('cost_spend_task-live', 'wf-live-runs', 'venture-digital-products', 'live_ai_worker',
       'openai-agents-sdk', 'reconciled', 2, 'AUD', ?, ?)`,
    [ts, toJson({ modelCallId: "model-live", providerResponseId: "resp_live" })],
  );
  run(
    db,
    `INSERT INTO agent_trace_events (id, run_id, sequence, type, title, detail, metadata, ts)
     VALUES ('trace-event-live', 'run-live', 1, 'model_call_completed', 'OpenAI response received',
       'Structured output was captured.', '{}', '2026-07-17T00:01:04.000Z')`,
  );
  run(
    db,
    `INSERT INTO agent_eval_results (id, run_id, agent_id, task_id, status, score, criteria, findings, metadata, created_at)
     VALUES ('eval-live', 'run-live', 'demand_validator', 'task-live', 'passed', 91, '[]', '[]', '{}', ?)`,
    [ts],
  );
  run(
    db,
    `INSERT INTO agent_tool_invocations (
       id, agent_id, run_id, task_id, workflow_id, tool_id, requested_mode,
       status, decision, permission, risk_level, input_summary, output_summary,
       metadata, requested_at, resolved_at
     ) VALUES ('tool-live', 'demand_validator', 'run-live', 'task-live', 'wf-live-runs',
       'runtime_state', 'protected', 'allowed', 'approved_live', 'read', 'low',
       'Read current venture state.', 'Venture state was supplied.', ?, ?, ?)`,
    [toJson({ toolName: "Runtime State" }), ts, ts],
  );
  run(
    db,
    `INSERT INTO research_runs (
       id, workflow_id, task_id, venture_id, query, provider, mode, status,
       budget_cents, actual_cents, summary, metadata, created_at, completed_at
     ) VALUES ('research-live', 'wf-live-runs', 'task-live', 'venture-digital-products',
       'buyer demand', 'openai-web-search', 'live', 'completed_live', 100, 0,
       'One grounded source was captured.', '{}', ?, ?)`,
    [ts, ts],
  );
  run(
    db,
    `INSERT INTO research_sources (
       id, run_id, title, url, publisher, retrieved_at, relevance, confidence, metadata
     ) VALUES ('source-live', 'research-live', 'Primary source', 'https://example.com/source',
       'Example', ?, 'Supports the buyer-language observation.', 'high', ?)`,
    [ts, toJson({ liveCaptured: true, sourceType: "url_citation" })],
  );

  insertTask(db, {
    id: "task-unknown",
    outcomeStatus: "unknown",
    error: "The provider accepted the request, but the final response was not captured.",
    payload: { liveSpendRequest: { provider: "openai-agents-sdk", model: "gpt-test", maxOutputTokens: 1200, maxCostCents: 100 } },
  });
  insertModelCall(db, {
    id: "model-unknown",
    taskId: "task-unknown",
    model: "gpt-test",
    mode: "live",
    status: "unknown",
    inputTokens: 0,
    outputTokens: 0,
    estimatedCents: 100,
    actualCents: 0,
    responseId: null,
    costStatus: "unknown",
    reconciledCents: 0,
    outcomeStatus: "unknown",
    metadata: {
      outcomeUnknown: true,
      agentSdkTraceId: "trace_unknown",
      dispatchIntent: { status: "dispatched" },
    },
  });
  insertRun(db, {
    id: "run-unknown",
    taskId: "task-unknown",
    mode: "openai-agents-sdk",
    status: "failed",
    summary: "Provider outcome needs review.",
    modelCallId: "model-unknown",
    estimatedCents: 100,
    actualCents: 0,
    metadata: { outcomeUnknown: true, agentSdkTraceId: "trace_unknown" },
    startedAt: "2026-07-17T00:02:00.000Z",
    completedAt: "2026-07-17T00:02:05.000Z",
  });

  run(
    db,
    `INSERT INTO approvals (
       id, workflow_id, venture_id, scope, title, status, risk_level,
       requested_by, requested_at, payload
     ) VALUES ('approval-upcoming', 'wf-live-runs', 'venture-digital-products',
       'future_run', 'Approve future work', 'pending', 'low', 'operator', ?, '{}')`,
    [ts],
  );
}

test("Live Runs separates real provider work, unknown outcomes and internal rehearsals", () => {
  const runtime = makeRuntime();
  try {
    seedRunEvidence(runtime.db);
    const state = getAgentRunsState(runtime.db, { execution: "all" });
    assert.deepEqual(state.counts, {
      total: 3,
      active: 0,
      modelBacked: 1,
      protectedRehearsals: 1,
      needsReview: 1,
      reconciledCostCents: 2,
    });
    assert.equal(state.totalMatching, 3);
    assert.equal(state.runs.some((item) => item.id === "approval-upcoming"), false);

    const protectedRun = state.runs.find((item) => item.id === "run-protected");
    assert.equal(protectedRun.executionKind, "protected_rehearsal");
    assert.deepEqual(protectedRun.actualTokens, { input: null, output: null, total: null });
    assert.deepEqual(protectedRun.plannedTokens, { input: 1800, output: 900 });
    assert.equal(protectedRun.responseId, null);
    assert.equal(protectedRun.traceId, null);
    assert.equal(protectedRun.cost.actualCents, null);
    assert.equal(protectedRun.cost.reconciledCents, null);
    assert.equal(protectedRun.cost.status, "no_provider_call");

    const liveRun = state.runs.find((item) => item.id === "run-live");
    assert.equal(liveRun.executionKind, "model_backed");
    assert.deepEqual(liveRun.actualTokens, { input: 1329, output: 335, total: 1664 });
    assert.equal(liveRun.cost.actualCents, 2);
    assert.equal(liveRun.responseId, "resp_live");
    assert.equal(liveRun.traceId, "trace_live");
    assert.equal(liveRun.groundedSourceCount, 1);

    const unknownRun = state.runs.find((item) => item.id === "run-unknown");
    assert.equal(unknownRun.executionKind, "provider_outcome_unknown");
    assert.deepEqual(unknownRun.actualTokens, { input: null, output: null, total: null });
    assert.match(unknownRun.error, /final response was not captured/i);

    assert.deepEqual(
      getAgentRunsState(runtime.db, { execution: "live" }).runs.map((item) => item.id).sort(),
      ["run-live", "run-unknown"],
    );
    assert.deepEqual(
      getAgentRunsState(runtime.db, { execution: "protected_rehearsal" }).runs.map((item) => item.id),
      ["run-protected"],
    );
    const aiTeam = getAiTeamState(runtime.db);
    assert.equal(aiTeam.pilot, undefined);
    assert.equal(aiTeam.liveRuns.counts.total, 3);
  } finally {
    closeRuntime(runtime);
  }
});

test("multiple attempts under one task do not duplicate provider usage or cost", () => {
  const runtime = makeRuntime();
  try {
    seedRunEvidence(runtime.db);
    insertTask(runtime.db, {
      id: "task-multi",
      status: "failed",
      outcomeStatus: "known_provider_result_needs_review",
      payload: {
        liveSpendRequest: {
          provider: "openai-agents-sdk",
          model: "gpt-test",
          maxCostCents: 100,
        },
      },
      error: "The accepted provider result could not be processed.",
    });
    insertModelCall(runtime.db, {
      id: "model-multi",
      taskId: "task-multi",
      model: "gpt-test",
      mode: "live",
      status: "failed",
      inputTokens: 100,
      outputTokens: 50,
      estimatedCents: 2,
      actualCents: 0,
      responseId: "resp_multi",
      costStatus: "incurred_estimate",
      reconciledCents: 0,
      outcomeStatus: "known",
      metadata: { providerResponseReceived: true },
    });
    insertRun(runtime.db, {
      id: "run-multi-pre-provider",
      taskId: "task-multi",
      mode: "openai-agents-sdk",
      status: "failed",
      summary: "Stopped before provider dispatch.",
      modelCallId: null,
      estimatedCents: 0,
      actualCents: 0,
      metadata: { agentSdkTraceId: "trace_created_before_dispatch" },
      startedAt: "2026-07-17T00:03:00.000Z",
      completedAt: "2026-07-17T00:03:01.000Z",
    });
    insertRun(runtime.db, {
      id: "run-multi-provider",
      taskId: "task-multi",
      mode: "openai-agents-sdk",
      status: "failed",
      summary: "Provider result needs review.",
      modelCallId: "model-multi",
      estimatedCents: 2,
      actualCents: 0,
      metadata: {},
      startedAt: "2026-07-17T00:04:00.000Z",
      completedAt: "2026-07-17T00:04:01.000Z",
    });
    run(
      runtime.db,
      `INSERT INTO costs (
         id, workflow_id, venture_id, category, source, status,
         amount_cents, currency, occurred_at, metadata
       ) VALUES (
         'cost_spend_task-multi', 'wf-live-runs', 'venture-digital-products',
         'live_ai_worker', 'openai-agents-sdk', 'incurred_estimate',
         2, 'AUD', '2026-07-17T00:04:01.000Z', ?
       )`,
      [toJson({ modelCallId: "model-multi", providerResponseId: "resp_multi" })],
    );

    const state = getAgentRunsState(runtime.db, { execution: "all" });
    const beforeProvider = state.runs.find((item) => item.id === "run-multi-pre-provider");
    const providerRun = state.runs.find((item) => item.id === "run-multi-provider");
    assert.equal(beforeProvider.executionKind, "provider_not_contacted");
    assert.equal(beforeProvider.responseId, null);
    assert.equal(beforeProvider.cost.estimatedCents, 0);
    assert.equal(beforeProvider.cost.actualCents, null);
    assert.equal(providerRun.executionKind, "model_backed");
    assert.equal(providerRun.responseId, "resp_multi");
    assert.equal(providerRun.cost.estimatedCents, 2);
  } finally {
    closeRuntime(runtime);
  }
});

test("a successful exact retry leaves failed history visible without presenting it as new operator work", () => {
  const runtime = makeRuntime();
  try {
    seedRunEvidence(runtime.db);
    insertTask(runtime.db, {
      id: "task-prior-failure",
      status: "failed",
      outcomeStatus: "known_provider_result_needs_review",
      payload: {
        liveSpendRequest: {
          provider: "openai-agents-sdk",
          model: "gpt-test",
          maxCostCents: 100,
        },
      },
      error: "The first structured result could not be accepted.",
    });
    insertRun(runtime.db, {
      id: "run-prior-failure",
      taskId: "task-prior-failure",
      mode: "openai-agents-sdk",
      status: "failed",
      summary: "The first result needs review.",
      modelCallId: null,
      estimatedCents: 2,
      actualCents: 0,
      metadata: {},
      startedAt: "2026-07-17T00:00:30.000Z",
      completedAt: "2026-07-17T00:00:31.000Z",
    });

    const retryPayload = JSON.parse(get(runtime.db, "SELECT payload FROM tasks WHERE id = ?", ["task-live"]).payload);
    retryPayload.liveSpendRequest.parameters = {
      retry: {
        number: 1,
        priorTaskId: "task-prior-failure",
        operatorAuthorized: true,
      },
    };
    run(runtime.db, "UPDATE tasks SET payload = ? WHERE id = ?", [toJson(retryPayload), "task-live"]);
    run(
      runtime.db,
      `INSERT INTO task_attempts
       (id, task_id, workflow_id, venture_id, claim_token, status, outcome_status,
        provider_request_id, started_at, completed_at, metadata)
       VALUES ('attempt-live-retry', 'task-live', 'wf-live-runs', 'venture-digital-products',
        'claim-live-retry', 'completed', 'known', 'resp_live',
        '2026-07-17T00:01:00.000Z', '2026-07-17T00:01:05.000Z', '{}')`,
    );
    run(
      runtime.db,
      `INSERT INTO agent_run_receipts
       (id, attempt_id, run_id, task_id, sequence, status, outcome_status,
        snapshot_hash, previous_hash, receipt_hash, missing_fields, warnings, receipt, created_at)
       VALUES ('receipt-live-retry', 'attempt-live-retry', 'run-live', 'task-live', 1,
        'complete', 'known', 'snapshot-live-retry', NULL, 'hash-live-retry',
        '[]', '[]', '{}', '2026-07-17T00:01:05.000Z')`,
    );

    const state = getAgentRunsState(runtime.db, { execution: "all" });
    const prior = state.runs.find((item) => item.id === "run-prior-failure");
    assert.equal(prior.resolvedByRetry, true);
    assert.equal(prior.attentionRequired, false);
    assert.equal(prior.status, "failed");
    assert.equal(state.counts.needsReview, 1);
  } finally {
    closeRuntime(runtime);
  }
});

test("run detail never presents rehearsal estimates as observed provider usage", () => {
  const runtime = makeRuntime();
  try {
    seedRunEvidence(runtime.db);
    const protectedDetail = getAgentRunDetail(runtime.db, "run-protected");
    assert.equal(protectedDetail.execution.kind, "protected_rehearsal");
    assert.equal(protectedDetail.execution.providerAttempted, false);
    assert.equal(protectedDetail.execution.provider, null);
    assert.equal(protectedDetail.execution.model, null);
    assert.equal(protectedDetail.execution.inputTokens, null);
    assert.equal(protectedDetail.execution.outputTokens, null);
    assert.equal(protectedDetail.execution.responseId, null);
    assert.equal(protectedDetail.execution.traceId, null);
    assert.equal(protectedDetail.execution.cost.providerSpendOccurred, false);
    assert.equal(protectedDetail.execution.cost.actualCents, null);
    assert.doesNotMatch(JSON.stringify(protectedDetail), /not retain|retention/i);

    const liveDetail = getAgentRunDetail(runtime.db, "run-live");
    assert.equal(liveDetail.execution.kind, "model_backed");
    assert.equal(liveDetail.execution.providerAttempted, true);
    assert.equal(liveDetail.execution.inputTokens, 1329);
    assert.equal(liveDetail.execution.outputTokens, 335);
    assert.equal(liveDetail.execution.plannedTokens.output, 1200);
    assert.equal(liveDetail.execution.cost.reconciledCents, 2);
    assert.equal(liveDetail.execution.observedTools[0].name, "Runtime State");
    assert.equal(liveDetail.execution.groundedSources[0].url, "https://example.com/source");
    assert.equal(liveDetail.quality.score, 91);

    const unknownDetail = getAgentRunDetail(runtime.db, "run-unknown");
    assert.equal(unknownDetail.execution.kind, "provider_outcome_unknown");
    assert.equal(unknownDetail.execution.actualTokens.total, null);
    assert.match(unknownDetail.execution.error, /final response was not captured/i);
  } finally {
    closeRuntime(runtime);
  }
});

test("dashboard bootstrap authentication stays ephemeral and cookie-backed", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "public", "app.js"), "utf8");
  assert.match(source, /credentials:\s*"same-origin"/);
  assert.match(source, /hash\.get\("bootstrap"\)/);
  assert.match(source, /"x-jarvis-bootstrap": bootstrapToken/);
  assert.match(source, /history\.replaceState/);
  assert.doesNotMatch(source, /(?:localStorage|sessionStorage).*bootstrap/i);
  assert.doesNotMatch(source, /console\.(?:log|info|warn|error)\([^\n]*bootstrap/i);
});
