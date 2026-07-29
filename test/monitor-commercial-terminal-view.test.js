const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  all,
  fromJson,
  get,
  openDatabase,
  run,
  seedDatabase,
  toJson,
} = require("../src/db");
const {
  IDS,
  RECONCILIATION_ID,
  RECONCILIATION_SCHEMA,
} = require("../src/runtime/commercial-truth-reconciliation");
const { collectFindings, runMonitorCycle } = require("../src/runtime/monitor");

const OLD_AT = "2026-07-01T00:00:00.000Z";
const ACTIVE_WORKFLOW_ID = "wf_current_monitor_terminal_control";
const TERMINAL_FAILED_TASK_ID = "task_terminal_monitor_failure";
const TERMINAL_QUEUED_TASK_ID = "task_terminal_monitor_queue";
const ACTIVE_FAILED_TASK_ID = "task_current_monitor_failure";
const ACTIVE_QUEUED_TASK_ID = "task_current_monitor_queue";

function makeRuntime(name) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `pantheon-terminal-monitor-${name}-`));
  const db = openDatabase(path.join(root, "runtime.sqlite"));
  seedDatabase(db);
  return { root, db };
}

function closeRuntime(runtime) {
  runtime.db.close();
  fs.rmSync(runtime.root, { recursive: true, force: true });
}

function insertWorkflow(db, id, { terminal = false } = {}) {
  const metadata = terminal
    ? {
      commercialTruth: {
        schema: RECONCILIATION_SCHEMA,
        reconciliationId: RECONCILIATION_ID,
        historical: true,
        terminal: true,
        actionable: false,
        reason: "buyer_intent_quality_recheck_failed_terminal",
      },
    }
    : {};
  run(
    db,
    `INSERT INTO workflows
     (id, venture_id, type, title, status, current_step, priority, metadata,
      created_at, updated_at)
     VALUES (?, 'venture-digital-products', 'commercial_test', ?, ?, '', 1, ?, ?, ?)`,
    [
      id,
      terminal ? "Closed historical commercial test" : "Current commercial test",
      terminal ? "cancelled" : "running",
      toJson(metadata),
      OLD_AT,
      OLD_AT,
    ],
  );
}

function insertTask(db, {
  id,
  workflowId,
  status,
  title,
}) {
  run(
    db,
    `INSERT INTO tasks
     (id, workflow_id, venture_id, title, kind, agent, status, priority,
      payload, result, created_at, updated_at)
     VALUES (?, ?, 'venture-digital-products', ?, 'commercial_test',
             'commercial_operator', ?, 1, '{}', '{}', ?, ?)`,
    [id, workflowId, title, status, OLD_AT, OLD_AT],
  );
}

function insertFixture(db, { includeUnknownProviderOutcome = false } = {}) {
  insertWorkflow(db, IDS.buyerIntent.workflow, { terminal: true });
  insertWorkflow(db, ACTIVE_WORKFLOW_ID);
  for (const task of [
    {
      id: TERMINAL_FAILED_TASK_ID,
      workflowId: IDS.buyerIntent.workflow,
      status: "failed",
      title: "Closed historical failure",
    },
    {
      id: TERMINAL_QUEUED_TASK_ID,
      workflowId: IDS.buyerIntent.workflow,
      status: "queued",
      title: "Closed historical queue item",
    },
    {
      id: ACTIVE_FAILED_TASK_ID,
      workflowId: ACTIVE_WORKFLOW_ID,
      status: "failed",
      title: "Current failure",
    },
    {
      id: ACTIVE_QUEUED_TASK_ID,
      workflowId: ACTIVE_WORKFLOW_ID,
      status: "queued",
      title: "Current queue item",
    },
  ]) {
    insertTask(db, task);
  }

  for (const approval of [
    {
      id: "approval-terminal-monitor",
      taskId: TERMINAL_FAILED_TASK_ID,
      workflowId: IDS.buyerIntent.workflow,
      title: "Closed historical decision",
    },
    {
      id: "approval-current-monitor",
      taskId: ACTIVE_FAILED_TASK_ID,
      workflowId: ACTIVE_WORKFLOW_ID,
      title: "Current decision",
    },
  ]) {
    run(
      db,
      `INSERT INTO approvals
       (id, workflow_id, venture_id, task_id, scope, title, status, risk_level,
        requested_by, requested_at, payload)
       VALUES (?, ?, 'venture-digital-products', ?, 'commercial_test', ?,
               'pending', 'medium', 'test', ?, '{}')`,
      [approval.id, approval.workflowId, approval.taskId, approval.title, OLD_AT],
    );
  }

  for (const message of [
    {
      id: "message-terminal-monitor",
      taskId: TERMINAL_FAILED_TASK_ID,
      subject: "Closed historical escalation",
    },
    {
      id: "message-current-monitor",
      taskId: ACTIVE_FAILED_TASK_ID,
      subject: "Current escalation",
    },
  ]) {
    run(
      db,
      `INSERT INTO messages
       (id, task_id, severity, status, subject, body, created_at, metadata)
       VALUES (?, ?, 'urgent', 'open', ?, 'Review required.', ?, ?)`,
      [
        message.id,
        message.taskId,
        message.subject,
        OLD_AT,
        toJson({ source: "operator" }),
      ],
    );
  }

  if (includeUnknownProviderOutcome) {
    run(
      db,
      `INSERT INTO task_attempts
       (id, task_id, workflow_id, venture_id, claim_token, status, outcome_status,
        provider_request_id, started_at, completed_at, metadata)
       VALUES ('attempt-terminal-unknown-provider', ?, ?,
               'venture-digital-products', 'terminal-unknown-claim',
               'needs_attention', 'unknown', 'provider-request-unknown',
               ?, ?, '{}')`,
      [TERMINAL_FAILED_TASK_ID, IDS.buyerIntent.workflow, OLD_AT, OLD_AT],
    );
  }
}

