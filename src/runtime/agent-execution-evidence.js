const crypto = require("node:crypto");
const { all, fromJson, get, now, randomId, run, toJson } = require("../db");
const { verifyAgentContextSnapshot } = require("./agent-context");

const RECEIPT_SCHEMA = "jarvis.agent-run-receipt.v1";
const PROVENANCE_SCHEMA = "jarvis.agent-run-provenance.v1";

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  return Object.keys(value)
    .sort()
    .reduce((result, key) => {
      result[key] = canonicalize(value[key]);
      return result;
    }, {});
}

function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

function sha256(value) {
  const input = typeof value === "string" || Buffer.isBuffer(value)
    ? value
    : canonicalJson(value);
  return crypto.createHash("sha256").update(input).digest("hex");
}

function parseRow(row, fields = []) {
  if (!row) return null;
  const parsed = { ...row };
  for (const field of fields) parsed[field] = fromJson(parsed[field], field.endsWith("s") ? [] : {});
  return parsed;
}

function uniqueStrings(values) {
  return [...new Set(values.filter(Boolean).map((value) => String(value).trim()).filter(Boolean))];
}

function webSearchQueries(activity = []) {
  return uniqueStrings(activity.flatMap((item) => {
    if (item.type !== "web_search") return [];
    return [
      ...(Array.isArray(item.queries) ? item.queries : []),
      item.query,
    ];
  }));
}

