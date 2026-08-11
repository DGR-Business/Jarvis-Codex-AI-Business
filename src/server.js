const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { URL } = require("node:url");
const { isDeepStrictEqual } = require("node:util");
const { WebSocketServer } = require("ws");
const {
  emergencyStopPantheon,
  getRuntimeControlState,
  markEmergencyStopUnknown,
  returnToStandby,
  stopPantheon,
} = require("./runtime/runtime-supervisor");
const CONFIG = require("./config");
const { decideApproval } = require("./runtime/approvals");
const { refreshIntegrationHealth } = require("./adapters/registry");
const { getDashboardState } = require("./runtime/state");
const { all, fromJson, get, insertEvent, now, openDatabase, run, seedDatabase, toJson } = require("./db");
const { runOnce, runUntilBlocked } = require("./runtime/orchestrator");
const { generateApprovalPack } = require("./runtime/approval-pack");
const { runMonitorCycle } = require("./runtime/monitor");
const {
  prepareReviewedLiveAiWorkerRetry,
  refreshOutdatedLiveAiWorkerApproval,
  refreshOutdatedLiveAiWorkerApprovals,
  requestLiveAiWorker,
} = require("./runtime/live-ai-workers");
const { prepareProductBuilderAsset } = require("./runtime/product-builder-workspace");
const { requestLiveResearch } = require("./runtime/live-research");
const { decideAgentHandoff, ensureAiTeam, getAgentHandoff } = require("./runtime/ai-team");
const { ensureWorkflowScorecards } = require("./runtime/scorecard");
const { getLiveAiWorkerReadiness } = require("./runtime/live-ai-worker-readiness");
const { getLiveResearchReadiness } = require("./runtime/live-research-readiness");
const {
  ensureAgentWorkbench,
  getAgentWorkbenchState,
  requestAgentWorkbenchLiveComparison,
} = require("./runtime/agent-workbench");
const { getAgentToolGateState } = require("./runtime/agent-tool-gate");
const { ensureAgentTools, getAgentToolPolicyState } = require("./runtime/agent-tools");
const { getAgentOperatingBriefsState } = require("./runtime/agent-operating-briefs");
const { getAgentPlaybooksState } = require("./runtime/agent-playbooks");
const { getAgentModelReadinessState, storedComparisonPackets } = require("./runtime/agent-model-readiness");
const { recordAiPilotReviewDecision } = require("./runtime/ai-pilot-review");
const {
  bindAuthenticatedOwnerBillingObservationIssuer,
  bindAuthenticatedOwnerSessionAttestationIssuer,
  createLocalSecurity,
} = require("./runtime/local-security");
const { recoverSetupBlockedTasks } = require("./runtime/spend-gate");
const {
  ensureWeeklyDigest,
  generateWeeklyDigest,
  getCanonicalOwnerDigest,
} = require("./runtime/executive-digest");
const { ensureActiveVentureCase } = require("./runtime/venture-case");
const { ensureCapabilityAutonomy } = require("./runtime/capability-autonomy");
const { reconcileProviderUsageBatch } = require("./runtime/cost-ledger");
const {
  ensureRetentionPolicy,
  prepareRetentionPolicyDecision,
} = require("./runtime/retention-policy");
const {
  latestAgentRunReceipt,
  verifyAgentRunReceiptChain,
} = require("./runtime/agent-execution-evidence");
const {
  createPilotFixture,
  getPilotState,
  prepareDemandValidatorPilot,
  prepareDemandValidatorPilotRetry,
  reviewPilotRun,
} = require("./runtime/agent-pilot");
const {
  getAgentDetail,
  getAgentRunDetail,
  getAgentRunsState,
  getAiTeamState,
  getCockpitState,
  getDecisionsState,
  getSystemState,
} = require("./runtime/cockpit-state");
const {
  getCommercialOwnerTestsState,
} = require("./runtime/commercial-owner-state");
const {
  decideCommercialLifecycleApproval,
  hasCommercialLifecycleApprovalPayload,
} = require("./runtime/commercial-lifecycle-decision");
const {
  defaultPreventureResearchAuthorityRegistry,
} = require("./runtime/preventure-research-authority-registry");
const {
  RENEWAL_ADMISSIBLE_PREDECESSOR_EVENTS,
} = require("./runtime/preventure-research-contract");
const {
  registerPreventureResearchProposal,
  terminatePreventureResearchAuthority,
} = require("./runtime/preventure-research-authority");
const {
  createPreventureLifecycleApproval,
  decidePreventureLifecycleApproval,
  hasPreventureLifecycleApprovalPayload,
} = require("./runtime/preventure-research-lifecycle-decision");
const { sha256 } = require("./runtime/commercial-test-contract");
const {
  materializePreventureResearchAssignments,
} = require("./runtime/preventure-research-materializer");
const {
  getPreventureResearchOwnerState,
} = require("./runtime/preventure-research-owner-state");
const {
  createPreventureResearchStore,
} = require("./runtime/preventure-research-store");
const {
  createPreventureResearchFinalizer,
} = require("./runtime/preventure-research-finalizer");
const {
  createPreventureResearchBridgeOutputStore,
  createPreventureResearchExecutionBridge,
} = require("./runtime/preventure-research-execution-bridge");
const { createMonotonicIsoClock } = require("./runtime/monotonic-iso-clock");
const {
  ensureSchedulerJobs,
  inspectSafeWorkflow,
  runSchedulerJob,
  setSchedulerJobStatus,
  startSchedulerLoop,
  unsafeTaskReason,
} = require("./runtime/scheduler");
const { getOpportunityState } = require("./runtime/pantheon-opportunities");
const {
  ensurePortfolioController,
  getPortfolioState,
} = require("./runtime/portfolio-controller");
const {
  getCommercialConstitution,
  searchCommercialKnowledge,
} = require("./runtime/commercial-knowledge");
const {
  getInvestmentCase,
  listInvestmentCases,
} = require("./runtime/commercial-investment-review");
const {
  getServiceTrialsState,
} = require("./runtime/service-trials");
const { getCapabilityAssuranceState } = require("./runtime/capability-assurance");
const { listVentureKits } = require("./runtime/venture-kit-registry");
const { approveInternalWorkWithinMandate } = require("./runtime/pantheon-policy");
const { getPantheonSupervisorState, runPantheonSupervisorCycle } = require("./runtime/pantheon-supervisor");
const {
  applyPantheonHandoffDecision,
  getProductionState,
} = require("./runtime/pantheon-production");
const {
  getJourneyState,
  isTerminalJourneyStatus,
  journeyById,
} = require("./runtime/pantheon-journey");
const {
  classifyCommercialTaskSafety,
  classifyCommercialWorkflowSafety,
  commercialAuthorityErrorPayload,
  commercialRouteGuard,
  getCommercialAuthorityState,
} = require("./runtime/commercial-authority");

const PUBLIC_DIR = path.join(CONFIG.rootDir, "public");
const MONITOR_JOB_ID = "job-monitor-cycle";
const PREVENTURE_RESEARCH_JOB_ID = "job-preventure-research";

const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".csv": "text/csv; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".zip": "application/zip",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

const MAX_REQUEST_BODY_BYTES = 1_000_000;

function clientRequestError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function preventureApiError(code, message, statusCode = 409) {
  const error = clientRequestError(message, statusCode);
  error.code = code;
  return error;
}

function assertExactRequestBody(body, allowedKeys, requiredKeys = []) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw preventureApiError(
      "preventure_research_request_invalid",
      "This pre-venture action requires one exact JSON object.",
      400,
    );
  }
  const allowed = new Set(allowedKeys);
  const unexpected = Object.keys(body).filter((key) => !allowed.has(key));
  if (unexpected.length) {
    throw preventureApiError(
      "preventure_research_request_scope_changed",
      `This action contains unsupported fields: ${unexpected.join(", ")}. Refresh the recorded control and try again.`,
      400,
    );
  }
  const missing = requiredKeys.filter((key) => (
    typeof body[key] !== "string" || !body[key].trim()
  ));
  if (missing.length) {
    throw preventureApiError(
      "preventure_research_request_incomplete",
      `This action is missing its exact ${missing.join(", ")} binding. Refresh the recorded control and try again.`,
      400,
    );
  }
  return body;
}

function assertPreventureHash(value, label) {
  if (!/^sha256:[a-f0-9]{64}$/.test(String(value || ""))) {
    throw preventureApiError(
      "preventure_research_request_hash_invalid",
      `The exact ${label} binding is invalid. Refresh the recorded control and try again.`,
      400,
    );
  }
  return value;
}

function assertPreventureNote(value) {
  if (value === undefined) return "";
  if (typeof value !== "string" || value.length > 2_000) {
    throw preventureApiError(
      "preventure_research_request_note_invalid",
      "The optional decision note must be ordinary text of at most 2,000 characters.",
      400,
    );
  }
  return value.trim();
}

function assertPreventureAssignmentBinding(db, runtime, assignmentId, body) {
  assertPreventureHash(body.authorityHash, "authority hash");
  assertPreventureHash(body.assignmentHash, "assignment hash");
  assertPreventureHash(body.descriptorHash, "execution descriptor hash");
  const store = createPreventureResearchStore(db, preventureStoreOptions(runtime));
  store.verifyLedger();
  const assignment = store.getAssignment(body.assignmentHash);
  if (
    !assignment
    || assignment.id !== assignmentId
    || assignment.authorityHash !== body.authorityHash
    || body.authorityHash !== runtime.authority.authorityHash
  ) {
    throw preventureApiError(
      "preventure_research_assignment_scope_changed",
      "The requested assignment no longer matches the exact recorded authority. Refresh the control before trying again.",
    );
  }
  return assignment;
}

function preventureTimestamp(clock) {
  const raw = typeof clock === "function" ? clock() : new Date();
  const value = raw instanceof Date ? raw : new Date(raw);
  if (Number.isNaN(value.getTime())) {
    throw preventureApiError(
      "preventure_research_clock_invalid",
      "Pantheon could not verify the bounded-research clock.",
      500,
    );
  }
  return value.toISOString();
}

function resolvePreventureResearchClock(value) {
  if (value !== undefined && typeof value !== "function") {
    throw preventureApiError(
      "preventure_research_clock_invalid",
      "Pantheon requires one callable bounded-research clock for database, provider retention, and lifecycle truth.",
      500,
    );
  }
  return createMonotonicIsoClock(value);
}

let preventureTransactionSequence = 0;

