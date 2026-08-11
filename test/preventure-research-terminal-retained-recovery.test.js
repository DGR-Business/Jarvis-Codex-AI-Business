"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const { withPreventureTerminalReceiptCapability } = require("../src/db");
const { sha256 } = require("../src/runtime/commercial-test-contract");
const {
  createPreventureResearchStore,
} = require("../src/runtime/preventure-research-store");
const {
  addMilliseconds,
  authority,
  buildRecoveryInput,
  createTerminalRecoveryFixture,
  emergencyStop,
  expireAuthority,
  finalizeTerminalReceipt,
  insertKnownCompletedExecution,
  prepareDispatchedExecution,
  retainProviderArtifact,
  revokeAuthority,
} = require("./support/preventure-research-terminal-recovery-fixture");
const {
  historicalV1TestRegistry,
} = require("./support/preventure-research-test-registry");

const RECOVERY_SCHEMA = "pantheon.preventure-research-terminal-retained-recovery.v1";
const TERMINAL_COST_SCHEMA = "pantheon.preventure-research-terminal-cost-transition.v1";
const BASE_DISPATCHED_AT = "2026-08-02T06:30:00.000Z";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function assertRecoverySeam(subject) {
  assert.equal(
    typeof subject.store.commitTerminalRetainedRecovery,
    "function",
    "The atomic terminal retained-output recovery seam is unavailable.",
  );
}

function recover(subject, input = subject.recoveryInput, assignmentHash) {
  assertRecoverySeam(subject);
  return subject.store.commitTerminalRetainedRecovery(
    assignmentHash || subject.assignment.assignmentHash,
    input,
  );
}

function tableCount(db, table) {
  return Number(db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count);
}

function exactStoreError(code) {
  return (error) => error?.code === code;
}

function exactSqliteError(message) {
  return (error) => error?.code === "ERR_SQLITE_ERROR" && error.message === message;
}

function exactErrorMessage(message) {
  return (error) => error instanceof Error && error.message === message;
}

function exactCustodyPostconditionError(error) {
  return error instanceof Error
    && error.code === undefined
    && error.message
      === "Terminal retained-output recovery did not persist its exact immutable custody record.";
}

function directMutationFailure(db, action) {
  db.exec("SAVEPOINT terminal_custody_direct_mutation");
  let failure = null;
  try {
    action();
  } catch (error) {
    failure = error;
  } finally {
    db.exec("ROLLBACK TO terminal_custody_direct_mutation");
    db.exec("RELEASE terminal_custody_direct_mutation");
  }
  return failure;
}

function rows(db, table, orderBy = "rowid") {
  return db.prepare(`SELECT * FROM ${table} ORDER BY ${orderBy}`).all();
}

function tableSnapshot(db, excluded = []) {
  const excludedSet = new Set(excluded);
  const names = db.prepare(
    `SELECT name FROM sqlite_schema
     WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
     ORDER BY name`,
  ).all().map((row) => row.name).filter((name) => !excludedSet.has(name));
  return Object.fromEntries(names.map((name) => {
    const primaryKey = db.prepare(`PRAGMA table_info(${name})`).all()
      .filter((column) => column.pk > 0)
      .sort((left, right) => left.pk - right.pk)
      .map((column) => column.name);
    const values = db.prepare(`SELECT * FROM ${name}`).all()
      .map((row) => JSON.parse(JSON.stringify(row)))
      .sort((left, right) => JSON.stringify(
        primaryKey.map((key) => left[key]),
      ).localeCompare(JSON.stringify(primaryKey.map((key) => right[key]))));
    return [name, values];
  }));
}

function accountingSnapshot(subject) {
  return {
    costEvents: subject.db.prepare(
      `SELECT * FROM preventure_research_cost_events
       WHERE assignment_hash = ? AND cost_key = ? ORDER BY sequence`,
    ).all(subject.assignment.assignmentHash, subject.execution.ids.costKey),
    reservations: rows(subject.db, "budget_reservations", "id"),
    costs: rows(subject.db, "costs", "id"),
    modelCalls: rows(subject.db, "model_calls", "id"),
    recoveries: rows(subject.db, "preventure_research_terminal_recoveries", "recovery_hash"),
  };
}

function assignmentActivitySnapshot(subject, assignment) {
  const taskId = assignment.taskId;
  return {
    task: subject.db.prepare("SELECT * FROM tasks WHERE id = ?").get(taskId),
    attempts: subject.db.prepare(
      "SELECT * FROM task_attempts WHERE task_id = ? ORDER BY id",
    ).all(taskId),
    modelCalls: subject.db.prepare(
      "SELECT * FROM model_calls WHERE task_id = ? ORDER BY id",
    ).all(taskId),
    researchRuns: subject.db.prepare(
      "SELECT * FROM research_runs WHERE task_id = ? ORDER BY id",
    ).all(taskId),
    researchSources: subject.db.prepare(
      `SELECT sources.* FROM research_sources AS sources
       JOIN research_runs AS runs ON runs.id = sources.run_id
       WHERE runs.task_id = ? ORDER BY sources.id`,
    ).all(taskId),
    agentRuns: subject.db.prepare(
      "SELECT * FROM agent_runs WHERE task_id = ? ORDER BY id",
    ).all(taskId),
    agentReceipts: subject.db.prepare(
      "SELECT * FROM agent_run_receipts WHERE task_id = ? ORDER BY sequence, id",
    ).all(taskId),
    traceEvents: subject.db.prepare(
      `SELECT traces.* FROM agent_trace_events AS traces
       JOIN agent_runs AS runs ON runs.id = traces.run_id
       WHERE runs.task_id = ? ORDER BY traces.sequence, traces.id`,
    ).all(taskId),
    evaluations: subject.db.prepare(
      "SELECT * FROM agent_eval_results WHERE task_id = ? ORDER BY id",
    ).all(taskId),
    provenance: subject.db.prepare(
      "SELECT * FROM agent_run_provenance WHERE task_id = ? ORDER BY id",
    ).all(taskId),
    reservations: subject.db.prepare(
      "SELECT * FROM budget_reservations WHERE task_id = ? ORDER BY id",
    ).all(taskId),
    costs: subject.db.prepare(
      "SELECT * FROM costs WHERE task_id = ? ORDER BY id",
    ).all(taskId),
    authorityCosts: subject.db.prepare(
      `SELECT * FROM preventure_research_cost_events
       WHERE assignment_hash = ? ORDER BY cost_key, sequence`,
    ).all(assignment.assignmentHash),
    sources: subject.db.prepare(
      `SELECT * FROM preventure_research_source_snapshots
       WHERE assignment_hash = ? ORDER BY snapshot_hash`,
    ).all(assignment.assignmentHash),
    evidence: subject.db.prepare(
      `SELECT * FROM preventure_research_evidence_records
       WHERE assignment_hash = ? ORDER BY evidence_hash`,
    ).all(assignment.assignmentHash),
  };
}

function immutableActivitySnapshot(subject) {
  const expectedRecoveryWrites = [
    "preventure_research_terminal_recoveries",
    "preventure_research_cost_events",
    "agent_run_receipts",
  ];
  const mutableRecoveryProjections = [
    ...expectedRecoveryWrites,
    "budget_reservations",
    "costs",
    "workflows",
    "tasks",
    "task_attempts",
    "model_calls",
    "agent_runs",
    "agent_tool_invocations",
  ];
  return {
    stableTables: tableSnapshot(subject.db, mutableRecoveryProjections),
    agentReceiptCount: tableCount(subject.db, "agent_run_receipts"),
    rowCounts: Object.fromEntries(mutableRecoveryProjections
      .filter((table) => !expectedRecoveryWrites.includes(table))
      .map((table) => [
      table,
      tableCount(subject.db, table),
      ])),
  };
}

function executionRows(subject) {
  const one = (table, id) => subject.db.prepare(
    `SELECT * FROM ${table} WHERE id = ?`,
  ).get(id);
  return {
    workflow: one("workflows", subject.assignment.workflowId),
    task: one("tasks", subject.assignment.taskId),
    attempt: one("task_attempts", subject.execution.ids.attemptId),
    modelCall: one("model_calls", subject.execution.ids.modelCallId),
    agentRun: one("agent_runs", subject.execution.runId),
    toolInvocation: one(
      "agent_tool_invocations",
      subject.execution.ids.toolInvocationId,
    ),
  };
}

function assertTerminalExecutionSealed(subject) {
  const activeStatuses = new Set([
    "dispatching",
    "in_progress",
    "pending",
    "queued",
    "ready",
    "retry_wait",
    "running",
  ]);
  const projections = executionRows(subject);
  for (const [name, row] of Object.entries(projections)) {
    assert.ok(row, `${name} projection is missing`);
    assert.equal(
      activeStatuses.has(row.status),
      false,
      `${name} remains active after terminal custody`,
    );
  }
  assert.equal(projections.task.claim_token, null);
  assert.equal(projections.task.claimed_at, null);
  assert.equal(projections.task.max_retries, 0);
  assert.ok(projections.task.completed_at);
  assert.ok(projections.attempt.completed_at);
  assert.ok(projections.modelCall.completed_at);
  assert.ok(projections.agentRun.completed_at);
  assert.ok(projections.toolInvocation.resolved_at);
}

function createScenario(kind, options = {}) {
  const fx = createTerminalRecoveryFixture(options.fixtureOptions);
  try {
    const expiryAt = new Date(Date.parse(authority.expiresAt)).toISOString();
    let dispatchedAt = options.dispatchedAt || BASE_DISPATCHED_AT;
    if (["expired", "expired_after_retention"].includes(kind)) {
      dispatchedAt = addMilliseconds(expiryAt, -2_000);
    }
    const execution = prepareDispatchedExecution(fx, {
      dispatchedAt,
      productionRunIdentity: options.productionRunIdentity === true,
    });
    options.beforeTerminal?.(fx, execution);
    if (!Object.hasOwn(options, "receipt")) {
      finalizeTerminalReceipt(fx, execution);
    }
    let terminal;
    let artifact;
    if (kind === "revoked") {
      terminal = revokeAuthority(fx, execution, addMilliseconds(dispatchedAt, 1_000));
      artifact = retainProviderArtifact(fx, execution, {
        malformed: options.malformed,
        ...(Object.hasOwn(options, "providerRequestId")
          ? { providerRequestId: options.providerRequestId }
          : {}),
        retainedAt: addMilliseconds(dispatchedAt, 2_000),
      });
    } else if (kind === "expired") {
      terminal = expireAuthority(fx, execution, expiryAt);
      artifact = retainProviderArtifact(fx, execution, {
        malformed: options.malformed,
        ...(Object.hasOwn(options, "providerRequestId")
          ? { providerRequestId: options.providerRequestId }
          : {}),
        retainedAt: addMilliseconds(expiryAt, 1),
      });
    } else if (kind === "expired_after_retention") {
      artifact = retainProviderArtifact(fx, execution, {
        malformed: options.malformed,
        ...(Object.hasOwn(options, "providerRequestId")
          ? { providerRequestId: options.providerRequestId }
          : {}),
        retainedAt: addMilliseconds(expiryAt, 1),
      });
      terminal = expireAuthority(fx, execution, addMilliseconds(expiryAt, 2));
    } else if (kind === "emergency") {
      artifact = retainProviderArtifact(fx, execution, {
        malformed: options.malformed,
        ...(Object.hasOwn(options, "providerRequestId")
          ? { providerRequestId: options.providerRequestId }
          : {}),
        retainedAt: addMilliseconds(dispatchedAt, 1_000),
      });
      if (options.knownProviderResultBeforeEmergency === true) {
        fx.db.prepare(
          `UPDATE model_calls
           SET status = 'completed', outcome_status = 'known',
               provider_request_id = ?, completed_at = ?,
               metadata = json_patch(metadata, ?)
           WHERE id = ?`,
        ).run(
          artifact.retained.providerRequestId,
          artifact.retainedAt,
          JSON.stringify({
            providerResponseReceived: true,
            providerResponseId: artifact.retained.providerResponseId,
            retainedArtifactHash: artifact.retained.artifactHash,
          }),
          execution.ids.modelCallId,
        );
      }
      fx.setClock(addMilliseconds(dispatchedAt, 2_000));
      terminal = emergencyStop(fx, execution);
    } else {
      throw new Error(`Unknown recovery fixture kind ${kind}`);
    }
    const recoveryInput = buildRecoveryInput(fx, execution, terminal, artifact, {
      ...(Object.hasOwn(options, "receipt") ? { receipt: options.receipt } : {}),
      ...(Object.hasOwn(options, "recoveredAt")
        ? { recoveredAt: options.recoveredAt }
        : {}),
    });
    return {
      ...fx,
      artifact,
      assignment: execution.assignment,
      execution,
      kind,
      recoveryInput,
      terminal,
      knownProviderResultBeforeEmergency:
        options.knownProviderResultBeforeEmergency === true,
    };
  } catch (error) {
    fx.close();
    throw error;
  }
}

