const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  get,
  openDatabase,
  seedDatabase,
} = require("../src/db");
const {
  startOpportunityRound,
} = require("../src/runtime/pantheon-opportunities");
const { createApp } = require("../src/server");

function runtimeDb(name) {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), `pantheon-commercial-spine-${name}-`),
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
      "opportunity_rounds",
      "opportunities",
      "commercial_decision_cases",
      "catalogue_plans",
      "commercial_experiments",
      "workflows",
      "tasks",
      "approvals",
      "costs",
      "events",
      "commands",
    ].map((table) => [
      table,
      get(db, `SELECT COUNT(*) AS count FROM ${table}`).count,
    ]),
  );
}

function assertRetired(error) {
  return error.statusCode === 410
    && error.code === "legacy_commercial_path_retired"
    && error.details.path === "pantheon_opportunity_round_start"
    && error.details.replacement
      === "bounded_preventure_research_authority_pending";
}

test("legacy broad and owner-idea discovery cannot create a commercial spine", () => {
  const runtime = runtimeDb("direct-retirement");
  try {
    for (const input of [
      {
        prompt: "Find evidence-backed online business opportunities.",
        source: "retirement-proof",
      },
      {
        idea: "A low-touch digital kit for independent professionals.",
        source: "owner-idea-retirement-proof",
      },
    ]) {
      const before = commercialCreationCounts(runtime.db);
      assert.throws(
        () => startOpportunityRound(runtime.db, input),
        assertRetired,
      );
      assert.deepEqual(commercialCreationCounts(runtime.db), before);
    }
  } finally {
    closeRuntime(runtime);
  }
});

test("retired discovery stays closed even when force or old portfolio flags are supplied", () => {
  const runtime = runtimeDb("hostile-flags");
  try {
    const before = commercialCreationCounts(runtime.db);
    assert.throws(
      () => startOpportunityRound(runtime.db, {
        force: true,
        portfolioControllerV1: true,
        modelLocked: true,
        allowDiscoveryStart: true,
      }),
      assertRetired,
    );
    assert.deepEqual(commercialCreationCounts(runtime.db), before);
  } finally {
    closeRuntime(runtime);
  }
});

test("the public discovery and broad supervisor routes refuse work without writes", async () => {
  const runtime = runtimeDb("http-retirement");
  const app = createApp({
    db: runtime.db,
    dbPath: path.join(runtime.root, "unused.sqlite"),
    security: false,
    schedulerEnabled: false,
  });
  await new Promise((resolve) => {
    app.server.listen(0, "127.0.0.1", resolve);
  });
  const origin = `http://127.0.0.1:${app.server.address().port}`;
  try {
    const before = commercialCreationCounts(runtime.db);
    const discovery = await fetch(`${origin}/api/pantheon/discovery`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: "Find opportunities." }),
    });
    assert.equal(discovery.status, 410);
    assert.equal(
      (await discovery.json()).code,
      "commercial_route_retired",
    );

    const supervisor = await fetch(`${origin}/api/pantheon/run`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ startDiscovery: true }),
    });
    assert.equal(supervisor.status, 409);
    assert.equal(
      (await supervisor.json()).code,
      "commercial_binding_required",
    );
    assert.deepEqual(commercialCreationCounts(runtime.db), before);
  } finally {
    await app.server.shutdown();
    closeRuntime(runtime);
  }
});
