const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const retrievalCases = require("../config/commercial-retrieval-eval-v1");
const { all, fromJson, get, now, openDatabase, run, seedDatabase, toJson } = require("../src/db");
const { buildAgentContextSnapshot } = require("../src/runtime/agent-context");
const {
  commercialKnowledgeState,
  createCommercialContextProvider,
  ensureCommercialKnowledge,
  searchCommercialKnowledge,
} = require("../src/runtime/commercial-knowledge");
const {
  assessInvestmentCase,
  createCommercialInvestmentReview,
  getInvestmentCase,
} = require("../src/runtime/commercial-investment-review");
const { createResearchSourceAdapter } = require("../src/adapters/research");
const {
  getOpportunityState,
  projectCompletedCommercialTask,
} = require("../src/runtime/pantheon-opportunities");
const {
  ensurePortfolioController,
  getPortfolioState,
  parkJobSearchProduct,
  startPortfolioDiscovery,
  startTargetedInvestmentReview,
} = require("../src/runtime/portfolio-controller");
const { currentOperatorJourney } = require("../src/runtime/pantheon-journey");
const { getProductionState } = require("../src/runtime/pantheon-production");
const {
  approveServiceTrialWithinMandate,
  completeServiceTrial,
  createServiceTrialEvaluator,
  decideServiceRetention,
  proposeServiceTrial,
  startServiceTrial,
} = require("../src/runtime/service-trials");
const {
  createVentureKitRegistry,
  ensureVentureKitRegistry,
  selectVentureKit,
} = require("../src/runtime/venture-kit-registry");
const {
  createRuntimeSupervisor,
  markEmergencyStopUnknown,
} = require("../src/runtime/runtime-supervisor");
const { markPortfolioAttention } = require("../src/runtime/pantheon-supervisor");

function runtimeDb(name) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `pantheon-commercial-intelligence-${name}-`));
  const db = openDatabase(path.join(root, "runtime.sqlite"));
  seedDatabase(db);
  return { db, root };
}

function closeRuntime(runtime) {
  runtime.db.close();
  fs.rmSync(runtime.root, { recursive: true, force: true });
}

function commercialTask(db, roundId, step) {
  const task = get(
    db,
    `SELECT * FROM tasks
     WHERE kind = 'live_ai_worker_execution'
       AND json_extract(payload, '$.liveSpendRequest.parameters.pantheonCommercial.roundId') = ?
       AND json_extract(payload, '$.liveSpendRequest.parameters.pantheonCommercial.step') = ?
       AND status <> 'completed'
     ORDER BY created_at ASC LIMIT 1`,
    [roundId, step],
  );
  assert.ok(task, `Expected a pending ${step} task.`);
  return { ...task, payload: fromJson(task.payload, {}) };
}

function completeTask(db, taskId, output) {
  const timestamp = now();
  run(
    db,
    `UPDATE tasks
     SET status = 'completed', outcome_status = 'known', result = ?,
         completed_at = ?, updated_at = ?
     WHERE id = ?`,
    [toJson({ output }), timestamp, timestamp, taskId],
  );
  return projectCompletedCommercialTask(db, taskId);
}

function candidate(index) {
  return {
    title: `Opportunity ${index}`,
    businessModel: index === 1 ? "digital product" : index === 2 ? "print on demand" : index === 3 ? "affiliate publishing" : index === 4 ? "white label" : "online service",
    buyer: `Specific buyer segment ${index}`,
    problem: `A costly recurring workflow problem for buyer segment ${index}`,
    offerDirection: `A focused offer that resolves the recurring problem for segment ${index}`,
    geography: "Australia",
    language: "English",
    channel: index === 1 ? "Etsy and owned website" : `Evidence-selected channel ${index}`,
    demandEvidence: [
      `${index * 10} paid orders were reported in an attributable marketplace sample`,
      `${index * 20} verified customer reviews describe the recurring problem`,
    ],
    competitionEvidence: [
      `Direct competitor ${index}A at a recorded price`,
      `Direct competitor ${index}B with a substitute offer`,
      `Adjacent alternative ${index}C used by the same buyer`,
    ],
    economicsHypothesis: `A$39 price with estimated A$12 attributable variable cost`,
    smallestValidation: `Run a bounded paid-intent test with a defined buyer and checkout signal for opportunity ${index}.`,
    risks: ["Entrenched competitor response", "Channel acquisition cost uncertainty"],
    demandScore: 82 - index,
    supplyGapScore: 74 - index,
    economicsScore: 78 - index,
    channelFitScore: 76 - index,
    executionFitScore: 80 - index,
    riskScore: 28 + index,
    score: 80 - index,
    confidence: "medium",
  };
}

function sourceActivity(index) {
  return [{
    sources: [
      { url: `https://example.com/market-${index}-a`, title: `Market source ${index}A`, publisher: "Example marketplace" },
      { url: `https://example.org/market-${index}-b`, title: `Market source ${index}B`, publisher: "Example industry source" },
    ],
  }];
}

