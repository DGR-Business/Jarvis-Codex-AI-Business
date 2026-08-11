"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const { openDatabase } = require("../src/db");
const {
  createPreventureResearchBridgeOutputStore,
  createPreventureResearchExecutionBridge,
} = require("../src/runtime/preventure-research-execution-bridge");
const {
  createPreventureResearchFinalizer,
} = require("../src/runtime/preventure-research-finalizer");
const { createMonotonicIsoClock } = require("../src/runtime/monotonic-iso-clock");
const {
  createPreventureResearchStore,
} = require("../src/runtime/preventure-research-store");
const {
  terminatePreventureResearchAuthority,
} = require("../src/runtime/preventure-research-authority");
const {
  addMilliseconds,
  authority,
  createTerminalRecoveryFixture,
  prepareDispatchedExecution,
  retainProviderArtifact,
} = require("./support/preventure-research-terminal-recovery-fixture");
const {
  historicalV1TestRegistry,
} = require("./support/preventure-research-test-registry");

function scalar(db, sql, parameters = []) {
  return Number(db.prepare(sql).get(...parameters).count);
}

function createBridgeRuntime(db, artifactRoot, clock) {
  const baseStore = createPreventureResearchStore(db, {
    clock,
    authorityRegistry: historicalV1TestRegistry,
  });
  const outputStore = createPreventureResearchBridgeOutputStore({
    store: baseStore,
    authority,
    outputArtifactRoot: artifactRoot,
  });
  const store = baseStore.withRetainedOutputStore(outputStore);
  const finalizer = createPreventureResearchFinalizer({
    db,
    store,
    authority,
    authorityRegistry: historicalV1TestRegistry,
    clock,
  });
  let providerCalls = 0;
  const bridge = createPreventureResearchExecutionBridge({
    db,
    store,
    outputStore,
    authority,
    authorityRegistry: historicalV1TestRegistry,
    finalizeDecision: finalizer,
    clock,
    allowTestOverrides: true,
    liveResearchEnabled: true,
    apiKey: "sk-test-custody-never-sent",
    fetchImpl: async () => {
      providerCalls += 1;
      throw new Error("Terminal custody must never contact the provider.");
    },
  });
  return { bridge, clock, outputStore, store, providerCalls: () => providerCalls };
}

function closeFixture(fx, reopenedDb = null) {
  try { reopenedDb?.close(); } catch {}
  try { fx.db.close(); } catch {}
  fs.rmSync(fx.dir, { recursive: true, force: true });
}

