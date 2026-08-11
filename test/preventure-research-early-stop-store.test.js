"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const authority = require("../config/preventure-research-authority-smm-scope-guard-v1");
const { sha256 } = require("../src/runtime/commercial-test-contract");
const {
  createPreventureLifecycleEvent,
  createPreventureResearchDecision,
} = require("../src/runtime/preventure-research-contract");
const {
  createPreventureResearchStore,
  preventureResultingReadinessHash,
} = require("../src/runtime/preventure-research-store");
const {
  createPreventureResearchTerminalStop,
} = require("../src/runtime/preventure-research-terminal-stop");

const {
  STORE_TIME,
  STOPPED_AT,
  buildStop,
  canonicalJson,
  clone,
  deriveDecisionInputs,
  fixture,
  historicalStoreOptions,
  rowCount,
} = require("./support/preventure-research-early-stop-fixture");

function assertSkippedAssignmentZero(db, assignment) {
  const taskTables = [
    "task_attempts",
    "model_calls",
    "agent_run_receipts",
    "research_runs",
    "agent_runs",
    "budget_reservations",
    "costs",
  ];
  for (const table of taskTables) {
    assert.equal(
      rowCount(db, table, "task_id = ?", [assignment.taskId]),
      0,
      `${table}:${assignment.id}`,
    );
  }
  assert.equal(
    rowCount(db, "agent_tool_invocations", "task_id = ?", [assignment.taskId]),
    0,
    `agent_tool_invocations:${assignment.id}`,
  );
  for (const table of [
    "preventure_research_cost_events",
    "preventure_research_source_snapshots",
    "preventure_research_evidence_records",
  ]) {
    assert.equal(
      rowCount(db, table, "assignment_hash = ?", [assignment.assignmentHash]),
      0,
      `${table}:${assignment.id}`,
    );
  }
  const task = db.prepare(
    "SELECT status, attempt_count, claim_token, claimed_at FROM tasks WHERE id = ?",
  ).get(assignment.taskId);
  assert.equal(task.status, "skipped");
  assert.equal(Number(task.attempt_count), 0);
  assert.equal(task.claim_token, null);
  assert.equal(task.claimed_at, null);
}

function terminalStopProjection(stopRecord, decisionId, completionId) {
  return {
    early_stop_record_hash: stopRecord.earlyStopRecordHash,
    terminal_stop_id: stopRecord.id,
    authority_hash: stopRecord.authorityHash,
    expected_decision_id: decisionId,
    expected_completion_event_id: completionId,
    trigger_assignment_id: stopRecord.triggerAssignmentId,
    trigger_assignment_hash: stopRecord.triggerAssignmentHash,
    trigger_outcome_class: stopRecord.triggerOutcomeClass,
    reason_class: stopRecord.reasonClass,
    reason_code: stopRecord.reasonCode,
    commercial_inference: stopRecord.commercialInference,
    provider_evidence_json: canonicalJson(stopRecord.providerEvidence),
    actual_coverage_json: canonicalJson(stopRecord.actualCoverage),
    gap_codes_json: canonicalJson(stopRecord.gapCodes),
    skipped_assignments_json: canonicalJson(stopRecord.skippedAssignments),
    next_evidence_action_json: canonicalJson(stopRecord.nextEvidenceAction),
    prior_evidence_set_hash: stopRecord.actualCoverage.evidenceSetHash,
    prior_receipt_set_hash: stopRecord.actualCoverage.executionReceiptSetHash,
    stopped_at: stopRecord.stoppedAt,
    stop_json: canonicalJson(stopRecord),
    created_at: STORE_TIME,
  };
}

function assignmentSkipProjection(skipRecord) {
  return {
    skip_record_hash: skipRecord.skipRecordHash,
    terminal_stop_id: skipRecord.terminalStopId,
    authority_hash: skipRecord.authorityHash,
    trigger_assignment_hash: skipRecord.triggerAssignmentHash,
    assignment_id: skipRecord.assignmentId,
    assignment_hash: skipRecord.assignmentHash,
    assignment_order: skipRecord.assignmentOrder,
    task_id: skipRecord.taskId,
    dispatch_state: skipRecord.dispatchState,
    task_attempt_count: skipRecord.taskAttemptCount,
    model_call_count: skipRecord.modelCallCount,
    agent_run_receipt_count: skipRecord.agentRunReceiptCount,
    research_run_count: skipRecord.researchRunCount,
    agent_run_count: skipRecord.agentRunCount,
    tool_invocation_count: skipRecord.toolInvocationCount,
    budget_reservation_count: skipRecord.budgetReservationCount,
    cost_record_count: skipRecord.costRecordCount,
    cost_event_count: skipRecord.costEventCount,
    source_snapshot_count: skipRecord.sourceSnapshotCount,
    evidence_record_count: skipRecord.evidenceRecordCount,
    total_aud_cost_cents: skipRecord.totalAudCostCents,
    skipped_at: skipRecord.skippedAt,
    skip_json: canonicalJson(skipRecord),
    created_at: STORE_TIME,
  };
}

