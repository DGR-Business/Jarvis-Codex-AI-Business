"use strict";

const crypto = require("node:crypto");

const { all, fromJson, get, insertEvent, now, run, toJson } = require("../db");
const {
  getCommercialOwnerTestsState,
} = require("./commercial-owner-state");

const EXECUTIVE_DIGEST_METRICS_SCHEMA = "pantheon.executive-digest.metrics.v2";
const NO_AUTHORISED_TEST = "No commercial test is authorised";
const METRIC_KEYS = new Set([
  "schema",
  "completedWork",
  "openDecisions",
  "unknownOutcomes",
  "operatingIssues",
  "verifiedBuyerCount",
  "buyerTarget",
  "cashStatus",
  "cashContributionCents",
  "salesCurrency",
  "currentTest",
  "commercialIntegrityStatus",
  "commercialAuthorityStatus",
  "commercialSnapshotHash",
]);

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, canonical(value[key])]),
    );
  }
  return value ?? null;
}

function commercialSnapshotHash(ownerTests) {
  const {
    generatedAt: _generatedAt,
    ...safeProjection
  } = ownerTests && typeof ownerTests === "object" ? ownerTests : {};
  return crypto
    .createHash("sha256")
    .update(
      `pantheon.executive-digest.owner-snapshot.v1\0${
        JSON.stringify(canonical(safeProjection))
      }`,
      "utf8",
    )
    .digest("hex");
}

function canonicalCommercialMetrics(ownerTests) {
  const integrityOk = ownerTests?.integrity?.status === "ok";
  const current = integrityOk
    ? ownerTests.current
    : null;
  const hasCurrentTest = Boolean(current);
  const verifiedBuyerCount = integrityOk && hasCurrentTest
    ? Number.isSafeInteger(current?.proof?.buyers?.verifiedPositive)
      && current.proof.buyers.verifiedPositive >= 0
      ? current.proof.buyers.verifiedPositive
      : 0
    : null;
  const netCash = current?.proof?.netCashContribution;
  const cashSettled = (
    netCash?.status === "settled"
    && netCash.currency === "AUD"
    && Number.isSafeInteger(netCash.amountCents)
  );
  return {
    verifiedBuyerCount,
    buyerTarget: integrityOk && hasCurrentTest
      ? Number.isSafeInteger(current?.proof?.buyers?.target)
        ? current.proof.buyers.target
        : 3
      : null,
    cashStatus: !integrityOk
      ? "withheld"
      : hasCurrentTest
        ? cashSettled ? "settled" : "not_settled"
        : "not_current",
    cashContributionCents: cashSettled ? netCash.amountCents : null,
    salesCurrency: "AUD",
    currentTest: current ? {
      auditRef: current.auditRef,
      name: current.title,
      status: current.lifecycle?.status || "proposed",
      statusLabel: current.lifecycle?.label || "Proposed",
      canonicalOwnerProjection: true,
    } : null,
    commercialIntegrityStatus: ownerTests?.integrity?.status || "attention",
    commercialAuthorityStatus:
      ownerTests?.integrity?.authorityStatus || "unavailable",
    commercialSnapshotHash: commercialSnapshotHash(ownerTests),
  };
}

function activeVentureId(db) {
  const venture = get(
    db,
    "SELECT id FROM ventures WHERE is_active = 1 ORDER BY updated_at DESC LIMIT 1",
  );
  if (!venture?.id) {
    throw new Error("A weekly executive digest requires one active venture.");
  }
  return venture.id;
}

function formatAud(cents) {
  return `A$${(cents / 100).toFixed(2)}`;
}

function storedCommercialMetricsMatch(metrics, expected) {
  const metricKeys = metrics && typeof metrics === "object"
    ? Object.keys(metrics)
    : [];
  if (
    !metrics
    || typeof metrics !== "object"
    || Array.isArray(metrics)
    || metrics.schema !== EXECUTIVE_DIGEST_METRICS_SCHEMA
    || metricKeys.length !== METRIC_KEYS.size
    || metricKeys.some((key) => !METRIC_KEYS.has(key))
  ) {
    return false;
  }
  const commercialKeys = [
    "verifiedBuyerCount",
    "buyerTarget",
    "cashStatus",
    "cashContributionCents",
    "salesCurrency",
    "currentTest",
    "commercialIntegrityStatus",
    "commercialAuthorityStatus",
    "commercialSnapshotHash",
  ];
  return commercialKeys.every((key) => (
    JSON.stringify(canonical(metrics[key]))
    === JSON.stringify(canonical(expected[key]))
  ));
}

