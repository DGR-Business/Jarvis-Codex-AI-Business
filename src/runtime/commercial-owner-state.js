"use strict";

const crypto = require("node:crypto");

const {
  commercialLifecycleApprovalScope,
  commercialLifecycleApprovalScopeHash,
} = require("./commercial-authority");
const {
  createCommercialTestStore,
} = require("./commercial-test-store");

const OWNER_TESTS_RESULTS_SCHEMA = "pantheon.owner-tests-results.v1";
const BUYER_PROOF_TARGET = 3;
const TERMINAL_STATES = new Set(["closed", "stopped"]);
const NONTERMINAL_STATES = new Set([
  "proposed",
  "accepted",
  "activated",
  "paused",
]);
const REVIEW_TRANSITION = Object.freeze({
  proposed: "accepted",
  accepted: "activated",
  paused: "accepted",
});

const EMPTY_STATE = Object.freeze({
  title: "No commercial test is authorised",
  summary:
    "Pantheon will show one test here only after its exact offer, channel, evidence rules, and authority are recorded.",
});

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (isObject(value)) {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, canonical(value[key])]),
    );
  }
  return value ?? null;
}

function sameCanonical(left, right) {
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
}

function generatedAt(clock) {
  const value = typeof clock === "function" ? clock() : new Date();
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error("The owner-state clock did not return a valid timestamp.");
  }
  return date.toISOString();
}

function auditRef(testId, testVersion) {
  const digest = crypto
    .createHash("sha256")
    .update(
      `pantheon.owner-commercial-test.v1\0${String(testId)}\0${String(testVersion)}`,
      "utf8",
    )
    .digest("hex")
    .slice(0, 20);
  return `test-${digest}`;
}