function webSearchSources(activity = []) {
  const byUrl = new Map();
  for (const item of activity) {
    if (item.type !== "web_search") continue;
    for (const source of item.sources || []) {
      if (!source?.url || !/^https?:\/\//i.test(source.url)) continue;
      const current = byUrl.get(source.url) || {};
      byUrl.set(source.url, {
        title: source.title || current.title || source.url,
        url: source.url,
        publisher: source.publisher || current.publisher || null,
        publishedAt: source.publishedAt || current.publishedAt || null,
        groundingType: source.groundingType || current.groundingType || "provider_search_source",
        callId: item.id || current.callId || null,
        queries: uniqueStrings([
          ...(current.queries || []),
          ...(Array.isArray(item.queries) ? item.queries : []),
          item.query,
        ]),
      });
    }
  }
  return [...byUrl.values()];
}

function persistAgentsSdkResearchEvidence(db, payload = {}) {
  const { task, runId, attemptId, modelCallId, responseId, traceId, toolActivity = [] } = payload;
  const sources = webSearchSources(toolActivity);
  const queries = webSearchQueries(toolActivity);
  const requestedSearch = toolActivity.some((item) => item.type === "web_search");
  if (!requestedSearch && !sources.length) return null;

  const researchRunId = `research_sdk_${runId}`;
  const capturedAt = now();
  const status = sources.length ? "completed_live" : "needs_attention";
  const summary = sources.length
    ? `OpenAI web search returned ${sources.length} grounded source${sources.length === 1 ? "" : "s"} for operator review.`
    : "OpenAI web search activity was observed, but no grounded source URL was returned.";
  run(
    db,
    `INSERT INTO research_runs
     (id, workflow_id, task_id, venture_id, query, provider, mode, status, budget_cents, actual_cents, summary, metadata, created_at, completed_at)
     VALUES (?, ?, ?, ?, ?, ?, 'live', ?, ?, 0, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       status = excluded.status,
       summary = excluded.summary,
       metadata = excluded.metadata,
       completed_at = excluded.completed_at`,
    [
      researchRunId,
      task.workflow_id || null,
      task.id,
      task.venture_id || null,
      queries.join(" | ") || "Provider web search",
      "openai-agents-sdk-web-search",
      status,
      Number(task.payload?.liveSpendRequest?.maxCostCents || task.cost_budget_cents || 0),
      summary,
      toJson({
        schema: PROVENANCE_SCHEMA,
        runId,
        attemptId: attemptId || null,
        modelCallId: modelCallId || null,
        responseId: responseId || null,
        traceId: traceId || null,
        queries,
        sourceCount: sources.length,
        grounded: sources.length > 0,
      }),
      capturedAt,
      capturedAt,
    ],
  );

  const persistedSources = [];
  for (const source of sources) {
    const sourceFingerprint = sha256({
      runId,
      callId: source.callId,
      url: source.url,
      groundingType: source.groundingType,
    });
    const sourceId = `source_sdk_${sourceFingerprint.slice(0, 24)}`;
    run(
      db,
      `INSERT OR IGNORE INTO research_sources
       (id, run_id, title, url, publisher, published_at, retrieved_at, relevance, confidence, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        sourceId,
        researchRunId,
        source.title || source.url,
        source.url,
        source.publisher,
        source.publishedAt,
        capturedAt,
        "Grounded source returned by the approved OpenAI web-search call.",
        "provider_grounded",
        toJson({
          schema: PROVENANCE_SCHEMA,
          callId: source.callId,
          queries: source.queries,
          groundingType: source.groundingType,
          sourceType: source.groundingType === "output_url_citation"
            ? "url_citation"
            : "web_search_action_source",
          providerGrounded: true,
          liveCaptured: true,
          responseId: responseId || null,
          traceId: traceId || null,
        }),
      ],
    );
    const toolInvocation = get(
      db,
      `SELECT id FROM agent_tool_invocations
       WHERE run_id = ? AND task_id = ? AND tool_id = 'research_adapter'
       ORDER BY requested_at DESC LIMIT 1`,
      [runId, task.id],
    );
    const provenanceFingerprint = sha256({
      runId,
      sourceId,
      modelCallId,
      responseId,
      sourceFingerprint,
    });
    run(
      db,
      `INSERT OR IGNORE INTO agent_run_provenance
       (id, fingerprint, run_id, attempt_id, task_id, model_call_id, tool_invocation_id,
        research_run_id, research_source_id, kind, provider_external_id, title, url,
        grounding_type, input_hash, output_hash, metadata, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'web_source', ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        `prov_${randomId()}`,
        provenanceFingerprint,
        runId,
        attemptId || null,
        task.id,
        modelCallId || null,
        toolInvocation?.id || null,
        researchRunId,
        sourceId,
        responseId || source.callId || null,
        source.title || source.url,
        source.url,
        source.groundingType,
        sha256(source.queries),
        sha256(source),
        toJson({
          schema: PROVENANCE_SCHEMA,
          traceId: traceId || null,
          callId: source.callId,
          queries: source.queries,
          retrievedAt: capturedAt,
        }),
        capturedAt,
      ],
    );
    persistedSources.push({ id: sourceId, ...source });
  }

  return {
    id: researchRunId,
    status,
    queries,
    sources: persistedSources,
    grounded: persistedSources.length > 0,
  };
}

function latestRunForAttempt(db, attempt, explicitRunId) {
  if (explicitRunId) return get(db, "SELECT * FROM agent_runs WHERE id = ?", [explicitRunId]);
  return get(
    db,
    `SELECT * FROM agent_runs
     WHERE task_id = ? AND started_at >= ?
     ORDER BY started_at DESC LIMIT 1`,
    [attempt.task_id, attempt.started_at],
  ) || get(
    db,
    "SELECT * FROM agent_runs WHERE task_id = ? ORDER BY started_at DESC LIMIT 1",
    [attempt.task_id],
  );
}

function modelCallForRun(db, agentRun) {
  if (!agentRun) return null;
  if (agentRun.model_call_id) return get(db, "SELECT * FROM model_calls WHERE id = ?", [agentRun.model_call_id]);
  return get(
    db,
    "SELECT * FROM model_calls WHERE task_id = ? ORDER BY created_at DESC LIMIT 1",
    [agentRun.task_id],
  );
}

function receiptStatus(snapshot, missingFields, warnings) {
  const attempt = snapshot.attempt;
  if (["blocked", "waiting_approval", "needs_changes"].includes(attempt.status)) return "paused";
  if (["unknown", "known_provider_result_needs_review"].includes(attempt.outcomeStatus)) return "needs_review";
  if (attempt.status === "needs_attention" || snapshot.run?.status === "failed") return "needs_review";
  if (missingFields.length) return "incomplete";
  if (snapshot.evaluation && snapshot.evaluation.status !== "passed") return "needs_review";
  if (warnings.length) return "needs_review";
  return "complete";
}

function buildReceiptSnapshot(db, attemptId, explicitRunId) {
  const attemptRow = get(db, "SELECT * FROM task_attempts WHERE id = ?", [attemptId]);
  if (!attemptRow) throw new Error(`Task attempt not found: ${attemptId}`);
  const taskRow = get(db, "SELECT * FROM tasks WHERE id = ?", [attemptRow.task_id]);
  if (!taskRow) throw new Error(`Task not found for attempt ${attemptId}`);
  const agentRunRow = latestRunForAttempt(db, attemptRow, explicitRunId);
  const modelCallRow = modelCallForRun(db, agentRunRow);
  const approvalRow = taskRow.approval_id
    ? get(db, "SELECT * FROM approvals WHERE id = ?", [taskRow.approval_id])
    : null;
  const evaluationRow = agentRunRow
    ? get(db, "SELECT * FROM agent_eval_results WHERE run_id = ? ORDER BY created_at DESC LIMIT 1", [agentRunRow.id])
    : null;
  const traces = agentRunRow
    ? all(db, "SELECT * FROM agent_trace_events WHERE run_id = ? ORDER BY sequence ASC", [agentRunRow.id])
    : [];
  const tools = agentRunRow
    ? all(db, "SELECT * FROM agent_tool_invocations WHERE run_id = ? ORDER BY requested_at ASC", [agentRunRow.id])
    : [];
  const researchRuns = all(
    db,
    "SELECT * FROM research_runs WHERE task_id = ? ORDER BY created_at ASC",
    [taskRow.id],
  );
  const researchSources = researchRuns.length
    ? all(
      db,
      `SELECT sources.* FROM research_sources AS sources
       JOIN research_runs AS runs ON runs.id = sources.run_id
       WHERE runs.task_id = ?
       ORDER BY sources.retrieved_at ASC, sources.id ASC`,
      [taskRow.id],
    )
    : [];
  const provenance = agentRunRow
    ? all(db, "SELECT * FROM agent_run_provenance WHERE run_id = ? ORDER BY created_at ASC, id ASC", [agentRunRow.id])
    : [];
  const costs = all(
    db,
    `SELECT * FROM costs
     WHERE task_id = ? OR model_call_id = ? OR run_id = ?
     ORDER BY occurred_at ASC, id ASC`,
    [taskRow.id, modelCallRow?.id || "", agentRunRow?.id || ""],
  );

  const task = parseRow(taskRow, ["payload", "result"]);
  const agentRun = parseRow(agentRunRow, ["metadata"]);
  const modelCall = parseRow(modelCallRow, ["metadata"]);
  const approval = parseRow(approvalRow, ["payload", "expected_effects"]);
  const evaluation = parseRow(evaluationRow, ["criteria", "findings", "metadata"]);
  const requestedTools = task.payload?.liveSpendRequest?.tools || [];
  const requestedSearch = requestedTools.some((tool) => ["research_adapter", "web_search"].includes(tool));
  const providerBacked = agentRun?.mode === "openai-agents-sdk"
    || modelCall?.mode === "live"
    || ["openai-agents-sdk", "openai-responses"].includes(modelCall?.provider);
  const traceId = agentRun?.metadata?.agentSdkTraceId || modelCall?.metadata?.agentSdkTraceId || null;
  const providerRequestId = modelCall?.provider_request_id
    || agentRun?.metadata?.liveWorkerResponseId
    || attemptRow.provider_request_id
    || null;
  const terminalTrace = traces.some((trace) => ["run_completed", "run_failed", "run_paused"].includes(trace.type));
  const contextSnapshot = task.payload?.contextSnapshot || null;
  const contextCheck = contextSnapshot ? verifyAgentContextSnapshot(contextSnapshot) : null;
  const persistedContext = contextSnapshot?.snapshotHash
    ? get(db, "SELECT id, task_id, agent_id, snapshot_hash FROM agent_context_snapshots WHERE snapshot_hash = ?", [contextSnapshot.snapshotHash])
    : null;

  const snapshot = {
    schema: RECEIPT_SCHEMA,
    attempt: {
      id: attemptRow.id,
      status: attemptRow.status,
      outcomeStatus: attemptRow.outcome_status,
      startedAt: attemptRow.started_at,
      completedAt: attemptRow.completed_at,
      providerDispatchedAt: attemptRow.provider_dispatched_at || null,
      providerDispatchModelCallId: attemptRow.provider_dispatch_model_call_id || null,
      providerRequestId: attemptRow.provider_request_id || null,
      errorKind: attemptRow.error_kind || null,
      error: attemptRow.error || null,
      metadata: fromJson(attemptRow.metadata, {}),
    },
    task: {
      id: task.id,
      workflowId: task.workflow_id,
      ventureId: task.venture_id,
      kind: task.kind,
      title: task.title,
      agent: task.agent,
      status: task.status,
      outcomeStatus: task.outcome_status,
      payload: task.payload,
      result: task.result,
      payloadHash: sha256(task.payload),
      resultHash: sha256(task.result),
    },
    run: agentRun ? {
      id: agentRun.id,
      agentId: agentRun.agent_id,
      mode: agentRun.mode,
      status: agentRun.status,
      inputSummary: agentRun.input_summary,
      outputSummary: agentRun.output_summary,
      evalStatus: agentRun.eval_status,
      estimatedCostCents: agentRun.estimated_cost_cents,
      actualCostCents: agentRun.actual_cost_cents,
      startedAt: agentRun.started_at,
      completedAt: agentRun.completed_at,
      metadata: agentRun.metadata,
    } : null,
    provider: modelCall ? {
      modelCallId: modelCall.id,
      provider: modelCall.provider,
      selectedModel: modelCall.selected_model,
      mode: modelCall.mode,
      status: modelCall.status,
      providerRequestId,
      traceId,
      inputTokens: modelCall.input_tokens,
      outputTokens: modelCall.output_tokens,
      estimatedCostCents: modelCall.estimated_cost_cents,
      actualCostCents: modelCall.actual_cost_cents,
      costStatus: modelCall.cost_status,
      outcomeStatus: modelCall.outcome_status,
      metadata: modelCall.metadata,
    } : null,
    approval: approval ? {
      id: approval.id,
      status: approval.status,
      scopeHash: approval.scope_hash,
      expiresAt: approval.expires_at,
      consumedAt: approval.consumed_at,
      expectedEffects: approval.expected_effects,
    } : null,
    context: contextSnapshot ? {
      id: contextSnapshot.id,
      snapshotHash: contextSnapshot.snapshotHash,
      policyVersion: contextSnapshot.policyVersion,
      accessProfile: contextSnapshot.accessProfile,
      recordClasses: contextSnapshot.recordClasses,
      recordCount: contextSnapshot.recordCount,
      dataPolicy: contextSnapshot.dataPolicy,
      valid: contextCheck?.valid === true,
      persisted: Boolean(persistedContext),
    } : null,
    evaluation,
    traces: traces.map((trace) => parseRow(trace, ["metadata"])),
    tools: tools.map((tool) => parseRow(tool, ["metadata"])),
    research: {
      runs: researchRuns.map((item) => parseRow(item, ["metadata"])),
      sources: researchSources.map((item) => parseRow(item, ["metadata"])),
      provenance: provenance.map((item) => parseRow(item, ["metadata"])),
    },
    costs: costs.map((cost) => parseRow(cost, ["metadata"])),
  };

  const missingFields = [];
  const warnings = [];
  if (providerBacked && attemptRow.completed_at) {
    if (!agentRun) missingFields.push("worker run");
    if (!attemptRow.provider_dispatched_at) missingFields.push("provider dispatch time");
    if (!modelCall) missingFields.push("model call");
    if (!providerRequestId && attemptRow.outcome_status !== "failed_before_effect") missingFields.push("provider response ID");
    if (!traceId && attemptRow.outcome_status !== "failed_before_effect") missingFields.push("OpenAI trace ID");
    if (!terminalTrace) missingFields.push("terminal worker event");
    if (!evaluationRow && attemptRow.status === "completed") missingFields.push("quality evaluation");
  }
  if (contextSnapshot) {
    if (!contextCheck?.valid) missingFields.push("valid worker context snapshot");
    if (!persistedContext
        || persistedContext.task_id !== task.id
        || persistedContext.agent_id !== task.agent) {
      missingFields.push("persisted worker context snapshot");
    }
  }
  if (requestedSearch && attemptRow.status === "completed" && researchSources.length === 0) {
    warnings.push("The web-search run returned no grounded source URLs.");
  }
  if (providerBacked && modelCall?.cost_status === "unknown") {
    warnings.push("Provider cost remains unknown.");
  }
  if (attemptRow.outcome_status === "unknown") {
    warnings.push("Provider outcome remains unknown; no automatic retry is allowed.");
  }

  return {
    attemptRow,
    runId: agentRun?.id || null,
    snapshot,
    missingFields,
    warnings,
    status: receiptStatus(snapshot, missingFields, warnings),
  };
}

function finalizeAgentExecutionReceipt(db, payload = {}) {
  const built = buildReceiptSnapshot(db, payload.attemptId, payload.runId);
  const snapshotHash = sha256(built.snapshot);
  const existing = get(
    db,
    "SELECT * FROM agent_run_receipts WHERE attempt_id = ? AND snapshot_hash = ?",
    [payload.attemptId, snapshotHash],
  );
  if (existing) return parseRow(existing, ["missing_fields", "warnings", "receipt"]);

  const previous = get(
    db,
    "SELECT * FROM agent_run_receipts WHERE attempt_id = ? ORDER BY sequence DESC LIMIT 1",
    [payload.attemptId],
  );
  const sequence = Number(previous?.sequence || 0) + 1;
  const receiptHash = sha256({
    schema: RECEIPT_SCHEMA,
    attemptId: payload.attemptId,
    sequence,
    previousHash: previous?.receipt_hash || null,
    snapshotHash,
  });
  const id = `receipt_${randomId()}`;
  const createdAt = now();
  run(
    db,
    `INSERT INTO agent_run_receipts
     (id, attempt_id, run_id, task_id, sequence, status, outcome_status, snapshot_hash,
      previous_hash, receipt_hash, missing_fields, warnings, receipt, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      payload.attemptId,
      built.runId,
      built.attemptRow.task_id,
      sequence,
      built.status,
      built.attemptRow.outcome_status,
      snapshotHash,
      previous?.receipt_hash || null,
      receiptHash,
      toJson(built.missingFields),
      toJson(built.warnings),
      canonicalJson(built.snapshot),
      createdAt,
    ],
  );
  return {
    id,
    attempt_id: payload.attemptId,
    run_id: built.runId,
    task_id: built.attemptRow.task_id,
    sequence,
    status: built.status,
    outcome_status: built.attemptRow.outcome_status,
    snapshot_hash: snapshotHash,
    previous_hash: previous?.receipt_hash || null,
    receipt_hash: receiptHash,
    missing_fields: built.missingFields,
    warnings: built.warnings,
    receipt: built.snapshot,
    created_at: createdAt,
  };
}

function latestAgentRunReceipt(db, runId) {
  const row = get(
    db,
    "SELECT * FROM agent_run_receipts WHERE run_id = ? ORDER BY sequence DESC, created_at DESC LIMIT 1",
    [runId],
  );
  return parseRow(row, ["missing_fields", "warnings", "receipt"]);
}

function auditTerminalAgentAttempts(db, options = {}) {
  const limit = Math.max(1, Math.min(Number(options.limit || 100), 500));
  const attempts = all(
    db,
    `SELECT attempts.id, runs.id AS run_id
     FROM task_attempts AS attempts
     LEFT JOIN agent_runs AS runs ON runs.task_id = attempts.task_id
       AND runs.started_at >= attempts.started_at
     WHERE attempts.completed_at IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM agent_run_receipts AS receipts
         WHERE receipts.attempt_id = attempts.id
       )
     GROUP BY attempts.id
     ORDER BY attempts.completed_at DESC
     LIMIT ?`,
    [limit],
  );
  return attempts.map((attempt) => finalizeAgentExecutionReceipt(db, {
    attemptId: attempt.id,
    runId: attempt.run_id || null,
  }));
}

function verifyAgentRunReceiptChain(db, runId = null) {
  const params = [];
  const clause = runId ? "WHERE run_id = ?" : "";
  if (runId) params.push(runId);
  const rows = all(
    db,
    `SELECT * FROM agent_run_receipts ${clause}
     ORDER BY attempt_id ASC, sequence ASC`,
    params,
  );
  const failures = [];
  const previousByAttempt = new Map();
  for (const row of rows) {
    const expectedPrevious = previousByAttempt.get(row.attempt_id) || null;
    const expectedSnapshotHash = sha256(fromJson(row.receipt, {}));
    const expectedReceiptHash = sha256({
      schema: RECEIPT_SCHEMA,
      attemptId: row.attempt_id,
      sequence: row.sequence,
      previousHash: expectedPrevious,
      snapshotHash: row.snapshot_hash,
    });
    if (row.previous_hash !== expectedPrevious) failures.push({ id: row.id, field: "previous_hash" });
    if (row.snapshot_hash !== expectedSnapshotHash) failures.push({ id: row.id, field: "snapshot_hash" });
    if (row.receipt_hash !== expectedReceiptHash) failures.push({ id: row.id, field: "receipt_hash" });
    previousByAttempt.set(row.attempt_id, row.receipt_hash);
  }
  return {
    ok: failures.length === 0,
    checked: rows.length,
    failures,
  };
}

module.exports = {
  PROVENANCE_SCHEMA,
  RECEIPT_SCHEMA,
  auditTerminalAgentAttempts,
  canonicalJson,
  finalizeAgentExecutionReceipt,
  latestAgentRunReceipt,
  persistAgentsSdkResearchEvidence,
  sha256,
  verifyAgentRunReceiptChain,
  webSearchQueries,
  webSearchSources,
};
