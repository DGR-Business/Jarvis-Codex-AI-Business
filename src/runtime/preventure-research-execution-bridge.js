"use strict";

const crypto = require("node:crypto");
const path = require("node:path");

const { createPreventureResearchOpenAiTransport,
  createDeterministicPreventureResearchParser } = require("../adapters/preventure-research-openai");
const { ensureAgentTools } = require("./agent-tools");
const { ensureAiTeam } = require("./ai-team");
const {
  bindAgentRunToAttempt,
  bindModelCallToAttempt,
  finalizeAgentExecutionReceipt,
} = require("./agent-execution-evidence");
const { monthlyBudgetExposure, monthlyCapCents } = require("./cost-ledger");
const { sha256 } = require("./commercial-test-contract");
const {
  EXACT_CLAIM_KIND,
  EXACT_OUTPUT_STORE_KIND,
  deriveKnownEffectInvalidResponseIssues,
  describePreventureResearchAssignment,
  normalizePreventureProviderResponse,
  reprocessRetainedPreventureOutput,
  resolvePreventureResearchExecutionDescriptor,
  runPreventureResearchAssignment,
} = require("./preventure-research-runner");
const {
  createPreventureResearchOutputStore,
} = require("./preventure-research-output-store");
const {
  createPreventureResearchStore,
} = require("./preventure-research-store");
const {
  defaultPreventureResearchAuthorityRegistry,
} = require("./preventure-research-authority-registry");
const {
  PREVENTURE_OFFICIAL_RESPONSES_ENDPOINT_HASH,
} = require("./preventure-research-terminal-stop");

const BRIDGE_SCHEMA = "pantheon.preventure-research-execution-bridge.v1";
const CLAIM_METADATA_SCHEMA = "pantheon.preventure-research-claim.v1";
const COST_METADATA_SCHEMA = "pantheon.preventure-research-generic-cost.v1";
const HASH_PATTERN = /^sha256:[a-f0-9]{64}$/;

function bridgeError(code, message, statusCode = 409) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
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

function resolveRegisteredAuthority(options) {
  const authorityRegistry = options.authorityRegistry
    || defaultPreventureResearchAuthorityRegistry;
  if (
    !authorityRegistry
    || typeof authorityRegistry.resolveAuthorityEntry !== "function"
    || typeof authorityRegistry.resolveCandidateAuthorityEntry !== "function"
  ) {
    throw bridgeError(
      "preventure_bridge_authority_registry_invalid",
      "The immutable pre-venture authority registry is unavailable.",
      500,
    );
  }
  const suppliedAuthority = options.authority;
  const requestedHash = options.authorityHash
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
  } catch (error) {
    throw bridgeError(
      error?.code || "preventure_bridge_authority_unknown",
      String(error?.message || "The exact registered research authority is unavailable."),
      500,
    );
  }
  if (!entry?.authority || !entry?.readinessSpec) {
    throw bridgeError(
      "preventure_bridge_candidate_authority_missing",
      "No exact registered candidate research authority is configured for dispatch.",
      500,
    );
  }
  if (suppliedAuthority && canonicalJson(suppliedAuthority) !== canonicalJson(entry.authority)) {
    throw bridgeError(
      "preventure_bridge_authority_changed",
      "The supplied research authority differs from its immutable registry entry.",
      500,
    );
  }
  return Object.freeze({
    authorityRegistry,
    authority: entry.authority,
    readinessSpec: entry.readinessSpec,
    dispatchCandidate: (() => {
      try {
        const candidate = authorityRegistry.resolveCandidateAuthorityEntry();
        return authorityRegistry.candidateAuthorityHash === entry.authority.authorityHash
          && candidate?.authority?.authorityHash === entry.authority.authorityHash
          && canonicalJson(candidate.authority) === canonicalJson(entry.authority)
          && canonicalJson(candidate.readinessSpec) === canonicalJson(entry.readinessSpec);
      } catch {
        return false;
      }
    })(),
  });
}

