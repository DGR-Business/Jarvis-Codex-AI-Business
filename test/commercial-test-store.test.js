"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { Worker } = require("node:worker_threads");

const {
  get,
  now,
  openDatabase,
  run,
  seedDatabase,
} = require("../src/db");
const {
  COST_CATEGORIES,
  OPERATOR_ROLE,
  PROTECTED_ACTION_KEYS,
  createCommercialTestContract,
  offerDefinitionHash,
  pseudonymizeBuyer,
  sha256,
  sourceCoverageHash,
} = require("../src/runtime/commercial-test-contract");
const {
  commercialLifecycleApprovalScope,
  commercialLifecycleApprovalScopeHash,
  getCommercialAuthorityState,
} = require("../src/runtime/commercial-authority");
const {
  COMMERCIAL_TEST_STORE_COLUMNS,
  CommercialTestStoreError,
  createCommercialTestStore,
} = require("../src/runtime/commercial-test-store");
const {
  ensureVentureKitRegistry,
  getVentureKit,
} = require("../src/runtime/venture-kit-registry");

const BUYER_SECRET = "test-only-store-buyer-hmac-secret";
const PERIOD = Object.freeze({
  startsAt: "2026-08-01T00:00:00.000Z",
  endsAt: "2026-08-31T23:59:59.999Z",
});
const STORE_TIME = "2026-09-03T00:00:00.000Z";

function protectedActions() {
  return Object.fromEntries(PROTECTED_ACTION_KEYS.map((key) => [key, true]));
}

function offer(overrides = {}) {
  const definition = {
    id: "offer.scope_guard_kit",
    version: "1.0.0",
    sku: "scope_guard_kit_aud_29",
    description: "Low-touch client approval and scope guard kit",
    contentHash: sha256("scope-guard-kit-content-v1"),
    ...overrides,
  };
  return { ...definition, hash: offerDefinitionHash(definition) };
}

function contractInput(kit, overrides = {}) {
  const accountHash = sha256("marketplace-account-safe-reference");
  const base = {
    programId: "program.low_touch_kit",
    programVersion: "1.0.0",
    testId: "test.first_buyer_cash_proof",
    testVersion: "2.0.0",
    ventureId: "venture.store_test",
    ventureKit: {
      id: kit.id,
      version: kit.version,
      hash: kit.contentHash,
    },
    offerId: "offer.scope_guard_kit",
    offer: offer(),
    buyer: "Independent social media managers with retained clients",
    problem: "Client approvals and scope changes are fragmented and hard to evidence",
    experiment: {
      id: "experiment.first_buyer_cash_proof",
      version: "1.0.0",
      hypothesis: "The exact buyer will pay A$29 for the defined low-touch kit",
      primaryMetric: "positive_independent_settled_buyers",
      deadlineAt: "2026-09-02T00:00:00.000Z",
    },
    cohort: {
      id: "cohort.first_buyer_cash_proof",
      definition: "Buyers exposed to only the approved marketplace listing",
    },
    reportingPeriod: PERIOD,
    channel: {
      id: "marketplace_alpha",
      providerNamespace: "marketplace_alpha",
      accountHash,
      adapter: {
        id: "marketplace_adapter",
        version: "2.0.0",
        hash: sha256("marketplace-adapter-v2"),
      },
    },
    price: {
      currency: "AUD",
      amountMinorUnits: 2900,
      amountAudCents: 2900,
    },
    buyerIdentity: {
      method: "hmac_sha256",
      keyId: "buyer_hmac_key",
      keyVersion: 1,
      independenceBasis: "platform_buyer_account",
    },
    protectedActions: protectedActions(),
    attributionRules: {
      method: "last_qualified_touch",
      window: PERIOD,
      allowedTouchpoints: ["campaign_id", "listing_id"],
      requiredTouchpoints: ["listing_id"],
      unresolvedOutcome: "inconclusive",
    },
    evidenceRules: {
      acceptedSourceKinds: ["imported_platform", "operator_attested_manual"],
      requiredCostCategories: COST_CATEGORIES,
      requiredSources: [{
        id: "platform_settlement_records",
        acceptedKinds: ["imported_platform", "operator_attested_manual"],
        providerNamespace: "marketplace_alpha",
        accountHash,
        sourceSystem: "marketplace_settlement",
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
  };
  return { ...base, ...overrides };
}

function createVenture(db, id) {
  const timestamp = now();
  run(
    db,
    `INSERT OR IGNORE INTO ventures
     (id, name, stage, status, summary, metadata, created_at, updated_at)
     VALUES (?, ?, 1, 'active', '', '{}', ?, ?)`,
    [id, id, timestamp, timestamp],
  );
}

function createRuntime(name) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `pantheon-commercial-store-${name}-`));
  const dbPath = path.join(root, "runtime.sqlite");
  const db = openDatabase(dbPath);
  seedDatabase(db);
  ensureVentureKitRegistry(db);
  createVenture(db, "venture.store_test");
  const kit = getVentureKit(db, "digital_product_v1", 1);
  let verifierResult = true;
  const store = createCommercialTestStore(db, {
    clock: () => STORE_TIME,
    verifyImportedReceipt: () => verifierResult,
    pseudonymizeBuyer: (contract, buyerReference) => (
      pseudonymizeBuyer(contract, buyerReference, BUYER_SECRET)
    ),
  });
  return {
    db,
    dbPath,
    root,
    kit,
    store,
    setVerifierResult(value) {
      verifierResult = value;
    },
  };
}

function closeRuntime(runtime) {
  runtime.db.close();
  fs.rmSync(runtime.root, { recursive: true, force: true });
}

function buildContract(runtime, overrides = {}) {
  return createCommercialTestContract(contractInput(runtime.kit, overrides));
}

