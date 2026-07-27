const CONFIG = require("../config");
const {
  environmentDisabled,
  environmentEnabled,
  environmentValue,
  preferredEnvironmentName,
} = require("./pantheon-environment");
const { fromJson, get, insertEvent, now, randomId, run, toJson } = require("../db");
const {
  buildWorkerModelPacket,
  normalizeWorkerOutput,
  outputSchemaName,
  productBuilderFileOutputJsonSchema,
  productBuilderVisualOutputJsonSchema,
  workerOutputJsonSchema,
} = require("../runtime/agent-model-contracts");
const { bindModelCallToAttempt } = require("../runtime/agent-execution-evidence");
const { spendCostId } = require("../runtime/stable-id");
const { markTaskAttemptProviderDispatched } = require("../runtime/task-claims");

const LIVE_AI_WORKER_PROVIDER = "openai-responses-live-worker";
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

function compactText(value, max = 1000) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
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
  const cached = forcedUnknown
    ? { known: false, value: 0 }
    : usageMetric(usage, ["cached_input_tokens", "cachedInputTokens"], "cached_input_tokens_known");
  const cacheWrite = forcedUnknown
    ? { known: false, value: 0 }
    : usageMetric(
      usage,
      ["cache_write_input_tokens", "input_cache_write_tokens", "cacheWriteInputTokens", "cacheWriteTokens"],
      "cache_write_input_tokens_known",
    );
  const knownCount = [input, output, total].filter((metric) => metric.known).length;
  const status = knownCount === 0 ? "unknown" : knownCount === 3 ? "reported" : "partial";
  return {
    inputTokens: input.value,
    outputTokens: output.value,
    totalTokens: total.value,
    cachedInputTokens: cached.value,
    cacheWriteInputTokens: cacheWrite.value,
    evidence: {
      status,
      inputTokens: input.known ? input.value : null,
      outputTokens: output.known ? output.value : null,
      totalTokens: total.known ? total.value : null,
      cachedInputTokens: cached.known ? cached.value : null,
      cacheWriteInputTokens: cacheWrite.known ? cacheWrite.value : null,
    },
  };
}

