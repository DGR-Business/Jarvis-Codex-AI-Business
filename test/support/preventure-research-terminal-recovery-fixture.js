"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");

const { seedDatabase } = require("../../src/db");

const {
  bindAgentRunToAttempt,
  bindModelCallToAttempt,
  finalizeAgentExecutionReceipt,
} = require("../../src/runtime/agent-execution-evidence");
const {
  createAgentRun,
  ensureAiTeam,
} = require("../../src/runtime/ai-team");
const { ensureAgentTools } = require("../../src/runtime/agent-tools");
const { sha256 } = require("../../src/runtime/commercial-test-contract");
const {
  terminatePreventureResearchAuthority,
} = require("../../src/runtime/preventure-research-authority");
const {
  createPreventureResearchOutputStore,
} = require("../../src/runtime/preventure-research-output-store");
const {
  createPreventureResearchExecutionDescriptor,
  deriveKnownEffectInvalidResponseIssues,
  normalizePreventureProviderResponse,
  resolvePreventureResearchExecutionDescriptor,
} = require("../../src/runtime/preventure-research-runner");
const {
  createPreventureResearchStore,
} = require("../../src/runtime/preventure-research-store");
const {
  markEmergencyStopUnknown,
} = require("../../src/runtime/runtime-supervisor");
const {
  historicalV1TestRegistry,
} = require("./preventure-research-test-registry");
const {
  STORE_TIME,
  authority,
  canonicalJson,
  fixture,
  insertKnownCompletedExecution,
} = require("./preventure-research-early-stop-fixture");

const CLAIM_SCHEMA = "pantheon.preventure-research-claim.v1";
const RECOVERY_TIME = "2026-08-02T06:30:00.000Z";

function canonicalReceiptHash(value) {
  return String(value).startsWith("sha256:") ? String(value) : `sha256:${value}`;
}

function asIso(value) {
  return new Date(Date.parse(value)).toISOString();
}

function addMilliseconds(value, milliseconds) {
  return new Date(Date.parse(value) + milliseconds).toISOString();
}

function stableIds(assignmentHash) {
  const part = assignmentHash.slice("sha256:".length, "sha256:".length + 32);
  return Object.freeze({
    attemptId: `preventure_attempt_${part}`,
    runId: `preventure_agent_run_${part}`,
    modelCallId: `preventure_model_call_${part}`,
    toolInvocationId: `preventure_tool_invocation_${part}`,
    reservationId: `preventure_reservation_${part}`,
    costId: `preventure_generic_cost_${part}`,
    clientRequestId: `pantheon-preventure-${part}`,
    costKey: `preventure_cost_${part}`,
  });
}

function createTerminalRecoveryFixture(options = {}) {
  let clockValue = asIso(options.clockValue || RECOVERY_TIME || STORE_TIME);
  const clock = () => clockValue;
  const base = fixture({ clock });
  seedDatabase(base.db, { includeDemoProof: false });
  const assignmentIndex = options.assignmentIndex ?? 0;
  if (!Number.isInteger(assignmentIndex) || !base.assignments[assignmentIndex]) {
    base.close();
    throw new Error("Terminal-recovery fixture assignment index is invalid.");
  }
  const assignment = base.assignments[assignmentIndex];
  const artifactRoot = path.resolve(
    options.artifactRoot || path.join(base.dir, "terminal-recovery-artifacts"),
  );
  const outputStore = createPreventureResearchOutputStore({
    artifactRoot,
    assignmentMaxCostAudCentsForHash(assignmentHash) {
      const exactAssignment = base.assignments.find(
        (item) => item.assignmentHash === assignmentHash,
      );
      if (!exactAssignment) {
        throw new Error("Unknown terminal-recovery assignment cost cap.");
      }
      return exactAssignment.maxCostAudCents;
    },
  });
  const retainedOutputStore = typeof options.wrapRetainedOutputStore === "function"
    ? options.wrapRetainedOutputStore(outputStore)
    : outputStore;
  const store = createPreventureResearchStore(base.db, {
    clock,
    authorityRegistry: historicalV1TestRegistry,
    retainedOutputStore,
  });
  return {
    ...base,
    assignment,
    artifactRoot,
    clock,
    outputStore,
    retainedOutputStore,
    store,
    get clockValue() { return clockValue; },
    setClock(value) {
      clockValue = asIso(value);
      return clockValue;
    },
  };
}