function createApproval(db, contract, eventType, id, options = {}) {
  const scope = commercialLifecycleApprovalScope(contract, eventType);
  const scopeHash = commercialLifecycleApprovalScopeHash(contract, eventType);
  run(
    db,
    `INSERT INTO approvals
     (id, scope, scope_hash, title, status, risk_level, requested_by,
      requested_at, decided_at, decision_note, payload)
     VALUES (?, ?, ?, ?, 'approved', 'high', 'jarvis', ?, ?, 'Approved for test.', ?)`,
    [
      id,
      canonicalJson(scope),
      scopeHash,
      `${eventType} commercial test`,
      options.requestedAt || "2026-07-30T00:00:00.000Z",
      options.decidedAt || "2026-07-30T00:01:00.000Z",
      canonicalJson({ commercialTestApprovalScope: scope }),
    ],
  );
  return { id, scope, scopeHash };
}

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

function activate(runtime, contract, prefix = "primary") {
  runtime.store.appendLifecycle(contract.decisionHash, {
    eventId: `${prefix}_proposed`,
    eventType: "proposed",
    reason: "Prepared for exact owner review.",
    occurredAt: "2026-07-30T00:00:00.000Z",
  });
  const accepted = createApproval(
    runtime.db,
    contract,
    "accepted",
    `${prefix}_approval_accept`,
  );
  runtime.store.appendLifecycle(contract.decisionHash, {
    eventId: `${prefix}_accepted`,
    eventType: "accepted",
    approvalId: accepted.id,
    approvalScope: accepted.scope,
    reason: "Owner accepted the exact commercial decision.",
    occurredAt: "2026-07-30T00:02:00.000Z",
  });
  const activated = createApproval(
    runtime.db,
    contract,
    "activated",
    `${prefix}_approval_activate`,
  );
  runtime.store.appendLifecycle(contract.decisionHash, {
    eventId: `${prefix}_activated`,
    eventType: "activated",
    approvalId: activated.id,
    approvalScope: activated.scope,
    reason: "Owner activated the exact commercial test.",
    occurredAt: "2026-07-30T00:03:00.000Z",
  });
}

function pauseProgram(runtime, contract, prefix = "primary") {
  activate(runtime, contract, prefix);
  runtime.store.appendLifecycle(contract.decisionHash, {
    eventId: `${prefix}_paused`,
    eventType: "paused",
    reason: "The owner paused the exact commercial test.",
    occurredAt: "2026-07-30T00:04:00.000Z",
  });
}

function appendLifecycleInWorker(runtime, input) {
  const workerSource = `
    "use strict";
    const { parentPort, workerData } = require("node:worker_threads");
    const { openDatabase } = require(workerData.dbModule);
    const { createCommercialTestStore } = require(workerData.storeModule);
    let db;
    try {
      db = openDatabase(workerData.dbPath);
      const store = createCommercialTestStore(db);
      const result = store.appendLifecycle(workerData.decisionHash, workerData.input);
      parentPort.postMessage({ ok: true, eventId: result.event.id });
    } catch (error) {
      parentPort.postMessage({
        ok: false,
        code: error && error.code ? error.code : null,
        message: error && error.message ? error.message : String(error),
      });
    } finally {
      if (db) db.close();
    }
  `;
  return new Promise((resolve, reject) => {
    const worker = new Worker(workerSource, {
      eval: true,
      workerData: {
        dbModule: require.resolve("../src/db"),
        storeModule: require.resolve("../src/runtime/commercial-test-store"),
        dbPath: runtime.dbPath,
        decisionHash: input.decisionHash,
        input: input.lifecycle,
      },
    });
    let completed = false;
    worker.once("message", (message) => {
      completed = true;
      resolve(message);
    });
    worker.once("error", reject);
    worker.once("exit", (code) => {
      if (!completed && code !== 0) {
        reject(new Error(`Lifecycle worker exited with code ${code}.`));
      }
    });
  });
}

function coverage(kind, sourceHash, receiptHash, declaredRowCount = 1) {
  const basis = kind === "imported_platform"
    ? "unfiltered_full_reporting_period"
    : "single_retained_source";
  return {
    basis,
    declaredRowCount,
    controlHash: sourceCoverageHash({
      basis,
      declaredRowCount,
      reportingPeriod: PERIOD,
      sourceHash,
      receiptHash,
    }),
  };
}

function importedSource(contract, token, overrides = {}) {
  const sourceHash = overrides.sourceHash || sha256(`source-${token}`);
  const receiptHash = overrides.receiptHash || sha256(`receipt-${token}`);
  return {
    kind: "imported_platform",
    sourceId: "platform_settlement_records",
    providerNamespace: contract.channel.providerNamespace,
    accountHash: contract.channel.accountHash,
    sourceSystem: "marketplace_settlement",
    exportType: "settlement_record_v2",
    sourceHash,
    sourceRowHash: overrides.sourceRowHash || sha256(`row-${token}`),
    receipt: {
      id: overrides.receiptId || `receipt_${token}`,
      hash: receiptHash,
      locationReference: `retained_${token}`,
    },
    verificationStatus: overrides.verificationStatus || "pending",
    reportingPeriod: PERIOD,
    capturedAt: overrides.capturedAt || "2026-09-01T00:02:00.000Z",
    generatedAt: "2026-09-01T00:00:00.000Z",
    importedAt: "2026-09-01T00:01:00.000Z",
    importBatchId: `batch_${token}`,
    coverage: coverage(
      "imported_platform",
      sourceHash,
      receiptHash,
      overrides.declaredRowCount || 1,
    ),
  };
}

