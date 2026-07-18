const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  ENVIRONMENT_ALIASES,
  environmentResolution,
} = require("../src/adapters/pantheon-environment");
const { fromJson, openDatabase, seedDatabase } = require("../src/db");
const { createCommandPlan } = require("../src/runtime/planner");
const { requestLiveAiWorker } = require("../src/runtime/live-ai-workers");
const { requestLiveResearch } = require("../src/runtime/live-research");
const { getLiveAiWorkerReadiness } = require("../src/runtime/live-ai-worker-readiness");
const { getLiveResearchReadiness } = require("../src/runtime/live-research-readiness");

function preserveEnvironment(names, operation) {
  const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  try {
    return operation();
  } finally {
    for (const name of names) {
      if (previous[name] === undefined) delete process.env[name];
      else process.env[name] = previous[name];
    }
  }
}

function runtimeDb(name) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `pantheon-environment-${name}-`));
  const db = openDatabase(path.join(root, "runtime.sqlite"));
  seedDatabase(db);
  return { db, root };
}

function closeRuntime(runtime) {
  runtime.db.close();
  fs.rmSync(runtime.root, { recursive: true, force: true });
}

test("Pantheon environment names override conflicting legacy aliases", () => {
  const alias = ENVIRONMENT_ALIASES.enableLiveModels;
  preserveEnvironment([alias.preferred, alias.legacy], () => {
    process.env[alias.preferred] = "0";
    process.env[alias.legacy] = "1";

    const resolved = environmentResolution("enableLiveModels");

    assert.equal(resolved.value, "0");
    assert.equal(resolved.source, "preferred");
    assert.equal(process.env[alias.legacy], "0");
  });
});

test("legacy environment names remain a fallback for existing installations", () => {
  const alias = ENVIRONMENT_ALIASES.enableLiveResearch;
  preserveEnvironment([alias.preferred, alias.legacy], () => {
    delete process.env[alias.preferred];
    process.env[alias.legacy] = "1";

    const resolved = environmentResolution("enableLiveResearch");

    assert.equal(resolved.value, "1");
    assert.equal(resolved.source, "legacy_compatibility");
    assert.equal(process.env[alias.preferred], undefined);
  });
});

test("readiness surfaces use Pantheon or ordinary business language", () => {
  const runtime = runtimeDb("readiness-language");
  const names = [
    "OPENAI_API_KEY",
    "PANTHEON_ENABLE_LIVE_MODELS",
    "JARVIS_ENABLE_LIVE_MODELS",
    "PANTHEON_ENABLE_LIVE_RESEARCH",
    "JARVIS_ENABLE_LIVE_RESEARCH",
  ];
  try {
    preserveEnvironment(names, () => {
      delete process.env.OPENAI_API_KEY;
      process.env.PANTHEON_ENABLE_LIVE_MODELS = "0";
      process.env.JARVIS_ENABLE_LIVE_MODELS = "1";
      process.env.PANTHEON_ENABLE_LIVE_RESEARCH = "0";
      process.env.JARVIS_ENABLE_LIVE_RESEARCH = "1";

      const ai = getLiveAiWorkerReadiness(runtime.db);
      const research = getLiveResearchReadiness(runtime.db);
      const userFacing = JSON.stringify({
        ai: { blockers: ai.blockers, checklist: ai.checklist, agentRuntime: ai.agentRuntime },
        research: { blockers: research.blockers, checklist: research.checklist },
      });

      assert.equal(ai.liveFlagEnabled, false);
      assert.equal(research.liveFlagEnabled, false);
      assert.doesNotMatch(userFacing, /Jarvis|JARVIS_/);
      assert.match(userFacing, /Pantheon/);
      assert.match(userFacing, /PANTHEON_ENABLE_LIVE_MODELS/);
      assert.match(userFacing, /PANTHEON_ENABLE_LIVE_RESEARCH/);
    });
  } finally {
    closeRuntime(runtime);
  }
});

test("new worker and research approvals bind to Pantheon configuration names", () => {
  const runtime = runtimeDb("approval-flags");
  try {
    const workerPlan = createCommandPlan(runtime.db, {
      text: "Validate demand for a practical freelancer cashflow template",
      source: "pantheon-environment-test",
      createFiles: false,
    });
    const worker = requestLiveAiWorker(runtime.db, workerPlan.workflow.id, {
      estimatedCostCents: 500,
      worker: "demand_validator",
      model: "gpt-5.6-terra",
      maxOutputTokens: 1200,
    });
    const workerPayload = fromJson(
      runtime.db.prepare("SELECT payload FROM tasks WHERE id = ?").get(worker.task.id).payload,
      {},
    );

    assert.deepEqual(
      workerPayload.liveSpendRequest.requiresLiveFlag,
      ["PANTHEON_ENABLE_LIVE_MODELS"],
    );
    assert.deepEqual(
      workerPayload.liveSpendRequest.executionDescriptor.preflightRequirements.liveFlags,
      ["PANTHEON_ENABLE_LIVE_MODELS"],
    );

    const researchPlan = createCommandPlan(runtime.db, {
      text: "Research current pricing and competition for a freelancer cashflow template",
      source: "pantheon-environment-test",
      createFiles: false,
    });
    const research = requestLiveResearch(runtime.db, researchPlan.workflow.id, {
      estimatedCostCents: 500,
    });
    const researchPayload = fromJson(
      runtime.db.prepare("SELECT payload FROM tasks WHERE id = ?").get(research.task.id).payload,
      {},
    );

    assert.equal(
      researchPayload.liveSpendRequest.requiresLiveFlag,
      "PANTHEON_ENABLE_LIVE_RESEARCH",
    );
    assert.deepEqual(
      researchPayload.liveSpendRequest.executionDescriptor.preflightRequirements.liveFlags,
      ["PANTHEON_ENABLE_LIVE_RESEARCH"],
    );
  } finally {
    closeRuntime(runtime);
  }
});
