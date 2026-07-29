const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const CONFIG = require("../src/config");
const { all, get, openDatabase, run, seedDatabase } = require("../src/db");
const { decideApproval } = require("../src/runtime/approvals");
const {
  executionRequestEnvelopes,
  validateApprovalScope,
} = require("../src/runtime/approval-scope");
const { __setAgentRuntimeSdkRunnerForTests } = require("../src/runtime/agent-runtime");
const { ensureAiTeam } = require("../src/runtime/ai-team");
const { ensureAgentTools } = require("../src/runtime/agent-tools");
const { runOnce } = require("../src/runtime/orchestrator");
const { prepareProductBuilderAsset } = require("../src/runtime/product-builder-workspace");
const { getLiveAiWorkerReadiness } = require("../src/runtime/live-ai-worker-readiness");
const {
  installActivatedCommercialTestFixture,
} = require("./support/commercial-authority-fixture");

function makeRuntime() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-product-builder-"));
  const db = openDatabase(path.join(root, "runtime.sqlite"));
  seedDatabase(db);
  ensureAiTeam(db);
  ensureAgentTools(db);
  const ts = "2026-07-17T00:00:00.000Z";
  run(
    db,
    `INSERT INTO workflows
     (id, venture_id, type, title, status, current_step, priority, metadata, created_at, updated_at)
     VALUES ('wf-product-asset', 'venture-digital-products', 'product_build',
      'Freelancer cash-control product', 'planned', '', 1, '{}', ?, ?)`,
    [ts, ts],
  );
  installActivatedCommercialTestFixture(db, {
    suffix: "product-builder-workspace",
    workflowIds: ["wf-product-asset"],
  });
  return { root, db };
}

function closeRuntime(runtime) {
  runtime.db.close();
  fs.rmSync(runtime.root, { recursive: true, force: true });
}

const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nT0AAAAASUVORK5CYII=",
  "base64",
);

