const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { all, get, openDatabase, run, seedDatabase, toJson } = require("../src/db");
const { ensureAiTeam } = require("../src/runtime/ai-team");
const { ensureAgentTools } = require("../src/runtime/agent-tools");
const {
  CommercialAuthorityError,
  commercialLifecycleApprovalScope,
  commercialLifecycleApprovalScopeHash,
} = require("../src/runtime/commercial-authority");
const {
  COST_CATEGORIES,
  OPERATOR_ROLE,
  PROTECTED_ACTION_KEYS,
  createCommercialTestContract,
  offerDefinitionHash,
  sha256,
} = require("../src/runtime/commercial-test-contract");
const { createCommercialTestStore } = require("../src/runtime/commercial-test-store");
const { runOnce } = require("../src/runtime/orchestrator");
const {
  ensureVentureKitRegistry,
  getVentureKit,
} = require("../src/runtime/venture-kit-registry");
const {
  prepareChiefSpecialistAssignment,
  requestChiefOrchestration,
  updateChiefAssignmentLifecycle,
  updateReviewedChiefAssignment,
} = require("../src/runtime/chief-orchestration");

const AUTHORITY_START = "2026-07-29T00:00:00.000Z";
const REPORTING_PERIOD = Object.freeze({
  startsAt: "2026-08-01T00:00:00.000Z",
  endsAt: "2026-08-31T23:59:59.999Z",
});

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, canonical(value[key])]),
    );
  }
  return value ?? null;
}

function canonicalJson(value) {
  return JSON.stringify(canonical(value));
}

function protectedActions() {
  return Object.fromEntries(PROTECTED_ACTION_KEYS.map((key) => [key, true]));
}

function createAuthorityContract(db, suffix) {
  ensureVentureKitRegistry(db);
  const kit = getVentureKit(db, "digital_product_v1", 1);
  const accountHash = sha256(`chief-authority-account-${suffix}`);
  const offerDefinition = {
    id: `offer.chief_${suffix}`,
    version: "1.0.0",
    sku: `chief_${suffix}_aud_29`,
    description: `Low-touch Chief authority fixture ${suffix}`,
    contentHash: sha256(`chief-authority-content-${suffix}`),
  };
  return createCommercialTestContract({
    programId: `program.chief_${suffix}`,
    programVersion: "1.0.0",
    testId: `test.chief_${suffix}`,
    testVersion: "2.0.0",
    ventureId: "venture-digital-products",
    ventureKit: {
      id: kit.id,
      version: kit.version,
      hash: kit.contentHash,
    },
    offerId: offerDefinition.id,
    offer: {
      ...offerDefinition,
      hash: offerDefinitionHash(offerDefinition),
    },
    buyer: "Independent social media managers with retained clients",
    problem: "Client approvals and scope changes are fragmented",
    experiment: {
      id: `experiment.chief_${suffix}`,
      version: "1.0.0",
      hypothesis: "The exact buyer will pay for the exact low-touch kit",
      primaryMetric: "positive_independent_settled_buyers",
      deadlineAt: "2026-09-02T00:00:00.000Z",
    },
    cohort: {
      id: `cohort.chief_${suffix}`,
      definition: "Buyers exposed only to the approved marketplace listing",
    },
    reportingPeriod: REPORTING_PERIOD,
    channel: {
      id: `marketplace.chief_${suffix}`,
      providerNamespace: `marketplace.chief_${suffix}`,
      accountHash,
      adapter: {
        id: `adapter.chief_${suffix}`,
        version: "2.0.0",
        hash: sha256(`chief-authority-adapter-${suffix}`),
      },
    },
    price: {
      currency: "AUD",
      amountMinorUnits: 2900,
      amountAudCents: 2900,
    },
    buyerIdentity: {
      method: "hmac_sha256",
      keyId: `buyer_key.chief_${suffix}`,
      keyVersion: 1,
      independenceBasis: "platform_buyer_account",
    },
    protectedActions: protectedActions(),
    attributionRules: {
      method: "last_qualified_touch",
      window: REPORTING_PERIOD,
      allowedTouchpoints: ["listing_id"],
      requiredTouchpoints: ["listing_id"],
      unresolvedOutcome: "inconclusive",
    },
    evidenceRules: {
      acceptedSourceKinds: ["imported_platform", "operator_attested_manual"],
      requiredCostCategories: COST_CATEGORIES,
      requiredSources: [{
        id: `platform_settlement.chief_${suffix}`,
        acceptedKinds: ["imported_platform", "operator_attested_manual"],
        providerNamespace: `marketplace.chief_${suffix}`,
        accountHash,
        sourceSystem: `marketplace_settlement.chief_${suffix}`,
        exportType: "settlement_record_v2",
      }],
      sourceHashRequired: true,
      sourceRowHashRequired: true,
      receiptRequired: true,
      manualVerificationRequired: true,
      closedPeriodManifestRequired: true,
      transactionDeduplication: "provider_account_transaction_hash",
      buyerPseudonymization: "contract_bound_hmac_sha256",
      unknownCostsBlockProof: true,
      estimatedCostsBlockProof: true,
      incurredCostsBlockProof: true,
      rejectedEvidenceBlocksProof: true,
      outOfScopeEvidenceBlocksProof: true,
    },
    decisionRules: {
      pass: {
        criteria: ["Three buyers with positive actual AUD contribution"],
        nextAction: "Present a separately approved scale recommendation.",
      },
      revise: {
        criteria: ["Buyer proof exists but actual contribution is not positive"],
        nextAction: "Diagnose the offer and economics.",
      },
      inconclusive: {
        criteria: ["Evidence is incomplete or below proof volume"],
        nextAction: "Collect the smallest decision-critical missing evidence.",
      },
      stop: {
        criteria: ["A terminal stop makes continuation invalid"],
        nextAction: "Keep the test stopped and preserve its evidence.",
      },
    },
    operatorRole: OPERATOR_ROLE,
    externalSpendCapAud: 0,
  });
}

