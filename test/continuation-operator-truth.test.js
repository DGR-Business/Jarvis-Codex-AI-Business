const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const {
  SOCIAL_MEDIA_MANAGER_CLIENT_CONTROL_V1: buyerIntentSpec,
} = require("../config/buyer-intent-validation-specs");
const {
  get,
  openDatabase,
  run,
  seedDatabase,
  toJson,
} = require("../src/db");
const {
  getAgentRunDetail,
  getAgentRunsState,
  getBusinessTestsState,
  getCockpitState,
  getTestDetail,
} = require("../src/runtime/cockpit-state");
const { ensureAiTeam } = require("../src/runtime/ai-team");

const CUSTOMER_PRODUCT_TITLE = "Client Control and Profitability Workbook";
const HISTORICAL_PACKAGE_TITLE = "Social Media Manager Client-Control Validation Sample";
const VENTURE_ID = "venture-digital-products";

function makeRuntime() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pantheon-operator-truth-"));
  const db = openDatabase(path.join(root, "runtime.sqlite"));
  seedDatabase(db);
  ensureAiTeam(db);
  return { db, root };
}

function closeRuntime(runtime) {
  runtime.db.close();
  fs.rmSync(runtime.root, { recursive: true, force: true });
}

function insertWorkflow(db, id, timestamp = "2026-07-29T00:00:00.000Z") {
  run(
    db,
    `INSERT INTO workflows
     (id, venture_id, type, title, status, current_step, priority, metadata,
      created_at, updated_at)
     VALUES (?, ?, 'buyer_intent_validation', 'Buyer-intent continuation',
             'running', 'quality inspection', 1, '{}', ?, ?)`,
    [id, VENTURE_ID, timestamp, timestamp],
  );
}

function insertBuyerIntentProjectionFixture(db, {
  workflowId = "wf-operator-truth",
  planId = "plan-operator-truth",
  experimentId = "experiment-operator-truth",
  planUpdatedAt = "2026-07-29T00:01:00.000Z",
  planStatus = "needs_attention",
  buildStatus = "quality_failed",
} = {}) {
  insertWorkflow(db, workflowId);
  const briefId = `brief-${experimentId}`;
  const candidateId = `candidate-${experimentId}`;
  const contract = {
    specId: buyerIntentSpec.id,
    workflowId,
    cataloguePlanId: planId,
    experimentId,
    candidateId,
    buyer: buyerIntentSpec.buyer,
    offer: buyerIntentSpec.offer,
    priceCents: buyerIntentSpec.priceCents,
    channel: buyerIntentSpec.channel,
    measurement: buyerIntentSpec.measurement,
    sample: {
      packageTitle: HISTORICAL_PACKAGE_TITLE,
      item: {
        title: CUSTOMER_PRODUCT_TITLE,
      },
    },
    investmentCaseRemainsParked: true,
    externalActionsAllowed: false,
    decisionHash: "sha256:signed-contract-must-not-change",
  };
  const experimentMetadata = toJson({
    buyerIntentValidation: contract,
    signedRecord: {
      decisionHash: contract.decisionHash,
      originalPackageTitle: HISTORICAL_PACKAGE_TITLE,
    },
  });
  const planMetadata = toJson({
    validationSample: contract,
    productManifest: {
      packageTitle: CUSTOMER_PRODUCT_TITLE,
    },
    buildStatus,
    signedRecord: {
      decisionHash: contract.decisionHash,
      originalPackageTitle: HISTORICAL_PACKAGE_TITLE,
    },
  });
  run(
    db,
    `INSERT INTO commercial_experiments
     (id, workflow_id, venture_id, name, status, hypothesis, buyer, offer,
       channel, price_cents, expected_metric, target_value, target_unit,
       cost_cap_cents, metadata, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'ready', 'One bounded buyer-intent test', ?, ?,
              'Etsy', 2995, ?, 3, 'paid orders', 0, ?, ?, ?)`,
    [
      experimentId,
      workflowId,
      VENTURE_ID,
      HISTORICAL_PACKAGE_TITLE,
      buyerIntentSpec.buyer,
      buyerIntentSpec.offer,
      buyerIntentSpec.measurement.passRule,
      experimentMetadata,
      planUpdatedAt,
      planUpdatedAt,
    ],
  );
  run(
    db,
    `INSERT INTO commercial_briefs
     (id, workflow_id, venture_id, source, status, title, metadata, created_at, updated_at)
     VALUES (?, ?, ?, 'operator_truth_fixture', 'exact_test_ready',
       'Buyer-intent operator truth brief', '{}', ?, ?)`,
    [briefId, workflowId, VENTURE_ID, planUpdatedAt, planUpdatedAt],
  );
  run(
    db,
    `INSERT INTO commercial_test_candidates
     (id, brief_id, workflow_id, venture_id, rank, status, title,
       promoted_experiment_id, metadata, created_at, updated_at)
     VALUES (?, ?, ?, ?, 1, 'promoted', 'Buyer-intent operator truth candidate',
       ?, ?, ?, ?)`,
    [
      candidateId,
      briefId,
      workflowId,
      VENTURE_ID,
      experimentId,
      toJson({ buyerIntentValidation: contract }),
      planUpdatedAt,
      planUpdatedAt,
    ],
  );
  run(
    db,
    `INSERT INTO catalogue_plans
     (id, venture_id, opportunity_id, status, title, rationale,
      target_item_count, target_variant_count, audience_segments, channels,
      geographies, languages, price_floor_cents, price_ceiling_cents,
      estimated_build_cost_cents, estimated_unit_cost_cents, metadata,
      created_at, updated_at)
     VALUES (?, ?, NULL, ?, ?, 'Frozen buyer-intent contract',
             1, 0, '[]', '["Etsy"]', '["Australia"]', '["English"]',
             2995, 2995, 0, 0, ?, ?, ?)`,
    [
      planId,
      VENTURE_ID,
      planStatus,
      HISTORICAL_PACKAGE_TITLE,
      planMetadata,
      planUpdatedAt,
      planUpdatedAt,
    ],
  );
  return {
    workflowId,
    planId,
    experimentId,
    candidateId,
    briefId,
    experimentMetadata,
    planMetadata,
  };
}

