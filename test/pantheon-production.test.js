const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const AdmZip = require("adm-zip");

const CONFIG = require("../src/config");
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
const {
  __setAgentRuntimeSdkRunnerForTests,
  __setContainerFileDownloaderForTests,
} = require("../src/runtime/agent-runtime");
const { getAgentHandoff } = require("../src/runtime/ai-team");
const { getCockpitState, getDecisionsState } = require("../src/runtime/cockpit-state");
const { runOnce } = require("../src/runtime/orchestrator");
const {
  applyPantheonHandoffDecision,
  getProductionState,
  prepareCatalogueBuild,
  projectCompletedProductionTask,
} = require("../src/runtime/pantheon-production");
const { runPantheonSupervisorCycle } = require("../src/runtime/pantheon-supervisor");

function makeRuntime(name) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `pantheon-production-${name}-`));
  const db = openDatabase(path.join(root, "runtime.sqlite"));
  seedDatabase(db);
  seedCatalogue(db);
  return { root, db };
}

function closeRuntime(runtime) {
  runtime.db.close();
  fs.rmSync(runtime.root, { recursive: true, force: true });
}

function seedCatalogue(db) {
  const ts = now();
  run(
    db,
    `INSERT INTO workflows
     (id, venture_id, type, title, status, current_step, priority, metadata, created_at, updated_at)
     VALUES ('wf-pantheon-production', 'venture-digital-products', 'pantheon_commercial_discovery',
       'Cash control template catalogue', 'agent_running', 'Catalogue plan ready', 1, '{}', ?, ?)`,
    [ts, ts],
  );
  run(
    db,
    `INSERT INTO commands
     (id, venture_id, source, raw_text, intent, status, workflow_id, summary, metadata, created_at, updated_at)
     VALUES ('cmd-pantheon-production', 'venture-digital-products', 'test',
       'Build a useful cash-control template catalogue.', 'commercial_discovery', 'running',
       'wf-pantheon-production', 'Build the approved catalogue.', '{}', ?, ?)`,
    [ts, ts],
  );
  run(
    db,
    `INSERT INTO opportunity_rounds
     (id, venture_id, status, mode, prompt, geography, language, max_candidates,
      started_at, created_by, metadata, created_at, updated_at)
     VALUES ('round-pantheon-production', 'venture-digital-products', 'ready_to_build',
       'operator_idea', 'Cash control tools', 'Australia', 'English', 3, ?,
       'test', ?, ?, ?)`,
    [
      ts,
      toJson({ workflowId: "wf-pantheon-production", commandId: "cmd-pantheon-production" }),
      ts,
      ts,
    ],
  );
  run(
    db,
    `INSERT INTO opportunities
     (id, round_id, venture_id, source_type, status, title, business_model, buyer, problem,
      offer_direction, geography, language, channel, overall_score, confidence,
      recommendation, smallest_validation, evidence_ids, metadata, created_at, updated_at)
     VALUES ('opp-pantheon-production', 'round-pantheon-production', 'venture-digital-products',
       'reviewed_fixture', 'ready_to_build', 'Freelancer Cash Control Toolkit',
       'Digital spreadsheet template', 'Australian freelancers',
       'Irregular income makes weekly cash decisions difficult.',
       'A practical spreadsheet and guide bundle', 'Australia', 'English', 'Gumroad',
       84, 'medium', 'Build the minimum credible catalogue.',
       'Measure qualified views, paid buyers and net contribution.', '[]', '{}', ?, ?)`,
    [ts, ts],
  );
  run(
    db,
    `INSERT INTO catalogue_plans
     (id, venture_id, opportunity_id, status, title, rationale, target_item_count,
      target_variant_count, audience_segments, channels, geographies, languages,
      price_floor_cents, price_ceiling_cents, metadata, created_at, updated_at)
     VALUES ('plan-pantheon-production', 'venture-digital-products', 'opp-pantheon-production',
       'planned', 'Freelancer cash-control catalogue', 'Two useful variants for the proof.',
       2, 1, '["Australian freelancers"]', '["Gumroad"]', '["Australia"]', '["English"]',
       2900, 3900, ?, ?, ?)`,
    [toJson({ buildStatus: "not_started", noSellableFilesClaimed: true }), ts, ts],
  );
  for (const [index, title] of ["Weekly Cash Planner", "Quarterly Tax Reserve Planner"].entries()) {
    run(
      db,
      `INSERT INTO catalogue_items
       (id, plan_id, venture_id, status, quality_status, title, product_type, audience,
        geography, language, offer, price_cents, metadata, created_at, updated_at)
       VALUES (?, 'plan-pantheon-production', 'venture-digital-products', 'planned',
        'not_reviewed', ?, 'Digital spreadsheet template', 'Australian freelancers',
        'Australia', 'English', ?, 2900, ?, ?, ?)`,
      [
        `catalogue-item-${index + 1}`,
        title,
        `${title} with setup instructions and realistic sample data.`,
        toJson({ sequence: index + 1, exactSpecificationRequired: true }),
        ts,
        ts,
      ],
    );
  }
}

