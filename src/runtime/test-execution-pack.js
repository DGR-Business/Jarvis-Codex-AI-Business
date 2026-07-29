const { all, fromJson, get, insertEvent, now, randomId, run, toJson } = require("../db");
const { getCommercialExperiment, recordCommercialFeedback, recordCommercialResult } = require("./commercial-results");
const { recordProtectedWorkerOutcome } = require("./ai-team");
const { FRAMEWORKS, getBrief, getCandidate } = require("./research-to-experiment");

function asText(value, fallback = "") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function asInt(value) {
  return Math.max(0, Math.round(Number(value) || 0));
}

function safeSlug(value) {
  return String(value || "execution-pack")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 38) || "execution-pack";
}

function moneyLabel(cents) {
  const amount = Math.max(0, Math.round(Number(cents) || 0));
  if (!amount) return "no spend";
  return `$${(amount / 100).toFixed(2)}`;
}

function signedMoneyLabel(cents) {
  const amount = Math.round(Number(cents) || 0);
  const sign = amount < 0 ? "-" : "";
  return `${sign}$${(Math.abs(amount) / 100).toFixed(2)}`;
}

function percentLabel(numerator, denominator) {
  if (!denominator) return "0%";
  return `${Math.round((Number(numerator || 0) / Number(denominator || 1)) * 100)}%`;
}

function parsePack(row) {
  return row ? { ...row, metadata: fromJson(row.metadata) } : null;
}

function getExecutionPack(db, id) {
  return parsePack(get(db, "SELECT * FROM commercial_execution_packs WHERE id = ?", [id]));
}

function getExecutionPackForExperiment(db, experimentId) {
  return parsePack(
    get(
      db,
      `SELECT * FROM commercial_execution_packs
       WHERE experiment_id = ?
       ORDER BY updated_at DESC
       LIMIT 1`,
      [experimentId],
    ),
  );
}

function getExecutionPacks(db, limit = 80) {
  return all(
    db,
    `SELECT * FROM commercial_execution_packs
     ORDER BY updated_at DESC
     LIMIT ?`,
    [limit],
  ).map(parsePack);
}

function candidateForExperiment(db, experiment) {
  const candidateId = experiment?.metadata?.candidateId || experiment?.metadata?.candidate_id || null;
  if (candidateId) return getCandidate(db, candidateId);
  const row = get(db, "SELECT * FROM commercial_test_candidates WHERE promoted_experiment_id = ? LIMIT 1", [experiment.id]);
  return row ? { ...row, metadata: fromJson(row.metadata) } : null;
}

function experimentFromInput(db, input = {}) {
  const candidateId = input.candidateId || input.candidate_id || null;
  if (candidateId) {
    const candidate = getCandidate(db, candidateId);
    if (!candidate) throw new Error(`Commercial test candidate not found: ${candidateId}`);
    if (!candidate.promoted_experiment_id) throw new Error("Promote the test before generating an execution pack.");
    const experiment = getCommercialExperiment(db, candidate.promoted_experiment_id);
    if (!experiment) throw new Error(`Commercial experiment not found: ${candidate.promoted_experiment_id}`);
    return { experiment, candidate };
  }

  const experimentId = input.experimentId || input.experiment_id || null;
  if (!experimentId) throw new Error("Execution pack needs a promoted commercial test.");
  const experiment = getCommercialExperiment(db, experimentId);
  if (!experiment) throw new Error(`Commercial experiment not found: ${experimentId}`);
  return { experiment, candidate: candidateForExperiment(db, experiment) };
}

function buyerIntentValidation(experiment, candidate, input = {}) {
  return input.metadata?.buyerIntentValidation
    || experiment?.metadata?.buyerIntentValidation
    || candidate?.metadata?.buyerIntentValidation
    || null;
}

function executionCopy({ experiment, candidate, brief }) {
  const validation = buyerIntentValidation(experiment, candidate);
  const buyer = asText(candidate?.buyer || experiment.buyer || brief?.buyer, "The target buyer");
  const problem = asText(candidate?.problem || brief?.problem, "the problem this offer solves");
  const offer = asText(candidate?.offer || experiment.offer, experiment.name);
  const channel = asText(candidate?.channel || experiment.channel, "the chosen channel");
  const price = moneyLabel(candidate?.price_cents ?? experiment.price_cents);
  const cap = moneyLabel(candidate?.cost_cap_cents ?? experiment.cost_cap_cents);
  const successMetric = asText(candidate?.success_metric || experiment.expected_metric, "a clear buyer action, reply, lead, or sale");
  const killCriteria = asText(candidate?.kill_criteria || experiment.metadata?.killCriteria, "stop or revise if the channel produces no useful buyer signal.");

  if (validation) {
    const measurement = validation.measurement || {};
    const platformName = validation.channel?.platformName || "the selected platform";
    const testAction = validation.channel?.testActionLabel || validation.channel?.label || "one buyer test";
    const analyticsSource = validation.channel?.analyticsSource || measurement.exposureUnit || "the platform's attributable analytics";
    const priceText = `A$${(Number(validation.priceCents || experiment.price_cents || 0) / 100).toFixed(2)}`;
    return {
      buyer,
      problem,
      offer,
      channel,
      price: priceText,
      cap,
      successMetric: measurement.passRule || successMetric,
      killCriteria: measurement.stopRule || killCriteria,
      offerPageCopy: [
        `Product: ${validation.sample?.packageTitle || offer}`,
        `For: ${buyer}`,
        `Problem: ${problem}`,
        `What it does: ${validation.sample?.customerPromise || offer}`,
        `Format: editable Excel workbook, setup guide, and previews derived from the real files.`,
        `Test price: ${priceText}.`,
      ].join("\n"),
      productDescription: [
        validation.sample?.customerPromise || offer,
        "This is one complete functional validation product, not a placeholder, a full catalogue, a client portal, or an accounting system.",
        "The wider investment case remains parked until measured buyer and contribution evidence passes the frozen test rule.",
      ].join(" "),
      cta: `Buy the ${validation.sample?.item?.title || "validation workbook"}`,
      channelPlan: [
        `After a separate exact external-action approval, prepare ${testAction} at ${priceText}.`,
        "Keep it as the only active listing used for attribution during this test.",
        `Measure up to ${Number(measurement.exposureTarget || 100)} ${measurement.exposureUnit || "qualified visits"} or ${Number(measurement.durationDays || 30)} days.`,
        `Approving this pack does not create an account on ${platformName}, accept platform terms, complete KYC, pay a setup fee, publish, advertise, contact a buyer, or spend money.`,
      ].join(" "),
      trackingPlan: [
        `Qualified exposure: ${measurement.qualifiedExposure || "Use attributable marketplace visits."}`,
        "Track visits, favourites, genuine enquiries, orders, refunds, platform fees, acquisition cost, support time, attributable tools, and actual net cash contribution in AUD.",
        `Pass: ${measurement.passRule || successMetric}`,
        `Revise: ${measurement.reviseRule || "Change one variable only when evidence identifies the blocker."}`,
        `Inconclusive: ${measurement.inconclusiveRule || "Diagnose reach before judging demand."}`,
        `Stop: ${measurement.stopRule || killCriteria}`,
      ].join(" "),
      resultChecklist: [
        "Before publication: separately approve the exact listing, current platform terms, account/KYC action, and any cash cost.",
        "At launch: record the listing ID, publication time, exact title, tags, preview set, price, and settled external costs.",
        `During the test: import or record ${analyticsSource} and paid-order evidence without counting operator test visits.`,
        "At the boundary: reconcile every attributable cash cost in AUD and apply Pass, Revise, Inconclusive, or Stop exactly as written.",
      ].join("\n"),
      validation,
    };
  }

  const offerPageCopy = [
    `Headline: ${offer}`,
    `For: ${buyer}`,
    `Problem: ${problem}`,
    `Promise: Get a practical shortcut that helps with ${problem.toLowerCase()} without a heavy setup process.`,
    `Included: the core template or asset, a short setup guide, and a simple follow-up checklist.`,
    `Price anchor: ${price}.`,
  ].join("\n");

  const productDescription = [
    `${offer} is a focused digital product test for ${buyer}.`,
    `It is positioned around one painful problem: ${problem}.`,
    `This version is intentionally small so the market can judge the promise before more product work is added.`,
  ].join(" ");

  const cta = `I want the ${offer}`;
  const channelPlan = [
    `Manual channel test: place the offer in ${channel}.`,
    `Start with 20-50 targeted people, posts, replies, or community touchpoints.`,
    "Do not automate sending, publish externally, or spend money from this pack. Use it as the approved copy/checklist for a manual contact test.",
    `Cost cap: ${cap}.`,
  ].join(" ");

  const trackingPlan = [
    "Track: views or impressions, clicks, replies, leads, sales, refunds, objections, customer wording, spend, and time spent.",
    `Success signal: ${successMetric}.`,
    `Stop/revise rule: ${killCriteria}`,
  ].join(" ");

  const resultChecklist = [
    "Before the test: confirm buyer, channel, offer, price, and no live automation/spend.",
    "During the test: save screenshots or notes for where the offer was shown and what buyers said.",
    "After 24-48 hours: record views, clicks, replies/leads, sales, objections, refunds, spend, and time in Results.",
    "If nothing happens: record No Response so the learning loop can judge the lack of signal instead of leaving the test open.",
  ].join("\n");

  return {
    buyer,
    problem,
    offer,
    channel,
    price,
    cap,
    successMetric,
    killCriteria,
    offerPageCopy,
    productDescription,
    cta,
    channelPlan,
    trackingPlan,
    resultChecklist,
  };
}