function prepareDispatchedExecution(fx, options = {}) {
  const { assignment, db, store } = fx;
  const ids = stableIds(assignment.assignmentHash);
  const dispatchedAt = asIso(options.dispatchedAt || fx.clockValue);
  fx.setClock(dispatchedAt);
  const activation = store.loadLifecycle(authority.authorityHash)
    .find((event) => event.eventType === "activated");
  const template = authority.assignments.find((item) => item.id === assignment.id);
  const descriptor = assignment.id === authority.assignments[0].id
    ? createPreventureResearchExecutionDescriptor(
      authority,
      assignment,
      template,
      activation,
    )
    : resolvePreventureResearchExecutionDescriptor({
      store,
      authorityHash: authority.authorityHash,
      assignmentId: assignment.id,
      expectedAssignmentHash: assignment.assignmentHash,
      clock: fx.clock,
    });
  const claimToken = `preventure_claim_terminal_${assignment.assignmentHash.slice(7, 39)}`;
  const claimMetadata = canonicalJson({
    schema: CLAIM_SCHEMA,
    authorityHash: authority.authorityHash,
    assignmentId: assignment.id,
    assignmentHash: assignment.assignmentHash,
    descriptorHash: descriptor.descriptorHash,
    requestBodyHash: descriptor.request.requestBodyHash,
    providerResponseId: null,
    clientRequestId: ids.clientRequestId,
  });
  db.prepare(
    `UPDATE tasks
     SET status = 'running', claim_token = ?, claimed_at = ?, started_at = ?,
         attempt_count = 1, outcome_status = 'provider_dispatched', updated_at = ?
     WHERE id = ? AND status = 'blocked' AND attempt_count = 0`,
  ).run(claimToken, dispatchedAt, dispatchedAt, dispatchedAt, assignment.taskId);
  db.prepare(
    `INSERT INTO task_attempts
     (id, task_id, workflow_id, venture_id, claim_token, status, outcome_status,
      started_at, metadata, evidence_binding_status, provider_dispatched_at,
      provider_dispatch_model_call_id)
     VALUES (?, ?, ?, NULL, ?, 'running', 'provider_dispatched', ?, ?,
             'exact_required', ?, ?)` ,
  ).run(
    ids.attemptId,
    assignment.taskId,
    assignment.workflowId,
    claimToken,
    dispatchedAt,
    claimMetadata,
    dispatchedAt,
    ids.modelCallId,
  );
  db.prepare(
    `INSERT INTO model_calls
     (id, workflow_id, task_id, venture_id, provider, model_class, selected_model,
      mode, status, input_tokens, output_tokens, estimated_cost_cents,
      actual_cost_cents, approval_required, metadata, created_at,
      cost_status, reserved_cost_cents, incurred_estimate_cents,
      reconciled_cost_cents, outcome_status, attempt_id)
     VALUES (?, ?, ?, NULL, ?, 'flagship', ?, 'live', 'dispatching', 0, 0, 0,
             0, 0, ?, ?, 'reserved', ?, 0, 0, 'provider_dispatched', ?)` ,
  ).run(
    ids.modelCallId,
    assignment.workflowId,
    assignment.taskId,
    assignment.provider,
    assignment.model,
    claimMetadata,
    dispatchedAt,
    assignment.maxCostAudCents,
    ids.attemptId,
  );
  ensureAiTeam(db);
  ensureAgentTools(db);
  const definition = db.prepare(
    "SELECT * FROM agent_definitions WHERE id = 'demand_validator'",
  ).get();
  const task = db.prepare("SELECT * FROM tasks WHERE id = ?").get(assignment.taskId);
  let run;
  if (options.productionRunIdentity === true) {
    db.prepare(
      `INSERT INTO agent_runs
       (id, agent_id, workflow_id, task_id, venture_id, mode, status,
        input_summary, output_summary, model_call_id, estimated_cost_cents,
        actual_cost_cents, approval_required, eval_status, metadata, started_at)
       VALUES (?, 'demand_validator', ?, ?, NULL, 'preventure-research', 'running',
               ?, '', ?, 0, 0, 0, 'not_evaluated', ?, ?)`,
    ).run(
      ids.runId,
      assignment.workflowId,
      assignment.taskId,
      `Exact bounded assignment ${assignment.id}`,
      ids.modelCallId,
      claimMetadata,
      dispatchedAt,
    );
    bindAgentRunToAttempt(db, ids.attemptId, ids.runId);
    db.prepare(
      `INSERT INTO agent_trace_events
       (id, run_id, sequence, type, title, detail, metadata, ts)
       VALUES (?, ?, 1, 'run_started', 'Bounded research started', ?, ?, ?)`,
    ).run(
      `preventure_trace_terminal_${assignment.assignmentHash.slice(7, 39)}`,
      ids.runId,
      `Pantheon claimed exact assignment ${assignment.id} for one approved provider attempt.`,
      canonicalJson({
        authorityHash: authority.authorityHash,
        assignmentHash: assignment.assignmentHash,
        descriptorHash: descriptor.descriptorHash,
      }),
      dispatchedAt,
    );
    run = { id: ids.runId };
  } else {
    run = createAgentRun(db, definition, task, {
      attemptId: ids.attemptId,
      mode: "preventure-research",
      inputSummary: `Terminal recovery fixture ${assignment.id}`,
    });
  }
  bindModelCallToAttempt(db, ids.attemptId, ids.modelCallId);
  db.prepare(
    `INSERT INTO agent_tool_invocations
     (id, agent_id, run_id, task_id, workflow_id, tool_id, assignment_id,
      approval_id, requested_mode, status, decision, permission, risk_level,
      input_summary, output_summary, metadata, requested_at, resolved_at,
      attempt_id, observed_attempt_id)
     VALUES (?, 'demand_validator', ?, ?, ?, 'research_adapter', NULL, NULL,
             'live', 'running', 'approved_exact_authority', 'approved', 'medium',
             'One exact bounded OpenAI Responses web-search request.', '', ?, ?, NULL, ?, ?)` ,
  ).run(
    ids.toolInvocationId,
    run.id,
    assignment.taskId,
    assignment.workflowId,
    canonicalJson({
      schema: "pantheon.preventure-tool-invocation.v1",
      authorityHash: authority.authorityHash,
      assignmentHash: assignment.assignmentHash,
      descriptorHash: descriptor.descriptorHash,
      requestBodyHash: descriptor.request.requestBodyHash,
      clientRequestId: ids.clientRequestId,
      externalCommercialSpendAudCents: 0,
    }),
    dispatchedAt,
    ids.attemptId,
    ids.attemptId,
  );
  db.prepare(
    `INSERT INTO budget_reservations
     (id, venture_id, workflow_id, task_id, approval_id, status,
      amount_cents, currency, reserved_at, resolved_at, metadata)
     VALUES (?, NULL, ?, ?, NULL, 'reserved', ?, 'AUD', ?, NULL, ?)` ,
  ).run(
    ids.reservationId,
    assignment.workflowId,
    assignment.taskId,
    assignment.maxCostAudCents,
    dispatchedAt,
    canonicalJson({
      authorityHash: authority.authorityHash,
      assignmentHash: assignment.assignmentHash,
      costKey: ids.costKey,
      exposureAudCents: assignment.maxCostAudCents,
    }),
  );
  db.prepare(
    `INSERT INTO costs
     (id, workflow_id, venture_id, run_id, task_id, model_call_id,
      category, source, status, amount_cents, currency, occurred_at, metadata)
     VALUES (?, ?, NULL, ?, ?, NULL, 'preventure_research', 'openai',
             'reserved', ?, 'AUD', ?, ?)` ,
  ).run(
    ids.costId,
    assignment.workflowId,
    run.id,
    assignment.taskId,
    assignment.maxCostAudCents,
    dispatchedAt,
    canonicalJson({
      authorityHash: authority.authorityHash,
      assignmentHash: assignment.assignmentHash,
      costKey: ids.costKey,
      exposureAudCents: assignment.maxCostAudCents,
    }),
  );
  const reserved = store.appendCostEvent(assignment.assignmentHash, {
    eventType: "reserved",
    amountAudCents: assignment.maxCostAudCents,
    exposureAudCents: assignment.maxCostAudCents,
    costKey: ids.costKey,
    taskAttemptId: ids.attemptId,
    modelCallId: null,
    budgetReservationId: ids.reservationId,
    costId: ids.costId,
    agentRunReceiptId: null,
    occurredAt: dispatchedAt,
  });
  return {
    assignment,
    activation,
    claimToken,
    descriptor,
    ids,
    runId: run.id,
    dispatchedAt,
    reservedCostEvent: reserved.costEvent,
  };
}

