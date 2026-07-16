const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { decideApproval, decideApprovalByToken } = require("../src/runtime/approvals");
const { processApprovalReply } = require("../src/runtime/approval-replies");
const { runOnce, runUntilBlocked } = require("../src/runtime/orchestrator");
const { getDashboardState } = require("../src/runtime/state");
const { createCommandPlan } = require("../src/runtime/planner");
const { createApp, createRuntime } = require("../src/server");
const { getLiveAiWorkerReadiness } = require("../src/runtime/live-ai-worker-readiness");
const { __setAgentRuntimeSdkRunnerForTests } = require("../src/runtime/agent-runtime");
const { getLiveResearchReadiness } = require("../src/runtime/live-research-readiness");
const { getPreOpenAiReadinessState } = require("../src/runtime/pre-openai-readiness");
const {
  getAgentWorkbenchState,
  queueAgentWorkbenchProof,
  queueAgentWorkbenchProofSuite,
  requestAgentWorkbenchLiveComparison,
} = require("../src/runtime/agent-workbench");
const { getAgentToolGateState, requestAgentToolUse } = require("../src/runtime/agent-tool-gate");
const { getAgentToolPolicyState } = require("../src/runtime/agent-tools");
const { getAgentOperatingBriefsState } = require("../src/runtime/agent-operating-briefs");
const { getAgentPlaybooksState, queueAgentPlaybookRehearsal, queueAgentPlaybookRehearsalSuite } = require("../src/runtime/agent-playbooks");
const { getAgentModelReadinessState, queueAgentModelComparisonPacket, storedComparisonPackets } = require("../src/runtime/agent-model-readiness");
const { recordAiPilotReviewDecision } = require("../src/runtime/ai-pilot-review");
const { runMonitorCycle } = require("../src/runtime/monitor");
const { createLiveAiWorkerSmokeTest, requestLiveAiWorker } = require("../src/runtime/live-ai-workers");
const { createLiveResearchSmokeTest, requestLiveResearch } = require("../src/runtime/live-research");
const { createAgentRun, decideAgentHandoff, findAgentDefinition } = require("../src/runtime/ai-team");
const { ensureSchedulerJobs, runDueSchedulerJobs, runSchedulerJob, setSchedulerJobStatus } = require("../src/runtime/scheduler");
const { recordCommercialFeedback, recordCommercialResult } = require("../src/runtime/commercial-results");
const {
  createResearchToExperimentPlan,
  createResearchToExperimentPlanFromResearch,
  createRevisionPlanFromLearning,
  promoteCandidateToExperiment,
} = require("../src/runtime/research-to-experiment");
const { generateExecutionPack, recordExecutionPackOutcome } = require("../src/runtime/test-execution-pack");
const { upsertWorkflowScorecard } = require("../src/runtime/scorecard");
const { all, get, openDatabase, run, seedDatabase, toJson } = require("../src/db");

function tempDbPath(name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `jarvis-codex-${name}-`));
  return path.join(dir, "runtime.sqlite");
}

function seededDb(name) {
  const db = openDatabase(tempDbPath(name));
  seedDatabase(db, { includeDemoProof: true });
  return db;
}

test("seedDatabase creates durable runtime state", () => {
  const db = seededDb("seed");
  const state = getDashboardState(db);

  assert.equal(state.runtime.name, "Jarvis-Codex Control");
  assert.equal(state.runtime.stage, 1);
  assert.equal(state.workflows.length, 1);
  assert.equal(state.approvals.length, 1);
  assert.equal(state.approvals[0].status, "pending");
  assert.equal(state.deliverables.length, 2);
  assert.equal(state.metrics.deliverables.operatorFacing, 2);
  assert.equal(state.metrics.budget.monthlyBudgetCents, 10000);
  assert.equal(state.runtime.health.liveActionsLocked, true);
  assert.ok(state.commercialBrain);
  assert.ok(state.commercialBrain.moneyMoves.length >= 1);
  assert.equal(state.commercialBrain.improvementLoop.model, "hypothesis_action_result_improvement");
  assert.ok(state.decisionInbox);
  assert.equal(state.decisionInbox.schema, "jarvis_operator_decision_inbox_v1");
  assert.equal(state.decisionInbox.status, "decisions_waiting");
  assert.ok(state.decisionInbox.items.some((item) => item.approvalId === "appr-digital-product-dry-run"));
  assert.equal(state.decisionInbox.metrics.approvals >= 1, true);
  assert.ok(state.manualMarketCockpit);
  assert.equal(state.manualMarketCockpit.schema, "jarvis_manual_market_test_cockpit_v1");
  assert.equal(state.manualMarketCockpit.status, "needs_test_options");
  assert.equal(state.metrics.manualMarketCockpit.items, 0);
  assert.equal(state.operatorCockpit.schema, "jarvis_operator_cockpit_v1");
  assert.equal(state.operatorCockpit.status, "decision_waiting");
  assert.equal(state.operatorCockpit.aiTeam.worker, "Demand Validator");
  assert.equal(state.aiPilotReview.schema, "jarvis_ai_pilot_review_v1");
  assert.equal(state.aiPilotReview.workerName, "Demand Validator");
  assert.equal(state.aiPilotReview.status, "needs_protected_baseline");
  assert.ok(state.aiTeam);
  assert.ok(state.aiTeam.definitions.length >= 10);
  assert.equal(state.metrics.aiTeam.readyWorkers, state.aiTeam.definitions.length);
  assert.ok(state.aiTeam.definitions.some((worker) => worker.id === "chief_of_staff"));
  assert.ok(state.aiTeam.definitions.some((worker) => worker.id === "demand_validator"));
  assert.ok(state.aiTeam.hardStops.includes("external publishing"));
  assert.ok(state.aiTeam.workbench);
  assert.ok(state.aiTeam.toolPolicy);
  assert.ok(state.aiTeam.operatingBriefs);
  assert.equal(state.aiTeam.operatingBriefs.schema, "jarvis_agent_operating_briefs_v1");
  assert.equal(state.aiTeam.operatingBriefs.summary.complete, state.aiTeam.definitions.length);
  assert.equal(state.aiTeam.operatingBriefs.byAgent.demand_validator.hardStops.includes("live research spend"), true);
  assert.equal(state.metrics.aiTeam.operatingBriefsReady, state.aiTeam.definitions.length);
  assert.ok(state.aiTeam.playbooks);
  assert.equal(state.aiTeam.playbooks.schema, "jarvis_agent_playbooks_v1");
  assert.equal(state.aiTeam.playbooks.summary.ready, state.aiTeam.definitions.length);
  assert.equal(state.metrics.aiTeam.playbooksReady, state.aiTeam.definitions.length);
  assert.equal(state.agentToolPolicy.status, "ready");
  assert.equal(state.metrics.aiTeam.toolPolicyTools >= 30, true);
  assert.equal(state.metrics.aiTeam.toolPolicyHardStops >= 10, true);
  assert.equal(state.agentToolPolicy.metrics.assignedHardStops, 0);
  assert.equal(state.agentWorkbench.metrics.workers, state.aiTeam.definitions.length);
  assert.equal(state.agentWorkbench.metrics.evalDatasets, state.aiTeam.definitions.length);
  assert.equal(state.agentWorkbench.metrics.evalCases, state.aiTeam.definitions.length);
  assert.equal(state.agentWorkbench.byAgent.demand_validator.dataset.activeCases, 1);
  assert.equal(state.agentWorkbench.byAgent.demand_validator.status, "needs_dry_run_proof");

  db.close();
});

test("agent playbooks define protected local execution before model connection", () => {
  const db = seededDb("agent-playbooks");
  const playbooks = getAgentPlaybooksState(db);
  const distributor = playbooks.byAgent.distribution_operator;
  const growth = playbooks.byAgent.growth_analyst;
  const finance = playbooks.byAgent.finance_analyst;

  assert.equal(playbooks.schema, "jarvis_agent_playbooks_v1");
  assert.equal(playbooks.status, "ready");
  assert.equal(playbooks.summary.total, 11);
  assert.equal(playbooks.summary.ready, 11);
  assert.ok(playbooks.summary.summary.includes("before OpenAI model connection"));
  assert.ok(distributor.protectedSteps.some((step) => step.includes("manual run sheet")));
  assert.ok(distributor.stopRule.includes("sending"));
  assert.ok(growth.evidenceCaptured.includes("learning"));
  assert.ok(growth.stopRule.includes("autopilot promotion"));
  assert.ok(finance.successMetric.includes("cost cap"));
  assert.ok(["Keep Protected", "Prepare Capped Comparison"].includes(finance.operatorControl.live));

  db.close();
});

test("agent playbook rehearsal runs protected worker proof against manual market context", async () => {
  const previousKey = process.env.OPENAI_API_KEY;
  const previousLiveModels = process.env.JARVIS_ENABLE_LIVE_MODELS;
  delete process.env.OPENAI_API_KEY;
  delete process.env.JARVIS_ENABLE_LIVE_MODELS;

  const db = seededDb("agent-playbook-rehearsal");
  try {
    const plan = createResearchToExperimentPlan(db, {
      idea: "Client handover checklist templates for boutique agencies.",
      buyer: "Boutique digital agencies",
      problem: "Project handovers are inconsistent and create avoidable support work.",
      offer: "Client handover checklist template pack",
      channel: "Agency owner LinkedIn posts",
      priceCents: 2900,
    });
    const promoted = promoteCandidateToExperiment(db, plan.recommended.id, { promotedBy: "test" });
    const packResult = generateExecutionPack(db, { experimentId: promoted.experiment.id, source: "test" });

    const queued = queueAgentPlaybookRehearsal(db, "distribution_operator");
    assert.equal(queued.worker.id, "distribution_operator");
    assert.equal(queued.playbook.agentId, "distribution_operator");
    assert.equal(queued.marketContext.sourceType, "execution_pack");
    assert.equal(queued.marketContext.executionPackId, packResult.pack.id);
    assert.equal(queued.task.title, "Distribution Agent playbook rehearsal");

    const taskBeforeRun = get(db, "SELECT * FROM tasks WHERE id = ?", [queued.task.id]);
    const taskPayload = JSON.parse(taskBeforeRun.payload);
    assert.equal(taskPayload.playbookRehearsal, true);
    assert.equal(taskPayload.manualMarketContext.executionPackId, packResult.pack.id);
    assert.ok(taskPayload.playbook.protectedSteps.some((step) => step.includes("manual run sheet")));

    const completed = await runOnce(db, { workflowId: queued.workflow.id });
    assert.equal(completed.status, "completed");
    assert.equal(completed.result.taskKind, "workbench_proof");
    assert.equal(completed.result.aiTeam.agentId, "distribution_operator");
    assert.equal(completed.result.aiTeam.evalStatus, "passed");
    assert.equal(completed.result.cost.actualCents, 0);
    assert.equal(completed.result.output.businessDecision.externalActionsAllowed, false);

    const state = getDashboardState(db);
    const playbookState = state.agentPlaybooks;
    const distribution = playbookState.byAgent.distribution_operator;
    const rehearsalEvent = state.events.find((event) => event.type === "agent.playbook_rehearsal_queued");
    const workflow = state.workflows.find((item) => item.id === queued.workflow.id);

    assert.equal(playbookState.summary.rehearsals, 1);
    assert.equal(playbookState.summary.completedRehearsals, 1);
    assert.equal(playbookState.summary.passedRehearsals, 1);
    assert.equal(playbookState.summary.actualCostCents, 0);
    assert.equal(distribution.rehearsalStatus, "rehearsed");
    assert.equal(distribution.latestRehearsal.context.executionPackId, packResult.pack.id);
    assert.equal(distribution.latestRehearsal.run.evalStatus, "passed");
    assert.equal(workflow.type, "agent_playbook_rehearsal");
    assert.equal(workflow.metadata.playbookRehearsal, true);
    assert.equal(workflow.metadata.manualMarketContext.executionPackId, packResult.pack.id);
    assert.ok(rehearsalEvent);
    assert.equal(rehearsalEvent.entity_id, queued.task.id);
  } finally {
    db.close();
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousKey;
    if (previousLiveModels === undefined) delete process.env.JARVIS_ENABLE_LIVE_MODELS;
    else process.env.JARVIS_ENABLE_LIVE_MODELS = previousLiveModels;
  }
});

test("agent playbook rehearsal suite runs selected workers without model connection", async () => {
  const previousKey = process.env.OPENAI_API_KEY;
  const previousLiveModels = process.env.JARVIS_ENABLE_LIVE_MODELS;
  delete process.env.OPENAI_API_KEY;
  delete process.env.JARVIS_ENABLE_LIVE_MODELS;

  const db = seededDb("agent-playbook-rehearsal-suite");
  try {
    const queued = queueAgentPlaybookRehearsalSuite(db, {
      teamName: "Digital product playbook rehearsal",
      agentIds: ["chief_of_staff", "demand_validator", "offer_architect"],
      subject: "Compact desk cable template",
      buyer: "Home-office workers",
      problem: "They want a tidier desk without buying a full cable-management kit.",
      offer: "A printable cable-planning template and shopping checklist.",
      channel: "Digital Product",
    });
    assert.equal(queued.team.workerCount, 3);
    assert.equal(queued.tasks.length, 3);
    assert.equal(queued.workflow.title, "AI Team - Digital product playbook rehearsal");
    assert.ok(queued.tasks.every((task) => task.title.includes("playbook rehearsal")));

    const taskBeforeRun = get(db, "SELECT * FROM tasks WHERE id = ?", [queued.tasks[0].id]);
    const taskPayload = JSON.parse(taskBeforeRun.payload);
    assert.equal(taskPayload.playbookRehearsal, true);
    assert.equal(taskPayload.playbookRehearsalSuite, true);
    assert.equal(taskPayload.noLiveModels, true);
    assert.equal(taskPayload.manualMarketContext.subject, "Compact desk cable template");

    const loop = await runUntilBlocked(db, { workflowId: queued.workflow.id, maxSteps: 5 });
    assert.equal(loop.status, "ready_for_review");

    const state = getDashboardState(db);
    const playbookState = state.agentPlaybooks;
    const workflow = state.workflows.find((item) => item.id === queued.workflow.id);

    assert.equal(playbookState.summary.rehearsals, 3);
    assert.equal(playbookState.summary.completedRehearsals, 3);
    assert.equal(playbookState.summary.passedRehearsals, 3);
    assert.equal(playbookState.summary.rehearsedWorkers, 3);
    assert.equal(playbookState.summary.actualCostCents, 0);
    assert.equal(state.preOpenAiReadiness.metrics.playbookRehearsals, 3);
    assert.equal(state.preOpenAiReadiness.metrics.passedPlaybookRehearsals, 3);
    assert.equal(state.preOpenAiReadiness.metrics.rehearsedPlaybookWorkers, 3);
    assert.equal(state.preOpenAiReadiness.status, "needs_live_comparison_request");
    assert.equal(workflow.metadata.playbookRehearsalSuite, true);
    assert.equal(workflow.metadata.teamProofSummary.schema, "jarvis_agent_team_drill_summary_v1");
    assert.equal(workflow.metadata.teamProofSummary.passedWorkers, 3);
    assert.ok(state.events.some((event) => event.type === "agent.playbook_rehearsal_suite_queued" && event.entity_id === queued.workflow.id));
  } finally {
    db.close();
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousKey;
    if (previousLiveModels === undefined) delete process.env.JARVIS_ENABLE_LIVE_MODELS;
    else process.env.JARVIS_ENABLE_LIVE_MODELS = previousLiveModels;
  }
});

test("agent model readiness packs persist connection contracts before OpenAI setup", async () => {
  const previousKey = process.env.OPENAI_API_KEY;
  const previousLiveModels = process.env.JARVIS_ENABLE_LIVE_MODELS;
  delete process.env.OPENAI_API_KEY;
  delete process.env.JARVIS_ENABLE_LIVE_MODELS;

  const db = seededDb("agent-model-readiness-packs");
  try {
    const initial = getAgentModelReadinessState(db);
    const demandInitial = initial.byAgent.demand_validator;
    const initialRows = get(db, "SELECT COUNT(*) AS count FROM agent_model_readiness_packs");

    assert.equal(initial.schema, "jarvis_agent_model_connection_readiness_v1");
    assert.equal(initial.summary.total, 11);
    assert.equal(initial.summary.localReady, 0);
    assert.equal(initial.summary.evalFixtures, 11);
    assert.equal(initial.summary.failureCases, 44);
    assert.equal(initialRows.count, 11);
    assert.equal(demandInitial.status, "needs_proof_or_rehearsal");
    assert.equal(demandInitial.provider, "openai-agents-sdk");
    assert.equal(demandInitial.approvalRules.currentProviderState.ready, false);
    assert.ok(demandInitial.fixtures[0].criteria.includes("business decision contract is complete"));
    assert.ok(demandInitial.failureCases.some((item) => item.id === "demand_validator_unapproved_spend"));
    assert.ok(demandInitial.readinessChecks.some((item) => item.id === "playbook_rehearsal" && item.ok === false));

    const queued = queueAgentPlaybookRehearsalSuite(db, {
      teamName: "Model readiness local proof",
      subject: "Compact desk cable template",
      buyer: "Home-office workers",
      problem: "They want a tidier desk without buying a full cable-management kit.",
      offer: "A printable cable-planning template and shopping checklist.",
      channel: "Digital Product",
    });
    const loop = await runUntilBlocked(db, { workflowId: queued.workflow.id, maxSteps: queued.tasks.length + 2 });
    assert.equal(loop.status, "ready_for_review");

    const ready = getAgentModelReadinessState(db);
    const demandReady = ready.byAgent.demand_validator;
    const storedDemand = get(db, "SELECT * FROM agent_model_readiness_packs WHERE agent_id = ?", ["demand_validator"]);
    const storedChecks = JSON.parse(storedDemand.readiness_checks);
    const state = getDashboardState(db);

    assert.equal(ready.status, "ready_before_model_connection");
    assert.equal(ready.summary.localReady, 11);
    assert.equal(ready.summary.readyBeforeConnection, 11);
    assert.equal(ready.summary.readyForApprovedComparison, 0);
    assert.equal(demandReady.status, "ready_before_model_connection");
    assert.equal(demandReady.readinessScore, 100);
    assert.equal(demandReady.metadata.localReady, true);
    assert.equal(demandReady.approvalRules.currentProviderState.ready, false);
    assert.ok(storedChecks.every((item) => item.ok === true));
    assert.equal(JSON.parse(storedDemand.fixtures).length, 1);
    assert.equal(JSON.parse(storedDemand.failure_cases).length, 4);
    assert.equal(state.agentModelReadiness.summary.localReady, 11);
    assert.equal(state.aiTeam.modelReadiness.byAgent.demand_validator.readinessScore, 100);
    assert.equal(state.metrics.aiTeam.modelReadinessPacks, 11);
    assert.equal(state.metrics.aiTeam.modelReadinessLocalReady, 11);
    assert.equal(state.aiPilotReview.status, "ready_to_prepare_packet");
    assert.equal(state.aiPilotReview.actions.some((action) => action.action === "prepare-model-comparison-packet"), true);
  } finally {
    db.close();
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousKey;
    if (previousLiveModels === undefined) delete process.env.JARVIS_ENABLE_LIVE_MODELS;
    else process.env.JARVIS_ENABLE_LIVE_MODELS = previousLiveModels;
  }
});

test("agent model comparison packet queues a capped decision without model connection", async () => {
  const previousKey = process.env.OPENAI_API_KEY;
  const previousLiveModels = process.env.JARVIS_ENABLE_LIVE_MODELS;
  delete process.env.OPENAI_API_KEY;
  delete process.env.JARVIS_ENABLE_LIVE_MODELS;

  const db = seededDb("agent-model-comparison-packet");
  try {
    const queued = queueAgentPlaybookRehearsalSuite(db, {
      teamName: "Model comparison packet proof",
      subject: "Compact desk cable template",
      buyer: "Home-office workers",
      problem: "They want a tidier desk without buying a full cable-management kit.",
      offer: "A printable cable-planning template and shopping checklist.",
      channel: "Digital Product",
    });
    const loop = await runUntilBlocked(db, { workflowId: queued.workflow.id, maxSteps: queued.tasks.length + 2 });
    assert.equal(loop.status, "ready_for_review");

    const result = queueAgentModelComparisonPacket(db, "demand_validator", { estimatedCostCents: 140 });
    const packet = result.packet;
    const storedPackets = storedComparisonPackets(db);
    const state = getDashboardState(db);
    const approval = state.approvals.find((item) => item.id === packet.approvalId);
    const task = state.tasks.find((item) => item.id === packet.taskId);
    const workflow = state.workflows.find((item) => item.id === packet.workflowId);

    assert.equal(packet.schema, "jarvis_agent_model_comparison_packet_v1");
    assert.equal(packet.status, "waiting_for_decision");
    assert.equal(packet.agentId, "demand_validator");
    assert.equal(packet.fixtureId, "agent_eval_case_demand_validator_contract");
    assert.equal(packet.protectedBaseline.noSpendOccurred, true);
    assert.equal(packet.comparisonPlan.costCapCents, 140);
    assert.match(packet.operatorDecision.decisionNeeded, /Approve, request changes, or deny/);
    assert.equal(storedPackets.length, 1);
    assert.equal(storedPackets[0].approvalId, packet.approvalId);
    assert.equal(workflow.type, "agent_model_comparison_packet");
    assert.equal(workflow.status, "blocked_for_approval");
    assert.equal(workflow.metadata.modelComparisonPacket.id, packet.id);
    assert.equal(task.kind, "live_ai_worker_execution");
    assert.equal(task.status, "blocked");
    assert.equal(task.payload.comparisonSource.type, "agent_model_readiness_pack");
    assert.equal(task.payload.comparisonSource.packetId, packet.id);
    assert.equal(approval.status, "pending");
    assert.equal(approval.scope, "live_ai_worker_spend");
    assert.equal(approval.payload.comparisonSource.type, "agent_model_readiness_pack");
    assert.equal(approval.payload.comparisonPacket.id, packet.id);
    assert.equal(approval.payload.noSpendOccurred, true);
    assert.equal(state.agentModelReadiness.summary.comparisonPackets, 1);
    assert.equal(state.agentModelReadiness.summary.pendingComparisonPackets, 1);
    assert.equal(state.agentModelReadiness.byAgent.demand_validator.latestComparisonPacket.id, packet.id);
    assert.equal(state.preOpenAiReadiness.status, "ready_before_model_connection");
    assert.equal(state.preOpenAiReadiness.foundationReady, true);
    assert.equal(state.preOpenAiReadiness.metrics.modelComparisonPackets, 1);
    assert.equal(state.decisionInbox.metrics.liveComparisons, 1);
    assert.ok(state.decisionInbox.items.some((item) => item.approvalId === packet.approvalId && item.type === "live_comparison"));
    assert.equal(state.aiPilotReview.status, "waiting_for_approval");
    assert.equal(state.aiPilotReview.cost.capCents, 140);
    assert.equal(state.aiPilotReview.actions.some((action) => action.action === "approval" && action.decision === "approve"), true);
    assert.equal(state.operatorCockpit.aiTeam.pilotStatus, "waiting_for_approval");
    assert.equal(state.metrics.aiPilotReview.actions >= 1, true);
    assert.equal(state.modelCalls.filter((call) => call.mode !== "dry-run").length, 0);
    assert.equal(state.metrics.modelCalls.actualCostCents, 0);
    assert.ok(state.events.some((event) => event.type === "agent.model_comparison_packet_prepared" && event.entity_id === packet.workflowId));
  } finally {
    db.close();
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousKey;
    if (previousLiveModels === undefined) delete process.env.JARVIS_ENABLE_LIVE_MODELS;
    else process.env.JARVIS_ENABLE_LIVE_MODELS = previousLiveModels;
  }
});

test("agent operating briefs translate worker contracts into operator-ready guidance", () => {
  const db = seededDb("agent-operating-briefs");
  const briefs = getAgentOperatingBriefsState(db);
  const chief = briefs.byAgent.chief_of_staff;
  const validator = briefs.byAgent.demand_validator;
  const builder = briefs.byAgent.product_builder;

  assert.equal(briefs.schema, "jarvis_agent_operating_briefs_v1");
  assert.equal(briefs.status, "ready");
  assert.equal(briefs.summary.total, 11);
  assert.equal(briefs.summary.complete, 11);
  assert.ok(briefs.summary.summary.includes("OpenAI model connection"));
  assert.ok(chief.owns.some((item) => item.includes("operator decision")));
  assert.ok(validator.evidenceStandard.some((item) => item.includes("Source-backed demand verdict")));
  assert.ok(validator.approvalRequiredTools.includes("Research Adapter"));
  assert.ok(builder.approvalRequiredTools.includes("Digital Product Adapter"));
  assert.equal(builder.connectionReadiness.status, "keep_protected");
  assert.equal(builder.continuousImprovement.actualResultSource.includes("Worker runs"), true);
  assert.ok(builder.hardStops.includes("publishing"));

  db.close();
});

test("runtime startup backfills AI team foundation for initialized databases", () => {
  const dbPath = tempDbPath("startup-ai-foundation");
  const ts = new Date().toISOString();
  let db = openDatabase(dbPath);
  run(
    db,
    "INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)",
    ["runtime.initialized", toJson({ at: ts, version: 1, legacy: true }), ts],
  );
  db.close();

  db = createRuntime({ dbPath });
  try {
    assert.equal(all(db, "SELECT COUNT(*) AS count FROM agent_definitions")[0].count, 11);
    assert.equal(all(db, "SELECT COUNT(*) AS count FROM agent_eval_datasets")[0].count, 11);
    assert.equal(all(db, "SELECT COUNT(*) AS count FROM agent_eval_cases")[0].count, 11);
    assert.equal(all(db, "SELECT COUNT(*) AS count FROM agent_tools")[0].count >= 30, true);
    assert.equal(all(db, "SELECT COUNT(*) AS count FROM agent_tool_assignments")[0].count >= 20, true);
    assert.ok(get(db, "SELECT id FROM integrations WHERE id = ?", ["codex"]));
    assert.ok(get(db, "SELECT id FROM integrations WHERE id = ?", ["digital_products"]));
    assert.ok(get(db, "SELECT id FROM integrations WHERE id = ?", ["ai_workers"]));
  } finally {
    db.close();
  }
});

