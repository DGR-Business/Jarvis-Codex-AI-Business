const { all, fromJson, get, insertEvent, now, run, toJson } = require("../db");
const { commercialFoundationState } = require("./venture-case");

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

function generateWeeklyDigest(db, options = {}) {
  const commercial = commercialFoundationState(db);
  const window = weekWindow(options.at ? new Date(options.at) : new Date());
  const ventureId = commercial.venture.id;
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
    `SELECT COUNT(*) AS count FROM agent_handoffs
     WHERE status IN ('needs_operator_decision', 'waiting_for_review', 'waiting_approval')`,
  )?.count || 0);
  const openDecisions = openApprovals + openHandoffs;
  const unknownOutcomes = Number(get(
    db,
    "SELECT COUNT(*) AS count FROM tasks WHERE venture_id = ? AND outcome_status = 'unknown'",
    [ventureId],
  )?.count || 0);
  const decisions = all(
    db,
    `SELECT title, status, decision_note, decided_at
     FROM approvals WHERE venture_id = ? AND decided_at >= ? AND decided_at < ?
     ORDER BY decided_at DESC LIMIT 12`,
    [ventureId, window.start, window.end],
  );
  const learning = [commercial.ventureCase.latest_learning].filter(Boolean);
  const currentTest = get(
    db,
    `SELECT name, status, expected_metric FROM commercial_experiments
     WHERE venture_id = ? AND status IN ('ready', 'running')
     ORDER BY CASE status WHEN 'running' THEN 0 ELSE 1 END, updated_at DESC LIMIT 1`,
    [ventureId],
  );
  const importantCount = openDecisions + unknownOutcomes;
  const nextActions = [
    commercial.ventureCase.next_money_move,
    ...(unknownOutcomes ? ["Reconcile unknown provider outcomes and costs; do not repeat affected work automatically."] : []),
    ...(openDecisions ? ["Review the waiting consequential decisions."] : []),
  ].filter(Boolean);
  const summary = [
    `${completedWork} internal work item${completedWork === 1 ? "" : "s"} completed this week.`,
    `${commercial.economics.independentBuyers} independent paying buyer${commercial.economics.independentBuyers === 1 ? "" : "s"} recorded.`,
    currentTest ? `The current business test is ${String(currentTest.status).replace(/[_-]+/g, " ")}.` : "No real-world business test is running yet.",
    importantCount
      ? `${importantCount} item${importantCount === 1 ? " needs" : "s need"} operator attention.`
      : "No consequential exception needs operator attention.",
  ].join(" ");
  const status = importantCount ? "attention_needed" : "on_track";
  const id = `digest_${ventureId.replace(/[^a-z0-9]+/gi, "_")}_${window.start.slice(0, 10)}`;
  const generatedAt = now();
  const metrics = {
    completedWork,
    openDecisions,
    unknownOutcomes,
    independentBuyers: commercial.economics.independentBuyers,
    cashContributionCents: commercial.economics.cashContributionCents,
    salesCurrency: commercial.economics.salesCurrency,
    currentTest: currentTest ? { name: currentTest.name, status: currentTest.status, metric: currentTest.expected_metric } : null,
  };
  run(
    db,
    `INSERT INTO executive_digests
     (id, venture_id, period_start, period_end, status, title, summary, metrics,
      decisions, learning, next_actions, generated_at)
     VALUES (?, ?, ?, ?, ?, 'Weekly executive brief', ?, ?, ?, ?, ?, ?)
     ON CONFLICT(venture_id, period_start) DO UPDATE SET
       period_end = excluded.period_end,
       status = excluded.status,
       summary = excluded.summary,
       metrics = excluded.metrics,
       decisions = excluded.decisions,
       learning = excluded.learning,
       next_actions = excluded.next_actions,
       generated_at = excluded.generated_at`,
    [id, ventureId, window.start, window.end, status, summary, toJson(metrics), toJson(decisions), toJson(learning), toJson(nextActions), generatedAt],
  );
  insertEvent(db, {
    actor: "executive-digest",
    type: "executive_digest.generated",
    entityType: "venture",
    entityId: ventureId,
    message: "The weekly executive brief was refreshed.",
    metadata: { digestId: id, status, importantCount },
  });
  return parseDigest(get(db, "SELECT * FROM executive_digests WHERE id = ?", [id]));
}

function ensureWeeklyDigest(db, options = {}) {
  const commercial = commercialFoundationState(db);
  const window = weekWindow(options.at ? new Date(options.at) : new Date());
  return parseDigest(get(
    db,
    "SELECT * FROM executive_digests WHERE venture_id = ? AND period_start = ?",
    [commercial.venture.id, window.start],
  )) || generateWeeklyDigest(db, options);
}

function getLatestDigest(db, ventureId = "venture-digital-products") {
  return parseDigest(get(
    db,
    "SELECT * FROM executive_digests WHERE venture_id = ? ORDER BY period_end DESC LIMIT 1",
    [ventureId],
  ));
}

module.exports = {
  ensureWeeklyDigest,
  generateWeeklyDigest,
  getLatestDigest,
  weekWindow,
};
