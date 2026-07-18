const CONFIG = require("../config");
const { createDigitalProductDraft } = require("../adapters/digital-products");
const { createProductDraft } = require("../adapters/gelato");
const { queueApprovalEscalation, sendEscalation } = require("../adapters/notifications");
const { all, fromJson, get, insertEvent, now, randomId, run, toJson } = require("../db");
const { runAgentTask } = require("./agent-runner");
const {
  TOOL_APPROVAL_SCOPE_SCHEMA,
  isAgentToolApprovalRequiredError,
  validateAgentToolApprovalScope,
} = require("./agent-tool-gate");
const { recordAgentWorkbenchTeamSummary } = require("./agent-workbench");
const { generateApprovalPack } = require("./approval-pack");
const { ensureSpendApproval } = require("./spend-gate");
const { upsertWorkflowScorecard } = require("./scorecard");
const { consumeApproval, validateApprovalScope } = require("./approval-scope");
const { reserveBudget, resolveReservation } = require("./cost-ledger");
const { claimNextTask, completeTaskClaim, releaseTaskClaim } = require("./task-claims");
const { finalizeAgentExecutionReceipt } = require("./agent-execution-evidence");
const { activateRetentionPolicy } = require("./retention-policy");

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

async function executeTask(db, task, options = {}) {
  const workflow = hydrateWorkflow(get(db, "SELECT * FROM workflows WHERE id = ?", [task.workflow_id]));
  if (!workflow) throw new Error(`Workflow missing for task ${task.id}`);

  if (task.kind === "activate_retention_policy") {
    const approval = task.approval_id
      ? get(db, "SELECT * FROM approvals WHERE id = ?", [task.approval_id])
      : null;
    return activateRetentionPolicy(db, task, approval);
  }

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

  return runAgentTask(db, task, {
    taskClaim: options.taskClaim || null,
    spendApprovalState: options.spendApprovalState || null,
  });
}

function remainingWorkflowTasks(db, workflowId, completedTaskId = null) {
  const row = get(
    db,
    `SELECT COUNT(*) AS count
     FROM tasks
     WHERE workflow_id = ?
       AND status IN ('planned', 'queued', 'blocked', 'running')
       AND (? IS NULL OR id <> ?)`,
    [workflowId, completedTaskId, completedTaskId],
  );
  return row ? row.count : 0;
}

function isPantheonSupervisorOwnedTask(task) {
  const parameters = task?.payload?.liveSpendRequest?.parameters || {};
  return parameters.pantheonCommercial?.supervisorOwned === true
    || parameters.pantheonProduction?.supervisorOwned === true;
}

