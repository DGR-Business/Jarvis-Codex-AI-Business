const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  fromJson,
  get,
  openDatabase,
  run,
  seedDatabase,
  toJson,
} = require("../src/db");
const {
  buildApprovalScope,
  canonicalWorkerApprovalPolicy,
  scopeHash,
  validateApprovalScope,
  validateMaterializedExecution,
  verifyExecutionDescriptor,
  workerDefinitionHash,
} = require("../src/runtime/approval-scope");
const {
  createPilotFixture,
  ensureDemandValidatorPilotFixture,
  prepareDemandValidatorPilot,
} = require("../src/runtime/agent-pilot");
const { AI_TEAM_DEFINITIONS } = require("../src/runtime/ai-team");
const {
  DEFAULT_ALLOWED_WORKERS,
  SUPPORTED_CHIEF_SPECIALISTS,
  prepareChiefSpecialistAssignment,
  requestChiefOrchestration,
} = require("../src/runtime/chief-orchestration");
const {
  refreshOutdatedLiveAiWorkerApproval,
  requestLiveAiWorker,
} = require("../src/runtime/live-ai-workers");

function makeRuntime(name) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `jarvis-policy-hardening-${name}-`));
  const db = openDatabase(path.join(root, "runtime.sqlite"));
  seedDatabase(db);
  return { root, db };
}

function closeRuntime(runtime) {
  runtime.db.close();
  fs.rmSync(runtime.root, { recursive: true, force: true });
}

function insertWorkflow(db, id, type = "digital_product") {
  const ts = "2026-07-17T00:00:00.000Z";
  run(
    db,
    `INSERT INTO workflows
     (id, venture_id, type, title, status, current_step, priority, metadata, created_at, updated_at)
     VALUES (?, 'venture-digital-products', ?, 'Policy hardening proof', 'planned', '', 1, ?, ?, ?)`,
    [id, type, toJson({ subject: "A bounded digital product", channel: "Digital Product" }), ts, ts],
  );
}

function recordRouteEvidence(db, task, values) {
  const runId = values.runId;
  run(
    db,
    `INSERT INTO agent_runs
     (id, agent_id, workflow_id, task_id, venture_id, mode, status, input_summary,
      output_summary, approval_required, eval_status, metadata, started_at, completed_at)
     VALUES (?, ?, ?, ?, ?, 'openai-agents-sdk', ?, 'Bounded route proof', 'Recorded result',
      1, ?, '{}', ?, ?)`,
    [
      runId,
      task.agent,
      task.workflow_id,
      task.id,
      task.venture_id,
      values.runStatus,
      values.qualityStatus,
      values.at,
      values.at,
    ],
  );
  run(
    db,
    `INSERT INTO task_attempts
     (id, task_id, workflow_id, venture_id, claim_token, status, outcome_status,
      agent_run_id, evidence_binding_status, started_at, completed_at, metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'exact', ?, ?, '{}')`,
    [
      `attempt-${runId}`,
      task.id,
      task.workflow_id,
      task.venture_id,
      `claim-${runId}`,
      values.attemptStatus,
      values.outcomeStatus,
      runId,
      values.at,
      values.at,
    ],
  );
  run(
    db,
    `INSERT INTO agent_eval_results
     (id, run_id, agent_id, task_id, attempt_id, status, score, criteria, findings,
      metadata, evaluator_version, subject_hash, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, '[]', '[]', '{}', 'route-history-test-v1', ?, ?)`,
    [
      `eval-${runId}`,
      runId,
      task.agent,
      task.id,
      `attempt-${runId}`,
      values.qualityStatus,
      values.qualityStatus === "passed" ? 90 : 65,
      scopeHash({ runId }),
      values.at,
    ],
  );
}

