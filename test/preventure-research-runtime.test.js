"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const authority = require("../config/preventure-research-authority-smm-scope-guard-v1");
const readinessSpec = require("../config/commercial-readiness-social-media-manager-scope-guard-v1");
const { sha256 } = require("../src/runtime/commercial-test-contract");
const { openDatabase, seedDatabase } = require("../src/db");
const {
  OFFICIAL_OPENAI_RESPONSES_URL,
} = require("../src/adapters/openai-egress-policy");
const {
  createPreventureLifecycleEvent,
  lifecycleState,
} = require("../src/runtime/preventure-research-contract");
const {
  advancePreventureResearchLifecycle,
  assertPreventureResearchDispatchAuthority,
  preventureLifecycleApprovalScope,
  preventureLifecycleApprovalScopeHash,
  registerPreventureResearchProposal,
  terminatePreventureResearchAuthority,
} = require("../src/runtime/preventure-research-authority");
const {
  createPreventureLifecycleApproval,
  decidePreventureLifecycleApproval,
  hasPreventureLifecycleApprovalPayload,
} = require("../src/runtime/preventure-research-lifecycle-decision");
const {
  createPreventureResearchStore,
} = require("../src/runtime/preventure-research-store");
const {
  createPreventureResearchAssignmentPlan,
  materializePreventureResearchAssignments,
} = require("../src/runtime/preventure-research-materializer");
const {
  evaluatePreventureResearchReadiness,
} = require("../src/runtime/preventure-research-readiness");
const {
  getPreventureResearchOwnerState,
} = require("../src/runtime/preventure-research-owner-state");
const {
  EXACT_CLAIM_KIND,
  EXACT_LOCAL_PARSER_KIND,
  EXACT_OUTPUT_STORE_KIND,
  EXACT_TRANSPORT_KIND,
  createPreventureResearchExecutionDescriptor,
  reprocessRetainedPreventureOutput,
  resolvePreventureResearchExecutionDescriptor,
  runPreventureResearchAssignment,
  validatePreventureResearchExecutionDescriptor,
} = require("../src/runtime/preventure-research-runner");
const {
  PREVENTURE_OFFICIAL_RESPONSES_ENDPOINT_HASH,
  createPreventureResearchTerminalStop,
} = require("../src/runtime/preventure-research-terminal-stop");
const {
  derivePreventureResearchSourceIdentity,
} = require("../src/runtime/preventure-research-source-identity");
const {
  historicalV1TestRegistry,
} = require("./support/preventure-research-test-registry");
const {
  issueAuthenticatedOwnerSessionAttestationForTest,
} = require("./support/authenticated-owner-session-attestation");

function fakeStore(clock = () => "2026-08-02T12:00:00+10:00") {
  const authorities = new Map();
  const lifecycle = new Map();
  const assignments = new Map();
  const costs = [];
  const sources = [];
  const evidence = [];

  function assignmentRows(authorityHash) {
    return [...assignments.values()].filter((item) => item.authorityHash === authorityHash);
  }

  function latestCosts(authorityHash) {
    const hashes = new Set(assignmentRows(authorityHash).map((item) => item.assignmentHash));
    const latest = new Map();
    for (const event of costs.filter((item) => hashes.has(item.assignmentHash))) {
      const prior = latest.get(event.costKey);
      if (!prior || event.sequence > prior.sequence) latest.set(event.costKey, event);
    }
    return [...latest.values()];
  }

  const store = {
    registerAuthority(value) {
      const current = authorities.get(value.authorityHash);
      if (current && sha256(current) !== sha256(value)) throw new Error("Authority conflict");
      authorities.set(value.authorityHash, value);
      if (!lifecycle.has(value.authorityHash)) lifecycle.set(value.authorityHash, []);
      return { created: !current, authority: value };
    },
    getAuthority(authorityHash) {
      return authorities.get(authorityHash) || null;
    },
    listAuthorities() {
      return [...authorities.values()];
    },
    loadLifecycle(authorityHash) {
      return [...(lifecycle.get(authorityHash) || [])];
    },
    appendLifecycle(authorityHash, input) {
      const value = authorities.get(authorityHash);
      const prior = store.loadLifecycle(authorityHash);
      const event = createPreventureLifecycleEvent(value, prior, {
        ...input,
        approvalScopeHash: input.approvalScope ? sha256(input.approvalScope) : null,
      });
      lifecycle.set(authorityHash, [...prior, event]);
      return { created: true, event };
    },
    createAssignment(authorityHash, assignmentId, input) {
      const key = `${authorityHash}:${assignmentId}`;
      const current = assignments.get(key);
      if (current) return { created: false, assignment: current };
      const value = authorities.get(authorityHash);
      const template = value.assignments.find((item) => item.id === assignmentId);
      const body = {
        schema: "pantheon.preventure-research-assignment.v1",
        id: template.id,
        version: template.version,
        authorityHash,
        activationEventHash: input.activationEventHash,
        templateHash: sha256(template),
        workflowId: input.workflowId,
        taskId: input.taskId,
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
        deadlineMs: template.deadlineMs,
        worstCaseExposure: template.worstCaseExposure,
        expiresAt: value.expiresAt,
        assignedAt: input.assignedAt,
      };
      const assignment = { ...body, assignmentHash: sha256(body) };
      assignments.set(key, assignment);
      return { created: true, assignment };
    },
    getAssignment(authorityHash, assignmentId) {
      return assignments.get(`${authorityHash}:${assignmentId}`) || null;
    },
    listAssignments(authorityHash) {
      return assignmentRows(authorityHash);
    },
    appendCostEvent(assignmentHash, input) {
      const prior = costs.filter((item) => (
        item.assignmentHash === assignmentHash && item.costKey === input.costKey
      ));
      const body = {
        ...input,
        assignmentHash,
        sequence: prior.length + 1,
        occurredAt: input.occurredAt || clock(),
      };
      const costEvent = { ...body, costEventHash: sha256(body) };
      costs.push(costEvent);
      return { created: true, costEvent };
    },
    recordSourceSnapshot(assignmentHash, input) {
      const body = { ...input, assignmentHash };
      const sourceSnapshot = { ...body, sourceSnapshotHash: sha256(body) };
      sources.push(sourceSnapshot);
      return { created: true, sourceSnapshot };
    },
    recordEvidence(assignmentHash, input) {
      const body = { ...input, assignmentHash };
      const record = { ...body, evidenceHash: sha256(body) };
      evidence.push(record);
      return { created: true, evidence: record };
    },
    withAtomicEvidenceBatch(operation) {
      return operation({
        recordSourceSnapshot: store.recordSourceSnapshot,
        recordEvidence: store.recordEvidence,
      });
    },
    readState(authorityHash) {
      const value = authorities.get(authorityHash);
      const events = store.loadLifecycle(authorityHash);
      const state = lifecycleState(events);
      const terminal = ["completed", "expired", "revised", "revoked", "superseded"].includes(state);
      const expired = Date.parse(clock()) >= Date.parse(value.expiresAt);
      const latest = latestCosts(authorityHash);
      const unknownCostCount = latest.filter((item) => item.eventType === "unknown").length;
      return {
        authorityHash,
        state,
        terminal,
        expired,
        dispatchAllowed: state === "activated" && !terminal && !expired && unknownCostCount === 0,
        decisionHash: null,
        assignmentCount: assignmentRows(authorityHash).length,
        unknownProviderOutcomeCount: unknownCostCount,
        unknownCostCount,
      };
    },
    readLedger(authorityHash) {
      const hashes = new Set(assignmentRows(authorityHash).map((item) => item.assignmentHash));
      return {
        authority: authorities.get(authorityHash),
        lifecycle: store.loadLifecycle(authorityHash),
        assignments: assignmentRows(authorityHash),
        costEvents: costs.filter((item) => hashes.has(item.assignmentHash)),
        sourceSnapshots: sources.filter((item) => hashes.has(item.assignmentHash)),
        evidenceRecords: evidence.filter((item) => hashes.has(item.assignmentHash)),
        executionEvidence: {
          taskAttempts: [],
          modelCalls: [],
          agentRunReceipts: [],
        },
        terminalRecoveries: [],
        decision: null,
        state: store.readState(authorityHash).state,
      };
    },
    verifyLedger() {
      return {
        ok: true,
        authorities: authorities.size,
        lifecycleEvents: [...lifecycle.values()].reduce((sum, items) => sum + items.length, 0),
        assignments: assignments.size,
        costEvents: costs.length,
        sourceSnapshots: sources.length,
        evidenceRecords: evidence.length,
        decisions: 0,
      };
    },
  };
  return store;
}

function exactApproval(eventType, overrides = {}) {
  const scope = preventureLifecycleApprovalScope(authority, eventType);
  return {
    id: `approval_preventure_${eventType}`,
    status: "approved",
    scope,
    scopeHash: preventureLifecycleApprovalScopeHash(authority, eventType),
    expiresAt: "2026-08-02T18:00:00+10:00",
    consumedAt: null,
    ...overrides,
  };
}

function activatedStore(clock) {
  const store = fakeStore(clock);
  registerPreventureResearchProposal(store, authority, readinessSpec, {
    occurredAt: "2026-08-02T12:00:00+10:00",
  });
  advancePreventureResearchLifecycle(store, authority.authorityHash, "accepted", exactApproval("accepted"), {
    occurredAt: "2026-08-02T12:01:00+10:00",
  });
  advancePreventureResearchLifecycle(store, authority.authorityHash, "activated", exactApproval("activated"), {
    occurredAt: "2026-08-02T12:02:00+10:00",
  });
  return store;
}

test("proposal, acceptance, and activation remain separate exact owner controls", () => {
  const store = fakeStore();
  const proposal = registerPreventureResearchProposal(store, authority, readinessSpec, {
    occurredAt: "2026-08-02T12:00:00+10:00",
  });
  assert.equal(proposal.event.eventType, "proposed");
  assert.notEqual(
    proposal.acceptanceScopeHash,
    preventureLifecycleApprovalScopeHash(authority, "activated"),
  );
  assert.equal(store.listAssignments(authority.authorityHash).length, 0);
  assert.equal(store.readLedger(authority.authorityHash).costEvents.length, 0);

  assert.throws(
    () => advancePreventureResearchLifecycle(
      store,
      authority.authorityHash,
      "accepted",
      exactApproval("accepted", { scope: preventureLifecycleApprovalScope(authority, "activated") }),
      { occurredAt: "2026-08-02T12:01:00+10:00" },
    ),
    /scope changed/i,
  );
  const accepted = advancePreventureResearchLifecycle(
    store,
    authority.authorityHash,
    "accepted",
    exactApproval("accepted"),
    { occurredAt: "2026-08-02T12:01:00+10:00" },
  );
  assert.equal(accepted.state.state, "accepted");
  assert.equal(accepted.activationScope.eventType, "activated");

  assert.throws(
    () => advancePreventureResearchLifecycle(
      store,
      authority.authorityHash,
      "activated",
      exactApproval("activated", { id: "approval_preventure_accepted" }),
      { occurredAt: "2026-08-02T12:02:00+10:00" },
    ),
    /single-use|distinct|approval/i,
  );
  const active = advancePreventureResearchLifecycle(
    store,
    authority.authorityHash,
    "activated",
    exactApproval("activated"),
    { occurredAt: "2026-08-02T12:02:00+10:00" },
  );
  assert.equal(active.state.dispatchAllowed, true);
  assert.equal(active.event.metadata.buildAuthorized, false);
  assert.equal(active.event.metadata.commercialTestAuthorized, false);
  assert.equal(active.event.metadata.externalActionAuthorized, false);
});

