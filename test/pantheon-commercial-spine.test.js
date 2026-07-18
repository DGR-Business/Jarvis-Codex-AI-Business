const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  all,
  fromJson,
  get,
  now,
  openDatabase,
  run,
  seedDatabase,
  toJson,
} = require("../src/db");
const { decideApproval } = require("../src/runtime/approvals");
const { runOnce } = require("../src/runtime/orchestrator");
const {
  getOpportunityState,
  projectCompletedCommercialTask,
  queueCommercialWorker,
  startOpportunityRound,
} = require("../src/runtime/pantheon-opportunities");
const {
  getPantheonSupervisorState,
  runPantheonSupervisorCycle,
} = require("../src/runtime/pantheon-supervisor");
const {
  getRetentionPolicyState,
  prepareRetentionPolicyDecision,
} = require("../src/runtime/retention-policy");

function runtimeDb(name) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `pantheon-commercial-${name}-`));
  const db = openDatabase(path.join(root, "runtime.sqlite"));
  seedDatabase(db);
  return { db, root };
}

function closeRuntime(runtime) {
  runtime.db.close();
  fs.rmSync(runtime.root, { recursive: true, force: true });
}

async function activateRetentionPolicy(db) {
  const pending = all(
    db,
    "SELECT id FROM approvals WHERE status = 'pending' AND scope <> 'data_retention_policy' ORDER BY requested_at",
  );
  for (const approval of pending) {
    decideApproval(db, approval.id, "rejected", "Clear unrelated fixture decisions before activating the isolated test policy.");
  }
  const prepared = prepareRetentionPolicyDecision(db);
  assert.equal(
    prepared.prepared || prepared.state?.status === "waiting_for_decision",
    true,
    prepared.reason || "Retention policy decision was not prepared.",
  );
  let state = getRetentionPolicyState(db);
  if (state.status === "active") return state;
  const approval = get(db, "SELECT * FROM approvals WHERE id = ?", [state.approvalId]);
  assert.ok(approval, "Retention policy approval should exist.");
  decideApproval(db, approval.id, "approved", "Activate the isolated test retention policy.", {
    expectedScopeHash: approval.scope_hash,
  });
  const execution = await runOnce(db, { taskId: approval.task_id });
  assert.equal(execution.status, "completed", execution.error || JSON.stringify(execution));
  state = getRetentionPolicyState(db);
  assert.equal(state.status, "active");
  return state;
}

function commercialTask(db, roundId, step, opportunityId = undefined) {
  const rows = all(
    db,
    `SELECT * FROM tasks
     WHERE kind = 'live_ai_worker_execution'
       AND json_extract(payload, '$.liveSpendRequest.parameters.pantheonCommercial.roundId') = ?
       AND json_extract(payload, '$.liveSpendRequest.parameters.pantheonCommercial.step') = ?
     ORDER BY created_at, id`,
    [roundId, step],
  );
  const row = rows.find((candidate) => {
    if (opportunityId === undefined) return true;
    const payload = fromJson(candidate.payload, {});
    return payload.liveSpendRequest?.parameters?.pantheonCommercial?.opportunityId === opportunityId;
  });
  assert.ok(row, `Expected a ${step} task for round ${roundId}.`);
  return { ...row, payload: fromJson(row.payload, {}), result: fromJson(row.result, {}) };
}

function recordMockWorkerOutput(db, taskId, output) {
  const ts = now();
  run(
    db,
    `UPDATE tasks
     SET status = 'completed', outcome_status = 'known', result = ?, error = NULL,
         completed_at = ?, updated_at = ?
     WHERE id = ?`,
    [toJson({ output }), ts, ts, taskId],
  );
  return get(db, "SELECT * FROM tasks WHERE id = ?", [taskId]);
}

