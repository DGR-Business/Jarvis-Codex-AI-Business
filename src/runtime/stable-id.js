const crypto = require("node:crypto");

function stableIdSegment(value, maxLength = 88, fallback = "item") {
  if (!Number.isInteger(maxLength) || maxLength < 18) {
    throw new Error("Stable ID segments require a maximum length of at least 18 characters.");
  }
  const raw = String(value || fallback);
  const sanitized = raw.replace(/[^a-zA-Z0-9_-]+/g, "_") || fallback;
  if (sanitized === raw && sanitized.length <= maxLength) return sanitized;

  const digest = crypto.createHash("sha256").update(raw).digest("hex").slice(0, 12);
  const head = sanitized.slice(0, maxLength - digest.length - 1);
  return `${head}_${digest}`;
}

function spendCostId(taskId) {
  return `cost_spend_${stableIdSegment(taskId, 88, "task")}`;
}

module.exports = {
  spendCostId,
  stableIdSegment,
};
