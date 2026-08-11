"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const authority = require("../config/preventure-research-authority-smm-scope-guard-v1");
const readinessSpec = require("../config/commercial-readiness-social-media-manager-scope-guard-v1");
const {
  REQUIRED_READINESS_GATE_IDS,
  createPreventureResearchDecision,
} = require("../src/runtime/preventure-research-contract");
const {
  createPreventureResearchFinalizer,
} = require("../src/runtime/preventure-research-finalizer");
const {
  evaluatePreventureResearchReadiness,
} = require("../src/runtime/preventure-research-readiness");
const {
  preventureResultingReadinessHash,
} = require("../src/runtime/preventure-research-store");
const { sha256 } = require("../src/runtime/commercial-test-contract");
const {
  derivePreventureResearchSourceIdentity,
} = require("../src/runtime/preventure-research-source-identity");
const {
  historicalV1TestRegistry,
} = require("./support/preventure-research-test-registry");

const FIXTURE_TIME = "2026-08-02T14:00:00+10:00";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function evidenceDetails(overrides = {}) {
  return {
    channelCase: null,
    comparator: null,
    buyerEvidence: null,
    economicsCase: null,
    formatCase: null,
    readinessGate: null,
    recommendation: null,
    ...overrides,
  };
}

function outcomeCases(outcome) {
  const formatCases = authority.formats.map((id, index) => ({
    id,
    disposition: outcome === "build" ? "retain" : index === 0 ? "revise" : "retain",
  }));
  const channelCases = authority.channelCases.map((id) => ({
    id,
    state: id === "etsy"
      ? outcome === "build" ? "recommended" : "conditional_unverified"
      : id === "evidence_supported_lawful_alternative"
        ? outcome === "research_more" || outcome === "revise" || outcome === "reject"
          ? "research_more"
          : "not_selected"
        : id === "retain_cash"
          ? outcome === "no_investment" ? "recommended" : "available"
          : "not_selected",
  }));
  const economicsCases = authority.channelCases.flatMap((channelId) => (
    authority.priceCasesAudCents.map((priceAudCents) => {
      if (channelId === "retain_cash") {
        return {
          channelId,
          priceAudCents,
          state: "known_zero",
          estimatedNetCashContributionAudCents: 0,
          unknownCosts: [],
        };
      }
      if (channelId === "evidence_supported_lawful_alternative" && outcome !== "build") {
        return {
          channelId,
          priceAudCents,
          state: "unknown",
          estimatedNetCashContributionAudCents: null,
          unknownCosts: ["channel_fee_unknown"],
        };
      }
      return {
        channelId,
        priceAudCents,
        state: "estimated",
        estimatedNetCashContributionAudCents: priceAudCents - 500,
        unknownCosts: [],
      };
    })
  ));
  const readinessGates = REQUIRED_READINESS_GATE_IDS.map((id) => ({
    id,
    required: true,
    status: outcome === "build" || outcome === "no_investment" ? "supported" : "unresolved",
  }));
  const gate = (id) => readinessGates.find((item) => item.id === id);
  const materialContradictions = [];
  if (outcome === "revise") {
    gate("buyer_problem").status = "supported";
    gate("offer_value").status = "contradicted";
    materialContradictions.push("The retained offer structure conflicts with the supported buyer problem.");
  }
  if (outcome === "reject") {
    gate("direct_demand").status = "contradicted";
    materialContradictions.push("The retained direct-demand case is structurally contradicted.");
  }
  if (outcome === "no_investment") gate("alternatives").status = "supported";
  return { formatCases, channelCases, economicsCases, readinessGates, materialContradictions };
}

function recommendationFor(outcome, cases) {
  return {
    buyer: "Freelance social-media managers with at least two retained clients",
    channel: outcome === "build"
      ? "Etsy is the provisional non-cash channel in a separate proposal only"
      : "No commercial channel is activated; cash remains retained",
    evidenceStandard: "Immutable public-source records, exact provider receipts, and explicit evidence grades",
    limitations: [
      "Read-only public-web research cannot prove willingness to pay for the exact unbuilt offer.",
    ],
    materialContradictions: cases.materialContradictions,
    nextMoneyMove: outcome === "build"
      ? "Prepare a separate smallest-build proposal for owner review"
      : "Retain cash and resolve only the named decision-critical evidence gap",
    offer: "A no-subscription scope, approval, revision, and closeout evidence kit",
    outcome,
    priceOrMargin: "A$19, A$29, and A$39 remain provisional planning cases",
    problem: "Fragmented approvals, revisions, scope impacts, and delivery evidence",
    reviseOrStopCriteria: [
      "Stop if one bounded evidence action cannot economically change the decision.",
    ],
    summary: outcome === "research_more"
      ? "The bounded pass is complete, but partial grounding leaves a decision-critical evidence gap."
      : `The independent review records a provisional ${outcome} recommendation without granting authority.`,
  };
}

function resealEvidence(record) {
  const body = { ...record };
  delete body.evidenceHash;
  record.evidenceHash = sha256(body);
}

