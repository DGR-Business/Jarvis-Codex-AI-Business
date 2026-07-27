const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { all, fromJson, get, now, openDatabase, run, seedDatabase, toJson } = require("../src/db");
const {
  ensureApprovalScope,
  scopeHash,
  validateApprovalScope,
  verifyExecutionDescriptor,
} = require("../src/runtime/approval-scope");
const {
  monthlyBudgetExposure,
  reserveBudget,
  resolveReservation,
} = require("../src/runtime/cost-ledger");
const {
  refreshOutdatedLiveAiWorkerApproval,
  requestLiveAiWorker,
} = require("../src/runtime/live-ai-workers");
const { getLiveAiWorkerReadiness } = require("../src/runtime/live-ai-worker-readiness");
const { requestLiveResearch } = require("../src/runtime/live-research");
const { worstCaseExecutionCostAud } = require("../src/runtime/model-pricing");
const { selectModelRoute } = require("../src/runtime/model-routing");
const { collectFindings } = require("../src/runtime/monitor");
const { createCommandPlan } = require("../src/runtime/planner");
const { getSpendApprovalState } = require("../src/runtime/spend-gate");
const { getCockpitState } = require("../src/runtime/cockpit-state");

function runtimeDb(name) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `jarvis-finance-safety-${name}-`));
  const db = openDatabase(path.join(root, "runtime.sqlite"));
  seedDatabase(db);
  return { db, root };
}

function closeRuntime(runtime) {
  runtime.db.close();
  fs.rmSync(runtime.root, { recursive: true, force: true });
}

function setBudget(db, cents) {
  const row = get(db, "SELECT value FROM settings WHERE key = 'budget'");
  run(db, "UPDATE settings SET value = ?, updated_at = ? WHERE key = 'budget'", [
    toJson({ ...fromJson(row.value, {}), monthlyBudgetCents: cents, currency: "AUD" }),
    now(),
  ]);
}