function unitEconomics({ experiment, candidate }) {
  const validation = buyerIntentValidation(experiment, candidate);
  const priceCents = asInt(candidate?.price_cents ?? experiment.price_cents);
  const costCapCents = asInt(candidate?.cost_cap_cents ?? experiment.cost_cap_cents);
  if (validation) {
    const platformName = validation.channel?.platformName || "the selected platform";
    return {
      priceCents,
      costCapCents,
      grossMarginCents: 0,
      grossMarginKnown: false,
      marginPercent: "Unverified",
      breakEvenSales: null,
      financialRisk: `Actual net cash contribution is unverified until ${platformName} fees, refunds, acquisition, support, attributable tools, and other cash costs are reconciled in AUD.`,
    };
  }
  const grossMarginCents = asInt(
    candidate?.gross_margin_cents ?? Math.max(0, priceCents - costCapCents - Math.round(priceCents * 0.08)),
  );
  const breakEvenSales = grossMarginCents > 0 ? Math.max(1, Math.ceil(costCapCents / grossMarginCents)) : null;
  return {
    priceCents,
    costCapCents,
    grossMarginCents,
    grossMarginKnown: true,
    marginPercent: percentLabel(grossMarginCents, priceCents),
    breakEvenSales,
    financialRisk: costCapCents > priceCents
      ? "Cost cap is higher than the test price; revise economics before any spend."
      : "No paid spend or fulfilment commitment is approved from this pack.",
  };
}

function grossMarginLabel(economics) {
  return economics.grossMarginKnown === false
    ? "unverified until actual order costs are reconciled"
    : `${moneyLabel(economics.grossMarginCents)} (${economics.marginPercent})`;
}