function withPreventureTransaction(db, operation) {
  if (db.isTransaction) {
    const savepoint = `server_preventure_${++preventureTransactionSequence}`;
    db.exec(`SAVEPOINT ${savepoint}`);
    try {
      const result = operation();
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
    const result = operation();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function neutralizePreventureEventOwnership(db) {
  run(
    db,
    `UPDATE events
     SET venture_id = NULL
     WHERE type LIKE 'preventure_research.%'
        OR type LIKE 'preventure_research_lifecycle.%'`,
  );
}

function insertPreventureEvent(db, event) {
  insertEvent(db, {
    ...event,
    ts: event.ts || preventureTimestamp(
      () => get(db, "SELECT pantheon_current_time() AS value")?.value,
    ),
    actor: event.actor || "pantheon",
    entityType: event.entityType || "preventure_research_authority",
  });
  // Legacy venture ownership is insert-triggered. Reset these portfolio-level
  // events after insertion so they are never presented as activity by an
  // unrelated active venture.
  neutralizePreventureEventOwnership(db);
}

function preventureScopeFromApproval(approval) {
  const payload = fromJson(approval?.payload, {});
  return payload.preventureResearchApprovalScope
    || payload.preventureLifecycleApprovalScope
    || payload.approvalScope
    || payload.scope
    || null;
}

function resolvePreventureRuntimeAuthority(options = {}) {
  const authorityRegistry = options.preventureResearchAuthorityRegistry
    || defaultPreventureResearchAuthorityRegistry;
  if (
    !authorityRegistry
    || typeof authorityRegistry.resolveAuthorityEntry !== "function"
    || typeof authorityRegistry.resolveCandidateAuthorityEntry !== "function"
  ) {
    const error = new Error("The immutable pre-venture authority registry is unavailable.");
    error.code = "preventure_research_authority_registry_invalid";
    throw error;
  }
  const suppliedAuthority = options.preventureResearchAuthority;
  const suppliedReadiness = options.preventureResearchReadinessSpec;
  const requestedHash = options.preventureResearchAuthorityHash
    || suppliedAuthority?.authorityHash
    || null;
  let entry;
  try {
    entry = requestedHash
      ? authorityRegistry.resolveAuthorityEntry(
        requestedHash,
        suppliedAuthority
          ? { id: suppliedAuthority.id, version: suppliedAuthority.version }
          : {},
      )
      : authorityRegistry.resolveCandidateAuthorityEntry();
  } catch (cause) {
    const error = new Error(
      String(cause?.message || "The exact registered pre-venture authority is unavailable."),
    );
    error.code = cause?.code || "preventure_research_authority_unknown";
    throw error;
  }
  if (!entry?.authority || !entry?.readinessSpec) {
    const error = new Error(
      "No exact registered candidate pre-venture authority is configured for dispatch.",
    );
    error.code = "preventure_research_candidate_authority_missing";
    throw error;
  }
  if (
    (suppliedAuthority && !isDeepStrictEqual(suppliedAuthority, entry.authority))
    || (suppliedReadiness && !isDeepStrictEqual(suppliedReadiness, entry.readinessSpec))
  ) {
    const error = new Error(
      "The supplied pre-venture authority or readiness record differs from its immutable registry entry.",
    );
    error.code = "preventure_research_authority_changed";
    throw error;
  }
  let candidate = null;
  try {
    candidate = authorityRegistry.resolveCandidateAuthorityEntry();
  } catch {
    candidate = null;
  }
  return Object.freeze({
    authorityRegistry,
    authority: entry.authority,
    readinessSpec: entry.readinessSpec,
    dispatchCandidate: authorityRegistry.candidateAuthorityHash === entry.authority.authorityHash
      && candidate?.authority?.authorityHash === entry.authority.authorityHash
      && isDeepStrictEqual(candidate.authority, entry.authority)
      && isDeepStrictEqual(candidate.readinessSpec, entry.readinessSpec),
  });
}

function preventureRuntimeIsCandidate(runtime) {
  let candidate = null;
  try {
    candidate = runtime?.authorityRegistry?.resolveCandidateAuthorityEntry();
  } catch {
    candidate = null;
  }
  return runtime?.authorityRegistry?.candidateAuthorityHash === runtime?.authority?.authorityHash
    && candidate?.authority?.authorityHash === runtime?.authority?.authorityHash
    && isDeepStrictEqual(candidate?.authority, runtime?.authority)
    && isDeepStrictEqual(candidate?.readinessSpec, runtime?.readinessSpec);
}

function assertPreventureRuntimeCandidate(runtime) {
  if (!preventureRuntimeIsCandidate(runtime)) {
    throw preventureApiError(
      "preventure_research_authority_not_candidate",
      "This registered authority is historical. Only the registry's exact current candidate may create approvals, materialize work, dispatch, or finalize a fresh diligence round.",
    );
  }
}

function preventurePredecessorTerminality(store, authority) {
  const predecessorHash = authority?.supersedesAuthorityHash || null;
  if (!predecessorHash) {
    return { required: false, terminal: true, predecessorHash: null, latest: null };
  }
  const predecessor = store.getAuthority(predecessorHash);
  const lifecycle = predecessor ? store.loadLifecycle(predecessorHash) : [];
  const latest = lifecycle.at(-1) || null;
  return {
    required: true,
    terminal: Boolean(
      predecessor
      && RENEWAL_ADMISSIBLE_PREDECESSOR_EVENTS.includes(latest?.eventType),
    ),
    predecessorHash,
    latest,
  };
}

function assertPreventurePredecessorTerminal(store, authority) {
  const status = preventurePredecessorTerminality(store, authority);
  if (!status.terminal) {
    throw preventureApiError(
      "preventure_research_predecessor_not_terminal",
      "The candidate renewal cannot be proposed, accepted, or activated until its exact predecessor has one durable terminal lifecycle event.",
    );
  }
  return status;
}

function defaultPreventureResearchRuntime(db, options = {}) {
  const resolved = resolvePreventureRuntimeAuthority(options);
  const { authority, readinessSpec, authorityRegistry } = resolved;
  const clock = options.preventureResearchClock;
  const baseStore = createPreventureResearchStore(db, { clock, authorityRegistry });
  const retainedOutputStore = createPreventureResearchBridgeOutputStore({
    store: baseStore,
    authority,
    artifactRoot: options.preventureResearchArtifactRoot || CONFIG.artifactRoot,
  });
  const store = typeof baseStore.withRetainedOutputStore === "function"
    ? baseStore.withRetainedOutputStore(retainedOutputStore)
    : createPreventureResearchStore(db, {
      clock,
      authorityRegistry,
      retainedOutputStore,
    });
  // Structural database checks cannot prove that an immutable retained-output
  // hard link is still present and unchanged. The production runtime must bind
  // and verify the exact output store before any health or owner control can
  // report this authority as available.
  store.verifyLedger();
  const finalizer = createPreventureResearchFinalizer({
    db,
    store,
    authority,
    readinessSpec,
    authorityRegistry,
    clock,
  });
  const bridge = createPreventureResearchExecutionBridge({
    db,
    store,
    outputStore: retainedOutputStore,
    authority,
    authorityRegistry,
    artifactRoot: options.preventureResearchArtifactRoot || CONFIG.artifactRoot,
    finalizeDecision: finalizer,
    clock,
  });
  const startupArtifactRecovery = bridge.recoverCrashRetainedOutput();
  store.verifyLedger();
  return {
    prepareAssignment: bridge.prepareAssignment,
    runAssignment: bridge.runAssignment,
    reprocessAssignment: bridge.reprocessAssignment,
    recoverTerminalRetainedOutput: bridge.recoverTerminalRetainedOutput,
    retainedOutputStore,
    startupArtifactRecovery,
    readiness: bridge.readiness,
    finalizeDecision: finalizer,
    describeFinalization: finalizer.describeFinalization,
  };
}

function preventureRuntimeConfiguration(options = {}, db = null) {
  const resolved = resolvePreventureRuntimeAuthority(options);
  const injected = options.preventureResearchRuntime
    || (db && typeof options.preventureResearchRuntimeFactory === "function"
      ? options.preventureResearchRuntimeFactory({ db, options })
      : db ? defaultPreventureResearchRuntime(db, options) : {});
  return Object.freeze({
    authorityRegistry: resolved.authorityRegistry,
    authority: resolved.authority,
    readinessSpec: resolved.readinessSpec,
    dispatchCandidate: resolved.dispatchCandidate,
    clock: options.preventureResearchClock,
    prepareAssignment: typeof injected.prepareAssignment === "function"
      ? injected.prepareAssignment
      : null,
    runAssignment: typeof injected.runAssignment === "function" ? injected.runAssignment : null,
    reprocessAssignment: typeof injected.reprocessAssignment === "function"
      ? injected.reprocessAssignment
      : null,
    recoverTerminalRetainedOutput:
      typeof injected.recoverTerminalRetainedOutput === "function"
        ? injected.recoverTerminalRetainedOutput
        : null,
    retainedOutputStore: injected.retainedOutputStore || null,
    finalizeDecision: typeof injected.finalizeDecision === "function"
      ? injected.finalizeDecision
      : null,
    describeFinalization: typeof injected.describeFinalization === "function"
      ? injected.describeFinalization
      : null,
    readiness: typeof injected.readiness === "function" ? injected.readiness : null,
  });
}

function preventureStoreOptions(runtime) {
  return {
    clock: runtime.clock,
    authorityRegistry: runtime.authorityRegistry,
    ...(runtime.retainedOutputStore
      ? { retainedOutputStore: runtime.retainedOutputStore }
      : {}),
  };
}

function canonicalAgentReceiptHashForOwnerBilling(value) {
  const text = String(value || "");
  return text.startsWith("sha256:") ? text : `sha256:${text}`;
}

function deriveOwnerBillingObservationInput(db, store, assignmentHash, body) {
  const assignment = store.getAssignment(assignmentHash);
  if (!assignment) {
    throw preventureApiError(
      "preventure_research_assignment_missing",
      "This owner billing observation no longer matches an exact research assignment.",
      404,
    );
  }
  if (
    body.confirm !== "RECORD OWNER-ATTESTED PROVIDER BILLING"
    || !Number.isSafeInteger(body.amountAudCents)
    || body.amountAudCents < 0
  ) {
    throw preventureApiError(
      "preventure_research_owner_billing_observation_invalid",
      "Owner-attested billing requires the exact confirmation and a non-negative AUD-cent amount.",
      400,
    );
  }
  const reference = (value, label) => {
    const text = String(value || "").trim();
    const hasControlCharacter = [...text].some((character) => {
      const code = character.charCodeAt(0);
      return code <= 31 || code === 127;
    });
    if (!text || text.length > 200 || hasControlCharacter) {
      throw preventureApiError(
        "preventure_research_owner_billing_observation_invalid",
        `${label} must be a non-secret local reference of 1-200 characters.`,
        400,
      );
    }
    return text;
  };
  const observedAtMs = Date.parse(body.observedAt);
  if (!Number.isFinite(observedAtMs)) {
    throw preventureApiError(
      "preventure_research_owner_billing_observation_invalid",
      "The owner-observed billing time is invalid.",
      400,
    );
  }
  const observedAt = new Date(observedAtMs).toISOString();
  const ledger = store.readLedger(assignment.authorityHash);
  if (ledger.ownerBillingObservations.some(
    (item) => item.assignmentHash === assignment.assignmentHash,
  )) {
    throw preventureApiError(
      "preventure_research_owner_billing_observation_already_recorded",
      "This assignment already has an immutable owner-attested billing observation.",
    );
  }
  const costChain = ledger.costEvents.filter(
    (item) => item.assignmentHash === assignment.assignmentHash,
  ).sort((left, right) => left.sequence - right.sequence);
  const costKeys = new Set(costChain.map((item) => item.costKey));
  const predecessor = costChain.at(-1);
  const originalCost = costChain[0];
  if (!predecessor || !originalCost || costKeys.size !== 1) {
    throw preventureApiError(
      "preventure_research_owner_billing_observation_cost_changed",
      "The assignment no longer has one exact immutable provider-cost chain.",
    );
  }
  const recovery = ledger.terminalRecoveries.find((item) => (
    item.assignmentHash === assignment.assignmentHash
    && item.costSnapshot.terminalReceiptHash === predecessor.receiptHash
  )) || null;
  const decision = !recovery && ledger.decision ? ledger.decision : null;
  if (
    (!recovery && !decision)
    || (recovery && predecessor.eventType !== "unknown")
    || (decision && !["estimated", "incurred"].includes(predecessor.eventType))
  ) {
    throw preventureApiError(
      "preventure_research_owner_billing_observation_binding_changed",
      "Owner billing can be recorded only against one exact terminal-custody or sealed-decision cost head.",
    );
  }
  const modelCall = get(db, "SELECT * FROM model_calls WHERE id = ?", [
    predecessor.modelCallId,
  ]);
  const receipt = get(db, "SELECT * FROM agent_run_receipts WHERE id = ?", [
    predecessor.agentRunReceiptId,
  ]);
  if (!modelCall || !receipt) {
    throw preventureApiError(
      "preventure_research_owner_billing_observation_binding_changed",
      "The provider execution receipt is unavailable.",
    );
  }
  const modelMetadata = fromJson(modelCall.metadata, {});
  const dispatch = recovery?.originalDispatch || null;
  const providerDispatchedAt = dispatch?.providerDispatchedAt
    || predecessor.occurredAt;
  const clientRequestId = dispatch?.clientRequestId || modelMetadata.clientRequestId;
  const providerRequestId = dispatch
    ? dispatch.providerRequestId
    : modelCall.provider_request_id;
  const providerResponseId = dispatch
    ? dispatch.providerResponseId
    : modelMetadata.providerResponseId;
  return {
    actionKind: "owner_attested_provider_billing_observation",
    authorityHash: assignment.authorityHash,
    assignmentTemplateHash: assignment.templateHash,
    taskId: assignment.taskId,
    predecessor: {
      kind: recovery ? "terminal_recovery" : "sealed_decision",
      hash: recovery ? recovery.recoveryHash : decision.decisionHash,
      expectedPreviousReceiptHash: predecessor.receiptHash,
    },
    costKey: predecessor.costKey,
    taskAttemptId: predecessor.taskAttemptId,
    modelCallId: predecessor.modelCallId,
    agentRunReceiptId: predecessor.agentRunReceiptId,
    agentRunReceiptHash: canonicalAgentReceiptHashForOwnerBilling(
      receipt.receipt_hash,
    ),
    budgetReservationId: predecessor.budgetReservationId,
    costId: predecessor.costId,
    clientRequestId,
    providerRequestId,
    providerResponseId,
    provider: assignment.provider,
    providerDispatchedAt,
    providerAccountReferenceHash: sha256({
      kind: "owner_provider_account_reference",
      provider: assignment.provider,
      value: reference(body.providerAccountReference, "Provider account reference"),
    }),
    billingRecordReferenceHash: sha256({
      kind: "owner_provider_billing_record_reference",
      provider: assignment.provider,
      value: reference(body.billingRecordReference, "Billing record reference"),
    }),
    currency: "AUD",
    amountAudCents: body.amountAudCents,
    observedAt,
    originalCostOccurredAt: originalCost.occurredAt,
    allocationBasis: {
      method: "owner_observed_provider_billing_allocated_to_original_dispatch",
      amountAudCents: body.amountAudCents,
      currency: "AUD",
      providerDispatchedAt,
      originalCostOccurredAt: originalCost.occurredAt,
    },
    limitations: [
      "This is an authenticated owner observation of provider billing, not a provider-settled API receipt.",
    ],
  };
}

function preventureExecutionReadiness(runtime, input = {}) {
  let adapter = null;
  let readinessError = null;
  if (typeof runtime.readiness === "function") {
    try {
      const reported = runtime.readiness(input);
      if (reported && typeof reported.then === "function") {
        readinessError = "The bounded-research readiness check must finish locally before the request is handled.";
      } else if (reported && typeof reported === "object" && !Array.isArray(reported)) {
        adapter = reported;
      } else {
        readinessError = "The bounded-research adapter did not return an exact readiness record.";
      }
    } catch (error) {
      readinessError = String(error?.message || "The bounded-research readiness check failed.");
    }
  }
  const descriptorReady = /^sha256:[a-f0-9]{64}$/.test(
    String(adapter?.descriptorHash || ""),
  ) && /^sha256:[a-f0-9]{64}$/.test(String(adapter?.requestBodyHash || ""));
  const providerPreflightReady = adapter?.credentialConfigured === true
    && adapter?.egressReady === true
    && adapter?.requestExact === true
    && adapter?.artifactStoreReady === true
    && descriptorReady;
  const providerCallReady = typeof runtime.runAssignment === "function"
    && adapter?.ready === true
    && providerPreflightReady;
  const preparationReady = typeof runtime.prepareAssignment === "function"
    && adapter?.canPrepare === true
    && providerPreflightReady;
  const runReady = typeof runtime.runAssignment === "function"
    && (providerCallReady || preparationReady)
  const reprocessReady = typeof runtime.reprocessAssignment === "function";
  const retainedOutputHash = /^sha256:[a-f0-9]{64}$/.test(
    String(adapter?.retainedOutputHash || ""),
  ) ? adapter.retainedOutputHash : null;
  const canReprocess = reprocessReady
    && adapter?.canReprocess === true
    && descriptorReady
    && retainedOutputHash !== null;
  const terminalCustodyReady = typeof runtime.recoverTerminalRetainedOutput === "function";
  const canRecoverCustody = terminalCustodyReady
    && adapter?.canRecoverCustody === true
    && descriptorReady
    && retainedOutputHash !== null;
  const finalizeReady = typeof runtime.finalizeDecision === "function"
    && typeof runtime.describeFinalization === "function";
  return {
    status: runReady && reprocessReady && finalizeReady ? "ready" : "not_ready",
    assignmentRunReady: runReady,
    retainedOutputReprocessReady: reprocessReady,
    canReprocess,
    terminalCustodyReady,
    canRecoverCustody,
    retainedOutputHash,
    deterministicDecisionReady: finalizeReady,
    providerContactAllowed: providerCallReady,
    providerCallReady,
    requiresPreparation: preparationReady && !providerCallReady,
    descriptorHash: descriptorReady ? adapter.descriptorHash : null,
    requestBodyHash: descriptorReady ? adapter.requestBodyHash : null,
    adapterStatus: adapter?.status || null,
    blockers: Array.isArray(adapter?.blockers) ? adapter.blockers : [],
    message: runReady
      ? "The dedicated bounded-research runner is connected."
      : readinessError
        || adapter?.blockers?.[0]?.message
        || "The dedicated bounded-research runner is not connected and locally ready, so no provider call can start.",
  };
}

function preventureFinalizationControl(db, runtime) {
  const unavailable = (message, blockers = []) => ({
    ready: false,
    authorityHash: runtime.authority.authorityHash,
    evidenceSetHash: null,
    receiptSetHash: null,
    resultingReadinessHash: null,
    outcome: null,
    blockers,
    message,
  });
  if (
    typeof runtime.finalizeDecision !== "function"
    || typeof runtime.describeFinalization !== "function"
  ) {
    return unavailable(
      "The deterministic diligence decision builder is not connected.",
    );
  }
  try {
    const state = createPreventureResearchStore(
      db,
      preventureStoreOptions(runtime),
    ).readState(runtime.authority.authorityHash);
    if (state.state !== "activated") {
      return unavailable(
        state.terminal
          ? "This bounded diligence round is already closed; there is no decision left to complete."
          : "The diligence summary becomes available only while the exact research round is active.",
      );
    }
    const described = runtime.describeFinalization({
      db,
      authority: runtime.authority,
      readinessSpec: runtime.readinessSpec,
      authorityHash: runtime.authority.authorityHash,
      clock: runtime.clock,
    });
    if (described && typeof described.then === "function") {
      return unavailable(
        "The finalization readiness check must finish locally before it is displayed.",
      );
    }
    const hashesReady = [
      described?.authorityHash,
      described?.evidenceSetHash,
      described?.receiptSetHash,
      described?.resultingReadinessHash,
    ].every((value) => /^sha256:[a-f0-9]{64}$/.test(String(value || "")));
    const exact = described?.authorityHash === runtime.authority.authorityHash;
    const ready = described?.ready === true && hashesReady && exact;
    const blockers = Array.isArray(described?.blockers) ? described.blockers : [];
    return {
      ready,
      authorityHash: exact ? described.authorityHash : runtime.authority.authorityHash,
      evidenceSetHash: ready ? described.evidenceSetHash : null,
      receiptSetHash: ready ? described.receiptSetHash : null,
      resultingReadinessHash: ready ? described.resultingReadinessHash : null,
      outcome: ready ? described.outcome || null : null,
      blockers,
      message: ready
        ? "The retained evidence is ready for a deterministic diligence decision."
        : blockers[0]
          || "The retained evidence is not complete enough to seal a diligence decision.",
    };
  } catch (error) {
    return unavailable(
      "The deterministic diligence decision readiness check failed closed.",
      [String(error?.message || "unknown finalization readiness error")],
    );
  }
}

function preventureExecutionReadinessProjection(db, runtime) {
  const summary = preventureExecutionReadiness(runtime);
  const finalizationControl = preventureFinalizationControl(db, runtime);
  try {
    const store = createPreventureResearchStore(db, preventureStoreOptions(runtime));
    store.verifyLedger();
    const assignments = store.listAssignments(runtime.authority.authorityHash);
    const assignmentControls = assignments.map((assignment) => {
      const readiness = preventureExecutionReadiness(runtime, {
        authorityHash: assignment.authorityHash,
        assignmentId: assignment.id,
        assignmentHash: assignment.assignmentHash,
      });
      return {
        authorityHash: assignment.authorityHash,
        assignmentId: assignment.id,
        assignmentHash: assignment.assignmentHash,
        descriptorHash: readiness.descriptorHash,
        requestBodyHash: readiness.requestBodyHash,
        ready: readiness.assignmentRunReady,
        providerCallReady: readiness.providerCallReady,
        requiresPreparation: readiness.requiresPreparation,
        canReprocess: readiness.canReprocess,
        canRecoverCustody: readiness.canRecoverCustody,
        retainedOutputHash: readiness.retainedOutputHash,
        status: readiness.adapterStatus || readiness.status,
        blockers: readiness.blockers,
      };
    });
    const assignmentRunReady = assignmentControls.some((control) => control.ready === true);
    const providerContactAllowed = assignmentControls.some(
      (control) => control.providerCallReady === true,
    );
    return {
      ...summary,
      status: assignmentRunReady
        && summary.retainedOutputReprocessReady
        && summary.deterministicDecisionReady
        ? "ready"
        : "not_ready",
      assignmentRunReady,
      providerContactAllowed,
      assignmentControls,
      finalizationControl,
      descriptorHash: null,
      requestBodyHash: null,
      message: assignmentRunReady
        ? "The dedicated bounded-research runner has an exact locally verified assignment control."
        : summary.message,
    };
  } catch (error) {
    return {
      ...summary,
      status: "not_ready",
      assignmentRunReady: false,
      providerContactAllowed: false,
      assignmentControls: [],
      finalizationControl,
      descriptorHash: null,
      requestBodyHash: null,
      message: `The bounded-research ledger or assignment controls could not be verified: ${String(error?.message || "unknown integrity error")}`,
    };
  }
}

function getCanonicalPreventureResearchState(db, runtime) {
  return getPreventureResearchOwnerState(db, {
    authorityRegistry: runtime.authorityRegistry,
    readinessSpec: runtime.readinessSpec,
    clock: runtime.clock,
    storeOptions: preventureStoreOptions(runtime),
  });
}

function sealExpiredPreventureResearchFromServer(db, runtime) {
  return withPreventureTransaction(db, () => {
    const store = createPreventureResearchStore(db, preventureStoreOptions(runtime));
    store.verifyLedger();
    const authority = store.getAuthority(runtime.authority.authorityHash);
    if (!authority) {
      return { status: "not_applicable", reason: "authority_missing" };
    }
    const ledger = store.readLedger(authority.authorityHash);
    const state = store.readState(authority.authorityHash);
    const latest = ledger.lifecycle.at(-1);
    if (latest?.eventType === "expired") {
      return { status: "already_sealed", state };
    }
    if (state.state !== "expired" || !latest) {
      return { status: "not_applicable", state };
    }
    const active = get(
      db,
      `SELECT tasks.id
       FROM preventure_research_assignments AS assignments
       JOIN tasks ON tasks.id = assignments.task_id
       LEFT JOIN task_attempts AS attempts
         ON attempts.task_id = tasks.id AND attempts.status = 'running'
       WHERE assignments.authority_hash = ?
         AND (tasks.status = 'running' OR attempts.id IS NOT NULL)
       LIMIT 1`,
      [authority.authorityHash],
    );
    if (active) {
      return {
        status: "withheld",
        reason: "active_provider_outcome_must_be_preserved",
        taskId: active.id,
      };
    }
    const terminalAt = authority.expiresAt;
    const recordedAt = preventureTimestamp(runtime.clock);
    const terminated = terminatePreventureResearchAuthority(
      store,
      authority.authorityHash,
      "expired",
      {
        expectedLatestEventHash: latest.eventHash,
        occurredAt: terminalAt,
        actor: "pantheon",
        reason: "The fixed bounded-diligence deadline passed and no provider-capable attempt remains active.",
      },
    );
    run(
      db,
      `UPDATE tasks
       SET status = 'cancelled', error = COALESCE(error, ?), updated_at = ?
       WHERE id IN (
         SELECT task_id FROM preventure_research_assignments WHERE authority_hash = ?
       ) AND status IN ('planned', 'queued', 'blocked', 'waiting_approval')`,
      ["The exact bounded-diligence authority expired before this assignment ran.", recordedAt, authority.authorityHash],
    );
    run(
      db,
      `UPDATE workflows
       SET status = CASE
             WHEN EXISTS (
               SELECT 1 FROM preventure_research_assignments AS assignments
               JOIN tasks ON tasks.id = assignments.task_id
               WHERE assignments.workflow_id = workflows.id
                 AND tasks.status = 'needs_attention'
             ) THEN 'needs_attention'
             ELSE 'cancelled'
           END,
           current_step = ?, updated_at = ?
       WHERE id IN (
         SELECT workflow_id FROM preventure_research_assignments WHERE authority_hash = ?
       ) AND status NOT IN ('completed', 'cancelled', 'archived')`,
      ["The fixed bounded-diligence deadline passed.", recordedAt, authority.authorityHash],
    );
    run(
      db,
      `UPDATE approvals
       SET status = 'expired', decided_at = COALESCE(decided_at, ?),
           decision_note = COALESCE(decision_note, ?)
       WHERE status = 'pending'
         AND json_extract(
           CASE WHEN json_valid(payload) THEN payload ELSE '{}' END,
           '$.preventureResearchApprovalScope.authority.hash'
         ) = ?`,
      [recordedAt, "The exact bounded-diligence authority expired.", authority.authorityHash],
    );
    insertPreventureEvent(db, {
      ts: recordedAt,
      level: state.unknownProviderOutcomeCount || state.unknownCostCount ? "warn" : "info",
      actor: "pantheon",
      type: "preventure_research.expired",
      entityId: authority.authorityHash,
      message: state.unknownProviderOutcomeCount || state.unknownCostCount
        ? "The bounded diligence deadline was sealed. A provider outcome or cost still needs reconciliation; no new provider call may start."
        : "The bounded diligence deadline was sealed. Remaining unstarted work was cancelled and no new provider call may start.",
      metadata: {
        terminalAt,
        recordedAt,
        previousEventHash: latest.eventHash,
        unknownProviderOutcomeCount: state.unknownProviderOutcomeCount,
        unknownCostCount: state.unknownCostCount,
      },
    });
    setPreventureSchedulerStatus(db, "disabled");
    neutralizePreventureEventOwnership(db);
    return { status: "sealed", changed: terminated.created, state: terminated.state };
  });
}

function ensurePreventureResearchFoundation(db, runtime) {
  const timestamp = preventureTimestamp(runtime.clock);
  return withPreventureTransaction(db, () => {
    const store = createPreventureResearchStore(db, preventureStoreOptions(runtime));
    store.verifyLedger();
    if (!preventureRuntimeIsCandidate(runtime)) {
      setPreventureSchedulerStatus(db, "disabled");
      return {
        status: "withheld",
        reason: "historical_authority_not_candidate",
        authorityHash: runtime.authority.authorityHash,
        state: store.getAuthority(runtime.authority.authorityHash)
          ? store.readState(runtime.authority.authorityHash).state
          : "unregistered_history",
      };
    }
    const predecessor = preventurePredecessorTerminality(store, runtime.authority);
    if (!predecessor.terminal) {
      setPreventureSchedulerStatus(db, "disabled");
      return {
        status: "withheld",
        reason: "candidate_predecessor_not_terminal",
        authorityHash: runtime.authority.authorityHash,
        predecessorAuthorityHash: predecessor.predecessorHash,
        predecessorLifecycleState: predecessor.latest?.eventType || "unregistered",
      };
    }
    const candidateRecorded = store.getAuthority(runtime.authority.authorityHash);
    let proposal = null;
    if (!candidateRecorded) {
      proposal = registerPreventureResearchProposal(
        store,
        runtime.authority,
        runtime.readinessSpec,
        {
          occurredAt: timestamp,
          actor: "jarvis",
          reason: "The exact preparation-only diligence proposal is ready for owner review.",
        },
      );
      insertPreventureEvent(db, {
        type: "preventure_research.proposed",
        entityId: runtime.authority.authorityHash,
        message: "A bounded preparation-only research proposal is ready for review. No research, product work, contact, publishing, or spend has started.",
        metadata: {
          authorityHash: runtime.authority.authorityHash,
          internalAiSpendCapAudCents: runtime.authority.internalAiSpendCapAudCents,
          externalCommercialSpendCapAudCents: 0,
        },
      });
    }
    const authority = store.getAuthority(runtime.authority.authorityHash);
    if (!authority) {
      return {
        status: "withheld",
        reason: "exact_preventure_authority_unavailable",
      };
    }
    const state = store.readState(authority.authorityHash);
    const latestLifecycle = store.loadLifecycle(authority.authorityHash).at(-1);
    if (
      state.state === "expired"
      && latestLifecycle
      && latestLifecycle.eventType !== "expired"
    ) {
      const expiry = sealExpiredPreventureResearchFromServer(db, runtime);
      return {
        status: expiry.status === "sealed" ? "ready" : "withheld",
        reason: expiry.reason || null,
        authorityHash: authority.authorityHash,
        state: expiry.state?.state || "expired",
        expiry,
      };
    }
    let approval = null;
    let materialization = null;
    if (state.state === "proposed" && !state.expired) {
      approval = createPreventureLifecycleApproval(
        db,
        authority.authorityHash,
        "accepted",
        {
          requestedAt: timestamp,
          requestedBy: "jarvis",
          storeOptions: preventureStoreOptions(runtime),
        },
      );
      if (approval.created) {
        insertPreventureEvent(db, {
          type: "preventure_research.acceptance_requested",
          entityType: "approval",
          entityId: approval.approval.id,
          message: "The exact bounded-research proposal is waiting for the owner's acceptance. No AI cost or external action has occurred.",
          metadata: { authorityHash: authority.authorityHash, scopeHash: approval.scopeHash },
        });
      }
    } else if (state.state === "accepted" && !state.expired) {
      approval = createPreventureLifecycleApproval(
        db,
        authority.authorityHash,
        "activated",
        {
          requestedAt: timestamp,
          requestedBy: "jarvis",
          storeOptions: preventureStoreOptions(runtime),
        },
      );
      if (approval.created) {
        insertPreventureEvent(db, {
          type: "preventure_research.activation_requested",
          entityType: "approval",
          entityId: approval.approval.id,
          message: "The accepted research scope is waiting for a separate activation decision. No AI call has started.",
          metadata: { authorityHash: authority.authorityHash, scopeHash: approval.scopeHash },
        });
      }
    } else if (state.state === "activated" && !state.expired) {
      const existingAssignments = store.listAssignments(authority.authorityHash);
      if (existingAssignments.length === 0) {
        materialization = materializePreventureResearchAssignments(
          store,
          authority.authorityHash,
          {
            db,
            insideTransaction: true,
            expectedAuthorityHash: authority.authorityHash,
            assignedAt: timestamp,
          },
        );
      } else if (existingAssignments.length !== authority.assignments.length) {
        throw preventureApiError(
          "preventure_research_materialization_incomplete",
          "The active bounded-research round has an incomplete assignment set. Pantheon withheld restart instead of recreating or widening work.",
          500,
        );
      }
    }
    const currentState = store.readState(authority.authorityHash);
    const executionReady = currentState.state === "activated"
      && preventureExecutionReadinessProjection(db, runtime).assignmentRunReady === true;
    setPreventureSchedulerStatus(db, executionReady ? "enabled" : "disabled");
    neutralizePreventureEventOwnership(db);
    return {
      status: "ready",
      proposalCreated: proposal?.created === true,
      approvalCreated: approval?.created === true,
      materialized: materialization?.created === true,
      authorityHash: authority.authorityHash,
      state: currentState.state,
    };
  });
}

function decidePreventureLifecycleFromServer(
  db,
  runtime,
  approvalId,
  decision,
  body,
  ownerRequest,
) {
  assertPreventureRuntimeCandidate(runtime);
  assertPreventureHash(body.scopeHash, "decision scope hash");
  const decisionNote = assertPreventureNote(body.note);
  if (decision === "changes") {
    throw preventureApiError(
      "preventure_research_replacement_required",
      "This authority is immutable. Decline it, then prepare a separately reviewed replacement instead of changing the accepted scope in place.",
    );
  }
  if (!["approve", "reject"].includes(decision)) {
    throw preventureApiError(
      "preventure_research_lifecycle_decision_invalid",
      "Decision must be approve or reject.",
      400,
    );
  }
  const decidedAt = preventureTimestamp(runtime.clock);
  return withPreventureTransaction(db, () => {
    const lifecycleStore = createPreventureResearchStore(
      db,
      preventureStoreOptions(runtime),
    );
    assertPreventurePredecessorTerminal(lifecycleStore, runtime.authority);
    const approval = get(db, "SELECT * FROM approvals WHERE id = ?", [approvalId]);
    if (!approval) {
      throw preventureApiError(
        "preventure_research_lifecycle_decision_not_found",
        "This bounded-research decision no longer exists.",
        404,
      );
    }
    if (!hasPreventureLifecycleApprovalPayload(approval, {
      db,
      authority: runtime.authority,
      storeOptions: preventureStoreOptions(runtime),
    })) {
      throw preventureApiError(
        "preventure_research_lifecycle_scope_invalid",
        "This decision is not an exact pre-venture research lifecycle control.",
      );
    }
    const scope = preventureScopeFromApproval(approval);
    const authorityHash = scope?.authority?.hash;
    const eventType = scope?.eventType;
    if (
      authorityHash !== runtime.authority.authorityHash
      || !["accepted", "activated"].includes(eventType)
    ) {
      throw preventureApiError(
        "preventure_research_lifecycle_scope_changed",
        "The recorded decision no longer matches the exact configured authority.",
      );
    }
    let ownerSessionAttestation;
    try {
      ownerSessionAttestation = ownerRequest.security
        .issueAuthenticatedOwnerSessionAttestation(
        ownerRequest.req,
        ownerRequest.session,
        {
          approvalId,
          decidedAt,
          decision,
          decisionNoteHash: sha256(decisionNote),
          expectedScopeHash: body.scopeHash,
        },
      );
    } catch (cause) {
      throw preventureApiError(
        "preventure_research_lifecycle_owner_session_required",
        String(cause?.message || "This protected decision requires an authenticated local owner session."),
        403,
      );
    }
    const result = decidePreventureLifecycleApproval(
      db,
      approvalId,
      decision,
      decisionNote,
      {
        expectedScopeHash: body.scopeHash,
        actor: "owner",
        decidedAt,
        ownerSessionAttestation,
        storeOptions: preventureStoreOptions(runtime),
      },
    );
    let nextApproval = null;
    let materialization = null;
    if (result.decision === "approved" && eventType === "accepted") {
      nextApproval = createPreventureLifecycleApproval(
        db,
        authorityHash,
        "activated",
        {
          requestedAt: decidedAt,
          requestedBy: "jarvis",
          storeOptions: preventureStoreOptions(runtime),
        },
      );
      if (result.lifecycleChanged) {
        insertPreventureEvent(db, {
          actor: "owner",
          type: "preventure_research.accepted",
          entityId: authorityHash,
          message: "The owner accepted the exact bounded-research scope. Research remains stopped until the separate activation decision.",
          metadata: { approvalId, scopeHash: body.scopeHash },
        });
      }
      if (nextApproval.created) {
        insertPreventureEvent(db, {
          type: "preventure_research.activation_requested",
          entityType: "approval",
          entityId: nextApproval.approval.id,
          message: "A separate activation decision is ready. No AI call or external action has started.",
          metadata: { authorityHash, scopeHash: nextApproval.scopeHash },
        });
      }
    } else if (
      result.decision === "approved"
      && eventType === "activated"
      && result.lifecycleChanged
    ) {
      const store = createPreventureResearchStore(db, preventureStoreOptions(runtime));
      materialization = materializePreventureResearchAssignments(
        store,
        authorityHash,
        {
          db,
          insideTransaction: true,
          expectedAuthorityHash: authorityHash,
          assignedAt: decidedAt,
        },
      );
      if (result.lifecycleChanged) {
        insertPreventureEvent(db, {
          actor: "owner",
          type: "preventure_research.activated",
          entityId: authorityHash,
          message: "The exact internal diligence round was activated. Public research remains unable to start until the dedicated runner is healthy.",
          metadata: {
            approvalId,
            scopeHash: body.scopeHash,
            internalAiSpendCapAudCents: runtime.authority.internalAiSpendCapAudCents,
            externalCommercialSpendCapAudCents: 0,
          },
        });
      }
      if (materialization.created) {
        insertPreventureEvent(db, {
          type: "preventure_research.assignments_materialized",
          entityId: authorityHash,
          message: "Pantheon created only the three accepted internal research assignments. They remain blocked from generic execution.",
          metadata: {
            assignmentCount: materialization.assignments.length,
            assignedCapAudCents: materialization.plan.totalAssignedCostAudCents,
          },
        });
      }
    } else if (result.decision === "rejected" && result.lifecycleChanged) {
      insertPreventureEvent(db, {
        level: "warn",
        actor: "owner",
        type: "preventure_research.revoked",
        entityId: authorityHash,
        message: "The owner declined this bounded-research path. No research, build, contact, publication, advertising, or spend was started.",
        metadata: { approvalId, scopeHash: body.scopeHash },
      });
    }
    const schedulerExecutionReady = result.decision === "approved"
      && eventType === "activated"
      && preventureExecutionReadinessProjection(db, runtime).assignmentRunReady === true;
    setPreventureSchedulerStatus(db, schedulerExecutionReady ? "enabled" : "disabled");
    neutralizePreventureEventOwnership(db);
    const store = createPreventureResearchStore(db, preventureStoreOptions(runtime));
    return {
      result,
      nextApproval: nextApproval ? {
        id: nextApproval.approval.id,
        scopeHash: nextApproval.scopeHash,
        created: nextApproval.created,
      } : null,
      materialization: materialization ? {
        created: materialization.created,
        assignmentCount: materialization.assignments.length,
        assignedCapAudCents: materialization.plan.totalAssignedCostAudCents,
      } : null,
      state: store.readState(authorityHash),
    };
  });
}

function revokePreventureResearchFromServer(db, runtime, body) {
  assertPreventureHash(body.authorityHash, "authority hash");
  assertPreventureHash(body.expectedLatestEventHash, "latest lifecycle event hash");
  const revocationNote = assertPreventureNote(body.note);
  if (body.confirm !== "REVOKE PREVENTURE RESEARCH") {
    throw preventureApiError(
      "preventure_research_revocation_confirmation_required",
      "Revocation needs the exact confirmation phrase.",
      400,
    );
  }
  const occurredAt = preventureTimestamp(runtime.clock);
  return withPreventureTransaction(db, () => {
    const store = createPreventureResearchStore(db, preventureStoreOptions(runtime));
    store.verifyLedger();
    const authority = store.getAuthority(body.authorityHash);
    if (!authority || authority.authorityHash !== runtime.authority.authorityHash) {
      throw preventureApiError(
        "preventure_research_authority_missing",
        "The exact bounded-research authority is unavailable.",
        404,
      );
    }
    const ledger = store.readLedger(authority.authorityHash);
    const latest = ledger.lifecycle.at(-1);
    if (latest?.eventType === "revoked") {
      if (body.expectedLatestEventHash !== latest.eventHash) {
        throw preventureApiError(
          "preventure_research_terminal_scope_stale",
          "Refresh the research authority before stopping it; its latest event changed.",
        );
      }
      return { changed: false, state: store.readState(authority.authorityHash) };
    }
    const activeTaskIds = all(
      db,
      `SELECT DISTINCT tasks.id
       FROM preventure_research_assignments AS assignments
       JOIN tasks ON tasks.id = assignments.task_id
       LEFT JOIN task_attempts AS attempts
         ON attempts.task_id = tasks.id AND attempts.status = 'running'
       LEFT JOIN model_calls AS calls
         ON calls.task_id = tasks.id
        AND (calls.status IN ('dispatching', 'running')
          OR (calls.completed_at IS NULL
            AND calls.outcome_status IN ('provider_dispatched', 'unknown')))
       WHERE assignments.authority_hash = ?
         AND (tasks.status = 'running' OR attempts.id IS NOT NULL OR calls.id IS NOT NULL)
       ORDER BY tasks.id`,
      [authority.authorityHash],
    ).map((row) => row.id);
    const terminated = terminatePreventureResearchAuthority(
      store,
      authority.authorityHash,
      "revoked",
      {
        expectedLatestEventHash: body.expectedLatestEventHash,
        occurredAt,
        actor: "owner",
        reason: revocationNote || "The owner revoked this bounded preparation-only research authority.",
      },
    );
    const inflightSafety = activeTaskIds.length
      ? markEmergencyStopUnknown(
        db,
        "The owner revoked this bounded preparation-only research authority while provider-capable work was in flight.",
        { taskIds: activeTaskIds },
      )
      : { affectedTasks: 0, providerOutcomesUnknown: 0 };
    run(
      db,
      `UPDATE tasks
       SET status = 'cancelled', error = COALESCE(error, ?), updated_at = ?
       WHERE id IN (
         SELECT task_id FROM preventure_research_assignments WHERE authority_hash = ?
       ) AND status IN ('planned', 'queued', 'blocked', 'waiting_approval')`,
      ["The owner revoked the bounded-research authority before execution.", occurredAt, authority.authorityHash],
    );
    run(
      db,
      `UPDATE workflows
       SET status = CASE
             WHEN EXISTS (
               SELECT 1 FROM preventure_research_assignments AS assignments
               JOIN tasks ON tasks.id = assignments.task_id
               WHERE assignments.workflow_id = workflows.id
                 AND tasks.status = 'needs_attention'
             ) THEN 'needs_attention'
             ELSE 'cancelled'
           END,
           current_step = ?, updated_at = ?
       WHERE id IN (
         SELECT workflow_id FROM preventure_research_assignments WHERE authority_hash = ?
       ) AND status NOT IN ('completed', 'cancelled', 'archived')`,
      ["The owner revoked this preparation-only research round.", occurredAt, authority.authorityHash],
    );
    run(
      db,
      `UPDATE approvals
       SET status = 'cancelled', decided_at = COALESCE(decided_at, ?),
           decision_note = COALESCE(decision_note, ?)
       WHERE status = 'pending'
         AND json_extract(
           CASE WHEN json_valid(payload) THEN payload ELSE '{}' END,
           '$.preventureResearchApprovalScope.authority.hash'
         ) = ?`,
      [occurredAt, "Superseded by owner revocation.", authority.authorityHash],
    );
    insertPreventureEvent(db, {
      level: "warn",
      actor: "owner",
      type: "preventure_research.revoked",
      entityId: authority.authorityHash,
      message: "The owner stopped the bounded research round. Remaining internal assignments were cancelled and no new provider call may start.",
      metadata: {
        expectedPreviousEventHash: body.expectedLatestEventHash,
        inflightTasksSafelyTerminalized: inflightSafety.affectedTasks,
        providerOutcomesUnknown: inflightSafety.providerOutcomesUnknown,
      },
    });
    setPreventureSchedulerStatus(db, "disabled");
    return { changed: terminated.created, inflightSafety, state: store.readState(authority.authorityHash) };
  });
}

async function recoverPendingTerminalCustodyFromServer(db, runtime, options = {}) {
  if (typeof runtime.recoverTerminalRetainedOutput !== "function") return null;
  const store = createPreventureResearchStore(db, preventureStoreOptions(runtime));
  store.verifyLedger();
  const assignments = store.listAssignments(runtime.authority.authorityHash);
  for (const assignment of assignments) {
    const readiness = preventureExecutionReadiness(runtime, {
      authorityHash: assignment.authorityHash,
      assignmentId: assignment.id,
      assignmentHash: assignment.assignmentHash,
    });
    if (readiness.canRecoverCustody !== true) continue;
    const result = await runtime.recoverTerminalRetainedOutput({
      db,
      authority: runtime.authority,
      readinessSpec: runtime.readinessSpec,
      authorityHash: assignment.authorityHash,
      assignmentId: assignment.id,
      expectedAssignmentHash: assignment.assignmentHash,
      expectedDescriptorHash: readiness.descriptorHash,
      retainedOutputHash: readiness.retainedOutputHash,
      actor: options.actor || "preventure_terminal_custody",
      clock: runtime.clock,
    });
    if (result?.status !== "terminal_provider_artifact_retained_pending_reconciliation") {
      throw preventureApiError(
        "preventure_research_terminal_custody_incomplete",
        "The exact retained response did not produce its required custody/accounting record.",
        500,
      );
    }
    insertPreventureEvent(db, {
      level: "warn",
      actor: options.actor || "pantheon",
      type: "preventure_research.terminal_artifact_custody_recorded",
      entityId: assignment.id,
      message: "Pantheon retained the already-dispatched provider response for terminal accounting only. It created no commercial evidence, decision, retry, or new provider call.",
      metadata: {
        authorityHash: assignment.authorityHash,
        assignmentHash: assignment.assignmentHash,
        retainedOutputHash: readiness.retainedOutputHash,
        terminalState: result.terminalState,
        accountingState: result.accountingState,
        additionalAiCostAudCents: 0,
      },
    });
    setPreventureSchedulerStatus(db, "disabled");
    return {
      status: "recorded",
      assignmentId: assignment.id,
      result,
    };
  }
  return null;
}

async function continuePreventureResearchFromServer(db, runtime, options = {}) {
  const store = createPreventureResearchStore(db, preventureStoreOptions(runtime));
  store.verifyLedger();
  const authority = store.getAuthority(runtime.authority.authorityHash);
  if (!authority) {
    return {
      status: "idle",
      reason: "exact_authority_not_registered",
      message: "The exact bounded-diligence authority is not registered.",
    };
  }
  const state = store.readState(authority.authorityHash);
  const terminalCustody = await recoverPendingTerminalCustodyFromServer(
    db,
    runtime,
    options,
  );
  if (terminalCustody) {
    return {
      status: "terminal_provider_artifact_retained_pending_reconciliation",
      reason: "terminal_provider_artifact_custody_recorded",
      assignmentId: terminalCustody.assignmentId,
      message: "The already-dispatched response is held for accounting only. The round remains stopped and no evidence, decision, retry, or provider call was created.",
    };
  }
  if (state.state === "expired") {
    const expiry = sealExpiredPreventureResearchFromServer(db, runtime);
    setPreventureSchedulerStatus(db, "disabled");
    return {
      status: expiry.status === "sealed" ? "completed" : "safety_blocked",
      reason: expiry.reason || "fixed_deadline_sealed",
      message: expiry.status === "sealed"
        ? "The fixed diligence deadline was sealed without starting new provider work."
        : "The fixed deadline passed, but an active outcome must be preserved before expiry can be sealed.",
      expiry,
    };
  }
  const assignments = store.listAssignments(authority.authorityHash);
  const normalRecoveryAllowed = preventureRuntimeIsCandidate(runtime)
    && state.state === "activated"
    && state.terminal !== true
    && state.expired !== true;
  const recoverableAssignment = normalRecoveryAllowed
    ? assignments.find((assignment) => (
      preventureExecutionReadiness(runtime, {
        authorityHash: authority.authorityHash,
        assignmentId: assignment.id,
        assignmentHash: assignment.assignmentHash,
      }).canReprocess === true
    ))
    : null;
  if (recoverableAssignment) {
    const recovery = preventureExecutionReadiness(runtime, {
      authorityHash: authority.authorityHash,
      assignmentId: recoverableAssignment.id,
      assignmentHash: recoverableAssignment.assignmentHash,
    });
    const result = await runtime.reprocessAssignment({
      db,
      authority: runtime.authority,
      readinessSpec: runtime.readinessSpec,
      authorityHash: authority.authorityHash,
      assignmentId: recoverableAssignment.id,
      expectedAssignmentHash: recoverableAssignment.assignmentHash,
      expectedDescriptorHash: recovery.descriptorHash,
      retainedOutputHash: recovery.retainedOutputHash,
      actor: options.actor || "preventure_scheduler",
      clock: runtime.clock,
    });
    insertPreventureEvent(db, {
      type: "preventure_research.retained_output_reprocessed",
      entityId: recoverableAssignment.id,
      message: "Pantheon reprocessed one retained research result locally. No new provider call or additional provider cost occurred.",
      metadata: {
        schedulerRunId: options.schedulerRunId || null,
        authorityHash: authority.authorityHash,
        assignmentHash: recoverableAssignment.assignmentHash,
        retainedOutputHash: recovery.retainedOutputHash,
      },
    });
    const recoveredState = store.readState(authority.authorityHash);
    if (recoveredState.state !== "activated" || !recoveredState.dispatchAllowed) {
      setPreventureSchedulerStatus(db, "disabled");
    }
    return {
      status: result?.status || "completed",
      reason: "retained_output_reprocessed_locally",
      assignmentId: recoverableAssignment.id,
      message: "A retained result was recovered locally with no new provider call or cost.",
    };
  }

  if (!preventureRuntimeIsCandidate(runtime)) {
    setPreventureSchedulerStatus(db, "disabled");
    return {
      status: "idle",
      reason: "historical_authority_not_candidate",
      message: "This registered authority is retained for history or exact local recovery only; it cannot start or finalize fresh diligence work.",
    };
  }

  const finalization = preventureFinalizationControl(db, runtime);
  if (finalization.ready) {
    const result = await runtime.finalizeDecision({
      db,
      authority: runtime.authority,
      readinessSpec: runtime.readinessSpec,
      authorityHash: finalization.authorityHash,
      expectedEvidenceSetHash: finalization.evidenceSetHash,
      expectedReceiptSetHash: finalization.receiptSetHash,
      expectedResultingReadinessHash: finalization.resultingReadinessHash,
      actor: options.actor || "preventure_scheduler",
      clock: runtime.clock,
    });
    if (result?.created) {
      insertPreventureEvent(db, {
        type: "preventure_research.decision_completed",
        entityId: authority.authorityHash,
        message: "Pantheon completed the bounded diligence summary from retained evidence. This recommendation grants no build or external-action authority.",
        metadata: {
          schedulerRunId: options.schedulerRunId || null,
          outcome: result.decision?.outcome || null,
          decisionHash: result.decision?.decisionHash || null,
        },
      });
    }
    setPreventureSchedulerStatus(db, "disabled");
    return {
      status: "completed",
      reason: "deterministic_diligence_decision_sealed",
      outcome: result?.decision?.outcome || finalization.outcome || null,
      message: "The retained evidence was sealed into a deterministic recommendation. No build or external action was authorised.",
    };
  }

  if (state.state !== "activated" || !state.dispatchAllowed) {
    setPreventureSchedulerStatus(db, "disabled");
    return {
      status: state.unknownProviderOutcomeCount || state.unknownCostCount
        ? "needs_attention"
        : "idle",
      reason: state.unknownProviderOutcomeCount || state.unknownCostCount
        ? "provider_or_cost_truth_unknown"
        : `authority_${state.state}`,
      message: state.unknownProviderOutcomeCount || state.unknownCostCount
        ? "Bounded diligence is frozen until its provider outcome and cost are reconciled."
        : "Bounded diligence is waiting for its exact owner lifecycle approval.",
    };
  }

  const byId = new Map(assignments.map((assignment) => [assignment.id, assignment]));
  for (const template of authority.assignments) {
    const assignment = byId.get(template.id);
    if (!assignment) {
      return {
        status: "needs_attention",
        reason: "exact_assignment_missing",
        message: "The activated diligence round is missing one exact accepted assignment.",
      };
    }
    const task = get(db, "SELECT id, status FROM tasks WHERE id = ?", [assignment.taskId]);
    if (!task) {
      return {
        status: "needs_attention",
        reason: "exact_assignment_task_missing",
        assignmentId: assignment.id,
        message: "An exact diligence assignment lost its durable work record.",
      };
    }
    if (["completed", "skipped"].includes(task.status)) continue;
    if (task.status === "running") {
      return {
        status: "working",
        reason: "exact_assignment_already_running",
        assignmentId: assignment.id,
        message: "One exact bounded-diligence assignment is already running.",
      };
    }
    const readiness = preventureExecutionReadiness(runtime, {
      authorityHash: authority.authorityHash,
      assignmentId: assignment.id,
      assignmentHash: assignment.assignmentHash,
    });
    if (readiness.canReprocess) {
      const result = await runtime.reprocessAssignment({
        db,
        authority: runtime.authority,
        readinessSpec: runtime.readinessSpec,
        authorityHash: authority.authorityHash,
        assignmentId: assignment.id,
        expectedAssignmentHash: assignment.assignmentHash,
        expectedDescriptorHash: readiness.descriptorHash,
        retainedOutputHash: readiness.retainedOutputHash,
        actor: options.actor || "preventure_scheduler",
        clock: runtime.clock,
      });
      insertPreventureEvent(db, {
        type: "preventure_research.retained_output_reprocessed",
        entityId: assignment.id,
        message: "Pantheon reprocessed one retained research result locally. No new provider call or additional provider cost occurred.",
        metadata: {
          schedulerRunId: options.schedulerRunId || null,
          authorityHash: authority.authorityHash,
          assignmentHash: assignment.assignmentHash,
          retainedOutputHash: readiness.retainedOutputHash,
        },
      });
      const recoveredState = store.readState(authority.authorityHash);
      if (recoveredState.state !== "activated" || !recoveredState.dispatchAllowed) {
        setPreventureSchedulerStatus(db, "disabled");
      }
      return {
        status: result?.status || "completed",
        reason: "retained_output_reprocessed_locally",
        assignmentId: assignment.id,
        message: "A retained result was recovered locally with no new provider call or cost.",
      };
    }
    if (!readiness.assignmentRunReady) {
      return {
        status: "safety_blocked",
        reason: "exact_assignment_runtime_not_ready",
        assignmentId: assignment.id,
        blockers: readiness.blockers,
        message: readiness.message,
      };
    }
    if (readiness.requiresPreparation) {
      await runtime.prepareAssignment({
        db,
        authority: runtime.authority,
        readinessSpec: runtime.readinessSpec,
        authorityHash: authority.authorityHash,
        assignmentId: assignment.id,
        expectedAssignmentHash: assignment.assignmentHash,
        expectedDescriptorHash: readiness.descriptorHash,
        expectedRequestBodyHash: readiness.requestBodyHash,
        actor: options.actor || "preventure_scheduler",
        clock: runtime.clock,
      });
    }
    const prepared = preventureExecutionReadiness(runtime, {
      authorityHash: authority.authorityHash,
      assignmentId: assignment.id,
      assignmentHash: assignment.assignmentHash,
    });
    if (
      !prepared.providerCallReady
      || prepared.descriptorHash !== readiness.descriptorHash
      || prepared.requestBodyHash !== readiness.requestBodyHash
    ) {
      return {
        status: "safety_blocked",
        reason: "exact_assignment_changed_during_preparation",
        assignmentId: assignment.id,
        message: "The exact assignment did not remain locally ready after preparation. No provider call was made.",
      };
    }
    insertPreventureEvent(db, {
      type: "preventure_research.assignment_started",
      entityId: assignment.id,
      message: "Pantheon started the next exact owner-activated research assignment within the fixed A$2 round cap.",
      metadata: {
        schedulerRunId: options.schedulerRunId || null,
        authorityHash: authority.authorityHash,
        assignmentHash: assignment.assignmentHash,
        descriptorHash: prepared.descriptorHash,
      },
    });
    const result = await runtime.runAssignment({
      db,
      authority: runtime.authority,
      readinessSpec: runtime.readinessSpec,
      authorityHash: authority.authorityHash,
      assignmentId: assignment.id,
      expectedAssignmentHash: assignment.assignmentHash,
      expectedDescriptorHash: prepared.descriptorHash,
      expectedRequestBodyHash: prepared.requestBodyHash,
      actor: options.actor || "preventure_scheduler",
      clock: runtime.clock,
    });
    const terminalCustodyRecorded = result?.status
      === "terminal_provider_artifact_retained_pending_reconciliation";
    insertPreventureEvent(db, {
      level: terminalCustodyRecorded
        || /unknown|needs_attention|unusable|failed/i.test(String(result?.status || ""))
        ? "warn"
        : "info",
      type: "preventure_research.assignment_finished",
      entityId: assignment.id,
      message: terminalCustodyRecorded
        ? "The exact provider response was retained for terminal custody and accounting only. It created no commercial evidence or decision and remains pending exact billing reconciliation."
        : /reprocess/i.test(String(result?.status || ""))
          ? "The provider result was retained but needs local recovery before Pantheon can continue. No automatic provider retry is allowed."
          : "The exact bounded-research assignment finished and its provider, cost, receipt, and evidence records remain subject to verification.",
      metadata: {
        schedulerRunId: options.schedulerRunId || null,
        authorityHash: authority.authorityHash,
        assignmentHash: assignment.assignmentHash,
        status: result?.status || null,
      },
    });
    const completedState = store.readState(authority.authorityHash);
    if (completedState.state !== "activated" || !completedState.dispatchAllowed) {
      setPreventureSchedulerStatus(db, "disabled");
    } else {
      const closing = preventureFinalizationControl(db, runtime);
      if (closing.ready) {
        const sealed = await runtime.finalizeDecision({
          db,
          authority: runtime.authority,
          readinessSpec: runtime.readinessSpec,
          authorityHash: closing.authorityHash,
          expectedEvidenceSetHash: closing.evidenceSetHash,
          expectedReceiptSetHash: closing.receiptSetHash,
          expectedResultingReadinessHash: closing.resultingReadinessHash,
          actor: options.actor || "preventure_scheduler",
          clock: runtime.clock,
        });
        setPreventureSchedulerStatus(db, "disabled");
        return {
          status: "completed",
          reason: "deterministic_diligence_decision_sealed",
          assignmentId: assignment.id,
          outcome: sealed?.decision?.outcome || closing.outcome || null,
          message: "The final bounded step and deterministic recommendation were sealed in the same continuation. No build or external action was authorised.",
        };
      }
    }
    if (terminalCustodyRecorded) {
      return {
        status: result.status,
        reason: "terminal_provider_artifact_custody_recorded",
        assignmentId: assignment.id,
        message: "The already-dispatched response is in local custody for accounting only. Authority remains terminal or stopped; no evidence, decision, retry, or provider call was created.",
      };
    }
    return {
      status: result?.status || "completed",
      reason: "exact_assignment_attempt_completed",
      assignmentId: assignment.id,
      message: "The scheduler completed one exact bounded-diligence step and stopped for fresh verification.",
    };
  }
  const closing = preventureFinalizationControl(db, runtime);
  if (closing.ready) {
    const sealed = await runtime.finalizeDecision({
      db,
      authority: runtime.authority,
      readinessSpec: runtime.readinessSpec,
      authorityHash: closing.authorityHash,
      expectedEvidenceSetHash: closing.evidenceSetHash,
      expectedReceiptSetHash: closing.receiptSetHash,
      expectedResultingReadinessHash: closing.resultingReadinessHash,
      actor: options.actor || "preventure_scheduler",
      clock: runtime.clock,
    });
    setPreventureSchedulerStatus(db, "disabled");
    return {
      status: "completed",
      reason: "deterministic_diligence_decision_sealed",
      outcome: sealed?.decision?.outcome || closing.outcome || null,
      message: "The completed bounded round was sealed before the scheduler became idle. No build or external action was authorised.",
    };
  }
  return {
    status: "idle",
    reason: "awaiting_deterministic_finalization",
    blockers: finalization.blockers,
    message: finalization.message,
  };
}

function jsonResponse(res, statusCode, payload) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(body);
}

function notFound(res) {
  jsonResponse(res, 404, { error: "Not found" });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const declaredLength = Number(req.headers["content-length"] || 0);
    if (Number.isFinite(declaredLength) && declaredLength > MAX_REQUEST_BODY_BYTES) {
      reject(clientRequestError("Request body too large", 413));
      return;
    }

    const chunks = [];
    let bytes = 0;
    let settled = false;
    req.on("data", (chunk) => {
      if (settled) return;
      bytes += chunk.length;
      if (bytes > MAX_REQUEST_BODY_BYTES) {
        settled = true;
        reject(clientRequestError("Request body too large", 413));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (settled) return;
      settled = true;
      const body = Buffer.concat(chunks).toString("utf8");
      if (!body) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(clientRequestError("Invalid JSON body", 400));
      }
    });
    req.on("error", (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    });
  });
}

