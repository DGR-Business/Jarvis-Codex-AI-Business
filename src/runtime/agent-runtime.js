const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const CONFIG = require("../config");
const { all, fromJson, get, insertEvent, now, randomId, run, toJson } = require("../db");
const {
  LIVE_AI_WORKER_PROVIDER,
  buildOpenAIRequest,
  liveWorkerCostEstimateCents,
  normalizeOutput,
  recordLiveWorkerCost,
  recordLiveWorkerFailureCost,
  recordLiveWorkerModelCall,
  runLiveAiWorkerTask,
} = require("../adapters/live-ai-worker");
const {
  demandValidatorPilotOutputSchema: demandValidatorPilotSchema,
  normalizeWorkerOutput,
  workerOutputZodSchema,
} = require("./agent-model-contracts");
const {
  buildAgentsSdkModelInput,
  buildAgentsSdkCapabilityPlan,
  extractAgentsSdkToolActivity,
  extractGeneratedImages,
  materializeAgentsSdkTools,
  sdkInterruptionDetails,
} = require("./agent-sdk-capabilities");
const {
  AgentToolApprovalRequiredError,
  recordAgentToolObservation,
  requestAgentToolUse,
} = require("./agent-tool-gate");
const { persistAgentsSdkResearchEvidence } = require("./agent-execution-evidence");
const { estimateModelUsageAud } = require("./model-pricing");
const { markTaskAttemptProviderDispatched } = require("./task-claims");

const AGENTS_SDK_PROVIDER = "openai-agents-sdk";

let testSdkRunner = null;
let defaultSdkRunner = null;

function safeId(value) {
  return String(value || "asset").replace(/[^a-zA-Z0-9_-]+/g, "_").slice(0, 80);
}

function stableSafetyIdentifier(task) {
  return `jarvis_${crypto.createHash("sha256").update(String(task.venture_id || task.workflow_id || "local-operator")).digest("hex").slice(0, 32)}`;
}

function getApprovedSdkResumeSelection(db, task) {
  if (!task.id || !task.approval_id) return null;
  const candidates = all(
    db,
    `SELECT invocations.id, invocations.approval_id, invocations.tool_id, invocations.metadata,
            approvals.status AS approval_status, approvals.payload AS approval_payload,
            approvals.expires_at
     FROM agent_tool_invocations AS invocations
     JOIN approvals ON approvals.id = invocations.approval_id
     WHERE invocations.task_id = ? AND invocations.approval_id = ?
       AND invocations.decision = 'approved_live' AND invocations.status = 'allowed'
     ORDER BY invocations.resolved_at DESC, invocations.requested_at DESC`,
    [task.id, task.approval_id],
  );
  for (const candidate of candidates) {
    const metadata = fromJson(candidate.metadata, {});
    const approvalPayload = fromJson(candidate.approval_payload, {});
    const serializedState = metadata.sdkRunState;
    const stateHash = metadata.sdkRunStateHash;
    if (!serializedState || !stateHash || candidate.approval_status !== "approved") continue;
    if (candidate.expires_at && Date.parse(candidate.expires_at) <= Date.now()) continue;
    if (approvalPayload.taskId !== task.id || approvalPayload.invocationId !== candidate.id) continue;
    if (approvalPayload.metadata?.sdkRunStateHash !== stateHash) continue;
    const actualHash = crypto.createHash("sha256").update(serializedState).digest("hex");
    if (actualHash !== stateHash) continue;
    return {
      serializedState,
      callId: approvalPayload.exactScope?.callId || approvalPayload.metadata?.sdkInterruptionCallId || metadata.sdkInterruptionCallId || null,
      toolId: approvalPayload.exactScope?.toolId || candidate.tool_id || null,
      toolArguments: approvalPayload.exactScope?.toolArguments || {},
      effects: approvalPayload.exactScope?.effects || [],
      invocationId: candidate.id,
      approvalId: candidate.approval_id,
      stateHash,
    };
  }
  return null;
}

function getApprovedSdkResumeState(db, task) {
  return getApprovedSdkResumeSelection(db, task)?.serializedState || null;
}

function sdkPricingEstimate(model, usage, approvedCapCents, toolActivity) {
  return {
    ...estimateModelUsageAud(model, usage, { fallbackCents: approvedCapCents }),
    hostedToolCalls: toolActivity.length,
    hostedToolCostStatus: toolActivity.length ? "pending_provider_reconciliation" : "not_applicable",
    note: toolActivity.length
      ? "The token estimate is recorded now; hosted-tool charges remain pending until provider usage is reconciled."
      : "No hosted-tool charge applies to this run.",
  };
}

