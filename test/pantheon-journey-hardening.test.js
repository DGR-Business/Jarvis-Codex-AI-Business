const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { DatabaseSync } = require("node:sqlite");

const CONFIG = require("../src/config");
const { all, fromJson, get, openDatabase, run, seedDatabase, toJson } = require("../src/db");
const { decideApproval } = require("../src/runtime/approvals");
const { getCockpitState } = require("../src/runtime/cockpit-state");
const { runOnce } = require("../src/runtime/orchestrator");
const {
  activeJourney,
  currentOperatorJourney,
  getJourneyState,
  isTerminalJourneyStatus,
  startPantheonJourney,
  updateJourney,
} = require("../src/runtime/pantheon-journey");
const {
  appendProofExposure,
  combinedProofExposureFromDatabase,
  proofExposureLedgerPath,
  readProofExposure,
  recoverProofExposureLedger,
} = require("../src/runtime/proof-exposure-ledger");
const { reserveBudget } = require("../src/runtime/cost-ledger");
const { approveInternalWorkWithinMandate } = require("../src/runtime/pantheon-policy");
const {
  pendingCommercialTask,
} = require("../src/runtime/pantheon-opportunities");
const { runPantheonSupervisorCycle } = require("../src/runtime/pantheon-supervisor");
const { prepareRetentionPolicyDecision } = require("../src/runtime/retention-policy");
const { prepareReviewedLiveAiWorkerRetry } = require("../src/runtime/live-ai-workers");

test("the journey safety decision uses the normal view loader", () => {
  const dashboardSource = fs.readFileSync(path.join(__dirname, "..", "public", "app.js"), "utf8");
  assert.match(
    dashboardSource,
    /if \(action === "prepare-retention-decision"\)[\s\S]*?return loadView\("decisions", \{ silent: true \}\);/,
  );
  assert.match(dashboardSource, /data\.correction\?\.kind === "prepare_known_ai_retry"/);
  assert.match(dashboardSource, /Review the corrected package/);
  assert.match(dashboardSource, /journeyTaskOutcome/);
  assert.match(dashboardSource, /catalogue-decision-list/);
  assert.match(dashboardSource, /single permitted internal correction/);
  assert.match(dashboardSource, /This is the final independent content recheck/);
  assert.match(dashboardSource, /A cut-off or malformed AI answer is recorded separately/);
  assert.match(dashboardSource, /data\.currentJourney/);
  assert.match(dashboardSource, /Open full journey/);
  assert.match(dashboardSource, /corrected product package still had a material quality issue/);
  assert.match(dashboardSource, /Review the recorded product-quality finding/);
  assert.match(dashboardSource, /No further work will start automatically/);
  assert.match(dashboardSource, /No decision is waiting/);
  assert.match(dashboardSource, /Why it stopped/);
  assert.match(dashboardSource, /The product did not fully match its promise/);
  assert.match(dashboardSource, /What must change/);
  const opportunitySource = fs.readFileSync(path.join(__dirname, "..", "src", "runtime", "pantheon-opportunities.js"), "utf8");
  assert.match(opportunitySource, /each catalogue item must be truthfully deliverable as one Excel workbook/);
  assert.match(opportunitySource, /Do not promise Notion or Airtable workspaces, reusable databases/);
  assert.match(dashboardSource, /Review the catalogue build/);
  assert.match(
    dashboardSource,
    /if \(action === "start-discovery"\)[\s\S]*?postJson\("\/api\/pantheon\/journeys"/,
  );
  assert.doesNotMatch(dashboardSource, /Review the final decision/);
  assert.doesNotMatch(dashboardSource, /syncNavigation\(/);
  assert.match(dashboardSource, /const requestedView = view;/);
  assert.match(dashboardSource, /if \(store\.view !== requestedView\) return data;/);
  assert.match(dashboardSource, /Try this stage again/);
  assert.match(dashboardSource, /A fresh decision for the same stage is ready/);
});

function runtimeDb(name) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `pantheon-journey-hardening-${name}-`));
  const databasePath = path.join(root, "runtime.sqlite");
  const db = openDatabase(databasePath);
  seedDatabase(db);
  return { root, databasePath, db };
}

function removeRuntime(runtime) {
  runtime.db?.close();
  fs.rmSync(runtime.root, { recursive: true, force: true });
}

async function activateDataProtection(db) {
  const prepared = prepareRetentionPolicyDecision(db);
  const approval = get(db, "SELECT * FROM approvals WHERE id = ?", [prepared.state.approvalId]);
  decideApproval(db, approval.id, "approved", "Activate the exact isolated data protection plan.", {
    expectedScopeHash: approval.scope_hash,
  });
  const executed = await runOnce(db, { taskId: approval.task_id });
  assert.equal(executed.status, "completed");
}

