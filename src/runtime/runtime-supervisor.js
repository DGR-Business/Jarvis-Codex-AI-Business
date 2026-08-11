const {
  all,
  fromJson,
  get,
  recordPreventureEmergencyUnknownCost,
  run,
  toJson,
  withPreventureEmergencyCostSafetyCapability,
} = require("../db");

const UNCERTAIN_MODEL_CALL_STATUSES = new Set(["dispatching", "running"]);
const UNCERTAIN_PROVIDER_OUTCOMES = new Set(["provider_dispatched", "unknown"]);
const EMERGENCY_OUTCOMES = Object.freeze({
  interrupted: "interrupted",
  knownProviderResult: "known_provider_result_needs_review",
  unknown: "unknown",
});

function controlConfiguration() {
  const url = String(
    process.env.PANTHEON_STANDBY_URL
      || process.env.JARVIS_STANDBY_URL
      || "",
  ).replace(/\/+$/, "");
  const token = String(
    process.env.PANTHEON_STANDBY_HANDOFF_TOKEN
      || process.env.JARVIS_STANDBY_HANDOFF_TOKEN
      || "",
  );
  return {
    available: /^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(url) && token.length >= 32,
    url,
    token,
  };
}

function runningWork(db) {
  return all(
    db,
    `SELECT tasks.id, tasks.workflow_id, tasks.title, tasks.agent, tasks.status, tasks.outcome_status,
            task_attempts.id AS attempt_id, task_attempts.status AS attempt_status,
            task_attempts.outcome_status AS attempt_outcome_status,
            task_attempts.provider_request_id AS attempt_provider_request_id,
            task_attempts.provider_dispatched_at,
            task_attempts.provider_dispatch_model_call_id,
            task_attempts.metadata AS attempt_metadata,
            model_calls.id AS model_call_id, model_calls.status AS model_call_status,
            model_calls.outcome_status AS model_call_outcome_status,
            model_calls.provider_request_id AS model_call_provider_request_id,
            COALESCE(model_calls.provider_request_id, task_attempts.provider_request_id)
              AS provider_request_id
     FROM tasks
     LEFT JOIN task_attempts
       ON task_attempts.id = (
         SELECT active_attempt.id
         FROM task_attempts AS active_attempt
         WHERE active_attempt.task_id = tasks.id
           AND active_attempt.status = 'running'
         ORDER BY active_attempt.started_at DESC, active_attempt.id DESC
         LIMIT 1
       )
     LEFT JOIN model_calls
       ON model_calls.id = COALESCE(
         task_attempts.provider_dispatch_model_call_id,
         task_attempts.model_call_id,
         (
           SELECT candidate_call.id
           FROM model_calls AS candidate_call
           WHERE candidate_call.task_id = tasks.id
             AND (
               candidate_call.status IN ('dispatching', 'running')
               OR (
                 candidate_call.completed_at IS NULL
                 AND candidate_call.outcome_status IN ('provider_dispatched', 'unknown')
               )
             )
           ORDER BY candidate_call.created_at DESC, candidate_call.id DESC
           LIMIT 1
         )
       )
     WHERE tasks.status = 'running'
        OR task_attempts.id IS NOT NULL
        OR EXISTS (
          SELECT 1
          FROM model_calls AS active_call
          WHERE active_call.task_id = tasks.id
            AND active_call.status IN ('dispatching', 'running')
        )
     ORDER BY tasks.created_at ASC`,
  );
}

function providerDispatchRecorded(item) {
  const metadata = fromJson(item.attempt_metadata, {});
  return Boolean(
    item.attempt_provider_request_id
      || item.provider_dispatched_at
      || item.provider_dispatch_model_call_id
      || ["provider_dispatched", "unknown", "known"].includes(item.attempt_outcome_status)
      || (item.model_call_id && item.model_call_status !== "not_called")
      || metadata.providerCallOccurred === true
      || metadata.dispatchIntent?.status === "dispatched",
  );
}

