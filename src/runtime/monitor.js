const CONFIG = require("../config");
const crypto = require("node:crypto");
const { refreshIntegrationHealth } = require("../adapters/registry");
const { all, fromJson, get, insertEvent, now, randomId, run, toJson } = require("../db");
const { monthlyBudgetExposure, monthlyCapCents } = require("./cost-ledger");
const {
  auditTerminalAgentAttempts,
  verifyAgentRunReceiptChain,
} = require("./agent-execution-evidence");
const { verifyAgentContextSnapshot } = require("./agent-context");

function minutesAgo(minutes) {
  return new Date(Date.now() - minutes * 60 * 1000).toISOString();
}

function severityRank(severity) {
  return { info: 0, warn: 1, error: 2 }[severity] || 0;
}

function summarizeSeverity(findings) {
  if (findings.some((finding) => finding.severity === "error")) return "error";
  if (findings.some((finding) => finding.severity === "warn")) return "warn";
  return "info";
}

function monitorStatus(severity) {
  if (severity === "error") return "critical";
  if (severity === "warn") return "attention";
  return "ok";
}

function parseMetadata(row) {
  if (!row) return row;
  return { ...row, metadata: fromJson(row.metadata) };
}

function supersededRetryTaskIds(db) {
  const tasks = all(
    db,
    `SELECT id, status, outcome_status, payload
     FROM tasks
     WHERE kind = 'live_ai_worker_execution'
     ORDER BY created_at`,
  ).map((task) => ({ ...task, payload: fromJson(task.payload, {}) }));
  const parentByTaskId = new Map(tasks.map((task) => [
    task.id,
    task.payload?.liveSpendRequest?.parameters?.retry?.priorTaskId || null,
  ]));
  const successfulTaskIds = new Set(all(
    db,
    `SELECT DISTINCT tasks.id
     FROM tasks
     JOIN agent_runs AS runs ON runs.task_id = tasks.id
     JOIN agent_eval_results AS evals ON evals.run_id = runs.id
     JOIN agent_run_receipts AS receipts ON receipts.run_id = runs.id
     WHERE tasks.kind = 'live_ai_worker_execution'
       AND tasks.status = 'completed'
       AND tasks.outcome_status = 'known'
       AND runs.status = 'completed'
       AND evals.status = 'passed'
       AND receipts.status = 'complete'`,
  ).map((row) => row.id));
  const localRecoveryTasks = all(
    db,
    `SELECT id, status, payload
     FROM tasks
     WHERE kind IN (
       'local_product_output_recovery',
       'local_commercial_output_recovery',
       'local_production_output_recovery'
     )`,
  ).map((task) => ({ ...task, payload: fromJson(task.payload, {}) }));
  const recoveredSourceTaskIds = new Set(localRecoveryTasks
    .filter((task) => task.status === "completed")
    .map((task) => task.payload?.recovery?.sourceTaskId)
    .filter(Boolean));
  const superseded = new Set();
  const addRetryAncestors = (taskId) => {
    const seen = new Set([taskId]);
    let parentId = parentByTaskId.get(taskId);
    while (parentId && !seen.has(parentId)) {
      superseded.add(parentId);
      seen.add(parentId);
      parentId = parentByTaskId.get(parentId);
    }
  };
  for (const taskId of successfulTaskIds) {
    addRetryAncestors(taskId);
  }
  for (const sourceTaskId of recoveredSourceTaskIds) {
    superseded.add(sourceTaskId);
    addRetryAncestors(sourceTaskId);
  }
  for (const recoveryTask of localRecoveryTasks) {
    const sourceTaskId = recoveryTask.payload?.recovery?.sourceTaskId;
    if (sourceTaskId && recoveredSourceTaskIds.has(sourceTaskId)) {
      superseded.add(recoveryTask.id);
    }
  }
  return superseded;
}

function addFinding(findings, finding) {
  findings.push({
    severity: finding.severity || "info",
    category: finding.category || "runtime",
    entityType: finding.entityType || null,
    entityId: finding.entityId || null,
    title: finding.title,
    detail: finding.detail || "",
    metadata: finding.metadata || {},
    fingerprintKey: finding.fingerprintKey || null,
  });
}

function findingFingerprint(finding) {
  if (finding.fingerprintKey) {
    return crypto.createHash("sha256").update([
      finding.category || "runtime",
      finding.fingerprintKey,
    ].join("|")).digest("hex");
  }
  return crypto.createHash("sha256").update([
    finding.category || "runtime",
    finding.entityType || "",
    finding.entityId || "",
    finding.title || "",
  ].join("|")).digest("hex");
}

function qualityReviewBindings(task) {
  const payload = fromJson(task.payload, {});
  const bindings = payload?.liveSpendRequest?.parameters?.reviewBindings;
  return Array.isArray(bindings) ? bindings : [];
}

