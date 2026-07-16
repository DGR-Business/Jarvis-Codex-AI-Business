const CONFIG = require("../config");
const { fromJson, get, insertEvent, now, randomId, run, toJson } = require("../db");

const LIVE_AI_WORKER_PROVIDER = "openai-responses-live-worker";

function safeId(value) {
  return String(value || "task")
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .slice(0, 88);
}

function compactText(value, max = 1000) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}

function tokenUsage(response) {
  const usage = response.usage || {};
  return {
    inputTokens: Number(usage.input_tokens || usage.prompt_tokens || 0),
    outputTokens: Number(usage.output_tokens || usage.completion_tokens || 0),
    totalTokens: Number(usage.total_tokens || 0),
  };
}

function costIdForTask(task) {
  return `cost_spend_${safeId(task.id)}`;
}

function approvedEstimateCents(task) {
  const request = task.payload?.liveSpendRequest || {};
  return Math.max(1, Number(request.estimatedCostCents || request.maxCostCents || task.cost_budget_cents || CONFIG.liveModelDefaultBudgetCents || 1));
}

function liveWorkerCostEstimateCents(task) {
  const approved = approvedEstimateCents(task);
  const budget = Math.max(1, Number(task.cost_budget_cents || approved));
  return Math.min(approved, budget);
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

function outputSchema() {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      heading: { type: "string" },
      summary: { type: "string" },
      moneyMove: { type: "string" },
      evidence: { type: "array", items: { type: "string" } },
      counterevidence: { type: "array", items: { type: "string" } },
      priceChannelHypothesis: { type: "string" },
      smallestTest: { type: "string" },
      metric: { type: "string" },
      killRule: { type: "string" },
      risks: { type: "array", items: { type: "string" } },
      nextAction: { type: "string" },
      operatorDecision: { type: "string", enum: ["approve", "revise", "deny", "needs_evidence"] },
      confidence: { type: "string", enum: ["low", "medium", "high"] },
      expectedUpside: { type: "string" },
      costRisk: { type: "string" },
      assumptions: { type: "array", items: { type: "string" } },
      businessDecision: {
        type: "object",
        additionalProperties: false,
        properties: {
          buyer: { type: "string" },
          problem: { type: "string" },
          offer: { type: "string" },
          channel: { type: "string" },
          moneyMove: { type: "string" },
          evidenceSummary: { type: "string" },
          risk: { type: "string", enum: ["low", "medium", "high"] },
          nextAction: { type: "string" },
          successMetric: { type: "string" },
          killCriteria: { type: "string" },
          approvalRequired: { type: "boolean" },
          externalActionsAllowed: { type: "boolean" },
          hardStops: { type: "array", items: { type: "string" } },
          continuousImprovement: {
            type: "object",
            additionalProperties: false,
            properties: {
              hypothesis: { type: "string" },
              smallestUsefulAction: { type: "string" },
              expectedMetric: { type: "string" },
              actualResult: { type: "string" },
              learning: { type: "string" },
              improvement: { type: "string" },
            },
            required: ["hypothesis", "smallestUsefulAction", "expectedMetric", "actualResult", "learning", "improvement"],
          },
        },
        required: [
          "buyer",
          "problem",
          "offer",
          "channel",
          "moneyMove",
          "evidenceSummary",
          "risk",
          "nextAction",
          "successMetric",
          "killCriteria",
          "approvalRequired",
          "externalActionsAllowed",
          "hardStops",
          "continuousImprovement",
        ],
      },
    },
    required: [
      "heading",
      "summary",
      "moneyMove",
      "evidence",
      "counterevidence",
      "priceChannelHypothesis",
      "smallestTest",
      "metric",
      "killRule",
      "risks",
      "nextAction",
      "operatorDecision",
      "confidence",
      "expectedUpside",
      "costRisk",
      "assumptions",
      "businessDecision",
    ],
  };
}