function candidate(title, businessModel, score, options = {}) {
  return {
    title,
    businessModel,
    buyer: options.buyer || `${title} buyers`,
    problem: options.problem || `${title} buyers have a repeated, expensive workflow problem.`,
    offerDirection: options.offerDirection || `${title} product range`,
    geography: options.geography || "Global English-speaking markets",
    language: options.language || "English",
    channel: options.channel || "Evidence-selected online marketplace",
    demandScore: score,
    supplyGapScore: score,
    economicsScore: score,
    channelFitScore: score,
    executionFitScore: score,
    riskScore: 100 - score,
    score,
    confidence: score >= 75 ? "medium" : "low",
    smallestValidation: `Check attributable buyer action for ${title}.`,
    demandEvidence: [`Directional demand evidence for ${title}; not a sales claim.`],
    competitionEvidence: [`Visible competitor supply for ${title}; unit sales remain unknown.`],
    economicsHypothesis: `Positive contribution is possible for ${title} if the stated price and cost assumptions hold.`,
    risks: [`Demand and conversion for ${title} remain unproven.`],
  };
}

function scoutOutput(primaryBusinessModel = "Digital template", options = {}) {
  const primary = candidate(
    options.primaryTitle || "Workflow Control Toolkit",
    primaryBusinessModel,
    92,
    options.primary || {},
  );
  const middle = candidate("Specialist Planning Bundle", "Digital workbook", 74);
  const low = candidate("General Productivity Pack", "Digital download", 51);
  return {
    summary: "Three opportunities were compared using attributable public research; scores are decision aids, not sales facts.",
    recommendation: "Validate the highest-scoring opportunity before committing to product work.",
    nextAction: "Run a bounded demand review of the strongest candidate.",
    operatorDecision: "revise",
    confidence: "medium",
    evidence: ["Public market and competitor sources were consulted."],
    risks: ["Marketplace demand and willingness to pay still require validation."],
    roleOutput: {
      opportunities: options.order || [low, primary, middle],
    },
    toolActivity: [
      {
        id: "search-market",
        type: "web_search",
        status: "completed",
        query: "market demand and competitor evidence",
        sources: [
          {
            title: "Marketplace category evidence",
            url: "https://example.com/market/category",
            publisher: "Example Market",
          },
          {
            title: "Competitor and pricing evidence",
            url: "https://example.com/market/pricing",
            publisher: "Example Research",
          },
        ],
      },
    ],
  };
}

function validatorOutput(decision = "approve", options = {}) {
  return {
    summary: options.summary || (
      decision === "approve"
        ? "Demand evidence is sufficient to check economics, but it does not prove future sales."
        : "The current evidence does not justify further work on this candidate."
    ),
    recommendation: decision === "approve" ? "Continue to a bounded economics review." : "Reject this candidate and validate the next-ranked option.",
    nextAction: decision === "approve" ? "Check full unit economics." : "Move to the next candidate.",
    operatorDecision: decision,
    confidence: options.confidence || "medium",
    evidence: ["Attributable demand and competitor evidence was reviewed."],
    risks: ["Observed listings and searches do not establish paid conversion."],
    pilotRecommendation: {
      evidence: ["Buyers visibly seek comparable outcomes."],
      counterevidence: ["No first-party sales data is available."],
      assumptions: ["Public category evidence reflects the intended buyer."],
      smallestTest: "Measure qualified product views and paid conversions.",
      metric: "Three independent paid buyers with positive net cash contribution.",
      killRule: "Diagnose reach, offer, price, listing, checkout and underlying demand before pausing.",
    },
    toolActivity: [
      {
        id: "search-validation",
        type: "web_search",
        status: "completed",
        query: "buyer demand validation",
        sources: [
          {
            title: "Buyer demand evidence",
            url: "https://example.com/market/demand",
            publisher: "Example Market",
          },
        ],
      },
    ],
  };
}

function financeOutput() {
  return {
    summary: "The offer can produce positive contribution if price, platform fees, refunds, production and acquisition costs remain within the stated bounds.",
    recommendation: "Continue to offer design with all figures labelled as estimates until reconciled.",
    nextAction: "Design the minimum credible offer and catalogue.",
    operatorDecision: "approve",
    confidence: "medium",
    evidence: ["The complete cost stack was considered as an estimate."],
    risks: ["Acquisition cost and refund rate remain unproven."],
    roleOutput: {
      priceRange: "A$19-A$39",
      unitCost: "A$3 estimated platform and fulfilment cost before advertising.",
      fees: "Platform fees remain estimates until platform selection.",
      refundAllowance: "Allow 5% until actual refund evidence exists.",
      acquisitionCostSensitivity: "Positive contribution weakens above A$8 acquisition cost.",
      contributionLogic: "Revenue less refunds, platform, fulfilment, advertising, tools, model usage and attributable costs.",
      breakEven: "At least one sale per A$16 of fully attributable cost at a A$29 price hypothesis.",
      fixedCostAllocation: "Allocate venture-specific tools and model usage; keep ChatGPT subscription separate.",
      killRule: "Do not launch if the realistic contribution case is non-positive.",
    },
  };
}