test("agent tool policy registers worker permissions and hard stops", () => {
  const db = seededDb("agent-tool-policy");
  const policy = getAgentToolPolicyState(db);
  const demandValidator = policy.byAgent.demand_validator;
  const productBuilder = policy.byAgent.product_builder;
  const marketplacePublish = policy.tools.find((tool) => tool.id === "marketplace_publish");

  assert.equal(policy.schema, "jarvis_agent_tool_policy_v1");
  assert.equal(policy.status, "ready");
  assert.ok(policy.metrics.tools >= 30);
  assert.ok(policy.metrics.approvalTools >= 4);
  assert.ok(policy.metrics.hardStopTools >= 10);
  assert.equal(policy.metrics.assignedHardStops, 0);
  assert.equal(demandValidator.status, "approval_gated");
  assert.deepEqual(demandValidator.allowed.map((item) => item.tool_id).sort(), ["local_deliverables", "runtime_state"]);
  assert.deepEqual(demandValidator.approvalRequired.map((item) => item.tool_id), ["research_adapter"]);
  assert.equal(demandValidator.blocked.length, 0);
  assert.equal(demandValidator.externalActionsRequireApproval, true);
  assert.equal(demandValidator.spendRequiresApproval, true);
  assert.equal(productBuilder.status, "approval_gated");
  assert.deepEqual(productBuilder.approvalRequired.map((item) => item.tool_id), ["digital_product_adapter"]);
  assert.equal(marketplacePublish.status, "blocked");
  assert.equal(marketplacePublish.hard_stop, true);
  assert.equal(policy.assignments.some((assignment) => assignment.tool_id === "marketplace_publish"), false);

  db.close();
});

test("agent tool gate records allowed, approval-controlled, and blocked tool calls", () => {
  const db = seededDb("agent-tool-gate");
  const task = get(db, "SELECT * FROM tasks WHERE id = ?", ["task-market-validated"]);
  task.payload = {};
  const definition = findAgentDefinition(db, task);
  const agentRun = createAgentRun(db, definition, task, {
    mode: "dry-run",
    inputSummary: "Tool gate proof run",
    approvalRequired: false,
  });

  const runtimeState = requestAgentToolUse(db, {
    agentId: definition.id,
    agentName: definition.name,
    runId: agentRun.id,
    task,
    toolId: "runtime_state",
    mode: "protected",
    reason: "Read runtime state for the proof run.",
  });
  const protectedResearch = requestAgentToolUse(db, {
    agentId: definition.id,
    agentName: definition.name,
    runId: agentRun.id,
    task,
    toolId: "research_adapter",
    mode: "protected",
    reason: "Use protected research planning without live web access.",
  });
  const liveResearch = requestAgentToolUse(db, {
    agentId: definition.id,
    agentName: definition.name,
    runId: agentRun.id,
    task,
    toolId: "research_adapter",
    mode: "live",
    reason: "Attempt live research without approval.",
  });

  assert.equal(runtimeState.status, "allowed");
  assert.equal(runtimeState.decision, "allowed");
  assert.equal(protectedResearch.status, "allowed");
  assert.equal(protectedResearch.decision, "allowed_protected");
  assert.equal(liveResearch.status, "approval_required");
  assert.equal(liveResearch.approvalRequired, true);
  const approval = get(db, "SELECT * FROM approvals WHERE id = ?", [liveResearch.approvalId]);
  assert.equal(approval.status, "pending");
  assert.equal(approval.scope, "live_research_spend");
  const approvalPayload = JSON.parse(approval.payload);
  assert.equal(approvalPayload.invocationId, liveResearch.id);
  assert.equal(approvalPayload.resume.approve.includes("resume"), true);

  const approvalDecision = decideApproval(db, liveResearch.approvalId, "approved", "approve tool gate test");
  assert.equal(approvalDecision.toolApproval.handled, true);
  assert.equal(approvalDecision.toolApproval.invocationId, liveResearch.id);
  const resolvedInvocation = get(db, "SELECT * FROM agent_tool_invocations WHERE id = ?", [liveResearch.id]);
  assert.equal(resolvedInvocation.status, "allowed");
  assert.equal(resolvedInvocation.decision, "approved_live");
  const approvedLiveResearch = requestAgentToolUse(db, {
    agentId: definition.id,
    agentName: definition.name,
    runId: agentRun.id,
    task,
    toolId: "research_adapter",
    mode: "live",
    approvalId: liveResearch.approvalId,
    reason: "Use live research after approval.",
  });
  const hardStop = requestAgentToolUse(db, {
    agentId: definition.id,
    agentName: definition.name,
    runId: agentRun.id,
    task,
    toolId: "marketplace_publish",
    mode: "live",
    reason: "Attempt live publishing from the wrong worker.",
  });
  const unknown = requestAgentToolUse(db, {
    agentId: definition.id,
    agentName: definition.name,
    runId: agentRun.id,
    task,
    toolId: "mystery_tool",
    mode: "protected",
    reason: "Attempt an unregistered tool.",
  });

  assert.equal(approvedLiveResearch.status, "allowed");
  assert.equal(approvedLiveResearch.decision, "approved_live");
  assert.equal(hardStop.status, "blocked");
  assert.equal(hardStop.decision, "hard_stop");
  assert.equal(unknown.status, "blocked");
  assert.equal(unknown.decision, "needs_review");

  const gate = getAgentToolGateState(db);
  assert.equal(gate.schema, "jarvis_agent_tool_gate_v1");
  assert.equal(gate.metrics.invocations, 6);
  assert.equal(gate.metrics.allowed, 4);
  assert.equal(gate.metrics.approvalRequired, 0);
  assert.equal(gate.metrics.blocked, 2);
  assert.equal(gate.metrics.approvedLive, 2);
  const traces = all(db, "SELECT * FROM agent_trace_events WHERE run_id = ?", [agentRun.id]);
  assert.ok(traces.some((trace) => trace.type === "tool_call.allowed"));
  assert.ok(traces.some((trace) => trace.type === "tool_call.approval_requested"));
  assert.ok(traces.some((trace) => trace.type === "tool_call.approved"));
  assert.ok(traces.some((trace) => trace.type === "tool_call.blocked"));

  db.close();
});

test("agent tool approval decisions resume or stop paused worker tool work", async () => {
  const db = seededDb("agent-tool-approval-resume");
  const baseTask = get(db, "SELECT * FROM tasks WHERE id = ?", ["task-market-validated"]);
  run(db, "UPDATE tasks SET status = 'cancelled' WHERE workflow_id = ? AND id <> ?", [baseTask.workflow_id, baseTask.id]);
  run(
    db,
    `UPDATE tasks
     SET kind = 'live_market_research', agent = 'researcher', status = 'queued',
         approval_id = NULL, payload = '{}', result = '{}', error = NULL,
         retries = 0, max_retries = 0
     WHERE id = ?`,
    [baseTask.id],
  );

  const paused = await runOnce(db, { workflowId: baseTask.workflow_id });
  assert.equal(paused.status, "blocked");
  assert.equal(paused.toolGate.status, "approval_required");
  assert.ok(paused.approval.id);

  const blockedTask = get(db, "SELECT * FROM tasks WHERE id = ?", [baseTask.id]);
  assert.equal(blockedTask.status, "blocked");
  assert.equal(blockedTask.approval_id, paused.approval.id);
  assert.equal(blockedTask.retries, 0);
  const waitingRun = get(db, "SELECT * FROM agent_runs WHERE task_id = ? ORDER BY started_at DESC LIMIT 1", [baseTask.id]);
  assert.equal(waitingRun.status, "waiting_approval");

  const approved = decideApproval(db, paused.approval.id, "approved", "resume the paused worker");
  assert.equal(approved.toolApproval.handled, true);
  const queuedTask = get(db, "SELECT * FROM tasks WHERE id = ?", [baseTask.id]);
  assert.equal(queuedTask.status, "queued");
  const approvedInvocation = get(db, "SELECT * FROM agent_tool_invocations WHERE id = ?", [paused.toolGate.id]);
  assert.equal(approvedInvocation.status, "allowed");
  assert.equal(approvedInvocation.decision, "approved_live");

  const task = { ...get(db, "SELECT * FROM tasks WHERE id = ?", [baseTask.id]), payload: {}, approval_id: null };
  const definition = findAgentDefinition(db, task);
  const changeRun = createAgentRun(db, definition, task, {
    mode: "dry-run",
    inputSummary: "Tool changes decision proof",
    approvalRequired: true,
  });
  const changesRequest = requestAgentToolUse(db, {
    agentId: definition.id,
    agentName: definition.name,
    runId: changeRun.id,
    task,
    toolId: "research_adapter",
    mode: "live",
    reason: "Prove request-changes resolves the pending tool approval.",
  });
  decideApproval(db, changesRequest.approvalId, "needs_changes", "revise the request first");
  const changedInvocation = get(db, "SELECT * FROM agent_tool_invocations WHERE id = ?", [changesRequest.id]);
  assert.equal(changedInvocation.status, "blocked");
  assert.equal(changedInvocation.decision, "needs_changes");

  const rejectRun = createAgentRun(db, definition, task, {
    mode: "dry-run",
    inputSummary: "Tool denial decision proof",
    approvalRequired: true,
  });
  const rejectRequest = requestAgentToolUse(db, {
    agentId: definition.id,
    agentName: definition.name,
    runId: rejectRun.id,
    task,
    toolId: "research_adapter",
    mode: "live",
    reason: "Prove denial resolves the pending tool approval.",
  });
  decideApproval(db, rejectRequest.approvalId, "rejected", "do not use this tool");
  const rejectedInvocation = get(db, "SELECT * FROM agent_tool_invocations WHERE id = ?", [rejectRequest.id]);
  assert.equal(rejectedInvocation.status, "blocked");
  assert.equal(rejectedInvocation.decision, "rejected");

  const traces = all(db, "SELECT type FROM agent_trace_events WHERE run_id IN (?, ?, ?)", [waitingRun.id, changeRun.id, rejectRun.id]);
  assert.ok(traces.some((trace) => trace.type === "run_paused"));
  assert.ok(traces.some((trace) => trace.type === "tool_call.approved"));
  assert.ok(traces.some((trace) => trace.type === "tool_call.needs_changes"));
  assert.ok(traces.some((trace) => trace.type === "tool_call.rejected"));

  db.close();
});

test("agent workbench turns protected worker evidence into live-test readiness", async () => {
  const previousKey = process.env.OPENAI_API_KEY;
  const previousLiveModels = process.env.JARVIS_ENABLE_LIVE_MODELS;
  delete process.env.OPENAI_API_KEY;
  delete process.env.JARVIS_ENABLE_LIVE_MODELS;

  const db = seededDb("agent-workbench-ready");
  try {
    const planned = createCommandPlan(db, {
      text: "Evaluate a premium Notion finance dashboard template and prepare a decision pack",
      source: "test",
      createFiles: false,
    });
    await runUntilBlocked(db, { workflowId: planned.workflow.id, maxSteps: 12 });

    const workbench = getAgentWorkbenchState(db);
    const demandValidator = workbench.byAgent.demand_validator;

    assert.equal(workbench.schema, "jarvis_agent_workbench_v1");
    assert.ok(workbench.metrics.dryRunProven >= 1);
    assert.ok(demandValidator);
    assert.equal(demandValidator.status, "ready_after_setup");
    assert.equal(demandValidator.canPrepareLiveTest, true);
    assert.equal(demandValidator.canExecuteLiveNow, false);
    assert.equal(demandValidator.requirements.find((item) => item.id === "tool_permissions").ok, true);
    assert.equal(demandValidator.toolPolicy.status, "approval_gated");
    assert.deepEqual(demandValidator.toolPolicy.approvalRequired, ["Research Adapter"]);
    assert.equal(demandValidator.comparison.dryRun.evalStatus, "passed");
    assert.equal(demandValidator.comparison.live, null);
    assert.equal(demandValidator.promotionGate.schema, "jarvis_agent_promotion_gate_v1");
    assert.equal(demandValidator.promotionGate.status, "provider_setup_needed");
    assert.match(demandValidator.promotionGate.recommendation, /Protected proof exists/i);
    assert.equal(demandValidator.promotionGate.requirements.find((item) => item.id === "protected_quality").ok, true);
    assert.equal(demandValidator.promotionGate.requirements.find((item) => item.id === "live_comparison").ok, false);
    assert.ok(demandValidator.promotionGate.evidence.some((item) => /OpenAI API key|provider/i.test(item)));
    assert.ok(demandValidator.requirements.find((item) => item.id === "provider_readiness" && item.ok === false));
    assert.match(demandValidator.comparison.verdict, /capped live comparison/i);
  } finally {
    db.close();
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousKey;
    if (previousLiveModels === undefined) delete process.env.JARVIS_ENABLE_LIVE_MODELS;
    else process.env.JARVIS_ENABLE_LIVE_MODELS = previousLiveModels;
  }
});

test("agent workbench proof drill queues and runs a selected protected worker", async () => {
  const previousKey = process.env.OPENAI_API_KEY;
  const previousLiveModels = process.env.JARVIS_ENABLE_LIVE_MODELS;
  delete process.env.OPENAI_API_KEY;
  delete process.env.JARVIS_ENABLE_LIVE_MODELS;

  const db = seededDb("agent-workbench-proof");
  try {
    const queued = queueAgentWorkbenchProof(db, "demand_validator", {
      subject: "Premium Notion finance dashboard",
      buyer: "Freelance designers",
      problem: "They want monthly cashflow clarity without building a dashboard from scratch.",
      offer: "A Notion cashflow dashboard with setup guide.",
      channel: "Digital Product",
    });

    assert.equal(queued.worker.id, "demand_validator");
    assert.equal(queued.task.kind, "workbench_proof");

    const completed = await runOnce(db, { workflowId: queued.workflow.id });
    assert.equal(completed.status, "completed");
    assert.equal(completed.result.taskKind, "workbench_proof");
    assert.equal(completed.result.aiTeam.agentId, "demand_validator");
    assert.equal(completed.result.aiTeam.evalStatus, "passed");
    assert.equal(completed.result.cost.actualCents, 0);
    assert.equal(completed.result.output.businessDecision.workerId, "demand_validator");
    assert.equal(completed.result.output.businessDecision.externalActionsAllowed, false);

    const state = getDashboardState(db);
    const task = state.tasks.find((item) => item.id === queued.task.id);
    const runRecord = state.aiTeam.runs.find((item) => item.task_id === queued.task.id);
    const traces = state.aiTeam.traceEvents.filter((trace) => trace.run_id === runRecord.id);
    const worker = state.aiTeam.workbench.byAgent.demand_validator;

    assert.equal(task.status, "completed");
    assert.equal(runRecord.mode, "dry-run");
    assert.equal(runRecord.eval_status, "passed");
    assert.ok(traces.some((trace) => trace.type === "contract_checked"));
    assert.ok(traces.some((trace) => trace.type === "eval_completed"));
    assert.equal(worker.comparison.dryRun.id, runRecord.id);
    assert.equal(worker.comparison.dryRun.evalStatus, "passed");
    assert.equal(worker.promotionGate.requirements.find((item) => item.id === "protected_quality").ok, true);
    assert.equal(worker.promotionGate.requirements.find((item) => item.id === "protected_trace").ok, true);
    assert.equal(worker.promotionGate.status, "provider_setup_needed");
    assert.match(worker.promotionGate.recommendation, /Protected proof exists/i);
  } finally {
    db.close();
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousKey;
    if (previousLiveModels === undefined) delete process.env.JARVIS_ENABLE_LIVE_MODELS;
    else process.env.JARVIS_ENABLE_LIVE_MODELS = previousLiveModels;
  }
});

test("agent workbench team drill runs protected proof across core workers", async () => {
  const previousKey = process.env.OPENAI_API_KEY;
  const previousLiveModels = process.env.JARVIS_ENABLE_LIVE_MODELS;
  delete process.env.OPENAI_API_KEY;
  delete process.env.JARVIS_ENABLE_LIVE_MODELS;

  const db = seededDb("agent-workbench-team-proof");
  try {
    const queued = queueAgentWorkbenchProofSuite(db, {
      teamName: "Digital product core crew",
      agentIds: ["opportunity_scout", "demand_validator", "offer_architect"],
      subject: "Compact desk cable template",
      buyer: "Home-office workers",
      problem: "They want a tidier desk without buying a full cable-management kit.",
      offer: "A printable cable-planning template and shopping checklist.",
      channel: "Digital Product",
    });

    assert.equal(queued.team.workerCount, 3);
    assert.equal(queued.tasks.length, 3);
    assert.deepEqual(queued.tasks.map((task) => task.workerId), ["opportunity_scout", "demand_validator", "offer_architect"]);

    const loop = await runUntilBlocked(db, { workflowId: queued.workflow.id, maxSteps: 5 });
    assert.equal(loop.stepsRun, 3);
    assert.equal(loop.status, "ready_for_review");
    assert.ok(loop.steps.every((step) => step.status === "completed"));

    const state = getDashboardState(db);
    const tasks = queued.tasks.map((task) => state.tasks.find((item) => item.id === task.id));
    const runs = queued.tasks.map((task) => state.aiTeam.runs.find((item) => item.task_id === task.id));
    const teamEvent = state.events.find((event) => event.type === "agent.workbench_team_proof_queued");

    assert.ok(tasks.every((task) => task.status === "completed"));
    assert.ok(runs.every((runRecord) => runRecord.mode === "dry-run"));
    assert.ok(runs.every((runRecord) => runRecord.eval_status === "passed"));
    assert.ok(runs.every((runRecord) => Number(runRecord.actual_cost_cents || 0) === 0));
    assert.ok(teamEvent);
    assert.equal(teamEvent.entity_id, queued.workflow.id);

    for (const workerId of ["opportunity_scout", "demand_validator", "offer_architect"]) {
      const worker = state.aiTeam.workbench.byAgent[workerId];
      assert.equal(worker.comparison.dryRun.evalStatus, "passed");
      assert.equal(worker.promotionGate.requirements.find((item) => item.id === "protected_quality").ok, true);
      assert.equal(worker.promotionGate.requirements.find((item) => item.id === "protected_trace").ok, true);
      assert.equal(worker.promotionGate.requirements.find((item) => item.id === "operator_controls").ok, true);
      assert.equal(worker.promotionGate.status, "provider_setup_needed");
    }

    const workflow = state.workflows.find((item) => item.id === queued.workflow.id);
    assert.equal(workflow.type, "agent_workbench_team_proof");
    assert.equal(workflow.status, "ready_for_review");
    assert.equal(workflow.metadata.proofSuite, true);
    assert.equal(workflow.metadata.agentRunner.liveModels, false);
    assert.equal(workflow.metadata.agentRunner.liveTools, false);
    assert.equal(workflow.metadata.teamProofSummary.schema, "jarvis_agent_team_drill_summary_v1");
    assert.equal(workflow.metadata.teamProofSummary.workerCount, 3);
    assert.equal(workflow.metadata.teamProofSummary.passedWorkers, 3);
    assert.equal(workflow.metadata.teamProofSummary.actualCostCents, 0);
    assert.equal(workflow.metadata.teamProofSummary.hardStops.includes("No paid spend"), true);
    assert.equal(workflow.metadata.aiTeam.teamProofSummary.chiefRunId, workflow.metadata.teamProofSummary.chiefRunId);
    const chiefRun = state.aiTeam.runs.find((runRecord) => runRecord.id === workflow.metadata.teamProofSummary.chiefRunId);
    assert.ok(chiefRun);
    assert.equal(chiefRun.agent_id, "chief_of_staff");
    assert.equal(chiefRun.eval_status, "passed");
    assert.equal(chiefRun.metadata.teamProofSummary.schema, "jarvis_agent_team_drill_summary_v1");
    assert.ok(state.events.some((event) => event.type === "agent.team_drill_summary_ready" && event.entity_id === queued.workflow.id));
    assert.ok(state.messages.some((message) => message.subject === "AI Team drill summary ready" && message.metadata.teamProofSummary));
  } finally {
    db.close();
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousKey;
    if (previousLiveModels === undefined) delete process.env.JARVIS_ENABLE_LIVE_MODELS;
    else process.env.JARVIS_ENABLE_LIVE_MODELS = previousLiveModels;
  }
});

test("agent workbench prepares capped live comparison from protected team proof", async () => {
  const previousKey = process.env.OPENAI_API_KEY;
  const previousLiveModels = process.env.JARVIS_ENABLE_LIVE_MODELS;
  delete process.env.OPENAI_API_KEY;
  delete process.env.JARVIS_ENABLE_LIVE_MODELS;

  const db = seededDb("agent-workbench-live-comparison");
  try {
    const queued = queueAgentWorkbenchProofSuite(db, {
      teamName: "Digital product core crew",
      agentIds: ["chief_of_staff", "demand_validator", "offer_architect"],
      subject: "Compact desk cable template",
      buyer: "Home-office workers",
      problem: "They want a tidier desk without buying a full cable-management kit.",
      offer: "A printable cable-planning template and shopping checklist.",
      channel: "Digital Product",
    });
    const loop = await runUntilBlocked(db, { workflowId: queued.workflow.id, maxSteps: 5 });
    assert.equal(loop.status, "ready_for_review");

    const comparison = requestAgentWorkbenchLiveComparison(db, queued.workflow.id, { estimatedCostCents: 130 });
    assert.equal(comparison.status, "blocked");
    assert.equal(comparison.liveWorker.worker.id, "demand_validator");
    assert.equal(comparison.liveWorker.worker.name, "Demand Validator");
    assert.equal(comparison.liveWorker.approval.status, "pending");
    assert.equal(comparison.comparisonRequest.workerId, "demand_validator");
    assert.equal(comparison.comparisonRequest.estimatedCostCents, 130);

    const state = getDashboardState(db);
    const workflow = state.workflows.find((item) => item.id === queued.workflow.id);
    const liveTask = state.tasks.find((task) => task.id === comparison.liveWorker.task.id);
    const approval = state.approvals.find((item) => item.id === comparison.liveWorker.approval.id);
    const event = state.events.find((item) => item.type === "agent.live_comparison_requested");

    assert.equal(workflow.metadata.teamProofSummary.liveComparisonRequest.workerId, "demand_validator");
    assert.equal(workflow.metadata.teamProofSummary.liveComparisonRequest.approvalId, approval.id);
    assert.equal(liveTask.kind, "live_ai_worker_execution");
    assert.equal(liveTask.status, "blocked");
    assert.equal(liveTask.payload.comparisonSource.type, "agent_workbench_team_proof");
    assert.equal(liveTask.payload.comparisonSource.protectedWorkerId, "demand_validator");
    assert.ok(liveTask.payload.protectedEvidence.some((item) => /protected proof/i.test(item)));
    assert.equal(approval.payload.comparisonSource.protectedWorkerId, "demand_validator");
    assert.ok(approval.payload.protectedEvidence.some((item) => /protected proof/i.test(item)));
    assert.match(approval.payload.expectedMetric, /same contract checks/i);
    assert.ok(event);
    assert.equal(event.entity_id, queued.workflow.id);
    assert.equal(state.metrics.aiWorkers.liveWorkerRequests, 1);
    assert.equal(state.runtime.liveAiWorkers.pendingApprovals, 1);
  } finally {
    db.close();
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousKey;
    if (previousLiveModels === undefined) delete process.env.JARVIS_ENABLE_LIVE_MODELS;
    else process.env.JARVIS_ENABLE_LIVE_MODELS = previousLiveModels;
  }
});