test("materialization creates only the three accepted assignments and cannot spend spare authority capacity", () => {
  const store = activatedStore();
  const result = materializePreventureResearchAssignments(store, authority.authorityHash, {
    expectedAuthorityHash: authority.authorityHash,
    assignedAt: "2026-08-02T12:03:00+10:00",
  });
  assert.equal(result.assignments.length, 3);
  assert.equal(result.plan.totalAssignedCostAudCents, 150);
  assert.equal(result.plan.unusedAuthorityCapacityAudCents, 50);
  assert.equal(result.plan.buildAuthorized, false);
  assert.equal(result.plan.commercialTestAuthorized, false);
  assert.equal(result.plan.externalActionAuthorized, false);
  assert.deepEqual(
    result.assignments.map((item) => item.id).sort(),
    authority.assignments.map((item) => item.id).sort(),
  );
  const replay = materializePreventureResearchAssignments(store, authority.authorityHash, {
    expectedAuthorityHash: authority.authorityHash,
    assignedAt: "2026-08-02T12:04:00+10:00",
  });
  assert.equal(replay.created, false);
  assert.equal(store.listAssignments(authority.authorityHash).length, 3);
  const readiness = evaluatePreventureResearchReadiness(
    store.readLedger(authority.authorityHash),
    store.readState(authority.authorityHash),
  );
  assert.equal(readiness.canSealDecision, false);
  assert.equal(readiness.execution.completed, 0);
  assert.equal(readiness.execution.dispatchableAssignmentCount, 3);
  assert.match(readiness.completionBlockers.join(" "), /known terminal immutable receipt/i);
  assert.throws(
    () => materializePreventureResearchAssignments(store, authority.authorityHash, {
      expectedAuthorityHash: sha256({ stale: true }),
      assignedAt: "2026-08-02T12:05:00+10:00",
    }),
    /refresh/i,
  );
});

test("schema-27 lifecycle consumes real exact approvals and atomically materializes isolated work", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "pantheon-preventure-runtime-"));
  let clockValue = "2026-08-02T12:00:00+10:00";
  const clock = () => clockValue;
  const db = openDatabase(path.join(directory, "runtime.sqlite"), { clock });
  t.after(() => {
    db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  seedDatabase(db);
  const storeOptions = { clock, authorityRegistry: historicalV1TestRegistry };
  const store = createPreventureResearchStore(db, storeOptions);
  registerPreventureResearchProposal(store, authority, readinessSpec, {
    occurredAt: clockValue,
  });

  clockValue = "2026-08-02T12:00:30+10:00";
  const acceptance = createPreventureLifecycleApproval(
    db,
    authority.authorityHash,
    "accepted",
    { requestedAt: clockValue, storeOptions },
  );
  assert.equal(acceptance.created, true);
  assert.equal(hasPreventureLifecycleApprovalPayload(acceptance.approval), true);
  assert.deepEqual(JSON.parse(acceptance.approval.scope), acceptance.scope);

  clockValue = "2026-08-02T12:01:00+10:00";
  const acceptanceNote = "Daniel accepted the exact bounded questions and A$2/A$0 limits.";
  const accepted = decidePreventureLifecycleApproval(
    db,
    acceptance.approval.id,
    "approve",
    acceptanceNote,
    {
      expectedScopeHash: acceptance.scopeHash,
      decidedAt: clockValue,
      ownerSessionAttestation: issueAuthenticatedOwnerSessionAttestationForTest({
        db,
        approvalId: acceptance.approval.id,
        decidedAt: clockValue,
        decision: "approve",
        note: acceptanceNote,
        expectedScopeHash: acceptance.scopeHash,
      }),
      storeOptions,
    },
  );
  assert.equal(accepted.lifecycleStatus, "accepted");
  assert.equal(
    db.prepare("SELECT consumed_at FROM approvals WHERE id = ?").get(acceptance.approval.id).consumed_at,
    clockValue,
  );

  clockValue = "2026-08-02T12:01:30+10:00";
  const activation = createPreventureLifecycleApproval(
    db,
    authority.authorityHash,
    "activated",
    { requestedAt: clockValue, storeOptions },
  );
  assert.notEqual(activation.approval.id, acceptance.approval.id);
  assert.notEqual(activation.scopeHash, acceptance.scopeHash);
  assert.throws(
    () => decidePreventureLifecycleApproval(
      db,
      activation.approval.id,
      "approve",
      "Stale card.",
      {
        expectedScopeHash: acceptance.scopeHash,
        decidedAt: clockValue,
        ownerSessionAttestation: issueAuthenticatedOwnerSessionAttestationForTest({
          db,
          approvalId: activation.approval.id,
          decidedAt: clockValue,
          decision: "approve",
          note: "Stale card.",
          expectedScopeHash: acceptance.scopeHash,
        }),
        storeOptions,
      },
    ),
    /refresh/i,
  );
  assert.equal(
    db.prepare("SELECT status FROM approvals WHERE id = ?").get(activation.approval.id).status,
    "pending",
  );

  clockValue = "2026-08-02T12:02:00+10:00";
  const activationNote = "Daniel activated this exact internal-only diligence round.";
  decidePreventureLifecycleApproval(
    db,
    activation.approval.id,
    "approve",
    activationNote,
    {
      expectedScopeHash: activation.scopeHash,
      decidedAt: clockValue,
      ownerSessionAttestation: issueAuthenticatedOwnerSessionAttestationForTest({
        db,
        approvalId: activation.approval.id,
        decidedAt: clockValue,
        decision: "approve",
        note: activationNote,
        expectedScopeHash: activation.scopeHash,
      }),
      storeOptions,
    },
  );
  clockValue = "2026-08-02T12:03:00+10:00";
  const materialized = materializePreventureResearchAssignments(store, authority.authorityHash, {
    db,
    expectedAuthorityHash: authority.authorityHash,
    assignedAt: clockValue,
  });
  assert.equal(materialized.assignments.length, 3);
  assert.equal(materialized.work.tasks.length, 3);
  assert.equal(materialized.work.workflow.venture_id, null);
  assert.equal(materialized.work.workflow.status, "blocked");
  assert.ok(materialized.work.tasks.every((task) => task.status === "blocked"));
  assert.equal(
    db.prepare("SELECT COUNT(*) AS count FROM commercial_test_contracts").get().count,
    0,
  );
  assert.equal(
    db.prepare("SELECT COUNT(*) AS count FROM tasks WHERE kind <> 'preventure_research'").get().count,
    0,
  );
  assert.equal(store.verifyLedger().ok, true);
});

test("readiness keeps identical cost keys on different assignments separate", () => {
  const firstAssignment = `sha256:${"a".repeat(64)}`;
  const secondAssignment = `sha256:${"b".repeat(64)}`;
  const result = require("../src/runtime/preventure-research-readiness")
    .latestCostExposure([
      {
        assignmentHash: firstAssignment,
        costKey: "provider_call",
        sequence: 1,
        eventType: "estimated",
        amountAudCents: 25,
        exposureAudCents: 25,
        occurredAt: "2026-08-02T12:00:00+10:00",
      },
      {
        assignmentHash: secondAssignment,
        costKey: "provider_call",
        sequence: 1,
        eventType: "estimated",
        amountAudCents: 35,
        exposureAudCents: 35,
        occurredAt: "2026-08-02T12:00:01+10:00",
      },
    ]);
  assert.equal(result.latest.length, 2);
  assert.equal(result.exposureAudCents, 60);
  assert.equal(result.estimatedAudCents, 60);
});

test("owner state shows preparation truth, unverified Etsy input, and no commercial success", () => {
  const store = fakeStore();
  registerPreventureResearchProposal(store, authority, readinessSpec, {
    occurredAt: "2026-08-02T12:00:00+10:00",
  });
  const state = getPreventureResearchOwnerState(null, {
    store,
    readinessSpec,
    clock: () => "2026-08-02T12:05:00+10:00",
  });
  assert.equal(state.integrity.status, "ok");
  assert.deepEqual(state.controls.allowed, ["revoke"]);
  assert.equal(state.current.startingReadiness.status, "research_more");
  assert.equal(state.current.startingReadiness.offerDisposition, "revise");
  assert.equal(state.current.etsy.accountExistence, "owner_reported_unverified");
  assert.equal(state.current.etsy.connected, false);
  assert.equal(state.current.moneyMove.separateApprovalRequiredForBuild, true);
  assert.equal(state.current.commercialTruth.commercialValidationOccurred, false);
  assert.equal(state.businessTruth.revenueAudCents, 0);
});

test("effective expiry stays visible as current attention until an expiry event seals history", () => {
  const afterExpiry = "2026-08-10T12:00:00+10:00";
  let clockValue = "2026-08-02T12:00:00+10:00";
  const store = activatedStore(() => clockValue);
  clockValue = afterExpiry;
  const unsealed = getPreventureResearchOwnerState(null, {
    store,
    readinessSpec,
    clock: () => afterExpiry,
  });
  assert.equal(unsealed.integrity.status, "attention");
  assert.equal(unsealed.integrity.authorityStatus, "expired_unsealed");
  assert.equal(unsealed.current.lifecycle.status, "expired");
  assert.equal(unsealed.history.total, 0);
  assert.deepEqual(unsealed.controls.allowed, []);

  const latest = store.loadLifecycle(authority.authorityHash).at(-1);
  terminatePreventureResearchAuthority(store, authority.authorityHash, "expired", {
    expectedLatestEventHash: latest.eventHash,
    occurredAt: afterExpiry,
    reason: "The fixed internal diligence deadline passed.",
  });
  const sealed = getPreventureResearchOwnerState(null, {
    store,
    readinessSpec,
    clock: () => afterExpiry,
  });
  assert.equal(sealed.current, null);
  assert.equal(sealed.history.total, 1);
  assert.equal(sealed.history.items[0].lifecycle.status, "expired");
});

test("needs-changes requires a new immutable authority and the v1 record can only close", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "pantheon-preventure-needs-changes-"));
  let clockValue = "2026-08-02T12:00:00+10:00";
  const clock = () => clockValue;
  const db = openDatabase(path.join(directory, "runtime.sqlite"), { clock });
  t.after(() => {
    db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  seedDatabase(db);
  const storeOptions = { clock, authorityRegistry: historicalV1TestRegistry };
  const store = createPreventureResearchStore(db, storeOptions);
  registerPreventureResearchProposal(store, authority, readinessSpec, {
    occurredAt: clockValue,
  });
  clockValue = "2026-08-02T12:01:00+10:00";
  const approval = createPreventureLifecycleApproval(
    db,
    authority.authorityHash,
    "accepted",
    { requestedAt: clockValue, storeOptions },
  );
  clockValue = "2026-08-02T12:02:00+10:00";
  const changesNote = "Register a reviewed v2 replacement rather than changing this immutable v1 scope.";
  const changes = decidePreventureLifecycleApproval(
    db,
    approval.approval.id,
    "changes",
    changesNote,
    {
      expectedScopeHash: approval.scopeHash,
      decidedAt: clockValue,
      ownerSessionAttestation: issueAuthenticatedOwnerSessionAttestationForTest({
        db,
        approvalId: approval.approval.id,
        decidedAt: clockValue,
        decision: "changes",
        note: changesNote,
        expectedScopeHash: approval.scopeHash,
      }),
      storeOptions,
    },
  );
  assert.equal(changes.lifecycleChanged, false);
  const projected = getPreventureResearchOwnerState(db, {
    storeOptions,
    readinessSpec,
    clock: () => clockValue,
  });
  assert.equal(projected.integrity.authorityStatus, "replacement_required");
  assert.deepEqual(projected.controls.allowed, ["revoke"]);
  assert.ok(projected.current.replacementRequired);
  assert.throws(
    () => decidePreventureLifecycleApproval(
      db,
      approval.approval.id,
      "approve",
      "The same decision cannot reopen v1.",
      {
        expectedScopeHash: approval.scopeHash,
        decidedAt: clockValue,
        ownerSessionAttestation: issueAuthenticatedOwnerSessionAttestationForTest({
          db,
          approvalId: approval.approval.id,
          decidedAt: clockValue,
          decision: "approve",
          note: "The same decision cannot reopen v1.",
          expectedScopeHash: approval.scopeHash,
        }),
        storeOptions,
      },
    ),
    /already|resolved|different decision|single-use/i,
  );
  const latest = store.loadLifecycle(authority.authorityHash).at(-1);
  clockValue = "2026-08-02T12:03:00+10:00";
  terminatePreventureResearchAuthority(store, authority.authorityHash, "revoked", {
    expectedLatestEventHash: latest.eventHash,
    occurredAt: clockValue,
    reason: "Close immutable v1 before any replacement is registered.",
  });
  const closed = getPreventureResearchOwnerState(db, {
    storeOptions,
    readinessSpec,
    clock: () => clockValue,
  });
  assert.equal(closed.current, null);
  assert.equal(closed.history.total, 1);
  assert.equal(closed.history.items[0].lifecycle.status, "revoked");
});