function makeLedger(outcome = "research_more") {
  const assignments = authority.assignments.map((template, index) => ({
    id: template.id,
    version: template.version,
    authorityHash: authority.authorityHash,
    assignmentHash: sha256({ assignment: template.id, index }),
    templateHash: sha256(template),
    workflowId: "workflow_preventure_finalizer_fixture",
    taskId: `task_preventure_finalizer_${index + 1}`,
    activationEventHash: sha256({ activation: true }),
    provider: template.provider,
    model: template.model,
    maxCostAudCents: template.maxCostAudCents,
    maxAttempts: template.maxAttempts,
    maxToolCalls: template.maxToolCalls,
    maximumModelPasses: template.maximumModelPasses,
    maxInputTokens: template.maxInputTokens,
    localPromptPreflightMaxInputTokens: template.localPromptPreflightMaxInputTokens,
    maxOutputTokens: template.maxOutputTokens,
    maxTurns: template.maxTurns,
    worstCaseExposure: clone(template.worstCaseExposure),
    expiresAt: authority.expiresAt,
  }));
  const taskAttempts = [];
  const modelCalls = [];
  const agentRunReceipts = [];
  const costEvents = [];
  const sourceSnapshots = [];
  const sourceSnapshotsByAssignment = [[], [], []];
  const sourceClasses = [
    "public_marketplace_listing_or_result_observation",
    "official_platform_policy_or_pricing",
    "retained_pantheon_evidence",
  ];
  const costStates = ["estimated", "reconciled", "estimated"];
  const costAmounts = [10, 11, 12];

  assignments.forEach((assignment, index) => {
    const attemptId = `attempt_preventure_finalizer_${index + 1}`;
    const modelCallId = `model_call_preventure_finalizer_${index + 1}`;
    const receiptId = `receipt_preventure_finalizer_${index + 1}`;
    const providerRequestId = `req_preventure_finalizer_${index + 1}`;
    const providerResponseId = `resp_preventure_finalizer_${index + 1}`;
    taskAttempts.push({
      id: attemptId,
      taskId: assignment.taskId,
      status: "completed",
      outcomeStatus: "known",
      completed_at: `2026-08-02T13:0${index}:00+10:00`,
    });
    modelCalls.push({
      id: modelCallId,
      taskId: assignment.taskId,
      status: "completed",
      outcomeStatus: "known",
      costStatus: costStates[index],
      providerRequestId,
      metadata: { providerResponseId },
      completed_at: `2026-08-02T13:1${index}:00+10:00`,
    });
    const receiptSnapshot = {
      provider: {
        providerRequestId,
        providerResponseId,
        metadata: { providerResponseId },
      },
    };
    agentRunReceipts.push({
      id: receiptId,
      taskId: assignment.taskId,
      attemptId,
      sequence: 1,
      status: "complete",
      outcomeStatus: "known",
      missingFields: [],
      warnings: [],
      receiptHash: sha256({ receiptId, receiptSnapshot }),
      receipt_hash: sha256({ receiptId, receiptSnapshot }),
      receipt: receiptSnapshot,
      created_at: `2026-08-02T13:2${index}:00+10:00`,
    });
    costEvents.push({
      assignmentHash: assignment.assignmentHash,
      costKey: "openai_assignment_cost",
      sequence: 1,
      eventType: costStates[index],
      amountAudCents: costAmounts[index],
      exposureAudCents: costAmounts[index],
      taskAttemptId: attemptId,
      modelCallId,
      agentRunReceiptId: receiptId,
      budgetReservationId: `reservation_preventure_finalizer_${index + 1}`,
      costId: `cost_preventure_finalizer_${index + 1}`,
      receiptHash: sha256({ assignment: assignment.id, cost: costAmounts[index] }),
      occurredAt: `2026-08-02T13:3${index}:00+10:00`,
    });
    const sourceUrl = index === 0
      ? "https://www.etsy.com/listing/1001/fixture-product"
      : index === 2
        ? null
        : `https://example.com/preventure-finalizer-${index + 1}`;
    const sourceIdentity = sourceUrl
      ? derivePreventureResearchSourceIdentity(sourceUrl)
      : {
          canonicalUrl: null,
          canonicalHost: null,
          sourceIdentityUrl: null,
          sourceIdentityHash: null,
          marketplaceChannelId: null,
          offerIdentityKey: null,
          sellerIdentityKey: null,
          identityDerivation: "retained_pantheon_hash_v1",
        };
    const sourcePublisher = index === 2 ? "Pantheon immutable evidence ledger" : `Fixture publisher ${index + 1}`;
    const publisherIdentityKey = sourceUrl
      ? `public-publisher-host:${sourceIdentity.canonicalHost}`
      : null;
    const sourceBody = {
      authorityHash: authority.authorityHash,
      assignmentHash: assignment.assignmentHash,
      id: `source_preventure_finalizer_${index + 1}`,
      version: "v1",
      sourceClass: sourceClasses[index],
      sourceTier: index === 1 ? 1 : 3,
      captureStatus: "partial",
      url: sourceUrl,
      ...sourceIdentity,
      publisherIdentityKey,
      buyerIndependenceGroup: publisherIdentityKey,
      title: `Partial provider-grounded source ${index + 1}`,
      publisher: sourcePublisher,
      publishedAt: null,
      contentHash: null,
      contentLocation: null,
      researchRunId: `research_run_preventure_finalizer_${index + 1}`,
      sourceRecordId: `research_source_preventure_finalizer_${index + 1}`,
      provenanceId: `provenance_preventure_finalizer_${index + 1}`,
      agentRunReceiptId: receiptId,
      limitations: ["Provider grounding is not an independently captured page snapshot."],
      supersedesSnapshotHash: null,
      retrievedAt: FIXTURE_TIME,
    };
    const sourceSnapshot = { ...sourceBody, snapshotHash: sha256(sourceBody) };
    sourceSnapshots.push(sourceSnapshot);
    sourceSnapshotsByAssignment[index].push(sourceSnapshot);
  });

  for (let index = 1; index < 10; index += 1) {
    const sourceUrl = index === 1
      ? "https://www.etsy.com/listing/1002/fixture-product"
      : `https://fixture${index}.gumroad.com/l/product-${index}`;
    const sourceBody = {
      authorityHash: authority.authorityHash,
      assignmentHash: assignments[0].assignmentHash,
      id: `source_preventure_finalizer_1_${index + 1}`,
      version: "v1",
      sourceClass: "public_marketplace_listing_or_result_observation",
      sourceTier: 3,
      captureStatus: "partial",
      url: sourceUrl,
      ...derivePreventureResearchSourceIdentity(sourceUrl),
      title: `Partial marketplace source ${index + 1}`,
      publisher: `Fixture publisher ${index + 1}`,
      publisherIdentityKey:
        `public-publisher-host:${derivePreventureResearchSourceIdentity(sourceUrl).canonicalHost}`,
      buyerIndependenceGroup:
        `public-publisher-host:${derivePreventureResearchSourceIdentity(sourceUrl).canonicalHost}`,
      publishedAt: null,
      contentHash: null,
      contentLocation: null,
      researchRunId: "research_run_preventure_finalizer_1",
      sourceRecordId: `research_source_preventure_finalizer_1_${index + 1}`,
      provenanceId: `provenance_preventure_finalizer_1_${index + 1}`,
      agentRunReceiptId: "receipt_preventure_finalizer_1",
      limitations: ["Provider grounding is not an independently captured page snapshot."],
      supersedesSnapshotHash: null,
      retrievedAt: FIXTURE_TIME,
    };
    const sourceSnapshot = { ...sourceBody, snapshotHash: sha256(sourceBody) };
    sourceSnapshots.push(sourceSnapshot);
    sourceSnapshotsByAssignment[0].push(sourceSnapshot);
  }

  const evidenceRecords = [];
  let evidenceSequence = 0;
  const addEvidence = (assignmentIndex, input) => {
    evidenceSequence += 1;
    const body = {
      authorityHash: authority.authorityHash,
      assignmentHash: assignments[assignmentIndex].assignmentHash,
      id: input.id,
      version: "v1",
      sourceSnapshotHash: input.sourceSnapshotHash
        || sourceSnapshots[assignmentIndex].snapshotHash,
      truthClass: input.truthClass || "model_inference",
      polarity: input.polarity || "supporting",
      questionId: input.questionId || authority.researchQuestions[0].id,
      criterionId: input.criterionId ?? null,
      claim: input.claim || `Retained fixture evidence ${evidenceSequence}`,
      confidence: input.confidence || "medium",
      limitations: ["The provider-grounded source remains partial evidence."],
      details: input.details || evidenceDetails(),
      supersedesEvidenceHash: null,
      capturedAt: FIXTURE_TIME,
    };
    evidenceRecords.push({ ...body, evidenceHash: sha256(body) });
  };

  const categories = [
    "direct_or_near_direct", "direct_or_near_direct",
    "direct_or_near_direct", "direct_or_near_direct",
    "adjacent", "adjacent", "adjacent",
    "indirect", "indirect", "indirect",
  ];
  for (let index = 0; index < 10; index += 1) {
    const source = sourceSnapshotsByAssignment[0][index];
    const comparator = {
      id: source.offerIdentityKey,
      category: categories[index],
      sellerId: source.sellerIdentityKey,
      channelId: source.marketplaceChannelId,
      formatIds: [authority.formats[index % authority.formats.length]],
      reviewObservationCount: 0,
    };
    addEvidence(0, {
      id: `buyer_problem_${index + 1}`,
      sourceSnapshotHash: source.snapshotHash,
      details: evidenceDetails({ comparator }),
    });
  }
  authority.researchQuestions.forEach((question, index) => addEvidence(0, {
    id: `contrary_${index + 1}`,
    polarity: "contrary",
    questionId: question.id,
    claim: `The explicit disconfirming path for ${question.id} remains retained.`,
  }));

  const cases = outcomeCases(outcome);
  cases.formatCases.forEach((item) => addEvidence(1, {
    id: `format_evidence_${item.id}`,
    criterionId: `format_case:${item.id}`,
    details: evidenceDetails({ formatCase: item }),
  }));
  cases.channelCases.forEach((item) => addEvidence(1, {
    id: `channel_evidence_${item.id}`,
    criterionId: `channel_case:${item.id}`,
    details: evidenceDetails({ channelCase: item }),
  }));
  cases.economicsCases.forEach((item) => addEvidence(1, {
    id: `economics_evidence_${item.channelId}_${item.priceAudCents}`,
    criterionId: `economics_case:${item.channelId}:${item.priceAudCents}`,
    details: evidenceDetails({ economicsCase: item }),
  }));
  cases.readinessGates.forEach((item) => addEvidence(2, {
    id: `readiness_evidence_${item.id}`,
    criterionId: `readiness_gate:${item.id}`,
    details: evidenceDetails({ readinessGate: item }),
  }));
  addEvidence(2, {
    id: "independent_recommendation",
    details: evidenceDetails({ recommendation: recommendationFor(outcome, cases) }),
  });

  return {
    authority,
    lifecycle: [{
      id: "preventure_fixture_activated",
      eventType: "activated",
      occurredAt: "2026-08-02T12:00:00+10:00",
    }],
    assignments,
    costEvents,
    sourceSnapshots,
    evidenceRecords,
    executionEvidence: { taskAttempts, modelCalls, agentRunReceipts },
    decision: null,
  };
}

