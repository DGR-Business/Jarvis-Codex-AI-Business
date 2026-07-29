const {
  COST_CATEGORIES,
  OPERATOR_ROLE,
  PROTECTED_ACTION_KEYS,
  createCommercialTestContract,
  offerDefinitionHash,
  sha256,
} = require("../../src/runtime/commercial-test-contract");
const {
  commercialLifecycleApprovalScope,
  commercialLifecycleApprovalScopeHash,
} = require("../../src/runtime/commercial-authority");
const {
  createCommercialTestStore,
} = require("../../src/runtime/commercial-test-store");
const {
  DIGITAL_PRODUCT_V1,
  ensureVentureKitRegistry,
} = require("../../src/runtime/venture-kit-registry");
const {
  ventureKitContentHash,
} = require("../../src/runtime/venture-kit-definition");

const FIXTURE_TIME = "2026-07-29T00:00:00.000Z";

function slug(value) {
  const normalized = String(value || "fixture")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized.slice(0, 40) || "fixture";
}

function protectedActions() {
  return Object.fromEntries(
    PROTECTED_ACTION_KEYS.map((key) => [key, true]),
  );
}

function buildActivatedCommercialTestFixture(suffix = "fixture") {
  const id = slug(suffix);
  const accountHash = sha256(`fixture-marketplace-account-${id}`);
  const offerDefinition = {
    id: `offer.${id}`,
    version: "1.0.0",
    sku: `fixture_${id.replace(/-/g, "_")}_aud_29`,
    description: `Exact low-touch digital-kit test fixture ${id}`,
    contentHash: sha256(`fixture-offer-content-${id}`),
  };
  const contract = createCommercialTestContract({
    programId: `program-${id}`,
    programVersion: "1.0.0",
    testId: `test-${id}`,
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
    buyer: "Independent service professionals with a defined workflow problem",
    problem: "The buyer needs a low-touch operational kit with clear evidence",
    experiment: {
      id: `experiment.${id}`,
      version: "1.0.0",
      hypothesis: "The exact buyer will pay A$29 for the exact digital kit",
      primaryMetric: "positive_independent_settled_buyers",
      deadlineAt: "2026-09-02T00:00:00.000Z",
    },
    cohort: {
      id: `cohort.${id}`,
      definition: "Buyers exposed only through the exact approved test channel",
    },
    reportingPeriod: {
      startsAt: "2026-08-01T00:00:00.000Z",
      endsAt: "2026-08-31T23:59:59.999Z",
    },
    channel: {
      id: `marketplace.${id}`,
      providerNamespace: `marketplace.${id}`,
      accountHash,
      adapter: {
        id: `adapter.${id}`,
        version: "2.0.0",
        hash: sha256(`fixture-adapter-${id}`),
      },
    },
    price: {
      currency: "AUD",
      amountMinorUnits: 2900,
      amountAudCents: 2900,
    },
    buyerIdentity: {
      method: "hmac_sha256",
      keyId: `buyer_key.${id}`,
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
      acceptedSourceKinds: [
        "imported_platform",
        "operator_attested_manual",
      ],
      requiredCostCategories: COST_CATEGORIES,
      requiredSources: [{
        id: `platform_settlement.${id}`,
        acceptedKinds: [
          "imported_platform",
          "operator_attested_manual",
        ],
        providerNamespace: `marketplace.${id}`,
        accountHash,
        sourceSystem: `marketplace_settlement.${id}`,
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
  const binding = {
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
  return { contract, binding };
}

function createLifecycleApproval(db, contract, eventType, suffix) {
  const approvalScope = commercialLifecycleApprovalScope(contract, eventType);
  const scopeHash = commercialLifecycleApprovalScopeHash(contract, eventType);
  const approvalId = `approval-commercial-${slug(suffix)}-${eventType}`;
  db.prepare(`
    INSERT INTO approvals
    (id, workflow_id, scope, title, status, risk_level, requested_by,
     requested_at, decided_at, decision_note, payload, scope_hash)
    VALUES (?, NULL, ?, ?, 'approved', 'high', 'operator', ?, ?, ?, ?, ?)
  `).run(
    approvalId,
    `commercial_test_${eventType}`,
    `Approve exact commercial test ${eventType}`,
    FIXTURE_TIME,
    FIXTURE_TIME,
    "Controlled test fixture approval for the exact immutable scope.",
    JSON.stringify({
      commercialTestApprovalScope: approvalScope,
      commercialTestApprovalScopeHash: scopeHash,
    }),
    scopeHash,
  );
  return { approvalId, approvalScope };
}

function mergeJsonField(value, key, entry) {
  let parsed = {};
  if (typeof value === "string" && value.trim()) parsed = JSON.parse(value);
  else if (value && typeof value === "object") parsed = value;
  return JSON.stringify({
    ...parsed,
    [key]: entry,
  });
}

function bindWorkflowToCommercialTest(db, workflowId, binding) {
  const workflow = db.prepare(
    "SELECT id, metadata FROM workflows WHERE id = ?",
  ).get(workflowId);
  if (!workflow) throw new Error(`Commercial fixture workflow not found: ${workflowId}`);
  db.prepare(
    "UPDATE workflows SET metadata = ?, updated_at = ? WHERE id = ?",
  ).run(
    mergeJsonField(workflow.metadata, "commercialTestContract", binding),
    FIXTURE_TIME,
    workflowId,
  );
}

function bindTaskToCommercialTest(db, taskId, binding) {
  const task = db.prepare(
    "SELECT id, payload FROM tasks WHERE id = ?",
  ).get(taskId);
  if (!task) throw new Error(`Commercial fixture task not found: ${taskId}`);
  db.prepare(
    "UPDATE tasks SET payload = ?, updated_at = ? WHERE id = ?",
  ).run(
    mergeJsonField(task.payload, "commercialTestContract", binding),
    FIXTURE_TIME,
    taskId,
  );
}

function installActivatedCommercialTestFixture(db, options = {}) {
  const suffix = slug(options.suffix || "fixture");
  const fixture = buildActivatedCommercialTestFixture(suffix);
  ensureVentureKitRegistry(db);
  const store = createCommercialTestStore(db, {
    clock: () => new Date(FIXTURE_TIME),
  });
  store.registerContract(fixture.contract);
  store.appendLifecycle(fixture.contract.decisionHash, {
    eventId: `fixture-lifecycle-${suffix}-proposed`,
    eventType: "proposed",
    occurredAt: "2026-07-29T00:00:00.000Z",
  });
  for (const [eventType, occurredAt] of [
    ["accepted", "2026-07-29T00:01:00.000Z"],
    ["activated", "2026-07-29T00:02:00.000Z"],
  ]) {
    const approval = createLifecycleApproval(
      db,
      fixture.contract,
      eventType,
      suffix,
    );
    store.appendLifecycle(fixture.contract.decisionHash, {
      eventId: `fixture-lifecycle-${suffix}-${eventType}`,
      eventType,
      approvalId: approval.approvalId,
      approvalScope: approval.approvalScope,
      occurredAt,
    });
  }
  for (const workflowId of options.workflowIds || []) {
    bindWorkflowToCommercialTest(db, workflowId, fixture.binding);
  }
  for (const taskId of options.taskIds || []) {
    bindTaskToCommercialTest(db, taskId, fixture.binding);
  }
  return fixture;
}

module.exports = {
  bindTaskToCommercialTest,
  bindWorkflowToCommercialTest,
  buildActivatedCommercialTestFixture,
  installActivatedCommercialTestFixture,
};