test("operator projections use the customer product title without rewriting signed history", () => {
  const runtime = makeRuntime();
  try {
    const fixture = insertBuyerIntentProjectionFixture(runtime.db);

    const cockpit = getCockpitState(runtime.db);
    const testsState = getBusinessTestsState(runtime.db);
    const detail = getTestDetail(runtime.db, fixture.experimentId);
    const surfacedTest = Object.values(testsState.tests)
      .flat()
      .find((item) => item.id === fixture.experimentId);

    assert.equal(cockpit.currentTest.name, CUSTOMER_PRODUCT_TITLE);
    assert.equal(cockpit.buyerIntentValidation.name, CUSTOMER_PRODUCT_TITLE);
    assert.equal(cockpit.currentTest.status, "product_needs_attention");
    assert.notEqual(cockpit.currentTest.status, "ready");
    assert.equal(surfacedTest.name, CUSTOMER_PRODUCT_TITLE);
    assert.equal(surfacedTest.status, "candidate");
    assert.equal(surfacedTest.workflowStatus, "product_needs_attention");
    assert.equal(
      testsState.tests.candidate.filter((item) => item.id === fixture.experimentId).length,
      1,
    );
    assert.equal(
      testsState.tests.ready.some((item) => item.id === fixture.experimentId),
      false,
    );
    assert.equal(detail.experiment.name, CUSTOMER_PRODUCT_TITLE);

    const storedExperiment = get(
      runtime.db,
      "SELECT name, status, metadata FROM commercial_experiments WHERE id = ?",
      [fixture.experimentId],
    );
    const storedPlan = get(
      runtime.db,
      "SELECT title, metadata FROM catalogue_plans WHERE id = ?",
      [fixture.planId],
    );
    assert.equal(storedExperiment.name, HISTORICAL_PACKAGE_TITLE);
    assert.equal(storedExperiment.status, "ready");
    assert.equal(storedExperiment.metadata, fixture.experimentMetadata);
    assert.equal(storedPlan.title, HISTORICAL_PACKAGE_TITLE);
    assert.equal(storedPlan.metadata, fixture.planMetadata);
  } finally {
    closeRuntime(runtime);
  }
});