function latestHeads(records, hashKey, supersedesKey) {
  const superseded = new Set(records.map((record) => record[supersedesKey]).filter(Boolean));
  return records.filter((record) => !superseded.has(record[hashKey]));
}

function decisionCoverage(comparators) {
  const values = [...comparators.values()];
  const sellerCounts = new Map();
  values.forEach((item) => {
    if (item.sellerId === null) return;
    sellerCounts.set(item.sellerId, (sellerCounts.get(item.sellerId) || 0) + 1);
  });
  return {
    directOrNearDirectCount: values.filter(
      (item) => item.category === "direct_or_near_direct",
    ).length,
    adjacentCount: values.filter((item) => item.category === "adjacent").length,
    indirectCount: values.filter((item) => item.category === "indirect").length,
    maximumAcceptedOffersPerSeller: Math.max(0, ...sellerCounts.values()),
    sellerIdentityComplete: values.every((item) => item.sellerId !== null),
    perFormatCounts: Object.fromEntries(authority.formats.map((formatId) => [
      formatId,
      values.filter((item) => item.formatIds.includes(formatId)).length,
    ])),
    observedChannelIds: [...new Set(values.map((item) => item.channelId))].sort(),
    selectionMethodApplied: true,
  };
}

class MemoryStore {
  constructor(ledger) {
    this.ledger = ledger;
    this.state = {
      state: "activated",
      terminal: false,
      expired: false,
      decisionHash: null,
      unknownProviderOutcomeCount: 0,
      unknownCostCount: 0,
    };
  }

