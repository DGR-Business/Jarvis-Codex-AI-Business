const { all, fromJson, get, insertEvent, now, randomId, run, toJson } = require("../db");
const { ensureAiTeam, recordProtectedWorkerOutcome } = require("./ai-team");
const { ensureCapabilityAutonomy } = require("./capability-autonomy");
const { getAgentToolPolicyState } = require("./agent-tools");
const { requestLiveAiWorker } = require("./live-ai-workers");
const { getLiveAiWorkerReadiness } = require("./live-ai-worker-readiness");

const WORKBENCH_SCHEMA = "jarvis_agent_workbench_v1";
const EVAL_DATASET_SCHEMA = "jarvis_agent_eval_dataset_v1";
const EVAL_CASE_SCHEMA = "jarvis_agent_eval_case_v1";
const PROMOTION_GATE_SCHEMA = "jarvis_agent_promotion_gate_v1";
const TEAM_DRILL_SUMMARY_SCHEMA = "jarvis_agent_team_drill_summary_v1";
const LIVE_RUN_MODES = new Set(["live-ai-worker", "openai-agents-sdk", "live-agent"]);
const DIGITAL_PRODUCT_PROOF_TEAM = [
  "chief_of_staff",
  "opportunity_scout",
  "demand_validator",
  "offer_architect",
  "product_builder",
  "copy_conversion_agent",
  "distribution_operator",
  "finance_analyst",
  "customer_voice_agent",
  "growth_analyst",
  "quality_reviewer",
];

function slugForId(value) {
  return String(value || "worker")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48) || "worker";
}

function parseDefinition(row) {
  return {
    ...row,
    tools: fromJson(row.tools, []),
    guardrails: fromJson(row.guardrails, []),
    handoff_targets: fromJson(row.handoff_targets, []),
    input_contract: fromJson(row.input_contract, {}),
    output_contract: fromJson(row.output_contract, {}),
    approval_policy: fromJson(row.approval_policy, {}),
    eval_criteria: fromJson(row.eval_criteria, []),
    metadata: fromJson(row.metadata, {}),
  };
}

function parseRow(row, fields = ["metadata"]) {
  const copy = { ...row };
  for (const field of fields) copy[field] = fromJson(copy[field], field === "criteria" || field === "findings" ? [] : {});
  return copy;
}

function moneyLabel(cents) {
  const amount = Math.max(0, Math.round(Number(cents) || 0));
  if (!amount) return "$0.00";
  return `$${(amount / 100).toFixed(2)}`;
}

function datasetId(agentId) {
  return `agent_eval_dataset_${agentId}_readiness`;
}

function caseId(agentId) {
  return `agent_eval_case_${agentId}_contract`;
}

function listValue(value) {
  return Array.isArray(value) ? value : [];
}

function hasText(value) {
  return Boolean(String(value || "").trim());
}

function ensureAgentWorkbench(db) {
  ensureAiTeam(db);
  const ts = now();
  const definitions = all(db, "SELECT * FROM agent_definitions ORDER BY name ASC").map(parseDefinition);

  for (const definition of definitions) {
    const requiredOutputs = listValue(definition.output_contract?.required);
    const criteria = [
      "business decision contract is complete",
      "external actions remain locked",
      "approval requirement is explicit",
      "trace contains guardrail and eval evidence",
      ...listValue(definition.eval_criteria),
      ...requiredOutputs.map((field) => `output includes ${field}`),
    ];
    const expectedOutput = [
      `Worker: ${definition.name}`,
      `Required output: ${requiredOutputs.length ? requiredOutputs.join(", ") : "money move, evidence, risk, and next decision"}`,
      "Must return the shared business-decision contract, the worker output contract, no unapproved external action, and a clear operator decision.",
    ].join("\n");

    run(
      db,
      `INSERT INTO agent_eval_datasets
        (id, agent_id, name, purpose, status, minimum_cases, pass_score, metadata, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         purpose = excluded.purpose,
         status = excluded.status,
         minimum_cases = excluded.minimum_cases,
         pass_score = excluded.pass_score,
         metadata = excluded.metadata,
         updated_at = excluded.updated_at`,
      [
        datasetId(definition.id),
        definition.id,
        `${definition.name} readiness checks`,
        "Repeatable checks for worker contract quality, safety, traces, and live-test readiness.",
        "active",
        1,
        80,
        toJson({
          schema: EVAL_DATASET_SCHEMA,
          source: "AI Team worker contract",
          officialGuidance: "Use traces while debugging, then move to datasets and eval runs when good behavior is known.",
          workerModelClass: definition.model_class,
        }),
        ts,
        ts,
      ],
    );

    run(
      db,
      `INSERT INTO agent_eval_cases
        (id, dataset_id, agent_id, title, input_summary, expected_output, criteria, status, metadata, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         title = excluded.title,
         input_summary = excluded.input_summary,
         expected_output = excluded.expected_output,
         criteria = excluded.criteria,
         status = excluded.status,
         metadata = excluded.metadata,
         updated_at = excluded.updated_at`,
      [
        caseId(definition.id),
        datasetId(definition.id),
        definition.id,
        `${definition.name} contract and safety case`,
        `Run ${definition.name} on a representative commercial workflow and check the required output contract.`,
        expectedOutput,
        toJson(criteria),
        "active",
        toJson({
          schema: EVAL_CASE_SCHEMA,
          inputContract: definition.input_contract,
          outputContract: definition.output_contract,
          approvalPolicy: definition.approval_policy,
        }),
        ts,
        ts,
      ],
    );
  }
}

