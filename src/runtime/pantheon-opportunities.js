const CONFIG = require("../config");
const { all, fromJson, get, insertEvent, now, randomId, run, toJson } = require("../db");
const { recordProtectedWorkerOutcome } = require("./ai-team");
const { requestLiveAiWorker } = require("./live-ai-workers");
const { approveInternalWorkWithinMandate, operatingMandateState } = require("./pantheon-policy");
const { prepareCatalogueBuild } = require("./pantheon-production");
const { journeyById, journeyForRound, updateJourney } = require("./pantheon-journey");
const { recordEvidence } = require("./venture-case");
const { selectVentureKit } = require("./venture-kit-registry");
const {
  persistInvestmentCase,
  projectCommercialInvestmentReview,
  queueCommercialInvestmentReview,
} = require("./commercial-investment-review");
const crypto = require("node:crypto");

const ACTIVE_ROUND_STATES = new Set([
  "researching",
  "validating",
  "checking_economics",
  "structuring_offer",
  "investment_review",
]);

const STEP_CONFIG = Object.freeze({
  opportunity_scout: {
    worker: "opportunity_scout",
    title: "Research and rank commercial opportunities",
    budgetCents: 500,
    model: () => CONFIG.terraModel,
    tools: ["research_adapter"],
    maxTurns: 5,
    maxToolCalls: 4,
    maxOutputTokens: 7000,
    deadlineMs: 180000,
    status: "researching",
  },
  demand_validator: {
    worker: "demand_validator",
    title: "Verify demand for the strongest opportunity",
    budgetCents: 500,
    model: () => CONFIG.solModel,
    tools: ["research_adapter"],
    maxTurns: 4,
    maxToolCalls: 3,
    maxOutputTokens: 4000,
    status: "validating",
  },
  finance_analysis: {
    worker: "finance_analyst",
    title: "Check unit economics and commercial viability",
    budgetCents: 150,
    model: () => CONFIG.terraModel,
    tools: [],
    maxTurns: 1,
    maxToolCalls: 0,
    maxOutputTokens: 4000,
    deadlineMs: 120000,
    status: "checking_economics",
  },
  offer_architecture: {
    worker: "offer_architect",
    title: "Design the offer and credible product catalogue",
    budgetCents: 200,
    model: () => CONFIG.terraModel,
    tools: [],
    maxTurns: 1,
    maxToolCalls: 0,
    maxOutputTokens: 4200,
    status: "structuring_offer",
  },
});

function slug(value, max = 42) {
  return String(value || "commercial")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max) || "commercial";
}

function cleanOpportunityTitle(value) {
  return String(value || "Untitled opportunity")
    .replace(/^\s*\d+\s*[.)-]\s*/, "")
    .trim();
}

function parseRow(row, jsonFields = ["metadata"]) {
  if (!row) return null;
  const parsed = { ...row };
  for (const field of jsonFields) parsed[field] = fromJson(row[field], field.endsWith("_ids") ? [] : {});
  return parsed;
}

function activeVenture(db) {
  const venture = get(db, "SELECT * FROM ventures WHERE is_active = 1 ORDER BY updated_at DESC LIMIT 1");
  if (!venture) throw new Error("Pantheon needs one active venture workspace before commercial discovery can begin.");
  return parseRow(venture);
}

function ensurePortfolioWorkspace(db) {
  const id = "venture-portfolio-controller";
  const existing = get(db, "SELECT * FROM ventures WHERE id = ?", [id]);
  if (existing) return parseRow(existing);
  const ts = now();
  run(
    db,
    `INSERT INTO ventures
     (id, name, stage, status, summary, metadata, created_at, updated_at,
      lifecycle_stage, is_active, business_model)
     VALUES (?, 'Portfolio Research', 0, 'internal_workspace',
       'Explicit non-operating workspace for broad discovery and pre-venture investment cases.',
       ?, ?, ?, 'candidate', 0, 'portfolio_research')`,
    [
      id,
      toJson({ systemWorkspace: true, visibleInVentureSelector: false, portfolioControllerVersion: 1 }),
      ts,
      ts,
    ],
  );
  return parseRow(get(db, "SELECT * FROM ventures WHERE id = ?", [id]));
}

function activeOpportunityRound(db) {
  const placeholders = [...ACTIVE_ROUND_STATES].map(() => "?").join(", ");
  return parseRow(get(
    db,
    `SELECT * FROM opportunity_rounds WHERE status IN (${placeholders}) ORDER BY created_at DESC LIMIT 1`,
    [...ACTIVE_ROUND_STATES],
  ));
}

function opportunityById(db, opportunityId) {
  return parseRow(
    get(db, "SELECT * FROM opportunities WHERE id = ?", [opportunityId]),
    ["evidence_ids", "metadata"],
  );
}

function clampScore(value) {
  return Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
}

function normalizedCandidateScores(candidate) {
  const raw = {
    demand: Number(candidate.demandScore) || 0,
    supplyGap: Number(candidate.supplyGapScore) || 0,
    economics: Number(candidate.economicsScore) || 0,
    channelFit: Number(candidate.channelFitScore) || 0,
    executionFit: Number(candidate.executionFitScore) || 0,
    risk: Number(candidate.riskScore) || 0,
    model: Number(candidate.score) || 0,
  };
  const substantive = Object.values(raw).filter((value) => value > 0);
  const normalizedFromTenPoint = substantive.length > 0 && substantive.every((value) => value <= 10);
  const scale = normalizedFromTenPoint ? 10 : 1;
  return {
    demand: clampScore(raw.demand * scale),
    supplyGap: clampScore(raw.supplyGap * scale),
    economics: clampScore(raw.economics * scale),
    channelFit: clampScore(raw.channelFit * scale),
    executionFit: clampScore(raw.executionFit * scale),
    risk: clampScore(raw.risk * scale),
    model: clampScore(raw.model * scale),
    normalizedFromTenPoint,
  };
}

function calculatedScore(candidate) {
  const scores = normalizedCandidateScores(candidate);
  return clampScore(
    scores.demand * 0.28
      + scores.supplyGap * 0.18
      + scores.economics * 0.20
      + scores.channelFit * 0.14
      + scores.executionFit * 0.14
      + (100 - scores.risk) * 0.06,
  );
}

function ventureKitReadiness(db, candidate) {
  const selection = selectVentureKit(db, candidate);
  return {
    eligible: selection.buildableNow,
    profile: selection.selected?.kitId || null,
    version: selection.selected?.version || null,
    reason: selection.selected?.reason || selection.instruction,
    assessments: selection.assessments,
  };
}

function journeyStageForStep(step) {
  if (step === "demand_validator") return "demand_validation";
  return step;
}

function commercialMetadata(task) {
  return fromJson(task?.payload, {})?.liveSpendRequest?.parameters?.pantheonCommercial || null;
}

function taskOutput(task) {
  return fromJson(task?.result, {})?.output || {};
}