  snapshot() {
    return clone({ ledger: this.ledger, state: this.state });
  }

  restore(snapshot) {
    this.ledger = snapshot.ledger;
    this.state = snapshot.state;
  }

  verifyLedger() {
    return { ok: true };
  }

  readLedger(authorityHash) {
    assert.equal(authorityHash, authority.authorityHash);
    return this.ledger;
  }

  readState(authorityHash) {
    assert.equal(authorityHash, authority.authorityHash);
    return this.state;
  }

  recordDecision(authorityHash, decisionInput, completionInput) {
    assert.equal(authorityHash, authority.authorityHash);
    if (this.ledger.decision) {
      const completionEvent = this.ledger.lifecycle.find(
        (event) => event.eventType === "completed",
      );
      return {
        created: false,
        decision: this.ledger.decision,
        completionEvent,
        resultingReadinessHash: preventureResultingReadinessHash(this.ledger.decision),
      };
    }
    const readiness = evaluatePreventureResearchReadiness(this.ledger, this.state, {
      generatedAt: decisionInput.decidedAt,
    });
    const sources = latestHeads(
      this.ledger.sourceSnapshots,
      "snapshotHash",
      "supersedesSnapshotHash",
    );
    const evidence = latestHeads(
      this.ledger.evidenceRecords,
      "evidenceHash",
      "supersedesEvidenceHash",
    );
    const comparators = new Map();
    evidence.forEach((record) => {
      const comparator = record.details?.comparator;
      if (comparator) comparators.set(comparator.id, comparator);
    });
    const contraryEvidence = evidence
      .filter((record) => record.polarity === "contrary")
      .map((record) => ({ id: record.id, status: "retained" }));
    const decision = createPreventureResearchDecision(authority, {
      ...decisionInput,
      comparatorCount: comparators.size,
      estimatedInternalAiCostAudCents: readiness.budget.estimatedInternalAiCostAudCents,
      reconciledInternalAiCostAudCents: readiness.budget.reconciledInternalAiCostAudCents,
      exactBillingPending: readiness.budget.exactBillingPending,
      externalCommercialSpendAudCents: 0,
      provenanceComplete: true,
      unknownProviderOutcomeCount: 0,
      unknownCostCount: 0,
      evidenceSetHash: readiness.evidence.evidenceSetHash,
      receiptSetHash: readiness.evidence.receiptSetHash,
      sourceIds: sources.map((source) => source.id).sort(),
      comparatorIds: [...comparators.keys()].sort(),
      comparatorCoverage: decisionCoverage(comparators),
      contraryEvidence,
      nonOccurrenceRecord: {
        productBuilt: false,
        buyerContact: false,
        accountInspectedOrChanged: false,
        publishing: false,
        advertising: false,
        externalSpendAudCents: 0,
        orders: 0,
        revenueAudCents: 0,
        settledNetCashContribution: "not_settled",
      },
    });
    const completionEvent = {
      ...completionInput,
      eventType: "completed",
      metadata: { decisionHash: decision.decisionHash },
    };
    this.ledger.decision = decision;
    this.ledger.lifecycle.push(completionEvent);
    this.state = {
      ...this.state,
      state: "completed",
      terminal: true,
      decisionHash: decision.decisionHash,
    };
    return {
      created: true,
      decision,
      completionEvent,
      resultingReadinessHash: preventureResultingReadinessHash(decision),
    };
  }

