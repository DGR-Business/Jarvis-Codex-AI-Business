const { randomUUID } = require("node:crypto");
const CONFIG = require("../config");
const { all, fromJson, get, insertEvent, now, randomId, run, toJson } = require("../db");

const APPROVAL_ACTIONS = [
  { decision: "approved", label: "Approve" },
  { decision: "needs_changes", label: "Request changes" },
  { decision: "rejected", label: "Reject" },
];

function addHours(date, hours) {
  return new Date(date.getTime() + hours * 60 * 60 * 1000).toISOString();
}

function normalizeBaseUrl(baseUrl = CONFIG.publicBaseUrl) {
  return String(baseUrl || "http://127.0.0.1:5051").replace(/\/$/, "");
}

function createActionToken() {
  return `act_${randomId().replaceAll("-", "")}`;
}

function getExpiry(options = {}) {
  if (options.expiresAt) return options.expiresAt;
  return addHours(new Date(), Number(options.ttlHours || CONFIG.approvalTokenTtlHours || 72));
}

function hydrate(row) {
  if (!row) return null;
  return { ...row, metadata: fromJson(row.metadata) };
}

function ensureApprovalActionTokens(db, approval, options = {}) {
  if (!db || !approval || !approval.id) return [];

  const existing = all(
    db,
    `SELECT * FROM approval_action_tokens
     WHERE approval_id = ? AND status = 'active'
     ORDER BY created_at ASC`,
    [approval.id],
  );
  const byDecision = new Map(existing.map((row) => [row.decision, row]));
  const missing = APPROVAL_ACTIONS.filter((action) => !byDecision.has(action.decision));

  if (missing.length > 0) {
    const ts = now();
    const expiresAt = getExpiry(options);
    for (const action of missing) {
      const token = createActionToken();
      run(
        db,
        `INSERT INTO approval_action_tokens
         (id, approval_id, decision, token, status, expires_at, metadata, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          `aat_${randomId()}`,
          approval.id,
          action.decision,
          token,
          "active",
          expiresAt,
          toJson({ label: action.label, workflowId: approval.workflow_id }),
          ts,
        ],
      );
    }
  }

  return all(
    db,
    `SELECT * FROM approval_action_tokens
     WHERE approval_id = ? AND status = 'active'
     ORDER BY CASE decision WHEN 'approved' THEN 0 WHEN 'needs_changes' THEN 1 ELSE 2 END`,
    [approval.id],
  ).map(hydrate);
}

function actionLinks(tokens, options = {}) {
  const baseUrl = normalizeBaseUrl(options.baseUrl);
  return tokens.map((token) => {
    const action = APPROVAL_ACTIONS.find((item) => item.decision === token.decision);
    return {
      tokenId: token.id,
      decision: token.decision,
      label: action?.label || token.decision,
      method: "POST",
      apiUrl: `${baseUrl}/api/approval-actions/${encodeURIComponent(token.token)}`,
      dashboardUrl: baseUrl,
      expiresAt: token.expires_at,
    };
  });
}

function latestOpenMessageForTask(db, taskId) {
  if (!taskId) return null;
  return get(
    db,
    `SELECT * FROM messages
     WHERE task_id = ? AND status = 'open'
     ORDER BY created_at DESC LIMIT 1`,
    [taskId],
  );
}

function queueApprovalEscalation(db, approval, task, options = {}) {
  if (!db || !approval || !approval.id || approval.status !== "pending") return null;

  const existing = get(
    db,
    `SELECT * FROM notification_outbox
     WHERE approval_id = ? AND channel = 'email' AND status IN ('queued_dry_run', 'ready_to_send')
     ORDER BY created_at DESC LIMIT 1`,
    [approval.id],
  );
  const tokens = ensureApprovalActionTokens(db, approval, options);
  const links = actionLinks(tokens, options);

  if (existing) {
    return { ...hydrate(existing), deduped: true, actionLinks: links };
  }

  const dryRun = options.dryRun !== false || CONFIG.dryRun || !process.env.SMTP_HOST;
  const ts = now();
  const message = latestOpenMessageForTask(db, task?.id);
  const recipient = CONFIG.operatorEmail || "operator-email-not-configured";
  const subject = `Approval needed: ${approval.title}`;
  const body = [
    `Approval needed: ${approval.title}`,
    `Workflow: ${approval.workflow_id || task?.workflow_id || "not linked"}`,
    `Task: ${task?.title || "not linked"}`,
    `Scope: ${approval.scope || "not captured"}`,
    `Risk: ${approval.risk_level || "medium"}`,
    "",
    "Prepared actions:",
    ...links.map((link) => `- ${link.label}: POST ${link.apiUrl}`),
    "",
    dryRun
      ? "Dry-run notification only: no email was sent because live email is not enabled/configured."
      : "Ready to send through the configured email provider.",
  ].join("\n");
  const metadata = {
    dryRun,
    workflowId: approval.workflow_id || task?.workflow_id,
    taskId: task?.id,
    messageId: message?.id || null,
    actionLinks: links,
    requiresPost: true,
    skippedReason: dryRun ? (!process.env.SMTP_HOST ? "SMTP/provider not configured" : "runtime is in dry-run mode") : null,
  };
  const id = `notice_${randomId()}`;

  run(
    db,
    `INSERT INTO notification_outbox
     (id, message_id, approval_id, channel, recipient, subject, body, status, provider, mode, metadata, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      message?.id || null,
      approval.id,
      "email",
      recipient,
      subject,
      body,
      dryRun ? "queued_dry_run" : "ready_to_send",
      process.env.SMTP_HOST ? "smtp" : "dry-run",
      dryRun ? "dry-run" : "live",
      toJson(metadata),
      ts,
    ],
  );

  insertEvent(db, {
    level: dryRun ? "info" : "warn",
    actor: "notification-adapter",
    type: dryRun ? "notification.queued_dry_run" : "notification.ready_to_send",
    entityType: "approval",
    entityId: approval.id,
    message: dryRun
      ? `Dry-run email escalation queued for approval ${approval.id}; no email was sent.`
      : `Email escalation prepared for approval ${approval.id}.`,
    metadata,
  });

  return { ...hydrate(get(db, "SELECT * FROM notification_outbox WHERE id = ?", [id])), actionLinks: links };
}

async function sendEscalation(message, options = {}) {
  const channels = options.channels || ["dashboard"];
  const dryRun = options.dryRun !== false || !process.env.SMTP_HOST || CONFIG.dryRun;
  return {
    id: `notice_${randomUUID()}`,
    dryRun,
    channels,
    subject: message.subject,
    delivered: dryRun ? ["dashboard"] : channels,
    skipped: dryRun ? channels.filter((channel) => channel !== "dashboard") : [],
  };
}

module.exports = {
  ensureApprovalActionTokens,
  queueApprovalEscalation,
  sendEscalation,
};