function costIdForTask(task) {
  return spendCostId(task.id);
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
  const requestedTools = requested.liveSpendRequest?.tools || [];
  const requiredCorrections = Array.isArray(requested.workBrief?.requiredCorrections)
    ? requested.workBrief.requiredCorrections
      .filter(Boolean)
      .map((item) => compactText(item, 700))
      .slice(0, 6)
    : [];
  const productFileFactoryRun = agentDefinition.id === "product_builder"
    && requestedTools.includes("product_file_factory");
  const productVisualRun = agentDefinition.id === "product_builder"
    && requestedTools.includes("image_generation_spend");
  const hardStops = agentDefinition.approval_policy?.mustPauseFor || [];
  const chiefInstruction = agentDefinition.id === "chief_of_staff"
    ? requested.chiefOrchestration?.enabled === true
      ? "You may nominate exactly one existing specialist from the allowed fixed team. Use specialistNeeded=true only when that worker has a clear bounded objective and expected output. Choose protected or supervised_live; do not invent, spawn, rename, or delete workers, and do not grant tools, approval, spend, or external authority."
      : "This is not a specialist-assignment run. Set specialistNeeded=false and leave the specialist text fields empty with an empty specialistContextClasses list."
    : null;
  const qualityInstruction = agentDefinition.id === "quality_reviewer"
    ? "Review only qualityReviewTargets, qualityReviewPacket, and approvedAssetInputs. They contain the exact files, complete package facts, and visuals frozen for this approval. If qualityReviewTargets or qualityReviewPacket is empty, do not pass the work. Keep the strict result compact: one short sentence in each text field and at most three short items in each array, with no repeated finding. Return riskFindings and missingEvidence as explicit arrays, including empty arrays when none exist. In claimSafety, begin with Safe, Revise, or Unsafe and briefly explain why; do not return only the label."
    : null;
  const outputInstruction = productFileFactoryRun
    ? "Return the exact Product Builder fields in strict JSON. The productBlueprint must match every ID in approvedProductBuildSpec, define complete customer-facing contents, and include practical fields, instructions, realistic sample records, and a calculations array for every item. Keep each text field concise and do not repeat explanations. Do not claim files already exist. Pantheon will render and validate the files deterministically from this blueprint after your answer passes schema validation."
    : productVisualRun
      ? "After creating the one approved image, return the exact compact Product Builder visual fields in strict JSON. Keep every text field to one short sentence and limitations to at most two short items. Do not repeat the image prompt or describe work that was not completed."
    : requested.pilotFixture
    ? "For this controlled Demand Validator pilot, return only the concise supplied-evidence recommendation fields requested by the output schema. Use no more than two short items in each list and one short paragraph per text field. Do not repeat the same judgement in a generic businessDecision object."
    : `Return the shared recommendation fields plus the exact ${agentDefinition.name} role fields inside work. Do not add a generic businessDecision object or fields that are not in the supplied schema.`;
  const evidenceInstruction = requested.pilotFixture
    ? "Reason only over suppliedEvidenceFixture. State counterevidence and assumptions explicitly. Never infer live demand from a controlled test example."
    : requestedTools.some((toolId) => ["research_adapter", "live_web_with_approval"].includes(toolId))
      ? "Use the approved web search before deciding. Search directly for current buyer language, competing alternatives, price signals, or a reachable audience relevant to this exact buyer and problem. A calculator, weather, time, or unrelated query does not satisfy this assignment. Base any live-evidence claim on attributable source URLs returned in this run. If no usable source URL is returned, state that the research is incomplete and do not recommend advancing on live evidence."
      : null;
  const correctionInstruction = requiredCorrections.length
    ? [
      "This is a reviewed correction attempt. The following checks are mandatory and take priority over inherited drafting preferences:",
      ...requiredCorrections.map((item, index) => `${index + 1}. ${item}`),
      "Implement each correction in the structured result. Do not merely acknowledge, explain, or restate it.",
    ].join("\n")
    : null;
  return [
    `Worker: ${agentDefinition.name}`,
    `Role: ${agentDefinition.role}`,
    `Instructions: ${agentDefinition.instructions}`,
    `Allowed tools in this run: ${policy.allowedTools.join(", ")}`,
    `Blocked tools/actions: ${policy.blockedTools.join(", ")}`,
    `Hard stops: ${hardStops.join(", ")}`,
    `Expected output: ${requested.expectedOutput || "Operator-ready business decision summary."}`,
    "",
    "You are running inside a business operating system. Do not take external actions. Do not publish, spend money, create accounts, contact customers, or make legal/compliance determinations. Claim live market evidence only when it is supplied in the runtime context or returned by an approved tool in this run.",
    "Your job is to compress the available runtime evidence into a practical operator decision.",
    "Use ordinary business language. If evidence is weak, say so and recommend the smallest useful next action.",
    evidenceInstruction,
    chiefInstruction,
    qualityInstruction,
    correctionInstruction,
    outputInstruction,
  ].filter(Boolean).join("\n");
}