function insertChiefSource(db, suffix, allowedWorkers) {
  const workflowId = `wf-chief-boundary-${suffix}`;
  const taskId = `task-chief-boundary-${suffix}`;
  const runId = `run-chief-boundary-${suffix}`;
  const ts = "2026-07-17T00:00:00.000Z";
  insertWorkflow(db, workflowId, "chief_orchestration");
  run(
    db,
    `INSERT INTO tasks
     (id, workflow_id, venture_id, title, kind, agent, status, priority, cost_budget_cents,
      payload, result, created_at, updated_at)
     VALUES (?, ?, 'venture-digital-products', 'Choose one specialist',
      'live_ai_worker_execution', 'chief_of_staff', 'completed', 1, 100, ?, '{}', ?, ?)`,
    [
      taskId,
      workflowId,
      toJson({
        subject: "A bounded digital product",
        chiefOrchestration: {
          enabled: true,
          policy: {
            allowedWorkers,
            allowedModes: ["protected"],
            maxSpecialistCostCents: 100,
          },
        },
      }),
      ts,
      ts,
    ],
  );
  run(
    db,
    `INSERT INTO agent_runs
     (id, agent_id, workflow_id, task_id, venture_id, mode, status, input_summary,
      output_summary, approval_required, metadata, started_at, completed_at)
     VALUES (?, 'chief_of_staff', ?, ?, 'venture-digital-products', 'openai-agents-sdk',
      'completed', 'Choose one specialist', 'Recommendation ready', 1, '{}', ?, ?)`,
    [runId, workflowId, taskId, ts, ts],
  );
  return {
    task: {
      ...get(db, "SELECT * FROM tasks WHERE id = ?", [taskId]),
      payload: fromJson(get(db, "SELECT payload FROM tasks WHERE id = ?", [taskId]).payload, {}),
    },
    run: get(db, "SELECT * FROM agent_runs WHERE id = ?", [runId]),
  };
}

function chiefOutput(workerId) {
  return {
    recommendation: "Use one bounded specialist.",
    roleOutput: {
      specialistNeeded: true,
      specialistWorker: workerId,
      specialistObjective: "Check the exact commercial assumptions.",
      specialistExpectedOutput: "A concise recommendation with evidence and risks.",
      specialistMode: "protected",
      specialistContextClasses: ["venture", "finance"],
      specialistReason: "The next decision needs one bounded specialist check.",
    },
  };
}

test("live approval binds the canonical persisted worker approval policy", () => {
  const runtime = makeRuntime("approval-policy");
  try {
    insertWorkflow(runtime.db, "wf-policy-binding");
    const requested = requestLiveAiWorker(runtime.db, "wf-policy-binding", {
      worker: "finance_analyst",
      requestedBy: "test",
      requestKey: "policy-binding",
      estimatedCostCents: 100,
      maxOutputTokens: 200,
      capabilityKey: "finance_analyst.unit_economics",
    });
    const task = requested.task;
    const descriptor = task.payload.liveSpendRequest.executionDescriptor;
    const definition = get(runtime.db, "SELECT * FROM agent_definitions WHERE id = 'finance_analyst'");
    const persistedPolicy = fromJson(definition.approval_policy, {});
    const codeDefinition = AI_TEAM_DEFINITIONS.find((worker) => worker.id === "finance_analyst");

    assert.deepEqual(descriptor.workerApprovalPolicy, persistedPolicy);
    assert.equal(descriptor.workerApprovalPolicyHash, scopeHash(persistedPolicy));
    assert.equal(task.payload.liveSpendRequest.worker.approvalPolicyHash, scopeHash(persistedPolicy));
    assert.deepEqual(
      canonicalWorkerApprovalPolicy({ approvalPolicy: persistedPolicy }),
      canonicalWorkerApprovalPolicy({ approval_policy: definition.approval_policy }),
    );
    assert.equal(workerDefinitionHash(codeDefinition), workerDefinitionHash(definition));
    assert.equal(verifyExecutionDescriptor(descriptor).valid, true);
    assert.equal(validateApprovalScope(runtime.db, requested.approval.id, task).valid, true);

    const reorderedPolicy = Object.fromEntries(Object.entries(persistedPolicy).reverse());
    run(
      runtime.db,
      "UPDATE agent_definitions SET approval_policy = ? WHERE id = 'finance_analyst'",
      [toJson(reorderedPolicy)],
    );
    assert.equal(validateMaterializedExecution(runtime.db, task, descriptor).valid, true);

    run(
      runtime.db,
      "UPDATE agent_definitions SET approval_policy = ? WHERE id = 'finance_analyst'",
      [toJson({
        ...persistedPolicy,
        mustPauseFor: [...(persistedPolicy.mustPauseFor || []), "new exact operator stop"],
      })],
    );
    const invalid = validateApprovalScope(runtime.db, requested.approval.id, task);
    assert.equal(invalid.valid, false);
    assert.match(invalid.reason, /worker approval policy changed/i);
  } finally {
    closeRuntime(runtime);
  }
});