function persistGeneratedAssets(db, task, capabilityPlan, result) {
  const generated = extractGeneratedImages(result);
  if (!generated.length) return [];
  const imageSpec = capabilityPlan.specs.find((spec) => spec.sdkName === "image_generation");
  const format = imageSpec?.options?.outputFormat || "png";
  const extension = ["png", "jpeg", "webp"].includes(format) ? format : "png";
  const outputDir = path.join(CONFIG.artifactRoot, "workflows", safeId(task.workflow_id), "generated-assets");
  fs.mkdirSync(outputDir, { recursive: true });
  const ts = now();
  return generated.map((image, index) => {
    const deliverableId = `deliv_generated_${safeId(task.id)}_${index + 1}`;
    const outputPath = path.join(outputDir, `${deliverableId}.${extension}`);
    fs.writeFileSync(outputPath, image.bytes);
    const relativePath = path.relative(CONFIG.rootDir, outputPath).replace(/\\/g, "/");
    const humanName = `${task.payload?.subject || task.title || "Product"} Visual Asset ${index + 1}`;
    run(
      db,
      `INSERT INTO deliverables
       (id, workflow_id, command_id, task_id, title, human_name, audience, format, status, file_path, summary, metadata, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         human_name = excluded.human_name,
         status = excluded.status,
         file_path = excluded.file_path,
         summary = excluded.summary,
         metadata = excluded.metadata,
         updated_at = excluded.updated_at`,
      [
        deliverableId,
        task.workflow_id,
        task.payload?.commandId || null,
        task.id,
        "Generated Product Asset",
        humanName,
        "operator",
        `image/${extension === "jpeg" ? "jpeg" : extension}`,
        "ready_for_review",
        relativePath,
        "Capped AI-generated visual asset. Review brand fit, text accuracy, IP/platform risk, and product usefulness before any publishing.",
        toJson({
          provider: AGENTS_SDK_PROVIDER,
          model: imageSpec?.options?.model || "gpt-image-2",
          quality: imageSpec?.options?.quality || "low",
          size: imageSpec?.options?.size || "1024x1024",
          revisedPrompt: image.revisedPrompt,
          sha256: image.hash,
          bytes: image.bytes.length,
          approvalId: task.approval_id || task.payload?.liveSpendRequest?.approvalId || null,
        }),
        ts,
        ts,
      ],
    );
    return { id: deliverableId, humanName, filePath: relativePath, bytes: image.bytes.length, sha256: image.hash };
  });
}

function packageAvailable(name) {
  try {
    require.resolve(name);
    return true;
  } catch {
    return false;
  }
}

function isAgentRuntimeSdkAvailable() {
  return packageAvailable("@openai/agents")
    && packageAvailable("zod")
    && process.env.JARVIS_DISABLE_OPENAI_AGENTS_SDK !== "1"
    && process.env.JARVIS_DISABLE_LIVE_AI_WORKER_ADAPTER !== "1";
}

function getAgentRuntimeReadiness() {
  const sdkInstalled = packageAvailable("@openai/agents");
  const zodInstalled = packageAvailable("zod");
  const sdkDisabled = process.env.JARVIS_DISABLE_OPENAI_AGENTS_SDK === "1";
  const liveWorkerDisabled = process.env.JARVIS_DISABLE_LIVE_AI_WORKER_ADAPTER === "1";
  const sdkReady = sdkInstalled && zodInstalled && !sdkDisabled && !liveWorkerDisabled;
  const responsesFallbackReady = !liveWorkerDisabled;
  const blockers = [];
  if (!sdkInstalled) blockers.push("@openai/agents is not installed.");
  if (!zodInstalled) blockers.push("zod is not installed.");
  if (sdkDisabled) blockers.push("OpenAI Agents SDK runner is disabled by JARVIS_DISABLE_OPENAI_AGENTS_SDK.");
  if (liveWorkerDisabled) blockers.push("Live AI worker adapter is disabled by JARVIS_DISABLE_LIVE_AI_WORKER_ADAPTER.");

  return {
    primaryProvider: AGENTS_SDK_PROVIDER,
    primaryReady: sdkReady,
    sdkInstalled,
    zodInstalled,
    sdkDisabled,
    liveWorkerDisabled,
    fallbackProvider: LIVE_AI_WORKER_PROVIDER,
    fallbackReady: responsesFallbackReady,
    ready: sdkReady,
    blockers,
  };
}

function loadAgentsSdk() {
  const sdk = require("@openai/agents");
  const { z } = require("zod");
  return {
    Agent: sdk.Agent,
    Runner: sdk.Runner,
    RunState: sdk.RunState,
    generateTraceId: sdk.generateTraceId,
    imageGenerationTool: sdk.imageGenerationTool,
    webSearchTool: sdk.webSearchTool,
    z,
  };
}

function getDefaultSdkRunner(Runner) {
  if (!defaultSdkRunner) defaultSdkRunner = new Runner();
  return defaultSdkRunner;
}

function zodOutputSchema(z) {
  const continuousImprovement = z.object({
    hypothesis: z.string(),
    smallestUsefulAction: z.string(),
    expectedMetric: z.string(),
    actualResult: z.string(),
    learning: z.string(),
    improvement: z.string(),
  }).strict();

  const businessDecision = z.object({
    buyer: z.string(),
    problem: z.string(),
    offer: z.string(),
    channel: z.string(),
    moneyMove: z.string(),
    evidenceSummary: z.string(),
    risk: z.enum(["low", "medium", "high"]),
    nextAction: z.string(),
    successMetric: z.string(),
    killCriteria: z.string(),
    approvalRequired: z.boolean(),
    externalActionsAllowed: z.boolean(),
    hardStops: z.array(z.string()),
    continuousImprovement,
  }).strict();

  return z.object({
    heading: z.string(),
    summary: z.string(),
    moneyMove: z.string(),
    evidence: z.array(z.string()),
    counterevidence: z.array(z.string()),
    priceChannelHypothesis: z.string(),
    smallestTest: z.string(),
    metric: z.string(),
    killRule: z.string(),
    risks: z.array(z.string()),
    nextAction: z.string(),
    operatorDecision: z.enum(["approve", "revise", "deny", "needs_evidence"]),
    confidence: z.enum(["low", "medium", "high"]),
    expectedUpside: z.string(),
    costRisk: z.string(),
    assumptions: z.array(z.string()),
    businessDecision,
  }).strict();
}