function manualSource(contract, token, overrides = {}) {
  const sourceHash = overrides.sourceHash || sha256(`manual-source-${token}`);
  const receiptHash = overrides.receiptHash || sha256(`manual-receipt-${token}`);
  return {
    kind: "operator_attested_manual",
    sourceId: "platform_settlement_records",
    providerNamespace: contract.channel.providerNamespace,
    accountHash: contract.channel.accountHash,
    sourceSystem: "marketplace_settlement",
    exportType: "settlement_record_v2",
    sourceHash,
    sourceRowHash: overrides.sourceRowHash || sha256(`manual-row-${token}`),
    receipt: {
      id: overrides.receiptId || `manual_receipt_${token}`,
      hash: receiptHash,
      locationReference: `manual_retained_${token}`,
    },
    verificationStatus: overrides.verificationStatus || "pending",
    reportingPeriod: PERIOD,
    capturedAt: overrides.capturedAt || "2026-09-01T00:03:00.000Z",
    manualReferenceHash: sha256(`manual-reference-${token}`),
    attestedBy: "jarvis_operator",
    attestationNote: "Matched against the exact retained settlement receipt.",
    entryReason: "A structured platform import was unavailable for this record.",
    coverage: coverage("operator_attested_manual", sourceHash, receiptHash),
  };
}

function attribution(contract) {
  return {
    status: "attributed",
    channelId: contract.channel.id,
    providerNamespace: contract.channel.providerNamespace,
    accountHash: contract.channel.accountHash,
    adapter: contract.channel.adapter,
    touchpoints: [{
      type: "listing_id",
      referenceHash: sha256("listing-scope-guard-kit-v1"),
    }],
  };
}

function nativeAud(cents) {
  return {
    currency: "AUD",
    originalMinorUnits: cents,
    audCents: cents,
    conversion: {
      kind: "native_aud",
      minorUnitExponent: 2,
    },
  };
}

function transactionInput(contract, number, overrides = {}) {
  const day = String(number).padStart(2, "0");
  return {
    evidenceId: overrides.evidenceId || `evidence_transaction_${number}`,
    evidenceVersion: "1.0.0",
    kind: "transaction",
    attribution: attribution(contract),
    buyerReference: overrides.buyerReference || `buyer-${number}@example.test`,
    transaction: {
      rawTransactionId:
        overrides.rawTransactionId || `provider-transaction-secret-${number}`,
      eventType: "original",
      chain: {
        sequence: 0,
        predecessorRecordHash: null,
        reversesRecordHash: null,
      },
      status: overrides.status || "settled",
      occurredAt: `2026-08-${day}T00:00:00.000Z`,
      settledAt: overrides.settledAt === undefined
        ? `2026-08-${day}T01:00:00.000Z`
        : overrides.settledAt,
      settlement: overrides.settlement || {
        state: "cash_settled",
        referenceHash: sha256(`cash-settlement-${number}`),
      },
      grossRevenue: nativeAud(overrides.grossCents ?? 2900),
      refunds: nativeAud(overrides.refundCents ?? 0),
    },
  };
}

function costInput(contract, category, cents = 0) {
  return {
    evidenceId: `evidence_cost_${category}`,
    evidenceVersion: "1.0.0",
    kind: "cost",
    attribution: attribution(contract),
    cost: {
      rawCostId: `provider-cost-secret-${category}`,
      eventType: "original",
      chain: {
        sequence: 0,
        predecessorRecordHash: null,
        reversesRecordHash: null,
      },
      category,
      state: "reconciled",
      occurredAt: "2026-08-31T00:00:00.000Z",
      amount: nativeAud(cents),
    },
  };
}

function transactionRevisionInput(contract, predecessor, sequence, overrides = {}) {
  return {
    evidenceId: overrides.evidenceId || `evidence_transaction_revision_${sequence}`,
    evidenceVersion: "1.0.0",
    kind: "transaction",
    attribution: attribution(contract),
    buyerReference: overrides.buyerReference || "buyer-1@example.test",
    transaction: {
      rawTransactionId:
        overrides.rawTransactionId || "provider-transaction-secret-1",
      eventType: overrides.eventType || "correction",
      chain: {
        sequence,
        predecessorRecordHash: predecessor.recordHash,
        reversesRecordHash: overrides.reversesRecordHash || null,
      },
      status: overrides.status || "settled",
      occurredAt: predecessor.transaction.occurredAt,
      settledAt: predecessor.transaction.settledAt,
      settlement: predecessor.transaction.settlement,
      grossRevenue: nativeAud(overrides.grossCents ?? 3000),
      refunds: nativeAud(overrides.refundCents ?? 0),
    },
  };
}

function usdMoney(originalMinorUnits, audCents) {
  return {
    currency: "USD",
    originalMinorUnits,
    audCents,
    conversion: {
      kind: "fx",
      minorUnitExponent: 2,
      rateNumerator: 3,
      rateDenominator: 2,
      rounding: "half_away_from_zero",
      source: {
        provider: "rba_reference",
        reference: "rba_2026_08_01",
        sourceHash: sha256("retained-rba-reference"),
        observedAt: "2026-08-01T00:00:00.000Z",
      },
    },
  };
}

function ingest(runtime, contract, source, record) {
  return runtime.store.ingestEvidenceBatch(contract.decisionHash, {
    source,
    verificationMaterial: { retainedFixture: true },
    records: [record],
  });
}

function assertStoreError(action, code) {
  assert.throws(action, (error) => (
    error instanceof CommercialTestStoreError && error.code === code
  ));
}