  recordValidatedEarlyStop(authorityHash, stopRecord, decisionInput, completionInput) {
    assert.equal(authorityHash, authority.authorityHash);
    if (this.ledger.decision) {
      const completionEvent = this.ledger.lifecycle.find(
        (event) => event.eventType === "completed",
      );
      return {
        created: false,
        stopRecord: this.ledger.terminalStopRecord,
        skippedAssignments: this.ledger.assignmentSkips,
        decision: this.ledger.decision,
        completionEvent,
        resultingReadinessHash: preventureResultingReadinessHash(this.ledger.decision),
      };
    }
    const sources = latestHeads(
      this.ledger.sourceSnapshots,
      "snapshotHash",
      "supersedesSnapshotHash",
    );
    const evidence = latestHeads(
      this.ledger.evidenceRecords,
      "evidenceHash",
      "supersedesEvidenceHash",
    );
    const comparators = new Map();
    evidence.forEach((record) => {
      const comparator = record.details?.comparator;
      if (comparator) comparators.set(comparator.id, comparator);
    });
    const estimatedInternalAiCostAudCents = this.ledger.costEvents
      .filter((item) => ["estimated", "incurred"].includes(item.eventType))
      .reduce((sum, item) => sum + item.amountAudCents, 0);
    const reconciledInternalAiCostAudCents = this.ledger.costEvents
      .filter((item) => item.eventType === "reconciled")
      .reduce((sum, item) => sum + item.amountAudCents, 0);
    const receiptSetHash = sha256({
      authorityHash,
      executionReceiptSetHash: stopRecord.actualCoverage.executionReceiptSetHash,
      earlyStopRecordHash: stopRecord.earlyStopRecordHash,
      skippedAssignmentRecordHashes: stopRecord.skippedAssignments
        .map((item) => item.skipRecordHash)
        .sort(),
    });
    const decision = createPreventureResearchDecision(authority, {
      ...decisionInput,
      comparatorCount: comparators.size,
      estimatedInternalAiCostAudCents,
      reconciledInternalAiCostAudCents,
      exactBillingPending: this.ledger.costEvents.some(
        (item) => ["estimated", "incurred"].includes(item.eventType),
      ),
      externalCommercialSpendAudCents: 0,
      provenanceComplete: true,
      unknownProviderOutcomeCount: 0,
      unknownCostCount: 0,
      evidenceSetHash: stopRecord.actualCoverage.evidenceSetHash,
      receiptSetHash,
      sourceIds: sources.map((source) => source.id).sort(),
      comparatorIds: [...comparators.keys()].sort(),
      comparatorCoverage: decisionCoverage(comparators),
      contraryEvidence: evidence
        .filter((record) => record.polarity === "contrary")
        .map((record) => ({ id: record.id, status: "retained" }))
        .sort((left, right) => left.id.localeCompare(right.id)),
      nonOccurrenceRecord: {
        productBuilt: false,
        buyerContact: false,
        accountInspectedOrChanged: false,
        publishing: false,
        advertising: false,
        externalSpendAudCents: 0,
        orders: 0,
        revenueAudCents: 0,
        settledNetCashContribution: "not_settled",
      },
    });
    const completionEvent = {
      ...completionInput,
      eventType: "completed",
      metadata: { decisionHash: decision.decisionHash },
    };
    this.ledger.terminalStopRecord = stopRecord;
    this.ledger.assignmentSkips = stopRecord.skippedAssignments;
    this.ledger.decision = decision;
    this.ledger.lifecycle.push(completionEvent);
    this.state = {
      ...this.state,
      state: "completed",
      terminal: true,
      decisionHash: decision.decisionHash,
    };
    return {
      created: true,
      stopRecord,
      skippedAssignments: stopRecord.skippedAssignments,
      decision,
      completionEvent,
      resultingReadinessHash: preventureResultingReadinessHash(decision),
    };
  }
}

class MemoryDb {
  constructor(store) {
    this.store = store;
    this.isTransaction = false;
    this.saved = null;
  }

  exec(statement) {
    if (statement === "BEGIN IMMEDIATE") {
      assert.equal(this.isTransaction, false);
      this.saved = this.store.snapshot();
      this.isTransaction = true;
      return;
    }
    if (statement === "COMMIT") {
      assert.equal(this.isTransaction, true);
      this.saved = null;
      this.isTransaction = false;
      return;
    }
    if (statement === "ROLLBACK") {
      assert.equal(this.isTransaction, true);
      this.store.restore(this.saved);
      this.saved = null;
      this.isTransaction = false;
      return;
    }
    throw new Error(`Unexpected fixture transaction statement: ${statement}`);
  }
}

function fixture(outcome = "research_more") {
  const store = new MemoryStore(makeLedger(outcome));
  const db = new MemoryDb(store);
  const finalizer = createPreventureResearchFinalizer({
    db,
    store,
    authority,
    readinessSpec,
    authorityHash: authority.authorityHash,
    actor: "pantheon",
    authorityRegistry: historicalV1TestRegistry,
    clock: () => FIXTURE_TIME,
  });
  return { db, store, finalizer };
}

