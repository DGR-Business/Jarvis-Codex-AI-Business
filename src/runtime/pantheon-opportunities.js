const CONFIG = require("../config");
const { all, fromJson, get, insertEvent, now, randomId, run, toJson } = require("../db");
const { recordProtectedWorkerOutcome } = require("./ai-team");
const { requestLiveAiWorker } = require("./live-ai-workers");
const { approveInternalWorkWithinMandate, operatingMandateState } = require("./pantheon-policy");
const { prepareCatalogueBuild } = require("./pantheon-production");
const { recordEvidence } = require("./venture-case");

const ACTIVE_ROUND_STATES = new Set([
  "researching",
  "validating",
  "checking_economics",
  "structuring_offer",
]);

const STEP_CONFIG = Object.freeze({
  opportunity_scout: {
    worker: "opportunity_scout",
    title: "Research and rank commercial opportunities",
    budgetCents: 500,
    model: () => CONFIG.terraModel,
    tools: ["research_adapter"],
    maxTurns: 6,
    maxToolCalls: 6,
    maxOutputTokens: 5200,
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
    maxOutputTokens: 2400,
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
    maxOutputTokens: 1400,
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
    maxOutputTokens: 1900,
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

function calculatedScore(candidate) {
  return clampScore(
    clampScore(candidate.demandScore) * 0.28
      + clampScore(candidate.supplyGapScore) * 0.18
      + clampScore(candidate.economicsScore) * 0.20
      + clampScore(candidate.channelFitScore) * 0.14
      + clampScore(candidate.executionFitScore) * 0.14
      + (100 - clampScore(candidate.riskScore)) * 0.06,
  );
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
    return {
      objective: `Scan broadly, then rank 3-5 viable online business opportunities for: ${round.prompt}`,
      deliverable: "A scored shortlist covering demand, competition, economics, channel fit, execution fit, risks, geography, and the smallest meaningful validation.",
      constraints: [
        "Do not invent sales, unit volume, search volume, pricing, or competitor performance.",
        "Use normal public access only; do not bypass authentication, paywalls, CAPTCHAs, access controls, or rate limits.",
        "Consider digital products, POD, affiliate commerce, Amazon/white label, courses, guides, templates, art, and other AI-executable online models when evidence supports them.",
        "Prefer opportunities that can support a credible catalogue rather than a single token product.",
      ],
      acceptanceCriteria: [
        "Every opportunity names a buyer, painful problem, offer direction, channel, market, and evidence gap.",
        "Scores are comparative hypotheses, not fabricated market facts.",
        "At least one counter-signal or risk is visible for each candidate.",
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
  return {
    objective: `Turn the evidence for ${opportunity.title} into a differentiated offer and a minimum credible catalogue.`,
    deliverable: "Buyer, promise, positioning, price logic, objections, catalogue structure, product variants, test hypothesis, success metric, and stop rule.",
    constraints: ["Do not default to one product when the venture needs breadth.", "Catalogue size must match buyer segments, geography, channel norms, production cost, and evidence.", "No public claims without support."],
    acceptanceCriteria: ["Specific offer and buying trigger.", "Credible product breadth.", "Clear build order and testable launch hypothesis."],
  };
}

function queueCommercialWorker(db, roundId, step, options = {}) {
  const config = STEP_CONFIG[step];
  if (!config) throw new Error(`Unsupported Pantheon commercial step: ${step}`);
  const round = parseRow(get(db, "SELECT * FROM opportunity_rounds WHERE id = ?", [roundId]));
  if (!round) throw new Error(`Opportunity round not found: ${roundId}`);
  const opportunity = options.opportunityId ? opportunityById(db, options.opportunityId) : null;
  const existing = existingStepTask(db, roundId, step, opportunity?.id);
  if (existing) return { task: parseRow(existing, ["payload", "result"]), existing: true };

  const request = requestLiveAiWorker(db, round.metadata.workflowId, {
    requestKey: `${roundId}_${step}_${opportunity?.id || "round"}`,
    worker: config.worker,
    taskTitle: config.title,
    approvalTitle: `Run ${config.title.toLowerCase()}`,
    requestedBy: "pantheon_supervisor",
    estimatedCostCents: Number(options.budgetCents || config.budgetCents),
    provider: "openai-agents-sdk",
    model: options.model || config.model(),
    maxOutputTokens: Number(options.maxOutputTokens || config.maxOutputTokens),
    maxTurns: config.maxTurns,
    maxToolCalls: config.maxToolCalls,
    tools: config.tools,
    toolArguments: config.tools.length ? {
      research_adapter: {
        searchContextSize: "low",
        userLocation: { type: "approximate", country: "AU", timezone: "Australia/Brisbane" },
      },
    } : {},
    effects: [],
    businessContext: stepBusinessContext(round, opportunity),
    workBrief: stepWorkBrief(step, round, opportunity),
    parameters: {
      pantheonCommercial: {
        roundId,
        step,
        opportunityId: opportunity?.id || null,
        supervisorOwned: true,
        externalEffectsAllowed: false,
      },
    },
    reason: "Pantheon is performing exact internal commercial analysis under Daniel's recorded monthly operating mandate. No external business action is exposed.",
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
  return { ...request, mandate, existing: false };
}

function createRoundRecords(db, input, venture) {
  const ts = now();
  const id = `opp_round_${randomId()}`;
  const workflowId = `wf_commercial_discovery_${randomId()}`;
  const commandId = `cmd_commercial_discovery_${randomId()}`;
  const prompt = String(input.prompt || input.idea || "Find the strongest evidence-backed online business opportunities Pantheon can execute.").trim();
  const mode = input.idea ? "operator_idea" : "broad_discovery";
  const metadata = {
    workflowId,
    commandId,
    operatorIdea: input.idea || null,
    source: input.source || "dashboard",
    externalEffectsAllowed: false,
    agentRunner: { mode: "live_internal", liveModels: true, liveTools: true },
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
  const venture = activeVenture(db);
  const round = createRoundRecords(db, input, venture);
  const queued = queueCommercialWorker(db, round.id, "opportunity_scout", input);
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
  if (candidates.length < 3) throw new Error("Opportunity Scout did not return the required 3-5 structured candidates.");
  const evidenceIds = evidenceIdsForScout(db, task, round, output);
  const ts = now();
  const inserted = [];
  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    const id = `opp_${slug(round.id, 24)}_${index + 1}_${slug(candidate.title, 24)}`;
    const overallScore = calculatedScore(candidate);
    run(
      db,
      `INSERT OR IGNORE INTO opportunities
       (id, round_id, venture_id, source_type, status, title, business_model, buyer, problem,
        offer_direction, geography, language, channel, demand_score, supply_gap_score,
        economics_score, channel_fit_score, execution_fit_score, risk_score, overall_score,
        confidence, recommendation, smallest_validation, evidence_ids, metadata, created_at, updated_at)
       VALUES (?, ?, ?, 'live_agent_research', 'ranked',
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        round.id,
        round.venture_id,
        candidate.title,
        candidate.businessModel,
        candidate.buyer,
        candidate.problem,
        candidate.offerDirection,
        candidate.geography || round.geography,
        candidate.language || round.language,
        candidate.channel,
        clampScore(candidate.demandScore),
        clampScore(candidate.supplyGapScore),
        clampScore(candidate.economicsScore),
        clampScore(candidate.channelFitScore),
        clampScore(candidate.executionFitScore),
        clampScore(candidate.riskScore),
        overallScore,
        candidate.confidence || "low",
        output.recommendation || output.summary || "",
        candidate.smallestValidation || output.nextAction || "",
        toJson(evidenceIds),
        toJson({
          rank: index + 1,
          modelScore: clampScore(candidate.score),
          demandEvidence: candidate.demandEvidence || [],
          competitionEvidence: candidate.competitionEvidence || [],
          economicsHypothesis: candidate.economicsHypothesis || "",
          risks: candidate.risks || [],
          sourceTaskId: task.id,
        }),
        ts,
        ts,
      ],
    );
    inserted.push(opportunityById(db, id));
  }
  const ranked = inserted.sort((a, b) => b.overall_score - a.overall_score);
  const selected = ranked[0];
  run(db, "UPDATE opportunities SET status = 'selected_for_validation', updated_at = ? WHERE id = ?", [ts, selected.id]);
  updateRound(db, round.id, {
    status: "validating",
    metadata: {
      scoutTaskId: task.id,
      candidateCount: ranked.length,
      selectedOpportunityId: selected.id,
      sourceCount: evidenceIds.length,
    },
  });
  return queueCommercialWorker(db, round.id, "demand_validator", { opportunityId: selected.id });
}

function nextUnvalidatedOpportunity(db, roundId) {
  return parseRow(
    get(
      db,
      `SELECT * FROM opportunities
       WHERE round_id = ? AND status = 'ranked'
       ORDER BY overall_score DESC, created_at ASC LIMIT 1`,
      [roundId],
    ),
    ["evidence_ids", "metadata"],
  );
}

function projectValidatorResult(db, task, round, opportunity, output) {
  const verdict = String(output.operatorDecision || "needs_evidence");
  const positive = verdict === "approve" && output.confidence !== "low";
  const status = positive ? "validated" : verdict === "deny" ? "rejected" : "needs_evidence";
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
      sources: sourceRecords(output),
    },
  };
  run(
    db,
    "UPDATE opportunities SET status = ?, confidence = ?, recommendation = ?, metadata = ?, updated_at = ? WHERE id = ?",
    [status, output.confidence || opportunity.confidence, output.summary || opportunity.recommendation, toJson(metadata), now(), opportunity.id],
  );
  if (positive) {
    updateRound(db, round.id, {
      status: "checking_economics",
      metadata: { validatedOpportunityId: opportunity.id, validatorTaskId: task.id },
    });
    return queueCommercialWorker(db, round.id, "finance_analysis", { opportunityId: opportunity.id });
  }
  const next = nextUnvalidatedOpportunity(db, round.id);
  if (next) {
    run(db, "UPDATE opportunities SET status = 'selected_for_validation', updated_at = ? WHERE id = ?", [now(), next.id]);
    updateRound(db, round.id, {
      status: "validating",
      metadata: { selectedOpportunityId: next.id, priorOpportunityId: opportunity.id },
    });
    return queueCommercialWorker(db, round.id, "demand_validator", { opportunityId: next.id });
  }
  updateRound(db, round.id, {
    status: "needs_direction",
    completedAt: now(),
    metadata: { validatorTaskId: task.id, outcome: "No candidate passed the evidence threshold." },
  });
  return null;
}

function projectFinanceResult(db, task, round, opportunity, output) {
  const metadata = {
    ...opportunity.metadata,
    finance: {
      taskId: task.id,
      summary: output.summary || "",
      recommendation: output.recommendation || output.nextAction || "",
      work: output.roleOutput || {},
      risks: output.risks || [],
      confidence: output.confidence || "low",
    },
  };
  run(db, "UPDATE opportunities SET metadata = ?, updated_at = ? WHERE id = ?", [toJson(metadata), now(), opportunity.id]);
  updateRound(db, round.id, {
    status: "structuring_offer",
    metadata: { financeTaskId: task.id },
  });
  return queueCommercialWorker(db, round.id, "offer_architecture", { opportunityId: opportunity.id });
}

function targetCatalogueCount(opportunity) {
  const descriptor = `${opportunity.business_model} ${opportunity.offer_direction}`.toLowerCase();
  if (descriptor.includes("print on demand") || descriptor.includes("pod")) return 12;
  if (descriptor.includes("art")) return 8;
  if (descriptor.includes("affiliate")) return 10;
  if (descriptor.includes("amazon") || descriptor.includes("white label")) return 3;
  if (descriptor.includes("course") || descriptor.includes("guide")) return 4;
  return 5;
}

function priceCentsFromWork(work = {}) {
  const text = String(work.price || work.priceChannelHypothesis || "");
  const match = text.replace(/,/g, "").match(/(?:A?\$)\s*(\d+(?:\.\d{1,2})?)/i);
  return match ? Math.round(Number(match[1]) * 100) : 0;
}

function createCatalogueAndBrief(db, round, opportunity, output) {
  const ts = now();
  const count = targetCatalogueCount(opportunity);
  const work = output.roleOutput || {};
  const planId = `catalogue_${slug(opportunity.id, 40)}`;
  const priceCents = priceCentsFromWork(work);
  const planMetadata = {
    sourceTaskId: round.metadata.currentTaskId,
    evidenceStatus: "validated_opportunity",
    buildStatus: "not_started",
    offerWork: work,
    noSellableFilesClaimed: true,
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
      Math.max(0, count - 1),
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
  const labels = ["Core", "Starter", "Advanced", "Quick Start", "Complete", "Specialist", "Bundle", "Team", "Regional", "Premium", "Seasonal", "Expansion"];
  for (let index = 0; index < count; index += 1) {
    const id = `catalogue_item_${slug(opportunity.id, 30)}_${index + 1}`;
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
        `${opportunity.title} - ${labels[index] || `Variant ${index + 1}`}`,
        opportunity.business_model,
        opportunity.buyer,
        opportunity.geography,
        opportunity.language,
        index === 0 ? (work.offer || opportunity.offer_direction) : `${work.offer || opportunity.offer_direction} tailored as the ${labels[index] || `variant ${index + 1}`} offer.`,
        priceCents,
        toJson({ sequence: index + 1, sourceOpportunityId: opportunity.id, exactSpecificationRequired: true }),
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
  const chief = recordProtectedWorkerOutcome(
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

function pendingCommercialTask(db) {
  const row = get(
    db,
    `SELECT * FROM tasks
     WHERE kind = 'live_ai_worker_execution'
       AND json_extract(payload, '$.liveSpendRequest.parameters.pantheonCommercial.supervisorOwned') = 1
       AND status IN ('queued', 'blocked', 'waiting_approval', 'running', 'needs_attention')
     ORDER BY priority ASC, created_at ASC LIMIT 1`,
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
  getOpportunityState,
  pendingCommercialTask,
  projectCompletedCommercialTask,
  queueCommercialWorker,
  startOpportunityRound,
};
const crypto = require("node:crypto");