test("monitor keeps reconciled commercial history closed while current faults remain actionable", () => {
  const runtime = makeRuntime("collection");
  try {
    insertFixture(runtime.db);

    const findings = collectFindings(runtime.db, { staleQueuedMinutes: 60 });
    const approvalFinding = findings.find((finding) => finding.category === "approvals");
    const messageFinding = findings.find((finding) => finding.category === "messages");
    const failedTaskFinding = findings.find((finding) => finding.category === "tasks");

    assert.ok(findings.some(
      (finding) => finding.category === "queue" && finding.entityId === ACTIVE_QUEUED_TASK_ID,
    ));
    assert.equal(findings.some(
      (finding) => finding.entityId === TERMINAL_QUEUED_TASK_ID,
    ), false);
    assert.deepEqual(
      approvalFinding.metadata.approvals.map((approval) => approval.id),
      ["approval-current-monitor"],
    );
    assert.deepEqual(
      messageFinding.metadata.messages.map((message) => message.id),
      ["message-current-monitor"],
    );
    assert.deepEqual(
      failedTaskFinding.metadata.failedTasks.map((task) => task.id),
      [ACTIVE_FAILED_TASK_ID],
    );
  } finally {
    closeRuntime(runtime);
  }
});

test("monitor resolves prior terminal alerts instead of reopening them", () => {
  const runtime = makeRuntime("persistence");
  try {
    insertFixture(runtime.db);
    run(
      runtime.db,
      `INSERT INTO monitor_runs
       (id, status, severity, finding_count, started_at, completed_at, metadata)
       VALUES ('monitor-terminal-prior', 'completed', 'error', 1, ?, ?, '{}')`,
      [OLD_AT, OLD_AT],
    );
    run(
      runtime.db,
      `INSERT INTO monitor_findings
       (id, run_id, severity, category, entity_type, entity_id, title, detail,
        status, metadata, created_at, fingerprint, first_seen, last_seen,
        occurrence_count)
       VALUES ('finding-terminal-prior', 'monitor-terminal-prior', 'error',
               'tasks', 'task', ?, 'Historical failure', 'Already closed.',
               'open', ?, ?, 'terminal-monitor-fingerprint', ?, ?, 1)`,
      [
        TERMINAL_FAILED_TASK_ID,
        toJson({ workflowId: IDS.buyerIntent.workflow }),
        OLD_AT,
        OLD_AT,
        OLD_AT,
      ],
    );
    run(
      runtime.db,
      `INSERT INTO messages
       (id, task_id, severity, status, subject, body, created_at, metadata)
       VALUES ('message-terminal-prior-runtime', ?, 'urgent', 'open',
               'Runtime monitor: Historical failure', 'Already closed.', ?, ?)`,
      [
        TERMINAL_FAILED_TASK_ID,
        OLD_AT,
        toJson({
          source: "runtime_monitor",
          monitorFingerprint: "terminal-monitor-fingerprint",
          entityType: "task",
          entityId: TERMINAL_FAILED_TASK_ID,
        }),
      ],
    );

    const monitored = runMonitorCycle(runtime.db, { staleQueuedMinutes: 60 });

    assert.equal(
      get(runtime.db, "SELECT status FROM monitor_findings WHERE id = 'finding-terminal-prior'").status,
      "resolved",
    );
    assert.equal(
      get(runtime.db, "SELECT status FROM messages WHERE id = 'message-terminal-prior-runtime'").status,
      "resolved",
    );
    assert.ok(monitored.findings.some(
      (finding) => finding.category === "tasks" && finding.entityId === ACTIVE_FAILED_TASK_ID,
    ));
    const activeMonitorMessages = all(
      runtime.db,
      `SELECT metadata FROM messages
       WHERE status = 'open'
         AND json_extract(metadata, '$.source') = 'runtime_monitor'`,
    ).map((row) => fromJson(row.metadata, {}));
    assert.ok(activeMonitorMessages.some(
      (metadata) => metadata.entityId === ACTIVE_FAILED_TASK_ID,
    ));
    assert.equal(activeMonitorMessages.some(
      (metadata) => metadata.entityId === TERMINAL_FAILED_TASK_ID,
    ), false);
  } finally {
    closeRuntime(runtime);
  }
});

