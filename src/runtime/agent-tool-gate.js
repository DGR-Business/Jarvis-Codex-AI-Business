const { all, fromJson, get, insertEvent, now, randomId, run, toJson } = require("../db");
const { addAgentTrace } = require("./ai-team");
const { getAgentToolPolicyState } = require("./agent-tools");

const TOOL_GATE_SCHEMA = "jarvis_agent_tool_gate_v1";

class AgentToolApprovalRequiredError extends Error {
  constructor(result, input = {}) {
    super(`${result.tool?.name || input.toolId || "Worker tool"} needs operator approval before live use.`);
    this.name = "AgentToolApprovalRequiredError";
    this.agentToolApprovalRequired = true;
    this.result = result;
    this.approvalId = result.approvalId || null;
    this.invocationId = result.id || null;
    this.toolId = result.tool?.id || input.toolId || input.tool_id || null;
    this.agentId = input.agentId || input.agent_id || null;
    this.runId = input.runId || null;
    this.taskId = input.task?.id || input.taskId || null;
    this.workflowId = input.task?.workflow_id || input.workflowId || null;
    this.providerCallOccurred = input.providerCallOccurred === true;
    this.incurredEstimateCents = Number(input.incurredEstimateCents || 0);
    this.providerRequestId = input.providerRequestId || null;
    this.agentSdkTraceId = input.agentSdkTraceId || null;
  }
}

function isAgentToolApprovalRequiredError(error) {
  return Boolean(error?.agentToolApprovalRequired);
}

function parseInvocation(row) {
  if (!row) return null;
  return {
    ...row,
    metadata: fromJson(row.metadata, {}),
  };
}

function requestedMode(input) {
  const value = String(input || "protected").toLowerCase();
  if (["live", "external", "spend"].includes(value)) return "live";
  return "protected";
}

function findTool(policy, toolId) {
  return policy.tools.find((tool) => tool.id === toolId) || null;
}

function findAssignment(policy, agentId, toolId) {
  const agentPolicy = policy.byAgent[agentId];
  if (!agentPolicy) return null;
  return agentPolicy.assignments.find((assignment) => assignment.tool_id === toolId) || null;
}

function summarizeInput(input = {}) {
  return String(input.inputSummary || input.reason || input.purpose || "Worker requested tool access.").slice(0, 600);
}

function approvalIsApproved(approval) {
  return approval && approval.status === "approved";
}

function getApproval(db, approvalId) {
  if (!approvalId) return null;
  const row = get(db, "SELECT * FROM approvals WHERE id = ?", [approvalId]);
  return row ? { ...row, payload: fromJson(row.payload, {}) } : null;
}

function ensureRequestedToolPlaceholder(db, toolId) {
  const ts = now();
  run(
    db,
    `INSERT INTO agent_tools
      (id, name, category, status, mode, risk_level, dry_run_available,
       requires_approval, external_action, spend_possible, hard_stop,
       description, metadata, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO NOTHING`,
    [
      toolId,
      String(toolId).replaceAll("_", " "),
      "unknown",
      "needs_review",
      "unknown",
      "medium",
      0,
      1,
      0,
      0,
      0,
      "Unregistered tool was requested at runtime and needs review before assignment.",
      toJson({ schema: TOOL_GATE_SCHEMA, generatedFromInvocation: true }),
      ts,
      ts,
    ],
  );
}