function sourceRecords(output) {
  const sources = (output.toolActivity || []).flatMap((activity) => activity.sources || []);
  const byUrl = new Map();
  for (const source of sources) {
    const url = String(source?.url || "").trim();
    if (!/^https?:\/\//i.test(url)) continue;
    if (!byUrl.has(url)) byUrl.set(url, {
      url,
      title: String(source.title || source.name || new URL(url).hostname),
      publisher: String(source.publisher || new URL(url).hostname),
    });
  }
  return [...byUrl.values()];
}

function updateRound(db, roundId, patch = {}) {
  const round = parseRow(get(db, "SELECT * FROM opportunity_rounds WHERE id = ?", [roundId]));
  if (!round) throw new Error(`Opportunity round not found: ${roundId}`);
  const metadata = { ...round.metadata, ...(patch.metadata || {}) };
  const ts = now();
  run(
    db,
    `UPDATE opportunity_rounds
     SET status = ?, started_at = COALESCE(started_at, ?), completed_at = ?,
         metadata = ?, updated_at = ?
     WHERE id = ?`,
    [
      patch.status || round.status,
      patch.startedAt || round.started_at || ts,
      patch.completedAt === undefined ? round.completed_at : patch.completedAt,
      toJson(metadata),
      ts,
      roundId,
    ],
  );
  return parseRow(get(db, "SELECT * FROM opportunity_rounds WHERE id = ?", [roundId]));
}

function existingStepTask(db, roundId, step, opportunityId = null) {
  const rows = all(
    db,
    `SELECT * FROM tasks
     WHERE kind = 'live_ai_worker_execution'
       AND json_extract(payload, '$.liveSpendRequest.parameters.pantheonCommercial.roundId') = ?
       AND json_extract(payload, '$.liveSpendRequest.parameters.pantheonCommercial.step') = ?
     ORDER BY created_at DESC`,
    [roundId, step],
  );
  return rows.find((row) => {
    const metadata = commercialMetadata(row);
    return String(metadata?.opportunityId || "") === String(opportunityId || "");
  }) || null;
}

function stepBusinessContext(round, opportunity) {
  if (!opportunity) {
    return {
      subject: round.prompt,
      buyer: "Multiple evidence-selected buyer segments",
      problem: "Find commercially meaningful problems with visible demand and practical execution paths.",
      offer: "Rank opportunity directions before any product is built.",
      channel: "Global online commerce",
      evidenceStandard: "Use attributable public evidence; distinguish observed facts, estimates, and assumptions.",
    };
  }
  return {
    subject: opportunity.title,
    buyer: opportunity.buyer,
    problem: opportunity.problem,
    offer: opportunity.offer_direction,
    channel: opportunity.channel,
    evidenceStandard: "Use attributable evidence for demand and competition; keep economics estimates explicitly labelled.",
  };
}

function stepWorkBrief(step, round, opportunity) {
  if (step === "opportunity_scout") {
    const portfolioHypothesisScout = round.metadata.portfolioControllerV1 === true;
    return {
      objective: portfolioHypothesisScout
        ? `Generate exactly five commercially distinct opportunity hypotheses for later live validation: ${round.prompt}`
        : `Scan broadly, then rank 3-5 viable online business opportunities for: ${round.prompt}`,
      deliverable: portfolioHypothesisScout
        ? "A compact hypothesis shortlist covering buyer, problem, offer, likely channel, evidence needed, economics hypothesis, risk, and the smallest live validation. No candidate is evidence-backed yet."
        : "A scored shortlist covering demand, competition, economics, channel fit, execution fit, risks, geography, and the smallest meaningful validation.",
      constraints: [
        "Do not invent sales, unit volume, search volume, pricing, or competitor performance.",
        "Use normal public access only; do not bypass authentication, paywalls, CAPTCHAs, access controls, or rate limits.",
        "Consider digital products, POD, affiliate commerce, Amazon/white label, courses, guides, templates, art, and other AI-executable online models when evidence supports them.",
        "Prefer opportunities that can support a credible catalogue rather than a single token product.",
        "Keep the structured answer compact: exactly five candidates for Portfolio Controller work, no more than two short demand-evidence items, two short competition-evidence items, and two short risks per candidate.",
        "Do not repeat source descriptions across candidate fields; source URLs belong in the research tool record.",
        ...(portfolioHypothesisScout ? [
          "This Scout has no live market tool. Treat demand and competition entries as specific evidence requirements or hypotheses, never as observed facts.",
          "Direct market, competitor, price, channel, and buyer-problem evidence will be collected only for the three finalists by Demand Validator.",
        ] : []),
      ],
      acceptanceCriteria: [
        "Every opportunity names a buyer, painful problem, offer direction, channel, market, and evidence gap.",
        "Scores are comparative hypotheses, not fabricated market facts.",
        "At least one counter-signal or risk is visible for each candidate.",
        ...(portfolioHypothesisScout ? [
          "Exactly five candidates span materially different business models.",
          "Every candidate is explicitly suitable for rejection if later live evidence does not support it.",
        ] : []),
        ...(round.metadata.journeyId
          ? ["At least three candidates must be Gumroad-suitable digital products Pantheon can build now; broader unsupported findings may fill the remaining shortlist positions."]
          : []),
      ],
    };
  }
  if (step === "demand_validator") {
    return {
      objective: `Verify whether ${opportunity.title} shows enough real demand to justify economics and offer work.`,
      deliverable: "A continue, revise, deny, or needs-evidence recommendation with sources, counterevidence, smallest test, success metric, and stop rule.",
      constraints: ["Do not equate search interest with purchases.", "Do not treat a competitor listing as proof of sales.", "No publishing, contact, account action, or spend outside this model call."],
      acceptanceCriteria: ["Source-backed demand and competition findings.", "Honest confidence.", "A commercially decisive next test."],
    };
  }
  if (step === "finance_analysis") {
    return {
      objective: `Stress-test the unit economics for ${opportunity.title}.`,
      deliverable: "Price range, cost stack, fees, refunds, acquisition-cost sensitivity, contribution logic, break-even, fixed-cost allocation, risks, and a go/revise/stop signal in AUD.",
      constraints: ["Separate known costs from estimates.", "Include AI, tool, fulfilment, platform, refund, production, and advertising costs.", "Do not present estimates as actual spend."],
      acceptanceCriteria: ["All material cost categories addressed.", "Positive contribution conditions stated.", "A specific financial kill rule."],
    };
  }
  const catalogueCount = targetCatalogueCount(opportunity, Boolean(round.metadata.journeyId));
  return {
    objective: `Turn the evidence for ${opportunity.title} into a differentiated offer and a minimum credible catalogue.`,
    deliverable: `Buyer, promise, positioning, price logic, objections, and exactly ${catalogueCount} distinct catalogue products, plus the test hypothesis, success metric, and stop rule.`,
    constraints: [
      "Do not default to one product when the venture needs breadth.",
      "Catalogue size must match buyer segments, geography, channel norms, production cost, and evidence.",
      "No public claims without support.",
      "Write functional promises that describe what the files let the buyer organize, track, record, display, calculate, or plan.",
      "Do not promise better, fewer, faster, improved, reduced, guaranteed, or completed outcomes before a real measured test.",
      "A promise to confirm, verify, approve, complete, or organize something must name the exact field, checklist, status, criteria, index, or instruction that implements it.",
      "If a promise or catalogue outcome says calculate, every matching included tool must name the relevant fields and an explicit operation using sum, subtract, multiply, or percent_of so Product Builder can implement and verify it.",
      ...(round.metadata.journeyId ? [
        "For this first Digital Product Kit, each catalogue item must be truthfully deliverable as one Excel workbook with Dashboard, Read Me, and Tracker sheets, plus a sample CSV and shared setup guide.",
        "Do not promise Notion or Airtable workspaces, reusable databases, a project index, separate views or pages, a client portal, CRM, app, automation, integration, or sync. Pantheon does not build those structures in this kit.",
      ] : []),
    ],
    acceptanceCriteria: [
      "Specific offer and buying trigger.",
      "Credible product breadth.",
      "Every catalogue outcome maps to at least one named included tool.",
      "Every promised calculation maps to a named included tool with explicit fields and an operation.",
      ...(round.metadata.journeyId ? [
        "Every product format and outcome accurately describes the Excel workbook and fields Pantheon can create in this journey.",
      ] : []),
      "Clear build order and testable launch hypothesis.",
    ],
  };
}

function queueCommercialWorker(db, roundId, step, options = {}) {
  const config = STEP_CONFIG[step];
  if (!config) throw new Error(`Unsupported Pantheon commercial step: ${step}`);
  const round = parseRow(get(db, "SELECT * FROM opportunity_rounds WHERE id = ?", [roundId]));
  if (!round) throw new Error(`Opportunity round not found: ${roundId}`);
  const opportunity = options.opportunityId ? opportunityById(db, options.opportunityId) : null;
  const journey = journeyForRound(db, roundId)
    || (round.metadata.journeyId ? journeyById(db, round.metadata.journeyId) : null);
  const portfolioHypothesisScout = step === "opportunity_scout"
    && round.metadata.portfolioControllerV1 === true;
  const existing = existingStepTask(db, roundId, step, opportunity?.id);
  if (existing) return { task: parseRow(existing, ["payload", "result"]), existing: true };

  const request = requestLiveAiWorker(db, round.metadata.workflowId, {
    requestKey: `${roundId}_${step}_${opportunity?.id || "round"}`,
    worker: config.worker,
    taskTitle: config.title,
    approvalTitle: `Run ${config.title.toLowerCase()}`,
    requestedBy: "pantheon_supervisor",
    estimatedCostCents: Number(options.budgetCents || (portfolioHypothesisScout ? 150 : config.budgetCents)),
    provider: "openai-agents-sdk",
    model: options.model || journey?.model || config.model(),
    modelLocked: options.modelLocked === true || journey?.model_locked === 1,
    maxOutputTokens: Number(options.maxOutputTokens || (portfolioHypothesisScout ? 5000 : config.maxOutputTokens)),
    ...(options.deadlineMs || config.deadlineMs || portfolioHypothesisScout
      ? { deadlineMs: Number(options.deadlineMs || (portfolioHypothesisScout ? 90000 : config.deadlineMs)) }
      : {}),
    maxTurns: portfolioHypothesisScout ? 1 : config.maxTurns,
    maxToolCalls: portfolioHypothesisScout ? 0 : config.maxToolCalls,
    tools: portfolioHypothesisScout ? [] : config.tools,
    toolArguments: !portfolioHypothesisScout && config.tools.length ? {
      research_adapter: {
        searchContextSize: "low",
        userLocation: { type: "approximate", country: "AU", timezone: "Australia/Brisbane" },
      },
    } : {},
    effects: [],
    businessContext: stepBusinessContext(round, opportunity),
    workBrief: stepWorkBrief(step, round, opportunity),
    parameters: {
      ...(journey ? {
        pantheonJourney: {
          journeyId: journey.id,
          mode: journey.mode,
          model: journey.model,
          modelLocked: journey.model_locked === 1,
          budgetCapCents: journey.budget_cap_cents,
        },
      } : {}),
      pantheonCommercial: {
        roundId,
        step,
        opportunityId: opportunity?.id || null,
        journeyId: journey?.id || null,
        supervisorOwned: true,
        externalEffectsAllowed: false,
      },
    },
    reason: portfolioHypothesisScout
      ? "Pantheon is generating a bounded commercial hypothesis shortlist before spending on live finalist diligence. No market fact is accepted at this stage."
      : "Pantheon is performing exact internal commercial analysis under Daniel's recorded monthly operating mandate. No external business action is exposed.",
    expectedMetric: step === "opportunity_scout"
      ? "Return 3-5 attributable, commercially comparable opportunity candidates."
      : "Return a structured, commercially useful specialist recommendation that passes local quality checks.",
  });
  const mandate = request.approval?.id
    ? approveInternalWorkWithinMandate(db, request.approval.id)
    : { approved: false, reason: "approval_missing" };
  updateRound(db, roundId, {
    status: config.status,
    metadata: {
      currentStep: step,
      currentTaskId: request.task?.id || null,
      currentApprovalId: request.approval?.id || null,
      mandateDecision: mandate.approved ? "approved" : mandate.reason,
    },
  });
  if (journey) {
    updateJourney(db, journey.id, {
      status: "running",
      activeStage: journeyStageForStep(step),
      metadata: {
        currentTaskId: request.task?.id || null,
        currentApprovalId: request.approval?.id || null,
      },
      stageEvent: {
        stage: journeyStageForStep(step),
        status: request.task?.status || "waiting_to_start",
        taskId: request.task?.id || null,
        workerId: config.worker,
        note: request.task?.title || config.title,
      },
    });
  }
  return { ...request, mandate, existing: false };
}

function createRoundRecords(db, input, venture) {
  const ts = now();
  const id = `opp_round_${randomId()}`;
  const workflowId = `wf_commercial_discovery_${randomId()}`;
  const commandId = `cmd_commercial_discovery_${randomId()}`;
  const portfolioControllerV1 = input.portfolioControllerV1 === true;
  const targetedInvestmentReview = input.targetedInvestmentReview === true;
  const prompt = String(
    input.prompt
      || input.idea
      || (portfolioControllerV1
        ? "Explore at least five distinct lawful online-business opportunity spaces across different business models. Find evidence-backed buyer problems and rank the strongest candidates without favouring Pantheon's existing digital-product kit."
        : "Find the strongest evidence-backed online business opportunities Pantheon can execute."),
  ).trim();
  const mode = targetedInvestmentReview
    ? "targeted_diligence"
    : input.idea
      ? "operator_idea"
      : portfolioControllerV1
        ? "portfolio_discovery"
        : "broad_discovery";
  const metadata = {
    workflowId,
    commandId,
    operatorIdea: input.idea || null,
    source: input.source || "dashboard",
    externalEffectsAllowed: false,
    agentRunner: { mode: "live_internal", liveModels: true, liveTools: true },
    journeyId: input.journeyId || null,
    journeyModel: input.model || null,
    journeyModelLocked: input.modelLocked === true,
    portfolioControllerV1,
    targetedInvestmentReview,
    sourceOpportunityId: input.sourceOpportunityId || null,
    decisionGap: input.decisionGap || null,
    minimumOpportunitySpaces: portfolioControllerV1 ? 5 : null,
    finalistCount: portfolioControllerV1 ? 3 : null,
    productionBlocked: portfolioControllerV1,
  };
  run(
    db,
    `INSERT INTO opportunity_rounds
     (id, venture_id, status, mode, prompt, geography, language, max_candidates,
      started_at, created_by, metadata, created_at, updated_at)
     VALUES (?, ?, 'researching', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      venture.id,
      mode,
      prompt,
      input.geography || "global",
      input.language || "English",
      Math.max(3, Math.min(Number(input.maxCandidates || 5), 5)),
      ts,
      input.createdBy || "Daniel",
      toJson(metadata),
      ts,
      ts,
    ],
  );
  run(
    db,
    `INSERT INTO workflows
     (id, venture_id, type, title, status, current_step, priority, quality_score,
      expected_profit_cents, cost_estimate_cents, approval_required, metadata, created_at, updated_at)
     VALUES (?, ?, 'pantheon_commercial_discovery', ?, 'planned', ?, 1, 0, 0, 0, 0, ?, ?, ?)`,
    [workflowId, venture.id, `Commercial discovery: ${prompt.slice(0, 90)}`, "Researching commercial opportunities", toJson(metadata), ts, ts],
  );
  run(
    db,
    `INSERT INTO commands
     (id, venture_id, source, raw_text, intent, status, workflow_id, summary, metadata, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'commercial_discovery', 'running', ?, ?, ?, ?, ?)`,
    [commandId, venture.id, input.source || "dashboard", prompt, workflowId, "Pantheon is researching and ranking evidence-backed business opportunities.", toJson({ ...metadata, roundId: id }), ts, ts],
  );
  return parseRow(get(db, "SELECT * FROM opportunity_rounds WHERE id = ?", [id]));
}

function startOpportunityRound(db, input = {}) {
  const active = activeOpportunityRound(db);
  if (active && input.force !== true) {
    return { round: active, alreadyRunning: true, state: getOpportunityState(db) };
  }
  const venture = input.portfolioControllerV1 === true
    ? ensurePortfolioWorkspace(db)
    : activeVenture(db);
  const round = createRoundRecords(db, input, venture);
  const queued = queueCommercialWorker(db, round.id, "opportunity_scout", {
    ...input,
    modelLocked: input.modelLocked === true,
  });
  insertEvent(db, {
    actor: "pantheon",
    type: "commercial_discovery.started",
    entityType: "opportunity_round",
    entityId: round.id,
    message: input.idea
      ? "Pantheon started a commercial review of Daniel's business idea."
      : "Pantheon started a broad commercial opportunity scan.",
    metadata: { workflowId: round.metadata.workflowId, taskId: queued.task?.id || null, mode: round.mode },
  });
  return { round: updateRound(db, round.id), queued, alreadyRunning: false, state: getOpportunityState(db) };
}

function evidenceIdsForScout(db, task, round, output) {
  const ids = [];
  for (const source of sourceRecords(output)) {
    const sourceFingerprint = crypto
      .createHash("sha256")
      .update(String(source.url || "unknown-source"))
      .digest("hex")
      .slice(0, 12);
    const id = `evidence_${slug(round.id)}_${sourceFingerprint}`;
    const existing = get(db, "SELECT id FROM commercial_evidence WHERE id = ?", [id]);
    if (!existing) {
      recordEvidence(db, {
        id,
        ventureId: round.venture_id,
        sourceType: "source_link",
        sourceUrl: source.url,
        sourceId: task.id,
        title: source.title,
        claim: `This source was consulted while Pantheon tested opportunity claims in round ${round.id}.`,
        summary: "Provider-returned public source captured during approved OpenAI web research.",
        publisher: source.publisher,
        extractionMethod: "OpenAI Agents SDK web search",
        confidence: "source_captured_claim_requires_review",
        verified: true,
        metadata: { roundId: round.id, taskId: task.id, providerCaptured: true },
      });
    }
    ids.push(id);
  }
  return ids;
}

function projectScoutResult(db, task, round, output) {
  const candidates = Array.isArray(output.roleOutput?.opportunities)
    ? output.roleOutput.opportunities.slice(0, round.max_candidates)
    : [];
  const portfolioControllerV1 = round.metadata.portfolioControllerV1 === true;
  const requiredCandidateCount = portfolioControllerV1 ? 5 : 3;
  if (candidates.length < requiredCandidateCount) {
    throw new Error(`Opportunity Scout did not return the required ${requiredCandidateCount} structured candidates.`);
  }
  const evidenceIds = evidenceIdsForScout(db, task, round, output);
  const ts = now();
  const inserted = [];
  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    const candidateTitle = cleanOpportunityTitle(candidate.title);
    const scores = normalizedCandidateScores(candidate);
    const id = `opp_${slug(round.id, 24)}_${index + 1}_${slug(candidateTitle, 24)}`;
    const overallScore = calculatedScore(candidate);
    const buildability = ventureKitReadiness(db, candidate);
    run(
      db,
      `INSERT OR IGNORE INTO opportunities
       (id, round_id, venture_id, source_type, status, title, business_model, buyer, problem,
        offer_direction, geography, language, channel, demand_score, supply_gap_score,
        economics_score, channel_fit_score, execution_fit_score, risk_score, overall_score,
        confidence, recommendation, smallest_validation, evidence_ids, metadata, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'ranked',
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        round.id,
        round.venture_id,
        portfolioControllerV1 ? "model_hypothesis" : "live_agent_research",
        candidateTitle,
        candidate.businessModel,
        candidate.buyer,
        candidate.problem,
        candidate.offerDirection,
        candidate.geography || round.geography,
        candidate.language || round.language,
        candidate.channel,
        scores.demand,
        scores.supplyGap,
        scores.economics,
        scores.channelFit,
        scores.executionFit,
        scores.risk,
        overallScore,
        candidate.confidence || "low",
        output.recommendation || output.summary || "",
        candidate.smallestValidation || output.nextAction || "",
        toJson(evidenceIds),
        toJson({
          rank: index + 1,
          modelScore: scores.model,
          scoreScale: scores.normalizedFromTenPoint ? "normalized_from_0_10" : "0_100",
          demandEvidence: candidate.demandEvidence || [],
          competitionEvidence: candidate.competitionEvidence || [],
          economicsHypothesis: candidate.economicsHypothesis || "",
          risks: candidate.risks || [],
          sourceTaskId: task.id,
          buildability,
        }),
        ts,
        ts,
      ],
    );
    inserted.push(opportunityById(db, id));
  }
  const ranked = inserted.sort((a, b) => b.overall_score - a.overall_score);
  const journey = journeyForRound(db, round.id);
  const validationQueue = portfolioControllerV1
    ? ranked.slice(0, 3)
    : journey
      ? ranked.filter((candidate) => candidate.metadata.buildability?.eligible === true).slice(0, 3)
      : ranked.slice(0, 1);
  if (journey && validationQueue.length < 3) {
    for (const candidate of ranked) {
      if (candidate.metadata.buildability?.eligible !== true) {
        run(
          db,
          "UPDATE opportunities SET status = 'retained_unsupported', updated_at = ? WHERE id = ?",
          [ts, candidate.id],
        );
      }
    }
    updateRound(db, round.id, {
      status: "needs_direction",
      completedAt: ts,
      metadata: {
        scoutTaskId: task.id,
        candidateCount: ranked.length,
        sourceCount: evidenceIds.length,
        outcome: "The broad scan did not return three buildable digital-product candidates.",
      },
    });
    updateJourney(db, journey.id, {
      status: "needs_attention",
      activeStage: "opportunity_scout",
      metadata: {
        blocker: "Pantheon needs three buildable digital-product candidates before comparable validation can begin.",
        currentTaskId: null,
      },
      stageEvent: {
        stage: "opportunity_scout",
        status: "needs_attention",
        taskId: task.id,
        workerId: "opportunity_scout",
        note: "The shortlist did not include three currently buildable digital products.",
      },
    });
    return null;
  }
  const validationIds = validationQueue.map((candidate) => candidate.id);
  for (const candidate of ranked) {
    const status = validationIds.includes(candidate.id)
      ? "queued_for_validation"
      : journey && !portfolioControllerV1 && candidate.metadata.buildability?.eligible !== true
        ? "retained_unsupported"
        : "ranked_alternative";
    run(db, "UPDATE opportunities SET status = ?, updated_at = ? WHERE id = ?", [status, ts, candidate.id]);
  }
  const selected = validationQueue[0];
  run(db, "UPDATE opportunities SET status = 'selected_for_validation', updated_at = ? WHERE id = ?", [ts, selected.id]);
  updateRound(db, round.id, {
    status: "validating",
    metadata: {
      scoutTaskId: task.id,
      candidateCount: ranked.length,
      selectedOpportunityId: selected.id,
      sourceCount: evidenceIds.length,
      validationQueueIds: validationIds,
      validationCompletedIds: [],
      buildableCandidateCount: validationQueue.length,
      portfolioControllerV1,
      opportunitySpaceCount: ranked.length,
    },
  });
  if (journey) {
    updateJourney(db, journey.id, {
      status: "running",
      activeStage: "demand_validation",
      metadata: {
        candidateShortlistIds: validationIds,
        retainedOpportunityIds: ranked.map((candidate) => candidate.id),
      },
      stageEvent: {
        stage: "opportunity_scout",
        status: "completed",
        taskId: task.id,
        workerId: "opportunity_scout",
        note: `${ranked.length} opportunities were retained and ${validationQueue.length} buildable candidates advanced.`,
      },
    });
  }
  return queueCommercialWorker(db, round.id, "demand_validator", {
    opportunityId: selected.id,
    ...(portfolioControllerV1 ? { model: CONFIG.terraModel, modelLocked: true } : {}),
  });
}