function earlyStopFixture() {
  const ledger = makeLedger("research_more");
  const triggerAssignment = ledger.assignments[0];
  const suffixTaskIds = new Set(ledger.assignments.slice(1).map((item) => item.taskId));
  ledger.executionEvidence.taskAttempts = ledger.executionEvidence.taskAttempts.filter(
    (item) => !suffixTaskIds.has(item.taskId),
  );
  ledger.executionEvidence.modelCalls = ledger.executionEvidence.modelCalls.filter(
    (item) => !suffixTaskIds.has(item.taskId),
  );
  ledger.executionEvidence.agentRunReceipts = ledger.executionEvidence.agentRunReceipts.filter(
    (item) => !suffixTaskIds.has(item.taskId),
  );
  ledger.costEvents = ledger.costEvents.filter(
    (item) => item.assignmentHash === triggerAssignment.assignmentHash,
  );
  ledger.sourceSnapshots = ledger.sourceSnapshots.filter(
    (item) => item.assignmentHash === triggerAssignment.assignmentHash,
  );
  ledger.evidenceRecords = ledger.evidenceRecords.filter(
    (item) => item.assignmentHash === triggerAssignment.assignmentHash,
  );
  const partialBuyerRecord = ledger.evidenceRecords.find(
    (item) => item.details?.comparator?.sellerId,
  );
  const partialBuyerSource = ledger.sourceSnapshots.find(
    (item) => item.snapshotHash === partialBuyerRecord.sourceSnapshotHash,
  );
  partialBuyerRecord.details.buyerEvidence = {
    exactWorkflowRelevance: true,
    independenceGroup: partialBuyerSource.buyerIndependenceGroup,
    kind: "purchaser_attributable_behaviour",
    paidOfferId: partialBuyerSource.offerIdentityKey,
    sellerOrPublisherId: partialBuyerSource.sellerIdentityKey,
  };
  resealEvidence(partialBuyerRecord);

  const attempt = ledger.executionEvidence.taskAttempts[0];
  const modelCall = ledger.executionEvidence.modelCalls[0];
  const receipt = ledger.executionEvidence.agentRunReceipts[0];
  const clientRequestId = "pantheon-preventure-finalizer-fixture";
  const clientRequestHash = sha256(clientRequestId);
  const rawOutputArtifactHash = sha256({ fixture: "retained-provider-output" });
  const responseIssuesHash = sha256([]);
  const validatedCoverage = {
    status: "insufficient_evidence",
    gapCodes: [
      "buyer_consequence_insufficient",
      "buyer_evidence_units_insufficient",
      "buyer_independence_insufficient",
      "buyer_workaround_trigger_insufficient",
      "comparator_seller_identity_incomplete",
      "exact_workflow_signals_insufficient",
      "lawful_source_access_exhausted",
      "paid_offer_diversity_insufficient",
      "purchaser_seller_diversity_insufficient",
      "purchaser_signals_insufficient",
    ],
    searchAttemptProof: {
      attempts: [{ id: "preventure_search_attempt_fixture_1" }],
    },
  };
  attempt.metadata = {
    clientRequestId,
    clientRequestHash,
  };
  modelCall.metadata = {
    ...modelCall.metadata,
    clientRequestId,
    clientRequestHash,
    retainedOutputHash: rawOutputArtifactHash,
    responseIssuesHash,
  };
  receipt.receipt.attempt = { metadata: { validatedCoverage } };
  receipt.receipt.provider.metadata = {
    ...receipt.receipt.provider.metadata,
    validatedCoverage,
  };
  receipt.receiptHash = sha256({
    receiptId: receipt.id,
    receiptSnapshot: receipt.receipt,
  }).slice("sha256:".length);
  receipt.receipt_hash = receipt.receiptHash;

  const cost = ledger.costEvents[0];
  const terminalStopInput = {
    triggerAssignmentId: triggerAssignment.id,
    triggerAssignmentHash: triggerAssignment.assignmentHash,
    triggerOutcomeClass: "validated_evidence_shortfall",
    providerEvidence: {
      attemptId: attempt.id,
      modelCallId: modelCall.id,
      agentRunReceiptId: receipt.id,
      effectState: "known_effect",
      officialEndpointHash: null,
      httpStatus: 200,
      providerErrorType: null,
      providerErrorCode: null,
      providerErrorBodyArtifactHash: null,
      providerRequestId: modelCall.providerRequestId,
      providerResponseId: modelCall.metadata.providerResponseId,
      clientRequestHash,
      rawOutputArtifactHash,
      responseIssuesHash,
      costStatus: cost.eventType,
      costAudCents: cost.amountAudCents,
      exposureAudCents: cost.exposureAudCents,
      exactBillingPending: true,
      providerZeroBillingGuarantee: null,
    },
    stoppedAt: FIXTURE_TIME,
  };
  const store = new MemoryStore(ledger);
  const db = new MemoryDb(store);
  const finalizer = createPreventureResearchFinalizer({
    db,
    store,
    authority,
    readinessSpec,
    authorityHash: authority.authorityHash,
    actor: "pantheon",
    terminalStopInput,
    authorityRegistry: historicalV1TestRegistry,
    clock: () => FIXTURE_TIME,
  });
  return { db, store, finalizer, terminalStopInput };
}

function previewAndSeal(subject) {
  const preview = subject.finalizer.preview();
  const result = subject.finalizer({
    expectedEvidenceSetHash: preview.expectedEvidenceSetHash,
    expectedReceiptSetHash: preview.expectedReceiptSetHash,
    expectedResultingReadinessHash: preview.expectedResultingReadinessHash,
  });
  return { preview, result };
}