test("buyer-intent projections expose the exact 100-visit and 30-day decision contract", () => {
  const runtime = makeRuntime();
  try {
    const fixture = insertBuyerIntentProjectionFixture(runtime.db);
    const cockpit = getCockpitState(runtime.db);
    const testsState = getBusinessTestsState(runtime.db);
    const detail = getTestDetail(runtime.db, fixture.experimentId);

    for (const measurement of [
      cockpit.buyerIntentValidation.measurement,
      testsState.buyerIntentValidation.measurement,
      detail.buyerIntentValidation.measurement,
    ]) {
      assert.equal(measurement.exposureTarget, 100);
      assert.equal(measurement.durationDays, 30);
      assert.match(measurement.passRule, /at least 3 independent paid orders/i);
      assert.match(measurement.reviseRule, /1-2 orders/i);
      assert.match(measurement.inconclusiveRule, /fewer than 100 qualified visits.*30 days/i);
      assert.match(measurement.stopRule, /100 qualified visits produce zero orders/i);
    }
  } finally {
    closeRuntime(runtime);
  }
});

test("a failed continuation projection creates one plain Important Work item until progress or a task supersedes it", () => {
  const runtime = makeRuntime();
  try {
    const fixture = insertBuyerIntentProjectionFixture(runtime.db, {
      planUpdatedAt: "2026-07-29T00:01:00.000Z",
    });
    const taskId = "task-failed-continuation-projection";
    run(
      runtime.db,
      `INSERT INTO tasks
       (id, workflow_id, venture_id, title, kind, agent, status, priority,
        retries, max_retries, cost_budget_cents, cost_actual_cents, payload,
        result, outcome_status, completed_at, created_at, updated_at)
       VALUES (?, ?, ?, 'Prepare the next product check', 'local_projection',
               'chief_of_staff', 'completed', 1, 0, 0, 0, 0, ?, '{}',
               'known', ?, ?, ?)`,
      [
        taskId,
        fixture.workflowId,
        VENTURE_ID,
        toJson({
          liveSpendRequest: {
            parameters: {
              pantheonProduction: {
                planId: fixture.planId,
                stage: "inspection_evidence_refresh",
              },
            },
          },
        }),
        "2026-07-29T00:02:00.000Z",
        "2026-07-29T00:02:00.000Z",
        "2026-07-29T00:02:00.000Z",
      ],
    );
    run(
      runtime.db,
      `INSERT INTO supervisor_cycles
       (id, venture_id, workflow_id, trigger_type, trigger_id, status,
        decision_type, next_action_type, worker_id, task_id, summary, error,
        completed_at, metadata, created_at, updated_at)
       VALUES ('cycle-failed-continuation-projection', ?, ?, 'task_completed', ?,
               'needs_attention', 'stop', 'developer_review_required',
               'chief_of_staff', ?, 'Projection failed', 'Local projection failed',
               ?, '{}', ?, ?)`,
      [
        VENTURE_ID,
        fixture.workflowId,
        taskId,
        taskId,
        "2026-07-29T00:03:00.000Z",
        "2026-07-29T00:03:00.000Z",
        "2026-07-29T00:03:00.000Z",
      ],
    );

    const initialItems = getCockpitState(runtime.db).importantWork
      .filter((item) => item.type === "supervisor_failure");
    assert.equal(initialItems.length, 1);
    assert.equal(initialItems[0].title, "Pantheon could not prepare the next product check");
    assert.match(initialItems[0].summary, /completed files are safe/i);
    assert.match(initialItems[0].recommendation, /Jarvis must repair the local workflow/i);
    assert.doesNotMatch(
      `${initialItems[0].title} ${initialItems[0].summary} ${initialItems[0].recommendation}`,
      /supervisor cycle|projection table|runtime exception|stack trace/i,
    );

    run(
      runtime.db,
      "UPDATE catalogue_plans SET updated_at = ? WHERE id = ?",
      ["2026-07-29T00:04:00.000Z", fixture.planId],
    );
    assert.equal(
      getCockpitState(runtime.db).importantWork
        .filter((item) => item.type === "supervisor_failure").length,
      0,
    );

    run(
      runtime.db,
      "UPDATE catalogue_plans SET updated_at = ? WHERE id = ?",
      ["2026-07-29T00:01:00.000Z", fixture.planId],
    );
    run(
      runtime.db,
      `UPDATE tasks
       SET status = 'needs_attention',
           outcome_status = 'known_provider_result_needs_review',
           error = 'The local result needs review',
           completed_at = NULL,
           updated_at = ?
       WHERE id = ?`,
      ["2026-07-29T00:03:30.000Z", taskId],
    );
    const duplicateSuppressed = getCockpitState(runtime.db).importantWork;
    assert.equal(
      duplicateSuppressed.filter((item) => item.type === "supervisor_failure").length,
      0,
    );
    assert.equal(duplicateSuppressed.filter((item) => item.id === taskId).length, 1);
  } finally {
    closeRuntime(runtime);
  }
});

