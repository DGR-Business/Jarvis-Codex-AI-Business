const { all, fromJson, get, insertEvent, now, randomId, run, toJson } = require("../db");
const { runOnce } = require("./orchestrator");
const { approveInternalWorkWithinMandate, ensureOperatingMandate } = require("./pantheon-policy");
const {
  getOpportunityState,
  pendingCommercialTask,
  projectCompletedCommercialTask,
  startOpportunityRound,
} = require("./pantheon-opportunities");
const {
  completedUnprojectedProductionTask,
  getProductionState,
  pendingProductionTask,
  projectCompletedProductionTask,
} = require("./pantheon-production");
const { recoverSetupBlockedTasks } = require("./spend-gate");

const RUNNABLE = new Set(["queued", "planned"]);
const WAITING = new Set(["blocked", "waiting_approval", "needs_attention", "running"]);

function parseCycle(row) {
  return row ? { ...row, metadata: fromJson(row.metadata, {}) } : null;
}

function currentClaimedCycle(db) {
  const cutoff = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  run(
    db,
    `UPDATE supervisor_cycles
     SET status = 'abandoned', error = COALESCE(error, 'Supervisor lease expired before completion.'),
         completed_at = COALESCE(completed_at, ?), updated_at = ?
     WHERE status = 'running' AND started_at < ?`,
    [now(), now(), cutoff],
  );
  return parseCycle(get(
    db,
    `SELECT * FROM supervisor_cycles
     WHERE status = 'running'
       AND started_at >= ?
     ORDER BY started_at DESC LIMIT 1`,
    [cutoff],
  ));
}

function createCycle(db, options = {}) {
  const existing = currentClaimedCycle(db);
  if (existing) return { cycle: existing, claimed: false };
  const id = `supervisor_cycle_${randomId()}`;
  const ts = now();
  run(
    db,
    `INSERT INTO supervisor_cycles
     (id, venture_id, workflow_id, trigger_type, trigger_id, status, summary,
      started_at, metadata, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'running', '', ?, ?, ?, ?)`,
    [
      id,
      options.ventureId || null,
      options.workflowId || null,
      options.triggerType || "scheduled",
      options.triggerId || null,
      ts,
      toJson({ maxSteps: options.maxSteps || 4, startedBy: options.startedBy || "pantheon" }),
      ts,
      ts,
    ],
  );
  return { cycle: parseCycle(get(db, "SELECT * FROM supervisor_cycles WHERE id = ?", [id])), claimed: true };
}

function finishCycle(db, cycleId, payload = {}) {
  const ts = now();
  run(
    db,
    `UPDATE supervisor_cycles
     SET venture_id = COALESCE(?, venture_id), workflow_id = COALESCE(?, workflow_id),
         status = ?, decision_type = ?, next_action_type = ?, worker_id = ?, task_id = ?,
         approval_id = ?, summary = ?, error = ?, completed_at = ?, metadata = ?, updated_at = ?
     WHERE id = ?`,
    [
      payload.ventureId || null,
      payload.workflowId || null,
      payload.status || "completed",
      payload.decisionType || null,
      payload.nextActionType || null,
      payload.workerId || null,
      payload.taskId || null,
      payload.approvalId || null,
      payload.summary || "",
      payload.error || null,
      ts,
      toJson(payload.metadata || {}),
      ts,
      cycleId,
    ],
  );
  return parseCycle(get(db, "SELECT * FROM supervisor_cycles WHERE id = ?", [cycleId]));
}

function completedUnprojectedOpportunityTask(db) {
  const rows = all(
    db,
    `SELECT tasks.*, opportunity_rounds.metadata AS round_metadata
     FROM tasks
     JOIN opportunity_rounds
       ON opportunity_rounds.id = json_extract(tasks.payload, '$.liveSpendRequest.parameters.pantheonCommercial.roundId')
     WHERE tasks.kind = 'live_ai_worker_execution'
       AND tasks.status = 'completed'
       AND json_extract(tasks.payload, '$.liveSpendRequest.parameters.pantheonCommercial.supervisorOwned') = 1
     ORDER BY tasks.completed_at ASC, tasks.created_at ASC`,
  );
  return rows.find((row) => {
    const roundMetadata = fromJson(row.round_metadata, {});
    return !(roundMetadata.projectedTaskIds || []).includes(row.id);
  }) || null;
}

function completedUnprojectedTask(db) {
  return completedUnprojectedOpportunityTask(db) || completedUnprojectedProductionTask(db);
}

function pendingPantheonTask(db) {
  const tasks = [pendingCommercialTask(db), pendingProductionTask(db)].filter(Boolean);
  return tasks.sort((a, b) => (
    Number(a.priority || 100) - Number(b.priority || 100)
    || String(a.created_at || "").localeCompare(String(b.created_at || ""))
  ))[0] || null;
}

function projectPantheonTask(db, task) {
  const commercial = projectCompletedCommercialTask(db, task.id);
  if (commercial.projected || commercial.reason !== "not_pantheon_commercial_work") return commercial;
  return projectCompletedProductionTask(db, task.id);
}