function retainProviderArtifact(fx, execution, options = {}) {
  let responseIssues = [...new Set(options.responseIssues || [])].sort();
  let providerDerivedIssues = [...new Set(
    options.providerDerivedIssues || responseIssues,
  )].sort();
  const retainedAt = asIso(options.retainedAt || fx.clockValue);
  const providerRequestId = Object.hasOwn(options, "providerRequestId")
    ? options.providerRequestId
    : "req_terminal_recovery_1";
  const artifactKind = options.artifactKind
    || (options.malformed === true ? "known_effect_invalid" : "canonical_known_response");
  const malformed = artifactKind === "known_effect_invalid";
  const preEffect = artifactKind === "known_pre_effect_rejection";
  const providerResponse = preEffect ? {
    error: {
      type: options.providerErrorType || "invalid_request_error",
      code: options.providerErrorCode || "invalid_request",
      message: "The exact request was rejected before a usable provider effect.",
    },
  } : malformed ? null : {
    id: options.providerResponseId || "resp_terminal_recovery_1",
    object: "response",
    model: execution.assignment.model,
    status: "completed",
    incomplete_details: providerDerivedIssues.includes("response_incomplete")
      ? { reason: "max_output_tokens" }
      : null,
    output: [{
      id: "ws_terminal_recovery_1",
      type: "web_search_call",
      status: "completed",
      action: {
        type: "search",
        query: "public bounded diligence evidence",
        sources: [{
          url: "https://example.com/public-bounded-evidence",
          title: "Public bounded evidence",
          publisher: "Example Publisher",
          snippet: "Public grounding metadata retained for a deterministic recovery fixture.",
        }],
      },
    }, {
      id: "msg_terminal_recovery_1",
      type: "message",
      status: "completed",
      role: "assistant",
      content: [{
        type: "output_text",
        text: options.output || "{}",
        annotations: [{
          type: "url_citation",
          url: "https://example.com/public-bounded-evidence",
          title: "Public bounded evidence",
        }],
      }],
    }],
    usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
  };
  const rawProviderBody = malformed
    ? "{malformed-terminal-provider-json"
    : JSON.stringify(providerResponse);
  if (malformed) {
    const derivedIssues = [...deriveKnownEffectInvalidResponseIssues({
      rawProviderBody,
      httpStatus: options.httpStatus || 200,
      providerRequestId,
      providerRequestIdInvalid: false,
      descriptor: execution.descriptor,
    })];
    if (options.responseIssues === undefined) responseIssues = derivedIssues;
    providerDerivedIssues = derivedIssues;
  }
  const billing = preEffect ? {
    currency: "AUD",
    costAudCents: 0,
    costStatus: "estimated",
    exactBillingPending: true,
    exposureAudCents: execution.assignment.maxCostAudCents,
    providerZeroBillingGuarantee: false,
  } : {
    currency: "AUD",
    costAudCents: Object.hasOwn(options, "costAudCents") ? options.costAudCents : null,
    costStatus: options.costStatus || "unknown",
    modelCallId: execution.ids.modelCallId,
  };
  const normalized = (!preEffect && !malformed)
    ? normalizePreventureProviderResponse(providerResponse)
    : null;
  if (normalized) assert.deepEqual(normalized.issues, providerDerivedIssues);
  const groundedSources = normalized?.grounding.sources || [];
  const retained = fx.outputStore.retain({
    artifactKind,
    assignmentMaxCostAudCents: execution.assignment.maxCostAudCents,
    authorityHash: authority.authorityHash,
    assignmentHash: execution.assignment.assignmentHash,
    descriptorHash: execution.descriptor.descriptorHash,
    requestBodyHash: execution.descriptor.request.requestBodyHash,
    providerRequestId,
    providerResponseId: preEffect ? null : (providerResponse?.id || null),
    clientRequestId: execution.ids.clientRequestId,
    providerResponse,
    providerResponseHash: providerResponse ? sha256(providerResponse) : null,
    rawProviderBody,
    rawProviderBodyHash: sha256(rawProviderBody),
    output: normalized ? normalized.output.texts[0] : null,
    groundedSources,
    groundedSourceSetHash: sha256(groundedSources),
    billing,
    billingHash: sha256(billing),
    responseMetadata: preEffect ? {
      httpStatus: options.httpStatus || 400,
      observedWebSearchCallCount: 0,
      providerErrorCode: options.providerErrorCode || "invalid_request",
      providerErrorType: options.providerErrorType || "invalid_request_error",
      usage: null,
    } : {
      httpStatus: options.httpStatus || 200,
      canonicalResponseValid: !malformed,
      providerResponseJsonParsed: !malformed,
      responseIssues,
    },
    retainedAt,
  });
  assert.deepEqual(
    fx.outputStore.load({
      retainedOutputHash: retained.artifactRef,
      authorityHash: authority.authorityHash,
      assignmentHash: execution.assignment.assignmentHash,
      descriptorHash: execution.descriptor.descriptorHash,
    }).artifactHash,
    retained.artifactHash,
  );
  return { retained, retainedAt, responseIssues };
}

