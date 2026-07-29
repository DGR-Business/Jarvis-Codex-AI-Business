const { all, fromJson, get, insertEvent, now, randomId, run, toJson } = require("../db");
const { recordProtectedWorkerOutcome } = require("./ai-team");

const TEST_FIXTURE_CAPABILITIES = new WeakMap();

function asText(value, fallback = "") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function asInt(value) {
  return Math.max(0, Math.round(Number(value) || 0));
}

function asMoney(value) {
  return asInt(value);
}

function safeSlug(value) {
  return String(value || "commercial")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 34) || "commercial";
}

function pct(numerator, denominator) {
  if (!denominator) return 0;
  return Number(((numerator / denominator) * 100).toFixed(2));
}

function moneyLabel(cents) {
  const value = Number(cents) || 0;
  const sign = value < 0 ? "-" : "";
  return `${sign}A$${(Math.abs(value) / 100).toFixed(2)}`;
}

function badRequest(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

function runningUnderNodeTest() {
  return Boolean(process.env.NODE_TEST_CONTEXT)
    || process.execArgv.some((argument) => (
      argument === "--test" || argument.startsWith("--test-")
    ));
}

function parseExperiment(row) {
  return row ? { ...row, metadata: fromJson(row.metadata) } : null;
}

function parseRows(rows) {
  return rows.map((row) => ({ ...row, metadata: fromJson(row.metadata) }));
}

function workflowDefaults(db, workflowId) {
  const workflow = workflowId ? get(db, "SELECT * FROM workflows WHERE id = ?", [workflowId]) : null;
  if (!workflow && workflowId) throw new Error(`Workflow not found: ${workflowId}`);
  const metadata = fromJson(workflow?.metadata);
  return {
    workflow,
    metadata,
    ventureId: workflow?.venture_id || null,
    name: workflow?.title || "Commercial test",
    buyer: metadata.buyer || metadata.targetCustomer || "",
    offer: metadata.offer || metadata.subject || workflow?.title || "",
    channel: metadata.channel || workflow?.type || "Business channel",
    priceCents: asMoney(metadata.priceCents || workflow?.expected_profit_cents || 0),
    costCapCents: asMoney(workflow?.cost_estimate_cents || 0),
  };
}

function createCommercialExperiment(db, input = {}) {
  const defaults = workflowDefaults(db, input.workflowId || input.workflow_id);
  const ts = now();
  const ventureId = input.ventureId || input.venture_id || defaults.ventureId
    || get(db, "SELECT id FROM ventures WHERE is_active = 1 ORDER BY updated_at DESC LIMIT 1")?.id;
  if (!ventureId) throw new Error("A commercial test needs an active venture.");
  const id = input.id || `exp_${safeSlug(input.name || defaults.name)}_${randomId().slice(0, 8)}`;
  const status = input.status || "candidate";
  if (status === "running" && input.realStart !== true) {
    throw new Error("A test can only be marked running when a real-world start is confirmed.");
  }
  const hypothesis = asText(
    input.hypothesis,
    "If this offer reaches the right buyer through the chosen channel, it should produce a measurable commercial signal.",
  );
  run(
    db,
    `INSERT INTO commercial_experiments
     (id, workflow_id, venture_id, name, status, hypothesis, buyer, offer, channel, price_cents,
      expected_metric, target_value, target_unit, cost_cap_cents, started_at, ended_at, metadata, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      defaults.workflow?.id || null,
      ventureId,
      asText(input.name, defaults.name),
      status,
      hypothesis,
      asText(input.buyer, defaults.buyer),
      asText(input.offer, defaults.offer),
      asText(input.channel, defaults.channel),
      asMoney(input.priceCents ?? input.price_cents ?? defaults.priceCents),
      asText(input.expectedMetric ?? input.expected_metric, "views, clicks, leads, sales, refunds, revenue, spend, and feedback"),
      Number(input.targetValue ?? input.target_value ?? 100) || 0,
      asText(input.targetUnit ?? input.target_unit, "views"),
      asMoney(input.costCapCents ?? input.cost_cap_cents ?? defaults.costCapCents),
      status === "running" ? (input.startedAt || input.started_at || ts) : null,
      input.endedAt || input.ended_at || null,
      toJson({ ...(input.metadata || {}), realStartConfirmed: status === "running" }),
      ts,
      ts,
    ],
  );
  insertEvent(db, {
    actor: "commercial-engine",
    type: "commercial_experiment.created",
    entityType: "commercial_experiment",
    entityId: id,
    message: `Commercial test created: ${asText(input.name, defaults.name)}.`,
    metadata: { workflowId: defaults.workflow?.id || null },
  });
  return getCommercialExperiment(db, id);
}

function getCommercialExperiment(db, id) {
  return parseExperiment(get(db, "SELECT * FROM commercial_experiments WHERE id = ?", [id]));
}

function findOrCreateExperiment(db, input = {}) {
  if (input.experimentId || input.experiment_id) {
    const experiment = getCommercialExperiment(db, input.experimentId || input.experiment_id);
    if (!experiment) throw new Error(`Commercial experiment not found: ${input.experimentId || input.experiment_id}`);
    return experiment;
  }
  const workflowId = input.workflowId || input.workflow_id;
  if (!workflowId) return createCommercialExperiment(db, input.experiment || {});
  const existing = parseExperiment(
    get(
      db,
      `SELECT * FROM commercial_experiments
       WHERE workflow_id = ?
       ORDER BY CASE status WHEN 'running' THEN 0 WHEN 'measuring' THEN 1 ELSE 2 END, updated_at DESC
       LIMIT 1`,
      [workflowId],
    ),
  );
  if (existing) return existing;
  return createCommercialExperiment(db, { ...(input.experiment || {}), workflowId });
}

function resultPayload(input = {}) {
  const currency = String(input.currency || "AUD").toUpperCase();
  if (currency !== "AUD") throw new Error("Commercial results must be normalized to AUD before they are recorded.");
  return {
    views: asInt(input.views),
    clicks: asInt(input.clicks),
    leads: asInt(input.leads),
    sales: asInt(input.sales),
    refunds: asInt(input.refunds),
    revenueCents: asMoney(input.revenueCents ?? input.revenue_cents),
    refundAmountCents: asMoney(input.refundAmountCents ?? input.refund_amount_cents),
    spendCents: asMoney(input.spendCents ?? input.spend_cents),
    platformFeeCents: asMoney(input.platformFeeCents ?? input.platform_fee_cents),
    fulfilmentCostCents: asMoney(input.fulfilmentCostCents ?? input.fulfilment_cost_cents),
    productCostCents: asMoney(input.productCostCents ?? input.product_cost_cents),
    toolCostCents: asMoney(input.toolCostCents ?? input.tool_cost_cents),
    attributedAiCostCents: asMoney(input.attributedAiCostCents ?? input.attributed_ai_cost_cents),
    otherCostCents: asMoney(input.otherCostCents ?? input.other_cost_cents),
    timeSpentMinutes: asInt(input.timeSpentMinutes ?? input.time_spent_minutes),
    notes: asText(input.notes),
    currency,
  };
}

function verificationState(db, input = {}, context = {}) {
  const source = asText(input.source, "operator").toLowerCase();
  if (
    source === "test"
    && context.testFixtureCapability
    && TEST_FIXTURE_CAPABILITIES.get(context.testFixtureCapability) === db
  ) {
    return { verified: true, at: now(), evidenceId: null, method: "test_fixture" };
  }

  const verificationRequested = input.verified === true || input.status === "verified";
  if (!verificationRequested) {
    return { verified: false, at: null, evidenceId: null, method: "pending" };
  }

  if (context.hasFinancialClaim === true) {
    throw badRequest(
      "Sales and cash claims require exact receipt or platform evidence from Pantheon's immutable, experiment-bound commercial evidence ledger. Legacy venture, research, operator, and platform records cannot verify financial truth.",
    );
  }

  if (source === "execution_pack") {
    const executionPackId = input.metadata?.executionPackId;
    if (!executionPackId) {
      throw badRequest("Verified execution-pack evidence needs the exact execution-pack identity.");
    }
    const pack = get(
      db,
      `SELECT id, experiment_id, workflow_id, venture_id
       FROM commercial_execution_packs
       WHERE id = ?`,
      [executionPackId],
    );
    if (!pack) throw badRequest("The operator result refers to an execution pack that does not exist.");
    if (
      pack.experiment_id !== context.experiment?.id
      || (pack.venture_id && pack.venture_id !== context.experiment?.venture_id)
      || (pack.workflow_id && pack.workflow_id !== context.experiment?.workflow_id)
    ) {
      throw badRequest("The execution pack belongs to a different commercial test.");
    }
    const note = asText(input.verificationNote || input.verification_note);
    if (note.length < 8) {
      throw badRequest("Verified execution-pack evidence needs a specific operator attestation.");
    }
    return {
      verified: true,
      at: now(),
      evidenceId: null,
      method: "execution_pack_attestation",
      note,
    };
  }

  return {
    verified: false,
    at: null,
    evidenceId: null,
    method: "legacy_observation_pending",
  };
}

function insertFinanceRows(db, experiment, result, values) {
  const ts = result.occurred_at;
  if (values.revenueCents > 0) {
    run(
      db,
      `INSERT INTO revenue
       (id, venture_id, source, status, amount_cents, currency, occurred_at, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        `rev_${result.id}`,
        experiment.venture_id || null,
        "commercial_result",
        "verified",
        values.revenueCents,
        "AUD",
        ts,
        toJson({ resultId: result.id, experimentId: experiment.id, workflowId: experiment.workflow_id }),
      ],
    );
  }
  const cashCostCents = values.refundAmountCents
    + values.spendCents
    + values.platformFeeCents
    + values.fulfilmentCostCents
    + values.productCostCents
    + values.toolCostCents
    + values.attributedAiCostCents
    + values.otherCostCents;
  if (cashCostCents > 0) {
    run(
      db,
      `INSERT INTO costs
       (id, workflow_id, category, source, status, amount_cents, currency, occurred_at,
        metadata, venture_id, run_id, task_id, model_call_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        `cost_${result.id}`,
        experiment.workflow_id || null,
        "commercial_test",
        "commercial_result",
        "recorded",
        cashCostCents,
        "AUD",
        ts,
        toJson({
          resultId: result.id,
          experimentId: experiment.id,
          refundAmountCents: values.refundAmountCents,
          externalSpendCents: values.spendCents,
          platformFeeCents: values.platformFeeCents,
          fulfilmentCostCents: values.fulfilmentCostCents,
          productCostCents: values.productCostCents,
          toolCostCents: values.toolCostCents,
          attributedAiCostCents: values.attributedAiCostCents,
          otherCostCents: values.otherCostCents,
        }),
        experiment.venture_id || null,
        null,
        null,
        null,
      ],
    );
  }
}

function recordResultAnalysisWorker(db, experiment, result, learning) {
  return recordProtectedWorkerOutcome(
    db,
    {
      kind: "result_analysis",
      agent: "growth_analyst",
      workflow_id: experiment.workflow_id || null,
      title: `Analyze commercial result for ${experiment.name}`,
    },
    {
      heading: "Growth result analysis",
      summary: `Growth reviewed the recorded result for ${experiment.name} and recommended: ${learning.verdict}.`,
      evidence: [
        `Actual result: ${learning.actual_result}.`,
        `Learning: ${learning.learning}.`,
        `Improvement: ${learning.improvement}.`,
      ],
      nextAction: learning.next_action,
    },
    {
      metadata: {
        experimentId: experiment.id,
        resultId: result.id,
        learningId: learning.id,
        executionPackId: result.metadata?.executionPackId || null,
        verdict: learning.verdict,
        source: result.source,
      },
      approvalRequired: true,
      handoffTo: "chief_of_staff",
      handoffReason: "A commercial result has been analyzed and needs an operator decision on the next money move.",
      handoffDecisionNeeded: "Decide whether to continue, revise, pause, or stop this test based on the recorded result.",
      trace: [
        {
          type: "learning_cycle_recorded",
          title: "Learning cycle reviewed",
          detail: "Growth compared the expected commercial signal with the actual recorded result.",
          metadata: { learningId: learning.id, verdict: learning.verdict },
        },
      ],
    },
  );
}

function recordFeedbackAnalysisWorker(db, experiment, feedback, learning) {
  const evidence = [
    `Signal: ${feedback.summary || "No summary provided."}`,
    `Sentiment: ${feedback.sentiment || "neutral"}.`,
  ];
  if (feedback.objection) evidence.push(`Objection: ${feedback.objection}.`);
  if (feedback.request) evidence.push(`Request: ${feedback.request}.`);

  return recordProtectedWorkerOutcome(
    db,
    {
      kind: "feedback_analysis",
      agent: "customer_voice_agent",
      workflow_id: experiment.workflow_id || null,
      title: `Analyze buyer signal for ${experiment.name}`,
    },
    {
      heading: "Customer signal analysis",
      summary: `Customer Voice reviewed the buyer signal for ${experiment.name}.`,
      evidence,
      nextAction: learning.next_action || "Use the buyer wording to revise the offer, proof, product, or channel before scaling.",
    },
    {
      metadata: {
        experimentId: experiment.id,
        feedbackId: feedback.id,
        learningId: learning.id,
        executionPackId: feedback.metadata?.executionPackId || null,
        sentiment: feedback.sentiment,
        source: feedback.source,
      },
      approvalRequired: true,
      handoffTo: "chief_of_staff",
      handoffReason: "A customer signal has been analyzed and needs an operator decision on the next offer or product change.",
      handoffDecisionNeeded: "Decide whether the buyer signal should change the offer, product, proof, price, or channel.",
      trace: [
        {
          type: "buyer_signal_recorded",
          title: "Buyer signal reviewed",
          detail: "Customer Voice captured the signal as input to the learning loop.",
          metadata: { feedbackId: feedback.id, sentiment: feedback.sentiment },
        },
      ],
    },
  );
}

function recordCommercialResultOperation(db, input = {}, testFixtureCapability = null) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const experiment = findOrCreateExperiment(db, input);
    const ts = input.occurredAt || input.occurred_at || now();
    const values = resultPayload(input);
    const hasFinancialClaim = values.sales > 0
      || values.refunds > 0
      || values.revenueCents > 0
      || values.refundAmountCents > 0
      || values.spendCents > 0
      || values.platformFeeCents > 0
      || values.fulfilmentCostCents > 0
      || values.productCostCents > 0
      || values.toolCostCents > 0
      || values.attributedAiCostCents > 0
      || values.otherCostCents > 0;
    const verification = verificationState(db, input, {
      experiment,
      testFixtureCapability,
      hasFinancialClaim,
    });
    const storedValues = !verification.verified && hasFinancialClaim
      ? {
        ...values,
        sales: 0,
        refunds: 0,
        revenueCents: 0,
        refundAmountCents: 0,
        spendCents: 0,
        platformFeeCents: 0,
        fulfilmentCostCents: 0,
        productCostCents: 0,
        toolCostCents: 0,
        attributedAiCostCents: 0,
        otherCostCents: 0,
      }
      : values;
    const id = input.id || `result_${safeSlug(experiment.name)}_${randomId().slice(0, 8)}`;
    run(
      db,
      `INSERT INTO commercial_results
       (id, experiment_id, workflow_id, source, status, views, clicks, leads, sales, refunds,
        revenue_cents, spend_cents, time_spent_minutes, notes, occurred_at, metadata, created_at,
        venture_id, platform_fee_cents, product_cost_cents, tool_cost_cents, verified, currency,
        verified_at, verification_evidence_id, refund_amount_cents, fulfilment_cost_cents,
        attributed_ai_cost_cents, other_cost_cents)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        experiment.id,
        experiment.workflow_id || null,
        asText(input.source, "operator"),
        verification.verified ? "verified" : "pending_verification",
        storedValues.views,
        storedValues.clicks,
        storedValues.leads,
        storedValues.sales,
        storedValues.refunds,
        storedValues.revenueCents,
        storedValues.spendCents,
        storedValues.timeSpentMinutes,
        storedValues.notes,
        ts,
        toJson({
          ...(input.metadata || {}),
          verificationMethod: verification.method,
          verificationNote: verification.note || null,
          unverifiedFinancialProjection: !verification.verified && hasFinancialClaim
            ? {
              sales: values.sales,
              refunds: values.refunds,
              revenueCents: values.revenueCents,
              refundAmountCents: values.refundAmountCents,
              spendCents: values.spendCents,
              platformFeeCents: values.platformFeeCents,
              fulfilmentCostCents: values.fulfilmentCostCents,
              productCostCents: values.productCostCents,
              toolCostCents: values.toolCostCents,
              attributedAiCostCents: values.attributedAiCostCents,
              otherCostCents: values.otherCostCents,
              currency: values.currency,
            }
            : null,
        }),
        now(),
        experiment.venture_id,
        storedValues.platformFeeCents,
        storedValues.productCostCents,
        storedValues.toolCostCents,
        verification.verified ? 1 : 0,
        storedValues.currency,
        verification.at,
        verification.evidenceId,
        storedValues.refundAmountCents,
        storedValues.fulfilmentCostCents,
        storedValues.attributedAiCostCents,
        storedValues.otherCostCents,
      ],
    );
    const result = parseRows(all(db, "SELECT * FROM commercial_results WHERE id = ?", [id]))[0];
    let learning = null;
    let aiTeamRun = null;
    if (verification.verified) {
      insertFinanceRows(db, experiment, result, values);
      learning = recordLearningCycle(db, experiment.id);
      aiTeamRun = recordResultAnalysisWorker(db, experiment, result, learning);
    }
    insertEvent(db, {
      actor: "commercial-engine",
      type: verification.verified ? "commercial_result.verified" : "commercial_result.awaiting_verification",
      entityType: "commercial_result",
      entityId: id,
      message: verification.verified
        ? `Verified commercial result recorded for ${experiment.name}: ${learning.verdict}.`
        : `Commercial result saved for ${experiment.name} and is waiting for verification.`,
      metadata: {
        experimentId: experiment.id,
        workflowId: experiment.workflow_id,
        learningId: learning?.id || null,
        affectsCommercialTruth: verification.verified,
      },
    });
    db.exec("COMMIT");
    return { experiment: getCommercialExperiment(db, experiment.id), result, learning, aiTeamRun, verified: verification.verified };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function recordCommercialResult(db, input = {}) {
  return recordCommercialResultOperation(db, input);
}

function recordCommercialResultForTest(db, input = {}) {
  if (!runningUnderNodeTest()) {
    throw new Error("Synthetic commercial-result fixtures are available only inside Node's isolated test runner.");
  }
  const capability = Object.freeze({});
  TEST_FIXTURE_CAPABILITIES.set(capability, db);
  try {
    return recordCommercialResultOperation(
      db,
      { ...input, source: "test" },
      capability,
    );
  } finally {
    TEST_FIXTURE_CAPABILITIES.delete(capability);
  }
}

function recordCommercialFeedbackOperation(db, input = {}, testFixtureCapability = null) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const experiment = findOrCreateExperiment(db, input);
    const verification = verificationState(db, input, {
      experiment,
      testFixtureCapability,
      hasFinancialClaim: false,
    });
    const id = input.id || `feedback_${safeSlug(experiment.name)}_${randomId().slice(0, 8)}`;
    run(
      db,
      `INSERT INTO commercial_feedback
       (id, experiment_id, workflow_id, source, sentiment, rating, summary, objection, request,
        occurred_at, metadata, created_at, venture_id, verified, verified_at, verification_evidence_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        experiment.id,
        experiment.workflow_id || null,
        asText(input.source, "operator"),
        asText(input.sentiment, "neutral"),
        input.rating === undefined || input.rating === null || input.rating === "" ? null : asInt(input.rating),
        asText(input.summary),
        asText(input.objection),
        asText(input.request),
        input.occurredAt || input.occurred_at || now(),
        toJson({ ...(input.metadata || {}), verificationMethod: verification.method, verificationNote: verification.note || null }),
        now(),
        experiment.venture_id,
        verification.verified ? 1 : 0,
        verification.at,
        verification.evidenceId,
      ],
    );
    const feedback = parseRows(all(db, "SELECT * FROM commercial_feedback WHERE id = ?", [id]))[0];
    let learning = null;
    let aiTeamRun = null;
    if (verification.verified) {
      learning = recordLearningCycle(db, experiment.id);
      aiTeamRun = recordFeedbackAnalysisWorker(db, experiment, feedback, learning);
    }
    insertEvent(db, {
      actor: "commercial-engine",
      type: verification.verified ? "commercial_feedback.verified" : "commercial_feedback.awaiting_verification",
      entityType: "commercial_feedback",
      entityId: id,
      message: verification.verified
        ? `Verified customer signal recorded for ${experiment.name}: ${feedback.sentiment}.`
        : `Customer signal saved for ${experiment.name} and is waiting for verification.`,
      metadata: {
        experimentId: experiment.id,
        workflowId: experiment.workflow_id,
        learningId: learning?.id || null,
        affectsCommercialTruth: verification.verified,
      },
    });
    db.exec("COMMIT");
    return { experiment: getCommercialExperiment(db, experiment.id), feedback, learning, aiTeamRun, verified: verification.verified };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function recordCommercialFeedback(db, input = {}) {
  return recordCommercialFeedbackOperation(db, input);
}

function recordCommercialFeedbackForTest(db, input = {}) {
  if (!runningUnderNodeTest()) {
    throw new Error("Synthetic commercial-feedback fixtures are available only inside Node's isolated test runner.");
  }
  const capability = Object.freeze({});
  TEST_FIXTURE_CAPABILITIES.set(capability, db);
  try {
    return recordCommercialFeedbackOperation(
      db,
      { ...input, source: "test" },
      capability,
    );
  } finally {
    TEST_FIXTURE_CAPABILITIES.delete(capability);
  }
}

function summarizeCommercialEvidence(db, filters = {}) {
  const where = [];
  const params = [];
  if (filters.workflowId) {
    where.push("workflow_id = ?");
    params.push(filters.workflowId);
  }
  if (filters.experimentId) {
    where.push("experiment_id = ?");
    params.push(filters.experimentId);
  }
  const scope = where.length ? ` AND ${where.join(" AND ")}` : "";
  const learningScope = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const results = parseRows(all(db, `SELECT * FROM commercial_results WHERE verified = 1${scope} ORDER BY occurred_at DESC`, params));
  const feedback = parseRows(all(db, `SELECT * FROM commercial_feedback WHERE verified = 1${scope} ORDER BY occurred_at DESC`, params));
  const learningCycles = parseRows(all(db, `SELECT * FROM commercial_learning_cycles ${learningScope} ORDER BY created_at DESC`, params));
  return summarizeRows({ results, feedback, learningCycles });
}

function summarizeRows({ results = [], feedback = [], learningCycles = [] }) {
  const totals = results.reduce(
    (acc, result) => ({
      views: acc.views + asInt(result.views),
      clicks: acc.clicks + asInt(result.clicks),
      leads: acc.leads + asInt(result.leads),
      sales: acc.sales + asInt(result.sales),
      refunds: acc.refunds + asInt(result.refunds),
      revenueCents: acc.revenueCents + asMoney(result.revenue_cents),
      refundAmountCents: acc.refundAmountCents + asMoney(result.refund_amount_cents),
      spendCents: acc.spendCents + asMoney(result.spend_cents),
      platformFeeCents: acc.platformFeeCents + asMoney(result.platform_fee_cents),
      fulfilmentCostCents: acc.fulfilmentCostCents + asMoney(result.fulfilment_cost_cents),
      productCostCents: acc.productCostCents + asMoney(result.product_cost_cents),
      toolCostCents: acc.toolCostCents + asMoney(result.tool_cost_cents),
      attributedAiCostCents: acc.attributedAiCostCents + asMoney(result.attributed_ai_cost_cents),
      otherCostCents: acc.otherCostCents + asMoney(result.other_cost_cents),
      timeSpentMinutes: acc.timeSpentMinutes + asInt(result.time_spent_minutes),
    }),
    {
      views: 0,
      clicks: 0,
      leads: 0,
      sales: 0,
      refunds: 0,
      revenueCents: 0,
      refundAmountCents: 0,
      spendCents: 0,
      platformFeeCents: 0,
      fulfilmentCostCents: 0,
      productCostCents: 0,
      toolCostCents: 0,
      attributedAiCostCents: 0,
      otherCostCents: 0,
      timeSpentMinutes: 0,
    },
  );
  const sentiment = feedback.reduce(
    (acc, item) => {
      const key = String(item.sentiment || "neutral").toLowerCase();
      if (key.includes("positive")) acc.positive += 1;
      else if (key.includes("negative")) acc.negative += 1;
      else acc.neutral += 1;
      return acc;
    },
    { positive: 0, neutral: 0, negative: 0 },
  );
  const totalCostCents = totals.refundAmountCents
    + totals.spendCents
    + totals.platformFeeCents
    + totals.fulfilmentCostCents
    + totals.productCostCents
    + totals.toolCostCents
    + totals.attributedAiCostCents
    + totals.otherCostCents;
  const cashContributionCents = totals.revenueCents - totalCostCents;
  return {
    ...totals,
    totalCostCents,
    cashContributionCents,
    profitCents: cashContributionCents,
    clickRate: pct(totals.clicks, totals.views),
    leadRate: pct(totals.leads, totals.clicks || totals.views),
    salesRate: pct(totals.sales, totals.clicks || totals.views),
    refundRate: pct(totals.refunds, totals.sales),
    roi: totalCostCents > 0 ? Number((cashContributionCents / totalCostCents).toFixed(2)) : null,
    resultCount: results.length,
    feedbackCount: feedback.length,
    sentiment,
    latestResult: results[0] || null,
    latestFeedback: feedback[0] || null,
    latestLearning: learningCycles[0] || null,
  };
}

function resultSentence(summary) {
  const parts = [
    `${summary.views} views`,
    `${summary.clicks} clicks`,
    `${summary.leads} leads`,
    `${summary.sales} sales`,
    `${summary.refunds} refunds`,
    `${moneyLabel(summary.revenueCents)} revenue`,
    `${moneyLabel(summary.totalCostCents)} total costs`,
    `${moneyLabel(summary.cashContributionCents)} net cash contribution`,
  ];
  return parts.join(", ");
}

function judgeEvidence(summary, experiment) {
  const target = Number(experiment.target_value || 0);
  const targetUnit = String(experiment.target_unit || "").toLowerCase();
  const reachedTarget =
    (targetUnit.includes("click") && summary.clicks >= target) ||
    (targetUnit.includes("lead") && summary.leads >= target) ||
    (targetUnit.includes("sale") && summary.sales >= target) ||
    (targetUnit.includes("revenue") && summary.revenueCents >= target) ||
    (targetUnit.includes("view") && summary.views >= target);

  if (summary.sales > 0 && summary.cashContributionCents > 0 && summary.refundRate <= 15 && summary.sentiment.negative <= summary.sentiment.positive) {
    return {
      verdict: "signal_observed",
      confidence: summary.sales >= 3 || reachedTarget ? "medium" : "low",
      learning: "The offer produced a positive paid signal, but aggregated results do not prove three independent buyers or fully reconciled cash contribution.",
      improvement: "Retain attributable buyer and transaction evidence, reconcile every cash cost in AUD, and continue the bounded test without calling the venture proven.",
      nextAction: "Continue the same controlled test until the independent-buyer and actual net-cash proof rules can be evaluated.",
    };
  }
  if (summary.sales > 0 && summary.cashContributionCents <= 0) {
    return {
      verdict: "revise",
      confidence: "medium",
      learning: "The offer can sell, but the economics are not yet healthy.",
      improvement: "Raise price, reduce fulfilment/tool cost, improve conversion, or change channel before scaling.",
      nextAction: "Revise pricing or channel economics before spending more.",
    };
  }
  if (summary.refunds > 0 || summary.sentiment.negative > summary.sentiment.positive + 1) {
    return {
      verdict: "revise",
      confidence: "medium",
      learning: "Customer signal shows friction, objections, or refund pressure.",
      improvement: "Fix the promise, positioning, product fit, or expectation mismatch before more traffic.",
      nextAction: "Review objections and revise the offer before the next test.",
    };
  }
  if (summary.clicks > 0 || summary.leads > 0) {
    return {
      verdict: "revise",
      confidence: reachedTarget ? "medium" : "low",
      learning: "There is some interest, but it has not converted into paid demand yet.",
      improvement: "Improve the offer, proof, price, checkout path, or follow-up before scaling.",
      nextAction: "Revise the conversion path and run another small test.",
    };
  }
  if (summary.views > 0 && (reachedTarget || summary.views >= 100)) {
    return {
      verdict: "diagnose",
      confidence: "medium",
      learning: "The channel produced exposure but no meaningful buyer action.",
      improvement: "Diagnose audience, creative, listing, value, catalogue, price, checkout, fulfilment and underlying demand before deciding whether to stop.",
      nextAction: "Run a structured constraint diagnosis before choosing revise or pause.",
    };
  }
  return {
    verdict: "needs_evidence",
    confidence: "low",
    learning: "There is not enough market contact yet to make a commercial judgement.",
    improvement: "Collect a small measurable result before deciding whether to build, scale, revise, or stop.",
    nextAction: "Run or record the smallest useful channel test.",
  };
}

function statusForVerdict(verdict) {
  return {
    signal_observed: "continue_testing",
    revise: "needs_revision",
    diagnose: "diagnosing",
    kill_or_rework: "stopped",
    needs_evidence: "measuring",
  }[verdict] || "measuring";
}

function diagnoseCommercialConstraint(summary) {
  const dimensions = {
    reach: summary.views > 0 ? "observed" : "not_proven",
    audience: summary.views > 0 && summary.clicks === 0 ? "possible_mismatch" : "unknown",
    creative: summary.views > 0 && summary.clicks === 0 ? "possible_mismatch" : "unknown",
    listing: summary.clicks > 0 && summary.sales === 0 ? "possible_friction" : "unknown",
    value: summary.clicks > 0 && summary.sales === 0 ? "not_proven" : "unknown",
    catalogue: summary.sales === 0 ? "not_proven" : "unknown",
    price: summary.clicks > 0 && summary.sales === 0 ? "possible_friction" : "unknown",
    checkout: summary.clicks > 0 && summary.sales === 0 ? "possible_friction" : "unknown",
    fulfilment: summary.refunds > 0 ? "possible_problem" : "unknown",
    demand: summary.views >= 100 && summary.clicks === 0 ? "weak_for_current_angle" : "not_yet_isolated",
    economics: summary.sales > 0 && summary.cashContributionCents <= 0 ? "unhealthy" : "unknown",
  };
  let primaryConstraint = "insufficient_evidence";
  let recommendedTest = "Collect enough qualified exposure to isolate the first weak step in the buyer path.";
  const evidenceNeeded = ["qualified reach by channel", "buyer segment", "creative or listing version"];
  if (summary.views >= 100 && summary.clicks === 0) {
    primaryConstraint = "attention_to_interest";
    recommendedTest = "Test a materially different audience-message pair before changing the product.";
    evidenceNeeded.push("click-through rate by audience-message pair");
  } else if (summary.clicks > 0 && summary.sales === 0) {
    primaryConstraint = "interest_to_purchase";
    recommendedTest = "Review listing value, proof, price and checkout friction, then test one isolated change.";
    evidenceNeeded.push("checkout starts", "price objections", "listing scroll or engagement");
  } else if (summary.sales > 0 && summary.cashContributionCents <= 0) {
    primaryConstraint = "unit_economics";
    recommendedTest = "Model price, fees, fulfilment and acquisition cost before any additional traffic.";
    evidenceNeeded.push("fee receipt", "fulfilment cost", "cost per acquired buyer");
  } else if (summary.refunds > 0) {
    primaryConstraint = "promise_or_fulfilment";
    recommendedTest = "Review refund reasons and expectation gaps before more promotion.";
    evidenceNeeded.push("refund reason", "buyer expectation", "product quality finding");
  }
  return { primaryConstraint, dimensions, evidenceNeeded, recommendedTest };
}

function recordCommercialDiagnosis(db, experiment, summary, resultId = null) {
  const diagnosis = diagnoseCommercialConstraint(summary);
  const id = `diagnosis_${safeSlug(experiment.name)}_${randomId().slice(0, 8)}`;
  const ts = now();
  run(
    db,
    `INSERT INTO commercial_diagnoses
     (id, venture_id, experiment_id, result_id, status, primary_constraint, dimensions,
      evidence_needed, recommended_test, decision, metadata, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'required', ?, ?, ?, ?, '', ?, ?, ?)`,
    [
      id,
      experiment.venture_id,
      experiment.id,
      resultId,
      diagnosis.primaryConstraint,
      toJson(diagnosis.dimensions),
      toJson(diagnosis.evidenceNeeded),
      diagnosis.recommendedTest,
      toJson({ summary }),
      ts,
      ts,
    ],
  );
  return {
    ...get(db, "SELECT * FROM commercial_diagnoses WHERE id = ?", [id]),
    dimensions: diagnosis.dimensions,
    evidence_needed: diagnosis.evidenceNeeded,
  };
}

function recordLearningCycle(db, experimentId) {
  const experiment = getCommercialExperiment(db, experimentId);
  if (!experiment) throw new Error(`Commercial experiment not found: ${experimentId}`);
  const summary = summarizeCommercialEvidence(db, { experimentId });
  const judgement = judgeEvidence(summary, experiment);
  const id = `learn_${safeSlug(experiment.name)}_${randomId().slice(0, 8)}`;
  const ts = now();
  run(
    db,
    `INSERT INTO commercial_learning_cycles
     (id, experiment_id, workflow_id, status, verdict, hypothesis, expected_metric, actual_result,
      learning, improvement, next_action, confidence, metadata, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      experiment.id,
      experiment.workflow_id || null,
      "recorded",
      judgement.verdict,
      experiment.hypothesis,
      experiment.expected_metric,
      resultSentence(summary),
      judgement.learning,
      judgement.improvement,
      judgement.nextAction,
      judgement.confidence,
      toJson({ summary, targetValue: experiment.target_value, targetUnit: experiment.target_unit }),
      ts,
    ],
  );
  let diagnosis = null;
  if (["diagnose", "revise"].includes(judgement.verdict)) {
    diagnosis = recordCommercialDiagnosis(db, experiment, summary, summary.latestResult?.id || null);
    run(
      db,
      "UPDATE commercial_learning_cycles SET metadata = ? WHERE id = ?",
      [
        toJson({
          summary,
          targetValue: experiment.target_value,
          targetUnit: experiment.target_unit,
          diagnosisId: diagnosis.id,
        }),
        id,
      ],
    );
  }
  run(
    db,
    "UPDATE commercial_experiments SET status = ?, ended_at = COALESCE(ended_at, ?), updated_at = ? WHERE id = ?",
    [statusForVerdict(judgement.verdict), judgement.verdict === "needs_evidence" ? null : ts, ts, experiment.id],
  );
  const learning = parseRows(all(db, "SELECT * FROM commercial_learning_cycles WHERE id = ?", [id]))[0];
  if (diagnosis) learning.diagnosis = diagnosis;
  return learning;
}

module.exports = {
  createCommercialExperiment,
  getCommercialExperiment,
  recordCommercialFeedback,
  recordCommercialFeedbackForTest,
  recordCommercialResult,
  recordCommercialResultForTest,
  recordCommercialDiagnosis,
  recordLearningCycle,
  summarizeCommercialEvidence,
  summarizeRows,
};