function channelLabel(channelId) {
  const words = String(channelId || "")
    .replace(/[._:-]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return "Recorded channel";
  return words
    .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
    .join(" ");
}

function lifecyclePresentation(state, events) {
  const timestamps = new Map();
  for (const event of events) {
    if (typeof event?.eventType === "string" && typeof event?.occurredAt === "string") {
      timestamps.set(event.eventType, event.occurredAt);
    }
  }
  const stoppedAt = timestamps.get("stopped") || null;
  const formallyClosedAt = timestamps.get("closed") || null;
  const labels = {
    proposed: "Proposed",
    accepted: "Accepted",
    activated: "Active controlled test",
    paused: "Paused",
    closed: "Closed",
    stopped: "Stopped",
  };
  return {
    status: state,
    label: labels[state] || "Not established",
    proposedAt: timestamps.get("proposed") || null,
    acceptedAt: timestamps.get("accepted") || null,
    activatedAt: timestamps.get("activated") || null,
    pausedAt: timestamps.get("paused") || null,
    closedAt: formallyClosedAt || stoppedAt,
    stoppedAt,
    lastChangedAt: events.at(-1)?.occurredAt || null,
  };
}

function safeInteger(value, label, options = {}) {
  if (
    !Number.isSafeInteger(value)
    || (options.minimum !== undefined && value < options.minimum)
  ) {
    throw new Error(`${label} is not a safe integer.`);
  }
  return value;
}

function proofFactsAreComplete(ledger, evaluation) {
  const evidence = Array.isArray(ledger.evidence) ? ledger.evidence : [];
  const originalFacts = evidence.filter((record) => (
    record?.kind === "transaction" || record?.kind === "cost"
  ));
  const importedFacts = originalFacts.filter(
    (record) => record?.source?.kind === "imported_platform",
  );
  const manifests = evidence.filter(
    (record) => record?.kind === "evidence_set_manifest",
  );
  const financials = evaluation.financials || {};
  const requirements = evaluation.proofRequirements || {};
  const evidenceSummary = evaluation.evidence || {};
  const blockers = Array.isArray(evaluation.blockers) ? evaluation.blockers : [];
  const amountsAreComplete = [
    financials.settledRevenueAudCents,
    financials.refundsAudCents,
    financials.reconciledCostsAudCents,
    financials.actualNetCashContributionAudCents,
  ].every(Number.isSafeInteger);
  const financialArithmeticMatches = amountsAreComplete && (
    financials.actualNetCashContributionAudCents
    === financials.settledRevenueAudCents
      - financials.refundsAudCents
      - financials.reconciledCostsAudCents
  );
  const manualsAreVerified = (
    Number.isSafeInteger(evidenceSummary.manualOriginals)
    && Number.isSafeInteger(evidenceSummary.manuallyVerifiedOriginals)
    && evidenceSummary.manualOriginals === evidenceSummary.manuallyVerifiedOriginals
  );

  return (
    manifests.length > 0
    && manifests.every((record) => record?.source?.verificationStatus === "verified")
    && evidenceSummary.closedManifestPresent === true
    && requirements.closedEvidenceManifest === true
    && blockers.length === 0
    && ledger.contract?.price?.currency === "AUD"
    && (financials.currency === undefined || financials.currency === "AUD")
    && financials.costTruthComplete === true
    && requirements.allEvidenceInScopeVerifiedReconciledAndComplete === true
    && requirements.onlySettledRevenueCounted === true
    && requirements.onlyReconciledCostsCounted === true
    && importedFacts.every(
      (record) => record?.source?.verificationStatus === "verified",
    )
    && manualsAreVerified
    && financialArithmeticMatches
  );
}

function evidenceQuality(ledger, evaluation, terminal) {
  const records = Array.isArray(ledger.evidence) ? ledger.evidence : [];
  const originalFacts = records.filter((record) => (
    record?.kind === "transaction" || record?.kind === "cost"
  ));
  const imported = originalFacts.filter(
    (record) => record?.source?.kind === "imported_platform",
  ).length;
  const manual = safeInteger(
    evaluation.evidence?.manualOriginals,
    "Manual evidence count",
    { minimum: 0 },
  );
  const manualVerified = safeInteger(
    evaluation.evidence?.manuallyVerifiedOriginals,
    "Verified manual evidence count",
    { minimum: 0 },
  );
  const blockers = Array.isArray(evaluation.blockers)
    ? evaluation.blockers.length
    : 0;
  const complete = proofFactsAreComplete(ledger, evaluation);
  let status;
  let label;
  let summary;
  if (complete) {
    status = "complete";
    label = "Complete";
    summary = "The closed evidence set is verified, reconciled, and complete.";
  } else if (originalFacts.length === 0) {
    status = "not_started";
    label = "Not started";
    summary = "No buyer or cost evidence has been recorded.";
  } else if (terminal) {
    status = "incomplete";
    label = "Incomplete";
    summary = `${blockers} evidence blocker${blockers === 1 ? "" : "s"} remain in the closed record.`;
  } else {
    status = "collecting";
    label = "Evidence collecting";
    summary = `${blockers} evidence blocker${blockers === 1 ? "" : "s"} remain before results can be settled.`;
  }
  return {
    status,
    label,
    summary,
    counts: {
      imported,
      manual,
      manualVerified,
      blockers,
    },
  };
}

function netCashContribution(ledger, evaluation) {
  if (!proofFactsAreComplete(ledger, evaluation)) {
    return {
      status: "not_settled",
      label: "Not settled",
      currency: "AUD",
      amountCents: null,
    };
  }
  return {
    status: "settled",
    label: "Settled",
    currency: "AUD",
    amountCents: safeInteger(
      evaluation.financials.actualNetCashContributionAudCents,
      "Actual net cash contribution",
    ),
  };
}

function moneyMove(contract, evaluation, state) {
  const outcome = String(evaluation.outcome || "inconclusive");
  const detail = contract.decisionRules?.[outcome]?.nextAction
    || "Collect only the next verified buyer-and-cash fact required by the recorded test.";
  const titles = {
    proposed: "Review the exact commercial test decision.",
    accepted: "Review activation of the accepted commercial test.",
    activated: "Prove attributable paid demand and actual cash contribution.",
    paused: "Review whether the paused commercial test may resume.",
    closed: "Use the closed result to decide the next commercial move.",
    stopped: "Keep the stopped test closed and preserve its evidence.",
  };
  return {
    title: titles[state] || "Keep the next money move evidence-led.",
    detail,
  };
}

function projectLedger(summary, ledger, evaluation) {
  if (
    summary.state !== ledger.state
    || summary.decisionHash !== ledger.contract?.decisionHash
    || summary.testId !== ledger.contract?.testId
    || summary.testVersion !== ledger.contract?.testVersion
    || summary.evaluationHash !== evaluation.evaluationHash
    || !sameCanonical(evaluation, ledger.evaluation)
  ) {
    throw new Error("Commercial ledger summaries do not match the full ledger.");
  }
  if (
    evaluation.proofRequirements?.minPositiveIndependentBuyers
    !== BUYER_PROOF_TARGET
  ) {
    throw new Error("Commercial buyer proof target does not match Pantheon policy.");
  }

  const contract = ledger.contract;
  const terminal = TERMINAL_STATES.has(ledger.state);
  const positiveBuyers = safeInteger(
    evaluation.evidence?.distinctPositiveBuyers,
    "Verified positive buyer count",
    { minimum: 0 },
  );
  return {
    auditRef: auditRef(contract.testId, contract.testVersion),
    title: contract.offer.description,
    lifecycle: lifecyclePresentation(ledger.state, ledger.lifecycle),
    buyer: contract.buyer,
    problem: contract.problem,
    offer: {
      id: contract.offer.id,
      version: contract.offer.version,
      sku: contract.offer.sku,
      description: contract.offer.description,
    },
    hypothesis: contract.experiment.hypothesis,
    channel: {
      id: contract.channel.id,
      label: channelLabel(contract.channel.id),
    },
    price: {
      currency: "AUD",
      amountCents: safeInteger(
        contract.price.amountAudCents,
        "Commercial test AUD price",
        { minimum: 1 },
      ),
    },
    reportingPeriod: {
      startsAt: contract.reportingPeriod.startsAt,
      endsAt: contract.reportingPeriod.endsAt,
    },
    moneyMove: moneyMove(contract, evaluation, ledger.state),
    evidenceQuality: evidenceQuality(ledger, evaluation, terminal),
    proof: {
      buyers: {
        verifiedPositive: positiveBuyers,
        target: BUYER_PROOF_TARGET,
      },
      netCashContribution: netCashContribution(ledger, evaluation),
      commercialProofReached: evaluation.proofReached === true,
    },
    reviewDecision: null,
  };
}

function parseObject(value) {
  if (isObject(value)) return value;
  if (typeof value !== "string") return null;
  try {
    const parsed = JSON.parse(value);
    return isObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function approvalMatches(row, expectedScope, expectedHash) {
  if (
    typeof row.id !== "string"
    || row.id.trim() === ""
    || row.scope_hash !== expectedHash
    || row.decided_at !== null
    || row.consumed_at !== null
  ) {
    return false;
  }
  const payload = parseObject(row.payload);
  if (!payload) return false;
  const candidates = [
    payload.commercialTestApprovalScope,
    payload.commercialLifecycleApprovalScope,
    payload.approvalScope,
    payload.scope,
  ].filter(isObject);
  const scopeColumn = parseObject(row.scope);
  if (scopeColumn) candidates.push(scopeColumn);
  if (
    candidates.length === 0
    || candidates.some((candidate) => !sameCanonical(candidate, expectedScope))
  ) {
    return false;
  }
  const assertedHashes = [
    payload.commercialTestApprovalScopeHash,
    payload.commercialLifecycleApprovalScopeHash,
    payload.approvalScopeHash,
  ].filter((value) => value !== undefined);
  return assertedHashes.every((value) => value === expectedHash);
}

function linkedReviewDecision(db, contract, state) {
  const eventType = REVIEW_TRANSITION[state];
  if (!eventType) return { decision: null, integrityIssue: false };
  const expectedScope = commercialLifecycleApprovalScope(contract, eventType);
  const expectedHash = commercialLifecycleApprovalScopeHash(contract, eventType);
  const rows = db.prepare(
    `SELECT id, scope, scope_hash, payload, decided_at, consumed_at
     FROM approvals
     WHERE status = 'pending' AND scope_hash = ?`,
  ).all(expectedHash);
  const matches = rows.filter(
    (row) => approvalMatches(row, expectedScope, expectedHash),
  );
  if (rows.length !== 1 || matches.length !== 1) {
    return {
      decision: null,
      integrityIssue: rows.length > 0,
    };
  }
  return {
    decision: {
      id: matches[0].id,
      label: "Review decision",
    },
    integrityIssue: false,
  };
}

function baseState(timestamp) {
  return {
    schema: OWNER_TESTS_RESULTS_SCHEMA,
    generatedAt: timestamp,
    readOnly: true,
    controls: {
      allowed: [],
    },
    integrity: {
      status: "ok",
      authorityStatus: "inactive",
      message: "No nonterminal commercial test is recorded.",
    },
    current: null,
    closedHistory: {
      total: 0,
      items: [],
    },
    emptyState: { ...EMPTY_STATE },
  };
}

function attentionState(timestamp, authorityStatus, message, history = []) {
  const result = baseState(timestamp);
  result.integrity = {
    status: "attention",
    authorityStatus,
    message,
  };
  result.closedHistory = {
    total: history.length,
    items: history,
  };
  return result;
}

function getCommercialOwnerTestsState(db, options = {}) {
  let timestamp;
  try {
    timestamp = generatedAt(options.clock);
  } catch {
    timestamp = new Date().toISOString();
  }

  try {
    const store = createCommercialTestStore(db, options.storeOptions || {});
    const summaries = store.listSummaries();
    const unknown = summaries.filter((summary) => (
      !NONTERMINAL_STATES.has(summary.state)
      && !TERMINAL_STATES.has(summary.state)
    ));
    if (unknown.length > 0) {
      return attentionState(
        timestamp,
        "invalid",
        "Pantheon found a commercial contract without a valid lifecycle state. Buyer and cash claims are withheld.",
      );
    }

    const terminalSummaries = summaries.filter(
      (summary) => TERMINAL_STATES.has(summary.state),
    );
    const history = terminalSummaries.map((summary) => {
      const ledger = store.readLedger(summary.decisionHash);
      return projectLedger(summary, ledger, ledger.evaluation);
    }).sort((left, right) => (
      String(right.lifecycle.closedAt || "").localeCompare(
        String(left.lifecycle.closedAt || ""),
      ) || left.auditRef.localeCompare(right.auditRef)
    )).map((item) => ({
      ...item,
      reviewDecision: null,
    }));

    const nonterminal = summaries.filter(
      (summary) => NONTERMINAL_STATES.has(summary.state),
    );
    if (nonterminal.length > 1) {
      return attentionState(
        timestamp,
        "ambiguous",
        "More than one current commercial program was found. Pantheon will not choose between overlapping tests.",
        history,
      );
    }

    const result = baseState(timestamp);
    result.closedHistory = {
      total: history.length,
      items: history,
    };
    if (nonterminal.length === 0) return result;

    const summary = nonterminal[0];
    const ledger = store.readLedger(summary.decisionHash);
    const current = projectLedger(summary, ledger, ledger.evaluation);
    const review = linkedReviewDecision(db, ledger.contract, ledger.state);
    if (review.integrityIssue) {
      result.integrity = {
        status: "attention",
        authorityStatus: "invalid",
        message:
          "The pending commercial review decision is ambiguous or incomplete, so Pantheon is withholding the control.",
      };
      result.current = current;
      return result;
    }

    current.reviewDecision = review.decision;
    result.current = current;
    result.controls.allowed = review.decision ? ["review_decision"] : [];
    result.integrity = {
      status: "ok",
      authorityStatus: ledger.state === "activated" ? "active" : ledger.state,
      message: ledger.state === "activated"
        ? "One activated commercial test is selected from the canonical ledger."
        : "One read-only commercial test is selected from the canonical ledger.",
    };
    return result;
  } catch {
    return attentionState(
      timestamp,
      "unavailable",
      "Pantheon could not verify the commercial test ledger. Buyer and cash claims are withheld.",
    );
  }
}

module.exports = {
  OWNER_TESTS_RESULTS_SCHEMA,
  getCommercialOwnerTestsState,
};