function prepareBuild(db) {
  return prepareCatalogueBuild(db, {
    roundId: "round-pantheon-production",
    opportunityId: "opp-pantheon-production",
    planId: "plan-pantheon-production",
    operatorChoiceRequired: true,
  });
}

function approve(db, approval) {
  return decideApproval(db, approval.id, "approved", "Approve this exact local catalogue build.", {
    expectedScopeHash: approval.scope_hash,
  });
}

function workerOutput(worker, work = {}) {
  return {
    summary: `${worker} completed the exact internal assignment.`,
    recommendation: "Continue only inside the protected Pantheon workflow.",
    evidence: ["The exact approved records and locally retained output were used."],
    risks: ["Real buyer demand remains unproven until a measured market test."],
    nextAction: "Continue to the next protected review step.",
    operatorDecision: "approve",
    confidence: "medium",
    work,
    roleOutput: work,
  };
}

function completeTask(db, taskId, output) {
  const ts = now();
  run(
    db,
    `UPDATE tasks
     SET status = 'completed', result = ?, outcome_status = 'known',
         completed_at = ?, updated_at = ?
     WHERE id = ?`,
    [toJson({ output }), ts, ts, taskId],
  );
  return get(db, "SELECT * FROM tasks WHERE id = ?", [taskId]);
}

function insertGeneratedDeliverables(db, task) {
  const root = path.join(CONFIG.artifactRoot, "production-test");
  fs.mkdirSync(root, { recursive: true });
  const manifestPath = path.join(root, "pantheon-product-manifest.json");
  const bundlePath = path.join(root, "cash-control-catalogue.zip");
  const manifest = {
    schema: "pantheon.product-manifest.v1",
    version: 1,
    planId: "plan-pantheon-production",
    opportunityId: "opp-pantheon-production",
    catalogueItems: [
      { id: "catalogue-item-1", files: ["weekly-cash-planner.csv"] },
      { id: "catalogue-item-2", files: ["quarterly-tax-reserve.csv"] },
    ],
  };
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  const zip = new AdmZip();
  zip.addFile("weekly-cash-planner.csv", Buffer.from("week,income,expense\n1,1000,400\n"));
  zip.addFile("quarterly-tax-reserve.csv", Buffer.from("quarter,income,tax_reserve\nQ1,12000,3000\n"));
  zip.writeZip(bundlePath);

  const ts = now();
  const files = [
    {
      id: "deliv-product-manifest",
      humanName: "pantheon-product-manifest.json",
      format: "application/json",
      filePath: path.relative(CONFIG.rootDir, manifestPath).replace(/\\/g, "/"),
      bytes: fs.statSync(manifestPath).size,
      sha256: "manifest-fixture-hash",
      manifest: true,
    },
    {
      id: "deliv-product-bundle",
      humanName: "cash-control-catalogue.zip",
      format: "application/zip",
      filePath: path.relative(CONFIG.rootDir, bundlePath).replace(/\\/g, "/"),
      bytes: fs.statSync(bundlePath).size,
      sha256: "bundle-fixture-hash",
      manifest: false,
    },
  ];
  for (const file of files) {
    run(
      db,
      `INSERT INTO deliverables
       (id, workflow_id, task_id, venture_id, title, human_name, audience, format,
        status, file_path, summary, metadata, content_hash, version, created_at, updated_at)
       VALUES (?, ?, ?, 'venture-digital-products', ?, ?, 'operator', ?,
        'built_pending_quality_review', ?, 'Validated production test file.', '{}', ?, 1, ?, ?)`,
      [
        file.id,
        task.workflow_id,
        task.id,
        file.manifest ? "Product Manifest" : "Generated Product File",
        file.humanName,
        file.format,
        file.filePath,
        file.sha256,
        ts,
        ts,
      ],
    );
  }
  return { files, manifest };
}

