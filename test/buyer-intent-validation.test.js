const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const CONFIG = require("../src/config");
const {
  SOCIAL_MEDIA_MANAGER_CLIENT_CONTROL_V1: spec,
} = require("../config/buyer-intent-validation-specs");
const { all, fromJson, get, now, openDatabase, run, seedDatabase, toJson } = require("../src/db");
const {
  finalizeBuyerIntentValidationSample,
  prepareBuyerIntentValidationRecords,
} = require("../src/runtime/buyer-intent-validation");
const {
  getBusinessTestsState,
  getCockpitState,
  getTestDetail,
} = require("../src/runtime/cockpit-state");
const { classifyInternalApproval } = require("../src/runtime/pantheon-policy");
const { prepareCatalogueBuild } = require("../src/runtime/pantheon-production");

function runtimeDb() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pantheon-buyer-intent-"));
  const artifactRoot = path.join(
    CONFIG.artifactRoot,
    "tests",
    path.basename(root),
  );
  fs.mkdirSync(artifactRoot, { recursive: true });
  const db = openDatabase(path.join(root, "runtime.sqlite"));
  seedDatabase(db);
  return { db, root, artifactRoot };
}

function closeRuntime(runtime) {
  runtime.db.close();
  fs.rmSync(runtime.root, { recursive: true, force: true });
  fs.rmSync(runtime.artifactRoot, { recursive: true, force: true });
}

function insertInvestmentFixture(db) {
  const timestamp = now();
  const ventureId = "venture-portfolio-controller";
  const roundId = "round_buyer_intent_fixture";
  const opportunityId = "opportunity_buyer_intent_fixture";
  const caseId = "investment_case_buyer_intent_fixture";
  run(
    db,
    `INSERT OR IGNORE INTO ventures
     (id, name, stage, status, summary, metadata, created_at, updated_at,
      lifecycle_stage, is_active, business_model)
     VALUES (?, 'Portfolio Controller', 1, 'active', '', '{}', ?, ?,
             'Candidate', 0, 'portfolio')`,
    [ventureId, timestamp, timestamp],
  );
  run(
    db,
    `INSERT INTO opportunity_rounds
     (id, venture_id, status, mode, prompt, geography, language, max_candidates,
      started_at, completed_at, created_by, metadata, created_at, updated_at)
     VALUES (?, ?, 'no_investment', 'targeted_diligence', 'Test fixture',
             'Australia', 'English', 1, ?, ?, 'test', ?, ?, ?)`,
    [
      roundId,
      ventureId,
      timestamp,
      timestamp,
      toJson({ workflowId: null, productionBlocked: true }),
      timestamp,
      timestamp,
    ],
  );
  run(
    db,
    `INSERT INTO opportunities
     (id, round_id, venture_id, source_type, status, title, business_model,
      buyer, problem, offer_direction, geography, language, channel,
      demand_score, supply_gap_score, economics_score, channel_fit_score,
      execution_fit_score, risk_score, overall_score, confidence,
      recommendation, smallest_validation, evidence_ids, metadata, created_at, updated_at)
     VALUES (?, ?, ?, 'targeted_diligence', 'parked', ?, 'digital product',
             ?, ?, ?, 'Australia', 'English', ?, 70, 60, 50, 70, 85, 35, 67,
             'medium', 'Run one bounded functional buyer test.', ?,
             '[]', ?, ?, ?)`,
    [
      opportunityId,
      roundId,
      ventureId,
      spec.opportunityTitle,
      spec.buyer,
      spec.problem,
      spec.offer,
      spec.channel.label,
      spec.measurement.qualificationQuestion,
      toJson({
        validation: {
          smallestTest: spec.measurement.qualificationQuestion,
          metric: spec.measurement.passRule,
          stopRule: spec.measurement.stopRule,
        },
      }),
      timestamp,
      timestamp,
    ],
  );
  run(
    db,
    `INSERT INTO commercial_decision_cases
     (id, opportunity_id, venture_id, round_id, status, stage, recommendation,
      model_route, buyer, problem, offer, evidence_summary, economics,
      channel_strategy, alternatives, criteria, missing_evidence, confidence,
      rationale, next_action, decision_hash, reviewed_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'parked', 'commercial_investment_review', 'research_more',
             '{}', ?, ?, ?, '{}', '{}', '{}', '{}', '{}',
             '["Direct willingness to pay"]', 'medium',
             'Nine of ten gates passed.', 'Build one functional sample only.', ?,
             ?, ?, ?)`,
    [
      caseId,
      opportunityId,
      ventureId,
      roundId,
      spec.buyer,
      spec.problem,
      spec.offer,
      spec.decisionHash,
      timestamp,
      timestamp,
      timestamp,
    ],
  );
  return { caseId, opportunityId, roundId, ventureId };
}

