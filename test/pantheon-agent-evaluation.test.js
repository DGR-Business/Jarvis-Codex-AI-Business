const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  all,
  fromJson,
  get,
  openDatabase,
  seedDatabase,
} = require("../src/db");
const { decideApproval } = require("../src/runtime/approvals");
const {
  __setAgentRuntimeSdkRunnerForTests,
} = require("../src/runtime/agent-runtime");
const { runOnce } = require("../src/runtime/orchestrator");
const { startOpportunityRound } = require("../src/runtime/pantheon-opportunities");
const {
  getRetentionPolicyState,
  prepareRetentionPolicyDecision,
} = require("../src/runtime/retention-policy");

function runtimeDb(name) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `pantheon-agent-evaluation-${name}-`));
  const db = openDatabase(path.join(root, "runtime.sqlite"));
  seedDatabase(db);
  return { db, root };
}

function closeRuntime(runtime) {
  runtime.db.close();
  fs.rmSync(runtime.root, { recursive: true, force: true });
}

async function activateRetentionPolicy(db) {
  const pending = all(
    db,
    "SELECT id FROM approvals WHERE status = 'pending' AND scope <> 'data_retention_policy' ORDER BY requested_at",
  );
  for (const approval of pending) {
    decideApproval(db, approval.id, "rejected", "Clear unrelated fixture decisions before activating the isolated test policy.");
  }
  const prepared = prepareRetentionPolicyDecision(db);
  assert.equal(
    prepared.prepared || prepared.state?.status === "waiting_for_decision",
    true,
    prepared.reason || "Retention policy decision was not prepared.",
  );
  let state = getRetentionPolicyState(db);
  if (state.status === "active") return state;
  const approval = get(db, "SELECT * FROM approvals WHERE id = ?", [state.approvalId]);
  decideApproval(db, approval.id, "approved", "Activate the isolated test retention policy.", {
    expectedScopeHash: approval.scope_hash,
  });
  const execution = await runOnce(db, { taskId: approval.task_id });
  assert.equal(execution.status, "completed", execution.error || JSON.stringify(execution));
  state = getRetentionPolicyState(db);
  assert.equal(state.status, "active");
  return state;
}

function preserveEnvironment(names) {
  return Object.fromEntries(names.map((name) => [name, process.env[name]]));
}