test("commercial library seeds 60 reviewed propositions and passes the 20-case retrieval evaluation", () => {
  const runtime = runtimeDb("knowledge");
  try {
    ensureCommercialKnowledge(runtime.db);
    const state = commercialKnowledgeState(runtime.db);
    assert.equal(state.propositionCount, 60);
    assert.ok(state.sourceCount >= 15);
    const domainCounts = new Map(state.byClassAndDomain.map((row) => [row.domain, row.count]));
    assert.equal(domainCounts.size, 12);
    for (const count of domainCounts.values()) assert.ok(count >= 5);

    let passes = 0;
    for (const fixture of retrievalCases) {
      const results = searchCommercialKnowledge(runtime.db, {
        query: fixture.query,
        domains: [fixture.domain],
        jurisdiction: fixture.jurisdiction || "Australia",
        limit: 5,
      });
      const ids = results.map((item) => item.id);
      if (fixture.expected.some((id) => ids.includes(id))) passes += 1;
      for (const item of results) {
        assert.ok(item.source.url.startsWith("https://"));
        assert.ok(item.limitations);
      }
    }
    assert.ok(passes >= 18, `Commercial retrieval passed ${passes}/20 cases.`);
  } finally {
    closeRuntime(runtime);
  }
});

test("agent context receives only a focused cited commercial brief", () => {
  const runtime = runtimeDb("context");
  try {
    ensureCommercialKnowledge(runtime.db);
    run(
      runtime.db,
      `INSERT INTO workflows
       (id, venture_id, type, title, status, current_step, priority, metadata, created_at, updated_at)
       VALUES ('wf-commercial-context', 'venture-digital-products', 'commercial_review',
         'Commercial context', 'planned', '', 1, '{}', ?, ?)`,
      [now(), now()],
    );
    run(
      runtime.db,
      `INSERT INTO tasks
       (id, workflow_id, venture_id, title, kind, agent, status, priority,
        cost_budget_cents, payload, result, created_at, updated_at)
       VALUES ('task-commercial-context', 'wf-commercial-context', 'venture-digital-products',
         'Review pricing and channel economics', 'commercial_analysis', 'finance_analyst',
         'queued', 1, 0, '{}', '{}', ?, ?)`,
      [now(), now()],
    );
    const snapshot = buildAgentContextSnapshot(runtime.db, {
      ventureId: "venture-digital-products",
      workflowId: "wf-commercial-context",
      taskId: "task-commercial-context",
      agentId: "finance_analyst",
      purpose: "Review price, full costs, contribution, break-even, cash timing, and downside.",
      buyer: "Australian sole traders",
      problem: "Unclear product economics",
      channel: "Marketplace and owned website",
    });
    assert.ok(snapshot.commercialKnowledge.recordCount > 0);
    assert.ok(snapshot.commercialKnowledge.recordCount <= 8);
    assert.ok(snapshot.commercialKnowledge.records.every((item) => item.source.url));
    assert.equal(snapshot.dataPolicy.commercialDoctrineIsNotMarketEvidence, true);
  } finally {
    closeRuntime(runtime);
  }
});

test("commercial gates reject search-interest theatre and a hardcoded channel", () => {
  const runtime = runtimeDb("gates");
  try {
    ensureVentureKitRegistry(runtime.db);
    const timestamp = now();
    run(
      runtime.db,
      `INSERT INTO opportunity_rounds
       (id, venture_id, status, mode, prompt, geography, language, max_candidates,
        started_at, created_by, metadata, created_at, updated_at)
       VALUES ('round-weak-case', 'venture-digital-products', 'checking_economics',
         'portfolio_discovery', 'Find demand', 'global', 'English', 5, ?,
         'test', ?, ?, ?)`,
      [timestamp, toJson({ validationCompletedIds: ["opp-weak", "opp-alt-1", "opp-alt-2"] }), timestamp, timestamp],
    );
    for (const [id, title, score] of [
      ["opp-weak", "Weak search trend", 90],
      ["opp-alt-1", "Alternative one", 70],
      ["opp-alt-2", "Alternative two", 60],
    ]) {
      run(
        runtime.db,
        `INSERT INTO opportunities
         (id, round_id, venture_id, source_type, status, title, business_model, buyer,
          problem, offer_direction, geography, language, channel, overall_score,
          confidence, recommendation, smallest_validation, evidence_ids, metadata,
          created_at, updated_at)
         VALUES (?, 'round-weak-case', 'venture-digital-products', 'model_inference',
          'ranked', ?, 'digital_product', 'Everyone', 'People search for jobs',
          'A generic tracker', 'global', 'English', 'Gumroad', ?, 'low', '',
          'Post a link', '[]', ?, ?, ?)`,
        [
          id,
          title,
          score,
          toJson({
            demandEvidence: ["Search interest appears high"],
            competitionEvidence: ["LinkedIn exists"],
            validation: { priceChannelHypothesis: "Use Gumroad because it is already configured." },
          }),
          timestamp,
          timestamp,
        ],
      );
    }
    const assessment = assessInvestmentCase(runtime.db, "opp-weak");
    assert.equal(assessment.criteria.direct_demand.passed, false);
    assert.equal(assessment.criteria.economics.passed, false);
    assert.equal(assessment.criteria.distribution.passed, false);
    assert.notEqual(assessment.recommendation, "advance");
  } finally {
    closeRuntime(runtime);
  }
});