test("active crash discovery binds one retained response before any fresh dispatch", () => {
  const fx = createTerminalRecoveryFixture();
  const dbPath = path.join(fx.dir, "runtime.sqlite");
  const artifactRoot = path.join(fx.dir, "terminal-recovery-artifacts");
  let reopened = null;
  try {
    const dispatchedAt = "2026-08-02T06:30:00.000Z";
    const execution = prepareDispatchedExecution(fx, {
      dispatchedAt,
      productionRunIdentity: true,
    });
    const artifact = retainProviderArtifact(fx, execution, {
      costAudCents: 7,
      costStatus: "estimated",
      retainedAt: addMilliseconds(dispatchedAt, 1),
    });
    const beforeCostEvents = scalar(
      fx.db,
      "SELECT COUNT(*) AS count FROM preventure_research_cost_events WHERE assignment_hash = ?",
      [execution.assignment.assignmentHash],
    );
    fx.db.close();
    let rawNow = addMilliseconds(artifact.retainedAt, 1);
    const rawClock = () => rawNow;
    const clock = createMonotonicIsoClock(rawClock);
    reopened = openDatabase(dbPath, { clock });
    const runtime = createBridgeRuntime(reopened, artifactRoot, clock);
    const recovered = runtime.bridge.recoverCrashRetainedOutput();
    assert.equal(recovered.status, "active_provider_artifact_recovered_locally");
    assert.equal(recovered.assignmentHash, execution.assignment.assignmentHash);
    assert.equal(recovered.retainedOutputHash, artifact.retained.artifactHash);
    assert.equal(recovered.canReprocess, true);
    assert.equal(recovered.providerCalls, 0);
    assert.equal(recovered.additionalAiCostAudCents, 0);
    assert.equal(recovered.retryAuthorized, false);
    assert.equal(runtime.providerCalls(), 0);
    assert.equal(runtime.bridge.recoverCrashRetainedOutput(), null);
    assert.equal(runtime.providerCalls(), 0);
    assert.equal(scalar(
      reopened,
      "SELECT COUNT(*) AS count FROM preventure_research_cost_events WHERE assignment_hash = ?",
      [execution.assignment.assignmentHash],
    ), beforeCostEvents + 1);
    assert.deepEqual(
      { ...reopened.prepare(
        `SELECT tasks.status AS task_status, attempts.status AS attempt_status,
                calls.status AS model_status, runs.status AS run_status,
                tasks.claim_token AS task_claim
         FROM tasks
         JOIN task_attempts AS attempts ON attempts.task_id = tasks.id
         JOIN model_calls AS calls ON calls.attempt_id = attempts.id
         JOIN agent_runs AS runs ON runs.id = attempts.agent_run_id
         WHERE tasks.id = ?`,
      ).get(execution.assignment.taskId) },
      {
        task_status: "needs_attention",
        attempt_status: "needs_attention",
        model_status: "needs_attention",
        run_status: "failed",
        task_claim: null,
      },
    );
    const readiness = runtime.bridge.readiness({
      authorityHash: authority.authorityHash,
      assignmentId: execution.assignment.id,
      assignmentHash: execution.assignment.assignmentHash,
    });
    assert.equal(readiness.canReprocess, true);
    assert.equal(readiness.canRecoverCustody, false);
    assert.equal(readiness.retainedOutputHash, artifact.retained.artifactHash);
    assert.equal(scalar(reopened, "SELECT COUNT(*) AS count FROM preventure_research_source_snapshots"), 0);
    assert.equal(scalar(reopened, "SELECT COUNT(*) AS count FROM preventure_research_evidence_records"), 0);
    assert.equal(scalar(reopened, "SELECT COUNT(*) AS count FROM preventure_research_decisions"), 0);
    rawNow = addMilliseconds(rawNow, 100);
  } finally {
    closeFixture(fx, reopened);
  }
});

for (const unusable of [
  {
    label: "malformed known-cost",
    artifactKind: "known_effect_invalid",
  },
  {
    label: "canonical warning-bearing",
    artifactKind: "canonical_known_response",
    responseIssues: ["response_incomplete"],
  },
]) {
  test(`active ${unusable.label} crash artifact seals a no-evidence early stop`, () => {
    const fx = createTerminalRecoveryFixture();
    const dbPath = path.join(fx.dir, "runtime.sqlite");
    const artifactRoot = path.join(fx.dir, "terminal-recovery-artifacts");
    let reopened = null;
    try {
      const dispatchedAt = "2026-08-02T06:30:00.000Z";
      const execution = prepareDispatchedExecution(fx, {
        dispatchedAt,
        productionRunIdentity: true,
      });
      const artifact = retainProviderArtifact(fx, execution, {
        artifactKind: unusable.artifactKind,
        responseIssues: unusable.responseIssues,
        costAudCents: 7,
        costStatus: "estimated",
        retainedAt: addMilliseconds(dispatchedAt, 1),
      });
      fx.db.close();
      const clock = createMonotonicIsoClock(() => addMilliseconds(artifact.retainedAt, 1));
      reopened = openDatabase(dbPath, { clock });
      const runtime = createBridgeRuntime(reopened, artifactRoot, clock);
      const recovered = runtime.bridge.recoverCrashRetainedOutput();
      assert.equal(
        recovered.status,
        "active_unusable_provider_artifact_sealed_validated_early_stop",
      );
      assert.equal(recovered.recoveryClass, "known_effect_unusable");
      assert.equal(recovered.terminalStopSealed, true);
      assert.equal(recovered.canReprocess, false);
      assert.equal(recovered.retryAuthorized, false);
      assert.equal(runtime.providerCalls(), 0);
      assert.equal(scalar(reopened, "SELECT COUNT(*) AS count FROM preventure_research_source_snapshots"), 0);
      assert.equal(scalar(reopened, "SELECT COUNT(*) AS count FROM preventure_research_evidence_records"), 0);
      assert.equal(scalar(reopened, "SELECT COUNT(*) AS count FROM preventure_research_decisions"), 1);
      assert.equal(scalar(
        reopened,
        "SELECT COUNT(*) AS count FROM preventure_research_lifecycle_events WHERE event_type = 'completed'",
      ), 1);
      assert.equal(scalar(
        reopened,
        `SELECT COUNT(*) AS count FROM tasks
         WHERE workflow_id = ? AND id <> ? AND status = 'skipped' AND attempt_count = 0`,
        [execution.assignment.workflowId, execution.assignment.taskId],
      ), authority.assignments.length - 1);
      const result = JSON.parse(reopened.prepare("SELECT result FROM tasks WHERE id = ?")
        .get(execution.assignment.taskId).result);
      assert.deepEqual(result.responseIssues, artifact.responseIssues);
      assert.equal(result.retryAuthorized, false);
    } finally {
      closeFixture(fx, reopened);
    }
  });
}

