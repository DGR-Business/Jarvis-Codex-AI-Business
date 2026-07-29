const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const retrievalCases = require("../config/commercial-retrieval-eval-v1");
const { get, now, openDatabase, run, seedDatabase, toJson } = require("../src/db");
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
} = require("../src/runtime/commercial-investment-review");
const { createResearchSourceAdapter } = require("../src/adapters/research");
const {
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

function assertRetiredPreventureStart(db, operation, expectedPath) {
  const beforeChanges = Number(
    get(db, "SELECT total_changes() AS count").count,
  );
  assert.throws(
    operation,
    (error) => {
      assert.equal(error.statusCode, 410);
      assert.equal(error.code, "legacy_commercial_path_retired");
      assert.match(error.message, /narrow, auditable pre-venture research authority/i);
      assert.deepEqual(error.details, {
        path: expectedPath,
        replacement: "bounded_preventure_research_authority_pending",
      });
      return true;
    },
  );
  assert.equal(
    Number(get(db, "SELECT total_changes() AS count").count),
    beforeChanges,
  );
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

test("portfolio discovery is retired before it can create records", () => {
  const runtime = runtimeDb("portfolio-discovery-retired");
  try {
    assertRetiredPreventureStart(
      runtime.db,
      () => startPortfolioDiscovery(runtime.db),
      "portfolio_discovery_start",
    );
  } finally {
    closeRuntime(runtime);
  }
});

test("portfolio discovery retirement is stable for recovery and operator-idea callers", () => {
  const runtime = runtimeDb("portfolio-discovery-retired-options");
  try {
    for (const input of [
      { operatorIdea: "A specific operator-submitted venture idea" },
      { developerRecovery: true },
    ]) {
      assertRetiredPreventureStart(
        runtime.db,
        () => startPortfolioDiscovery(runtime.db, input),
        "portfolio_discovery_start",
      );
    }
  } finally {
    closeRuntime(runtime);
  }
});

test("targeted investment review is retired before source lookup or writes", () => {
  const runtime = runtimeDb("targeted-review-retired");
  try {
    assertRetiredPreventureStart(
      runtime.db,
      () => startTargetedInvestmentReview(runtime.db, {}),
      "portfolio_targeted_investment_review_start",
    );
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

test("targeted investment review retirement is stable for a fully populated caller", () => {
  const runtime = runtimeDb("targeted-review-retired-input");
  try {
    assertRetiredPreventureStart(
      runtime.db,
      () => startTargetedInvestmentReview(runtime.db, {
        sourceOpportunityId: "opp-retired-source",
        decisionGap: "Whether the selected offer has enough evidence to justify more diligence.",
        title: "Retired targeted review fixture",
        offerDirection: "A fully specified offer that must not reopen the retired research path.",
        demandEvidence: ["Demand observation one", "Demand observation two"],
        competitionEvidence: ["Competitor one", "Competitor two", "Competitor three"],
        publicEvidence: [
          { sourceUrl: "https://example.com/one" },
          { sourceUrl: "https://example.com/two" },
          { sourceUrl: "https://example.com/three" },
        ],
      }),
      "portfolio_targeted_investment_review_start",
    );
  } finally {
    closeRuntime(runtime);
  }
});