function directSqlDecision(stopRecord, decisionInput) {
  const skippedAssignmentRecordHashes = stopRecord.skippedAssignments
    .map((item) => item.skipRecordHash)
    .sort();
  return createPreventureResearchDecision(authority, {
    ...decisionInput,
    earlyStopRecordHash: stopRecord.earlyStopRecordHash,
    skippedAssignmentRecordHashes,
    nextEvidenceAction: stopRecord.nextEvidenceAction,
    comparatorCount: 0,
    estimatedInternalAiCostAudCents: 0,
    reconciledInternalAiCostAudCents: 0,
    exactBillingPending: false,
    externalCommercialSpendAudCents: 0,
    provenanceComplete: true,
    unknownProviderOutcomeCount: 0,
    unknownCostCount: 0,
    evidenceSetHash: stopRecord.actualCoverage.evidenceSetHash,
    receiptSetHash: sha256({
      authorityHash: authority.authorityHash,
      executionReceiptSetHash: stopRecord.actualCoverage.executionReceiptSetHash,
      earlyStopRecordHash: stopRecord.earlyStopRecordHash,
      skippedAssignmentRecordHashes,
    }),
    sourceIds: [],
    comparatorIds: [],
    comparatorCoverage: {
      directOrNearDirectCount: 0,
      adjacentCount: 0,
      indirectCount: 0,
      maximumAcceptedOffersPerSeller: 0,
      sellerIdentityComplete: true,
      perFormatCounts: Object.fromEntries(authority.formats.map((id) => [id, 0])),
      observedChannelIds: [],
      selectionMethodApplied: false,
    },
    contraryEvidence: [],
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
}

function insertProjection(db, table, projection) {
  const columns = Object.keys(projection);
  db.prepare(
    `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`,
  ).run(...columns.map((column) => projection[column] ?? null));
}

test("recordValidatedEarlyStop seals the exact authority-order suffix at positions one, two, and three", async (t) => {
  for (const triggerIndex of [0, 1, 2]) {
    await t.test(`trigger position ${triggerIndex + 1}`, () => {
      const fx = fixture();
      try {
        const { stopRecord } = buildStop(fx, triggerIndex);
        const inputs = deriveDecisionInputs(fx, stopRecord);
        const recorded = fx.store.recordValidatedEarlyStop(
          authority.authorityHash,
          stopRecord,
          inputs.decisionInput,
          inputs.completionInput,
        );
        assert.equal(recorded.created, true);
        assert.deepEqual(recorded.stopRecord, stopRecord);
        assert.deepEqual(recorded.skippedAssignments, stopRecord.skippedAssignments);
        assert.equal(recorded.decision.outcome, "research_more");
        assert.equal(recorded.decision.completionMode, "validated_early_stop");
        assert.equal(recorded.completionEvent.eventType, "completed");
        assert.equal(
          recorded.resultingReadinessHash,
          preventureResultingReadinessHash(recorded.decision),
        );
        assert.deepEqual(
          fx.store.listAssignments(authority.authorityHash).map((item) => item.id),
          authority.assignments.map((item) => item.id),
        );
        assert.deepEqual(
          recorded.skippedAssignments.map((item) => item.assignmentId),
          authority.assignments.slice(triggerIndex + 1).map((item) => item.id),
        );
        for (const assignment of fx.assignments.slice(triggerIndex + 1)) {
          assertSkippedAssignmentZero(fx.db, assignment);
        }
        assert.equal(
          rowCount(fx.db, "preventure_research_terminal_stops", "authority_hash = ?", [authority.authorityHash]),
          1,
        );
        assert.equal(
          rowCount(fx.db, "preventure_research_assignment_skips", "authority_hash = ?", [authority.authorityHash]),
          2 - triggerIndex,
        );
        assert.equal(
          rowCount(fx.db, "preventure_research_decisions", "authority_hash = ?", [authority.authorityHash]),
          1,
        );
        assert.equal(fx.store.verifyLedger().ok, true);
      } finally {
        fx.close();
      }
    });
  }
});

test("recordValidatedEarlyStop replays exactly and rolls every partial write back on a late fault", () => {
  const fx = fixture();
  try {
    const { stopRecord } = buildStop(fx, 0);
    const inputs = deriveDecisionInputs(fx, stopRecord);
    const priorTaskStates = fx.db.prepare(
      `SELECT id, status, attempt_count, claim_token, claimed_at
       FROM tasks WHERE id IN (?, ?, ?) ORDER BY id`,
    ).all(...fx.assignments.map((item) => item.taskId));
    fx.db.exec(`
      CREATE TEMP TRIGGER preventure_test_abort_early_stop_completion
      BEFORE INSERT ON main.preventure_research_lifecycle_events
      WHEN NEW.event_type = 'completed'
      BEGIN
        SELECT RAISE(ABORT, 'forced early-stop completion fault');
      END;
    `);
    assert.throws(() => fx.store.recordValidatedEarlyStop(
      authority.authorityHash,
      stopRecord,
      inputs.decisionInput,
      inputs.completionInput,
    ));
    fx.db.exec("DROP TRIGGER preventure_test_abort_early_stop_completion");
    for (const table of [
      "preventure_research_terminal_stops",
      "preventure_research_assignment_skips",
      "preventure_research_decisions",
    ]) assert.equal(rowCount(fx.db, table, "authority_hash = ?", [authority.authorityHash]), 0);
    assert.deepEqual(
      fx.db.prepare(
        `SELECT id, status, attempt_count, claim_token, claimed_at
         FROM tasks WHERE id IN (?, ?, ?) ORDER BY id`,
      ).all(...fx.assignments.map((item) => item.taskId)),
      priorTaskStates,
    );
    assert.equal(
      fx.store.loadLifecycle(authority.authorityHash).at(-1).eventType,
      "activated",
    );

    const first = fx.store.recordValidatedEarlyStop(
      authority.authorityHash,
      stopRecord,
      inputs.decisionInput,
      inputs.completionInput,
    );
    assert.equal(first.created, true);
    const restarted = createPreventureResearchStore(fx.db, historicalStoreOptions());
    const replay = restarted.recordValidatedEarlyStop(
      authority.authorityHash,
      stopRecord,
      inputs.decisionInput,
      inputs.completionInput,
    );
    assert.equal(replay.created, false);
    assert.equal(replay.decision.decisionHash, first.decision.decisionHash);
    assert.equal(rowCount(fx.db, "preventure_research_terminal_stops"), 1);
    assert.equal(rowCount(fx.db, "preventure_research_assignment_skips"), 2);
    assert.equal(rowCount(fx.db, "preventure_research_decisions"), 1);
    assert.throws(() => restarted.recordValidatedEarlyStop(
      authority.authorityHash,
      stopRecord,
      { ...inputs.decisionInput, version: `${inputs.decisionInput.version}-changed` },
      inputs.completionInput,
    ));
    assert.equal(rowCount(fx.db, "preventure_research_decisions"), 1);
  } finally {
    fx.close();
  }
});

test("an authorized early stop keeps its skipped suffix protected from later direct SQL activity", () => {
  const fx = fixture();
  try {
    const { stopRecord } = buildStop(fx, 0);
    const inputs = deriveDecisionInputs(fx, stopRecord);
    const skipped = stopRecord.skippedAssignments[0];
    fx.store.recordValidatedEarlyStop(
      authority.authorityHash,
      stopRecord,
      inputs.decisionInput,
      inputs.completionInput,
    );
    assert.throws(() => {
      fx.db.prepare(
        `INSERT INTO budget_reservations
         (id, venture_id, workflow_id, task_id, approval_id, status,
          amount_cents, currency, reserved_at, resolved_at, metadata)
         VALUES ('forged_suffix_reservation', NULL, ?, ?, NULL, 'released',
                 0, 'AUD', ?, ?, '{}')`,
      ).run(
        fx.assignments[1].workflowId,
        skipped.taskId,
        STOPPED_AT,
        STOPPED_AT,
      );
    });
    assert.equal(rowCount(fx.db, "preventure_research_terminal_stops"), 1);
    assert.equal(rowCount(fx.db, "preventure_research_assignment_skips"), 2);
    assert.equal(rowCount(fx.db, "budget_reservations", "id = 'forged_suffix_reservation'"), 0);
    assertSkippedAssignmentZero(fx.db, fx.assignments[1]);
  } finally {
    fx.close();
  }
});

test("direct SQL cannot begin a self-consistent forged stop, decision, and completion triple", () => {
  const fx = fixture();
  try {
    const { stopRecord } = buildStop(fx, 0);
    const inputs = deriveDecisionInputs(fx, stopRecord);
    const forgedStop = createPreventureResearchTerminalStop({
      authority,
      assignments: fx.assignments,
      triggerAssignment: fx.assignments[0],
      triggerOutcomeClass: stopRecord.triggerOutcomeClass,
      providerEvidence: {
        ...stopRecord.providerEvidence,
        providerRequestId: "request_early_stop_direct_sql_forged",
      },
      actualCoverage: stopRecord.actualCoverage,
      gapCodes: stopRecord.gapCodes,
      stoppedAt: stopRecord.stoppedAt,
    });
    const decision = directSqlDecision(forgedStop, {
      ...inputs.decisionInput,
      earlyStopRecordHash: forgedStop.earlyStopRecordHash,
      skippedAssignmentRecordHashes: forgedStop.skippedAssignments
        .map((item) => item.skipRecordHash)
        .sort(),
      nextEvidenceAction: forgedStop.nextEvidenceAction,
    });
    const completion = createPreventureLifecycleEvent(
      authority,
      fx.store.loadLifecycle(authority.authorityHash),
      {
        id: inputs.completionInput.id,
        eventType: "completed",
        occurredAt: forgedStop.stoppedAt,
        actor: inputs.completionInput.actor,
        reason: inputs.completionInput.reason,
        metadata: {
          decisionHash: decision.decisionHash,
          evidenceSetHash: decision.evidenceSetHash,
          receiptSetHash: decision.receiptSetHash,
          resultingReadinessHash: preventureResultingReadinessHash(decision),
          outcome: decision.outcome,
        },
      },
    );

    fx.db.exec("BEGIN IMMEDIATE");
    try {
      assert.throws(() => {
        insertProjection(
          fx.db,
          "preventure_research_terminal_stops",
          terminalStopProjection(
            forgedStop,
            decision.id,
            completion.id,
          ),
        );
      });
    } finally {
      fx.db.exec("ROLLBACK");
    }
    assert.equal(rowCount(fx.db, "preventure_research_terminal_stops"), 0);
    assert.equal(rowCount(fx.db, "preventure_research_assignment_skips"), 0);
    assert.equal(rowCount(fx.db, "preventure_research_decisions"), 0);
    assert.equal(fx.store.loadLifecycle(authority.authorityHash).at(-1).eventType, "activated");
  } finally {
    fx.close();
  }
});

test("recordValidatedEarlyStop rejects a self-consistent stop whose provider identity changed", () => {
  const fx = fixture();
  try {
    const { stopRecord } = buildStop(fx, 0);
    const inputs = deriveDecisionInputs(fx, stopRecord);
    const forgedStop = createPreventureResearchTerminalStop({
      authority,
      assignments: fx.assignments,
      triggerAssignment: fx.assignments[0],
      triggerOutcomeClass: stopRecord.triggerOutcomeClass,
      providerEvidence: {
        ...stopRecord.providerEvidence,
        providerRequestId: "request_early_stop_forged",
      },
      actualCoverage: stopRecord.actualCoverage,
      gapCodes: stopRecord.gapCodes,
      stoppedAt: stopRecord.stoppedAt,
    });
    const forgedDecisionInput = {
      ...clone(inputs.decisionInput),
      earlyStopRecordHash: forgedStop.earlyStopRecordHash,
      skippedAssignmentRecordHashes: forgedStop.skippedAssignments
        .map((item) => item.skipRecordHash)
        .sort(),
      nextEvidenceAction: forgedStop.nextEvidenceAction,
      receiptSetHash: sha256({
        authorityHash: authority.authorityHash,
        executionReceiptSetHash: forgedStop.actualCoverage.executionReceiptSetHash,
        earlyStopRecordHash: forgedStop.earlyStopRecordHash,
        skippedAssignmentRecordHashes: forgedStop.skippedAssignments
          .map((item) => item.skipRecordHash)
          .sort(),
      }),
    };
    assert.throws(() => fx.store.recordValidatedEarlyStop(
      authority.authorityHash,
      forgedStop,
      forgedDecisionInput,
      inputs.completionInput,
    ));
    assert.equal(rowCount(fx.db, "preventure_research_terminal_stops"), 0);
    assert.equal(rowCount(fx.db, "preventure_research_assignment_skips"), 0);
    assert.equal(rowCount(fx.db, "preventure_research_decisions"), 0);
    assert.equal(fx.store.loadLifecycle(authority.authorityHash).at(-1).eventType, "activated");
  } finally {
    fx.close();
  }
});
