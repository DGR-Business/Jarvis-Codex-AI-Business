"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const appSource = fs.readFileSync(path.join(root, "public", "app.js"), "utf8");
const indexSource = fs.readFileSync(path.join(root, "public", "index.html"), "utf8");
const stylesSource = fs.readFileSync(path.join(root, "public", "styles.css"), "utf8");

function sourceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.notEqual(start, -1, `Missing source marker: ${startMarker}`);
  assert.notEqual(end, -1, `Missing source marker: ${endMarker}`);
  return source.slice(start, end);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function ownerMarkupRenderer() {
  const source = sourceBetween(
    appSource,
    "function ownerTestUtcDateTime",
    "\nfunction renderTests",
  );
  return vm.runInNewContext(`(() => {
    ${source}
    return ownerTestsMarkup;
  })()`, {
    badge: (label, tone) => `<span class="badge ${tone}">${escapeHtml(label)}</span>`,
    emptyState: (title, summary) => `<div class="empty-state"><h3>${escapeHtml(title)}</h3><p>${escapeHtml(summary)}</p></div>`,
    escapeHtml,
    humanStatus: (value) => String(value || "unknown").replace(/[_-]+/g, " "),
    icon: (name) => `<i data-icon="${escapeHtml(name)}"></i>`,
    money: (cents) => {
      const amount = Number(cents) / 100;
      return `${amount < 0 ? "-" : ""}A$${Math.abs(amount).toFixed(2)}`;
    },
    sectionHeading: (title, summary) => `<div class="section-heading"><h2>${escapeHtml(title)}</h2><p>${escapeHtml(summary)}</p></div>`,
    shortDate: (value) => String(value || "Not set"),
  });
}

function evidenceHelpers() {
  const source = sourceBetween(
    appSource,
    "function approvedEvidencePurpose",
    "\nfunction renderDecisionEvidenceFiles",
  );
  return vm.runInNewContext(`(() => {
    ${source}
    return { approvedEvidencePurpose, approvedEvidenceRole, inspectApprovedEvidenceSet };
  })()`);
}

function workControlHelpers() {
  const source = sourceBetween(
    appSource,
    "function workItemCanRun",
    "\nfunction renderCommandBand",
  );
  return vm.runInNewContext(`(() => {
    ${source}
    return {
      workItemCanRun,
      workItemHasRunAuthorityState,
      workItemIsSafeInternal,
      workItemUnavailableReason,
      workItemRunControl,
    };
  })()`, {
    escapeHtml,
    humanStatus: (value) => String(value || "unknown").replace(/[_-]+/g, " "),
    icon: (name) => `<i data-icon="${escapeHtml(name)}"></i>`,
    money: (cents) => `A$${(Number(cents) / 100).toFixed(2)}`,
  });
}

function maintenanceSummaryRenderer() {
  const source = sourceBetween(
    appSource,
    "function maintenanceRunSummary",
    "\nasync function handleAction",
  );
  return vm.runInNewContext(`(() => {
    ${source}
    return maintenanceRunSummary;
  })()`);
}

function ownerFixture() {
  return {
    schema: "pantheon.owner-tests-results.v1",
    readOnly: true,
    controls: { allowed: ["review_decision"] },
    integrity: {
      status: "ok",
      authorityStatus: "accepted",
      message: "One accepted program is awaiting activation.",
    },
    current: {
      title: "<script>unsafe title</script>",
      lifecycle: {
        status: "accepted",
        label: "Accepted · activation pending",
      },
      buyer: "Solo social-media managers",
      problem: "Approvals and scope changes become fragmented.",
      offer: {
        id: "offer-scope-guard",
        version: "v1",
        sku: "scope-guard-v1",
        description: "Client Approval & Scope Guard Kit",
      },
      channel: {
        id: "etsy",
        label: "Etsy",
      },
      price: {
        currency: "AUD",
        amountCents: 2900,
      },
      reportingPeriod: {
        startsAt: "2026-08-01T00:00:00.000Z",
        endsAt: "2026-08-31T23:59:59.000Z",
      },
      hypothesis: "The exact buyer will pay for a low-touch operational control kit.",
      moneyMove: {
        title: "Prove attributable paid demand.",
        detail: "Use only the accepted channel and evidence window.",
      },
      evidenceQuality: {
        status: "collecting",
        label: "Evidence collecting",
        summary: "The evidence period remains open.",
      },
      proof: {
        buyers: {
          verifiedPositive: 1,
          target: 3,
        },
        netCashContribution: {
          status: "not_settled",
          currency: "AUD",
          amountCents: null,
        },
        commercialProofReached: false,
      },
      reviewDecision: {
        id: "approval-commercial-test",
        label: "Review decision",
      },
    },
    closedHistory: {
      total: 1,
      items: [{
        title: "Earlier stopped test",
        lifecycle: {
          status: "stopped",
          label: "Stopped",
          closedAt: "2026-07-20T00:00:00.000Z",
        },
        buyer: "Earlier buyer",
        evidenceQuality: {
          status: "incomplete",
          label: "Incomplete",
        },
        proof: {
          buyers: {
            verifiedPositive: 0,
            target: 3,
          },
          netCashContribution: {
            status: "not_settled",
            currency: "AUD",
            amountCents: null,
          },
          commercialProofReached: false,
        },
      }],
    },
    emptyState: {
      title: "No commercial test is authorised",
      summary: "An exact accepted program is required.",
    },
  };
}