function exactRunnerDependencies(context, overrides = {}) {
  const retained = new Map();
  const claims = {
    kind: EXACT_CLAIM_KIND,
    async claim(input) {
      return {
        claimToken: "claim_exact_1",
        exclusive: true,
        activeAssignmentsBefore: 0,
        unresolvedAssignmentsBefore: 0,
        providerAttemptsForAssignmentBefore: 0,
        assignmentHash: input.assignmentHash,
        descriptorHash: input.descriptorHash,
        taskAttemptId: "attempt_exact_1",
        modelCallId: "model_call_exact_1",
        clientRequestId: "pantheon-preventure-client-exact-1",
      };
    },
    async markProviderDispatched(input) {
      return {
        outcomeStatus: "provider_dispatched",
        clientRequestId: input.clientRequestId,
      };
    },
    async assertProviderResultClaim(input) {
      return {
        current: true,
        outcomeStatus: "provider_dispatched",
        claimToken: input.claimToken,
        assignmentHash: input.assignmentHash,
        descriptorHash: input.descriptorHash,
        clientRequestId: input.clientRequestId,
      };
    },
    async commitTerminalProviderArtifactCustody(input) {
      return {
        status: "terminal_provider_artifact_retained_pending_reconciliation",
        created: true,
        custodyRecord: {
          custodyRecordHash: sha256({
            assignmentHash: input.assignmentHash,
            artifactHash: input.retainedOutput.artifactHash,
          }),
        },
        authorityHash: input.authorityHash,
        assignmentHash: input.assignmentHash,
        descriptorHash: input.descriptorHash,
        retainedOutputHash: input.retainedOutput.artifactHash,
        retainedOutputRef: input.retainedOutput.artifactRef,
        terminalState: "emergency_stopped",
        emergencyStopped: true,
        accountingState: "pending_reconciliation",
        additionalAiCostAudCents: 0,
        retryAuthorized: false,
      };
    },
    async inspectProviderArtifactCustody(input) {
      return {
        inspected: true,
        custodyRequired: false,
        activeReprocessAllowed: true,
        terminalState: "activated",
        emergencyStopped: false,
        authorityHash: input.authorityHash,
        assignmentHash: input.assignmentHash,
        descriptorHash: input.descriptorHash,
        requestBodyHash: input.requestBodyHash,
        taskId: input.taskId,
        taskAttemptId: "attempt_exact_1",
        modelCallId: "model_call_exact_1",
        claimToken: "claim_exact_1",
        clientRequestId: input.clientRequestId,
        providerRequestId: input.providerRequestId,
        providerResponseId: input.providerResponseId,
        retainedOutputHash: input.retainedOutput.artifactHash,
        retainedOutputRef: input.retainedOutput.artifactRef,
        providerDispatchedAt: "2026-08-02T12:04:00+10:00",
        latestLifecycleEventHash: sha256("active_reprocess_lifecycle"),
      };
    },
    async commitKnownEvidence(input) {
      const sourceBindings = input.preparedEvidenceBatch.sourceSnapshots.map((source, index) => ({
        providerSourceId: source.providerSourceId,
        sourceRecordId: `research_source_${index + 1}`,
        provenanceId: `research_provenance_${index + 1}`,
        url: source.url,
        contentHash: source.contentHash,
        contentLocation: source.contentLocation,
        researchRunId: "research_run_1",
        agentRunReceiptId: "agent_receipt_1",
      }));
      const persisted = input.persistEvidence({
        researchRunId: "research_run_1",
        agentRunReceiptId: "agent_receipt_1",
        sourceBindings,
        recordSourceSnapshot: context.store.recordSourceSnapshot,
        recordEvidence: context.store.recordEvidence,
      });
      return {
        status: "complete",
        researchRunId: "research_run_1",
        agentRunReceiptId: "agent_receipt_1",
        resultHash: input.resultHash,
        ...persisted,
      };
    },
    async commitReprocessedEvidence(input) {
      const sourceBindings = input.preparedEvidenceBatch.sourceSnapshots.map((source, index) => ({
        providerSourceId: source.providerSourceId,
        sourceRecordId: `research_source_${index + 1}`,
        provenanceId: `research_provenance_${index + 1}`,
        url: source.url,
        contentHash: source.contentHash,
        contentLocation: source.contentLocation,
        researchRunId: "research_run_1",
        agentRunReceiptId: "agent_receipt_1",
      }));
      const persisted = input.persistEvidence({
        researchRunId: "research_run_1",
        agentRunReceiptId: "agent_receipt_1",
        sourceBindings,
        recordSourceSnapshot: context.store.recordSourceSnapshot,
        recordEvidence: context.store.recordEvidence,
      });
      return {
        status: "complete",
        researchRunId: "research_run_1",
        agentRunReceiptId: "agent_receipt_1",
        resultHash: input.resultHash,
        ...persisted,
      };
    },
    async commitValidatedEarlyStop(input) {
      const receiptId = "agent_receipt_early_stop_1";
      const receiptHash = sha256({ receiptId, resultHash: input.resultHash });
      let persisted = { sourceSnapshots: [], evidenceRecords: [] };
      if (input.preparedEvidenceBatch && typeof input.persistEvidence === "function") {
        const sourceBindings = input.preparedEvidenceBatch.sourceSnapshots.map((source, index) => ({
          providerSourceId: source.providerSourceId,
          sourceRecordId: `research_source_early_stop_${index + 1}`,
          provenanceId: `research_provenance_early_stop_${index + 1}`,
          url: source.url,
          contentHash: source.contentHash,
          contentLocation: source.contentLocation,
          researchRunId: "research_run_early_stop_1",
          agentRunReceiptId: receiptId,
        }));
        persisted = input.persistEvidence({
          researchRunId: "research_run_early_stop_1",
          agentRunReceiptId: receiptId,
          sourceBindings,
          recordSourceSnapshot: context.store.recordSourceSnapshot,
          recordEvidence: context.store.recordEvidence,
        });
      }
      const rows = authority.assignments.map((template) => context.store.getAssignment(
        authority.authorityHash,
        template.id,
      ));
      const triggerAssignment = rows.find((item) => item.assignmentHash === input.assignmentHash);
      const sourceSnapshotHashes = persisted.sourceSnapshots
        .map((item) => item.snapshotHash || item.sourceSnapshotHash)
        .sort();
      const evidenceHashes = persisted.evidenceRecords.map((item) => item.evidenceHash).sort();
      const completed = input.triggerOutcomeClass === "validated_evidence_shortfall"
        ? [triggerAssignment]
        : [];
      const providerEvidence = {
        attemptId: input.taskAttemptId || "attempt_exact_1",
        modelCallId: input.modelCallId || "model_call_exact_1",
        agentRunReceiptId: receiptId,
        effectState: input.triggerOutcomeClass === "known_failed_before_effect"
          ? "definite_pre_effect"
          : "known_effect",
        officialEndpointHash: input.triggerOutcomeClass === "known_failed_before_effect"
          ? PREVENTURE_OFFICIAL_RESPONSES_ENDPOINT_HASH
          : null,
        httpStatus: input.httpStatus || input.retainedOutput?.responseMetadata?.httpStatus || 200,
        providerErrorType: input.providerErrorType || null,
        providerErrorCode: input.providerErrorCode || null,
        providerErrorBodyArtifactHash: input.providerErrorBodyArtifactHash || null,
        providerRequestId: input.providerRequestId || null,
        providerResponseId: input.providerResponseId || null,
        clientRequestHash: sha256(input.clientRequestId),
        rawOutputArtifactHash: input.retainedOutput.artifactHash,
        responseIssuesHash: sha256(input.responseIssues || []),
        costStatus: input.costStatus,
        costAudCents: input.costAudCents,
        exposureAudCents: input.exposureAudCents ?? input.costAudCents,
        exactBillingPending: input.exactBillingPending ?? ["estimated", "incurred"].includes(input.costStatus),
        providerZeroBillingGuarantee: input.triggerOutcomeClass === "known_failed_before_effect"
          ? false
          : null,
      };
      const actualCoverage = {
        sourceSnapshotHashes,
        evidenceHashes,
        comparatorIds: input.preparedEvidenceBatch?.validatedCoverage?.metrics?.comparatorIds || [],
        comparatorCoverage: input.preparedEvidenceBatch?.validatedCoverage?.metrics || {},
        buyerEvidenceCoverage: input.preparedEvidenceBatch?.validatedCoverage?.metrics || {},
        sourceAttemptRefs: [],
        evidenceSetHash: sha256(evidenceHashes),
        executionReceiptSetHash: sha256([receiptHash]),
        completedAssignmentIds: completed.map((item) => item.id).sort(),
        completedAssignmentReceipts: completed.map((item) => ({
          assignmentId: item.id,
          assignmentHash: item.assignmentHash,
          agentRunReceiptId: receiptId,
          agentRunReceiptHash: receiptHash,
        })).sort((left, right) => left.assignmentId.localeCompare(right.assignmentId)),
        retainedContradictionEvidenceIds: persisted.evidenceRecords
          .filter((item) => item.polarity === "contrary")
          .map((item) => item.id)
          .sort(),
        retainedCaseCriterionIds: [...new Set(persisted.evidenceRecords
          .map((item) => item.criterionId)
          .filter(Boolean))].sort(),
      };
      const stopRecord = createPreventureResearchTerminalStop({
        authority,
        assignments: rows,
        triggerAssignment,
        triggerOutcomeClass: input.triggerOutcomeClass,
        providerEvidence,
        actualCoverage,
        gapCodes: input.validatedCoverage?.gapCodes,
        stoppedAt: input.completedAt,
      });
      return {
        status: "validated_early_stop",
        completionMode: "validated_early_stop",
        resultHash: input.resultHash,
        stopRecord,
        earlyStopRecordHash: stopRecord.earlyStopRecordHash,
        skippedAssignments: stopRecord.skippedAssignments,
        skippedAssignmentRecordHashes: stopRecord.skippedAssignments.map(
          (item) => item.skipRecordHash,
        ),
        ...persisted,
      };
    },
    async failBeforeDispatch() {},
    async markDefinitePreEffectFailure() {},
    async markKnownNeedsAttention() {},
    async markKnownNeedsReprocess() {},
    async markKnownResultUnknownCost() {},
    async markUnknown() {},
  };
  const categories = [
    ...Array(4).fill("direct_or_near_direct"),
    ...Array(3).fill("adjacent"),
    ...Array(3).fill("indirect"),
  ];
  const sources = categories.map((category, index) => ({
    id: `public_source_${index + 1}`,
    sourceClass: "public_marketplace_listing_or_result_observation",
    sourceTier: 3,
    captureStatus: "partial",
    url: index < 5
      ? `https://www.etsy.com/listing/${1001 + index}/public-offer-${index + 1}?ref=search`
      : `https://seller${index + 1}.gumroad.com/l/public_offer_${index + 1}?ref=search`,
    title: `Public offer observation ${index + 1}`,
    publisher: "Example marketplace",
    publishedAt: null,
    content: null,
    retainedEvidenceHash: null,
    retainedSourceSnapshotHash: null,
    limitations: ["Displayed offer only."],
    category,
  }));
  const buyerSignals = [];
  const output = {
    comparators: sources.map((source) => `Retained ${source.id}.`),
    buyerEvidence: ["The bounded comparator batch is retained but does not prove exact-offer demand."],
    contraryEvidence: ["Displayed supply does not prove paid demand."],
    limitations: ["This focused runner fixture is not a completed diligence result."],
    sources: sources.map(({ category: _category, ...source }) => source),
    evidence: [
      ...sources.map((source, index) => {
        const identity = derivePreventureResearchSourceIdentity(source.url);
        return {
          id: `comparator_evidence_${index + 1}`,
          sourceId: source.id,
          truthClass: "model_inference",
          polarity: index === 0 ? "contrary" : "neutral",
          questionId: "buyer_problem_and_direct_demand",
          claim: `Public offer ${index + 1} was displayed; this observation does not prove sales.`,
          confidence: "high",
          criterionId: null,
          limitations: ["A displayed offer cannot prove demand."],
          details: {
            comparator: {
              id: identity.offerIdentityKey,
              category: source.category,
              sellerId: identity.sellerIdentityKey,
              channelId: identity.marketplaceChannelId,
              formatIds: [authority.formats[index % authority.formats.length]],
              reviewObservationCount: 0,
            },
            buyerEvidence: null,
            formatCase: null,
            channelCase: null,
            economicsCase: null,
            readinessGate: null,
            recommendation: null,
          },
        };
      }),
      ...buyerSignals.map((signal, index) => ({
        id: `buyer_signal_${index + 1}`,
        sourceId: sources[index % sources.length].id,
        truthClass: "model_inference",
        polarity: "supporting",
        questionId: "buyer_problem_and_direct_demand",
        claim: `Grounded metadata was classified as bounded buyer signal ${index + 1}; it remains model inference.`,
        confidence: "medium",
        criterionId: null,
        limitations: ["Web-search grounding does not prove a retained page or exact-offer purchase."],
        details: {
          comparator: null,
          buyerEvidence: signal,
          formatCase: null,
          channelCase: null,
          economicsCase: null,
          readinessGate: null,
          recommendation: null,
        },
      })),
    ],
  };
  const transport = {
    kind: EXACT_TRANSPORT_KIND,
    async preflight({ descriptor }) {
      return {
        ready: true,
        provider: descriptor.provider,
        endpoint: OFFICIAL_OPENAI_RESPONSES_URL,
        method: "POST",
        requestBodyHash: descriptor.request.requestBodyHash,
        responseStorage: false,
        background: false,
        canonicalResponseRetention: true,
        estimatedInputTokens: 2000,
        toolTypes: ["web_search"],
        toolConfiguration: descriptor.request.requestBody.tools,
        groundingSources: [
          "web_search_call.action.sources",
          "message.output_text.annotations.url_citation",
        ],
      };
    },
    async dispatch({ descriptor, clientRequestId }) {
      const providerResponse = {
        id: "resp_provider_response_1",
        model: descriptor.model,
        status: "completed",
        incomplete_details: null,
        output: [
          {
            id: "ws_provider_response_1",
            type: "web_search_call",
            status: "completed",
            action: {
              type: "search",
              query: "etsy gumroad social media manager scope approval templates",
              sources: sources.slice(0, 5).map((source) => ({
                url: source.url,
                title: source.title,
                publisher: source.publisher,
                snippet: source.content,
              })),
            },
          },
          {
            id: "ws_provider_response_2",
            type: "web_search_call",
            status: "completed",
            action: {
              type: "search",
              query: "contrary evidence buyer demand approval workflow templates",
              sources: sources.slice(5).map((source) => ({
                url: source.url,
                title: source.title,
                publisher: source.publisher,
                snippet: source.content,
              })),
            },
          },
          {
            id: "msg_provider_response_1",
            type: "message",
            status: "completed",
            role: "assistant",
            content: [{
              type: "output_text",
              text: JSON.stringify(output),
              annotations: sources.map((source) => ({
                type: "url_citation",
                url: source.url,
                title: source.title,
              })),
            }],
          },
        ],
      };
      return {
        outcomeStatus: "known",
        providerRequestId: "req_provider_request_1",
        providerResponseId: "resp_provider_response_1",
        clientRequestId,
        provider: descriptor.provider,
        model: descriptor.model,
        endpoint: OFFICIAL_OPENAI_RESPONSES_URL,
        responseMetadata: { httpStatus: 200 },
        requestBodyHash: descriptor.request.requestBodyHash,
        toolCallCount: 2,
        providerResponse,
        costAudCents: 10,
        costStatus: "estimated",
      };
    },
  };
  const outputStore = {
    kind: EXACT_OUTPUT_STORE_KIND,
    async retain(input) {
      const record = {
        ...input,
        retained: true,
        outputHash: sha256(input.output),
        artifactHash: sha256({
          assignmentHash: input.assignmentHash,
          descriptorHash: input.descriptorHash,
          rawProviderBodyHash: input.rawProviderBodyHash || null,
        }),
        artifactRef: "retained_1",
        location: "C:\\tmp\\preventure-output.json",
      };
      retained.set("retained_1", record);
      return record;
    },
    async load(ref) {
      return retained.get(ref) || null;
    },
  };
  const parser = {
    kind: EXACT_LOCAL_PARSER_KIND,
    async parse(value) {
      return JSON.parse(value);
    },
  };
  return { claims, transport, outputStore, parser, ...overrides };
}

