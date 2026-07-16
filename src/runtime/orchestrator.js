const CONFIG = require("../config");
const { createDigitalProductDraft } = require("../adapters/digital-products");
const { createProductDraft } = require("../adapters/gelato");
const { queueApprovalEscalation, sendEscalation } = require("../adapters/notifications");
const { all, fromJson, get, insertEvent, now, randomId, run, toJson } = require("../db");
const { runAgentTask } = require("./agent-runner");
const { isAgentToolApprovalRequiredError } = require("./agent-tool-gate");
const { recordAgentWorkbenchTeamSummary } = require("./agent-workbench");
const { generateApprovalPack } = require("./approval-pack");
const { ensureSpendApproval } = require("./spend-gate");
const { upsertWorkflowScorecard } = require("./scorecard");
const { consumeApproval, validateApprovalScope } = require("./approval-scope");
const { reserveBudget, resolveReservation } = require("./cost-ledger");
const { claimNextTask, completeTaskClaim, releaseTaskClaim } = require("./task-claims");

function hydrateTask(task) {
  if (!task) return null;
  return {
    ...task,
    payload: fromJson(task.payload),
    result: fromJson(task.result),
  };
}

function hydrateWorkflow(workflow) {
  if (!workflow) return null;
  return {
    ...workflow,
    metadata: fromJson(workflow.metadata),
  };
}

function nextRunnableTask(db, workflowId) {
  const params = [];
  let clause = "status IN ('queued', 'planned')";
  if (workflowId) {
    clause += " AND workflow_id = ?";
    params.push(workflowId);
  }
  return hydrateTask(
    get(
      db,
      `SELECT * FROM tasks WHERE ${clause}
       ORDER BY CASE status WHEN 'queued' THEN 0 ELSE 1 END, priority ASC, created_at ASC LIMIT 1`,
      params,
    ),
  );
}

function blockedTasks(db, workflowId) {
  const params = [];
  let clause = "tasks.status = 'blocked'";
  if (workflowId) {
    clause += " AND tasks.workflow_id = ?";
    params.push(workflowId);
  }
  return all(
    db,
    `SELECT tasks.*, approvals.status AS approval_status, approvals.title AS approval_title
     FROM tasks
     LEFT JOIN approvals ON approvals.id = tasks.approval_id
     WHERE ${clause}
     ORDER BY tasks.priority ASC, tasks.created_at ASC`,
    params,
  );
}

async function markBlocked(db, task, approval, metadata = {}) {
  const ts = now();
  run(
    db,
    `UPDATE tasks SET status = 'blocked', approval_id = ?, result = ?, updated_at = ? WHERE id = ?`,
    [approval.id || task.approval_id || null, toJson({ blockedBy: approval.id, approvalStatus: approval.status, ...metadata }), ts, task.id],
  );
  run(
    db,
    `UPDATE workflows SET status = 'blocked_for_approval', current_step = ?, updated_at = ? WHERE id = ?`,
    [approval.title, ts, task.workflow_id],
  );
  insertEvent(db, {
    level: "warn",
    actor: "orchestrator",
    type: "task.blocked_for_approval",
    entityType: "task",
    entityId: task.id,
    message: `${task.title} is blocked until approval ${approval.id} is decided.`,
    metadata,
  });
  if (approval.status === "pending") {
    return queueApprovalEscalation(db, approval, task, { dryRun: CONFIG.dryRun });
  }
  return sendEscalation({ subject: approval.title }, { channels: ["dashboard", "email"], dryRun: CONFIG.dryRun });
}