test("one approved Product Builder asset is stored locally and stops for exact Quality Reviewer approval", async () => {
  const previous = {
    key: process.env.OPENAI_API_KEY,
    liveModels: process.env.JARVIS_ENABLE_LIVE_MODELS,
    imageGeneration: process.env.JARVIS_ENABLE_IMAGE_GENERATION,
    disabledAdapter: process.env.JARVIS_DISABLE_LIVE_AI_WORKER_ADAPTER,
    disabledSdk: process.env.JARVIS_DISABLE_OPENAI_AGENTS_SDK,
    rate: process.env.JARVIS_API_CREDIT_AUD_PER_USD,
  };
  process.env.OPENAI_API_KEY = "test-product-builder-key";
  process.env.JARVIS_ENABLE_LIVE_MODELS = "1";
  process.env.JARVIS_ENABLE_IMAGE_GENERATION = "1";
  process.env.JARVIS_API_CREDIT_AUD_PER_USD = "2";
  delete process.env.JARVIS_DISABLE_LIVE_AI_WORKER_ADAPTER;
  delete process.env.JARVIS_DISABLE_OPENAI_AGENTS_SDK;

  let captured = null;
  __setAgentRuntimeSdkRunnerForTests(async (input) => {
    captured = input;
    return {
      finalOutput: {
        summary: "One restrained product-cover draft was created for review.",
        recommendation: "Review the exact local image and keep it unpublished.",
        evidence: ["The asset follows the supplied product purpose and acceptance criteria."],
        risks: ["Small rendered text still needs visual inspection."],
        nextAction: "Ask Quality Reviewer to inspect the exact image and work result.",
        operatorDecision: "approve",
        confidence: "medium",
        work: {
          productFormat: "PNG product-cover draft",
          assetPlan: ["One square cover visual"],
          productionMethod: "One approved GPT Image generation call",
          qualityChecks: ["Readable hierarchy", "No unsupported claims", "No personal identity"],
          approvalNeeded: "Quality Reviewer and Daniel before any use",
          channelFit: "Gumroad product thumbnail draft",
        },
      },
      lastResponseId: "resp-product-builder",
      rawResponses: [{
        responseId: "resp-product-builder",
        usage: { input_tokens: 800, output_tokens: 360, total_tokens: 1160 },
        output: [{
          type: "image_generation_call",
          id: "image-product-builder",
          status: "completed",
          revised_prompt: "A restrained cash-control checklist cover with no personal identity.",
          result: ONE_PIXEL_PNG.toString("base64"),
        }],
      }],
      runContext: { usage: { inputTokens: 800, outputTokens: 360, totalTokens: 1160 } },
      lastAgent: { name: "Product Builder" },
      interruptions: [],
    };
  });

  const runtime = makeRuntime();
  try {
    const readiness = getLiveAiWorkerReadiness(runtime.db);
    assert.equal(readiness.imageGeneration.ready, true, JSON.stringify(readiness.imageGeneration));
    assert.equal(readiness.imageGeneration.model, "gpt-image-2");
    assert.equal(readiness.imageGeneration.approvalRequired, true);
    const prepared = prepareProductBuilderAsset(runtime.db, "wf-product-asset", {
      subject: "Weekly Cash-Control Checklist",
      purpose: "Create a clean cover visual for the smallest useful Gumroad product.",
      prompt: "A clean, professional square product-cover visual for a weekly freelancer cash-control checklist, dark ink on a pale neutral background, simple ledger grid, no people, no logos, no promises of financial outcomes.",
      acceptanceCriteria: [
        "The subject is immediately clear.",
        "No personal name, face, voice, logo, or unsupported financial claim appears.",
      ],
      constraints: ["Faceless and voiceless", "Do not publish"],
      quality: "low",
      size: "1024x1024",
      outputFormat: "png",
      estimatedCostCents: 100,
    });
    assert.equal(prepared.task.status, "blocked");
    assert.equal(prepared.approval.status, "pending");
    assert.equal(prepared.task.agent, "product_builder");
    assert.deepEqual(prepared.task.payload.liveSpendRequest.tools, ["image_generation_spend"]);
    assert.equal(prepared.task.payload.liveSpendRequest.parameters.requiredReviewer, "quality_reviewer");
    assert.equal(prepared.task.payload.liveSpendRequest.parameters.assetSpecHash, prepared.assetSpecHash);
    assert.equal(prepared.task.payload.liveSpendRequest.executionDescriptor.materializedInput.assignmentBrief.assetPrompt, prepared.assetSpec.prompt);
    assert.ok(prepared.task.payload.liveSpendRequest.pricedWorstCaseCostCents <= 100);
    assert.equal(all(runtime.db, "SELECT * FROM model_calls").length, 0);

    const scopeCheck = validateApprovalScope(runtime.db, prepared.approval.id);
    const descriptor = prepared.task.payload.liveSpendRequest.executionDescriptor;
    const envelopes = executionRequestEnvelopes(
      prepared.task.payload.liveSpendRequest,
      descriptor,
    );
    assert.deepEqual(envelopes.envelope, envelopes.approved);
    assert.equal(scopeCheck.valid, true, JSON.stringify(scopeCheck));
    decideApproval(runtime.db, prepared.approval.id, "approved", "Approve the simulated exact Product Builder request.");
    const completed = await runOnce(runtime.db, { workflowId: "wf-product-asset" });
    assert.equal(completed.status, "completed");
    assert.equal(completed.result.aiTeam.agentId, "product_builder");
    assert.equal(completed.result.qualityGate.status, "waiting_for_approval");
    assert.equal(completed.result.qualityGate.task.agent, "quality_reviewer");
    assert.equal(completed.result.qualityGate.task.status, "blocked");
    assert.equal(captured.capabilityPlan.requestedTools[0], "image_generation_spend");
    assert.equal(captured.capabilityPlan.maxToolCalls, 1);
    assert.equal(captured.capabilityPlan.maxTurns, 2);

    const generated = get(
      runtime.db,
      "SELECT * FROM deliverables WHERE task_id = ? AND format = 'image/png'",
      [prepared.task.id],
    );
    const workResult = get(
      runtime.db,
      "SELECT * FROM deliverables WHERE task_id = ? AND format = 'text/markdown'",
      [prepared.task.id],
    );
    assert.equal(generated.venture_id, "venture-digital-products");
    assert.equal(generated.status, "quality_review_pending");
    assert.equal(generated.content_hash, require("node:crypto").createHash("sha256").update(ONE_PIXEL_PNG).digest("hex"));
    assert.equal(workResult.status, "quality_review_pending");
    assert.ok(workResult.file_path);

    const generatedPath = path.resolve(CONFIG.rootDir, generated.file_path);
    assert.equal(fs.readFileSync(generatedPath).equals(ONE_PIXEL_PNG), true);
    const reviewBindings = completed.result.qualityGate.task.payload.liveSpendRequest.parameters.reviewBindings;
    assert.deepEqual(
      reviewBindings.map((binding) => binding.deliverableId).sort(),
      [generated.id, workResult.id].sort(),
    );
    assert.equal(all(runtime.db, "SELECT * FROM model_calls").length, 1);
    assert.equal(all(runtime.db, "SELECT * FROM approvals WHERE status = 'pending'").length, 1);
  } finally {
    closeRuntime(runtime);
    __setAgentRuntimeSdkRunnerForTests(null);
    if (previous.key === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previous.key;
    if (previous.liveModels === undefined) delete process.env.JARVIS_ENABLE_LIVE_MODELS;
    else process.env.JARVIS_ENABLE_LIVE_MODELS = previous.liveModels;
    if (previous.imageGeneration === undefined) delete process.env.JARVIS_ENABLE_IMAGE_GENERATION;
    else process.env.JARVIS_ENABLE_IMAGE_GENERATION = previous.imageGeneration;
    if (previous.disabledAdapter === undefined) delete process.env.JARVIS_DISABLE_LIVE_AI_WORKER_ADAPTER;
    else process.env.JARVIS_DISABLE_LIVE_AI_WORKER_ADAPTER = previous.disabledAdapter;
    if (previous.disabledSdk === undefined) delete process.env.JARVIS_DISABLE_OPENAI_AGENTS_SDK;
    else process.env.JARVIS_DISABLE_OPENAI_AGENTS_SDK = previous.disabledSdk;
    if (previous.rate === undefined) delete process.env.JARVIS_API_CREDIT_AUD_PER_USD;
    else process.env.JARVIS_API_CREDIT_AUD_PER_USD = previous.rate;
  }
});