test("runner retains two exact searches and stops when partial grounding cannot prove purchaser demand", async () => {
  const store = activatedStore();
  const materialized = materializePreventureResearchAssignments(store, authority.authorityHash, {
    expectedAuthorityHash: authority.authorityHash,
    assignedAt: "2026-08-02T12:03:00+10:00",
  });
  const assignment = materialized.assignments.find((item) => item.id === "comparator_and_buyer_evidence");
  const activation = store.loadLifecycle(authority.authorityHash).find((event) => event.eventType === "activated");
  const descriptor = createPreventureResearchExecutionDescriptor(
    authority,
    assignment,
    authority.assignments.find((item) => item.id === assignment.id),
    activation,
  );
  const dependencies = exactRunnerDependencies({ descriptor, store });
  let retainedBeforeComplete = false;
  let committedCoverage = null;
  const originalRetain = dependencies.outputStore.retain;
  dependencies.outputStore.retain = async (input) => {
    retainedBeforeComplete = true;
    return originalRetain(input);
  };
  const originalCommit = dependencies.claims.commitValidatedEarlyStop;
  dependencies.claims.commitValidatedEarlyStop = async (input) => {
    assert.equal(retainedBeforeComplete, true);
    committedCoverage = input.validatedCoverage;
    return originalCommit(input);
  };
  const result = await runPreventureResearchAssignment({
    store,
    authorityHash: authority.authorityHash,
    assignmentId: assignment.id,
    expectedAssignmentHash: assignment.assignmentHash,
    expectedDescriptorHash: descriptor.descriptorHash,
    clock: () => "2026-08-02T12:04:00+10:00",
    ...dependencies,
  });
  assert.equal(result.status, "completed_validated_early_stop");
  assert.equal(result.triggerOutcomeClass, "validated_evidence_shortfall");
  assert.equal(result.costAudCents, 10);
  assert.equal(result.sourceSnapshotCount, 10);
  assert.equal(result.evidenceRecordCount, 10);
  assert.equal(committedCoverage.metrics.purchaserSignalCount, 0);
  assert.equal(committedCoverage.metrics.inferredPurchaserSignalCount, 0);
  assert.deepEqual(descriptor.toolTypes, ["web_search"]);
  assert.deepEqual(descriptor.externalEffects, []);
  assert.equal(descriptor.request.endpointPath, "/v1/responses");
  assert.equal(descriptor.request.requestBody.store, false);
  assert.equal(descriptor.request.requestBody.background, false);
  assert.equal(descriptor.request.requestBody.service_tier, "default");
  assert.equal(descriptor.request.requestBody.tool_choice, "required");
  assert.deepEqual(
    descriptor.request.requestBody.tools,
    authority.provider.requestPolicy.tools,
  );
  assert.deepEqual(descriptor.request.requestBody.reasoning, { effort: "low" });
  assert.equal(descriptor.request.requestBody.max_tool_calls, assignment.maxToolCalls);
  assert.equal(descriptor.request.requestBody.max_output_tokens, assignment.maxOutputTokens);
  assert.deepEqual(descriptor.request.requestBody.include, ["web_search_call.action.sources"]);
  assert.equal(descriptor.buildAuthorized, false);
  assert.equal(descriptor.worstCaseCost.amountAudCents, 50);
});

test("atomic completion rejects a swapped provider-grounded source before any authority evidence write", async () => {
  const store = activatedStore();
  const materialized = materializePreventureResearchAssignments(store, authority.authorityHash, {
    expectedAuthorityHash: authority.authorityHash,
    assignedAt: "2026-08-02T12:03:00+10:00",
  });
  const assignment = materialized.assignments[0];
  const activation = store.loadLifecycle(authority.authorityHash)
    .find((event) => event.eventType === "activated");
  const descriptor = createPreventureResearchExecutionDescriptor(
    authority,
    assignment,
    authority.assignments.find((item) => item.id === assignment.id),
    activation,
  );
  const dependencies = exactRunnerDependencies({ descriptor, store });
  let recoveryMarked = false;
  dependencies.claims.commitValidatedEarlyStop = async (input) => {
    const sourceBindings = input.preparedEvidenceBatch.sourceSnapshots.map((source, index) => ({
      providerSourceId: source.providerSourceId,
      sourceRecordId: `research_source_${index + 1}`,
      provenanceId: `research_provenance_${index + 1}`,
      url: index === 0 ? "https://example.com/swapped-source" : source.url,
      contentHash: source.contentHash,
      contentLocation: source.contentLocation,
      researchRunId: "research_run_1",
      agentRunReceiptId: "agent_receipt_1",
    }));
    return input.persistEvidence({
      researchRunId: "research_run_1",
      agentRunReceiptId: "agent_receipt_1",
      sourceBindings,
      recordSourceSnapshot: store.recordSourceSnapshot,
      recordEvidence: store.recordEvidence,
    });
  };
  dependencies.claims.markKnownNeedsReprocess = async () => {
    recoveryMarked = true;
  };
  const result = await runPreventureResearchAssignment({
    store,
    authorityHash: authority.authorityHash,
    assignmentId: assignment.id,
    expectedAssignmentHash: assignment.assignmentHash,
    expectedDescriptorHash: descriptor.descriptorHash,
    clock: () => "2026-08-02T12:04:00+10:00",
    ...dependencies,
  });
  assert.equal(result.status, "known_provider_result_needs_attention");
  assert.equal(recoveryMarked, true);
  const ledger = store.readLedger(authority.authorityHash);
  assert.equal(ledger.sourceSnapshots.length, 0);
  assert.equal(ledger.evidenceRecords.length, 0);
});

