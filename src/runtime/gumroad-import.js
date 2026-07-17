const crypto = require("node:crypto");
const { parse } = require("csv-parse/sync");
const { all, fromJson, get, insertEvent, now, randomId, run, toJson } = require("../db");
const { recordEvidence, ventureEconomics } = require("./venture-case");

const PLATFORM = "gumroad";
const REQUIRED_HEADERS = ["Purchase ID", "Item Name", "Purchase Date", "Sale Price ($)", "Fees ($)", "Net Total ($)"];

function field(row, names) {
  for (const name of names) {
    if (row[name] !== undefined && row[name] !== null && String(row[name]).trim() !== "") return String(row[name]).trim();
  }
  return "";
}

function flag(value) {
  return ["1", "true", "yes", "y"].includes(String(value || "").trim().toLowerCase());
}

function moneyCents(value) {
  const raw = String(value || "0").trim();
  const negative = /^\(.*\)$/.test(raw) || /^-/.test(raw);
  const normalized = raw.replace(/[(),$A-Z\s]/gi, "").replace(/,/g, "").replace(/^-/, "");
  const amount = Number(normalized || 0);
  if (!Number.isFinite(amount)) throw new Error(`Invalid monetary value in Gumroad export: ${raw}`);
  return Math.round(amount * 100) * (negative ? -1 : 1);
}

function saleTimestamp(row) {
  const date = field(row, ["Purchase Date", "Purchase date"]);
  const time = field(row, ["Purchase Time (UTC timezone)", "Purchase Time", "Purchase time"]);
  const combined = `${date}${time ? ` ${time} UTC` : " UTC"}`.trim();
  const parsed = Date.parse(combined);
  if (!Number.isFinite(parsed)) throw new Error(`Invalid Gumroad purchase date: ${combined}`);
  return new Date(parsed).toISOString();
}

function privacyKey(options = {}) {
  const key = options.hashKey || process.env.JARVIS_PRIVACY_HASH_KEY;
  if (!key || String(key).length < 24) {
    throw new Error("JARVIS_PRIVACY_HASH_KEY must be configured before buyer records can be imported.");
  }
  return String(key);
}

function buyerHash(row, key) {
  const email = field(row, ["Purchase email", "Buyer Email", "Email"]).toLowerCase();
  if (!email) return null;
  return crypto.createHmac("sha256", key).update(`gumroad-buyer:${email}`).digest("hex");
}