test("active malformed unknown-cost crash artifact freezes at full exposure", () => {
  const fx = createTerminalRecoveryFixture();
  const dbPath = path.join(fx.dir, "runtime.sqlite");
  const artifactRoot = path.join(fx.dir, "terminal-recovery-artifacts");
  let reopened = null;
  try {
    const dispatchedAt = "2026-08-02T06:30:00.000Z";
    const execution = prepareDispatchedExecution(fx, {
      dispatchedAt,
      productionRunIdentity: true,
    });
    const artifact = retainProviderArtifact(fx, execution, {
      artifactKind: "known_effect_invalid",
      retainedAt: addMilliseconds(dispatchedAt, 1),
    });
    fx.db.close();
    const clock = createMonotonicIsoClock(() => addMilliseconds(artifact.retainedAt, 1));
    reopened = openDatabase(dbPath, { clock });
    const runtime = createBridgeRuntime(reopened, artifactRoot, clock);
    const recovered = runtime.bridge.recoverCrashRetainedOutput();
    assert.equal(recovered.status, "active_invalid_provider_artifact_frozen_unknown_cost");
    assert.equal(recovered.recoveryClass, "known_effect_invalid_unknown_cost");
    assert.equal(recovered.authorityFrozen, true);
    assert.equal(recovered.canReprocess, false);
    assert.equal(recovered.terminalStopSealed, false);
    assert.equal(recovered.retryAuthorized, false);
    assert.equal(runtime.providerCalls(), 0);
    assert.equal(runtime.bridge.recoverCrashRetainedOutput(), null);
    assert.equal(scalar(reopened, "SELECT COUNT(*) AS count FROM preventure_research_decisions"), 0);
    assert.equal(scalar(
      reopened,
      "SELECT COUNT(*) AS count FROM preventure_research_lifecycle_events WHERE event_type = 'completed'",
    ), 0);
    assert.equal(scalar(reopened, "SELECT COUNT(*) AS count FROM preventure_research_source_snapshots"), 0);
    assert.equal(scalar(reopened, "SELECT COUNT(*) AS count FROM preventure_research_evidence_records"), 0);
    const cost = reopened.prepare(
      `SELECT event_type, amount_aud_cents, exposure_aud_cents
       FROM preventure_research_cost_events
       WHERE assignment_hash = ? ORDER BY sequence DESC LIMIT 1`,
    ).get(execution.assignment.assignmentHash);
    assert.deepEqual({ ...cost }, {
      event_type: "unknown",
      amount_aud_cents: null,
      exposure_aud_cents: execution.assignment.maxCostAudCents,
    });
    assert.equal(runtime.store.readState(authority.authorityHash).exactBillingPending, true);
    const task = reopened.prepare(
      "SELECT status, outcome_status, claim_token, result FROM tasks WHERE id = ?",
    ).get(execution.assignment.taskId);
    const result = JSON.parse(task.result);
    assert.deepEqual({
      status: task.status,
      outcome_status: task.outcome_status,
      claim_token: task.claim_token,
    }, {
      status: "needs_attention",
      outcome_status: "known_provider_result_needs_review",
      claim_token: null,
    });
    assert.equal(result.retainedOutputHash, artifact.retained.artifactHash);
    assert.equal(result.retainedOutputRef, artifact.retained.artifactRef);
    assert.equal(result.providerRequestId, artifact.retained.providerRequestId);
    assert.equal(result.providerResponseId, artifact.retained.providerResponseId);
    assert.equal(result.reprocessEligible, false);
    assert.equal(result.exactBillingPending, true);
    const model = reopened.prepare(
      "SELECT outcome_status, cost_status FROM model_calls WHERE id = ?",
    ).get(execution.ids.modelCallId);
    assert.deepEqual({ ...model }, { outcome_status: "known", cost_status: "unknown" });
  } finally {
    closeFixture(fx, reopened);
  }
});