test("web-search grounding cannot be promoted to captured content or a private-network source", async () => {
  const cases = [
    {
      name: "fabricated captured page content",
      mutate(providerResponse, parsed) {
        parsed.sources[0].captureStatus = "captured";
        parsed.sources[0].content = "Model-authored page content is not a retained page artifact.";
        providerResponse.output.find((item) => item.type === "message")
          .content[0].text = JSON.stringify(parsed);
      },
    },
    {
      name: "private-network URL",
      mutate(providerResponse, parsed) {
        const privateUrl = "https://localhost/private-source";
        parsed.sources[0].url = privateUrl;
        providerResponse.output[0].action.sources[0].url = privateUrl;
        const message = providerResponse.output.find((item) => item.type === "message");
        message.content[0].annotations[0].url = privateUrl;
        message.content[0].text = JSON.stringify(parsed);
      },
    },
  ];
  for (const scenario of cases) {
    const store = activatedStore();
    const materialized = materializePreventureResearchAssignments(store, authority.authorityHash, {
      expectedAuthorityHash: authority.authorityHash,
      assignedAt: "2026-08-02T12:03:00+10:00",
    });
    const assignment = materialized.assignments[0];
    const activation = store.loadLifecycle(authority.authorityHash)
      .find((event) => event.eventType === "activated");
    const descriptor = createPreventureResearchExecutionDescriptor(
      authority,
      assignment,
      authority.assignments.find((item) => item.id === assignment.id),
      activation,
    );
    const dependencies = exactRunnerDependencies({ descriptor, store });
    const originalTerminalCommit = dependencies.claims.commitValidatedEarlyStop;
    let knownUnusableTerminalInput = null;
    dependencies.claims.commitValidatedEarlyStop = async (input) => {
      if (input.triggerOutcomeClass === "known_retained_unusable_provider_response") {
        knownUnusableTerminalInput = input;
        assert.equal(input.rawOutputArtifactHash, input.retainedOutput.artifactHash);
        assert.equal(input.responseIssuesHash, sha256(input.responseIssues));
      }
      return originalTerminalCommit(input);
    };
    const originalDispatch = dependencies.transport.dispatch;
    dependencies.transport.dispatch = async (input) => {
      const result = await originalDispatch(input);
      const providerResponse = result.providerResponse;
      const message = providerResponse.output.find((item) => item.type === "message");
      const parsed = JSON.parse(message.content[0].text);
      scenario.mutate(providerResponse, parsed);
      return result;
    };
    const result = await runPreventureResearchAssignment({
      store,
      authorityHash: authority.authorityHash,
      assignmentId: assignment.id,
      expectedAssignmentHash: assignment.assignmentHash,
      expectedDescriptorHash: descriptor.descriptorHash,
      clock: () => "2026-08-02T12:04:00+10:00",
      ...dependencies,
    });
    assert.equal(result.status, "completed_validated_early_stop", scenario.name);
    assert.equal(
      result.triggerOutcomeClass,
      "known_retained_unusable_provider_response",
      scenario.name,
    );
    assert.ok(knownUnusableTerminalInput, scenario.name);
    const ledger = store.readLedger(authority.authorityHash);
    assert.equal(ledger.sourceSnapshots.length, 0, scenario.name);
    assert.equal(ledger.evidenceRecords.length, 0, scenario.name);
  }
});

test("descriptor validation rejects optional search, extra tools, storage, and widened execution limits", () => {
  const store = activatedStore();
  const materialized = materializePreventureResearchAssignments(store, authority.authorityHash, {
    expectedAuthorityHash: authority.authorityHash,
    assignedAt: "2026-08-02T12:03:00+10:00",
  });
  const assignment = materialized.assignments[0];
  const template = authority.assignments.find((item) => item.id === assignment.id);
  const activation = store.loadLifecycle(authority.authorityHash).find((event) => event.eventType === "activated");
  const descriptor = createPreventureResearchExecutionDescriptor(authority, assignment, template, activation);
  assert.equal(
    validatePreventureResearchExecutionDescriptor(
      authority,
      assignment,
      template,
      activation,
      descriptor,
    ),
    descriptor,
  );
  const tampered = [
    (value) => { value.request.requestBody.tool_choice = "auto"; },
    (value) => { value.request.requestBody.tools.push({ type: "computer" }); },
    (value) => { value.request.requestBody.store = true; },
    (value) => { value.request.requestBody.max_tool_calls += 1; },
    (value) => { value.request.requestBody.max_output_tokens += 1; },
    (value) => { value.request.requestBody.include = []; },
    (value) => { value.limits.maxInputTokens += 1; },
  ];
  for (const mutate of tampered) {
    const changed = JSON.parse(JSON.stringify(descriptor));
    mutate(changed);
    changed.descriptorHash = sha256((({ descriptorHash: _hash, ...body }) => body)(changed));
    assert.throws(
      () => validatePreventureResearchExecutionDescriptor(
        authority,
        assignment,
        template,
        activation,
        changed,
      ),
      /descriptor changed/i,
    );
  }
});

test("every assignment schema fits the full provider-visible local preflight bound", () => {
  const store = activatedStore();
  const materialized = materializePreventureResearchAssignments(store, authority.authorityHash, {
    expectedAuthorityHash: authority.authorityHash,
    assignedAt: "2026-08-02T12:03:00+10:00",
  });
  const activation = store.loadLifecycle(authority.authorityHash)
    .find((event) => event.eventType === "activated");
  for (const [index, assignment] of materialized.assignments.entries()) {
    const priorBody = {
      schema: "pantheon.preventure-research-prior-evidence.v1",
      authorityHash: authority.authorityHash,
      assignmentId: assignment.id,
      completedAssignments: authority.assignments.slice(0, index).map((item) => ({ id: item.id })),
      sourceSnapshots: [],
      evidenceRecords: [],
      requiredCaseSummaries: [],
      materialEvidenceSummary: {
        count: 0,
        setHash: sha256([]),
        fullGroupCount: 0,
        fullGroupSetHash: sha256([]),
        groups: [],
        omittedGroupCount: 0,
        omittedGroupSetHash: sha256([]),
        byQuestion: {},
        byPolarity: {},
        byTruthClass: {},
      },
      compaction: {
        algorithm: "pantheon_prior_evidence_compaction_v1",
        fullSourceSnapshotCount: 0,
        fullSourceSnapshotSetHash: sha256([]),
        selectedSourceSnapshotCount: 0,
        selectedSourceSnapshotSetHash: sha256([]),
        omittedSourceSnapshotCount: 0,
        omittedSourceSnapshotSetHash: sha256([]),
        fullEvidenceRecordCount: 0,
        fullEvidenceRecordSetHash: sha256([]),
        selectedEvidenceRecordCount: 0,
        selectedEvidenceRecordSetHash: sha256([]),
        omittedEvidenceRecordCount: 0,
        omittedEvidenceRecordSetHash: sha256([]),
        fullMaterialGroupCount: 0,
        fullMaterialGroupRepresentativeSetHash: sha256([]),
        selectedMaterialGroupRepresentativeCount: 0,
        selectedMaterialGroupRepresentativeSetHash: sha256([]),
        omittedMaterialGroupRepresentativeCount: 0,
        omittedMaterialGroupRepresentativeSetHash: sha256([]),
        fullRequiredCaseSummaryCount: 0,
        fullRequiredCaseSummarySetHash: sha256([]),
        selectedRequiredCaseSummaryCount: 0,
        selectedRequiredCaseSummarySetHash: sha256([]),
        omittedRequiredCaseSummaryCount: 0,
        omittedRequiredCaseSummarySetHash: sha256([]),
      },
      terminalReceiptHashes: [],
      costReceiptHashes: [],
    };
    const descriptor = createPreventureResearchExecutionDescriptor(
      authority,
      assignment,
      authority.assignments.find((item) => item.id === assignment.id),
      activation,
      { ...priorBody, contextHash: sha256(priorBody) },
    );
    assert.equal(
      descriptor.request.providerVisibleInputUtf8ByteLength,
      Buffer.byteLength(JSON.stringify(descriptor.request.requestBody), "utf8"),
    );
    assert.ok(
      descriptor.request.localInputTokenUpperBound
        <= assignment.localPromptPreflightMaxInputTokens,
      `${assignment.id} exceeds the local prompt preflight bound`,
    );
  }
});

test("prior evidence compaction deterministically manifests every adverse group within 30k", () => {
  const store = activatedStore();
  const materialized = materializePreventureResearchAssignments(store, authority.authorityHash, {
    expectedAuthorityHash: authority.authorityHash,
    assignedAt: "2026-08-02T12:03:00+10:00",
  });
  const first = materialized.assignments[0];
  const second = materialized.assignments[1];
  const receiptHash = sha256({ receipt: "prior_assignment_complete" });
  const questions = authority.researchQuestions.map((item) => item.id);
  for (let index = 0; index < 60; index += 1) {
    const snapshotHash = sha256({ source: index + 1 });
    store.recordSourceSnapshot(first.assignmentHash, {
      id: `prior_source_${index + 1}`,
      snapshotHash,
      sourceRecordId: `source_record_${index + 1}`,
      provenanceId: `provenance_${index + 1}`,
      researchRunId: "research_run_prior_1",
      agentRunReceiptId: "receipt_prior_1",
      sourceClass: "public_marketplace_listing_or_result_observation",
      sourceTier: 3,
      captureStatus: "partial",
      url: `https://seller${index + 1}.gumroad.com/l/prior_${index + 1}`,
      title: `Prior public source ${index + 1}`,
      publisher: `Prior publisher ${index + 1}`,
      contentHash: sha256({ content: index + 1 }),
    });
    store.recordEvidence(first.assignmentHash, {
      id: `prior_evidence_${index + 1}`,
      sourceSnapshotHash: snapshotHash,
      truthClass: index < 5 ? "model_inference" : "unknown",
      polarity: index < 5 ? "contrary" : "unknown",
      questionId: questions[index % questions.length],
      criterionId: `adverse_group_${(index % 19) + 1}`,
      claim: `Adverse evidence group ${index + 1} remains unresolved.`,
      confidence: "medium",
      details: { boundedGroup: index + 1 },
    });
  }
  store.appendCostEvent(first.assignmentHash, {
    costKey: `preventure:${authority.authorityHash}:${first.assignmentHash}:attempt_prior_1`,
    eventType: "estimated",
    amountAudCents: 10,
    exposureAudCents: 10,
    taskAttemptId: "attempt_prior_1",
    modelCallId: "model_call_prior_1",
    agentRunReceiptId: "receipt_prior_1",
    receiptHash,
    occurredAt: "2026-08-02T12:04:00+10:00",
  });
  const ordinaryReadLedger = store.readLedger;
  const exactStore = Object.create(store);
  exactStore.readLedger = (authorityHash) => ({
    ...ordinaryReadLedger(authorityHash),
    executionEvidence: {
      taskAttempts: [{
        id: "attempt_prior_1",
        taskId: first.taskId,
        status: "completed",
        outcomeStatus: "known",
      }],
      modelCalls: [],
      agentRunReceipts: [{
        id: "receipt_prior_1",
        attemptId: "attempt_prior_1",
        taskId: first.taskId,
        sequence: 1,
        status: "complete",
        outcomeStatus: "known",
        missingFields: [],
        receiptHash,
      }],
    },
  });
  const resolve = () => resolvePreventureResearchExecutionDescriptor({
    store: exactStore,
    authorityHash: authority.authorityHash,
    assignmentId: second.id,
    expectedAssignmentHash: second.assignmentHash,
    clock: () => "2026-08-02T12:05:00+10:00",
  });
  const descriptor = resolve();
  const repeated = resolve();
  const prompt = JSON.parse(descriptor.request.requestBody.input[0].content[0].text);
  const prior = prompt.retainedPriorEvidence;
  assert.equal(descriptor.descriptorHash, repeated.descriptorHash);
  assert.ok(descriptor.request.providerVisibleInputUtf8ByteLength <= 30_000);
  assert.equal(prior.materialEvidenceSummary.count, 60);
  assert.equal(prior.materialEvidenceSummary.fullGroupCount, 60);
  assert.equal(prior.materialEvidenceSummary.groups.length, 6);
  assert.equal(prior.materialEvidenceSummary.omittedGroupCount, 54);
  assert.equal(prior.compaction.fullMaterialGroupCount, 60);
  assert.equal(prior.compaction.selectedMaterialGroupRepresentativeCount, 6);
  assert.equal(prior.compaction.omittedMaterialGroupRepresentativeCount, 54);
  assert.equal(prior.evidenceRecords.length, 6);
  const representativeHashes = new Set(
    prior.materialEvidenceSummary.groups.map((item) => item.representativeEvidenceHash),
  );
  assert.ok(prior.evidenceRecords.every((item) => representativeHashes.has(item.evidenceHash)));
  assert.equal(
    prior.compaction.selectedMaterialGroupRepresentativeSetHash,
    sha256([...representativeHashes].sort()),
  );
});