function queueAgentWorkbenchProof(db, agentId, options = {}) {
  ensureAgentWorkbench(db);
  const definitionRow = get(db, "SELECT * FROM agent_definitions WHERE id = ?", [agentId]);
  if (!definitionRow) throw new Error(`AI worker not found: ${agentId}`);
  const definition = parseDefinition(definitionRow);

  const ts = now();
  const suffix = `${slugForId(definition.id)}_${randomId().slice(0, 8)}`;
  const workflowId = `wf_agent_proof_${suffix}`;
  const commandId = `cmd_agent_proof_${suffix}`;
  const taskId = `task_agent_proof_${suffix}`;
  const subject = options.subject || "Digital product pilot proof";
  const buyer = options.buyer || "Digital product buyers";
  const problem = options.problem || "They need a clearer, faster way to decide whether this offer deserves more work.";
  const offer = options.offer || "A small protected commercial proof before live spend or external action.";
  const channel = options.channel || "Digital Product";
  const proofGoal = options.proofGoal || `Prove ${definition.name} can produce a useful business decision contract without live spend.`;
  const instruction = `Run a protected Workbench proof for ${definition.name}: ${proofGoal}`;
  const metadata = {
    source: "agent_workbench",
    workerId: definition.id,
    workerName: definition.name,
    workerRole: definition.role,
    subject,
    buyer,
    problem,
    offer,
    channel,
    proofGoal,
    originalInstruction: instruction,
    agentRunner: { mode: "protected", liveModels: false, liveTools: false },
  };

  run(
    db,
    `INSERT INTO workflows (id, venture_id, type, title, status, current_step, priority,
      quality_score, expected_profit_cents, cost_estimate_cents, approval_required, metadata, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      workflowId,
      null,
      "agent_workbench_proof",
      `AI Team - ${definition.name} Protected Proof`,
      "planned",
      "protected worker proof queued",
      1,
      0,
      0,
      0,
      0,
      toJson(metadata),
      ts,
      ts,
    ],
  );

  run(
    db,
    `INSERT INTO commands (id, source, raw_text, intent, status, workflow_id, summary, metadata, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      commandId,
      options.source || "agent-workbench",
      instruction,
      "prove_ai_worker",
      "planned",
      workflowId,
      `${definition.name} protected proof queued. No live model call, spend, publishing, or customer contact is allowed.`,
      toJson(metadata),
      ts,
      ts,
    ],
  );

  run(
    db,
    `INSERT INTO tasks
      (id, workflow_id, title, kind, agent, status, priority, max_retries, cost_budget_cents, payload, result, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      taskId,
      workflowId,
      `${definition.name} protected proof`,
      "workbench_proof",
      definition.id,
      "queued",
      1,
      1,
      10,
      toJson({
        ...metadata,
        requestedWorker: definition.id,
        requiredOutputs: listValue(definition.output_contract?.required),
        evalCriteria: listValue(definition.eval_criteria),
      }),
      toJson({ waitingFor: "protected_worker_proof", workerId: definition.id }),
      ts,
      ts,
    ],
  );

  insertEvent(db, {
    actor: "agent_workbench",
    type: "agent.workbench_proof_queued",
    entityType: "task",
    entityId: taskId,
    message: `${definition.name} protected proof was queued without live spend or external action.`,
    metadata: { workflowId, taskId, workerId: definition.id },
  });

  return {
    worker: { id: definition.id, name: definition.name, role: definition.role },
    workflow: { id: workflowId, title: `AI Team - ${definition.name} Protected Proof` },
    command: { id: commandId },
    task: { id: taskId, title: `${definition.name} protected proof`, kind: "workbench_proof", status: "queued" },
  };
}

function queueAgentWorkbenchProofSuite(db, options = {}) {
  ensureAgentWorkbench(db);
  const definitions = all(db, "SELECT * FROM agent_definitions").map(parseDefinition);
  const byId = new Map(definitions.map((definition) => [definition.id, definition]));
  const requestedAgentIds = Array.isArray(options.agentIds) && options.agentIds.length
    ? options.agentIds
    : DIGITAL_PRODUCT_PROOF_TEAM;
  const selected = [];
  const seen = new Set();

  for (const rawId of requestedAgentIds) {
    const id = String(rawId || "").trim();
    if (!id || seen.has(id)) continue;
    const definition = byId.get(id);
    if (!definition) throw new Error(`AI worker not found: ${id}`);
    selected.push(definition);
    seen.add(id);
  }

  if (!selected.length) throw new Error("AI team proof drill needs at least one worker.");

  const ts = now();
  const subject = options.subject || "Digital product pilot proof";
  const buyer = options.buyer || "Digital product buyers";
  const problem = options.problem || "They need a clearer, faster way to decide whether this offer deserves more work.";
  const offer = options.offer || "A small protected commercial proof before live spend or external action.";
  const channel = options.channel || "Digital Product";
  const teamName = options.teamName || "Digital product AI team";
  const proofGoal = options.proofGoal || "Prove the core workers can each produce useful business-decision evidence under protected controls.";
  const suffix = `${slugForId(teamName)}_${randomId().slice(0, 8)}`;
  const workflowId = `wf_agent_team_proof_${suffix}`;
  const commandId = `cmd_agent_team_proof_${suffix}`;
  const instruction = `Run a protected AI Team proof drill for ${teamName}: ${proofGoal}`;
  const baseMetadata = {
    source: "agent_workbench",
    proofSuite: true,
    teamName,
    subject,
    buyer,
    problem,
    offer,
    channel,
    proofGoal,
    originalInstruction: instruction,
    workerIds: selected.map((definition) => definition.id),
    workerNames: selected.map((definition) => definition.name),
    agentRunner: { mode: "protected", liveModels: false, liveTools: false },
  };

  run(
    db,
    `INSERT INTO workflows (id, venture_id, type, title, status, current_step, priority,
      quality_score, expected_profit_cents, cost_estimate_cents, approval_required, metadata, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      workflowId,
      null,
      "agent_workbench_team_proof",
      `AI Team - ${teamName} Protected Drill`,
      "planned",
      "protected team proof queued",
      1,
      0,
      0,
      0,
      0,
      toJson(baseMetadata),
      ts,
      ts,
    ],
  );

  run(
    db,
    `INSERT INTO commands (id, source, raw_text, intent, status, workflow_id, summary, metadata, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      commandId,
      options.source || "agent-workbench",
      instruction,
      "prove_ai_team",
      "planned",
      workflowId,
      `${teamName} protected drill queued for ${selected.length} worker${selected.length === 1 ? "" : "s"}. No live model call, spend, publishing, or customer contact is allowed.`,
      toJson(baseMetadata),
      ts,
      ts,
    ],
  );

  const tasks = selected.map((definition, index) => {
    const taskId = `task_agent_team_proof_${slugForId(definition.id)}_${randomId().slice(0, 8)}`;
    const taskPayload = {
      ...baseMetadata,
      workerId: definition.id,
      workerName: definition.name,
      workerRole: definition.role,
      requestedWorker: definition.id,
      teamSequence: index + 1,
      requiredOutputs: listValue(definition.output_contract?.required),
      evalCriteria: listValue(definition.eval_criteria),
      proofGoal: `${proofGoal} ${definition.name} must stay inside protected mode and produce its own decision contract.`,
    };
    run(
      db,
      `INSERT INTO tasks
        (id, workflow_id, title, kind, agent, status, priority, max_retries, cost_budget_cents, payload, result, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        taskId,
        workflowId,
        `${definition.name} team proof`,
        "workbench_proof",
        definition.id,
        "queued",
        index + 1,
        1,
        10,
        toJson(taskPayload),
        toJson({ waitingFor: "protected_team_proof", workerId: definition.id, teamName }),
        ts,
        ts,
      ],
    );
    return {
      id: taskId,
      title: `${definition.name} team proof`,
      kind: "workbench_proof",
      workerId: definition.id,
      workerName: definition.name,
      status: "queued",
    };
  });

  insertEvent(db, {
    actor: "agent_workbench",
    type: "agent.workbench_team_proof_queued",
    entityType: "workflow",
    entityId: workflowId,
    message: `${teamName} protected proof drill was queued for ${selected.length} workers without live spend or external action.`,
    metadata: { workflowId, workerIds: selected.map((definition) => definition.id), taskIds: tasks.map((task) => task.id) },
  });

  return {
    team: {
      name: teamName,
      workerCount: selected.length,
      workers: selected.map((definition) => ({ id: definition.id, name: definition.name, role: definition.role })),
    },
    workflow: { id: workflowId, title: `AI Team - ${teamName} Protected Drill` },
    command: { id: commandId },
    tasks,
  };
}

function workflowForTeamSummary(db, workflowId) {
  const row = get(db, "SELECT * FROM workflows WHERE id = ?", [workflowId]);
  return row ? parseRow(row) : null;
}

function proofTaskRows(db, workflowId) {
  return all(
    db,
    `SELECT * FROM tasks
     WHERE workflow_id = ? AND kind = 'workbench_proof'
     ORDER BY priority ASC, created_at ASC`,
    [workflowId],
  ).map((row) => parseRow(row, ["payload", "result"]));
}

