"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const authority = require("../../config/preventure-research-authority-smm-scope-guard-v1");
const readinessSpec = require("../../config/commercial-readiness-social-media-manager-scope-guard-v1");
const { openDatabase } = require("../../src/db");
const {
  bindModelCallToAttempt,
  finalizeAgentExecutionReceipt,
} = require("../../src/runtime/agent-execution-evidence");
const {
  createAgentRun,
  ensureAiTeam,
  finishAgentRun,
} = require("../../src/runtime/ai-team");
const { sha256 } = require("../../src/runtime/commercial-test-contract");
const {
  REQUIRED_READINESS_GATE_IDS,
} = require("../../src/runtime/preventure-research-contract");
const {
  createPreventureLifecycleApproval,
  decidePreventureLifecycleApproval,
} = require("../../src/runtime/preventure-research-lifecycle-decision");
const {
  materializePreventureResearchAssignments,
} = require("../../src/runtime/preventure-research-materializer");
const {
  createPreventureResearchStore,
  evidenceSetHash,
  receiptSetHash,
} = require("../../src/runtime/preventure-research-store");
const {
  EVIDENCE_GAP_PRIORITY,
  createPreventureResearchTerminalStop,
} = require("../../src/runtime/preventure-research-terminal-stop");
const {
  derivePreventureResearchPublicSourceBinding,
} = require("../../src/runtime/preventure-research-source-identity");
const {
  historicalV1TestRegistry,
} = require("./preventure-research-test-registry");
const {
  issueAuthenticatedOwnerSessionAttestationForTest,
} = require("./authenticated-owner-session-attestation");

const STORE_TIME = "2026-08-02T14:00:00.000+10:00";
const ASSIGNED_AT = "2026-08-02T12:04:00.000+10:00";
const STOPPED_AT = "2026-08-02T13:30:00.000+10:00";
const ALL_GAP_CODES = [...EVIDENCE_GAP_PRIORITY].sort();

