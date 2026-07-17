const { all, fromJson, get, insertEvent, now, randomId, run, toJson } = require("../db");
const { contextProfile } = require("./agent-context");
const { AI_TEAM_DEFINITIONS, recordAgentHandoff } = require("./ai-team");
const { requestLiveAiWorker } = require("./live-ai-workers");

const CHIEF_ASSIGNMENT_SCHEMA = "jarvis.chief-specialist-assignment.v1";
const DEFAULT_ALLOWED_WORKERS = AI_TEAM_DEFINITIONS
  .filter((definition) => definition.id !== "chief_of_staff")
  .map((definition) => definition.id);
const QUALITY_REVIEWED_WORKERS = new Set([
  "product_builder",
  "copy_conversion_agent",
  "distribution_operator",
]);
function safeId(value) {
  return String(value || randomId()).replace(/[^a-zA-Z0-9_-]+/g, "_").slice(0, 72);
}

function text(value, max = 1000) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function list(value) {
  return [...new Set((Array.isArray(value) ? value : []).filter(Boolean).map(String))];
}

function specialistDefinition(workerId) {
  return AI_TEAM_DEFINITIONS.find((definition) => definition.id === workerId) || null;
}

function normalizedPolicy(task) {
  const configured = task.payload?.chiefOrchestration?.policy || {};
  const allowedWorkers = list(configured.allowedWorkers).length
    ? list(configured.allowedWorkers)
    : DEFAULT_ALLOWED_WORKERS;
  return {
    allowedWorkers,
    allowedModes: list(configured.allowedModes).length
      ? list(configured.allowedModes)
      : ["protected", "supervised_live"],
    maxSpecialistCostCents: Math.max(40, Math.min(500, Number(configured.maxSpecialistCostCents || 100))),
    oneOpenAssignmentPerWorkflow: true,
  };
}

function normalizedChiefRequest(output) {
  const work = output?.roleOutput || output?.work || {};
  return {
    needed: work.specialistNeeded === true,
    workerId: text(work.specialistWorker, 80),
    objective: text(work.specialistObjective, 1000),
    expectedOutput: text(work.specialistExpectedOutput, 1000),
    mode: text(work.specialistMode, 40) || "protected",
    contextClasses: list(work.specialistContextClasses),
    reason: text(work.specialistReason || output?.recommendation, 1000),
  };
}

function openChiefAssignment(db, workflowId) {
  return get(
    db,
    `SELECT handoffs.*
     FROM agent_handoffs AS handoffs
     WHERE handoffs.workflow_id = ?
       AND handoffs.from_agent_id = 'chief_of_staff'
       AND handoffs.status IN (
         'specialist_assignment_prepared',
         'specialist_work_running',
         'specialist_quality_review_pending'
       )
     ORDER BY handoffs.created_at DESC LIMIT 1`,
    [workflowId],
  );
}

function requiredReviewer(workerId, mode) {
  return mode === "supervised_live" && QUALITY_REVIEWED_WORKERS.has(workerId)
    ? "quality_reviewer"
    : "chief_of_staff";
}

function chiefAssignmentHandoffForTask(db, taskId) {
  const rows = all(
    db,
    `SELECT *
     FROM agent_handoffs
     WHERE from_agent_id = 'chief_of_staff'
     ORDER BY created_at DESC`,
  );
  return rows.find((row) => fromJson(row.metadata, {}).childTaskId === taskId) || null;
}

function updateChiefAssignmentLifecycle(db, task, input = {}) {
  if (!task?.id) return null;
  const handoff = chiefAssignmentHandoffForTask(db, task.id);
  if (!handoff) return null;
  const status = String(input.status || "").trim();
  if (!status) throw new Error("Chief assignment lifecycle needs an exact status.");
  const ts = now();
  const previousMetadata = fromJson(handoff.metadata, {});
  const metadata = {
    ...previousMetadata,
    assignmentLifecycle: {
      status,
      note: text(input.note, 800),
      childTaskId: task.id,
      childTaskStatus: input.childTaskStatus || task.status || null,
      updatedAt: ts,
    },
  };
  const resolved = input.resolved === true;
  run(
    db,
    `UPDATE agent_handoffs
     SET status = ?, metadata = ?, updated_at = ?, resolved_at = ?
     WHERE id = ?`,
    [status, toJson(metadata), ts, resolved ? ts : null, handoff.id],
  );
  insertEvent(db, {
    level: status === "specialist_work_failed" ? "error" : status === "specialist_changes_required" ? "warn" : "info",
    actor: "chief_of_staff",
    type: "chief.specialist_assignment_updated",
    entityType: "agent_handoff",
    entityId: handoff.id,
    message: input.note || `Chief of Staff specialist assignment is now ${status.replaceAll("_", " ")}.`,
    metadata: { childTaskId: task.id, status, resolved },
  });
  return {
    ...get(db, "SELECT * FROM agent_handoffs WHERE id = ?", [handoff.id]),
    metadata,
  };
}

