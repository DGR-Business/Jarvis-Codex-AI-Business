"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  COMMERCIAL_TEST_CONTRACT_SCHEMA,
  COMMERCIAL_TEST_EVIDENCE_SCHEMA,
  COST_CATEGORIES,
  OPERATOR_ROLE,
  PROTECTED_ACTION_KEYS,
  createCommercialEvidenceRecord,
  createCommercialTestContract,
  createEvidenceSetManifest,
  createManualVerificationRecord,
  createTerminalStopRecord,
  evaluateCommercialProof,
  offerDefinitionHash,
  pseudonymizeBuyer,
  routeIndependentTransactionKey,
  sha256,
  sourceCoverageHash,
  validateCommercialEvidenceRecord,
  validateCommercialTestContract,
} = require("../src/runtime/commercial-test-contract");

const BUYER_SECRET = "test-only-buyer-hmac-secret";
const PERIOD = Object.freeze({
  startsAt: "2026-08-01T00:00:00.000Z",
  endsAt: "2026-08-31T23:59:59.999Z",
});

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

function contractInput(overrides = {}) {
  const accountHash = sha256("marketplace-account-safe-reference");
  const base = {
    programId: "program.low_touch_kit",
    programVersion: "1.0.0",
    testId: "test.first_buyer_cash_proof",
    testVersion: "2.0.0",
    ventureId: "venture.low_touch_kit",
    ventureKit: {
      id: "digital_product_v1",
      version: 1,
      hash: sha256("digital-product-v1-registry-record"),
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

function buildContract(overrides = {}) {
  return createCommercialTestContract(contractInput(overrides));
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

function importedSource(contract, row, overrides = {}) {
  const sourceHash = overrides.sourceHash || sha256(`source-export-${row}`);
  const receiptHash = overrides.receiptHash || sha256(`source-receipt-${row}`);
  const result = {
    kind: "imported_platform",
    sourceId: "platform_settlement_records",
    providerNamespace: contract.channel.providerNamespace,
    accountHash: contract.channel.accountHash,
    sourceSystem: "marketplace_settlement",
    exportType: "settlement_record_v2",
    sourceHash,
    sourceRowHash: sha256(`source-row-${row}`),
    receipt: {
      id: `receipt_${row}`,
      hash: receiptHash,
      locationReference: `receipt_location_${row}`,
    },
    verificationStatus: "verified",
    reportingPeriod: PERIOD,
    capturedAt: "2026-09-01T00:02:00.000Z",
    generatedAt: "2026-09-01T00:00:00.000Z",
    importedAt: "2026-09-01T00:01:00.000Z",
    importBatchId: `batch_${row}`,
    coverage: coverage("imported_platform", sourceHash, receiptHash),
    ...overrides,
  };
  if (!overrides.coverage) {
    result.coverage = coverage(
      "imported_platform",
      result.sourceHash,
      result.receipt.hash,
      overrides.declaredRowCount || 1,
    );
  }
  delete result.declaredRowCount;
  delete result.receiptHash;
  return result;
}

function manualSource(contract, row, verificationStatus = "pending", overrides = {}) {
  const sourceHash = overrides.sourceHash || sha256(`manual-source-${row}`);
  const receiptHash = overrides.receiptHash || sha256(`manual-receipt-${row}`);
  const result = {
    kind: "operator_attested_manual",
    sourceId: "platform_settlement_records",
    providerNamespace: contract.channel.providerNamespace,
    accountHash: contract.channel.accountHash,
    sourceSystem: "marketplace_settlement",
    exportType: "settlement_record_v2",
    sourceHash,
    sourceRowHash: sha256(`manual-row-${row}`),
    receipt: {
      id: `manual_receipt_${row}`,
      hash: receiptHash,
      locationReference: `manual_receipt_location_${row}`,
    },
    verificationStatus,
    reportingPeriod: PERIOD,
    capturedAt: "2026-09-01T00:03:00.000Z",
    manualReferenceHash: sha256(`manual-reference-${row}`),
    attestedBy: "jarvis_operator",
    attestationNote: "Matched against the retained settlement receipt.",
    entryReason: "A structured platform import was unavailable for this retained record.",
    coverage: coverage("operator_attested_manual", sourceHash, receiptHash),
    ...overrides,
  };
  if (!overrides.coverage) {
    result.coverage = coverage(
      "operator_attested_manual",
      result.sourceHash,
      result.receipt.hash,
    );
  }
  delete result.receiptHash;
  return result;
}

function attribution(contract, overrides = {}) {
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
    ...overrides,
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

function transactionRecord(contract, number, overrides = {}) {
  const day = String(((number - 1) % 28) + 1).padStart(2, "0");
  const transaction = {
    rawTransactionId: `raw-platform-transaction-${number}`,
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
      referenceHash: sha256(`cash-settlement-${number}`),
    },
    grossRevenue: nativeAud(1000),
    refunds: nativeAud(0),
    ...(overrides.transaction || {}),
  };
  return createCommercialEvidenceRecord(contract, {
    evidenceId: overrides.evidenceId || `evidence_transaction_${number}`,
    evidenceVersion: overrides.evidenceVersion || "1.0.0",
    kind: "transaction",
    source: overrides.source || importedSource(contract, `transaction_${number}`),
    scope: overrides.scope,
    attribution: overrides.attribution || attribution(contract),
    buyerReference: overrides.buyerReference || `buyer-${number}@example.test`,
    transaction,
    ...overrides.extra,
  }, { pseudonymizationKey: BUYER_SECRET });
}

function transactionRevision(contract, original, sequence, eventType, overrides = {}) {
  const transaction = {
    rawTransactionId: overrides.rawTransactionId || "raw-platform-transaction-1",
    eventType,
    chain: {
      sequence,
      predecessorRecordHash: original.recordHash,
      reversesRecordHash: overrides.reversesRecordHash || null,
    },
    status: overrides.status || "settled",
    occurredAt: original.transaction.occurredAt,
    settledAt: overrides.settledAt || "2026-08-02T01:00:00.000Z",
    settlement: overrides.settlement || {
      state: "cash_settled",
      referenceHash: sha256(`cash-settlement-revision-${sequence}-${eventType}`),
    },
    grossRevenue: overrides.grossRevenue || original.transaction.grossRevenue,
    refunds: overrides.refunds || original.transaction.refunds,
  };
  return createCommercialEvidenceRecord(contract, {
    evidenceId: overrides.evidenceId || `evidence_transaction_1_${eventType}_${sequence}`,
    evidenceVersion: "1.0.0",
    kind: "transaction",
    source: overrides.source || importedSource(contract, `transaction_1_${eventType}_${sequence}`, {
      capturedAt: overrides.capturedAt || "2026-09-01T00:04:00.000Z",
      generatedAt: overrides.generatedAt || "2026-09-01T00:00:00.000Z",
      importedAt: overrides.importedAt || "2026-09-01T00:01:00.000Z",
    }),
    attribution: overrides.attribution || attribution(contract),
    scope: overrides.scope,
    buyerReference: overrides.buyerReference || "buyer-1@example.test",
    transaction,
  }, { pseudonymizationKey: BUYER_SECRET });
}

function costRecords(contract, overrides = {}) {
  return COST_CATEGORIES.map((category, index) => {
    const replacement = overrides[category] || {};
    const state = replacement.state || "reconciled";
    const cents = replacement.cents
      ?? (category === "platform_fees" ? 300 : category === "payment_fees" ? 50 : 0);
    return createCommercialEvidenceRecord(contract, {
      evidenceId: `evidence_cost_${category}`,
      evidenceVersion: "1.0.0",
      kind: "cost",
      source: replacement.source || importedSource(contract, `cost_${category}`),
      attribution: replacement.attribution || attribution(contract),
      scope: replacement.scope,
      cost: {
        rawCostId: `raw-cost-${category}`,
        eventType: "original",
        chain: {
          sequence: 0,
          predecessorRecordHash: null,
          reversesRecordHash: null,
        },
        category,
        state,
        occurredAt: "2026-08-31T00:00:00.000Z",
        amount: state === "unknown" ? null : nativeAud(cents),
      },
    });
  });
}

function costRevision(contract, predecessor, sequence, eventType, overrides = {}) {
  const state = overrides.state || "reconciled";
  return createCommercialEvidenceRecord(contract, {
    evidenceId: overrides.evidenceId || `evidence_cost_revision_${sequence}_${eventType}`,
    evidenceVersion: "1.0.0",
    kind: "cost",
    source: overrides.source || importedSource(contract, `cost_revision_${sequence}_${eventType}`, {
      capturedAt: "2026-09-01T00:04:00.000Z",
    }),
    attribution: attribution(contract),
    cost: {
      rawCostId: overrides.rawCostId || "raw-cost-platform_fees",
      eventType,
      chain: {
        sequence,
        predecessorRecordHash: predecessor.recordHash,
        reversesRecordHash: overrides.reversesRecordHash || null,
      },
      category: overrides.category || "platform_fees",
      state,
      occurredAt: predecessor.cost.occurredAt,
      amount: state === "unknown" ? null : nativeAud(overrides.cents ?? 0),
    },
  });
}

function manifest(contract, records, overrides = {}) {
  return createEvidenceSetManifest(contract, records, {
    evidenceId: overrides.evidenceId || "evidence_manifest_0",
    evidenceVersion: overrides.evidenceVersion || "1.0.0",
    source: overrides.source || importedSource(contract, `manifest_${overrides.evidenceId || 0}`),
    attribution: overrides.attribution || attribution(contract),
    closedAt: overrides.closedAt || "2026-09-01T01:00:00.000Z",
    predecessorManifest: overrides.predecessorManifest,
  });
}

function completeProofRecords(contract, buyerCount = 3, overrides = {}) {
  const records = [
    ...Array.from({ length: buyerCount }, (_, index) => (
      transactionRecord(contract, index + 1, overrides.transactions?.[index] || {})
    )),
    ...costRecords(contract, overrides.costs),
  ];
  return [...records, manifest(contract, records)];
}

function blockerCodes(result) {
  return new Set(result.blockers.map((item) => item.code));
}

test("v2 contract is immutable and its decision hash binds every commercial decision", () => {
  const contract = buildContract();
  assert.equal(contract.schema, COMMERCIAL_TEST_CONTRACT_SCHEMA);
  assert.equal(contract.offerId, contract.offer.id);
  assert.equal(contract.operatorRole, OPERATOR_ROLE);
  assert.equal(contract.externalSpendCapAud, 0);
  assert.deepEqual(contract.evidenceRules.requiredCostCategories, [...COST_CATEGORIES].sort());
  assert.equal(validateCommercialTestContract(contract), true);
  assert.equal(Object.isFrozen(contract.offer), true);
  assert.equal(Object.isFrozen(contract.channel.adapter), true);

  const changes = [
    { offer: offer({ sku: "changed_sku" }), offerId: "offer.scope_guard_kit" },
    { experiment: { ...contractInput().experiment, id: "experiment.changed" } },
    { cohort: { ...contractInput().cohort, id: "cohort.changed" } },
    {
      reportingPeriod: {
        startsAt: PERIOD.startsAt,
        endsAt: "2026-09-01T00:00:00.000Z",
      },
    },
    {
      channel: {
        ...contractInput().channel,
        adapter: {
          ...contractInput().channel.adapter,
          version: "2.1.0",
          hash: sha256("marketplace-adapter-v2.1"),
        },
      },
    },
    { price: { currency: "AUD", amountMinorUnits: 3000, amountAudCents: 3000 } },
    { buyerIdentity: { ...contractInput().buyerIdentity, keyVersion: 2 } },
    {
      attributionRules: {
        ...contractInput().attributionRules,
        allowedTouchpoints: ["listing_id", "referral_id"],
      },
    },
  ];
  for (const change of changes) {
    assert.notEqual(buildContract(change).decisionHash, contract.decisionHash);
  }

  const forged = structuredClone(contract);
  forged.problem = "Silently changed problem";
  forged.decisionHash = sha256("attacker-chosen-formatted-hash");
  assert.throws(() => validateCommercialTestContract(forged), /decisionHash does not match/);
  const unknown = structuredClone(contract);
  unknown.unrecordedAuthority = true;
  assert.throws(() => validateCommercialTestContract(unknown), /unsupported or non-normalized/);
});

test("contract rejects weakened protection, arbitrary offer hashes, and incomplete cost truth", () => {
  assert.throws(
    () => buildContract({ operatorRole: "autonomous_owner" }),
    /operatorRole/,
  );
  assert.throws(
    () => buildContract({ externalSpendCapAud: 1 }),
    /must remain 0/,
  );
  assert.throws(
    () => buildContract({ channels: ["one", "two"] }),
    /exactly one channel/,
  );
  assert.throws(
    () => buildContract({
      protectedActions: {
        ...protectedActions(),
        first_stage_customer_contact: false,
      },
    }),
    /must remain true/,
  );
  assert.throws(
    () => buildContract({
      offer: { ...offer(), hash: sha256("arbitrary") },
    }),
    /canonical offer definition/,
  );
  assert.throws(
    () => buildContract({
      evidenceRules: {
        ...contractInput().evidenceRules,
        requiredCostCategories: COST_CATEGORIES.filter((item) => item !== "tax"),
      },
    }),
    /must contain exactly/,
  );
});

test("import evidence retains complete provenance and strips raw buyer and transaction identifiers", () => {
  const contract = buildContract();
  const record = transactionRecord(contract, 1, {
    buyerReference: "Buyer.One@Example.Test",
    transaction: { rawTransactionId: "provider-secret-transaction-id" },
  });
  const encoded = JSON.stringify(record);

  assert.equal(record.schema, COMMERCIAL_TEST_EVIDENCE_SCHEMA);
  assert.equal(record.source.providerNamespace, contract.channel.providerNamespace);
  assert.equal(record.source.accountHash, contract.channel.accountHash);
  assert.equal(record.source.reportingPeriod.endsAt, PERIOD.endsAt);
  assert.equal(record.source.coverage.basis, "unfiltered_full_reporting_period");
  assert.match(record.source.sourceHash, /^sha256:/);
  assert.match(record.source.sourceRowHash, /^sha256:/);
  assert.match(record.source.receipt.hash, /^sha256:/);
  assert.match(record.transaction.buyer.pseudonym, /^buyer_[a-f0-9]{64}$/);
  assert.equal(record.transaction.buyer.keyId, contract.buyerIdentity.keyId);
  assert.equal(record.transaction.buyer.independenceBasis, "platform_buyer_account");
  assert.equal(encoded.includes("Buyer.One@Example.Test"), false);
  assert.equal(encoded.includes("provider-secret-transaction-id"), false);
  assert.equal(encoded.includes(BUYER_SECRET), false);
  assert.equal(validateCommercialEvidenceRecord(contract, record), true);
  const forgedKey = structuredClone(record);
  forgedKey.transaction.transactionKey = sha256("forged-transaction-key");
  assert.throws(
    () => validateCommercialEvidenceRecord(contract, forgedKey),
    /does not match its provider, hashed account, and transaction ID digest/,
  );
  assert.throws(
    () => transactionRecord(contract, 2, {
      extra: { customer_email: "leak@example.test" },
    }),
    /raw buyer contact data/,
  );
});

test("buyer HMAC is stable only within the exact key, test, and independence basis", () => {
  const contract = buildContract();
  const first = pseudonymizeBuyer(contract, "Buyer@Example.Test", BUYER_SECRET);
  const repeated = pseudonymizeBuyer(contract, "buyer@example.test", BUYER_SECRET);
  const changedContract = buildContract({
    buyerIdentity: { ...contractInput().buyerIdentity, keyVersion: 2 },
  });
  assert.equal(first, repeated);
  assert.notEqual(
    first,
    pseudonymizeBuyer(changedContract, "buyer@example.test", BUYER_SECRET),
  );
  assert.equal(first.includes("example"), false);
  assert.throws(
    () => pseudonymizeBuyer(contract, "buyer@example.test", "too-short"),
    /at least 16 bytes/,
  );
});

test("transaction identity deduplicates across routes but not across provider or account", () => {
  const contract = buildContract();
  const original = transactionRecord(contract, 1);
  const routeDuplicate = transactionRecord(contract, 9, {
    evidenceId: "evidence_transaction_1_other_route",
    buyerReference: "buyer-1@example.test",
    transaction: {
      rawTransactionId: "raw-platform-transaction-1",
      occurredAt: original.transaction.occurredAt,
      settledAt: original.transaction.settledAt,
      settlement: original.transaction.settlement,
      grossRevenue: original.transaction.grossRevenue,
      refunds: original.transaction.refunds,
    },
  });
  assert.equal(routeDuplicate.transaction.transactionKey, original.transaction.transactionKey);
  assert.notEqual(routeDuplicate.recordHash, original.recordHash);
  assert.notEqual(
    original.transaction.transactionKey,
    routeIndependentTransactionKey(
      "marketplace_beta",
      contract.channel.accountHash,
      "raw-platform-transaction-1",
    ),
  );
  assert.notEqual(
    original.transaction.transactionKey,
    routeIndependentTransactionKey(
      contract.channel.providerNamespace,
      sha256("different-account"),
      "raw-platform-transaction-1",
    ),
  );

  const core = [
    original,
    routeDuplicate,
    transactionRecord(contract, 2),
    transactionRecord(contract, 3),
    ...costRecords(contract),
  ];
  const result = evaluateCommercialProof(contract, [...core, manifest(contract, core)]);
  assert.equal(result.proofReached, true);
  assert.equal(result.evidence.positiveTransactions, 3);
  assert.equal(result.evidence.routeDuplicateCount, 1);

  const conflict = transactionRecord(contract, 10, {
    evidenceId: "evidence_transaction_1_conflict",
    buyerReference: "buyer-1@example.test",
    transaction: {
      rawTransactionId: "raw-platform-transaction-1",
      occurredAt: original.transaction.occurredAt,
      settledAt: original.transaction.settledAt,
      settlement: original.transaction.settlement,
      grossRevenue: nativeAud(1100),
      refunds: nativeAud(0),
    },
  });
  const conflicted = [original, conflict, ...costRecords(contract)];
  const failed = evaluateCommercialProof(contract, [
    ...conflicted,
    manifest(contract, conflicted),
  ]);
  assert.equal(failed.proofReached, false);
  assert.ok(blockerCodes(failed).has("transaction_route_conflict"));
});

test("manual originals remain pending and only a separate exact verification resolves them", () => {
  const contract = buildContract();
  assert.throws(
    () => transactionRecord(contract, 3, {
      source: manualSource(contract, "manual_claim", "verified"),
    }),
    /must remain pending/,
  );

  const manual = transactionRecord(contract, 3, {
    source: manualSource(contract, "manual_sale"),
  });
  const pendingCore = [
    transactionRecord(contract, 1),
    transactionRecord(contract, 2),
    manual,
    ...costRecords(contract),
  ];
  const pending = evaluateCommercialProof(contract, [
    ...pendingCore,
    manifest(contract, pendingCore),
  ]);
  assert.equal(pending.proofReached, false);
  assert.ok(blockerCodes(pending).has("manual_verification_pending"));

  const verification = createManualVerificationRecord(contract, manual, {
    evidenceId: "evidence_manual_verification_sale_3",
    evidenceVersion: "1.0.0",
    source: manualSource(contract, "manual_sale_verification", "verified"),
    attribution: attribution(contract),
    status: "verified",
    reviewerId: "jarvis_reviewer",
    reviewedAt: "2026-09-01T00:30:00.000Z",
  });
  const verifiedCore = [...pendingCore, verification];
  const verified = evaluateCommercialProof(contract, [
    ...verifiedCore,
    manifest(contract, verifiedCore),
  ]);
  assert.equal(verified.proofReached, true);
  assert.equal(verified.evidence.manuallyVerifiedOriginals, 1);

  const forgedVerification = structuredClone(verification);
  forgedVerification.manualVerification.boundFacts.audCents += 1;
  const { recordHash: ignored, ...payload } = forgedVerification;
  forgedVerification.recordHash = sha256(payload);
  assert.equal(validateCommercialEvidenceRecord(contract, forgedVerification), true);
  const forgedCore = [...pendingCore, forgedVerification];
  const forged = evaluateCommercialProof(contract, [
    ...forgedCore,
    manifest(contract, forgedCore),
  ]);
  assert.equal(forged.proofReached, false);
  assert.ok(blockerCodes(forged).has("manual_verification_mismatch"));
});

test("money retains original currency and reproducible AUD conversion evidence", () => {
  const contract = buildContract();
  const usd = {
    currency: "USD",
    originalMinorUnits: 1000,
    audCents: 1500,
    conversion: {
      kind: "fx",
      minorUnitExponent: 2,
      rateNumerator: 3,
      rateDenominator: 2,
      rounding: "half_away_from_zero",
      source: {
        provider: "bank_rate_feed",
        reference: "usd_aud_2026_08_01",
        sourceHash: sha256("retained-fx-evidence"),
        observedAt: "2026-08-01T00:00:00.000Z",
      },
    },
  };
  const record = transactionRecord(contract, 1, {
    transaction: {
      grossRevenue: usd,
      refunds: { ...usd, originalMinorUnits: 0, audCents: 0 },
    },
  });
  assert.equal(record.transaction.grossRevenue.currency, "USD");
  assert.equal(record.transaction.grossRevenue.audCents, 1500);
  assert.equal(validateCommercialEvidenceRecord(contract, record), true);

  assert.throws(
    () => transactionRecord(contract, 2, {
      transaction: {
        grossRevenue: { ...usd, audCents: 1499 },
        refunds: { ...usd, originalMinorUnits: 0, audCents: 0 },
      },
    }),
    /does not reproduce/,
  );
  assert.throws(
    () => transactionRecord(contract, 2, {
      transaction: {
        grossRevenue: {
          currency: "AUD",
          originalMinorUnits: 1000,
          audCents: 1000,
          conversion: { kind: "fx", minorUnitExponent: 2 },
        },
      },
    }),
    /must use native_aud/,
  );
});

test("append-only full-snapshot chains count only one head and support correction, refund, and reversal", () => {
  const contract = buildContract();
  const original = transactionRecord(contract, 1);
  const correction = transactionRevision(contract, original, 1, "correction", {
    grossRevenue: nativeAud(1200),
  });
  const refund = transactionRevision(contract, correction, 2, "refund", {
    status: "refunded",
    grossRevenue: nativeAud(1200),
    refunds: nativeAud(200),
  });
  const reversedRefund = transactionRevision(contract, refund, 3, "reversal", {
    reversesRecordHash: refund.recordHash,
    grossRevenue: nativeAud(1200),
    refunds: nativeAud(0),
  });
  const core = [
    original,
    correction,
    refund,
    reversedRefund,
    transactionRecord(contract, 2),
    transactionRecord(contract, 3),
    ...costRecords(contract),
  ];
  const result = evaluateCommercialProof(contract, [...core, manifest(contract, core)]);
  assert.equal(result.proofReached, true);
  assert.equal(result.financials.settledRevenueAudCents, 3200);
  assert.equal(result.financials.refundsAudCents, 0);
  assert.equal(result.evidence.positiveTransactions, 3);

  const gap = transactionRevision(contract, original, 2, "correction", {
    grossRevenue: nativeAud(1100),
    evidenceId: "evidence_gap",
  });
  const gapCore = [original, gap, ...costRecords(contract)];
  const gapResult = evaluateCommercialProof(contract, [
    ...gapCore,
    manifest(contract, gapCore),
  ]);
  assert.ok(blockerCodes(gapResult).has("transaction_chain_gap"));

  const forkA = transactionRevision(contract, original, 1, "correction", {
    grossRevenue: nativeAud(1100),
    evidenceId: "evidence_fork_a",
  });
  const forkB = transactionRevision(contract, original, 1, "correction", {
    grossRevenue: nativeAud(1200),
    evidenceId: "evidence_fork_b",
  });
  const forkCore = [original, forkA, forkB, ...costRecords(contract)];
  const forkResult = evaluateCommercialProof(contract, [
    ...forkCore,
    manifest(contract, forkCore),
  ]);
  assert.ok(blockerCodes(forkResult).has("transaction_route_conflict"));

  const baseCosts = costRecords(contract);
  const originalCost = baseCosts.find((record) => record.cost.category === "platform_fees");
  const costCorrection = costRevision(contract, originalCost, 1, "correction", {
    cents: 400,
  });
  const costReversal = costRevision(contract, costCorrection, 2, "reversal", {
    cents: 300,
    reversesRecordHash: costCorrection.recordHash,
  });
  const costCore = [
    transactionRecord(contract, 1),
    transactionRecord(contract, 2),
    transactionRecord(contract, 3),
    ...baseCosts,
    costCorrection,
    costReversal,
  ];
  const costResult = evaluateCommercialProof(contract, [
    ...costCore,
    manifest(contract, costCore),
  ]);
  assert.equal(costResult.proofReached, true);
  assert.equal(costResult.financials.reconciledCostsAudCents, 350);
});

test("only cash-settled revenue and reconciled complete costs can reach proof", () => {
  const contract = buildContract();
  const platformBalance = completeProofRecords(contract, 3, {
    transactions: [{
      transaction: {
        settledAt: null,
        settlement: { state: "platform_balance", referenceHash: null },
      },
    }],
  });
  const unsettled = evaluateCommercialProof(contract, platformBalance);
  assert.equal(unsettled.proofReached, false);
  assert.ok(blockerCodes(unsettled).has("unsettled_transaction"));

  for (const state of ["unknown", "estimated", "incurred"]) {
    const records = completeProofRecords(contract, 3, {
      costs: { tax: { state, cents: state === "unknown" ? null : 1 } },
    });
    const result = evaluateCommercialProof(contract, records);
    assert.equal(result.proofReached, false);
    assert.ok(blockerCodes(result).has(`cost_${state}`));
    assert.equal(result.proofRequirements.onlyReconciledCostsCounted, true);
  }
});

test("three positive independent buyers plus positive actual AUD NCC passes; one or two are signal only", () => {
  const contract = buildContract();
  const passed = evaluateCommercialProof(contract, completeProofRecords(contract, 3));
  assert.equal(passed.proofReached, true);
  assert.equal(passed.outcome, "pass");
  assert.equal(passed.evidence.distinctPositiveBuyers, 3);
  assert.equal(passed.financials.settledRevenueAudCents, 3000);
  assert.equal(passed.financials.reconciledCostsAudCents, 350);
  assert.equal(passed.financials.actualNetCashContributionAudCents, 2650);
  assert.equal(passed.blockers.length, 0);

  for (const count of [1, 2]) {
    const result = evaluateCommercialProof(contract, completeProofRecords(contract, count));
    assert.equal(result.proofReached, false);
    assert.equal(result.outcome, "inconclusive");
    assert.equal(result.buyerSignalOnly, true);
    assert.equal(result.evidence.distinctPositiveBuyers, count);
  }

  const sameBuyerCore = [
    transactionRecord(contract, 1, { buyerReference: "same@example.test" }),
    transactionRecord(contract, 2, { buyerReference: "same@example.test" }),
    transactionRecord(contract, 3, { buyerReference: "other@example.test" }),
    ...costRecords(contract),
  ];
  const sameBuyer = evaluateCommercialProof(contract, [
    ...sameBuyerCore,
    manifest(contract, sameBuyerCore),
  ]);
  assert.equal(sameBuyer.evidence.distinctPositiveBuyers, 2);
  assert.equal(sameBuyer.proofReached, false);
});

test("scope, offer, date, touchpoint, verification, and source mismatches are surfaced blockers", () => {
  const contract = buildContract();
  const wrongOffer = offer({ sku: "wrong_sku" });
  const records = [
    transactionRecord(contract, 1, {
      scope: {
        ventureId: contract.ventureId,
        ventureKit: contract.ventureKit,
        offer: wrongOffer,
        experiment: {
          id: contract.experiment.id,
          version: contract.experiment.version,
        },
        cohortId: contract.cohort.id,
        reportingPeriod: contract.reportingPeriod,
      },
    }),
    transactionRecord(contract, 2, {
      attribution: attribution(contract, {
        touchpoints: [{
          type: "unapproved_touchpoint",
          referenceHash: sha256("unknown"),
        }],
      }),
    }),
    transactionRecord(contract, 3, {
      transaction: {
        occurredAt: "2026-09-03T00:00:00.000Z",
        settledAt: "2026-09-03T01:00:00.000Z",
      },
    }),
    transactionRecord(contract, 4, {
      source: importedSource(contract, "pending", {
        verificationStatus: "pending",
      }),
    }),
    ...costRecords(contract),
  ];
  const result = evaluateCommercialProof(contract, [...records, manifest(contract, records)]);
  const codes = blockerCodes(result);
  assert.equal(result.proofReached, false);
  assert.ok(codes.has("scope_mismatch"));
  assert.ok(codes.has("touchpoint_out_of_scope"));
  assert.ok(codes.has("required_touchpoint_missing"));
  assert.ok(codes.has("outside_reporting_period"));
  assert.ok(codes.has("outside_attribution_window"));
  assert.ok(codes.has("imported_evidence_unverified"));
});

test("closed manifests prevent omission and can be revised linearly for late refunds", () => {
  const contract = buildContract();
  const originalCore = [
    transactionRecord(contract, 1),
    transactionRecord(contract, 2),
    transactionRecord(contract, 3),
    ...costRecords(contract),
  ];
  const firstManifest = manifest(contract, originalCore);
  const refund = transactionRevision(contract, originalCore[0], 1, "refund", {
    status: "refunded",
    grossRevenue: nativeAud(1000),
    refunds: nativeAud(1000),
    capturedAt: "2026-09-02T00:02:00.000Z",
    generatedAt: "2026-09-02T00:00:00.000Z",
    importedAt: "2026-09-02T00:01:00.000Z",
  });
  const stale = evaluateCommercialProof(contract, [...originalCore, refund, firstManifest]);
  assert.equal(stale.proofReached, false);
  assert.ok(blockerCodes(stale).has("manifest_record_set_mismatch"));
  assert.ok(blockerCodes(stale).has("record_after_manifest_cutoff"));

  const revisedCore = [...originalCore, refund, firstManifest];
  const secondManifest = manifest(contract, revisedCore, {
    evidenceId: "evidence_manifest_1",
    evidenceVersion: "1.0.0",
    predecessorManifest: firstManifest,
    closedAt: "2026-09-02T01:00:00.000Z",
    source: importedSource(contract, "manifest_1", {
      capturedAt: "2026-09-02T01:00:00.000Z",
      generatedAt: "2026-09-02T00:00:00.000Z",
      importedAt: "2026-09-02T00:01:00.000Z",
    }),
  });
  const revised = evaluateCommercialProof(contract, [...revisedCore, secondManifest]);
  assert.equal(revised.proofReached, false);
  assert.equal(revised.evidence.manifestRevision, 1);
  assert.equal(revised.evidence.distinctPositiveBuyers, 2);
  assert.equal(revised.buyerSignalOnly, true);
  assert.equal(blockerCodes(revised).has("manifest_conflict"), false);

  const missingReceiptCore = originalCore.slice(0, -1);
  const incomplete = evaluateCommercialProof(contract, [
    ...missingReceiptCore,
    firstManifest,
  ]);
  assert.ok(blockerCodes(incomplete).has("manifest_record_set_mismatch"));
});

test("source coverage control totals block truncated evidence sets", () => {
  const contract = buildContract();
  const sourceHash = sha256("two-row-export");
  const receiptHash = sha256("two-row-receipt");
  const source = importedSource(contract, "only_row_received", {
    sourceHash,
    receipt: {
      id: "receipt_two_rows",
      hash: receiptHash,
      locationReference: "receipt_two_rows_location",
    },
    coverage: coverage("imported_platform", sourceHash, receiptHash, 2),
  });
  const records = [
    transactionRecord(contract, 1, { source }),
    ...costRecords(contract),
  ];
  const result = evaluateCommercialProof(contract, [...records, manifest(contract, records)]);
  assert.ok(blockerCodes(result).has("source_control_total_mismatch"));
  assert.equal(result.proofReached, false);
});

test("terminal stop overrides an otherwise passing proof", () => {
  const contract = buildContract();
  const passing = completeProofRecords(contract, 3);
  const stop = createTerminalStopRecord(contract, {
    evidenceId: "evidence_terminal_stop",
    evidenceVersion: "1.0.0",
    source: importedSource(contract, "terminal_stop"),
    attribution: attribution(contract),
    code: "platform_policy_stop",
    reason: "The approved test must stop because a recorded platform condition failed.",
    stoppedAt: "2026-09-01T01:30:00.000Z",
    approvalId: null,
  });
  const result = evaluateCommercialProof(contract, [...passing, stop]);
  assert.equal(result.outcome, "stop");
  assert.equal(result.proofReached, false);
  assert.equal(result.terminalStops.length, 1);
});

test("evidence-set and evaluation hashes are deterministic regardless of input order", () => {
  const contract = buildContract();
  const records = completeProofRecords(contract, 3);
  const forward = evaluateCommercialProof(contract, records);
  const reverse = evaluateCommercialProof(contract, [...records].reverse());
  const shuffled = evaluateCommercialProof(contract, [
    records[3],
    records[0],
    ...records.slice(4),
    records[2],
    records[1],
  ]);
  assert.equal(forward.evidenceSetHash, reverse.evidenceSetHash);
  assert.equal(forward.evidenceSetHash, shuffled.evidenceSetHash);
  assert.equal(forward.evaluationHash, reverse.evaluationHash);
  assert.equal(forward.evaluationHash, shuffled.evaluationHash);
  assert.equal(Object.isFrozen(forward), true);
});