function offerOutput(options = {}) {
  return {
    summary: "A minimum credible catalogue was designed for the validated buyer and channel; no product files or public actions have occurred.",
    recommendation: "Review the venture choice before any protected build begins.",
    nextAction: "Approve or decline production of the planned catalogue.",
    operatorDecision: "approve",
    confidence: "medium",
    evidence: ["Demand and economics outputs were used to shape the offer."],
    risks: ["The catalogue is a plan, not a completed or sellable product range."],
    roleOutput: {
      buyer: options.buyer || "Operators with a repeated workflow problem",
      offer: options.offer || "A focused toolkit with clear variants",
      channel: options.channel || "Evidence-selected online marketplace",
      price: options.price || "A$29",
      positioning: "Practical, reliable and immediately usable.",
      promise: "Reduce a repeated workflow burden without unsupported outcome claims.",
      objections: ["Trust", "Fit", "Price"],
      catalogueStructure: "Core offer plus evidence-justified variants.",
      productVariants: ["Core", "Starter", "Advanced"],
      buildOrder: ["Core", "Highest-value variants", "Remaining catalogue"],
      testHypothesis: "Qualified buyers will purchase the focused offer at the proposed price.",
      smallestTest: "Launch only after build and quality review, then measure qualified views and sales.",
      successMetric: "Three independent paid buyers and positive net cash contribution.",
      stopRule: "Diagnose reach, offer, value, price, listing and checkout before pausing.",
    },
  };
}

function projectTask(db, task, output) {
  recordMockWorkerOutput(db, task.id, output);
  return projectCompletedCommercialTask(db, task.id);
}

function seedProjectedScoutState(db, roundId, primaryBusinessModel = "Digital template", options = {}) {
  const scoutTask = commercialTask(db, roundId, "opportunity_scout");
  const output = scoutOutput(primaryBusinessModel, {
    primaryTitle: options.primaryTitle,
    primary: options.primary,
  });
  recordMockWorkerOutput(db, scoutTask.id, output);
  const roundRow = get(db, "SELECT * FROM opportunity_rounds WHERE id = ?", [roundId]);
  const roundMetadata = fromJson(roundRow.metadata, {});
  const candidates = output.roleOutput.opportunities;
  const inserted = [];
  const ts = now();
  for (const [index, item] of candidates.entries()) {
    const id = `fixture_opp_${roundId.replace(/[^a-z0-9]/gi, "_")}_${index + 1}`;
    run(
      db,
      `INSERT INTO opportunities
       (id, round_id, venture_id, source_type, status, title, business_model, buyer, problem,
        offer_direction, geography, language, channel, demand_score, supply_gap_score,
        economics_score, channel_fit_score, execution_fit_score, risk_score, overall_score,
        confidence, recommendation, smallest_validation, evidence_ids, metadata, created_at, updated_at)
       VALUES (${Array.from({ length: 27 }, () => "?").join(", ")})`,
      [
        id,
        roundId,
        roundRow.venture_id,
        "mocked_worker_projection",
        "ranked",
        item.title,
        item.businessModel,
        item.buyer,
        item.problem,
        item.offerDirection,
        item.geography,
        item.language,
        item.channel,
        item.demandScore,
        item.supplyGapScore,
        item.economicsScore,
        item.channelFitScore,
        item.executionFitScore,
        item.riskScore,
        item.score,
        item.confidence,
        output.recommendation,
        item.smallestValidation,
        "[]",
        toJson({
          rank: index + 1,
          sourceTaskId: scoutTask.id,
          mockedWorkerProjection: true,
          demandEvidence: item.demandEvidence,
          competitionEvidence: item.competitionEvidence,
          economicsHypothesis: item.economicsHypothesis,
          risks: item.risks,
        }),
        ts,
        ts,
      ],
    );
    inserted.push(get(db, "SELECT * FROM opportunities WHERE id = ?", [id]));
  }
  inserted.sort((left, right) => right.overall_score - left.overall_score);
  const selected = inserted[0];
  run(
    db,
    "UPDATE opportunities SET status = 'selected_for_validation', updated_at = ? WHERE id = ?",
    [ts, selected.id],
  );
  run(
    db,
    `UPDATE opportunity_rounds
     SET status = 'validating', metadata = ?, updated_at = ?
     WHERE id = ?`,
    [
      toJson({
        ...roundMetadata,
        scoutTaskId: scoutTask.id,
        candidateCount: inserted.length,
        selectedOpportunityId: selected.id,
        sourceCount: 0,
        projectedTaskIds: [scoutTask.id],
        mockedWorkerProjection: true,
      }),
      ts,
      roundId,
    ],
  );
  const queued = queueCommercialWorker(db, roundId, "demand_validator", {
    opportunityId: selected.id,
  });
  return { scoutTask, output, opportunities: inserted, selected, queued };
}

