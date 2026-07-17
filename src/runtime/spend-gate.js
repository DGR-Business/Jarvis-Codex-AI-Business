const CONFIG = require("../config");
const { all, fromJson, get, insertEvent, now, randomId, run, toJson } = require("../db");
const { queueApprovalEscalation } = require("../adapters/notifications");
const { isAgentRuntimeSdkAvailable } = require("./agent-runtime");
const {
  ensureApprovalScope,
  persistApprovalScope,
  validateApprovalScope,
  verifyExecutionDescriptor,
} = require("./approval-scope");
const { retentionRequirementsForTask } = require("./retention-policy");

function safeId(value) {
  return String(value || "task")
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .slice(0, 88);
}

function spendRequestForTask(task) {
  const request = task.payload?.liveSpendRequest;
  if (!request || request.requested !== true) return null;
  return request;
}

function approvalIdForTask(task) {
  return `appr_spend_${safeId(task.id)}`;
}

function costIdForTask(task) {
  return `cost_spend_${safeId(task.id)}`;
}

function amountForRequest(task, request) {
  return Math.max(0, Number(request.maxCostCents || request.estimatedCostCents || task.cost_budget_cents || 0));
}

function riskForAmount(cents) {
  if (cents >= 2500) return "high";
  if (cents >= 500) return "medium";
  return "low";
}

function asArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value.filter(Boolean) : [value];
}

const RUNTIME_CAPABILITY_CHECKS = {
  live_research_adapter: () => process.env.JARVIS_DISABLE_LIVE_RESEARCH_ADAPTER !== "1",
  live_ai_worker_adapter: () => process.env.JARVIS_DISABLE_LIVE_AI_WORKER_ADAPTER !== "1",
  openai_agents_sdk_runner: () => isAgentRuntimeSdkAvailable(),
};

function missingPreflightRequirements(request = {}) {
  const missing = [];
  const descriptorCheck = verifyExecutionDescriptor(request.executionDescriptor);
  if (!descriptorCheck.valid) {
    missing.push({ kind: "safety", name: "execution_descriptor", message: descriptorCheck.reason });
  } else if (Number(request.executionDescriptor.worstCaseCost.amountCents) > Number(request.maxCostCents || request.estimatedCostCents || 0)) {
    missing.push({
      kind: "safety",
      name: "worst_case_cost",
      message: "The priced worst-case execution cost is above the approved per-run cap.",
    });
  }

  for (const name of asArray(request.requiresProviderEnv)) {
    if (!process.env[name]) {
      missing.push({ kind: "env", name, message: `${name} is not configured.` });
    }
  }

  for (const name of asArray(request.requiresLiveFlag)) {
    if (process.env[name] !== "1") {
      missing.push({ kind: "flag", name, expected: "1", message: `${name} must be set to 1.` });
    }
  }

  for (const name of asArray(request.requiresRuntimeCapability)) {
    const check = RUNTIME_CAPABILITY_CHECKS[name];
    if (!check || !check()) {
      missing.push({ kind: "capability", name, message: `${name} is not marked ready in the runtime.` });
    }
  }

  return missing;
}

function missingTaskRequirements(db, task, request = {}) {
  return [
    ...missingPreflightRequirements(request),
    ...retentionRequirementsForTask(db, task),
  ];
}

function requirementLabel(requirement) {
  if (requirement.kind === "env") return `missing env ${requirement.name}`;
  if (requirement.kind === "flag") return `${requirement.name} != ${requirement.expected || "1"}`;
  if (requirement.kind === "policy") return requirement.message;
  if (requirement.kind === "safety") return requirement.message;
  return `runtime capability ${requirement.name} not ready`;
}

function approvalPayload(task, request, amountCents) {
  return {
    liveSpendRequest: true,
    taskId: task.id,
    taskKind: task.kind,
    agent: task.agent,
    requestedWorker: request.worker?.id || task.payload?.requestedWorker || task.agent || null,
    worker: request.worker || null,
    type: request.type || "ai_work",
    provider: request.provider || "not_selected",
    model: request.model || CONFIG.liveModel || null,
    executionDescriptor: request.executionDescriptor || null,
    providerRequirements: {
      env: asArray(request.requiresProviderEnv),
      flags: asArray(request.requiresLiveFlag),
      capabilities: asArray(request.requiresRuntimeCapability),
    },
    estimatedCostCents: amountCents,
    worstCaseCostCents: Number(request.executionDescriptor?.worstCaseCost?.amountCents || 0),
    currency: CONFIG.currency,
    reason: request.reason || "Operator approval required before paid AI/tool work can run.",
    commercialPurpose: request.commercialPurpose || "Not captured yet.",
    comparisonSource: request.comparisonSource || null,
    protectedEvidence: asArray(request.protectedEvidence).slice(0, 8),
    expectedMetric: request.expectedMetric || null,
    fixtureHash: request.fixtureHash || null,
    tools: asArray(request.tools),
    toolArguments: request.toolArguments || {},
    parameters: request.parameters || {},
    maxTurns: Number(request.maxTurns || 1),
    maxToolCalls: Number(request.maxToolCalls || 0),
    deadlineMs: Number(request.deadlineMs || 60000),
    maxInputTokens: Number(request.maxInputTokens || request.executionDescriptor?.limits?.maxInputTokens || 0),
    maxOutputTokens: Number(request.maxOutputTokens || CONFIG.liveModelMaxOutputTokens || 0),
    maxCostCents: amountCents,
    effects: asArray(request.executionDescriptor?.externalEffects || request.effects),
    tracePolicy: request.executionDescriptor?.tracePolicy || request.tracePolicy || {
      providerResponseStored: false,
      providerTraceContent: false,
      localReviewStored: true,
      dataClass: "business_internal",
    },
    noSpendBeforeAdapter: true,
    noSpendOccurred: true,
  };
}

