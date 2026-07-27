const { all, fromJson, get, now, run, toJson } = require("../db");

const CASH_ENTRY_TYPES = new Set(["cash_outflow", "prepaid_credit_purchase"]);

function asCents(value, field = "amountCents") {
  const cents = Number(value);
  if (!Number.isInteger(cents) || cents < 0) {
    throw new Error(`${field} must be a non-negative whole number of cents.`);
  }
  return cents;
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sameEntry(existing, expected) {
  return existing.venture_id === expected.ventureId
    && existing.entry_type === expected.entryType
    && existing.category === expected.category
    && existing.source === expected.source
    && existing.description === expected.description
    && existing.status === expected.status
    && Number(existing.amount_cents) === expected.amountCents
    && existing.currency === expected.currency
    && existing.occurred_at === expected.occurredAt
    && existing.next_due_at === expected.nextDueAt
    && Number(existing.effect_sign || 1) === expected.effectSign
    && existing.supersedes_entry_id === expected.supersedesEntryId
    && existing.reverses_entry_id === expected.reversesEntryId
    && existing.revision_reason === expected.revisionReason
    && stableJson(fromJson(existing.metadata)) === stableJson(expected.metadata);
}

function recordAccountingEntry(db, input) {
  if (!input?.id || !input.entryType || !input.category || !input.source || !input.description) {
    throw new Error("Accounting entries need an id, type, category, source and description.");
  }
  const currency = input.currency || "AUD";
  if (currency !== "AUD") throw new Error("The accounting ledger stores canonical values in AUD only.");
  const ts = now();
  const amountCents = asCents(input.amountCents);
  const existing = get(db, "SELECT * FROM accounting_entries WHERE id = ?", [input.id]);
  const entry = {
    ventureId: input.ventureId || null,
    entryType: input.entryType,
    category: input.category,
    source: input.source,
    description: input.description,
    status: input.status || "reconciled",
    amountCents,
    currency,
    occurredAt: input.occurredAt || existing?.occurred_at || ts,
    nextDueAt: input.nextDueAt || null,
    metadata: input.metadata || {},
    effectSign: input.effectSign === -1 ? -1 : 1,
    supersedesEntryId: input.supersedesEntryId || null,
    reversesEntryId: input.reversesEntryId || null,
    revisionReason: input.revisionReason || null,
  };
  if (existing) {
    if (sameEntry(existing, entry)) return hydrate(existing);
    throw new Error(`Accounting entry ${input.id} is immutable; record a reversal or revision with a new id.`);
  }
  run(
    db,
    `INSERT INTO accounting_entries
     (id, venture_id, entry_type, category, source, description, status, amount_cents,
      currency, occurred_at, next_due_at, metadata, created_at, updated_at, effect_sign,
      supersedes_entry_id, reverses_entry_id, revision_reason)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.id,
      entry.ventureId,
      entry.entryType,
      entry.category,
      entry.source,
      entry.description,
      entry.status,
      entry.amountCents,
      entry.currency,
      entry.occurredAt,
      entry.nextDueAt,
      toJson(entry.metadata),
      ts,
      ts,
      entry.effectSign,
      entry.supersedesEntryId,
      entry.reversesEntryId,
      entry.revisionReason,
    ],
  );
  return hydrate(get(db, "SELECT * FROM accounting_entries WHERE id = ?", [input.id]));
}

function recordAccountingCorrection(db, input) {
  if (!input?.originalEntryId || !input.reversalId || !input.reason) {
    throw new Error("Accounting corrections need an original entry, reversal id and reason.");
  }
  const original = get(db, "SELECT * FROM accounting_entries WHERE id = ?", [input.originalEntryId]);
  if (!original) throw new Error(`Accounting entry not found: ${input.originalEntryId}`);
  db.exec("BEGIN IMMEDIATE");
  try {
    const reversal = recordAccountingEntry(db, {
      id: input.reversalId,
      ventureId: original.venture_id,
      entryType: original.entry_type,
      category: original.category,
      source: original.source,
      description: `Reversal: ${original.description}`,
      status: "reconciled",
      amountCents: Number(original.amount_cents),
      occurredAt: input.occurredAt || now(),
      metadata: { correctionOf: original.id },
      effectSign: -Number(original.effect_sign || 1),
      reversesEntryId: original.id,
      revisionReason: input.reason,
    });
    let replacement = null;
    if (input.replacement) {
      replacement = recordAccountingEntry(db, {
        ventureId: original.venture_id,
        entryType: original.entry_type,
        category: original.category,
        source: original.source,
        description: original.description,
        status: original.status,
        amountCents: Number(original.amount_cents),
        occurredAt: input.occurredAt || now(),
        nextDueAt: original.next_due_at,
        metadata: fromJson(original.metadata),
        ...input.replacement,
        id: input.replacement.id,
        supersedesEntryId: original.id,
        revisionReason: input.reason,
      });
    }
    db.exec("COMMIT");
    return { original: hydrate(original), reversal, replacement };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function hydrate(row) {
  return row ? { ...row, metadata: fromJson(row.metadata) } : null;
}

function getAccountingSummary(db, options = {}) {
  const month = options.month || new Date().toISOString().slice(0, 7);
  const entries = all(db, "SELECT * FROM accounting_entries ORDER BY occurred_at DESC, created_at DESC")
    .map(hydrate);
  const reversedEntryIds = new Set(
    entries.map((entry) => entry.reverses_entry_id).filter(Boolean),
  );
  const currentEntries = entries.filter((entry) => (
    Number(entry.effect_sign || 1) === 1
    && !reversedEntryIds.has(entry.id)
  ));
  const cashPaidCents = entries
    .filter((entry) => entry.status === "reconciled"
      && CASH_ENTRY_TYPES.has(entry.entry_type)
      && String(entry.occurred_at).slice(0, 7) === month)
    .reduce((sum, entry) => sum + (Number(entry.amount_cents || 0) * Number(entry.effect_sign || 1)), 0);
  const recurringMonthlyCents = entries
    .filter((entry) => entry.entry_type === "recurring_commitment" && entry.status === "active")
    .reduce((sum, entry) => sum + (Number(entry.amount_cents || 0) * Number(entry.effect_sign || 1)), 0);
  return {
    currency: "AUD",
    month,
    cashPaidCents,
    recurringMonthlyCents,
    entryCount: entries.length,
    currentEntryCount: currentEntries.length,
    recent: currentEntries.slice(0, Number(options.limit || 8)),
  };
}

module.exports = {
  getAccountingSummary,
  recordAccountingCorrection,
  recordAccountingEntry,
};