function summarizeProofTask(task) {
  const result = task.result || {};
  const output = result.output || {};
  const decision = output.businessDecision || {};
  const aiTeam = result.aiTeam || {};
  const cost = result.cost || {};
  return {
    taskId: task.id,
    workerId: aiTeam.agentId || task.agent,
    workerName: aiTeam.agentName || task.payload?.workerName || task.agent,
    status: task.status,
    evalStatus: aiTeam.evalStatus || "not_evaluated",
    evalScore: Number(aiTeam.evalScore || 0),
    runId: aiTeam.runId || null,
    costActualCents: Number(cost.actualCents || task.cost_actual_cents || 0),
    costBudgetCents: Number(cost.budgetCents || task.cost_budget_cents || 0),
    moneyMove: decision.moneyMove || output.moneyMove || output.nextAction || "",
    nextAction: output.nextAction || decision.nextAction || "",
    risk: decision.risk || "low",
    summary: output.summary || "",
    evidence: Array.isArray(output.evidence) ? output.evidence.slice(0, 3) : [],
  };
}

function buildTeamProofSummary(workflow, proofTasks, liveReadiness, chiefRun = null) {
  const metadata = workflow.metadata || {};
  const workerProofs = proofTasks.map(summarizeProofTask);
  const workerCount = proofTasks.length;
  const completedWorkers = workerProofs.filter((proof) => proof.status === "completed").length;
  const passedWorkers = workerProofs.filter((proof) => proof.evalStatus === "passed").length;
  const failedWorkers = workerProofs.filter((proof) => proof.status === "failed" || proof.evalStatus === "failed").length;
  const actualCostCents = workerProofs.reduce((sum, proof) => sum + Number(proof.costActualCents || 0), 0);
  const costBudgetCents = workerProofs.reduce((sum, proof) => sum + Number(proof.costBudgetCents || 0), 0);
  const allPassed = workerCount > 0 && completedWorkers === workerCount && passedWorkers === workerCount && failedWorkers === 0;
  const providerBlockers = Array.isArray(liveReadiness.blockers) ? liveReadiness.blockers : [];
  const blockers = [
    allPassed ? null : `${workerCount - passedWorkers} worker proof${workerCount - passedWorkers === 1 ? "" : "s"} still need review.`,
    "No capped live worker comparison has been reviewed yet.",
    ...providerBlockers,
  ].filter(Boolean);
  const teamName = metadata.teamName || "Digital-product AI team";
  const moneyMove = allPassed
    ? "Use the protected crew evidence as readiness proof, then choose whether provider setup and one capped live comparison are worth approving."
    : "Keep the AI Team protected and repair the weak worker proof before any live comparison.";
  const nextAction = allPassed
    ? "Review the team proof, then either keep using protected workers or prepare one capped live worker test after provider setup."
    : "Open the failed or weak worker proof, request changes, and rerun the protected drill before live setup.";
  const status = allPassed ? "ready_after_setup" : "needs_review";
  return {
    schema: TEAM_DRILL_SUMMARY_SCHEMA,
    status,
    teamName,
    workflowId: workflow.id,
    workerCount,
    completedWorkers,
    passedWorkers,
    failedWorkers,
    actualCostCents,
    costBudgetCents,
    operatorSummary: `${teamName} completed ${completedWorkers}/${workerCount} protected worker proof${workerCount === 1 ? "" : "s"} with ${passedWorkers} passing quality checks and ${moneyLabel(actualCostCents)} actual spend.`,
    moneyMove,
    nextAction,
    decision: "Approve a narrow next step, request changes to the team proof, or deny live setup for now.",
    evidence: [
      `${completedWorkers}/${workerCount} worker proofs completed.`,
      `${passedWorkers}/${workerCount} worker quality checks passed.`,
      `${moneyLabel(actualCostCents)} actual spend against a protected drill budget of ${moneyLabel(costBudgetCents)}.`,
      "Publishing, customer contact, account actions, legal/compliance decisions, money movement, and unapproved spend stayed locked.",
    ],
    risks: [
      ...blockers,
      "Protected proof is not market proof; real buyer metrics still need a manual or live approved test.",
    ],
    blockers,
    workerProofs,
    hardStops: [
      "No live model call",
      "No customer contact",
      "No publishing",
      "No account action",
      "No paid spend",
      "No money movement",
      "No legal, tax, compliance, IP, or platform-risk decision",
    ],
    allowedOperatorActions: [
      "Review team proof",
      "Request changes",
      "Prepare one capped live worker comparison after setup",
      "Keep workers protected",
    ],
    continuousImprovement: {
      hypothesis: "If the AI Team can produce useful protected decision evidence together, a capped live comparison becomes safer and easier to judge.",
      smallestUsefulAction: "Review the protected team proof and decide whether one capped live worker comparison is justified.",
      expectedMetric: "All core workers pass protected evals with clear evidence, cost, blockers, and next actions.",
      actualResult: `${passedWorkers}/${workerCount} protected worker checks passed with ${moneyLabel(actualCostCents)} actual spend.`,
      learning: allPassed
        ? "The protected crew can produce usable internal decision evidence; the remaining gap is provider setup and live comparison review."
        : "The crew still has weak protected evidence, so live comparison should wait.",
      improvement: allPassed
        ? "Use this proof to choose a single capped live worker comparison, then compare live quality, cost, and usefulness against protected output."
        : "Repair the weak worker proof and rerun the protected drill.",
    },
    chiefRunId: chiefRun?.runId || null,
    chiefEvalStatus: chiefRun?.evalStatus || null,
    chiefEvalScore: chiefRun?.evalScore || null,
    createdAt: now(),
  };
}

function recordAgentWorkbenchTeamSummary(db, workflowId) {
  ensureAgentWorkbench(db);
  const workflow = workflowForTeamSummary(db, workflowId);
  if (!workflow || workflow.type !== "agent_workbench_team_proof") return null;
  if (workflow.metadata?.teamProofSummary?.chiefRunId) return workflow.metadata.teamProofSummary;

  const proofTasks = proofTaskRows(db, workflowId);
  if (!proofTasks.length || proofTasks.some((task) => task.status !== "completed")) return null;

  const liveReadiness = getLiveAiWorkerReadiness(db);
  const draftSummary = buildTeamProofSummary(workflow, proofTasks, liveReadiness);
  const chiefRun = recordProtectedWorkerOutcome(
    db,
    {
      kind: "team_drill_summary",
      agent: "chief_of_staff",
      workflow_id: workflow.id,
      title: `Summarize ${draftSummary.teamName} protected drill`,
      cost_budget_cents: draftSummary.costBudgetCents,
      payload: {
        buyer: workflow.metadata?.buyer,
        problem: workflow.metadata?.problem,
        offer: workflow.metadata?.offer,
        channel: workflow.metadata?.channel,
      },
    },
    {
      heading: "AI Team protected drill summary",
      summary: draftSummary.operatorSummary,
      moneyMove: draftSummary.moneyMove,
      evidence: draftSummary.evidence,
      risks: draftSummary.risks,
      details: {
        "Workers passed": `${draftSummary.passedWorkers}/${draftSummary.workerCount}`,
        "Actual spend": moneyLabel(draftSummary.actualCostCents),
        "Next decision": draftSummary.decision,
        "Main blocker": draftSummary.blockers[0] || "No blocker recorded.",
        "Still locked": draftSummary.hardStops.join("; "),
      },
      operatorDecision: draftSummary.decision,
      nextAction: draftSummary.nextAction,
      confidence: draftSummary.status === "ready_after_setup" ? "medium_for_protected_readiness" : "needs_review",
    },
    {
      metadata: {
        workflowId: workflow.id,
        teamProofSummary: draftSummary,
      },
      trace: [
        {
          type: "team_drill_summary_prepared",
          title: "Team drill summary prepared",
          detail: "Chief of Staff compressed the protected team proof into one operator decision packet.",
          metadata: {
            workflowId: workflow.id,
            workerCount: draftSummary.workerCount,
            passedWorkers: draftSummary.passedWorkers,
            actualCostCents: draftSummary.actualCostCents,
          },
        },
      ],
    },
  );
  const summary = buildTeamProofSummary(workflow, proofTasks, liveReadiness, chiefRun);
  const updatedMetadata = {
    ...(workflow.metadata || {}),
    teamProofSummary: summary,
    aiTeam: {
      ...((workflow.metadata || {}).aiTeam || {}),
      teamProofSummary: summary,
    },
  };
  run(db, "UPDATE workflows SET metadata = ?, updated_at = ? WHERE id = ?", [toJson(updatedMetadata), now(), workflow.id]);
  run(
    db,
    `INSERT INTO messages (id, task_id, severity, status, subject, body, created_at, metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET body = excluded.body, metadata = excluded.metadata`,
    [
      `msg_team_drill_summary_${slugForId(workflow.id)}`,
      null,
      "approval",
      "open",
      "AI Team drill summary ready",
      `${summary.operatorSummary} ${summary.nextAction}`,
      now(),
      toJson({ workflowId: workflow.id, teamProofSummary: summary }),
    ],
  );
  insertEvent(db, {
    actor: "chief_of_staff",
    type: "agent.team_drill_summary_ready",
    entityType: "workflow",
    entityId: workflow.id,
    message: `Chief of Staff prepared the protected AI Team drill summary for ${summary.teamName}.`,
    metadata: { workflowId: workflow.id, workerCount: summary.workerCount, passedWorkers: summary.passedWorkers },
  });
  return summary;
}

