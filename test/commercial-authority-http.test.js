const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  get,
  openDatabase,
  seedDatabase,
  toJson,
} = require("../src/db");
const { persistApprovalScope } = require("../src/runtime/approval-scope");
const {
  AI_TEAM_DEFINITIONS,
  createAgentRun,
  finishAgentRun,
} = require("../src/runtime/ai-team");
const {
  COST_CATEGORIES,
  OPERATOR_ROLE,
  PROTECTED_ACTION_KEYS,
  createCommercialTestContract,
  offerDefinitionHash,
  sha256,
} = require("../src/runtime/commercial-test-contract");
const {
  classifyCommercialTaskSafety,
  commercialLifecycleApprovalScopeHash,
  createCommercialLifecycleEvent,
} = require("../src/runtime/commercial-authority");
const {
  DIGITAL_PRODUCT_V1,
} = require("../src/runtime/venture-kit-registry");
const {
  ventureKitContentHash,
} = require("../src/runtime/venture-kit-definition");
const { runOnce } = require("../src/runtime/orchestrator");
const {
  createLiveAiWorkerSmokeTest,
  requestLiveAiWorker,
} = require("../src/runtime/live-ai-workers");
const {
  createLiveResearchSmokeTest,
  requestLiveResearch,
} = require("../src/runtime/live-research");
const { createApp } = require("../src/server");

function protectedActions() {
  return Object.fromEntries(PROTECTED_ACTION_KEYS.map((key) => [key, true]));
}