function createEffectiveExpiryScenario(options = {}) {
  const fx = createTerminalRecoveryFixture(options.fixtureOptions);
  try {
    const expiryAt = new Date(Date.parse(authority.expiresAt)).toISOString();
    const execution = prepareDispatchedExecution(fx, {
      dispatchedAt: addMilliseconds(expiryAt, -2_000),
    });
    finalizeTerminalReceipt(fx, execution);
    options.mutate?.(fx, execution);
    const artifact = retainProviderArtifact(fx, execution, {
      retainedAt: addMilliseconds(expiryAt, 1),
    });
    const terminal = {
      terminalAt: authority.expiresAt,
      observedAt: addMilliseconds(expiryAt, 1),
    };
    const recoveryInput = buildRecoveryInput(fx, execution, terminal, artifact, {
      recoveredAt: addMilliseconds(expiryAt, 2),
    });
    return {
      ...fx,
      artifact,
      assignment: execution.assignment,
      execution,
      kind: "expired",
      recoveryInput,
      terminal,
    };
  } catch (error) {
    fx.close();
    throw error;
  }
}

function createEmergencyProjectionScenario(options = {}) {
  const fx = createTerminalRecoveryFixture(options.fixtureOptions);
  try {
    const execution = prepareDispatchedExecution(fx, { dispatchedAt: BASE_DISPATCHED_AT });
    const artifact = retainProviderArtifact(fx, execution, {
      retainedAt: addMilliseconds(execution.dispatchedAt, 1_000),
    });
    fx.setClock(addMilliseconds(execution.dispatchedAt, 2_000));
    const terminal = emergencyStop(fx, execution);
    options.mutate?.(fx, execution);
    const recoveryInput = buildRecoveryInput(fx, execution, terminal, artifact, {
      receipt: null,
      recoveredAt: addMilliseconds(terminal.terminalAt, 1),
    });
    return {
      ...fx,
      artifact,
      assignment: execution.assignment,
      execution,
      kind: "emergency",
      recoveryInput,
      terminal,
    };
  } catch (error) {
    fx.close();
    throw error;
  }
}

function createCompletedPrefixScenario() {
  const fx = createTerminalRecoveryFixture({ assignmentIndex: 1 });
  try {
    const completedPrefix = fx.assignments[0];
    insertKnownCompletedExecution(
      fx.db,
      fx.store,
      completedPrefix,
      0,
      false,
      { eventType: "reconciled", amountAudCents: 0, exposureAudCents: 0 },
      { enabled: true },
    );
    const execution = prepareDispatchedExecution(fx, { dispatchedAt: BASE_DISPATCHED_AT });
    finalizeTerminalReceipt(fx, execution);
    const terminal = revokeAuthority(
      fx,
      execution,
      addMilliseconds(execution.dispatchedAt, 1_000),
    );
    const artifact = retainProviderArtifact(fx, execution, {
      retainedAt: addMilliseconds(execution.dispatchedAt, 2_000),
    });
    const recoveryInput = buildRecoveryInput(fx, execution, terminal, artifact);
    return {
      ...fx,
      artifact,
      assignment: execution.assignment,
      completedPrefix,
      execution,
      kind: "revoked",
      recoveryInput,
      terminal,
    };
  } catch (error) {
    fx.close();
    throw error;
  }
}

function seedBoundExecutionChildren(fx, execution, options = {}) {
  const suffix = execution.assignment.assignmentHash.slice(7, 23);
  const occurredAt = addMilliseconds(execution.dispatchedAt, 100);
  const researchRunId = `terminal_recovery_research_run_${suffix}`;
  const researchSourceId = `terminal_recovery_research_source_${suffix}`;
  const evaluationId = `terminal_recovery_eval_${suffix}`;
  const provenanceId = `terminal_recovery_provenance_${suffix}`;
  fx.db.prepare(
    `INSERT INTO research_runs
     (id, workflow_id, task_id, venture_id, query, provider, mode, status,
      budget_cents, actual_cents, summary, metadata, created_at, completed_at)
     VALUES (?, ?, ?, NULL, 'Exact terminal custody support record', ?, 'live',
             'completed', ?, 0, 'Retained execution context only', '{}', ?, ?)`,
  ).run(
    researchRunId,
    execution.assignment.workflowId,
    execution.assignment.taskId,
    execution.assignment.provider,
    execution.assignment.maxCostAudCents,
    occurredAt,
    occurredAt,
  );
  fx.db.prepare(
    `INSERT INTO research_sources
     (id, run_id, title, url, publisher, published_at, retrieved_at,
      relevance, confidence, metadata)
     VALUES (?, ?, 'Terminal custody execution source', 'https://example.com/custody',
             'Example', NULL, ?, 'Execution context only', 'provider_grounded', '{}')`,
  ).run(researchSourceId, researchRunId, occurredAt);
  fx.db.prepare(
    `INSERT INTO agent_eval_results
     (id, run_id, agent_id, task_id, attempt_id, status, score,
      criteria, findings, metadata, evaluator_version, subject_hash, created_at)
     VALUES (?, ?, 'demand_validator', ?, ?, 'needs_review', 0,
             '[]', '[]', '{}', 'terminal-custody-fixture-v1', ?, ?)`,
  ).run(
    evaluationId,
    execution.runId,
    execution.assignment.taskId,
    execution.ids.attemptId,
    sha256({ evaluationId }),
    occurredAt,
  );
  if (options.provenance !== false) {
    fx.db.prepare(
      `INSERT INTO agent_run_provenance
       (id, fingerprint, run_id, attempt_id, task_id, model_call_id,
        tool_invocation_id, research_run_id, research_source_id, kind, title, url,
        grounding_type, output_hash, metadata, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'web_source',
               'Terminal custody execution source', 'https://example.com/custody',
               'web_search_action_source', ?, '{}', ?)`,
    ).run(
      provenanceId,
      sha256({ provenanceId }),
      execution.runId,
      execution.ids.attemptId,
      execution.assignment.taskId,
      execution.ids.modelCallId,
      execution.ids.toolInvocationId,
      researchRunId,
      researchSourceId,
      sha256({ researchSourceId }),
      occurredAt,
    );
  }
  let pilotFixtureId = null;
  let pilotReviewId = null;
  if (options.pilotReview === true) {
    const venture = fx.db.prepare("SELECT id FROM ventures ORDER BY id LIMIT 1").get();
    assert.ok(venture);
    pilotFixtureId = `terminal_recovery_pilot_fixture_${suffix}`;
    pilotReviewId = `terminal_recovery_pilot_review_${suffix}`;
    fx.db.prepare(
      `INSERT INTO agent_pilot_fixtures
       (id, venture_id, candidate_id, captured_at, question, buyer, hypothesis,
        sources, constraints, fixture_hash, status, created_at)
       VALUES (?, ?, NULL, ?, 'Can terminal custody preserve this review?',
               'Internal operator', 'Custody retains but does not promote review state.',
               '[]', '{}', ?, 'ready', ?)`,
    ).run(pilotFixtureId, venture.id, occurredAt, sha256({ pilotFixtureId }), occurredAt);
    fx.db.prepare(
      `INSERT INTO agent_pilot_reviews
       (id, run_id, fixture_id, capability_key, deterministic_status,
        operator_verdict, usefulness_score, note, criteria, created_at, reviewed_at)
       VALUES (?, ?, ?, 'terminal_custody', 'needs_review', 'pending', NULL,
               'Execution context only', '{}', ?, NULL)`,
    ).run(pilotReviewId, execution.runId, pilotFixtureId, occurredAt);
  }
  return {
    evaluationId,
    pilotFixtureId,
    pilotReviewId,
    provenanceId,
    researchRunId,
    researchSourceId,
  };
}

function createBoundChildrenScenario(options = {}) {
  let childIds;
  const subject = createScenario("revoked", {
    receipt: null,
    productionRunIdentity: options.productionRunIdentity === true,
    beforeTerminal(fx, execution) {
      childIds = seedBoundExecutionChildren(fx, execution, options);
    },
  });
  return { subject, childIds };
}

function rawRecovery(subject) {
  return subject.db.prepare(
    `SELECT * FROM preventure_research_terminal_recoveries
     WHERE assignment_hash = ?`,
  ).get(subject.assignment.assignmentHash);
}

function retainedManifestPath(subject) {
  const hex = subject.artifact.retained.artifactHash.slice("sha256:".length);
  return path.join(
    subject.dir,
    "terminal-recovery-artifacts",
    hex.slice(0, 2),
    `${hex}.json`,
  );
}

function tamperRetainedManifest(subject) {
  const file = retainedManifestPath(subject);
  const manifest = JSON.parse(fs.readFileSync(file, "utf8"));
  manifest.responseMetadata = {
    ...manifest.responseMetadata,
    responseIssues: ["tampered_after_retention"],
  };
  fs.writeFileSync(file, JSON.stringify(manifest), { encoding: "utf8", mode: 0o600 });
}

function assertTerminalStatePreserved(subject, result) {
  const current = subject.store.readState(authority.authorityHash);
  if (subject.kind === "revoked") {
    assert.equal(current.state, "revoked");
    assert.equal(current.terminal, true);
  } else if (["expired", "expired_after_retention"].includes(subject.kind)) {
    assert.equal(current.state, "expired");
    assert.equal(current.terminal, true);
  } else {
    assert.equal(current.dispatchAllowed, false);
    assert.equal(current.unknownCostCount >= 1, true);
  }
  assert.ok(result.terminalState);
}