function updateReviewedChiefAssignment(db, reviewTask, qualityGate) {
  const payload = typeof reviewTask?.payload === "string"
    ? fromJson(reviewTask.payload, {})
    : reviewTask?.payload || {};
  const sourceTaskId = payload?.liveSpendRequest?.parameters?.reviewOfTaskId;
  if (!sourceTaskId || !["passed", "changes_required"].includes(qualityGate?.status)) return null;
  const sourceTask = get(db, "SELECT * FROM tasks WHERE id = ?", [sourceTaskId]);
  if (!sourceTask) return null;
  return updateChiefAssignmentLifecycle(db, sourceTask, {
    status: qualityGate.status === "passed" ? "specialist_work_completed" : "specialist_changes_required",
    note: qualityGate.status === "passed"
      ? "The specialist output passed its independent quality check."
      : "The specialist output needs changes before it can be used.",
    childTaskStatus: sourceTask.status,
    resolved: true,
  });
}

function protectedTask(db, sourceTask, sourceRun, definition, request, assignment) {
  const taskId = `task_chief_assignment_${safeId(sourceRun.id)}`;
  const existing = get(db, "SELECT * FROM tasks WHERE id = ?", [taskId]);
  if (existing) return existing;
  const ts = now();
  run(
    db,
    `INSERT INTO tasks
     (id, workflow_id, venture_id, title, kind, agent, status, priority, max_retries,
      cost_budget_cents, payload, result, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'workbench_proof', ?, 'queued',
      (SELECT COALESCE(MAX(priority), 0) + 1 FROM tasks WHERE workflow_id = ?),
      1, 0, ?, ?, ?, ?)`,
    [
      taskId,
      sourceTask.workflow_id,
      sourceTask.venture_id,
      `${definition.name}: ${request.objective}`,
      definition.id,
      sourceTask.workflow_id,
      toJson({
        subject: sourceTask.payload?.subject || sourceTask.title,
        workerName: definition.name,
        proofGoal: request.objective,
        expectedOutput: request.expectedOutput,
        requiredOutputs: definition.outputContract?.required || [],
        chiefAssignment: assignment,
        noLiveModels: true,
        noExternalActions: true,
      }),
      toJson({ waitingFor: definition.id, chiefAssignmentId: assignment.id }),
      ts,
      ts,
    ],
  );
  return get(db, "SELECT * FROM tasks WHERE id = ?", [taskId]);
}

function liveTask(db, sourceTask, sourceRun, definition, request, assignment, policy) {
  return requestLiveAiWorker(db, sourceTask.workflow_id, {
    requestKey: `chief_assignment_${sourceRun.id}`,
    requestedBy: "chief_of_staff",
    worker: definition.id,
    taskTitle: `${definition.name}: ${request.objective}`,
    approvalTitle: `Approve ${definition.name} for this next step`,
    estimatedCostCents: policy.maxSpecialistCostCents,
    reason: request.reason || `Chief of Staff recommends one bounded ${definition.name} assignment.`,
    expectedOutput: request.expectedOutput,
    expectedMetric: "The specialist returns the requested bounded output with a complete receipt, quality check, and no external action.",
    contextPurpose: request.objective,
    contextClasses: request.contextClasses,
    parameters: {
      chiefAssignment: assignment,
      requiredReviewer: assignment.requiredReviewer,
    },
    effects: [],
  });
}

