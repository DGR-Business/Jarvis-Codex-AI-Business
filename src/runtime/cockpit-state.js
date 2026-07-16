const CONFIG = require("../config");
const { all, fromJson, get } = require("../db");
const { ensureApprovalScope } = require("./approval-scope");
const { listAgentDefinitions } = require("./ai-team");
const { commercialFoundationState } = require("./venture-case");
const { getPilotState } = require("./agent-pilot");
const { ensureCapabilityAutonomy } = require("./capability-autonomy");
const { getLiveAiWorkerReadiness } = require("./live-ai-worker-readiness");
const { getLiveResearchReadiness } = require("./live-research-readiness");
const { getLatestDigest } = require("./executive-digest");
const { getAccountingSummary } = require("./accounting-ledger");

function parseRows(rows, fields = ["metadata"]) {
  return rows.map((row) => {
    const parsed = { ...row };
    for (const field of fields) parsed[field] = fromJson(parsed[field], field.endsWith("s") ? [] : {});
    return parsed;
  });
}

function humanTaskStatus(status) {
  return {
    planned: "Waiting",
    queued: "Ready",
    running: "Working",
    blocked: "Needs attention",
    waiting_approval: "Needs attention",
    needs_attention: "Needs attention",
    needs_changes: "Changes requested",
    completed: "Completed",
    failed: "Needs attention",
    cancelled: "Stopped",
  }[status] || "Standby";
}

function pendingApprovals(db) {
  return all(db, "SELECT * FROM approvals WHERE status = 'pending' ORDER BY CASE risk_level WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, requested_at")
    .map((row) => {
      const scoped = ensureApprovalScope(db, row.id).approval;
      return { ...scoped, payload: fromJson(scoped.payload), expectedEffects: fromJson(scoped.expected_effects, []) };
    });
}

function decisionCard(approval) {
  const payload = approval.payload || {};
  return {
    id: approval.id,
    type: "decision",
    decisionKind: "approval",
    title: approval.title,
    risk: approval.risk_level,
    requestedAt: approval.requested_at,
    scopeHash: approval.scope_hash,
    expiresAt: approval.expires_at,
    recommendation: payload.reason || payload.commercialPurpose || "Review the evidence and choose whether this exact action should continue.",
    expectedUpside: payload.expectedMetric || payload.expectedUpside || "The expected benefit has not been quantified yet.",
    maxCostCents: Number(payload.estimatedCostCents || payload.maxCostCents || 0),
    provider: payload.provider || null,
    worker: payload.worker?.name || payload.requestedWorker || null,
    effects: approval.expectedEffects,
    actions: ["approve", "changes", "reject"],
  };
}

function pendingHandoffs(db) {
  return parseRows(all(
    db,
    `SELECT agent_handoffs.*, workflows.title AS workflow_title,
            agent_definitions.name AS from_agent_name,
            workflows.expected_profit_cents, workflows.cost_estimate_cents
     FROM agent_handoffs
     LEFT JOIN workflows ON workflows.id = agent_handoffs.workflow_id
     LEFT JOIN agent_definitions ON agent_definitions.id = agent_handoffs.from_agent_id
     WHERE agent_handoffs.status IN ('needs_operator_decision', 'waiting_for_review', 'waiting_approval')
     ORDER BY CASE agent_handoffs.risk_level WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END,
              agent_handoffs.updated_at`,
  ));
}

function handoffCard(handoff) {
  return {
    id: handoff.id,
    type: "decision",
    decisionKind: "handoff",
    title: handoff.decision_needed || `Choose the next step for ${handoff.workflow_title || "this work"}`,
    risk: handoff.risk_level || "medium",
    requestedAt: handoff.updated_at || handoff.created_at,
    recommendation: handoff.summary || handoff.reason || "Review the completed work and choose whether the team should continue.",
    expectedUpside: Number(handoff.expected_profit_cents || 0) > 0
      ? "Advances a bounded commercial step with the expected return shown in the work record."
      : "Keeps the venture moving without allowing an external action automatically.",
    maxCostCents: Number(handoff.cost_estimate_cents || 0),
    worker: handoff.from_agent_name || handoff.from_agent_id || null,
    workflowId: handoff.workflow_id || null,
    actions: ["approve", "changes", "reject"],
  };
}

