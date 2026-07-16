const crypto = require("node:crypto");
const CONFIG = require("../config");
const { fromJson, get, now, run, toJson } = require("../db");

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .filter((key) => value[key] !== undefined)
        .map((key) => [key, canonicalValue(value[key])]),
    );
  }
  return value ?? null;
}

function canonicalJson(value) {
  return JSON.stringify(canonicalValue(value));
}

function scopeHash(value) {
  return crypto.createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function parsedValue(value, fallback) {
  if (value && typeof value === "object") return value;
  return fromJson(value, fallback);
}

function taskForApproval(db, approval) {
  if (approval.task_id) return get(db, "SELECT * FROM tasks WHERE id = ?", [approval.task_id]);
  return get(db, "SELECT * FROM tasks WHERE approval_id = ? ORDER BY created_at LIMIT 1", [approval.id]);
}

function buildApprovalScope(approval, task) {
  const approvalPayload = parsedValue(approval.payload, {});
  const taskPayload = parsedValue(task?.payload, {});
  const spend = taskPayload.liveSpendRequest || approvalPayload.liveSpendRequest || {};
  const worker = spend.worker || approvalPayload.worker || {};
  const tools = spend.tools || approvalPayload.tools || worker.tools || [];
  const fixtureHash = spend.fixtureHash
    || approvalPayload.fixtureHash
    || approvalPayload.comparisonPacket?.fixtureHash
    || taskPayload.fixtureHash
    || null;
  const maxCostCents = Number(
    spend.maxCostCents
      || spend.estimatedCostCents
      || approvalPayload.maxCostCents
      || approvalPayload.estimatedCostCents
      || task?.cost_budget_cents
      || 0,
  );
  return {
    ventureId: task?.venture_id || approval.venture_id || approvalPayload.ventureId || null,
    workflowId: task?.workflow_id || approval.workflow_id || null,
    taskId: task?.id || approval.task_id || approvalPayload.taskId || null,
    workerId: worker.id || spend.requestedWorker || approvalPayload.requestedWorker || task?.agent || null,
    provider: spend.provider || approvalPayload.provider || null,
    model: spend.model || approvalPayload.model || process.env.JARVIS_LIVE_MODEL || CONFIG.liveModel || null,
    fixtureHash,
    tools,
    toolArguments: spend.toolArguments || approvalPayload.toolArguments || {},
    parameters: spend.parameters || approvalPayload.parameters || {},
    maxTurns: Number(spend.maxTurns || approvalPayload.maxTurns || 1),
    maxToolCalls: Number(spend.maxToolCalls ?? approvalPayload.maxToolCalls ?? 0),
    deadlineMs: Number(spend.deadlineMs || approvalPayload.deadlineMs || 60000),
    resumeStateHash: approvalPayload.metadata?.sdkRunStateHash || approvalPayload.sdkRunStateHash || null,
    maxOutputTokens: Number(spend.maxOutputTokens || approvalPayload.maxOutputTokens || CONFIG.liveModelMaxOutputTokens || 0),
    maxCostCents,
    effects: spend.effects || approvalPayload.effects || parsedValue(approval.expected_effects, []),
    tracePolicy: spend.tracePolicy || approvalPayload.tracePolicy || {
      providerResponseStored: false,
      providerTraceContent: false,
      localReviewStored: true,
      dataClass: "business_internal",
    },
    scope: approval.scope,
  };
}

function ensureApprovalScope(db, approvalId) {
  const approval = get(db, "SELECT * FROM approvals WHERE id = ?", [approvalId]);
  if (!approval) throw new Error(`Approval not found: ${approvalId}`);
  const task = taskForApproval(db, approval);
  const scope = buildApprovalScope(approval, task);
  const hash = approval.scope_hash || scopeHash(scope);
  const expiresAt = approval.expires_at
    || new Date(Date.now() + CONFIG.approvalTokenTtlHours * 60 * 60 * 1000).toISOString();
  if (
    !approval.scope_hash
    || approval.task_id !== (task?.id || approval.task_id)
    || approval.venture_id !== (scope.ventureId || approval.venture_id)
    || approval.expires_at !== expiresAt
  ) {
    run(
      db,
      `UPDATE approvals
       SET venture_id = ?, task_id = ?, scope_hash = ?, expires_at = ?, expected_effects = ?
       WHERE id = ?`,
      [scope.ventureId, task?.id || approval.task_id || null, hash, expiresAt, toJson(scope.effects), approvalId],
    );
  }
  return { approval: get(db, "SELECT * FROM approvals WHERE id = ?", [approvalId]), task, scope, scopeHash: hash };
}

function validateApprovalScope(db, approvalId, task, expectedScopeHash) {
  const ensured = ensureApprovalScope(db, approvalId);
  const approval = ensured.approval;
  const currentScope = buildApprovalScope(approval, task || ensured.task);
  const currentHash = scopeHash(currentScope);
  if (expectedScopeHash && expectedScopeHash !== approval.scope_hash) {
    return { valid: false, reason: "The approval card changed after it was opened.", approval, currentHash };
  }
  if (currentHash !== approval.scope_hash) {
    return { valid: false, reason: "The task scope changed after approval was requested.", approval, currentHash };
  }
  if (approval.expires_at && Date.parse(approval.expires_at) <= Date.now()) {
    return { valid: false, reason: "The approval expired.", approval, currentHash };
  }
  if (approval.consumed_at) {
    return { valid: false, reason: "The approval has already been used.", approval, currentHash };
  }
  return { valid: true, approval, scope: currentScope, currentHash };
}

function consumeApproval(db, approvalId, task) {
  const validation = validateApprovalScope(db, approvalId, task);
  if (!validation.valid) throw new Error(validation.reason);
  if (validation.approval.status !== "approved") throw new Error("The requested work is not approved.");
  const consumedAt = now();
  const result = run(
    db,
    `UPDATE approvals SET consumed_at = ?
     WHERE id = ? AND status = 'approved' AND consumed_at IS NULL`,
    [consumedAt, approvalId],
  );
  if (result.changes !== 1) throw new Error("The approval could not be consumed exactly once.");
  return { ...validation, consumedAt };
}

module.exports = {
  buildApprovalScope,
  canonicalJson,
  consumeApproval,
  ensureApprovalScope,
  scopeHash,
  validateApprovalScope,
};
