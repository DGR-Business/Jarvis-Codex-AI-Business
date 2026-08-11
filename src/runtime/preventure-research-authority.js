"use strict";

const {
  TERMINAL_EVENT_TYPES,
  effectivePreventureLifecycleState,
  preventureResearchApprovalScope,
  preventureResearchApprovalScopeHash,
  validatePreventureLifecycleChain,
} = require("./preventure-research-contract");
const { sha256 } = require("./commercial-test-contract");

const PREVENTURE_RESEARCH_WORK_BINDING_SCHEMA =
  "pantheon.preventure-research-work-binding.v1";
const APPROVED_LIFECYCLE_TRANSITIONS = Object.freeze({
  accepted: "proposed",
  activated: "accepted",
});
const TERMINAL_STATES = new Set(TERMINAL_EVENT_TYPES);
const HASH_PATTERN = /^sha256:[a-f0-9]{64}$/;

function authorityError(code, message, statusCode = 409) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asTimestamp(value, label) {
  const result = value instanceof Date ? value.toISOString() : String(value || "").trim();
  if (!result || !Number.isFinite(Date.parse(result))) {
    throw authorityError("preventure_research_time_invalid", `${label} is not a valid timestamp.`, 400);
  }
  return result;
}

function currentTimestamp(clock) {
  return asTimestamp(typeof clock === "function" ? clock() : new Date(), "Runtime clock");
}

function assertHash(value, label) {
  if (!HASH_PATTERN.test(String(value || ""))) {
    throw authorityError("preventure_research_hash_invalid", `${label} is not a valid SHA-256 hash.`, 400);
  }
  return value;
}

function assertStore(store) {
  const required = [
    "appendLifecycle",
    "getAuthority",
    "listAssignments",
    "listAuthorities",
    "loadLifecycle",
    "readLedger",
    "readState",
    "registerAuthority",
    "verifyLedger",
  ];
  if (!isObject(store) || required.some((name) => typeof store[name] !== "function")) {
    throw authorityError(
      "preventure_research_store_invalid",
      "The immutable pre-venture research store is unavailable or incomplete.",
      500,
    );
  }
  return store;
}

function assertAuthorityShape(authority) {
  if (!isObject(authority)) {
    throw authorityError("preventure_research_authority_missing", "The exact research authority is unavailable.");
  }
  assertHash(authority.authorityHash, "Research authority hash");
  if (authority.preparationOnly !== true) {
    throw authorityError(
      "preventure_research_not_preparation_only",
      "Pre-venture research authority must remain preparation-only.",
    );
  }
  if (
    authority.externalCommercialSpendCapAudCents !== 0
    || authority.internalAiSpendCapAudCents !== 200
  ) {
    throw authorityError(
      "preventure_research_cap_changed",
      "The exact A$2 internal and A$0 external research limits changed.",
    );
  }
  if (!Array.isArray(authority.assignments) || authority.assignments.length === 0) {
    throw authorityError(
      "preventure_research_assignments_missing",
      "The authority contains no exact research assignments.",
    );
  }
  const total = authority.assignments.reduce(
    (sum, assignment) => sum + Number(assignment?.maxCostAudCents || 0),
    0,
  );
  if (!Number.isSafeInteger(total) || total > authority.internalAiSpendCapAudCents) {
    throw authorityError(
      "preventure_research_assignment_cap_invalid",
      "The exact assignment plan exceeds the A$2 research ceiling.",
    );
  }
  return authority;
}

function preventureLifecycleApprovalScope(authorityInput, eventType) {
  const authority = assertAuthorityShape(authorityInput);
  if (!Object.hasOwn(APPROVED_LIFECYCLE_TRANSITIONS, eventType)) {
    throw authorityError(
      "preventure_research_transition_invalid",
      "Only acceptance and activation use the pre-venture lifecycle approval scope.",
      400,
    );
  }
  return preventureResearchApprovalScope(authority, eventType);
}

function preventureLifecycleApprovalScopeHash(authority, eventType) {
  assertAuthorityShape(authority);
  return preventureResearchApprovalScopeHash(authority, eventType);
}

function sameExactValue(left, right) {
  return sha256(left) === sha256(right);
}

