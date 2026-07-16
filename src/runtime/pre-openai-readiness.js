const CONFIG = require("../config");
const { all, fromJson, get } = require("../db");
const { getAgentWorkbenchState } = require("./agent-workbench");
const { getAgentToolPolicyState } = require("./agent-tools");
const { getAgentPlaybooksState } = require("./agent-playbooks");
const { getLiveAiWorkerReadiness } = require("./live-ai-worker-readiness");

const PRE_OPENAI_SCHEMA = "jarvis_pre_openai_readiness_v1";
const LIVE_COMPARISON_SOURCE_TYPES = new Set(["agent_workbench_team_proof", "agent_model_readiness_pack"]);

function parseRows(rows, fields = ["metadata", "payload", "result"]) {
  return rows.map((row) => {
    const copy = { ...row };
    for (const field of fields) {
      if (field in copy) copy[field] = fromJson(copy[field]);
    }
    return copy;
  });
}

function checklistItem(id, label, ok, status, detail, nextAction, owner = "Jarvis") {
  return {
    id,
    label,
    ok: Boolean(ok),
    status,
    detail,
    nextAction,
    owner,
  };
}

function latestBy(items, fields = ["updated_at", "created_at"]) {
  return [...items].sort((a, b) => {
    const aTime = fields.map((field) => a[field]).find(Boolean) || "";
    const bTime = fields.map((field) => b[field]).find(Boolean) || "";
    return String(bTime).localeCompare(String(aTime));
  })[0] || null;
}

function moneyLabel(cents, currency = CONFIG.currency) {
  const amount = Math.max(0, Math.round(Number(cents) || 0));
  const dollars = amount / 100;
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency,
    minimumFractionDigits: amount % 100 === 0 ? 0 : 2,
    maximumFractionDigits: amount % 100 === 0 ? 0 : 2,
  }).format(dollars);
}

function latestTeamDrill(workflows) {
  const teamWorkflows = workflows
    .filter((workflow) => workflow.type === "agent_workbench_team_proof")
    .filter((workflow) => workflow.metadata?.teamProofSummary?.schema === "jarvis_agent_team_drill_summary_v1");
  const workflow = latestBy(teamWorkflows);
  if (!workflow) return null;
  const summary = workflow.metadata.teamProofSummary;
  return {
    workflowId: workflow.id,
    title: workflow.title,
    status: workflow.status,
    updatedAt: workflow.updated_at,
    teamName: summary.teamName || "AI Team",
    workerCount: Number(summary.workerCount || 0),
    passedWorkers: Number(summary.passedWorkers || 0),
    failedWorkers: Number(summary.failedWorkers || 0),
    actualCostCents: Number(summary.actualCostCents || 0),
    summary: summary.operatorSummary || "",
    nextAction: summary.nextAction || "",
    comparisonRequest: summary.liveComparisonRequest || null,
  };
}

function isLiveComparisonApproval(approval) {
  return approval.scope === "live_ai_worker_spend"
    && LIVE_COMPARISON_SOURCE_TYPES.has(approval.payload?.comparisonSource?.type);
}

function comparisonRequestLabel(request) {
  if (!request) return "Selected worker";
  return request.workerName || request.worker_name || request.protectedWorkerName || request.agentId || "Selected worker";
}

function actualSpendCents({ costs, modelCalls, agentRuns }) {
  const actualCostStatuses = new Set(["actual", "completed", "incurred", "paid", "spent", "recorded"]);
  const ledgerActual = costs
    .filter((cost) => actualCostStatuses.has(String(cost.status || "").toLowerCase()))
    .reduce((sum, cost) => sum + Number(cost.amount_cents || 0), 0);
  const modelActual = modelCalls.reduce((sum, call) => sum + Number(call.actual_cost_cents || 0), 0);
  const agentActual = agentRuns.reduce((sum, runRecord) => sum + Number(runRecord.actual_cost_cents || 0), 0);
  return ledgerActual + modelActual + agentActual;
}

