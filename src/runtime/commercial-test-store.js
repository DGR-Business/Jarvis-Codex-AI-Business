"use strict";

const {
  COMMERCIAL_TEST_CONTRACT_SCHEMA,
  COMMERCIAL_TEST_EVIDENCE_SCHEMA,
  createCommercialEvidenceRecord,
  createEvidenceSetManifest,
  createManualVerificationRecord,
  createCommercialTestContract,
  createTerminalStopRecord,
  evaluateCommercialProof,
  sha256,
  transactionEconomicHash,
  validateCommercialEvidenceRecord,
  validateCommercialTestContract,
} = require("./commercial-test-contract");
const {
  commercialLifecycleApprovalScope,
  commercialLifecycleApprovalScopeHash,
  createCommercialLifecycleEvent,
} = require("./commercial-authority");

const COMMERCIAL_EVIDENCE_RECEIPT_SCHEMA =
  "pantheon.commercial-test-evidence-receipt.v2";
const BUYER_PSEUDONYM_PATTERN = /^buyer_[a-f0-9]{64}$/;
const TERMINAL_LIFECYCLE_EVENTS = new Set(["closed", "stopped"]);
const WRITEABLE_EVIDENCE_STATES = new Set(["activated", "paused"]);

const COMMERCIAL_TEST_STORE_COLUMNS = Object.freeze({
  ventureKits: Object.freeze([
    "id",
    "version",
    "status",
    "content_hash",
  ]),
  contracts: Object.freeze([
    "decision_hash",
    "contract_schema",
    "program_id",
    "program_version",
    "test_id",
    "test_version",
    "venture_id",
    "venture_kit_id",
    "venture_kit_version",
    "venture_kit_hash",
    "offer_id",
    "offer_version",
    "offer_hash",
    "offer_sku",
    "experiment_id",
    "experiment_version",
    "cohort_id",
    "channel_id",
    "provider_namespace",
    "account_hash",
    "adapter_id",
    "adapter_version",
    "adapter_hash",
    "reporting_starts_at",
    "reporting_ends_at",
    "buyer_key_id",
    "buyer_key_version",
    "buyer_independence_basis",
    "price_aud_cents",
    "operator_role",
    "external_spend_cap_cents",
    "contract_json",
    "created_at",
  ]),
  lifecycle: Object.freeze([
    "id",
    "decision_hash",
    "sequence",
    "previous_event_hash",
    "event_type",
    "event_hash",
    "approval_id",
    "approval_scope_hash",
    "reason",
    "metadata",
    "event_json",
    "occurred_at",
    "created_at",
  ]),
  receipts: Object.freeze([
    "decision_hash",
    "receipt_id",
    "receipt_schema",
    "source_kind",
    "source_id",
    "provider_namespace",
    "account_hash",
    "source_system",
    "export_type",
    "source_hash",
    "receipt_hash",
    "location_reference",
    "verification_status",
    "reporting_starts_at",
    "reporting_ends_at",
    "coverage_basis",
    "coverage_declared_row_count",
    "coverage_control_hash",
    "generated_at",
    "imported_at",
    "import_batch_id",
    "manual_reference_hash",
    "attested_by",
    "attestation_note",
    "entry_reason",
    "receipt_json",
    "captured_at",
    "created_at",
  ]),
  evidence: Object.freeze([
    "record_hash",
    "evidence_schema",
    "decision_hash",
    "evidence_id",
    "evidence_version",
    "kind",
    "source_kind",
    "source_id",
    "provider_namespace",
    "account_hash",
    "source_system",
    "export_type",
    "source_hash",
    "source_row_hash",
    "receipt_id",
    "receipt_hash",
    "verification_status",
    "reporting_starts_at",
    "reporting_ends_at",
    "coverage_basis",
    "coverage_declared_row_count",
    "coverage_control_hash",
    "captured_at",
    "supersedes_record_hash",
    "transaction_key",
    "transaction_id_hash",
    "transaction_economic_hash",
    "buyer_pseudonym",
    "buyer_key_id",
    "buyer_key_version",
    "buyer_independence_basis",
    "transaction_event_type",
    "transaction_chain_sequence",
    "transaction_status",
    "settlement_state",
    "settlement_reference_hash",
    "occurred_at",
    "settled_at",
    "gross_revenue_original_minor_units",
    "gross_revenue_currency",
    "gross_revenue_aud_cents",
    "refunds_original_minor_units",
    "refunds_currency",
    "refunds_aud_cents",
    "cost_key",
    "cost_id_hash",
    "cost_economic_hash",
    "cost_event_type",
    "cost_chain_sequence",
    "cost_category",
    "cost_state",
    "cost_original_minor_units",
    "cost_currency",
    "cost_aud_cents",
    "attribution_status",
    "record_json",
    "created_at",
  ]),
  evaluations: Object.freeze([
    "evaluation_hash",
    "proof_schema",
    "decision_hash",
    "evidence_set_hash",
    "outcome",
    "proof_reached",
    "buyer_signal_only",
    "distinct_positive_buyers",
    "settled_revenue_aud_cents",
    "refunds_aud_cents",
    "reconciled_costs_aud_cents",
    "actual_net_cash_contribution_aud_cents",
    "evaluation_json",
    "evaluated_at",
    "created_at",
  ]),
});

class CommercialTestStoreError extends Error {
  constructor(code, message, options = {}) {
    super(message);
    this.name = "CommercialTestStoreError";
    this.code = code;
    this.statusCode = Number(options.statusCode || 409);
    this.details = options.details || {};
  }
}

function fail(code, message, details = {}) {
  throw new CommercialTestStoreError(code, message, { details });
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (isObject(value)) {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, canonical(value[key])]),
    );
  }
  return value ?? null;
}

function canonicalJson(value) {
  return JSON.stringify(canonical(value));
}

function sameCanonical(left, right) {
  return canonicalJson(left) === canonicalJson(right);
}

function parseJsonObject(value, label) {
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    if (!isObject(parsed)) throw new Error("not an object");
    return parsed;
  } catch {
    fail("commercial_ledger_integrity_failed", `${label} is not a valid JSON object.`);
  }
}

function parseJsonArray(value, label) {
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    if (!Array.isArray(parsed)) throw new Error("not an array");
    return parsed;
  } catch {
    fail("commercial_ledger_integrity_failed", `${label} is not a valid JSON list.`);
  }
}

function normalizedTimestamp(value, label) {
  const source = value instanceof Date ? value.toISOString() : String(value ?? "");
  const parsed = new Date(source);
  if (Number.isNaN(parsed.getTime())) {
    fail("commercial_input_invalid", `${label} must be an ISO-compatible timestamp.`);
  }
  return parsed.toISOString();
}