function importantWork(db) {
  const items = [
    ...pendingApprovals(db).map(decisionCard),
    ...pendingHandoffs(db).map(handoffCard),
  ];
  const unknownTasks = parseRows(all(
    db,
    "SELECT id, venture_id, workflow_id, title, status, error, result, updated_at, '{}' AS metadata FROM tasks WHERE outcome_status = 'unknown' OR status = 'needs_attention' ORDER BY updated_at DESC",
    [],
  ), ["result"]);
  for (const task of unknownTasks) {
    items.push({
      id: task.id,
      type: "unknown_outcome",
      title: task.title,
      risk: "high",
      recommendation: "Check the provider outcome and reconcile any cost before retrying.",
      expectedUpside: "Prevents duplicate work, duplicate spend and contradictory state.",
      workflowId: task.workflow_id,
    });
  }
  const urgent = parseRows(all(
    db,
    "SELECT * FROM messages WHERE status = 'open' AND severity = 'urgent' ORDER BY created_at DESC LIMIT 10",
  ));
  for (const message of urgent) {
    if (items.some((item) => item.id === message.task_id || item.title === message.subject)) continue;
    items.push({
      id: message.id,
      type: "attention",
      title: message.subject,
      risk: "high",
      recommendation: message.body,
      expectedUpside: "Resolve the issue that is stopping trusted progress.",
    });
  }
  return items.slice(0, 12);
}

function testStatus(status) {
  const normalized = String(status || "").toLowerCase();
  if (["ready", "ready_to_run", "approved"].includes(normalized)) return "ready";
  if (["running", "active", "in_market"].includes(normalized)) return "running";
  if (["completed", "finished", "measured"].includes(normalized)) return "completed";
  if (["cancelled", "killed", "paused"].includes(normalized)) return "cancelled";
  return "candidate";
}

function currentTest(db, ventureId) {
  const row = get(
    db,
    "SELECT * FROM commercial_experiments WHERE venture_id = ? AND status IN ('ready', 'running') ORDER BY CASE status WHEN 'running' THEN 0 ELSE 1 END, updated_at DESC LIMIT 1",
    [ventureId],
  );
  return row ? { ...row, status: testStatus(row.status), metadata: fromJson(row.metadata) } : null;
}

function teamState(db, ventureId) {
  ensureCapabilityAutonomy(db);
  const definitions = listAgentDefinitions(db);
  const capabilities = parseRows(all(db, "SELECT * FROM capability_autonomy ORDER BY capability_key"));
  const groups = {
    command: ["chief_of_staff"],
    evidence: ["opportunity_scout", "demand_validator"],
    venture: ["offer_architect", "product_builder", "copy_conversion_agent", "distribution_operator"],
    control: ["finance_analyst", "customer_voice_agent", "growth_analyst", "quality_reviewer"],
  };
  const groupByAgent = Object.fromEntries(Object.entries(groups).flatMap(([group, ids]) => ids.map((id) => [id, group])));
  return definitions.map((definition) => {
    const latestRun = get(
      db,
      `SELECT agent_runs.*, tasks.title AS task_title, tasks.status AS task_status
       FROM agent_runs LEFT JOIN tasks ON tasks.id = agent_runs.task_id
       WHERE agent_runs.agent_id = ? AND (agent_runs.venture_id = ? OR agent_runs.venture_id IS NULL)
       ORDER BY agent_runs.started_at DESC LIMIT 1`,
      [definition.id, ventureId],
    );
    const activeTask = get(
      db,
      "SELECT * FROM tasks WHERE venture_id = ? AND agent = ? AND status IN ('running','queued','blocked','waiting_approval','needs_attention') ORDER BY updated_at DESC LIMIT 1",
      [ventureId, definition.id],
    );
    const capability = capabilities.find((item) => item.agent_id === definition.id);
    const rawStatus = activeTask?.status || "standby";
    return {
      id: definition.id,
      name: definition.name,
      group: groupByAgent[definition.id] || "control",
      status: humanTaskStatus(rawStatus),
      assignment: activeTask?.title || "No current assignment",
      lastOutcome: latestRun?.output_summary || "No reviewed result yet",
      autonomy: capability
        ? {
            status: capability.status,
            passes: capability.consecutive_passes,
            required: capability.required_passes,
            riskTier: capability.risk_tier,
          }
        : { status: "supervised", passes: 0, required: 5, riskTier: 0 },
      technical: {
        modelClass: definition.model_class,
        mode: definition.mode,
        lastRunId: latestRun?.id || null,
      },
    };
  });
}