function createToolApproval(db, { agentId, agentName, runId, tool, assignment, task, invocationId, inputSummary, metadata }) {
  const approvalId = `appr_tool_${randomId()}`;
  const ts = now();
  const scope = tool.approval_scope || assignment?.approval_scope || "agent_tool_use";
  const title = `${agentName || agentId} needs approval to use ${tool.name}`;
  const payload = {
    schema: TOOL_GATE_SCHEMA,
    reason: `${tool.name} can affect live systems, spend, publishing, account state, or external evidence. Review before live use.`,
    worker: { id: agentId, name: agentName || agentId },
    tool: {
      id: tool.id,
      name: tool.name,
      category: tool.category,
      mode: tool.mode,
      riskLevel: tool.risk_level,
      approvalScope: scope,
      externalAction: tool.external_action,
      spendPossible: tool.spend_possible,
    },
    invocationId,
    runId: runId || null,
    taskId: task?.id || null,
    workflowId: task?.workflow_id || null,
    inputSummary,
    resume: {
      kind: "agent_tool_invocation",
      approve: "Approve and queue this worker step to resume with the live tool check cleared.",
      changes: "Request changes and stop this worker step until the work is revised.",
      reject: "Deny and cancel this worker step. No live tool call will run.",
      nextSafeAction: "After approval, run the work queue again to continue the paused worker task.",
    },
    metadata,
  };
  run(
    db,
    `INSERT INTO approvals
      (id, workflow_id, scope, title, status, risk_level, requested_by, requested_at, payload)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      approvalId,
      task?.workflow_id || null,
      scope,
      title,
      "pending",
      tool.risk_level || "medium",
      agentId,
      ts,
      toJson(payload),
    ],
  );
  insertEvent(db, {
    level: tool.risk_level === "high" ? "warn" : "info",
    actor: agentId,
    type: "agent_tool.approval_requested",
    entityType: "approval",
    entityId: approvalId,
    message: `${agentName || agentId} requested approval to use ${tool.name}.`,
    metadata: payload,
  });
  return approvalId;
}

function hydrateApproval(approvalOrId, db) {
  if (!approvalOrId) return null;
  const row = typeof approvalOrId === "string"
    ? get(db, "SELECT * FROM approvals WHERE id = ?", [approvalOrId])
    : approvalOrId;
  if (!row) return null;
  return {
    ...row,
    payload: typeof row.payload === "string" ? fromJson(row.payload, {}) : row.payload || {},
  };
}

function recordInvocation(db, payload) {
  const ts = payload.requestedAt || now();
  const invocationId = payload.id || `tool_call_${randomId()}`;
  run(
    db,
    `INSERT INTO agent_tool_invocations
      (id, agent_id, run_id, task_id, workflow_id, tool_id, assignment_id, approval_id,
       requested_mode, status, decision, permission, risk_level, input_summary,
       output_summary, metadata, requested_at, resolved_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      invocationId,
      payload.agentId,
      payload.runId || null,
      payload.task?.id || payload.taskId || null,
      payload.task?.workflow_id || payload.workflowId || null,
      payload.toolId,
      payload.assignmentId || null,
      payload.approvalId || null,
      payload.mode,
      payload.status,
      payload.decision,
      payload.permission,
      payload.riskLevel || "medium",
      payload.inputSummary || "",
      payload.outputSummary || "",
      toJson({
        schema: TOOL_GATE_SCHEMA,
        ...(payload.metadata || {}),
      }),
      ts,
      payload.resolvedAt || (payload.status === "allowed" || payload.status === "blocked" ? ts : null),
    ],
  );
  return invocationId;
}

function recordAgentToolObservation(db, invocationId, observation = {}) {
  const invocation = parseInvocation(get(db, "SELECT * FROM agent_tool_invocations WHERE id = ?", [invocationId]));
  if (!invocation) throw new Error(`Agent tool invocation not found: ${invocationId}`);
  const ts = now();
  const failed = observation.status === "failed";
  const status = failed ? "blocked" : "allowed";
  const outputSummary = String(
    observation.outputSummary
      || (failed ? `${observation.toolName || invocation.tool_id} failed during provider execution.` : `${observation.toolName || invocation.tool_id} completed and its evidence was recorded.`),
  ).slice(0, 1200);
  const metadata = {
    ...invocation.metadata,
    providerObservation: {
      recordedAt: ts,
      ...observation,
    },
  };
  run(
    db,
    `UPDATE agent_tool_invocations
     SET status = ?, output_summary = ?, metadata = ?, resolved_at = ?
     WHERE id = ?`,
    [status, outputSummary, toJson(metadata), ts, invocationId],
  );
  return parseInvocation(get(db, "SELECT * FROM agent_tool_invocations WHERE id = ?", [invocationId]));
}

function traceToolDecision(db, runId, decision, title, detail, metadata) {
  if (!runId) return;
  addAgentTrace(db, runId, `tool_call.${decision}`, title, detail, {
    schema: TOOL_GATE_SCHEMA,
    ...metadata,
  });
}