function latestWorkflowContext(db, task) {
  const workflow = get(db, "SELECT * FROM workflows WHERE id = ?", [task.workflow_id]);
  const command = get(db, "SELECT * FROM commands WHERE workflow_id = ? ORDER BY created_at DESC LIMIT 1", [task.workflow_id]);
  const recentTasks = getRecentTasks(db, task.workflow_id);
  const scorecard = get(db, "SELECT * FROM venture_scorecards WHERE workflow_id = ?", [task.workflow_id]);
  return {
    workflow: workflow ? { ...workflow, metadata: fromJson(workflow.metadata, {}) } : null,
    command: command ? { ...command, metadata: fromJson(command.metadata, {}) } : null,
    recentTasks,
    scorecard: scorecard
      ? {
          ...scorecard,
          dimensions: fromJson(scorecard.dimensions, {}),
          risks: fromJson(scorecard.risks, []),
          next_actions: fromJson(scorecard.next_actions, []),
          metadata: fromJson(scorecard.metadata, {}),
        }
      : null,
  };
}

function getRecentTasks(db, workflowId) {
  return db
    .prepare(
      `SELECT id, title, kind, agent, status, result, cost_actual_cents, updated_at
       FROM tasks
       WHERE workflow_id = ? AND kind <> 'live_ai_worker_execution'
       ORDER BY updated_at DESC LIMIT 8`,
    )
    .all(workflowId)
    .map((row) => ({
      id: row.id,
      title: row.title,
      kind: row.kind,
      agent: row.agent,
      status: row.status,
      result: fromJson(row.result, {}),
      costActualCents: row.cost_actual_cents,
      updatedAt: row.updated_at,
    }));
}

function buildWorkerPrompt(task, agentDefinition, policy) {
  const requested = task.payload || {};
  const hardStops = agentDefinition.approval_policy?.mustPauseFor || [];
  const outputInstruction = requested.pilotFixture
    ? "For this controlled Demand Validator pilot, return only the concise supplied-evidence recommendation fields requested by the output schema. Use no more than two short items in each list and one short paragraph per text field. Do not repeat the same judgement in a generic businessDecision object."
    : "The businessDecision object must name the buyer, problem, offer, channel, money move, evidence summary, risk, success metric, stop rule, and learning-loop fields. externalActionsAllowed must be false.";
  return [
    `Worker: ${agentDefinition.name}`,
    `Role: ${agentDefinition.role}`,
    `Instructions: ${agentDefinition.instructions}`,
    `Allowed tools in this run: ${policy.allowedTools.join(", ")}`,
    `Blocked tools/actions: ${policy.blockedTools.join(", ")}`,
    `Hard stops: ${hardStops.join(", ")}`,
    `Expected output: ${requested.expectedOutput || "Operator-ready business decision summary."}`,
    "",
    "You are running inside a business operating system. Do not take external actions. Do not publish, spend money, create accounts, contact customers, make legal/compliance determinations, or claim live market evidence unless supplied in the runtime context.",
    "Your job is to compress the available runtime evidence into a practical operator decision.",
    "Use ordinary business language. If evidence is weak, say so and recommend the smallest useful next action.",
    "For a controlled pilot, reason only over suppliedEvidenceFixture. State counterevidence and assumptions explicitly. Never infer live demand from a test fixture.",
    outputInstruction,
  ].join("\n");
}