async function startRound(db, options = {}) {
  await activateRetentionPolicy(db);
  return startOpportunityRound(db, {
    prompt: options.prompt || "Find commercially viable online ventures Pantheon can execute.",
    source: "pantheon-commercial-spine-test",
    force: options.force === true,
  });
}

async function driveRoundToOffer(db, businessModel, options = {}) {
  const started = await startRound(db, {
    prompt: `Evaluate a ${businessModel} venture.`,
    force: options.force === true,
  });
  const roundId = started.round.id;
  const seededScout = seedProjectedScoutState(db, roundId, businessModel, {
    primaryTitle: options.title || `${businessModel} Opportunity`,
    primary: options.primary || {},
  });
  const scoutTask = seededScout.scoutTask;
  const scoutProjection = { projected: true, fixtureBoundary: true };
  const selected = seededScout.selected;
  assert.ok(selected, "Scout projection should select the highest-scoring opportunity.");
  const validatorTask = commercialTask(db, roundId, "demand_validator", selected.id);
  const validatorProjection = projectTask(db, validatorTask, validatorOutput("approve"));
  const financeTask = commercialTask(db, roundId, "finance_analysis", selected.id);
  const financeProjection = projectTask(db, financeTask, financeOutput());
  const offerTask = commercialTask(db, roundId, "offer_architecture", selected.id);
  const deliverablesBeforeOffer = Number(get(db, "SELECT COUNT(*) AS count FROM deliverables").count);
  const offerProjection = projectTask(db, offerTask, offerOutput());
  return {
    started,
    roundId,
    selected,
    scoutTask,
    scoutProjection,
    validatorTask,
    validatorProjection,
    financeTask,
    financeProjection,
    offerTask,
    offerProjection,
    deliverablesBeforeOffer,
  };
}

test("broad discovery creates one mandate-authorized internal research task without a provider call", async () => {
  const runtime = runtimeDb("broad-round-authorization");
  try {
    const started = await startRound(runtime.db);
    assert.equal(started.alreadyRunning, false);
    assert.equal(started.round.mode, "broad_discovery");
    assert.equal(started.round.status, "researching");
    assert.equal(started.round.venture_id, "venture-digital-products");
    assert.equal(started.queued.task.agent, "opportunity_scout");
    assert.equal(started.queued.mandate.approved, true);

    const approval = get(runtime.db, "SELECT * FROM approvals WHERE id = ?", [started.queued.approval.id]);
    assert.equal(approval.status, "approved");
    assert.equal(approval.consumed_at, null);
    const approvalEvent = get(
      runtime.db,
      "SELECT * FROM events WHERE entity_type = 'approval' AND entity_id = ? AND type = 'approval.approved'",
      [approval.id],
    );
    assert.equal(approvalEvent.actor, "pantheon_operating_mandate");
    assert.equal(fromJson(approvalEvent.metadata, {}).decidedBy, "pantheon_operating_mandate");
    assert.equal(get(runtime.db, "SELECT COUNT(*) AS count FROM model_calls").count, 0);
    assert.equal(get(runtime.db, "SELECT COUNT(*) AS count FROM agent_runs").count, 0);
    assert.equal(get(runtime.db, "SELECT COUNT(*) AS count FROM opportunities").count, 0);
    assert.equal(get(runtime.db, "SELECT COUNT(*) AS count FROM commercial_results").count, 0);
  } finally {
    closeRuntime(runtime);
  }
});

