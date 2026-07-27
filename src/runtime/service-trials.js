const { all, fromJson, get, insertEvent, now, randomId, run, toJson } = require("../db");
const { operatingMandateState } = require("./pantheon-policy");

const MAX_SERVICE_TRIAL_CENTS = 2500;

function parseTrial(row) {
  if (!row) return null;
  return {
    id: row.id,
    serviceName: row.service_name,
    vendor: row.vendor,
    status: row.status,
    hypothesis: row.hypothesis,
    baseline: fromJson(row.baseline, {}),
    trialStart: row.trial_start,
    trialEnd: row.trial_end,
    capCents: row.cap_cents,
    actualCostCents: row.actual_cost_cents,
    evidenceQualityMetrics: fromJson(row.evidence_quality_metrics, {}),
    retentionThresholds: fromJson(row.retention_thresholds, {}),
    result: fromJson(row.result, {}),
    decision: row.decision,
    delegatedVendorCapability: row.delegated_vendor_capability === 1,
    renewalAt: row.renewal_at,
    metadata: fromJson(row.metadata, {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function validateThresholds(value) {
  const thresholds = value && typeof value === "object" ? value : {};
  const required = ["minimumUsefulFindings", "maximumCostPerUsefulFindingCents", "minimumEvidenceQualityImprovement"];
  const missing = required.filter((field) => !Number.isFinite(Number(thresholds[field])));
  if (missing.length) {
    throw new Error(`Service trial retention thresholds are missing: ${missing.join(", ")}.`);
  }
  return {
    minimumUsefulFindings: Math.max(1, Number(thresholds.minimumUsefulFindings)),
    maximumCostPerUsefulFindingCents: Math.max(0, Number(thresholds.maximumCostPerUsefulFindingCents)),
    minimumEvidenceQualityImprovement: Math.max(0, Number(thresholds.minimumEvidenceQualityImprovement)),
  };
}

function proposeServiceTrial(db, input = {}) {
  const serviceName = String(input.serviceName || "").trim();
  const vendor = String(input.vendor || "").trim();
  const hypothesis = String(input.hypothesis || "").trim();
  const baseline = input.baseline && typeof input.baseline === "object" ? input.baseline : {};
  const capCents = Math.round(Number(input.capCents || 0));
  if (!serviceName || !vendor || hypothesis.length < 20) {
    throw new Error("A service trial requires a service, vendor, and decision-relevant hypothesis.");
  }
  if (capCents <= 0 || capCents > MAX_SERVICE_TRIAL_CENTS) {
    throw new Error("A service trial cap must be between A$0.01 and A$25.00.");
  }
  if (!baseline.method || !baseline.decisionGap || !Number.isFinite(Number(baseline.usefulFindings))) {
    throw new Error("A service trial requires a public-data baseline, decision gap, and useful-finding count.");
  }
  const retentionThresholds = validateThresholds(input.retentionThresholds);
  const timestamp = now();
  const id = input.id || `service_trial_${randomId()}`;
  run(
    db,
    `INSERT INTO service_trials
     (id, service_name, vendor, status, hypothesis, baseline, trial_start, trial_end,
      cap_cents, actual_cost_cents, evidence_quality_metrics, retention_thresholds,
      result, decision, delegated_vendor_capability, renewal_at, metadata,
      created_at, updated_at)
     VALUES (?, ?, ?, 'proposed', ?, ?, NULL, NULL, ?, NULL, '{}', ?, '{}', '', 0, NULL, ?, ?, ?)`,
    [
      id,
      serviceName,
      vendor,
      hypothesis,
      toJson(baseline),
      capCents,
      toJson(retentionThresholds),
      toJson({
        accountCreationProtected: input.accountCreationProtected !== false,
        newTermsProtected: input.newTermsProtected !== false,
        checkoutProtected: input.checkoutProtected !== false,
      }),
      timestamp,
      timestamp,
    ],
  );
  insertEvent(db, {
    actor: "portfolio_controller",
    type: "service_trial.proposed",
    entityType: "service_trial",
    entityId: id,
    message: `Pantheon recorded a bounded comparison trial for ${serviceName}.`,
    metadata: { vendor, capCents },
  });
  return getServiceTrial(db, id);
}

function approveServiceTrialWithinMandate(db, id, options = {}) {
  const trial = getServiceTrial(db, id);
  if (!trial) throw new Error(`Service trial not found: ${id}`);
  if (trial.status !== "proposed") throw new Error("Only a proposed service trial can be approved.");
  const protectedSetupComplete = options.protectedSetupComplete === true
    || (
      trial.metadata.accountCreationProtected === false
      && trial.metadata.newTermsProtected === false
      && trial.metadata.checkoutProtected === false
    );
  if (!protectedSetupComplete) {
    return {
      approved: false,
      reason: "daniel_setup_required",
      message: "Daniel must complete any account creation, new terms, KYC, or undelegated checkout once before Pantheon can run this trial.",
      trial,
    };
  }
  const mandate = operatingMandateState(db);
  if (trial.capCents > mandate.remainingCents) {
    return { approved: false, reason: "monthly_mandate_exceeded", trial, mandate };
  }
  run(
    db,
    "UPDATE service_trials SET status = 'approved', updated_at = ? WHERE id = ?",
    [now(), id],
  );
  return { approved: true, trial: getServiceTrial(db, id), mandate };
}

function startServiceTrial(db, id) {
  const trial = getServiceTrial(db, id);
  if (!trial || trial.status !== "approved") throw new Error("Only an approved service trial can start.");
  run(
    db,
    "UPDATE service_trials SET status = 'running', trial_start = ?, updated_at = ? WHERE id = ?",
    [now(), now(), id],
  );
  return getServiceTrial(db, id);
}

function completeServiceTrial(db, id, input = {}) {
  const trial = getServiceTrial(db, id);
  if (!trial || trial.status !== "running") throw new Error("Only a running service trial can be completed.");
  const usefulFindings = Math.max(0, Number(input.usefulFindings || 0));
  const evidenceQualityImprovement = Number(input.evidenceQualityImprovement || 0);
  const actualCostCents = Math.max(0, Math.round(Number(input.actualCostCents || 0)));
  if (actualCostCents > trial.capCents) throw new Error("The recorded service-trial cost exceeds its approved cap.");
  const costPerUsefulFindingCents = usefulFindings > 0
    ? Math.round(actualCostCents / usefulFindings)
    : null;
  const thresholds = trial.retentionThresholds;
  const passed = usefulFindings >= thresholds.minimumUsefulFindings
    && costPerUsefulFindingCents !== null
    && costPerUsefulFindingCents <= thresholds.maximumCostPerUsefulFindingCents
    && evidenceQualityImprovement >= thresholds.minimumEvidenceQualityImprovement;
  const decision = passed ? "retain" : "cancel";
  const timestamp = now();
  run(
    db,
    `UPDATE service_trials
     SET status = 'completed', trial_end = ?, actual_cost_cents = ?,
         evidence_quality_metrics = ?, result = ?, decision = ?, updated_at = ?
     WHERE id = ?`,
    [
      timestamp,
      actualCostCents,
      toJson({
        usefulFindings,
        costPerUsefulFindingCents,
        evidenceQualityImprovement,
      }),
      toJson({
        baselineComparison: input.baselineComparison || "",
        decisionGapClosed: input.decisionGapClosed === true,
        limitations: Array.isArray(input.limitations) ? input.limitations : [],
      }),
      decision,
      timestamp,
      id,
    ],
  );
  return getServiceTrial(db, id);
}

function decideServiceRetention(db, id, input = {}) {
  const trial = getServiceTrial(db, id);
  if (!trial || trial.status !== "completed") throw new Error("Only a completed service trial can receive a retention decision.");
  const recommended = trial.decision;
  const decision = input.decision || recommended;
  if (!["retain", "cancel"].includes(decision)) throw new Error("Service decision must be retain or cancel.");
  if (decision === "retain" && input.delegatedVendorCapability !== true) {
    return {
      decided: false,
      reason: "delegation_required",
      message: "Daniel must explicitly delegate this exact vendor renewal capability before Pantheon can renew it automatically.",
      trial,
    };
  }
  run(
    db,
    `UPDATE service_trials
     SET status = ?, decision = ?, delegated_vendor_capability = ?,
         renewal_at = ?, updated_at = ?
     WHERE id = ?`,
    [
      decision === "retain" ? "retained" : "cancelled",
      decision,
      decision === "retain" ? 1 : 0,
      decision === "retain" ? input.renewalAt || null : null,
      now(),
      id,
    ],
  );
  return { decided: true, trial: getServiceTrial(db, id) };
}

function getServiceTrial(db, id) {
  return parseTrial(get(db, "SELECT * FROM service_trials WHERE id = ?", [id]));
}

function getServiceTrialsState(db) {
  return {
    schema: "pantheon.service-trials.v1",
    policy: {
      perServiceCapCents: MAX_SERVICE_TRIAL_CENTS,
      monthlyMandate: operatingMandateState(db),
      protectedSetup: ["account creation", "KYC", "new legal terms", "undelegated checkout"],
    },
    trials: all(db, "SELECT * FROM service_trials ORDER BY updated_at DESC").map(parseTrial),
  };
}

function createServiceTrialEvaluator(db) {
  return Object.freeze({
    contract: "ServiceTrialEvaluator.v1",
    propose: (input) => proposeServiceTrial(db, input),
    approveWithinMandate: (id, options) => approveServiceTrialWithinMandate(db, id, options),
    start: (id) => startServiceTrial(db, id),
    complete: (id, input) => completeServiceTrial(db, id, input),
    decideRetention: (id, input) => decideServiceRetention(db, id, input),
    state: () => getServiceTrialsState(db),
  });
}

module.exports = {
  MAX_SERVICE_TRIAL_CENTS,
  approveServiceTrialWithinMandate,
  completeServiceTrial,
  createServiceTrialEvaluator,
  decideServiceRetention,
  getServiceTrial,
  getServiceTrialsState,
  proposeServiceTrial,
  startServiceTrial,
};