function nextUnvalidatedOpportunity(db, roundId) {
  const journey = journeyForRound(db, roundId);
  const round = parseRow(get(db, "SELECT * FROM opportunity_rounds WHERE id = ?", [roundId]));
  const comparableMode = Boolean(journey || round?.metadata?.portfolioControllerV1);
  return parseRow(
    get(
      db,
      `SELECT * FROM opportunities
       WHERE round_id = ? AND status IN (${comparableMode ? "'queued_for_validation'" : "'queued_for_validation', 'ranked_alternative', 'ranked'"})
       ORDER BY overall_score DESC, created_at ASC LIMIT 1`,
      [roundId],
    ),
    ["evidence_ids", "metadata"],
  );
}

function nextPortfolioFinanceCandidate(db, roundId) {
  return parseRow(
    get(
      db,
      `SELECT * FROM opportunities
       WHERE round_id = ? AND status = 'queued_for_finance'
       ORDER BY overall_score DESC, created_at ASC LIMIT 1`,
      [roundId],
    ),
    ["evidence_ids", "metadata"],
  );
}

function finalizePortfolioValidation(db, round, completedIds) {
  const finalists = all(
    db,
    `SELECT * FROM opportunities
     WHERE round_id = ? AND id IN (${completedIds.map(() => "?").join(", ")})
     ORDER BY overall_score DESC, created_at ASC`,
    [round.id, ...completedIds],
  ).map((row) => parseRow(row, ["evidence_ids", "metadata"]));
  if (finalists.length < 3) {
    throw new Error("Portfolio discovery requires three completed comparable finalists.");
  }
  const timestamp = now();
  for (const finalist of finalists) {
    run(
      db,
      "UPDATE opportunities SET status = 'queued_for_finance', updated_at = ? WHERE id = ?",
      [timestamp, finalist.id],
    );
  }
  const first = finalists[0];
  run(
    db,
    "UPDATE opportunities SET status = 'selected_for_finance', updated_at = ? WHERE id = ?",
    [timestamp, first.id],
  );
  updateRound(db, round.id, {
    status: "checking_economics",
    metadata: {
      validationCompletedIds: completedIds,
      financeQueueIds: finalists.map((item) => item.id),
      financeCompletedIds: [],
      selectedOpportunityId: first.id,
    },
  });
  return queueCommercialWorker(db, round.id, "finance_analysis", {
    opportunityId: first.id,
    model: CONFIG.terraModel,
    modelLocked: true,
  });
}