test("service trials require a baseline, stay under A$25, and retain only after measured benefit", () => {
  const runtime = runtimeDb("service-trial");
  try {
    assert.throws(() => proposeServiceTrial(runtime.db, {
      serviceName: "Unsupported service",
      vendor: "Vendor",
      hypothesis: "This may improve market evidence quality.",
      capCents: 2600,
      baseline: { method: "public sources", decisionGap: "volume", usefulFindings: 2 },
      retentionThresholds: {
        minimumUsefulFindings: 3,
        maximumCostPerUsefulFindingCents: 500,
        minimumEvidenceQualityImprovement: 20,
      },
    }), /A\$25/);

    const trial = proposeServiceTrial(runtime.db, {
      serviceName: "Research data trial",
      vendor: "Evidence Vendor",
      hypothesis: "The service will close a transaction-volume gap more reliably than public sources.",
      capCents: 2000,
      baseline: { method: "public sources", decisionGap: "transaction volume", usefulFindings: 2 },
      retentionThresholds: {
        minimumUsefulFindings: 3,
        maximumCostPerUsefulFindingCents: 500,
        minimumEvidenceQualityImprovement: 20,
      },
    });
    assert.equal(approveServiceTrialWithinMandate(runtime.db, trial.id).reason, "daniel_setup_required");
    assert.equal(approveServiceTrialWithinMandate(runtime.db, trial.id, { protectedSetupComplete: true }).approved, true);
    startServiceTrial(runtime.db, trial.id);
    const completed = completeServiceTrial(runtime.db, trial.id, {
      usefulFindings: 5,
      evidenceQualityImprovement: 35,
      actualCostCents: 1500,
      decisionGapClosed: true,
      baselineComparison: "Five attributable findings versus two from the public baseline.",
    });
    assert.equal(completed.decision, "retain");
    assert.equal(decideServiceRetention(runtime.db, trial.id, { decision: "retain" }).reason, "delegation_required");
    assert.equal(decideServiceRetention(runtime.db, trial.id, {
      decision: "retain",
      delegatedVendorCapability: true,
      renewalAt: "2026-08-27",
    }).decided, true);
  } finally {
    closeRuntime(runtime);
  }
});

test("venture-kit readiness does not decide commercial merit", () => {
  const runtime = runtimeDb("venture-kits");
  try {
    ensureVentureKitRegistry(runtime.db);
    const digital = selectVentureKit(runtime.db, {
      title: "Finance spreadsheet toolkit",
      business_model: "digital_product",
      offer_direction: "Excel templates and trackers",
    });
    const whiteLabel = selectVentureKit(runtime.db, {
      title: "White-label household product",
      business_model: "white_label",
      offer_direction: "Physical marketplace range",
    });
    const physicalBundle = selectVentureKit(runtime.db, {
      title: "Private-label desk-organisation accessory bundle",
      business_model: "white label physical ecommerce",
      offer_direction: "A coordinated physical bundle fulfilled by a supplier",
    });
    const productizedService = selectVentureKit(runtime.db, {
      title: "Freelancer onboarding toolkit service",
      business_model: "productized remote service",
      offer_direction: "A fixed-scope consulting and implementation service",
    });
    assert.equal(digital.buildableNow, true);
    assert.equal(digital.selected.kitId, "digital_product_v1");
    assert.equal(whiteLabel.buildableNow, false);
    assert.equal(physicalBundle.buildableNow, false);
    assert.equal(productizedService.buildableNow, false);
    assert.match(whiteLabel.instruction, /do not build/i);
  } finally {
    closeRuntime(runtime);
  }
});

