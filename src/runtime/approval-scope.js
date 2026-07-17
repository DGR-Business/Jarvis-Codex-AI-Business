const crypto = require("node:crypto");
const CONFIG = require("../config");
const { fromJson, get, now, run, toJson } = require("../db");

const EXECUTION_DESCRIPTOR_SCHEMA = "jarvis.execution-descriptor.v1";

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

function asCanonicalList(value) {
  const values = Array.isArray(value) ? value : value ? [value] : [];
  return [...new Set(values.map((item) => String(item).trim()).filter(Boolean))].sort();
}

function scopeHash(value) {
  return crypto.createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function descriptorBody(value = {}) {
  const { descriptorHash, ...body } = value && typeof value === "object" ? value : {};
  return body;
}

function createExecutionDescriptor(value = {}) {
  const body = canonicalValue({ schema: EXECUTION_DESCRIPTOR_SCHEMA, ...descriptorBody(value) });
  const required = ["kind", "provider", "model", "materializedInput", "materializedInputHash", "tools", "limits", "tracePolicy", "preflightRequirements", "externalEffects", "worstCaseCost"];
  const missing = required.filter((key) => body[key] === undefined || body[key] === null || body[key] === "");
  if (missing.length) throw new Error(`Execution descriptor is missing: ${missing.join(", ")}.`);
  const descriptor = { ...body, descriptorHash: scopeHash(body) };
  const validation = verifyExecutionDescriptor(descriptor);
  if (!validation.valid) throw new Error(validation.reason);
  return descriptor;
}

function verifyExecutionDescriptor(descriptor) {
  if (!descriptor || typeof descriptor !== "object") {
    return { valid: false, reason: "The paid work request has no immutable execution descriptor." };
  }
  if (descriptor.schema !== EXECUTION_DESCRIPTOR_SCHEMA) {
    return { valid: false, reason: "The paid work request uses an unsupported execution descriptor." };
  }
  const currentHash = scopeHash(canonicalValue(descriptorBody(descriptor)));
  if (!descriptor.descriptorHash || descriptor.descriptorHash !== currentHash) {
    return { valid: false, reason: "The execution descriptor changed after it was created.", currentHash };
  }
  if (descriptor.worstCaseCost?.currency !== CONFIG.currency
      || !Number.isInteger(Number(descriptor.worstCaseCost?.amountCents))
      || Number(descriptor.worstCaseCost?.amountCents) < 1) {
    return { valid: false, reason: `The execution descriptor does not contain a whole-${CONFIG.currency}-cent worst-case cost.`, currentHash };
  }
  if (!String(descriptor.provider || "").trim() || !String(descriptor.model || "").trim()) {
    return { valid: false, reason: "The execution descriptor has no exact provider and model.", currentHash };
  }
  if (!Array.isArray(descriptor.tools) || !Array.isArray(descriptor.externalEffects)) {
    return { valid: false, reason: "The execution descriptor tools and external effects must be exact lists.", currentHash };
  }
  if (!descriptor.tracePolicy || typeof descriptor.tracePolicy !== "object") {
    return { valid: false, reason: "The execution descriptor has no exact trace policy.", currentHash };
  }
  const preflight = descriptor.preflightRequirements;
  if (!preflight || !Array.isArray(preflight.providerEnv) || !Array.isArray(preflight.liveFlags)
      || !Array.isArray(preflight.runtimeCapabilities)) {
    return { valid: false, reason: "The execution descriptor has no exact provider preflight requirements.", currentHash };
  }
  if (scopeHash(descriptor.materializedInput) !== descriptor.materializedInputHash) {
    return { valid: false, reason: "The execution descriptor materialized-input hash is inconsistent.", currentHash };
  }
  const limits = descriptor.limits || {};
  const positiveIntegerLimits = ["maxInputTokens", "maxOutputTokens", "maxTurns", "deadlineMs"];
  if (positiveIntegerLimits.some((key) => !Number.isInteger(Number(limits[key])) || Number(limits[key]) < 1)
      || !Number.isInteger(Number(limits.maxToolCalls))
      || Number(limits.maxToolCalls) < 0) {
    return { valid: false, reason: "The execution descriptor has incomplete or invalid execution limits.", currentHash };
  }
  if (!Number.isInteger(Number(descriptor.maxCostCents))
      || Number(descriptor.maxCostCents) < 1
      || Number(descriptor.worstCaseCost.amountCents) > Number(descriptor.maxCostCents)) {
    return { valid: false, reason: "The execution descriptor worst-case price is not covered by its exact cost cap.", currentHash };
  }
  const priced = descriptor.worstCaseCost;
  if (priced.model !== descriptor.model
      || Number(priced.maxInputTokensPerTurn) !== Number(limits.maxInputTokens)
      || Number(priced.maxOutputTokensPerTurn) !== Number(limits.maxOutputTokens)
      || Number(priced.maxTurns) !== Number(limits.maxTurns)
      || Number(priced.maxToolCalls) !== Number(limits.maxToolCalls)
      || scopeHash(priced.tools || []) !== scopeHash(descriptor.tools)) {
    return { valid: false, reason: "The execution descriptor limits do not match its priced worst-case calculation.", currentHash };
  }
  return { valid: true, currentHash, descriptor };
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
  const descriptor = spend.executionDescriptor || approvalPayload.executionDescriptor || null;
  const worker = spend.worker || approvalPayload.worker || {};
  const tools = descriptor?.tools || spend.tools || approvalPayload.tools || worker.tools || [];
  const fixtureHash = spend.fixtureHash
    || approvalPayload.fixtureHash
    || approvalPayload.comparisonPacket?.fixtureHash
    || taskPayload.fixtureHash
    || null;
  const maxCostCents = Number(
    descriptor?.maxCostCents
      || spend.maxCostCents
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
    workerId: descriptor?.workerId || worker.id || spend.requestedWorker || approvalPayload.requestedWorker || task?.agent || null,
    provider: descriptor?.provider || spend.provider || approvalPayload.provider || null,
    model: descriptor?.model || spend.model || approvalPayload.model || null,
    fixtureHash,
    tools,
    toolArguments: descriptor?.toolArguments || spend.toolArguments || approvalPayload.toolArguments || {},
    parameters: descriptor?.parameters || spend.parameters || approvalPayload.parameters || {},
    maxTurns: Number(descriptor?.limits?.maxTurns || spend.maxTurns || approvalPayload.maxTurns || 1),
    maxToolCalls: Number(descriptor?.limits?.maxToolCalls ?? spend.maxToolCalls ?? approvalPayload.maxToolCalls ?? 0),
    deadlineMs: Number(descriptor?.limits?.deadlineMs || spend.deadlineMs || approvalPayload.deadlineMs || 60000),
    resumeStateHash: approvalPayload.metadata?.sdkRunStateHash || approvalPayload.sdkRunStateHash || null,
    maxInputTokens: Number(descriptor?.limits?.maxInputTokens || 0),
    maxOutputTokens: Number(descriptor?.limits?.maxOutputTokens || spend.maxOutputTokens || approvalPayload.maxOutputTokens || 0),
    maxCostCents,
    worstCaseCostCents: Number(descriptor?.worstCaseCost?.amountCents || 0),
    executionDescriptorHash: descriptor?.descriptorHash || null,
    materializedInputHash: descriptor?.materializedInputHash || null,
    effects: descriptor?.externalEffects || spend.effects || approvalPayload.effects || parsedValue(approval.expected_effects, []),
    tracePolicy: descriptor?.tracePolicy || spend.tracePolicy || approvalPayload.tracePolicy || {
      providerResponseStored: false,
      providerTraceContent: false,
      localReviewStored: true,
      dataClass: "business_internal",
    },
    scope: approval.scope,
  };
}

function persistApprovalScope(db, approvalId) {
  const approval = get(db, "SELECT * FROM approvals WHERE id = ?", [approvalId]);
  if (!approval) throw new Error(`Approval not found: ${approvalId}`);
  const task = taskForApproval(db, approval);
  const taskPayload = parsedValue(task?.payload, {});
  const spend = taskPayload.liveSpendRequest || {};
  const descriptorCheck = verifyExecutionDescriptor(spend.executionDescriptor);
  if (spend.requested === true && !descriptorCheck.valid) throw new Error(descriptorCheck.reason);
  const scope = buildApprovalScope(approval, task);
  const hash = scopeHash(scope);
  const expiresAt = approval.expires_at
    || new Date(Date.now() + CONFIG.approvalTokenTtlHours * 60 * 60 * 1000).toISOString();
  run(
    db,
    `UPDATE approvals
     SET venture_id = ?, task_id = ?, scope_hash = ?, expires_at = ?, expected_effects = ?
     WHERE id = ? AND scope_hash IS NULL`,
    [scope.ventureId, task?.id || approval.task_id || null, hash, expiresAt, toJson(scope.effects), approvalId],
  );
  const persisted = get(db, "SELECT * FROM approvals WHERE id = ?", [approvalId]);
  if (persisted.scope_hash !== hash) throw new Error("Approval scope is already persisted with different execution details.");
  return { approval: persisted, task, scope, scopeHash: hash };
}

function ensureApprovalScope(db, approvalId) {
  const approval = get(db, "SELECT * FROM approvals WHERE id = ?", [approvalId]);
  if (!approval) throw new Error(`Approval not found: ${approvalId}`);
  const task = taskForApproval(db, approval);
  const scope = buildApprovalScope(approval, task);
  const currentHash = scopeHash(scope);
  return {
    approval,
    task,
    scope,
    scopeHash: approval.scope_hash || currentHash,
    currentHash,
    persisted: Boolean(approval.scope_hash),
  };
}

function currentResearchRequestHash(db, task) {
  const hydratedTask = { ...task, payload: parsedValue(task?.payload, {}), result: parsedValue(task?.result, {}) };
  const workflowRow = get(db, "SELECT * FROM workflows WHERE id = ?", [task.workflow_id]);
  const workflow = workflowRow ? { ...workflowRow, metadata: parsedValue(workflowRow.metadata, {}) } : null;
  const command = get(db, "SELECT * FROM commands WHERE workflow_id = ? ORDER BY created_at DESC LIMIT 1", [task.workflow_id]);
  if (!workflow) return null;
  const subject = hydratedTask.payload.subject || workflow.metadata.subject || workflow.title || "business idea";
  const channel = hydratedTask.payload.channel || workflow.metadata.channel || "Business Idea";
  const instruction = workflow.metadata.originalInstruction || command?.raw_text || "";
  const query = `${channel} ${subject} demand competitors pricing risks ${instruction}`.replace(/\s+/g, " ").trim();
  const { buildOpenAIRequest } = require("../adapters/research");
  return scopeHash(buildOpenAIRequest(hydratedTask, workflow, command, query));
}

function currentWorkerPacketHash(db, task, descriptor) {
  const { AI_TEAM_DEFINITIONS } = require("./ai-team");
  const { buildWorkerModelPacket } = require("./agent-model-contracts");
  const hydratedTask = { ...task, payload: parsedValue(task?.payload, {}), result: parsedValue(task?.result, {}) };
  const workerId = descriptor.workerId || hydratedTask.payload.requestedWorker || task.agent;
  const definition = AI_TEAM_DEFINITIONS.find((candidate) => candidate.id === workerId);
  if (!definition) return null;
  const definitionHash = scopeHash({
    id: definition.id,
    name: definition.name,
    role: definition.role,
    instructions: definition.instructions,
    outputContract: definition.outputContract,
    approvalPolicy: definition.approval_policy,
  });
  if (descriptor.workerDefinitionHash && descriptor.workerDefinitionHash !== definitionHash) return null;
  const packet = buildWorkerModelPacket(db, hydratedTask, definition);
  const stablePacket = JSON.parse(JSON.stringify(packet));
  delete stablePacket.packetHash;
  delete stablePacket.date;
  if (stablePacket.workflow) {
    delete stablePacket.workflow.status;
    delete stablePacket.workflow.currentStep;
  }
  return scopeHash(stablePacket);
}

function executionRequestEnvelopes(spend, descriptor) {
  const envelope = {
    kind: spend.type,
    provider: spend.provider,
    model: spend.model,
    tools: spend.tools || [],
    toolArguments: spend.toolArguments || {},
    limits: {
      maxInputTokens: Number(spend.maxInputTokens),
      maxOutputTokens: Number(spend.maxOutputTokens),
      maxTurns: Number(spend.maxTurns),
      maxToolCalls: Number(spend.maxToolCalls),
      deadlineMs: Number(spend.deadlineMs),
    },
    tracePolicy: spend.tracePolicy,
    preflightRequirements: {
      providerEnv: asCanonicalList(spend.requiresProviderEnv),
      liveFlags: asCanonicalList(spend.requiresLiveFlag),
      runtimeCapabilities: asCanonicalList(spend.requiresRuntimeCapability),
    },
    externalEffects: spend.effects || [],
    maxCostCents: Number(spend.maxCostCents),
    pricedWorstCaseCostCents: Number(spend.pricedWorstCaseCostCents),
  };
  const approved = {
    kind: descriptor.kind,
    provider: descriptor.provider,
    model: descriptor.model,
    tools: descriptor.tools || [],
    toolArguments: descriptor.toolArguments || {},
    limits: {
      maxInputTokens: Number(descriptor.limits?.maxInputTokens),
      maxOutputTokens: Number(descriptor.limits?.maxOutputTokens),
      maxTurns: Number(descriptor.limits?.maxTurns),
      maxToolCalls: Number(descriptor.limits?.maxToolCalls),
      deadlineMs: Number(descriptor.limits?.deadlineMs),
    },
    tracePolicy: descriptor.tracePolicy,
    preflightRequirements: {
      providerEnv: asCanonicalList(descriptor.preflightRequirements?.providerEnv),
      liveFlags: asCanonicalList(descriptor.preflightRequirements?.liveFlags),
      runtimeCapabilities: asCanonicalList(descriptor.preflightRequirements?.runtimeCapabilities),
    },
    externalEffects: descriptor.externalEffects || [],
    maxCostCents: Number(descriptor.maxCostCents),
    pricedWorstCaseCostCents: Number(descriptor.worstCaseCost?.amountCents),
  };
  const workerId = spend.worker?.id || spend.requestedWorker;
  if (workerId !== undefined) {
    envelope.workerId = workerId;
    approved.workerId = descriptor.workerId;
  }
  if (Object.prototype.hasOwnProperty.call(spend, "parameters")) {
    envelope.parameters = spend.parameters;
    approved.parameters = descriptor.parameters || {};
  }
  return { envelope, approved };
}

function validateRequestEnvelope(spend, descriptor) {
  const { envelope, approved } = executionRequestEnvelopes(spend, descriptor);
  if (scopeHash(envelope) !== scopeHash(approved)) {
    return {
      valid: false,
      reason: "The task scope changed after approval was requested.",
      envelopeHash: scopeHash(envelope),
      approvedHash: scopeHash(approved),
    };
  }
  return { valid: true };
}

function validateMaterializedExecution(db, task, descriptor) {
  const descriptorCheck = verifyExecutionDescriptor(descriptor);
  if (!descriptorCheck.valid) return descriptorCheck;
  const taskPayload = parsedValue(task?.payload, {});
  const envelopeCheck = validateRequestEnvelope(taskPayload.liveSpendRequest || {}, descriptor);
  if (!envelopeCheck.valid) return envelopeCheck;
  let currentMaterializedHash = null;
  let expectedMaterializedHash = descriptor.materializedInputHash;
  if (descriptor.kind === "live_ai_worker") {
    currentMaterializedHash = currentWorkerPacketHash(db, task, descriptor);
    expectedMaterializedHash = descriptor.sourceStateHash || descriptor.materializedInputHash;
  } else if (descriptor.kind === "live_research") {
    currentMaterializedHash = currentResearchRequestHash(db, task);
  } else {
    return { valid: false, reason: `Unsupported paid execution kind: ${descriptor.kind}.` };
  }
  if (!currentMaterializedHash || currentMaterializedHash !== expectedMaterializedHash) {
    return { valid: false, reason: "The materialized model input changed after approval was requested." };
  }
  return { valid: true, currentMaterializedHash, descriptor };
}

function validateApprovalScope(db, approvalId, task, expectedScopeHash, options = {}) {
  const ensured = ensureApprovalScope(db, approvalId);
  const approval = ensured.approval;
  const currentTask = task || ensured.task;
  if (!approval.scope_hash) {
    return { valid: false, reason: "The approval has no persisted execution scope.", approval, currentHash: ensured.currentHash };
  }
  const taskPayload = parsedValue(currentTask?.payload, {});
  const descriptorValidation = taskPayload.liveSpendRequest?.requested === true
    ? validateMaterializedExecution(db, currentTask, taskPayload.liveSpendRequest.executionDescriptor)
    : { valid: true };
  if (!descriptorValidation.valid) {
    return { valid: false, reason: descriptorValidation.reason, approval, currentHash: ensured.currentHash };
  }
  const currentScope = buildApprovalScope(approval, currentTask);
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
  if (approval.consumed_at && options.allowConsumedContinuation !== true) {
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
  EXECUTION_DESCRIPTOR_SCHEMA,
  buildApprovalScope,
  canonicalJson,
  consumeApproval,
  createExecutionDescriptor,
  executionRequestEnvelopes,
  ensureApprovalScope,
  persistApprovalScope,
  scopeHash,
  validateApprovalScope,
  validateMaterializedExecution,
  verifyExecutionDescriptor,
};