async function executeTask(db, task) {
  const workflow = hydrateWorkflow(get(db, "SELECT * FROM workflows WHERE id = ?", [task.workflow_id]));
  if (!workflow) throw new Error(`Workflow missing for task ${task.id}`);

  if (task.kind === "publish_gelato_dry_run") {
    const result = await createProductDraft(workflow, { dryRun: true });
    run(
      db,
      `INSERT INTO costs (id, workflow_id, category, source, status, amount_cents, currency, occurred_at, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        `cost_${randomId()}`,
        workflow.id,
        "supplier_publish_proof",
        "gelato",
        "estimated",
        0,
        CONFIG.currency,
        now(),
        toJson({ dryRun: true, note: "No spend occurred." }),
      ],
    );
    return result;
  }

  if (task.kind === "publish_digital_product_dry_run") {
    const result = await createDigitalProductDraft(workflow, { dryRun: true });
    run(
      db,
      `INSERT INTO costs (id, workflow_id, category, source, status, amount_cents, currency, occurred_at, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        `cost_${randomId()}`,
        workflow.id,
        "digital_product_publish_proof",
        "digital-products",
        "estimated",
        0,
        CONFIG.currency,
        now(),
        toJson({ dryRun: true, note: "No spend occurred." }),
      ],
    );
    return result;
  }

  return runAgentTask(db, task);
}

function remainingWorkflowTasks(db, workflowId) {
  const row = get(
    db,
    `SELECT COUNT(*) AS count
     FROM tasks
     WHERE workflow_id = ? AND status IN ('planned', 'queued', 'blocked', 'running')`,
    [workflowId],
  );
  return row ? row.count : 0;
}