function collectQualityReviewFindings(db, findings) {
  const reviewTasks = all(
    db,
    `SELECT id, workflow_id, status, error, payload, updated_at
     FROM tasks
     WHERE agent = 'quality_reviewer'
     ORDER BY updated_at DESC`,
  ).map((task) => ({ ...task, bindings: qualityReviewBindings(task) }));
  const pendingDeliverables = all(
    db,
    `SELECT id, workflow_id, human_name, title, updated_at
     FROM deliverables
     WHERE status = 'quality_review_pending'
     ORDER BY updated_at ASC`,
  );

  for (const deliverable of pendingDeliverables) {
    const reviewTask = reviewTasks.find((task) => task.bindings.some(
      (binding) => binding.deliverableId === deliverable.id,
    ));
    if (!reviewTask) {
      addFinding(findings, {
        severity: "error",
        category: "quality_review",
        entityType: "deliverable",
        entityId: deliverable.id,
        title: `Quality check missing: ${deliverable.human_name || deliverable.title}`,
        detail: "This output is being held for quality review, but no exact Quality Reviewer task is linked to it.",
        metadata: { workflowId: deliverable.workflow_id, updatedAt: deliverable.updated_at },
      });
      continue;
    }
    if (["failed", "cancelled"].includes(reviewTask.status)) {
      addFinding(findings, {
        severity: "error",
        category: "quality_review",
        entityType: "task",
        entityId: reviewTask.id,
        title: `Quality check stopped: ${deliverable.human_name || deliverable.title}`,
        detail: reviewTask.error || "The linked Quality Reviewer task stopped before producing a trusted result.",
        metadata: { deliverableId: deliverable.id, workflowId: deliverable.workflow_id, taskStatus: reviewTask.status },
      });
      continue;
    }
    if (reviewTask.status === "completed") {
      const review = get(
        db,
        `SELECT id FROM deliverable_quality_reviews
         WHERE deliverable_id = ? AND review_task_id = ?
         ORDER BY created_at DESC LIMIT 1`,
        [deliverable.id, reviewTask.id],
      );
      if (!review) {
        addFinding(findings, {
          severity: "error",
          category: "quality_review",
          entityType: "task",
          entityId: reviewTask.id,
          title: `Quality result missing: ${deliverable.human_name || deliverable.title}`,
          detail: "The Quality Reviewer task completed, but no immutable verdict was recorded for this exact output.",
          metadata: { deliverableId: deliverable.id, workflowId: deliverable.workflow_id },
        });
      }
    }
  }

  const changesRequired = all(
    db,
    `SELECT deliverables.id, deliverables.human_name, deliverables.title, deliverables.workflow_id,
            reviews.id AS review_id, reviews.verdict, reviews.quality_score, reviews.findings
     FROM deliverables
     JOIN deliverable_quality_reviews AS reviews ON reviews.deliverable_id = deliverables.id
     WHERE deliverables.status = 'needs_changes'
       AND reviews.created_at = (
         SELECT MAX(latest.created_at)
         FROM deliverable_quality_reviews AS latest
         WHERE latest.deliverable_id = deliverables.id
       )
       AND reviews.verdict IN ('changes_required', 'blocked')
     ORDER BY reviews.created_at DESC
     LIMIT 20`,
  );
  for (const item of changesRequired) {
    const reviewFindings = fromJson(item.findings, []);
    addFinding(findings, {
      severity: "warn",
      category: "quality_review",
      entityType: "deliverable",
      entityId: item.id,
      title: `Changes required: ${item.human_name || item.title}`,
      detail: reviewFindings.join(" ") || "Quality Reviewer found changes before this output can be used.",
      metadata: {
        workflowId: item.workflow_id,
        reviewId: item.review_id,
        verdict: item.verdict,
        qualityScore: item.quality_score,
      },
    });
  }
}

