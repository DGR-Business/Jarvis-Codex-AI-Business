const store = {
  view: "cockpit",
  data: {},
  csrfToken: null,
  commandMode: "plan_only",
  decisionTab: "approvals",
  testTab: "candidate",
  systemTab: "health",
  showArchivedOutputs: false,
  reloadTimer: null,
};

const viewConfig = {
  cockpit: { title: "Command Center", kicker: "Business overview", endpoint: "/api/cockpit" },
  decisions: { title: "Decisions", kicker: "Your attention", endpoint: "/api/decisions" },
  tests: { title: "Business Tests", kicker: "Evidence to revenue", endpoint: "/api/tests" },
  "ai-team": { title: "AI Team", kicker: "Workers and capability", endpoint: "/api/ai-team" },
  system: { title: "System", kicker: "Operations and detail", endpoint: "/api/system" },
};

const agentGroupLabels = {
  command: "Command",
  evidence: "Evidence",
  venture: "Venture",
  control: "Control and learning",
};

function $(selector) { return document.querySelector(selector); }
function $all(selector) { return Array.from(document.querySelectorAll(selector)); }

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function icon(name) { return `<i data-lucide="${escapeHtml(name)}"></i>`; }

function refreshIcons() {
  if (window.lucide?.createIcons) window.lucide.createIcons({ attrs: { "stroke-width": 1.8 } });
}

function humanStatus(value) {
  const key = String(value || "unknown").toLowerCase();
  const labels = {
    pending: "Waiting for decision",
    approval_requested: "Waiting for decision",
    blocked_for_approval: "Waiting for your decision",
    blocked_for_credentials: "Setup needed",
    dry_run_complete: "Internal work complete",
    ready_for_review: "Ready for review",
    needs_attention: "Needs attention",
    needs_changes: "Changes requested",
    incurred_estimate: "Estimated charge",
    unknown: "Needs reconciliation",
    planned: "Waiting",
    queued: "Ready",
    active: "Running",
    proving: "Validating",
    not_configured: "Not connected",
    completed_live: "Research complete",
    completed_live_needs_source_review: "Source review needed",
  };
  return labels[key] || key.replace(/[._-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function statusTone(value) {
  const key = String(value || "").toLowerCase();
  if (/(failed|attention|unknown|rejected|stopped|cancel)/.test(key)) return "coral";
  if (/(pending|waiting|blocked|change|setup|estimate)/.test(key)) return "amber";
  if (/(working|complete|ready|approved|running|operating|promoted)/.test(key)) return "mint";
  return "sky";
}

function badge(value, tone = statusTone(value)) {
  return `<span class="badge ${tone}">${escapeHtml(humanStatus(value))}</span>`;
}

function money(cents, currency = "AUD") {
  return new Intl.NumberFormat("en-AU", { style: "currency", currency, maximumFractionDigits: 2 }).format(Number(cents || 0) / 100);
}

function shortDate(value) {
  if (!value) return "Not set";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return escapeHtml(value);
  return new Intl.DateTimeFormat("en-AU", { day: "numeric", month: "short", year: "numeric" }).format(date);
}

function compact(value, max = 180) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}

async function fetchJson(url, options = {}) {
  const method = String(options.method || "GET").toUpperCase();
  const headers = { "content-type": "application/json", ...(options.headers || {}) };
  if (!["GET", "HEAD"].includes(method) && store.csrfToken) headers["x-jarvis-csrf"] = store.csrfToken;
  const response = await fetch(url, { ...options, headers });
  let payload;
  try { payload = await response.json(); } catch { payload = {}; }
  if (!response.ok) throw new Error(payload.error || `Request failed with status ${response.status}.`);
  return payload;
}

async function loadVentures() {
  const data = await fetchJson("/api/ventures");
  const select = $("#venture-select");
  const ventures = data.ventures || [];
  select.innerHTML = ventures.length
    ? ventures.map((venture) => `<option value="${escapeHtml(venture.id)}"${venture.is_active ? " selected" : ""}>${escapeHtml(venture.name)}</option>`).join("")
    : "<option>No active venture</option>";
  select.disabled = ventures.length <= 1;
}

async function postJson(url, body = {}) {
  return fetchJson(url, { method: "POST", body: JSON.stringify(body) });
}

function toast(message) {
  const element = $("#toast");
  element.textContent = message;
  element.classList.add("visible");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => element.classList.remove("visible"), 3200);
}

function setConnection(online, label = online ? "Connected" : "Reconnecting") {
  $("#connection-dot").classList.toggle("online", online);
  $("#connection-label").textContent = label;
}

function setPage(view) {
  const config = viewConfig[view];
  $("#page-title").textContent = config.title;
  $("#page-kicker").textContent = config.kicker;
  $all(".nav-button").forEach((button) => button.classList.toggle("active", button.dataset.view === view));
}

async function loadView(view = store.view, options = {}) {
  store.view = view;
  setPage(view);
  if (!options.silent) {
    $("#view").innerHTML = '<div class="loading-state"><span></span><p>Loading business state...</p></div>';
  }
  try {
    store.data[view] = await fetchJson(viewConfig[view].endpoint);
    renderView();
  } catch (error) {
    $("#view").innerHTML = `<div class="empty-state">${icon("triangle-alert")}<h3>Could not load this section</h3><p>${escapeHtml(error.message)}</p></div>`;
    refreshIcons();
    throw error;
  }
}

function sectionHeading(title, description = "", action = "") {
  return `<div class="section-heading"><div><h2>${escapeHtml(title)}</h2>${description ? `<p>${escapeHtml(description)}</p>` : ""}</div>${action}</div>`;
}

function emptyState(title, message, iconName = "check-circle-2") {
  return `<div class="empty-state">${icon(iconName)}<h3>${escapeHtml(title)}</h3><p>${escapeHtml(message)}</p></div>`;
}

function approvalButtons(item, compactButtons = false) {
  const sizeClass = compactButtons ? "" : "";
  const action = item.decisionKind === "handoff" ? "handoff-decision" : "approval";
  return `<div class="work-actions ${sizeClass}">
    <button class="primary-button" data-action="${action}" data-id="${escapeHtml(item.id)}" data-decision="approve" data-scope-hash="${escapeHtml(item.scopeHash)}">${icon("check")}Approve</button>
    <button class="secondary-button" data-action="${action}" data-id="${escapeHtml(item.id)}" data-decision="changes" data-scope-hash="${escapeHtml(item.scopeHash)}">${icon("pencil-line")}Changes</button>
    <button class="danger-button" data-action="${action}" data-id="${escapeHtml(item.id)}" data-decision="reject" data-scope-hash="${escapeHtml(item.scopeHash)}">${icon("x")}Decline</button>
  </div>`;
}

function renderCommandBand(data) {
  return `<section class="command-band">
    <div>
      <span class="section-label">Command Jarvis</span>
      <textarea id="command-text" aria-label="Business instruction" placeholder="What should the team investigate, prepare or improve next?"></textarea>
    </div>
    <div class="command-controls">
      <div class="segmented" aria-label="Command mode">
        <button type="button" class="${store.commandMode === "plan_only" ? "active" : ""}" data-action="command-mode" data-mode="plan_only">Plan only</button>
        <button type="button" class="${store.commandMode === "run_protected" ? "active" : ""}" data-action="command-mode" data-mode="run_protected">Run internal work</button>
      </div>
      <button type="button" class="primary-button" data-action="submit-command" data-venture-id="${escapeHtml(data.activeVenture.id)}">${icon("send")}Send</button>
    </div>
  </section>`;
}

function renderImportantWork(items) {
  if (!items.length) {
    return `<section class="priority-panel clear"><div class="priority-header"><div><span class="eyebrow">Important work</span><h2>Nothing needs your attention</h2></div>${badge("Operating normally", "mint")}</div></section>`;
  }
  return `<section class="priority-panel">
    <div class="priority-header"><div><span class="eyebrow">Important work</span><h2>${items.length} item${items.length === 1 ? " needs" : "s need"} a decision or check</h2></div>${badge("Needs attention", "coral")}</div>
    <div class="priority-list">${items.map((item) => `<article class="work-item">
      <span class="risk-bar ${escapeHtml(item.risk || "medium")}"></span>
      <div class="work-copy"><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(compact(item.recommendation, 260))}</p>${item.expectedUpside ? `<small>Why it matters: ${escapeHtml(compact(item.expectedUpside, 180))}</small>` : ""}</div>
      ${item.type === "decision" ? approvalButtons(item, true) : `<button class="secondary-button" data-action="open-drawer" data-kind="work" data-id="${escapeHtml(item.id)}">${icon("arrow-right")}Review</button>`}
    </article>`).join("")}</div>
  </section>`;
}