function validationEvidenceIds(db, task, round, opportunity, output) {
  const ids = [...opportunity.evidence_ids];
  for (const source of sourceRecords(output)) {
    const sourceFingerprint = crypto
      .createHash("sha256")
      .update(`${opportunity.id}:${source.url}`)
      .digest("hex")
      .slice(0, 14);
    const id = `evidence_validation_${slug(opportunity.id, 28)}_${sourceFingerprint}`;
    if (!get(db, "SELECT id FROM commercial_evidence WHERE id = ?", [id])) {
      recordEvidence(db, {
        id,
        ventureId: round.venture_id,
        sourceType: "source_link",
        sourceUrl: source.url,
        sourceId: task.id,
        title: source.title,
        claim: `This source was consulted while Pantheon validated ${opportunity.title}.`,
        summary: "Provider-returned public source captured during comparable demand validation.",
        publisher: source.publisher,
        extractionMethod: "OpenAI Agents SDK web search",
        confidence: "source_captured_claim_requires_review",
        verified: true,
        metadata: {
          roundId: round.id,
          opportunityId: opportunity.id,
          taskId: task.id,
          providerCaptured: true,
        },
      });
    }
    ids.push(id);
  }
  return [...new Set(ids)];
}

function testReadyValidation(output = {}) {
  const recommendation = output.pilotRecommendation || output;
  const verdict = String(output.operatorDecision || output.verdict || recommendation.verdict || "needs_evidence");
  const confidence = String(output.confidence || recommendation.confidence || "low");
  const evidence = Array.isArray(recommendation.evidence)
    ? recommendation.evidence
    : Array.isArray(output.evidence)
      ? output.evidence
      : [];
  const smallestTest = String(recommendation.smallestTest || output.smallestTest || output.nextAction || "").trim();
  const metric = String(recommendation.metric || recommendation.successMetric || output.successMetric || "").trim();
  const stopRule = String(recommendation.killRule || recommendation.stopRule || output.stopRule || "").trim();
  return ["needs_evidence", "revise"].includes(verdict)
    && ["medium", "high"].includes(confidence)
    && evidence.length >= 2
    && smallestTest.length >= 30
    && metric.length >= 20
    && stopRule.length >= 20;
}