function attemptDispatchRecorded(attempt) {
  const metadata = fromJson(attempt?.metadata, {});
  return Boolean(
    attempt?.provider_request_id
      || attempt?.provider_dispatched_at
      || attempt?.provider_dispatch_model_call_id
      || ["provider_dispatched", "unknown", "known"].includes(attempt?.outcome_status)
      || metadata.providerCallOccurred === true
      || metadata.dispatchIntent?.status === "dispatched",
  );
}

function modelCallIsNonTerminal(call) {
  return UNCERTAIN_MODEL_CALL_STATUSES.has(call?.status)
    || (
      !call?.completed_at
      && UNCERTAIN_PROVIDER_OUTCOMES.has(call?.outcome_status)
    );
}

function modelCallOutcomeUnknown(call) {
  return call?.outcome_status === "unknown" || modelCallIsNonTerminal(call);
}

function modelCallHasDurableProviderResult(call) {
  if (!call || modelCallOutcomeUnknown(call)) return false;
  const metadata = fromJson(call.metadata, {});
  return call.outcome_status === "known"
    || Boolean(call.provider_request_id && call.completed_at)
    || metadata.providerResponseReceived === true
    || Boolean(metadata.providerReceipt || metadata.providerReceiptRecordedAt)
    || metadata.definiteProviderRejection === true
    || metadata.providerDispatchStatus === "definite_rejection";
}

function modelCallBoundToAttempt(call, attempt) {
  if (!call || !attempt) return false;
  const metadata = fromJson(call.metadata, {});
  return call.attempt_id === attempt.id
    || call.id === attempt.provider_dispatch_model_call_id
    || call.id === attempt.model_call_id
    || metadata.taskAttemptId === attempt.id;
}

function classifyAttemptEmergencyOutcome(attempt, calls) {
  if (calls.some(modelCallOutcomeUnknown)) return EMERGENCY_OUTCOMES.unknown;
  if (calls.some(modelCallHasDurableProviderResult)) {
    return EMERGENCY_OUTCOMES.knownProviderResult;
  }
  return attemptDispatchRecorded(attempt)
    ? EMERGENCY_OUTCOMES.unknown
    : EMERGENCY_OUTCOMES.interrupted;
}

function emergencyEvidenceForTask(db, taskId) {
  const attempts = all(
    db,
    "SELECT * FROM task_attempts WHERE task_id = ? AND status = 'running' ORDER BY started_at ASC, id ASC",
    [taskId],
  );
  const calls = all(
    db,
    "SELECT * FROM model_calls WHERE task_id = ? ORDER BY created_at ASC, id ASC",
    [taskId],
  );
  const boundCallIds = new Set();
  const attemptOutcomes = attempts.map((attempt) => {
    const relatedCalls = calls.filter((call) => modelCallBoundToAttempt(call, attempt));
    for (const call of relatedCalls) boundCallIds.add(call.id);
    return {
      attempt,
      calls: relatedCalls,
      outcome: classifyAttemptEmergencyOutcome(attempt, relatedCalls),
    };
  });
  const fallbackCalls = boundCallIds.size === 0
    ? calls.filter((call) => modelCallIsNonTerminal(call) || modelCallHasDurableProviderResult(call))
    : [];
  if (attemptOutcomes.length === 1 && fallbackCalls.length) {
    attemptOutcomes[0].calls = fallbackCalls;
    attemptOutcomes[0].outcome = classifyAttemptEmergencyOutcome(
      attemptOutcomes[0].attempt,
      fallbackCalls,
    );
  }
  const outcomes = attemptOutcomes.map((item) => item.outcome);
  if (!outcomes.length && fallbackCalls.length) {
    outcomes.push(classifyAttemptEmergencyOutcome(null, fallbackCalls));
  }
  const outcome = outcomes.includes(EMERGENCY_OUTCOMES.unknown)
    ? EMERGENCY_OUTCOMES.unknown
    : outcomes.includes(EMERGENCY_OUTCOMES.knownProviderResult)
      ? EMERGENCY_OUTCOMES.knownProviderResult
      : EMERGENCY_OUTCOMES.interrupted;
  const uncertainCalls = calls.filter((call) => {
    if (!modelCallIsNonTerminal(call)) return false;
    if (boundCallIds.size === 0) return true;
    return boundCallIds.has(call.id);
  });
  return { attempts: attemptOutcomes, outcome, uncertainCalls };
}