function renderWeeklyDigest(digest) {
  if (!digest) return "";
  const metrics = digest.metrics || {};
  return `<section class="weekly-brief">
    <div><span class="eyebrow">Weekly executive brief</span><h2>${escapeHtml(digest.summary)}</h2><p>${escapeHtml(shortDate(digest.period_start))} to ${escapeHtml(shortDate(digest.period_end))}</p></div>
    <dl class="brief-facts"><div><dt>Work completed</dt><dd>${metrics.completedWork || 0}</dd></div><div><dt>Buyer proof</dt><dd>${metrics.independentBuyers || 0}/3</dd></div><div><dt>Needs attention</dt><dd>${Number(metrics.openDecisions || 0) + Number(metrics.unknownOutcomes || 0)}</dd></div></dl>
  </section>`;
}

function renderCockpit() {
  const data = store.data.cockpit;
  const economics = data.economics;
  const spend = data.spend;
  const test = data.currentTest;
  const importantDecisions = data.importantWork.filter((item) => item.type === "decision").length;
  const decisionCount = $("#decision-count");
  decisionCount.textContent = importantDecisions;
  decisionCount.hidden = importantDecisions === 0;
  const teamRows = data.teamPulse.agents
    .filter((agent) => agent.status !== "Standby" || ["chief_of_staff", "demand_validator", "offer_architect", "product_builder"].includes(agent.id))
    .slice(0, 6);

  $("#view").innerHTML = `<div class="view-stack">
    ${renderCommandBand(data)}
    ${renderImportantWork(data.importantWork)}
    <section>
      ${sectionHeading("Business position", "One venture, one active commercial path, measured by real buyer results.")}
      <div class="metric-grid">
        <div class="metric mint"><span>Active venture</span><strong>${escapeHtml(data.activeVenture.name)}</strong><small>${escapeHtml(humanStatus(data.activeVenture.lifecycle_stage))}</small></div>
        <div class="metric sky"><span>Current test</span><strong>${test ? escapeHtml(test.name) : "Not started"}</strong><small>${test ? escapeHtml(humanStatus(test.status)) : "Evidence selection comes first"}</small></div>
        <div class="metric ${economics.cashContributionCents >= 0 ? "mint" : "coral"}"><span>Cash contribution</span><strong>${money(economics.cashContributionCents)}</strong><small>${economics.independentBuyers} independent buyer${economics.independentBuyers === 1 ? "" : "s"}</small></div>
        <div class="metric amber"><span>Monthly AI and tool cap</span><strong>${money(spend.monthlyCapCents, spend.currency)}</strong><small>${money(spend.incurredEstimateCents + spend.unknownCents, spend.currency)} estimated or unresolved</small></div>
      </div>
    </section>
    ${renderWeeklyDigest(data.weeklyDigest)}
    <section class="money-move">
      <span class="move-icon">${icon("move-right")}</span>
      <div><span class="eyebrow">Next money move</span><h2>${escapeHtml(data.nextMoneyMove)}</h2><p>Everything else is support work until this advances or evidence changes the recommendation.</p></div>
      <button class="secondary-button" data-view="tests">${icon("flask-conical")}Open business tests</button>
    </section>
    <div class="two-column">
      <section class="section-block">
        ${sectionHeading("Current commercial test", "What is being tested and what would make it worth continuing.")}
        ${test ? `<div class="surface-block accent test-summary">
          <header><div><span class="eyebrow">${escapeHtml(humanStatus(test.status))}</span><h2>${escapeHtml(test.name)}</h2></div></header>
          <p>${escapeHtml(test.hypothesis || "The test hypothesis has not been written yet.")}</p>
          <dl><div><dt>Buyer</dt><dd>${escapeHtml(test.buyer || data.ventureCase.buyer)}</dd></div><div><dt>Offer</dt><dd>${escapeHtml(test.offer || data.ventureCase.offer)}</dd></div><div><dt>Measure</dt><dd>${escapeHtml(test.expected_metric || data.ventureCase.expected_metric)}</dd></div><div><dt>Stop rule</dt><dd>${escapeHtml(data.ventureCase.kill_rule)}</dd></div></dl>
          <button class="text-button" data-action="open-drawer" data-kind="test" data-id="${escapeHtml(test.id)}">Review the full test ${icon("arrow-right")}</button>
        </div>` : emptyState("No market test is running", "The team is still selecting and validating the first digital-product opportunity.", "flask-conical")}
      </section>
      <section class="section-block">
        ${sectionHeading("Team pulse", `${data.teamPulse.working} working, ${data.teamPulse.needsAttention} need attention.`)}
        <div class="team-pulse-list">${teamRows.map((agent) => `<button class="team-pulse-row" data-action="open-drawer" data-kind="agent" data-id="${escapeHtml(agent.id)}">
          <span class="status-dot ${escapeHtml(agent.status.toLowerCase().replace(/\s+/g, "-"))}"></span><div><strong>${escapeHtml(agent.name)}</strong><p>${escapeHtml(compact(agent.assignment, 80))}</p></div><span>${escapeHtml(agent.status)}</span>
        </button>`).join("")}</div>
      </section>
    </div>
  </div>`;
}

