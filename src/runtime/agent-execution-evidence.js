const crypto = require("node:crypto");
const { all, fromJson, get, now, randomId, run, toJson } = require("../db");
const { verifyAgentContextSnapshot } = require("./agent-context");

const LEGACY_RECEIPT_SCHEMA = "jarvis.agent-run-receipt.v1";
const RECEIPT_SCHEMA = "jarvis.agent-run-receipt.v2";
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

function exactAttemptRow(db, attemptId) {
  const attempt = get(db, "SELECT * FROM task_attempts WHERE id = ?", [attemptId]);
  if (!attempt) throw new Error(`Task attempt not found: ${attemptId}`);
  return attempt;
}

function bindAgentRunToAttempt(db, attemptId, runId) {
  if (!attemptId || !runId) return null;
  const attempt = exactAttemptRow(db, attemptId);
  const agentRun = get(db, "SELECT id, task_id FROM agent_runs WHERE id = ?", [runId]);
  if (!agentRun) throw new Error(`Agent run not found for attempt binding: ${runId}`);
  if (agentRun.task_id !== attempt.task_id) {
    throw new Error(`Agent run ${runId} does not belong to attempt task ${attempt.task_id}.`);
  }
  if (attempt.agent_run_id && attempt.agent_run_id !== runId) {
    throw new Error(`Attempt ${attemptId} is already bound to agent run ${attempt.agent_run_id}.`);
  }
  run(
    db,
    `UPDATE task_attempts
     SET agent_run_id = ?, evidence_binding_status = 'exact'
     WHERE id = ? AND (agent_run_id IS NULL OR agent_run_id = ?)`,
    [runId, attemptId, runId],
  );
  return { attemptId, runId };
}