function spendState(db) {
  const budget = fromJson(get(db, "SELECT value FROM settings WHERE key = 'budget'")?.value, {});
  const rows = all(
    db,
    "SELECT status, COALESCE(SUM(amount_cents), 0) AS cents FROM costs GROUP BY status",
  );
  const byStatus = Object.fromEntries(rows.map((row) => [row.status, Number(row.cents || 0)]));
  const reservations = all(
    db,
    "SELECT status, COALESCE(SUM(amount_cents), 0) AS cents FROM budget_reservations GROUP BY status",
  );
  const reservedByStatus = Object.fromEntries(reservations.map((row) => [row.status, Number(row.cents || 0)]));
  return {
    currency: budget.currency || CONFIG.currency,
    monthlyCapCents: Number(budget.monthlyBudgetCents || CONFIG.monthlyBudgetCents),
    reconciledCents: Number(byStatus.reconciled || 0),
    incurredEstimateCents: Number(byStatus.incurred_estimate || 0),
    unknownCents: Number(byStatus.unknown || 0),
    reservedCents: Number(reservedByStatus.reserved || 0),
    accounting: getAccountingSummary(db),
  };
}

function getCockpitState(db) {
  const commercial = commercialFoundationState(db);
  const team = teamState(db, commercial.venture.id);
  const work = importantWork(db);
  const test = currentTest(db, commercial.venture.id);
  const queue = get(db, "SELECT COUNT(*) AS count FROM tasks WHERE status IN ('planned','queued','running')");
  const failed = get(db, "SELECT COUNT(*) AS count FROM tasks WHERE status IN ('failed','needs_attention')");
  return {
    generatedAt: new Date().toISOString(),
    activeVenture: commercial.venture,
    ventureCase: commercial.ventureCase,
    importantWork: work,
    currentTest: test,
    nextMoneyMove: commercial.ventureCase.next_money_move,
    economics: commercial.economics,
    spend: spendState(db),
    teamPulse: {
      working: team.filter((agent) => agent.status === "Working").length,
      needsAttention: team.filter((agent) => agent.status === "Needs attention").length,
      standby: team.filter((agent) => agent.status === "Standby").length,
      agents: team,
    },
    health: {
      label: Number(failed?.count || 0) > 0 ? "Needs attention" : "Operating normally",
      queuedWork: Number(queue?.count || 0),
      importantItems: work.length,
    },
    weeklyDigest: getLatestDigest(db, commercial.venture.id),
  };
}