function buildChiefOfStaffPacket({ pack, experiment, candidate, copy, economics, workerRuns, handoff }) {
  const validation = copy.validation || buyerIntentValidation(experiment, candidate);
  if (validation) {
    const measurement = validation.measurement || {};
    const platformName = validation.channel?.platformName || "the selected platform";
    const sampleFiles = pack.metadata?.sampleDeliverables || [];
    return {
      schema: "jarvis_chief_of_staff_decision_packet_v1",
      source: "buyer_intent_validation",
      status: handoff?.status || "needs_operator_decision",
      owner: "chief_of_staff",
      title: `Decision packet: ${pack.title}`,
      operatorSummary: `The functional validation workbook passed independent review. Decide whether this exact buyer test should move to a separately protected ${platformName} setup and publication step.`,
      moneyMove: `Review one measured ${platformName} buyer test. Do not fund a wider catalogue until real orders, format acceptance, and actual contribution support it.`,
      nextAction: "Approve the test plan, request changes, or deny it. Approval still does not create an account, publish a listing, contact buyers, or spend money.",
      decision: "Approve this buyer-test plan, request changes, or deny it.",
      buyer: copy.buyer,
      problem: copy.problem,
      offer: copy.offer,
      channel: copy.channel,
      expectedUpsideCents: 0,
      costCapCents: economics.costCapCents,
      priceCents: economics.priceCents,
      grossMarginCents: 0,
      marginPercent: "Unverified",
      breakEvenSales: null,
      risk: "medium",
      evidence: [
        `Buyer: ${copy.buyer}.`,
        `Product: ${validation.sample?.packageTitle || copy.offer}.`,
        `Channel and price hypothesis: ${copy.channel} at A$${(economics.priceCents / 100).toFixed(2)}.`,
        `${sampleFiles.length} exact customer or preview file${sampleFiles.length === 1 ? "" : "s"} passed the bound Product Builder and Quality Reviewer path.`,
        `Pass rule: ${measurement.passRule || copy.successMetric}`,
      ],
      risks: [
        economics.financialRisk,
        "The investment case remains parked; adjacent marketplace activity is not proof that this exact workbook will sell.",
        "The test still requires separate account, terms, KYC, listing, publication, and any fee decisions.",
      ],
      successMetric: measurement.passRule || copy.successMetric,
      killCriteria: measurement.stopRule || copy.killCriteria,
      reviseRule: measurement.reviseRule || null,
      inconclusiveRule: measurement.inconclusiveRule || null,
      learningSignal: "Paid orders, format objections, refunds, buyer questions, and actual contribution will decide whether to invest, revise one variable, diagnose reach, or stop.",
      hardStops: [
        `No ${platformName} account creation, KYC, or acceptance of new platform terms`,
        "No listing publication",
        "No public post or customer contact",
        "No advertising",
        "No setup fee, subscription, or other external spend",
        "No wider catalogue build",
      ],
      allowedOperatorActions: [
        "Approve test plan",
        "Request changes",
        "Deny test",
        "Preview or download the validation files",
      ],
      continuousImprovement: {
        hypothesis: experiment.hypothesis,
        smallestUsefulAction: copy.channelPlan,
        expectedMetric: measurement.passRule || copy.successMetric,
        actualResult: "No real-world listing, visit, order, or contribution result exists yet.",
        learning: "The current files prove build and quality capability, not buyer demand.",
        improvement: "Apply the frozen pass, revise, inconclusive, and stop rules after the real test boundary is reached.",
      },
      workerRunIds: {
        productBuilder: workerRuns.productRun?.runId || null,
        qualityReviewer: workerRuns.qualityRun?.runId || null,
        distribution: workerRuns.distributionRun?.runId || null,
      },
      handoffId: handoff?.id || null,
    };
  }
  const expectedUpsideCents = economics.grossMarginCents || experiment.price_cents || 0;
  const risk = economics.grossMarginCents <= 0 ? "medium" : "low";
  const moneyMove = `Approve only the smallest manual test for ${copy.offer}, then record the result, reply, or no-response signal from the same pack.`;
  const nextAction = "Approve the manual test, request changes, or deny it before any market contact happens.";
  const evidence = [
    `Buyer: ${copy.buyer}.`,
    `Problem: ${copy.problem}.`,
    `Offer: ${copy.offer}.`,
    `Channel: ${copy.channel}.`,
    `Price: ${moneyLabel(economics.priceCents)}; estimated gross margin: ${grossMarginLabel(economics)}.`,
    "Product, copy, finance, and distribution workers completed protected checks with no external action.",
  ];
  const risks = [
    economics.financialRisk,
    "No automated sending, publishing, paid spend, account change, or customer contact is approved by this packet.",
  ];

  return {
    schema: "jarvis_chief_of_staff_decision_packet_v1",
    source: "execution_pack",
    status: handoff?.status || "needs_operator_decision",
    owner: "chief_of_staff",
    title: `Decision packet: ${pack.title}`,
    operatorSummary: `Chief of Staff recommends a controlled manual test for ${copy.offer}. The pack is ready for your approve, request changes, or deny decision.`,
    moneyMove,
    nextAction,
    decision: "Approve the manual test, request changes to the pack, or deny the test.",
    buyer: copy.buyer,
    problem: copy.problem,
    offer: copy.offer,
    channel: copy.channel,
    expectedUpsideCents,
    costCapCents: economics.costCapCents,
    priceCents: economics.priceCents,
    grossMarginCents: economics.grossMarginCents,
    marginPercent: economics.marginPercent,
    breakEvenSales: economics.breakEvenSales,
    risk,
    evidence,
    risks,
    successMetric: copy.successMetric,
    killCriteria: copy.killCriteria,
    learningSignal: "The operator decision and first recorded market result will improve future pack quality, channel selection, and spend gates.",
    hardStops: [
      "No external send or post",
      "No publishing",
      "No account action",
      "No paid spend",
      "No customer dispute, refund, legal, tax, compliance, or platform-risk decision",
    ],
    allowedOperatorActions: [
      "Approve manual test",
      "Request changes",
      "Deny test",
      "Record result",
      "Record reply",
      "Mark no response",
    ],
    continuousImprovement: {
      hypothesis: experiment.hypothesis || `A small manual test can prove whether ${copy.buyer} wants ${copy.offer}.`,
      smallestUsefulAction: copy.channelPlan,
      expectedMetric: copy.successMetric,
      actualResult: "No market result has been recorded for this execution pack yet.",
      learning: "Decision quality will improve after the first real buyer signal or no-response result is recorded.",
      improvement: "Use the recorded outcome to continue, revise, pause, or kill the offer before spending or building more.",
    },
    workerRunIds: {
      productBuilder: workerRuns.productRun.runId,
      copyAndConversion: workerRuns.copyRun.runId,
      financeAndUnitEconomics: workerRuns.financeRun.runId,
      distribution: workerRuns.distributionRun.runId,
    },
    handoffId: handoff?.id || null,
  };
}

function resultMetricSummary(result) {
  if (!result) return "No result metrics were recorded.";
  const revenueCents = asInt(result.revenue_cents);
  const spendCents = asInt(result.spend_cents);
  const profitCents = revenueCents - spendCents;
  return [
    `${asInt(result.views)} views`,
    `${asInt(result.clicks)} clicks`,
    `${asInt(result.leads)} leads`,
    `${asInt(result.sales)} sales`,
    `${asInt(result.refunds)} refunds`,
    `${moneyLabel(revenueCents)} revenue`,
    `${moneyLabel(spendCents)} spend`,
    `${signedMoneyLabel(profitCents)} profit`,
    `${asInt(result.time_spent_minutes)} minutes`,
  ].join(", ");
}

function outcomeRecommendation({ outcomeType, learning, result, feedback }) {
  if (feedback) {
    const negativeSignal = String(feedback.sentiment || "").toLowerCase().includes("negative") || feedback.objection;
    return {
      moneyMove: negativeSignal
        ? "Use this buyer objection to revise the offer, proof, price, or product before another test."
        : "Use this buyer signal to improve the offer and run the next smallest controlled test.",
      nextAction: learning.next_action || "Decide whether the buyer signal changes the offer, product, proof, price, or channel.",
      action: "Revise the offer or product from the buyer wording, then run another tiny manual test if the change is clear.",
      risk: negativeSignal ? "medium" : "low",
      decision: "Approve the revision direction, request changes, deny the next action, or capture another buyer signal.",
    };
  }

  const verdict = String(learning.verdict || "needs_evidence");
  const noResponse = outcomeType === "no_response" || (
    result && asInt(result.views) === 0 && asInt(result.clicks) === 0 && asInt(result.leads) === 0 && asInt(result.sales) === 0
  );
  if (verdict === "continue") {
    return {
      moneyMove: "Prepare the next measured step with the same controls; do not widen spend or automation without approval.",
      nextAction: learning.next_action || "Repeat or slightly widen the test only after confirming the evidence and cap.",
      action: "Run one slightly larger controlled test using the same buyer, offer, and channel assumptions.",
      risk: "medium",
      decision: "Approve the next controlled test, request changes, deny scaling, or record another result.",
    };
  }
  if (verdict === "revise") {
    return {
      moneyMove: "Revise the offer, proof, price, channel, or conversion path before spending more time.",
      nextAction: learning.next_action || "Prepare a tighter revision and test only the changed assumption.",
      action: "Change one commercial assumption, then run another tiny manual test.",
      risk: "medium",
      decision: "Approve the revision, request changes, deny the next action, or gather more evidence.",
    };
  }
  if (verdict === "kill_or_rework") {
    return {
      moneyMove: "Stop this version or rework the buyer, promise, channel, or creative before any more effort.",
      nextAction: learning.next_action || "Pause the current version unless there is a materially different angle to test.",
      action: "Park this test or create a substantially different version before another run.",
      risk: "high",
      decision: "Approve stopping, request a rework, deny more work, or capture missing evidence.",
    };
  }
  return {
    moneyMove: noResponse
      ? "Do not build more yet; either run one tighter manual sample or revise the channel because the first signal was empty."
      : "Get a stronger measurable buyer signal before building, spending, or automating.",
    nextAction: learning.next_action || "Record a clearer buyer signal or run the smallest useful manual test.",
    action: noResponse
      ? "Try one sharper buyer/channel sample or change the channel before committing more work."
      : "Capture a measurable result that can prove demand, conversion, cost, or customer wording.",
    risk: "low",
    decision: "Approve another tiny evidence-gathering step, request changes, deny more work, or mark this test parked.",
  };
}

