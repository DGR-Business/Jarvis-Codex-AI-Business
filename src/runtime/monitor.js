const CONFIG = require("../config");
const crypto = require("node:crypto");
const { refreshIntegrationHealth } = require("../adapters/registry");
const { all, fromJson, get, insertEvent, now, randomId, run, toJson } = require("../db");

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

function monthlyCostCents(db) {
  const prefix = new Date().toISOString().slice(0, 7);
  const row = get(
    db,
    `SELECT COALESCE(SUM(amount_cents), 0) AS total
     FROM costs
     WHERE occurred_at LIKE ?`,
    [`${prefix}%`],
  );
  return Number(row?.total || 0);
}

function approvalRequestedEstimateCents(db) {
  return all(db, "SELECT metadata FROM costs WHERE status = 'approval_requested'")
    .map((row) => fromJson(row.metadata))
    .reduce((sum, metadata) => sum + Number(metadata.estimatedCostCents || 0), 0);
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

  const failedTasks = all(db, "SELECT id, title, workflow_id, error FROM tasks WHERE status = 'failed' ORDER BY updated_at DESC LIMIT 10");
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

  const budgetCents = CONFIG.monthlyBudgetCents;
  const spendCents = monthlyCostCents(db);
  const requestedEstimateCents = approvalRequestedEstimateCents(db);
  if (spendCents > budgetCents) {
    addFinding(findings, {
      severity: "error",
      category: "budget",
      entityType: "budget",
      entityId: "monthly",
      title: "Monthly budget exceeded",
      detail: `${spendCents} cents spent against ${budgetCents} cents budget.`,
      metadata: { spendCents, budgetCents, currency: CONFIG.currency },
    });
  } else if (spendCents + requestedEstimateCents > budgetCents) {
    addFinding(findings, {
      severity: "warn",
      category: "budget",
      entityType: "budget",
      entityId: "monthly",
      title: "Requested spend would exceed monthly budget",
      detail: "Approved/pending estimated spend is above the remaining monthly allowance.",
      metadata: { spendCents, requestedEstimateCents, budgetCents, currency: CONFIG.currency },
    });
  }

  const requiredIntegrations = all(db, "SELECT id, name, status, health FROM integrations WHERE id IN ('openai', 'email', 'digital_products') ORDER BY id");
  const notReady = requiredIntegrations.filter((integration) => !["ok", "dry_run_only"].includes(integration.health));
  if (notReady.length > 0) {
    addFinding(findings, {
      severity: "info",
      category: "integrations",
      entityType: "integration",
      entityId: notReady[0].id,
      title: `${notReady.length} required integration${notReady.length === 1 ? "" : "s"} not live-ready`,
      detail: "This is acceptable in dry-run mode, but blocks live research, live model calls, or email sending.",
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
  for (const finding of findings.filter((item) => item.severity === "error")) {
    if (finding.category === "messages") continue;
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
      toJson({ integrationResult, categoryCounts, options }),
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
    metadata: { severity, status, findingCount: findings.length, categoryCounts },
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