test("commercial and lifecycle contracts are executable and emergency stop preserves unknown provider outcomes", () => {
  const runtime = runtimeDb("contracts");
  try {
    assert.equal(createCommercialContextProvider(runtime.db).contract, "CommercialContextProvider.v1");
    assert.equal(createCommercialInvestmentReview(runtime.db).contract, "CommercialInvestmentReview.v1");
    assert.equal(createResearchSourceAdapter(runtime.db, { live: false }).contract, "ResearchSourceAdapter.v1");
    assert.equal(createServiceTrialEvaluator(runtime.db).contract, "ServiceTrialEvaluator.v1");
    assert.equal(createVentureKitRegistry(runtime.db).contract, "VentureKitRegistry.v1");
    const supervisor = createRuntimeSupervisor(runtime.db);
    assert.equal(supervisor.contract, "RuntimeSupervisor.v1");

    const timestamp = now();
    run(
      runtime.db,
      `INSERT INTO workflows
       (id, venture_id, type, title, status, current_step, priority, metadata, created_at, updated_at)
       VALUES ('wf-runtime-emergency-proof', 'venture-digital-products', 'runtime_proof',
               'Runtime emergency proof', 'running', 'provider_call', 1, '{}', ?, ?)`,
      [timestamp, timestamp],
    );
    run(
      runtime.db,
      `INSERT INTO tasks
       (id, workflow_id, venture_id, title, kind, agent, status, priority,
        payload, result, outcome_status, started_at, created_at, updated_at)
       VALUES ('task-runtime-emergency-proof', 'wf-runtime-emergency-proof',
               'venture-digital-products', 'Provider call in progress',
               'live_ai_worker_execution', 'demand_validator', 'running', 1,
               '{}', '{}', 'running', ?, ?, ?)`,
      [timestamp, timestamp, timestamp],
    );
    run(
      runtime.db,
      `INSERT INTO task_attempts
       (id, task_id, workflow_id, venture_id, claim_token, status,
        outcome_status, provider_request_id, started_at, metadata)
       VALUES ('attempt-runtime-emergency-proof', 'task-runtime-emergency-proof',
               'wf-runtime-emergency-proof', 'venture-digital-products',
               'claim-runtime-emergency-proof', 'running', 'running',
               'provider-request-proof', ?, '{}')`,
      [timestamp],
    );
    run(
      runtime.db,
      `INSERT INTO model_calls
       (id, workflow_id, task_id, provider, model_class, selected_model, mode,
        status, input_tokens, output_tokens, estimated_cost_cents,
        actual_cost_cents, approval_required, metadata, created_at,
        provider_request_id, cost_status, outcome_status)
       VALUES ('call-runtime-emergency-proof', 'wf-runtime-emergency-proof',
               'task-runtime-emergency-proof', 'openai', 'terra', 'gpt-5.6-terra',
               'live', 'running', 0, 0, 100, 0, 1, '{}', ?,
               'provider-request-proof', 'reserved', 'running')`,
      [timestamp],
    );

    assert.equal(supervisor.activeWork().length, 1);
    assert.deepEqual(markEmergencyStopUnknown(runtime.db), {
      affectedTasks: 1,
      providerOutcomesUnknown: 1,
    });
    assert.equal(get(runtime.db, "SELECT outcome_status FROM tasks WHERE id = 'task-runtime-emergency-proof'").outcome_status, "unknown");
    assert.equal(get(runtime.db, "SELECT cost_status FROM model_calls WHERE id = 'call-runtime-emergency-proof'").cost_status, "unknown");
  } finally {
    closeRuntime(runtime);
  }
});

test("Portfolio Controller completes five-space discovery, three comparisons, finance, and final review without production", () => {
  const runtime = runtimeDb("portfolio-journey");
  try {
    ensurePortfolioController(runtime.db);
    const started = startPortfolioDiscovery(runtime.db);
    assert.equal(started.started, true);
    const roundId = started.round.id;
    assert.equal(started.round.venture_id, "venture-portfolio-controller");

    const scout = commercialTask(runtime.db, roundId, "opportunity_scout");
    completeTask(runtime.db, scout.id, {
      summary: "Five opportunity spaces were compared.",
      recommendation: "Validate the top three.",
      confidence: "medium",
      roleOutput: { opportunities: [1, 2, 3, 4, 5].map(candidate) },
      toolActivity: sourceActivity("scout"),
    });

    for (let index = 1; index <= 3; index += 1) {
      const validator = commercialTask(runtime.db, roundId, "demand_validator");
      completeTask(runtime.db, validator.id, {
        summary: `Opportunity ${index} has attributable buyer and purchase signals.`,
        operatorDecision: "revise",
        confidence: "medium",
        pilotRecommendation: {
          verdict: "revise",
          evidence: [
            `${index * 10} paid orders were observed in the marketplace sample`,
            `${index * 20} verified customer reviews describe the buyer problem`,
          ],
          counterevidence: ["The sample does not reveal total market revenue."],
          assumptions: ["Public observations may not equal realised seller economics."],
          smallestTest: `Run a 14-day paid-intent test for opportunity ${index} with a real checkout signal and no public automation.`,
          metric: "At least three independent paid buyers with positive net cash contribution.",
          killRule: "Stop after the defined qualified exposure with zero sales and no strong buyer evidence.",
          priceChannelHypothesis: `Test A$39 through the evidence-selected channel for opportunity ${index}.`,
        },
        toolActivity: sourceActivity(index),
      });
    }

    for (let index = 1; index <= 3; index += 1) {
      const finance = commercialTask(runtime.db, roundId, "finance_analysis");
      completeTask(runtime.db, finance.id, {
        summary: `Opportunity ${index} has a bounded positive-contribution case.`,
        operatorDecision: "approve",
        confidence: "medium",
        risks: ["Acquisition cost may exceed the assumption", "Refund rates may reduce contribution"],
        roleOutput: {
          price: "A$39.00 per sale",
          marginLogic: "A$39 revenue less A$12 variable cost equals A$27 contribution before fixed cost.",
          breakEven: "A$270 fixed cost divided by A$27 contribution equals 10 sales.",
          costCap: "A$25 validation cap and A$100 monthly operating mandate.",
          financialRisk: "Downside is capped at A$25; stop if acquisition cost exceeds A$9 per buyer.",
          decisionSignal: "Proceed to final review only if direct-demand evidence remains attributable.",
        },
      });
    }

    const finalReview = commercialTask(runtime.db, roundId, "commercial_investment_review");
    const projected = completeTask(runtime.db, finalReview.id, {
      summary: "Invest in the strongest candidate only; its mandatory gates pass and downside remains bounded.",
      operatorDecision: "approve",
      confidence: "medium",
      roleOutput: {
        moneyMove: "Prepare the matching venture kit in the next goal.",
        whyNow: "The candidate leads the three comparable cases.",
        expectedUpside: "Positive contribution is plausible but not yet realised.",
        costRisk: "The first validation remains capped.",
        decisionNeeded: "No production action in this goal.",
        successMetric: "Three independent paid buyers and positive contribution.",
        stopRule: "Stop on the recorded kill rule.",
        specialistNeeded: false,
        specialistWorker: "",
        specialistObjective: "",
        specialistExpectedOutput: "",
        specialistMode: "",
        specialistContextClasses: [],
        specialistReason: "",
      },
    });
    assert.equal(projected.projected, true);

    const portfolio = getPortfolioState(runtime.db);
    assert.equal(portfolio.rounds[0].status, "completed");
    assert.ok(portfolio.selectedInvestmentCase);
    assert.equal(portfolio.selectedInvestmentCase.recommendation, "advance");
    assert.equal(getInvestmentCase(runtime.db, portfolio.selectedInvestmentCase.id).status, "decided");
    assert.equal(
      all(
        runtime.db,
        "SELECT id FROM commercial_decision_cases WHERE round_id = ? AND id <> ? AND status NOT IN ('parked', 'rejected')",
        [roundId, portfolio.selectedInvestmentCase.id],
      ).length,
      0,
    );
    assert.equal(all(runtime.db, "SELECT id FROM catalogue_plans WHERE venture_id = 'venture-portfolio-controller'").length, 0);
    assert.equal(all(runtime.db, "SELECT id FROM tasks WHERE venture_id = 'venture-portfolio-controller' AND agent IN ('offer_architect', 'product_builder')").length, 0);
    assert.equal(getOpportunityState(runtime.db).rounds.find((round) => round.id === roundId).status, "completed");
  } finally {
    closeRuntime(runtime);
  }
});