test("active canonical unknown-cost crash artifact cannot enter local reprocessing", () => {
  const fx = createTerminalRecoveryFixture();
  const dbPath = path.join(fx.dir, "runtime.sqlite");
  const artifactRoot = path.join(fx.dir, "terminal-recovery-artifacts");
  let reopened = null;
  try {
    const dispatchedAt = "2026-08-02T06:30:00.000Z";
    const execution = prepareDispatchedExecution(fx, {
      dispatchedAt,
      productionRunIdentity: true,
    });
    const artifact = retainProviderArtifact(fx, execution, {
      artifactKind: "canonical_known_response",
      retainedAt: addMilliseconds(dispatchedAt, 1),
    });
    fx.db.close();
    const clock = createMonotonicIsoClock(() => addMilliseconds(artifact.retainedAt, 1));
    reopened = openDatabase(dbPath, { clock });
    const runtime = createBridgeRuntime(reopened, artifactRoot, clock);
    const recovered = runtime.bridge.recoverCrashRetainedOutput();
    assert.equal(recovered.status, "active_provider_artifact_frozen_unknown_cost");
    assert.equal(recovered.recoveryClass, "canonical_known_response_unknown_cost");
    assert.equal(recovered.authorityFrozen, true);
    assert.equal(recovered.canReprocess, false);
    assert.equal(recovered.retryAuthorized, false);
    assert.equal(runtime.providerCalls(), 0);
    assert.equal(runtime.bridge.recoverCrashRetainedOutput(), null);
    const result = JSON.parse(reopened.prepare("SELECT result FROM tasks WHERE id = ?")
      .get(execution.assignment.taskId).result);
    assert.equal(result.retainedOutputHash, artifact.retained.artifactHash);
    assert.equal(result.retainedOutputRef, artifact.retained.artifactRef);
    assert.equal(result.providerResponseId, artifact.retained.providerResponseId);
    assert.equal(result.reprocessEligible, false);
    assert.equal(result.exactBillingPending, true);
    const task = reopened.prepare(
      "SELECT outcome_status FROM tasks WHERE id = ?",
    ).get(execution.assignment.taskId);
    assert.equal(task.outcome_status, "known_provider_result_needs_review");
    const model = reopened.prepare(
      "SELECT outcome_status, cost_status FROM model_calls WHERE id = ?",
    ).get(execution.ids.modelCallId);
    assert.deepEqual({ ...model }, { outcome_status: "known", cost_status: "unknown" });
    assert.equal(scalar(reopened, "SELECT COUNT(*) AS count FROM preventure_research_source_snapshots"), 0);
    assert.equal(scalar(reopened, "SELECT COUNT(*) AS count FROM preventure_research_evidence_records"), 0);
    assert.equal(scalar(reopened, "SELECT COUNT(*) AS count FROM preventure_research_decisions"), 0);
  } finally {
    closeFixture(fx, reopened);
  }
});