function assertSuccessfulRecovery(subject, result, beforeActivity, beforeAccounting) {
  assert.equal(result.created, true);
  assert.equal(result.recovery.schema, RECOVERY_SCHEMA);
  assert.match(result.recovery.recoveryHash, /^sha256:[a-f0-9]{64}$/);
  assert.equal(result.recovery.authorityHash, authority.authorityHash);
  assert.equal(result.recovery.assignmentHash, subject.assignment.assignmentHash);
  assert.equal(result.recovery.assignmentTemplateHash, subject.assignment.templateHash);
  assert.equal(result.recovery.taskId, subject.assignment.taskId);
  assert.equal(result.recovery.workflowId, subject.assignment.workflowId);
  const {
    terminalAt,
    eventOccurredAt,
    ...persistedTerminalBinding
  } = result.recovery.terminalBinding;
  assert.deepEqual(persistedTerminalBinding, subject.terminal.terminalBinding);
  assert.equal(terminalAt, subject.terminal.terminalAt);
  assert.equal(eventOccurredAt, subject.terminal.observedAt || subject.terminal.terminalAt);
  if (["expired", "expired_after_retention"].includes(subject.kind)) {
    assert.equal(terminalAt, authority.expiresAt);
  }
  assert.equal(result.recovery.originalDispatch.taskAttemptId, subject.execution.ids.attemptId);
  assert.equal(result.recovery.originalDispatch.modelCallId, subject.execution.ids.modelCallId);
  assert.equal(result.recovery.originalDispatch.clientRequestId, subject.execution.ids.clientRequestId);
  assert.equal(result.recovery.originalDispatch.providerRequestId, subject.recoveryInput.providerRequestId);
  assert.equal(result.recovery.originalDispatch.providerResponseId, subject.recoveryInput.providerResponseId);
  assert.equal(result.recovery.originalDispatch.providerDispatchedAt, subject.execution.dispatchedAt);
  assert.equal(result.recovery.retainedArtifact.artifactHash, subject.artifact.retained.artifactHash);
  assert.equal(result.recovery.retainedArtifact.artifactRef, subject.artifact.retained.artifactRef);
  assert.equal(result.recovery.retainedArtifact.rawProviderBodyHash, subject.artifact.retained.rawProviderBodyHash);
  assert.equal(result.recovery.retainedArtifact.outputHash, subject.artifact.retained.outputHash);
  assert.equal(result.recovery.retainedArtifact.providerResponseHash, subject.artifact.retained.providerResponseHash);
  assert.equal(result.recovery.controls.additionalAiCostAudCents, 0);
  assert.equal(result.recovery.controls.additionalNetworkCalls, 0);
  assert.equal(result.recovery.controls.retryAuthorized, false);
  assert.equal(result.recovery.controls.evidenceEligible, false);
  assert.equal(result.recovery.controls.decisionEligible, false);
  assert.equal(result.recovery.controls.completionEligible, false);
  assert.equal(result.recovery.controls.commercialInference, "none");
  assert.equal(result.recovery.controls.executionSealed, true);

  const closure = result.recovery.executionClosure;
  assert.equal(
    closure.schema,
    "pantheon.preventure-research-terminal-execution-closure.v1",
  );
  assert.match(closure.closureHash, /^sha256:[a-f0-9]{64}$/);
  assert.equal(closure.authorityHash, authority.authorityHash);
  assert.equal(closure.assignmentHash, subject.assignment.assignmentHash);
  assert.equal(closure.taskId, subject.assignment.taskId);
  assert.equal(closure.workflowId, subject.assignment.workflowId);
  assert.equal(closure.taskAttemptId, subject.execution.ids.attemptId);
  assert.equal(closure.modelCallId, subject.execution.ids.modelCallId);
  assert.equal(closure.agentRunId, subject.execution.runId);
  assert.equal(closure.toolInvocationId, subject.execution.ids.toolInvocationId);
  assert.equal(closure.terminalEventHash, subject.terminal.terminalBinding.eventHash);
  assert.equal(closure.artifactHash, subject.artifact.retained.artifactHash);
  assert.equal(closure.resultingStatus, "needs_attention");
  assert.equal(closure.claimCleared, true);
  assert.equal(closure.retryAuthorized, false);
  assert.equal(closure.evidenceEligible, false);
  assert.equal(closure.closedAt, subject.recoveryInput.recordedAt);
  const expectedSiblingAssignments = subject.assignments.filter(
    (assignment) => assignment.assignmentHash !== subject.assignment.assignmentHash,
  );
  assert.equal(closure.siblingClosures.length, expectedSiblingAssignments.length);
  for (const [index, sibling] of closure.siblingClosures.entries()) {
    const expected = expectedSiblingAssignments[index];
    assert.equal(sibling.assignmentId, expected.id);
    assert.equal(sibling.assignmentHash, expected.assignmentHash);
    assert.equal(sibling.taskId, expected.taskId);
    assert.equal(sibling.priorStatus, "blocked");
    assert.equal(sibling.priorOutcomeStatus, "not_started");
    assert.equal(sibling.resultingStatus, "cancelled");
    assert.equal(sibling.resultingOutcomeStatus, "cancelled_by_terminal_authority_custody");
    assert.equal(sibling.zeroActivityCount, 0);
    const siblingTask = subject.db.prepare("SELECT * FROM tasks WHERE id = ?").get(expected.taskId);
    assert.equal(siblingTask.status, "cancelled");
    assert.equal(siblingTask.outcome_status, "cancelled_by_terminal_authority_custody");
    assert.equal(siblingTask.max_retries, 0);
    assert.equal(siblingTask.claim_token, null);
    assert.equal(siblingTask.claimed_at, null);
  }

  const row = rawRecovery(subject);
  assert.ok(row);
  assert.equal(row.recovery_hash, result.recovery.recoveryHash);
  assert.deepEqual(JSON.parse(row.recovery_json), result.recovery);
  assert.equal(row.authority_hash, authority.authorityHash);
  assert.equal(row.assignment_hash, subject.assignment.assignmentHash);
  assert.equal(row.assignment_template_hash, subject.assignment.templateHash);
  assert.equal(row.assignment_cap_aud_cents, subject.assignment.maxCostAudCents);
  assert.equal(row.task_id, subject.assignment.taskId);
  assert.equal(row.workflow_id, subject.assignment.workflowId);
  assert.equal(row.task_attempt_id, subject.execution.ids.attemptId);
  assert.equal(row.model_call_id, subject.execution.ids.modelCallId);
  assert.equal(row.terminal_kind, subject.terminal.terminalBinding.kind);
  assert.equal(String(row.terminal_record_id), String(subject.terminal.terminalBinding.eventId));
  assert.equal(row.terminal_event_hash, subject.terminal.terminalBinding.eventHash);
  assert.equal(row.terminal_event_type, subject.terminal.terminalBinding.eventType);
  assert.equal(row.terminal_at, subject.terminal.terminalAt);
  assert.equal(row.original_claim_token_hash, sha256(subject.recoveryInput.claimToken));
  assert.equal(row.descriptor_hash, subject.recoveryInput.descriptorHash);
  assert.equal(row.request_body_hash, subject.recoveryInput.requestBodyHash);
  assert.equal(row.client_request_id, subject.recoveryInput.clientRequestId);
  assert.equal(row.provider_request_id, subject.recoveryInput.providerRequestId);
  assert.equal(row.provider_response_id, subject.recoveryInput.providerResponseId);
  assert.equal(row.provider_dispatched_at, subject.execution.dispatchedAt);
  assert.equal(row.artifact_hash, subject.artifact.retained.artifactHash);
  assert.equal(row.artifact_ref, subject.artifact.retained.artifactRef);
  assert.equal(row.raw_provider_body_hash, subject.artifact.retained.rawProviderBodyHash);
  assert.equal(row.output_hash, subject.artifact.retained.outputHash);
  assert.equal(row.provider_response_hash, subject.artifact.retained.providerResponseHash);
  const priorCost = beforeAccounting.costEvents.at(-1);
  const priorCostJson = JSON.parse(priorCost.cost_json);
  assert.equal(row.cost_key, subject.execution.ids.costKey);
  assert.equal(row.prior_cost_receipt_hash, priorCost.receipt_hash);
  assert.equal(row.budget_reservation_id, subject.execution.ids.reservationId);
  assert.equal(row.cost_id, subject.execution.ids.costId);
  assert.equal(row.additional_ai_cost_aud_cents, 0);
  assert.equal(row.additional_network_calls, 0);
  assert.equal(row.retry_authorized, 0);
  assert.equal(row.evidence_eligible, 0);
  assert.equal(row.decision_eligible, 0);
  assert.equal(row.completion_eligible, 0);
  assert.equal(row.commercial_inference, "none");
  assert.equal(result.recovery.costSnapshot.priorReceiptHash, priorCost.receipt_hash);
  assert.equal(result.recovery.costSnapshot.priorEventType, priorCost.event_type);
  assert.equal(result.recovery.costSnapshot.priorAmountAudCents, priorCost.amount_aud_cents);
  assert.equal(
    result.recovery.costSnapshot.priorExposureAudCents,
    priorCost.exposure_aud_cents,
  );
  assert.equal(priorCostJson.receiptHash, priorCost.receipt_hash);

  const afterAccounting = accountingSnapshot(subject);
  assert.equal(afterAccounting.recoveries.length, 1);
  assert.equal(afterAccounting.costEvents.length, beforeAccounting.costEvents.length + 1);
  const terminalCost = afterAccounting.costEvents.at(-1);
  const terminalCostJson = JSON.parse(terminalCost.cost_json);
  assert.equal(terminalCost.event_type, "unknown");
  assert.equal(terminalCost.amount_aud_cents, null);
  assert.equal(terminalCost.exposure_aud_cents, subject.assignment.maxCostAudCents);
  assert.equal(terminalCost.previous_receipt_hash, priorCost.receipt_hash);
  assert.equal(terminalCost.receipt_hash, row.terminal_cost_receipt_hash);
  assert.equal(terminalCostJson.schema, "pantheon.preventure-research-cost-event.v1");
  assert.equal(terminalCostJson.terminalRecovery.schema, TERMINAL_COST_SCHEMA);
  assert.equal(
    terminalCostJson.terminalRecovery.recoveryIntentHash,
    result.recovery.recoveryIntentHash,
  );
  assert.equal(row.recovery_intent_hash, result.recovery.recoveryIntentHash);
  assert.equal(result.recovery.costSnapshot.terminalReceiptHash, terminalCost.receipt_hash);
  assert.equal(terminalCost.task_attempt_id, subject.execution.ids.attemptId);
  assert.equal(terminalCost.model_call_id, subject.execution.ids.modelCallId);
  assert.equal(
    terminalCost.agent_run_receipt_id,
    result.recovery.executionReceipt?.id || null,
  );
  assert.equal(
    terminalCostJson.agentRunReceiptId,
    result.recovery.executionReceipt?.id || null,
  );
  assert.equal(terminalCost.budget_reservation_id, subject.execution.ids.reservationId);
  assert.equal(terminalCost.cost_id, subject.execution.ids.costId);

  assert.equal(afterAccounting.reservations.length, beforeAccounting.reservations.length);
  assert.equal(afterAccounting.costs.length, beforeAccounting.costs.length);
  assert.equal(afterAccounting.modelCalls.length, beforeAccounting.modelCalls.length);
  const reservation = afterAccounting.reservations.find(
    (item) => item.id === subject.execution.ids.reservationId,
  );
  const cost = afterAccounting.costs.find((item) => item.id === subject.execution.ids.costId);
  const model = afterAccounting.modelCalls.find(
    (item) => item.id === subject.execution.ids.modelCallId,
  );
  assert.equal(reservation.status, "unknown");
  assert.equal(reservation.amount_cents, subject.assignment.maxCostAudCents);
  assert.equal(cost.status, "unknown");
  assert.equal(cost.amount_cents, subject.assignment.maxCostAudCents);
  assert.equal(model.cost_status, "unknown");
  assert.equal(model.reserved_cost_cents, subject.assignment.maxCostAudCents);
  assert.equal(model.actual_cost_cents, 0);
  assert.equal(model.reconciled_cost_cents, 0);

  const afterActivity = immutableActivitySnapshot(subject);
  assert.deepEqual(afterActivity.stableTables, beforeActivity.stableTables);
  assert.deepEqual(afterActivity.rowCounts, beforeActivity.rowCounts);
  assert.equal(afterActivity.agentReceiptCount, beforeActivity.agentReceiptCount + 1);
  assert.equal(tableCount(subject.db, "preventure_research_source_snapshots"), 0);
  assert.equal(tableCount(subject.db, "preventure_research_evidence_records"), 0);
  assert.equal(tableCount(subject.db, "preventure_research_terminal_stops"), 0);
  assert.equal(tableCount(subject.db, "preventure_research_assignment_skips"), 0);
  assert.equal(tableCount(subject.db, "preventure_research_decisions"), 0);
  assert.equal(subject.store.loadLifecycle(authority.authorityHash)
    .filter((event) => event.eventType === "completed").length, 0);
  assertTerminalExecutionSealed(subject);
  assertTerminalStatePreserved(subject, result);
  assert.equal(subject.store.verifyLedger().ok, true);
  const restartedStore = subject.store.withRetainedOutputStore(subject.retainedOutputStore);
  assert.equal(restartedStore.readState(authority.authorityHash).dispatchAllowed, false);
  assert.equal(restartedStore.verifyLedger().ok, true);
}

function insertExactRow(db, table, row) {
  const columns = Object.keys(row);
  db.prepare(
    `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`,
  ).run(...columns.map((column) => row[column] ?? null));
}

function primeUnknownCostHead(subject) {
  const occurredAt = addMilliseconds(subject.execution.dispatchedAt, 100);
  subject.setClock(occurredAt);
  subject.db.prepare(
    `UPDATE costs SET model_call_id = ?, status = 'unknown', amount_cents = ?
     WHERE id = ?`,
  ).run(
    subject.execution.ids.modelCallId,
    subject.assignment.maxCostAudCents,
    subject.execution.ids.costId,
  );
  subject.db.prepare(
    `UPDATE budget_reservations SET status = 'unknown', amount_cents = ?
     WHERE id = ?`,
  ).run(subject.assignment.maxCostAudCents, subject.execution.ids.reservationId);
  subject.db.prepare(
    `UPDATE model_calls
     SET cost_status = 'unknown', reserved_cost_cents = ?, actual_cost_cents = 0,
         reconciled_cost_cents = 0
     WHERE id = ?`,
  ).run(subject.assignment.maxCostAudCents, subject.execution.ids.modelCallId);
  return subject.store.appendCostEvent(subject.assignment.assignmentHash, {
    eventType: "unknown",
    amountAudCents: null,
    exposureAudCents: subject.assignment.maxCostAudCents,
    costKey: subject.execution.ids.costKey,
    taskAttemptId: subject.execution.ids.attemptId,
    modelCallId: subject.execution.ids.modelCallId,
    budgetReservationId: subject.execution.ids.reservationId,
    costId: subject.execution.ids.costId,
    agentRunReceiptId: null,
    occurredAt,
  }).costEvent;
}

test("terminal recovery durably records revoked and expired provider outputs without treating them as evidence", async (t) => {
  for (const kind of ["revoked", "expired"]) {
    await t.test(kind, () => {
      const subject = createScenario(kind);
      try {
        const beforeActivity = immutableActivitySnapshot(subject);
        const beforeAccounting = accountingSnapshot(subject);
        const result = recover(subject);
        assertSuccessfulRecovery(subject, result, beforeActivity, beforeAccounting);
      } finally {
        subject.close();
      }
    });
  }
});

test("emergency stop atomically records full-cap immutable cost truth before artifact custody", () => {
  const fx = createTerminalRecoveryFixture();
  try {
    const execution = prepareDispatchedExecution(fx, { dispatchedAt: BASE_DISPATCHED_AT });
    const before = fx.store.readLedger(authority.authorityHash);
    fx.setClock(addMilliseconds(execution.dispatchedAt, 1));
    const terminal = emergencyStop(fx, execution);
    const after = fx.store.readLedger(authority.authorityHash);
    const chain = after.costEvents.filter(
      (event) => event.assignmentHash === execution.assignment.assignmentHash
        && event.costKey === execution.ids.costKey,
    );
    assert.equal(chain.length, before.costEvents.length + 1);
    const head = chain.at(-1);
    assert.equal(head.eventType, "unknown");
    assert.equal(head.amountAudCents, null);
    assert.equal(head.exposureAudCents, execution.assignment.maxCostAudCents);
    assert.equal(head.taskAttemptId, execution.ids.attemptId);
    assert.equal(head.modelCallId, execution.ids.modelCallId);
    assert.equal(head.previousReceiptHash, execution.reservedCostEvent.receiptHash);
    assert.equal(
      head.emergencyStop.schema,
      "pantheon.preventure-research-emergency-cost-transition.v1",
    );
    assert.equal(head.emergencyStop.stoppedAt, terminal.terminalAt);
    assert.equal(head.emergencyStop.exactBillingPending, true);
    assert.equal(head.emergencyStop.providerOutcomeKnown, false);
    assert.deepEqual({ ...fx.db.prepare(
      `SELECT reservations.status AS reservation_status,
              reservations.amount_cents AS reservation_amount,
              costs.status AS cost_status, costs.amount_cents AS cost_amount,
              calls.cost_status AS model_cost_status,
              calls.reserved_cost_cents AS model_exposure,
              calls.actual_cost_cents AS model_actual,
              calls.reconciled_cost_cents AS model_reconciled
       FROM budget_reservations AS reservations
       JOIN costs ON costs.id = ?
       JOIN model_calls AS calls ON calls.id = ?
       WHERE reservations.id = ?`,
    ).get(execution.ids.costId, execution.ids.modelCallId, execution.ids.reservationId) }, {
      reservation_status: "unknown",
      reservation_amount: execution.assignment.maxCostAudCents,
      cost_status: "unknown",
      cost_amount: execution.assignment.maxCostAudCents,
      model_cost_status: "unknown",
      model_exposure: execution.assignment.maxCostAudCents,
      model_actual: 0,
      model_reconciled: 0,
    });
    assert.equal(fx.store.readState(authority.authorityHash).exactBillingPending, true);
    assert.equal(fx.store.verifyLedger().ok, true);
    assert.equal(tableCount(fx.db, "preventure_research_source_snapshots"), 0);
    assert.equal(tableCount(fx.db, "preventure_research_evidence_records"), 0);
    assert.equal(tableCount(fx.db, "preventure_research_decisions"), 0);
    assert.equal(tableCount(fx.db, "preventure_research_terminal_recoveries"), 0);
  } finally {
    fx.close();
  }
});