function safeReferrer(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (raw.toLowerCase() === "direct") return "direct";
  try {
    return new URL(raw.includes("://") ? raw : `https://${raw}`).hostname.toLowerCase();
  } catch {
    return raw.replace(/[?#].*$/, "").slice(0, 200);
  }
}

function rowStatus(row, grossCents, refundedCents) {
  const disputed = flag(field(row, ["Disputed?"]));
  const disputeWon = flag(field(row, ["Dispute won?"]));
  if (disputed && !disputeWon) return "disputed";
  if (flag(field(row, ["Fully Refunded?", "Refunded?"])) || refundedCents >= grossCents) return "refunded";
  return "paid";
}

function audConversion(input = {}, importedAt = now()) {
  const sourceCurrency = String(input.currency || "USD").trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(sourceCurrency)) throw new Error("Gumroad currency must be a three-letter currency code.");
  if (sourceCurrency === "AUD") {
    return {
      sourceCurrency,
      rate: 1,
      evidence: "Native AUD Gumroad export",
      convertedAt: input.audConversionAt || importedAt,
    };
  }
  const rate = Number(input.audConversionRate);
  const evidence = String(input.audConversionEvidence || "").trim();
  if (!Number.isFinite(rate) || rate <= 0) {
    throw new Error(`A positive AUD conversion rate is required for ${sourceCurrency} Gumroad sales.`);
  }
  if (!evidence) {
    throw new Error(`AUD conversion evidence is required for ${sourceCurrency} Gumroad sales.`);
  }
  const convertedAt = input.audConversionAt || importedAt;
  if (!Number.isFinite(Date.parse(convertedAt))) throw new Error("AUD conversion time must be a valid date.");
  return { sourceCurrency, rate, evidence, convertedAt: new Date(convertedAt).toISOString() };
}

function toAudCents(sourceCents, rate) {
  return Math.round(Number(sourceCents || 0) * rate);
}

function normalizeSale(row, conversion, key) {
  const purchaseId = field(row, ["Purchase ID", "Purchase Id", "purchase_id"]);
  const productName = field(row, ["Item Name", "Product", "Product Name"]);
  if (!purchaseId || !productName) throw new Error("Every Gumroad sale needs a Purchase ID and Item Name.");
  const grossCents = moneyCents(field(row, ["Sale Price ($)", "Sale Price", "Price"]));
  const feeCents = Math.abs(moneyCents(field(row, ["Fees ($)", "Fees", "Fee"])));
  const exportedNet = moneyCents(field(row, ["Net Total ($)", "Net Total", "Net"]));
  const partialRefund = Math.abs(moneyCents(field(row, ["Partial Refund ($)", "Partial Refund"])));
  const fullyRefunded = flag(field(row, ["Fully Refunded?"])) || (flag(field(row, ["Refunded?"])) && partialRefund === 0);
  const refundedCents = fullyRefunded ? grossCents : Math.min(grossCents, partialRefund);
  const status = rowStatus(row, grossCents, refundedCents);
  return {
    purchaseId,
    productName,
    soldAt: saleTimestamp(row),
    currency: conversion.sourceCurrency,
    grossCents,
    feeCents,
    netCents: exportedNet,
    refundedCents,
    audGrossCents: toAudCents(grossCents, conversion.rate),
    audFeeCents: toAudCents(feeCents, conversion.rate),
    audNetCents: toAudCents(exportedNet, conversion.rate),
    audRefundedCents: toAudCents(refundedCents, conversion.rate),
    referrer: safeReferrer(field(row, ["Referrer"])),
    buyerHash: buyerHash(row, key),
    status,
    metadata: {
      rating: field(row, ["Rating"]) || null,
      discover: flag(field(row, ["Discover?"])),
      disputed: flag(field(row, ["Disputed?"])),
      feeAndNetFromPlatformExport: true,
      rawPersonalFieldsRetained: false,
      audNormalized: true,
    },
  };
}

function parseGumroadCsv(csvText) {
  const text = String(csvText || "");
  if (!text.trim()) throw new Error("Choose a Gumroad sales CSV before importing.");
  const records = parse(text, {
    bom: true,
    columns: true,
    skip_empty_lines: true,
    relax_column_count: false,
    trim: true,
  });
  const headers = records.length ? Object.keys(records[0]) : parse(text, { bom: true, to_line: 1 })[0] || [];
  const missing = REQUIRED_HEADERS.filter((header) => !headers.includes(header));
  if (missing.length) throw new Error(`Gumroad CSV is missing required columns: ${missing.join(", ")}.`);
  return records;
}

function importGumroadCsv(db, input, options = {}) {
  const ventureId = input.ventureId || "venture-digital-products";
  const venture = get(db, "SELECT id FROM ventures WHERE id = ?", [ventureId]);
  if (!venture) throw new Error(`Venture not found: ${ventureId}`);
  const key = privacyKey(options);
  const records = parseGumroadCsv(input.csvText);
  const sourceHash = crypto.createHash("sha256").update(String(input.csvText)).digest("hex");
  let inserted = 0;
  let updated = 0;
  let anonymous = 0;
  const ts = now();
  const conversion = audConversion(input, ts);
  const normalizedEvidenceHash = crypto.createHash("sha256")
    .update(`${sourceHash}:${conversion.sourceCurrency}:${conversion.rate}:${conversion.evidence}:${conversion.convertedAt}`)
    .digest("hex");
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const record of records) {
      const sale = normalizeSale(record, conversion, key);
      const existing = get(
        db,
        "SELECT id FROM platform_sales WHERE platform = ? AND platform_purchase_id = ?",
        [PLATFORM, sale.purchaseId],
      );
      const id = existing?.id || `sale_gumroad_${randomId()}`;
      run(
        db,
        `INSERT INTO platform_sales
         (id, venture_id, platform, platform_purchase_id, product_name, sold_at, currency,
          gross_cents, platform_fee_cents, net_cents, refunded_cents, referrer, buyer_hash,
          status, metadata, imported_at, aud_gross_cents, aud_platform_fee_cents,
          aud_net_cents, aud_refunded_cents, aud_conversion_rate, aud_conversion_evidence,
          aud_conversion_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(platform, platform_purchase_id) DO UPDATE SET
           venture_id = excluded.venture_id,
           product_name = excluded.product_name,
           sold_at = excluded.sold_at,
           currency = excluded.currency,
           gross_cents = excluded.gross_cents,
           platform_fee_cents = excluded.platform_fee_cents,
           net_cents = excluded.net_cents,
           refunded_cents = excluded.refunded_cents,
           referrer = excluded.referrer,
           buyer_hash = excluded.buyer_hash,
           status = excluded.status,
           metadata = excluded.metadata,
           imported_at = excluded.imported_at,
           aud_gross_cents = excluded.aud_gross_cents,
           aud_platform_fee_cents = excluded.aud_platform_fee_cents,
           aud_net_cents = excluded.aud_net_cents,
           aud_refunded_cents = excluded.aud_refunded_cents,
           aud_conversion_rate = excluded.aud_conversion_rate,
           aud_conversion_evidence = excluded.aud_conversion_evidence,
           aud_conversion_at = excluded.aud_conversion_at`,
        [
          id,
          ventureId,
          PLATFORM,
          sale.purchaseId,
          sale.productName,
          sale.soldAt,
          sale.currency,
          sale.grossCents,
          sale.feeCents,
          sale.netCents,
          sale.refundedCents,
          sale.referrer,
          sale.buyerHash,
          sale.status,
          toJson({ ...sale.metadata, sourceHash, normalizedEvidenceHash }),
          ts,
          sale.audGrossCents,
          sale.audFeeCents,
          sale.audNetCents,
          sale.audRefundedCents,
          conversion.rate,
          conversion.evidence,
          conversion.convertedAt,
        ],
      );
      if (existing) updated += 1;
      else inserted += 1;
      if (!sale.buyerHash) anonymous += 1;
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  const evidenceId = `evidence_gumroad_${normalizedEvidenceHash.slice(0, 20)}`;
  if (!get(db, "SELECT id FROM commercial_evidence WHERE id = ?", [evidenceId])) {
    recordEvidence(db, {
      id: evidenceId,
      ventureId,
      sourceType: "platform_csv",
      sourceId: sourceHash,
      title: "Gumroad sales export",
      summary: `${records.length} platform sale record${records.length === 1 ? "" : "s"} imported and normalized from ${conversion.sourceCurrency} to AUD; ${anonymous} lacked an email identifier and do not count as independently verified buyers.`,
      verified: true,
      metadata: {
        platform: PLATFORM,
        sourceHash,
        normalizedEvidenceHash,
        rows: records.length,
        sourceCurrency: conversion.sourceCurrency,
        audConversionRate: conversion.rate,
        audConversionEvidence: conversion.evidence,
        audConversionAt: conversion.convertedAt,
        rawCsvRetained: false,
      },
    });
  }
  insertEvent(db, {
    actor: "gumroad-import",
    type: "gumroad.sales_imported",
    entityType: "venture",
    entityId: ventureId,
    message: `Gumroad results imported: ${inserted} new and ${updated} updated sale records.`,
    metadata: {
      sourceHash,
      normalizedEvidenceHash,
      inserted,
      updated,
      anonymous,
      sourceCurrency: conversion.sourceCurrency,
      audConversionRate: conversion.rate,
      rawPersonalFieldsRetained: false,
    },
  });
  return {
    sourceHash,
    rows: records.length,
    inserted,
    updated,
    anonymousBuyerRecords: anonymous,
    sourceCurrency: conversion.sourceCurrency,
    audConversionRate: conversion.rate,
    economics: ventureEconomics(db, ventureId),
  };
}

function getGumroadSalesState(db, ventureId = "venture-digital-products") {
  const sales = all(
    db,
    `SELECT id, product_name, sold_at, currency, gross_cents, platform_fee_cents,
            net_cents, refunded_cents, aud_gross_cents, aud_platform_fee_cents,
            aud_net_cents, aud_refunded_cents, aud_conversion_rate,
            aud_conversion_evidence, aud_conversion_at, referrer, status, metadata, imported_at
     FROM platform_sales WHERE venture_id = ? AND platform = ? ORDER BY sold_at DESC`,
    [ventureId, PLATFORM],
  ).map((row) => ({ ...row, metadata: fromJson(row.metadata, {}) }));
  return { platform: PLATFORM, sales, economics: ventureEconomics(db, ventureId) };
}

module.exports = {
  audConversion,
  getGumroadSalesState,
  importGumroadCsv,
  moneyCents,
  parseGumroadCsv,
};