function buildOpenAIRequest(db, task, agentDefinition, policy) {
  const context = latestWorkflowContext(db, task);
  const approvedRequest = task.payload?.liveSpendRequest || {};
  const subject = task.payload?.subject || context.workflow?.metadata?.subject || context.workflow?.title || "business idea";
  const channel = task.payload?.channel || context.workflow?.metadata?.channel || context.workflow?.type || "Business Idea";
  const today = new Date().toISOString().slice(0, 10);
  const requestContext = {
    date: today,
    subject,
    channel,
    workflow: context.workflow
      ? {
          id: context.workflow.id,
          title: context.workflow.title,
          status: context.workflow.status,
          currentStep: context.workflow.current_step,
          qualityScore: context.workflow.quality_score,
          expectedProfitCents: context.workflow.expected_profit_cents,
          metadata: context.workflow.metadata,
        }
      : null,
    command: context.command
      ? {
          id: context.command.id,
          source: context.command.source,
          instruction: context.command.raw_text,
          summary: context.command.summary,
          metadata: context.command.metadata,
        }
      : null,
    scorecard: context.scorecard
      ? {
          totalScore: context.scorecard.total_score,
          verdict: context.scorecard.verdict,
          confidence: context.scorecard.confidence,
          recommendation: context.scorecard.recommendation,
          risks: context.scorecard.risks,
          nextActions: context.scorecard.next_actions,
        }
      : null,
    recentTaskOutputs: context.recentTasks,
    suppliedEvidenceFixture: task.payload?.pilotFixture || null,
  };

  return {
    model: approvedRequest.model || process.env.JARVIS_LIVE_MODEL || CONFIG.liveModel,
    max_output_tokens: Math.max(1, Number(approvedRequest.maxOutputTokens || CONFIG.liveModelMaxOutputTokens)),
    input: [
      {
        role: "system",
        content: buildWorkerPrompt(task, agentDefinition, policy),
      },
      {
        role: "user",
        content: [
          "Return one operator-ready business decision in strict JSON.",
          "Runtime context:",
          JSON.stringify(requestContext, null, 2),
        ].join("\n"),
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "jarvis_live_worker_decision",
        strict: true,
        schema: outputSchema(),
      },
    },
    metadata: {
      workflow_id: task.workflow_id,
      task_id: task.id,
      agent_id: agentDefinition.id,
      adapter: approvedRequest.provider || LIVE_AI_WORKER_PROVIDER,
    },
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
  if (typeof fetchImpl !== "function") throw new Error("Fetch is not available for live AI worker execution.");
  const apiKey = options.apiKey || process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is required for live AI worker execution.");

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
    throw new Error(`OpenAI live worker request failed: ${message}`);
  }
  return json;
}