function serveStatic(req, res) {
  const url = new URL(req.url, "http://localhost");
  if (url.pathname === "/vendor/lucide.js") {
    const vendorPath = path.join(CONFIG.rootDir, "node_modules", "lucide", "dist", "umd", "lucide.min.js");
    if (!fs.existsSync(vendorPath)) {
      notFound(res);
      return;
    }
    res.writeHead(200, { "content-type": "text/javascript; charset=utf-8", "cache-control": "public, max-age=86400" });
    fs.createReadStream(vendorPath).pipe(res);
    return;
  }
  const pathname = url.pathname === "/" ? "/index.html" : url.pathname;
  const decoded = decodeURIComponent(pathname);
  const safePath = path.normalize(decoded).replace(/^([/\\])+/, "");
  const filePath = path.resolve(PUBLIC_DIR, safePath);
  const relative = path.relative(PUBLIC_DIR, filePath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    notFound(res);
    return;
  }
  const ext = path.extname(filePath);
  res.writeHead(200, {
    "content-type": CONTENT_TYPES[ext] || "application/octet-stream",
    "cache-control": "no-store",
  });
  fs.createReadStream(filePath).pipe(res);
}

function resolveWorkspaceFile(filePath) {
  if (!filePath) return null;
  const root = path.resolve(CONFIG.rootDir);
  const candidate = path.isAbsolute(filePath) ? filePath : path.join(root, filePath);
  const resolved = path.resolve(candidate);
  const canonical = fs.existsSync(resolved) ? fs.realpathSync.native(resolved) : resolved;
  const configuredPackRoot = process.env.PANTHEON_APPROVAL_PACK_DIR
    || process.env.JARVIS_APPROVAL_PACK_DIR
    || null;
  const allowedRoots = [
    path.resolve(CONFIG.artifactRoot),
    path.resolve(CONFIG.rootDir, "output", "pdf"),
    ...(configuredPackRoot ? [path.resolve(configuredPackRoot)] : []),
  ];
  return allowedRoots.some((allowedRoot) => {
    const canonicalRoot = fs.existsSync(allowedRoot)
      ? fs.realpathSync.native(allowedRoot)
      : allowedRoot;
    const relative = path.relative(canonicalRoot, canonical);
    return !relative.startsWith("..") && !path.isAbsolute(relative);
  }) ? canonical : null;
}

