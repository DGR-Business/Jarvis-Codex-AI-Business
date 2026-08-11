"use strict";

const { sha256 } = require("./commercial-test-contract");
const {
  effectivePreventureLifecycleState,
  preventureResearchApprovalScope,
  preventureResearchApprovalScopeHash,
} = require("./preventure-research-contract");
const {
  evaluatePreventureResearchReadiness,
} = require("./preventure-research-readiness");
const {
  defaultPreventureResearchAuthorityRegistry,
} = require("./preventure-research-authority-registry");

const OWNER_PREVENTURE_RESEARCH_SCHEMA =
  "pantheon.owner-preventure-research.v1";
const RESULTING_READINESS_SCHEMA =
  "pantheon.preventure-research-resulting-readiness.v1";
const TERMINAL_STATES = new Set([
  "completed",
  "expired",
  "revised",
  "revoked",
  "superseded",
]);
const KNOWN_STATES = new Set([
  "proposed",
  "accepted",
  "activated",
  ...TERMINAL_STATES,
]);

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseJsonValue(value) {
  if (value && typeof value === "object") return value;
  if (typeof value !== "string") return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function timestamp(clock) {
  const value = typeof clock === "function" ? clock() : new Date();
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("The owner-state clock is invalid.");
  return date.toISOString();
}

function baseState(generatedAt) {
  return {
    schema: OWNER_PREVENTURE_RESEARCH_SCHEMA,
    generatedAt,
    readOnly: true,
    integrity: {
      status: "ok",
      authorityStatus: "inactive",
      message: "No pre-venture research authority is recorded.",
    },
    controls: { allowed: [] },
    current: null,
    history: { total: 0, items: [] },
    businessTruth: {
      productBuilt: false,
      buyerContact: false,
      accountInspectedOrChanged: false,
      publication: false,
      advertising: false,
      externalSpendAudCents: 0,
      orders: 0,
      revenueAudCents: 0,
      commercialValidationOccurred: false,
      settledNetCashContribution: "not_settled",
    },
  };
}

function attentionState(generatedAt, authorityStatus, message, history = []) {
  const result = baseState(generatedAt);
  result.integrity = { status: "attention", authorityStatus, message };
  result.history = { total: history.length, items: history };
  return result;
}

function lifecycleProjection(events, state) {
  const dates = new Map();
  for (const event of events) dates.set(event.eventType, event.occurredAt);
  const labels = {
    proposed: "Awaiting owner acceptance",
    accepted: "Accepted; awaiting separate activation",
    activated: "Activated; internal diligence authorised",
    completed: "Diligence complete",
    revoked: "Stopped by owner",
    expired: "Expired",
    revised: "Returned for revision",
    superseded: "Superseded",
  };
  return {
    status: state,
    label: labels[state] || "Integrity attention required",
    proposedAt: dates.get("proposed") || null,
    acceptedAt: dates.get("accepted") || null,
    activatedAt: dates.get("activated") || null,
    completedAt: dates.get("completed") || null,
    stoppedAt:
      dates.get("revoked")
      || dates.get("expired")
      || dates.get("revised")
      || dates.get("superseded")
      || null,
    lastChangedAt: events.at(-1)?.occurredAt || null,
    latestEventHash: events.at(-1)?.eventHash || null,
  };
}

function readinessProjection(authority, readinessSpec) {
  const exact = isObject(readinessSpec)
    && readinessSpec.id === authority.readinessBinding.id
    && readinessSpec.version === authority.readinessBinding.version
    && sha256(readinessSpec) === authority.readinessBinding.hash;
  if (!exact) {
    throw new Error("The exact starting readiness record is unavailable or changed.");
  }
  return {
    id: readinessSpec.id,
    version: readinessSpec.version,
    hash: authority.readinessBinding.hash,
    status: readinessSpec.decision?.status || "unknown",
    offerDisposition: readinessSpec.decision?.offerDisposition || "unknown",
    productionReady: readinessSpec.decision?.productionReady === true,
    externalTestReady: readinessSpec.decision?.externalTestReady === true,
    recommendation: readinessSpec.decision?.recommendation || null,
  };
}

function ownerInputProjection(ownerInputs) {
  return ownerInputs.map((input) => ({
    id: input.id,
    kind: input.kind,
    assertion: input.assertion,
    state: input.state || null,
    assertionScope: Array.isArray(input.assertionScope) ? input.assertionScope : [],
    verificationState: input.verificationState || null,
    evidenceAttached: input.evidenceAttached === true,
    confirmedAt: input.confirmedAt,
    secretsStored: false,
  }));
}

function assignmentProjection(assignments, authority) {
  const byId = new Map(assignments.map((assignment) => [assignment.id, assignment]));
  return authority.assignments.map((template) => {
    const assignment = byId.get(template.id);
    return {
      id: template.id,
      title: template.title,
      materialized: Boolean(assignment),
      assignmentHash: assignment?.assignmentHash || null,
      maxCostAudCents: template.maxCostAudCents,
      provider: template.provider,
      model: template.model,
      maxAttempts: 1,
      externalEffectsAllowed: false,
    };
  });
}

function auxiliaryExecutionActivity(db, assignments) {
  const taskIds = assignments.map((assignment) => assignment.taskId).filter(Boolean);
  if (!db || taskIds.length === 0) {
    return {
      activeAgentRunCount: 0,
      activeToolInvocationCount: 0,
    };
  }
  const markers = taskIds.map(() => "?").join(", ");
  return {
    activeAgentRunCount: Number(db.prepare(
      `SELECT COUNT(*) AS count FROM agent_runs
       WHERE task_id IN (${markers}) AND status = 'running'`,
    ).get(...taskIds).count),
    activeToolInvocationCount: Number(db.prepare(
      `SELECT COUNT(*) AS count FROM agent_tool_invocations
       WHERE task_id IN (${markers}) AND status = 'running'`,
    ).get(...taskIds).count),
  };
}

function executionProjection(ledger, lifecycleState, activity = {}) {
  const attempts = Array.isArray(ledger.executionEvidence?.taskAttempts)
    ? ledger.executionEvidence.taskAttempts
    : [];
  const modelCalls = Array.isArray(ledger.executionEvidence?.modelCalls)
    ? ledger.executionEvidence.modelCalls
    : [];
  const runningAttempts = attempts.filter((item) => item.status === "running");
  const runningCalls = modelCalls.filter((item) => item.status === "running");
  const dispatchingCalls = modelCalls.filter((item) => item.status === "dispatching");
  const activeCalls = modelCalls.filter((item) => (
    ["prepared", "dispatching", "running"].includes(item.status)
  ));
  const activeAgentRunCount = Number(activity.activeAgentRunCount || 0);
  const activeToolInvocationCount = Number(activity.activeToolInvocationCount || 0);
  const providerDispatchCount = attempts.filter(
    (item) => item.provider_dispatched_at !== null && item.provider_dispatched_at !== undefined,
  ).length;
  const activeExecutionRowCount = runningAttempts.length
    + activeCalls.length
    + activeAgentRunCount
    + activeToolInvocationCount;
  const terminalCustodyRecorded = Array.isArray(ledger.terminalRecoveries)
    && ledger.terminalRecoveries.length > 0;
  const running = activeExecutionRowCount > 0;
  return {
    status: running
      ? "running"
      : terminalCustodyRecorded
        ? "sealed_terminal_custody"
      : lifecycleState === "completed"
        ? "completed"
        : providerDispatchCount > 0
          ? "not_running"
          : "not_started",
    running,
    runningAttemptCount: runningAttempts.length,
    runningModelCallCount: runningCalls.length,
    dispatchingModelCallCount: dispatchingCalls.length,
    activeModelCallCount: activeCalls.length,
    activeAgentRunCount,
    activeToolInvocationCount,
    activeExecutionRowCount,
    providerDispatchCount,
    terminalCustodyRecorded,
    terminalCustodySealed: terminalCustodyRecorded && activeExecutionRowCount === 0,
    activationIsNotExecution: true,
  };
}

function terminalCustodyProjection(ledger) {
  const recoveries = Array.isArray(ledger.terminalRecoveries)
    ? ledger.terminalRecoveries
    : [];
  if (recoveries.length === 0) return null;
  const billingObservations = Array.isArray(ledger.ownerBillingObservations)
    ? ledger.ownerBillingObservations
    : [];
  const assignments = new Map(
    ledger.assignments.map((assignment) => [assignment.assignmentHash, assignment]),
  );
  const items = recoveries.map((recovery) => {
    const assignment = assignments.get(recovery.assignmentHash);
    const cap = Number(recovery.assignmentCapAudCents);
    const custodyExposure = Number(recovery.costSnapshot.exposureAudCents);
    const observation = billingObservations.find((item) => (
      item.assignmentHash === recovery.assignmentHash
      && item.predecessor?.kind === "terminal_recovery"
      && item.predecessor?.hash === recovery.recoveryHash
    )) || null;
    const observedAmount = observation
      ? Number(observation.billingObservation.amountAudCents)
      : null;
    return {
      recoveryHash: recovery.recoveryHash,
      assignmentHash: recovery.assignmentHash,
      assignmentId: assignment?.id || null,
      assignmentTitle: assignment?.title || assignment?.id || "Bounded research assignment",
      recordedAt: recovery.recordedAt,
      terminalEventType: recovery.terminalBinding.eventType,
      artifact: {
        hash: recovery.retainedArtifact.artifactHash,
        kind: recovery.retainedArtifact.artifactKind,
        retainedAt: recovery.retainedArtifact.retainedAt,
      },
      receipt: {
        present: Boolean(recovery.executionReceipt),
        status: recovery.executionReceipt?.status || "not_available_before_custody",
        outcomeStatus: recovery.executionReceipt?.outcomeStatus || null,
      },
      billing: {
        currency: "AUD",
        costTruth: observation ? "owner_attested" : recovery.costSnapshot.costTruth,
        custodyCostTruth: recovery.costSnapshot.costTruth,
        knownCostAudCents: observedAmount,
        exposureAudCents: observation ? observedAmount : custodyExposure,
        custodyExposureAudCents: custodyExposure,
        assignmentCapAudCents: cap,
        fullCapExposure: observation ? observedAmount === cap : custodyExposure === cap,
        custodyFullCapExposure: custodyExposure === cap,
        exactBillingPending: observation
          ? false
          : recovery.costSnapshot.exactBillingPending === true,
        ownerAttested: Boolean(observation),
        providerSettled: false,
        observation: observation ? {
          observationHash: observation.observationHash,
          truthStatus: observation.truth.status,
          amountAudCents: observedAmount,
          observedAt: observation.billingObservation.observedAt,
          recordedAt: observation.recordedAt,
          originalCostOccurredAt:
            observation.billingObservation.originalCostOccurredAt,
          budgetComparison: observation.budgetComparison,
        } : null,
      },
      safety: {
        executionSealed: recovery.controls.executionSealed === true,
        retryAuthorized: recovery.controls.retryAuthorized === true,
        additionalNetworkCalls: recovery.controls.additionalNetworkCalls,
        additionalAiCostAudCents: recovery.controls.additionalAiCostAudCents,
        evidenceEligible: recovery.controls.evidenceEligible === true,
        decisionEligible: recovery.controls.decisionEligible === true,
        completionEligible: recovery.controls.completionEligible === true,
        commercialInference: recovery.controls.commercialInference,
      },
    };
  });
  const verified = !ledger.decision && items.every((item) => (
    item.billing.custodyCostTruth === "unknown"
    && item.billing.custodyFullCapExposure
    && item.safety.executionSealed
    && item.safety.retryAuthorized === false
    && Number(item.safety.additionalNetworkCalls) === 0
    && Number(item.safety.additionalAiCostAudCents) === 0
    && item.safety.evidenceEligible === false
    && item.safety.decisionEligible === false
    && item.safety.completionEligible === false
    && item.safety.commercialInference === "none"
  ));
  if (!verified) {
    throw new Error("Terminal provider custody lost its exact billing-only safety boundary.");
  }
  const pendingItems = items.filter((item) => item.billing.exactBillingPending);
  return {
    status: pendingItems.length > 0
      ? "terminal_custody_pending_billing"
      : "terminal_custody_owner_attested",
    verified,
    count: items.length,
    exactBillingPending: pendingItems.length > 0,
    fullCapExposure: items.every((item) => item.billing.fullCapExposure),
    custodyFullCapExposure: items.every(
      (item) => item.billing.custodyFullCapExposure,
    ),
    ownerAttestedBillingCount: items.filter((item) => item.billing.ownerAttested).length,
    providerSettled: false,
    ownerBillingControl: pendingItems.length === 1 ? {
      allowed: true,
      assignmentHash: pendingItems[0].assignmentHash,
      assignmentId: pendingItems[0].assignmentId,
      assignmentTitle: pendingItems[0].assignmentTitle,
      currency: "AUD",
      maximumRecordedExposureAudCents:
        pendingItems[0].billing.custodyExposureAudCents,
      providerSettled: false,
    } : null,
    decisionRecorded: Boolean(ledger.decision),
    retryAuthorized: items.some((item) => item.safety.retryAuthorized),
    additionalNetworkCalls: items.reduce(
      (total, item) => total + Number(item.safety.additionalNetworkCalls || 0),
      0,
    ),
    additionalAiCostAudCents: items.reduce(
      (total, item) => total + Number(item.safety.additionalAiCostAudCents || 0),
      0,
    ),
    executionSealed: items.every((item) => item.safety.executionSealed),
    evidenceEligible: items.some((item) => item.safety.evidenceEligible),
    decisionEligible: items.some((item) => item.safety.decisionEligible),
    completionEligible: items.some((item) => item.safety.completionEligible),
    items,
  };
}

function ownerBillingProjection(ledger) {
  const observations = Array.isArray(ledger.ownerBillingObservations)
    ? ledger.ownerBillingObservations
    : [];
  if (observations.length === 0) return null;
  const assignments = new Map(
    ledger.assignments.map((assignment) => [assignment.assignmentHash, assignment]),
  );
  const items = observations.map((observation) => ({
    observationHash: observation.observationHash,
    assignmentId: assignments.get(observation.assignmentHash)?.id || null,
    assignmentTitle: assignments.get(observation.assignmentHash)?.title
      || assignments.get(observation.assignmentHash)?.id
      || "Bounded research assignment",
    amountAudCents: observation.billingObservation.amountAudCents,
    currency: observation.billingObservation.currency,
    observedAt: observation.billingObservation.observedAt,
    recordedAt: observation.recordedAt,
    originalCostOccurredAt: observation.billingObservation.originalCostOccurredAt,
    truthStatus: observation.truth.status,
    predecessorKind: observation.predecessor.kind,
    budgetComparison: observation.budgetComparison,
    providerSettled: false,
  }));
  return {
    status: "owner_attested_not_provider_settled",
    count: items.length,
    amountAudCents: items.reduce(
      (total, item) => total + Number(item.amountAudCents || 0),
      0,
    ),
    currency: "AUD",
    providerSettled: false,
    items,
  };
}

function terminalStopProjection(ledger, authority) {
  const stop = ledger.terminalStopRecord || null;
  if (!stop) return null;
  const templates = new Map(authority.assignments.map((item) => [item.id, item]));
  const trigger = templates.get(stop.triggerAssignmentId) || null;
  const skipped = stop.skippedAssignments.map((item) => {
    const template = templates.get(item.assignmentId) || null;
    return {
      id: item.id,
      assignmentId: item.assignmentId,
      title: template?.title || item.assignmentId,
      assignmentOrder: item.assignmentOrder,
      dispatchState: item.dispatchState,
      taskAttemptCount: item.taskAttemptCount,
      modelCallCount: item.modelCallCount,
      agentRunCount: item.agentRunCount,
      researchRunCount: item.researchRunCount,
      toolInvocationCount: item.toolInvocationCount,
      budgetReservationCount: item.budgetReservationCount,
      costRecordCount: item.costRecordCount,
      sourceSnapshotCount: item.sourceSnapshotCount,
      evidenceRecordCount: item.evidenceRecordCount,
      totalAudCostCents: item.totalAudCostCents,
      skippedAt: item.skippedAt,
      recordHash: item.skipRecordHash,
    };
  });
  return {
    id: stop.id,
    recordHash: stop.earlyStopRecordHash,
    trigger: {
      assignmentId: stop.triggerAssignmentId,
      title: trigger?.title || stop.triggerAssignmentId,
      assignmentOrder: authority.assignments.findIndex(
        (item) => item.id === stop.triggerAssignmentId,
      ) + 1,
      outcomeClass: stop.triggerOutcomeClass,
      gapCodes: [...stop.gapCodes],
      stoppedAt: stop.stoppedAt,
    },
    nextEvidenceAction: stop.nextEvidenceAction,
    skippedSuffix: {
      count: skipped.length,
      assignments: skipped,
      exactNoDispatchOrCost: skipped.every((item) => (
        item.dispatchState === "not_dispatched"
        && item.taskAttemptCount === 0
        && item.modelCallCount === 0
        && item.agentRunCount === 0
        && item.researchRunCount === 0
        && item.toolInvocationCount === 0
        && item.budgetReservationCount === 0
        && item.costRecordCount === 0
        && item.totalAudCostCents === 0
      )),
    },
  };
}

function decisionProjection(ledger) {
  const decision = ledger.decision || null;
  if (!decision) return null;
  const completed = ledger.lifecycle.find((event) => event.eventType === "completed") || null;
  return {
    schema: decision.schema,
    id: decision.id,
    version: decision.version,
    outcome: decision.outcome,
    completionMode: decision.completionMode,
    decidedAt: decision.decidedAt,
    summary: decision.summary,
    buyer: decision.buyer,
    problem: decision.problem,
    offer: decision.offer,
    channel: decision.channel,
    priceOrMargin: decision.priceOrMargin,
    evidenceStandard: decision.evidenceStandard,
    nextMoneyMove: decision.nextMoneyMove,
    reviseOrStopCriteria: [...decision.reviseOrStopCriteria],
    comparatorCount: decision.comparatorCount,
    comparatorCoverage: decision.comparatorCoverage,
    formatCases: decision.formatCases,
    channelCases: decision.channelCases,
    economicsCases: decision.economicsCases,
    contraryEvidence: [...decision.contraryEvidence],
    materialContradictions: [...decision.materialContradictions],
    readinessGates: decision.readinessGates,
    limitations: [...decision.limitations],
    provenanceComplete: decision.provenanceComplete,
    estimatedInternalAiCostAudCents: decision.estimatedInternalAiCostAudCents,
    reconciledInternalAiCostAudCents: decision.reconciledInternalAiCostAudCents,
    exactBillingPending: decision.exactBillingPending,
    unknownProviderOutcomeCount: decision.unknownProviderOutcomeCount,
    unknownCostCount: decision.unknownCostCount,
    nextEvidenceAction: decision.nextEvidenceAction,
    resultingReadiness: {
      schema: RESULTING_READINESS_SCHEMA,
      version: decision.version,
      outcome: decision.outcome,
      hash: completed?.metadata?.resultingReadinessHash || null,
      decidedAt: decision.decidedAt,
    },
    recommendationOnly: decision.outcome === "build",
    buildAuthorized: false,
    commercialTestAuthorized: false,
    externalActionAuthorized: false,
    decisionHash: decision.decisionHash,
  };
}

function channelHypotheses(authority) {
  const labels = {
    etsy: "Etsy",
    gumroad: "Gumroad",
    evidence_supported_lawful_alternative: "Evidence-supported lawful alternative",
    retain_cash: "Retain cash",
  };
  return authority.channelCases.map((id) => ({
    id,
    label: labels[id] || id,
    selectionState: "unselected",
    commercialFit: "unproved",
    accountReadiness: id === "etsy" ? "owner_reported_unverified" : "not_established",
    adapterReadiness: "not_established",
    externalActionAuthorized: false,
  }));
}

function validatePendingPreventureLifecycleApproval(row, authority, eventType) {
  if (!isObject(row) || !isObject(authority) || !["accepted", "activated"].includes(eventType)) {
    return { valid: false, scopeHash: null };
  }
  const expectedScope = preventureResearchApprovalScope(authority, eventType);
  const expectedHash = preventureResearchApprovalScopeHash(authority, eventType);
  const expectedPayload = {
    preventureResearchApprovalScope: expectedScope,
    preventureResearchApprovalScopeHash: expectedHash,
  };
  const expectedTitle = eventType === "accepted"
    ? "Accept this exact bounded research authority?"
    : "Activate this exact bounded internal research round?";
  const requestedAt = Date.parse(String(row.requested_at || ""));
  const expiresAt = Date.parse(String(authority.expiresAt || ""));
  const valid = row.status === "pending"
    && sameCanonical(parseObject(row.scope), expectedScope)
    && sameCanonical(parseObject(row.payload), expectedPayload)
    && row.scope_hash === expectedHash
    && row.expires_at === authority.expiresAt
    && row.venture_id === null
    && row.workflow_id === null
    && row.task_id === null
    && row.title === expectedTitle
    && row.risk_level === "high"
    && row.requested_by === "jarvis"
    && Number.isFinite(requestedAt)
    && Number.isFinite(expiresAt)
    && requestedAt < expiresAt
    && row.decided_by === null
    && row.decided_at === null
    && row.consumed_at === null
    && sameCanonical(parseJsonValue(row.expected_effects), []);
  return { valid, scopeHash: expectedHash, scope: expectedScope };
}

function linkedLifecycleApproval(db, authority, state) {
  const eventType = state === "proposed" ? "accepted" : state === "accepted" ? "activated" : null;
  if (!eventType || !db || typeof db.prepare !== "function") {
    return { decision: null, integrityIssue: false };
  }
  const expectedHash = preventureResearchApprovalScopeHash(authority, eventType);
  const rows = db.prepare(
    `SELECT id, venture_id, workflow_id, task_id, scope, title, status, risk_level,
            requested_by, requested_at, decided_by, scope_hash, payload,
            expected_effects, expires_at, decided_at, consumed_at
     FROM approvals
     WHERE status = 'pending'
       AND (
         scope_hash = ?
         OR json_extract(
           CASE WHEN json_valid(payload) THEN payload ELSE '{}' END,
           '$.preventureResearchApprovalScope.authority.hash'
         ) = ?
       )
     ORDER BY requested_at, id`,
  ).all(expectedHash, authority.authorityHash);
  if (rows.length === 0) return { decision: null, integrityIssue: true };
  const exact = rows.filter((row) => (
    validatePendingPreventureLifecycleApproval(row, authority, eventType).valid
  ));
  if (rows.length !== 1 || exact.length !== 1) {
    return { decision: null, integrityIssue: true };
  }
  return {
    decision: { id: exact[0].id, eventType, scopeHash: expectedHash },
    integrityIssue: false,
  };
}

function replacementRequiredApproval(db, authority) {
  if (!db || typeof db.prepare !== "function") return null;
  const acceptedHash = preventureResearchApprovalScopeHash(authority, "accepted");
  const activatedHash = preventureResearchApprovalScopeHash(authority, "activated");
  const rows = db.prepare(
    `SELECT id, scope, scope_hash, payload, expires_at, decision_note, decided_at, consumed_at
     FROM approvals
     WHERE status = 'needs_changes'
       AND scope_hash IN (?, ?)
     ORDER BY decided_at DESC, requested_at DESC, id DESC`,
  ).all(acceptedHash, activatedHash);
  const exact = rows.filter((row) => {
    const eventType = row.scope_hash === acceptedHash ? "accepted" : "activated";
    const expectedScope = preventureResearchApprovalScope(authority, eventType);
    const scope = parseObject(row.scope);
    const payload = parseObject(row.payload);
    if (!scope || !payload || !sameCanonical(scope, expectedScope)) return false;
    const candidates = [
      payload.preventureResearchApprovalScope,
      payload.preventureLifecycleApprovalScope,
      payload.approvalScope,
      payload.scope,
    ].filter(isObject);
    const hashes = [
      payload.preventureResearchApprovalScopeHash,
      payload.preventureLifecycleApprovalScopeHash,
      payload.approvalScopeHash,
    ].filter((value) => value !== undefined);
    return candidates.length > 0
      && candidates.every((candidate) => sameCanonical(candidate, expectedScope))
      && hashes.length > 0
      && hashes.every((value) => value === row.scope_hash)
      && row.expires_at === authority.expiresAt
      && row.decided_at !== null
      && row.consumed_at === null;
  });
  if (exact.length !== 1 || rows.length !== 1) return null;
  return {
    id: exact[0].id,
    scopeHash: exact[0].scope_hash,
    note: exact[0].decision_note || null,
    decidedAt: exact[0].decided_at,
  };
}

function parseObject(value) {
  if (isObject(value)) return value;
  if (typeof value !== "string") return null;
  try {
    const parsed = JSON.parse(value);
    return isObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
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

function sameCanonical(left, right) {
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
}

function nextAction(state, readiness, decision) {
  if (decision) {
    if (
      decision.completionMode === "validated_early_stop"
      && typeof decision.nextEvidenceAction?.action === "string"
    ) {
      return decision.nextEvidenceAction.action;
    }
    if (typeof decision.nextMoneyMove === "string" && decision.nextMoneyMove.trim()) {
      return decision.nextMoneyMove;
    }
    return "Review the recorded diligence result. Any further work needs a new exact authority.";
  }
  if (state.state === "proposed") {
    return "Review whether to accept the exact questions, evidence limits, and A$2/A$0 boundaries.";
  }
  if (state.state === "accepted") {
    return "Review the separate activation decision before any internal AI dispatch can occur.";
  }
  if (state.state === "activated" && readiness.assignments.materialized < readiness.assignments.expected) {
    return "Pantheon must create only the exact accepted assignments before dispatch.";
  }
  if (state.state === "activated" && state.dispatchAllowed) {
    return "Pantheon may run the next exact internal assignment and must stop on expiry, cap, or unknown outcome.";
  }
  if (TERMINAL_STATES.has(state.state)) return "No further work is authorised by this record.";
  return "Resolve the integrity issue before any work continues.";
}

function projectLedger(ledger, state, readinessSpec, generatedAt, db = null) {
  const authority = ledger.authority;
  const effectiveState = effectivePreventureLifecycleState(
    authority,
    ledger.lifecycle,
    generatedAt,
  );
  if (effectiveState !== state.state && !(effectiveState === "expired" && state.expired)) {
    throw new Error("The effective lifecycle state does not match the stored authority projection.");
  }
  const readiness = evaluatePreventureResearchReadiness(ledger, state, { generatedAt });
  const decision = ledger.decision || null;
  const terminalCustody = terminalCustodyProjection(ledger);
  const providerBilling = ownerBillingProjection(ledger);
  const projectedDecision = decisionProjection(ledger);
  const projectedNextAction = terminalCustody?.exactBillingPending
    ? "Record the exact owner-observed provider bill against the sealed full-cap exposure. Do not retry, parse commercial evidence, or make another network call."
    : terminalCustody
      ? "Keep the owner-attested billing record with the sealed custody history. It is not provider settlement and authorises no retry or commercial action."
    : nextAction(state, readiness, decision);
  const completedMoneyMove = terminalCustody
    ? "The provider result is sealed for custody and billing only. Cash remains retained; no commercial decision, retry, product, buyer contact, publishing, advertising, account action, or external commercial spend occurred."
    : decision
      ? `The bounded diligence round completed with ${decision.outcome}. Cash remains retained; no product, buyer contact, publishing, advertising, account action, or external commercial spend occurred.`
      : "Retain cash while bounded internal diligence is incomplete.";
  return {
    authority: {
      id: authority.id,
      version: authority.version,
      hash: authority.authorityHash,
      expiresAt: authority.expiresAt,
      preparationOnly: true,
    },
    startingReadiness: readinessProjection(authority, readinessSpec),
    opportunity: {
      id: authority.opportunity.id,
      name: authority.opportunity.name,
      buyer: authority.opportunity.buyer,
      problem: authority.opportunity.problem,
      offer: authority.opportunity.offer,
    },
    lifecycle: lifecycleProjection(ledger.lifecycle, effectiveState),
    execution: executionProjection(
      ledger,
      effectiveState,
      auxiliaryExecutionActivity(db, ledger.assignments),
    ),
    channelHypotheses: channelHypotheses(authority),
    moneyMove: {
      current: completedMoneyMove,
      next: projectedNextAction,
      completedResult: decision?.nextMoneyMove || null,
      separateApprovalRequiredForBuild: true,
      separateApprovalRequiredForCommercialTest: true,
      separateApprovalRequiredForExternalAction: true,
    },
    budget: readiness.budget,
    boundaries: {
      externalCommercialSpendCapAudCents: 0,
      externalCommercialEffectsAllowed: false,
      publicReadOnlyResearchOnly: true,
      prohibitedActions: authority.prohibitedActions,
    },
    ownerInputs: ownerInputProjection(authority.ownerInputs || []),
    etsy: {
      accountExistence: authority.ownerInputs?.some(
        (item) => item.id === "etsy_seller_account_exists"
          && item.verificationState === "owner_reported_unverified",
      ) ? "owner_reported_unverified" : "unknown",
      accountInspected: false,
      connected: false,
      payoutReady: false,
      publishingAuthorized: false,
    },
    assignments: {
      expected: readiness.assignments.expected,
      materialized: readiness.assignments.materialized,
      items: assignmentProjection(ledger.assignments, authority),
    },
    evidence: readiness.evidence,
    readiness: {
      canSealDecision: readiness.canSealDecision,
      canRecommendBuild: readiness.canRecommendBuild,
      completionBlockers: readiness.completionBlockers,
      buildBlockers: readiness.buildBlockers,
      completionMode: readiness.execution?.completionMode || null,
    },
    terminalStop: terminalStopProjection(ledger, authority),
    terminalCustody,
    providerBilling,
    decision: projectedDecision,
    nextAction: projectedNextAction,
    commercialTruth: {
      buyerContact: false,
      productBuilt: false,
      accountInspectedOrChanged: false,
      publication: false,
      advertising: false,
      externalSpendAudCents: 0,
      orders: 0,
      revenueAudCents: 0,
      commercialValidationOccurred: false,
      settledNetCashContribution: "not_settled",
    },
  };
}

function getPreventureResearchOwnerState(db, options = {}) {
  let generatedAt;
  try {
    generatedAt = timestamp(options.clock);
  } catch {
    generatedAt = new Date().toISOString();
  }
  try {
    const authorityRegistry = options.authorityRegistry
      || defaultPreventureResearchAuthorityRegistry;
    if (typeof authorityRegistry?.resolveAuthorityEntry !== "function") {
      throw new Error("The immutable pre-venture authority registry is unavailable.");
    }
    const store = options.store || require("./preventure-research-store")
      .createPreventureResearchStore(db, {
        ...(options.storeOptions || {}),
        clock: options.storeOptions?.clock || options.clock,
        authorityRegistry,
      });
    const verified = store.verifyLedger();
    if (!isObject(verified) || verified.ok !== true) {
      return attentionState(
        generatedAt,
        "invalid",
        "Pantheon could not verify the pre-venture research ledger, so all controls are withheld.",
      );
    }
    const authorities = store.listAuthorities();
    const projected = authorities.map((authority) => {
      const registered = authorityRegistry.resolveAuthorityEntry(
        authority.authorityHash,
        { id: authority.id, version: authority.version },
      );
      const state = store.readState(authority.authorityHash);
      if (!KNOWN_STATES.has(state.state)) {
        throw new Error("The pre-venture authority has an unknown lifecycle state.");
      }
      const ledger = store.readLedger(authority.authorityHash);
      const persistedState = ledger.lifecycle.at(-1)?.eventType || null;
      const persistedTerminal = TERMINAL_STATES.has(persistedState)
        || ledger.terminalRecoveries.length > 0;
      const effectiveUnsealedExpiry = state.state === "expired" && !persistedTerminal;
      return {
        authority,
        state,
        ledger,
        readinessSpec: ledger.readinessSpec || registered.readinessSpec,
        persistedTerminal,
        effectiveUnsealedExpiry,
      };
    });
    const terminal = projected.filter(({ persistedTerminal }) => persistedTerminal);
    const history = terminal.map(({ state, ledger, readinessSpec }) => projectLedger(
      ledger,
      state,
      readinessSpec,
      generatedAt,
      db,
    )).sort((left, right) => String(right.lifecycle.lastChangedAt || "")
      .localeCompare(String(left.lifecycle.lastChangedAt || "")));
    const current = projected.filter(({ persistedTerminal, effectiveUnsealedExpiry, state }) => (
      !persistedTerminal && (!state.terminal || effectiveUnsealedExpiry)
    ));
    if (current.length > 1) {
      return attentionState(
        generatedAt,
        "ambiguous",
        "More than one current pre-venture research authority exists. Pantheon will not choose between them.",
        history,
      );
    }
    const result = baseState(generatedAt);
    result.history = { total: history.length, items: history };
    if (current.length === 0) return result;
    const selected = current[0];
    if (selected.state.expired) {
      result.current = projectLedger(
        selected.ledger,
        selected.state,
        selected.readinessSpec,
        generatedAt,
        db,
      );
      result.integrity = {
        status: "attention",
        authorityStatus: "expired_unsealed",
        message: "The fixed research deadline passed. Dispatch is blocked until expiry is sealed in the ledger.",
      };
      return result;
    }
    result.current = projectLedger(
      selected.ledger,
      selected.state,
      selected.readinessSpec,
      generatedAt,
      db,
    );
    const replacement = replacementRequiredApproval(db, selected.authority);
    if (replacement) {
      result.current.replacementRequired = {
        decision: replacement,
        nextAction: "Close this v1 authority, then register and review a new immutable version.",
      };
      result.integrity = {
        status: "attention",
        authorityStatus: "replacement_required",
        message: "The owner requested changes. The current immutable authority cannot be reused or advanced.",
      };
      result.controls.allowed = ["revoke"];
      return result;
    }
    const review = linkedLifecycleApproval(
      db,
      selected.authority,
      selected.state.state,
    );
    if (review.integrityIssue) {
      result.integrity = {
        status: "attention",
        authorityStatus: "invalid_approval",
        message: "The pending owner decision is ambiguous or changed. Pantheon has withheld the control.",
      };
      result.controls.allowed = [];
      return result;
    }
    result.current.reviewDecision = review.decision;
    result.integrity = {
      status: "ok",
      authorityStatus: selected.state.state,
      message: selected.state.state === "activated"
        ? "One exact preparation-only research authority is active."
        : "One exact preparation-only research authority is awaiting owner control.",
    };
    result.controls.allowed = review.decision
      ? [selected.state.state === "proposed" ? "review_acceptance" : "review_activation", "revoke"]
      : ["revoke"];
    return result;
  } catch {
    return attentionState(
      generatedAt,
      "unavailable",
      "Pantheon could not verify the exact pre-venture research state. No research, build, test, spend, or external action is authorised.",
    );
  }
}

module.exports = {
  OWNER_PREVENTURE_RESEARCH_SCHEMA,
  decisionProjection,
  executionProjection,
  getPreventureResearchOwnerState,
  lifecycleProjection,
  terminalStopProjection,
  validatePendingPreventureLifecycleApproval,
};
