const { all, fromJson, get, now, run, toJson } = require("../db");

const CASH_ENTRY_TYPES = new Set(["cash_outflow", "prepaid_credit_purchase"]);

function asCents(value, field = "amountCents") {
  const cents = Number(value);
  if (!Number.isInteger(cents) || cents < 0) {
    throw new Error(`${field} must be a non-negative whole number of cents.`);
  }
  return cents;
}

function recordAccountingEntry(db, input) {
  if (!input?.id || !input.entryType || !input.category || !input.source || !input.description) {
    throw new Error("Accounting entries need an id, type, category, source and description.");
  }
  const currency = input.currency || "AUD";
  if (currency !== "AUD") throw new Error("The accounting ledger stores canonical values in AUD only.");
  const ts = now();
  const amountCents = asCents(input.amountCents);
  const occurredAt = input.occurredAt || ts;
  run(
    db,
    `INSERT INTO accounting_entries
     (id, venture_id, entry_type, category, source, description, status, amount_cents,
      currency, occurred_at, next_due_at, metadata, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       venture_id = excluded.venture_id,
       entry_type = excluded.entry_type,
       category = excluded.category,
       source = excluded.source,
       description = excluded.description,
       status = excluded.status,
       amount_cents = excluded.amount_cents,
       currency = excluded.currency,
       occurred_at = excluded.occurred_at,
       next_due_at = excluded.next_due_at,
       metadata = excluded.metadata,
       updated_at = excluded.updated_at`,
    [
      input.id,
      input.ventureId || null,
      input.entryType,
      input.category,
      input.source,
      input.description,
      input.status || "reconciled",
      amountCents,
      currency,
      occurredAt,
      input.nextDueAt || null,
      toJson(input.metadata || {}),
      ts,
      ts,
    ],
  );
  return hydrate(get(db, "SELECT * FROM accounting_entries WHERE id = ?", [input.id]));
}

function hydrate(row) {
  return row ? { ...row, metadata: fromJson(row.metadata) } : null;
}

function getAccountingSummary(db, options = {}) {
  const month = options.month || new Date().toISOString().slice(0, 7);
  const entries = all(db, "SELECT * FROM accounting_entries ORDER BY occurred_at DESC, created_at DESC")
    .map(hydrate);
  const cashPaidCents = entries
    .filter((entry) => entry.status === "reconciled"
      && CASH_ENTRY_TYPES.has(entry.entry_type)
      && String(entry.occurred_at).slice(0, 7) === month)
    .reduce((sum, entry) => sum + Number(entry.amount_cents || 0), 0);
  const recurringMonthlyCents = entries
    .filter((entry) => entry.entry_type === "recurring_commitment" && entry.status === "active")
    .reduce((sum, entry) => sum + Number(entry.amount_cents || 0), 0);
  return {
    currency: "AUD",
    month,
    cashPaidCents,
    recurringMonthlyCents,
    entryCount: entries.length,
    recent: entries.slice(0, Number(options.limit || 8)),
  };
}

module.exports = {
  getAccountingSummary,
  recordAccountingEntry,
};