test("outdated pending worker decisions are replaced before any execution or spend", () => {
  const runtime = makeRuntime("approval-policy-refresh");
  try {
    const fixture = ensureDemandValidatorPilotFixture(runtime.db);
    const prepared = prepareDemandValidatorPilot(runtime.db, fixture.id, {
      requestedBy: "test",
      estimatedCostCents: 100,
    });
    const oldApprovalId = prepared.requested.approval.id;
    const oldScopeHash = prepared.requested.approval.scope_hash;
    const taskRow = get(runtime.db, "SELECT * FROM tasks WHERE id = ?", [prepared.requested.task.id]);
    const taskPayload = fromJson(taskRow.payload, {});
    const legacyDescriptor = JSON.parse(JSON.stringify(taskPayload.liveSpendRequest.executionDescriptor));
    delete legacyDescriptor.workerApprovalPolicy;
    delete legacyDescriptor.workerApprovalPolicyHash;
    const { descriptorHash: ignoredDescriptorHash, ...legacyDescriptorBody } = legacyDescriptor;
    legacyDescriptor.descriptorHash = scopeHash(legacyDescriptorBody);
    taskPayload.liveSpendRequest.executionDescriptor = legacyDescriptor;
    delete taskPayload.liveSpendRequest.worker.approvalPolicy;
    delete taskPayload.liveSpendRequest.worker.approvalPolicyHash;
    delete taskPayload.liveSpendRequest.worker.definitionHash;
    run(runtime.db, "UPDATE tasks SET payload = ? WHERE id = ?", [
      toJson(taskPayload),
      taskRow.id,
    ]);

    const approvalRow = get(runtime.db, "SELECT * FROM approvals WHERE id = ?", [oldApprovalId]);
    const approvalPayload = fromJson(approvalRow.payload, {});
    approvalPayload.executionDescriptor = legacyDescriptor;
    if (approvalPayload.worker) {
      delete approvalPayload.worker.approvalPolicy;
      delete approvalPayload.worker.approvalPolicyHash;
      delete approvalPayload.worker.definitionHash;
    }
    const legacyTask = {
      ...get(runtime.db, "SELECT * FROM tasks WHERE id = ?", [taskRow.id]),
      payload: taskPayload,
    };
    const legacyScopeHash = scopeHash(buildApprovalScope(
      { ...approvalRow, payload: approvalPayload },
      legacyTask,
    ));
    run(
      runtime.db,
      "UPDATE approvals SET payload = ?, scope_hash = ? WHERE id = ?",
      [toJson(approvalPayload), legacyScopeHash, oldApprovalId],
    );

    const invalid = validateApprovalScope(runtime.db, oldApprovalId, legacyTask);
    assert.equal(invalid.valid, false);
    assert.match(invalid.reason, /no exact worker policy binding/i);

    const refreshed = refreshOutdatedLiveAiWorkerApproval(runtime.db, oldApprovalId, {
      trigger: "test-policy-refresh",
    });
    assert.equal(refreshed.refreshed, true);
    assert.notEqual(refreshed.replacementApprovalId, oldApprovalId);
    assert.notEqual(refreshed.approval.scope_hash, oldScopeHash);
    assert.equal(get(runtime.db, "SELECT status FROM approvals WHERE id = ?", [oldApprovalId]).status, "superseded");

    const replacementTaskRow = get(runtime.db, "SELECT * FROM tasks WHERE id = ?", [taskRow.id]);
    const replacementTask = {
      ...replacementTaskRow,
      payload: fromJson(replacementTaskRow.payload, {}),
    };
    assert.equal(replacementTask.approval_id, refreshed.replacementApprovalId);
    assert.equal(replacementTask.status, "blocked");
    assert.equal(replacementTask.outcome_status, "not_started");
    assert.equal(replacementTask.attempt_count, 0);
    assert.equal(replacementTask.cost_actual_cents, 0);
    assert.equal(
      verifyExecutionDescriptor(replacementTask.payload.liveSpendRequest.executionDescriptor).valid,
      true,
    );
    assert.equal(
      validateApprovalScope(runtime.db, refreshed.replacementApprovalId, replacementTask).valid,
      true,
    );
    assert.equal(get(runtime.db, "SELECT COUNT(*) AS count FROM task_attempts WHERE task_id = ?", [taskRow.id]).count, 0);
    assert.equal(get(runtime.db, "SELECT COUNT(*) AS count FROM model_calls WHERE task_id = ?", [taskRow.id]).count, 0);
    assert.equal(get(runtime.db, "SELECT COUNT(*) AS count FROM agent_runs WHERE task_id = ?", [taskRow.id]).count, 0);

    const cost = get(runtime.db, "SELECT * FROM costs WHERE id = ?", [`cost_spend_${taskRow.id}`]);
    assert.equal(cost.amount_cents, 0);
    assert.equal(cost.status, "approval_requested");
    assert.equal(fromJson(cost.metadata, {}).approvalId, refreshed.replacementApprovalId);
    assert.equal(fromJson(cost.metadata, {}).approvalRefreshHistory.length, 1);
    assert.equal(
      get(
        runtime.db,
        "SELECT COUNT(*) AS count FROM events WHERE type = 'approval.safely_refreshed' AND entity_id = ?",
        [refreshed.replacementApprovalId],
      ).count,
      1,
    );
  } finally {
    closeRuntime(runtime);
  }
});