function insertCompletedAgentRun(db, {
  id,
  taskId,
  workflowId,
  agentId,
  score,
}) {
  const timestamp = now();
  const modelCallId = `model_${id}`;
  run(
    db,
    `INSERT INTO model_calls
     (id, workflow_id, task_id, provider, model_class, selected_model, mode,
      status, metadata, created_at, provider_request_id, cost_status,
      outcome_status, completed_at)
     VALUES (?, ?, ?, 'openai', 'test-worker', 'gpt-5.6-luna', 'live',
             'completed', '{}', ?, ?, 'incurred_estimate', 'known', ?)`,
    [
      modelCallId,
      workflowId,
      taskId,
      timestamp,
      `resp_${id}`,
      timestamp,
    ],
  );
  run(
    db,
    `INSERT INTO agent_runs
     (id, agent_id, workflow_id, task_id, mode, status, input_summary,
      output_summary, model_call_id, estimated_cost_cents, actual_cost_cents,
      approval_required, handoff_to, eval_status, metadata, started_at, completed_at)
     VALUES (?, ?, ?, ?, 'live', 'completed', 'Frozen test input',
             'Known completed result', ?, 0, 0, 1, NULL, 'passed', '{}', ?, ?)`,
    [id, agentId, workflowId, taskId, modelCallId, timestamp, timestamp],
  );
  run(
    db,
    `INSERT INTO agent_eval_results
     (id, run_id, agent_id, task_id, status, score, criteria, findings, metadata, created_at)
     VALUES (?, ?, ?, ?, 'passed', ?, '[]', '[]', '{}', ?)`,
    [`eval_${id}`, id, agentId, taskId, score, timestamp],
  );
}