function ensureSynchronous(result, label) {
  if (result && typeof result.then === "function") {
    fail(
      "commercial_adapter_invalid",
      `${label} must complete synchronously while the SQLite transaction is open.`,
    );
  }
  return result;
}

function insertProjection(db, table, columns, projection) {
  const values = columns.map((column) => projection[column] ?? null);
  const placeholders = columns.map(() => "?").join(", ");
  db.prepare(
    `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${placeholders})`,
  ).run(...values);
}

function createAtomicRunner(db) {
  let savepointSequence = 0;
  return function atomic(action) {
    if (db.isTransaction) {
      savepointSequence += 1;
      const savepoint = `commercial_test_store_${savepointSequence}`;
      db.exec(`SAVEPOINT ${savepoint}`);
      try {
        const result = action();
        db.exec(`RELEASE SAVEPOINT ${savepoint}`);
        return result;
      } catch (error) {
        db.exec(`ROLLBACK TO SAVEPOINT ${savepoint}`);
        db.exec(`RELEASE SAVEPOINT ${savepoint}`);
        throw error;
      }
    }
    db.exec("BEGIN IMMEDIATE");
    try {
      const result = action();
      db.exec("COMMIT");
      return result;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  };
}

function contractProjection(contract, createdAt) {
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
    contract_json: canonicalJson(contract),
    created_at: createdAt,
  };
}

function assertContractRow(row, contract) {
  const projected = contractProjection(contract, row.created_at);
  for (const column of COMMERCIAL_TEST_STORE_COLUMNS.contracts) {
    if (column === "contract_json" || column === "created_at") continue;
    if (row[column] !== projected[column]) {
      fail(
        "commercial_ledger_integrity_failed",
        `Commercial contract projection ${column} contradicts its immutable JSON.`,
      );
    }
  }
  const parsed = parseJsonObject(row.contract_json, "Commercial contract JSON");
  validateCommercialTestContract(parsed);
  if (!sameCanonical(parsed, contract)) {
    fail(
      "commercial_ledger_integrity_failed",
      "Commercial contract JSON does not match its decision hash.",
    );
  }
}

function lifecycleIntentMatches(event, input, expectedScopeHash) {
  return (
    event.eventType === input.eventType
    && event.approvalId === (input.approvalId ?? null)
    && event.approvalScopeHash === expectedScopeHash
    && event.reason === String(input.reason ?? "").replace(/\s+/g, " ").trim()
    && sameCanonical(event.metadata, input.metadata ?? {})
    && event.occurredAt === normalizedTimestamp(input.occurredAt, "Lifecycle occurredAt")
  );
}

function lifecycleState(events) {
  return events.at(-1)?.eventType || null;
}

function allowedLifecycleTransition(previous, next) {
  if (previous === null) return next === "proposed";
  if (previous === "proposed") return next === "accepted" || next === "stopped";
  if (previous === "accepted") return next === "activated" || next === "stopped";
  if (previous === "activated") {
    return next === "paused" || next === "closed" || next === "stopped";
  }
  if (previous === "paused") return next === "accepted" || next === "closed" || next === "stopped";
  return false;
}

function safeReceiptDocument(contract, source) {
  return {
    schema: COMMERCIAL_EVIDENCE_RECEIPT_SCHEMA,
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
}

function receiptProjection(contract, source, createdAt) {
  const receipt = safeReceiptDocument(contract, source);
  return {
    decision_hash: contract.decisionHash,
    receipt_id: source.receipt.id,
    receipt_schema: COMMERCIAL_EVIDENCE_RECEIPT_SCHEMA,
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
    receipt_json: canonicalJson(receipt),
    captured_at: source.capturedAt,
    created_at: createdAt,
  };
}

function sourceFromReceiptDocument(receipt) {
  if (receipt.schema !== COMMERCIAL_EVIDENCE_RECEIPT_SCHEMA) {
    fail(
      "commercial_ledger_integrity_failed",
      "Commercial receipt JSON uses an unsupported schema.",
    );
  }
  return {
    kind: receipt.sourceKind,
    sourceId: receipt.sourceId,
    providerNamespace: receipt.providerNamespace,
    accountHash: receipt.accountHash,
    sourceSystem: receipt.sourceSystem,
    exportType: receipt.exportType,
    sourceHash: receipt.sourceHash,
    receipt: {
      id: receipt.receiptId,
      hash: receipt.receiptHash,
      locationReference: receipt.locationReference,
    },
    verificationStatus: receipt.verificationStatus,
    reportingPeriod: receipt.reportingPeriod,
    coverage: receipt.coverage,
    capturedAt: receipt.capturedAt,
    generatedAt: receipt.generatedAt,
    importedAt: receipt.importedAt,
    importBatchId: receipt.importBatchId,
    manualReferenceHash: receipt.manualReferenceHash,
    attestedBy: receipt.attestedBy,
    attestationNote: receipt.attestationNote,
    entryReason: receipt.entryReason,
  };
}

function evidenceProjection(record, createdAt) {
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
    gross_revenue_original_minor_units: transaction?.grossRevenue.originalMinorUnits ?? null,
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
    record_json: canonicalJson(record),
    created_at: createdAt,
  };
}

function assertEvidenceRow(row, record) {
  const projected = evidenceProjection(record, row.created_at);
  for (const column of COMMERCIAL_TEST_STORE_COLUMNS.evidence) {
    if (column === "record_json" || column === "created_at") continue;
    if (row[column] !== projected[column]) {
      fail(
        "commercial_ledger_integrity_failed",
        `Commercial evidence projection ${column} contradicts its immutable JSON.`,
      );
    }
  }
}

function evaluationProjection(evaluation, evaluatedAt, createdAt = evaluatedAt) {
  return {
    evaluation_hash: evaluation.evaluationHash,
    proof_schema: evaluation.schema,
    decision_hash: evaluation.decisionHash,
    evidence_set_hash: evaluation.evidenceSetHash,
    outcome: evaluation.outcome,
    proof_reached: evaluation.proofReached ? 1 : 0,
    buyer_signal_only: evaluation.buyerSignalOnly ? 1 : 0,
    distinct_positive_buyers: evaluation.evidence.distinctPositiveBuyers,
    settled_revenue_aud_cents: evaluation.financials.settledRevenueAudCents,
    refunds_aud_cents: evaluation.financials.refundsAudCents,
    reconciled_costs_aud_cents: evaluation.financials.reconciledCostsAudCents,
    actual_net_cash_contribution_aud_cents:
      evaluation.financials.actualNetCashContributionAudCents,
    evaluation_json: canonicalJson(evaluation),
    evaluated_at: evaluatedAt,
    created_at: createdAt,
  };
}

