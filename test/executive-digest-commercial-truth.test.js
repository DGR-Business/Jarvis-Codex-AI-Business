"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  get,
  openDatabase,
  run,
  seedDatabase,
  toJson,
} = require("../src/db");
const {
  commercialLifecycleApprovalScope,
  commercialLifecycleApprovalScopeHash,
} = require("../src/runtime/commercial-authority");
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
  createCommercialTestStore,
} = require("../src/runtime/commercial-test-store");
const {
  getCommercialOwnerTestsState,
} = require("../src/runtime/commercial-owner-state");
const {
  EXECUTIVE_DIGEST_METRICS_SCHEMA,
  ensureWeeklyDigest,
  generateWeeklyDigest,
  getCanonicalOwnerDigest,
  weekWindow,
} = require("../src/runtime/executive-digest");
const {
  getCockpitState,
} = require("../src/runtime/cockpit-state");
const {
  ventureKitContentHash,
} = require("../src/runtime/venture-kit-definition");
const { createApp } = require("../src/server");

const VENTURE_ID = "venture-digital-products";
const DIGEST_AT = "2026-07-14T12:00:00.000Z";
const STORE_TIME = "2026-09-03T00:00:00.000Z";
const BUYER_SECRET = "digest-fixture-private-buyer-hmac-secret";
const LEGACY_SECRET = "legacy-private-commercial-secret";
const PERIOD = Object.freeze({
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

function registerFixtureKit(db) {
  const kit = {
    id: "digital_product_v1",
    version: 1,
    status: "active",
    name: "Digital product",
    businessModels: ["digital_product"],
    eligibilityRules: {},
    evidenceRequirements: {},
    capabilityRequirements: [],
    channelPolicy: {},
    acceptanceCriteria: {},
    metadata: {},
  };
  const contentHash = ventureKitContentHash(kit);
  run(
    db,
    `INSERT INTO venture_kits
     (id, version, status, name, business_models, eligibility_rules,
      evidence_requirements, capability_requirements, channel_policy,
      acceptance_criteria, metadata, created_at, updated_at, content_hash)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      kit.id,
      kit.version,
      kit.status,
      kit.name,
      toJson(kit.businessModels),
      toJson(kit.eligibilityRules),
      toJson(kit.evidenceRequirements),
      toJson(kit.capabilityRequirements),
      toJson(kit.channelPolicy),
      toJson(kit.acceptanceCriteria),
      toJson(kit.metadata),
      STORE_TIME,
      STORE_TIME,
      contentHash,
    ],
  );
  return { ...kit, contentHash };
}

function makeRuntime(name, options = {}) {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), `pantheon-executive-digest-${name}-`),
  );
  const db = openDatabase(path.join(root, "runtime.sqlite"));
  seedDatabase(db);
  const kit = options.registerFixtureKit === false
    ? null
    : registerFixtureKit(db);
  const store = createCommercialTestStore(db, {
    clock: () => STORE_TIME,
    verifyImportedReceipt: () => true,
    pseudonymizeBuyer: (contract, buyerReference) => (
      pseudonymizeBuyer(contract, buyerReference, BUYER_SECRET)
    ),
  });
  return { root, db, kit, store };
}

function closeRuntime(runtime) {
  runtime.db.close();
  fs.rmSync(runtime.root, { recursive: true, force: true });
}

async function startRuntimeApp(runtime) {
  const app = createApp({
    db: runtime.db,
    dbPath: path.join(runtime.root, "runtime.sqlite"),
    schedulerEnabled: false,
    security: false,
  });
  if (!runtime.kit) {
    const kit = get(
      runtime.db,
      `SELECT id, version, content_hash
       FROM venture_kits
       WHERE status = 'active'
       ORDER BY version DESC LIMIT 1`,
    );
    runtime.kit = {
      id: kit.id,
      version: kit.version,
      contentHash: kit.content_hash,
    };
  }
  await new Promise((resolve, reject) => {
    app.server.once("error", reject);
    app.server.listen(0, "127.0.0.1", resolve);
  });
  return {
    ...app,
    origin: `http://127.0.0.1:${app.server.address().port}`,
  };
}

async function stopRuntimeApp(app) {
  for (const client of app.wss.clients) client.terminate();
  await new Promise((resolve) => app.server.close(resolve));
  app.wss.close();
}

function digestGeneratedEventCount(db) {
  return get(
    db,
    `SELECT COUNT(*) AS count FROM events
     WHERE type = 'executive_digest.generated'`,
  ).count;
}

function contaminateStoredDigest(db, at = new Date()) {
  const window = weekWindow(new Date(at));
  const stored = get(
    db,
    `SELECT id, metrics FROM executive_digests
     WHERE venture_id = ? AND period_start = ?`,
    [VENTURE_ID, window.start],
  );
  assert.ok(stored, "Expected the runtime foundation to create this week's digest.");
  const metrics = JSON.parse(stored.metrics);
  run(
    db,
    `UPDATE executive_digests
     SET title = ?,
         summary = ?,
         metrics = ?,
         decisions = ?,
         learning = ?,
         next_actions = ?
     WHERE id = ?`,
    [
      `Legacy ${LEGACY_SECRET}`,
      `99 buyers and A$9,900.00 proved by ${LEGACY_SECRET}`,
      toJson({
        ...metrics,
        verifiedBuyerCount: 99,
        cashStatus: "settled",
        cashContributionCents: 990000,
        currentTest: {
          auditRef: "legacy-private-audit-ref",
          name: LEGACY_SECRET,
          status: "activated",
          statusLabel: "Activated",
          canonicalOwnerProjection: true,
        },
      }),
      toJson([{ title: LEGACY_SECRET, status: "approved" }]),
      toJson([LEGACY_SECRET]),
      toJson([LEGACY_SECRET]),
      stored.id,
    ],
  );
}

function protectedActions() {
  return Object.fromEntries(PROTECTED_ACTION_KEYS.map((key) => [key, true]));
}

function buildContract(runtime, suffix = "primary") {
  const offer = {
    id: `offer.digest_${suffix}`,
    version: "1.0.0",
    sku: `digest_${suffix}_aud_29`,
    description: `Canonical Scope Guard Kit ${suffix}`,
    contentHash: sha256(`digest-offer-content-${suffix}`),
  };
  offer.hash = offerDefinitionHash(offer);
  const accountHash = sha256(`private-marketplace-account-${suffix}`);
  return createCommercialTestContract({
    programId: `program.digest_${suffix}`,
    programVersion: "1.0.0",
    testId: `test.digest_${suffix}`,
    testVersion: "1.0.0",
    ventureId: VENTURE_ID,
    ventureKit: {
      id: runtime.kit.id,
      version: runtime.kit.version,
      hash: runtime.kit.contentHash,
    },
    offerId: offer.id,
    offer,
    buyer: "Independent social media managers with retained clients",
    problem: "Client approvals and scope changes are fragmented",
    experiment: {
      id: `experiment.digest_${suffix}`,
      version: "1.0.0",
      hypothesis: "The exact buyer will pay A$29 for the operational kit",
      primaryMetric: "positive_independent_settled_buyers",
      deadlineAt: "2026-09-02T00:00:00.000Z",
    },
    cohort: {
      id: `cohort.digest_${suffix}`,
      definition: "Buyers exposed only to the authorised marketplace listing",
    },
    reportingPeriod: PERIOD,
    channel: {
      id: "marketplace_alpha",
      providerNamespace: "marketplace_alpha",
      accountHash,
      adapter: {
        id: "marketplace_adapter",
        version: "2.0.0",
        hash: sha256("digest-marketplace-adapter-v2"),
      },
    },
    price: {
      currency: "AUD",
      amountMinorUnits: 2900,
      amountAudCents: 2900,
    },
    buyerIdentity: {
      method: "hmac_sha256",
      keyId: "digest_fixture_buyer_hmac_key",
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
      acceptedSourceKinds: [
        "imported_platform",
        "operator_attested_manual",
      ],
      requiredCostCategories: COST_CATEGORIES,
      requiredSources: [{
        id: "platform_settlement_records",
        acceptedKinds: [
          "imported_platform",
          "operator_attested_manual",
        ],
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
        criteria: [
          "Three buyers, positive actual AUD contribution, complete evidence",
        ],
        nextAction: "Present a separately approved scale recommendation.",
      },
      revise: {
        criteria: [
          "Buyer proof exists but actual contribution is not positive",
        ],
        nextAction: "Diagnose offer, channel, price, refunds, and costs.",
      },
      inconclusive: {
        criteria: [
          "Evidence is incomplete, contradictory, or below proof volume",
        ],
        nextAction: "Collect only the smallest decision-critical missing fact.",
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

function createApproval(runtime, contract, eventType, id) {
  const scope = commercialLifecycleApprovalScope(contract, eventType);
  const scopeHash = commercialLifecycleApprovalScopeHash(contract, eventType);
  run(
    runtime.db,
    `INSERT INTO approvals
     (id, scope, scope_hash, title, status, risk_level, requested_by,
      requested_at, decided_at, decision_note, payload)
     VALUES (?, ?, ?, ?, 'approved', 'high', 'jarvis', ?, ?, ?, ?)`,
    [
      id,
      canonicalJson(scope),
      scopeHash,
      `${eventType} commercial test`,
      "2026-07-30T00:00:00.000Z",
      "2026-07-30T00:01:00.000Z",
      "Approved for focused proof.",
      canonicalJson({
        commercialTestApprovalScope: scope,
        commercialTestApprovalScopeHash: scopeHash,
      }),
    ],
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

function contaminateLegacyCommercialRows(db) {
  const timestamp = "2026-07-14T07:00:00.000Z";
  run(
    db,
    `INSERT INTO commercial_experiments
     (id, venture_id, name, status, hypothesis, buyer, offer, channel,
      price_cents, expected_metric, target_value, target_unit, cost_cap_cents,
      metadata, created_at, updated_at)
     VALUES (
       'legacy-digest-experiment',
       ?,
       'Legacy fake success',
       'running',
       'Legacy rows must not drive the digest.',
       ?,
       'Legacy secret offer',
       'Legacy secret channel',
       9900,
       'Legacy secret metric',
       99,
       'buyers',
       0,
       '{}',
       ?,
       ?
     )`,
    [VENTURE_ID, LEGACY_SECRET, timestamp, timestamp],
  );
  run(
    db,
    `INSERT INTO commercial_results
     (id, experiment_id, source, status, views, clicks, leads, sales, refunds,
      revenue_cents, spend_cents, time_spent_minutes, notes, occurred_at,
      metadata, created_at)
     VALUES (
       'legacy-digest-result',
       'legacy-digest-experiment',
       'manual',
       'recorded',
       1000,
       900,
       800,
       99,
       0,
       990000,
       0,
       1,
       ?,
       ?,
       '{}',
       ?
     )`,
    [LEGACY_SECRET, timestamp, timestamp],
  );
  run(
    db,
    `INSERT INTO platform_sales
     (id, venture_id, platform, platform_purchase_id, product_name, sold_at,
      currency, gross_cents, platform_fee_cents, net_cents, refunded_cents,
      referrer, buyer_hash, status, metadata, imported_at)
     VALUES (
       'legacy-digest-sale',
       ?,
       'legacy',
       'legacy-private-purchase',
       'Legacy fake success',
       ?,
       'AUD',
       990000,
       0,
       990000,
       0,
       'legacy',
       ?,
       'paid',
       '{}',
       ?
     )`,
    [VENTURE_ID, timestamp, LEGACY_SECRET, timestamp],
  );
}

function contaminateCurrentWeekDigest(db) {
  const window = weekWindow(new Date(DIGEST_AT));
  run(
    db,
    `INSERT INTO executive_digests
     (id, venture_id, period_start, period_end, status, title, summary, metrics,
      decisions, learning, next_actions, generated_at)
     VALUES (
       'legacy-current-week-digest',
       ?,
       ?,
       ?,
       'on_track',
       'Legacy secret brief',
       ?,
       ?,
       ?,
       ?,
       ?,
       '2026-07-14T08:00:00.000Z'
     )`,
    [
      VENTURE_ID,
      window.start,
      window.end,
      LEGACY_SECRET,
      toJson({
        independentBuyers: 99,
        cashContributionCents: 990000,
        currentTest: { name: LEGACY_SECRET, status: "running" },
      }),
      toJson([{ title: LEGACY_SECRET }]),
      toJson([LEGACY_SECRET]),
      toJson([LEGACY_SECRET]),
    ],
  );
}

function insertOperationalFacts(db) {
  const window = weekWindow(new Date(DIGEST_AT));
  const withinWeek = new Date(
    new Date(window.start).getTime() + 60 * 60 * 1000,
  ).toISOString();
  run(
    db,
    `INSERT INTO tasks
     (id, venture_id, title, kind, agent, status, priority, payload, result,
      outcome_status, completed_at, created_at, updated_at)
     VALUES (
       'digest-completed-task',
       ?,
       'Completed internal proof',
       'internal',
       'jarvis',
       'completed',
       1,
       '{}',
       '{}',
       'succeeded',
       ?,
       ?,
       ?
     )`,
    [VENTURE_ID, withinWeek, withinWeek, withinWeek],
  );
  run(
    db,
    `INSERT INTO tasks
     (id, venture_id, title, kind, agent, status, priority, payload, result,
      outcome_status, created_at, updated_at)
     VALUES (
       'digest-unknown-task',
       ?,
       'Unknown provider outcome',
       'internal',
       'jarvis',
       'blocked',
       1,
       '{}',
       '{}',
       'unknown',
       ?,
       ?
     )`,
    [VENTURE_ID, withinWeek, withinWeek],
  );
  run(
    db,
    `INSERT INTO approvals
     (id, venture_id, scope, title, status, risk_level, requested_by,
      requested_at, payload)
     VALUES (
       'digest-pending-decision',
       ?,
       'internal_review',
       'Review one waiting decision',
       'pending',
       'medium',
       'jarvis',
       ?,
       '{}'
     )`,
    [VENTURE_ID, withinWeek],
  );
  run(
    db,
    `INSERT INTO monitor_runs
     (id, status, severity, finding_count, started_at, completed_at, metadata)
     VALUES (
       'digest-monitor-run',
       'attention',
       'error',
       1,
       ?,
       ?,
       '{}'
     )`,
    [withinWeek, withinWeek],
  );
  run(
    db,
    `INSERT INTO monitor_findings
     (id, run_id, venture_id, severity, category, entity_type, entity_id,
      title, detail, status, metadata, created_at)
     VALUES (
       'digest-monitor-finding',
       'digest-monitor-run',
       ?,
       'error',
       'runtime',
       'task',
       'digest-unknown-task',
       'One operating issue',
       'The test fixture has one operating issue.',
       'open',
       '{}',
       ?
     )`,
    [VENTURE_ID, withinWeek],
  );
}

function protectedRowCounts(db) {
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
    get(db, `SELECT COUNT(*) AS count FROM ${table}`).count,
  ]));
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
  const sourceHash = sha256(`digest-source-${token}`);
  const receiptHash = sha256(`digest-receipt-${token}`);
  return {
    kind: "imported_platform",
    sourceId: "platform_settlement_records",
    providerNamespace: contract.channel.providerNamespace,
    accountHash: contract.channel.accountHash,
    sourceSystem: "marketplace_settlement",
    exportType: "settlement_record_v2",
    sourceHash,
    sourceRowHash: sha256(`digest-row-${token}`),
    receipt: {
      id: `digest_receipt_${token}`,
      hash: receiptHash,
      locationReference: `private_retained_${token}`,
    },
    verificationStatus: "pending",
    reportingPeriod: PERIOD,
    capturedAt: "2026-09-01T00:02:00.000Z",
    generatedAt: "2026-09-01T00:00:00.000Z",
    importedAt: "2026-09-01T00:01:00.000Z",
    importBatchId: `digest_batch_${token}`,
    coverage: coverage("imported_platform", sourceHash, receiptHash),
  };
}

function manualManifestSource(contract) {
  const sourceHash = sha256("digest-manual-source-manifest");
  const receiptHash = sha256("digest-manual-receipt-manifest");
  return {
    kind: "operator_attested_manual",
    sourceId: "platform_settlement_records",
    providerNamespace: contract.channel.providerNamespace,
    accountHash: contract.channel.accountHash,
    sourceSystem: "marketplace_settlement",
    exportType: "settlement_record_v2",
    sourceHash,
    sourceRowHash: sha256("digest-manual-row-manifest"),
    receipt: {
      id: "digest_manual_receipt_manifest",
      hash: receiptHash,
      locationReference: "private_manual_retained_manifest",
    },
    verificationStatus: "pending",
    reportingPeriod: PERIOD,
    capturedAt: "2026-09-02T01:00:00.000Z",
    manualReferenceHash: sha256("digest-manual-reference-manifest"),
    attestedBy: "jarvis_operator",
    attestationNote: "Matched against the exact retained settlement receipt.",
    entryReason: "A structured platform manifest was unavailable.",
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
      referenceHash: sha256("digest-private-listing"),
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
    evidenceId: `digest_evidence_transaction_${number}`,
    evidenceVersion: "1.0.0",
    kind: "transaction",
    attribution: attribution(contract),
    buyerReference: `private-digest-buyer-${number}@example.test`,
    transaction: {
      rawTransactionId: `private-digest-transaction-${number}`,
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
        referenceHash: sha256(`digest-private-settlement-${number}`),
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
    evidenceId: `digest_evidence_cost_${category}`,
    evidenceVersion: "1.0.0",
    kind: "cost",
    attribution: attribution(contract),
    cost: {
      rawCostId: `private-digest-cost-${category}`,
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
    evidenceId: "digest_evidence_manifest_0",
    evidenceVersion: "1.0.0",
    source: manualManifestSource(contract),
    attribution: attribution(contract),
    closedAt: "2026-09-02T01:00:00.000Z",
  });
}

test("stale and contaminated legacy rows cannot create digest buyer or cash claims", () => {
  const runtime = makeRuntime("legacy");
  try {
    contaminateLegacyCommercialRows(runtime.db);
    contaminateCurrentWeekDigest(runtime.db);
    insertOperationalFacts(runtime.db);
    const protectedBefore = protectedRowCounts(runtime.db);

    const digest = ensureWeeklyDigest(runtime.db, { at: DIGEST_AT });

    assert.notEqual(digest.id, "legacy-current-week-digest");
    assert.equal(digest.metrics.schema, EXECUTIVE_DIGEST_METRICS_SCHEMA);
    assert.equal(digest.metrics.verifiedBuyerCount, null);
    assert.equal(digest.metrics.buyerTarget, null);
    assert.equal(digest.metrics.cashStatus, "not_current");
    assert.equal(digest.metrics.cashContributionCents, null);
    assert.equal(digest.metrics.currentTest, null);
    assert.equal(digest.metrics.completedWork, 1);
    assert.equal(digest.metrics.openDecisions, 1);
    assert.equal(digest.metrics.unknownOutcomes, 1);
    assert.equal(digest.metrics.operatingIssues, 1);
    assert.match(
      digest.summary,
      /No current commercial test buyer result is available/,
    );
    assert.match(
      digest.summary,
      /No current commercial test net cash result is available/,
    );
    assert.match(digest.summary, /No commercial test is authorised/);
    assert.deepEqual(protectedRowCounts(runtime.db), protectedBefore);
    assert.equal(
      get(runtime.db, "SELECT COUNT(*) AS count FROM executive_digests").count,
      1,
    );

    const encoded = JSON.stringify(digest);
    const stored = get(
      runtime.db,
      `SELECT title, summary, metrics, decisions, learning, next_actions
       FROM executive_digests WHERE id = ?`,
      [digest.id],
    );
    assert.equal(encoded.includes(LEGACY_SECRET), false);
    assert.equal(JSON.stringify(stored).includes(LEGACY_SECRET), false);
    assert.equal(encoded.includes("Legacy fake success"), false);
    assert.equal(JSON.stringify(stored).includes("Legacy fake success"), false);

    const eventCount = get(
      runtime.db,
      `SELECT COUNT(*) AS count FROM events
       WHERE type = 'executive_digest.generated'`,
    ).count;
    const unchanged = ensureWeeklyDigest(runtime.db, { at: DIGEST_AT });
    assert.equal(unchanged.id, digest.id);
    assert.equal(
      get(
        runtime.db,
        `SELECT COUNT(*) AS count FROM events
         WHERE type = 'executive_digest.generated'`,
      ).count,
      eventCount,
    );

    run(
      runtime.db,
      "UPDATE executive_digests SET metrics = ? WHERE id = ?",
      [
        toJson({
          ...digest.metrics,
          verifiedBuyerCount: 99,
          cashStatus: "settled",
          cashContributionCents: 990000,
          legacySecret: LEGACY_SECRET,
        }),
        digest.id,
      ],
    );
    const repaired = ensureWeeklyDigest(runtime.db, { at: DIGEST_AT });
    assert.equal(repaired.metrics.verifiedBuyerCount, null);
    assert.equal(repaired.metrics.buyerTarget, null);
    assert.equal(repaired.metrics.cashStatus, "not_current");
    assert.equal(repaired.metrics.cashContributionCents, null);
    assert.equal(JSON.stringify(repaired).includes(LEGACY_SECRET), false);
  } finally {
    closeRuntime(runtime);
  }
});

test("owner read APIs repair adversarial digest state once and keep projections canonical", async () => {
  const runtime = makeRuntime("owner-http", { registerFixtureKit: false });
  let app = null;
  try {
    contaminateLegacyCommercialRows(runtime.db);
    app = await startRuntimeApp(runtime);
    contaminateStoredDigest(runtime.db);
    const beforeRepair = digestGeneratedEventCount(runtime.db);

    const digestResponse = await fetch(`${app.origin}/api/executive-digest`);
    const digestPayload = await digestResponse.json();

    assert.equal(digestResponse.status, 200);
    assert.equal(digestGeneratedEventCount(runtime.db), beforeRepair + 1);
    assert.equal(
      digestPayload.digest.metrics.schema,
      EXECUTIVE_DIGEST_METRICS_SCHEMA,
    );
    assert.equal(digestPayload.digest.metrics.verifiedBuyerCount, null);
    assert.equal(digestPayload.digest.metrics.buyerTarget, null);
    assert.equal(digestPayload.digest.metrics.cashStatus, "not_current");
    assert.equal(digestPayload.digest.metrics.cashContributionCents, null);
    assert.equal(digestPayload.digest.metrics.currentTest, null);
    assert.equal(
      JSON.stringify(digestPayload).includes(LEGACY_SECRET),
      false,
    );

    const afterRepair = digestGeneratedEventCount(runtime.db);
    const cockpitResponse = await fetch(`${app.origin}/api/cockpit`);
    const cockpit = await cockpitResponse.json();
    const systemResponse = await fetch(`${app.origin}/api/system`);
    const system = await systemResponse.json();
    const directRead = getCanonicalOwnerDigest(runtime.db);

    assert.equal(cockpitResponse.status, 200);
    assert.equal(systemResponse.status, 200);
    assert.equal(cockpit.weeklyDigest.metrics.verifiedBuyerCount, null);
    assert.equal(cockpit.weeklyDigest.metrics.buyerTarget, null);
    assert.equal(cockpit.weeklyDigest.metrics.cashStatus, "not_current");
    assert.equal(cockpit.weeklyDigest.metrics.cashContributionCents, null);
    assert.equal(system.weeklyDigest.metrics.verifiedBuyerCount, null);
    assert.equal(system.weeklyDigest.metrics.buyerTarget, null);
    assert.equal(system.weeklyDigest.metrics.cashStatus, "not_current");
    assert.equal(system.weeklyDigest.metrics.cashContributionCents, null);
    assert.equal(directRead.metrics.verifiedBuyerCount, null);
    assert.equal(directRead.metrics.buyerTarget, null);
    assert.equal(directRead.metrics.cashStatus, "not_current");
    assert.equal(
      `${JSON.stringify(cockpit)}${JSON.stringify(system)}`.includes(
        LEGACY_SECRET,
      ),
      false,
    );
    assert.equal(digestGeneratedEventCount(runtime.db), afterRepair);

    const contract = buildContract(runtime, "owner_http");
    propose(runtime, contract, "owner_http");
    const beforeAuthorityRefresh = digestGeneratedEventCount(runtime.db);
    const refreshedResponse = await fetch(`${app.origin}/api/cockpit`);
    const refreshed = await refreshedResponse.json();

    assert.equal(refreshedResponse.status, 200);
    assert.equal(
      digestGeneratedEventCount(runtime.db),
      beforeAuthorityRefresh + 1,
    );
    assert.equal(refreshed.weeklyDigest.metrics.currentTest.name, contract.offer.description);
    assert.equal(refreshed.weeklyDigest.metrics.currentTest.status, "proposed");
    assert.equal(refreshed.weeklyDigest.metrics.verifiedBuyerCount, 0);
    assert.equal(refreshed.weeklyDigest.metrics.cashStatus, "not_settled");
    assert.equal(refreshed.economics.independentBuyers, 0);
    assert.equal(refreshed.economics.buyerTarget, 3);
    assert.equal(refreshed.economics.buyerProofStatus, "verified");
    assert.equal(refreshed.economics.cashContributionStatus, "not_settled");
    assert.equal(
      JSON.stringify(refreshed).includes(contract.decisionHash),
      false,
    );

    const afterAuthorityRefresh = digestGeneratedEventCount(runtime.db);
    const unchangedResponse = await fetch(`${app.origin}/api/executive-digest`);
    const unchanged = await unchangedResponse.json();
    assert.equal(unchangedResponse.status, 200);
    assert.equal(unchanged.digest.metrics.currentTest.status, "proposed");
    assert.equal(
      digestGeneratedEventCount(runtime.db),
      afterAuthorityRefresh,
    );
  } finally {
    if (app) await stopRuntimeApp(app);
    closeRuntime(runtime);
  }
});

test("ensure refreshes the same-week digest when canonical authority changes", () => {
  const runtime = makeRuntime("snapshot");
  try {
    contaminateLegacyCommercialRows(runtime.db);
    const contract = buildContract(runtime, "snapshot");
    propose(runtime, contract, "snapshot");

    const proposed = generateWeeklyDigest(runtime.db, { at: DIGEST_AT });
    assert.equal(proposed.metrics.currentTest.name, contract.offer.description);
    assert.equal(proposed.metrics.currentTest.status, "proposed");
    assert.equal(proposed.metrics.verifiedBuyerCount, 0);
    assert.equal(proposed.metrics.cashStatus, "not_settled");
    assert.equal(proposed.metrics.cashContributionCents, null);
    const proposedHash = proposed.metrics.commercialSnapshotHash;
    const protectedBefore = protectedRowCounts(runtime.db);

    accept(runtime, contract, "snapshot");
    const afterAcceptance = protectedRowCounts(runtime.db);
    const accepted = ensureWeeklyDigest(runtime.db, { at: DIGEST_AT });

    assert.equal(accepted.id, proposed.id);
    assert.equal(
      get(runtime.db, "SELECT COUNT(*) AS count FROM executive_digests").count,
      1,
    );
    assert.equal(accepted.metrics.currentTest.name, contract.offer.description);
    assert.equal(accepted.metrics.currentTest.status, "accepted");
    assert.notEqual(
      accepted.metrics.commercialSnapshotHash,
      proposedHash,
    );
    assert.deepEqual(protectedRowCounts(runtime.db), afterAcceptance);
    assert.notDeepEqual(afterAcceptance, protectedBefore);
    assert.equal(JSON.stringify(accepted).includes(LEGACY_SECRET), false);
    assert.equal(JSON.stringify(accepted).includes(contract.decisionHash), false);
    assert.equal(
      JSON.stringify(accepted).includes(contract.channel.accountHash),
      false,
    );
  } finally {
    closeRuntime(runtime);
  }
});

test("ambiguous canonical authority withholds commercial claims and needs attention", () => {
  const runtime = makeRuntime("ambiguous");
  try {
    const firstContract = buildContract(runtime, "ambiguous_first");
    const secondContract = buildContract(runtime, "ambiguous_second");
    propose(runtime, firstContract, "ambiguous_first");
    propose(runtime, secondContract, "ambiguous_second");
    const protectedBefore = protectedRowCounts(runtime.db);

    const digest = generateWeeklyDigest(runtime.db, { at: DIGEST_AT });

    assert.equal(digest.status, "attention_needed");
    assert.equal(digest.metrics.commercialIntegrityStatus, "attention");
    assert.equal(digest.metrics.commercialAuthorityStatus, "ambiguous");
    assert.equal(digest.metrics.currentTest, null);
    assert.equal(digest.metrics.verifiedBuyerCount, null);
    assert.equal(digest.metrics.buyerTarget, null);
    assert.equal(digest.metrics.cashStatus, "withheld");
    assert.equal(digest.metrics.cashContributionCents, null);
    assert.match(digest.summary, /More than one current commercial program/);
    assert.match(digest.summary, /Verified buyer count is withheld/);
    assert.match(digest.summary, /Net cash contribution is withheld/);
    assert.match(digest.summary, /Commercial truth needs operator attention/);
    const cockpit = getCockpitState(runtime.db);
    assert.equal(cockpit.economics.independentBuyers, null);
    assert.equal(cockpit.economics.buyerTarget, null);
    assert.equal(cockpit.economics.buyerProofStatus, "withheld");
    assert.equal(cockpit.economics.cashContributionStatus, "withheld");
    assert.equal(cockpit.economics.cashContributionCents, null);
    assert.equal(
      JSON.stringify(digest).includes(firstContract.offer.description),
      false,
    );
    assert.equal(
      JSON.stringify(digest).includes(secondContract.offer.description),
      false,
    );
    assert.deepEqual(protectedRowCounts(runtime.db), protectedBefore);
  } finally {
    closeRuntime(runtime);
  }
});

test("only complete canonical proof exposes settled buyers and net cash", () => {
  const runtime = makeRuntime("settled");
  try {
    contaminateLegacyCommercialRows(runtime.db);
    const contract = buildContract(runtime, "settled");
    propose(runtime, contract, "settled");
    accept(runtime, contract, "settled");
    activate(runtime, contract, "settled");
    ingestCompleteProof(runtime, contract);
    const ledger = runtime.store.readLedger(contract.decisionHash);
    const protectedBefore = protectedRowCounts(runtime.db);

    const digest = generateWeeklyDigest(runtime.db, { at: DIGEST_AT });

    assert.equal(digest.metrics.verifiedBuyerCount, 3);
    assert.equal(digest.metrics.buyerTarget, 3);
    assert.equal(digest.metrics.cashStatus, "settled");
    assert.equal(digest.metrics.cashContributionCents, 8350);
    assert.equal(digest.metrics.currentTest.status, "activated");
    assert.match(digest.summary, /3 verified paying buyers recorded/);
    assert.match(digest.summary, /A\$83\.50 settled net cash contribution/);
    assert.deepEqual(protectedRowCounts(runtime.db), protectedBefore);

    const stored = get(
      runtime.db,
      `SELECT title, summary, metrics, decisions, learning, next_actions
       FROM executive_digests WHERE id = ?`,
      [digest.id],
    );
    const encoded = `${JSON.stringify(digest)}${JSON.stringify(stored)}`;
    const forbiddenValues = [
      BUYER_SECRET,
      LEGACY_SECRET,
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
      assert.equal(
        encoded.includes(value),
        false,
        `Executive digest leaked ${value}`,
      );
    }
    assert.doesNotMatch(
      encoded,
      /decisionHash|accountHash|recordHash|sourceHash|receiptHash|buyerReference/,
    );
  } finally {
    closeRuntime(runtime);
  }
});

test("closed-only history never becomes a current zero-buyer digest result", () => {
  const runtime = makeRuntime("closed-only");
  try {
    const contract = buildContract(runtime, "closed_only");
    propose(runtime, contract, "closed_only");
    accept(runtime, contract, "closed_only");
    activate(runtime, contract, "closed_only");
    ingestCompleteProof(runtime, contract);
    runtime.store.appendLifecycle(contract.decisionHash, {
      eventId: "closed_only_closed",
      eventType: "closed",
      reason: "The completed test was closed and retained as history.",
      occurredAt: "2026-09-02T02:00:00.000Z",
    });

    const ownerTests = getCommercialOwnerTestsState(runtime.db);
    assert.equal(ownerTests.integrity.status, "ok");
    assert.equal(ownerTests.current, null);
    assert.equal(ownerTests.closedHistory.total, 1);
    assert.equal(
      ownerTests.closedHistory.items[0].proof.buyers.verifiedPositive,
      3,
    );
    assert.equal(
      ownerTests.closedHistory.items[0].proof.netCashContribution.amountCents,
      8350,
    );

    const digest = generateWeeklyDigest(runtime.db, { at: DIGEST_AT });

    assert.equal(digest.metrics.currentTest, null);
    assert.equal(digest.metrics.verifiedBuyerCount, null);
    assert.equal(digest.metrics.buyerTarget, null);
    assert.equal(digest.metrics.cashStatus, "not_current");
    assert.equal(digest.metrics.cashContributionCents, null);
    assert.match(
      digest.summary,
      /No current commercial test buyer result is available/,
    );
    assert.match(
      digest.summary,
      /No current commercial test net cash result is available/,
    );
    assert.doesNotMatch(digest.summary, /0 verified paying buyers recorded/);
    assert.doesNotMatch(digest.summary, /A\$83\.50 settled net cash contribution/);
    const cockpit = getCockpitState(runtime.db);
    assert.equal(cockpit.currentTest, null);
    assert.equal(cockpit.economics.independentBuyers, null);
    assert.equal(cockpit.economics.buyerTarget, null);
    assert.equal(cockpit.economics.buyerProofStatus, "not_current");
    assert.equal(cockpit.economics.cashContributionStatus, "not_current");
    assert.equal(cockpit.economics.cashContributionCents, null);
    assert.equal(cockpit.commercialTests.closedHistory.total, 1);
    assert.equal(
      cockpit.commercialTests.closedHistory.items[0].proof.buyers.verifiedPositive,
      3,
    );
    assert.doesNotMatch(cockpit.weeklyDigest.summary, /0 verified paying buyers/);
  } finally {
    closeRuntime(runtime);
  }
});