function buildOpenAIRequest(db, task, agentDefinition, policy) {
  const approvedRequest = task.payload?.liveSpendRequest || {};
  const requestContext = buildWorkerModelPacket(db, task, agentDefinition);
  const tracePolicy = approvedRequest.tracePolicy || {};
  const productFileFactoryRun = agentDefinition.id === "product_builder"
    && Array.isArray(approvedRequest.tools)
    && approvedRequest.tools.includes("product_file_factory");
  const productVisualRun = agentDefinition.id === "product_builder"
    && Array.isArray(approvedRequest.tools)
    && approvedRequest.tools.includes("image_generation_spend");

  return {
    model: approvedRequest.model || environmentValue("liveModel", CONFIG.liveModel),
    store: tracePolicy.providerResponseStored === true,
    max_output_tokens: Math.max(1, Number(approvedRequest.maxOutputTokens || CONFIG.liveModelMaxOutputTokens)),
    input: [
      {
        role: "system",
        content: buildWorkerPrompt(task, agentDefinition, policy),
      },
      {
        role: "user",
        content: [
          productFileFactoryRun
            ? "Design the exact approved product package once. Return the strict Product Builder JSON; Pantheon will render real local files from productBlueprint after validation."
            : productVisualRun
              ? "Create the one approved storefront image, then return one compact Product Builder visual result in strict JSON."
              : "Return one operator-ready business decision in strict JSON.",
          "Worker-specific business packet:",
          JSON.stringify(requestContext, null, 2),
        ].join("\n"),
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: outputSchemaName(agentDefinition.id),
        strict: true,
        schema: productFileFactoryRun
          ? productBuilderFileOutputJsonSchema(approvedRequest.parameters?.productBuildSpec)
          : productVisualRun
            ? productBuilderVisualOutputJsonSchema()
            : workerOutputJsonSchema(agentDefinition.id),
      },
    },
    metadata: {
      workflow_id: task.workflow_id,
      task_id: task.id,
      agent_id: agentDefinition.id,
      adapter: approvedRequest.provider || LIVE_AI_WORKER_PROVIDER,
      packet_schema: requestContext.schema,
      packet_hash: requestContext.packetHash,
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
  if (typeof fetchImpl !== "function") {
    throw providerError(new Error("Fetch is not available for live AI worker execution."), "not_dispatched");
  }
  const apiKey = options.apiKey || process.env.OPENAI_API_KEY;
  if (!apiKey) throw providerError(new Error("OPENAI_API_KEY is required for live AI worker execution."), "not_dispatched");

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
    throw providerError(new Error(`OpenAI live worker request failed: ${message}`), "definite_rejection", {
      httpStatus: response.status,
      providerRequestStarted: true,
    });
  }
  return json;
}

function recordLiveWorkerModelCall(db, task, response, estimateCents, model, status = "completed", metadata = {}) {
  const usage = tokenUsage(response || {});
  const reservedCostCents = Math.max(0, Number(metadata.reservedCostCents ?? estimateCents));
  const callId = metadata.modelCallId || `model_${randomId()}`;
  const providerResponseReceived = metadata.providerResponseReceived === true;
  const definiteProviderRejection = metadata.definiteProviderRejection === true;
  const providerCompleted = !definiteProviderRejection && (
    providerResponseReceived
    || ["completed", "provider_completed", "waiting_approval", "needs_attention"].includes(status)
  );
  const outcomeUnknown = metadata.outcomeUnknown === true;
  const dispatching = status === "dispatching";
  const costStatus = providerCompleted ? "incurred_estimate" : outcomeUnknown ? "unknown" : dispatching ? "reserved" : "released";
  const outcomeStatus = definiteProviderRejection
    ? "failed_before_effect"
    : providerCompleted
      ? "known"
      : outcomeUnknown
        ? "unknown"
        : dispatching
          ? "provider_dispatched"
          : "failed_before_effect";
  const errorKind = metadata.errorKind
    || (outcomeUnknown ? "provider_outcome_unknown" : status === "failed" ? "provider_rejected" : null);
  const providerRequestId = response?.id || metadata.providerRequestId || null;
  run(
    db,
    `INSERT INTO model_calls (id, workflow_id, task_id, venture_id, provider, model_class, selected_model, mode, status,
      input_tokens, output_tokens, estimated_cost_cents, actual_cost_cents, approval_required, metadata, created_at,
      provider_request_id, cost_status, reserved_cost_cents, incurred_estimate_cents, reconciled_cost_cents,
      outcome_status, error_kind)
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
        totalTokens: usage.evidence.totalTokens,
        tokenUsage: usage.evidence,
        exactBillingPending: providerCompleted,
        ...metadata,
        modelCallId: undefined,
      }),
      now(),
      providerRequestId,
      costStatus,
      reservedCostCents,
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
    class: "live-ai-worker",
    selectedModel: model || CONFIG.liveModel,
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

function recordLiveWorkerCost(db, task, estimateCents, response, metadata = {}) {
  const ts = now();
  const costId = costIdForTask(task);
  const existing = get(db, "SELECT amount_cents, metadata FROM costs WHERE id = ?", [costId]);
  const existingMetadata = fromJson(existing?.metadata, {});
  const modelCallId = metadata.modelCallId || null;
  const agentRunId = metadata.agentRunId || null;
  const recordedModelCallIds = Array.isArray(existingMetadata.modelCallIds) ? existingMetadata.modelCallIds : [];
  const alreadyRecorded = modelCallId && recordedModelCallIds.includes(modelCallId);
  const amountCents = alreadyRecorded
    ? Number(existing?.amount_cents || 0)
    : Number(existing?.amount_cents || 0) + Math.max(0, Number(estimateCents || 0));
  const payload = toJson({
    ...existingMetadata,
    ...metadata,
    approvalId: task.approval_id || task.payload?.liveSpendRequest?.approvalId || null,
    taskId: task.id,
    estimatedCostCents: amountCents,
    exactBillingPending: true,
    noSpendOccurred: false,
    providerResponseId: response.id || null,
    modelCallIds: modelCallId ? [...new Set([...recordedModelCallIds, modelCallId])] : recordedModelCallIds,
  });
  const updated = run(
    db,
    `UPDATE costs
     SET status = ?, amount_cents = ?, occurred_at = ?, metadata = ?,
         run_id = COALESCE(?, run_id), task_id = COALESCE(?, task_id),
         model_call_id = COALESCE(?, model_call_id)
     WHERE id = ?`,
    ["incurred_estimate", amountCents, ts, payload, agentRunId, task.id, modelCallId, costId],
  );
  if (updated.changes === 0) {
    run(
      db,
      `INSERT INTO costs
       (id, workflow_id, venture_id, run_id, task_id, model_call_id, category, source, status,
        amount_cents, currency, occurred_at, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        costId,
        task.workflow_id,
        task.venture_id || null,
        agentRunId,
        task.id,
        modelCallId,
        "live_ai_worker",
        LIVE_AI_WORKER_PROVIDER,
        "incurred_estimate",
        amountCents,
        CONFIG.currency,
        ts,
        payload,
      ],
    );
  }
}