test("monthly exposure counts realized cost plus unresolved reservations exactly once", () => {
  const runtime = runtimeDb("exposure");
  try {
    setBudget(runtime.db, 100);
    const planned = createCommandPlan(runtime.db, {
      text: "Prepare a small digital product decision",
      source: "finance-safety-test",
      createFiles: false,
    });
    const tasks = all(runtime.db, "SELECT * FROM tasks WHERE workflow_id = ? ORDER BY priority, created_at", [planned.workflow.id]);
    assert.ok(tasks.length >= 4);
    const ts = now();

    run(
      runtime.db,
      `INSERT INTO costs
       (id, workflow_id, venture_id, task_id, category, source, status, amount_cents, currency, occurred_at, metadata)
       VALUES ('cost-realized', ?, ?, ?, 'live_ai_worker', 'openai-agents-sdk', 'reconciled', 80, 'AUD', ?, '{}')`,
      [planned.workflow.id, planned.workflow.venture_id, tasks[0].id, ts],
    );
    run(
      runtime.db,
      `INSERT INTO budget_reservations
       (id, venture_id, workflow_id, task_id, approval_id, status, amount_cents, currency, reserved_at, resolved_at, metadata)
       VALUES ('reservation-reconciled', ?, ?, ?, NULL, 'reconciled', 80, 'AUD', ?, ?, ?)`,
      [planned.workflow.venture_id, planned.workflow.id, tasks[0].id, ts, ts, toJson({ source: "openai-agents-sdk" })],
    );
    run(
      runtime.db,
      `INSERT INTO costs
       (id, workflow_id, venture_id, category, source, status, amount_cents, currency, occurred_at, metadata)
       VALUES ('cost-unknown', ?, ?, 'live_ai_worker', 'openai-agents-sdk', 'unknown', 15, 'AUD', ?, ?)`,
      [planned.workflow.id, planned.workflow.venture_id, ts, toJson({ taskId: tasks[1].id })],
    );
    run(
      runtime.db,
      `INSERT INTO budget_reservations
       (id, venture_id, workflow_id, task_id, approval_id, status, amount_cents, currency, reserved_at, metadata)
       VALUES ('reservation-unknown', ?, ?, ?, NULL, 'unknown', 15, 'AUD', ?, ?)`,
      [planned.workflow.venture_id, planned.workflow.id, tasks[1].id, ts, toJson({ source: "openai-agents-sdk" })],
    );
    run(
      runtime.db,
      `INSERT INTO budget_reservations
       (id, venture_id, workflow_id, task_id, approval_id, status, amount_cents, currency, reserved_at, resolved_at, metadata)
       VALUES ('reservation-released', ?, ?, ?, NULL, 'released', 20, 'AUD', ?, ?, ?)`,
      [planned.workflow.venture_id, planned.workflow.id, tasks[2].id, ts, ts, toJson({ source: "openai-agents-sdk" })],
    );

    const exposure = monthlyBudgetExposure(runtime.db);
    assert.equal(exposure.realizedCents, 80);
    assert.equal(exposure.unresolvedCents, 15);
    assert.equal(exposure.totalCents, 95);
    assert.equal(getLiveAiWorkerReadiness(runtime.db).remainingBudgetCents, 5);

    run(runtime.db, "UPDATE tasks SET cost_budget_cents = 100 WHERE id = ?", [tasks[3].id]);
    const task = { ...tasks[3], cost_budget_cents: 100, payload: fromJson(tasks[3].payload, {}) };
    assert.throws(() => reserveBudget(runtime.db, task, null, 6), /monthly pre-revenue cap/i);
    const reservation = reserveBudget(runtime.db, task, null, 5);
    assert.equal(reservation.amount_cents, 5);
    assert.equal(monthlyBudgetExposure(runtime.db).totalCents, 100);
    resolveReservation(runtime.db, task.id, "released", { amountCents: 0 });
    assert.equal(monthlyBudgetExposure(runtime.db).totalCents, 95);

    run(
      runtime.db,
      `INSERT INTO costs
       (id, workflow_id, venture_id, category, source, status, amount_cents, currency, occurred_at, metadata)
       VALUES ('cost-extra', ?, ?, 'provider_usage', 'second-provider', 'reconciled', 10, 'AUD', ?, ?)`,
      [planned.workflow.id, planned.workflow.venture_id, ts, toJson({ taskId: tasks[2].id })],
    );
    const finding = collectFindings(runtime.db).find((item) => item.title === "Monthly budget exceeded");
    assert.ok(finding);
    assert.equal(finding.metadata.spendCents, 105);
    assert.equal(finding.metadata.realizedCents, 90);
    assert.equal(finding.metadata.unresolvedCents, 15);
  } finally {
    closeRuntime(runtime);
  }
});

test("cockpit spend uses the current month and states available budget", () => {
  const runtime = runtimeDb("cockpit-monthly-spend");
  try {
    setBudget(runtime.db, 1000);
    const current = now();
    const previousDate = new Date(current);
    previousDate.setUTCMonth(previousDate.getUTCMonth() - 1);
    run(
      runtime.db,
      `INSERT INTO costs
       (id, venture_id, category, source, status, amount_cents, currency, occurred_at, metadata)
       VALUES ('cost-current-month', 'venture-digital-products', 'live_ai_worker', 'openai-agents-sdk', 'reconciled', 200, 'AUD', ?, '{}')`,
      [current],
    );
    run(
      runtime.db,
      `INSERT INTO costs
       (id, venture_id, category, source, status, amount_cents, currency, occurred_at, metadata)
       VALUES ('cost-previous-month', 'venture-digital-products', 'live_ai_worker', 'openai-agents-sdk', 'reconciled', 300, 'AUD', ?, '{}')`,
      [previousDate.toISOString()],
    );

    const spend = getCockpitState(runtime.db).spend;
    assert.equal(spend.reconciledCents, 200);
    assert.equal(spend.exposureCents, 200);
    assert.equal(spend.availableCents, 800);
  } finally {
    closeRuntime(runtime);
  }
});

