const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { DatabaseSync } = require("node:sqlite");

const { buildWorkerPrompt } = require("../src/adapters/live-ai-worker");
const {
  productBuilderVisualOutputJsonSchema,
} = require("../src/runtime/agent-model-contracts");
const {
  sourceTaskCompletedLiveResearch,
} = require("../src/runtime/demand-interest-test");
const {
  isReviewedRetryableErrorKind,
} = require("../src/runtime/live-ai-retry-policy");
const { classifyInternalApproval } = require("../src/runtime/pantheon-policy");

const DEMAND_VALIDATOR = {
  id: "demand_validator",
  name: "Demand Validator",
  role: "Demand research specialist",
  instructions: "Test whether current evidence supports demand.",
  approval_policy: { mustPauseFor: ["publishing", "customer contact"] },
};
const PRODUCT_BUILDER = {
  id: "product_builder",
  name: "Product Builder",
  role: "Digital product production specialist",
  instructions: "Create exact approved customer files.",
  approval_policy: { mustPauseFor: ["publishing", "customer contact"] },
};
const POLICY = {
  allowedTools: ["runtime_state", "research_adapter"],
  blockedTools: ["publishing", "customer_contact"],
};

test("live research prompt requires relevant attributable web evidence", () => {
  const prompt = buildWorkerPrompt({
    payload: {
      expectedOutput: "A source-backed demand verdict.",
      liveSpendRequest: { tools: ["research_adapter"] },
    },
  }, DEMAND_VALIDATOR, POLICY);

  assert.match(prompt, /Use the approved web search before deciding/i);
  assert.match(prompt, /calculator, weather, time, or unrelated query does not satisfy/i);
  assert.match(prompt, /attributable source URLs/i);
  assert.doesNotMatch(prompt, /reason only over suppliedEvidenceFixture/i);
});

test("controlled fixture prompt remains isolated from live evidence", () => {
  const prompt = buildWorkerPrompt({
    payload: {
      pilotFixture: { id: "fixture-1" },
      expectedOutput: "A supplied-evidence recommendation.",
      liveSpendRequest: { tools: [] },
    },
  }, DEMAND_VALIDATOR, POLICY);

  assert.match(prompt, /Reason only over suppliedEvidenceFixture/i);
  assert.match(prompt, /Never infer live demand from a controlled test example/i);
  assert.doesNotMatch(prompt, /Use the approved web search before deciding/i);
});

test("Product Builder file runs use one strict blueprint and deterministic local rendering", () => {
  const prompt = buildWorkerPrompt({
    payload: {
      expectedOutput: "A real manifest and customer bundle.",
      liveSpendRequest: { tools: ["product_file_factory"] },
    },
  }, PRODUCT_BUILDER, {
    allowedTools: ["product_file_factory"],
    blockedTools: ["publishing", "customer_contact"],
  });

  assert.match(prompt, /productBlueprint must match every ID/i);
  assert.match(prompt, /render and validate the files deterministically/i);
  assert.match(prompt, /strict JSON/i);
  assert.doesNotMatch(prompt, /Return the shared recommendation fields/i);
});

test("reviewed Product Builder corrections remain explicit even after a long inherited brief", () => {
  const requiredCorrection = "Interview Preparation Workbook needs a dedicated Preparation Status field with Not Started, In Progress, Ready for Review, Completed, and Post-Interview options.";
  const prompt = buildWorkerPrompt({
    payload: {
      expectedOutput: "A corrected product blueprint.",
      workBrief: {
        assetPrompt: "Inherited product guidance. ".repeat(200),
        requiredCorrections: [requiredCorrection],
      },
      liveSpendRequest: { tools: ["product_file_factory"] },
    },
  }, PRODUCT_BUILDER, {
    allowedTools: ["product_file_factory"],
    blockedTools: ["publishing", "customer_contact"],
  });

  assert.match(prompt, /reviewed correction attempt/i);
  assert.match(prompt, /Interview Preparation Workbook needs a dedicated Preparation Status field/i);
  assert.match(prompt, /Do not merely acknowledge, explain, or restate it/i);
});

test("Product Builder visual runs use a compact structured result after one image", () => {
  const prompt = buildWorkerPrompt({
    payload: {
      expectedOutput: "One truthful storefront image.",
      liveSpendRequest: { tools: ["image_generation_spend"] },
    },
  }, PRODUCT_BUILDER, {
    allowedTools: ["image_generation_spend"],
    blockedTools: ["publishing", "customer_contact"],
  });
  const schema = productBuilderVisualOutputJsonSchema();

  assert.match(prompt, /After creating the one approved image/i);
  assert.match(prompt, /one short sentence/i);
  assert.deepEqual(schema.properties.work.required, [
    "productFormat",
    "productionMethod",
    "limitations",
    "approvalNeeded",
    "channelFit",
  ]);
  assert.equal(Object.hasOwn(schema.properties.work.properties, "catalogueCoverage"), false);
});