function exactApproval(db, task) {
  const id = task?.approval_id
    || fromJson(task?.payload, {})?.liveSpendRequest?.approvalId
    || null;
  return id ? get(db, "SELECT * FROM approvals WHERE id = ?", [id]) : null;
}

function operatorBoundary(task, approval) {
  if (!task) return null;
  if (task.status === "needs_attention") {
    return {
      status: "needs_attention",
      nextActionType: "review_failed_internal_work",
      summary: task.error || "An internal AI worker needs review before Pantheon can continue.",
    };
  }
  if (task.status === "running") {
    return {
      status: "waiting",
      nextActionType: "wait_for_running_worker",
      summary: "A Pantheon worker is already running.",
    };
  }
  if (task.status === "blocked" && !approval) {
    return {
      status: "waiting_for_operator",
      nextActionType: task.setup_block_reason ? "complete_required_setup" : "review_prerequisite",
      summary: task.setup_block_reason || "A prerequisite decision is required before this internal work can run.",
    };
  }
  return null;
}

async function runPantheonSupervisorCycle(db, options = {}) {
  ensureOperatingMandate(db);
  recoverSetupBlockedTasks(db);
  const existingCycle = currentClaimedCycle(db);
  if (existingCycle) {
    return {
      status: "already_running",
      cycle: existingCycle,
      actions: [],
      state: getOpportunityState(db),
    };
  }
  if (
    options.allowDiscoveryStart !== true
    && !pendingPantheonTask(db)
    && !completedUnprojectedTask(db)
  ) {
    return {
      status: "idle",
      cycle: {
        id: null,
        status: "idle",
        trigger_type: options.triggerType || "scheduled",
        next_action_type: "await_next_trigger",
        summary: "Pantheon has no runnable commercial work.",
        metadata: { persisted: false, reason: "no_work" },
      },
      actions: [],
      state: getOpportunityState(db),
    };
  }
  const claim = createCycle(db, options);
  if (!claim.claimed) return { status: "already_running", cycle: claim.cycle, state: getOpportunityState(db) };

  const cycleId = claim.cycle.id;
  const maxSteps = Math.max(1, Math.min(Number(options.maxSteps || 4), 12));
  const actions = [];
  try {
    if (!pendingPantheonTask(db) && !completedUnprojectedTask(db) && options.allowDiscoveryStart === true) {
      const started = startOpportunityRound(db, {
        prompt: options.prompt,
        source: options.startedBy || "pantheon-supervisor",
      });
      actions.push({
        type: started.alreadyRunning ? "discovery_already_running" : "discovery_started",
        roundId: started.round.id,
        taskId: started.queued?.task?.id || null,
      });
    }

    for (let index = 0; index < maxSteps; index += 1) {
      const completed = completedUnprojectedTask(db);
      if (completed) {
        const projection = projectPantheonTask(db, completed);
        actions.push({
          type: "result_projected",
          taskId: completed.id,
          step: projection.step || projection.stage,
        });
        continue;
      }

      const task = pendingPantheonTask(db);
      if (!task) {
        const state = getOpportunityState(db);
        const production = getProductionState(db);
        const ready = state.topOpportunity?.status === "ready_to_build"
          || production.plans.some((plan) => ["waiting_for_build_decision", "launch_decision"].includes(plan.status));
        const cycle = finishCycle(db, cycleId, {
          ventureId: state.latestRound?.venture_id || null,
          workflowId: state.latestRound?.metadata?.workflowId || null,
          status: ready ? "decision_ready" : "idle",
          decisionType: ready ? "build_venture" : null,
          nextActionType: ready ? "review_venture_choice" : "await_next_trigger",
          summary: ready
            ? `${state.topOpportunity.title} is ready for Daniel's build decision.`
            : "Pantheon has no runnable commercial work.",
          metadata: { actions, production },
        });
        return { status: cycle.status, cycle, actions, state };
      }

      let approval = exactApproval(db, task);
      const boundary = operatorBoundary(task, approval);
      if (boundary) {
        const state = getOpportunityState(db);
        const cycle = finishCycle(db, cycleId, {
          ventureId: task.venture_id,
          workflowId: task.workflow_id,
          workerId: task.agent,
          taskId: task.id,
          approvalId: approval?.id || null,
          ...boundary,
          metadata: { actions, setupBlocked: Boolean(task.setup_block_reason) },
        });
        return { status: cycle.status, cycle, actions, state };
      }

      if (approval?.status === "pending") {
        const mandate = approveInternalWorkWithinMandate(db, approval.id);
        actions.push({
          type: mandate.approved ? "internal_work_authorized" : "internal_work_stopped",
          taskId: task.id,
          approvalId: approval.id,
          reason: mandate.reason || null,
        });
        if (!mandate.approved) {
          const state = getOpportunityState(db);
          const cycle = finishCycle(db, cycleId, {
            ventureId: task.venture_id,
            workflowId: task.workflow_id,
            status: "waiting_for_operator",
            decisionType: "operating_mandate",
            nextActionType: mandate.reason === "monthly_mandate_exceeded" ? "review_monthly_budget" : "review_internal_work",
            workerId: task.agent,
            taskId: task.id,
            approvalId: approval.id,
            summary: mandate.reason === "monthly_mandate_exceeded"
              ? "Pantheon stopped before exceeding the monthly operating mandate."
              : "This internal action is outside Pantheon's automatic operating mandate.",
            metadata: { actions, reason: mandate.reason },
          });
          return { status: cycle.status, cycle, actions, state };
        }
        approval = exactApproval(db, get(db, "SELECT * FROM tasks WHERE id = ?", [task.id]));
      }

      const refreshedTask = get(db, "SELECT * FROM tasks WHERE id = ?", [task.id]);
      if (!RUNNABLE.has(refreshedTask.status)) {
        const state = getOpportunityState(db);
        const cycle = finishCycle(db, cycleId, {
          ventureId: refreshedTask.venture_id,
          workflowId: refreshedTask.workflow_id,
          status: WAITING.has(refreshedTask.status) ? "waiting" : "needs_attention",
          nextActionType: "review_worker_state",
          workerId: refreshedTask.agent,
          taskId: refreshedTask.id,
          approvalId: approval?.id || null,
          summary: `Pantheon stopped because ${refreshedTask.title} is ${refreshedTask.status.replaceAll("_", " ")}.`,
          metadata: { actions, taskStatus: refreshedTask.status },
        });
        return { status: cycle.status, cycle, actions, state };
      }

      const result = await runOnce(db, {
        workflowId: refreshedTask.workflow_id,
        taskId: refreshedTask.id,
        claimant: "pantheon-supervisor",
      });
      actions.push({ type: "worker_run", taskId: refreshedTask.id, workerId: refreshedTask.agent, status: result.status });
      if (result.status !== "completed") {
        const state = getOpportunityState(db);
        const cycle = finishCycle(db, cycleId, {
          ventureId: refreshedTask.venture_id,
          workflowId: refreshedTask.workflow_id,
          status: result.status === "blocked" ? "waiting_for_operator" : "needs_attention",
          nextActionType: result.status === "blocked" ? "complete_required_setup" : "review_failed_internal_work",
          workerId: refreshedTask.agent,
          taskId: refreshedTask.id,
          approvalId: approval?.id || null,
          summary: result.error || `Pantheon worker stopped with status ${result.status}.`,
          error: result.error || null,
          metadata: { actions, resultStatus: result.status },
        });
        return { status: cycle.status, cycle, actions, result, state };
      }
    }

    const state = getOpportunityState(db);
    const currentTask = pendingPantheonTask(db);
    const cycle = finishCycle(db, cycleId, {
      ventureId: state.latestRound?.venture_id || currentTask?.venture_id || null,
      workflowId: state.latestRound?.metadata?.workflowId || currentTask?.workflow_id || null,
      status: "step_limit",
      nextActionType: currentTask ? "continue_internal_work" : "review_current_state",
      workerId: currentTask?.agent || null,
      taskId: currentTask?.id || null,
      approvalId: currentTask?.approval_id || null,
      summary: `Pantheon completed ${actions.length} supervised action${actions.length === 1 ? "" : "s"} and paused at its cycle limit.`,
      metadata: { actions, maxSteps },
    });
    return { status: cycle.status, cycle, actions, state };
  } catch (error) {
    const task = pendingPantheonTask(db);
    const cycle = finishCycle(db, cycleId, {
      ventureId: task?.venture_id || null,
      workflowId: task?.workflow_id || null,
      status: "needs_attention",
      nextActionType: "developer_review_required",
      workerId: task?.agent || null,
      taskId: task?.id || null,
      approvalId: task?.approval_id || null,
      summary: "Pantheon stopped safely because its commercial supervisor encountered an internal error.",
      error: error.message,
      metadata: { actions, stack: process.env.NODE_ENV === "test" ? error.stack : undefined },
    });
    insertEvent(db, {
      level: "error",
      actor: "pantheon-supervisor",
      type: "pantheon.supervisor.failed",
      entityType: "supervisor_cycle",
      entityId: cycleId,
      message: "Pantheon's commercial supervisor stopped safely and needs Jarvis review.",
      metadata: { error: error.message, taskId: task?.id || null },
    });
    return { status: cycle.status, cycle, actions, error: error.message, state: getOpportunityState(db) };
  }
}

function getPantheonSupervisorState(db) {
  const current = parseCycle(get(
    db,
    "SELECT * FROM supervisor_cycles WHERE status = 'running' ORDER BY created_at DESC LIMIT 1",
  ));
  const latest = parseCycle(get(
    db,
    "SELECT * FROM supervisor_cycles ORDER BY created_at DESC LIMIT 1",
  ));
  return {
    schema: "pantheon_supervisor_state_v1",
    current,
    latest,
    recent: all(db, "SELECT * FROM supervisor_cycles ORDER BY created_at DESC LIMIT 30").map(parseCycle),
    opportunity: getOpportunityState(db),
    production: getProductionState(db),
  };
}

module.exports = {
  getPantheonSupervisorState,
  runPantheonSupervisorCycle,
};