test("worst-case pricing rejects unknown models and prices bounded tools", () => {
  assert.throws(
    () => worstCaseExecutionCostAud({
      model: "unregistered-model",
      materializedInput: "hello",
      maxOutputTokens: 100,
      maxTurns: 1,
      tools: [],
      maxToolCalls: 0,
      audPerUsd: 1.6,
    }),
    /pricing is not registered/i,
  );
  const noTool = worstCaseExecutionCostAud({
    model: "gpt-5.6-terra",
    materializedInput: { suppliedEvidence: "bounded local fixture" },
    inputOverheadTokens: 1000,
    maxOutputTokens: 1200,
    maxTurns: 1,
    tools: [],
    maxToolCalls: 0,
    audPerUsd: 1.6,
  });
  assert.equal(noTool.method, "priced_worst_case_bound");
  assert.ok(noTool.amountCents > 0);

  const webSearch = worstCaseExecutionCostAud({
    model: "gpt-5.5",
    materializedInput: "bounded prompt",
    maxOutputTokens: 2400,
    maxTurns: 1,
    tools: ["web_search"],
    maxToolCalls: 1,
    audPerUsd: 1.6,
  });
  assert.equal(webSearch.maxInputTokensPerTurn, 922000);
  assert.ok(webSearch.amountCents > 200);

  const imageGeneration = worstCaseExecutionCostAud({
    model: "gpt-5.6-terra",
    materializedInput: { assignment: "Create one bounded product visual." },
    maxInputTokens: 32000,
    maxOutputTokens: 1000,
    maxTurns: 2,
    tools: ["image_generation_spend"],
    toolArguments: {
      image_generation_spend: { quality: "high", size: "1024x1024", outputFormat: "png" },
    },
    maxToolCalls: 1,
    audPerUsd: 2,
  });
  assert.equal(imageGeneration.imageGenerationPricing.model, "gpt-image-2");
  assert.equal(imageGeneration.imageGenerationPricing.quality, "high");
  assert.equal(imageGeneration.imageGenerationPricing.usd, 0.211);
  assert.ok(imageGeneration.amountCents <= 100);
});

test("model routing selects Luna, Terra, and Sol before approval without automatic fallback", () => {
  const luna = selectModelRoute({ modelClass: "fast-general" });
  const terra = selectModelRoute({ modelClass: "reasoning-medium" });
  const sol = selectModelRoute({ modelClass: "research-high" });
  const escalated = selectModelRoute({ modelClass: "reasoning-medium", qualityEscalation: true });
  const proof = selectModelRoute({ modelClass: "research-high", qualityEscalation: true, proofMode: true });
  const lockedSol = selectModelRoute({ model: "gpt-5.6-sol", modelLocked: true });

  assert.equal(luna.model, "gpt-5.6-luna");
  assert.equal(luna.tier, "luna");
  assert.equal(terra.model, "gpt-5.6-terra");
  assert.equal(terra.tier, "terra");
  assert.equal(sol.model, "gpt-5.6-sol");
  assert.equal(sol.tier, "sol");
  assert.equal(escalated.model, "gpt-5.6-sol");
  assert.equal(escalated.tier, "sol");
  assert.equal(proof.model, "gpt-5.6-luna");
  assert.equal(proof.tier, "luna");
  assert.equal(proof.proofMode, true);
  assert.equal(lockedSol.tier, "sol");
  assert.match(lockedSol.reason, /^Sol is locked for this exact capped run/);
  assert.equal(escalated.automaticFallbackAllowed, false);
  assert.equal(escalated.selectedBeforeApproval, true);
});