test("assignment two cannot be described, claimed, or dispatched before assignment one is complete", async () => {
  const store = activatedStore();
  const materialized = materializePreventureResearchAssignments(store, authority.authorityHash, {
    expectedAuthorityHash: authority.authorityHash,
    assignedAt: "2026-08-02T12:03:00+10:00",
  });
  const first = materialized.assignments[0];
  const second = materialized.assignments[1];
  const activation = store.loadLifecycle(authority.authorityHash)
    .find((event) => event.eventType === "activated");
  const firstDescriptor = createPreventureResearchExecutionDescriptor(
    authority,
    first,
    authority.assignments.find((item) => item.id === first.id),
    activation,
  );
  const dependencies = exactRunnerDependencies({ descriptor: firstDescriptor, store });
  let preflighted = false;
  let claimed = false;
  dependencies.transport.preflight = async () => {
    preflighted = true;
    throw new Error("Preflight must not run.");
  };
  dependencies.claims.claim = async () => {
    claimed = true;
    throw new Error("Claim must not run.");
  };
  await assert.rejects(
    runPreventureResearchAssignment({
      store,
      authorityHash: authority.authorityHash,
      assignmentId: second.id,
      expectedAssignmentHash: second.assignmentHash,
      clock: () => "2026-08-02T12:04:00+10:00",
      ...dependencies,
    }),
    /known cost truth, retained evidence, and one final immutable receipt|prior evidence/i,
  );
  assert.equal(preflighted, false);
  assert.equal(claimed, false);
  assert.equal(store.readLedger(authority.authorityHash).costEvents.length, 0);
});

test("transport mismatch is blocked before claim, cost reservation, or provider dispatch", async () => {
  const store = activatedStore();
  const materialized = materializePreventureResearchAssignments(store, authority.authorityHash, {
    expectedAuthorityHash: authority.authorityHash,
    assignedAt: "2026-08-02T12:03:00+10:00",
  });
  const assignment = materialized.assignments[0];
  const activation = store.loadLifecycle(authority.authorityHash).find((event) => event.eventType === "activated");
  const descriptor = createPreventureResearchExecutionDescriptor(
    authority,
    assignment,
    authority.assignments.find((item) => item.id === assignment.id),
    activation,
  );
  const dependencies = exactRunnerDependencies({ descriptor, store });
  let claimed = false;
  dependencies.claims.claim = async () => {
    claimed = true;
    throw new Error("Claim should not run.");
  };
  dependencies.transport.preflight = async () => ({
    ready: true,
    provider: descriptor.provider,
    endpoint: "https://example.com/v1/responses",
    method: "POST",
    requestBodyHash: descriptor.request.requestBodyHash,
    responseStorage: false,
    toolTypes: ["web_search"],
  });
  await assert.rejects(
    runPreventureResearchAssignment({
      store,
      authorityHash: authority.authorityHash,
      assignmentId: assignment.id,
      expectedAssignmentHash: assignment.assignmentHash,
      expectedDescriptorHash: descriptor.descriptorHash,
      clock: () => "2026-08-02T12:04:00+10:00",
      ...dependencies,
    }),
    /network transport does not match/i,
  );
  assert.equal(claimed, false);
  assert.equal(store.readLedger(authority.authorityHash).costEvents.length, 0);
});

test("a missing shared runtime clock is blocked before claim or provider effect", async () => {
  const store = activatedStore();
  const materialized = materializePreventureResearchAssignments(store, authority.authorityHash, {
    expectedAuthorityHash: authority.authorityHash,
    assignedAt: "2026-08-02T12:03:00+10:00",
  });
  const assignment = materialized.assignments[0];
  const activation = store.loadLifecycle(authority.authorityHash)
    .find((event) => event.eventType === "activated");
  const descriptor = createPreventureResearchExecutionDescriptor(
    authority,
    assignment,
    authority.assignments.find((item) => item.id === assignment.id),
    activation,
  );
  const dependencies = exactRunnerDependencies({ descriptor, store });
  let claimed = false;
  let dispatched = false;
  dependencies.claims.claim = async () => {
    claimed = true;
    throw new Error("Claim must not run without the shared clock.");
  };
  dependencies.transport.dispatch = async () => {
    dispatched = true;
    throw new Error("Provider must not run without the shared clock.");
  };
  await assert.rejects(
    runPreventureResearchAssignment({
      store,
      authorityHash: authority.authorityHash,
      assignmentId: assignment.id,
      expectedAssignmentHash: assignment.assignmentHash,
      expectedDescriptorHash: descriptor.descriptorHash,
      ...dependencies,
    }),
    { code: "preventure_research_time_invalid" },
  );
  assert.equal(claimed, false);
  assert.equal(dispatched, false);
  assert.equal(store.readLedger(authority.authorityHash).costEvents.length, 0);
});

test("a malformed known 2xx provider effect is retained, never retried, and can enter terminal custody", async () => {
  const store = activatedStore();
  const materialized = materializePreventureResearchAssignments(store, authority.authorityHash, {
    expectedAuthorityHash: authority.authorityHash,
    assignedAt: "2026-08-02T12:03:00+10:00",
  });
  const assignment = materialized.assignments[0];
  const activation = store.loadLifecycle(authority.authorityHash)
    .find((event) => event.eventType === "activated");
  const descriptor = createPreventureResearchExecutionDescriptor(
    authority,
    assignment,
    authority.assignments.find((item) => item.id === assignment.id),
    activation,
  );
  const dependencies = exactRunnerDependencies({ descriptor, store });
  let unknownMarked = false;
  dependencies.transport.dispatch = async () => ({
    outcomeStatus: "known_effect_invalid",
    provider: descriptor.provider,
    model: descriptor.model,
    endpoint: OFFICIAL_OPENAI_RESPONSES_URL,
    requestBodyHash: descriptor.request.requestBodyHash,
    httpStatus: 200,
    providerRequestId: "req_malformed_1",
    providerResponseId: null,
    clientRequestId: "pantheon-preventure-client-exact-1",
    rawProviderBody: "{malformed-json",
    rawProviderBodyHash: sha256("{malformed-json"),
    providerResponse: null,
    providerResponseHash: null,
    providerResponseJsonParsed: false,
    costAudCents: null,
    costStatus: "unknown",
    issues: ["response_body_unparseable", "usage_missing"],
  });
  dependencies.claims.markKnownResultUnknownCost = async (input) => {
    unknownMarked = true;
    assert.equal(input.retainedOutput.rawProviderBodyHash, sha256("{malformed-json"));
    assert.equal(input.retainedOutput.artifactKind, "known_effect_invalid");
    assert.equal(input.clientRequestId, "pantheon-preventure-client-exact-1");
  };
  const result = await runPreventureResearchAssignment({
    store,
    authorityHash: authority.authorityHash,
    assignmentId: assignment.id,
    expectedAssignmentHash: assignment.assignmentHash,
    expectedDescriptorHash: descriptor.descriptorHash,
    clock: () => "2026-08-02T12:04:00+10:00",
    ...dependencies,
  });
  assert.equal(result.status, "known_provider_effect_invalid");
  assert.equal(result.retryAuthorized, false);
  assert.equal(result.costAudCents, null);
  assert.equal(result.exposureAudCents, assignment.maxCostAudCents);
  assert.equal(unknownMarked, true);
  const readiness = evaluatePreventureResearchReadiness(
    store.readLedger(authority.authorityHash),
    store.readState(authority.authorityHash),
  );
  assert.equal(readiness.budget.unknownCostCount, 1);
  assert.equal(readiness.budget.exposureAudCents, assignment.maxCostAudCents);

  const latest = store.loadLifecycle(authority.authorityHash).at(-1);
  terminatePreventureResearchAuthority(store, authority.authorityHash, "revoked", {
    expectedLatestEventHash: latest.eventHash,
    occurredAt: "2026-08-02T12:05:00+10:00",
    reason: "Terminal custody must preserve a malformed response without treating it as evidence.",
  });
  dependencies.claims.inspectProviderArtifactCustody = async (input) => ({
    inspected: true,
    custodyRequired: true,
    activeReprocessAllowed: false,
    terminalState: "revoked",
    emergencyStopped: false,
    authorityHash: input.authorityHash,
    assignmentHash: input.assignmentHash,
    descriptorHash: input.descriptorHash,
    requestBodyHash: input.requestBodyHash,
    taskId: input.taskId,
    taskAttemptId: "attempt_exact_1",
    modelCallId: "model_call_exact_1",
    claimToken: "claim_exact_1",
    clientRequestId: input.clientRequestId,
    providerRequestId: input.providerRequestId,
    providerResponseId: input.providerResponseId,
    retainedOutputHash: input.retainedOutput.artifactHash,
    retainedOutputRef: input.retainedOutput.artifactRef,
    providerDispatchedAt: "2026-08-02T12:04:00+10:00",
    latestLifecycleEventHash: store.loadLifecycle(authority.authorityHash).at(-1).eventHash,
  });
  const commitTerminalCustody = dependencies.claims.commitTerminalProviderArtifactCustody;
  dependencies.claims.commitTerminalProviderArtifactCustody = async (input) => ({
    ...await commitTerminalCustody(input),
    terminalState: "revoked",
    emergencyStopped: false,
  });
  const recovered = await reprocessRetainedPreventureOutput({
    store,
    authorityHash: authority.authorityHash,
    assignmentId: assignment.id,
    expectedAssignmentHash: assignment.assignmentHash,
    expectedDescriptorHash: descriptor.descriptorHash,
    retainedOutputRef: "retained_1",
    claims: dependencies.claims,
    outputStore: dependencies.outputStore,
    parser: {
      kind: EXACT_LOCAL_PARSER_KIND,
      async parse() {
        throw new Error("Malformed terminal custody must never parse commercial evidence.");
      },
    },
    clock: () => "2026-08-02T12:06:00+10:00",
  });
  assert.equal(recovered.status, "terminal_provider_artifact_retained_pending_reconciliation");
  assert.equal(recovered.retainedOutput.artifactKind, "known_effect_invalid");
  assert.equal(recovered.costStatus, "unknown");
  assert.equal(recovered.exposureAudCents, assignment.maxCostAudCents);
  assert.equal(recovered.retryAuthorized, false);
  assert.equal(store.readLedger(authority.authorityHash).sourceSnapshots.length, 0);
  assert.equal(store.readLedger(authority.authorityHash).evidenceRecords.length, 0);
  assert.equal(store.readLedger(authority.authorityHash).decision, null);
  assert.equal(store.loadLifecycle(authority.authorityHash).at(-1).eventType, "revoked");
});