function approveLifecycle(db, contract, eventType, suffix, requestedAt, decidedAt) {
  const scope = commercialLifecycleApprovalScope(contract, eventType);
  const scopeHash = commercialLifecycleApprovalScopeHash(contract, eventType);
  const id = `approval-chief-${suffix}-${eventType}`;
  run(
    db,
    `INSERT INTO approvals
     (id, scope, scope_hash, title, status, risk_level, requested_by,
      requested_at, decided_at, decision_note, payload)
     VALUES (?, ?, ?, ?, 'approved', 'high', 'jarvis', ?, ?, 'Approved for fixture.', ?)`,
    [
      id,
      canonicalJson(scope),
      scopeHash,
      `${eventType} Chief authority fixture`,
      requestedAt,
      decidedAt,
      canonicalJson({ commercialTestApprovalScope: scope }),
    ],
  );
  return { id, scope };
}

function bindingForContract(contract) {
  return {
    contractSchema: contract.schema,
    decisionHash: contract.decisionHash,
    programId: contract.programId,
    programVersion: contract.programVersion,
    testId: contract.testId,
    testVersion: contract.testVersion,
    ventureId: contract.ventureId,
    ventureKitId: contract.ventureKit.id,
    ventureKitVersion: contract.ventureKit.version,
    ventureKitHash: contract.ventureKit.hash,
    offerId: contract.offer.id,
    offerVersion: contract.offer.version,
    offerHash: contract.offer.hash,
    offerSku: contract.offer.sku,
    experimentId: contract.experiment.id,
    experimentVersion: contract.experiment.version,
    cohortId: contract.cohort.id,
  };
}

function installCommercialAuthority(db, suffix) {
  const contract = createAuthorityContract(db, suffix);
  const store = createCommercialTestStore(db, {
    clock: () => AUTHORITY_START,
  });
  store.registerContract(contract);
  store.appendLifecycle(contract.decisionHash, {
    eventId: `lifecycle-chief-${suffix}-proposed`,
    eventType: "proposed",
    reason: "Prepared for exact fixture review.",
    occurredAt: AUTHORITY_START,
  });
  const accepted = approveLifecycle(
    db,
    contract,
    "accepted",
    suffix,
    "2026-07-29T00:00:10.000Z",
    "2026-07-29T00:00:20.000Z",
  );
  store.appendLifecycle(contract.decisionHash, {
    eventId: `lifecycle-chief-${suffix}-accepted`,
    eventType: "accepted",
    approvalId: accepted.id,
    approvalScope: accepted.scope,
    reason: "Owner accepted the exact fixture.",
    occurredAt: "2026-07-29T00:00:30.000Z",
  });
  const activated = approveLifecycle(
    db,
    contract,
    "activated",
    suffix,
    "2026-07-29T00:00:40.000Z",
    "2026-07-29T00:00:50.000Z",
  );
  store.appendLifecycle(contract.decisionHash, {
    eventId: `lifecycle-chief-${suffix}-activated`,
    eventType: "activated",
    approvalId: activated.id,
    approvalScope: activated.scope,
    reason: "Owner activated the exact fixture.",
    occurredAt: "2026-07-29T00:01:00.000Z",
  });
  return bindingForContract(contract);
}

