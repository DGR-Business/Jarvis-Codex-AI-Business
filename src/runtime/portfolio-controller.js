const crypto = require("node:crypto");
const CONFIG = require("../config");
const {
  all,
  fromJson,
  get,
  insertEvent,
  now,
  randomId,
  run,
  toJson,
} = require("../db");
const { ensureCapabilityAssurance, getCapabilityAssuranceState } = require("./capability-assurance");
const {
  commercialKnowledgeState,
  ensureCommercialKnowledge,
  getCommercialConstitution,
} = require("./commercial-knowledge");
const { listInvestmentCases } = require("./commercial-investment-review");
const {
  createRoundRecords,
  getOpportunityState,
  queueCommercialWorker,
  startOpportunityRound,
} = require("./pantheon-opportunities");
const { recordEvidence } = require("./venture-case");
const { ensureVentureKitRegistry, listVentureKits } = require("./venture-kit-registry");

const MAX_BOUNDED_DISCOVERY_ROUNDS = 2;
const MAX_TECHNICAL_DISCOVERY_FAILURES = 2;

function requireBoundedPreventureResearchAuthority(pathName) {
  const error = new Error(
    "Legacy pre-venture portfolio research is retired until Pantheon has a narrow, auditable pre-venture research authority.",
  );
  error.statusCode = 410;
  error.code = "legacy_commercial_path_retired";
  error.details = {
    path: pathName,
    replacement: "bounded_preventure_research_authority_pending",
  };
  throw error;
}

function cleanOpportunityTitle(value) {
  return String(value || "")
    .replace(/^\s*\d+\s*[.)-]\s*/, "")
    .trim();
}

function normalizePortfolioRecords(db) {
  const timestamp = now();
  const opportunities = all(
    db,
    `SELECT opportunities.id, opportunities.title
     FROM opportunities
     INNER JOIN opportunity_rounds ON opportunity_rounds.id = opportunities.round_id
     WHERE opportunity_rounds.mode = 'portfolio_discovery'`,
  );
  for (const opportunity of opportunities) {
    const title = cleanOpportunityTitle(opportunity.title);
    if (title && title !== opportunity.title) {
      run(db, "UPDATE opportunities SET title = ?, updated_at = ? WHERE id = ?", [title, timestamp, opportunity.id]);
    }
  }
  const terminalRounds = all(
    db,
    `SELECT id FROM opportunity_rounds
     WHERE mode = 'portfolio_discovery' AND status IN ('completed', 'no_investment')`,
  );
  for (const round of terminalRounds) {
    run(
      db,
      `UPDATE commercial_decision_cases
       SET status = CASE WHEN recommendation = 'advance' THEN status
                         WHEN recommendation = 'reject' THEN 'rejected'
                         ELSE 'parked' END,
           updated_at = ?
       WHERE round_id = ? AND status IN ('researching', 'ready_for_review')`,
      [timestamp, round.id],
    );
    run(
      db,
      `UPDATE opportunities
       SET status = 'parked', updated_at = ?
       WHERE id IN (
         SELECT opportunity_id FROM commercial_decision_cases
         WHERE round_id = ? AND recommendation <> 'advance'
       )
         AND status <> 'parked'`,
      [timestamp, round.id],
    );
  }
}