test("worker approval persists one descriptor and invalidates changed business input without read writes", () => {
  const runtime = runtimeDb("worker-descriptor");
  const previousRate = process.env.JARVIS_API_CREDIT_AUD_PER_USD;
  process.env.JARVIS_API_CREDIT_AUD_PER_USD = "1.579";
  try {
    const planned = createCommandPlan(runtime.db, {
      text: "Validate demand for a faceless freelancer cashflow checklist",
      source: "finance-safety-test",
      createFiles: false,
    });
    assert.throws(
      () => requestLiveAiWorker(runtime.db, planned.workflow.id, {
        estimatedCostCents: 100,
        worker: "demand_validator",
        provider: "openai-agents-sdk",
        model: "gpt-5.6-terra-test-fixture",
        maxOutputTokens: 1200,
      }),
      /pricing is not registered/i,
    );
    assert.equal(get(runtime.db, "SELECT COUNT(*) AS count FROM approvals WHERE workflow_id = ?", [planned.workflow.id]).count, 0);
    const requested = requestLiveAiWorker(runtime.db, planned.workflow.id, {
      estimatedCostCents: 100,
      worker: "demand_validator",
      provider: "openai-agents-sdk",
      model: "gpt-5.6-terra",
      maxOutputTokens: 1200,
    });
    const task = get(runtime.db, "SELECT * FROM tasks WHERE id = ?", [requested.task.id]);
    const payload = fromJson(task.payload, {});
    const descriptor = payload.liveSpendRequest.executionDescriptor;
    assert.equal(verifyExecutionDescriptor(descriptor).valid, true);
    assert.equal(descriptor.kind, "live_ai_worker");
    assert.equal(descriptor.provider, "openai-agents-sdk");
    assert.equal(descriptor.model, "gpt-5.6-terra");
    assert.equal(payload.liveSpendRequest.modelRoute.tier, "terra");
    assert.equal(descriptor.parameters.modelRoute.tier, "terra");
    assert.equal(descriptor.parameters.modelRoute.automaticFallbackAllowed, false);
    assert.ok(descriptor.materializedInputHash);
    assert.ok(descriptor.worstCaseCost.amountCents <= 100);
    const { descriptorHash: ignoredHash, ...tamperedBody } = descriptor;
    const tampered = {
      ...tamperedBody,
      materializedInputHash: "0".repeat(64),
    };
    tampered.descriptorHash = scopeHash(tampered);
    assert.match(verifyExecutionDescriptor(tampered).reason, /materialized-input hash is inconsistent/i);

    const beforeRead = get(runtime.db, "SELECT * FROM approvals WHERE id = ?", [requested.approval.id]);
    const scoped = ensureApprovalScope(runtime.db, requested.approval.id);
    const afterRead = get(runtime.db, "SELECT * FROM approvals WHERE id = ?", [requested.approval.id]);
    assert.deepEqual(afterRead, beforeRead);
    assert.equal(scoped.persisted, true);
    assert.equal(validateApprovalScope(runtime.db, requested.approval.id, task).valid, true);

    run(runtime.db, "UPDATE approvals SET status = 'approved', expires_at = '2000-01-01T00:00:00.000Z' WHERE id = ?", [requested.approval.id]);
    const beforeStateRead = get(runtime.db, "SELECT * FROM approvals WHERE id = ?", [requested.approval.id]);
    const approvalState = getSpendApprovalState(runtime.db, { ...task, payload });
    const afterStateRead = get(runtime.db, "SELECT * FROM approvals WHERE id = ?", [requested.approval.id]);
    assert.equal(approvalState.approvalApproved, true);
    assert.equal(approvalState.approvalValid, false);
    assert.equal(approvalState.approved, false);
    assert.match(approvalState.approvalInvalidReason, /expired/i);
    assert.deepEqual(afterStateRead, beforeStateRead);
    run(runtime.db, "UPDATE approvals SET expires_at = '2099-01-01T00:00:00.000Z' WHERE id = ?", [requested.approval.id]);

    run(runtime.db, "UPDATE commands SET raw_text = ? WHERE workflow_id = ?", [
      "Different operator instruction added after approval was requested.",
      planned.workflow.id,
    ]);
    const invalid = validateApprovalScope(runtime.db, requested.approval.id, task);
    assert.equal(invalid.valid, false);
    assert.match(invalid.reason, /materialized model input changed/i);
    run(runtime.db, "UPDATE approvals SET status = 'pending', decided_at = NULL WHERE id = ?", [requested.approval.id]);

    const refreshed = refreshOutdatedLiveAiWorkerApproval(runtime.db, requested.approval.id, {
      trigger: "finance-safety-test",
    });
    assert.equal(refreshed.refreshed, true);
    assert.notEqual(refreshed.replacementApprovalId, requested.approval.id);
    assert.equal(get(runtime.db, "SELECT status FROM approvals WHERE id = ?", [requested.approval.id]).status, "superseded");
    const replacementTaskRow = get(runtime.db, "SELECT * FROM tasks WHERE id = ?", [task.id]);
    const replacementTask = { ...replacementTaskRow, payload: fromJson(replacementTaskRow.payload, {}) };
    assert.equal(validateApprovalScope(runtime.db, refreshed.replacementApprovalId, replacementTask).valid, true);
    assert.equal(get(runtime.db, "SELECT COUNT(*) AS count FROM model_calls WHERE task_id = ?", [task.id]).count, 0);
    assert.equal(get(runtime.db, "SELECT COUNT(*) AS count FROM task_attempts WHERE task_id = ?", [task.id]).count, 0);
  } finally {
    if (previousRate === undefined) delete process.env.JARVIS_API_CREDIT_AUD_PER_USD;
    else process.env.JARVIS_API_CREDIT_AUD_PER_USD = previousRate;
    closeRuntime(runtime);
  }
});