function bindModelCallToAttempt(db, attemptId, modelCallId) {
  if (!attemptId || !modelCallId) return null;
  const attempt = exactAttemptRow(db, attemptId);
  const modelCall = get(db, "SELECT id, task_id, attempt_id FROM model_calls WHERE id = ?", [modelCallId]);
  if (!modelCall) throw new Error(`Model call not found for attempt binding: ${modelCallId}`);
  if (modelCall.task_id !== attempt.task_id) {
    throw new Error(`Model call ${modelCallId} does not belong to attempt task ${attempt.task_id}.`);
  }
  if (modelCall.attempt_id && modelCall.attempt_id !== attemptId) {
    throw new Error(`Model call ${modelCallId} is already bound to attempt ${modelCall.attempt_id}.`);
  }
  if (attempt.model_call_id && attempt.model_call_id !== modelCallId) {
    throw new Error(`Attempt ${attemptId} is already bound to model call ${attempt.model_call_id}.`);
  }
  run(
    db,
    "UPDATE model_calls SET attempt_id = ? WHERE id = ? AND (attempt_id IS NULL OR attempt_id = ?)",
    [attemptId, modelCallId, attemptId],
  );
  run(
    db,
    `UPDATE task_attempts
     SET model_call_id = ?, evidence_binding_status = 'exact'
     WHERE id = ? AND (model_call_id IS NULL OR model_call_id = ?)`,
    [modelCallId, attemptId, modelCallId],
  );
  return { attemptId, modelCallId };
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
    const toolInvocation = attemptId
      ? get(
        db,
        `SELECT id FROM agent_tool_invocations
         WHERE run_id = ? AND task_id = ? AND tool_id = 'research_adapter'
           AND (attempt_id = ? OR observed_attempt_id = ?)
         ORDER BY requested_at DESC LIMIT 1`,
        [runId, task.id, attemptId, attemptId],
      )
      : get(
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

function legacyCompatibilityEnabled(attempt) {
  return attempt.evidence_binding_status === "legacy_compatibility";
}

function runForAttempt(db, attempt, explicitRunId) {
  const legacyCompatibility = legacyCompatibilityEnabled(attempt);
  if (attempt.agent_run_id) {
    if (explicitRunId && explicitRunId !== attempt.agent_run_id) {
      throw new Error(`Attempt ${attempt.id} is bound to agent run ${attempt.agent_run_id}, not ${explicitRunId}.`);
    }
    return {
      row: get(db, "SELECT * FROM agent_runs WHERE id = ?", [attempt.agent_run_id]),
      source: "task_attempts.agent_run_id",
      exact: true,
    };
  }
  if (explicitRunId) {
    if (!legacyCompatibility) {
      throw new Error(`Attempt ${attempt.id} has no exact agent-run binding.`);
    }
    const row = get(db, "SELECT * FROM agent_runs WHERE id = ? AND task_id = ?", [explicitRunId, attempt.task_id]);
    return { row, source: "legacy_explicit_run_id", exact: false };
  }
  if (!legacyCompatibility) return { row: null, source: "missing_exact_binding", exact: false };

  const row = get(
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
  return { row, source: "legacy_task_timestamp_inference", exact: false };
}

function modelCallForAttempt(db, attempt, agentRun) {
  const exactId = attempt.model_call_id || attempt.provider_dispatch_model_call_id || null;
  if (exactId) {
    return {
      row: get(db, "SELECT * FROM model_calls WHERE id = ? AND task_id = ?", [exactId, attempt.task_id]),
      source: attempt.model_call_id
        ? "task_attempts.model_call_id"
        : "task_attempts.provider_dispatch_model_call_id",
      exact: true,
    };
  }
  if (!legacyCompatibilityEnabled(attempt)) {
    return { row: null, source: "missing_exact_binding", exact: false };
  }
  if (agentRun?.model_call_id) {
    return {
      row: get(db, "SELECT * FROM model_calls WHERE id = ?", [agentRun.model_call_id]),
      source: "legacy_agent_run_model_call_id",
      exact: false,
    };
  }
  return {
    row: agentRun
      ? get(db, "SELECT * FROM model_calls WHERE task_id = ? ORDER BY created_at DESC LIMIT 1", [agentRun.task_id])
      : null,
    source: "legacy_task_latest_model_call",
    exact: false,
  };
}

function receiptTokenUsage(modelCall) {
  if (!modelCall) return null;
  const metadata = fromJson(modelCall.metadata, {});
  const recorded = metadata.tokenUsage;
  if (recorded && ["reported", "partial", "reconciled", "unknown"].includes(recorded.status)) {
    return {
      status: recorded.status,
      inputTokens: recorded.inputTokens ?? null,
      outputTokens: recorded.outputTokens ?? null,
      totalTokens: recorded.totalTokens ?? null,
      cachedInputTokens: recorded.cachedInputTokens ?? null,
      cacheWriteInputTokens: recorded.cacheWriteInputTokens ?? null,
      dbCompatibility: recorded.status === "unknown"
        ? {
          inputTokens: modelCall.input_tokens,
          outputTokens: modelCall.output_tokens,
          meaning: "numeric placeholder only; provider usage was not reported",
        }
        : null,
    };
  }
  const legacyTotal = Number(metadata.totalTokens || metadata.usage?.total_tokens || 0);
  const reported = legacyTotal > 0
    || Number(modelCall.input_tokens || 0) > 0
    || Number(modelCall.output_tokens || 0) > 0;
  if (reported) {
    return {
      status: "reported",
      inputTokens: Number(modelCall.input_tokens || 0),
      outputTokens: Number(modelCall.output_tokens || 0),
      totalTokens: legacyTotal || Number(modelCall.input_tokens || 0) + Number(modelCall.output_tokens || 0),
      cachedInputTokens: null,
      cacheWriteInputTokens: null,
      dbCompatibility: null,
    };
  }
  return {
    status: "unknown",
    inputTokens: null,
    outputTokens: null,
    totalTokens: null,
    cachedInputTokens: null,
    cacheWriteInputTokens: null,
    dbCompatibility: {
      inputTokens: modelCall.input_tokens,
      outputTokens: modelCall.output_tokens,
      meaning: "numeric placeholder only; provider usage was not reported",
    },
  };
}

function authoritativelyReconciledFailure(snapshot) {
  const reconciliation = snapshot.attempt?.metadata?.providerReconciliation;
  return snapshot.attempt?.status === "failed"
    && snapshot.attempt?.outcomeStatus === "known"
    && snapshot.provider?.costStatus === "reconciled"
    && reconciliation?.exactPerCallAllocation === true
    && Boolean(reconciliation?.evidence?.source)
    && Boolean(snapshot.provider?.traceId)
    && ["provider_aborted_reconciled", "provider_output_invalid_reconciled"].includes(
      snapshot.attempt?.errorKind,
    );
}

function receiptStatus(snapshot, missingFields, warnings) {
  const attempt = snapshot.attempt;
  const reconciledFailure = authoritativelyReconciledFailure(snapshot);
  if (["blocked", "waiting_approval", "needs_changes"].includes(attempt.status)) return "paused";
  if (["unknown", "known_provider_result_needs_review"].includes(attempt.outcomeStatus)) return "needs_review";
  if (attempt.status === "needs_attention" || (snapshot.run?.status === "failed" && !reconciledFailure)) return "needs_review";
  if (missingFields.length) return "incomplete";
  if (snapshot.evaluation && snapshot.evaluation.status !== "passed" && !reconciledFailure) return "needs_review";
  if (warnings.length) return "needs_review";
  return "complete";
}

function buildReceiptSnapshot(db, attemptId, explicitRunId) {
  const attemptRow = get(db, "SELECT * FROM task_attempts WHERE id = ?", [attemptId]);
  if (!attemptRow) throw new Error(`Task attempt not found: ${attemptId}`);
  const taskRow = get(db, "SELECT * FROM tasks WHERE id = ?", [attemptRow.task_id]);
  if (!taskRow) throw new Error(`Task not found for attempt ${attemptId}`);
  const runBinding = runForAttempt(db, attemptRow, explicitRunId);
  const agentRunRow = runBinding.row;
  const modelCallBinding = modelCallForAttempt(db, attemptRow, agentRunRow);
  const modelCallRow = modelCallBinding.row;
  const approvalRow = taskRow.approval_id
    ? get(db, "SELECT * FROM approvals WHERE id = ?", [taskRow.approval_id])
    : null;
  const exactEvaluationRow = get(
    db,
    "SELECT * FROM agent_eval_results WHERE attempt_id = ? ORDER BY created_at DESC, id DESC LIMIT 1",
    [attemptRow.id],
  );
  const evaluationRow = exactEvaluationRow || (legacyCompatibilityEnabled(attemptRow) && agentRunRow
    ? get(db, "SELECT * FROM agent_eval_results WHERE run_id = ? ORDER BY created_at DESC, id DESC LIMIT 1", [agentRunRow.id])
    : null);
  const evaluationBinding = exactEvaluationRow
    ? { source: "agent_eval_results.attempt_id", exact: true }
    : evaluationRow
      ? { source: "legacy_agent_run_latest_evaluation", exact: false }
      : { source: "missing_exact_binding", exact: false };
  const traces = agentRunRow
    ? all(db, "SELECT * FROM agent_trace_events WHERE run_id = ? ORDER BY sequence ASC", [agentRunRow.id])
    : [];
  const tools = legacyCompatibilityEnabled(attemptRow)
    ? (agentRunRow
      ? all(db, "SELECT * FROM agent_tool_invocations WHERE run_id = ? ORDER BY requested_at ASC", [agentRunRow.id])
      : [])
    : all(
      db,
      `SELECT * FROM agent_tool_invocations
       WHERE attempt_id = ? OR observed_attempt_id = ?
       ORDER BY requested_at ASC, id ASC`,
      [attemptRow.id, attemptRow.id],
    );
  const researchRuns = legacyCompatibilityEnabled(attemptRow)
    ? all(db, "SELECT * FROM research_runs WHERE task_id = ? ORDER BY created_at ASC", [taskRow.id])
    : all(
      db,
      `SELECT DISTINCT runs.* FROM research_runs AS runs
       LEFT JOIN agent_run_provenance AS provenance ON provenance.research_run_id = runs.id
       WHERE provenance.attempt_id = ?
          OR (json_valid(runs.metadata) AND json_extract(runs.metadata, '$.attemptId') = ?)
       ORDER BY runs.created_at ASC`,
      [attemptRow.id, attemptRow.id],
    );
  const researchSources = researchRuns.length
    ? (legacyCompatibilityEnabled(attemptRow)
      ? all(
        db,
        `SELECT sources.* FROM research_sources AS sources
         JOIN research_runs AS runs ON runs.id = sources.run_id
         WHERE runs.task_id = ?
         ORDER BY sources.retrieved_at ASC, sources.id ASC`,
        [taskRow.id],
      )
      : all(
        db,
        `SELECT DISTINCT sources.* FROM research_sources AS sources
         JOIN research_runs AS runs ON runs.id = sources.run_id
         LEFT JOIN agent_run_provenance AS provenance ON provenance.research_source_id = sources.id
         WHERE provenance.attempt_id = ?
            OR (json_valid(runs.metadata) AND json_extract(runs.metadata, '$.attemptId') = ?)
         ORDER BY sources.retrieved_at ASC, sources.id ASC`,
        [attemptRow.id, attemptRow.id],
      ))
    : [];
  const provenance = agentRunRow
    ? (legacyCompatibilityEnabled(attemptRow)
      ? all(db, "SELECT * FROM agent_run_provenance WHERE run_id = ? ORDER BY created_at ASC, id ASC", [agentRunRow.id])
      : all(db, "SELECT * FROM agent_run_provenance WHERE attempt_id = ? ORDER BY created_at ASC, id ASC", [attemptRow.id]))
    : [];
  const costs = legacyCompatibilityEnabled(attemptRow)
    ? all(
      db,
      `SELECT * FROM costs
       WHERE task_id = ? OR model_call_id = ? OR run_id = ?
       ORDER BY occurred_at ASC, id ASC`,
      [taskRow.id, modelCallRow?.id || "", agentRunRow?.id || ""],
    )
    : modelCallRow
      ? all(db, "SELECT * FROM costs WHERE model_call_id = ? ORDER BY occurred_at ASC, id ASC", [modelCallRow.id])
      : [];
  const pilotReviewRow = agentRunRow
    ? get(db, "SELECT * FROM agent_pilot_reviews WHERE run_id = ?", [agentRunRow.id])
    : null;

  const task = parseRow(taskRow, ["payload", "result"]);
  const agentRun = parseRow(agentRunRow, ["metadata"]);
  const modelCall = parseRow(modelCallRow, ["metadata"]);
  const approval = parseRow(approvalRow, ["payload", "expected_effects"]);
  const evaluation = parseRow(evaluationRow, ["criteria", "findings", "metadata"]);
  const pilotReview = parseRow(pilotReviewRow, ["criteria"]);
  const tokenUsage = receiptTokenUsage(modelCallRow);
  const requestedTools = task.payload?.liveSpendRequest?.tools || [];
  const requestedSearch = requestedTools.some((tool) => ["research_adapter", "web_search"].includes(tool));
  const providerBacked = agentRun?.mode === "openai-agents-sdk"
    || modelCall?.mode === "live"
    || ["openai-agents-sdk", "openai-responses"].includes(modelCall?.provider);
  const agentsSdkBacked = agentRun?.mode === "openai-agents-sdk"
    || modelCall?.metadata?.provider === "openai-agents-sdk";
  const traceId = modelCall?.metadata?.agentSdkTraceId || agentRun?.metadata?.agentSdkTraceId || null;
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
      agentRunId: attemptRow.agent_run_id || null,
      modelCallId: attemptRow.model_call_id || null,
      evidenceBindingStatus: attemptRow.evidence_binding_status,
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
    evidenceBinding: {
      mode: legacyCompatibilityEnabled(attemptRow) ? "legacy_compatibility" : "exact",
      run: {
        id: agentRun?.id || null,
        source: runBinding.source,
        exact: runBinding.exact,
      },
      modelCall: {
        id: modelCall?.id || null,
        source: modelCallBinding.source,
        exact: modelCallBinding.exact,
        reverseAttemptId: modelCall?.attempt_id || null,
      },
      evaluation: {
        id: evaluation?.id || null,
        source: evaluationBinding.source,
        exact: evaluationBinding.exact,
      },
      tools: legacyCompatibilityEnabled(attemptRow)
        ? "legacy run-level compatibility"
        : "agent_tool_invocations.attempt_id or observed_attempt_id",
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
      inputTokens: tokenUsage?.inputTokens ?? null,
      outputTokens: tokenUsage?.outputTokens ?? null,
      totalTokens: tokenUsage?.totalTokens ?? null,
      tokenUsage,
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
    operatorUsefulnessReview: pilotReview ? {
      id: pilotReview.id,
      runId: pilotReview.run_id,
      deterministicStatus: pilotReview.deterministic_status,
      operatorVerdict: pilotReview.operator_verdict,
      usefulnessScore: pilotReview.usefulness_score,
      note: pilotReview.note,
      criteria: pilotReview.criteria,
      reviewedAt: pilotReview.reviewed_at,
    } : null,
    traces: traces.map((trace) => parseRow(trace, ["metadata"])),
    tools: tools.map((tool) => parseRow(tool, ["metadata"])),
    research: {
      runs: researchRuns.map((item) => parseRow(item, ["metadata"])),
      sources: researchSources.map((item) => parseRow(item, ["metadata"])),
      provenance: provenance.map((item) => parseRow(item, ["metadata"])),
    },
    costs: costs.map((cost) => parseRow(cost, ["metadata"])),
  };

  const reconciledFailure = authoritativelyReconciledFailure(snapshot);
  const missingFields = [];
  const warnings = [];
  if (legacyCompatibilityEnabled(attemptRow)) {
    warnings.push(`Legacy compatibility evidence binding was used (${runBinding.source}; ${modelCallBinding.source}; ${evaluationBinding.source}).`);
  }
  if (!legacyCompatibilityEnabled(attemptRow) && agentRun && !runBinding.exact) {
    missingFields.push("exact attempt-to-worker-run binding");
  }
  if (!legacyCompatibilityEnabled(attemptRow) && modelCall && (
    !modelCallBinding.exact || modelCall.attempt_id !== attemptRow.id
  )) {
    missingFields.push("exact attempt-to-model-call binding");
  }
  if (providerBacked && attemptRow.completed_at) {
    if (!agentRun) missingFields.push("worker run");
    if (!attemptRow.provider_dispatched_at) missingFields.push("provider dispatch time");
    if (!modelCall) missingFields.push("model call");
    if (
      !providerRequestId
      && attemptRow.outcome_status !== "failed_before_effect"
      && !reconciledFailure
    ) {
      missingFields.push("provider response ID");
    }
    if (agentsSdkBacked && !traceId && attemptRow.outcome_status !== "failed_before_effect") {
      missingFields.push("OpenAI trace ID");
    }
    if (!terminalTrace) missingFields.push("terminal worker event");
    if (!evaluationRow && attemptRow.status === "completed") missingFields.push("quality evaluation");
    if (evaluationRow && !legacyCompatibilityEnabled(attemptRow) && evaluationRow.attempt_id !== attemptRow.id) {
      missingFields.push("exact attempt evaluation");
    }
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
  if (
    providerBacked
    && tokenUsage?.status === "unknown"
    && modelCall?.outcome_status !== "failed_before_effect"
  ) {
    warnings.push("Provider token usage was not reported and is recorded as unknown, not zero.");
  }
  if (tools.some((tool) => tool.status === "needs_review" || tool.decision === "provider_activity_missing")) {
    warnings.push("At least one approved provider tool had no matching provider activity and needs review.");
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
    `SELECT attempts.id, attempts.agent_run_id AS run_id
     FROM task_attempts AS attempts
     WHERE attempts.completed_at IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM agent_run_receipts AS receipts
         WHERE receipts.attempt_id = attempts.id
       )
     ORDER BY attempts.completed_at DESC
     LIMIT ?`,
    [limit],
  );
  return attempts.map((attempt) => finalizeAgentExecutionReceipt(db, {
    attemptId: attempt.id,
    runId: attempt.run_id || null,
  }));
}

function appendReceiptForOperatorUsefulnessReview(db, runId) {
  const attempt = get(
    db,
    `SELECT id FROM task_attempts
     WHERE agent_run_id = ? AND completed_at IS NOT NULL
     ORDER BY completed_at DESC, id DESC LIMIT 1`,
    [runId],
  );
  if (!attempt) throw new Error(`No exact terminal task attempt is bound to agent run ${runId}.`);
  return finalizeAgentExecutionReceipt(db, { attemptId: attempt.id, runId });
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
    const parsedReceipt = fromJson(row.receipt, {});
    const expectedSnapshotHash = sha256(parsedReceipt);
    const expectedReceiptHash = sha256({
      schema: parsedReceipt.schema || LEGACY_RECEIPT_SCHEMA,
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
  LEGACY_RECEIPT_SCHEMA,
  PROVENANCE_SCHEMA,
  RECEIPT_SCHEMA,
  appendReceiptForOperatorUsefulnessReview,
  auditTerminalAgentAttempts,
  bindAgentRunToAttempt,
  bindModelCallToAttempt,
  canonicalJson,
  finalizeAgentExecutionReceipt,
  latestAgentRunReceipt,
  persistAgentsSdkResearchEvidence,
  sha256,
  verifyAgentRunReceiptChain,
  webSearchQueries,
  webSearchSources,
};