test("active canonical crash discovery rejects a retained issue set that differs from the provider payload", () => {
  const fx = createTerminalRecoveryFixture();
  const dbPath = path.join(fx.dir, "runtime.sqlite");
  const artifactRoot = path.join(fx.dir, "terminal-recovery-artifacts");
  let reopened = null;
  try {
    const dispatchedAt = "2026-08-02T06:30:00.000Z";
    const execution = prepareDispatchedExecution(fx, {
      dispatchedAt,
      productionRunIdentity: true,
    });
    const artifact = retainProviderArtifact(fx, execution, {
      artifactKind: "canonical_known_response",
      responseIssues: ["response_incomplete"],
      providerDerivedIssues: [],
      costAudCents: 7,
      costStatus: "estimated",
      retainedAt: addMilliseconds(dispatchedAt, 1),
    });
    const before = {
      costEvents: scalar(
        fx.db,
        "SELECT COUNT(*) AS count FROM preventure_research_cost_events WHERE assignment_hash = ?",
        [execution.assignment.assignmentHash],
      ),
      evidence: scalar(fx.db, "SELECT COUNT(*) AS count FROM preventure_research_evidence_records"),
      decisions: scalar(fx.db, "SELECT COUNT(*) AS count FROM preventure_research_decisions"),
    };
    fx.db.close();
    const clock = createMonotonicIsoClock(() => addMilliseconds(artifact.retainedAt, 1));
    reopened = openDatabase(dbPath, { clock });
    const runtime = createBridgeRuntime(reopened, artifactRoot, clock);
    assert.throws(
      () => runtime.bridge.recoverCrashRetainedOutput(),
      (error) => error?.code === "preventure_bridge_active_crash_provider_truth_changed",
    );
    assert.equal(runtime.providerCalls(), 0);
    assert.deepEqual({
      costEvents: scalar(
        reopened,
        "SELECT COUNT(*) AS count FROM preventure_research_cost_events WHERE assignment_hash = ?",
        [execution.assignment.assignmentHash],
      ),
      evidence: scalar(reopened, "SELECT COUNT(*) AS count FROM preventure_research_evidence_records"),
      decisions: scalar(reopened, "SELECT COUNT(*) AS count FROM preventure_research_decisions"),
    }, before);
    assert.deepEqual(
      { ...reopened.prepare(
        `SELECT tasks.status AS task_status, attempts.status AS attempt_status,
                calls.status AS model_status, runs.status AS run_status,
                tasks.claim_token AS task_claim
         FROM tasks
         JOIN task_attempts AS attempts ON attempts.task_id = tasks.id
         JOIN model_calls AS calls ON calls.attempt_id = attempts.id
         JOIN agent_runs AS runs ON runs.id = attempts.agent_run_id
         WHERE tasks.id = ?`,
      ).get(execution.assignment.taskId) },
      {
        task_status: "running",
        attempt_status: "running",
        model_status: "dispatching",
        run_status: "running",
        task_claim: execution.claimToken,
      },
    );
  } finally {
    closeFixture(fx, reopened);
  }
});

test("active malformed crash discovery rejects a retained issue set that omits derived provider truth", () => {
  const fx = createTerminalRecoveryFixture();
  const dbPath = path.join(fx.dir, "runtime.sqlite");
  const artifactRoot = path.join(fx.dir, "terminal-recovery-artifacts");
  let reopened = null;
  try {
    const dispatchedAt = "2026-08-02T06:30:00.000Z";
    const execution = prepareDispatchedExecution(fx, {
      dispatchedAt,
      productionRunIdentity: true,
    });
    const artifact = retainProviderArtifact(fx, execution, {
      artifactKind: "known_effect_invalid",
      responseIssues: ["response_json_invalid"],
      costAudCents: 7,
      costStatus: "estimated",
      retainedAt: addMilliseconds(dispatchedAt, 1),
    });
    const before = {
      costEvents: scalar(
        fx.db,
        "SELECT COUNT(*) AS count FROM preventure_research_cost_events WHERE assignment_hash = ?",
        [execution.assignment.assignmentHash],
      ),
      decisions: scalar(fx.db, "SELECT COUNT(*) AS count FROM preventure_research_decisions"),
    };
    fx.db.close();
    const clock = createMonotonicIsoClock(() => addMilliseconds(artifact.retainedAt, 1));
    reopened = openDatabase(dbPath, { clock });
    const runtime = createBridgeRuntime(reopened, artifactRoot, clock);
    assert.throws(
      () => runtime.bridge.recoverCrashRetainedOutput(),
      (error) => (
        error?.code === "preventure_bridge_active_crash_provider_truth_changed"
        && error?.details?.changedFields?.includes("derived_issue_set")
      ),
    );
    assert.equal(runtime.providerCalls(), 0);
    assert.deepEqual({
      costEvents: scalar(
        reopened,
        "SELECT COUNT(*) AS count FROM preventure_research_cost_events WHERE assignment_hash = ?",
        [execution.assignment.assignmentHash],
      ),
      decisions: scalar(reopened, "SELECT COUNT(*) AS count FROM preventure_research_decisions"),
    }, before);
  } finally {
    closeFixture(fx, reopened);
  }
});