test("terminal filtering never hides an unknown provider outcome", () => {
  const runtime = makeRuntime("provider-safety");
  try {
    insertFixture(runtime.db, { includeUnknownProviderOutcome: true });

    const findings = collectFindings(runtime.db);

    assert.ok(findings.some(
      (finding) => finding.category === "unknown_outcome"
        && finding.entityId === "attempt-terminal-unknown-provider",
    ));
  } finally {
    closeRuntime(runtime);
  }
});

test("an arbitrary terminal metadata flag cannot hide a current commercial fault", () => {
  const runtime = makeRuntime("metadata-spoof");
  try {
    const workflowId = "wf_untrusted_terminal_metadata";
    const taskId = "task_untrusted_terminal_metadata";
    insertWorkflow(runtime.db, workflowId);
    run(
      runtime.db,
      "UPDATE workflows SET metadata = ? WHERE id = ?",
      [
        toJson({
          commercialTruth: {
            terminal: true,
            historical: true,
            actionable: false,
          },
        }),
        workflowId,
      ],
    );
    insertTask(runtime.db, {
      id: taskId,
      workflowId,
      status: "failed",
      title: "Current fault with an untrusted terminal flag",
    });

    const findings = collectFindings(runtime.db);
    assert.ok(findings.some(
      (finding) => finding.category === "tasks"
        && finding.metadata.failedTasks.some((task) => task.id === taskId),
    ));
  } finally {
    closeRuntime(runtime);
  }
});

test("terminal history never hides an approval-integrity violation", () => {
  const runtime = makeRuntime("approval-integrity");
  try {
    insertWorkflow(runtime.db, IDS.buyerIntent.workflow, { terminal: true });
    const taskId = "task_terminal_approval_integrity";
    insertTask(runtime.db, {
      id: taskId,
      workflowId: IDS.buyerIntent.workflow,
      status: "completed",
      title: "Task continued after a denied decision",
    });
    run(
      runtime.db,
      `INSERT INTO approvals
       (id, workflow_id, venture_id, task_id, scope, title, status, risk_level,
        requested_by, requested_at, decided_at, payload)
       VALUES (
         'approval-terminal-integrity',
         ?,
         'venture-digital-products',
         ?,
         'commercial_test',
         'Denied historical action',
         'rejected',
         'medium',
         'test',
         ?,
         ?,
         '{}'
       )`,
      [IDS.buyerIntent.workflow, taskId, OLD_AT, OLD_AT],
    );
    run(
      runtime.db,
      "UPDATE tasks SET approval_id = ?, updated_at = ? WHERE id = ?",
      ["approval-terminal-integrity", "2026-07-02T00:00:00.000Z", taskId],
    );

    const findings = collectFindings(runtime.db);
    assert.ok(findings.some(
      (finding) => finding.category === "approval_integrity"
        && finding.entityId === taskId,
    ));
  } finally {
    closeRuntime(runtime);
  }
});