test("assignment-two custody preserves its completed prefix and cancels only the untouched suffix", () => {
  const subject = createCompletedPrefixScenario();
  try {
    const prefixBefore = assignmentActivitySnapshot(subject, subject.completedPrefix);
    assert.equal(prefixBefore.task.status, "completed");
    assert.equal(prefixBefore.agentReceipts.length, 1);
    assert.equal(prefixBefore.authorityCosts.length, 1);
    assert.equal(prefixBefore.sources.length, 1);
    assert.equal(prefixBefore.evidence.length, 1);
    const suffix = subject.assignments[2];
    const suffixBefore = assignmentActivitySnapshot(subject, suffix);
    assert.equal(suffixBefore.task.status, "blocked");
    assert.equal(suffixBefore.attempts.length, 0);
    const result = recover(subject);
    assert.equal(result.created, true);
    assert.deepEqual(
      assignmentActivitySnapshot(subject, subject.completedPrefix),
      prefixBefore,
      "terminal custody changed the legitimately completed authority prefix",
    );
    assertTerminalExecutionSealed(subject);
    const suffixAfter = assignmentActivitySnapshot(subject, suffix);
    assert.equal(suffixAfter.task.status, "cancelled");
    assert.equal(suffixAfter.task.outcome_status, "cancelled_by_terminal_authority_custody");
    assert.equal(suffixAfter.task.max_retries, 0);
    assert.equal(suffixAfter.attempts.length, 0);
    assert.equal(suffixAfter.modelCalls.length, 0);
    assert.equal(suffixAfter.agentRuns.length, 0);
    assert.equal(suffixAfter.agentReceipts.length, 0);
    assert.equal(suffixAfter.reservations.length, 0);
    assert.equal(suffixAfter.costs.length, 0);
    assert.equal(suffixAfter.authorityCosts.length, 0);
    assert.equal(suffixAfter.sources.length, 0);
    assert.equal(suffixAfter.evidence.length, 0);
    assert.equal(subject.store.verifyLedger().ok, true);
  } finally {
    subject.close();
  }
});

test("recovery accepts both terminal/artifact orders, late expiry retention, emergency claim loss, and malformed retained bodies", async (t) => {
  const cases = [
    ["artifact retained after expiry before the explicit expiry event", "expired_after_retention", {}],
    ["artifact retained before emergency claim loss", "emergency", {}],
    ["known result retained before emergency claim loss", "emergency", {
      knownProviderResultBeforeEmergency: true,
    }],
    ["unparseable known-effect body", "revoked", { malformed: true }],
    ["nullable provider request header identity", "revoked", { providerRequestId: null }],
  ];
  for (const [name, kind, options] of cases) {
    await t.test(name, () => {
      const subject = createScenario(kind, options);
      try {
        const beforeActivity = immutableActivitySnapshot(subject);
        const beforeAccounting = accountingSnapshot(subject);
        const result = recover(subject);
        assertSuccessfulRecovery(subject, result, beforeActivity, beforeAccounting);
        const row = rawRecovery(subject);
        if (options.malformed) {
          assert.equal(row.artifact_kind, "known_effect_invalid");
          assert.equal(row.provider_response_id, null);
          assert.equal(row.provider_response_hash, null);
        }
        if (options.providerRequestId === null) {
          assert.equal(row.provider_request_id, null);
        }
      } finally {
        subject.close();
      }
    });
  }
});

test("terminal custody appends one final receipt and binds it without erasing receipt history", async (t) => {
  await t.test("no receipt exists before recovery", () => {
    const subject = createScenario("revoked", { receipt: null });
    try {
      assert.equal(tableCount(subject.db, "agent_run_receipts"), 0);
      const beforeActivity = immutableActivitySnapshot(subject);
      const beforeAccounting = accountingSnapshot(subject);
      const result = recover(subject);
      assertSuccessfulRecovery(subject, result, beforeActivity, beforeAccounting);
      const receipt = subject.db.prepare(
        `SELECT * FROM agent_run_receipts
         WHERE attempt_id = ? ORDER BY sequence DESC LIMIT 1`,
      ).get(subject.execution.ids.attemptId);
      assert.ok(receipt);
      assert.equal(receipt.sequence, 1);
      assert.notEqual(receipt.status, "complete");
      assert.equal(rawRecovery(subject).agent_run_receipt_id, receipt.id);
      assert.equal(result.recovery.executionReceipt.id, receipt.id);
      assert.equal(result.recovery.executionReceipt.hash, `sha256:${receipt.receipt_hash}`);
      assert.equal(result.recovery.executionReceipt.status, receipt.status);
      assert.equal(result.recovery.executionReceipt.outcomeStatus, receipt.outcome_status);
    } finally {
      subject.close();
    }
  });
  await t.test("an earlier partial or unknown receipt remains immutable history", () => {
      const subject = createScenario("emergency", {
        beforeTerminal(fx, execution) {
          finalizeTerminalReceipt(fx, execution);
          fx.db.prepare(
            "UPDATE agent_runs SET output_summary = ? WHERE id = ?",
          ).run(
            "A later immutable pre-terminal snapshot must supersede the earlier receipt.",
            execution.runId,
          );
        },
      });
      try {
      const receipts = subject.db.prepare(
        `SELECT * FROM agent_run_receipts
         WHERE attempt_id = ? ORDER BY sequence, created_at, id`,
      ).all(subject.execution.ids.attemptId);
      assert.equal(receipts.length, 2);
      const [predecessor, receipt] = receipts;
      assert.ok(predecessor);
      assert.ok(receipt);
      assert.notEqual(receipt.id, predecessor.id);
      assert.equal(receipt.sequence, predecessor.sequence + 1);
      assert.notEqual(receipt.status, "complete");
      const beforeActivity = immutableActivitySnapshot(subject);
      const beforeAccounting = accountingSnapshot(subject);
      const result = recover(subject);
      assertSuccessfulRecovery(subject, result, beforeActivity, beforeAccounting);
      const latest = subject.db.prepare(
        `SELECT * FROM agent_run_receipts
         WHERE attempt_id = ? ORDER BY sequence DESC LIMIT 1`,
      ).get(subject.execution.ids.attemptId);
      const row = rawRecovery(subject);
      assert.ok(latest);
      assert.notEqual(latest.id, receipt.id);
      assert.equal(latest.sequence, receipt.sequence + 1);
      assert.notEqual(latest.status, "complete");
      assert.equal(Number(subject.db.prepare(
        "SELECT COUNT(*) AS count FROM agent_run_receipts WHERE attempt_id = ?",
      ).get(subject.execution.ids.attemptId).count), latest.sequence);
      assert.equal(
        subject.db.prepare("SELECT receipt_hash FROM agent_run_receipts WHERE id = ?").get(receipt.id)
          .receipt_hash,
        receipt.receipt_hash,
      );
      assert.equal(row.agent_run_receipt_id, latest.id);
      assert.equal(row.agent_run_receipt_hash, `sha256:${latest.receipt_hash}`);
      assert.equal(row.agent_run_receipt_status, latest.status);
      assert.equal(row.agent_run_receipt_outcome_status, latest.outcome_status);
      assert.equal(result.recovery.executionReceipt.id, latest.id);
      assert.equal(result.recovery.executionReceipt.status, latest.status);
      assert.equal(result.recovery.executionReceipt.outcomeStatus, latest.outcome_status);
    } finally {
      subject.close();
    }
  });
  await t.test("direct SQL cannot forge a terminal receipt before recovery", () => {
    const subject = createScenario("revoked");
    try {
      const predecessor = subject.db.prepare(
        `SELECT * FROM agent_run_receipts
         WHERE attempt_id = ? ORDER BY sequence DESC LIMIT 1`,
      ).get(subject.execution.ids.attemptId);
      assert.ok(predecessor);
      const forged = {
        ...predecessor,
        id: "receipt_forged_terminal_custody_direct",
        sequence: Number(predecessor.sequence) + 1,
        snapshot_hash: "a".repeat(64),
        previous_hash: predecessor.receipt_hash,
        receipt_hash: "b".repeat(64),
        receipt: JSON.stringify({ forgedTerminalCustodyReceipt: true }),
        created_at: subject.recoveryInput.recordedAt,
      };
      const before = tableSnapshot(subject.db);
      assert.throws(
        () => insertExactRow(subject.db, "agent_run_receipts", forged),
        exactSqliteError(
          "Terminal execution receipts require the exact one-shot custody capability.",
        ),
      );
      assert.deepEqual(tableSnapshot(subject.db), before);
    } finally {
      subject.close();
    }
  });
  await t.test("a forged receipt inserted behind the store path rolls back the whole recovery", () => {
    const subject = createScenario("revoked", { receipt: null });
    try {
      let tamperCount = 0;
      subject.db.function("pantheon_test_terminal_receipt_tamper_seen", () => {
        tamperCount += 1;
        return 1;
      });
      subject.db.exec(`
        CREATE TEMP TRIGGER terminal_custody_receipt_tamper
        AFTER INSERT ON main.agent_run_receipts
        WHEN NEW.attempt_id = '${subject.execution.ids.attemptId}'
          AND NEW.id <> 'receipt_forged_terminal_custody_store_path'
        BEGIN
          SELECT pantheon_test_terminal_receipt_tamper_seen();
          INSERT INTO agent_run_receipts (
            id, attempt_id, run_id, task_id, sequence, status, outcome_status,
            snapshot_hash, previous_hash, receipt_hash, missing_fields, warnings,
            receipt, created_at
          ) VALUES (
            'receipt_forged_terminal_custody_store_path', NEW.attempt_id, NEW.run_id,
            NEW.task_id, NEW.sequence + 1, 'needs_review', 'unknown',
            '${"c".repeat(64)}', NEW.receipt_hash, '${"d".repeat(64)}', '[]', '[]',
            '{"forgedTerminalCustodyReceipt":true}', NEW.created_at
          );
        END;
      `);
      const before = tableSnapshot(subject.db);
      assert.throws(
        () => recover(subject),
        exactSqliteError(
          "Terminal execution receipts require the exact one-shot custody capability.",
        ),
      );
      assert.equal(tamperCount, 1);
      subject.db.exec("DROP TRIGGER terminal_custody_receipt_tamper");
      assert.deepEqual(tableSnapshot(subject.db), before);
    } finally {
      try { subject.db.exec("DROP TRIGGER terminal_custody_receipt_tamper"); } catch {}
      subject.close();
    }
  });
});

test("exact recovery replay is idempotent and every caller-controlled binding conflicts", () => {
  const subject = createScenario("revoked");
  try {
    const first = recover(subject);
    const replay = recover(subject);
    assert.equal(replay.created, false);
    assert.deepEqual(replay.recovery, first.recovery);
    assert.deepEqual(replay.terminalState, first.terminalState);
    assert.equal(tableCount(subject.db, "preventure_research_terminal_recoveries"), 1);
    const laterReplayAt = addMilliseconds(subject.recoveryInput.recordedAt, 1);
    subject.setClock(laterReplayAt);
    const laterReplay = recover(subject, {
      ...clone(subject.recoveryInput),
      recordedAt: laterReplayAt,
    });
    assert.equal(laterReplay.created, false);
    assert.deepEqual(laterReplay.recovery, first.recovery);
    const after = tableSnapshot(subject.db);
    const wrongHash = sha256({ changed: true });
    const other = subject.assignments[1];
    const cases = [
      ["assignment argument", other.assignmentHash, {}, "preventure_research_terminal_recovery_binding_changed"],
      ["authorityHash", subject.assignment.assignmentHash, { authorityHash: wrongHash }, "preventure_research_terminal_recovery_binding_changed"],
      ["taskId", subject.assignment.assignmentHash, { taskId: other.taskId }, "preventure_research_terminal_recovery_binding_changed"],
      ["taskAttemptId", subject.assignment.assignmentHash, { taskAttemptId: "changed_attempt" }, "preventure_research_terminal_recovery_conflict"],
      ["modelCallId", subject.assignment.assignmentHash, { modelCallId: "changed_model" }, "preventure_research_terminal_recovery_artifact_changed"],
      ["claimToken", subject.assignment.assignmentHash, { claimToken: "changed_claim_token" }, "preventure_research_terminal_recovery_conflict"],
      ["clientRequestId", subject.assignment.assignmentHash, { clientRequestId: "changed_client" }, "preventure_research_terminal_recovery_artifact_changed"],
      ["descriptorHash", subject.assignment.assignmentHash, { descriptorHash: wrongHash }, "preventure_research_terminal_recovery_artifact_missing"],
      ["requestBodyHash", subject.assignment.assignmentHash, { requestBodyHash: wrongHash }, "preventure_research_terminal_recovery_artifact_changed"],
      ["providerRequestId", subject.assignment.assignmentHash, { providerRequestId: "changed_request" }, "preventure_research_terminal_recovery_artifact_changed"],
      ["providerResponseId", subject.assignment.assignmentHash, { providerResponseId: "resp_changed" }, "preventure_research_terminal_recovery_artifact_changed"],
      ["retainedOutputRef", subject.assignment.assignmentHash, {
        retainedOutputRef: `preventure-output:${"0".repeat(64)}`,
      }, "preventure_research_terminal_recovery_artifact_missing"],
      ["unexpected caller assertion", subject.assignment.assignmentHash, {
        noAdditionalAiCostAudCents: 0,
      }, "preventure_research_terminal_recovery_invalid"],
    ];
    for (const [label, assignmentHash, changes, expectedCode] of cases) {
      const input = { ...clone(subject.recoveryInput), ...changes };
      assert.throws(
        () => recover(subject, input, assignmentHash),
        exactStoreError(expectedCode),
        label,
      );
      assert.deepEqual(tableSnapshot(subject.db), after, label);
    }
    const omitted = clone(subject.recoveryInput);
    delete omitted.claimToken;
    assert.throws(
      () => recover(subject, omitted),
      exactStoreError("preventure_research_terminal_recovery_invalid"),
      "missing exact key",
    );
    assert.deepEqual(tableSnapshot(subject.db), after);
  } finally {
    subject.close();
  }
});