test("live-run API keeps estimated incurred cost separate from the approved ceiling", () => {
  const runtime = makeRuntime();
  try {
    const workflowId = "wf-cost-truth";
    const taskId = "task-cost-truth";
    const runId = "run-cost-truth";
    insertWorkflow(runtime.db, workflowId);
    run(
      runtime.db,
      `INSERT INTO tasks
       (id, workflow_id, venture_id, title, kind, agent, status, priority,
        retries, max_retries, cost_budget_cents, cost_actual_cents, payload,
        result, outcome_status, completed_at, created_at, updated_at)
       VALUES (?, ?, ?, 'Inspect exact QA evidence', 'live_ai_worker_execution',
               'quality_reviewer', 'completed', 1, 0, 0, 150, 0, ?, ?,
               'known', ?, ?, ?)`,
      [
        taskId,
        workflowId,
        VENTURE_ID,
        toJson({
          liveSpendRequest: {
            provider: "openai-agents-sdk",
            model: "gpt-test",
            estimatedCostCents: 17,
            maxCostCents: 150,
            effects: [],
          },
        }),
        toJson({ output: { summary: "The evidence inspection completed." } }),
        "2026-07-29T01:00:05.000Z",
        "2026-07-29T01:00:00.000Z",
        "2026-07-29T01:00:05.000Z",
      ],
    );
    run(
      runtime.db,
      `INSERT INTO model_calls
       (id, workflow_id, task_id, venture_id, provider, model_class,
        selected_model, mode, status, input_tokens, output_tokens,
        estimated_cost_cents, actual_cost_cents, approval_required, metadata,
        created_at, provider_request_id, cost_status, outcome_status,
        completed_at)
       VALUES ('model-cost-truth', ?, ?, ?, 'openai', 'quality-review',
               'gpt-test', 'live', 'completed', 1000, 200, 17, 0, 1, ?,
               ?, 'resp-cost-truth', 'incurred_estimate', 'known', ?)`,
      [
        workflowId,
        taskId,
        VENTURE_ID,
        toJson({
          dispatchIntent: { status: "dispatched" },
          providerResponseReceived: true,
        }),
        "2026-07-29T01:00:00.000Z",
        "2026-07-29T01:00:05.000Z",
      ],
    );
    run(
      runtime.db,
      `INSERT INTO agent_runs
       (id, agent_id, workflow_id, task_id, venture_id, mode, status,
        input_summary, output_summary, model_call_id, estimated_cost_cents,
        actual_cost_cents, approval_required, eval_status, metadata,
        started_at, completed_at)
       VALUES (?, 'quality_reviewer', ?, ?, ?, 'openai-agents-sdk',
               'completed', 'Inspect four exact images', 'Inspection complete',
               'model-cost-truth', 17, 0, 1, 'passed', '{}', ?, ?)`,
      [
        runId,
        workflowId,
        taskId,
        VENTURE_ID,
        "2026-07-29T01:00:00.000Z",
        "2026-07-29T01:00:05.000Z",
      ],
    );

    const summary = getAgentRunsState(runtime.db, { execution: "all" })
      .runs
      .find((item) => item.id === runId);
    const detail = getAgentRunDetail(runtime.db, runId);
    assert.equal(summary.cost.status, "incurred_estimate");
    assert.equal(summary.cost.estimatedCents, 17);
    assert.equal(summary.cost.plannedCapCents, 150);
    assert.notEqual(summary.cost.estimatedCents, summary.cost.plannedCapCents);
    assert.equal(detail.execution.cost.estimatedCents, 17);
    assert.equal(detail.execution.cost.plannedCapCents, 150);
  } finally {
    closeRuntime(runtime);
  }
});