test("the operator build choice stays protected and the supervisor cannot silently approve it", async () => {
  const runtime = makeRuntime("operator-boundary");
  try {
    const build = prepareBuild(runtime.db);
    assert.equal(build.task.status, "blocked");
    assert.equal(build.approval.status, "pending");
    assert.equal(build.spec.catalogueItems.length, 2);
    assert.equal(build.spec.supportedByCurrentFactory, true);

    const cycle = await runPantheonSupervisorCycle(runtime.db, {
      triggerType: "test",
      startedBy: "pantheon-production-test",
      maxSteps: 2,
    });
    assert.equal(cycle.status, "waiting_for_operator");
    assert.equal(cycle.cycle.next_action_type, "review_internal_work");
    assert.equal(get(runtime.db, "SELECT status FROM approvals WHERE id = ?", [build.approval.id]).status, "pending");
    assert.equal(get(runtime.db, "SELECT COUNT(*) AS count FROM model_calls").count, 0);
    const cockpit = getCockpitState(runtime.db);
    assert.equal(cockpit.importantWork[0].title, "Build the 2-product catalogue?");
    assert.equal(cockpit.importantWork[0].approveLabel, "Build this catalogue");
    assert.equal(cockpit.commercialDiscovery.production.plans[0].status, "waiting_for_build_decision");
  } finally {
    closeRuntime(runtime);
  }
});