test("scout projection ranks opportunities, preserves evidence provenance and is idempotent", async () => {
  const runtime = runtimeDb("broad-round");
  try {
    const started = await startRound(runtime.db);
    assert.equal(started.alreadyRunning, false);
    assert.equal(started.round.mode, "broad_discovery");
    assert.equal(started.round.status, "researching");
    assert.equal(started.round.venture_id, "venture-digital-products");
    assert.equal(started.queued.task.agent, "opportunity_scout");
    assert.equal(started.queued.mandate.approved, true);

    const approval = get(runtime.db, "SELECT * FROM approvals WHERE id = ?", [started.queued.approval.id]);
    assert.equal(approval.status, "approved");
    assert.equal(approval.consumed_at, null);
    const approvalEvent = get(
      runtime.db,
      "SELECT * FROM events WHERE entity_type = 'approval' AND entity_id = ? AND type = 'approval.approved'",
      [approval.id],
    );
    assert.equal(approvalEvent.actor, "pantheon_operating_mandate");
    assert.equal(fromJson(approvalEvent.metadata, {}).decidedBy, "pantheon_operating_mandate");
    assert.equal(get(runtime.db, "SELECT COUNT(*) AS count FROM model_calls").count, 0);
    assert.equal(get(runtime.db, "SELECT COUNT(*) AS count FROM agent_runs").count, 0);

    const task = commercialTask(runtime.db, started.round.id, "opportunity_scout");
    const projection = projectTask(runtime.db, task, scoutOutput());
    assert.equal(projection.projected, true);
    assert.equal(projection.step, "opportunity_scout");

    const opportunities = all(
      runtime.db,
      "SELECT * FROM opportunities WHERE round_id = ? ORDER BY overall_score DESC",
      [started.round.id],
    );
    assert.equal(opportunities.length, 3);
    assert.equal(opportunities[0].title, "Workflow Control Toolkit");
    assert.equal(opportunities[0].status, "selected_for_validation");
    assert.ok(opportunities[0].overall_score > opportunities[1].overall_score);
    assert.ok(opportunities[1].overall_score > opportunities[2].overall_score);

    const evidence = all(
      runtime.db,
      "SELECT * FROM commercial_evidence WHERE venture_id = ? ORDER BY source_url",
      [started.round.venture_id],
    );
    assert.equal(evidence.length, 2);
    assert.deepEqual(
      evidence.map((item) => item.source_url),
      ["https://example.com/market/category", "https://example.com/market/pricing"],
    );
    assert.ok(evidence.every((item) => item.source_type === "source_link"));
    assert.ok(evidence.every((item) => Boolean(item.verified_at)));
    assert.ok(evidence.every((item) => item.extraction_method === "OpenAI Agents SDK web search"));
    assert.ok(evidence.every((item) => fromJson(item.metadata, {}).providerCaptured === true));
    assert.ok(evidence.every((item) => /claim_requires_review/.test(item.confidence)));

    const nextTask = commercialTask(
      runtime.db,
      started.round.id,
      "demand_validator",
      opportunities[0].id,
    );
    const nextApproval = get(runtime.db, "SELECT * FROM approvals WHERE id = ?", [nextTask.approval_id]);
    assert.equal(nextApproval.status, "approved");
    const nextApprovalEvent = get(
      runtime.db,
      "SELECT * FROM events WHERE entity_type = 'approval' AND entity_id = ? AND type = 'approval.approved'",
      [nextApproval.id],
    );
    assert.equal(nextApprovalEvent.actor, "pantheon_operating_mandate");
    assert.equal(fromJson(nextApprovalEvent.metadata, {}).decidedBy, "pantheon_operating_mandate");

    const countsBeforeReplay = {
      opportunities: get(runtime.db, "SELECT COUNT(*) AS count FROM opportunities WHERE round_id = ?", [started.round.id]).count,
      evidence: get(runtime.db, "SELECT COUNT(*) AS count FROM commercial_evidence WHERE venture_id = ?", [started.round.venture_id]).count,
      validatorTasks: get(
        runtime.db,
        `SELECT COUNT(*) AS count FROM tasks
         WHERE json_extract(payload, '$.liveSpendRequest.parameters.pantheonCommercial.roundId') = ?
           AND json_extract(payload, '$.liveSpendRequest.parameters.pantheonCommercial.step') = 'demand_validator'`,
        [started.round.id],
      ).count,
    };
    const replay = projectCompletedCommercialTask(runtime.db, task.id);
    assert.equal(replay.projected, false);
    assert.equal(replay.reason, "already_projected");
    assert.deepEqual(
      {
        opportunities: get(runtime.db, "SELECT COUNT(*) AS count FROM opportunities WHERE round_id = ?", [started.round.id]).count,
        evidence: get(runtime.db, "SELECT COUNT(*) AS count FROM commercial_evidence WHERE venture_id = ?", [started.round.venture_id]).count,
        validatorTasks: get(
          runtime.db,
          `SELECT COUNT(*) AS count FROM tasks
           WHERE json_extract(payload, '$.liveSpendRequest.parameters.pantheonCommercial.roundId') = ?
             AND json_extract(payload, '$.liveSpendRequest.parameters.pantheonCommercial.step') = 'demand_validator'`,
          [started.round.id],
        ).count,
      },
      countsBeforeReplay,
    );
  } finally {
    closeRuntime(runtime);
  }
});

