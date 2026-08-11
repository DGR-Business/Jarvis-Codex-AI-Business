"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  LATEST_SCHEMA_VERSION,
  get,
  openDatabase,
  seedDatabase,
  verifyDatabase,
} = require("../src/db");
const {
  COST_CATEGORIES,
  OPERATOR_ROLE,
  PROTECTED_ACTION_KEYS,
  createCommercialEvidenceRecord,
  createCommercialTestContract,
  offerDefinitionHash,
  sha256,
  sourceCoverageHash,
} = require("../src/runtime/commercial-test-contract");
const {
  ensureVentureKitRegistry,
  getVentureKit,
} = require("../src/runtime/venture-kit-registry");
const {
  ventureKitContentHash,
} = require("../src/runtime/venture-kit-definition");
const {
  downgradeDatabaseToLegacySchema24,
} = require("./support/released-schema-24-fixture");

const PERIOD = Object.freeze({
  startsAt: "2026-08-01T00:00:00.000Z",
  endsAt: "2026-08-31T23:59:59.999Z",
});
const BUYER_SECRET = "commercial-ledger-schema-test-secret";

function createRuntime(name) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `pantheon-ledger-${name}-`));
  const dbPath = path.join(root, "runtime.sqlite");
  const db = openDatabase(dbPath);
  seedDatabase(db);
  ensureVentureKitRegistry(db);
  return { root, dbPath, db };
}

function closeRuntime(runtime) {
  runtime.db?.close();
  runtime.db = null;
  fs.rmSync(runtime.root, { recursive: true, force: true });
}

function insertRow(db, table, row) {
  const columns = Object.keys(row);
  const placeholders = columns.map(() => "?").join(", ");
  return db.prepare(
    `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${placeholders})`,
  ).run(...columns.map((column) => row[column]));
}

function protectedActions() {
  return Object.fromEntries(PROTECTED_ACTION_KEYS.map((key) => [key, true]));
}

