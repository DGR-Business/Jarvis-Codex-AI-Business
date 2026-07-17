const store = {
  view: "cockpit",
  data: {},
  csrfToken: null,
  commandMode: "plan_only",
  decisionTab: "approvals",
  testTab: "candidate",
  aiTeamTab: "team",
  runFilter: "all",
  systemTab: "health",
  showArchivedOutputs: false,
  reloadTimer: null,
  runPollTimer: null,
  runPollBusy: false,
  runRequestActive: false,
  drawerState: null,
  drawerReturnFocus: null,
  pdfReturnFocus: null,
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
    approval_gated: "Available with approval",
    blocked_for_approval: "Waiting for your decision",
    blocked_for_credentials: "Setup needed",
    dry_run_complete: "Internal work complete",
    ready_for_review: "Ready for review",
    needs_attention: "Needs attention",
    needs_changes: "Changes requested",
    incurred_estimate: "Estimated charge",
    unknown: "Needs reconciliation",
    planned: "Waiting",
    pilot_ready: "Ready for controlled test",
    protected: "Internal only",
    safe_internal: "Available",
    live_tested: "Tested with AI",
    queued: "Waiting to start",
    active: "Running",
    proving: "Validating",
    not_configured: "Not connected",
    completed_live: "Research complete",
    completed_live_needs_source_review: "Source review needed",
    blocked: "Needs attention",
    protected_rehearsal: "Internal rehearsal",
    model_backed: "OpenAI used",
    provider_outcome_unknown: "Outcome needs review",
    no_provider_call: "No provider charge",
    not_captured: "Not captured",
    not_reviewed: "Not reviewed",
    passed: "Passed",
    useful: "Useful",
    recording: "Recording evidence",
    incomplete: "Record incomplete",
    complete: "Evidence complete",
    review_recommended: "Review recommended",
    operating_normally: "Operating normally",
  };
  return labels[key] || key.replace(/[._-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function statusTone(value) {
  const key = String(value || "").toLowerCase();
  if (/(failed|attention|unknown|rejected|stopped|cancel)/.test(key)) return "coral";
  if (/(pending|waiting|queued|blocked|change|setup|estimate)/.test(key)) return "amber";
  if (/(working|complete|ready|approved|running|operating|promoted)/.test(key)) return "mint";
  return "sky";
}

function badge(value, tone = statusTone(value)) {
  return `<span class="badge ${tone}">${escapeHtml(humanStatus(value))}</span>`;
}

function canPreview(format, filePath = true) {
  const value = String(format || "").toLowerCase();
  return Boolean(filePath) && (value === "pdf" || value === "application/pdf" || value.startsWith("image/"));
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

function dateTime(value) {
  if (!value) return "Not captured";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
}

function durationLabel(milliseconds) {
  if (milliseconds === null || milliseconds === undefined) return "In progress";
  const seconds = Number(milliseconds) / 1000;
  return seconds < 60 ? `${seconds.toFixed(seconds < 10 ? 1 : 0)} sec` : `${Math.floor(seconds / 60)} min ${Math.round(seconds % 60)} sec`;
}

function tokenCount(value) {
  return value === null || value === undefined ? "Not captured" : Number(value).toLocaleString("en-AU");
}

function safeExternalUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return ["http:", "https:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

function compact(value, max = 180) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}

async function fetchJson(url, options = {}) {
  const method = String(options.method || "GET").toUpperCase();
  const headers = { "content-type": "application/json", ...(options.headers || {}) };
  if (!["GET", "HEAD"].includes(method) && store.csrfToken) headers["x-jarvis-csrf"] = store.csrfToken;
  const response = await fetch(url, { credentials: "same-origin", ...options, headers });
  let payload;
  try { payload = await response.json(); } catch { payload = {}; }
  if (!response.ok) {
    const error = new Error(response.status === 401
      ? "Jarvis is not signed in. Start Jarvis with its launcher, then use the dashboard window it opens."
      : payload.error || `Request failed with status ${response.status}.`);
    error.status = response.status;
    throw error;
  }
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
  const onlyWaitingToStart = items.every((item) => item.type === "queued_work");
  return `<section class="priority-panel">
    <div class="priority-header"><div><span class="eyebrow">Important work</span><h2>${items.length} item${items.length === 1 ? " needs" : "s need"} a decision, check, or start</h2></div>${onlyWaitingToStart ? badge("Work waiting", "amber") : badge("Needs attention", "coral")}</div>
    <div class="priority-list">${items.map((item) => `<article class="work-item">
      <span class="risk-bar ${escapeHtml(item.risk || "medium")}"></span>
      <div class="work-copy"><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(compact(item.recommendation, 260))}</p>${item.expectedUpside ? `<small>Why it matters: ${escapeHtml(compact(item.expectedUpside, 180))}</small>` : ""}</div>
      ${item.type === "decision"
        ? approvalButtons(item, true)
        : item.type === "queued_work"
          ? `<button class="primary-button" data-action="run-task" data-id="${escapeHtml(item.id)}">${icon("play")}Run now</button>`
          : `<button class="secondary-button" data-action="open-drawer" data-kind="work" data-id="${escapeHtml(item.id)}">${icon("arrow-right")}Review</button>`}
    </article>`).join("")}</div>
  </section>`;
}

function renderWeeklyDigest(digest) {
  if (!digest) return "";
  const metrics = digest.metrics || {};
  return `<section class="weekly-brief">
    <div><span class="eyebrow">Weekly executive brief</span><h2>${escapeHtml(digest.summary)}</h2><p>${escapeHtml(shortDate(digest.period_start))} to ${escapeHtml(shortDate(digest.period_end))}</p></div>
    <dl class="brief-facts"><div><dt>Work completed</dt><dd>${metrics.completedWork || 0}</dd></div><div><dt>Buyer proof</dt><dd>${metrics.independentBuyers || 0}/3</dd></div><div><dt>Needs attention</dt><dd>${metrics.liveImportantItems ?? (Number(metrics.openDecisions || 0) + Number(metrics.unknownOutcomes || 0))}</dd></div></dl>
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
    ${data.activeRuns?.length ? `<section class="active-run-strip">${sectionHeading("AI working now", "A genuine worker is running. Open the record to follow its plain-language progress.")}${data.activeRuns.map(renderAgentRunRow).join("")}</section>` : ""}
    <section>
      ${sectionHeading("Business position", "One venture, one active commercial path, measured by real buyer results.")}
      <div class="metric-grid">
        <div class="metric mint"><span>Active venture</span><strong>${escapeHtml(data.activeVenture.name)}</strong><small>${escapeHtml(humanStatus(data.activeVenture.lifecycle_stage))}</small></div>
        <div class="metric sky"><span>Current test</span><strong>${test ? escapeHtml(test.name) : "Not started"}</strong><small>${test ? escapeHtml(humanStatus(test.status)) : "Evidence selection comes first"}</small></div>
        <div class="metric ${economics.cashContributionCents >= 0 ? "mint" : "coral"}"><span>Cash contribution</span><strong>${money(economics.cashContributionCents)}</strong><small>${economics.independentBuyers} independent buyer${economics.independentBuyers === 1 ? "" : "s"}</small></div>
        <div class="metric amber"><span>Monthly AI and tool cap</span><strong>${money(spend.monthlyCapCents, spend.currency)}</strong><small>${money(spend.exposureCents, spend.currency)} used or committed; ${money(spend.availableCents, spend.currency)} available</small></div>
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
        ${sectionHeading("Team pulse", `${data.teamPulse.working} working, ${data.teamPulse.waiting || 0} waiting to start, ${data.teamPulse.needsAttention} need attention.`)}
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
    body = data.reviews.length ? `<div class="plain-list">${data.reviews.map((item) => `<article class="plain-row"><div><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.summary)}</p></div><div class="work-actions">${canPreview(item.format, item.filePath) ? `<button class="secondary-button" data-action="open-pdf" data-id="${escapeHtml(item.id)}" data-title="${escapeHtml(item.title)}">${icon("file-search")}Preview</button>` : ""}<button class="text-button" data-action="open-drawer" data-kind="review" data-id="${escapeHtml(item.id)}">Details ${icon("arrow-right")}</button></div></article>`).join("")}</div>` : emptyState("No outputs need review", "Completed decision briefs and supporting outputs will appear here without competing with consequential choices.", "files");
  } else if (store.decisionTab === "suggestions") {
    body = data.suggestions.length ? `<div class="plain-list">${data.suggestions.map((item) => `<article class="plain-row"><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.summary)}</p></article>`).join("")}</div>` : emptyState("No suggestions at the moment", "The team will surface non-urgent improvements here.", "lightbulb");
  } else {
    body = data.history.length ? `<div class="table-wrap"><table><thead><tr><th>Decision</th><th>Outcome</th><th>Note</th><th>Date</th></tr></thead><tbody>${data.history.map((item) => `<tr><td data-label="Decision"><strong>${escapeHtml(item.title)}</strong></td><td data-label="Outcome">${badge(item.decision)}</td><td data-label="Note">${escapeHtml(item.note || "No note")}</td><td data-label="Date">${escapeHtml(shortDate(item.decidedAt))}</td></tr>`).join("")}</tbody></table></div>` : emptyState("No decision history yet", "Decisions will become the durable record of how the business was steered.", "history");
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

function aiTeamTabs() {
  return `<div class="view-tabs ai-team-tabs" role="tablist" aria-label="AI Team views">
    <button role="tab" aria-selected="${store.aiTeamTab === "team"}" class="${store.aiTeamTab === "team" ? "active" : ""}" data-action="ai-team-tab" data-tab="team">Team</button>
    <button role="tab" aria-selected="${store.aiTeamTab === "runs"}" class="${store.aiTeamTab === "runs" ? "active" : ""}" data-action="ai-team-tab" data-tab="runs">Live Runs</button>
  </div>`;
}

function filteredAgentRuns(state) {
  const runs = state?.runs || [];
  if (store.runFilter === "all") return runs;
  if (store.runFilter === "running") return runs.filter((run) => run.active);
  if (store.runFilter === "review") return runs.filter((run) => run.attentionRequired);
  if (store.runFilter === "completed") {
    return runs.filter((run) => !run.active && !run.attentionRequired && run.executionKind !== "protected_rehearsal");
  }
  return runs.filter((run) => run.executionKind === store.runFilter);
}

function renderAgentRunRow(run) {
  const protectedRun = run.executionKind === "protected_rehearsal";
  const actualTokens = run.actualTokens?.total === null || run.actualTokens?.total === undefined
    ? "Not captured"
    : `${tokenCount(run.actualTokens.total)} tokens`;
  const cost = protectedRun
    ? "No provider charge"
    : run.cost?.actualCents === null || run.cost?.actualCents === undefined
      ? "Cost not captured"
      : `${money(run.cost.actualCents, run.cost.currency)} ${humanStatus(run.cost.status)}`;
  const selected = store.drawerState?.kind === "agent-run" && store.drawerState.id === run.id;
  return `<button class="run-row${selected ? " selected" : ""}" data-action="open-drawer" data-kind="agent-run" data-id="${escapeHtml(run.id)}" aria-current="${selected ? "true" : "false"}">
    <span class="run-kind-icon ${escapeHtml(run.executionKind)}">${icon(protectedRun ? "shield-check" : run.executionKind === "provider_outcome_unknown" ? "triangle-alert" : run.active ? "loader-circle" : "sparkles")}</span>
    <span class="run-main"><span class="run-title-line"><strong>${escapeHtml(run.taskTitle)}</strong>${badge(run.executionKind)}</span><small>${escapeHtml(run.workerName)} · ${escapeHtml(dateTime(run.startedAt))}</small>${run.currentStage && run.active ? `<em>${escapeHtml(run.currentStage.title)}</em>` : ""}</span>
    <span class="run-facts"><span>${badge(run.status)} ${badge(
      run.receipt?.status === "complete"
        ? "Evidence complete"
        : run.receipt?.status === "recording"
          ? "Recording evidence"
          : "Review record",
      run.receipt?.status === "complete" ? "mint" : run.receipt?.status === "recording" ? "sky" : "amber",
    )}</span><small>${escapeHtml(actualTokens)}</small><small>${escapeHtml(cost)}</small></span>
    ${icon("chevron-right")}
  </button>`;
}

function renderLiveRuns(data) {
  const state = data.liveRuns || { counts: {}, runs: [] };
  const counts = state.counts || {};
  const runs = filteredAgentRuns(state);
  const activeRuns = (state.runs || []).filter((run) => run.active && run.executionKind !== "protected_rehearsal");
  const filters = [
    ["running", "Running"],
    ["review", "Needs your review"],
    ["completed", "Completed"],
    ["protected_rehearsal", "Internal rehearsals"],
    ["all", "All records"],
  ];
  return `<div class="view-stack live-runs-view">
    <section class="run-metrics" aria-label="AI run summary">
      <div><span>Running now</span><strong>${activeRuns.length}</strong></div>
      <div><span>OpenAI runs</span><strong>${Number(counts.modelBacked || 0)}</strong></div>
      <div><span>Need review</span><strong>${Number(counts.needsReview || 0)}</strong></div>
      <div><span>Confirmed AI cost</span><strong>${money(counts.reconciledCostCents || 0)}</strong></div>
    </section>
    ${activeRuns.length ? `<section class="active-run-strip">${sectionHeading("Working now", "These are genuine AI executions currently in progress.")}${activeRuns.map(renderAgentRunRow).join("")}</section>` : ""}
    <section>
      ${sectionHeading("Run history", "See what genuinely used OpenAI, what stayed internal, and what requires reconciliation.")}
      <div class="run-filters" role="group" aria-label="Filter AI runs">${filters.map(([id, label]) => `<button class="${store.runFilter === id ? "active" : ""}" data-action="run-filter" data-filter="${id}">${escapeHtml(label)}</button>`).join("")}</div>
      <div class="run-list">${runs.length ? runs.map(renderAgentRunRow).join("") : emptyState(
        store.runFilter === "running" ? "No AI work is running" : "No runs match this view",
        store.runFilter === "running" ? "Genuine AI work will appear here while it is in progress." : "Choose another run view to inspect the available records.",
        "activity",
      )}</div>
    </section>
  </div>`;
}

function renderAiTeam() {
  const data = store.data["ai-team"] || { agents: [], liveRuns: { counts: {}, runs: [] } };
  const groups = Object.keys(agentGroupLabels);
  const body = store.aiTeamTab === "runs" ? renderLiveRuns(data) : `<section>${sectionHeading("The working team", "Every worker is visible. Each capability remains supervised until its exact skill is proven.")}
    <div class="agent-groups">${groups.map((group) => {
      const agents = data.agents.filter((agent) => agent.group === group);
      return `<section class="agent-group"><span class="section-label">${escapeHtml(agentGroupLabels[group])}</span><div class="agent-grid">${agents.map((agent) => `<button class="agent-card" data-action="open-drawer" data-kind="agent" data-id="${escapeHtml(agent.id)}">
        <span class="agent-initial">${escapeHtml(initials(agent.name))}</span><div><h3>${escapeHtml(agent.name)}</h3><p>${escapeHtml(agent.assignment)}</p></div><span class="agent-meta">${badge(agent.status)}<small>${agent.autonomy.passes}/${agent.autonomy.required} for best proven skill</small></span>
      </button>`).join("")}</div></section>`;
    }).join("")}</div>
  </section>`;
  $("#view").innerHTML = `<div class="view-stack">${aiTeamTabs()}${body}</div>`;
}

function systemTabs() {
  const tabs = [["health", "Health"], ["checks", "Checks"], ["queue", "Queue"], ["spend", "Spend"], ["connections", "Connections"], ["outputs", "Outputs"], ["activity", "Activity"]];
  return `<div class="view-tabs">${tabs.map(([id, label]) => `<button class="${store.systemTab === id ? "active" : ""}" data-action="system-tab" data-tab="${id}">${label}</button>`).join("")}</div>`;
}

function outputRows(items) {
  return `<div class="plain-list">${items.map((item) => `<article class="plain-row"><div><h3>${escapeHtml(item.human_name)}</h3><p>${escapeHtml(item.summary)}</p></div><div class="work-actions">${canPreview(item.format, item.file_path) ? `<button class="secondary-button" data-action="open-pdf" data-id="${escapeHtml(item.id)}" data-title="${escapeHtml(item.human_name)}">${icon("file-search")}Preview</button>` : ""}${badge(item.status)}</div></article>`).join("")}</div>`;
}

function renderSystemPanel(data) {
  if (store.systemTab === "health") {
    const ai = data.health.liveAi;
    const research = data.health.liveResearch;
    return `<div class="card-grid">
      <article class="item-card"><header><h3>Runtime database</h3>${badge(data.health.database === "ok" ? "Operating normally" : "Needs attention")}</header><p>The durable operating state passed its latest integrity check.</p></article>
      <article class="item-card"><header><h3>AI worker connection</h3>${badge(ai.ready ? "Connected" : "Setup needed")}</header><p>${escapeHtml(ai.ready ? "OpenAI workers can run from this dashboard when their exact capped task is approved." : compact(ai.blockers?.join(" ") || "Credentials and live permission are not configured."))}</p></article>
      <article class="item-card"><header><h3>Live research</h3>${badge(research.ready ? "Connected" : "Setup needed")}</header><p>${escapeHtml(research.ready ? "Read-only sourced research can run from this dashboard after its exact cost approval." : compact(research.blockers?.join(" ") || "The research connection is not configured."))}</p></article>
      <article class="item-card"><header><h3>Product visuals</h3>${badge(ai.imageGeneration?.ready ? "Connected" : "Setup needed")}</header><p>${escapeHtml(ai.imageGeneration?.ready ? "Product Builder can prepare one reviewed local visual after an exact cost approval. Publishing remains blocked." : compact(ai.imageGeneration?.blockers?.join(" ") || "The reviewed product-visual capability is not connected."))}</p></article>
      <article class="item-card"><header><h3>External actions</h3>${badge("Your approval required", "mint")}</header><p>Publishing, customer contact, account changes and spend still require your explicit decision.</p></article>
    </div>`;
  }
  if (store.systemTab === "checks") {
    const checks = data.checks || { status: "operating_normally", openCount: 0, items: [] };
    return `<div class="view-stack">
      <section>${sectionHeading("System checks", "Jarvis verifies that genuine AI work left a complete local record and did not hide an uncertain outcome.")}
        <div class="metric-grid"><div class="metric ${checks.openCount ? "amber" : "mint"}"><span>Current status</span><strong>${escapeHtml(humanStatus(checks.status))}</strong><small>${checks.openCount ? `${checks.openCount} item${checks.openCount === 1 ? "" : "s"} to review` : "No unresolved execution-record issues"}</small></div><div class="metric sky"><span>Receipts verified</span><strong>${Number(checks.verifiedReceiptCount || 0)}</strong><small>${checks.receiptChainVerified ? "Integrity checks passed" : "Integrity review required"}</small></div></div>
      </section>
      <section>${checks.items?.length ? `<div class="plain-list">${checks.items.map((item) => `<article class="plain-row"><div><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.detail)}</p>${item.workerName ? `<small>${escapeHtml(item.workerName)}</small>` : ""}</div>${item.runId ? `<button class="secondary-button" data-action="open-drawer" data-kind="agent-run" data-id="${escapeHtml(item.runId)}">${icon("file-search")}Review</button>` : badge(item.status)}</article>`).join("")}</div>` : emptyState("All execution records are complete", "Jarvis found no missing receipts, uncertain provider outcomes or broken evidence links.", "shield-check")}</section>
    </div>`;
  }
  if (store.systemTab === "queue") {
    return data.queue.length ? `<div class="table-wrap"><table><thead><tr><th>Work</th><th>Worker</th><th>Status</th><th>Updated</th><th>Action</th></tr></thead><tbody>${data.queue.map((item) => `<tr><td data-label="Work"><strong>${escapeHtml(item.title)}</strong></td><td data-label="Worker">${escapeHtml(humanStatus(item.agent))}</td><td data-label="Status">${badge(item.approval_id && ["blocked", "waiting_approval"].includes(item.status) ? "Waiting for decision" : item.status)}</td><td data-label="Updated">${escapeHtml(shortDate(item.updated_at))}</td><td data-label="Action">${item.can_run ? `<button class="secondary-button" data-action="run-task" data-id="${escapeHtml(item.id)}">${icon("play")}Run now</button>` : ["blocked", "waiting_approval", "needs_attention"].includes(item.status) ? `<button class="text-button" data-view="decisions">Review</button>` : `<span class="muted-text">After earlier work</span>`}</td></tr>`).join("")}</tbody></table></div>` : emptyState("The queue is empty", "Create internal work from the Command Center when there is a clear business purpose.", "list-checks");
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
  const runnableWork = data.queue.some((item) => item.can_run);
  $("#view").innerHTML = `<div class="view-stack">${systemTabs()}<section><div class="system-toolbar"><button class="secondary-button" data-action="run-next"${runnableWork ? "" : " disabled"}>${icon("play")}${runnableWork ? "Run next internal step" : "No internal step ready"}</button><button class="secondary-button" data-action="maintenance">${icon("wrench")}Run maintenance now</button></div>${renderSystemPanel(data)}</section></div>`;
}

function renderView() {
  if (store.view === "cockpit") renderCockpit();
  else if (store.view === "decisions") renderDecisions();
  else if (store.view === "tests") renderTests();
  else if (store.view === "ai-team") renderAiTeam();
  else renderSystem();
  refreshIcons();
  syncLiveRunPolling();
}

async function refreshLiveRuns() {
  if (store.runPollBusy) return;
  store.runPollBusy = true;
  try {
    if (store.view === "cockpit") {
      store.data.cockpit = await fetchJson("/api/cockpit");
      if (store.view === "cockpit") {
        renderCockpit();
        refreshIcons();
      }
      return;
    }
    if (store.view !== "ai-team" || store.aiTeamTab !== "runs") return;
    const liveRuns = await fetchJson("/api/agent-runs?limit=100");
    store.data["ai-team"] = { ...(store.data["ai-team"] || {}), liveRuns };
    if (store.view !== "ai-team" || store.aiTeamTab !== "runs") return;
    renderAiTeam();
    refreshIcons();
    if (store.drawerState?.kind === "agent-run") {
      const selected = store.data["ai-team"]?.liveRuns?.runs?.find((run) => run.id === store.drawerState.id);
      if (selected?.active) await showDetail("agent-run", store.drawerState.id, { preserveFocus: true });
    }
  } finally {
    store.runPollBusy = false;
  }
}

function syncLiveRunPolling() {
  const cockpitHasActiveRun = store.view === "cockpit" && Boolean(store.data.cockpit?.activeRuns?.length);
  const shouldPoll = store.runRequestActive
    || cockpitHasActiveRun
    || (store.view === "ai-team" && store.aiTeamTab === "runs");
  if (!shouldPoll && store.runPollTimer) {
    clearInterval(store.runPollTimer);
    store.runPollTimer = null;
  }
  if (shouldPoll && !store.runPollTimer) {
    store.runPollTimer = setInterval(() => refreshLiveRuns().catch((error) => {
      if (error.status !== 401) setConnection(false, "Reconnecting");
    }), 2500);
  }
}

async function withRunPolling(operation) {
  store.runRequestActive = true;
  syncLiveRunPolling();
  try {
    return await operation();
  } finally {
    store.runRequestActive = false;
    syncLiveRunPolling();
  }
}

function updateBackgroundInert() {
  const drawerOpen = $("#drawer").classList.contains("open");
  const pdfOpen = $("#pdf-modal").classList.contains("open");
  $("#app-shell").inert = drawerOpen || pdfOpen;
  $("#drawer").inert = !drawerOpen || pdfOpen;
  $("#pdf-modal").inert = !pdfOpen;
}

function trapDialogFocus(event, root) {
  const items = Array.from(root.querySelectorAll(
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), iframe, [tabindex]:not([tabindex="-1"])',
  )).filter((element) => element.getClientRects().length > 0);
  if (!items.length) {
    event.preventDefault();
    root.focus();
    return;
  }
  const first = items[0];
  const last = items[items.length - 1];
  if (!root.contains(document.activeElement)) {
    event.preventDefault();
    (event.shiftKey ? last : first).focus();
  } else if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function openDrawer(title, kicker, body, options = {}) {
  const drawer = $("#drawer");
  const wasOpen = drawer.classList.contains("open");
  if (!wasOpen && !options.preserveFocus) store.drawerReturnFocus = document.activeElement;
  if (options.state) store.drawerState = options.state;
  $("#drawer-title").textContent = title;
  $("#drawer-kicker").textContent = kicker;
  $("#drawer-body").innerHTML = body;
  drawer.classList.add("open");
  drawer.classList.toggle("wide", options.wide === true);
  drawer.setAttribute("aria-hidden", "false");
  $("#drawer-backdrop").classList.add("open");
  updateBackgroundInert();
  if (!wasOpen || !options.preserveFocus) {
    $("#drawer-body").scrollTop = 0;
    requestAnimationFrame(() => drawer.querySelector("[data-action='close-drawer']")?.focus());
  }
  refreshIcons();
}

function closeDrawer() {
  const drawer = $("#drawer");
  if (!drawer.classList.contains("open")) return;
  drawer.classList.remove("open");
  drawer.classList.remove("wide");
  drawer.setAttribute("aria-hidden", "true");
  $("#drawer-backdrop").classList.remove("open");
  store.drawerState = null;
  updateBackgroundInert();
  const returnFocus = store.drawerReturnFocus;
  store.drawerReturnFocus = null;
  if (returnFocus?.isConnected) requestAnimationFrame(() => returnFocus.focus());
}

function detailSection(title, content) {
  return `<section class="drawer-section"><h3>${escapeHtml(title)}</h3>${content}</section>`;
}

function detailList(items, emptyMessage = "None recorded.") {
  return items?.length
    ? `<ul>${items.map((item) => `<li>${escapeHtml(typeof item === "string" ? item : item.summary || item.title || String(item))}</li>`).join("")}</ul>`
    : `<p>${escapeHtml(emptyMessage)}</p>`;
}

function reviewCriteria(criteria = {}) {
  const labels = {
    sourceValidity: "Evidence was identifiable",
    unsupportedClaims: "No unsupported demand claim",
    reasoningStructure: "Required judgement fields were present",
    commercialUsefulness: "Commercial usefulness",
    scopeCompliance: "Approved scope was respected",
    costCompliance: "Cost stayed inside the cap",
    baselineExcludedFromWorker: "Protected answer was hidden",
  };
  return `<div class="review-check-list">${Object.entries(criteria).map(([key, value]) => {
    const waiting = typeof value === "string";
    const tone = value === true ? "mint" : value === false ? "coral" : "amber";
    const status = value === true ? "Passed" : value === false ? "Failed" : waiting ? "Waiting for your review" : humanStatus(value);
    return `<div class="review-check"><span>${escapeHtml(labels[key] || humanStatus(key))}</span>${badge(status, tone)}</div>`;
  }).join("")}</div>`;
}

function runReviewBody(data) {
  const process = data.process;
  const execution = data.execution;
  const receipt = data.receipt;
  const protectedRun = execution.kind === "protected_rehearsal";
  const unknownOutcome = execution.kind === "provider_outcome_unknown";
  const visibility = execution.tracePolicy || {};
  const duration = durationLabel(data.run.durationMs);
  const suppliedEvidence = process.suppliedEvidence?.length
    ? `<div class="evidence-list">${process.suppliedEvidence.map((item) => {
        const url = safeExternalUrl(item.url);
        return `<article><strong>${escapeHtml(item.title)}</strong><p>${escapeHtml(item.summary)}</p><small>${escapeHtml(humanStatus(item.sourceType))}${url ? ` · <a href="${escapeHtml(url)}" target="_blank" rel="noreferrer">Open source</a>` : ""}</small></article>`;
      }).join("")}</div>`
    : "<p>No supplied evidence was recorded.</p>";
  const businessContext = process.businessContext;
  const businessContextSection = businessContext
    ? detailSection("Business records supplied", `<p>${escapeHtml(businessContext.purpose)}</p><div class="evidence-list">${businessContext.sections.map((section) => `<article><strong>${escapeHtml(humanStatus(section.name))}</strong><p>${section.recordCount ? escapeHtml(section.records.map((item) => item.title).join(", ")) : "No current records in this category."}</p><small>${section.recordCount} record${section.recordCount === 1 ? "" : "s"} supplied${section.withheldLocalOnly ? ` · ${section.withheldLocalOnly} local-only record${section.withheldLocalOnly === 1 ? "" : "s"} withheld` : ""}${section.truncated ? " · limited to the latest relevant records" : ""}</small></article>`).join("")}</div><p class="muted-text">Only this venture and these record categories were available to the worker. Credentials and direct customer identifiers were excluded by default.</p>`)
    : "";
  const traceEvents = data.developer.traceEvents?.length
    ? `<ol class="trace-list">${data.developer.traceEvents.map((event) => `<li><strong>${escapeHtml(event.title)}</strong><span>${escapeHtml(event.detail || humanStatus(event.type))}</span><small>${escapeHtml(dateTime(event.ts))}</small></li>`).join("")}</ol>`
    : "<p>No local trace events were recorded.</p>";
  const handoffs = execution.runtimeHandoffs?.length
    ? execution.runtimeHandoffs.map((handoff) => `${humanStatus(handoff.from)} to ${humanStatus(handoff.to)}: ${handoff.summary || handoff.status}`)
    : [];
  const providerVisibility = protectedRun
    ? "No provider call was made. This record covers an internal rehearsal only."
    : visibility.providerResponseStored && visibility.providerTraceContent
      ? "Provider trace content was enabled for this approved non-personal run."
      : "The provider trace policy did not make full input and output content available here. Jarvis retained the local structured output and execution events shown in this record.";
  const verdictControls = data.review?.operatorVerdict === "pending" ? `<div class="run-review-form compact-form">
      <select id="drawer-run-usefulness-score" aria-label="Commercial usefulness score"><option value="5">5 - Excellent</option><option value="4">4 - Useful</option><option value="3" selected>3 - Adequate</option><option value="2">2 - Weak</option><option value="1">1 - Not useful</option></select>
      <input id="drawer-run-review-note" type="text" placeholder="Short review note" aria-label="Run review note">
      <div class="work-actions"><button class="primary-button" data-action="review-agent-run" data-run-id="${escapeHtml(data.run.id)}" data-verdict="useful">${icon("check")}Useful</button><button class="secondary-button" data-action="review-agent-run" data-run-id="${escapeHtml(data.run.id)}" data-verdict="changes_required">${icon("pencil-line")}Needs changes</button></div>
    </div>` : `<p>${escapeHtml(data.review?.note || `Verdict: ${humanStatus(data.review?.operatorVerdict || "not recorded")}.`)}</p>`;
  const actualTokens = execution.actualTokens?.total === null || execution.actualTokens?.total === undefined
    ? "Not captured"
    : `${tokenCount(execution.actualTokens.input)} in / ${tokenCount(execution.actualTokens.output)} out`;
  const plannedTokens = execution.plannedTokens?.input === null && execution.plannedTokens?.output === null
    ? "Not set"
    : `${execution.plannedTokens?.input === null ? "No input cap" : `${tokenCount(execution.plannedTokens.input)} input`} / ${execution.plannedTokens?.output === null ? "No output cap" : `${tokenCount(execution.plannedTokens.output)} output`}`;
  const providerCost = protectedRun
    ? "No provider charge"
    : execution.cost.actualCents === null || execution.cost.actualCents === undefined
      ? "Not captured"
      : `${money(execution.cost.actualCents, execution.cost.currency)} · ${humanStatus(execution.cost.status)}`;
  const requestedTools = execution.requestedTools?.length
    ? detailList(execution.requestedTools)
    : "<p>No provider tools were requested.</p>";
  const observedTools = execution.observedTools?.length
    ? `<div class="evidence-list">${execution.observedTools.map((tool) => `<article><strong>${escapeHtml(tool.name)}</strong><p>${escapeHtml(tool.outputSummary || tool.inputSummary || "Tool activity was recorded.")}</p><small>${escapeHtml(humanStatus(tool.status))} · ${escapeHtml(humanStatus(tool.requestedMode))}</small></article>`).join("")}</div>`
    : "<p>No tool invocation was observed.</p>";
  const sources = execution.sources?.length
    ? `<div class="evidence-list">${execution.sources.map((source) => {
        const url = safeExternalUrl(source.url);
        return `<article><strong>${escapeHtml(source.title)}</strong><p>${escapeHtml(source.relevance || source.publisher || "Source recorded by the research runtime.")}</p><small>${source.grounded ? "Grounded source" : "Not verified as grounded"}${url ? ` · <a href="${escapeHtml(url)}" target="_blank" rel="noreferrer">Open source</a>` : ""}</small></article>`;
      }).join("")}</div>`
    : "<p>No research sources were observed for this run.</p>";
  const providerIds = protectedRun ? "" : detailSection("Provider record", `<p>${escapeHtml(providerVisibility)}</p><div class="technical-ids"><span>Trace ID</span><code>${escapeHtml(execution.traceId || "Not captured")}</code><span>Response ID</span><code>${escapeHtml(execution.responseId || "Not captured")}</code></div>`);
  const errorSection = data.run.error || execution.error
    ? detailSection("What went wrong", `<div class="error-callout"><strong>${unknownOutcome ? "Provider outcome needs review" : "Run failed"}</strong><p>${escapeHtml(data.run.error || execution.error)}</p></div>`)
    : "";
  const receiptSection = receipt
    ? detailSection("Local execution record", `<div class="review-check"><span>${receipt.status === "complete" ? "Inputs, result, provider evidence, cost state and quality check were captured." : "Jarvis found an issue in the stored execution evidence."}</span>${badge(
      receipt.status === "complete" ? "Evidence complete" : receipt.status === "paused" ? "Paused safely" : "Review needed",
      receipt.status === "complete" ? "mint" : receipt.status === "paused" ? "sky" : "amber",
    )}</div>${receipt.missingFields?.length ? `<h4>Missing record details</h4>${detailList(receipt.missingFields)}` : ""}${receipt.warnings?.length ? `<h4>Review notes</h4>${detailList(receipt.warnings)}` : ""}`)
    : detailSection("Local execution record", `<div class="error-callout"><strong>${data.run.status === "running" ? "Evidence is being recorded" : "Execution record not finalized"}</strong><p>${data.run.status === "running" ? "Jarvis will seal the local receipt when this run finishes." : "The system monitor will keep this visible until the record is complete."}</p></div>`);

  return [
    `<div class="process-note"><strong>Readable process record</strong><p>${escapeHtml(process.explanation)}</p></div>`,
    errorSection,
    receiptSection,
    detailSection("Assignment", `<div class="detail-grid"><div><span>Question</span><strong>${escapeHtml(process.question)}</strong></div><div><span>Buyer</span><strong>${escapeHtml(process.buyer)}</strong></div></div><p><strong>Hypothesis:</strong> ${escapeHtml(process.hypothesis)}</p>`),
    businessContextSection,
    detailSection("Evidence reviewed", suppliedEvidence),
    detailSection("How the judgement was formed", `<h4>Evidence supporting action</h4>${detailList(process.supportingEvidence)}<h4>Evidence against or still missing</h4>${detailList(process.counterevidence)}<h4>Assumptions</h4>${detailList(process.assumptions)}`),
    detailSection("Recommendation", `<p>${escapeHtml(process.conclusion)}</p><div class="review-facts"><div><span>Price and channel hypothesis</span><strong>${escapeHtml(process.priceChannelHypothesis)}</strong></div><div><span>Smallest proposed test</span><strong>${escapeHtml(process.smallestTest)}</strong></div><div><span>Success measure</span><strong>${escapeHtml(process.metric)}</strong></div><div><span>Stop rule</span><strong>${escapeHtml(process.stopRule)}</strong></div></div><p><strong>Confidence:</strong> ${escapeHtml(humanStatus(process.confidence))}<br><strong>Next action:</strong> ${escapeHtml(process.nextAction)}</p><h4>Risks</h4>${detailList(process.risks)}`),
    detailSection("Quality checks", `${reviewCriteria(data.review?.criteria || {})}<p>Runtime evaluation: ${escapeHtml(String(data.quality?.score ?? "Not scored"))}${data.quality?.score !== undefined ? "/100" : ""}.</p>`),
    detailSection("Execution facts", `<div class="review-facts"><div><span>Execution</span><strong>${escapeHtml(execution.label)}</strong></div><div><span>Status</span><strong>${escapeHtml(humanStatus(data.run.status))}</strong></div><div><span>Provider</span><strong>${escapeHtml(execution.provider || (protectedRun ? "No provider used" : execution.requestedProvider || "Not captured"))}</strong></div><div><span>Model</span><strong>${escapeHtml(execution.modelRoute?.label || execution.model || (protectedRun ? "No model called" : execution.requestedModel || "Not captured"))}</strong></div><div><span>Why this model</span><strong>${escapeHtml(execution.modelRoute?.reason || (protectedRun ? "Internal rehearsal" : "Not captured"))}</strong></div><div><span>Duration</span><strong>${escapeHtml(duration)}</strong></div><div><span>Actual tokens</span><strong>${escapeHtml(actualTokens)}</strong></div><div><span>Planned limits</span><strong>${escapeHtml(plannedTokens)}</strong></div><div><span>Provider cost</span><strong>${escapeHtml(providerCost)}</strong></div><div><span>External effects</span><strong>${execution.externalEffects.length ? escapeHtml(execution.externalEffects.join(", ")) : "None"}</strong></div></div><p>${escapeHtml(providerVisibility)}</p>${handoffs.length ? `<h4>Runtime handoff after completion</h4>${detailList(handoffs)}` : ""}`),
    detailSection("Tools and sources", `<h4>Tools approved for the run</h4>${requestedTools}<h4>Tool activity Jarvis observed</h4>${observedTools}<h4>Research sources</h4>${sources}`),
    providerIds,
    detailSection("Local runtime timeline", `${traceEvents}<div class="technical-ids"><span>Run ID</span><code>${escapeHtml(data.run.id)}</code><span>Local model record</span><code>${escapeHtml(data.developer.modelCallId || "Not captured")}</code><span>Input fingerprint</span><code>${escapeHtml(data.developer.fixtureHash || data.developer.contextSnapshotHash || "Not captured")}</code><span>Receipt fingerprint</span><code>${escapeHtml(receipt?.hash || (data.run.status === "running" ? "Recording" : "Not captured"))}</code></div>`),
    detailSection("Your verdict", verdictControls),
  ].join("");
}

async function showDetail(kind, id, options = {}) {
  if (kind === "agent") {
    const data = await fetchJson(`/api/agents/${encodeURIComponent(id)}`);
    const agent = data.agent;
    openDrawer(agent.name, agent.group, [
      detailSection("Current position", `<p>${escapeHtml(agent.assignment)}</p>${badge(agent.status)}`),
      detailSection("Last reviewed outcome", `<p>${escapeHtml(agent.lastOutcome)}</p>`),
      detailSection("Earned capability", `<p>Best proven skill: ${agent.autonomy.passes} of ${agent.autonomy.required} consecutive successful reviewed runs. Current level: ${escapeHtml(humanStatus(agent.autonomy.status))}.</p>`),
      detailSection("Technical detail", `<p>Model class: ${escapeHtml(agent.technical.modelClass)}<br>Runtime mode: ${escapeHtml(agent.technical.mode)}<br>Last run: ${escapeHtml(agent.technical.lastRunId || "None")}</p>${agent.technical.lastRunId ? `<button class="secondary-button" data-action="open-drawer" data-kind="agent-run" data-id="${escapeHtml(agent.technical.lastRunId)}">${icon("scan-search")}Review latest run</button>` : ""}`),
    ].join(""), { state: { kind, id }, preserveFocus: options.preserveFocus });
    return;
  }
  if (kind === "agent-run") {
    const data = await fetchJson(`/api/agent-runs/${encodeURIComponent(id)}`);
    if (options.preserveFocus && (store.drawerState?.kind !== kind || store.drawerState?.id !== id)) return;
    openDrawer(data.run.taskTitle, `${data.run.workerName} · ${data.run.executionLabel}`, runReviewBody(data), {
      wide: true,
      state: { kind, id },
      preserveFocus: options.preserveFocus,
    });
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
    ].join(""), { state: { kind, id }, preserveFocus: options.preserveFocus });
    return;
  }
  if (kind === "decision") {
    const item = await fetchJson(`/api/decisions/${encodeURIComponent(id)}`);
    const assignment = item.assignment
      ? detailSection("Assignment", `<p><strong>Question:</strong> ${escapeHtml(item.assignment.question || "Not stated")}<br><strong>Buyer:</strong> ${escapeHtml(item.assignment.buyer || "Not stated")}<br><strong>Hypothesis:</strong> ${escapeHtml(item.assignment.hypothesis || "Not stated")}<br><strong>Supplied evidence:</strong> ${escapeHtml(String(item.assignment.evidenceCount || 0))} item${Number(item.assignment.evidenceCount || 0) === 1 ? "" : "s"}</p>`)
      : "";
    const route = item.modelRoute;
    const execution = item.model || item.tools?.length || item.maxTurns
      ? detailSection("Execution", `<div class="review-facts"><div><span>Worker</span><strong>${escapeHtml(item.worker || "Not stated")}</strong></div><div><span>Model</span><strong>${escapeHtml(route?.label || item.model || "Not stated")}</strong></div><div><span>Why this model</span><strong>${escapeHtml(route?.reason || "Selected before approval for this exact task.")}</strong></div><div><span>Provider tools</span><strong>${item.tools?.length ? escapeHtml(item.tools.join(", ")) : "None"}</strong></div><div><span>Turns</span><strong>${escapeHtml(String(item.maxTurns || "Not stated"))}</strong></div><div><span>Output limit</span><strong>${item.maxOutputTokens ? `${escapeHtml(String(item.maxOutputTokens))} tokens` : "Not stated"}</strong></div></div>`)
      : "";
    const businessContext = item.businessContext
      ? detailSection("Business records", `<p>${escapeHtml(item.businessContext.purpose)}</p><div class="review-facts"><div><span>Records supplied</span><strong>${escapeHtml(String(item.businessContext.recordCount))}</strong></div><div><span>Categories</span><strong>${escapeHtml(item.businessContext.recordClasses.map(humanStatus).join(", "))}</strong></div></div><p class="muted-text">This approval is bound to one frozen record snapshot. Credentials, unrelated ventures, local-only records, and direct customer identifiers are excluded by default.</p>`)
      : "";
    const pricedBound = item.pricedWorstCaseCostCents
      ? `<br>Current priced upper-bound estimate: ${money(item.pricedWorstCaseCostCents)}. Actual provider usage is reconciled after the run.`
      : "";
    openDrawer(item.title, "Decision", [
      detailSection("Recommendation", `<p>${escapeHtml(item.recommendation)}</p>`),
      detailSection("Expected result", `<p>${escapeHtml(item.expectedUpside)}</p>`),
      assignment,
      businessContext,
      execution,
      detailSection("Boundaries", `<p>Hard maximum cost: ${money(item.maxCostCents)}.${pricedBound}<br>Risk: ${escapeHtml(humanStatus(item.risk))}.<br>External actions: ${item.effects?.length ? escapeHtml(item.effects.join(", ")) : "None"}.<br>This decision applies only to the exact work shown here. The model cannot switch automatically after approval.${item.tracePolicy?.providerTraceContent ? " Provider trace input and output will be available for this approved non-personal run." : ""}</p>`),
      detailSection("Your decision", approvalButtons(item)),
    ].join(""), { state: { kind, id }, preserveFocus: options.preserveFocus });
    return;
  }
  const source = kind === "review" ? store.data.decisions?.reviews : store.data.cockpit?.importantWork;
  const item = source?.find((entry) => entry.id === id);
  openDrawer(item?.title || "Details", kind === "review" ? "Review" : "Important work", detailSection("Summary", `<p>${escapeHtml(item?.summary || item?.recommendation || "No additional detail is available.")}</p>`), { state: { kind, id }, preserveFocus: options.preserveFocus });
}

function openPdf(id, title) {
  store.pdfReturnFocus = document.activeElement;
  $("#pdf-title").textContent = title || "Output preview";
  $("#pdf-frame").src = `/api/deliverables/${encodeURIComponent(id)}/file`;
  $("#pdf-modal").classList.add("open");
  $("#pdf-modal").setAttribute("aria-hidden", "false");
  updateBackgroundInert();
  requestAnimationFrame(() => $("#pdf-modal [data-action='close-pdf']")?.focus());
}

function closePdf() {
  if (!$("#pdf-modal").classList.contains("open")) return;
  $("#pdf-modal").classList.remove("open");
  $("#pdf-modal").setAttribute("aria-hidden", "true");
  $("#pdf-frame").src = "about:blank";
  updateBackgroundInert();
  const returnFocus = store.pdfReturnFocus;
  store.pdfReturnFocus = null;
  if (returnFocus?.isConnected) requestAnimationFrame(() => returnFocus.focus());
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
  if (action === "ai-team-tab") {
    store.aiTeamTab = button.dataset.tab;
    renderAiTeam();
    refreshIcons();
    syncLiveRunPolling();
    return;
  }
  if (action === "run-filter") {
    store.runFilter = button.dataset.filter;
    renderAiTeam();
    refreshIcons();
    return;
  }
  if (action === "system-tab") { store.systemTab = button.dataset.tab; return renderSystem(); }
  if (action === "toggle-output-history") { store.showArchivedOutputs = !store.showArchivedOutputs; return renderSystem(); }
  if (action === "open-drawer") return showDetail(button.dataset.kind, button.dataset.id);
  if (action === "open-pdf") return openPdf(button.dataset.id, button.dataset.title);
  if (action === "approval") {
    const decisionLabels = { approve: "approved", changes: "changes requested", reject: "declined" };
    const payload = await withRunPolling(() => postJson(`/api/approvals/${encodeURIComponent(button.dataset.id)}/${button.dataset.decision}`, {
      scopeHash: button.dataset.scopeHash,
      note: `Dashboard decision: ${decisionLabels[button.dataset.decision]}.`,
    }));
    closeDrawer();
    const execution = payload.execution;
    toast(execution?.status === "completed"
      ? "Approved work completed. Review the new result."
      : execution?.status === "blocked"
        ? "Approved, but the work still needs setup or another exact decision."
        : `Decision ${decisionLabels[button.dataset.decision]}.`);
    return loadView(store.view, { silent: true });
  }
  if (action === "handoff-decision") {
    const decisionLabels = { approve: "approved", changes: "changes requested", reject: "declined" };
    const payload = await withRunPolling(() => postJson(`/api/agent-handoffs/${encodeURIComponent(button.dataset.id)}/${button.dataset.decision}`, {
      note: `Dashboard decision: ${decisionLabels[button.dataset.decision]}.`,
    }));
    closeDrawer();
    toast(payload.execution?.status === "completed"
      ? "Approved. The Chief of Staff completed the next internal step."
      : `Next step ${decisionLabels[button.dataset.decision]}.`);
    return loadView(store.view, { silent: true });
  }
  if (action === "submit-command") {
    const text = $("#command-text")?.value.trim();
    if (!text) throw new Error("Enter a business instruction first.");
    await withRunPolling(() => postJson("/api/commands", {
      text,
      venture_id: button.dataset.ventureId,
      mode: store.commandMode,
      autoRun: store.commandMode === "run_protected",
    }));
    toast(store.commandMode === "run_protected" ? "Internal work prepared and started." : "Work plan prepared.");
    return loadView("cockpit", { silent: true });
  }
  if (action === "maintenance") {
    await postJson("/api/monitor/run", {});
    toast("Maintenance completed.");
    return loadView("system", { silent: true });
  }
  if (action === "run-next") {
    const result = await withRunPolling(() => postJson("/api/runtime/tick", {}));
    toast(result.result?.message || `Internal work: ${humanStatus(result.result?.status || "complete")}.`);
    return loadView("system", { silent: true });
  }
  if (action === "run-task") {
    const payload = await withRunPolling(() => postJson(`/api/tasks/${encodeURIComponent(button.dataset.id)}/run`, {}));
    toast(payload.result?.status === "completed"
      ? "That work item completed."
      : payload.result?.message || `Work item: ${humanStatus(payload.result?.status || "complete")}.`);
    return loadView(store.view, { silent: true });
  }
  if (action === "review-agent-run") {
    const usefulnessScore = Number($("#drawer-run-usefulness-score")?.value || 3);
    const note = $("#drawer-run-review-note")?.value.trim() || "";
    await postJson(`/api/agent-pilot/runs/${encodeURIComponent(button.dataset.runId)}/review`, {
      verdict: button.dataset.verdict,
      usefulnessScore,
      note,
    });
    closeDrawer();
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
    let payload;
    try { payload = JSON.parse(event.data); } catch { return; }
    if (payload.type !== "invalidate") return;
    clearTimeout(store.reloadTimer);
    store.reloadTimer = setTimeout(async () => {
      try {
        const openRunId = store.drawerState?.kind === "agent-run" ? store.drawerState.id : null;
        await loadView(store.view, { silent: true });
        if (openRunId) await showDetail("agent-run", openRunId, { preserveFocus: true });
      } catch (error) {
        toast(error.message);
      }
    }, 120);
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
    const pdfOpen = $("#pdf-modal").classList.contains("open");
    const drawerOpen = $("#drawer").classList.contains("open");
    if (event.key === "Escape") {
      if (pdfOpen) closePdf();
      else if (drawerOpen) closeDrawer();
      return;
    }
    if (event.key === "Tab" && pdfOpen) trapDialogFocus(event, $("#pdf-modal"));
    else if (event.key === "Tab" && drawerOpen) trapDialogFocus(event, $("#drawer"));
  });
}

function establishSession() {
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const bootstrapToken = hash.get("bootstrap");
  if (!bootstrapToken) return fetchJson("/api/session");
  const sessionRequest = fetchJson("/api/session", {
    method: "POST",
    headers: { "x-jarvis-bootstrap": bootstrapToken },
  });
  window.history.replaceState(window.history.state, document.title, `${window.location.pathname}${window.location.search}`);
  return sessionRequest;
}

async function boot() {
  $("#today-label").textContent = new Intl.DateTimeFormat("en-AU", { weekday: "short", day: "numeric", month: "short" }).format(new Date());
  bindEvents();
  refreshIcons();
  updateBackgroundInert();
  try {
    const session = await establishSession();
    store.csrfToken = session.csrfToken;
    await loadVentures();
    await loadView("cockpit");
    connectSocket();
  } catch (error) {
    setConnection(false, error.status === 401 ? "Start Jarvis" : "Offline");
    if (error.status === 401) {
      $("#view").innerHTML = emptyState(
        "Start Jarvis to open this dashboard",
        "This window does not have an operator session. Close it, run the Jarvis launcher, and use the secure dashboard window it opens.",
        "shield-alert",
      );
      refreshIcons();
    }
    toast(error.message);
  }
}

boot();
