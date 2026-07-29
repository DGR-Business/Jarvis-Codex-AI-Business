"use strict";

const assert = require("node:assert/strict");
const { DatabaseSync } = require("node:sqlite");
const test = require("node:test");

const {
  applyCommercialTestEvidenceLedgerMigration,
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
} = require("../src/runtime/commercial-authority");
const {
  getCommercialOwnerTestsState,
  OWNER_TESTS_RESULTS_SCHEMA,
} = require("../src/runtime/commercial-owner-state");
const {
  createCommercialTestStore,
} = require("../src/runtime/commercial-test-store");

const PERIOD = Object.freeze({
  startsAt: "2026-08-01T00:00:00.000Z",
  endsAt: "2026-08-31T23:59:59.999Z",
});
const STORE_TIME = "2026-09-03T00:00:00.000Z";
const OWNER_TIME = "2026-09-03T12:00:00.000Z";
const BUYER_SECRET = "owner-projection-test-buyer-secret";

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

function createMinimalDatabase() {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    PRAGMA foreign_keys = ON;

    CREATE TABLE schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
    INSERT INTO schema_migrations (version, name, applied_at)
    VALUES (24, 'minimal-commercial-owner-fixture', '${STORE_TIME}');

    CREATE TABLE ventures (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      stage INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL,
      summary TEXT NOT NULL DEFAULT '',
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      lifecycle_stage TEXT NOT NULL DEFAULT 'candidate',
      is_active INTEGER NOT NULL DEFAULT 0,
      business_model TEXT NOT NULL DEFAULT 'digital_product'
    );

    CREATE TABLE approvals (
      id TEXT PRIMARY KEY,
      workflow_id TEXT,
      scope TEXT NOT NULL,
      title TEXT NOT NULL,
      status TEXT NOT NULL,
      risk_level TEXT NOT NULL DEFAULT 'medium',
      requested_by TEXT NOT NULL,
      requested_at TEXT NOT NULL,
      decided_at TEXT,
      decision_note TEXT,
      payload TEXT NOT NULL DEFAULT '{}',
      venture_id TEXT,
      task_id TEXT,
      scope_hash TEXT,
      expires_at TEXT,
      consumed_at TEXT,
      expected_effects TEXT NOT NULL DEFAULT '[]'
    );

    CREATE TABLE venture_kits (
      id TEXT NOT NULL,
      version INTEGER NOT NULL CHECK(version > 0),
      status TEXT NOT NULL CHECK(status IN ('draft', 'active', 'retired')),
      name TEXT NOT NULL,
      business_models TEXT NOT NULL DEFAULT '[]',
      eligibility_rules TEXT NOT NULL DEFAULT '{}',
      evidence_requirements TEXT NOT NULL DEFAULT '{}',
      capability_requirements TEXT NOT NULL DEFAULT '[]',
      channel_policy TEXT NOT NULL DEFAULT '{}',
      acceptance_criteria TEXT NOT NULL DEFAULT '{}',
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (id, version)
    );

    INSERT INTO ventures
      (id, name, status, created_at, updated_at, lifecycle_stage, is_active)
    VALUES
      ('venture.owner_fixture', 'Owner fixture venture', 'active',
       '${STORE_TIME}', '${STORE_TIME}', 'validation', 1);

    INSERT INTO venture_kits
      (id, version, status, name, business_models, eligibility_rules,
       evidence_requirements, capability_requirements, channel_policy,
       acceptance_criteria, metadata, created_at, updated_at)
    VALUES
      ('digital_product_v1', 1, 'active', 'Digital product',
       '["digital_product"]', '{}', '{}', '[]', '{}', '{}', '{}',
       '${STORE_TIME}', '${STORE_TIME}');
  `);
  applyCommercialTestEvidenceLedgerMigration(db);
  return db;
}

function createRuntime() {
  const db = createMinimalDatabase();
  const kit = db.prepare(
    `SELECT id, version, content_hash AS contentHash
     FROM venture_kits WHERE id = 'digital_product_v1' AND version = 1`,
  ).get();
  const store = createCommercialTestStore(db, {
    clock: () => STORE_TIME,
    verifyImportedReceipt: () => true,
    pseudonymizeBuyer: (contract, buyerReference) => (
      pseudonymizeBuyer(contract, buyerReference, BUYER_SECRET)
    ),
  });
  return { db, kit, store };
}

function closeRuntime(runtime) {
  runtime.db.close();
}

function protectedActions() {
  return Object.fromEntries(PROTECTED_ACTION_KEYS.map((key) => [key, true]));
}

function offer(suffix) {
  const definition = {
    id: `offer.scope_guard_${suffix}`,
    version: "1.0.0",
    sku: `scope_guard_${suffix}_aud_29`,
    description: `Client Approval and Scope Guard Kit ${suffix}`,
    contentHash: sha256(`owner-offer-content-${suffix}`),
  };
  return {
    ...definition,
    hash: offerDefinitionHash(definition),
  };
}

function buildContract(runtime, suffix = "primary") {
  const exactOffer = offer(suffix);
  const accountHash = sha256(`private-marketplace-account-${suffix}`);
  return createCommercialTestContract({
    programId: `program.owner_${suffix}`,
    programVersion: "1.0.0",
    testId: `test.owner_${suffix}`,
    testVersion: "2.0.0",
    ventureId: "venture.owner_fixture",
    ventureKit: {
      id: runtime.kit.id,
      version: runtime.kit.version,
      hash: runtime.kit.contentHash,
    },
    offerId: exactOffer.id,
    offer: exactOffer,
    buyer: "Independent social media managers with retained clients",
    problem: "Client approvals and scope changes are fragmented and hard to evidence",
    experiment: {
      id: `experiment.owner_${suffix}`,
      version: "1.0.0",
      hypothesis: "The exact buyer will pay A$29 for the low-touch operational kit",
      primaryMetric: "positive_independent_settled_buyers",
      deadlineAt: "2026-09-02T00:00:00.000Z",
    },
    cohort: {
      id: `cohort.owner_${suffix}`,
      definition: "Buyers exposed only to the approved marketplace listing",
    },
    reportingPeriod: PERIOD,
    channel: {
      id: "marketplace_alpha",
      providerNamespace: "marketplace_alpha",
      accountHash,
      adapter: {
        id: "marketplace_adapter",
        version: "2.0.0",
        hash: sha256("owner-marketplace-adapter-v2"),
      },
    },
    price: {
      currency: "AUD",
      amountMinorUnits: 2900,
      amountAudCents: 2900,
    },
    buyerIdentity: {
      method: "hmac_sha256",
      keyId: "owner_fixture_buyer_hmac_key",
      keyVersion: 1,
      independenceBasis: "platform_buyer_account",
    },
    protectedActions: protectedActions(),
    attributionRules: {
      method: "last_qualified_touch",
      window: PERIOD,
      allowedTouchpoints: ["listing_id"],
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
  });
}

function ownerState(runtime) {
  return getCommercialOwnerTestsState(runtime.db, {
    clock: () => OWNER_TIME,
    storeOptions: {
      clock: () => STORE_TIME,
    },
  });
}

function ledgerRowCounts(runtime) {
  const tables = [
    "approvals",
    "commercial_test_contracts",
    "commercial_test_lifecycle_events",
    "commercial_test_evidence_receipts",
    "commercial_test_evidence_records",
    "commercial_test_proof_evaluations",
  ];
  return Object.fromEntries(tables.map((table) => [
    table,
    runtime.db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count,
  ]));
}

function createApproval(runtime, contract, eventType, id, status = "approved") {
  const scope = commercialLifecycleApprovalScope(contract, eventType);
  const scopeHash = commercialLifecycleApprovalScopeHash(contract, eventType);
  runtime.db.prepare(
    `INSERT INTO approvals
      (id, scope, scope_hash, title, status, risk_level, requested_by,
       requested_at, decided_at, decision_note, payload, consumed_at)
     VALUES (?, ?, ?, ?, ?, 'high', 'jarvis', ?, ?, ?, ?, NULL)`,
  ).run(
    id,
    canonicalJson(scope),
    scopeHash,
    `${eventType} commercial test`,
    status,
    "2026-07-30T00:00:00.000Z",
    status === "approved" ? "2026-07-30T00:01:00.000Z" : null,
    status === "approved" ? "Approved for focused proof." : null,
    canonicalJson({
      commercialTestApprovalScope: scope,
      commercialTestApprovalScopeHash: scopeHash,
    }),
  );
  return { id, scope };
}

function propose(runtime, contract, prefix) {
  runtime.store.registerContract(contract);
  runtime.store.appendLifecycle(contract.decisionHash, {
    eventId: `${prefix}_proposed`,
    eventType: "proposed",
    reason: "Prepared for exact owner review.",
    occurredAt: "2026-07-30T00:00:00.000Z",
  });
}

function accept(runtime, contract, prefix) {
  const approval = createApproval(
    runtime,
    contract,
    "accepted",
    `${prefix}_approved_acceptance`,
  );
  runtime.store.appendLifecycle(contract.decisionHash, {
    eventId: `${prefix}_accepted`,
    eventType: "accepted",
    approvalId: approval.id,
    approvalScope: approval.scope,
    reason: "The exact commercial decision was accepted.",
    occurredAt: "2026-07-30T00:02:00.000Z",
  });
}

function activate(runtime, contract, prefix) {
  const approval = createApproval(
    runtime,
    contract,
    "activated",
    `${prefix}_approved_activation`,
  );
  runtime.store.appendLifecycle(contract.decisionHash, {
    eventId: `${prefix}_activated`,
    eventType: "activated",
    approvalId: approval.id,
    approvalScope: approval.scope,
    reason: "The accepted commercial test was activated.",
    occurredAt: "2026-07-30T00:03:00.000Z",
  });
}

function activateContract(runtime, contract, prefix = "primary") {
  propose(runtime, contract, prefix);
  accept(runtime, contract, prefix);
  activate(runtime, contract, prefix);
}

function coverage(kind, sourceHash, receiptHash) {
  const basis = kind === "imported_platform"
    ? "unfiltered_full_reporting_period"
    : "single_retained_source";
  return {
    basis,
    declaredRowCount: 1,
    controlHash: sourceCoverageHash({
      basis,
      declaredRowCount: 1,
      reportingPeriod: PERIOD,
      sourceHash,
      receiptHash,
    }),
  };
}

function importedSource(contract, token) {
  const sourceHash = sha256(`owner-source-${token}`);
  const receiptHash = sha256(`owner-receipt-${token}`);
  return {
    kind: "imported_platform",
    sourceId: "platform_settlement_records",
    providerNamespace: contract.channel.providerNamespace,
    accountHash: contract.channel.accountHash,
    sourceSystem: "marketplace_settlement",
    exportType: "settlement_record_v2",
    sourceHash,
    sourceRowHash: sha256(`owner-row-${token}`),
    receipt: {
      id: `receipt_${token}`,
      hash: receiptHash,
      locationReference: `retained_${token}`,
    },
    verificationStatus: "pending",
    reportingPeriod: PERIOD,
    capturedAt: "2026-09-01T00:02:00.000Z",
    generatedAt: "2026-09-01T00:00:00.000Z",
    importedAt: "2026-09-01T00:01:00.000Z",
    importBatchId: `batch_${token}`,
    coverage: coverage("imported_platform", sourceHash, receiptHash),
  };
}

function manualSource(contract, token, capturedAt = "2026-09-01T00:03:00.000Z") {
  const sourceHash = sha256(`owner-manual-source-${token}`);
  const receiptHash = sha256(`owner-manual-receipt-${token}`);
  return {
    kind: "operator_attested_manual",
    sourceId: "platform_settlement_records",
    providerNamespace: contract.channel.providerNamespace,
    accountHash: contract.channel.accountHash,
    sourceSystem: "marketplace_settlement",
    exportType: "settlement_record_v2",
    sourceHash,
    sourceRowHash: sha256(`owner-manual-row-${token}`),
    receipt: {
      id: `manual_receipt_${token}`,
      hash: receiptHash,
      locationReference: `manual_retained_${token}`,
    },
    verificationStatus: "pending",
    reportingPeriod: PERIOD,
    capturedAt,
    manualReferenceHash: sha256(`owner-manual-reference-${token}`),
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
      referenceHash: sha256("owner-listing-scope-guard-v1"),
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

function transactionInput(contract, number) {
  const day = String(number).padStart(2, "0");
  return {
    evidenceId: `owner_evidence_transaction_${number}`,
    evidenceVersion: "1.0.0",
    kind: "transaction",
    attribution: attribution(contract),
    buyerReference: `private-buyer-${number}@example.test`,
    transaction: {
      rawTransactionId: `private-provider-transaction-${number}`,
      eventType: "original",
      chain: {
        sequence: 0,
        predecessorRecordHash: null,
        reversesRecordHash: null,
      },
      status: "settled",
      occurredAt: `2026-08-${day}T00:00:00.000Z`,
      settledAt: `2026-08-${day}T01:00:00.000Z`,
      settlement: {
        state: "cash_settled",
        referenceHash: sha256(`owner-cash-settlement-${number}`),
      },
      grossRevenue: nativeAud(2900),
      refunds: nativeAud(0),
    },
  };
}

function costInput(contract, category) {
  const cents = category === "platform_fees"
    ? 300
    : category === "payment_fees"
      ? 50
      : 0;
  return {
    evidenceId: `owner_evidence_cost_${category}`,
    evidenceVersion: "1.0.0",
    kind: "cost",
    attribution: attribution(contract),
    cost: {
      rawCostId: `private-provider-cost-${category}`,
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

function ingest(runtime, contract, source, record) {
  return runtime.store.ingestEvidenceBatch(contract.decisionHash, {
    source,
    verificationMaterial: { retainedFixture: true },
    records: [record],
  });
}

function ingestCompleteProof(runtime, contract) {
  for (let number = 1; number <= 3; number += 1) {
    ingest(
      runtime,
      contract,
      importedSource(contract, `sale_${number}`),
      transactionInput(contract, number),
    );
  }
  for (const category of COST_CATEGORIES) {
    ingest(
      runtime,
      contract,
      importedSource(contract, `cost_${category}`),
      costInput(contract, category),
    );
  }
  runtime.store.sealEvidenceSet(contract.decisionHash, {
    evidenceId: "owner_evidence_manifest_0",
    evidenceVersion: "1.0.0",
    source: manualSource(
      contract,
      "manifest",
      "2026-09-02T01:00:00.000Z",
    ),
    attribution: attribution(contract),
    closedAt: "2026-09-02T01:00:00.000Z",
  });
}

test("empty ledger returns the stable read-only owner contract", () => {
  const runtime = createRuntime();
  try {
    const state = ownerState(runtime);
    assert.equal(state.schema, OWNER_TESTS_RESULTS_SCHEMA);
    assert.equal(state.generatedAt, OWNER_TIME);
    assert.equal(state.readOnly, true);
    assert.deepEqual(state.controls, { allowed: [] });
    assert.equal(state.integrity.status, "ok");
    assert.equal(state.integrity.authorityStatus, "inactive");
    assert.equal(state.current, null);
    assert.deepEqual(state.closedHistory, { total: 0, items: [] });
    assert.equal(state.emptyState.title, "No commercial test is authorised");
  } finally {
    closeRuntime(runtime);
  }
});

test("owner projection reads leave contracts, events, evidence, approvals, and evaluations unchanged", () => {
  const runtime = createRuntime();
  try {
    const contract = buildContract(runtime, "read_only");
    activateContract(runtime, contract, "read_only");
    const before = ledgerRowCounts(runtime);
    const first = ownerState(runtime);
    const second = ownerState(runtime);
    assert.equal(first.current.lifecycle.status, "activated");
    assert.deepEqual(second, first);
    assert.deepEqual(ledgerRowCounts(runtime), before);
    assert.equal(before.commercial_test_proof_evaluations, 0);
  } finally {
    closeRuntime(runtime);
  }
});

test("active, accepted, and paused programs project exact lifecycle authority read-only", () => {
  const activeRuntime = createRuntime();
  try {
    const contract = buildContract(activeRuntime, "active");
    activateContract(activeRuntime, contract, "active");
    const active = ownerState(activeRuntime);
    assert.equal(active.integrity.status, "ok");
    assert.equal(active.integrity.authorityStatus, "active");
    assert.equal(active.current.lifecycle.status, "activated");
    assert.equal(active.current.lifecycle.proposedAt, "2026-07-30T00:00:00.000Z");
    assert.equal(active.current.lifecycle.acceptedAt, "2026-07-30T00:02:00.000Z");
    assert.equal(active.current.lifecycle.activatedAt, "2026-07-30T00:03:00.000Z");
    assert.equal(active.current.buyer, contract.buyer);
    assert.equal(active.current.problem, contract.problem);
    assert.equal(active.current.offer.description, contract.offer.description);
    assert.equal(active.current.hypothesis, contract.experiment.hypothesis);
    assert.deepEqual(active.current.price, { currency: "AUD", amountCents: 2900 });
    assert.deepEqual(active.current.reportingPeriod, PERIOD);
    assert.equal(active.current.reviewDecision, null);
    assert.deepEqual(active.controls.allowed, []);
  } finally {
    closeRuntime(activeRuntime);
  }

  const acceptedRuntime = createRuntime();
  try {
    const contract = buildContract(acceptedRuntime, "accepted");
    propose(acceptedRuntime, contract, "accepted");
    accept(acceptedRuntime, contract, "accepted");
    createApproval(
      acceptedRuntime,
      contract,
      "activated",
      "accepted_pending_activation",
      "pending",
    );
    const accepted = ownerState(acceptedRuntime);
    assert.equal(accepted.current.lifecycle.status, "accepted");
    assert.deepEqual(accepted.controls.allowed, ["review_decision"]);
    assert.deepEqual(accepted.current.reviewDecision, {
      id: "accepted_pending_activation",
      label: "Review decision",
    });

    createApproval(
      acceptedRuntime,
      contract,
      "activated",
      "accepted_duplicate_pending_activation",
      "pending",
    );
    const ambiguousDecision = ownerState(acceptedRuntime);
    assert.equal(ambiguousDecision.integrity.status, "attention");
    assert.deepEqual(ambiguousDecision.controls.allowed, []);
    assert.equal(ambiguousDecision.current.reviewDecision, null);
  } finally {
    closeRuntime(acceptedRuntime);
  }

  const pausedRuntime = createRuntime();
  try {
    const contract = buildContract(pausedRuntime, "paused");
    activateContract(pausedRuntime, contract, "paused");
    pausedRuntime.store.appendLifecycle(contract.decisionHash, {
      eventId: "paused_event",
      eventType: "paused",
      reason: "Paused for an owner checkpoint.",
      occurredAt: "2026-07-30T00:04:00.000Z",
    });
    createApproval(
      pausedRuntime,
      contract,
      "accepted",
      "paused_pending_acceptance",
      "pending",
    );
    const paused = ownerState(pausedRuntime);
    assert.equal(paused.current.lifecycle.status, "paused");
    assert.equal(paused.current.lifecycle.pausedAt, "2026-07-30T00:04:00.000Z");
    assert.deepEqual(paused.controls.allowed, ["review_decision"]);
    assert.equal(paused.current.reviewDecision.id, "paused_pending_acceptance");
  } finally {
    closeRuntime(pausedRuntime);
  }
});

test("terminal-only work appears in immutable closed history", () => {
  const runtime = createRuntime();
  try {
    const contract = buildContract(runtime, "stopped");
    propose(runtime, contract, "stopped");
    runtime.store.stopTest(contract.decisionHash, {
      evidenceId: "owner_terminal_stop",
      evidenceVersion: "1.0.0",
      source: manualSource(
        contract,
        "terminal_stop",
        "2026-09-02T02:00:00.000Z",
      ),
      attribution: attribution(contract),
      code: "operator_stop",
      reason: "The owner ended this exact test before external continuation.",
      stoppedAt: "2026-09-02T02:00:00.000Z",
      lifecycle: {
        eventId: "stopped_terminal",
      },
    });

    const state = ownerState(runtime);
    assert.equal(state.integrity.status, "ok");
    assert.equal(state.current, null);
    assert.equal(state.closedHistory.total, 1);
    assert.equal(state.closedHistory.items[0].lifecycle.status, "stopped");
    assert.equal(
      state.closedHistory.items[0].lifecycle.stoppedAt,
      "2026-09-02T02:00:00.000Z",
    );
    assert.equal(
      state.closedHistory.items[0].proof.netCashContribution.amountCents,
      null,
    );
  } finally {
    closeRuntime(runtime);
  }
});

test("overlapping nonterminal programs fail closed even when one is activated", () => {
  const runtime = createRuntime();
  try {
    const active = buildContract(runtime, "overlap_active");
    activateContract(runtime, active, "overlap_active");
    const proposed = buildContract(runtime, "overlap_proposed");
    propose(runtime, proposed, "overlap_proposed");

    const state = ownerState(runtime);
    assert.equal(state.integrity.status, "attention");
    assert.equal(state.integrity.authorityStatus, "ambiguous");
    assert.equal(state.current, null);
    assert.deepEqual(state.controls.allowed, []);
    assert.match(state.integrity.message, /More than one current commercial program/);
  } finally {
    closeRuntime(runtime);
  }
});

test("incomplete evidence reports import and manual verification quality but withholds NCC", () => {
  const runtime = createRuntime();
  try {
    const contract = buildContract(runtime, "incomplete");
    activateContract(runtime, contract, "incomplete");
    const original = ingest(
      runtime,
      contract,
      manualSource(contract, "manual_sale"),
      transactionInput(contract, 1),
    ).records[0];

    let state = ownerState(runtime);
    assert.deepEqual(state.current.evidenceQuality.counts, {
      imported: 0,
      manual: 1,
      manualVerified: 0,
      blockers: state.current.evidenceQuality.counts.blockers,
    });
    assert.ok(state.current.evidenceQuality.counts.blockers > 0);
    assert.deepEqual(state.current.proof.netCashContribution, {
      status: "not_settled",
      label: "Not settled",
      currency: "AUD",
      amountCents: null,
    });

    runtime.store.verifyManualEvidence(contract.decisionHash, {
      originalRecordHash: original.recordHash,
      evidenceId: "owner_manual_verification_sale",
      evidenceVersion: "1.0.0",
      source: manualSource(
        contract,
        "manual_sale_verification",
        "2026-09-01T00:04:00.000Z",
      ),
      attribution: attribution(contract),
      status: "verified",
      reviewerId: "independent_reviewer",
      reviewedAt: "2026-09-01T00:04:00.000Z",
    });
    state = ownerState(runtime);
    assert.equal(state.current.evidenceQuality.counts.manual, 1);
    assert.equal(state.current.evidenceQuality.counts.manualVerified, 1);
    assert.equal(
      state.current.proof.netCashContribution.label,
      "Not settled",
    );
  } finally {
    closeRuntime(runtime);
  }
});

test("complete whole-ledger proof exposes settled AUD NCC and no raw identifiers", () => {
  const runtime = createRuntime();
  try {
    const contract = buildContract(runtime, "complete");
    activateContract(runtime, contract, "complete");
    ingestCompleteProof(runtime, contract);
    const ledger = runtime.store.readLedger(contract.decisionHash);
    const state = ownerState(runtime);
    const encoded = JSON.stringify(state);

    assert.equal(state.current.evidenceQuality.status, "complete");
    assert.deepEqual(state.current.evidenceQuality.counts, {
      imported: 11,
      manual: 0,
      manualVerified: 0,
      blockers: 0,
    });
    assert.deepEqual(state.current.proof.buyers, {
      verifiedPositive: 3,
      target: 3,
    });
    assert.deepEqual(state.current.proof.netCashContribution, {
      status: "settled",
      label: "Settled",
      currency: "AUD",
      amountCents: 8350,
    });
    assert.equal(state.current.proof.commercialProofReached, true);
    assert.match(state.current.auditRef, /^test-[a-f0-9]{20}$/);

    const forbiddenValues = [
      contract.decisionHash,
      contract.channel.accountHash,
      ledger.evaluation.evidenceSetHash,
      ledger.evaluation.evaluationHash,
      ...ledger.evidence.flatMap((record) => [
        record.recordHash,
        record.source?.sourceHash,
        record.source?.sourceRowHash,
        record.source?.receipt?.hash,
        record.transaction?.buyer?.pseudonym,
        record.transaction?.transactionKey,
        record.transaction?.transactionIdHash,
        record.transaction?.settlement?.referenceHash,
        record.cost?.costKey,
        record.cost?.costIdHash,
      ]),
    ].filter(Boolean);
    for (const value of forbiddenValues) {
      assert.equal(encoded.includes(value), false, `Projection leaked ${value}`);
    }
    assert.doesNotMatch(encoded, /sha256:/);
    assert.doesNotMatch(encoded, /buyer_[a-f0-9]{64}/);
    assert.doesNotMatch(
      encoded,
      /decisionHash|accountHash|recordHash|sourceHash|receiptHash|transactionIdHash/,
    );

    runtime.store.appendLifecycle(contract.decisionHash, {
      eventId: "complete_closed",
      eventType: "closed",
      reason: "The complete reporting period was closed.",
      occurredAt: "2026-09-02T02:00:00.000Z",
    });
    const closed = ownerState(runtime);
    assert.equal(closed.current, null);
    assert.equal(closed.closedHistory.total, 1);
    assert.equal(
      closed.closedHistory.items[0].proof.netCashContribution.amountCents,
      8350,
    );
  } finally {
    closeRuntime(runtime);
  }
});

test("ledger projection tampering returns safe integrity attention without claims", () => {
  const runtime = createRuntime();
  try {
    const contract = buildContract(runtime, "tampered");
    propose(runtime, contract, "tampered");
    runtime.db.exec(`
      DROP TRIGGER trg_commercial_test_contracts_immutable_update;
      PRAGMA ignore_check_constraints = ON;
      UPDATE commercial_test_contracts
      SET price_aud_cents = 9999
      WHERE test_id = 'test.owner_tampered';
      PRAGMA ignore_check_constraints = OFF;
    `);

    const state = ownerState(runtime);
    const encoded = JSON.stringify(state);
    assert.equal(state.integrity.status, "attention");
    assert.equal(state.integrity.authorityStatus, "unavailable");
    assert.equal(state.current, null);
    assert.deepEqual(state.controls.allowed, []);
    assert.equal(encoded.includes(contract.decisionHash), false);
    assert.equal(encoded.includes(contract.channel.accountHash), false);
    assert.doesNotMatch(encoded, /9999/);
  } finally {
    closeRuntime(runtime);
  }
});
