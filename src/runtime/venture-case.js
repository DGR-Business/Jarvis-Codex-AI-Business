const CONFIG = require("../config");
const { all, fromJson, get, insertEvent, now, putSetting, randomId, run, toJson } = require("../db");

const VENTURE_STAGES = new Set(["candidate", "validating", "selling", "fulfilling", "scaling", "paused"]);
const EXPERIMENT_STATES = new Set(["candidate", "ready", "running", "completed", "cancelled"]);
const EVIDENCE_TYPES = new Set(["test_fixture", "operator_observation", "source_link", "platform_csv", "receipt"]);

function activeVenture(db) {
  return get(db, "SELECT * FROM ventures WHERE is_active = 1 ORDER BY updated_at DESC LIMIT 1");
}

function putSettingIfMissing(db, key, value) {
  if (!get(db, "SELECT key FROM settings WHERE key = ?", [key])) {
    putSetting(db, key, value);
  }
}

function ensureActiveVentureCase(db) {
  const ts = now();
  putSettingIfMissing(db, "operator.workload", {
    targetMinutesPerWeek: 480,
    intensiveWeekMaximumMinutes: 960,
    intensiveWeekRequiresApproval: true,
    timeValueCentsPerHour: 5000,
    longTermMode: "weekly digest plus important exceptions",
  });
  putSettingIfMissing(db, "commercial.pilot", {
    businessModel: "evidence_selected",
    platform: "evidence_selected",
    oneActiveVenture: true,
    successBuyers: 3,
    requirePositiveCashContribution: true,
    publicIdentity: "faceless_and_voiceless",
    organicPostLimit: 3,
    organicChannelLimit: 2,
    testDurationDays: 14,
    qualifiedViewTarget: 50,
    zeroSalesStopRequiresBuyerEvidenceException: true,
    optionalPaidTestCents: 2500,
    paidTestRequiresOperatorApproval: true,
    deferPaidMediaToolsUntilSales: 3,
  });
  putSettingIfMissing(db, "budget", {
    monthlyBudgetCents: CONFIG.monthlyBudgetCents,
    currency: CONFIG.currency,
    internalMandateEnabled: true,
    protectedExternalSpend: true,
    notes: "Pantheon may perform internal AI analysis and read-only research within A$100/month. External spend and consequential actions remain protected.",
  });
  putSettingIfMissing(db, "commercial.constitution", {
    opportunityMode: "broad_to_deep",
    acceptsOperatorIdeas: true,
    activeVentureLimitBeforeProof: 1,
    activeVentureLimitAfterProof: 3,
    proofBuyers: 3,
    proofRequiresPositiveCashContribution: true,
    catalogueRule: "minimum_credible_catalogue_for_venture",
    reinvestmentRate: 0.30,
    monthlyDiscretionaryBudgetCents: CONFIG.monthlyBudgetCents,
    publicIdentity: "faceless_and_voiceless",
    defaultLanguage: "English",
    defaultMarket: "global",
    b2bQualityRule: "production_ready_only",
    failureRule: "diagnose_before_pause",
  });
  run(
    db,
    `INSERT INTO ventures
     (id, name, stage, status, summary, metadata, created_at, updated_at,
      lifecycle_stage, is_active, business_model)
     VALUES ('venture-digital-products', 'First Venture', 1, 'validating', ?, ?, ?, ?, 'validating',
       CASE WHEN EXISTS (SELECT 1 FROM ventures WHERE is_active = 1) THEN 0 ELSE 1 END,
       'unselected')
     ON CONFLICT(id) DO NOTHING`,
    [
      "The sole active venture until one evidence-selected offer proves three independent buyers and positive cash contribution.",
      toJson({
        channel: "Evidence-selected distribution",
        publicIdentity: "faceless_and_voiceless",
        successThreshold: "3 independent paid buyers and positive cash contribution",
      }),
      ts,
      ts,
    ],
  );
  const venture = activeVenture(db);
  run(
    db,
    `INSERT INTO venture_cases
     (id, venture_id, buyer, problem, offer, price_cents, channel, evidence_standard,
      contribution_assumption_cents, expected_metric, kill_rule, next_money_move,
      metadata, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(venture_id) DO NOTHING`,
    [
      `case_${venture.id}`,
      venture.id,
      "A specific buyer segment will be selected from evidence.",
      "A painful, repeated and purchasable problem still needs validation.",
      "The smallest credible commercial offer that solves the validated problem.",
      0,
      "One or more evidence-selected channels with supportable economics.",
      "Source-linked demand plus a measurable real-world buyer test.",
      0,
      "Three independent paid buyers with positive cash contribution.",
      "Stop after 50 qualified product views and zero sales without strong qualified interest.",
      "Run broad market discovery, compare three qualified candidates, and invest only if one passes every commercial gate.",
      toJson({ oneActiveVenture: true, faceless: true, voiceless: true, platform: "evidence_selected" }),
      ts,
      ts,
    ],
  );
  return getVentureCase(db, venture.id);
}

function getVentureCase(db, ventureId) {
  const row = get(db, "SELECT * FROM venture_cases WHERE venture_id = ?", [ventureId]);
  return row ? { ...row, metadata: fromJson(row.metadata) } : null;
}