test("pre-OpenAI readiness reports the local foundation without connecting models", async () => {
  const previousKey = process.env.OPENAI_API_KEY;
  const previousLiveModels = process.env.JARVIS_ENABLE_LIVE_MODELS;
  delete process.env.OPENAI_API_KEY;
  delete process.env.JARVIS_ENABLE_LIVE_MODELS;

  const db = seededDb("pre-openai-readiness");
  try {
    const initial = getPreOpenAiReadinessState(db);
    assert.equal(initial.schema, "jarvis_pre_openai_readiness_v1");
    assert.equal(initial.status, "needs_team_drill");
    assert.equal(initial.providerSetupReady, false);
    assert.equal(initial.noSpendConfirmed, true);

    const queued = queueAgentWorkbenchProofSuite(db, {
      teamName: "Digital product core crew",
      agentIds: ["chief_of_staff", "demand_validator", "offer_architect"],
      subject: "Compact desk cable template",
      buyer: "Home-office workers",
      problem: "They want a tidier desk without buying a full cable-management kit.",
      offer: "A printable cable-planning template and shopping checklist.",
      channel: "Digital Product",
    });
    const loop = await runUntilBlocked(db, { workflowId: queued.workflow.id, maxSteps: 5 });
    assert.equal(loop.status, "ready_for_review");
    const comparison = requestAgentWorkbenchLiveComparison(db, queued.workflow.id, { estimatedCostCents: 130 });
    assert.equal(comparison.liveWorker.approval.status, "pending");

    const needsRehearsal = getPreOpenAiReadinessState(db);
    assert.equal(needsRehearsal.status, "needs_playbook_rehearsal");
    assert.equal(needsRehearsal.foundationReady, false);
    assert.equal(needsRehearsal.checklist.find((item) => item.id === "playbook_rehearsal").ok, false);
    assert.ok(needsRehearsal.nextSafeActions.some((action) => (
      action.action === "run-agent-playbook-rehearsal"
      && action.agentId
    )));

    const rehearsal = queueAgentPlaybookRehearsal(db, "demand_validator", {
      subject: "Compact desk cable template",
      buyer: "Home-office workers",
      problem: "They want a tidier desk without buying a full cable-management kit.",
      offer: "A printable cable-planning template and shopping checklist.",
      channel: "Digital Product",
    });
    const rehearsalLoop = await runUntilBlocked(db, { workflowId: rehearsal.workflow.id, maxSteps: 3 });
    assert.equal(rehearsalLoop.status, "ready_for_review");

    const state = getDashboardState(db);
    const readiness = state.preOpenAiReadiness;
    const direct = getPreOpenAiReadinessState(db);

    assert.equal(readiness.status, "ready_before_model_connection");
    assert.equal(direct.status, readiness.status);
    assert.equal(readiness.foundationReady, true);
    assert.equal(readiness.providerSetupReady, false);
    assert.equal(readiness.noSpendConfirmed, true);
    assert.equal(readiness.latestTeamDrill.workflowId, queued.workflow.id);
    assert.equal(readiness.latestTeamDrill.comparisonRequest.workerId, "demand_validator");
    assert.equal(readiness.metrics.playbookRehearsals, 1);
    assert.equal(readiness.metrics.passedPlaybookRehearsals, 1);
    assert.equal(readiness.metrics.playbookRehearsalSpendCents, 0);
    assert.equal(readiness.metrics.pendingLiveComparisons, 1);
    assert.equal(readiness.metrics.actualSpendCents, 0);
    assert.equal(readiness.checklist.find((item) => item.id === "team_drill_summary").ok, true);
    assert.equal(readiness.checklist.find((item) => item.id === "playbook_rehearsal").ok, true);
    assert.equal(readiness.checklist.find((item) => item.id === "live_comparison_request").ok, true);
    assert.equal(readiness.checklist.find((item) => item.id === "operator_decision_gate").status, "waiting_approval");
    assert.equal(readiness.checklist.find((item) => item.id === "openai_credentials").ok, false);
    assert.equal(readiness.checklist.find((item) => item.id === "live_model_flag").ok, false);
    assert.ok(readiness.nextSafeActions.some((action) => action.id === "review_comparison_approval"));
    assert.ok(readiness.nextSafeActions.some((action) => action.id === "connect_key_later"));
    assert.equal(state.decisionInbox.schema, "jarvis_operator_decision_inbox_v1");
    assert.equal(state.decisionInbox.metrics.liveComparisons, 1);
    const comparisonInboxItem = state.decisionInbox.items.find((item) => (
      item.type === "live_comparison"
      && item.approvalId === comparison.liveWorker.approval.id
    ));
    assert.ok(comparisonInboxItem);
    assert.equal(comparisonInboxItem.source, "AI Team");
    assert.equal(comparisonInboxItem.workerName, "Demand Validator");
    assert.equal(comparisonInboxItem.costCapCents, 130);
    assert.equal(comparisonInboxItem.noSpendOccurred, true);
    assert.match(comparisonInboxItem.moneyMove, /capped live worker comparison|same contract checks/i);
    assert.ok(comparisonInboxItem.evidence.some((item) => /No spend has occurred|protected proof/i.test(item)));
    assert.deepEqual(
      comparisonInboxItem.actions.slice(0, 3).map((action) => action.label),
      ["Approve", "Request Changes", "Deny"],
    );

    const beforeComparisonDb = seededDb("pre-openai-readiness-before-comparison");
    try {
      const queuedBeforeComparison = queueAgentWorkbenchProofSuite(beforeComparisonDb, {
        teamName: "Digital product core crew",
        agentIds: ["chief_of_staff", "demand_validator", "offer_architect"],
        subject: "Compact desk cable template",
        buyer: "Home-office workers",
        problem: "They want a tidier desk without buying a full cable-management kit.",
        offer: "A printable cable-planning template and shopping checklist.",
        channel: "Digital Product",
      });
      await runUntilBlocked(beforeComparisonDb, { workflowId: queuedBeforeComparison.workflow.id, maxSteps: 5 });
      let beforeComparison = getPreOpenAiReadinessState(beforeComparisonDb);
      assert.equal(beforeComparison.status, "needs_playbook_rehearsal");
      assert.ok(beforeComparison.nextSafeActions.some((action) => (
        action.action === "run-agent-playbook-rehearsal"
      )));
      const beforeComparisonRehearsal = queueAgentPlaybookRehearsal(beforeComparisonDb, "demand_validator", {
        subject: "Compact desk cable template",
        buyer: "Home-office workers",
        problem: "They want a tidier desk without buying a full cable-management kit.",
        offer: "A printable cable-planning template and shopping checklist.",
        channel: "Digital Product",
      });
      await runUntilBlocked(beforeComparisonDb, { workflowId: beforeComparisonRehearsal.workflow.id, maxSteps: 3 });
      beforeComparison = getPreOpenAiReadinessState(beforeComparisonDb);
      assert.equal(beforeComparison.status, "needs_live_comparison_request");
      assert.ok(beforeComparison.nextSafeActions.some((action) => (
        action.action === "request-workbench-live-comparison"
        && action.workflowId === queuedBeforeComparison.workflow.id
      )));
    } finally {
      beforeComparisonDb.close();
    }
  } finally {
    db.close();
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousKey;
    if (previousLiveModels === undefined) delete process.env.JARVIS_ENABLE_LIVE_MODELS;
    else process.env.JARVIS_ENABLE_LIVE_MODELS = previousLiveModels;
  }
});

test("commercial brain prioritizes operator money moves and continuous improvement", () => {
  const db = seededDb("commercial-brain");
  const state = getDashboardState(db);
  const brain = state.commercialBrain;

  assert.equal(brain.status, "operator_decision_needed");
  assert.match(brain.operatingRule, /operator sees the money move/i);
  assert.ok(brain.principles.some((principle) => principle.id === "demand"));
  assert.ok(brain.principles.some((principle) => principle.id === "feedback"));
  assert.ok(brain.roles.some((role) => role.id === "chief_of_staff"));
  assert.equal(brain.moneyMoves[0].type, "operator_decision");
  assert.equal(brain.moneyMoves[0].approvalId, "appr-digital-product-dry-run");
  assert.match(brain.moneyMoves[0].hypothesis, /approved/i);
  assert.match(brain.moneyMoves[0].successMetric, /Decision recorded/i);
  assert.equal(brain.metrics.pendingDecisions, 1);
  assert.equal(brain.metrics.revenueCents, 0);
  assert.equal(brain.metrics.spendCents, 0);
  assert.deepEqual(brain.improvementLoop.steps, ["Hypothesis", "Smallest useful action", "Expected metric", "Actual result", "Learning", "Improvement"]);
  assert.match(brain.improvementLoop.currentCycle.actualResult, /No revenue/i);

  db.close();
});

test("commercial results ledger records outcomes, learning cycles, and scorecard evidence", () => {
  const db = seededDb("commercial-results");
  const result = recordCommercialResult(db, {
    workflowId: "wf-digital-product-pilot-proof",
    source: "test",
    views: 240,
    clicks: 38,
    leads: 8,
    sales: 4,
    refunds: 0,
    revenueCents: 7600,
    spendCents: 1200,
    timeSpentMinutes: 45,
    notes: "Small controlled channel test produced paid demand.",
  });
  assert.equal(result.learning.verdict, "continue");
  assert.match(result.learning.actual_result, /4 sales/);
  assert.equal(result.aiTeamRun.agentId, "growth_analyst");
  assert.equal(result.aiTeamRun.evalStatus, "passed");

  const feedback = recordCommercialFeedback(db, {
    experimentId: result.experiment.id,
    source: "test",
    sentiment: "positive",
    rating: 5,
    summary: "Buyer liked the template and wanted a business version.",
  });
  assert.equal(feedback.learning.verdict, "continue");
  assert.equal(feedback.aiTeamRun.agentId, "customer_voice_agent");
  assert.equal(feedback.aiTeamRun.evalStatus, "passed");

  const scorecard = upsertWorkflowScorecard(db, "wf-digital-product-pilot-proof", { commercialResultId: result.result.id });
  const state = getDashboardState(db);
  const learningMove = state.commercialBrain.moneyMoves.find((move) => move.type === "learning_signal");
  const aiRunAgents = state.aiTeam.runs.map((runRecord) => runRecord.agent_id);

  assert.equal(state.commercialResults.length, 1);
  assert.equal(state.commercialFeedback.length, 1);
  assert.ok(aiRunAgents.includes("growth_analyst"));
  assert.ok(aiRunAgents.includes("customer_voice_agent"));
  assert.equal(state.commercialLearningCycles.length, 2);
  assert.equal(state.metrics.commercial.sales, 4);
  assert.equal(state.metrics.budget.monthlyRevenueCents, 7600);
  assert.equal(state.metrics.budget.monthlySpendCents, 1200);
  assert.equal(state.commercialBrain.metrics.commercial.profitCents, 6400);
  assert.ok(learningMove);
  assert.equal(learningMove.workflowId, "wf-digital-product-pilot-proof");
  assert.notEqual(scorecard.verdict, "research_required");
  assert.equal(scorecard.metadata.commercialEvidence.sales, 4);
  assert.equal(scorecard.confidence, "medium_with_sales_signal");

  db.close();
});

test("research-to-experiment bridge creates ranked test options and money moves", () => {
  const db = seededDb("research-to-experiment");
  const plan = createResearchToExperimentPlan(db, {
    workflowId: "wf-digital-product-pilot-proof",
    source: "test",
    idea: "Premium Notion finance dashboard for freelancers who want monthly cashflow clarity.",
    buyer: "Freelance designers earning project income",
    problem: "They do not know whether this month is profitable until it is too late.",
    offer: "A Notion cashflow dashboard with setup guide and monthly review checklist",
    channel: "LinkedIn creator posts and freelancer communities",
    priceCents: 2900,
    evidenceSummary: "Freelancers already search for simple cashflow templates and ask for monthly visibility.",
  });
  const state = getDashboardState(db);
  const nextTestMove = state.commercialBrain.moneyMoves.find((move) => move.type === "next_test");

  assert.equal(plan.brief.status, "candidate_tests_ready");
  assert.equal(plan.candidates.length, 3);
  assert.equal(plan.recommended.rank, 1);
  assert.equal(plan.recommended.price_cents, 2900);
  assert.equal(plan.recommended.cost_cap_cents, 0);
  assert.ok(plan.recommended.evidence_score >= 70);
  assert.match(plan.recommended.hypothesis, /Freelance designers/i);
  assert.match(plan.recommended.kill_criteria, /Stop|Do not|Rework/i);
  assert.deepEqual(plan.recommended.metadata.frameworks, ["Money Move Contract", "AARRR funnel", "ICE prioritisation", "Unit Economics Gate", "Build Measure Learn"]);
  assert.equal(state.metrics.commercial.briefs, 1);
  assert.equal(state.metrics.commercial.testCandidates, 3);
  assert.equal(state.metrics.commercial.plannedTests, 3);
  assert.ok(nextTestMove);
  assert.equal(nextTestMove.candidateId, plan.recommended.id);
  assert.match(nextTestMove.successMetric, /lead|sale|reply/i);
  assert.match(nextTestMove.killCriteria, /Stop|Do not|Rework/i);

  db.close();
});

test("completed live research creates one idempotent next-test bridge", () => {
  const db = seededDb("live-research-to-experiment");
  const ts = "2026-07-07T00:00:00.000Z";
  const researchRunId = "research_live_bridge_unit";
  run(
    db,
    `INSERT INTO research_runs (id, workflow_id, task_id, query, provider, mode, status, budget_cents,
      actual_cents, summary, metadata, created_at, completed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      researchRunId,
      "wf-digital-product-pilot-proof",
      null,
      "freelancer cashflow dashboard demand pricing risk",
      "openai_responses_web_search",
      "live",
      "completed_live",
      250,
      220,
      "Live research found active demand for freelancer cashflow templates, but differentiation is needed.",
      toJson({
        subject: "Freelancer cashflow dashboard",
        channel: "Digital Product",
        parsed: {
          verdict: "revise",
          confidence: "medium",
          marketDemand: { finding: "Demand exists", evidence: "Buyers search for cashflow and tax planning templates." },
          competitionPricing: { finding: "Crowded low-price market", evidence: "Comparable templates cluster below premium pricing." },
          freshnessRisk: { finding: "Low if positioned carefully", evidence: "Avoid regulated financial advice claims." },
          recommendation: "Test sharper positioning before building the full product.",
          assumptions: ["Buyer language should be validated with a small audience test."],
        },
        sourceCount: 3,
        model: "gpt-5.5-test",
        responseId: "resp_bridge_unit",
        exactBillingPending: true,
      }),
      ts,
      ts,
    ],
  );
  for (let index = 1; index <= 3; index += 1) {
    run(
      db,
      `INSERT INTO research_sources (id, run_id, title, url, publisher, published_at, retrieved_at, relevance, confidence, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        `src_bridge_${index}`,
        researchRunId,
        `Live source ${index}`,
        `https://example.com/live-source-${index}`,
        "example.com",
        null,
        ts,
        "Shows current market evidence.",
        "high",
        "{}",
      ],
    );
  }

  const first = createResearchToExperimentPlanFromResearch(db, researchRunId, { createdBy: "test" });
  const second = createResearchToExperimentPlanFromResearch(db, researchRunId, { createdBy: "test" });
  const state = getDashboardState(db);
  const bridgeBriefs = state.commercialBriefs.filter((brief) => brief.metadata.sourceResearchRunId === researchRunId);
  const bridgeCandidates = state.commercialTestCandidates.filter((candidate) => candidate.brief_id === first.brief.id);

  assert.equal(first.skipped, false);
  assert.equal(first.alreadyCreated, false);
  assert.equal(first.brief.source, "live_research");
  assert.equal(first.brief.metadata.researchEvidence.verdict, "revise");
  assert.equal(first.brief.metadata.researchEvidence.sourceCount, 3);
  assert.equal(first.candidates.length, 3);
  assert.equal(first.recommended.metadata.sourceResearchRunId, researchRunId);
  assert.equal(first.recommended.metadata.source, "live_research");
  assert.match(first.recommended.hypothesis, /Digital Product|dashboard|cashflow|Freelance/i);
  assert.equal(second.alreadyCreated, true);
  assert.equal(second.brief.id, first.brief.id);
  assert.equal(second.candidates.length, 3);
  assert.equal(bridgeBriefs.length, 1);
  assert.equal(bridgeCandidates.length, 3);
  assert.ok(state.commercialBrain.moneyMoves.some((move) => move.candidateId === first.recommended.id));
  assert.ok(state.events.some((event) => event.type === "commercial_test.live_research_bridge_created"));

  db.close();
});

test("promoting a research test candidate creates a commercial experiment without spend", () => {
  const db = seededDb("promote-research-test");
  const plan = createResearchToExperimentPlan(db, {
    workflowId: "wf-digital-product-pilot-proof",
    idea: "Spreadsheet budget planner for solo consultants",
    buyer: "Solo consultants",
    problem: "They need simple monthly cash and tax visibility.",
    offer: "A spreadsheet budget planner with monthly review prompts",
    channel: "Direct outreach to consultant communities",
    priceCents: 1900,
  });
  const promoted = promoteCandidateToExperiment(db, plan.recommended.id, { promotedBy: "test" });
  const state = getDashboardState(db);
  const candidate = state.commercialTestCandidates.find((item) => item.id === plan.recommended.id);
  const experiment = state.commercialExperiments.find((item) => item.id === promoted.experiment.id);

  assert.equal(promoted.alreadyPromoted, false);
  assert.equal(candidate.status, "promoted");
  assert.equal(candidate.promoted_experiment_id, promoted.experiment.id);
  assert.equal(experiment.workflow_id, "wf-digital-product-pilot-proof");
  assert.equal(experiment.price_cents, 1900);
  assert.equal(experiment.metadata.source, "research_to_experiment_bridge");
  assert.equal(experiment.metadata.candidateId, candidate.id);
  assert.match(experiment.metadata.killCriteria, /Stop|Do not|Rework/i);
  assert.equal(state.metrics.commercial.promotedTests, 1);
  assert.equal(state.metrics.budget.monthlySpendCents, 0);
  assert.equal(state.metrics.budget.monthlyRevenueCents, 0);
  assert.ok(state.events.some((event) => event.type === "commercial_test.promoted"));

  const second = promoteCandidateToExperiment(db, plan.recommended.id, { promotedBy: "test" });
  assert.equal(second.alreadyPromoted, true);
  assert.equal(second.experiment.id, promoted.experiment.id);

  db.close();
});

test("execution pack turns a promoted test into a ready manual market-contact pack", () => {
  const db = seededDb("execution-pack");
  const plan = createResearchToExperimentPlan(db, {
    workflowId: "wf-digital-product-pilot-proof",
    idea: "Template bundle for boutique consultants to package client onboarding.",
    buyer: "Boutique consultants",
    problem: "Client onboarding takes too long and feels inconsistent.",
    offer: "A client onboarding template bundle with checklist and email copy",
    channel: "LinkedIn posts and direct replies to consultant threads",
    priceCents: 3900,
    evidenceSummary: "Consultants already ask for onboarding templates and reusable client systems.",
  });
  const promoted = promoteCandidateToExperiment(db, plan.recommended.id, { promotedBy: "test" });
  let state = getDashboardState(db);
  const packNeeded = state.commercialBrain.moneyMoves.find((move) => move.type === "execution_pack_needed");

  assert.ok(packNeeded);
  assert.equal(packNeeded.experimentId, promoted.experiment.id);
  assert.equal(packNeeded.candidateId, plan.recommended.id);

  const generated = generateExecutionPack(db, { experimentId: promoted.experiment.id, source: "test" });
  state = getDashboardState(db);
  const pack = state.commercialExecutionPacks.find((item) => item.id === generated.pack.id);
  const readyMove = state.commercialBrain.moneyMoves.find((move) => move.type === "execution_ready");

  assert.equal(generated.alreadyGenerated, false);
  assert.equal(pack.status, "ready_to_test");
  assert.equal(pack.experiment_id, promoted.experiment.id);
  assert.equal(pack.candidate_id, plan.recommended.id);
  assert.match(pack.offer_page_copy, /Headline:/);
  assert.match(pack.channel_plan, /Manual channel test/i);
  assert.match(pack.tracking_plan, /Track:/);
  assert.equal(pack.metadata.dryRunOnly, true);
  assert.equal(pack.metadata.externalActionsAllowed, false);
  assert.equal(pack.metadata.aiTeam.productRun.agentId, "product_builder");
  assert.equal(pack.metadata.aiTeam.copyRun.agentId, "copy_conversion_agent");
  assert.equal(pack.metadata.aiTeam.financeRun.agentId, "finance_analyst");
  assert.equal(pack.metadata.aiTeam.distributionRun.agentId, "distribution_operator");
  assert.equal(pack.metadata.aiTeam.chiefRun.agentId, "chief_of_staff");
  assert.equal(pack.metadata.aiTeam.financeRun.evalStatus, "passed");
  assert.equal(pack.metadata.aiTeam.financeRun.evalScore, 100);
  assert.equal(pack.metadata.aiTeam.chiefRun.evalStatus, "passed");
  assert.equal(pack.metadata.aiTeam.chiefRun.evalScore, 100);
  assert.ok(Array.isArray(pack.metadata.outreachVariants));
  assert.ok(readyMove);
  assert.equal(readyMove.executionPackId, pack.id);
  assert.equal(readyMove.source, "chief_of_staff_packet");
  assert.match(readyMove.recommendation, /Approve only the smallest manual test/i);
  assert.equal(state.metrics.commercial.executionPacks, 1);
  assert.equal(state.metrics.commercial.readyExecutionPacks, 1);
  assert.equal(state.metrics.budget.monthlySpendCents, 0);
  const packWorkerRuns = state.aiTeam.runs.filter((runRecord) => runRecord.metadata.executionPackId === pack.id);
  const packHandoffs = state.aiTeam.handoffs.filter((handoff) => handoff.metadata.executionPackId === pack.id);
  const financeRun = packWorkerRuns.find((runRecord) => runRecord.agent_id === "finance_analyst");
  const chiefRun = packWorkerRuns.find((runRecord) => runRecord.agent_id === "chief_of_staff");
  const packet = pack.metadata.aiTeam.chiefOfStaffPacket;
  assert.equal(packWorkerRuns.length, 5);
  assert.deepEqual(
    new Set(packWorkerRuns.map((runRecord) => runRecord.agent_id)),
    new Set(["product_builder", "copy_conversion_agent", "finance_analyst", "distribution_operator", "chief_of_staff"]),
  );
  assert.ok(financeRun);
  assert.ok(chiefRun);
  assert.equal(financeRun.metadata.businessDecision.externalActionsAllowed, false);
  assert.match(financeRun.metadata.businessDecision.moneyMove, /smallest manual test|record real revenue|increasing scope/i);
  assert.equal(financeRun.metadata.unitEconomics.priceCents, 3900);
  assert.equal(financeRun.metadata.unitEconomics.costCapCents, 0);
  assert.ok(financeRun.metadata.unitEconomics.grossMarginCents > 0);
  assert.equal(packet.schema, "jarvis_chief_of_staff_decision_packet_v1");
  assert.equal(packet.owner, "chief_of_staff");
  assert.equal(packet.workerRunIds.financeAndUnitEconomics, pack.metadata.aiTeam.financeRun.runId);
  assert.equal(packet.workerRunIds.chiefOfStaff, pack.metadata.aiTeam.chiefRun.runId);
  assert.equal(packet.costCapCents, 0);
  assert.equal(packet.priceCents, 3900);
  assert.equal(packet.allowedOperatorActions.includes("Approve manual test"), true);
  assert.match(packet.moneyMove, /Approve only the smallest manual test/i);
  assert.match(chiefRun.metadata.businessDecision.moneyMove, /Approve only the smallest manual test/i);
  assert.equal(packHandoffs.length, 1);
  assert.equal(packet.handoffId, packHandoffs[0].id);
  assert.equal(readyMove.handoffId, packHandoffs[0].id);
  assert.equal(packHandoffs[0].from_agent_id, "distribution_operator");
  assert.equal(packHandoffs[0].to_agent_id, "chief_of_staff");
  assert.equal(packHandoffs[0].status, "needs_operator_decision");
  assert.match(packHandoffs[0].decision_needed, /market-contact test/i);
  assert.equal(state.decisionInbox.metrics.handoffs >= 1, true);
  const handoffInboxItem = state.decisionInbox.items.find((item) => item.handoffId === packHandoffs[0].id);
  assert.ok(handoffInboxItem);
  assert.equal(handoffInboxItem.type, "worker_handoff");
  assert.equal(handoffInboxItem.source, "AI Team");
  assert.match(handoffInboxItem.decisionNeeded, /market-contact test/i);
  assert.deepEqual(
    handoffInboxItem.actions.slice(0, 3).map((action) => action.label),
    ["Approve", "Request Changes", "Deny"],
  );
  assert.equal(state.manualMarketCockpit.schema, "jarvis_manual_market_test_cockpit_v1");
  assert.equal(state.manualMarketCockpit.status, "decision_ready");
  assert.equal(state.manualMarketCockpit.metrics.executionPacks, 1);
  assert.equal(state.manualMarketCockpit.metrics.readyPacks, 1);
  assert.equal(state.manualMarketCockpit.metrics.zeroSpendReadyPacks, 1);
  assert.equal(state.manualMarketCockpit.topAction.packId, pack.id);
  assert.equal(state.manualMarketCockpit.topAction.handoffId, packHandoffs[0].id);
  assert.equal(state.manualMarketCockpit.topAction.workerSummary.runs, 5);
  assert.equal(state.manualMarketCockpit.topAction.workerSummary.passed, 5);
  assert.deepEqual(
    state.manualMarketCockpit.topAction.actions.slice(0, 3).map((action) => action.label),
    ["Approve", "Request Changes", "Deny"],
  );
  assert.ok(state.manualMarketCockpit.topAction.actions.some((action) => action.label === "Record Result"));
  assert.ok(state.manualMarketCockpit.topAction.actions.some((action) => action.label === "Mark No Response"));
  assert.match(state.manualMarketCockpit.topAction.copy.trackingPlan, /Track:/i);

  const second = generateExecutionPack(db, { candidateId: plan.recommended.id, source: "test" });
  assert.equal(second.alreadyGenerated, true);
  assert.equal(second.pack.id, pack.id);

  db.close();
});

test("execution pack outcomes feed results, feedback, and learning without live spend", () => {
  const db = seededDb("execution-pack-outcome");
  const plan = createResearchToExperimentPlan(db, {
    workflowId: "wf-digital-product-pilot-proof",
    idea: "Cashflow checklist for project-based freelancers.",
    buyer: "Project-based freelancers",
    problem: "Cashflow surprises make tax and bills stressful.",
    offer: "A cashflow checklist and calendar template",
    channel: "Freelancer newsletter swaps",
    priceCents: 1900,
  });
  const promoted = promoteCandidateToExperiment(db, plan.recommended.id, { promotedBy: "test" });
  const generated = generateExecutionPack(db, { experimentId: promoted.experiment.id, source: "test" });

  const noResponse = recordExecutionPackOutcome(db, generated.pack.id, {
    outcomeType: "no_response",
    notes: "No replies after a small manual audience post.",
  });
  assert.equal(noResponse.outcomeType, "no_response");
  assert.equal(noResponse.recorded.result.spend_cents, 0);
  assert.equal(noResponse.recorded.result.revenue_cents, 0);
  assert.equal(noResponse.recorded.learning.verdict, "needs_evidence");
  assert.equal(noResponse.recorded.aiTeamRun.agentId, "growth_analyst");
  assert.equal(noResponse.pack.status, "waiting_for_signal");
  assert.equal(noResponse.outcomeDecision.schema, "jarvis_chief_of_staff_outcome_packet_v1");
  assert.equal(noResponse.outcomeDecision.owner, "chief_of_staff");
  assert.equal(noResponse.outcomeDecision.workerRunIds.growthAnalysis, noResponse.recorded.aiTeamRun.runId);
  assert.equal(noResponse.outcomeDecision.resultId, noResponse.recorded.result.id);
  assert.equal(noResponse.outcomeDecision.learningId, noResponse.recorded.learning.id);
  assert.ok(noResponse.outcomeDecision.handoffId);
  assert.match(noResponse.outcomeDecision.moneyMove, /Do not build more|stronger measurable buyer signal/i);
  assert.equal(noResponse.pack.metadata.latestOutcomeDecisionPacket.learningId, noResponse.recorded.learning.id);

  const afterNoResponse = getDashboardState(db);
  const noResponseLearning = afterNoResponse.commercialLearningCycles.find((cycle) => cycle.id === noResponse.recorded.learning.id);
  const noResponseMove = afterNoResponse.commercialBrain.moneyMoves.find((move) => move.learningId === noResponse.recorded.learning.id);
  assert.equal(noResponseLearning.metadata.outcomeDecisionPacket.schema, "jarvis_chief_of_staff_outcome_packet_v1");
  assert.equal(noResponseMove.source, "chief_of_staff_outcome_packet");
  assert.equal(noResponseMove.handoffId, noResponse.outcomeDecision.handoffId);

  const reply = recordExecutionPackOutcome(db, generated.pack.id, {
    outcomeType: "reply",
    summary: "One buyer said the format was useful but wanted examples.",
  });
  const state = getDashboardState(db);

  assert.equal(reply.recorded.feedback.summary, "One buyer said the format was useful but wanted examples.");
  assert.equal(reply.recorded.aiTeamRun.agentId, "customer_voice_agent");
  assert.equal(reply.outcomeDecision.schema, "jarvis_chief_of_staff_outcome_packet_v1");
  assert.equal(reply.outcomeDecision.workerRunIds.customerVoice, reply.recorded.aiTeamRun.runId);
  assert.equal(reply.outcomeDecision.feedbackId, reply.recorded.feedback.id);
  assert.equal(reply.outcomeDecision.learningId, reply.recorded.learning.id);
  assert.ok(reply.outcomeDecision.handoffId);
  assert.match(reply.outcomeDecision.moneyMove, /buyer signal|objection/i);
  assert.equal(reply.pack.metadata.latestOutcomeDecisionPacket.learningId, reply.recorded.learning.id);
  assert.equal(state.commercialResults.length, 1);
  assert.equal(state.commercialFeedback.length, 1);
  assert.equal(state.commercialLearningCycles.length, 2);
  assert.equal(state.metrics.budget.monthlySpendCents, 0);
  assert.ok(state.aiTeam.runs.some((runRecord) => runRecord.agent_id === "growth_analyst" && runRecord.metadata.executionPackId === generated.pack.id));
  assert.ok(state.aiTeam.runs.some((runRecord) => runRecord.agent_id === "customer_voice_agent" && runRecord.metadata.executionPackId === generated.pack.id));
  assert.ok(state.aiTeam.runs.some((runRecord) => runRecord.agent_id === "chief_of_staff" && runRecord.metadata.outcomeDecisionPacket?.learningId === noResponse.recorded.learning.id));
  assert.ok(state.aiTeam.runs.some((runRecord) => runRecord.agent_id === "chief_of_staff" && runRecord.metadata.outcomeDecisionPacket?.learningId === reply.recorded.learning.id));
  assert.ok(state.aiTeam.handoffs.some((handoff) => handoff.from_agent_id === "growth_analyst" && handoff.id === noResponse.outcomeDecision.handoffId));
  assert.ok(state.aiTeam.handoffs.some((handoff) => handoff.from_agent_id === "customer_voice_agent" && handoff.id === reply.outcomeDecision.handoffId));
  const replyLearning = state.commercialLearningCycles.find((cycle) => cycle.id === reply.recorded.learning.id);
  const replyMove = state.commercialBrain.moneyMoves.find((move) => move.learningId === reply.recorded.learning.id);
  assert.equal(replyLearning.metadata.outcomeDecisionPacket.feedbackId, reply.recorded.feedback.id);
  assert.equal(replyMove.source, "chief_of_staff_outcome_packet");
  assert.equal(replyMove.handoffId, reply.outcomeDecision.handoffId);
  assert.ok(state.events.some((event) => event.type === "commercial_execution_pack.outcome_recorded"));
  assert.ok(state.events.some((event) => event.type === "commercial_execution_pack.outcome_packet_prepared"));

  db.close();
});