function updateWorkflowAfterCompletion(db, task, result, done) {
  const current = get(db, "SELECT status FROM workflows WHERE id = ?", [task.workflow_id]);
  if (["cancelled", "failed", "needs_changes", "needs_attention"].includes(current?.status)) return;
  run(
    db,
    `UPDATE messages
     SET status = 'resolved', resolved_at = COALESCE(resolved_at, ?)
     WHERE task_id = ? AND status = 'open'
       AND subject IN ('Chief of Staff follow-up queued', 'Internal work queued')`,
    [done, task.id],
  );
  if (task.kind === "activate_retention_policy") {
    run(
      db,
      `UPDATE workflows
       SET status = 'completed', current_step = 'Data protection plan active',
           quality_score = 100, approval_required = 0, updated_at = ?
       WHERE id = ?`,
      [done, task.workflow_id],
    );
    run(
      db,
      `UPDATE messages
       SET status = 'resolved', resolved_at = ?
       WHERE task_id = ? AND status = 'open'`,
      [done, task.id],
    );
    return;
  }
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

  if (isPantheonSupervisorOwnedTask(task)) {
    run(
      db,
      `UPDATE workflows
       SET status = 'agent_running', current_step = ?,
           quality_score = CASE WHEN ? > quality_score THEN ? ELSE quality_score END,
           approval_required = 0, updated_at = ?
       WHERE id = ?`,
      [
        `${task.title} finished; Pantheon is incorporating the result`,
        Number(result.output?.qualityScore || 0),
        Number(result.output?.qualityScore || 0),
        done,
        task.workflow_id,
      ],
    );
    return;
  }

  const remaining = remainingWorkflowTasks(db, task.workflow_id, task.id);
  const qualityScore = Number(result.output?.qualityScore || 0);

  if (remaining === 0 || task.kind === "operator_pack_qc") {
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
    const teamSummary = recordAgentWorkbenchTeamSummary(db, task.workflow_id, { completingTaskId: task.id });
    const isHandoffFollowup = task.kind === "handoff_followup";
    const reviewSubject = teamSummary
      ? "AI Team drill summary ready"
      : isHandoffFollowup
        ? "Chief of Staff recommendation ready"
        : "Operator review pack ready";
    const reviewBody = teamSummary
      ? `${teamSummary.operatorSummary} ${teamSummary.nextAction}`
      : isHandoffFollowup
        ? "Chief of Staff prepared the next safe internal recommendation. Nothing was published, sent, or purchased."
        : task.kind === "live_ai_worker_execution"
          ? "The AI result, evidence record, scorecard, and review PDF are ready. Review the result before choosing the next business step."
          : "Internal work prepared review deliverables, a commercial scorecard, and a PDF decision brief.";
    const existingRecommendation = isHandoffFollowup
      ? get(
        db,
        "SELECT id FROM messages WHERE task_id = ? AND subject = ? AND status = 'open' LIMIT 1",
        [task.id, reviewSubject],
      )
      : null;
    if (!existingRecommendation) {
      run(
        db,
        `INSERT INTO messages (id, task_id, severity, status, subject, body, created_at, metadata)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [`msg_review_${randomId()}`, task.id, isHandoffFollowup ? "info" : "approval", "open", reviewSubject, reviewBody, done, toJson({ workflowId: task.workflow_id, taskKind: task.kind, scorecardId: scorecard.id, approvalPack, teamSummary })],
      );
    }
    return;
  }

  run(
    db,
    `UPDATE workflows SET status = 'agent_running', current_step = ?, updated_at = ? WHERE id = ?`,
    [`completed ${task.title}; ${remaining} safe task${remaining === 1 ? "" : "s"} remaining`, done, task.workflow_id],
  );
}

function markReceiptFinalizationNeedsAttention(db, claim, task, receiptError) {
  const failedAt = now();
  const message = `Pantheon could not finalize exact execution evidence for ${task.title}: ${receiptError.message}`;
  const attempt = get(db, "SELECT metadata FROM task_attempts WHERE id = ?", [claim.attemptId]);
  const currentTask = get(db, "SELECT result FROM tasks WHERE id = ?", [task.id]);
  run(
    db,
    `UPDATE task_attempts
     SET status = 'needs_attention', error_kind = 'receipt_finalization_failed', error = ?,
         completed_at = COALESCE(completed_at, ?), metadata = ?
     WHERE id = ?`,
    [
      message,
      failedAt,
      toJson({
        ...fromJson(attempt?.metadata, {}),
        receiptFinalization: { status: "failed", failedAt, error: receiptError.message },
        noAutomaticRetry: true,
      }),
      claim.attemptId,
    ],
  );
  run(
    db,
    `UPDATE tasks
     SET status = 'needs_attention', error = ?, result = ?, completed_at = COALESCE(completed_at, ?),
         claim_token = NULL, claimed_at = NULL, updated_at = ?
     WHERE id = ?`,
    [
      message,
      toJson({
        ...fromJson(currentTask?.result, {}),
        executionEvidence: { status: "missing", attemptId: claim.attemptId, error: receiptError.message },
      }),
      failedAt,
      failedAt,
      task.id,
    ],
  );
  run(
    db,
    `UPDATE workflows
     SET status = 'needs_attention', current_step = ?, approval_required = 1, updated_at = ?
     WHERE id = ?`,
    [`Execution evidence needs developer review for ${task.title}`, failedAt, task.workflow_id],
  );
  run(
    db,
    `INSERT INTO messages (id, task_id, venture_id, severity, status, subject, body, created_at, metadata)
     VALUES (?, ?, ?, 'urgent', 'open', ?, ?, ?, ?)`,
    [
      `msg_${randomId()}`,
      task.id,
      task.venture_id || null,
      `Execution evidence missing: ${task.title}`,
      "The work cannot be reported as normally completed because its immutable execution receipt was not finalized. No automatic retry is allowed.",
      failedAt,
      toJson({ workflowId: task.workflow_id, attemptId: claim.attemptId, error: receiptError.message }),
    ],
  );
  insertEvent(db, {
    level: "error",
    actor: "orchestrator",
    type: "agent_receipt.finalization_failed",
    entityType: "task_attempt",
    entityId: claim.attemptId,
    message: "Pantheon could not finalize the immutable execution receipt, so the task and workflow now need attention.",
    metadata: { taskId: task.id, workflowId: task.workflow_id, error: receiptError.message, noAutomaticRetry: true },
  });
  return {
    status: "needs_attention",
    task: { ...task, status: "needs_attention" },
    error: message,
    attemptId: claim.attemptId,
    receipt: { status: "missing", error: receiptError.message },
  };
}

async function runOnce(db, options = {}) {
  const claim = claimNextTask(db, {
    workflowId: options.workflowId,
    taskId: options.taskId,
    claimant: options.claimant || "orchestrator",
  });
  if (!claim) {
    if (options.taskId) {
      const target = hydrateTask(get(db, "SELECT * FROM tasks WHERE id = ?", [options.taskId]));
      if (target) {
        if (["blocked", "waiting_approval", "needs_attention"].includes(target.status)) {
          return {
            status: "blocked",
            message: "This work item needs a decision or review before it can run.",
            task: target,
          };
        }
        if (["queued", "planned"].includes(target.status)) {
          return {
            status: "waiting",
            message: "Earlier work in this workflow must finish before this item can start.",
            task: target,
          };
        }
        return {
          status: "idle",
          message: "This work item is not waiting to run.",
          task: target,
        };
      }
    }
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
  let spendGate = null;
  let approvalId = null;
  let approval = null;
  let reservation = null;
  try {
  const taskApproval = task.approval_id ? get(db, "SELECT * FROM approvals WHERE id = ?", [task.approval_id]) : null;
  const taskApprovalPayload = fromJson(taskApproval?.payload, {});
  if (taskApprovalPayload.scopeSchema === TOOL_APPROVAL_SCOPE_SCHEMA && taskApprovalPayload.metadata?.parentApprovalId) {
    const parentGate = ensureSpendApproval(
      db,
      { ...task, approval_id: taskApprovalPayload.metadata.parentApprovalId },
      { allowConsumedContinuation: true, requireConsumedApproval: true },
    );
    spendGate = { ...parentGate, approval: taskApproval, exactToolResume: true };
  } else {
    spendGate = ensureSpendApproval(db, task);
  }
  if (spendGate.required && !spendGate.approved) {
    releaseTaskClaim(db, claim, "blocked", {
      outcomeStatus: "not_started",
      setupBlockReason: spendGate.providerBlocked ? "Provider setup is incomplete." : null,
      metadata: { approvalId: spendGate.approval?.id || null, noProviderCall: true },
    });
    return { status: "blocked", task, approval: spendGate.approval, spendGate };
  }

  approvalId = spendGate.approval?.id || task.approval_id || null;
  approval = approvalId ? get(db, "SELECT * FROM approvals WHERE id = ?", [approvalId]) : null;
  if (approvalId) {
    if (!approval || approval.status !== "approved") {
      await markBlocked(db, task, approval || { id: task.approval_id, status: "missing", title: "Missing approval" });
      releaseTaskClaim(db, claim, "blocked", { outcomeStatus: "not_started", metadata: { noProviderCall: true } });
      return { status: "blocked", task, approval };
    }
    const approvalPayload = fromJson(approval.payload, {});
    const exactToolApproval = approvalPayload.scopeSchema === TOOL_APPROVAL_SCOPE_SCHEMA;
    const validation = exactToolApproval
      ? validateAgentToolApprovalScope(db, { ...approval, payload: approvalPayload }, {})
      : validateApprovalScope(db, approvalId, { ...task, approval_id: approvalId });
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

  if (spendGate.required) {
    reservation = reserveBudget(db, task, approval, spendGate.estimatedCostCents);
  }
  const approvedPayload = approval?.payload && typeof approval.payload === "object"
    ? approval.payload
    : fromJson(approval?.payload, {});
  if (approvalId && approvedPayload.scopeSchema !== TOOL_APPROVAL_SCOPE_SCHEMA) {
    consumeApproval(db, approvalId, { ...task, approval_id: approvalId });
  }

  insertEvent(db, {
    actor: task.agent,
    type: "task.started",
    entityType: "task",
    entityId: task.id,
    message: `${task.agent} started ${task.title}.`,
  });

    const result = await executeTask(db, task, {
      taskClaim: claim,
      spendApprovalState: spendGate?.state || null,
    });
    const done = now();
    const incurredEstimateCents = Number(
      result.incurredEstimateCents
        ?? result.cost?.estimatedCents
        ?? result.modelPolicy?.estimatedCostCents
        ?? result.actualCents
        ?? result.modelCall?.incurredEstimateCents
        ?? 0,
    );
    const reconciledCostCents = (result.costStatus === "reconciled" || result.cost?.status === "reconciled")
      ? Number(result.reconciledCostCents || result.cost?.reconciledCents || 0)
      : 0;
    const providerRequestId = result.providerRequestId
      || result.modelPolicy?.providerRequestId
      || result.raw?.responseId
      || result.id
      || null;
    if (reservation) {
      resolveReservation(db, task.id, incurredEstimateCents > 0 ? "incurred_estimate" : "released", {
        amountCents: incurredEstimateCents,
        metadata: { providerRequestId },
      });
    }
    const staged = run(
      db,
      `UPDATE tasks
       SET result = ?, updated_at = ?
       WHERE id = ? AND status = 'running' AND claim_token = ?`,
      [toJson(result), done, task.id, claim.claimToken],
    );
    if (staged.changes !== 1) {
      throw new Error(`Pantheon lost the claim for ${task.title} before result finalization.`);
    }

    // Workflow state and human artifacts must be finalized while the claim is
    // still owned. A renderer or projection failure can then be recovered
    // without falsely reporting the task as completed.
    updateWorkflowAfterCompletion(db, task, result, done);
    completeTaskClaim(db, claim, {
      status: "completed",
      result,
      completedAt: done,
      reconciledCostCents,
      outcomeStatus: "known",
      providerRequestId,
      metadata: { costStatus: result.costStatus || (incurredEstimateCents > 0 ? "incurred_estimate" : "none") },
    });
    insertEvent(db, {
      actor: task.agent,
      type: "task.completed",
      entityType: "task",
      entityId: task.id,
      message: ["publish_gelato_dry_run", "publish_digital_product_dry_run"].includes(task.kind)
        ? `${task.title} completed in dry-run mode. No external listing was created.`
        : task.kind === "live_ai_worker_execution"
          ? `${task.title} completed using the approved OpenAI Agents SDK worker.`
          : task.kind === "live_market_research"
            ? `${task.title} completed using the approved OpenAI research service.`
            : `${task.title} completed internally and is ready for review.`,
      metadata: result,
    });
    return { status: "completed", task: { ...task, result }, result };
  } catch (error) {
    if (isAgentToolApprovalRequiredError(error)) {
      const providerCallOccurred = error.providerCallOccurred === true;
      const incurredEstimateCents = Number(error.incurredEstimateCents || 0);
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
        noSpendOccurred: !providerCallOccurred,
        providerCallOccurred,
        incurredEstimateCents,
        providerRequestId: error.providerRequestId || null,
        agentSdkTraceId: error.agentSdkTraceId || null,
      });
      if (reservation) {
        resolveReservation(db, task.id, providerCallOccurred ? "incurred_estimate" : "released", {
          amountCents: incurredEstimateCents,
          metadata: { noProviderCall: !providerCallOccurred, pausedForToolApproval: true, providerRequestId: error.providerRequestId || null },
        });
      }
      releaseTaskClaim(db, claim, "blocked", {
        outcomeStatus: providerCallOccurred ? "known" : "not_started",
        errorKind: "tool_approval_required",
        providerRequestId: error.providerRequestId || null,
        metadata: { approvalId: error.approvalId, noProviderCall: !providerCallOccurred, incurredEstimateCents },
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
    const providerReceipt = error.providerReceipt || null;
    const providerCallOccurred = error.providerCallOccurred === true || Boolean(providerReceipt);
    const incurredEstimateCents = Math.max(0, Number(error.incurredEstimateCents || providerReceipt?.incurredEstimateCents || 0));
    const providerResultNeedsReview = providerCallOccurred
      && !outcomeUnknown
      && (error.needsAttention === true || incurredEstimateCents > 0);
    const needsAttention = outcomeUnknown || providerResultNeedsReview;
    const retries = task.retries + 1;
    const retryable = !providerCallOccurred && !outcomeUnknown && !approvalId && retries <= task.max_retries;
    const status = needsAttention ? "needs_attention" : (retryable ? "queued" : "failed");
    const failedAt = now();
    run(db, "UPDATE tasks SET retries = ? WHERE id = ?", [retries, task.id]);
    if (reservation) {
      const reservationStatus = incurredEstimateCents > 0 ? "incurred_estimate" : outcomeUnknown ? "unknown" : "released";
      resolveReservation(db, task.id, reservationStatus, {
        amountCents: incurredEstimateCents || undefined,
        metadata: { error: error.message, outcomeUnknown, providerCallOccurred, providerReceipt },
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
        result: { error: error.message, outcomeUnknown, providerCallOccurred, providerReceipt },
        completedAt: failedAt,
        outcomeStatus: outcomeUnknown ? "unknown" : providerResultNeedsReview ? "known_provider_result_needs_review" : "failed_before_effect",
        error: error.message,
        errorKind: error.errorKind || (outcomeUnknown ? "provider_outcome_unknown" : providerResultNeedsReview ? "local_processing_after_provider_success" : "non_retryable_error"),
        providerRequestId: error.providerRequestId || providerReceipt?.providerRequestId || null,
        metadata: { outcomeUnknown, providerCallOccurred, approvalConsumed: Boolean(approvalId), incurredEstimateCents, providerReceipt },
      });
    }

    if (retryable) {
      run(
        db,
        `UPDATE workflows SET status = 'agent_retrying', current_step = ?, updated_at = ? WHERE id = ?`,
        [`retrying ${task.title} (attempt ${retries} of ${task.max_retries})`, failedAt, task.workflow_id],
      );
    } else if (needsAttention) {
      run(
        db,
        `UPDATE workflows SET status = 'needs_attention', current_step = ?, approval_required = 1, updated_at = ? WHERE id = ?`,
        [
          outcomeUnknown
            ? `Provider outcome is unknown for ${task.title}; review before any retry`
            : `Provider completed ${task.title}, but the local result needs review`,
          failedAt,
          task.workflow_id,
        ],
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
          outcomeUnknown ? `Check provider outcome: ${task.title}` : `Review completed provider work: ${task.title}`,
          outcomeUnknown
            ? "The provider request may have been accepted. Pantheon will not retry until the outcome and cost are reconciled."
            : "The provider call completed and its receipt and cost were retained, but Pantheon could not safely accept the local result. Review it before any retry.",
          failedAt,
          toJson({ workflowId: task.workflow_id, outcomeUnknown, providerCallOccurred, approvalId, providerReceipt, incurredEstimateCents }),
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
      level: retryable || needsAttention ? "warn" : "error",
      actor: task.agent,
      type: outcomeUnknown ? "task.outcome_unknown" : providerResultNeedsReview ? "task.provider_result_needs_attention" : (retryable ? "task.retry" : "task.failed"),
      entityType: "task",
      entityId: task.id,
      message: outcomeUnknown
        ? `${task.title} needs review because the provider outcome is unknown.`
        : providerResultNeedsReview
          ? `${task.title} needs review because the provider completed but Pantheon could not safely accept the local result.`
        : `${task.title} ${retryable ? "will retry" : "failed"}: ${error.message}`,
      metadata: { retries, maxRetries: task.max_retries, workflowId: task.workflow_id, outcomeUnknown, providerCallOccurred, providerReceipt, incurredEstimateCents },
    });
    return { status, task, error: error.message, retries, providerReceipt };
  } finally {
    const completedAttempt = get(
      db,
      "SELECT completed_at FROM task_attempts WHERE id = ?",
      [claim.attemptId],
    );
    if (completedAttempt?.completed_at) {
      try {
        const receipt = finalizeAgentExecutionReceipt(db, { attemptId: claim.attemptId });
        if (receipt.status === "incomplete") {
          throw new Error(`Execution receipt is incomplete: ${receipt.missing_fields.join(", ") || "missing exact evidence"}.`);
        }
      } catch (receiptError) {
        return markReceiptFinalizationNeedsAttention(db, claim, task, receiptError);
      }
    }
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
    "needs_attention",
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