function demandValidatorPilotOutputSchema(z) {
  return demandValidatorPilotSchema(z);
}

function sdkUsage(result) {
  const usage = result?.runContext?.usage || result?.state?._context?.usage || {};
  const rawResponses = Array.isArray(result?.rawResponses) ? result.rawResponses : [];
  const lastUsage = rawResponses.length ? rawResponses[rawResponses.length - 1]?.usage || {} : {};
  const inputDetails = usage.inputTokensDetails
    || lastUsage.inputTokensDetails
    || lastUsage.input_tokens_details
    || {};
  return {
    input_tokens: Number(usage.inputTokens ?? lastUsage.inputTokens ?? lastUsage.input_tokens ?? 0),
    output_tokens: Number(usage.outputTokens ?? lastUsage.outputTokens ?? lastUsage.output_tokens ?? 0),
    total_tokens: Number(usage.totalTokens ?? lastUsage.totalTokens ?? lastUsage.total_tokens ?? 0),
    cached_input_tokens: Number(inputDetails.cachedTokens ?? inputDetails.cached_tokens ?? 0),
  };
}

function sdkResponseId(result) {
  if (result?.lastResponseId) return result.lastResponseId;
  const rawResponses = Array.isArray(result?.rawResponses) ? result.rawResponses : [];
  return rawResponses.length ? rawResponses[rawResponses.length - 1]?.responseId || null : null;
}

function sdkOutputText(finalOutput) {
  if (typeof finalOutput === "string") return finalOutput;
  if (finalOutput && typeof finalOutput === "object") return JSON.stringify(finalOutput);
  return "";
}

function sdkInterruptionCallId(interruption) {
  const raw = typeof interruption?.toJSON === "function" ? interruption.toJSON() : interruption;
  return raw?.id || raw?.callId || raw?.rawItem?.call_id || raw?.rawItem?.id || null;
}

function approveSelectedSdkInterruption(state, callId) {
  if (!callId) throw new Error("A specific SDK interruption call ID is required to resume an approved tool call.");
  const interruptions = state.getInterruptions();
  const matching = interruptions.filter((interruption) => sdkInterruptionCallId(interruption) === callId);
  if (matching.length !== 1) {
    throw new Error(`Expected exactly one approved SDK interruption for call ${callId}; found ${matching.length}.`);
  }
  state.approve(matching[0]);
  return matching[0];
}

function approvedTracePolicy(task) {
  const policy = task.payload?.liveSpendRequest?.tracePolicy || {};
  return {
    providerResponseStored: policy.providerResponseStored === true,
    providerTraceContent: policy.providerTraceContent === true,
    localReviewStored: true,
    dataClass: String(policy.dataClass || "business_internal"),
    purpose: String(policy.purpose || "Keep a local operator and developer review record for this run."),
  };
}

function lifecycleToolName(tool) {
  return tool?.name || tool?.id || tool?.type || "approved tool";
}

function attachSdkLifecycleHooks(runner, task, callback) {
  if (!runner?.on || typeof callback !== "function") return () => {};
  const belongsToTask = (context) => !context?.context?.taskId || context.context.taskId === task.id;
  const emit = (context, event) => {
    if (!belongsToTask(context)) return;
    try {
      callback(event);
    } catch {
      // A dashboard trace failure must not turn a provider result into a paid retry.
    }
  };
  const listeners = [
    ["agent_start", (context, agent) => emit(context, {
      type: "sdk_agent_started",
      title: "OpenAI worker started",
      detail: `${agent?.name || "The approved worker"} started processing the supplied business context.`,
      metadata: { agentName: agent?.name || null },
    })],
    ["agent_end", (context, agent) => emit(context, {
      type: "sdk_agent_finished",
      title: "OpenAI worker finished",
      detail: `${agent?.name || "The approved worker"} finished its model work; Jarvis is checking and storing the result.`,
      metadata: { agentName: agent?.name || null },
    })],
    ["agent_handoff", (context, fromAgent, toAgent) => emit(context, {
      type: "sdk_agent_handoff",
      title: "Specialist handoff",
      detail: `${fromAgent?.name || "A worker"} handed the task to ${toAgent?.name || "another approved worker"}.`,
      metadata: { fromAgent: fromAgent?.name || null, toAgent: toAgent?.name || null },
    })],
    ["agent_tool_start", (context, agent, tool, details) => emit(context, {
      type: "sdk_tool_started",
      title: `${lifecycleToolName(tool)} started`,
      detail: `${agent?.name || "The approved worker"} started an approved ${lifecycleToolName(tool)} action.`,
      metadata: {
        agentName: agent?.name || null,
        toolName: lifecycleToolName(tool),
        callId: details?.toolCall?.callId || details?.toolCall?.id || null,
      },
    })],
    ["agent_tool_end", (context, agent, tool, result, details) => emit(context, {
      type: "sdk_tool_finished",
      title: `${lifecycleToolName(tool)} finished`,
      detail: `${agent?.name || "The approved worker"} finished the approved ${lifecycleToolName(tool)} action.`,
      metadata: {
        agentName: agent?.name || null,
        toolName: lifecycleToolName(tool),
        callId: details?.toolCall?.callId || details?.toolCall?.id || null,
        resultCharacters: typeof result === "string" ? result.length : null,
      },
    })],
  ];
  for (const [event, listener] of listeners) runner.on(event, listener);
  return () => {
    for (const [event, listener] of listeners) runner.off(event, listener);
  };
}