function resolveAgentToolApproval(db, approvalOrId, decision, note = "", options = {}) {
  const approval = hydrateApproval(approvalOrId, db);
  const payload = approval?.payload || {};
  if (!approval || (payload.schema !== TOOL_GATE_SCHEMA && !payload.invocationId)) {
    return { handled: false };
  }

  const invocationId = payload.invocationId;
  const invocation = parseInvocation(get(db, "SELECT * FROM agent_tool_invocations WHERE id = ?", [invocationId]));
  if (!invocation) return { handled: false, reason: "missing_invocation", invocationId };

  const ts = options.decidedAt || now();
  const approved = decision === "approved";
  const status = approved ? "allowed" : "blocked";
  const mappedDecision = approved ? "approved_live" : decision === "needs_changes" ? "needs_changes" : "rejected";
  const outputSummary = approved
    ? `${payload.tool?.name || invocation.tool_id} was approved for live use. The paused worker task can resume.`
    : decision === "needs_changes"
      ? `${payload.tool?.name || invocation.tool_id} needs changes before live use. The paused worker task was stopped.`
      : `${payload.tool?.name || invocation.tool_id} was denied. The paused worker task was cancelled.`;
  const metadata = {
    ...invocation.metadata,
    approvalDecision: {
      decision,
      note,
      decidedAt: ts,
      approvalId: approval.id,
      resume: payload.resume || null,
    },
  };

  run(
    db,
    `UPDATE agent_tool_invocations
     SET status = ?, decision = ?, output_summary = ?, metadata = ?, resolved_at = ?
     WHERE id = ?`,
    [status, mappedDecision, outputSummary, toJson(metadata), ts, invocationId],
  );

  const traceType = approved
    ? "tool_call.approved"
    : decision === "needs_changes"
      ? "tool_call.needs_changes"
      : "tool_call.rejected";
  const traceTitle = approved ? "Tool approved" : decision === "needs_changes" ? "Tool changes requested" : "Tool denied";
  traceToolDecision(db, payload.runId || invocation.run_id, traceType.replace("tool_call.", ""), traceTitle, outputSummary, {
    invocationId,
    approvalId: approval.id,
    toolId: payload.tool?.id || invocation.tool_id,
    decision,
  });

  insertEvent(db, {
    level: approved ? "info" : "warn",
    actor: "operator",
    type: approved ? "agent_tool.approved" : decision === "needs_changes" ? "agent_tool.needs_changes" : "agent_tool.rejected",
    entityType: "agent_tool_invocation",
    entityId: invocationId,
    message: outputSummary,
    metadata: {
      approvalId: approval.id,
      taskId: payload.taskId || invocation.task_id || null,
      workflowId: payload.workflowId || invocation.workflow_id || null,
      decision,
    },
  });

  return {
    handled: true,
    invocationId,
    approvalId: approval.id,
    taskId: payload.taskId || invocation.task_id || null,
    workflowId: payload.workflowId || invocation.workflow_id || null,
    runId: payload.runId || invocation.run_id || null,
    status,
    decision: mappedDecision,
    resume: payload.resume || null,
  };
}