function revokeAuthority(fx, execution, occurredAt) {
  const terminalAt = fx.setClock(occurredAt);
  const latest = fx.store.loadLifecycle(authority.authorityHash).at(-1);
  const terminated = terminatePreventureResearchAuthority(
    fx.store,
    authority.authorityHash,
    "revoked",
    {
      expectedLatestEventHash: latest.eventHash,
      occurredAt: terminalAt,
      reason: "The owner stopped the bounded provider assignment after dispatch.",
      clock: fx.clock,
    },
  );
  return {
    terminalAt,
    terminalBinding: {
      kind: "lifecycle",
      eventId: terminated.event.id,
      eventHash: terminated.event.eventHash,
      eventType: terminated.event.eventType,
    },
  };
}

function expireAuthority(fx, execution, occurredAt) {
  const observedAt = fx.setClock(occurredAt);
  const latest = fx.store.loadLifecycle(authority.authorityHash).at(-1);
  const terminated = terminatePreventureResearchAuthority(
    fx.store,
    authority.authorityHash,
    "expired",
    {
      expectedLatestEventHash: latest.eventHash,
      occurredAt: observedAt,
      reason: "The fixed bounded-research deadline elapsed after provider dispatch.",
      clock: fx.clock,
    },
  );
  return {
    // Expiry is effective at the immutable authority boundary. A later durable
    // expiry observation must not move the terminal instant forward.
    terminalAt: authority.expiresAt,
    observedAt: terminated.event.occurredAt,
    terminalBinding: {
      kind: "lifecycle",
      eventId: terminated.event.id,
      eventHash: terminated.event.eventHash,
      eventType: terminated.event.eventType,
    },
  };
}

