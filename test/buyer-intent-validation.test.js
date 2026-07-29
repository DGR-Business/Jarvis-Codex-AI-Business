const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  BUYER_INTENT_VALIDATION_SPEC_LIFECYCLE,
  SOCIAL_MEDIA_MANAGER_CLIENT_CONTROL_V1: spec,
} = require("../config/buyer-intent-validation-specs");
const {
  get,
  now,
  openDatabase,
  run,
  seedDatabase,
  toJson,
} = require("../src/db");
const {
  finalizeBuyerIntentValidationSample,
  prepareBuyerIntentValidationRecords,
  prepareBuyerIntentValidationRecordsForTest,
} = require("../src/runtime/buyer-intent-validation");
const { getCockpitState } = require("../src/runtime/cockpit-state");
const { prepareCatalogueBuild } = require("../src/runtime/pantheon-production");
const { createApp } = require("../src/server");

function runtimeDb() {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "pantheon-buyer-intent-"),
  );
  const db = openDatabase(path.join(root, "runtime.sqlite"));
  seedDatabase(db);
  return { db, root };
}

function closeRuntime(runtime) {
  runtime.db.close();
  fs.rmSync(runtime.root, { recursive: true, force: true });
}

function commercialCreationCounts(db) {
  return Object.fromEntries(
    [
      "workflows",
      "tasks",
      "approvals",
      "commercial_experiments",
      "commercial_execution_packs",
      "catalogue_plans",
      "model_calls",
      "costs",
    ].map((table) => [
      table,
      Number(get(db, `SELECT COUNT(*) AS count FROM ${table}`).count),
    ]),
  );
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
      recommendation, smallest_validation, evidence_ids, metadata, created_at,
      updated_at)
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
     VALUES (?, ?, ?, ?, 'parked', 'commercial_investment_review',
             'research_more', '{}', ?, ?, ?, '{}', '{}', '{}', '{}', '{}',
             '["Direct willingness to pay"]', 'medium',
             'Nine of ten gates passed.',
             'Build one functional sample only.', ?, ?, ?, ?)`,
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
  return { caseId, opportunityId };
}

function assertRetired(error) {
  return error.statusCode === 410
    && error.code === "legacy_commercial_path_retired";
}

test("the stopped historical buyer-intent specification cannot be exposed or prepared again", async () => {
  const runtime = runtimeDb();
  let app = null;
  try {
    const fixture = insertInvestmentFixture(runtime.db);
    const before = commercialCreationCounts(runtime.db);
    assert.equal(
      BUYER_INTENT_VALIDATION_SPEC_LIFECYCLE[spec.id].status,
      "terminal_stopped",
    );
    assert.throws(
      () => prepareBuyerIntentValidationRecords(runtime.db, fixture.caseId, {
        specId: spec.id,
        expectedDecisionHash: spec.decisionHash,
      }),
      assertRetired,
    );
    assert.throws(
      () => finalizeBuyerIntentValidationSample(runtime.db, {}),
      assertRetired,
    );
    assert.deepEqual(commercialCreationCounts(runtime.db), before);

    app = createApp({
      db: runtime.db,
      dbPath: path.join(runtime.root, "unused.sqlite"),
      security: false,
    });
    await new Promise((resolve) => {
      app.server.listen(0, "127.0.0.1", resolve);
    });
    const baseUrl = `http://127.0.0.1:${app.server.address().port}`;
    const detail = await fetch(
      `${baseUrl}/api/commercial/investment-cases/${encodeURIComponent(fixture.caseId)}`,
    ).then((response) => response.json());
    assert.equal(detail.buyerIntentOption, null);

    const response = await fetch(
      `${baseUrl}/api/commercial/investment-cases/${encodeURIComponent(fixture.caseId)}/prepare-buyer-intent-test`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          specId: spec.id,
          expectedDecisionHash: spec.decisionHash,
        }),
      },
    );
    assert.equal(response.status, 410);
    assert.match((await response.json()).error, /retired/i);
    assert.deepEqual(commercialCreationCounts(runtime.db), before);
  } finally {
    if (app) {
      await new Promise((resolve) => app.wss.close(resolve));
      await new Promise((resolve) => app.server.close(resolve));
    }
    closeRuntime(runtime);
  }
});

test("the frozen buyer-intent fixture remains hash-bound but cannot cross into production", () => {
  const runtime = runtimeDb();
  try {
    const fixture = insertInvestmentFixture(runtime.db);
    assert.throws(
      () => prepareBuyerIntentValidationRecordsForTest(
        runtime.db,
        fixture.caseId,
        {
          specId: spec.id,
          expectedDecisionHash: "stale",
        },
      ),
      /investment case changed/i,
    );

    const prepared = prepareBuyerIntentValidationRecordsForTest(
      runtime.db,
      fixture.caseId,
      {
        specId: spec.id,
        expectedDecisionHash: spec.decisionHash,
      },
    );
    assert.equal(prepared.plan.target_item_count, 1);
    assert.equal(prepared.contract.investmentCaseRemainsParked, true);
    assert.equal(prepared.experiment.status, "candidate");
    assert.equal(prepared.workflow.status, "waiting_for_operator");

    const beforeProductionAttempt = commercialCreationCounts(runtime.db);
    assert.throws(
      () => prepareCatalogueBuild(runtime.db, {
        planId: prepared.plan.id,
        opportunityId: fixture.opportunityId,
        operatorChoiceRequired: true,
      }),
      (error) => error.statusCode === 410
        && error.code === "commercial_program_terminal",
    );
    assert.deepEqual(
      commercialCreationCounts(runtime.db),
      beforeProductionAttempt,
    );

    const repeated = prepareBuyerIntentValidationRecordsForTest(
      runtime.db,
      fixture.caseId,
      {
        specId: spec.id,
        expectedDecisionHash: spec.decisionHash,
      },
    );
    assert.equal(repeated.plan.id, prepared.plan.id);
    assert.equal(repeated.experiment.id, prepared.experiment.id);
    assert.equal(
      get(
        runtime.db,
        "SELECT status FROM commercial_decision_cases WHERE id = ?",
        [fixture.caseId],
      ).status,
      "parked",
    );
  } finally {
    closeRuntime(runtime);
  }
});

test("historical buyer-intent records stay audit-only and cannot become current buyer or cash truth", () => {
  const runtime = runtimeDb();
  try {
    const fixture = insertInvestmentFixture(runtime.db);
    prepareBuyerIntentValidationRecordsForTest(
      runtime.db,
      fixture.caseId,
      {
        specId: spec.id,
        expectedDecisionHash: spec.decisionHash,
      },
    );
    const before = commercialCreationCounts(runtime.db);
    assert.throws(
      () => finalizeBuyerIntentValidationSample(runtime.db, {
        planId: "historical-plan",
        buildTaskId: "historical-build",
        qualityTaskId: "historical-review",
        generated: {},
      }),
      assertRetired,
    );
    assert.deepEqual(commercialCreationCounts(runtime.db), before);
    assert.equal(
      get(
        runtime.db,
        "SELECT COUNT(*) AS count FROM commercial_execution_packs",
      ).count,
      0,
    );

    const cockpit = getCockpitState(runtime.db);
    assert.equal(cockpit.currentTest, null);
    assert.equal(cockpit.buyerIntentValidation, null);
    assert.deepEqual(cockpit.historicalCommercialContext, {
      exists: true,
      label: "Historical buyer-intent record retained for audit only.",
      authoritative: false,
      currentBuyerOrCashEvidence: false,
    });
    assert.equal(cockpit.economics.cashContributionCents, null);
  } finally {
    closeRuntime(runtime);
  }
});