test("learning cycles can generate revised test options without model calls", () => {
  const db = seededDb("learning-revision-plan");
  const plan = createResearchToExperimentPlan(db, {
    workflowId: "wf-digital-product-pilot-proof",
    idea: "Client onboarding checklist for boutique consultants.",
    buyer: "Boutique consultants",
    problem: "Client onboarding creates avoidable admin drag.",
    offer: "A client onboarding checklist and email template pack",
    channel: "Manual LinkedIn post and consultant community replies",
    priceCents: 2900,
  });
  const promoted = promoteCandidateToExperiment(db, plan.recommended.id, { promotedBy: "test" });
  const generated = generateExecutionPack(db, { experimentId: promoted.experiment.id, source: "test" });
  const outcome = recordExecutionPackOutcome(db, generated.pack.id, {
    outcomeType: "result",
    views: 64,
    clicks: 9,
    leads: 3,
    sales: 1,
    revenueCents: 2900,
    spendCents: 0,
    notes: "One buyer paid and two asked for a more agency-specific version.",
  });

  const revision = createRevisionPlanFromLearning(db, outcome.recorded.learning.id, { createdBy: "test" });
  const state = getDashboardState(db);
  const brief = state.commercialBriefs.find((item) => item.id === revision.brief.id);
  const revisedCandidates = state.commercialTestCandidates.filter((item) => item.brief_id === revision.brief.id);
  const revisionEvent = state.events.find((event) => event.type === "commercial_learning.revision_plan_created");
  const nextMove = state.commercialBrain.moneyMoves.find((move) => move.candidateId === revision.recommended.id);

  assert.equal(revision.alreadyCreated, false);
  assert.equal(revision.candidates.length, 3);
  assert.equal(brief.metadata.sourceLearningId, outcome.recorded.learning.id);
  assert.equal(brief.metadata.sourceExecutionPackId, generated.pack.id);
  assert.equal(revisedCandidates.length, 3);
  assert.equal(revisedCandidates[0].metadata.sourceLearningId, outcome.recorded.learning.id);
  assert.match(revision.recommended.offer, /next controlled sample|latest market signal|reworked/i);
  assert.ok(revisionEvent);
  assert.equal(revisionEvent.entity_id, outcome.recorded.learning.id);
  assert.ok(nextMove);
  assert.equal(nextMove.type, "next_test");

  const second = createRevisionPlanFromLearning(db, outcome.recorded.learning.id, { createdBy: "test" });
  assert.equal(second.alreadyCreated, true);
  assert.equal(second.brief.id, revision.brief.id);

  db.close();
});

test("command planning creates staged agent work and human-facing deliverables", () => {
  const db = seededDb("command-plan");
  const result = createCommandPlan(db, {
    text: "Find a profitable digital checklist product for solo service businesses",
    source: "test",
    createFiles: false,
  });
  const state = getDashboardState(db);

  const command = state.commands.find((item) => item.id === result.command.id);
  assert.equal(command.intent, "find_profitable_venture");
  assert.equal(command.status, "planned");
  assert.match(command.raw_text, /digital checklist/i);

  const workflow = state.workflows.find((item) => item.id === result.workflow.id);
  assert.equal(workflow.status, "planned");
  assert.equal(workflow.current_step, "ready for dry-run agent execution");
  assert.equal(workflow.metadata.agentRunner.mode, "plan_only");
  assert.equal(workflow.metadata.agentRunner.liveModels, false);

  const tasks = state.tasks.filter((task) => task.workflow_id === workflow.id);
  assert.equal(tasks.length, 4);
  assert.ok(tasks.every((task) => task.status === "planned"));
  assert.ok(tasks.every((task) => task.cost_budget_cents > 0));
  assert.ok(tasks.some((task) => task.agent === "demand_validator"));
  assert.ok(tasks.some((task) => task.kind === "offer_architecture" && task.agent === "offer_architect"));
  assert.ok(tasks.some((task) => task.kind === "product_action_plan" && task.agent === "product_builder"));
  assert.ok(tasks.some((task) => task.kind === "operator_pack_qc" && task.agent === "chief_of_staff"));

  const deliverables = state.deliverables.filter((deliverable) => deliverable.workflow_id === workflow.id);
  assert.ok(deliverables.length >= 4);
  assert.ok(deliverables.every((deliverable) => deliverable.audience === "operator"));
  assert.ok(deliverables.every((deliverable) => deliverable.human_name.includes(deliverable.title)));
  assert.deepEqual(deliverables.map((deliverable) => deliverable.title), ["Evidence Brief", "Test Pack", "Publish Pack", "Decision Pack"]);
  assert.ok(deliverables.every((deliverable) => deliverable.file_path === null));

  db.close();
});

test("dry-run agent runner executes planned workflow steps with guardrails", async () => {
  const previousPackDir = process.env.JARVIS_APPROVAL_PACK_DIR;
  const packDir = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-codex-pdf-"));
  process.env.JARVIS_APPROVAL_PACK_DIR = packDir;
  const db = seededDb("agent-runner");
  const result = createCommandPlan(db, {
    text: "Evaluate a compact desk cable template digital product idea and prepare a decision pack",
    source: "test",
    createFiles: false,
  });
  const workflowId = result.workflow.id;

  const firstStep = await runOnce(db, { workflowId });
  assert.equal(firstStep.status, "completed");
  assert.equal(firstStep.result.mode, "dry-run-agent");
  assert.equal(firstStep.result.modelPolicy.status, "not_called");
  assert.ok(firstStep.result.modelPolicy.callId);
  assert.equal(firstStep.result.aiTeam.agentId, "demand_validator");
  assert.ok(firstStep.result.aiTeam.runId);
  assert.equal(firstStep.result.aiTeam.evalStatus, "passed");
  assert.equal(firstStep.result.toolPolicy.externalActionsAllowed, false);
  assert.equal(firstStep.result.cost.actualCents, 0);

  let state = getDashboardState(db);
  let workflow = state.workflows.find((item) => item.id === workflowId);
  assert.equal(workflow.status, "agent_running");
  assert.ok(state.deliverables.some((deliverable) => deliverable.workflow_id === workflowId && deliverable.status === "drafting"));

  for (let index = 0; index < 10; index += 1) {
    state = getDashboardState(db);
    const remaining = state.tasks.filter((task) => task.workflow_id === workflowId && ["planned", "queued"].includes(task.status));
    if (remaining.length === 0) break;
    await runOnce(db, { workflowId });
  }

  state = getDashboardState(db);
  workflow = state.workflows.find((item) => item.id === workflowId);
  const command = state.commands.find((item) => item.workflow_id === workflowId);
  const tasks = state.tasks.filter((task) => task.workflow_id === workflowId);
  const deliverables = state.deliverables.filter((deliverable) => deliverable.workflow_id === workflowId);
  const finalTask = tasks.find((task) => task.kind === "operator_pack_qc");
  const marketTask = tasks.find((task) => task.kind === "market_research");
  const modelCalls = state.modelCalls.filter((call) => call.workflow_id === workflowId);
  const researchRun = state.researchRuns.find((run) => run.task_id === marketTask.id);
  const researchSources = state.researchSources.filter((source) => source.run_id === researchRun.id);
  const pdfPack = deliverables.find((deliverable) => deliverable.format === "pdf");
  const scorecard = state.ventureScorecards.find((item) => item.workflow_id === workflowId);

  assert.equal(workflow.status, "ready_for_review");
  assert.equal(workflow.current_step, "operator review pack ready");
  assert.equal(command.status, "ready_for_review");
  assert.ok(tasks.every((task) => task.status === "completed"));
  assert.equal(modelCalls.length, tasks.length);
  assert.ok(modelCalls.every((call) => call.mode === "dry-run" && call.status === "not_called"));
  assert.ok(modelCalls.every((call) => call.actual_cost_cents === 0));
  assert.ok(modelCalls.reduce((sum, call) => sum + call.estimated_cost_cents, 0) > 0);
  assert.equal(state.metrics.modelCalls.actualCostCents, 0);
  assert.ok(deliverables.every((deliverable) => deliverable.status === "ready_for_review"));
  assert.equal(researchRun.status, "needs_live_research");
  assert.equal(researchRun.actual_cents, 0);
  assert.equal(researchRun.metadata.staleDataWarning, true);
  assert.equal(researchSources.length, 3);
  assert.ok(researchSources.every((source) => source.confidence === "pending_live_research"));
  assert.equal(marketTask.result.research.staleDataWarning, true);
  assert.equal(marketTask.result.research.sources.length, 3);
  assert.ok(state.metrics.research.needsLiveResearch >= 1);
  assert.ok(pdfPack.human_name.endsWith("Approval Pack"));
  assert.equal(pdfPack.audience, "operator");
  assert.equal(pdfPack.file_path.endsWith(".pdf"), true);
  assert.equal(fs.existsSync(pdfPack.file_path), true);
  assert.ok(fs.statSync(pdfPack.file_path).size > 1000);
  assert.ok(scorecard);
  assert.equal(scorecard.verdict, "research_required");
  assert.equal(scorecard.confidence, "low_until_live_evidence");
  assert.equal(scorecard.dimensions.evidence_quality.score, 28);
  assert.match(scorecard.recommendation, /live research/i);
  assert.equal(state.metrics.scorecards.researchRequired, 1);
  assert.equal(finalTask.result.humanReviewRequired, true);
  assert.equal(finalTask.result.output.qualityScore, 72);
  assert.equal(finalTask.cost_actual_cents, 0);
  const completedWorkerTasks = tasks.filter((task) => task.result?.output);
  assert.equal(completedWorkerTasks.length, tasks.length);
  assert.ok(completedWorkerTasks.every((task) => task.result.output.businessDecision?.schema === "jarvis_worker_business_decision_v1"));
  assert.ok(completedWorkerTasks.every((task) => task.result.output.businessDecision.externalActionsAllowed === false));
  assert.ok(completedWorkerTasks.every((task) => task.result.output.outputContract?.missing?.length === 0));
  assert.ok(completedWorkerTasks.every((task) => task.result.output.businessDecision.continuousImprovement?.expectedMetric));
  const offerTask = tasks.find((task) => task.kind === "offer_architecture");
  const productTask = tasks.find((task) => task.kind === "product_action_plan");
  assert.ok(offerTask.result.output.contractOutput.offer);
  assert.ok(offerTask.result.output.contractOutput.promise);
  assert.ok(productTask.result.output.contractOutput.asset_plan);
  assert.ok(productTask.result.output.contractOutput.approval_needed);
  assert.ok(state.messages.some((message) => message.subject === "Operator review pack ready" && message.metadata.approvalPack));
  const agentRuns = state.aiTeam.runs.filter((runRecord) => runRecord.workflow_id === workflowId);
  const agentEvals = state.aiTeam.evalResults.filter((evalRecord) => agentRuns.some((runRecord) => runRecord.id === evalRecord.run_id));
  const traces = state.aiTeam.traceEvents.filter((trace) => agentRuns.some((runRecord) => runRecord.id === trace.run_id));
  const handoffs = state.aiTeam.handoffs.filter((handoff) => handoff.workflow_id === workflowId);
  const finalHandoff = handoffs.find((handoff) => handoff.task_id === finalTask.id);
  const runAgents = new Set(agentRuns.map((runRecord) => runRecord.agent_id));
  assert.equal(agentRuns.length, tasks.length);
  assert.deepEqual(
    [...runAgents].sort(),
    ["chief_of_staff", "demand_validator", "offer_architect", "product_builder"],
  );
  assert.ok(agentRuns.every((runRecord) => runRecord.status === "completed"));
  assert.ok(agentRuns.every((runRecord) => runRecord.mode === "dry-run"));
  assert.equal(agentEvals.length, tasks.length);
  assert.ok(agentEvals.every((evalRecord) => evalRecord.status === "passed"));
  assert.ok(traces.some((trace) => trace.type === "guardrails_checked"));
  assert.equal(traces.filter((trace) => trace.type === "contract_checked").length, tasks.length);
  assert.ok(traces.some((trace) => trace.type === "handoff_recorded"));
  assert.ok(handoffs.length >= 1);
  assert.equal(finalHandoff.to_agent_id, "chief_of_staff");
  assert.equal(finalHandoff.status, "needs_operator_decision");
  assert.match(finalHandoff.decision_needed, /approved|denied|changes/i);
  assert.equal(state.metrics.aiTeam.activeHandoffs >= handoffs.length, true);
  assert.ok(state.metrics.aiTeam.completed >= tasks.length);

  db.close();
  if (previousPackDir === undefined) delete process.env.JARVIS_APPROVAL_PACK_DIR;
  else process.env.JARVIS_APPROVAL_PACK_DIR = previousPackDir;
});

test("run-until-blocked executes scoped dry-run workflow to review", async () => {
  const previousPackDir = process.env.JARVIS_APPROVAL_PACK_DIR;
  const packDir = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-codex-loop-pdf-"));
  process.env.JARVIS_APPROVAL_PACK_DIR = packDir;
  const db = seededDb("run-loop");
  const result = createCommandPlan(db, {
    text: "Evaluate a simple invoice template digital product and prepare a decision pack",
    source: "test",
    createFiles: false,
  });
  const workflowId = result.workflow.id;

  try {
    const loop = await runUntilBlocked(db, { workflowId, maxSteps: 12 });
    const state = getDashboardState(db);
    const workflow = state.workflows.find((item) => item.id === workflowId);
    const seedWorkflow = state.workflows.find((item) => item.id === "wf-digital-product-pilot-proof");
    const tasks = state.tasks.filter((task) => task.workflow_id === workflowId);
    const pdfPack = state.deliverables.find((deliverable) => deliverable.workflow_id === workflowId && deliverable.format === "pdf");

    assert.equal(loop.status, "ready_for_review");
    assert.equal(loop.stoppedBy, "completed");
    assert.ok(loop.runId);
    assert.equal(workflow.status, "ready_for_review");
    assert.equal(seedWorkflow.status, "blocked_for_approval");
    assert.ok(loop.stepsRun >= tasks.length);
    assert.ok(tasks.every((task) => task.status === "completed"));
    const runRecord = state.workflowRuns.find((item) => item.id === loop.runId);
    assert.ok(pdfPack);
    assert.equal(fs.existsSync(pdfPack.file_path), true);
    const scorecard = state.ventureScorecards.find((item) => item.workflow_id === workflowId);
    assert.equal(scorecard.verdict, "research_required");
    assert.equal(runRecord.status, "ready_for_review");
    assert.equal(runRecord.steps_run, loop.stepsRun);
    assert.equal(runRecord.stopped_by, "completed");
    assert.deepEqual(runRecord.metadata.stepStatuses, loop.steps.map((step) => step.status));
  } finally {
    db.close();
    if (previousPackDir === undefined) delete process.env.JARVIS_APPROVAL_PACK_DIR;
    else process.env.JARVIS_APPROVAL_PACK_DIR = previousPackDir;
  }
});

test("worker handoff decision requests changes and stops linked workflow", async () => {
  const previousPackDir = process.env.JARVIS_APPROVAL_PACK_DIR;
  const packDir = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-codex-handoff-decision-"));
  process.env.JARVIS_APPROVAL_PACK_DIR = packDir;
  const db = seededDb("handoff-decision");
  const result = createCommandPlan(db, {
    text: "Evaluate a reusable email template digital product and prepare a decision pack",
    source: "test",
    createFiles: false,
  });
  const workflowId = result.workflow.id;

  try {
    await runUntilBlocked(db, { workflowId, maxSteps: 12 });
    const before = getDashboardState(db);
    const handoff = before.aiTeam.handoffs.find((item) => item.workflow_id === workflowId && item.status === "needs_operator_decision");
    assert.ok(handoff);

    const decision = decideAgentHandoff(db, handoff.id, "changes", "Tighten the evidence before I approve this.");
    assert.equal(decision.changed, true);
    assert.equal(decision.decision, "changes");
    assert.equal(decision.handoff.status, "changes_requested");
    assert.equal(decision.handoff.metadata.operatorDecision.note, "Tighten the evidence before I approve this.");
    assert.ok(decision.handoff.resolved_at);

    const workflow = get(db, "SELECT status, current_step, approval_required FROM workflows WHERE id = ?", [workflowId]);
    assert.equal(workflow.status, "needs_changes");
    assert.equal(workflow.current_step, "worker handoff needs changes");
    assert.equal(workflow.approval_required, 1);
    assert.ok(get(db, "SELECT id FROM agent_trace_events WHERE run_id = ? AND type = ?", [handoff.from_run_id, "handoff_decided"]));
    assert.ok(get(db, "SELECT id FROM events WHERE type = ? AND entity_id = ?", ["agent.handoff_decided", handoff.id]));
    assert.ok(get(db, "SELECT id FROM messages WHERE subject = ? AND status = ?", ["Worker handoff needs changes", "open"]));

    const after = getDashboardState(db);
    const decided = after.aiTeam.handoffs.find((item) => item.id === handoff.id);
    assert.equal(decided.status, "changes_requested");
    assert.equal(after.metrics.aiTeam.decisionHandoffs < before.metrics.aiTeam.decisionHandoffs, true);
  } finally {
    db.close();
    if (previousPackDir === undefined) delete process.env.JARVIS_APPROVAL_PACK_DIR;
    else process.env.JARVIS_APPROVAL_PACK_DIR = previousPackDir;
  }
});

test("approved worker handoff queues and runs Chief of Staff follow-up", async () => {
  const previousPackDir = process.env.JARVIS_APPROVAL_PACK_DIR;
  const packDir = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-codex-handoff-followup-"));
  process.env.JARVIS_APPROVAL_PACK_DIR = packDir;
  const db = seededDb("handoff-followup");
  const result = createCommandPlan(db, {
    text: "Evaluate a reusable onboarding checklist digital product and prepare a decision pack",
    source: "test",
    createFiles: false,
  });
  const workflowId = result.workflow.id;

  try {
    await runUntilBlocked(db, { workflowId, maxSteps: 12 });
    const before = getDashboardState(db);
    const handoff = before.aiTeam.handoffs.find((item) => item.workflow_id === workflowId && item.status === "needs_operator_decision");
    assert.ok(handoff);

    const decision = decideAgentHandoff(db, handoff.id, "approve", "Use this as the next internal steering step.");
    assert.equal(decision.changed, true);
    assert.equal(decision.handoff.status, "approved_for_next_step");
    assert.equal(decision.followupTask.kind, "handoff_followup");
    assert.equal(decision.followupTask.agent, "chief_of_staff");
    assert.equal(decision.followupTask.status, "queued");
    assert.equal(decision.handoff.metadata.operatorDecision.followupTaskId, decision.followupTask.id);

    let workflow = get(db, "SELECT status, current_step FROM workflows WHERE id = ?", [workflowId]);
    assert.equal(workflow.status, "agent_running");
    assert.equal(workflow.current_step, "chief of staff follow-up queued");
    assert.ok(get(db, "SELECT id FROM agent_trace_events WHERE run_id = ? AND type = ?", [handoff.from_run_id, "handoff_followup_queued"]));
    assert.ok(get(db, "SELECT id FROM events WHERE type = ? AND entity_id = ?", ["agent.handoff_followup_queued", decision.followupTask.id]));

    const runResult = await runOnce(db, { workflowId });
    assert.equal(runResult.status, "completed");
    assert.equal(runResult.task.id, decision.followupTask.id);
    assert.equal(runResult.result.aiTeam.agentId, "chief_of_staff");
    assert.equal(runResult.result.aiTeam.evalStatus, "passed");
    assert.match(runResult.result.output.summary, /approved handoff/i);
    assert.ok(runResult.result.output.commercialNextAction);
    assert.equal(runResult.result.output.commercialNextAction.workflowId, workflowId);
    assert.equal(runResult.result.output.commercialNextAction.taskId, decision.followupTask.id);
    assert.equal(runResult.result.output.commercialNextAction.handoffId, handoff.id);
    assert.equal(runResult.result.output.commercialNextAction.operatorDecisionRequired, true);
    assert.equal(runResult.result.output.commercialNextAction.externalActionsAllowed, false);
    assert.ok(runResult.result.output.commercialNextAction.hardStops.includes("publishing"));
    assert.equal(runResult.result.output.businessDecision.schema, "jarvis_worker_business_decision_v1");
    assert.equal(runResult.result.output.businessDecision.externalActionsAllowed, false);
    assert.ok(runResult.result.output.businessDecision.moneyMove);
    assert.ok(runResult.result.output.businessDecision.continuousImprovement.expectedMetric);
    assert.equal(runResult.result.output.outputContract.missing.length, 0);

    const after = getDashboardState(db);
    const completedTask = after.tasks.find((task) => task.id === decision.followupTask.id);
    const followupRun = after.aiTeam.runs.find((runRecord) => runRecord.task_id === decision.followupTask.id);
    const nextActionMove = after.commercialBrain.moneyMoves.find((move) => move.type === "chief_of_staff_next_action");
    workflow = after.workflows.find((item) => item.id === workflowId);
    assert.equal(completedTask.status, "completed");
    assert.equal(followupRun.agent_id, "chief_of_staff");
    assert.equal(nextActionMove.taskId, decision.followupTask.id);
    assert.equal(nextActionMove.workflowId, workflowId);
    assert.match(nextActionMove.recommendation, /approved handoff|protected action|risk|test/i);
    assert.equal(workflow.status, "ready_for_review");
    assert.ok(get(db, "SELECT id FROM agent_trace_events WHERE run_id = ? AND type = ?", [followupRun.id, "commercial_next_action_recommended"]));
    assert.ok(get(db, "SELECT id FROM events WHERE type = ? AND entity_id = ?", ["commercial.next_action_recommended", decision.followupTask.id]));
    assert.ok(get(db, "SELECT id FROM messages WHERE subject = ? AND task_id = ?", ["Chief of Staff next business action ready", decision.followupTask.id]));
  } finally {
    db.close();
    if (previousPackDir === undefined) delete process.env.JARVIS_APPROVAL_PACK_DIR;
    else process.env.JARVIS_APPROVAL_PACK_DIR = previousPackDir;
  }
});

test("dry-run agent runner retries recoverable failures", async () => {
  const db = seededDb("agent-retry");
  const result = createCommandPlan(db, {
    text: "Evaluate a reusable study planner template and prepare a decision pack",
    source: "test",
    createFiles: false,
  });
  const workflowId = result.workflow.id;
  const task = get(db, "SELECT id, payload FROM tasks WHERE workflow_id = ? AND kind = ?", [workflowId, "market_research"]);
  const payload = JSON.parse(task.payload);

  run(
    db,
    "UPDATE tasks SET payload = ? WHERE id = ?",
    [toJson({ ...payload, failureProof: { failFirstAttempt: true, message: "Recoverable dry-run proof failure" } }), task.id],
  );

  const first = await runOnce(db, { workflowId });
  assert.equal(first.status, "queued");
  assert.equal(first.retries, 1);
  assert.match(first.error, /Recoverable dry-run proof failure/);

  let state = getDashboardState(db);
  let workflow = state.workflows.find((item) => item.id === workflowId);
  let retriedTask = state.tasks.find((item) => item.id === task.id);
  assert.equal(workflow.status, "agent_retrying");
  assert.equal(retriedTask.status, "queued");
  assert.equal(retriedTask.retries, 1);
  assert.match(retriedTask.error, /Recoverable dry-run proof failure/);

  const retryEvent = get(db, "SELECT type, level FROM events WHERE entity_id = ? ORDER BY id DESC LIMIT 1", [task.id]);
  assert.equal(retryEvent.type, "task.retry");
  assert.equal(retryEvent.level, "warn");

  const second = await runOnce(db, { workflowId });
  assert.equal(second.status, "completed");
  assert.equal(second.result.mode, "dry-run-agent");

  state = getDashboardState(db);
  workflow = state.workflows.find((item) => item.id === workflowId);
  retriedTask = state.tasks.find((item) => item.id === task.id);
  assert.equal(workflow.status, "agent_running");
  assert.equal(retriedTask.status, "completed");
  assert.equal(retriedTask.retries, 1);
  assert.equal(retriedTask.error, null);
  assert.equal(retriedTask.result.cost.actualCents, 0);

  db.close();
});