test("normal callers cannot manufacture a context-free fixture request", () => {
  const runtime = makeRuntime("context-bypass");
  try {
    insertWorkflow(runtime.db, "wf-context-bypass");
    assert.throws(
      () => requestLiveAiWorker(runtime.db, "wf-context-bypass", {
        worker: "demand_validator",
        requestedBy: "dashboard",
        estimatedCostCents: 100,
        maxOutputTokens: 200,
        fixtureHash: "caller-controlled",
        fixtureInput: {
          id: "caller-controlled",
          version: 1,
          hash: "caller-controlled",
          question: "Can context be skipped?",
          buyer: "Test buyer",
          hypothesis: "Caller input is enough.",
          sources: [],
          constraints: {},
        },
      }),
      /persisted pilot fixture/i,
    );

    const authenticFixture = createPilotFixture(runtime.db, {
      id: "authentic-fixture-cannot-be-reused",
      ventureId: "venture-digital-products",
      fixtureVersion: 1,
      question: "Does this bounded evidence justify one small test?",
      buyer: "A bounded test buyer",
      hypothesis: "The supplied evidence may justify a small test.",
      sources: [{
        id: "authentic-source",
        title: "Supplied observation",
        sourceType: "test_fixture",
        summary: "One bounded observation is available for evaluation.",
      }],
      constraints: { evaluationOnly: true, realBusinessEvidence: false },
    });
    assert.throws(
      () => requestLiveAiWorker(runtime.db, "wf-context-bypass", {
        worker: "demand_validator",
        requestedBy: "dashboard",
        estimatedCostCents: 100,
        maxOutputTokens: 1200,
        taskTitle: "Demand Validator controlled proof",
        approvalTitle: "Approve this Demand Validator proof",
        expectedOutput: "A structured recommendation with evidence, counterevidence, assumptions, price/channel hypothesis, smallest test, metric, stop rule, confidence and risks.",
        expectedMetric: "Deterministic scope, source, structure and cost checks pass; Daniel separately judges commercial usefulness.",
        fixtureHash: authenticFixture.fixture_hash,
        fixtureInput: {
          id: authenticFixture.id,
          version: authenticFixture.fixture_version,
          hash: authenticFixture.fixture_hash,
          question: authenticFixture.question,
          buyer: authenticFixture.buyer,
          hypothesis: authenticFixture.hypothesis,
          sources: authenticFixture.sources,
          constraints: authenticFixture.constraints,
        },
        comparisonSource: {
          type: "versioned_agent_pilot_fixture",
          fixtureId: authenticFixture.id,
          fixtureHash: authenticFixture.fixture_hash,
        },
        protectedEvidence: authenticFixture.sources.map((source) => `${source.title}: ${source.summary}`),
        tools: [],
        maxTurns: 1,
        maxToolCalls: 0,
        effects: [],
        tracePolicy: {
          providerResponseStored: true,
          providerTraceContent: true,
          localReviewStored: true,
          dataClass: "controlled_fixture_no_personal_data",
          purpose: "Make the supplied fixture and structured recommendation reviewable in OpenAI traces while retaining the local audit record.",
        },
      }),
      /exact agent-pilot workflow/i,
    );
    assert.equal(
      get(runtime.db, "SELECT COUNT(*) AS count FROM tasks WHERE workflow_id = 'wf-context-bypass'").count,
      0,
    );
  } finally {
    closeRuntime(runtime);
  }
});