test("Tests & Results navigation is visible after Portfolio and supports seven mobile items", () => {
  const portfolio = indexSource.indexOf('data-view="portfolio"');
  const tests = indexSource.indexOf('data-view="tests"');
  const team = indexSource.indexOf('data-view="ai-team"');
  assert.ok(portfolio < tests && tests < team);
  assert.match(indexSource.slice(tests, team), /Tests &amp; Results/);
  assert.match(appSource, /tests: \{ title: "Tests & Results", kicker: "Buyer and cash evidence", endpoint: "\/api\/tests" \}/);
  assert.match(stylesSource, /\.nav-list \{ grid-template-columns: repeat\(7, minmax\(0, 1fr\)\)/);
  assert.match(stylesSource, /\.metric-grid\.owner-proof-grid \{ grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/);
});

test("owner Tests & Results markup is read-only and exposes only the exact review decision", () => {
  const render = ownerMarkupRenderer();
  const markup = render(ownerFixture());

  assert.match(markup, /data-read-only="true"/);
  assert.match(markup, /Evidence quality/);
  assert.match(markup, /Verified independent buyers/);
  assert.match(markup, />1 \/ 3</);
  assert.match(markup, /Actual net cash contribution/);
  assert.match(markup, />Not settled</);
  assert.match(markup, /Review decision/);
  assert.equal((markup.match(/Review decision/g) || []).length, 1);
  assert.match(markup, /data-kind="decision"/);
  assert.doesNotMatch(markup, /data-kind="test"/);
  assert.doesNotMatch(markup, /<form|<input|type="file"/i);
  assert.doesNotMatch(
    markup,
    /data-action="(?:start-discovery|run-pantheon|restart-journey|import-gumroad|open-outputs|test-tab)"/,
  );
  assert.match(markup, /<details class="closed-test-history">/);
  assert.doesNotMatch(markup, /<details[^>]*\sopen(?:\s|=|>)/);
  assert.doesNotMatch(markup, /<script>unsafe title<\/script>/);
  assert.match(markup, /&lt;script&gt;unsafe title&lt;\/script&gt;/);
});

test("owner Tests & Results withholds cash and actions unless their exact states allow them", () => {
  const render = ownerMarkupRenderer();
  const fixture = ownerFixture();
  fixture.integrity.authorityStatus = "activated";
  fixture.integrity.message = "One controlled test is active.";
  fixture.current.lifecycle = {
    status: "activated",
    label: "Active controlled test",
  };
  const activatedMarkup = render(fixture);
  assert.doesNotMatch(activatedMarkup, /Review decision/);

  fixture.controls.allowed = [];
  fixture.current.reviewDecision = null;
  fixture.current.proof.netCashContribution = {
    status: "settled",
    currency: "AUD",
    amountCents: -425,
  };
  const settledMarkup = render(fixture);
  assert.match(settledMarkup, /-A\$4\.25/);
  assert.doesNotMatch(settledMarkup, /Review decision/);

  const attention = ownerFixture();
  attention.integrity = {
    status: "attention",
    authorityStatus: "ambiguous",
    message: "More than one current commercial program was found.",
  };
  const attentionMarkup = render(attention);
  assert.match(attentionMarkup, /Commercial records need reconciliation/);
  assert.match(attentionMarkup, /More than one current commercial program was found/);
  assert.doesNotMatch(attentionMarkup, /unsafe title|Verified independent buyers|Actual net cash contribution/);

  const empty = ownerFixture();
  empty.current = null;
  const emptyMarkup = render(empty);
  assert.match(emptyMarkup, /No commercial test is authorised/);
  assert.match(emptyMarkup, /Closed history/);
  assert.doesNotMatch(emptyMarkup, /Review decision/);
});

test("owner proof figures fail closed independently while an explicit verified zero remains zero", () => {
  const render = ownerMarkupRenderer();

  const missingBuyer = ownerFixture();
  missingBuyer.closedHistory = { total: 0, items: [] };
  delete missingBuyer.current.proof.buyers.verifiedPositive;
  const missingBuyerMarkup = render(missingBuyer);
  assert.match(missingBuyerMarkup, /Verified independent buyers[\s\S]*Withheld - needs review/);
  assert.match(missingBuyerMarkup, /Actual net cash contribution[\s\S]*Not settled/);

  const missingCash = ownerFixture();
  missingCash.closedHistory = { total: 0, items: [] };
  delete missingCash.current.proof.netCashContribution;
  const missingCashMarkup = render(missingCash);
  assert.match(missingCashMarkup, /Verified independent buyers[\s\S]*1 \/ 3/);
  assert.match(missingCashMarkup, /Actual net cash contribution[\s\S]*Withheld - needs review/);

  const contradictoryCash = ownerFixture();
  contradictoryCash.closedHistory = { total: 0, items: [] };
  contradictoryCash.current.proof.netCashContribution.amountCents = 0;
  const contradictoryCashMarkup = render(contradictoryCash);
  assert.match(contradictoryCashMarkup, /Actual net cash contribution[\s\S]*Withheld - needs review/);

  const explicitZero = ownerFixture();
  explicitZero.closedHistory = { total: 0, items: [] };
  explicitZero.current.proof.buyers.verifiedPositive = 0;
  explicitZero.current.proof.commercialProofReached = false;
  const explicitZeroMarkup = render(explicitZero);
  assert.match(explicitZeroMarkup, /Verified independent buyers[\s\S]*0 \/ 3/);
  assert.doesNotMatch(explicitZeroMarkup, /Verified independent buyers[\s\S]*Withheld - needs review/);

  const unverifiedZero = ownerFixture();
  unverifiedZero.closedHistory = { total: 0, items: [] };
  unverifiedZero.current.proof.buyers.verifiedPositive = 0;
  delete unverifiedZero.current.proof.commercialProofReached;
  const unverifiedZeroMarkup = render(unverifiedZero);
  assert.match(unverifiedZeroMarkup, /Verified independent buyers[\s\S]*Withheld - needs review/);
  assert.match(unverifiedZeroMarkup, /Actual net cash contribution[\s\S]*Withheld - needs review/);
});

test("legacy Tests controls and tab state are absent from the owner view", () => {
  const projection = sourceBetween(
    appSource,
    "function ownerTestUtcDateTime",
    "\nfunction initials",
  );
  assert.doesNotMatch(projection, /start-discovery|run-pantheon|restart-journey/);
  assert.doesNotMatch(projection, /import-gumroad|gumroad-csv|open-outputs/);
  assert.doesNotMatch(projection, /test-tab|store\.testTab|pilotPolicy/);
  assert.doesNotMatch(projection, /qualifiedViewTarget|optionalPaidTestCents/);
  assert.doesNotMatch(appSource, /function testTabs|store\.testTab|action === "test-tab"/);
  assert.doesNotMatch(appSource, /action === "import-gumroad"|gumroad-csv/);
});

test("owner wording keeps retained portfolio work and investment directions audit-only", () => {
  const portfolio = sourceBetween(
    appSource,
    "function portfolioNextAction",
    "\nfunction commercialKnowledgePanel",
  );
  assert.match(portfolio, /Retained portfolio history/);
  assert.match(portfolio, /data-retained-source=/);
  assert.match(portfolio, /active\.status === "retained_read_only"/);
  assert.match(portfolio, /This earlier round is being treated as read-only/);
  assert.match(portfolio, /Historical direction \(audit only\)/);
  assert.doesNotMatch(
    portfolio,
    /Current work|completing this internal research now|market scan is underway|Five opportunity spaces will appear/,
  );

  const investment = sourceBetween(
    appSource,
    'if (kind === "investment-case") {',
    '\n  if (kind === "service-trial") {',
  );
  assert.match(investment, /Historical direction \(audit only\)/);
  assert.match(investment, /Current direction/);
  assert.match(investment, /Use Tests &amp; Results/);
  assert.doesNotMatch(investment, /detailSection\("What happens next"/);
  assert.doesNotMatch(appSource, /buyerIntentOption|commandMode|action === "command-mode"|action === "open-outputs"/);
});

test("legacy production and journey records cannot become a current money move", () => {
  const cockpit = sourceBetween(
    appSource,
    "function renderCockpit",
    "\nfunction decisionTabs",
  );
  assert.match(cockpit, /journey\?\.execution\?\.running === true/);
  assert.doesNotMatch(cockpit, /journey\?\.currentTask\?\.status === "running"/);
  assert.match(cockpit, /No current commercial test buyer result/);
  assert.match(cockpit, /retained commercial history/);
  assert.doesNotMatch(
    cockpit,
    /Pantheon is checking the finished product files|Pantheon is preparing truthful listing copy|Review the complete publication-ready package|Complete the separate Gumroad publishing action|Decide whether Pantheon should build/,
  );

  const journey = sourceBetween(
    appSource,
    "function renderJourney",
    "\nfunction updateBackgroundInert",
  );
  assert.match(journey, /const journeyReadOnly = !commercialControlAllowed/);
  assert.match(journey, /RETAINED JOURNEY HISTORY/);
  assert.match(journey, /Recorded stage:/);
  assert.match(journey, /Recorded stage history only/);
  assert.match(
    journey,
    /const currentAction = journeyReadOnly \|\| terminalStopped/,
  );
});

test("owner language does not overclaim autonomy, active runs, or publication readiness", () => {
  assert.match(
    appSource,
    /Internal work runs only when its recorded state and authority allow it/,
  );
  assert.match(appSource, /No owner action is currently listed/);
  assert.match(appSource, /Run records/);
  assert.match(
    appSource,
    /No current test authority or verified market result is shown here/,
  );
  assert.match(
    appSource,
    /Each action remains subject to exact authority, approval, cost, and review controls/,
  );
  assert.match(
    appSource,
    /journey: \{ title: "Full Journey", kicker: "Authorised work and evidence"/,
  );
  assert.doesNotMatch(
    appSource,
    /stops only|Pantheon is working without needing you|>Live Runs<|Research to ready to publish|still selecting and validating|supervised until/,
  );
});

test("maintenance, venture switching, and commercial search controls match their real boundaries", () => {
  const maintenance = sourceBetween(
    appSource,
    "function maintenanceRunSummary",
    "\n  if (action === \"prepare-retention-decision\")",
  );
  assert.match(maintenance, /postJson\("\/api\/system\/maintenance\/run-due", \{\}\)/);
  assert.doesNotMatch(maintenance, /\/api\/monitor\/run|Maintenance completed/);

  const summarize = maintenanceSummaryRenderer();
  assert.equal(
    summarize({
      dueCount: 2,
      claimedCount: 1,
      runs: [{ status: "completed" }, { status: "skipped" }],
    }),
    "Maintenance check: 2 due; 1 claimed; 1 skipped.",
  );
  assert.equal(
    summarize({ dueCount: 1, claimedCount: 1, runs: [] }),
    "The maintenance counts need review; no completion is being assumed.",
  );

  assert.match(indexSource, /Active venture \(read-only\)/);
  assert.match(
    indexSource,
    /<select id="venture-select"[^>]*aria-disabled="true"[^>]*disabled>/,
  );
  const ventureLoader = sourceBetween(
    appSource,
    "async function loadVentures",
    "\nasync function postJson",
  );
  assert.match(ventureLoader, /select\.disabled = true/);
  assert.doesNotMatch(ventureLoader, /select\.disabled = ventures\.length/);

  const knowledge = sourceBetween(
    appSource,
    "function commercialKnowledgePanel",
    "\nfunction serviceTrialsPanel",
  );
  assert.match(knowledge, /<form class="knowledge-search" data-action="commercial-search">/);
  const binding = sourceBetween(
    appSource,
    "function bindEvents",
    "\nfunction establishSession",
  );
  assert.match(binding, /addEventListener\("submit"/);
  assert.match(binding, /event\.preventDefault\(\)/);
  assert.match(binding, /await handleAction\(form\)/);
});

test("run controls obey per-item backend authority and reserve generic Run next for safe internal work", () => {
  const {
    workItemCanRun,
    workItemHasRunAuthorityState,
    workItemIsSafeInternal,
    workItemUnavailableReason,
    workItemRunControl,
  } = workControlHelpers();
  const blocked = {
    id: "blocked-commercial",
    status: "queued",
    can_run: false,
    safe_to_run: false,
    safety_classification: "commercial",
    safety_reason: "commercial_authority_missing",
    run_label: "Run blocked work",
  };
  assert.equal(workItemCanRun(blocked), false);
  assert.equal(workItemHasRunAuthorityState({ ...blocked, type: "authority_blocked_work" }), true);
  assert.equal(workItemIsSafeInternal(blocked), false);
  assert.equal(
    workItemUnavailableReason(blocked),
    "Current commercial authority does not allow this step",
  );
  assert.doesNotMatch(workItemRunControl(blocked), /data-action="run-task"/);
  assert.match(workItemRunControl(blocked), /data-view="tests"/);
  assert.match(
    appSource,
    /\["queued_work", "approved_work"\]\.includes\(item\.type\) \|\| workItemHasRunAuthorityState\(item\)/,
  );

  const approvedAi = {
    id: "approved-ai",
    status: "queued",
    can_run: true,
    safe_to_run: false,
    run_label: "Run approved AI check",
  };
  assert.equal(workItemCanRun(approvedAi), true);
  assert.equal(workItemIsSafeInternal(approvedAi), false);
  assert.match(workItemRunControl(approvedAi), /data-action="run-task"/);

  const safeInternal = {
    id: "safe-internal",
    status: "queued",
    can_run: true,
    safe_to_run: true,
    run_label: "Run internal check",
  };
  assert.equal(workItemIsSafeInternal(safeInternal), true);
  assert.match(workItemRunControl(safeInternal), /data-action="run-task"/);
  assert.match(appSource, /data\.queue\.some\(workItemIsSafeInternal\)/);
});

test("owner screens withhold ambiguous proof and expose no retired commercial controls", () => {
  assert.match(appSource, /Buyer proof withheld/);
  assert.match(appSource, /Withheld [—-] needs review/);
  assert.doesNotMatch(
    appSource,
    /data-action="(?:start-discovery|start-portfolio-discovery|continue-portfolio|prepare-portfolio-retry|prepare-buyer-intent|start-journey|restart-journey|run-pantheon|submit-command)"/,
  );
  assert.doesNotMatch(appSource, /\/api\/portfolio\/discovery|\/api\/commands/);
  assert.doesNotMatch(
    appSource,
    /postJson\("\/api\/pantheon\/journeys",|prepare-buyer-intent-test/,
  );
  assert.match(appSource, /Business journey is waiting for authority/);
  assert.match(appSource, /No broad or unbound journey can be started from this screen/);
});

test("exact evidence review requires unique explicit roles and treats workbook-preview as storefront", () => {
  const {
    approvedEvidencePurpose,
    approvedEvidenceRole,
    inspectApprovedEvidenceSet,
  } = evidenceHelpers();
  const valid = [
    {
      id: "preview-catalogue",
      name: "catalogue-overview.png",
      summary: "Storefront preview",
      qualityReviewOnly: false,
      evidenceRole: null,
    },
    {
      id: "preview-workbook",
      name: "workbook-preview.png",
      summary: "Storefront preview",
      qualityReviewOnly: false,
      evidenceRole: null,
    },
    {
      id: "workbook-inspection",
      name: "actual-workbook-inspection.png",
      qualityReviewOnly: true,
      evidenceRole: "workbook_inspection",
    },
    {
      id: "setup-guide-inspection",
      name: "complete-setup-guide-inspection.png",
      qualityReviewOnly: true,
      evidenceRole: "setup_guide_inspection",
    },
  ];

  assert.equal(approvedEvidenceRole(valid[1]), "storefront_preview");
  assert.equal(approvedEvidencePurpose(valid[1], 2), "Storefront preview 2");
  assert.equal(inspectApprovedEvidenceSet(valid).complete, true);

  const duplicateId = valid.map((item) => ({ ...item }));
  duplicateId[1].id = duplicateId[0].id;
  assert.equal(inspectApprovedEvidenceSet(duplicateId).complete, false);

  const duplicateRole = valid.map((item) => ({ ...item }));
  duplicateRole[3].evidenceRole = "workbook_inspection";
  assert.equal(inspectApprovedEvidenceSet(duplicateRole).complete, false);

  const wrongRole = valid.map((item) => ({ ...item }));
  wrongRole[3].evidenceRole = "customer_package";
  assert.equal(inspectApprovedEvidenceSet(wrongRole).complete, false);

  const missingExplicitRole = valid.map((item) => ({ ...item }));
  missingExplicitRole[2].evidenceRole = null;
  assert.equal(inspectApprovedEvidenceSet(missingExplicitRole).complete, false);

  const decisionProjection = sourceBetween(
    appSource,
    "function approvedEvidencePurpose",
    "\nfunction plainAgentText",
  );
  assert.doesNotMatch(decisionProjection, /files\.length === 4/);
  assert.match(appSource, /allowApprove: !inspectionEvidenceRecheck \|\| inspectedEvidenceSet\?\.complete === true/);
});
