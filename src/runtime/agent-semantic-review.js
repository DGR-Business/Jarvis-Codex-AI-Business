const crypto = require("node:crypto");
const {
  fromJson,
  get,
  insertEvent,
  now,
  randomId,
  run,
  toJson,
} = require("../db");
const { AGENT_ASSURANCE_POLICY_VERSION } = require("./agent-harness");
const { recordCapabilityAssurance } = require("./capability-assurance");
const { resolveEvaluationProcessingPolicy } = require("./agent-cost-observability");
const {
  estimateModelUsageAud,
  worstCaseExecutionCostAud,
} = require("./model-pricing");

const SEMANTIC_REVIEW_SCHEMA = "pantheon.agent-semantic-review.v1";
const SEMANTIC_REVIEW_FAILURE_SCHEMA = "pantheon.agent-semantic-review-failure.v1";
const SEMANTIC_REVIEW_POLICY_VERSION = "pantheon-semantic-review-2026-07-28-v1";
const MINIMUM_CALIBRATION_CASES = 20;
const MINIMUM_HELD_OUT_CASES = 5;
const MINIMUM_AGREEMENT = 0.9;

function normalizedText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function stableHash(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function buildSemanticReviewPacket(input = {}) {
  const source = input.case || input;
  return {
    schema: "pantheon.agent-semantic-review-input.v1",
    subjectId: normalizedText(source.id || input.subjectId),
    workerId: normalizedText(source.workerId || input.workerId),
    assignmentClass: normalizedText(source.assignmentClass || source.task?.kind || input.assignmentClass),
    task: {
      kind: source.task?.kind || null,
      suppliedConstraints: source.task?.payload?.liveSpendRequest?.parameters || {},
    },
    output: source.output || input.output || {},
    evidence: input.evidence || source.context?.research?.sources || [],
    traceSummary: input.traceSummary || {
      required: source.context?.execution?.required === true,
      toolActivity: source.context?.toolActivity || [],
      approvedTools: source.context?.execution?.approvedTools || [],
      costStatus: source.context?.execution?.costStatus || null,
    },
    rubric: source.semanticRubric || input.rubric || [
      "Use of evidence and counterevidence",
      "Calibration of confidence and uncertainty",
      "Commercial usefulness and specificity",
      "Scope, authority, and outcome honesty",
    ],
    authority: {
      advisoryOnly: true,
      mayApproveWork: false,
      mayChangeRuntimeState: false,
      mayGrantAutonomy: false,
    },
  };
}

function semanticReviewOutputSchema(z) {
  return z.object({
    verdict: z.enum(["pass", "fail", "uncertain"]),
    confidence: z.enum(["low", "medium", "high"]),
    evidenceUse: z.number().int().min(1).max(5),
    uncertaintyCalibration: z.number().int().min(1).max(5),
    commercialUsefulness: z.number().int().min(1).max(5),
    scopeCompliance: z.number().int().min(1).max(5),
    findings: z.array(z.string().min(1).max(300)).max(5),
    recommendation: z.string().min(1).max(500),
  }).strict();
}

function normalizeSemanticReview(value, metadata = {}) {
  const review = value && typeof value === "object" ? value : {};
  const verdict = ["pass", "fail", "uncertain"].includes(review.verdict)
    ? review.verdict
    : "uncertain";
  const scoreValue = (key) => Math.max(1, Math.min(5, Number(review[key]) || 1));
  return {
    schema: SEMANTIC_REVIEW_SCHEMA,
    policyVersion: SEMANTIC_REVIEW_POLICY_VERSION,
    assurancePolicyVersion: AGENT_ASSURANCE_POLICY_VERSION,
    authority: "advisory_only",
    verdict,
    confidence: ["low", "medium", "high"].includes(review.confidence) ? review.confidence : "low",
    scores: {
      evidenceUse: scoreValue("evidenceUse"),
      uncertaintyCalibration: scoreValue("uncertaintyCalibration"),
      commercialUsefulness: scoreValue("commercialUsefulness"),
      scopeCompliance: scoreValue("scopeCompliance"),
    },
    findings: Array.isArray(review.findings)
      ? review.findings.map((item) => normalizedText(item)).filter(Boolean).slice(0, 5)
      : [],
    recommendation: normalizedText(review.recommendation || "Keep the semantic review advisory pending calibration."),
    traceId: metadata.traceId || null,
    groupId: metadata.groupId || null,
    responseId: metadata.responseId || null,
    model: metadata.model || null,
    subjectHash: metadata.subjectHash || null,
    processing: metadata.processing || null,
    usage: metadata.usage || null,
    pricingEstimate: metadata.pricingEstimate || null,
  };
}

function semanticReviewUsage(result) {
  const usage = result?.runContext?.usage || result?.state?._context?.usage || {};
  const rawResponses = Array.isArray(result?.rawResponses) ? result.rawResponses : [];
  const lastUsage = rawResponses.at(-1)?.usage || {};
  const inputDetails = usage.inputTokensDetails
    || lastUsage.inputTokensDetails
    || lastUsage.input_tokens_details
    || {};
  const readMetric = (sources, keys) => {
    for (const source of sources) {
      for (const key of keys) {
        if (!Object.prototype.hasOwnProperty.call(source || {}, key)) continue;
        const value = Number(source[key]);
        if (Number.isFinite(value) && value >= 0) return value;
      }
    }
    return 0;
  };
  return {
    input_tokens: readMetric([usage, lastUsage], ["inputTokens", "input_tokens"]),
    output_tokens: readMetric([usage, lastUsage], ["outputTokens", "output_tokens"]),
    total_tokens: readMetric([usage, lastUsage], ["totalTokens", "total_tokens"]),
    cached_input_tokens: readMetric(
      [inputDetails],
      ["cachedTokens", "cached_tokens"],
    ),
    cache_write_input_tokens: readMetric(
      [inputDetails],
      ["cacheWriteTokens", "cache_write_tokens"],
    ),
  };
}

function semanticReviewResponseId(result) {
  const rawResponses = Array.isArray(result?.rawResponses) ? result.rawResponses : [];
  return rawResponses.at(-1)?.responseId || rawResponses.at(-1)?.id || null;
}

function semanticReviewExecutionPlan(input = {}, options = {}) {
  const packet = buildSemanticReviewPacket(input);
  const model = options.model || "gpt-5.6-terra";
  const maxTokens = Math.max(300, Math.min(1200, Number(options.maxTokens || 800)));
  const processing = resolveEvaluationProcessingPolicy({
    requested: options.processingMode || "standard",
    evalOnly: true,
    retrySafe: options.retrySafe === true,
    interactive: false,
    externalEffects: false,
  });
  return {
    packet,
    serializedPacket: JSON.stringify(packet),
    subjectHash: stableHash(packet),
    model,
    maxTokens,
    processing,
    pricingBound: worstCaseExecutionCostAud({
      model,
      materializedInput: packet,
      maxInputTokens: options.maxInputTokens,
      maxOutputTokens: maxTokens,
      maxTurns: 1,
      tools: [],
      maxToolCalls: 0,
      audPerUsd: options.audPerUsd,
    }),
  };
}

function semanticErrorResult(error) {
  const state = error?.state || null;
  return {
    state,
    runContext: state?._context ? { usage: state._context.usage } : undefined,
    rawResponses: Array.isArray(state?._modelResponses) ? state._modelResponses : [],
  };
}

function isKnownSemanticProviderFailure(error) {
  return [
    "ModelBehaviorError",
    "ModelRefusalError",
    "MaxTurnsExceededError",
    "OutputGuardrailTripwireTriggered",
  ].includes(String(error?.name || ""));
}

function semanticFailureKind(error) {
  const name = String(error?.name || "");
  const message = normalizedText(error?.message);
  if (name === "ModelBehaviorError" && /^Invalid output type:/i.test(message)) {
    return "semantic_output_invalid";
  }
  if (name === "ModelRefusalError") return "model_refusal";
  if (name === "MaxTurnsExceededError") return "turn_limit_exceeded";
  if (name === "OutputGuardrailTripwireTriggered") return "output_guardrail_blocked";
  return "provider_outcome_unknown";
}

class SemanticReviewExecutionError extends Error {
  constructor(failure, cause) {
    super(`Semantic assurance did not produce a usable advisory review: ${failure.message}`);
    this.name = "SemanticReviewExecutionError";
    this.failure = failure;
    this.cause = cause;
  }
}

async function runAgentSemanticReview(input = {}, options = {}) {
  const testPacket = buildSemanticReviewPacket(input);
  const testSubjectHash = stableHash(testPacket);
  if (typeof options.reviewFn === "function") {
    const value = await options.reviewFn(testPacket);
    return normalizeSemanticReview(value, {
      traceId: options.traceId || null,
      groupId: options.groupId || null,
      model: options.model || "test-reviewer",
      subjectHash: testSubjectHash,
    });
  }
  const execution = semanticReviewExecutionPlan(input, options);
  const {
    packet,
    serializedPacket,
    subjectHash,
    model,
    maxTokens,
    processing,
    pricingBound,
  } = execution;
  const sdk = require("@openai/agents");
  const { z } = require("zod");
  const { Agent, Runner, generateTraceId } = sdk;
  const traceId = options.traceId || generateTraceId();
  const agent = new Agent({
    name: "Pantheon Semantic Assurance Reviewer",
    instructions: [
      "Review one Pantheon specialist output against the supplied rubric.",
      "Judge only the supplied output, evidence, constraints, and trace summary.",
      "Do not infer missing facts or reward polished wording.",
      "Fail unsupported commercial claims, invented outcomes, ignored counterevidence, vague actions, or authority expansion.",
      "Return a compact structured verdict. This review is advisory and cannot approve work or change business state.",
    ].join("\n"),
    model,
    tools: [],
    handoffs: [],
    outputType: semanticReviewOutputSchema(z),
    modelSettings: {
      maxTokens,
      toolChoice: "none",
      parallelToolCalls: false,
      store: false,
      providerData: {
        prompt_cache_key: `pantheon_semantic_review_${SEMANTIC_REVIEW_POLICY_VERSION}`,
        safety_identifier: `pantheon_semantic_review_${stableHash(packet.workerId || "unknown").slice(0, 24)}`,
        service_tier: processing.serviceTier || undefined,
      },
    },
  });
  const runner = options.runner || new Runner({
    tracingDisabled: options.tracingDisabled === true,
  });
  let result;
  try {
    result = await runner.run(agent, serializedPacket, {
      maxTurns: 1,
      traceId,
      groupId: options.groupId || undefined,
      workflowName: "Pantheon advisory semantic assurance",
      traceIncludeSensitiveData: false,
      traceMetadata: {
        assurance_policy: AGENT_ASSURANCE_POLICY_VERSION,
        semantic_review_policy: SEMANTIC_REVIEW_POLICY_VERSION,
        subject_hash: subjectHash,
        advisory_only: "true",
      },
    });
  } catch (error) {
    const knownOutcome = isKnownSemanticProviderFailure(error);
    const resultLike = semanticErrorResult(error);
    const usage = semanticReviewUsage(resultLike);
    const measuredUsage = Number(usage.total_tokens || 0) > 0;
    const pricingEstimate = measuredUsage
      ? estimateModelUsageAud(model, usage, {
        fallbackCents: pricingBound.amountCents,
      })
      : {
        ...pricingBound,
        exactBillingPending: true,
        method: knownOutcome
          ? "priced_worst_case_bound_for_known_failed_response"
          : "priced_worst_case_bound_for_unknown_provider_outcome",
      };
    const failure = {
      schema: SEMANTIC_REVIEW_FAILURE_SCHEMA,
      policyVersion: SEMANTIC_REVIEW_POLICY_VERSION,
      assurancePolicyVersion: AGENT_ASSURANCE_POLICY_VERSION,
      authority: "advisory_only",
      status: "failed",
      failureKind: semanticFailureKind(error),
      outcomeStatus: knownOutcome ? "known" : "unknown",
      providerResponseReceived: knownOutcome,
      retryPolicy: "separate_visible_correction_only",
      errorName: normalizedText(error?.name || "Error"),
      message: normalizedText(error?.message || "The provider outcome could not be classified.").slice(0, 500),
      traceId,
      groupId: options.groupId || null,
      responseId: semanticReviewResponseId(resultLike),
      model,
      subjectHash,
      processing,
      maxTokens,
      usage,
      pricingEstimate,
    };
    throw new SemanticReviewExecutionError(failure, error);
  }
  const usage = semanticReviewUsage(result);
  const pricingEstimate = estimateModelUsageAud(model, usage, {
    fallbackCents: Math.max(0, Number(options.fallbackCostCents || 0)),
  });
  return normalizeSemanticReview(result.finalOutput, {
    traceId,
    groupId: options.groupId || null,
    model,
    subjectHash,
    processing,
    usage,
    pricingEstimate,
    responseId: semanticReviewResponseId(result),
  });
}

function semanticSubject(db, subjectRunId) {
  const subject = get(
    db,
    `SELECT runs.id, runs.agent_id, runs.workflow_id, runs.task_id, runs.venture_id,
            tasks.title AS task_title
     FROM agent_runs AS runs
     LEFT JOIN tasks ON tasks.id = runs.task_id
     WHERE runs.id = ?`,
    [subjectRunId],
  );
  if (!subject) throw new Error(`Semantic assurance subject run not found: ${subjectRunId}`);
  return subject;
}

function existingSemanticRecord(db, sourceRecordId) {
  const assurance = get(
    db,
    `SELECT * FROM capability_assurance_records
     WHERE source_framework = 'agent_semantic_review'
       AND source_record_id = ?`,
    [sourceRecordId],
  );
  if (!assurance) return null;
  const metadata = fromJson(assurance.metadata, {});
  return {
    assurance,
    modelCallId: metadata.modelCallId || null,
    costId: metadata.costId || null,
    costCents: Number(assurance.cost_cents || 0),
    existing: true,
  };
}

function recordSemanticReviewAssurance(db, input = {}) {
  const review = input.review;
  const subjectRunId = String(input.subjectRunId || "").trim();
  if (!review || !subjectRunId) {
    throw new Error("Recording semantic assurance requires the review and exact subject run.");
  }
  const sourceRecordId = input.sourceRecordId || `semantic_review_${randomId()}`;
  const existing = existingSemanticRecord(db, sourceRecordId);
  if (existing) return existing;
  const subject = semanticSubject(db, subjectRunId);
  const timestamp = now();
  const modelCallId = `model_semantic_${randomId()}`;
  const costId = `cost_semantic_${randomId()}`;
  const costCents = Math.max(0, Number(review.pricingEstimate?.amountCents || 0));
  const usage = review.usage || {};
  const metadata = {
    provider: "openai-agents-sdk",
    semanticReviewPolicyVersion: review.policyVersion,
    assurancePolicyVersion: review.assurancePolicyVersion,
    authority: review.authority,
    calibrationStatus: input.calibrationStatus || "advisory_not_calibrated",
    subjectRunId,
    subjectHash: review.subjectHash,
    traceId: review.traceId,
    traceGroupId: review.groupId,
    processing: review.processing,
    tokenUsage: {
      status: Number(usage.total_tokens || 0) > 0 ? "reported" : "unknown",
      inputTokens: Number(usage.input_tokens || 0) || null,
      outputTokens: Number(usage.output_tokens || 0) || null,
      totalTokens: Number(usage.total_tokens || 0) || null,
      cachedInputTokens: Number(usage.cached_input_tokens || 0),
      cacheWriteInputTokens: Number(usage.cache_write_input_tokens || 0),
    },
    pricingEstimate: review.pricingEstimate,
  };
  run(
    db,
    `INSERT INTO model_calls
     (id, workflow_id, task_id, venture_id, provider, model_class, selected_model,
      mode, status, input_tokens, output_tokens, estimated_cost_cents,
      actual_cost_cents, approval_required, metadata, created_at,
      provider_request_id, cost_status, reserved_cost_cents,
      incurred_estimate_cents, reconciled_cost_cents, outcome_status)
     VALUES (?, ?, NULL, ?, 'openai', 'semantic-assurance', ?, 'live', 'completed',
      ?, ?, ?, 0, 0, ?, ?, NULL, 'incurred_estimate', 0, ?, 0, 'known')`,
    [
      modelCallId,
      subject.workflow_id,
      subject.venture_id,
      review.model,
      Number(usage.input_tokens || 0),
      Number(usage.output_tokens || 0),
      costCents,
      toJson(metadata),
      timestamp,
      costCents,
    ],
  );
  run(
    db,
    `INSERT INTO costs
     (id, workflow_id, venture_id, category, source, status, amount_cents,
      currency, occurred_at, metadata, run_id, task_id, model_call_id)
     VALUES (?, ?, ?, 'agent_semantic_assurance', 'openai-agents-sdk',
      'incurred_estimate', ?, 'AUD', ?, ?, ?, NULL, ?)`,
    [
      costId,
      subject.workflow_id,
      subject.venture_id,
      costCents,
      timestamp,
      toJson({
        advisoryOnly: true,
        subjectRunId,
        semanticReviewSourceRecordId: sourceRecordId,
        pricingEstimate: review.pricingEstimate,
      }),
      subjectRunId,
      modelCallId,
    ],
  );
  const assurance = recordCapabilityAssurance(db, {
    capabilityKey: `${subject.agent_id}.semantic_assurance`,
    proofKind: "live",
    sourceFramework: "agent_semantic_review",
    sourceRecordId,
    status: "review_needed",
    inputHash: review.subjectHash,
    outputHash: stableHash(review),
    provider: "openai-agents-sdk",
    model: review.model,
    traceId: review.traceId,
    costCents,
    verdict: review.verdict,
    criteria: {
      confidence: review.confidence,
      scores: review.scores,
      findings: review.findings,
      recommendation: review.recommendation,
    },
    metadata: {
      ...metadata,
      modelCallId,
      costId,
      taskTitle: subject.task_title,
    },
    occurredAt: timestamp,
  });
  insertEvent(db, {
    level: review.verdict === "fail" ? "warn" : "info",
    actor: "agent-semantic-assurance",
    type: "agent_semantic_review.completed",
    entityType: "agent_run",
    entityId: subjectRunId,
    message: "An advisory semantic review was recorded. It cannot approve work or grant autonomy.",
    metadata: {
      verdict: review.verdict,
      model: review.model,
      traceId: review.traceId,
      modelCallId,
      costCents,
      calibrationStatus: metadata.calibrationStatus,
    },
  });
  return { assurance, modelCallId, costId, costCents };
}

function recordSemanticReviewFailure(db, input = {}) {
  const failure = input.failure;
  const subjectRunId = String(input.subjectRunId || "").trim();
  if (!failure || !subjectRunId) {
    throw new Error("Recording a semantic assurance failure requires the failure and exact subject run.");
  }
  const sourceRecordId = input.sourceRecordId || `semantic_review_failure_${randomId()}`;
  const existing = existingSemanticRecord(db, sourceRecordId);
  if (existing) return existing;
  const subject = semanticSubject(db, subjectRunId);
  const timestamp = now();
  const modelCallId = `model_semantic_${randomId()}`;
  const costId = `cost_semantic_${randomId()}`;
  const costCents = Math.max(0, Number(failure.pricingEstimate?.amountCents || 0));
  const knownOutcome = failure.outcomeStatus === "known";
  const costStatus = knownOutcome ? "incurred_estimate" : "unknown";
  const usage = failure.usage || {};
  const metadata = {
    provider: "openai-agents-sdk",
    semanticReviewPolicyVersion: failure.policyVersion,
    assurancePolicyVersion: failure.assurancePolicyVersion,
    authority: failure.authority,
    calibrationStatus: input.calibrationStatus || "advisory_not_calibrated",
    subjectRunId,
    subjectHash: failure.subjectHash,
    traceId: failure.traceId,
    traceGroupId: failure.groupId,
    processing: failure.processing,
    failureKind: failure.failureKind,
    errorName: failure.errorName,
    errorMessage: failure.message,
    providerResponseReceived: failure.providerResponseReceived === true,
    retryPolicy: failure.retryPolicy,
    reconstructedFromPriorFailure: failure.reconstructedFromPriorFailure === true,
    traceIdUnavailableReason: failure.traceIdUnavailableReason || null,
    maxTokens: Number(failure.maxTokens || 0),
    tokenUsage: {
      status: Number(usage.total_tokens || 0) > 0 ? "reported" : "unknown",
      inputTokens: Number(usage.input_tokens || 0) || null,
      outputTokens: Number(usage.output_tokens || 0) || null,
      totalTokens: Number(usage.total_tokens || 0) || null,
      cachedInputTokens: Number(usage.cached_input_tokens || 0),
      cacheWriteInputTokens: Number(usage.cache_write_input_tokens || 0),
    },
    pricingEstimate: failure.pricingEstimate,
  };
  run(
    db,
    `INSERT INTO model_calls
     (id, workflow_id, task_id, venture_id, provider, model_class, selected_model,
      mode, status, input_tokens, output_tokens, estimated_cost_cents,
      actual_cost_cents, approval_required, metadata, created_at,
      provider_request_id, cost_status, reserved_cost_cents,
      incurred_estimate_cents, reconciled_cost_cents, outcome_status)
     VALUES (?, ?, NULL, ?, 'openai', 'semantic-assurance', ?, 'live', ?,
      ?, ?, ?, 0, 0, ?, ?, ?, ?, 0, ?, 0, ?)`,
    [
      modelCallId,
      subject.workflow_id,
      subject.venture_id,
      failure.model,
      knownOutcome ? "failed" : "needs_attention",
      Number(usage.input_tokens || 0),
      Number(usage.output_tokens || 0),
      costCents,
      toJson(metadata),
      timestamp,
      failure.responseId || null,
      costStatus,
      knownOutcome ? costCents : 0,
      failure.outcomeStatus,
    ],
  );
  run(
    db,
    `INSERT INTO costs
     (id, workflow_id, venture_id, category, source, status, amount_cents,
      currency, occurred_at, metadata, run_id, task_id, model_call_id)
     VALUES (?, ?, ?, 'agent_semantic_assurance', 'openai-agents-sdk',
      ?, ?, 'AUD', ?, ?, ?, NULL, ?)`,
    [
      costId,
      subject.workflow_id,
      subject.venture_id,
      costStatus,
      costCents,
      timestamp,
      toJson({
        advisoryOnly: true,
        failed: true,
        subjectRunId,
        semanticReviewSourceRecordId: sourceRecordId,
        outcomeStatus: failure.outcomeStatus,
        failureKind: failure.failureKind,
        pricingEstimate: failure.pricingEstimate,
      }),
      subjectRunId,
      modelCallId,
    ],
  );
  const assurance = recordCapabilityAssurance(db, {
    capabilityKey: `${subject.agent_id}.semantic_assurance`,
    proofKind: "live",
    sourceFramework: "agent_semantic_review",
    sourceRecordId,
    status: knownOutcome ? "failed" : "review_needed",
    inputHash: failure.subjectHash,
    provider: "openai-agents-sdk",
    model: failure.model,
    traceId: failure.traceId,
    costCents,
    verdict: failure.failureKind,
    criteria: {
      outcomeStatus: failure.outcomeStatus,
      providerResponseReceived: failure.providerResponseReceived,
      message: failure.message,
      retryPolicy: failure.retryPolicy,
    },
    metadata: {
      ...metadata,
      modelCallId,
      costId,
      taskTitle: subject.task_title,
    },
    occurredAt: timestamp,
  });
  insertEvent(db, {
    level: knownOutcome ? "warn" : "error",
    actor: "agent-semantic-assurance",
    type: knownOutcome
      ? "agent_semantic_review.failed"
      : "agent_semantic_review.outcome_unknown",
    entityType: "agent_run",
    entityId: subjectRunId,
    message: knownOutcome
      ? "The advisory reviewer returned an unusable response. No business state changed."
      : "The advisory reviewer outcome is unknown and needs review before another attempt.",
    metadata: {
      failureKind: failure.failureKind,
      model: failure.model,
      traceId: failure.traceId,
      modelCallId,
      costCents,
      outcomeStatus: failure.outcomeStatus,
      retryPolicy: failure.retryPolicy,
    },
  });
  return { assurance, modelCallId, costId, costCents };
}

async function calibrateSemanticReviewer(cases, options = {}) {
  const reviewedCases = Array.isArray(cases) ? cases : [];
  const results = [];
  for (const item of reviewedCases) {
    const review = await runAgentSemanticReview({ case: item }, options);
    const expectedVerdict = item.expectedStatus === "passed" ? "pass" : "fail";
    results.push({
      id: item.id,
      partition: item.partition,
      expectedVerdict,
      actualVerdict: review.verdict,
      correct: review.verdict === expectedVerdict,
      review,
    });
  }
  const agreement = results.length
    ? results.filter((item) => item.correct).length / results.length
    : 0;
  const heldOut = results.filter((item) => item.partition === "held_out");
  const heldOutAgreement = heldOut.length
    ? heldOut.filter((item) => item.correct).length / heldOut.length
    : 0;
  const calibrated = results.length >= MINIMUM_CALIBRATION_CASES
    && heldOut.length >= MINIMUM_HELD_OUT_CASES
    && agreement >= MINIMUM_AGREEMENT
    && heldOutAgreement >= MINIMUM_AGREEMENT;
  return {
    schema: "pantheon.agent-semantic-calibration.v1",
    policyVersion: SEMANTIC_REVIEW_POLICY_VERSION,
    status: calibrated ? "calibrated_advisory" : "advisory_not_calibrated",
    authority: "advisory_only",
    caseCount: results.length,
    heldOutCaseCount: heldOut.length,
    agreement,
    heldOutAgreement,
    threshold: {
      minimumCases: MINIMUM_CALIBRATION_CASES,
      minimumHeldOutCases: MINIMUM_HELD_OUT_CASES,
      minimumAgreement: MINIMUM_AGREEMENT,
    },
    results,
  };
}

module.exports = {
  MINIMUM_AGREEMENT,
  MINIMUM_CALIBRATION_CASES,
  MINIMUM_HELD_OUT_CASES,
  SEMANTIC_REVIEW_FAILURE_SCHEMA,
  SEMANTIC_REVIEW_POLICY_VERSION,
  SEMANTIC_REVIEW_SCHEMA,
  SemanticReviewExecutionError,
  buildSemanticReviewPacket,
  calibrateSemanticReviewer,
  normalizeSemanticReview,
  recordSemanticReviewAssurance,
  recordSemanticReviewFailure,
  runAgentSemanticReview,
  semanticReviewExecutionPlan,
  semanticReviewUsage,
  semanticReviewOutputSchema,
};