test("Product Builder downloads and validates a real manifest and bundle before completion", async () => {
  const previous = {
    key: process.env.OPENAI_API_KEY,
    liveModels: process.env.PANTHEON_ENABLE_LIVE_MODELS,
    disabledAdapter: process.env.PANTHEON_DISABLE_LIVE_AI_WORKER_ADAPTER,
    disabledSdk: process.env.PANTHEON_DISABLE_OPENAI_AGENTS_SDK,
    rate: process.env.PANTHEON_API_CREDIT_AUD_PER_USD,
  };
  process.env.OPENAI_API_KEY = "test-pantheon-product-key";
  process.env.PANTHEON_ENABLE_LIVE_MODELS = "1";
  process.env.PANTHEON_API_CREDIT_AUD_PER_USD = "2";
  delete process.env.PANTHEON_DISABLE_LIVE_AI_WORKER_ADAPTER;
  delete process.env.PANTHEON_DISABLE_OPENAI_AGENTS_SDK;

  const runtime = makeRuntime("file-factory");
  try {
    const build = prepareBuild(runtime.db);
    approve(runtime.db, get(runtime.db, "SELECT * FROM approvals WHERE id = ?", [build.approval.id]));
    const manifest = {
      schema: "pantheon.product-manifest.v1",
      version: 1,
      planId: build.spec.planId,
      opportunityId: build.spec.opportunityId,
      catalogueItems: build.spec.catalogueItems.map((item, index) => ({
        id: item.id,
        files: [`product-${index + 1}.csv`],
      })),
    };
    const zip = new AdmZip();
    for (const [index] of build.spec.catalogueItems.entries()) {
      zip.addFile(`product-${index + 1}.csv`, Buffer.from(`item,value\n${index + 1},ready\n`));
    }
    const bundleBytes = zip.toBuffer();
    const downloads = new Map([
      ["manifest-file", {
        filename: build.spec.manifestFilename,
        bytes: Buffer.from(JSON.stringify(manifest)),
      }],
      ["bundle-file", {
        filename: build.spec.bundleFilename,
        bytes: bundleBytes,
      }],
    ]);
    __setContainerFileDownloaderForTests(async (citation) => downloads.get(citation.fileId));
    __setAgentRuntimeSdkRunnerForTests(async () => ({
      finalOutput: workerOutput("Product Builder", {
        productFormat: "ZIP catalogue with CSV templates",
        assetPlan: ["Two complete spreadsheet templates", "One product manifest"],
        productionMethod: "OpenAI Code Interpreter in an isolated container",
        producedFiles: [build.spec.bundleFilename, build.spec.manifestFilename],
        catalogueCoverage: build.spec.catalogueItems.map((item) => item.id),
        qualityChecks: ["Manifest coverage", "Archive validation", "Sample data present"],
        limitations: ["Semantic usefulness still needs independent review"],
        approvalNeeded: "Quality review before launch preparation",
        channelFit: "Gumroad digital download",
      }),
      lastResponseId: "resp-pantheon-product-build",
      rawResponses: [{
        responseId: "resp-pantheon-product-build",
        usage: { input_tokens: 900, output_tokens: 500, total_tokens: 1400 },
        output: [
          {
            type: "code_interpreter_call",
            id: "code-pantheon-product-build",
            status: "completed",
            container_id: "container-pantheon-product-build",
          },
          {
            type: "message",
            id: "message-pantheon-product-build",
            content: [{
              type: "output_text",
              text: "The manifest and catalogue bundle are ready.",
              annotations: [
                {
                  type: "container_file_citation",
                  container_id: "container-pantheon-product-build",
                  file_id: "manifest-file",
                  filename: build.spec.manifestFilename,
                },
                {
                  type: "container_file_citation",
                  container_id: "container-pantheon-product-build",
                  file_id: "bundle-file",
                  filename: build.spec.bundleFilename,
                },
              ],
            }],
          },
        ],
      }],
      runContext: { usage: { inputTokens: 900, outputTokens: 500, totalTokens: 1400 } },
      lastAgent: { name: "Product Builder" },
      interruptions: [],
    }));

    const executed = await runOnce(runtime.db, { taskId: build.task.id });
    assert.equal(executed.status, "completed", executed.error || JSON.stringify(executed));
    assert.equal(executed.result.output.generatedFiles.files.length, 2);
    assert.equal(executed.result.output.generatedFiles.manifest.planId, build.spec.planId);
    assert.equal(executed.result.qualityGate.status, "not_required");
    assert.equal(
      get(runtime.db, "SELECT COUNT(*) AS count FROM deliverables WHERE task_id = ? AND status = 'built_pending_quality_review'", [build.task.id]).count,
      2,
    );
    assert.equal(
      get(runtime.db, "SELECT COUNT(*) AS count FROM deliverables WHERE workflow_id = ? AND format = 'pdf'", [build.task.workflow_id]).count,
      0,
      "Supervisor-owned internal work must not generate an operator PDF at every worker boundary.",
    );
    assert.equal(get(runtime.db, "SELECT COUNT(*) AS count FROM agent_handoffs WHERE task_id = ?", [build.task.id]).count, 0);
  } finally {
    closeRuntime(runtime);
    __setAgentRuntimeSdkRunnerForTests(null);
    __setContainerFileDownloaderForTests(null);
    for (const [name, value] of [
      ["OPENAI_API_KEY", previous.key],
      ["PANTHEON_ENABLE_LIVE_MODELS", previous.liveModels],
      ["PANTHEON_DISABLE_LIVE_AI_WORKER_ADAPTER", previous.disabledAdapter],
      ["PANTHEON_DISABLE_OPENAI_AGENTS_SDK", previous.disabledSdk],
      ["PANTHEON_API_CREDIT_AUD_PER_USD", previous.rate],
    ]) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

test("finished files flow through quality, copy and launch planning to one real operator boundary", () => {
  const runtime = makeRuntime("launch-boundary");
  try {
    const build = prepareBuild(runtime.db);
    const generated = insertGeneratedDeliverables(runtime.db, build.task);
    completeTask(runtime.db, build.task.id, {
      ...workerOutput("Product Builder", {
        productFormat: "ZIP catalogue",
        producedFiles: generated.files.map((file) => file.humanName),
        catalogueCoverage: ["catalogue-item-1", "catalogue-item-2"],
      }),
      generatedFiles: generated,
    });
    const buildProjection = projectCompletedProductionTask(runtime.db, build.task.id);
    assert.equal(buildProjection.stage, "product_build");
    const qualityTask = buildProjection.result.next.task;
    assert.equal(qualityTask.agent, "quality_reviewer");

    completeTask(runtime.db, qualityTask.id, workerOutput("Quality Reviewer", {
      qualityScore: 92,
      riskFindings: [],
      missingEvidence: [],
      claimSafety: "safe",
      operatorRecommendation: "Continue to launch preparation.",
    }));
    const qualityProjection = projectCompletedProductionTask(runtime.db, qualityTask.id);
    assert.equal(qualityProjection.result.verdict.passed, true);
    const copyTask = qualityProjection.result.next.task;
    assert.equal(copyTask.agent, "copy_conversion_agent");

    completeTask(runtime.db, copyTask.id, workerOutput("Copy and Conversion Agent", {
      headline: "Know what your freelance cash can safely do this week",
      description: "Two practical templates for weekly decisions and quarterly reserves.",
      callToAction: "Download the toolkit",
      messageVariants: ["Plan the week", "Protect the quarter"],
      claimChecks: ["No guaranteed financial outcome"],
      trackingNote: "Use qualified Gumroad views and paid purchases.",
    }));
    const copyProjection = projectCompletedProductionTask(runtime.db, copyTask.id);
    const distributionTask = copyProjection.result.next.task;
    assert.equal(distributionTask.agent, "distribution_operator");

    completeTask(runtime.db, distributionTask.id, workerOutput("Distribution Agent", {
      audience: "Australian freelancers",
      channelSteps: ["Publish the reviewed Gumroad listing", "Share up to three approved organic posts"],
      evidenceToCapture: ["Qualified product views", "Paid buyers", "Refunds", "Net contribution"],
      successMetric: "Three independent paid buyers and positive net cash contribution",
      stopRule: "Diagnose reach, offer, price and checkout after 14 days or 50 qualified views.",
      operatorWorkload: "Review the listing, complete private Gumroad setup, and press Publish.",
    }));
    const distributionProjection = projectCompletedProductionTask(runtime.db, distributionTask.id);
    const plan = distributionProjection.plan;
    assert.equal(plan.status, "launch_decision");
    assert.ok(plan.metadata.launchDecisionHandoffId);
    assert.ok(plan.metadata.approvalPackDeliverableId);
    assert.equal(get(runtime.db, "SELECT status FROM commercial_experiments").status, "ready");
    assert.equal(get(runtime.db, "SELECT COUNT(*) AS count FROM deliverables WHERE format = 'pdf'").count, 1);
    const decisions = getDecisionsState(runtime.db);
    const launchChoice = decisions.approvals.find((item) => item.decisionActionKind === "launch_readiness");
    assert.equal(launchChoice.title, "Decide whether this product should move to publish-ready");
    assert.equal(launchChoice.approveLabel, "Move to publish-ready");

    const handoff = getAgentHandoff(runtime.db, plan.metadata.launchDecisionHandoffId);
    const decision = applyPantheonHandoffDecision(runtime.db, handoff, "approve", "Proceed to the separate real publishing action.");
    assert.equal(decision.externalActionCompleted, false);
    assert.equal(decision.plan.status, "ready_to_publish");
    assert.equal(getProductionState(runtime.db).readyToPublish.length, 1);
    const operatorMessage = get(runtime.db, "SELECT * FROM messages WHERE subject = 'Publish the approved product test'");
    assert.ok(operatorMessage);
    assert.match(operatorMessage.body, /press Publish/);
  } finally {
    closeRuntime(runtime);
  }
});
