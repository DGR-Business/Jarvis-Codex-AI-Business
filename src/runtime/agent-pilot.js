const crypto = require("node:crypto");
const CONFIG = require("../config");
const { all, fromJson, get, insertEvent, now, randomId, run, toJson } = require("../db");
const { canonicalJson } = require("./approval-scope");
const { recordCapabilityReview } = require("./capability-autonomy");
const { requestLiveAiWorker } = require("./live-ai-workers");

const PILOT_CAPABILITY = "demand_validator.reasoning_on_supplied_evidence";
const MAX_REASONING_FIXTURES = 5;
const PILOT_COST_CAP_CENTS = 100;

function digest(value) {
  return crypto.createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function cleanSources(sources) {
  if (!Array.isArray(sources) || sources.length === 0) {
    throw new Error("A pilot fixture needs at least one supplied evidence item.");
  }
  return sources.map((source, index) => {
    const item = {
      id: String(source.id || `source-${index + 1}`),
      title: String(source.title || "").trim(),
      sourceType: String(source.sourceType || "test_fixture").trim(),
      summary: String(source.summary || "").trim(),
      url: source.url ? String(source.url).trim() : null,
      observedAt: source.observedAt ? String(source.observedAt) : null,
    };
    if (!item.title || !item.summary) throw new Error("Every fixture source needs a title and evidence summary.");
    if (!new Set(["test_fixture", "operator_observation", "source_link", "platform_csv", "receipt"]).has(item.sourceType)) {
      throw new Error(`Unsupported fixture source type: ${item.sourceType}`);
    }
    if (item.sourceType === "source_link" && !item.url) throw new Error("Linked evidence needs a source URL.");
    return item;
  });
}

function protectedBaselineFor(input) {
  return {
    schema: "jarvis_demand_validator_baseline_v1",
    recommendation: "Do not build or publish yet. Use the smallest measurable buyer test that can disprove the hypothesis.",
    evidence: input.sources.map((source) => `${source.title}: ${source.summary}`),
    counterevidence: ["The supplied fixture does not contain an independent paid purchase result."],
    assumptions: ["Fixture evidence is accurate as captured and is not being treated as live market proof."],
    priceChannelHypothesis: "Test one bounded price and one evidence-selected channel before widening distribution.",
    smallestTest: "Present one specific offer to a small qualified audience without automated publishing or spend.",
    metric: "Qualified views, buyer actions and paid conversions are recorded against a pre-declared threshold.",
    killRule: "Stop or revise when the declared sample is reached without the required buyer signal.",
    confidence: "low",
    risks: ["Demand, willingness to pay and acquisition remain unproven."],
  };
}

function fixtureInput(input) {
  return {
    fixtureVersion: Number(input.fixtureVersion || 1),
    question: String(input.question || "").trim(),
    buyer: String(input.buyer || "").trim(),
    hypothesis: String(input.hypothesis || "").trim(),
    sources: cleanSources(input.sources),
    constraints: {
      ...(input.constraints || {}),
      tools: [],
      handoffs: [],
      maxTurns: 1,
      maxOutputTokens: 1200,
      maxCostCents: PILOT_COST_CAP_CENTS,
      externalActionsAllowed: false,
    },
  };
}

function createPilotFixture(db, input) {
  const normalized = fixtureInput(input);
  if (!normalized.question || !normalized.buyer || !normalized.hypothesis) {
    throw new Error("A pilot fixture needs a business question, buyer and hypothesis.");
  }
  const ventureId = input.ventureId || "venture-digital-products";
  const fixtureHash = digest(normalized);
  const existing = get(db, "SELECT * FROM agent_pilot_fixtures WHERE fixture_hash = ?", [fixtureHash]);
  if (existing) return hydrateFixture(existing);
  const count = get(
    db,
    "SELECT COUNT(*) AS count FROM agent_pilot_fixtures WHERE venture_id = ? AND status <> 'cancelled'",
    [ventureId],
  );
  if (Number(count?.count || 0) >= MAX_REASONING_FIXTURES) {
    throw new Error("The initial Demand Validator proof is limited to five distinct fixtures.");
  }
  const baseline = input.protectedBaseline || protectedBaselineFor(normalized);
  const id = input.id || `pilot_fixture_${randomId()}`;
  const ts = now();
  run(
    db,
    `INSERT INTO agent_pilot_fixtures
     (id, venture_id, candidate_id, captured_at, question, buyer, hypothesis, sources,
      constraints, fixture_hash, status, created_at, fixture_version, baseline_output, baseline_hash)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ready', ?, ?, ?, ?)`,
    [
      id,
      ventureId,
      input.candidateId || null,
      input.capturedAt || ts,
      normalized.question,
      normalized.buyer,
      normalized.hypothesis,
      toJson(normalized.sources),
      toJson(normalized.constraints),
      fixtureHash,
      ts,
      normalized.fixtureVersion,
      toJson(baseline),
      digest(baseline),
    ],
  );
  insertEvent(db, {
    actor: "agent-pilot",
    type: "agent_pilot.fixture_created",
    entityType: "agent_pilot_fixture",
    entityId: id,
    message: "A versioned Demand Validator evidence fixture is ready for a protected comparison.",
    metadata: { fixtureHash, fixtureVersion: normalized.fixtureVersion, baselineExcludedFromWorker: true },
  });
  return hydrateFixture(get(db, "SELECT * FROM agent_pilot_fixtures WHERE id = ?", [id]));
}

function ensureDemandValidatorPilotFixture(db) {
  const existing = get(db, "SELECT * FROM agent_pilot_fixtures ORDER BY created_at LIMIT 1");
  if (existing) return hydrateFixture(existing);
  return createPilotFixture(db, {
    id: "pilot-fixture-demand-validator-v1",
    ventureId: "venture-digital-products",
    fixtureVersion: 1,
    question: "Should a concise weekly cash-control checklist for solo service businesses advance to a small interest test?",
    buyer: "Solo service-business owners who struggle to maintain a weekly cash-control routine.",
    hypothesis: "A short, practical checklist can earn qualified interest before a full product is built.",
    sources: [
      {
        id: "fixture-observation-1",
        title: "Repeated workflow problem",
        sourceType: "test_fixture",
        summary: "The supplied evaluation scenario contains repeated missed invoice, expense and cash-review tasks.",
      },
      {
        id: "fixture-observation-2",
        title: "No purchase evidence",
        sourceType: "test_fixture",
        summary: "No paid buyers, product views or verified willingness-to-pay evidence are included.",
      },
    ],
    constraints: { evaluationOnly: true, realBusinessEvidence: false },
  });
}

function hydrateFixture(row, options = {}) {
  if (!row) return null;
  const fixture = {
    ...row,
    sources: fromJson(row.sources, []),
    constraints: fromJson(row.constraints, {}),
  };
  if (options.includeBaseline) fixture.protectedBaseline = fromJson(row.baseline_output, {});
  delete fixture.baseline_output;
  return fixture;
}

function fixturePilotTasks(db, fixtureId) {
  return all(
    db,
    `SELECT * FROM tasks
     WHERE kind = 'live_ai_worker_execution'
     ORDER BY created_at ASC`,
  )
    .map((row) => ({ ...row, payload: fromJson(row.payload, {}) }))
    .filter((task) => task.payload?.pilotFixture?.id === fixtureId);
}

function prepareFixtureRun(db, fixture, options = {}, retryContext = null) {
  const amountCents = Math.min(PILOT_COST_CAP_CENTS, Math.max(1, Number(options.estimatedCostCents || PILOT_COST_CAP_CENTS)));
  const ts = now();
  const suffix = randomId().slice(0, 8);
  const workflowId = `wf_demand_validator_pilot_${suffix}`;
  const commandId = `cmd_demand_validator_pilot_${suffix}`;
  const attemptNumber = Number(retryContext?.attemptNumber || 1);
  const retryMetadata = retryContext ? {
    attemptNumber,
    technicalRetry: true,
    retryOfTaskId: retryContext.previousTaskId,
    priorOutcome: "unknown",
    priorOutcomeAcknowledged: true,
  } : { attemptNumber, technicalRetry: false };
  run(
    db,
    `INSERT INTO workflows
     (id, venture_id, type, title, status, current_step, priority, quality_score,
      expected_profit_cents, cost_estimate_cents, approval_required, metadata, created_at, updated_at)
     VALUES (?, ?, 'agent_sdk_pilot', ?, 'planned', 'waiting for pilot approval', 1, 0, 0, ?, 1, ?, ?, ?)`,
    [
      workflowId,
      fixture.venture_id,
      "Demand Validator controlled proof",
      amountCents,
      toJson({
        fixtureId: fixture.id,
        fixtureHash: fixture.fixture_hash,
        capabilityKey: PILOT_CAPABILITY,
        baselineExcludedFromWorker: true,
        ...retryMetadata,
      }),
      ts,
      ts,
    ],
  );
  run(
    db,
    `INSERT INTO commands
     (id, source, raw_text, intent, status, workflow_id, summary, metadata, created_at, updated_at, venture_id)
     VALUES (?, 'agent-pilot', ?, 'evaluate_supplied_evidence', 'planned', ?, ?, ?, ?, ?, ?)`,
    [
      commandId,
      fixture.question,
      workflowId,
      "Prepare one capped Demand Validator recommendation from a versioned evidence fixture.",
      toJson({ fixtureId: fixture.id, fixtureHash: fixture.fixture_hash, baselineExcludedFromWorker: true, ...retryMetadata }),
      ts,
      ts,
      fixture.venture_id,
    ],
  );
  const publicFixtureInput = {
    id: fixture.id,
    version: fixture.fixture_version,
    hash: fixture.fixture_hash,
    question: fixture.question,
    buyer: fixture.buyer,
    hypothesis: fixture.hypothesis,
    sources: fixture.sources,
    constraints: fixture.constraints,
  };
  const requested = requestLiveAiWorker(db, workflowId, {
    worker: "demand_validator",
    estimatedCostCents: amountCents,
    requestedBy: options.requestedBy || "agent-pilot",
    taskTitle: "Demand Validator controlled proof",
    approvalTitle: "Approve this Demand Validator proof",
    reason: retryContext
      ? "Run one separately approved corrected Agents SDK turn after acknowledging the prior unknown technical outcome. No tools, handoffs, publishing, contact, account action or external effect is permitted."
      : "Run one Agents SDK turn over supplied evidence only. No tools, handoffs, publishing, contact, account action or external effect is permitted.",
    expectedOutput: "A structured recommendation with evidence, counterevidence, assumptions, price/channel hypothesis, smallest test, metric, stop rule, confidence and risks.",
    expectedMetric: "Deterministic scope, source, structure and cost checks pass; Daniel separately judges commercial usefulness.",
    fixtureHash: fixture.fixture_hash,
    fixtureInput: publicFixtureInput,
    tools: [],
    maxTurns: 1,
    maxOutputTokens: 1200,
    tracePolicy: {
      providerResponseStored: true,
      providerTraceContent: true,
      localReviewStored: true,
      dataClass: "controlled_fixture_no_personal_data",
      purpose: "Make the supplied fixture and structured recommendation reviewable in OpenAI traces while retaining the local audit record.",
    },
    parameters: retryContext ? retryMetadata : {},
    effects: [],
    comparisonSource: { type: "versioned_agent_pilot_fixture", fixtureId: fixture.id, fixtureHash: fixture.fixture_hash },
    protectedEvidence: fixture.sources.map((source) => `${source.title}: ${source.summary}`),
  });
  run(db, "UPDATE agent_pilot_fixtures SET status = 'prepared' WHERE id = ?", [fixture.id]);
  if (retryContext) {
    insertEvent(db, {
      level: "warn",
      actor: options.requestedBy || "operator",
      type: "agent_pilot.technical_retry_prepared",
      entityType: "agent_pilot_fixture",
      entityId: fixture.id,
      message: "A fresh one-use approval was prepared for one corrected Demand Validator attempt; the prior unknown result remains unchanged.",
      metadata: {
        fixtureId: fixture.id,
        fixtureHash: fixture.fixture_hash,
        previousTaskId: retryContext.previousTaskId,
        newTaskId: requested.task.id,
        workflowId,
        approvalId: requested.approval.id,
        attemptNumber,
        priorOutcome: "unknown",
        historyPreserved: true,
      },
    });
  }
  return { workflowId, commandId, fixture, requested };
}

function prepareDemandValidatorPilot(db, fixtureId, options = {}) {
  const fixture = hydrateFixture(get(db, "SELECT * FROM agent_pilot_fixtures WHERE id = ?", [fixtureId]));
  if (!fixture) throw new Error(`Pilot fixture not found: ${fixtureId}`);
  if (fixture.status !== "ready") throw new Error("This fixture is already prepared or completed.");
  return prepareFixtureRun(db, fixture, options);
}

function prepareDemandValidatorPilotRetry(db, fixtureId, options = {}) {
  if (options.acknowledgeUnknownOutcome !== true) {
    throw new Error("The prior unknown provider outcome must be explicitly acknowledged before a corrected attempt is prepared.");
  }
  const previousTaskId = String(options.previousTaskId || "").trim();
  if (!previousTaskId) throw new Error("The exact prior task must be identified before a corrected attempt is prepared.");
  const fixture = hydrateFixture(get(db, "SELECT * FROM agent_pilot_fixtures WHERE id = ?", [fixtureId]));
  if (!fixture) throw new Error(`Pilot fixture not found: ${fixtureId}`);
  if (fixture.status !== "prepared") {
    throw new Error("Only a prepared fixture with a failed technical attempt can be retried.");
  }

  const attempts = fixturePilotTasks(db, fixtureId);
  if (attempts.length !== 1) {
    throw new Error("This fixture is limited to one history-preserving technical retry. Review or revise the contract before another attempt.");
  }
  const previousTask = attempts[0];
  if (previousTask.id !== previousTaskId) throw new Error("The acknowledged task does not match this fixture's failed attempt.");
  if (!new Set(["needs_attention", "failed"]).has(previousTask.status)) {
    throw new Error("The prior task must have a failed or needs-attention outcome before a corrected attempt is prepared.");
  }
  const previousApprovalId = previousTask.payload?.liveSpendRequest?.approvalId;
  const previousApproval = previousApprovalId
    ? get(db, "SELECT * FROM approvals WHERE id = ?", [previousApprovalId])
    : null;
  if (!previousApproval?.consumed_at) {
    throw new Error("The prior one-use approval was not consumed, so a technical retry cannot be prepared.");
  }
  const reviewCount = get(
    db,
    `SELECT COUNT(*) AS count
     FROM agent_pilot_reviews reviews
     JOIN agent_runs runs ON runs.id = reviews.run_id
     WHERE runs.task_id = ?`,
    [previousTask.id],
  );
  if (Number(reviewCount?.count || 0) > 0) {
    throw new Error("The prior attempt already has a review result and cannot be treated as a technical retry.");
  }

  db.exec("BEGIN IMMEDIATE");
  try {
    insertEvent(db, {
      level: "warn",
      actor: options.requestedBy || "operator",
      type: "agent_pilot.unknown_outcome_acknowledged",
      entityType: "task",
      entityId: previousTask.id,
      message: "Daniel acknowledged the prior unknown provider outcome and authorised preparation of one corrected attempt without erasing the original record.",
      metadata: {
        fixtureId,
        fixtureHash: fixture.fixture_hash,
        previousTaskId: previousTask.id,
        previousApprovalId,
        previousApprovalConsumedAt: previousApproval.consumed_at,
        operatorNote: String(options.operatorNote || ""),
      },
    });
    const prepared = prepareFixtureRun(db, fixture, options, {
      previousTaskId: previousTask.id,
      attemptNumber: 2,
    });
    db.exec("COMMIT");
    return prepared;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function pilotRecommendation(output = {}) {
  return output.pilotRecommendation || {
    evidence: output.evidence || [],
    counterevidence: output.counterevidence || [],
    assumptions: output.assumptions || [],
    priceChannelHypothesis: output.priceChannelHypothesis || "",
    smallestTest: output.smallestTest || output.businessDecision?.continuousImprovement?.smallestUsefulAction || "",
    metric: output.metric || output.businessDecision?.successMetric || "",
    killRule: output.killRule || output.businessDecision?.killCriteria || "",
    confidence: output.confidence || "",
    risks: output.risks || [],
  };
}

function recordPilotRunReview(db, input) {
  const task = input.task;
  const pilot = task?.payload?.pilotFixture;
  if (!pilot?.id) return null;
  const fixture = hydrateFixture(get(db, "SELECT * FROM agent_pilot_fixtures WHERE id = ?", [pilot.id]), { includeBaseline: true });
  if (!fixture) throw new Error("The pilot run references a missing fixture.");
  const recommendation = pilotRecommendation(input.output);
  const sourceValidity = fixture.sources.length > 0 && fixture.sources.every((source) => (
    source.id && source.title && source.summary && (source.sourceType !== "source_link" || source.url)
  ));
  const requiredStructure = [
    recommendation.evidence?.length,
    recommendation.counterevidence?.length,
    recommendation.assumptions?.length,
    recommendation.priceChannelHypothesis,
    recommendation.smallestTest,
    recommendation.metric,
    recommendation.killRule,
    recommendation.confidence,
    recommendation.risks?.length,
  ].every(Boolean);
  const provider = input.liveWorker?.provider || "unknown";
  const scopeCompliance = provider === "openai-agents-sdk"
    && task.payload?.pilotFixture?.baselineExcluded === true
    && Array.isArray(task.payload?.liveSpendRequest?.tools)
    && task.payload.liveSpendRequest.tools.length === 0
    && Number(task.payload.liveSpendRequest.maxTurns) === 1
    && input.output?.businessDecision?.externalActionsAllowed === false;
  const estimate = Number(input.liveWorker?.incurredEstimateCents || input.liveWorker?.modelCall?.estimatedCostCents || 0);
  const reconciled = Number(input.liveWorker?.reconciledCostCents || input.liveWorker?.modelCall?.actualCostCents || 0);
  const costCompliance = estimate <= PILOT_COST_CAP_CENTS && reconciled <= PILOT_COST_CAP_CENTS;
  const unsupportedClaims = input.output?.liveEvidence === true;
  const criteria = {
    sourceValidity,
    unsupportedClaims: !unsupportedClaims,
    reasoningStructure: requiredStructure,
    commercialUsefulness: "operator_review_required",
    scopeCompliance,
    costCompliance,
    baselineExcludedFromWorker: task.payload?.pilotFixture?.baselineExcluded === true,
  };
  const deterministicStatus = sourceValidity && !unsupportedClaims && requiredStructure && scopeCompliance && costCompliance
    ? "passed"
    : "failed";
  const id = `pilot_review_${randomId()}`;
  const ts = now();
  run(
    db,
    `INSERT INTO agent_pilot_reviews
     (id, run_id, fixture_id, capability_key, deterministic_status, operator_verdict,
      criteria, created_at, output_hash, provider, estimated_cost_cents,
      incurred_estimate_cents, reconciled_cost_cents, trace_id)
     VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(run_id) DO UPDATE SET
       deterministic_status = excluded.deterministic_status,
       criteria = excluded.criteria,
       output_hash = excluded.output_hash,
       provider = excluded.provider,
       estimated_cost_cents = excluded.estimated_cost_cents,
       incurred_estimate_cents = excluded.incurred_estimate_cents,
       reconciled_cost_cents = excluded.reconciled_cost_cents,
       trace_id = excluded.trace_id`,
    [
      id,
      input.runId,
      fixture.id,
      PILOT_CAPABILITY,
      deterministicStatus,
      toJson(criteria),
      ts,
      digest(recommendation),
      provider,
      Number(input.liveWorker?.modelCall?.estimatedCostCents || estimate),
      estimate,
      reconciled,
      input.liveWorker?.raw?.traceId || null,
    ],
  );
  run(db, "UPDATE agent_pilot_fixtures SET status = 'awaiting_review' WHERE id = ?", [fixture.id]);
  insertEvent(db, {
    level: deterministicStatus === "passed" ? "info" : "warn",
    actor: "agent-pilot",
    type: "agent_pilot.deterministic_review_completed",
    entityType: "agent_run",
    entityId: input.runId,
    message: deterministicStatus === "passed"
      ? "The controlled Demand Validator run passed its technical checks and now needs Daniel's usefulness verdict."
      : "The controlled Demand Validator run failed at least one technical check and cannot advance.",
    metadata: { fixtureId: fixture.id, deterministicStatus, criteria },
  });
  return get(db, "SELECT * FROM agent_pilot_reviews WHERE run_id = ?", [input.runId]);
}

function reviewPilotRun(db, runId, input) {
  const review = get(db, "SELECT * FROM agent_pilot_reviews WHERE run_id = ?", [runId]);
  if (!review) throw new Error(`Pilot review not found for run: ${runId}`);
  if (review.operator_verdict !== "pending") throw new Error("This pilot run has already received its usefulness verdict.");
  const verdict = String(input.verdict || "");
  if (!new Set(["useful", "not_useful", "changes_required"]).has(verdict)) {
    throw new Error("Verdict must be useful, not_useful or changes_required.");
  }
  const usefulnessScore = Number(input.usefulnessScore);
  if (!Number.isInteger(usefulnessScore) || usefulnessScore < 1 || usefulnessScore > 5) {
    throw new Error("Usefulness score must be a whole number from 1 to 5.");
  }
  const passed = review.deterministic_status === "passed" && verdict === "useful" && usefulnessScore >= 3;
  const criteria = fromJson(review.criteria, {});
  const ts = now();
  run(
    db,
    `UPDATE agent_pilot_reviews
     SET operator_verdict = ?, usefulness_score = ?, note = ?, reviewed_at = ? WHERE run_id = ?`,
    [verdict, usefulnessScore, String(input.note || ""), ts, runId],
  );
  recordCapabilityReview(db, review.capability_key, {
    operatorReviewed: true,
    useful: passed,
    usefulnessScore,
    scopeViolation: criteria.scopeCompliance !== true,
    costViolation: criteria.costCompliance !== true,
    riskViolation: criteria.unsupportedClaims !== true,
    outcomeKnown: true,
    runId,
    fixtureId: review.fixture_id,
  });
  run(db, "UPDATE agent_pilot_fixtures SET status = 'reviewed' WHERE id = ?", [review.fixture_id]);
  return getPilotState(db);
}

function getPilotState(db) {
  const fixtures = all(db, "SELECT * FROM agent_pilot_fixtures ORDER BY captured_at, created_at").map((row) => hydrateFixture(row));
  const reviews = all(db, "SELECT * FROM agent_pilot_reviews ORDER BY created_at DESC").map((row) => ({
    ...row,
    criteria: fromJson(row.criteria, {}),
  }));
  const capability = get(db, "SELECT * FROM capability_autonomy WHERE capability_key = ?", [PILOT_CAPABILITY]);
  return {
    capability,
    limits: { maxFixtures: MAX_REASONING_FIXTURES, maxCostCents: PILOT_COST_CAP_CENTS, maxTurns: 1, maxOutputTokens: 1200, tools: 0 },
    fixtures,
    reviews,
    nextAction: reviews.some((review) => review.operator_verdict === "pending")
      ? "Review the latest Demand Validator result for commercial usefulness."
      : "Prepare the next distinct fixture only after the previous result is reviewed.",
  };
}

module.exports = {
  MAX_REASONING_FIXTURES,
  PILOT_CAPABILITY,
  PILOT_COST_CAP_CENTS,
  createPilotFixture,
  ensureDemandValidatorPilotFixture,
  getPilotState,
  prepareDemandValidatorPilot,
  prepareDemandValidatorPilotRetry,
  recordPilotRunReview,
  reviewPilotRun,
};