test("Chief intersects requested workers with the fixed production specialist allowlist", () => {
  const runtime = makeRuntime("chief-boundary");
  try {
    assert.equal(DEFAULT_ALLOWED_WORKERS.includes("chief_of_staff"), false);
    assert.equal(DEFAULT_ALLOWED_WORKERS.includes("quality_reviewer"), false);
    assert.deepEqual(DEFAULT_ALLOWED_WORKERS, SUPPORTED_CHIEF_SPECIALISTS);

    insertWorkflow(runtime.db, "wf-chief-policy-request", "chief_orchestration");
    const requested = requestChiefOrchestration(runtime.db, "wf-chief-policy-request", {
      estimatedCostCents: 100,
      allowedWorkers: [
        "chief_of_staff",
        "quality_reviewer",
        "finance_analyst",
        "arbitrary_fixed_team_role",
      ],
    });
    assert.deepEqual(
      requested.task.payload.chiefOrchestration.policy.allowedWorkers,
      ["finance_analyst"],
    );

    const source = insertChiefSource(runtime.db, "reject-forbidden", [
      "chief_of_staff",
      "quality_reviewer",
      "finance_analyst",
      "arbitrary_fixed_team_role",
    ]);
    for (const workerId of ["chief_of_staff", "quality_reviewer", "arbitrary_fixed_team_role"]) {
      assert.throws(
        () => prepareChiefSpecialistAssignment(runtime.db, {
          ...source,
          output: chiefOutput(workerId),
        }),
        /outside the fixed approved team/i,
      );
    }
    const allowed = prepareChiefSpecialistAssignment(runtime.db, {
      ...source,
      output: chiefOutput("finance_analyst"),
    });
    assert.equal(allowed.assignment.workerId, "finance_analyst");
    assert.equal(allowed.assignment.requiredReviewer, "chief_of_staff");
  } finally {
    closeRuntime(runtime);
  }
});