function decisionTabs() {
  const tabs = [
    ["approvals", "Decisions"], ["reviews", "Reviews"], ["suggestions", "Suggestions"], ["history", "History"],
  ];
  return `<div class="view-tabs">${tabs.map(([id, label]) => `<button class="${store.decisionTab === id ? "active" : ""}" data-action="decision-tab" data-tab="${id}">${label}</button>`).join("")}</div>`;
}

function renderDecisions() {
  const data = store.data.decisions;
  const decisionCount = $("#decision-count");
  decisionCount.textContent = data.approvals.length;
  decisionCount.hidden = data.approvals.length === 0;
  let body = "";
  if (store.decisionTab === "approvals") {
    body = data.approvals.length ? `<div class="card-grid">${data.approvals.map((item) => `<article class="item-card">
      <header><div><span class="eyebrow">Decision</span><h3>${escapeHtml(item.title)}</h3></div>${badge(item.risk, item.risk === "high" ? "coral" : "amber")}</header>
      <p>${escapeHtml(item.recommendation)}</p>
      <div class="detail-grid"><div><span>Worker</span><strong>${escapeHtml(item.worker || "Runtime")}</strong></div><div><span>Maximum cost</span><strong>${money(item.maxCostCents)}</strong></div></div>
      <footer><button class="text-button" data-action="open-drawer" data-kind="decision" data-id="${escapeHtml(item.id)}">Review details ${icon("arrow-right")}</button>${approvalButtons(item, true)}</footer>
    </article>`).join("")}</div>` : emptyState("No decisions waiting", "Reviews and suggestions remain separate so they do not compete with consequential choices.");
  } else if (store.decisionTab === "reviews") {
    body = data.reviews.length ? `<div class="plain-list">${data.reviews.map((item) => `<article class="plain-row"><div><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.summary)}</p></div><div class="work-actions">${String(item.format).toLowerCase() === "pdf" ? `<button class="secondary-button" data-action="open-pdf" data-id="${escapeHtml(item.id)}" data-title="${escapeHtml(item.title)}">${icon("file-search")}Preview</button>` : ""}<button class="text-button" data-action="open-drawer" data-kind="review" data-id="${escapeHtml(item.id)}">Details ${icon("arrow-right")}</button></div></article>`).join("")}</div>` : emptyState("No outputs need review", "Completed packs will appear here without being presented as approval decisions.", "files");
  } else if (store.decisionTab === "suggestions") {
    body = data.suggestions.length ? `<div class="plain-list">${data.suggestions.map((item) => `<article class="plain-row"><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.summary)}</p></article>`).join("")}</div>` : emptyState("No suggestions at the moment", "The team will surface non-urgent improvements here.", "lightbulb");
  } else {
    body = data.history.length ? `<div class="table-wrap"><table><thead><tr><th>Decision</th><th>Outcome</th><th>Note</th><th>Date</th></tr></thead><tbody>${data.history.map((item) => `<tr><td><strong>${escapeHtml(item.title)}</strong></td><td>${badge(item.decision)}</td><td>${escapeHtml(item.note || "No note")}</td><td>${escapeHtml(shortDate(item.decidedAt))}</td></tr>`).join("")}</tbody></table></div>` : emptyState("No decision history yet", "Decisions will become the durable record of how the business was steered.", "history");
  }
  const sectionTitle = store.decisionTab === "approvals" ? "Decisions" : humanStatus(store.decisionTab);
  $("#view").innerHTML = `<div class="view-stack">${decisionTabs()}<section>${sectionHeading(sectionTitle, store.decisionTab === "approvals" ? "Only choices with a material consequence appear here." : "This information is available without demanding an approval.")}${body}</section></div>`;
}