test("a future finance kill rule does not become a present rejection", () => {
  const runtime = runtimeDb("finance-kill-rule");
  try {
    ensurePortfolioController(runtime.db);
    const started = startPortfolioDiscovery(runtime.db);
    const roundId = started.round.id;
    const scout = commercialTask(runtime.db, roundId, "opportunity_scout");
    completeTask(runtime.db, scout.id, {
      summary: "Five opportunity spaces were compared.",
      recommendation: "Validate the top three.",
      confidence: "medium",
      roleOutput: { opportunities: [1, 2, 3, 4, 5].map(candidate) },
      toolActivity: sourceActivity("kill-rule-scout"),
    });

    for (let index = 1; index <= 3; index += 1) {
      const validator = commercialTask(runtime.db, roundId, "demand_validator");
      completeTask(runtime.db, validator.id, {
        summary: `Opportunity ${index} has attributable buyer and purchase signals.`,
        operatorDecision: "approve",
        confidence: "medium",
        pilotRecommendation: {
          verdict: "approve",
          evidence: [
            `${index * 10} paid orders were observed in the marketplace sample`,
            `${index * 20} verified customer reviews describe the buyer problem`,
          ],
          counterevidence: ["The sample does not reveal total market revenue."],
          assumptions: ["Public observations may not equal realised seller economics."],
          smallestTest: `Run a 14-day paid-intent test for opportunity ${index} with a real checkout signal and no public automation.`,
          metric: "At least three independent paid buyers with positive net cash contribution.",
          killRule: "Stop after the defined qualified exposure with zero sales and no strong buyer evidence.",
          priceChannelHypothesis: `Test A$39 through the evidence-selected channel for opportunity ${index}.`,
        },
        toolActivity: sourceActivity(`kill-rule-${index}`),
      });
    }

    const finance = commercialTask(runtime.db, roundId, "finance_analysis");
    completeTask(runtime.db, finance.id, {
      summary: "The economics are quantified but still need a verified marketplace fee schedule.",
      operatorDecision: "needs_evidence",
      confidence: "medium",
      risks: ["Acquisition cost remains unverified", "Refunds may reduce contribution"],
      roleOutput: {
        price: "A$39.00 per sale",
        marginLogic: "A$39 revenue less A$12 variable cost equals A$27 provisional contribution.",
        breakEven: "A$270 fixed cost divided by A$27 provisional contribution equals 10 sales.",
        costCap: "A$25 validation cap and A$100 monthly operating mandate.",
        financialRisk: "Actual marketplace fees and acquisition cost remain unverified.",
        decisionSignal: "Gather the missing fee evidence; stop only if verified contribution becomes negative.",
      },
    });

    const selected = get(
      runtime.db,
      "SELECT * FROM opportunities WHERE round_id = ? AND title = 'Opportunity 1'",
      [roundId],
    );
    const storedMetadata = fromJson(selected.metadata, {});
    assert.equal(storedMetadata.finance.decision, "needs_evidence");

    const assessment = assessInvestmentCase(runtime.db, selected.id);
    assert.equal(assessment.economics.decision, "needs_evidence");
    assert.equal(assessment.economics.denied, false);
    assert.equal(assessment.criteria.economics.passed, false);
    assert.equal(assessment.recommendation, "research_more");
    assert.deepEqual(
      assessment.criteria.economics.missing,
      ["finance approval based on verified economics"],
    );
  } finally {
    closeRuntime(runtime);
  }
});