test("rejected validation falls back to the next candidate and finance queues offer work", async () => {
  const runtime = runtimeDb("fallback-and-offer");
  try {
    const started = await startRound(runtime.db);
    const roundId = started.round.id;
    const seededScout = seedProjectedScoutState(runtime.db, roundId);
    const first = seededScout.selected;
    assert.equal(first.title, "Workflow Control Toolkit");
    const firstValidator = commercialTask(runtime.db, roundId, "demand_validator", first.id);
    const fallbackProjection = projectTask(runtime.db, firstValidator, validatorOutput("deny"));
    assert.equal(fallbackProjection.projected, true);
    assert.equal(get(runtime.db, "SELECT status FROM opportunities WHERE id = ?", [first.id]).status, "rejected");
    const validatorTaskCount = get(
      runtime.db,
      `SELECT COUNT(*) AS count FROM tasks
       WHERE json_extract(payload, '$.liveSpendRequest.parameters.pantheonCommercial.roundId') = ?
         AND json_extract(payload, '$.liveSpendRequest.parameters.pantheonCommercial.step') = 'demand_validator'`,
      [roundId],
    ).count;
    const validatorReplay = projectCompletedCommercialTask(runtime.db, firstValidator.id);
    assert.equal(validatorReplay.projected, false);
    assert.equal(validatorReplay.reason, "already_projected");
    assert.equal(
      get(
        runtime.db,
        `SELECT COUNT(*) AS count FROM tasks
         WHERE json_extract(payload, '$.liveSpendRequest.parameters.pantheonCommercial.roundId') = ?
           AND json_extract(payload, '$.liveSpendRequest.parameters.pantheonCommercial.step') = 'demand_validator'`,
        [roundId],
      ).count,
      validatorTaskCount,
    );

    const second = get(
      runtime.db,
      "SELECT * FROM opportunities WHERE round_id = ? AND status = 'selected_for_validation'",
      [roundId],
    );
    assert.equal(second.title, "Specialist Planning Bundle");
    assert.ok(second.overall_score < first.overall_score);
    const secondValidator = commercialTask(runtime.db, roundId, "demand_validator", second.id);
    projectTask(runtime.db, secondValidator, validatorOutput("approve"));

    const financeTask = commercialTask(runtime.db, roundId, "finance_analysis", second.id);
    const financeProjection = projectTask(runtime.db, financeTask, financeOutput());
    assert.equal(financeProjection.projected, true);
    const afterFinance = {
      ...get(runtime.db, "SELECT * FROM opportunities WHERE id = ?", [second.id]),
      metadata: fromJson(get(runtime.db, "SELECT metadata FROM opportunities WHERE id = ?", [second.id]).metadata, {}),
    };
    assert.equal(afterFinance.metadata.finance.confidence, "medium");
    assert.match(afterFinance.metadata.finance.work.contributionLogic, /model usage/i);

    const offerTask = commercialTask(runtime.db, roundId, "offer_architecture", second.id);
    const financeReplay = projectCompletedCommercialTask(runtime.db, financeTask.id);
    assert.equal(financeReplay.projected, false);
    assert.equal(financeReplay.reason, "already_projected");
    assert.equal(
      get(
        runtime.db,
        `SELECT COUNT(*) AS count FROM tasks
         WHERE json_extract(payload, '$.liveSpendRequest.parameters.pantheonCommercial.roundId') = ?
           AND json_extract(payload, '$.liveSpendRequest.parameters.pantheonCommercial.step') = 'offer_architecture'`,
        [roundId],
      ).count,
      1,
    );
    assert.equal(offerTask.status, "queued");
    assert.equal(get(runtime.db, "SELECT status FROM approvals WHERE id = ?", [offerTask.approval_id]).status, "approved");
    assert.equal(get(runtime.db, "SELECT status FROM opportunity_rounds WHERE id = ?", [roundId]).status, "structuring_offer");
    assert.equal(get(runtime.db, "SELECT COUNT(*) AS count FROM catalogue_plans WHERE opportunity_id = ?", [second.id]).count, 0);
    assert.equal(get(runtime.db, "SELECT COUNT(*) AS count FROM commercial_results WHERE venture_id = ?", [second.venture_id]).count, 0);
    assert.equal(get(runtime.db, "SELECT COUNT(*) AS count FROM commercial_learning_cycles").count, 0);
  } finally {
    closeRuntime(runtime);
  }
});

