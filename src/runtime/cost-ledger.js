const CONFIG = require("../config");
const { fromJson, get, now, randomId, run, toJson } = require("../db");

function monthlyCapCents(db) {
  const setting = get(db, "SELECT value FROM settings WHERE key = 'budget'");
  return Number(fromJson(setting?.value, {}).monthlyBudgetCents || CONFIG.monthlyBudgetCents);
}

function reservedThisMonth(db) {
  const month = new Date().toISOString().slice(0, 7);
  return Number(get(
    db,
    `SELECT COALESCE(SUM(amount_cents), 0) AS cents
     FROM budget_reservations
     WHERE substr(reserved_at, 1, 7) = ? AND status IN ('reserved', 'incurred_estimate', 'unknown')`,
    [month],
  )?.cents || 0);
}

function reserveBudget(db, task, approval, amountCents) {
  const amount = Math.max(0, Number(amountCents || 0));
  const existing = get(
    db,
    "SELECT * FROM budget_reservations WHERE task_id = ? AND status IN ('reserved', 'incurred_estimate', 'unknown') ORDER BY reserved_at DESC LIMIT 1",
    [task.id],
  );
  if (existing) return existing;
  const id = `reserve_${randomId()}`;
  const reservedAt = now();
  db.exec("BEGIN IMMEDIATE");
  try {
    const committed = reservedThisMonth(db);
    const cap = monthlyCapCents(db);
    if (amount > Number(task.cost_budget_cents || amount)) {
      throw new Error("Requested cost exceeds the task budget.");
    }
    if (committed + amount > cap) {
      throw new Error(`This request would exceed the monthly pre-revenue cap of ${cap} cents.`);
    }
    run(
      db,
      `INSERT INTO budget_reservations
       (id, venture_id, workflow_id, task_id, approval_id, status, amount_cents, currency, reserved_at, metadata)
       VALUES (?, ?, ?, ?, ?, 'reserved', ?, ?, ?, ?)`,
      [id, task.venture_id, task.workflow_id, task.id, approval?.id || null, amount, CONFIG.currency, reservedAt, toJson({ scopeHash: approval?.scope_hash || null })],
    );
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return get(db, "SELECT * FROM budget_reservations WHERE id = ?", [id]);
}

function resolveReservation(db, taskId, status, options = {}) {
  const allowed = new Set(["released", "incurred_estimate", "unknown", "reconciled"]);
  if (!allowed.has(status)) throw new Error(`Unsupported reservation status: ${status}`);
  const reservation = get(
    db,
    "SELECT * FROM budget_reservations WHERE task_id = ? AND status IN ('reserved', 'incurred_estimate', 'unknown') ORDER BY reserved_at DESC LIMIT 1",
    [taskId],
  );
  if (!reservation) return null;
  const amount = options.amountCents === undefined ? reservation.amount_cents : Math.max(0, Number(options.amountCents));
  const resolvedAt = ["released", "reconciled"].includes(status) ? now() : null;
  run(
    db,
    `UPDATE budget_reservations SET status = ?, amount_cents = ?, resolved_at = ?, metadata = ? WHERE id = ?`,
    [status, amount, resolvedAt, toJson({ ...fromJson(reservation.metadata), ...options.metadata }), reservation.id],
  );
  return get(db, "SELECT * FROM budget_reservations WHERE id = ?", [reservation.id]);
}

module.exports = {
  monthlyCapCents,
  reserveBudget,
  reservedThisMonth,
  resolveReservation,
};
