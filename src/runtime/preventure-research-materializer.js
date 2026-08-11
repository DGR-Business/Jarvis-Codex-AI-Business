"use strict";

const { sha256 } = require("./commercial-test-contract");
const {
  effectivePreventureLifecycleState,
} = require("./preventure-research-contract");

const PREVENTURE_RESEARCH_ASSIGNMENT_PLAN_SCHEMA =
  "pantheon.preventure-research-assignment-plan.v1";

function materializationError(code, message, statusCode = 409) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (isObject(value)) {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, canonical(value[key])]),
    );
  }
  return value ?? null;
}

function canonicalJson(value) {
  return JSON.stringify(canonical(value));
}

let transactionSequence = 0;

function withAtomicDb(db, operation) {
  if (!db || typeof db.prepare !== "function" || typeof db.exec !== "function") {
    throw materializationError(
      "preventure_research_database_required",
      "A synchronous Pantheon database is required to create exact work rows.",
      500,
    );
  }
  if (db.isTransaction) {
    const savepoint = `preventure_research_materializer_${++transactionSequence}`;
    db.exec(`SAVEPOINT ${savepoint}`);
    try {
      const result = operation();
      db.exec(`RELEASE SAVEPOINT ${savepoint}`);
      return result;
    } catch (error) {
      db.exec(`ROLLBACK TO SAVEPOINT ${savepoint}`);
      db.exec(`RELEASE SAVEPOINT ${savepoint}`);
      throw error;
    }
  }
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = operation();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function timestamp(value, label) {
  const result = value instanceof Date ? value.toISOString() : String(value || "").trim();
  if (!result || !Number.isFinite(Date.parse(result))) {
    throw materializationError("preventure_research_time_invalid", `${label} is not a valid timestamp.`, 400);
  }
  return result;
}

function now(clock) {
  return timestamp(typeof clock === "function" ? clock() : new Date(), "Runtime clock");
}

function digestPart(hash) {
  if (!/^sha256:[a-f0-9]{64}$/.test(String(hash || ""))) {
    throw materializationError(
      "preventure_research_authority_hash_invalid",
      "The exact authority hash is invalid.",
      400,
    );
  }
  return hash.slice("sha256:".length, "sha256:".length + 24);
}

function expectedWorkIds(authorityHash, assignmentId) {
  const digest = digestPart(authorityHash);
  return {
    workflowId: `preventure_research_workflow_${digest}`,
    taskId: `preventure_research_task_${assignmentId}_${digest}`,
  };
}

function assignmentPlanEntry(authority, activationEvent, template) {
  const ids = expectedWorkIds(authority.authorityHash, template.id);
  return {
    id: template.id,
    version: template.version,
    title: template.title,
    templateHash: sha256(template),
    questionHash: sha256(template.question),
    authorityHash: authority.authorityHash,
    activationEventHash: activationEvent.eventHash,
    workflowId: ids.workflowId,
    taskId: ids.taskId,
    provider: template.provider,
    model: template.model,
    method: "openai_responses_web_search",
    tool: "web_search",
    maxCostAudCents: template.maxCostAudCents,
    maxAttempts: template.maxAttempts,
    maxToolCalls: template.maxToolCalls,
    maximumModelPasses: template.maximumModelPasses,
    maxInputTokens: template.maxInputTokens,
    localPromptPreflightMaxInputTokens: template.localPromptPreflightMaxInputTokens,
    maxOutputTokens: template.maxOutputTokens,
    maxTurns: template.maxTurns,
    deadlineMs: template.deadlineMs,
    worstCaseExposure: template.worstCaseExposure,
    requiredSourceClasses: template.requiredSourceClasses,
    requiredOutputSections: template.requiredOutputSections,
    expiresAt: authority.expiresAt,
    externalEffects: [],
    externalCommercialSpendCapAudCents: 0,
  };
}

function createPreventureResearchAssignmentPlan(authority, lifecycle) {
  if (!isObject(authority) || !Array.isArray(authority.assignments)) {
    throw materializationError(
      "preventure_research_authority_missing",
      "The exact pre-venture research authority is unavailable.",
    );
  }
  if (!Array.isArray(lifecycle) || lifecycle.length === 0) {
    throw materializationError(
      "preventure_research_activation_missing",
      "The authority has no activation event.",
    );
  }
  const activationEvents = lifecycle.filter((event) => event?.eventType === "activated");
  if (activationEvents.length !== 1 || lifecycle.at(-1).eventType !== "activated") {
    throw materializationError(
      "preventure_research_activation_invalid",
      "Assignments can be materialized only from one current exact activation.",
    );
  }
  const activationEvent = activationEvents[0];
  if (
    activationEvent.authorityHash !== authority.authorityHash
    || !/^sha256:[a-f0-9]{64}$/.test(String(activationEvent.eventHash || ""))
  ) {
    throw materializationError(
      "preventure_research_activation_changed",
      "The activation event does not bind the exact authority.",
    );
  }
  const assignments = authority.assignments.map(
    (template) => assignmentPlanEntry(authority, activationEvent, template),
  );
  const assignmentIds = assignments.map((assignment) => assignment.id);
  if (new Set(assignmentIds).size !== assignmentIds.length) {
    throw materializationError(
      "preventure_research_assignment_duplicate",
      "The accepted assignment set contains duplicate IDs.",
    );
  }
  const totalAssignedCostAudCents = assignments.reduce(
    (sum, assignment) => sum + Number(assignment.maxCostAudCents),
    0,
  );
  if (
    !Number.isSafeInteger(totalAssignedCostAudCents)
    || totalAssignedCostAudCents > Number(authority.internalAiSpendCapAudCents)
  ) {
    throw materializationError(
      "preventure_research_assignment_cap_invalid",
      "The accepted assignments exceed the authority's A$2 ceiling.",
    );
  }
  const body = {
    schema: PREVENTURE_RESEARCH_ASSIGNMENT_PLAN_SCHEMA,
    authorityHash: authority.authorityHash,
    activationEventHash: activationEvent.eventHash,
    expiresAt: authority.expiresAt,
    preparationOnly: true,
    assignmentCount: assignments.length,
    totalAssignedCostAudCents,
    unusedAuthorityCapacityAudCents:
      authority.internalAiSpendCapAudCents - totalAssignedCostAudCents,
    assignments,
    buildAuthorized: false,
    commercialTestAuthorized: false,
    externalActionAuthorized: false,
  };
  return deepFreeze({ ...body, planHash: sha256(body) });
}

function workEnvelope(plan, assignment) {
  return {
    schema: "pantheon.preventure-research-task-envelope.v1",
    authorityHash: plan.authorityHash,
    activationEventHash: plan.activationEventHash,
    assignmentId: assignment.id,
    assignmentVersion: assignment.version,
    templateHash: assignment.templateHash,
    provider: assignment.provider,
    model: assignment.model,
    method: assignment.method,
    tool: assignment.tool,
    limits: {
      maxCostAudCents: assignment.maxCostAudCents,
      maxAttempts: assignment.maxAttempts,
      maxToolCalls: assignment.maxToolCalls,
      maximumModelPasses: assignment.maximumModelPasses,
      maxInputTokens: assignment.maxInputTokens,
      localPromptPreflightMaxInputTokens: assignment.localPromptPreflightMaxInputTokens,
      maxOutputTokens: assignment.maxOutputTokens,
      maxTurns: assignment.maxTurns,
      deadlineMs: assignment.deadlineMs,
      worstCaseExposure: assignment.worstCaseExposure,
    },
    expiresAt: assignment.expiresAt,
    preparationOnly: true,
    externalEffects: [],
    externalCommercialSpendCapAudCents: 0,
    buildAuthorized: false,
    commercialTestAuthorized: false,
    externalActionAuthorized: false,
  };
}

function parseJson(value, fallback = {}) {
  if (isObject(value)) return value;
  try {
    const parsed = JSON.parse(String(value || ""));
    return isObject(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function assertExistingWork(db, plan, workflow, tasks) {
  const metadata = parseJson(workflow.metadata);
  const workflowMismatches = [
    ["type", workflow.type, "preventure_research"],
    ["venture", workflow.venture_id ?? null, null],
    ["status", workflow.status, "blocked"],
    ["schema", metadata.schema, "pantheon.preventure-research-workflow.v1"],
    ["authority", metadata.authorityHash, plan.authorityHash],
    ["activation", metadata.activationEventHash, plan.activationEventHash],
    ["plan", metadata.assignmentPlanHash, plan.planHash],
    ["external authority", metadata.externalActionAuthorized, false],
  ].filter(([, actual, expected]) => actual !== expected);
  if (workflowMismatches.length > 0) {
    throw materializationError(
      "preventure_research_workflow_conflict",
      `The deterministic workflow ID is outside the accepted research plan (${workflowMismatches.map(([name]) => name).join(", ")}).`,
    );
  }
  for (const assignment of plan.assignments) {
    const task = tasks.find((candidate) => candidate.id === assignment.taskId);
    const payload = parseJson(task?.payload);
    const expectedEnvelope = workEnvelope(plan, assignment);
    const { preventureResearchAssignment: _binding, ...storedEnvelope } = payload;
    if (
      !task
      || task.workflow_id !== assignment.workflowId
      || task.kind !== "preventure_research"
      || task.agent !== "demand_validator"
      || task.status !== "blocked"
      || Number(task.max_retries) !== 0
      || Number(task.cost_budget_cents) !== assignment.maxCostAudCents
      || !isObject(storedEnvelope)
      || sha256(storedEnvelope) !== sha256(expectedEnvelope)
    ) {
      throw materializationError(
        "preventure_research_task_conflict",
        `Task ${assignment.taskId} is missing or outside the accepted research plan.`,
      );
    }
  }
}

function materializePreventureResearchWorkRows(db, plan, options = {}) {
  const createdAt = timestamp(options.createdAt, "Work materialization time");
  const operation = () => {
    const workflowId = plan.assignments[0]?.workflowId;
    if (!workflowId || plan.assignments.some((assignment) => assignment.workflowId !== workflowId)) {
      throw materializationError(
        "preventure_research_workflow_plan_invalid",
        "The exact assignments do not share one deterministic workflow.",
      );
    }
    let workflow = db.prepare("SELECT * FROM workflows WHERE id = ?").get(workflowId);
    if (!workflow) {
      const metadata = {
        schema: "pantheon.preventure-research-workflow.v1",
        authorityHash: plan.authorityHash,
        activationEventHash: plan.activationEventHash,
        assignmentPlanHash: plan.planHash,
        preparationOnly: true,
        externalEffects: [],
        externalCommercialSpendCapAudCents: 0,
        buildAuthorized: false,
        commercialTestAuthorized: false,
        externalActionAuthorized: false,
      };
      db.prepare(
        `INSERT INTO workflows
          (id, venture_id, type, title, status, current_step, priority,
           quality_score, expected_profit_cents, cost_estimate_cents,
           approval_required, metadata, created_at, updated_at)
         VALUES (?, NULL, ?, ?, ?, ?, ?, 0, 0, ?, 0, ?, ?, ?)`,
      ).run(
        workflowId,
        "preventure_research",
        "Bounded pre-venture diligence",
        "blocked",
        "Waiting for the dedicated exact research runner bridge",
        1,
        plan.totalAssignedCostAudCents,
        canonicalJson(metadata),
        createdAt,
        createdAt,
      );
      workflow = db.prepare("SELECT * FROM workflows WHERE id = ?").get(workflowId);
    }
    for (const assignment of plan.assignments) {
      const existing = db.prepare("SELECT id FROM tasks WHERE id = ?").get(assignment.taskId);
      if (existing) continue;
      db.prepare(
        `INSERT INTO tasks
          (id, workflow_id, title, kind, agent, status, priority, retries,
           max_retries, approval_id, cost_budget_cents, cost_actual_cents,
           payload, result, due_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, NULL, ?, 0, ?, ?, ?, ?, ?)`,
      ).run(
        assignment.taskId,
        assignment.workflowId,
        assignment.title,
        "preventure_research",
        "demand_validator",
        "blocked",
        1,
        assignment.maxCostAudCents,
        canonicalJson(workEnvelope(plan, assignment)),
        canonicalJson({}),
        assignment.expiresAt,
        createdAt,
        createdAt,
      );
    }
    const tasks = db.prepare(
      `SELECT * FROM tasks WHERE workflow_id = ? ORDER BY created_at, id`,
    ).all(workflowId);
    if (tasks.length !== plan.assignments.length) {
      throw materializationError(
        "preventure_research_work_scope_changed",
        "The deterministic research workflow contains unexpected or missing tasks.",
      );
    }
    assertExistingWork(db, plan, workflow, tasks);
    return { workflow, tasks };
  };
  return options.insideTransaction === true ? operation() : withAtomicDb(db, operation);
}

function sameStoredAssignment(stored, planned) {
  return Boolean(stored)
    && stored.id === planned.id
    && stored.version === planned.version
    && stored.authorityHash === planned.authorityHash
    && stored.activationEventHash === planned.activationEventHash
    && stored.templateHash === planned.templateHash
    && stored.workflowId === planned.workflowId
    && stored.taskId === planned.taskId
    && stored.provider === planned.provider
    && stored.model === planned.model
    && stored.maxCostAudCents === planned.maxCostAudCents
    && stored.maxAttempts === planned.maxAttempts
    && stored.maxToolCalls === planned.maxToolCalls
    && stored.maximumModelPasses === planned.maximumModelPasses
    && stored.maxInputTokens === planned.maxInputTokens
    && stored.localPromptPreflightMaxInputTokens === planned.localPromptPreflightMaxInputTokens
    && stored.maxOutputTokens === planned.maxOutputTokens
    && stored.maxTurns === planned.maxTurns
    && stored.deadlineMs === planned.deadlineMs
    && canonicalJson(stored.worstCaseExposure) === canonicalJson(planned.worstCaseExposure)
    && stored.expiresAt === planned.expiresAt
    && /^sha256:[a-f0-9]{64}$/.test(String(stored.assignmentHash || ""));
}

function assertMaterializerStore(store) {
  const required = [
    "createAssignment",
    "getAuthority",
    "listAssignments",
    "loadLifecycle",
    "readState",
    "verifyLedger",
  ];
  if (!isObject(store) || required.some((name) => typeof store[name] !== "function")) {
    throw materializationError(
      "preventure_research_store_invalid",
      "The immutable pre-venture research store is unavailable or incomplete.",
      500,
    );
  }
}

function assertCompleteMaterialization(store, authority, plan) {
  const stored = store.listAssignments(authority.authorityHash);
  if (stored.length !== plan.assignments.length) {
    throw materializationError(
      "preventure_research_materialization_incomplete",
      "The exact assignment set was not materialized completely; dispatch remains blocked.",
    );
  }
  const plannedIds = new Set(plan.assignments.map((assignment) => assignment.id));
  for (const assignment of stored) {
    const planned = plan.assignments.find((candidate) => candidate.id === assignment.id);
    if (!plannedIds.has(assignment.id) || !sameStoredAssignment(assignment, planned)) {
      throw materializationError(
        "preventure_research_materialization_changed",
        "A stored assignment is outside the accepted assignment plan.",
      );
    }
  }
  const storedCap = stored.reduce((sum, assignment) => sum + assignment.maxCostAudCents, 0);
  if (storedCap !== plan.totalAssignedCostAudCents) {
    throw materializationError(
      "preventure_research_materialization_cap_changed",
      "The stored assignment caps no longer match the accepted plan.",
    );
  }
  return stored;
}

function materializePreventureResearchAssignments(store, authorityHash, options = {}) {
  if (options.db && options.insideTransaction !== true) {
    return withAtomicDb(options.db, () => materializePreventureResearchAssignments(
      store,
      authorityHash,
      { ...options, insideTransaction: true },
    ));
  }
  assertMaterializerStore(store);
  const integrity = store.verifyLedger();
  if (!isObject(integrity) || integrity.ok !== true) {
    throw materializationError(
      "preventure_research_ledger_invalid",
      "The pre-venture research ledger could not be verified.",
      500,
    );
  }
  if (!options.expectedAuthorityHash || options.expectedAuthorityHash !== authorityHash) {
    throw materializationError(
      "preventure_research_materialization_scope_stale",
      "Refresh the research authority before creating its exact assignments.",
    );
  }
  const authority = store.getAuthority(authorityHash);
  if (!authority) {
    throw materializationError(
      "preventure_research_authority_missing",
      "The exact pre-venture research authority is unavailable.",
    );
  }
  const state = store.readState(authorityHash);
  const assignedAt = timestamp(options.assignedAt || now(options.clock), "Assignment materialization time");
  const lifecycle = store.loadLifecycle(authorityHash);
  const effectiveState = effectivePreventureLifecycleState(authority, lifecycle, assignedAt);
  if (
    effectiveState !== "activated"
    || state.state !== "activated"
    || state.terminal
    || state.expired
    || state.dispatchAllowed !== true
    || Date.parse(assignedAt) >= Date.parse(authority.expiresAt)
  ) {
    throw materializationError(
      "preventure_research_materialization_not_authorized",
      "The exact authority is not active and unexpired, so no assignments were created.",
    );
  }
  if (state.unknownProviderOutcomeCount !== 0 || state.unknownCostCount !== 0) {
    throw materializationError(
      "preventure_research_materialization_frozen",
      "Unknown provider or cost state freezes further assignment creation.",
    );
  }
  const plan = createPreventureResearchAssignmentPlan(
    authority,
    lifecycle,
  );
  let work = null;
  if (options.db) {
    work = materializePreventureResearchWorkRows(options.db, plan, {
      createdAt: assignedAt,
      insideTransaction: true,
    });
  }

  const existing = store.listAssignments(authorityHash);
  for (const assignment of existing) {
    const planned = plan.assignments.find((candidate) => candidate.id === assignment.id);
    if (!planned || !sameStoredAssignment(assignment, planned)) {
      throw materializationError(
        "preventure_research_materialization_changed",
        "Existing assignment state does not match the accepted immutable plan.",
      );
    }
  }

  const results = [];
  for (const assignment of plan.assignments) {
    const current = store.listAssignments(authorityHash).find(
      (candidate) => candidate.id === assignment.id,
    );
    if (current) {
      results.push({ created: false, assignment: current });
      continue;
    }
    results.push(store.createAssignment(authorityHash, assignment.id, {
      workflowId: assignment.workflowId,
      taskId: assignment.taskId,
      activationEventHash: assignment.activationEventHash,
      assignedAt,
    }));
  }
  const assignments = assertCompleteMaterialization(store, authority, plan);
  const verified = store.verifyLedger();
  if (!isObject(verified) || verified.ok !== true) {
    throw materializationError(
      "preventure_research_ledger_invalid",
      "The assignment ledger failed verification after materialization.",
      500,
    );
  }
  return {
    created: results.some((result) => result.created),
    plan,
    assignments,
    work,
  };
}

module.exports = {
  PREVENTURE_RESEARCH_ASSIGNMENT_PLAN_SCHEMA,
  createPreventureResearchAssignmentPlan,
  expectedWorkIds,
  materializePreventureResearchAssignments,
  materializePreventureResearchWorkRows,
};