function contractFixture(db, suffix = "one") {
  const kit = getVentureKit(db, "digital_product_v1", 1);
  const accountHash = sha256(`account-${suffix}`);
  const offerDefinition = {
    id: `offer.scope_guard_${suffix}`,
    version: "1.0.0",
    sku: `scope_guard_${suffix}_aud_29`,
    description: "Low-touch client approval and scope guard kit",
    contentHash: sha256(`offer-content-${suffix}`),
  };
  const offer = {
    ...offerDefinition,
    hash: offerDefinitionHash(offerDefinition),
  };
  return createCommercialTestContract({
    programId: `program.low_touch_${suffix}`,
    programVersion: "1.0.0",
    testId: `test.first_buyer_${suffix}`,
    testVersion: "2.0.0",
    ventureId: "venture-digital-products",
    ventureKit: {
      id: kit.id,
      version: kit.version,
      hash: kit.contentHash,
    },
    offerId: offer.id,
    offer,
    buyer: "Independent social media managers with retained clients",
    problem: "Client approvals and scope changes are fragmented and hard to evidence",
    experiment: {
      id: `experiment.first_buyer_${suffix}`,
      version: "1.0.0",
      hypothesis: "The exact buyer will pay A$29 for the defined low-touch kit",
      primaryMetric: "positive_independent_settled_buyers",
      deadlineAt: "2026-09-02T00:00:00.000Z",
    },
    cohort: {
      id: `cohort.first_buyer_${suffix}`,
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
  });
}

function contractRow(contract, overrides = {}) {
  return {
    decision_hash: contract.decisionHash,
    contract_schema: contract.schema,
    program_id: contract.programId,
    program_version: contract.programVersion,
    test_id: contract.testId,
    test_version: contract.testVersion,
    venture_id: contract.ventureId,
    venture_kit_id: contract.ventureKit.id,
    venture_kit_version: contract.ventureKit.version,
    venture_kit_hash: contract.ventureKit.hash,
    offer_id: contract.offer.id,
    offer_version: contract.offer.version,
    offer_hash: contract.offer.hash,
    offer_sku: contract.offer.sku,
    experiment_id: contract.experiment.id,
    experiment_version: contract.experiment.version,
    cohort_id: contract.cohort.id,
    channel_id: contract.channel.id,
    provider_namespace: contract.channel.providerNamespace,
    account_hash: contract.channel.accountHash,
    adapter_id: contract.channel.adapter.id,
    adapter_version: contract.channel.adapter.version,
    adapter_hash: contract.channel.adapter.hash,
    reporting_starts_at: contract.reportingPeriod.startsAt,
    reporting_ends_at: contract.reportingPeriod.endsAt,
    buyer_key_id: contract.buyerIdentity.keyId,
    buyer_key_version: contract.buyerIdentity.keyVersion,
    buyer_independence_basis: contract.buyerIdentity.independenceBasis,
    price_aud_cents: contract.price.amountAudCents,
    operator_role: contract.operatorRole,
    external_spend_cap_cents: Math.round(contract.externalSpendCapAud * 100),
    contract_json: JSON.stringify(contract),
    created_at: "2026-07-29T00:00:00.000Z",
    ...overrides,
  };
}

function sourceFixture(contract, suffix = "one") {
  const sourceHash = sha256(`source-${suffix}`);
  const receiptHash = sha256(`receipt-${suffix}`);
  return {
    kind: "imported_platform",
    sourceId: "platform_settlement_records",
    providerNamespace: contract.channel.providerNamespace,
    accountHash: contract.channel.accountHash,
    sourceSystem: "marketplace_settlement",
    exportType: "settlement_record_v2",
    sourceHash,
    sourceRowHash: sha256(`source-row-${suffix}`),
    receipt: {
      id: `receipt.${suffix}`,
      hash: receiptHash,
      locationReference: `retained_receipt_${suffix}`,
    },
    verificationStatus: "verified",
    reportingPeriod: PERIOD,
    capturedAt: "2026-09-01T01:00:00.000Z",
    coverage: {
      basis: "unfiltered_full_reporting_period",
      declaredRowCount: 1,
      controlHash: sourceCoverageHash({
        basis: "unfiltered_full_reporting_period",
        declaredRowCount: 1,
        reportingPeriod: PERIOD,
        sourceHash,
        receiptHash,
      }),
    },
    generatedAt: "2026-09-01T00:30:00.000Z",
    importedAt: "2026-09-01T01:00:00.000Z",
    importBatchId: `batch.${suffix}`,
  };
}

function transactionFixture(contract, suffix = "one") {
  const source = sourceFixture(contract, suffix);
  return createCommercialEvidenceRecord(contract, {
    evidenceId: `evidence.transaction.${suffix}`,
    evidenceVersion: "1.0.0",
    kind: "transaction",
    source,
    attribution: {
      status: "attributed",
      channelId: contract.channel.id,
      providerNamespace: contract.channel.providerNamespace,
      accountHash: contract.channel.accountHash,
      adapter: contract.channel.adapter,
      touchpoints: [{
        type: "listing_id",
        referenceHash: sha256(`listing-${suffix}`),
      }],
    },
    buyerReference: `buyer-reference-${suffix}`,
    transaction: {
      rawTransactionId: `transaction-${suffix}`,
      eventType: "original",
      chain: {
        sequence: 0,
        predecessorRecordHash: null,
        reversesRecordHash: null,
      },
      status: "settled",
      occurredAt: "2026-08-15T00:00:00.000Z",
      settledAt: "2026-08-18T00:00:00.000Z",
      settlement: {
        state: "cash_settled",
        referenceHash: sha256(`cash-settlement-${suffix}`),
      },
      grossRevenue: {
        currency: "AUD",
        originalMinorUnits: 2900,
        audCents: 2900,
        conversion: { kind: "native_aud", minorUnitExponent: 2 },
      },
      refunds: {
        currency: "AUD",
        originalMinorUnits: 0,
        audCents: 0,
        conversion: { kind: "native_aud", minorUnitExponent: 2 },
      },
    },
  }, { pseudonymizationKey: BUYER_SECRET });
}

function receiptRow(contract, source, overrides = {}) {
  const envelope = {
    schema: "pantheon.commercial-test-evidence-receipt.v2",
    decisionHash: contract.decisionHash,
    receiptId: source.receipt.id,
    sourceKind: source.kind,
    sourceId: source.sourceId,
    providerNamespace: source.providerNamespace,
    accountHash: source.accountHash,
    sourceSystem: source.sourceSystem,
    exportType: source.exportType,
    sourceHash: source.sourceHash,
    receiptHash: source.receipt.hash,
    locationReference: source.receipt.locationReference,
    verificationStatus: source.verificationStatus,
    reportingPeriod: source.reportingPeriod,
    coverage: source.coverage,
    capturedAt: source.capturedAt,
    generatedAt: source.generatedAt ?? null,
    importedAt: source.importedAt ?? null,
    importBatchId: source.importBatchId ?? null,
    manualReferenceHash: source.manualReferenceHash ?? null,
    attestedBy: source.attestedBy ?? null,
    attestationNote: source.attestationNote ?? null,
    entryReason: source.entryReason ?? null,
  };
  return {
    decision_hash: contract.decisionHash,
    receipt_id: source.receipt.id,
    receipt_schema: envelope.schema,
    source_kind: source.kind,
    source_id: source.sourceId,
    provider_namespace: source.providerNamespace,
    account_hash: source.accountHash,
    source_system: source.sourceSystem,
    export_type: source.exportType,
    source_hash: source.sourceHash,
    receipt_hash: source.receipt.hash,
    location_reference: source.receipt.locationReference,
    verification_status: source.verificationStatus,
    reporting_starts_at: source.reportingPeriod.startsAt,
    reporting_ends_at: source.reportingPeriod.endsAt,
    coverage_basis: source.coverage.basis,
    coverage_declared_row_count: source.coverage.declaredRowCount,
    coverage_control_hash: source.coverage.controlHash,
    generated_at: source.generatedAt ?? null,
    imported_at: source.importedAt ?? null,
    import_batch_id: source.importBatchId ?? null,
    manual_reference_hash: source.manualReferenceHash ?? null,
    attested_by: source.attestedBy ?? null,
    attestation_note: source.attestationNote ?? null,
    entry_reason: source.entryReason ?? null,
    receipt_json: JSON.stringify(envelope),
    captured_at: source.capturedAt,
    created_at: "2026-09-01T01:00:00.000Z",
    ...overrides,
  };
}

function evidenceRow(record, overrides = {}) {
  const transaction = record.transaction;
  const cost = record.cost;
  return {
    record_hash: record.recordHash,
    evidence_schema: record.schema,
    decision_hash: record.testBinding.decisionHash,
    evidence_id: record.evidenceId,
    evidence_version: record.evidenceVersion,
    kind: record.kind,
    source_kind: record.source.kind,
    source_id: record.source.sourceId,
    provider_namespace: record.source.providerNamespace,
    account_hash: record.source.accountHash,
    source_system: record.source.sourceSystem,
    export_type: record.source.exportType,
    source_hash: record.source.sourceHash,
    source_row_hash: record.source.sourceRowHash,
    receipt_id: record.source.receipt.id,
    receipt_hash: record.source.receipt.hash,
    verification_status: record.source.verificationStatus,
    reporting_starts_at: record.source.reportingPeriod.startsAt,
    reporting_ends_at: record.source.reportingPeriod.endsAt,
    coverage_basis: record.source.coverage.basis,
    coverage_declared_row_count: record.source.coverage.declaredRowCount,
    coverage_control_hash: record.source.coverage.controlHash,
    captured_at: record.source.capturedAt,
    supersedes_record_hash: record.supersedesRecordHash,
    transaction_key: transaction?.transactionKey ?? null,
    transaction_id_hash: transaction?.transactionIdHash ?? null,
    transaction_economic_hash: transaction?.transactionEconomicHash ?? null,
    buyer_pseudonym: transaction?.buyer.pseudonym ?? null,
    buyer_key_id: transaction?.buyer.keyId ?? null,
    buyer_key_version: transaction?.buyer.keyVersion ?? null,
    buyer_independence_basis: transaction?.buyer.independenceBasis ?? null,
    transaction_event_type: transaction?.eventType ?? null,
    transaction_chain_sequence: transaction?.chain.sequence ?? null,
    transaction_status: transaction?.status ?? null,
    settlement_state: transaction?.settlement.state ?? null,
    settlement_reference_hash: transaction?.settlement.referenceHash ?? null,
    occurred_at: transaction?.occurredAt ?? cost?.occurredAt ?? null,
    settled_at: transaction?.settledAt ?? null,
    gross_revenue_original_minor_units:
      transaction?.grossRevenue.originalMinorUnits ?? null,
    gross_revenue_currency: transaction?.grossRevenue.currency ?? null,
    gross_revenue_aud_cents: transaction?.grossRevenue.audCents ?? null,
    refunds_original_minor_units: transaction?.refunds.originalMinorUnits ?? null,
    refunds_currency: transaction?.refunds.currency ?? null,
    refunds_aud_cents: transaction?.refunds.audCents ?? null,
    cost_key: cost?.costKey ?? null,
    cost_id_hash: cost?.costIdHash ?? null,
    cost_economic_hash: cost?.costEconomicHash ?? null,
    cost_event_type: cost?.eventType ?? null,
    cost_chain_sequence: cost?.chain.sequence ?? null,
    cost_category: cost?.category ?? null,
    cost_state: cost?.state ?? null,
    cost_original_minor_units: cost?.amount?.originalMinorUnits ?? null,
    cost_currency: cost?.amount?.currency ?? null,
    cost_aud_cents: cost?.amount?.audCents ?? null,
    attribution_status: record.attribution.status,
    record_json: JSON.stringify(record),
    created_at: record.source.capturedAt,
    ...overrides,
  };
}

function lifecycleRow(contract, sequence = 0, previous = null) {
  const payload = {
    schema: "pantheon.commercial-test-lifecycle-event.v2",
    id: `lifecycle.${sequence}`,
    decisionHash: contract.decisionHash,
    sequence,
    previousEventHash: previous?.event_hash ?? null,
    eventType: sequence === 0 ? "proposed" : "accepted",
    approvalId: null,
    approvalScopeHash: null,
    reason: sequence === 0 ? "Prepared for owner review." : "Accepted for exact test.",
    metadata: {},
    occurredAt: `2026-07-29T00:0${sequence}:00.000Z`,
  };
  const eventHash = sha256(payload);
  return {
    id: payload.id,
    decision_hash: contract.decisionHash,
    sequence,
    previous_event_hash: payload.previousEventHash,
    event_type: payload.eventType,
    event_hash: eventHash,
    approval_id: null,
    approval_scope_hash: null,
    reason: payload.reason,
    metadata: "{}",
    event_json: JSON.stringify({ ...payload, eventHash }),
    occurred_at: payload.occurredAt,
    created_at: payload.occurredAt,
  };
}

function evaluationRow(contract) {
  const evaluation = {
    schema: "pantheon.commercial-test-proof-evaluation.v2",
    decisionHash: contract.decisionHash,
    evidenceSetHash: sha256("empty-evidence-set"),
    outcome: "inconclusive",
    proofReached: false,
    buyerSignalOnly: false,
    evidence: { distinctPositiveBuyers: 0 },
    financials: {
      settledRevenueAudCents: 0,
      refundsAudCents: 0,
      reconciledCostsAudCents: 0,
      actualNetCashContributionAudCents: 0,
    },
  };
  evaluation.evaluationHash = sha256(evaluation);
  return {
    evaluation_hash: evaluation.evaluationHash,
    proof_schema: evaluation.schema,
    decision_hash: contract.decisionHash,
    evidence_set_hash: evaluation.evidenceSetHash,
    outcome: evaluation.outcome,
    proof_reached: 0,
    buyer_signal_only: 0,
    distinct_positive_buyers: 0,
    settled_revenue_aud_cents: 0,
    refunds_aud_cents: 0,
    reconciled_costs_aud_cents: 0,
    actual_net_cash_contribution_aud_cents: 0,
    evaluation_json: JSON.stringify(evaluation),
    evaluated_at: "2026-09-01T02:00:00.000Z",
    created_at: "2026-09-01T02:00:00.000Z",
  };
}

function clonedTransactionRecord(record, suffix, changes = {}) {
  const clone = structuredClone(record);
  clone.evidenceId = `evidence.transaction.${suffix}`;
  clone.evidenceVersion = "1.0.0";
  clone.source.sourceRowHash = sha256(`source-row-${suffix}`);
  clone.transaction.transactionIdHash = sha256(`transaction-id-${suffix}`);
  clone.transaction.transactionKey = sha256(`transaction-key-${suffix}`);
  clone.transaction.transactionEconomicHash = sha256(`transaction-economics-${suffix}`);
  clone.transaction.buyer.pseudonym = `buyer_${sha256(`buyer-${suffix}`).slice(7)}`;
  Object.assign(clone.transaction, changes.transaction || {});
  if (changes.chain) Object.assign(clone.transaction.chain, changes.chain);
  if (changes.settlement) Object.assign(clone.transaction.settlement, changes.settlement);
  clone.supersedesRecordHash = clone.transaction.chain.predecessorRecordHash;
  clone.recordHash = sha256(`record-${suffix}`);
  return clone;
}

test("fresh migration creates the exact immutable commercial ledger and kit hash", () => {
  const runtime = createRuntime("fresh");
  try {
    assert.equal(
      get(runtime.db, "SELECT MAX(version) AS version FROM schema_migrations").version,
      LATEST_SCHEMA_VERSION,
    );
    const kit = runtime.db.prepare(
      "SELECT * FROM venture_kits WHERE id = ? AND version = ?",
    ).get("digital_product_v1", 1);
    assert.equal(kit.content_hash, ventureKitContentHash(kit));
    assert.deepEqual(verifyDatabase(runtime.db), {
      quickCheck: "ok",
      foreignKeyFailures: 0,
      schemaVersion: LATEST_SCHEMA_VERSION,
    });
    assert.equal(
      get(
        runtime.db,
        "SELECT COUNT(*) AS count FROM commercial_test_proof_evaluations",
      ).count,
      0,
    );
  } finally {
    closeRuntime(runtime);
  }
});

test("migration upgrades a supported schema 24 runtime and deterministically backfills kit hashes", () => {
  const runtime = createRuntime("n-minus-one");
  const expectedKitHash = getVentureKit(
    runtime.db,
    "digital_product_v1",
    1,
  ).contentHash;
  runtime.db.close();
  runtime.db = null;

  downgradeDatabaseToLegacySchema24(runtime.dbPath);

  try {
    runtime.db = openDatabase(runtime.dbPath);
    assert.equal(
      get(runtime.db, "SELECT MAX(version) AS version FROM schema_migrations").version,
      LATEST_SCHEMA_VERSION,
    );
    assert.equal(
      get(
        runtime.db,
        "SELECT content_hash FROM venture_kits WHERE id = 'digital_product_v1' AND version = 1",
      ).content_hash,
      expectedKitHash,
    );
    assert.deepEqual(verifyDatabase(runtime.db), {
      quickCheck: "ok",
      foreignKeyFailures: 0,
      schemaVersion: LATEST_SCHEMA_VERSION,
    });
  } finally {
    closeRuntime(runtime);
  }
});

test("contract, receipt, and evidence JSON must match every projected SQL identity", () => {
  const runtime = createRuntime("json-identity");
  try {
    const contract = contractFixture(runtime.db);
    assert.throws(
      () => insertRow(
        runtime.db,
        "commercial_test_contracts",
        contractRow(contract, { offer_id: "offer.wrong" }),
      ),
      /CHECK constraint failed/i,
    );
    insertRow(runtime.db, "commercial_test_contracts", contractRow(contract));

    const transaction = transactionFixture(contract);
    assert.throws(
      () => insertRow(
        runtime.db,
        "commercial_test_evidence_receipts",
        receiptRow(contract, transaction.source, {
          provider_namespace: "wrong_provider",
        }),
      ),
      /CHECK constraint failed/i,
    );
    insertRow(
      runtime.db,
      "commercial_test_evidence_receipts",
      receiptRow(contract, transaction.source),
    );
    assert.throws(
      () => insertRow(
        runtime.db,
        "commercial_test_evidence_records",
        evidenceRow(transaction, {
          gross_revenue_aud_cents: transaction.transaction.grossRevenueAudCents + 1,
        }),
      ),
      /CHECK constraint failed/i,
    );
    insertRow(
      runtime.db,
      "commercial_test_evidence_records",
      evidenceRow(transaction),
    );
  } finally {
    closeRuntime(runtime);
  }
});

test("kit definitions and every commercial ledger table reject update and delete", () => {
  const runtime = createRuntime("immutable");
  try {
    const contract = contractFixture(runtime.db);
    const transaction = transactionFixture(contract);
    insertRow(runtime.db, "commercial_test_contracts", contractRow(contract));
    const lifecycle = lifecycleRow(contract);
    insertRow(runtime.db, "commercial_test_lifecycle_events", lifecycle);
    insertRow(
      runtime.db,
      "commercial_test_evidence_receipts",
      receiptRow(contract, transaction.source),
    );
    insertRow(
      runtime.db,
      "commercial_test_evidence_records",
      evidenceRow(transaction),
    );
    insertRow(
      runtime.db,
      "commercial_test_proof_evaluations",
      evaluationRow(contract),
    );

    assert.doesNotThrow(() => runtime.db.prepare(
      "UPDATE venture_kits SET status = status, updated_at = updated_at WHERE id = ? AND version = ?",
    ).run("digital_product_v1", 1));
    assert.throws(
      () => runtime.db.prepare(
        "UPDATE venture_kits SET name = name WHERE id = ? AND version = ?",
      ).run("digital_product_v1", 1),
      /immutable/i,
    );
    assert.throws(
      () => runtime.db.prepare(
        "DELETE FROM venture_kits WHERE id = ? AND version = ?",
      ).run("digital_product_v1", 1),
      /immutable/i,
    );

    const protectedRows = [
      ["commercial_test_contracts", "decision_hash", contract.decisionHash],
      ["commercial_test_lifecycle_events", "id", lifecycle.id],
      [
        "commercial_test_evidence_receipts",
        "receipt_id",
        transaction.source.receipt.id,
      ],
      [
        "commercial_test_evidence_records",
        "record_hash",
        transaction.recordHash,
      ],
      [
        "commercial_test_proof_evaluations",
        "decision_hash",
        contract.decisionHash,
      ],
    ];
    for (const [table, key, value] of protectedRows) {
      assert.throws(
        () => runtime.db.prepare(
          `UPDATE ${table} SET ${key} = ${key} WHERE ${key} = ?`,
        ).run(value),
        /immutable|append-only/i,
        `${table} update must be rejected`,
      );
      assert.throws(
        () => runtime.db.prepare(`DELETE FROM ${table} WHERE ${key} = ?`).run(value),
        /immutable|append-only/i,
        `${table} delete must be rejected`,
      );
    }
  } finally {
    closeRuntime(runtime);
  }
});

test("database verification rejects weakened critical schema and false immutable identities", () => {
  const triggerRuntime = createRuntime("tampered-trigger");
  try {
    triggerRuntime.db.exec(`
      DROP TRIGGER trg_commercial_test_records_immutable_update;
      CREATE TRIGGER trg_commercial_test_records_immutable_update
      BEFORE UPDATE ON commercial_test_evidence_records
      WHEN 0
      BEGIN
        SELECT RAISE(ABORT, 'Commercial evidence records are immutable; append a revision.');
      END;
    `);
    assert.throws(
      () => verifyDatabase(triggerRuntime.db),
      /exact immutable definition/i,
    );
  } finally {
    closeRuntime(triggerRuntime);
  }

  const indexRuntime = createRuntime("missing-index");
  try {
    indexRuntime.db.exec("DROP INDEX idx_commercial_test_transaction_key");
    assert.throws(
      () => verifyDatabase(indexRuntime.db),
      /required ledger definition/i,
    );
  } finally {
    closeRuntime(indexRuntime);
  }

  const ownershipRuntime = createRuntime("tampered-ownership-trigger");
  try {
    ownershipRuntime.db.exec(`
      DROP TRIGGER trg_tasks_venture_match_insert;
      CREATE TRIGGER trg_tasks_venture_match_insert
      BEFORE INSERT ON tasks
      WHEN 0
      BEGIN
        SELECT RAISE(ABORT, 'Task venture ownership is required.');
      END;
    `);
    assert.throws(
      () => verifyDatabase(ownershipRuntime.db),
      /does not match the exact supported definition/i,
    );
  } finally {
    closeRuntime(ownershipRuntime);
  }

  const accountingIndexRuntime = createRuntime("missing-accounting-index");
  try {
    accountingIndexRuntime.db.exec("DROP INDEX idx_accounting_entries_occurred");
    assert.throws(
      () => verifyDatabase(accountingIndexRuntime.db),
      /missing required index idx_accounting_entries_occurred/i,
    );
  } finally {
    closeRuntime(accountingIndexRuntime);
  }

  const columnRuntime = createRuntime("missing-accounting-column");
  try {
    columnRuntime.db.exec("ALTER TABLE accounting_entries DROP COLUMN metadata");
    assert.throws(
      () => verifyDatabase(columnRuntime.db),
      /table accounting_entries (?:is missing|does not match)/i,
    );
  } finally {
    closeRuntime(columnRuntime);
  }

  const kitRuntime = createRuntime("false-kit-hash");
  try {
    kitRuntime.db.exec(`
      INSERT INTO venture_kits (
        id, version, status, name, business_models, eligibility_rules,
        evidence_requirements, capability_requirements, channel_policy,
        acceptance_criteria, metadata, created_at, updated_at, content_hash
      )
      SELECT
        'tampered_kit', 1, status, 'Tampered kit', business_models, eligibility_rules,
        evidence_requirements, capability_requirements, channel_policy,
        acceptance_criteria, metadata, created_at, updated_at,
        'sha256:0000000000000000000000000000000000000000000000000000000000000000'
      FROM venture_kits
      WHERE id = 'digital_product_v1' AND version = 1
    `);
    assert.throws(
      () => verifyDatabase(kitRuntime.db),
      /does not match its immutable content hash/i,
    );
  } finally {
    closeRuntime(kitRuntime);
  }
});

test("one immutable record can have only one direct superseding revision", () => {
  const runtime = createRuntime("supersession");
  try {
    const contract = contractFixture(runtime.db);
    const original = transactionFixture(contract);
    insertRow(runtime.db, "commercial_test_contracts", contractRow(contract));
    insertRow(
      runtime.db,
      "commercial_test_evidence_receipts",
      receiptRow(contract, original.source),
    );
    insertRow(runtime.db, "commercial_test_evidence_records", evidenceRow(original));

    const firstRevision = clonedTransactionRecord(original, "revision-one", {
      transaction: { eventType: "correction" },
      chain: {
        sequence: 1,
        predecessorRecordHash: original.recordHash,
        reversesRecordHash: null,
      },
    });
    const conflictingRevision = clonedTransactionRecord(original, "revision-two", {
      transaction: { eventType: "correction" },
      chain: {
        sequence: 1,
        predecessorRecordHash: original.recordHash,
        reversesRecordHash: null,
      },
    });
    insertRow(
      runtime.db,
      "commercial_test_evidence_records",
      evidenceRow(firstRevision),
    );
    assert.throws(
      () => insertRow(
        runtime.db,
        "commercial_test_evidence_records",
        evidenceRow(conflictingRevision),
      ),
      /UNIQUE constraint failed/i,
    );
  } finally {
    closeRuntime(runtime);
  }
});

test("platform balance is stored distinctly and cannot masquerade as cash settlement", () => {
  const runtime = createRuntime("settlement-state");
  try {
    const contract = contractFixture(runtime.db);
    const base = transactionFixture(contract);
    insertRow(runtime.db, "commercial_test_contracts", contractRow(contract));
    insertRow(
      runtime.db,
      "commercial_test_evidence_receipts",
      receiptRow(contract, base.source),
    );

    const platformBalance = clonedTransactionRecord(base, "platform-balance", {
      transaction: {
        status: "pending",
        settledAt: null,
      },
      settlement: {
        state: "platform_balance",
        referenceHash: null,
      },
    });
    insertRow(
      runtime.db,
      "commercial_test_evidence_records",
      evidenceRow(platformBalance),
    );
    const stored = runtime.db.prepare(
      `SELECT settlement_state, settled_at, settlement_reference_hash
       FROM commercial_test_evidence_records
       WHERE record_hash = ?`,
    ).get(platformBalance.recordHash);
    assert.deepEqual({ ...stored }, {
      settlement_state: "platform_balance",
      settled_at: null,
      settlement_reference_hash: null,
    });

    const falseCash = clonedTransactionRecord(base, "false-cash", {
      transaction: {
        status: "settled",
        settledAt: "2026-08-18T00:00:00.000Z",
      },
      settlement: {
        state: "platform_balance",
        referenceHash: sha256("not-a-cash-settlement"),
      },
    });
    assert.throws(
      () => insertRow(
        runtime.db,
        "commercial_test_evidence_records",
        evidenceRow(falseCash),
      ),
      /CHECK constraint failed/i,
    );

    const missingSettlementProof = clonedTransactionRecord(base, "missing-proof", {
      transaction: {
        status: "settled",
        settledAt: "2026-08-18T00:00:00.000Z",
      },
      settlement: {
        state: "cash_settled",
        referenceHash: null,
      },
    });
    assert.throws(
      () => insertRow(
        runtime.db,
        "commercial_test_evidence_records",
        evidenceRow(missingSettlementProof),
      ),
      /CHECK constraint failed/i,
    );
  } finally {
    closeRuntime(runtime);
  }
});