function updateWorkflowAfterCompletion(db, task, result, done) {
  if (task.kind === "publish_gelato_dry_run") {
    run(
      db,
      `UPDATE workflows SET status = 'dry_run_complete', current_step = 'ready for live-publish approval design', approval_required = 1, updated_at = ? WHERE id = ?`,
      [done, task.workflow_id],
    );
    return;
  }

  if (task.kind === "publish_digital_product_dry_run") {
    run(
      db,
      `UPDATE workflows SET status = 'dry_run_complete', current_step = 'ready for digital-product approval review', approval_required = 1, updated_at = ? WHERE id = ?`,
      [done, task.workflow_id],
    );
    upsertWorkflowScorecard(db, task.workflow_id, { taskId: task.id });
    return;
  }

  const remaining = remainingWorkflowTasks(db, task.workflow_id);
  const qualityScore = Number(result.output?.qualityScore || 0);

  if (remaining === 0 || task.kind === "operator_pack_qc") {
    const teamSummary = recordAgentWorkbenchTeamSummary(db, task.workflow_id);
    run(
      db,
      `UPDATE workflows
       SET status = 'ready_for_review', current_step = 'operator review pack ready',
           quality_score = CASE WHEN ? > quality_score THEN ? ELSE quality_score END,
           approval_required = 1, updated_at = ?
       WHERE id = ?`,
      [qualityScore, qualityScore, done, task.workflow_id],
    );
    run(db, "UPDATE commands SET status = 'ready_for_review', updated_at = ? WHERE workflow_id = ?", [done, task.workflow_id]);
    const scorecard = upsertWorkflowScorecard(db, task.workflow_id, { taskId: task.id });
    const approvalPack = generateApprovalPack(db, task.workflow_id, { taskId: task.id });
    const reviewSubject = teamSummary ? "AI Team drill summary ready" : "Operator review pack ready";
    const reviewBody = teamSummary
      ? `${teamSummary.operatorSummary} ${teamSummary.nextAction}`
      : "Dry-run agent execution has prepared review deliverables, a commercial scorecard, and a PDF approval pack. Treat them as process proof until live research and paid model/tool adapters are approved.";
    run(
      db,
      `INSERT INTO messages (id, task_id, severity, status, subject, body, created_at, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [`msg_review_${randomId()}`, task.id, "approval", "open", reviewSubject, reviewBody, done, toJson({ workflowId: task.workflow_id, taskKind: task.kind, scorecardId: scorecard.id, approvalPack, teamSummary })],
    );
    return;
  }

  run(
    db,
    `UPDATE workflows SET status = 'agent_running', current_step = ?, updated_at = ? WHERE id = ?`,
    [`completed ${task.title}; ${remaining} safe task${remaining === 1 ? "" : "s"} remaining`, done, task.workflow_id],
  );
}

async function runOnce(db, options = {}) {
  const claim = claimNextTask(db, { workflowId: options.workflowId, claimant: options.claimant || "orchestrator" });
  if (!claim) {
    const blocked = blockedTasks(db, options.workflowId);
    if (blocked.length > 0) {
      const escalations = [];
      for (const blockedTask of blocked) {
        if (!blockedTask.approval_id) continue;
        const approval = get(db, "SELECT * FROM approvals WHERE id = ?", [blockedTask.approval_id]);
        if (approval?.status === "pending") {
          const escalation = queueApprovalEscalation(db, approval, blockedTask, { dryRun: CONFIG.dryRun });
          if (escalation) escalations.push(escalation);
        }
      }
      return {
        status: "blocked",
        message: "No runnable tasks. The next task needs operator approval.",
        blocked,
        escalations,
      };
    }
    return { status: "idle", message: "No queued tasks." };
  }
  const task = claim.task;

  const spendGate = ensureSpendApproval(db, task);
  if (spendGate.required && !spendGate.approved) {
    releaseTaskClaim(db, claim, "blocked", {
      outcomeStatus: "not_started",
      setupBlockReason: spendGate.providerBlocked ? "Provider setup is incomplete." : null,
      metadata: { approvalId: spendGate.approval?.id || null, noProviderCall: true },
    });
    return { status: "blocked", task, approval: spendGate.approval, spendGate };
  }

  const approvalId = spendGate.approval?.id || task.approval_id || null;
  let approval = approvalId ? get(db, "SELECT * FROM approvals WHERE id = ?", [approvalId]) : null;
  if (approvalId) {
    if (!approval || approval.status !== "approved") {
      await markBlocked(db, task, approval || { id: task.approval_id, status: "missing", title: "Missing approval" });
      releaseTaskClaim(db, claim, "blocked", { outcomeStatus: "not_started", metadata: { noProviderCall: true } });
      return { status: "blocked", task, approval };
    }
    const validation = validateApprovalScope(db, approvalId, { ...task, approval_id: approvalId });
    if (!validation.valid) {
      const blockedAt = now();
      run(db, "UPDATE approvals SET status = 'superseded', decision_note = ? WHERE id = ?", [validation.reason, approvalId]);
      run(db, "UPDATE workflows SET status = 'needs_changes', current_step = ?, updated_at = ? WHERE id = ?", [validation.reason, blockedAt, task.workflow_id]);
      releaseTaskClaim(db, claim, "needs_changes", {
        outcomeStatus: "not_started",
        error: validation.reason,
        errorKind: "approval_scope_changed",
        metadata: { approvalId, noProviderCall: true },
      });
      return { status: "needs_changes", task, approval: validation.approval, error: validation.reason };
    }
    approval = validation.approval;
  }

  let reservation = null;
  if (spendGate.required) {
    reservation = reserveBudget(db, task, approval, spendGate.estimatedCostCents);
  }
  if (approvalId) consumeApproval(db, approvalId, { ...task, approval_id: approvalId });

  insertEvent(db, {
    actor: task.agent,
    type: "task.started",
    entityType: "task",
    entityId: task.id,
    message: `${task.agent} started ${task.title}.`,
  });

  try {
    const result = await executeTask(db, task);
    const done = now();
    const incurredEstimateCents = Number(result.incurredEstimateCents ?? result.actualCents ?? result.modelCall?.incurredEstimateCents ?? 0);
    const reconciledCostCents = result.costStatus === "reconciled" ? Number(result.reconciledCostCents || 0) : 0;
    if (reservation) {
      resolveReservation(db, task.id, incurredEstimateCents > 0 ? "incurred_estimate" : "released", {
        amountCents: incurredEstimateCents,
        metadata: { providerRequestId: result.raw?.responseId || result.id || null },
      });
    }
    completeTaskClaim(db, claim, {
      status: "completed",
      result,
      completedAt: done,
      reconciledCostCents,
      outcomeStatus: "known",
      providerRequestId: result.raw?.responseId || result.id || null,
      metadata: { costStatus: result.costStatus || (incurredEstimateCents > 0 ? "incurred_estimate" : "none") },
    });
    updateWorkflowAfterCompletion(db, task, result, done);
    insertEvent(db, {
      actor: task.agent,
      type: "task.completed",
      entityType: "task",
      entityId: task.id,
      message: ["publish_gelato_dry_run", "publish_digital_product_dry_run"].includes(task.kind)
        ? `${task.title} completed in dry-run mode. No external listing was created.`
        : `${task.title} completed by the dry-run agent runner.`,
      metadata: result,
    });
    return { status: "completed", task: { ...task, result }, result };
  } catch (error) {
    if (isAgentToolApprovalRequiredError(error)) {
      const approval = get(db, "SELECT * FROM approvals WHERE id = ?", [error.approvalId]);
      const escalation = await markBlocked(db, task, approval || {
        id: error.approvalId,
        status: "pending",
        title: "Worker tool approval required",
      }, {
        agentToolApprovalRequired: true,
        invocationId: error.invocationId,
        toolId: error.toolId,
        runId: error.runId,
        noSpendOccurred: true,
      });
      if (reservation) resolveReservation(db, task.id, "released", { amountCents: 0, metadata: { noProviderCall: true } });
      releaseTaskClaim(db, claim, "blocked", {
        outcomeStatus: "not_started",
        errorKind: "tool_approval_required",
        metadata: { approvalId: error.approvalId, noProviderCall: true },
      });
      return {
        status: "blocked",
        task,
        approval,
        escalation,
        toolGate: error.result,
      };
    }

    const outcomeUnknown = error.outcomeUnknown === true;
    const retries = task.retries + 1;
    const retryable = !outcomeUnknown && !approvalId && retries <= task.max_retries;
    const status = outcomeUnknown ? "needs_attention" : (retryable ? "queued" : "failed");
    const failedAt = now();
    run(db, "UPDATE tasks SET retries = ? WHERE id = ?", [retries, task.id]);
    if (reservation) {
      resolveReservation(db, task.id, outcomeUnknown ? "unknown" : "released", {
        metadata: { error: error.message, outcomeUnknown },
      });
    }
    if (retryable) {
      releaseTaskClaim(db, claim, "queued", {
        outcomeStatus: "failed_before_effect",
        error: error.message,
        errorKind: "retryable_internal_error",
        metadata: { outcomeUnknown: false },
      });
    } else {
      completeTaskClaim(db, claim, {
        status,
        result: { error: error.message, outcomeUnknown },
        completedAt: failedAt,
        outcomeStatus: outcomeUnknown ? "unknown" : "failed_before_effect",
        error: error.message,
        errorKind: outcomeUnknown ? "provider_outcome_unknown" : "non_retryable_error",
        metadata: { outcomeUnknown, approvalConsumed: Boolean(approvalId) },
      });
    }

    if (retryable) {
      run(
        db,
        `UPDATE workflows SET status = 'agent_retrying', current_step = ?, updated_at = ? WHERE id = ?`,
        [`retrying ${task.title} (attempt ${retries} of ${task.max_retries})`, failedAt, task.workflow_id],
      );
    } else if (outcomeUnknown) {
      run(
        db,
        `UPDATE workflows SET status = 'needs_attention', current_step = ?, approval_required = 1, updated_at = ? WHERE id = ?`,
        [`Provider outcome is unknown for ${task.title}; review before any retry`, failedAt, task.workflow_id],
      );
      run(
        db,
        `INSERT INTO messages (id, task_id, venture_id, severity, status, subject, body, created_at, metadata)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          `msg_${randomId()}`,
          task.id,
          task.venture_id,
          "urgent",
          "open",
          `Check provider outcome: ${task.title}`,
          "The provider request may have been accepted. Jarvis will not retry until the outcome and cost are reconciled.",
          failedAt,
          toJson({ workflowId: task.workflow_id, outcomeUnknown: true, approvalId }),
        ],
      );
    } else {
      run(
        db,
        `UPDATE workflows SET status = 'failed', current_step = ?, approval_required = 1, updated_at = ? WHERE id = ?`,
        [`failed: ${task.title}`, failedAt, task.workflow_id],
      );
      run(db, "UPDATE commands SET status = 'failed', updated_at = ? WHERE workflow_id = ?", [failedAt, task.workflow_id]);
      run(
        db,
        `UPDATE tasks SET status = 'cancelled', error = ?, updated_at = ?
         WHERE workflow_id = ? AND id <> ? AND status IN ('planned', 'queued')`,
        [`Blocked by failed task ${task.id}`, failedAt, task.workflow_id, task.id],
      );
      run(
        db,
        `INSERT INTO messages (id, task_id, severity, status, subject, body, created_at, metadata)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          `msg_${randomId()}`,
          task.id,
          "urgent",
          "open",
          `Task failed: ${task.title}`,
          error.message,
          failedAt,
          toJson({ retries, maxRetries: task.max_retries, workflowId: task.workflow_id }),
        ],
      );
    }
    insertEvent(db, {
      level: retryable || outcomeUnknown ? "warn" : "error",
      actor: task.agent,
      type: outcomeUnknown ? "task.outcome_unknown" : (retryable ? "task.retry" : "task.failed"),
      entityType: "task",
      entityId: task.id,
      message: outcomeUnknown
        ? `${task.title} needs review because the provider outcome is unknown.`
        : `${task.title} ${retryable ? "will retry" : "failed"}: ${error.message}`,
      metadata: { retries, maxRetries: task.max_retries, workflowId: task.workflow_id, outcomeUnknown },
    });
    return { status, task, error: error.message, retries };
  }
}

function getWorkflowStatus(db, workflowId) {
  if (!workflowId) return null;
  return get(db, "SELECT id, status, current_step FROM workflows WHERE id = ?", [workflowId]);
}

function shouldStopAfterStep(db, workflowId, result) {
  if (!["completed", "queued"].includes(result.status)) return true;
  const workflow = getWorkflowStatus(db, workflowId);
  if (!workflow) return false;
  return [
    "ready_for_review",
    "dry_run_complete",
    "blocked_for_approval",
    "failed",
    "cancelled",
    "needs_changes",
  ].includes(workflow.status);
}

function insertWorkflowRun(db, options, maxSteps) {
  const runId = `run_${randomId()}`;
  const ts = now();
  run(
    db,
    `INSERT INTO workflow_runs (id, workflow_id, mode, status, steps_run, started_at, metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [runId, options.workflowId || null, "safe_loop", "running", 0, ts, toJson({ maxSteps })],
  );
  return { id: runId, startedAt: ts };
}

function finishWorkflowRun(db, runRecord, payload) {
  const completedAt = now();
  run(
    db,
    `UPDATE workflow_runs
     SET status = ?, stopped_by = ?, steps_run = ?, completed_at = ?, metadata = ?
     WHERE id = ?`,
    [
      payload.status,
      payload.stoppedBy,
      payload.stepsRun,
      completedAt,
      toJson({
        workflow: payload.workflow,
        stepStatuses: payload.steps.map((step) => step.status),
        finalResultStatus: payload.result?.status || null,
      }),
      runRecord.id,
    ],
  );
  insertEvent(db, {
    actor: "orchestrator",
    type: "workflow_run.completed",
    entityType: "workflow_run",
    entityId: runRecord.id,
    message: `Safe run loop stopped with status ${payload.status} after ${payload.stepsRun} step${payload.stepsRun === 1 ? "" : "s"}.`,
    metadata: { workflowId: payload.workflow?.id || null, stoppedBy: payload.stoppedBy, stepsRun: payload.stepsRun },
  });
  return { ...payload, runId: runRecord.id, completedAt };
}

async function runUntilBlocked(db, options = {}) {
  const maxSteps = Math.max(1, Math.min(Number(options.maxSteps || 10), 50));
  const steps = [];
  const runRecord = insertWorkflowRun(db, options, maxSteps);

  for (let index = 0; index < maxSteps; index += 1) {
    const result = await runOnce(db, { workflowId: options.workflowId });
    steps.push(result);

    if (shouldStopAfterStep(db, options.workflowId, result)) {
      const workflow = getWorkflowStatus(db, options.workflowId);
      return finishWorkflowRun(db, runRecord, {
        status: workflow?.status || result.status,
        stoppedBy: result.status,
        steps,
        stepsRun: steps.length,
        workflow,
        result,
      });
    }
  }

  return finishWorkflowRun(db, runRecord, {
    status: "step_limit",
    stoppedBy: "max_steps",
    steps,
    stepsRun: steps.length,
    workflow: getWorkflowStatus(db, options.workflowId),
    result: null,
  });
}

module.exports = {
  runOnce,
  runUntilBlocked,
};