test("dry-run agent runner escalates exhausted failures", async () => {
  const db = seededDb("agent-failure");
  const result = createCommandPlan(db, {
    text: "Evaluate a home office checklist digital product and prepare a decision pack",
    source: "test",
    createFiles: false,
  });
  const workflowId = result.workflow.id;
  const task = get(db, "SELECT id, payload FROM tasks WHERE workflow_id = ? AND kind = ?", [workflowId, "market_research"]);
  const payload = JSON.parse(task.payload);

  run(
    db,
    "UPDATE tasks SET max_retries = 0, payload = ? WHERE id = ?",
    [toJson({ ...payload, failureProof: { alwaysFail: true, message: "Permanent dry-run proof failure" } }), task.id],
  );

  const failed = await runOnce(db, { workflowId });
  assert.equal(failed.status, "failed");
  assert.equal(failed.retries, 1);
  assert.match(failed.error, /Permanent dry-run proof failure/);

  const state = getDashboardState(db);
  const workflow = state.workflows.find((item) => item.id === workflowId);
  const command = state.commands.find((item) => item.workflow_id === workflowId);
  const failedTask = state.tasks.find((item) => item.id === task.id);
  const downstream = state.tasks.filter((item) => item.workflow_id === workflowId && item.id !== task.id);
  const message = state.messages.find((item) => item.task_id === task.id && item.severity === "urgent");

  assert.equal(workflow.status, "failed");
  assert.equal(workflow.current_step, "failed: Prepare the Evidence Brief");
  assert.equal(command.status, "failed");
  assert.equal(failedTask.status, "failed");
  assert.equal(failedTask.retries, 1);
  assert.ok(downstream.every((item) => item.status === "cancelled"));
  assert.equal(message.subject, "Task failed: Prepare the Evidence Brief");
  assert.match(message.body, /Permanent dry-run proof failure/);

  const failureEvent = get(db, "SELECT type, level FROM events WHERE entity_id = ? ORDER BY id DESC LIMIT 1", [task.id]);
  assert.equal(failureEvent.type, "task.failed");
  assert.equal(failureEvent.level, "error");

  db.close();
});