test("active malformed 408 artifact is retained for no-retry attention", () => {
  const fx = createTerminalRecoveryFixture();
  const dbPath = path.join(fx.dir, "runtime.sqlite");
  const artifactRoot = path.join(fx.dir, "terminal-recovery-artifacts");
  let reopened = null;
  try {
    const dispatchedAt = "2026-08-02T06:30:00.000Z";
    const execution = prepareDispatchedExecution(fx, {
      dispatchedAt,
      productionRunIdentity: true,
    });
    const artifact = retainProviderArtifact(fx, execution, {
      artifactKind: "known_effect_invalid",
      httpStatus: 408,
      costAudCents: 7,
      costStatus: "estimated",
      retainedAt: addMilliseconds(dispatchedAt, 1),
    });
    fx.db.close();
    const clock = createMonotonicIsoClock(() => addMilliseconds(artifact.retainedAt, 1));
    reopened = openDatabase(dbPath, { clock });
    const runtime = createBridgeRuntime(reopened, artifactRoot, clock);
    const recovered = runtime.bridge.recoverCrashRetainedOutput();
    assert.equal(
      recovered.status,
      "active_invalid_provider_artifact_retained_no_retry_attention",
    );
    assert.equal(
      recovered.recoveryClass,
      "known_effect_unusable_non_success_attention",
    );
    assert.equal(recovered.canReprocess, false);
    assert.equal(recovered.terminalStopSealed, false);
    assert.equal(recovered.retryAuthorized, false);
    assert.equal(runtime.providerCalls(), 0);
    assert.equal(runtime.bridge.recoverCrashRetainedOutput(), null);
    assert.equal(scalar(reopened, "SELECT COUNT(*) AS count FROM preventure_research_decisions"), 0);
    assert.equal(scalar(
      reopened,
      "SELECT COUNT(*) AS count FROM preventure_research_lifecycle_events WHERE event_type = 'completed'",
    ), 0);
    const task = reopened.prepare(
      "SELECT status, outcome_status, result FROM tasks WHERE id = ?",
    ).get(execution.assignment.taskId);
    const result = JSON.parse(task.result);
    assert.equal(task.status, "needs_attention");
    assert.equal(task.outcome_status, "known_provider_result_needs_review");
    assert.equal(result.reprocessEligible, false);
    assert.deepEqual(result.responseIssues, artifact.responseIssues);
    assert.equal(result.retryAuthorized, false);
  } finally {
    closeFixture(fx, reopened);
  }
});