function updateVentureCase(db, ventureId, changes = {}) {
  const allowed = [
    "buyer", "problem", "offer", "price_cents", "channel", "evidence_standard",
    "contribution_assumption_cents", "active_experiment_id", "deadline", "expected_metric",
    "kill_rule", "next_money_move", "operator_decision", "latest_learning",
  ];
  const entries = Object.entries(changes).filter(([key]) => allowed.includes(key));
  if (!entries.length) return getVentureCase(db, ventureId);
  const assignments = entries.map(([key]) => `${key} = ?`).join(", ");
  run(db, `UPDATE venture_cases SET ${assignments}, updated_at = ? WHERE venture_id = ?`, [...entries.map(([, value]) => value), now(), ventureId]);
  return getVentureCase(db, ventureId);
}

function setVentureStage(db, ventureId, stage) {
  if (!VENTURE_STAGES.has(stage)) throw new Error(`Unsupported venture stage: ${stage}`);
  const ts = now();
  run(db, "UPDATE ventures SET lifecycle_stage = ?, status = ?, updated_at = ? WHERE id = ?", [stage, stage, ts, ventureId]);
  insertEvent(db, {
    actor: "commercial-runtime",
    type: "venture.stage_changed",
    entityType: "venture",
    entityId: ventureId,
    message: `The active venture moved to ${stage}.`,
  });
  return get(db, "SELECT * FROM ventures WHERE id = ?", [ventureId]);
}

function setExperimentState(db, experimentId, status, options = {}) {
  if (!EXPERIMENT_STATES.has(status)) throw new Error(`Unsupported test state: ${status}`);
  const experiment = get(db, "SELECT * FROM commercial_experiments WHERE id = ?", [experimentId]);
  if (!experiment) throw new Error(`Commercial test not found: ${experimentId}`);
  if (status === "running" && !options.realStart) {
    throw new Error("A test can only be marked running when a real-world start is confirmed.");
  }
  const ts = now();
  const metadata = {
    ...fromJson(experiment.metadata),
    ...(status === "running" ? { realStartConfirmed: true, realStartConfirmedAt: ts } : {}),
  };
  run(
    db,
    `UPDATE commercial_experiments
     SET status = ?, started_at = CASE WHEN ? = 'running' THEN COALESCE(started_at, ?) ELSE started_at END,
         ended_at = CASE WHEN ? IN ('completed', 'cancelled') THEN COALESCE(ended_at, ?) ELSE ended_at END,
         metadata = ?, updated_at = ? WHERE id = ?`,
    [status, status, ts, status, ts, toJson(metadata), ts, experimentId],
  );
  return get(db, "SELECT * FROM commercial_experiments WHERE id = ?", [experimentId]);
}