function getSpendApprovalState(db, task, options = {}) {
  const request = spendRequestForTask(task);
  if (!request) return null;

  const taskApproval = task.approval_id ? get(db, "SELECT payload FROM approvals WHERE id = ?", [task.approval_id]) : null;
  const taskApprovalPayload = fromJson(taskApproval?.payload, {});
  const continuationParentId = taskApprovalPayload.exactScope
    ? taskApprovalPayload.metadata?.parentApprovalId || null
    : null;
  const approvalId = continuationParentId || task.approval_id || request.approvalId || approvalIdForTask(task);
  const validationOptions = continuationParentId
    ? { ...options, allowConsumedContinuation: true }
    : options;
  const approval = get(db, "SELECT * FROM approvals WHERE id = ?", [approvalId]);
  const scopedApproval = approval ? ensureApprovalScope(db, approvalId).approval : null;
  const scopeValidation = approval
    ? validateApprovalScope(db, approvalId, { ...task, approval_id: approvalId }, undefined, validationOptions)
    : { valid: false, reason: "A persisted approval is required." };
  const missingRequirements = missingTaskRequirements(db, task, request);
  if (approval && !scopeValidation.valid) {
    missingRequirements.push({
      kind: "safety",
      name: "approval_scope",
      message: scopeValidation.reason,
    });
  }
  return {
    required: true,
    approvalId,
    status: scopedApproval?.status || "not_requested",
    approved: scopedApproval?.status === "approved" && scopeValidation.valid && missingRequirements.length === 0,
    approvalApproved: scopedApproval?.status === "approved",
    approvalValid: scopeValidation.valid,
    approvalInvalidReason: scopeValidation.valid ? null : scopeValidation.reason,
    scopeHash: scopedApproval?.scope_hash || null,
    estimatedCostCents: amountForRequest(task, request),
    currency: CONFIG.currency,
    type: request.type || "ai_work",
    provider: request.provider || "not_selected",
    providerReady: missingRequirements.length === 0,
    missingRequirements,
    reason: request.reason || "Operator approval required before paid AI/tool work can run.",
  };
}