function restoreEnvironment(snapshot) {
  for (const [name, value] of Object.entries(snapshot)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}

test("failed live commercial evaluation cannot complete its task", async () => {
  const environmentNames = [
    "OPENAI_API_KEY",
    "PANTHEON_ENABLE_LIVE_MODELS",
    "PANTHEON_ENABLE_LIVE_RESEARCH",
    "JARVIS_ENABLE_LIVE_MODELS",
    "JARVIS_ENABLE_LIVE_RESEARCH",
    "PANTHEON_DISABLE_LIVE_AI_WORKER_ADAPTER",
    "PANTHEON_DISABLE_OPENAI_AGENTS_SDK",
    "JARVIS_DISABLE_LIVE_AI_WORKER_ADAPTER",
    "JARVIS_DISABLE_OPENAI_AGENTS_SDK",
    "PANTHEON_APPROVAL_PACK_DIR",
    "JARVIS_APPROVAL_PACK_DIR",
  ];
  const previousEnvironment = preserveEnvironment(environmentNames);
  const runtime = runtimeDb("quality-stop");
  const packDir = fs.mkdtempSync(path.join(os.tmpdir(), "pantheon-agent-evaluation-packs-"));

  process.env.OPENAI_API_KEY = "test-only-pantheon-key";
  process.env.PANTHEON_ENABLE_LIVE_MODELS = "1";
  process.env.PANTHEON_ENABLE_LIVE_RESEARCH = "1";
  process.env.JARVIS_ENABLE_LIVE_MODELS = "1";
  process.env.JARVIS_ENABLE_LIVE_RESEARCH = "1";
  delete process.env.PANTHEON_DISABLE_LIVE_AI_WORKER_ADAPTER;
  delete process.env.PANTHEON_DISABLE_OPENAI_AGENTS_SDK;
  delete process.env.JARVIS_DISABLE_LIVE_AI_WORKER_ADAPTER;
  delete process.env.JARVIS_DISABLE_OPENAI_AGENTS_SDK;
  process.env.PANTHEON_APPROVAL_PACK_DIR = packDir;
  process.env.JARVIS_APPROVAL_PACK_DIR = packDir;

  __setAgentRuntimeSdkRunnerForTests(async () => ({
    finalOutput: {
      summary: "Three candidate directions were ranked, but the provider returned no attributable source URL.",
      recommendation: "Do not accept this as grounded commercial research.",
      evidence: ["The worker produced comparative hypotheses only."],
      risks: ["No grounded source URL was captured."],
      nextAction: "Review the failed evidence check before any further work.",
      operatorDecision: "needs_evidence",
      confidence: "low",
      work: {
        opportunities: [
          {
            title: "Ungrounded Workflow Toolkit",
            businessModel: "Digital template",
            buyer: "Small online operators",
            problem: "Repeated workflow administration",
            offerDirection: "Workflow toolkit",
            geography: "Global",
            language: "English",
            channel: "Online marketplace",
            demandScore: 80,
            supplyGapScore: 70,
            economicsScore: 75,
            channelFitScore: 75,
            executionFitScore: 85,
            riskScore: 35,
            score: 77,
            confidence: "low",
            smallestValidation: "Gather attributable demand evidence.",
            demandEvidence: ["No attributable demand evidence was returned."],
            competitionEvidence: ["No attributable competition evidence was returned."],
            economicsHypothesis: "Economics remain a hypothesis.",
            risks: ["Grounding is absent."],
          },
          {
            title: "Ungrounded Planning Bundle",
            businessModel: "Digital workbook",
            buyer: "Independent professionals",
            problem: "Planning inconsistency",
            offerDirection: "Planning bundle",
            geography: "Global",
            language: "English",
            channel: "Online marketplace",
            demandScore: 65,
            supplyGapScore: 60,
            economicsScore: 70,
            channelFitScore: 65,
            executionFitScore: 80,
            riskScore: 45,
            score: 67,
            confidence: "low",
            smallestValidation: "Gather attributable buyer evidence.",
            demandEvidence: ["No attributable demand evidence was returned."],
            competitionEvidence: ["No attributable competition evidence was returned."],
            economicsHypothesis: "Economics remain a hypothesis.",
            risks: ["Grounding is absent."],
          },
          {
            title: "Ungrounded General Pack",
            businessModel: "Digital download",
            buyer: "General productivity buyers",
            problem: "Unstructured daily work",
            offerDirection: "General productivity pack",
            geography: "Global",
            language: "English",
            channel: "Online marketplace",
            demandScore: 50,
            supplyGapScore: 45,
            economicsScore: 55,
            channelFitScore: 50,
            executionFitScore: 75,
            riskScore: 60,
            score: 53,
            confidence: "low",
            smallestValidation: "Gather attributable buyer evidence.",
            demandEvidence: ["No attributable demand evidence was returned."],
            competitionEvidence: ["No attributable competition evidence was returned."],
            economicsHypothesis: "Economics remain a hypothesis.",
            risks: ["Grounding is absent."],
          },
        ],
      },
    },
    lastResponseId: "resp_pantheon_ungrounded",
    rawResponses: [
      {
        responseId: "resp_pantheon_ungrounded",
        usage: { input_tokens: 500, output_tokens: 350, total_tokens: 850 },
        output: [
          {
            id: "web_search_without_sources",
            type: "web_search_call",
            status: "completed",
            action: {
              query: "commercial opportunities",
              sources: [],
            },
          },
        ],
      },
    ],
    runContext: {
      usage: { inputTokens: 500, outputTokens: 350, totalTokens: 850 },
    },
    lastAgent: { name: "Opportunity Scout" },
    interruptions: [],
  }));

  try {
    await activateRetentionPolicy(runtime.db);
    const started = startOpportunityRound(runtime.db, {
      prompt: "Find evidence-backed online business opportunities.",
      source: "pantheon-agent-evaluation-test",
    });
    assert.equal(started.queued.mandate.approved, true);
    const taskId = started.queued.task.id;

    const execution = await runOnce(runtime.db, {
      taskId,
      claimant: "pantheon-agent-evaluation-test",
    });
    assert.equal(execution.status, "needs_attention", JSON.stringify(execution));
    assert.match(execution.error, /local quality check scored it 45\/100 \(failed\)/i);

    const task = get(runtime.db, "SELECT * FROM tasks WHERE id = ?", [taskId]);
    const agentRun = get(runtime.db, "SELECT * FROM agent_runs WHERE task_id = ? ORDER BY started_at DESC LIMIT 1", [taskId]);
    const evaluation = get(
      runtime.db,
      "SELECT * FROM agent_eval_results WHERE run_id = ? ORDER BY created_at DESC, id DESC LIMIT 1",
      [agentRun.id],
    );
    const attempt = get(
      runtime.db,
      "SELECT * FROM task_attempts WHERE task_id = ? ORDER BY started_at DESC LIMIT 1",
      [taskId],
    );
    const modelCall = get(
      runtime.db,
      "SELECT * FROM model_calls WHERE task_id = ? ORDER BY created_at DESC, id DESC LIMIT 1",
      [taskId],
    );

    assert.equal(task.status, "needs_attention");
    assert.ok(task.completed_at, "The terminal attempt timestamp should be retained for review.");
    assert.equal(task.outcome_status, "known_provider_result_needs_review");
    assert.match(task.error, /local quality check/i);
    assert.equal(agentRun.status, "failed");
    assert.equal(evaluation.status, "failed");
    assert.equal(evaluation.score, 45);
    assert.ok(fromJson(evaluation.findings, []).some((finding) => /no provider-grounded source URLs/i.test(finding)));
    assert.ok(fromJson(evaluation.findings, []).some((finding) => /did not complete with grounded evidence/i.test(finding)));
    assert.equal(attempt.status, "needs_attention");
    assert.equal(attempt.error_kind, "worker_evaluation_failed");
    assert.equal(modelCall.outcome_status, "known");
    assert.equal(
      get(runtime.db, "SELECT COUNT(*) AS count FROM opportunities WHERE round_id = ?", [started.round.id]).count,
      0,
      "A failed worker evaluation must not be projected into commercial truth.",
    );
    assert.equal(
      get(runtime.db, "SELECT COUNT(*) AS count FROM events WHERE type = 'commercial_discovery.step_projected' AND entity_id = ?", [taskId]).count,
      0,
    );
    assert.equal(
      get(runtime.db, "SELECT COUNT(*) AS count FROM events WHERE type = 'task.completed' AND entity_id = ?", [taskId]).count,
      0,
      "A failed evaluation must not emit a task-completed event.",
    );
  } finally {
    __setAgentRuntimeSdkRunnerForTests(null);
    restoreEnvironment(previousEnvironment);
    closeRuntime(runtime);
    fs.rmSync(packDir, { recursive: true, force: true });
  }
});