test("targeted diligence reuses the fair comparison and queues Demand, Finance, then Sol only", () => {
  const runtime = runtimeDb("targeted-diligence");
  const timestamp = now();
  try {
    ensurePortfolioController(runtime.db);
    run(
      runtime.db,
      `INSERT INTO opportunity_rounds
       (id, venture_id, status, mode, prompt, geography, language, max_candidates,
        started_at, completed_at, created_by, metadata, created_at, updated_at)
       VALUES ('round-target-source', 'venture-digital-products', 'no_investment',
        'portfolio_discovery', 'Compare three candidates.', 'Australia', 'English', 5,
        ?, ?, 'Pantheon', ?, ?, ?)`,
      [
        timestamp,
        timestamp,
        toJson({
          portfolioControllerV1: true,
          validationCompletedIds: ["opp-target-source", "opp-target-alt-1", "opp-target-alt-2"],
          outcome: "No candidate qualified before targeted diligence.",
        }),
        timestamp,
        timestamp,
      ],
    );
    const opportunities = [
      {
        id: "opp-target-source",
        title: "Freelancer operations templates",
        model: "digital marketplace product",
        buyer: "Freelance social media managers serving several retained clients",
        problem: "Client approvals, scope changes, and delivery records become scattered across tools.",
        offer: "A workflow-first operations pack linking intake, approval, scope, delivery, and profitability records.",
        channel: "Etsy Australia",
        score: 75,
      },
      {
        id: "opp-target-alt-1",
        title: "Alternative service",
        model: "productized service",
        buyer: "Independent consultants",
        problem: "Client setup takes too much billable time.",
        offer: "A fixed-scope onboarding implementation service.",
        channel: "Direct referrals",
        score: 68,
      },
      {
        id: "opp-target-alt-2",
        title: "Alternative POD offer",
        model: "print on demand",
        buyer: "Nursing graduates",
        problem: "Generic milestone gifts lack relevant identity cues.",
        offer: "A personalised milestone gift collection.",
        channel: "Etsy",
        score: 61,
      },
    ];
    for (const opportunity of opportunities) {
      run(
        runtime.db,
        `INSERT INTO opportunities
         (id, round_id, venture_id, source_type, status, title, business_model,
          buyer, problem, offer_direction, geography, language, channel,
          demand_score, supply_gap_score, economics_score, channel_fit_score,
          execution_fit_score, risk_score, overall_score, confidence,
          recommendation, smallest_validation, evidence_ids, metadata,
          created_at, updated_at)
         VALUES (?, 'round-target-source', 'venture-digital-products',
          'model_hypothesis', 'parked', ?, ?, ?, ?, ?, 'Australia', 'English', ?,
          75, 70, 72, 74, 80, 30, ?, 'medium', 'Needs targeted evidence',
          'Run one bounded, evidence-backed market test with a clear stop rule.',
          '[]', ?, ?, ?)`,
        [
          opportunity.id,
          opportunity.title,
          opportunity.model,
          opportunity.buyer,
          opportunity.problem,
          opportunity.offer,
          opportunity.channel,
          opportunity.score,
          toJson({
            competitionEvidence: ["Competitor A", "Competitor B", "Free substitute C"],
            risks: ["Crowded marketplace", "Acquisition cost remains unknown"],
          }),
          timestamp,
          timestamp,
        ],
      );
    }
    run(
      runtime.db,
      "UPDATE opportunities SET evidence_ids = ? WHERE id = 'opp-target-source'",
      [toJson(["evidence-from-broad-discovery"])],
    );

    const started = startTargetedInvestmentReview(runtime.db, {
      sourceOpportunityId: "opp-target-source",
      decisionGap: "Whether a workflow-first pack can command non-commodity pricing despite strong marketplace competition.",
      title: "Social media manager client-control operations pack",
      offerDirection: "An Excel-based client-control system covering intake, approvals, scope changes, delivery records, and per-client profitability.",
      buyer: "Freelance social media managers serving two or more retained clients",
      problem: "Approvals, scope changes, delivery records, and client profitability are fragmented across messages and generic templates.",
      channel: "Etsy Australia, with other channels considered only after economics review",
      smallestValidation: "Compare the exact workflow against twenty marketplace listings, then run a bounded paid-intent test only if the entry position survives.",
      demandEvidence: [
        "Verified marketplace reviews show buyers pay for social-media-manager workflow bundles.",
        "Recent practitioner discussions repeatedly describe lost approvals and scope-control problems.",
      ],
      competitionEvidence: [
        "High-review Canva starter bundles compete at discounted mid-market prices.",
        "A premium onboarding workflow bundle offers more than ninety editable pages.",
        "A narrow approval-tracker listing exists but has no recorded sales yet.",
      ],
      risks: ["Entrenched high-review marketplace sellers", "A narrow workflow may be substituted by free spreadsheets"],
      publicEvidence: [
        {
          sourceUrl: "https://example.com/marketplace-sample",
          title: "Marketplace starter-kit sample",
          claim: "A sample of 20 marketplace listings contains multiple paid-review signals and strong discounting.",
          sampleSize: 20,
          confidence: "medium",
        },
        {
          sourceUrl: "https://example.org/buyer-problem",
          title: "Buyer workflow discussion",
          claim: "Practitioners describe scattered approvals, unclear scope, and time-consuming client onboarding.",
          sampleSize: 12,
          confidence: "medium",
        },
        {
          sourceUrl: "https://example.net/channel-fees",
          title: "Marketplace fee policy",
          claim: "The marketplace charges transaction, payment-processing, and per-listing fees that must enter contribution calculations.",
          confidence: "high",
        },
      ],
    });
    assert.equal(started.started, true);
    assert.equal(started.round.mode, "targeted_diligence");
    assert.equal(started.round.metadata.productionBlocked, true);
    assert.equal(started.opportunity.metadata.targetedReview.parentOpportunityId, "opp-target-source");
    assert.equal(started.opportunity.metadata.targetedReview.parentEvidenceCount, 1);
    assert.deepEqual(
      started.opportunity.evidence_ids,
      started.opportunity.metadata.targetedReview.baselineEvidenceIds,
    );
    assert.equal(started.opportunity.evidence_ids.length, 3);
    assert.equal(started.queued.task.payload.liveSpendRequest.model, "gpt-5.6-terra");

    const demand = commercialTask(runtime.db, started.round.id, "demand_validator");
    completeTask(runtime.db, demand.id, {
      summary: "The exact workflow has attributable paid-review and buyer-problem evidence.",
      operatorDecision: "approve",
      confidence: "medium",
      pilotRecommendation: {
        verdict: "approve",
        evidence: [
          "Twenty paid marketplace reviews support demand for complete workflow bundles.",
          "Twelve practitioners described approval and scope-control problems.",
        ],
        counterevidence: ["A narrow approval-only listing has no recorded sales."],
        assumptions: ["Review counts are lower-bound behavioural signals, not unit sales."],
        smallestTest: "Run a fourteen-day paid-intent test for the exact client-control workflow without public automation.",
        metric: "At least three independent paid buyers with positive net cash contribution.",
        killRule: "Stop after fifty qualified views with zero sales and no stronger buyer evidence.",
        priceChannelHypothesis: "Test A$39 on Etsy Australia and retain the channel only if contribution remains positive.",
      },
      toolActivity: sourceActivity("targeted-demand"),
    });

    const finance = commercialTask(runtime.db, started.round.id, "finance_analysis");
    completeTask(runtime.db, finance.id, {
      summary: "The bounded case has positive provisional contribution.",
      operatorDecision: "approve",
      confidence: "medium",
      recommendation: "Advance only to final investment review.",
      risks: ["Acquisition cost remains unverified", "Refunds may reduce contribution"],
      roleOutput: {
        price: "A$39.00 per sale",
        marginLogic: "A$39 revenue less A$4.25 channel fees and A$4.75 reserves equals A$30 contribution before acquisition.",
        breakEven: "A$150 fixed build cost divided by A$30 contribution equals 5 sales.",
        costCap: "A$25 validation cap inside the A$100 monthly mandate.",
        financialRisk: "Stop if verified fees, refunds, support, and acquisition remove positive contribution.",
        decisionSignal: "Approve final review; production remains blocked.",
      },
    });

    assert.equal(
      all(
        runtime.db,
        `SELECT id FROM tasks
         WHERE json_extract(payload, '$.liveSpendRequest.parameters.pantheonCommercial.roundId') = ?
           AND json_extract(payload, '$.liveSpendRequest.parameters.pantheonCommercial.step') = 'offer_architecture'`,
        [started.round.id],
      ).length,
      0,
    );
    const finalReview = commercialTask(runtime.db, started.round.id, "commercial_investment_review");
    assert.equal(finalReview.payload.liveSpendRequest.model, "gpt-5.6-sol");
    completeTask(runtime.db, finalReview.id, {
      summary: "Advance this candidate to its exact venture-kit goal; all mandatory gates pass.",
      operatorDecision: "approve",
      confidence: "medium",
      roleOutput: {
        moneyMove: "Implement the exact venture kit in the next goal.",
        whyNow: "The targeted evidence closes the decision gap.",
        expectedUpside: "A positive-contribution test is supportable but not yet proven.",
        costRisk: "The first real-world test remains capped.",
        decisionNeeded: "No production action in this goal.",
        successMetric: "Three independent paid buyers and positive contribution.",
        stopRule: "Stop on the recorded kill rule.",
        specialistNeeded: false,
        specialistWorker: "",
        specialistObjective: "",
        specialistExpectedOutput: "",
        specialistMode: "",
        specialistContextClasses: [],
        specialistReason: "",
      },
    });

    const completedRound = get(runtime.db, "SELECT status FROM opportunity_rounds WHERE id = ?", [started.round.id]);
    const completedState = getPortfolioState(runtime.db);
    const selectedCase = completedState.selectedInvestmentCase;
    assert.equal(completedRound.status, "completed");
    assert.equal(selectedCase.recommendation, "advance");
    assert.equal(selectedCase.round_id, started.round.id);
    assert.equal(completedState.nextAction.label, "Investment case ready");
  } finally {
    closeRuntime(runtime);
  }
});