function workerKey(value) {
  return String(value || "").trim().toLowerCase();
}

function selectProofForLiveComparison(summary, requestedWorker) {
  const proofs = Array.isArray(summary?.workerProofs) ? summary.workerProofs : [];
  if (!proofs.length) return null;
  const requested = workerKey(requestedWorker);
  if (requested) {
    const match = proofs.find((proof) => (
      workerKey(proof.workerId) === requested
      || workerKey(proof.workerName) === requested
    ));
    if (!match) throw new Error(`Protected proof not found for requested worker: ${requestedWorker}`);
    return match;
  }
  return proofs.find((proof) => proof.workerId === "demand_validator" && proof.evalStatus === "passed")
    || proofs.find((proof) => proof.workerId !== "chief_of_staff" && proof.evalStatus === "passed")
    || proofs.find((proof) => proof.evalStatus === "passed")
    || proofs[0];
}

function protectedComparisonEvidence(summary, proof) {
  const evidence = [
    summary.operatorSummary,
    `${proof.workerName || proof.workerId} protected proof scored ${Number(proof.evalScore || 0)}/100 with ${moneyLabel(proof.costActualCents || 0)} actual spend.`,
    proof.moneyMove ? `Protected money move: ${proof.moneyMove}` : null,
    proof.nextAction ? `Protected next action: ${proof.nextAction}` : null,
    ...(Array.isArray(summary.evidence) ? summary.evidence : []),
  ].filter(Boolean);
  return evidence.slice(0, 8);
}

function requestAgentWorkbenchLiveComparison(db, workflowId, options = {}) {
  ensureAgentWorkbench(db);
  const workflow = workflowForTeamSummary(db, workflowId);
  if (!workflow || workflow.type !== "agent_workbench_team_proof") {
    throw new Error("Run a protected AI Team drill before requesting a Workbench live comparison.");
  }
  const summary = workflow.metadata?.teamProofSummary || workflow.metadata?.aiTeam?.teamProofSummary;
  if (!summary?.chiefRunId) {
    throw new Error("The protected AI Team drill needs a Chief of Staff summary before live comparison.");
  }

  const proof = selectProofForLiveComparison(summary, options.worker || options.requestedWorker);
  if (!proof?.workerId) throw new Error("No protected worker proof is available for live comparison.");
  const evidence = protectedComparisonEvidence(summary, proof);
  const reason = options.reason || [
    `Prepare one capped live comparison for ${proof.workerName || proof.workerId}.`,
    "Use the completed protected team drill as the baseline.",
    "Do not run live spend until the operator approves and provider readiness passes.",
  ].join(" ");
  const liveWorker = requestLiveAiWorker(db, workflow.id, {
    ...options,
    worker: proof.workerId,
    requestedBy: options.requestedBy || "agent_workbench",
    reason,
    expectedOutput: options.expectedOutput || "Compare this live specialist output with the protected proof, then return a concise operator decision with cost, trace, quality, risk, and next action.",
    comparisonSource: {
      type: "agent_workbench_team_proof",
      workflowId: workflow.id,
      teamName: summary.teamName,
      summarySchema: summary.schema,
      chiefRunId: summary.chiefRunId,
      protectedRunId: proof.runId,
      protectedWorkerId: proof.workerId,
      protectedWorkerName: proof.workerName,
      protectedEvalScore: proof.evalScore,
    },
    protectedEvidence: evidence,
    expectedMetric: options.expectedMetric || "Live worker output passes the same contract checks with trace evidence, useful judgement, and capped cost.",
  });

  const requestedAt = now();
  const comparisonRequest = {
    status: liveWorker.status,
    requestedAt,
    workerId: liveWorker.worker.id,
    workerName: liveWorker.worker.name,
    taskId: liveWorker.task?.id || null,
    approvalId: liveWorker.approval?.id || null,
    estimatedCostCents: liveWorker.estimatedCostCents,
    provider: liveWorker.provider,
    model: liveWorker.model,
    protectedRunId: proof.runId || null,
    protectedEvalScore: Number(proof.evalScore || 0),
    nextAction: liveWorker.approval?.status === "pending"
      ? `Review the capped ${liveWorker.worker.name} live comparison approval.`
      : "Provider setup is still required before a live comparison can run.",
    evidence,
  };
  const updatedSummary = {
    ...summary,
    liveComparisonRequest: comparisonRequest,
  };
  const updatedMetadata = {
    ...(workflow.metadata || {}),
    teamProofSummary: updatedSummary,
    aiTeam: {
      ...((workflow.metadata || {}).aiTeam || {}),
      teamProofSummary: updatedSummary,
    },
  };
  run(db, "UPDATE workflows SET metadata = ?, updated_at = ? WHERE id = ?", [toJson(updatedMetadata), requestedAt, workflow.id]);
  insertEvent(db, {
    level: "warn",
    actor: "agent_workbench",
    type: "agent.live_comparison_requested",
    entityType: "workflow",
    entityId: workflow.id,
    message: `${liveWorker.worker.name} capped live comparison was prepared from protected team proof. Approval and provider readiness are required before spend.`,
    metadata: {
      workflowId: workflow.id,
      taskId: comparisonRequest.taskId,
      approvalId: comparisonRequest.approvalId,
      workerId: comparisonRequest.workerId,
      estimatedCostCents: comparisonRequest.estimatedCostCents,
      protectedRunId: comparisonRequest.protectedRunId,
    },
  });

  return {
    status: liveWorker.status,
    workflow: { id: workflow.id, title: workflow.title },
    comparisonRequest,
    liveWorker,
  };
}

function latestByTime(items, fieldNames) {
  return [...items].sort((a, b) => {
    const aTime = fieldNames.map((field) => a[field]).find(Boolean) || "";
    const bTime = fieldNames.map((field) => b[field]).find(Boolean) || "";
    return String(bTime).localeCompare(String(aTime));
  })[0] || null;
}

