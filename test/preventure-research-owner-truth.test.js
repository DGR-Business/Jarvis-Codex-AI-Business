"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const {
  decisionProjection,
  executionProjection,
  getPreventureResearchOwnerState,
  lifecycleProjection,
  terminalStopProjection,
} = require("../src/runtime/preventure-research-owner-state");
const {
  preventureResearchSchedulerFinding,
  shouldReportPreventureContraryEvidenceGap,
} = require("../src/runtime/monitor");

const root = path.resolve(__dirname, "..");
const appSource = fs.readFileSync(path.join(root, "public", "app.js"), "utf8");

function sourceBetween(start, end) {
  const from = appSource.indexOf(start);
  const to = appSource.indexOf(end, from);
  assert.notEqual(from, -1, `Missing source marker: ${start}`);
  assert.notEqual(to, -1, `Missing source marker: ${end}`);
  return appSource.slice(from, to);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function humanStatus(value) {
  if (value === "research_more") return "More evidence needed";
  return String(value || "unknown")
    .replace(/[._-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function ownerUiRenderers() {
  const source = sourceBetween(
    "const OWNER_PREVENTURE_RESEARCH_SCHEMA",
    "\nfunction renderCommandBand",
  );
  return vm.runInNewContext(`(() => {
    ${source}
    return {
      latestPreventureGate,
      renderCurrentCommercialGate,
      renderPreventureCostTruth,
      renderPreventureDecisionTruth,
    };
  })()`, {
    badge: (label, tone = "") => `<span class="badge ${escapeHtml(tone)}">${escapeHtml(label)}</span>`,
    escapeHtml,
    humanStatus,
    icon: () => "",
    money: (cents) => `A$${(Number(cents) / 100).toFixed(2)}`,
    shortDate: (value) => String(value),
  });
}

function workRenderers() {
  const source = sourceBetween("function workItemCanRun", "\nconst OWNER_PREVENTURE_RESEARCH_SCHEMA");
  return vm.runInNewContext(`(() => {
    ${source}
    return { workItemIsSafeInternal, workItemRunControl };
  })()`, {
    escapeHtml,
    humanStatus,
    icon: () => "",
    money: (cents) => `A$${(Number(cents) / 100).toFixed(2)}`,
  });
}

function systemRenderer(data) {
  const source = sourceBetween("function renderSystem()", "\nconst journeyStageDetails");
  const view = { innerHTML: "" };
  vm.runInNewContext(`(() => { ${source}; renderSystem(); })()`, {
    $: () => view,
    icon: () => "",
    renderSystemPanel: () => "<div>system panel</div>",
    store: { data: { system: data } },
    systemTabs: () => "<nav>tabs</nav>",
    workItemCanRun: (item) => item?.can_run === true,
    workItemIsSafeInternal: (item) => (
      item?.can_run === true
      && item?.safe_to_run === true
      && item?.execution_kind !== "preventure_research"
    ),
  });
  return view.innerHTML;
}

function connectionRenderer(data) {
  const ownerHelpers = sourceBetween(
    "const OWNER_PREVENTURE_RESEARCH_SCHEMA",
    "\nfunction renderPreventureCostTruth",
  );
  const connections = sourceBetween("function ownerConnectionRows", "\nfunction ownerConnectionBadge");
  return vm.runInNewContext(`(() => {
    ${ownerHelpers}
    ${connections}
    return ownerConnectionRows;
  })()`, {})(data);
}

function terminalGateFixture() {
  return {
    lifecycle: { status: "completed", label: "Diligence complete" },
    opportunity: {
      buyer: "Freelance social media managers",
      offer: "Scope guard kit",
    },
    budget: {
      currency: "AUD",
      authorityCapAudCents: 200,
      estimatedAudCents: 0,
      exposureAudCents: 50,
      reconciledAudCents: 0,
      exactBillingPending: true,
      unknownCostCount: 0,
    },
    decision: {
      id: "decision_1",
      version: "preventure-v1-decision-v1",
      outcome: "research_more",
      completionMode: "validated_early_stop",
      decidedAt: "2026-08-02T03:05:00.000Z",
      summary: "Evidence stopped safely <img src=x onerror=alert(1)>",
      buyer: "Freelance social media managers",
      offer: "Scope guard kit",
      channel: "No commercial channel selected",
      priceOrMargin: "A$19, A$29, and A$39 remain unverified",
      evidenceStandard: "Captured decision-grade evidence required",
      formatCases: [{ id: "fillable_pdf_kit", disposition: "revise" }],
      channelCases: [{ id: "etsy", state: "research_more" }],
      economicsCases: [{
        channelId: "etsy",
        priceAudCents: 2900,
        state: "unknown",
        estimatedNetCashContributionAudCents: null,
      }],
      readinessGates: [{ id: "buyer_problem", status: "unresolved" }],
      contraryEvidence: [{ id: "exact_willingness_to_pay_missing", status: "retained" }],
      materialContradictions: ["Visible listings do not prove purchases."],
      limitations: ["Seller identity was not verified."],
      reviseOrStopCriteria: ["Do not build from partial marketplace results."],
      resultingReadiness: {
        schema: "pantheon.preventure-research-resulting-readiness.v1",
        version: "preventure-v1-decision-v1",
        outcome: "research_more",
        hash: "sha256:result",
      },
      nextMoneyMove: "Retain cash and collect one exact missing evidence unit.",
    },
    terminalStop: {
      trigger: {
        title: "Comparator and buyer evidence",
        outcomeClass: "validated_evidence_shortfall",
        gapCodes: ["purchaser_signals_insufficient"],
      },
      skippedSuffix: {
        count: 2,
        assignments: [
          { title: "Format, channel, and economics", totalAudCostCents: 0 },
          { title: "Independent readiness review", totalAudCostCents: 0 },
        ],
      },
    },
    etsy: { accountExistence: "owner_reported_unverified" },
    nextAction: "Run one separately approved captured-source diligence action focused on purchaser signals.",
    moneyMove: {
      current: "The bounded diligence round completed with research_more. Cash remains retained.",
    },
    commercialTruth: {
      orders: 0,
      revenueAudCents: 0,
    },
  };
}

test("closed owner view separates zero estimate, retained exposure, and pending billing", () => {
  const renderers = ownerUiRenderers();
  const gate = terminalGateFixture();
  const html = renderers.renderCurrentCommercialGate({
    preventureResearch: {
      schema: "pantheon.owner-preventure-research.v1",
      integrity: { status: "ok" },
      current: null,
      history: { items: [gate] },
    },
  });

  assert.match(html, /Estimated provider cost[\s\S]*A\$0\.00/);
  assert.match(html, /Maximum charge exposure[\s\S]*A\$0\.50/);
  assert.match(html, /Post-decision provider billing pending/);
  assert.match(html, /zero estimate does not mean there is no possible charge/i);
  assert.doesNotMatch(html, /No provider charge or exposure recorded/);
  assert.match(html, /More evidence needed/);
  assert.match(html, /preventure-v1-decision-v1/);
  assert.match(html, /Format, channel, and economics/);
  assert.match(html, /Independent readiness review/);
  assert.match(html, /Exact Willingness To Pay Missing[\s\S]*Retained/);
  assert.match(html, /Run one separately approved captured-source diligence action/);
  assert.match(html, /Recorded money move[\s\S]*Retain cash and collect one exact missing evidence unit/);
  assert.match(html, /Owner-reported account exists/);
  assert.match(html, /A\$0\.00 revenue/);
  assert.match(html, /No product build, buyer contact, publishing, advertising, account action, or external commercial spend/);
  assert.doesNotMatch(html, /<img src=x/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
});

test("activated owner state is permission, not proof that research is running", () => {
  assert.equal(
    lifecycleProjection([], "activated").label,
    "Activated; internal diligence authorised",
  );
  assert.deepEqual(
    executionProjection({ executionEvidence: { taskAttempts: [], modelCalls: [] } }, "activated"),
    {
      status: "not_started",
      running: false,
      runningAttemptCount: 0,
      runningModelCallCount: 0,
      dispatchingModelCallCount: 0,
      activeModelCallCount: 0,
      activeAgentRunCount: 0,
      activeToolInvocationCount: 0,
      activeExecutionRowCount: 0,
      providerDispatchCount: 0,
      terminalCustodyRecorded: false,
      terminalCustodySealed: false,
      activationIsNotExecution: true,
    },
  );
  const running = executionProjection({
    executionEvidence: {
      taskAttempts: [{ status: "running", provider_dispatched_at: null }],
      modelCalls: [],
    },
  }, "activated");
  assert.equal(running.running, true);
  assert.equal(running.status, "running");
});

test("terminal projection keeps the versioned decision and exact untouched suffix", () => {
  const authority = {
    assignments: [
      { id: "one", title: "First evidence" },
      { id: "two", title: "Second evidence" },
      { id: "three", title: "Independent review" },
    ],
  };
  const skip = (id, assignmentId, order) => ({
    id,
    assignmentId,
    assignmentOrder: order,
    dispatchState: "not_dispatched",
    taskAttemptCount: 0,
    modelCallCount: 0,
    agentRunCount: 0,
    researchRunCount: 0,
    toolInvocationCount: 0,
    budgetReservationCount: 0,
    costRecordCount: 0,
    sourceSnapshotCount: 0,
    evidenceRecordCount: 0,
    totalAudCostCents: 0,
    skippedAt: "2026-08-02T03:05:00.000Z",
    skipRecordHash: `sha256:${id}`,
  });
  const stop = terminalStopProjection({
    terminalStopRecord: {
      id: "stop_1",
      earlyStopRecordHash: "sha256:stop",
      triggerAssignmentId: "one",
      triggerOutcomeClass: "validated_evidence_shortfall",
      gapCodes: ["purchaser_signals_insufficient"],
      stoppedAt: "2026-08-02T03:05:00.000Z",
      nextEvidenceAction: { id: "next_1", action: "Collect one exact signal." },
      skippedAssignments: [skip("skip2", "two", 2), skip("skip3", "three", 3)],
    },
  }, authority);
  assert.equal(stop.trigger.assignmentOrder, 1);
  assert.equal(stop.skippedSuffix.count, 2);
  assert.equal(stop.skippedSuffix.exactNoDispatchOrCost, true);
  assert.deepEqual(stop.skippedSuffix.assignments.map((item) => item.assignmentId), ["two", "three"]);

  const decision = decisionProjection({
    lifecycle: [{
      eventType: "completed",
      metadata: { resultingReadinessHash: "sha256:readiness" },
    }],
    decision: {
      schema: "pantheon.preventure-research-decision.v1",
      id: "decision_1",
      version: "authority-v1-decision-v1",
      outcome: "research_more",
      completionMode: "validated_early_stop",
      decidedAt: "2026-08-02T03:05:00.000Z",
      summary: "More evidence is needed.",
      buyer: "Buyer",
      problem: "Problem",
      offer: "Offer",
      channel: "None selected",
      priceOrMargin: "Unproved",
      evidenceStandard: "Captured evidence",
      nextMoneyMove: "Retain cash.",
      reviseOrStopCriteria: ["Stop"],
      comparatorCount: 1,
      comparatorCoverage: {},
      formatCases: [],
      channelCases: [],
      economicsCases: [],
      contraryEvidence: [{ id: "contrary", status: "retained" }],
      materialContradictions: ["Contradiction"],
      readinessGates: [],
      limitations: ["Limit"],
      provenanceComplete: true,
      estimatedInternalAiCostAudCents: 0,
      reconciledInternalAiCostAudCents: 0,
      exactBillingPending: true,
      unknownProviderOutcomeCount: 0,
      unknownCostCount: 0,
      nextEvidenceAction: { id: "next_1", action: "Collect one exact signal." },
      decisionHash: "sha256:decision",
    },
  });
  assert.equal(decision.version, "authority-v1-decision-v1");
  assert.equal(decision.resultingReadiness.hash, "sha256:readiness");
  assert.equal(decision.nextEvidenceAction.action, "Collect one exact signal.");
});

test("generic internal controls exclude bounded provider research", () => {
  const { workItemIsSafeInternal, workItemRunControl } = workRenderers();
  const item = {
    id: "research_task",
    can_run: true,
    safe_to_run: true,
    execution_kind: "preventure_research",
    authority_hash: "sha256:authority",
    assignment_id: "assignment_1",
    assignment_hash: "sha256:assignment",
    descriptor_hash: "sha256:descriptor",
    request_body_hash: "sha256:request",
    max_cost_cents: 50,
  };
  assert.equal(workItemIsSafeInternal(item), false);
  const control = workItemRunControl(item);
  assert.match(control, /Run exact bounded research/);
  assert.match(control, /up to A\$0\.50/);
  assert.match(control, /maximum exposure may remain pending/i);
  assert.doesNotMatch(control, />Run internal step</);

  const system = systemRenderer({
    queue: [item],
    preventureResearchRuntime: {
      assignmentRunReady: true,
      providerContactAllowed: true,
    },
  });
  assert.match(system, /data-action="run-monitor"/);
  assert.match(system, /Run system check/);
  assert.match(system, /data-action="run-next" disabled/);
  assert.match(system, /data-action="maintenance" disabled/);
  assert.match(system, /Maintenance paused for bounded research/);
});

test("closed history retains owner-reported Etsy context without claiming connection", () => {
  const rows = connectionRenderer({
    preventureResearch: {
      schema: "pantheon.owner-preventure-research.v1",
      integrity: { status: "ok" },
      current: null,
      history: { items: [terminalGateFixture()] },
    },
    connections: [{ id: "etsy", metadata: {} }],
  });
  const etsy = rows.find((item) => item.id === "etsy");
  assert.equal(etsy.status, "owner_reported_unverified");
  assert.equal(etsy.health, "not_verified");
  assert.match(etsy.metadata.use, /has not inspected, connected, or technically verified/i);
});

test("monitor treats a validated early stop as a normal sealed result and freezes an orphan scheduler", () => {
  const readiness = {
    execution: { complete: true, completionMode: "validated_early_stop" },
    evidence: { missingContraryQuestions: ["rq_1"] },
  };
  assert.equal(shouldReportPreventureContraryEvidenceGap({
    terminalStopRecord: { id: "stop_1" },
    decision: { completionMode: "validated_early_stop" },
  }, readiness), false);
  assert.equal(shouldReportPreventureContraryEvidenceGap({
    terminalStopRecord: null,
    decision: null,
  }, {
    execution: { complete: true, completionMode: "full_round" },
    evidence: { missingContraryQuestions: ["rq_1"] },
  }), true);

  const finding = preventureResearchSchedulerFinding({ status: "enabled" }, 0);
  assert.equal(finding.entityId, "job-preventure-research");
  assert.match(finding.detail, /terminal, expired, proposed, accepted, frozen, or absent authority/i);
  assert.equal(preventureResearchSchedulerFinding({ status: "enabled" }, 1), null);
  assert.equal(preventureResearchSchedulerFinding({ status: "disabled" }, 0), null);
});

test("owner projection blocks an authority hash that the immutable registry cannot resolve", () => {
  let ledgerRead = false;
  const state = getPreventureResearchOwnerState(null, {
    clock: () => "2026-08-02T03:00:00.000Z",
    authorityRegistry: {
      resolveAuthorityEntry() {
        const error = new Error("Unknown exact authority hash.");
        error.code = "preventure_research_authority_unknown";
        throw error;
      },
    },
    store: {
      verifyLedger: () => ({ ok: true }),
      listAuthorities: () => [{
        authorityHash: "sha256:unknown",
        id: "unknown_authority",
        version: "v999",
      }],
      readLedger: () => {
        ledgerRead = true;
        return null;
      },
    },
  });
  assert.equal(state.integrity.status, "attention");
  assert.equal(state.integrity.authorityStatus, "unavailable");
  assert.equal(state.current, null);
  assert.equal(ledgerRead, false);
});