function testTabs(data) {
  const tabs = [["candidate", "Plan"], ["ready", "Ready"], ["running", "Running"], ["completed", "Results"]];
  return `<div class="view-tabs">${tabs.map(([id, label]) => `<button class="${store.testTab === id ? "active" : ""}" data-action="test-tab" data-tab="${id}">${label}<span> ${data.tests[id]?.length || 0}</span></button>`).join("")}</div>`;
}

function renderTests() {
  const data = store.data.tests;
  const items = data.tests[store.testTab] || [];
  const testsBody = items.length ? `<div class="card-grid">${items.map((item) => `<article class="item-card">
    <header><div><span class="eyebrow">${escapeHtml(humanStatus(item.status))}</span><h3>${escapeHtml(item.name)}</h3></div>${badge(item.status)}</header>
    <p>${escapeHtml(item.hypothesis || "Hypothesis needs to be defined.")}</p>
    <div class="detail-grid"><div><span>Buyer</span><strong>${escapeHtml(item.buyer || "Not selected")}</strong></div><div><span>Price</span><strong>${money(item.price_cents)}</strong></div><div><span>Channel</span><strong>${escapeHtml(item.channel || "Not selected")}</strong></div><div><span>Cost cap</span><strong>${money(item.cost_cap_cents)}</strong></div></div>
    <footer>${badge(item.status)}<button class="text-button" data-action="open-drawer" data-kind="test" data-id="${escapeHtml(item.id)}">Open test ${icon("arrow-right")}</button></footer>
  </article>`).join("")}</div>` : emptyState(
    store.testTab === "candidate" ? "No opportunity has been selected" : `No tests are ${store.testTab}`,
    store.testTab === "candidate" ? "The first Evidence Brief will rank three digital-product opportunities before one is selected." : "A test will move here only when the real commercial state changes.",
    "flask-conical",
  );
  const workPackages = data.workPackages.slice(0, 8);
  const economics = data.economics || {};
  const resultsPanel = store.testTab === "completed" ? `<section class="section-block">
    ${sectionHeading("Gumroad results", "Measured sales, platform fees and refunds determine whether the first loop has proved itself.")}
    <div class="metric-grid">
      <div class="metric sky"><span>Gross sales</span><strong>${money(economics.grossRevenueCents, economics.salesCurrency || "AUD")}</strong><small>${economics.independentBuyers || 0} independent buyers</small></div>
      <div class="metric amber"><span>Platform fees</span><strong>${money(economics.platformFeesCents, economics.salesCurrency || "AUD")}</strong><small>Imported from Gumroad</small></div>
      <div class="metric coral"><span>Refunds</span><strong>${money(economics.refundsCents, economics.salesCurrency || "AUD")}</strong><small>Full and partial refunds</small></div>
      <div class="metric mint"><span>Cash contribution</span><strong>${economics.currencyMismatch ? "Needs currency review" : money(economics.cashContributionCents, economics.salesCurrency || "AUD")}</strong><small>${economics.successThresholdMet ? "First proof reached" : "Target: 3 buyers and positive contribution"}</small></div>
    </div>
    <div class="import-panel">
      <div><span class="section-label">Update measured results</span><h3>Import Gumroad sales</h3></div>
      <input id="gumroad-csv" type="file" accept=".csv,text/csv" aria-label="Choose Gumroad sales CSV">
      <button class="secondary-button" data-action="import-gumroad" data-venture-id="${escapeHtml(data.activeVenture.id)}">${icon("file-up")}Import sales</button>
    </div>
  </section>` : "";
  $("#view").innerHTML = `<div class="view-stack">
    ${testTabs(data)}
    <section>${sectionHeading(store.testTab === "completed" ? "Results" : `${humanStatus(store.testTab)} tests`, "Tests move only when a real-world action or result justifies the change.")}${testsBody}</section>
    ${store.testTab === "candidate" ? `<section class="section-block">${sectionHeading("Current preparation", "Four operator-ready packs replace long chains of disconnected worker documents.")}<div class="plain-list">${workPackages.length ? workPackages.map((item) => `<article class="plain-row"><div><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(humanStatus(item.status))}</p></div>${badge(item.status)}</article>`).join("") : `<article class="plain-row"><div><h3>Evidence Brief</h3><p>${escapeHtml(data.ventureCase.next_money_move)}</p></div>${badge("Waiting")}</article>`}</div></section>
    <section class="section-block">${sectionHeading("First-test boundaries", "The first venture earns expansion through measured buyer proof.")}<div class="detail-grid"><div><span>Test window</span><strong>${data.pilotPolicy.testDurationDays || 14} days or ${data.pilotPolicy.qualifiedViewTarget || 50} qualified views</strong></div><div><span>Success</span><strong>${data.pilotPolicy.successBuyers || 3} paid buyers and positive contribution</strong></div><div><span>Organic limit</span><strong>${data.pilotPolicy.organicPostLimit || 3} posts across ${data.pilotPolicy.organicChannelLimit || 2} channels</strong></div><div><span>Optional paid test</span><strong>${money(data.pilotPolicy.optionalPaidTestCents || 2500)} with your approval</strong></div></div></section>` : ""}
    ${resultsPanel}
  </div>`;
}