async function runSdkAgent(requestBody, task, agentDefinition, policy, options = {}) {
  const sdk = loadAgentsSdk();
  const { Agent, Runner, RunState, generateTraceId, z } = sdk;
  const traceId = options.traceId || generateTraceId();
  const tracePolicy = approvedTracePolicy(task);
  const capabilityPlan = options.capabilityPlan || buildAgentsSdkCapabilityPlan(task, agentDefinition);
  if (testSdkRunner) {
    let dispatchStarted = false;
    try {
      if (typeof options.beforeDispatch === "function") {
        options.beforeDispatch({ traceId, capabilityPlan });
      }
      dispatchStarted = true;
      const result = await testSdkRunner({ requestBody, task, agentDefinition, policy, options, traceId, tracePolicy, capabilityPlan });
      return { result, traceId };
    } catch (error) {
      error.agentSdkTraceId = traceId;
      if (error.providerCallOccurred === undefined) error.providerCallOccurred = dispatchStarted;
      if (error.outcomeUnknown === undefined) error.outcomeUnknown = dispatchStarted;
      if (!error.providerDispatchStatus) error.providerDispatchStatus = dispatchStarted ? "outcome_unknown" : "not_dispatched";
      throw error;
    }
  }

  const sdkTools = materializeAgentsSdkTools(sdk, capabilityPlan);
  const agent = new Agent({
    name: agentDefinition.name,
    instructions: requestBody.input[0].content,
    model: requestBody.model,
    outputType: task.payload?.pilotFixture
      ? demandValidatorPilotOutputSchema(z)
      : workerOutputZodSchema(z, agentDefinition.id),
    tools: sdkTools,
    handoffs: [],
    modelSettings: {
      maxTokens: Math.min(4000, Number(requestBody.max_output_tokens || 1200)),
      toolChoice: capabilityPlan.toolChoice,
      parallelToolCalls: capabilityPlan.parallelToolCalls,
      store: tracePolicy.providerResponseStored,
      providerData: {
        max_tool_calls: capabilityPlan.maxToolCalls || undefined,
        include: capabilityPlan.specs.some((spec) => spec.sdkName === "web_search")
          ? ["web_search_call.action.sources"]
          : undefined,
        safety_identifier: stableSafetyIdentifier(task),
        prompt_cache_key: `jarvis_${agentDefinition.id}_${requestBody.metadata.packet_schema}`,
      },
    },
  });
  const runner = options.runner || getDefaultSdkRunner(Runner);
  let sdkInput = options.modelInput || requestBody.input[1].content;
  if (options.resumeState) {
    try {
      const state = await RunState.fromString(agent, options.resumeState);
      if (typeof state.clearTrace === "function") state.clearTrace();
      approveSelectedSdkInterruption(state, options.resumeInterruptionCallId);
      sdkInput = state;
    } catch (error) {
      error.agentSdkTraceId = traceId;
      error.providerCallOccurred = false;
      error.outcomeUnknown = false;
      error.providerDispatchStatus = "not_dispatched";
      throw error;
    }
  }
  const signal = options.signal || (typeof AbortSignal?.timeout === "function" ? AbortSignal.timeout(capabilityPlan.deadlineMs) : undefined);
  const detachLifecycleHooks = attachSdkLifecycleHooks(runner, task, options.onLifecycleEvent);
  let dispatchStarted = false;
  try {
    if (typeof options.beforeDispatch === "function") {
      options.beforeDispatch({ traceId, capabilityPlan });
    }
    dispatchStarted = true;
    const result = await runner.run(agent, sdkInput, {
      maxTurns: capabilityPlan.maxTurns,
      traceId,
      workflowName: `Jarvis ${agentDefinition.name} controlled run`,
      traceIncludeSensitiveData: tracePolicy.providerTraceContent,
      signal,
      traceMetadata: {
        venture_id: String(task.venture_id || ""),
        workflow_id: String(task.workflow_id || ""),
        task_id: String(task.id || ""),
        fixture_hash: String(task.payload?.liveSpendRequest?.fixtureHash || ""),
        provider_response_stored: String(tracePolicy.providerResponseStored),
        provider_trace_content: String(tracePolicy.providerTraceContent),
        data_class: tracePolicy.dataClass,
      },
      context: {
        workflowId: task.workflow_id,
        taskId: task.id,
        agentId: agentDefinition.id,
        provider: AGENTS_SDK_PROVIDER,
        externalActionsAllowed: false,
        approvedSdkTools: capabilityPlan.requestedTools,
      },
    });
    return { result, traceId };
  } catch (error) {
    error.agentSdkTraceId = traceId;
    if (error.providerCallOccurred === undefined) error.providerCallOccurred = dispatchStarted;
    if (error.outcomeUnknown === undefined) error.outcomeUnknown = dispatchStarted;
    if (!error.providerDispatchStatus) error.providerDispatchStatus = dispatchStarted ? "outcome_unknown" : "not_dispatched";
    throw error;
  } finally {
    detachLifecycleHooks();
  }
}