test("a journey keeps a verified local pre-dispatch failure visible as its next action", async () => {
  const previous = {
    key: process.env.OPENAI_API_KEY,
    models: process.env.PANTHEON_ENABLE_LIVE_MODELS,
    research: process.env.PANTHEON_ENABLE_LIVE_RESEARCH,
    images: process.env.PANTHEON_ENABLE_IMAGE_GENERATION,
  };
  process.env.OPENAI_API_KEY = "test-pre-dispatch-journey-key";
  process.env.PANTHEON_ENABLE_LIVE_MODELS = "1";
  process.env.PANTHEON_ENABLE_LIVE_RESEARCH = "1";
  process.env.PANTHEON_ENABLE_IMAGE_GENERATION = "1";
  const runtime = runtimeDb("pre-dispatch-recovery");

  try {
    await activateDataProtection(runtime.db);
    const started = startPantheonJourney(runtime.db, {
      mode: "rehearsal",
      model: CONFIG.lunaModel,
      budgetCapCents: 3000,
      carriedExposureCents: 1000,
    });
    const task = started.state.currentTask;
    const failedAt = new Date().toISOString();
    run(
      runtime.db,
      `UPDATE tasks
       SET status = 'failed', outcome_status = 'failed_before_effect',
           error = 'Local proof ledger could not be verified.',
           completed_at = ?, updated_at = ?
       WHERE id = ?`,
      [failedAt, failedAt, task.id],
    );
    run(
      runtime.db,
      `INSERT INTO task_attempts
       (id, task_id, workflow_id, venture_id, claim_token, status, outcome_status,
        error_kind, error, started_at, completed_at, metadata)
       VALUES (?, ?, ?, ?, ?, 'failed', 'failed_before_effect',
        'non_retryable_error', 'Local proof ledger could not be verified.', ?, ?, ?)`,
      [
        "attempt-journey-pre-dispatch-recovery",
        task.id,
        task.workflow_id,
        task.venture_id,
        "claim-journey-pre-dispatch-recovery",
        failedAt,
        failedAt,
        toJson({ providerCallOccurred: false }),
      ],
    );

    const state = getJourneyState(runtime.db, started.journey.id);
    assert.equal(state.currentTask.id, task.id);
    assert.equal(state.currentTask.status, "failed");
    assert.equal(state.correction.kind, "prepare_known_ai_retry");
    assert.equal(state.correction.technicalRecovery, true);
    assert.match(state.correction.label, /^Try .+ again$/);
    assert.match(state.correction.summary, /no API cost occurred/i);

    const retry = prepareReviewedLiveAiWorkerRetry(runtime.db, task.id);
    run(
      runtime.db,
      `UPDATE tasks
       SET status = 'failed', outcome_status = 'known_provider_result_needs_review',
           error = 'The retained provider result needs a corrected local review.',
           updated_at = ?
       WHERE id = ?`,
      [failedAt, retry.task.id],
    );
    run(
      runtime.db,
      `INSERT INTO tasks
       (id, workflow_id, venture_id, title, kind, agent, status, priority,
        cost_budget_cents, cost_actual_cents, payload, result, outcome_status,
        created_at, updated_at, completed_at)
       VALUES (?, ?, ?, ?, 'local_production_output_recovery', 'jarvis', 'completed', 1,
               0, 0, ?, ?, 'known', ?, ?, ?)`,
      [
        "task-journey-local-recovery",
        retry.task.workflow_id,
        retry.task.venture_id,
        `Recover accepted result from ${retry.task.title}`,
        toJson({
          recovery: { sourceTaskId: retry.task.id, noNewProviderCall: true },
          liveSpendRequest: retry.task.payload.liveSpendRequest,
        }),
        toJson({ status: "completed", providerCallOccurred: false }),
        failedAt,
        failedAt,
        failedAt,
      ],
    );
    run(
      runtime.db,
      `UPDATE pantheon_journeys
       SET status = 'completed', active_stage = 'ready_to_publish', updated_at = ?
       WHERE id = ?`,
      [failedAt, started.journey.id],
    );
    const recoveredState = getJourneyState(runtime.db, started.journey.id);
    assert.equal(
      recoveredState.currentTask,
      null,
      "A completed local recovery must not leave its failed retry ancestor as the journey's current worker.",
    );
    assert.equal(recoveredState.correction, null);
  } finally {
    removeRuntime(runtime);
    for (const [name, value] of Object.entries({
      OPENAI_API_KEY: previous.key,
      PANTHEON_ENABLE_LIVE_MODELS: previous.models,
      PANTHEON_ENABLE_LIVE_RESEARCH: previous.research,
      PANTHEON_ENABLE_IMAGE_GENERATION: previous.images,
    })) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

test("journey identity, Luna lock, restart, duplicate start, budget, and external-action boundaries hold", async () => {
  const previous = {
    key: process.env.OPENAI_API_KEY,
    models: process.env.PANTHEON_ENABLE_LIVE_MODELS,
    research: process.env.PANTHEON_ENABLE_LIVE_RESEARCH,
    images: process.env.PANTHEON_ENABLE_IMAGE_GENERATION,
  };
  process.env.OPENAI_API_KEY = "test-journey-hardening-key";
  process.env.PANTHEON_ENABLE_LIVE_MODELS = "1";
  process.env.PANTHEON_ENABLE_LIVE_RESEARCH = "1";
  process.env.PANTHEON_ENABLE_IMAGE_GENERATION = "1";
  const runtime = runtimeDb("boundaries");

  try {
    await activateDataProtection(runtime.db);
    assert.throws(
      () => startPantheonJourney(runtime.db, { model: CONFIG.terraModel }),
      /must use Luna/i,
    );
    assert.throws(
      () => startPantheonJourney(runtime.db, {
        model: CONFIG.lunaModel,
        budgetCapCents: 1500,
        carriedExposureCents: 1500,
      }),
      /leaves no budget/i,
    );

    const started = startPantheonJourney(runtime.db, {
      mode: "rehearsal",
      model: CONFIG.lunaModel,
      budgetCapCents: 1500,
      carriedExposureCents: 1440,
      prompt: "Find broad lawful opportunities, then retain only a buildable digital-product winner.",
    });
    assert.equal(started.alreadyRunning, false);
    assert.equal(started.journey.model, CONFIG.lunaModel);
    assert.equal(started.journey.model_locked, 1);
    assert.equal(started.journey.carried_exposure_cents, 1440);

    const duplicate = startPantheonJourney(runtime.db, {
      mode: "production",
      prompt: "A duplicate browser click must not create another journey.",
    });
    assert.equal(duplicate.alreadyRunning, true);
    assert.equal(duplicate.journey.id, started.journey.id);
    assert.equal(get(runtime.db, "SELECT COUNT(*) AS count FROM pantheon_journeys").count, 1);

    const state = getJourneyState(runtime.db, started.journey.id);
    assert.ok(state.currentTask);
    const request = state.currentTask.payload.liveSpendRequest;
    assert.equal(request.model, CONFIG.lunaModel);
    assert.equal(request.parameters.modelRoute.modelLocked, true);
    assert.equal(request.parameters.pantheonJourney.journeyId, started.journey.id);
    assert.deepEqual(request.effects, []);
    assert.equal(request.parameters.pantheonJourney.modelLocked, true);
    assert.equal(state.journey.metadata.externalActionsAllowed, false);

    const approvalId = state.currentTask.approval_id || request.approvalId;
    assert.ok(approvalId);
    const budgetDecision = approveInternalWorkWithinMandate(runtime.db, approvalId);
    assert.equal(budgetDecision.approved, false);
    assert.equal(budgetDecision.reason, "journey_budget_exceeded");
    assert.equal(get(runtime.db, "SELECT COUNT(*) AS count FROM model_calls").count, 0);
    assert.equal(get(runtime.db, "SELECT COUNT(*) AS count FROM task_attempts WHERE task_id = ?", [state.currentTask.id]).count, 0);

    runtime.db.close();
    runtime.db = openDatabase(runtime.databasePath);
    const restored = activeJourney(runtime.db);
    assert.equal(restored.id, started.journey.id);
    assert.equal(restored.model, CONFIG.lunaModel);
    assert.equal(restored.model_locked, 1);
    assert.equal(getJourneyState(runtime.db, restored.id).currentTask.id, state.currentTask.id);
    assert.equal(
      all(runtime.db, "SELECT * FROM tasks WHERE workflow_id = ?", [restored.workflow_id])
        .some((task) => JSON.parse(task.payload).liveSpendRequest?.effects?.length),
      false,
    );
  } finally {
    removeRuntime(runtime);
    for (const [name, value] of Object.entries({
      OPENAI_API_KEY: previous.key,
      PANTHEON_ENABLE_LIVE_MODELS: previous.models,
      PANTHEON_ENABLE_LIVE_RESEARCH: previous.research,
      PANTHEON_ENABLE_IMAGE_GENERATION: previous.images,
    })) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

test("a forced clean restart closes the unfinished journey before creating its replacement", async () => {
  const runtime = runtimeDb("forced-clean-restart");
  try {
    await activateDataProtection(runtime.db);
    const first = startPantheonJourney(runtime.db, {
      mode: "rehearsal",
      model: CONFIG.lunaModel,
      carriedExposureCents: 200,
      prompt: "Prepare an isolated first journey.",
    });
    run(
      runtime.db,
      `UPDATE tasks
       SET status = 'needs_attention', outcome_status = 'known_provider_result_needs_review',
           error = 'Historical rehearsal failure.', updated_at = ?
       WHERE id = ?`,
      [new Date().toISOString(), first.state.currentTask.id],
    );
    run(
      runtime.db,
      `UPDATE approvals
       SET status = 'pending', decided_at = NULL, decision_note = NULL
       WHERE id = ?`,
      [first.state.currentTask.approval_id],
    );
    const second = startPantheonJourney(runtime.db, {
      mode: "rehearsal",
      model: CONFIG.lunaModel,
      force: true,
      prompt: "Prepare a clean replacement journey.",
    });
    assert.notEqual(second.journey.id, first.journey.id);
    assert.equal(
      get(runtime.db, "SELECT status FROM pantheon_journeys WHERE id = ?", [first.journey.id]).status,
      "cancelled",
    );
    assert.equal(
      get(runtime.db, "SELECT status FROM workflows WHERE id = ?", [first.journey.workflow_id]).status,
      "cancelled",
    );
    assert.equal(
      get(runtime.db, "SELECT status FROM opportunity_rounds WHERE id = ?", [first.journey.round_id]).status,
      "cancelled",
    );
    assert.equal(
      get(runtime.db, "SELECT status FROM approvals WHERE id = ?", [first.state.currentTask.approval_id]).status,
      "cancelled",
    );
    assert.equal(
      get(runtime.db, "SELECT status FROM tasks WHERE id = ?", [first.state.currentTask.id]).status,
      "needs_attention",
    );
    assert.equal(
      getCockpitState(runtime.db).importantWork.some((item) => item.id === first.state.currentTask.id),
      false,
    );
    assert.equal(activeJourney(runtime.db).id, second.journey.id);
    assert.equal(get(runtime.db, "SELECT COUNT(*) AS count FROM pantheon_journeys").count, 2);
    assert.throws(
      () => updateJourney(runtime.db, first.journey.id, { status: "running" }),
      /finished Pantheon journey cannot return to active work/i,
    );
  } finally {
    removeRuntime(runtime);
  }
});

test("the operator dashboard prefers an older active journey over newer terminal history", async () => {
  const runtime = runtimeDb("operator-active-precedence");
  try {
    await activateDataProtection(runtime.db);
    const active = startPantheonJourney(runtime.db, {
      mode: "rehearsal",
      model: CONFIG.lunaModel,
      carriedExposureCents: 200,
      prompt: "Keep this recoverable journey active.",
    });
    run(
      runtime.db,
      "UPDATE pantheon_journeys SET status = 'cancelled' WHERE id = ?",
      [active.journey.id],
    );
    const newer = startPantheonJourney(runtime.db, {
      mode: "rehearsal",
      model: CONFIG.lunaModel,
      force: true,
      carriedExposureCents: 200,
      prompt: "Create newer terminal history.",
    });
    run(
      runtime.db,
      "UPDATE pantheon_journeys SET status = 'stopped_after_correction' WHERE id = ?",
      [newer.journey.id],
    );
    run(
      runtime.db,
      "UPDATE pantheon_journeys SET status = 'running' WHERE id = ?",
      [active.journey.id],
    );

    assert.equal(activeJourney(runtime.db).id, active.journey.id);
    assert.equal(getJourneyState(runtime.db).journey.id, active.journey.id);
    const cockpit = getCockpitState(runtime.db);
    assert.equal(cockpit.currentJourney.id, active.journey.id);
    assert.equal(cockpit.currentJourney.activeStage, active.journey.active_stage);
    assert.equal(cockpit.currentJourney.currentTask.id, active.state.currentTask.id);
    assert.equal(
      cockpit.importantWork.every((item) => item.journeyId !== newer.journey.id),
      true,
    );
  } finally {
    removeRuntime(runtime);
  }
});

test("the operator dashboard shows the terminal journey that most recently changed", async () => {
  const runtime = runtimeDb("operator-latest-terminal-update");
  try {
    await activateDataProtection(runtime.db);
    const earlier = startPantheonJourney(runtime.db, {
      mode: "rehearsal",
      model: CONFIG.lunaModel,
      carriedExposureCents: 200,
      prompt: "Create the journey that will finish most recently.",
    });
    run(runtime.db, "UPDATE pantheon_journeys SET status = 'cancelled' WHERE id = ?", [earlier.journey.id]);
    const later = startPantheonJourney(runtime.db, {
      mode: "rehearsal",
      model: CONFIG.lunaModel,
      force: true,
      carriedExposureCents: 200,
      prompt: "Create newer terminal history.",
    });
    run(runtime.db, "UPDATE pantheon_journeys SET status = 'cancelled' WHERE id = ?", [later.journey.id]);
    run(
      runtime.db,
      "UPDATE pantheon_journeys SET updated_at = ?, status = 'stopped_after_correction' WHERE id = ?",
      ["2099-01-01T00:00:00.000Z", earlier.journey.id],
    );

    assert.equal(activeJourney(runtime.db), null);
    assert.equal(currentOperatorJourney(runtime.db).id, earlier.journey.id);
    assert.equal(getJourneyState(runtime.db).journey.id, earlier.journey.id);
  } finally {
    removeRuntime(runtime);
  }
});

test("reopening a terminal journey replaces its shared ledger entry instead of counting it twice", async () => {
  const runtime = runtimeDb("reopened-proof-exposure");
  try {
    await activateDataProtection(runtime.db);
    const started = startPantheonJourney(runtime.db, {
      mode: "rehearsal",
      model: CONFIG.lunaModel,
      carriedExposureCents: 0,
      prompt: "Create a journey with one exact local cost.",
    });
    const ts = new Date().toISOString();
    run(
      runtime.db,
      `INSERT INTO costs
       (id, workflow_id, venture_id, task_id, category, source, status,
        amount_cents, currency, occurred_at, metadata)
       VALUES ('cost-reopened-proof', ?, ?, ?, 'live_ai_worker', 'openai-agents-sdk',
        'reconciled', 10, 'AUD', ?, '{}')`,
      [started.journey.workflow_id, started.journey.venture_id, started.state.currentTask.id, ts],
    );
    updateJourney(runtime.db, started.journey.id, {
      status: "stopped_after_correction",
      completedAt: ts,
    });
    const terminal = combinedProofExposureFromDatabase(runtime.db);
    assert.equal(terminal.totalCents, 10);

    updateJourney(runtime.db, started.journey.id, {
      allowTerminalRecovery: true,
      status: "running",
      completedAt: null,
    });
    const reopened = combinedProofExposureFromDatabase(runtime.db);
    assert.equal(reopened.immutableLedgerCents, 10);
    assert.equal(reopened.reopenedJourneySharedCents, 10);
    assert.equal(reopened.sharedCents, 0);
    assert.equal(reopened.activeJourneyLocalCents, 10);
    assert.equal(reopened.totalCents, 10);
  } finally {
    removeRuntime(runtime);
  }
});

test("only a completed journey can reopen for an exact post-completion launch audit", async () => {
  const runtime = runtimeDb("completed-audit-repair");
  try {
    await activateDataProtection(runtime.db);
    const started = startPantheonJourney(runtime.db, {
      mode: "rehearsal",
      model: CONFIG.lunaModel,
      carriedExposureCents: 0,
      prompt: "Create a completed journey for an exact publication-artifact audit.",
    });
    const completedAt = new Date().toISOString();
    updateJourney(runtime.db, started.journey.id, {
      status: "completed",
      activeStage: "ready_to_publish",
      completedAt,
    });
    assert.throws(
      () => updateJourney(runtime.db, started.journey.id, {
        status: "running",
        activeStage: "product_build",
        allowTerminalAuditRepair: true,
      }),
      /finished Pantheon journey cannot return to active work/i,
    );
    const reopened = updateJourney(runtime.db, started.journey.id, {
      status: "running",
      activeStage: "conversion_copy",
      completedAt: null,
      allowTerminalAuditRepair: true,
      metadata: { publicationReadinessInvalidatedReason: "Direct artifact audit found malformed launch copy." },
    });
    assert.equal(reopened.status, "running");
    assert.equal(reopened.active_stage, "conversion_copy");
    assert.equal(reopened.completed_at, null);
  } finally {
    removeRuntime(runtime);
  }
});

test("shared proof exposure carries from rehearsal into production and cannot be lowered", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pantheon-shared-proof-ledger-"));
  const rehearsalPath = path.join(root, "data", "journey-rehearsal", "runtime.sqlite");
  const productionPath = path.join(root, "data", "runtime.sqlite");
  const rehearsal = openDatabase(rehearsalPath);
  const production = openDatabase(productionPath);
  seedDatabase(rehearsal);
  seedDatabase(production);

  try {
    await activateDataProtection(rehearsal);
    await activateDataProtection(production);
    const first = startPantheonJourney(rehearsal, {
      mode: "rehearsal",
      model: CONFIG.lunaModel,
      carriedExposureCents: 100,
      prompt: "Prepare a shared-ledger rehearsal.",
    });
    const proofStartedAt = new Date(first.journey.created_at);
    const unboundCallAt = new Date(proofStartedAt.getTime() + 1_000).toISOString();
    const ts = new Date(proofStartedAt.getTime() + 2_000).toISOString();
    run(
      rehearsal,
      `INSERT INTO model_calls (
         id, provider, model_class, selected_model, mode, status,
         input_tokens, output_tokens, estimated_cost_cents, actual_cost_cents,
         approval_required, metadata, created_at, cost_status,
         incurred_estimate_cents, outcome_status
       ) VALUES (
         'model-call-unbound-proof-window', 'openai-agents-sdk', 'luna', ?,
         'live', 'completed', 10, 5, 17, 0, 0, ?, ?,
         'estimated_incurred', 17, 'known_success'
       )`,
      [
        CONFIG.lunaModel,
        toJson({ proofTest: true, reason: "Compatibility call between journey boundaries" }),
        unboundCallAt,
      ],
    );
    run(
      rehearsal,
      `INSERT INTO costs
       (id, workflow_id, venture_id, task_id, category, source, status,
        amount_cents, currency, occurred_at, metadata)
       VALUES (?, ?, ?, ?, 'live_ai_worker', 'openai-agents-sdk', 'reconciled',
        25, 'AUD', ?, ?)`,
      [
        "cost-shared-proof-rehearsal",
        first.journey.workflow_id,
        first.journey.venture_id,
        first.state.currentTask.id,
        ts,
        toJson({ proofTest: true }),
      ],
    );
    updateJourney(rehearsal, first.journey.id, {
      status: "stopped_after_correction",
      completedAt: ts,
      stageEvent: {
        status: "stopped_after_correction",
        note: "Test rehearsal closed with a known A$0.25 local cost.",
      },
    });

    const rehearsalExposure = readProofExposure(rehearsal);
    assert.equal(rehearsalExposure.totalCents, 142);
    assert.equal(
      rehearsalExposure.sources.some(
        (entry) => entry.sourceKey === "model-call:model-call-unbound-proof-window"
          && entry.amountCents === 17,
      ),
      true,
    );
    assert.equal(
      proofExposureLedgerPath(rehearsal),
      proofExposureLedgerPath(production),
    );

    const second = startPantheonJourney(production, {
      mode: "production",
      model: CONFIG.lunaModel,
      carriedExposureCents: 0,
      prompt: "Production must retain the verified rehearsal exposure.",
    });
    assert.equal(second.journey.carried_exposure_cents, 142);

    const secondCallAt = new Date(new Date(second.journey.created_at).getTime() + 1_000).toISOString();
    run(
      production,
      `INSERT INTO model_calls (
         id, provider, model_class, selected_model, mode, status,
         input_tokens, output_tokens, estimated_cost_cents, actual_cost_cents,
         approval_required, metadata, created_at, cost_status,
         incurred_estimate_cents, outcome_status
       ) VALUES (
         'model-call-production-unbound', 'openai-agents-sdk', 'luna', ?,
         'live', 'completed', 10, 5, 20, 0, 0, ?, ?,
         'estimated_incurred', 20, 'known_success'
       )`,
      [CONFIG.lunaModel, toJson({ proofTest: true }), secondCallAt],
    );
    run(
      production,
      `INSERT INTO costs
       (id, workflow_id, venture_id, task_id, category, source, status,
        amount_cents, currency, occurred_at, metadata)
       VALUES (?, ?, ?, ?, 'live_ai_worker', 'openai-agents-sdk', 'reconciled',
        10, 'AUD', ?, ?)`,
      [
        "cost-shared-proof-production",
        second.journey.workflow_id,
        second.journey.venture_id,
        second.state.currentTask.id,
        new Date(new Date(secondCallAt).getTime() + 1_000).toISOString(),
        toJson({ proofTest: true }),
      ],
    );
    const combined = combinedProofExposureFromDatabase(production);
    assert.equal(combined.sharedCents, 162);
    assert.equal(combined.activeJourneyLocalCents, 10);
    assert.equal(combined.totalCents, 172);
    assert.equal(getJourneyState(production, second.journey.id).exposure.totalCents, 172);
    run(
      production,
      "UPDATE tasks SET cost_budget_cents = ? WHERE id = ?",
      [CONFIG.journeyBudgetCapCents, second.state.currentTask.id],
    );
    const budgetTask = get(production, "SELECT * FROM tasks WHERE id = ?", [second.state.currentTask.id]);
    assert.throws(
      () => reserveBudget(production, budgetTask, null, CONFIG.journeyBudgetCapCents - 160),
      /full-journey cap/i,
    );

    const ledger = new DatabaseSync(proofExposureLedgerPath(production));
    try {
      assert.throws(
        () => ledger.exec("UPDATE proof_exposure_entries SET amount_cents = 0"),
        /immutable/i,
      );
    } finally {
      ledger.close();
    }
  } finally {
    rehearsal.close();
    production.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("the durable proof ledger ignores temporary control-token changes", () => {
  const runtime = runtimeDb("persistent-proof-key");
  const previous = {
    privacy: process.env.PANTHEON_PRIVACY_HASH_KEY,
    legacyPrivacy: process.env.JARVIS_PRIVACY_HASH_KEY,
    control: process.env.PANTHEON_CONTROL_TOKEN,
    legacyControl: process.env.JARVIS_CONTROL_TOKEN,
  };
  try {
    process.env.PANTHEON_PRIVACY_HASH_KEY = "persistent-proof-key-a-32-bytes";
    process.env.JARVIS_PRIVACY_HASH_KEY = process.env.PANTHEON_PRIVACY_HASH_KEY;
    process.env.PANTHEON_CONTROL_TOKEN = "temporary-session-one";
    process.env.JARVIS_CONTROL_TOKEN = process.env.PANTHEON_CONTROL_TOKEN;
    appendProofExposure(runtime.db, {
      sourceKey: "durable-key-test",
      sourceType: "test",
      amountCents: 12,
    });
    process.env.PANTHEON_CONTROL_TOKEN = "temporary-session-two";
    process.env.JARVIS_CONTROL_TOKEN = process.env.PANTHEON_CONTROL_TOKEN;
    assert.equal(readProofExposure(runtime.db).totalCents, 12);
  } finally {
    for (const [name, value] of Object.entries({
      PANTHEON_PRIVACY_HASH_KEY: previous.privacy,
      JARVIS_PRIVACY_HASH_KEY: previous.legacyPrivacy,
      PANTHEON_CONTROL_TOKEN: previous.control,
      JARVIS_CONTROL_TOKEN: previous.legacyControl,
    })) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    removeRuntime(runtime);
  }
});

test("production proof accounting never falls back to a temporary control token", () => {
  const runtime = runtimeDb("no-control-token-fallback");
  const previous = {
    nodeEnv: process.env.NODE_ENV,
    privacy: process.env.PANTHEON_PRIVACY_HASH_KEY,
    legacyPrivacy: process.env.JARVIS_PRIVACY_HASH_KEY,
    control: process.env.PANTHEON_CONTROL_TOKEN,
    legacyControl: process.env.JARVIS_CONTROL_TOKEN,
  };
  try {
    process.env.NODE_ENV = "production";
    delete process.env.PANTHEON_PRIVACY_HASH_KEY;
    delete process.env.JARVIS_PRIVACY_HASH_KEY;
    process.env.PANTHEON_CONTROL_TOKEN = "temporary-session-only";
    process.env.JARVIS_CONTROL_TOKEN = process.env.PANTHEON_CONTROL_TOKEN;
    assert.throws(
      () => readProofExposure(runtime.db),
      /protected privacy key/i,
    );
  } finally {
    for (const [name, value] of Object.entries({
      NODE_ENV: previous.nodeEnv,
      PANTHEON_PRIVACY_HASH_KEY: previous.privacy,
      JARVIS_PRIVACY_HASH_KEY: previous.legacyPrivacy,
      PANTHEON_CONTROL_TOKEN: previous.control,
      JARVIS_CONTROL_TOKEN: previous.legacyControl,
    })) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    removeRuntime(runtime);
  }
});

test("a mismatched proof signature can only be recovered from matching runtime truth", async () => {
  const runtime = runtimeDb("proof-ledger-recovery");
  const previous = {
    privacy: process.env.PANTHEON_PRIVACY_HASH_KEY,
    legacyPrivacy: process.env.JARVIS_PRIVACY_HASH_KEY,
  };
  try {
    await activateDataProtection(runtime.db);
    process.env.PANTHEON_PRIVACY_HASH_KEY = "retired-proof-key-a-32-bytes-long";
    process.env.JARVIS_PRIVACY_HASH_KEY = process.env.PANTHEON_PRIVACY_HASH_KEY;
    const started = startPantheonJourney(runtime.db, {
      mode: "rehearsal",
      model: CONFIG.lunaModel,
      carriedExposureCents: 0,
      prompt: "Create one independently recoverable proof source.",
    });
    const completedAt = new Date().toISOString();
    run(
      runtime.db,
      `INSERT INTO costs
       (id, workflow_id, venture_id, task_id, category, source, status,
        amount_cents, currency, occurred_at, metadata)
       VALUES ('cost-proof-ledger-recovery', ?, ?, ?, 'live_ai_worker',
        'openai-agents-sdk', 'reconciled', 25, 'AUD', ?, '{}')`,
      [
        started.journey.workflow_id,
        started.journey.venture_id,
        started.state.currentTask.id,
        completedAt,
      ],
    );
    updateJourney(runtime.db, started.journey.id, {
      status: "stopped_after_correction",
      completedAt,
    });
    assert.equal(combinedProofExposureFromDatabase(runtime.db).totalCents, 25);

    process.env.PANTHEON_PRIVACY_HASH_KEY = "replacement-proof-key-b-32-bytes";
    process.env.JARVIS_PRIVACY_HASH_KEY = process.env.PANTHEON_PRIVACY_HASH_KEY;
    assert.throws(
      () => readProofExposure(runtime.db),
      /different protected privacy key/i,
    );
    assert.throws(
      () => recoverProofExposureLedger(runtime.db, {
        allowIntegrityRecovery: true,
        reason: "Test recovery must reject an understated total.",
        expectedTotalCents: 24,
      }),
      /verified totals differ/i,
    );

    const recovered = recoverProofExposureLedger(runtime.db, {
      allowIntegrityRecovery: true,
      reason: "The retained source matched the runtime cost record exactly.",
      expectedTotalCents: 25,
    });
    assert.equal(recovered.totalCents, 25);
    assert.equal(recovered.combinedTotalCents, 25);
    assert.equal(recovered.priorEntryCount, 1);
    assert.equal(recovered.rebuiltEntryCount, 1);
    assert.equal(fs.existsSync(recovered.quarantinePath), true);
    const ledger = new DatabaseSync(proofExposureLedgerPath(runtime.db), { readOnly: true });
    try {
      assert.equal(
        ledger.prepare("SELECT COUNT(*) AS count FROM proof_exposure_recoveries").get().count,
        1,
      );
    } finally {
      ledger.close();
    }
  } finally {
    for (const [name, value] of Object.entries({
      PANTHEON_PRIVACY_HASH_KEY: previous.privacy,
      JARVIS_PRIVACY_HASH_KEY: previous.legacyPrivacy,
    })) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    removeRuntime(runtime);
  }
});

test("declining a journey-bound approval closes the journey instead of leaving a dead end", async () => {
  const runtime = runtimeDb("declined-journey");
  try {
    await activateDataProtection(runtime.db);
    const started = startPantheonJourney(runtime.db, {
      mode: "rehearsal",
      model: CONFIG.lunaModel,
      prompt: "Prepare a journey decision that Daniel can decline.",
    });
    const task = get(runtime.db, "SELECT * FROM tasks WHERE id = ?", [started.state.currentTask.id]);
    const approval = get(runtime.db, "SELECT * FROM approvals WHERE id = ?", [task.approval_id]);
    run(
      runtime.db,
      "UPDATE tasks SET status = 'blocked', updated_at = ? WHERE id = ?",
      [new Date().toISOString(), task.id],
    );
    run(
      runtime.db,
      `UPDATE approvals
       SET status = 'pending', decided_at = NULL, decision_note = NULL
       WHERE id = ?`,
      [approval.id],
    );

    decideApproval(runtime.db, approval.id, "rejected", "Do not continue this proof.", {
      expectedScopeHash: approval.scope_hash,
    });

    assert.equal(
      get(runtime.db, "SELECT status FROM pantheon_journeys WHERE id = ?", [started.journey.id]).status,
      "cancelled",
    );
    assert.equal(activeJourney(runtime.db), null);
    assert.equal(getJourneyState(runtime.db, started.journey.id).correction, null);
  } finally {
    removeRuntime(runtime);
  }
});

test("a failed corrected attempt stops its journey and cannot intercept the next one", async () => {
  const previous = {
    key: process.env.OPENAI_API_KEY,
    models: process.env.PANTHEON_ENABLE_LIVE_MODELS,
    research: process.env.PANTHEON_ENABLE_LIVE_RESEARCH,
  };
  process.env.OPENAI_API_KEY = "test-journey-correction-key";
  process.env.PANTHEON_ENABLE_LIVE_MODELS = "1";
  process.env.PANTHEON_ENABLE_LIVE_RESEARCH = "1";
  const runtime = runtimeDb("correction-stop");

  try {
    await activateDataProtection(runtime.db);
    const first = startPantheonJourney(runtime.db, {
      mode: "rehearsal",
      model: CONFIG.lunaModel,
      carriedExposureCents: 250,
      prompt: "Find one evidence-backed digital product opportunity.",
    });
    const task = get(runtime.db, "SELECT * FROM tasks WHERE id = ?", [first.state.currentTask.id]);
    const payload = fromJson(task.payload, {});
    payload.liveSpendRequest.parameters.pantheonProduction = {
      supervisorOwned: true,
      stage: "product_build",
      revisionNumber: 1,
      journeyId: first.journey.id,
    };
    run(
      runtime.db,
      `UPDATE tasks
       SET status = 'needs_attention', outcome_status = 'known_provider_result_needs_review',
           error = ?, payload = ?, updated_at = ?
       WHERE id = ?`,
      ["The corrected result still failed.", toJson(payload), new Date().toISOString(), task.id],
    );

    const stopped = await runPantheonSupervisorCycle(runtime.db, {
      triggerType: "test",
      startedBy: "pantheon-journey-hardening-test",
      allowDiscoveryStart: false,
    });
    assert.equal(stopped.status, "needs_attention");
    assert.equal(get(runtime.db, "SELECT status FROM pantheon_journeys WHERE id = ?", [first.journey.id]).status, "stopped_after_correction");
    assert.equal(get(runtime.db, "SELECT status FROM workflows WHERE id = ?", [first.journey.workflow_id]).status, "failed");
    assert.equal(get(runtime.db, "SELECT status FROM opportunity_rounds WHERE id = ?", [first.journey.round_id]).status, "stopped_after_correction");
    assert.equal(getJourneyState(runtime.db, first.journey.id).correction, null);
    assert.equal(isTerminalJourneyStatus("stopped_after_correction"), true);
    assert.equal(isTerminalJourneyStatus("stopped_unknown_outcome"), true);
    assert.equal(isTerminalJourneyStatus("needs_attention"), false);

    const second = startPantheonJourney(runtime.db, {
      mode: "rehearsal",
      model: CONFIG.lunaModel,
      prompt: "Start a clean replacement journey.",
      force: true,
    });
    assert.notEqual(second.journey.id, first.journey.id);
    assert.equal(second.journey.carried_exposure_cents, 250);
    assert.equal(pendingCommercialTask(runtime.db).id, second.state.currentTask.id);

    run(
      runtime.db,
      "UPDATE pantheon_journeys SET status = 'cancelled', carried_exposure_cents = 0 WHERE id = ?",
      [second.journey.id],
    );
    const third = startPantheonJourney(runtime.db, {
      mode: "rehearsal",
      model: CONFIG.lunaModel,
      prompt: "Recover the highest prior proof exposure after an empty interrupted start.",
      force: true,
    });
    assert.equal(third.journey.carried_exposure_cents, 250);
  } finally {
    removeRuntime(runtime);
    for (const [name, value] of Object.entries({
      OPENAI_API_KEY: previous.key,
      PANTHEON_ENABLE_LIVE_MODELS: previous.models,
      PANTHEON_ENABLE_LIVE_RESEARCH: previous.research,
    })) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

test("an unknown paid provider outcome terminally stops the exact journey without retrying", async () => {
  const previous = {
    key: process.env.OPENAI_API_KEY,
    models: process.env.PANTHEON_ENABLE_LIVE_MODELS,
    research: process.env.PANTHEON_ENABLE_LIVE_RESEARCH,
  };
  process.env.OPENAI_API_KEY = "test-journey-unknown-key";
  process.env.PANTHEON_ENABLE_LIVE_MODELS = "1";
  process.env.PANTHEON_ENABLE_LIVE_RESEARCH = "1";
  const runtime = runtimeDb("unknown-outcome-stop");
  try {
    await activateDataProtection(runtime.db);
    const started = startPantheonJourney(runtime.db, {
      mode: "rehearsal",
      model: CONFIG.lunaModel,
      prompt: "Stop safely if the provider outcome cannot be confirmed.",
    });
    run(
      runtime.db,
      `UPDATE tasks
       SET status = 'needs_attention', outcome_status = 'unknown',
           error = 'Provider outcome could not be confirmed.', updated_at = ?
       WHERE id = ?`,
      [new Date().toISOString(), started.state.currentTask.id],
    );
    const cycle = await runPantheonSupervisorCycle(runtime.db, {
      triggerType: "test",
      startedBy: "pantheon-journey-hardening-test",
      allowDiscoveryStart: false,
    });
    assert.equal(cycle.status, "needs_attention");
    assert.equal(
      get(runtime.db, "SELECT status FROM pantheon_journeys WHERE id = ?", [started.journey.id]).status,
      "stopped_unknown_outcome",
    );
    assert.equal(get(runtime.db, "SELECT status FROM workflows WHERE id = ?", [started.journey.workflow_id]).status, "failed");
    assert.equal(
      get(runtime.db, "SELECT status FROM opportunity_rounds WHERE id = ?", [started.journey.round_id]).status,
      "stopped_unknown_outcome",
    );
    assert.equal(
      get(runtime.db, "SELECT COUNT(*) AS count FROM task_attempts WHERE task_id = ?", [started.state.currentTask.id]).count,
      0,
      "Pantheon must not create a retry attempt after an unknown provider outcome.",
    );
  } finally {
    removeRuntime(runtime);
    for (const [name, value] of Object.entries({
      OPENAI_API_KEY: previous.key,
      PANTHEON_ENABLE_LIVE_MODELS: previous.models,
      PANTHEON_ENABLE_LIVE_RESEARCH: previous.research,
    })) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});