test("pre-dispatch UI shows no provider charge and retains the unused approved ceiling", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "public", "app.js"),
    "utf8",
  );
  const rowStart = source.indexOf("function renderAgentRunRow");
  const rowEnd = source.indexOf("\nfunction renderLiveRuns", rowStart);
  const renderAgentRunRow = vm.runInNewContext(
    `(${source.slice(rowStart, rowEnd).trim()})`,
    {
      store: { drawerState: null },
      tokenCount: (value) => String(value),
      money: (cents) => `A$${(Number(cents || 0) / 100).toFixed(2)}`,
      humanStatus: (value) => String(value || ""),
      escapeHtml: (value) => String(value ?? ""),
      badge: (value) => `[${String(value || "")}]`,
      icon: () => "",
      dateTime: (value) => String(value || ""),
    },
  );
  const html = renderAgentRunRow({
    id: "run-pre-dispatch",
    executionKind: "provider_not_contacted",
    providerAttempted: false,
    active: false,
    status: "failed",
    taskTitle: "Inspect exact QA evidence",
    workerName: "Quality Reviewer",
    startedAt: "2026-07-29T01:00:00.000Z",
    actualTokens: { input: null, output: null, total: null },
    cost: {
      status: "incurred_estimate",
      actualCents: null,
      estimatedCents: 17,
      plannedCapCents: 150,
      currency: "AUD",
    },
    receipt: { status: "missing" },
  });
  assert.match(html, /No provider charge/);
  assert.match(html, /Approved ceiling A\$1\.50/);
  assert.doesNotMatch(html, /A\$0\.17|Estimated incurred cost|final bill pending/i);

  const reviewStart = source.indexOf("function runReviewBody");
  const reviewEnd = source.indexOf("\nasync function showDetail", reviewStart);
  const reviewProjection = source.slice(reviewStart, reviewEnd);
  assert.match(
    reviewProjection,
    /const providerCost = protectedRun \|\| providerNotContacted\s*\?\s*"No provider charge"/,
  );
  assert.match(
    reviewProjection,
    /const providerCostLabel = protectedRun \|\| providerNotContacted\s*\?\s*"Provider cost"/,
  );
  assert.match(reviewProjection, /<span>Approved ceiling<\/span>/);
  assert.match(reviewProjection, /OpenAI was not contacted\. The approved ceiling remained unused\./);
});