function neutralizeLegacyPilotDefaults(db) {
  const timestamp = now();
  const venture = get(db, "SELECT * FROM ventures WHERE id = 'venture-digital-products'");
  if (
    venture
    && venture.name === "Digital Products"
    && venture.business_model === "digital_product"
  ) {
    run(
      db,
      `UPDATE ventures
       SET name = 'First Venture',
           business_model = 'unselected',
           summary = ?,
           metadata = ?,
           updated_at = ?
       WHERE id = ?`,
      [
        "The sole active venture until one evidence-selected offer proves three independent buyers and positive cash contribution.",
        toJson({
          ...fromJson(venture.metadata, {}),
          channel: "Evidence-selected distribution",
          priorPilot: "digital_product",
        }),
        timestamp,
        venture.id,
      ],
    );
  }

  const ventureCase = get(db, "SELECT * FROM venture_cases WHERE venture_id = 'venture-digital-products'");
  if (
    ventureCase
    && ventureCase.next_money_move === "Rank three digital-product opportunities and select one evidence-backed test."
  ) {
    run(
      db,
      `UPDATE venture_cases
       SET offer = ?,
           channel = ?,
           next_money_move = ?,
           metadata = ?,
           updated_at = ?
       WHERE venture_id = ?`,
      [
        "The smallest credible commercial offer that solves the validated problem.",
        "One or more evidence-selected channels with supportable economics.",
        "Run broad market discovery, compare three qualified candidates, and invest only if one passes every commercial gate.",
        toJson({
          ...fromJson(ventureCase.metadata, {}),
          platform: "evidence_selected",
          priorPilotPlatform: "gumroad_direct",
        }),
        timestamp,
        ventureCase.venture_id,
      ],
    );
  }

  const pilotSetting = get(db, "SELECT value FROM settings WHERE key = 'commercial.pilot'");
  const pilot = fromJson(pilotSetting?.value, {});
  if (pilot.businessModel === "digital_product" || pilot.platform === "gumroad_direct") {
    run(
      db,
      "UPDATE settings SET value = ?, updated_at = ? WHERE key = 'commercial.pilot'",
      [
        toJson({
          ...pilot,
          businessModel: "evidence_selected",
          platform: "evidence_selected",
          priorBusinessModel: pilot.businessModel,
          priorPlatform: pilot.platform,
        }),
        timestamp,
      ],
    );
  }
}

