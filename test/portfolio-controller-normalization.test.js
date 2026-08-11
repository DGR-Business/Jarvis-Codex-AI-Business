const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { all, get, openDatabase, run, seedDatabase } = require("../src/db");
const { ensurePortfolioController } = require("../src/runtime/portfolio-controller");

function runtimeDb() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pantheon-portfolio-normalization-"));
  const db = openDatabase(path.join(root, "runtime.sqlite"));
  seedDatabase(db);
  return { db, root };
}

function closeRuntime(runtime) {
  runtime.db.close();
  fs.rmSync(runtime.root, { recursive: true, force: true });
}

function opportunity(db, id) {
  return get(db, "SELECT * FROM opportunities WHERE id = ?", [id]);
}

function opportunitySnapshot(db) {
  return all(db, "SELECT * FROM opportunities ORDER BY id");
}

test("startup portfolio normalization is idempotent once terminal opportunities are parked", () => {
  const runtime = runtimeDb();
  const originalTimestamp = "2026-01-01T00:00:00.000Z";
  try {
    run(
      runtime.db,
      `INSERT INTO opportunity_rounds
       (id, venture_id, status, mode, prompt, geography, language, max_candidates,
        completed_at, created_by, metadata, created_at, updated_at)
       VALUES ('round-normalization-proof', 'venture-digital-products', 'completed',
        'portfolio_discovery', 'Retained terminal portfolio round', 'Australia',
        'English', 2, ?, 'test', '{}', ?, ?)`,
      [originalTimestamp, originalTimestamp, originalTimestamp],
    );

    for (const [id, status, title] of [
      ["opp-already-parked", "parked", "Canonical parked opportunity"],
      ["opp-needs-parking", "ranked", "Terminal opportunity requiring normalization"],
    ]) {
      run(
        runtime.db,
        `INSERT INTO opportunities
         (id, round_id, venture_id, source_type, status, title, business_model,
          buyer, problem, offer_direction, geography, language, channel, metadata,
          created_at, updated_at)
         VALUES (?, 'round-normalization-proof', 'venture-digital-products',
          'retained_research', ?, ?, 'digital_product', 'Australian operators',
          'Scope creep creates avoidable rework', 'A bounded scope-control kit',
          'Australia', 'English', 'Marketplace', '{}', ?, ?)`,
        [id, status, title, originalTimestamp, originalTimestamp],
      );
      run(
        runtime.db,
        `INSERT INTO commercial_decision_cases
         (id, opportunity_id, venture_id, round_id, status, stage, recommendation,
          decision_hash, created_at, updated_at)
         VALUES (?, ?, 'venture-digital-products', 'round-normalization-proof', ?,
          'commercial_investment_review', 'park', ?, ?, ?)`,
        [
          `case-${id}`,
          id,
          status === "parked" ? "parked" : "ready_for_review",
          `decision-${id}`,
          originalTimestamp,
          originalTimestamp,
        ],
      );
    }

    const canonicalBefore = opportunity(runtime.db, "opp-already-parked");
    const nonCanonicalBefore = opportunity(runtime.db, "opp-needs-parking");

    ensurePortfolioController(runtime.db);

    assert.deepEqual(
      opportunity(runtime.db, "opp-already-parked"),
      canonicalBefore,
      "startup must not rewrite an already canonical parked opportunity",
    );
    const normalized = opportunity(runtime.db, "opp-needs-parking");
    assert.equal(normalized.status, "parked");
    assert.notEqual(normalized.updated_at, nonCanonicalBefore.updated_at);
    assert.deepEqual(
      { ...normalized, status: nonCanonicalBefore.status, updated_at: nonCanonicalBefore.updated_at },
      { ...nonCanonicalBefore },
      "normalization may change only terminal status and its timestamp",
    );

    const afterFirstStartup = opportunitySnapshot(runtime.db);
    ensurePortfolioController(runtime.db);
    assert.deepEqual(
      opportunitySnapshot(runtime.db),
      afterFirstStartup,
      "repeated startup normalization must preserve every opportunity value",
    );
  } finally {
    closeRuntime(runtime);
  }
});