test("runtime monitor records findings and escalates stale running tasks", () => {
  const db = seededDb("monitor");
  const staleAt = "2026-01-01T00:00:00.000Z";
  run(
    db,
    `INSERT INTO tasks (id, workflow_id, title, kind, agent, status, priority, payload, result, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      "task-monitor-stale",
      "wf-digital-product-pilot-proof",
      "Stale monitor proof task",
      "goal_planning",
      "orchestrator",
      "running",
      1,
      toJson({}),
      toJson({}),
      staleAt,
      staleAt,
    ],
  );

  const result = runMonitorCycle(db, { staleTaskMinutes: 1 });
  assert.equal(result.status, "critical");
  assert.equal(result.severity, "error");
  assert.ok(result.findingCount >= 1);
  assert.ok(result.findings.some((finding) => finding.entityId === "task-monitor-stale" && finding.severity === "error"));

  const state = getDashboardState(db);
  const monitorRun = state.monitorRuns.find((runRecord) => runRecord.id === result.id);
  const staleFinding = state.monitorFindings.find((finding) => finding.entity_id === "task-monitor-stale");
  const urgentMessage = state.messages.find((message) => message.subject.includes("Task may be stuck"));

  assert.equal(monitorRun.status, "critical");
  assert.equal(monitorRun.finding_count, result.findingCount);
  assert.equal(staleFinding.status, "open");
  assert.equal(state.metrics.monitor.latestStatus, "critical");
  assert.ok(state.metrics.monitor.criticalFindings >= 1);
  assert.ok(urgentMessage);

  const repeatedRun = runMonitorCycle(db, { staleTaskMinutes: 1 });
  const repeatedFinding = get(db, "SELECT * FROM monitor_findings WHERE id = ?", [staleFinding.id]);
  assert.equal(repeatedRun.status, "critical");
  assert.equal(repeatedFinding.id, staleFinding.id);
  assert.equal(repeatedFinding.occurrence_count, 2);
  assert.equal(repeatedFinding.first_seen, staleFinding.first_seen);
  assert.ok(Date.parse(repeatedFinding.last_seen) >= Date.parse(repeatedFinding.first_seen));

  db.close();
});

test("scheduler seeds maintenance jobs and runs monitor job", async () => {
  const db = seededDb("scheduler-monitor");
  ensureSchedulerJobs(db);

  let state = getDashboardState(db);
  const monitorJob = state.schedulerJobs.find((job) => job.id === "job-monitor-cycle");
  const safeWorkJob = state.schedulerJobs.find((job) => job.id === "job-safe-work-loop");
  assert.equal(state.schedulerJobs.length, 3);
  assert.equal(monitorJob.status, "enabled");
  assert.equal(safeWorkJob.status, "disabled");
  assert.equal(state.metrics.scheduler.enabled, 2);

  const result = await runSchedulerJob(db, "job-monitor-cycle", { manual: true });
  assert.equal(result.status, "completed");
  assert.equal(result.result.kind, "monitor_cycle");
  assert.ok(result.result.monitorRunId);

  state = getDashboardState(db);
  assert.equal(state.schedulerRuns.length, 1);
  assert.equal(state.metrics.scheduler.latestRunStatus, "completed");
  assert.ok(state.monitorRuns.some((runRecord) => runRecord.id === result.result.monitorRunId));

  db.close();
});

test("scheduler keeps safe work disabled until explicitly enabled", async () => {
  const previousPackDir = process.env.JARVIS_APPROVAL_PACK_DIR;
  const packDir = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-codex-scheduler-pdf-"));
  process.env.JARVIS_APPROVAL_PACK_DIR = packDir;
  const db = seededDb("scheduler-safe-work");
  ensureSchedulerJobs(db);

  try {
    const due = await runDueSchedulerJobs(db, { limit: 5 });
    assert.equal(due.dueCount, 2);
    assert.equal(due.runs[0].jobId, "job-monitor-cycle");
    assert.equal(due.runs[1].jobId, "job-weekly-executive-digest");

    const skipped = await runSchedulerJob(db, "job-safe-work-loop", { manual: true });
    assert.equal(skipped.status, "skipped");
    assert.equal(skipped.result.reason, "job_disabled");

    setSchedulerJobStatus(db, "job-safe-work-loop", "enabled");
    const planned = createCommandPlan(db, {
      text: "Evaluate a compact bookkeeping checklist digital product and prepare a decision pack",
      source: "test",
      createFiles: false,
    });
    const runResult = await runSchedulerJob(db, "job-safe-work-loop", { manual: true, maxSteps: 12 });

    assert.equal(runResult.status, "completed");
    assert.equal(runResult.result.kind, "safe_work_loop");
    assert.equal(runResult.result.workflowId, planned.workflow.id);
    assert.equal(runResult.result.status, "ready_for_review");
    assert.ok(runResult.result.workflowRunId);

    const state = getDashboardState(db);
    const workflow = state.workflows.find((item) => item.id === planned.workflow.id);
    assert.equal(workflow.status, "ready_for_review");
    assert.ok(state.schedulerRuns.some((runRecord) => runRecord.id === runResult.id && runRecord.status === "completed"));
  } finally {
    db.close();
    if (previousPackDir === undefined) delete process.env.JARVIS_APPROVAL_PACK_DIR;
    else process.env.JARVIS_APPROVAL_PACK_DIR = previousPackDir;
  }
});

test("runtime does not execute blocked work before approval", async () => {
  const db = seededDb("blocked");
  const result = await runOnce(db);
  const task = get(db, "SELECT status FROM tasks WHERE id = ?", ["task-digital-product-dry-run"]);

  assert.equal(result.status, "blocked");
  assert.equal(task.status, "blocked");
  assert.match(result.message, /approval/i);

  const state = getDashboardState(db);
  const notices = state.notificationOutbox.filter((notice) => notice.approval_id === "appr-digital-product-dry-run");
  const tokens = state.approvalActionTokens.filter((token) => token.approval_id === "appr-digital-product-dry-run");
  assert.equal(notices.length, 1);
  assert.equal(notices[0].status, "queued_dry_run");
  assert.equal(notices[0].mode, "dry-run");
  assert.equal(notices[0].metadata.requiresPost, true);
  assert.equal(tokens.length, 3);
  assert.deepEqual(tokens.map((token) => token.decision).sort(), ["approved", "needs_changes", "rejected"]);
  assert.ok(tokens.every((token) => token.status === "active"));
  assert.equal(state.metrics.notifications.dryRunOutbox, 1);
  assert.equal(result.escalations.length, 1);

  const second = await runOnce(db);
  const secondState = getDashboardState(db);
  assert.equal(second.status, "blocked");
  assert.equal(secondState.notificationOutbox.filter((notice) => notice.approval_id === "appr-digital-product-dry-run").length, 1);

  db.close();
});

test("approval email reply can decide a pending approval", async () => {
  const db = seededDb("reply-approval");
  await runOnce(db);

  const result = processApprovalReply(db, {
    approvalId: "appr-digital-product-dry-run",
    sender: "operator@example.test",
    subject: "Re: Approval needed",
    body: "Approve\nLooks good to proceed with the dry-run proof.",
  });

  assert.equal(result.status, "processed");
  assert.equal(result.decision, "approved");
  assert.equal(result.approval.status, "approved");

  const state = getDashboardState(db);
  const task = state.tasks.find((item) => item.id === "task-digital-product-dry-run");
  assert.equal(task.status, "queued");
  assert.equal(state.inboundMessages.length, 1);
  assert.equal(state.inboundMessages[0].status, "processed");
  assert.equal(state.inboundMessages[0].decision, "approved");

  db.close();
});

test("unclear approval email reply is recorded without deciding", async () => {
  const db = seededDb("reply-unclear");
  await runOnce(db);

  const result = processApprovalReply(db, {
    approvalId: "appr-digital-product-dry-run",
    sender: "operator@example.test",
    subject: "Re: Approval needed",
    body: "Can you explain the risk first?",
  });

  assert.equal(result.status, "needs_operator_review");
  assert.equal(result.changed, false);

  const state = getDashboardState(db);
  const approval = state.approvals.find((item) => item.id === "appr-digital-product-dry-run");
  const reviewMessage = state.messages.find((item) => item.subject === "Approval reply needs review");
  assert.equal(approval.status, "pending");
  assert.equal(state.inboundMessages[0].status, "needs_operator_review");
  assert.equal(state.metrics.notifications.inboundNeedsReview, 1);
  assert.ok(reviewMessage);

  db.close();
});

test("approval action token records operator decision", async () => {
  const db = seededDb("approval-token");
  await runOnce(db);

  let state = getDashboardState(db);
  const approveToken = state.approvalActionTokens.find(
    (token) => token.approval_id === "appr-digital-product-dry-run" && token.decision === "approved",
  );
  assert.ok(approveToken);

  const decision = decideApprovalByToken(db, approveToken.token, "token approval test");
  assert.equal(decision.changed, true);
  assert.equal(decision.approval.status, "approved");

  state = getDashboardState(db);
  const tokens = state.approvalActionTokens.filter((token) => token.approval_id === "appr-digital-product-dry-run");
  const used = tokens.find((token) => token.id === approveToken.id);
  const superseded = tokens.filter((token) => token.id !== approveToken.id);
  const queued = state.tasks.find((task) => task.id === "task-digital-product-dry-run");

  assert.equal(used.status, "used");
  assert.ok(superseded.every((token) => token.status === "superseded"));
  assert.equal(queued.status, "queued");

  db.close();
});

test("live research readiness and smoke test create approval-gated work without spend", () => {
  const previousKey = process.env.OPENAI_API_KEY;
  const previousLiveResearch = process.env.JARVIS_ENABLE_LIVE_RESEARCH;
  const previousDisabledAdapter = process.env.JARVIS_DISABLE_LIVE_RESEARCH_ADAPTER;
  delete process.env.OPENAI_API_KEY;
  delete process.env.JARVIS_ENABLE_LIVE_RESEARCH;
  delete process.env.JARVIS_DISABLE_LIVE_RESEARCH_ADAPTER;

  const db = seededDb("live-research-smoke");
  try {
    let readiness = getLiveResearchReadiness(db);
    assert.equal(readiness.ready, false);
    assert.equal(readiness.credentialsConfigured, false);
    assert.equal(readiness.liveFlagEnabled, false);
    assert.equal(readiness.adapterReady, true);
    assert.ok(readiness.blockers.some((blocker) => blocker.includes("OpenAI API key")));
    assert.ok(readiness.checklist.some((item) => item.id === "approval" && item.status === "blocked"));

    const smoke = createLiveResearchSmokeTest(db, { estimatedCostCents: 100 });
    assert.equal(smoke.status, "prepared");
    assert.equal(smoke.estimatedCostCents, 100);
    assert.equal(smoke.liveResearch.status, "blocked");
    assert.equal(smoke.liveResearch.approval.status, "pending");
    assert.equal(smoke.liveResearch.approval.scope, "live_research_spend");

    const state = getDashboardState(db);
    const workflow = state.workflows.find((item) => item.id === smoke.workflow.id);
    const task = state.tasks.find((item) => item.id === smoke.liveResearch.task.id);
    const approval = state.approvals.find((item) => item.id === smoke.liveResearch.approval.id);
    const cost = state.costs.find((item) => item.id === `cost_spend_${task.id}`);
    const event = state.events.find((item) => item.type === "live_research.smoke_test_prepared");

    assert.equal(workflow.status, "blocked_for_approval");
    assert.equal(task.status, "blocked");
    assert.equal(task.cost_budget_cents, 100);
    assert.equal(approval.payload.estimatedCostCents, 100);
    assert.equal(cost.amount_cents, 0);
    assert.equal(cost.status, "approval_requested");
    assert.equal(state.runtime.liveResearch.pendingApprovals, 1);
    assert.equal(state.runtime.liveResearch.smokeTests, 1);
    assert.equal(state.runtime.liveResearch.ready, false);
    assert.ok(event);
  } finally {
    db.close();
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousKey;
    if (previousLiveResearch === undefined) delete process.env.JARVIS_ENABLE_LIVE_RESEARCH;
    else process.env.JARVIS_ENABLE_LIVE_RESEARCH = previousLiveResearch;
    if (previousDisabledAdapter === undefined) delete process.env.JARVIS_DISABLE_LIVE_RESEARCH_ADAPTER;
    else process.env.JARVIS_DISABLE_LIVE_RESEARCH_ADAPTER = previousDisabledAdapter;
  }
});

test("live AI worker readiness and smoke test create approval-gated work without spend", () => {
  const previousKey = process.env.OPENAI_API_KEY;
  const previousLiveModels = process.env.JARVIS_ENABLE_LIVE_MODELS;
  const previousDisabledAdapter = process.env.JARVIS_DISABLE_LIVE_AI_WORKER_ADAPTER;
  const previousDisabledSdk = process.env.JARVIS_DISABLE_OPENAI_AGENTS_SDK;
  delete process.env.OPENAI_API_KEY;
  delete process.env.JARVIS_ENABLE_LIVE_MODELS;
  delete process.env.JARVIS_DISABLE_LIVE_AI_WORKER_ADAPTER;
  delete process.env.JARVIS_DISABLE_OPENAI_AGENTS_SDK;

  const db = seededDb("live-ai-worker-smoke");
  try {
    let readiness = getLiveAiWorkerReadiness(db);
    assert.equal(readiness.ready, false);
    assert.equal(readiness.credentialsConfigured, false);
    assert.equal(readiness.liveFlagEnabled, false);
    assert.equal(readiness.adapterReady, true);
    assert.ok(readiness.blockers.some((blocker) => blocker.includes("OpenAI API key")));
    assert.ok(readiness.checklist.some((item) => item.id === "approval" && item.status === "blocked"));

    const smoke = createLiveAiWorkerSmokeTest(db, { estimatedCostCents: 100 });
    assert.equal(smoke.status, "prepared");
    assert.equal(smoke.estimatedCostCents, 100);
    assert.equal(smoke.liveWorker.status, "blocked");
    assert.equal(smoke.liveWorker.approval.status, "pending");
    assert.equal(smoke.liveWorker.approval.scope, "live_ai_worker_spend");

    const state = getDashboardState(db);
    const workflow = state.workflows.find((item) => item.id === smoke.workflow.id);
    const task = state.tasks.find((item) => item.id === smoke.liveWorker.task.id);
    const approval = state.approvals.find((item) => item.id === smoke.liveWorker.approval.id);
    const cost = state.costs.find((item) => item.id === `cost_spend_${task.id}`);
    const event = state.events.find((item) => item.type === "live_ai_worker.smoke_test_prepared");

    assert.equal(workflow.status, "blocked_for_approval");
    assert.equal(task.status, "blocked");
    assert.equal(task.kind, "live_ai_worker_execution");
    assert.equal(task.cost_budget_cents, 100);
    assert.equal(approval.payload.estimatedCostCents, 100);
    assert.deepEqual(approval.payload.providerRequirements.env, ["OPENAI_API_KEY"]);
    assert.ok(approval.payload.providerRequirements.flags.includes("JARVIS_ENABLE_LIVE_MODELS"));
    assert.ok(approval.payload.providerRequirements.capabilities.includes("openai_agents_sdk_runner"));
    assert.equal(cost.amount_cents, 0);
    assert.equal(cost.status, "approval_requested");
    assert.equal(state.runtime.liveAiWorkers.pendingApprovals, 1);
    assert.equal(state.runtime.liveAiWorkers.smokeTests, 1);
    assert.equal(state.runtime.liveAiWorkers.ready, false);
    assert.equal(state.metrics.aiWorkers.liveWorkerRequests, 1);
    assert.ok(event);
  } finally {
    db.close();
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousKey;
    if (previousLiveModels === undefined) delete process.env.JARVIS_ENABLE_LIVE_MODELS;
    else process.env.JARVIS_ENABLE_LIVE_MODELS = previousLiveModels;
    if (previousDisabledAdapter === undefined) delete process.env.JARVIS_DISABLE_LIVE_AI_WORKER_ADAPTER;
    else process.env.JARVIS_DISABLE_LIVE_AI_WORKER_ADAPTER = previousDisabledAdapter;
    if (previousDisabledSdk === undefined) delete process.env.JARVIS_DISABLE_OPENAI_AGENTS_SDK;
    else process.env.JARVIS_DISABLE_OPENAI_AGENTS_SDK = previousDisabledSdk;
  }
});

test("live research request creates approval gate and blocks until provider is ready", async () => {
  const previousKey = process.env.OPENAI_API_KEY;
  const previousLiveResearch = process.env.JARVIS_ENABLE_LIVE_RESEARCH;
  const previousAdapterReady = process.env.JARVIS_LIVE_RESEARCH_ADAPTER_READY;
  const previousPackDir = process.env.JARVIS_APPROVAL_PACK_DIR;
  const packDir = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-codex-live-research-pdf-"));
  delete process.env.OPENAI_API_KEY;
  delete process.env.JARVIS_ENABLE_LIVE_RESEARCH;
  delete process.env.JARVIS_LIVE_RESEARCH_ADAPTER_READY;
  process.env.JARVIS_APPROVAL_PACK_DIR = packDir;

  const db = seededDb("live-research-request");
  try {
    const planned = createCommandPlan(db, {
      text: "Evaluate a premium Notion finance dashboard template and prepare a decision pack",
      source: "test",
      createFiles: false,
    });
    const workflowId = planned.workflow.id;
    await runUntilBlocked(db, { workflowId, maxSteps: 12 });

    const requested = requestLiveResearch(db, workflowId, { estimatedCostCents: 180 });
    assert.equal(requested.status, "blocked");
    assert.equal(requested.approval.status, "pending");
    assert.equal(requested.approval.scope, "live_research_spend");
    assert.equal(requested.spendGate.estimatedCostCents, 180);

    let state = getDashboardState(db);
    const liveTask = state.tasks.find((task) => task.workflow_id === workflowId && task.kind === "live_market_research");
    const approval = state.approvals.find((item) => item.id === requested.approval.id);
    const notice = state.notificationOutbox.find((item) => item.approval_id === approval.id);
    const cost = state.costs.find((item) => item.workflow_id === workflowId && item.status === "approval_requested");

    assert.ok(liveTask);
    assert.equal(liveTask.status, "blocked");
    assert.equal(liveTask.cost_budget_cents, 180);
    assert.equal(liveTask.result.spendApprovalRequired, true);
    assert.equal(approval.payload.provider, "openai-web-search");
    assert.deepEqual(approval.payload.providerRequirements.env, ["OPENAI_API_KEY"]);
    assert.ok(approval.payload.providerRequirements.flags.includes("JARVIS_ENABLE_LIVE_RESEARCH"));
    assert.ok(approval.payload.providerRequirements.capabilities.includes("live_research_adapter"));
    assert.equal(notice.status, "queued_dry_run");
    assert.equal(cost.amount_cents, 0);
    assert.equal(state.metrics.research.liveResearchRequests, 1);
    assert.equal(state.metrics.research.blockedLiveResearch, 1);
    assert.equal(state.metrics.research.providerReady, false);

    decideApproval(db, approval.id, "approved", "approve capped live research proof");
    const providerBlocked = await runOnce(db, { workflowId });
    assert.equal(providerBlocked.status, "blocked");
    assert.equal(providerBlocked.spendGate.providerBlocked, true);
    assert.equal(providerBlocked.spendGate.noSpendOccurred, true);
    assert.ok(providerBlocked.spendGate.missingRequirements.some((requirement) => requirement.name === "OPENAI_API_KEY"));
    assert.ok(providerBlocked.spendGate.missingRequirements.some((requirement) => requirement.name === "JARVIS_ENABLE_LIVE_RESEARCH"));

    state = getDashboardState(db);
    const blockedTask = state.tasks.find((task) => task.id === liveTask.id);
    const providerMessage = state.messages.find((message) => message.task_id === liveTask.id && message.subject.startsWith("Provider setup needed"));
    assert.equal(blockedTask.status, "blocked");
    assert.equal(blockedTask.result.providerBlocked, true);
    assert.equal(blockedTask.result.noSpendOccurred, true);
    assert.ok(providerMessage);
    assert.equal(providerMessage.severity, "urgent");
  } finally {
    db.close();
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousKey;
    if (previousLiveResearch === undefined) delete process.env.JARVIS_ENABLE_LIVE_RESEARCH;
    else process.env.JARVIS_ENABLE_LIVE_RESEARCH = previousLiveResearch;
    if (previousAdapterReady === undefined) delete process.env.JARVIS_LIVE_RESEARCH_ADAPTER_READY;
    else process.env.JARVIS_LIVE_RESEARCH_ADAPTER_READY = previousAdapterReady;
    if (previousPackDir === undefined) delete process.env.JARVIS_APPROVAL_PACK_DIR;
    else process.env.JARVIS_APPROVAL_PACK_DIR = previousPackDir;
  }
});

test("live AI worker request creates approval gate and blocks until provider is ready", async () => {
  const previousKey = process.env.OPENAI_API_KEY;
  const previousLiveModels = process.env.JARVIS_ENABLE_LIVE_MODELS;
  const previousDisabledAdapter = process.env.JARVIS_DISABLE_LIVE_AI_WORKER_ADAPTER;
  const previousDisabledSdk = process.env.JARVIS_DISABLE_OPENAI_AGENTS_SDK;
  const previousPackDir = process.env.JARVIS_APPROVAL_PACK_DIR;
  const packDir = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-codex-live-worker-pdf-"));
  delete process.env.OPENAI_API_KEY;
  delete process.env.JARVIS_ENABLE_LIVE_MODELS;
  delete process.env.JARVIS_DISABLE_LIVE_AI_WORKER_ADAPTER;
  delete process.env.JARVIS_DISABLE_OPENAI_AGENTS_SDK;
  process.env.JARVIS_APPROVAL_PACK_DIR = packDir;

  const db = seededDb("live-ai-worker-request");
  try {
    const planned = createCommandPlan(db, {
      text: "Evaluate a premium Notion finance dashboard template and prepare a decision pack",
      source: "test",
      createFiles: false,
    });
    const workflowId = planned.workflow.id;
    await runUntilBlocked(db, { workflowId, maxSteps: 12 });

    const requested = requestLiveAiWorker(db, workflowId, { estimatedCostCents: 120, worker: "demand_validator" });
    assert.equal(requested.status, "blocked");
    assert.equal(requested.worker.id, "demand_validator");
    assert.equal(requested.worker.name, "Demand Validator");
    assert.equal(requested.approval.status, "pending");
    assert.equal(requested.approval.scope, "live_ai_worker_spend");
    assert.equal(requested.spendGate.estimatedCostCents, 120);

    let state = getDashboardState(db);
    const liveTask = state.tasks.find((task) => task.workflow_id === workflowId && task.kind === "live_ai_worker_execution");
    const approval = state.approvals.find((item) => item.id === requested.approval.id);
    const notice = state.notificationOutbox.find((item) => item.approval_id === approval.id);
    const cost = state.costs.find((item) => item.workflow_id === workflowId && item.status === "approval_requested");

    assert.ok(liveTask);
    assert.equal(liveTask.agent, "demand_validator");
    assert.equal(liveTask.status, "blocked");
    assert.equal(liveTask.cost_budget_cents, 120);
    assert.equal(liveTask.payload.requestedWorker, "demand_validator");
    assert.equal(liveTask.payload.requestedWorkerName, "Demand Validator");
    assert.equal(liveTask.result.spendApprovalRequired, true);
    assert.equal(approval.payload.provider, "openai-agents-sdk");
    assert.equal(approval.payload.worker.id, "demand_validator");
    assert.equal(approval.payload.worker.name, "Demand Validator");
    assert.deepEqual(approval.payload.providerRequirements.env, ["OPENAI_API_KEY"]);
    assert.ok(approval.payload.providerRequirements.flags.includes("JARVIS_ENABLE_LIVE_MODELS"));
    assert.ok(approval.payload.providerRequirements.capabilities.includes("openai_agents_sdk_runner"));
    assert.equal(notice.status, "queued_dry_run");
    assert.equal(cost.amount_cents, 0);
    assert.equal(state.metrics.aiWorkers.liveWorkerRequests, 1);
    assert.equal(state.metrics.aiWorkers.blockedLiveWorkers, 1);
    assert.equal(state.metrics.aiWorkers.providerReady, false);

    decideApproval(db, approval.id, "approved", "approve capped live worker proof");
    const providerBlocked = await runOnce(db, { workflowId });
    assert.equal(providerBlocked.status, "blocked");
    assert.equal(providerBlocked.spendGate.providerBlocked, true);
    assert.equal(providerBlocked.spendGate.noSpendOccurred, true);
    assert.ok(providerBlocked.spendGate.missingRequirements.some((requirement) => requirement.name === "OPENAI_API_KEY"));
    assert.ok(providerBlocked.spendGate.missingRequirements.some((requirement) => requirement.name === "JARVIS_ENABLE_LIVE_MODELS"));

    state = getDashboardState(db);
    const blockedTask = state.tasks.find((task) => task.id === liveTask.id);
    const providerMessage = state.messages.find((message) => message.task_id === liveTask.id && message.subject.startsWith("Provider setup needed"));
    assert.equal(blockedTask.status, "blocked");
    assert.equal(blockedTask.result.requestedWorker, "demand_validator");
    assert.equal(blockedTask.result.worker.name, "Demand Validator");
    assert.equal(blockedTask.result.providerBlocked, true);
    assert.equal(blockedTask.result.noSpendOccurred, true);
    assert.ok(providerMessage);
    assert.equal(providerMessage.severity, "urgent");
  } finally {
    db.close();
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousKey;
    if (previousLiveModels === undefined) delete process.env.JARVIS_ENABLE_LIVE_MODELS;
    else process.env.JARVIS_ENABLE_LIVE_MODELS = previousLiveModels;
    if (previousDisabledAdapter === undefined) delete process.env.JARVIS_DISABLE_LIVE_AI_WORKER_ADAPTER;
    else process.env.JARVIS_DISABLE_LIVE_AI_WORKER_ADAPTER = previousDisabledAdapter;
    if (previousDisabledSdk === undefined) delete process.env.JARVIS_DISABLE_OPENAI_AGENTS_SDK;
    else process.env.JARVIS_DISABLE_OPENAI_AGENTS_SDK = previousDisabledSdk;
    if (previousPackDir === undefined) delete process.env.JARVIS_APPROVAL_PACK_DIR;
    else process.env.JARVIS_APPROVAL_PACK_DIR = previousPackDir;
  }
});

test("approved live AI worker uses OpenAI Agents SDK runner, records traces, cost, and eval", async () => {
  const previousKey = process.env.OPENAI_API_KEY;
  const previousLiveModels = process.env.JARVIS_ENABLE_LIVE_MODELS;
  const previousDisabledAdapter = process.env.JARVIS_DISABLE_LIVE_AI_WORKER_ADAPTER;
  const previousDisabledSdk = process.env.JARVIS_DISABLE_OPENAI_AGENTS_SDK;
  const previousModel = process.env.JARVIS_LIVE_MODEL;
  const previousPackDir = process.env.JARVIS_APPROVAL_PACK_DIR;
  const packDir = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-codex-live-worker-success-pdf-"));
  process.env.OPENAI_API_KEY = "test-live-worker-key";
  process.env.JARVIS_ENABLE_LIVE_MODELS = "1";
  delete process.env.JARVIS_DISABLE_LIVE_AI_WORKER_ADAPTER;
  delete process.env.JARVIS_DISABLE_OPENAI_AGENTS_SDK;
  process.env.JARVIS_LIVE_MODEL = "gpt-5.5-worker-test";
  process.env.JARVIS_APPROVAL_PACK_DIR = packDir;

  let capturedRequest = null;
  __setAgentRuntimeSdkRunnerForTests(async ({ requestBody, task, agentDefinition, policy }) => {
    capturedRequest = { requestBody, task, agentDefinition, policy };
    return {
      finalOutput: {
        heading: "Demand Validator recommendation",
        summary: "The offer is promising enough for a tiny manual test, but it still needs real buyer signal before any publishing or paid asset work.",
        moneyMove: "Run a 20-person manual interest test for the checklist offer.",
        evidence: ["Dry-run workflow is ready for review.", "Commercial scorecard still needs live buyer evidence.", "No external action has been taken."],
        risks: ["Demand is unproven.", "Copy may be too broad without a buyer niche."],
        nextAction: "Approve a small manual channel test or request live research first.",
        operatorDecision: "revise",
        confidence: "medium",
        expectedUpside: "Could validate a low-cost digital product before build time increases.",
        costRisk: "Capped model call only; no publishing or external tool use.",
        assumptions: ["The operator can run a manual test without platform automation."],
        businessDecision: {
          buyer: "Finance-focused Notion users",
          problem: "They want a cleaner personal finance dashboard without building it from scratch.",
          offer: "Premium Notion finance dashboard template",
          channel: "Manual channel test",
          moneyMove: "Run a 20-person manual interest test for the checklist offer.",
          evidenceSummary: "Dry-run workflow is ready, but live buyer evidence is still missing.",
          risk: "medium",
          nextAction: "Approve a small manual channel test or request live research first.",
          successMetric: "At least two qualified replies or one buyer intent signal from 20 direct touchpoints.",
          killCriteria: "Stop or revise if the test gets views but no qualified replies or buyer questions.",
          approvalRequired: true,
          externalActionsAllowed: false,
          hardStops: ["publishing", "external sending", "customer contact", "paid spend", "money movement"],
          continuousImprovement: {
            hypothesis: "Finance-focused Notion users will respond to a small template promise before we build more.",
            smallestUsefulAction: "Prepare a manual interest test for operator review.",
            expectedMetric: "At least two qualified replies or one buyer intent signal from 20 direct touchpoints.",
            actualResult: "No real-world commercial result has been recorded from this worker output yet.",
            learning: "The operator decision will show whether to gather stronger research or prepare a manual test.",
            improvement: "Revise the buyer segment, offer promise, or channel based on the next signal.",
          },
        },
      },
      lastResponseId: "resp_live_worker_test",
      rawResponses: [
        {
          responseId: "resp_live_worker_test",
          usage: { input_tokens: 900, output_tokens: 420, total_tokens: 1320 },
        },
      ],
      runContext: { usage: { inputTokens: 900, outputTokens: 420, totalTokens: 1320 } },
      lastAgent: { name: "Demand Validator" },
      interruptions: [],
    };
  });

  const db = seededDb("live-ai-worker-success");
  try {
    const planned = createCommandPlan(db, {
      text: "Evaluate a premium Notion finance dashboard template and prepare a decision pack",
      source: "test",
      createFiles: false,
    });
    const workflowId = planned.workflow.id;
    await runUntilBlocked(db, { workflowId, maxSteps: 12 });

    const requested = requestLiveAiWorker(db, workflowId, { estimatedCostCents: 160, worker: "demand_validator" });
    assert.equal(requested.worker.id, "demand_validator");
    decideApproval(db, requested.approval.id, "approved", "approve stubbed live worker");
    const completed = await runOnce(db, { workflowId });

    assert.equal(completed.status, "completed");
    assert.equal(completed.result.mode, "openai-agents-sdk");
    assert.equal(completed.result.aiTeam.agentId, "demand_validator");
    assert.equal(completed.result.aiTeam.agentName, "Demand Validator");
    assert.equal(completed.result.toolPolicy.externalActionsAllowed, false);
    assert.equal(completed.result.toolPolicy.liveModelCallAllowed, true);
    assert.equal(completed.result.toolPolicy.workerStatus, "approval_gated");
    assert.deepEqual(completed.result.toolPolicy.workerApprovalRequired, ["research_adapter"]);
    assert.equal(completed.result.toolPolicy.workerBlocked.length, 0);
    assert.equal(completed.result.modelPolicy.mode, "live");
    assert.equal(completed.result.modelPolicy.status, "completed");
    assert.equal(completed.result.modelPolicy.selectedModel, "gpt-5.5-worker-test");
    assert.equal(completed.result.cost.actualCents, 0);
    assert.equal(completed.result.output.operatorDecision, "revise");
    assert.equal(completed.result.output.businessDecision.schema, "jarvis_worker_business_decision_v1");
    assert.equal(completed.result.output.businessDecision.workerId, "demand_validator");
    assert.equal(completed.result.output.businessDecision.workerName, "Demand Validator");
    assert.equal(completed.result.output.businessDecision.externalActionsAllowed, false);
    assert.equal(completed.result.output.businessDecision.buyer, "Finance-focused Notion users");
    assert.equal(completed.result.output.outputContract.missing.length, 0);
    assert.ok(completed.result.output.evidence.some((item) => item.includes("Agents SDK run")));
    assert.equal(capturedRequest.requestBody.text.format.type, "json_schema");
    assert.equal(capturedRequest.requestBody.text.format.strict, true);
    assert.equal(capturedRequest.requestBody.text.format.schema.additionalProperties, false);
    assert.ok(capturedRequest.requestBody.text.format.schema.required.includes("businessDecision"));
    assert.equal(capturedRequest.requestBody.metadata.agent_id, "demand_validator");
    assert.equal(capturedRequest.agentDefinition.id, "demand_validator");
    assert.match(capturedRequest.requestBody.input[0].content, /Worker: Demand Validator/);
    assert.equal(capturedRequest.requestBody.max_output_tokens >= 400, true);

    const state = getDashboardState(db);
    const liveTask = state.tasks.find((task) => task.workflow_id === workflowId && task.kind === "live_ai_worker_execution");
    const liveRun = state.aiTeam.runs.find((runRecord) => runRecord.task_id === liveTask.id);
    const liveEval = state.aiTeam.evalResults.find((result) => result.run_id === liveRun.id);
    const traces = state.aiTeam.traceEvents.filter((trace) => trace.run_id === liveRun.id);
    const handoff = state.aiTeam.handoffs.find((item) => item.from_run_id === liveRun.id);
    const modelCall = state.modelCalls.find((call) => call.id === completed.result.modelPolicy.callId);
    const cost = state.costs.find((item) => item.id === `cost_spend_${liveTask.id}`);

    assert.equal(liveTask.status, "completed");
    assert.equal(liveTask.agent, "demand_validator");
    assert.equal(liveTask.payload.requestedWorker, "demand_validator");
    assert.equal(liveTask.cost_actual_cents, 0);
    assert.equal(liveRun.agent_id, "demand_validator");
    assert.equal(liveRun.mode, "openai-agents-sdk");
    assert.equal(liveRun.status, "completed");
    assert.equal(liveRun.actual_cost_cents, 0);
    assert.equal(liveRun.metadata.toolPolicy.status, "approval_gated");
    assert.deepEqual(liveRun.metadata.toolPolicy.approvalRequired, ["research_adapter"]);
    assert.equal(liveEval.status, "passed");
    assert.ok(traces.some((trace) => trace.type === "model_call_completed"));
    assert.ok(traces.some((trace) => trace.type === "contract_checked"));
    assert.ok(traces.some((trace) => trace.type === "eval_completed"));
    assert.ok(traces.some((trace) => trace.type === "handoff_recorded"));
    assert.equal(handoff.from_agent_id, "demand_validator");
    assert.equal(handoff.to_agent_id, "chief_of_staff");
    assert.equal(handoff.status, "needs_operator_decision");
    assert.equal(handoff.risk_level, "high");
    assert.match(handoff.decision_needed, /live worker recommendation/i);
    assert.equal(modelCall.mode, "live");
    assert.equal(modelCall.status, "completed");
    assert.equal(modelCall.input_tokens, 900);
    assert.equal(modelCall.output_tokens, 420);
    assert.equal(modelCall.metadata.provider, "openai-agents-sdk");
    assert.equal(modelCall.metadata.sdkRunner, true);
    assert.equal(cost.status, "incurred_estimate");
    assert.equal(cost.amount_cents, 160);
    assert.equal(cost.metadata.exactBillingPending, true);
    assert.equal(state.runtime.liveAiWorkers.ready, true);
    assert.equal(state.runtime.liveAiWorkers.completedLiveRuns, 1);
    assert.equal(state.aiTeam.toolPolicy.byAgent.demand_validator.status, "approval_gated");
    assert.equal(state.aiTeam.toolPolicy.byAgent.demand_validator.blocked.length, 0);
    assert.equal(state.aiTeam.workbench.byAgent.demand_validator.status, "live_tested");
    assert.equal(state.aiTeam.workbench.byAgent.demand_validator.comparison.live.evalStatus, "passed");
    assert.equal(state.aiTeam.workbench.byAgent.demand_validator.comparison.live.actualCostCents, 0);
    assert.ok(state.aiTeam.workbench.byAgent.demand_validator.comparison.dryRun);
    assert.match(state.aiTeam.workbench.byAgent.demand_validator.comparison.verdict, /passed the same contract checks/i);
    assert.equal(state.aiTeam.workbench.byAgent.demand_validator.promotionGate.status, "supervised_learning");
    assert.match(state.aiTeam.workbench.byAgent.demand_validator.promotionGate.recommendation, /5 consecutive reviewed successes/i);
    assert.equal(state.aiTeam.workbench.byAgent.demand_validator.promotionGate.requirements.find((item) => item.id === "live_quality").ok, true);
    assert.equal(state.aiTeam.workbench.byAgent.demand_validator.promotionGate.requirements.find((item) => item.id === "live_trace").ok, true);
    assert.equal(state.aiTeam.workbench.byAgent.demand_validator.promotionGate.comparison.liveCostCents, 0);
    assert.equal(state.aiTeam.workbench.metrics.readyForNarrowLiveUse, 0);
    assert.equal(state.aiTeam.workbench.metrics.liveTested >= 1, true);

    assert.equal(state.aiPilotReview.status, "live_output_ready_for_review");
    assert.equal(state.aiPilotReview.contract.status, "passed");
    assert.equal(state.aiPilotReview.cost.actualCents, 0);
    assert.equal(state.aiPilotReview.cost.incurredEstimateCents, 160);
    assert.equal(state.operatorCockpit.pilotReview.status, "live_output_ready_for_review");
    assert.equal(state.aiPilotReview.actions.some((action) => action.action === "ai-pilot-review" && action.decision === "mark_useful"), true);

    const review = recordAiPilotReviewDecision(db, "demand_validator", "mark_useful", { note: "Useful enough for this capped test." });
    assert.equal(review.status, "recorded");
    assert.equal(review.decision, "mark_useful");
    const reviewedState = getDashboardState(db);
    assert.equal(reviewedState.aiPilotReview.latestReview.decision, "mark_useful");
    assert.equal(reviewedState.aiPilotReview.recommendation.includes("mark_useful") || reviewedState.aiPilotReview.recommendation.includes("Latest operator review recorded"), true);
    assert.ok(reviewedState.events.some((event) => event.type === "ai_pilot_review.decision_recorded" && event.entity_id === review.runId));
  } finally {
    db.close();
    __setAgentRuntimeSdkRunnerForTests(null);
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousKey;
    if (previousLiveModels === undefined) delete process.env.JARVIS_ENABLE_LIVE_MODELS;
    else process.env.JARVIS_ENABLE_LIVE_MODELS = previousLiveModels;
    if (previousDisabledAdapter === undefined) delete process.env.JARVIS_DISABLE_LIVE_AI_WORKER_ADAPTER;
    else process.env.JARVIS_DISABLE_LIVE_AI_WORKER_ADAPTER = previousDisabledAdapter;
    if (previousDisabledSdk === undefined) delete process.env.JARVIS_DISABLE_OPENAI_AGENTS_SDK;
    else process.env.JARVIS_DISABLE_OPENAI_AGENTS_SDK = previousDisabledSdk;
    if (previousModel === undefined) delete process.env.JARVIS_LIVE_MODEL;
    else process.env.JARVIS_LIVE_MODEL = previousModel;
    if (previousPackDir === undefined) delete process.env.JARVIS_APPROVAL_PACK_DIR;
    else process.env.JARVIS_APPROVAL_PACK_DIR = previousPackDir;
  }
});

test("live AI worker provider failure records failed run and no-spend evidence", async () => {
  const previousKey = process.env.OPENAI_API_KEY;
  const previousLiveModels = process.env.JARVIS_ENABLE_LIVE_MODELS;
  const previousDisabledAdapter = process.env.JARVIS_DISABLE_LIVE_AI_WORKER_ADAPTER;
  const previousDisabledSdk = process.env.JARVIS_DISABLE_OPENAI_AGENTS_SDK;
  const previousModel = process.env.JARVIS_LIVE_MODEL;
  const previousPackDir = process.env.JARVIS_APPROVAL_PACK_DIR;
  const packDir = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-codex-live-worker-failure-pdf-"));
  process.env.OPENAI_API_KEY = "test-live-worker-key";
  process.env.JARVIS_ENABLE_LIVE_MODELS = "1";
  delete process.env.JARVIS_DISABLE_LIVE_AI_WORKER_ADAPTER;
  delete process.env.JARVIS_DISABLE_OPENAI_AGENTS_SDK;
  process.env.JARVIS_LIVE_MODEL = "gpt-5.5-worker-test";
  process.env.JARVIS_APPROVAL_PACK_DIR = packDir;
  __setAgentRuntimeSdkRunnerForTests(async () => {
    throw new Error("worker provider unavailable");
  });

  const db = seededDb("live-ai-worker-failure");
  try {
    const planned = createCommandPlan(db, {
      text: "Evaluate a premium Notion finance dashboard template and prepare a decision pack",
      source: "test",
      createFiles: false,
    });
    const workflowId = planned.workflow.id;
    await runUntilBlocked(db, { workflowId, maxSteps: 12 });

    const requested = requestLiveAiWorker(db, workflowId, { estimatedCostCents: 140, worker: "chief_of_staff" });
    decideApproval(db, requested.approval.id, "approved", "approve failure proof");
    const failed = await runOnce(db, { workflowId });

    assert.equal(failed.status, "needs_attention");
    assert.match(failed.error, /worker provider unavailable/);

    const state = getDashboardState(db);
    const liveTask = state.tasks.find((task) => task.workflow_id === workflowId && task.kind === "live_ai_worker_execution");
    const liveRun = state.aiTeam.runs.find((runRecord) => runRecord.task_id === liveTask.id);
    const modelCall = state.modelCalls.find((call) => call.task_id === liveTask.id && call.mode === "live");
    const cost = state.costs.find((item) => item.id === `cost_spend_${liveTask.id}`);
    const event = state.events.find((item) => item.type === "live_ai_worker.failed");

    assert.equal(liveTask.status, "needs_attention");
    assert.equal(liveTask.cost_actual_cents, 0);
    assert.equal(liveRun.status, "failed");
    assert.equal(liveRun.mode, "openai-agents-sdk");
    assert.equal(liveRun.actual_cost_cents, 0);
    assert.equal(modelCall.status, "failed");
    assert.equal(modelCall.actual_cost_cents, 0);
    assert.equal(modelCall.outcome_status, "unknown");
    assert.equal(modelCall.metadata.provider, "openai-agents-sdk");
    assert.equal(cost.status, "unknown");
    assert.equal(cost.amount_cents, 140);
    assert.equal(cost.metadata.outcomeUnknown, true);
    assert.equal(state.runtime.liveAiWorkers.failedLiveRuns, 1);
    assert.equal(state.aiTeam.workbench.byAgent.chief_of_staff.promotionGate.status, "live_failed_review");
    assert.ok(state.aiTeam.workbench.byAgent.chief_of_staff.promotionGate.risks.some((risk) => /failed/i.test(risk)));
    assert.equal(state.aiTeam.workbench.metrics.promotionNeedsReview >= 1, true);
    assert.ok(event);
  } finally {
    db.close();
    __setAgentRuntimeSdkRunnerForTests(null);
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousKey;
    if (previousLiveModels === undefined) delete process.env.JARVIS_ENABLE_LIVE_MODELS;
    else process.env.JARVIS_ENABLE_LIVE_MODELS = previousLiveModels;
    if (previousDisabledAdapter === undefined) delete process.env.JARVIS_DISABLE_LIVE_AI_WORKER_ADAPTER;
    else process.env.JARVIS_DISABLE_LIVE_AI_WORKER_ADAPTER = previousDisabledAdapter;
    if (previousDisabledSdk === undefined) delete process.env.JARVIS_DISABLE_OPENAI_AGENTS_SDK;
    else process.env.JARVIS_DISABLE_OPENAI_AGENTS_SDK = previousDisabledSdk;
    if (previousModel === undefined) delete process.env.JARVIS_LIVE_MODEL;
    else process.env.JARVIS_LIVE_MODEL = previousModel;
    if (previousPackDir === undefined) delete process.env.JARVIS_APPROVAL_PACK_DIR;
    else process.env.JARVIS_APPROVAL_PACK_DIR = previousPackDir;
  }
});

test("approved live research uses provider adapter, records sources, cost, and scorecard evidence", async () => {
  const previousKey = process.env.OPENAI_API_KEY;
  const previousLiveResearch = process.env.JARVIS_ENABLE_LIVE_RESEARCH;
  const previousDisabledAdapter = process.env.JARVIS_DISABLE_LIVE_RESEARCH_ADAPTER;
  const previousModel = process.env.JARVIS_LIVE_RESEARCH_MODEL;
  const previousFetch = globalThis.fetch;
  const previousPackDir = process.env.JARVIS_APPROVAL_PACK_DIR;
  const packDir = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-codex-live-success-pdf-"));
  process.env.OPENAI_API_KEY = "test-live-research-key";
  process.env.JARVIS_ENABLE_LIVE_RESEARCH = "1";
  delete process.env.JARVIS_DISABLE_LIVE_RESEARCH_ADAPTER;
  process.env.JARVIS_LIVE_RESEARCH_MODEL = "gpt-5.5-test";
  process.env.JARVIS_APPROVAL_PACK_DIR = packDir;

  let capturedRequest = null;
  globalThis.fetch = async (url, options = {}) => {
    capturedRequest = { url, options, body: JSON.parse(options.body) };
    return {
      ok: true,
      status: 200,
      async json() {
        return {
          id: "resp_live_research_test",
          usage: { input_tokens: 1200, output_tokens: 600, total_tokens: 1800 },
          output: [
            {
              type: "web_search_call",
              action: {
                query: "premium notion finance dashboard competitors pricing",
                sources: [
                  { title: "Notion finance templates marketplace", url: "https://example.com/notion-finance", snippet: "Current marketplace examples and pricing." },
                ],
              },
            },
            {
              type: "message",
              content: [
                {
                  type: "output_text",
                  text: JSON.stringify({
                    summary: "Live evidence suggests the finance dashboard idea has demand, but pricing and differentiation need care.",
                    verdict: "revise",
                    confidence: "medium",
                    marketDemand: { finding: "Demand exists", evidence: "Marketplace listings and current search results show active buyer language." },
                    competitionPricing: { finding: "Competition is real", evidence: "Several comparable paid templates sit in a low-to-mid price band." },
                    freshnessRisk: { finding: "Risk is manageable", evidence: "No obvious regulated claims are needed if the offer avoids financial advice." },
                    recommendation: "Revise positioning, then prepare a differentiated mockup before paid publishing.",
                    assumptions: ["Pricing evidence is directional until marketplace account analytics are connected."],
                    sources: [
                      { title: "Notion finance templates marketplace", url: "https://example.com/notion-finance", kind: "market_demand", relevance: "Shows current demand and comparable offers.", confidence: "high" },
                      { title: "Template pricing comparison", url: "https://example.com/template-pricing", kind: "competition_pricing", relevance: "Shows live price bands.", confidence: "medium" },
                      { title: "Financial advice disclaimer guidance", url: "https://example.com/finance-risk", kind: "freshness_risk", relevance: "Flags positioning risk for finance products.", confidence: "medium" },
                    ],
                  }),
                  annotations: [
                    { type: "url_citation", url: "https://example.com/notion-finance", title: "Notion finance templates marketplace" },
                    { type: "url_citation", url: "https://example.com/template-pricing", title: "Template pricing comparison" },
                    { type: "url_citation", url: "https://example.com/finance-risk", title: "Financial advice disclaimer guidance" },
                  ],
                },
              ],
            },
          ],
        };
      },
    };
  };

  const db = seededDb("live-research-success");
  try {
    const planned = createCommandPlan(db, {
      text: "Evaluate a premium Notion finance dashboard template and prepare a decision pack",
      source: "test",
      createFiles: false,
    });
    const workflowId = planned.workflow.id;
    await runUntilBlocked(db, { workflowId, maxSteps: 12 });

    const requested = requestLiveResearch(db, workflowId, { estimatedCostCents: 220 });
    decideApproval(db, requested.approval.id, "approved", "approve stubbed live research");
    const completed = await runOnce(db, { workflowId });

    assert.equal(completed.status, "completed");
    assert.equal(completed.result.mode, "live-research-agent");
    assert.equal(completed.result.toolPolicy.externalActionsAllowed, true);
    assert.equal(completed.result.research.status, "completed_live");
    assert.equal(completed.result.research.mode, "live");
    assert.equal(completed.result.research.actualCents, 0);
    assert.equal(completed.result.cost.actualCents, 0);
    assert.equal(completed.result.output.liveEvidence, true);
    assert.equal(completed.result.output.verdict, "revise");
    assert.equal(completed.result.researchBridge.skipped, false);
    assert.equal(completed.result.researchBridge.candidateCount, 3);
    assert.ok(completed.result.researchBridge.recommendedCandidateId);
    assert.equal(completed.result.output.commercialTestBridge.candidateCount, 3);
    assert.equal(completed.result.modelPolicy.mode, "live");
    assert.equal(completed.result.modelPolicy.selectedModel, "gpt-5.5-test");
    assert.equal(capturedRequest.body.tools[0].type, "web_search");
    assert.equal(capturedRequest.body.tool_choice, "required");
    assert.ok(capturedRequest.body.include.includes("web_search_call.action.sources"));
    assert.match(capturedRequest.options.headers.authorization, /Bearer test-live-research-key/);

    const state = getDashboardState(db);
    const liveTask = state.tasks.find((task) => task.workflow_id === workflowId && task.kind === "live_market_research");
    const researchRun = state.researchRuns.find((runRecord) => runRecord.task_id === liveTask.id);
    const sources = state.researchSources.filter((source) => source.run_id === researchRun.id);
    const cost = state.costs.find((item) => item.id === `cost_spend_${liveTask.id}`);
    const scorecard = state.ventureScorecards.find((item) => item.workflow_id === workflowId);
    const bridgeBrief = state.commercialBriefs.find((brief) => brief.metadata.sourceResearchRunId === researchRun.id);
    const bridgeCandidates = state.commercialTestCandidates.filter((candidate) => candidate.brief_id === bridgeBrief?.id);
    const bridgeTrace = all(db, "SELECT * FROM agent_trace_events WHERE run_id = ? AND type = ?", [
      completed.result.aiTeam.runId,
      "research_test_candidates_created",
    ]);

    assert.equal(liveTask.status, "completed");
    assert.equal(liveTask.cost_actual_cents, 0);
    assert.equal(researchRun.status, "completed_live");
    assert.equal(researchRun.mode, "live");
    assert.equal(researchRun.actual_cents, 0);
    assert.ok(sources.length >= 3);
    assert.ok(sources.every((source) => source.url.startsWith("https://")));
    assert.equal(cost.status, "incurred_estimate");
    assert.equal(cost.amount_cents, 220);
    assert.equal(cost.metadata.exactBillingPending, true);
    assert.equal(scorecard.metadata.hasLiveResearch, true);
    assert.equal(scorecard.confidence, "medium_with_live_research");
    assert.notEqual(scorecard.verdict, "research_required");
    assert.equal(state.metrics.research.providerReady, true);
    assert.ok(bridgeBrief);
    assert.equal(bridgeBrief.source, "live_research");
    assert.equal(bridgeBrief.metadata.researchEvidence.verdict, "revise");
    assert.equal(bridgeBrief.metadata.researchEvidence.sourceCount, sources.length);
    assert.equal(bridgeCandidates.length, 3);
    assert.equal(bridgeCandidates[0].metadata.sourceResearchRunId, researchRun.id);
    assert.equal(bridgeCandidates[0].metadata.source, "live_research");
    assert.ok(state.commercialBrain.moneyMoves.some((move) => move.candidateId === completed.result.researchBridge.recommendedCandidateId));
    assert.ok(state.events.some((event) => event.type === "commercial_test.live_research_bridge_created"));
    assert.equal(bridgeTrace.length, 1);
  } finally {
    db.close();
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousKey;
    if (previousLiveResearch === undefined) delete process.env.JARVIS_ENABLE_LIVE_RESEARCH;
    else process.env.JARVIS_ENABLE_LIVE_RESEARCH = previousLiveResearch;
    if (previousDisabledAdapter === undefined) delete process.env.JARVIS_DISABLE_LIVE_RESEARCH_ADAPTER;
    else process.env.JARVIS_DISABLE_LIVE_RESEARCH_ADAPTER = previousDisabledAdapter;
    if (previousModel === undefined) delete process.env.JARVIS_LIVE_RESEARCH_MODEL;
    else process.env.JARVIS_LIVE_RESEARCH_MODEL = previousModel;
    if (previousPackDir === undefined) delete process.env.JARVIS_APPROVAL_PACK_DIR;
    else process.env.JARVIS_APPROVAL_PACK_DIR = previousPackDir;
  }
});

test("live research provider failure records failed run and no-spend retry evidence", async () => {
  const previousKey = process.env.OPENAI_API_KEY;
  const previousLiveResearch = process.env.JARVIS_ENABLE_LIVE_RESEARCH;
  const previousDisabledAdapter = process.env.JARVIS_DISABLE_LIVE_RESEARCH_ADAPTER;
  const previousFetch = globalThis.fetch;
  process.env.OPENAI_API_KEY = "test-live-research-key";
  process.env.JARVIS_ENABLE_LIVE_RESEARCH = "1";
  delete process.env.JARVIS_DISABLE_LIVE_RESEARCH_ADAPTER;

  globalThis.fetch = async () => ({
    ok: false,
    status: 429,
    async json() {
      return { error: { message: "rate limit for test" } };
    },
  });

  const db = seededDb("live-research-failure");
  try {
    const planned = createCommandPlan(db, {
      text: "Evaluate a premium Notion finance dashboard template and prepare a decision pack",
      source: "test",
      createFiles: false,
    });
    const workflowId = planned.workflow.id;
    await runUntilBlocked(db, { workflowId, maxSteps: 12 });
    const requested = requestLiveResearch(db, workflowId, { estimatedCostCents: 210 });
    decideApproval(db, requested.approval.id, "approved", "approve failing live research proof");
    run(db, "UPDATE tasks SET max_retries = 0 WHERE id = ?", [requested.task.id]);

    const failed = await runOnce(db, { workflowId });
    assert.equal(failed.status, "needs_attention");
    assert.match(failed.error, /rate limit for test/);

    const state = getDashboardState(db);
    const task = state.tasks.find((item) => item.id === requested.task.id);
    const failedRun = state.researchRuns.find((runRecord) => runRecord.task_id === task.id && runRecord.status === "failed_live");
    const cost = state.costs.find((item) => item.id === `cost_spend_${task.id}`);
    const event = state.events.find((item) => item.type === "research.live_failed" && item.entity_id === failedRun.id);

    assert.equal(task.status, "needs_attention");
    assert.ok(failedRun);
    assert.equal(failedRun.actual_cents, 0);
    assert.equal(failedRun.metadata.outcomeUnknown, true);
    assert.equal(cost.status, "unknown");
    assert.equal(cost.amount_cents, 210);
    assert.ok(event);
  } finally {
    db.close();
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousKey;
    if (previousLiveResearch === undefined) delete process.env.JARVIS_ENABLE_LIVE_RESEARCH;
    else process.env.JARVIS_ENABLE_LIVE_RESEARCH = previousLiveResearch;
    if (previousDisabledAdapter === undefined) delete process.env.JARVIS_DISABLE_LIVE_RESEARCH_ADAPTER;
    else process.env.JARVIS_DISABLE_LIVE_RESEARCH_ADAPTER = previousDisabledAdapter;
  }
});

test("paid live work requests approval before execution and resumes after approval", async () => {
  const db = seededDb("spend-gate");
  const result = createCommandPlan(db, {
    text: "Evaluate a travel checklist digital product and prepare a decision pack",
    source: "test",
    createFiles: false,
  });
  const workflowId = result.workflow.id;
  const task = get(db, "SELECT id, payload FROM tasks WHERE workflow_id = ? AND kind = ?", [workflowId, "market_research"]);
  const payload = JSON.parse(task.payload);

  run(
    db,
    "UPDATE tasks SET payload = ? WHERE id = ?",
    [
      toJson({
        ...payload,
        liveSpendRequest: {
          requested: true,
          type: "model",
          provider: "openai",
          estimatedCostCents: 50,
          reason: "Prove the paid-work approval gate before live AI calls are enabled.",
          commercialPurpose: "Only spend when the operator approves a commercially useful validation step.",
        },
      }),
      task.id,
    ],
  );

  const blocked = await runOnce(db, { workflowId });
  assert.equal(blocked.status, "blocked");
  assert.equal(blocked.spendGate.approved, false);
  assert.equal(blocked.approval.status, "pending");
  assert.equal(blocked.approval.scope, "live_ai_spend");

  let state = getDashboardState(db);
  const blockedTask = state.tasks.find((item) => item.id === task.id);
  const approval = state.approvals.find((item) => item.id === blocked.approval.id);
  const notice = state.notificationOutbox.find((item) => item.approval_id === approval.id);
  const cost = state.costs.find((item) => item.workflow_id === workflowId && item.status === "approval_requested");

  assert.equal(blockedTask.status, "blocked");
  assert.equal(blockedTask.approval_id, approval.id);
  assert.equal(blockedTask.result.spendApprovalRequired, true);
  assert.equal(approval.payload.estimatedCostCents, 50);
  assert.equal(approval.payload.noSpendOccurred, true);
  assert.equal(notice.status, "queued_dry_run");
  assert.equal(cost.amount_cents, 0);
  assert.equal(cost.metadata.estimatedCostCents, 50);
  assert.equal(cost.metadata.noSpendOccurred, true);

  decideApproval(db, approval.id, "approved", "approve paid-work gate proof");
  const completed = await runOnce(db, { workflowId });
  assert.equal(completed.status, "completed");
  assert.equal(completed.result.spendApproval.status, "approved");
  assert.equal(completed.result.spendApproval.approved, true);
  assert.equal(completed.result.cost.actualCents, 0);
  assert.equal(completed.result.modelPolicy.status, "not_called");

  state = getDashboardState(db);
  const completedTask = state.tasks.find((item) => item.id === task.id);
  assert.equal(completedTask.status, "completed");
  assert.equal(completedTask.result.spendApproval.approved, true);

  db.close();
});

test("approval queues digital product dry-run without live publishing", async () => {
  const db = seededDb("approval");

  const decision = decideApproval(db, "appr-digital-product-dry-run", "approved", "test approval");
  assert.equal(decision.changed, true);

  const queued = get(db, "SELECT status FROM tasks WHERE id = ?", ["task-digital-product-dry-run"]);
  assert.equal(queued.status, "queued");

  const result = await runOnce(db);
  assert.equal(result.status, "completed");
  assert.equal(result.result.mode, "dry-run");
  assert.equal(result.result.provider, "digital-products");

  const workflow = get(db, "SELECT status FROM workflows WHERE id = ?", ["wf-digital-product-pilot-proof"]);
  assert.equal(workflow.status, "dry_run_complete");

  const cost = get(db, "SELECT amount_cents, status FROM costs WHERE workflow_id = ?", ["wf-digital-product-pilot-proof"]);
  assert.equal(cost.amount_cents, 0);
  assert.equal(cost.status, "estimated");

  const event = get(db, "SELECT message FROM events WHERE type = ? ORDER BY id DESC LIMIT 1", ["task.completed"]);
  assert.match(event.message, /No external listing was created/);
  const state = getDashboardState(db);
  const scorecard = state.ventureScorecards.find((item) => item.workflow_id === "wf-digital-product-pilot-proof");
  assert.ok(scorecard);
  assert.equal(scorecard.channel, "Digital Product");
  assert.equal(scorecard.verdict, "research_required");
  assert.equal(scorecard.status, "ready_for_review");

  db.close();
});

test("approval rejection cancels blocked task", () => {
  const db = seededDb("reject");
  decideApproval(db, "appr-digital-product-dry-run", "rejected", "not ready");

  const task = get(db, "SELECT status, error FROM tasks WHERE id = ?", ["task-digital-product-dry-run"]);
  const workflow = get(db, "SELECT status FROM workflows WHERE id = ?", ["wf-digital-product-pilot-proof"]);

  assert.equal(task.status, "cancelled");
  assert.equal(task.error, "not ready");
  assert.equal(workflow.status, "cancelled");

  db.close();
});

test("HTTP API prepares live research smoke test without live spend", async () => {
  const previousKey = process.env.OPENAI_API_KEY;
  const previousLiveResearch = process.env.JARVIS_ENABLE_LIVE_RESEARCH;
  const previousDisabledAdapter = process.env.JARVIS_DISABLE_LIVE_RESEARCH_ADAPTER;
  delete process.env.OPENAI_API_KEY;
  delete process.env.JARVIS_ENABLE_LIVE_RESEARCH;
  delete process.env.JARVIS_DISABLE_LIVE_RESEARCH_ADAPTER;

  const db = seededDb("server-smoke");
  const app = createApp({ db, dbPath: tempDbPath("server-smoke-unused"), security: false });
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  const port = app.server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    const health = await fetch(`${baseUrl}/api/health`).then((response) => response.json());
    assert.equal(health.liveResearch.ready, false);
    assert.equal(health.liveResearch.canPrepareSmokeTest, true);

    const smoke = await fetch(`${baseUrl}/api/live-research/smoke-test`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ estimatedCostCents: 100 }),
    }).then((response) => response.json());

    assert.equal(smoke.result.status, "prepared");
    assert.equal(smoke.result.liveResearch.status, "blocked");
    assert.equal(smoke.result.liveResearch.approval.status, "pending");
    assert.equal(smoke.state.runtime.liveResearch.pendingApprovals, 1);
    assert.equal(smoke.state.runtime.liveResearch.smokeTests, 1);
    assert.ok(smoke.state.costs.some((cost) => cost.workflow_id === smoke.result.workflow.id && cost.status === "approval_requested" && cost.amount_cents === 0));
  } finally {
    await new Promise((resolve) => app.wss.close(resolve));
    await new Promise((resolve) => app.server.close(resolve));
    db.close();
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousKey;
    if (previousLiveResearch === undefined) delete process.env.JARVIS_ENABLE_LIVE_RESEARCH;
    else process.env.JARVIS_ENABLE_LIVE_RESEARCH = previousLiveResearch;
    if (previousDisabledAdapter === undefined) delete process.env.JARVIS_DISABLE_LIVE_RESEARCH_ADAPTER;
    else process.env.JARVIS_DISABLE_LIVE_RESEARCH_ADAPTER = previousDisabledAdapter;
  }
});

test("HTTP API prepares live AI worker smoke test without live spend", async () => {
  const previousKey = process.env.OPENAI_API_KEY;
  const previousLiveModels = process.env.JARVIS_ENABLE_LIVE_MODELS;
  const previousDisabledAdapter = process.env.JARVIS_DISABLE_LIVE_AI_WORKER_ADAPTER;
  const previousDisabledSdk = process.env.JARVIS_DISABLE_OPENAI_AGENTS_SDK;
  delete process.env.OPENAI_API_KEY;
  delete process.env.JARVIS_ENABLE_LIVE_MODELS;
  delete process.env.JARVIS_DISABLE_LIVE_AI_WORKER_ADAPTER;
  delete process.env.JARVIS_DISABLE_OPENAI_AGENTS_SDK;

  const db = seededDb("server-worker-smoke");
  const app = createApp({ db, dbPath: tempDbPath("server-worker-smoke-unused"), security: false });
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  const port = app.server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    const health = await fetch(`${baseUrl}/api/health`).then((response) => response.json());
    assert.equal(health.liveAiWorkers.ready, false);
    assert.equal(health.liveAiWorkers.canPrepareSmokeTest, true);

    const smoke = await fetch(`${baseUrl}/api/live-ai-workers/smoke-test`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ estimatedCostCents: 100, worker: "demand_validator" }),
    }).then((response) => response.json());

    assert.equal(smoke.result.status, "prepared");
    assert.equal(smoke.result.liveWorker.status, "blocked");
    assert.equal(smoke.result.liveWorker.worker.id, "demand_validator");
    assert.equal(smoke.result.liveWorker.worker.name, "Demand Validator");
    assert.equal(smoke.result.liveWorker.approval.status, "pending");
    assert.equal(smoke.state.runtime.liveAiWorkers.pendingApprovals, 1);
    assert.equal(smoke.state.runtime.liveAiWorkers.smokeTests, 1);
    assert.ok(smoke.state.tasks.some((task) => task.workflow_id === smoke.result.workflow.id && task.kind === "live_ai_worker_execution" && task.agent === "demand_validator"));
    assert.ok(smoke.state.approvals.some((approval) => approval.id === smoke.result.liveWorker.approval.id && approval.payload.worker.id === "demand_validator"));
    assert.ok(smoke.state.costs.some((cost) => cost.workflow_id === smoke.result.workflow.id && cost.status === "approval_requested" && cost.amount_cents === 0));
  } finally {
    await new Promise((resolve) => app.wss.close(resolve));
    await new Promise((resolve) => app.server.close(resolve));
    db.close();
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousKey;
    if (previousLiveModels === undefined) delete process.env.JARVIS_ENABLE_LIVE_MODELS;
    else process.env.JARVIS_ENABLE_LIVE_MODELS = previousLiveModels;
    if (previousDisabledAdapter === undefined) delete process.env.JARVIS_DISABLE_LIVE_AI_WORKER_ADAPTER;
    else process.env.JARVIS_DISABLE_LIVE_AI_WORKER_ADAPTER = previousDisabledAdapter;
    if (previousDisabledSdk === undefined) delete process.env.JARVIS_DISABLE_OPENAI_AGENTS_SDK;
    else process.env.JARVIS_DISABLE_OPENAI_AGENTS_SDK = previousDisabledSdk;
  }
});

test("HTTP API runs a protected AI worker proof from the Workbench", async () => {
  const previousKey = process.env.OPENAI_API_KEY;
  const previousLiveModels = process.env.JARVIS_ENABLE_LIVE_MODELS;
  delete process.env.OPENAI_API_KEY;
  delete process.env.JARVIS_ENABLE_LIVE_MODELS;

  const db = seededDb("server-worker-proof");
  const app = createApp({ db, dbPath: tempDbPath("server-worker-proof-unused"), security: false });
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  const port = app.server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    const response = await fetch(`${baseUrl}/api/agent-workbench/demand_validator/proof-run`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        subject: "Premium Notion finance dashboard",
        buyer: "Freelance designers",
        problem: "They want cashflow clarity without setup drag.",
        offer: "A Notion dashboard and setup guide.",
      }),
    });
    const payload = await response.json();

    assert.equal(response.status, 201);
    assert.equal(payload.result.worker.id, "demand_validator");
    assert.equal(payload.result.task.kind, "workbench_proof");
    assert.equal(payload.result.run.status, "completed");
    assert.equal(payload.result.run.result.aiTeam.agentId, "demand_validator");
    assert.equal(payload.result.run.result.aiTeam.evalStatus, "passed");
    assert.equal(payload.state.aiTeam.workbench.byAgent.demand_validator.comparison.dryRun.evalStatus, "passed");
    assert.equal(payload.state.aiTeam.workbench.byAgent.demand_validator.promotionGate.requirements.find((item) => item.id === "protected_quality").ok, true);
    assert.equal(payload.state.aiTeam.workbench.byAgent.demand_validator.promotionGate.requirements.find((item) => item.id === "protected_trace").ok, true);
    assert.ok(payload.state.events.some((event) => event.type === "agent.workbench_proof_queued"));
  } finally {
    await new Promise((resolve) => app.wss.close(resolve));
    await new Promise((resolve) => app.server.close(resolve));
    db.close();
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousKey;
    if (previousLiveModels === undefined) delete process.env.JARVIS_ENABLE_LIVE_MODELS;
    else process.env.JARVIS_ENABLE_LIVE_MODELS = previousLiveModels;
  }
});

test("HTTP API runs a protected AI worker playbook rehearsal", async () => {
  const previousKey = process.env.OPENAI_API_KEY;
  const previousLiveModels = process.env.JARVIS_ENABLE_LIVE_MODELS;
  delete process.env.OPENAI_API_KEY;
  delete process.env.JARVIS_ENABLE_LIVE_MODELS;

  const db = seededDb("server-playbook-rehearsal");
  const app = createApp({ db, dbPath: tempDbPath("server-playbook-rehearsal-unused"), security: false });
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  const port = app.server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    const response = await fetch(`${baseUrl}/api/agent-playbooks/distribution_operator/rehearsal`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        subject: "Client handover checklist rehearsal",
        buyer: "Boutique digital agencies",
        problem: "Project handovers create avoidable support work.",
        offer: "Client handover checklist template pack",
        channel: "Manual LinkedIn test",
      }),
    });
    const payload = await response.json();

    assert.equal(response.status, 201);
    assert.equal(payload.result.worker.id, "distribution_operator");
    assert.equal(payload.result.playbook.agentId, "distribution_operator");
    assert.equal(payload.result.task.kind, "workbench_proof");
    assert.equal(payload.result.run.status, "completed");
    assert.equal(payload.result.run.result.aiTeam.agentId, "distribution_operator");
    assert.equal(payload.result.run.result.aiTeam.evalStatus, "passed");
    assert.equal(payload.state.agentPlaybooks.summary.rehearsals, 1);
    assert.equal(payload.state.agentPlaybooks.summary.passedRehearsals, 1);
    assert.equal(payload.state.agentPlaybooks.summary.actualCostCents, 0);
    assert.equal(payload.state.agentPlaybooks.byAgent.distribution_operator.rehearsalStatus, "rehearsed");
    assert.equal(payload.state.agentPlaybooks.byAgent.distribution_operator.latestRehearsal.context.subject, "Client handover checklist rehearsal");
    assert.ok(payload.state.events.some((event) => event.type === "agent.playbook_rehearsal_queued"));
  } finally {
    await new Promise((resolve) => app.wss.close(resolve));
    await new Promise((resolve) => app.server.close(resolve));
    db.close();
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousKey;
    if (previousLiveModels === undefined) delete process.env.JARVIS_ENABLE_LIVE_MODELS;
    else process.env.JARVIS_ENABLE_LIVE_MODELS = previousLiveModels;
  }
});

test("HTTP API runs a protected AI Team playbook rehearsal suite", async () => {
  const previousKey = process.env.OPENAI_API_KEY;
  const previousLiveModels = process.env.JARVIS_ENABLE_LIVE_MODELS;
  delete process.env.OPENAI_API_KEY;
  delete process.env.JARVIS_ENABLE_LIVE_MODELS;

  const db = seededDb("server-playbook-rehearsal-suite");
  const app = createApp({ db, dbPath: tempDbPath("server-playbook-rehearsal-suite-unused"), security: false });
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  const port = app.server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    const response = await fetch(`${baseUrl}/api/agent-playbooks/rehearsal-suite`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        teamName: "API playbook rehearsal",
        agentIds: ["chief_of_staff", "demand_validator"],
        subject: "Client handover checklist rehearsal",
        buyer: "Boutique digital agencies",
        problem: "Project handovers create avoidable support work.",
        offer: "Client handover checklist template pack",
        channel: "Manual LinkedIn test",
      }),
    });
    const payload = await response.json();

    assert.equal(response.status, 201);
    assert.equal(payload.result.team.workerCount, 2);
    assert.equal(payload.result.tasks.length, 2);
    assert.equal(payload.result.loop.status, "ready_for_review");
    assert.equal(payload.state.agentPlaybooks.summary.rehearsals, 2);
    assert.equal(payload.state.agentPlaybooks.summary.passedRehearsals, 2);
    assert.equal(payload.state.agentPlaybooks.summary.rehearsedWorkers, 2);
    assert.equal(payload.state.agentPlaybooks.summary.actualCostCents, 0);
    assert.equal(payload.state.preOpenAiReadiness.metrics.rehearsedPlaybookWorkers, 2);
    assert.equal(payload.state.preOpenAiReadiness.checklist.find((item) => item.id === "playbook_rehearsal").ok, true);
    assert.ok(payload.state.events.some((event) => event.type === "agent.playbook_rehearsal_suite_queued"));
  } finally {
    await new Promise((resolve) => app.wss.close(resolve));
    await new Promise((resolve) => app.server.close(resolve));
    db.close();
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousKey;
    if (previousLiveModels === undefined) delete process.env.JARVIS_ENABLE_LIVE_MODELS;
    else process.env.JARVIS_ENABLE_LIVE_MODELS = previousLiveModels;
  }
});

test("HTTP API exposes durable AI worker model readiness packs", async () => {
  const previousKey = process.env.OPENAI_API_KEY;
  const previousLiveModels = process.env.JARVIS_ENABLE_LIVE_MODELS;
  delete process.env.OPENAI_API_KEY;
  delete process.env.JARVIS_ENABLE_LIVE_MODELS;

  const db = seededDb("server-agent-model-readiness");
  const app = createApp({ db, dbPath: tempDbPath("server-agent-model-readiness-unused"), security: false });
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  const port = app.server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    const response = await fetch(`${baseUrl}/api/agent-model-readiness`);
    const payload = await response.json();
    const rows = get(db, "SELECT COUNT(*) AS count FROM agent_model_readiness_packs");
    const demand = payload.byAgent.demand_validator;

    assert.equal(response.status, 200);
    assert.equal(payload.schema, "jarvis_agent_model_connection_readiness_v1");
    assert.equal(payload.summary.total, 11);
    assert.equal(payload.summary.evalFixtures, 11);
    assert.equal(payload.summary.failureCases, 44);
    assert.equal(rows.count, 11);
    assert.equal(demand.workerName, "Demand Validator");
    assert.equal(demand.inputContract.required.includes("buyer"), true);
    assert.equal(demand.outputContract.schema, "jarvis_worker_business_decision_v1");
    assert.equal(demand.toolPlan.routingRule.includes("runtime gate decides"), true);
    assert.equal(demand.approvalRules.currentProviderState.ready, false);
    assert.ok(demand.readinessChecks.some((item) => item.id === "protected_proof"));
  } finally {
    await new Promise((resolve) => app.wss.close(resolve));
    await new Promise((resolve) => app.server.close(resolve));
    db.close();
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousKey;
    if (previousLiveModels === undefined) delete process.env.JARVIS_ENABLE_LIVE_MODELS;
    else process.env.JARVIS_ENABLE_LIVE_MODELS = previousLiveModels;
  }
});

test("HTTP API prepares a worker model comparison packet without live model use", async () => {
  const previousKey = process.env.OPENAI_API_KEY;
  const previousLiveModels = process.env.JARVIS_ENABLE_LIVE_MODELS;
  delete process.env.OPENAI_API_KEY;
  delete process.env.JARVIS_ENABLE_LIVE_MODELS;

  const db = seededDb("server-agent-model-comparison-packet");
  const readyQueue = queueAgentPlaybookRehearsalSuite(db, {
    teamName: "Server model comparison packet proof",
    subject: "Compact desk cable template",
    buyer: "Home-office workers",
    problem: "They want a tidier desk without buying a full cable-management kit.",
    offer: "A printable cable-planning template and shopping checklist.",
    channel: "Digital Product",
  });
  await runUntilBlocked(db, { workflowId: readyQueue.workflow.id, maxSteps: readyQueue.tasks.length + 2 });

  const app = createApp({ db, dbPath: tempDbPath("server-agent-model-comparison-packet-unused"), security: false });
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  const port = app.server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    const response = await fetch(`${baseUrl}/api/agent-model-readiness/demand_validator/comparison-packet`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ estimatedCostCents: 125 }),
    });
    const payload = await response.json();
    const packet = payload.result.packet;
    const packetList = await fetch(`${baseUrl}/api/agent-model-comparison-packets`).then((res) => res.json());
    const approval = payload.state.approvals.find((item) => item.id === packet.approvalId);

    assert.equal(response.status, 202);
    assert.equal(packet.status, "waiting_for_decision");
    assert.equal(packet.agentId, "demand_validator");
    assert.equal(packet.estimatedCostCents, 125);
    assert.equal(payload.result.liveWorker.approval.status, "pending");
    assert.equal(packetList.schema, "jarvis_agent_model_comparison_packets_v1");
    assert.equal(packetList.packets.length, 1);
    assert.equal(packetList.packets[0].id, packet.id);
    assert.equal(approval.payload.comparisonSource.type, "agent_model_readiness_pack");
    assert.equal(approval.payload.comparisonPacket.fixtureTitle, packet.fixtureTitle);
    assert.equal(payload.state.agentModelReadiness.summary.pendingComparisonPackets, 1);
    assert.equal(payload.state.preOpenAiReadiness.status, "ready_before_model_connection");
    assert.equal(payload.state.decisionInbox.metrics.liveComparisons, 1);
    assert.equal(payload.state.modelCalls.filter((call) => call.mode !== "dry-run").length, 0);
    assert.equal(payload.state.metrics.modelCalls.actualCostCents, 0);
  } finally {
    await new Promise((resolve) => app.wss.close(resolve));
    await new Promise((resolve) => app.server.close(resolve));
    db.close();
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousKey;
    if (previousLiveModels === undefined) delete process.env.JARVIS_ENABLE_LIVE_MODELS;
    else process.env.JARVIS_ENABLE_LIVE_MODELS = previousLiveModels;
  }
});

test("HTTP API runs a protected AI Team proof drill from the Workbench", async () => {
  const previousKey = process.env.OPENAI_API_KEY;
  const previousLiveModels = process.env.JARVIS_ENABLE_LIVE_MODELS;
  delete process.env.OPENAI_API_KEY;
  delete process.env.JARVIS_ENABLE_LIVE_MODELS;

  const db = seededDb("server-team-proof");
  const app = createApp({ db, dbPath: tempDbPath("server-team-proof-unused"), security: false });
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  const port = app.server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    const response = await fetch(`${baseUrl}/api/agent-workbench/proof-suite`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        teamName: "Digital product API drill",
        agentIds: ["copy_conversion_agent", "finance_analyst"],
        subject: "Premium Notion finance dashboard",
        buyer: "Freelance designers",
        problem: "They want cashflow clarity without setup drag.",
        offer: "A Notion dashboard and setup guide.",
      }),
    });
    const payload = await response.json();

    assert.equal(response.status, 201);
    assert.equal(payload.result.team.workerCount, 2);
    assert.equal(payload.result.tasks.length, 2);
    assert.equal(payload.result.loop.status, "ready_for_review");
    assert.equal(payload.result.loop.stepsRun, 2);
    assert.ok(payload.result.loop.steps.every((step) => step.status === "completed"));
    const workflow = payload.state.workflows.find((item) => item.id === payload.result.workflow.id);
    assert.equal(workflow.type, "agent_workbench_team_proof");
    assert.equal(workflow.metadata.teamProofSummary.schema, "jarvis_agent_team_drill_summary_v1");
    assert.equal(workflow.metadata.teamProofSummary.workerCount, 2);
    assert.equal(workflow.metadata.teamProofSummary.passedWorkers, 2);
    assert.equal(workflow.metadata.teamProofSummary.actualCostCents, 0);
    assert.ok(workflow.metadata.teamProofSummary.chiefRunId);
    assert.ok(payload.state.events.some((event) => event.type === "agent.workbench_team_proof_queued"));
    assert.ok(payload.state.events.some((event) => event.type === "agent.team_drill_summary_ready" && event.entity_id === payload.result.workflow.id));
    assert.ok(payload.state.messages.some((message) => message.subject === "AI Team drill summary ready" && message.metadata.teamProofSummary));

    for (const workerId of ["copy_conversion_agent", "finance_analyst"]) {
      const worker = payload.state.aiTeam.workbench.byAgent[workerId];
      assert.equal(worker.comparison.dryRun.evalStatus, "passed");
      assert.equal(worker.promotionGate.requirements.find((item) => item.id === "protected_quality").ok, true);
      assert.equal(worker.promotionGate.requirements.find((item) => item.id === "protected_trace").ok, true);
      assert.equal(worker.promotionGate.status, "provider_setup_needed");
    }

    const comparisonResponse = await fetch(`${baseUrl}/api/agent-workbench/${encodeURIComponent(payload.result.workflow.id)}/live-comparison`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ estimatedCostCents: 150 }),
    });
    const comparisonPayload = await comparisonResponse.json();
    const comparisonWorkflow = comparisonPayload.state.workflows.find((item) => item.id === payload.result.workflow.id);
    const comparisonApproval = comparisonPayload.state.approvals.find((item) => item.id === comparisonPayload.result.comparisonRequest.approvalId);

    assert.equal(comparisonResponse.status, 202);
    assert.equal(comparisonPayload.result.liveWorker.worker.id, "copy_conversion_agent");
    assert.equal(comparisonPayload.result.liveWorker.approval.status, "pending");
    assert.equal(comparisonPayload.result.comparisonRequest.estimatedCostCents, 150);
    assert.equal(comparisonWorkflow.metadata.teamProofSummary.liveComparisonRequest.workerId, "copy_conversion_agent");
    assert.equal(comparisonApproval.payload.comparisonSource.type, "agent_workbench_team_proof");
    assert.equal(comparisonApproval.payload.comparisonSource.protectedWorkerId, "copy_conversion_agent");
    assert.ok(comparisonApproval.payload.protectedEvidence.some((item) => /protected proof/i.test(item)));
    assert.ok(comparisonPayload.state.events.some((event) => event.type === "agent.live_comparison_requested" && event.entity_id === payload.result.workflow.id));
  } finally {
    await new Promise((resolve) => app.wss.close(resolve));
    await new Promise((resolve) => app.server.close(resolve));
    db.close();
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousKey;
    if (previousLiveModels === undefined) delete process.env.JARVIS_ENABLE_LIVE_MODELS;
    else process.env.JARVIS_ENABLE_LIVE_MODELS = previousLiveModels;
  }
});

test("HTTP API serves registered PDF review outputs for dashboard preview", async () => {
  const previousPackDir = process.env.JARVIS_APPROVAL_PACK_DIR;
  const packDir = path.join(
    __dirname,
    "..",
    "tmp",
    `jarvis-codex-pdf-preview-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  );
  process.env.JARVIS_APPROVAL_PACK_DIR = packDir;
  const db = seededDb("server-pdf-preview");
  const app = createApp({ db, dbPath: tempDbPath("server-pdf-preview-unused"), security: false });
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  const port = app.server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    const pack = await fetch(`${baseUrl}/api/workflows/wf-digital-product-pilot-proof/approval-pack`, {
      method: "POST",
    }).then((response) => response.json());
    assert.equal(pack.result.id, "deliv_pdf_wf-digital-product-pilot-proof");

    const preview = await fetch(`${baseUrl}/api/deliverables/${encodeURIComponent(pack.result.id)}/file`);
    assert.equal(preview.status, 200);
    assert.match(preview.headers.get("content-type"), /application\/pdf/);
    assert.match(preview.headers.get("content-disposition"), /inline/);
    const bytes = await preview.arrayBuffer();
    assert.ok(bytes.byteLength > 1000);

    const nonPdf = pack.state.deliverables.find((deliverable) => deliverable.format !== "pdf");
    const nonPdfPreview = await fetch(`${baseUrl}/api/deliverables/${encodeURIComponent(nonPdf.id)}/file`);
    assert.equal(nonPdfPreview.status, 415);
  } finally {
    await new Promise((resolve) => app.wss.close(resolve));
    await new Promise((resolve) => app.server.close(resolve));
    db.close();
    if (previousPackDir === undefined) delete process.env.JARVIS_APPROVAL_PACK_DIR;
    else process.env.JARVIS_APPROVAL_PACK_DIR = previousPackDir;
  }
});

