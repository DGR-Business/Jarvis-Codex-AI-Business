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

function humanActor(value) {
  const key = String(value || "").toLowerCase();
  return {
    operator: "Daniel",
    "spend-gate": "Cost control",
    "agent-pilot": "Demand Validator",
    "runtime-monitor": "Jarvis monitoring",
    scheduler: "Jarvis scheduler",
  }[key] || humanStatus(value);
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
  const amount = Number(cents || 0) / 100;
  if (currency === "AUD") {
    const sign = amount < 0 ? "-" : "";
    const absolute = new Intl.NumberFormat("en-AU", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(Math.abs(amount));
    return `${sign}A$${absolute}`;
  }
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency,
    currencyDisplay: "code",
    maximumFractionDigits: 2,
  }).format(amount);
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
    error.code = payload.code || null;
    error.payload = payload;
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
  const approvalLabel = item.decisionKind === "handoff"
    ? "Prepare next step"
    : Number(item.maxCostCents || 0) > 0 || item.provider
      ? "Start this AI check"
      : "Approve";
  return `<div class="work-actions ${sizeClass}">
    <button class="primary-button" data-action="${action}" data-id="${escapeHtml(item.id)}" data-decision="approve" data-scope-hash="${escapeHtml(item.scopeHash)}">${icon("check")}${escapeHtml(approvalLabel)}</button>
    <button class="secondary-button" data-action="${action}" data-id="${escapeHtml(item.id)}" data-decision="changes" data-scope-hash="${escapeHtml(item.scopeHash)}">${icon("pencil-line")}Ask for changes</button>
    <button class="danger-button" data-action="${action}" data-id="${escapeHtml(item.id)}" data-decision="reject" data-scope-hash="${escapeHtml(item.scopeHash)}">${icon("x")}Do not continue</button>
  </div>`;
}