test("buyer-intent preparation is hash-bound, idempotent, one-product, and externally inert", () => {
  const runtime = runtimeDb();
  try {
    const fixture = insertInvestmentFixture(runtime.db);
    assert.throws(
      () => prepareBuyerIntentValidationRecords(runtime.db, fixture.caseId, {
        specId: spec.id,
        expectedDecisionHash: "stale",
      }),
      /investment case changed/i,
    );

    const prepared = prepareBuyerIntentValidationRecords(runtime.db, fixture.caseId, {
      specId: spec.id,
      expectedDecisionHash: spec.decisionHash,
    });
    assert.equal(prepared.plan.target_item_count, 1);
    assert.equal(prepared.contract.investmentCaseRemainsParked, true);
    assert.equal(prepared.experiment.status, "candidate");
    assert.equal(prepared.workflow.status, "waiting_for_operator");
    assert.equal(
      get(runtime.db, "SELECT status FROM commercial_decision_cases WHERE id = ?", [fixture.caseId]).status,
      "parked",
    );

    const build = prepareCatalogueBuild(runtime.db, {
      planId: prepared.plan.id,
      opportunityId: fixture.opportunityId,
      operatorChoiceRequired: true,
    });
    const request = build.task.payload.liveSpendRequest;
    assert.equal(build.spec.catalogueItems.length, 1);
    assert.equal(build.spec.storefrontPreviewCount, 2);
    assert.equal(build.spec.validationSample.specId, spec.id);
    assert.equal(request.model, require("../src/config").lunaModel);
    assert.equal(request.estimatedCostCents, spec.providerPolicy.productBuilderCapCents);
    assert.equal(request.maxInputTokens, 40000);
    assert.deepEqual(request.effects, []);
    assert.deepEqual(build.task.payload.contextSnapshot.recordClasses, [
      "venture",
      "production",
      "legal",
    ]);
    assert.equal(request.parameters.pantheonProduction.buyerIntentValidation.specId, spec.id);
    const classification = classifyInternalApproval(
      get(runtime.db, "SELECT * FROM approvals WHERE id = ?", [build.approval.id]),
    );
    assert.equal(classification.eligible, false);
    assert.equal(classification.reason, "manual_approval_required");

    const repeated = prepareBuyerIntentValidationRecords(runtime.db, fixture.caseId, {
      specId: spec.id,
      expectedDecisionHash: spec.decisionHash,
    });
    const repeatedBuild = prepareCatalogueBuild(runtime.db, {
      planId: repeated.plan.id,
      opportunityId: fixture.opportunityId,
      operatorChoiceRequired: true,
    });
    assert.equal(repeated.plan.id, prepared.plan.id);
    assert.equal(repeated.experiment.id, prepared.experiment.id);
    assert.equal(repeatedBuild.task.id, build.task.id);
    assert.equal(repeatedBuild.existing, true);
    assert.equal(
      get(
        runtime.db,
        `SELECT COUNT(*) AS count
         FROM tasks
         WHERE json_extract(payload, '$.liveSpendRequest.parameters.pantheonProduction.planId') = ?
           AND json_extract(payload, '$.liveSpendRequest.parameters.pantheonProduction.stage') = 'product_build'`,
        [prepared.plan.id],
      ).count,
      1,
    );

    const testsState = getBusinessTestsState(runtime.db);
    const surfaced = Object.values(testsState.tests).flat().find((item) => item.id === prepared.experiment.id);
    assert.ok(surfaced);
    assert.equal(surfaced.preVenture, true);
  } finally {
    closeRuntime(runtime);
  }
});