test("research approval binds the exact outbound request and rejects a cap below worst case", () => {
  const runtime = runtimeDb("research-descriptor");
  const previousRate = process.env.JARVIS_API_CREDIT_AUD_PER_USD;
  const previousModel = process.env.JARVIS_LIVE_RESEARCH_MODEL;
  process.env.JARVIS_API_CREDIT_AUD_PER_USD = "1.579";
  process.env.JARVIS_LIVE_RESEARCH_MODEL = "gpt-5.5";
  try {
    const planned = createCommandPlan(runtime.db, {
      text: "Research demand for a faceless freelancer cashflow checklist",
      source: "finance-safety-test",
      createFiles: false,
    });
    assert.throws(
      () => requestLiveResearch(runtime.db, planned.workflow.id, { estimatedCostCents: 60, audPerUsd: 4 }),
      /priced worst-case cost .* above the 60-cent cap/i,
    );
    assert.equal(get(runtime.db, "SELECT COUNT(*) AS count FROM approvals WHERE workflow_id = ?", [planned.workflow.id]).count, 0);

    const requested = requestLiveResearch(runtime.db, planned.workflow.id, { estimatedCostCents: 5000, audPerUsd: 4 });
    const task = get(runtime.db, "SELECT * FROM tasks WHERE id = ?", [requested.task.id]);
    const descriptor = fromJson(task.payload, {}).liveSpendRequest.executionDescriptor;
    assert.equal(verifyExecutionDescriptor(descriptor).valid, true);
    assert.equal(descriptor.kind, "live_research");
    assert.deepEqual(descriptor.tools, ["research_adapter"]);
    assert.equal(descriptor.limits.maxToolCalls, 1);
    assert.equal(validateApprovalScope(runtime.db, requested.approval.id, task).valid, true);

    const workflow = get(runtime.db, "SELECT metadata FROM workflows WHERE id = ?", [planned.workflow.id]);
    run(runtime.db, "UPDATE workflows SET metadata = ? WHERE id = ?", [
      toJson({ ...fromJson(workflow.metadata, {}), originalInstruction: "Changed research subject after approval." }),
      planned.workflow.id,
    ]);
    const invalid = validateApprovalScope(runtime.db, requested.approval.id, task);
    assert.equal(invalid.valid, false);
    assert.match(invalid.reason, /materialized model input changed/i);
  } finally {
    if (previousRate === undefined) delete process.env.JARVIS_API_CREDIT_AUD_PER_USD;
    else process.env.JARVIS_API_CREDIT_AUD_PER_USD = previousRate;
    if (previousModel === undefined) delete process.env.JARVIS_LIVE_RESEARCH_MODEL;
    else process.env.JARVIS_LIVE_RESEARCH_MODEL = previousModel;
    closeRuntime(runtime);
  }
});