test("recovery rows and their terminal event are immutable and direct SQL cannot use the admission seam", async (t) => {
  await t.test("immutable recovery and emergency event", () => {
    const subject = createScenario("emergency");
    try {
      const result = recover(subject);
      const after = tableSnapshot(subject.db);
      assert.throws(() => subject.db.prepare(
        "UPDATE preventure_research_terminal_recoveries SET recorded_at = recorded_at WHERE recovery_hash = ?",
      ).run(result.recovery.recoveryHash), exactSqliteError(
        "Terminal retained-output recovery records are immutable.",
      ));
      assert.throws(() => subject.db.prepare(
        "DELETE FROM preventure_research_terminal_recoveries WHERE recovery_hash = ?",
      ).run(result.recovery.recoveryHash), exactSqliteError(
        "Terminal retained-output recovery records are immutable.",
      ));
      assert.throws(() => subject.db.prepare(
        "UPDATE events SET message = message WHERE id = ?",
      ).run(Number(subject.terminal.terminalBinding.eventId)), exactSqliteError(
        "A referenced emergency-stop event is immutable.",
      ));
      assert.throws(() => subject.db.prepare(
        "DELETE FROM events WHERE id = ?",
      ).run(Number(subject.terminal.terminalBinding.eventId)), exactSqliteError(
        "A referenced emergency-stop event is immutable.",
      ));
      for (const [label, sql, id, message] of [
        ["task", "UPDATE tasks SET status = status WHERE id = ?", subject.assignment.taskId,
          "Terminal custody freezes every assignment task in its authority."],
        ["attempt", "UPDATE task_attempts SET status = status WHERE id = ?", subject.execution.ids.attemptId,
          "Terminal retained-output custody freezes later execution and cost projections."],
        ["model call", "UPDATE model_calls SET status = status WHERE id = ?", subject.execution.ids.modelCallId,
          "Terminal retained-output custody freezes later execution and cost projections."],
        ["agent run", "UPDATE agent_runs SET status = status WHERE id = ?", subject.execution.runId,
          "Terminal retained-output custody freezes later execution and cost projections."],
        ["tool invocation", "UPDATE agent_tool_invocations SET status = status WHERE id = ?", subject.execution.ids.toolInvocationId,
          "Terminal retained-output custody freezes later execution and cost projections."],
        ["workflow", "UPDATE workflows SET status = status WHERE id = ?", subject.assignment.workflowId,
          "Terminal custody freezes every assignment workflow in its authority."],
      ]) {
        assert.throws(
          () => subject.db.prepare(sql).run(id),
          exactSqliteError(message),
          `${label} accepted activity after terminal custody`,
        );
      }
      const sibling = subject.assignments[1];
      assert.throws(() => subject.db.prepare(
        `INSERT INTO budget_reservations
         (id, venture_id, workflow_id, task_id, approval_id, status,
          amount_cents, currency, reserved_at, resolved_at, metadata)
         VALUES ('forged_terminal_sibling_reservation', NULL, ?, ?, NULL,
                 'reserved', 1, 'AUD', ?, NULL, '{}')`,
      ).run(
        sibling.workflowId,
        sibling.taskId,
        addMilliseconds(subject.recoveryInput.recordedAt, 1),
      ), exactSqliteError(
        "Terminal retained-output custody cannot acquire later execution or cost activity.",
      ));
      assert.deepEqual(tableSnapshot(subject.db), after);
    } finally {
      subject.close();
    }
  });

  await t.test("otherwise exact direct SQL insert", () => {
    const fx = createTerminalRecoveryFixture();
    let subject;
    try {
      const execution = prepareDispatchedExecution(fx, { dispatchedAt: BASE_DISPATCHED_AT });
      subject = { ...fx, assignment: execution.assignment, execution };
      const unknownHead = primeUnknownCostHead(subject);
      const terminal = revokeAuthority(
        fx,
        execution,
        addMilliseconds(unknownHead.occurredAt, 1_000),
      );
      const artifact = retainProviderArtifact(fx, execution, {
        retainedAt: addMilliseconds(unknownHead.occurredAt, 2_000),
      });
      subject.kind = "revoked";
      subject.terminal = terminal;
      subject.artifact = artifact;
      subject.recoveryInput = buildRecoveryInput(fx, execution, terminal, artifact, {
        recoveredAt: addMilliseconds(unknownHead.occurredAt, 3_000),
      });
      const before = tableSnapshot(subject.db);
      subject.db.exec("BEGIN IMMEDIATE");
      let exactRow;
      let exactTerminalCost;
      try {
        recover(subject);
        exactRow = rawRecovery(subject);
        exactTerminalCost = subject.db.prepare(
          "SELECT * FROM preventure_research_cost_events WHERE receipt_hash = ?",
        ).get(exactRow.terminal_cost_receipt_hash);
      } finally {
        subject.db.exec("ROLLBACK");
      }
      assert.ok(exactRow);
      assert.ok(exactTerminalCost);
      assert.equal(exactRow.prior_cost_receipt_hash, unknownHead.receiptHash);
      assert.equal(exactTerminalCost.previous_receipt_hash, unknownHead.receiptHash);
      assert.deepEqual(tableSnapshot(subject.db), before);
      assert.throws(() => insertExactRow(
        subject.db,
        "preventure_research_cost_events",
        exactTerminalCost,
      ), exactSqliteError(
        "Terminal pre-venture cost truth only accepts its exact custody-bound unknown successor.",
      ));
      assert.throws(() => insertExactRow(
        subject.db,
        "preventure_research_terminal_recoveries",
        exactRow,
      ), exactSqliteError(
        "Terminal retained-output recovery must match exact dispatch, terminal, artifact, and unknown cost truth.",
      ));
      assert.deepEqual(tableSnapshot(subject.db), before);
    } finally {
      fx.close();
    }
  });

  await t.test("post-commit artifact tamper makes the bound ledger fail closed", () => {
    const subject = createScenario("revoked");
    try {
      recover(subject);
      const before = tableSnapshot(subject.db);
      tamperRetainedManifest(subject);
      assert.throws(
        () => subject.store.readLedger(authority.authorityHash),
        exactStoreError("preventure_research_terminal_recovery_artifact_missing"),
      );
      assert.deepEqual(tableSnapshot(subject.db), before);
    } finally {
      subject.close();
    }
  });

  await t.test("ordinary store construction cannot opt out of retained-artifact verification", () => {
    const subject = createScenario("revoked");
    try {
      recover(subject);
      const bypassAttempt = createPreventureResearchStore(subject.db, {
        clock: subject.clock,
        authorityRegistry: historicalV1TestRegistry,
        allowUnresolvedTerminalRecoveries: true,
      });
      assert.throws(
        () => bypassAttempt.readLedger(authority.authorityHash),
        exactStoreError("preventure_research_terminal_recovery_resolver_required"),
      );
      assert.equal(subject.store.verifyLedger().ok, true);
    } finally {
      subject.close();
    }
  });
});

test("terminal custody freezes direct and indirectly bound execution children", async (t) => {
  const cases = [
    {
      name: "trace insert",
      expectedMessage: "Terminal retained-output custody freezes indirectly bound execution evidence.",
      setup: () => createBoundChildrenScenario(),
      mutate(subject) {
        subject.db.prepare(
          `INSERT INTO agent_trace_events
           (id, run_id, sequence, type, title, detail, metadata, ts)
           VALUES ('forged_terminal_trace_insert', ?, 999, 'forged',
                   'forged', '', '{}', ?)`,
        ).run(subject.execution.runId, subject.recoveryInput.recordedAt);
      },
    },
    {
      name: "trace update",
      expectedMessage: "Terminal retained-output custody freezes indirectly bound execution evidence.",
      setup: () => createBoundChildrenScenario({ productionRunIdentity: true }),
      mutate(subject) {
        const trace = subject.db.prepare(
          "SELECT id FROM agent_trace_events WHERE run_id = ? ORDER BY sequence LIMIT 1",
        ).get(subject.execution.runId);
        assert.ok(trace);
        subject.db.prepare("UPDATE agent_trace_events SET title = 'forged' WHERE id = ?")
          .run(trace.id);
      },
    },
    {
      name: "trace delete",
      expectedMessage: "Terminal retained-output custody freezes indirectly bound execution evidence.",
      setup: () => createBoundChildrenScenario({ productionRunIdentity: true }),
      mutate(subject) {
        const trace = subject.db.prepare(
          "SELECT id FROM agent_trace_events WHERE run_id = ? ORDER BY sequence LIMIT 1",
        ).get(subject.execution.runId);
        assert.ok(trace);
        subject.db.prepare("DELETE FROM agent_trace_events WHERE id = ?").run(trace.id);
      },
    },
    {
      name: "research source insert",
      expectedMessage: "Terminal retained-output custody freezes indirectly bound execution evidence.",
      setup: () => createBoundChildrenScenario(),
      mutate(subject, childIds) {
        subject.db.prepare(
          `INSERT INTO research_sources
           (id, run_id, title, url, publisher, published_at, retrieved_at,
            relevance, confidence, metadata)
           VALUES ('forged_terminal_source_insert', ?, 'forged', NULL, NULL, NULL,
                   ?, '', 'unknown', '{}')`,
        ).run(childIds.researchRunId, subject.recoveryInput.recordedAt);
      },
    },
    {
      name: "research source update",
      expectedMessage: "Terminal retained-output custody freezes indirectly bound execution evidence.",
      setup: () => createBoundChildrenScenario(),
      mutate(subject, childIds) {
        subject.db.prepare("UPDATE research_sources SET title = 'forged' WHERE id = ?")
          .run(childIds.researchSourceId);
      },
    },
    {
      name: "research source delete",
      expectedMessage: "Terminal retained-output custody freezes indirectly bound execution evidence.",
      setup: () => createBoundChildrenScenario({ provenance: false }),
      mutate(subject, childIds) {
        subject.db.prepare("DELETE FROM research_sources WHERE id = ?")
          .run(childIds.researchSourceId);
      },
    },
    {
      name: "pilot review insert",
      expectedMessage: "Terminal retained-output custody freezes indirectly bound execution evidence.",
      setup: () => createBoundChildrenScenario(),
      mutate(subject) {
        const venture = subject.db.prepare("SELECT id FROM ventures ORDER BY id LIMIT 1").get();
        const fixtureId = "forged_terminal_pilot_fixture";
        subject.db.prepare(
          `INSERT INTO agent_pilot_fixtures
           (id, venture_id, candidate_id, captured_at, question, buyer, hypothesis,
            sources, constraints, fixture_hash, status, created_at)
           VALUES (?, ?, NULL, ?, 'forged', 'forged', 'forged', '[]', '{}', ?, 'ready', ?)`,
        ).run(
          fixtureId,
          venture.id,
          subject.recoveryInput.recordedAt,
          sha256({ fixtureId }),
          subject.recoveryInput.recordedAt,
        );
        subject.db.prepare(
          `INSERT INTO agent_pilot_reviews
           (id, run_id, fixture_id, capability_key, deterministic_status,
            operator_verdict, usefulness_score, note, criteria, created_at, reviewed_at)
           VALUES ('forged_terminal_pilot_review', ?, ?, 'forged', 'forged',
                   'pending', NULL, '', '{}', ?, NULL)`,
        ).run(subject.execution.runId, fixtureId, subject.recoveryInput.recordedAt);
      },
    },
    {
      name: "pilot review update",
      expectedMessage: "Terminal retained-output custody freezes indirectly bound execution evidence.",
      setup: () => createBoundChildrenScenario({ pilotReview: true }),
      mutate(subject, childIds) {
        subject.db.prepare("UPDATE agent_pilot_reviews SET note = 'forged' WHERE id = ?")
          .run(childIds.pilotReviewId);
      },
    },
    {
      name: "pilot review delete",
      expectedMessage: "Terminal retained-output custody freezes indirectly bound execution evidence.",
      setup: () => createBoundChildrenScenario({ pilotReview: true }),
      mutate(subject, childIds) {
        subject.db.prepare("DELETE FROM agent_pilot_reviews WHERE id = ?")
          .run(childIds.pilotReviewId);
      },
    },
    {
      name: "tool invocation delete",
      expectedMessage: "Terminal retained-output custody freezes later execution and cost projections.",
      setup() {
        return { subject: createScenario("revoked", { receipt: null }), childIds: {} };
      },
      mutate(subject) {
        subject.db.prepare("DELETE FROM agent_tool_invocations WHERE id = ?")
          .run(subject.execution.ids.toolInvocationId);
      },
    },
    {
      name: "evaluation delete",
      expectedMessage: "Terminal retained-output custody freezes later execution and cost projections.",
      setup: () => createBoundChildrenScenario(),
      mutate(subject, childIds) {
        subject.db.prepare("DELETE FROM agent_eval_results WHERE id = ?")
          .run(childIds.evaluationId);
      },
    },
  ];
  for (const scenario of cases) {
    await t.test(scenario.name, () => {
      const { subject, childIds } = scenario.setup();
      try {
        recover(subject);
        const before = tableSnapshot(subject.db);
        const failure = directMutationFailure(
          subject.db,
          () => scenario.mutate(subject, childIds),
        );
        assert.ok(
          exactSqliteError(scenario.expectedMessage)(failure),
          `${scenario.name} escaped terminal custody or failed for an unrelated reason`,
        );
        assert.deepEqual(tableSnapshot(subject.db), before);
        assert.equal(subject.store.verifyLedger().ok, true);
      } finally {
        subject.close();
      }
    });
  }
});