function blockForProviderReadiness(db, task, approval, request, amountCents, missingRequirements, ts) {
  const policyBlocked = missingRequirements.some((requirement) => requirement.kind === "policy");
  const safetyBlocked = missingRequirements.some((requirement) => requirement.kind === "safety");
  const subject = policyBlocked
    ? `Data protection decision needed: ${task.title}`
    : safetyBlocked
      ? `Safety check needed: ${task.title}`
      : `Provider setup needed: ${task.title}`;
  const labels = missingRequirements.map(requirementLabel);
  const result = {
    blockedBy: approval.id,
    approvalStatus: approval.status,
    spendApprovalRequired: true,
    estimatedCostCents: amountCents,
    providerBlocked: true,
    providerReady: false,
    missingRequirements,
    noSpendOccurred: true,
    requestedWorker: request.worker?.id || task.payload?.requestedWorker || task.agent || null,
    worker: request.worker || null,
    nextAction: policyBlocked
      ? "Review the data protection plan before this exact work can run."
      : safetyBlocked
        ? "Correct the safety settings and prepare a new exact approval."
        : "Configure the missing provider/runtime requirements before live paid work can run.",
  };

  run(
    db,
    `UPDATE tasks SET status = 'blocked', approval_id = ?, result = ?, setup_block_reason = ?, outcome_status = 'not_started', updated_at = ? WHERE id = ?`,
    [approval.id, toJson(result), labels.join(", "), ts, task.id],
  );
  run(
    db,
    `UPDATE workflows SET status = 'blocked_for_credentials', current_step = ?, approval_required = 1, updated_at = ? WHERE id = ?`,
    [
      policyBlocked
        ? "Waiting for the data protection decision"
        : safetyBlocked
          ? "Waiting for corrected safety settings"
          : `Provider setup needed: ${labels.join(", ")}`,
      ts,
      task.workflow_id,
    ],
  );

  const existing = get(
    db,
    `SELECT id FROM messages WHERE task_id = ? AND subject = ? AND status = 'open' LIMIT 1`,
    [task.id, subject],
  );
  if (!existing) {
    run(
      db,
      `INSERT INTO messages (id, task_id, severity, status, subject, body, created_at, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        `msg_provider_${randomId()}`,
        task.id,
        "urgent",
        "open",
        subject,
        policyBlocked
          ? "The task approval is recorded, but no live spend occurred. Review the data protection plan before this work uses sensitive records, live web research, or provider-side storage."
          : `The spend approval is approved, but no live spend occurred. Missing: ${labels.join(", ")}.`,
        ts,
        toJson({ approvalId: approval.id, missingRequirements, provider: request.provider || "not_selected" }),
      ],
    );
  }

  insertEvent(db, {
    level: "warn",
    actor: "spend-gate",
    type: policyBlocked ? "spend_approval.policy_blocked" : "spend_approval.provider_blocked",
    entityType: "task",
    entityId: task.id,
    message: policyBlocked
      ? `Approved paid work remains blocked for ${task.title}; the data protection plan is not active.`
      : `Approved paid work remains blocked for ${task.title}; provider/runtime setup is incomplete.`,
    metadata: { approvalId: approval.id, missingRequirements, estimatedCostCents: amountCents, currency: CONFIG.currency },
  });

  return {
    required: true,
    approved: false,
    approval,
    providerBlocked: true,
    providerReady: false,
    missingRequirements,
    estimatedCostCents: amountCents,
    noSpendOccurred: true,
  };
}

function ensureSpendApproval(db, task, options = {}) {
  const request = spendRequestForTask(task);
  if (!request) return { required: false, approved: true };

  const descriptorCheck = verifyExecutionDescriptor(request.executionDescriptor);
  if (!descriptorCheck.valid) throw new Error(descriptorCheck.reason);
  if (Number(descriptorCheck.descriptor.worstCaseCost.amountCents) > amountForRequest(task, request)) {
    throw new Error("The priced worst-case execution cost is above the requested per-run cap.");
  }

  const approvalId = task.approval_id || request.approvalId || approvalIdForTask(task);
  const amountCents = amountForRequest(task, request);
  const ts = now();
  let approval = get(db, "SELECT * FROM approvals WHERE id = ?", [approvalId]);

  if (!approval) {
    const title = request.title || `Approve paid work for ${task.title}`;
    run(
      db,
      `INSERT INTO approvals (id, workflow_id, venture_id, task_id, scope, title, status, risk_level, requested_by, requested_at, payload, expected_effects)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        approvalId,
        task.workflow_id,
        task.venture_id || null,
        task.id,
        request.scope || "live_ai_spend",
        title,
        "pending",
        request.riskLevel || riskForAmount(amountCents),
        "spend-gate",
        ts,
        toJson(approvalPayload(task, request, amountCents)),
        toJson(asArray(request.effects)),
      ],
    );
    approval = persistApprovalScope(db, approvalId).approval;

    run(
      db,
      `INSERT OR IGNORE INTO costs (id, workflow_id, venture_id, category, source, status, amount_cents, currency, occurred_at, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        costIdForTask(task),
        task.workflow_id,
        task.venture_id || null,
        request.type || "live_ai_spend",
        request.provider || "ai-provider-pending",
        "approval_requested",
        0,
        CONFIG.currency,
        ts,
        toJson({
          approvalId,
          taskId: task.id,
          source: request.provider || "ai-provider-pending",
          estimatedCostCents: amountCents,
          worstCaseCostCents: Number(request.executionDescriptor?.worstCaseCost?.amountCents || 0),
          executionDescriptorHash: request.executionDescriptor?.descriptorHash || null,
          noSpendOccurred: true,
          reason: request.reason || "Paid work approval requested.",
          requestedWorker: request.worker?.id || task.payload?.requestedWorker || task.agent || null,
          worker: request.worker || null,
        }),
      ],
    );

    run(
      db,
      `INSERT INTO messages (id, task_id, severity, status, subject, body, created_at, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        `msg_spend_${randomId()}`,
        task.id,
        "approval",
        "open",
        title,
        `Approval is required before paid ${request.type || "AI/tool"} work can run. Estimated cost: ${amountCents} cents ${CONFIG.currency}.`,
        ts,
        toJson({ approvalId, estimatedCostCents: amountCents, type: request.type || "ai_work" }),
      ],
    );

    insertEvent(db, {
      level: "warn",
      actor: "spend-gate",
      type: "spend_approval.requested",
      entityType: "task",
      entityId: task.id,
      message: `Paid work approval requested for ${task.title}. No spend occurred.`,
      metadata: { approvalId, estimatedCostCents: amountCents, currency: CONFIG.currency, workflowId: task.workflow_id },
    });
  }

  approval = approval.scope_hash
    ? ensureApprovalScope(db, approval.id).approval
    : persistApprovalScope(db, approval.id).approval;

  if (approval.status !== "approved") {
    run(
      db,
      `UPDATE tasks SET status = 'blocked', approval_id = ?, result = ?, updated_at = ? WHERE id = ?`,
      [
        approval.id,
        toJson({ blockedBy: approval.id, approvalStatus: approval.status, spendApprovalRequired: true, estimatedCostCents: amountCents }),
        ts,
        task.id,
      ],
    );
    run(
      db,
      `UPDATE workflows SET status = 'blocked_for_approval', current_step = ?, approval_required = 1, updated_at = ? WHERE id = ?`,
      [approval.title, ts, task.workflow_id],
    );
    const escalation = queueApprovalEscalation(db, approval, task, { dryRun: CONFIG.dryRun });
    return { required: true, approved: false, approval, escalation, estimatedCostCents: amountCents };
  }

  const scopeValidation = validateApprovalScope(db, approval.id, task, undefined, options);
  if (!scopeValidation.valid) {
    return {
      required: true,
      approved: false,
      approval,
      approvalInvalid: true,
      reason: scopeValidation.reason,
      missingRequirements: [{ kind: "safety", name: "approval_scope", message: scopeValidation.reason }],
      estimatedCostCents: amountCents,
      noSpendOccurred: true,
    };
  }

  if (options.requireConsumedApproval === true && !approval.consumed_at) {
    return {
      required: true,
      approved: false,
      approval,
      approvalInvalid: true,
      reason: "The parent approval was not consumed by the paused provider run.",
      missingRequirements: [{
        kind: "safety",
        name: "parent_approval_consumption",
        message: "The parent approval was not consumed by the paused provider run.",
      }],
      estimatedCostCents: amountCents,
      noSpendOccurred: true,
    };
  }

  const missingRequirements = missingTaskRequirements(db, task, request);
  if (missingRequirements.length > 0) {
    return blockForProviderReadiness(db, task, approval, request, amountCents, missingRequirements, ts);
  }

  return {
    required: true,
    approved: true,
    approval,
    estimatedCostCents: amountCents,
    state: getSpendApprovalState(db, { ...task, approval_id: approval.id }, options),
  };
}