function finalizeComparableCandidateSelection(db, round, journey, taskId, completedIds) {
  const candidates = all(
    db,
    `SELECT * FROM opportunities
     WHERE round_id = ? AND status IN ('validated', 'test_ready')
     ORDER BY CASE status WHEN 'validated' THEN 0 ELSE 1 END,
       overall_score DESC, demand_score DESC, economics_score DESC, execution_fit_score DESC, created_at ASC`,
    [round.id],
  ).map((row) => parseRow(row, ["evidence_ids", "metadata"]));
  if (!candidates.length) {
    updateRound(db, round.id, {
      status: "needs_direction",
      completedAt: now(),
      metadata: {
        validatorTaskId: taskId,
        validationCompletedIds: completedIds,
        outcome: "No candidate produced either a supported demand case or a complete case for a small first-revenue test.",
      },
    });
    if (journey) {
      updateJourney(db, journey.id, {
        status: "needs_attention",
        activeStage: "candidate_selection",
        metadata: {
          blocker: "None of the three buildable candidates produced enough evidence for even a small first-revenue test.",
          currentTaskId: null,
        },
        stageEvent: {
          stage: "demand_validation",
          status: "needs_attention",
          taskId,
          workerId: "demand_validator",
          note: "All comparable demand checks completed without a supported or test-ready candidate.",
        },
      });
    }
    return null;
  }

  const selected = candidates[0];
  const demandSupported = selected.status === "validated";
  for (const candidate of candidates) {
    const alternativeStatus = candidate.status === "validated"
      ? "validated_alternative"
      : "test_ready_alternative";
    run(
      db,
      "UPDATE opportunities SET status = ?, updated_at = ? WHERE id = ?",
      [candidate.id === selected.id ? "selected_for_finance" : alternativeStatus, now(), candidate.id],
    );
  }
  const selectionRationale = demandSupported
    ? `${selected.title} was the strongest candidate whose live demand check supported advancing. Its earlier discovery score was ${selected.overall_score}/100 with ${selected.confidence} confidence; higher discovery-scoring alternatives still needed more evidence or a narrower offer.`
    : `${selected.title} was the strongest buildable candidate with a complete, medium-confidence case for a small first-revenue test. Its earlier discovery score was ${selected.overall_score}/100. Demand remains unproven until real buyers pay.`;
  const validatedCandidateIds = candidates
    .filter((candidate) => candidate.status === "validated")
    .map((candidate) => candidate.id);
  const testReadyCandidateIds = candidates
    .filter((candidate) => candidate.status === "test_ready")
    .map((candidate) => candidate.id);
  updateRound(db, round.id, {
    status: "checking_economics",
    completedAt: null,
    metadata: {
      validatedOpportunityId: demandSupported ? selected.id : null,
      selectedOpportunityId: selected.id,
      validatorTaskId: taskId,
      validationCompletedIds: completedIds,
      validatedCandidateIds,
      testReadyCandidateIds,
      selectionBasis: demandSupported ? "demand_supported" : "paid_test_ready",
      selectionRationale,
    },
  });
  if (journey) {
    updateJourney(db, journey.id, {
      status: "running",
      activeStage: "finance_analysis",
      selectedOpportunityId: selected.id,
      metadata: {
        selectedOpportunityId: selected.id,
        selectionRationale,
        validatedCandidateIds,
        testReadyCandidateIds,
        selectionBasis: demandSupported ? "demand_supported" : "paid_test_ready",
        blocker: null,
        currentTaskId: null,
      },
      stageEvent: {
        stage: "candidate_selection",
        status: "completed",
        taskId,
        workerId: "demand_validator",
        note: selectionRationale,
      },
    });
  }
  return queueCommercialWorker(db, round.id, "finance_analysis", { opportunityId: selected.id });
}

function resumeJourneyCandidateSelection(db, journeyId) {
  const journey = journeyById(db, journeyId);
  if (!journey) throw new Error(`Pantheon journey not found: ${journeyId}`);
  if (journey.active_stage !== "candidate_selection" || journey.status !== "needs_attention") {
    throw new Error("Pantheon can resume candidate selection only from its recorded demand-review stop.");
  }
  const round = parseRow(get(db, "SELECT * FROM opportunity_rounds WHERE id = ?", [journey.round_id]));
  if (!round) throw new Error(`Opportunity round not found: ${journey.round_id}`);
  const completedIds = Array.isArray(round.metadata.validationCompletedIds)
    ? round.metadata.validationCompletedIds
    : [];
  if (completedIds.length < Number(journey.metadata.requiredValidatedCandidates || 3)) {
    throw new Error("Three comparable demand checks must complete before Pantheon can resume selection.");
  }

  const candidates = all(
    db,
    "SELECT * FROM opportunities WHERE round_id = ? ORDER BY created_at",
    [round.id],
  ).map((row) => parseRow(row, ["evidence_ids", "metadata"]));
  const reclassifiedIds = [];
  for (const candidate of candidates) {
    const validation = candidate.metadata.validation || null;
    if (candidate.status !== "needs_evidence" || !validation || !testReadyValidation(validation)) continue;
    const metadata = {
      ...candidate.metadata,
      validation: { ...validation, readiness: "paid_test_ready" },
    };
    run(
      db,
      "UPDATE opportunities SET status = 'test_ready', metadata = ?, updated_at = ? WHERE id = ?",
      [toJson(metadata), now(), candidate.id],
    );
    reclassifiedIds.push(candidate.id);
  }
  if (!reclassifiedIds.length) {
    throw new Error("No completed candidate contained enough evidence for a smallest paid test.");
  }

  const validatorTaskId = round.metadata.validatorTaskId
    || candidates.map((candidate) => candidate.metadata.validation?.taskId).filter(Boolean).at(-1)
    || null;
  const next = finalizeComparableCandidateSelection(
    db,
    parseRow(get(db, "SELECT * FROM opportunity_rounds WHERE id = ?", [round.id])),
    journey,
    validatorTaskId,
    completedIds,
  );
  insertEvent(db, {
    actor: "jarvis",
    type: "pantheon.journey_interpretation_corrected",
    entityType: "pantheon_journey",
    entityId: journey.id,
    message: "Pantheon distinguished a complete first-revenue test case from proven demand and resumed the smallest-build path without claiming buyer proof.",
    metadata: {
      stage: "candidate_selection",
      reclassifiedOpportunityIds: reclassifiedIds,
      paidRetryUsed: false,
      nextTaskId: next?.task?.id || null,
    },
  });
  return {
    journey: journeyById(db, journey.id),
    round: parseRow(get(db, "SELECT * FROM opportunity_rounds WHERE id = ?", [round.id])),
    reclassifiedOpportunityIds: reclassifiedIds,
    next,
  };
}