function getDecisionsState(db) {
  const approvals = [
    ...pendingApprovals(db).map(decisionCard),
    ...pendingHandoffs(db).map(handoffCard),
  ];
  const reviews = parseRows(all(
    db,
    `SELECT * FROM deliverables
     WHERE status = 'ready_for_review'
     ORDER BY updated_at DESC LIMIT 20`,
  )).map((deliverable) => ({
    id: deliverable.id,
    title: deliverable.human_name,
    summary: deliverable.summary,
    format: deliverable.format,
    filePath: deliverable.file_path,
    workflowId: deliverable.workflow_id,
    updatedAt: deliverable.updated_at,
  }));
  const suggestions = parseRows(all(
    db,
    "SELECT * FROM messages WHERE status = 'open' AND severity NOT IN ('urgent','approval') ORDER BY created_at DESC LIMIT 20",
  )).map((message) => ({ id: message.id, title: message.subject, summary: message.body, createdAt: message.created_at }));
  const approvalHistory = parseRows(all(
    db,
    "SELECT * FROM approvals WHERE status <> 'pending' ORDER BY decided_at DESC LIMIT 30",
  )).map((approval) => ({ id: approval.id, title: approval.title, decision: approval.status, note: approval.decision_note, decidedAt: approval.decided_at }));
  const handoffHistory = parseRows(all(
    db,
    `SELECT * FROM agent_handoffs
     WHERE status NOT IN ('needs_operator_decision', 'waiting_for_review', 'waiting_approval')
       AND resolved_at IS NOT NULL
     ORDER BY resolved_at DESC LIMIT 30`,
  )).map((handoff) => ({
    id: handoff.id,
    title: handoff.decision_needed || "AI team next step",
    decision: handoff.status,
    note: handoff.metadata?.operatorDecision?.note || handoff.summary,
    decidedAt: handoff.resolved_at,
  }));
  const history = [...approvalHistory, ...handoffHistory]
    .sort((a, b) => String(b.decidedAt || "").localeCompare(String(a.decidedAt || "")))
    .slice(0, 30);
  return { approvals, reviews, suggestions, history };
}

function getBusinessTestsState(db) {
  const commercial = commercialFoundationState(db);
  const experiments = parseRows(all(
    db,
    "SELECT * FROM commercial_experiments WHERE venture_id = ? ORDER BY updated_at DESC",
    [commercial.venture.id],
  )).map((experiment) => ({ ...experiment, status: testStatus(experiment.status) }));
  const tests = { candidate: [], ready: [], running: [], completed: [], cancelled: [] };
  for (const experiment of experiments) tests[experiment.status].push(experiment);
  return {
    activeVenture: commercial.venture,
    ventureCase: commercial.ventureCase,
    economics: commercial.economics,
    pilotPolicy: fromJson(get(db, "SELECT value FROM settings WHERE key = 'commercial.pilot'")?.value, {}),
    tests,
    workPackages: parseRows(all(db, "SELECT * FROM work_packages WHERE venture_id = ? ORDER BY created_at DESC", [commercial.venture.id])),
    evidence: commercial.evidence,
    sales: parseRows(all(
      db,
      `SELECT id, product_name, sold_at, currency, gross_cents, platform_fee_cents,
              net_cents, refunded_cents, referrer, status, imported_at
       FROM platform_sales WHERE venture_id = ? ORDER BY sold_at DESC LIMIT 100`,
      [commercial.venture.id],
    )),
  };
}

function getAiTeamState(db) {
  const commercial = commercialFoundationState(db);
  return { activeVenture: commercial.venture, agents: teamState(db, commercial.venture.id), pilot: getPilotState(db) };
}

function humanActivityMessage(event) {
  const metadata = event.metadata || {};
  if (event.type === "agent.handoff_decided") {
    return {
      approve: "The recommended next step was approved.",
      changes: "Changes were requested before the team can continue.",
      reject: "The recommended next step was declined.",
    }[metadata.decision] || "A consequential team decision was recorded.";
  }
  if (event.type === "workflow_run.completed") return "Internal work finished and is ready for review.";
  if (event.type === "approval_pack.generated") return "A PDF decision pack is ready to preview.";
  if (event.type === "command.planned") return "A new internal work plan was created.";
  if (event.type === "research.dry_run_created") return "An internal research plan was prepared; real market evidence is still required.";
  if (event.type === "task.completed") {
    const title = String(event.message || "Work")
      .replace(/ completed by the (?:dry-run|protected) agent runner\.?$/i, "")
      .trim();
    return `${title} is ready.`;
  }
  if (event.type === "venture_scorecard.updated") {
    const score = String(event.message || "").match(/(\d+)\s*\/\s*100/)?.[1];
    return score
      ? `The commercial scorecard is ${score}/100; more evidence is required.`
      : "The commercial scorecard was updated.";
  }
  return String(event.message || "Runtime activity recorded.")
    .replace(/dry[- ]run/gi, "internal")
    .replace(/research_required/gi, "more evidence needed")
    .replace(/\b[a-z]+(?:_[a-z]+)+\b/g, (value) => value.split("_").map((word) => `${word[0].toUpperCase()}${word.slice(1)}`).join(" "));
}

