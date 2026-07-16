const CONFIG = require("../config");
const { all, fromJson, get, insertEvent, now, putSetting, randomId, run, toJson } = require("../db");

const VENTURE_STAGES = new Set(["candidate", "validating", "selling", "fulfilling", "scaling", "paused"]);
const EXPERIMENT_STATES = new Set(["candidate", "ready", "running", "completed", "cancelled"]);
const EVIDENCE_TYPES = new Set(["test_fixture", "operator_observation", "source_link", "platform_csv", "receipt"]);

function activeVenture(db) {
  return get(db, "SELECT * FROM ventures WHERE is_active = 1 ORDER BY updated_at DESC LIMIT 1")
    || get(db, "SELECT * FROM ventures WHERE id = 'venture-digital-products'");
}

function ensureActiveVentureCase(db) {
  const ts = now();
  putSetting(db, "operator.workload", {
    targetMinutesPerWeek: 480,
    intensiveWeekMaximumMinutes: 960,
    intensiveWeekRequiresApproval: true,
    timeValueCentsPerHour: 5000,
    longTermMode: "weekly digest plus important exceptions",
  });
  putSetting(db, "commercial.pilot", {
    businessModel: "digital_product",
    platform: "gumroad_direct",
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
  putSetting(db, "budget", {
    monthlyBudgetCents: CONFIG.monthlyBudgetCents,
    currency: CONFIG.currency,
    spendRequiresApproval: true,
    notes: "Pre-revenue cap: A$100/month. Each AI pilot and market test also has its own explicit cap.",
  });
  run(
    db,
    `INSERT INTO ventures
     (id, name, stage, status, summary, metadata, created_at, updated_at,
      lifecycle_stage, is_active, business_model)
     VALUES ('venture-digital-products', 'Digital Products', 1, 'validating', ?, ?, ?, ?, 'validating', 1, 'digital_product')
     ON CONFLICT(id) DO UPDATE SET
       status = CASE
         WHEN ventures.lifecycle_stage IN ('candidate', 'validating', 'selling', 'fulfilling', 'scaling', 'paused')
           THEN ventures.lifecycle_stage
         ELSE 'validating'
       END,
       summary = CASE
         WHEN ventures.summary LIKE '%dry-run%' OR ventures.summary LIKE '%proof%'
           THEN excluded.summary
         ELSE ventures.summary
       END,
       metadata = json_patch(
         CASE WHEN json_valid(ventures.metadata) THEN ventures.metadata ELSE '{}' END,
         excluded.metadata
       ),
       lifecycle_stage = CASE
         WHEN ventures.lifecycle_stage IN ('candidate', 'validating', 'selling', 'fulfilling', 'scaling', 'paused')
           THEN ventures.lifecycle_stage
         ELSE 'validating'
       END,
       is_active = CASE WHEN NOT EXISTS (SELECT 1 FROM ventures active WHERE active.is_active = 1) THEN 1 ELSE ventures.is_active END,
       business_model = COALESCE(ventures.business_model, 'digital_product')`,
    [
      "The sole active venture until one digital-product offer proves three independent buyers and positive cash contribution.",
      toJson({
        channel: "Gumroad Direct plus bounded organic distribution",
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
      "The smallest useful digital product that solves the validated problem.",
      0,
      "Gumroad Direct plus up to two evidence-selected organic channels.",
      "Source-linked demand plus a measurable real-world buyer test.",
      0,
      "Three independent paid buyers with positive cash contribution.",
      "Stop after 50 qualified product views and zero sales without strong qualified interest.",
      "Rank three digital-product opportunities and select one evidence-backed test.",
      toJson({ oneActiveVenture: true, faceless: true, voiceless: true, platform: "gumroad_direct" }),
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
  const id = input.id || `evidence_${randomId()}`;
  const ts = now();
  run(
    db,
    `INSERT INTO commercial_evidence
     (id, venture_id, experiment_id, source_type, source_id, source_url, title, summary,
      captured_at, verified_at, is_demo, metadata, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
    ],
  );
  return get(db, "SELECT * FROM commercial_evidence WHERE id = ?", [id]);
}

function ventureEconomics(db, ventureId) {
  const sales = get(
    db,
    `SELECT COALESCE(SUM(gross_cents), 0) AS gross,
            COALESCE(SUM(platform_fee_cents), 0) AS fees,
            COALESCE(SUM(refunded_cents), 0) AS refunds,
            MIN(currency) AS sales_currency,
            COUNT(DISTINCT currency) AS currency_count,
            COUNT(DISTINCT CASE
              WHEN status = 'paid' AND buyer_hash IS NOT NULL AND refunded_cents < gross_cents
              THEN buyer_hash END) AS buyers
     FROM platform_sales WHERE venture_id = ? AND status IN ('paid', 'refunded', 'disputed')`,
    [ventureId],
  );
  const resultCosts = get(
    db,
    `SELECT COALESCE(SUM(spend_cents), 0) AS spend,
            COALESCE(SUM(product_cost_cents), 0) AS product,
            COALESCE(SUM(tool_cost_cents), 0) AS tools,
            COALESCE(SUM(time_spent_minutes), 0) AS minutes
     FROM commercial_results WHERE venture_id = ? AND verified = 1`,
    [ventureId],
  );
  const workload = fromJson(get(db, "SELECT value FROM settings WHERE key = 'operator.workload'")?.value, {});
  const operatingCostsCents = Number(resultCosts?.spend || 0)
    + Number(resultCosts?.product || 0)
    + Number(resultCosts?.tools || 0);
  const salesCurrency = sales?.sales_currency || CONFIG.currency;
  const currencyMismatch = Number(sales?.currency_count || 0) > 1
    || (salesCurrency !== CONFIG.currency && operatingCostsCents > 0);
  const platformContributionCents = Number(sales?.gross || 0)
    - Number(sales?.fees || 0)
    - Number(sales?.refunds || 0);
  const cashContributionCents = currencyMismatch ? null : platformContributionCents - operatingCostsCents;
  const timeValueCents = Math.round((Number(resultCosts?.minutes || 0) / 60) * Number(workload.timeValueCentsPerHour || 5000));
  return {
    grossRevenueCents: Number(sales?.gross || 0),
    platformFeesCents: Number(sales?.fees || 0),
    refundsCents: Number(sales?.refunds || 0),
    externalSpendCents: Number(resultCosts?.spend || 0),
    productCostsCents: Number(resultCosts?.product || 0),
    toolCostsCents: Number(resultCosts?.tools || 0),
    cashContributionCents,
    salesCurrency,
    platformContributionCents,
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
  const venture = activeVenture(db);
  const ventureCase = ensureActiveVentureCase(db);
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