function projectValidatorResult(db, task, round, opportunity, output) {
  const verdict = String(output.operatorDecision || "needs_evidence");
  const positive = verdict === "approve" && output.confidence !== "low";
  const testReady = !positive && testReadyValidation(output);
  const status = positive
    ? "validated"
    : testReady
      ? "test_ready"
      : verdict === "deny"
        ? "rejected"
        : "needs_evidence";
  const evidenceIds = validationEvidenceIds(db, task, round, opportunity, output);
  const metadata = {
    ...opportunity.metadata,
    validation: {
      taskId: task.id,
      recommendation: output.summary || "",
      verdict,
      confidence: output.confidence || "low",
      evidence: output.pilotRecommendation?.evidence || output.evidence || [],
      counterevidence: output.pilotRecommendation?.counterevidence || [],
      assumptions: output.pilotRecommendation?.assumptions || [],
      smallestTest: output.pilotRecommendation?.smallestTest || output.nextAction || "",
      metric: output.pilotRecommendation?.metric || "",
      stopRule: output.pilotRecommendation?.killRule || "",
      priceChannelHypothesis: output.pilotRecommendation?.priceChannelHypothesis || "",
      readiness: positive ? "demand_supported" : testReady ? "paid_test_ready" : "insufficient",
      sources: sourceRecords(output),
    },
  };
  run(
    db,
    "UPDATE opportunities SET status = ?, confidence = ?, recommendation = ?, evidence_ids = ?, metadata = ?, updated_at = ? WHERE id = ?",
    [status, output.confidence || opportunity.confidence, output.summary || opportunity.recommendation, toJson(evidenceIds), toJson(metadata), now(), opportunity.id],
  );
  const completedIds = [...new Set([...(round.metadata.validationCompletedIds || []), opportunity.id])];
  const journey = journeyForRound(db, round.id);
  const portfolioControllerV1 = round.metadata.portfolioControllerV1 === true;
  if (!journey && !portfolioControllerV1 && positive) {
    run(
      db,
      "UPDATE opportunities SET status = 'selected_for_finance', updated_at = ? WHERE id = ?",
      [now(), opportunity.id],
    );
    updateRound(db, round.id, {
      status: "checking_economics",
      metadata: {
        validatedOpportunityId: opportunity.id,
        selectedOpportunityId: opportunity.id,
        validatorTaskId: task.id,
        validationCompletedIds: completedIds,
      },
    });
    return queueCommercialWorker(db, round.id, "finance_analysis", { opportunityId: opportunity.id });
  }
  const next = nextUnvalidatedOpportunity(db, round.id);
  if (next) {
    run(db, "UPDATE opportunities SET status = 'selected_for_validation', updated_at = ? WHERE id = ?", [now(), next.id]);
    updateRound(db, round.id, {
      status: "validating",
      metadata: {
        selectedOpportunityId: next.id,
        priorOpportunityId: opportunity.id,
        validationCompletedIds: completedIds,
      },
    });
    return queueCommercialWorker(db, round.id, "demand_validator", {
      opportunityId: next.id,
      ...(portfolioControllerV1 ? { model: CONFIG.terraModel, modelLocked: true } : {}),
    });
  }
  if (portfolioControllerV1) {
    return finalizePortfolioValidation(db, round, completedIds);
  }
  return finalizeComparableCandidateSelection(db, round, journey, task.id, completedIds);
}

function finalizePortfolioFinance(db, round, completedIds) {
  const finalistIds = Array.isArray(round.metadata.financeQueueIds)
    ? round.metadata.financeQueueIds
    : completedIds;
  const cases = finalistIds.map((opportunityId) => persistInvestmentCase(db, opportunityId));
  const recommendationOrder = { advance: 0, research_more: 1, park: 2, reject: 3, no_investment: 4 };
  cases.sort((left, right) => {
    const recommendationDifference = (recommendationOrder[left.recommendation] ?? 9)
      - (recommendationOrder[right.recommendation] ?? 9);
    if (recommendationDifference !== 0) return recommendationDifference;
    const leftPassed = Object.values(left.criteria).filter((item) => item.passed).length;
    const rightPassed = Object.values(right.criteria).filter((item) => item.passed).length;
    return rightPassed - leftPassed;
  });
  const best = cases[0];
  updateRound(db, round.id, {
    status: "investment_review",
    metadata: {
      financeCompletedIds: completedIds,
      investmentCaseIds: cases.map((item) => item.id),
      selectedOpportunityId: best.opportunity_id,
      selectedInvestmentCaseId: best.id,
      productionBlocked: true,
    },
  });
  run(
    db,
    "UPDATE opportunities SET status = 'selected_for_investment_review', updated_at = ? WHERE id = ?",
    [now(), best.opportunity_id],
  );
  return queueCommercialInvestmentReview(db, best.id);
}

function projectFinanceResult(db, task, round, opportunity, output) {
  const metadata = {
    ...opportunity.metadata,
    finance: {
      taskId: task.id,
      summary: output.summary || "",
      recommendation: output.recommendation || output.nextAction || "",
      decision: output.operatorDecision || "needs_evidence",
      work: output.roleOutput || {},
      risks: output.risks || [],
      confidence: output.confidence || "low",
    },
  };
  run(db, "UPDATE opportunities SET metadata = ?, updated_at = ? WHERE id = ?", [toJson(metadata), now(), opportunity.id]);
  if (round.metadata.targetedInvestmentReview === true) {
    const denied = String(output.operatorDecision || "").toLowerCase() === "deny";
    run(
      db,
      "UPDATE opportunities SET status = ?, updated_at = ? WHERE id = ?",
      [denied ? "finance_rejected" : "economics_checked", now(), opportunity.id],
    );
    const investmentCase = persistInvestmentCase(db, opportunity.id);
    updateRound(db, round.id, {
      status: "investment_review",
      metadata: {
        financeTaskId: task.id,
        financeCompletedIds: [opportunity.id],
        investmentCaseIds: [investmentCase.id],
        selectedOpportunityId: opportunity.id,
        selectedInvestmentCaseId: investmentCase.id,
        productionBlocked: true,
      },
    });
    run(
      db,
      "UPDATE opportunities SET status = 'selected_for_investment_review', updated_at = ? WHERE id = ?",
      [now(), opportunity.id],
    );
    return queueCommercialInvestmentReview(db, investmentCase.id);
  }
  if (round.metadata.portfolioControllerV1 === true) {
    const denied = String(output.operatorDecision || "").toLowerCase() === "deny";
    run(
      db,
      "UPDATE opportunities SET status = ?, updated_at = ? WHERE id = ?",
      [denied ? "finance_rejected" : "economics_checked", now(), opportunity.id],
    );
    const completedIds = [...new Set([...(round.metadata.financeCompletedIds || []), opportunity.id])];
    const next = nextPortfolioFinanceCandidate(db, round.id);
    if (next) {
      run(
        db,
        "UPDATE opportunities SET status = 'selected_for_finance', updated_at = ? WHERE id = ?",
        [now(), next.id],
      );
      updateRound(db, round.id, {
        status: "checking_economics",
        metadata: {
          financeCompletedIds: completedIds,
          selectedOpportunityId: next.id,
        },
      });
      return queueCommercialWorker(db, round.id, "finance_analysis", {
        opportunityId: next.id,
        model: CONFIG.terraModel,
        modelLocked: true,
      });
    }
    const refreshedRound = parseRow(get(db, "SELECT * FROM opportunity_rounds WHERE id = ?", [round.id]));
    return finalizePortfolioFinance(db, refreshedRound, completedIds);
  }
  if (String(output.operatorDecision || "").toLowerCase() === "deny") {
    run(
      db,
      "UPDATE opportunities SET status = 'finance_rejected', updated_at = ? WHERE id = ?",
      [now(), opportunity.id],
    );
    const alternative = parseRow(
      get(
        db,
        `SELECT * FROM opportunities
         WHERE round_id = ? AND status = 'validated_alternative'
         ORDER BY overall_score DESC, created_at ASC LIMIT 1`,
        [round.id],
      ),
      ["evidence_ids", "metadata"],
    );
    if (!alternative) {
      updateRound(db, round.id, {
        status: "needs_direction",
        completedAt: now(),
        metadata: {
          financeTaskId: task.id,
          outcome: "Every demand-validated candidate failed the unit-economics check.",
        },
      });
      const journey = journeyForRound(db, round.id);
      if (journey) {
        updateJourney(db, journey.id, {
          status: "needs_attention",
          activeStage: "finance_analysis",
          metadata: {
            blocker: "No demand-validated candidate retained viable unit economics.",
            currentTaskId: null,
          },
          stageEvent: {
            stage: "finance_analysis",
            status: "needs_attention",
            taskId: task.id,
            workerId: "finance_analyst",
            note: "The final eligible candidate failed the economics check.",
          },
        });
      }
      return null;
    }
    run(
      db,
      "UPDATE opportunities SET status = 'selected_for_finance', updated_at = ? WHERE id = ?",
      [now(), alternative.id],
    );
    const selectionRationale = `${opportunity.title} failed the unit-economics check, so Pantheon advanced ${alternative.title}, the next highest demand-validated candidate.`;
    updateRound(db, round.id, {
      status: "checking_economics",
      metadata: {
        financeTaskId: task.id,
        selectedOpportunityId: alternative.id,
        validatedOpportunityId: alternative.id,
        selectionRationale,
      },
    });
    const journey = journeyForRound(db, round.id);
    if (journey) {
      updateJourney(db, journey.id, {
        activeStage: "finance_analysis",
        selectedOpportunityId: alternative.id,
        metadata: {
          selectedOpportunityId: alternative.id,
          selectionRationale,
        },
        stageEvent: {
          stage: "finance_analysis",
          status: "revised",
          taskId: task.id,
          workerId: "finance_analyst",
          note: selectionRationale,
        },
      });
    }
    return queueCommercialWorker(db, round.id, "finance_analysis", { opportunityId: alternative.id });
  }
  run(
    db,
    "UPDATE opportunities SET status = 'economics_passed', updated_at = ? WHERE id = ?",
    [now(), opportunity.id],
  );
  updateRound(db, round.id, {
    status: "structuring_offer",
    metadata: { financeTaskId: task.id },
  });
  const journey = journeyForRound(db, round.id);
  if (journey) {
    updateJourney(db, journey.id, {
      status: "running",
      activeStage: "offer_architecture",
      selectedOpportunityId: opportunity.id,
      stageEvent: {
        stage: "finance_analysis",
        status: "completed",
        taskId: task.id,
        workerId: "finance_analyst",
        note: `${opportunity.title} passed the unit-economics check.`,
      },
    });
  }
  return queueCommercialWorker(db, round.id, "offer_architecture", { opportunityId: opportunity.id });
}