function emergencyEventHash(row) {
  return sha256({
    id: row.id,
    ts: row.ts,
    level: row.level,
    actor: row.actor,
    type: row.type,
    entityType: row.entity_type ?? null,
    entityId: row.entity_id ?? null,
    message: row.message,
    metadata: JSON.parse(row.metadata),
  });
}

function emergencyStop(fx, execution) {
  const result = markEmergencyStopUnknown(fx.db);
  assert.equal(result.affectedTasks >= 1, true);
  const row = fx.db.prepare(
    `SELECT * FROM events
     WHERE type = 'runtime.emergency_stop_recorded'
       AND EXISTS (
         SELECT 1 FROM json_each(events.metadata, '$.affectedTaskIds')
         WHERE value = ?
       )
     ORDER BY id DESC LIMIT 1`,
  ).get(execution.assignment.taskId);
  assert.ok(row);
  fx.setClock(addMilliseconds(row.ts, 1));
  return {
    terminalAt: asIso(row.ts),
    terminalBinding: {
      kind: "runtime_emergency_stop",
      eventId: String(row.id),
      eventHash: emergencyEventHash(row),
      eventType: row.type,
    },
    event: row,
  };
}

function finalizeTerminalReceipt(fx, execution) {
  const receipt = finalizeAgentExecutionReceipt(fx.db, {
    attemptId: execution.ids.attemptId,
    runId: execution.runId,
    createdAt: fx.clockValue,
  });
  const latest = fx.db.prepare(
    `SELECT * FROM agent_run_receipts
     WHERE attempt_id = ? ORDER BY sequence DESC LIMIT 1`,
  ).get(execution.ids.attemptId);
  assert.equal(latest.id, receipt.id);
  return {
    id: latest.id,
    hash: canonicalReceiptHash(latest.receipt_hash),
    status: latest.status,
    outcomeStatus: latest.outcome_status,
  };
}