function getPreOpenAiReadinessState(db, context = {}) {
  const workbench = context.agentWorkbench || getAgentWorkbenchState(db);
  const toolPolicy = context.agentToolPolicy || getAgentToolPolicyState(db);
  const agentPlaybooks = context.agentPlaybooks || getAgentPlaybooksState(db, {
    agentWorkbench: workbench,
    agentToolPolicy: toolPolicy,
  });
  const liveReadiness = context.liveAiWorkerReadiness || getLiveAiWorkerReadiness(db);
  const workflows = parseRows(
    all(db, "SELECT id, type, title, status, metadata, created_at, updated_at FROM workflows ORDER BY updated_at DESC"),
    ["metadata"],
  );
  const approvals = parseRows(all(db, "SELECT * FROM approvals ORDER BY requested_at DESC"), ["payload"]);
  const tasks = parseRows(all(db, "SELECT * FROM tasks ORDER BY updated_at DESC"));
  const costs = parseRows(all(db, "SELECT * FROM costs ORDER BY occurred_at DESC"));
  const modelCalls = parseRows(all(db, "SELECT * FROM model_calls ORDER BY created_at DESC"));
  const agentRuns = parseRows(all(db, "SELECT * FROM agent_runs ORDER BY started_at DESC LIMIT 500"));
  const events = parseRows(all(db, "SELECT * FROM events ORDER BY id DESC LIMIT 200"));
  const modelComparisonPackets = parseRows(
    all(db, "SELECT * FROM agent_model_comparison_packets ORDER BY created_at DESC"),
    ["protected_baseline", "comparison_plan", "eval_plan", "operator_decision", "hard_stops", "metadata"],
  );

  const workers = Number(workbench.metrics?.workers || 0);
  const evalCases = Number(workbench.metrics?.evalCases || 0);
  const evalDatasets = Number(workbench.metrics?.evalDatasets || 0);
  const protectedProofs = Number(workbench.metrics?.dryRunProven || 0);
  const toolHardStops = Number(toolPolicy.metrics?.hardStopTools || 0);
  const assignedHardStops = Number(toolPolicy.metrics?.assignedHardStops || 0);
  const approvalTools = Number(toolPolicy.metrics?.approvalTools || 0);
  const playbookRehearsals = Number(agentPlaybooks.summary?.rehearsals || 0);
  const passedPlaybookRehearsals = Number(agentPlaybooks.summary?.passedRehearsals || 0);
  const rehearsedPlaybookWorkers = Number(agentPlaybooks.summary?.rehearsedWorkers || 0);
  const playbookRehearsalSpendCents = Number(agentPlaybooks.summary?.actualCostCents || 0);
  const nextPlaybookRehearsal = (agentPlaybooks.playbooks || []).find((playbook) => playbook.rehearsalStatus !== "rehearsed")
    || (agentPlaybooks.playbooks || [])[0]
    || null;
  const teamDrill = latestTeamDrill(workflows);
  const teamDrillPassed = Boolean(teamDrill && teamDrill.workerCount > 0 && teamDrill.passedWorkers === teamDrill.workerCount && teamDrill.failedWorkers === 0);
  const coreTeamCovered = Boolean(teamDrill && teamDrill.workerCount >= Math.min(workers || 11, 11));
  const latestModelComparisonPacket = modelComparisonPackets[0] || null;
  const liveComparisonRequest = teamDrill?.comparisonRequest || latestModelComparisonPacket || null;
  const liveComparisonApprovals = approvals.filter(isLiveComparisonApproval);
  const pendingLiveComparisonApprovals = liveComparisonApprovals.filter((approval) => approval.status === "pending");
  const approvedLiveComparisonApprovals = liveComparisonApprovals.filter((approval) => approval.status === "approved");
  const liveWorkerTasks = tasks.filter((task) => task.kind === "live_ai_worker_execution");
  const actualSpend = actualSpendCents({ costs, modelCalls, agentRuns });
  const noSpendConfirmed = actualSpend === 0;
  const liveComparisonRequested = Boolean(liveComparisonRequest || liveComparisonApprovals.length || modelComparisonPackets.length);
  const providerSetupReady = Boolean(
    liveReadiness.credentialsConfigured
    && liveReadiness.liveFlagEnabled
    && liveReadiness.adapterReady
    && liveReadiness.budgetReady
  );
  const credentialsLocked = !liveReadiness.credentialsConfigured;
  const liveFlagLocked = !liveReadiness.liveFlagEnabled;
  const contractsReady = workers > 0 && evalCases >= workers && evalDatasets >= workers;
  const workerRegistryReady = workers > 0;
  const toolControlsReady = toolPolicy.status === "ready" && assignedHardStops === 0 && approvalTools > 0 && toolHardStops > 0;
  const protectedProofReady = protectedProofs > 0;
  const playbookRehearsalReady = passedPlaybookRehearsals > 0 && playbookRehearsalSpendCents === 0;
  const approvalQueued = pendingLiveComparisonApprovals.length > 0 || approvedLiveComparisonApprovals.length > 0;
  const foundationReady = Boolean(
    workerRegistryReady
    && contractsReady
    && toolControlsReady
    && protectedProofReady
    && teamDrillPassed
    && playbookRehearsalReady
    && liveComparisonRequested
    && approvalQueued
    && noSpendConfirmed
  );

  let status = "needs_team_drill";
  let summary = "The AI Team foundation is registered, but it still needs a protected team drill before any model connection is worth discussing.";
  if (!workerRegistryReady || !contractsReady || !toolControlsReady) {
    status = "needs_worker_controls";
    summary = "Worker contracts, repeatable checks, or tool controls still need tightening before model setup.";
  } else if (!teamDrillPassed) {
    status = "needs_team_drill";
    summary = "Run the protected AI Team drill so the crew proves useful output without live models or spend.";
  } else if (!playbookRehearsalReady) {
    status = "needs_playbook_rehearsal";
    summary = "The team drill passed; now run a protected worker playbook rehearsal so at least one worker proves its operating playbook against a manual market-test context.";
  } else if (!liveComparisonRequested) {
    status = "needs_live_comparison_request";
    summary = "The protected team drill passed; prepare one capped live-comparison request so the later OpenAI test has a baseline.";
  } else if (!approvalQueued) {
    status = "needs_operator_approval";
    summary = "The comparison request exists, but the operator decision gate is not queued yet.";
  } else if (!providerSetupReady) {
    status = "ready_before_model_connection";
    summary = "The local foundation is as far as it can safely go before OpenAI setup: proof exists, a capped comparison is queued, spend is still zero, and provider gates remain locked.";
  } else if (pendingLiveComparisonApprovals.length) {
    status = "ready_for_approved_live_comparison";
    summary = "Provider setup is ready, but the capped live comparison still needs your approval before any spend.";
  } else {
    status = "live_comparison_can_run";
    summary = "The next step is one approved capped live comparison, with the protected proof as the baseline.";
  }

  const checklist = [
    checklistItem(
      "workers_registered",
      "AI workers registered",
      workerRegistryReady,
      workerRegistryReady ? "ready" : "blocked",
      workerRegistryReady ? `${workers} specialist workers are registered.` : "No AI Team workers are available.",
      "Keep the worker registry current before assigning work.",
    ),
    checklistItem(
      "contracts_and_evals",
      "Contracts and checks",
      contractsReady,
      contractsReady ? "ready" : "needs_test_case",
      `${evalCases} active worker check${evalCases === 1 ? "" : "s"} across ${evalDatasets} dataset${evalDatasets === 1 ? "" : "s"}.`,
      "Each worker needs an output contract and repeatable quality check.",
    ),
    checklistItem(
      "tool_controls",
      "Tool controls",
      toolControlsReady,
      toolControlsReady ? "ready" : "needs_review",
      `${approvalTools} approval-controlled tool${approvalTools === 1 ? "" : "s"}, ${toolHardStops} locked action${toolHardStops === 1 ? "" : "s"}, ${assignedHardStops} unsafe assignment${assignedHardStops === 1 ? "" : "s"}.`,
      "Keep live, spend, publishing, account, customer, and legal actions approval-gated or locked.",
    ),
    checklistItem(
      "protected_worker_proofs",
      "Protected worker proof",
      protectedProofReady,
      protectedProofReady ? "ready" : "needs_protected_proof",
      `${protectedProofs}/${workers || 0} worker${workers === 1 ? "" : "s"} have passed protected output checks.`,
      "Run protected worker proofs until the core crew has evidence.",
    ),
    checklistItem(
      "team_drill_summary",
      "Team drill summary",
      teamDrillPassed,
      teamDrillPassed ? "ready" : "needs_team_drill",
      teamDrill ? `${teamDrill.passedWorkers}/${teamDrill.workerCount} workers passed; ${moneyLabel(teamDrill.actualCostCents)} actual spend.` : "No Chief-of-Staff team summary exists yet.",
      "Run the AI Team drill and review the Chief-of-Staff summary.",
    ),
    checklistItem(
      "core_team_coverage",
      "Core crew coverage",
      coreTeamCovered,
      coreTeamCovered ? "ready" : "needs_review",
      teamDrill ? `${teamDrill.workerCount}/${workers || 0} workers were included in the latest team drill.` : "Run the full core team drill when ready.",
      "Use the full digital-product crew before trusting the team as an operating unit.",
    ),
    checklistItem(
      "playbook_rehearsal",
      "Playbook rehearsal",
      playbookRehearsalReady,
      playbookRehearsalReady ? "ready" : "needs_rehearsal",
      playbookRehearsalReady
        ? `${passedPlaybookRehearsals}/${playbookRehearsals} protected playbook rehearsal${playbookRehearsals === 1 ? "" : "s"} passed with ${moneyLabel(playbookRehearsalSpendCents)} spend.`
        : "No protected worker playbook has passed a rehearsal against the manual market-test queue yet.",
      nextPlaybookRehearsal
        ? `Run ${nextPlaybookRehearsal.name} through a protected playbook rehearsal.`
        : "Run one protected worker playbook rehearsal before model setup.",
    ),
    checklistItem(
      "live_comparison_request",
      "Capped comparison request",
      liveComparisonRequested,
      liveComparisonRequested ? "ready" : "needs_live_comparison_request",
      liveComparisonRequest
        ? `${comparisonRequestLabel(liveComparisonRequest)} has a capped comparison packet prepared.`
        : "No live comparison request has been prepared from the protected proof.",
      "Prepare one capped comparison packet from a ready worker pack or team summary.",
    ),
    checklistItem(
      "operator_decision_gate",
      "Your decision gate",
      approvalQueued,
      pendingLiveComparisonApprovals.length ? "waiting_approval" : approvedLiveComparisonApprovals.length ? "approved" : "needs_approval",
      pendingLiveComparisonApprovals.length
        ? `${pendingLiveComparisonApprovals.length} capped comparison decision${pendingLiveComparisonApprovals.length === 1 ? "" : "s"} waiting.`
        : approvedLiveComparisonApprovals.length
          ? `${approvedLiveComparisonApprovals.length} capped comparison decision${approvedLiveComparisonApprovals.length === 1 ? "" : "s"} approved.`
          : "No comparison approval is queued yet.",
      "Review, deny, or request changes before any live model work can run.",
      "Operator",
    ),
    checklistItem(
      "zero_spend",
      "Zero spend confirmed",
      noSpendConfirmed,
      noSpendConfirmed ? "ready" : "needs_review",
      `${moneyLabel(actualSpend)} actual model or worker spend recorded.`,
      "Investigate any real spend before connecting live providers.",
    ),
    checklistItem(
      "openai_credentials",
      "OpenAI key",
      liveReadiness.credentialsConfigured,
      liveReadiness.credentialsConfigured ? "configured" : "not_configured",
      liveReadiness.credentialsConfigured ? "OpenAI credentials are available to this runtime." : "OpenAI credentials are not connected yet.",
      "Connect credentials later, outside the repo, only after this foundation is accepted.",
      "Operator",
    ),
    checklistItem(
      "live_model_flag",
      "Live model switch",
      liveReadiness.liveFlagEnabled,
      liveReadiness.liveFlagEnabled ? "enabled" : "disabled",
      liveReadiness.liveFlagEnabled ? "Live worker execution is enabled." : "Live worker execution is intentionally off.",
      "Enable live models only for an approved capped comparison.",
      "Operator",
    ),
    checklistItem(
      "adapter_and_budget",
      "SDK runner and budget",
      liveReadiness.adapterReady && liveReadiness.budgetReady,
      liveReadiness.adapterReady && liveReadiness.budgetReady ? "ready" : "blocked",
      `${liveReadiness.adapterReady ? "Agents SDK runner available" : "Agents SDK runner blocked"}; ${moneyLabel(liveReadiness.remainingBudgetCents || 0)} monthly budget room.`,
      "Keep the cap tiny for the first comparison.",
    ),
  ];

  const providerGates = [
    {
      id: "credentials",
      label: "OpenAI credentials",
      ok: Boolean(liveReadiness.credentialsConfigured),
      detail: liveReadiness.credentialsConfigured ? "Connected." : "Not connected yet, by design.",
    },
    {
      id: "live_flag",
      label: "Live model switch",
      ok: Boolean(liveReadiness.liveFlagEnabled),
      detail: liveReadiness.liveFlagEnabled ? "Enabled." : "Off until you approve model use.",
    },
    {
      id: "agent_runtime",
      label: "Agents SDK runner",
      ok: Boolean(liveReadiness.adapterReady),
      detail: liveReadiness.adapterReady ? "Available." : "SDK runner is not ready.",
    },
    {
      id: "budget",
      label: "Budget room",
      ok: Boolean(liveReadiness.budgetReady),
      detail: liveReadiness.budgetReady ? "Tiny capped test fits the budget." : "Budget cap needs review.",
    },
  ];

  const nextSafeActions = [];
  if (!teamDrillPassed) {
    nextSafeActions.push({
      id: "run_team_drill",
      label: "Run Team Drill",
      detail: "Prove the core workers together in protected mode.",
      action: "run-agent-team-proof",
      kind: "dashboard_action",
    });
  } else if (!playbookRehearsalReady) {
    nextSafeActions.push({
      id: "run_playbook_rehearsal",
      label: "Run Playbook Rehearsal",
      detail: nextPlaybookRehearsal
        ? `Practice ${nextPlaybookRehearsal.name} against the current manual market-test queue with no spend.`
        : "Practice one worker playbook with no live models, spend, publishing, or customer contact.",
      action: "run-agent-playbook-rehearsal",
      agentId: nextPlaybookRehearsal?.agentId || "demand_validator",
      kind: "dashboard_action",
    });
  } else if (!liveComparisonRequested) {
    nextSafeActions.push({
      id: "prepare_live_comparison",
      label: "Prepare Live Comparison",
      detail: "Queue one capped comparison request without connecting OpenAI.",
      action: "request-workbench-live-comparison",
      workflowId: teamDrill.workflowId,
      kind: "dashboard_action",
    });
  } else if (pendingLiveComparisonApprovals.length) {
    nextSafeActions.push({
      id: "review_comparison_approval",
      label: "Review Decision",
      detail: "Approve, deny, or request changes to the capped comparison request.",
      approvalId: pendingLiveComparisonApprovals[0].id,
      kind: "operator_decision",
    });
  }
  if (foundationReady && credentialsLocked) {
    nextSafeActions.push({
      id: "connect_key_later",
      label: "Connect OpenAI Later",
      detail: "When you are ready, add the key outside the repo and restart the runtime.",
      kind: "provider_setup",
    });
  }
  if (foundationReady && liveFlagLocked) {
    nextSafeActions.push({
      id: "enable_live_models_later",
      label: "Enable Live Models Later",
      detail: "Turn on the live model switch only for an approved capped comparison.",
      kind: "provider_setup",
    });
  }

  return {
    schema: PRE_OPENAI_SCHEMA,
    status,
    summary,
    foundationReady,
    providerSetupReady,
    noSpendConfirmed,
    latestTeamDrill: teamDrill,
    metrics: {
      workers,
      evalCases,
      protectedProofs,
      playbookRehearsals,
      passedPlaybookRehearsals,
      rehearsedPlaybookWorkers,
      playbookRehearsalSpendCents,
      teamDrillPassed: teamDrillPassed ? 1 : 0,
      pendingLiveComparisons: pendingLiveComparisonApprovals.length,
      approvedLiveComparisons: approvedLiveComparisonApprovals.length,
      modelComparisonPackets: modelComparisonPackets.length,
      liveWorkerRequests: liveWorkerTasks.length,
      blockedLiveWorkerTasks: liveWorkerTasks.filter((task) => task.status === "blocked").length,
      completedLiveRuns: Number(liveReadiness.completedLiveRuns || 0),
      actualSpendCents: actualSpend,
      approvalControlledTools: approvalTools,
      lockedActions: toolHardStops,
      unsafeToolAssignments: assignedHardStops,
      providerGatesOpen: providerGates.filter((gate) => gate.ok).length,
      providerGatesTotal: providerGates.length,
    },
    checklist,
    providerGates,
    blockers: [
      ...(!foundationReady ? checklist.filter((item) => !item.ok && !["openai_credentials", "live_model_flag", "adapter_and_budget"].includes(item.id)).map((item) => item.detail) : []),
      ...(liveReadiness.blockers || []),
    ],
    nextSafeActions,
    recentEvidence: events
      .filter((event) => ["agent.team_drill_summary_ready", "agent.playbook_rehearsal_queued", "agent.live_comparison_requested", "agent.model_comparison_packet_prepared", "spend_approval.requested"].includes(event.type))
      .slice(0, 6)
      .map((event) => ({
        type: event.type,
        message: event.message,
        createdAt: event.created_at,
      })),
  };
}

module.exports = {
  getPreOpenAiReadinessState,
  PRE_OPENAI_SCHEMA,
};