function targetCatalogueCount(opportunity, firstJourney = false) {
  const descriptor = `${opportunity.business_model} ${opportunity.offer_direction}`.toLowerCase();
  let count = 5;
  if (descriptor.includes("print on demand") || descriptor.includes("pod")) count = 12;
  else if (descriptor.includes("art")) count = 8;
  else if (descriptor.includes("affiliate")) count = 10;
  else if (descriptor.includes("amazon") || descriptor.includes("white label")) count = 3;
  else if (descriptor.includes("course") || descriptor.includes("guide")) count = 4;
  return firstJourney ? Math.max(3, Math.min(6, count)) : count;
}

function priceCentsFromWork(work = {}) {
  const text = String(work.price || work.priceChannelHypothesis || "");
  const match = text.replace(/,/g, "").match(/(?:A?\$)\s*(\d+(?:\.\d{1,2})?)/i);
  return match ? Math.round(Number(match[1]) * 100) : 0;
}

function createCatalogueAndBrief(db, round, opportunity, output) {
  const ts = now();
  const journey = journeyForRound(db, round.id);
  const work = output.roleOutput || {};
  const proposedItems = Array.isArray(work.catalogueItems) ? work.catalogueItems : [];
  const maximumCatalogueItems = journey ? 6 : 12;
  if (proposedItems.length < 3 || proposedItems.length > maximumCatalogueItems) {
    throw new Error(journey
      ? "Offer Architect must define 3-6 distinct products for the first credible catalogue."
      : "Offer Architect must define 3-12 distinct products for this credible catalogue.");
  }
  const normalizedTitles = proposedItems.map((item) => String(item.title || "").trim().toLowerCase());
  if (normalizedTitles.some((title) => !title) || new Set(normalizedTitles).size !== proposedItems.length) {
    throw new Error("Offer Architect returned missing or duplicate catalogue product titles.");
  }
  const count = proposedItems.length;
  const planId = `catalogue_${slug(opportunity.id, 40)}`;
  const priceCents = priceCentsFromWork(work);
  const planMetadata = {
    sourceTaskId: round.metadata.currentTaskId,
    evidenceStatus: "validated_opportunity",
    buildStatus: "not_started",
    offerWork: work,
    noSellableFilesClaimed: true,
    journeyId: round.metadata.journeyId || null,
    ventureKit: round.metadata.journeyId ? "digital_product_v1" : null,
  };
  run(
    db,
    `INSERT OR REPLACE INTO catalogue_plans
     (id, venture_id, opportunity_id, status, title, rationale, target_item_count,
      target_variant_count, audience_segments, channels, geographies, languages,
      price_floor_cents, price_ceiling_cents, estimated_build_cost_cents,
      estimated_unit_cost_cents, metadata, created_at, updated_at)
     VALUES (?, ?, ?, 'planned', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, COALESCE((SELECT created_at FROM catalogue_plans WHERE id = ?), ?), ?)`,
    [
      planId,
      opportunity.venture_id,
      opportunity.id,
      `${opportunity.title} catalogue`,
      output.summary || "Build a credible offer range matched to the validated buyer and channel.",
      count,
      0,
      toJson([opportunity.buyer]),
      toJson([opportunity.channel]),
      toJson([opportunity.geography]),
      toJson([opportunity.language]),
      priceCents,
      priceCents,
      toJson(planMetadata),
      planId,
      ts,
      ts,
    ],
  );
  for (let index = 0; index < proposedItems.length; index += 1) {
    const proposed = proposedItems[index];
    const id = `catalogue_item_${slug(opportunity.id, 30)}_${index + 1}`;
    const itemPriceCents = Math.max(0, Math.round(Number(proposed.priceCents || priceCents || 0)));
    run(
      db,
      `INSERT OR IGNORE INTO catalogue_items
       (id, plan_id, venture_id, status, quality_status, title, product_type, audience,
        geography, language, offer, price_cents, metadata, created_at, updated_at)
       VALUES (?, ?, ?, 'planned', 'not_reviewed', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        planId,
        opportunity.venture_id,
        String(proposed.title).trim(),
        String(proposed.format || opportunity.business_model),
        String(proposed.buyerSegment || opportunity.buyer),
        opportunity.geography,
        opportunity.language,
        String(proposed.outcome || work.offer || opportunity.offer_direction),
        itemPriceCents,
        toJson({
          sequence: index + 1,
          sourceOpportunityId: opportunity.id,
          exactSpecificationRequired: true,
          includedTools: Array.isArray(proposed.includedTools) ? proposed.includedTools.slice(0, 5) : [],
          differentiation: String(proposed.differentiation || ""),
          offerArchitectDefined: true,
        }),
        ts,
        ts,
      ],
    );
  }

  const briefId = `brief_${slug(opportunity.id, 44)}`;
  const candidateId = `candidate_${slug(opportunity.id, 40)}`;
  run(
    db,
    `INSERT OR REPLACE INTO commercial_briefs
     (id, workflow_id, venture_id, source, status, title, idea, buyer, problem,
      evidence_summary, research_basis, metadata, created_at, updated_at)
     VALUES (?, ?, ?, 'pantheon_supervisor', 'ready', ?, ?, ?, ?, ?, ?, ?,
       COALESCE((SELECT created_at FROM commercial_briefs WHERE id = ?), ?), ?)`,
    [
      briefId,
      round.metadata.workflowId,
      opportunity.venture_id,
      `${opportunity.title} commercial brief`,
      opportunity.offer_direction,
      opportunity.buyer,
      opportunity.problem,
      `${opportunity.recommendation} ${opportunity.metadata.validation?.evidence?.join(" ") || ""}`.trim(),
      `Opportunity round ${round.id}; source evidence IDs: ${opportunity.evidence_ids.join(", ") || "none"}.`,
      toJson({ roundId: round.id, opportunityId: opportunity.id, cataloguePlanId: planId, finance: opportunity.metadata.finance || {} }),
      briefId,
      ts,
      ts,
    ],
  );
  run(
    db,
    `INSERT OR REPLACE INTO commercial_test_candidates
     (id, brief_id, workflow_id, venture_id, rank, status, title, buyer, problem, offer,
      channel, price_cents, gross_margin_cents, cost_cap_cents, evidence_score, confidence,
      hypothesis, smallest_action, expected_metric, target_value, target_unit, success_metric,
      kill_criteria, risk, rationale, metadata, created_at, updated_at)
     VALUES (?, ?, ?, ?, 1, 'recommended', ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?, ?, ?,
       0, 'qualified views', ?, ?, ?, ?, ?,
       COALESCE((SELECT created_at FROM commercial_test_candidates WHERE id = ?), ?), ?)`,
    [
      candidateId,
      briefId,
      round.metadata.workflowId,
      opportunity.venture_id,
      opportunity.title,
      opportunity.buyer,
      opportunity.problem,
      work.offer || opportunity.offer_direction,
      work.channel || opportunity.channel,
      priceCents,
      opportunity.overall_score,
      output.confidence || opportunity.confidence,
      work.testHypothesis || `The validated buyer will act on ${work.offer || opportunity.offer_direction}.`,
      work.smallestTest || opportunity.smallest_validation,
      work.successMetric || "Meaningful buyer action and positive contribution",
      work.successMetric || "Meaningful buyer action and positive contribution",
      work.stopRule || opportunity.metadata.validation?.stopRule || "Stop or revise if meaningful exposure produces no buyer action.",
      (output.risks || []).join("; "),
      output.summary || opportunity.recommendation,
      toJson({ roundId: round.id, opportunityId: opportunity.id, cataloguePlanId: planId, catalogueCount: count }),
      candidateId,
      ts,
      ts,
    ],
  );
  return { planId, briefId, candidateId, count };
}

function projectOfferResult(db, task, round, opportunity, output) {
  const resources = createCatalogueAndBrief(db, round, opportunity, output);
  const metadata = {
    ...opportunity.metadata,
    offer: {
      taskId: task.id,
      summary: output.summary || "",
      work: output.roleOutput || {},
      risks: output.risks || [],
      confidence: output.confidence || "low",
    },
    ...resources,
  };
  run(
    db,
    "UPDATE opportunities SET status = 'ready_to_build', recommendation = ?, metadata = ?, updated_at = ? WHERE id = ?",
    [output.summary || opportunity.recommendation, toJson(metadata), now(), opportunity.id],
  );
  const journey = journeyForRound(db, round.id);
  const chief = journey ? null : recordProtectedWorkerOutcome(
    db,
    {
      kind: "commercial_opportunity_decision",
      agent: "chief_of_staff",
      workflow_id: round.metadata.workflowId,
      venture_id: opportunity.venture_id,
      title: `Decide whether to build ${opportunity.title}`,
      payload: {
        buyer: opportunity.buyer,
        problem: opportunity.problem,
        offer: output.roleOutput?.offer || opportunity.offer_direction,
        channel: output.roleOutput?.channel || opportunity.channel,
      },
    },
    {
      heading: "Commercial opportunity ready",
      summary: `${opportunity.title} passed Pantheon's initial demand, economics, and offer review. The catalogue plan contains ${resources.count} planned products; no sellable files, public listing, customer contact, or advertising action has occurred.`,
      moneyMove: `Build and quality-check the ${resources.count}-product minimum credible catalogue before asking Daniel to approve any public launch action.`,
      evidence: [
        `Opportunity score: ${opportunity.overall_score}/100.`,
        `Validation confidence: ${opportunity.metadata.validation?.confidence || opportunity.confidence}.`,
        `Attributable source records: ${opportunity.evidence_ids.length}.`,
        `Catalogue breadth: ${resources.count} planned products.`,
      ],
      risks: [
        ...(output.risks || []),
        "The catalogue is a production plan, not a finished or sellable product set.",
        "Demand evidence does not guarantee conversion or positive contribution.",
      ],
      nextAction: "Start the protected build only after reviewing this concise venture choice.",
      operatorDecision: "approve",
      confidence: output.confidence || "medium",
    },
    {
      approvalRequired: false,
      metadata: { roundId: round.id, opportunityId: opportunity.id, ...resources },
    },
  );
  const build = prepareCatalogueBuild(db, {
    roundId: round.id,
    opportunityId: opportunity.id,
    planId: resources.planId,
    operatorChoiceRequired: true,
  });
  updateRound(db, round.id, {
    status: "ready_to_build",
    completedAt: now(),
    metadata: {
      offerTaskId: task.id,
      selectedOpportunityId: opportunity.id,
      buildDecisionTaskId: build.task?.id || null,
      buildDecisionApprovalId: build.approval?.id || null,
      ...resources,
    },
  });
  if (journey) {
    updateJourney(db, journey.id, {
      status: "waiting_for_operator",
      activeStage: "product_build",
      selectedOpportunityId: opportunity.id,
      metadata: {
        selectedOpportunityId: opportunity.id,
        cataloguePlanId: resources.planId,
        catalogueItemCount: resources.count,
        currentTaskId: build.task?.id || null,
        currentApprovalId: build.approval?.id || null,
      },
      stageEvent: {
        stage: "offer_architecture",
        status: "completed",
        taskId: task.id,
        workerId: "offer_architect",
        note: `The offer and ${resources.count}-item digital-product catalogue are ready for the build decision.`,
      },
    });
  }
  run(
    db,
    `UPDATE workflows SET status = 'blocked_for_approval', current_step = 'Product build decision ready',
      approval_required = 1, updated_at = ? WHERE id = ?`,
    [now(), round.metadata.workflowId],
  );
  return { chief, build, ...resources };
}

