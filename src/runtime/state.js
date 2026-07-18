const { all, fromJson, get } = require("../db");
const CONFIG = require("../config");
const { getLiveAiWorkerReadiness } = require("./live-ai-worker-readiness");
const { getLiveResearchReadiness } = require("./live-research-readiness");
const { buildCommercialBrain } = require("./commercial-brain");
const { getAiTeamState } = require("./ai-team");
const { getAgentWorkbenchState } = require("./agent-workbench");
const { getAgentToolGateState } = require("./agent-tool-gate");
const { getAgentToolPolicyState } = require("./agent-tools");
const { getAgentOperatingBriefsState } = require("./agent-operating-briefs");
const { getAgentPlaybooksState } = require("./agent-playbooks");
const { getAgentModelReadinessState } = require("./agent-model-readiness");
const { getPreOpenAiReadinessState } = require("./pre-openai-readiness");
const { buildDecisionInbox } = require("./decision-inbox");
const { buildManualMarketCockpit } = require("./manual-market-cockpit");
const { buildAiPilotReview } = require("./ai-pilot-review");
const { buildOperatorCockpit } = require("./operator-cockpit");

function parseRows(rows, fields = ["metadata", "payload", "result"]) {
  return rows.map((row) => {
    const copy = { ...row };
    for (const field of fields) {
      if (field in copy) copy[field] = fromJson(copy[field]);
    }
    return copy;
  });
}

function getSettings(db) {
  const rows = all(db, "SELECT key, value FROM settings ORDER BY key");
  return Object.fromEntries(rows.map((row) => [row.key, fromJson(row.value)]));
}

function centsThisMonth(db, table) {
  const prefix = new Date().toISOString().slice(0, 7);
  const row = get(
    db,
    `SELECT COALESCE(SUM(amount_cents), 0) AS total
     FROM ${table}
     WHERE occurred_at LIKE ?`,
    [`${prefix}%`],
  );
  return row ? row.total : 0;
}

function computeApprovalStats(approvals) {
  const decided = approvals.filter((approval) => ["approved", "rejected", "needs_changes"].includes(approval.status));
  const approved = decided.filter((approval) => approval.status === "approved");
  const pending = approvals.filter((approval) => approval.status === "pending");
  const rate = decided.length === 0 ? 0 : approved.length / decided.length;
  return {
    decided: decided.length,
    approved: approved.length,
    pending: pending.length,
    firstPassApprovalRate: rate,
    targetRate: CONFIG.targetFirstPassApprovalRate,
    promotionMinimum: CONFIG.approvalPromotionMinimum,
    autopilotReady: decided.length >= CONFIG.approvalPromotionMinimum && rate >= CONFIG.targetFirstPassApprovalRate,
  };
}

function computeWorkflowStats(workflows, tasks) {
  return {
    active: workflows.filter((workflow) => !["completed", "archived"].includes(workflow.status)).length,
    blocked: workflows.filter((workflow) => workflow.status.includes("blocked")).length,
    failedTasks: tasks.filter((task) => task.status === "failed").length,
    queuedTasks: tasks.filter((task) => task.status === "queued").length,
  };
}