function runMode(runRecord) {
  return LIVE_RUN_MODES.has(String(runRecord.mode || "").toLowerCase()) ? "live" : "dry-run";
}

function summarizeRun(runRecord, evalRecord, traces) {
  if (!runRecord) return null;
  const types = traceTypes(traces);
  return {
    id: runRecord.id,
    status: runRecord.status,
    mode: runRecord.mode,
    startedAt: runRecord.started_at,
    completedAt: runRecord.completed_at,
    summary: runRecord.output_summary || runRecord.input_summary || "",
    estimatedCostCents: Number(runRecord.estimated_cost_cents || 0),
    actualCostCents: Number(runRecord.actual_cost_cents || 0),
    evalStatus: evalRecord?.status || runRecord.eval_status || "not_evaluated",
    evalScore: Number(evalRecord?.score || 0),
    traceCount: traces.length,
    traceTypes: types,
  };
}

function requirement(id, label, ok, detail, action) {
  return {
    id,
    label,
    ok: Boolean(ok),
    status: ok ? "ready" : "blocked",
    detail,
    action,
  };
}

function promotionRequirement(id, label, ok, detail, action) {
  return {
    id,
    label,
    ok: Boolean(ok),
    status: ok ? "ready" : "needs_attention",
    detail,
    action,
  };
}

function traceTypes(traces = []) {
  return [...new Set(traces.map((trace) => trace.type).filter(Boolean))].sort();
}

function traceLabel(type) {
  return {
    model_call_completed: "live model call record",
    contract_checked: "business decision check",
    eval_completed: "quality check",
  }[type] || String(type || "trace evidence").replaceAll("_", " ");
}

function traceCoverage(traces = [], mode = "protected") {
  const types = traceTypes(traces);
  const required = mode === "live"
    ? ["model_call_completed", "contract_checked", "eval_completed"]
    : ["contract_checked", "eval_completed"];
  const missing = required.filter((type) => !types.includes(type));
  return {
    ok: missing.length === 0,
    required,
    missing,
    types,
    summary: missing.length
      ? `Missing ${missing.map(traceLabel).join(", ")}.`
      : mode === "live"
        ? "Trace shows the model call, contract check, and quality check expected for this step."
        : "Trace shows the contract check and quality check expected for protected work.",
  };
}

function evalStatus(evalRecord, runRecord) {
  return evalRecord?.status || runRecord?.eval_status || "not_evaluated";
}

function evalScore(evalRecord) {
  return Number(evalRecord?.score || 0);
}