function collectAgentContextFindings(db, findings) {
  const snapshots = all(
    db,
    `SELECT id, venture_id, workflow_id, task_id, agent_id, snapshot_hash, snapshot
     FROM agent_context_snapshots
     ORDER BY created_at DESC`,
  );
  for (const row of snapshots) {
    const snapshot = fromJson(row.snapshot, {});
    const check = verifyAgentContextSnapshot(snapshot);
    const ownershipMatches = snapshot.ventureId === row.venture_id
      && snapshot.workflowId === row.workflow_id
      && snapshot.taskId === row.task_id
      && snapshot.agentId === row.agent_id
      && snapshot.snapshotHash === row.snapshot_hash;
    if (!check.valid || !ownershipMatches) {
      addFinding(findings, {
        severity: "error",
        category: "agent_context",
        entityType: "task",
        entityId: row.task_id,
        title: "Worker context verification failed",
        detail: check.valid
          ? "The stored worker context no longer matches its venture, workflow, task, or worker."
          : check.reason,
        metadata: { contextSnapshotId: row.id, contextSnapshotHash: row.snapshot_hash },
      });
    }
  }

  const liveTasks = all(
    db,
    `SELECT id, venture_id, workflow_id, agent, payload
     FROM tasks
     WHERE kind = 'live_ai_worker_execution' AND status <> 'cancelled'
     ORDER BY updated_at DESC`,
  );
  for (const task of liveTasks) {
    const payload = fromJson(task.payload, {});
    const context = payload.contextSnapshot;
    const reference = payload?.liveSpendRequest?.parameters?.contextSnapshot;
    if (!context && !reference) continue;
    const snapshotHash = context?.snapshotHash || reference?.hash || null;
    const stored = snapshotHash
      ? get(db, "SELECT * FROM agent_context_snapshots WHERE snapshot_hash = ?", [snapshotHash])
      : null;
    const ownershipMatches = stored
      && stored.task_id === task.id
      && stored.venture_id === task.venture_id
      && stored.workflow_id === task.workflow_id
      && stored.agent_id === task.agent;
    if (!stored || !ownershipMatches) {
      addFinding(findings, {
        severity: "error",
        category: "agent_context",
        entityType: "task",
        entityId: task.id,
        title: "Worker context record missing",
        detail: "This live worker task references business records that are not stored against the same venture, workflow, task, and worker.",
        metadata: { workflowId: task.workflow_id, workerId: task.agent, contextSnapshotHash: snapshotHash },
      });
    }
  }
}

function collectChiefAssignmentFindings(db, findings) {
  const handoffs = all(
    db,
    `SELECT id, workflow_id, status, metadata, updated_at
     FROM agent_handoffs
     WHERE from_agent_id = 'chief_of_staff'
       AND status IN (
         'specialist_assignment_prepared',
         'specialist_work_running',
         'specialist_quality_review_pending'
       )
     ORDER BY updated_at ASC`,
  );
  for (const handoff of handoffs) {
    const metadata = fromJson(handoff.metadata, {});
    const childTaskId = metadata.childTaskId;
    const childTask = childTaskId
      ? get(db, "SELECT id, title, status, error FROM tasks WHERE id = ?", [childTaskId])
      : null;
    if (!childTask) {
      addFinding(findings, {
        severity: "error",
        category: "chief_assignment",
        entityType: "agent_handoff",
        entityId: handoff.id,
        title: "Chief assignment lost its worker task",
        detail: "Chief of Staff has an open specialist assignment, but the exact child task cannot be found.",
        metadata: { workflowId: handoff.workflow_id, childTaskId: childTaskId || null },
      });
      continue;
    }
    if (["failed", "cancelled"].includes(childTask.status)) {
      addFinding(findings, {
        severity: "error",
        category: "chief_assignment",
        entityType: "task",
        entityId: childTask.id,
        title: `Chief assignment stopped: ${childTask.title}`,
        detail: childTask.error || "The specialist task stopped before Chief of Staff could close the assignment.",
        metadata: { workflowId: handoff.workflow_id, handoffId: handoff.id, taskStatus: childTask.status },
      });
    }
  }
}

function collectRuntimeOversightFindings(db, findings, options = {}) {
  const monitorJob = get(
    db,
    "SELECT * FROM scheduler_jobs WHERE id = 'job-monitor-cycle'",
  );
  if (!monitorJob) return;

  if (monitorJob.status !== "enabled") {
    addFinding(findings, {
      severity: "error",
      category: "runtime_oversight",
      entityType: "scheduler_job",
      entityId: monitorJob.id,
      title: "Pantheon monitoring is paused",
      detail: "Independent system checks are disabled. Restart them before relying on unattended work.",
      metadata: { status: monitorJob.status },
    });
    return;
  }

  const latestRun = get(
    db,
    `SELECT id, status, started_at, completed_at, error
     FROM scheduler_runs
     WHERE job_id = ?
     ORDER BY started_at DESC
     LIMIT 1`,
    [monitorJob.id],
  );
  if (latestRun && ["failed", "needs_attention", "abandoned"].includes(latestRun.status)) {
    addFinding(findings, {
      severity: "error",
      category: "runtime_oversight",
      entityType: "scheduler_run",
      entityId: latestRun.id,
      title: "Pantheon monitoring needs recovery",
      detail: latestRun.error || "The latest independent system check did not finish cleanly.",
      metadata: {
        jobId: monitorJob.id,
        runStatus: latestRun.status,
        startedAt: latestRun.started_at,
        completedAt: latestRun.completed_at,
      },
    });
    return;
  }

  const referenceTime = options.at || now();
  const referenceMs = Date.parse(referenceTime);
  const lockedAtMs = Date.parse(monitorJob.locked_at || "");
  const metadata = fromJson(monitorJob.metadata, {});
  const leaseSeconds = Math.max(60, Number(metadata.leaseSeconds || 15 * 60));
  if (monitorJob.lock_owner && Number.isFinite(lockedAtMs)) {
    if (Number.isFinite(referenceMs) && referenceMs - lockedAtMs > leaseSeconds * 1000) {
      addFinding(findings, {
        severity: "error",
        category: "runtime_oversight",
        entityType: "scheduler_job",
        entityId: monitorJob.id,
        title: "Pantheon monitoring appears stuck",
        detail: "The scheduled check has held its execution lease longer than its allowed window.",
        metadata: {
          lockOwner: monitorJob.lock_owner,
          lockedAt: monitorJob.locked_at,
          leaseSeconds,
        },
      });
    }
    return;
  }

  const nextRunMs = Date.parse(monitorJob.next_run_at || "");
  const intervalSeconds = Math.max(60, Number(monitorJob.interval_seconds || 15 * 60));
  const graceSeconds = Math.max(120, Math.ceil(intervalSeconds / 4));
  if (!monitorJob.last_run_at) {
    addFinding(findings, {
      severity: "warn",
      category: "runtime_oversight",
      entityType: "scheduler_job",
      entityId: monitorJob.id,
      title: "Pantheon monitoring has not completed its first check",
      detail: "The schedule is enabled, but no independent system check has completed yet.",
      metadata: { nextRunAt: monitorJob.next_run_at },
    });
  } else if (
    Number.isFinite(referenceMs)
    && Number.isFinite(nextRunMs)
    && referenceMs > nextRunMs + graceSeconds * 1000
  ) {
    addFinding(findings, {
      severity: "warn",
      category: "runtime_oversight",
      entityType: "scheduler_job",
      entityId: monitorJob.id,
      title: "Pantheon monitoring is overdue",
      detail: "The next independent system check did not start within its expected window.",
      metadata: {
        lastRunAt: monitorJob.last_run_at,
        nextRunAt: monitorJob.next_run_at,
        graceSeconds,
      },
    });
  }
}