function getDashboardState(db) {
  const settings = getSettings(db);
  const ventures = parseRows(all(db, "SELECT * FROM ventures ORDER BY created_at DESC"));
  const workflows = parseRows(
    all(
      db,
      `SELECT workflows.*, ventures.name AS venture_name
       FROM workflows
       LEFT JOIN ventures ON ventures.id = workflows.venture_id
       ORDER BY priority ASC, updated_at DESC`,
    ),
  );
  const workflowRuns = parseRows(all(db, "SELECT * FROM workflow_runs ORDER BY started_at DESC LIMIT 80"), ["metadata"]);
  const monitorRuns = parseRows(all(db, "SELECT * FROM monitor_runs ORDER BY started_at DESC LIMIT 50"), ["metadata"]);
  const monitorFindings = parseRows(all(db, "SELECT * FROM monitor_findings ORDER BY created_at DESC LIMIT 120"), ["metadata"]);
  const schedulerJobs = parseRows(all(db, "SELECT * FROM scheduler_jobs ORDER BY priority ASC, name ASC"), ["metadata"]);
  const schedulerRuns = parseRows(all(db, "SELECT * FROM scheduler_runs ORDER BY started_at DESC LIMIT 80"), ["result", "metadata"]);
  const ventureScorecards = parseRows(
    all(db, "SELECT * FROM venture_scorecards ORDER BY updated_at DESC LIMIT 80"),
    ["dimensions", "risks", "next_actions", "metadata"],
  );
  const commands = parseRows(all(db, "SELECT * FROM commands ORDER BY created_at DESC LIMIT 50"));
  const tasks = parseRows(all(db, "SELECT * FROM tasks ORDER BY priority ASC, updated_at DESC"));
  const deliverables = parseRows(all(db, "SELECT * FROM deliverables ORDER BY updated_at DESC LIMIT 80"));
  const modelCalls = parseRows(all(db, "SELECT * FROM model_calls ORDER BY created_at DESC LIMIT 100"));
  const researchRuns = parseRows(all(db, "SELECT * FROM research_runs ORDER BY created_at DESC LIMIT 50"));
  const researchSources = parseRows(all(db, "SELECT * FROM research_sources ORDER BY retrieved_at DESC LIMIT 100"));
  const approvals = parseRows(
    all(db, "SELECT * FROM approvals ORDER BY CASE status WHEN 'pending' THEN 0 ELSE 1 END, requested_at DESC"),
    ["payload"],
  );
  const commercialExperiments = parseRows(all(db, "SELECT * FROM commercial_experiments ORDER BY updated_at DESC LIMIT 80"));
  const commercialBriefs = parseRows(all(db, "SELECT * FROM commercial_briefs ORDER BY updated_at DESC LIMIT 80"));
  const commercialTestCandidates = parseRows(all(db, "SELECT * FROM commercial_test_candidates ORDER BY CASE status WHEN 'planned_test' THEN 0 ELSE 1 END, rank ASC, updated_at DESC LIMIT 120"));
  const commercialResults = parseRows(all(db, "SELECT * FROM commercial_results ORDER BY occurred_at DESC LIMIT 120"));
  const commercialFeedback = parseRows(all(db, "SELECT * FROM commercial_feedback ORDER BY occurred_at DESC LIMIT 120"));
  const commercialLearningCycles = parseRows(all(db, "SELECT * FROM commercial_learning_cycles ORDER BY created_at DESC LIMIT 120"));
  const commercialExecutionPacks = parseRows(all(db, "SELECT * FROM commercial_execution_packs ORDER BY updated_at DESC LIMIT 80"));
  const events = parseRows(all(db, "SELECT * FROM events ORDER BY id DESC LIMIT 80"));
  const costs = parseRows(all(db, "SELECT * FROM costs ORDER BY occurred_at DESC LIMIT 50"));
  const revenue = parseRows(all(db, "SELECT * FROM revenue ORDER BY occurred_at DESC LIMIT 50"));
  const messages = parseRows(all(db, "SELECT * FROM messages ORDER BY created_at DESC LIMIT 50"));
  const notificationOutbox = parseRows(all(db, "SELECT * FROM notification_outbox ORDER BY created_at DESC LIMIT 80"), ["metadata"]);
  const inboundMessages = parseRows(all(db, "SELECT * FROM inbound_messages ORDER BY received_at DESC LIMIT 80"), ["metadata"]);
  const approvalActionTokens = parseRows(all(db, "SELECT * FROM approval_action_tokens ORDER BY created_at DESC LIMIT 120"), ["metadata"]);
  const integrations = parseRows(all(db, "SELECT * FROM integrations ORDER BY name ASC"));
  const aiTeam = getAiTeamState(db);
  const agentToolPolicy = getAgentToolPolicyState(db);
  const agentToolGate = getAgentToolGateState(db);
  const agentWorkbench = getAgentWorkbenchState(db);
  const agentOperatingBriefs = getAgentOperatingBriefsState(db, {
    aiTeam,
    agentWorkbench,
    agentToolPolicy,
  });
  const agentPlaybooks = getAgentPlaybooksState(db, {
    aiTeam,
    agentWorkbench,
    agentToolPolicy,
    agentOperatingBriefs,
  });
  const approvalStats = computeApprovalStats(approvals);
  const workflowStats = computeWorkflowStats(workflows, tasks);
  const budget = settings.budget || { monthlyBudgetCents: CONFIG.monthlyBudgetCents, currency: CONFIG.currency };
  const monthlySpendCents = centsThisMonth(db, "costs");
  const monthlyRevenueCents = centsThisMonth(db, "revenue");
  const openMessages = messages.filter((message) => message.status === "open");
  const liveResearchTasks = tasks.filter((task) => task.kind === "live_market_research");
  const liveAiWorkerTasks = tasks.filter((task) => task.kind === "live_ai_worker_execution");
  const liveResearchReadiness = getLiveResearchReadiness(db);
  const liveAiWorkerReadiness = getLiveAiWorkerReadiness(db);
  const agentModelReadiness = getAgentModelReadinessState(db, {
    aiTeam,
    agentWorkbench,
    agentToolPolicy,
    agentOperatingBriefs,
    agentPlaybooks,
    liveAiWorkerReadiness,
  });
  const preOpenAiReadiness = getPreOpenAiReadinessState(db, {
    agentWorkbench,
    agentToolPolicy,
    agentPlaybooks,
    liveAiWorkerReadiness,
  });
  const health = {
    runtime: "online",
    database: "ready",
    mode: CONFIG.dryRun ? "dry-run" : "live-enabled",
    liveActionsLocked: CONFIG.dryRun,
    integrationsReady: integrations.filter((integration) => integration.health === "ok").length,
    integrationsTotal: integrations.length,
  };
  const metrics = {
    approvalStats,
    workflowStats,
    workflowRuns: {
      total: workflowRuns.length,
      running: workflowRuns.filter((run) => run.status === "running").length,
      completed: workflowRuns.filter((run) => run.completed_at).length,
    },
    budget: {
      monthlyBudgetCents: budget.monthlyBudgetCents || CONFIG.monthlyBudgetCents,
      monthlySpendCents,
      monthlyRevenueCents,
      remainingCents: (budget.monthlyBudgetCents || CONFIG.monthlyBudgetCents) - monthlySpendCents,
    },
    escalations: {
      open: openMessages.length,
      urgent: openMessages.filter((message) => ["urgent", "approval"].includes(message.severity)).length,
    },
    deliverables: {
      total: deliverables.length,
      operatorFacing: deliverables.filter((deliverable) => deliverable.audience === "operator").length,
      planned: deliverables.filter((deliverable) => deliverable.status === "planned").length,
    },
    research: {
      runs: researchRuns.length,
      needsLiveResearch: researchRuns.filter((run) => run.status === "needs_live_research").length,
      liveResearchRequests: liveResearchTasks.length,
      blockedLiveResearch: liveResearchTasks.filter((task) => task.status === "blocked").length,
      providerReady: liveResearchReadiness.ready,
      readiness: liveResearchReadiness,
      sources: researchSources.length,
    },
    modelCalls: {
      total: modelCalls.length,
      estimatedCostCents: modelCalls.reduce((sum, call) => sum + Number(call.estimated_cost_cents || 0), 0),
      actualCostCents: modelCalls.reduce((sum, call) => sum + Number(call.actual_cost_cents || 0), 0),
      dryRun: modelCalls.filter((call) => call.mode === "dry-run").length,
    },
    aiTeam: {
      ...aiTeam.metrics,
      workbenchReadyAfterSetup: agentWorkbench.metrics.readyAfterSetup,
      workbenchLiveTested: agentWorkbench.metrics.liveTested,
      workbenchEvalCases: agentWorkbench.metrics.evalCases,
      toolPolicyTools: agentToolPolicy.metrics.tools,
      toolPolicyApprovalTools: agentToolPolicy.metrics.approvalTools,
      toolPolicyHardStops: agentToolPolicy.metrics.hardStopTools,
      toolGateInvocations: agentToolGate.metrics.invocations,
      toolGateBlocked: agentToolGate.metrics.blocked,
      toolGateApprovalRequired: agentToolGate.metrics.approvalRequired,
      operatingBriefsReady: agentOperatingBriefs.summary.complete,
      operatingBriefsTotal: agentOperatingBriefs.summary.total,
      playbooksReady: agentPlaybooks.summary.ready,
      playbooksTotal: agentPlaybooks.summary.total,
      playbookRehearsals: agentPlaybooks.summary.rehearsals,
      playbookRehearsalsPassed: agentPlaybooks.summary.passedRehearsals,
      playbookWorkersRehearsed: agentPlaybooks.summary.rehearsedWorkers,
      modelReadinessPacks: agentModelReadiness.summary.total,
      modelReadinessLocalReady: agentModelReadiness.summary.localReady,
      modelReadinessEvalFixtures: agentModelReadiness.summary.evalFixtures,
      modelComparisonPackets: agentModelReadiness.summary.comparisonPackets,
      modelComparisonDecisions: agentModelReadiness.summary.pendingComparisonPackets,
      preOpenAiFoundationReady: preOpenAiReadiness.foundationReady ? 1 : 0,
      preOpenAiProviderGatesOpen: preOpenAiReadiness.metrics.providerGatesOpen,
      preOpenAiProviderGatesTotal: preOpenAiReadiness.metrics.providerGatesTotal,
    },
    aiWorkers: {
      liveWorkerRequests: liveAiWorkerTasks.length,
      blockedLiveWorkers: liveAiWorkerTasks.filter((task) => task.status === "blocked").length,
      providerReady: liveAiWorkerReadiness.ready,
      readiness: liveAiWorkerReadiness,
    },
    notifications: {
      outbox: notificationOutbox.length,
      dryRunOutbox: notificationOutbox.filter((notice) => notice.status === "queued_dry_run").length,
      activeApprovalActions: approvalActionTokens.filter((token) => token.status === "active").length,
      inboundNeedsReview: inboundMessages.filter((message) => message.status === "needs_operator_review").length,
    },
    monitor: {
      runs: monitorRuns.length,
      latestStatus: monitorRuns[0]?.status || "not_run",
      latestSeverity: monitorRuns[0]?.severity || "unknown",
      openFindings: monitorFindings.filter((finding) => finding.status === "open").length,
      criticalFindings: monitorFindings.filter((finding) => finding.severity === "error" && finding.status === "open").length,
    },
    scheduler: {
      jobs: schedulerJobs.length,
      enabled: schedulerJobs.filter((job) => job.status === "enabled").length,
      disabled: schedulerJobs.filter((job) => job.status === "disabled").length,
      locked: schedulerJobs.filter((job) => Boolean(job.locked_at)).length,
      runs: schedulerRuns.length,
      failedRuns: schedulerRuns.filter((runRecord) => runRecord.status === "failed").length,
      latestRunStatus: schedulerRuns[0]?.status || "not_run",
    },
    scorecards: {
      total: ventureScorecards.length,
      researchRequired: ventureScorecards.filter((scorecard) => scorecard.verdict === "research_required").length,
      continue: ventureScorecards.filter((scorecard) => scorecard.verdict === "continue").length,
      latestVerdict: ventureScorecards[0]?.verdict || "not_generated",
      latestScore: ventureScorecards[0]?.total_score || 0,
    },
    commercial: {
      experiments: commercialExperiments.length,
      activeExperiments: commercialExperiments.filter((experiment) => ["running", "measuring"].includes(experiment.status)).length,
      briefs: commercialBriefs.length,
      testCandidates: commercialTestCandidates.length,
      plannedTests: commercialTestCandidates.filter((candidate) => candidate.status === "planned_test").length,
      promotedTests: commercialTestCandidates.filter((candidate) => candidate.status === "promoted").length,
      results: commercialResults.length,
      feedback: commercialFeedback.length,
      learningCycles: commercialLearningCycles.length,
      executionPacks: commercialExecutionPacks.length,
      readyExecutionPacks: commercialExecutionPacks.filter((pack) => pack.status === "ready_to_test").length,
      views: commercialResults.reduce((sum, result) => sum + Number(result.views || 0), 0),
      clicks: commercialResults.reduce((sum, result) => sum + Number(result.clicks || 0), 0),
      leads: commercialResults.reduce((sum, result) => sum + Number(result.leads || 0), 0),
      sales: commercialResults.reduce((sum, result) => sum + Number(result.sales || 0), 0),
      refunds: commercialResults.reduce((sum, result) => sum + Number(result.refunds || 0), 0),
      latestVerdict: commercialLearningCycles[0]?.verdict || "none",
    },
  };
  const commercialBrain = buildCommercialBrain({
    tasks,
    workflows,
    approvals,
    scorecards: ventureScorecards,
    deliverables,
    researchSources,
    costs,
    revenue,
    liveResearchReadiness,
    commercialExperiments,
    commercialBriefs,
    commercialTestCandidates,
    commercialResults,
    commercialFeedback,
    commercialLearningCycles,
    commercialExecutionPacks,
  });
  const decisionInbox = buildDecisionInbox({
    approvals,
    handoffs: aiTeam.handoffs,
    workflows,
    deliverables,
    commercialBrain,
    preOpenAiReadiness,
  });
  metrics.decisionInbox = decisionInbox.metrics;
  const manualMarketCockpit = buildManualMarketCockpit({
    workflows,
    commercialExperiments,
    commercialTestCandidates,
    commercialExecutionPacks,
    commercialResults,
    commercialFeedback,
    commercialLearningCycles,
    handoffs: aiTeam.handoffs,
    runs: aiTeam.runs,
  });
  metrics.manualMarketCockpit = manualMarketCockpit.metrics;
  const aiPilotReview = buildAiPilotReview({
    aiTeam,
    agentWorkbench,
    agentModelReadiness,
    liveAiWorkerReadiness,
    approvals,
    tasks,
    modelCalls,
    costs,
  });
  metrics.aiPilotReview = {
    status: aiPilotReview.status,
    hasLiveOutput: aiPilotReview.status === "live_output_ready_for_review" ? 1 : 0,
    actions: aiPilotReview.actions.length,
  };
  const operatorCockpit = buildOperatorCockpit({
    runtime: {
      health,
      liveResearch: liveResearchReadiness,
      liveAiWorkers: liveAiWorkerReadiness,
    },
    metrics,
    decisionInbox,
    commercialBrain,
    manualMarketCockpit,
    aiPilotReview,
    preOpenAiReadiness,
    liveResearchReadiness,
    liveAiWorkerReadiness,
    commercialTestCandidates,
    commercialExecutionPacks,
    commercialResults,
    commercialLearningCycles,
    messages,
  });
  metrics.operatorCockpit = {
    status: operatorCockpit.status,
    openAlerts: operatorCockpit.risk.openAlerts,
    urgentAlerts: operatorCockpit.risk.urgentAlerts,
  };

  return {
    generatedAt: new Date().toISOString(),
    runtime: {
      name: "Pantheon Control",
      stage: settings.autonomy?.stage || CONFIG.autonomyStage,
      currency: budget.currency || CONFIG.currency,
      health,
      liveResearch: liveResearchReadiness,
      liveAiWorkers: liveAiWorkerReadiness,
    },
    settings,
    ventures,
    commands,
    workflows,
    workflowRuns,
    monitorRuns,
    monitorFindings,
    schedulerJobs,
    schedulerRuns,
    ventureScorecards,
    tasks,
    deliverables,
    modelCalls,
    researchRuns,
    researchSources,
    approvals,
    commercialExperiments,
    commercialBriefs,
    commercialTestCandidates,
    commercialResults,
    commercialFeedback,
    commercialLearningCycles,
    commercialExecutionPacks,
    events,
    costs,
    revenue,
    messages,
    notificationOutbox,
    inboundMessages,
    approvalActionTokens,
    integrations,
    aiTeam: {
      ...aiTeam,
      toolPolicy: agentToolPolicy,
      toolGate: agentToolGate,
      workbench: agentWorkbench,
      operatingBriefs: agentOperatingBriefs,
      playbooks: agentPlaybooks,
      modelReadiness: agentModelReadiness,
    },
    agentWorkbench,
    agentToolPolicy,
    agentToolGate,
    agentOperatingBriefs,
    agentPlaybooks,
    agentModelReadiness,
    preOpenAiReadiness,
    operatorCockpit,
    aiPilotReview,
    decisionInbox,
    manualMarketCockpit,
    commercialBrain,
    metrics,
  };
}

module.exports = {
  getDashboardState,
};