function buildPromotionGate({
  definition,
  latestDryRun,
  latestDryEval,
  dryTraces,
  latestLiveRun,
  latestLiveEval,
  liveTraces,
  pendingLiveApproval,
  liveReadiness,
  approvalReady,
  datasetReady,
  dryRunProof,
  toolPolicyReady,
  capability,
}) {
  const dryCoverage = traceCoverage(dryTraces, "protected");
  const liveCoverage = traceCoverage(liveTraces, "live");
  const liveRunStarted = Boolean(latestLiveRun);
  const liveRunCompleted = Boolean(latestLiveRun?.status === "completed");
  const liveRunFailed = Boolean(latestLiveRun?.status === "failed");
  const liveEvalPassed = Boolean(latestLiveRun && evalStatus(latestLiveEval, latestLiveRun) === "passed");
  const dryScore = evalScore(latestDryEval);
  const liveScore = evalScore(latestLiveEval);
  const liveCostCents = Number(latestLiveRun?.actual_cost_cents || 0);
  const liveCapCents = Math.max(
    Number(latestLiveRun?.estimated_cost_cents || 0),
    Number(liveReadiness.defaultBudgetCents || 0),
  );
  const costWithinCap = !latestLiveRun || liveCostCents === 0 || liveCapCents === 0 || liveCostCents <= liveCapCents;
  const currentProviderReady = Boolean(liveReadiness.ready);
  const promotionEvidenceReady = Boolean(
    dryRunProof
    && dryCoverage.ok
    && liveRunCompleted
    && liveEvalPassed
    && liveCoverage.ok
    && costWithinCap
    && approvalReady
    && toolPolicyReady
  );
  const requiredPasses = Number(capability?.required_passes || 5);
  const consecutivePasses = Number(capability?.consecutive_passes || 0);
  const streakComplete = Boolean(capability && consecutivePasses >= requiredPasses);
  const operatorPromoted = capability?.status === "promoted";
  const readyForNarrowUse = promotionEvidenceReady && operatorPromoted;

  let status = "provider_setup_needed";
  if (liveRunFailed) status = "live_failed_review";
  else if (!dryRunProof) status = "needs_protected_proof";
  else if (!datasetReady) status = "needs_test_case";
  else if (!dryCoverage.ok) status = "needs_trace_review";
  else if (liveRunStarted && !liveRunCompleted) status = "live_test_in_progress";
  else if (liveRunCompleted && !promotionEvidenceReady) status = "live_needs_review";
  else if (promotionEvidenceReady && capability?.status === "suspended") status = "live_needs_review";
  else if (promotionEvidenceReady && capability && !streakComplete) status = "supervised_learning";
  else if (promotionEvidenceReady && capability && !operatorPromoted) status = "awaiting_operator_promotion";
  else if (promotionEvidenceReady && !capability) status = "live_needs_review";
  else if (readyForNarrowUse && currentProviderReady) status = "ready_for_narrow_live_use";
  else if (readyForNarrowUse) status = "ready_after_setup";
  else if (pendingLiveApproval) status = "pending_live_approval";
  else if (currentProviderReady) status = "ready_for_capped_live_test";

  const recommendations = {
    needs_protected_proof: "Keep this worker in protected mode until it completes a successful internal run.",
    needs_test_case: "Repair the worker's repeatable test case before trusting the output.",
    needs_trace_review: "Run the worker through the normal ledger so the decision contract and quality check are traceable.",
    provider_setup_needed: "Protected proof exists. Connect provider setup only when you are ready for one capped live comparison.",
    pending_live_approval: "A capped live-worker test is waiting for your decision.",
    ready_for_capped_live_test: "Run one capped live comparison, then review quality, trace, cost, and decision usefulness before widening use.",
    live_test_in_progress: "Wait for the live comparison to finish before changing this worker's permissions.",
    live_failed_review: "Review the failed live run and keep the worker protected until the cause is corrected.",
    live_needs_review: "Do not widen live use yet. Review quality, trace, cost, or controls first.",
    supervised_learning: `Keep this exact capability supervised until it completes ${requiredPasses} consecutive reviewed successes.`,
    awaiting_operator_promotion: "The evidence streak is complete. The operator must explicitly decide whether to promote this exact capability.",
    ready_after_setup: "This worker passed the comparison, but provider setup must be ready before the next live task.",
    ready_for_narrow_live_use: "Approved for narrow, capped live use only. External actions and spend still require separate approval.",
  };

  const evidence = [
    dryRunProof
      ? `Protected run passed with a ${dryScore}/100 quality check.`
      : "Protected proof has not passed yet.",
    dryCoverage.ok
      ? "Protected trace includes contract and quality checks."
      : dryCoverage.summary,
  ];
  if (latestLiveRun) {
    evidence.push(`Live comparison is ${latestLiveRun.status} with a ${liveScore}/100 quality check.`);
    evidence.push(costWithinCap
      ? `Live cost stayed inside the recorded cap (${liveCostCents} cents used).`
      : `Live cost exceeded the recorded cap (${liveCostCents} cents used against ${liveCapCents} cents).`);
    evidence.push(liveCoverage.ok ? "Live trace includes model call, contract, and quality checks." : liveCoverage.summary);
  } else if (pendingLiveApproval) {
    evidence.push("A capped live-worker approval is waiting.");
  } else {
    evidence.push(currentProviderReady ? "Provider setup is ready for one approved capped comparison." : (liveReadiness.blockers || ["Provider setup is not ready."])[0]);
  }

  const risks = [];
  if (!currentProviderReady) risks.push("Provider setup is not ready for a live worker call.");
  if (!pendingLiveApproval && !latestLiveRun) risks.push("No live comparison has been reviewed yet.");
  if (liveRunFailed) risks.push("The latest live attempt failed and must not be treated as reliable work.");
  if (latestLiveRun && !liveEvalPassed) risks.push("The live output has not passed the quality check.");
  if (latestLiveRun && !liveCoverage.ok) risks.push("The live trace is incomplete.");
  if (!costWithinCap) risks.push("Recorded live cost exceeded the comparison cap.");
  if (!toolPolicyReady) risks.push("Tool permissions are not fully safe for widening worker use.");
  if (!risks.length) risks.push("Live use is still narrow: no publishing, customer contact, paid spend, account action, legal, or finance action without a separate approval.");

  const allowedNextActions = {
    needs_protected_proof: ["Run a protected worker task first.", "Review the quality check before any live request."],
    needs_test_case: ["Repair the worker readiness test case.", "Keep the worker in protected mode."],
    needs_trace_review: ["Run the worker through the normal task ledger.", "Confirm contract and quality traces are captured."],
    provider_setup_needed: ["Keep using protected worker outputs.", "Prepare live setup only when you approve capped model spend."],
    pending_live_approval: ["Approve, request changes, or deny the capped live-worker test.", "Do not run live work until the decision is recorded."],
    ready_for_capped_live_test: ["Request one capped live-worker comparison.", "Review the result before widening use."],
    live_test_in_progress: ["Wait for completion.", "Review cost and quality evidence when it finishes."],
    live_failed_review: ["Inspect the failed run.", "Fix provider or prompt issues before another live test."],
    live_needs_review: ["Review the live output, trace, cost, and controls.", "Request changes before another live test."],
    supervised_learning: ["Complete distinct reviewed fixtures.", "Keep the capability supervised until five passes are recorded."],
    awaiting_operator_promotion: ["Present the completed evidence streak to the operator.", "Do not widen autonomy without an explicit decision."],
    ready_after_setup: ["Reconnect provider setup before another live task.", "Keep live use narrow and approval-gated."],
    ready_for_narrow_live_use: ["Use only for narrow capped live tasks.", "Keep external actions locked behind separate approval."],
  }[status] || ["Keep the worker protected until the next evidence gap is fixed."];

  return {
    schema: PROMOTION_GATE_SCHEMA,
    workerId: definition.id,
    workerName: definition.name,
    status,
    recommendation: recommendations[status],
    decision: readyForNarrowUse ? "This exact capability is approved for narrow live use." : "This capability stays supervised until its evidence and operator-promotion requirements are complete.",
    requirements: [
      promotionRequirement(
        "protected_quality",
        "Protected quality",
        dryRunProof,
        dryRunProof ? "Protected work passed the worker quality check." : "Run protected work until the output passes.",
        "Run a protected worker task first.",
      ),
      promotionRequirement(
        "protected_trace",
        "Protected trace",
        dryCoverage.ok,
        dryCoverage.ok ? "Protected work has contract and quality-check trace evidence." : dryCoverage.summary,
        "Capture contract and quality-check traces.",
      ),
      promotionRequirement(
        "live_comparison",
        "Live comparison",
        liveRunCompleted,
        liveRunCompleted ? "A capped live comparison has completed." : "No completed live comparison exists yet.",
        pendingLiveApproval ? "Decide the waiting live-worker approval." : "Request one capped live comparison after setup.",
      ),
      promotionRequirement(
        "live_quality",
        "Live quality",
        liveEvalPassed,
        liveEvalPassed ? "Live output passed the same quality check." : "Live output has not passed yet.",
        "Review or rerun the capped comparison after changes.",
      ),
      promotionRequirement(
        "live_trace",
        "Live trace",
        liveRunCompleted && liveCoverage.ok,
        liveRunCompleted && liveCoverage.ok ? "Live trace includes model call, contract, and quality checks." : liveCoverage.summary,
        "Make sure the live path records model, contract, and quality evidence.",
      ),
      promotionRequirement(
        "cost_control",
        "Cost control",
        costWithinCap,
        costWithinCap ? "Recorded live cost is inside the comparison cap." : "Recorded live cost exceeded the comparison cap.",
        "Lower the cap, review billing, or request approval before another live run.",
      ),
      promotionRequirement(
        "operator_controls",
        "Operator controls",
        approvalReady && toolPolicyReady,
        approvalReady && toolPolicyReady ? "Hard stops and tool permissions are active." : "Approval or tool-permission controls need review.",
        "Review approvals and tool permissions before widening use.",
      ),
      promotionRequirement(
        "capability_streak",
        "Reviewed success streak",
        streakComplete,
        capability
          ? `${consecutivePasses} of ${requiredPasses} consecutive reviewed successes are recorded for this exact capability.`
          : "No promotable capability has been defined for this worker yet.",
        capability ? "Complete the remaining reviewed runs." : "Define a narrow capability before considering promotion.",
      ),
      promotionRequirement(
        "operator_promotion",
        "Operator promotion",
        operatorPromoted,
        operatorPromoted ? "The operator explicitly promoted this exact capability." : "No explicit operator promotion is recorded.",
        streakComplete ? "Ask the operator to approve or decline promotion." : "Finish the reviewed success streak first.",
      ),
    ],
    comparison: {
      dryRunId: latestDryRun?.id || null,
      liveRunId: latestLiveRun?.id || null,
      dryEvalScore: dryScore,
      liveEvalScore: liveScore,
      evalDelta: latestLiveRun ? liveScore - dryScore : null,
      liveCostCents,
      liveCapCents,
      costDeltaCents: latestLiveRun ? liveCostCents - Number(latestDryRun?.actual_cost_cents || latestDryRun?.estimated_cost_cents || 0) : null,
      dryTraceTypes: dryCoverage.types,
      liveTraceTypes: liveCoverage.types,
    },
    evidence,
    risks,
    allowedNextActions,
    officialGuidance: [
      "Use narrow specialist agents with clear routing and handoffs.",
      "Use approvals for sensitive actions.",
      "Use traces and evals before widening agent behavior.",
    ],
  };
}

function workerStatus({ liveRun, liveEval, dryRunProof, traceProof, datasetReady, approvalReady, canPrepareLive, liveReady }) {
  if (liveRun && liveRun.status === "completed" && (liveEval?.status || liveRun.eval_status) === "passed") return "live_tested";
  if (liveRun && liveRun.status === "failed") return "live_needs_review";
  if (!datasetReady) return "needs_eval_dataset";
  if (!dryRunProof) return "needs_dry_run_proof";
  if (!traceProof) return "needs_trace_review";
  if (!approvalReady) return "needs_approval_policy";
  if (liveReady) return "ready_for_capped_live_test";
  if (canPrepareLive) return "ready_after_setup";
  return "needs_provider_setup";
}