function collectFindings(db, options = {}) {
  const findings = [];
  const staleTaskCutoff = minutesAgo(Number(options.staleTaskMinutes || 30));
  const staleRunCutoff = minutesAgo(Number(options.staleRunMinutes || 30));
  const staleQueuedCutoff = minutesAgo(Number(options.staleQueuedMinutes || 24 * 60));

  collectRuntimeOversightFindings(db, findings, options);

  const pendingApprovals = all(db, "SELECT id, title, risk_level FROM approvals WHERE status = 'pending' ORDER BY requested_at ASC");
  const pendingApprovalIds = new Set(pendingApprovals.map((approval) => approval.id));
  if (pendingApprovals.length > 0) {
    addFinding(findings, {
      severity: "warn",
      category: "approvals",
      entityType: "approval",
      entityId: pendingApprovals[0].id,
      title: `${pendingApprovals.length} approval${pendingApprovals.length === 1 ? "" : "s"} pending`,
      detail: "Operator approval is required before blocked work can continue.",
      metadata: { approvals: pendingApprovals },
      fingerprintKey: "pending_approvals",
    });
  }

  const expiredApprovals = all(
    db,
    `SELECT id, title, expires_at
     FROM approvals
     WHERE status = 'pending'
       AND expires_at IS NOT NULL
       AND expires_at <= ?
     ORDER BY expires_at ASC`,
    [options.at || now()],
  );
  for (const approval of expiredApprovals) {
    addFinding(findings, {
      severity: "warn",
      category: "approval_integrity",
      entityType: "approval",
      entityId: approval.id,
      title: `Decision expired: ${approval.title}`,
      detail: "This approval can no longer start work. Prepare a fresh exact decision if the action is still justified.",
      metadata: { expiresAt: approval.expires_at },
    });
  }

  const continuedAfterDenial = all(
    db,
    `SELECT approvals.id AS approval_id, approvals.title, approvals.decided_at,
            tasks.id AS task_id, tasks.title AS task_title, tasks.status, tasks.updated_at
     FROM approvals
     JOIN tasks ON tasks.approval_id = approvals.id
     WHERE approvals.status IN ('rejected', 'needs_changes')
       AND tasks.status IN ('running', 'completed')
       AND approvals.decided_at IS NOT NULL
       AND tasks.updated_at >= approvals.decided_at
     ORDER BY tasks.updated_at DESC`,
  );
  for (const item of continuedAfterDenial) {
    addFinding(findings, {
      severity: "error",
      category: "approval_integrity",
      entityType: "task",
      entityId: item.task_id,
      title: `Work continued after a stop decision: ${item.task_title}`,
      detail: "The linked decision was declined or sent back for changes, but the work record later shows execution.",
      metadata: {
        approvalId: item.approval_id,
        approvalTitle: item.title,
        decidedAt: item.decided_at,
        taskStatus: item.status,
      },
    });
  }

  const openEscalations = all(
    db,
    "SELECT id, subject, severity, metadata FROM messages WHERE status = 'open' AND severity IN ('urgent', 'approval') ORDER BY created_at ASC",
  ).filter((message) => {
    if (message.severity !== "approval") return true;
    const linkedApprovalId = fromJson(message.metadata, {}).approvalId;
    return !linkedApprovalId || !pendingApprovalIds.has(linkedApprovalId);
  });
  if (openEscalations.length > 0) {
    addFinding(findings, {
      severity: openEscalations.some((message) => message.severity === "urgent") ? "error" : "warn",
      category: "messages",
      entityType: "message",
      entityId: openEscalations[0].id,
      title: `${openEscalations.length} open escalation${openEscalations.length === 1 ? "" : "s"}`,
      detail: "Open urgent or approval messages need operator attention.",
      metadata: { messages: openEscalations },
      fingerprintKey: "open_escalations",
    });
  }

  const staleQueuedTasks = all(
    db,
    `SELECT id, title, workflow_id, status, updated_at
     FROM tasks
     WHERE status IN ('planned', 'queued')
       AND updated_at < ?
     ORDER BY updated_at ASC
     LIMIT 25`,
    [staleQueuedCutoff],
  );
  for (const task of staleQueuedTasks) {
    addFinding(findings, {
      severity: "warn",
      category: "queue",
      entityType: "task",
      entityId: task.id,
      title: `Queued work has not moved: ${task.title}`,
      detail: "This work has stayed ready or planned beyond its expected window. Confirm it is still the right next step or stop it.",
      metadata: {
        workflowId: task.workflow_id,
        status: task.status,
        updatedAt: task.updated_at,
        staleQueuedMinutes: Number(options.staleQueuedMinutes || 24 * 60),
      },
    });
  }

  const staleTasks = all(
    db,
    "SELECT id, title, workflow_id, updated_at FROM tasks WHERE status = 'running' AND updated_at < ? ORDER BY updated_at ASC",
    [staleTaskCutoff],
  );
  for (const task of staleTasks) {
    addFinding(findings, {
      severity: "error",
      category: "tasks",
      entityType: "task",
      entityId: task.id,
      title: `Task may be stuck: ${task.title}`,
      detail: `Task has been running since ${task.updated_at}.`,
      metadata: { workflowId: task.workflow_id, staleTaskCutoff },
    });
  }

  const failedTasks = all(
    db,
    `SELECT tasks.id, tasks.title, tasks.workflow_id, tasks.error
     FROM tasks
     WHERE tasks.status = 'failed'
       AND NOT (
         tasks.outcome_status = 'known_provider_result_needs_review'
         AND EXISTS (
           SELECT 1 FROM events
           WHERE events.type = 'task.reviewed_failure_closed_for_retry'
             AND events.entity_id = tasks.id
         )
         AND NOT EXISTS (
           SELECT 1 FROM messages
           WHERE messages.task_id = tasks.id AND messages.status = 'open'
         )
       )
       AND NOT (
         tasks.outcome_status = 'known'
         AND EXISTS (
           SELECT 1 FROM costs
           WHERE costs.workflow_id = tasks.workflow_id AND costs.status = 'reconciled'
         )
         AND EXISTS (
           SELECT 1 FROM events
           WHERE events.type = 'provider_usage.task_reconciled'
             AND events.entity_id = tasks.id
         )
         AND NOT EXISTS (
           SELECT 1 FROM messages
           WHERE messages.task_id = tasks.id AND messages.status = 'open'
         )
       )
     ORDER BY tasks.updated_at DESC LIMIT 10`,
  );
  if (failedTasks.length > 0) {
    addFinding(findings, {
      severity: "error",
      category: "tasks",
      entityType: "task",
      entityId: failedTasks[0].id,
      title: `${failedTasks.length} failed task${failedTasks.length === 1 ? "" : "s"}`,
      detail: "Failed tasks require recovery or operator review before this workflow can be trusted.",
      metadata: { failedTasks },
      fingerprintKey: "failed_tasks",
    });
  }

  const unknownAttempts = all(
    db,
    `SELECT attempts.id, attempts.task_id, attempts.provider_request_id,
            attempts.completed_at, tasks.title
     FROM task_attempts AS attempts
     LEFT JOIN tasks ON tasks.id = attempts.task_id
     WHERE attempts.outcome_status = 'unknown'
     ORDER BY attempts.completed_at DESC`,
  );
  for (const attempt of unknownAttempts) {
    addFinding(findings, {
      severity: "error",
      category: "unknown_outcome",
      entityType: "task_attempt",
      entityId: attempt.id,
      title: `Provider outcome is unknown: ${attempt.title || attempt.task_id}`,
      detail: "Do not retry this work until the provider outcome and any cost are reconciled.",
      metadata: {
        taskId: attempt.task_id,
        providerRequestId: attempt.provider_request_id,
        completedAt: attempt.completed_at,
      },
    });
  }

  const unsafeRetries = all(
    db,
    `SELECT earlier.id AS unknown_attempt_id, later.id AS later_attempt_id,
            earlier.task_id, tasks.title, later.started_at
     FROM task_attempts AS earlier
     JOIN task_attempts AS later
       ON later.task_id = earlier.task_id
      AND later.started_at > COALESCE(earlier.completed_at, earlier.started_at)
     LEFT JOIN tasks ON tasks.id = earlier.task_id
     WHERE earlier.outcome_status = 'unknown'
     ORDER BY later.started_at DESC`,
  );
  for (const retry of unsafeRetries) {
    addFinding(findings, {
      severity: "error",
      category: "unsafe_retry",
      entityType: "task_attempt",
      entityId: retry.later_attempt_id,
      title: `Work restarted before an unknown outcome was resolved: ${retry.title || retry.task_id}`,
      detail: "A later attempt exists after a provider outcome became unknown. Stop further execution and reconcile both attempts.",
      metadata: {
        taskId: retry.task_id,
        unknownAttemptId: retry.unknown_attempt_id,
        laterAttemptId: retry.later_attempt_id,
        laterStartedAt: retry.started_at,
      },
    });
  }

  const staleWorkflowRuns = all(
    db,
    "SELECT id, workflow_id, started_at FROM workflow_runs WHERE status = 'running' AND started_at < ? ORDER BY started_at ASC",
    [staleRunCutoff],
  );
  for (const workflowRun of staleWorkflowRuns) {
    addFinding(findings, {
      severity: "error",
      category: "workflow_runs",
      entityType: "workflow_run",
      entityId: workflowRun.id,
      title: "Workflow run may be stuck",
      detail: `Safe-loop run started at ${workflowRun.started_at} and has not completed.`,
      metadata: { workflowId: workflowRun.workflow_id, staleRunCutoff },
    });
  }

  const staleAgentRuns = all(
    db,
    `SELECT runs.id, runs.agent_id, runs.task_id, runs.started_at, tasks.title
     FROM agent_runs AS runs
     LEFT JOIN tasks ON tasks.id = runs.task_id
     WHERE runs.status = 'running' AND runs.started_at < ?
     ORDER BY runs.started_at ASC`,
    [staleRunCutoff],
  );
  for (const agentRun of staleAgentRuns) {
    addFinding(findings, {
      severity: "error",
      category: "agent_runs",
      entityType: "agent_run",
      entityId: agentRun.id,
      title: `AI work may be stuck: ${agentRun.title || agentRun.agent_id}`,
      detail: "The worker has not recorded progress within the expected window. Pantheon will not assume the provider call is safe to repeat.",
      metadata: { taskId: agentRun.task_id, startedAt: agentRun.started_at, staleRunCutoff },
    });
  }

  const incompleteReceipts = all(
    db,
    `SELECT receipts.id, receipts.run_id, receipts.task_id, receipts.status,
            receipts.missing_fields, receipts.warnings, tasks.title
     FROM agent_run_receipts AS receipts
     LEFT JOIN tasks ON tasks.id = receipts.task_id
     WHERE NOT EXISTS (
       SELECT 1 FROM agent_run_receipts AS later
       WHERE later.attempt_id = receipts.attempt_id
         AND later.sequence > receipts.sequence
     )
       AND receipts.status IN ('needs_review', 'incomplete')
     ORDER BY receipts.created_at DESC
     LIMIT 50`,
  );
  const completedRetryPredecessors = supersededRetryTaskIds(db);
  for (const receipt of incompleteReceipts) {
    if (receipt.status === "needs_review" && completedRetryPredecessors.has(receipt.task_id)) continue;
    const missingFields = fromJson(receipt.missing_fields, []);
    const warnings = fromJson(receipt.warnings, []);
    addFinding(findings, {
      severity: receipt.status === "incomplete" ? "error" : "warn",
      category: "agent_receipts",
      entityType: "agent_run",
      entityId: receipt.run_id,
      title: receipt.status === "incomplete"
        ? `Execution record incomplete: ${receipt.title || receipt.task_id}`
        : `Execution needs review: ${receipt.title || receipt.task_id}`,
      detail: [...missingFields, ...warnings].join(" ") || "The immutable execution receipt needs developer or operator review.",
      metadata: { receiptId: receipt.id, taskId: receipt.task_id, missingFields, warnings },
    });
  }

  const missingReceipts = all(
    db,
    `SELECT runs.id, runs.task_id, runs.completed_at, tasks.title
     FROM agent_runs AS runs
     LEFT JOIN tasks ON tasks.id = runs.task_id
     WHERE runs.completed_at IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM agent_run_receipts WHERE run_id = runs.id)
     ORDER BY runs.completed_at DESC
     LIMIT 50`,
  );
  for (const agentRun of missingReceipts) {
    addFinding(findings, {
      severity: "error",
      category: "agent_receipts",
      entityType: "agent_run",
      entityId: agentRun.id,
      title: `Execution record missing: ${agentRun.title || agentRun.task_id}`,
      detail: "The AI worker finished without an immutable local receipt. This run must be audited before its result is trusted.",
      metadata: { taskId: agentRun.task_id, completedAt: agentRun.completed_at },
    });
  }

  const receiptVerification = verifyAgentRunReceiptChain(db);
  if (!receiptVerification.ok) {
    addFinding(findings, {
      severity: "error",
      category: "agent_receipts",
      entityType: "runtime",
      entityId: "receipt_chain",
      title: "Execution receipt verification failed",
      detail: `${receiptVerification.failures.length} receipt integrity check${receiptVerification.failures.length === 1 ? "" : "s"} failed.`,
      metadata: receiptVerification,
    });
  }

  collectQualityReviewFindings(db, findings);
  collectAgentContextFindings(db, findings);
  collectChiefAssignmentFindings(db, findings);

  const budgetCents = monthlyCapCents(db);
  const budgetExposure = monthlyBudgetExposure(db);
  const spendCents = budgetExposure.totalCents;
  if (spendCents > budgetCents) {
    addFinding(findings, {
      severity: "error",
      category: "budget",
      entityType: "budget",
      entityId: "monthly",
      title: "Monthly budget exceeded",
      detail: `${spendCents} cents spent against ${budgetCents} cents budget.`,
      metadata: {
        spendCents,
        realizedCents: budgetExposure.realizedCents,
        unresolvedCents: budgetExposure.unresolvedCents,
        budgetCents,
        currency: CONFIG.currency,
      },
      fingerprintKey: "monthly_budget",
    });
  }

  const unknownCosts = all(
    db,
    `SELECT id, task_id, workflow_id, amount_cents, currency, occurred_at
     FROM costs
     WHERE status = 'unknown'
     ORDER BY occurred_at ASC`,
  );
  const unknownReservations = all(
    db,
    `SELECT id, task_id, workflow_id, amount_cents, currency, reserved_at
     FROM budget_reservations
     WHERE status = 'unknown'
     ORDER BY reserved_at ASC`,
  );
  if (unknownCosts.length || unknownReservations.length) {
    addFinding(findings, {
      severity: "error",
      category: "cost",
      entityType: "budget",
      entityId: "unknown_costs",
      title: "Provider cost needs reconciliation",
      detail: "At least one provider attempt has an unknown charge. Reconcile it before approving more spend for the same work.",
      metadata: { costs: unknownCosts, reservations: unknownReservations },
      fingerprintKey: "unknown_costs",
    });
  }

  const staleReservedCutoff = minutesAgo(Number(options.staleReservationMinutes || 60));
  const staleReservations = all(
    db,
    `SELECT reservations.id, reservations.task_id, reservations.amount_cents,
            reservations.currency, reservations.reserved_at, tasks.title, tasks.status AS task_status
     FROM budget_reservations AS reservations
     LEFT JOIN tasks ON tasks.id = reservations.task_id
     WHERE reservations.status = 'reserved'
       AND reservations.reserved_at < ?
       AND COALESCE(tasks.status, '') <> 'running'
     ORDER BY reservations.reserved_at ASC`,
    [staleReservedCutoff],
  );
  for (const reservation of staleReservations) {
    addFinding(findings, {
      severity: "warn",
      category: "cost",
      entityType: "budget_reservation",
      entityId: reservation.id,
      title: `Unused budget is still reserved: ${reservation.title || reservation.task_id}`,
      detail: "The work is not running, but its budget remains held. Release or reconcile the reservation.",
      metadata: reservation,
    });
  }

  const coreConnections = all(
    db,
    "SELECT id, name, status, health FROM integrations WHERE id IN ('ai_workers', 'live_research', 'digital_products') ORDER BY id",
  );
  const notReady = coreConnections.filter((integration) => !["ok", "dry_run_only"].includes(integration.health));
  if (notReady.length > 0) {
    addFinding(findings, {
      severity: "info",
      category: "integrations",
      entityType: "integration",
      entityId: notReady[0].id,
      title: `${notReady.length} core connection${notReady.length === 1 ? " needs" : "s need"} setup`,
      detail: "AI work, live research, or digital-product preparation is unavailable until the listed connection is ready.",
      metadata: { integrations: notReady },
    });
  }

  return findings.sort((a, b) => severityRank(b.severity) - severityRank(a.severity));
}