test("a retained ambiguous 4xx with known cost cannot enter the unusable-2xx terminal class or retry", async () => {
  const store = activatedStore();
  const materialized = materializePreventureResearchAssignments(store, authority.authorityHash, {
    expectedAuthorityHash: authority.authorityHash,
    assignedAt: "2026-08-02T12:03:00+10:00",
  });
  const assignment = materialized.assignments[0];
  const activation = store.loadLifecycle(authority.authorityHash)
    .find((event) => event.eventType === "activated");
  const descriptor = createPreventureResearchExecutionDescriptor(
    authority,
    assignment,
    authority.assignments.find((item) => item.id === assignment.id),
    activation,
  );
  const dependencies = exactRunnerDependencies({ descriptor, store });
  const providerResponse = {
    id: "resp_ambiguous_408_known_cost_1",
    error: { type: "request_timeout", code: "timeout", message: "Timed out." },
  };
  const rawProviderBody = JSON.stringify(providerResponse);
  dependencies.transport.dispatch = async () => ({
    outcomeStatus: "known_effect_invalid",
    provider: descriptor.provider,
    model: descriptor.model,
    endpoint: OFFICIAL_OPENAI_RESPONSES_URL,
    requestBodyHash: descriptor.request.requestBodyHash,
    httpStatus: 408,
    providerRequestId: "req_ambiguous_408_known_cost_1",
    providerResponseId: providerResponse.id,
    clientRequestId: "pantheon-preventure-client-exact-1",
    rawProviderBody,
    rawProviderBodyHash: sha256(rawProviderBody),
    providerResponse,
    providerResponseHash: sha256(providerResponse),
    providerResponseJsonParsed: true,
    costAudCents: 7,
    costStatus: "estimated",
    modelCallId: "model_call_exact_1",
    issues: ["response_http_status_408"],
  });
  let attentionInput = null;
  dependencies.claims.markKnownNeedsReprocess = async (input) => {
    attentionInput = input;
    return { reprocessEligible: false };
  };
  dependencies.claims.commitValidatedEarlyStop = async () => {
    throw new Error("An ambiguous 4xx must not enter the unusable 2xx terminal class.");
  };

  const result = await runPreventureResearchAssignment({
    store,
    authorityHash: authority.authorityHash,
    assignmentId: assignment.id,
    expectedAssignmentHash: assignment.assignmentHash,
    expectedDescriptorHash: descriptor.descriptorHash,
    clock: () => "2026-08-02T12:04:00+10:00",
    ...dependencies,
  });

  assert.equal(result.status, "known_provider_effect_needs_attention");
  assert.equal(result.httpStatus, 408);
  assert.equal(result.costAudCents, 7);
  assert.equal(result.exposureAudCents, 7);
  assert.equal(result.exactBillingPending, true);
  assert.equal(result.retryAuthorized, false);
  assert.equal(attentionInput.retainedOutput.artifactKind, "known_effect_invalid");
  assert.equal(attentionInput.retainedOutput.rawProviderBodyHash, sha256(rawProviderBody));
  const latestCost = store.readLedger(authority.authorityHash).costEvents.at(-1);
  assert.equal(latestCost.eventType, "estimated");
  assert.equal(latestCost.amountAudCents, 7);
  assert.equal(latestCost.exposureAudCents, 7);
});

test("retained known output after revocation records custody only without evidence or a decision", async () => {
  const store = activatedStore();
  const materialized = materializePreventureResearchAssignments(store, authority.authorityHash, {
    expectedAuthorityHash: authority.authorityHash,
    assignedAt: "2026-08-02T12:03:00+10:00",
  });
  const assignment = materialized.assignments[0];
  const activation = store.loadLifecycle(authority.authorityHash)
    .find((event) => event.eventType === "activated");
  const descriptor = createPreventureResearchExecutionDescriptor(
    authority,
    assignment,
    authority.assignments.find((item) => item.id === assignment.id),
    activation,
  );
  const dependencies = exactRunnerDependencies({ descriptor, store });
  const commitValidatedEarlyStop = dependencies.claims.commitValidatedEarlyStop;
  dependencies.claims.commitValidatedEarlyStop = async () => {
    throw new Error("Atomic terminal commit unavailable after immutable retention.");
  };
  const first = await runPreventureResearchAssignment({
    store,
    authorityHash: authority.authorityHash,
    assignmentId: assignment.id,
    expectedAssignmentHash: assignment.assignmentHash,
    expectedDescriptorHash: descriptor.descriptorHash,
    clock: () => "2026-08-02T12:04:00+10:00",
    ...dependencies,
  });
  assert.equal(first.status, "known_provider_result_needs_attention");
  first.retainedOutput.rawProviderBody = JSON.stringify(first.retainedOutput.providerResponse);
  first.retainedOutput.rawProviderBodyHash = sha256(first.retainedOutput.rawProviderBody);
  dependencies.claims.commitValidatedEarlyStop = commitValidatedEarlyStop;
  const costCount = store.readLedger(authority.authorityHash).costEvents.length;
  const latest = store.loadLifecycle(authority.authorityHash).at(-1);
  terminatePreventureResearchAuthority(store, authority.authorityHash, "revoked", {
    expectedLatestEventHash: latest.eventHash,
    occurredAt: "2026-08-02T12:05:00+10:00",
    reason: "Owner closure must not strand already retained provider truth.",
  });
  let custodyRecorded = false;
  const inspectCustody = dependencies.claims.inspectProviderArtifactCustody;
  dependencies.claims.inspectProviderArtifactCustody = async (input) => ({
    ...await inspectCustody(input),
    custodyRequired: true,
    activeReprocessAllowed: false,
    terminalState: "revoked",
    latestLifecycleEventHash: store.loadLifecycle(authority.authorityHash).at(-1).eventHash,
  });
  const commitTerminalCustody = dependencies.claims.commitTerminalProviderArtifactCustody;
  dependencies.claims.commitTerminalProviderArtifactCustody = async (input) => {
    custodyRecorded = true;
    assert.equal(input.reprocessing, true);
    assert.equal(input.claimToken, "claim_exact_1");
    const result = await commitTerminalCustody(input);
    return { ...result, terminalState: "revoked", emergencyStopped: false };
  };
  const recovered = await reprocessRetainedPreventureOutput({
    store,
    authorityHash: authority.authorityHash,
    assignmentId: assignment.id,
    expectedAssignmentHash: assignment.assignmentHash,
    expectedDescriptorHash: descriptor.descriptorHash,
    retainedOutputRef: "retained_1",
    claims: dependencies.claims,
    outputStore: dependencies.outputStore,
    parser: {
      kind: EXACT_LOCAL_PARSER_KIND,
      async parse() {
        throw new Error("Terminal retained custody must not parse or create commercial evidence.");
      },
    },
    clock: () => "2026-08-02T12:06:00+10:00",
  });
  assert.equal(recovered.status, "terminal_provider_artifact_retained_pending_reconciliation");
  assert.equal(recovered.reprocessedLocally, true);
  assert.equal(recovered.additionalAiCostAudCents, 0);
  assert.equal(recovered.retryAuthorized, false);
  assert.equal(recovered.terminalState, "revoked");
  assert.equal(custodyRecorded, true);
  assert.equal(store.readLedger(authority.authorityHash).costEvents.length, costCount);
  assert.equal(store.readLedger(authority.authorityHash).sourceSnapshots.length, 0);
  assert.equal(store.readLedger(authority.authorityHash).evidenceRecords.length, 0);
  assert.equal(store.readLedger(authority.authorityHash).decision, null);
  assert.equal(store.loadLifecycle(authority.authorityHash).at(-1).eventType, "revoked");
  assert.equal(
    store.loadLifecycle(authority.authorityHash)
      .some((event) => event.eventType === "completed"),
    false,
  );
});

test("unknown provider outcome consumes full assignment exposure and freezes every later dispatch", async () => {
  const store = activatedStore();
  const materialized = materializePreventureResearchAssignments(store, authority.authorityHash, {
    expectedAuthorityHash: authority.authorityHash,
    assignedAt: "2026-08-02T12:03:00+10:00",
  });
  const assignment = materialized.assignments[0];
  const activation = store.loadLifecycle(authority.authorityHash).find((event) => event.eventType === "activated");
  const descriptor = createPreventureResearchExecutionDescriptor(
    authority,
    assignment,
    authority.assignments.find((item) => item.id === assignment.id),
    activation,
  );
  let unknownMarked = false;
  const dependencies = exactRunnerDependencies({ descriptor, store }, {
    transport: {
      kind: EXACT_TRANSPORT_KIND,
      async preflight({ descriptor: exact }) {
        return {
          ready: true,
          provider: exact.provider,
          endpoint: OFFICIAL_OPENAI_RESPONSES_URL,
          method: "POST",
          requestBodyHash: exact.request.requestBodyHash,
          responseStorage: false,
          background: false,
          canonicalResponseRetention: true,
          estimatedInputTokens: 2000,
          toolTypes: ["web_search"],
          toolConfiguration: exact.request.requestBody.tools,
          groundingSources: [
            "web_search_call.action.sources",
            "message.output_text.annotations.url_citation",
          ],
        };
      },
      async dispatch() {
        throw new Error("Connection ended after dispatch.");
      },
    },
  });
  dependencies.claims.markUnknown = async () => {
    unknownMarked = true;
  };
  await assert.rejects(
    runPreventureResearchAssignment({
      store,
      authorityHash: authority.authorityHash,
      assignmentId: assignment.id,
      expectedAssignmentHash: assignment.assignmentHash,
      expectedDescriptorHash: descriptor.descriptorHash,
      clock: () => "2026-08-02T12:04:00+10:00",
      ...dependencies,
    }),
    /frozen and will not retry/i,
  );
  assert.equal(unknownMarked, true);
  const readiness = evaluatePreventureResearchReadiness(
    store.readLedger(authority.authorityHash),
    store.readState(authority.authorityHash),
  );
  assert.equal(readiness.budget.unknownCostCount, 1);
  assert.equal(readiness.budget.exposureAudCents, assignment.maxCostAudCents);
  assert.throws(
    () => assertPreventureResearchDispatchAuthority(
      store,
      authority.authorityHash,
      materialized.assignments[1].id,
    ),
    /not active and dispatchable|frozen/i,
  );
});

