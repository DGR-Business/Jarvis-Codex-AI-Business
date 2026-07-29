const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");
const test = require("node:test");

const {
  createResearchToExperimentPlan,
  createResearchToExperimentPlanFromResearch,
  createRevisionPlanFromLearning,
  inspectHistoricalCandidatePromotion,
  inspectHistoricalResearchToExperimentPlan,
  promoteCandidateToExperiment,
} = require("../src/runtime/research-to-experiment");
const {
  projectCompletedProductionTask,
} = require("../src/runtime/pantheon-production");

function digest(value) {
  return `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`;
}

function makeDatabase() {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    PRAGMA foreign_keys = ON;

    CREATE TABLE commercial_briefs (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      title TEXT NOT NULL,
      metadata TEXT NOT NULL
    );

    CREATE TABLE commercial_experiments (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      status TEXT NOT NULL,
      metadata TEXT NOT NULL
    );

    CREATE TABLE commercial_test_candidates (
      id TEXT PRIMARY KEY,
      brief_id TEXT NOT NULL,
      rank INTEGER NOT NULL,
      evidence_score INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      status TEXT NOT NULL,
      title TEXT NOT NULL,
      promoted_experiment_id TEXT,
      metadata TEXT NOT NULL,
      FOREIGN KEY (brief_id) REFERENCES commercial_briefs(id),
      FOREIGN KEY (promoted_experiment_id) REFERENCES commercial_experiments(id)
    );

    CREATE TABLE commercial_test_contracts (
      decision_hash TEXT PRIMARY KEY,
      contract_schema TEXT NOT NULL,
      program_id TEXT NOT NULL,
      contract_json TEXT NOT NULL
    );

    CREATE TABLE commercial_test_lifecycle_events (
      id TEXT PRIMARY KEY,
      decision_hash TEXT NOT NULL,
      event_type TEXT NOT NULL,
      occurred_at TEXT NOT NULL,
      FOREIGN KEY (decision_hash) REFERENCES commercial_test_contracts(decision_hash)
    );

    CREATE TABLE tasks (
      id TEXT PRIMARY KEY,
      workflow_id TEXT,
      status TEXT NOT NULL,
      payload TEXT NOT NULL,
      result TEXT NOT NULL
    );

    CREATE TABLE catalogue_plans (
      id TEXT PRIMARY KEY,
      opportunity_id TEXT NOT NULL,
      status TEXT NOT NULL,
      metadata TEXT NOT NULL
    );

    CREATE TABLE opportunities (
      id TEXT PRIMARY KEY,
      evidence_ids TEXT NOT NULL,
      metadata TEXT NOT NULL
    );
  `);
  return db;
}

function insertAcceptedActiveV2Program(db) {
  const decisionHash = digest("accepted-active-v2-program");
  const contract = {
    schema: "pantheon.commercial-test-contract.v2",
    decisionHash,
    programId: "program.accepted.active",
    programVersion: "1",
    testId: "test.accepted.active",
    testVersion: "1",
  };
  db.prepare(
    `INSERT INTO commercial_test_contracts
     (decision_hash, contract_schema, program_id, contract_json)
     VALUES (?, ?, ?, ?)`,
  ).run(decisionHash, contract.schema, contract.programId, JSON.stringify(contract));
  db.prepare(
    `INSERT INTO commercial_test_lifecycle_events
     (id, decision_hash, event_type, occurred_at)
     VALUES (?, ?, ?, ?)`,
  ).run("accepted-v2", decisionHash, "accepted", "2026-07-29T00:00:00.000Z");
  db.prepare(
    `INSERT INTO commercial_test_lifecycle_events
     (id, decision_hash, event_type, occurred_at)
     VALUES (?, ?, ?, ?)`,
  ).run("activated-v2", decisionHash, "activated", "2026-07-29T00:00:01.000Z");
}

function recordCounts(db) {
  return {
    contracts: db.prepare("SELECT COUNT(*) AS count FROM commercial_test_contracts").get().count,
    lifecycle: db.prepare("SELECT COUNT(*) AS count FROM commercial_test_lifecycle_events").get().count,
    briefs: db.prepare("SELECT COUNT(*) AS count FROM commercial_briefs").get().count,
    candidates: db.prepare("SELECT COUNT(*) AS count FROM commercial_test_candidates").get().count,
    experiments: db.prepare("SELECT COUNT(*) AS count FROM commercial_experiments").get().count,
  };
}

function assertRetired(operation, path) {
  assert.throws(operation, (error) => {
    assert.equal(error.statusCode, 410);
    assert.equal(error.code, "legacy_commercial_path_retired");
    assert.equal(error.details.path, path);
    assert.equal(error.details.replacement, "pantheon.commercial-test-contract.v2");
    return true;
  });
}

test("legacy plan and promotion APIs write nothing even when a v2 program is accepted and active", () => {
  const db = makeDatabase();
  try {
    insertAcceptedActiveV2Program(db);
    const before = recordCounts(db);
    const legacyFlags = {
      activeVenture: true,
      clientMode: true,
      commercialProgram: {
        schema: "pantheon.commercial-test-contract.v2",
        status: "active",
      },
    };

    assertRetired(
      () => createResearchToExperimentPlan(db, legacyFlags),
      "research_to_experiment_plan",
    );
    assertRetired(
      () => createResearchToExperimentPlanFromResearch(
        db,
        "research-run",
        legacyFlags,
      ),
      "research_to_experiment_live_research_plan",
    );
    assertRetired(
      () => createRevisionPlanFromLearning(db, "learning", legacyFlags),
      "research_to_experiment_learning_revision_plan",
    );
    assertRetired(
      () => promoteCandidateToExperiment(db, "candidate", legacyFlags),
      "research_to_experiment_candidate_promotion",
    );
    assert.deepEqual(recordCounts(db), before);
  } finally {
    db.close();
  }
});

test("legacy distribution projection is 410 and cannot create a commercial experiment", () => {
  const db = makeDatabase();
  try {
    insertAcceptedActiveV2Program(db);
    db.exec(`
      INSERT INTO opportunities
      (id, evidence_ids, metadata)
      VALUES ('opportunity-current', '[]', '{}');

      INSERT INTO catalogue_plans
      (id, opportunity_id, status, metadata)
      VALUES (
        'plan-current',
        'opportunity-current',
        'distribution_plan',
        '{"projectedTaskIds":[]}'
      );

      INSERT INTO tasks
      (id, workflow_id, status, payload, result)
      VALUES (
        'task-distribution',
        'workflow-current',
        'completed',
        '{"liveSpendRequest":{"parameters":{"pantheonProduction":{"planId":"plan-current","opportunityId":"opportunity-current","stage":"distribution_plan"}}}}',
        '{"output":{"successMetric":"Three buyers"}}'
      );
    `);
    const before = recordCounts(db);
    const planBefore = db.prepare(
      "SELECT status, metadata FROM catalogue_plans WHERE id = 'plan-current'",
    ).get();

    assertRetired(
      () => projectCompletedProductionTask(db, "task-distribution"),
      "pantheon_production_distribution_projection",
    );

    assert.deepEqual(recordCounts(db), before);
    assert.deepEqual(
      db.prepare(
        "SELECT status, metadata FROM catalogue_plans WHERE id = 'plan-current'",
      ).get(),
      planBefore,
    );
  } finally {
    db.close();
  }
});

test("retired historical plans and terminal experiments remain available read-only", () => {
  const db = makeDatabase();
  try {
    db.exec(`
      INSERT INTO commercial_briefs
      (id, status, title, metadata)
      VALUES (
        'brief-history',
        'experiment_promoted',
        'Historical plan',
        '{"terminal":true}'
      );

      INSERT INTO commercial_experiments
      (id, name, status, metadata)
      VALUES (
        'experiment-history',
        'Historical experiment',
        'cancelled',
        '{"terminal":true,"outcome":"inconclusive"}'
      );

      INSERT INTO commercial_test_candidates
      (id, brief_id, rank, evidence_score, created_at, status, title,
       promoted_experiment_id, metadata)
      VALUES (
        'candidate-history',
        'brief-history',
        1,
        50,
        '2026-07-01T00:00:00.000Z',
        'cancelled',
        'Historical candidate',
        'experiment-history',
        '{"terminal":true}'
      );
    `);
    const before = recordCounts(db);
    const plan = inspectHistoricalResearchToExperimentPlan(db, "brief-history");
    const promotion = inspectHistoricalCandidatePromotion(db, "candidate-history");

    assert.equal(plan.retired, true);
    assert.equal(plan.readOnly, true);
    assert.equal(plan.brief.metadata.terminal, true);
    assert.equal(plan.candidates.length, 1);
    assert.equal(promotion.retired, true);
    assert.equal(promotion.readOnly, true);
    assert.equal(promotion.experiment.status, "cancelled");
    assert.equal(promotion.experiment.metadata.outcome, "inconclusive");
    assertRetired(
      () => promoteCandidateToExperiment(db, "candidate-history"),
      "research_to_experiment_candidate_promotion",
    );
    assert.deepEqual(recordCounts(db), before);
    assert.equal(
      inspectHistoricalCandidatePromotion(db, "candidate-history").experiment.status,
      "cancelled",
    );
  } finally {
    db.close();
  }
});