test("missing or changed artifact proof, invalid dispatch timing, identity drift, and non-zero recovery work roll back", async (t) => {
  const cases = [
    ["missing artifact", "preventure_research_terminal_recovery_artifact_missing", () => ({
      retainedOutputRef: `preventure-output:${"f".repeat(64)}`,
    })],
    ["wrong authority", "preventure_research_terminal_recovery_binding_changed", () => ({ authorityHash: sha256("wrong-authority") })],
    ["wrong task", "preventure_research_terminal_recovery_binding_changed", () => ({ taskId: "wrong_task" })],
    ["wrong attempt", "preventure_research_terminal_recovery_dispatch_changed", () => ({ taskAttemptId: "wrong_attempt" })],
    ["wrong model", "preventure_research_terminal_recovery_artifact_changed", () => ({ modelCallId: "wrong_model" })],
    ["wrong client identity", "preventure_research_terminal_recovery_artifact_changed", () => ({ clientRequestId: "wrong_client" })],
    ["wrong claim", "preventure_research_terminal_recovery_dispatch_changed", () => ({ claimToken: "wrong_claim_token" })],
    ["wrong descriptor", "preventure_research_terminal_recovery_artifact_missing", () => ({ descriptorHash: sha256("wrong-descriptor") })],
    ["wrong request body", "preventure_research_terminal_recovery_artifact_changed", () => ({ requestBodyHash: sha256("wrong-request-body") })],
    ["wrong header request", "preventure_research_terminal_recovery_artifact_changed", () => ({ providerRequestId: "wrong_header_request" })],
    ["wrong body response", "preventure_research_terminal_recovery_artifact_changed", () => ({ providerResponseId: "resp_wrong_body" })],
    ["new AI cost assertion", "preventure_research_terminal_recovery_invalid", () => ({ noAdditionalAiCostAudCents: 1 })],
  ];
  for (const [name, expectedCode, mutate] of cases) {
    await t.test(name, () => {
      const subject = createScenario("revoked");
      try {
        assertRecoverySeam(subject);
        const before = tableSnapshot(subject.db);
        assert.throws(
          () => recover(subject, {
            ...clone(subject.recoveryInput),
            ...mutate(subject),
          }),
          exactStoreError(expectedCode),
        );
        assert.deepEqual(tableSnapshot(subject.db), before);
      } finally {
        subject.close();
      }
    });
  }

  await t.test("provider dispatch marker is missing", () => {
    const subject = createScenario("revoked");
    try {
      assertRecoverySeam(subject);
      subject.db.prepare(
        `UPDATE task_attempts
         SET provider_dispatched_at = NULL, provider_dispatch_model_call_id = NULL
         WHERE id = ?`,
      ).run(subject.execution.ids.attemptId);
      const before = tableSnapshot(subject.db);
      assert.throws(
        () => recover(subject),
        exactStoreError("preventure_research_terminal_recovery_dispatch_changed"),
      );
      assert.deepEqual(tableSnapshot(subject.db), before);
    } finally {
      subject.close();
    }
  });

  await t.test("provider dispatch is recorded after the terminal boundary", () => {
    const subject = createScenario("revoked");
    try {
      assertRecoverySeam(subject);
      const afterTerminal = addMilliseconds(subject.terminal.terminalAt, 1);
      subject.db.prepare(
        "UPDATE task_attempts SET provider_dispatched_at = ? WHERE id = ?",
      ).run(afterTerminal, subject.execution.ids.attemptId);
      const before = tableSnapshot(subject.db);
      assert.throws(
        () => recover(subject),
        exactStoreError("preventure_research_terminal_recovery_time_changed"),
      );
      assert.deepEqual(tableSnapshot(subject.db), before);
    } finally {
      subject.close();
    }
  });

  await t.test("generic cost points at a different valid model call", () => {
    const fx = createTerminalRecoveryFixture();
    try {
      const execution = prepareDispatchedExecution(fx, { dispatchedAt: BASE_DISPATCHED_AT });
      const originalModel = fx.db.prepare(
        "SELECT * FROM model_calls WHERE id = ?",
      ).get(execution.ids.modelCallId);
      const conflictingModel = {
        ...originalModel,
        id: `${execution.ids.modelCallId}_conflict`,
      };
      insertExactRow(fx.db, "model_calls", conflictingModel);
      fx.db.prepare(
        `UPDATE costs
         SET model_call_id = ?, status = 'unknown', amount_cents = ?
         WHERE id = ?`,
      ).run(
        conflictingModel.id,
        execution.assignment.maxCostAudCents,
        execution.ids.costId,
      );
      fx.db.prepare(
        `UPDATE budget_reservations
         SET status = 'unknown', amount_cents = ? WHERE id = ?`,
      ).run(execution.assignment.maxCostAudCents, execution.ids.reservationId);
      const conflictingCostAt = fx.setClock(addMilliseconds(execution.dispatchedAt, 100));
      fx.store.appendCostEvent(execution.assignment.assignmentHash, {
        eventType: "unknown",
        amountAudCents: null,
        exposureAudCents: execution.assignment.maxCostAudCents,
        costKey: execution.ids.costKey,
        taskAttemptId: execution.ids.attemptId,
        modelCallId: conflictingModel.id,
        budgetReservationId: execution.ids.reservationId,
        costId: execution.ids.costId,
        agentRunReceiptId: null,
        occurredAt: conflictingCostAt,
      });
      const expiryAt = new Date(Date.parse(authority.expiresAt)).toISOString();
      const artifact = retainProviderArtifact(fx, execution, {
        retainedAt: addMilliseconds(expiryAt, 1),
      });
      const effectiveExpiry = {
        terminalAt: authority.expiresAt,
        observedAt: addMilliseconds(expiryAt, 1),
      };
      const recoveryInput = buildRecoveryInput(fx, execution, effectiveExpiry, artifact, {
        recoveredAt: addMilliseconds(expiryAt, 2),
      });
      const subject = {
        ...fx,
        artifact,
        assignment: execution.assignment,
        execution,
        kind: "expired",
        recoveryInput,
        terminal: effectiveExpiry,
      };
      const before = tableSnapshot(fx.db);
      assert.throws(
        () => recover(subject),
        exactStoreError("preventure_research_terminal_recovery_cost_changed"),
      );
      assert.deepEqual(tableSnapshot(fx.db), before);
    } finally {
      fx.close();
    }
  });

  await t.test("authority has no terminal event", () => {
    const fx = createTerminalRecoveryFixture();
    try {
      const execution = prepareDispatchedExecution(fx);
      const artifact = retainProviderArtifact(fx, execution, {
        retainedAt: addMilliseconds(execution.dispatchedAt, 1_000),
      });
      const active = execution.activation;
      const recoveryInput = buildRecoveryInput(fx, execution, {
        terminalAt: active.occurredAt,
        terminalBinding: {
          kind: "lifecycle",
          eventId: active.id,
          eventHash: active.eventHash,
          eventType: active.eventType,
        },
      }, artifact, { recoveredAt: addMilliseconds(execution.dispatchedAt, 2_000) });
      const subject = { ...fx, assignment: execution.assignment, execution, artifact, recoveryInput };
      assertRecoverySeam(subject);
      const before = tableSnapshot(fx.db);
      assert.throws(
        () => recover(subject),
        exactStoreError("preventure_research_terminal_recovery_not_terminal"),
      );
      assert.deepEqual(tableSnapshot(fx.db), before);
    } finally {
      fx.close();
    }
  });

  await t.test("immutable artifact content was changed on disk", () => {
    const subject = createScenario("revoked");
    try {
      assertRecoverySeam(subject);
      tamperRetainedManifest(subject);
      const before = tableSnapshot(subject.db);
      assert.throws(
        () => recover(subject),
        exactStoreError("preventure_research_terminal_recovery_artifact_missing"),
      );
      assert.deepEqual(tableSnapshot(subject.db), before);
    } finally {
      subject.close();
    }
  });
});

test("projection, successor, recovery insert, and artifact re-verification faults roll the entire custody transaction back", async (t) => {
  const scenarios = [
    {
      name: "unknown cost successor insert",
      trigger: `
        CREATE TEMP TRIGGER preventure_terminal_recovery_cost_fault
        BEFORE INSERT ON main.preventure_research_cost_events
        WHEN NEW.event_type = 'unknown'
        BEGIN
          SELECT RAISE(ABORT, 'forced terminal recovery cost fault');
        END;
      `,
      drop: "DROP TRIGGER preventure_terminal_recovery_cost_fault",
    },
    {
      name: "accounting projection update",
      trigger: `
        CREATE TEMP TRIGGER preventure_terminal_recovery_projection_fault
        BEFORE UPDATE ON main.budget_reservations
        BEGIN
          SELECT RAISE(ABORT, 'forced terminal recovery projection fault');
        END;
      `,
      drop: "DROP TRIGGER preventure_terminal_recovery_projection_fault",
    },
    {
      name: "recovery insert",
      trigger: `
        CREATE TEMP TRIGGER preventure_terminal_recovery_insert_fault
        BEFORE INSERT ON main.preventure_research_terminal_recoveries
        BEGIN
          SELECT RAISE(ABORT, 'forced terminal recovery insert fault');
        END;
      `,
      drop: "DROP TRIGGER preventure_terminal_recovery_insert_fault",
    },
  ];
  for (const scenario of scenarios) {
    await t.test(scenario.name, () => {
      const subject = createScenario("revoked");
      try {
        assertRecoverySeam(subject);
        const before = tableSnapshot(subject.db);
        subject.db.exec(scenario.trigger);
        assert.throws(
          () => recover(subject),
          exactSqliteError(scenario.name === "unknown cost successor insert"
            ? "forced terminal recovery cost fault"
            : scenario.name === "accounting projection update"
              ? "forced terminal recovery projection fault"
              : "forced terminal recovery insert fault"),
        );
        subject.db.exec(scenario.drop);
        assert.deepEqual(tableSnapshot(subject.db), before);
        assert.equal(subject.store.verifyLedger().ok, true);
      } finally {
        subject.close();
      }
    });
  }

  await t.test("artifact resolver fails before admission", () => {
    const subject = createScenario("revoked", {
      fixtureOptions: {
        wrapRetainedOutputStore(outputStore) {
          return Object.freeze({
            kind: outputStore.kind,
            retain: outputStore.retain,
            status: outputStore.status,
            load() {
              throw new Error("forced immutable artifact resolver failure");
            },
          });
        },
      },
    });
    try {
      assertRecoverySeam(subject);
      const before = tableSnapshot(subject.db);
      assert.throws(
        () => recover(subject),
        exactStoreError("preventure_research_terminal_recovery_artifact_missing"),
      );
      assert.deepEqual(tableSnapshot(subject.db), before);
    } finally {
      subject.close();
    }
  });

  await t.test("artifact re-verification fails after the pending database writes", () => {
    let loadCount = 0;
    const subject = createScenario("revoked", {
      fixtureOptions: {
        wrapRetainedOutputStore(outputStore) {
          return Object.freeze({
            kind: outputStore.kind,
            load(reference) {
              loadCount += 1;
              if (loadCount === 2) {
                throw new Error("forced final immutable artifact re-verification failure");
              }
              return outputStore.load(reference);
            },
          });
        },
      },
    });
    try {
      assertRecoverySeam(subject);
      const before = tableSnapshot(subject.db);
      assert.throws(
        () => recover(subject),
        exactStoreError("preventure_research_terminal_recovery_artifact_missing"),
      );
      assert.equal(loadCount, 2);
      assert.deepEqual(tableSnapshot(subject.db), before);
    } finally {
      subject.close();
    }
  });
});