function initials(name) {
  return String(name || "AI").split(/\s+/).map((word) => word[0]).join("").slice(0, 2).toUpperCase();
}

function renderAiTeam() {
  const data = store.data["ai-team"];
  const groups = Object.keys(agentGroupLabels);
  const pilot = data.pilot || {};
  const nextFixture = pilot.fixtures?.find((fixture) => ["ready", "reviewed"].includes(fixture.status));
  const pendingReview = pilot.reviews?.find((review) => review.operator_verdict === "pending");
  const pilotAction = pendingReview ? `<div class="pilot-review-form">
      <select id="pilot-usefulness-score" aria-label="Commercial usefulness score"><option value="5">5 - Excellent</option><option value="4">4 - Useful</option><option value="3" selected>3 - Adequate</option><option value="2">2 - Weak</option><option value="1">1 - Not useful</option></select>
      <input id="pilot-review-note" type="text" placeholder="Short review note" aria-label="Pilot review note">
      <div class="work-actions"><button class="primary-button" data-action="review-pilot" data-run-id="${escapeHtml(pendingReview.run_id)}" data-verdict="useful">${icon("check")}Useful</button><button class="secondary-button" data-action="review-pilot" data-run-id="${escapeHtml(pendingReview.run_id)}" data-verdict="changes_required">${icon("pencil-line")}Needs changes</button></div>
    </div>` : nextFixture ? `<button class="secondary-button" data-action="prepare-pilot" data-fixture-id="${escapeHtml(nextFixture.id)}">${icon("flask-conical")}Prepare controlled proof</button>` : badge("Waiting");
  $("#view").innerHTML = `<div class="view-stack">
    <section class="pilot-panel">
      <div><span class="section-label">Demand Validator proof</span><h2>Reasoning over supplied evidence</h2><p>${escapeHtml(pilot.nextAction || "The first AI capability remains supervised.")}</p></div>
      <div class="pilot-progress"><strong>${pilot.capability?.consecutive_passes || 0}/${pilot.capability?.required_passes || 5}</strong><span>reviewed successes</span></div>
      ${pilotAction}
    </section>
    <section>${sectionHeading("The working team", "All workers are visible. Capability is earned per exact task, never granted to an agent globally.")}
      <div class="agent-groups">${groups.map((group) => {
        const agents = data.agents.filter((agent) => agent.group === group);
        return `<section class="agent-group"><span class="section-label">${escapeHtml(agentGroupLabels[group])}</span><div class="agent-grid">${agents.map((agent) => `<button class="agent-card" data-action="open-drawer" data-kind="agent" data-id="${escapeHtml(agent.id)}">
          <span class="agent-initial">${escapeHtml(initials(agent.name))}</span><div><h3>${escapeHtml(agent.name)}</h3><p>${escapeHtml(agent.assignment)}</p></div><span class="agent-meta">${badge(agent.status)}<small>${agent.autonomy.passes}/${agent.autonomy.required} reviewed passes</small></span>
        </button>`).join("")}</div></section>`;
      }).join("")}</div>
    </section>
  </div>`;
}

function systemTabs() {
  const tabs = [["health", "Health"], ["queue", "Queue"], ["spend", "Spend"], ["connections", "Connections"], ["outputs", "Outputs"], ["activity", "Activity"]];
  return `<div class="view-tabs">${tabs.map(([id, label]) => `<button class="${store.systemTab === id ? "active" : ""}" data-action="system-tab" data-tab="${id}">${label}</button>`).join("")}</div>`;
}

function outputRows(items) {
  return `<div class="plain-list">${items.map((item) => `<article class="plain-row"><div><h3>${escapeHtml(item.human_name)}</h3><p>${escapeHtml(item.summary)}</p></div><div class="work-actions">${String(item.format).toLowerCase() === "pdf" && item.file_path ? `<button class="secondary-button" data-action="open-pdf" data-id="${escapeHtml(item.id)}" data-title="${escapeHtml(item.human_name)}">${icon("file-search")}Preview</button>` : ""}${badge(item.status)}</div></article>`).join("")}</div>`;
}