test("catalogue breadth follows the venture type without claiming finished products", async () => {
  const cases = [
    { businessModel: "Print on demand apparel", expected: 12, planStatus: "requires_capability", buildStatus: "requires_capability" },
    { businessModel: "Digital art collection", expected: 8, planStatus: "requires_capability", buildStatus: "requires_capability" },
    { businessModel: "Affiliate content commerce", expected: 10, planStatus: "waiting_for_build_decision", buildStatus: "waiting_for_build_decision" },
    { businessModel: "Amazon white label product", expected: 3, planStatus: "requires_capability", buildStatus: "requires_capability" },
    { businessModel: "Digital course and guide", expected: 4, planStatus: "waiting_for_build_decision", buildStatus: "waiting_for_build_decision" },
    { businessModel: "Digital spreadsheet template", expected: 5, planStatus: "waiting_for_build_decision", buildStatus: "waiting_for_build_decision" },
  ];

  for (const [index, item] of cases.entries()) {
    const runtime = runtimeDb(`catalogue-${index}`);
    try {
      const driven = await driveRoundToOffer(runtime.db, item.businessModel);
      const plan = {
        ...get(runtime.db, "SELECT * FROM catalogue_plans WHERE opportunity_id = ?", [driven.selected.id]),
        metadata: fromJson(
          get(runtime.db, "SELECT metadata FROM catalogue_plans WHERE opportunity_id = ?", [driven.selected.id]).metadata,
          {},
        ),
      };
      const catalogueItems = all(runtime.db, "SELECT * FROM catalogue_items WHERE plan_id = ?", [plan.id]);
      assert.equal(plan.target_item_count, item.expected, item.businessModel);
      assert.equal(catalogueItems.length, item.expected, item.businessModel);
      assert.equal(plan.status, item.planStatus, item.businessModel);
      assert.equal(plan.metadata.buildStatus, item.buildStatus, item.businessModel);
      assert.equal(plan.metadata.noSellableFilesClaimed, true, item.businessModel);
      assert.ok(catalogueItems.every((row) => row.status === "planned"), item.businessModel);
      assert.equal(
        get(runtime.db, "SELECT COUNT(*) AS count FROM deliverables").count,
        driven.deliverablesBeforeOffer,
        item.businessModel,
      );
    } finally {
      closeRuntime(runtime);
    }
  }
});