function validatePreventureLifecycleApproval(
  authority,
  eventType,
  approval,
  options = {},
) {
  if (!isObject(approval) || typeof approval.id !== "string" || !approval.id.trim()) {
    throw authorityError(
      "preventure_research_approval_missing",
      `The exact ${eventType} owner approval is unavailable.`,
    );
  }
  const expectedStatus = options.expectedStatus || "approved";
  if (approval.status !== expectedStatus) {
    throw authorityError(
      "preventure_research_approval_status_invalid",
      `The exact ${eventType} owner approval is not ${expectedStatus}.`,
    );
  }
  if (approval.consumedAt || approval.consumed_at) {
    throw authorityError(
      "preventure_research_approval_consumed",
      "This pre-venture lifecycle approval has already been used.",
    );
  }
  const exactScope = preventureLifecycleApprovalScope(authority, eventType);
  const exactScopeHash = sha256(exactScope);
  const suppliedScope = approval.scope || approval.approvalScope || null;
  const suppliedHash = approval.scopeHash || approval.scope_hash || approval.approvalScopeHash || null;
  if (!isObject(suppliedScope) || !sameExactValue(suppliedScope, exactScope) || suppliedHash !== exactScopeHash) {
    throw authorityError(
      "preventure_research_approval_scope_changed",
      "Refresh this research decision before acting; its exact scope changed.",
    );
  }
  const expiresAt = approval.expiresAt || approval.expires_at || null;
  const nowAt = currentTimestamp(options.clock);
  if (expiresAt && (!Number.isFinite(Date.parse(expiresAt)) || Date.parse(expiresAt) <= Date.parse(nowAt))) {
    throw authorityError(
      "preventure_research_approval_expired",
      "This pre-venture lifecycle approval expired.",
    );
  }
  return { approvalId: approval.id, exactScope, exactScopeHash };
}

function assertNoCompetingAuthority(storeInput, authorityHash) {
  const store = assertStore(storeInput);
  const competing = store.listAuthorities().filter((authority) => {
    if (authority.authorityHash === authorityHash) return false;
    const state = store.readState(authority.authorityHash);
    return !state.terminal;
  });
  if (competing.length > 0) {
    throw authorityError(
      "preventure_research_authority_ambiguous",
      "Another nonterminal pre-venture research authority exists. Pantheon will not choose between them.",
    );
  }
}

function assertLedgerIntegrity(store) {
  const result = store.verifyLedger();
  if (!isObject(result) || result.ok !== true) {
    throw authorityError(
      "preventure_research_ledger_invalid",
      "The pre-venture research ledger could not be verified.",
      500,
    );
  }
  return result;
}

function eventId(eventType, authorityHash) {
  return `preventure_${eventType}_${authorityHash.slice("sha256:".length, "sha256:".length + 24)}`;
}

function registerPreventureResearchProposal(
  storeInput,
  authorityInput,
  readinessSpec,
  input = {},
) {
  const store = assertStore(storeInput);
  const authority = assertAuthorityShape(authorityInput);
  assertLedgerIntegrity(store);
  assertNoCompetingAuthority(store, authority.authorityHash);
  const occurredAt = asTimestamp(input.occurredAt || currentTimestamp(input.clock), "Proposal time");
  if (Date.parse(occurredAt) >= Date.parse(authority.expiresAt)) {
    throw authorityError(
      "preventure_research_authority_expired",
      "The exact pre-venture research authority expired before proposal registration.",
    );
  }
  const registration = store.registerAuthority(authority, readinessSpec);
  const events = store.loadLifecycle(authority.authorityHash);
  validatePreventureLifecycleChain(authority, events);
  let proposed;
  if (events.length === 0) {
    proposed = store.appendLifecycle(authority.authorityHash, {
      id: input.eventId || eventId("proposed", authority.authorityHash),
      eventType: "proposed",
      occurredAt,
      actor: input.actor || "jarvis",
      reason: input.reason || "The exact preparation-only research authority was registered for owner review.",
      metadata: {
        buildAuthorized: false,
        commercialTestAuthorized: false,
        externalActionAuthorized: false,
      },
    });
  } else if (events.at(-1).eventType !== "proposed") {
    throw authorityError(
      "preventure_research_proposal_already_advanced",
      "This research authority already advanced beyond proposal review.",
    );
  } else {
    proposed = { created: false, event: events.at(-1) };
  }
  assertLedgerIntegrity(store);
  return {
    created: registration.created || proposed.created,
    authority: registration.authority,
    event: proposed.event,
    acceptanceScope: preventureLifecycleApprovalScope(authority, "accepted"),
    acceptanceScopeHash: preventureLifecycleApprovalScopeHash(authority, "accepted"),
  };
}