function renderSystemPanel(data) {
  if (store.systemTab === "health") {
    const ai = data.health.liveAi;
    const research = data.health.liveResearch;
    return `<div class="card-grid">
      <article class="item-card"><header><h3>Runtime database</h3>${badge(data.health.database === "ok" ? "Operating normally" : "Needs attention")}</header><p>The durable operating state passed its latest integrity check.</p></article>
      <article class="item-card"><header><h3>AI worker connection</h3>${badge(ai.ready ? "Ready" : "Setup needed")}</header><p>${escapeHtml(ai.ready ? "The capped worker path is available when you approve a pilot." : compact(ai.blockers?.join(" ") || "Credentials and live permission are not configured."))}</p></article>
      <article class="item-card"><header><h3>Live research</h3>${badge(research.ready ? "Ready" : "Setup needed")}</header><p>${escapeHtml(research.ready ? "Read-only sourced research can run after approval." : compact(research.blockers?.join(" ") || "The research connection is not configured."))}</p></article>
      <article class="item-card"><header><h3>External actions</h3>${badge("Your approval required", "mint")}</header><p>Publishing, customer contact, account changes and spend still require your explicit decision.</p></article>
    </div>`;
  }
  if (store.systemTab === "queue") {
    return data.queue.length ? `<div class="table-wrap"><table><thead><tr><th>Work</th><th>Worker</th><th>Status</th><th>Updated</th></tr></thead><tbody>${data.queue.map((item) => `<tr><td><strong>${escapeHtml(item.title)}</strong></td><td>${escapeHtml(humanStatus(item.agent))}</td><td>${badge(item.status)}</td><td>${escapeHtml(shortDate(item.updated_at))}</td></tr>`).join("")}</tbody></table></div>` : emptyState("The queue is empty", "Create internal work from the Command Center when there is a clear business purpose.", "list-checks");
  }
  if (store.systemTab === "spend") {
    const spend = data.spend;
    const accounting = spend.accounting || { currency: "AUD", cashPaidCents: 0, recurringMonthlyCents: 0, recent: [] };
    return `<div class="view-stack">
      <section>${sectionHeading("AI and tool budget", "Approval caps and measured provider usage for controlled business work.")}
        <div class="metric-grid"><div class="metric sky"><span>Monthly cap</span><strong>${money(spend.monthlyCapCents, spend.currency)}</strong><small>Pre-revenue limit</small></div><div class="metric mint"><span>Reconciled usage</span><strong>${money(spend.reconciledCents, spend.currency)}</strong><small>Confirmed provider cost</small></div><div class="metric amber"><span>Estimated usage</span><strong>${money(spend.incurredEstimateCents, spend.currency)}</strong><small>Awaiting provider reconciliation</small></div><div class="metric coral"><span>Unresolved</span><strong>${money(spend.unknownCents, spend.currency)}</strong><small>Requires provider reconciliation</small></div></div>
      </section>
      <section>${sectionHeading("Operating costs", "Actual cash records stay separate from the AI execution cap and are stored in Australian dollars.")}
        <div class="metric-grid"><div class="metric coral"><span>Cash paid this month</span><strong>${money(accounting.cashPaidCents, accounting.currency)}</strong><small>Subscriptions and prepaid services</small></div><div class="metric sky"><span>Recurring monthly overhead</span><strong>${money(accounting.recurringMonthlyCents, accounting.currency)}</strong><small>Current active commitments</small></div></div>
        ${accounting.recent?.length ? `<div class="plain-list">${accounting.recent.map((entry) => `<article class="plain-row"><div><h3>${escapeHtml(entry.description)}</h3><p>${escapeHtml(shortDate(entry.occurred_at))} | ${escapeHtml(entry.source)}</p></div><div><strong>${money(entry.amount_cents, entry.currency)}</strong>${badge(entry.entry_type === "recurring_commitment" ? "Monthly" : entry.status)}</div></article>`).join("")}</div>` : emptyState("No operating costs recorded", "Confirmed subscriptions and cash purchases will appear here in Australian dollars.", "receipt")}
      </section>
    </div>`;
  }
  if (store.systemTab === "connections") {
    return `<div class="connection-list">${data.connections.map((item) => `<article class="connection-row"><div><h3>${escapeHtml(item.name)}</h3><p>${escapeHtml(item.metadata?.use || "Runtime connection")}</p></div>${badge(item.health)}</article>`).join("")}</div>`;
  }
  if (store.systemTab === "outputs") {
    const current = data.outputs.filter((item) => item.status !== "archived");
    const archived = data.outputs.filter((item) => item.status === "archived");
    const historyControl = archived.length
      ? `<button class="secondary-button" data-action="toggle-output-history">${icon(store.showArchivedOutputs ? "eye-off" : "archive")} ${store.showArchivedOutputs ? "Hide past outputs" : `Show ${archived.length} past outputs`}</button>`
      : "";
    return `<div class="view-stack">
      <section>${sectionHeading("Current outputs", "The latest work prepared for this venture.", historyControl)}${current.length ? outputRows(current) : emptyState("No current outputs", "Operator-ready packs will appear here.", "files")}</section>
      ${store.showArchivedOutputs && archived.length ? `<section>${sectionHeading("Past outputs", "Historical proofs remain available without crowding current work.")}${outputRows(archived)}</section>` : ""}
    </div>`;
  }
  return data.activity.length ? `<div class="activity-list">${data.activity.map((item) => `<article class="activity-row"><div><h3>${escapeHtml(item.message)}</h3><p>${escapeHtml(shortDate(item.ts))} | ${escapeHtml(humanStatus(item.actor))}</p></div></article>`).join("")}</div>` : emptyState("No activity recorded", "Runtime actions will appear here in ordinary business language.", "activity");
}

function renderSystem() {
  const data = store.data.system;
  $("#view").innerHTML = `<div class="view-stack">${systemTabs()}<section><div class="system-toolbar"><button class="secondary-button" data-action="run-next">${icon("play")}Run next internal step</button><button class="secondary-button" data-action="maintenance">${icon("wrench")}Run maintenance now</button></div>${renderSystemPanel(data)}</section></div>`;
}