test("partial public-web diligence seals only a deterministic research_more result", () => {
  const subject = earlyStopFixture();
  const firstPreview = subject.finalizer.preview();
  assert.equal(subject.store.ledger.decision, null);
  const secondPreview = subject.finalizer.preview();
  assert.equal(firstPreview.expectedEvidenceSetHash, secondPreview.expectedEvidenceSetHash);
  assert.equal(firstPreview.expectedReceiptSetHash, secondPreview.expectedReceiptSetHash);
  assert.equal(
    firstPreview.expectedResultingReadinessHash,
    secondPreview.expectedResultingReadinessHash,
  );

  const { result } = previewAndSeal(subject);
  assert.equal(result.decision.outcome, "research_more");
  assert.equal(result.decision.id, `${authority.id}_decision`);
  assert.equal(result.decision.version, `${authority.version}-decision-v1`);
  assert.equal(result.decision.completionMode, "validated_early_stop");
  assert.equal(result.stopRecord.triggerOutcomeClass, "validated_evidence_shortfall");
  assert.equal(result.skippedAssignments.length, 2);
  assert.deepEqual(
    result.stopRecord.actualCoverage.completedAssignmentIds,
    [authority.assignments[0].id],
  );
  assert.equal(
    result.stopRecord.actualCoverage.completedAssignmentReceipts[0].agentRunReceiptId,
    "receipt_preventure_finalizer_1",
  );
  assert.match(
    result.stopRecord.actualCoverage.completedAssignmentReceipts[0].agentRunReceiptHash,
    /^sha256:[a-f0-9]{64}$/,
  );
  for (const skipped of result.skippedAssignments) {
    assert.equal(skipped.dispatchState, "not_dispatched");
    for (const key of [
      "taskAttemptCount",
      "modelCallCount",
      "agentRunReceiptCount",
      "agentRunCount",
      "researchRunCount",
      "toolInvocationCount",
      "budgetReservationCount",
      "costEventCount",
      "costRecordCount",
      "sourceSnapshotCount",
      "evidenceRecordCount",
      "totalAudCostCents",
    ]) assert.equal(skipped[key], 0, `${skipped.assignmentId} ${key}`);
  }
  assert.deepEqual(result.decision.readinessBinding, authority.readinessBinding);
  assert.equal(result.costTruth.estimatedInternalAiCostAudCents, 10);
  assert.equal(result.costTruth.reconciledInternalAiCostAudCents, 0);
  assert.equal(result.costTruth.unknownCostCount, 0);
  assert.equal(result.costTruth.exactBillingPending, true);
  assert.equal("internalAiCostAudCents" in result.costTruth, false);
  assert.equal("internalAiCostAudCents" in result.decision, false);
  assert.equal(result.evidenceSummary.comparatorCount, 10);
  assert.equal(result.evidenceSummary.reviewObservationCount, 0);
  assert.deepEqual(result.evidenceSummary.buyerEvidence, {
    total: 0,
    consequenceCount: 0,
    workaroundOrSpendingTriggerCount: 0,
    purchaserAttributableCount: 0,
    independenceGroupCount: 0,
    paidOfferCount: 0,
    sellerOrPublisherCount: 0,
    exactWorkflowRelevanceCount: 0,
  });
  assert.deepEqual(result.decision.nonOccurrenceRecord, {
    productBuilt: false,
    buyerContact: false,
    accountInspectedOrChanged: false,
    publishing: false,
    advertising: false,
    externalSpendAudCents: 0,
    orders: 0,
    revenueAudCents: 0,
    settledNetCashContribution: "not_settled",
  });
  assert.equal(result.decisionEffect.buildAuthorized, false);
  assert.equal(result.decisionEffect.buyersProven, false);
  assert.equal(result.decisionEffect.revenueProven, false);

  const replay = subject.finalizer({
    expectedEvidenceSetHash: result.expectedEvidenceSetHash,
    expectedReceiptSetHash: result.expectedReceiptSetHash,
    expectedResultingReadinessHash: result.expectedResultingReadinessHash,
  });
  assert.equal(replay.created, false);
  assert.equal(replay.decision.decisionHash, result.decision.decisionHash);
  const described = subject.finalizer.describeFinalization();
  assert.equal(described.ready, false);
  assert.equal(described.completed, true);
  assert.equal(described.code, "preventure_research_finalizer_already_completed");
});

test("partial model classifications cannot self-authorize any terminal commercial outcome", () => {
  for (const outcome of ["build", "revise", "reject", "no_investment"]) {
    const subject = fixture(outcome);
    assert.throws(
      () => subject.finalizer.preview(),
      (error) => error.code === "preventure_research_finalizer_comparator_coverage_incomplete",
      outcome,
    );
    assert.equal(subject.store.ledger.decision, null);
  }
});

test("provider response identity is required and is never substituted with the HTTP request ID", () => {
  {
    const subject = earlyStopFixture();
    const call = subject.store.ledger.executionEvidence.modelCalls[0];
    delete call.metadata.providerResponseId;
    assert.throws(
      () => subject.finalizer.preview(),
      (error) => error.code === "preventure_research_finalizer_terminal_stop_changed",
    );
  }
  {
    const subject = earlyStopFixture();
    const call = subject.store.ledger.executionEvidence.modelCalls[0];
    const receipt = subject.store.ledger.executionEvidence.agentRunReceipts[0];
    call.metadata.providerResponseId = call.providerRequestId;
    receipt.receipt.provider.providerResponseId = call.providerRequestId;
    receipt.receipt.provider.metadata.providerResponseId = call.providerRequestId;
    assert.throws(
      () => subject.finalizer.preview(),
      (error) => error.code === "preventure_research_finalizer_terminal_stop_changed",
    );
  }
  {
    const subject = earlyStopFixture();
    const call = subject.store.ledger.executionEvidence.modelCalls[0];
    const receipt = subject.store.ledger.executionEvidence.agentRunReceipts[0];
    call.providerRequestId = null;
    receipt.receipt.provider.providerRequestId = null;
    subject.terminalStopInput.providerEvidence.providerRequestId = null;
    assert.equal(subject.finalizer.preview().decision.outcome, "research_more");
  }
});

