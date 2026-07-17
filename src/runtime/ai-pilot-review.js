const { all, fromJson, get, insertEvent, now, randomId, run, toJson } = require("../db");
const { appendReceiptForOperatorUsefulnessReview } = require("./agent-execution-evidence");

const AI_PILOT_REVIEW_SCHEMA = "jarvis_ai_pilot_review_v1";
const LIVE_RUN_MODES = new Set(["openai-agents-sdk", "live-ai-worker", "live-agent"]);
const REVIEW_DECISIONS = new Set(["mark_useful", "request_changes", "repeat_capped_test", "promote_narrow_use", "stop_pilot"]);

function withSavepoint(db, prefix, operation) {
  const name = `${prefix}_${randomId().replace(/[^a-zA-Z0-9]/g, "")}`;
  db.exec(`SAVEPOINT ${name}`);
  try {
    const value = operation();
    db.exec(`RELEASE SAVEPOINT ${name}`);
    return value;
  } catch (error) {
    db.exec(`ROLLBACK TO SAVEPOINT ${name}`);
    db.exec(`RELEASE SAVEPOINT ${name}`);
    throw error;
  }
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function newest(items, dateField = "updated_at") {
  return [...asArray(items)].sort((a, b) => String(b?.[dateField] || "").localeCompare(String(a?.[dateField] || "")))[0] || null;
}

function latestLiveRun(runs, agentId, taskId = null) {
  const matching = asArray(runs).filter((runRecord) => (
    runRecord.agent_id === agentId
    && LIVE_RUN_MODES.has(runRecord.mode)
    && (!taskId || runRecord.task_id === taskId)
  ));
  return newest(matching, "started_at");
}

function latestProtectedRun(workbench, agentId) {
  return workbench?.byAgent?.[agentId]?.comparison?.dryRun || null;
}

function latestPacket(modelReadiness, agentId) {
  return modelReadiness?.byAgent?.[agentId]?.latestComparisonPacket || null;
}

function workerPack(modelReadiness, agentId) {
  return modelReadiness?.byAgent?.[agentId] || null;
}

function approvalForPacket(approvals, packet) {
  if (!packet?.approvalId) return null;
  return asArray(approvals).find((approval) => approval.id === packet.approvalId) || null;
}

function taskForPacket(tasks, packet) {
  if (!packet?.taskId) return null;
  return asArray(tasks).find((task) => task.id === packet.taskId) || null;
}

function evalForRun(evals, runRecord) {
  if (!runRecord) return null;
  return asArray(evals).find((item) => item.run_id === runRecord.id) || null;
}

function modelCallForRun(modelCalls, runRecord, task) {
  if (!runRecord && !task) return null;
  return asArray(modelCalls).find((call) => (
    (runRecord?.model_call_id && call.id === runRecord.model_call_id)
    || (task?.id && call.task_id === task.id && call.mode === "live")
  )) || null;
}

function costForTask(costs, task) {
  if (!task) return null;
  return asArray(costs).find((cost) => cost.id === `cost_spend_${task.id}` || cost.task_id === task.id) || null;
}

function liveOutputContract(task) {
  const output = task?.result?.output || task?.result || {};
  const contract = output.outputContract || task?.result?.outputContract || {};
  const missing = asArray(contract.missing);
  return {
    status: missing.length ? "needs_changes" : task?.status === "completed" ? "passed" : "not_run",
    missing,
    detail: missing.length
      ? `Missing ${missing.join(", ")}.`
      : task?.status === "completed"
        ? "Live output satisfied the required business-decision contract fields."
        : "The live output contract has not been tested yet.",
  };
}

function providerReadiness(readiness) {
  return {
    provider: readiness?.provider || readiness?.agentRuntime?.primaryProvider || "openai-agents-sdk",
    model: readiness?.model || "model not selected",
    ready: Boolean(readiness?.ready),
    credentialsConfigured: Boolean(readiness?.credentialsConfigured),
    liveFlagEnabled: Boolean(readiness?.liveFlagEnabled),
    sdkRunnerReady: Boolean(readiness?.sdkRunnerReady ?? readiness?.adapterReady),
    budgetReady: Boolean(readiness?.budgetReady),
    blockers: asArray(readiness?.blockers),
  };
}

function stageStatus({ packet, approval, task, liveRun, pack, protectedRun }) {
  if (liveRun?.status === "completed") return "live_output_ready_for_review";
  if (liveRun?.status === "failed" || task?.status === "failed") return "live_run_failed_review";
  if (approval?.status === "approved" && task?.status === "blocked" && task?.result?.providerBlocked) return "waiting_for_provider_setup";
  if (approval?.status === "approved") return "approved_waiting_to_run";
  if (approval?.status === "pending") return "waiting_for_approval";
  if (packet) return "packet_ready";
  if (pack?.metadata?.localReady) return "ready_to_prepare_packet";
  if (protectedRun) return "needs_playbook_rehearsal";
  return "needs_protected_baseline";
}

function recommendationForStatus(status) {
  return {
    live_output_ready_for_review: "Review usefulness before repeating or promoting narrow live use.",
    live_run_failed_review: "Do not repeat until the failure reason is understood and the cap remains acceptable.",
    waiting_for_provider_setup: "Keep blocked until credentials, live flag, budget, and provider readiness pass.",
    approved_waiting_to_run: "Run only when the provider gate is ready and the operator still wants the capped test.",
    waiting_for_approval: "Approve, request changes, or deny the capped pilot before any live model call can run.",
    packet_ready: "Review the packet scope, fixture, cost cap, and hard stops before approving.",
    ready_to_prepare_packet: "Prepare one Demand Validator comparison packet from the protected baseline.",
    needs_playbook_rehearsal: "Run the protected playbook rehearsal so the model pack is ready before live AI testing.",
    needs_protected_baseline: "Run protected proof and rehearsal before live AI testing.",
  }[status] || "Keep the pilot controlled and review the next safe action.";
}

function buildActions({ status, packet, approval, liveRun }) {
  if (status === "live_run_failed_review") return [];
  if (status === "ready_to_prepare_packet") {
    return [{ label: "Prepare Pilot Packet", action: "prepare-model-comparison-packet", id: "demand_validator", tone: "success" }];
  }
  if (status === "needs_playbook_rehearsal") {
    return [{ label: "Run Playbook Rehearsal", action: "run-agent-playbook-rehearsal-suite", tone: "success" }];
  }
  if (approval?.status === "pending") {
    return [
      { label: "Approve", action: "approval", decision: "approve", id: approval.id, tone: "success" },
      { label: "Request Changes", action: "approval", decision: "changes", id: approval.id, tone: "warning" },
      { label: "Deny", action: "approval", decision: "reject", id: approval.id, tone: "danger" },
    ];
  }
  if (liveRun?.status === "completed") {
    return [
      { label: "Mark Useful", action: "ai-pilot-review", decision: "mark_useful", agentId: "demand_validator", runId: liveRun.id, tone: "success" },
      { label: "Request Changes", action: "ai-pilot-review", decision: "request_changes", agentId: "demand_validator", runId: liveRun.id, tone: "warning" },
      { label: "Repeat Capped Test", action: "ai-pilot-review", decision: "repeat_capped_test", agentId: "demand_validator", runId: liveRun.id },
      { label: "Promote Narrow Use", action: "ai-pilot-review", decision: "promote_narrow_use", agentId: "demand_validator", runId: liveRun.id, tone: "success" },
      { label: "Stop Pilot", action: "ai-pilot-review", decision: "stop_pilot", agentId: "demand_validator", runId: liveRun.id, tone: "danger" },
    ];
  }
  if (packet?.workflowId) {
    return [{ label: "Open Pilot Workflow", action: "select-record", kind: "workflow", id: packet.workflowId }];
  }
  return [{ label: "Run Protected Team Drill", action: "run-agent-team-proof", tone: "success" }];
}

function buildAiPilotReview({
  aiTeam = {},
  agentWorkbench = {},
  agentModelReadiness = {},
  liveAiWorkerReadiness = {},
  approvals = [],
  tasks = [],
  modelCalls = [],
  costs = [],
} = {}) {
  const agentId = "demand_validator";
  const definition = asArray(aiTeam.definitions).find((worker) => worker.id === agentId) || { id: agentId, name: "Demand Validator" };
  const pack = workerPack(agentModelReadiness, agentId);
  const packet = latestPacket(agentModelReadiness, agentId);
  const approval = approvalForPacket(approvals, packet);
  const task = taskForPacket(tasks, packet) || newest(asArray(tasks).filter((item) => item.kind === "live_ai_worker_execution" && item.agent === agentId), "updated_at");
  const liveRun = latestLiveRun(aiTeam.runs || [], agentId, task?.id) || latestLiveRun(aiTeam.runs || [], agentId);
  const pilotFixture = task?.payload?.pilotFixture || null;
  const protectedRun = latestProtectedRun(agentWorkbench, agentId);
  const evalResult = evalForRun(aiTeam.evalResults || [], liveRun);
  const modelCall = modelCallForRun(modelCalls, liveRun, task);
  const cost = costForTask(costs, task);
  const contract = liveOutputContract(task);
  const status = stageStatus({ packet, approval, task, liveRun, pack, protectedRun });
  const latestReview = liveRun?.metadata?.pilotReview || null;

  return {
    schema: AI_PILOT_REVIEW_SCHEMA,
    agentId,
    workerName: definition.name || "Demand Validator",
    status,
    summary: recommendationForStatus(status),
    businessQuestion: pilotFixture?.question
      || packet?.protectedBaseline?.fixture?.inputSummary
      || packet?.comparisonPlan?.purpose
      || "Can Demand Validator produce useful commercial judgement for this digital-product opportunity?",
    fixture: pilotFixture ? {
      id: pilotFixture.id,
      title: pilotFixture.question,
      expectedOutput: task?.payload?.expectedOutput || "A concise supplied-evidence demand recommendation.",
    } : packet ? {
      id: packet.fixtureId,
      title: packet.fixtureTitle,
      expectedOutput: packet.protectedBaseline?.fixture?.expectedOutput || "",
    } : pack?.fixtures?.[0] || null,
    protectedBaseline: protectedRun ? {
      status: protectedRun.evalStatus || protectedRun.status || "available",
      runId: protectedRun.id || protectedRun.runId || null,
      summary: protectedRun.summary || protectedRun.outputSummary || "Protected baseline exists.",
      score: protectedRun.score || protectedRun.evalScore || null,
    } : {
      status: pack?.metadata?.localReady ? "ready_before_model_connection" : "missing",
      runId: pack?.metadata?.latestProtectedRunId || null,
      summary: pack?.metadata?.localReady ? "Local pack is ready; prepare the comparison packet next." : "Protected worker proof is still needed.",
      score: pack?.readinessScore || 0,
    },
    liveOutput: liveRun ? {
      status: liveRun.status,
      runId: liveRun.id,
      mode: liveRun.mode,
      summary: liveRun.output_summary || task?.result?.output?.summary || "Live output is ready for review.",
      completedAt: liveRun.completed_at || null,
    } : {
      status: "not_run",
      runId: null,
      mode: "openai-agents-sdk",
      summary: "No live Agents SDK output has been captured yet.",
      completedAt: null,
    },
    contract,
    eval: evalResult ? {
      status: evalResult.status,
      score: evalResult.score,
      findings: asArray(evalResult.findings),
    } : {
      status: liveRun?.eval_status || "not_run",
      score: null,
      findings: [],
    },
    cost: {
      capCents: Number(packet?.estimatedCostCents || task?.cost_budget_cents || 0),
      actualCents: Number(task?.cost_actual_cents || liveRun?.actual_cost_cents || 0),
      incurredEstimateCents: cost?.status === "incurred_estimate" ? Number(cost.amount_cents || 0) : 0,
      status: cost?.status || (liveRun ? "recorded" : "not_run"),
      exactBillingPending: Boolean(cost?.metadata?.exactBillingPending || modelCall?.metadata?.exactBillingPending),
    },
    trace: {
      modelCallId: modelCall?.id || liveRun?.model_call_id || null,
      modelCallStatus: modelCall?.status || "not_run",
      provider: modelCall?.provider || modelCall?.metadata?.provider || "openai-agents-sdk",
    },
    providerReadiness: providerReadiness(liveAiWorkerReadiness),
    risk: {
      hardStops: asArray(packet?.hardStops).slice(0, 8),
      externalActionsAllowed: false,
      noSpendBeforeApproval: approval?.status !== "approved" || Number(task?.cost_actual_cents || 0) === 0,
    },
    latestReview,
    recommendation: latestReview?.decision
      ? `Latest operator review recorded: ${latestReview.decision}.`
      : recommendationForStatus(status),
    actions: buildActions({ status, packet, approval, liveRun }),
  };
}

function recordAiPilotReviewDecision(db, agentId, decision, options = {}) {
  if (!REVIEW_DECISIONS.has(decision)) {
    throw new Error(`Unsupported AI pilot review decision: ${decision}`);
  }
  const runId = String(options.runId || "").trim();
  if (!runId) throw new Error("An exact AI run ID is required for an operator review.");
  const runRow = get(
    db,
    `SELECT * FROM agent_runs
     WHERE id = ? AND agent_id = ?
       AND mode IN ('openai-agents-sdk', 'live-ai-worker', 'live-agent')`,
    [runId, agentId],
  );
  if (!runRow) throw new Error(`No live AI pilot run exists for ${agentId}.`);
  const ts = now();
  const metadata = fromJson(runRow.metadata, {});
  const pilotReview = {
    schema: `${AI_PILOT_REVIEW_SCHEMA}.decision`,
    decision,
    note: options.note || "",
    decidedBy: options.decidedBy || "operator",
    reviewedAt: ts,
    nextAction: {
      mark_useful: "Use this result as positive usefulness evidence before deciding on narrow promotion.",
      request_changes: "Revise fixture, prompt, or output expectation before repeating.",
      repeat_capped_test: "Prepare another capped approval before any repeat model call.",
      promote_narrow_use: "Consider narrow capped use only behind the existing approval and budget rails.",
      stop_pilot: "Stop live worker testing and keep the worker protected.",
    }[decision],
  };
  const receipt = withSavepoint(db, "record_ai_pilot_review", () => {
    run(db, "UPDATE agent_runs SET metadata = ? WHERE id = ?", [
      toJson({ ...metadata, pilotReview }),
      runRow.id,
    ]);
    insertEvent(db, {
      actor: "operator",
      type: "ai_pilot_review.decision_recorded",
      entityType: "agent_run",
      entityId: runRow.id,
      message: `AI pilot review recorded for ${agentId}: ${decision}.`,
      metadata: {
        agentId,
        runId: runRow.id,
        decision,
        note: options.note || "",
        noExternalAction: true,
      },
    });
    return appendReceiptForOperatorUsefulnessReview(db, runRow.id);
  });
  return {
    status: "recorded",
    runId: runRow.id,
    agentId,
    decision,
    pilotReview,
    receipt: {
      id: receipt.id,
      sequence: receipt.sequence,
      status: receipt.status,
    },
  };
}

function getAiPilotReviewState(db, context = {}) {
  const aiTeam = context.aiTeam || {};
  const rows = context.aiTeam?.runs ? null : all(
    db,
    `SELECT agent_runs.*, agent_definitions.name AS agent_name, agent_definitions.role AS agent_role
     FROM agent_runs
     LEFT JOIN agent_definitions ON agent_definitions.id = agent_runs.agent_id
     ORDER BY agent_runs.started_at DESC
     LIMIT 300`,
  );
  const nextContext = rows ? { ...context, aiTeam: { ...aiTeam, runs: rows.map((row) => ({ ...row, metadata: fromJson(row.metadata, {}) })) } } : context;
  return buildAiPilotReview(nextContext);
}

module.exports = {
  AI_PILOT_REVIEW_SCHEMA,
  buildAiPilotReview,
  getAiPilotReviewState,
  recordAiPilotReviewDecision,
};