function getAgentWorkbenchState(db) {
  ensureAgentWorkbench(db);
  ensureCapabilityAutonomy(db);
  const liveReadiness = getLiveAiWorkerReadiness(db);
  const toolPolicy = getAgentToolPolicyState(db);
  const definitions = all(db, "SELECT * FROM agent_definitions ORDER BY CASE role WHEN 'manager' THEN 0 ELSE 1 END, name ASC").map(parseDefinition);
  const datasets = all(db, "SELECT * FROM agent_eval_datasets ORDER BY name ASC").map((row) => parseRow(row));
  const cases = all(db, "SELECT * FROM agent_eval_cases ORDER BY title ASC").map((row) => parseRow(row, ["criteria", "metadata"]));
  const runs = all(db, "SELECT * FROM agent_runs ORDER BY started_at DESC LIMIT 300").map((row) => parseRow(row));
  const evals = all(db, "SELECT * FROM agent_eval_results ORDER BY created_at DESC LIMIT 300").map((row) => parseRow(row, ["criteria", "findings", "metadata"]));
  const traces = all(db, "SELECT * FROM agent_trace_events ORDER BY ts DESC, sequence DESC LIMIT 600").map((row) => parseRow(row));
  const handoffs = all(db, "SELECT * FROM agent_handoffs ORDER BY updated_at DESC LIMIT 200").map((row) => parseRow(row));
  const approvals = all(db, "SELECT * FROM approvals ORDER BY requested_at DESC LIMIT 200").map((row) => parseRow(row, ["payload"]));
  const modelCalls = all(db, "SELECT * FROM model_calls ORDER BY created_at DESC LIMIT 200").map((row) => parseRow(row));
  const capabilities = all(db, "SELECT * FROM capability_autonomy ORDER BY capability_key ASC");
  const capabilityByAgent = new Map(capabilities.map((capability) => [capability.agent_id, capability]));

  const evalsByRun = new Map();
  for (const evalRecord of evals) {
    const list = evalsByRun.get(evalRecord.run_id) || [];
    list.push(evalRecord);
    evalsByRun.set(evalRecord.run_id, list);
  }
  const tracesByRun = new Map();
  for (const trace of traces) {
    const list = tracesByRun.get(trace.run_id) || [];
    list.push(trace);
    tracesByRun.set(trace.run_id, list);
  }

  const workers = definitions.map((definition) => {
    const workerRuns = runs.filter((runRecord) => runRecord.agent_id === definition.id);
    const dryRuns = workerRuns.filter((runRecord) => runMode(runRecord) === "dry-run");
    const liveRuns = workerRuns.filter((runRecord) => runMode(runRecord) === "live");
    const workerEvals = evals.filter((evalRecord) => evalRecord.agent_id === definition.id);
    const workerDataset = datasets.find((dataset) => dataset.agent_id === definition.id);
    const workerCases = cases.filter((evalCase) => evalCase.agent_id === definition.id && evalCase.status === "active");
    const latestRun = latestByTime(workerRuns, ["completed_at", "started_at"]);
    const latestDryRun = latestByTime(dryRuns, ["completed_at", "started_at"]);
    const latestLiveRun = latestByTime(liveRuns, ["completed_at", "started_at"]);
    const latestEval = latestByTime(workerEvals, ["created_at"]);
    const latestDryEval = latestDryRun ? latestByTime(evalsByRun.get(latestDryRun.id) || [], ["created_at"]) : null;
    const latestLiveEval = latestLiveRun ? latestByTime(evalsByRun.get(latestLiveRun.id) || [], ["created_at"]) : null;
    const latestTraces = latestRun ? tracesByRun.get(latestRun.id) || [] : [];
    const dryTraces = latestDryRun ? tracesByRun.get(latestDryRun.id) || [] : [];
    const liveTraces = latestLiveRun ? tracesByRun.get(latestLiveRun.id) || [] : [];
    const pendingLiveApproval = approvals.find((approval) => (
      approval.scope === "live_ai_worker_spend"
      && approval.status === "pending"
      && (approval.payload?.worker?.id === definition.id || approval.payload?.requestedWorker === definition.id)
    ));
    const activeHandoffs = handoffs.filter((handoff) => (
      [handoff.from_agent_id, handoff.to_agent_id].includes(definition.id)
      && !["approved_for_next_step", "changes_requested", "declined", "resolved", "completed", "cancelled"].includes(handoff.status)
    ));
    const liveModelCalls = modelCalls.filter((call) => liveRuns.some((runRecord) => runRecord.model_call_id === call.id));
    const workerToolPolicy = toolPolicy.byAgent[definition.id] || null;

    const datasetReady = Boolean(workerDataset && workerDataset.status === "active" && workerCases.length >= Number(workerDataset.minimum_cases || 1));
    const definitionReady = hasText(definition.instructions)
      && listValue(definition.tools).length > 0
      && listValue(definition.guardrails).length > 0
      && listValue(definition.output_contract?.required).length > 0
      && listValue(definition.eval_criteria).length > 0;
    const approvalReady = listValue(definition.approval_policy?.mustPauseFor).length > 0;
    const toolPolicyReady = Boolean(
      workerToolPolicy
      && workerToolPolicy.allToolsRegistered
      && workerToolPolicy.noHardStopToolsAssigned
      && workerToolPolicy.externalActionsRequireApproval
      && workerToolPolicy.spendRequiresApproval,
    );
    const dryRunProof = Boolean(latestDryRun && latestDryRun.status === "completed" && latestDryEval?.status === "passed");
    const traceProof = Boolean(
      latestRun
      && latestTraces.some((trace) => trace.type === "contract_checked")
      && latestTraces.some((trace) => trace.type === "eval_completed"),
    );
    const liveReady = Boolean(liveReadiness.ready && dryRunProof && traceProof && approvalReady && datasetReady);
    const canPrepareLive = Boolean(liveReadiness.canPrepareSmokeTest && dryRunProof && traceProof && approvalReady && datasetReady);
    const score = [
      definitionReady ? 20 : 0,
      datasetReady ? 15 : 0,
      dryRunProof ? 25 : 0,
      traceProof ? 15 : 0,
      approvalReady ? 15 : 0,
      liveReadiness.ready ? 10 : 0,
    ].reduce((sum, value) => sum + value, 0);
    const status = workerStatus({
      liveRun: latestLiveRun,
      liveEval: latestLiveEval,
      dryRunProof,
      traceProof,
      datasetReady,
      approvalReady,
      canPrepareLive,
      liveReady,
    });
    const requirements = [
      requirement(
        "definition",
        "Worker contract",
        definitionReady,
        definitionReady ? "Instructions, tools, guardrails, output contract, and checks are registered." : "Worker definition is missing a required contract field.",
        "Complete the worker definition before assigning more work.",
      ),
      requirement(
        "tool_permissions",
        "Tool permissions",
        toolPolicyReady,
        toolPolicyReady
          ? workerToolPolicy.summary
          : "Tool permissions need registration, approval rules, or hard-stop cleanup before live use.",
        "Review the worker's tool permissions before live execution.",
      ),
      requirement(
        "eval_dataset",
        "Repeatable test case",
        datasetReady,
        datasetReady ? `${workerCases.length} active readiness case is registered.` : "No active worker eval case is available.",
        "Seed or repair the worker readiness case.",
      ),
      requirement(
        "dry_run_proof",
        "Protected proof",
        dryRunProof,
        dryRunProof ? "A protected run completed and passed its quality check." : "Run a protected workflow step for this worker before live testing.",
        "Create or run a safe internal task first.",
      ),
      requirement(
        "trace_review",
        "Trace review",
        traceProof,
        traceProof ? "The latest worker run includes contract and quality-check trace evidence." : "Worker traces must show contract and quality checks.",
        "Run the worker through the normal task ledger so traces are captured.",
      ),
      requirement(
        "approval_policy",
        "Approval policy",
        approvalReady,
        approvalReady ? "Sensitive actions are stopped for operator decision." : "Approval policy is missing hard stops.",
        "Add approval rules before live or external work.",
      ),
      requirement(
        "provider_readiness",
        "Provider setup",
        liveReadiness.ready,
        liveReadiness.ready ? "OpenAI worker provider is ready for an approved capped run." : (liveReadiness.blockers || ["Provider setup is not complete."])[0],
        "Set credentials and live flag only when the operator accepts capped live spend.",
      ),
    ];
    const summarizedDryRun = summarizeRun(latestDryRun, latestDryEval, dryTraces);
    const summarizedLiveRun = summarizeRun(latestLiveRun, latestLiveEval, liveTraces);
    const promotionGate = buildPromotionGate({
      definition,
      latestDryRun,
      latestDryEval,
      dryTraces,
      latestLiveRun,
      latestLiveEval,
      liveTraces,
      pendingLiveApproval,
      liveReadiness,
      approvalReady,
      datasetReady,
      dryRunProof,
      toolPolicyReady,
      capability: capabilityByAgent.get(definition.id) || null,
    });

    return {
      schema: WORKBENCH_SCHEMA,
      agentId: definition.id,
      name: definition.name,
      role: definition.role,
      status,
      readinessScore: score,
      canPrepareLiveTest: canPrepareLive,
      canExecuteLiveNow: liveReady,
      pendingLiveApprovalId: pendingLiveApproval?.id || null,
      activeHandoffs: activeHandoffs.length,
      dataset: workerDataset ? {
        id: workerDataset.id,
        name: workerDataset.name,
        status: workerDataset.status,
        activeCases: workerCases.length,
        passScore: Number(workerDataset.pass_score || 80),
      } : null,
      toolPolicy: workerToolPolicy ? {
        status: workerToolPolicy.status,
        summary: workerToolPolicy.summary,
        allowed: workerToolPolicy.allowed.map((assignment) => assignment.tool.name),
        approvalRequired: workerToolPolicy.approvalRequired.map((assignment) => assignment.tool.name),
        blocked: workerToolPolicy.blocked.map((assignment) => assignment.tool.name),
        assignedTools: workerToolPolicy.assignments.length,
      } : null,
      requirements,
      promotionGate,
      comparison: {
        dryRun: summarizedDryRun,
        live: summarizedLiveRun,
        verdict: latestLiveRun
          ? latestLiveEval?.status === "passed"
            ? "Live worker output passed the same contract checks as protected work."
            : "Live worker output needs review before wider use."
          : dryRunProof
            ? "Protected proof exists; first capped live comparison is still pending."
            : "Protected proof is needed before a live comparison.",
      },
      evidence: {
        runs: workerRuns.length,
        dryRuns: dryRuns.length,
        liveRuns: liveRuns.length,
        passedEvals: workerEvals.filter((evalRecord) => evalRecord.status === "passed").length,
        checksNeedingReview: workerEvals.filter((evalRecord) => evalRecord.status !== "passed").length,
        latestEvalStatus: latestEval?.status || "not_evaluated",
        latestEvalScore: Number(latestEval?.score || 0),
        traceCount: workerRuns.reduce((sum, runRecord) => sum + (tracesByRun.get(runRecord.id) || []).length, 0),
        liveModelCalls: liveModelCalls.length,
        actualLiveCostCents: liveRuns.reduce((sum, runRecord) => sum + Number(runRecord.actual_cost_cents || 0), 0),
      },
      nextAction: requirements.find((item) => !item.ok)?.action || (
        liveReady ? "Run only an explicitly approved capped live test." : "Prepare a capped live test when setup is accepted."
      ),
    };
  });

  const byAgent = Object.fromEntries(workers.map((worker) => [worker.agentId, worker]));
  const readyAfterSetup = workers.filter((worker) => worker.status === "ready_after_setup").length;
  const readyForLive = workers.filter((worker) => worker.status === "ready_for_capped_live_test").length;
  const liveTested = workers.filter((worker) => worker.status === "live_tested").length;
  const readyForNarrowLiveUse = workers.filter((worker) => worker.promotionGate?.status === "ready_for_narrow_live_use").length;
  const promotionNeedsReview = workers.filter((worker) => ["live_failed_review", "live_needs_review"].includes(worker.promotionGate?.status)).length;
  const dryRunProven = workers.filter((worker) => worker.requirements.find((item) => item.id === "dry_run_proof")?.ok).length;
  const nextWorker = workers.find((worker) => worker.promotionGate?.status === "ready_for_capped_live_test" && !worker.pendingLiveApprovalId)
    || workers.find((worker) => worker.promotionGate?.status === "pending_live_approval")
    || workers.find((worker) => worker.canPrepareLiveTest && !worker.pendingLiveApprovalId)
    || workers.find((worker) => worker.status === "needs_dry_run_proof")
    || workers[0]
    || null;

  return {
    schema: WORKBENCH_SCHEMA,
    toolPolicy,
    status: readyForNarrowLiveUse > 0 ? "ready_for_narrow_live_use" : liveTested > 0 ? "live_tested" : readyForLive > 0 ? "ready_for_capped_live_test" : readyAfterSetup > 0 ? "ready_after_setup" : "building_evidence",
    summary: readyForNarrowLiveUse > 0
      ? `${readyForNarrowLiveUse} worker${readyForNarrowLiveUse === 1 ? "" : "s"} passed the protected-versus-live promotion gate for narrow capped use.`
      : liveTested > 0
        ? `${liveTested} worker${liveTested === 1 ? "" : "s"} have live comparison evidence.`
      : readyAfterSetup > 0 || readyForLive > 0
        ? `${readyAfterSetup + readyForLive} worker${readyAfterSetup + readyForLive === 1 ? "" : "s"} are ready for a capped live test once provider gates pass.`
        : "Workers are building protected proof before live model execution.",
    nextAction: nextWorker ? {
      agentId: nextWorker.agentId,
      worker: nextWorker.name,
      action: nextWorker.nextAction,
      status: nextWorker.status,
    } : null,
    liveProvider: {
      ready: liveReadiness.ready,
      status: liveReadiness.status,
      blockers: liveReadiness.blockers || [],
      canPrepareSmokeTest: liveReadiness.canPrepareSmokeTest,
    },
    metrics: {
      workers: workers.length,
      evalDatasets: datasets.length,
      evalCases: cases.length,
      dryRunProven,
      readyAfterSetup,
      readyForLive,
      liveTested,
      readyForNarrowLiveUse,
      promotionNeedsReview,
      needsDryRunProof: workers.filter((worker) => worker.status === "needs_dry_run_proof").length,
      pendingLiveApprovals: workers.filter((worker) => worker.pendingLiveApprovalId).length,
    },
    byAgent,
    workers,
    datasets,
    cases,
  };
}

module.exports = {
  DIGITAL_PRODUCT_PROOF_TEAM,
  ensureAgentWorkbench,
  getAgentWorkbenchState,
  queueAgentWorkbenchProof,
  queueAgentWorkbenchProofSuite,
  recordAgentWorkbenchTeamSummary,
  requestAgentWorkbenchLiveComparison,
};