test("supervisor stops at idle, setup, attention and active-cycle boundaries", async () => {
  const idleRuntime = runtimeDb("supervisor-idle");
  try {
    await activateRetentionPolicy(idleRuntime.db);
    const idle = await runPantheonSupervisorCycle(idleRuntime.db, {
      triggerType: "test",
      startedBy: "pantheon-commercial-spine-test",
      allowDiscoveryStart: false,
    });
    assert.equal(idle.status, "idle");
    assert.equal(idle.cycle.id, null);
    assert.equal(idle.cycle.next_action_type, "await_next_trigger");
    assert.equal(get(idleRuntime.db, "SELECT COUNT(*) AS count FROM opportunity_rounds").count, 0);
    assert.equal(get(idleRuntime.db, "SELECT COUNT(*) AS count FROM supervisor_cycles").count, 0);
    await runPantheonSupervisorCycle(idleRuntime.db, {
      triggerType: "test",
      startedBy: "pantheon-commercial-spine-test",
      allowDiscoveryStart: false,
    });
    assert.equal(get(idleRuntime.db, "SELECT COUNT(*) AS count FROM supervisor_cycles").count, 0);
    assert.equal(getPantheonSupervisorState(idleRuntime.db).current, null);

    const ts = now();
    run(
      idleRuntime.db,
      `INSERT INTO supervisor_cycles
       (id, trigger_type, status, summary, started_at, metadata, created_at, updated_at)
       VALUES ('cycle-held-by-another-runner', 'test', 'running', '', ?, '{}', ?, ?)`,
      [ts, ts, ts],
    );
    const alreadyRunning = await runPantheonSupervisorCycle(idleRuntime.db, {
      triggerType: "test",
      startedBy: "second-runner",
    });
    assert.equal(alreadyRunning.status, "already_running");
    assert.equal(alreadyRunning.cycle.id, "cycle-held-by-another-runner");
  } finally {
    closeRuntime(idleRuntime);
  }

  const setupRuntime = runtimeDb("supervisor-setup");
  try {
    const started = startOpportunityRound(setupRuntime.db, {
      prompt: "Find a setup-bound opportunity.",
      source: "pantheon-commercial-spine-test",
    });
    const task = commercialTask(setupRuntime.db, started.round.id, "opportunity_scout");
    assert.equal(task.status, "blocked");
    assert.equal(task.approval_id, null);
    assert.ok(task.setup_block_reason);
    const waiting = await runPantheonSupervisorCycle(setupRuntime.db, {
      triggerType: "test",
      startedBy: "pantheon-commercial-spine-test",
    });
    assert.equal(waiting.status, "waiting_for_operator");
    assert.equal(waiting.cycle.next_action_type, "complete_required_setup");
    assert.match(waiting.cycle.summary, /retention|protection|setup|prerequisite/i);
  } finally {
    closeRuntime(setupRuntime);
  }

  const attentionRuntime = runtimeDb("supervisor-attention");
  try {
    const started = await startRound(attentionRuntime.db);
    const task = commercialTask(attentionRuntime.db, started.round.id, "opportunity_scout");
    run(
      attentionRuntime.db,
      "UPDATE tasks SET status = 'needs_attention', error = ?, updated_at = ? WHERE id = ?",
      ["Mocked worker quality check failed.", now(), task.id],
    );
    const attention = await runPantheonSupervisorCycle(attentionRuntime.db, {
      triggerType: "test",
      startedBy: "pantheon-commercial-spine-test",
    });
    assert.equal(attention.status, "needs_attention");
    assert.equal(attention.cycle.next_action_type, "review_failed_internal_work");
    assert.equal(attention.cycle.summary, "Mocked worker quality check failed.");
    assert.equal(attention.cycle.task_id, task.id);
  } finally {
    closeRuntime(attentionRuntime);
  }
});