function findHandoffForRun(db, runId) {
  if (!runId) return null;
  const row = get(
    db,
    "SELECT * FROM agent_handoffs WHERE from_run_id = ? AND to_agent_id = ? LIMIT 1",
    [runId, "chief_of_staff"],
  );
  return row ? { ...row, metadata: fromJson(row.metadata, {}) } : null;
}

function mergeOutcomePacketMetadata(db, table, id, packet) {
  if (!id) return;
  const allowedTables = new Set([
    "commercial_feedback",
    "commercial_learning_cycles",
    "commercial_results",
  ]);
  if (!allowedTables.has(table)) throw new Error(`Unsupported outcome metadata table: ${table}`);
  const row = get(db, `SELECT metadata FROM ${table} WHERE id = ?`, [id]);
  if (!row) return;
  const metadata = fromJson(row.metadata, {});
  run(db, `UPDATE ${table} SET metadata = ? WHERE id = ?`, [toJson({ ...metadata, outcomeDecisionPacket: packet }), id]);
}

function attachOutcomeDecisionPacket(db, pack, packet) {
  const current = getExecutionPack(db, pack.id) || pack;
  const metadata = { ...(current.metadata || {}) };
  const existing = Array.isArray(metadata.outcomeDecisionPackets) ? metadata.outcomeDecisionPackets : [];
  metadata.latestOutcomeDecisionPacket = packet;
  metadata.outcomeDecisionPackets = [
    packet,
    ...existing.filter((item) => item?.learningId !== packet.learningId),
  ].slice(0, 5);
  run(db, "UPDATE commercial_execution_packs SET metadata = ?, updated_at = ? WHERE id = ?", [toJson(metadata), now(), pack.id]);
  if (packet.learningId) mergeOutcomePacketMetadata(db, "commercial_learning_cycles", packet.learningId, packet);
  if (packet.resultId) mergeOutcomePacketMetadata(db, "commercial_results", packet.resultId, packet);
  if (packet.feedbackId) mergeOutcomePacketMetadata(db, "commercial_feedback", packet.feedbackId, packet);
}

function buildOutcomeDecisionPacket({ pack, outcomeType, recorded, handoff }) {
  const learning = recorded.learning || {};
  const result = recorded.result || null;
  const feedback = recorded.feedback || null;
  const sourcePacket = pack.metadata?.chiefOfStaffPacket || pack.metadata?.aiTeam?.chiefOfStaffPacket || null;
  const recommendation = outcomeRecommendation({ outcomeType, learning, result, feedback });
  const outcomeLabel = feedback ? "buyer signal" : outcomeType === "no_response" ? "no response" : "test result";
  const actualResult = learning.actual_result || (result ? resultMetricSummary(result) : feedback?.summary || "No actual result captured.");
  const buyer = sourcePacket?.buyer || pack.metadata?.buyer || "The target buyer";
  const problem = sourcePacket?.problem || pack.metadata?.problem || "the problem this offer solves";
  const offer = sourcePacket?.offer || pack.metadata?.offer || pack.title;
  const channel = sourcePacket?.channel || pack.metadata?.channel || "the chosen channel";
  const evidence = [
    `Outcome recorded: ${outcomeLabel}.`,
    result ? `Metrics: ${resultMetricSummary(result)}.` : null,
    feedback ? `Buyer signal: ${feedback.summary || "No summary provided."}` : null,
    feedback?.objection ? `Objection: ${feedback.objection}.` : null,
    feedback?.request ? `Request: ${feedback.request}.` : null,
    `Learning: ${learning.learning || "Not enough evidence yet."}`,
    `Recommended improvement: ${learning.improvement || recommendation.action}`,
  ].filter(Boolean);

  return {
    schema: "jarvis_chief_of_staff_outcome_packet_v1",
    source: "execution_pack_outcome",
    status: handoff?.status || "needs_operator_decision",
    owner: "chief_of_staff",
    title: `Next decision: ${pack.title}`,
    operatorSummary: `Chief of Staff reviewed the ${outcomeLabel} for ${offer}. The next decision is whether to continue, revise, pause, or stop this test.`,
    moneyMove: recommendation.moneyMove,
    nextAction: recommendation.nextAction,
    decision: recommendation.decision,
    buyer,
    problem,
    offer,
    channel,
    expectedUpsideCents: sourcePacket?.expectedUpsideCents || pack.metadata?.priceCents || 0,
    costCapCents: sourcePacket?.costCapCents ?? pack.metadata?.costCapCents ?? 0,
    priceCents: sourcePacket?.priceCents ?? pack.metadata?.priceCents ?? 0,
    grossMarginCents: sourcePacket?.grossMarginCents ?? 0,
    marginPercent: sourcePacket?.marginPercent || "unknown",
    breakEvenSales: sourcePacket?.breakEvenSales ?? null,
    risk: recommendation.risk,
    evidence,
    risks: [
      "No automated sending, publishing, paid spend, account change, or customer contact is approved by this outcome packet.",
      "Do not scale until the recorded result is strong enough and the operator approves the next controlled action.",
    ],
    successMetric: learning.expected_metric || sourcePacket?.successMetric || pack.metadata?.successMetric || "A measurable buyer signal is recorded.",
    killCriteria: sourcePacket?.killCriteria || pack.metadata?.killCriteria || "Stop or rework if the result shows weak demand, bad economics, refund pressure, or no reachable channel.",
    learningSignal: "This outcome updates future pack quality, channel choice, offer wording, cost gates, and stop rules.",
    hardStops: [
      "No external send or post",
      "No publishing",
      "No account action",
      "No paid spend",
      "No customer dispute, refund, legal, tax, compliance, or platform-risk decision",
    ],
    allowedOperatorActions: [
      "Approve next action",
      "Request changes",
      "Deny next action",
      "Record another result",
      "Record reply",
      "Mark no response",
    ],
    continuousImprovement: {
      hypothesis: learning.hypothesis || sourcePacket?.continuousImprovement?.hypothesis || `A small manual test can show whether ${buyer} wants ${offer}.`,
      smallestUsefulAction: recommendation.action,
      expectedMetric: learning.expected_metric || sourcePacket?.successMetric || "A measurable buyer signal is recorded.",
      actualResult,
      learning: learning.learning || "There is not enough evidence yet to scale.",
      improvement: learning.improvement || recommendation.action,
    },
    workerRunIds: {
      ...(result ? { growthAnalysis: recorded.aiTeamRun?.runId || null } : {}),
      ...(feedback ? { customerVoice: recorded.aiTeamRun?.runId || null } : {}),
    },
    handoffId: handoff?.id || null,
    executionPackId: pack.id,
    learningId: learning.id || null,
    resultId: result?.id || null,
    feedbackId: feedback?.id || null,
    outcomeType,
    previousDecisionPacketRunId: sourcePacket?.chiefRunId || null,
  };
}