function serveDeliverableFile(db, res, id, options = {}) {
  const download = options.download === true;
  const deliverable = get(
    db,
    `SELECT id, human_name, format, status, file_path, content_hash, metadata
     FROM deliverables WHERE id = ?`,
    [id],
  );
  if (!deliverable) {
    notFound(res);
    return;
  }
  const format = String(deliverable.format || "").toLowerCase();
  const previewableFormat = format === "pdf"
    || format === "application/pdf"
    || format.startsWith("image/");
  if (!download && !previewableFormat) {
    jsonResponse(res, 415, { error: "Preview is available for PDF and image review outputs only." });
    return;
  }
  const filePath = resolveWorkspaceFile(deliverable.file_path);
  if (!filePath) {
    jsonResponse(res, 403, { error: "Review output is outside the workspace and cannot be previewed." });
    return;
  }
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    notFound(res);
    return;
  }
  const stats = fs.statSync(filePath);
  const extension = path.extname(filePath).toLowerCase();
  const previewExtensions = new Set([".pdf", ".png", ".jpg", ".jpeg", ".webp", ".gif"]);
  const downloadExtensions = new Set([
    ...previewExtensions,
    ".zip",
    ".xlsx",
    ".csv",
    ".txt",
    ".md",
    ".json",
    ".docx",
    ".pptx",
  ]);
  if (!(download ? downloadExtensions : previewExtensions).has(extension)) {
    jsonResponse(res, 415, { error: "This review output format cannot be previewed safely." });
    return;
  }
  if (stats.size > 150 * 1024 * 1024) {
    jsonResponse(res, 413, { error: "This file exceeds Pantheon's 150 MB operator-download limit." });
    return;
  }
  const bytes = fs.readFileSync(filePath);
  const metadata = fromJson(deliverable.metadata, {});
  const expectedHash = String(deliverable.content_hash || metadata.sha256 || "");
  if (download && !/^[a-f0-9]{64}$/i.test(expectedHash)) {
    jsonResponse(res, 409, { error: "This file is not bound to a verified content hash." });
    return;
  }
  if (expectedHash) {
    const actualHash = crypto.createHash("sha256").update(bytes).digest("hex");
    if (actualHash !== expectedHash) {
      jsonResponse(res, 409, { error: "This file changed after Pantheon recorded it. Review is required." });
      return;
    }
  }
  const filename = path.basename(filePath).replace(/["\r\n]/g, "");
  res.writeHead(200, {
    "content-type": CONTENT_TYPES[extension] || "application/octet-stream",
    "content-length": bytes.length,
    "content-disposition": `${download ? "attachment" : "inline"}; filename="${filename}"`,
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "x-pantheon-content-hash": expectedHash || "unbound",
  });
  res.end(bytes);
}

function ensureRuntimeFoundation(db) {
  const integrationHealth = refreshIntegrationHealth(db);
  ensureAiTeam(db);
  ensureAgentTools(db);
  const approvalRefresh = refreshOutdatedLiveAiWorkerApprovals(db, {
    trigger: "runtime-startup-policy-refresh",
  });
  const setupRecovery = recoverSetupBlockedTasks(db);
  ensureAgentWorkbench(db);
  ensureSchedulerJobs(db);
  run(
    db,
    `UPDATE scheduler_jobs
     SET status = 'disabled', next_run_at = NULL, updated_at = ?
     WHERE kind = 'pantheon_supervisor'
       AND status <> 'disabled'`,
    [now()],
  );
  ensureWorkflowScorecards(db);
  ensureActiveVentureCase(db);
  ensureCapabilityAutonomy(db);
  ensureWeeklyDigest(db);
  ensureRetentionPolicy(db);
  ensurePortfolioController(db);
  return { integrationHealth, approvalRefresh, setupRecovery };
}

function getMonitoringReadiness(db, runtimeState) {
  const job = get(
    db,
    `SELECT id, name, status, interval_seconds, last_run_at, next_run_at,
            locked_at, lock_owner, updated_at
     FROM scheduler_jobs
     WHERE id = ?`,
    [MONITOR_JOB_ID],
  );
  const latestCompleted = get(
    db,
    `SELECT id, status, severity, finding_count, started_at, completed_at
     FROM monitor_runs
     WHERE completed_at IS NOT NULL
     ORDER BY completed_at DESC, started_at DESC
     LIMIT 1`,
  );
  const latestSchedulerRun = get(
    db,
    `SELECT id, status, started_at, completed_at
     FROM scheduler_runs
     WHERE job_id = ?
     ORDER BY started_at DESC
     LIMIT 1`,
    [MONITOR_JOB_ID],
  );
  const intervalSeconds = Math.max(60, Number(job?.interval_seconds || 15 * 60));
  const pollSeconds = Math.max(10, Math.ceil(Number(runtimeState.schedulerPollMs || CONFIG.schedulerPollMs) / 1000));
  const graceSeconds = Math.max(120, Math.ceil(intervalSeconds / 4), pollSeconds * 2);
  const maxAgeSeconds = intervalSeconds + graceSeconds;
  const currentMs = Date.now();
  const completedMs = Date.parse(latestCompleted?.completed_at || "");
  const nextRunMs = Date.parse(job?.next_run_at || "");
  const runtimeStartedMs = Date.parse(runtimeState.startedAt || "");
  const ageSeconds = Number.isFinite(completedMs)
    ? Math.max(0, Math.floor((currentMs - completedMs) / 1000))
    : null;
  const recent = ageSeconds !== null && ageSeconds <= maxAgeSeconds;
  const scheduleOverdue = Boolean(
    job?.status === "enabled"
      && !job.lock_owner
      && Number.isFinite(nextRunMs)
      && currentMs > nextRunMs + graceSeconds * 1000,
  );
  const latestSchedulerRunFailed = Boolean(
    latestSchedulerRun
      && ["failed", "needs_attention", "abandoned"].includes(latestSchedulerRun.status),
  );
  const currentProcessCheckCompleted = Boolean(
    Number.isFinite(completedMs)
      && Number.isFinite(runtimeStartedMs)
      && completedMs >= runtimeStartedMs,
  );
  const startupCheckCompleted = runtimeState.startupMonitoring.status === "completed"
    || currentProcessCheckCompleted;

  let reason = null;
  if (!runtimeState.schedulerEnabled) reason = "scheduler_disabled";
  else if (!runtimeState.schedulerRunning) reason = "scheduler_not_running";
  else if (!job) reason = "monitor_job_missing";
  else if (job.status !== "enabled") reason = "monitor_job_disabled";
  else if (latestSchedulerRunFailed) reason = "monitor_job_failed";
  else if (!latestCompleted) reason = "monitor_check_pending";
  else if (!startupCheckCompleted) reason = "startup_monitor_incomplete";
  else if (!recent || scheduleOverdue) reason = "monitor_check_overdue";

  return {
    scheduler: {
      enabled: runtimeState.schedulerEnabled,
      running: runtimeState.schedulerRunning,
      pollMs: runtimeState.schedulerPollMs,
    },
    monitoring: {
      ready: reason === null,
      recent,
      overdue: Boolean(latestCompleted && (!recent || scheduleOverdue)),
      reason,
      maxAgeSeconds,
      ageSeconds,
      startup: {
        status: runtimeState.startupMonitoring.status,
        reason: runtimeState.startupMonitoring.reason || null,
        schedulerRunId: runtimeState.startupMonitoring.schedulerRunId || null,
        monitorRunId: runtimeState.startupMonitoring.monitorRunId || null,
        completedAt: runtimeState.startupMonitoring.completedAt || null,
      },
      job: job ? {
        id: job.id,
        name: job.name,
        status: job.status,
        enabled: job.status === "enabled",
        running: Boolean(job.lock_owner),
        intervalSeconds,
        lastRunAt: job.last_run_at,
        nextRunAt: job.next_run_at,
        lockedAt: job.locked_at,
        latestRun: latestSchedulerRun ? {
          id: latestSchedulerRun.id,
          status: latestSchedulerRun.status,
          startedAt: latestSchedulerRun.started_at,
          completedAt: latestSchedulerRun.completed_at,
        } : null,
      } : null,
      latestCompletedCheck: latestCompleted ? {
        id: latestCompleted.id,
        status: latestCompleted.status,
        severity: latestCompleted.severity,
        findingCount: Number(latestCompleted.finding_count || 0),
        startedAt: latestCompleted.started_at,
        completedAt: latestCompleted.completed_at,
      } : null,
    },
  };
}

function selectSafeRuntimeTickTask(db) {
  const candidates = all(
    db,
    `SELECT tasks.*
     FROM tasks
     JOIN workflows ON workflows.id = tasks.workflow_id
     WHERE tasks.status IN ('queued', 'planned')
       AND workflows.status IN ('planned', 'ready', 'agent_running', 'agent_retrying')
     ORDER BY CASE tasks.status WHEN 'queued' THEN 0 ELSE 1 END,
              tasks.priority ASC, tasks.created_at ASC, tasks.id ASC`,
  );
  const rejectedReasons = {};
  for (const task of candidates) {
    const taskReason = unsafeTaskReason(task);
    if (taskReason) {
      rejectedReasons[taskReason] = (rejectedReasons[taskReason] || 0) + 1;
      continue;
    }
    const workflowSafety = inspectSafeWorkflow(db, task.workflow_id);
    if (!workflowSafety.safe) {
      rejectedReasons[workflowSafety.reason] = (rejectedReasons[workflowSafety.reason] || 0) + 1;
      continue;
    }
    const commercialSafety = classifyCommercialTaskSafety(db, task);
    if (!commercialSafety.safe) {
      const reason = commercialSafety.code || commercialSafety.classification || "commercial_authority_required";
      rejectedReasons[reason] = (rejectedReasons[reason] || 0) + 1;
      continue;
    }
    return { task, rejectedReasons };
  }
  return { task: null, rejectedReasons };
}

function createRuntime(options = {}) {
  const preventureResearchClock = resolvePreventureResearchClock(
    options.preventureResearchClock,
  );
  const db = openDatabase(
    options.dbPath || CONFIG.dbPath,
    { clock: preventureResearchClock },
  );
  const seeded = seedDatabase(db, { includeDemoProof: options.includeDemoProof === true });
  ensureRuntimeFoundation(db);
  if (seeded) {
    insertEvent(db, {
      actor: "server",
      type: "server.seeded",
      entityType: "runtime",
      entityId: "v2",
      message: "Runtime database initialized on first server start.",
    });
  }
  return db;
}

function routeMatch(pathname, pattern) {
  const pathParts = pathname.split("/").filter(Boolean);
  const patternParts = pattern.split("/").filter(Boolean);
  if (pathParts.length !== patternParts.length) return null;
  const params = {};
  for (let index = 0; index < patternParts.length; index += 1) {
    const expected = patternParts[index];
    const actual = pathParts[index];
    if (expected.startsWith(":")) {
      params[expected.slice(1)] = actual;
    } else if (expected !== actual) {
      return null;
    }
  }
  return params;
}

function sendCommercialGuardFailure(res, assessment) {
  jsonResponse(
    res,
    Number(assessment.statusCode || 409),
    assessment.payload || commercialAuthorityErrorPayload(assessment),
  );
}

function requireCommercialTarget(db, res, target) {
  const assessment = commercialRouteGuard(db, target);
  if (assessment.allowed) return assessment;
  sendCommercialGuardFailure(res, assessment);
  return null;
}

function requireCommercialWorkflowWhenNeeded(db, res, workflowId, options = {}) {
  const safety = classifyCommercialWorkflowSafety(db, workflowId);
  if (safety.safe && !safety.requiresCommercialAuthority && !options.required) {
    return {
      allowed: true,
      code: safety.code,
      workflowSafety: safety,
    };
  }
  if (safety.safe && safety.requiresCommercialAuthority) {
    return {
      allowed: true,
      code: safety.code,
      workflowSafety: safety,
      assessment: safety.assessment,
    };
  }
  const assessment = safety.assessment || commercialRouteGuard(db, { workflowId });
  sendCommercialGuardFailure(res, assessment);
  return null;
}

function requireCommercialTaskWhenNeeded(db, res, task) {
  const safety = classifyCommercialTaskSafety(db, task);
  if (safety.safe) {
    return {
      allowed: true,
      code: safety.code,
      taskSafety: safety,
    };
  }
  const assessment = safety.assessment || commercialRouteGuard(db, { taskId: task.id });
  sendCommercialGuardFailure(res, assessment);
  return null;
}

function retireCommercialRoute(db, res, message) {
  const payload = commercialAuthorityErrorPayload({
    code: "commercial_route_retired",
    message,
    authority: getCommercialAuthorityState(db),
  });
  payload.commercialAuthority.retiredRoute = true;
  jsonResponse(res, 410, payload);
}

function rejectUnboundCommercialRoute(db, res, message) {
  jsonResponse(
    res,
    409,
    commercialAuthorityErrorPayload({
      code: "commercial_binding_required",
      message,
      authority: getCommercialAuthorityState(db),
    }),
  );
}

function isPreventureAssignmentTarget(db, target = {}) {
  if (target.taskId) {
    return Boolean(get(
      db,
      "SELECT 1 AS bound FROM preventure_research_assignments WHERE task_id = ? LIMIT 1",
      [target.taskId],
    ));
  }
  if (target.workflowId) {
    return Boolean(get(
      db,
      "SELECT 1 AS bound FROM preventure_research_assignments WHERE workflow_id = ? LIMIT 1",
      [target.workflowId],
    ));
  }
  return false;
}

function rejectGenericPreventureTarget(db, res, target = {}) {
  if (!isPreventureAssignmentTarget(db, target)) return false;
  jsonResponse(res, 409, {
    error: "This immutable bounded-research assignment can use only its dedicated exact control.",
    code: "preventure_research_dedicated_runner_required",
  });
  return true;
}

function setPreventureSchedulerStatus(db, status) {
  ensureSchedulerJobs(db);
  const current = get(
    db,
    "SELECT status FROM scheduler_jobs WHERE id = ?",
    [PREVENTURE_RESEARCH_JOB_ID],
  );
  if (!current || current.status === status) return current;
  return setSchedulerJobStatus(db, PREVENTURE_RESEARCH_JOB_ID, status);
}

function createApp(options = {}) {
  const preventureResearchClock = resolvePreventureResearchClock(
    options.preventureResearchClock,
  );
  const runtimeOptions = {
    ...options,
    preventureResearchClock,
  };
  const db = options.db || createRuntime(runtimeOptions);
  if (options.db && typeof db.function === "function") {
    db.function("pantheon_current_time", preventureResearchClock);
  }
  if (options.db) ensureRuntimeFoundation(db);
  const preventureRuntime = preventureRuntimeConfiguration(runtimeOptions, db);
  const preventureAuthorityContext = Object.freeze({
    preventureResearchClock: preventureRuntime.clock,
    preventureResearchAuthorityRegistry: preventureRuntime.authorityRegistry,
    preventureResearchRetainedOutputStore: preventureRuntime.retainedOutputStore,
  });
  const preventureResearchExecutor = (context = {}) => continuePreventureResearchFromServer(
    db,
    preventureRuntime,
    context,
  );
  let preventureInitialization = {
    status: "not_requested",
    reason: "preventure_foundation_initialization_not_requested",
  };
  if (options.initializePreventureResearch === true) {
    try {
      preventureInitialization = ensurePreventureResearchFoundation(db, preventureRuntime);
    } catch (error) {
      preventureInitialization = {
        status: "withheld",
        reason: error.code || "preventure_foundation_initialization_failed",
        message: error.message,
      };
      try {
        insertPreventureEvent(db, {
          level: "error",
          actor: "server",
          type: "preventure_research.initialization_withheld",
          entityId: preventureRuntime.authority.authorityHash,
          message: "Pantheon withheld the bounded-research controls because their exact ledger or approval state could not be verified.",
          metadata: { reason: preventureInitialization.reason },
        });
      } catch (eventError) {
        preventureInitialization.eventRecording = {
          status: "failed",
          message: String(eventError?.message || "The withheld-state event could not be recorded."),
        };
      }
    }
  }
  const instanceId = String(
    options.instanceId
      || process.env.PANTHEON_RUNTIME_INSTANCE_ID
      || process.env.JARVIS_RUNTIME_INSTANCE_ID
      || crypto.randomUUID(),
  );
  const workspaceId = crypto.createHash("sha256").update(path.resolve(CONFIG.rootDir)).digest("hex").slice(0, 20);
  const controlToken = String(
    options.controlToken
      || process.env.PANTHEON_CONTROL_TOKEN
      || process.env.JARVIS_CONTROL_TOKEN
      || crypto.randomBytes(32).toString("base64url"),
  );
  const schedulerEnabled = Boolean(options.schedulerEnabled ?? CONFIG.schedulerEnabled);
  const runtimeState = {
    startedAt: now(),
    schedulerEnabled,
    schedulerRunning: false,
    schedulerPollMs: Number(options.scheduler?.pollMs || CONFIG.schedulerPollMs),
    startupMonitoring: {
      status: schedulerEnabled ? "pending" : "disabled",
      reason: schedulerEnabled ? null : "scheduler_disabled",
    },
    preventureResearch: {
      initialization: preventureInitialization,
      execution: preventureExecutionReadinessProjection(db, preventureRuntime),
    },
  };
  const security = options.localSecurity || createLocalSecurity({
    enabled: options.security !== false,
    secret: options.sessionSecret,
    bootstrapSecret: options.bootstrapSecret,
    sessionTtlMs: options.sessionTtlMs,
  });
  bindAuthenticatedOwnerSessionAttestationIssuer(db, security);
  bindAuthenticatedOwnerBillingObservationIssuer(db, security);
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    res.setHeader("x-content-type-options", "nosniff");
    res.setHeader("referrer-policy", "no-referrer");
    res.setHeader("x-frame-options", "SAMEORIGIN");
    res.setHeader("permissions-policy", "camera=(), microphone=(), geolocation=(), payment=()");
    res.setHeader("content-security-policy", "default-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'self'; frame-src 'self'; form-action 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self' ws://127.0.0.1:* ws://localhost:*");
    try {
      try {
        security.assertRequestHost(req);
      } catch (error) {
        jsonResponse(res, 403, { error: error.message });
        return;
      }

      if (req.method === "OPTIONS") {
        jsonResponse(res, 403, { error: "Cross-origin API access is not enabled." });
        return;
      }

      if (!url.pathname.startsWith("/api/")) {
        serveStatic(req, res);
        return;
      }

      const broadcastState = () => {
        if (server.broadcastState) server.broadcastState();
      };

      if (req.method === "POST" && url.pathname === "/api/session") {
        try {
          const session = security.createSession(req, res);
          jsonResponse(res, 201, { ok: true, csrfToken: session.csrfToken, expiresAt: session.expiresAt });
        } catch (error) {
          jsonResponse(res, 401, { error: error.message });
        }
        return;
      }

      let session = null;
      if (req.method === "GET" && url.pathname === "/api/session") {
        try {
          session = security.requireSession(req);
          jsonResponse(res, 200, { ok: true, csrfToken: session.csrfToken, expiresAt: session.expiresAt });
        } catch (error) {
          jsonResponse(res, 401, { error: error.message });
        }
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/health") {
        const authenticated = Boolean(security.sessionForRequest(req));
        const liveResearch = getLiveResearchReadiness(db);
        const liveAiWorkers = getLiveAiWorkerReadiness(db);
        const monitoringReadiness = getMonitoringReadiness(db, runtimeState);
        const providerProof = get(
          db,
          `SELECT
             SUM(CASE WHEN mode = 'live' AND status = 'completed' AND provider_request_id IS NOT NULL THEN 1 ELSE 0 END) AS completed_calls,
             SUM(CASE WHEN mode = 'live' AND status IN ('failed', 'needs_attention')
                        AND outcome_status <> 'not_started'
                        AND (
                          provider_request_id IS NOT NULL
                          OR json_extract(
                            CASE WHEN json_valid(metadata) THEN metadata ELSE '{}' END,
                            '$.providerResponseReceived'
                          ) = 1
                        )
                      THEN 1 ELSE 0 END) AS failed_calls,
             SUM(CASE WHEN mode = 'live'
                        AND (
                          (status = 'completed' AND provider_request_id IS NOT NULL)
                          OR (
                            status IN ('failed', 'needs_attention')
                            AND outcome_status <> 'not_started'
                            AND (
                              provider_request_id IS NOT NULL
                              OR json_extract(
                                CASE WHEN json_valid(metadata) THEN metadata ELSE '{}' END,
                                '$.providerResponseReceived'
                              ) = 1
                            )
                          )
                        )
                      THEN 1 ELSE 0 END) AS known_calls
           FROM model_calls`,
        ) || {};
        const runtimeReady = monitoringReadiness.monitoring.ready;
        const payload = {
          alive: true,
          ok: runtimeReady,
          installationReady: null,
          recoveryReady: null,
          runtimeReady,
          readinessScope: "runtime_monitoring",
          operationsReady: runtimeReady,
          operationsReadyAliasFor: "runtimeReady",
          instanceId,
          workspaceId,
          time: now(),
          scheduler: monitoringReadiness.scheduler,
          monitoring: monitoringReadiness.monitoring,
          externalActionsMode: CONFIG.dryRun ? "locked" : "enabled",
          paidAiArmed: Boolean(process.env.OPENAI_API_KEY)
            && (
              process.env.PANTHEON_ENABLE_LIVE_MODELS === "1"
              || process.env.PANTHEON_ENABLE_LIVE_RESEARCH === "1"
              || process.env.JARVIS_ENABLE_LIVE_MODELS === "1"
              || process.env.JARVIS_ENABLE_LIVE_RESEARCH === "1"
            ),
          proofMode: CONFIG.systemProofMode === true,
          providerProof: {
            completedCalls: Number(providerProof.completed_calls || 0),
            failedCalls: Number(providerProof.failed_calls || 0),
            knownCalls: Number(providerProof.known_calls || 0),
            verifiedByPriorCall: Number(providerProof.known_calls || 0) > 0,
          },
        };
        if (authenticated || !security.enabled) {
          payload.dbPath = options.dbPath || CONFIG.dbPath;
          payload.liveResearch = liveResearch;
          payload.liveAiWorkers = liveAiWorkers;
          payload.preventureResearch = {
            ownerState: getCanonicalPreventureResearchState(db, preventureRuntime),
            runtime: preventureExecutionReadinessProjection(db, preventureRuntime),
            initialization: runtimeState.preventureResearch.initialization,
          };
        }
        jsonResponse(res, 200, payload);
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/runtime/shutdown") {
        const providedControlToken = String(
          req.headers["x-pantheon-control"] || req.headers["x-jarvis-control"] || "",
        );
        if (
          !controlToken
          || providedControlToken.length !== controlToken.length
          || !crypto.timingSafeEqual(Buffer.from(providedControlToken), Buffer.from(controlToken))
        ) {
          jsonResponse(res, 403, { error: "Runtime control token rejected." });
          return;
        }
        server.beginShutdown?.();
        jsonResponse(res, 202, { ok: true, instanceId });
        setImmediate(() => server.shutdown?.());
        return;
      }

      try {
        session = security.requireSession(req);
      } catch (error) {
        jsonResponse(res, 401, { error: error.message });
        return;
      }

      try {
        security.assertMutation(req, session);
      } catch (error) {
        jsonResponse(res, 403, { error: error.message });
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/runtime/control") {
        jsonResponse(res, 200, getRuntimeControlState(db));
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/commercial/authority") {
        jsonResponse(res, 200, {
          schema: "pantheon.commercial-authority-status.v1",
          generatedAt: now(),
          readOnly: true,
          access: {
            mode: security.enabled ? "signed_operator_session" : "local_security_disabled",
            authenticated: true,
            sessionExpiresAt: session?.expiresAt || null,
          },
          authority: getCommercialAuthorityState(db),
        });
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/preventure-research") {
        jsonResponse(res, 200, {
          ...getCanonicalPreventureResearchState(db, preventureRuntime),
          runtime: preventureExecutionReadinessProjection(db, preventureRuntime),
          initialization: runtimeState.preventureResearch.initialization,
        });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/runtime/standby") {
        const result = await returnToStandby(db);
        jsonResponse(res, 202, result);
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/runtime/stop") {
        const result = await stopPantheon(db);
        jsonResponse(res, 202, result);
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/runtime/emergency-stop") {
        const body = await readBody(req);
        if (body.confirm !== "STOP PANTHEON NOW") {
          jsonResponse(res, 400, { error: "Emergency stop needs the exact confirmation phrase." });
          return;
        }
        const result = await emergencyStopPantheon(db);
        jsonResponse(res, 202, result);
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/cockpit") {
        jsonResponse(res, 200, getCockpitState(db, {
          preventureResearchClock: preventureRuntime.clock,
          preventureResearchAuthorityRegistry: preventureRuntime.authorityRegistry,
          preventureResearchRuntime: preventureExecutionReadinessProjection(db, preventureRuntime),
        }));
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/opportunities") {
        jsonResponse(res, 200, getOpportunityState(db));
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/portfolio") {
        jsonResponse(res, 200, getPortfolioState(db));
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/portfolio/discovery") {
        rejectUnboundCommercialRoute(
          db,
          res,
          "Portfolio discovery cannot create unbound commercial work. Prepare and accept an exact v2 program first.",
        );
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/portfolio/targeted-review") {
        rejectUnboundCommercialRoute(
          db,
          res,
          "Targeted investment review cannot create unbound commercial work. Prepare and accept an exact v2 program first.",
        );
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/commercial/constitution") {
        jsonResponse(res, 200, getCommercialConstitution());
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/commercial/knowledge") {
        const query = url.searchParams.get("query") || "";
        if (!query.trim()) {
          jsonResponse(res, 400, { error: "A focused commercial knowledge query is required." });
          return;
        }
        jsonResponse(res, 200, {
          query,
          results: searchCommercialKnowledge(db, {
            query,
            domains: url.searchParams.getAll("domain"),
            classes: url.searchParams.getAll("class"),
            jurisdiction: url.searchParams.get("jurisdiction") || "Australia",
            limit: url.searchParams.get("limit") || 8,
          }),
        });
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/commercial/investment-cases") {
        jsonResponse(res, 200, { cases: listInvestmentCases(db) });
        return;
      }

      const investmentCaseDetail = routeMatch(url.pathname, "/api/commercial/investment-cases/:id");
      if (req.method === "GET" && investmentCaseDetail) {
        const result = getInvestmentCase(db, investmentCaseDetail.id);
        if (!result) notFound(res);
        else {
          jsonResponse(res, 200, {
            ...result,
            buyerIntentOption: null,
            canonicalTestContract: "pantheon.commercial-test-contract.v2",
          });
        }
        return;
      }

      const prepareBuyerIntent = routeMatch(
        url.pathname,
        "/api/commercial/investment-cases/:id/prepare-buyer-intent-test",
      );
      if (req.method === "POST" && prepareBuyerIntent) {
        retireCommercialRoute(
          db,
          res,
          "The v1 buyer-intent preparation path is retired. A validated v2 contract proposal and exact owner lifecycle decision are required.",
        );
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/commercial/service-trials") {
        jsonResponse(res, 200, getServiceTrialsState(db));
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/commercial/service-trials") {
        rejectUnboundCommercialRoute(
          db,
          res,
          "Service trials are not yet bound to the immutable commercial program ledger.",
        );
        return;
      }

      const serviceTrialApprove = routeMatch(url.pathname, "/api/commercial/service-trials/:id/approve");
      if (req.method === "POST" && serviceTrialApprove) {
        rejectUnboundCommercialRoute(
          db,
          res,
          "Service-trial approval cannot rely on client-supplied readiness flags; this trial needs an exact ledger binding.",
        );
        return;
      }

      const serviceTrialStart = routeMatch(url.pathname, "/api/commercial/service-trials/:id/start");
      if (req.method === "POST" && serviceTrialStart) {
        rejectUnboundCommercialRoute(
          db,
          res,
          "Service-trial start is blocked until the trial is bound to the accepted active commercial program.",
        );
        return;
      }

      const serviceTrialComplete = routeMatch(url.pathname, "/api/commercial/service-trials/:id/complete");
      if (req.method === "POST" && serviceTrialComplete) {
        rejectUnboundCommercialRoute(
          db,
          res,
          "Service-trial completion is blocked until the trial has an exact immutable commercial binding.",
        );
        return;
      }

      const serviceTrialDecision = routeMatch(url.pathname, "/api/commercial/service-trials/:id/decision");
      if (req.method === "POST" && serviceTrialDecision) {
        rejectUnboundCommercialRoute(
          db,
          res,
          "Service-retention decisions are blocked until the trial has an exact immutable commercial binding.",
        );
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/system/capability-assurance") {
        jsonResponse(res, 200, getCapabilityAssuranceState(db));
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/venture-kits") {
        jsonResponse(res, 200, { kits: listVentureKits(db) });
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/pantheon") {
        jsonResponse(res, 200, getPantheonSupervisorState(db));
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/journey") {
        jsonResponse(res, 200, getJourneyState(db, url.searchParams.get("id")));
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/production") {
        jsonResponse(res, 200, getProductionState(db));
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/ventures") {
        jsonResponse(res, 200, {
          ventures: all(
            db,
            `SELECT id, name, lifecycle_stage, is_active, business_model
             FROM ventures
             WHERE COALESCE(json_extract(metadata, '$.visibleInVentureSelector'), 1) <> 0
             ORDER BY is_active DESC, name ASC`,
          ),
        });
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/executive-digest") {
        jsonResponse(res, 200, { digest: getCanonicalOwnerDigest(db) });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/system/weekly-digest") {
        const digest = generateWeeklyDigest(db);
        broadcastState();
        jsonResponse(res, 200, { digest });
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/decisions") {
        jsonResponse(res, 200, getDecisionsState(db, preventureAuthorityContext));
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/tests") {
        jsonResponse(res, 200, getCommercialOwnerTestsState(db));
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/gumroad/sales") {
        retireCommercialRoute(
          db,
          res,
          "Legacy Gumroad sales rows are historical context only. Use a contract-bound verified v2 adapter receipt.",
        );
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/gumroad/import") {
        retireCommercialRoute(
          db,
          res,
          "The legacy Gumroad importer is not an authoritative v2 evidence route. Use contract-bound evidence import.",
        );
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/ai-team") {
        jsonResponse(res, 200, getAiTeamState(db));
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/agent-runs") {
        const allowedExecution = new Set(["all", "live", "model_backed", "provider_outcome_unknown", "protected_rehearsal"]);
        const allowedState = new Set(["all", "active", "history"]);
        const execution = url.searchParams.get("execution") || "all";
        const state = url.searchParams.get("state") || "all";
        const status = url.searchParams.get("status") || "all";
        const worker = url.searchParams.get("worker") || "all";
        jsonResponse(res, 200, getAgentRunsState(db, {
          execution: allowedExecution.has(execution) ? execution : "all",
          state: allowedState.has(state) ? state : "all",
          status: /^[a-z_]{1,40}$/i.test(status) ? status : "all",
          worker: /^[a-z0-9_-]{1,80}$/i.test(worker) ? worker : "all",
          limit: url.searchParams.get("limit") || 50,
        }));
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/system") {
        jsonResponse(res, 200, getSystemState(db, {
          preventureResearchClock: preventureRuntime.clock,
          preventureResearchAuthorityRegistry: preventureRuntime.authorityRegistry,
          preventureResearchRuntime: preventureExecutionReadinessProjection(db, preventureRuntime),
        }));
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/system/health") {
        jsonResponse(res, 200, getSystemState(db, {
          preventureResearchClock: preventureRuntime.clock,
          preventureResearchAuthorityRegistry: preventureRuntime.authorityRegistry,
          preventureResearchRuntime: preventureExecutionReadinessProjection(db, preventureRuntime),
        }).health);
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/system/retention/prepare-decision") {
        const result = prepareRetentionPolicyDecision(db);
        if (!result.prepared) {
          jsonResponse(res, 409, { error: result.reason, result });
          return;
        }
        broadcastState();
        jsonResponse(res, 201, {
          result,
          decisions: getDecisionsState(db, preventureAuthorityContext),
        });
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/system/audit/verify") {
        jsonResponse(res, 200, verifyAgentRunReceiptChain(db));
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/system/spend/reconcile-provider-usage") {
        const body = await readBody(req);
        const preventureAllocation = Array.isArray(body?.allocations)
          ? body.allocations.find((allocation) => (
              isPreventureAssignmentTarget(db, { taskId: allocation?.taskId })
            ))
          : null;
        if (preventureAllocation) {
          jsonResponse(res, 409, {
            error: "Pre-venture provider billing requires its dedicated authority-, assignment-, receipt-, and owner-attestation-bound reconciliation control.",
            code: "preventure_research_dedicated_reconciliation_required",
          });
          return;
        }
        const result = reconcileProviderUsageBatch(db, body || {});
        broadcastState();
        jsonResponse(res, 200, { result, system: getSystemState(db, {
          preventureResearchClock: preventureRuntime.clock,
          preventureResearchAuthorityRegistry: preventureRuntime.authorityRegistry,
          preventureResearchRuntime: preventureExecutionReadinessProjection(db, preventureRuntime),
        }) });
        return;
      }

      const testDetail = routeMatch(url.pathname, "/api/tests/:id");
      if (req.method === "GET" && testDetail) {
        jsonResponse(res, 410, {
          error: "The legacy test detail endpoint is retired. Use the read-only Tests & Results view.",
        });
        return;
      }

      const agentDetail = routeMatch(url.pathname, "/api/agents/:id");
      if (req.method === "GET" && agentDetail) {
        const result = getAgentDetail(db, agentDetail.id);
        if (!result) notFound(res);
        else jsonResponse(res, 200, result);
        return;
      }

      const agentRunDetail = routeMatch(url.pathname, "/api/agent-runs/:id");
      if (req.method === "GET" && agentRunDetail) {
        const result = getAgentRunDetail(db, agentRunDetail.id);
        if (!result) notFound(res);
        else jsonResponse(res, 200, result);
        return;
      }

      const agentRunReceipt = routeMatch(url.pathname, "/api/agent-runs/:id/receipt");
      if (req.method === "GET" && agentRunReceipt) {
        const result = latestAgentRunReceipt(db, agentRunReceipt.id);
        if (!result) notFound(res);
        else jsonResponse(res, 200, result);
        return;
      }

      const decisionDetail = routeMatch(url.pathname, "/api/decisions/:id");
      if (req.method === "GET" && decisionDetail) {
        const decisions = getDecisionsState(db, preventureAuthorityContext);
        const result = [...decisions.approvals, ...decisions.reviews, ...decisions.suggestions, ...decisions.history]
          .find((item) => item.id === decisionDetail.id);
        if (!result) notFound(res);
        else jsonResponse(res, 200, result);
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/state") {
        jsonResponse(res, 410, { error: "The unrestricted runtime feed has been retired. Use the focused cockpit sections." });
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/decision-inbox") {
        jsonResponse(res, 410, {
          error: "The legacy decision inbox is retired. Use the focused Decisions and Tests & Results views.",
        });
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/manual-market-cockpit") {
        jsonResponse(res, 410, {
          error: "The manual market cockpit is retired because its legacy rows are not authoritative buyer or cash evidence.",
        });
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/events") {
        jsonResponse(res, 200, getDashboardState(db).events);
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/agent-workbench") {
        jsonResponse(res, 200, getAgentWorkbenchState(db));
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/agent-operating-briefs") {
        jsonResponse(res, 200, getAgentOperatingBriefsState(db));
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/agent-playbooks") {
        jsonResponse(res, 200, getAgentPlaybooksState(db));
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/agent-model-readiness") {
        jsonResponse(res, 200, getAgentModelReadinessState(db));
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/agent-model-comparison-packets") {
        jsonResponse(res, 200, {
          schema: "jarvis_agent_model_comparison_packets_v1",
          packets: storedComparisonPackets(db),
        });
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/agent-pilot") {
        jsonResponse(res, 200, getPilotState(db));
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/agent-pilot/fixtures") {
        const body = await readBody(req);
        const result = createPilotFixture(db, body || {});
        broadcastState();
        jsonResponse(res, 201, { result, pilot: getPilotState(db) });
        return;
      }

      const pilotFixturePrepare = routeMatch(url.pathname, "/api/agent-pilot/fixtures/:id/prepare");
      if (req.method === "POST" && pilotFixturePrepare) {
        const body = await readBody(req);
        const result = prepareDemandValidatorPilot(db, pilotFixturePrepare.id, body || {});
        broadcastState();
        jsonResponse(res, 202, { result, pilot: getPilotState(db) });
        return;
      }

      const pilotFixtureRetry = routeMatch(url.pathname, "/api/agent-pilot/fixtures/:id/retry");
      if (req.method === "POST" && pilotFixtureRetry) {
        const body = await readBody(req);
        const result = prepareDemandValidatorPilotRetry(db, pilotFixtureRetry.id, body || {});
        broadcastState();
        jsonResponse(res, 202, { result, pilot: getPilotState(db) });
        return;
      }

      const pilotRunReview = routeMatch(url.pathname, "/api/agent-pilot/runs/:id/review");
      if (req.method === "POST" && pilotRunReview) {
        const body = await readBody(req);
        const result = reviewPilotRun(db, pilotRunReview.id, body || {});
        broadcastState();
        jsonResponse(res, 200, { result });
        return;
      }

      const modelComparisonPacket = routeMatch(url.pathname, "/api/agent-model-readiness/:id/comparison-packet");
      if (req.method === "POST" && modelComparisonPacket) {
        retireCommercialRoute(
          db,
          res,
          "Caller-defined model-comparison creation is retired because it cannot carry one exact accepted commercial contract through every new record.",
        );
        return;
      }

      const aiPilotReviewDecision = routeMatch(url.pathname, "/api/ai-pilot-review/:agentId/:decision");
      if (req.method === "POST" && aiPilotReviewDecision) {
        const body = await readBody(req);
        const result = recordAiPilotReviewDecision(
          db,
          aiPilotReviewDecision.agentId,
          aiPilotReviewDecision.decision,
          body || {},
        );
        broadcastState();
        jsonResponse(res, 200, { result });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/agent-playbooks/rehearsal-suite") {
        retireCommercialRoute(
          db,
          res,
          "Caller-defined playbook suites are retired because they could create commercial workflows and tasks without an exact accepted contract.",
        );
        return;
      }

      const agentPlaybookRehearsal = routeMatch(url.pathname, "/api/agent-playbooks/:id/rehearsal");
      if (req.method === "POST" && agentPlaybookRehearsal) {
        retireCommercialRoute(
          db,
          res,
          "Caller-defined playbook rehearsal creation is retired because it cannot preserve an exact commercial contract through every new record.",
        );
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/agent-workbench/proof-suite") {
        retireCommercialRoute(
          db,
          res,
          "Caller-defined Workbench proof suites are retired because they could create unbound commercial work.",
        );
        return;
      }
      const agentLiveComparison = routeMatch(url.pathname, "/api/agent-workbench/:id/live-comparison");
      if (req.method === "POST" && agentLiveComparison) {
        const body = await readBody(req);
        if (!requireCommercialWorkflowWhenNeeded(db, res, agentLiveComparison.id, { required: true })) return;
        const result = requestAgentWorkbenchLiveComparison(db, agentLiveComparison.id, body || {});
        broadcastState();
        jsonResponse(res, 202, { result });
        return;
      }
      const agentProofRun = routeMatch(url.pathname, "/api/agent-workbench/:id/proof-run");
      if (req.method === "POST" && agentProofRun) {
        retireCommercialRoute(
          db,
          res,
          "Caller-defined Workbench proof creation is retired because it cannot bind every new record to one exact accepted commercial contract.",
        );
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/agent-tools") {
        jsonResponse(res, 200, getAgentToolPolicyState(db));
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/agent-tool-gate") {
        jsonResponse(res, 200, getAgentToolGateState(db));
        return;
      }

      const deliverableFile = routeMatch(url.pathname, "/api/deliverables/:id/file");
      if (req.method === "GET" && deliverableFile) {
        serveDeliverableFile(db, res, deliverableFile.id);
        return;
      }
      const deliverableDownload = routeMatch(url.pathname, "/api/deliverables/:id/download");
      if (req.method === "GET" && deliverableDownload) {
        serveDeliverableFile(db, res, deliverableDownload.id, { download: true });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/monitor/run") {
        const body = await readBody(req);
        const result = runMonitorCycle(db, {
          ...(body || {}),
          ...preventureAuthorityContext,
        });
        broadcastState();
        jsonResponse(res, 200, { result });
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/scheduler") {
        const state = getDashboardState(db);
        jsonResponse(res, 200, {
          jobs: state.schedulerJobs,
          runs: state.schedulerRuns,
          metrics: state.metrics.scheduler,
        });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/system/maintenance/run-due") {
        const body = await readBody(req);
        const limit = Math.max(1, Math.min(Number(body.limit || 2), 10));
        const dueJobs = all(
          db,
          `SELECT id, kind
           FROM scheduler_jobs
           WHERE status = 'enabled'
             AND locked_at IS NULL
             AND (next_run_at IS NULL OR next_run_at <= ?)
           ORDER BY priority ASC, next_run_at ASC
           LIMIT ?`,
          [now(), limit],
        );
        const runs = [];
        for (const job of dueJobs) {
          if (job.id === PREVENTURE_RESEARCH_JOB_ID || job.kind === "preventure_research") {
            runs.push({
              id: null,
              jobId: job.id,
              status: "skipped",
              result: {
                status: "safety_blocked",
                reason: "exact_preventure_research_control_required",
                message: "Provider-capable diligence can run only through its exact authority-bound control, never generic maintenance.",
              },
            });
            continue;
          }
          if (job.kind === "pantheon_supervisor") {
            runs.push({
              id: null,
              jobId: job.id,
              status: "skipped",
              result: {
                status: "safety_blocked",
                reason: "exact_commercial_workflow_not_selected",
              },
            });
            continue;
          }
          if (job.kind === "safe_work_loop") {
            const selection = selectSafeRuntimeTickTask(db);
            if (!selection.task) {
              runs.push({
                id: null,
                jobId: job.id,
                status: "skipped",
                result: {
                  status: "idle",
                  reason: "no_safe_internal_task",
                  rejectedReasons: selection.rejectedReasons,
                },
              });
              continue;
            }
            runs.push(await runSchedulerJob(db, job.id, {
              workflowId: selection.task.workflow_id,
              maxSteps: body.maxSteps,
              preventureResearchExecutor,
              monitorOptions: preventureAuthorityContext,
            }));
            continue;
          }
          runs.push(await runSchedulerJob(db, job.id, {
            preventureResearchExecutor,
            monitorOptions: preventureAuthorityContext,
          }));
        }
        const result = {
          status: "completed",
          dueCount: dueJobs.length,
          claimedCount: runs.filter((item) => item.status !== "skipped").length,
          runs,
        };
        broadcastState();
        jsonResponse(res, 200, { result });
        return;
      }

      const schedulerJobRun = routeMatch(url.pathname, "/api/scheduler/jobs/:id/run");
      if (req.method === "POST" && schedulerJobRun) {
        const body = await readBody(req);
        const job = get(db, "SELECT id, kind FROM scheduler_jobs WHERE id = ?", [schedulerJobRun.id]);
        if (!job) {
          jsonResponse(res, 404, { error: "Scheduler job not found." });
          return;
        }
        if (job.kind === "pantheon_supervisor") {
          rejectUnboundCommercialRoute(
            db,
            res,
            "The unscoped commercial supervisor job is disabled. Use one exact contract-bound workflow.",
          );
          return;
        }
        let workflowId = body.workflowId || body.workflow_id || null;
        if (job.kind === "safe_work_loop") {
          if (workflowId) {
            if (!requireCommercialWorkflowWhenNeeded(db, res, workflowId)) return;
          } else {
            const selection = selectSafeRuntimeTickTask(db);
            if (!selection.task) {
              jsonResponse(res, 200, {
                result: {
                  status: "idle",
                  reason: "no_safe_internal_task",
                  rejectedReasons: selection.rejectedReasons,
                },
              });
              return;
            }
            workflowId = selection.task.workflow_id;
          }
        }
        const result = await runSchedulerJob(db, schedulerJobRun.id, {
          manual: true,
          force: body.force === true,
          maxSteps: body.maxSteps,
          workflowId,
          preventureResearchExecutor,
          monitorOptions: preventureAuthorityContext,
        });
        broadcastState();
        jsonResponse(res, 200, { result });
        return;
      }

      const schedulerJobAction = routeMatch(url.pathname, "/api/scheduler/jobs/:id/:action");
      if (req.method === "POST" && schedulerJobAction) {
        const actionMap = { enable: "enabled", disable: "disabled" };
        const status = actionMap[schedulerJobAction.action];
        if (!status) {
          jsonResponse(res, 400, { error: "Scheduler action must be enable or disable." });
          return;
        }
        const job = get(db, "SELECT id, kind FROM scheduler_jobs WHERE id = ?", [schedulerJobAction.id]);
        if (!job) {
          jsonResponse(res, 404, { error: "Scheduler job not found." });
          return;
        }
        if (job.kind === "pantheon_supervisor" && status === "enabled") {
          rejectUnboundCommercialRoute(
            db,
            res,
            "The unscoped commercial supervisor cannot be enabled. Commercial runs must name one exact bound workflow.",
          );
          return;
        }
        const updatedJob = setSchedulerJobStatus(db, schedulerJobAction.id, status);
        broadcastState();
        jsonResponse(res, 200, { job: updatedJob });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/commands") {
        retireCommercialRoute(
          db,
          res,
          "The generic command-to-work route is permanently retired. Use an exact accepted commercial program or a protected system proof.",
        );
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/pantheon/discovery") {
        retireCommercialRoute(
          db,
          res,
          "The unbound discovery route is permanently retired. New commercial discovery must begin inside an exact accepted program.",
        );
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/pantheon/journeys") {
        rejectUnboundCommercialRoute(
          db,
          res,
          "Broad commercial journeys cannot be created outside the one exact accepted and activated program.",
        );
        return;
      }

      const journeyContinue = routeMatch(url.pathname, "/api/pantheon/journeys/:id/continue");
      if (req.method === "POST" && journeyContinue) {
        const journey = journeyById(db, journeyContinue.id);
        if (!journey) {
          jsonResponse(res, 404, { error: "This Pantheon journey was not found." });
          return;
        }
        if (!requireCommercialWorkflowWhenNeeded(db, res, journey.workflow_id, { required: true })) return;
        if (isTerminalJourneyStatus(journey.status)) {
          const payload = commercialAuthorityErrorPayload({
            code: "commercial_program_terminal",
            message: "This commercial journey is permanently finished and cannot be continued.",
            authority: getCommercialAuthorityState(db),
          });
          payload.state = getJourneyState(db, journey.id);
          jsonResponse(res, 410, payload);
          return;
        }
        const result = await runPantheonSupervisorCycle(db, {
          triggerType: "manual",
          triggerId: journey.id,
          startedBy: "dashboard-full-journey",
          workflowId: journey.workflow_id,
          ventureId: journey.venture_id,
          maxSteps: 2,
        });
        broadcastState();
        jsonResponse(res, 200, { result, state: getJourneyState(db, journey.id) });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/pantheon/run") {
        const body = await readBody(req);
        if (body.startDiscovery === true) {
          rejectUnboundCommercialRoute(
            db,
            res,
            "Pantheon cannot start unbound discovery. Accept and activate an exact commercial program first.",
          );
          return;
        }
        const workflowId = body.workflowId || body.workflow_id || null;
        if (!workflowId) {
          jsonResponse(res, 200, {
            result: {
              status: "idle",
              reason: "exact_commercial_workflow_not_selected",
              message: "No exact accepted commercial workflow was selected, so Pantheon made no changes.",
            },
          });
          return;
        }
        if (!requireCommercialWorkflowWhenNeeded(db, res, workflowId, { required: true })) return;
        const result = await runPantheonSupervisorCycle(db, {
          triggerType: "manual",
          startedBy: "dashboard",
          maxSteps: body.maxSteps || 4,
          allowDiscoveryStart: false,
          prompt: body.prompt,
          workflowId,
        });
        broadcastState();
        jsonResponse(res, 200, { result });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/runtime/tick") {
        const selection = selectSafeRuntimeTickTask(db);
        const result = selection.task
          ? await runOnce(db, {
            taskId: selection.task.id,
            workflowId: selection.task.workflow_id,
            claimant: "runtime_tick_protected",
          })
          : {
            status: "idle",
            reason: "no_safe_internal_task",
            message: "No strictly protected internal work is ready to run.",
            rejectedReasons: selection.rejectedReasons,
          };
        broadcastState();
        jsonResponse(res, 200, { result });
        return;
      }

      const preventureAssignmentRun = routeMatch(
        url.pathname,
        "/api/preventure-research/assignments/:id/run",
      );
      if (req.method === "POST" && preventureAssignmentRun) {
        const body = assertExactRequestBody(
          await readBody(req),
          ["authorityHash", "assignmentHash", "descriptorHash", "requestBodyHash"],
          ["authorityHash", "assignmentHash", "descriptorHash", "requestBodyHash"],
        );
        const assignment = assertPreventureAssignmentBinding(
          db,
          preventureRuntime,
          preventureAssignmentRun.id,
          body,
        );
        assertPreventureHash(body.requestBodyHash, "provider request body hash");
        let readiness = preventureExecutionReadiness(preventureRuntime, {
          authorityHash: body.authorityHash,
          assignmentId: assignment.id,
          assignmentHash: assignment.assignmentHash,
        });
        if (
          readiness.descriptorHash
          && (
            readiness.descriptorHash !== body.descriptorHash
            || readiness.requestBodyHash !== body.requestBodyHash
          )
        ) {
          throw preventureApiError(
            "preventure_research_execution_scope_stale",
            "Refresh this assignment before running it; its exact local execution descriptor changed.",
          );
        }
        if (!readiness.assignmentRunReady) {
          jsonResponse(res, 503, {
            error: "The dedicated bounded-research runner is not connected. No provider call was made and no cost was incurred.",
            code: "preventure_research_runtime_not_ready",
            readiness,
          });
          return;
        }
        if (readiness.requiresPreparation) {
          await preventureRuntime.prepareAssignment({
            db,
            authority: preventureRuntime.authority,
            readinessSpec: preventureRuntime.readinessSpec,
            authorityHash: body.authorityHash,
            assignmentId: preventureAssignmentRun.id,
            expectedAssignmentHash: body.assignmentHash,
            expectedDescriptorHash: body.descriptorHash,
            expectedRequestBodyHash: body.requestBodyHash,
            actor: "owner",
            clock: preventureRuntime.clock,
          });
          assertPreventureAssignmentBinding(
            db,
            preventureRuntime,
            preventureAssignmentRun.id,
            body,
          );
          readiness = preventureExecutionReadiness(preventureRuntime, {
            authorityHash: body.authorityHash,
            assignmentId: assignment.id,
            assignmentHash: assignment.assignmentHash,
          });
          if (
            readiness.descriptorHash !== body.descriptorHash
            || readiness.requestBodyHash !== body.requestBodyHash
          ) {
            throw preventureApiError(
              "preventure_research_execution_scope_stale",
              "The exact assignment descriptor changed during local preparation. No provider call was made.",
            );
          }
          if (!readiness.providerCallReady) {
            jsonResponse(res, 503, {
              error: "The assignment could not be made locally ready. No provider call was made and no cost was incurred.",
              code: "preventure_research_preparation_not_ready",
              readiness,
            });
            return;
          }
        }
        const result = await preventureRuntime.runAssignment({
          db,
          authority: preventureRuntime.authority,
          readinessSpec: preventureRuntime.readinessSpec,
          authorityHash: body.authorityHash,
          assignmentId: preventureAssignmentRun.id,
          expectedAssignmentHash: body.assignmentHash,
          expectedDescriptorHash: body.descriptorHash,
          expectedRequestBodyHash: body.requestBodyHash,
          actor: "owner",
          clock: preventureRuntime.clock,
        });
        broadcastState();
        jsonResponse(res, 200, { result });
        return;
      }

      const preventureAssignmentReprocess = routeMatch(
        url.pathname,
        "/api/preventure-research/assignments/:id/reprocess",
      );
      if (req.method === "POST" && preventureAssignmentReprocess) {
        const body = assertExactRequestBody(
          await readBody(req),
          ["authorityHash", "assignmentHash", "descriptorHash", "retainedOutputHash"],
          ["authorityHash", "assignmentHash", "descriptorHash", "retainedOutputHash"],
        );
        const assignment = assertPreventureAssignmentBinding(
          db,
          preventureRuntime,
          preventureAssignmentReprocess.id,
          body,
        );
        assertPreventureHash(body.retainedOutputHash, "retained output hash");
        const reprocessStore = createPreventureResearchStore(
          db,
          preventureStoreOptions(preventureRuntime),
        );
        const reprocessState = reprocessStore.readState(body.authorityHash);
        if (
          !preventureRuntimeIsCandidate(preventureRuntime)
          || reprocessState.state !== "activated"
          || reprocessState.terminal === true
          || reprocessState.expired === true
        ) {
          throw preventureApiError(
            "preventure_research_terminal_custody_required",
            "Terminal or historical retained output may be preserved only through the custody/accounting path; normal evidence and decision reprocessing is closed.",
          );
        }
        const readiness = preventureExecutionReadiness(preventureRuntime, {
          authorityHash: body.authorityHash,
          assignmentId: assignment.id,
          assignmentHash: assignment.assignmentHash,
        });
        if (!readiness.canReprocess) {
          jsonResponse(res, 503, {
            error: "The exact retained output is not locally ready for deterministic reprocessing. No provider call was made and no cost was incurred.",
            code: "preventure_research_reprocess_not_ready",
            readiness,
          });
          return;
        }
        if (
          body.descriptorHash !== readiness.descriptorHash
          || body.retainedOutputHash !== readiness.retainedOutputHash
        ) {
          throw preventureApiError(
            "preventure_research_reprocess_scope_stale",
            "Refresh this recovery control; its exact retained output or execution descriptor changed.",
          );
        }
        const result = await preventureRuntime.reprocessAssignment({
          db,
          authority: preventureRuntime.authority,
          readinessSpec: preventureRuntime.readinessSpec,
          authorityHash: body.authorityHash,
          assignmentId: preventureAssignmentReprocess.id,
          expectedAssignmentHash: body.assignmentHash,
          expectedDescriptorHash: body.descriptorHash,
          retainedOutputHash: body.retainedOutputHash,
          actor: "owner",
          clock: preventureRuntime.clock,
        });
        broadcastState();
        jsonResponse(res, 200, { result });
        return;
      }

      const preventureAssignmentCustody = routeMatch(
        url.pathname,
        "/api/preventure-research/assignments/:id/recover-custody",
      );
      if (req.method === "POST" && preventureAssignmentCustody) {
        const body = assertExactRequestBody(
          await readBody(req),
          ["authorityHash", "assignmentHash", "descriptorHash", "retainedOutputHash"],
          ["authorityHash", "assignmentHash", "descriptorHash", "retainedOutputHash"],
        );
        const assignment = assertPreventureAssignmentBinding(
          db,
          preventureRuntime,
          preventureAssignmentCustody.id,
          body,
        );
        assertPreventureHash(body.retainedOutputHash, "retained output hash");
        const custodyStore = createPreventureResearchStore(
          db,
          preventureStoreOptions(preventureRuntime),
        );
        const custodyState = custodyStore.readState(body.authorityHash);
        const terminalOrEmergency = custodyState.terminal === true
          || custodyState.expired === true
          || ["revoked", "expired"].includes(custodyState.state)
          || Number(custodyState.unknownProviderOutcomeCount) > 0
          || Number(custodyState.unknownCostCount) > 0;
        if (!terminalOrEmergency) {
          throw preventureApiError(
            "preventure_research_terminal_custody_not_terminal",
            "Active retained output cannot use terminal custody; it remains eligible only for the exact normal local recovery path.",
          );
        }
        const readiness = preventureExecutionReadiness(preventureRuntime, {
          authorityHash: body.authorityHash,
          assignmentId: assignment.id,
          assignmentHash: assignment.assignmentHash,
        });
        const exactRecordedReplay = readiness.adapterStatus
          === "terminal_retained_output_custody_recorded";
        if (!readiness.canRecoverCustody && !exactRecordedReplay) {
          jsonResponse(res, 503, {
            error: "The exact terminal provider output is not locally ready for custody accounting. No provider call, evidence, decision, or retry was created.",
            code: "preventure_research_terminal_custody_not_ready",
            readiness,
          });
          return;
        }
        if (
          body.descriptorHash !== readiness.descriptorHash
          || body.retainedOutputHash !== readiness.retainedOutputHash
        ) {
          throw preventureApiError(
            "preventure_research_terminal_custody_scope_stale",
            "Refresh this custody control; its exact retained provider artifact changed.",
          );
        }
        const result = await preventureRuntime.recoverTerminalRetainedOutput({
          db,
          authority: preventureRuntime.authority,
          readinessSpec: preventureRuntime.readinessSpec,
          authorityHash: body.authorityHash,
          assignmentId: assignment.id,
          expectedAssignmentHash: assignment.assignmentHash,
          expectedDescriptorHash: body.descriptorHash,
          retainedOutputHash: body.retainedOutputHash,
          actor: "owner",
          clock: preventureRuntime.clock,
        });
        if (result?.status !== "terminal_provider_artifact_retained_pending_reconciliation") {
          throw preventureApiError(
            "preventure_research_terminal_custody_incomplete",
            "The exact retained response did not produce its required custody/accounting record.",
            500,
          );
        }
        setPreventureSchedulerStatus(db, "disabled");
        if (result.created !== false) {
          insertPreventureEvent(db, {
            level: "warn",
            actor: "owner",
            type: "preventure_research.terminal_artifact_custody_recorded",
            entityId: assignment.id,
            message: "Pantheon held the already-dispatched provider response for accounting only. It created no commercial evidence, decision, retry, or new provider call.",
            metadata: {
              authorityHash: assignment.authorityHash,
              assignmentHash: assignment.assignmentHash,
              retainedOutputHash: body.retainedOutputHash,
              terminalState: result.terminalState,
              accountingState: result.accountingState,
              additionalAiCostAudCents: 0,
            },
          });
        }
        broadcastState();
        jsonResponse(res, 200, { result });
        return;
      }

      const taskRun = routeMatch(url.pathname, "/api/tasks/:id/run");
      if (req.method === "POST" && taskRun) {
        const task = get(db, "SELECT * FROM tasks WHERE id = ?", [taskRun.id]);
        if (!task) {
          jsonResponse(res, 404, { error: "Work item not found." });
          return;
        }
        if (
          isPreventureAssignmentTarget(db, { taskId: task.id })
          || task.kind === "preventure_research"
        ) {
          jsonResponse(res, 409, {
            error: "This bounded-research assignment can run only through its dedicated exact runner.",
            code: "preventure_research_dedicated_runner_required",
          });
          return;
        }
        if (!requireCommercialTaskWhenNeeded(db, res, task)) return;
        const result = await runOnce(db, { taskId: taskRun.id, workflowId: task.workflow_id, claimant: "dashboard_exact_task" });
        const parameters = fromJson(task.payload, {}).liveSpendRequest?.parameters || {};
        const supervisorOwned = parameters.pantheonCommercial?.supervisorOwned === true
          || parameters.pantheonProduction?.supervisorOwned === true;
        const continuation = result.status === "completed" && supervisorOwned
          ? await runPantheonSupervisorCycle(db, {
            triggerType: "manual",
            triggerId: task.id,
            startedBy: "dashboard_exact_task",
            workflowId: task.workflow_id,
            maxSteps: 1,
          })
          : null;
        broadcastState();
        jsonResponse(res, 200, { result, continuation });
        return;
      }

      const taskKnownRetry = routeMatch(url.pathname, "/api/tasks/:id/prepare-known-ai-retry");
      if (req.method === "POST" && taskKnownRetry) {
        const task = get(db, "SELECT * FROM tasks WHERE id = ?", [taskKnownRetry.id]);
        if (!task) {
          jsonResponse(res, 404, { error: "Work item not found." });
          return;
        }
        if (rejectGenericPreventureTarget(db, res, { taskId: task.id })) return;
        if (!requireCommercialTaskWhenNeeded(db, res, task)) return;
        const result = prepareReviewedLiveAiWorkerRetry(db, taskKnownRetry.id, {
          proofMode: CONFIG.systemProofMode === true,
        });
        const commercial = result.task?.payload?.liveSpendRequest?.parameters?.pantheonCommercial;
        if (commercial?.supervisorOwned === true && result.approval?.id) {
          result.mandate = approveInternalWorkWithinMandate(db, result.approval.id);
        }
        broadcastState();
        jsonResponse(res, 202, { result });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/runtime/run-until-blocked") {
        retireCommercialRoute(
          db,
          res,
          "The global run-until-blocked route is permanently retired. Run one exact protected workflow instead.",
        );
        return;
      }

      const workflowRun = routeMatch(url.pathname, "/api/workflows/:id/run");
      if (req.method === "POST" && workflowRun) {
        if (rejectGenericPreventureTarget(db, res, { workflowId: workflowRun.id })) return;
        const workflow = get(db, "SELECT type FROM workflows WHERE id = ?", [workflowRun.id]);
        if (workflow?.type === "preventure_research") {
          jsonResponse(res, 409, {
            error: "This bounded-research workflow cannot use the generic workflow runner.",
            code: "preventure_research_dedicated_runner_required",
          });
          return;
        }
        if (!requireCommercialWorkflowWhenNeeded(db, res, workflowRun.id)) return;
        const result = await runOnce(db, { workflowId: workflowRun.id });
        broadcastState();
        jsonResponse(res, 200, { result });
        return;
      }

      const workflowRunUntilBlocked = routeMatch(url.pathname, "/api/workflows/:id/run-until-blocked");
      if (req.method === "POST" && workflowRunUntilBlocked) {
        const body = await readBody(req);
        if (
          rejectGenericPreventureTarget(
            db,
            res,
            { workflowId: workflowRunUntilBlocked.id },
          )
        ) return;
        const workflow = get(db, "SELECT type FROM workflows WHERE id = ?", [workflowRunUntilBlocked.id]);
        if (workflow?.type === "preventure_research") {
          jsonResponse(res, 409, {
            error: "This bounded-research workflow cannot use the generic workflow loop.",
            code: "preventure_research_dedicated_runner_required",
          });
          return;
        }
        if (!requireCommercialWorkflowWhenNeeded(db, res, workflowRunUntilBlocked.id)) return;
        const result = await runUntilBlocked(db, { workflowId: workflowRunUntilBlocked.id, maxSteps: body.maxSteps });
        broadcastState();
        jsonResponse(res, 200, { result });
        return;
      }

      const approvalPack = routeMatch(url.pathname, "/api/workflows/:id/approval-pack");
      if (req.method === "POST" && approvalPack) {
        if (rejectGenericPreventureTarget(db, res, { workflowId: approvalPack.id })) return;
        if (!requireCommercialWorkflowWhenNeeded(db, res, approvalPack.id)) return;
        const result = generateApprovalPack(db, approvalPack.id);
        broadcastState();
        jsonResponse(res, 200, { result });
        return;
      }

      const liveResearchRequest = routeMatch(url.pathname, "/api/workflows/:id/request-live-research");
      if (req.method === "POST" && liveResearchRequest) {
        const body = await readBody(req);
        if (
          rejectGenericPreventureTarget(db, res, { workflowId: liveResearchRequest.id })
        ) return;
        if (!requireCommercialWorkflowWhenNeeded(db, res, liveResearchRequest.id)) return;
        const result = requestLiveResearch(db, liveResearchRequest.id, body || {});
        broadcastState();
        jsonResponse(res, 202, { result });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/live-research/smoke-test") {
        retireCommercialRoute(
          db,
          res,
          "The caller-defined live-research smoke route is permanently retired because it could create unbound commercial work, approvals, and cost reservations.",
        );
        return;
      }

      const liveAiWorkerRequest = routeMatch(url.pathname, "/api/workflows/:id/request-live-ai-worker");
      if (req.method === "POST" && liveAiWorkerRequest) {
        const body = await readBody(req);
        if (
          rejectGenericPreventureTarget(db, res, { workflowId: liveAiWorkerRequest.id })
        ) return;
        if (!requireCommercialWorkflowWhenNeeded(db, res, liveAiWorkerRequest.id)) return;
        const result = requestLiveAiWorker(db, liveAiWorkerRequest.id, body || {});
        broadcastState();
        jsonResponse(res, 202, { result });
        return;
      }

      const productBuilderAsset = routeMatch(url.pathname, "/api/workflows/:id/product-builder/prepare-asset");
      if (req.method === "POST" && productBuilderAsset) {
        const body = await readBody(req);
        if (
          rejectGenericPreventureTarget(db, res, { workflowId: productBuilderAsset.id })
        ) return;
        if (!requireCommercialWorkflowWhenNeeded(db, res, productBuilderAsset.id)) return;
        const result = prepareProductBuilderAsset(db, productBuilderAsset.id, body || {});
        broadcastState();
        jsonResponse(res, 202, { result });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/live-ai-workers/smoke-test") {
        retireCommercialRoute(
          db,
          res,
          "The caller-defined live-AI smoke route is permanently retired because it could create unbound commercial work, approvals, and cost reservations.",
        );
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/commercial/experiments") {
        retireCommercialRoute(
          db,
          res,
          "Legacy commercial experiments cannot represent the immutable v2 offer, cohort, channel, attribution, cash, and evidence contract.",
        );
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/research-to-experiment/plans") {
        retireCommercialRoute(
          db,
          res,
          "Legacy research-to-experiment plans are retired. Research now produces a non-executable v2 contract proposal that requires a separate owner decision.",
        );
        return;
      }

      const promoteTestCandidate = routeMatch(url.pathname, "/api/research-to-experiment/candidates/:id/promote");
      if (req.method === "POST" && promoteTestCandidate) {
        retireCommercialRoute(
          db,
          res,
          "Legacy test-candidate promotion is retired. A validated immutable v2 contract and exact approval lifecycle are required.",
        );
        return;
      }

      const learningRevisionPlan = routeMatch(url.pathname, "/api/commercial/learning/:id/revision-plan");
      if (req.method === "POST" && learningRevisionPlan) {
        retireCommercialRoute(
          db,
          res,
          "Legacy learning revisions cannot mutate or replace an immutable v2 commercial test decision.",
        );
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/execution-packs") {
        retireCommercialRoute(
          db,
          res,
          "Legacy execution packs are retired because they do not preserve the immutable v2 offer, channel, attribution, and evidence binding.",
        );
        return;
      }

      const executionPackOutcome = routeMatch(url.pathname, "/api/execution-packs/:id/outcomes");
      if (req.method === "POST" && executionPackOutcome) {
        retireCommercialRoute(
          db,
          res,
          "Legacy execution-pack outcomes are not authoritative buyer or cash evidence and are permanently read-only.",
        );
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/commercial/results") {
        retireCommercialRoute(
          db,
          res,
          "Legacy commercial results are not authoritative v2 buyer, settlement, cost, attribution, or cash evidence.",
        );
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/commercial/feedback") {
        retireCommercialRoute(
          db,
          res,
          "Legacy commercial feedback writes are retired. Learning must be derived from the complete canonical v2 ledger.",
        );
        return;
      }

      const approvalAction = routeMatch(url.pathname, "/api/approval-actions/:token");
      if (approvalAction && ["GET", "POST"].includes(req.method)) {
        jsonResponse(res, 410, {
          error: "Email action links are disabled until a signed provider webhook is connected. Use Decisions in Pantheon.",
        });
        return;
      }

      const preventureLifecycleDecision = routeMatch(
        url.pathname,
        "/api/preventure-research/lifecycle-decisions/:id/:decision",
      );
      if (
        req.method === "POST"
        && url.pathname === "/api/preventure-research/provider-billing-observations"
      ) {
        const rawBody = await readBody(req);
        const store = createPreventureResearchStore(
          db,
          preventureStoreOptions(preventureRuntime),
        );
        let assignmentHash;
        let input;
        if (Object.prototype.hasOwnProperty.call(rawBody || {}, "actionKind")) {
          const body = assertExactRequestBody(
            rawBody,
            [
              "assignmentHash",
              "actionKind",
              "authorityHash",
              "assignmentTemplateHash",
              "taskId",
              "predecessor",
              "costKey",
              "taskAttemptId",
              "modelCallId",
              "agentRunReceiptId",
              "agentRunReceiptHash",
              "budgetReservationId",
              "costId",
              "clientRequestId",
              "providerRequestId",
              "providerResponseId",
              "provider",
              "providerDispatchedAt",
              "providerAccountReferenceHash",
              "billingRecordReferenceHash",
              "currency",
              "amountAudCents",
              "observedAt",
              "originalCostOccurredAt",
              "allocationBasis",
              "limitations",
            ],
            ["assignmentHash"],
          );
          ({ assignmentHash, ...input } = body);
        } else {
          const body = assertExactRequestBody(
            rawBody,
            [
              "assignmentHash",
              "amountAudCents",
              "observedAt",
              "providerAccountReference",
              "billingRecordReference",
              "confirm",
            ],
            [
              "assignmentHash",
              "observedAt",
              "providerAccountReference",
              "billingRecordReference",
              "confirm",
            ],
          );
          assignmentHash = body.assignmentHash;
          input = deriveOwnerBillingObservationInput(
            db,
            store,
            assignmentHash,
            body,
          );
        }
        let ownerSessionAttestation;
        try {
          ownerSessionAttestation = security
            .issueAuthenticatedOwnerBillingObservationAttestation(
              req,
              session,
              {
                actionKind: input.actionKind,
                authorityHash: input.authorityHash,
                assignmentHash,
                predecessorKind: input.predecessor?.kind,
                predecessorHash: input.predecessor?.hash,
                expectedPreviousReceiptHash:
                  input.predecessor?.expectedPreviousReceiptHash,
                observationIntentHash: sha256(input),
                observedAt: input.observedAt,
              },
            );
        } catch (cause) {
          throw preventureApiError(
            "preventure_owner_billing_observation_attestation_invalid",
            String(
              cause?.message
              || "This billing observation requires an authenticated local owner session.",
            ),
            403,
          );
        }
        const result = store.recordOwnerAttestedProviderBillingObservation(
          assignmentHash,
          input,
          { ownerSessionAttestation },
        );
        broadcastState();
        jsonResponse(res, 201, {
          result,
          message: "Owner-attested billing observation recorded; not provider-settled.",
        });
        return;
      }
      if (req.method === "POST" && preventureLifecycleDecision) {
        const body = assertExactRequestBody(
          await readBody(req),
          ["scopeHash", "note"],
          ["scopeHash"],
        );
        const decided = decidePreventureLifecycleFromServer(
          db,
          preventureRuntime,
          preventureLifecycleDecision.id,
          preventureLifecycleDecision.decision,
          body,
          { req, security, session },
        );
        broadcastState();
        jsonResponse(res, 200, {
          ...decided,
          preventureResearch: getCanonicalPreventureResearchState(db, preventureRuntime),
        });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/preventure-research/revoke") {
        const body = assertExactRequestBody(
          await readBody(req),
          ["authorityHash", "expectedLatestEventHash", "confirm", "note"],
          ["authorityHash", "expectedLatestEventHash", "confirm"],
        );
        const result = revokePreventureResearchFromServer(db, preventureRuntime, body);
        const terminalCustody = await recoverPendingTerminalCustodyFromServer(
          db,
          preventureRuntime,
          { actor: "owner" },
        );
        broadcastState();
        jsonResponse(res, 200, {
          result,
          terminalCustody,
          preventureResearch: getCanonicalPreventureResearchState(db, preventureRuntime),
        });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/preventure-research/finalize") {
        const body = assertExactRequestBody(
          await readBody(req),
          ["authorityHash", "evidenceSetHash", "receiptSetHash", "resultingReadinessHash"],
          ["authorityHash", "evidenceSetHash", "receiptSetHash", "resultingReadinessHash"],
        );
        assertPreventureHash(body.authorityHash, "authority hash");
        assertPreventureHash(body.evidenceSetHash, "evidence set hash");
        assertPreventureHash(body.receiptSetHash, "receipt set hash");
        assertPreventureHash(body.resultingReadinessHash, "resulting readiness hash");
        if (body.authorityHash !== preventureRuntime.authority.authorityHash) {
          throw preventureApiError(
            "preventure_research_decision_scope_changed",
            "The diligence result no longer matches the exact configured authority. Refresh before trying again.",
          );
        }
        const finalizationControl = preventureFinalizationControl(db, preventureRuntime);
        if (!finalizationControl.ready) {
          jsonResponse(res, 503, {
            error: "The retained evidence is not ready for a deterministic diligence decision. No decision was invented or sealed.",
            code: "preventure_research_decision_runtime_not_ready",
            readiness: finalizationControl,
          });
          return;
        }
        if (
          body.evidenceSetHash !== finalizationControl.evidenceSetHash
          || body.receiptSetHash !== finalizationControl.receiptSetHash
          || body.resultingReadinessHash !== finalizationControl.resultingReadinessHash
        ) {
          throw preventureApiError(
            "preventure_research_decision_scope_stale",
            "Refresh the diligence summary control; its exact retained evidence or receipt set changed.",
          );
        }
        const result = await preventureRuntime.finalizeDecision({
          db,
          authority: preventureRuntime.authority,
          readinessSpec: preventureRuntime.readinessSpec,
          authorityHash: body.authorityHash,
          expectedEvidenceSetHash: body.evidenceSetHash,
          expectedReceiptSetHash: body.receiptSetHash,
          expectedResultingReadinessHash: body.resultingReadinessHash,
          actor: "owner",
          clock: preventureRuntime.clock,
        });
        if (result?.created) {
          insertPreventureEvent(db, {
            actor: "pantheon",
            type: "preventure_research.decision_completed",
            entityId: body.authorityHash,
            message: "The bounded diligence round is complete. Its recommendation grants no build, publishing, customer-contact, account, advertising, or spending authority.",
            metadata: {
              outcome: result.decision?.outcome || null,
              decisionHash: result.decision?.decisionHash || null,
            },
          });
        }
        setPreventureSchedulerStatus(db, "disabled");
        broadcastState();
        jsonResponse(res, 200, {
          result,
          preventureResearch: getCanonicalPreventureResearchState(db, preventureRuntime),
        });
        return;
      }

      const commercialLifecycleDecision = routeMatch(
        url.pathname,
        "/api/commercial/lifecycle-decisions/:id/:decision",
      );
      if (req.method === "POST" && commercialLifecycleDecision) {
        const body = await readBody(req);
        const result = decideCommercialLifecycleApproval(
          db,
          commercialLifecycleDecision.id,
          commercialLifecycleDecision.decision,
          body.note || "",
          {
            expectedScopeHash: body.scopeHash,
            actor: "operator",
          },
        );
        broadcastState();
        jsonResponse(res, 200, {
          result,
          tests: getCommercialOwnerTestsState(db),
        });
        return;
      }

      const approvalDecision = routeMatch(url.pathname, "/api/approvals/:id/:decision");
      if (req.method === "POST" && approvalDecision) {
        const body = await readBody(req);
        const decisionMap = {
          approve: "approved",
          reject: "rejected",
          changes: "needs_changes",
        };
        const decision = decisionMap[approvalDecision.decision];
        if (!decision) {
          jsonResponse(res, 400, { error: "Decision must be approve, reject, or changes." });
          return;
        }
        if (!body.scopeHash) {
          jsonResponse(res, 409, { error: "Refresh this decision before acting; its approval scope is missing." });
          return;
        }
        const approvalRecord = get(
          db,
          "SELECT * FROM approvals WHERE id = ?",
          [approvalDecision.id],
        );
        if (approvalRecord && hasPreventureLifecycleApprovalPayload(approvalRecord, {
          db,
          authority: preventureRuntime.authority,
          storeOptions: {
            authorityRegistry: preventureRuntime.authorityRegistry,
            clock: preventureRuntime.clock,
          },
        })) {
          jsonResponse(res, 409, {
            code: "preventure_research_lifecycle_decision_required",
            error: "Use the exact bounded-research lifecycle control for this decision.",
          });
          return;
        }
        if (approvalRecord && hasCommercialLifecycleApprovalPayload(approvalRecord)) {
          jsonResponse(res, 409, {
            code: "commercial_lifecycle_decision_required",
            error: "Use the exact commercial lifecycle decision control for this test.",
          });
          return;
        }
        const approvalTask = get(
          db,
          `SELECT tasks.*
           FROM tasks
           WHERE tasks.approval_id = ?
           ORDER BY tasks.created_at DESC
           LIMIT 1`,
          [approvalDecision.id],
        );
        if (approvalTask && !requireCommercialTaskWhenNeeded(db, res, approvalTask)) return;
        let result;
        try {
          result = decideApproval(db, approvalDecision.id, decision, body.note || "", { expectedScopeHash: body.scopeHash });
        } catch (error) {
          const refreshed = refreshOutdatedLiveAiWorkerApproval(db, approvalDecision.id, {
            trigger: "dashboard-policy-refresh",
          });
          if (refreshed?.refreshed) {
            broadcastState();
            jsonResponse(res, 409, {
              code: "approval_refreshed",
              error: "The AI check details changed before work began, so Pantheon prepared a fresh decision. Nothing ran and there was no cost. Review the updated details, then choose whether to start it.",
              result: refreshed,
            });
            return;
          }
          throw error;
        }
        const execution = decision === "approved" && result.changed && result.approvedTaskIds?.length
          ? await runOnce(db, { taskId: result.approvedTaskIds[0], claimant: "dashboard_approval" })
          : null;
        const approvedTask = result.approvedTaskIds?.length
          ? get(db, "SELECT payload, workflow_id, venture_id FROM tasks WHERE id = ?", [result.approvedTaskIds[0]])
          : null;
        const approvedPayload = fromJson(approvedTask?.payload, {});
        const isPantheonWork = Boolean(
          approvedPayload.liveSpendRequest?.parameters?.pantheonCommercial
          || approvedPayload.liveSpendRequest?.parameters?.pantheonProduction,
        );
        const pantheonContinuation = decision === "approved"
          && execution
          && isPantheonWork
          ? await runPantheonSupervisorCycle(db, {
            triggerType: "operator_approval",
            triggerId: approvalDecision.id,
            startedBy: "dashboard",
            workflowId: approvedTask.workflow_id,
            ventureId: approvedTask.venture_id,
            maxSteps: 10,
          })
          : null;
        const recovery = decision === "approved" && execution?.status === "completed"
          ? recoverSetupBlockedTasks(db)
          : null;
        broadcastState();
        jsonResponse(res, 200, { result, execution, pantheonContinuation, recovery });
        return;
      }

      const handoffDecision = routeMatch(url.pathname, "/api/agent-handoffs/:id/:decision");
      if (req.method === "POST" && handoffDecision) {
        const body = await readBody(req);
        const decisionMap = {
          approve: "approve",
          reject: "reject",
          changes: "changes",
        };
        const decision = decisionMap[handoffDecision.decision];
        if (!decision) {
          jsonResponse(res, 400, { error: "Decision must be approve, reject, or changes." });
          return;
        }
        const existingHandoff = getAgentHandoff(db, handoffDecision.id);
        if (!existingHandoff) {
          jsonResponse(res, 404, { error: "Worker handoff not found." });
          return;
        }
        const handoffWorkflowSafety = existingHandoff.workflow_id
          ? classifyCommercialWorkflowSafety(db, existingHandoff.workflow_id)
          : null;
        if (decision === "approve" && handoffWorkflowSafety) {
          const authorizedCommercial = Boolean(
            handoffWorkflowSafety.safe
            && handoffWorkflowSafety.requiresCommercialAuthority
            && handoffWorkflowSafety.classification === "authorized_commercial",
          );
          const allowedNonCommercial = Boolean(
            handoffWorkflowSafety.safe
            && !handoffWorkflowSafety.requiresCommercialAuthority
            && ["non_commercial", "diagnostic"].includes(
              handoffWorkflowSafety.classification,
            ),
          );
          if (!authorizedCommercial && !allowedNonCommercial) {
            const assessment = handoffWorkflowSafety.assessment
              || handoffWorkflowSafety;
            sendCommercialGuardFailure(res, assessment);
            return;
          }
        }
        if (decision === "approve" && existingHandoff.task_id) {
          const handoffTaskSafety = classifyCommercialTaskSafety(
            db,
            existingHandoff.task_id,
          );
          const authorizedCommercialTask = Boolean(
            handoffTaskSafety.safe
            && handoffTaskSafety.requiresCommercialAuthority
            && handoffTaskSafety.classification === "authorized_commercial",
          );
          const allowedNonCommercialTask = Boolean(
            handoffTaskSafety.safe
            && !handoffTaskSafety.requiresCommercialAuthority
            && ["non_commercial", "diagnostic"].includes(
              handoffTaskSafety.classification,
            ),
          );
          if (!authorizedCommercialTask && !allowedNonCommercialTask) {
            const assessment = handoffTaskSafety.assessment
              || handoffTaskSafety;
            sendCommercialGuardFailure(res, assessment);
            return;
          }
        }
        const pantheonAction = existingHandoff?.metadata?.pantheonProduction?.action || null;
        const result = decideAgentHandoff(db, handoffDecision.id, decision, body.note || "", {
          decidedBy: body.decidedBy || "operator",
          skipFollowupTask: Boolean(pantheonAction),
        });
        const pantheonDecision = pantheonAction
          ? applyPantheonHandoffDecision(db, result.handoff, decision, body.note || "")
          : null;
        const execution = decision === "approve" && result.followupTask?.id
          ? await runOnce(db, { taskId: result.followupTask.id, claimant: "dashboard_handoff_approval" })
          : null;
        broadcastState();
        jsonResponse(res, 200, { result, pantheonDecision, execution });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/inbound/approval-reply") {
        jsonResponse(res, 410, {
          error: "Inbound email decisions are disabled until sender authenticity and signed webhook delivery are available.",
        });
        return;
      }

      const messageResolve = routeMatch(url.pathname, "/api/messages/:id/resolve");
      if (req.method === "POST" && messageResolve) {
        const message = get(db, "SELECT * FROM messages WHERE id = ?", [messageResolve.id]);
        if (!message) {
          jsonResponse(res, 404, { error: "Message not found" });
          return;
        }
        run(db, "UPDATE messages SET status = 'resolved', resolved_at = ? WHERE id = ?", [now(), messageResolve.id]);
        insertEvent(db, {
          actor: "operator",
          type: "message.resolved",
          entityType: "message",
          entityId: messageResolve.id,
          message: `Operator resolved message ${messageResolve.id}.`,
        });
        broadcastState();
        jsonResponse(res, 200, { ok: true });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/integrations/check") {
        const result = refreshIntegrationHealth(db);
        const recovery = recoverSetupBlockedTasks(db);
        insertEvent(db, {
          actor: "runtime",
          type: "integrations.checked",
          entityType: "integration",
          entityId: "all",
          message: "Integration health statuses refreshed from environment configuration.",
          metadata: { result, recovery },
        });
        broadcastState();
        jsonResponse(res, 200, { result: { integrations: result, recovery } });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/live-action-request") {
        jsonResponse(res, 410, { error: "Generic live actions are not supported. Start the exact approved business action instead." });
        return;
      }

      notFound(res);
    } catch (error) {
      if (
        !error.statusCode
        && /^preventure_research_/.test(String(error.code || ""))
        && !/(?:ledger_invalid|ledger_integrity|store_invalid|clock_invalid)/.test(String(error.code))
      ) {
        error.statusCode = 409;
      }
      if (Number(error.statusCode) >= 400 && Number(error.statusCode) < 500) {
        if (error.assessment) {
          jsonResponse(
            res,
            Number(error.statusCode),
            commercialAuthorityErrorPayload(error),
          );
          return;
        }
        jsonResponse(res, Number(error.statusCode), {
          error: error.message,
          ...(error.code ? { code: error.code } : {}),
        });
        return;
      }
      const requestId = crypto.randomUUID();
      insertEvent(db, {
        level: "error",
        actor: "server",
        type: "server.error",
        entityType: "request",
        entityId: requestId,
        message: error.message,
        metadata: { path: url.pathname },
      });
      jsonResponse(res, 500, { error: "Pantheon could not complete that request. Check System activity for the recorded error.", requestId });
    }
  });

  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  server.keepAliveTimeout = 5_000;
  server.maxHeadersCount = 100;

  const wss = new WebSocketServer({ noServer: true });
  wss.on("error", (error) => {
    insertEvent(db, {
      level: "error",
      actor: "server",
      type: "websocket.error",
      entityType: "websocket",
      entityId: "dashboard",
      message: error.message,
    });
  });
  server.broadcastState = () => {
    const payload = JSON.stringify({
      type: "invalidate",
      sections: ["cockpit", "opportunities", "decisions", "tests", "ai-team", "system"],
      at: now(),
    });
    for (const client of wss.clients) {
      if (client.readyState === client.OPEN) client.send(payload);
    }
  };
  wss.on("connection", (socket) => {
    socket.send(JSON.stringify({ type: "connected", at: now() }));
  });
  server.on("upgrade", (req, socket, head) => {
    try {
      security.assertWebSocket(req);
      wss.handleUpgrade(req, socket, head, (client) => wss.emit("connection", client, req));
    } catch {
      socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      socket.destroy();
    }
  });

  let shutdownPromise = null;
  server.beginShutdown = () => {
    server.schedulerLoop?.stop?.();
    runtimeState.schedulerRunning = false;
    runtimeState.shuttingDown = true;
  };
  server.shutdown = () => {
    if (shutdownPromise) return shutdownPromise;
    server.beginShutdown();
    shutdownPromise = (async () => {
      await server.schedulerLoop?.drain?.();
      for (const client of wss.clients) client.terminate();
      await new Promise((resolve) => {
        const finish = () => {
          if (!options.db) db.close();
          resolve();
        };
        wss.close(() => {
          if (server.listening) server.close(finish);
          else finish();
        });
      });
    })();
    return shutdownPromise;
  };

  server.runtimeState = runtimeState;
  return {
    server,
    db,
    wss,
    security,
    instanceId,
    workspaceId,
    runtimeState,
    preventureResearchExecutor,
    preventureResearchMonitorOptions: preventureAuthorityContext,
  };
}