function recordLiveWorkerModelCall(db, task, response, estimateCents, model, status = "completed", metadata = {}) {
  const usage = tokenUsage(response || {});
  const reservedCostCents = Math.max(0, Number(metadata.reservedCostCents ?? estimateCents));
  const callId = `model_${randomId()}`;
  run(
    db,
    `INSERT INTO model_calls (id, workflow_id, task_id, venture_id, provider, model_class, selected_model, mode, status,
      input_tokens, output_tokens, estimated_cost_cents, actual_cost_cents, approval_required, metadata, created_at,
      provider_request_id, cost_status, reserved_cost_cents, incurred_estimate_cents, reconciled_cost_cents,
      outcome_status, error_kind)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      callId,
      task.workflow_id,
      task.id,
      task.venture_id || null,
      "openai",
      "live-ai-worker",
      model || CONFIG.liveModel,
      "live",
      status,
      usage.inputTokens,
      usage.outputTokens,
      estimateCents,
      0,
      1,
      toJson({
        provider: LIVE_AI_WORKER_PROVIDER,
        responseId: response?.id || null,
        totalTokens: usage.totalTokens,
        exactBillingPending: status === "completed",
        ...metadata,
      }),
      now(),
      response?.id || null,
      status === "completed" ? "incurred_estimate" : "unknown",
      reservedCostCents,
      status === "completed" ? estimateCents : 0,
      0,
      status === "completed" ? "known" : "unknown",
      status === "completed" ? null : "provider_outcome_unknown",
    ],
  );

  return {
    id: callId,
    provider: "openai",
    class: "live-ai-worker",
    selectedModel: model || CONFIG.liveModel,
    mode: "live",
    status,
    estimatedInputTokens: usage.inputTokens,
    estimatedOutputTokens: usage.outputTokens,
    estimatedCostCents: estimateCents,
    actualCostCents: 0,
    incurredEstimateCents: status === "completed" ? estimateCents : 0,
    costStatus: status === "completed" ? "incurred_estimate" : "unknown",
    currency: CONFIG.currency,
    exactBillingPending: status === "completed",
  };
}

function recordLiveWorkerCost(db, task, estimateCents, response, metadata = {}) {
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
      [costId, task.workflow_id, task.venture_id || null, "live_ai_worker", LIVE_AI_WORKER_PROVIDER, "incurred_estimate", estimateCents, CONFIG.currency, ts, payload],
    );
  }
}

function recordLiveWorkerFailureCost(db, task, error) {
  const ts = now();
  const costId = costIdForTask(task);
  const existing = get(db, "SELECT metadata FROM costs WHERE id = ?", [costId]);
  if (!existing) return;
  run(
    db,
    `UPDATE costs SET status = ?, amount_cents = ?, occurred_at = ?, metadata = ? WHERE id = ?`,
    [
      "unknown",
      approvedEstimateCents(task),
      ts,
      toJson({
        ...fromJson(existing.metadata, {}),
        noSpendOccurred: null,
        providerFailed: true,
        outcomeUnknown: true,
        error: error.message,
      }),
      costId,
    ],
  );
}

function normalizeOutput(parsed, rawText) {
  const fallbackEvidence = rawText ? [`Raw model output: ${compactText(rawText, 350)}`] : ["The model returned no structured evidence."];
  const decision = parsed?.businessDecision || {};
  const continuousImprovement = decision.continuousImprovement || {};
  const moneyMove = parsed?.moneyMove || decision.moneyMove || "Review evidence before the next commercial action.";
  const nextAction = parsed?.nextAction || decision.nextAction || "Ask the worker to rerun with clearer context or gather stronger evidence.";
  const evidence = Array.isArray(parsed?.evidence) && parsed.evidence.length ? parsed.evidence : fallbackEvidence;
  return {
    heading: parsed?.heading || "Live AI worker decision",
    summary: parsed?.summary || compactText(rawText || "Live AI worker returned an incomplete response."),
    moneyMove,
    evidence,
    counterevidence: Array.isArray(parsed?.counterevidence) && parsed.counterevidence.length
      ? parsed.counterevidence
      : ["No independent paid-buyer evidence was supplied."],
    priceChannelHypothesis: parsed?.priceChannelHypothesis
      || `${decision.offer || "The offer"} needs one bounded price and one evidence-selected channel test.`,
    smallestTest: parsed?.smallestTest || continuousImprovement.smallestUsefulAction || nextAction,
    metric: parsed?.metric || decision.successMetric || "Record a measurable buyer signal.",
    killRule: parsed?.killRule || decision.killCriteria
      || "Stop or revise when the declared sample is reached without the required buyer signal.",
    risks: Array.isArray(parsed?.risks) && parsed.risks.length ? parsed.risks : ["Evidence quality may be insufficient."],
    nextAction,
    operatorDecision: parsed?.operatorDecision || "needs_evidence",
    confidence: parsed?.confidence || "low",
    expectedUpside: parsed?.expectedUpside || "Not quantified yet.",
    costRisk: parsed?.costRisk || "Low capped model spend; exact billing pending after provider reconciliation.",
    assumptions: Array.isArray(parsed?.assumptions) ? parsed.assumptions : [],
    businessDecision: {
      buyer: decision.buyer || "Buyer segment needs stronger evidence.",
      problem: decision.problem || "The commercial problem needs clearer evidence.",
      offer: decision.offer || moneyMove,
      channel: decision.channel || "Manual channel test",
      moneyMove,
      evidenceSummary: decision.evidenceSummary || evidence.slice(0, 3).join(" "),
      risk: decision.risk || "medium",
      nextAction,
      successMetric: decision.successMetric || "A measurable buyer signal is recorded.",
      killCriteria: decision.killCriteria || "Stop or request changes if the buyer, offer, channel, metric, economics, or risk is unclear.",
      approvalRequired: typeof decision.approvalRequired === "boolean" ? decision.approvalRequired : true,
      externalActionsAllowed: false,
      hardStops: Array.isArray(decision.hardStops) && decision.hardStops.length ? decision.hardStops : ["publishing", "external sending", "customer contact", "paid spend", "money movement", "legal or compliance decisions"],
      continuousImprovement: {
        hypothesis: continuousImprovement.hypothesis || "A small protected test can show whether the offer deserves more work.",
        smallestUsefulAction: continuousImprovement.smallestUsefulAction || nextAction,
        expectedMetric: continuousImprovement.expectedMetric || decision.successMetric || "A measurable buyer signal is recorded.",
        actualResult: continuousImprovement.actualResult || "No real-world commercial result has been recorded from this worker output yet.",
        learning: continuousImprovement.learning || "Use the next recorded result or operator decision to improve the offer, channel, spend gate, or stop rule.",
        improvement: continuousImprovement.improvement || "Scale, revise, pause, or kill based on the next measured result.",
      },
    },
  };
}

async function runLiveAiWorkerTask(db, task, agentDefinition, policy, options = {}) {
  if (process.env.JARVIS_ENABLE_LIVE_MODELS !== "1") {
    throw new Error("JARVIS_ENABLE_LIVE_MODELS must be set to 1 for live AI worker execution.");
  }
  if (process.env.JARVIS_DISABLE_LIVE_AI_WORKER_ADAPTER === "1") {
    throw new Error("Live AI worker adapter is disabled.");
  }

  const requestBody = buildOpenAIRequest(db, task, agentDefinition, policy);
  const estimateCents = liveWorkerCostEstimateCents(task);
  let response;
  try {
    response = await callOpenAIResponses(requestBody, options);
  } catch (error) {
    error.outcomeUnknown = true;
    recordLiveWorkerFailureCost(db, task, error);
    const failedCall = recordLiveWorkerModelCall(db, task, null, estimateCents, requestBody.model, "failed", {
      error: error.message,
      outcomeUnknown: true,
    });
    insertEvent(db, {
      level: "error",
      actor: "ai-worker-adapter",
      type: "live_ai_worker.failed",
      entityType: "task",
      entityId: task.id,
      message: `Live AI worker failed before usable output was captured: ${error.message}`,
      metadata: { workflowId: task.workflow_id, taskId: task.id, modelCallId: failedCall.id, outcomeUnknown: true },
    });
    throw error;
  }

  const { text, annotations } = outputTextAndAnnotations(response);
  const parsed = parseJsonOutput(text);
  const output = normalizeOutput(parsed, text);
  const modelCall = recordLiveWorkerModelCall(db, task, response, estimateCents, requestBody.model, "completed", {
    structuredOutput: Boolean(parsed),
    annotationCount: annotations.length,
    reason: "Live AI worker used the OpenAI Responses API after approval; no external tools or side effects were exposed.",
  });
  recordLiveWorkerCost(db, task, estimateCents, response, {
    model: requestBody.model,
    modelCallId: modelCall.id,
    structuredOutput: Boolean(parsed),
    annotationCount: annotations.length,
  });

  insertEvent(db, {
    actor: "ai-worker-adapter",
    type: "live_ai_worker.completed",
    entityType: "task",
    entityId: task.id,
    message: `Live AI worker completed ${task.title} with a capped model call.`,
    metadata: {
      workflowId: task.workflow_id,
      taskId: task.id,
      modelCallId: modelCall.id,
      estimatedCostCents: estimateCents,
      responseId: response.id || null,
    },
  });

  return {
    id: response.id || `live_worker_${randomId()}`,
    mode: "live-ai-worker",
    provider: LIVE_AI_WORKER_PROVIDER,
    model: requestBody.model,
    status: "completed",
    actualCents: 0,
    incurredEstimateCents: estimateCents,
    reconciledCostCents: 0,
    costStatus: "incurred_estimate",
    exactBillingPending: true,
    modelCall,
    output: {
      heading: output.heading,
      summary: output.summary,
      evidence: [
        `Live worker response ${response.id || "completed"} returned through the OpenAI Responses API.`,
        ...output.evidence,
      ],
      details: {
        "Money move": output.moneyMove,
        "Expected upside": output.expectedUpside,
        "Cost/risk": output.costRisk,
        "Operator decision": output.operatorDecision,
        Assumptions: output.assumptions.join("; ") || "None stated.",
      },
      risks: output.risks,
      nextAction: output.nextAction,
      confidence: output.confidence,
      liveEvidence: false,
      modelGenerated: true,
      operatorDecision: output.operatorDecision,
      businessDecision: output.businessDecision,
      pilotRecommendation: {
        evidence: output.evidence,
        counterevidence: output.counterevidence,
        assumptions: output.assumptions,
        priceChannelHypothesis: output.priceChannelHypothesis,
        smallestTest: output.smallestTest,
        metric: output.metric,
        killRule: output.killRule,
        confidence: output.confidence,
        risks: output.risks,
      },
    },
    raw: {
      responseId: response.id || null,
      structuredOutput: Boolean(parsed),
      annotationCount: annotations.length,
    },
  };
}

module.exports = {
  LIVE_AI_WORKER_PROVIDER,
  buildOpenAIRequest,
  buildWorkerPrompt,
  latestWorkflowContext,
  liveWorkerCostEstimateCents,
  normalizeOutput,
  outputSchema,
  recordLiveWorkerCost,
  recordLiveWorkerFailureCost,
  recordLiveWorkerModelCall,
  runLiveAiWorkerTask,
};