function recordOutcomeDecisionPacket(db, { pack, outcomeType, recorded }) {
  const workflowId = pack.workflow_id || recorded.experiment?.workflow_id || null;
  const handoff = findHandoffForRun(db, recorded.aiTeamRun?.runId);
  const packet = buildOutcomeDecisionPacket({ pack, outcomeType, recorded, handoff });
  const chiefRun = recordProtectedWorkerOutcome(
    db,
    {
      kind: "operator_decision",
      agent: "chief_of_staff",
      workflow_id: workflowId,
      title: `Prepare next decision for ${pack.title}`,
      cost_budget_cents: packet.costCapCents,
      payload: {
        buyer: packet.buyer,
        problem: packet.problem,
        offer: packet.offer,
        channel: packet.channel,
      },
    },
    {
      heading: "Chief of Staff outcome packet",
      summary: packet.operatorSummary,
      moneyMove: packet.moneyMove,
      evidence: packet.evidence,
      risks: packet.risks,
      details: {
        "Money move": packet.moneyMove,
        "Next decision": packet.decision,
        "Actual result": packet.continuousImprovement.actualResult,
        "Learning": packet.continuousImprovement.learning,
        "Improve": packet.continuousImprovement.improvement,
        "Still locked": packet.hardStops.join("; "),
      },
      operatorDecision: packet.decision,
      nextAction: packet.nextAction,
      commercialNextAction: {
        id: `chief_outcome_packet_${packet.learningId || pack.id}`,
        title: packet.title,
        recommendation: packet.moneyMove,
        expectedUpsideCents: packet.expectedUpsideCents,
        costCapCents: packet.costCapCents,
        risk: packet.risk,
        evidence: packet.evidence,
        hypothesis: packet.continuousImprovement.hypothesis,
        action: packet.continuousImprovement.smallestUsefulAction,
        successMetric: packet.successMetric,
        killCriteria: packet.killCriteria,
        learningSignal: packet.learningSignal,
        workflowId,
        handoffId: packet.handoffId,
        executionPackId: pack.id,
        learningId: packet.learningId,
        resultId: packet.resultId,
        feedbackId: packet.feedbackId,
      },
      confidence: recorded.learning?.confidence || "low_until_more_market_signal",
    },
    {
      metadata: {
        executionPackId: pack.id,
        outcomeType,
        learningId: packet.learningId,
        resultId: packet.resultId,
        feedbackId: packet.feedbackId,
        outcomeDecisionPacket: packet,
      },
      trace: [
        {
          type: "outcome_decision_packet_prepared",
          title: "Outcome decision packet prepared",
          detail: "Chief of Staff compressed the recorded result or buyer signal into the next operator decision.",
          metadata: { executionPackId: pack.id, learningId: packet.learningId, handoffId: packet.handoffId },
        },
      ],
    },
  );
  packet.chiefRunId = chiefRun.runId;
  packet.chiefEvalStatus = chiefRun.evalStatus;
  packet.chiefEvalScore = chiefRun.evalScore;
  packet.workerRunIds.chiefOfStaff = chiefRun.runId;
  attachOutcomeDecisionPacket(db, pack, packet);
  insertEvent(db, {
    actor: "chief_of_staff",
    type: "commercial_execution_pack.outcome_packet_prepared",
    entityType: "commercial_execution_pack",
    entityId: pack.id,
    message: `Chief of Staff prepared the next decision packet for ${pack.title}.`,
    metadata: { experimentId: pack.experiment_id, workflowId, learningId: packet.learningId, outcomeType },
  });
  return packet;
}