function renderView() {
  if (store.view === "cockpit") renderCockpit();
  else if (store.view === "decisions") renderDecisions();
  else if (store.view === "tests") renderTests();
  else if (store.view === "ai-team") renderAiTeam();
  else renderSystem();
  refreshIcons();
}

function openDrawer(title, kicker, body) {
  $("#drawer-title").textContent = title;
  $("#drawer-kicker").textContent = kicker;
  $("#drawer-body").innerHTML = body;
  $("#drawer").classList.add("open");
  $("#drawer").setAttribute("aria-hidden", "false");
  $("#drawer-backdrop").classList.add("open");
  refreshIcons();
}

function closeDrawer() {
  $("#drawer").classList.remove("open");
  $("#drawer").setAttribute("aria-hidden", "true");
  $("#drawer-backdrop").classList.remove("open");
}

function detailSection(title, content) {
  return `<section class="drawer-section"><h3>${escapeHtml(title)}</h3>${content}</section>`;
}

async function showDetail(kind, id) {
  if (kind === "agent") {
    const data = await fetchJson(`/api/agents/${encodeURIComponent(id)}`);
    const agent = data.agent;
    openDrawer(agent.name, agent.group, [
      detailSection("Current position", `<p>${escapeHtml(agent.assignment)}</p>${badge(agent.status)}`),
      detailSection("Last reviewed outcome", `<p>${escapeHtml(agent.lastOutcome)}</p>`),
      detailSection("Earned capability", `<p>${agent.autonomy.passes} of ${agent.autonomy.required} consecutive successful reviewed runs. Current level: ${escapeHtml(humanStatus(agent.autonomy.status))}.</p>`),
      detailSection("Technical detail", `<p>Model class: ${escapeHtml(agent.technical.modelClass)}<br>Runtime mode: ${escapeHtml(agent.technical.mode)}<br>Last run: ${escapeHtml(agent.technical.lastRunId || "None")}</p>`),
    ].join(""));
    return;
  }
  if (kind === "test") {
    const data = await fetchJson(`/api/tests/${encodeURIComponent(id)}`);
    const item = data.experiment;
    openDrawer(item.name, "Business test", [
      detailSection("Hypothesis", `<p>${escapeHtml(item.hypothesis || "Not yet defined")}</p>`),
      detailSection("Buyer and offer", `<p><strong>Buyer:</strong> ${escapeHtml(item.buyer || "Not selected")}<br><strong>Offer:</strong> ${escapeHtml(item.offer || "Not selected")}<br><strong>Channel:</strong> ${escapeHtml(item.channel || "Not selected")}</p>`),
      detailSection("Measurement", `<p><strong>Expected:</strong> ${escapeHtml(item.expected_metric || "Not defined")}<br><strong>Target:</strong> ${escapeHtml(item.target_value)} ${escapeHtml(item.target_unit || "")}</p>`),
      detailSection("Recorded evidence", data.evidence.length ? `<ul>${data.evidence.map((evidence) => `<li>${escapeHtml(evidence.title)}</li>`).join("")}</ul>` : "<p>No verified evidence has been attached yet.</p>"),
      detailSection("Results", data.results.length ? `<p>${data.results.length} measured result record${data.results.length === 1 ? "" : "s"}.</p>` : "<p>No real-world result has been recorded.</p>"),
    ].join(""));
    return;
  }
  if (kind === "decision") {
    const item = await fetchJson(`/api/decisions/${encodeURIComponent(id)}`);
    openDrawer(item.title, "Decision", [
      detailSection("Recommendation", `<p>${escapeHtml(item.recommendation)}</p>`),
      detailSection("Expected result", `<p>${escapeHtml(item.expectedUpside)}</p>`),
      detailSection("Boundaries", `<p>Maximum approved cost: ${money(item.maxCostCents)}.<br>Risk: ${escapeHtml(humanStatus(item.risk))}.<br>This decision applies only to the exact work shown here.</p>`),
      detailSection("Your decision", approvalButtons(item)),
    ].join(""));
    return;
  }
  const source = kind === "review" ? store.data.decisions?.reviews : store.data.cockpit?.importantWork;
  const item = source?.find((entry) => entry.id === id);
  openDrawer(item?.title || "Details", kind === "review" ? "Review" : "Important work", detailSection("Summary", `<p>${escapeHtml(item?.summary || item?.recommendation || "No additional detail is available.")}</p>`));
}

function openPdf(id, title) {
  $("#pdf-title").textContent = title || "PDF preview";
  $("#pdf-frame").src = `/api/deliverables/${encodeURIComponent(id)}/file`;
  $("#pdf-modal").classList.add("open");
  $("#pdf-modal").setAttribute("aria-hidden", "false");
}

function closePdf() {
  $("#pdf-modal").classList.remove("open");
  $("#pdf-modal").setAttribute("aria-hidden", "true");
  $("#pdf-frame").src = "about:blank";
}