function persistFindings(db, runId, findings) {
  const ts = now();
  const activeFingerprints = [];
  for (const finding of findings) {
    const fingerprint = findingFingerprint(finding);
    activeFingerprints.push(fingerprint);
    run(
      db,
      `INSERT INTO monitor_findings
       (id, run_id, severity, category, entity_type, entity_id, title, detail, status, metadata,
        created_at, fingerprint, first_seen, last_seen, occurrence_count, resolved_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, NULL)
       ON CONFLICT(fingerprint) WHERE fingerprint IS NOT NULL DO UPDATE SET
         run_id = excluded.run_id,
         severity = excluded.severity,
         title = excluded.title,
         detail = excluded.detail,
         status = 'open',
         metadata = excluded.metadata,
         last_seen = excluded.last_seen,
         occurrence_count = monitor_findings.occurrence_count + 1,
         resolved_at = NULL`,
      [
        `finding_${randomId()}`,
        runId,
        finding.severity,
        finding.category,
        finding.entityType,
        finding.entityId,
        finding.title,
        finding.detail,
        "open",
        toJson(finding.metadata),
        ts,
        fingerprint,
        ts,
        ts,
      ],
    );
  }
  if (activeFingerprints.length) {
    const placeholders = activeFingerprints.map(() => "?").join(", ");
    run(
      db,
      `UPDATE monitor_findings SET status = 'resolved', resolved_at = ?
       WHERE status = 'open' AND fingerprint IS NOT NULL AND fingerprint NOT IN (${placeholders})`,
      [ts, ...activeFingerprints],
    );
  } else {
    run(db, "UPDATE monitor_findings SET status = 'resolved', resolved_at = ? WHERE status = 'open'", [ts]);
  }
}

