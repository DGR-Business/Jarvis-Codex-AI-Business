const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { DatabaseSync } = require("node:sqlite");

const { buildWorkerPrompt } = require("../src/adapters/live-ai-worker");
const {
  sourceTaskCompletedLiveResearch,
} = require("../src/runtime/demand-interest-test");
const {
  isReviewedRetryableErrorKind,
} = require("../src/runtime/live-ai-retry-policy");

const DEMAND_VALIDATOR = {
  id: "demand_validator",
  name: "Demand Validator",
  role: "Demand research specialist",
  instructions: "Test whether current evidence supports demand.",
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