function assertEvaluationRow(row, evaluation) {
  const {
    evaluationHash,
    ...payload
  } = evaluation;
  if (sha256(payload) !== evaluationHash) {
    fail(
      "commercial_ledger_integrity_failed",
      "Commercial proof evaluation hash does not match its immutable content.",
    );
  }
  const projected = evaluationProjection(
    evaluation,
    row.evaluated_at,
    row.created_at,
  );
  for (const column of COMMERCIAL_TEST_STORE_COLUMNS.evaluations) {
    if (row[column] !== projected[column]) {
      fail(
        "commercial_ledger_integrity_failed",
        `Commercial proof projection ${column} contradicts its immutable JSON.`,
      );
    }
  }
}

function createCommercialTestStore(db, options = {}) {
  if (!db || typeof db.prepare !== "function" || typeof db.exec !== "function") {
    fail("commercial_store_unavailable", "A synchronous SQLite database handle is required.");
  }
  const verifyImportedReceipt = options.verifyImportedReceipt;
  const buyerPseudonymizer = options.pseudonymizeBuyer;
  const clock = typeof options.clock === "function" ? options.clock : () => new Date();
  const atomic = createAtomicRunner(db);

  function timestamp() {
    return normalizedTimestamp(clock(), "Store clock");
  }

  function getContract(decisionHash) {
    const row = db.prepare(
      "SELECT * FROM commercial_test_contracts WHERE decision_hash = ?",
    ).get(decisionHash);
    if (!row) return null;
    const parsed = parseJsonObject(row.contract_json, "Commercial contract JSON");
    const contract = createCommercialTestContract(parsed);
    assertContractRow(row, contract);
    return contract;
  }

  function requireContract(decisionHash) {
    const contract = getContract(decisionHash);
    if (!contract) {
      fail("commercial_contract_not_found", "The commercial test contract is not registered.", {
        decisionHash,
      });
    }
    return contract;
  }

  function registerContract(contractInput) {
    validateCommercialTestContract(contractInput);
    return atomic(() => {
      const exact = db.prepare(
        "SELECT * FROM commercial_test_contracts WHERE decision_hash = ?",
      ).get(contractInput.decisionHash);
      if (exact) {
        const stored = getContract(contractInput.decisionHash);
        if (!sameCanonical(stored, contractInput)) {
          fail(
            "commercial_contract_conflict",
            "The decision hash is already bound to different contract content.",
          );
        }
        return { created: false, contract: stored };
      }
      const logical = db.prepare(
        `SELECT decision_hash
         FROM commercial_test_contracts
         WHERE program_id = ? AND program_version = ?
           AND test_id = ? AND test_version = ?`,
      ).get(
        contractInput.programId,
        contractInput.programVersion,
        contractInput.testId,
        contractInput.testVersion,
      );
      if (logical) {
        fail(
          "commercial_contract_version_conflict",
          "This commercial program and test version is already registered with different content.",
        );
      }
      const venture = db.prepare("SELECT id FROM ventures WHERE id = ?").get(
        contractInput.ventureId,
      );
      if (!venture) {
        fail(
          "commercial_venture_unregistered",
          "The contract venture is not registered in Pantheon.",
        );
      }
      const kit = db.prepare(
        `SELECT id, version, status, content_hash
         FROM venture_kits WHERE id = ? AND version = ?`,
      ).get(contractInput.ventureKit.id, contractInput.ventureKit.version);
      if (!kit || kit.status !== "active") {
        fail(
          "commercial_venture_kit_unavailable",
          "The exact active venture-kit version is not registered.",
        );
      }
      if (kit.content_hash !== contractInput.ventureKit.hash) {
        fail(
          "commercial_venture_kit_hash_mismatch",
          "The contract does not match the immutable registered venture-kit content.",
        );
      }
      insertProjection(
        db,
        "commercial_test_contracts",
        COMMERCIAL_TEST_STORE_COLUMNS.contracts,
        contractProjection(contractInput, timestamp()),
      );
      return { created: true, contract: getContract(contractInput.decisionHash) };
    });
  }

  function loadLifecycle(decisionHash) {
    const rows = db.prepare(
      `SELECT * FROM commercial_test_lifecycle_events
       WHERE decision_hash = ? ORDER BY sequence`,
    ).all(decisionHash);
    const events = [];
    let previousEventHash = null;
    for (let sequence = 0; sequence < rows.length; sequence += 1) {
      const row = rows[sequence];
      const parsed = parseJsonObject(row.event_json, "Commercial lifecycle event JSON");
      const event = createCommercialLifecycleEvent(parsed);
      if (!sameCanonical(event, parsed)) {
        fail(
          "commercial_ledger_integrity_failed",
          "Commercial lifecycle event JSON is not canonical.",
        );
      }
      const exact = {
        id: row.id,
        decisionHash: row.decision_hash,
        sequence: row.sequence,
        previousEventHash: row.previous_event_hash,
        eventType: row.event_type,
        eventHash: row.event_hash,
        approvalId: row.approval_id,
        approvalScopeHash: row.approval_scope_hash,
        reason: row.reason,
        metadata: parseJsonObject(row.metadata, "Commercial lifecycle metadata"),
        occurredAt: row.occurred_at,
      };
      for (const [field, projected] of Object.entries(exact)) {
        if (!sameCanonical(event[field], projected)) {
          fail(
            "commercial_ledger_integrity_failed",
            `Commercial lifecycle projection ${field} contradicts its immutable event.`,
          );
        }
      }
      if (row.sequence !== sequence || row.previous_event_hash !== previousEventHash) {
        fail(
          "commercial_lifecycle_chain_invalid",
          "Commercial lifecycle sequence or hash chain is not contiguous.",
        );
      }
      events.push(event);
      previousEventHash = event.eventHash;
    }
    return events;
  }

function approvalPayloadMatches(row, expectedScope, expectedHash) {
  const payload = parseJsonObject(row.payload, "Approval payload");
  const candidates = [
    payload.commercialTestApprovalScope,
    payload.commercialLifecycleApprovalScope,
    payload.approvalScope,
    payload.scope,
  ].filter(isObject);
  if (
    candidates.length > 0
    && !candidates.every((candidate) => sameCanonical(candidate, expectedScope))
  ) {
    return false;
  }
  const assertedHashes = [
    payload.commercialTestApprovalScopeHash,
    payload.commercialLifecycleApprovalScopeHash,
    payload.approvalScopeHash,
  ].filter((value) => value !== undefined);
  if (assertedHashes.some((value) => value !== expectedHash)) return false;
  if (String(row.scope || "").trim().startsWith("{")) {
    try {
      if (!sameCanonical(JSON.parse(row.scope), expectedScope)) return false;
    } catch {
      return false;
    }
  }
  return true;
}

  function assertApprovedScope(contract, eventType, approvalId, suppliedScope) {
    const expectedScope = commercialLifecycleApprovalScope(contract, eventType);
    const expectedHash = commercialLifecycleApprovalScopeHash(contract, eventType);
    if (!sameCanonical(suppliedScope, expectedScope)) {
      fail(
        "commercial_approval_scope_mismatch",
        "The approval does not match the exact immutable commercial decision.",
      );
    }
    const approval = db.prepare(
      `SELECT id, status, scope, scope_hash, payload, decided_at
       FROM approvals WHERE id = ?`,
    ).get(approvalId);
    if (!approval || approval.status !== "approved") {
      fail(
        "commercial_approval_required",
        "An approved Pantheon approval record is required for this lifecycle transition.",
      );
    }
    if (approval.scope_hash !== expectedHash) {
      fail(
        "commercial_approval_scope_mismatch",
        "The stored approval scope hash does not authorize this exact commercial decision.",
      );
    }
    if (!approvalPayloadMatches(approval, expectedScope, expectedHash)) {
      fail(
        "commercial_approval_scope_mismatch",
        "The stored approval does not authorize this exact commercial decision.",
      );
    }
    return { approval, scopeHash: expectedHash };
  }

  function assertLifecycleApprovalAvailable(events, approval, occurredAt) {
    const priorUse = db.prepare(
      `SELECT id, decision_hash, event_type
       FROM commercial_test_lifecycle_events
       WHERE approval_id = ?
         AND event_type IN ('accepted', 'activated')
       ORDER BY created_at, id
       LIMIT 1`,
    ).get(approval.id);
    if (priorUse) {
      fail(
        "commercial_approval_already_used",
        "Each commercial acceptance or activation needs its own unused approval.",
        {
          approvalId: approval.id,
          priorEventId: priorUse.id,
          priorDecisionHash: priorUse.decision_hash,
          priorEventType: priorUse.event_type,
        },
      );
    }

    const decisionTime = Date.parse(String(approval.decided_at || ""));
    const eventTime = Date.parse(occurredAt);
    if (!Number.isFinite(decisionTime) || decisionTime > eventTime) {
      fail(
        "commercial_approval_decision_time_invalid",
        "The commercial approval must have a valid decision time no later than its lifecycle event.",
        { approvalId: approval.id, decidedAt: approval.decided_at || null, occurredAt },
      );
    }

    const latestPause = [...events].reverse().find((event) => event.eventType === "paused");
    if (!latestPause) return;
    const pauseTime = Date.parse(latestPause.occurredAt);
    if (!Number.isFinite(pauseTime) || decisionTime <= pauseTime) {
      fail(
        "commercial_approval_stale_after_pause",
        "Resuming a paused commercial test requires a fresh approval decided after the latest pause.",
        {
          approvalId: approval.id,
          decidedAt: approval.decided_at || null,
          latestPauseEventId: latestPause.id,
          latestPauseAt: latestPause.occurredAt,
        },
      );
    }
  }

  function assertOnlyActiveProgram(decisionHash) {
    const rows = db.prepare(
      "SELECT decision_hash FROM commercial_test_contracts WHERE decision_hash <> ?",
    ).all(decisionHash);
    for (const row of rows) {
      if (lifecycleState(loadLifecycle(row.decision_hash)) === "activated") {
        fail(
          "commercial_program_already_active",
          "Another commercial program is already active.",
        );
      }
    }
  }

  function appendLifecycleInternal(contract, input) {
    const eventType = String(input.eventType || "");
    const approvalRequired = eventType === "accepted" || eventType === "activated";
    const approvalBinding = approvalRequired
      ? assertApprovedScope(
        contract,
        eventType,
        input.approvalId,
        input.approvalScope,
      )
      : null;
    const approvalScopeHash = approvalBinding?.scopeHash || null;
    const suppliedOccurredAt = input.occurredAt || timestamp();
    const occurredAt = normalizedTimestamp(suppliedOccurredAt, "Lifecycle occurredAt");
    if (input.eventId) {
      const existingRow = db.prepare(
        `SELECT decision_hash, event_json
         FROM commercial_test_lifecycle_events WHERE id = ?`,
      ).get(input.eventId);
      if (existingRow) {
        if (existingRow.decision_hash !== contract.decisionHash) {
          fail(
            "commercial_lifecycle_replay_conflict",
            "The lifecycle event ID is already bound to another commercial decision.",
          );
        }
        const existing = createCommercialLifecycleEvent(
          parseJsonObject(existingRow.event_json, "Commercial lifecycle event JSON"),
        );
        if (!lifecycleIntentMatches(existing, {
          ...input,
          occurredAt,
        }, approvalScopeHash)) {
          fail(
            "commercial_lifecycle_replay_conflict",
            "The lifecycle event ID is already bound to a different transition.",
          );
        }
        return { created: false, event: existing };
      }
    }
    const events = loadLifecycle(contract.decisionHash);
    const previous = lifecycleState(events);
    if (TERMINAL_LIFECYCLE_EVENTS.has(previous)) {
      fail(
        "commercial_program_terminal",
        "The commercial test is permanently terminal and cannot transition again.",
      );
    }
    if (!allowedLifecycleTransition(previous, eventType)) {
      fail(
        "commercial_lifecycle_transition_invalid",
        `Commercial lifecycle cannot transition from ${previous || "unregistered"} to ${eventType}.`,
      );
    }
    if (approvalRequired) {
      assertLifecycleApprovalAvailable(events, approvalBinding.approval, occurredAt);
    }
    if (eventType === "activated") assertOnlyActiveProgram(contract.decisionHash);
    if (eventType === "closed") {
      const evaluation = evaluateCommercialProof(
        contract,
        loadEvidence(contract.decisionHash),
      );
      if (
        !evaluation.proofRequirements.closedEvidenceManifest
        || evaluation.blockers.length > 0
      ) {
        fail(
          "commercial_evidence_not_sealed",
          "A commercial test cannot close until its current full evidence set is sealed.",
        );
      }
    }
    const sequence = events.length;
    const id = input.eventId || `commercial_lifecycle_${sha256({
      decisionHash: contract.decisionHash,
      sequence,
      eventType,
      occurredAt,
    }).slice(7, 39)}`;
    const event = createCommercialLifecycleEvent({
      id,
      decisionHash: contract.decisionHash,
      sequence,
      previousEventHash: events.at(-1)?.eventHash || null,
      eventType,
      approvalId: approvalRequired ? input.approvalId : null,
      approvalScopeHash,
      reason: input.reason || "",
      metadata: input.metadata || {},
      occurredAt,
    });
    const projection = {
      id: event.id,
      decision_hash: event.decisionHash,
      sequence: event.sequence,
      previous_event_hash: event.previousEventHash,
      event_type: event.eventType,
      event_hash: event.eventHash,
      approval_id: event.approvalId,
      approval_scope_hash: event.approvalScopeHash,
      reason: event.reason,
      metadata: canonicalJson(event.metadata),
      event_json: canonicalJson(event),
      occurred_at: event.occurredAt,
      created_at: timestamp(),
    };
    insertProjection(
      db,
      "commercial_test_lifecycle_events",
      COMMERCIAL_TEST_STORE_COLUMNS.lifecycle,
      projection,
    );
    return { created: true, event };
  }

  function appendLifecycle(decisionHash, input = {}) {
    if (input.eventType === "stopped") {
      fail(
        "commercial_terminal_evidence_required",
        "Use stopTest so terminal evidence and operating authority are written atomically.",
      );
    }
    return atomic(() => appendLifecycleInternal(requireContract(decisionHash), input));
  }

  function ensureEvidenceWriteable(decisionHash) {
    const events = loadLifecycle(decisionHash);
    const state = lifecycleState(events);
    if (TERMINAL_LIFECYCLE_EVENTS.has(state)) {
      fail(
        "commercial_program_terminal",
        "The commercial test is terminal and its evidence ledger is closed.",
      );
    }
    if (!WRITEABLE_EVIDENCE_STATES.has(state)) {
      fail(
        "commercial_program_inactive",
        "Commercial evidence can be recorded only after the test is accepted.",
      );
    }
    return state;
  }

  function trustedImportedVerification(contract, source, batch) {
    if (typeof verifyImportedReceipt !== "function") {
      fail(
        "commercial_import_verifier_unavailable",
        "Imported evidence requires a configured trusted receipt verifier.",
      );
    }
    const result = ensureSynchronous(
      verifyImportedReceipt({
        contract,
        source: canonical(source),
        verificationMaterial: batch.verificationMaterial,
        records: batch.records,
      }),
      "Imported receipt verifier",
    );
    const verified = result === true || result?.verified === true;
    if (!verified) {
      fail(
        "commercial_import_unverified",
        "The trusted adapter could not verify the imported receipt.",
      );
    }
    const exactChecks = [
      ["receiptHash", source.receipt?.hash],
      ["sourceHash", source.sourceHash],
      ["coverageControlHash", source.coverage?.controlHash],
    ];
    for (const [key, expected] of exactChecks) {
      if (result?.[key] !== undefined && result[key] !== expected) {
        fail(
          "commercial_import_verification_conflict",
          `The trusted adapter returned a conflicting ${key}.`,
        );
      }
    }
  }

  function buildTransactionRecord(contract, input, source) {
    if (typeof buyerPseudonymizer !== "function") {
      fail(
        "commercial_buyer_pseudonymizer_unavailable",
        "Transaction evidence requires a configured buyer pseudonymizer.",
      );
    }
    const pseudonym = ensureSynchronous(
      buyerPseudonymizer(contract, input.buyerReference),
      "Buyer pseudonymizer",
    );
    if (!BUYER_PSEUDONYM_PATTERN.test(String(pseudonym || ""))) {
      fail(
        "commercial_buyer_pseudonym_invalid",
        "Buyer pseudonymization did not return a contract-safe one-way digest.",
      );
    }
    const ephemeral = createCommercialEvidenceRecord(contract, {
      ...input,
      source,
    }, {
      pseudonymizationKey: Buffer.alloc(32, 173),
    });
    const record = JSON.parse(JSON.stringify(ephemeral));
    delete record.recordHash;
    record.transaction.buyer.pseudonym = pseudonym;
    record.transaction.transactionEconomicHash = transactionEconomicHash(record);
    record.recordHash = sha256(record);
    validateCommercialEvidenceRecord(contract, record);
    return record;
  }

  function buildBatchRecords(contract, batch, source) {
    if (!Array.isArray(batch.records) || batch.records.length === 0) {
      fail(
        "commercial_evidence_batch_empty",
        "A commercial evidence batch must contain at least one record.",
      );
    }
    if (source.kind === "operator_attested_manual" && batch.records.length !== 1) {
      fail(
        "commercial_manual_batch_invalid",
        "Each manual retained source may contain exactly one evidence record.",
      );
    }
    return batch.records.map((input) => {
      if (!isObject(input) || !["transaction", "cost"].includes(input.kind)) {
        fail(
          "commercial_evidence_kind_invalid",
          "Evidence ingestion accepts only transaction or cost records.",
        );
      }
      if (Object.hasOwn(input, "source")) {
        fail(
          "commercial_evidence_source_ambiguous",
          "Evidence rows must use the batch's one retained source.",
        );
      }
      const {
        sourceRowHash,
        ...evidenceInput
      } = input;
      const rowSource = {
        ...source,
        sourceRowHash: sourceRowHash || source.sourceRowHash,
      };
      return evidenceInput.kind === "transaction"
        ? buildTransactionRecord(contract, evidenceInput, rowSource)
        : createCommercialEvidenceRecord(contract, {
          ...evidenceInput,
          source: rowSource,
        });
    });
  }

  function assertReceiptCompatible(contract, source) {
    const existing = db.prepare(
      `SELECT * FROM commercial_test_evidence_receipts
       WHERE decision_hash = ? AND receipt_id = ?`,
    ).get(contract.decisionHash, source.receipt.id);
    if (!existing) return false;
    const expected = receiptProjection(contract, source, existing.created_at);
    for (const column of COMMERCIAL_TEST_STORE_COLUMNS.receipts) {
      if (column === "created_at") continue;
      if (existing[column] !== expected[column]) {
        fail(
          "commercial_receipt_replay_conflict",
          "The receipt ID is already bound to different immutable provenance.",
        );
      }
    }
    return true;
  }

  function insertReceipt(contract, source, createdAt) {
    if (assertReceiptCompatible(contract, source)) return false;
    const hashCollision = db.prepare(
      `SELECT receipt_id FROM commercial_test_evidence_receipts
       WHERE decision_hash = ? AND receipt_hash = ?`,
    ).get(contract.decisionHash, source.receipt.hash);
    if (hashCollision) {
      fail(
        "commercial_receipt_identity_conflict",
        "The retained receipt hash is already registered under a different receipt ID.",
      );
    }
    insertProjection(
      db,
      "commercial_test_evidence_receipts",
      COMMERCIAL_TEST_STORE_COLUMNS.receipts,
      receiptProjection(contract, source, createdAt),
    );
    return true;
  }

  function assertLinearRecord(record) {
    const chain = record.transaction?.chain || record.cost?.chain;
    const keyColumn = record.kind === "transaction" ? "transaction_key" : "cost_key";
    const key = record.transaction?.transactionKey || record.cost?.costKey;
    const sequenceColumn = record.kind === "transaction"
      ? "transaction_chain_sequence"
      : "cost_chain_sequence";
    const economicColumn = record.kind === "transaction"
      ? "transaction_economic_hash"
      : "cost_economic_hash";
    const economicHash = record.transaction?.transactionEconomicHash
      || record.cost?.costEconomicHash;
    const atSequence = db.prepare(
      `SELECT record_hash, ${economicColumn} AS economic_hash
       FROM commercial_test_evidence_records
       WHERE decision_hash = ? AND ${keyColumn} = ? AND ${sequenceColumn} = ?`,
    ).all(record.testBinding.decisionHash, key, chain.sequence);
    if (atSequence.some((row) => row.economic_hash !== economicHash)) {
      fail(
        "commercial_evidence_route_conflict",
        "Conflicting economic evidence exists for the same route-independent identity and revision.",
      );
    }
    if (chain.sequence > 0 && atSequence.length > 0) {
      return { semanticDuplicate: true };
    }
    if (chain.sequence === 0) {
      const prior = db.prepare(
        `SELECT record_hash FROM commercial_test_evidence_records
         WHERE decision_hash = ? AND ${keyColumn} = ? AND ${sequenceColumn} > 0 LIMIT 1`,
      ).get(record.testBinding.decisionHash, key);
      if (prior) {
        fail(
          "commercial_evidence_chain_conflict",
          "An original cannot be appended after revisions already exist.",
        );
      }
      return { semanticDuplicate: false };
    }
    const predecessor = db.prepare(
      `SELECT decision_hash, kind, record_json
       FROM commercial_test_evidence_records WHERE record_hash = ?`,
    ).get(chain.predecessorRecordHash);
    if (!predecessor) {
      fail(
        "commercial_evidence_chain_gap",
        "Evidence revision predecessor is absent.",
      );
    }
    if (
      predecessor.decision_hash !== record.testBinding.decisionHash
      || predecessor.kind !== record.kind
    ) {
      fail(
        "commercial_evidence_chain_scope_conflict",
        "Evidence revision predecessor belongs to another test or evidence kind.",
      );
    }
    const predecessorRecord = parseJsonObject(
      predecessor.record_json,
      "Evidence predecessor JSON",
    );
    const predecessorKey = predecessorRecord.transaction?.transactionKey
      || predecessorRecord.cost?.costKey;
    const predecessorSequence = predecessorRecord.transaction?.chain.sequence
      ?? predecessorRecord.cost?.chain.sequence;
    if (predecessorKey !== key || predecessorSequence !== chain.sequence - 1) {
      fail(
        "commercial_evidence_chain_gap",
        "Evidence revisions must form one contiguous full-snapshot chain.",
      );
    }
    const later = db.prepare(
      `SELECT record_hash FROM commercial_test_evidence_records
       WHERE decision_hash = ? AND ${keyColumn} = ? AND ${sequenceColumn} > ? LIMIT 1`,
    ).get(record.testBinding.decisionHash, key, chain.sequence);
    if (later) {
      fail(
        "commercial_evidence_chain_fork",
        "Evidence cannot be inserted behind the current revision head.",
      );
    }
    return { semanticDuplicate: false };
  }

  function insertEvidenceRecord(contract, record, createdAt) {
    validateCommercialEvidenceRecord(contract, record);
    const exact = db.prepare(
      "SELECT * FROM commercial_test_evidence_records WHERE record_hash = ?",
    ).get(record.recordHash);
    if (exact) {
      const parsed = parseJsonObject(exact.record_json, "Commercial evidence JSON");
      validateCommercialEvidenceRecord(contract, parsed);
      assertEvidenceRow(exact, parsed);
      if (!sameCanonical(parsed, record)) {
        fail(
          "commercial_evidence_hash_conflict",
          "The evidence hash is already bound to different immutable content.",
        );
      }
      return false;
    }
    const identity = db.prepare(
      `SELECT record_hash FROM commercial_test_evidence_records
       WHERE decision_hash = ? AND evidence_id = ? AND evidence_version = ?`,
    ).get(
      contract.decisionHash,
      record.evidenceId,
      record.evidenceVersion,
    );
    if (identity) {
      fail(
        "commercial_evidence_identity_conflict",
        "The evidence identity and version are already bound to different content.",
      );
    }
    if (record.kind === "transaction" || record.kind === "cost") {
      const chainAssessment = assertLinearRecord(record);
      if (chainAssessment.semanticDuplicate) return false;
    }
    insertProjection(
      db,
      "commercial_test_evidence_records",
      COMMERCIAL_TEST_STORE_COLUMNS.evidence,
      evidenceProjection(record, createdAt),
    );
    return true;
  }

  function isPotentialNoOp(record) {
    if (db.prepare(
      "SELECT 1 AS present FROM commercial_test_evidence_records WHERE record_hash = ?",
    ).get(record.recordHash)) {
      return true;
    }
    const chain = record.transaction?.chain || record.cost?.chain;
    if (!chain || chain.sequence === 0) return false;
    const keyColumn = record.kind === "transaction" ? "transaction_key" : "cost_key";
    const sequenceColumn = record.kind === "transaction"
      ? "transaction_chain_sequence"
      : "cost_chain_sequence";
    const economicColumn = record.kind === "transaction"
      ? "transaction_economic_hash"
      : "cost_economic_hash";
    const key = record.transaction?.transactionKey || record.cost?.costKey;
    const economicHash = record.transaction?.transactionEconomicHash
      || record.cost?.costEconomicHash;
    const existing = db.prepare(
      `SELECT ${economicColumn} AS economic_hash
       FROM commercial_test_evidence_records
       WHERE decision_hash = ? AND ${keyColumn} = ? AND ${sequenceColumn} = ?`,
    ).all(record.testBinding.decisionHash, key, chain.sequence);
    return existing.length > 0 && existing.every(
      (row) => row.economic_hash === economicHash,
    );
  }

  function persistReceiptAndRecords(contract, source, records) {
    const createdAt = timestamp();
    const receiptExists = db.prepare(
      `SELECT 1 AS present FROM commercial_test_evidence_receipts
       WHERE decision_hash = ? AND receipt_id = ?`,
    ).get(contract.decisionHash, source.receipt.id);
    if (!receiptExists && records.every(isPotentialNoOp)) {
      for (const record of records) {
        if (insertEvidenceRecord(contract, record, createdAt)) {
          fail(
            "commercial_evidence_replay_conflict",
            "Evidence replay preflight changed while the transaction was open.",
          );
        }
      }
      return { receiptCreated: false, inserted: 0, records };
    }
    const receiptCreated = insertReceipt(contract, source, createdAt);
    let inserted = 0;
    const ordered = [...records].sort((left, right) => {
      const kind = left.kind.localeCompare(right.kind);
      if (kind) return kind;
      const leftKey = left.transaction?.transactionKey || left.cost?.costKey || "";
      const rightKey = right.transaction?.transactionKey || right.cost?.costKey || "";
      const key = leftKey.localeCompare(rightKey);
      if (key) return key;
      const leftSequence = left.transaction?.chain.sequence ?? left.cost?.chain.sequence ?? 0;
      const rightSequence = right.transaction?.chain.sequence ?? right.cost?.chain.sequence ?? 0;
      return leftSequence - rightSequence;
    });
    for (const record of ordered) {
      if (insertEvidenceRecord(contract, record, createdAt)) inserted += 1;
    }
    return { receiptCreated, inserted, records };
  }

  function ingestEvidenceBatch(decisionHash, batch = {}) {
    return atomic(() => {
      const contract = requireContract(decisionHash);
      ensureEvidenceWriteable(decisionHash);
      if (!isObject(batch.source)) {
        fail(
          "commercial_evidence_source_missing",
          "A retained batch source is required.",
        );
      }
      const requestedSource = JSON.parse(JSON.stringify(batch.source));
      if (requestedSource.kind === "imported_platform") {
        trustedImportedVerification(contract, requestedSource, batch);
        requestedSource.verificationStatus = "verified";
      } else if (requestedSource.kind === "operator_attested_manual") {
        requestedSource.verificationStatus = "pending";
      } else {
        fail(
          "commercial_evidence_source_invalid",
          "Evidence source kind must be imported_platform or operator_attested_manual.",
        );
      }
      const records = buildBatchRecords(contract, batch, requestedSource);
      const canonicalSource = records[0].source;
      const receiptDocument = safeReceiptDocument(contract, canonicalSource);
      if (records.some((record) => !sameCanonical(
        safeReceiptDocument(contract, record.source),
        receiptDocument,
      ))) {
        fail(
          "commercial_evidence_batch_source_conflict",
          "Every evidence row in a batch must share one exact retained source receipt.",
        );
      }
      return persistReceiptAndRecords(contract, canonicalSource, records);
    });
  }

  function loadEvidence(decisionHash) {
    const contract = requireContract(decisionHash);
    return db.prepare(
      `SELECT * FROM commercial_test_evidence_records
       WHERE decision_hash = ? ORDER BY captured_at, record_hash`,
    ).all(decisionHash).map((row) => {
      const record = parseJsonObject(row.record_json, "Commercial evidence JSON");
      validateCommercialEvidenceRecord(contract, record);
      assertEvidenceRow(row, record);
      return record;
    });
  }

  function verifyManualEvidence(decisionHash, input = {}) {
    return atomic(() => {
      const contract = requireContract(decisionHash);
      ensureEvidenceWriteable(decisionHash);
      const row = db.prepare(
        `SELECT record_json FROM commercial_test_evidence_records
         WHERE decision_hash = ? AND record_hash = ?`,
      ).get(decisionHash, input.originalRecordHash);
      if (!row) {
        fail(
          "commercial_manual_original_not_found",
          "The manual evidence record to verify was not found.",
        );
      }
      const original = parseJsonObject(row.record_json, "Manual original evidence JSON");
      validateCommercialEvidenceRecord(contract, original);
      if (
        !["transaction", "cost"].includes(original.kind)
        || original.source.kind !== "operator_attested_manual"
        || original.source.verificationStatus !== "pending"
      ) {
        fail(
          "commercial_manual_original_invalid",
          "Only a pending manual transaction or cost can receive separate verification.",
        );
      }
      if (!["verified", "rejected"].includes(input.status)) {
        fail(
          "commercial_manual_verdict_invalid",
          "Manual verification status must be verified or rejected.",
        );
      }
      if (!isObject(input.source) || input.source.kind !== "operator_attested_manual") {
        fail(
          "commercial_manual_verification_source_invalid",
          "Manual verification requires its own retained operator receipt.",
        );
      }
      const source = {
        ...input.source,
        verificationStatus: input.status,
      };
      const record = createManualVerificationRecord(contract, original, {
        evidenceId: input.evidenceId,
        evidenceVersion: input.evidenceVersion,
        source,
        attribution: input.attribution,
        scope: input.scope,
        status: input.status,
        reviewerId: input.reviewerId,
        reviewedAt: input.reviewedAt,
      });
      return persistReceiptAndRecords(contract, record.source, [record]);
    });
  }

  function persistEvaluation(evaluation, evaluatedAt) {
    const existing = db.prepare(
      "SELECT * FROM commercial_test_proof_evaluations WHERE evaluation_hash = ?",
    ).get(evaluation.evaluationHash);
    if (existing) {
      const parsed = parseJsonObject(existing.evaluation_json, "Commercial proof evaluation JSON");
      assertEvaluationRow(existing, parsed);
      if (!sameCanonical(parsed, evaluation)) {
        fail(
          "commercial_evaluation_hash_conflict",
          "The proof evaluation hash is already bound to different content.",
        );
      }
      return false;
    }
    insertProjection(
      db,
      "commercial_test_proof_evaluations",
      COMMERCIAL_TEST_STORE_COLUMNS.evaluations,
      evaluationProjection(evaluation, evaluatedAt),
    );
    return true;
  }

  function sealEvidenceSet(decisionHash, input = {}) {
    return atomic(() => {
      const contract = requireContract(decisionHash);
      ensureEvidenceWriteable(decisionHash);
      const records = loadEvidence(decisionHash);
      const predecessorManifest = records
        .filter((record) => record.kind === "evidence_set_manifest")
        .sort((left, right) => (
          right.manifest.revision.sequence - left.manifest.revision.sequence
        ))[0] || null;
      const manifest = createEvidenceSetManifest(contract, records, {
        evidenceId: input.evidenceId,
        evidenceVersion: input.evidenceVersion,
        source: {
          ...input.source,
          verificationStatus: "verified",
        },
        attribution: input.attribution,
        scope: input.scope,
        reportingPeriod: input.reportingPeriod,
        closedAt: input.closedAt,
        predecessorManifest,
      });
      const evaluation = evaluateCommercialProof(contract, [...records, manifest]);
      if (evaluation.blockers.length > 0) {
        fail(
          "commercial_evidence_set_incomplete",
          "The evidence set cannot be sealed until every retained source and fixed cost is complete.",
          { blockerCodes: evaluation.blockers.map((blocker) => blocker.code) },
        );
      }
      const persisted = persistReceiptAndRecords(contract, manifest.source, [manifest]);
      persistEvaluation(evaluation, timestamp());
      return { ...persisted, manifest, evaluation };
    });
  }

  function stopTest(decisionHash, input = {}) {
    return atomic(() => {
      const contract = requireContract(decisionHash);
      const priorState = lifecycleState(loadLifecycle(decisionHash));
      if (TERMINAL_LIFECYCLE_EVENTS.has(priorState)) {
        if (!input.lifecycle?.eventId) {
          fail(
            "commercial_program_terminal",
            "The commercial test is already terminal.",
          );
        }
      }
      if (!isObject(input.source)) {
        fail(
          "commercial_terminal_source_missing",
          "Terminal stop evidence requires a retained control receipt.",
        );
      }
      const record = createTerminalStopRecord(contract, {
        evidenceId: input.evidenceId,
        evidenceVersion: input.evidenceVersion,
        source: {
          ...input.source,
          verificationStatus: "verified",
        },
        attribution: input.attribution,
        scope: input.scope,
        code: input.code,
        reason: input.reason,
        stoppedAt: input.stoppedAt,
        approvalId: input.approvalId ?? null,
      });
      if (
        TERMINAL_LIFECYCLE_EVENTS.has(priorState)
        && !db.prepare(
          `SELECT 1 AS present FROM commercial_test_evidence_records
           WHERE decision_hash = ? AND kind = 'terminal_stop' AND record_hash = ?`,
        ).get(decisionHash, record.recordHash)
      ) {
        fail(
          "commercial_program_terminal",
          "A terminal test accepts only an exact replay of its existing stop evidence.",
        );
      }
      const persisted = persistReceiptAndRecords(contract, record.source, [record]);
      const lifecycle = appendLifecycleInternal(contract, {
        ...(input.lifecycle || {}),
        eventType: "stopped",
        reason: input.reason,
        occurredAt: input.stoppedAt,
      });
      const evaluation = evaluateCommercialProof(contract, loadEvidence(decisionHash));
      persistEvaluation(evaluation, timestamp());
      return { ...persisted, record, lifecycle, evaluation };
    });
  }

  function evaluate(decisionHash) {
    return atomic(() => {
      const contract = requireContract(decisionHash);
      const evaluation = evaluateCommercialProof(contract, loadEvidence(decisionHash));
      persistEvaluation(evaluation, timestamp());
      return evaluation;
    });
  }

  function loadReceipts(decisionHash) {
    const contract = requireContract(decisionHash);
    return db.prepare(
      `SELECT * FROM commercial_test_evidence_receipts
       WHERE decision_hash = ? ORDER BY captured_at, receipt_id`,
    ).all(decisionHash).map((row) => {
      const receipt = parseJsonObject(row.receipt_json, "Commercial evidence receipt JSON");
      if (receipt.decisionHash !== decisionHash) {
        fail(
          "commercial_ledger_integrity_failed",
          "Commercial receipt JSON belongs to another decision.",
        );
      }
      const expected = receiptProjection(
        contract,
        sourceFromReceiptDocument(receipt),
        row.created_at,
      );
      for (const column of COMMERCIAL_TEST_STORE_COLUMNS.receipts) {
        if (column === "created_at") continue;
        if (row[column] !== expected[column]) {
          fail(
            "commercial_ledger_integrity_failed",
            `Commercial receipt projection ${column} contradicts its immutable JSON.`,
          );
        }
      }
      return receipt;
    });
  }

  function readStoredEvaluations(decisionHash) {
    return db.prepare(
      `SELECT * FROM commercial_test_proof_evaluations
       WHERE decision_hash = ? ORDER BY evaluated_at, evaluation_hash`,
    ).all(decisionHash).map((row) => {
      const evaluation = parseJsonObject(
        row.evaluation_json,
        "Commercial proof evaluation JSON",
      );
      assertEvaluationRow(row, evaluation);
      return evaluation;
    });
  }

  function currentEvaluation(decisionHash) {
    const contract = requireContract(decisionHash);
    return evaluateCommercialProof(contract, loadEvidence(decisionHash));
  }

  function readLedger(decisionHash) {
    const contract = requireContract(decisionHash);
    const lifecycle = loadLifecycle(decisionHash);
    const evidence = loadEvidence(decisionHash);
    return {
      contract,
      lifecycle,
      state: lifecycleState(lifecycle),
      receipts: loadReceipts(decisionHash),
      evidence,
      evaluation: evaluateCommercialProof(contract, evidence),
      storedEvaluations: readStoredEvaluations(decisionHash),
    };
  }

  function listSummaries() {
    return db.prepare(
      `SELECT decision_hash FROM commercial_test_contracts
       ORDER BY created_at, decision_hash`,
    ).all().map((row) => {
      const contract = requireContract(row.decision_hash);
      const lifecycle = loadLifecycle(row.decision_hash);
      const evaluation = currentEvaluation(row.decision_hash);
      return {
        decisionHash: contract.decisionHash,
        programId: contract.programId,
        programVersion: contract.programVersion,
        testId: contract.testId,
        testVersion: contract.testVersion,
        ventureId: contract.ventureId,
        offer: contract.offer,
        channel: contract.channel,
        reportingPeriod: contract.reportingPeriod,
        state: lifecycleState(lifecycle),
        terminal: TERMINAL_LIFECYCLE_EVENTS.has(lifecycleState(lifecycle)),
        outcome: evaluation.outcome,
        proofReached: evaluation.proofReached,
        distinctPositiveBuyers: evaluation.evidence.distinctPositiveBuyers,
        actualNetCashContributionAudCents:
          evaluation.financials.actualNetCashContributionAudCents,
        evidenceSetHash: evaluation.evidenceSetHash,
        evaluationHash: evaluation.evaluationHash,
        blockers: evaluation.blockers,
      };
    });
  }

  return Object.freeze({
    registerContract,
    getContract,
    appendLifecycle,
    ingestEvidenceBatch,
    verifyManualEvidence,
    sealEvidenceSet,
    stopTest,
    readLedger,
    evaluate,
    listSummaries,
  });
}

module.exports = {
  COMMERCIAL_EVIDENCE_RECEIPT_SCHEMA,
  COMMERCIAL_TEST_STORE_COLUMNS,
  CommercialTestStoreError,
  createCommercialTestStore,
};