function parkJobSearchProduct(db) {
  const matchingOpportunities = all(
    db,
    `SELECT opportunities.id, opportunities.venture_id, opportunities.status, opportunities.metadata
     FROM opportunities
     LEFT JOIN opportunity_rounds ON opportunity_rounds.id = opportunities.round_id
     WHERE (
       lower(opportunities.title) LIKE '%job search%'
       OR lower(opportunities.offer_direction) LIKE '%job search%'
     )
       AND COALESCE(opportunity_rounds.mode, '') <> 'portfolio_discovery'`,
  );
  const opportunityRows = matchingOpportunities.filter((row) => row.status !== "parked");
  const timestamp = now();
  for (const row of opportunityRows) {
    const metadata = fromJson(row.metadata, {});
    run(
      db,
      `UPDATE opportunities
       SET status = 'parked',
           metadata = ?,
           updated_at = ?
       WHERE id = ?`,
      [
        toJson({
          ...metadata,
          parkedReason: "Pending unbiased comparison with LinkedIn, Indeed, Seek, specialist trackers, templates, and adjacent alternatives.",
          parkedBy: "portfolio_controller_v1",
          parkedAt: timestamp,
        }),
        timestamp,
        row.id,
      ],
    );
  }
  const opportunityIds = matchingOpportunities.map((row) => row.id);
  const legacyVentureIds = [...new Set(matchingOpportunities.map((row) => row.venture_id).filter(Boolean))];
  const archivedJourneyIds = [];
  const archivedExperimentIds = [];
  const archivedPlanIds = [];
  if (opportunityIds.length) {
    const placeholders = opportunityIds.map(() => "?").join(", ");
    const journeys = all(
      db,
      `SELECT id, metadata
       FROM pantheon_journeys
       WHERE selected_opportunity_id IN (${placeholders})
         AND COALESCE(json_extract(metadata, '$.archivedFromOperator'), 0) <> 1`,
      opportunityIds,
    );
    for (const journey of journeys) {
      run(
        db,
        "UPDATE pantheon_journeys SET metadata = ?, updated_at = ? WHERE id = ?",
        [
          toJson({
            ...fromJson(journey.metadata, {}),
            archivedFromOperator: true,
            archivedReason: "The selected opportunity is parked pending an unbiased market comparison.",
            archivedAt: timestamp,
          }),
          timestamp,
          journey.id,
        ],
      );
      archivedJourneyIds.push(journey.id);
    }

    const plans = all(
      db,
      `SELECT id, metadata
       FROM catalogue_plans
       WHERE opportunity_id IN (${placeholders})
         AND COALESCE(json_extract(metadata, '$.archivedFromOperator'), 0) <> 1`,
      opportunityIds,
    );
    for (const plan of plans) {
      run(
        db,
        "UPDATE catalogue_plans SET metadata = ?, updated_at = ? WHERE id = ?",
        [
          toJson({
            ...fromJson(plan.metadata, {}),
            archivedFromOperator: true,
            archivedReason: "Historical product proof retained after its opportunity was parked.",
            archivedAt: timestamp,
          }),
          timestamp,
          plan.id,
        ],
      );
      archivedPlanIds.push(plan.id);
    }
  }

  const experiments = legacyVentureIds.length
    ? all(
      db,
      `SELECT id, status, metadata
       FROM commercial_experiments
       WHERE venture_id IN (${legacyVentureIds.map(() => "?").join(", ")})
         AND (
           lower(name) LIKE '%job search%'
           OR lower(hypothesis) LIKE '%job search%'
           OR lower(offer) LIKE '%job search%'
         )
         AND COALESCE(json_extract(metadata, '$.archivedFromOperator'), 0) <> 1`,
      legacyVentureIds,
    )
    : [];
  for (const experiment of experiments) {
    const nextStatus = ["candidate", "ready", "running"].includes(experiment.status)
      ? "cancelled"
      : experiment.status;
    run(
      db,
      "UPDATE commercial_experiments SET status = ?, metadata = ?, updated_at = ? WHERE id = ?",
      [
        nextStatus,
        toJson({
          ...fromJson(experiment.metadata, {}),
          archivedFromOperator: true,
          archivedReason: "Historical product test retained after its opportunity was parked.",
          archivedAt: timestamp,
        }),
        timestamp,
        experiment.id,
      ],
    );
    archivedExperimentIds.push(experiment.id);
  }

  if (
    opportunityRows.length
    || archivedJourneyIds.length
    || archivedExperimentIds.length
    || archivedPlanIds.length
  ) {
    insertEvent(db, {
      actor: "portfolio_controller",
      type: "portfolio.job_search_product_parked",
      entityType: "portfolio",
      entityId: "portfolio-controller-v1",
      message: "The Job Search Evidence Tracker is parked pending an unbiased market comparison.",
      metadata: {
        opportunityIds,
        archivedJourneyIds,
        archivedExperimentIds,
        archivedPlanIds,
      },
    });
  }
  return {
    parkedCount: opportunityRows.length,
    opportunityIds,
    archivedJourneyIds,
    archivedExperimentIds,
    archivedPlanIds,
  };
}

function ensurePortfolioController(db) {
  neutralizeLegacyPilotDefaults(db);
  normalizePortfolioRecords(db);
  const knowledge = ensureCommercialKnowledge(db);
  const kits = ensureVentureKitRegistry(db);
  const assurance = ensureCapabilityAssurance(db);
  const jobSearch = parkJobSearchProduct(db);
  return { knowledge, kits, assurance, jobSearch };
}

function portfolioRounds(db) {
  return all(
    db,
    `SELECT * FROM opportunity_rounds
     WHERE mode = 'portfolio_discovery'
     ORDER BY created_at DESC`,
  ).map((row) => ({ ...row, metadata: fromJson(row.metadata, {}) }));
}

function targetedDiligenceRounds(db) {
  return all(
    db,
    `SELECT * FROM opportunity_rounds
     WHERE mode = 'targeted_diligence'
     ORDER BY created_at DESC`,
  ).map((row) => ({ ...row, metadata: fromJson(row.metadata, {}) }));
}

function portfolioWorkRounds(db) {
  return [...portfolioRounds(db), ...targetedDiligenceRounds(db)]
    .sort((left, right) => String(right.created_at).localeCompare(String(left.created_at)));
}

