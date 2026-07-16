const { all, fromJson, get, insertEvent, now, run, toJson } = require("../db");
const { summarizeCommercialEvidence } = require("./commercial-results");

const CHANNEL_PROFILES = {
  POD: {
    executionFit: 64,
    monetisationPath: 58,
    distribution: "marketplace and supplier-push",
  },
  "Digital Product": {
    executionFit: 68,
    monetisationPath: 62,
    distribution: "marketplace, direct checkout, or audience-led sales",
  },
  Content: {
    executionFit: 54,
    monetisationPath: 46,
    distribution: "search, newsletter, affiliate, or owned audience",
  },
  "Business Idea": {
    executionFit: 50,
    monetisationPath: 45,
    distribution: "to be validated",
  },
};

const WEIGHTS = {
  demand_signal: 0.22,
  monetisation_path: 0.18,
  execution_fit: 0.15,
  risk_control: 0.15,
  evidence_quality: 0.2,
  automation_readiness: 0.1,
};

function parseRows(rows, fields = ["metadata", "payload", "result"]) {
  return rows.map((row) => {
    const copy = { ...row };
    for (const field of fields) {
      if (field in copy) copy[field] = fromJson(copy[field]);
    }
    return copy;
  });
}

function hydrateWorkflow(row) {
  return row ? { ...row, metadata: fromJson(row.metadata) } : null;
}

function clampScore(value) {
  return Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
}

function scoreVerdict(totalScore, evidenceQuality) {
  if (evidenceQuality < 45) return "research_required";
  if (totalScore >= 78) return "continue";
  if (totalScore >= 62) return "revise";
  return "kill_or_rework";
}

function recommendationFor(verdict) {
  return {
    research_required: "Do not spend, publish, or build live assets yet. Approve live research if this idea still looks commercially interesting.",
    continue: "Continue to the next approved commercial step with explicit spend and action limits.",
    revise: "Revise the offer, channel, pricing, or risk controls before spending more.",
    kill_or_rework: "Stop or substantially rework this idea before it consumes more time or budget.",
  }[verdict];
}

function confidenceFor(evidenceQuality, researchRuns, commercialEvidence) {
  if (commercialEvidence.sales > 0) return "medium_with_sales_signal";
  if (commercialEvidence.resultCount > 0 || commercialEvidence.feedbackCount > 0) return "medium_with_market_results";
  if (evidenceQuality < 45) return "low_until_live_evidence";
  if (researchRuns.some((runRecord) => runRecord.status === "completed_live")) return "medium_with_live_research";
  return "medium";
}

function dimension(label, score, note) {
  return {
    label,
    score: clampScore(score),
    note,
  };
}

function inferChannel(workflow, command) {
  if (workflow.metadata.channel) return workflow.metadata.channel;
  if (command.metadata?.channel) return command.metadata.channel;
  if (workflow.type === "digital_product_publish" || workflow.venture_id === "venture-digital-products") return "Digital Product";
  if (workflow.type === "pod_publish" || /gelato|pod/i.test(workflow.type || "")) return "POD";
  return "Business Idea";
}

function inferSubject(workflow, command) {
  return workflow.metadata.subject || command.metadata?.subject || workflow.title || "Business idea";
}

function completedTaskKinds(tasks) {
  const aliases = {
    design_qc: "risk_screen",
    finance_model: "commercial_analysis",
    publish_digital_product_dry_run: "operator_pack_qc",
    publish_gelato_dry_run: "operator_pack_qc",
  };
  return new Set(
    tasks
      .filter((task) => task.status === "completed")
      .flatMap((task) => [task.kind, aliases[task.kind]].filter(Boolean)),
  );
}