function recoverSetupBlockedTasks(db) {
  const blocked = all(
    db,
    "SELECT * FROM tasks WHERE status = 'blocked' AND setup_block_reason IS NOT NULL ORDER BY updated_at",
  );
  const recovered = [];
  const stillBlocked = [];
  for (const row of blocked) {
    const task = { ...row, payload: fromJson(row.payload), result: fromJson(row.result) };
    const request = spendRequestForTask(task);
    const missingRequirements = request ? missingTaskRequirements(db, task, request) : [];
    if (!request || missingRequirements.length) {
      stillBlocked.push({ taskId: task.id, missingRequirements });
      continue;
    }
    const approvalId = task.approval_id || request.approvalId;
    const approval = approvalId ? ensureApprovalScope(db, approvalId).approval : null;
    const validation = approval ? validateApprovalScope(db, approval.id, task) : { valid: false, reason: "A current approval is required." };
    if (!approval || approval.status !== "approved" || !validation.valid) {
      if (approval && !validation.valid && approval.status === "approved") {
        run(db, "UPDATE approvals SET status = 'superseded', decision_note = ? WHERE id = ?", [validation.reason, approval.id]);
      }
      stillBlocked.push({ taskId: task.id, reason: validation.reason });
      continue;
    }
    const ts = now();
    run(
      db,
      `UPDATE tasks SET status = 'queued', setup_block_reason = NULL, result = ?, updated_at = ? WHERE id = ?`,
      [toJson({ setupRecoveredAt: ts, approvalId: approval.id }), ts, task.id],
    );
    run(db, "UPDATE workflows SET status = 'ready', current_step = 'Approved worker is ready to run', updated_at = ? WHERE id = ?", [ts, task.workflow_id]);
    insertEvent(db, {
      actor: "runtime",
      type: "task.setup_recovered",
      entityType: "task",
      entityId: task.id,
      message: `${task.title} is ready now that its provider setup is complete.`,
      metadata: { approvalId: approval.id, scopeHash: approval.scope_hash },
    });
    recovered.push(task.id);
  }
  return { recovered, stillBlocked };
}

module.exports = {
  ensureSpendApproval,
  getSpendApprovalState,
  missingPreflightRequirements,
  missingTaskRequirements,
  recoverSetupBlockedTasks,
  spendRequestForTask,
};