function storedDigestMatches(existing, expected) {
  if (
    !existing
    || !storedCommercialMetricsMatch(existing.metrics, expected.metrics)
  ) {
    return false;
  }
  const storedProjection = {
    periodStart: existing.period_start,
    periodEnd: existing.period_end,
    status: existing.status,
    title: existing.title,
    summary: existing.summary,
    metrics: existing.metrics,
    decisions: existing.decisions,
    learning: existing.learning,
    nextActions: existing.nextActions,
  };
  const expectedProjection = {
    periodStart: expected.window.start,
    periodEnd: expected.window.end,
    status: expected.status,
    title: expected.title,
    summary: expected.summary,
    metrics: expected.metrics,
    decisions: expected.decisions,
    learning: expected.learning,
    nextActions: expected.nextActions,
  };
  return JSON.stringify(canonical(storedProjection))
    === JSON.stringify(canonical(expectedProjection));
}

function weekWindow(value = new Date()) {
  const start = new Date(value);
  start.setHours(0, 0, 0, 0);
  const daysSinceMonday = (start.getDay() + 6) % 7;
  start.setDate(start.getDate() - daysSinceMonday);
  const end = new Date(start);
  end.setDate(end.getDate() + 7);
  return { start: start.toISOString(), end: end.toISOString() };
}

function parseDigest(row) {
  if (!row) return null;
  return {
    ...row,
    metrics: fromJson(row.metrics, {}),
    decisions: fromJson(row.decisions, []),
    learning: fromJson(row.learning, []),
    nextActions: fromJson(row.next_actions, []),
  };
}

function buildWeeklyDigestProjection(db, options, ownerTests) {
  const window = weekWindow(options.at ? new Date(options.at) : new Date());
  const ventureId = activeVentureId(db);
  const commercial = canonicalCommercialMetrics(ownerTests);
  const completedWork = Number(get(
    db,
    "SELECT COUNT(*) AS count FROM tasks WHERE venture_id = ? AND status = 'completed' AND completed_at >= ? AND completed_at < ?",
    [ventureId, window.start, window.end],
  )?.count || 0);
  const openApprovals = Number(get(
    db,
    "SELECT COUNT(*) AS count FROM approvals WHERE venture_id = ? AND status = 'pending'",
    [ventureId],
  )?.count || 0);
  const openHandoffs = Number(get(
    db,
    `SELECT COUNT(*) AS count
     FROM agent_handoffs AS handoffs
     LEFT JOIN workflows AS workflows ON workflows.id = handoffs.workflow_id
     LEFT JOIN tasks AS tasks ON tasks.id = handoffs.task_id
     WHERE handoffs.status IN (
       'needs_operator_decision',
       'waiting_for_review',
       'waiting_approval'
     )
       AND COALESCE(workflows.venture_id, tasks.venture_id) = ?`,
    [ventureId],
  )?.count || 0);
  const openDecisions = openApprovals + openHandoffs;
  const unknownOutcomes = Number(get(
    db,
    "SELECT COUNT(*) AS count FROM tasks WHERE venture_id = ? AND outcome_status = 'unknown'",
    [ventureId],
  )?.count || 0);
  const operatingIssues = Number(get(
    db,
    `SELECT COUNT(*) AS count
     FROM monitor_findings
     WHERE venture_id = ? AND status = 'open'
       AND (
         severity = 'error'
         OR category IN ('quality_review', 'agent_context', 'chief_assignment')
       )`,
    [ventureId],
  )?.count || 0);
  const decisions = all(
    db,
    `SELECT title, status, decision_note, decided_at
     FROM approvals WHERE venture_id = ? AND decided_at >= ? AND decided_at < ?
     ORDER BY decided_at DESC LIMIT 12`,
    [ventureId, window.start, window.end],
  );
  const current = ownerTests?.integrity?.status === "ok"
    ? ownerTests.current
    : null;
  const learning = [current?.evidenceQuality?.summary].filter(Boolean);
  const importantCount = openDecisions + unknownOutcomes + operatingIssues;
  const commercialNeedsAttention = ownerTests?.integrity?.status !== "ok";
  const canonicalNextAction = current?.moneyMove?.detail
    || (ownerTests?.integrity?.status === "ok"
      ? ownerTests?.emptyState?.summary
      : ownerTests?.integrity?.message);
  const nextActions = [
    canonicalNextAction,
    ...(unknownOutcomes ? ["Reconcile unknown provider outcomes and costs; do not repeat affected work automatically."] : []),
    ...(operatingIssues ? ["Review the operating issue Pantheon found before relying on the affected AI work."] : []),
    ...(openDecisions ? ["Review the waiting consequential decisions."] : []),
  ].filter(Boolean);
  const buyerStatement = commercial.verifiedBuyerCount === null
    ? commercial.cashStatus === "not_current"
      ? "No current commercial test buyer result is available."
      : "Verified buyer count is withheld."
    : `${commercial.verifiedBuyerCount} verified paying buyer${
      commercial.verifiedBuyerCount === 1 ? "" : "s"
    } recorded.`;
  const cashStatement = commercial.cashStatus === "withheld"
    ? "Net cash contribution is withheld."
    : commercial.cashStatus === "not_current"
      ? "No current commercial test net cash result is available."
    : commercial.cashStatus === "settled"
    ? `${formatAud(commercial.cashContributionCents)} settled net cash contribution recorded.`
    : "Net cash contribution: Not settled.";
  const testStatement = current
    ? `The current commercial test contract is ${String(
      current.lifecycle?.status || "proposed",
    ).replace(/[_-]+/g, " ")}.`
    : ownerTests?.integrity?.status === "ok"
      ? `${ownerTests?.emptyState?.title || NO_AUTHORISED_TEST}.`
      : ownerTests?.integrity?.message
        || "Commercial test authority could not be verified.";
  const summary = [
    `${completedWork} internal work item${completedWork === 1 ? "" : "s"} completed this week.`,
    buyerStatement,
    cashStatement,
    testStatement,
    importantCount
      ? `${importantCount} item${importantCount === 1 ? " needs" : "s need"} operator attention.`
      : commercialNeedsAttention
        ? "Commercial truth needs operator attention."
        : "No consequential exception needs operator attention.",
  ].join(" ");
  const status = importantCount || commercialNeedsAttention
    ? "attention_needed"
    : "on_track";
  const id = `digest_${ventureId.replace(/[^a-z0-9]+/gi, "_")}_${window.start.slice(0, 10)}`;
  const metrics = {
    schema: EXECUTIVE_DIGEST_METRICS_SCHEMA,
    completedWork,
    openDecisions,
    unknownOutcomes,
    operatingIssues,
    ...commercial,
  };
  return {
    window,
    ventureId,
    id,
    status,
    title: "Weekly executive brief",
    summary,
    metrics,
    decisions,
    learning,
    nextActions,
    importantCount,
  };
}