function decisionReviewButton(item, className = "primary-button") {
  const runResult = item.decisionKind === "handoff" && item.runId;
  const kind = runResult ? "agent-run" : "decision";
  const id = runResult ? item.runId : item.id;
  const label = item.primaryActionLabel || (runResult ? "Review result" : "Review and decide");
  return `<button class="${className}" data-action="open-drawer" data-kind="${kind}" data-id="${escapeHtml(id)}">${icon("arrow-right")}${escapeHtml(label)}</button>`;
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
    <div class="priority-header"><div><span class="eyebrow">Needs you now</span><h2>${items.length === 1 ? "One item needs you" : `${items.length} items need you`}</h2></div>${onlyWaitingToStart ? badge("Ready to start", "amber") : badge("Your decision", "coral")}</div>
    <div class="priority-list">${items.map((item) => `<article class="work-item">
      <span class="risk-bar ${escapeHtml(item.risk || "medium")}"></span>
      <div class="work-copy">${item.attentionLabel ? `<span class="work-state">${escapeHtml(item.attentionLabel)}</span>` : ""}<h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(compact(item.recommendation, 260))}</p>${item.expectedUpside ? `<small>${escapeHtml(compact(item.expectedUpside, 180))}</small>` : ""}</div>
      ${item.type === "decision"
        ? decisionReviewButton(item)
        : ["queued_work", "approved_work"].includes(item.type)
          ? `<button class="primary-button" data-action="run-task" data-id="${escapeHtml(item.id)}" data-execution-kind="${escapeHtml(item.execution_kind || "internal")}">${icon("play")}${escapeHtml(item.run_label || "Run internal step")}${Number(item.max_cost_cents || 0) > 0 ? ` · up to ${money(item.max_cost_cents)}` : ""}</button>`
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
      <header><div><span class="eyebrow">${escapeHtml(item.attentionLabel || "Decision ready")}</span><h3>${escapeHtml(item.title)}</h3></div>${badge(item.risk, item.risk === "high" ? "coral" : "amber")}</header>
      <p>${escapeHtml(item.recommendation)}</p>
      <footer><span class="muted-text">${escapeHtml(item.decisionPrompt || item.expectedUpside || "Review the result before choosing what happens next.")}</span>${decisionReviewButton(item)}</footer>
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
    const retention = data.health.retention;
    const monitoring = data.health.monitoring || {
      status: "starting",
      label: "Starting",
      summary: "Jarvis monitoring starts with the business runtime.",
      latestFindingCount: 0,
      lastCheckAt: null,
    };
    const monitoringTone = monitoring.status === "operating"
      ? "mint"
      : monitoring.status === "starting"
        ? "sky"
        : "amber";
    const monitoringDetail = monitoring.lastCheckAt
      ? `Latest check: ${shortDate(monitoring.lastCheckAt)}. ${Number(monitoring.latestFindingCount || 0)} item${Number(monitoring.latestFindingCount || 0) === 1 ? "" : "s"} surfaced.`
      : "No completed independent check has been recorded yet.";
    const retentionAction = retention.canPrepareDecision
      ? `<button class="secondary-button" data-action="prepare-retention-decision">${icon("shield-check")}Review this plan</button>`
      : "";
    return `<div class="card-grid">
      <article class="item-card"><header><h3>Jarvis monitoring</h3>${badge(monitoring.label, monitoringTone)}</header><p>${escapeHtml(monitoring.summary)} ${escapeHtml(monitoringDetail)} ${escapeHtml(data.health.database === "ok" ? "The operating record also passed its integrity check." : "The operating record needs an integrity review.")}</p></article>
      <article class="item-card"><header><h3>AI worker connection</h3>${badge(ai.ready ? "Ready for approved work" : "Setup needed")}</header><p>${escapeHtml(ai.ready ? "The local Agents SDK path is configured. One exact capped approval is still required for each paid worker run." : compact(ai.blockers?.join(" ") || "Credentials and live permission are not configured."))}</p></article>
      <article class="item-card"><header><h3>Live research</h3>${badge(research.ready ? "Ready for approved test" : "Setup needed")}</header><p>${escapeHtml(research.ready ? "The read-only research path is configured. Provider reachability is proven only by an approved live test." : compact(research.blockers?.join(" ") || "The research connection is not configured."))}</p></article>
      <article class="item-card"><header><h3>Product visuals</h3>${badge(ai.imageGeneration?.ready ? "Ready for approved test" : "Setup needed")}</header><p>${escapeHtml(ai.imageGeneration?.ready ? "Product Builder's reviewed visual path is configured. A paid test and separate quality review are still required." : compact(ai.imageGeneration?.blockers?.join(" ") || "The reviewed product-visual capability is not connected."))}</p></article>
      <article class="item-card"><header><h3>Data protection</h3>${badge(retention.label, retention.status === "active" ? "mint" : "amber")}</header><p>${escapeHtml(retention.summary)} ${escapeHtml(retention.nextAction)}</p>${retentionAction}</article>
      <article class="item-card"><header><h3>External actions</h3>${badge("Locked", "amber")}</header><p>Publishing, customer contact, account changes and money movement remain locked. An approval cannot bypass a locked adapter.</p></article>
    </div>`;
  }
  if (store.systemTab === "checks") {
    const checks = data.checks || { status: "operating_normally", openCount: 0, items: [], monitor: { openCount: 0, criticalCount: 0, items: [] } };
    const monitor = checks.monitor || { openCount: 0, criticalCount: 0, items: [] };
    const monitorAction = (item) => {
      if (!item.action) return badge(item.severity);
      if (item.action.kind === "agent_run") {
        return `<button class="secondary-button" data-action="open-drawer" data-kind="agent-run" data-id="${escapeHtml(item.action.id)}">${icon("file-search")}${escapeHtml(item.action.label)}</button>`;
      }
      if (item.action.kind === "view") {
        return `<button class="secondary-button" data-view="${escapeHtml(item.action.id)}">${icon("arrow-right")}${escapeHtml(item.action.label)}</button>`;
      }
      if (item.action.kind === "system_tab") {
        return `<button class="secondary-button" data-action="system-tab" data-tab="${escapeHtml(item.action.id)}">${icon("arrow-right")}${escapeHtml(item.action.label)}</button>`;
      }
      if (item.action.kind === "maintenance") {
        return `<button class="secondary-button" data-action="maintenance">${icon("wrench")}${escapeHtml(item.action.label)}</button>`;
      }
      return badge(item.severity);
    };
    return `<div class="view-stack">
      <section>${sectionHeading("System checks", "Jarvis verifies that genuine AI work left a complete local record and did not hide an uncertain outcome.")}
        <div class="metric-grid"><div class="metric ${checks.openCount ? "amber" : "mint"}"><span>Current status</span><strong>${escapeHtml(humanStatus(checks.status))}</strong><small>${checks.openCount ? `${checks.openCount} item${checks.openCount === 1 ? "" : "s"} to review` : "No unresolved execution-record issues"}</small></div><div class="metric sky"><span>Receipts verified</span><strong>${Number(checks.verifiedReceiptCount || 0)}</strong><small>${checks.receiptChainVerified ? "Integrity checks passed" : "Integrity review required"}</small></div></div>
      </section>
      <section>${checks.items?.length ? `<div class="plain-list">${checks.items.map((item) => `<article class="plain-row"><div><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.detail)}</p>${item.workerName ? `<small>${escapeHtml(item.workerName)}</small>` : ""}</div>${item.runId ? `<button class="secondary-button" data-action="open-drawer" data-kind="agent-run" data-id="${escapeHtml(item.runId)}">${icon("file-search")}Review</button>` : badge(item.status)}</article>`).join("")}</div>` : emptyState("All execution records are complete", "Jarvis found no missing receipts, uncertain provider outcomes or broken evidence links.", "shield-check")}</section>
      <section>${sectionHeading("Jarvis findings", "Current risks, stalled work and exceptions found by the independent runtime monitor.")}
        <div class="metric-grid"><div class="metric ${monitor.openCount ? "amber" : "mint"}"><span>Open findings</span><strong>${Number(monitor.openCount || 0)}</strong><small>${monitor.openCount ? "Each item remains visible until resolved" : "No current runtime exception"}</small></div><div class="metric ${monitor.criticalCount ? "coral" : "mint"}"><span>Critical</span><strong>${Number(monitor.criticalCount || 0)}</strong><small>${monitor.criticalCount ? "Stop and review before retrying affected work" : "No critical monitor finding"}</small></div></div>
        ${monitor.items?.length ? `<div class="plain-list">${monitor.items.map((item) => `<article class="plain-row"><div><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.detail)}</p><small>Last checked ${escapeHtml(shortDate(item.last_seen || item.first_seen))}${Number(item.occurrence_count || 0) > 1 ? ` · seen ${Number(item.occurrence_count)} times` : ""}</small></div>${monitorAction(item)}</article>`).join("")}</div>` : emptyState("Jarvis found no current exception", "Scheduled checks will place a concrete issue and next action here when something needs review.", "check-circle-2")}
      </section>
    </div>`;
  }
  if (store.systemTab === "queue") {
    return data.queue.length ? `<div class="table-wrap"><table><thead><tr><th>Work</th><th>Worker</th><th>Status</th><th>Updated</th><th>Action</th></tr></thead><tbody>${data.queue.map((item) => `<tr><td data-label="Work"><strong>${escapeHtml(item.title)}</strong>${Number(item.max_cost_cents || 0) > 0 ? `<small>Maximum approved cost: ${money(item.max_cost_cents)}</small>` : ""}</td><td data-label="Worker">${escapeHtml(humanStatus(item.agent))}</td><td data-label="Status">${badge(item.approval_id && ["blocked", "waiting_approval"].includes(item.status) ? "Waiting for decision" : item.can_run && !item.safe_to_run ? "Approved AI work ready" : item.status)}</td><td data-label="Updated">${escapeHtml(shortDate(item.updated_at))}</td><td data-label="Action">${item.can_run ? `<button class="secondary-button" data-action="run-task" data-id="${escapeHtml(item.id)}" data-execution-kind="${escapeHtml(item.execution_kind)}">${icon("play")}${escapeHtml(item.run_label)}</button>` : ["blocked", "waiting_approval", "needs_attention"].includes(item.status) ? `<button class="text-button" data-view="decisions">Review</button>` : `<span class="muted-text">After earlier work</span>`}</td></tr>`).join("")}</tbody></table></div>` : emptyState("The queue is empty", "Create internal work from the Command Center when there is a clear business purpose.", "list-checks");
  }
  if (store.systemTab === "spend") {
    const spend = data.spend;
    const accounting = spend.accounting || { currency: "AUD", cashPaidCents: 0, recurringMonthlyCents: 0, recent: [] };
    return `<div class="view-stack">
      <section>${sectionHeading("AI and tool budget", "Approval caps and measured provider usage for controlled business work.")}
        <div class="metric-grid"><div class="metric sky"><span>Monthly cap</span><strong>${money(spend.monthlyCapCents, spend.currency)}</strong><small>Pre-revenue limit</small></div><div class="metric mint"><span>Available now</span><strong>${money(spend.availableCents, spend.currency)}</strong><small>After all current exposure</small></div><div class="metric sky"><span>Total exposure</span><strong>${money(spend.exposureCents, spend.currency)}</strong><small>Confirmed, estimated, unknown and reserved</small></div><div class="metric mint"><span>Confirmed usage</span><strong>${money(spend.reconciledCents, spend.currency)}</strong><small>Reconciled provider cost</small></div></div>
        <div class="plain-list"><article class="plain-row"><div><h3>Estimated provider usage</h3><p>Provider work completed; final billing reconciliation is pending.</p></div><strong>${money(spend.incurredEstimateCents, spend.currency)}</strong></article><article class="plain-row"><div><h3>Reserved capacity</h3><p>Approved budget held for work that has not yet incurred a charge.</p></div><strong>${money(spend.reservedCents, spend.currency)}</strong></article><article class="plain-row"><div><h3>Unknown cost</h3><p>Provider outcome or charge must be reconciled before related work is repeated.</p></div><strong>${money(spend.unknownCents, spend.currency)}</strong></article></div>
      </section>
      <section>${sectionHeading("Operating costs", "Actual cash records stay separate from the AI execution cap and are stored in Australian dollars.")}
        <div class="metric-grid"><div class="metric coral"><span>Cash paid this month</span><strong>${money(accounting.cashPaidCents, accounting.currency)}</strong><small>Subscriptions and prepaid services</small></div><div class="metric sky"><span>Recurring monthly overhead</span><strong>${money(accounting.recurringMonthlyCents, accounting.currency)}</strong><small>Current active commitments</small></div></div>
        ${accounting.recent?.length ? `<div class="plain-list">${accounting.recent.map((entry) => `<article class="plain-row"><div><h3>${escapeHtml(entry.description)}</h3><p>${escapeHtml(shortDate(entry.occurred_at))} | ${escapeHtml(entry.source)}</p></div><div><strong>${money(entry.amount_cents, entry.currency)}</strong>${badge(entry.entry_type === "recurring_commitment" ? "Monthly" : entry.status)}</div></article>`).join("")}</div>` : emptyState("No operating costs recorded", "Confirmed subscriptions and cash purchases will appear here in Australian dollars.", "receipt")}
      </section>
    </div>`;
  }
  if (store.systemTab === "connections") {
    return `<div class="connection-list">${data.connections.map((item) => `<article class="connection-row"><div><h3>${escapeHtml(item.name)}</h3><p>${escapeHtml(item.metadata?.use || "Runtime connection")} ${item.last_checked_at ? `Configuration checked ${shortDate(item.last_checked_at)}.` : ""}</p></div>${badge(item.status === "configured" ? "Configured" : item.health)}</article>`).join("")}</div>`;
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
  return data.activity.length ? `<div class="activity-list">${data.activity.map((item) => `<article class="activity-row"><div><h3>${escapeHtml(item.message)}</h3><p>${escapeHtml(shortDate(item.ts))} | ${escapeHtml(humanActor(item.actor))}</p></div></article>`).join("")}</div>` : emptyState("No activity recorded", "Runtime actions will appear here in ordinary business language.", "activity");
}

function renderSystem() {
  const data = store.data.system;
  const runnableWork = data.queue.some((item) => item.can_run && item.safe_to_run);
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
  const footer = $("#drawer-footer");
  const wasOpen = drawer.classList.contains("open");
  if (!wasOpen && !options.preserveFocus) store.drawerReturnFocus = document.activeElement;
  if (options.state) store.drawerState = options.state;
  $("#drawer-title").textContent = title;
  $("#drawer-kicker").textContent = kicker;
  $("#drawer-body").innerHTML = body;
  footer.innerHTML = options.footer || "";
  footer.hidden = !options.footer;
  drawer.classList.add("open");
  drawer.classList.toggle("wide", options.wide === true);
  drawer.classList.toggle("has-footer", Boolean(options.footer));
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
  drawer.classList.remove("has-footer");
  drawer.setAttribute("aria-hidden", "true");
  $("#drawer-footer").innerHTML = "";
  $("#drawer-footer").hidden = true;
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

function detailDisclosure(title, content) {
  return `<details class="detail-disclosure"><summary>${icon("chevron-right")}<span>${escapeHtml(title)}</span></summary><div>${content}</div></details>`;
}

function detailList(items, emptyMessage = "None recorded.") {
  return items?.length
    ? `<ul>${items.map((item) => `<li>${escapeHtml(typeof item === "string" ? item : item.summary || item.title || String(item))}</li>`).join("")}</ul>`
    : `<p>${escapeHtml(emptyMessage)}</p>`;
}

function plainAgentText(value) {
  return String(value || "")
    .replace(/All observations are evaluation fixtures, not real-business market evidence\./gi, "All observations came from a controlled test, not real market activity.")
    .replace(/\bevaluation fixtures\b/gi, "controlled test examples")
    .replace(/\bfixtures\b/gi, "controlled test examples")
    .replace(/\bfixture\b/gi, "controlled test evidence")
    .replace(/(?<![A-Za-z])\$(?=\d)/g, "A$");
}

function plainAgentList(items) {
  return detailList((items || []).map((item) => (
    typeof item === "string" ? plainAgentText(item) : item
  )));
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

const OPEN_HANDOFF_STATES = new Set(["needs_operator_decision", "waiting_for_review", "waiting_approval"]);

function activeRunHandoff(data) {
  return data.execution?.runtimeHandoffs?.find((handoff) => OPEN_HANDOFF_STATES.has(handoff.status)) || null;
}

function runReviewFooter(data) {
  const handoff = activeRunHandoff(data);
  const reviewPending = data.review?.operatorVerdict === "pending";
  const demandResult = data.run.workerId === "demand_validator";
  if (reviewPending) {
    return `<div class="drawer-footer-copy"><strong>Is this analysis clear enough to use?</strong><span>Your answer helps Jarvis improve this exact AI skill.</span></div>
      <div class="work-actions">
        <button class="primary-button" data-action="review-agent-run" data-run-id="${escapeHtml(data.run.id)}" data-verdict="useful" data-score="4">${icon("check")}Analysis is clear</button>
        <button class="secondary-button" data-action="review-agent-run" data-run-id="${escapeHtml(data.run.id)}" data-handoff-id="${escapeHtml(handoff?.id || "")}" data-verdict="changes_required" data-score="2">${icon("pencil-line")}Request a better analysis</button>
      </div>`;
  }
  if (!handoff) return "";
  return `<div class="drawer-footer-copy"><strong>What should Jarvis do next?</strong><span>No publishing, customer contact, account change, or spend will occur.</span></div>
    <div class="work-actions">
      <button class="primary-button" data-action="handoff-decision" data-id="${escapeHtml(handoff.id)}" data-decision="approve">${icon("arrow-right")}${demandResult ? "Prepare the interest test" : "Prepare the next step"}</button>
      <button class="secondary-button" data-action="handoff-decision" data-id="${escapeHtml(handoff.id)}" data-decision="changes">${icon("pencil-line")}Ask for changes</button>
      <button class="danger-button" data-action="handoff-decision" data-id="${escapeHtml(handoff.id)}" data-decision="reject">${icon("square")}Stop here</button>
    </div>`;
}

function runReviewBody(data) {
  const process = data.process;
  const execution = data.execution;
  const receipt = data.receipt;
  const protectedRun = execution.kind === "protected_rehearsal";
  const unknownOutcome = execution.kind === "provider_outcome_unknown";
  const visibility = execution.tracePolicy || {};
  const handoff = activeRunHandoff(data);
  const reviewPending = data.review?.operatorVerdict === "pending";
  const controlledEvidence = process.suppliedEvidence?.some((item) => item.sourceType === "test_fixture");
  const demandResult = data.run.workerId === "demand_validator";
  const plainConclusion = demandResult
    ? "Demand Validator recommends a small, free interest test before anything is built. The controlled evidence suggests a recurring problem, but it does not prove real demand or willingness to pay."
    : plainAgentText(process.conclusion);
  const duration = durationLabel(data.run.durationMs);
  const actualTokens = execution.actualTokens?.total === null || execution.actualTokens?.total === undefined
    ? "Not captured"
    : `${tokenCount(execution.actualTokens.input)} in / ${tokenCount(execution.actualTokens.output)} out`;
  const plannedTokens = execution.plannedTokens?.input === null && execution.plannedTokens?.output === null
    ? "Not set"
    : `${execution.plannedTokens?.input === null ? "No input cap" : `${tokenCount(execution.plannedTokens.input)} input`} / ${execution.plannedTokens?.output === null ? "No output cap" : `${tokenCount(execution.plannedTokens.output)} output`}`;
  const providerCost = protectedRun
    ? "No provider charge"
    : execution.cost.status === "reconciled"
      ? `${money(execution.cost.reconciledCents || 0, execution.cost.currency)} final`
      : Number(execution.cost.estimatedCents || 0) > 0
        ? `About ${money(execution.cost.estimatedCents, execution.cost.currency)}; final bill pending`
        : "No charge recorded";
  const providerVisibility = protectedRun
    ? "No provider call was made. This was an internal rehearsal."
    : visibility.providerResponseStored && visibility.providerTraceContent
      ? "OpenAI trace content was enabled for this approved non-personal run."
      : "Jarvis retained the structured result and local execution record; full provider trace content was not enabled.";
  const suppliedEvidence = process.suppliedEvidence?.length
    ? `<div class="evidence-list">${process.suppliedEvidence.map((item) => {
        const url = safeExternalUrl(item.url);
        const sourceLabel = item.sourceType === "test_fixture" ? "Controlled test evidence" : humanStatus(item.sourceType);
        return `<article><strong>${escapeHtml(item.title)}</strong><p>${escapeHtml(item.summary)}</p><small>${escapeHtml(sourceLabel)}${url ? ` · <a href="${escapeHtml(url)}" target="_blank" rel="noreferrer">Open source</a>` : ""}</small></article>`;
      }).join("")}</div>`
    : "<p>No supplied evidence was recorded.</p>";
  const traceEvents = data.developer.traceEvents?.length
    ? `<ol class="trace-list">${data.developer.traceEvents.map((event) => `<li><strong>${escapeHtml(event.title)}</strong><span>${escapeHtml(event.detail || humanStatus(event.type))}</span><small>${escapeHtml(dateTime(event.ts))}</small></li>`).join("")}</ol>`
    : "<p>No local timeline was recorded.</p>";
  const observedTools = execution.observedTools?.length
    ? `<div class="evidence-list">${execution.observedTools.map((tool) => `<article><strong>${escapeHtml(tool.name)}</strong><p>${escapeHtml(tool.outputSummary || tool.inputSummary || "Tool activity was recorded.")}</p><small>${escapeHtml(humanStatus(tool.status))}</small></article>`).join("")}</div>`
    : "<p>No provider tool was used.</p>";
  const sources = execution.sources?.length
    ? `<div class="evidence-list">${execution.sources.map((source) => {
        const url = safeExternalUrl(source.url);
        return `<article><strong>${escapeHtml(source.title)}</strong><p>${escapeHtml(source.relevance || source.publisher || "Research source recorded by Jarvis.")}</p><small>${source.grounded ? "Grounded source" : "Source not independently verified"}${url ? ` · <a href="${escapeHtml(url)}" target="_blank" rel="noreferrer">Open source</a>` : ""}</small></article>`;
      }).join("")}</div>`
    : "<p>No web research was used for this run.</p>";
  const businessContext = process.businessContext
    ? detailSection("Business records supplied", `<p>${escapeHtml(process.businessContext.purpose)}</p><div class="evidence-list">${process.businessContext.sections.map((section) => `<article><strong>${escapeHtml(humanStatus(section.name))}</strong><p>${section.recordCount ? escapeHtml(section.records.map((item) => item.title).join(", ")) : "No current records in this category."}</p><small>${section.recordCount} record${section.recordCount === 1 ? "" : "s"} supplied</small></article>`).join("")}</div>`)
    : "";
  const errorSection = data.run.error || execution.error
    ? detailSection("What went wrong", `<div class="error-callout"><strong>${unknownOutcome ? "OpenAI outcome needs review" : "The run failed"}</strong><p>${escapeHtml(data.run.error || execution.error)}</p></div>`)
    : "";
  const reviewStatus = reviewPending
    ? `<div class="decision-step"><span>1</span><div><strong>Check the analysis</strong><p>Read the result, then use the buttons below to say whether it is clear enough to guide a decision.</p></div></div>`
    : `<div class="decision-step complete"><span>${icon("check")}</span><div><strong>Analysis reviewed</strong><p>${escapeHtml(data.review?.note || `You marked this analysis as ${humanStatus(data.review?.operatorVerdict || "reviewed")}.`)}</p></div></div>`;
  const nextStepStatus = handoff
    ? `<div class="decision-step${reviewPending ? " waiting" : ""}"><span>2</span><div><strong>Choose the business direction</strong><p>${reviewPending ? "This becomes available as soon as you finish step one." : demandResult ? "Choose whether Jarvis should prepare the free interest test, revise the work, or stop here." : escapeHtml(handoff.decisionNeeded || "Choose what Jarvis should do next.")}</p></div></div>`
    : `<div class="decision-step complete"><span>${icon("check")}</span><div><strong>Next step recorded</strong><p>No further direction is waiting on this result.</p></div></div>`;
  const receiptRecord = receipt
    ? `<div class="review-check"><span>${receipt.status === "complete" ? "Inputs, output, provider evidence, cost state, and checks were captured." : "Jarvis found an issue in the stored run record."}</span>${badge(receipt.status === "complete" ? "Record complete" : "Review needed", receipt.status === "complete" ? "mint" : "amber")}</div>${receipt.missingFields?.length ? `<h4>Missing details</h4>${detailList(receipt.missingFields)}` : ""}${receipt.warnings?.length ? `<h4>Review notes</h4>${detailList(receipt.warnings)}` : ""}`
    : `<div class="error-callout"><strong>Run record not finalized</strong><p>${data.run.status === "running" ? "Jarvis is still recording this run." : "The system monitor will keep this visible until the record is complete."}</p></div>`;
  const technicalRecord = [
    detailSection("Automated checks", `${reviewCriteria(data.review?.criteria || {})}<p>The ${escapeHtml(String(data.quality?.score ?? "unscored"))}${data.quality?.score !== undefined ? "/100" : ""} result checks structure and safety only. You decide whether the work is commercially useful.</p>`),
    detailSection("Execution facts", `<div class="review-facts"><div><span>Run type</span><strong>${escapeHtml(execution.label)}</strong></div><div><span>Status</span><strong>${escapeHtml(humanStatus(data.run.status))}</strong></div><div><span>Provider</span><strong>${escapeHtml(execution.provider || (protectedRun ? "No provider used" : execution.requestedProvider || "Not captured"))}</strong></div><div><span>Model</span><strong>${escapeHtml(execution.modelRoute?.label || execution.model || (protectedRun ? "No model called" : execution.requestedModel || "Not captured"))}</strong></div><div><span>Duration</span><strong>${escapeHtml(duration)}</strong></div><div><span>Tokens</span><strong>${escapeHtml(actualTokens)}</strong></div><div><span>Planned limits</span><strong>${escapeHtml(plannedTokens)}</strong></div><div><span>Cost</span><strong>${escapeHtml(providerCost)}</strong></div><div><span>External effects</span><strong>${execution.externalEffects.length ? escapeHtml(execution.externalEffects.join(", ")) : "None"}</strong></div></div><p>${escapeHtml(providerVisibility)}</p>`),
    detailSection("Tools and research", `<h4>Tool activity</h4>${observedTools}<h4>Research sources</h4>${sources}`),
    detailSection("Stored run record", `${receiptRecord}<div class="technical-ids"><span>OpenAI trace</span><code>${escapeHtml(execution.traceId || "Not captured")}</code><span>OpenAI response</span><code>${escapeHtml(execution.responseId || "Not captured")}</code><span>Jarvis run</span><code>${escapeHtml(data.run.id)}</code><span>Input fingerprint</span><code>${escapeHtml(data.developer.fixtureHash || data.developer.contextSnapshotHash || "Not captured")}</code><span>Receipt fingerprint</span><code>${escapeHtml(receipt?.hash || "Not captured")}</code></div>`),
    detailSection("Run timeline", traceEvents),
  ].join("");

  return `<div class="review-workspace">
    <section class="result-hero">
      <div><span class="eyebrow">AI recommendation</span><h3>${demandResult ? "Test interest before building" : escapeHtml(data.run.taskTitle)}</h3><p>${escapeHtml(plainConclusion)}</p></div>
      <div class="result-badges">${badge(`Confidence: ${humanStatus(process.confidence)}`, "amber")}${controlledEvidence ? badge("Controlled test; not market proof", "sky") : badge(data.run.status, data.run.status === "completed" ? "mint" : "amber")}</div>
    </section>
    ${errorSection}
    <section class="run-fact-strip">
      <div><span>Evidence reviewed</span><strong>${process.suppliedEvidence?.length || 0} supplied item${process.suppliedEvidence?.length === 1 ? "" : "s"}</strong></div>
      <div><span>Web research</span><strong>${execution.sources?.length ? `${execution.sources.length} source${execution.sources.length === 1 ? "" : "s"}` : "Not used"}</strong></div>
      <div><span>External action</span><strong>${execution.externalEffects.length ? "Recorded" : "None"}</strong></div>
      <div><span>Estimated cost</span><strong>${escapeHtml(providerCost)}</strong></div>
    </section>
    ${detailSection("What the AI was asked", `<p class="lead-copy">${escapeHtml(process.question)}</p><div class="review-facts simple"><div><span>Intended buyer</span><strong>${escapeHtml(process.buyer)}</strong></div><div><span>Idea being tested</span><strong>${escapeHtml(process.hypothesis)}</strong></div></div>`)}
    ${businessContext}
    ${detailSection("What it found", `<div class="finding-columns"><div><span class="finding-label positive">${icon("check")}Supports a test</span>${plainAgentList(process.supportingEvidence)}</div><div><span class="finding-label caution">${icon("circle-help")}Still missing</span>${plainAgentList(process.counterevidence)}</div></div>${detailDisclosure("Assumptions the AI made", plainAgentList(process.assumptions))}`)}
    ${detailSection("The proposed interest test", `<p class="lead-copy">${escapeHtml(plainAgentText(process.smallestTest))}</p><div class="test-plan"><div><span>Success looks like</span><strong>${escapeHtml(plainAgentText(process.metric))}</strong></div><div><span>Stop or revise when</span><strong>${escapeHtml(plainAgentText(process.stopRule))}</strong></div><div><span>Possible price and channel</span><strong>${escapeHtml(plainAgentText(process.priceChannelHypothesis))}</strong></div></div><h4>Main risks</h4>${plainAgentList(process.risks)}`)}
    ${detailSection("Your next steps", `<div class="decision-path">${reviewStatus}${nextStepStatus}</div>`)}
    ${detailDisclosure("Technical run record", technicalRecord)}
  </div>`;
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
    const reviewTitle = data.run.workerId === "demand_validator" && data.run.status === "completed"
      ? "Demand Validator result"
      : data.run.taskTitle;
    openDrawer(reviewTitle, `${data.run.workerName} · ${data.run.executionLabel}`, runReviewBody(data), {
      wide: true,
      state: { kind, id },
      preserveFocus: options.preserveFocus,
      footer: runReviewFooter(data),
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
    const aiCheck = Boolean(item.provider || item.model || item.worker);
    const handoffDecision = item.decisionKind === "handoff";
    const assignment = item.assignment
      ? detailSection("What the AI will review", `<p class="lead-copy">${escapeHtml(item.assignment.question || "The question was not stated.")}</p><div class="review-facts simple"><div><span>Intended buyer</span><strong>${escapeHtml(item.assignment.buyer || "Not stated")}</strong></div><div><span>Evidence supplied</span><strong>${escapeHtml(String(item.assignment.evidenceCount || 0))} item${Number(item.assignment.evidenceCount || 0) === 1 ? "" : "s"}</strong></div></div>`)
      : "";
    const route = item.modelRoute;
    const execution = item.model || item.tools?.length || item.maxTurns
      ? detailSection("Execution", `<div class="review-facts"><div><span>Worker</span><strong>${escapeHtml(item.worker || "Not stated")}</strong></div><div><span>Model</span><strong>${escapeHtml(route?.label || item.model || "Not stated")}</strong></div><div><span>Why this model</span><strong>${escapeHtml(route?.reason || "Selected before approval for this exact task.")}</strong></div><div><span>Provider tools</span><strong>${item.tools?.length ? escapeHtml(item.tools.join(", ")) : "None"}</strong></div><div><span>Turns</span><strong>${escapeHtml(String(item.maxTurns || "Not stated"))}</strong></div><div><span>Output limit</span><strong>${item.maxOutputTokens ? `${escapeHtml(String(item.maxOutputTokens))} tokens` : "Not stated"}</strong></div></div>`)
      : "";
    const businessContext = item.businessContext
      ? detailSection("Business records", `<p>${escapeHtml(item.businessContext.purpose)}</p><div class="review-facts"><div><span>Records supplied</span><strong>${escapeHtml(String(item.businessContext.recordCount))}</strong></div><div><span>Categories</span><strong>${escapeHtml(item.businessContext.recordClasses.map(humanStatus).join(", "))}</strong></div></div><p class="muted-text">This approval is bound to one frozen record snapshot. Credentials, unrelated ventures, local-only records, and direct customer identifiers are excluded by default.</p>`)
      : "";
    const policySummary = item.policySummary?.length
      ? detailSection("Data protection plan", `<div class="plain-list">${item.policySummary.map((rule) => `<article class="plain-row"><div><h3>${escapeHtml(rule.label)}</h3><p>${escapeHtml(rule.rule)}</p></div>${badge(rule.duration)}</article>`).join("")}</div><p class="muted-text">${item.noDeletion ? "Approving this plan activates future checks. It does not delete any records." : ""}</p>`)
      : "";
    const pricedBound = item.pricedWorstCaseCostCents
      ? ` The current priced upper estimate is ${money(item.pricedWorstCaseCostCents)}; final usage is recorded after the run.`
      : "";
    const whatHappens = handoffDecision
      ? "Jarvis will turn the reviewed result into the next internal work step. Nothing will be published or sent outside the system."
      : aiCheck
        ? `${item.worker || "The AI worker"} will complete this one check and return the result for your review.`
        : "Jarvis will carry out only the work described in this decision.";
    const limits = item.effects?.length
      ? `Only these approved effects are allowed: ${item.effects.join(", ")}.`
      : "It cannot publish, contact anyone, change an account, sign anything, or move money.";
    const costStatement = Number(item.maxCostCents || 0) > 0
      ? `The absolute cost limit is ${money(item.maxCostCents)}.${pricedBound}`
      : "No provider spend is approved by this decision.";
    const technical = [businessContext, execution, detailSection("Exact limits", `<p>${escapeHtml(costStatement)}<br>Risk level: ${escapeHtml(humanStatus(item.risk))}.<br>${escapeHtml(limits)}${item.tracePolicy?.providerTraceContent ? "<br>The approved non-personal input and output will be available in the OpenAI trace." : ""}</p>`)].join("");
    openDrawer(item.title, "Your decision", `<div class="review-workspace">
      <section class="result-hero decision-hero"><div><span class="eyebrow">What Jarvis recommends</span><h3>${escapeHtml(item.recommendation)}</h3><p>${escapeHtml(item.expectedUpside)}</p></div>${badge(`${humanStatus(item.risk)} risk`, item.risk === "high" ? "coral" : "amber")}</section>
      ${detailSection("What happens if you continue", `<p class="lead-copy">${escapeHtml(whatHappens)}</p><p>${escapeHtml(costStatement)}</p>`)}
      ${detailSection("What will not happen", `<p>${escapeHtml(limits)}</p>`)}
      ${assignment}
      ${policySummary}
      ${detailDisclosure("Technical details", technical)}
    </div>`, {
      wide: true,
      state: { kind, id },
      preserveFocus: options.preserveFocus,
      footer: `<div class="drawer-footer-copy"><strong>Choose what happens next</strong><span>Your choice applies only to the work shown here.</span></div>${approvalButtons(item)}`,
    });
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
    let payload;
    try {
      payload = await withRunPolling(() => postJson(`/api/approvals/${encodeURIComponent(button.dataset.id)}/${button.dataset.decision}`, {
        scopeHash: button.dataset.scopeHash,
        note: `Dashboard decision: ${decisionLabels[button.dataset.decision]}.`,
      }));
    } catch (error) {
      if (error.code !== "approval_refreshed") throw error;
      closeDrawer();
      await loadView("decisions", { silent: true });
      toast(error.message);
      return;
    }
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
    toast(button.dataset.decision === "approve"
      ? payload.execution?.status === "completed"
        ? "Jarvis prepared the next internal step. Nothing was published or sent."
        : "The next internal step is ready."
      : button.dataset.decision === "changes"
        ? "Changes requested. Jarvis will not continue until the result is revised."
        : "This path was stopped. No external action occurred.");
    return loadView("cockpit", { silent: true });
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
  if (action === "prepare-retention-decision") {
    await postJson("/api/system/retention/prepare-decision", {});
    store.view = "decisions";
    store.decisionTab = "approvals";
    syncNavigation();
    return loadView("decisions", { silent: true });
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
    const usefulnessScore = Number(button.dataset.score || 3);
    const runId = button.dataset.runId;
    const note = button.dataset.verdict === "useful"
      ? "Clear enough to guide the next business decision."
      : "A clearer or more useful analysis is required.";
    await postJson(`/api/agent-pilot/runs/${encodeURIComponent(button.dataset.runId)}/review`, {
      verdict: button.dataset.verdict,
      usefulnessScore,
      note,
    });
    if (button.dataset.verdict === "changes_required" && button.dataset.handoffId) {
      await postJson(`/api/agent-handoffs/${encodeURIComponent(button.dataset.handoffId)}/changes`, {
        note: "The analysis needs to be clearer or more useful before Jarvis continues.",
      });
      closeDrawer();
      toast("A better analysis was requested. Jarvis will not continue from this result.");
      return loadView("cockpit", { silent: true });
    }
    await loadView(store.view, { silent: true });
    await showDetail("agent-run", runId, { preserveFocus: true });
    toast("Review recorded. Now choose what Jarvis should do next.");
    return;
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