function projectCompletedCommercialTask(db, taskId) {
  const task = get(db, "SELECT * FROM tasks WHERE id = ?", [taskId]);
  if (!task || task.status !== "completed") return { projected: false, reason: "task_not_completed" };
  const step = commercialMetadata(task);
  if (!step?.roundId || !step.step) return { projected: false, reason: "not_pantheon_commercial_work" };
  const round = parseRow(get(db, "SELECT * FROM opportunity_rounds WHERE id = ?", [step.roundId]));
  if (!round) throw new Error(`Opportunity round not found: ${step.roundId}`);
  const projectedTaskIds = Array.isArray(round.metadata.projectedTaskIds) ? round.metadata.projectedTaskIds : [];
  if (projectedTaskIds.includes(task.id)) return { projected: false, reason: "already_projected", round };
  const output = taskOutput(task);
  const opportunity = step.opportunityId ? opportunityById(db, step.opportunityId) : null;
  let next = null;
  if (step.step === "opportunity_scout") next = projectScoutResult(db, task, round, output);
  else if (step.step === "demand_validator") next = projectValidatorResult(db, task, round, opportunity, output);
  else if (step.step === "finance_analysis") next = projectFinanceResult(db, task, round, opportunity, output);
  else if (step.step === "offer_architecture") next = projectOfferResult(db, task, round, opportunity, output);
  else if (step.step === "commercial_investment_review") next = projectCommercialInvestmentReview(db, task, output);
  else throw new Error(`Unsupported completed commercial step: ${step.step}`);
  const latest = parseRow(get(db, "SELECT * FROM opportunity_rounds WHERE id = ?", [round.id]));
  updateRound(db, round.id, {
    metadata: { projectedTaskIds: [...new Set([...(latest.metadata.projectedTaskIds || []), task.id])] },
  });
  insertEvent(db, {
    actor: "pantheon",
    type: "commercial_discovery.step_projected",
    entityType: "task",
    entityId: task.id,
    message: `Pantheon incorporated the ${step.step.replaceAll("_", " ")} result into commercial state.`,
    metadata: { roundId: round.id, opportunityId: opportunity?.id || null, nextTaskId: next?.task?.id || null },
  });
  return { projected: true, step: step.step, round: updateRound(db, round.id), opportunity, next };
}

function pendingCommercialTask(db, workflowId = null) {
  const workflowFilter = workflowId ? "AND tasks.workflow_id = ?" : "";
  const row = get(
    db,
    `SELECT tasks.*
     FROM tasks
     JOIN workflows ON workflows.id = tasks.workflow_id
     JOIN opportunity_rounds
       ON opportunity_rounds.id = json_extract(
         tasks.payload,
         '$.liveSpendRequest.parameters.pantheonCommercial.roundId'
       )
     WHERE tasks.kind = 'live_ai_worker_execution'
       AND json_extract(tasks.payload, '$.liveSpendRequest.parameters.pantheonCommercial.supervisorOwned') = 1
       AND tasks.status IN ('queued', 'blocked', 'waiting_approval', 'running', 'needs_attention')
       AND workflows.status NOT IN ('failed', 'cancelled', 'completed')
       AND opportunity_rounds.status IN ('researching', 'validating', 'checking_economics', 'structuring_offer', 'investment_review')
       ${workflowFilter}
     ORDER BY tasks.priority ASC, tasks.created_at ASC LIMIT 1`,
    workflowId ? [workflowId] : [],
  );
  return row ? parseRow(row, ["payload", "result"]) : null;
}

function getOpportunityState(db) {
  const rounds = all(db, "SELECT * FROM opportunity_rounds ORDER BY created_at DESC LIMIT 20").map((row) => parseRow(row));
  const opportunities = all(
    db,
    "SELECT * FROM opportunities ORDER BY CASE status WHEN 'ready_to_build' THEN 0 WHEN 'validated' THEN 1 WHEN 'selected_for_validation' THEN 2 ELSE 3 END, overall_score DESC, created_at DESC LIMIT 60",
  ).map((row) => parseRow(row, ["evidence_ids", "metadata"]));
  const plans = all(db, "SELECT * FROM catalogue_plans ORDER BY created_at DESC LIMIT 20").map((row) => parseRow(
    row,
    ["audience_segments", "channels", "geographies", "languages", "metadata"],
  ));
  const items = all(db, "SELECT * FROM catalogue_items ORDER BY created_at DESC LIMIT 160").map((row) => parseRow(row));
  const active = rounds.find((round) => ACTIVE_ROUND_STATES.has(round.status)) || null;
  const ready = opportunities.find((opportunity) => opportunity.status === "ready_to_build") || null;
  return {
    schema: "pantheon_opportunity_state_v1",
    activeRound: active,
    latestRound: rounds[0] || null,
    currentTask: pendingCommercialTask(db),
    topOpportunity: ready || opportunities[0] || null,
    rounds,
    opportunities,
    cataloguePlans: plans,
    catalogueItems: items,
    mandate: operatingMandateState(db),
  };
}

module.exports = {
  ACTIVE_ROUND_STATES,
  createRoundRecords,
  getOpportunityState,
  pendingCommercialTask,
  projectCompletedCommercialTask,
  queueCommercialWorker,
  resumeJourneyCandidateSelection,
  startOpportunityRound,
};