test("custody refuses drifted accounting projections instead of overwriting the immutable predecessor truth", async (t) => {
  const cases = [
    {
      name: "reservation status and amount",
      mutate(fx, execution) {
        fx.db.prepare(
          `UPDATE budget_reservations
           SET status = 'released', amount_cents = 0, resolved_at = ?
           WHERE id = ?`,
        ).run(execution.dispatchedAt, execution.ids.reservationId);
      },
    },
    {
      name: "reservation status only",
      mutate(fx, execution) {
        fx.db.prepare(
          "UPDATE budget_reservations SET status = 'released' WHERE id = ?",
        ).run(execution.ids.reservationId);
      },
    },
    {
      name: "reservation amount only",
      mutate(fx, execution) {
        fx.db.prepare(
          "UPDATE budget_reservations SET amount_cents = amount_cents - 1 WHERE id = ?",
        ).run(execution.ids.reservationId);
      },
    },
    {
      name: "reservation authority metadata",
      mutate(fx, execution) {
        fx.db.prepare(
          "UPDATE budget_reservations SET metadata = '{}' WHERE id = ?",
        ).run(execution.ids.reservationId);
      },
    },
    {
      name: "reservation resolved time only",
      mutate(fx, execution) {
        fx.db.prepare(
          "UPDATE budget_reservations SET resolved_at = ? WHERE id = ?",
        ).run(execution.dispatchedAt, execution.ids.reservationId);
      },
    },
    {
      name: "reservation exposure metadata only",
      mutate(fx, execution) {
        fx.db.prepare(
          `UPDATE budget_reservations
           SET metadata = json_set(metadata, '$.exposureAudCents', 0)
           WHERE id = ?`,
        ).run(execution.ids.reservationId);
      },
    },
    {
      name: "generic cost status and amount",
      mutate(fx, execution) {
        fx.db.prepare(
          `UPDATE costs SET status = 'released', amount_cents = 0 WHERE id = ?`,
        ).run(execution.ids.costId);
      },
    },
    {
      name: "generic cost status only",
      mutate(fx, execution) {
        fx.db.prepare(
          "UPDATE costs SET status = 'released' WHERE id = ?",
        ).run(execution.ids.costId);
      },
    },
    {
      name: "generic cost amount only",
      mutate(fx, execution) {
        fx.db.prepare(
          "UPDATE costs SET amount_cents = amount_cents - 1 WHERE id = ?",
        ).run(execution.ids.costId);
      },
    },
    {
      name: "generic cost authority metadata",
      mutate(fx, execution) {
        fx.db.prepare(
          "UPDATE costs SET metadata = '{}' WHERE id = ?",
        ).run(execution.ids.costId);
      },
    },
    {
      name: "generic cost exposure metadata only",
      mutate(fx, execution) {
        fx.db.prepare(
          `UPDATE costs SET metadata = json_set(metadata, '$.exposureAudCents', 0)
           WHERE id = ?`,
        ).run(execution.ids.costId);
      },
    },
    {
      name: "model cost status and exposure",
      mutate(fx, execution) {
        fx.db.prepare(
          `UPDATE model_calls
           SET cost_status = 'released', reserved_cost_cents = 0,
               actual_cost_cents = 1, reconciled_cost_cents = 1
           WHERE id = ?`,
        ).run(execution.ids.modelCallId);
      },
    },
    {
      name: "model cost status only",
      mutate(fx, execution) {
        fx.db.prepare(
          "UPDATE model_calls SET cost_status = 'released' WHERE id = ?",
        ).run(execution.ids.modelCallId);
      },
    },
    {
      name: "model authority metadata",
      mutate(fx, execution) {
        fx.db.prepare(
          `UPDATE model_calls
           SET metadata = json_set(metadata, '$.authorityHash', ?)
           WHERE id = ?`,
        ).run(sha256("wrong-model-authority"), execution.ids.modelCallId);
      },
    },
    {
      name: "model reserved exposure only",
      mutate(fx, execution) {
        fx.db.prepare(
          "UPDATE model_calls SET reserved_cost_cents = reserved_cost_cents - 1 WHERE id = ?",
        ).run(execution.ids.modelCallId);
      },
    },
    {
      name: "model incurred estimate only",
      mutate(fx, execution) {
        fx.db.prepare(
          "UPDATE model_calls SET incurred_estimate_cents = 1 WHERE id = ?",
        ).run(execution.ids.modelCallId);
      },
    },
    {
      name: "model actual cost only",
      mutate(fx, execution) {
        fx.db.prepare(
          "UPDATE model_calls SET actual_cost_cents = 1 WHERE id = ?",
        ).run(execution.ids.modelCallId);
      },
    },
    {
      name: "model reconciled cost only",
      mutate(fx, execution) {
        fx.db.prepare(
          "UPDATE model_calls SET reconciled_cost_cents = 1 WHERE id = ?",
        ).run(execution.ids.modelCallId);
      },
    },
  ];
  for (const scenario of cases) {
    await t.test(scenario.name, () => {
      const subject = createEffectiveExpiryScenario({ mutate: scenario.mutate });
      try {
        const before = tableSnapshot(subject.db);
        assert.throws(
          () => recover(subject),
          (error) => error?.code === "preventure_research_terminal_recovery_cost_changed",
        );
        assert.deepEqual(tableSnapshot(subject.db), before);
      } finally {
        subject.close();
      }
    });
  }
});

test("custody rejects unrelated pre-existing execution closure instead of overwriting it", async (t) => {
  const cases = [
    {
      name: "task",
      mutate(subject) {
        subject.db.prepare(
          `UPDATE tasks SET status = 'failed', outcome_status = 'unknown',
             error = 'forged pre-custody task closure' WHERE id = ?`,
        ).run(subject.assignment.taskId);
      },
    },
    {
      name: "attempt",
      mutate(subject) {
        subject.db.prepare(
          `UPDATE task_attempts SET status = 'failed', outcome_status = 'unknown',
             error_kind = 'forged_pre_custody', completed_at = ? WHERE id = ?`,
        ).run(subject.recoveryInput.recordedAt, subject.execution.ids.attemptId);
      },
    },
    {
      name: "model call",
      mutate(subject) {
        subject.db.prepare(
          `UPDATE model_calls SET status = 'failed', outcome_status = 'unknown',
             error_kind = 'forged_pre_custody', completed_at = ? WHERE id = ?`,
        ).run(subject.recoveryInput.recordedAt, subject.execution.ids.modelCallId);
      },
    },
    {
      name: "agent run",
      mutate(subject) {
        subject.db.prepare(
          `UPDATE agent_runs SET status = 'failed',
             output_summary = 'forged pre-custody run closure', completed_at = ?
           WHERE id = ?`,
        ).run(subject.recoveryInput.recordedAt, subject.execution.runId);
      },
    },
    {
      name: "tool invocation",
      mutate(subject) {
        subject.db.prepare(
          `UPDATE agent_tool_invocations SET status = 'failed', decision = 'denied',
             output_summary = 'forged pre-custody tool closure', resolved_at = ?
           WHERE id = ?`,
        ).run(subject.recoveryInput.recordedAt, subject.execution.ids.toolInvocationId);
      },
    },
    {
      name: "workflow",
      mutate(subject) {
        subject.db.prepare(
          `UPDATE workflows SET status = 'failed', current_step = 'forged pre-custody closure'
           WHERE id = ?`,
        ).run(subject.assignment.workflowId);
      },
    },
  ];
  for (const scenario of cases) {
    await t.test(scenario.name, () => {
      const subject = createScenario("revoked", { receipt: null });
      try {
        scenario.mutate(subject);
        const before = tableSnapshot(subject.db);
        assert.throws(
          () => recover(subject),
          exactStoreError("preventure_research_terminal_recovery_execution_changed"),
        );
        assert.deepEqual(tableSnapshot(subject.db), before);
      } finally {
        subject.close();
      }
    });
  }
});

test("the one-shot custody transaction rejects contradictory execution closure projections", async (t) => {
  const cases = [
    {
      name: "task outcome",
      trigger: `
        CREATE TEMP TRIGGER terminal_custody_task_tamper
        AFTER UPDATE ON main.tasks
        WHEN NEW.status = 'needs_attention' AND NEW.outcome_status = 'known'
        BEGIN
          SELECT pantheon_test_terminal_custody_tamper_seen();
          UPDATE tasks SET outcome_status = 'unknown' WHERE id = NEW.id;
        END;
      `,
      drop: "DROP TRIGGER terminal_custody_task_tamper",
    },
    {
      name: "attempt outcome",
      trigger: `
        CREATE TEMP TRIGGER terminal_custody_attempt_tamper
        AFTER UPDATE ON main.task_attempts
        WHEN NEW.status = 'needs_attention' AND NEW.outcome_status = 'known'
        BEGIN
          SELECT pantheon_test_terminal_custody_tamper_seen();
          UPDATE task_attempts SET outcome_status = 'unknown' WHERE id = NEW.id;
        END;
      `,
      drop: "DROP TRIGGER terminal_custody_attempt_tamper",
    },
    {
      name: "model outcome",
      trigger: `
        CREATE TEMP TRIGGER terminal_custody_model_tamper
        AFTER UPDATE ON main.model_calls
        WHEN NEW.status = 'needs_attention' AND NEW.outcome_status = 'known'
          AND json_extract(NEW.metadata, '$.terminalRecovery.schema')
            = 'pantheon.preventure-research-terminal-cost-transition.v1'
        BEGIN
          SELECT pantheon_test_terminal_custody_tamper_seen();
          UPDATE model_calls SET outcome_status = 'unknown' WHERE id = NEW.id;
        END;
      `,
      drop: "DROP TRIGGER terminal_custody_model_tamper",
    },
    {
      name: "agent run status",
      trigger: `
        CREATE TEMP TRIGGER terminal_custody_agent_run_tamper
        AFTER UPDATE ON main.agent_runs
        WHEN NEW.status = 'needs_attention'
        BEGIN
          SELECT pantheon_test_terminal_custody_tamper_seen();
          UPDATE agent_runs SET status = 'failed' WHERE id = NEW.id;
        END;
      `,
      drop: "DROP TRIGGER terminal_custody_agent_run_tamper",
    },
    {
      name: "tool status",
      trigger: `
        CREATE TEMP TRIGGER terminal_custody_tool_tamper
        AFTER UPDATE ON main.agent_tool_invocations
        WHEN NEW.status = 'needs_attention'
        BEGIN
          SELECT pantheon_test_terminal_custody_tamper_seen();
          UPDATE agent_tool_invocations SET status = 'failed' WHERE id = NEW.id;
        END;
      `,
      drop: "DROP TRIGGER terminal_custody_tool_tamper",
    },
    {
      name: "workflow closure",
      trigger: `
        CREATE TEMP TRIGGER terminal_custody_workflow_tamper
        AFTER UPDATE ON main.workflows
        WHEN NEW.status = 'needs_attention'
          AND instr(NEW.current_step, '[forged]') = 0
        BEGIN
          SELECT pantheon_test_terminal_custody_tamper_seen();
          UPDATE workflows
          SET current_step = NEW.current_step || ' [forged]' WHERE id = NEW.id;
        END;
      `,
      drop: "DROP TRIGGER terminal_custody_workflow_tamper",
    },
  ];
  for (const scenario of cases) {
    await t.test(scenario.name, () => {
      const subject = createScenario("revoked", { receipt: null });
      try {
        let tamperCount = 0;
        subject.db.function("pantheon_test_terminal_custody_tamper_seen", () => {
          tamperCount += 1;
          return 1;
        });
        const before = tableSnapshot(subject.db);
        subject.db.exec(scenario.trigger);
        assert.throws(() => recover(subject), exactCustodyPostconditionError);
        assert.equal(tamperCount, 1, `${scenario.name} tamper trigger did not run exactly once`);
        subject.db.exec(scenario.drop);
        assert.deepEqual(tableSnapshot(subject.db), before);
      } finally {
        try { subject.db.exec(scenario.drop); } catch {}
        subject.close();
      }
    });
  }
});

test("emergency unknown projection exceptions require their exact stop markers and time", async (t) => {
  const wrongStoppedAt = addMilliseconds(BASE_DISPATCHED_AT, 500);
  const cases = [
    {
      name: "reservation stop marker missing",
      expectedMessage: "Terminal custody requires one exact unknown full-cap reservation projection.",
      mutate(fx, execution) {
        fx.db.prepare(
          `UPDATE budget_reservations
           SET status = 'unknown', resolved_at = NULL WHERE id = ?`,
        ).run(execution.ids.reservationId);
      },
    },
    {
      name: "reservation stop time changed",
      expectedMessage: "Terminal custody requires one exact unknown full-cap reservation projection.",
      mutate(fx, execution) {
        fx.db.prepare(
          `UPDATE budget_reservations
           SET status = 'unknown', resolved_at = NULL,
               metadata = json_patch(metadata, ?)
           WHERE id = ?`,
        ).run(JSON.stringify({
          emergencyStop: true,
          stoppedAt: wrongStoppedAt,
          providerOutcomeUnknown: true,
        }), execution.ids.reservationId);
      },
    },
    {
      name: "model stop marker missing",
      expectedMessage: "Terminal custody requires one exact unknown full-cap model projection.",
      mutate(fx, execution) {
        fx.db.prepare(
          `UPDATE model_calls
           SET status = 'needs_attention', outcome_status = 'unknown',
               completed_at = ?, cost_status = 'unknown',
               reserved_cost_cents = ?, actual_cost_cents = 0,
               reconciled_cost_cents = 0
           WHERE id = ?`,
        ).run(
          addMilliseconds(execution.dispatchedAt, 500),
          execution.assignment.maxCostAudCents,
          execution.ids.modelCallId,
        );
      },
    },
    {
      name: "model stop time changed",
      expectedMessage: "Terminal custody requires one exact unknown full-cap model projection.",
      mutate(fx, execution) {
        fx.db.prepare(
          `UPDATE model_calls
           SET status = 'needs_attention', outcome_status = 'unknown',
               completed_at = ?, cost_status = 'unknown',
               reserved_cost_cents = ?, actual_cost_cents = 0,
               reconciled_cost_cents = 0,
               metadata = json_patch(metadata, ?)
           WHERE id = ?`,
        ).run(
          addMilliseconds(execution.dispatchedAt, 500),
          execution.assignment.maxCostAudCents,
          JSON.stringify({
            emergencyStop: true,
            stoppedAt: wrongStoppedAt,
            providerOutcomeUnknown: true,
          }),
          execution.ids.modelCallId,
        );
      },
    },
  ];
  for (const scenario of cases) {
    await t.test(scenario.name, () => {
      const subject = createEmergencyProjectionScenario();
      try {
        const before = tableSnapshot(subject.db);
        assert.throws(
          () => scenario.mutate(subject, subject.execution),
          exactSqliteError(scenario.expectedMessage),
        );
        assert.deepEqual(tableSnapshot(subject.db), before);
      } finally {
        subject.close();
      }
    });
  }
});