function historicalStoreOptions(clock = () => STORE_TIME, overrides = {}) {
  return {
    ...overrides,
    clock,
    authorityRegistry: historicalV1TestRegistry,
  };
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

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function canonicalReceiptHash(value) {
  return String(value).startsWith("sha256:") ? String(value) : `sha256:${value}`;
}

function tempRuntime(options = {}) {
  const clock = options.clock || (() => STORE_TIME);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pantheon-preventure-early-stop-"));
  const dbPath = path.join(dir, "runtime.sqlite");
  const db = openDatabase(dbPath, { clock });
  return {
    dir,
    dbPath,
    db,
    close() {
      try { db.close(); } catch {}
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

function activate(store, db, options = {}) {
  const storeOptions = historicalStoreOptions(
    options.clock || (() => STORE_TIME),
    options.storeOptions,
  );
  store.registerAuthority(authority, readinessSpec);
  store.appendLifecycle(authority.authorityHash, {
    id: "preventure_early_stop_proposed",
    eventType: "proposed",
    occurredAt: "2026-08-02T12:00:30.000+10:00",
    actor: "jarvis",
    reason: "Bounded diligence proposed for terminal-stop database proof.",
    metadata: {},
  });
  const accepted = createPreventureLifecycleApproval(
    db,
    authority.authorityHash,
    "accepted",
    {
      approvalId: "approval_preventure_early_stop_accept",
      requestedAt: "2026-08-02T12:01:00.000+10:00",
      storeOptions,
    },
  );
  const acceptanceNote = "Owner accepted the exact bounded preparation scope.";
  decidePreventureLifecycleApproval(
    db,
    accepted.approval.id,
    "approve",
    acceptanceNote,
    {
      actor: "owner",
      expectedScopeHash: accepted.scopeHash,
      decidedAt: "2026-08-02T12:02:00.000+10:00",
      ownerSessionAttestation: issueAuthenticatedOwnerSessionAttestationForTest({
        db,
        approvalId: accepted.approval.id,
        decidedAt: "2026-08-02T12:02:00.000+10:00",
        decision: "approve",
        note: acceptanceNote,
        expectedScopeHash: accepted.scopeHash,
      }),
      storeOptions,
    },
  );
  const activated = createPreventureLifecycleApproval(
    db,
    authority.authorityHash,
    "activated",
    {
      approvalId: "approval_preventure_early_stop_activate",
      requestedAt: "2026-08-02T12:02:30.000+10:00",
      storeOptions,
    },
  );
  const activationNote = "Owner activated the exact bounded preparation scope.";
  decidePreventureLifecycleApproval(
    db,
    activated.approval.id,
    "approve",
    activationNote,
    {
      actor: "owner",
      expectedScopeHash: activated.scopeHash,
      decidedAt: "2026-08-02T12:03:00.000+10:00",
      ownerSessionAttestation: issueAuthenticatedOwnerSessionAttestationForTest({
        db,
        approvalId: activated.approval.id,
        decidedAt: "2026-08-02T12:03:00.000+10:00",
        decision: "approve",
        note: activationNote,
        expectedScopeHash: activated.scopeHash,
      }),
      storeOptions,
    },
  );
}

function prepareFixture(db, options = {}) {
  const clock = options.clock || (() => STORE_TIME);
  const store = createPreventureResearchStore(
    db,
    historicalStoreOptions(clock, options.storeOptions),
  );
  activate(store, db, { clock, storeOptions: options.storeOptions });
  const materialized = materializePreventureResearchAssignments(
    store,
    authority.authorityHash,
    {
      db,
      expectedAuthorityHash: authority.authorityHash,
      assignedAt: ASSIGNED_AT,
      clock,
    },
  );
  const byId = new Map(materialized.assignments.map((item) => [item.id, item]));
  const assignments = authority.assignments.map((item) => byId.get(item.id));
  assert.ok(assignments.every(Boolean));
  return { db, store, assignments };
}

function fixture(options = {}) {
  const clock = options.clock || (() => STORE_TIME);
  const runtime = tempRuntime({ clock });
  return {
    ...runtime,
    ...prepareFixture(runtime.db, { clock, storeOptions: options.storeOptions }),
  };
}

function emptyComparatorCoverage() {
  return {
    comparatorCount: 0,
    directOrNearDirectCount: 0,
    adjacentCount: 0,
    indirectCount: 0,
    maximumAcceptedOffersPerSeller: 0,
    unknownSellerIdentityCount: 0,
    sellerIdentityComplete: true,
    reviewObservationCount: 0,
    perFormatCounts: Object.fromEntries(authority.formats.map((id) => [id, 0])),
    observedChannelIds: [],
    complete: false,
  };
}

function emptyBuyerEvidenceCoverage() {
  return {
    total: 0,
    consequenceCount: 0,
    workaroundOrSpendingTriggerCount: 0,
    purchaserAttributableCount: 0,
    independenceGroupCount: 0,
    paidOfferCount: 0,
    sellerOrPublisherCount: 0,
    exactWorkflowRelevanceCount: 0,
  };
}

function validatedCoverage(index) {
  return {
    status: "insufficient_evidence",
    gapCodes: ALL_GAP_CODES,
    searchAttemptProof: {
      attempts: [{ id: `search_attempt_early_stop_${index + 1}` }],
    },
  };
}

function insertPartialResearchSource(db, assignment, runId, attemptId, modelCallId, index) {
  const suffix = String(index + 1);
  const researchRunId = `research_run_early_stop_${suffix}`;
  const sourceRecordId = `research_source_early_stop_${suffix}`;
  const provenanceId = `provenance_early_stop_${suffix}`;
  const url = `https://www.etsy.com/listing/${7100 + index}/scope-control-kit-${suffix}?ref=backup-proof`;
  const title = `Retained public marketplace source ${suffix}`;
  const publisher = "Etsy";
  const retrievedAt = `2026-08-02T12:${10 + index}:45.000+10:00`;
  const contentHash = sha256({ fixture: "early-stop-source", index });
  const contentLocation = `preventure-output:${sha256({ fixture: "early-stop-source-location", index }).slice(7)}`;
  const limitations = [
    "Provider grounding is partial and does not independently capture the marketplace page.",
  ];
  const identity = derivePreventureResearchPublicSourceBinding(url);
  db.prepare(
    `INSERT INTO research_runs
     (id, workflow_id, task_id, venture_id, query, provider, mode, status,
      budget_cents, actual_cents, summary, metadata, created_at, completed_at)
     VALUES (?, ?, ?, NULL, ?, ?, 'live', 'completed', ?, 0, ?, ?, ?, ?)`,
  ).run(
    researchRunId,
    assignment.workflowId,
    assignment.taskId,
    `Exact bounded source check for ${assignment.id}`,
    assignment.provider,
    assignment.maxCostAudCents,
    `One partial public-source record retained for ${assignment.id}.`,
    JSON.stringify({ attemptId, modelCallId }),
    `2026-08-02T12:${10 + index}:30.000+10:00`,
    `2026-08-02T12:${11 + index}:00.000+10:00`,
  );
  db.prepare(
    `INSERT INTO research_sources
     (id, run_id, title, url, publisher, published_at, retrieved_at,
      relevance, confidence, metadata)
     VALUES (?, ?, ?, ?, ?, NULL, ?, ?, 'provider_grounded', ?)`,
  ).run(
    sourceRecordId,
    researchRunId,
    title,
    url,
    publisher,
    retrievedAt,
    "Partial public grounding retained only as evidence of an unresolved search result.",
    JSON.stringify({
      providerGrounded: true,
      directArtifactCaptured: false,
      contentHash,
      contentLocation,
      limitations,
      ...identity,
    }),
  );
  db.prepare(
    `INSERT INTO agent_run_provenance
     (id, fingerprint, run_id, attempt_id, task_id, model_call_id,
      research_run_id, research_source_id, kind, title, url, grounding_type,
      output_hash, metadata, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'web_source', ?, ?,
             'web_search_action_source', ?, '{}', ?)`,
  ).run(
    provenanceId,
    sha256({ assignmentHash: assignment.assignmentHash, sourceRecordId }),
    runId,
    attemptId,
    assignment.taskId,
    modelCallId,
    researchRunId,
    sourceRecordId,
    title,
    url,
    contentHash,
    retrievedAt,
  );
  return {
    researchRunId,
    sourceRecordId,
    provenanceId,
    url,
    title,
    publisher,
    retrievedAt,
    contentHash,
    contentLocation,
    limitations,
  };
}

function recordPartialResearchEvidence(store, assignment, receiptId, retained, index) {
  if (!retained) return null;
  const sourceSnapshot = store.recordSourceSnapshot(assignment.assignmentHash, {
    id: `source_early_stop_${index + 1}`,
    version: "v1",
    sourceClass: authority.assignments[index].requiredSourceClasses[0],
    sourceTier: 1,
    captureStatus: "partial",
    url: retained.url,
    title: retained.title,
    publisher: retained.publisher,
    contentHash: retained.contentHash,
    contentLocation: retained.contentLocation,
    researchRunId: retained.researchRunId,
    sourceRecordId: retained.sourceRecordId,
    provenanceId: retained.provenanceId,
    agentRunReceiptId: receiptId,
    limitations: retained.limitations,
    retrievedAt: retained.retrievedAt,
  }).sourceSnapshot;
  const evidence = store.recordEvidence(assignment.assignmentHash, {
    id: `evidence_early_stop_${index + 1}`,
    version: "v1",
    sourceSnapshotHash: sourceSnapshot.snapshotHash,
    truthClass: "model_inference",
    polarity: "neutral",
    questionId: authority.researchQuestions[0].id,
    criterionId: null,
    claim: "The partial public result is insufficient to prove buyer demand or a commercial decision.",
    confidence: "low",
    limitations: retained.limitations,
    details: {
      buyerEvidence: null,
      channelCase: null,
      comparator: null,
      economicsCase: null,
      formatCase: null,
      readinessGate: null,
      recommendation: null,
    },
    capturedAt: `2026-08-02T12:${12 + index}:00.000+10:00`,
  }).evidence;
  return { sourceSnapshot, evidence };
}

function insertKnownCompletedExecution(
  db,
  store,
  assignment,
  index,
  terminal = false,
  costOptions = {},
  evidenceOptions = {},
) {
  ensureAiTeam(db);
  const suffix = String(index + 1);
  const costEventType = costOptions.eventType || "reconciled";
  const costAmountAudCents = costOptions.amountAudCents ?? 0;
  const costExposureAudCents = costOptions.exposureAudCents ?? costAmountAudCents;
  const genericCostStatus = costEventType === "reconciled"
    ? "reconciled"
    : "incurred_estimate";
  const reservationStatus = costEventType === "reconciled"
    ? "reconciled"
    : "incurred_estimate";
  const attemptId = `attempt_early_stop_${suffix}`;
  const modelCallId = `model_call_early_stop_${suffix}`;
  const providerRequestId = `request_early_stop_${suffix}`;
  const providerResponseId = `resp_early_stop_${suffix}`;
  const clientRequestId = `client_early_stop_${suffix}`;
  const retainedOutputHash = sha256({ fixture: "early-stop-output", index });
  const responseIssuesHash = sha256([]);
  const coverage = terminal ? validatedCoverage(index) : null;
  const metadata = {
    providerResponseId,
    clientRequestId,
    retainedOutputHash,
    responseIssuesHash,
    validatedCoverage: coverage,
    tokenUsage: {
      status: "reported",
      inputTokens: 100,
      outputTokens: 50,
      totalTokens: 150,
    },
  };
  db.prepare(
    `INSERT INTO task_attempts
     (id, task_id, workflow_id, claim_token, status, outcome_status,
      started_at, metadata)
     VALUES (?, ?, ?, ?, 'running', 'not_started', ?, ?)`,
  ).run(
    attemptId,
    assignment.taskId,
    assignment.workflowId,
    `claim_early_stop_${suffix}`,
    `2026-08-02T12:${10 + index}:00.000+10:00`,
    JSON.stringify({ clientRequestId, validatedCoverage: coverage }),
  );
  const definition = db.prepare(
    "SELECT * FROM agent_definitions WHERE id = 'demand_validator'",
  ).get();
  const taskRow = db.prepare("SELECT * FROM tasks WHERE id = ?").get(assignment.taskId);
  const run = createAgentRun(db, definition, taskRow, {
    attemptId,
    mode: "preventure-research",
    inputSummary: `Exact early-stop fixture ${assignment.id}`,
  });
  db.prepare(
    `INSERT INTO model_calls
     (id, workflow_id, task_id, venture_id, provider, model_class, selected_model,
     mode, status, input_tokens, output_tokens, estimated_cost_cents,
      actual_cost_cents, approval_required, metadata, created_at,
      provider_request_id, cost_status, incurred_estimate_cents,
      reconciled_cost_cents, outcome_status, completed_at)
     VALUES (?, ?, ?, NULL, ?, 'flagship', ?, 'live', 'completed',
             100, 50, ?, ?, 0, ?, ?, ?, ?, ?, ?, 'known', ?)`,
  ).run(
    modelCallId,
    assignment.workflowId,
    assignment.taskId,
    assignment.provider,
    assignment.model,
    costAmountAudCents,
    costEventType === "reconciled" ? costAmountAudCents : 0,
    JSON.stringify(metadata),
    `2026-08-02T12:${10 + index}:15.000+10:00`,
    providerRequestId,
    costEventType,
    costAmountAudCents,
    costEventType === "reconciled" ? costAmountAudCents : 0,
    `2026-08-02T12:${11 + index}:00.000+10:00`,
  );
  bindModelCallToAttempt(db, attemptId, modelCallId);
  const retainedSource = evidenceOptions.enabled === true
    ? insertPartialResearchSource(db, assignment, run.id, attemptId, modelCallId, index)
    : null;
  db.prepare(
    `UPDATE task_attempts
     SET status = 'completed', outcome_status = 'known', provider_request_id = ?,
         provider_dispatched_at = ?, provider_dispatch_model_call_id = ?, completed_at = ?
     WHERE id = ?`,
  ).run(
    providerRequestId,
    `2026-08-02T12:${10 + index}:15.000+10:00`,
    modelCallId,
    `2026-08-02T12:${11 + index}:00.000+10:00`,
    attemptId,
  );
  const result = {
    providerRequestId,
    providerResponseId,
    clientRequestId,
    retainedOutputHash,
    rawOutputArtifactHash: retainedOutputHash,
    responseIssuesHash,
    validatedCoverage: coverage,
  };
  db.prepare(
    `UPDATE tasks
     SET status = 'completed', outcome_status = 'known', result = ?,
         completed_at = ?, updated_at = ?
     WHERE id = ?`,
  ).run(
    JSON.stringify(result),
    `2026-08-02T12:${11 + index}:00.000+10:00`,
    `2026-08-02T12:${11 + index}:00.000+10:00`,
    assignment.taskId,
  );
  finishAgentRun(db, run.id, {
    status: "completed",
    outputSummary: `Known completed fixture ${assignment.id}`,
    modelCallId,
    estimatedCostCents: costAmountAudCents,
    actualCostCents: costEventType === "reconciled" ? costAmountAudCents : 0,
    evalStatus: "passed",
    metadata: { assignmentHash: assignment.assignmentHash },
  });
  db.prepare(
    `INSERT INTO agent_eval_results
     (id, run_id, agent_id, task_id, attempt_id, status, score,
      criteria, findings, metadata, evaluator_version, subject_hash, created_at)
     VALUES (?, ?, 'demand_validator', ?, ?, 'passed', 100,
             '[]', '[]', '{}', 'preventure-early-stop-test-v1', ?, ?)`,
  ).run(
    `agent_eval_early_stop_${suffix}`,
    run.id,
    assignment.taskId,
    attemptId,
    sha256({ assignmentHash: assignment.assignmentHash, attemptId }),
    `2026-08-02T12:${11 + index}:15.000+10:00`,
  );
  const reservationId = `reservation_early_stop_${suffix}`;
  const costId = `generic_cost_early_stop_${suffix}`;
  db.prepare(
    `INSERT INTO budget_reservations
     (id, venture_id, workflow_id, task_id, approval_id, status,
      amount_cents, currency, reserved_at, resolved_at, metadata)
     VALUES (?, NULL, ?, ?, NULL, ?, ?, 'AUD', ?, ?, '{}')`,
  ).run(
    reservationId,
    assignment.workflowId,
    assignment.taskId,
    reservationStatus,
    costExposureAudCents,
    `2026-08-02T12:${10 + index}:00.000+10:00`,
    `2026-08-02T12:${11 + index}:20.000+10:00`,
  );
  db.prepare(
    `INSERT INTO costs
     (id, workflow_id, venture_id, run_id, task_id, model_call_id,
      category, source, status, amount_cents, currency, occurred_at, metadata)
     VALUES (?, ?, NULL, ?, ?, ?, 'preventure_research', 'openai',
             ?, ?, 'AUD', ?, '{}')`,
  ).run(
    costId,
    assignment.workflowId,
    run.id,
    assignment.taskId,
    modelCallId,
    genericCostStatus,
    costAmountAudCents,
    `2026-08-02T12:${11 + index}:20.000+10:00`,
  );
  const receipt = finalizeAgentExecutionReceipt(db, { attemptId, runId: run.id });
  assert.equal(receipt.status, "complete");
  store.appendCostEvent(assignment.assignmentHash, {
    eventType: costEventType,
    amountAudCents: costAmountAudCents,
    exposureAudCents: costExposureAudCents,
    costKey: `openai_early_stop_${suffix}`,
    taskAttemptId: attemptId,
    modelCallId,
    budgetReservationId: reservationId,
    costId,
    agentRunReceiptId: receipt.id,
    occurredAt: `2026-08-02T12:${11 + index}:30.000+10:00`,
  });
  const retainedEvidence = recordPartialResearchEvidence(
    store,
    assignment,
    receipt.id,
    retainedSource,
    index,
  );
  return {
    attemptId,
    modelCallId,
    agentRunReceiptId: receipt.id,
    agentRunReceiptHash: canonicalReceiptHash(receipt.receipt_hash),
    providerRequestId,
    providerResponseId,
    clientRequestId,
    retainedOutputHash,
    responseIssuesHash,
    coverage,
    costEventType,
    costAmountAudCents,
    costExposureAudCents,
    costKey: `openai_early_stop_${suffix}`,
    budgetReservationId: reservationId,
    costId,
    selectedModel: assignment.model,
    retainedEvidence,
  };
}

function buildStop(fx, triggerIndex, options = {}) {
  const executions = [];
  for (let index = 0; index <= triggerIndex; index += 1) {
    executions.push(insertKnownCompletedExecution(
      fx.db,
      fx.store,
      fx.assignments[index],
      index,
      index === triggerIndex,
      options.cost || {},
      { enabled: options.retainedEvidence === true && index === 0 },
    ));
  }
  const ledger = fx.store.readLedger(authority.authorityHash);
  const triggerAssignment = fx.assignments[triggerIndex];
  const trigger = executions[triggerIndex];
  const completed = fx.assignments.slice(0, triggerIndex + 1);
  const receiptsByTaskId = new Map(
    ledger.executionEvidence.agentRunReceipts.map((item) => [item.task_id, item]),
  );
  const stopRecord = createPreventureResearchTerminalStop({
    authority,
    assignments: fx.assignments,
    triggerAssignment,
    triggerOutcomeClass: "validated_evidence_shortfall",
    providerEvidence: {
      attemptId: trigger.attemptId,
      modelCallId: trigger.modelCallId,
      agentRunReceiptId: trigger.agentRunReceiptId,
      effectState: "known_effect",
      officialEndpointHash: null,
      httpStatus: 200,
      providerErrorType: null,
      providerErrorCode: null,
      providerErrorBodyArtifactHash: null,
      providerRequestId: trigger.providerRequestId,
      providerResponseId: trigger.providerResponseId,
      clientRequestHash: sha256(trigger.clientRequestId),
      rawOutputArtifactHash: trigger.retainedOutputHash,
      responseIssuesHash: trigger.responseIssuesHash,
      costStatus: trigger.costEventType,
      costAudCents: trigger.costAmountAudCents,
      exposureAudCents: trigger.costExposureAudCents,
      exactBillingPending: ["estimated", "incurred"].includes(trigger.costEventType),
      providerZeroBillingGuarantee: null,
    },
    actualCoverage: {
      sourceSnapshotHashes: ledger.sourceSnapshots
        .map((item) => item.snapshotHash)
        .sort(),
      evidenceHashes: ledger.evidenceRecords
        .map((item) => item.evidenceHash)
        .sort(),
      comparatorIds: [...new Set(ledger.evidenceRecords
        .map((item) => item.details?.comparator?.id)
        .filter(Boolean))].sort(),
      comparatorCoverage: emptyComparatorCoverage(),
      buyerEvidenceCoverage: emptyBuyerEvidenceCoverage(),
      sourceAttemptRefs: trigger.coverage.searchAttemptProof.attempts
        .map((item) => item.id)
        .sort(),
      evidenceSetHash: evidenceSetHash(
        authority.authorityHash,
        ledger.evidenceRecords,
        ledger.sourceSnapshots,
      ),
      executionReceiptSetHash: receiptSetHash(
        authority.authorityHash,
        ledger,
        { cutoff: STOPPED_AT },
      ),
      completedAssignmentIds: completed.map((item) => item.id).sort(),
      completedAssignmentReceipts: completed.map((assignment) => {
        const row = receiptsByTaskId.get(assignment.taskId);
        return {
          assignmentId: assignment.id,
          assignmentHash: assignment.assignmentHash,
          agentRunReceiptId: row.id,
          agentRunReceiptHash: canonicalReceiptHash(row.receipt_hash),
        };
      }).sort((left, right) => left.assignmentId.localeCompare(right.assignmentId)),
      retainedContradictionEvidenceIds: ledger.evidenceRecords
        .filter((item) => item.polarity === "contrary")
        .map((item) => item.id)
        .sort(),
      retainedCaseCriterionIds: [...new Set(ledger.evidenceRecords
        .map((item) => item.criterionId)
        .filter(Boolean))].sort(),
    },
    gapCodes: ALL_GAP_CODES,
    stoppedAt: STOPPED_AT,
  });
  return { stopRecord, executions };
}

function deriveDecisionInputs(_fx, stopRecord) {
  return {
    authorityHash: authority.authorityHash,
    stopRecord,
    decisionInput: {
      id: `${authority.id}_decision`,
      version: `${authority.version}-decision-v1`,
      outcome: "research_more",
      completionMode: "validated_early_stop",
      earlyStopRecordHash: stopRecord.earlyStopRecordHash,
      skippedAssignmentRecordHashes: stopRecord.skippedAssignments
        .map((item) => item.skipRecordHash)
        .sort(),
      nextEvidenceAction: stopRecord.nextEvidenceAction,
      decidedAt: stopRecord.stoppedAt,
      summary: "The bounded diligence round ended at a validated evidence shortfall and cannot support a commercial decision.",
      buyer: authority.opportunity.buyer,
      problem: authority.opportunity.problem,
      offer: authority.opportunity.offer,
      channel: "No commercial channel is selected or activated.",
      priceOrMargin: "A$19, A$29, and A$39 remain unverified planning hypotheses.",
      evidenceStandard: "Only immutable prior evidence and the exact validated stop proof are retained; no missing commercial fact is inferred.",
      nextMoneyMove: stopRecord.nextEvidenceAction.action,
      reviseOrStopCriteria: [
        "Proceed only if a separately approved bounded evidence action can economically resolve the named decision gap.",
      ],
      formatCases: [],
      channelCases: [],
      economicsCases: [],
      materialContradictions: [],
      readinessGates: REQUIRED_READINESS_GATE_IDS.map((id) => ({
        id,
        required: true,
        status: "unresolved",
      })),
      limitations: [
        "The validated stop permits no commercial inference from the triggering response or technical failure.",
        `The bounded round stopped under ${stopRecord.reasonCode}; the named evidence gap remains unresolved.`,
      ],
    },
    completionInput: {
      id: `${authority.id}_completed`,
      occurredAt: stopRecord.stoppedAt,
      actor: "pantheon",
      reason: "The deterministic bounded diligence decision and superseding readiness result were sealed from the verified immutable ledger.",
    },
  };
}

function sealPopulatedEarlyStopRound(db, options = {}) {
  const clock = options.clock || (() => STORE_TIME);
  const prepared = prepareFixture(db, { clock });
  const { stopRecord, executions } = buildStop(prepared, 0, {
    retainedEvidence: true,
    cost: {
      eventType: "reconciled",
      amountAudCents: 17,
      exposureAudCents: 17,
      ...(options.cost || {}),
    },
  });
  const inputs = deriveDecisionInputs(prepared, stopRecord);
  const recorded = prepared.store.recordValidatedEarlyStop(
    authority.authorityHash,
    stopRecord,
    inputs.decisionInput,
    inputs.completionInput,
  );
  return {
    ...prepared,
    stopRecord,
    executions,
    recorded,
    ledger: prepared.store.readLedger(authority.authorityHash),
  };
}

function rowCount(db, table, where = "", params = []) {
  return Number(db.prepare(
    `SELECT COUNT(*) AS count FROM ${table}${where ? ` WHERE ${where}` : ""}`,
  ).get(...params).count);
}


module.exports = Object.freeze({
  STORE_TIME,
  STOPPED_AT,
  authority,
  buildStop,
  canonicalJson,
  clone,
  deriveDecisionInputs,
  fixture,
  historicalStoreOptions,
  insertKnownCompletedExecution,
  prepareFixture,
  rowCount,
  sealPopulatedEarlyStopRound,
});
