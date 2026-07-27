const CONFIG = require("../config");
const { fromJson, get, insertEvent, now, run, toJson } = require("../db");
const { decideApproval } = require("./approvals");
const { journeyBudgetExposure, monthlyBudgetExposure } = require("./cost-ledger");

const INTERNAL_ACTIONS = Object.freeze([
  "live_ai_worker",
  "live_research",
  "read_only_research",
  "local_product_generation",
  "local_quality_review",
  "internal_analysis",
  "internal_drafting",
]);

const PROTECTED_ACTIONS = Object.freeze([
  "public_publishing",
  "customer_contact",
  "account_creation_or_change",
  "kyc_oauth_or_mfa",
  "paid_advertising_activation",
  "money_movement",
  "legal_agreement",
  "tax_or_compliance_determination",
  "customer_dispute_or_refund",
]);

const SAFE_INTERNAL_TOOLS = new Set([
  "research_adapter",
  "live_web_with_approval",
  "image_generation_spend",
  "product_file_factory",
  "visual_asset_review",
]);

function brisbaneMonth() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Australia/Brisbane",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}`;
}

function monthRange(month = brisbaneMonth()) {
  const [year, monthNumber] = String(month).split("-").map(Number);
  const next = new Date(Date.UTC(year, monthNumber, 1));
  return {
    month,
    periodStart: `${month}-01`,
    periodEnd: next.toISOString().slice(0, 10),
  };
}

function ensureOperatingMandate(db, options = {}) {
  const range = monthRange(options.month);
  const id = `mandate_${range.month}`;
  const existing = get(db, "SELECT * FROM operating_mandates WHERE id = ?", [id]);
  if (existing) return {
    ...existing,
    allowed_internal_actions: fromJson(existing.allowed_internal_actions, []),
    protected_actions: fromJson(existing.protected_actions, []),
    metadata: fromJson(existing.metadata, {}),
  };
  const ts = now();
  run(
    db,
    `INSERT INTO operating_mandates
     (id, period_start, period_end, currency, budget_cap_cents, reinvestment_rate, status,
      allowed_internal_actions, protected_actions, metadata, created_at, updated_at)
     VALUES (?, ?, ?, 'AUD', ?, 0.30, 'active', ?, ?, ?, ?, ?)`,
    [
      id,
      range.periodStart,
      range.periodEnd,
      Number(options.budgetCapCents || CONFIG.monthlyBudgetCents),
      toJson(INTERNAL_ACTIONS),
      toJson(PROTECTED_ACTIONS),
      toJson({
        excludesChatGptSubscription: true,
        operator: "Daniel",
        technicalSteward: "Jarvis (Codex)",
        system: "Pantheon",
      }),
      ts,
      ts,
    ],
  );
  insertEvent(db, {
    actor: "pantheon",
    type: "operating_mandate.created",
    entityType: "operating_mandate",
    entityId: id,
    message: `Pantheon's ${range.month} internal operating mandate is active with an A$${(Number(options.budgetCapCents || CONFIG.monthlyBudgetCents) / 100).toFixed(2)} cap.`,
    metadata: { month: range.month, protectedActions: PROTECTED_ACTIONS },
  });
  return ensureOperatingMandate(db, options);
}

function operatingMandateState(db, options = {}) {
  const mandate = ensureOperatingMandate(db, options);
  const exposure = monthlyBudgetExposure(db, { month: mandate.id.replace(/^mandate_/, "") });
  return {
    mandate,
    exposure,
    remainingCents: Math.max(0, Number(mandate.budget_cap_cents) - exposure.totalCents),
  };
}