test("parking the historical Job Search proof preserves evidence but removes it from current operator truth", () => {
  const runtime = runtimeDb("park-historical-proof");
  const timestamp = now();
  try {
    run(
      runtime.db,
      `INSERT INTO opportunities
       (id, venture_id, source_type, status, title, business_model, buyer, problem,
        offer_direction, channel, metadata, created_at, updated_at)
       VALUES ('opp-job-search-history', 'venture-digital-products', 'historical_proof',
        'ready_to_build', 'Job Search Evidence Tracker', 'digital_product',
        'Job seekers', 'Application tracking is fragmented',
        'A Job Search workflow bundle', 'Marketplace', '{}', ?, ?)`,
      [timestamp, timestamp],
    );
    run(
      runtime.db,
      `INSERT INTO pantheon_journeys
       (id, venture_id, mode, status, active_stage, model, model_locked,
        budget_cap_cents, selected_opportunity_id, metadata, started_at,
        completed_at, created_at, updated_at)
       VALUES ('journey-job-search-history', 'venture-digital-products',
        'production', 'completed', 'ready_to_publish', 'gpt-5.6-luna', 1,
        1500, 'opp-job-search-history', '{}', ?, ?, ?, ?)`,
      [timestamp, timestamp, timestamp, timestamp],
    );
    run(
      runtime.db,
      `INSERT INTO catalogue_plans
       (id, venture_id, opportunity_id, status, title, metadata, created_at, updated_at)
       VALUES ('plan-job-search-history', 'venture-digital-products',
        'opp-job-search-history', 'ready_to_publish',
        'Job Search Evidence Tracker catalogue', '{}', ?, ?)`,
      [timestamp, timestamp],
    );
    run(
      runtime.db,
      `INSERT INTO commercial_experiments
       (id, venture_id, name, status, hypothesis, buyer, offer, channel,
        metadata, created_at, updated_at)
       VALUES ('experiment-job-search-history', 'venture-digital-products',
        'Job Search Evidence Tracker first-revenue test', 'ready',
        'Job seekers may pay for a linked Job Search workflow',
        'Job seekers', 'Job Search Evidence Tracker', 'Marketplace', '{}', ?, ?)`,
      [timestamp, timestamp],
    );

    const result = parkJobSearchProduct(runtime.db);
    assert.deepEqual(result.opportunityIds, ["opp-job-search-history"]);
    assert.deepEqual(result.archivedJourneyIds, ["journey-job-search-history"]);
    assert.deepEqual(result.archivedExperimentIds, ["experiment-job-search-history"]);
    assert.deepEqual(result.archivedPlanIds, ["plan-job-search-history"]);

    assert.equal(get(runtime.db, "SELECT status FROM opportunities WHERE id = 'opp-job-search-history'").status, "parked");
    assert.equal(get(runtime.db, "SELECT status FROM commercial_experiments WHERE id = 'experiment-job-search-history'").status, "cancelled");
    assert.equal(currentOperatorJourney(runtime.db), null);
    assert.equal(getProductionState(runtime.db).plans.length, 0);
    assert.equal(get(runtime.db, "SELECT status FROM pantheon_journeys WHERE id = 'journey-job-search-history'").status, "completed");
    assert.equal(get(runtime.db, "SELECT json_extract(metadata, '$.archivedFromOperator') AS archived FROM pantheon_journeys WHERE id = 'journey-job-search-history'").archived, 1);
  } finally {
    closeRuntime(runtime);
  }
});

