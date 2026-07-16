const { decideApproval } = require("./approvals");
const { fromJson, get, insertEvent, now, randomId, run, toJson } = require("../db");

const APPROVAL_ID_RE = /\b(appr[-_a-zA-Z0-9]+)\b/;
const TOKEN_RE = /\b(act_[a-fA-F0-9]{24,})\b/;

function firstMeaningfulLine(body) {
  return String(body || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith(">"))[0] || "";
}

function parseReplyDecision(body) {
  const line = firstMeaningfulLine(body).toLowerCase().replace(/[.!?]+$/g, "");
  if (/^(approve|approved|yes|proceed|go ahead|continue)\b/.test(line)) return "approved";
  if (/^(changes|change|revise|revision|needs changes|needs_changes|edit)\b/.test(line)) return "needs_changes";
  if (/^(reject|rejected|no|stop|cancel|kill|do not approve|don't approve)\b/.test(line)) return "rejected";
  return null;
}

function resolveApprovalFromInput(db, input) {
  if (input.approvalId) return get(db, "SELECT * FROM approvals WHERE id = ?", [input.approvalId]);

  if (input.outboxId) {
    const outbox = get(db, "SELECT * FROM notification_outbox WHERE id = ?", [input.outboxId]);
    if (outbox?.approval_id) return get(db, "SELECT * FROM approvals WHERE id = ?", [outbox.approval_id]);
  }

  const tokenValue = input.token || String(input.subject || "").match(TOKEN_RE)?.[1] || String(input.body || "").match(TOKEN_RE)?.[1];
  if (tokenValue) {
    const token = get(db, "SELECT * FROM approval_action_tokens WHERE token = ?", [tokenValue]);
    if (token?.approval_id) return get(db, "SELECT * FROM approvals WHERE id = ?", [token.approval_id]);
  }

  const combined = `${input.subject || ""}\n${input.body || ""}`;
  const approvalId = combined.match(APPROVAL_ID_RE)?.[1];
  if (approvalId) return get(db, "SELECT * FROM approvals WHERE id = ?", [approvalId]);

  return null;
}

function insertInboundMessage(db, input, status, approval, decision, metadata = {}) {
  const id = `inbound_${randomId()}`;
  const ts = now();
  run(
    db,
    `INSERT INTO inbound_messages
     (id, channel, provider, sender, subject, body, status, approval_id, decision, received_at, processed_at, metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.channel || "email",
      input.provider || "dry-run",
      input.sender || null,
      input.subject || "",
      input.body || "",
      status,
      approval?.id || null,
      decision || null,
      input.receivedAt || ts,
      status === "processed" ? ts : null,
      toJson(metadata),
    ],
  );
  return get(db, "SELECT * FROM inbound_messages WHERE id = ?", [id]);
}

function escalateUnclearReply(db, inbound, reason) {
  run(
    db,
    `INSERT INTO messages (id, severity, status, subject, body, created_at, metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      `msg_reply_${randomId()}`,
      "approval",
      "open",
      "Approval reply needs review",
      reason,
      now(),
      toJson({ inboundMessageId: inbound.id, approvalId: inbound.approval_id }),
    ],
  );
}

function processApprovalReply(db, input = {}) {
  const decision = parseReplyDecision(input.body || "");
  const approval = resolveApprovalFromInput(db, input);
  const metadata = {
    parser: "first-line-approval-reply-v1",
    firstLine: firstMeaningfulLine(input.body || ""),
    suppliedApprovalId: input.approvalId || null,
    suppliedOutboxId: input.outboxId || null,
    dryRunInbound: input.dryRun !== false,
  };

  if (!approval || !decision) {
    const reason = !approval
      ? "The approval reply could not be linked to a pending approval."
      : "The approval reply did not start with a clear approve, changes, or reject decision.";
    const inbound = insertInboundMessage(db, input, "needs_operator_review", approval, decision, { ...metadata, reason });
    escalateUnclearReply(db, inbound, reason);
    insertEvent(db, {
      level: "warn",
      actor: "approval-reply-parser",
      type: "approval_reply.needs_review",
      entityType: "inbound_message",
      entityId: inbound.id,
      message: reason,
      metadata: { approvalId: approval?.id || null, decision },
    });
    return { status: "needs_operator_review", inbound: { ...inbound, metadata: fromJson(inbound.metadata) }, approval, decision, changed: false };
  }

  if (approval.status !== "pending") {
    const inbound = insertInboundMessage(db, input, "ignored", approval, decision, { ...metadata, reason: "Approval was already decided." });
    insertEvent(db, {
      level: "warn",
      actor: "approval-reply-parser",
      type: "approval_reply.ignored",
      entityType: "approval",
      entityId: approval.id,
      message: `Ignored approval reply because ${approval.id} is already ${approval.status}.`,
      metadata: { inboundMessageId: inbound.id, decision },
    });
    return { status: "ignored", inbound: { ...inbound, metadata: fromJson(inbound.metadata) }, approval, decision, changed: false };
  }

  const result = decideApproval(db, approval.id, decision, input.note || `Approval reply from ${input.sender || "operator"}.`);
  const inbound = insertInboundMessage(db, input, "processed", result.approval, decision, metadata);
  insertEvent(db, {
    level: decision === "approved" ? "info" : "warn",
    actor: "approval-reply-parser",
    type: `approval_reply.${decision}`,
    entityType: "approval",
    entityId: approval.id,
    message: `Processed approval reply for ${approval.id} as ${decision}.`,
    metadata: { inboundMessageId: inbound.id, sender: input.sender || null },
  });

  return {
    status: "processed",
    inbound: { ...inbound, metadata: fromJson(inbound.metadata) },
    approval: result.approval,
    decision,
    changed: result.changed,
  };
}

module.exports = {
  parseReplyDecision,
  processApprovalReply,
};