async function runAgentsSdkWorkerTask(db, task, agentDefinition, policy, options = {}) {
  if (process.env.JARVIS_ENABLE_LIVE_MODELS !== "1") {
    throw new Error("JARVIS_ENABLE_LIVE_MODELS must be set to 1 for live AI worker execution.");
  }
  if (!isAgentRuntimeSdkAvailable()) {
    throw new Error(`OpenAI Agents SDK runner is not ready: ${getAgentRuntimeReadiness().blockers.join(" ")}`);
  }

  const requestBody = buildOpenAIRequest(db, task, agentDefinition, policy);
  const approvedCapCents = liveWorkerCostEstimateCents(task);
  const tracePolicy = approvedTracePolicy(task);
  const capabilityPlan = buildAgentsSdkCapabilityPlan(task, agentDefinition);
  const modelInput = buildAgentsSdkModelInput(db, task, requestBody.input[1].content, capabilityPlan);
  const inputAssets = modelInput.assets;
  const resumeSelection = getApprovedSdkResumeSelection(db, task);
  const resumeState = resumeSelection?.serializedState || null;
  const toolInvocations = capabilityPlan.specs.map((spec) => ({
    spec,
    gate: requestAgentToolUse(db, {
      agentId: agentDefinition.id,
      agentName: agentDefinition.name,
      runId: options.agentRunId || null,
      task,
      toolId: spec.toolId,
      mode: "live",
      approvalId: task.approval_id || task.payload?.liveSpendRequest?.approvalId || null,
      reason: `Use the exact approved ${spec.sdkName} capability inside this capped Agents SDK run.`,
      toolArguments: resumeSelection?.toolId === spec.toolId
        ? resumeSelection.toolArguments
        : task.payload?.liveSpendRequest?.toolArguments?.[spec.toolId] || task.payload?.liveSpendRequest?.toolArguments || {},
      effects: resumeSelection?.toolId === spec.toolId
        ? resumeSelection.effects
        : task.payload?.liveSpendRequest?.effects || [],
      callId: resumeSelection?.toolId === spec.toolId ? resumeSelection.callId : null,
      resumeStateHash: resumeSelection?.toolId === spec.toolId ? resumeSelection.stateHash : null,
    }),
  }));
  const blockedTool = toolInvocations.find((item) => !item.gate.allowed);
  if (blockedTool) {
    throw new Error(`${blockedTool.spec.toolId} did not pass the Jarvis worker tool gate: ${blockedTool.gate.reason || blockedTool.gate.decision || "blocked"}.`);
  }
  let dispatchCall = null;
  let result;
  let traceId = null;
  try {
    const sdkRun = await runSdkAgent(requestBody, task, agentDefinition, policy, {
      ...options,
      capabilityPlan,
      resumeState,
      resumeInterruptionCallId: resumeSelection?.callId || null,
      modelInput: modelInput.input,
      inputAssets,
      beforeDispatch: ({ traceId: assignedTraceId }) => {
        dispatchCall = recordLiveWorkerModelCall(db, task, null, approvedCapCents, requestBody.model, "dispatching", {
          reservedCostCents: approvedCapCents,
          provider: AGENTS_SDK_PROVIDER,
          sdkRunner: true,
          agentRunId: options.agentRunId || null,
          taskAttemptId: options.taskClaim?.attemptId || null,
          dispatchIntent: { status: "dispatched", recordedAt: now(), deadlineMs: capabilityPlan.deadlineMs },
          agentSdkTraceId: assignedTraceId,
          tracePolicy,
          capabilityPlan,
          inputAssets,
        });
        if (options.taskClaim) {
          markTaskAttemptProviderDispatched(db, options.taskClaim, {
            modelCallId: dispatchCall.id,
            provider: AGENTS_SDK_PROVIDER,
            model: requestBody.model,
            traceId: assignedTraceId,
          });
        }
        if (typeof options.onLifecycleEvent === "function") {
          options.onLifecycleEvent({
            type: "provider_dispatch",
            title: "Contacting OpenAI",
            detail: `${agentDefinition.name} sent the approved, capped request to OpenAI.`,
            metadata: {
              modelCallId: dispatchCall.id,
              provider: AGENTS_SDK_PROVIDER,
              model: requestBody.model,
              traceId: assignedTraceId,
            },
          });
        }
      },
    });
    result = sdkRun.result;
    traceId = sdkRun.traceId;
  } catch (error) {
    const dispatched = Boolean(dispatchCall);
    if (error.outcomeUnknown === undefined) error.outcomeUnknown = dispatched && error.providerCallOccurred !== false;
    if (error.providerCallOccurred === undefined) error.providerCallOccurred = dispatched;
    if (!error.providerDispatchStatus) error.providerDispatchStatus = error.outcomeUnknown ? "outcome_unknown" : "not_dispatched";
    traceId = error.agentSdkTraceId || null;
    error.agentRunId = options.agentRunId || null;
    recordLiveWorkerFailureCost(db, task, error);
    const failedCall = recordLiveWorkerModelCall(db, task, null, approvedCapCents, requestBody.model, "failed", {
      modelCallId: dispatchCall?.id,
      provider: AGENTS_SDK_PROVIDER,
      sdkRunner: true,
      agentRunId: options.agentRunId || null,
      taskAttemptId: options.taskClaim?.attemptId || null,
      agentSdkTraceId: traceId,
      error: error.message,
      outcomeUnknown: error.outcomeUnknown === true,
      errorKind: error.outcomeUnknown === true ? "provider_outcome_unknown" : "failed_before_provider_dispatch",
      providerDispatchStatus: error.providerDispatchStatus,
      tracePolicy,
      inputAssets,
    });
    error.modelCallId = failedCall.id;
    error.providerReceipt = {
      modelCallId: failedCall.id,
      providerRequestId: null,
      provider: AGENTS_SDK_PROVIDER,
      status: error.providerDispatchStatus,
      traceId,
      deadlineMs: capabilityPlan.deadlineMs,
    };
    error.incurredEstimateCents = 0;
    insertEvent(db, {
      level: "error",
      actor: "agent-runtime",
      type: "live_ai_worker.failed",
      entityType: "task",
      entityId: task.id,
      message: `Agents SDK worker failed before usable output was captured: ${error.message}`,
      metadata: {
        workflowId: task.workflow_id,
        taskId: task.id,
        modelCallId: failedCall.id,
        provider: AGENTS_SDK_PROVIDER,
        agentSdkTraceId: traceId,
        outcomeUnknown: error.outcomeUnknown === true,
        providerDispatchStatus: error.providerDispatchStatus,
      },
    });
    throw error;
  }

  const toolActivity = extractAgentsSdkToolActivity(result);
  const responseId = sdkResponseId(result) || `agents_sdk_${randomId()}`;
  const usage = sdkUsage(result);
  const pricingEstimate = sdkPricingEstimate(requestBody.model, usage, approvedCapCents, toolActivity);
  const estimateCents = pricingEstimate.amountCents;
  const providerCall = recordLiveWorkerModelCall(db, task, { id: responseId, usage, output: [] }, estimateCents, requestBody.model, "provider_completed", {
    modelCallId: dispatchCall.id,
    provider: AGENTS_SDK_PROVIDER,
    sdkRunner: true,
    agentRunId: options.agentRunId || null,
    taskAttemptId: options.taskClaim?.attemptId || null,
    agentSdkTraceId: traceId,
    rawResponseCount: Array.isArray(result.rawResponses) ? result.rawResponses.length : 0,
    reservedCostCents: approvedCapCents,
    pricingEstimate,
    tracePolicy,
    capabilityPlan,
    toolActivity,
    inputAssets,
    providerReceiptRecordedAt: now(),
  });
  recordLiveWorkerCost(db, task, estimateCents, { id: responseId }, {
    provider: AGENTS_SDK_PROVIDER,
    model: requestBody.model,
    modelCallId: providerCall.id,
    agentRunId: options.agentRunId || null,
    taskAttemptId: options.taskClaim?.attemptId || null,
    sdkRunner: true,
    agentSdkTraceId: traceId,
    approvedCapCents,
    pricingEstimate,
    tracePolicy,
    capabilityPlan,
    toolActivity,
    inputAssets,
  });
  const providerReceipt = {
    modelCallId: providerCall.id,
    providerRequestId: responseId,
    provider: AGENTS_SDK_PROVIDER,
    status: "completed",
    traceId,
    incurredEstimateCents: estimateCents,
    deadlineMs: capabilityPlan.deadlineMs,
  };
  const sdkResearch = persistAgentsSdkResearchEvidence(db, {
    task,
    runId: options.agentRunId,
    attemptId: options.taskClaim?.attemptId || null,
    modelCallId: providerCall.id,
    responseId,
    traceId,
    toolActivity,
  });
  try {
  const interruptions = sdkInterruptionDetails(result);
  if (interruptions.length) {
    const interruption = interruptions[0];
    const interruptedSpec = capabilityPlan.specs.find((spec) => [spec.sdkName, spec.toolId].includes(interruption.toolName));
    const toolId = interruptedSpec?.toolId || interruption.toolName;
    if (!toolId || !interruption.serializedRunState) {
      const error = new Error("The Agents SDK paused, but its tool identity or resumable state was missing.");
      error.agentSdkTraceId = traceId;
      error.outcomeUnknown = false;
      throw error;
    }
    const pausedCall = recordLiveWorkerModelCall(db, task, { id: responseId, usage, output: [] }, estimateCents, requestBody.model, "waiting_approval", {
      modelCallId: providerCall.id,
      provider: AGENTS_SDK_PROVIDER,
      sdkRunner: true,
      agentSdkTraceId: traceId,
      rawResponseCount: Array.isArray(result.rawResponses) ? result.rawResponses.length : 0,
      interruptionCount: interruptions.length,
      reservedCostCents: approvedCapCents,
      pricingEstimate,
      tracePolicy,
      capabilityPlan,
      toolActivity,
      sdkResearch,
      inputAssets,
      outcomeUnknown: false,
    });
    const sdkRunStateHash = crypto.createHash("sha256").update(interruption.serializedRunState).digest("hex");
    const gate = requestAgentToolUse(db, {
      agentId: agentDefinition.id,
      agentName: agentDefinition.name,
      runId: options.agentRunId || null,
      task,
      toolId,
      mode: "live",
      ignoreTaskApproval: true,
      reason: `Approve or reject the exact paused ${interruption.toolName || toolId} call before the same Agents SDK run resumes.`,
      inputSummary: `${interruption.toolName || toolId} call ${interruption.callId || "without an id"}: ${String(interruption.arguments || "No arguments captured.").slice(0, 500)}`,
      toolArguments: interruption.arguments || {},
      effects: [],
      callId: interruption.callId || null,
      resumeStateHash: sdkRunStateHash,
      metadata: {
        sdkRunState: interruption.serializedRunState,
        sdkRunStateHash,
        sdkInterruptionCallId: interruption.callId,
        sdkInterruptionArguments: interruption.arguments,
        parentApprovalId: task.approval_id || task.payload?.liveSpendRequest?.approvalId || null,
        partialModelCallId: pausedCall.id,
        providerResponseId: responseId,
        agentSdkTraceId: traceId,
      },
    });
    if (!gate.approvalRequired) {
      const error = new Error(`The paused SDK tool ${toolId} did not produce a Jarvis approval interruption.`);
      error.agentSdkTraceId = traceId;
      error.outcomeUnknown = false;
      throw error;
    }
    insertEvent(db, {
      level: "warn",
      actor: "agent-runtime",
      type: "live_ai_worker.paused_for_tool_approval",
      entityType: "task",
      entityId: task.id,
      message: `${agentDefinition.name} paused before ${toolId}; the same SDK run is stored for an operator decision.`,
      metadata: { approvalId: gate.approvalId, invocationId: gate.id, toolId, responseId, traceId, sdkRunStateHash, incurredEstimateCents: estimateCents },
    });
    const error = new AgentToolApprovalRequiredError(gate, {
      agentId: agentDefinition.id,
      runId: options.agentRunId || null,
      task,
      toolId,
      providerCallOccurred: true,
      incurredEstimateCents: estimateCents,
      providerRequestId: responseId,
      agentSdkTraceId: traceId,
    });
    error.outcomeUnknown = false;
    error.modelCallId = pausedCall.id;
    throw error;
  }

  const generatedAssets = persistGeneratedAssets(db, task, capabilityPlan, result);
  for (const invocation of toolInvocations) {
    const observed = invocation.spec.kind === "model_input"
      ? { type: invocation.spec.sdkName, status: "completed", assets: inputAssets }
      : toolActivity.find((item) => item.type === invocation.spec.sdkName);
    recordAgentToolObservation(db, invocation.gate.id, {
      status: observed?.status === "failed" ? "failed" : "completed",
      toolName: invocation.spec.sdkName,
      toolId: invocation.spec.toolId,
      activity: observed || null,
      limits: {
        maxToolCalls: capabilityPlan.maxToolCalls,
        deadlineMs: capabilityPlan.deadlineMs,
        approvedCostCapCents: capabilityPlan.approvedCostCapCents,
      },
      outputSummary: observed
        ? invocation.spec.kind === "model_input"
          ? `${inputAssets.length} exact approved visual asset${inputAssets.length === 1 ? " was" : "s were"} supplied for model review; hashes and limits were recorded locally.`
          : `${invocation.spec.sdkName} completed; provider activity and provenance were recorded for review.`
        : `${invocation.spec.sdkName} was approved but no matching provider tool-call item was returned. Review the trace before accepting the run.`,
    });
  }

  const rawText = sdkOutputText(result.finalOutput);
  if (!result.finalOutput || typeof result.finalOutput !== "object" || Array.isArray(result.finalOutput)) {
    const error = new Error("The Agents SDK worker returned output that did not match the required structured format.");
    error.errorKind = "malformed_structured_output";
    throw error;
  }
  const roleOutput = normalizeWorkerOutput(
    agentDefinition.id,
    typeof result.finalOutput === "object" ? result.finalOutput : null,
    agentDefinition.name,
  );
  const output = normalizeOutput(roleOutput, rawText);
  output.roleOutput = roleOutput?.roleOutput || null;
  const responseLike = {
    id: responseId,
    usage,
    output: [],
  };
  const modelCall = recordLiveWorkerModelCall(db, task, responseLike, estimateCents, requestBody.model, "completed", {
    modelCallId: providerCall.id,
    provider: AGENTS_SDK_PROVIDER,
    sdkRunner: true,
    agentSdkTraceId: traceId,
    rawResponseCount: Array.isArray(result.rawResponses) ? result.rawResponses.length : 0,
    interruptionCount: interruptions.length,
    finalAgent: result.lastAgent?.name || agentDefinition.name,
    reservedCostCents: approvedCapCents,
    pricingEstimate,
    tracePolicy,
    capabilityPlan,
    toolActivity,
    inputAssets,
    generatedAssets,
    sdkResearch,
    reason: capabilityPlan.requestedTools.length
      ? "Live AI worker used only the exact approved SDK capability; no publishing, contact, account action, legal decision, or money movement was exposed."
      : "Live AI worker used the OpenAI Agents SDK runner after approval; no external tools or side effects were exposed.",
  });

  insertEvent(db, {
    actor: "agent-runtime",
    type: "live_ai_worker.completed",
    entityType: "task",
    entityId: task.id,
    message: `Agents SDK worker completed ${task.title} with a capped model call.`,
    metadata: {
      workflowId: task.workflow_id,
      taskId: task.id,
      modelCallId: modelCall.id,
      estimatedCostCents: estimateCents,
      approvedCapCents,
      responseId,
      agentSdkTraceId: traceId,
      provider: AGENTS_SDK_PROVIDER,
      tracePolicy,
      capabilityPlan,
      toolActivity,
      sdkResearch,
      inputAssets,
      generatedAssets,
    },
  });

  return {
    id: responseId,
    mode: AGENTS_SDK_PROVIDER,
    provider: AGENTS_SDK_PROVIDER,
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
        "The approved Agents SDK worker returned a structured specialist recommendation.",
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
      liveEvidence: toolActivity.some((item) => item.type === "web_search" && item.sources?.length),
      modelGenerated: true,
      operatorDecision: output.operatorDecision,
      businessDecision: output.businessDecision,
      roleOutput: output.roleOutput,
      toolActivity,
      sdkResearch,
      inputAssets,
      generatedAssets,
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
        sources: toolActivity.flatMap((item) => item.sources || []),
      },
    },
    raw: {
      responseId,
      traceId,
      sdkRunner: true,
      provider: AGENTS_SDK_PROVIDER,
      structuredOutput: Boolean(result.finalOutput && typeof result.finalOutput === "object"),
      rawResponseCount: Array.isArray(result.rawResponses) ? result.rawResponses.length : 0,
      interruptions: Array.isArray(result.interruptions) ? result.interruptions.length : 0,
      usage,
      pricingEstimate,
      tracePolicy,
      capabilityPlan,
      toolActivity,
      sdkResearch,
      inputAssets,
      generatedAssets,
      toolInvocations: toolInvocations.map((item) => ({ id: item.gate.id, toolId: item.spec.toolId, sdkName: item.spec.sdkName })),
    },
  };
  } catch (error) {
    error.providerCallOccurred = true;
    error.incurredEstimateCents = Number(error.incurredEstimateCents || estimateCents);
    error.providerRequestId = error.providerRequestId || responseId;
    error.modelCallId = error.modelCallId || providerCall.id;
    error.agentSdkTraceId = error.agentSdkTraceId || traceId;
    error.providerReceipt = error.providerReceipt || providerReceipt;
    if (!error.agentToolApprovalRequired) {
      error.outcomeUnknown = false;
      error.needsAttention = true;
      error.providerDispatchStatus = "completed";
      error.errorKind = error.errorKind || "local_processing_after_provider_success";
      recordLiveWorkerModelCall(db, task, { id: responseId, usage, output: [] }, estimateCents, requestBody.model, "needs_attention", {
        modelCallId: providerCall.id,
        provider: AGENTS_SDK_PROVIDER,
        sdkRunner: true,
        agentSdkTraceId: traceId,
        error: error.message,
        errorKind: error.errorKind,
        providerReceipt,
        pricingEstimate,
        tracePolicy,
        capabilityPlan,
        toolActivity,
        inputAssets,
      });
      insertEvent(db, {
        level: "error",
        actor: "agent-runtime",
        type: "live_ai_worker.local_processing_needs_attention",
        entityType: "task",
        entityId: task.id,
        message: "The provider call completed, but Jarvis could not finish local processing. The receipt and incurred estimate were retained.",
        metadata: { ...providerReceipt, error: error.message },
      });
    }
    throw error;
  }
}