function recordEvidence(db, input) {
  if (!EVIDENCE_TYPES.has(input.sourceType)) throw new Error(`Unsupported evidence source: ${input.sourceType}`);
  if (!input.ventureId || !input.title) throw new Error("Evidence needs a venture and title.");
  if (input.sourceType === "source_link" && !input.sourceUrl) {
    throw new Error("Source-linked evidence needs the exact public URL.");
  }
  const claim = String(input.claim || input.summary || "").trim();
  if (!claim) throw new Error("Evidence needs the exact commercial claim it supports or challenges.");
  const id = input.id || `evidence_${randomId()}`;
  const ts = now();
  run(
    db,
    `INSERT INTO commercial_evidence
     (id, venture_id, experiment_id, source_type, source_id, source_url, title, summary,
      captured_at, verified_at, is_demo, metadata, created_at, claim, metric, measured_value,
      measured_unit, market, geography, observed_at, sample_size, publisher,
      extraction_method, confidence)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.ventureId,
      input.experimentId || null,
      input.sourceType,
      input.sourceId || null,
      input.sourceUrl || null,
      input.title,
      input.summary || "",
      input.capturedAt || ts,
      input.verified ? ts : null,
      input.isDemo ? 1 : 0,
      toJson(input.metadata),
      ts,
      claim,
      input.metric || "",
      input.measuredValue ?? input.measured_value ?? null,
      input.measuredUnit || input.measured_unit || "",
      input.market || "",
      input.geography || "",
      input.observedAt || input.observed_at || null,
      input.sampleSize ?? input.sample_size ?? null,
      input.publisher || "",
      input.extractionMethod || input.extraction_method || "",
      input.confidence || "unknown",
    ],
  );
  return get(db, "SELECT * FROM commercial_evidence WHERE id = ?", [id]);
}

function ventureEconomics(db, ventureId) {
  const sales = get(
    db,
    `SELECT COALESCE(SUM(aud_gross_cents), 0) AS gross,
            COALESCE(SUM(aud_platform_fee_cents), 0) AS fees,
            COALESCE(SUM(aud_refunded_cents), 0) AS refunds,
            COUNT(CASE WHEN aud_gross_cents IS NULL THEN 1 END) AS unconverted_count,
            COUNT(*) AS sale_rows,
            GROUP_CONCAT(DISTINCT currency) AS source_currencies,
            COUNT(DISTINCT CASE
              WHEN status = 'paid' AND buyer_hash IS NOT NULL AND refunded_cents < gross_cents
              THEN buyer_hash END) AS buyers
     FROM platform_sales WHERE venture_id = ? AND status IN ('paid', 'refunded', 'disputed')`,
    [ventureId],
  );
  const resultCosts = get(
    db,
    `SELECT COALESCE(SUM(revenue_cents), 0) AS revenue,
            COALESCE(SUM(refund_amount_cents), 0) AS refunds,
            COALESCE(SUM(platform_fee_cents), 0) AS platform_fees,
            COALESCE(SUM(spend_cents), 0) AS spend,
            COALESCE(SUM(fulfilment_cost_cents), 0) AS fulfilment,
            COALESCE(SUM(product_cost_cents), 0) AS product,
            COALESCE(SUM(tool_cost_cents), 0) AS tools,
            COALESCE(SUM(attributed_ai_cost_cents), 0) AS attributed_ai,
            COALESCE(SUM(other_cost_cents), 0) AS other_costs,
            COALESCE(SUM(time_spent_minutes), 0) AS minutes
     FROM commercial_results WHERE venture_id = ? AND verified = 1`,
    [ventureId],
  );
  const providerCosts = get(
    db,
    `SELECT COALESCE(SUM(amount_cents), 0) AS provider_costs
     FROM costs
     WHERE venture_id = ? AND status = 'reconciled' AND currency = 'AUD'
       AND source <> 'commercial_result'`,
    [ventureId],
  );
  const workload = fromJson(get(db, "SELECT value FROM settings WHERE key = 'operator.workload'")?.value, {});
  const aiCostsCents = Math.max(
    Number(resultCosts?.attributed_ai || 0),
    Number(providerCosts?.provider_costs || 0),
  );
  const operatingCostsCents = Number(resultCosts?.spend || 0)
    + Number(resultCosts?.fulfilment || 0)
    + Number(resultCosts?.product || 0)
    + Number(resultCosts?.tools || 0)
    + Number(resultCosts?.other_costs || 0)
    + aiCostsCents;
  const currencyMismatch = Number(sales?.unconverted_count || 0) > 0;
  const importedSalesExist = Number(sales?.sale_rows || 0) > 0;
  const grossRevenueCents = importedSalesExist
    ? Number(sales?.gross || 0)
    : Number(resultCosts?.revenue || 0);
  const platformFeesCents = importedSalesExist
    ? Number(sales?.fees || 0)
    : Number(resultCosts?.platform_fees || 0);
  const refundsCents = importedSalesExist
    ? Number(sales?.refunds || 0)
    : Number(resultCosts?.refunds || 0);
  const platformContributionCents = grossRevenueCents - platformFeesCents - refundsCents;
  const cashContributionCents = currencyMismatch ? null : platformContributionCents - operatingCostsCents;
  const timeValueCents = Math.round((Number(resultCosts?.minutes || 0) / 60) * Number(workload.timeValueCentsPerHour || 5000));
  return {
    grossRevenueCents,
    platformFeesCents,
    refundsCents,
    externalSpendCents: Number(resultCosts?.spend || 0),
    productCostsCents: Number(resultCosts?.product || 0),
    fulfilmentCostsCents: Number(resultCosts?.fulfilment || 0),
    toolCostsCents: Number(resultCosts?.tools || 0),
    providerCostsCents: aiCostsCents,
    otherCostsCents: Number(resultCosts?.other_costs || 0),
    cashContributionCents,
    salesCurrency: "AUD",
    sourceCurrencies: String(sales?.source_currencies || "").split(",").filter(Boolean),
    unconvertedSalesCount: Number(sales?.unconverted_count || 0),
    platformContributionCents: currencyMismatch ? null : platformContributionCents,
    currencyMismatch,
    operatorMinutes: Number(resultCosts?.minutes || 0),
    operatorTimeValueCents: timeValueCents,
    timeAdjustedContributionCents: cashContributionCents === null ? null : cashContributionCents - timeValueCents,
    independentBuyers: Number(sales?.buyers || 0),
    successThresholdMet: !currencyMismatch && Number(sales?.buyers || 0) >= 3 && cashContributionCents > 0,
    timeValueIsPlanningEstimate: true,
  };
}

function commercialFoundationState(db) {
  const ventureCase = ensureActiveVentureCase(db);
  const venture = activeVenture(db);
  const evidence = all(
    db,
    "SELECT * FROM commercial_evidence WHERE venture_id = ? AND is_demo = 0 ORDER BY captured_at DESC LIMIT 20",
    [venture.id],
  ).map((item) => ({ ...item, metadata: fromJson(item.metadata) }));
  return { venture, ventureCase, economics: ventureEconomics(db, venture.id), evidence };
}

module.exports = {
  EVIDENCE_TYPES,
  EXPERIMENT_STATES,
  VENTURE_STAGES,
  activeVenture,
  commercialFoundationState,
  ensureActiveVentureCase,
  getVentureCase,
  recordEvidence,
  setExperimentState,
  setVentureStage,
  updateVentureCase,
  ventureEconomics,
};
