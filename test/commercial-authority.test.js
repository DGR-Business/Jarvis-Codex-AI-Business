const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { DatabaseSync } = require("node:sqlite");
const test = require("node:test");
const {
  COMMERCIAL_AUTHORITY_SCHEMA,
  COMMERCIAL_TEST_CONTRACT_SCHEMA_V2,
  SEEDED_DRY_RUN_EXECUTION_CONTRACT_SCHEMA,
  CommercialAuthorityError,
  assertCommercialAuthority,
  classifyCommercialTaskSafety,
  classifyCommercialWorkflowSafety,
  commercialLifecycleApprovalScopeHash,
  commercialAuthorityErrorPayload,
  commercialRouteGuard,
  createCommercialLifecycleEvent,
  evaluateCommercialAuthority,
  extractCommercialTestBinding,
  getCommercialAuthorityState,
  inspectCommercialExecutionIntent,
  prepareSeededDryRunExecutionContract,
  resolveAcceptedActiveCommercialProgram,
} = require("../src/runtime/commercial-authority");
const {
  preflightCommercialWrite,
} = require("../src/runtime/commercial-prewrite-guard");
const {
  COST_CATEGORIES,
  OPERATOR_ROLE,
  PROTECTED_ACTION_KEYS,
  createCommercialTestContract,
  offerDefinitionHash,
  sha256,
} = require("../src/runtime/commercial-test-contract");
const {
  SOCIAL_MEDIA_MANAGER_CLIENT_CONTROL_V1,
} = require("../config/buyer-intent-validation-specs");

function protectedActions() {
  return Object.fromEntries(PROTECTED_ACTION_KEYS.map((key) => [key, true]));
}

function seededDryRunMetadata() {
  return {
    channel: "Digital Product",
    subject: "Digital product pilot proof",
    products: [
      {
        sku: "compact-desk-cable-template-v1",
        product: "Desk cable routing template",
        marginCents: 1900,
      },
      {
        sku: "small-business-launch-checklist-v1",
        product: "Launch checklist download",
        marginCents: 1200,
      },
    ],
    sourceFiles: [
      "deliverables/digital-products/compact-desk-cable-template-proof.md",
      "deliverables/digital-products/small-business-launch-checklist-proof.md",
    ],
    proofMode: "dry-run only; no live listing, file delivery, or paid asset generation is created",
  };
}

function createTestDatabase(options = {}) {
  const db = new DatabaseSync(":memory:");
  if (options.ventureTable !== false) {
    db.exec(`
      CREATE TABLE ventures (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL
      );
    `);
  }
  if (options.authorityTables !== false) {
    db.exec(`
      CREATE TABLE commercial_test_contracts (
        decision_hash TEXT PRIMARY KEY,
        contract_schema TEXT NOT NULL,
        program_id TEXT NOT NULL,
        program_version TEXT NOT NULL,
        test_id TEXT NOT NULL,
        test_version TEXT NOT NULL,
        venture_id TEXT NOT NULL,
        venture_kit_id TEXT NOT NULL,
        venture_kit_version INTEGER NOT NULL,
        venture_kit_hash TEXT NOT NULL,
        offer_id TEXT NOT NULL,
        offer_version TEXT NOT NULL,
        offer_hash TEXT NOT NULL,
        offer_sku TEXT NOT NULL,
        experiment_id TEXT NOT NULL,
        experiment_version TEXT NOT NULL,
        cohort_id TEXT NOT NULL,
        channel_id TEXT NOT NULL,
        provider_namespace TEXT NOT NULL,
        account_hash TEXT NOT NULL,
        adapter_id TEXT NOT NULL,
        adapter_version TEXT NOT NULL,
        adapter_hash TEXT NOT NULL,
        reporting_starts_at TEXT NOT NULL,
        reporting_ends_at TEXT NOT NULL,
        buyer_key_id TEXT NOT NULL,
        buyer_key_version INTEGER NOT NULL,
        buyer_independence_basis TEXT NOT NULL,
        price_aud_cents INTEGER NOT NULL,
        operator_role TEXT NOT NULL,
        external_spend_cap_cents INTEGER NOT NULL,
        contract_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE commercial_test_lifecycle_events (
        id TEXT PRIMARY KEY,
        decision_hash TEXT NOT NULL,
        sequence INTEGER NOT NULL,
        previous_event_hash TEXT,
        event_type TEXT NOT NULL,
        event_hash TEXT NOT NULL UNIQUE,
        approval_id TEXT,
        approval_scope_hash TEXT,
        reason TEXT NOT NULL,
        metadata TEXT NOT NULL,
        event_json TEXT NOT NULL,
        occurred_at TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE approvals (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        scope_hash TEXT,
        decided_at TEXT
      );
    `);
  }
  if (options.subjectTables !== false) {
    db.exec(`
      CREATE TABLE workflows (
        id TEXT PRIMARY KEY,
        venture_id TEXT,
        type TEXT NOT NULL,
        title TEXT NOT NULL,
        metadata TEXT NOT NULL
      );
      CREATE TABLE tasks (
        id TEXT PRIMARY KEY,
        workflow_id TEXT,
        venture_id TEXT,
        title TEXT,
        kind TEXT NOT NULL,
        agent TEXT,
        approval_id TEXT,
        max_retries INTEGER,
        payload TEXT NOT NULL
      );
      CREATE TABLE commercial_experiments (
        id TEXT PRIMARY KEY,
        workflow_id TEXT,
        venture_id TEXT,
        hypothesis TEXT NOT NULL,
        metadata TEXT NOT NULL
      );
      CREATE TABLE commercial_execution_packs (
        id TEXT PRIMARY KEY,
        experiment_id TEXT NOT NULL,
        workflow_id TEXT,
        venture_id TEXT,
        offer_page_copy TEXT NOT NULL,
        metadata TEXT NOT NULL
      );
    `);
  }
  return db;
}