async function runAgentRuntimeTask(db, task, agentDefinition, policy, options = {}) {
  const approvedProvider = task.payload?.liveSpendRequest?.provider || null;
  const provider = options.provider || approvedProvider || process.env.JARVIS_AGENT_RUNTIME_PROVIDER || CONFIG.liveModelProvider || AGENTS_SDK_PROVIDER;
  if (approvedProvider && options.provider && options.provider !== approvedProvider) {
    throw new Error(`The requested runtime provider does not match the approved provider ${approvedProvider}.`);
  }
  if (provider === LIVE_AI_WORKER_PROVIDER || provider === "responses") {
    const result = await runLiveAiWorkerTask(db, task, agentDefinition, policy, options);
    return {
      ...result,
      runtimeProvider: LIVE_AI_WORKER_PROVIDER,
      primaryProvider: AGENTS_SDK_PROVIDER,
    };
  }
  if (provider === AGENTS_SDK_PROVIDER) {
    return runAgentsSdkWorkerTask(db, task, agentDefinition, policy, options);
  }
  throw new Error(`Unsupported agent runtime provider: ${provider}.`);
}

function __setAgentRuntimeSdkRunnerForTests(runner) {
  testSdkRunner = runner;
}

module.exports = {
  AGENTS_SDK_PROVIDER,
  __setAgentRuntimeSdkRunnerForTests,
  approveSelectedSdkInterruption,
  demandValidatorPilotOutputSchema,
  getApprovedSdkResumeState,
  getApprovedSdkResumeSelection,
  getAgentRuntimeReadiness,
  isAgentRuntimeSdkAvailable,
  runAgentRuntimeTask,
  runAgentsSdkWorkerTask,
  zodOutputSchema,
};