test("model routing escalates only exact failed history and clears after a later pass", () => {
  const runtime = makeRuntime("route-history");
  try {
    insertWorkflow(runtime.db, "wf-route-history");
    const baseOptions = {
      worker: "offer_architect",
      requestedBy: "test",
      estimatedCostCents: 100,
      maxOutputTokens: 200,
      capabilityKey: "offer_architect.price_hypothesis",
    };
    const first = requestLiveAiWorker(runtime.db, "wf-route-history", {
      ...baseOptions,
      requestKey: "first",
    });
    assert.equal(first.modelRoute.tier, "terra");
    assert.equal(first.modelRoute.routeHistory.matched, false);
    assert.equal(first.task.max_retries, 0);

    recordRouteEvidence(runtime.db, first.task, {
      runId: "run-route-needs-review",
      runStatus: "completed",
      qualityStatus: "needs_review",
      attemptStatus: "needs_attention",
      outcomeStatus: "known_provider_result_needs_review",
      at: "2099-01-01T00:00:00.000Z",
    });
    const escalated = requestLiveAiWorker(runtime.db, "wf-route-history", {
      ...baseOptions,
      requestKey: "escalated",
    });
    assert.equal(escalated.modelRoute.tier, "sol");
    assert.equal(escalated.modelRoute.routeHistory.priorRunId, "run-route-needs-review");
    assert.equal(escalated.modelRoute.routeHistory.qualityStatus, "needs_review");
    assert.equal(
      escalated.modelRoute.routeHistory.outcomeStatus,
      "known_provider_result_needs_review",
    );
    assert.equal(escalated.modelRoute.selectedBeforeApproval, true);
    assert.equal(escalated.modelRoute.automaticFallbackAllowed, false);
    assert.equal(escalated.modelRoute.automaticRetryAllowed, false);
    assert.equal(escalated.task.max_retries, 0);

    const unrelated = requestLiveAiWorker(runtime.db, "wf-route-history", {
      ...baseOptions,
      requestKey: "unrelated-capability",
      capabilityKey: "offer_architect.positioning",
    });
    assert.equal(unrelated.modelRoute.tier, "terra");
    assert.equal(unrelated.modelRoute.routeHistory.matched, false);

    const fallbackPayload = {
      ...escalated.task.payload,
      liveSpendRequest: {
        ...escalated.task.payload.liveSpendRequest,
        model: "gpt-5.6-terra",
      },
    };
    const fallback = validateApprovalScope(runtime.db, escalated.approval.id, {
      ...escalated.task,
      payload: fallbackPayload,
    });
    assert.equal(fallback.valid, false);
    assert.match(fallback.reason, /task scope changed/i);

    recordRouteEvidence(runtime.db, escalated.task, {
      runId: "run-route-passed",
      runStatus: "completed",
      qualityStatus: "passed",
      attemptStatus: "completed",
      outcomeStatus: "known",
      at: "2099-01-02T00:00:00.000Z",
    });
    const recovered = requestLiveAiWorker(runtime.db, "wf-route-history", {
      ...baseOptions,
      requestKey: "recovered",
    });
    assert.equal(recovered.modelRoute.tier, "terra");
    assert.equal(recovered.modelRoute.routeHistory.priorRunId, "run-route-passed");
    assert.equal(recovered.modelRoute.routeHistory.decision, "normal");

    insertWorkflow(runtime.db, "wf-demand-validator-sol");
    const demandValidator = requestLiveAiWorker(runtime.db, "wf-demand-validator-sol", {
      worker: "demand_validator",
      requestedBy: "test",
      estimatedCostCents: 100,
      maxOutputTokens: 200,
      capabilityKey: "demand_validator.reasoning_on_supplied_evidence",
    });
    assert.equal(demandValidator.modelRoute.tier, "sol");
    assert.equal(demandValidator.modelRoute.model, "gpt-5.6-sol");
  } finally {
    closeRuntime(runtime);
  }
});