function activePortfolioWorkRound(db) {
  return portfolioWorkRounds(db).find((round) => [
    "researching",
    "validating",
    "checking_economics",
    "investment_review",
  ].includes(round.status)) || null;
}

function startTargetedInvestmentReview(db, input = {}) {
  requireBoundedPreventureResearchAuthority(
    "portfolio_targeted_investment_review_start",
  );
  ensurePortfolioController(db);
  const sourceOpportunityId = String(input.sourceOpportunityId || "").trim();
  const decisionGap = String(input.decisionGap || "").trim();
  const title = String(input.title || "").trim();
  const offerDirection = String(input.offerDirection || "").trim();
  const competitionEvidence = Array.isArray(input.competitionEvidence)
    ? input.competitionEvidence.map((item) => String(item || "").trim()).filter(Boolean)
    : [];
  const demandEvidence = Array.isArray(input.demandEvidence)
    ? input.demandEvidence.map((item) => String(item || "").trim()).filter(Boolean)
    : [];
  const publicEvidence = Array.isArray(input.publicEvidence) ? input.publicEvidence : [];
  if (!sourceOpportunityId || decisionGap.length < 20) {
    throw new Error("Targeted diligence requires an existing opportunity and one decision-critical evidence gap.");
  }
  if (title.length < 8 || offerDirection.length < 20) {
    throw new Error("Targeted diligence requires a specific reviewed opportunity title and offer direction.");
  }
  if (competitionEvidence.length < 3 || demandEvidence.length < 2 || publicEvidence.length < 3) {
    throw new Error("Targeted diligence requires three competitor observations, two demand observations, and three attributable public sources.");
  }
  const invalidEvidence = publicEvidence.find((item) => (
    !/^https?:\/\//i.test(String(item?.sourceUrl || ""))
    || String(item?.claim || "").trim().length < 20
    || String(item?.title || "").trim().length < 3
  ));
  if (invalidEvidence) {
    throw new Error("Every targeted-diligence source needs an exact public URL, title, and decision-relevant claim.");
  }
  const active = activePortfolioWorkRound(db);
  if (active) {
    return { started: false, reason: "already_running", round: active, state: getPortfolioState(db) };
  }

  const source = get(db, "SELECT * FROM opportunities WHERE id = ?", [sourceOpportunityId]);
  if (!source) throw new Error(`Opportunity not found: ${sourceOpportunityId}`);
  const sourceRound = get(db, "SELECT * FROM opportunity_rounds WHERE id = ?", [source.round_id]);
  if (!sourceRound) throw new Error(`Source opportunity round not found: ${source.round_id}`);
  const sourceRoundMetadata = fromJson(sourceRound.metadata, {});
  const comparisonCompletedIds = Array.isArray(sourceRoundMetadata.validationCompletedIds)
    ? sourceRoundMetadata.validationCompletedIds
    : [];
  if (comparisonCompletedIds.length < 3) {
    throw new Error("Targeted diligence requires a prior three-candidate comparison.");
  }

  const prompt = String(
    input.prompt
      || `Close only this decision gap for ${title}: ${decisionGap}. Re-check demand and economics without repeating broad discovery.`,
  ).trim();
  const round = createRoundRecords(
    db,
    {
      targetedInvestmentReview: true,
      sourceOpportunityId,
      decisionGap,
      prompt,
      geography: input.geography || source.geography || "global",
      language: input.language || source.language || "English",
      source: input.source || "jarvis_targeted_diligence",
      createdBy: input.createdBy || "Jarvis",
    },
    { id: source.venture_id },
  );
  const baselineEvidenceIds = [];
  for (const evidence of publicEvidence) {
    const fingerprint = crypto
      .createHash("sha256")
      .update(`${evidence.sourceUrl}\n${evidence.claim}`)
      .digest("hex")
      .slice(0, 16);
    const id = `evidence_targeted_${fingerprint}`;
    if (!get(db, "SELECT id FROM commercial_evidence WHERE id = ?", [id])) {
      recordEvidence(db, {
        id,
        ventureId: source.venture_id,
        sourceType: "source_link",
        sourceId: round.id,
        sourceUrl: evidence.sourceUrl,
        title: evidence.title,
        claim: evidence.claim,
        summary: evidence.summary || "",
        metric: evidence.metric || "",
        measuredValue: evidence.measuredValue ?? null,
        measuredUnit: evidence.measuredUnit || "",
        market: evidence.market || "",
        geography: evidence.geography || input.geography || source.geography || "",
        observedAt: evidence.observedAt || now(),
        sampleSize: evidence.sampleSize ?? null,
        publisher: evidence.publisher || "",
        extractionMethod: evidence.extractionMethod || "Jarvis public-data review",
        confidence: evidence.confidence || "medium",
        verified: true,
        metadata: {
          targetedDiligence: true,
          sourceOpportunityId,
          decisionGap,
          limitations: Array.isArray(evidence.limitations) ? evidence.limitations : [],
        },
      });
    }
    baselineEvidenceIds.push(id);
  }

  const sourceMetadata = fromJson(source.metadata, {});
  const {
    validation: _priorValidation,
    finance: _priorFinance,
    ...retainedMetadata
  } = sourceMetadata;
  const sourceEvidenceIds = fromJson(source.evidence_ids, []);
  const opportunityId = `opp_targeted_${randomId()}`;
  const timestamp = now();
  run(
    db,
    `INSERT INTO opportunities
     (id, round_id, venture_id, source_type, status, title, business_model, buyer,
      problem, offer_direction, geography, language, channel, demand_score,
      supply_gap_score, economics_score, channel_fit_score, execution_fit_score,
      risk_score, overall_score, confidence, recommendation, smallest_validation,
      evidence_ids, metadata, created_at, updated_at)
     VALUES (?, ?, ?, 'targeted_diligence', 'selected_for_validation', ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      opportunityId,
      round.id,
      source.venture_id,
      title,
      input.businessModel || source.business_model,
      input.buyer || source.buyer,
      input.problem || source.problem,
      offerDirection,
      input.geography || source.geography,
      input.language || source.language,
      input.channel || source.channel,
      source.demand_score,
      source.supply_gap_score,
      source.economics_score,
      source.channel_fit_score,
      source.execution_fit_score,
      source.risk_score,
      source.overall_score,
      input.confidence || source.confidence,
      `Targeted diligence is testing one named gap: ${decisionGap}`,
      input.smallestValidation || source.smallest_validation,
      toJson(baselineEvidenceIds),
      toJson({
        ...retainedMetadata,
        demandEvidence,
        competitionEvidence,
        risks: Array.isArray(input.risks) && input.risks.length ? input.risks : retainedMetadata.risks || [],
        targetedReview: {
          parentOpportunityId: sourceOpportunityId,
          comparisonRoundId: source.round_id,
          comparisonCompletedIds,
          decisionGap,
          baselineEvidenceIds,
          parentEvidenceCount: sourceEvidenceIds.length,
          startedAt: timestamp,
        },
      }),
      timestamp,
      timestamp,
    ],
  );
  const roundMetadata = round.metadata && typeof round.metadata === "object"
    ? round.metadata
    : fromJson(round.metadata, {});
  run(
    db,
    `UPDATE opportunity_rounds
     SET status = 'validating', metadata = ?, updated_at = ?
     WHERE id = ?`,
    [
      toJson({
        ...roundMetadata,
        targetedInvestmentReview: true,
        sourceOpportunityId,
        decisionGap,
        selectedOpportunityId: opportunityId,
        validationQueueIds: [opportunityId],
        validationCompletedIds: [],
        comparisonRoundId: source.round_id,
        comparisonCompletedIds,
        baselineEvidenceIds,
        productionBlocked: true,
      }),
      timestamp,
      round.id,
    ],
  );
  const queued = queueCommercialWorker(db, round.id, "demand_validator", {
    opportunityId,
    model: CONFIG.terraModel,
    modelLocked: true,
    budgetCents: Number(input.demandBudgetCents || 300),
  });
  insertEvent(db, {
    actor: "portfolio_controller",
    type: "portfolio.targeted_diligence_started",
    entityType: "opportunity_round",
    entityId: round.id,
    message: `Pantheon started targeted diligence for ${title}.`,
    metadata: {
      sourceOpportunityId,
      opportunityId,
      decisionGap,
      baselineEvidenceIds,
      productionBlocked: true,
      taskId: queued.task?.id || null,
    },
  });
  const persistedRound = get(db, "SELECT * FROM opportunity_rounds WHERE id = ?", [round.id]);
  const persistedOpportunity = get(db, "SELECT * FROM opportunities WHERE id = ?", [opportunityId]);
  return {
    started: true,
    round: { ...persistedRound, metadata: fromJson(persistedRound.metadata, {}) },
    opportunity: {
      ...persistedOpportunity,
      evidence_ids: fromJson(persistedOpportunity.evidence_ids, []),
      metadata: fromJson(persistedOpportunity.metadata, {}),
    },
    queued,
    state: getPortfolioState(db),
  };
}

function discoveryPrompt(roundNumber, priorRound = null, operatorIdea = "") {
  const priorSummary = priorRound
    ? `The prior bounded round ended with: ${priorRound.metadata.outcome || priorRound.status}. Do not repeat its unsupported claims or candidates unless materially new evidence is available.`
    : "";
  return [
    "Explore exactly five distinct lawful online-business opportunity spaces across different business models.",
    "Consider digital products, print-on-demand, marketplace products, affiliate models, white-label products, software or services, and other evidence-supported online models without favouring Pantheon's current digital-product kit.",
    "Include a fair Job Search Evidence Tracker benchmark against LinkedIn, Indeed, Seek, specialist job trackers, templates, and adjacent alternatives; keep it only if it wins on buyer value, evidence, economics, entry position, and distribution.",
    "For each space identify the buyer, important problem, direct demand indicators, meaningful competitor or substitute sample, realised or listed price evidence, channel evidence, operating requirements, economics hypothesis, major risk, and smallest validation.",
    "Never invent sales units, traffic, revenue, conversion, or competitor economics. Label observed facts, estimates, assumptions, and model inference.",
    "Rank the five candidates, but do not treat buildability in Pantheon's existing kit as a commercial score.",
    operatorIdea
      ? `Daniel submitted this idea for a fair comparison as one of the five spaces: ${operatorIdea}`
      : "",
    `This is bounded discovery round ${roundNumber} of ${MAX_BOUNDED_DISCOVERY_ROUNDS}.`,
    priorSummary,
  ].filter(Boolean).join(" ");
}

function startPortfolioDiscovery(db, input = {}) {
  requireBoundedPreventureResearchAuthority(
    "portfolio_discovery_start",
  );
  ensurePortfolioController(db);
  const rounds = portfolioRounds(db);
  const evidenceRounds = rounds.filter((round) => round.status !== "stopped_unknown_outcome");
  const technicalFailures = rounds.filter((round) => round.status === "stopped_unknown_outcome");
  const recoveryRounds = rounds.filter((round) => round.metadata.developerRecovery === true);
  const failedRecovery = recoveryRounds.some((round) => round.status === "stopped_unknown_outcome");
  const active = activePortfolioWorkRound(db);
  if (active) {
    return { started: false, reason: "already_running", round: active, state: getPortfolioState(db) };
  }
  if (failedRecovery) {
    return {
      started: false,
      reason: "technical_recovery_exhausted",
      message: "The single repaired discovery round also stopped without usable evidence. Pantheon will not spend again automatically.",
      state: getPortfolioState(db),
    };
  }
  const developerRecovery = input.developerRecovery === true;
  if (developerRecovery && (
    technicalFailures.length < MAX_TECHNICAL_DISCOVERY_FAILURES
    || recoveryRounds.length > 0
  )) {
    return {
      started: false,
      reason: "technical_recovery_not_available",
      message: "A developer recovery round is only available once after two technical discovery failures.",
      state: getPortfolioState(db),
    };
  }
  if (
    technicalFailures.length >= MAX_TECHNICAL_DISCOVERY_FAILURES
    && recoveryRounds.length === 0
    && !developerRecovery
  ) {
    return {
      started: false,
      reason: "developer_recovery_required",
      message: "Both market scans stopped for technical reasons. Jarvis must apply and record a bounded recovery before another paid call.",
      state: getPortfolioState(db),
    };
  }
  if (evidenceRounds.length >= MAX_BOUNDED_DISCOVERY_ROUNDS && input.resetBoundedRounds !== true) {
    return {
      started: false,
      reason: "bounded_round_limit_reached",
      message: "Pantheon completed both bounded discovery rounds. Daniel must decide whether new evidence justifies another round.",
      state: getPortfolioState(db),
    };
  }
  const roundNumber = evidenceRounds.length + 1;
  const operatorIdea = String(input.idea || "").trim();
  const result = startOpportunityRound(db, {
    portfolioControllerV1: true,
    prompt: input.prompt || discoveryPrompt(roundNumber, rounds[0], operatorIdea),
    geography: input.geography || "global",
    language: input.language || "English",
    maxCandidates: 5,
    source: input.source || "portfolio_controller",
    createdBy: input.createdBy || "Pantheon",
    model: CONFIG.terraModel,
    modelLocked: false,
  });
  const roundMetadata = result.round.metadata && typeof result.round.metadata === "object"
    ? result.round.metadata
    : fromJson(result.round.metadata, {});
  const metadata = {
    ...roundMetadata,
    boundedRoundNumber: roundNumber,
    boundedRoundLimit: MAX_BOUNDED_DISCOVERY_ROUNDS,
    constitutionVersion: getCommercialConstitution().version,
    developerRecovery,
    operatorIdea: operatorIdea || null,
    replacesTechnicalRoundIds: developerRecovery ? technicalFailures.map((round) => round.id) : [],
  };
  run(
    db,
    "UPDATE opportunity_rounds SET metadata = ?, updated_at = ? WHERE id = ?",
    [toJson(metadata), now(), result.round.id],
  );
  insertEvent(db, {
    actor: "portfolio_controller",
    type: "portfolio.discovery_started",
    entityType: "opportunity_round",
    entityId: result.round.id,
    message: `Pantheon started bounded portfolio discovery round ${roundNumber}.`,
    metadata: {
      roundNumber,
      maximumRounds: MAX_BOUNDED_DISCOVERY_ROUNDS,
      developerRecovery,
      productionBlocked: true,
      opportunitySpacesRequired: 5,
      finalistsRequired: 3,
    },
  });
  return { started: true, ...result, state: getPortfolioState(db) };
}

function getPortfolioState(db) {
  const discoveryRounds = portfolioRounds(db);
  const recordedRounds = portfolioWorkRounds(db);
  const evidenceRounds = discoveryRounds.filter((round) => round.status !== "stopped_unknown_outcome");
  const technicalFailures = discoveryRounds.filter((round) => round.status === "stopped_unknown_outcome");
  const recoveryRounds = discoveryRounds.filter((round) => round.metadata.developerRecovery === true);
  const failedRecovery = recoveryRounds.some((round) => round.status === "stopped_unknown_outcome");
  const targetedRounds = recordedRounds.filter((round) => round.mode === "targeted_diligence");
  const opportunityState = getOpportunityState(db);
  const cases = listInvestmentCases(db);
  const selectedCase = cases.find((item) => item.recommendation === "advance" && item.status === "decided") || null;
  const retainedActiveRound = recordedRounds.find((round) => [
    "researching",
    "validating",
    "checking_economics",
    "investment_review",
  ].includes(round.status)) || null;
  const rounds = recordedRounds.map((round) => {
    const retainedLiveStatus = [
      "researching",
      "validating",
      "checking_economics",
      "investment_review",
    ].includes(round.status);
    return {
      ...round,
      recordedStatus: round.status,
      status: retainedLiveStatus ? "retained_read_only" : round.status,
      readOnly: true,
      live: false,
      legacyPathRetired: true,
    };
  });
  const activeRound = retainedActiveRound
    ? rounds.find((round) => round.id === retainedActiveRound.id)
    : null;
  const recordedCurrentTask = opportunityState.currentTask;
  const currentTask = recordedCurrentTask
    ? {
      ...recordedCurrentTask,
      recordedStatus: recordedCurrentTask.status,
      status: "retained_read_only",
      readOnly: true,
      live: false,
      legacyPathRetired: true,
    }
    : null;
  const nextAction = retainedActiveRound
    ? {
      status: "retained_read_only",
      label: "Earlier portfolio research retained",
      detail: `The earlier round was recorded at ${String(retainedActiveRound.status).replaceAll("_", " ")}. It is read-only now; no portfolio research is running.`,
      action: null,
    }
    : selectedCase
      ? {
        status: "retained_read_only",
        label: "Earlier investment case retained",
        detail: "The recorded investment case is read-only. Any new work needs a separate exact current commercial authority.",
        action: null,
      }
      : failedRecovery
        ? {
          status: "retained_read_only",
          label: "Research could not be completed",
          detail: "The retained technical recovery stopped without usable evidence. No research is running and Pantheon has not reached a commercial conclusion.",
          action: null,
        }
        : recordedRounds.length === 0
        ? {
          status: "authority_required",
          label: "Commercial research needs an authorised plan",
          detail: "No portfolio research is running. The retired broad-research path cannot create work; a narrow, auditable pre-venture authority is required first.",
          action: null,
        }
        : {
          status: "retained_read_only",
          label: "Earlier portfolio evidence retained",
          detail: targetedRounds.length
            ? "The earlier discovery and targeted review are retained for audit. No portfolio research is running."
            : "The earlier discovery rounds are retained for audit. No portfolio research is running.",
          action: null,
        };
  return {
    schema: "pantheon.portfolio-controller.v1",
    status: activeRound || recordedRounds.length
      ? "retained_read_only"
      : "authority_required",
    readOnly: true,
    liveWork: false,
    legacyCreationPath: "retired",
    requiredAuthority: "bounded_preventure_research_authority_pending",
    policy: {
      maximumBoundedRounds: MAX_BOUNDED_DISCOVERY_ROUNDS,
      maximumTechnicalFailuresBeforeDeveloperRecovery: MAX_TECHNICAL_DISCOVERY_FAILURES,
      opportunitySpacesPerRound: 5,
      finalistsPerRound: 3,
      productionBlocked: true,
      oneActiveOperatingVenture: true,
      noForcedInvestment: true,
    },
    activeRound,
    currentTask,
    rounds,
    evidenceRoundCount: evidenceRounds.length,
    technicalFailureCount: technicalFailures.length,
    opportunities: opportunityState.opportunities.filter((item) => (
      rounds.some((round) => round.id === item.round_id)
    )),
    investmentCases: cases,
    selectedInvestmentCase: selectedCase,
    nextAction,
    commercial: {
      constitution: getCommercialConstitution(),
      knowledge: commercialKnowledgeState(db),
    },
    ventureKits: listVentureKits(db),
    capabilityAssurance: getCapabilityAssuranceState(db, { limit: 30 }),
  };
}

module.exports = {
  MAX_BOUNDED_DISCOVERY_ROUNDS,
  ensurePortfolioController,
  getPortfolioState,
  neutralizeLegacyPilotDefaults,
  parkJobSearchProduct,
  startPortfolioDiscovery,
  startTargetedInvestmentReview,
};