function advancePreventureResearchLifecycle(
  storeInput,
  authorityHash,
  eventType,
  approval,
  input = {},
) {
  const store = assertStore(storeInput);
  assertLedgerIntegrity(store);
  const authority = store.getAuthority(authorityHash);
  assertAuthorityShape(authority);
  assertNoCompetingAuthority(store, authorityHash);
  if (!Object.hasOwn(APPROVED_LIFECYCLE_TRANSITIONS, eventType)) {
    throw authorityError(
      "preventure_research_transition_invalid",
      "Only exact acceptance or activation can advance this authority.",
      400,
    );
  }
  const state = store.readState(authorityHash);
  validatePreventureLifecycleChain(authority, store.loadLifecycle(authorityHash));
  if (state.state !== APPROVED_LIFECYCLE_TRANSITIONS[eventType]) {
    throw authorityError(
      "preventure_research_transition_stale",
      `The authority is ${state.state}, not ${APPROVED_LIFECYCLE_TRANSITIONS[eventType]}.`,
    );
  }
  const occurredAt = asTimestamp(input.occurredAt || currentTimestamp(input.clock), "Lifecycle decision time");
  if (state.expired || Date.parse(occurredAt) >= Date.parse(authority.expiresAt)) {
    throw authorityError(
      "preventure_research_authority_expired",
      "This exact research authority expired and cannot advance.",
    );
  }
  const exact = validatePreventureLifecycleApproval(authority, eventType, approval, {
    clock: () => occurredAt,
  });
  const appended = store.appendLifecycle(authorityHash, {
    id: input.eventId || eventId(eventType, authorityHash),
    eventType,
    approvalId: exact.approvalId,
    approvalScope: exact.exactScope,
    occurredAt,
    actor: input.actor || "owner",
    reason: input.reason || `The owner approved the exact ${eventType} preparation-only research step.`,
    metadata: {
      internalAiSpendCapAudCents: authority.internalAiSpendCapAudCents,
      externalCommercialSpendCapAudCents: 0,
      buildAuthorized: false,
      commercialTestAuthorized: false,
      externalActionAuthorized: false,
    },
  });
  assertLedgerIntegrity(store);
  const result = {
    created: appended.created,
    authority,
    event: appended.event,
    state: store.readState(authorityHash),
  };
  if (eventType === "accepted") {
    result.activationScope = preventureLifecycleApprovalScope(authority, "activated");
    result.activationScopeHash = preventureLifecycleApprovalScopeHash(authority, "activated");
  }
  return result;
}

function terminatePreventureResearchAuthority(
  storeInput,
  authorityHash,
  eventType,
  input = {},
) {
  const store = assertStore(storeInput);
  if (!["revoked", "expired", "revised", "superseded"].includes(eventType)) {
    throw authorityError(
      "preventure_research_terminal_event_invalid",
      "The requested terminal research event is unsupported.",
      400,
    );
  }
  assertLedgerIntegrity(store);
  const authority = store.getAuthority(authorityHash);
  assertAuthorityShape(authority);
  const events = store.loadLifecycle(authorityHash);
  validatePreventureLifecycleChain(authority, events);
  const latest = events.at(-1);
  if (!latest || TERMINAL_STATES.has(latest.eventType)) {
    throw authorityError(
      "preventure_research_already_terminal",
      "This pre-venture research authority is already terminal.",
    );
  }
  if (!input.expectedLatestEventHash || input.expectedLatestEventHash !== latest.eventHash) {
    throw authorityError(
      "preventure_research_terminal_scope_stale",
      "Refresh the research authority before stopping it; its latest event changed.",
    );
  }
  const occurredAt = asTimestamp(input.occurredAt || currentTimestamp(input.clock), "Terminal event time");
  if (eventType === "expired" && Date.parse(occurredAt) < Date.parse(authority.expiresAt)) {
    throw authorityError(
      "preventure_research_expiry_early",
      "This research authority has not reached its fixed expiry.",
    );
  }
  const appended = store.appendLifecycle(authorityHash, {
    id: input.eventId || eventId(eventType, authorityHash),
    eventType,
    occurredAt,
    actor: input.actor || (eventType === "expired" ? "pantheon" : "owner"),
    reason: input.reason || `The preparation-only research authority was ${eventType}.`,
    metadata: {
      expectedPreviousEventHash: latest.eventHash,
      dispatchDisabled: true,
      buildAuthorized: false,
      commercialTestAuthorized: false,
      externalActionAuthorized: false,
    },
  });
  assertLedgerIntegrity(store);
  return { ...appended, state: store.readState(authorityHash) };
}