test("HTTP API records commercial results and updates learning state", async () => {
  const db = seededDb("server-commercial-results");
  const app = createApp({ db, dbPath: tempDbPath("server-commercial-results-unused"), security: false });
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  const port = app.server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    const response = await fetch(`${baseUrl}/api/commercial/results`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workflowId: "wf-digital-product-pilot-proof",
        source: "test",
        views: 150,
        clicks: 24,
        leads: 6,
        sales: 2,
        revenueCents: 3800,
        spendCents: 0,
        notes: "Manual proof result from dashboard path.",
      }),
    });
    assert.equal(response.status, 201);
    const payload = await response.json();
    assert.equal(payload.result.learning.verdict, "continue");
    assert.equal(payload.state.commercialResults.length, 1);
    assert.equal(payload.state.metrics.commercial.sales, 2);
    assert.ok(payload.state.commercialBrain.moneyMoves.some((move) => move.type === "learning_signal"));
    assert.equal(payload.result.scorecard.metadata.commercialEvidence.sales, 2);

    const feedback = await fetch(`${baseUrl}/api/commercial/feedback`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        experimentId: payload.result.experiment.id,
        source: "test",
        sentiment: "positive",
        rating: 5,
        summary: "Manual buyer feedback from dashboard path.",
      }),
    }).then((item) => item.json());
    assert.equal(feedback.result.learning.verdict, "continue");
    assert.equal(feedback.state.commercialFeedback.length, 1);
    assert.equal(feedback.state.commercialLearningCycles.length, 2);
  } finally {
    await new Promise((resolve) => app.wss.close(resolve));
    await new Promise((resolve) => app.server.close(resolve));
    db.close();
  }
});