async function handleAction(button) {
  const action = button.dataset.action;
  if (action === "refresh") return loadView(store.view);
  if (action === "close-drawer") return closeDrawer();
  if (action === "close-pdf") return closePdf();
  if (action === "command-mode") {
    store.commandMode = button.dataset.mode;
    return renderView();
  }
  if (action === "decision-tab") { store.decisionTab = button.dataset.tab; return renderDecisions(); }
  if (action === "test-tab") { store.testTab = button.dataset.tab; return renderTests(); }
  if (action === "system-tab") { store.systemTab = button.dataset.tab; return renderSystem(); }
  if (action === "toggle-output-history") { store.showArchivedOutputs = !store.showArchivedOutputs; return renderSystem(); }
  if (action === "open-drawer") return showDetail(button.dataset.kind, button.dataset.id);
  if (action === "open-pdf") return openPdf(button.dataset.id, button.dataset.title);
  if (action === "approval") {
    const decisionLabels = { approve: "approved", changes: "changes requested", reject: "declined" };
    await postJson(`/api/approvals/${encodeURIComponent(button.dataset.id)}/${button.dataset.decision}`, {
      scopeHash: button.dataset.scopeHash,
      note: `Dashboard decision: ${decisionLabels[button.dataset.decision]}.`,
    });
    closeDrawer();
    toast(`Decision ${decisionLabels[button.dataset.decision]}.`);
    return loadView(store.view, { silent: true });
  }
  if (action === "handoff-decision") {
    const decisionLabels = { approve: "approved", changes: "changes requested", reject: "declined" };
    await postJson(`/api/agent-handoffs/${encodeURIComponent(button.dataset.id)}/${button.dataset.decision}`, {
      note: `Dashboard decision: ${decisionLabels[button.dataset.decision]}.`,
    });
    closeDrawer();
    toast(`Next step ${decisionLabels[button.dataset.decision]}.`);
    return loadView(store.view, { silent: true });
  }
  if (action === "submit-command") {
    const text = $("#command-text")?.value.trim();
    if (!text) throw new Error("Enter a business instruction first.");
    await postJson("/api/commands", {
      text,
      venture_id: button.dataset.ventureId,
      mode: store.commandMode,
      autoRun: store.commandMode === "run_protected",
    });
    toast(store.commandMode === "run_protected" ? "Internal work prepared and started." : "Work plan prepared.");
    return loadView("cockpit", { silent: true });
  }
  if (action === "maintenance") {
    await postJson("/api/monitor/run", {});
    toast("Maintenance completed.");
    return loadView("system", { silent: true });
  }
  if (action === "run-next") {
    const result = await postJson("/api/runtime/tick", {});
    toast(result.result?.message || `Internal work: ${humanStatus(result.result?.status || "complete")}.`);
    return loadView("system", { silent: true });
  }
  if (action === "prepare-pilot") {
    await postJson(`/api/agent-pilot/fixtures/${encodeURIComponent(button.dataset.fixtureId)}/prepare`, { estimatedCostCents: 100 });
    toast("Controlled proof prepared for your approval. No model call has run.");
    return loadView("ai-team", { silent: true });
  }
  if (action === "review-pilot") {
    const usefulnessScore = Number($("#pilot-usefulness-score")?.value || 3);
    const note = $("#pilot-review-note")?.value.trim() || "";
    await postJson(`/api/agent-pilot/runs/${encodeURIComponent(button.dataset.runId)}/review`, {
      verdict: button.dataset.verdict,
      usefulnessScore,
      note,
    });
    toast(button.dataset.verdict === "useful" ? "Usefulness verdict recorded." : "Changes requested and the success streak reset.");
    return loadView("ai-team", { silent: true });
  }
  if (action === "import-gumroad") {
    const file = $("#gumroad-csv")?.files?.[0];
    if (!file) throw new Error("Choose a Gumroad sales CSV first.");
    const csvText = await file.text();
    const payload = await postJson("/api/gumroad/import", {
      ventureId: button.dataset.ventureId,
      currency: "USD",
      csvText,
    });
    toast(`${payload.result.inserted} new sale record${payload.result.inserted === 1 ? "" : "s"} imported.`);
    return loadView("tests", { silent: true });
  }
}

function connectSocket() {
  const protocol = window.location.protocol === "https:" ? "wss" : "ws";
  const socket = new WebSocket(`${protocol}://${window.location.host}`);
  socket.addEventListener("open", () => setConnection(true));
  socket.addEventListener("message", (event) => {
    const payload = JSON.parse(event.data);
    if (payload.type !== "invalidate") return;
    clearTimeout(store.reloadTimer);
    store.reloadTimer = setTimeout(() => loadView(store.view, { silent: true }).catch((error) => toast(error.message)), 120);
  });
  socket.addEventListener("close", () => {
    setConnection(false);
    setTimeout(connectSocket, 1800);
  });
}

function bindEvents() {
  document.body.addEventListener("click", async (event) => {
    const viewButton = event.target.closest("[data-view]");
    if (viewButton && !viewButton.dataset.action) {
      event.preventDefault();
      await loadView(viewButton.dataset.view).catch((error) => toast(error.message));
      return;
    }
    const actionButton = event.target.closest("[data-action]");
    if (!actionButton) return;
    event.preventDefault();
    try {
      actionButton.disabled = true;
      await handleAction(actionButton);
    } catch (error) {
      toast(error.message);
    } finally {
      if (actionButton.isConnected) actionButton.disabled = false;
    }
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") { closeDrawer(); closePdf(); }
  });
}

async function boot() {
  $("#today-label").textContent = new Intl.DateTimeFormat("en-AU", { weekday: "short", day: "numeric", month: "short" }).format(new Date());
  bindEvents();
  refreshIcons();
  try {
    const session = await fetchJson("/api/session");
    store.csrfToken = session.csrfToken;
    await loadVentures();
    await loadView("cockpit");
    connectSocket();
  } catch (error) {
    setConnection(false, "Offline");
    toast(error.message);
  }
}

boot();