function calculateScorecard(db, workflowId) {
  const workflow = hydrateWorkflow(get(db, "SELECT * FROM workflows WHERE id = ?", [workflowId]));
  if (!workflow) throw new Error(`Workflow not found: ${workflowId}`);
  const commandRow = get(db, "SELECT * FROM commands WHERE workflow_id = ? ORDER BY created_at DESC LIMIT 1", [workflowId]) || {};
  const command = { ...commandRow, metadata: fromJson(commandRow.metadata) };
  const tasks = parseRows(all(db, "SELECT * FROM tasks WHERE workflow_id = ? ORDER BY priority ASC, created_at ASC", [workflowId]));
  const researchRuns = parseRows(all(db, "SELECT * FROM research_runs WHERE workflow_id = ? ORDER BY created_at DESC", [workflowId]), ["metadata"]);
  const channel = inferChannel(workflow, command);
  const subject = inferSubject(workflow, command);
  const profile = CHANNEL_PROFILES[channel] || CHANNEL_PROFILES["Business Idea"];
  const completedKinds = completedTaskKinds(tasks);
  const hasLiveResearch = researchRuns.some((runRecord) => runRecord.status === "completed_live");
  const needsLiveResearch = researchRuns.some((runRecord) => runRecord.status === "needs_live_research") || completedKinds.has("market_research");
  const allAgentTasksComplete = tasks.length > 0 && tasks.every((task) => ["completed", "cancelled"].includes(task.status));
  const commercialEvidence = summarizeCommercialEvidence(db, { workflowId });
  const hasCommercialResults = commercialEvidence.resultCount > 0;
  const hasBuyerAction = commercialEvidence.clicks > 0 || commercialEvidence.leads > 0 || commercialEvidence.sales > 0;
  const hasSales = commercialEvidence.sales > 0;
  const hasProfit = commercialEvidence.profitCents > 0;
  const hasNegativeCustomerSignal = commercialEvidence.refundRate > 15 || commercialEvidence.sentiment.negative > commercialEvidence.sentiment.positive + 1;

  const demandSignal = hasSales ? 84 : hasBuyerAction ? 62 : hasCommercialResults ? 38 : hasLiveResearch ? 72 : needsLiveResearch ? 34 : 22;
  const monetisationPath = profile.monetisationPath
    + (completedKinds.has("commercial_analysis") ? 8 : -10)
    + (hasSales ? 12 : 0)
    + (hasProfit ? 10 : 0)
    - (commercialEvidence.spendCents > commercialEvidence.revenueCents && commercialEvidence.spendCents > 0 ? 16 : 0);
  const executionFit = profile.executionFit + (completedKinds.has("mockup_direction") ? 4 : 0) + (completedKinds.has("goal_planning") ? 4 : 0);
  const riskControl = (completedKinds.has("risk_screen") ? 61 : 35)
    - (hasNegativeCustomerSignal ? 14 : 0)
    + (commercialEvidence.resultCount > 0 && commercialEvidence.spendCents === 0 ? 5 : 0);
  const evidenceQuality = hasSales ? 84 : hasCommercialResults ? 58 : hasLiveResearch ? 72 : needsLiveResearch ? 28 : 20;
  const automationReadiness = completedKinds.has("operator_pack_qc") ? 70 : allAgentTasksComplete ? 60 : 38;

  const dimensions = {
    demand_signal: dimension(
      "Demand signal",
      demandSignal,
      hasSales
        ? "The workflow has recorded paid buyer action."
        : hasBuyerAction
          ? "The workflow has recorded buyer interest, but not enough paid demand yet."
          : hasCommercialResults
            ? "A market contact result exists, but buyer action is weak."
            : hasLiveResearch ? "Live demand evidence is present." : "Live market/search evidence is still required.",
    ),
    monetisation_path: dimension(
      "Monetisation path",
      monetisationPath,
      hasCommercialResults
        ? `Recorded ${commercialEvidence.sales} sale(s), ${commercialEvidence.refunds} refund(s), and ${commercialEvidence.profitCents} cents profit.`
        : `Channel profile: ${profile.distribution}. Costs and pricing still need live validation.`,
    ),
    execution_fit: dimension(
      "Execution fit",
      executionFit,
      "Runtime can plan and run dry-run internal work for this channel, but live tooling is not fully connected.",
    ),
    risk_control: dimension(
      "Risk control",
      riskControl,
      hasNegativeCustomerSignal
        ? "Refund or negative customer signal needs attention before scaling."
        : completedKinds.has("risk_screen") ? "Risk screen completed in dry-run mode." : "Risk screen has not completed.",
    ),
    evidence_quality: dimension(
      "Evidence quality",
      evidenceQuality,
      hasSales
        ? "Evidence includes actual buyer payment signal."
        : hasCommercialResults
          ? "Evidence includes recorded market results."
          : hasLiveResearch ? "Evidence includes live research." : "Evidence is process proof and dry-run research only.",
    ),
    automation_readiness: dimension(
      "Automation readiness",
      automationReadiness,
      completedKinds.has("operator_pack_qc") ? "Operator pack QC completed." : "Workflow has not reached operator-pack QC.",
    ),
  };

  const totalScore = clampScore(
    Object.entries(WEIGHTS).reduce((sum, [key, weight]) => sum + dimensions[key].score * weight, 0),
  );
  const verdict = scoreVerdict(totalScore, dimensions.evidence_quality.score);
  const risks = [
    !hasLiveResearch ? "No live market evidence has been captured yet." : null,
    !hasCommercialResults ? "No buyer/channel result has been recorded yet." : null,
    commercialEvidence.spendCents > commercialEvidence.revenueCents && commercialEvidence.spendCents > 0 ? "Recorded spend is higher than recorded revenue." : null,
    hasNegativeCustomerSignal ? "Refund or negative customer feedback signal is above the safe threshold." : null,
    "Commercial assumptions are not proof of profit until tested against real demand and costs.",
    workflow.approval_required ? "Next step needs operator approval." : null,
    completedKinds.has("risk_screen") ? null : "Risk screen is incomplete.",
  ].filter(Boolean);
  const nextActions = commercialEvidence.latestLearning
    ? [
        commercialEvidence.latestLearning.next_action,
        commercialEvidence.latestLearning.improvement,
        "Record the next result after the smallest useful action.",
      ].filter(Boolean)
    : verdict === "research_required"
    ? [
        "Approve a capped live research run if the idea still seems worth testing.",
        "Validate current demand, competitors, pricing, and platform/IP risk.",
        "Return with a keep, revise, or kill recommendation before paid creation.",
      ]
    : [
        "Prepare the next review decision with cost, scope, and rollback limits.",
        "Keep all live actions locked until operator approval is captured.",
      ];

  return {
    workflow,
    command,
    channel,
    subject,
    status: ["ready_for_review", "dry_run_complete"].includes(workflow.status) ? "ready_for_review" : "draft",
    verdict,
    recommendation: recommendationFor(verdict),
    totalScore,
    confidence: confidenceFor(dimensions.evidence_quality.score, researchRuns, commercialEvidence),
    dimensions,
    risks,
    nextActions,
    metadata: {
      profile,
      taskCount: tasks.length,
      completedTaskCount: tasks.filter((task) => task.status === "completed").length,
      researchRunCount: researchRuns.length,
      hasLiveResearch,
      commercialEvidence,
      generatedFrom: "runtime-scorecard",
    },
  };
}