test("completed live research cannot recursively prepare the same research step", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE tasks (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      status TEXT NOT NULL,
      payload TEXT NOT NULL
    );
    CREATE TABLE model_calls (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      status TEXT NOT NULL,
      outcome_status TEXT NOT NULL DEFAULT 'not_started',
      provider_request_id TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE agent_runs (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      status TEXT NOT NULL,
      completed_at TEXT
    );
    CREATE TABLE agent_eval_results (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      status TEXT NOT NULL
    );
    CREATE TABLE agent_run_receipts (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      status TEXT NOT NULL,
      outcome_status TEXT NOT NULL
    );
    CREATE TABLE research_runs (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      mode TEXT NOT NULL,
      status TEXT NOT NULL
    );
    CREATE TABLE research_sources (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      url TEXT,
      metadata TEXT NOT NULL
    );
  `);
  const sourceTaskId = "task-live-research";
  db.prepare(
    "INSERT INTO tasks (id, kind, status, payload) VALUES (?, ?, ?, ?)",
  ).run(
    sourceTaskId,
    "live_ai_worker_execution",
    "completed",
    JSON.stringify({ liveSpendRequest: { tools: ["research_adapter"] } }),
  );
  const followup = { payload: { sourceTaskId } };
  assert.equal(sourceTaskCompletedLiveResearch(db, followup), false);

  db.prepare(
    "INSERT INTO model_calls (id, task_id, status, outcome_status, provider_request_id, created_at) VALUES (?, ?, ?, ?, ?, ?)",
  ).run("model-live-research", sourceTaskId, "completed", "known", "resp_test", new Date().toISOString());
  assert.equal(sourceTaskCompletedLiveResearch(db, followup), false);

  db.prepare(
    "INSERT INTO agent_runs (id, task_id, status, completed_at) VALUES (?, ?, ?, ?)",
  ).run("run-live-research", sourceTaskId, "completed", new Date().toISOString());
  db.prepare(
    "INSERT INTO agent_eval_results (id, run_id, status) VALUES (?, ?, ?)",
  ).run("eval-live-research", "run-live-research", "passed");
  db.prepare(
    "INSERT INTO agent_run_receipts (id, run_id, status, outcome_status) VALUES (?, ?, ?, ?)",
  ).run("receipt-live-research", "run-live-research", "complete", "known");
  db.prepare(
    "INSERT INTO research_runs (id, task_id, mode, status) VALUES (?, ?, ?, ?)",
  ).run("research-live", sourceTaskId, "live", "completed_live");
  db.prepare(
    "INSERT INTO research_sources (id, run_id, url, metadata) VALUES (?, ?, ?, ?)",
  ).run("source-live", "research-live", "https://example.com/research", JSON.stringify({ liveCaptured: true }));
  assert.equal(sourceTaskCompletedLiveResearch(db, followup), true);
  db.close();
});

test("AI run UI distinguishes pending estimates and incomplete research", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "public", "app.js"), "utf8");
  assert.match(source, /final bill pending/);
  assert.match(source, /Attempted; no usable sources/);
  assert.match(source, /not accepted as market evidence/);
});

test("reviewed retry policy uses one consistent allow-list", () => {
  for (const errorKind of [
    "provider_output_invalid",
    "malformed_structured_output",
    "approved_provider_tool_activity_missing",
    "local_processing_after_provider_success",
  ]) {
    assert.equal(isReviewedRetryableErrorKind(errorKind), true);
  }
  assert.equal(isReviewedRetryableErrorKind("provider_outcome_unknown"), false);
  assert.equal(isReviewedRetryableErrorKind("failed_before_provider_dispatch"), false);
});

test("internal AI work reserves the priced worst case while preserving its hard ceiling", () => {
  const classification = classifyInternalApproval({
    id: "approval-priced-bound",
    status: "pending",
    risk_level: "medium",
    scope_hash: "scope-priced-bound",
    payload: JSON.stringify({
      liveSpendRequest: true,
      type: "live_ai_worker",
      tools: ["research_adapter"],
      effects: [],
      maxCostCents: 500,
      estimatedCostCents: 500,
      worstCaseCostCents: 35,
      executionDescriptor: {
        descriptorHash: "descriptor-priced-bound",
        externalEffects: [],
      },
    }),
  });

  assert.equal(classification.eligible, true);
  assert.equal(classification.amountCents, 35);
  assert.equal(classification.hardCapCents, 500);
  assert.equal(classification.pricedWorstCaseCents, 35);
});

test("a reviewed Product Builder correction preserves the exact tool contract", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "src", "runtime", "live-ai-workers.js"),
    "utf8",
  );
  assert.match(source, /requiredCorrections = \[/);
  assert.match(source, /single corrected Product Builder attempt/);
  assert.match(source, /Resolve every item in requiredCorrections exactly/);
  assert.match(
    source,
    /productBuilderTools\.includes\("product_file_factory"\)[\s\S]*?retryOptions\.maxTurns = 1/,
  );
  assert.match(source, /Pantheon will render, hash, reopen, preview, and package the customer files locally/);
  assert.match(source, /Copy each sample status value character-for-character from that field's options/);
  assert.match(source, /supported row-level calculator logic/);
  assert.match(source, /Never use grouping, cross-row totals, SUMIF or SUMIFS/);
  assert.match(source, /with no explanatory prose/);
  assert.match(
    source,
    /productBuilderTools\.includes\("image_generation_spend"\)[\s\S]*?retryOptions\.maxTurns = 2/,
  );
  assert.match(source, /return the compact strict visual-result JSON/i);
  assert.doesNotMatch(source, /Finish creating and saving every approved file with Code Interpreter/);
});

test("reviewed corrections carry exact findings and calculation guidance into Offer Architect", () => {
  const retrySource = fs.readFileSync(
    path.join(__dirname, "..", "src", "runtime", "live-ai-workers.js"),
    "utf8",
  );
  const commercialSource = fs.readFileSync(
    path.join(__dirname, "..", "src", "runtime", "pantheon-opportunities.js"),
    "utf8",
  );

  assert.match(retrySource, /Pantheon evidence check: \$\{findings\.join\(" "\)\}/);
  assert.match(
    retrySource,
    /task\.agent === "offer_architect"[\s\S]*?sum, subtract, multiply, or percent_of/,
  );
  assert.match(
    commercialSource,
    /every matching included tool must name the relevant fields and an explicit operation using sum, subtract, multiply, or percent_of/i,
  );
});