function parseJson(value, fallback = {}) {
  if (isObject(value)) return value;
  try {
    const parsed = JSON.parse(String(value || ""));
    return isObject(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function now(clock) {
  const value = typeof clock === "function" ? clock() : new Date();
  const result = value instanceof Date ? value.toISOString() : String(value || "");
  if (!Number.isFinite(Date.parse(result))) {
    throw bridgeError("preventure_bridge_time_invalid", "The runtime clock is invalid.", 500);
  }
  return result;
}

function exactHash(value, label) {
  const result = String(value || "");
  if (!HASH_PATTERN.test(result)) {
    throw bridgeError("preventure_bridge_hash_invalid", `${label} is invalid.`, 400);
  }
  return result;
}

function digest(value, length = 32) {
  return exactHash(value, "Immutable hash").slice("sha256:".length, "sha256:".length + length);
}

function stableIds(assignmentHash) {
  const part = digest(assignmentHash);
  return Object.freeze({
    attemptId: `preventure_attempt_${part}`,
    runId: `preventure_agent_run_${part}`,
    modelCallId: `preventure_model_call_${part}`,
    researchRunId: `preventure_research_run_${part}`,
    toolInvocationId: `preventure_tool_invocation_${part}`,
    reservationId: `preventure_reservation_${part}`,
    costId: `preventure_generic_cost_${part}`,
    clientRequestId: `pantheon-preventure-${part}`,
  });
}

let transactionSequence = 0;

function withImmediate(db, label, operation) {
  if (db.isTransaction) {
    const savepoint = `preventure_bridge_${label}_${++transactionSequence}`;
    db.exec(`SAVEPOINT ${savepoint}`);
    try {
      const result = operation();
      if (result && typeof result.then === "function") {
        throw bridgeError(
          "preventure_bridge_transaction_async",
          "A database transaction attempted to outlive its synchronous safety boundary.",
          500,
        );
      }
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
    if (result && typeof result.then === "function") {
      throw bridgeError(
        "preventure_bridge_transaction_async",
        "A database transaction attempted to outlive its synchronous safety boundary.",
        500,
      );
    }
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function exactAssignment(store, authority, authorityHash, assignmentHash) {
  if (!authority || authorityHash !== authority.authorityHash) {
    throw bridgeError(
      "preventure_bridge_authority_changed",
      "The production bridge is not bound to the exact registered research authority.",
    );
  }
  const assignment = store.getAssignment(assignmentHash);
  if (!assignment || assignment.authorityHash !== authorityHash) {
    throw bridgeError(
      "preventure_bridge_assignment_missing",
      "The exact materialized research assignment is unavailable.",
    );
  }
  return assignment;
}

function assertLifecycleApprovals(db, ledger) {
  for (const eventType of ["accepted", "activated"]) {
    const event = ledger.lifecycle.find((item) => item.eventType === eventType);
    const approval = event?.approvalId
      ? db.prepare(
        `SELECT id, status, scope_hash, consumed_at, expires_at
         FROM approvals WHERE id = ?`,
      ).get(event.approvalId)
      : null;
    if (
      !event
      || !approval
      || approval.status !== "approved"
      || approval.scope_hash !== event.approvalScopeHash
      || approval.consumed_at !== event.occurredAt
      || Date.parse(approval.expires_at || "") <= Date.parse(event.occurredAt)
    ) {
      throw bridgeError(
        "preventure_bridge_approval_authenticity_failed",
        "The accepted and activated owner approvals cannot be authenticated exactly.",
      );
    }
  }
}

function genericCostStatus(eventType) {
  return {
    reserved: "reserved",
    estimated: "incurred_estimate",
    incurred: "incurred_estimate",
    reconciled: "reconciled",
    released: "released",
    unknown: "unknown",
  }[eventType];
}

function assertCostMutationAuthority(db, assignment, ids, input) {
  const task = db.prepare("SELECT * FROM tasks WHERE id = ?").get(assignment.taskId);
  const attemptId = input.taskAttemptId || null;
  const attempt = attemptId
    ? db.prepare("SELECT * FROM task_attempts WHERE id = ?").get(attemptId)
    : null;
  const modelCall = db.prepare("SELECT * FROM model_calls WHERE id = ?").get(ids.modelCallId);
  const receipt = input.agentRunReceiptId
    ? db.prepare("SELECT * FROM agent_run_receipts WHERE id = ?").get(input.agentRunReceiptId)
    : null;
  const liveClaim = Boolean(
    task
    && attempt
    && modelCall
    && attempt.id === ids.attemptId
    && attempt.task_id === assignment.taskId
    && attempt.workflow_id === assignment.workflowId
    && task.status === "running"
    && attempt.status === "running"
    && typeof task.claim_token === "string"
    && task.claim_token
    && attempt.claim_token === task.claim_token
    && ![task.error_kind, attempt.error_kind, modelCall.error_kind]
      .includes("operator_emergency_stop")
  );
  const atomicCompletion = Boolean(
    task
    && attempt
    && modelCall
    && receipt
    && attempt.id === ids.attemptId
    && attempt.task_id === assignment.taskId
    && attempt.workflow_id === assignment.workflowId
    && ["completed", "failed"].includes(attempt.status)
    && task.status === "completed"
    && receipt.attempt_id === attempt.id
    && receipt.task_id === assignment.taskId
    && ![task.error_kind, attempt.error_kind, modelCall.error_kind]
      .includes("operator_emergency_stop")
  );
  if (
    !task
    || task.workflow_id !== assignment.workflowId
    || task.venture_id !== null
    || !attempt
    || !modelCall
    || (input.modelCallId && input.modelCallId !== ids.modelCallId)
    || (!liveClaim && !atomicCompletion)
  ) {
    throw bridgeError(
      "preventure_bridge_claim_changed",
      "The live research claim changed before this cost mutation; the retained emergency or terminal truth wins.",
    );
  }
  return { task, attempt, modelCall, receipt, liveClaim, atomicCompletion };
}

function createLedgerBoundStore(db, baseStore, clock, authority) {
  function appendCostEvent(assignmentHash, input = {}) {
    return withImmediate(db, "cost", () => {
      const assignment = baseStore.getAssignment(assignmentHash);
      if (!assignment) {
        throw bridgeError(
          "preventure_bridge_cost_assignment_missing",
          "The generic cost trail cannot find its exact research assignment.",
        );
      }
      const ids = stableIds(assignmentHash);
      const mutation = assertCostMutationAuthority(db, assignment, ids, input);
      const eventType = String(input.eventType || "");
      const status = genericCostStatus(eventType);
      if (!status) {
        throw bridgeError("preventure_bridge_cost_state_invalid", "The cost state is invalid.");
      }
      const costAmount = eventType === "unknown"
        ? Number(input.exposureAudCents)
        : Number(input.amountAudCents);
      const exposureAmount = Number(input.exposureAudCents);
      const reservationAmount = ["reserved", "estimated", "incurred", "unknown"]
        .includes(eventType)
        ? exposureAmount
        : costAmount;
      if (
        !Number.isSafeInteger(costAmount)
        || costAmount < 0
        || costAmount > assignment.maxCostAudCents
        || !Number.isSafeInteger(exposureAmount)
        || exposureAmount < costAmount
        || exposureAmount > assignment.maxCostAudCents
        || !Number.isSafeInteger(reservationAmount)
      ) {
        throw bridgeError(
          "preventure_bridge_cost_amount_invalid",
          "The cost truth is outside the exact assignment cap.",
        );
      }
      if (eventType === "reserved") {
        const exposure = monthlyBudgetExposure(db, {
          month: String(input.occurredAt || now(clock)).slice(0, 7),
        });
        if (exposure.totalCents + reservationAmount > monthlyCapCents(db)) {
          throw bridgeError(
            "preventure_bridge_monthly_cap_exceeded",
            "The research reservation would exceed Pantheon's monthly operating limit.",
          );
        }
      }
      const task = mutation.task;
      const recordedAt = String(input.occurredAt || now(clock));
      const metadata = canonicalJson({
        schema: COST_METADATA_SCHEMA,
        authorityHash: assignment.authorityHash,
        assignmentHash,
        amountAudCents: eventType === "unknown" ? null : costAmount,
        exposureAudCents: exposureAmount,
        costKey: input.costKey,
        exactBillingPending: typeof input.exactBillingPending === "boolean"
          ? input.exactBillingPending
          : ["estimated", "incurred", "unknown"].includes(eventType),
        providerZeroBillingGuarantee: input.providerZeroBillingGuarantee ?? null,
      });
      const existingReservation = db.prepare(
        "SELECT * FROM budget_reservations WHERE id = ?",
      ).get(ids.reservationId);
      if (!existingReservation) {
        db.prepare(
          `INSERT INTO budget_reservations
           (id, venture_id, workflow_id, task_id, approval_id, status,
            amount_cents, currency, reserved_at, resolved_at, metadata)
           VALUES (?, NULL, ?, ?, NULL, ?, ?, 'AUD', ?, ?, ?)`,
        ).run(
          ids.reservationId,
          assignment.workflowId,
          assignment.taskId,
          status,
          reservationAmount,
          recordedAt,
          ["reserved", "incurred_estimate", "unknown"].includes(status) ? null : recordedAt,
          metadata,
        );
      } else {
        if (
          existingReservation.task_id !== assignment.taskId
          || existingReservation.workflow_id !== assignment.workflowId
          || existingReservation.venture_id !== null
          || existingReservation.currency !== "AUD"
        ) {
          throw bridgeError(
            "preventure_bridge_cost_binding_changed",
            "The stable research reservation is bound to another task.",
          );
        }
        db.prepare(
          `UPDATE budget_reservations
           SET status = ?, amount_cents = ?, resolved_at = ?, metadata = ?
           WHERE id = ?`,
        ).run(
          status,
          reservationAmount,
          ["reserved", "incurred_estimate", "unknown"].includes(status) ? null : recordedAt,
          metadata,
          ids.reservationId,
        );
      }
      const existingCost = db.prepare("SELECT * FROM costs WHERE id = ?").get(ids.costId);
      if (!existingCost) {
        db.prepare(
          `INSERT INTO costs
           (id, workflow_id, venture_id, run_id, task_id, model_call_id,
            category, source, status, amount_cents, currency, occurred_at, metadata)
           VALUES (?, ?, NULL, ?, ?, ?, 'preventure_research', 'openai',
                   ?, ?, 'AUD', ?, ?)`,
        ).run(
          ids.costId,
          assignment.workflowId,
          ids.runId,
          assignment.taskId,
          input.modelCallId || null,
          status,
          costAmount,
          recordedAt,
          metadata,
        );
      } else {
        if (
          existingCost.task_id !== assignment.taskId
          || existingCost.workflow_id !== assignment.workflowId
          || existingCost.venture_id !== null
          || existingCost.currency !== "AUD"
          || (existingCost.model_call_id && input.modelCallId
            && existingCost.model_call_id !== input.modelCallId)
        ) {
          throw bridgeError(
            "preventure_bridge_cost_binding_changed",
            "The stable research cost is bound to another execution.",
          );
        }
        db.prepare(
          `UPDATE costs
           SET run_id = ?, model_call_id = COALESCE(model_call_id, ?), status = ?,
               amount_cents = ?, occurred_at = ?, metadata = ?
           WHERE id = ?`,
        ).run(
          ids.runId,
          input.modelCallId || null,
          status,
          costAmount,
          recordedAt,
          metadata,
          ids.costId,
        );
      }
      return baseStore.appendCostEvent(assignmentHash, {
        ...input,
        budgetReservationId: ids.reservationId,
        costId: ids.costId,
      });
    });
  }

  return Object.freeze({ ...baseStore, appendCostEvent });
}

function insertTrace(db, runId, type, title, detail, metadata, occurredAt) {
  const sequence = Number(db.prepare(
    "SELECT COALESCE(MAX(sequence), 0) + 1 AS sequence FROM agent_trace_events WHERE run_id = ?",
  ).get(runId)?.sequence || 1);
  db.prepare(
    `INSERT INTO agent_trace_events
     (id, run_id, sequence, type, title, detail, metadata, ts)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    `preventure_trace_${crypto.randomUUID()}`,
    runId,
    sequence,
    type,
    title,
    detail,
    canonicalJson(metadata || {}),
    occurredAt,
  );
}

function exactClaimRows(db, claimToken, assignment, expectedStatuses = ["running"]) {
  const ids = stableIds(assignment.assignmentHash);
  const attempt = db.prepare("SELECT * FROM task_attempts WHERE id = ?").get(ids.attemptId);
  const task = db.prepare("SELECT * FROM tasks WHERE id = ?").get(assignment.taskId);
  const modelCall = db.prepare("SELECT * FROM model_calls WHERE id = ?").get(ids.modelCallId);
  const agentRun = db.prepare("SELECT * FROM agent_runs WHERE id = ?").get(ids.runId);
  if (
    !attempt
    || !task
    || !modelCall
    || !agentRun
    || (claimToken !== null && attempt.claim_token !== claimToken)
    || attempt.task_id !== assignment.taskId
    || attempt.workflow_id !== assignment.workflowId
    || attempt.venture_id !== null
    || task.workflow_id !== assignment.workflowId
    || task.venture_id !== null
    || modelCall.task_id !== assignment.taskId
    || modelCall.workflow_id !== assignment.workflowId
    || modelCall.venture_id !== null
    || modelCall.attempt_id !== attempt.id
    || agentRun.task_id !== assignment.taskId
    || agentRun.workflow_id !== assignment.workflowId
    || agentRun.venture_id !== null
    || attempt.agent_run_id !== agentRun.id
    || attempt.model_call_id !== modelCall.id
    || !expectedStatuses.includes(attempt.status)
  ) {
    throw bridgeError(
      "preventure_bridge_claim_changed",
      "The exact exclusive research claim changed before completion.",
    );
  }
  return { ids, attempt, task, modelCall, agentRun };
}

function usageFromRetained(retained) {
  const usage = retained?.providerResponse?.usage;
  const inputTokens = Number(usage?.input_tokens);
  const outputTokens = Number(usage?.output_tokens);
  const totalTokens = Number(usage?.total_tokens);
  const reported = Number.isSafeInteger(inputTokens)
    && inputTokens >= 0
    && Number.isSafeInteger(outputTokens)
    && outputTokens >= 0
    && Number.isSafeInteger(totalTokens)
    && totalTokens === inputTokens + outputTokens;
  return reported
    ? { status: "reported", inputTokens, outputTokens, totalTokens }
    : { status: "unknown", inputTokens: null, outputTokens: null, totalTokens: null };
}

function exactRetainedResponseIssues(retained, assignment) {
  const stored = Array.isArray(retained?.responseMetadata?.responseIssues)
    ? [...new Set(retained.responseMetadata.responseIssues
      .map((item) => String(item || "").trim()).filter(Boolean))].sort()
    : [];
  if (retained?.artifactKind === "known_effect_invalid") {
    let parsedRaw = null;
    let rawJsonParsed = false;
    try {
      parsedRaw = JSON.parse(retained.rawProviderBody);
      rawJsonParsed = true;
    } catch {}
    const parsedResponseId = rawJsonParsed
      && isObject(parsedRaw)
      && /^[A-Za-z0-9._:-]{1,200}$/.test(String(parsedRaw.id || ""))
      ? String(parsedRaw.id)
      : null;
    const descriptor = {
      model: assignment?.model,
      limits: {
        maxInputTokens: assignment?.maxInputTokens,
        maximumModelPasses: assignment?.maximumModelPasses,
        maxOutputTokens: assignment?.maxOutputTokens,
        maxToolCalls: assignment?.maxToolCalls,
      },
    };
    const derived = deriveKnownEffectInvalidResponseIssues({
      rawProviderBody: retained.rawProviderBody,
      httpStatus: retained.responseMetadata?.httpStatus,
      providerRequestId: retained.providerRequestId ?? null,
      providerRequestIdInvalid: stored.includes("provider_request_id_invalid")
        && retained.providerRequestId === null,
      descriptor,
    });
    const mismatches = [
      ["stored_issue_set", stored.length < 1],
      ["derived_issue_set", canonicalJson(stored) !== canonicalJson(derived)],
      ["json_parse_state", retained.responseMetadata?.providerResponseJsonParsed !== rawJsonParsed],
      ["parsed_response", canonicalJson(retained.providerResponse) !== canonicalJson(
        rawJsonParsed ? parsedRaw : null,
      )],
      ["parsed_response_hash", retained.providerResponseHash !== (
        rawJsonParsed ? sha256(parsedRaw) : null
      )],
      ["provider_response_id", retained.providerResponseId !== parsedResponseId],
    ].filter(([, changed]) => changed).map(([field]) => field);
    if (mismatches.length > 0) {
      const error = bridgeError(
        "preventure_bridge_active_crash_provider_truth_changed",
        "The crash-retained unusable provider artifact differs from its raw response, provider identity, or payload-derived issue set.",
      );
      error.details = Object.freeze({ changedFields: mismatches });
      throw error;
    }
    return stored;
  }
  if (retained?.artifactKind !== "canonical_known_response") return stored;
  const normalized = normalizePreventureProviderResponse(retained.providerResponse);
  const derived = [...new Set(normalized.issues)].sort();
  const conservativeTransportIssue = stored.includes("provider_request_id_invalid")
    && retained.providerRequestId === null
    ? ["provider_request_id_invalid"]
    : [];
  const expected = [...new Set([...derived, ...conservativeTransportIssue])].sort();
  const expectedOutput = normalized.output.texts.length === 1
    ? normalized.output.texts[0]
    : null;
  if (
    canonicalJson(stored) !== canonicalJson(expected)
    || canonicalJson(retained.groundedSources) !== canonicalJson(normalized.grounding.sources)
    || retained.output !== expectedOutput
  ) {
    throw bridgeError(
      "preventure_bridge_active_crash_provider_truth_changed",
      "The crash-retained canonical response differs from its payload-derived output, grounding, or issue set.",
    );
  }
  return stored;
}

function exactInsertOrVerify(db, table, id, projection, comparisonColumns) {
  const existing = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id);
  if (!existing) {
    const columns = Object.keys(projection);
    db.prepare(
      `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`,
    ).run(...columns.map((column) => projection[column] ?? null));
    return;
  }
  for (const column of comparisonColumns) {
    if ((existing[column] ?? null) !== (projection[column] ?? null)) {
      throw bridgeError(
        "preventure_bridge_generic_evidence_conflict",
        `Stable ${table} evidence ${id} changed ${column}.`,
      );
    }
  }
}

function stageGenericResearchEvidence(db, assignment, rows, input, completedAt) {
  const { ids } = rows;
  const prepared = input.preparedEvidenceBatch;
  if (
    !isObject(prepared)
    || prepared.assignmentHash !== assignment.assignmentHash
    || prepared.descriptorHash !== input.descriptorHash
    || prepared.preparedEvidenceBatchHash !== input.preparedEvidenceBatchHash
    || sha256((({ preparedEvidenceBatchHash: _hash, ...body }) => body)(prepared))
      !== input.preparedEvidenceBatchHash
  ) {
    throw bridgeError(
      "preventure_bridge_prepared_evidence_changed",
      "The validated evidence batch changed before its one atomic commit.",
    );
  }
  let structuredOutput;
  try {
    structuredOutput = JSON.parse(input.retainedOutput.output);
  } catch {
    throw bridgeError(
      "preventure_bridge_structured_output_changed",
      "The retained strict structured output is unavailable during completion.",
    );
  }
  const researchMetadata = canonicalJson({
    schema: "pantheon.preventure-generic-research-run.v1",
    authorityHash: assignment.authorityHash,
    assignmentHash: assignment.assignmentHash,
    descriptorHash: input.descriptorHash,
    attemptId: ids.attemptId,
    agentRunId: ids.runId,
    modelCallId: ids.modelCallId,
    providerResponseId: input.providerResponseId,
    providerRequestId: input.providerRequestId,
    retainedOutputRef: input.retainedOutput.artifactRef || input.retainedOutput.location,
    retainedOutputHash: input.retainedOutput.artifactHash || null,
    structuredOutputHash: sha256(structuredOutput),
    preparedEvidenceBatchHash: input.preparedEvidenceBatchHash,
  });
  const researchExisting = db.prepare("SELECT * FROM research_runs WHERE id = ?").get(ids.researchRunId);
  if (!researchExisting) {
    db.prepare(
      `INSERT INTO research_runs
       (id, workflow_id, task_id, venture_id, query, provider, mode, status,
        budget_cents, actual_cents, summary, metadata, created_at, completed_at)
       VALUES (?, ?, ?, NULL, ?, ?, 'live', 'completed_live', ?, 0, ?, ?, ?, ?)`,
    ).run(
      ids.researchRunId,
      assignment.workflowId,
      assignment.taskId,
      `Exact bounded public-source assignment ${assignment.id}`,
      assignment.provider,
      assignment.maxCostAudCents,
      `Retained ${prepared.sourceSnapshots.length} partial grounding source record(s) and ${prepared.evidenceRecords.length} model-inference evidence record(s).`,
      researchMetadata,
      rows.attempt.started_at,
      completedAt,
    );
  } else {
    if (
      researchExisting.workflow_id !== assignment.workflowId
      || researchExisting.task_id !== assignment.taskId
      || researchExisting.venture_id !== null
      || researchExisting.provider !== assignment.provider
    ) {
      throw bridgeError(
        "preventure_bridge_research_run_changed",
        "The stable research run belongs to another execution.",
      );
    }
    db.prepare(
      `UPDATE research_runs
       SET status = 'completed_live', actual_cents = 0, summary = ?, metadata = ?, completed_at = ?
       WHERE id = ?`,
    ).run(
      `Retained ${prepared.sourceSnapshots.length} partial grounding source record(s) and ${prepared.evidenceRecords.length} model-inference evidence record(s).`,
      researchMetadata,
      completedAt,
      ids.researchRunId,
    );
  }
  const sourceBindings = [];
  for (const source of prepared.sourceSnapshots) {
    if (source.captureStatus === "captured") {
      throw bridgeError(
        "preventure_bridge_page_capture_forbidden",
        "This bridge did not fetch source pages and cannot record grounding metadata as captured content.",
      );
    }
    const sourceDigest = digest(sha256({
      assignmentHash: assignment.assignmentHash,
      providerSourceId: source.providerSourceId,
    }));
    const sourceRecordId = `preventure_source_${sourceDigest}`;
    const provenanceId = `preventure_provenance_${sourceDigest}`;
    const title = String(source.title || source.url || `Grounding ${source.providerSourceId}`);
    const sourceMetadata = canonicalJson({
      schema: "pantheon.preventure-generic-source.v1",
      authorityHash: assignment.authorityHash,
      assignmentHash: assignment.assignmentHash,
      descriptorHash: input.descriptorHash,
      providerSourceId: source.providerSourceId,
      sourceClass: source.sourceClass,
      sourceTier: source.sourceTier,
      captureStatus: source.captureStatus,
      providerGrounded: true,
      directArtifactCaptured: false,
      contentHash: source.contentHash,
      contentLocation: source.contentLocation,
      canonicalUrl: source.canonicalUrl,
      canonicalHost: source.canonicalHost,
      sourceIdentityUrl: source.sourceIdentityUrl,
      sourceIdentityHash: source.sourceIdentityHash,
      marketplaceChannelId: source.marketplaceChannelId,
      offerIdentityKey: source.offerIdentityKey,
      sellerIdentityKey: source.sellerIdentityKey,
      identityDerivation: source.identityDerivation,
      publisherIdentityKey: source.publisherIdentityKey,
      buyerIndependenceGroup: source.buyerIndependenceGroup,
      limitations: source.limitations || [],
      retainedOutputHash: input.retainedOutput.artifactHash || null,
    });
    exactInsertOrVerify(db, "research_sources", sourceRecordId, {
      id: sourceRecordId,
      run_id: ids.researchRunId,
      title,
      url: source.url,
      publisher: source.publisher,
      published_at: source.publishedAt,
      retrieved_at: prepared.recordedAt,
      relevance: "Partial provider grounding metadata; not captured page content.",
      confidence: "unknown",
      metadata: sourceMetadata,
    }, [
      "run_id", "title", "url", "publisher", "published_at", "retrieved_at", "metadata",
    ]);
    const provenanceMetadata = canonicalJson({
      schema: "pantheon.preventure-source-provenance.v1",
      authorityHash: assignment.authorityHash,
      assignmentHash: assignment.assignmentHash,
      descriptorHash: input.descriptorHash,
      providerSourceId: source.providerSourceId,
      captureStatus: source.captureStatus,
      contentLocation: source.contentLocation,
      modelInferenceOnly: true,
    });
    exactInsertOrVerify(db, "agent_run_provenance", provenanceId, {
      id: provenanceId,
      fingerprint: sha256({
        runId: ids.runId,
        attemptId: ids.attemptId,
        sourceRecordId,
        contentHash: source.contentHash,
      }),
      run_id: ids.runId,
      attempt_id: ids.attemptId,
      task_id: assignment.taskId,
      model_call_id: ids.modelCallId,
      tool_invocation_id: ids.toolInvocationId,
      research_run_id: ids.researchRunId,
      research_source_id: sourceRecordId,
      kind: "web_source",
      provider_external_id: input.providerResponseId,
      title,
      url: source.url,
      grounding_type: "provider_grounding_metadata_partial",
      input_hash: input.descriptorHash,
      output_hash: source.contentHash,
      metadata: provenanceMetadata,
      created_at: completedAt,
    }, [
      "fingerprint", "run_id", "attempt_id", "task_id", "model_call_id",
      "tool_invocation_id", "research_run_id", "research_source_id", "kind",
      "provider_external_id", "title", "url", "grounding_type", "input_hash",
      "output_hash", "metadata",
    ]);
    sourceBindings.push(Object.freeze({
      providerSourceId: source.providerSourceId,
      sourceRecordId,
      provenanceId,
      url: source.url,
      title,
      publisher: source.publisher,
      publishedAt: source.publishedAt,
      retrievedAt: prepared.recordedAt,
      contentHash: source.contentHash,
      contentLocation: source.contentLocation,
      researchRunId: ids.researchRunId,
    }));
  }
  return { prepared, structuredOutput, sourceBindings };
}

function insertEvaluation(db, rows, status, score, subject, completedAt, metadata = {}) {
  const evaluationId = `preventure_eval_${crypto.randomUUID()}`;
  const previousEvaluation = db.prepare(
    `SELECT created_at FROM agent_eval_results
     WHERE attempt_id = ? ORDER BY created_at DESC, id DESC LIMIT 1`,
  ).get(rows.ids.attemptId);
  const candidateTime = Date.parse(completedAt);
  const previousTime = Date.parse(String(previousEvaluation?.created_at || ""));
  const evaluationAt = Number.isFinite(previousTime) && previousTime >= candidateTime
    ? new Date(previousTime + 1).toISOString()
    : completedAt;
  db.prepare(
    `INSERT INTO agent_eval_results
     (id, run_id, agent_id, task_id, attempt_id, status, score,
      criteria, findings, metadata, evaluator_version, subject_hash, created_at)
     VALUES (?, ?, 'demand_validator', ?, ?, ?, ?, ?, ?, ?,
             'preventure-exact-local-v1', ?, ?)`,
  ).run(
    evaluationId,
    rows.ids.runId,
    rows.task.id,
    rows.ids.attemptId,
    status,
    score,
    canonicalJson(status === "passed" ? [
      { id: "exact_authority_binding", passed: true },
      { id: "strict_structured_output", passed: true },
      { id: "partial_grounding_truth", passed: true },
      { id: "no_external_action", passed: true },
    ] : []),
    canonicalJson(status === "passed" ? [] : [subject]),
    canonicalJson({
      schema: "pantheon.preventure-local-evaluation.v1",
      terminal: true,
      ...metadata,
    }),
    sha256({
      assignmentHash: metadata.assignmentHash || null,
      attemptId: rows.ids.attemptId,
      status,
      subject,
      metadata,
    }),
    evaluationAt,
  );
  return evaluationId;
}

function createPreventureClaimsBridge(
  db,
  store,
  clock,
  finalizeDecision,
  authority,
  dispatchCandidate,
  outputStore,
) {
  function claim(input = {}) {
    return withImmediate(db, "claim", () => {
      const assignment = exactAssignment(
        store,
        authority,
        input.authorityHash,
        input.assignmentHash,
      );
      if (assignment.id !== input.assignmentId || assignment.taskId !== input.taskId) {
        throw bridgeError(
          "preventure_bridge_claim_scope_changed",
          "The requested claim does not match the exact assignment task.",
        );
      }
      const ledger = store.readLedger(input.authorityHash);
      assertLifecycleApprovals(db, ledger);
      const description = describePreventureResearchAssignment({
        store,
        authorityHash: input.authorityHash,
        assignmentId: input.assignmentId,
        expectedAssignmentHash: input.assignmentHash,
        expectedDescriptorHash: input.descriptorHash,
        clock,
      });
      const ids = stableIds(assignment.assignmentHash);
      const task = db.prepare("SELECT * FROM tasks WHERE id = ?").get(assignment.taskId);
      const workflow = db.prepare("SELECT * FROM workflows WHERE id = ?").get(assignment.workflowId);
      const attemptsBefore = Number(db.prepare(
        "SELECT COUNT(*) AS count FROM task_attempts WHERE task_id = ?",
      ).get(assignment.taskId).count);
      const activeBefore = Number(db.prepare(
        `SELECT COUNT(*) AS count FROM task_attempts
         WHERE status = 'running' AND task_id IN
           (SELECT task_id FROM preventure_research_assignments WHERE authority_hash = ?)`,
      ).get(input.authorityHash).count);
      const unresolvedBefore = Number(db.prepare(
        `SELECT COUNT(*) AS count FROM task_attempts
         WHERE outcome_status IN ('unknown', 'known_provider_result_needs_review')
           AND task_id IN
             (SELECT task_id FROM preventure_research_assignments WHERE authority_hash = ?)`,
      ).get(input.authorityHash).count);
      if (
        !task
        || !workflow
        || task.status !== "queued"
        || task.kind !== "preventure_research"
        || task.agent !== "demand_validator"
        || task.workflow_id !== assignment.workflowId
        || task.venture_id !== null
        || workflow.type !== "preventure_research"
        || workflow.venture_id !== null
        || attemptsBefore !== 0
        || activeBefore !== 0
        || unresolvedBefore !== 0
        || Number(task.attempt_count) !== 0
        || Number(task.max_retries) !== 0
      ) {
        throw bridgeError(
          "preventure_bridge_claim_not_exclusive",
          "The exact assignment is not ready for its one exclusive provider attempt.",
        );
      }
      ensureAiTeam(db);
      ensureAgentTools(db);
      const definition = db.prepare(
        "SELECT id FROM agent_definitions WHERE id = 'demand_validator' AND status = 'ready'",
      ).get();
      const tool = db.prepare(
        "SELECT id FROM agent_tools WHERE id = 'research_adapter'",
      ).get();
      if (!definition || !tool) {
        throw bridgeError(
          "preventure_bridge_worker_unavailable",
          "The exact demand-validation worker or research adapter is unavailable.",
          500,
        );
      }
      const claimedAt = now(clock);
      const claimToken = `preventure_claim_${crypto.randomUUID()}`;
      const claimMetadata = canonicalJson({
        schema: CLAIM_METADATA_SCHEMA,
        authorityHash: input.authorityHash,
        assignmentId: assignment.id,
        assignmentHash: assignment.assignmentHash,
        descriptorHash: input.descriptorHash,
        requestBodyHash: description.requestBodyHash,
        providerResponseId: null,
        clientRequestId: ids.clientRequestId,
      });
      const changed = db.prepare(
        `UPDATE tasks
         SET status = 'running', claim_token = ?, claimed_at = ?, started_at = ?,
             attempt_count = 1, outcome_status = 'not_started', updated_at = ?
         WHERE id = ? AND status = 'queued' AND attempt_count = 0 AND claim_token IS NULL`,
      ).run(claimToken, claimedAt, claimedAt, claimedAt, assignment.taskId);
      if (Number(changed.changes) !== 1) {
        throw bridgeError(
          "preventure_bridge_claim_raced",
          "Another process changed the exact assignment before claim.",
        );
      }
      db.prepare(
        `INSERT INTO task_attempts
         (id, task_id, workflow_id, venture_id, claim_token, status, outcome_status,
          started_at, metadata, evidence_binding_status)
         VALUES (?, ?, ?, NULL, ?, 'running', 'not_started', ?, ?, 'exact_required')`,
      ).run(
        ids.attemptId,
        assignment.taskId,
        assignment.workflowId,
        claimToken,
        claimedAt,
        claimMetadata,
      );
      db.prepare(
        `INSERT INTO model_calls
         (id, workflow_id, task_id, venture_id, provider, model_class, selected_model,
          mode, status, input_tokens, output_tokens, estimated_cost_cents,
          actual_cost_cents, approval_required, metadata, created_at,
          cost_status, reserved_cost_cents, incurred_estimate_cents,
          reconciled_cost_cents, outcome_status, attempt_id)
         VALUES (?, ?, ?, NULL, ?, 'flagship', ?, 'live', 'prepared', 0, 0, 0,
                 0, 0, ?, ?, 'none', 0, 0, 0, 'not_started', ?)`,
      ).run(
        ids.modelCallId,
        assignment.workflowId,
        assignment.taskId,
        assignment.provider,
        assignment.model,
        claimMetadata,
        claimedAt,
        ids.attemptId,
      );
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
        claimedAt,
      );
      bindAgentRunToAttempt(db, ids.attemptId, ids.runId);
      bindModelCallToAttempt(db, ids.attemptId, ids.modelCallId);
      insertTrace(
        db,
        ids.runId,
        "run_started",
        "Bounded research started",
        `Pantheon claimed exact assignment ${assignment.id} for one approved provider attempt.`,
        {
          authorityHash: assignment.authorityHash,
          assignmentHash: assignment.assignmentHash,
          descriptorHash: input.descriptorHash,
        },
        claimedAt,
      );
      db.prepare(
        `UPDATE workflows SET status = 'agent_running', current_step = ?, updated_at = ?
         WHERE id = ?`,
      ).run(`Running bounded assignment ${assignment.id}`, claimedAt, assignment.workflowId);
      return Object.freeze({
        claimToken,
        exclusive: true,
        activeAssignmentsBefore: activeBefore,
        unresolvedAssignmentsBefore: unresolvedBefore,
        providerAttemptsForAssignmentBefore: attemptsBefore,
        assignmentHash: assignment.assignmentHash,
        descriptorHash: input.descriptorHash,
        taskAttemptId: ids.attemptId,
        agentRunId: ids.runId,
        modelCallId: ids.modelCallId,
        clientRequestId: ids.clientRequestId,
      });
    });
  }

  function markProviderDispatched(input = {}) {
    return withImmediate(db, "dispatch", () => {
      const assignment = exactAssignment(
        store,
        authority,
        input.authorityHash,
        input.assignmentHash,
      );
      const rows = exactClaimRows(db, input.claimToken, assignment);
      const metadata = parseJson(rows.modelCall.metadata);
      if (
        metadata.descriptorHash !== input.descriptorHash
        || metadata.requestBodyHash !== input.requestBodyHash
      ) {
        throw bridgeError(
          "preventure_bridge_dispatch_scope_changed",
          "The exact provider request changed before its durable dispatch marker.",
        );
      }
      const markedAt = String(input.markedAt || now(clock));
      db.prepare(
        `UPDATE task_attempts
         SET outcome_status = 'provider_dispatched', provider_dispatched_at = ?,
             provider_dispatch_model_call_id = ?
         WHERE id = ? AND status = 'running'`,
      ).run(markedAt, rows.ids.modelCallId, rows.ids.attemptId);
      db.prepare(
        `UPDATE tasks SET outcome_status = 'provider_dispatched', updated_at = ? WHERE id = ?`,
      ).run(markedAt, assignment.taskId);
      db.prepare(
        `UPDATE model_calls
         SET status = 'dispatching', outcome_status = 'provider_dispatched'
         WHERE id = ?`,
      ).run(rows.ids.modelCallId);
      exactInsertOrVerify(db, "agent_tool_invocations", rows.ids.toolInvocationId, {
        id: rows.ids.toolInvocationId,
        agent_id: "demand_validator",
        run_id: rows.ids.runId,
        task_id: assignment.taskId,
        workflow_id: assignment.workflowId,
        tool_id: "research_adapter",
        assignment_id: null,
        approval_id: null,
        requested_mode: "live",
        status: "running",
        decision: "approved_exact_authority",
        permission: "approved",
        risk_level: "medium",
        input_summary: "One exact bounded OpenAI Responses web-search request.",
        output_summary: "",
        metadata: canonicalJson({
          schema: "pantheon.preventure-tool-invocation.v1",
          authorityHash: assignment.authorityHash,
          assignmentHash: assignment.assignmentHash,
          descriptorHash: input.descriptorHash,
          requestBodyHash: input.requestBodyHash,
          clientRequestId: rows.ids.clientRequestId,
          externalCommercialSpendAudCents: 0,
        }),
        requested_at: markedAt,
        resolved_at: null,
        attempt_id: rows.ids.attemptId,
        observed_attempt_id: rows.ids.attemptId,
      }, [
        "agent_id", "run_id", "task_id", "workflow_id", "tool_id", "requested_mode",
        "decision", "permission", "attempt_id", "observed_attempt_id", "metadata",
      ]);
      insertTrace(
        db,
        rows.ids.runId,
        "provider_dispatch_started",
        "Provider request dispatched",
        "The one approved provider attempt was durably marked before network dispatch.",
        {
          requestBodyHash: input.requestBodyHash,
          clientRequestId: rows.ids.clientRequestId,
        },
        markedAt,
      );
      return Object.freeze({
        outcomeStatus: "provider_dispatched",
        modelCallId: rows.ids.modelCallId,
        clientRequestId: rows.ids.clientRequestId,
      });
    });
  }

  function assertProviderResultClaim(input = {}) {
    return withImmediate(db, "claim_guard", () => {
      const assignment = exactAssignment(
        store,
        authority,
        input.authorityHash,
        input.assignmentHash,
      );
      const rows = exactClaimRows(db, input.claimToken, assignment, ["running"]);
      const attemptMetadata = parseJson(rows.attempt.metadata);
      const modelMetadata = parseJson(rows.modelCall.metadata);
      const state = store.readState(assignment.authorityHash);
      if (
        !dispatchCandidate
        || state.state !== "activated"
        || state.terminal === true
        || state.expired === true
        || input.taskId !== assignment.taskId
        || input.taskAttemptId !== rows.ids.attemptId
        || input.descriptorHash !== attemptMetadata.descriptorHash
        || input.descriptorHash !== modelMetadata.descriptorHash
        || input.clientRequestId !== attemptMetadata.clientRequestId
        || input.clientRequestId !== modelMetadata.clientRequestId
        || rows.task.status !== "running"
        || rows.task.claim_token !== input.claimToken
        || rows.task.outcome_status !== "provider_dispatched"
        || rows.attempt.outcome_status !== "provider_dispatched"
        || rows.modelCall.outcome_status !== "provider_dispatched"
        || rows.modelCall.status !== "dispatching"
        || [rows.task.error_kind, rows.attempt.error_kind, rows.modelCall.error_kind]
          .includes("operator_emergency_stop")
      ) {
        throw bridgeError(
          "preventure_bridge_claim_changed",
          "The exact provider-dispatch claim changed; the retained emergency or terminal truth wins.",
        );
      }
      return Object.freeze({
        current: true,
        outcomeStatus: "provider_dispatched",
        claimToken: input.claimToken,
        assignmentHash: assignment.assignmentHash,
        descriptorHash: input.descriptorHash,
        clientRequestId: input.clientRequestId,
      });
    });
  }

  function assertProviderRetentionBinding(input = {}) {
    return withImmediate(db, "retention_binding", () => {
      const assignment = exactAssignment(
        store,
        authority,
        input.authorityHash,
        input.assignmentHash,
      );
      const rows = exactClaimRows(
        db,
        input.claimToken,
        assignment,
        ["running", "needs_attention"],
      );
      const attemptMetadata = parseJson(rows.attempt.metadata);
      const modelMetadata = parseJson(rows.modelCall.metadata);
      const dispatchedAt = String(rows.attempt.provider_dispatched_at || "");
      const state = store.readState(assignment.authorityHash);
      const lifecycle = store.loadLifecycle(assignment.authorityHash);
      const latestLifecycle = lifecycle.at(-1) || null;
      const rowCurrent = rows.task.status === "running"
        && rows.task.claim_token === input.claimToken
        && rows.task.outcome_status === "provider_dispatched"
        && rows.attempt.status === "running"
        && rows.attempt.outcome_status === "provider_dispatched"
        && rows.modelCall.status === "dispatching"
        && rows.modelCall.outcome_status === "provider_dispatched";
      const emergencyStopped = [
        rows.task.error_kind,
        rows.attempt.error_kind,
        rows.modelCall.error_kind,
      ].includes("operator_emergency_stop");
      const activeAuthority = dispatchCandidate
        && state.state === "activated"
        && state.terminal !== true
        && state.expired !== true;
      const current = rowCurrent && activeAuthority;
      const terminalRetention = !current && (
        emergencyStopped
        || ["revoked", "expired"].includes(state.state)
        || state.expired === true
      );
      if (
        input.taskId !== assignment.taskId
        || input.taskAttemptId !== rows.ids.attemptId
        || input.descriptorHash !== attemptMetadata.descriptorHash
        || input.descriptorHash !== modelMetadata.descriptorHash
        || input.clientRequestId !== attemptMetadata.clientRequestId
        || input.clientRequestId !== modelMetadata.clientRequestId
        || rows.attempt.provider_dispatch_model_call_id !== rows.ids.modelCallId
        || !Number.isFinite(Date.parse(dispatchedAt))
        || Date.parse(dispatchedAt) >= Date.parse(authority.expiresAt)
        || (!current && !terminalRetention)
      ) {
        throw bridgeError(
          "preventure_bridge_retention_binding_changed",
          "The late provider bytes do not match one exact original pre-expiry dispatch.",
        );
      }
      return Object.freeze({
        retentionBound: true,
        current,
        terminalRetention,
        emergencyStopped,
        lifecycleState: state.state,
        latestLifecycleEventHash: latestLifecycle?.eventHash || null,
        claimToken: input.claimToken,
        authorityHash: assignment.authorityHash,
        assignmentHash: assignment.assignmentHash,
        descriptorHash: input.descriptorHash,
        taskId: assignment.taskId,
        taskAttemptId: rows.ids.attemptId,
        modelCallId: rows.ids.modelCallId,
        clientRequestId: input.clientRequestId,
        providerDispatchedAt: dispatchedAt,
      });
    });
  }

  function inspectProviderArtifactCustody(input = {}) {
    return withImmediate(db, "custody_inspection", () => {
      const assignment = exactAssignment(
        store,
        authority,
        input.authorityHash,
        input.assignmentHash,
      );
      const rows = exactClaimRows(
        db,
        null,
        assignment,
        ["running", "needs_attention"],
      );
      const retained = input.retainedOutput;
      if (!isObject(retained) || !HASH_PATTERN.test(String(retained.artifactHash || ""))) {
        throw bridgeError(
          "preventure_bridge_terminal_custody_artifact_invalid",
          "Terminal custody requires one exact immutable provider artifact.",
        );
      }
      const manifest = outputStore.load({
        retainedOutputHash: retainedOutputReference(retained.artifactHash),
        authorityHash: assignment.authorityHash,
        assignmentHash: assignment.assignmentHash,
        descriptorHash: input.descriptorHash,
      });
      const attemptMetadata = parseJson(rows.attempt.metadata);
      const modelMetadata = parseJson(rows.modelCall.metadata);
      const state = store.readState(assignment.authorityHash);
      const lifecycle = store.loadLifecycle(assignment.authorityHash);
      const latestLifecycle = lifecycle.at(-1) || null;
      const dispatchedAt = String(rows.attempt.provider_dispatched_at || "");
      const emergencyStopped = [rows.attempt.error_kind, rows.modelCall.error_kind]
        .includes("operator_emergency_stop");
      const terminalState = emergencyStopped
        ? "emergency_stopped"
        : state.expired === true ? "expired" : state.state;
      const custodyRequired = emergencyStopped
        || ["revoked", "expired"].includes(terminalState);
      const activeReprocessAllowed = !custodyRequired
        && dispatchCandidate
        && state.state === "activated"
        && state.terminal !== true
        && state.expired !== true;
      if (
        input.taskId !== assignment.taskId
        || (input.taskAttemptId !== null
          && input.taskAttemptId !== undefined
          && input.taskAttemptId !== rows.ids.attemptId)
        || (input.modelCallId !== null
          && input.modelCallId !== undefined
          && input.modelCallId !== rows.ids.modelCallId)
        || (input.claimToken !== null
          && input.claimToken !== undefined
          && input.claimToken !== rows.attempt.claim_token)
        || input.descriptorHash !== attemptMetadata.descriptorHash
        || input.descriptorHash !== modelMetadata.descriptorHash
        || input.requestBodyHash !== attemptMetadata.requestBodyHash
        || input.requestBodyHash !== modelMetadata.requestBodyHash
        || input.clientRequestId !== attemptMetadata.clientRequestId
        || input.clientRequestId !== modelMetadata.clientRequestId
        || input.providerRequestId !== manifest.providerRequestId
        || input.providerResponseId !== manifest.providerResponseId
        || retained.artifactHash !== manifest.artifactHash
        || retained.rawProviderBodyHash !== manifest.rawProviderBodyHash
        || retained.requestBodyHash !== manifest.requestBodyHash
        || retained.clientRequestId !== manifest.clientRequestId
        || rows.attempt.provider_dispatch_model_call_id !== rows.ids.modelCallId
        || !Number.isFinite(Date.parse(dispatchedAt))
        || Date.parse(dispatchedAt) >= Date.parse(authority.expiresAt)
        || (!custodyRequired && !activeReprocessAllowed)
      ) {
        throw bridgeError(
          "preventure_bridge_terminal_custody_binding_changed",
          "The retained artifact does not match one exact original provider dispatch and current terminal truth.",
        );
      }
      return Object.freeze({
        inspected: true,
        custodyRequired,
        activeReprocessAllowed,
        terminalState,
        emergencyStopped,
        authorityHash: assignment.authorityHash,
        assignmentHash: assignment.assignmentHash,
        descriptorHash: input.descriptorHash,
        requestBodyHash: input.requestBodyHash,
        taskId: assignment.taskId,
        taskAttemptId: rows.ids.attemptId,
        modelCallId: rows.ids.modelCallId,
        claimToken: rows.attempt.claim_token,
        clientRequestId: input.clientRequestId,
        providerRequestId: input.providerRequestId,
        providerResponseId: input.providerResponseId,
        retainedOutputHash: manifest.artifactHash,
        retainedOutputRef: manifest.artifactRef,
        providerDispatchedAt: dispatchedAt,
        latestLifecycleEventHash: latestLifecycle?.eventHash || null,
      });
    });
  }

  function completeKnown(input, options = {}) {
    return withImmediate(db, options.reprocessing ? "reprocess" : "complete", () => {
      const assignment = exactAssignment(
        store,
        authority,
        input.authorityHash,
        input.assignmentHash,
      );
      const rows = exactClaimRows(
        db,
        options.reprocessing ? null : input.claimToken,
        assignment,
        options.reprocessing ? ["needs_attention"] : ["running"],
      );
      if (
        assignment.taskId !== input.taskId
        || input.descriptorHash !== parseJson(rows.attempt.metadata).descriptorHash
        || input.providerResponseId !== input.retainedOutput?.providerResponseId
        || input.providerRequestId !== input.retainedOutput?.providerRequestId
        || input.retainedOutput?.assignmentHash !== assignment.assignmentHash
        || input.retainedOutput?.descriptorHash !== input.descriptorHash
        || input.resultHash !== sha256({
          outputHash: input.retainedOutput.outputHash,
          providerResponseHash: input.retainedOutput.providerResponseHash,
          groundedSourceSetHash: input.retainedOutput.groundedSourceSetHash,
          preparedEvidenceBatchHash: input.preparedEvidenceBatchHash,
        })
      ) {
        throw bridgeError(
          "preventure_bridge_completion_binding_changed",
          "The retained provider result does not match the exact claimed assignment.",
        );
      }
      if (
        options.reprocessing
        && parseJson(rows.task.result).retainedOutputRef
          !== (input.retainedOutput.artifactRef || input.retainedOutput.location)
      ) {
        throw bridgeError(
          "preventure_bridge_reprocess_artifact_changed",
          "Local recovery received a different immutable provider artifact.",
        );
      }
      const completedAt = String(input.completedAt || now(clock));
      const staged = stageGenericResearchEvidence(
        db,
        assignment,
        rows,
        input,
        completedAt,
      );
      const usage = usageFromRetained(input.retainedOutput);
      if (usage.status !== "reported") {
        throw bridgeError(
          "preventure_bridge_usage_unknown",
          "Known evidence cannot complete without provider-reported usage.",
        );
      }
      const estimatedCost = Number(input.retainedOutput.billing?.costAudCents);
      const httpStatus = Number(
        input.httpStatus ?? input.retainedOutput.responseMetadata?.httpStatus,
      );
      if (
        !Number.isSafeInteger(estimatedCost)
        || estimatedCost < 0
        || estimatedCost > assignment.maxCostAudCents
        || !Number.isSafeInteger(httpStatus)
        || httpStatus < 200
        || httpStatus > 299
      ) {
        throw bridgeError(
          "preventure_bridge_cost_unknown",
          "Known evidence cannot complete without an in-cap usage-derived cost estimate.",
        );
      }
      const providerMetadata = canonicalJson({
        schema: CLAIM_METADATA_SCHEMA,
        authorityHash: assignment.authorityHash,
        assignmentId: assignment.id,
        assignmentHash: assignment.assignmentHash,
        descriptorHash: input.descriptorHash,
        requestBodyHash: parseJson(rows.modelCall.metadata).requestBodyHash,
        providerRequestId: input.providerRequestId,
        providerResponseId: input.providerResponseId,
        clientRequestId: parseJson(rows.modelCall.metadata).clientRequestId,
        clientRequestHash: sha256(parseJson(rows.modelCall.metadata).clientRequestId),
        tokenUsage: usage,
        pricingPolicyHash: authority.provider.pricingPolicyHash,
        exactBillingPending: true,
        retainedOutputRef: input.retainedOutput.artifactRef || input.retainedOutput.location,
        retainedOutputHash: input.retainedOutput.artifactHash || null,
        preparedEvidenceBatchHash: input.preparedEvidenceBatchHash,
        validatedCoverage: staged.prepared.validatedCoverage,
        httpStatus,
        responseIssues: [],
        responseIssuesHash: sha256([]),
        resultHash: input.resultHash,
      });
      db.prepare(
        `UPDATE model_calls
         SET status = 'completed', input_tokens = ?, output_tokens = ?,
             estimated_cost_cents = ?, actual_cost_cents = 0,
             provider_request_id = ?, cost_status = 'incurred_estimate',
             reserved_cost_cents = 0, incurred_estimate_cents = ?,
             reconciled_cost_cents = 0, outcome_status = 'known',
             error_kind = NULL, error = NULL, metadata = ?, completed_at = ?
         WHERE id = ?`,
      ).run(
        usage.inputTokens,
        usage.outputTokens,
        estimatedCost,
        input.providerRequestId,
        estimatedCost,
        providerMetadata,
        completedAt,
        rows.ids.modelCallId,
      );
      const result = canonicalJson({
        schema: "pantheon.preventure-research-task-result.v1",
        authorityHash: assignment.authorityHash,
        assignmentHash: assignment.assignmentHash,
        descriptorHash: input.descriptorHash,
        providerRequestId: input.providerRequestId,
        providerResponseId: input.providerResponseId,
        clientRequestId: parseJson(rows.modelCall.metadata).clientRequestId,
        clientRequestHash: sha256(parseJson(rows.modelCall.metadata).clientRequestId),
        retainedOutputRef: input.retainedOutput.artifactRef || input.retainedOutput.location,
        retainedOutputHash: input.retainedOutput.artifactHash || null,
        rawOutputArtifactHash: input.retainedOutput.artifactHash || null,
        httpStatus,
        responseIssues: [],
        responseIssuesHash: sha256([]),
        structuredOutput: staged.structuredOutput,
        structuredOutputHash: sha256(staged.structuredOutput),
        preparedEvidenceBatchHash: input.preparedEvidenceBatchHash,
        validatedCoverage: staged.prepared.validatedCoverage,
        resultHash: input.resultHash,
        modelInferenceOnly: true,
        noPageContentCaptured: true,
        buildAuthorized: false,
        commercialTestAuthorized: false,
        externalActionAuthorized: false,
      });
      db.prepare(
        `UPDATE tasks
         SET status = 'completed', outcome_status = 'known', result = ?, error = NULL,
             cost_actual_cents = 0, completed_at = ?, updated_at = ?,
             claim_token = NULL, claimed_at = NULL
         WHERE id = ?`,
      ).run(result, completedAt, completedAt, assignment.taskId);
      db.prepare(
        `UPDATE task_attempts
         SET status = 'completed', outcome_status = 'known', provider_request_id = ?,
             error_kind = NULL, error = NULL, completed_at = ?, metadata = ?
         WHERE id = ?`,
      ).run(input.providerRequestId, completedAt, providerMetadata, rows.ids.attemptId);
      db.prepare(
        `UPDATE agent_runs
         SET status = 'completed', output_summary = ?, model_call_id = ?,
             estimated_cost_cents = ?, actual_cost_cents = 0, eval_status = 'passed',
             metadata = ?, completed_at = ?
         WHERE id = ?`,
      ).run(
        `Strict bounded research output retained for ${assignment.id}; all public web material remains partial grounding/model inference.`,
        rows.ids.modelCallId,
        estimatedCost,
        providerMetadata,
        completedAt,
        rows.ids.runId,
      );
      db.prepare(
        `UPDATE agent_tool_invocations
         SET status = 'completed', decision = 'provider_activity_observed',
             output_summary = ?, resolved_at = ?, metadata = ?
         WHERE id = ? AND attempt_id = ?`,
      ).run(
        `Provider returned ${input.retainedOutput.groundedSources.length} partial grounding source record(s).`,
        completedAt,
        canonicalJson({
          schema: "pantheon.preventure-tool-invocation.v1",
          authorityHash: assignment.authorityHash,
          assignmentHash: assignment.assignmentHash,
          descriptorHash: input.descriptorHash,
          providerRequestId: input.providerRequestId,
          providerResponseId: input.providerResponseId,
          toolCallCount: input.retainedOutput.providerResponse.output.filter(
            (item) => item?.type === "web_search_call",
          ).length,
          partialGroundingSourceCount: input.retainedOutput.groundedSources.length,
          noPageContentCaptured: true,
        }),
        rows.ids.toolInvocationId,
        rows.ids.attemptId,
      );
      insertEvaluation(
        db,
        rows,
        "passed",
        100,
        input.resultHash,
        completedAt,
        {
          assignmentHash: assignment.assignmentHash,
          descriptorHash: input.descriptorHash,
          preparedEvidenceBatchHash: input.preparedEvidenceBatchHash,
          modelInferenceOnly: true,
        },
      );
      insertTrace(
        db,
        rows.ids.runId,
        "run_completed",
        "Bounded research completed",
        "The exact structured result, partial grounding, cost estimate, and local evaluation were retained.",
        {
          assignmentHash: assignment.assignmentHash,
          resultHash: input.resultHash,
          reprocessedLocally: options.reprocessing === true,
        },
        completedAt,
      );
      const receipt = finalizeAgentExecutionReceipt(db, {
        attemptId: rows.ids.attemptId,
        runId: rows.ids.runId,
      });
      if (
        receipt.status !== "complete"
        || receipt.outcome_status !== "known"
        || receipt.missing_fields.length !== 0
        || receipt.warnings.length !== 0
        || receipt.receipt?.provider?.metadata?.providerResponseId !== input.providerResponseId
        || receipt.receipt?.provider?.providerRequestId !== input.providerRequestId
      ) {
        const identityDetail = canonicalJson({
          receiptStatus: receipt.status ?? null,
          receiptOutcomeStatus: receipt.outcome_status ?? null,
          receiptMissingFields: receipt.missing_fields || [],
          receiptWarnings: receipt.warnings || [],
          expectedProviderRequestId: input.providerRequestId,
          expectedProviderResponseId: input.providerResponseId,
          receiptProviderRequestId: receipt.receipt?.provider?.providerRequestId ?? null,
          receiptProviderResponseId: receipt.receipt?.provider?.providerResponseId ?? null,
          receiptMetadataProviderResponseId:
            receipt.receipt?.provider?.metadata?.providerResponseId ?? null,
        });
        throw bridgeError(
          "preventure_bridge_final_receipt_incomplete",
          `The canonical completion receipt is not exact (${receipt.missing_fields.join(", ") || receipt.warnings.join(", ") || identityDetail}).`,
        );
      }
      const sourceBindings = staged.sourceBindings.map((binding) => ({
        ...binding,
        agentRunReceiptId: receipt.id,
      }));
      const persisted = store.withAtomicEvidenceBatch((writers) => input.persistEvidence({
        researchRunId: rows.ids.researchRunId,
        agentRunReceiptId: receipt.id,
        sourceBindings,
        recordSourceSnapshot: writers.recordSourceSnapshot,
        recordEvidence: writers.recordEvidence,
      }));
      if (
        !isObject(persisted)
        || persisted.sourceSnapshots?.length !== staged.prepared.sourceSnapshots.length
        || persisted.evidenceRecords?.length !== staged.prepared.evidenceRecords.length
      ) {
        throw bridgeError(
          "preventure_bridge_evidence_commit_incomplete",
          "The authority evidence batch did not commit completely.",
        );
      }
      const ledger = store.readLedger(assignment.authorityHash);
      const cost = ledger.costEvents.filter(
        (event) => event.assignmentHash === assignment.assignmentHash,
      ).at(-1);
      if (!cost || !["estimated", "incurred", "reconciled"].includes(cost.eventType)) {
        throw bridgeError(
          "preventure_bridge_cost_receipt_missing",
          "The final evidence receipt has no known cost truth.",
        );
      }
      store.appendCostEvent(assignment.assignmentHash, {
        costKey: cost.costKey,
        eventType: cost.eventType,
        amountAudCents: cost.amountAudCents,
        exposureAudCents: cost.exposureAudCents,
        taskAttemptId: rows.ids.attemptId,
        modelCallId: rows.ids.modelCallId,
        agentRunReceiptId: receipt.id,
        occurredAt: completedAt,
      });
      const authorityOrder = authority.assignments.map((item) => item.id);
      const currentIndex = authorityOrder.indexOf(assignment.id);
      const assignmentsById = new Map(
        store.listAssignments(assignment.authorityHash).map((candidate) => [candidate.id, candidate]),
      );
      const later = authorityOrder.slice(currentIndex + 1)
        .map((id) => assignmentsById.get(id))
        .find((candidate) => {
          if (!candidate) return false;
          const task = db.prepare("SELECT status FROM tasks WHERE id = ?").get(candidate.taskId);
          return task && !["completed", "skipped", "cancelled"].includes(task.status);
        });
      const lifecycleState = store.readState(assignment.authorityHash).state;
      if (!options.reprocessing || lifecycleState === "activated") {
        db.prepare(
          `UPDATE workflows SET status = ?, current_step = ?, updated_at = ? WHERE id = ?`,
        ).run(
          later ? "blocked" : "needs_review",
          later
            ? `Next bounded assignment awaits exact readiness: ${later.id}`
            : "All bounded assignments completed; diligence decision review is next.",
          completedAt,
          assignment.workflowId,
        );
      }
      return Object.freeze({
        status: "complete",
        researchRunId: rows.ids.researchRunId,
        agentRunReceiptId: receipt.id,
        resultHash: input.resultHash,
        sourceSnapshots: persisted.sourceSnapshots,
        evidenceRecords: persisted.evidenceRecords,
      });
    });
  }

  function commitKnownEvidence(input = {}) {
    return completeKnown(input, { reprocessing: false });
  }

  function commitReprocessedEvidence(input = {}) {
    if (input.additionalAiCostAudCents !== 0) {
      throw bridgeError(
        "preventure_bridge_reprocess_cost_changed",
        "Retained-output recovery must add exactly A$0.00 of AI cost.",
      );
    }
    return completeKnown(input, { reprocessing: true });
  }

  function normalizedKnownCost(input, assignment) {
    const eventType = String(input.costStatus || "");
    const amountAudCents = Number(input.costAudCents);
    const exposureAudCents = Number(
      input.exposureAudCents ?? input.retainedOutput?.billing?.exposureAudCents
        ?? amountAudCents,
    );
    if (
      !["estimated", "incurred", "reconciled"].includes(eventType)
      || !Number.isSafeInteger(amountAudCents)
      || amountAudCents < 0
      || !Number.isSafeInteger(exposureAudCents)
      || exposureAudCents < amountAudCents
      || exposureAudCents > assignment.maxCostAudCents
    ) {
      throw bridgeError(
        "preventure_bridge_terminal_cost_invalid",
        "The terminal research cost or exposure is outside the exact assignment cap.",
      );
    }
    return Object.freeze({
      eventType,
      genericStatus: genericCostStatus(eventType),
      amountAudCents,
      exposureAudCents,
      exactBillingPending: ["estimated", "incurred"].includes(eventType),
    });
  }

  function completeTechnicalTerminal(input = {}) {
    const assignment = exactAssignment(
      store,
      authority,
      input.authorityHash,
      input.assignmentHash,
    );
    const rows = exactClaimRows(db, input.claimToken, assignment, ["running"]);
    const retained = input.retainedOutput;
    const completedAt = String(input.completedAt || now(clock));
    const preEffect = input.triggerOutcomeClass === "known_failed_before_effect";
    const knownUnusable = input.triggerOutcomeClass
      === "known_retained_unusable_provider_response";
    const responseIssues = Array.isArray(input.responseIssues)
      ? [...new Set(input.responseIssues.map((item) => String(item || "").trim())
        .filter(Boolean))].sort()
      : null;
    const cost = normalizedKnownCost(input, assignment);
    const durableClientRequestId = parseJson(rows.attempt.metadata).clientRequestId;
    const clientRequestHash = sha256(input.clientRequestId);
    const responseIssuesHash = sha256(responseIssues);
    const httpStatus = Number(
      input.httpStatus ?? retained?.responseMetadata?.httpStatus,
    );
    if (
      (!preEffect && !knownUnusable)
      || !isObject(retained)
      || retained.retained !== true
      || retained.assignmentHash !== assignment.assignmentHash
      || retained.descriptorHash !== input.descriptorHash
      || retained.clientRequestId !== input.clientRequestId
      || retained.providerRequestId !== (input.providerRequestId ?? null)
      || retained.providerResponseId !== (input.providerResponseId ?? null)
      || retained.artifactHash !== input.rawOutputArtifactHash
      || !HASH_PATTERN.test(String(retained.rawProviderBodyHash || ""))
      || durableClientRequestId !== input.clientRequestId
      || input.taskId !== assignment.taskId
      || input.taskAttemptId !== rows.ids.attemptId
      || input.modelCallId !== rows.ids.modelCallId
      || input.responseIssuesHash !== responseIssuesHash
      || responseIssues === null
      || responseIssues.length < 1
      || !Number.isSafeInteger(httpStatus)
      || (preEffect
        ? (
            retained.artifactKind !== "known_pre_effect_rejection"
            || input.mode !== "definite_pre_effect"
            || input.providerResponseId !== null
            || input.officialEndpointHash !== PREVENTURE_OFFICIAL_RESPONSES_ENDPOINT_HASH
            || input.providerErrorBodyArtifactHash !== retained.artifactHash
            || input.providerErrorType !== retained.responseMetadata?.providerErrorType
            || input.providerErrorCode !== retained.responseMetadata?.providerErrorCode
            || input.providerZeroBillingGuarantee !== false
            || cost.eventType !== "estimated"
            || cost.amountAudCents !== 0
            || cost.exposureAudCents !== assignment.maxCostAudCents
          )
        : (
            !["canonical_known_response", "known_effect_invalid"]
              .includes(retained.artifactKind)
            || input.mode !== "known_effect_unusable"
            || httpStatus < 200
            || httpStatus > 299
            || (input.providerErrorType ?? null) !== null
            || (input.providerErrorCode ?? null) !== null
            || (input.providerErrorBodyArtifactHash ?? null) !== null
            || (input.providerZeroBillingGuarantee ?? null) !== null
          ))
    ) {
      throw bridgeError(
        "preventure_bridge_terminal_binding_changed",
        "The technical terminal trigger does not match its exact claim, retained artifact, provider identity, or billing truth.",
      );
    }
    const expectedKnownUnusableHash = sha256({
      triggerOutcomeClass: "known_retained_unusable_provider_response",
      authorityHash: assignment.authorityHash,
      assignmentHash: assignment.assignmentHash,
      descriptorHash: input.descriptorHash,
      rawOutputArtifactHash: retained.artifactHash,
      responseIssues,
    });
    const expectedPreEffectHash = sha256({
      triggerOutcomeClass: "known_failed_before_effect",
      authorityHash: assignment.authorityHash,
      assignmentHash: assignment.assignmentHash,
      descriptorHash: input.descriptorHash,
      requestBodyHash: retained.requestBodyHash,
      taskAttemptId: rows.ids.attemptId,
      modelCallId: rows.ids.modelCallId,
      clientRequestId: input.clientRequestId,
      providerRequestId: input.providerRequestId ?? null,
      providerResponseId: null,
      officialEndpointHash: PREVENTURE_OFFICIAL_RESPONSES_ENDPOINT_HASH,
      httpStatus,
      providerErrorType: input.providerErrorType,
      providerErrorCode: input.providerErrorCode,
      rawOutputArtifactHash: retained.artifactHash,
      rawProviderBodyHash: retained.rawProviderBodyHash,
      responseIssues,
      costTruth: {
        costStatus: cost.eventType,
        costAudCents: cost.amountAudCents,
        exposureAudCents: cost.exposureAudCents,
        exactBillingPending: cost.exactBillingPending,
        providerZeroBillingGuarantee: false,
      },
    });
    if (
      (knownUnusable && input.resultHash !== expectedKnownUnusableHash)
      || (preEffect && input.resultHash !== expectedPreEffectHash)
    ) {
      throw bridgeError(
        "preventure_bridge_terminal_result_changed",
        "The exact terminal provider result changed before commit.",
      );
    }
    const usage = usageFromRetained(retained);
    const providerMetadataObject = {
      ...parseJson(rows.modelCall.metadata),
      providerRequestId: input.providerRequestId ?? null,
      providerResponseId: input.providerResponseId ?? null,
      clientRequestId: input.clientRequestId,
      clientRequestHash,
      retainedOutputRef: retained.artifactRef || retained.location,
      retainedOutputHash: retained.artifactHash,
      rawOutputArtifactHash: retained.artifactHash,
      responseIssues,
      responseIssuesHash,
      httpStatus,
      officialEndpointHash: preEffect
        ? PREVENTURE_OFFICIAL_RESPONSES_ENDPOINT_HASH
        : null,
      providerErrorType: preEffect ? input.providerErrorType : null,
      providerErrorCode: preEffect ? input.providerErrorCode : null,
      providerErrorBodyArtifactHash: preEffect
        ? input.providerErrorBodyArtifactHash
        : null,
      providerZeroBillingGuarantee: preEffect ? false : null,
      exactBillingPending: cost.exactBillingPending,
      tokenUsage: usage,
      resultHash: input.resultHash,
    };
    const providerMetadata = canonicalJson(providerMetadataObject);
    const outcomeStatus = preEffect ? "failed_before_effect" : "known";
    const modelStatus = preEffect ? "failed" : "completed";
    const attemptStatus = preEffect ? "failed" : "completed";
    const errorKind = preEffect
      ? "definite_pre_effect_http_rejection"
      : "known_provider_response_unusable";
    const reason = preEffect
      ? "The official provider rejected the request before a usable effect; billing remains pending reconciliation."
      : "The retained known provider response was structurally unusable and contributes no commercial evidence.";
    db.prepare(
      `UPDATE model_calls
       SET status = ?, input_tokens = ?, output_tokens = ?, estimated_cost_cents = ?,
           actual_cost_cents = ?, provider_request_id = ?, cost_status = ?,
           reserved_cost_cents = 0, incurred_estimate_cents = ?,
           reconciled_cost_cents = ?, outcome_status = ?, error_kind = ?, error = ?,
           metadata = ?, completed_at = ? WHERE id = ?`,
    ).run(
      modelStatus,
      usage.inputTokens || 0,
      usage.outputTokens || 0,
      cost.eventType === "reconciled" ? 0 : cost.amountAudCents,
      cost.eventType === "reconciled" ? cost.amountAudCents : 0,
      input.providerRequestId ?? null,
      cost.genericStatus,
      ["estimated", "incurred"].includes(cost.eventType) ? cost.amountAudCents : 0,
      cost.eventType === "reconciled" ? cost.amountAudCents : 0,
      outcomeStatus,
      errorKind,
      reason,
      providerMetadata,
      completedAt,
      rows.ids.modelCallId,
    );
    const taskResult = canonicalJson({
      schema: "pantheon.preventure-research-task-result.v1",
      authorityHash: assignment.authorityHash,
      assignmentHash: assignment.assignmentHash,
      descriptorHash: input.descriptorHash,
      clientRequestId: input.clientRequestId,
      clientRequestHash,
      providerRequestId: input.providerRequestId ?? null,
      providerResponseId: input.providerResponseId ?? null,
      retainedOutputRef: retained.artifactRef || retained.location,
      retainedOutputHash: retained.artifactHash,
      rawOutputArtifactHash: retained.artifactHash,
      responseIssues,
      responseIssuesHash,
      httpStatus,
      officialEndpointHash: preEffect
        ? PREVENTURE_OFFICIAL_RESPONSES_ENDPOINT_HASH
        : null,
      providerErrorType: preEffect ? input.providerErrorType : null,
      providerErrorCode: preEffect ? input.providerErrorCode : null,
      providerErrorBodyArtifactHash: preEffect
        ? input.providerErrorBodyArtifactHash
        : null,
      providerZeroBillingGuarantee: preEffect ? false : null,
      resultHash: input.resultHash,
      retryAuthorized: false,
      buildAuthorized: false,
      commercialTestAuthorized: false,
      externalActionAuthorized: false,
    });
    db.prepare(
      `UPDATE tasks
       SET status = 'completed', outcome_status = ?, result = ?, error = ?,
           cost_actual_cents = ?, completed_at = ?, updated_at = ?,
           claim_token = NULL, claimed_at = NULL WHERE id = ?`,
    ).run(
      outcomeStatus,
      taskResult,
      reason,
      cost.eventType === "reconciled" ? cost.amountAudCents : 0,
      completedAt,
      completedAt,
      assignment.taskId,
    );
    db.prepare(
      `UPDATE task_attempts
       SET status = ?, outcome_status = ?, provider_request_id = ?, error_kind = ?,
           error = ?, metadata = ?, completed_at = ? WHERE id = ?`,
    ).run(
      attemptStatus,
      outcomeStatus,
      input.providerRequestId ?? null,
      errorKind,
      reason,
      providerMetadata,
      completedAt,
      rows.ids.attemptId,
    );
    db.prepare(
      `UPDATE agent_runs
       SET status = 'failed', output_summary = ?, estimated_cost_cents = ?,
           actual_cost_cents = ?, eval_status = 'failed', metadata = ?, completed_at = ?
       WHERE id = ?`,
    ).run(
      reason,
      cost.eventType === "reconciled" ? 0 : cost.amountAudCents,
      cost.eventType === "reconciled" ? cost.amountAudCents : 0,
      providerMetadata,
      completedAt,
      rows.ids.runId,
    );
    const invocation = db.prepare(
      "SELECT id FROM agent_tool_invocations WHERE id = ?",
    ).get(rows.ids.toolInvocationId);
    if (invocation) {
      db.prepare(
        `UPDATE agent_tool_invocations
         SET status = 'completed', decision = ?, output_summary = ?, resolved_at = ?,
             metadata = ? WHERE id = ?`,
      ).run(
        preEffect ? "provider_rejected_before_effect" : "provider_response_unusable",
        reason,
        completedAt,
        providerMetadata,
        rows.ids.toolInvocationId,
      );
    }
    insertEvaluation(db, rows, "failed", 0, input.resultHash, completedAt, {
      assignmentHash: assignment.assignmentHash,
      triggerOutcomeClass: input.triggerOutcomeClass,
      commercialEvidenceRetained: false,
    });
    insertTrace(
      db,
      rows.ids.runId,
      "run_failed",
      preEffect ? "Provider rejected the bounded request" : "Provider response unusable",
      reason,
      {
        triggerOutcomeClass: input.triggerOutcomeClass,
        retainedOutputHash: retained.artifactHash,
        retryAuthorized: false,
      },
      completedAt,
    );
    const receipt = finalizeAgentExecutionReceipt(db, {
      attemptId: rows.ids.attemptId,
      runId: rows.ids.runId,
    });
    store.appendCostEvent(assignment.assignmentHash, {
      costKey: input.costKey,
      eventType: cost.eventType,
      amountAudCents: cost.amountAudCents,
      exposureAudCents: cost.exposureAudCents,
      exactBillingPending: cost.exactBillingPending,
      providerZeroBillingGuarantee: preEffect ? false : null,
      taskAttemptId: rows.ids.attemptId,
      modelCallId: rows.ids.modelCallId,
      agentRunReceiptId: receipt.id,
      occurredAt: completedAt,
    });
    return Object.freeze({
      assignment,
      rows,
      receipt,
      sourceSnapshots: [],
      evidenceRecords: [],
      clientRequestHash,
      responseIssuesHash,
      httpStatus,
      cost,
    });
  }

  function sealValidatedTerminalDecision(input, completion) {
    const preEffect = input.triggerOutcomeClass === "known_failed_before_effect";
    const providerEvidence = {
      attemptId: completion.rows.ids.attemptId,
      modelCallId: completion.rows.ids.modelCallId,
      agentRunReceiptId: completion.receipt.id,
      effectState: preEffect ? "definite_pre_effect" : "known_effect",
      officialEndpointHash: preEffect
        ? PREVENTURE_OFFICIAL_RESPONSES_ENDPOINT_HASH
        : null,
      httpStatus: completion.httpStatus,
      providerErrorType: preEffect ? input.providerErrorType : null,
      providerErrorCode: preEffect ? input.providerErrorCode : null,
      providerErrorBodyArtifactHash: preEffect
        ? input.providerErrorBodyArtifactHash
        : null,
      providerRequestId: input.providerRequestId ?? null,
      providerResponseId: input.providerResponseId ?? null,
      clientRequestHash: completion.clientRequestHash,
      rawOutputArtifactHash: input.retainedOutput.artifactHash,
      responseIssuesHash: completion.responseIssuesHash,
      costStatus: completion.cost.eventType,
      costAudCents: completion.cost.amountAudCents,
      exposureAudCents: completion.cost.exposureAudCents,
      exactBillingPending: completion.cost.exactBillingPending,
      providerZeroBillingGuarantee: preEffect ? false : null,
    };
    const terminalStopInput = {
      triggerAssignmentId: completion.assignment.id,
      triggerAssignmentHash: completion.assignment.assignmentHash,
      triggerOutcomeClass: input.triggerOutcomeClass,
      providerEvidence,
      stoppedAt: String(input.completedAt || now(clock)),
    };
    const preview = finalizeDecision.preview({
      authorityHash: completion.assignment.authorityHash,
      terminalStopInput,
    });
    const recorded = finalizeDecision({
      authorityHash: completion.assignment.authorityHash,
      terminalStopInput,
      expectedEvidenceSetHash: preview.expectedEvidenceSetHash,
      expectedReceiptSetHash: preview.expectedReceiptSetHash,
      expectedResultingReadinessHash: preview.expectedResultingReadinessHash,
    });
    db.prepare(
      `UPDATE workflows SET status = 'completed', current_step = ?, updated_at = ?
       WHERE id = ?`,
    ).run(
      `Bounded diligence completed: ${recorded.decision.outcome}.`,
      terminalStopInput.stoppedAt,
      completion.assignment.workflowId,
    );
    return Object.freeze({
      status: "validated_early_stop",
      completionMode: "validated_early_stop",
      resultHash: input.resultHash,
      earlyStopRecordHash: recorded.stopRecord.earlyStopRecordHash,
      stopRecord: recorded.stopRecord,
      skippedAssignments: recorded.skippedAssignments,
      skippedAssignmentRecordHashes: recorded.skippedAssignments
        .map((item) => item.skipRecordHash),
      decision: recorded.decision,
      completionEvent: recorded.completionEvent,
      resultingReadinessHash: recorded.resultingReadinessHash,
      sourceSnapshots: completion.sourceSnapshots,
      evidenceRecords: completion.evidenceRecords,
    });
  }

  function commitValidatedEarlyStop(input = {}) {
    return withImmediate(db, "validated_early_stop", () => {
      const technical = [
        "known_failed_before_effect",
        "known_retained_unusable_provider_response",
      ].includes(input.triggerOutcomeClass);
      const completion = technical
        ? completeTechnicalTerminal(input)
        : (() => {
            if (input.triggerOutcomeClass !== "validated_evidence_shortfall") {
              throw bridgeError(
                "preventure_bridge_terminal_class_invalid",
                "The terminal research class is not supported.",
              );
            }
            const exact = completeKnown(input, { reprocessing: input.reprocessing === true });
            const assignment = exactAssignment(
              store,
              authority,
              input.authorityHash,
              input.assignmentHash,
            );
            const rows = exactClaimRows(db, null, assignment, ["completed"]);
            const receipt = db.prepare(
              `SELECT * FROM agent_run_receipts WHERE id = ?`,
            ).get(exact.agentRunReceiptId);
            const responseIssues = [];
            const httpStatus = Number(
              input.httpStatus ?? input.retainedOutput?.responseMetadata?.httpStatus,
            );
            if (
              !receipt
              || !Number.isSafeInteger(httpStatus)
              || httpStatus < 200
              || httpStatus > 299
            ) {
              throw bridgeError(
                "preventure_bridge_terminal_binding_changed",
                "The evidence-shortfall stop lacks its exact final receipt or HTTP status.",
              );
            }
            const metadata = parseJson(rows.modelCall.metadata);
            const clientRequestId = input.clientRequestId
              || metadata.clientRequestId
              || input.retainedOutput?.clientRequestId;
            if (
              clientRequestId !== metadata.clientRequestId
              || clientRequestId !== input.retainedOutput?.clientRequestId
            ) {
              throw bridgeError(
                "preventure_bridge_terminal_binding_changed",
                "The evidence-shortfall stop changed its client request identity.",
              );
            }
            return Object.freeze({
              assignment,
              rows,
              receipt,
              sourceSnapshots: exact.sourceSnapshots,
              evidenceRecords: exact.evidenceRecords,
              clientRequestHash: sha256(clientRequestId),
              responseIssuesHash: sha256(responseIssues),
              httpStatus,
              cost: normalizedKnownCost(input, assignment),
            });
          })();
      return sealValidatedTerminalDecision(input, completion);
    });
  }

  function markKnownNeedsReprocess(input = {}) {
    return withImmediate(db, "known_attention", () => {
      const assignment = store.listAssignments(authority.authorityHash).find(
        (candidate) => candidate.assignmentHash === input.assignmentHash,
      );
      if (!assignment) {
        throw bridgeError(
          "preventure_bridge_assignment_missing",
          "The retained known result has no exact assignment.",
        );
      }
      const rows = exactClaimRows(db, input.claimToken, assignment, ["running", "needs_attention"]);
      const retained = input.retainedOutput;
      if (
        !isObject(retained)
        || retained.assignmentHash !== assignment.assignmentHash
        || retained.descriptorHash !== input.descriptorHash
        || retained.retained !== true
      ) {
        throw bridgeError(
          "preventure_bridge_retained_output_changed",
          "The known provider artifact changed before its recovery marker.",
        );
      }
      const completedAt = now(clock);
      const usage = usageFromRetained(retained);
      const providerResponseId = retained.providerResponseId || null;
      const providerRequestId = retained.providerRequestId || null;
      const cost = Number.isSafeInteger(retained.billing?.costAudCents)
        ? retained.billing.costAudCents
        : 0;
      const issues = retained.responseMetadata?.responseIssues || [];
      const reprocessEligible = retained.artifactKind === "canonical_known_response"
        && typeof retained.output === "string"
        && retained.output.length > 0
        && issues.length === 0;
      const metadata = canonicalJson({
        ...parseJson(rows.modelCall.metadata),
        providerRequestId,
        providerResponseId,
        tokenUsage: usage,
        retainedOutputRef: retained.artifactRef || retained.location,
        retainedOutputHash: retained.artifactHash || null,
        reprocessEligible,
        responseIssues: issues,
        reason: String(input.reason || "Known provider output requires local review."),
        exactBillingPending: true,
      });
      db.prepare(
        `UPDATE model_calls
         SET status = 'needs_attention', input_tokens = ?, output_tokens = ?,
             estimated_cost_cents = ?, provider_request_id = ?,
             cost_status = ?, incurred_estimate_cents = ?, outcome_status = 'known',
             error_kind = 'known_provider_result_needs_review', error = ?,
             metadata = ?, completed_at = ?
         WHERE id = ?`,
      ).run(
        usage.inputTokens || 0,
        usage.outputTokens || 0,
        cost,
        providerRequestId,
        retained.billing?.costStatus === "unknown" ? "unknown" : "incurred_estimate",
        cost,
        String(input.reason || "Known provider output requires local review."),
        metadata,
        completedAt,
        rows.ids.modelCallId,
      );
      const result = canonicalJson({
        schema: "pantheon.preventure-research-task-result.v1",
        authorityHash: assignment.authorityHash,
        assignmentHash: assignment.assignmentHash,
        descriptorHash: input.descriptorHash,
        providerRequestId,
        providerResponseId,
        retainedOutputRef: retained.artifactRef || retained.location,
        retainedOutputHash: retained.artifactHash || null,
        structuredOutputHash: sha256(retained.output),
        reprocessEligible,
        responseIssues: issues,
        reason: String(input.reason || "Known provider output requires local review."),
        retryAuthorized: false,
        additionalAiCostAudCents: 0,
      });
      db.prepare(
        `UPDATE tasks
         SET status = 'needs_attention', outcome_status = 'known_provider_result_needs_review',
             result = ?, error = ?, completed_at = ?, updated_at = ?,
             claim_token = NULL, claimed_at = NULL
         WHERE id = ?`,
      ).run(
        result,
        String(input.reason || "Known provider output requires local review."),
        completedAt,
        completedAt,
        assignment.taskId,
      );
      db.prepare(
        `UPDATE task_attempts
         SET status = 'needs_attention', outcome_status = 'known_provider_result_needs_review',
             provider_request_id = ?, error_kind = 'known_provider_result_needs_review',
             error = ?, metadata = ?, completed_at = ?
         WHERE id = ?`,
      ).run(
        providerRequestId,
        String(input.reason || "Known provider output requires local review."),
        metadata,
        completedAt,
        rows.ids.attemptId,
      );
      db.prepare(
        `UPDATE agent_runs
         SET status = 'failed', output_summary = ?, estimated_cost_cents = ?,
             actual_cost_cents = 0, eval_status = 'not_evaluable', metadata = ?,
             completed_at = ? WHERE id = ?`,
      ).run(
        "The provider result is retained, but local interpretation or evidence commit needs attention.",
        cost,
        metadata,
        completedAt,
        rows.ids.runId,
      );
      db.prepare(
        `UPDATE agent_tool_invocations
         SET status = 'needs_review', decision = 'provider_activity_retained',
             output_summary = ?, resolved_at = ? WHERE id = ?`,
      ).run(
        `Known provider activity retained; local reprocess eligible: ${reprocessEligible}.`,
        completedAt,
        rows.ids.toolInvocationId,
      );
      insertEvaluation(
        db,
        rows,
        "not_evaluable",
        0,
        String(input.reason || "Known provider output requires local review."),
        completedAt,
        {
          assignmentHash: assignment.assignmentHash,
          providerOutcomeKnown: true,
          reprocessEligible,
        },
      );
      insertTrace(
        db,
        rows.ids.runId,
        "run_failed",
        "Known provider result needs local attention",
        "Provider response and cost truth were retained; Pantheon will not retry the provider.",
        { reprocessEligible, retainedOutputHash: retained.artifactHash || null },
        completedAt,
      );
      const receipt = finalizeAgentExecutionReceipt(db, {
        attemptId: rows.ids.attemptId,
        runId: rows.ids.runId,
      });
      if (!["needs_review", "incomplete"].includes(receipt.status)) {
        throw bridgeError(
          "preventure_bridge_attention_receipt_invalid",
          "The known-needs-attention receipt has an invalid state.",
        );
      }
      db.prepare(
        `UPDATE workflows SET status = 'needs_attention', current_step = ?, updated_at = ?
         WHERE id = ?`,
      ).run(
        reprocessEligible
          ? "Known provider result retained; deterministic A$0 recovery is available."
          : "Known provider result retained but unusable; operator review is required.",
        completedAt,
        assignment.workflowId,
      );
      return Object.freeze({
        status: "known_provider_result_needs_review",
        receiptId: receipt.id,
        receiptStatus: receipt.status,
        reprocessEligible,
        retainedOutputHash: retained.artifactRef || retained.location,
      });
    });
  }

  function markKnownNeedsAttention(input = {}) {
    return withImmediate(db, "known_unretained_attention", () => {
      const assignment = exactAssignment(
        store,
        authority,
        input.authorityHash || authority.authorityHash,
        input.assignmentHash,
      );
      const rows = exactClaimRows(db, input.claimToken, assignment, ["running"]);
      if (input.retainedOutput !== null && input.retainedOutput !== undefined) {
        throw bridgeError(
          "preventure_bridge_unretained_effect_changed",
          "The unretained known-effect path cannot claim an immutable provider artifact.",
        );
      }
      const completedAt = String(input.occurredAt || now(clock));
      const providerRequestId = input.providerRequestId || null;
      const providerResponseId = input.providerResponseId || null;
      const knownCost = Number.isSafeInteger(input.costAudCents)
        && input.costAudCents >= 0
        && input.costAudCents <= assignment.maxCostAudCents
        ? input.costAudCents
        : null;
      const reason = String(
        input.reason || "A known provider effect could not be retained locally.",
      );
      const metadata = canonicalJson({
        ...parseJson(rows.modelCall.metadata),
        providerRequestId,
        providerResponseId,
        retainedOutputRef: null,
        retainedOutputHash: null,
        tokenUsage: { status: "unknown", inputTokens: null, outputTokens: null, totalTokens: null },
        costTruth: knownCost === null ? "unknown" : "known_estimate",
        reprocessEligible: false,
        retryAuthorized: false,
        reason,
      });
      db.prepare(
        `UPDATE model_calls
         SET status = 'needs_attention', provider_request_id = ?, cost_status = ?,
             reserved_cost_cents = 0, incurred_estimate_cents = ?,
             outcome_status = 'known', error_kind = 'known_provider_effect_unretained',
             error = ?, metadata = ?, completed_at = ? WHERE id = ?`,
      ).run(
        providerRequestId,
        knownCost === null ? "unknown" : "incurred_estimate",
        knownCost === null ? assignment.maxCostAudCents : knownCost,
        reason,
        metadata,
        completedAt,
        rows.ids.modelCallId,
      );
      const result = canonicalJson({
        schema: "pantheon.preventure-research-task-result.v1",
        authorityHash: assignment.authorityHash,
        assignmentHash: assignment.assignmentHash,
        descriptorHash: input.descriptorHash,
        providerRequestId,
        providerResponseId,
        retainedOutputRef: null,
        retainedOutputHash: null,
        reprocessEligible: false,
        retryAuthorized: false,
        costAudCents: knownCost,
        reason,
      });
      db.prepare(
        `UPDATE tasks
         SET status = 'needs_attention', outcome_status = 'known_provider_result_needs_review',
             result = ?, error = ?, completed_at = ?, updated_at = ?,
             claim_token = NULL, claimed_at = NULL WHERE id = ?`,
      ).run(result, reason, completedAt, completedAt, assignment.taskId);
      db.prepare(
        `UPDATE task_attempts
         SET status = 'needs_attention', outcome_status = 'known_provider_result_needs_review',
             provider_request_id = ?, error_kind = 'known_provider_effect_unretained',
             error = ?, metadata = ?, completed_at = ? WHERE id = ?`,
      ).run(providerRequestId, reason, metadata, completedAt, rows.ids.attemptId);
      db.prepare(
        `UPDATE agent_runs
         SET status = 'failed', output_summary = ?, estimated_cost_cents = ?,
             actual_cost_cents = 0, eval_status = 'not_evaluable', metadata = ?,
             completed_at = ? WHERE id = ?`,
      ).run(reason, knownCost ?? assignment.maxCostAudCents, metadata, completedAt, rows.ids.runId);
      const invocation = db.prepare(
        "SELECT id FROM agent_tool_invocations WHERE id = ?",
      ).get(rows.ids.toolInvocationId);
      if (invocation) {
        db.prepare(
          `UPDATE agent_tool_invocations
           SET status = 'needs_review', decision = 'provider_effect_unretained',
               output_summary = ?, resolved_at = ? WHERE id = ?`,
        ).run(reason, completedAt, rows.ids.toolInvocationId);
      }
      insertEvaluation(db, rows, "not_evaluable", 0, reason, completedAt, {
        assignmentHash: assignment.assignmentHash,
        providerOutcomeKnown: true,
        retainedOutput: false,
        retryAuthorized: false,
      });
      insertTrace(db, rows.ids.runId, "run_failed", "Known provider effect needs attention", reason, {
        providerRequestId,
        providerResponseId,
        retainedOutputHash: null,
        retryAuthorized: false,
      }, completedAt);
      const receipt = finalizeAgentExecutionReceipt(db, {
        attemptId: rows.ids.attemptId,
        runId: rows.ids.runId,
      });
      db.prepare(
        `UPDATE workflows SET status = 'needs_attention', current_step = ?, updated_at = ?
         WHERE id = ?`,
      ).run(
        "A known provider effect could not be retained. No retry is allowed; operator reconciliation is required.",
        completedAt,
        assignment.workflowId,
      );
      return Object.freeze({
        status: "known_provider_effect_needs_attention",
        receiptId: receipt.id,
        receiptStatus: receipt.status,
        reprocessEligible: false,
        retainedOutputHash: null,
        retryAuthorized: false,
      });
    });
  }

  function terminalFailure(input, mode) {
    return withImmediate(db, mode, () => {
      const assignment = store.listAssignments(authority.authorityHash).find(
        (candidate) => candidate.assignmentHash === input.assignmentHash,
      );
      if (!assignment) {
        throw bridgeError(
          "preventure_bridge_assignment_missing",
          "The failed provider attempt has no exact assignment.",
        );
      }
      const rows = exactClaimRows(db, input.claimToken, assignment, ["running"]);
      const completedAt = String(input.occurredAt || now(clock));
      const providerDispatched = mode !== "failed_before_dispatch";
      const retained = input.retainedOutput ?? null;
      const knownResultUnknownCost = mode === "known_result_unknown_cost";
      const unknownCost = mode === "unknown" || knownResultUnknownCost;
      const outcomeStatus = knownResultUnknownCost
        ? "known_provider_result_needs_review"
        : mode === "unknown" ? "unknown" : "failed_before_effect";
      const modelOutcomeStatus = knownResultUnknownCost ? "known" : outcomeStatus;
      const errorKind = knownResultUnknownCost
        ? "provider_cost_unknown"
        : mode === "unknown"
          ? "provider_outcome_unknown"
        : mode === "definite_pre_effect"
          ? String(input.errorKind || "definite_pre_effect_http_rejection")
          : "failed_before_dispatch";
      const providerRequestId = input.providerRequestId ?? null;
      const providerResponseId = input.providerResponseId ?? null;
      const durableClientRequestId = parseJson(rows.attempt.metadata).clientRequestId;
      if (retained !== null && (
        !unknownCost
        || !isObject(retained)
        || retained.retained !== true
        || retained.authorityHash !== assignment.authorityHash
        || retained.assignmentHash !== assignment.assignmentHash
        || retained.descriptorHash !== input.descriptorHash
        || retained.clientRequestId !== input.clientRequestId
        || retained.clientRequestId !== durableClientRequestId
        || retained.providerRequestId !== providerRequestId
        || retained.providerResponseId !== providerResponseId
        || retained.billing?.costStatus !== "unknown"
        || retained.billing?.costAudCents !== null
        || retained.billing?.modelCallId !== rows.ids.modelCallId
        || !HASH_PATTERN.test(String(retained.artifactHash || ""))
        || typeof (retained.artifactRef || retained.location) !== "string"
      )) {
        throw bridgeError(
          "preventure_bridge_unknown_retained_output_changed",
          "The unknown-cost provider freeze changed its exact retained artifact or execution identity.",
        );
      }
      const retainedOutputRef = retained?.artifactRef || retained?.location || null;
      const retainedOutputHash = retained?.artifactHash || null;
      const responseIssues = retained
        ? exactRetainedResponseIssues(retained, assignment)
        : [];
      const metadata = canonicalJson({
        ...parseJson(rows.modelCall.metadata),
        providerRequestId,
        providerResponseId,
        clientRequestId: input.clientRequestId || durableClientRequestId || null,
        retainedOutputRef,
        retainedOutputHash,
        rawOutputArtifactHash: retainedOutputHash,
        responseIssues,
        responseIssuesHash: sha256(responseIssues),
        tokenUsage: { status: "unknown", inputTokens: null, outputTokens: null, totalTokens: null },
        providerOutcomeKnown: retained !== null,
        exactBillingPending: unknownCost,
        errorKind,
        reason: String(input.reason || errorKind),
        noAutomaticRetry: true,
      });
      const taskResult = canonicalJson({
        schema: "pantheon.preventure-research-task-result.v1",
        authorityHash: assignment.authorityHash,
        assignmentHash: assignment.assignmentHash,
        descriptorHash: input.descriptorHash,
        clientRequestId: input.clientRequestId || durableClientRequestId || null,
        providerRequestId,
        providerResponseId,
        retainedOutputRef,
        retainedOutputHash,
        rawOutputArtifactHash: retainedOutputHash,
        responseIssues,
        responseIssuesHash: sha256(responseIssues),
        reprocessEligible: false,
        retryAuthorized: false,
        costAudCents: null,
        exposureAudCents: unknownCost ? assignment.maxCostAudCents : 0,
        exactBillingPending: unknownCost,
        reason: String(input.reason || errorKind),
      });
      db.prepare(
        `UPDATE model_calls
         SET status = 'failed', provider_request_id = ?, cost_status = ?,
             reserved_cost_cents = 0, incurred_estimate_cents = ?,
             outcome_status = ?, error_kind = ?, error = ?, metadata = ?, completed_at = ?
         WHERE id = ?`,
      ).run(
        providerRequestId,
        unknownCost ? "unknown" : "released",
        unknownCost ? assignment.maxCostAudCents : 0,
        modelOutcomeStatus,
        errorKind,
        String(input.reason || errorKind),
        metadata,
        completedAt,
        rows.ids.modelCallId,
      );
      db.prepare(
       `UPDATE tasks
         SET status = 'needs_attention', outcome_status = ?, result = ?, error = ?,
             completed_at = ?, updated_at = ?, claim_token = NULL, claimed_at = NULL
         WHERE id = ?`,
      ).run(
        outcomeStatus,
        taskResult,
        String(input.reason || errorKind),
        completedAt,
        completedAt,
        assignment.taskId,
      );
      db.prepare(
        `UPDATE task_attempts
         SET status = 'needs_attention', outcome_status = ?, provider_request_id = ?,
             error_kind = ?, error = ?, metadata = ?, completed_at = ?
         WHERE id = ?`,
      ).run(
        outcomeStatus,
        providerRequestId,
        errorKind,
        String(input.reason || errorKind),
        metadata,
        completedAt,
        rows.ids.attemptId,
      );
      db.prepare(
        `UPDATE agent_runs
         SET status = 'failed', output_summary = ?, estimated_cost_cents = ?,
             actual_cost_cents = 0, eval_status = ?, metadata = ?, completed_at = ?
         WHERE id = ?`,
      ).run(
        String(input.reason || errorKind),
        unknownCost ? assignment.maxCostAudCents : 0,
        knownResultUnknownCost ? "not_evaluable" : mode === "unknown" ? "unknown" : "not_evaluable",
        metadata,
        completedAt,
        rows.ids.runId,
      );
      const invocation = db.prepare(
        "SELECT id FROM agent_tool_invocations WHERE id = ?",
      ).get(rows.ids.toolInvocationId);
      if (invocation) {
        db.prepare(
          `UPDATE agent_tool_invocations
           SET status = 'needs_review', decision = ?, output_summary = ?, resolved_at = ?
           WHERE id = ?`,
        ).run(
          knownResultUnknownCost
            ? "provider_cost_unknown"
            : mode === "unknown" ? "provider_outcome_unknown" : "provider_rejected_before_effect",
          String(input.reason || errorKind),
          completedAt,
          rows.ids.toolInvocationId,
        );
      }
      insertEvaluation(
        db,
        rows,
        knownResultUnknownCost ? "not_evaluable" : mode === "unknown" ? "unknown" : "not_evaluable",
        0,
        String(input.reason || errorKind),
        completedAt,
        {
          assignmentHash: assignment.assignmentHash,
          providerCallOccurred: providerDispatched,
          providerOutcomeKnown: mode !== "unknown",
          errorKind,
        },
      );
      insertTrace(
        db,
        rows.ids.runId,
        "run_failed",
        knownResultUnknownCost
          ? "Known provider result frozen for billing review"
          : mode === "unknown" ? "Provider outcome frozen" : "Provider work did not proceed",
        String(input.reason || errorKind),
        { errorKind, providerRequestId, noAutomaticRetry: true },
        completedAt,
      );
      const receipt = finalizeAgentExecutionReceipt(db, {
        attemptId: rows.ids.attemptId,
        runId: rows.ids.runId,
      });
      db.prepare(
        `UPDATE workflows SET status = 'needs_attention', current_step = ?, updated_at = ?
         WHERE id = ?`,
      ).run(
        knownResultUnknownCost
          ? "Known provider result retained; exact billing is unknown and the authority is frozen."
          : mode === "unknown"
            ? "Provider outcome or cost is unknown; authority is frozen."
          : "The one exact attempt ended before a provider effect; no automatic retry is allowed.",
        completedAt,
        assignment.workflowId,
      );
      return Object.freeze({
        status: outcomeStatus,
        receiptId: receipt.id,
        receiptStatus: receipt.status,
      });
    });
  }

  function failBeforeDispatch(input = {}) {
    return terminalFailure(input, "failed_before_dispatch");
  }

  function markDefinitePreEffectFailure(input = {}) {
    return terminalFailure(input, "definite_pre_effect");
  }

  function markUnknown(input = {}) {
    return terminalFailure(input, "unknown");
  }

  function markKnownResultUnknownCost(input = {}) {
    if (!input.retainedOutput) {
      throw bridgeError(
        "preventure_bridge_known_result_artifact_missing",
        "Known-result unknown-cost freezing requires its exact immutable provider artifact.",
      );
    }
    return terminalFailure(input, "known_result_unknown_cost");
  }

  function commitTerminalProviderArtifactCustody(input = {}) {
    if (typeof store.commitTerminalRetainedRecovery !== "function") {
      throw bridgeError(
        "preventure_bridge_terminal_custody_unavailable",
        "The atomic terminal provider-artifact custody store is unavailable.",
        500,
      );
    }
    const inspection = inspectProviderArtifactCustody(input);
    if (inspection.custodyRequired !== true) {
      throw bridgeError(
        "preventure_bridge_terminal_custody_not_terminal",
        "The exact provider artifact remains eligible only for active local reprocessing, not terminal custody.",
      );
    }
    const assignment = exactAssignment(
      store,
      authority,
      inspection.authorityHash,
      inspection.assignmentHash,
    );
    const committed = store.commitTerminalRetainedRecovery(
      assignment.assignmentHash,
      {
        authorityHash: inspection.authorityHash,
        taskId: inspection.taskId,
        taskAttemptId: inspection.taskAttemptId,
        modelCallId: inspection.modelCallId,
        claimToken: inspection.claimToken,
        descriptorHash: inspection.descriptorHash,
        requestBodyHash: inspection.requestBodyHash,
        clientRequestId: inspection.clientRequestId,
        providerRequestId: inspection.providerRequestId,
        providerResponseId: inspection.providerResponseId,
        retainedOutputRef: inspection.retainedOutputRef,
        recordedAt: input.recordedAt,
      },
    );
    const recovery = committed?.recovery;
    if (
      typeof committed?.created !== "boolean"
      || !isObject(recovery)
      || !["revoked", "expired", "emergency_stopped"].includes(committed.terminalState)
      || recovery.authorityHash !== assignment.authorityHash
      || recovery.assignmentHash !== assignment.assignmentHash
      || recovery.taskId !== assignment.taskId
      || recovery.originalDispatch?.taskAttemptId !== inspection.taskAttemptId
      || recovery.originalDispatch?.modelCallId !== inspection.modelCallId
      || recovery.originalDispatch?.descriptorHash !== inspection.descriptorHash
      || recovery.originalDispatch?.requestBodyHash !== inspection.requestBodyHash
      || recovery.originalDispatch?.clientRequestId !== inspection.clientRequestId
      || recovery.originalDispatch?.providerRequestId !== inspection.providerRequestId
      || recovery.originalDispatch?.providerResponseId !== inspection.providerResponseId
      || recovery.retainedArtifact?.artifactHash !== inspection.retainedOutputHash
      || recovery.retainedArtifact?.artifactRef !== inspection.retainedOutputRef
      || recovery.costSnapshot?.costTruth !== "unknown"
      || recovery.costSnapshot?.exposureAudCents !== assignment.maxCostAudCents
      || recovery.costSnapshot?.exactBillingPending !== true
      || recovery.controls?.commercialInference !== "none"
      || recovery.controls?.evidenceEligible !== false
      || recovery.controls?.decisionEligible !== false
      || recovery.controls?.completionEligible !== false
      || recovery.controls?.retryAuthorized !== false
      || recovery.controls?.additionalNetworkCalls !== 0
      || recovery.controls?.additionalAiCostAudCents !== 0
    ) {
      throw bridgeError(
        "preventure_bridge_terminal_custody_incomplete",
        "The atomic terminal provider-artifact custody record is incomplete or contradictory.",
        500,
      );
    }
    return Object.freeze({
      status: "terminal_provider_artifact_retained_pending_reconciliation",
      created: committed.created,
      custodyRecord: recovery,
      authorityHash: assignment.authorityHash,
      assignmentHash: assignment.assignmentHash,
      descriptorHash: inspection.descriptorHash,
      retainedOutputHash: inspection.retainedOutputHash,
      retainedOutputRef: inspection.retainedOutputRef,
      terminalState: committed.terminalState,
      emergencyStopped: committed.terminalState === "emergency_stopped",
      accountingState: "pending_reconciliation",
      additionalAiCostAudCents: 0,
      retryAuthorized: false,
    });
  }

  return Object.freeze({
    kind: EXACT_CLAIM_KIND,
    assertProviderRetentionBinding,
    assertProviderResultClaim,
    claim,
    commitKnownEvidence,
    commitReprocessedEvidence,
    commitTerminalProviderArtifactCustody,
    commitValidatedEarlyStop,
    failBeforeDispatch,
    markDefinitePreEffectFailure,
    markKnownNeedsAttention,
    markKnownNeedsReprocess,
    markKnownResultUnknownCost,
    markProviderDispatched,
    markUnknown,
    inspectProviderArtifactCustody,
    clientRequestIdForClaim(claimToken) {
      const attempt = db.prepare(
        "SELECT metadata FROM task_attempts WHERE claim_token = ?",
      ).get(claimToken);
      const value = parseJson(attempt?.metadata).clientRequestId;
      if (!/^pantheon-preventure-[a-f0-9]{32}$/.test(String(value || ""))) {
        throw bridgeError(
          "preventure_bridge_client_request_id_missing",
          "The durable client request identity is unavailable.",
        );
      }
      return value;
    },
  });
}

function retainedOutputReference(hashValue) {
  const value = exactHash(hashValue, "Retained output hash");
  return `preventure-output:${value.slice("sha256:".length)}`;
}

function createPreventureResearchBridgeOutputStore(options = {}) {
  const authority = options.authority;
  const store = options.store;
  if (
    !authority
    || !HASH_PATTERN.test(String(authority.authorityHash || ""))
    || !store
    || typeof store.getAssignment !== "function"
  ) {
    throw bridgeError(
      "preventure_bridge_output_store_scope_invalid",
      "The immutable output store requires one exact authority-scoped assignment store.",
      500,
    );
  }
  const artifactRoot = path.resolve(
    options.outputArtifactRoot
      || path.join(
        options.artifactRoot || path.join(process.cwd(), "data", "artifacts"),
        "preventure-research",
      ),
  );
  return createPreventureResearchOutputStore({
    artifactRoot,
    assignmentMaxCostAudCentsForHash(assignmentHash) {
      const assignment = store.getAssignment(assignmentHash);
      if (
        !assignment
        || assignment.assignmentHash !== assignmentHash
        || assignment.authorityHash !== authority.authorityHash
        || !Number.isSafeInteger(assignment.maxCostAudCents)
        || assignment.maxCostAudCents < 0
      ) {
        throw bridgeError(
          "preventure_bridge_assignment_cost_cap_missing",
          "The immutable output cannot resolve its exact registered assignment cost cap.",
          500,
        );
      }
      return assignment.maxCostAudCents;
    },
  });
}

function createPreventureResearchExecutionBridge(options = {}) {
  const db = options.db;
  if (options.clock !== undefined && typeof options.clock !== "function") {
    throw bridgeError(
      "preventure_bridge_clock_invalid",
      "The exact bounded-research clock must be callable.",
      500,
    );
  }
  const clock = options.clock || (() => new Date());
  if (!db || typeof db.prepare !== "function" || typeof db.exec !== "function") {
    throw bridgeError(
      "preventure_bridge_database_invalid",
      "The durable Pantheon database is required for bounded research.",
      500,
    );
  }
  const resolvedAuthority = resolveRegisteredAuthority(options);
  const { authority, authorityRegistry, dispatchCandidate } = resolvedAuthority;
  const assignmentStore = options.store || createPreventureResearchStore(db, {
    clock,
    authorityRegistry,
  });
  const outputStore = options.outputStore || createPreventureResearchBridgeOutputStore({
    store: assignmentStore,
    authority,
    artifactRoot: options.artifactRoot,
    outputArtifactRoot: options.outputArtifactRoot,
  });
  if (
    outputStore?.kind !== EXACT_OUTPUT_STORE_KIND
    || typeof outputStore.load !== "function"
    || typeof outputStore.loadByStableBinding !== "function"
    || typeof outputStore.retain !== "function"
    || typeof outputStore.status !== "function"
  ) {
    throw bridgeError(
      "preventure_bridge_output_store_invalid",
      "The exact immutable provider-output store is unavailable.",
      500,
    );
  }
  const baseStore = createPreventureResearchStore(db, {
    clock,
    authorityRegistry,
    retainedOutputStore: outputStore,
  });
  const store = createLedgerBoundStore(db, baseStore, clock, authority);
  const finalizeDecision = options.finalizeDecision;
  if (
    typeof finalizeDecision !== "function"
    || typeof finalizeDecision.preview !== "function"
  ) {
    throw bridgeError(
      "preventure_bridge_finalizer_invalid",
      "The deterministic atomic pre-venture finalizer is unavailable.",
      500,
    );
  }
  const claims = createPreventureClaimsBridge(
    db,
    store,
    clock,
    finalizeDecision,
    authority,
    dispatchCandidate,
    outputStore,
  );
  const transport = createPreventureResearchOpenAiTransport({
    authority,
    outputStore,
    clock,
    allowTestOverrides: options.allowTestOverrides === true,
    fetchImpl: options.fetchImpl,
    apiKey: options.apiKey,
    liveResearchEnabled: options.liveResearchEnabled,
    clientRequestIdForClaim: claims.clientRequestIdForClaim,
    assertProviderRetentionBinding(input) {
      return claims.assertProviderRetentionBinding(input);
    },
    assertProviderResultClaim(input) {
      return claims.assertProviderResultClaim(input);
    },
    modelCallIdForAssignment(assignmentHash) {
      return stableIds(assignmentHash).modelCallId;
    },
  });
  const parser = createDeterministicPreventureResearchParser();

  function discoverTerminalCustodyManifest(assignment, authorityState, task) {
    const ids = stableIds(assignment.assignmentHash);
    const attempt = db.prepare("SELECT * FROM task_attempts WHERE id = ?").get(ids.attemptId);
    const modelCall = db.prepare("SELECT * FROM model_calls WHERE id = ?").get(ids.modelCallId);
    const agentRun = db.prepare("SELECT * FROM agent_runs WHERE id = ?").get(ids.runId);
    const attemptMetadata = parseJson(attempt?.metadata);
    const modelMetadata = parseJson(modelCall?.metadata);
    const descriptorHash = String(attemptMetadata.descriptorHash || "");
    const requestBodyHash = String(attemptMetadata.requestBodyHash || "");
    const clientRequestId = String(attemptMetadata.clientRequestId || "");
    const terminalOrEmergency = authorityState.terminal === true
      || authorityState.expired === true
      || ["revoked", "expired"].includes(authorityState.state)
      || [task?.error_kind, attempt?.error_kind, modelCall?.error_kind]
        .includes("operator_emergency_stop");
    if (!terminalOrEmergency || !["running", "needs_attention"].includes(task?.status)) {
      return null;
    }
    const activeOriginalDispatch = task.status === "running"
      && attempt?.status === "running"
      && attempt?.outcome_status === "provider_dispatched"
      && modelCall?.status === "dispatching"
      && modelCall?.outcome_status === "provider_dispatched"
      && agentRun?.status === "running"
      && typeof task.claim_token === "string"
      && task.claim_token.length > 0
      && task.claim_token === attempt?.claim_token;
    const alreadyStoppedExecution = task.status === "needs_attention"
      && attempt?.status === "needs_attention"
      && !["dispatching", "running", "prepared"].includes(modelCall?.status)
      && agentRun?.status !== "running";
    if (
      !attempt
      || !modelCall
      || !agentRun
      || (!activeOriginalDispatch && !alreadyStoppedExecution)
      || attempt.task_id !== assignment.taskId
      || attempt.workflow_id !== assignment.workflowId
      || attempt.provider_dispatch_model_call_id !== ids.modelCallId
      || modelCall.task_id !== assignment.taskId
      || modelCall.workflow_id !== assignment.workflowId
      || modelCall.attempt_id !== ids.attemptId
      || agentRun.task_id !== assignment.taskId
      || agentRun.workflow_id !== assignment.workflowId
      || attemptMetadata.descriptorHash !== modelMetadata.descriptorHash
      || attemptMetadata.requestBodyHash !== modelMetadata.requestBodyHash
      || attemptMetadata.clientRequestId !== modelMetadata.clientRequestId
      || !HASH_PATTERN.test(descriptorHash)
      || !HASH_PATTERN.test(requestBodyHash)
      || !/^pantheon-preventure-[a-f0-9]{32}$/.test(clientRequestId)
    ) {
      throw bridgeError(
        "preventure_bridge_terminal_custody_execution_changed",
        "The stopped provider execution is not sealed to one exact non-running task, attempt, model call, and agent run.",
      );
    }
    const manifest = outputStore.loadByStableBinding({
      authorityHash: assignment.authorityHash,
      assignmentHash: assignment.assignmentHash,
      descriptorHash,
      requestBodyHash,
    });
    if (manifest === null) return null;
    const dispatchedAt = String(attempt.provider_dispatched_at || "");
    if (
      manifest.authorityHash !== assignment.authorityHash
      || manifest.assignmentHash !== assignment.assignmentHash
      || manifest.assignmentMaxCostAudCents !== assignment.maxCostAudCents
      || manifest.descriptorHash !== descriptorHash
      || manifest.requestBodyHash !== requestBodyHash
      || manifest.clientRequestId !== clientRequestId
      || (
        manifest.artifactKind !== "known_pre_effect_rejection"
        && manifest.billing?.modelCallId !== ids.modelCallId
      )
      || !Number.isFinite(Date.parse(dispatchedAt))
      || Date.parse(dispatchedAt) >= Date.parse(authority.expiresAt)
      || Date.parse(dispatchedAt) >= Date.parse(manifest.retainedAt)
    ) {
      throw bridgeError(
        "preventure_bridge_terminal_custody_artifact_changed",
        "The crash-retained provider artifact does not match its exact pre-expiry dispatch and immutable execution identity.",
      );
    }
    return Object.freeze({
      ids,
      manifest,
      descriptorHash,
      requestBodyHash,
      clientRequestId,
      providerDispatchedAt: dispatchedAt,
    });
  }

  function discoverActiveCrashManifest(assignment, authorityState, task) {
    if (
      !dispatchCandidate
      || authorityState.state !== "activated"
      || authorityState.terminal === true
      || authorityState.expired === true
      || task?.status !== "running"
    ) return null;
    const ids = stableIds(assignment.assignmentHash);
    const attempt = db.prepare("SELECT * FROM task_attempts WHERE id = ?").get(ids.attemptId);
    const modelCall = db.prepare("SELECT * FROM model_calls WHERE id = ?").get(ids.modelCallId);
    const agentRun = db.prepare("SELECT * FROM agent_runs WHERE id = ?").get(ids.runId);
    const attemptMetadata = parseJson(attempt?.metadata);
    const modelMetadata = parseJson(modelCall?.metadata);
    const descriptorHash = String(attemptMetadata.descriptorHash || "");
    const requestBodyHash = String(attemptMetadata.requestBodyHash || "");
    const clientRequestId = String(attemptMetadata.clientRequestId || "");
    if (
      !attempt
      || !modelCall
      || !agentRun
      || attempt.status !== "running"
      || attempt.outcome_status !== "provider_dispatched"
      || modelCall.status !== "dispatching"
      || modelCall.outcome_status !== "provider_dispatched"
      || agentRun.status !== "running"
      || task.claim_token !== attempt.claim_token
      || !task.claim_token
      || attempt.task_id !== assignment.taskId
      || attempt.workflow_id !== assignment.workflowId
      || attempt.provider_dispatch_model_call_id !== ids.modelCallId
      || modelCall.task_id !== assignment.taskId
      || modelCall.workflow_id !== assignment.workflowId
      || modelCall.attempt_id !== ids.attemptId
      || agentRun.task_id !== assignment.taskId
      || agentRun.workflow_id !== assignment.workflowId
      || attemptMetadata.descriptorHash !== modelMetadata.descriptorHash
      || attemptMetadata.requestBodyHash !== modelMetadata.requestBodyHash
      || attemptMetadata.clientRequestId !== modelMetadata.clientRequestId
      || !HASH_PATTERN.test(descriptorHash)
      || !HASH_PATTERN.test(requestBodyHash)
      || !/^pantheon-preventure-[a-f0-9]{32}$/.test(clientRequestId)
    ) {
      throw bridgeError(
        "preventure_bridge_active_crash_execution_changed",
        "The active crash-recovery candidate is not one exact durable provider dispatch.",
      );
    }
    const manifest = outputStore.loadByStableBinding({
      authorityHash: assignment.authorityHash,
      assignmentHash: assignment.assignmentHash,
      descriptorHash,
      requestBodyHash,
    });
    if (manifest === null) return null;
    const dispatchedAt = String(attempt.provider_dispatched_at || "");
    if (
      manifest.authorityHash !== assignment.authorityHash
      || manifest.assignmentHash !== assignment.assignmentHash
      || manifest.assignmentMaxCostAudCents !== assignment.maxCostAudCents
      || manifest.descriptorHash !== descriptorHash
      || manifest.requestBodyHash !== requestBodyHash
      || manifest.clientRequestId !== clientRequestId
      || (
        manifest.artifactKind !== "known_pre_effect_rejection"
        && manifest.billing?.modelCallId !== ids.modelCallId
      )
      || !Number.isFinite(Date.parse(dispatchedAt))
      || Date.parse(dispatchedAt) >= Date.parse(authority.expiresAt)
      || Date.parse(dispatchedAt) >= Date.parse(manifest.retainedAt)
    ) {
      throw bridgeError(
        "preventure_bridge_active_crash_artifact_changed",
        "The active crash-retained artifact does not match its exact pre-expiry provider dispatch.",
      );
    }
    return Object.freeze({
      ids,
      claimToken: attempt.claim_token,
      manifest,
      descriptorHash,
      requestBodyHash,
      clientRequestId,
      providerDispatchedAt: dispatchedAt,
    });
  }

  function blockedReadiness(blockers, projection = {}) {
    const transportStatus = transport.status();
    const outputStatus = outputStore.status();
    return Object.freeze({
      schema: BRIDGE_SCHEMA,
      ready: false,
      canPrepare: false,
      canReprocess: false,
      canRecoverCustody: projection.canRecoverCustody === true,
      retainedOutputHash: HASH_PATTERN.test(String(projection.retainedOutputHash || ""))
        ? projection.retainedOutputHash
        : null,
      descriptorHash: projection.descriptorHash || null,
      requestBodyHash: projection.requestBodyHash || null,
      credentialConfigured: transportStatus.credentialConfigured === true,
      liveResearchEnabled: transportStatus.liveResearchEnabled === true,
      egressReady: transportStatus.egressReady === true,
      artifactStoreReady: outputStatus.ready === true,
      requestExact: projection.requestExact === true,
      status: projection.status || "blocked",
      blockers: Array.isArray(blockers) ? blockers : [],
    });
  }

  function readiness(input = {}) {
    const transportStatus = transport.status();
    const outputStatus = outputStore.status();
    if (!input.assignmentId || !input.assignmentHash || !input.authorityHash) {
      return blockedReadiness([
        ...transportStatus.blockers,
        {
          code: "preventure_assignment_required",
          message: "Choose one exact bounded-research assignment before checking provider readiness.",
        },
      ]);
    }
    try {
      store.verifyLedger();
      const assignment = exactAssignment(
        store,
        authority,
        input.authorityHash,
        input.assignmentHash,
      );
      const authorityState = store.readState(assignment.authorityHash);
      if (assignment.id !== input.assignmentId) {
        throw bridgeError(
          "preventure_bridge_assignment_changed",
          "The requested assignment no longer matches its immutable binding.",
        );
      }
      const task = db.prepare("SELECT * FROM tasks WHERE id = ?").get(assignment.taskId);
      if (!task) {
        throw bridgeError(
          "preventure_bridge_task_missing",
          "The exact assignment has no durable work record.",
        );
      }
      if (["skipped", "cancelled"].includes(task.status)) {
        return blockedReadiness([{
          code: task.status === "skipped"
            ? "preventure_assignment_skipped"
            : "preventure_assignment_cancelled",
          message: task.status === "skipped"
            ? "This later assignment was immutably skipped when the bounded round closed early."
            : "This bounded assignment is cancelled and cannot be dispatched.",
        }], { status: task.status });
      }
      if (task.status === "needs_attention") {
        const existingCustody = db.prepare(
          `SELECT artifact_hash, descriptor_hash
           FROM preventure_research_terminal_recoveries
           WHERE assignment_hash = ?`,
        ).get(assignment.assignmentHash);
        if (existingCustody) {
          return blockedReadiness([], {
            retainedOutputHash: existingCustody.artifact_hash,
            descriptorHash: existingCustody.descriptor_hash,
            status: "terminal_retained_output_custody_recorded",
          });
        }
        const result = parseJson(task.result);
        const retainedHash = HASH_PATTERN.test(String(result.retainedOutputHash || ""))
          ? result.retainedOutputHash
          : null;
        const descriptorHash = HASH_PATTERN.test(String(result.descriptorHash || ""))
          ? result.descriptorHash
          : null;
        const normalReprocessAllowed = dispatchCandidate
          && authorityState.state === "activated"
          && authorityState.terminal !== true
          && authorityState.expired !== true
          && result.emergencyStop !== true
          && result.claimInvalidated !== true;
        if (
          normalReprocessAllowed
          && result.reprocessEligible === true
          && retainedHash
          && descriptorHash
        ) {
          const retained = outputStore.load({
            retainedOutputHash: retainedOutputReference(retainedHash),
            authorityHash: assignment.authorityHash,
            assignmentHash: assignment.assignmentHash,
            descriptorHash,
          });
          if (
            retained.artifactHash === retainedHash
            && retained.requestBodyHash
            && HASH_PATTERN.test(retained.requestBodyHash)
          ) {
            return Object.freeze({
              schema: BRIDGE_SCHEMA,
              ready: false,
              canPrepare: false,
              canReprocess: true,
              canRecoverCustody: false,
              retainedOutputHash: retainedHash,
              descriptorHash,
              requestBodyHash: retained.requestBodyHash,
              credentialConfigured: transportStatus.credentialConfigured === true,
              liveResearchEnabled: transportStatus.liveResearchEnabled === true,
              egressReady: transportStatus.egressReady === true,
              artifactStoreReady: outputStatus.ready === true,
              requestExact: true,
              status: "known_provider_result_needs_reprocess",
              blockers: [],
            });
          }
        }
        if (result.reprocessEligible === true && retainedHash && descriptorHash) {
          const retained = outputStore.load({
            retainedOutputHash: retainedOutputReference(retainedHash),
            authorityHash: assignment.authorityHash,
            assignmentHash: assignment.assignmentHash,
            descriptorHash,
          });
          const custody = claims.inspectProviderArtifactCustody({
            reprocessing: true,
            claimToken: null,
            authorityHash: assignment.authorityHash,
            assignmentHash: assignment.assignmentHash,
            descriptorHash,
            requestBodyHash: retained.requestBodyHash,
            taskId: assignment.taskId,
            taskAttemptId: null,
            modelCallId: retained.billing?.modelCallId || null,
            clientRequestId: retained.clientRequestId,
            providerRequestId: retained.providerRequestId,
            providerResponseId: retained.providerResponseId,
            retainedOutput: retained,
          });
          if (custody.custodyRequired === true) {
            return blockedReadiness([], {
              canRecoverCustody: true,
              retainedOutputHash: retainedHash,
              descriptorHash,
              requestBodyHash: retained.requestBodyHash,
              requestExact: true,
              status: "terminal_retained_output_pending_accounting",
            });
          }
          return blockedReadiness([{
            code: "preventure_terminal_custody_control_required",
            message: "The exact retained response belongs to terminal or historical work and may use only custody/accounting recovery, never normal evidence or decision reprocessing.",
          }], { status: "terminal_retained_output_pending_accounting" });
        }
        const discovered = discoverTerminalCustodyManifest(
          assignment,
          authorityState,
          task,
        );
        if (discovered) {
          return blockedReadiness([], {
            canRecoverCustody: true,
            retainedOutputHash: discovered.manifest.artifactHash,
            descriptorHash: discovered.descriptorHash,
            requestBodyHash: discovered.requestBodyHash,
            requestExact: true,
            status: "terminal_retained_output_crash_recovery_ready",
          });
        }
        return blockedReadiness([{
          code: "preventure_assignment_needs_attention",
          message: "This assignment has a retained outcome that is not safe for automatic dispatch or recovery.",
        }], { status: "needs_attention" });
      }
      if (task.status === "completed") {
        return blockedReadiness([], { status: "completed" });
      }
      if (!dispatchCandidate) {
        return blockedReadiness([{
          code: "preventure_research_authority_not_candidate",
          message: "This registered authority is historical and cannot start or continue fresh provider work.",
        }], { status: "historical_authority" });
      }
      const descriptor = resolvePreventureResearchExecutionDescriptor({
        store,
        authorityHash: assignment.authorityHash,
        assignmentId: assignment.id,
        expectedAssignmentHash: assignment.assignmentHash,
        clock,
      });
      const inspected = transport.inspect(descriptor);
      const exact = inspected.requestExact === true
        && inspected.requestBodyHash === descriptor.request.requestBodyHash;
      const locallyReady = inspected.ready === true
        && outputStatus.ready === true
        && exact;
      const canPrepare = task.status === "blocked" && locallyReady;
      const ready = task.status === "queued" && locallyReady;
      const taskBlockers = ["blocked", "queued"].includes(task.status) ? [] : [{
        code: "preventure_assignment_task_state_invalid",
        message: `The exact assignment is ${task.status}, not locally blocked or queued for dispatch.`,
      }];
      return Object.freeze({
        schema: BRIDGE_SCHEMA,
        ready,
        canPrepare,
        canReprocess: false,
        canRecoverCustody: false,
        retainedOutputHash: null,
        descriptorHash: descriptor.descriptorHash,
        requestBodyHash: descriptor.request.requestBodyHash,
        credentialConfigured: inspected.credentialConfigured === true,
        liveResearchEnabled: inspected.liveResearchEnabled === true,
        egressReady: inspected.egressReady === true,
        artifactStoreReady: outputStatus.ready === true,
        requestExact: exact,
        status: ready
          ? "provider_call_ready"
          : canPrepare ? "local_preparation_ready" : "blocked",
        blockers: [...inspected.blockers, ...taskBlockers],
      });
    } catch (error) {
      return blockedReadiness([{
        code: error.code || "preventure_bridge_readiness_failed",
        message: String(error.message || "The bounded-research readiness check failed closed."),
      }], { status: "integrity_blocked" });
    }
  }

  function prepareAssignment(input = {}) {
    const current = readiness({
      authorityHash: input.authorityHash,
      assignmentId: input.assignmentId,
      assignmentHash: input.expectedAssignmentHash,
    });
    if (
      current.canPrepare !== true
      || current.descriptorHash !== input.expectedDescriptorHash
      || current.requestBodyHash !== input.expectedRequestBodyHash
    ) {
      throw bridgeError(
        "preventure_bridge_preparation_stale",
        "The exact assignment is not locally ready for preparation. No provider call was made.",
      );
    }
    const assignment = exactAssignment(
      store,
      authority,
      input.authorityHash,
      input.expectedAssignmentHash,
    );
    return withImmediate(db, "prepare", () => {
      const changed = db.prepare(
        `UPDATE tasks SET status = 'queued', error = NULL, updated_at = ?
         WHERE id = ? AND status = 'blocked' AND attempt_count = 0
           AND claim_token IS NULL`,
      ).run(now(clock), assignment.taskId);
      if (Number(changed.changes) !== 1) {
        throw bridgeError(
          "preventure_bridge_preparation_raced",
          "The exact assignment changed before local preparation completed.",
        );
      }
      db.prepare(
        `UPDATE workflows SET status = 'queued', current_step = ?, updated_at = ?
         WHERE id = ? AND type = 'preventure_research'`,
      ).run(`Exact bounded assignment queued: ${assignment.id}`, now(clock), assignment.workflowId);
      return Object.freeze({
        status: "prepared",
        authorityHash: assignment.authorityHash,
        assignmentId: assignment.id,
        assignmentHash: assignment.assignmentHash,
        descriptorHash: current.descriptorHash,
        requestBodyHash: current.requestBodyHash,
      });
    });
  }

  async function runAssignment(input = {}) {
    const current = readiness({
      authorityHash: input.authorityHash,
      assignmentId: input.assignmentId,
      assignmentHash: input.expectedAssignmentHash,
    });
    if (
      current.ready !== true
      || current.descriptorHash !== input.expectedDescriptorHash
      || current.requestBodyHash !== input.expectedRequestBodyHash
    ) {
      throw bridgeError(
        "preventure_bridge_dispatch_stale",
        "The exact queued assignment is not provider-ready. No provider call was made.",
      );
    }
    return runPreventureResearchAssignment({
      store,
      authorityHash: input.authorityHash,
      assignmentId: input.assignmentId,
      expectedAssignmentHash: input.expectedAssignmentHash,
      expectedDescriptorHash: input.expectedDescriptorHash,
      clock,
      transport,
      claims,
      outputStore,
      parser,
    });
  }

  function recoverCrashRetainedOutput() {
    store.verifyLedger();
    if (!store.getAuthority(authority.authorityHash)) return null;
    const assignments = store.listAssignments(authority.authorityHash);
    for (const assignment of assignments) {
      const task = db.prepare("SELECT * FROM tasks WHERE id = ?").get(assignment.taskId);
      if (!task || !["running", "needs_attention"].includes(task.status)) continue;
      const authorityState = store.readState(assignment.authorityHash);
      const active = discoverActiveCrashManifest(assignment, authorityState, task);
      if (active) {
        const recovered = withImmediate(db, "active_crash_recovery", () => {
          claims.assertProviderRetentionBinding({
            claimToken: active.claimToken,
            authorityHash: assignment.authorityHash,
            assignmentHash: assignment.assignmentHash,
            descriptorHash: active.descriptorHash,
            taskId: assignment.taskId,
            taskAttemptId: active.ids.attemptId,
            clientRequestId: active.clientRequestId,
          });
          const billingStatus = String(active.manifest.billing?.costStatus || "");
          const amountAudCents = active.manifest.billing?.costAudCents;
          const preEffectArtifact = active.manifest.artifactKind
            === "known_pre_effect_rejection";
          const exposureAudCents = preEffectArtifact
            ? active.manifest.billing?.exposureAudCents
            : Number.isSafeInteger(amountAudCents)
              ? amountAudCents
              : assignment.maxCostAudCents;
          const exactBillingPending = preEffectArtifact
            ? active.manifest.billing?.exactBillingPending
            : ["estimated", "incurred", "unknown"].includes(billingStatus);
          const costKnown = Number.isSafeInteger(amountAudCents)
            && amountAudCents >= 0
            && amountAudCents <= assignment.maxCostAudCents
            && ["estimated", "incurred", "reconciled"].includes(billingStatus);
          if (
            (!costKnown && billingStatus !== "unknown")
            || !Number.isSafeInteger(exposureAudCents)
            || exposureAudCents < (costKnown ? amountAudCents : 0)
            || exposureAudCents > assignment.maxCostAudCents
            || typeof exactBillingPending !== "boolean"
            || (["estimated", "incurred", "unknown"].includes(billingStatus)
              && exactBillingPending !== true)
            || (billingStatus === "unknown"
              && exposureAudCents !== assignment.maxCostAudCents)
          ) {
            throw bridgeError(
              "preventure_bridge_active_crash_cost_changed",
              "The crash-retained provider artifact has no exact in-cap cost or conservative unknown exposure.",
            );
          }
          if (preEffectArtifact) {
            const completedAt = now(clock);
            const responseIssues = ["definite_pre_effect_http_rejection"];
            const costTruth = {
              costStatus: "estimated",
              costAudCents: 0,
              exposureAudCents,
              exactBillingPending: true,
              providerZeroBillingGuarantee: false,
            };
            const resultHash = sha256({
              triggerOutcomeClass: "known_failed_before_effect",
              authorityHash: assignment.authorityHash,
              assignmentHash: assignment.assignmentHash,
              descriptorHash: active.descriptorHash,
              requestBodyHash: active.requestBodyHash,
              taskAttemptId: active.ids.attemptId,
              modelCallId: active.ids.modelCallId,
              clientRequestId: active.clientRequestId,
              providerRequestId: active.manifest.providerRequestId ?? null,
              providerResponseId: null,
              officialEndpointHash: PREVENTURE_OFFICIAL_RESPONSES_ENDPOINT_HASH,
              httpStatus: Number(active.manifest.responseMetadata?.httpStatus),
              providerErrorType: active.manifest.responseMetadata?.providerErrorType,
              providerErrorCode: active.manifest.responseMetadata?.providerErrorCode,
              rawOutputArtifactHash: active.manifest.artifactHash,
              rawProviderBodyHash: active.manifest.rawProviderBodyHash,
              responseIssues,
              costTruth,
            });
            return Object.freeze({
              recoveryClass: "known_pre_effect_rejection",
              marked: claims.commitValidatedEarlyStop({
              mode: "definite_pre_effect",
              stopReason: "known_failed_before_effect",
              triggerOutcomeClass: "known_failed_before_effect",
              claimToken: active.claimToken,
              authorityHash: assignment.authorityHash,
              assignmentHash: assignment.assignmentHash,
              descriptorHash: active.descriptorHash,
              requestBodyHash: active.requestBodyHash,
              taskId: assignment.taskId,
              taskAttemptId: active.ids.attemptId,
              modelCallId: active.ids.modelCallId,
              clientRequestId: active.clientRequestId,
              providerRequestId: active.manifest.providerRequestId ?? null,
              providerResponseId: null,
              officialEndpointHash: PREVENTURE_OFFICIAL_RESPONSES_ENDPOINT_HASH,
              httpStatus: Number(active.manifest.responseMetadata?.httpStatus),
              providerErrorType: active.manifest.responseMetadata?.providerErrorType,
              providerErrorCode: active.manifest.responseMetadata?.providerErrorCode,
              providerErrorBodyArtifactHash: active.manifest.artifactHash,
              rawOutputArtifactHash: active.manifest.artifactHash,
              rawProviderBodyHash: active.manifest.rawProviderBodyHash,
              retainedOutput: active.manifest,
              responseIssues,
              responseIssuesHash: sha256(responseIssues),
              costKey: `preventure_cost_${digest(assignment.assignmentHash)}`,
              ...costTruth,
              resultHash,
              validatedCoverage: null,
              preparedEvidenceBatchHash: null,
              preparedEvidenceBatch: null,
              completedAt,
              }),
            });
          }
          const responseIssues = exactRetainedResponseIssues(active.manifest, assignment);
          const knownUnusable = active.manifest.artifactKind === "known_effect_invalid"
            || (
              active.manifest.artifactKind === "canonical_known_response"
              && responseIssues.length > 0
            );
          const httpStatus = Number(active.manifest.responseMetadata?.httpStatus);
          if (!costKnown) {
            store.appendCostEvent(assignment.assignmentHash, {
              costKey: `preventure_cost_${digest(assignment.assignmentHash)}`,
              eventType: "unknown",
              amountAudCents: null,
              exposureAudCents: assignment.maxCostAudCents,
              exactBillingPending: true,
              providerZeroBillingGuarantee: false,
              taskAttemptId: active.ids.attemptId,
              modelCallId: active.ids.modelCallId,
              occurredAt: now(clock),
            });
            return Object.freeze({
              recoveryClass: active.manifest.artifactKind === "known_effect_invalid"
                ? "known_effect_invalid_unknown_cost"
                : "canonical_known_response_unknown_cost",
              marked: claims.markKnownResultUnknownCost({
                claimToken: active.claimToken,
                assignmentHash: assignment.assignmentHash,
                descriptorHash: active.descriptorHash,
                clientRequestId: active.clientRequestId,
                providerRequestId: active.manifest.providerRequestId ?? null,
                providerResponseId: active.manifest.providerResponseId ?? null,
                retainedOutput: active.manifest,
                reason: "The exact retained provider response has unknown billing. The authority remains frozen for reconciliation and the artifact cannot be reprocessed or retried.",
                occurredAt: now(clock),
              }),
            });
          }
          if (
            knownUnusable
            && (!Number.isSafeInteger(httpStatus) || httpStatus < 200 || httpStatus > 299)
          ) {
            store.appendCostEvent(assignment.assignmentHash, {
              costKey: `preventure_cost_${digest(assignment.assignmentHash)}`,
              eventType: billingStatus,
              amountAudCents,
              exposureAudCents,
              exactBillingPending,
              providerZeroBillingGuarantee:
                active.manifest.billing?.providerZeroBillingGuarantee ?? null,
              taskAttemptId: active.ids.attemptId,
              modelCallId: active.ids.modelCallId,
              occurredAt: now(clock),
            });
            return Object.freeze({
              recoveryClass: "known_effect_unusable_non_success_attention",
              marked: claims.markKnownNeedsReprocess({
                claimToken: active.claimToken,
                authorityHash: assignment.authorityHash,
                assignmentHash: assignment.assignmentHash,
                descriptorHash: active.descriptorHash,
                retainedOutput: active.manifest,
                reason: "Pantheon retained one non-success provider effect with exact cost, but it is not a valid no-evidence completion trigger. No provider retry or evidence use is allowed.",
              }),
            });
          }
          if (knownUnusable) {
            const costKey = `preventure_cost_${digest(assignment.assignmentHash)}`;
            const completedAt = now(clock);
            const resultHash = sha256({
              triggerOutcomeClass: "known_retained_unusable_provider_response",
              authorityHash: assignment.authorityHash,
              assignmentHash: assignment.assignmentHash,
              descriptorHash: active.descriptorHash,
              rawOutputArtifactHash: active.manifest.artifactHash,
              responseIssues,
            });
            return Object.freeze({
              recoveryClass: "known_effect_unusable",
              marked: claims.commitValidatedEarlyStop({
                mode: "known_effect_unusable",
                stopReason: "known_effect_unusable",
                triggerOutcomeClass: "known_retained_unusable_provider_response",
                claimToken: active.claimToken,
                authorityHash: assignment.authorityHash,
                assignmentHash: assignment.assignmentHash,
                descriptorHash: active.descriptorHash,
                taskId: assignment.taskId,
                taskAttemptId: active.ids.attemptId,
                modelCallId: active.ids.modelCallId,
                clientRequestId: active.clientRequestId,
                providerRequestId: active.manifest.providerRequestId ?? null,
                providerResponseId: active.manifest.providerResponseId ?? null,
                retainedOutput: active.manifest,
                rawOutputArtifactHash: active.manifest.artifactHash,
                responseIssues,
                responseIssuesHash: sha256(responseIssues),
                costKey,
                costAudCents: amountAudCents,
                costStatus: billingStatus,
                exposureAudCents,
                resultHash,
                validatedCoverage: null,
                preparedEvidenceBatchHash: null,
                preparedEvidenceBatch: null,
                completedAt,
              }),
            });
          }
          store.appendCostEvent(assignment.assignmentHash, {
            costKey: `preventure_cost_${digest(assignment.assignmentHash)}`,
            eventType: costKnown ? billingStatus : "unknown",
            amountAudCents: costKnown ? amountAudCents : null,
            exposureAudCents,
            exactBillingPending,
            providerZeroBillingGuarantee:
              active.manifest.billing?.providerZeroBillingGuarantee ?? null,
            taskAttemptId: active.ids.attemptId,
            modelCallId: active.ids.modelCallId,
            occurredAt: now(clock),
          });
          return Object.freeze({
            recoveryClass: "canonical_known_response",
            marked: claims.markKnownNeedsReprocess({
              claimToken: active.claimToken,
              authorityHash: assignment.authorityHash,
              assignmentHash: assignment.assignmentHash,
              descriptorHash: active.descriptorHash,
              retainedOutput: active.manifest,
              reason: "Pantheon recovered one exact already-retained provider response after a local process interruption. No provider retry occurred.",
            }),
          });
        });
        const marked = recovered.marked;
        const terminalStopSealed = marked.status === "validated_early_stop";
        const status = recovered.recoveryClass === "known_pre_effect_rejection"
          ? "active_pre_effect_artifact_sealed_validated_early_stop"
          : recovered.recoveryClass === "known_effect_unusable"
            ? "active_unusable_provider_artifact_sealed_validated_early_stop"
            : recovered.recoveryClass === "known_effect_invalid_unknown_cost"
              ? "active_invalid_provider_artifact_frozen_unknown_cost"
              : recovered.recoveryClass === "canonical_known_response_unknown_cost"
                ? "active_provider_artifact_frozen_unknown_cost"
              : recovered.recoveryClass === "known_effect_unusable_non_success_attention"
                ? "active_invalid_provider_artifact_retained_no_retry_attention"
                : "active_provider_artifact_recovered_locally";
        return Object.freeze({
          status,
          recoveryClass: recovered.recoveryClass,
          authorityHash: assignment.authorityHash,
          assignmentHash: assignment.assignmentHash,
          descriptorHash: active.descriptorHash,
          retainedOutputHash: active.manifest.artifactHash,
          canReprocess: marked.reprocessEligible === true,
          terminalStopSealed,
          authorityFrozen: [
            "known_effect_invalid_unknown_cost",
            "canonical_known_response_unknown_cost",
          ].includes(recovered.recoveryClass),
          providerCalls: 0,
          additionalAiCostAudCents: 0,
          retryAuthorized: false,
        });
      }
      const terminal = discoverTerminalCustodyManifest(
        assignment,
        authorityState,
        task,
      );
      if (terminal) {
        return claims.commitTerminalProviderArtifactCustody({
          reprocessing: true,
          claimToken: null,
          authorityHash: assignment.authorityHash,
          assignmentHash: assignment.assignmentHash,
          descriptorHash: terminal.descriptorHash,
          requestBodyHash: terminal.requestBodyHash,
          taskId: assignment.taskId,
          taskAttemptId: terminal.ids.attemptId,
          modelCallId: terminal.ids.modelCallId,
          clientRequestId: terminal.clientRequestId,
          providerRequestId: terminal.manifest.providerRequestId,
          providerResponseId: terminal.manifest.providerResponseId,
          retainedOutput: terminal.manifest,
          recordedAt: now(clock),
        });
      }
    }
    return null;
  }

  async function reprocessAssignment(input = {}) {
    const current = readiness({
      authorityHash: input.authorityHash,
      assignmentId: input.assignmentId,
      assignmentHash: input.expectedAssignmentHash,
    });
    if (
      current.canReprocess !== true
      || current.descriptorHash !== input.expectedDescriptorHash
      || current.retainedOutputHash !== input.retainedOutputHash
    ) {
      throw bridgeError(
        "preventure_bridge_reprocess_stale",
        "The exact retained provider output is not locally ready for A$0 recovery.",
      );
    }
    return reprocessRetainedPreventureOutput({
      store,
      authorityHash: input.authorityHash,
      assignmentId: input.assignmentId,
      expectedAssignmentHash: input.expectedAssignmentHash,
      expectedDescriptorHash: input.expectedDescriptorHash,
      retainedOutputRef: retainedOutputReference(input.retainedOutputHash),
      clock,
      claims,
      outputStore,
      parser,
    });
  }

  async function recoverTerminalRetainedOutput(input = {}) {
    const current = readiness({
      authorityHash: input.authorityHash,
      assignmentId: input.assignmentId,
      assignmentHash: input.expectedAssignmentHash,
    });
    const exactRecordedReplay = current.status === "terminal_retained_output_custody_recorded"
      && current.descriptorHash === input.expectedDescriptorHash
      && current.retainedOutputHash === input.retainedOutputHash;
    if (
      (current.canRecoverCustody !== true && !exactRecordedReplay)
      || current.descriptorHash !== input.expectedDescriptorHash
      || current.retainedOutputHash !== input.retainedOutputHash
    ) {
      throw bridgeError(
        "preventure_bridge_terminal_custody_stale",
        "The exact retained provider output is not locally ready for terminal custody accounting.",
      );
    }
    if (exactRecordedReplay) {
      const assignment = exactAssignment(
        store,
        authority,
        input.authorityHash,
        input.expectedAssignmentHash,
      );
      const row = db.prepare(
        `SELECT recovery_json
         FROM preventure_research_terminal_recoveries
         WHERE assignment_hash = ?`,
      ).get(assignment.assignmentHash);
      const recovery = parseJson(row?.recovery_json);
      const retained = outputStore.load({
        retainedOutputHash: retainedOutputReference(input.retainedOutputHash),
        authorityHash: assignment.authorityHash,
        assignmentHash: assignment.assignmentHash,
        descriptorHash: input.expectedDescriptorHash,
      });
      if (
        recovery.assignmentHash !== assignment.assignmentHash
        || recovery.authorityHash !== assignment.authorityHash
        || recovery.retainedArtifact?.artifactHash !== retained.artifactHash
        || recovery.retainedArtifact?.artifactRef !== retained.artifactRef
        || recovery.originalDispatch?.descriptorHash !== input.expectedDescriptorHash
        || typeof recovery.recordedAt !== "string"
      ) {
        throw bridgeError(
          "preventure_bridge_terminal_custody_replay_changed",
          "The recorded terminal custody result no longer matches its immutable provider artifact.",
          500,
        );
      }
      return claims.commitTerminalProviderArtifactCustody({
        reprocessing: true,
        claimToken: null,
        authorityHash: assignment.authorityHash,
        assignmentHash: assignment.assignmentHash,
        descriptorHash: input.expectedDescriptorHash,
        requestBodyHash: retained.requestBodyHash,
        taskId: assignment.taskId,
        taskAttemptId: recovery.originalDispatch.taskAttemptId,
        modelCallId: recovery.originalDispatch.modelCallId,
        clientRequestId: retained.clientRequestId,
        providerRequestId: retained.providerRequestId,
        providerResponseId: retained.providerResponseId,
        retainedOutput: retained,
        recordedAt: recovery.recordedAt,
      });
    }
    if (current.status === "terminal_retained_output_crash_recovery_ready") {
      const assignment = exactAssignment(
        store,
        authority,
        input.authorityHash,
        input.expectedAssignmentHash,
      );
      const task = db.prepare("SELECT * FROM tasks WHERE id = ?").get(assignment.taskId);
      const authorityState = store.readState(assignment.authorityHash);
      const discovered = discoverTerminalCustodyManifest(
        assignment,
        authorityState,
        task,
      );
      if (
        !discovered
        || discovered.descriptorHash !== input.expectedDescriptorHash
        || discovered.manifest.artifactHash !== input.retainedOutputHash
      ) {
        throw bridgeError(
          "preventure_bridge_terminal_custody_crash_binding_changed",
          "The exact crash-retained artifact changed before local custody accounting.",
        );
      }
      return claims.commitTerminalProviderArtifactCustody({
        reprocessing: true,
        claimToken: null,
        authorityHash: assignment.authorityHash,
        assignmentHash: assignment.assignmentHash,
        descriptorHash: discovered.descriptorHash,
        requestBodyHash: discovered.requestBodyHash,
        taskId: assignment.taskId,
        taskAttemptId: discovered.ids.attemptId,
        modelCallId: discovered.ids.modelCallId,
        clientRequestId: discovered.clientRequestId,
        providerRequestId: discovered.manifest.providerRequestId,
        providerResponseId: discovered.manifest.providerResponseId,
        retainedOutput: discovered.manifest,
        recordedAt: now(clock),
      });
    }
    return reprocessRetainedPreventureOutput({
      store,
      authorityHash: input.authorityHash,
      assignmentId: input.assignmentId,
      expectedAssignmentHash: input.expectedAssignmentHash,
      expectedDescriptorHash: input.expectedDescriptorHash,
      retainedOutputRef: retainedOutputReference(input.retainedOutputHash),
      clock,
      claims,
      outputStore,
      parser,
    });
  }

  return Object.freeze({
    schema: BRIDGE_SCHEMA,
    retainedOutputStore: outputStore,
    readiness,
    describe: readiness,
    prepareAssignment,
    recoverCrashRetainedOutput,
    recoverTerminalRetainedOutput,
    runAssignment,
    reprocessAssignment,
  });
}

module.exports = {
  BRIDGE_SCHEMA,
  createPreventureResearchBridgeOutputStore,
  createPreventureResearchExecutionBridge,
};