function contractFixture(suffix = "one") {
  const accountHash = sha256(`account-${suffix}`);
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
    ventureId: `venture-${suffix}`,
    ventureKit: {
      id: `venture-kit-${suffix}`,
      version: 1,
      hash: sha256(`venture-kit-${suffix}`),
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
      hypothesis: "The exact buyer will pay for the exact low-touch kit",
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
    row: {
      decisionHash: contract.decisionHash,
      contractSchema: contract.schema,
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
      channelId: contract.channel.id,
      providerNamespace: contract.channel.providerNamespace,
      accountHash: contract.channel.accountHash,
      adapterId: contract.channel.adapter.id,
      adapterVersion: contract.channel.adapter.version,
      adapterHash: contract.channel.adapter.hash,
      reportingStartsAt: contract.reportingPeriod.startsAt,
      reportingEndsAt: contract.reportingPeriod.endsAt,
      buyerKeyId: contract.buyerIdentity.keyId,
      buyerKeyVersion: contract.buyerIdentity.keyVersion,
      buyerIndependenceBasis: contract.buyerIdentity.independenceBasis,
      priceAudCents: contract.price.amountAudCents,
      operatorRole: contract.operatorRole,
      externalSpendCapCents: 0,
    },
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

function insertContract(db, fixture, overrides = {}) {
  const row = { ...fixture.row, ...overrides };
  const contract = overrides.contract || fixture.contract;
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
            ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    row.decisionHash,
    row.contractSchema,
    row.programId,
    row.programVersion,
    row.testId,
    row.testVersion,
    row.ventureId,
    row.ventureKitId,
    row.ventureKitVersion,
    row.ventureKitHash,
    row.offerId,
    row.offerVersion,
    row.offerHash,
    row.offerSku,
    row.experimentId,
    row.experimentVersion,
    row.cohortId,
    row.channelId,
    row.providerNamespace,
    row.accountHash,
    row.adapterId,
    row.adapterVersion,
    row.adapterHash,
    row.reportingStartsAt,
    row.reportingEndsAt,
    row.buyerKeyId,
    row.buyerKeyVersion,
    row.buyerIndependenceBasis,
    row.priceAudCents,
    row.operatorRole,
    row.externalSpendCapCents,
    JSON.stringify(contract),
    "2026-07-29T00:00:00.000Z",
  );
}

function insertLifecycle(db, fixture, eventType, occurredAt, options = {}) {
  const prior = db.prepare(`
    SELECT sequence, event_hash
    FROM commercial_test_lifecycle_events
    WHERE decision_hash = ?
    ORDER BY sequence DESC
    LIMIT 1
  `).get(fixture.row.decisionHash);
  const sequence = options.sequence ?? (prior ? prior.sequence + 1 : 0);
  const id = options.id || `lifecycle-${fixture.contract.testId}-${sequence}`;
  const approvalRequired = ["accepted", "activated"].includes(eventType);
  const event = createCommercialLifecycleEvent({
    id,
    decisionHash: fixture.row.decisionHash,
    sequence,
    previousEventHash: options.previousEventHash ?? prior?.event_hash ?? null,
    eventType,
    approvalId: options.approvalId
      ?? (approvalRequired
        ? `approval-${fixture.contract.testId}-${eventType}`
        : null),
    approvalScopeHash: options.approvalScopeHash
      ?? (approvalRequired
        ? commercialLifecycleApprovalScopeHash(fixture.contract, eventType)
        : null),
    reason: options.reason || "",
    metadata: options.metadata || {},
    occurredAt,
    ...options.eventOverrides,
  });
  const persisted = { ...event, ...options.jsonOverrides };
  const row = { ...event, ...options.rowOverrides };
  if (approvalRequired && row.approvalId) {
    db.prepare(`
      INSERT OR REPLACE INTO approvals (id, status, scope_hash, decided_at)
      VALUES (?, ?, ?, ?)
    `).run(
      row.approvalId,
      options.approvalStatus || "approved",
      options.approvalLedgerScopeHash ?? row.approvalScopeHash,
      options.approvalDecidedAt || occurredAt,
    );
  }
  db.prepare(`
    INSERT INTO commercial_test_lifecycle_events
    (id, decision_hash, sequence, previous_event_hash, event_type, event_hash,
     approval_id, approval_scope_hash, reason, metadata, event_json, occurred_at,
     created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    row.id,
    row.decisionHash,
    row.sequence,
    row.previousEventHash,
    row.eventType,
    row.eventHash,
    row.approvalId,
    row.approvalScopeHash,
    row.reason,
    JSON.stringify(row.metadata),
    JSON.stringify(persisted),
    row.occurredAt,
    options.createdAt || occurredAt,
  );
  return event;
}

function activateContract(db, fixture, start = "2026-07-29T00:00:00.000Z") {
  const proposedAt = start;
  const acceptedAt = new Date(Date.parse(start) + 1000).toISOString();
  const activatedAt = new Date(Date.parse(start) + 2000).toISOString();
  insertLifecycle(db, fixture, "proposed", proposedAt);
  insertLifecycle(db, fixture, "accepted", acceptedAt, {
    approvalId: `approval-${fixture.contract.testId}-accept`,
  });
  insertLifecycle(db, fixture, "activated", activatedAt, {
    approvalId: `approval-${fixture.contract.testId}-activate`,
  });
}

function bindingMetadata(fixture, bindingOverrides = {}) {
  return JSON.stringify({
    commercialTestContract: {
      ...fixture.binding,
      ...bindingOverrides,
    },
  });
}

function insertWorkflow(db, fixture, options = {}) {
  db.prepare(`
    INSERT INTO workflows (id, venture_id, type, title, metadata)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    options.id || "workflow-one",
    fixture?.row.ventureId || null,
    options.type || "commercial_test",
    options.title || "Commercial buyer test",
    options.metadata ?? bindingMetadata(fixture),
  );
}

function insertCommercialSubjectChain(db, fixture, suffix = "chain") {
  const workflowId = `workflow-${suffix}`;
  const taskId = `task-${suffix}`;
  const experimentId = `experiment-row-${suffix}`;
  const packId = `pack-${suffix}`;
  insertWorkflow(db, fixture, { id: workflowId });
  db.prepare(`
    INSERT INTO tasks (id, workflow_id, kind, payload)
    VALUES (?, ?, ?, ?)
  `).run(taskId, workflowId, "commercial_action", bindingMetadata(fixture));
  db.prepare(`
    INSERT INTO commercial_experiments
    (id, workflow_id, venture_id, hypothesis, metadata)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    experimentId,
    workflowId,
    fixture.row.ventureId,
    "The exact buyer will purchase the exact offer.",
    bindingMetadata(fixture),
  );
  db.prepare(`
    INSERT INTO commercial_execution_packs
    (id, experiment_id, workflow_id, venture_id, offer_page_copy, metadata)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    packId,
    experimentId,
    workflowId,
    fixture.row.ventureId,
    "Offer copy",
    bindingMetadata(fixture),
  );
  return { workflowId, taskId, experimentId, packId };
}

test("an active venture never substitutes for commercial authority", () => {
  const db = createTestDatabase({ authorityTables: false });
  db.prepare("INSERT INTO ventures (id, status) VALUES (?, ?)").run(
    "venture-placeholder",
    "active",
  );
  const fixture = contractFixture();

  const state = getCommercialAuthorityState(db);
  const guard = commercialRouteGuard(db, { binding: fixture.binding });

  assert.equal(state.status, "unavailable");
  assert.equal(state.reason, "authority_tables_missing");
  assert.equal(resolveAcceptedActiveCommercialProgram(db), null);
  assert.equal(guard.allowed, false);
  assert.equal(guard.statusCode, 409);
  assert.equal(guard.code, "commercial_authority_unavailable");
  assert.equal(guard.payload.commercialAuthority.authorityStatus, "unavailable");
  db.close();
});

test("only accepted then latest activated resolves as the active program", () => {
  const db = createTestDatabase();
  const fixture = contractFixture();
  insertContract(db, fixture);
  insertLifecycle(db, fixture, "proposed", "2026-07-29T00:00:00.000Z");
  insertLifecycle(db, fixture, "accepted", "2026-07-29T00:00:01.000Z", {
    approvalId: "approval-owner",
  });
  insertLifecycle(db, fixture, "activated", "2026-07-29T00:00:02.000Z");

  const state = getCommercialAuthorityState(db);
  assert.equal(state.status, "active");
  assert.equal(state.activeProgram.decisionHash, fixture.row.decisionHash);
  assert.equal(state.activeProgram.acceptedEvent.type, "accepted");
  assert.equal(state.activeProgram.latestEvent.type, "activated");
  assert.equal(
    resolveAcceptedActiveCommercialProgram(db).programId,
    fixture.row.programId,
  );
  db.close();

  const unacceptedDb = createTestDatabase();
  const unacceptedFixture = contractFixture("unaccepted");
  insertContract(unacceptedDb, unacceptedFixture);
  insertLifecycle(
    unacceptedDb,
    unacceptedFixture,
    "proposed",
    "2026-07-29T00:00:01.000Z",
  );
  insertLifecycle(
    unacceptedDb,
    unacceptedFixture,
    "activated",
    "2026-07-29T00:00:02.000Z",
  );
  const unacceptedState = getCommercialAuthorityState(unacceptedDb);
  assert.equal(unacceptedState.status, "invalid");
  assert.match(unacceptedState.issues.join(" "), /proposed -> activated/);
  unacceptedDb.close();
});

test("lifecycle sequence controls authority and pause requires fresh acceptance and activation", () => {
  const db = createTestDatabase();
  const fixture = contractFixture("row-order");
  insertContract(db, fixture);
  const timestamp = "2026-07-29T01:00:00.000Z";
  activateContract(db, fixture, timestamp);
  assert.equal(getCommercialAuthorityState(db).status, "active");

  insertLifecycle(db, fixture, "paused", "2026-07-29T01:00:03.000Z");
  const paused = getCommercialAuthorityState(db);
  assert.equal(paused.status, "inactive");
  assert.equal(paused.contracts[0].latestEvent.type, "paused");
  assert.equal(
    commercialRouteGuard(db, { binding: fixture.binding }).code,
    "commercial_program_inactive",
  );
  insertLifecycle(db, fixture, "accepted", "2026-07-29T01:00:04.000Z", {
    approvalId: `approval-${fixture.contract.testId}-accepted-resume`,
    approvalDecidedAt: "2026-07-29T01:00:03.500Z",
  });
  insertLifecycle(db, fixture, "activated", "2026-07-29T01:00:05.000Z", {
    approvalId: `approval-${fixture.contract.testId}-activated-resume`,
    approvalDecidedAt: "2026-07-29T01:00:04.500Z",
  });
  assert.equal(getCommercialAuthorityState(db).status, "active");
  db.close();
});

test("closed and stopped decisions are terminal and cannot be reactivated", () => {
  for (const eventType of ["closed", "stopped"]) {
    const db = createTestDatabase();
    const fixture = contractFixture(eventType);
    insertContract(db, fixture);
    activateContract(db, fixture);
    insertLifecycle(db, fixture, eventType, "2026-07-29T00:00:03.000Z");

    let guard = commercialRouteGuard(db, { binding: fixture.binding });
    assert.equal(guard.statusCode, 410);
    assert.equal(guard.code, "commercial_program_terminal");

    insertLifecycle(db, fixture, "activated", "2026-07-29T00:00:04.000Z");
    guard = commercialRouteGuard(db, { binding: fixture.binding });
    assert.equal(guard.statusCode, 409);
    assert.equal(guard.code, "commercial_authority_unavailable");
    assert.equal(getCommercialAuthorityState(db).status, "invalid");
    assert.equal(getCommercialAuthorityState(db).contracts[0].status, "terminal");
    db.close();
  }
});

test("an exact workflow binding is allowed and binding extraction is reusable", () => {
  const db = createTestDatabase();
  const fixture = contractFixture("workflow");
  insertContract(db, fixture);
  activateContract(db, fixture);
  insertWorkflow(db, fixture);

  const metadata = JSON.parse(
    db.prepare("SELECT metadata FROM workflows WHERE id = ?").get("workflow-one").metadata,
  );
  assert.deepEqual(extractCommercialTestBinding(metadata), fixture.binding);

  const assessment = evaluateCommercialAuthority(db, {
    workflowId: "workflow-one",
  });
  assert.equal(assessment.allowed, true);
  assert.equal(assessment.statusCode, 200);
  assert.equal(assessment.program.decisionHash, fixture.row.decisionHash);
  assert.equal(
    assertCommercialAuthority(db, { workflowId: "workflow-one" }).allowed,
    true,
  );
  db.close();
});

test("missing, incomplete, and mismatched bindings fail closed", () => {
  const db = createTestDatabase();
  const fixture = contractFixture("invalid-bindings");
  insertContract(db, fixture);
  activateContract(db, fixture);
  insertWorkflow(db, fixture, {
    id: "workflow-missing",
    metadata: "{}",
  });
  insertWorkflow(db, fixture, {
    id: "workflow-incomplete",
    metadata: JSON.stringify({
      commercialTestContract: {
        decisionHash: fixture.row.decisionHash,
      },
    }),
  });
  insertWorkflow(db, fixture, {
    id: "workflow-mismatch",
    metadata: bindingMetadata(fixture, { programVersion: "99" }),
  });

  assert.equal(
    commercialRouteGuard(db, { workflowId: "workflow-missing" }).code,
    "commercial_binding_required",
  );
  assert.equal(
    commercialRouteGuard(db, { workflowId: "workflow-incomplete" }).code,
    "commercial_binding_invalid",
  );
  assert.equal(
    commercialRouteGuard(db, { workflowId: "workflow-mismatch" }).code,
    "commercial_binding_mismatch",
  );
  assert.throws(
    () => assertCommercialAuthority(db, { workflowId: "workflow-mismatch" }),
    (error) => (
      error instanceof CommercialAuthorityError
      && error.statusCode === 409
      && error.code === "commercial_binding_mismatch"
    ),
  );
  db.close();
});

test("tasks, experiments, and execution packs require matching bindings at every layer", () => {
  const db = createTestDatabase();
  const fixture = contractFixture("chain");
  insertContract(db, fixture);
  activateContract(db, fixture);
  insertWorkflow(db, fixture, { id: "workflow-chain" });
  db.prepare(`
    INSERT INTO tasks (id, workflow_id, kind, payload)
    VALUES (?, ?, ?, ?)
  `).run("task-chain", "workflow-chain", "commercial_action", bindingMetadata(fixture));
  db.prepare(`
    INSERT INTO commercial_experiments
    (id, workflow_id, venture_id, hypothesis, metadata)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    "experiment-chain",
    "workflow-chain",
    fixture.row.ventureId,
    "The exact buyer will purchase the exact offer.",
    bindingMetadata(fixture),
  );
  db.prepare(`
    INSERT INTO commercial_execution_packs
    (id, experiment_id, workflow_id, venture_id, offer_page_copy, metadata)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    "pack-chain",
    "experiment-chain",
    "workflow-chain",
    fixture.row.ventureId,
    "Offer copy",
    bindingMetadata(fixture),
  );

  assert.equal(
    evaluateCommercialAuthority(db, { taskId: "task-chain" }).allowed,
    true,
  );
  assert.equal(
    classifyCommercialTaskSafety(db, "task-chain").classification,
    "authorized_commercial",
  );
  assert.equal(
    evaluateCommercialAuthority(db, { experimentId: "experiment-chain" }).allowed,
    true,
  );
  assert.equal(
    evaluateCommercialAuthority(db, { packId: "pack-chain" }).allowed,
    true,
  );

  db.prepare("UPDATE tasks SET payload = '{}' WHERE id = ?").run("task-chain");
  assert.equal(
    commercialRouteGuard(db, { taskId: "task-chain" }).code,
    "commercial_binding_required",
  );
  assert.equal(
    classifyCommercialTaskSafety(db, "task-chain").code,
    "commercial_binding_required",
  );
  db.prepare("UPDATE tasks SET payload = ? WHERE id = ?").run(
    bindingMetadata(fixture, { testVersion: "different" }),
    "task-chain",
  );
  assert.equal(
    commercialRouteGuard(db, { taskId: "task-chain" }).code,
    "commercial_binding_conflict",
  );
  db.close();
});

test("every subject layer requires the full exact kit, offer, experiment, and cohort binding", () => {
  const db = createTestDatabase();
  const fixture = contractFixture("all-layer-bindings");
  insertContract(db, fixture);
  activateContract(db, fixture);
  const ids = insertCommercialSubjectChain(db, fixture, "all-layer-bindings");
  const layers = [
    {
      table: "workflows",
      column: "metadata",
      id: ids.workflowId,
      target: { workflowId: ids.workflowId },
    },
    {
      table: "tasks",
      column: "payload",
      id: ids.taskId,
      target: { taskId: ids.taskId },
    },
    {
      table: "commercial_experiments",
      column: "metadata",
      id: ids.experimentId,
      target: { experimentId: ids.experimentId },
    },
    {
      table: "commercial_execution_packs",
      column: "metadata",
      id: ids.packId,
      target: { packId: ids.packId },
    },
  ];
  const exactScopeFields = [
    "ventureKitId",
    "ventureKitVersion",
    "ventureKitHash",
    "offerId",
    "offerVersion",
    "offerHash",
    "offerSku",
    "experimentId",
    "experimentVersion",
    "cohortId",
  ];
  for (const layer of layers) {
    for (const field of exactScopeFields) {
      const omitted = { ...fixture.binding };
      delete omitted[field];
      db.prepare(`UPDATE ${layer.table} SET ${layer.column} = ? WHERE id = ?`).run(
        JSON.stringify({ commercialTestContract: omitted }),
        layer.id,
      );
      const assessment = evaluateCommercialAuthority(db, layer.target);
      assert.equal(assessment.allowed, false, `${layer.table}.${field}`);
      assert.equal(assessment.code, "commercial_binding_invalid", `${layer.table}.${field}`);
    }

    const mismatch = {
      ...fixture.binding,
      offerSku: `${fixture.binding.offerSku}.forged`,
    };
    db.prepare(`UPDATE ${layer.table} SET ${layer.column} = ? WHERE id = ?`).run(
      JSON.stringify({ commercialTestContract: mismatch }),
      layer.id,
    );
    const mismatched = evaluateCommercialAuthority(db, layer.target);
    assert.equal(mismatched.allowed, false, `${layer.table}.mismatch`);
    assert.ok(
      ["commercial_binding_conflict", "commercial_binding_mismatch"].includes(
        mismatched.code,
      ),
      `${layer.table}.mismatch=${mismatched.code}`,
    );
    db.prepare(`UPDATE ${layer.table} SET ${layer.column} = ? WHERE id = ?`).run(
      bindingMetadata(fixture),
      layer.id,
    );
  }
  db.close();
});

test("the stopped historical buyer-intent specification returns 410 without a v2 ledger", () => {
  const db = createTestDatabase({
    authorityTables: false,
    subjectTables: false,
  });
  const workflow = {
    id: "historical-workflow",
    type: "buyer_intent_validation",
    title: "Historical buyer-intent test",
    metadata: JSON.stringify({
      buyerIntentValidation: {
        schema: "pantheon.buyer-intent-validation.v1",
        specId: SOCIAL_MEDIA_MANAGER_CLIENT_CONTROL_V1.id,
      },
    }),
  };

  const assessment = evaluateCommercialAuthority(db, { workflow });
  assert.equal(assessment.allowed, false);
  assert.equal(assessment.statusCode, 410);
  assert.equal(assessment.code, "commercial_program_terminal");
  assert.equal(
    assessment.details.historicalSpecId,
    SOCIAL_MEDIA_MANAGER_CLIENT_CONTROL_V1.id,
  );
  db.close();
});

test("multiple active contracts are ambiguous and no program is selected", () => {
  const db = createTestDatabase();
  const first = contractFixture("first-active");
  const second = contractFixture("second-active");
  insertContract(db, first);
  insertContract(db, second);
  activateContract(db, first, "2026-07-29T02:00:00.000Z");
  activateContract(db, second, "2026-07-29T03:00:00.000Z");

  const state = getCommercialAuthorityState(db);
  assert.equal(state.status, "ambiguous");
  assert.equal(state.counts.active, 2);
  assert.equal(state.activeProgram, null);
  assert.equal(resolveAcceptedActiveCommercialProgram(db), null);
  const guard = commercialRouteGuard(db, { binding: first.binding });
  assert.equal(guard.statusCode, 409);
  assert.equal(guard.code, "commercial_authority_ambiguous");
  db.close();
});

test("safe workflow classification separates diagnostics, support work, and commercial work", () => {
  const db = createTestDatabase();
  const fixture = contractFixture("classification");
  insertContract(db, fixture);
  activateContract(db, fixture);
  insertWorkflow(db, fixture, {
    id: "workflow-diagnostic",
    type: "runtime_assurance",
    title: "Runtime proof",
    metadata: JSON.stringify({ systemProof: true }),
  });
  insertWorkflow(db, fixture, {
    id: "workflow-support",
    type: "backup",
    title: "Create local recovery copy",
    metadata: "{}",
  });
  insertWorkflow(db, fixture, {
    id: "workflow-commercial-unbound",
    type: "buyer_outreach",
    title: "Contact buyers",
    metadata: "{}",
  });
  insertWorkflow(db, fixture, {
    id: "workflow-commercial-bound",
  });

  const diagnostic = classifyCommercialWorkflowSafety(db, "workflow-diagnostic");
  const support = classifyCommercialWorkflowSafety(db, "workflow-support");
  const unbound = classifyCommercialWorkflowSafety(db, "workflow-commercial-unbound");
  const bound = classifyCommercialWorkflowSafety(db, "workflow-commercial-bound");

  assert.equal(diagnostic.safeToRun, true);
  assert.equal(diagnostic.classification, "diagnostic");
  assert.equal(support.safeToRun, true);
  assert.equal(support.classification, "non_commercial");
  assert.equal(unbound.safeToRun, false);
  assert.equal(unbound.code, "commercial_binding_required");
  assert.equal(bound.safeToRun, true);
  assert.equal(bound.classification, "authorized_commercial");
  db.close();
});

test("commercial action synonyms and commercial tool or effect identifiers cannot hide in support work", () => {
  const db = createTestDatabase();
  const workflowTypes = [
    "market_scan",
    "customer_followup",
    "prospect_nurture",
    "contact_sequence",
    "outreach_dispatch",
    "email_send",
    "advertising_campaign",
    "ads_publish",
    "marketplace_listing",
    "product_launch",
    "sales_promotion",
    "checkout_create",
    "order_capture",
    "payment_collect",
  ];
  for (const [index, type] of workflowTypes.entries()) {
    const id = `workflow-action-synonym-${index}`;
    insertWorkflow(db, null, {
      id,
      type,
      title: "Bounded execution request",
      metadata: "{}",
    });
    const safety = classifyCommercialWorkflowSafety(db, id);
    assert.equal(safety.safeToRun, false, type);
    assert.equal(safety.requiresCommercialAuthority, true, type);
    assert.equal(safety.code, "commercial_binding_required", type);
  }

  insertWorkflow(db, null, {
    id: "workflow-maintenance-boundary",
    type: "maintenance",
    title: "Runtime dependency and backup maintenance",
    metadata: JSON.stringify({
      agentRunner: {
        mode: "plan_only",
        liveModels: false,
        liveTools: false,
      },
    }),
  });

  const actionKinds = [
    "market_research",
    "customer_followup",
    "prospect_nurture",
    "contact_sequence",
    "outreach_dispatch",
    "email_send",
    "advertising_campaign",
    "ads_publish",
    "marketplace_listing",
    "product_launch",
    "sales_promotion",
    "checkout_create",
    "order_capture",
    "payment_collect",
  ];
  for (const [index, kind] of actionKinds.entries()) {
    const id = `task-action-synonym-${index}`;
    db.prepare(`
      INSERT INTO tasks (id, workflow_id, kind, payload)
      VALUES (?, 'workflow-maintenance-boundary', ?, '{}')
    `).run(id, kind);
    const safety = classifyCommercialTaskSafety(db, id);
    assert.equal(safety.safeToRun, false, kind);
    assert.equal(safety.requiresCommercialAuthority, true, kind);
    assert.equal(safety.code, "commercial_binding_required", kind);
  }

  const structuredIdentifiers = [
    {
      id: "task-commercial-tool-identifier",
      payload: { tools: ["sendgrid_customer_email_sender"] },
    },
    {
      id: "task-commercial-effect-identifier",
      payload: {
        externalEffects: [{
          type: "marketplace_checkout_payment_capture",
        }],
      },
    },
  ];
  for (const fixture of structuredIdentifiers) {
    db.prepare(`
      INSERT INTO tasks (id, workflow_id, kind, payload)
      VALUES (?, 'workflow-maintenance-boundary', 'dependency_audit', ?)
    `).run(fixture.id, JSON.stringify(fixture.payload));
    const safety = classifyCommercialTaskSafety(db, fixture.id);
    assert.equal(safety.safeToRun, false, fixture.id);
    assert.equal(safety.code, "commercial_binding_required", fixture.id);
  }

  db.prepare(`
    INSERT INTO tasks (id, workflow_id, kind, payload)
    VALUES (
      'task-ordinary-maintenance',
      'workflow-maintenance-boundary',
      'dependency_audit',
      '{"diagnosticOnly":true}'
    )
  `).run();
  const maintenance = classifyCommercialTaskSafety(
    db,
    "task-ordinary-maintenance",
  );
  assert.equal(maintenance.safeToRun, true);
  assert.equal(maintenance.classification, "non_commercial");
  db.close();
});

test("the closed execution registry covers every planned external commercial rail", () => {
  const db = createTestDatabase();
  insertWorkflow(db, null, {
    id: "workflow-registry-maintenance",
    type: "maintenance",
    title: "Runtime dependency maintenance",
    metadata: "{}",
  });
  const fixtures = [
    ["voice", "voice", { action: "twilio_call" }],
    ["sms", "messaging", { tools: ["twilio_sms"] }],
    ["email", "email", { tools: ["smtp_send"] }],
    ["social", "social", { externalEffects: [{ type: "facebook_post" }] }],
    ["marketplace", "marketplace", { tools: ["etsy_upload"] }],
    ["payment", "payment", { externalEffects: ["stripe_charge"] }],
    ["invoice", "invoice", { externalEffects: ["invoice_issue"] }],
    ["refund", "refund", { externalEffects: ["refund_issue"] }],
    ["payout", "payout", { externalEffects: ["payout_release"] }],
    ["fulfilment", "fulfilment", { externalEffects: ["fulfil_order"] }],
  ];

  for (const [label, category, payload] of fixtures) {
    const taskId = `task-registry-${label}`;
    db.prepare(`
      INSERT INTO tasks (id, workflow_id, kind, payload)
      VALUES (?, 'workflow-registry-maintenance', 'dependency_audit', ?)
    `).run(taskId, JSON.stringify(payload));
    const safety = classifyCommercialTaskSafety(db, taskId);
    assert.equal(safety.safeToRun, false, label);
    assert.equal(safety.code, "commercial_binding_required", label);
    assert.ok(
      safety.intent.descriptorSignals.some((signal) => (
        signal.classification === "commercial"
        && signal.category === category
      )),
      label,
    );
  }
  db.close();
});

test("unknown execution tools, effects, providers, and integrations fail closed even with active authority", () => {
  const db = createTestDatabase();
  const fixture = contractFixture("unknown-descriptors");
  insertContract(db, fixture);
  activateContract(db, fixture);
  insertWorkflow(db, fixture, {
    id: "workflow-unknown-descriptors",
  });
  const fixtures = [
    ["tool", { tools: ["unregistered_customer_sender"] }],
    ["effect", { externalEffects: [{ type: "teleport_inventory" }] }],
    ["sdk-tool", { sdkCapabilities: { tools: ["unregistered_sdk_tool"] } }],
    ["root-action", { action: "twilio_call_v2" }],
    ["request-type", {
      liveSpendRequest: {
        type: "twilio_call_v2",
        provider: "openai",
        tools: [],
        effects: [],
      },
    }],
    ["adapter-tool", {
      adapter: {
        tools: ["unregistered_adapter_tool"],
      },
    }],
    ["tool-arguments", {
      toolArguments: {
        action: "twilio_call_v2",
      },
    }],
    ["root-provider", { provider: "unregistered-provider" }],
    ["provider", {
      liveSpendRequest: {
        provider: "unregistered-provider",
        tools: [],
        effects: [],
      },
    }],
    ["integration", {
      liveSpendRequest: {
        integration: "unregistered-crm",
        tools: [],
        effects: [],
      },
    }],
  ];

  for (const [suffix, extra] of fixtures) {
    const taskId = `task-unknown-descriptor-${suffix}`;
    db.prepare(`
      INSERT INTO tasks (id, workflow_id, kind, payload)
      VALUES (?, 'workflow-unknown-descriptors', 'commercial_action', ?)
    `).run(
      taskId,
      JSON.stringify({
        commercialTestContract: fixture.binding,
        ...extra,
      }),
    );
    const safety = classifyCommercialTaskSafety(db, taskId);
    assert.equal(safety.safeToRun, false, suffix);
    assert.equal(
      safety.code,
      "commercial_execution_descriptor_unknown",
      suffix,
    );
    assert.ok(
      safety.details.unknownExternalDescriptors.length > 0,
      suffix,
    );
    assert.equal(
      commercialRouteGuard(db, { taskId }).code,
      "commercial_execution_descriptor_unknown",
      `${suffix} direct guard`,
    );
  }
  db.close();
});

test("unknown live-request descriptors are commercial-risk signals and cannot pass pre-write", () => {
  const db = createTestDatabase();
  insertWorkflow(db, null, {
    id: "workflow-prewrite-unknown",
    type: "maintenance",
    title: "Local runtime maintenance",
    metadata: "{}",
  });
  const request = {
    tools: ["unregistered_external_sender"],
  };
  const intent = inspectCommercialExecutionIntent(request, {
    path: "$.liveRequest",
  });
  assert.equal(intent.commercial, true);
  assert.equal(intent.unknownExternalDescriptors.length, 1);

  const workflow = db.prepare(
    "SELECT * FROM workflows WHERE id = ?",
  ).get("workflow-prewrite-unknown");
  assert.throws(
    () => preflightCommercialWrite(db, {
      workflow,
      options: request,
    }),
    (error) => (
      error instanceof CommercialAuthorityError
      && error.code === "commercial_binding_required"
    ),
  );
  db.close();
});

test("registered internal execution descriptors remain non-commercial", () => {
  const db = createTestDatabase();
  insertWorkflow(db, null, {
    id: "workflow-internal-descriptors",
    type: "maintenance",
    title: "Local runtime health check",
    metadata: JSON.stringify({
      executionDescriptor: {
        kind: "live_research",
        provider: "openai-agents-sdk",
        tools: ["research_adapter", "web_search"],
        externalEffects: [],
      },
    }),
  });
  db.prepare(`
    INSERT INTO tasks (id, workflow_id, kind, payload)
    VALUES (
      'task-internal-descriptors',
      'workflow-internal-descriptors',
      'dependency_audit',
      ?
    )
  `).run(JSON.stringify({
    liveSpendRequest: {
      provider: "openai",
      tools: ["runtime_state", "local_deliverables"],
      effects: [],
    },
  }));

  const workflow = classifyCommercialWorkflowSafety(
    db,
    "workflow-internal-descriptors",
  );
  const task = classifyCommercialTaskSafety(db, "task-internal-descriptors");
  assert.equal(workflow.safeToRun, true);
  assert.equal(workflow.classification, "non_commercial");
  assert.equal(task.safeToRun, true);
  assert.equal(task.classification, "non_commercial");
  assert.ok(
    task.intent.descriptorSignals.every(
      (signal) => signal.classification === "internal",
    ),
  );
  db.close();
});

test("registered external descriptors need exact v2 binding and separate protected-action authority", () => {
  const db = createTestDatabase();
  const fixture = contractFixture("descriptor-binding");
  insertContract(db, fixture);
  activateContract(db, fixture);
  insertWorkflow(db, fixture, {
    id: "workflow-descriptor-binding",
    metadata: JSON.stringify({
      commercialTestContract: fixture.binding,
      tools: ["smtp_send"],
    }),
  });

  const protectedAction = classifyCommercialWorkflowSafety(
    db,
    "workflow-descriptor-binding",
  );
  assert.equal(protectedAction.safeToRun, false);
  assert.equal(
    protectedAction.code,
    "commercial_protected_action_required",
  );
  assert.equal(
    protectedAction.assessment.details.externalSpendCapCents,
    0,
  );
  assert.equal(
    commercialRouteGuard(db, {
      workflowId: "workflow-descriptor-binding",
    }).code,
    "commercial_protected_action_required",
  );

  const exactScopeMutations = {
    decisionHash: sha256("different-commercial-decision"),
    offerId: `${fixture.binding.offerId}.different`,
    offerVersion: `${fixture.binding.offerVersion}.different`,
    offerHash: sha256("different-offer"),
    offerSku: `${fixture.binding.offerSku}.different`,
    experimentId: `${fixture.binding.experimentId}.different`,
    experimentVersion: `${fixture.binding.experimentVersion}.different`,
    cohortId: `${fixture.binding.cohortId}.different`,
  };
  for (const [field, value] of Object.entries(exactScopeMutations)) {
    db.prepare("UPDATE workflows SET metadata = ? WHERE id = ?").run(
      JSON.stringify({
        commercialTestContract: {
          ...fixture.binding,
          [field]: value,
        },
        tools: ["smtp_send"],
      }),
      "workflow-descriptor-binding",
    );
    const safety = classifyCommercialWorkflowSafety(
      db,
      "workflow-descriptor-binding",
    );
    assert.equal(safety.safeToRun, false, field);
    assert.equal(safety.code, "commercial_binding_mismatch", field);
  }
  db.close();
});

test("commercial intent outranks proof flags while only exact internal assurance exceptions remain safe", () => {
  const db = createTestDatabase();
  const fixture = contractFixture("intent-order");
  insertContract(db, fixture);
  activateContract(db, fixture);
  const adversarial = [
    {
      id: "workflow-commercial-proof",
      type: "commercial_proof",
      title: "Commercial proof",
      metadata: { systemProof: true },
    },
    {
      id: "workflow-buyer-intent-proof",
      type: "buyer_intent_proof",
      title: "Buyer-intent proof",
      metadata: { proofMode: true },
    },
    {
      id: "workflow-product-pilot",
      type: "product_pilot",
      title: "Product pilot",
      metadata: { diagnosticOnly: true },
    },
    {
      id: "workflow-explicit-commercial",
      type: "runtime_assurance",
      title: "Runtime assurance",
      metadata: { systemProof: true, commercial: true },
    },
    {
      id: "workflow-runtime-product-pilot",
      type: "runtime_assurance",
      title: "Product pilot runtime proof",
      metadata: { systemProof: true },
    },
    {
      id: "workflow-runtime-commercial-tool",
      type: "runtime_assurance",
      title: "Database runtime assurance",
      metadata: { systemProof: true, tools: ["twilio_call"] },
    },
    {
      id: "workflow-runtime-commercial-note",
      type: "runtime_assurance",
      title: "Database runtime assurance",
      metadata: {
        systemProof: true,
        operatorNote: "Call buyers with a voice AI and send the offer.",
      },
    },
  ];
  for (const workflow of adversarial) {
    insertWorkflow(db, null, {
      ...workflow,
      metadata: JSON.stringify(workflow.metadata),
    });
    const safety = classifyCommercialWorkflowSafety(db, workflow.id);
    assert.equal(safety.safeToRun, false, workflow.id);
    assert.equal(safety.requiresCommercialAuthority, true, workflow.id);
    assert.equal(safety.code, "commercial_binding_required", workflow.id);
  }

  insertWorkflow(db, null, {
    id: "workflow-real-runtime-assurance",
    type: "runtime_assurance",
    title: "Database recovery integrity assurance",
    metadata: JSON.stringify({ systemProof: true }),
  });
  const runtimeAssurance = classifyCommercialWorkflowSafety(
    db,
    "workflow-real-runtime-assurance",
  );
  assert.equal(runtimeAssurance.safeToRun, true);
  assert.equal(runtimeAssurance.classification, "diagnostic");

  insertWorkflow(db, null, {
    id: "workflow-runtime-assurance-with-extra",
    type: "runtime_assurance",
    title: "Database recovery integrity assurance",
    metadata: JSON.stringify({
      systemProof: true,
      tools: ["runtime_state"],
    }),
  });
  const assuranceWithExtra = classifyCommercialWorkflowSafety(
    db,
    "workflow-runtime-assurance-with-extra",
  );
  assert.equal(assuranceWithExtra.safeToRun, true);
  assert.equal(assuranceWithExtra.classification, "non_commercial");

  insertWorkflow(db, null, {
    id: "workflow-runtime-assurance-unknown-effect",
    type: "runtime_assurance",
    title: "Database recovery integrity assurance",
    metadata: JSON.stringify({
      systemProof: true,
      externalEffects: [{ type: "unregistered_runtime_effect" }],
    }),
  });
  const assuranceWithUnknownEffect = classifyCommercialWorkflowSafety(
    db,
    "workflow-runtime-assurance-unknown-effect",
  );
  assert.equal(assuranceWithUnknownEffect.safeToRun, false);
  assert.equal(
    assuranceWithUnknownEffect.code,
    "commercial_execution_descriptor_unknown",
  );

  const seededMetadata = seededDryRunMetadata();
  insertWorkflow(db, null, {
    id: "wf-digital-product-pilot-proof",
    type: "digital_product_publish",
    title: "Digital product pilot proof",
    metadata: JSON.stringify(seededMetadata),
  });
  db.prepare("UPDATE workflows SET venture_id = ? WHERE id = ?").run(
    "venture-digital-products",
    "wf-digital-product-pilot-proof",
  );
  const exactSeed = classifyCommercialWorkflowSafety(
    db,
    "wf-digital-product-pilot-proof",
  );
  assert.equal(exactSeed.safeToRun, true);
  assert.equal(exactSeed.classification, "diagnostic");

  db.prepare(`
    INSERT INTO tasks
    (id, workflow_id, venture_id, title, kind, agent, approval_id, max_retries,
     payload)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    "task-digital-product-dry-run",
    "wf-digital-product-pilot-proof",
    "venture-digital-products",
    "Prepare digital product listing and delivery plan in dry-run mode",
    "publish_digital_product_dry_run",
    "publisher",
    "appr-digital-product-dry-run",
    2,
    JSON.stringify({ integration: "digital-products", mode: "dry-run" }),
  );
  const exactSeedTask = classifyCommercialTaskSafety(
    db,
    "task-digital-product-dry-run",
  );
  assert.equal(exactSeedTask.safeToRun, true);
  assert.equal(exactSeedTask.classification, "diagnostic");

  const exactSeedWorkflowRow = db.prepare(
    "SELECT * FROM workflows WHERE id = ?",
  ).get("wf-digital-product-pilot-proof");
  const exactSeedTaskRow = db.prepare(
    "SELECT * FROM tasks WHERE id = ?",
  ).get("task-digital-product-dry-run");
  assert.throws(
    () => prepareSeededDryRunExecutionContract(
      exactSeedTaskRow,
      exactSeedWorkflowRow,
      { dryRun: false },
    ),
    (error) => {
      assert.equal(
        error.code,
        "seeded_dry_run_execution_contract_mismatch",
      );
      return true;
    },
  );
  const seededExecution = prepareSeededDryRunExecutionContract(
    exactSeedTaskRow,
    exactSeedWorkflowRow,
    { dryRun: true },
  );
  assert.equal(
    seededExecution.schema,
    SEEDED_DRY_RUN_EXECUTION_CONTRACT_SCHEMA,
  );
  assert.equal(seededExecution.externalEffectsAllowed, false);
  assert.deepEqual(seededExecution.options, { dryRun: true });
  const seededResult = seededExecution.execute();
  assert.equal(seededResult.provider, "digital-products");
  assert.equal(seededResult.mode, "dry-run");
  assert.equal(seededResult.products.length, 2);
  assert.throws(
    () => seededExecution.execute(),
    (error) => {
      assert.equal(
        error.code,
        "seeded_dry_run_execution_contract_consumed",
      );
      return true;
    },
  );

  db.prepare("UPDATE tasks SET payload = ? WHERE id = ?").run(
    JSON.stringify({
      integration: "digital-products",
      mode: "dry-run",
      tools: ["runtime_state"],
    }),
    "task-digital-product-dry-run",
  );
  const taskWithExtraInternalCapability = classifyCommercialTaskSafety(
    db,
    "task-digital-product-dry-run",
  );
  assert.equal(taskWithExtraInternalCapability.safeToRun, false);
  assert.equal(
    taskWithExtraInternalCapability.code,
    "commercial_binding_required",
  );

  db.prepare("UPDATE tasks SET payload = ? WHERE id = ?").run(
    JSON.stringify({
      integration: "digital-products",
      mode: "dry-run",
      externalEffects: [{ type: "unregistered_seed_effect" }],
    }),
    "task-digital-product-dry-run",
  );
  const taskWithUnknownEffect = classifyCommercialTaskSafety(
    db,
    "task-digital-product-dry-run",
  );
  assert.equal(taskWithUnknownEffect.safeToRun, false);
  assert.equal(
    taskWithUnknownEffect.code,
    "commercial_execution_descriptor_unknown",
  );

  for (const metadata of [
    {
      ...seededDryRunMetadata(),
      tools: ["runtime_state"],
    },
    {
      ...seededDryRunMetadata(),
      products: [{
        sku: "substitute",
        product: "Substitute",
        marginCents: 0,
      }],
    },
    {
      ...seededDryRunMetadata(),
      sourceFiles: ["deliverables/digital-products/substitute.md"],
    },
  ]) {
    db.prepare("UPDATE workflows SET metadata = ? WHERE id = ?").run(
      JSON.stringify(metadata),
      "wf-digital-product-pilot-proof",
    );
    const mutatedSeed = classifyCommercialWorkflowSafety(
      db,
      "wf-digital-product-pilot-proof",
    );
    assert.equal(mutatedSeed.safeToRun, false);
    assert.equal(mutatedSeed.code, "commercial_binding_required");
  }
  db.prepare("UPDATE workflows SET metadata = ? WHERE id = ?").run(
    JSON.stringify(seededDryRunMetadata()),
    "wf-digital-product-pilot-proof",
  );

  db.prepare("UPDATE workflows SET title = ? WHERE id = ?").run(
    "Digital product pilot proof copy",
    "wf-digital-product-pilot-proof",
  );
  const nearCopy = classifyCommercialWorkflowSafety(
    db,
    "wf-digital-product-pilot-proof",
  );
  assert.equal(nearCopy.safeToRun, false);
  assert.equal(nearCopy.code, "commercial_binding_required");
  db.close();
});

test("terminal bindings remain unsafe in workflow classification", () => {
  const db = createTestDatabase();
  const fixture = contractFixture("terminal-classification");
  insertContract(db, fixture);
  activateContract(db, fixture);
  insertLifecycle(db, fixture, "stopped", "2026-07-29T04:00:00.000Z");
  insertWorkflow(db, fixture, {
    id: "workflow-terminal",
    type: "commercial_proof",
    title: "Stopped commercial proof",
  });

  const classification = classifyCommercialWorkflowSafety(
    db,
    "workflow-terminal",
  );
  assert.equal(classification.safeToRun, false);
  assert.equal(classification.statusCode, 410);
  assert.equal(classification.code, "commercial_program_terminal");
  db.close();
});

test("seeded dry-run execution cannot be redirected by an adapter cache substitution", () => {
  const script = String.raw`
    const adapterPath = require.resolve("./src/adapters/digital-products");
    let replacementInvoked = false;
    require.cache[adapterPath] = {
      id: adapterPath,
      filename: adapterPath,
      loaded: true,
      exports: {
        createDigitalProductDraft: async () => {
          replacementInvoked = true;
          return {
            provider: "substituted-adapter",
            mode: "live",
            externalEffectAttempted: true,
          };
        },
      },
    };

    const { decideApproval } = require("./src/runtime/approvals");
    const { runOnce } = require("./src/runtime/orchestrator");
    const { get, openDatabase, seedDatabase } = require("./src/db");

    (async () => {
      const db = openDatabase(":memory:");
      seedDatabase(db, { includeDemoProof: true });
      decideApproval(
        db,
        "appr-digital-product-dry-run",
        "approved",
        "child-process integrity proof",
      );
      const result = await runOnce(db, {
        taskId: "task-digital-product-dry-run",
      });
      const cost = get(
        db,
        "SELECT source, status, amount_cents FROM costs WHERE workflow_id = ? ORDER BY occurred_at DESC LIMIT 1",
        ["wf-digital-product-pilot-proof"],
      );
      const attempts = get(
        db,
        "SELECT COUNT(*) AS count FROM task_attempts WHERE task_id = ?",
        ["task-digital-product-dry-run"],
      ).count;
      process.stdout.write(JSON.stringify({
        status: result.status,
        provider: result.result?.provider || null,
        mode: result.result?.mode || null,
        externalEffectAttempted:
          result.result?.externalEffectAttempted === true,
        replacementInvoked,
        cost,
        attempts,
      }));
      db.close();
    })().catch((error) => {
      process.stderr.write(error.stack || error.message);
      process.exitCode = 1;
    });
  `;
  const child = spawnSync(process.execPath, ["-e", script], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: process.env,
    maxBuffer: 1024 * 1024,
  });
  assert.equal(
    child.status,
    0,
    `child process failed: ${child.stderr || child.stdout}`,
  );
  const result = JSON.parse(child.stdout.trim());
  assert.equal(result.status, "completed");
  assert.equal(result.provider, "digital-products");
  assert.equal(result.mode, "dry-run");
  assert.equal(result.externalEffectAttempted, false);
  assert.equal(result.replacementInvoked, false);
  assert.equal(result.attempts, 1);
  assert.deepEqual(result.cost, {
    source: "digital-products",
    status: "estimated",
    amount_cents: 0,
  });
});

test("route errors have a small stable payload", () => {
  const db = createTestDatabase();
  const fixture = contractFixture("payload");
  const assessment = evaluateCommercialAuthority(db, { binding: fixture.binding });
  const payload = commercialAuthorityErrorPayload(assessment);

  assert.equal(assessment.code, "commercial_binding_mismatch");
  assert.deepEqual(payload, {
    error: assessment.message,
    code: "commercial_binding_mismatch",
    commercialAuthority: {
      schema: COMMERCIAL_AUTHORITY_SCHEMA,
      allowed: false,
      authorityStatus: "inactive",
      decisionHash: fixture.row.decisionHash,
      programId: fixture.row.programId,
    },
  });
  db.close();
});

test("tampered contract column and JSON identity makes authority unavailable", () => {
  const db = createTestDatabase();
  const fixture = contractFixture("tampered");
  insertContract(db, fixture, {
    contract: {
      ...fixture.contract,
      programId: "different-program",
    },
  });
  activateContract(db, fixture);

  const state = getCommercialAuthorityState(db);
  assert.equal(state.status, "invalid");
  assert.match(state.issues.join(" "), /contract_json\.programId/);
  const guard = commercialRouteGuard(db, { binding: fixture.binding });
  assert.equal(guard.allowed, false);
  assert.equal(guard.code, "commercial_authority_unavailable");
  db.close();
});

test("semantic decision-hash and unsupported-field contract tampering fail closed", () => {
  const cases = [
    {
      suffix: "semantic-hash",
      mutate: (contract) => ({
        ...contract,
        buyer: "A materially different buyer hidden behind the old decision hash",
      }),
      issue: /decisionHash does not match/i,
    },
    {
      suffix: "unsupported-field",
      mutate: (contract) => ({
        ...contract,
        unsupportedAuthorityOverride: true,
      }),
      issue: /unsupported or non-normalized fields/i,
    },
  ];
  for (const item of cases) {
    const db = createTestDatabase();
    const fixture = contractFixture(item.suffix);
    insertContract(db, fixture, {
      contract: item.mutate(fixture.contract),
    });
    const state = getCommercialAuthorityState(db);
    assert.equal(state.status, "invalid", item.suffix);
    assert.match(state.issues.join(" "), item.issue, item.suffix);
    const guard = commercialRouteGuard(db, { binding: fixture.binding });
    assert.equal(guard.code, "commercial_authority_unavailable", item.suffix);
    db.close();
  }
});

test("forged lifecycle JSON, hashes, scope, sequence, and predecessor chains fail closed", () => {
  const cases = [
    {
      suffix: "forged-row-hash",
      build(db, fixture) {
        insertLifecycle(db, fixture, "proposed", "2026-07-29T00:00:00.000Z", {
          rowOverrides: { eventHash: sha256("forged-row-hash") },
        });
      },
      issue: /eventHash does not match/i,
    },
    {
      suffix: "forged-json",
      build(db, fixture) {
        insertLifecycle(db, fixture, "proposed", "2026-07-29T00:00:00.000Z", {
          jsonOverrides: { reason: "forged after hashing" },
        });
      },
      issue: /eventHash does not match/i,
    },
    {
      suffix: "unsupported-json",
      build(db, fixture) {
        insertLifecycle(db, fixture, "proposed", "2026-07-29T00:00:00.000Z", {
          jsonOverrides: { unsupportedAuthorityOverride: true },
        });
      },
      issue: /unsupported or non-normalized fields/i,
    },
    {
      suffix: "wrong-scope",
      build(db, fixture) {
        insertLifecycle(db, fixture, "proposed", "2026-07-29T00:00:00.000Z");
        insertLifecycle(db, fixture, "accepted", "2026-07-29T00:00:01.000Z", {
          approvalScopeHash: sha256("arbitrary-approval-scope"),
        });
      },
      issue: /does not bind the exact commercial scope/i,
    },
    {
      suffix: "rejected-approval",
      build(db, fixture) {
        insertLifecycle(db, fixture, "proposed", "2026-07-29T00:00:00.000Z");
        insertLifecycle(db, fixture, "accepted", "2026-07-29T00:00:01.000Z", {
          approvalStatus: "rejected",
        });
      },
      issue: /not backed by an approved decision/i,
    },
    {
      suffix: "approval-ledger-scope",
      build(db, fixture) {
        insertLifecycle(db, fixture, "proposed", "2026-07-29T00:00:00.000Z");
        insertLifecycle(db, fixture, "accepted", "2026-07-29T00:00:01.000Z", {
          approvalLedgerScopeHash: sha256("wrong-ledger-scope"),
        });
      },
      issue: /does not match its approval ledger scope/i,
    },
    {
      suffix: "sequence-gap",
      build(db, fixture) {
        insertLifecycle(db, fixture, "proposed", "2026-07-29T00:00:00.000Z");
        insertLifecycle(db, fixture, "activated", "2026-07-29T00:00:01.000Z", {
          sequence: 2,
        });
      },
      issue: /contiguous from zero/i,
    },
    {
      suffix: "wrong-predecessor",
      build(db, fixture) {
        insertLifecycle(db, fixture, "proposed", "2026-07-29T00:00:00.000Z");
        insertLifecycle(db, fixture, "accepted", "2026-07-29T00:00:01.000Z", {
          rowOverrides: { previousEventHash: sha256("wrong-predecessor") },
        });
      },
      issue: /previousEventHash does not match|does not bind the previous event hash/i,
    },
  ];
  for (const item of cases) {
    const db = createTestDatabase();
    const fixture = contractFixture(item.suffix);
    insertContract(db, fixture);
    item.build(db, fixture);
    const state = getCommercialAuthorityState(db);
    assert.equal(state.status, "invalid", item.suffix);
    assert.match(state.issues.join(" "), item.issue, item.suffix);
    const guard = commercialRouteGuard(db, { binding: fixture.binding });
    assert.equal(guard.code, "commercial_authority_unavailable", item.suffix);
    db.close();
  }
});
