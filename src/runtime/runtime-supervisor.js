const { all, fromJson, now, run, toJson } = require("../db");

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
    `SELECT tasks.id, tasks.title, tasks.agent, tasks.status, tasks.outcome_status,
            task_attempts.id AS attempt_id, task_attempts.status AS attempt_status,
            task_attempts.outcome_status AS attempt_outcome_status,
            model_calls.id AS model_call_id, model_calls.status AS model_call_status,
            model_calls.outcome_status AS model_call_outcome_status,
            model_calls.provider_request_id
     FROM tasks
     LEFT JOIN task_attempts
       ON task_attempts.task_id = tasks.id
      AND task_attempts.status = 'running'
     LEFT JOIN model_calls
       ON model_calls.task_id = tasks.id
      AND model_calls.status = 'running'
     WHERE tasks.status = 'running'
        OR task_attempts.status = 'running'
        OR model_calls.status = 'running'
     ORDER BY tasks.created_at ASC`,
  );
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
      providerDispatched: Boolean(item.provider_request_id),
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

function markEmergencyStopUnknown(db, note = "Pantheon was stopped before the provider outcome could be confirmed.") {
  const active = runningWork(db);
  if (!active.length) return { affectedTasks: 0, providerOutcomesUnknown: 0 };
  const ts = now();
  let providerOutcomesUnknown = 0;
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const item of active) {
      const providerUnknown = Boolean(item.provider_request_id || item.model_call_id);
      if (providerUnknown) providerOutcomesUnknown += 1;
      if (item.model_call_id) {
        run(
          db,
          `UPDATE model_calls
           SET status = 'needs_attention', outcome_status = 'unknown',
               cost_status = CASE WHEN cost_status = 'reserved' THEN 'unknown' ELSE cost_status END,
               error_kind = 'operator_emergency_stop',
               error = COALESCE(error, ?), completed_at = COALESCE(completed_at, ?)
           WHERE id = ? AND status = 'running'`,
          [note, ts, item.model_call_id],
        );
      }
      if (item.attempt_id) {
        run(
          db,
          `UPDATE task_attempts
           SET status = 'needs_attention',
               outcome_status = CASE WHEN ? = 1 THEN 'unknown' ELSE 'interrupted' END,
               error_kind = 'operator_emergency_stop', error = COALESCE(error, ?),
               completed_at = COALESCE(completed_at, ?),
               metadata = json_patch(
                 CASE WHEN json_valid(metadata) THEN metadata ELSE '{}' END,
                 ?
               )
           WHERE id = ? AND status = 'running'`,
          [
            providerUnknown ? 1 : 0,
            note,
            ts,
            toJson({ emergencyStop: true, stoppedAt: ts }),
            item.attempt_id,
          ],
        );
      }
      run(
        db,
        `UPDATE tasks
         SET status = 'needs_attention',
             outcome_status = CASE WHEN ? = 1 THEN 'unknown' ELSE 'interrupted' END,
             error = COALESCE(error, ?), completed_at = COALESCE(completed_at, ?),
             result = json_patch(
               CASE WHEN json_valid(result) THEN result ELSE '{}' END,
               ?
             )
         WHERE id = ?`,
        [
          providerUnknown ? 1 : 0,
          note,
          ts,
          toJson({ emergencyStop: true, stoppedAt: ts, providerOutcomeUnknown: providerUnknown }),
          item.id,
        ],
      );
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
        }),
      ],
    );
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
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