function startServer(options = {}) {
  const app = createApp({
    ...options,
    initializePreventureResearch: options.initializePreventureResearch
      ?? !options.db,
  });
  const port = options.port ?? CONFIG.port;
  return new Promise((resolve, reject) => {
    const onError = (error) => reject(error);
    app.server.once("error", onError);
    app.server.listen(port, "127.0.0.1", async () => {
      app.server.off("error", onError);
      const address = app.server.address();
      const url = `http://127.0.0.1:${address.port}`;
      let schedulerLoop = null;
      if (app.runtimeState.schedulerEnabled) {
        try {
          schedulerLoop = startSchedulerLoop(app.db, {
            ...(options.scheduler || {}),
            preventureResearchExecutor: app.preventureResearchExecutor,
            monitorOptions: app.preventureResearchMonitorOptions,
          });
          app.runtimeState.schedulerRunning = true;
          app.runtimeState.schedulerPollMs = schedulerLoop.pollMs;
        } catch (error) {
          app.runtimeState.schedulerRunning = false;
          console.error(`Pantheon scheduler could not start: ${error.message}`);
        }
      }
      app.server.schedulerLoop = schedulerLoop;
      console.log(`Pantheon Control running at ${url}`);
      if (schedulerLoop) console.log(`Pantheon scheduler polling every ${schedulerLoop.pollMs}ms`);

      if (app.runtimeState.schedulerEnabled) {
        const monitorJob = get(app.db, "SELECT status FROM scheduler_jobs WHERE id = ?", [MONITOR_JOB_ID]);
        if (!monitorJob || monitorJob.status !== "enabled") {
          app.runtimeState.startupMonitoring = {
            status: "disabled",
            reason: monitorJob ? "monitor_job_disabled" : "monitor_job_missing",
            completedAt: now(),
          };
          console.error("Pantheon independent monitoring is disabled; operations readiness is not satisfied.");
        } else {
          app.runtimeState.startupMonitoring = { status: "running", reason: null };
          try {
            const startupRun = await runSchedulerJob(app.db, MONITOR_JOB_ID, {
              manual: true,
              actor: "server-startup",
              monitorOptions: app.preventureResearchMonitorOptions,
            });
            app.runtimeState.startupMonitoring = {
              status: startupRun.status,
              reason: startupRun.status === "completed"
                ? null
                : startupRun.result?.reason || startupRun.error || "monitor_startup_failed",
              schedulerRunId: startupRun.id || null,
              monitorRunId: startupRun.result?.monitorRunId || null,
              completedAt: now(),
            };
            if (startupRun.status === "completed") {
              console.log("Pantheon startup monitor cycle completed.");
            } else {
              console.error(`Pantheon startup monitor did not complete: ${app.runtimeState.startupMonitoring.reason}`);
            }
          } catch (error) {
            app.runtimeState.startupMonitoring = {
              status: "failed",
              reason: "monitor_startup_failed",
              completedAt: now(),
            };
            console.error(`Pantheon startup monitor failed: ${error.message}`);
          }
        }
      }
      resolve({ ...app, url, schedulerLoop });
    });
  });
}

if (require.main === module) {
  const bootstrapSecret = process.env.PANTHEON_OPERATOR_BOOTSTRAP
    || process.env.JARVIS_OPERATOR_BOOTSTRAP
    || crypto.randomBytes(32).toString("base64url");
  process.env.PANTHEON_OPERATOR_BOOTSTRAP = bootstrapSecret;
  process.env.JARVIS_OPERATOR_BOOTSTRAP = bootstrapSecret;
  startServer({ bootstrapSecret }).then(({ url }) => {
    console.log(`Open ${url}/#bootstrap=${bootstrapSecret}`);
  }).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = {
  createApp,
  createRuntime,
  ensurePreventureResearchFoundation,
  startServer,
};