function prepareChiefSpecialistAssignment(db, input = {}) {
  const sourceTask = input.task;
  const sourceRun = input.run;
  if (!sourceTask || !sourceRun) throw new Error("Chief assignment needs the exact source task and run.");
  if (sourceTask.agent !== "chief_of_staff" || sourceRun.agent_id !== "chief_of_staff") {
    throw new Error("Only the registered Chief of Staff may prepare a specialist assignment.");
  }
  if (sourceTask.payload?.chiefOrchestration?.enabled !== true) {
    return { status: "not_enabled", assignment: null };
  }
  const request = normalizedChiefRequest(input.output);
  if (!request.needed) return { status: "no_specialist_needed", assignment: null };

  const policy = normalizedPolicy(sourceTask);
  const definition = specialistDefinition(request.workerId);
  if (!definition || !policy.allowedWorkers.includes(definition.id)) {
    throw new Error("Chief selected a worker outside the fixed approved team.");
  }
  if (!policy.allowedModes.includes(request.mode)) {
    throw new Error("Chief selected a specialist mode outside the approved manager policy.");
  }
  if (!request.objective || !request.expectedOutput) {
    throw new Error("Chief must state the specialist objective and expected output.");
  }
  const profile = contextProfile(definition.id, request.contextClasses);
  const existingHandoff = get(
    db,
    "SELECT * FROM agent_handoffs WHERE from_run_id = ? AND to_agent_id = ? LIMIT 1",
    [sourceRun.id, definition.id],
  );
  if (existingHandoff) {
    const metadata = fromJson(existingHandoff.metadata, {});
    const existingTask = metadata.childTaskId
      ? get(db, "SELECT * FROM tasks WHERE id = ?", [metadata.childTaskId])
      : null;
    const existingApproval = metadata.approvalId
      ? get(db, "SELECT * FROM approvals WHERE id = ?", [metadata.approvalId])
      : null;
    return {
      status: existingApproval ? "waiting_for_approval" : "queued",
      assignment: metadata.chiefAssignment || null,
      handoff: existingHandoff,
      task: existingTask,
      approval: existingApproval,
      alreadyPrepared: true,
    };
  }
  if (policy.oneOpenAssignmentPerWorkflow && openChiefAssignment(db, sourceTask.workflow_id)) {
    throw new Error("Chief already has one open specialist assignment for this workflow.");
  }

  const assignment = {
    schema: CHIEF_ASSIGNMENT_SCHEMA,
    id: `chief_assignment_${safeId(sourceRun.id)}`,
    ventureId: sourceTask.venture_id,
    workflowId: sourceTask.workflow_id,
    sourceTaskId: sourceTask.id,
    sourceRunId: sourceRun.id,
    workerId: definition.id,
    workerName: definition.name,
    mode: request.mode,
    objective: request.objective,
    expectedOutput: request.expectedOutput,
    contextClasses: profile.selected,
    requiredReviewer: requiredReviewer(definition.id, request.mode),
    maxCostCents: request.mode === "supervised_live" ? policy.maxSpecialistCostCents : 0,
    externalEffects: [],
    preparedAt: now(),
  };

  const prepared = request.mode === "supervised_live"
    ? liveTask(db, sourceTask, sourceRun, definition, request, assignment, policy)
    : { task: protectedTask(db, sourceTask, sourceRun, definition, request, assignment), approval: null, status: "queued" };
  const childTask = prepared.task;
  const handoff = recordAgentHandoff(db, sourceRun, {
    handoffTo: definition.id,
    handoffStatus: "specialist_assignment_prepared",
    approvalRequired: false,
    outputSummary: request.reason || `${definition.name} is the next bounded specialist.`,
    handoffReason: request.objective,
    handoffDecisionNeeded: request.mode === "supervised_live"
      ? `Review the separate ${definition.name} model-cost approval.`
      : `${definition.name} will complete one protected internal assignment.`,
    handoffRiskLevel: request.mode === "supervised_live" ? "medium" : "low",
    metadata: {
      chiefAssignment: assignment,
      childTaskId: childTask?.id || null,
      approvalId: prepared.approval?.id || null,
      requiredReviewer: assignment.requiredReviewer,
    },
  });
  run(
    db,
    `UPDATE workflows
     SET status = ?, current_step = ?, updated_at = ?
     WHERE id = ?`,
    [
      request.mode === "supervised_live" ? "blocked_for_approval" : "agent_running",
      request.mode === "supervised_live"
        ? `${definition.name} approval ready`
        : `${definition.name} internal work queued`,
      now(),
      sourceTask.workflow_id,
    ],
  );
  insertEvent(db, {
    actor: "chief_of_staff",
    type: "chief.specialist_assignment_prepared",
    entityType: "task",
    entityId: childTask?.id || assignment.id,
    message: request.mode === "supervised_live"
      ? `Chief of Staff prepared one bounded ${definition.name} assignment; Daniel's separate model-cost approval is required.`
      : `Chief of Staff queued one bounded internal ${definition.name} assignment.`,
    metadata: {
      assignment,
      handoffId: handoff?.id || null,
      childTaskId: childTask?.id || null,
      approvalId: prepared.approval?.id || null,
    },
  });
  return {
    status: request.mode === "supervised_live" ? "waiting_for_approval" : "queued",
    assignment,
    handoff,
    task: childTask,
    approval: prepared.approval || null,
  };
}

function requestChiefOrchestration(db, workflowId, options = {}) {
  return requestLiveAiWorker(db, workflowId, {
    requestKey: options.requestKey || "chief_next_assignment",
    requestedBy: options.requestedBy || "operator",
    worker: "chief_of_staff",
    taskTitle: options.taskTitle || "Chief of Staff: choose the next bounded specialist",
    approvalTitle: options.approvalTitle || "Approve Chief of Staff to plan the next specialist step",
    estimatedCostCents: Number(options.estimatedCostCents || 100),
    reason: options.reason || "Ask Chief of Staff to review the current venture record and nominate at most one existing specialist for the next bounded task.",
    expectedOutput: "One concise next-money-move recommendation and, only if needed, one fixed-team specialist assignment with exact objective, output, context, and mode.",
    contextPurpose: "Choose the single next specialist assignment that most directly advances the venture.",
    contextClasses: options.contextClasses,
    chiefOrchestration: {
      enabled: true,
      policy: {
        allowedWorkers: options.allowedWorkers || DEFAULT_ALLOWED_WORKERS,
        allowedModes: options.allowedModes || ["protected", "supervised_live"],
        maxSpecialistCostCents: Number(options.maxSpecialistCostCents || 100),
      },
    },
    effects: [],
  });
}

module.exports = {
  CHIEF_ASSIGNMENT_SCHEMA,
  DEFAULT_ALLOWED_WORKERS,
  prepareChiefSpecialistAssignment,
  requestChiefOrchestration,
  updateChiefAssignmentLifecycle,
  updateReviewedChiefAssignment,
};
