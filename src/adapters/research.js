const CONFIG = require("../config");
const { all, fromJson, get, insertEvent, now, randomId, run, toJson } = require("../db");
const { bindModelCallToAttempt } = require("../runtime/agent-execution-evidence");
const { recordAgentToolObservation } = require("../runtime/agent-tool-gate");
const { markTaskAttemptProviderDispatched } = require("../runtime/task-claims");

const DEFAULT_RESEARCH_BUDGET_CENTS = 75;
const LIVE_RESEARCH_PROVIDER = "openai-responses-web-search";
const DEFAULT_PROVIDER_DEADLINE_MS = 60_000;

function approvedDeadlineMs(task, options = {}) {
  const approved = Number(options.deadlineMs || task.payload?.liveSpendRequest?.deadlineMs || DEFAULT_PROVIDER_DEADLINE_MS);
  return Math.min(10 * 60 * 1000, Math.max(5_000, Number.isFinite(approved) ? approved : DEFAULT_PROVIDER_DEADLINE_MS));
}

function requestSignal(deadlineMs, externalSignal) {
  const timeout = typeof AbortSignal?.timeout === "function" ? AbortSignal.timeout(deadlineMs) : null;
  if (externalSignal && timeout && typeof AbortSignal?.any === "function") return AbortSignal.any([externalSignal, timeout]);
  return externalSignal || timeout || undefined;
}

function providerError(error, state, extras = {}) {
  const wrapped = error instanceof Error ? error : new Error(String(error));
  wrapped.providerDispatchStatus = state;
  wrapped.providerCallOccurred = state !== "not_dispatched";
  wrapped.outcomeUnknown = state === "outcome_unknown";
  wrapped.definiteProviderRejection = state === "definite_rejection";
  Object.assign(wrapped, extras);
  return wrapped;
}

function safeId(value) {
  return String(value || "task")
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .slice(0, 88);
}

function subjectFrom(task, workflow) {
  return task.payload.subject || workflow.metadata.subject || workflow.title || "business idea";
}

function channelFrom(task, workflow) {
  return task.payload.channel || workflow.metadata.channel || "Business Idea";
}

function queryFor(task, workflow, command) {
  const subject = subjectFrom(task, workflow);
  const channel = channelFrom(task, workflow);
  const instruction = workflow.metadata.originalInstruction || command?.raw_text || "";
  return `${channel} ${subject} demand competitors pricing risks ${instruction}`.replace(/\s+/g, " ").trim();
}

function requiredSourceTemplates(subject, channel) {
  return [
    {
      title: `${channel} marketplace demand check for ${subject}`,
      publisher: "required-live-source",
      relevance: "Current demand, search volume, marketplace listings, and customer language.",
      confidence: "pending_live_research",
      kind: "market_demand",
    },
    {
      title: `${channel} competitor and pricing check for ${subject}`,
      publisher: "required-live-source",
      relevance: "Current competitor count, price bands, offer quality, and saturation risk.",
      confidence: "pending_live_research",
      kind: "competition_pricing",
    },
    {
      title: `${channel} risk and trend freshness check for ${subject}`,
      publisher: "required-live-source",
      relevance: "Current trend direction, platform risk, IP/trademark risk, and stale-data warning.",
      confidence: "pending_live_research",
      kind: "freshness_risk",
    },
  ];
}

function liveResearchEnabled(options = {}) {
  return options.live === true && process.env.JARVIS_ENABLE_LIVE_RESEARCH === "1";
}