function makeRuntime() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-chief-orchestration-"));
  const db = openDatabase(path.join(root, "runtime.sqlite"));
  seedDatabase(db);
  ensureAiTeam(db);
  ensureAgentTools(db);
  return { root, db };
}

function closeRuntime(runtime) {
  runtime.db.close();
  fs.rmSync(runtime.root, { recursive: true, force: true });
}

function insertChiefSource(db, suffix, policy = {}) {
  const ts = "2026-07-17T00:00:00.000Z";
  const workflowId = `wf-chief-${suffix}`;
  const taskId = `task-chief-${suffix}`;
  const runId = `run-chief-${suffix}`;
  const commercialTestContract = policy.authorityMode === "unbound"
    ? null
    : installCommercialAuthority(db, suffix);
  const taskCommercialTestContract = policy.authorityMode === "mismatched"
    ? {
      ...commercialTestContract,
      offerSku: `${commercialTestContract.offerSku}_conflict`,
    }
    : commercialTestContract;
  run(
    db,
    `INSERT INTO workflows
     (id, venture_id, type, title, status, current_step, priority, metadata, created_at, updated_at)
     VALUES (?, 'venture-digital-products', 'chief_orchestration', 'Chief orchestration',
      'agent_running', '', 1, ?, ?, ?)`,
    [
      workflowId,
      toJson(commercialTestContract ? { commercialTestContract } : {}),
      ts,
      ts,
    ],
  );
  run(
    db,
    `INSERT INTO tasks
     (id, workflow_id, venture_id, title, kind, agent, status, priority, cost_budget_cents,
      payload, result, created_at, updated_at)
     VALUES (?, ?, 'venture-digital-products', 'Choose the next specialist',
      'live_ai_worker_execution', 'chief_of_staff', 'completed', 1, 100, ?, '{}', ?, ?)`,
    [
      taskId,
      workflowId,
      toJson({
        ...(taskCommercialTestContract ? { commercialTestContract: taskCommercialTestContract } : {}),
        subject: "A small digital product",
        chiefOrchestration: {
          enabled: true,
          policy: {
            allowedWorkers: policy.allowedWorkers || ["finance_analyst", "product_builder"],
            allowedModes: policy.allowedModes || ["protected", "supervised_live"],
            maxSpecialistCostCents: policy.maxSpecialistCostCents || 100,
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
     VALUES (?, 'chief_of_staff', ?, ?, 'venture-digital-products',
      'openai-agents-sdk', 'completed', 'Choose next specialist', 'Plan ready',
      1, '{}', ?, ?)`,
    [runId, workflowId, taskId, ts, ts],
  );
  return {
    task: {
      ...get(db, "SELECT * FROM tasks WHERE id = ?", [taskId]),
      payload: JSON.parse(get(db, "SELECT payload FROM tasks WHERE id = ?", [taskId]).payload),
    },
    run: get(db, "SELECT * FROM agent_runs WHERE id = ?", [runId]),
    commercialTestContract,
  };
}

function chiefOutput(values) {
  return {
    summary: "Chief selected one bounded next step.",
    recommendation: values.reason,
    roleOutput: {
      specialistNeeded: true,
      specialistWorker: values.workerId,
      specialistObjective: values.objective,
      specialistExpectedOutput: values.expectedOutput,
      specialistMode: values.mode,
      specialistContextClasses: values.contextClasses,
      specialistReason: values.reason,
    },
  };
}

test("Chief queues and closes exactly one fixed-team protected specialist without operator clutter", async () => {
  const runtime = makeRuntime();
  try {
    const source = insertChiefSource(runtime.db, "protected");
    const result = prepareChiefSpecialistAssignment(runtime.db, {
      ...source,
      output: chiefOutput({
        workerId: "finance_analyst",
        objective: "Check the price, cost, and break-even assumptions.",
        expectedOutput: "A short unit-economics recommendation.",
        mode: "protected",
        contextClasses: ["venture", "finance"],
        reason: "Economics should be checked before product work.",
      }),
    });
    assert.equal(result.status, "queued");
    assert.equal(result.assignment.workerId, "finance_analyst");
    assert.equal(result.assignment.requiredReviewer, "chief_of_staff");
    assert.equal(result.task.agent, "finance_analyst");
    assert.equal(result.task.kind, "workbench_proof");
    assert.equal(result.task.cost_budget_cents, 0);
    assert.equal(result.handoff.status, "specialist_assignment_prepared");
    assert.equal(
      all(runtime.db, "SELECT * FROM approvals WHERE status = 'pending'").length,
      0,
    );
    const workflowMetadata = JSON.parse(get(
      runtime.db,
      "SELECT metadata FROM workflows WHERE id = ?",
      [source.task.workflow_id],
    ).metadata);
    const childPayload = JSON.parse(get(
      runtime.db,
      "SELECT payload FROM tasks WHERE id = ?",
      [result.task.id],
    ).payload);
    assert.deepEqual(
      workflowMetadata.commercialTestContract,
      source.commercialTestContract,
    );
    assert.deepEqual(
      source.task.payload.commercialTestContract,
      source.commercialTestContract,
    );
    assert.deepEqual(
      result.assignment.commercialTestContract,
      source.commercialTestContract,
    );
    assert.deepEqual(
      childPayload.commercialTestContract,
      source.commercialTestContract,
    );
    assert.deepEqual(
      childPayload.chiefAssignment.commercialTestContract,
      source.commercialTestContract,
    );

    const repeated = prepareChiefSpecialistAssignment(runtime.db, {
      ...source,
      output: chiefOutput({
        workerId: "finance_analyst",
        objective: "Check the price, cost, and break-even assumptions.",
        expectedOutput: "A short unit-economics recommendation.",
        mode: "protected",
        contextClasses: ["venture", "finance"],
        reason: "Economics should be checked before product work.",
      }),
    });
    assert.equal(repeated.alreadyPrepared, true);
    assert.equal(repeated.task.id, result.task.id);

    const completed = await runOnce(runtime.db, { taskId: result.task.id });
    const closedHandoff = get(runtime.db, "SELECT * FROM agent_handoffs WHERE id = ?", [result.handoff.id]);
    assert.equal(completed.status, "completed");
    assert.equal(closedHandoff.status, "specialist_work_completed");
    assert.ok(closedHandoff.resolved_at);
  } finally {
    closeRuntime(runtime);
  }
});

test("Chief denies unbound or mismatched parents before any child write", () => {
  const cases = [
    {
      suffix: "unbound-denial",
      authorityMode: "unbound",
      expectedCode: "commercial_binding_required",
    },
    {
      suffix: "mismatch-denial",
      authorityMode: "mismatched",
      expectedCode: "commercial_binding_conflict",
    },
  ];
  for (const item of cases) {
    const runtime = makeRuntime();
    try {
      const source = insertChiefSource(runtime.db, item.suffix, {
        authorityMode: item.authorityMode,
      });
      const before = {
        tasks: get(runtime.db, "SELECT COUNT(*) AS count FROM tasks").count,
        handoffs: get(runtime.db, "SELECT COUNT(*) AS count FROM agent_handoffs").count,
        approvals: get(runtime.db, "SELECT COUNT(*) AS count FROM approvals").count,
        events: get(runtime.db, "SELECT COUNT(*) AS count FROM events").count,
        contextSnapshots: get(
          runtime.db,
          "SELECT COUNT(*) AS count FROM agent_context_snapshots",
        ).count,
        workflow: get(
          runtime.db,
          "SELECT status, current_step, updated_at FROM workflows WHERE id = ?",
          [source.task.workflow_id],
        ),
      };
      assert.throws(
        () => prepareChiefSpecialistAssignment(runtime.db, {
          ...source,
          output: chiefOutput({
            workerId: "finance_analyst",
            objective: "Check the price, cost, and break-even assumptions.",
            expectedOutput: "A short unit-economics recommendation.",
            mode: "protected",
            contextClasses: ["venture", "finance"],
            reason: "Economics should be checked before product work.",
          }),
        }),
        (error) => {
          assert.ok(error instanceof CommercialAuthorityError);
          assert.equal(error.code, item.expectedCode);
          return true;
        },
      );
      const after = {
        tasks: get(runtime.db, "SELECT COUNT(*) AS count FROM tasks").count,
        handoffs: get(runtime.db, "SELECT COUNT(*) AS count FROM agent_handoffs").count,
        approvals: get(runtime.db, "SELECT COUNT(*) AS count FROM approvals").count,
        events: get(runtime.db, "SELECT COUNT(*) AS count FROM events").count,
        contextSnapshots: get(
          runtime.db,
          "SELECT COUNT(*) AS count FROM agent_context_snapshots",
        ).count,
        workflow: get(
          runtime.db,
          "SELECT status, current_step, updated_at FROM workflows WHERE id = ?",
          [source.task.workflow_id],
        ),
      };
      assert.deepEqual(after, before);
      assert.equal(
        get(
          runtime.db,
          "SELECT COUNT(*) AS count FROM tasks WHERE id = ?",
          [`task_chief_assignment_${source.run.id}`],
        ).count,
        0,
      );
    } finally {
      closeRuntime(runtime);
    }
  }
});

test("Chief prepares one paid Product Builder approval and requires Quality Reviewer next", () => {
  const runtime = makeRuntime();
  try {
    const source = insertChiefSource(runtime.db, "live");
    const result = prepareChiefSpecialistAssignment(runtime.db, {
      ...source,
      output: chiefOutput({
        workerId: "product_builder",
        objective: "Prepare the smallest useful local product asset.",
        expectedOutput: "A local product draft and asset plan for review.",
        mode: "supervised_live",
        contextClasses: ["venture", "evidence", "production", "legal"],
        reason: "The accepted offer now needs a bounded product draft.",
      }),
    });
    assert.equal(result.status, "waiting_for_approval");
    assert.equal(result.assignment.requiredReviewer, "quality_reviewer");
    assert.equal(result.task.agent, "product_builder");
    assert.equal(result.task.status, "blocked");
    assert.equal(result.approval.status, "pending");
    assert.deepEqual(result.task.payload.contextSnapshot.recordClasses, ["venture", "evidence", "production", "legal"]);
    assert.equal(result.task.payload.liveSpendRequest.parameters.requiredReviewer, "quality_reviewer");
    assert.equal(all(runtime.db, "SELECT * FROM model_calls").length, 0);
    assert.equal(all(runtime.db, "SELECT * FROM agent_context_snapshots").length, 1);
  } finally {
    closeRuntime(runtime);
  }
});

test("Chief orchestration itself is a separate capped approval, not an automatic provider call", () => {
  const runtime = makeRuntime();
  try {
    const ts = "2026-07-17T00:00:00.000Z";
    const commercialTestContract = installCommercialAuthority(
      runtime.db,
      "chief-request",
    );
    run(
      runtime.db,
      `INSERT INTO workflows
       (id, venture_id, type, title, status, current_step, priority, metadata, created_at, updated_at)
       VALUES ('wf-chief-request', 'venture-digital-products', 'chief_orchestration',
        'Chief request', 'planned', '', 1, ?, ?, ?)`,
      [
        toJson({ commercialTestContract }),
        ts,
        ts,
      ],
    );
    const result = requestChiefOrchestration(runtime.db, "wf-chief-request", {
      estimatedCostCents: 100,
      maxSpecialistCostCents: 100,
    });
    assert.equal(result.task.agent, "chief_of_staff");
    assert.deepEqual(
      result.task.payload.commercialTestContract,
      commercialTestContract,
    );
    assert.equal(result.task.payload.chiefOrchestration.enabled, true);
    assert.equal(result.task.status, "blocked");
    assert.equal(result.approval.status, "pending");
    assert.equal(all(runtime.db, "SELECT * FROM model_calls").length, 0);
  } finally {
    closeRuntime(runtime);
  }
});

test("Chief assignment remains open for quality review and closes on the immutable verdict", () => {
  const runtime = makeRuntime();
  try {
    const source = insertChiefSource(runtime.db, "quality-lifecycle");
    const prepared = prepareChiefSpecialistAssignment(runtime.db, {
      ...source,
      output: chiefOutput({
        workerId: "product_builder",
        objective: "Prepare one exact product visual.",
        expectedOutput: "One local product visual ready for quality review.",
        mode: "supervised_live",
        contextClasses: ["venture", "evidence", "production", "legal"],
        reason: "The selected product needs one bounded visual.",
      }),
    });
    const pending = updateChiefAssignmentLifecycle(runtime.db, prepared.task, {
      status: "specialist_quality_review_pending",
      note: "Exact output is waiting for review.",
      childTaskStatus: "completed",
      resolved: false,
    });
    assert.equal(pending.status, "specialist_quality_review_pending");
    assert.equal(pending.resolved_at, null);

    const reviewTask = {
      payload: {
        liveSpendRequest: {
          parameters: { reviewOfTaskId: prepared.task.id },
        },
      },
    };
    const closed = updateReviewedChiefAssignment(runtime.db, reviewTask, { status: "passed" });
    assert.equal(closed.status, "specialist_work_completed");
    assert.ok(closed.resolved_at);
  } finally {
    closeRuntime(runtime);
  }
});