test("store column contract stays explicit and contract registration binds an immutable kit", () => {
  const runtime = createRuntime("contract");
  try {
    assert.ok(COMMERCIAL_TEST_STORE_COLUMNS.contracts.includes("offer_hash"));
    assert.ok(COMMERCIAL_TEST_STORE_COLUMNS.receipts.includes("coverage_control_hash"));
    assert.ok(COMMERCIAL_TEST_STORE_COLUMNS.evidence.includes("settlement_reference_hash"));
    assert.ok(COMMERCIAL_TEST_STORE_COLUMNS.evaluations.includes("evaluation_hash"));

    const contract = buildContract(runtime);
    assert.deepEqual(runtime.store.registerContract(contract), {
      created: true,
      contract,
    });
    assert.deepEqual(runtime.store.registerContract(contract), {
      created: false,
      contract,
    });
    assert.deepEqual(runtime.store.getContract(contract.decisionHash), contract);

    const wrongKitContract = buildContract(runtime, {
      programId: "program.wrong_kit",
      testId: "test.wrong_kit",
      ventureKit: {
        id: runtime.kit.id,
        version: runtime.kit.version,
        hash: sha256("not-the-registered-kit"),
      },
      experiment: {
        ...contractInput(runtime.kit).experiment,
        id: "experiment.wrong_kit",
      },
    });
    assertStoreError(
      () => runtime.store.registerContract(wrongKitContract),
      "commercial_venture_kit_hash_mismatch",
    );
  } finally {
    closeRuntime(runtime);
  }
});

test("lifecycle requires exact accepted and activated approvals and permits only one active program", () => {
  const runtime = createRuntime("lifecycle");
  try {
    const contract = buildContract(runtime);
    runtime.store.registerContract(contract);
    runtime.store.appendLifecycle(contract.decisionHash, {
      eventId: "lifecycle_proposed",
      eventType: "proposed",
      occurredAt: "2026-07-30T00:00:00.000Z",
    });
    assertStoreError(
      () => runtime.store.appendLifecycle(contract.decisionHash, {
        eventId: "lifecycle_unapproved_accept",
        eventType: "accepted",
        occurredAt: "2026-07-30T00:01:00.000Z",
      }),
      "commercial_approval_scope_mismatch",
    );
    const accepted = createApproval(runtime.db, contract, "accepted", "approval_exact_accept");
    runtime.store.appendLifecycle(contract.decisionHash, {
      eventId: "lifecycle_accepted",
      eventType: "accepted",
      approvalId: accepted.id,
      approvalScope: accepted.scope,
      occurredAt: "2026-07-30T00:02:00.000Z",
    });
    const activated = createApproval(runtime.db, contract, "activated", "approval_exact_activate");
    runtime.store.appendLifecycle(contract.decisionHash, {
      eventId: "lifecycle_activated",
      eventType: "activated",
      approvalId: activated.id,
      approvalScope: activated.scope,
      occurredAt: "2026-07-30T00:03:00.000Z",
    });
    assert.equal(runtime.store.readLedger(contract.decisionHash).state, "activated");

    runtime.store.appendLifecycle(contract.decisionHash, {
      eventId: "lifecycle_paused",
      eventType: "paused",
      occurredAt: "2026-07-30T00:04:00.000Z",
    });
    const direct = createApproval(runtime.db, contract, "activated", "approval_direct_reactivate");
    assertStoreError(
      () => runtime.store.appendLifecycle(contract.decisionHash, {
        eventId: "lifecycle_direct_reactivate",
        eventType: "activated",
        approvalId: direct.id,
        approvalScope: direct.scope,
        occurredAt: "2026-07-30T00:05:00.000Z",
      }),
      "commercial_lifecycle_transition_invalid",
    );

    createVenture(runtime.db, "venture.store_test_two");
    const second = buildContract(runtime, {
      programId: "program.second",
      testId: "test.second",
      ventureId: "venture.store_test_two",
      experiment: {
        ...contractInput(runtime.kit).experiment,
        id: "experiment.second",
      },
    });
    runtime.store.registerContract(second);
    activate(runtime, second, "second");
    assert.equal(runtime.store.readLedger(second.decisionHash).state, "activated");

    const reaccepted = createApproval(
      runtime.db,
      contract,
      "accepted",
      "approval_reaccept",
      { decidedAt: "2026-07-30T00:05:30.000Z" },
    );
    runtime.store.appendLifecycle(contract.decisionHash, {
      eventId: "lifecycle_reaccepted",
      eventType: "accepted",
      approvalId: reaccepted.id,
      approvalScope: reaccepted.scope,
      occurredAt: "2026-07-30T00:06:00.000Z",
    });
    const reactivate = createApproval(
      runtime.db,
      contract,
      "activated",
      "approval_reactivate",
      { decidedAt: "2026-07-30T00:06:30.000Z" },
    );
    assertStoreError(
      () => runtime.store.appendLifecycle(contract.decisionHash, {
        eventId: "lifecycle_reactivate",
        eventType: "activated",
        approvalId: reactivate.id,
        approvalScope: reactivate.scope,
        occurredAt: "2026-07-30T00:07:00.000Z",
      }),
      "commercial_program_already_active",
    );
  } finally {
    closeRuntime(runtime);
  }
});

test("a paused program cannot replay its original acceptance approval", () => {
  const runtime = createRuntime("acceptance-replay");
  try {
    const contract = buildContract(runtime);
    runtime.store.registerContract(contract);
    pauseProgram(runtime, contract);
    assertStoreError(
      () => runtime.store.appendLifecycle(contract.decisionHash, {
        eventId: "replayed_original_acceptance",
        eventType: "accepted",
        approvalId: "primary_approval_accept",
        approvalScope: commercialLifecycleApprovalScope(contract, "accepted"),
        occurredAt: "2026-07-30T00:05:00.000Z",
      }),
      "commercial_approval_already_used",
    );
    assert.equal(runtime.store.readLedger(contract.decisionHash).state, "paused");
    assert.equal(get(
      runtime.db,
      `SELECT COUNT(*) AS count
       FROM commercial_test_lifecycle_events
       WHERE approval_id = 'primary_approval_accept'`,
    ).count, 1);
  } finally {
    closeRuntime(runtime);
  }
});