function escalateCriticalFindings(db, runId, findings) {
  const criticalFindings = findings.filter((item) => item.severity === "error" && item.category !== "messages");
  const activeSubjects = criticalFindings.map((finding) => `Runtime monitor: ${finding.title}`);
  const resolvedAt = now();
  if (activeSubjects.length) {
    const placeholders = activeSubjects.map(() => "?").join(", ");
    run(
      db,
      `UPDATE messages SET status = 'resolved', resolved_at = ?
       WHERE status = 'open' AND subject LIKE 'Runtime monitor:%'
         AND subject NOT IN (${placeholders})`,
      [resolvedAt, ...activeSubjects],
    );
  } else {
    run(
      db,
      "UPDATE messages SET status = 'resolved', resolved_at = ? WHERE status = 'open' AND subject LIKE 'Runtime monitor:%'",
      [resolvedAt],
    );
  }

  for (const finding of criticalFindings) {
    const subject = `Runtime monitor: ${finding.title}`;
    const existing = get(
      db,
      "SELECT id FROM messages WHERE status = 'open' AND subject = ? ORDER BY created_at DESC LIMIT 1",
      [subject],
    );
    if (existing) continue;
    run(
      db,
      `INSERT INTO messages (id, severity, status, subject, body, created_at, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        `msg_monitor_${randomId()}`,
        "urgent",
        "open",
        subject,
        finding.detail || "Runtime monitor found a critical issue.",
        now(),
        toJson({ runId, category: finding.category, entityType: finding.entityType, entityId: finding.entityId }),
      ],
    );
  }
}

function runMonitorCycle(db, options = {}) {
  const startedAt = now();
  const runId = `monitor_${randomId()}`;
  run(
    db,
    `INSERT INTO monitor_runs (id, status, severity, finding_count, started_at, metadata)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [runId, "running", "info", 0, startedAt, toJson({ options })],
  );

  const integrationResult = refreshIntegrationHealth(db);
  const receiptAudit = auditTerminalAgentAttempts(db);
  const findings = collectFindings(db, options);
  const severity = summarizeSeverity(findings);
  const status = monitorStatus(severity);
  persistFindings(db, runId, findings);
  escalateCriticalFindings(db, runId, findings);
  const completedAt = now();
  const categoryCounts = findings.reduce((counts, finding) => {
    counts[finding.category] = (counts[finding.category] || 0) + 1;
    return counts;
  }, {});

  run(
    db,
    `UPDATE monitor_runs
     SET status = ?, severity = ?, finding_count = ?, completed_at = ?, metadata = ?
     WHERE id = ?`,
    [
      status,
      severity,
      findings.length,
      completedAt,
      toJson({ integrationResult, receiptAuditCount: receiptAudit.length, categoryCounts, options }),
      runId,
    ],
  );

  insertEvent(db, {
    level: severity === "error" ? "error" : severity === "warn" ? "warn" : "info",
    actor: "runtime-monitor",
    type: "monitor.completed",
    entityType: "monitor_run",
    entityId: runId,
    message: `Runtime monitor completed with status ${status} and ${findings.length} finding${findings.length === 1 ? "" : "s"}.`,
    metadata: { severity, status, findingCount: findings.length, receiptAuditCount: receiptAudit.length, categoryCounts },
  });

  return {
    id: runId,
    status,
    severity,
    findingCount: findings.length,
    startedAt,
    completedAt,
    findings,
  };
}

function latestMonitorRun(db) {
  const row = get(db, "SELECT * FROM monitor_runs ORDER BY started_at DESC LIMIT 1");
  return parseMetadata(row);
}

module.exports = {
  collectFindings,
  latestMonitorRun,
  runMonitorCycle,
  supersededRetryTaskIds,
};