test("unknown, reserved, mismatched, and over-cap cost truth fail closed", () => {
  const cases = [
    ["unknown", (subject) => {
      subject.store.ledger.costEvents[0].eventType = "unknown";
      subject.store.ledger.executionEvidence.modelCalls[0].costStatus = "unknown";
    }],
    ["reserved", (subject) => {
      subject.store.ledger.costEvents[0].eventType = "reserved";
      subject.store.ledger.executionEvidence.modelCalls[0].costStatus = "estimated";
    }],
    ["mismatched", (subject) => {
      subject.store.ledger.costEvents[0].eventType = "reconciled";
    }],
    ["over-cap", (subject) => {
      subject.store.ledger.costEvents[0].amountAudCents = 51;
      subject.store.ledger.costEvents[0].exposureAudCents = 51;
    }],
  ];
  for (const [name, mutate] of cases) {
    const subject = fixture();
    mutate(subject);
    assert.throws(
      () => subject.finalizer.preview(),
      (error) => [
        "preventure_research_finalizer_receipt_incomplete",
        "preventure_research_finalizer_cost_unknown",
        "preventure_research_finalizer_cost_cap_exceeded",
      ].includes(error.code),
      name,
    );
  }
});

test("the exact comparator sample, mix, seller, format, and review cap are enforced", () => {
  const scenarios = [
    ["minimum", (ledger) => {
      ledger.evidenceRecords = ledger.evidenceRecords.filter(
        (record) => record.details?.comparator?.id !== "cmp_10",
      );
    }],
    ["category mix", (ledger) => {
      ledger.evidenceRecords.filter((record) => record.details?.comparator).forEach((record) => {
        record.details.comparator.category = "direct_or_near_direct";
        resealEvidence(record);
      });
    }],
    ["seller maximum", (ledger) => {
      ledger.evidenceRecords.filter((record) => record.details?.comparator).slice(0, 3)
        .forEach((record) => {
          record.details.comparator.sellerId = "same_seller";
          resealEvidence(record);
        });
    }],
    ["format minimum", (ledger) => {
      ledger.evidenceRecords.filter((record) => record.details?.comparator).forEach((record) => {
        record.details.comparator.formatIds = [authority.formats[0]];
        resealEvidence(record);
      });
    }],
    ["review maximum", (ledger) => {
      const record = ledger.evidenceRecords.find((item) => item.details?.comparator);
      record.details.comparator.reviewObservationCount = 31;
      resealEvidence(record);
    }],
  ];
  for (const [name, mutate] of scenarios) {
    const subject = fixture();
    mutate(subject.store.ledger);
    assert.throws(
      () => subject.finalizer.preview(),
      (error) => [
        "preventure_research_finalizer_comparator_invalid",
        "preventure_research_finalizer_comparator_coverage_incomplete",
      ].includes(error.code),
      name,
    );
  }
});

test("web-search-only full-round evidence cannot invent Etsy seller identity", () => {
  const subject = fixture();
  assert.throws(
    () => subject.finalizer.preview(),
    (error) => error.code === "preventure_research_finalizer_comparator_coverage_incomplete"
      && error.details?.unknownSellerIdentityCount === 2
      && error.details?.sellerIdentityComplete === false,
  );
});

test("partial model buyer classification remains zero-grade commercial evidence", () => {
  const subject = earlyStopFixture();
  const partialBuyer = subject.store.ledger.evidenceRecords.find(
    (item) => item.details?.buyerEvidence,
  );
  assert.equal(partialBuyer.truthClass, "model_inference");
  const { result } = previewAndSeal(subject);
  assert.deepEqual(result.evidenceSummary.buyerEvidence, {
    total: 0,
    consequenceCount: 0,
    workaroundOrSpendingTriggerCount: 0,
    purchaserAttributableCount: 0,
    independenceGroupCount: 0,
    paidOfferCount: 0,
    sellerOrPublisherCount: 0,
    exactWorkflowRelevanceCount: 0,
  });
  assert.equal(result.decisionEffect.buyersProven, false);
  assert.equal(result.decisionEffect.revenueProven, false);
});

test("an expected readiness-hash mismatch rolls the entire decision back", () => {
  const subject = earlyStopFixture();
  const preview = subject.finalizer.preview();
  assert.throws(
    () => subject.finalizer({
      expectedEvidenceSetHash: preview.expectedEvidenceSetHash,
      expectedReceiptSetHash: preview.expectedReceiptSetHash,
      expectedResultingReadinessHash: `sha256:${"f".repeat(64)}`,
    }),
    (error) => error.code === "preventure_research_finalizer_readiness_hash_changed",
  );
  assert.equal(subject.store.ledger.decision, null);
  assert.equal(subject.store.state.state, "activated");
});

test("the finalizer is bound to the exact approved authority and starting readiness", () => {
  const subject = fixture();
  assert.throws(
    () => subject.finalizer.preview({ authorityHash: `sha256:${"0".repeat(64)}` }),
    (error) => error.code === "preventure_research_authority_unknown",
  );
});