function requestAgentToolUse(db, input = {}) {
  const agentId = input.agentId || input.agent_id;
  const toolId = input.toolId || input.tool_id;
  if (!agentId) throw new Error("Worker id is required for a tool request.");
  if (!toolId) throw new Error("Tool id is required for a tool request.");

  const policy = getAgentToolPolicyState(db);
  const tool = findTool(policy, toolId);
  const assignment = findAssignment(policy, agentId, toolId);
  const mode = requestedMode(input.mode || input.requestedMode);
  const inputSummary = summarizeInput(input);
  const approval = getApproval(db, input.ignoreTaskApproval ? input.approvalId : (input.approvalId || input.task?.approval_id));
  const agentPolicy = policy.byAgent[agentId] || {};
  const agentName = input.agentName || agentPolicy.agentName || agentId;
  const baseMetadata = {
    reason: input.reason || null,
    requestedBy: input.requestedBy || "agent-runner",
    toolKnown: Boolean(tool),
    assignmentKnown: Boolean(assignment),
    approvedApprovalId: approvalIsApproved(approval) ? approval.id : null,
    providerCapability: tool?.provider_capability || null,
    liveFlag: tool?.live_flag || null,
    ...(input.metadata || {}),
  };

  if (!tool) {
    ensureRequestedToolPlaceholder(db, toolId);
    const invocationId = recordInvocation(db, {
      agentId,
      runId: input.runId,
      task: input.task,
      toolId,
      mode,
      status: "blocked",
      decision: "needs_review",
      permission: "needs_review",
      riskLevel: "medium",
      inputSummary,
      outputSummary: "Tool is not registered in the worker tool policy.",
      metadata: baseMetadata,
    });
    traceToolDecision(db, input.runId, "blocked", "Tool blocked", `${agentName} tried to use an unregistered tool: ${toolId}.`, { invocationId, toolId });
    insertEvent(db, {
      level: "warn",
      actor: agentId,
      type: "agent_tool.blocked",
      entityType: "agent_tool_invocation",
      entityId: invocationId,
      message: `${agentName} was blocked from using unregistered tool ${toolId}.`,
      metadata: { toolId, reason: "unregistered_tool" },
    });
    return {
      id: invocationId,
      status: "blocked",
      decision: "needs_review",
      allowed: false,
      approvalRequired: false,
      blocked: true,
      reason: "unregistered_tool",
    };
  }

  if (tool.hard_stop) {
    const invocationId = recordInvocation(db, {
      agentId,
      runId: input.runId,
      task: input.task,
      toolId,
      assignmentId: assignment?.id || null,
      mode,
      status: "blocked",
      decision: "hard_stop",
      permission: "blocked",
      riskLevel: tool.risk_level,
      inputSummary,
      outputSummary: `${tool.name} is locked and cannot be used by workers.`,
      metadata: { ...baseMetadata, toolName: tool.name },
    });
    traceToolDecision(db, input.runId, "blocked", "Tool blocked", `${tool.name} is locked and cannot be used by ${agentName}.`, { invocationId, toolId, hardStop: true });
    insertEvent(db, {
      level: "warn",
      actor: agentId,
      type: "agent_tool.blocked",
      entityType: "agent_tool_invocation",
      entityId: invocationId,
      message: `${agentName} was blocked from using locked tool ${tool.name}.`,
      metadata: { toolId, reason: "hard_stop" },
    });
    return {
      id: invocationId,
      status: "blocked",
      decision: "hard_stop",
      allowed: false,
      approvalRequired: false,
      blocked: true,
      reason: "hard_stop",
      tool,
    };
  }

  if (!assignment) {
    const invocationId = recordInvocation(db, {
      agentId,
      runId: input.runId,
      task: input.task,
      toolId,
      mode,
      status: "blocked",
      decision: "not_assigned",
      permission: "blocked",
      riskLevel: tool.risk_level,
      inputSummary,
      outputSummary: `${tool.name} is registered but is not assigned to this worker.`,
      metadata: { ...baseMetadata, toolName: tool.name },
    });
    traceToolDecision(db, input.runId, "blocked", "Tool blocked", `${tool.name} is not assigned to ${agentName}.`, { invocationId, toolId });
    insertEvent(db, {
      level: "warn",
      actor: agentId,
      type: "agent_tool.blocked",
      entityType: "agent_tool_invocation",
      entityId: invocationId,
      message: `${agentName} was blocked from using unassigned tool ${tool.name}.`,
      metadata: { toolId, reason: "not_assigned" },
    });
    return {
      id: invocationId,
      status: "blocked",
      decision: "not_assigned",
      allowed: false,
      approvalRequired: false,
      blocked: true,
      reason: "not_assigned",
      tool,
    };
  }

  const protectedAllowed = mode === "protected" && tool.dry_run_available;
  if (assignment.permission === "allowed" || protectedAllowed || approvalIsApproved(approval)) {
    const decision = approvalIsApproved(approval)
      ? "approved_live"
      : protectedAllowed && assignment.permission === "requires_approval"
        ? "allowed_protected"
        : "allowed";
    const invocationId = recordInvocation(db, {
      agentId,
      runId: input.runId,
      task: input.task,
      toolId,
      assignmentId: assignment.id,
      approvalId: approvalIsApproved(approval) ? approval.id : null,
      mode,
      status: "allowed",
      decision,
      permission: assignment.permission,
      riskLevel: tool.risk_level,
      inputSummary,
      outputSummary: input.outputSummary || `${tool.name} passed the worker tool gate.`,
      metadata: { ...baseMetadata, toolName: tool.name },
    });
    traceToolDecision(db, input.runId, "allowed", "Tool allowed", `${tool.name} passed the worker tool gate for ${agentName}.`, { invocationId, toolId, decision, mode });
    return {
      id: invocationId,
      status: "allowed",
      decision,
      allowed: true,
      approvalRequired: false,
      blocked: false,
      tool,
      assignment,
      approvalId: approvalIsApproved(approval) ? approval.id : null,
    };
  }

  if (assignment.permission === "requires_approval") {
    const invocationId = `tool_call_${randomId()}`;
    const approvalId = createToolApproval(db, {
      agentId,
      agentName,
      runId: input.runId,
      tool,
      assignment,
      task: input.task,
      invocationId,
      inputSummary,
      metadata: baseMetadata,
    });
    recordInvocation(db, {
      id: invocationId,
      agentId,
      runId: input.runId,
      task: input.task,
      toolId,
      assignmentId: assignment.id,
      approvalId,
      mode,
      status: "approval_required",
      decision: "needs_approval",
      permission: assignment.permission,
      riskLevel: tool.risk_level,
      inputSummary,
      outputSummary: `${tool.name} needs operator approval before live use.`,
      metadata: { ...baseMetadata, toolName: tool.name },
    });
    traceToolDecision(db, input.runId, "approval_requested", "Tool needs approval", `${tool.name} needs approval before ${agentName} can use it live.`, { invocationId, toolId, approvalId });
    return {
      id: invocationId,
      status: "approval_required",
      decision: "needs_approval",
      allowed: false,
      approvalRequired: true,
      blocked: false,
      reason: "approval_required",
      approvalId,
      tool,
      assignment,
    };
  }

  const invocationId = recordInvocation(db, {
    agentId,
    runId: input.runId,
    task: input.task,
    toolId,
    assignmentId: assignment.id,
    mode,
    status: "blocked",
    decision: "permission_blocked",
    permission: assignment.permission || "blocked",
    riskLevel: tool.risk_level,
    inputSummary,
    outputSummary: `${tool.name} is not available under the current worker permission.`,
    metadata: { ...baseMetadata, toolName: tool.name },
  });
  traceToolDecision(db, input.runId, "blocked", "Tool blocked", `${tool.name} is blocked by worker permission for ${agentName}.`, { invocationId, toolId });
  return {
    id: invocationId,
    status: "blocked",
    decision: "permission_blocked",
    allowed: false,
    approvalRequired: false,
    blocked: true,
    reason: "permission_blocked",
    tool,
    assignment,
  };
}