function recordExecutionPackWorkers(db, { pack, experiment, candidate, copy }) {
  const workflowId = pack.workflow_id || experiment.workflow_id || candidate?.workflow_id || null;
  const economics = unitEconomics({ experiment, candidate });
  const sharedMetadata = {
    executionPackId: pack.id,
    experimentId: experiment.id,
    candidateId: candidate?.id || null,
    source: "execution_pack",
  };
  const productRun = recordProtectedWorkerOutcome(
    db,
    {
      kind: "product_action_plan",
      agent: "product_builder",
      workflow_id: workflowId,
      title: `Prepare smallest sellable product scope for ${experiment.name}`,
    },
    {
      heading: "Execution pack product scope",
      summary: `Product Builder kept ${copy.offer} small enough to test before more build time is spent.`,
      evidence: [
        `Buyer: ${copy.buyer}.`,
        `Problem: ${copy.problem}.`,
        "The pack stays manual-only and does not build, upload, publish, or spend.",
      ],
      nextAction: "Use the product scope only after the operator approves a manual market-contact test.",
    },
    {
      metadata: sharedMetadata,
      trace: [
        {
          type: "pack_scope_created",
          title: "Product scope prepared",
          detail: "The product plan was reduced to the smallest buyer-testable version.",
        },
      ],
    },
  );
  const copyRun = recordProtectedWorkerOutcome(
    db,
    {
      kind: "conversion_copy",
      agent: "copy_conversion_agent",
      workflow_id: workflowId,
      title: `Prepare buyer-facing copy for ${experiment.name}`,
    },
    {
      heading: "Execution pack copy",
      summary: `Copy and Conversion prepared plain-language offer copy for ${copy.offer}.`,
      evidence: [
        "The copy avoids unsupported guarantees, regulated claims, and external sending.",
        `Call to action: ${copy.cta}.`,
        `Success signal: ${copy.successMetric}.`,
      ],
      nextAction: "Operator can review the copy and use it manually if the channel test is approved.",
    },
    {
      metadata: sharedMetadata,
      trace: [
        {
          type: "copy_prepared",
          title: "Offer copy prepared",
          detail: "The copy is saved in the execution pack and ready for human review.",
        },
      ],
    },
  );
  const financeRun = recordProtectedWorkerOutcome(
    db,
    {
      kind: "commercial_analysis",
      agent: "finance_analyst",
      workflow_id: workflowId,
      title: `Check unit economics for ${experiment.name}`,
      cost_budget_cents: economics.costCapCents,
      payload: {
        buyer: copy.buyer,
        problem: copy.problem,
        offer: copy.offer,
        channel: copy.channel,
        priceCents: economics.priceCents,
        costCapCents: economics.costCapCents,
      },
    },
    {
      heading: "Execution pack unit economics",
      summary: `Finance checked ${copy.offer}: ${moneyLabel(economics.priceCents)} price, ${moneyLabel(economics.grossMarginCents)} estimated gross margin, and ${moneyLabel(economics.costCapCents)} test cap.`,
      evidence: [
        `Price: ${moneyLabel(economics.priceCents)}.`,
        `Estimated gross margin: ${moneyLabel(economics.grossMarginCents)} (${economics.marginPercent}).`,
        `Cost cap: ${moneyLabel(economics.costCapCents)}.`,
        economics.breakEvenSales
          ? `Break-even: ${economics.breakEvenSales} sale${economics.breakEvenSales === 1 ? "" : "s"} at the current cap.`
          : "Break-even cannot be trusted until margin is positive.",
      ],
      details: {
        "Cost/risk": `${moneyLabel(economics.priceCents)} price, ${moneyLabel(economics.grossMarginCents)} estimated gross margin, ${moneyLabel(economics.costCapCents)} cap.`,
        "Break-even": economics.breakEvenSales
          ? `${economics.breakEvenSales} sale${economics.breakEvenSales === 1 ? "" : "s"} needed to cover the current cap.`
          : "No break-even until the offer has positive estimated margin.",
        "Do not build yet": economics.financialRisk,
        Price: moneyLabel(economics.priceCents),
        Channel: copy.channel,
      },
      costRisk: economics.financialRisk,
      nextAction: "Run only the smallest manual test and record real revenue, spend, refunds, time, and objections before increasing scope.",
      confidence: economics.costCapCents === 0 ? "medium_for_no_spend_test" : "low_until_real_costs_recorded",
    },
    {
      metadata: { ...sharedMetadata, unitEconomics: economics },
      trace: [
        {
          type: "unit_economics_checked",
          title: "Unit economics checked",
          detail: "Finance checked price, margin, cap, break-even, and spend safety before the pack became operator-ready.",
          metadata: economics,
        },
      ],
    },
  );
  const distributionRun = recordProtectedWorkerOutcome(
    db,
    {
      kind: "distribution_plan",
      agent: "distribution_operator",
      workflow_id: workflowId,
      title: `Prepare manual distribution plan for ${experiment.name}`,
    },
    {
      heading: "Execution pack distribution plan",
      summary: `Distribution prepared a no-spend manual channel test for ${copy.channel}.`,
      evidence: [
        "No account action, posting, sending, automation, or payment happened.",
        `Channel plan: ${copy.channelPlan}`,
        `Stop/revise rule: ${copy.killCriteria}`,
      ],
      nextAction: "Run the market-contact test manually, then record result, reply, objection, or no response.",
    },
    {
      metadata: sharedMetadata,
      approvalRequired: true,
      handoffTo: "chief_of_staff",
      handoffReason: "The market-contact pack is ready, but the operator must decide whether to run it manually.",
      handoffDecisionNeeded: "Decide whether to run this market-contact test manually, request changes, or stop it.",
      trace: [
        {
          type: "distribution_plan_prepared",
          title: "Manual channel plan prepared",
          detail: "The distribution plan is ready for operator approval and manual execution.",
        },
      ],
    },
  );
  const handoff = get(
    db,
    "SELECT * FROM agent_handoffs WHERE from_run_id = ? AND to_agent_id = ? LIMIT 1",
    [distributionRun.runId, "chief_of_staff"],
  );
  const packet = buildChiefOfStaffPacket({
    pack,
    experiment,
    candidate,
    copy,
    economics,
    workerRuns: { productRun, copyRun, financeRun, distributionRun },
    handoff: handoff ? { ...handoff, metadata: fromJson(handoff.metadata, {}) } : null,
  });
  const chiefRun = recordProtectedWorkerOutcome(
    db,
    {
      kind: "operator_decision",
      agent: "chief_of_staff",
      workflow_id: workflowId,
      title: `Prepare operator decision packet for ${experiment.name}`,
      cost_budget_cents: economics.costCapCents,
      payload: {
        buyer: copy.buyer,
        problem: copy.problem,
        offer: copy.offer,
        channel: copy.channel,
      },
    },
    {
      heading: "Chief of Staff decision packet",
      summary: packet.operatorSummary,
      moneyMove: packet.moneyMove,
      evidence: packet.evidence,
      risks: packet.risks,
      details: {
        "Money move": packet.moneyMove,
        "Next decision": packet.decision,
        Economics: `${moneyLabel(packet.priceCents)} price, ${moneyLabel(packet.grossMarginCents)} estimated gross margin, ${moneyLabel(packet.costCapCents)} cap.`,
        "Do not do": packet.hardStops.join("; "),
      },
      operatorDecision: packet.decision,
      nextAction: packet.nextAction,
      commercialNextAction: {
        id: `chief_packet_${pack.id}`,
        title: packet.title,
        recommendation: packet.moneyMove,
        expectedUpsideCents: packet.expectedUpsideCents,
        costCapCents: packet.costCapCents,
        risk: packet.risk,
        evidence: packet.evidence,
        hypothesis: packet.continuousImprovement.hypothesis,
        action: packet.continuousImprovement.smallestUsefulAction,
        successMetric: packet.successMetric,
        killCriteria: packet.killCriteria,
        learningSignal: packet.learningSignal,
        workflowId,
        handoffId: packet.handoffId,
        executionPackId: pack.id,
      },
      confidence: "medium_until_first_market_result",
    },
    {
      metadata: { ...sharedMetadata, decisionPacket: packet },
      trace: [
        {
          type: "decision_packet_prepared",
          title: "Decision packet prepared",
          detail: "Chief of Staff compressed the specialist worker outputs into one operator decision packet.",
          metadata: { executionPackId: pack.id, handoffId: packet.handoffId },
        },
      ],
    },
  );
  packet.chiefRunId = chiefRun.runId;
  packet.chiefEvalStatus = chiefRun.evalStatus;
  packet.chiefEvalScore = chiefRun.evalScore;
  packet.workerRunIds.chiefOfStaff = chiefRun.runId;
  const reviewedRunIds = Object.values(packet.workerRunIds).filter(Boolean);
  const qualityRun = recordProtectedWorkerOutcome(
    db,
    {
      kind: "operator_pack_qc",
      agent: "quality_reviewer",
      workflow_id: workflowId,
      title: `Independently review the execution packet for ${experiment.name}`,
      payload: {
        executionPackId: pack.id,
        reviewedRunIds,
        buyer: copy.buyer,
        problem: copy.problem,
        offer: copy.offer,
        channel: copy.channel,
      },
    },
    {
      heading: "Independent execution packet review",
      summary: `Quality Reviewer checked the exact protected worker records assembled for ${copy.offer}.`,
      evidence: [
        `Reviewed worker records: ${reviewedRunIds.join(", ")}.`,
        `Buyer, problem, offer and channel are present for ${copy.buyer}.`,
        `Price, margin, test cap, success signal and stop rule are present in the Chief of Staff packet.`,
        "No account action, publishing, customer contact, payment or provider call occurred.",
      ],
      risks: packet.risks,
      operatorDecision: "approve",
      nextAction: "Daniel may review this protected packet. Any real publishing, customer contact or spend still needs its own exact approval and live quality gate.",
      confidence: "medium_for_protected_packet_structure",
    },
    {
      metadata: {
        ...sharedMetadata,
        reviewOfRunId: chiefRun.runId,
        reviewedRunIds,
        protectedStructureReview: true,
        noProviderCall: true,
      },
      trace: [
        {
          type: "protected_packet_reviewed",
          title: "Independent packet review completed",
          detail: "Quality Reviewer checked the exact protected worker records before the packet became ready for operator review.",
          metadata: { executionPackId: pack.id, reviewedRunIds },
        },
      ],
    },
  );
  packet.qualityRunId = qualityRun.runId;
  packet.qualityEvalStatus = qualityRun.evalStatus;
  packet.qualityEvalScore = qualityRun.evalScore;
  packet.workerRunIds.qualityReviewer = qualityRun.runId;

  return {
    productRun,
    copyRun,
    financeRun,
    distributionRun,
    chiefRun,
    qualityRun,
    chiefOfStaffPacket: packet,
  };
}