test("a fresh resumed acceptance cannot replay the original activation approval", () => {
  const runtime = createRuntime("activation-replay");
  try {
    const contract = buildContract(runtime);
    runtime.store.registerContract(contract);
    pauseProgram(runtime, contract);
    const accepted = createApproval(
      runtime.db,
      contract,
      "accepted",
      "fresh_resumed_acceptance",
      { decidedAt: "2026-07-30T00:04:30.000Z" },
    );
    runtime.store.appendLifecycle(contract.decisionHash, {
      eventId: "fresh_resumed_acceptance_event",
      eventType: "accepted",
      approvalId: accepted.id,
      approvalScope: accepted.scope,
      occurredAt: "2026-07-30T00:05:00.000Z",
    });
    assertStoreError(
      () => runtime.store.appendLifecycle(contract.decisionHash, {
        eventId: "replayed_original_activation",
        eventType: "activated",
        approvalId: "primary_approval_activate",
        approvalScope: commercialLifecycleApprovalScope(contract, "activated"),
        occurredAt: "2026-07-30T00:06:00.000Z",
      }),
      "commercial_approval_already_used",
    );
    assert.equal(runtime.store.readLedger(contract.decisionHash).state, "accepted");
  } finally {
    closeRuntime(runtime);
  }
});

test("unused approvals decided before a pause cannot resume either lifecycle gate", () => {
  const runtime = createRuntime("stale-resume");
  try {
    const contract = buildContract(runtime);
    runtime.store.registerContract(contract);
    activate(runtime, contract);
    const staleAcceptance = createApproval(
      runtime.db,
      contract,
      "accepted",
      "unused_pre_pause_acceptance",
      { decidedAt: "2026-07-30T00:03:30.000Z" },
    );
    const staleActivation = createApproval(
      runtime.db,
      contract,
      "activated",
      "unused_pre_pause_activation",
      { decidedAt: "2026-07-30T00:03:45.000Z" },
    );
    runtime.store.appendLifecycle(contract.decisionHash, {
      eventId: "stale_resume_paused",
      eventType: "paused",
      occurredAt: "2026-07-30T00:04:00.000Z",
    });
    assertStoreError(
      () => runtime.store.appendLifecycle(contract.decisionHash, {
        eventId: "stale_resume_acceptance",
        eventType: "accepted",
        approvalId: staleAcceptance.id,
        approvalScope: staleAcceptance.scope,
        occurredAt: "2026-07-30T00:05:00.000Z",
      }),
      "commercial_approval_stale_after_pause",
    );

    const freshAcceptance = createApproval(
      runtime.db,
      contract,
      "accepted",
      "fresh_after_pause_acceptance",
      { decidedAt: "2026-07-30T00:04:30.000Z" },
    );
    runtime.store.appendLifecycle(contract.decisionHash, {
      eventId: "fresh_after_pause_acceptance_event",
      eventType: "accepted",
      approvalId: freshAcceptance.id,
      approvalScope: freshAcceptance.scope,
      occurredAt: "2026-07-30T00:05:10.000Z",
    });
    assertStoreError(
      () => runtime.store.appendLifecycle(contract.decisionHash, {
        eventId: "stale_resume_activation",
        eventType: "activated",
        approvalId: staleActivation.id,
        approvalScope: staleActivation.scope,
        occurredAt: "2026-07-30T00:06:00.000Z",
      }),
      "commercial_approval_stale_after_pause",
    );
    assert.equal(runtime.store.readLedger(contract.decisionHash).state, "accepted");
  } finally {
    closeRuntime(runtime);
  }
});

test("fresh post-pause acceptance and activation approvals reactivate exactly once", () => {
  const runtime = createRuntime("fresh-reactivation");
  try {
    const contract = buildContract(runtime);
    runtime.store.registerContract(contract);
    pauseProgram(runtime, contract);
    const accepted = createApproval(
      runtime.db,
      contract,
      "accepted",
      "fresh_reactivation_acceptance",
      { decidedAt: "2026-07-30T00:04:30.000Z" },
    );
    runtime.store.appendLifecycle(contract.decisionHash, {
      eventId: "fresh_reactivation_acceptance_event",
      eventType: "accepted",
      approvalId: accepted.id,
      approvalScope: accepted.scope,
      occurredAt: "2026-07-30T00:05:00.000Z",
    });
    const activated = createApproval(
      runtime.db,
      contract,
      "activated",
      "fresh_reactivation_activation",
      { decidedAt: "2026-07-30T00:05:30.000Z" },
    );
    runtime.store.appendLifecycle(contract.decisionHash, {
      eventId: "fresh_reactivation_activation_event",
      eventType: "activated",
      approvalId: activated.id,
      approvalScope: activated.scope,
      occurredAt: "2026-07-30T00:06:00.000Z",
    });
    assert.equal(runtime.store.readLedger(contract.decisionHash).state, "activated");
    assert.equal(getCommercialAuthorityState(runtime.db).status, "active");
  } finally {
    closeRuntime(runtime);
  }
});

