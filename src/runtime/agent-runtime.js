const CONFIG = require("../config");
const { insertEvent, now, randomId } = require("../db");
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

const AGENTS_SDK_PROVIDER = "openai-agents-sdk";

let testSdkRunner = null;

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
  return { Agent: sdk.Agent, Runner: sdk.Runner, z };
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

function sdkUsage(result) {
  const usage = result?.runContext?.usage || result?.state?._context?.usage || {};
  const rawResponses = Array.isArray(result?.rawResponses) ? result.rawResponses : [];
  const lastUsage = rawResponses.length ? rawResponses[rawResponses.length - 1]?.usage || {} : {};
  return {
    input_tokens: Number(usage.inputTokens ?? lastUsage.inputTokens ?? lastUsage.input_tokens ?? 0),
    output_tokens: Number(usage.outputTokens ?? lastUsage.outputTokens ?? lastUsage.output_tokens ?? 0),
    total_tokens: Number(usage.totalTokens ?? lastUsage.totalTokens ?? lastUsage.total_tokens ?? 0),
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

async function runSdkAgent(requestBody, task, agentDefinition, policy, options = {}) {
  if (testSdkRunner) {
    return testSdkRunner({ requestBody, task, agentDefinition, policy, options });
  }

  const { Agent, Runner, z } = loadAgentsSdk();
  const agent = new Agent({
    name: agentDefinition.name,
    instructions: requestBody.input[0].content,
    model: requestBody.model,
    outputType: zodOutputSchema(z),
    tools: [],
    handoffs: [],
    modelSettings: { maxTokens: Math.min(1200, Number(requestBody.max_output_tokens || 1200)) },
  });
  const runner = options.runner || new Runner();
  return runner.run(agent, requestBody.input[1].content, {
    maxTurns: 1,
    workflowName: "Jarvis Demand Validator controlled proof",
    traceIncludeSensitiveData: false,
    traceMetadata: {
      venture_id: String(task.venture_id || ""),
      workflow_id: String(task.workflow_id || ""),
      task_id: String(task.id || ""),
      fixture_hash: String(task.payload?.liveSpendRequest?.fixtureHash || ""),
    },
    context: {
      workflowId: task.workflow_id,
      taskId: task.id,
      agentId: agentDefinition.id,
      provider: AGENTS_SDK_PROVIDER,
      externalActionsAllowed: false,
    },
  });
}

async function runAgentsSdkWorkerTask(db, task, agentDefinition, policy, options = {}) {
  if (process.env.JARVIS_ENABLE_LIVE_MODELS !== "1") {
    throw new Error("JARVIS_ENABLE_LIVE_MODELS must be set to 1 for live AI worker execution.");
  }
  if (!isAgentRuntimeSdkAvailable()) {
    throw new Error(`OpenAI Agents SDK runner is not ready: ${getAgentRuntimeReadiness().blockers.join(" ")}`);
  }

  const requestBody = buildOpenAIRequest(db, task, agentDefinition, policy);
  const estimateCents = liveWorkerCostEstimateCents(task);
  let result;
  try {
    result = await runSdkAgent(requestBody, task, agentDefinition, policy, options);
  } catch (error) {
    error.outcomeUnknown = true;
    recordLiveWorkerFailureCost(db, task, error);
    const failedCall = recordLiveWorkerModelCall(db, task, null, estimateCents, requestBody.model, "failed", {
      provider: AGENTS_SDK_PROVIDER,
      sdkRunner: true,
      error: error.message,
      outcomeUnknown: true,
    });
    insertEvent(db, {
      level: "error",
      actor: "agent-runtime",
      type: "live_ai_worker.failed",
      entityType: "task",
      entityId: task.id,
      message: `Agents SDK worker failed before usable output was captured: ${error.message}`,
      metadata: { workflowId: task.workflow_id, taskId: task.id, modelCallId: failedCall.id, provider: AGENTS_SDK_PROVIDER, outcomeUnknown: true },
    });
    throw error;
  }

  const responseId = sdkResponseId(result) || `agents_sdk_${randomId()}`;
  const rawText = sdkOutputText(result.finalOutput);
  const output = normalizeOutput(typeof result.finalOutput === "object" ? result.finalOutput : null, rawText);
  const usage = sdkUsage(result);
  const responseLike = {
    id: responseId,
    usage,
    output: [],
  };
  const modelCall = recordLiveWorkerModelCall(db, task, responseLike, estimateCents, requestBody.model, "completed", {
    provider: AGENTS_SDK_PROVIDER,
    sdkRunner: true,
    rawResponseCount: Array.isArray(result.rawResponses) ? result.rawResponses.length : 0,
    interruptionCount: Array.isArray(result.interruptions) ? result.interruptions.length : 0,
    finalAgent: result.lastAgent?.name || agentDefinition.name,
    reason: "Live AI worker used the OpenAI Agents SDK runner after approval; no external tools or side effects were exposed.",
  });
  recordLiveWorkerCost(db, task, estimateCents, { id: responseId }, {
    provider: AGENTS_SDK_PROVIDER,
    model: requestBody.model,
    modelCallId: modelCall.id,
    sdkRunner: true,
    rawResponseCount: Array.isArray(result.rawResponses) ? result.rawResponses.length : 0,
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
      responseId,
      provider: AGENTS_SDK_PROVIDER,
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
    output: {
      heading: output.heading,
      summary: output.summary,
      evidence: [
        `Agents SDK run ${responseId} returned a structured specialist-worker result.`,
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
      responseId,
      sdkRunner: true,
      provider: AGENTS_SDK_PROVIDER,
      structuredOutput: Boolean(result.finalOutput && typeof result.finalOutput === "object"),
      rawResponseCount: Array.isArray(result.rawResponses) ? result.rawResponses.length : 0,
      interruptions: Array.isArray(result.interruptions) ? result.interruptions.length : 0,
      usage,
    },
  };
}

async function runAgentRuntimeTask(db, task, agentDefinition, policy, options = {}) {
  const provider = options.provider || process.env.JARVIS_AGENT_RUNTIME_PROVIDER || CONFIG.liveModelProvider || AGENTS_SDK_PROVIDER;
  if (provider === LIVE_AI_WORKER_PROVIDER || provider === "responses") {
    const result = await runLiveAiWorkerTask(db, task, agentDefinition, policy, options);
    return {
      ...result,
      runtimeProvider: LIVE_AI_WORKER_PROVIDER,
      primaryProvider: AGENTS_SDK_PROVIDER,
    };
  }
  return runAgentsSdkWorkerTask(db, task, agentDefinition, policy, options);
}

function __setAgentRuntimeSdkRunnerForTests(runner) {
  testSdkRunner = runner;
}

module.exports = {
  AGENTS_SDK_PROVIDER,
  __setAgentRuntimeSdkRunnerForTests,
  getAgentRuntimeReadiness,
  isAgentRuntimeSdkAvailable,
  runAgentRuntimeTask,
  runAgentsSdkWorkerTask,
  zodOutputSchema,
};