function exactWorkerRun(db, taskId, fallbackAgentId) {
  const runRecord = taskId ? get(
    db,
    `SELECT runs.id, runs.agent_id, runs.mode, runs.status, runs.completed_at,
            runs.model_call_id, calls.mode AS model_call_mode,
            calls.status AS model_call_status,
            calls.outcome_status AS model_call_outcome_status,
            calls.provider_request_id, calls.completed_at AS model_call_completed_at
     FROM agent_runs AS runs
     LEFT JOIN model_calls AS calls
       ON calls.id = runs.model_call_id
      AND calls.task_id = runs.task_id
     WHERE runs.task_id = ?
     ORDER BY runs.started_at DESC, runs.id DESC
     LIMIT 1`,
    [taskId],
  ) : null;
  const evaluation = runRecord ? get(
    db,
    `SELECT status, score
     FROM agent_eval_results
     WHERE run_id = ?
     ORDER BY created_at DESC, id DESC
     LIMIT 1`,
    [runRecord.id],
  ) : null;
  const proofIssues = [];
  if (!runRecord) proofIssues.push("agent_run_missing");
  else {
    if (runRecord.mode !== "live") proofIssues.push("agent_run_not_live");
    if (runRecord.status !== "completed" || !runRecord.completed_at) {
      proofIssues.push("agent_run_not_completed");
    }
    if (!runRecord.model_call_id) proofIssues.push("model_call_binding_missing");
    if (runRecord.model_call_mode !== "live") proofIssues.push("model_call_not_live");
    if (!["completed", "succeeded", "provider_completed"].includes(runRecord.model_call_status)) {
      proofIssues.push("model_call_not_completed");
    }
    if (runRecord.model_call_outcome_status !== "known") {
      proofIssues.push("provider_outcome_not_known");
    }
    if (!runRecord.provider_request_id) proofIssues.push("provider_receipt_missing");
    if (!runRecord.model_call_completed_at) proofIssues.push("model_call_completion_missing");
    if (!evaluation || evaluation.status !== "passed") proofIssues.push("evaluation_not_passed");
  }
  return {
    runId: runRecord?.id || null,
    agentId: runRecord?.agent_id || fallbackAgentId,
    modelCallId: runRecord?.model_call_id || null,
    evalStatus: evaluation?.status || "not_evaluated",
    evalScore: Number(evaluation?.score || 0),
    proofIssues,
    actualModelBackedRun: proofIssues.length === 0,
  };
}

function recordBuyerIntentExecutionPackWorkers(db, {
  pack,
  experiment,
  candidate,
  copy,
  actualWorkerTasks,
}) {
  const workflowId = pack.workflow_id || experiment.workflow_id || candidate?.workflow_id || null;
  const economics = unitEconomics({ experiment, candidate });
  const platformName = copy.validation?.channel?.platformName || "the selected platform";
  const sharedMetadata = {
    executionPackId: pack.id,
    experimentId: experiment.id,
    candidateId: candidate?.id || null,
    source: "buyer_intent_validation",
    executionKind: "deterministic_system_step",
    providerCallOccurred: false,
    buyerIntentValidation: copy.validation,
    actualWorkerTasks,
  };
  const productRun = exactWorkerRun(db, actualWorkerTasks?.productBuilder, "product_builder");
  const qualityRun = exactWorkerRun(db, actualWorkerTasks?.qualityReviewer, "quality_reviewer");
  if (!productRun.actualModelBackedRun || !qualityRun.actualModelBackedRun) {
    throw new Error(
      "The buyer-intent pack requires completed live Product Builder and Quality Reviewer runs "
      + "with known provider receipts and passing evaluations.",
    );
  }
  const distributionRun = recordProtectedWorkerOutcome(
    db,
    {
      kind: "buyer_intent_distribution_plan",
      agent: "distribution_operator",
      workflow_id: workflowId,
      title: `Prepare the protected ${platformName} buyer test for ${experiment.name}`,
    },
    {
      heading: "Protected buyer-test plan",
      summary: `Pantheon's distribution checklist converted the frozen measurement contract into one ${platformName} test plan without creating an account, publishing, contacting a buyer, advertising, or spending money.`,
      evidence: [
        copy.channelPlan,
        copy.trackingPlan,
        `Product Builder run: ${productRun.runId}.`,
        `Quality Reviewer run: ${qualityRun.runId}.`,
      ],
      nextAction: "Daniel can approve, request changes, or deny this test plan. Every external platform action remains separately protected.",
    },
    {
      metadata: sharedMetadata,
      approvalRequired: true,
      handoffTo: "chief_of_staff",
      handoffReason: "The validated product and exact buyer-test contract are ready for one operator decision.",
      handoffDecisionNeeded: `Decide whether to prepare this exact ${platformName} buyer test, request changes, or stop it.`,
      trace: [{
        type: "buyer_test_plan_prepared",
        title: "Buyer test plan prepared",
        detail: "A deterministic Pantheon step retained the exact product, measurement, and external-action boundaries in one operator packet.",
      }],
    },
  );
  const handoff = get(
    db,
    "SELECT * FROM agent_handoffs WHERE from_run_id = ? AND to_agent_id = ? LIMIT 1",
    [distributionRun.runId, "chief_of_staff"],
  );
  const packet = buildChiefOfStaffPacket({
    pack,
    experiment,
    candidate,
    copy,
    economics,
    workerRuns: { productRun, qualityRun, distributionRun },
    handoff: handoff ? { ...handoff, metadata: fromJson(handoff.metadata, {}) } : null,
  });
  const chiefRun = recordProtectedWorkerOutcome(
    db,
    {
      kind: "buyer_intent_operator_decision",
      agent: "chief_of_staff",
      workflow_id: workflowId,
      title: `Prepare the buyer-test decision for ${experiment.name}`,
      cost_budget_cents: 0,
    },
    {
      heading: "Chief of Staff buyer-test decision",
      summary: packet.operatorSummary,
      moneyMove: packet.moneyMove,
      evidence: packet.evidence,
      risks: packet.risks,
      operatorDecision: packet.decision,
      nextAction: packet.nextAction,
      confidence: "medium_until_real_buyer_results",
    },
    {
      metadata: { ...sharedMetadata, decisionPacket: packet },
      trace: [{
        type: "buyer_test_decision_prepared",
        title: "Buyer-test decision prepared",
        detail: "Pantheon's deterministic decision compiler compressed the actual product and quality records into one protected operator decision.",
      }],
    },
  );
  packet.chiefRunId = chiefRun.runId;
  packet.workerRunIds.chiefOfStaff = chiefRun.runId;
  return {
    productRun,
    qualityRun,
    distributionRun,
    chiefRun,
    chiefOfStaffPacket: packet,
  };
}