function upsertWorkflowScorecard(db, workflowId, options = {}) {
  const scorecard = calculateScorecard(db, workflowId);
  const id = `score_${workflowId}`;
  const ts = now();
  run(
    db,
    `INSERT INTO venture_scorecards
     (id, venture_id, workflow_id, command_id, channel, subject, status, verdict, recommendation,
      total_score, confidence, dimensions, risks, next_actions, metadata, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(workflow_id) DO UPDATE SET
       venture_id = excluded.venture_id,
       command_id = excluded.command_id,
       channel = excluded.channel,
       subject = excluded.subject,
       status = excluded.status,
       verdict = excluded.verdict,
       recommendation = excluded.recommendation,
       total_score = excluded.total_score,
       confidence = excluded.confidence,
       dimensions = excluded.dimensions,
       risks = excluded.risks,
       next_actions = excluded.next_actions,
       metadata = excluded.metadata,
       updated_at = excluded.updated_at`,
    [
      id,
      scorecard.workflow.venture_id || null,
      scorecard.workflow.id,
      scorecard.command.id || null,
      scorecard.channel,
      scorecard.subject,
      scorecard.status,
      scorecard.verdict,
      scorecard.recommendation,
      scorecard.totalScore,
      scorecard.confidence,
      toJson(scorecard.dimensions),
      toJson(scorecard.risks),
      toJson(scorecard.nextActions),
      toJson({ ...scorecard.metadata, taskId: options.taskId || null }),
      ts,
      ts,
    ],
  );
  insertEvent(db, {
    actor: "scorecard-engine",
    type: "venture_scorecard.updated",
    entityType: "workflow",
    entityId: workflowId,
    message: `Scorecard updated for ${scorecard.subject}: ${scorecard.totalScore}/100, ${scorecard.verdict}.`,
    metadata: { scorecardId: id, verdict: scorecard.verdict, totalScore: scorecard.totalScore },
  });
  return getWorkflowScorecard(db, workflowId);
}

function getWorkflowScorecard(db, workflowId) {
  const row = get(db, "SELECT * FROM venture_scorecards WHERE workflow_id = ?", [workflowId]);
  if (!row) return null;
  return {
    ...row,
    dimensions: fromJson(row.dimensions),
    risks: fromJson(row.risks, []),
    next_actions: fromJson(row.next_actions, []),
    metadata: fromJson(row.metadata),
  };
}

function ensureWorkflowScorecards(db) {
  const rows = all(
    db,
    `SELECT workflows.id
     FROM workflows
     LEFT JOIN venture_scorecards ON venture_scorecards.workflow_id = workflows.id
     WHERE venture_scorecards.id IS NULL
       AND workflows.status IN ('ready_for_review', 'dry_run_complete')
       AND EXISTS (SELECT 1 FROM tasks WHERE tasks.workflow_id = workflows.id AND tasks.status = 'completed')
     ORDER BY workflows.updated_at DESC`,
  );
  const scorecards = [];
  for (const row of rows) {
    scorecards.push(upsertWorkflowScorecard(db, row.id, { backfill: true }));
  }
  return { created: scorecards.length, scorecards };
}

module.exports = {
  calculateScorecard,
  ensureWorkflowScorecards,
  getWorkflowScorecard,
  upsertWorkflowScorecard,
};