function emergencyOutcomeNote(outcome, suppliedNote) {
  const note = String(suppliedNote || "").trim();
  if (note) return note;
  if (outcome === EMERGENCY_OUTCOMES.knownProviderResult) {
    return "Pantheon stopped after a provider result was recorded but before local completion. Review the retained result before continuing.";
  }
  if (outcome === EMERGENCY_OUTCOMES.interrupted) {
    return "Pantheon stopped before provider dispatch. Review the interrupted local work before continuing.";
  }
  return "Pantheon stopped after provider dispatch before the outcome could be confirmed.";
}

function databaseClockTimestamp(db) {
  const value = get(db, "SELECT pantheon_current_time() AS value")?.value;
  if (
    typeof value !== "string"
    || !Number.isFinite(Date.parse(value))
    || new Date(value).toISOString() !== value
  ) {
    throw new Error("Pantheon cannot record an emergency stop without its exact database clock.");
  }
  return value;
}

function getRuntimeControlState(db) {
  const configuration = controlConfiguration();
  const active = runningWork(db);
  return {
    mode: "working",
    controlShellAvailable: configuration.available,
    controlShellUrl: configuration.available ? `${configuration.url}/` : null,
    canReturnToStandby: configuration.available && active.length === 0,
    activeWork: active.map((item) => ({
      taskId: item.id,
      title: item.title,
      worker: item.agent,
      providerDispatched: providerDispatchRecorded(item),
    })),
  };
}