test("a late retained response records custody without overwriting emergency unknown truth", async () => {
  const store = activatedStore();
  const materialized = materializePreventureResearchAssignments(store, authority.authorityHash, {
    expectedAuthorityHash: authority.authorityHash,
    assignedAt: "2026-08-02T12:03:00+10:00",
  });
  const assignment = materialized.assignments[0];
  const activation = store.loadLifecycle(authority.authorityHash)
    .find((event) => event.eventType === "activated");
  const descriptor = createPreventureResearchExecutionDescriptor(
    authority,
    assignment,
    authority.assignments.find((item) => item.id === assignment.id),
    activation,
  );
  const dependencies = exactRunnerDependencies({ descriptor, store });
  let retained = false;
  let custodyRecorded = false;
  let unknownMarked = false;
  const originalRetain = dependencies.outputStore.retain;
  dependencies.outputStore.retain = async (input) => {
    retained = true;
    return originalRetain(input);
  };
  const originalDispatch = dependencies.transport.dispatch;
  dependencies.transport.dispatch = async (input) => {
    const result = await originalDispatch(input);
    const rawProviderBody = JSON.stringify(result.providerResponse);
    const billing = {
      currency: "AUD",
      costAudCents: result.costAudCents,
      costStatus: result.costStatus,
      modelCallId: "model_call_exact_1",
    };
    const retainedOutput = await dependencies.outputStore.retain({
      artifactKind: "canonical_known_response",
      assignmentMaxCostAudCents: assignment.maxCostAudCents,
      authorityHash: authority.authorityHash,
      assignmentHash: assignment.assignmentHash,
      descriptorHash: descriptor.descriptorHash,
      requestBodyHash: descriptor.request.requestBodyHash,
      clientRequestId: result.clientRequestId,
      providerRequestId: result.providerRequestId,
      providerResponseId: result.providerResponseId,
      providerResponse: result.providerResponse,
      providerResponseHash: sha256(result.providerResponse),
      rawProviderBody,
      rawProviderBodyHash: sha256(rawProviderBody),
      output: JSON.stringify({ retained: true }),
      groundedSources: [],
      groundedSourceSetHash: sha256([]),
      billing,
      billingHash: sha256(billing),
      responseMetadata: { httpStatus: 200, responseIssues: [] },
      retainedAt: "2026-08-02T12:04:00+10:00",
    });
    return { ...result, retainedOutput };
  };
  dependencies.claims.markUnknown = async () => {
    unknownMarked = true;
  };
  dependencies.claims.assertProviderResultClaim = async () => {
    const reserved = store.readLedger(authority.authorityHash).costEvents.at(-1);
    store.appendCostEvent(assignment.assignmentHash, {
      costKey: reserved.costKey,
      eventType: "unknown",
      amountAudCents: null,
      exposureAudCents: assignment.maxCostAudCents,
      taskAttemptId: "attempt_exact_1",
      modelCallId: "model_call_exact_1",
      occurredAt: "2026-08-02T12:04:01+10:00",
    });
    const error = new Error("Operator emergency stop won the claim race.");
    error.code = "preventure_bridge_claim_changed";
    throw error;
  };
  const originalCustody = dependencies.claims.commitTerminalProviderArtifactCustody;
  dependencies.claims.commitTerminalProviderArtifactCustody = async (input) => {
    custodyRecorded = true;
    assert.equal(input.retainedOutput.rawProviderBodyHash, sha256(
      JSON.stringify(input.retainedOutput.providerResponse),
    ));
    return originalCustody(input);
  };
  const result = await runPreventureResearchAssignment({
    store,
    authorityHash: authority.authorityHash,
    assignmentId: assignment.id,
    expectedAssignmentHash: assignment.assignmentHash,
    expectedDescriptorHash: descriptor.descriptorHash,
    clock: () => "2026-08-02T12:04:00+10:00",
    ...dependencies,
  });
  const costs = store.readLedger(authority.authorityHash).costEvents;
  assert.deepEqual(costs.map((item) => item.eventType), ["reserved", "unknown"]);
  assert.equal(costs.at(-1).exposureAudCents, assignment.maxCostAudCents);
  assert.equal(result.status, "terminal_provider_artifact_retained_pending_reconciliation");
  assert.equal(result.costStatus, "unknown");
  assert.equal(result.costAudCents, null);
  assert.equal(result.exposureAudCents, assignment.maxCostAudCents);
  assert.equal(result.retryAuthorized, false);
  assert.equal(result.additionalAiCostAudCents, 0);
  assert.equal(retained, true);
  assert.equal(custodyRecorded, true);
  assert.equal(unknownMarked, false);
});

test("a late transport failure cannot mutate state after the dispatch claim is emergency-stopped", async () => {
  const store = activatedStore();
  const materialized = materializePreventureResearchAssignments(store, authority.authorityHash, {
    expectedAuthorityHash: authority.authorityHash,
    assignedAt: "2026-08-02T12:03:00+10:00",
  });
  const assignment = materialized.assignments[0];
  const activation = store.loadLifecycle(authority.authorityHash)
    .find((event) => event.eventType === "activated");
  const descriptor = createPreventureResearchExecutionDescriptor(
    authority,
    assignment,
    authority.assignments.find((item) => item.id === assignment.id),
    activation,
  );
  const dependencies = exactRunnerDependencies({ descriptor, store });
  let unknownMarked = false;
  dependencies.transport.dispatch = async () => {
    throw new Error("The socket closed after the emergency supervisor sealed unknown truth.");
  };
  dependencies.claims.markUnknown = async () => {
    unknownMarked = true;
  };
  dependencies.claims.assertProviderResultClaim = async () => {
    const reserved = store.readLedger(authority.authorityHash).costEvents.at(-1);
    store.appendCostEvent(assignment.assignmentHash, {
      costKey: reserved.costKey,
      eventType: "unknown",
      amountAudCents: null,
      exposureAudCents: assignment.maxCostAudCents,
      taskAttemptId: "attempt_exact_1",
      modelCallId: "model_call_exact_1",
      occurredAt: "2026-08-02T12:04:01+10:00",
    });
    const error = new Error("Operator emergency stop won the claim race.");
    error.code = "preventure_bridge_claim_changed";
    throw error;
  };
  await assert.rejects(
    runPreventureResearchAssignment({
      store,
      authorityHash: authority.authorityHash,
      assignmentId: assignment.id,
      expectedAssignmentHash: assignment.assignmentHash,
      expectedDescriptorHash: descriptor.descriptorHash,
      clock: () => "2026-08-02T12:04:00+10:00",
      ...dependencies,
    }),
    (error) => error.code === "preventure_research_late_provider_result_ignored"
      && error.claimChanged === true,
  );
  const costs = store.readLedger(authority.authorityHash).costEvents;
  assert.deepEqual(costs.map((item) => item.eventType), ["reserved", "unknown"]);
  assert.equal(costs.at(-1).exposureAudCents, assignment.maxCostAudCents);
  assert.equal(unknownMarked, false);
});

test("definite pre-effect rejection keeps full exposure pending and seals a no-retry terminal stop", async () => {
  const store = activatedStore();
  const materialized = materializePreventureResearchAssignments(store, authority.authorityHash, {
    expectedAuthorityHash: authority.authorityHash,
    assignedAt: "2026-08-02T12:03:00+10:00",
  });
  const assignment = materialized.assignments[0];
  const activation = store.loadLifecycle(authority.authorityHash)
    .find((event) => event.eventType === "activated");
  const descriptor = createPreventureResearchExecutionDescriptor(
    authority,
    assignment,
    authority.assignments.find((item) => item.id === assignment.id),
    activation,
  );
  const dependencies = exactRunnerDependencies({ descriptor, store });
  let unknownMarked = false;
  dependencies.transport.dispatch = async ({ clientRequestId }) => {
    const rawProviderBody = JSON.stringify({
      error: {
        type: "invalid_request_error",
        code: "invalid_request",
        message: "The request was rejected before execution.",
      },
    });
    const billing = {
      currency: "AUD",
      costAudCents: 0,
      costStatus: "estimated",
      exactBillingPending: true,
      exposureAudCents: assignment.maxCostAudCents,
      providerZeroBillingGuarantee: false,
    };
    const responseMetadata = {
      httpStatus: 400,
      providerErrorType: "invalid_request_error",
      providerErrorCode: "invalid_request",
    };
    const error = new Error("The provider rejected the request before execution.");
    error.kind = "definite_pre_effect_http_rejection";
    error.definitePreEffect = true;
    error.providerOutcomeKnown = true;
    error.costAudCents = 0;
    error.costStatus = "estimated";
    error.exactBillingPending = true;
    error.exposureAudCents = assignment.maxCostAudCents;
    error.providerZeroBillingGuarantee = false;
    error.httpStatus = 400;
    error.providerRequestId = "req_provider_rejection_1";
    error.providerErrorType = "invalid_request_error";
    error.providerErrorCode = "invalid_request";
    error.retainedOutput = {
      retained: true,
      artifactKind: "known_pre_effect_rejection",
      assignmentMaxCostAudCents: assignment.maxCostAudCents,
      artifactHash: sha256({ rawProviderBody, billing, responseMetadata }),
      artifactRef: "retained_pre_effect_1",
      location: "C:\\tmp\\preventure-pre-effect.json",
      authorityHash: authority.authorityHash,
      assignmentHash: assignment.assignmentHash,
      descriptorHash: descriptor.descriptorHash,
      requestBodyHash: descriptor.request.requestBodyHash,
      clientRequestId,
      providerRequestId: "req_provider_rejection_1",
      providerResponseId: null,
      rawProviderBody,
      rawProviderBodyHash: sha256(rawProviderBody),
      billing,
      billingHash: sha256(billing),
      responseMetadata,
    };
    throw error;
  };
  dependencies.claims.markUnknown = async () => {
    unknownMarked = true;
  };
  const result = await runPreventureResearchAssignment({
    store,
    authorityHash: authority.authorityHash,
    assignmentId: assignment.id,
    expectedAssignmentHash: assignment.assignmentHash,
    expectedDescriptorHash: descriptor.descriptorHash,
    clock: () => "2026-08-02T12:04:00+10:00",
    ...dependencies,
  });
  assert.equal(result.status, "completed_validated_early_stop");
  assert.equal(result.triggerOutcomeClass, "known_failed_before_effect");
  assert.equal(result.costAudCents, 0);
  assert.equal(result.exposureAudCents, assignment.maxCostAudCents);
  assert.equal(result.exactBillingPending, true);
  assert.equal(result.retryAuthorized, false);
  assert.equal(unknownMarked, false);
  const readiness = evaluatePreventureResearchReadiness(
    store.readLedger(authority.authorityHash),
    store.readState(authority.authorityHash),
  );
  assert.equal(readiness.budget.exposureAudCents, assignment.maxCostAudCents);
  assert.equal(readiness.budget.unknownCostCount, 0);
});

test("revocation binds the latest event and permanently disables dispatch", () => {
  const store = activatedStore();
  const latest = store.loadLifecycle(authority.authorityHash).at(-1);
  assert.throws(
    () => terminatePreventureResearchAuthority(store, authority.authorityHash, "revoked", {
      expectedLatestEventHash: sha256({ stale: true }),
      occurredAt: "2026-08-02T12:03:00+10:00",
      reason: "The owner stopped the bounded diligence round.",
    }),
    /latest event changed/i,
  );
  const stopped = terminatePreventureResearchAuthority(store, authority.authorityHash, "revoked", {
    expectedLatestEventHash: latest.eventHash,
    occurredAt: "2026-08-02T12:03:00+10:00",
    reason: "The owner stopped the bounded diligence round.",
  });
  assert.equal(stopped.state.terminal, true);
  assert.equal(stopped.state.dispatchAllowed, false);
  assert.throws(
    () => createPreventureResearchAssignmentPlan(
      authority,
      store.loadLifecycle(authority.authorityHash),
    ),
    /current exact activation/i,
  );
});