function buildRecoveryInput(fx, execution, terminal, artifact, options = {}) {
  // Emergency terminalization already records its conservative immutable unknown
  // cost head atomically. Custody adds the later artifact-bound successor without
  // weakening or replacing that earlier accounting truth.
  const recordedAt = fx.setClock(options.recordedAt || options.recoveredAt || addMilliseconds(
    [terminal.observedAt || terminal.terminalAt, artifact.retainedAt]
      .sort((left, right) => Date.parse(left) - Date.parse(right))
      .at(-1),
    1,
  ));
  return {
    authorityHash: authority.authorityHash,
    taskId: execution.assignment.taskId,
    taskAttemptId: execution.ids.attemptId,
    modelCallId: execution.ids.modelCallId,
    claimToken: execution.claimToken,
    descriptorHash: execution.descriptor.descriptorHash,
    requestBodyHash: execution.descriptor.request.requestBodyHash,
    clientRequestId: execution.ids.clientRequestId,
    providerRequestId: artifact.retained.providerRequestId,
    providerResponseId: artifact.retained.providerResponseId,
    retainedOutputRef: artifact.retained.artifactRef,
    recordedAt,
  };
}

module.exports = {
  addMilliseconds,
  asIso,
  authority,
  buildRecoveryInput,
  createTerminalRecoveryFixture,
  emergencyEventHash,
  emergencyStop,
  expireAuthority,
  finalizeTerminalReceipt,
  insertKnownCompletedExecution,
  prepareDispatchedExecution,
  retainProviderArtifact,
  revokeAuthority,
};