test("competing resumed acceptance writes can bind a fresh approval only once", async () => {
  const runtime = createRuntime("concurrent-acceptance");
  try {
    const contract = buildContract(runtime);
    runtime.store.registerContract(contract);
    pauseProgram(runtime, contract);
    const approval = createApproval(
      runtime.db,
      contract,
      "accepted",
      "concurrent_fresh_acceptance",
      { decidedAt: "2026-07-30T00:04:30.000Z" },
    );
    const base = {
      decisionHash: contract.decisionHash,
      approvalId: approval.id,
      approvalScope: approval.scope,
    };
    const results = await Promise.all([
      appendLifecycleInWorker(runtime, {
        decisionHash: base.decisionHash,
        lifecycle: {
          eventId: "concurrent_acceptance_a",
          eventType: "accepted",
          approvalId: base.approvalId,
          approvalScope: base.approvalScope,
          occurredAt: "2026-07-30T00:05:00.000Z",
        },
      }),
      appendLifecycleInWorker(runtime, {
        decisionHash: base.decisionHash,
        lifecycle: {
          eventId: "concurrent_acceptance_b",
          eventType: "accepted",
          approvalId: base.approvalId,
          approvalScope: base.approvalScope,
          occurredAt: "2026-07-30T00:05:00.001Z",
        },
      }),
    ]);
    assert.equal(results.filter((result) => result.ok).length, 1);
    assert.equal(results.filter((result) => !result.ok).length, 1);
    assert.ok(
      ["commercial_approval_already_used", "commercial_lifecycle_transition_invalid"]
        .includes(results.find((result) => !result.ok).code),
    );
    assert.equal(get(
      runtime.db,
      `SELECT COUNT(*) AS count
       FROM commercial_test_lifecycle_events
       WHERE approval_id = ?`,
      [approval.id],
    ).count, 1);
    assert.equal(runtime.store.readLedger(contract.decisionHash).state, "accepted");
  } finally {
    closeRuntime(runtime);
  }
});

test("receipt and batch writes are atomic, trusted, idempotent, route-safe, and raw-ID free", () => {
  const runtime = createRuntime("batch");
  try {
    const contract = buildContract(runtime);
    runtime.store.registerContract(contract);
    activate(runtime, contract);

    const rejectedSource = importedSource(contract, "rejected");
    runtime.setVerifierResult(false);
    assertStoreError(
      () => ingest(runtime, contract, rejectedSource, transactionInput(contract, 1)),
      "commercial_import_unverified",
    );
    assert.equal(get(
      runtime.db,
      "SELECT COUNT(*) AS count FROM commercial_test_evidence_receipts",
    ).count, 0);

    runtime.setVerifierResult(true);
    const invalidSource = importedSource(contract, "invalid");
    assert.throws(() => ingest(runtime, contract, invalidSource, transactionInput(contract, 1, {
      grossCents: 100,
      refundCents: 200,
    })), /zero refunds|refunds cannot exceed gross revenue/i);
    assert.equal(get(
      runtime.db,
      "SELECT COUNT(*) AS count FROM commercial_test_evidence_receipts",
    ).count, 0);

    const source = importedSource(contract, "one");
    const input = transactionInput(contract, 1);
    assert.equal(ingest(runtime, contract, source, input).inserted, 1);
    assert.deepEqual(ingest(runtime, contract, source, input), {
      receiptCreated: false,
      inserted: 0,
      records: runtime.store.readLedger(contract.decisionHash).evidence,
    });

    const receiptCount = get(
      runtime.db,
      "SELECT COUNT(*) AS count FROM commercial_test_evidence_receipts",
    ).count;
    assertStoreError(
      () => ingest(
        runtime,
        contract,
        importedSource(contract, "conflicting-route"),
        transactionInput(contract, 2, {
          evidenceId: "evidence_conflicting_route",
          rawTransactionId: input.transaction.rawTransactionId,
          grossCents: 3000,
        }),
      ),
      "commercial_evidence_route_conflict",
    );
    assert.equal(get(
      runtime.db,
      "SELECT COUNT(*) AS count FROM commercial_test_evidence_receipts",
    ).count, receiptCount);

    const multiSource = importedSource(contract, "multi", {
      declaredRowCount: 2,
    });
    const multi = runtime.store.ingestEvidenceBatch(contract.decisionHash, {
      source: multiSource,
      verificationMaterial: { retainedFixture: true },
      records: [
        {
          ...transactionInput(contract, 2),
          sourceRowHash: sha256("multi-row-2"),
        },
        {
          ...transactionInput(contract, 3),
          sourceRowHash: sha256("multi-row-3"),
        },
      ],
    });
    assert.equal(multi.inserted, 2);
    assert.equal(new Set(multi.records.map(
      (record) => record.source.sourceRowHash,
    )).size, 2);

    const persisted = runtime.db.prepare(
      `SELECT group_concat(receipt_json, '') AS receipts,
              (SELECT group_concat(record_json, '')
               FROM commercial_test_evidence_records) AS records
       FROM commercial_test_evidence_receipts`,
    ).get();
    const encoded = `${persisted.receipts}${persisted.records}`;
    assert.equal(encoded.includes("buyer-1@example.test"), false);
    assert.equal(encoded.includes(input.transaction.rawTransactionId), false);
  } finally {
    closeRuntime(runtime);
  }
});

test("manual financial evidence stays pending until a separate exact verification record", () => {
  const runtime = createRuntime("manual");
  try {
    const contract = buildContract(runtime);
    runtime.store.registerContract(contract);
    activate(runtime, contract);

    const originalResult = ingest(
      runtime,
      contract,
      manualSource(contract, "sale"),
      transactionInput(contract, 1),
    );
    const original = originalResult.records[0];
    assert.equal(original.source.verificationStatus, "pending");
    assert.ok(runtime.store.evaluate(contract.decisionHash).blockers.some(
      (blocker) => blocker.code === "manual_verification_pending",
    ));

    const verification = runtime.store.verifyManualEvidence(contract.decisionHash, {
      originalRecordHash: original.recordHash,
      evidenceId: "manual_verification_sale",
      evidenceVersion: "1.0.0",
      source: manualSource(contract, "sale_verification", {
        capturedAt: "2026-09-01T00:04:00.000Z",
      }),
      attribution: attribution(contract),
      status: "verified",
      reviewerId: "independent_reviewer",
      reviewedAt: "2026-09-01T00:04:00.000Z",
    });
    assert.equal(verification.records[0].kind, "manual_verification");
    assert.equal(verification.records[0].source.verificationStatus, "verified");
    assert.equal(runtime.store.evaluate(contract.decisionHash).blockers.some(
      (blocker) => blocker.code === "manual_verification_pending",
    ), false);
    assert.equal(
      runtime.db.prepare(
        `SELECT verification_status FROM commercial_test_evidence_records
         WHERE record_hash = ?`,
      ).get(original.recordHash).verification_status,
      "pending",
    );
  } finally {
    closeRuntime(runtime);
  }
});