function insertResearchSources(db, runId, templates) {
  const retrievedAt = now();
  for (const template of templates) {
    run(
      db,
      `INSERT INTO research_sources (id, run_id, title, url, publisher, published_at, retrieved_at, relevance, confidence, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        `src_${randomId()}`,
        runId,
        template.title,
        template.url || null,
        template.publisher,
        template.publishedAt || null,
        retrievedAt,
        template.relevance,
        template.confidence,
        toJson({
          kind: template.kind,
          liveRequired: !template.url,
          liveCaptured: Boolean(template.url),
          sourceType: template.sourceType || "research_source",
        }),
      ],
    );
  }
}

function extractHostname(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "web";
  }
}

function compactText(value, max = 600) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}

function buildLiveResearchPrompt(task, workflow, command) {
  const subject = subjectFrom(task, workflow);
  const channel = channelFrom(task, workflow);
  const instruction = workflow.metadata.originalInstruction || command?.raw_text || "No original instruction captured.";
  const today = new Date().toISOString().slice(0, 10);

  return [
    `Date: ${today}`,
    `Business type/channel: ${channel}`,
    `Idea/subject: ${subject}`,
    `Operator instruction: ${instruction}`,
    "",
    "Run current web research before answering. Focus on:",
    "1. current demand and customer language",
    "2. competitors, saturation, and pricing bands",
    "3. current trend freshness and platform/IP/compliance risk",
    "4. practical keep/revise/kill recommendation before further spend",
    "",
    "Return only valid JSON with this shape:",
    JSON.stringify({
      summary: "plain English research summary",
      verdict: "continue | revise | kill | research_inconclusive",
      confidence: "low | medium | high",
      marketDemand: { finding: "...", evidence: "..." },
      competitionPricing: { finding: "...", evidence: "..." },
      freshnessRisk: { finding: "...", evidence: "..." },
      recommendation: "specific next action",
      assumptions: ["assumption needing validation"],
      sources: [
        { title: "source title", url: "https://example.com", kind: "market_demand", relevance: "why this source matters", confidence: "high" },
      ],
    }),
    "Use clickable cited URLs in the response annotations. Do not invent sources.",
  ].join("\n");
}

function cleanJsonText(text) {
  const trimmed = String(text || "").trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1].trim() : trimmed;
}

function parseJsonOutput(text) {
  try {
    return JSON.parse(cleanJsonText(text));
  } catch {
    return null;
  }
}

function outputTextAndAnnotations(response) {
  const annotations = [];
  const textParts = [];
  if (typeof response.output_text === "string" && response.output_text.trim()) {
    textParts.push(response.output_text);
  }

  for (const item of response.output || []) {
    if (item.type !== "message" || !Array.isArray(item.content)) continue;
    for (const part of item.content) {
      if (part.type === "output_text" && typeof part.text === "string") textParts.push(part.text);
      if (Array.isArray(part.annotations)) annotations.push(...part.annotations);
    }
  }

  return {
    text: textParts.find((part) => part.trim()) || "",
    annotations,
  };
}

function sourceFromAnnotation(annotation) {
  if (!annotation || annotation.type !== "url_citation" || !annotation.url) return null;
  return {
    title: annotation.title || annotation.url,
    url: annotation.url,
    publisher: extractHostname(annotation.url),
    relevance: "Cited by the live research response.",
    confidence: "cited_live_source",
    kind: "cited_source",
    sourceType: "url_citation",
  };
}

function sourceFromWebAction(source) {
  if (!source || !source.url) return null;
  return {
    title: source.title || source.url,
    url: source.url,
    publisher: source.publisher || extractHostname(source.url),
    relevance: source.snippet || "Returned by the web search tool.",
    confidence: "web_search_result",
    kind: source.kind || "web_search_result",
    sourceType: "web_search_action_source",
  };
}

function sourceFromParsed(source) {
  if (!source || !source.url) return null;
  return {
    title: source.title || source.url,
    url: source.url,
    publisher: source.publisher || extractHostname(source.url),
    relevance: source.relevance || "Named in the structured live research output.",
    confidence: source.confidence || "structured_live_source",
    kind: source.kind || "structured_source",
    sourceType: "structured_output_source",
  };
}

function collectLiveSources(response, parsed) {
  const byUrl = new Map();
  const add = (source) => {
    if (!source || !source.url) return;
    const key = source.url.trim();
    if (!key) return;
    const existing = byUrl.get(key) || {};
    byUrl.set(key, { ...existing, ...source, url: key });
  };

  const { annotations } = outputTextAndAnnotations(response);
  for (const annotation of annotations) add(sourceFromAnnotation(annotation));

  for (const item of response.output || []) {
    if (item.type !== "web_search_call") continue;
    const action = item.action || {};
    for (const source of action.sources || action.results || []) add(sourceFromWebAction(source));
    if (action.query && !action.sources && !action.results) {
      add({
        title: `Web search query: ${action.query}`,
        url: `jarvis://web-search-query/${encodeURIComponent(action.query)}`,
        publisher: "openai-web-search",
        relevance: "Search query executed by the hosted web search tool.",
        confidence: "query_executed",
        kind: "search_query",
        sourceType: "web_search_query",
      });
    }
  }

  // Structured model output may enrich a provider-grounded URL, but it cannot
  // introduce a URL on its own. Grounding comes only from provider citations or
  // hosted-tool provenance.
  for (const source of parsed?.sources || []) {
    const structured = sourceFromParsed(source);
    if (!structured?.url || !byUrl.has(structured.url.trim())) continue;
    const key = structured.url.trim();
    const grounded = byUrl.get(key);
    byUrl.set(key, {
      ...structured,
      ...grounded,
      title: structured.title || grounded.title,
      relevance: structured.relevance || grounded.relevance,
      url: key,
      sourceType: grounded.sourceType,
    });
  }

  return Array.from(byUrl.values())
    .filter((source) => source.url.startsWith("http://") || source.url.startsWith("https://"))
    .slice(0, 12);
}