function classifyInternalApproval(approval) {
  const payload = fromJson(approval?.payload, {});
  const descriptor = payload.executionDescriptor || {};
  const effects = Array.isArray(payload.effects)
    ? payload.effects
    : Array.isArray(descriptor.externalEffects) ? descriptor.externalEffects : [];
  const tools = Array.isArray(payload.tools) ? payload.tools : [];
  const type = String(payload.type || descriptor.kind || "");
  const hardCapCents = Math.max(
    0,
    Number(payload.maxCostCents || payload.estimatedCostCents || 0),
  );
  const pricedWorstCaseCents = Math.max(
    0,
    Number(payload.worstCaseCostCents || descriptor.worstCaseCost?.amountCents || 0),
  );
  const amountCents = pricedWorstCaseCents > 0 && pricedWorstCaseCents <= hardCapCents
    ? pricedWorstCaseCents
    : hardCapCents;
  const operatorChoiceRequired = payload.parameters?.operatorChoiceRequired === true
    || descriptor.parameters?.operatorChoiceRequired === true;
  const journeyId = payload.parameters?.pantheonJourney?.journeyId
    || payload.parameters?.pantheonCommercial?.journeyId
    || payload.parameters?.pantheonProduction?.journeyId
    || descriptor.parameters?.pantheonJourney?.journeyId
    || descriptor.parameters?.pantheonCommercial?.journeyId
    || descriptor.parameters?.pantheonProduction?.journeyId
    || null;
  const allowedType = ["live_ai_worker", "live_research"].includes(type);
  const allowedTools = tools.every((toolId) => SAFE_INTERNAL_TOOLS.has(toolId));
  const protectedEffect = effects.length > 0;
  return {
    eligible: Boolean(
      approval
      && approval.status === "pending"
      && payload.liveSpendRequest === true
      && descriptor.descriptorHash
      && approval.scope_hash
      && allowedType
      && allowedTools
      && !protectedEffect
      && !operatorChoiceRequired
      && String(approval.risk_level || "low") !== "high"
      && amountCents > 0
    ),
    amountCents,
    hardCapCents,
    pricedWorstCaseCents,
    type,
    tools,
    effects,
    journeyId,
    reason: !approval
      ? "approval_missing"
      : approval.status !== "pending"
        ? "approval_not_pending"
        : !payload.liveSpendRequest
          ? "not_paid_internal_work"
          : !descriptor.descriptorHash
            ? "execution_descriptor_missing"
            : !approval.scope_hash
              ? "approval_scope_missing"
              : !allowedType
                ? "action_type_not_in_mandate"
                : !allowedTools
                  ? "tool_not_in_mandate"
                  : protectedEffect
                  ? "external_effect_requires_daniel"
                  : operatorChoiceRequired
                    ? "operator_choice_required"
                  : String(approval.risk_level || "low") === "high"
                      ? "high_risk_requires_daniel"
                      : amountCents <= 0
                        ? "cost_cap_missing"
                        : null,
  };
}

function approveInternalWorkWithinMandate(db, approvalId, options = {}) {
  const approval = get(db, "SELECT * FROM approvals WHERE id = ?", [approvalId]);
  const classification = classifyInternalApproval(approval);
  if (!classification.eligible) {
    return { approved: false, reason: classification.reason, classification };
  }
  const state = operatingMandateState(db);
  if (classification.amountCents > state.remainingCents) {
    insertEvent(db, {
      level: "warn",
      actor: "pantheon",
      type: "operating_mandate.insufficient_room",
      entityType: "approval",
      entityId: approvalId,
      message: "Pantheon stopped internal paid work because its exact cap would exceed the monthly operating mandate.",
      metadata: {
        requestedCents: classification.amountCents,
        remainingCents: state.remainingCents,
        mandateId: state.mandate.id,
      },
    });
    return {
      approved: false,
      reason: "monthly_mandate_exceeded",
      classification,
      mandate: state,
    };
  }
  if (classification.journeyId) {
    const journey = get(
      db,
      `SELECT id, budget_cap_cents, carried_exposure_cents
       FROM pantheon_journeys WHERE id = ?`,
      [classification.journeyId],
    );
    if (!journey) {
      return { approved: false, reason: "journey_missing", classification, mandate: state };
    }
    const journeyExposure = journeyBudgetExposure(
      db,
      journey.id,
      journey.carried_exposure_cents,
    );
    if (journeyExposure.totalCents + classification.amountCents > Number(journey.budget_cap_cents)) {
      insertEvent(db, {
        level: "warn",
        actor: "pantheon",
        type: "pantheon.journey_budget_stopped",
        entityType: "pantheon_journey",
        entityId: journey.id,
        message: `Pantheon stopped before the full journey could exceed its exact A$${(Number(journey.budget_cap_cents) / 100).toFixed(2)} limit.`,
        metadata: {
          requestedCents: classification.amountCents,
          currentExposureCents: journeyExposure.totalCents,
          capCents: Number(journey.budget_cap_cents),
          approvalId,
        },
      });
      return {
        approved: false,
        reason: "journey_budget_exceeded",
        classification,
        mandate: state,
        journey: { ...journey, exposure: journeyExposure },
      };
    }
  }
  const result = decideApproval(
    db,
    approvalId,
    "approved",
    options.note || `Approved automatically under ${state.mandate.id} for exact internal work only.`,
    {
      expectedScopeHash: approval.scope_hash,
      decidedBy: "pantheon_operating_mandate",
    },
  );
  insertEvent(db, {
    actor: "pantheon",
    type: "operating_mandate.internal_work_approved",
    entityType: "approval",
    entityId: approvalId,
    message: "Pantheon approved one exact internal AI action within Daniel's monthly operating mandate.",
    metadata: {
      mandateId: state.mandate.id,
      amountCents: classification.amountCents,
      type: classification.type,
      tools: classification.tools,
      scopeHash: approval.scope_hash,
    },
  });
  return {
    approved: true,
    result,
    classification,
    mandate: operatingMandateState(db),
  };
}

module.exports = {
  INTERNAL_ACTIONS,
  PROTECTED_ACTIONS,
  approveInternalWorkWithinMandate,
  classifyInternalApproval,
  ensureOperatingMandate,
  operatingMandateState,
};
