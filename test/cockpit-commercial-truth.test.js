"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  openDatabase,
  run,
  seedDatabase,
} = require("../src/db");
const {
  getBusinessTestsState,
  getCockpitState,
} = require("../src/runtime/cockpit-state");

function runtimeFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pantheon-cockpit-truth-"));
  const db = openDatabase(path.join(root, "runtime.sqlite"));
  seedDatabase(db);
  return { root, db };
}

test("Command Center and Tests ignore contaminated legacy buyer and cash rows", () => {
  const fixture = runtimeFixture();
  try {
    const before = getCockpitState(fixture.db);
    assert.equal(before.commercialTests.schema, "pantheon.owner-tests-results.v1");
    assert.equal(before.currentTest, null);
    assert.equal(before.economics.independentBuyers, null);
    assert.equal(before.economics.buyerTarget, null);
    assert.equal(before.economics.buyerProofStatus, "not_current");
    assert.equal(before.economics.cashContributionStatus, "not_current");
    assert.equal(before.economics.cashContributionCents, null);

    const timestamp = "2026-07-29T07:00:00.000Z";
    run(
      fixture.db,
      `INSERT INTO commercial_experiments
       (id, venture_id, name, status, hypothesis, buyer, offer, channel,
        price_cents, expected_metric, target_value, target_unit, cost_cap_cents,
        metadata, created_at, updated_at)
       VALUES (
         'legacy-experiment-contamination',
         'venture-digital-products',
         'Legacy fake success',
         'running',
         'Legacy rows should not drive the owner view.',
         'Legacy buyer',
         'Legacy offer',
         'Legacy channel',
         9900,
         'Legacy metric',
         99,
         'buyers',
         0,
         '{}',
         ?,
         ?
       )`,
      [timestamp, timestamp],
    );
    run(
      fixture.db,
      `INSERT INTO commercial_results
       (id, experiment_id, source, status, views, clicks, leads, sales, refunds,
        revenue_cents, spend_cents, time_spent_minutes, notes, occurred_at,
        metadata, created_at)
       VALUES (
         'legacy-result-contamination',
         'legacy-experiment-contamination',
         'manual',
         'recorded',
         1000,
         900,
         800,
         99,
         0,
         990000,
         0,
         1,
         'Not canonical evidence.',
         ?,
         '{}',
         ?
       )`,
      [timestamp, timestamp],
    );
    run(
      fixture.db,
      `INSERT INTO platform_sales
       (id, venture_id, platform, platform_purchase_id, product_name, sold_at,
        currency, gross_cents, platform_fee_cents, net_cents, refunded_cents,
        referrer, buyer_hash, status, metadata, imported_at)
       VALUES (
         'legacy-sale-contamination',
         'venture-digital-products',
         'legacy',
         'legacy-purchase-99',
         'Legacy fake success',
         ?,
         'AUD',
         990000,
         0,
         990000,
         0,
         'legacy',
         'legacy-buyer-hash',
         'paid',
         '{}',
         ?
       )`,
      [timestamp, timestamp],
    );

    const after = getCockpitState(fixture.db);
    assert.equal(after.currentTest, null);
    assert.equal(after.economics.independentBuyers, null);
    assert.equal(after.economics.buyerTarget, null);
    assert.equal(after.economics.buyerProofStatus, "not_current");
    assert.equal(after.economics.cashContributionStatus, "not_current");
    assert.equal(after.economics.cashContributionCents, null);
    assert.equal(after.nextMoneyMove, "No commercial test is authorised");

    const tests = getBusinessTestsState(fixture.db);
    assert.equal(tests.schema, "pantheon.owner-tests-results.v1");
    assert.equal(tests.current, null);
    assert.equal(tests.integrity.status, "ok");
    assert.equal(JSON.stringify(tests).includes("Legacy fake success"), false);
  } finally {
    fixture.db.close();
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});