function usageMetric(usage, keys, knownKey) {
  if (usage[knownKey] === false) return { known: false, value: 0 };
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(usage, key) || usage[key] === null || usage[key] === undefined) continue;
    const value = Number(usage[key]);
    if (Number.isFinite(value) && value >= 0) return { known: true, value };
  }
  return { known: false, value: 0 };
}

function tokenUsage(response) {
  const usage = response?.usage || {};
  const forcedUnknown = usage.usage_status === "unknown" || usage.status === "unknown";
  const input = forcedUnknown
    ? { known: false, value: 0 }
    : usageMetric(usage, ["input_tokens", "inputTokens", "prompt_tokens"], "input_tokens_known");
  const output = forcedUnknown
    ? { known: false, value: 0 }
    : usageMetric(usage, ["output_tokens", "outputTokens", "completion_tokens"], "output_tokens_known");
  const total = forcedUnknown
    ? { known: false, value: 0 }
    : usageMetric(usage, ["total_tokens", "totalTokens"], "total_tokens_known");
  const knownCount = [input, output, total].filter((metric) => metric.known).length;
  return {
    inputTokens: input.value,
    outputTokens: output.value,
    totalTokens: total.value,
    evidence: {
      status: knownCount === 0 ? "unknown" : knownCount === 3 ? "reported" : "partial",
      inputTokens: input.known ? input.value : null,
      outputTokens: output.known ? output.value : null,
      totalTokens: total.known ? total.value : null,
      cachedInputTokens: null,
    },
  };
}

function approvedEstimateCents(task) {
  const request = task.payload?.liveSpendRequest || {};
  return Math.max(1, Number(request.estimatedCostCents || request.maxCostCents || task.cost_budget_cents || CONFIG.liveResearchDefaultBudgetCents || 1));
}

function liveCostEstimateCents(task) {
  const approved = approvedEstimateCents(task);
  const budget = Math.max(1, Number(task.cost_budget_cents || approved));
  return Math.min(approved, budget);
}

function costIdForTask(task) {
  return `cost_spend_${safeId(task.id)}`;
}