test("terminal inspection-recheck outcomes permanently stop and cancel the pre-venture test", () => {
  const terminalStatuses = [
    "inspection_evidence_recheck_failed_terminal",
    "inspection_evidence_recheck_declined_terminal",
  ];
  for (const [index, buildStatus] of terminalStatuses.entries()) {
    const runtime = makeRuntime();
    try {
      const fixture = insertBuyerIntentProjectionFixture(runtime.db, {
        workflowId: `wf-terminal-${index}`,
        planId: `plan-terminal-${index}`,
        experimentId: `experiment-terminal-${index}`,
        buildStatus,
      });
      const terminalizedAt = `2026-07-29T00:02:0${index}.000Z`;
      run(
        runtime.db,
        `UPDATE commercial_experiments
         SET status = 'cancelled', ended_at = ?, updated_at = ? WHERE id = ?`,
        [terminalizedAt, terminalizedAt, fixture.experimentId],
      );
      run(
        runtime.db,
        `UPDATE commercial_test_candidates
         SET status = 'cancelled', updated_at = ? WHERE id = ?`,
        [terminalizedAt, fixture.candidateId],
      );
      const cockpit = getCockpitState(runtime.db);
      const testsState = getBusinessTestsState(runtime.db);

      assert.equal(cockpit.buyerIntentValidation.status, "stopped_permanently");
      assert.equal(cockpit.currentTest.id, fixture.experimentId);
      assert.equal(cockpit.currentTest.status, "stopped_permanently");
      assert.equal(cockpit.currentTest.storedStatus, "cancelled");
      assert.equal(cockpit.currentTest.retainedTerminal, true);
      assert.equal(cockpit.currentTest.marketTestRunning, false);
      assert.equal(cockpit.currentTest.marketEvidenceRecorded, false);
      assert.equal(cockpit.currentTest.marketResultCount, 0);
      assert.equal(cockpit.currentTest.actionable, false);
      assert.equal(cockpit.currentTest.name, CUSTOMER_PRODUCT_TITLE);
      assert.equal(cockpit.currentTest.buyer, buyerIntentSpec.buyer);
      assert.equal(cockpit.currentTest.offer, buyerIntentSpec.offer);
      assert.equal(cockpit.currentTest.price_cents, buyerIntentSpec.priceCents);
      assert.equal(cockpit.currentTest.channel, buyerIntentSpec.channel.label);
      assert.equal(
        cockpit.currentTest.hypothesis,
        buyerIntentSpec.measurement.qualificationQuestion,
      );
      assert.equal(cockpit.currentTest.expected_metric, buyerIntentSpec.measurement.passRule);
      assert.equal(
        get(
          runtime.db,
          "SELECT status FROM commercial_experiments WHERE id = ?",
          [fixture.experimentId],
        ).status,
        "cancelled",
        "operator projection must not reactivate the retained experiment",
      );
      assert.equal(
        get(
          runtime.db,
          "SELECT status FROM commercial_test_candidates WHERE id = ?",
          [fixture.candidateId],
        ).status,
        "cancelled",
        "operator projection must not reactivate the retained candidate",
      );
      assert.equal(testsState.buyerIntentValidation.planId, fixture.planId);
      assert.equal(testsState.buyerIntentValidation.terminal, true);
      assert.equal(testsState.buyerIntentValidation.marketEvidenceRecorded, false);
      assert.equal(testsState.buyerIntentValidation.measurement.durationDays, 30);
      assert.equal(testsState.buyerIntentValidation.measurement.exposureTarget, 100);
      assert.equal(
        testsState.tests.cancelled.filter((item) => item.id === fixture.experimentId).length,
        1,
      );
      for (const group of ["candidate", "ready", "running", "completed"]) {
        assert.equal(
          testsState.tests[group].some((item) => item.id === fixture.experimentId),
          false,
        );
      }
      assert.equal(
        testsState.tests.cancelled.find((item) => item.id === fixture.experimentId).workflowStatus,
        "stopped_permanently",
      );
    } finally {
      closeRuntime(runtime);
    }
  }

  const source = fs.readFileSync(
    path.join(__dirname, "..", "public", "app.js"),
    "utf8",
  );
  assert.match(source, /inspection_evidence_recheck_failed_terminal/);
  assert.match(source, /inspection_evidence_recheck_declined_terminal/);
  assert.match(source, /This product build is permanently stopped/);
  assert.match(source, /will not retry, revise, or spend more on this build/i);
  assert.match(
    source,
    /No retry, revision, publication, marketplace action, or additional model spend is authorised/i,
  );
  const renderCockpitStart = source.indexOf("function renderCockpit");
  const renderCockpitEnd = source.indexOf("\nfunction decisionTabs", renderCockpitStart);
  const renderCockpitProjection = source.slice(renderCockpitStart, renderCockpitEnd);
  assert.match(renderCockpitProjection, /Retained commercial test/);
  assert.match(
    renderCockpitProjection,
    /The stopped test remains visible as evidence\. It is not live, runnable, or proof of buyer demand\./,
  );
  assert.match(
    renderCockpitProjection,
    /No market test is running\. No listing, visit, order, refund, or contribution result was recorded\./,
  );
  assert.match(
    renderCockpitProjection,
    /retainedExposureTarget[\s\S]*qualified visits or \$\{retainedDurationDays\} days/,
  );
  assert.match(renderCockpitProjection, /No market test is running; the stopped path is retained as evidence\./);
  assert.match(renderCockpitProjection, /terminalRetainedTest \? "Retained test" : "Current test"/);
  assert.doesNotMatch(renderCockpitProjection, /qualifiedViewTarget|testDurationDays/);
  assert.match(
    renderCockpitProjection,
    /terminalRetainedTest \? "" : `<button class="text-button" data-action="open-drawer"/,
    "the retained terminal card must not expose an action or run control",
  );
  const renderTestsStart = source.indexOf("function renderTests");
  const renderTestsEnd = source.indexOf("\nfunction initials", renderTestsStart);
  const renderTestsProjection = source.slice(renderTestsStart, renderTestsEnd);
  assert.match(
    renderTestsProjection,
    /buyerIntentValidation\.planId === productionPlan\?\.id/,
  );
  assert.match(
    renderTestsProjection,
    /const buyerIntentMeasurement = buyerIntentPlanMatches\s*\?\s*buyerIntentValidation\.measurement \|\| null\s*:\s*null/,
  );
  assert.match(
    renderTestsProjection,
    /const buyerIntentBoundaryTerminal = buyerIntentPlanMatches\s*&& buyerIntentValidation\.terminal === true/,
  );
  assert.match(renderTestsProjection, /Retained stopped-test rules/);
  assert.match(
    renderTestsProjection,
    /exact 30-day and 100-visit rules for the stopped build/i,
  );
  assert.ok(
    renderTestsProjection.indexOf("buyerIntentMeasurement.durationDays")
      < renderTestsProjection.indexOf("data.pilotPolicy.testDurationDays"),
    "a matching terminal validation must retain its exact contract before the generic fallback",
  );
});

test("a later genuinely active test takes precedence over retained terminal evidence", () => {
  const runtime = makeRuntime();
  try {
    const terminal = insertBuyerIntentProjectionFixture(runtime.db, {
      workflowId: "wf-terminal-predecessor",
      planId: "plan-terminal-predecessor",
      experimentId: "experiment-terminal-predecessor",
      buildStatus: "inspection_evidence_recheck_failed_terminal",
    });
    run(
      runtime.db,
      "UPDATE commercial_experiments SET status = 'cancelled', ended_at = ?, updated_at = ? WHERE id = ?",
      ["2026-07-29T00:02:00.000Z", "2026-07-29T00:02:00.000Z", terminal.experimentId],
    );
    run(
      runtime.db,
      "UPDATE commercial_test_candidates SET status = 'cancelled', updated_at = ? WHERE id = ?",
      ["2026-07-29T00:02:00.000Z", terminal.candidateId],
    );

    insertWorkflow(runtime.db, "wf-later-active", "2026-07-29T00:03:00.000Z");
    run(
      runtime.db,
      `INSERT INTO commercial_experiments
       (id, workflow_id, venture_id, name, status, hypothesis, buyer, offer,
        channel, price_cents, expected_metric, target_value, target_unit,
        cost_cap_cents, metadata, created_at, updated_at)
       VALUES ('experiment-later-active', 'wf-later-active', ?, 'Later active test',
         'ready', 'A later approved test is genuinely active.', 'Active buyer',
         'Active offer', 'Active channel', 4900, 'One verified paid result',
         1, 'paid result', 0, '{}', ?, ?)`,
      [
        VENTURE_ID,
        "2026-07-29T00:03:00.000Z",
        "2026-07-29T00:03:00.000Z",
      ],
    );

    const cockpit = getCockpitState(runtime.db);
    assert.equal(cockpit.buyerIntentValidation.terminal, true);
    assert.equal(cockpit.currentTest.id, "experiment-later-active");
    assert.equal(cockpit.currentTest.status, "ready");
    assert.notEqual(cockpit.currentTest.retainedTerminal, true);
  } finally {
    closeRuntime(runtime);
  }
});

test("dashboard copy separates cost truth, preserves buyer-intent boundaries, and has clean account grammar", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "public", "app.js"),
    "utf8",
  );
  assert.match(source, /"Estimated incurred cost"/);
  assert.match(source, /<span>Approved ceiling<\/span>/);
  assert.match(source, /The approved ceiling is an upper limit, not spend\./);
  assert.match(source, /prove any eligible zero-spend local repair/);
  assert.match(source, /eligible for an exact zero-spend local repair/);
  assert.doesNotMatch(source, /authorising a fresh bounded revision/);
  assert.doesNotMatch(source, /create a the|any the/i);

  const boundariesStart = source.indexOf("const buyerIntentPlanMatches");
  const boundariesEnd = source.indexOf("${resultsPanel}", boundariesStart);
  assert.notEqual(boundariesStart, -1);
  assert.notEqual(boundariesEnd, -1);
  const boundaries = source.slice(boundariesStart, boundariesEnd);
  assert.match(boundaries, /buyerIntentMeasurement\s*\?/);
  assert.match(
    boundaries,
    /buyerIntentMeasurement\.durationDays \|\| 30[\s\S]*buyerIntentMeasurement\.exposureTarget \|\| 100/,
  );
  assert.match(
    boundaries,
    /data\.pilotPolicy\.testDurationDays \|\| 14[\s\S]*data\.pilotPolicy\.qualifiedViewTarget \|\| 50/,
  );
  assert.ok(
    boundaries.indexOf("buyerIntentMeasurement.durationDays")
      < boundaries.indexOf("data.pilotPolicy.testDurationDays"),
    "the exact buyer-intent branch must precede the generic pilot fallback",
  );
});

test("dashboard does not offer discovery or run controls beside an approval-gated continuation", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "public", "app.js"),
    "utf8",
  );
  const renderTestsStart = source.indexOf("function renderTests");
  const renderTestsEnd = source.indexOf("\nfunction initials", renderTestsStart);
  const renderTestsProjection = source.slice(renderTestsStart, renderTestsEnd);

  assert.match(
    renderTestsProjection,
    /const activeDiscoveryRound = latestRound\s*&& \["researching", "validating", "checking_economics", "structuring_offer"\]\.includes\(latestRound\.status\)/,
  );
  assert.match(
    renderTestsProjection,
    /const hasProductionContinuation = Boolean\([\s\S]*buyerIntentPlanMatches[\s\S]*!\["complete", "completed", "cancelled", "archived"\]\.includes\(productionPlan\.status\)/,
  );
  assert.match(
    renderTestsProjection,
    /activeDiscoveryRound && !hasProductionContinuation \? `<button class="primary-button" data-action="run-pantheon"/,
  );
  assert.match(
    renderTestsProjection,
    /const runnableInternalTask = production\.currentTask\s*&& \["planned", "queued"\]\.includes\(production\.currentTask\.status\)/,
  );
  assert.match(
    renderTestsProjection,
    /productionPlan && \["quality_review", "preparing_launch"\]\.includes\(productionPlan\.status\) && runnableInternalTask/,
  );
  assert.doesNotMatch(
    renderTestsProjection,
    /production\.currentTask\.status !== "running"/,
  );
});