function activityState(db) {
  const foundationAt = get(db, "SELECT applied_at FROM schema_migrations WHERE version = 6")?.applied_at || "1970-01-01T00:00:00.000Z";
  return parseRows(all(
    db,
    `SELECT * FROM events
     WHERE ts >= ?
       AND type NOT IN (
         'scheduler.job.completed', 'monitor.completed', 'executive_digest.generated',
         'task.started', 'agent.handoff_created'
       )
     ORDER BY id DESC LIMIT 40`,
    [foundationAt],
  )).map((event) => ({ ...event, message: humanActivityMessage(event) }));
}

function getSystemState(db) {
  return {
    health: {
      database: get(db, "PRAGMA integrity_check").integrity_check,
      liveAi: getLiveAiWorkerReadiness(db),
      liveResearch: getLiveResearchReadiness(db),
    },
    queue: parseRows(all(
      db,
      `SELECT * FROM tasks
       WHERE status IN ('planned', 'queued', 'running', 'blocked', 'waiting_approval', 'needs_attention')
       ORDER BY CASE status WHEN 'running' THEN 0 WHEN 'needs_attention' THEN 1 WHEN 'blocked' THEN 2 ELSE 3 END,
                updated_at DESC LIMIT 50`,
    ), ["payload", "result"]),
    spend: spendState(db),
    connections: parseRows(all(db, "SELECT * FROM integrations ORDER BY name")),
    outputs: parseRows(all(
      db,
      "SELECT * FROM deliverables ORDER BY CASE status WHEN 'archived' THEN 1 ELSE 0 END, updated_at DESC LIMIT 50",
    )),
    activity: activityState(db),
    weeklyDigest: getLatestDigest(db),
  };
}

function getTestDetail(db, id) {
  const experiment = get(db, "SELECT * FROM commercial_experiments WHERE id = ?", [id]);
  if (!experiment) return null;
  return {
    experiment: { ...experiment, status: testStatus(experiment.status), metadata: fromJson(experiment.metadata) },
    evidence: parseRows(all(db, "SELECT * FROM commercial_evidence WHERE experiment_id = ? ORDER BY captured_at", [id])),
    results: parseRows(all(db, "SELECT * FROM commercial_results WHERE experiment_id = ? ORDER BY occurred_at", [id])),
    feedback: parseRows(all(db, "SELECT * FROM commercial_feedback WHERE experiment_id = ? ORDER BY occurred_at", [id])),
    learning: parseRows(all(db, "SELECT * FROM commercial_learning_cycles WHERE experiment_id = ? ORDER BY created_at DESC", [id])),
  };
}

function getAgentDetail(db, id) {
  const team = getAiTeamState(db).agents;
  const agent = team.find((item) => item.id === id);
  if (!agent) return null;
  return {
    agent,
    runs: parseRows(all(db, "SELECT * FROM agent_runs WHERE agent_id = ? ORDER BY started_at DESC LIMIT 30", [id])),
    evaluations: parseRows(all(db, "SELECT * FROM agent_eval_results WHERE agent_id = ? ORDER BY created_at DESC LIMIT 30", [id]), ["criteria", "findings", "metadata"]),
    capabilities: parseRows(all(db, "SELECT * FROM capability_autonomy WHERE agent_id = ?", [id])),
  };
}

module.exports = {
  getAgentDetail,
  getAiTeamState,
  getBusinessTestsState,
  getCockpitState,
  getDecisionsState,
  getSystemState,
  getTestDetail,
  humanTaskStatus,
  spendState,
};