function recordLiveResearchCost(db, task, estimateCents, response, metadata = {}) {
  const ts = now();
  const costId = costIdForTask(task);
  const payload = toJson({
    ...metadata,
    approvalId: task.approval_id || task.payload?.liveSpendRequest?.approvalId || null,
    estimatedCostCents: estimateCents,
    exactBillingPending: true,
    noSpendOccurred: false,
    providerResponseId: response.id || null,
  });
  const updated = run(
    db,
    `UPDATE costs
     SET status = ?, amount_cents = ?, occurred_at = ?, metadata = ?,
         run_id = COALESCE(?, run_id), task_id = COALESCE(?, task_id),
         model_call_id = COALESCE(?, model_call_id)
     WHERE id = ?`,
    [
      "incurred_estimate",
      estimateCents,
      ts,
      payload,
      metadata.agentRunId || null,
      task.id,
      metadata.modelCallId || null,
      costId,
    ],
  );
  if (updated.changes === 0) {
    run(
      db,
      `INSERT INTO costs
       (id, workflow_id, venture_id, run_id, task_id, model_call_id, category, source,
        status, amount_cents, currency, occurred_at, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        costId,
        task.workflow_id,
        task.venture_id || null,
        metadata.agentRunId || null,
        task.id,
        metadata.modelCallId || null,
        "live_research",
        LIVE_RESEARCH_PROVIDER,
        "incurred_estimate",
        estimateCents,
        CONFIG.currency,
        ts,
        payload,
      ],
    );
  }
}

function recordLiveResearchModelCall(db, task, response, estimateCents, model, status = "completed", metadata = {}) {
  const usage = tokenUsage(response || {});
  const callId = metadata.modelCallId || `model_${randomId()}`;
  const providerCompleted = ["completed", "provider_completed", "needs_attention"].includes(status);
  const outcomeUnknown = metadata.outcomeUnknown === true;
  const dispatching = status === "dispatching";
  const costStatus = providerCompleted ? "incurred_estimate" : outcomeUnknown ? "unknown" : dispatching ? "reserved" : "released";
  const outcomeStatus = providerCompleted ? "known" : outcomeUnknown ? "unknown" : dispatching ? "provider_dispatched" : "failed_before_effect";
  const errorKind = metadata.errorKind
    || (outcomeUnknown ? "provider_outcome_unknown" : status === "failed" ? "provider_rejected" : null);
  run(
    db,
    `INSERT INTO model_calls (id, workflow_id, task_id, venture_id, provider, model_class, selected_model, mode, status,
      input_tokens, output_tokens, estimated_cost_cents, actual_cost_cents, approval_required, metadata, created_at,
      provider_request_id, cost_status, reserved_cost_cents, incurred_estimate_cents, reconciled_cost_cents, outcome_status,
      error_kind)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       status = excluded.status,
       input_tokens = excluded.input_tokens,
       output_tokens = excluded.output_tokens,
       estimated_cost_cents = excluded.estimated_cost_cents,
       metadata = excluded.metadata,
       provider_request_id = COALESCE(excluded.provider_request_id, model_calls.provider_request_id),
       cost_status = excluded.cost_status,
       reserved_cost_cents = excluded.reserved_cost_cents,
       incurred_estimate_cents = excluded.incurred_estimate_cents,
       outcome_status = excluded.outcome_status,
       error_kind = excluded.error_kind`,
    [
      callId,
      task.workflow_id,
      task.id,
      task.venture_id || null,
      "openai",
      "live-research",
      model,
      "live",
      status,
      usage.inputTokens,
      usage.outputTokens,
      estimateCents,
      0,
      1,
      toJson({
        provider: LIVE_RESEARCH_PROVIDER,
        responseId: response?.id || null,
        totalTokens: usage.evidence.totalTokens,
        tokenUsage: usage.evidence,
        exactBillingPending: providerCompleted,
        reason: "Live research used the OpenAI Responses API hosted web_search tool after approval.",
        ...metadata,
        modelCallId: undefined,
      }),
      now(),
      response?.id || null,
      costStatus,
      estimateCents,
      providerCompleted ? estimateCents : 0,
      0,
      outcomeStatus,
      errorKind,
    ],
  );
  if (metadata.taskAttemptId) bindModelCallToAttempt(db, metadata.taskAttemptId, callId);

  return {
    id: callId,
    provider: "openai",
    class: "live-research",
    selectedModel: model,
    mode: "live",
    status,
    estimatedInputTokens: usage.evidence.inputTokens,
    estimatedOutputTokens: usage.evidence.outputTokens,
    tokenUsage: usage.evidence,
    estimatedCostCents: estimateCents,
    actualCostCents: 0,
    incurredEstimateCents: providerCompleted ? estimateCents : 0,
    costStatus,
    currency: CONFIG.currency,
    exactBillingPending: providerCompleted,
  };
}

function researchToolInvocation(db, task, options = {}) {
  const attemptId = options.taskClaim?.attemptId || null;
  const runId = options.agentRunId || null;
  if (!attemptId || !runId) return null;
  return get(
    db,
    `SELECT id FROM agent_tool_invocations
     WHERE task_id = ? AND run_id = ? AND tool_id = 'research_adapter'
       AND attempt_id = ?
     ORDER BY requested_at DESC, id DESC
     LIMIT 1`,
    [task.id, runId, attemptId],
  );
}

function observeResearchTool(db, invocation, options = {}) {
  if (!invocation?.id) return null;
  return recordAgentToolObservation(db, invocation.id, {
    attemptId: options.taskClaim?.attemptId || null,
    status: options.status,
    toolName: "web_search",
    toolId: "research_adapter",
    activity: options.activity || null,
    outputSummary: options.outputSummary,
  });
}

async function readJsonResponse(response) {
  if (typeof response.json === "function") {
    try {
      return await response.json();
    } catch {
      // Fall through to text parsing below.
    }
  }
  const body = typeof response.text === "function" ? await response.text() : "";
  if (!body) return {};
  try {
    return JSON.parse(body);
  } catch {
    return { raw: body };
  }
}

async function callOpenAIResponses(body, options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== "function") throw providerError(new Error("Fetch is not available for live research execution."), "not_dispatched");
  const apiKey = options.apiKey || process.env.OPENAI_API_KEY;
  if (!apiKey) throw providerError(new Error("OPENAI_API_KEY is required for live research execution."), "not_dispatched");

  let response;
  try {
    response = await fetchImpl(options.responsesUrl || CONFIG.openaiResponsesUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: requestSignal(Number(options.deadlineMs || DEFAULT_PROVIDER_DEADLINE_MS), options.signal),
    });
  } catch (error) {
    throw providerError(error, "outcome_unknown", { providerRequestStarted: true });
  }
  const json = await readJsonResponse(response);
  if (!response.ok) {
    const message = json.error?.message || json.message || json.raw || `HTTP ${response.status}`;
    throw providerError(new Error(`OpenAI live research request failed: ${message}`), "definite_rejection", {
      httpStatus: response.status,
      providerRequestStarted: true,
    });
  }
  return json;
}

function buildOpenAIRequest(task, workflow, command, query) {
  const tracePolicy = task.payload?.liveSpendRequest?.tracePolicy || {};
  const maxToolCalls = Number(task.payload?.liveSpendRequest?.maxToolCalls || 1);
  return {
    model: process.env.JARVIS_LIVE_RESEARCH_MODEL || CONFIG.liveResearchModel,
    store: tracePolicy.providerResponseStored === true,
    tools: [{ type: "web_search", external_web_access: true, search_context_size: "low" }],
    tool_choice: "required",
    include: ["web_search_call.action.sources"],
    max_tool_calls: maxToolCalls,
    max_output_tokens: CONFIG.liveResearchMaxOutputTokens,
    input: [
      {
        role: "system",
        content: "You are a commercial research analyst for an AI business operating system. Be current, skeptical, source-backed, and explicit about uncertainty. Return only valid JSON.",
      },
      { role: "user", content: `${buildLiveResearchPrompt(task, workflow, command)}\n\nSearch query seed: ${query}` },
    ],
    metadata: {
      workflow_id: task.workflow_id,
      task_id: task.id,
      adapter: LIVE_RESEARCH_PROVIDER,
      data_class: String(tracePolicy.dataClass || "business_internal"),
    },
  };
}

function sourceCountStatus(sources) {
  return sources.length >= 3 ? "completed_live" : "completed_live_needs_source_review";
}

async function runLiveResearchTask(db, task, workflow, command, options = {}) {
  const subject = subjectFrom(task, workflow);
  const channel = channelFrom(task, workflow);
  const runId = `research_${randomId()}`;
  const ts = now();
  const query = queryFor(task, workflow, command);
  const budgetCents = Number(task.cost_budget_cents) || approvedEstimateCents(task);
  const requestBody = buildOpenAIRequest(task, workflow, command, query);
  const estimateCents = liveCostEstimateCents(task);
  const deadlineMs = approvedDeadlineMs(task, options);
  const taskAttemptId = options.taskClaim?.attemptId || null;
  const agentRunId = options.agentRunId || null;
  const toolInvocation = researchToolInvocation(db, task, options);
  const dispatchCall = recordLiveResearchModelCall(db, task, null, estimateCents, requestBody.model, "dispatching", {
    agentRunId,
    taskAttemptId,
    dispatchIntent: { status: "dispatched", recordedAt: ts, deadlineMs },
  });
  if (options.taskClaim) {
    markTaskAttemptProviderDispatched(db, options.taskClaim, {
      modelCallId: dispatchCall.id,
      provider: LIVE_RESEARCH_PROVIDER,
      model: requestBody.model,
    });
  }
  let response;
  try {
    response = await callOpenAIResponses(requestBody, { ...options, deadlineMs });
  } catch (error) {
    if (!error.providerDispatchStatus) {
      error = providerError(error, "outcome_unknown", { providerRequestStarted: true });
    }
    error.agentRunId = agentRunId;
    error.taskAttemptId = taskAttemptId;
    error.modelCallId = dispatchCall.id;
    observeResearchTool(db, toolInvocation, {
      ...options,
      status: error.outcomeUnknown === true ? "unknown" : "missing",
      outputSummary: error.outcomeUnknown === true
        ? "The web-search outcome is unknown because the provider request did not return a definitive result."
        : "The approved web search did not complete before the provider rejected the request.",
    });
    const costId = costIdForTask(task);
    const existingCost = get(db, "SELECT metadata FROM costs WHERE id = ?", [costId]);
    if (error.outcomeUnknown === true && existingCost) {
      run(
        db,
        `UPDATE costs
         SET status = 'unknown', amount_cents = ?, occurred_at = ?, metadata = ?,
             run_id = COALESCE(?, run_id), task_id = COALESCE(?, task_id),
             model_call_id = COALESCE(?, model_call_id)
         WHERE id = ?`,
        [
          estimateCents,
          now(),
          toJson({ ...fromJson(existingCost.metadata), outcomeUnknown: true, error: error.message, noSpendOccurred: null, taskId: task.id }),
          agentRunId,
          task.id,
          dispatchCall.id,
          costId,
        ],
      );
    } else if (error.outcomeUnknown === true) {
      run(
        db,
        `INSERT INTO costs
         (id, workflow_id, venture_id, run_id, task_id, model_call_id, category, source,
          status, amount_cents, currency, occurred_at, metadata)
         VALUES (?, ?, ?, ?, ?, ?, 'live_research', ?, 'unknown', ?, ?, ?, ?)`,
        [
          costId,
          task.workflow_id,
          task.venture_id || null,
          agentRunId,
          task.id,
          dispatchCall.id,
          LIVE_RESEARCH_PROVIDER,
          estimateCents,
          CONFIG.currency,
          now(),
          toJson({ taskId: task.id, outcomeUnknown: true, error: error.message, noSpendOccurred: null }),
        ],
      );
    } else if (existingCost) {
      run(
        db,
        `UPDATE costs
         SET status = 'released', amount_cents = 0, occurred_at = ?, metadata = ?,
             run_id = COALESCE(?, run_id), task_id = COALESCE(?, task_id),
             model_call_id = COALESCE(?, model_call_id)
         WHERE id = ?`,
        [
          now(),
          toJson({ ...fromJson(existingCost.metadata), taskId: task.id, outcomeUnknown: false, noSpendOccurred: true, providerDispatchStatus: error.providerDispatchStatus, error: error.message }),
          agentRunId,
          task.id,
          dispatchCall.id,
          costId,
        ],
      );
    }
    const failedCall = recordLiveResearchModelCall(db, task, null, estimateCents, requestBody.model, "failed", {
      modelCallId: dispatchCall.id,
      agentRunId,
      taskAttemptId,
      outcomeUnknown: error.outcomeUnknown === true,
      errorKind: error.outcomeUnknown === true ? "provider_outcome_unknown" : "provider_rejected",
      providerDispatchStatus: error.providerDispatchStatus,
      httpStatus: error.httpStatus || null,
      error: error.message,
    });
    error.modelCallId = failedCall.id;
    error.providerReceipt = {
      modelCallId: failedCall.id,
      providerRequestId: null,
      provider: LIVE_RESEARCH_PROVIDER,
      status: error.providerDispatchStatus,
      deadlineMs,
    };
    error.incurredEstimateCents = 0;
    run(
      db,
      `INSERT INTO research_runs (id, workflow_id, task_id, query, provider, mode, status, budget_cents, actual_cents, summary, metadata, created_at, completed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        runId,
        task.workflow_id,
        task.id,
        query,
        LIVE_RESEARCH_PROVIDER,
        "live",
        "failed_live",
        budgetCents,
        0,
        `Live research failed before usable evidence was captured: ${error.message}`,
        toJson({
          subject,
          channel,
          error: error.message,
          outcomeUnknown: error.outcomeUnknown === true,
          providerDispatchStatus: error.providerDispatchStatus,
          modelCallId: failedCall.id,
          request: { tool: "web_search", toolChoice: "required", deadlineMs },
        }),
        ts,
        now(),
      ],
    );
    insertEvent(db, {
      level: "error",
      actor: "research-adapter",
      type: "research.live_failed",
      entityType: "research_run",
      entityId: runId,
      message: `Live research failed for ${subject}: ${error.message}`,
      metadata: { workflowId: task.workflow_id, taskId: task.id, outcomeUnknown: error.outcomeUnknown === true, providerDispatchStatus: error.providerDispatchStatus, modelCallId: failedCall.id },
    });
    throw error;
  }
  const { text } = outputTextAndAnnotations(response);
  const parsed = parseJsonOutput(text);
  const providerCall = recordLiveResearchModelCall(db, task, response, estimateCents, requestBody.model, "provider_completed", {
    modelCallId: dispatchCall.id,
    agentRunId,
    taskAttemptId,
    structuredOutput: Boolean(parsed),
    deadlineMs,
    providerReceiptRecordedAt: now(),
  });
  const providerReceipt = {
    modelCallId: providerCall.id,
    providerRequestId: response.id || null,
    provider: LIVE_RESEARCH_PROVIDER,
    status: "completed",
    incurredEstimateCents: estimateCents,
    deadlineMs,
  };
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    recordLiveResearchCost(db, task, estimateCents, response, {
      taskId: task.id,
      modelCallId: providerCall.id,
      agentRunId,
      taskAttemptId,
      status: "needs_attention",
      model: requestBody.model,
    });
    recordLiveResearchModelCall(db, task, response, estimateCents, requestBody.model, "needs_attention", {
      modelCallId: providerCall.id,
      agentRunId,
      taskAttemptId,
      structuredOutput: false,
      errorKind: "malformed_structured_output",
      providerReceipt,
    });
    const completedAt = now();
    run(
      db,
      `INSERT INTO research_runs (id, workflow_id, task_id, query, provider, mode, status, budget_cents, actual_cents, summary, metadata, created_at, completed_at)
       VALUES (?, ?, ?, ?, ?, 'live', 'needs_attention', ?, 0, ?, ?, ?, ?)`,
      [
        runId,
        task.workflow_id,
        task.id,
        query,
        LIVE_RESEARCH_PROVIDER,
        budgetCents,
        "The provider returned research output that did not match the required structured format.",
        toJson({ subject, channel, providerReceipt, structuredOutput: false }),
        ts,
        completedAt,
      ],
    );
    const error = new Error("Live research completed, but its output did not match the required structured format.");
    error.outcomeUnknown = false;
    error.providerCallOccurred = true;
    error.needsAttention = true;
    error.providerDispatchStatus = "completed";
    error.incurredEstimateCents = estimateCents;
    error.providerRequestId = response.id || null;
    error.modelCallId = providerCall.id;
    error.errorKind = "malformed_structured_output";
    error.providerReceipt = providerReceipt;
    insertEvent(db, {
      level: "error",
      actor: "research-adapter",
      type: "research.live_output_needs_attention",
      entityType: "research_run",
      entityId: runId,
      message: "The provider call completed, but the research output could not be accepted as a structured result.",
      metadata: providerReceipt,
    });
    throw error;
  }
  const sources = collectLiveSources(response, parsed);
  const searchActivity = (response.output || []).find((item) => item?.type === "web_search_call") || null;
  observeResearchTool(db, toolInvocation, {
    ...options,
    status: searchActivity ? "completed" : "missing",
    activity: searchActivity
      ? {
        id: searchActivity.id || null,
        type: "web_search",
        status: searchActivity.status || "completed",
        query: searchActivity.action?.query || null,
        sourceCount: sources.length,
      }
      : null,
    outputSummary: searchActivity
      ? `OpenAI web search completed and returned ${sources.length} grounded source${sources.length === 1 ? "" : "s"} for review.`
      : "The provider returned a response without a matching web-search activity record.",
  });
  if (!searchActivity) {
    const error = new Error("Live research returned no matching provider web-search activity.");
    error.outcomeUnknown = false;
    error.providerCallOccurred = true;
    error.needsAttention = true;
    error.providerDispatchStatus = "completed";
    error.incurredEstimateCents = estimateCents;
    error.providerRequestId = response.id || null;
    error.modelCallId = providerCall.id;
    error.errorKind = "approved_provider_tool_activity_missing";
    error.providerReceipt = providerReceipt;
    throw error;
  }
  const status = sourceCountStatus(sources);
  const modelCall = recordLiveResearchModelCall(db, task, response, estimateCents, requestBody.model, "completed", {
    modelCallId: providerCall.id,
    agentRunId,
    taskAttemptId,
    structuredOutput: true,
    groundedSourceCount: sources.length,
  });
  recordLiveResearchCost(db, task, estimateCents, response, {
    taskId: task.id,
    modelCallId: modelCall.id,
    agentRunId,
    taskAttemptId,
    sourceCount: sources.length,
    status,
    model: requestBody.model,
  });
  const summary = compactText(parsed.summary || "Live research completed with source-backed evidence.", 1000);

  run(
    db,
    `INSERT INTO research_runs (id, workflow_id, task_id, query, provider, mode, status, budget_cents, actual_cents, summary, metadata, created_at, completed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      runId,
      task.workflow_id,
      task.id,
      query,
      LIVE_RESEARCH_PROVIDER,
      "live",
      status,
      budgetCents,
      0,
      summary,
      toJson({
        subject,
        channel,
        parsed,
        sourceCount: sources.length,
        responseId: response.id || null,
        model: requestBody.model,
        exactBillingPending: true,
        groundingStatus: status === "completed_live" ? "provider_grounded" : "insufficient_provider_grounding",
        groundedSourceCount: sources.length,
        providerReceipt,
        request: { tool: "web_search", toolChoice: "required" },
      }),
      ts,
      now(),
    ],
  );
  insertResearchSources(db, runId, sources);
  insertEvent(db, {
    actor: "research-adapter",
    type: status === "completed_live" ? "research.live_completed" : "research.live_needs_source_review",
    entityType: "research_run",
    entityId: runId,
    message: `Live research completed for ${subject} with ${sources.length} cited source${sources.length === 1 ? "" : "s"}.`,
    metadata: { workflowId: task.workflow_id, taskId: task.id, sourceCount: sources.length, status, estimatedCostCents: estimateCents },
  });

  const persistedSources = all(db, "SELECT * FROM research_sources WHERE run_id = ? ORDER BY retrieved_at ASC", [runId]).map((source) => ({
    ...source,
    metadata: fromJson(source.metadata),
  }));

  return {
    id: runId,
    mode: "live",
    status,
    provider: LIVE_RESEARCH_PROVIDER,
    query,
    budgetCents,
    actualCents: 0,
    incurredEstimateCents: estimateCents,
    reconciledCostCents: 0,
    costStatus: "incurred_estimate",
    staleDataWarning: false,
    exactBillingPending: true,
    summary,
    parsed,
    verdict: parsed.verdict || "research_inconclusive",
    confidence: parsed.confidence || (status === "completed_live" ? "medium" : "low"),
    recommendation: parsed.recommendation || "Review live research before next spend.",
    sources: persistedSources,
    modelCall,
    providerReceipt,
  };
}

function runDryResearchTask(db, task, workflow, command) {
  const subject = subjectFrom(task, workflow);
  const channel = channelFrom(task, workflow);
  const runId = `research_${randomId()}`;
  const ts = now();
  const query = queryFor(task, workflow, command);
  const budgetCents = Number(task.cost_budget_cents) || DEFAULT_RESEARCH_BUDGET_CENTS;
  const sources = requiredSourceTemplates(subject, channel);
  const summary = `Dry-run research plan created for ${subject}. Live evidence is still required before commercial decisions.`;

  run(
    db,
    `INSERT INTO research_runs (id, workflow_id, task_id, query, provider, mode, status, budget_cents, actual_cents, summary, metadata, created_at, completed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      runId,
      task.workflow_id,
      task.id,
      query,
      "jarvis-research-adapter",
      "dry-run",
      "needs_live_research",
      budgetCents,
      0,
      summary,
      toJson({
        subject,
        channel,
        staleDataWarning: true,
        reason: "No live research provider was run for this dry-run proof.",
        requiredSourceKinds: sources.map((source) => source.kind),
      }),
      ts,
      ts,
    ],
  );
  insertResearchSources(db, runId, sources);
  insertEvent(db, {
    actor: "research-adapter",
    type: "research.dry_run_created",
    entityType: "research_run",
    entityId: runId,
    message: `Created dry-run research plan for ${subject}; live evidence is still required.`,
    metadata: { workflowId: task.workflow_id, taskId: task.id, sourcesRequired: sources.length },
  });

  const persistedSources = all(db, "SELECT * FROM research_sources WHERE run_id = ? ORDER BY retrieved_at ASC", [runId]).map((source) => ({
    ...source,
    metadata: fromJson(source.metadata),
  }));

  return {
    id: runId,
    mode: "dry-run",
    status: "needs_live_research",
    provider: "jarvis-research-adapter",
    query,
    budgetCents,
    actualCents: 0,
    staleDataWarning: true,
    summary,
    sources: persistedSources,
  };
}

async function runResearchTask(db, task, workflow, command, options = {}) {
  if (liveResearchEnabled(options)) {
    return runLiveResearchTask(db, task, workflow, command, options);
  }
  return runDryResearchTask(db, task, workflow, command);
}

module.exports = {
  DEFAULT_RESEARCH_BUDGET_CENTS,
  LIVE_RESEARCH_PROVIDER,
  buildOpenAIRequest,
  collectLiveSources,
  runResearchTask,
};
