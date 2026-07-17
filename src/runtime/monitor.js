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

function addFinding(findings, finding) {
  findings.push({
    severity: finding.severity || "info",
    category: finding.category || "runtime",
    entityType: finding.entityType || null,
    entityId: finding.entityId || null,
    title: finding.title,
    detail: finding.detail || "",
    metadata: finding.metadata || {},
  });
}

function findingFingerprint(finding) {
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

function collectFindings(db, options = {}) {
  const findings = [];
  const staleTaskCutoff = minutesAgo(Number(options.staleTaskMinutes || 30));
  const staleRunCutoff = minutesAgo(Number(options.staleRunMinutes || 30));

  const pendingApprovals = all(db, "SELECT id, title, risk_level FROM approvals WHERE status = 'pending' ORDER BY requested_at ASC");
  if (pendingApprovals.length > 0) {
    addFinding(findings, {
      severity: "warn",
      category: "approvals",
      entityType: "approval",
      entityId: pendingApprovals[0].id,
      title: `${pendingApprovals.length} approval${pendingApprovals.length === 1 ? "" : "s"} pending`,
      detail: "Operator approval is required before blocked work can continue.",
      metadata: { approvals: pendingApprovals },
    });
  }

  const openEscalations = all(
    db,
    "SELECT id, subject, severity FROM messages WHERE status = 'open' AND severity IN ('urgent', 'approval') ORDER BY created_at ASC",
  );
  if (openEscalations.length > 0) {
    addFinding(findings, {
      severity: openEscalations.some((message) => message.severity === "urgent") ? "error" : "warn",
      category: "messages",
      entityType: "message",
      entityId: openEscalations[0].id,
      title: `${openEscalations.length} open escalation${openEscalations.length === 1 ? "" : "s"}`,
      detail: "Open urgent or approval messages need operator attention.",
      metadata: { messages: openEscalations },
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
      detail: "The worker has not recorded progress within the expected window. Jarvis will not assume the provider call is safe to repeat.",
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
  for (const receipt of incompleteReceipts) {
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
};