test("active definite pre-effect crash artifact seals once at full pending exposure", () => {
  const fx = createTerminalRecoveryFixture();
  const dbPath = path.join(fx.dir, "runtime.sqlite");
  const artifactRoot = path.join(fx.dir, "terminal-recovery-artifacts");
  let reopened = null;
  try {
    const dispatchedAt = "2026-08-02T06:30:00.000Z";
    const execution = prepareDispatchedExecution(fx, {
      dispatchedAt,
      productionRunIdentity: true,
    });
    const artifact = retainProviderArtifact(fx, execution, {
      artifactKind: "known_pre_effect_rejection",
      retainedAt: addMilliseconds(dispatchedAt, 1),
    });
    fx.db.close();
    const clock = createMonotonicIsoClock(() => addMilliseconds(artifact.retainedAt, 1));
    reopened = openDatabase(dbPath, { clock });
    const runtime = createBridgeRuntime(reopened, artifactRoot, clock);
    const recovered = runtime.bridge.recoverCrashRetainedOutput();
    assert.equal(
      recovered.status,
      "active_pre_effect_artifact_sealed_validated_early_stop",
    );
    assert.equal(recovered.recoveryClass, "known_pre_effect_rejection");
    assert.equal(recovered.terminalStopSealed, true);
    assert.equal(recovered.canReprocess, false);
    assert.equal(recovered.retryAuthorized, false);
    assert.equal(runtime.providerCalls(), 0);
    assert.equal(runtime.bridge.recoverCrashRetainedOutput(), null);
    assert.equal(scalar(reopened, "SELECT COUNT(*) AS count FROM preventure_research_source_snapshots"), 0);
    assert.equal(scalar(reopened, "SELECT COUNT(*) AS count FROM preventure_research_evidence_records"), 0);
    assert.equal(scalar(reopened, "SELECT COUNT(*) AS count FROM preventure_research_decisions"), 1);
    const cost = reopened.prepare(
      `SELECT event_type, amount_aud_cents, exposure_aud_cents
       FROM preventure_research_cost_events
       WHERE assignment_hash = ? ORDER BY sequence DESC LIMIT 1`,
    ).get(execution.assignment.assignmentHash);
    assert.deepEqual({ ...cost }, {
      event_type: "estimated",
      amount_aud_cents: 0,
      exposure_aud_cents: execution.assignment.maxCostAudCents,
    });
    assert.equal(runtime.store.readState(authority.authorityHash).exactBillingPending, true);
    const result = JSON.parse(reopened.prepare("SELECT result FROM tasks WHERE id = ?")
      .get(execution.assignment.taskId).result);
    assert.equal(result.providerZeroBillingGuarantee, false);
    assert.equal(result.retryAuthorized, false);
  } finally {
    closeFixture(fx, reopened);
  }
});