test("revision chains reject gaps and forks while route-equivalent retries remain a no-op", () => {
  const runtime = createRuntime("revision");
  try {
    const contract = buildContract(runtime);
    runtime.store.registerContract(contract);
    activate(runtime, contract);
    const original = ingest(
      runtime,
      contract,
      importedSource(contract, "revision_original"),
      transactionInput(contract, 1),
    ).records[0];
    const correctionInput = transactionRevisionInput(contract, original, 1);
    const correction = ingest(
      runtime,
      contract,
      importedSource(contract, "revision_one", {
        capturedAt: "2026-09-01T00:05:00.000Z",
      }),
      correctionInput,
    ).records[0];
    assert.equal(correction.transaction.chain.sequence, 1);

    const receiptsBeforeRetry = get(
      runtime.db,
      "SELECT COUNT(*) AS count FROM commercial_test_evidence_receipts",
    ).count;
    const routeRetry = ingest(
      runtime,
      contract,
      importedSource(contract, "revision_one_other_route", {
        capturedAt: "2026-09-01T00:06:00.000Z",
      }),
      transactionRevisionInput(contract, original, 1, {
        evidenceId: "evidence_revision_other_route",
      }),
    );
    assert.equal(routeRetry.inserted, 0);
    assert.equal(routeRetry.receiptCreated, false);
    assert.equal(get(
      runtime.db,
      "SELECT COUNT(*) AS count FROM commercial_test_evidence_receipts",
    ).count, receiptsBeforeRetry);
    assert.equal(runtime.store.readLedger(contract.decisionHash).evidence.length, 2);

    assertStoreError(
      () => ingest(
        runtime,
        contract,
        importedSource(contract, "revision_fork", {
          capturedAt: "2026-09-01T00:07:00.000Z",
        }),
        transactionRevisionInput(contract, original, 1, {
          evidenceId: "evidence_revision_fork",
          grossCents: 3100,
        }),
      ),
      "commercial_evidence_route_conflict",
    );
    assertStoreError(
      () => ingest(
        runtime,
        contract,
        importedSource(contract, "revision_gap", {
          capturedAt: "2026-09-01T00:08:00.000Z",
        }),
        transactionRevisionInput(contract, correction, 3, {
          evidenceId: "evidence_revision_gap",
          grossCents: 3200,
        }),
      ),
      "commercial_evidence_chain_gap",
    );
  } finally {
    closeRuntime(runtime);
  }
});

test("original-currency FX remains reproducible and platform balances never count as cash", () => {
  const runtime = createRuntime("money");
  try {
    const contract = buildContract(runtime);
    runtime.store.registerContract(contract);
    activate(runtime, contract);

    const fxInput = transactionInput(contract, 1);
    fxInput.transaction.grossRevenue = usdMoney(1000, 1500);
    fxInput.transaction.refunds = usdMoney(0, 0);
    ingest(runtime, contract, importedSource(contract, "fx_cash"), fxInput);
    const projection = runtime.db.prepare(
      `SELECT gross_revenue_original_minor_units, gross_revenue_currency,
              gross_revenue_aud_cents
       FROM commercial_test_evidence_records
       WHERE evidence_id = 'evidence_transaction_1'`,
    ).get();
    assert.deepEqual({ ...projection }, {
      gross_revenue_original_minor_units: 1000,
      gross_revenue_currency: "USD",
      gross_revenue_aud_cents: 1500,
    });

    ingest(
      runtime,
      contract,
      importedSource(contract, "platform_balance"),
      transactionInput(contract, 2, {
        status: "pending",
        settledAt: null,
        settlement: {
          state: "platform_balance",
          referenceHash: null,
        },
      }),
    );
    const evaluation = runtime.store.evaluate(contract.decisionHash);
    assert.equal(evaluation.financials.settledRevenueAudCents, 1500);
    assert.ok(evaluation.blockers.some(
      (blocker) => blocker.code === "unsettled_transaction",
    ));

    const receiptsBefore = get(
      runtime.db,
      "SELECT COUNT(*) AS count FROM commercial_test_evidence_receipts",
    ).count;
    const invalidFx = transactionInput(contract, 3);
    invalidFx.transaction.grossRevenue = usdMoney(1000, 1499);
    invalidFx.transaction.refunds = usdMoney(0, 0);
    assert.throws(
      () => ingest(
        runtime,
        contract,
        importedSource(contract, "invalid_fx"),
        invalidFx,
      ),
      /does not reproduce from the retained FX rate/i,
    );
    assert.equal(get(
      runtime.db,
      "SELECT COUNT(*) AS count FROM commercial_test_evidence_receipts",
    ).count, receiptsBefore);
  } finally {
    closeRuntime(runtime);
  }
});