function contractFixture(suffix = "http") {
  const accountHash = sha256(`marketplace-account-${suffix}`);
  const offerDefinition = {
    id: `offer.${suffix}`,
    version: "1.0.0",
    sku: `scope_guard_${suffix}_aud_29`,
    description: `Low-touch client approval scope guard kit ${suffix}`,
    contentHash: sha256(`offer-content-${suffix}`),
  };
  const contract = createCommercialTestContract({
    programId: `program-${suffix}`,
    programVersion: "1.0.0",
    testId: `test-${suffix}`,
    testVersion: "2.0.0",
    ventureId: "venture-digital-products",
    ventureKit: {
      id: "digital_product_v1",
      version: 1,
      hash: ventureKitContentHash(DIGITAL_PRODUCT_V1),
    },
    offerId: offerDefinition.id,
    offer: {
      ...offerDefinition,
      hash: offerDefinitionHash(offerDefinition),
    },
    buyer: "Independent social media managers with retained clients",
    problem: "Client approvals and scope changes are fragmented and hard to evidence",
    experiment: {
      id: `experiment.${suffix}`,
      version: "1.0.0",
      hypothesis: "The exact buyer will pay A$29 for the defined low-touch kit",
      primaryMetric: "positive_independent_settled_buyers",
      deadlineAt: "2026-09-02T00:00:00.000Z",
    },
    cohort: {
      id: `cohort.${suffix}`,
      definition: "Buyers exposed only to the approved marketplace listing",
    },
    reportingPeriod: {
      startsAt: "2026-08-01T00:00:00.000Z",
      endsAt: "2026-08-31T23:59:59.999Z",
    },
    channel: {
      id: `marketplace.${suffix}`,
      providerNamespace: `marketplace.${suffix}`,
      accountHash,
      adapter: {
        id: `adapter.${suffix}`,
        version: "2.0.0",
        hash: sha256(`adapter-${suffix}`),
      },
    },
    price: {
      currency: "AUD",
      amountMinorUnits: 2900,
      amountAudCents: 2900,
    },
    buyerIdentity: {
      method: "hmac_sha256",
      keyId: `buyer_key.${suffix}`,
      keyVersion: 1,
      independenceBasis: "platform_buyer_account",
    },
    protectedActions: protectedActions(),
    attributionRules: {
      method: "last_qualified_touch",
      window: {
        startsAt: "2026-08-01T00:00:00.000Z",
        endsAt: "2026-08-31T23:59:59.999Z",
      },
      allowedTouchpoints: ["campaign_id", "listing_id"],
      requiredTouchpoints: ["listing_id"],
      unresolvedOutcome: "inconclusive",
    },
    evidenceRules: {
      acceptedSourceKinds: ["imported_platform", "operator_attested_manual"],
      requiredCostCategories: COST_CATEGORIES,
      requiredSources: [{
        id: `platform_settlement.${suffix}`,
        acceptedKinds: ["imported_platform", "operator_attested_manual"],
        providerNamespace: `marketplace.${suffix}`,
        accountHash,
        sourceSystem: `marketplace_settlement.${suffix}`,
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
        criteria: ["Three buyers, positive actual AUD contribution, complete evidence"],
        nextAction: "Present a separately approved scale recommendation.",
      },
      revise: {
        criteria: ["Buyer proof exists but actual contribution is not positive"],
        nextAction: "Diagnose offer, channel, price, refunds, and costs.",
      },
      inconclusive: {
        criteria: ["Evidence is incomplete, contradictory, or below proof volume"],
        nextAction: "Collect only the smallest decision-critical missing evidence.",
      },
      stop: {
        criteria: ["A terminal stop makes continuation invalid"],
        nextAction: "Keep the test stopped and preserve its immutable evidence.",
      },
    },
    operatorRole: OPERATOR_ROLE,
    externalSpendCapAud: 0,
  });
  return {
    contract,
    binding: {
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
    },
  };
}

function insertContract(db, fixture) {
  const { contract } = fixture;
  db.prepare(`
    INSERT INTO commercial_test_contracts
    (decision_hash, contract_schema, program_id, program_version, test_id,
     test_version, venture_id, venture_kit_id, venture_kit_version,
     venture_kit_hash, offer_id, offer_version, offer_hash, offer_sku,
     experiment_id, experiment_version, cohort_id, channel_id,
     provider_namespace, account_hash, adapter_id, adapter_version, adapter_hash,
     reporting_starts_at, reporting_ends_at, buyer_key_id, buyer_key_version,
     buyer_independence_basis, price_aud_cents, operator_role,
     external_spend_cap_cents, contract_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
            ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
  `).run(
    contract.decisionHash,
    contract.schema,
    contract.programId,
    contract.programVersion,
    contract.testId,
    contract.testVersion,
    contract.ventureId,
    contract.ventureKit.id,
    contract.ventureKit.version,
    contract.ventureKit.hash,
    contract.offer.id,
    contract.offer.version,
    contract.offer.hash,
    contract.offer.sku,
    contract.experiment.id,
    contract.experiment.version,
    contract.cohort.id,
    contract.channel.id,
    contract.channel.providerNamespace,
    contract.channel.accountHash,
    contract.channel.adapter.id,
    contract.channel.adapter.version,
    contract.channel.adapter.hash,
    contract.reportingPeriod.startsAt,
    contract.reportingPeriod.endsAt,
    contract.buyerIdentity.keyId,
    contract.buyerIdentity.keyVersion,
    contract.buyerIdentity.independenceBasis,
    contract.price.amountAudCents,
    contract.operatorRole,
    JSON.stringify(contract),
    "2026-07-29T00:00:00.000Z",
  );
}

function insertLifecycle(db, fixture, eventType, occurredAt) {
  const previous = db.prepare(`
    SELECT sequence, event_hash
    FROM commercial_test_lifecycle_events
    WHERE decision_hash = ?
    ORDER BY sequence DESC
    LIMIT 1
  `).get(fixture.contract.decisionHash);
  const sequence = previous ? previous.sequence + 1 : 0;
  const approvalRequired = ["accepted", "activated"].includes(eventType);
  const approvalId = approvalRequired
    ? `approval-http-${fixture.contract.testId}-${eventType}`
    : null;
  const approvalScopeHash = approvalRequired
    ? commercialLifecycleApprovalScopeHash(fixture.contract, eventType)
    : null;
  if (approvalRequired) {
    db.prepare(`
      INSERT INTO approvals
      (id, workflow_id, scope, title, status, risk_level, requested_by,
       requested_at, decided_at, decision_note, payload, scope_hash)
      VALUES (?, NULL, ?, ?, 'approved', 'high', 'operator', ?, ?, ?, ?, ?)
    `).run(
      approvalId,
      `commercial_test_${eventType}`,
      `Approve exact commercial test ${eventType}`,
      occurredAt,
      occurredAt,
      "Fixture approval for the exact canonical commercial scope.",
      JSON.stringify({
        commercialLifecycle: {
          decisionHash: fixture.contract.decisionHash,
          eventType,
          scopeHash: approvalScopeHash,
        },
      }),
      approvalScopeHash,
    );
  }
  const event = createCommercialLifecycleEvent({
    id: `http-lifecycle-${fixture.contract.testId}-${sequence}`,
    decisionHash: fixture.contract.decisionHash,
    sequence,
    previousEventHash: previous?.event_hash || null,
    eventType,
    approvalId,
    approvalScopeHash,
    reason: "",
    metadata: {},
    occurredAt,
  });
  db.prepare(`
    INSERT INTO commercial_test_lifecycle_events
    (id, decision_hash, sequence, previous_event_hash, event_type, event_hash,
     approval_id, approval_scope_hash, event_json, occurred_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    event.id,
    event.decisionHash,
    event.sequence,
    event.previousEventHash,
    event.eventType,
    event.eventHash,
    event.approvalId,
    event.approvalScopeHash,
    JSON.stringify(event),
    event.occurredAt,
    occurredAt,
  );
}

function insertCommercialWorkflow(db, fixture, options = {}) {
  const id = options.id || "workflow-commercial-http";
  const timestamp = "2026-07-29T00:00:00.000Z";
  const metadata = options.metadata || {
    agentRunner: {
      mode: "plan_only",
      liveModels: false,
      liveTools: false,
    },
    commercialTestContract: fixture.binding,
  };
  db.prepare(`
    INSERT INTO workflows
    (id, venture_id, type, title, status, current_step, priority,
     quality_score, expected_profit_cents, cost_estimate_cents,
     approval_required, metadata, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'planned', '', 2, 0, 0, 0, 0, ?, ?, ?)
  `).run(
    id,
    fixture?.contract.ventureId || "venture-digital-products",
    options.type || "commercial_test",
    options.title || "Contract-bound HTTP proof",
    toJson(metadata),
    timestamp,
    timestamp,
  );
  return id;
}

function createHttpHandoff(db, options = {}) {
  const suffix = options.suffix || "handoff";
  const fixture = options.fixture || null;
  const workflowId = insertCommercialWorkflow(db, fixture, {
    id: `workflow-http-handoff-${suffix}`,
    type: options.type || "commercial_test",
    title: options.title || "Commercial buyer-test handoff",
    metadata: options.workflowMetadata || (
      fixture
        ? {
          agentRunner: {
            mode: "plan_only",
            liveModels: false,
            liveTools: false,
          },
          commercialTestContract: fixture.binding,
        }
        : {
          agentRunner: {
            mode: "plan_only",
            liveModels: false,
            liveTools: false,
          },
        }
    ),
  });
  const taskId = `task-http-handoff-${suffix}`;
  const timestamp = "2026-07-29T00:10:00.000Z";
  const commercialPayload = {
    subject: "Low-touch client-control kit",
    buyer: "Independent social media managers",
    problem: "Client approvals and scope changes are fragmented",
    offer: "A low-touch operational control kit",
    channel: "One approved marketplace test",
    ...(fixture ? { commercialTestContract: fixture.binding } : {}),
  };
  const payload = {
    ...(options.commercial === false
      ? {
        subject: "Runtime database health",
        check: "Verify the local diagnostic result",
      }
      : commercialPayload),
    ...(options.payload || {}),
  };
  db.prepare(`
    INSERT INTO tasks
    (id, workflow_id, venture_id, title, kind, agent, status, priority,
     cost_budget_cents, payload, result, created_at, updated_at)
    VALUES (?, ?, 'venture-digital-products', ?, ?, 'demand_validator',
      'completed', 1, 0, ?, '{}', ?, ?)
  `).run(
    taskId,
    workflowId,
    options.taskTitle || (
      options.commercial === false
        ? "Review runtime diagnostic"
        : "Review exact buyer demand"
    ),
    options.taskKind || (
      options.commercial === false
        ? "runtime_integrity_check"
        : "market_research"
    ),
    toJson(payload),
    timestamp,
    timestamp,
  );
  const definition = AI_TEAM_DEFINITIONS.find(
    (item) => item.id === "demand_validator",
  );
  const task = get(db, "SELECT * FROM tasks WHERE id = ?", [taskId]);
  const runRecord = createAgentRun(db, definition, task, {
    mode: "dry-run",
    inputSummary: options.commercial === false
      ? "Review the local runtime diagnostic."
      : "Review the exact buyer test.",
    approvalRequired: true,
  });
  finishAgentRun(db, runRecord.id, {
    status: "completed",
    outputSummary: options.commercial === false
      ? "The local runtime diagnostic is ready for internal follow-up."
      : "One bounded commercial next step is ready for operator review.",
    approvalRequired: true,
    handoffTo: "chief_of_staff",
    evalStatus: "passed",
    metadata: options.commercial === false
      ? {
        diagnostic: {
          systemProof: true,
          externalEffectsAllowed: false,
        },
      }
      : {
        businessDecision: {
          buyer: "Independent social media managers",
          problem: "Client approvals and scope changes are fragmented",
          offer: "A low-touch operational control kit",
          channel: "One approved marketplace test",
          nextAction: "Prepare the next protected internal step.",
        },
      },
  });
  const handoff = get(
    db,
    "SELECT * FROM agent_handoffs WHERE from_run_id = ?",
    [runRecord.id],
  );
  assert.ok(handoff);
  return {
    fixture,
    handoff,
    taskId,
    workflowId,
  };
}

function handoffWriteSnapshot(db, source) {
  return {
    totalChanges: Number(get(db, "SELECT total_changes() AS count").count),
    tasks: Number(get(db, "SELECT COUNT(*) AS count FROM tasks").count),
    handoffs: Number(get(db, "SELECT COUNT(*) AS count FROM agent_handoffs").count),
    messages: Number(get(db, "SELECT COUNT(*) AS count FROM messages").count),
    events: Number(get(db, "SELECT COUNT(*) AS count FROM events").count),
    traces: Number(get(db, "SELECT COUNT(*) AS count FROM agent_trace_events").count),
    handoff: get(
      db,
      `SELECT status, metadata, updated_at, resolved_at
       FROM agent_handoffs WHERE id = ?`,
      [source.handoff.id],
    ),
    workflow: get(
      db,
      "SELECT status, current_step, updated_at FROM workflows WHERE id = ?",
      [source.workflowId],
    ),
  };
}

async function startTestApp(name, options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `pantheon-authority-http-${name}-`));
  const dbPath = path.join(dir, "runtime.sqlite");
  const db = openDatabase(dbPath);
  seedDatabase(db, { includeDemoProof: options.includeDemoProof === true });
  const app = createApp({
    db,
    dbPath,
    schedulerEnabled: false,
    security: options.security === true,
    sessionSecret: options.sessionSecret,
    bootstrapSecret: options.bootstrapSecret,
  });
  await new Promise((resolve, reject) => {
    app.server.once("error", reject);
    app.server.listen(0, "127.0.0.1", resolve);
  });
  return {
    ...app,
    dbPath,
    dir,
    origin: `http://127.0.0.1:${app.server.address().port}`,
  };
}

async function stopTestApp(app) {
  for (const client of app.wss.clients) client.terminate();
  await new Promise((resolve) => app.server.close(resolve));
  app.wss.close();
  app.db.close();
  fs.rmSync(app.dir, { recursive: true, force: true });
}

async function postJson(origin, pathname, body = {}) {
  const response = await fetch(`${origin}${pathname}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { response, payload: await response.json() };
}

test("commercial authority status is read-only and requires the signed operator session", async () => {
  const bootstrapSecret = "commercial-authority-http-bootstrap";
  const app = await startTestApp("signed-status", {
    security: true,
    sessionSecret: Buffer.alloc(32, 29),
    bootstrapSecret,
  });
  try {
    const unauthenticated = await fetch(`${app.origin}/api/commercial/authority`);
    assert.equal(unauthenticated.status, 401);

    const sessionResponse = await fetch(`${app.origin}/api/session`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: app.origin,
        "x-pantheon-bootstrap": bootstrapSecret,
      },
      body: "{}",
    });
    const cookie = sessionResponse.headers.get("set-cookie").split(";", 1)[0];
    assert.equal(sessionResponse.status, 201);

    const statusResponse = await fetch(`${app.origin}/api/commercial/authority`, {
      headers: { cookie },
    });
    const status = await statusResponse.json();
    assert.equal(statusResponse.status, 200);
    assert.equal(status.schema, "pantheon.commercial-authority-status.v1");
    assert.equal(status.readOnly, true);
    assert.equal(status.access.mode, "signed_operator_session");
    assert.equal(status.access.authenticated, true);
    assert.equal(status.authority.status, "inactive");
  } finally {
    await stopTestApp(app);
  }
});

test("HTTP commercial policy retires legacy entry points and keeps safe status and monitor paths usable", async () => {
  const app = await startTestApp("route-policy");
  try {
    for (const pathname of [
      "/api/commands",
      "/api/pantheon/discovery",
      "/api/runtime/run-until-blocked",
    ]) {
      const { response, payload } = await postJson(app.origin, pathname);
      assert.equal(response.status, 410, pathname);
      assert.equal(payload.code, "commercial_route_retired", pathname);
      assert.equal(payload.commercialAuthority.retiredRoute, true, pathname);
    }

    const health = await fetch(`${app.origin}/api/health`);
    assert.equal(health.status, 200);

    const monitor = await postJson(app.origin, "/api/monitor/run");
    assert.equal(monitor.response.status, 200);
    assert.ok(["healthy", "attention", "critical"].includes(monitor.payload.result.status));

    const schedulerResponse = await fetch(`${app.origin}/api/scheduler`);
    const scheduler = await schedulerResponse.json();
    assert.equal(schedulerResponse.status, 200);
    assert.equal(
      scheduler.jobs.find((job) => job.id === "job-monitor-cycle").status,
      "enabled",
    );
    assert.equal(
      scheduler.jobs.find((job) => job.id === "job-pantheon-supervisor").status,
      "disabled",
    );
    const unscopedSupervisor = await postJson(
      app.origin,
      "/api/scheduler/jobs/job-pantheon-supervisor/enable",
    );
    assert.equal(unscopedSupervisor.response.status, 409);
    assert.equal(unscopedSupervisor.payload.code, "commercial_binding_required");

    const idle = await postJson(app.origin, "/api/pantheon/run");
    assert.equal(idle.response.status, 200);
    assert.equal(idle.payload.result.status, "idle");
    assert.equal(idle.payload.result.reason, "exact_commercial_workflow_not_selected");
  } finally {
    await stopTestApp(app);
  }
});

test("inactive commercial work is blocked, terminal legacy work is gone, and one exact active binding passes", async () => {
  const app = await startTestApp("binding-policy");
  try {
    const fixture = contractFixture("binding-policy");
    insertContract(app.db, fixture);
    const workflowId = insertCommercialWorkflow(app.db, fixture);

    const inactive = await postJson(
      app.origin,
      `/api/workflows/${encodeURIComponent(workflowId)}/run`,
    );
    assert.equal(inactive.response.status, 409);
    assert.equal(inactive.payload.code, "commercial_program_inactive");
    assert.equal(inactive.payload.commercialAuthority.authorityStatus, "inactive");

    insertLifecycle(app.db, fixture, "proposed", "2026-07-29T00:00:00.500Z");
    insertLifecycle(app.db, fixture, "accepted", "2026-07-29T00:00:01.000Z");
    insertLifecycle(app.db, fixture, "activated", "2026-07-29T00:00:02.000Z");
    const active = await postJson(
      app.origin,
      `/api/workflows/${encodeURIComponent(workflowId)}/run`,
    );
    assert.equal(active.response.status, 200);
    assert.equal(active.payload.result.status, "idle");
    const ownerTests = await fetch(`${app.origin}/api/tests`).then(
      (response) => response.json(),
    );
    assert.equal(ownerTests.schema, "pantheon.owner-tests-results.v1");
    assert.equal(ownerTests.current.lifecycle.status, "activated");
    assert.equal(ownerTests.current.proof.buyers.verifiedPositive, 0);
    assert.equal(
      ownerTests.current.proof.netCashContribution.status,
      "not_settled",
    );
    assert.equal(
      ownerTests.current.proof.netCashContribution.amountCents,
      null,
    );
    const ownerPayload = JSON.stringify(ownerTests);
    assert.doesNotMatch(ownerPayload, /decisionHash|accountHash|buyer_[a-f0-9]{64}/);

    const terminalWorkflowId = insertCommercialWorkflow(app.db, fixture, {
      id: "workflow-terminal-buyer-intent-http",
      metadata: {
        agentRunner: {
          mode: "plan_only",
          liveModels: false,
          liveTools: false,
        },
        buyerIntentValidation: {
          schema: "pantheon.buyer-intent-validation.v1",
          specId: "social_media_manager_client_control_v1",
          externalActionsAllowed: false,
        },
      },
    });
    const terminal = await postJson(
      app.origin,
      `/api/workflows/${encodeURIComponent(terminalWorkflowId)}/run`,
    );
    assert.equal(terminal.response.status, 410);
    assert.equal(terminal.payload.code, "commercial_program_terminal");
    assert.match(terminal.payload.error, /permanently stopped historical validation/i);
  } finally {
    await stopTestApp(app);
  }
});

test("commercial creation does not gain authority from an active venture or client readiness flags", async () => {
  const app = await startTestApp("no-shortcuts");
  try {
    const experiment = await postJson(app.origin, "/api/commercial/experiments", {
      ventureId: "venture-digital-products",
      name: "Unbound experiment",
    });
    assert.equal(experiment.response.status, 410);
    assert.equal(experiment.payload.code, "commercial_route_retired");

    const trial = await postJson(app.origin, "/api/commercial/service-trials/trial-one/approve", {
      protectedSetupComplete: true,
      delegatedVendorCapability: true,
      actualCostCents: 0,
    });
    assert.equal(trial.response.status, 409);
    assert.equal(trial.payload.code, "commercial_binding_required");
  } finally {
    await stopTestApp(app);
  }
});

test("every legacy commercial write route is permanently retired and writes nothing even with exact active authority", async () => {
  const app = await startTestApp("retired-writes");
  try {
    const fixture = contractFixture("retired-writes");
    insertContract(app.db, fixture);
    insertLifecycle(app.db, fixture, "proposed", "2026-07-29T00:00:00.500Z");
    insertLifecycle(app.db, fixture, "accepted", "2026-07-29T00:00:01.000Z");
    insertLifecycle(app.db, fixture, "activated", "2026-07-29T00:00:02.000Z");
    const tables = [
      "commercial_experiments",
      "commercial_briefs",
      "commercial_test_candidates",
      "commercial_execution_packs",
      "commercial_results",
      "commercial_feedback",
      "commercial_learning_cycles",
      "platform_sales",
      "revenue",
      "costs",
    ];
    const counts = () => Object.fromEntries(tables.map((table) => [
      table,
      Number(app.db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count),
    ]));
    const before = counts();
    const retired = [
      ["/api/commercial/experiments", { decisionHash: fixture.contract.decisionHash }],
      ["/api/research-to-experiment/plans", { decisionHash: fixture.contract.decisionHash }],
      ["/api/research-to-experiment/candidates/legacy/promote", {}],
      ["/api/commercial/learning/legacy/revision-plan", {}],
      ["/api/execution-packs", { decisionHash: fixture.contract.decisionHash }],
      ["/api/execution-packs/legacy/outcomes", {}],
      ["/api/commercial/results", { decisionHash: fixture.contract.decisionHash }],
      ["/api/commercial/feedback", { decisionHash: fixture.contract.decisionHash }],
      ["/api/gumroad/import", {}],
      ["/api/commercial/investment-cases/legacy/prepare-buyer-intent-test", {}],
    ];
    for (const [route, body] of retired) {
      const response = await postJson(app.origin, route, body);
      assert.equal(response.response.status, 410, route);
      assert.equal(response.payload.code, "commercial_route_retired", route);
      assert.equal(response.payload.commercialAuthority.retiredRoute, true, route);
    }
    const legacySales = await fetch(`${app.origin}/api/gumroad/sales?venture_id=venture-digital-products`);
    assert.equal(legacySales.status, 410);
    assert.equal((await legacySales.json()).code, "commercial_route_retired");
    assert.deepEqual(counts(), before);
  } finally {
    await stopTestApp(app);
  }
});

test("caller-defined live smoke routes are retired and cannot create workflows, tasks, approvals, costs, or events", async () => {
  const app = await startTestApp("retired-live-smoke");
  try {
    const tables = ["workflows", "tasks", "approvals", "costs", "events"];
    const counts = () => Object.fromEntries(tables.map((table) => [
      table,
      Number(app.db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count),
    ]));
    const before = counts();
    const hostileBody = {
      text: "Email prospects, launch marketplace ads, create a listing, and collect checkout payments.",
      subject: "Customer outreach launch",
      tools: ["customer_email_sender", "marketplace_listing_publish"],
      effects: ["checkout_payment_capture"],
      estimatedCostCents: 5000,
    };

    for (const prepareSmoke of [
      createLiveResearchSmokeTest,
      createLiveAiWorkerSmokeTest,
    ]) {
      assert.throws(
        () => prepareSmoke(app.db, hostileBody),
        (error) => (
          error.code === "commercial_route_retired"
          && error.statusCode === 410
        ),
      );
      assert.deepEqual(counts(), before);
    }

    for (const pathname of [
      "/api/live-research/smoke-test",
      "/api/live-ai-workers/smoke-test",
    ]) {
      const result = await postJson(app.origin, pathname, hostileBody);
      assert.equal(result.response.status, 410, pathname);
      assert.equal(result.payload.code, "commercial_route_retired", pathname);
      assert.equal(result.payload.commercialAuthority.retiredRoute, true, pathname);
      assert.deepEqual(counts(), before, pathname);
    }
  } finally {
    await stopTestApp(app);
  }
});

test("live request writers reject unbound, injected, and terminal commercial work before any database write", async () => {
  const app = await startTestApp("live-prewrite-guard");
  try {
    const unboundWorkflowId = insertCommercialWorkflow(app.db, null, {
      id: "workflow-unbound-live-request",
      type: "marketplace_outreach",
      title: "Email prospects and launch a marketplace checkout",
      metadata: {
        subject: "Buyer outreach launch",
        channel: "Marketplace",
      },
    });
    const diagnosticWorkflowId = insertCommercialWorkflow(app.db, null, {
      id: "workflow-runtime-diagnostic-request",
      type: "runtime_assurance",
      title: "Runtime database integrity diagnostic",
      metadata: {
        systemProof: true,
        diagnosticOnly: true,
        agentRunner: {
          mode: "protected",
          liveModels: false,
          liveTools: false,
        },
      },
    });
    const tables = [
      "workflows",
      "commands",
      "tasks",
      "approvals",
      "costs",
      "events",
      "agent_definitions",
      "agent_context_snapshots",
    ];
    const counts = () => Object.fromEntries(tables.map((table) => [
      table,
      Number(app.db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count),
    ]));
    const beforeUnbound = counts();

    for (const request of [
      () => requestLiveResearch(app.db, unboundWorkflowId, {
        estimatedCostCents: 5000,
      }),
      () => requestLiveAiWorker(app.db, unboundWorkflowId, {
        estimatedCostCents: 5000,
        worker: "demand_validator",
      }),
    ]) {
      assert.throws(
        request,
        (error) => (
          error.statusCode === 409
          && error.code === "commercial_binding_required"
        ),
      );
      assert.deepEqual(counts(), beforeUnbound);
    }

    for (const request of [
      () => requestLiveResearch(app.db, diagnosticWorkflowId, {
        estimatedCostCents: 5000,
        text: "Email prospective buyers and publish marketplace listings.",
      }),
      () => requestLiveAiWorker(app.db, diagnosticWorkflowId, {
        estimatedCostCents: 5000,
        worker: "chief_of_staff",
        businessContext: {
          buyer: "Prospective marketplace buyers",
          offer: "A paid digital product",
        },
      }),
    ]) {
      assert.throws(
        request,
        (error) => (
          error.statusCode === 409
          && error.code === "commercial_binding_required"
        ),
      );
      assert.deepEqual(counts(), beforeUnbound);
    }
    for (const [pathname, body] of [
      [
        `/api/workflows/${encodeURIComponent(diagnosticWorkflowId)}/request-live-research`,
        {
          estimatedCostCents: 5000,
          text: "Email prospective buyers and publish marketplace listings.",
        },
      ],
      [
        `/api/workflows/${encodeURIComponent(diagnosticWorkflowId)}/request-live-ai-worker`,
        {
          estimatedCostCents: 5000,
          worker: "chief_of_staff",
          effects: [{ type: "checkout_payment_capture" }],
        },
      ],
    ]) {
      const result = await postJson(app.origin, pathname, body);
      assert.equal(result.response.status, 409, pathname);
      assert.equal(result.payload.code, "commercial_binding_required", pathname);
      assert.equal(result.payload.commercialAuthority.allowed, false, pathname);
      assert.deepEqual(counts(), beforeUnbound, pathname);
    }

    const terminalFixture = contractFixture("live-prewrite-terminal");
    insertContract(app.db, terminalFixture);
    insertLifecycle(app.db, terminalFixture, "proposed", "2026-07-29T00:00:03.000Z");
    insertLifecycle(app.db, terminalFixture, "accepted", "2026-07-29T00:00:04.000Z");
    insertLifecycle(app.db, terminalFixture, "activated", "2026-07-29T00:00:05.000Z");
    insertLifecycle(app.db, terminalFixture, "stopped", "2026-07-29T00:00:06.000Z");
    const terminalWorkflowId = insertCommercialWorkflow(app.db, terminalFixture, {
      id: "workflow-terminal-live-request",
    });
    const beforeTerminal = counts();
    for (const request of [
      () => requestLiveResearch(app.db, terminalWorkflowId, {
        estimatedCostCents: 5000,
      }),
      () => requestLiveAiWorker(app.db, terminalWorkflowId, {
        estimatedCostCents: 5000,
        worker: "demand_validator",
      }),
    ]) {
      assert.throws(
        request,
        (error) => (
          error.statusCode === 410
          && error.code === "commercial_program_terminal"
        ),
      );
      assert.deepEqual(counts(), beforeTerminal);
    }
  } finally {
    await stopTestApp(app);
  }
});

test("authorized live requests copy the exact active contract into every created task", async () => {
  const app = await startTestApp("live-binding-propagation");
  try {
    const fixture = contractFixture("live-binding-propagation");
    insertContract(app.db, fixture);
    insertLifecycle(app.db, fixture, "proposed", "2026-07-29T00:00:00.500Z");
    insertLifecycle(app.db, fixture, "accepted", "2026-07-29T00:00:01.000Z");
    insertLifecycle(app.db, fixture, "activated", "2026-07-29T00:00:02.000Z");
    const workflowId = insertCommercialWorkflow(app.db, fixture, {
      id: "workflow-authorized-live-request",
    });
    const workbenchWorkflowId = insertCommercialWorkflow(app.db, fixture, {
      id: "workflow-authorized-workbench-comparison",
      type: "agent_workbench_team_proof",
      title: "Exact contract-bound Workbench comparison",
      metadata: {
        commercialTestContract: fixture.binding,
        agentRunner: {
          mode: "protected",
          liveModels: false,
          liveTools: false,
        },
        teamProofSummary: {
          schema: "jarvis.agent-team-drill-summary.v1",
          teamName: "Exact contract-bound team",
          chiefRunId: "run-chief-protected",
          operatorSummary: "The protected worker proof passed its local contract.",
          evidence: ["Protected proof completed with no external action or spend."],
          workerProofs: [{
            runId: "run-demand-validator-protected",
            workerId: "demand_validator",
            workerName: "Demand Validator",
            evalStatus: "passed",
            evalScore: 100,
            costActualCents: 0,
            moneyMove: "Review the exact capped comparison.",
            nextAction: "Keep the provider call blocked for owner approval.",
          }],
        },
      },
    });
    const guardedTables = [
      "tasks",
      "approvals",
      "costs",
      "events",
      "agent_definitions",
      "agent_context_snapshots",
    ];
    const guardedCounts = () => Object.fromEntries(guardedTables.map((table) => [
      table,
      Number(app.db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count),
    ]));
    const beforeConflictingRequest = guardedCounts();
    assert.throws(
      () => requestLiveAiWorker(app.db, workflowId, {
        estimatedCostCents: 5000,
        worker: "demand_validator",
        parameters: {
          commercialTestContract: {
            ...fixture.binding,
            offerSku: `${fixture.binding.offerSku}.forged`,
          },
        },
      }),
      (error) => (
        error.statusCode === 409
        && error.code === "commercial_binding_conflict"
      ),
    );
    assert.deepEqual(guardedCounts(), beforeConflictingRequest);

    const researchResponse = await postJson(
      app.origin,
      `/api/workflows/${encodeURIComponent(workflowId)}/request-live-research`,
      {
        estimatedCostCents: 5000,
      },
    );
    const workerResponse = await postJson(
      app.origin,
      `/api/workflows/${encodeURIComponent(workflowId)}/request-live-ai-worker`,
      {
        estimatedCostCents: 5000,
        requestKey: "binding_propagation",
        worker: "demand_validator",
      },
    );
    const comparisonResponse = await postJson(
      app.origin,
      `/api/agent-workbench/${encodeURIComponent(workbenchWorkflowId)}/live-comparison`,
      {
        estimatedCostCents: 5000,
        worker: "demand_validator",
      },
    );
    assert.equal(researchResponse.response.status, 202);
    assert.equal(workerResponse.response.status, 202);
    assert.equal(comparisonResponse.response.status, 202);
    const research = researchResponse.payload.result;
    const worker = workerResponse.payload.result;
    const comparison = comparisonResponse.payload.result;
    const workflow = app.db.prepare(
      "SELECT metadata FROM workflows WHERE id = ?",
    ).get(workflowId);
    const researchTask = app.db.prepare(
      "SELECT payload FROM tasks WHERE id = ?",
    ).get(research.task.id);
    const workerTask = app.db.prepare(
      "SELECT payload FROM tasks WHERE id = ?",
    ).get(worker.task.id);
    const comparisonTask = app.db.prepare(
      "SELECT payload FROM tasks WHERE id = ?",
    ).get(comparison.liveWorker.task.id);

    assert.deepEqual(
      JSON.parse(workflow.metadata).commercialTestContract,
      fixture.binding,
    );
    assert.deepEqual(
      JSON.parse(researchTask.payload).commercialTestContract,
      fixture.binding,
    );
    assert.deepEqual(
      JSON.parse(workerTask.payload).commercialTestContract,
      fixture.binding,
    );
    assert.deepEqual(
      JSON.parse(comparisonTask.payload).commercialTestContract,
      fixture.binding,
    );
    assert.deepEqual(
      JSON.parse(
        app.db.prepare(
          "SELECT metadata FROM workflows WHERE id = ?",
        ).get(workbenchWorkflowId).metadata,
      ).commercialTestContract,
      fixture.binding,
    );
  } finally {
    await stopTestApp(app);
  }
});

test("authorized workflows cannot reuse stale live tasks that lack the exact contract", async () => {
  const app = await startTestApp("stale-live-task-binding");
  try {
    const fixture = contractFixture("stale-live-task-binding");
    insertContract(app.db, fixture);
    insertLifecycle(app.db, fixture, "proposed", "2026-07-29T00:00:00.500Z");
    insertLifecycle(app.db, fixture, "accepted", "2026-07-29T00:00:01.000Z");
    insertLifecycle(app.db, fixture, "activated", "2026-07-29T00:00:02.000Z");
    const researchWorkflowId = insertCommercialWorkflow(app.db, fixture, {
      id: "workflow-stale-research-task",
    });
    const workerWorkflowId = insertCommercialWorkflow(app.db, fixture, {
      id: "workflow-stale-worker-task",
    });
    const timestamp = "2026-07-29T00:00:03.000Z";
    app.db.prepare(`
      INSERT INTO tasks
      (id, workflow_id, venture_id, title, kind, agent, status, priority,
       max_retries, payload, result, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 'blocked', 2, 0, '{}', '{}', ?, ?)
    `).run(
      "task_live_research_workflow-stale-research-task",
      researchWorkflowId,
      fixture.contract.ventureId,
      "Stale live research task",
      "live_market_research",
      "researcher",
      timestamp,
      timestamp,
    );
    app.db.prepare(`
      INSERT INTO tasks
      (id, workflow_id, venture_id, title, kind, agent, status, priority,
       max_retries, payload, result, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 'blocked', 2, 0, '{}', '{}', ?, ?)
    `).run(
      "task_live_worker_workflow-stale-worker-task",
      workerWorkflowId,
      fixture.contract.ventureId,
      "Stale live worker task",
      "live_ai_worker_execution",
      "demand_validator",
      timestamp,
      timestamp,
    );
    const tables = [
      "tasks",
      "approvals",
      "costs",
      "events",
      "agent_definitions",
      "agent_context_snapshots",
    ];
    const counts = () => Object.fromEntries(tables.map((table) => [
      table,
      Number(app.db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count),
    ]));
    const before = counts();

    for (const request of [
      () => requestLiveResearch(app.db, researchWorkflowId, {
        estimatedCostCents: 5000,
      }),
      () => requestLiveAiWorker(app.db, workerWorkflowId, {
        estimatedCostCents: 5000,
        worker: "demand_validator",
      }),
    ]) {
      assert.throws(
        request,
        (error) => (
          error.statusCode === 409
          && error.code === "commercial_binding_required"
        ),
      );
      assert.deepEqual(counts(), before);
    }
  } finally {
    await stopTestApp(app);
  }
});

test("genuine noncommercial runtime diagnostics remain usable without a commercial binding", async () => {
  const app = await startTestApp("noncommercial-live-diagnostic");
  try {
    const workflowId = insertCommercialWorkflow(app.db, null, {
      id: "workflow-live-runtime-diagnostic",
      type: "runtime_assurance",
      title: "Runtime database recovery diagnostic",
      metadata: {
        systemProof: true,
        diagnosticOnly: true,
        subject: "Runtime database recovery diagnostic",
        agentRunner: {
          mode: "protected",
          liveModels: false,
          liveTools: false,
        },
      },
    });

    const research = requestLiveResearch(app.db, workflowId, {
      estimatedCostCents: 5000,
      reason: "Check current database recovery guidance under the protected runtime diagnostic.",
    });
    const worker = requestLiveAiWorker(app.db, workflowId, {
      estimatedCostCents: 5000,
      requestKey: "runtime_diagnostic",
      worker: "chief_of_staff",
      proofMode: true,
      reason: "Check the runtime recovery controls and return an internal diagnostic.",
    });

    assert.equal(research.task.workflow_id, workflowId);
    assert.equal(worker.task.workflow_id, workflowId);
    assert.equal(research.task.payload.commercialTestContract, undefined);
    assert.equal(worker.task.payload.commercialTestContract, undefined);
    assert.equal(research.approval.status, "pending");
    assert.equal(worker.approval.status, "pending");
  } finally {
    await stopTestApp(app);
  }
});

test("caller-defined Workbench, playbook, and model-comparison creation writes nothing", async () => {
  const app = await startTestApp("retired-caller-defined-proofs");
  try {
    const fixture = contractFixture("retired-caller-defined-proofs");
    insertContract(app.db, fixture);
    insertLifecycle(app.db, fixture, "proposed", "2026-07-29T00:00:00.500Z");
    insertLifecycle(app.db, fixture, "accepted", "2026-07-29T00:00:01.000Z");
    insertLifecycle(app.db, fixture, "activated", "2026-07-29T00:00:02.000Z");
    const comparisonWorkflowId = insertCommercialWorkflow(app.db, null, {
      id: "workflow-unbound-workbench-comparison",
      type: "agent_workbench_team_proof",
      title: "Marketplace buyer conversion proof",
      metadata: {
        subject: "Marketplace buyer conversion",
        buyer: "Prospective digital-product buyers",
        offer: "A paid client approval kit",
      },
    });
    const tables = [
      "workflows",
      "commands",
      "tasks",
      "approvals",
      "costs",
      "events",
      "agent_model_comparison_packets",
    ];
    const counts = () => Object.fromEntries(tables.map((table) => [
      table,
      Number(app.db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count),
    ]));
    const before = counts();
    const hostileBody = {
      subject: "Email prospects and publish a marketplace offer",
      buyer: "Prospective buyers",
      offer: "A paid digital kit",
      channel: "Marketplace checkout",
      autoRun: true,
      estimatedCostCents: 5000,
    };
    const retiredRoutes = [
      "/api/agent-model-readiness/demand_validator/comparison-packet",
      "/api/agent-playbooks/rehearsal-suite",
      "/api/agent-playbooks/demand_validator/rehearsal",
      "/api/agent-workbench/proof-suite",
      "/api/agent-workbench/demand_validator/proof-run",
    ];
    for (const pathname of retiredRoutes) {
      const result = await postJson(app.origin, pathname, hostileBody);
      assert.equal(result.response.status, 410, pathname);
      assert.equal(result.payload.code, "commercial_route_retired", pathname);
      assert.equal(result.payload.commercialAuthority.retiredRoute, true, pathname);
      assert.deepEqual(counts(), before, pathname);
    }

    const liveComparison = await postJson(
      app.origin,
      `/api/agent-workbench/${encodeURIComponent(comparisonWorkflowId)}/live-comparison`,
      hostileBody,
    );
    assert.equal(liveComparison.response.status, 409);
    assert.equal(liveComparison.payload.code, "commercial_binding_required");
    assert.deepEqual(counts(), before);
  } finally {
    await stopTestApp(app);
  }
});

test("orchestrator and HTTP task execution block adversarial commercial synonyms before any write", async () => {
  const app = await startTestApp("execution-synonyms");
  try {
    const timestamp = "2026-07-29T00:00:00.000Z";
    app.db.prepare(`
      INSERT INTO workflows
      (id, venture_id, type, title, status, current_step, priority,
       quality_score, expected_profit_cents, cost_estimate_cents,
       approval_required, metadata, created_at, updated_at)
      VALUES (
        'workflow-maintenance-execution-boundary',
        NULL,
        'maintenance',
        'Runtime dependency and backup maintenance',
        'planned',
        '',
        1,
        0,
        0,
        0,
        0,
        ?,
        ?,
        ?
      )
    `).run(
      toJson({
        agentRunner: {
          mode: "plan_only",
          liveModels: false,
          liveTools: false,
        },
      }),
      timestamp,
      timestamp,
    );

    const fixtures = [
      ["market", "market_research", {}],
      ["customer", "customer_followup", {}],
      ["prospect", "prospect_nurture", {}],
      ["contact", "contact_sequence", {}],
      ["outreach", "outreach_dispatch", {}],
      ["email", "email_send", {}],
      ["advertising", "advertising_campaign", {}],
      ["ads", "ads_publish", {}],
      ["listing", "marketplace_listing", {}],
      ["launch", "product_launch", {}],
      ["promotion", "sales_promotion", {}],
      ["checkout", "checkout_create", {}],
      ["order", "order_capture", {}],
      ["payment", "payment_collect", {}],
      ["tool", "dependency_audit", { tools: ["customer_email_sender"] }],
      ["effect", "dependency_audit", {
        externalEffects: [{ type: "marketplace_checkout_payment_capture" }],
      }],
    ];
    for (const [suffix, kind, payload] of fixtures) {
      app.db.prepare(`
        INSERT INTO tasks
        (id, workflow_id, venture_id, title, kind, agent, status, priority,
         max_retries, payload, result, created_at, updated_at)
        VALUES (?, 'workflow-maintenance-execution-boundary', NULL, ?, ?,
                'orchestrator', 'queued', 1, 0, ?, '{}', ?, ?)
      `).run(
        `task-commercial-boundary-${suffix}`,
        `Protected maintenance ${suffix}`,
        kind,
        toJson(payload),
        timestamp,
        timestamp,
      );
    }

    const before = {
      attempts: Number(app.db.prepare(
        "SELECT COUNT(*) AS count FROM task_attempts",
      ).get().count),
      approvals: Number(app.db.prepare(
        "SELECT COUNT(*) AS count FROM approvals",
      ).get().count),
      costs: Number(app.db.prepare(
        "SELECT COUNT(*) AS count FROM costs",
      ).get().count),
      events: Number(app.db.prepare(
        "SELECT COUNT(*) AS count FROM events",
      ).get().count),
    };

    const direct = await runOnce(app.db, {
      workflowId: "workflow-maintenance-execution-boundary",
      claimant: "adversarial-boundary-test",
    });
    assert.equal(direct.status, "safety_blocked");
    assert.equal(direct.reason, "commercial_binding_required");

    for (const [suffix] of fixtures) {
      const result = await postJson(
        app.origin,
        `/api/tasks/${encodeURIComponent(`task-commercial-boundary-${suffix}`)}/run`,
      );
      assert.equal(result.response.status, 409, suffix);
      assert.equal(result.payload.code, "commercial_binding_required", suffix);
    }

    assert.deepEqual({
      attempts: Number(app.db.prepare(
        "SELECT COUNT(*) AS count FROM task_attempts",
      ).get().count),
      approvals: Number(app.db.prepare(
        "SELECT COUNT(*) AS count FROM approvals",
      ).get().count),
      costs: Number(app.db.prepare(
        "SELECT COUNT(*) AS count FROM costs",
      ).get().count),
      events: Number(app.db.prepare(
        "SELECT COUNT(*) AS count FROM events",
      ).get().count),
    }, before);
    const states = app.db.prepare(`
      SELECT DISTINCT status
      FROM tasks
      WHERE workflow_id = 'workflow-maintenance-execution-boundary'
    `).all().map((row) => row.status);
    assert.deepEqual(states, ["queued"]);
  } finally {
    await stopTestApp(app);
  }
});

test("orchestrator checks the exact claim candidate atomically and rejects malformed payloads", async () => {
  const app = await startTestApp("atomic-execution-guard");
  try {
    const timestamp = "2026-07-29T00:00:00.000Z";
    const insertWorkflow = app.db.prepare(`
      INSERT INTO workflows
      (id, venture_id, type, title, status, current_step, priority,
       quality_score, expected_profit_cents, cost_estimate_cents,
       approval_required, metadata, created_at, updated_at)
      VALUES (?, NULL, ?, ?, ?, '', ?, 0, 0, 0, 0, '{}', ?, ?)
    `);
    const insertTask = app.db.prepare(`
      INSERT INTO tasks
      (id, workflow_id, venture_id, title, kind, agent, status, priority,
       max_retries, payload, result, created_at, updated_at)
      VALUES (?, ?, NULL, ?, ?, 'orchestrator', 'queued', ?, 0, ?, '{}', ?, ?)
    `);
    insertWorkflow.run(
      "workflow-unclaimable-safe",
      "backup",
      "Database backup",
      "cancelled",
      0,
      timestamp,
      timestamp,
    );
    insertTask.run(
      "task-unclaimable-safe",
      "workflow-unclaimable-safe",
      "Database backup",
      "dependency_audit",
      0,
      "{}",
      timestamp,
      timestamp,
    );
    insertWorkflow.run(
      "workflow-claimable-commercial",
      "maintenance",
      "System maintenance",
      "planned",
      1,
      timestamp,
      timestamp,
    );
    insertTask.run(
      "task-claimable-commercial",
      "workflow-claimable-commercial",
      "Follow up with customer",
      "customer_followup",
      1,
      "{}",
      timestamp,
      timestamp,
    );
    insertWorkflow.run(
      "workflow-malformed-commercial",
      "maintenance",
      "System maintenance",
      "planned",
      2,
      timestamp,
      timestamp,
    );
    insertTask.run(
      "task-malformed-commercial",
      "workflow-malformed-commercial",
      "Customer follow-up",
      "customer_followup",
      2,
      "{",
      timestamp,
      timestamp,
    );

    const attemptCount = () => Number(app.db.prepare(
      "SELECT COUNT(*) AS count FROM task_attempts",
    ).get().count);
    const before = attemptCount();

    const selected = await runOnce(app.db, {
      claimant: "atomic-commercial-guard-test",
    });
    assert.equal(selected.status, "safety_blocked");
    assert.equal(selected.task.id, "task-claimable-commercial");
    assert.equal(selected.reason, "commercial_binding_required");
    assert.equal(attemptCount(), before);
    assert.equal(
      app.db.prepare(
        "SELECT status, attempt_count FROM tasks WHERE id = 'task-claimable-commercial'",
      ).get().status,
      "queued",
    );

    const malformed = await runOnce(app.db, {
      taskId: "task-malformed-commercial",
      claimant: "atomic-commercial-guard-test",
    });
    assert.equal(malformed.status, "safety_blocked");
    assert.equal(malformed.reason, "commercial_binding_invalid");
    assert.equal(attemptCount(), before);
    const malformedRow = app.db.prepare(
      "SELECT status, attempt_count FROM tasks WHERE id = 'task-malformed-commercial'",
    ).get();
    assert.equal(malformedRow.status, "queued");
    assert.equal(malformedRow.attempt_count, 0);
  } finally {
    await stopTestApp(app);
  }
});

test("an explicitly diagnostic dry-run approval remains usable without commercial authority", async () => {
  const app = await startTestApp("diagnostic-approval", { includeDemoProof: true });
  try {
    persistApprovalScope(app.db, "appr-digital-product-dry-run");
    const decisions = await fetch(`${app.origin}/api/decisions`).then(
      (response) => response.json(),
    );
    const approval = decisions.approvals.find(
      (item) => item.id === "appr-digital-product-dry-run",
    );
    const approved = await postJson(
      app.origin,
      `/api/approvals/${encodeURIComponent(approval.id)}/approve`,
      {
        scopeHash: approval.scopeHash,
        note: "Run the exact internal diagnostic proof.",
      },
    );
    assert.equal(approved.response.status, 200);
    assert.equal(approved.payload.execution.status, "completed");
    assert.equal(
      approved.payload.execution.task.id,
      "task-digital-product-dry-run",
    );
  } finally {
    await stopTestApp(app);
  }
});

test("HTTP approves an exact active commercial handoff and preserves the binding on its child", async () => {
  const app = await startTestApp("commercial-handoff-approved");
  try {
    const fixture = contractFixture("commercial-handoff-approved");
    insertContract(app.db, fixture);
    insertLifecycle(app.db, fixture, "proposed", "2026-07-29T00:00:00.500Z");
    insertLifecycle(app.db, fixture, "accepted", "2026-07-29T00:00:01.000Z");
    insertLifecycle(app.db, fixture, "activated", "2026-07-29T00:00:02.000Z");
    const source = createHttpHandoff(app.db, {
      suffix: "commercial-approved",
      fixture,
    });

    const approved = await postJson(
      app.origin,
      `/api/agent-handoffs/${encodeURIComponent(source.handoff.id)}/approve`,
      { note: "Prepare the next exact internal recommendation." },
    );
    assert.equal(approved.response.status, 200);
    assert.equal(approved.payload.result.handoff.status, "approved_for_next_step");
    assert.ok(approved.payload.result.followupTask.id);

    const child = get(
      app.db,
      "SELECT * FROM tasks WHERE id = ?",
      [approved.payload.result.followupTask.id],
    );
    assert.ok(child);
    assert.deepEqual(
      JSON.parse(child.payload).commercialTestContract,
      fixture.binding,
    );
    const childSafety = classifyCommercialTaskSafety(app.db, child);
    assert.equal(childSafety.safe, true);
    assert.equal(childSafety.requiresCommercialAuthority, true);
    assert.equal(childSafety.classification, "authorized_commercial");
  } finally {
    await stopTestApp(app);
  }
});

test("HTTP keeps exact diagnostic handoffs usable without commercial authority", async () => {
  const app = await startTestApp("diagnostic-handoff-approved");
  try {
    const source = createHttpHandoff(app.db, {
      suffix: "diagnostic-approved",
      commercial: false,
      type: "runtime_assurance",
      title: "Runtime database health diagnostic",
      workflowMetadata: { systemProof: true },
    });
    const approved = await postJson(
      app.origin,
      `/api/agent-handoffs/${encodeURIComponent(source.handoff.id)}/approve`,
      { note: "Prepare the next local diagnostic recommendation." },
    );
    assert.equal(approved.response.status, 200);
    assert.equal(approved.payload.result.handoff.status, "approved_for_next_step");
    const child = get(
      app.db,
      "SELECT * FROM tasks WHERE id = ?",
      [approved.payload.result.followupTask.id],
    );
    assert.equal(
      Object.hasOwn(JSON.parse(child.payload), "commercialTestContract"),
      false,
    );
    assert.equal(
      classifyCommercialTaskSafety(app.db, child).classification,
      "diagnostic",
    );
  } finally {
    await stopTestApp(app);
  }
});

test("HTTP commercial handoff approval fails closed with zero writes for invalid or terminal authority", async () => {
  const cases = [
    {
      suffix: "unbound",
      expectedStatus: 409,
      expectedCode: "commercial_binding_required",
      prepare(app) {
        return createHttpHandoff(app.db, { suffix: this.suffix });
      },
    },
    {
      suffix: "conflicting",
      expectedStatus: 409,
      expectedCode: "commercial_binding_conflict",
      prepare(app) {
        const fixture = contractFixture(this.suffix);
        insertContract(app.db, fixture);
        insertLifecycle(app.db, fixture, "proposed", "2026-07-29T00:00:00.500Z");
        insertLifecycle(app.db, fixture, "accepted", "2026-07-29T00:00:01.000Z");
        insertLifecycle(app.db, fixture, "activated", "2026-07-29T00:00:02.000Z");
        const source = createHttpHandoff(app.db, { suffix: this.suffix, fixture });
        const task = get(app.db, "SELECT payload FROM tasks WHERE id = ?", [source.taskId]);
        const payload = JSON.parse(task.payload);
        payload.commercialTestContract.offerSku =
          `${payload.commercialTestContract.offerSku}_conflict`;
        app.db.prepare("UPDATE tasks SET payload = ? WHERE id = ?").run(
          toJson(payload),
          source.taskId,
        );
        return source;
      },
    },
    {
      suffix: "accepted-only",
      expectedStatus: 409,
      expectedCode: "commercial_program_inactive",
      prepare(app) {
        const fixture = contractFixture(this.suffix);
        insertContract(app.db, fixture);
        insertLifecycle(app.db, fixture, "proposed", "2026-07-29T00:00:00.500Z");
        insertLifecycle(app.db, fixture, "accepted", "2026-07-29T00:00:01.000Z");
        return createHttpHandoff(app.db, { suffix: this.suffix, fixture });
      },
    },
    {
      suffix: "paused",
      expectedStatus: 409,
      expectedCode: "commercial_program_inactive",
      prepare(app) {
        const fixture = contractFixture(this.suffix);
        insertContract(app.db, fixture);
        insertLifecycle(app.db, fixture, "proposed", "2026-07-29T00:00:00.500Z");
        insertLifecycle(app.db, fixture, "accepted", "2026-07-29T00:00:01.000Z");
        insertLifecycle(app.db, fixture, "activated", "2026-07-29T00:00:02.000Z");
        insertLifecycle(app.db, fixture, "paused", "2026-07-29T00:00:03.000Z");
        return createHttpHandoff(app.db, { suffix: this.suffix, fixture });
      },
    },
    ...["closed", "stopped"].map((eventType) => ({
      suffix: eventType,
      expectedStatus: 410,
      expectedCode: "commercial_program_terminal",
      prepare(app) {
        const fixture = contractFixture(eventType);
        insertContract(app.db, fixture);
        insertLifecycle(app.db, fixture, "proposed", "2026-07-29T00:00:00.500Z");
        insertLifecycle(app.db, fixture, "accepted", "2026-07-29T00:00:01.000Z");
        insertLifecycle(app.db, fixture, "activated", "2026-07-29T00:00:02.000Z");
        insertLifecycle(app.db, fixture, eventType, "2026-07-29T00:00:03.000Z");
        return createHttpHandoff(app.db, { suffix: eventType, fixture });
      },
    })),
    {
      suffix: "unknown-descriptor",
      expectedStatus: 409,
      expectedCode: "commercial_execution_descriptor_unknown",
      prepare(app) {
        const fixture = contractFixture(this.suffix);
        insertContract(app.db, fixture);
        insertLifecycle(app.db, fixture, "proposed", "2026-07-29T00:00:00.500Z");
        insertLifecycle(app.db, fixture, "accepted", "2026-07-29T00:00:01.000Z");
        insertLifecycle(app.db, fixture, "activated", "2026-07-29T00:00:02.000Z");
        return createHttpHandoff(app.db, {
          suffix: this.suffix,
          fixture,
          payload: { tools: ["unregistered_buyer_outreach_rail"] },
        });
      },
    },
    {
      suffix: "workflow-unknown-descriptor",
      expectedStatus: 409,
      expectedCode: "commercial_execution_descriptor_unknown",
      prepare(app) {
        const fixture = contractFixture(this.suffix);
        insertContract(app.db, fixture);
        insertLifecycle(app.db, fixture, "proposed", "2026-07-29T00:00:00.500Z");
        insertLifecycle(app.db, fixture, "accepted", "2026-07-29T00:00:01.000Z");
        insertLifecycle(app.db, fixture, "activated", "2026-07-29T00:00:02.000Z");
        return createHttpHandoff(app.db, {
          suffix: this.suffix,
          fixture,
          workflowMetadata: {
            agentRunner: {
              mode: "plan_only",
              liveModels: false,
              liveTools: false,
            },
            commercialTestContract: fixture.binding,
            tools: ["unregistered_buyer_outreach_rail"],
          },
        });
      },
    },
    {
      suffix: "protected-action",
      expectedStatus: 409,
      expectedCode: "commercial_protected_action_required",
      prepare(app) {
        const fixture = contractFixture(this.suffix);
        insertContract(app.db, fixture);
        insertLifecycle(app.db, fixture, "proposed", "2026-07-29T00:00:00.500Z");
        insertLifecycle(app.db, fixture, "accepted", "2026-07-29T00:00:01.000Z");
        insertLifecycle(app.db, fixture, "activated", "2026-07-29T00:00:02.000Z");
        return createHttpHandoff(app.db, {
          suffix: this.suffix,
          fixture,
          payload: { tools: ["customer_email_sender"] },
        });
      },
    },
    {
      suffix: "workflow-protected-action",
      expectedStatus: 409,
      expectedCode: "commercial_protected_action_required",
      prepare(app) {
        const fixture = contractFixture(this.suffix);
        insertContract(app.db, fixture);
        insertLifecycle(app.db, fixture, "proposed", "2026-07-29T00:00:00.500Z");
        insertLifecycle(app.db, fixture, "accepted", "2026-07-29T00:00:01.000Z");
        insertLifecycle(app.db, fixture, "activated", "2026-07-29T00:00:02.000Z");
        return createHttpHandoff(app.db, {
          suffix: this.suffix,
          fixture,
          workflowMetadata: {
            agentRunner: {
              mode: "plan_only",
              liveModels: false,
              liveTools: false,
            },
            commercialTestContract: fixture.binding,
            tools: ["customer_email_sender"],
          },
        });
      },
    },
  ];

  for (const fixtureCase of cases) {
    const app = await startTestApp(`handoff-${fixtureCase.suffix}`);
    try {
      const source = fixtureCase.prepare(app);
      const before = handoffWriteSnapshot(app.db, source);
      const rejected = await postJson(
        app.origin,
        `/api/agent-handoffs/${encodeURIComponent(source.handoff.id)}/approve`,
        { note: "This must not write when authority is invalid." },
      );
      assert.equal(
        rejected.response.status,
        fixtureCase.expectedStatus,
        fixtureCase.suffix,
      );
      assert.equal(
        rejected.payload.code,
        fixtureCase.expectedCode,
        fixtureCase.suffix,
      );
      assert.deepEqual(
        handoffWriteSnapshot(app.db, source),
        before,
        fixtureCase.suffix,
      );
      assert.equal(
        get(
          app.db,
          `SELECT COUNT(*) AS count FROM tasks
           WHERE kind = 'handoff_followup'`,
        ).count,
        0,
        fixtureCase.suffix,
      );
    } finally {
      await stopTestApp(app);
    }
  }
});