function recordLiveWorkerFailureCost(db, task, error) {
  const ts = now();
  const costId = costIdForTask(task);
  const existing = get(db, "SELECT metadata FROM costs WHERE id = ?", [costId]);
  const boundAttempt = error.taskAttemptId
    ? get(db, "SELECT agent_run_id FROM task_attempts WHERE id = ? AND task_id = ?", [error.taskAttemptId, task.id])
    : null;
  const agentRunId = error.agentRunId || boundAttempt?.agent_run_id || null;
  const modelCallId = error.modelCallId || null;
  if (
    error.providerResponseReceived === true
    && error.outcomeUnknown !== true
    && error.definiteProviderRejection !== true
  ) {
    const approvedCapCents = approvedEstimateCents(task);
    const amountCents = Math.min(
      approvedCapCents,
      Math.max(0, Number(error.incurredEstimateCents || approvedCapCents)),
    );
    const payload = toJson({
      ...fromJson(existing?.metadata, {}),
      taskId: task.id,
      noSpendOccurred: false,
      providerFailed: true,
      outcomeUnknown: false,
      providerResponseReceived: true,
      exactBillingPending: true,
      providerDispatchStatus: error.providerDispatchStatus || "response_received_invalid_output",
      error: error.message,
    });
    const updated = run(
      db,
      `UPDATE costs
       SET status = 'incurred_estimate', amount_cents = ?, occurred_at = ?, metadata = ?,
           run_id = COALESCE(?, run_id), task_id = COALESCE(?, task_id),
           model_call_id = COALESCE(?, model_call_id)
       WHERE id = ?`,
      [amountCents, ts, payload, agentRunId, task.id, modelCallId, costId],
    );
    if (updated.changes === 0) {
      run(
        db,
        `INSERT INTO costs
         (id, workflow_id, venture_id, run_id, task_id, model_call_id, category, source, status,
          amount_cents, currency, occurred_at, metadata)
         VALUES (?, ?, ?, ?, ?, ?, 'live_ai_worker', ?, 'incurred_estimate', ?, ?, ?, ?)`,
        [
          costId,
          task.workflow_id,
          task.venture_id || null,
          agentRunId,
          task.id,
          modelCallId,
          LIVE_AI_WORKER_PROVIDER,
          amountCents,
          CONFIG.currency,
          ts,
          payload,
        ],
      );
    }
    return;
  }
  if (error.outcomeUnknown !== true) {
    if (existing) {
      run(
        db,
        `UPDATE costs
         SET status = 'released', amount_cents = 0, occurred_at = ?, metadata = ?,
             run_id = COALESCE(?, run_id), task_id = COALESCE(?, task_id),
             model_call_id = COALESCE(?, model_call_id)
         WHERE id = ?`,
        [
          ts,
          toJson({
            ...fromJson(existing.metadata, {}),
            noSpendOccurred: true,
            providerFailed: true,
            outcomeUnknown: false,
            definiteProviderRejection: error.definiteProviderRejection === true,
            httpStatus: error.httpStatus || error.status || null,
            providerRequestId: error.providerRequestId || error.requestID || null,
            providerDispatchStatus: error.providerDispatchStatus || "not_dispatched",
            error: error.message,
          }),
          agentRunId,
          task.id,
          modelCallId,
          costId,
        ],
      );
    }
    return;
  }
  if (!existing) {
    run(
      db,
      `INSERT INTO costs
       (id, workflow_id, venture_id, run_id, task_id, model_call_id, category, source, status,
        amount_cents, currency, occurred_at, metadata)
       VALUES (?, ?, ?, ?, ?, ?, 'live_ai_worker', ?, 'unknown', ?, ?, ?, ?)`,
      [
        costId,
        task.workflow_id,
        task.venture_id || null,
        agentRunId,
        task.id,
        modelCallId,
        LIVE_AI_WORKER_PROVIDER,
        approvedEstimateCents(task),
        CONFIG.currency,
        ts,
        toJson({ taskId: task.id, noSpendOccurred: null, providerFailed: true, outcomeUnknown: true, error: error.message }),
      ],
    );
    return;
  }
  run(
    db,
    `UPDATE costs
     SET status = ?, amount_cents = ?, occurred_at = ?, metadata = ?,
         run_id = COALESCE(?, run_id), task_id = COALESCE(?, task_id),
         model_call_id = COALESCE(?, model_call_id)
     WHERE id = ?`,
    [
      "unknown",
      approvedEstimateCents(task),
      ts,
      toJson({
        ...fromJson(existing.metadata, {}),
        noSpendOccurred: null,
        providerFailed: true,
        outcomeUnknown: error.outcomeUnknown === true,
        providerDispatchStatus: error.providerDispatchStatus || null,
        error: error.message,
      }),
      agentRunId,
      task.id,
      modelCallId,
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
  if (!environmentEnabled("enableLiveModels")) {
    throw new Error(`Pantheon AI workers are disabled. Set ${preferredEnvironmentName("enableLiveModels")}=1 before approved live work.`);
  }
  if (environmentDisabled("disableLiveAiWorkerAdapter")) {
    throw new Error("Pantheon's OpenAI worker connection is disabled in the runtime configuration.");
  }

  const requestBody = buildOpenAIRequest(db, task, agentDefinition, policy);
  const estimateCents = liveWorkerCostEstimateCents(task);
  const deadlineMs = approvedDeadlineMs(task, options);
  const dispatchCall = recordLiveWorkerModelCall(db, task, null, estimateCents, requestBody.model, "dispatching", {
    reservedCostCents: estimateCents,
    agentRunId: options.agentRunId || null,
    taskAttemptId: options.taskClaim?.attemptId || null,
    dispatchIntent: { status: "dispatched", recordedAt: now(), deadlineMs },
  });
  if (options.taskClaim) {
    markTaskAttemptProviderDispatched(db, options.taskClaim, {
      modelCallId: dispatchCall.id,
      provider: LIVE_AI_WORKER_PROVIDER,
      model: requestBody.model,
    });
  }
  let response;
  try {
    response = await callOpenAIResponses(requestBody, { ...options, deadlineMs });
  } catch (error) {
    let failure = error;
    if (!failure.providerDispatchStatus) {
      failure = providerError(failure, "outcome_unknown", { providerRequestStarted: true });
    }
    failure.agentRunId = options.agentRunId || null;
    failure.taskAttemptId = options.taskClaim?.attemptId || null;
    failure.modelCallId = dispatchCall.id;
    recordLiveWorkerFailureCost(db, task, failure);
    const failedCall = recordLiveWorkerModelCall(db, task, null, estimateCents, requestBody.model, "failed", {
      modelCallId: dispatchCall.id,
      agentRunId: options.agentRunId || null,
      taskAttemptId: options.taskClaim?.attemptId || null,
      error: failure.message,
      outcomeUnknown: failure.outcomeUnknown === true,
      errorKind: failure.outcomeUnknown === true ? "provider_outcome_unknown" : "provider_rejected",
      providerDispatchStatus: failure.providerDispatchStatus,
      httpStatus: failure.httpStatus || null,
    });
    failure.modelCallId = failedCall.id;
    failure.providerReceipt = {
      modelCallId: failedCall.id,
      providerRequestId: null,
      provider: LIVE_AI_WORKER_PROVIDER,
      status: failure.providerDispatchStatus,
      deadlineMs,
    };
    failure.incurredEstimateCents = 0;
    insertEvent(db, {
      level: "error",
      actor: "ai-worker-adapter",
      type: "live_ai_worker.failed",
      entityType: "task",
      entityId: task.id,
      message: `Live AI worker failed before usable output was captured: ${failure.message}`,
      metadata: {
        workflowId: task.workflow_id,
        taskId: task.id,
        modelCallId: failedCall.id,
        outcomeUnknown: failure.outcomeUnknown === true,
        providerDispatchStatus: failure.providerDispatchStatus,
      },
    });
    throw failure;
  }

  const { text, annotations } = outputTextAndAnnotations(response);
  const parsed = parseJsonOutput(text);
  const providerCall = recordLiveWorkerModelCall(db, task, response, estimateCents, requestBody.model, "provider_completed", {
    modelCallId: dispatchCall.id,
    agentRunId: options.agentRunId || null,
    taskAttemptId: options.taskClaim?.attemptId || null,
    structuredOutput: Boolean(parsed),
    annotationCount: annotations.length,
    deadlineMs,
    providerReceiptRecordedAt: now(),
    reason: "The provider returned a response. Local schema validation and business processing follow this durable receipt.",
  });
  recordLiveWorkerCost(db, task, estimateCents, response, {
    model: requestBody.model,
    modelCallId: providerCall.id,
    agentRunId: options.agentRunId || null,
    taskAttemptId: options.taskClaim?.attemptId || null,
    structuredOutput: Boolean(parsed),
    annotationCount: annotations.length,
  });
  const providerReceipt = {
    modelCallId: providerCall.id,
    providerRequestId: response.id || null,
    provider: LIVE_AI_WORKER_PROVIDER,
    status: "completed",
    incurredEstimateCents: estimateCents,
    deadlineMs,
  };
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    const modelCall = recordLiveWorkerModelCall(db, task, response, estimateCents, requestBody.model, "needs_attention", {
      modelCallId: providerCall.id,
      agentRunId: options.agentRunId || null,
      taskAttemptId: options.taskClaim?.attemptId || null,
      structuredOutput: false,
      annotationCount: annotations.length,
      errorKind: "malformed_structured_output",
      providerReceipt,
    });
    const error = new Error("The live AI worker returned output that did not match the required structured format.");
    error.outcomeUnknown = false;
    error.providerCallOccurred = true;
    error.needsAttention = true;
    error.providerDispatchStatus = "completed";
    error.incurredEstimateCents = estimateCents;
    error.providerRequestId = response.id || null;
    error.modelCallId = modelCall.id;
    error.errorKind = "malformed_structured_output";
    error.providerReceipt = providerReceipt;
    insertEvent(db, {
      level: "error",
      actor: "ai-worker-adapter",
      type: "live_ai_worker.output_needs_attention",
      entityType: "task",
      entityId: task.id,
      message: "The provider call completed, but its output could not be accepted as a structured business result.",
      metadata: providerReceipt,
    });
    throw error;
  }
  const roleOutput = normalizeWorkerOutput(agentDefinition.id, parsed, agentDefinition.name);
  const output = normalizeOutput(roleOutput, text);
  output.roleOutput = roleOutput?.roleOutput || null;
  const modelCall = recordLiveWorkerModelCall(db, task, response, estimateCents, requestBody.model, "completed", {
    modelCallId: providerCall.id,
    agentRunId: options.agentRunId || null,
    taskAttemptId: options.taskClaim?.attemptId || null,
    structuredOutput: Boolean(parsed),
    annotationCount: annotations.length,
    reason: "Live AI worker used the OpenAI Responses API after approval; no external tools or side effects were exposed.",
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
      providerReceipt,
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
    providerReceipt,
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