async function requestControlAction(action) {
  const configuration = controlConfiguration();
  if (!configuration.available) {
    throw new Error("Pantheon Control is not running. Use STOP PANTHEON.cmd to stop this direct runtime.");
  }
  const path = action === "stop" ? "/api/control/stop-all" : "/api/control/return-to-standby";
  const response = await fetch(`${configuration.url}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-pantheon-standby": configuration.token,
    },
    body: "{}",
    signal: AbortSignal.timeout(5_000),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || "Pantheon Control could not change operating mode.");
  }
  return {
    ...payload,
    controlUrl: payload.controlUrl || `${configuration.url}/`,
  };
}

async function returnToStandby(db) {
  const active = runningWork(db);
  if (active.length) {
    const label = active.length === 1 ? "one active task" : `${active.length} active tasks`;
    throw new Error(`Pantheon is finishing ${label}. Return to standby when that work completes.`);
  }
  return requestControlAction("standby");
}

async function stopPantheon(db) {
  const active = runningWork(db);
  if (active.length) {
    const label = active.length === 1 ? "one active task" : `${active.length} active tasks`;
    throw new Error(`Pantheon is finishing ${label}. Use emergency stop only if waiting would be unsafe.`);
  }
  return requestControlAction("stop");
}

function markEmergencyStopUnknown(db, note = null, options = {}) {
  let active = [];
  let providerOutcomesUnknown = 0;
  let knownProviderResultsNeedReview = 0;
  let interruptedBeforeProvider = 0;
  const ownsTransaction = !db.isTransaction;
  const taskIds = Array.isArray(options.taskIds)
    ? new Set(options.taskIds.map((taskId) => String(taskId)))
    : null;
  if (ownsTransaction) db.exec("BEGIN IMMEDIATE");
  try {
    active = runningWork(db).filter((item) => !taskIds || taskIds.has(item.id));
    if (!active.length) {
      if (ownsTransaction) db.exec("COMMIT");
      return { affectedTasks: 0, providerOutcomesUnknown: 0 };
    }
    const ts = databaseClockTimestamp(db);
    const emergencyItems = active.map((item) => {
      const evidence = emergencyEvidenceForTask(db, item.id);
      const providerUnknown = evidence.outcome === EMERGENCY_OUTCOMES.unknown;
      const providerResultRecorded = evidence.outcome === EMERGENCY_OUTCOMES.knownProviderResult;
      const taskNote = emergencyOutcomeNote(evidence.outcome, note);
      if (providerUnknown) providerOutcomesUnknown += 1;
      if (providerResultRecorded) knownProviderResultsNeedReview += 1;
      if (evidence.outcome === EMERGENCY_OUTCOMES.interrupted) interruptedBeforeProvider += 1;
      const preventureAssignment = providerUnknown
        ? get(
          db,
          "SELECT assignment_hash FROM preventure_research_assignments WHERE task_id = ?",
          [item.id],
        )
        : null;
      return {
        item,
        evidence,
        providerUnknown,
        providerResultRecorded,
        taskNote,
        preventureAssignment,
      };
    });
    const recordEmergencyState = () => {
      for (const entry of emergencyItems) {
        const {
          item,
          evidence,
          providerUnknown,
          providerResultRecorded,
          taskNote,
          preventureAssignment,
        } = entry;
        for (const attemptEvidence of evidence.attempts) {
          const attemptOutcome = attemptEvidence.outcome;
          const attemptNote = emergencyOutcomeNote(attemptOutcome, note);
          run(
            db,
            `UPDATE task_attempts
             SET status = 'needs_attention',
                 outcome_status = ?,
                 error_kind = 'operator_emergency_stop', error = COALESCE(error, ?),
                 completed_at = COALESCE(completed_at, ?),
                 metadata = json_patch(
                   CASE WHEN json_valid(metadata) THEN metadata ELSE '{}' END,
                   ?
                 )
             WHERE id = ? AND status = 'running'`,
            [
              attemptOutcome,
              attemptNote,
              ts,
              toJson({
                emergencyStop: true,
                stoppedAt: ts,
                emergencyOutcome: attemptOutcome,
                providerOutcomeUnknown: attemptOutcome === EMERGENCY_OUTCOMES.unknown,
                providerResultRecorded: attemptOutcome === EMERGENCY_OUTCOMES.knownProviderResult,
                claimInvalidated: true,
              }),
              attemptEvidence.attempt.id,
            ],
          );
        }
        run(
          db,
          `UPDATE tasks
           SET status = 'needs_attention',
               outcome_status = ?,
               error = COALESCE(error, ?), completed_at = COALESCE(completed_at, ?),
               claim_token = NULL, claimed_at = NULL, updated_at = ?,
               result = json_patch(
                 CASE WHEN json_valid(result) THEN result ELSE '{}' END,
                 ?
               )
           WHERE id = ?`,
          [
            evidence.outcome,
            taskNote,
            ts,
            ts,
            toJson({
              emergencyStop: true,
              stoppedAt: ts,
              emergencyOutcome: evidence.outcome,
              providerOutcomeUnknown: providerUnknown,
              providerResultRecorded,
              claimInvalidated: true,
            }),
            item.id,
          ],
        );
        if (item.workflow_id) {
          const currentStep = providerUnknown
            ? `Review the unknown provider outcome for ${item.title}`
            : providerResultRecorded
              ? `Review the retained provider result for ${item.title}`
              : `Review the interrupted work for ${item.title}`;
          run(
            db,
            `UPDATE workflows
             SET status = 'needs_attention', current_step = ?, approval_required = 1, updated_at = ?
             WHERE id = ?
               AND status NOT IN (
                 'cancelled', 'failed', 'needs_changes', 'ready_for_review',
                 'dry_run_complete', 'completed', 'archived'
               )`,
            [currentStep, ts, item.workflow_id],
          );
        }
        for (const call of evidence.uncertainCalls) {
          run(
            db,
            `UPDATE model_calls
             SET status = 'needs_attention', outcome_status = 'unknown',
                 cost_status = 'unknown',
                 error_kind = 'operator_emergency_stop',
                 error = COALESCE(error, ?), completed_at = COALESCE(completed_at, ?),
                 metadata = json_patch(
                   CASE WHEN json_valid(metadata) THEN metadata ELSE '{}' END,
                   ?
                 )
             WHERE id = ?
               AND (
                 status IN ('dispatching', 'running')
                 OR (
                   completed_at IS NULL
                   AND outcome_status IN ('provider_dispatched', 'unknown')
                 )
               )`,
            [
              taskNote,
              ts,
              toJson({
                emergencyStop: true,
                stoppedAt: ts,
                providerOutcomeUnknown: true,
                exactBillingPending: true,
              }),
              call.id,
            ],
          );
        }
        if (providerUnknown) {
          run(
            db,
            `UPDATE budget_reservations
             SET status = 'unknown', resolved_at = NULL,
                 metadata = json_patch(
                   CASE WHEN json_valid(metadata) THEN metadata ELSE '{}' END,
                   ?
                 )
             WHERE task_id = ? AND status = 'reserved'`,
            [
              toJson({
                emergencyStop: true,
                stoppedAt: ts,
                providerOutcomeUnknown: true,
                exactBillingPending: true,
              }),
              item.id,
            ],
          );
        }
        if (providerUnknown && preventureAssignment) {
          recordPreventureEmergencyUnknownCost(db, item.id, ts);
        }
      }
      run(
        db,
        `INSERT INTO events (ts, level, actor, type, entity_type, entity_id, message, metadata)
         VALUES (?, 'error', 'operator', 'runtime.emergency_stop_recorded',
                 'runtime', 'pantheon', ?, ?)`,
        [
          ts,
          "Pantheon recorded unfinished work before an emergency stop.",
          toJson({
            affectedTaskIds: active.map((item) => item.id),
            providerOutcomesUnknown,
            knownProviderResultsNeedReview,
            interruptedBeforeProvider,
          }),
        ],
      );
    };
    const safetyTaskIds = emergencyItems
      .filter((entry) => entry.providerUnknown && entry.preventureAssignment)
      .map((entry) => entry.item.id);
    if (safetyTaskIds.length) {
      withPreventureEmergencyCostSafetyCapability(
        db,
        { stoppedAt: ts, taskIds: safetyTaskIds },
        recordEmergencyState,
      );
    } else {
      recordEmergencyState();
    }
    if (ownsTransaction) db.exec("COMMIT");
  } catch (error) {
    if (ownsTransaction && db.isTransaction) db.exec("ROLLBACK");
    throw error;
  }
  return { affectedTasks: active.length, providerOutcomesUnknown };
}

async function emergencyStopPantheon(db) {
  const recorded = markEmergencyStopUnknown(db);
  const handoff = await requestControlAction("stop");
  return { ...handoff, ...recorded };
}

function createRuntimeSupervisor(db) {
  return Object.freeze({
    contract: "RuntimeSupervisor.v1",
    state: () => getRuntimeControlState(db),
    activeWork: () => runningWork(db),
    returnToStandby: () => returnToStandby(db),
    stop: () => stopPantheon(db),
    emergencyStop: () => emergencyStopPantheon(db),
  });
}

module.exports = {
  controlConfiguration,
  createRuntimeSupervisor,
  emergencyStopPantheon,
  getRuntimeControlState,
  markEmergencyStopUnknown,
  returnToStandby,
  runningWork,
  stopPantheon,
};