function assertPreventureResearchDispatchAuthority(
  storeInput,
  authorityHash,
  assignmentId,
  options = {},
) {
  const store = assertStore(storeInput);
  assertLedgerIntegrity(store);
  const authority = store.getAuthority(authorityHash);
  assertAuthorityShape(authority);
  const state = store.readState(authorityHash);
  const lifecycle = store.loadLifecycle(authorityHash);
  validatePreventureLifecycleChain(authority, lifecycle);
  const effectiveState = effectivePreventureLifecycleState(
    authority,
    lifecycle,
    options.at || currentTimestamp(options.clock),
  );
  if (
    effectiveState !== "activated"
    || state.state !== "activated"
    || state.terminal
    || state.expired
    || state.dispatchAllowed !== true
    || state.decisionHash
  ) {
    throw authorityError(
      "preventure_research_dispatch_not_authorized",
      "The exact preparation-only authority is not active and dispatchable.",
    );
  }
  if (state.unknownProviderOutcomeCount !== 0 || state.unknownCostCount !== 0) {
    throw authorityError(
      "preventure_research_dispatch_frozen",
      "Research dispatch is frozen because a provider or cost outcome is unknown.",
    );
  }
  const assignment = store.listAssignments(authorityHash).find(
    (candidate) => candidate.id === assignmentId,
  );
  if (!assignment) {
    throw authorityError(
      "preventure_research_assignment_missing",
      "The requested exact research assignment is not registered.",
    );
  }
  const template = authority.assignments.find((item) => item.id === assignmentId);
  if (!template || assignment.templateHash !== sha256(template)) {
    throw authorityError(
      "preventure_research_assignment_changed",
      "The stored research assignment no longer matches its accepted template.",
    );
  }
  if (
    assignment.authorityHash !== authorityHash
    || assignment.provider !== authority.provider.id
    || assignment.model !== authority.provider.model
    || assignment.maxCostAudCents !== template.maxCostAudCents
    || assignment.maxAttempts !== 1
    || assignment.maxInputTokens !== template.maxInputTokens
    || assignment.maxOutputTokens !== template.maxOutputTokens
    || assignment.maxTurns !== 1
    || assignment.expiresAt !== authority.expiresAt
  ) {
    throw authorityError(
      "preventure_research_assignment_binding_invalid",
      "The stored assignment is outside the exact activated authority.",
    );
  }
  const expectedAssignmentHash = options.expectedAssignmentHash || null;
  if (expectedAssignmentHash && assignment.assignmentHash !== expectedAssignmentHash) {
    throw authorityError(
      "preventure_research_assignment_stale",
      "Refresh the research assignment before running it; its exact hash changed.",
    );
  }
  return { authority, assignment, state, template };
}

module.exports = {
  PREVENTURE_RESEARCH_WORK_BINDING_SCHEMA,
  advancePreventureResearchLifecycle,
  assertNoCompetingAuthority,
  assertPreventureResearchDispatchAuthority,
  preventureLifecycleApprovalScope,
  preventureLifecycleApprovalScopeHash,
  registerPreventureResearchProposal,
  terminatePreventureResearchAuthority,
  validatePreventureLifecycleApproval,
};
