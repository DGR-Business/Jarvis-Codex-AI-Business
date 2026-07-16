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

function operatorDeliverable(deliverable) {
  const humanText = (value) => String(value || "")
    .replace(/Approval Pack \(for approval\)/gi, "Decision Brief")
    .replace(/Approval Pack/gi, "Decision Brief")
    .replace(/approval pack/gi, "decision brief");
  return {
    ...deliverable,
    human_name: humanText(deliverable.human_name),
    summary: humanText(deliverable.summary),
  };
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
    tracePolicy: payload.tracePolicy || null,
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
    "SELECT id, venture_id, workflow_id, title, status, error, payload, result, created_at, updated_at, '{}' AS metadata FROM tasks WHERE outcome_status = 'unknown' OR status = 'needs_attention' ORDER BY updated_at DESC",
    [],
  ), ["payload", "result"]);
  const completedPilotTasks = parseRows(all(
    db,
    "SELECT id, payload, created_at FROM tasks WHERE kind = 'live_ai_worker_execution' AND status = 'completed' ORDER BY created_at DESC",
    [],
  ), ["payload"]);
  for (const task of unknownTasks) {
    const fixtureId = task.payload?.pilotFixture?.id;
    const correctedRun = fixtureId
      ? completedPilotTasks.find((candidate) => (
        candidate.payload?.pilotFixture?.id === fixtureId
        && Date.parse(candidate.created_at) > Date.parse(task.created_at)
      ))
      : null;
    items.push({
      id: task.id,
      type: "unknown_outcome",
      title: correctedRun ? `${task.title}: first call billing check` : task.title,
      risk: "high",
      recommendation: correctedRun
        ? "The corrected run completed successfully. Reconcile only the first call's final provider charge; do not run it again."
        : "Check the provider outcome and reconcile any cost before deciding whether another attempt is justified.",
      expectedUpside: correctedRun
        ? "Keeps the cost record accurate without reopening completed work."
        : "Prevents duplicate work, duplicate spend and contradictory state.",
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
    const agentCapabilities = capabilities
      .filter((item) => item.agent_id === definition.id)
      .sort((left, right) => (
        Number(right.consecutive_passes || 0) - Number(left.consecutive_passes || 0)
        || Number(right.required_passes || 5) - Number(left.required_passes || 5)
        || String(left.capability_key).localeCompare(String(right.capability_key))
      ));
    const capability = agentCapabilities[0];
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
            capabilityKey: capability.capability_key,
            capabilityCount: agentCapabilities.length,
          }
        : { status: "supervised", passes: 0, required: 5, riskTier: 0, capabilityKey: null, capabilityCount: 0 },
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
  )).map(operatorDeliverable).map((deliverable) => ({
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
  if (event.type === "approval_pack.generated") return "A PDF decision brief is ready to preview.";
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
    )).map(operatorDeliverable),
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

function elapsedMilliseconds(startedAt, completedAt) {
  const start = Date.parse(startedAt || "");
  const end = Date.parse(completedAt || "");
  return Number.isFinite(start) && Number.isFinite(end) ? Math.max(0, end - start) : null;
}

function getAgentRunDetail(db, id) {
  const runRecord = get(db, "SELECT * FROM agent_runs WHERE id = ?", [id]);
  if (!runRecord) return null;
  const runMetadata = fromJson(runRecord.metadata, {});
  const definition = get(db, "SELECT id, name, role FROM agent_definitions WHERE id = ?", [runRecord.agent_id]);
  const taskRow = runRecord.task_id ? get(db, "SELECT * FROM tasks WHERE id = ?", [runRecord.task_id]) : null;
  const task = taskRow ? {
    ...taskRow,
    payload: fromJson(taskRow.payload, {}),
    result: fromJson(taskRow.result, {}),
  } : null;
  const modelCallRow = runRecord.model_call_id
    ? get(db, "SELECT * FROM model_calls WHERE id = ?", [runRecord.model_call_id])
    : get(db, "SELECT * FROM model_calls WHERE task_id = ? ORDER BY created_at DESC LIMIT 1", [runRecord.task_id]);
  const modelCall = modelCallRow ? { ...modelCallRow, metadata: fromJson(modelCallRow.metadata, {}) } : null;
  const evaluationRow = get(db, "SELECT * FROM agent_eval_results WHERE run_id = ? ORDER BY created_at DESC LIMIT 1", [id]);
  const evaluation = evaluationRow ? {
    ...evaluationRow,
    criteria: fromJson(evaluationRow.criteria, []),
    findings: fromJson(evaluationRow.findings, []),
    metadata: fromJson(evaluationRow.metadata, {}),
  } : null;
  const reviewRow = get(db, "SELECT * FROM agent_pilot_reviews WHERE run_id = ?", [id]);
  const review = reviewRow ? { ...reviewRow, criteria: fromJson(reviewRow.criteria, {}) } : null;
  const fixtureId = review?.fixture_id || task?.payload?.pilotFixture?.id || null;
  const fixtureRow = fixtureId ? get(
    db,
    `SELECT id, venture_id, captured_at, question, buyer, hypothesis, sources,
            constraints, fixture_hash, status, created_at
     FROM agent_pilot_fixtures WHERE id = ?`,
    [fixtureId],
  ) : null;
  const fixture = fixtureRow ? {
    ...fixtureRow,
    sources: fromJson(fixtureRow.sources, []),
    constraints: fromJson(fixtureRow.constraints, {}),
  } : null;
  const traces = parseRows(all(
    db,
    "SELECT * FROM agent_trace_events WHERE run_id = ? ORDER BY sequence ASC",
    [id],
  ));
  const handoffs = parseRows(all(
    db,
    "SELECT * FROM agent_handoffs WHERE from_run_id = ? ORDER BY created_at ASC",
    [id],
  ));
  const costRow = task ? get(
    db,
    "SELECT * FROM costs WHERE id = ? OR (workflow_id = ? AND category = 'live_ai_worker') ORDER BY occurred_at DESC LIMIT 1",
    [`cost_spend_${task.id}`, task.workflow_id],
  ) : null;
  const cost = costRow ? { ...costRow, metadata: fromJson(costRow.metadata, {}) } : null;
  const approvalId = task?.payload?.liveSpendRequest?.approvalId || null;
  const approval = approvalId ? get(db, "SELECT id, status, scope_hash, requested_at, decided_at, consumed_at FROM approvals WHERE id = ?", [approvalId]) : null;
  const output = task?.result?.output || {};
  const recommendation = output.pilotRecommendation || {
    evidence: output.evidence || [],
    counterevidence: output.counterevidence || [],
    assumptions: output.assumptions || [],
    priceChannelHypothesis: output.priceChannelHypothesis || "",
    smallestTest: output.smallestTest || output.nextAction || "",
    metric: output.metric || "",
    killRule: output.killRule || "",
    confidence: output.confidence || "",
    risks: output.risks || [],
  };
  const approvedTracePolicy = task?.payload?.liveSpendRequest?.tracePolicy || null;
  const tracePolicy = approvedTracePolicy || {
    providerResponseStored: false,
    providerTraceContent: false,
    localReviewStored: true,
    dataClass: "legacy_controlled_fixture",
    purpose: "The original run used privacy-first settings; its provider response cannot be retrieved from the Platform.",
  };
  const inputTokens = Number(modelCall?.input_tokens || 0);
  const outputTokens = Number(modelCall?.output_tokens || 0);
  const reconciledCostCents = Number(modelCall?.reconciled_cost_cents || modelCall?.actual_cost_cents || (cost?.status === "reconciled" ? cost.amount_cents : 0) || 0);

  return {
    schema: "jarvis_agent_run_review_v1",
    run: {
      id: runRecord.id,
      workerId: runRecord.agent_id,
      workerName: definition?.name || runRecord.agent_id,
      workerRole: definition?.role || "Specialist worker",
      taskId: runRecord.task_id,
      taskTitle: task?.title || runMetadata.taskTitle || "AI worker run",
      status: runRecord.status,
      summary: output.summary || runRecord.output_summary || "No result summary was captured.",
      startedAt: runRecord.started_at,
      completedAt: runRecord.completed_at,
      durationMs: elapsedMilliseconds(runRecord.started_at, runRecord.completed_at),
    },
    process: {
      explanation: "This is a structured account of the evidence, judgement and result. It does not expose hidden private model chain-of-thought.",
      question: fixture?.question || task?.payload?.subject || "No question was recorded.",
      buyer: fixture?.buyer || output.businessDecision?.buyer || "No buyer was recorded.",
      hypothesis: fixture?.hypothesis || output.businessDecision?.continuousImprovement?.hypothesis || "No hypothesis was recorded.",
      suppliedEvidence: (fixture?.sources || []).map((source) => ({
        id: source.id || null,
        title: source.title || "Evidence item",
        summary: source.summary || "",
        sourceType: source.sourceType || "unknown",
        url: source.url || null,
      })),
      supportingEvidence: recommendation.evidence || [],
      counterevidence: recommendation.counterevidence || [],
      assumptions: recommendation.assumptions || [],
      conclusion: output.summary || runRecord.output_summary || "No conclusion was captured.",
      priceChannelHypothesis: recommendation.priceChannelHypothesis || "Not stated.",
      smallestTest: recommendation.smallestTest || "Not stated.",
      metric: recommendation.metric || "Not stated.",
      stopRule: recommendation.killRule || "Not stated.",
      confidence: recommendation.confidence || output.confidence || "not stated",
      risks: recommendation.risks || output.risks || [],
      nextAction: output.nextAction || recommendation.smallestTest || "Review before continuing.",
      operatorDecision: output.operatorDecision || "needs_evidence",
    },
    review: review ? {
      deterministicStatus: review.deterministic_status,
      operatorVerdict: review.operator_verdict,
      usefulnessScore: review.usefulness_score,
      note: review.note,
      criteria: review.criteria,
      outputHash: review.output_hash,
      reviewedAt: review.reviewed_at,
    } : null,
    execution: {
      provider: modelCall?.metadata?.provider || review?.provider || runRecord.mode,
      model: modelCall?.selected_model || "Not recorded",
      responseId: modelCall?.provider_request_id || modelCall?.metadata?.responseId || null,
      traceId: review?.trace_id || modelCall?.metadata?.agentSdkTraceId || runMetadata.agentSdkTraceId || null,
      inputTokens,
      outputTokens,
      totalTokens: Number(modelCall?.metadata?.totalTokens || inputTokens + outputTokens),
      rawResponses: Number(modelCall?.metadata?.rawResponseCount || 0),
      interruptions: Number(modelCall?.metadata?.interruptionCount || 0),
      sdkTools: task?.payload?.liveSpendRequest?.tools || [],
      sdkHandoffs: 0,
      runtimeHandoffs: handoffs.map((handoff) => ({
        id: handoff.id,
        from: handoff.from_agent_id,
        to: handoff.to_agent_id,
        status: handoff.status,
        summary: handoff.summary,
      })),
      externalEffects: task?.payload?.liveSpendRequest?.effects || [],
      tracePolicy: {
        ...tracePolicy,
        legacyPolicyInferred: approvedTracePolicy === null,
      },
      cost: {
        status: modelCall?.cost_status || cost?.status || "not_recorded",
        estimatedCents: Number(modelCall?.estimated_cost_cents || 0),
        reconciledCents: reconciledCostCents,
        currency: cost?.currency || CONFIG.currency,
      },
    },
    quality: evaluation ? {
      status: evaluation.status,
      score: evaluation.score,
      criteria: evaluation.criteria,
      findings: evaluation.findings,
      evaluationId: evaluation.id,
    } : null,
    developer: {
      fixtureId,
      fixtureHash: fixture?.fixture_hash || task?.payload?.liveSpendRequest?.fixtureHash || null,
      approval,
      modelCallId: modelCall?.id || null,
      structuredOutput: output,
      traceEvents: traces,
    },
  };
}

module.exports = {
  getAgentDetail,
  getAgentRunDetail,
  getAiTeamState,
  getBusinessTestsState,
  getCockpitState,
  getDecisionsState,
  getSystemState,
  getTestDetail,
  humanTaskStatus,
  spendState,
};