test("sealing fails atomically while any fixed cost or source control is incomplete", () => {
  const runtime = createRuntime("incomplete-seal");
  try {
    const contract = buildContract(runtime);
    runtime.store.registerContract(contract);
    activate(runtime, contract);
    ingest(
      runtime,
      contract,
      importedSource(contract, "only_sale"),
      transactionInput(contract, 1),
    );
    const receiptsBefore = get(
      runtime.db,
      "SELECT COUNT(*) AS count FROM commercial_test_evidence_receipts",
    ).count;
    assert.throws(
      () => runtime.store.sealEvidenceSet(contract.decisionHash, {
        evidenceId: "incomplete_manifest",
        evidenceVersion: "1.0.0",
        source: manualSource(contract, "incomplete_manifest", {
          capturedAt: "2026-09-02T01:00:00.000Z",
        }),
        attribution: attribution(contract),
        closedAt: "2026-09-02T01:00:00.000Z",
      }),
      (error) => (
        error instanceof CommercialTestStoreError
        && error.code === "commercial_evidence_set_incomplete"
        && error.details.blockerCodes.includes("cost_category_missing")
      ),
    );
    assert.equal(get(
      runtime.db,
      `SELECT COUNT(*) AS count FROM commercial_test_evidence_records
       WHERE kind = 'evidence_set_manifest'`,
    ).count, 0);
    assert.equal(get(
      runtime.db,
      "SELECT COUNT(*) AS count FROM commercial_test_evidence_receipts",
    ).count, receiptsBefore);
  } finally {
    closeRuntime(runtime);
  }
});

test("whole-ledger sealing counts only verified cash and all reconciled fixed costs", () => {
  const runtime = createRuntime("proof");
  try {
    const contract = buildContract(runtime);
    runtime.store.registerContract(contract);
    activate(runtime, contract);

    for (let number = 1; number <= 3; number += 1) {
      ingest(
        runtime,
        contract,
        importedSource(contract, `sale_${number}`),
        transactionInput(contract, number),
      );
    }
    for (const category of COST_CATEGORIES) {
      const cents = category === "platform_fees"
        ? 300
        : category === "payment_fees"
          ? 50
          : 0;
      ingest(
        runtime,
        contract,
        importedSource(contract, `cost_${category}`),
        costInput(contract, category, cents),
      );
    }
    const result = runtime.store.sealEvidenceSet(contract.decisionHash, {
      evidenceId: "evidence_manifest_0",
      evidenceVersion: "1.0.0",
      source: manualSource(contract, "manifest", {
        capturedAt: "2026-09-02T01:00:00.000Z",
      }),
      attribution: attribution(contract),
      closedAt: "2026-09-02T01:00:00.000Z",
    });
    assert.equal(result.evaluation.proofReached, true);
    assert.equal(result.evaluation.outcome, "pass");
    assert.equal(result.evaluation.evidence.distinctPositiveBuyers, 3);
    assert.equal(result.evaluation.financials.settledRevenueAudCents, 8700);
    assert.equal(result.evaluation.financials.reconciledCostsAudCents, 350);
    assert.equal(result.evaluation.financials.actualNetCashContributionAudCents, 8350);
    assert.equal(result.evaluation.financials.costTruthComplete, true);

    assert.equal(runtime.store.evaluate(contract.decisionHash).evaluationHash,
      result.evaluation.evaluationHash);
    assert.equal(get(
      runtime.db,
      "SELECT COUNT(*) AS count FROM commercial_test_proof_evaluations",
    ).count, 1);
    const ledger = runtime.store.readLedger(contract.decisionHash);
    assert.equal(ledger.storedEvaluations.length, 1);
    assert.equal(ledger.evaluation.proofReached, true);
    const summary = runtime.store.listSummaries()[0];
    assert.equal(summary.proofReached, true);
    assert.equal(summary.actualNetCashContributionAudCents, 8350);
  } finally {
    closeRuntime(runtime);
  }
});

test("terminal stop evidence and authority are atomic and permanently block further evidence", () => {
  const runtime = createRuntime("stop");
  try {
    const contract = buildContract(runtime);
    runtime.store.registerContract(contract);
    activate(runtime, contract);
    assertStoreError(
      () => runtime.store.appendLifecycle(contract.decisionHash, {
        eventId: "direct_stop_forbidden",
        eventType: "stopped",
        occurredAt: "2026-09-02T01:59:00.000Z",
      }),
      "commercial_terminal_evidence_required",
    );
    assertStoreError(
      () => runtime.store.stopTest(contract.decisionHash, {
        evidenceId: "terminal_stop_failed",
        evidenceVersion: "1.0.0",
        source: manualSource(contract, "stop_failed"),
        attribution: attribution(contract),
        code: "operator_stop",
        reason: "The owner ended this exact test before any external continuation.",
        stoppedAt: "2026-09-02T02:00:00.000Z",
        lifecycle: {
          eventId: "primary_proposed",
        },
      }),
      "commercial_lifecycle_replay_conflict",
    );
    assert.equal(get(
      runtime.db,
      `SELECT COUNT(*) AS count FROM commercial_test_evidence_records
       WHERE kind = 'terminal_stop'`,
    ).count, 0);

    const stopInput = {
      evidenceId: "terminal_stop_final",
      evidenceVersion: "1.0.0",
      source: manualSource(contract, "stop_final"),
      attribution: attribution(contract),
      code: "operator_stop",
      reason: "The owner ended this exact test before any external continuation.",
      stoppedAt: "2026-09-02T02:00:00.000Z",
      lifecycle: {
        eventId: "primary_stopped",
      },
    };
    const stopped = runtime.store.stopTest(contract.decisionHash, stopInput);
    assert.equal(stopped.lifecycle.event.eventType, "stopped");
    assert.equal(stopped.evaluation.outcome, "stop");
    assert.equal(runtime.store.readLedger(contract.decisionHash).state, "stopped");
    const replay = runtime.store.stopTest(contract.decisionHash, stopInput);
    assert.equal(replay.inserted, 0);
    assert.equal(replay.lifecycle.created, false);
    assertStoreError(
      () => ingest(
        runtime,
        contract,
        importedSource(contract, "after_stop"),
        transactionInput(contract, 1),
      ),
      "commercial_program_terminal",
    );
  } finally {
    closeRuntime(runtime);
  }
});