function generateWeeklyDigestFromOwnerState(
  db,
  options,
  ownerTests,
  preparedProjection = null,
) {
  const projection = preparedProjection
    || buildWeeklyDigestProjection(db, options, ownerTests);
  const {
    window,
    ventureId,
    id,
    status,
    title,
    summary,
    metrics,
    decisions,
    learning,
    nextActions,
    importantCount,
  } = projection;
  const generatedAt = now();
  run(
    db,
    `INSERT INTO executive_digests
     (id, venture_id, period_start, period_end, status, title, summary, metrics,
      decisions, learning, next_actions, generated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(venture_id, period_start) DO UPDATE SET
       id = excluded.id,
       period_end = excluded.period_end,
       status = excluded.status,
       title = excluded.title,
       summary = excluded.summary,
       metrics = excluded.metrics,
       decisions = excluded.decisions,
       learning = excluded.learning,
       next_actions = excluded.next_actions,
       generated_at = excluded.generated_at`,
    [id, ventureId, window.start, window.end, status, title, summary, toJson(metrics), toJson(decisions), toJson(learning), toJson(nextActions), generatedAt],
  );
  const digest = parseDigest(get(
    db,
    "SELECT * FROM executive_digests WHERE venture_id = ? AND period_start = ?",
    [ventureId, window.start],
  ));
  insertEvent(db, {
    actor: "executive-digest",
    type: "executive_digest.generated",
    entityType: "venture",
    entityId: ventureId,
    message: "The weekly executive brief was refreshed.",
    metadata: { digestId: digest.id, status, importantCount },
  });
  return digest;
}

function generateWeeklyDigest(db, options = {}) {
  return generateWeeklyDigestFromOwnerState(
    db,
    options,
    getCommercialOwnerTestsState(db),
  );
}

function ensureWeeklyDigest(db, options = {}) {
  const ventureId = activeVentureId(db);
  const window = weekWindow(options.at ? new Date(options.at) : new Date());
  const existing = parseDigest(get(
    db,
    "SELECT * FROM executive_digests WHERE venture_id = ? AND period_start = ?",
    [ventureId, window.start],
  ));
  const ownerTests = getCommercialOwnerTestsState(db);
  const expected = buildWeeklyDigestProjection(db, options, ownerTests);
  if (!storedDigestMatches(existing, expected)) {
    return generateWeeklyDigestFromOwnerState(
      db,
      options,
      ownerTests,
      expected,
    );
  }
  return existing;
}

function getCanonicalOwnerDigest(db, options = {}) {
  const resolvedVentureId = get(
    db,
    "SELECT id FROM ventures WHERE is_active = 1 ORDER BY updated_at DESC LIMIT 1",
  )?.id;
  if (!resolvedVentureId) return null;
  return ensureWeeklyDigest(db, options);
}

function getLatestDigest(db, ventureId = null, options = {}) {
  const activeId = get(
    db,
    "SELECT id FROM ventures WHERE is_active = 1 ORDER BY updated_at DESC LIMIT 1",
  )?.id;
  if (!activeId || (ventureId && ventureId !== activeId)) return null;
  return getCanonicalOwnerDigest(db, options);
}

module.exports = {
  EXECUTIVE_DIGEST_METRICS_SCHEMA,
  ensureWeeklyDigest,
  generateWeeklyDigest,
  getCanonicalOwnerDigest,
  getLatestDigest,
  weekWindow,
};