test("an unknown Portfolio provider outcome stops its round and enables only the second bounded round", () => {
  const runtime = runtimeDb("portfolio-unknown-outcome");
  try {
    ensurePortfolioController(runtime.db);
    const started = startPortfolioDiscovery(runtime.db);
    const task = commercialTask(runtime.db, started.round.id, "opportunity_scout");
    run(
      runtime.db,
      "UPDATE tasks SET status = 'needs_attention', outcome_status = 'unknown', error = ? WHERE id = ?",
      ["Provider response was not confirmed before the deadline.", task.id],
    );
    const stopped = markPortfolioAttention(
      runtime.db,
      { ...task, status: "needs_attention", outcome_status: "unknown" },
      "Provider response was not confirmed before the deadline.",
    );
    assert.equal(stopped.status, "stopped_unknown_outcome");
    assert.equal(fromJson(stopped.metadata, {}).providerOutcomeUnknown, true);

    const portfolio = getPortfolioState(runtime.db);
    assert.equal(portfolio.activeRound, null);
    assert.equal(portfolio.nextAction.action, "start_portfolio_discovery");
    assert.equal(portfolio.nextAction.label, "Run a replacement evidence round");
    assert.equal(all(runtime.db, "SELECT id FROM opportunities WHERE round_id = ?", [started.round.id]).length, 0);
  } finally {
    closeRuntime(runtime);
  }
});
