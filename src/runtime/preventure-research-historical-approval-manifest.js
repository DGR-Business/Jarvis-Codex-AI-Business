"use strict";

// These records are retained historical evidence from the one known
// pre-attestation schema-27 candidate. The legacy source label is preserved as
// recorded; it is not equivalent to the current authenticated owner-session
// attestation and must never be accepted by a live approval write path.
const HISTORICAL_PREVENTURE_APPROVAL_DECISION_RECEIPT_SCHEMA =
  "pantheon.preventure-research-approval-decision.v1";
const HISTORICAL_PREVENTURE_APPROVAL_DECISION_SOURCE =
  "signed_local_owner_session";

const HISTORICAL_PREVENTURE_APPROVAL_AUTHORITY = Object.freeze({
  authorityHash: "sha256:0b8dd7380f38a673e683482dd9fdbf0b4c1aff7c1eeb28341ca869927f0fa7ba",
  authorityId: "preventure_smm_scope_guard_diligence_2026_08_02",
  authorityVersion: "2026.08.02-v1",
  expiresAt: "2026-08-09T11:29:40.4051170+10:00",
});

const HISTORICAL_PREVENTURE_APPROVAL_RECEIPT_KEYS = Object.freeze([
  "approvalId",
  "authorityHash",
  "decidedAt",
  "decidedBy",
  "decisionSource",
  "decisionStatus",
  "eventType",
  "priorPending",
  "receiptHash",
  "schema",
  "scopeHash",
]);

const HISTORICAL_PREVENTURE_APPROVAL_PRIOR_PENDING_KEYS = Object.freeze([
  "consumedAt",
  "decidedAt",
  "decidedBy",
  "requestedAt",
  "requestedBy",
  "status",
]);

const HISTORICAL_DECISION_TIME = "2026-08-02T03:00:00.000Z";
const HISTORICAL_PREVENTURE_APPROVAL_DECISIONS = Object.freeze([
  Object.freeze({
    receiptHash: "sha256:ebddfeb0b6809205fafdd2a6b72c23676250472aa659767bcb7a2727d55e26ae",
    approvalId: "approval_preventure_accepted_e0fc48a50d2dd301c30a02a7",
    authorityHash: HISTORICAL_PREVENTURE_APPROVAL_AUTHORITY.authorityHash,
    eventType: "accepted",
    scopeHash: "sha256:e0fc48a50d2dd301c30a02a70e987e1194e2dba2e65ae1c7f275d91bccb36a33",
    requestedBy: "jarvis",
    requestedAt: HISTORICAL_DECISION_TIME,
    decidedBy: "owner",
    decisionSource: HISTORICAL_PREVENTURE_APPROVAL_DECISION_SOURCE,
    decisionStatus: "approved",
    decidedAt: HISTORICAL_DECISION_TIME,
    createdAt: HISTORICAL_DECISION_TIME,
    receiptSchema: HISTORICAL_PREVENTURE_APPROVAL_DECISION_RECEIPT_SCHEMA,
  }),
  Object.freeze({
    receiptHash: "sha256:b04133d7f70b654301c9bf84b8b6fae82064adff24123ad7492c32fb0fbf5db4",
    approvalId: "approval_preventure_activated_744478e19519ee040d8bd3e0",
    authorityHash: HISTORICAL_PREVENTURE_APPROVAL_AUTHORITY.authorityHash,
    eventType: "activated",
    scopeHash: "sha256:744478e19519ee040d8bd3e0fa1e204ee1818533fbe1f4b5413951996addda69",
    requestedBy: "jarvis",
    requestedAt: HISTORICAL_DECISION_TIME,
    decidedBy: "owner",
    decisionSource: HISTORICAL_PREVENTURE_APPROVAL_DECISION_SOURCE,
    decisionStatus: "approved",
    decidedAt: HISTORICAL_DECISION_TIME,
    createdAt: HISTORICAL_DECISION_TIME,
    receiptSchema: HISTORICAL_PREVENTURE_APPROVAL_DECISION_RECEIPT_SCHEMA,
  }),
]);

const HISTORICAL_PREVENTURE_SCHEMA27_SOURCE = Object.freeze({
  snapshotSha256: "668573b8aa5c4086e5eb36431eda2088030ef15bc4efe07a4a8f21c612e722f1",
  encryptedBackupSha256: "8fbbea99edffeb296c49fb173a55effcddcfecb027e2f8a6be78a112efa01166",
  normalizedSchemaSha256: "ec889667b83ab867fda6d984b67f55d4760b0dd315e7294a30dfac0375b575b3",
  rawSchemaSha256: "7181298b2be84462c8ee0c235c199c96cec29a2f78c21a1c8a2d082af3f030be",
  migrationHistorySha256: "4f6b1a03a7de7b17ffe589a641507e517004142ce1d284e6f39e3d2b2316b565",
  namespaceRowCounts: Object.freeze({
    preventure_research_authorities: 1,
    preventure_research_approval_decisions: 2,
    preventure_research_lifecycle_events: 3,
    preventure_research_assignments: 3,
    preventure_research_cost_events: 0,
    preventure_research_terminal_stops: 0,
    preventure_research_assignment_skips: 0,
    preventure_research_source_snapshots: 0,
    preventure_research_evidence_records: 0,
    preventure_research_decisions: 0,
  }),
  namespaceLogicalRowSha256: Object.freeze({
    preventure_research_authorities:
      "02d65d3b12846fce4011ee5ecf14194cc1851b40f301bbe8cf86874e3e6d4689",
    preventure_research_approval_decisions:
      "82eb6f09920c9deabbccd988ff126e9f5891d2fa51edd590bceefe32b72223ac",
    preventure_research_lifecycle_events:
      "7f69e1e1f23151f6a54ada6af32f829bdd89546e27edd49c1a34ad54000f1c59",
    preventure_research_assignments:
      "ffbc3493c501cc30de2225a7a2025b41a8efba082c4da1dc3083918806a51ee6",
    preventure_research_cost_events:
      "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945",
    preventure_research_terminal_stops:
      "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945",
    preventure_research_assignment_skips:
      "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945",
    preventure_research_source_snapshots:
      "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945",
    preventure_research_evidence_records:
      "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945",
    preventure_research_decisions:
      "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945",
  }),
});

function historicalPreventureApprovalDecisionEntry({ receiptHash, approvalId } = {}) {
  const matches = HISTORICAL_PREVENTURE_APPROVAL_DECISIONS.filter((entry) => (
    (receiptHash === undefined || entry.receiptHash === receiptHash)
    && (approvalId === undefined || entry.approvalId === approvalId)
  ));
  return matches.length === 1 ? matches[0] : null;
}

module.exports = {
  HISTORICAL_PREVENTURE_APPROVAL_AUTHORITY,
  HISTORICAL_PREVENTURE_APPROVAL_DECISION_RECEIPT_SCHEMA,
  HISTORICAL_PREVENTURE_APPROVAL_DECISION_SOURCE,
  HISTORICAL_PREVENTURE_APPROVAL_DECISIONS,
  HISTORICAL_PREVENTURE_APPROVAL_PRIOR_PENDING_KEYS,
  HISTORICAL_PREVENTURE_APPROVAL_RECEIPT_KEYS,
  HISTORICAL_PREVENTURE_SCHEMA27_SOURCE,
  historicalPreventureApprovalDecisionEntry,
};