test("a quality-passed validation sample creates one exact buyer-test pack without simulated build workers", () => {
  const runtime = runtimeDb();
  try {
    const fixture = insertInvestmentFixture(runtime.db);
    const prepared = prepareBuyerIntentValidationRecords(runtime.db, fixture.caseId, {
      specId: spec.id,
      expectedDecisionHash: spec.decisionHash,
    });
    const build = prepareCatalogueBuild(runtime.db, {
      planId: prepared.plan.id,
      opportunityId: fixture.opportunityId,
      operatorChoiceRequired: true,
    });
    const timestamp = now();
    const qualityTaskId = "task_validation_quality_fixture";
    const cleanQualityOutput = {
      summary: "Passed.",
      operatorDecision: "approve",
      roleOutput: {
        qualityScore: 91,
        riskFindings: ["Buyer demand remains unproven until the bounded test runs."],
        missingEvidence: [],
        claimSafety: "Safe: the reviewed product claims match the exact customer files.",
      },
      risks: [],
    };
    const generated = {
      manifest: {
        schema: "pantheon.product-manifest.v1",
        planId: prepared.plan.id,
        opportunityId: fixture.opportunityId,
      },
      files: [
        { id: "deliverable_validation_xlsx", humanName: "Client Control Workbook.xlsx", format: "xlsx" },
        { id: "deliverable_validation_pdf", humanName: "Setup Guide.pdf", format: "pdf" },
        { id: "deliverable_validation_zip", humanName: "Validation Package.zip", format: "zip" },
      ],
      previews: [
        { id: "deliverable_validation_preview_1", humanName: "Workbook Preview 1.png", format: "png" },
        { id: "deliverable_validation_preview_2", humanName: "Workbook Preview 2.png", format: "png" },
      ],
    };
    for (const [index, file] of [...generated.files, ...generated.previews].entries()) {
      const bytes = Buffer.from(`exact-buyer-intent-fixture-${index}-${file.humanName}`);
      const filePath = path.join(runtime.artifactRoot, `${index}-${file.humanName}`);
      fs.writeFileSync(filePath, bytes);
      file.bytes = bytes.length;
      file.sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
      run(
        runtime.db,
        `INSERT INTO deliverables
         (id, workflow_id, command_id, task_id, venture_id, title, human_name,
          audience, format, status, file_path, summary, metadata, content_hash,
          created_at, updated_at)
         VALUES (?, ?, NULL, ?, ?, ?, ?, 'operator', ?, 'quality_passed',
                 ?, 'Fixture product file', ?, ?, ?, ?)`,
        [
          file.id,
          prepared.workflow.id,
          build.task.id,
          fixture.ventureId,
          file.humanName,
          file.humanName,
          file.format,
          filePath,
          toJson({ sha256: file.sha256, bytes: file.bytes }),
          file.sha256,
          timestamp,
          timestamp,
        ],
      );
    }
    run(
      runtime.db,
      `UPDATE tasks
       SET status = 'completed', outcome_status = 'known',
           result = ?, completed_at = ?, updated_at = ?
       WHERE id = ?`,
      [
        toJson({ output: { summary: "Built.", generatedFiles: generated } }),
        timestamp,
        timestamp,
        build.task.id,
      ],
    );
    run(
      runtime.db,
      `INSERT INTO tasks
       (id, workflow_id, venture_id, title, kind, agent, status, priority, retries,
        max_retries, approval_id, cost_budget_cents, cost_actual_cents,
        payload, result, error, due_at, started_at, completed_at, created_at,
        updated_at, outcome_status)
       VALUES (?, ?, ?, 'Review validation sample', 'live_ai_worker_execution',
               'quality_reviewer', 'completed', 2, 0, 0, NULL, 150, 0,
               ?, ?, NULL, NULL, ?, ?, ?, ?, 'known')`,
      [
        qualityTaskId,
        prepared.workflow.id,
        fixture.ventureId,
        toJson({
          liveSpendRequest: {
            parameters: {
              reviewOfTaskId: build.task.id,
              pantheonProduction: {
                planId: prepared.plan.id,
                stage: "quality_review",
                buildTaskId: build.task.id,
              },
            },
          },
        }),
        toJson({
          output: cleanQualityOutput,
        }),
        timestamp,
        timestamp,
        timestamp,
        timestamp,
      ],
    );
    const finalizationInput = {
      planId: prepared.plan.id,
      buildTaskId: build.task.id,
      qualityTaskId,
      generated,
    };
    const qualityOutputWith = (overrides = {}) => ({
      ...cleanQualityOutput,
      ...overrides,
      roleOutput: {
        ...cleanQualityOutput.roleOutput,
        ...(overrides.roleOutput || {}),
      },
    });
    const contradictoryApprovals = [
      {
        label: "missing evidence",
        output: qualityOutputWith({
          roleOutput: {
            missingEvidence: ["Page 3 of the setup guide has not been inspected."],
          },
        }),
      },
      {
        label: "material risk finding",
        output: qualityOutputWith({
          roleOutput: {
            riskFindings: ["The workbook formula is incorrect and returns the wrong result."],
          },
        }),
      },
      {
        label: "revise claim-safety verdict",
        output: qualityOutputWith({
          roleOutput: {
            claimSafety: "Revise: one benefit claim remains unsupported.",
          },
        }),
      },
      {
        label: "unsafe claim-safety verdict",
        output: qualityOutputWith({
          roleOutput: {
            claimSafety: "Unsafe: one customer-facing claim is misleading.",
          },
        }),
      },
      {
        label: "missing structured evidence fields",
        output: {
          summary: "Passed.",
          operatorDecision: "approve",
          roleOutput: {
            qualityScore: 91,
            claimSafety: "Safe: the claims are supported.",
          },
          risks: [],
        },
      },
    ];
    const unfinalizedPlan = get(
      runtime.db,
      "SELECT status, metadata FROM catalogue_plans WHERE id = ?",
      [prepared.plan.id],
    );
    for (const contradictory of contradictoryApprovals) {
      run(
        runtime.db,
        "UPDATE tasks SET result = ?, updated_at = ? WHERE id = ?",
        [toJson({ output: contradictory.output }), timestamp, qualityTaskId],
      );
      assert.throws(
        () => finalizeBuyerIntentValidationSample(runtime.db, finalizationInput),
        /Quality Reviewer did not pass the exact Product Builder output/i,
        contradictory.label,
      );
      assert.deepEqual(
        get(runtime.db, "SELECT status, metadata FROM catalogue_plans WHERE id = ?", [prepared.plan.id]),
        unfinalizedPlan,
        `${contradictory.label} must not advance the catalogue plan`,
      );
      assert.equal(
        get(runtime.db, "SELECT COUNT(*) AS count FROM commercial_execution_packs").count,
        0,
        `${contradictory.label} must not create an execution pack`,
      );
      assert.equal(
        get(runtime.db, "SELECT status FROM commercial_experiments WHERE id = ?", [prepared.experiment.id]).status,
        "candidate",
        `${contradictory.label} must not promote the experiment`,
      );
    }
    run(
      runtime.db,
      "UPDATE tasks SET result = ?, updated_at = ? WHERE id = ?",
      [toJson({ output: cleanQualityOutput }), timestamp, qualityTaskId],
    );
    insertCompletedAgentRun(runtime.db, {
      id: "run_validation_product_builder",
      taskId: build.task.id,
      workflowId: prepared.workflow.id,
      agentId: "product_builder",
      score: 92,
    });
    insertCompletedAgentRun(runtime.db, {
      id: "run_validation_quality_reviewer",
      taskId: qualityTaskId,
      workflowId: prepared.workflow.id,
      agentId: "quality_reviewer",
      score: 91,
    });

    const finalized = finalizeBuyerIntentValidationSample(runtime.db, finalizationInput);
    assert.equal(finalized.pack.status, "ready_to_test");
    assert.equal(finalized.pack.metadata.sampleDeliverables.length, 5);
    assert.match(finalized.pack.channel_plan, /does not create an account on Etsy/i);
    assert.match(finalized.pack.tracking_plan, /Pass:/);
    assert.match(finalized.pack.tracking_plan, /Inconclusive:/);
    assert.match(finalized.pack.tracking_plan, /Stop:/);
    assert.equal(
      get(runtime.db, "SELECT status FROM catalogue_plans WHERE id = ?", [prepared.plan.id]).status,
      "validation_sample_ready",
    );
    assert.equal(
      get(runtime.db, "SELECT status FROM commercial_decision_cases WHERE id = ?", [fixture.caseId]).status,
      "parked",
    );

    const protectedBuildPretence = all(
      runtime.db,
      `SELECT agent_id
       FROM agent_runs
       WHERE mode = 'protected'
         AND json_extract(metadata, '$.executionPackId') = ?
         AND agent_id IN ('product_builder', 'quality_reviewer')`,
      [finalized.pack.id],
    );
    assert.deepEqual(protectedBuildPretence, []);
    const detail = getTestDetail(runtime.db, prepared.experiment.id);
    assert.equal(detail.pack.id, finalized.pack.id);
    assert.equal(detail.sampleDeliverables.length, 5);
    assert.equal(detail.decisionHandoff.status, "needs_operator_decision");
    assert.equal(detail.buyerIntentValidation.measurement.exposureTarget, 100);
    const cockpit = getCockpitState(runtime.db);
    assert.equal(cockpit.currentTest.id, prepared.experiment.id);
    assert.equal(cockpit.buyerIntentValidation.status, "buyer_test_ready");
    assert.equal(cockpit.buyerIntentValidation.files.length, 5);

    const repeated = finalizeBuyerIntentValidationSample(runtime.db, finalizationInput);
    assert.equal(repeated.alreadyFinalized, true);
    assert.equal(repeated.pack.id, finalized.pack.id);
  } finally {
    closeRuntime(runtime);
  }
});