for (const terminalKind of ["revoked", "expired"]) {
  test(`${terminalKind} crash discovery records custody once and replays after restart`, async () => {
    const fx = createTerminalRecoveryFixture();
    const dbPath = path.join(fx.dir, "runtime.sqlite");
    const artifactRoot = path.join(fx.dir, "terminal-recovery-artifacts");
    let reopened = null;
    let replayDb = null;
    try {
      const boundary = terminalKind === "expired"
        ? authority.expiresAt
        : "2026-08-02T06:30:00.010Z";
      const dispatchedAt = terminalKind === "expired"
        ? addMilliseconds(boundary, -2)
        : "2026-08-02T06:30:00.000Z";
      const execution = prepareDispatchedExecution(fx, {
        dispatchedAt,
        productionRunIdentity: true,
      });
      const artifact = retainProviderArtifact(fx, execution, {
        retainedAt: terminalKind === "expired"
          ? addMilliseconds(boundary, 1)
          : addMilliseconds(dispatchedAt, 1),
      });
      if (terminalKind === "revoked") {
        fx.setClock(boundary);
        const latest = fx.store.loadLifecycle(authority.authorityHash).at(-1);
        terminatePreventureResearchAuthority(
          fx.store,
          authority.authorityHash,
          "revoked",
          {
            expectedLatestEventHash: latest.eventHash,
            occurredAt: boundary,
            actor: "owner",
            reason: "Owner revocation wins over the already-retained in-flight response.",
          },
        );
      }
      fx.db.close();
      let rawNow = addMilliseconds(
        terminalKind === "expired" ? artifact.retainedAt : boundary,
        1,
      );
      const rawClock = () => rawNow;
      const clock = createMonotonicIsoClock(rawClock);
      reopened = openDatabase(dbPath, { clock });
      const runtime = createBridgeRuntime(reopened, artifactRoot, clock);
      const recovered = runtime.bridge.recoverCrashRetainedOutput();
      assert.equal(
        recovered.status,
        "terminal_provider_artifact_retained_pending_reconciliation",
      );
      assert.equal(recovered.created, true);
      assert.equal(recovered.terminalState, terminalKind);
      assert.equal(recovered.retainedOutputHash, artifact.retained.artifactHash);
      assert.equal(recovered.accountingState, "pending_reconciliation");
      assert.equal(recovered.additionalAiCostAudCents, 0);
      assert.equal(recovered.retryAuthorized, false);
      assert.equal(runtime.providerCalls(), 0);
      assert.equal(scalar(reopened, "SELECT COUNT(*) AS count FROM preventure_research_terminal_recoveries"), 1);
      assert.equal(scalar(reopened, "SELECT COUNT(*) AS count FROM preventure_research_source_snapshots"), 0);
      assert.equal(scalar(reopened, "SELECT COUNT(*) AS count FROM preventure_research_evidence_records"), 0);
      assert.equal(scalar(reopened, "SELECT COUNT(*) AS count FROM preventure_research_decisions"), 0);
      assert.equal(scalar(
        reopened,
        "SELECT COUNT(*) AS count FROM preventure_research_lifecycle_events WHERE event_type = 'completed'",
      ), 0);
      assert.equal(scalar(
        reopened,
        `SELECT COUNT(*) AS count FROM preventure_research_cost_events
         WHERE assignment_hash = ? AND event_type = 'unknown' AND exposure_aud_cents = ?`,
        [execution.assignment.assignmentHash, execution.assignment.maxCostAudCents],
      ), 1);
      const siblingRows = reopened.prepare(
        `SELECT assignments.assignment_id, tasks.status, tasks.attempt_count,
                (SELECT COUNT(*) FROM task_attempts WHERE task_id = tasks.id) AS attempt_rows,
                (SELECT COUNT(*) FROM model_calls WHERE task_id = tasks.id) AS model_rows,
                (SELECT COUNT(*) FROM costs WHERE task_id = tasks.id) AS cost_rows
         FROM preventure_research_assignments AS assignments
         JOIN tasks ON tasks.id = assignments.task_id
         WHERE assignments.authority_hash = ? AND assignments.assignment_hash <> ?
         ORDER BY assignments.assignment_id`,
      ).all(authority.authorityHash, execution.assignment.assignmentHash);
      assert.equal(siblingRows.length, authority.assignments.length - 1);
      assert.ok(siblingRows.every((row) => (
        row.status === "cancelled"
        && Number(row.attempt_count) === 0
        && Number(row.attempt_rows) === 0
        && Number(row.model_rows) === 0
        && Number(row.cost_rows) === 0
      )));
      const beforeReplay = {
        recoveries: scalar(reopened, "SELECT COUNT(*) AS count FROM preventure_research_terminal_recoveries"),
        costEvents: scalar(reopened, "SELECT COUNT(*) AS count FROM preventure_research_cost_events"),
      };
      reopened.close();
      reopened = null;
      rawNow = addMilliseconds(rawNow, 5_000);
      const replayClock = createMonotonicIsoClock(rawClock);
      replayDb = openDatabase(dbPath, { clock: replayClock });
      const replayRuntime = createBridgeRuntime(replayDb, artifactRoot, replayClock);
      const readiness = replayRuntime.bridge.readiness({
        authorityHash: authority.authorityHash,
        assignmentId: execution.assignment.id,
        assignmentHash: execution.assignment.assignmentHash,
      });
      assert.equal(readiness.status, "terminal_retained_output_custody_recorded");
      assert.equal(readiness.canRecoverCustody, false);
      const replay = await replayRuntime.bridge.recoverTerminalRetainedOutput({
        authorityHash: authority.authorityHash,
        assignmentId: execution.assignment.id,
        expectedAssignmentHash: execution.assignment.assignmentHash,
        expectedDescriptorHash: execution.descriptor.descriptorHash,
        retainedOutputHash: artifact.retained.artifactHash,
      });
      assert.equal(replay.created, false);
      assert.equal(replay.custodyRecord.recordedAt, recovered.custodyRecord.recordedAt);
      assert.equal(replayRuntime.providerCalls(), 0);
      assert.deepEqual({
        recoveries: scalar(replayDb, "SELECT COUNT(*) AS count FROM preventure_research_terminal_recoveries"),
        costEvents: scalar(replayDb, "SELECT COUNT(*) AS count FROM preventure_research_cost_events"),
      }, beforeReplay);
    } finally {
      try { replayDb?.close(); } catch {}
      closeFixture(fx, reopened);
    }
  });
}
