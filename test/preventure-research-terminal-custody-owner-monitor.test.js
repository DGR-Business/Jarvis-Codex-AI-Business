"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const {
  getPreventureResearchOwnerState,
} = require("../src/runtime/preventure-research-owner-state");
const { collectFindings } = require("../src/runtime/monitor");
const {
  bindAuthenticatedOwnerBillingObservationIssuer,
} = require("../src/runtime/local-security");
const {
  addMilliseconds,
  authority,
  buildRecoveryInput,
  createTerminalRecoveryFixture,
  finalizeTerminalReceipt,
  prepareDispatchedExecution,
  retainProviderArtifact,
  revokeAuthority,
} = require("./support/preventure-research-terminal-recovery-fixture");
const {
  historicalV1TestRegistry,
} = require("./support/preventure-research-test-registry");
const {
  authenticatedOwnerSecurityForTest,
} = require("./support/authenticated-owner-session-attestation");
const {
  issueOwnerBillingAttestation,
  observationInput,
  terminalRecoveryBillingFixture,
} = require("./support/preventure-research-owner-billing-observation-fixture");

const BASE_DISPATCHED_AT = "2026-08-02T06:30:00.000Z";
const PROJECT_ROOT = path.resolve(__dirname, "..");
const APP_SOURCE = fs.readFileSync(path.join(PROJECT_ROOT, "public", "app.js"), "utf8");

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function humanStatus(value) {
  return String(value || "unknown")
    .replace(/[._-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function ownerUiRenderer() {
  const start = APP_SOURCE.indexOf("const OWNER_PREVENTURE_RESEARCH_SCHEMA");
  const end = APP_SOURCE.indexOf("\nfunction renderCommandBand", start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const source = APP_SOURCE.slice(start, end);
  return vm.runInNewContext(`(() => {
    ${source}
    return renderCurrentCommercialGate;
  })()`, {
    badge: (label, tone = "") => `<span class="badge ${escapeHtml(tone)}">${escapeHtml(label)}</span>`,
    escapeHtml,
    humanStatus,
    icon: () => "",
    money: (cents) => `A$${(Number(cents) / 100).toFixed(2)}`,
    shortDate: (value) => String(value),
  });
}

function createCustodyScenario(receiptHistory) {
  const subject = createTerminalRecoveryFixture();
  try {
    const execution = prepareDispatchedExecution(subject, {
      dispatchedAt: BASE_DISPATCHED_AT,
    });
    if (["partial_prior", "latest_needs_review"].includes(receiptHistory)) {
      finalizeTerminalReceipt(subject, execution);
    }
    if (receiptHistory === "latest_needs_review") {
      subject.db.prepare(
        "UPDATE agent_runs SET output_summary = ? WHERE id = ?",
      ).run(
        "A later custody-only snapshot supersedes the earlier partial record.",
        execution.runId,
      );
      finalizeTerminalReceipt(subject, execution);
    }
    const priorReceiptCount = Number(subject.db.prepare(
      "SELECT COUNT(*) AS count FROM agent_run_receipts WHERE attempt_id = ?",
    ).get(execution.ids.attemptId).count);
    const terminal = revokeAuthority(
      subject,
      execution,
      addMilliseconds(BASE_DISPATCHED_AT, 1_000),
    );
    const artifact = retainProviderArtifact(subject, execution, {
      retainedAt: addMilliseconds(BASE_DISPATCHED_AT, 2_000),
    });
    const recoveryInput = buildRecoveryInput(subject, execution, terminal, artifact, {
      receipt: null,
    });
    const committed = subject.store.commitTerminalRetainedRecovery(
      execution.assignment.assignmentHash,
      recoveryInput,
    );
    assert.equal(committed.created, true);
    assert.equal(committed.recovery.executionReceipt?.status, "needs_review");
    return {
      ...subject,
      artifact,
      committed,
      execution,
      priorReceiptCount,
      terminal,
    };
  } catch (error) {
    subject.close();
    throw error;
  }
}

function ownerState(subject) {
  return getPreventureResearchOwnerState(subject.db, {
    authorityRegistry: historicalV1TestRegistry,
    clock: subject.clock,
    store: subject.store,
  });
}

function monitorFindings(subject) {
  return collectFindings(subject.db, {
    at: subject.clock(),
    preventureResearchAuthorityRegistry: historicalV1TestRegistry,
    preventureResearchClock: subject.clock,
    preventureResearchRetainedOutputStore: subject.retainedOutputStore,
  });
}

test("verified terminal custody projects full-cap billing truth with every execution row sealed", () => {
  const subject = createCustodyScenario("none");
  try {
    const state = ownerState(subject);
    assert.equal(state.integrity.status, "ok");
    assert.equal(state.current, null);
    assert.equal(state.history.total, 1);
    const latest = state.history.items[0];
    assert.equal(latest.lifecycle.status, "revoked");
    assert.equal(latest.decision, null);
    assert.equal(latest.budget.exactBillingPending, true);
    assert.equal(latest.budget.unknownCostCount, 1);
    assert.equal(latest.terminalCustody.status, "terminal_custody_pending_billing");
    assert.equal(latest.terminalCustody.verified, true);
    assert.equal(latest.terminalCustody.fullCapExposure, true);
    assert.equal(latest.terminalCustody.exactBillingPending, true);
    assert.equal(latest.terminalCustody.decisionRecorded, false);
    assert.equal(latest.terminalCustody.retryAuthorized, false);
    assert.equal(latest.terminalCustody.additionalNetworkCalls, 0);
    assert.equal(latest.terminalCustody.evidenceEligible, false);
    assert.equal(latest.terminalCustody.items.length, 1);
    const custody = latest.terminalCustody.items[0];
    assert.equal(custody.billing.costTruth, "unknown");
    assert.equal(custody.billing.knownCostAudCents, null);
    assert.equal(custody.billing.exposureAudCents, subject.execution.assignment.maxCostAudCents);
    assert.equal(custody.billing.assignmentCapAudCents, subject.execution.assignment.maxCostAudCents);
    assert.equal(custody.billing.fullCapExposure, true);
    assert.equal(custody.billing.exactBillingPending, true);
    assert.equal(custody.receipt.present, true);
    assert.equal(custody.receipt.status, "needs_review");
    assert.deepEqual(latest.execution, {
      status: "sealed_terminal_custody",
      running: false,
      runningAttemptCount: 0,
      runningModelCallCount: 0,
      dispatchingModelCallCount: 0,
      activeModelCallCount: 0,
      activeAgentRunCount: 0,
      activeToolInvocationCount: 0,
      activeExecutionRowCount: 0,
      providerDispatchCount: 1,
      terminalCustodyRecorded: true,
      terminalCustodySealed: true,
      activationIsNotExecution: true,
    });
    const serialized = JSON.stringify(latest);
    for (const forbidden of [
      "rawProviderBody",
      "rawProviderBodyBase64",
      "providerRequestId",
      "providerResponseId",
      "clientRequestId",
      "authorization",
      "apiKey",
    ]) assert.equal(serialized.includes(forbidden), false, forbidden);
  } finally {
    subject.close();
  }
});

test("owner-attested terminal billing clears pending exposure without claiming provider settlement", () => {
  const subject = terminalRecoveryBillingFixture({ providerRequestId: null });
  try {
    const ownerSecurity = authenticatedOwnerSecurityForTest(subject.db);
    bindAuthenticatedOwnerBillingObservationIssuer(
      subject.db,
      ownerSecurity.security,
    );
    const input = observationInput(subject, { amountAudCents: 0 });
    const attestation = issueOwnerBillingAttestation(
      ownerSecurity.security,
      ownerSecurity.bootstrapSecret,
      input,
      subject.assignment.assignmentHash,
    );
    const recorded = subject.store.recordOwnerAttestedProviderBillingObservation(
      subject.assignment.assignmentHash,
      input,
      { ownerSessionAttestation: attestation },
    );
    assert.equal(recorded.created, true);

    const state = ownerState(subject);
    assert.equal(state.integrity.status, "ok");
    const latest = state.history.items[0];
    assert.equal(latest.lifecycle.status, "revoked");
    assert.equal(latest.decision, null);
    assert.equal(latest.budget.exactBillingPending, false);
    assert.equal(latest.budget.unknownCostCount, 0);
    assert.equal(latest.budget.exposureAudCents, 0);
    assert.equal(latest.budget.reconciledAudCents, 0);
    assert.equal(
      latest.providerBilling.status,
      "owner_attested_not_provider_settled",
    );
    assert.equal(latest.providerBilling.amountAudCents, 0);
    assert.equal(latest.providerBilling.providerSettled, false);
    assert.equal(latest.terminalCustody.status, "terminal_custody_owner_attested");
    assert.equal(latest.terminalCustody.exactBillingPending, false);
    assert.equal(latest.terminalCustody.custodyFullCapExposure, true);
    assert.equal(latest.terminalCustody.providerSettled, false);
    const custody = latest.terminalCustody.items[0];
    assert.equal(custody.billing.costTruth, "owner_attested");
    assert.equal(custody.billing.custodyCostTruth, "unknown");
    assert.equal(custody.billing.knownCostAudCents, 0);
    assert.equal(custody.billing.exposureAudCents, 0);
    assert.equal(
      custody.billing.custodyExposureAudCents,
      subject.assignment.maxCostAudCents,
    );
    assert.equal(custody.billing.ownerAttested, true);
    assert.equal(custody.billing.providerSettled, false);

    const findings = monitorFindings(subject);
    assert.equal(
      findings.filter(
        (item) => item.title === "Terminal provider billing is owner-attested, not provider-settled",
      ).length,
      1,
    );
    assert.equal(
      findings.some((item) => item.title === "Terminal provider custody is awaiting exact billing"),
      false,
    );
    assert.equal(
      findings.some((item) => item.title === "Bounded research has an unknown cost"),
      false,
    );

    const html = ownerUiRenderer()({ preventureResearch: state });
    assert.match(html, /owner-attested billing recorded; not provider-settled/i);
    assert.match(html, /authenticated owner observation; not a provider-settled receipt/i);
    assert.doesNotMatch(html, /record-owner-billing-observation/i);
    assert.doesNotMatch(html, /retry authorised.*yes/i);
    assert.doesNotMatch(html, /resp_|request_[a-z0-9]/i);
  } finally {
    subject.close();
  }
});

test("monitor classifies no, partial, and latest-needs-review receipt histories as custody billing only", async (t) => {
  const cases = [
    ["no prior receipt", "none", 0],
    ["partial prior receipt", "partial_prior", 1],
    ["latest needs-review receipt", "latest_needs_review", 2],
  ];
  for (const [name, receiptHistory, expectedPriorReceipts] of cases) {
    await t.test(name, () => {
      const subject = createCustodyScenario(receiptHistory);
      try {
        assert.equal(subject.priorReceiptCount, expectedPriorReceipts);
        const findings = monitorFindings(subject);
        const custody = findings.filter(
          (finding) => finding.title === "Terminal provider custody is awaiting exact billing",
        );
        assert.equal(custody.length, 1);
        assert.equal(custody[0].severity, "warn");
        assert.equal(custody[0].category, "cost");
        assert.deepEqual({
          fullCapExposure: custody[0].metadata.fullCapExposure,
          exactBillingPending: custody[0].metadata.exactBillingPending,
          decisionRecorded: custody[0].metadata.decisionRecorded,
          retryAuthorized: custody[0].metadata.retryAuthorized,
          additionalNetworkCalls: custody[0].metadata.additionalNetworkCalls,
        }, {
          fullCapExposure: true,
          exactBillingPending: true,
          decisionRecorded: false,
          retryAuthorized: false,
          additionalNetworkCalls: 0,
        });
        const misleading = findings.filter((finding) => (
          finding.entityId === subject.execution.assignment.taskId
          || finding.entityId === subject.execution.runId
          || finding.entityId === subject.committed.recovery.executionReceipt.id
          || finding.entityId === "unknown_costs"
        )).filter((finding) => (
          finding.category === "agent_receipts"
          || /reuse|missing|incomplete|execution needs review|provider cost needs reconciliation/i
            .test(`${finding.title} ${finding.detail}`)
        ));
        assert.deepEqual(misleading, []);
      } finally {
        subject.close();
      }
    });
  }
});

test("owner UI says safely held and billing pending without a retry or decision control", () => {
  const subject = createCustodyScenario("none");
  try {
    const state = ownerState(subject);
    const html = ownerUiRenderer()({ preventureResearch: state });
    assert.match(html, /Provider result safely held; billing pending/);
    assert.match(html, /Finished locally; exact billing is pending/);
    assert.match(html, /Terminal custody - exact billing pending/);
    assert.match(html, /No retry/);
    assert.match(html, /Execution rows still active<\/span><strong>0/);
    assert.match(html, /Further provider calls<\/span><strong>0/);
    assert.match(html, /Commercial decision recorded<\/span><strong>No/);
    assert.match(html, /A\$0\.50/);
    assert.match(html, /data-action="record-owner-billing-observation"/);
    assert.match(html, /Record owner-observed bill/);
    assert.doesNotMatch(html, /Reprocess retained result|Run exact bounded research|Review this decision/);
    assert.doesNotMatch(html, /providerRequestId|providerResponseId|rawProviderBody|Bearer |sk-/i);
  } finally {
    subject.close();
  }
});