function requireAgentToolUse(db, input = {}) {
  const result = requestAgentToolUse(db, input);
  if (result.allowed) return result;
  if (result.approvalRequired) {
    throw new AgentToolApprovalRequiredError(result, input);
  }
  throw new Error(`${result.tool?.name || input.toolId} is blocked by worker tool permissions.`);
}

function listAgentToolInvocations(db, limit = 200) {
  return all(
    db,
    `SELECT agent_tool_invocations.*,
       agent_definitions.name AS agent_name,
       agent_tools.name AS tool_name,
       agent_tools.category AS tool_category,
       agent_tools.mode AS tool_mode,
       agent_tools.status AS tool_status,
       agent_tools.description AS tool_description,
       approvals.title AS approval_title,
       approvals.status AS approval_status
     FROM agent_tool_invocations
     LEFT JOIN agent_definitions ON agent_definitions.id = agent_tool_invocations.agent_id
     LEFT JOIN agent_tools ON agent_tools.id = agent_tool_invocations.tool_id
     LEFT JOIN approvals ON approvals.id = agent_tool_invocations.approval_id
     ORDER BY agent_tool_invocations.requested_at DESC
     LIMIT ?`,
    [limit],
  ).map(parseInvocation);
}

function getAgentToolGateState(db) {
  const invocations = listAgentToolInvocations(db);
  return {
    schema: TOOL_GATE_SCHEMA,
    status: invocations.some((item) => item.status === "blocked") ? "attention" : "ready",
    summary: invocations.length
      ? `${invocations.length} worker tool check${invocations.length === 1 ? "" : "s"} recorded.`
      : "No worker tool calls have been checked yet.",
    metrics: {
      invocations: invocations.length,
      allowed: invocations.filter((item) => item.status === "allowed").length,
      approvalRequired: invocations.filter((item) => item.status === "approval_required").length,
      blocked: invocations.filter((item) => item.status === "blocked").length,
      approvedLive: invocations.filter((item) => item.decision === "approved_live").length,
    },
    invocations,
  };
}

module.exports = {
  AgentToolApprovalRequiredError,
  TOOL_GATE_SCHEMA,
  getAgentToolGateState,
  isAgentToolApprovalRequiredError,
  listAgentToolInvocations,
  recordAgentToolObservation,
  requestAgentToolUse,
  requireAgentToolUse,
  resolveAgentToolApproval,
};
