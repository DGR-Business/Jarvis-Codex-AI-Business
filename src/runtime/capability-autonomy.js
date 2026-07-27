const { get, insertEvent, now, randomId, run, toJson } = require("../db");
const { ensureAiTeam } = require("./ai-team");

const DEFAULT_CAPABILITIES = [
  {
    key: "demand_validator.reasoning_on_supplied_evidence",
    agentId: "demand_validator",
    riskTier: 0,
    maxCostCents: 100,
  },
  {
    key: "demand_validator.read_only_web_research",
    agentId: "demand_validator",
    riskTier: 1,
    maxCostCents: 200,
  },
];

function ensureCapabilityAutonomy(db) {
  ensureAiTeam(db);
  const ts = now();
  for (const capability of DEFAULT_CAPABILITIES) {
    run(
      db,
      `INSERT INTO capability_autonomy
       (id, capability_key, agent_id, risk_tier, status, consecutive_passes, required_passes,
        max_cost_cents, metadata, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'supervised', 0, 5, ?, ?, ?, ?)
       ON CONFLICT(capability_key) DO UPDATE SET
         risk_tier = excluded.risk_tier,
         max_cost_cents = excluded.max_cost_cents,
         updated_at = excluded.updated_at`,
      [
        `capability_${capability.key.replace(/[^a-z0-9]+/gi, "_")}`,
        capability.key,
        capability.agentId,
        capability.riskTier,
        capability.maxCostCents,
        toJson({ promotionRequiresOperator: true, exactCapabilityOnly: true }),
        ts,
        ts,
      ],
    );
  }
}

function recordCapabilityReview(db, capabilityKey, review) {
  ensureCapabilityAutonomy(db);
  const capability = get(db, "SELECT * FROM capability_autonomy WHERE capability_key = ?", [capabilityKey]);
  if (!capability) throw new Error(`Capability not found: ${capabilityKey}`);
  const passed = review.operatorReviewed === true
    && review.useful === true
    && review.scopeViolation !== true
    && review.costViolation !== true
    && review.riskViolation !== true
    && review.outcomeKnown !== false;
  const ts = now();
  if (passed) {
    const count = Number(capability.consecutive_passes || 0) + 1;
    const status = count >= Number(capability.required_passes || 5) ? "eligible" : "supervised";
    run(
      db,
      `UPDATE capability_autonomy
       SET status = ?, consecutive_passes = ?, last_review_at = ?, suspended_at = NULL, updated_at = ?
       WHERE id = ?`,
      [status, count, ts, ts, capability.id],
    );
  } else {
    const wasPromoted = capability.status === "promoted";
    const activeVenture = get(
      db,
      "SELECT id FROM ventures WHERE is_active = 1 ORDER BY created_at ASC LIMIT 1",
    );
    run(
      db,
      `UPDATE capability_autonomy
       SET status = ?, consecutive_passes = 0, suspended_at = ?, last_review_at = ?, updated_at = ?
       WHERE id = ?`,
      [wasPromoted ? "suspended" : "supervised", wasPromoted ? ts : null, ts, ts, capability.id],
    );
    run(
      db,
      `INSERT INTO messages (id, venture_id, severity, status, subject, body, created_at, metadata)
       VALUES (?, ?, 'urgent', 'open', ?, ?, ?, ?)`,
      [
        `msg_capability_${randomId()}`,
        review.ventureId || activeVenture?.id || null,
        "Worker capability needs review",
        `${capabilityKey} did not pass its latest reviewed run. Its promotion streak was reset.`,
        ts,
        toJson({ capabilityKey, review }),
      ],
    );
  }
  insertEvent(db, {
    level: passed ? "info" : "warn",
    actor: "capability-review",
    type: passed ? "capability.review_passed" : "capability.review_failed",
    entityType: "capability",
    entityId: capability.id,
    message: passed ? `${capabilityKey} passed a reviewed run.` : `${capabilityKey} needs correction before promotion.`,
    metadata: review,
  });
  return get(db, "SELECT * FROM capability_autonomy WHERE id = ?", [capability.id]);
}

function promoteCapability(db, capabilityKey, operatorNote = "") {
  ensureCapabilityAutonomy(db);
  const capability = get(db, "SELECT * FROM capability_autonomy WHERE capability_key = ?", [capabilityKey]);
  if (!capability || capability.status !== "eligible" || capability.consecutive_passes < capability.required_passes) {
    throw new Error("This exact capability has not completed five consecutive successful reviewed runs.");
  }
  const ts = now();
  run(
    db,
    "UPDATE capability_autonomy SET status = 'promoted', promoted_at = ?, updated_at = ?, metadata = ? WHERE id = ?",
    [ts, ts, toJson({ promotionRequiresOperator: true, exactCapabilityOnly: true, operatorNote }), capability.id],
  );
  return get(db, "SELECT * FROM capability_autonomy WHERE id = ?", [capability.id]);
}

module.exports = {
  DEFAULT_CAPABILITIES,
  ensureCapabilityAutonomy,
  promoteCapability,
  recordCapabilityReview,
};