test("HTTP API generates next-test options and promotes one safely", async () => {
  const db = seededDb("server-research-to-experiment");
  const app = createApp({ db, dbPath: tempDbPath("server-research-to-experiment-unused"), security: false });
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  const port = app.server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    const response = await fetch(`${baseUrl}/api/research-to-experiment/plans`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workflowId: "wf-digital-product-pilot-proof",
        source: "test",
        idea: "A template pack for freelancers to forecast monthly cashflow.",
        buyer: "Freelancers with uneven project income",
        problem: "They cannot see cash gaps early enough.",
        offer: "Cashflow forecast template pack",
        channel: "LinkedIn posts and freelancer newsletter swaps",
        priceCents: 2400,
        evidenceSummary: "Freelancers already buy finance templates and ask for simple monthly dashboards.",
      }),
    });
    assert.equal(response.status, 201);
    const payload = await response.json();
    assert.equal(payload.result.candidates.length, 3);
    assert.equal(payload.state.commercialBriefs.length, 1);
    assert.equal(payload.state.commercialTestCandidates.length, 3);
    assert.equal(payload.state.metrics.commercial.plannedTests, 3);
    assert.ok(payload.state.commercialBrain.moneyMoves.some((move) => move.type === "next_test"));

    const promote = await fetch(`${baseUrl}/api/research-to-experiment/candidates/${encodeURIComponent(payload.result.recommended.id)}/promote`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ promotedBy: "test" }),
    });
    assert.equal(promote.status, 201);
    const promoted = await promote.json();
    assert.equal(promoted.result.experiment.price_cents, 2400);
    assert.equal(promoted.state.metrics.commercial.promotedTests, 1);
    assert.equal(promoted.state.metrics.budget.monthlySpendCents, 0);
    assert.equal(promoted.state.commercialExperiments.some((experiment) => experiment.id === promoted.result.experiment.id), true);
  } finally {
    await new Promise((resolve) => app.wss.close(resolve));
    await new Promise((resolve) => app.server.close(resolve));
    db.close();
  }
});

test("HTTP API creates execution packs and records pack outcomes safely", async () => {
  const db = seededDb("server-execution-pack");
  const app = createApp({ db, dbPath: tempDbPath("server-execution-pack-unused"), security: false });
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  const port = app.server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    const plan = await fetch(`${baseUrl}/api/research-to-experiment/plans`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workflowId: "wf-digital-product-pilot-proof",
        source: "test",
        idea: "Client handover checklist templates for small agencies.",
        buyer: "Small digital agencies",
        problem: "Project handovers are inconsistent and create support drag.",
        offer: "Client handover checklist template pack",
        channel: "Agency owner LinkedIn posts",
        priceCents: 2900,
      }),
    }).then((response) => response.json());

    const promoted = await fetch(`${baseUrl}/api/research-to-experiment/candidates/${encodeURIComponent(plan.result.recommended.id)}/promote`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ promotedBy: "test" }),
    }).then((response) => response.json());

    const packResponse = await fetch(`${baseUrl}/api/execution-packs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ experimentId: promoted.result.experiment.id, source: "test" }),
    });
    assert.equal(packResponse.status, 201);
    const packPayload = await packResponse.json();
    assert.equal(packPayload.result.pack.status, "ready_to_test");
    assert.equal(packPayload.state.commercialExecutionPacks.length, 1);
    const readyMove = packPayload.state.commercialBrain.moneyMoves.find((move) => move.type === "execution_ready");
    assert.ok(readyMove);
    assert.equal(readyMove.source, "chief_of_staff_packet");
    assert.ok(readyMove.handoffId);
    assert.equal(packPayload.result.pack.metadata.aiTeam.chiefOfStaffPacket.handoffId, readyMove.handoffId);

    const cockpitResponse = await fetch(`${baseUrl}/api/manual-market-cockpit`);
    assert.equal(cockpitResponse.status, 200);
    const cockpitPayload = await cockpitResponse.json();
    assert.equal(cockpitPayload.manualMarketCockpit.schema, "jarvis_manual_market_test_cockpit_v1");
    assert.equal(cockpitPayload.manualMarketCockpit.status, "decision_ready");
    assert.equal(cockpitPayload.manualMarketCockpit.topAction.packId, packPayload.result.pack.id);
    assert.equal(cockpitPayload.manualMarketCockpit.topAction.actions.some((action) => action.label === "Record Result"), true);
    assert.equal(cockpitPayload.manualMarketCockpit.topAction.actions.some((action) => action.label === "Mark No Response"), true);
    assert.equal(cockpitPayload.metrics.readyPacks, 1);

    const outcomeResponse = await fetch(`${baseUrl}/api/execution-packs/${encodeURIComponent(packPayload.result.pack.id)}/outcomes`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ outcomeType: "no_response", notes: "No response after a controlled manual post." }),
    });
    assert.equal(outcomeResponse.status, 201);
    const outcomePayload = await outcomeResponse.json();
    assert.equal(outcomePayload.result.recorded.learning.verdict, "needs_evidence");
    assert.equal(outcomePayload.result.outcomeDecision.schema, "jarvis_chief_of_staff_outcome_packet_v1");
    assert.ok(outcomePayload.result.outcomeDecision.handoffId);
    assert.equal(outcomePayload.state.commercialResults.length, 1);
    assert.equal(outcomePayload.state.metrics.commercial.results, 1);
    assert.equal(outcomePayload.state.metrics.budget.monthlySpendCents, 0);
    assert.equal(outcomePayload.state.metrics.budget.monthlyRevenueCents, 0);
    const outcomeMove = outcomePayload.state.commercialBrain.moneyMoves.find((move) => move.learningId === outcomePayload.result.recorded.learning.id);
    const outcomePack = outcomePayload.state.commercialExecutionPacks.find((pack) => pack.id === packPayload.result.pack.id);
    assert.equal(outcomeMove.source, "chief_of_staff_outcome_packet");
    assert.equal(outcomeMove.handoffId, outcomePayload.result.outcomeDecision.handoffId);
    assert.equal(outcomePack.metadata.latestOutcomeDecisionPacket.learningId, outcomePayload.result.recorded.learning.id);

    const afterOutcomeCockpit = await fetch(`${baseUrl}/api/manual-market-cockpit`).then((response) => response.json());
    assert.equal(afterOutcomeCockpit.manualMarketCockpit.metrics.packsWithOutcomes, 1);
    assert.equal(afterOutcomeCockpit.manualMarketCockpit.topAction.latestOutcome.learningId, outcomePayload.result.recorded.learning.id);
    assert.equal(afterOutcomeCockpit.manualMarketCockpit.topAction.latestOutcome.verdict, "needs_evidence");

    const revisionResponse = await fetch(`${baseUrl}/api/commercial/learning/${encodeURIComponent(outcomePayload.result.recorded.learning.id)}/revision-plan`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ createdBy: "test" }),
    });
    assert.equal(revisionResponse.status, 201);
    const revisionPayload = await revisionResponse.json();
    assert.equal(revisionPayload.result.alreadyCreated, false);
    assert.equal(revisionPayload.result.candidates.length, 3);
    assert.equal(revisionPayload.result.brief.metadata.sourceLearningId, outcomePayload.result.recorded.learning.id);
    assert.equal(revisionPayload.state.commercialTestCandidates.some((candidate) => candidate.id === revisionPayload.result.recommended.id), true);

    const secondRevision = await fetch(`${baseUrl}/api/commercial/learning/${encodeURIComponent(outcomePayload.result.recorded.learning.id)}/revision-plan`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ createdBy: "test" }),
    }).then((response) => response.json());
    assert.equal(secondRevision.result.alreadyCreated, true);
    assert.equal(secondRevision.result.brief.id, revisionPayload.result.brief.id);
  } finally {
    await new Promise((resolve) => app.wss.close(resolve));
    await new Promise((resolve) => app.server.close(resolve));
    db.close();
  }
});

test("HTTP API exposes health, state, approvals, and runtime tick", async () => {
  const previousPackDir = process.env.JARVIS_APPROVAL_PACK_DIR;
  const previousKey = process.env.OPENAI_API_KEY;
  const previousLiveResearch = process.env.JARVIS_ENABLE_LIVE_RESEARCH;
  const previousAdapterReady = process.env.JARVIS_LIVE_RESEARCH_ADAPTER_READY;
  const packDir = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-codex-api-pdf-"));
  process.env.JARVIS_APPROVAL_PACK_DIR = packDir;
  delete process.env.OPENAI_API_KEY;
  delete process.env.JARVIS_ENABLE_LIVE_RESEARCH;
  delete process.env.JARVIS_LIVE_RESEARCH_ADAPTER_READY;
  const db = seededDb("server");
  const app = createApp({ db, dbPath: tempDbPath("server-unused"), security: false });
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  const port = app.server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    const health = await fetch(`${baseUrl}/api/health`).then((response) => response.json());
    assert.equal(health.ok, true);
    assert.equal(health.mode, "dry-run");

    const state = await fetch(`${baseUrl}/api/state`).then((response) => response.json());
    assert.equal(state.approvals[0].status, "pending");
    assert.equal(state.schedulerJobs.length, 3);
    assert.equal(state.metrics.scheduler.enabled, 2);
    assert.equal(state.agentOperatingBriefs.schema, "jarvis_agent_operating_briefs_v1");
    assert.equal(state.agentOperatingBriefs.summary.complete, state.aiTeam.definitions.length);

    const operatingBriefs = await fetch(`${baseUrl}/api/agent-operating-briefs`).then((response) => response.json());
    assert.equal(operatingBriefs.schema, "jarvis_agent_operating_briefs_v1");
    assert.equal(operatingBriefs.byAgent.growth_analyst.mustProduce.includes("Learning"), true);
    assert.equal(operatingBriefs.byAgent.growth_analyst.hardStops.includes("autopilot promotion"), true);

    const agentPlaybooks = await fetch(`${baseUrl}/api/agent-playbooks`).then((response) => response.json());
    assert.equal(agentPlaybooks.schema, "jarvis_agent_playbooks_v1");
    assert.equal(agentPlaybooks.summary.ready, state.aiTeam.definitions.length);
    assert.equal(agentPlaybooks.byAgent.distribution_operator.trigger.includes("manual channel test"), true);

    const decisionInbox = await fetch(`${baseUrl}/api/decision-inbox`).then((response) => response.json());
    assert.equal(decisionInbox.decisionInbox.schema, "jarvis_operator_decision_inbox_v1");
    assert.equal(decisionInbox.decisionInbox.status, state.decisionInbox.status);
    assert.equal(decisionInbox.metrics.total, state.metrics.decisionInbox.total);
    assert.ok(decisionInbox.decisionInbox.items.some((item) => item.approvalId === "appr-digital-product-dry-run"));

    const scheduler = await fetch(`${baseUrl}/api/scheduler`).then((response) => response.json());
    assert.equal(scheduler.jobs.length, 3);
    assert.equal(scheduler.metrics.enabled, 2);

    const schedulerRun = await fetch(`${baseUrl}/api/scheduler/jobs/job-monitor-cycle/run`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    }).then((response) => response.json());
    assert.equal(schedulerRun.result.status, "completed");
    assert.equal(schedulerRun.result.result.kind, "monitor_cycle");
    assert.ok(schedulerRun.state.schedulerRuns.some((runRecord) => runRecord.id === schedulerRun.result.id));

    const monitor = await fetch(`${baseUrl}/api/monitor/run`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ staleTaskMinutes: 1 }),
    }).then((response) => response.json());
    assert.ok(["attention", "critical"].includes(monitor.result.status));
    assert.ok(monitor.state.monitorRuns.some((runRecord) => runRecord.id === monitor.result.id));

    const blocked = await fetch(`${baseUrl}/api/runtime/tick`, { method: "POST" }).then((response) => response.json());
    assert.equal(blocked.result.status, "blocked");
    assert.equal(blocked.state.notificationOutbox.length, 1);
    const approvalToken = blocked.state.approvalActionTokens.find((token) => token.decision === "approved");
    assert.ok(approvalToken);

    const planned = await fetch(`${baseUrl}/api/commands`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        text: "Evaluate a pilates digital product idea and prepare a decision pack",
        source: "test",
        createFiles: false,
        venture_id: "venture-digital-products",
        mode: "plan_only",
      }),
    }).then((response) => response.json());
    assert.equal(planned.result.command.status, "planned");
    assert.ok(planned.state.commands.some((command) => command.id === planned.result.command.id));
    assert.ok(planned.state.deliverables.some((deliverable) => deliverable.human_name.includes("Pilates Product")));

    const pack = await fetch(`${baseUrl}/api/workflows/${planned.result.workflow.id}/approval-pack`, {
      method: "POST",
    }).then((response) => response.json());
    assert.equal(pack.result.humanName.includes("Approval Pack"), true);
    assert.equal(fs.existsSync(pack.result.filePath), true);
    assert.ok(pack.state.deliverables.some((deliverable) => deliverable.id === pack.result.id && deliverable.format === "pdf"));

    const loop = await fetch(`${baseUrl}/api/workflows/${planned.result.workflow.id}/run-until-blocked`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ maxSteps: 12 }),
    }).then((response) => response.json());
    assert.equal(loop.result.status, "ready_for_review");
    assert.ok(loop.result.runId);
    assert.ok(loop.result.stepsRun >= 4);
    assert.ok(loop.state.workflowRuns.some((run) => run.id === loop.result.runId && run.status === "ready_for_review"));
    assert.ok(loop.state.ventureScorecards.some((scorecard) => scorecard.workflow_id === planned.result.workflow.id && scorecard.verdict === "research_required"));

    const liveResearch = await fetch(`${baseUrl}/api/workflows/${planned.result.workflow.id}/request-live-research`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ estimatedCostCents: 200 }),
    }).then((response) => response.json());
    assert.equal(liveResearch.result.status, "blocked");
    assert.equal(liveResearch.result.approval.status, "pending");
    assert.ok(liveResearch.state.tasks.some((task) => task.workflow_id === planned.result.workflow.id && task.kind === "live_market_research"));
    assert.equal(liveResearch.state.metrics.research.liveResearchRequests, 1);

    const autoRun = await fetch(`${baseUrl}/api/commands`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        text: "Evaluate a reusable grocery planner template and prepare a decision pack",
        source: "test",
        createFiles: false,
        autoRun: true,
        maxSteps: 12,
        venture_id: "venture-digital-products",
        mode: "run_protected",
      }),
    }).then((response) => response.json());
    assert.equal(autoRun.loop.status, "ready_for_review");
    assert.ok(autoRun.loop.runId);
    assert.ok(autoRun.loop.stepsRun >= 4);
    assert.ok(autoRun.state.workflows.some((workflow) => workflow.id === autoRun.result.workflow.id && workflow.status === "ready_for_review"));
    const apiHandoff = autoRun.state.aiTeam.handoffs.find((handoff) => handoff.workflow_id === autoRun.result.workflow.id && handoff.status === "needs_operator_decision");
    assert.ok(apiHandoff);

    const handoffDecision = await fetch(`${baseUrl}/api/agent-handoffs/${encodeURIComponent(apiHandoff.id)}/approve`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ note: "api handoff approval test" }),
    }).then((response) => response.json());
    assert.equal(handoffDecision.result.handoff.status, "approved_for_next_step");
    assert.equal(handoffDecision.result.handoff.metadata.operatorDecision.note, "api handoff approval test");
    assert.equal(handoffDecision.result.followupTask.kind, "handoff_followup");
    assert.equal(handoffDecision.result.followupTask.status, "queued");
    assert.equal(handoffDecision.result.handoff.metadata.operatorDecision.followupTaskId, handoffDecision.result.followupTask.id);
    assert.ok(handoffDecision.state.tasks.some((task) => task.id === handoffDecision.result.followupTask.id && task.agent === "chief_of_staff"));
    assert.ok(handoffDecision.state.events.some((event) => event.type === "agent.handoff_decided" && event.entity_id === apiHandoff.id));

    const unclearReply = await fetch(`${baseUrl}/api/inbound/approval-reply`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ approvalId: "appr-digital-product-dry-run", body: "What is the risk?", sender: "operator@example.test" }),
    }).then((response) => response.json());
    assert.equal(unclearReply.result.status, "needs_operator_review");
    assert.equal(unclearReply.state.approvals[0].status, "pending");

    const tokenStatus = await fetch(`${baseUrl}/api/approval-actions/${encodeURIComponent(approvalToken.token)}`).then((response) => response.json());
    assert.equal(tokenStatus.action.status, "active");

    const approved = await fetch(`${baseUrl}/api/approval-actions/${encodeURIComponent(approvalToken.token)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ note: "api token test" }),
    }).then((response) => response.json());
    const approvedProof = approved.state.approvals.find((approval) => approval.id === "appr-digital-product-dry-run");
    assert.equal(approvedProof.status, "approved");
    assert.equal(approved.result.action.status, "used");

    const tick = await fetch(`${baseUrl}/api/runtime/tick`, { method: "POST" }).then((response) => response.json());
    assert.equal(tick.result.status, "completed");
    const proofWorkflow = tick.state.workflows.find((workflow) => workflow.id === "wf-digital-product-pilot-proof");
    assert.equal(proofWorkflow.status, "dry_run_complete");
  } finally {
    await new Promise((resolve) => app.wss.close(resolve));
    await new Promise((resolve) => app.server.close(resolve));
    db.close();
    if (previousPackDir === undefined) delete process.env.JARVIS_APPROVAL_PACK_DIR;
    else process.env.JARVIS_APPROVAL_PACK_DIR = previousPackDir;
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousKey;
    if (previousLiveResearch === undefined) delete process.env.JARVIS_ENABLE_LIVE_RESEARCH;
    else process.env.JARVIS_ENABLE_LIVE_RESEARCH = previousLiveResearch;
    if (previousAdapterReady === undefined) delete process.env.JARVIS_LIVE_RESEARCH_ADAPTER_READY;
    else process.env.JARVIS_LIVE_RESEARCH_ADAPTER_READY = previousAdapterReady;
  }
});