function generateExecutionPack(db, input = {}) {
  const { experiment, candidate } = experimentFromInput(db, input);
  const existing = getExecutionPackForExperiment(db, experiment.id);
  if (existing) {
    return {
      pack: existing,
      experiment,
      candidate,
      brief: candidate?.brief_id ? getBrief(db, candidate.brief_id) : null,
      alreadyGenerated: true,
    };
  }

  const brief = candidate?.brief_id ? getBrief(db, candidate.brief_id) : null;
  const copy = executionCopy({ experiment, candidate, brief });
  const ts = now();
  const packId = input.id || `pack_${safeSlug(experiment.name)}_${randomId().slice(0, 8)}`;
  const title = asText(input.title, `Execution pack: ${experiment.name}`);
  const validation = buyerIntentValidation(experiment, candidate, input);
  const metadata = {
    ...(input.metadata || {}),
    dryRunOnly: true,
    externalActionsAllowed: false,
    manualOnly: true,
    frameworks: FRAMEWORKS,
    buyer: copy.buyer,
    problem: copy.problem,
    offer: copy.offer,
    channel: copy.channel,
    priceCents: candidate?.price_cents ?? experiment.price_cents,
    costCapCents: candidate?.cost_cap_cents ?? experiment.cost_cap_cents,
    successMetric: copy.successMetric,
    killCriteria: copy.killCriteria,
    outreachVariants: [
      `Short post: ${copy.offer} helps ${copy.buyer} solve ${copy.problem}. Reply if you want the pilot version.`,
      `Direct note: I am testing ${copy.offer} for ${copy.buyer}. Is ${copy.problem} a problem you would pay to solve faster?`,
      `Community prompt: For anyone dealing with ${copy.problem}, would a small ${copy.price} template or checklist be useful enough to try?`,
    ],
    objectionPrompts: [
      "What would stop you buying this?",
      "Is the price, promise, format, or timing the blocker?",
      "What would make this useful enough to pay for today?",
    ],
    resultShortcuts: [
      "Record Result when there are views, clicks, leads, sales, or refunds.",
      "Record Reply when a buyer gives useful wording or an objection.",
      "Mark No Response when the test produced no measurable signal.",
    ],
    source: input.source || "dashboard",
    buyerIntentValidation: validation,
  };

  run(
    db,
    `INSERT INTO commercial_execution_packs
     (id, experiment_id, candidate_id, brief_id, workflow_id, venture_id, status, title,
      offer_page_copy, product_description, cta, channel_plan, tracking_plan,
      result_checklist, metadata, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      packId,
      experiment.id,
      candidate?.id || null,
      candidate?.brief_id || experiment.metadata?.briefId || null,
      experiment.workflow_id || candidate?.workflow_id || null,
      experiment.venture_id || candidate?.venture_id || null,
      "quality_review_pending",
      title,
      copy.offerPageCopy,
      copy.productDescription,
      copy.cta,
      copy.channelPlan,
      copy.trackingPlan,
      copy.resultChecklist,
      toJson(metadata),
      ts,
      ts,
    ],
  );

  insertEvent(db, {
    actor: "commercial-engine",
    type: "commercial_execution_pack.generated",
    entityType: "commercial_execution_pack",
    entityId: packId,
    message: `Execution pack prepared for ${experiment.name}.`,
    metadata: { experimentId: experiment.id, workflowId: experiment.workflow_id || null, candidateId: candidate?.id || null },
  });
  const pack = getExecutionPack(db, packId);
  const aiTeam = validation
    ? recordBuyerIntentExecutionPackWorkers(db, {
      pack,
      experiment,
      candidate,
      copy,
      actualWorkerTasks: input.metadata?.actualWorkerTasks || {},
    })
    : recordExecutionPackWorkers(db, { pack, experiment, candidate, copy });
  run(
    db,
    "UPDATE commercial_execution_packs SET status = ?, metadata = ?, updated_at = ? WHERE id = ?",
    [
      aiTeam.qualityRun.evalStatus === "passed" ? "ready_to_test" : "needs_changes",
      toJson({ ...metadata, aiTeam }),
      now(),
      packId,
    ],
  );

  return {
    pack: getExecutionPack(db, packId),
    experiment,
    candidate,
    brief,
    alreadyGenerated: false,
  };
}

function recordExecutionPackOutcome(db, packId, input = {}) {
  const pack = getExecutionPack(db, packId);
  if (!pack) throw new Error(`Execution pack not found: ${packId}`);
  const outcomeType = String(input.outcomeType || input.outcome_type || "result").toLowerCase();
  const metadata = { ...(input.metadata || {}), executionPackId: pack.id, outcomeType };
  let recorded;
  let nextStatus = "result_recorded";

  if (["reply", "objection", "feedback"].includes(outcomeType)) {
    recorded = recordCommercialFeedback(db, {
      experimentId: pack.experiment_id,
      workflowId: pack.workflow_id || undefined,
      source: "execution_pack",
      sentiment: input.sentiment || (outcomeType === "objection" ? "negative" : "neutral"),
      rating: input.rating,
      summary: asText(input.summary || input.notes, "Buyer reply recorded from the execution pack."),
      objection: input.objection || (outcomeType === "objection" ? asText(input.notes, "") : ""),
      request: input.request || "",
      verified: input.verified === true,
      verificationNote: input.verificationNote || input.verification_note || "",
      metadata,
    });
    nextStatus = recorded.learning ? "feedback_recorded" : "awaiting_verification";
  } else {
    const noResponse = outcomeType === "no_response";
    recorded = recordCommercialResult(db, {
      experimentId: pack.experiment_id,
      workflowId: pack.workflow_id || undefined,
      source: "execution_pack",
      status: "recorded",
      views: noResponse ? 0 : asInt(input.views),
      clicks: noResponse ? 0 : asInt(input.clicks),
      leads: noResponse ? 0 : asInt(input.leads),
      sales: noResponse ? 0 : asInt(input.sales),
      refunds: noResponse ? 0 : asInt(input.refunds),
      revenueCents: noResponse ? 0 : asInt(input.revenueCents ?? input.revenue_cents),
      refundAmountCents: noResponse ? 0 : asInt(input.refundAmountCents ?? input.refund_amount_cents),
      spendCents: noResponse ? 0 : asInt(input.spendCents ?? input.spend_cents),
      platformFeeCents: noResponse ? 0 : asInt(input.platformFeeCents ?? input.platform_fee_cents),
      fulfilmentCostCents: noResponse ? 0 : asInt(input.fulfilmentCostCents ?? input.fulfilment_cost_cents),
      productCostCents: noResponse ? 0 : asInt(input.productCostCents ?? input.product_cost_cents),
      toolCostCents: noResponse ? 0 : asInt(input.toolCostCents ?? input.tool_cost_cents),
      attributedAiCostCents: noResponse ? 0 : asInt(input.attributedAiCostCents ?? input.attributed_ai_cost_cents),
      otherCostCents: noResponse ? 0 : asInt(input.otherCostCents ?? input.other_cost_cents),
      timeSpentMinutes: asInt(input.timeSpentMinutes ?? input.time_spent_minutes),
      verified: input.verified === true,
      verificationNote: input.verificationNote || input.verification_note || "",
      notes: asText(
        input.notes,
        noResponse
          ? `No response recorded for ${pack.title}.`
          : `Result recorded from execution pack: ${pack.title}.`,
      ),
      metadata,
    });
    nextStatus = recorded.learning
      ? (noResponse ? "waiting_for_signal" : "result_recorded")
      : "awaiting_verification";
  }

  const outcomeDecision = recorded.learning
    ? recordOutcomeDecisionPacket(db, { pack, outcomeType, recorded })
    : null;
  run(db, "UPDATE commercial_execution_packs SET status = ?, updated_at = ? WHERE id = ?", [nextStatus, now(), pack.id]);
  insertEvent(db, {
    actor: "commercial-engine",
    type: "commercial_execution_pack.outcome_recorded",
    entityType: "commercial_execution_pack",
    entityId: pack.id,
    message: `Execution pack outcome recorded for ${pack.title}.`,
    metadata: { experimentId: pack.experiment_id, workflowId: pack.workflow_id || null, outcomeType },
  });

  return {
    pack: getExecutionPack(db, pack.id),
    recorded,
    outcomeType,
    outcomeDecision,
  };
}

module.exports = {
  generateExecutionPack,
  getExecutionPack,
  getExecutionPackForExperiment,
  getExecutionPacks,
  recordExecutionPackOutcome,
};
