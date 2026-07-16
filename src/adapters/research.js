const CONFIG = require("../config");
const { all, fromJson, get, insertEvent, now, randomId, run, toJson } = require("../db");

const DEFAULT_RESEARCH_BUDGET_CENTS = 75;
const LIVE_RESEARCH_PROVIDER = "openai-responses-web-search";

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

  for (const source of parsed?.sources || []) add(sourceFromParsed(source));

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

  return Array.from(byUrl.values())
    .filter((source) => source.url.startsWith("http://") || source.url.startsWith("https://"))
    .slice(0, 12);
}

function tokenUsage(response) {
  const usage = response.usage || {};
  return {
    inputTokens: Number(usage.input_tokens || usage.prompt_tokens || 0),
    outputTokens: Number(usage.output_tokens || usage.completion_tokens || 0),
    totalTokens: Number(usage.total_tokens || 0),
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
    `UPDATE costs SET status = ?, amount_cents = ?, occurred_at = ?, metadata = ? WHERE id = ?`,
    ["incurred_estimate", estimateCents, ts, payload, costId],
  );
  if (updated.changes === 0) {
    run(
      db,
      `INSERT INTO costs (id, workflow_id, venture_id, category, source, status, amount_cents, currency, occurred_at, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [costId, task.workflow_id, task.venture_id || null, "live_research", LIVE_RESEARCH_PROVIDER, "incurred_estimate", estimateCents, CONFIG.currency, ts, payload],
    );
  }
}

function recordLiveResearchModelCall(db, task, response, estimateCents, model) {
  const usage = tokenUsage(response);
  const callId = `model_${randomId()}`;
  run(
    db,
    `INSERT INTO model_calls (id, workflow_id, task_id, venture_id, provider, model_class, selected_model, mode, status,
      input_tokens, output_tokens, estimated_cost_cents, actual_cost_cents, approval_required, metadata, created_at,
      provider_request_id, cost_status, reserved_cost_cents, incurred_estimate_cents, reconciled_cost_cents, outcome_status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      callId,
      task.workflow_id,
      task.id,
      task.venture_id || null,
      "openai",
      "live-research",
      model,
      "live",
      "completed",
      usage.inputTokens,
      usage.outputTokens,
      estimateCents,
      0,
      1,
      toJson({
        provider: LIVE_RESEARCH_PROVIDER,
        responseId: response.id || null,
        totalTokens: usage.totalTokens,
        exactBillingPending: true,
        reason: "Live research used the OpenAI Responses API hosted web_search tool after approval.",
      }),
      now(),
      response.id || null,
      "incurred_estimate",
      estimateCents,
      estimateCents,
      0,
      "known",
    ],
  );

  return {
    id: callId,
    provider: "openai",
    class: "live-research",
    selectedModel: model,
    mode: "live",
    status: "completed",
    estimatedInputTokens: usage.inputTokens,
    estimatedOutputTokens: usage.outputTokens,
    estimatedCostCents: estimateCents,
    actualCostCents: 0,
    incurredEstimateCents: estimateCents,
    costStatus: "incurred_estimate",
    currency: CONFIG.currency,
    exactBillingPending: true,
  };
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
  if (typeof fetchImpl !== "function") throw new Error("Fetch is not available for live research execution.");
  const apiKey = options.apiKey || process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is required for live research execution.");

  const response = await fetchImpl(options.responsesUrl || CONFIG.openaiResponsesUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
    signal: options.signal,
  });
  const json = await readJsonResponse(response);
  if (!response.ok) {
    const message = json.error?.message || json.message || json.raw || `HTTP ${response.status}`;
    throw new Error(`OpenAI live research request failed: ${message}`);
  }
  return json;
}

function buildOpenAIRequest(task, workflow, command, query) {
  return {
    model: process.env.JARVIS_LIVE_RESEARCH_MODEL || CONFIG.liveResearchModel,
    tools: [{ type: "web_search", external_web_access: true }],
    tool_choice: "required",
    include: ["web_search_call.action.sources"],
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
  let response;
  try {
    response = await callOpenAIResponses(requestBody, options);
  } catch (error) {
    error.outcomeUnknown = true;
    const estimateCents = liveCostEstimateCents(task);
    const costId = costIdForTask(task);
    const existingCost = get(db, "SELECT metadata FROM costs WHERE id = ?", [costId]);
    if (existingCost) {
      run(
        db,
        "UPDATE costs SET status = 'unknown', amount_cents = ?, occurred_at = ?, metadata = ? WHERE id = ?",
        [estimateCents, now(), toJson({ ...fromJson(existingCost.metadata), outcomeUnknown: true, error: error.message, noSpendOccurred: null }), costId],
      );
    }
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
        toJson({ subject, channel, error: error.message, outcomeUnknown: true, request: { tool: "web_search", toolChoice: "required" } }),
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
      metadata: { workflowId: task.workflow_id, taskId: task.id, outcomeUnknown: true },
    });
    throw error;
  }
  const { text } = outputTextAndAnnotations(response);
  const parsed = parseJsonOutput(text) || {
    summary: compactText(text || "Live research returned an unstructured response."),
    verdict: "research_inconclusive",
    confidence: "low",
    recommendation: "Review the raw live research output and rerun if sources are insufficient.",
    sources: [],
  };
  const sources = collectLiveSources(response, parsed);
  const status = sourceCountStatus(sources);
  const estimateCents = liveCostEstimateCents(task);
  const modelCall = recordLiveResearchModelCall(db, task, response, estimateCents, requestBody.model);
  recordLiveResearchCost(db, task, estimateCents, response, { sourceCount: sources.length, status, model: requestBody.model });
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