test("post-custody generic and direct cost changes cannot release or reconcile the full unknown exposure", () => {
  const subject = createScenario("emergency");
  try {
    const result = recover(subject);
    const before = tableSnapshot(subject.db);
    const terminalCost = subject.store.readLedger(authority.authorityHash).costEvents.at(-1);
    subject.setClock(addMilliseconds(subject.recoveryInput.recordedAt, 1));
    for (const eventType of ["released", "reconciled", "unknown"]) {
      assert.throws(
        () => subject.store.appendCostEvent(subject.assignment.assignmentHash, {
          eventType,
          amountAudCents: eventType === "unknown" ? null : 0,
          exposureAudCents: eventType === "unknown" ? subject.assignment.maxCostAudCents : 0,
          costKey: terminalCost.costKey,
          taskAttemptId: subject.execution.ids.attemptId,
          modelCallId: subject.execution.ids.modelCallId,
          agentRunReceiptId: result.recovery.executionReceipt?.id || null,
          budgetReservationId: subject.execution.ids.reservationId,
          costId: subject.execution.ids.costId,
          occurredAt: addMilliseconds(subject.recoveryInput.recordedAt, 1),
        }),
        exactStoreError("preventure_research_execution_binding_invalid"),
        eventType,
      );
      assert.deepEqual(tableSnapshot(subject.db), before, eventType);
    }
    const forged = clone(terminalCost);
    forged.sequence += 1;
    forged.previousReceiptHash = terminalCost.receiptHash;
    forged.eventType = "released";
    forged.amountAudCents = 0;
    forged.exposureAudCents = 0;
    forged.occurredAt = addMilliseconds(subject.recoveryInput.recordedAt, 1);
    delete forged.receiptHash;
    forged.receiptHash = sha256(forged);
    const projection = {
      receipt_hash: forged.receiptHash,
      authority_hash: forged.authorityHash,
      assignment_hash: forged.assignmentHash,
      cost_key: forged.costKey,
      sequence: forged.sequence,
      previous_receipt_hash: forged.previousReceiptHash,
      event_type: forged.eventType,
      amount_aud_cents: forged.amountAudCents,
      exposure_aud_cents: forged.exposureAudCents,
      task_attempt_id: forged.taskAttemptId,
      model_call_id: forged.modelCallId,
      budget_reservation_id: forged.budgetReservationId,
      cost_id: forged.costId,
      agent_run_receipt_id: forged.agentRunReceiptId,
      cost_json: JSON.stringify(forged),
      occurred_at: forged.occurredAt,
      created_at: forged.occurredAt,
    };
    assert.throws(() => insertExactRow(
      subject.db,
      "preventure_research_cost_events",
      projection,
    ), exactSqliteError(
      "Terminal pre-venture cost truth only accepts its exact custody-bound unknown successor.",
    ));
    assert.deepEqual(tableSnapshot(subject.db), before);
    for (const eventType of ["released", "reconciled"]) {
      const omittedAttempt = {
        ...terminalCost,
        sequence: terminalCost.sequence + 1,
        previousReceiptHash: terminalCost.receiptHash,
        eventType,
        amountAudCents: 0,
        exposureAudCents: 0,
        taskAttemptId: null,
        modelCallId: null,
        agentRunReceiptId: null,
        occurredAt: addMilliseconds(subject.recoveryInput.recordedAt, 1),
      };
      delete omittedAttempt.receiptHash;
      omittedAttempt.receiptHash = sha256(omittedAttempt);
      assert.throws(() => insertExactRow(
        subject.db,
        "preventure_research_cost_events",
        {
          receipt_hash: omittedAttempt.receiptHash,
          authority_hash: omittedAttempt.authorityHash,
          assignment_hash: omittedAttempt.assignmentHash,
          cost_key: omittedAttempt.costKey,
          sequence: omittedAttempt.sequence,
          previous_receipt_hash: omittedAttempt.previousReceiptHash,
          event_type: omittedAttempt.eventType,
          amount_aud_cents: omittedAttempt.amountAudCents,
          exposure_aud_cents: omittedAttempt.exposureAudCents,
          task_attempt_id: null,
          model_call_id: null,
          budget_reservation_id: omittedAttempt.budgetReservationId,
          cost_id: omittedAttempt.costId,
          agent_run_receipt_id: null,
          cost_json: JSON.stringify(omittedAttempt),
          occurred_at: omittedAttempt.occurredAt,
          created_at: omittedAttempt.occurredAt,
        },
      ), exactSqliteError(
        "Terminal pre-venture cost truth only accepts its exact custody-bound unknown successor.",
      ), `${eventType} with omitted attempt`);
      assert.deepEqual(tableSnapshot(subject.db), before, eventType);
    }
    const row = rawRecovery(subject);
    assert.equal(row.recovery_hash, result.recovery.recoveryHash);
    assert.equal(row.exposure_aud_cents, subject.assignment.maxCostAudCents);
    assert.throws(
      () => subject.store.reconcileProviderCost(subject.assignment.assignmentHash, {}),
      (error) => error?.code === "preventure_research_owner_billing_observation_required",
      "ordinary reconciliation must not bypass the authenticated owner billing observation",
    );
    assert.equal(tableCount(subject.db, "preventure_research_decisions"), 0);
    assert.deepEqual(tableSnapshot(subject.db), before);
    assert.equal(subject.store.readState(authority.authorityHash).exactBillingPending, true);
  } finally {
    subject.close();
  }
});

test("effective expiry blocks late generic and direct cost truth before an expiry row is appended", async (t) => {
  await t.test("direct SQL released successor with no attempt binding", () => {
    const fx = createTerminalRecoveryFixture();
    try {
      const expiryAt = new Date(Date.parse(authority.expiresAt)).toISOString();
      const execution = prepareDispatchedExecution(fx, {
        dispatchedAt: addMilliseconds(expiryAt, -2_000),
      });
      fx.setClock(expiryAt);
      assert.equal(fx.store.loadLifecycle(authority.authorityHash).at(-1).eventType, "activated");
      const prior = JSON.parse(fx.db.prepare(
        `SELECT cost_json FROM preventure_research_cost_events
         WHERE assignment_hash = ? ORDER BY sequence DESC LIMIT 1`,
      ).get(execution.assignment.assignmentHash).cost_json);
      const successor = {
        ...prior,
        sequence: prior.sequence + 1,
        previousReceiptHash: prior.receiptHash,
        eventType: "released",
        amountAudCents: 0,
        exposureAudCents: 0,
        taskAttemptId: null,
        modelCallId: null,
        occurredAt: expiryAt,
      };
      delete successor.receiptHash;
      successor.receiptHash = sha256(successor);
      const before = tableSnapshot(fx.db);
      assert.throws(() => insertExactRow(
        fx.db,
        "preventure_research_cost_events",
        {
          receipt_hash: successor.receiptHash,
          authority_hash: successor.authorityHash,
          assignment_hash: successor.assignmentHash,
          cost_key: successor.costKey,
          sequence: successor.sequence,
          previous_receipt_hash: successor.previousReceiptHash,
          event_type: successor.eventType,
          amount_aud_cents: successor.amountAudCents,
          exposure_aud_cents: successor.exposureAudCents,
          task_attempt_id: null,
          model_call_id: null,
          budget_reservation_id: successor.budgetReservationId,
          cost_id: successor.costId,
          agent_run_receipt_id: null,
          cost_json: JSON.stringify(successor),
          occurred_at: successor.occurredAt,
          created_at: successor.occurredAt,
        },
      ), exactSqliteError(
        "Terminal pre-venture cost truth only accepts its exact custody-bound unknown successor.",
      ));
      assert.deepEqual(tableSnapshot(fx.db), before);
    } finally {
      fx.close();
    }
  });

  await t.test("generic released successor", () => {
    const fx = createTerminalRecoveryFixture();
    try {
      const expiryAt = new Date(Date.parse(authority.expiresAt)).toISOString();
      const execution = prepareDispatchedExecution(fx, {
        dispatchedAt: addMilliseconds(expiryAt, -2_000),
      });
      fx.db.prepare(
        `UPDATE budget_reservations
         SET status = 'released', amount_cents = 0, resolved_at = ? WHERE id = ?`,
      ).run(addMilliseconds(expiryAt, -1), execution.ids.reservationId);
      fx.db.prepare(
        `UPDATE costs SET model_call_id = ?, status = 'released', amount_cents = 0
         WHERE id = ?`,
      ).run(execution.ids.modelCallId, execution.ids.costId);
      fx.setClock(expiryAt);
      const before = tableSnapshot(fx.db);
      assert.throws(() => fx.store.appendCostEvent(execution.assignment.assignmentHash, {
        eventType: "released",
        amountAudCents: 0,
        exposureAudCents: 0,
        costKey: execution.ids.costKey,
        taskAttemptId: execution.ids.attemptId,
        modelCallId: execution.ids.modelCallId,
        budgetReservationId: execution.ids.reservationId,
        costId: execution.ids.costId,
        agentRunReceiptId: null,
        occurredAt: expiryAt,
      }));
      assert.deepEqual(tableSnapshot(fx.db), before);
    } finally {
      fx.close();
    }
  });
});

test("a later emergency event cannot replace the earliest durable terminal binding", () => {
  const fx = createTerminalRecoveryFixture();
  try {
    const execution = prepareDispatchedExecution(fx, { dispatchedAt: BASE_DISPATCHED_AT });
    const artifact = retainProviderArtifact(fx, execution, {
      retainedAt: addMilliseconds(BASE_DISPATCHED_AT, 1_000),
    });
    const revoked = revokeAuthority(
      fx,
      execution,
      addMilliseconds(BASE_DISPATCHED_AT, 2_000),
    );
    fx.setClock(addMilliseconds(BASE_DISPATCHED_AT, 3_000));
    emergencyStop(fx, execution);
    const recoveryInput = buildRecoveryInput(fx, execution, revoked, artifact, {
      receipt: null,
      recoveredAt: addMilliseconds(BASE_DISPATCHED_AT, 4_000),
    });
    const subject = {
      ...fx,
      artifact,
      assignment: execution.assignment,
      execution,
      kind: "revoked",
      recoveryInput,
      terminal: revoked,
    };
    assertRecoverySeam(subject);
    const beforeActivity = immutableActivitySnapshot(subject);
    const beforeAccounting = accountingSnapshot(subject);
    const result = recover(subject);
    assertSuccessfulRecovery(subject, result, beforeActivity, beforeAccounting);
  } finally {
    fx.close();
  }
});

test("effective expiry remains the canonical terminal when emergency custody is recorded later", () => {
  const fx = createTerminalRecoveryFixture();
  try {
    const expiryAt = new Date(Date.parse(authority.expiresAt)).toISOString();
    const execution = prepareDispatchedExecution(fx, {
      dispatchedAt: addMilliseconds(expiryAt, -2_000),
    });
    const artifact = retainProviderArtifact(fx, execution, {
      retainedAt: addMilliseconds(expiryAt, 1),
    });
    fx.setClock(addMilliseconds(expiryAt, 2));
    const laterEmergency = emergencyStop(fx, execution);
    assert.equal(Date.parse(laterEmergency.terminalAt) > Date.parse(expiryAt), true);
    const recoveryInput = buildRecoveryInput(fx, execution, {
      terminalAt: authority.expiresAt,
      observedAt: laterEmergency.terminalAt,
    }, artifact, {
      receipt: null,
      recoveredAt: addMilliseconds(laterEmergency.terminalAt, 1),
    });
    const subject = {
      ...fx,
      artifact,
      assignment: execution.assignment,
      execution,
      kind: "expired",
      recoveryInput,
    };
    const result = recover(subject);
    assert.equal(result.recovery.terminalBinding.kind, "lifecycle");
    assert.equal(result.recovery.terminalBinding.eventType, "expired");
    assert.equal(result.recovery.terminalBinding.terminalAt, authority.expiresAt);
    assert.notEqual(
      result.recovery.terminalBinding.eventHash,
      laterEmergency.terminalBinding.eventHash,
    );
    assert.equal(subject.store.readState(authority.authorityHash).state, "expired");
    assert.equal(subject.store.verifyLedger().ok, true);
  } finally {
    fx.close();
  }
});
