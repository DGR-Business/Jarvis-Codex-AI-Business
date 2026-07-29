const store = {
  view: "cockpit",
  data: {},
  csrfToken: null,
  commandMode: "plan_only",
  decisionTab: "approvals",
  testTab: "candidate",
  aiTeamTab: "team",
  portfolioTab: "opportunities",
  commercialSearch: null,
  runFilter: "running",
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
  journey: { title: "Full Journey", kicker: "Research to ready to publish", endpoint: "/api/journey" },
  decisions: { title: "Decisions", kicker: "Your attention", endpoint: "/api/decisions" },
  portfolio: { title: "Portfolio", kicker: "Evidence before investment", endpoint: "/api/portfolio" },
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
    deterministic_system_step: "System-generated step",
    provider_not_contacted: "Stopped before OpenAI",
    model_backed: "OpenAI used",
    provider_outcome_unknown: "Outcome needs review",
    provider_evidence_missing: "Provider proof incomplete",
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
    researching: "Researching opportunities",
    validating: "Checking demand",
    starting: "Starting",
    waiting_for_operator: "Waiting for your decision",
    candidate_selection: "Choosing the strongest opportunity",
    finance_analysis: "Checking the numbers",
    offer_architecture: "Designing the offer",
    product_build: "Building customer files",
    storefront_visuals: "Creating storefront visuals",
    quality_review: "Checking product quality",
    conversion_copy: "Writing the listing",
    distribution_plan: "Planning the launch",
    chief_brief: "Preparing your final brief",
    launch_decision: "Ready for your decision",
    ready_to_publish: "Ready to publish",
    stopped_after_correction: "Stopped after a quality issue",
    stopped_unknown_outcome: "Stopped because the result is uncertain",
    cancelled: "Stopped",
    completed: "Complete",
    checking_economics: "Checking the numbers",
    structuring_offer: "Designing the offer",
    needs_direction: "Needs a new direction",
    selected_for_validation: "Selected for deeper research",
    validated: "Demand check passed",
    ready_to_build: "Ready for build decision",
    ranked: "Ranked opportunity",
    rejected: "Did not pass",
    awaiting_verification: "Waiting for confirmation",
    portfolio_discovery: "Portfolio research",
    investment_review: "Final investment review",
    investment_approved: "Investment case passed",
    selected_for_investment_review: "Final review",
    queued_for_validation: "Waiting for demand research",
    queued_for_finance: "Waiting for financial review",
    selected_for_finance: "Financial review",
    economics_checked: "Financial review complete",
    finance_rejected: "Numbers did not pass",
    no_investment: "No investment recommended",
    research_more: "More evidence needed",
    park: "Parked",
    advance: "Proceed",
    retained: "Keep service",
  };
  return labels[key] || key.replace(/[._-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function humanActor(value) {
  const key = String(value || "").toLowerCase();
  return {
    operator: "Daniel",
    "spend-gate": "Cost control",
    "agent-pilot": "Demand Validator",
    "runtime-monitor": "Pantheon monitoring",
    scheduler: "Pantheon scheduler",
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
  return Boolean(filePath) && (
    value === "pdf"
    || value === "application/pdf"
    || ["png", "jpg", "jpeg", "webp", "gif"].includes(value)
    || value.startsWith("image/")
  );
}

function validationPlatform(validation) {
  return validation?.channel?.platformName || "the selected platform";
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

function externalDomain(value) {
  const safe = safeExternalUrl(value);
  if (!safe) return null;
  return new URL(safe).hostname.replace(/^www\./, "");
}

function compact(value, max = 180) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}

function operatorFriendlyQualityCopy(value) {
  return String(value || "")
    .replace(/exposed workbook fields/gi, "workbook customers would receive")
    .replace(/Agency Delivery Bundle representation/gi, "Agency Delivery Bundle description")
    .replace(/regenerate or revalidate affected manifest and previews/gi, "rebuild its product record and previews")
    .replace(/return for quality approval/gi, "run the independent quality check again");
}

async function fetchJson(url, options = {}, retry = 0) {
  const method = String(options.method || "GET").toUpperCase();
  const headers = { "content-type": "application/json", ...(options.headers || {}) };
  if (!["GET", "HEAD"].includes(method) && store.csrfToken) {
    headers["x-pantheon-csrf"] = store.csrfToken;
    headers["x-jarvis-csrf"] = store.csrfToken;
  }
  const response = await fetch(url, { credentials: "same-origin", ...options, headers });
  let payload;
  try { payload = await response.json(); } catch { payload = {}; }
  if (
    response.status === 403
    && retry === 0
    && url !== "/api/session"
    && (payload.error === "This action needs a fresh Pantheon session token."
      || payload.error === "This action needs a fresh Pantheon session token.")
  ) {
    const sessionResponse = await fetch("/api/session", { credentials: "same-origin" });
    const session = await sessionResponse.json().catch(() => ({}));
    if (sessionResponse.ok && session.csrfToken) {
      store.csrfToken = session.csrfToken;
      return fetchJson(url, options, 1);
    }
  }
  if (!response.ok) {
    const error = new Error(response.status === 401
      ? "Pantheon is not signed in. Start Pantheon with its launcher, then use the dashboard window it opens."
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
  const requestedView = view;
  store.view = view;
  setPage(view);
  if (!options.silent) {
    $("#view").innerHTML = '<div class="loading-state"><span></span><p>Loading business state...</p></div>';
  }
  try {
    const data = requestedView === "portfolio"
      ? await Promise.all([
        fetchJson(viewConfig[requestedView].endpoint),
        fetchJson("/api/commercial/service-trials"),
      ]).then(([portfolio, serviceTrials]) => ({ ...portfolio, serviceTrials }))
      : await fetchJson(viewConfig[requestedView].endpoint);
    store.data[requestedView] = data;
    if (store.view !== requestedView) return data;
    renderView();
    return data;
  } catch (error) {
    if (store.view === requestedView) {
      $("#view").innerHTML = `<div class="empty-state">${icon("triangle-alert")}<h3>Could not load this section</h3><p>${escapeHtml(error.message)}</p></div>`;
      refreshIcons();
    }
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
  const liveResearch = item.tools?.some((tool) => ["research_adapter", "live_web_with_approval"].includes(tool));
  const approvalLabel = item.approveLabel || (item.decisionKind === "handoff"
    ? "Prepare next step"
    : liveResearch
      ? "Run this market research"
      : Number(item.maxCostCents || 0) > 0 || item.provider
        ? "Start this AI check"
        : "Approve");
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
  const discovery = data.commercialDiscovery || {};
  const portfolio = discovery.portfolio || {};
  const validation = data.buyerIntentValidation;
  const journey = data.currentJourney;
  const journeyStopped = ["cancelled", "stopped_after_correction", "stopped_unknown_outcome"].includes(journey?.status);
  const active = discovery.activeRound;
  const portfolioComplete = !active
    && Number(portfolio.evidenceRoundCount || 0) >= 2
    && portfolio.nextAction?.action == null;
  const currentTask = discovery.currentTask;
  const journeyProgress = journey
    ? `<div class="discovery-progress">
        <span class="status-dot ${journey.currentTask?.status === "running" ? "working" : "waiting-to-start"}"></span>
        <div><strong>${escapeHtml(humanStatus(journey.activeStage))}</strong><p>${escapeHtml(journey.currentTask?.title || (journeyStopped ? "No further work will start automatically; review the recorded result first." : "Pantheon is ready for the next verified journey step."))}</p></div>
        ${badge(journey.currentTask?.status || journey.status)}
      </div>`
    : "";
  const discoveryProgress = !journey && active
    ? `<div class="discovery-progress">
        <span class="status-dot ${currentTask?.status === "running" ? "working" : "waiting-to-start"}"></span>
        <div><strong>${escapeHtml(humanStatus(active.status))}</strong><p>${escapeHtml(currentTask?.title || active.prompt)}</p></div>
        ${currentTask && !["running", "needs_attention"].includes(currentTask.status)
          ? `<button type="button" class="primary-button" data-action="run-pantheon">${icon("play")}Continue now</button>`
          : badge(currentTask?.status || active.status)}
      </div>`
    : "";
  const validationHeading = validation?.status === "stopped_permanently"
    ? "This product build is permanently stopped"
    : validation?.status === "waiting_for_final_review_decision"
    ? validation.inspectionEvidenceRecheck
      ? "The complete setup-guide inspection is ready"
      : "The corrected validation workbook is ready"
    : validation?.status === "final_review_running"
      ? validation.inspectionEvidenceRecheck
        ? "Pantheon is rechecking the complete setup-guide inspection"
        : "Pantheon is checking the corrected workbook"
      : validation?.status === "final_review_queued"
        ? validation.inspectionEvidenceRecheck
          ? "The evidence recheck is approved and waiting to start"
          : "The final review is approved and waiting to start"
      : validation?.status === "buyer_test_ready"
        ? "The validation product passed its independent check"
        : validation?.status === "product_needs_attention"
          ? "The validation product did not pass its check"
        : validation
          ? "Pantheon is preparing the first buyer test"
          : null;
  const validationCopy = validation?.status === "stopped_permanently"
    ? "The single inspection-evidence recheck did not pass or was declined. Pantheon will not retry, revise, or spend more on this build. The evidence and customer files remain retained."
    : validation?.status === "waiting_for_final_review_decision"
    ? validation.inspectionEvidenceRecheck
      ? `The customer package is unchanged. Jarvis regenerated only the internal inspection sheet so all three setup-guide pages are visible; one evidence recheck, capped at ${money(validation.finalReviewCapCents)}, now needs your decision.`
      : `Three independent reviews and their findings remain on record. Jarvis corrected the exact local files at no additional AI cost; one final check, capped at ${money(validation.finalReviewCapCents)}, now needs your decision.`
    : validation?.status === "final_review_running"
      ? validation.inspectionEvidenceRecheck
        ? "The Quality Reviewer is inspecting the unchanged customer package through the complete three-page setup-guide sheet and the other three exact local images. Nothing is being published or sent."
        : "The Quality Reviewer is inspecting the exact corrected workbook, setup guide, calculations, and previews. Nothing is being published or sent."
      : validation?.status === "final_review_queued"
        ? validation.inspectionEvidenceRecheck
          ? "The one manually approved Terra evidence recheck is queued with the same four exact local images and A$1.50 ceiling. No second approval or fallback is available."
          : "The approved final review is queued with its exact limits. Nothing is being published or sent."
      : validation?.status === "buyer_test_ready"
        ? "The exact customer files are ready for the separate buyer-test decision. The investment case remains parked until real paid demand is measured."
        : validation?.status === "product_needs_attention"
          ? "Pantheon stopped this build. No AI or external action is running. Jarvis must inspect the retained findings and prove any eligible zero-spend local repair before Pantheon prepares another decision."
        : validation
          ? "Pantheon is building and checking one real customer product before asking you to consider any marketplace action."
          : "";
  return `<section class="command-band">
    <div>
      <span class="section-label">${validation ? "First buyer test" : journey ? "Full business journey" : active ? "Commercial work" : portfolioComplete ? "Research complete" : "Do this next"}</span>
      <h2>${validation ? escapeHtml(validationHeading) : journey ? `Pantheon ${journeyStopped ? "stopped at" : "is at"} ${escapeHtml(humanStatus(journey.activeStage))}` : active ? "Pantheon is moving the venture forward" : portfolioComplete ? escapeHtml(portfolio.nextAction?.label || "Commercial review complete") : "Start with a broad opportunity scan"}</h2>
      <p>${validation ? escapeHtml(validationCopy) : journey ? "This status comes from the active journey record. Open it to see the current worker, verified outputs, cost and one next action." : active ? "Pantheon will continue internal work and stop at the next genuine decision or protected action." : portfolioComplete ? escapeHtml(portfolio.nextAction?.detail || "Review the retained evidence before authorising any further research.") : "Pantheon will research across suitable online business models, then narrow the strongest options by demand, economics and execution fit."}</p>
      ${validation || journey || portfolioComplete ? "" : `<textarea id="command-text" aria-label="Business idea" placeholder="Optional: describe a particular business idea for Pantheon to review"></textarea>`}
    </div>
    <div class="command-controls">
      ${validation?.experimentId
        ? `<button type="button" class="primary-button" data-action="open-drawer" data-kind="test" data-id="${escapeHtml(validation.experimentId)}">${icon("file-search")}Review product and test</button>`
        : journey
        ? `<button type="button" class="primary-button" data-view="journey">${icon("route")}Open full journey</button>`
        : active
        ? `<button type="button" class="secondary-button" data-view="portfolio">${icon("search")}View opportunities</button>`
        : portfolioComplete
          ? `<button type="button" class="primary-button" data-view="portfolio">${icon("briefcase-business")}Review investment cases</button>`
          : `<button type="button" class="primary-button" data-action="start-portfolio-discovery" data-mode="broad">${icon("radar")}Find opportunities</button>
             <button type="button" class="secondary-button" data-action="start-portfolio-discovery" data-mode="idea">${icon("lightbulb")}Review my idea</button>`}
    </div>
    ${validation ? "" : journeyProgress || discoveryProgress}
  </section>`;
}

function renderImportantWork(
  items,
  commercialWorkExists = false,
  journeyStatus = null,
  validationStatus = null,
) {
  if (!items.length) {
    if (!commercialWorkExists) return "";
    if (validationStatus === "stopped_permanently") {
      return `<section class="priority-panel clear"><div class="priority-header"><div><span class="eyebrow">Important work</span><h2>This build is permanently stopped</h2><p>No decision or retry is waiting. The exact files and evidence remain retained.</p></div>${badge("Stopped", "coral")}</div></section>`;
    }
    if (validationStatus === "product_needs_attention") {
      return `<section class="priority-panel clear"><div class="priority-header"><div><span class="eyebrow">Important work</span><h2>Jarvis repair is required</h2><p>No paid retry is ready. Pantheon will keep this product stopped until the local issue is repaired and proven.</p></div>${badge("Needs repair", "coral")}</div></section>`;
    }
    if (["cancelled", "stopped_after_correction", "stopped_unknown_outcome"].includes(journeyStatus)) {
      return `<section class="priority-panel clear"><div class="priority-header"><div><span class="eyebrow">Important work</span><h2>No decision is waiting</h2><p>Review the stopped journey before starting another proof.</p></div>${badge("Proof stopped", "coral")}</div></section>`;
    }
    return `<section class="priority-panel clear"><div class="priority-header"><div><span class="eyebrow">Important work</span><h2>Pantheon is working without needing you</h2></div>${badge("No action needed", "mint")}</div></section>`;
  }
  const onlyWaitingToStart = items.every((item) => item.type === "queued_work");
  const onlyAccountingNotes = items.every((item) => item.type === "unknown_outcomes_summary");
  return `<section class="priority-panel">
    <div class="priority-header"><div><span class="eyebrow">${onlyAccountingNotes ? "Important record" : "Needs you now"}</span><h2>${onlyAccountingNotes ? (items.length === 1 ? "One item to review" : `${items.length} items to review`) : items.length === 1 ? "One item needs you" : `${items.length} items need you`}</h2></div>${onlyWaitingToStart ? badge("Ready to start", "amber") : onlyAccountingNotes ? badge("Accounting note", "amber") : badge("Your decision", "coral")}</div>
    <div class="priority-list">${items.map((item) => `<article class="work-item">
      <span class="risk-bar ${escapeHtml(item.risk || "medium")}"></span>
      <div class="work-copy">${item.attentionLabel ? `<span class="work-state">${escapeHtml(item.attentionLabel)}</span>` : ""}<h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(compact(item.recommendation, 260))}</p>${item.expectedUpside ? `<small>${escapeHtml(compact(item.expectedUpside, 180))}</small>` : ""}</div>
      ${item.type === "decision"
        ? decisionReviewButton(item)
        : ["queued_work", "approved_work"].includes(item.type)
          ? `<button class="primary-button" data-action="run-task" data-id="${escapeHtml(item.id)}" data-execution-kind="${escapeHtml(item.execution_kind || "internal")}">${icon("play")}${escapeHtml(item.run_label || "Run internal step")}${Number(item.max_cost_cents || 0) > 0 ? ` / up to ${money(item.max_cost_cents)}` : ""}</button>`
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
  const discovery = data.commercialDiscovery || {};
  const portfolio = discovery.portfolio || {};
  const journey = data.currentJourney;
  const validation = data.buyerIntentValidation;
  const currentTestValidation = validation?.experimentId
    && validation.experimentId === data.currentTest?.id
    ? validation
    : null;
  const validationMeasurement = currentTestValidation?.measurement || {};
  const terminalRetainedTest = test?.retainedTerminal === true;
  const retainedExposureTarget = Number(validationMeasurement.exposureTarget);
  const retainedDurationDays = Number(validationMeasurement.durationDays);
  const retainedTestWindow = currentTestValidation
    ? retainedExposureTarget > 0 && retainedDurationDays > 0
      ? `${retainedExposureTarget} qualified visits or ${retainedDurationDays} days`
      : "The exact test window was not recorded."
    : null;
  const retainedEvidenceTruth = terminalRetainedTest
    ? Number(test.marketResultCount || 0) > 0
      ? `${Number(test.marketResultCount)} retained market-result record${Number(test.marketResultCount) === 1 ? "" : "s"}; no market test is running now.`
      : "No market test is running. No listing, visit, order, refund, or contribution result was recorded."
    : null;
  const topOpportunity = discovery.topOpportunity;
  const productionPlan = discovery.production?.plans?.[0] || null;
  const journeyMoneyMove = journey?.status === "stopped_after_correction"
    ? "Review the recorded product-quality finding before starting a clean proof."
    : journey?.status === "stopped_unknown_outcome"
      ? "Reconcile the uncertain AI result before starting any further paid work."
      : journey?.status === "waiting_for_operator" || journey?.status === "needs_attention"
        ? "Complete the one journey decision shown in Important Work."
        : journey?.status === "running"
          ? `Pantheon is completing ${humanStatus(journey.activeStage).toLowerCase()}.`
          : journey?.status === "completed" || journey?.activeStage === "ready_to_publish"
            ? "Review the complete publication-ready package and its final brief."
            : null;
  const validationMoneyMove = validation?.status === "stopped_permanently"
    ? "Keep this build stopped. A future product attempt would require a separate commercial decision and a new evidence-bound plan."
    : validation?.status === "waiting_for_final_review_decision"
    ? validation.inspectionEvidenceRecheck
      ? `Decide whether to spend up to ${money(validation.finalReviewCapCents)} on one evidence recheck of the unchanged customer package.`
      : `Decide whether to spend up to ${money(validation.finalReviewCapCents)} on one final independent check of the corrected customer files.`
    : validation?.status === "final_review_running"
      ? "Wait for the independent file check; no marketplace action is authorised."
      : validation?.status === "final_review_queued"
        ? "Let the already-approved internal evidence check run once; do not create another approval or retry."
      : validation?.status === "buyer_test_ready"
        ? `Review the exact buyer-test plan before creating an account, listing, or publishing on ${validationPlatform(validation)}.`
        : validation?.status === "product_needs_attention"
          ? "Let Jarvis verify whether the retained quality failure is eligible for an exact zero-spend local repair; otherwise keep the build stopped."
        : validation
          ? "Let Pantheon finish the bounded product and quality checks before any market action."
          : null;
  const nextMoneyMove = validationMoneyMove || journeyMoneyMove || (productionPlan?.status === "waiting_for_build_decision"
    ? `Decide whether Pantheon should build the ${productionPlan.target_item_count}-product catalogue.`
    : productionPlan?.status === "quality_review"
      ? "Pantheon is checking the finished product files before launch preparation."
      : productionPlan?.status === "preparing_launch"
        ? "Pantheon is preparing truthful listing copy and the first measured market test."
        : productionPlan?.status === "launch_decision"
          ? "Review the finished product and launch package."
          : productionPlan?.status === "ready_to_publish"
            ? "Complete the separate Gumroad publishing action shown in Important Work."
            : productionPlan?.status === "requires_capability"
              ? "Choose another executable opportunity or add the missing production capability."
              : topOpportunity?.status === "ready_to_build"
    ? `Decide whether Pantheon should build the ${topOpportunity.title} catalogue.`
    : discovery.activeRound
      ? `${humanStatus(discovery.activeRound.status)} for ${discovery.activeRound.prompt}.`
      : portfolio.nextAction?.label === "No investment selected"
        ? "Review why no candidate qualified; no product work is authorised."
        : data.nextMoneyMove);
  const importantDecisions = data.importantWork.filter((item) => item.type === "decision").length;
  const decisionCount = $("#decision-count");
  decisionCount.textContent = importantDecisions;
  decisionCount.hidden = importantDecisions === 0;
  const teamRows = data.teamPulse.agents
    .filter((agent) => agent.status !== "Standby" || ["chief_of_staff", "demand_validator", "offer_architect", "product_builder"].includes(agent.id))
    .slice(0, 6);

  $("#view").innerHTML = `<div class="view-stack">
    ${data.health?.proofMode ? `<section class="surface-block accent"><span class="eyebrow">System proof mode</span><h2>Luna-only testing is active</h2><p>Pantheon is checking workflow mechanics with the lowest-cost model. These results cannot authorize consequential or external work.</p></section>` : ""}
    ${renderCommandBand(data)}
    ${renderImportantWork(
      data.importantWork,
      Boolean(discovery.activeRound || productionPlan || test || journey || validation),
      journey?.status,
      validation?.status,
    )}
    <section class="money-move">
      <span class="move-icon">${icon("move-right")}</span>
      <div><span class="eyebrow">Next money move</span><h2>${escapeHtml(nextMoneyMove)}</h2><p>Pantheon keeps internal work moving and stops only for a material choice, setup need, or protected external action.</p></div>
      <button class="secondary-button" data-view="portfolio">${icon("briefcase-business")}Open portfolio</button>
    </section>
    ${data.activeRuns?.length ? `<section class="active-run-strip">${sectionHeading("AI working now", "A genuine worker is running. Open the record to follow its plain-language progress.")}${data.activeRuns.map(renderAgentRunRow).join("")}</section>` : ""}
    <section>
      ${sectionHeading(
    "Business position",
    terminalRetainedTest
      ? "No market test is running; the stopped path is retained as evidence."
      : "One venture, one active commercial path, measured by real buyer results.",
  )}
      <div class="metric-grid">
        <div class="metric mint"><span>Active venture</span><strong>${escapeHtml(data.activeVenture.name)}</strong><small>${escapeHtml(humanStatus(data.activeVenture.lifecycle_stage))}</small></div>
        <div class="metric sky"><span>${terminalRetainedTest ? "Retained test" : "Current test"}</span><strong>${test ? escapeHtml(test.name) : "Not started"}</strong><small>${test ? escapeHtml(humanStatus(test.status)) : "Evidence selection comes first"}</small></div>
        <div class="metric ${economics.cashContributionCents >= 0 ? "mint" : "coral"}"><span>Cash contribution</span><strong>${money(economics.cashContributionCents)}</strong><small>${economics.independentBuyers} independent buyer${economics.independentBuyers === 1 ? "" : "s"}</small></div>
        <div class="metric amber"><span>Monthly AI and tool cap</span><strong>${money(spend.monthlyCapCents, spend.currency)}</strong><small>${money(spend.exposureCents, spend.currency)} used or committed; ${money(spend.availableCents, spend.currency)} available</small></div>
      </div>
    </section>
      ${renderWeeklyDigest(data.weeklyDigest)}
      <div class="two-column">
      <section class="section-block">
        ${sectionHeading(
    terminalRetainedTest ? "Retained commercial test" : "Current commercial test",
    terminalRetainedTest
      ? "The stopped test remains visible as evidence. It is not live, runnable, or proof of buyer demand."
      : "What is being tested and what would make it worth continuing.",
  )}
        ${test ? `<div class="surface-block accent test-summary">
          <header><div><span class="eyebrow">${escapeHtml(humanStatus(test.status))}</span><h2>${escapeHtml(currentTestValidation?.name || test.name)}</h2></div></header>
          <p>${escapeHtml(test.hypothesis || "The test hypothesis has not been written yet.")}</p>
          ${retainedEvidenceTruth ? `<p class="muted-text">${escapeHtml(retainedEvidenceTruth)}</p>` : ""}
          <dl><div><dt>Buyer</dt><dd>${escapeHtml(test.buyer || data.ventureCase.buyer)}</dd></div><div><dt>Offer</dt><dd>${escapeHtml(test.offer || data.ventureCase.offer)}</dd></div><div><dt>Price</dt><dd>${money(currentTestValidation?.priceCents || test.price_cents)}</dd></div><div><dt>Channel</dt><dd>${escapeHtml(currentTestValidation?.channel?.label || test.channel || "Not selected")}</dd></div>${retainedTestWindow ? `<div><dt>Test window</dt><dd>${escapeHtml(retainedTestWindow)}</dd></div>` : ""}<div><dt>Pass rule</dt><dd>${escapeHtml(validationMeasurement.passRule || test.expected_metric || data.ventureCase.expected_metric)}</dd></div>${validationMeasurement.reviseRule ? `<div><dt>Revise rule</dt><dd>${escapeHtml(validationMeasurement.reviseRule)}</dd></div>` : ""}${validationMeasurement.inconclusiveRule ? `<div><dt>Low reach</dt><dd>${escapeHtml(validationMeasurement.inconclusiveRule)}</dd></div>` : ""}<div><dt>Stop rule</dt><dd>${escapeHtml(validationMeasurement.stopRule || data.ventureCase.kill_rule)}</dd></div></dl>
          ${terminalRetainedTest ? "" : `<button class="text-button" data-action="open-drawer" data-kind="test" data-id="${escapeHtml(test.id)}">Review the full test ${icon("arrow-right")}</button>`}
        </div>` : emptyState("No market test is running", "The team is still selecting and validating the first investable opportunity.", "flask-conical")}
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
  const tabs = [["candidate", "Pre-venture"], ["ready", "Ready"], ["running", "Running"], ["completed", "Results"], ["cancelled", "Stopped"]];
  return `<div class="view-tabs">${tabs.map(([id, label]) => {
    const count = id === "candidate"
      ? Number(data.opportunities?.length || 0) + Number(data.tests[id]?.length || 0)
      : data.tests[id]?.length || 0;
    return `<button class="${store.testTab === id ? "active" : ""}" data-action="test-tab" data-tab="${id}">${label}<span> ${count}</span></button>`;
  }).join("")}</div>`;
}

function productionStage(plan, currentTask) {
  if (!plan) return {
    label: "Opportunity selection",
    detail: "Research, demand and economics must pass before product work begins.",
    tone: "sky",
  };
  if ([
    "inspection_evidence_recheck_failed_terminal",
    "inspection_evidence_recheck_declined_terminal",
  ].includes(plan.metadata?.buildStatus)) {
    return {
      label: "Permanently stopped",
      detail: "The single evidence recheck did not pass or was declined. No retry, revision, or additional spend is available for this build.",
      tone: "coral",
      status: "stopped_permanently",
    };
  }
  const productionTask = currentTask?.payload?.liveSpendRequest?.parameters
    ?.pantheonProduction || {};
  const stages = {
    waiting_for_build_decision: {
      label: "Build decision",
      detail: `The ${plan.target_item_count}-product catalogue is planned. Product files have not been created yet.`,
      tone: "amber",
    },
    building: {
      label: "Building products",
      detail: currentTask?.title || "Product Builder is creating and retaining the exact local files.",
      tone: "sky",
    },
    rebuilding: {
      label: "Correcting products",
      detail: currentTask?.title || "Pantheon is correcting a product package that did not pass review.",
      tone: "amber",
    },
    quality_review: {
      label: "Quality review",
      detail: "The product files exist and are being checked for completeness, usefulness, and claim safety.",
      tone: "sky",
    },
    preparing_launch: {
      label: "Preparing launch",
      detail: "The products passed review. Listing copy and the measured first-market test are being prepared.",
      tone: "mint",
    },
    launch_decision: {
      label: "Launch decision",
      detail: "The product and launch package are ready. Nothing is public yet.",
      tone: "amber",
    },
    ready_to_publish: {
      label: "Ready to publish",
      detail: "The internal package is complete. The separate Gumroad action still needs to happen.",
      tone: "mint",
    },
    requires_capability: {
      label: "Production capability needed",
      detail: "Pantheon stopped honestly because this product type needs a production pipeline that is not yet connected.",
      tone: "coral",
    },
    needs_attention: {
      label: "Needs review",
      detail: "The corrected product package still has a material quality issue.",
      tone: "coral",
    },
  };
  if (plan.status === "quality_review") {
    if (productionTask.inspectionEvidenceRecheck === true) {
      if (currentTask?.status === "running") {
        return {
          label: "Evidence recheck underway",
          detail: "Terra is checking the unchanged package through the complete setup-guide inspection and the other three exact local images.",
          tone: "sky",
        };
      }
      if (["blocked", "waiting_approval"].includes(currentTask?.status)) {
        return {
          label: "Evidence recheck decision",
          detail: "The one complete-inspection recheck is waiting for Daniel's exact decision. No model call has started.",
          tone: "amber",
        };
      }
      if (["queued", "planned"].includes(currentTask?.status)) {
        return {
          label: "Evidence recheck approved",
          detail: "The exact four-image recheck is approved and waiting to start once. No fallback or second retry is available.",
          tone: "sky",
        };
      }
    }
    return {
      ...stages.quality_review,
      detail: currentTask?.status === "running"
        ? "The product files are undergoing the exact independent quality review."
        : "The product files exist; the independent quality review is waiting for its exact next step.",
    };
  }
  if (
    currentTask?.status === "running"
    && productionTask.stage === "product_build"
  ) return stages.building;
  return stages[plan.status] || {
    label: humanStatus(plan.status),
    detail: currentTask?.title || "Pantheon has retained the current production state.",
    tone: "sky",
  };
}

function portfolioTabs() {
  const tabs = [
    ["opportunities", "Opportunities"],
    ["investment", "Investment cases"],
    ["knowledge", "Business knowledge"],
    ["services", "Research services"],
  ];
  return `<div class="view-tabs portfolio-tabs" role="tablist" aria-label="Portfolio views">${tabs.map(([id, label]) => (
    `<button role="tab" aria-selected="${store.portfolioTab === id}" class="${store.portfolioTab === id ? "active" : ""}" data-action="portfolio-tab" data-tab="${id}">${escapeHtml(label)}</button>`
  )).join("")}</div>`;
}

function portfolioNextAction(data) {
  const active = data.activeRound;
  const task = data.currentTask;
  if (active) {
    const needsAttention = ["needs_attention", "failed"].includes(task?.status);
    const running = task?.status === "running";
    return `<section class="portfolio-now">
      <div class="portfolio-now-mark ${running ? "running" : needsAttention ? "attention" : ""}">${icon(running ? "loader-circle" : needsAttention ? "triangle-alert" : "radar")}</div>
      <div>
        <span class="eyebrow">${needsAttention ? "Needs attention" : "Current work"}</span>
        <h2>${escapeHtml(task?.title || humanStatus(active.status))}</h2>
        <p>${running
          ? "Pantheon is completing this internal research now."
          : needsAttention
            ? "The AI response was received but could not be accepted. Pantheon has not treated it as evidence."
            : "Pantheon has retained the evidence so far and is ready for the next internal step."}</p>
      </div>
      ${running
        ? badge("running", "sky")
        : needsAttention
          ? `<button class="primary-button" data-action="prepare-portfolio-retry" data-id="${escapeHtml(task.id)}">${icon("rotate-cw")}Prepare one correction</button>`
          : `<button class="primary-button" data-action="continue-portfolio">${icon("play")}Continue research</button>`}
    </section>`;
  }
  if (data.nextAction?.action === "start_portfolio_discovery") {
    return `<section class="portfolio-now">
      <div class="portfolio-now-mark">${icon("telescope")}</div>
      <div>
        <span class="eyebrow">Next step</span>
        <h2>${escapeHtml(data.nextAction.label)}</h2>
        <p>${escapeHtml(data.nextAction.detail)}</p>
      </div>
      <button class="primary-button" data-action="start-portfolio-discovery">${icon("radar")}Find opportunities</button>
    </section>`;
  }
  return `<section class="portfolio-now">
    <div class="portfolio-now-mark ${data.selectedInvestmentCase ? "complete" : ""}">${icon(data.selectedInvestmentCase ? "badge-check" : "pause")}</div>
    <div>
      <span class="eyebrow">${data.selectedInvestmentCase ? "Investment review complete" : "Research complete"}</span>
      <h2>${escapeHtml(data.nextAction?.label || "No action needed")}</h2>
      <p>${escapeHtml(data.nextAction?.detail || "Pantheon has retained the result.")}</p>
    </div>
    ${data.selectedInvestmentCase
      ? `<button class="secondary-button" data-action="open-drawer" data-kind="investment-case" data-id="${escapeHtml(data.selectedInvestmentCase.id)}">${icon("file-check-2")}Review the case</button>`
      : ""}
  </section>`;
}

function portfolioOpportunityList(data) {
  const opportunities = data.opportunities || [];
  if (!opportunities.length) {
    return emptyState(
      data.activeRound ? "The market scan is underway" : "No portfolio research yet",
      data.activeRound
        ? "Five opportunity spaces will appear here after the current research step finishes."
        : "Pantheon has not started the bounded market scan.",
      "search",
    );
  }
  return `<div class="portfolio-list">${opportunities.map((item, index) => {
    const validation = item.metadata?.validation || {};
    const sourceCount = Array.isArray(validation.sources) ? validation.sources.length : Number(item.evidence_ids?.length || 0);
    const hypothesisOnly = item.source_type === "model_hypothesis" && sourceCount === 0;
    return `<button class="portfolio-row" data-action="open-drawer" data-kind="portfolio-opportunity" data-id="${escapeHtml(item.id)}">
      <span class="portfolio-rank">${String(index + 1).padStart(2, "0")}</span>
      <span class="portfolio-main">
        <span class="eyebrow">${escapeHtml(humanStatus(item.business_model || "online business"))} / ${escapeHtml(item.geography || "global")}</span>
        <strong>${escapeHtml(item.title)}</strong>
        <small>${escapeHtml(compact(item.problem, 150))}</small>
      </span>
      <span class="portfolio-evidence"><strong>${hypothesisOnly ? "Idea" : sourceCount}</strong><small>${hypothesisOnly ? "hypothesis only" : "sources retained"}</small></span>
      <span class="portfolio-score"><strong>${Number(item.overall_score || 0)}</strong><small>discovery score</small></span>
      ${badge(item.status)}
      ${icon("chevron-right")}
    </button>`;
  }).join("")}</div>`;
}

function investmentCaseList(data) {
  const cases = data.investmentCases || [];
  if (!cases.length) {
    return emptyState(
      "No investment case yet",
      "Three finalists must complete demand and financial review before a case can be judged.",
      "file-search-2",
    );
  }
  return `<div class="portfolio-list">${cases.map((item) => {
    const criteria = Object.values(item.criteria || {});
    const passed = criteria.filter((criterion) => criterion.passed).length;
    return `<button class="portfolio-row investment-row" data-action="open-drawer" data-kind="investment-case" data-id="${escapeHtml(item.id)}">
      <span class="portfolio-main">
        <span class="eyebrow">${escapeHtml(humanStatus(item.status))}</span>
        <strong>${escapeHtml(item.offer || item.problem || "Commercial investment case")}</strong>
        <small>${escapeHtml(compact(item.rationale || item.next_action, 150))}</small>
      </span>
      <span class="portfolio-evidence"><strong>${passed}/${criteria.length || 10}</strong><small>requirements passed</small></span>
      ${badge(item.recommendation)}
      ${icon("chevron-right")}
    </button>`;
  }).join("")}</div>`;
}

function commercialKnowledgePanel(data) {
  const knowledge = data.commercial?.knowledge || {};
  const results = store.commercialSearch?.results || [];
  return `<div class="view-stack">
    <section class="knowledge-summary">
      <div><span>Reviewed principles</span><strong>${Number(knowledge.propositionCount || 0)}</strong><small>Across 12 commercial areas</small></div>
      <div><span>Authoritative sources</span><strong>${Number(knowledge.sourceCount || 0)}</strong><small>Source and review dates retained</small></div>
      <div><span>Retrieval method</span><strong>Focused search</strong><small>Only relevant records reach each worker</small></div>
    </section>
    <section>
      ${sectionHeading("Search the business library", "Use ordinary language. Results show the rule, where it applies, and its limits.")}
      <form class="knowledge-search" data-action="commercial-search">
        <input id="commercial-query" type="search" placeholder="For example: pricing a new Australian digital product" value="${escapeHtml(store.commercialSearch?.query || "")}" aria-label="Search commercial knowledge">
        <button class="secondary-button" type="submit">${icon("search")}Search</button>
      </form>
      ${store.commercialSearch
        ? results.length
          ? `<div class="knowledge-results">${results.map((item) => `<article>
              <header><div><span class="eyebrow">${escapeHtml(humanStatus(item.domain))} / ${escapeHtml(item.jurisdiction || "General")}</span><h3>${escapeHtml(item.title)}</h3></div>${badge(item.confidence)}</header>
              <p>${escapeHtml(item.proposition)}</p>
              <small><strong>Use when:</strong> ${escapeHtml(item.applicability)}</small>
              <small><strong>Limits:</strong> ${escapeHtml(item.limitations)}</small>
              ${item.source?.url ? `<a href="${escapeHtml(safeExternalUrl(item.source.url) || "#")}" target="_blank" rel="noreferrer">Open source ${icon("external-link")}</a>` : ""}
            </article>`).join("")}</div>`
          : emptyState("No close match", "Try a shorter question or a different commercial term.", "search-x")
        : ""}
    </section>
  </div>`;
}

function serviceTrialsPanel(data) {
  const trialState = data.serviceTrials || { policy: {}, trials: [] };
  const trials = trialState.trials || [];
  return `<div class="view-stack">
    <section class="policy-line">
      <div><span>Per-service ceiling</span><strong>${money(trialState.policy?.perServiceCapCents || 2500)}</strong></div>
      <p>Pantheon tests a paid research service only when public sources leave a decision-critical gap. Account setup and new terms still come to you once.</p>
    </section>
    <section>
      ${sectionHeading("Research service trials", "Each trial must beat the public-data baseline on evidence quality and useful cost.")}
      ${trials.length
        ? `<div class="portfolio-list">${trials.map((trial) => `<button class="portfolio-row investment-row" data-action="open-drawer" data-kind="service-trial" data-id="${escapeHtml(trial.id)}">
            <span class="portfolio-main"><span class="eyebrow">${escapeHtml(trial.vendor)}</span><strong>${escapeHtml(trial.serviceName)}</strong><small>${escapeHtml(compact(trial.hypothesis, 150))}</small></span>
            <span class="portfolio-evidence"><strong>${money(trial.actualCostCents ?? trial.capCents)}</strong><small>${trial.actualCostCents === null ? "maximum" : "actual cost"}</small></span>
            ${badge(trial.status)}
            ${icon("chevron-right")}
          </button>`).join("")}</div>`
        : emptyState("No paid service is justified", "Pantheon will propose one only when a public-data gap blocks a real investment decision.", "receipt")}
    </section>
  </div>`;
}

function renderPortfolio() {
  const data = store.data.portfolio || {};
  const roundCount = Number(data.evidenceRoundCount || 0);
  const technicalRoundCount = Number(data.technicalFailureCount || 0);
  const body = store.portfolioTab === "investment"
    ? `<section>${sectionHeading("Investment cases", "Pantheon can recommend no investment. Every requirement must be supported before production.")}${investmentCaseList(data)}</section>`
    : store.portfolioTab === "knowledge"
      ? commercialKnowledgePanel(data)
      : store.portfolioTab === "services"
        ? serviceTrialsPanel(data)
        : `<div class="view-stack">
            <section class="portfolio-metrics">
              <div><span>Evidence rounds</span><strong>${roundCount}/2</strong><small>${technicalRoundCount ? `${technicalRoundCount} technical stop${technicalRoundCount === 1 ? "" : "s"} retained in System` : "Maximum before your review"}</small></div>
              <div><span>Opportunity spaces</span><strong>${Number(data.opportunities?.length || 0)}</strong><small>Five required per round</small></div>
              <div><span>Finalists</span><strong>${Number(data.activeRound?.metadata?.validationQueueIds?.length || 0)}</strong><small>Three receive comparable checks</small></div>
              <div><span>Production</span><strong>Not started</strong><small>This goal ends at an investment case</small></div>
            </section>
            <section>${sectionHeading("Market opportunities", "Pantheon compares business models on evidence and economics, not on what it already knows how to build.")}${portfolioOpportunityList(data)}</section>
          </div>`;
  $("#view").innerHTML = `<div class="view-stack">${portfolioNextAction(data)}${portfolioTabs()}${body}</div>`;
}

function renderTests() {
  const data = store.data.tests;
  const items = data.tests[store.testTab] || [];
  const buyerIntentValidation = data.buyerIntentValidation || null;
  const latestPlan = data.cataloguePlans?.[0];
  const production = data.production || {};
  const productionPlan = production.plans?.find((plan) => plan.id === latestPlan?.id)
    || production.plans?.[0]
    || latestPlan;
  const buyerIntentPlanMatches = (
    buyerIntentValidation?.planId
    && buyerIntentValidation.planId === productionPlan?.id
  );
  const buyerIntentMeasurement = buyerIntentPlanMatches
    ? buyerIntentValidation.measurement || null
    : null;
  const buyerIntentBoundaryTerminal = buyerIntentPlanMatches
    && buyerIntentValidation.terminal === true;
  const opportunities = data.opportunities || [];
  const opportunityBody = opportunities.length ? `<div class="opportunity-list">${opportunities.map((item, index) => `<article class="opportunity-row">
    <div class="opportunity-rank">${String(index + 1).padStart(2, "0")}</div>
    <div class="opportunity-copy">
      <span class="eyebrow">${escapeHtml(item.business_model)} / ${escapeHtml(item.geography)}</span>
      <h3>${escapeHtml(item.title)}</h3>
      <p>${escapeHtml(item.problem)}</p>
      <small>${escapeHtml(item.buyer)} via ${escapeHtml(item.channel)}</small>
    </div>
    <div class="opportunity-score"><strong>${Number(item.overall_score || 0)}</strong><span>score</span>${badge(item.status)}</div>
  </article>`).join("")}</div>` : `<div class="empty-action-state">${emptyState(
    data.opportunityRounds?.some((round) => ["researching", "validating", "checking_economics", "structuring_offer"].includes(round.status))
      ? "Pantheon is researching now"
      : "No opportunities have been researched",
    data.opportunityRounds?.length
      ? "The ranked shortlist will appear here after the current AI worker finishes."
      : "Start a broad commercial scan here or give Pantheon a particular idea from the Command Center.",
    "radar",
  )}${data.opportunityRounds?.length ? "" : `<button class="primary-button" data-action="start-discovery" data-mode="broad">${icon("radar")}Find opportunities</button>`}</div>`;
  const itemCards = items.length ? `<div class="card-grid">${items.map((item) => `<article class="item-card">
    <header><div><span class="eyebrow">${item.preVenture ? "Pre-venture buyer test" : escapeHtml(humanStatus(item.status))}</span><h3>${escapeHtml(item.name)}</h3></div>${badge(item.workflowStatus || item.status)}</header>
    <p>${escapeHtml(item.hypothesis || "Hypothesis needs to be defined.")}</p>
    <div class="detail-grid"><div><span>Buyer</span><strong>${escapeHtml(item.buyer || "Not selected")}</strong></div><div><span>Test price</span><strong>${money(item.price_cents)}</strong></div><div><span>Channel</span><strong>${escapeHtml(item.channel || "Not selected")}</strong></div><div><span>${item.preVenture ? "External test cap" : "Cost cap"}</span><strong>${money(item.cost_cap_cents)}</strong></div></div>
    <footer>${badge(item.workflowStatus || item.status)}<button class="text-button" data-action="open-drawer" data-kind="test" data-id="${escapeHtml(item.id)}">Open test ${icon("arrow-right")}</button></footer>
  </article>`).join("")}</div>` : "";
  const testsBody = store.testTab === "candidate"
    ? `${itemCards}${opportunityBody}`
    : itemCards || emptyState(
    `No tests are ${store.testTab}`,
    "A test will move here only when a real commercial action or result justifies the change.",
    "flask-conical",
  );
  const economics = data.economics || {};
  const usesGumroadResults = items.some((item) => (
    /gumroad/i.test(String(item.channel || ""))
  ));
  const resultsPanel = store.testTab === "completed" ? `<section class="section-block">
    ${sectionHeading(
      usesGumroadResults ? "Gumroad results" : "Sales results",
      "Measured sales, platform fees and refunds determine whether the commercial test proved itself.",
    )}
    <div class="metric-grid">
      <div class="metric sky"><span>Gross sales</span><strong>${money(economics.grossRevenueCents, economics.salesCurrency || "AUD")}</strong><small>${economics.independentBuyers || 0} independent buyers</small></div>
      <div class="metric amber"><span>Platform fees</span><strong>${money(economics.platformFeesCents, economics.salesCurrency || "AUD")}</strong><small>${usesGumroadResults ? "Imported from Gumroad" : "Recorded from verified platform evidence"}</small></div>
      <div class="metric coral"><span>Refunds</span><strong>${money(economics.refundsCents, economics.salesCurrency || "AUD")}</strong><small>Full and partial refunds</small></div>
      <div class="metric mint"><span>Cash contribution</span><strong>${economics.currencyMismatch ? "Needs currency review" : money(economics.cashContributionCents, economics.salesCurrency || "AUD")}</strong><small>${economics.successThresholdMet ? "First proof reached" : "Target: 3 buyers and positive contribution"}</small></div>
    </div>
    ${usesGumroadResults ? `<div class="import-panel">
      <div><span class="section-label">Update measured results</span><h3>Import Gumroad sales</h3></div>
      <input id="gumroad-csv" type="file" accept=".csv,text/csv" aria-label="Choose Gumroad sales CSV">
      <button class="secondary-button" data-action="import-gumroad" data-venture-id="${escapeHtml(data.activeVenture.id)}">${icon("file-up")}Import sales</button>
    </div>` : `<div class="stage-callout neutral"><div><span class="section-label">Verified result entry</span><h3>Use the channel's retained export or receipt</h3><p>Pantheon will show a channel-specific importer only after that adapter is registered and tested.</p></div></div>`}
  </section>` : "";
  const latestRound = data.opportunityRounds?.[0];
  const stage = productionStage(productionPlan, production.currentTask);
  const activeDiscoveryRound = latestRound
    && ["researching", "validating", "checking_economics", "structuring_offer"].includes(latestRound.status);
  const hasProductionContinuation = Boolean(
    productionPlan
    && (
      buyerIntentPlanMatches
      || !["complete", "completed", "cancelled", "archived"].includes(productionPlan.status)
    )
  );
  const runnableInternalTask = production.currentTask
    && ["planned", "queued"].includes(production.currentTask.status);
  $("#view").innerHTML = `<div class="view-stack">
    ${testTabs(data)}
    <section>${sectionHeading(
      store.testTab === "candidate" ? "Pre-venture opportunities and tests" : store.testTab === "completed" ? "Results" : `${humanStatus(store.testTab)} tests`,
      store.testTab === "candidate"
        ? "Ranked from attributable research, then narrowed by demand, economics and execution fit."
        : "Tests move only when a real-world action or result justifies the change.",
    )}${testsBody}</section>
    ${store.testTab === "candidate" ? `<section class="section-block">${sectionHeading("Current commercial stage", "Pantheon handles the internal analysis and shows the exact point it has reached.")}
      <div class="detail-grid">
        <div><span>Latest round</span><strong>${escapeHtml(humanStatus(latestRound?.status || "not started"))}</strong></div>
        <div><span>Catalogue</span><strong>${latestPlan ? `${latestPlan.target_item_count} products` : "Not ready"}</strong></div>
        <div><span>Research mode</span><strong>${escapeHtml(humanStatus(latestRound?.mode || "broad discovery"))}</strong></div>
        <div><span>Production stage</span><strong>${escapeHtml(stage.label)}</strong></div>
      </div>
      ${latestPlan ? `<div class="stage-callout ${escapeHtml(stage.tone)}"><div><span class="section-label">What is happening</span><h3>${escapeHtml(stage.label)}</h3><p>${escapeHtml(stage.detail)}</p></div>${badge(stage.status || latestPlan.status, stage.tone)}</div>` : ""}
      ${activeDiscoveryRound && !hasProductionContinuation ? `<button class="primary-button" data-action="run-pantheon">${icon("play")}Continue Pantheon now</button>` : ""}
      ${productionPlan && ["quality_review", "preparing_launch"].includes(productionPlan.status) && runnableInternalTask ? `<button class="primary-button" data-action="run-pantheon">${icon("play")}Continue internal work</button>` : ""}
      ${productionPlan && ["launch_decision", "waiting_for_build_decision"].includes(productionPlan.status) ? `<button class="secondary-button" data-view="decisions">${icon("check-square")}Open the decision</button>` : ""}
      ${productionPlan?.status === "ready_to_publish" ? `<button class="secondary-button" data-action="open-outputs">${icon("files")}Open product and launch files</button>` : ""}
    </section>
    <section class="section-block">${sectionHeading(
      buyerIntentBoundaryTerminal ? "Retained stopped-test rules" : "First-test boundaries",
      buyerIntentBoundaryTerminal
        ? "These were the exact 30-day and 100-visit rules for the stopped build. They are retained as evidence, not an active test."
        : "The first venture earns expansion through measured buyer proof.",
    )}${buyerIntentMeasurement
      ? `<div class="detail-grid"><div><span>Test window</span><strong>${Number(buyerIntentMeasurement.durationDays || 30)} days or ${Number(buyerIntentMeasurement.exposureTarget || 100)} qualified visits</strong></div><div><span>Success</span><strong>${escapeHtml(buyerIntentMeasurement.passRule)}</strong></div><div><span>Revise</span><strong>${escapeHtml(buyerIntentMeasurement.reviseRule)}</strong></div><div><span>Stop or park</span><strong>${escapeHtml(buyerIntentMeasurement.stopRule)}</strong></div></div>`
      : `<div class="detail-grid"><div><span>Test window</span><strong>${data.pilotPolicy.testDurationDays || 14} days or ${data.pilotPolicy.qualifiedViewTarget || 50} qualified views</strong></div><div><span>Success</span><strong>${data.pilotPolicy.successBuyers || 3} paid buyers and positive contribution</strong></div><div><span>Organic limit</span><strong>${data.pilotPolicy.organicPostLimit || 3} posts across ${data.pilotPolicy.organicChannelLimit || 2} channels</strong></div><div><span>Optional paid test</span><strong>${money(data.pilotPolicy.optionalPaidTestCents || 2500)} with your approval</strong></div></div>`}</section>` : ""}
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
    return runs.filter((run) => (
      run.status === "completed"
      && !run.attentionRequired
      && !["protected_rehearsal", "deterministic_system_step"].includes(run.executionKind)
    ));
  }
  return runs.filter((run) => run.executionKind === store.runFilter);
}

function groupedAgentRuns(state, runs) {
  const groupFacts = new Map((state?.workGroups || []).map((group) => [group.id, group]));
  const groups = new Map();
  runs.forEach((run) => {
    const identity = run.workGroup || {
      id: `run-${run.id}`,
      label: run.taskTitle,
      scopeType: "task",
      versioned: false,
    };
    const group = groups.get(identity.id) || {
      ...(groupFacts.get(identity.id) || identity),
      runs: [],
    };
    group.runs.push(run);
    groups.set(identity.id, group);
  });
  return [...groups.values()];
}

function renderAgentRunGroup(group) {
  const activeCount = group.runs.filter((run) => run.active).length;
  const reviewCount = group.runs.filter((run) => run.attentionRequired).length;
  const state = activeCount ? "working" : reviewCount ? "needs_review" : "completed";
  const workers = [...new Set(group.runs.map((run) => run.workerName))];
  const latest = group.runs
    .map((run) => run.updatedAt)
    .filter(Boolean)
    .sort()
    .at(-1);
  return `<section class="run-group">
    <header class="run-group-header">
      <div><span class="section-label">Related work</span><h3>${escapeHtml(group.label || "AI work")}</h3><p>${group.runs.length} step${group.runs.length === 1 ? "" : "s"} / ${workers.length} worker${workers.length === 1 ? "" : "s"}${latest ? ` / Updated ${escapeHtml(dateTime(latest))}` : ""}</p></div>
      ${badge(state, state === "completed" ? "mint" : state === "working" ? "sky" : "amber")}
    </header>
    <div class="run-list">${group.runs.map(renderAgentRunRow).join("")}</div>
  </section>`;
}

function renderAgentRunRow(run) {
  const protectedRun = ["protected_rehearsal", "deterministic_system_step"].includes(run.executionKind);
  const providerNotContacted = run.executionKind === "provider_not_contacted"
    || run.providerAttempted === false;
  const actualTokens = run.actualTokens?.total === null || run.actualTokens?.total === undefined
    ? "Not captured"
    : `${tokenCount(run.actualTokens.total)} tokens`;
  const cost = protectedRun || providerNotContacted
    ? "No provider charge"
    : run.cost?.actualCents === null || run.cost?.actualCents === undefined
      ? Number(run.cost?.estimatedCents || 0) > 0
        ? `About ${money(run.cost.estimatedCents, run.cost.currency)}; final bill pending`
        : "Cost not captured"
      : `${money(run.cost.actualCents, run.cost.currency)} ${humanStatus(run.cost.status)}`;
  const approvedCeiling = Number(run.cost?.plannedCapCents || 0) > 0
    ? `Approved ceiling ${money(run.cost.plannedCapCents, run.cost.currency)}`
    : "No approved ceiling recorded";
  const selected = store.drawerState?.kind === "agent-run" && store.drawerState.id === run.id;
  return `<button class="run-row${selected ? " selected" : ""}" data-action="open-drawer" data-kind="agent-run" data-id="${escapeHtml(run.id)}" aria-current="${selected ? "true" : "false"}">
    <span class="run-kind-icon ${escapeHtml(run.executionKind)}">${icon(protectedRun ? "shield-check" : run.executionKind === "provider_outcome_unknown" ? "triangle-alert" : run.active ? "loader-circle" : "sparkles")}</span>
    <span class="run-main"><span class="run-title-line"><strong>${escapeHtml(run.taskTitle)}</strong>${badge(run.executionKind)}</span><small>${escapeHtml(run.workerName)} / ${escapeHtml(dateTime(run.startedAt))}</small>${run.currentStage && run.active ? `<em>${escapeHtml(run.currentStage.title)}</em>` : ""}</span>
    <span class="run-facts"><span>${badge(run.status)} ${badge(
      run.receipt?.status === "complete"
        ? "Record complete"
        : run.receipt?.status === "recording"
          ? "Saving record"
          : "Check record",
      run.receipt?.status === "complete" ? "mint" : run.receipt?.status === "recording" ? "sky" : "amber",
    )}</span><small>${escapeHtml(actualTokens)}</small><small>${escapeHtml(cost)}</small><small>${escapeHtml(approvedCeiling)}</small></span>
    ${icon("chevron-right")}
  </button>`;
}

function renderLiveRuns(data) {
  const state = data.liveRuns || { counts: {}, runs: [] };
  const counts = state.counts || {};
  const runs = filteredAgentRuns(state);
  const workGroups = groupedAgentRuns(state, runs);
  const activeRuns = (state.runs || []).filter((run) => (
    run.active
    && !["protected_rehearsal", "deterministic_system_step"].includes(run.executionKind)
  ));
  const filters = [
    ["running", "Running"],
    ["review", "Needs your review"],
    ["completed", "Completed"],
    ["protected_rehearsal", "Internal rehearsals"],
    ["deterministic_system_step", "System-generated steps"],
    ["all", "All records"],
  ];
  return `<div class="view-stack live-runs-view">
    <section class="run-metrics" aria-label="AI run summary">
      <div><span>Running now</span><strong>${activeRuns.length}</strong></div>
      <div><span>OpenAI runs</span><strong>${Number(counts.modelBacked || 0)}</strong></div>
      <div><span>Need review</span><strong>${Number(counts.needsReview || 0)}</strong></div>
      <div><span>Reconciled AI cost</span><strong>${money(counts.reconciledCostCents || 0)}</strong></div>
    </section>
    ${activeRuns.length ? `<section class="active-run-strip">${sectionHeading("Working now", "These are genuine AI executions currently in progress.")}${activeRuns.map(renderAgentRunRow).join("")}</section>` : ""}
    <section>
      ${sectionHeading("Run history", "See what genuinely used OpenAI, what stayed internal, and what requires reconciliation.")}
      <div class="run-filters" role="group" aria-label="Filter AI runs">${filters.map(([id, label]) => `<button class="${store.runFilter === id ? "active" : ""}" data-action="run-filter" data-filter="${id}">${escapeHtml(label)}</button>`).join("")}</div>
      <div class="run-groups">${runs.length ? workGroups.map(renderAgentRunGroup).join("") : `<div class="run-list">${emptyState(
        store.runFilter === "running" ? "No AI work is running" : "No runs match this view",
        store.runFilter === "running" ? "Genuine AI work will appear here while it is in progress." : "Choose another run view to inspect the available records.",
        "activity",
      )}</div>`}</div>
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
        <span class="agent-initial">${escapeHtml(initials(agent.name))}</span><div><h3>${escapeHtml(agent.name)}</h3><p>${escapeHtml(agent.assignment)}</p></div><span class="agent-meta">${badge(agent.status)}<small>${agent.autonomy.passes} of ${agent.autonomy.required} reviewed successes</small></span>
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
      summary: "Pantheon monitoring starts with the business runtime.",
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
      ${data.health.proofMode ? `<article class="item-card"><header><h3>System proof mode</h3>${badge("Luna only", "sky")}</header><p>Temporary low-cost testing is active. Consequential work and external effects are blocked.</p></article>` : ""}
      <article class="item-card"><header><h3>Pantheon monitoring</h3>${badge(monitoring.label, monitoringTone)}</header><p>${escapeHtml(monitoring.summary)} ${escapeHtml(monitoringDetail)} ${escapeHtml(data.health.database === "ok" ? "The operating record also passed its integrity check." : "The operating record needs an integrity review.")}</p></article>
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
      <section>${sectionHeading("System checks", "Pantheon verifies that genuine AI work left a complete local record and did not hide an uncertain outcome.")}
        <div class="metric-grid"><div class="metric ${checks.openCount ? "amber" : "mint"}"><span>Current status</span><strong>${escapeHtml(humanStatus(checks.status))}</strong><small>${checks.openCount ? `${checks.openCount} item${checks.openCount === 1 ? "" : "s"} to review` : "No unresolved execution-record issues"}</small></div><div class="metric sky"><span>Receipts verified</span><strong>${Number(checks.verifiedReceiptCount || 0)}</strong><small>${checks.receiptChainVerified ? "Integrity checks passed" : "Integrity review required"}</small></div></div>
      </section>
      <section>${checks.items?.length ? `<div class="plain-list">${checks.items.map((item) => `<article class="plain-row"><div><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.detail)}</p>${item.workerName ? `<small>${escapeHtml(item.workerName)}</small>` : ""}</div>${item.runId ? `<button class="secondary-button" data-action="open-drawer" data-kind="agent-run" data-id="${escapeHtml(item.runId)}">${icon("file-search")}Review</button>` : badge(item.status)}</article>`).join("")}</div>` : emptyState("All execution records are complete", "Pantheon found no missing receipts, uncertain provider outcomes or broken evidence links.", "shield-check")}</section>
      <section>${sectionHeading("Pantheon findings", "Current risks, stalled work and exceptions found by the independent runtime monitor.")}
        <div class="metric-grid"><div class="metric ${monitor.openCount ? "amber" : "mint"}"><span>Open findings</span><strong>${Number(monitor.openCount || 0)}</strong><small>${monitor.openCount ? "Each item remains visible until resolved" : "No current runtime exception"}</small></div><div class="metric ${monitor.criticalCount ? "coral" : "mint"}"><span>Critical</span><strong>${Number(monitor.criticalCount || 0)}</strong><small>${monitor.criticalCount ? "Stop and review before retrying affected work" : "No critical monitor finding"}</small></div></div>
        ${monitor.items?.length ? `<div class="plain-list">${monitor.items.map((item) => `<article class="plain-row"><div><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.detail)}</p><small>Last checked ${escapeHtml(shortDate(item.last_seen || item.first_seen))}${Number(item.occurrence_count || 0) > 1 ? ` / seen ${Number(item.occurrence_count)} times` : ""}</small></div>${monitorAction(item)}</article>`).join("")}</div>` : emptyState("Pantheon found no current exception", "Scheduled checks will place a concrete issue and next action here when something needs review.", "check-circle-2")}
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

const journeyStageDetails = {
  opportunity_scout: ["Market discovery", "Opportunity Scout"],
  demand_validation: ["Demand checks", "Demand Validator"],
  candidate_selection: ["Opportunity selection", "Pantheon"],
  finance_analysis: ["Commercial numbers", "Finance Agent"],
  offer_architecture: ["Offer design", "Offer Architect"],
  product_build: ["Customer product files", "Product Builder"],
  storefront_visuals: ["Storefront visuals", "Product Builder"],
  quality_review: ["Independent quality check", "Quality Reviewer"],
  conversion_copy: ["Gumroad listing", "Copy and Conversion Agent"],
  distribution_plan: ["Launch plan", "Distribution Agent"],
  chief_brief: ["Final operator brief", "Chief of Staff"],
  launch_decision: ["Publication decision", "Daniel"],
  ready_to_publish: ["Ready to publish", "Daniel"],
};

const terminalJourneyStatuses = new Set([
  "completed",
  "cancelled",
  "stopped_after_correction",
  "stopped_unknown_outcome",
]);

function journeyTaskStage(task) {
  const parameters = task?.payload?.liveSpendRequest?.parameters || {};
  return parameters.pantheonCommercial?.step === "demand_validator"
    ? "demand_validation"
    : parameters.pantheonCommercial?.step
      || parameters.pantheonProduction?.stage
      || null;
}

function journeyTaskOutcome(stage, task) {
  if (!task) return null;
  if (task.status !== "completed") return task.status;
  const output = task.result?.output || {};
  if (stage === "quality_review" && output.operatorDecision && output.operatorDecision !== "approve") {
    return "changes_required";
  }
  if (stage === "storefront_visuals" && output.operatorDecision === "revise") {
    return "changes_required";
  }
  return "completed";
}

function renderJourney() {
  const data = store.data.journey;
  const journey = data.journey;
  const protection = data.prerequisites?.dataProtection;
  if (!journey) {
    const protectionReady = protection?.status === "active";
    $("#view").innerHTML = `<div class="view-stack">
      <section class="journey-start">
        ${sectionHeading("Prove the complete business journey", "After Pantheon selects an investable opportunity, its registered Venture Kit can build, check, and prepare the right publication package for that business model.")}
        <label class="field-label" for="journey-prompt">Optional direction</label>
        <textarea id="journey-prompt" rows="4" placeholder="Leave blank for a broad commercial scan, or describe a market or problem you want included."${protectionReady ? "" : " disabled"}></textarea>
        <div class="journey-start-footer">
          <div><strong>${protectionReady ? "Luna only" : "One safety decision first"}</strong><span>${escapeHtml(protectionReady
            ? "Maximum combined exposure A$30.00. No account, publishing, customer contact, advertising, or money movement."
            : protection?.nextAction || "Review the data-protection plan before live research begins.")}</span></div>
          ${protectionReady
            ? `<button class="primary-button" data-action="start-journey">${icon("play")}Start the full journey</button>`
            : protection?.canPrepareDecision
              ? `<button class="primary-button" data-action="prepare-retention-decision">${icon("shield-check")}Review data protection</button>`
              : `<button class="primary-button" data-view="decisions">${icon("circle-check-big")}Open the safety decision</button>`}
        </div>
      </section>
    </div>`;
    return;
  }

  const activeIndex = data.stages.indexOf(journey.active_stage);
  const currentTask = data.currentTask;
  const taskByStage = new Map(
    (data.tasks || [])
      .filter((task) => task.status !== "superseded")
      .map((task) => [journeyTaskStage(task), task]),
  );
  const currentTaskStage = journeyTaskStage(currentTask);
  if (currentTask && currentTaskStage) taskByStage.set(currentTaskStage, currentTask);
  const activeStageLatestTask = taskByStage.get(journey.active_stage);
  const exposure = data.exposure || {};
  const selection = journey.metadata?.selectionRationale || "";
  const selectedId = journey.selected_opportunity_id || journey.metadata?.selectedOpportunityId;
  const selected = (data.candidates || []).find((candidate) => candidate.id === selectedId);
  const needsAttention = journey.status === "needs_attention";
  const waitingDecision = journey.status === "waiting_for_operator";
  const finished = journey.status === "completed";
  const qualityTask = taskByStage.get("quality_review");
  const qualityChangesRequired = journeyTaskOutcome("quality_review", qualityTask) === "changes_required";
  const qualityOutput = qualityTask?.result?.output || {};
  const qualityRoleOutput = qualityOutput.roleOutput || {};
  const qualityFinding = operatorFriendlyQualityCopy(qualityOutput.summary
    || qualityRoleOutput.riskFindings?.[0]
    || "The product package did not match an approved customer promise.");
  const qualityNextStep = operatorFriendlyQualityCopy(qualityRoleOutput.operatorRecommendation
    || "Correct the product description or delivered files, then run the independent quality check again.");
  const qualityRevision = Number(
    qualityTask?.payload?.liveSpendRequest?.parameters?.pantheonProduction?.revisionNumber || 0,
  );
  const qualityCorrectionAvailable = qualityRevision < 1;
  const currentCorrectionNumber = Math.max(
    Number(currentTask?.payload?.liveSpendRequest?.parameters?.retry?.number || 0),
    Number(currentTask?.payload?.liveSpendRequest?.parameters?.pantheonProduction?.revisionNumber || 0),
  );
  const correctionLimit = Math.max(0, Number(journey.metadata?.correctionLimitPerStage || 1));
  const legacyExhaustedQualityStop = needsAttention
    && journey.active_stage === "quality_review"
    && qualityChangesRequired
    && !qualityCorrectionAvailable
    && !journey.metadata?.currentTaskId;
  const legacyExhaustedWorkerStop = needsAttention
    && currentCorrectionNumber > 0
    && currentCorrectionNumber >= correctionLimit;
  const stoppedAfterCorrection = journey.status === "stopped_after_correction"
    || legacyExhaustedQualityStop
    || legacyExhaustedWorkerStop;
  const terminalStopped = (terminalJourneyStatuses.has(journey.status) && !finished)
    || legacyExhaustedQualityStop
    || legacyExhaustedWorkerStop;
  const protectionBlock = protection?.status !== "active"
    && /data protection|sensitive records|provider-side storage/i.test(String(
      journey.metadata?.blocker || currentTask?.setup_block_reason || "",
    ));
  const decisionReviewLabel = needsAttention
    ? "Review what needs attention"
    : journey.active_stage === "product_build"
      ? "Review the catalogue build"
      : journey.active_stage === "launch_decision"
        ? "Review the publication decision"
        : "Review this decision";
  const currentAction = finished
    ? `<span class="badge mint">${icon("check")}Complete</span>`
    : terminalStopped
      ? `<button class="primary-button" data-action="restart-journey">${icon("rotate-cw")}Start a clean rehearsal</button>`
    : protectionBlock && protection?.canPrepareDecision
      ? `<button class="primary-button" data-action="prepare-retention-decision">${icon("shield-check")}Review data protection</button>`
    : protectionBlock
        ? `<button class="primary-button" data-view="decisions">${icon("circle-check-big")}Open the safety decision</button>`
    : data.correction?.kind === "prepare_known_ai_retry"
      ? `<button class="primary-button" data-action="prepare-known-ai-retry" data-id="${escapeHtml(data.correction.taskId)}">${icon("rotate-cw")}${escapeHtml(data.correction.label)}</button>`
    : needsAttention && activeStageLatestTask?.status === "completed"
      ? `<button class="primary-button" data-action="continue-journey" data-id="${escapeHtml(journey.id)}">${icon("check-check")}Apply the completed correction</button>`
    : qualityChangesRequired && journey.active_stage === "quality_review"
      ? `<button class="primary-button" data-action="continue-journey" data-id="${escapeHtml(journey.id)}">${icon(qualityCorrectionAvailable ? "wrench" : "refresh-cw")}${qualityCorrectionAvailable ? "Prepare one correction" : "Review the corrected package"}</button>`
    : needsAttention || waitingDecision
      ? `<button class="primary-button" data-view="decisions">${icon("circle-check-big")}${decisionReviewLabel}</button>`
      : currentTask?.status === "running"
        ? `<button class="secondary-button" data-action="refresh">${icon("refresh-cw")}Refresh progress</button>`
        : `<button class="primary-button" data-action="continue-journey" data-id="${escapeHtml(journey.id)}">${icon("play")}Continue this stage</button>`;

  const stageRows = data.stages.map((stage, index) => {
    const task = taskByStage.get(stage);
    const taskOutcome = journeyTaskOutcome(stage, task);
    const status = taskOutcome === "changes_required"
      ? "changes_required"
      : stage === "candidate_selection"
      ? selectedId ? "completed" : index < activeIndex ? "completed" : stage === journey.active_stage ? journey.status : "planned"
      : stage === "launch_decision" || stage === "ready_to_publish"
        ? index < activeIndex || (finished && stage === "ready_to_publish") ? "completed" : stage === journey.active_stage ? journey.status : "planned"
        : taskOutcome || (index < activeIndex ? "completed" : stage === journey.active_stage ? journey.status : "planned");
    const detail = journeyStageDetails[stage] || [humanStatus(stage), "Pantheon"];
    return `<div class="journey-stage ${stage === journey.active_stage ? "active" : ""} ${status === "completed" ? "done" : ""} ${status === "changes_required" ? "changes-required" : ""}">
      <span class="journey-stage-marker">${status === "completed" ? icon("check") : index + 1}</span>
      <div><strong>${escapeHtml(detail[0])}</strong><small>${escapeHtml(detail[1])}</small></div>
      ${badge(status)}
    </div>`;
  }).join("");

  const candidateRows = (data.candidates || []).slice(0, 5).map((candidate) => {
    const isSelected = candidate.id === selectedId;
    const sourceDomains = [...new Set((candidate.sources || []).map((source) => externalDomain(source.source_url)).filter(Boolean))];
    const sourceSummary = sourceDomains.length
      ? `Evidence: ${sourceDomains.slice(0, 3).join(", ")}${sourceDomains.length > 3 ? ` +${sourceDomains.length - 3}` : ""}`
      : "No attributable source link recorded yet";
    const productSummary = isSelected && data.currentProduct
      ? `${candidate.buyer} | Current product: ${data.currentProduct.title}. ${data.currentProduct.customerPromise || data.currentProduct.deliveryFormat}`
      : `${candidate.buyer} | Original research direction: ${candidate.business_model}`;
    return `<article class="plain-row">
      <div><h3>${escapeHtml(candidate.title)}</h3><p>${escapeHtml(productSummary)}</p><small>${escapeHtml(sourceSummary)}</small></div>
      <div class="candidate-score"><strong>${Number(candidate.overall_score || 0)}</strong><small>Discovery score</small>${badge(isSelected ? "Selected" : candidate.status)}</div>
    </article>`;
  }).join("");
  const outputs = (data.outputs || []).filter((item) => item.file_path).slice(-10).reverse();
  const outputRows = outputs.map((item) => `<article class="plain-row">
    <div><h3>${escapeHtml(item.human_name || item.title)}</h3><p>${escapeHtml(item.summary || humanStatus(item.status))}</p></div>
    <div class="work-actions">
      ${canPreview(item.format, item.file_path) ? `<button class="secondary-button" data-action="open-pdf" data-id="${escapeHtml(item.id)}" data-title="${escapeHtml(item.human_name || item.title)}">${icon("file-search")}Preview</button>` : ""}
      <a class="text-button" href="/api/deliverables/${encodeURIComponent(item.id)}/file" target="_blank" rel="noopener">${icon("download")}Open file</a>
    </div>
  </article>`).join("");
  const journeySummary = terminalStopped
    ? stoppedAfterCorrection
      ? `This rehearsal stopped because the corrected product package still had a material quality issue. No incomplete files were accepted. ${money(exposure.totalCents || 0)} remains recorded against the ${money(journey.budget_cap_cents || 0)} proof limit.`
      : journey.status === "cancelled"
        ? `This journey was closed without another model call. Its evidence and ${money(exposure.totalCents || 0)} exposure remain recorded, and a clean rehearsal can now begin.`
        : `Pantheon stopped because the provider outcome could not be confirmed. It did not retry automatically. ${money(exposure.totalCents || 0)} remains recorded against the ${money(journey.budget_cap_cents || 0)} proof limit.`
    : qualityChangesRequired
    ? qualityCorrectionAvailable
      ? "The independent review found specific product and preview changes. Pantheon can prepare one bounded correction from those findings."
      : "The independent review found verifiable issues in the corrected package. Pantheon will apply the result to the exact package hashes and stop unless a repaired package requires a new independent check."
    : needsAttention && activeStageLatestTask?.status === "completed"
      ? "The corrected AI result passed its checks and is safely stored. Apply it to the commercial record before the next stage begins."
    : needsAttention
    ? data.correction?.summary || journey.metadata?.blocker || "Pantheon stopped safely and needs review."
    : selection || (selected
      ? `${selected.title} is moving through one verified stage at a time.`
      : "Pantheon is building evidence before choosing what to make.");
  const qualityFindingBlock = qualityChangesRequired
    ? `<section class="quality-stop-summary">
        <div><span class="eyebrow">Why it stopped</span><h2>The product did not fully match its promise</h2><p>${escapeHtml(qualityFinding)}</p></div>
        <div><span class="eyebrow">What must change</span><p>${escapeHtml(qualityNextStep)}</p></div>
      </section>`
    : "";

  $("#view").innerHTML = `<div class="view-stack">
    <section class="stage-callout ${needsAttention || terminalStopped ? "coral" : waitingDecision ? "amber" : "mint"} journey-now">
      <div><span class="eyebrow">${escapeHtml(journey.mode === "rehearsal" ? "ISOLATED REHEARSAL" : "PRODUCTION-INTENT JOURNEY")}</span>
      <h2>${escapeHtml(humanStatus(journey.active_stage))}</h2>
      <p>${escapeHtml(journeySummary)}</p></div>
      ${currentAction}
    </section>
    <section class="metric-grid">
      <div class="metric sky"><span>${terminalStopped ? "Stopped at" : "Current worker"}</span><strong>${escapeHtml(currentTask ? humanStatus(currentTask.agent) : journeyStageDetails[journey.active_stage]?.[1] || "Pantheon")}</strong><small>${escapeHtml(terminalStopped ? humanStatus(journey.status) : currentTask ? humanStatus(currentTask.status) : humanStatus(journey.status))}</small></div>
      <div class="metric mint"><span>Journey exposure</span><strong>${money(exposure.totalCents || 0)}</strong><small>of ${money(journey.budget_cap_cents)} maximum</small></div>
      <div class="metric amber"><span>Opportunities retained</span><strong>${Number((data.candidates || []).length)}</strong><small>Three receive comparable validation</small></div>
      <div class="metric"><span>Files retained</span><strong>${Number((data.outputs || []).length)}</strong><small>Each output remains tied to its source run</small></div>
    </section>
    ${qualityFindingBlock}
    <section>${sectionHeading("Journey progress", "One specialist completes and records each bounded stage before Pantheon advances.")}
      <div class="journey-stage-list">${stageRows}</div>
    </section>
    <div class="two-column">
      <section>${sectionHeading(selected ? "Selected opportunity and product" : "Opportunity shortlist", selection || "Pantheon keeps all findings and explains the eventual choice.")}
        ${candidateRows ? `<div class="plain-list">${candidateRows}</div>` : emptyState("Research has not completed yet", "The shortlist will appear after the Opportunity Scout finishes.", "search")}
      </section>
      <section>${sectionHeading("Journey controls", "The model and action limits are fixed to this exact run.")}
        <div class="control-facts">
          <div><span>Model</span><strong>${escapeHtml(journey.model)} | locked</strong></div>
          <div><span>Outside actions</span><strong>Not allowed</strong></div>
          <div><span>Correction limit</span><strong>One per stage</strong></div>
          <div><span>Started</span><strong>${escapeHtml(shortDate(journey.started_at))}</strong></div>
        </div>
      </section>
    </div>
    <section>${sectionHeading("Files and review outputs", "Customer files, previews, listing material and the final operator brief appear here as they are genuinely created.")}
      ${outputRows ? `<div class="plain-list">${outputRows}</div>` : emptyState("No files yet", "Files will appear only after a worker creates and Pantheon retains them.", "files")}
    </section>
  </div>`;
}

function renderView() {
  if (store.view === "cockpit") renderCockpit();
  else if (store.view === "journey") renderJourney();
  else if (store.view === "decisions") renderDecisions();
  else if (store.view === "portfolio") renderPortfolio();
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
    if (store.view === "journey") {
      store.data.journey = await fetchJson("/api/journey");
      if (store.view === "journey") {
        renderJourney();
        refreshIcons();
      }
      return;
    }
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
  const journeyHasActiveRun = store.view === "journey"
    && store.data.journey?.currentTask?.status === "running";
  const shouldPoll = store.runRequestActive
    || cockpitHasActiveRun
    || journeyHasActiveRun
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
    .replace(/\[([^\]]+)\]\(https?:\/\/[^)\s]+\)/gi, "$1")
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
  const qualityNeedsWork = ["failed", "needs_review"].includes(data.quality?.status);
  if (reviewPending) {
    return `<div class="drawer-footer-copy"><strong>Is this analysis clear enough to use?</strong><span>Your answer helps Pantheon improve this exact AI skill.</span></div>
      <div class="work-actions">
        <button class="primary-button" data-action="review-agent-run" data-run-id="${escapeHtml(data.run.id)}" data-verdict="useful" data-score="4">${icon("check")}Analysis is clear</button>
        <button class="secondary-button" data-action="review-agent-run" data-run-id="${escapeHtml(data.run.id)}" data-handoff-id="${escapeHtml(handoff?.id || "")}" data-verdict="changes_required" data-score="2">${icon("pencil-line")}Request a better analysis</button>
      </div>`;
  }
  if (!handoff && qualityNeedsWork && data.execution?.systemProof && data.run.taskId) {
    return `<div class="drawer-footer-copy"><strong>Prove the corrected research path</strong><span>This prepares a separate Luna cost decision. It does not call OpenAI yet.</span></div>
      <div class="work-actions">
        <button class="primary-button" data-action="prepare-known-ai-retry" data-id="${escapeHtml(data.run.taskId)}">${icon("rotate-cw")}Prepare a better research check</button>
      </div>`;
  }
  if (!handoff) return "";
  const nextStepLabel = demandResult
    ? qualityNeedsWork && data.execution?.systemProof
      ? "Continue this internal system test"
      : "Prepare the interest test"
    : "Prepare the next step";
  return `<div class="drawer-footer-copy"><strong>What should Pantheon do next?</strong><span>${qualityNeedsWork && data.execution?.systemProof ? "This continues the internal workflow only. The result is not accepted as market evidence." : "No publishing, customer contact, account change, or spend will occur."}</span></div>
    <div class="work-actions">
      <button class="primary-button" data-action="handoff-decision" data-id="${escapeHtml(handoff.id)}" data-decision="approve">${icon("arrow-right")}${nextStepLabel}</button>
      <button class="secondary-button" data-action="handoff-decision" data-id="${escapeHtml(handoff.id)}" data-decision="changes">${icon("pencil-line")}Ask for changes</button>
      <button class="danger-button" data-action="handoff-decision" data-id="${escapeHtml(handoff.id)}" data-decision="reject">${icon("square")}Stop here</button>
    </div>`;
}

function runReviewBody(data) {
  const process = data.process;
  const execution = data.execution;
  const receipt = data.receipt;
  const protectedRun = ["protected_rehearsal", "deterministic_system_step"].includes(execution.kind);
  const providerNotContacted = execution.kind === "provider_not_contacted"
    || execution.providerAttempted === false;
  const unknownOutcome = execution.kind === "provider_outcome_unknown";
  const visibility = execution.tracePolicy || {};
  const handoff = activeRunHandoff(data);
  const reviewPending = data.review?.operatorVerdict === "pending";
  const controlledEvidence = process.suppliedEvidence?.some((item) => item.sourceType === "test_fixture");
  const demandResult = data.run.workerId === "demand_validator";
  const qualityNeedsWork = ["failed", "needs_review"].includes(data.quality?.status);
  const assuranceLayers = data.quality?.layers || {};
  const plainConclusion = demandResult && controlledEvidence
    ? "Demand Validator recommends a small, free interest test before anything is built. The controlled evidence suggests a recurring problem, but it does not prove real demand or willingness to pay."
    : plainAgentText(process.conclusion);
  const duration = durationLabel(data.run.durationMs);
  const actualTokens = execution.actualTokens?.total === null || execution.actualTokens?.total === undefined
    ? "Not captured"
    : `${tokenCount(execution.actualTokens.input)} in / ${tokenCount(execution.actualTokens.output)} out`;
  const plannedTokens = execution.plannedTokens?.input === null && execution.plannedTokens?.output === null
    ? "Not set"
    : `${execution.plannedTokens?.input === null ? "No input cap" : `${tokenCount(execution.plannedTokens.input)} input`} / ${execution.plannedTokens?.output === null ? "No output cap" : `${tokenCount(execution.plannedTokens.output)} output`}`;
  const providerCost = protectedRun || providerNotContacted
    ? "No provider charge"
    : execution.cost.status === "reconciled"
      ? `${money(execution.cost.reconciledCents || 0, execution.cost.currency)} final`
      : execution.cost.actualCents !== null && execution.cost.actualCents !== undefined
        ? `${money(execution.cost.actualCents, execution.cost.currency)} recorded; final bill pending`
      : Number(execution.cost.estimatedCents || 0) > 0
        ? `About ${money(execution.cost.estimatedCents, execution.cost.currency)}; final bill pending`
        : "No charge recorded";
  const providerCostLabel = protectedRun || providerNotContacted
    ? "Provider cost"
    : execution.cost.status === "reconciled"
      ? "Final cost"
      : "Estimated incurred cost";
  const approvedCeiling = Number(execution.cost.plannedCapCents || 0) > 0
    ? money(execution.cost.plannedCapCents, execution.cost.currency)
    : "No approved ceiling recorded";
  const providerVisibility = protectedRun
    ? "No provider call was made. This was an internal rehearsal."
    : providerNotContacted
      ? "OpenAI was not contacted. The approved ceiling remained unused."
    : visibility.providerResponseStored && visibility.providerTraceContent
      ? "OpenAI trace content was enabled for this approved non-personal run."
      : "Pantheon retained the structured result and local execution record; full provider trace content was not enabled.";
  const cacheUsage = execution.cacheUsage || {};
  const cacheLabel = cacheUsage.status === "reported"
    ? cacheUsage.inputTokens > 0
      ? `${Math.round(Number(cacheUsage.cacheHitRate || 0) * 100)}% of input was served from cache`
      : "No input tokens were reported"
    : cacheUsage.status === "partial"
      ? "Some token data was reported; cache use is incomplete"
      : "OpenAI did not report enough data to measure cache use";
  const suppliedEvidence = process.suppliedEvidence?.length
    ? `<div class="evidence-list">${process.suppliedEvidence.map((item) => {
        const url = safeExternalUrl(item.url);
        const sourceLabel = item.sourceType === "test_fixture" ? "Controlled test evidence" : humanStatus(item.sourceType);
        return `<article><strong>${escapeHtml(item.title)}</strong><p>${escapeHtml(item.summary)}</p><small>${escapeHtml(sourceLabel)}${url ? ` / <a href="${escapeHtml(url)}" target="_blank" rel="noreferrer">Open source</a>` : ""}</small></article>`;
      }).join("")}</div>`
    : "<p>No supplied evidence was recorded.</p>";
  const traceEvents = data.developer.traceEvents?.length
    ? `<ol class="trace-list">${data.developer.traceEvents.map((event) => `<li><strong>${escapeHtml(event.title)}</strong><span>${escapeHtml(event.detail || humanStatus(event.type))}</span><small>${escapeHtml(dateTime(event.ts))}</small></li>`).join("")}</ol>`
    : "<p>No local timeline was recorded.</p>";
  const observedTools = execution.observedTools?.length
    ? `<div class="evidence-list">${execution.observedTools.map((tool) => `<article><strong>${escapeHtml(tool.name)}</strong><p>${escapeHtml(tool.outputSummary || tool.inputSummary || "Tool activity was recorded.")}</p><small>${escapeHtml(humanStatus(tool.status))}</small></article>`).join("")}</div>`
    : "<p>No provider tool was used.</p>";
  const researchAttempted = Boolean(
    execution.research
    || execution.observedTools?.some((tool) => ["research_adapter", "live_web_with_approval"].includes(tool.toolId)),
  );
  const researchLabel = execution.sources?.length
    ? `${execution.sources.length} source${execution.sources.length === 1 ? "" : "s"}`
    : researchAttempted
      ? "Attempted; no usable sources"
      : "Not used";
  const reviewedRecordCount = process.businessContext?.sections?.reduce(
    (total, section) => total + Number(section.recordCount || 0),
    0,
  ) || process.suppliedEvidence?.length || 0;
  const sources = execution.sources?.length
    ? `<div class="evidence-list">${execution.sources.map((source) => {
        const url = safeExternalUrl(source.url);
        return `<article><strong>${escapeHtml(source.title)}</strong><p>${escapeHtml(source.relevance || source.publisher || "Research source recorded by Pantheon.")}</p><small>${source.grounded ? "Grounded source" : "Source not independently verified"}${url ? ` / <a href="${escapeHtml(url)}" target="_blank" rel="noreferrer">Open source</a>` : ""}</small></article>`;
      }).join("")}</div>`
    : researchAttempted
      ? `<div class="error-callout"><strong>No usable web sources were returned</strong><p>${escapeHtml(execution.research?.summary || "The approved research tool ran, but it did not return an attributable source URL. Treat this result as incomplete market evidence.")}</p></div>`
      : "<p>No web research was used for this run.</p>";
  const businessContext = process.businessContext
    ? detailSection("Business records supplied", `<p>${escapeHtml(process.businessContext.purpose)}</p><div class="evidence-list">${process.businessContext.sections.map((section) => `<article><strong>${escapeHtml(humanStatus(section.name))}</strong><p>${section.recordCount ? escapeHtml(section.records.map((item) => item.title).join(", ")) : "No current records in this category."}</p><small>${section.recordCount} record${section.recordCount === 1 ? "" : "s"} supplied</small></article>`).join("")}</div>`)
    : "";
  const errorSection = data.run.error || execution.error
    ? detailSection("What went wrong", `<div class="error-callout"><strong>${unknownOutcome ? "OpenAI outcome needs review" : "The run failed"}</strong><p>${escapeHtml(data.run.error || execution.error)}</p></div>`)
    : "";
  const qualitySection = qualityNeedsWork
    ? `<div class="error-callout"><strong>This result did not pass Pantheon's evidence checks</strong><p>The worker completed its technical run, but the ${escapeHtml(String(data.quality?.score ?? "unscored"))}/100 check found incomplete evidence. ${execution.systemProof ? "It can continue only as an internal system test; it is not accepted as market proof." : "Ask for changes or stop before using it for a business decision."}</p></div>`
    : "";
  const reviewStatus = reviewPending
    ? `<div class="decision-step"><span>1</span><div><strong>Check the analysis</strong><p>Read the result, then use the buttons below to say whether it is clear enough to guide a decision.</p></div></div>`
    : `<div class="decision-step complete"><span>${icon("check")}</span><div><strong>Analysis reviewed</strong><p>${escapeHtml(data.review?.note || `You marked this analysis as ${humanStatus(data.review?.operatorVerdict || "reviewed")}.`)}</p></div></div>`;
  const nextStepStatus = handoff
    ? `<div class="decision-step${reviewPending ? " waiting" : ""}"><span>2</span><div><strong>Choose the business direction</strong><p>${reviewPending ? "This becomes available as soon as you finish step one." : demandResult ? "Choose whether Pantheon should prepare the free interest test, revise the work, or stop here." : escapeHtml(handoff.decisionNeeded || "Choose what Pantheon should do next.")}</p></div></div>`
    : `<div class="decision-step complete"><span>${icon("check")}</span><div><strong>Next step recorded</strong><p>No further direction is waiting on this result.</p></div></div>`;
  const receiptRecord = receipt
    ? `<div class="review-check"><span>${receipt.status === "complete" ? "Inputs, output, provider evidence, cost state, and checks were captured." : "Pantheon found an issue in the stored run record."}</span>${badge(receipt.status === "complete" ? "Record complete" : "Review needed", receipt.status === "complete" ? "mint" : "amber")}</div>${receipt.missingFields?.length ? `<h4>Missing details</h4>${detailList(receipt.missingFields)}` : ""}${receipt.warnings?.length ? `<h4>Review notes</h4>${detailList(receipt.warnings)}` : ""}`
    : `<div class="error-callout"><strong>Run record not finalized</strong><p>${data.run.status === "running" ? "Pantheon is still recording this run." : "The system monitor will keep this visible until the record is complete."}</p></div>`;
  const assuranceRows = [
    ["Output structure", assuranceLayers.structural?.status || data.quality?.status || "not reviewed"],
    ["Claims and scope", assuranceLayers.behavioral?.status || "not reviewed"],
    ["Run record", assuranceLayers.trace?.status || receipt?.status || "not reviewed"],
    ["Useful to the operator", assuranceLayers.operatorUsefulness?.status || "not reviewed"],
    ["Proven in the market", assuranceLayers.commercialOutcome?.status || "not measured"],
  ];
  const assuranceOverview = detailSection(
    "Pantheon checks",
    `<p>These checks separate a well-formed AI answer from work that is useful to you and results that have actually occurred in the market.</p><div class="review-check-list">${assuranceRows.map(([label, status]) => {
      const normalized = String(status || "").toLowerCase();
      const tone = ["passed", "complete", "verified"].includes(normalized)
        ? "mint"
        : ["failed", "blocked"].includes(normalized)
          ? "coral"
          : "amber";
      return `<div class="review-check"><span>${escapeHtml(label)}</span>${badge(humanStatus(status), tone)}</div>`;
    }).join("")}</div>`,
  );
  const technicalRecord = [
    detailSection("Automated checks", `${reviewCriteria(data.review?.criteria || {})}<p>The ${escapeHtml(String(data.quality?.score ?? "unscored"))}${data.quality?.score !== undefined ? "/100" : ""} result checks structure and safety only. You decide whether the work is commercially useful.</p>`),
    detailSection("Execution facts", `<div class="review-facts"><div><span>Related work</span><strong>${escapeHtml(execution.workGroup?.label || "Earlier ungrouped run")}</strong></div><div><span>Run type</span><strong>${escapeHtml(execution.label)}</strong></div><div><span>Status</span><strong>${escapeHtml(humanStatus(data.run.status))}</strong></div><div><span>Provider</span><strong>${escapeHtml(execution.provider || (protectedRun ? "No provider used" : execution.requestedProvider || "Not captured"))}</strong></div><div><span>Model</span><strong>${escapeHtml(execution.modelRoute?.label || execution.model || (protectedRun ? "No model called" : execution.requestedModel || "Not captured"))}</strong></div><div><span>Duration</span><strong>${escapeHtml(duration)}</strong></div><div><span>Tokens</span><strong>${escapeHtml(actualTokens)}</strong></div><div><span>Prompt cache</span><strong>${escapeHtml(cacheLabel)}</strong></div><div><span>Planned limits</span><strong>${escapeHtml(plannedTokens)}</strong></div><div><span>${escapeHtml(providerCostLabel)}</span><strong>${escapeHtml(providerCost)}</strong></div><div><span>Approved ceiling</span><strong>${escapeHtml(approvedCeiling)}</strong></div><div><span>External effects</span><strong>${execution.externalEffects.length ? escapeHtml(execution.externalEffects.join(", ")) : "None"}</strong></div><div><span>Scope check</span><strong>${escapeHtml(humanStatus(execution.sdkGuardrails?.preflight?.status || (protectedRun ? "not applicable" : "not captured")))}</strong></div></div><p>The approved ceiling is an upper limit, not spend. Unused capacity was not incurred.</p><p>${escapeHtml(providerVisibility)}</p>`),
    detailSection("Tools and research", `<h4>Tool activity</h4>${observedTools}<h4>Research sources</h4>${sources}`),
    detailSection("Stored run record", `${receiptRecord}<div class="technical-ids"><span>OpenAI trace</span><code>${escapeHtml(execution.traceId || "Not captured")}</code><span>OpenAI response</span><code>${escapeHtml(execution.responseId || "Not captured")}</code><span>Pantheon run</span><code>${escapeHtml(data.run.id)}</code><span>Work group</span><code>${escapeHtml(execution.workGroup?.id || "Historical ungrouped run")}</code><span>Agent harness</span><code>${escapeHtml(execution.harness?.hash || "Historical unversioned run")}</code><span>Input fingerprint</span><code>${escapeHtml(data.developer.fixtureHash || data.developer.contextSnapshotHash || "Not captured")}</code><span>Receipt fingerprint</span><code>${escapeHtml(receipt?.hash || "Not captured")}</code></div>`),
    detailSection("Run timeline", traceEvents),
  ].join("");

  return `<div class="review-workspace">
    <section class="result-hero">
      <div><span class="eyebrow">AI recommendation</span><h3>${demandResult ? "Test interest before building" : escapeHtml(data.run.taskTitle)}</h3><p>${escapeHtml(plainConclusion)}</p></div>
      <div class="result-badges">${badge(`Confidence: ${humanStatus(process.confidence)}`, "amber")}${controlledEvidence ? badge("Controlled test; not market proof", "sky") : badge(data.run.status, data.run.status === "completed" ? "mint" : "amber")}</div>
    </section>
    ${errorSection}
    ${qualitySection}
    ${assuranceOverview}
    <section class="run-fact-strip">
      <div><span>Records reviewed</span><strong>${reviewedRecordCount} business record${reviewedRecordCount === 1 ? "" : "s"}</strong></div>
      <div><span>Web research</span><strong>${escapeHtml(researchLabel)}</strong></div>
      <div><span>External action</span><strong>${execution.externalEffects.length ? "Recorded" : "None"}</strong></div>
      <div><span>${escapeHtml(providerCostLabel)}</span><strong>${escapeHtml(providerCost)}</strong></div>
      <div><span>Approved ceiling</span><strong>${escapeHtml(approvedCeiling)}</strong></div>
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
    openDrawer(reviewTitle, `${data.run.workerName} / ${data.run.executionLabel}`, runReviewBody(data), {
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
    const validation = data.buyerIntentValidation;
    if (validation) {
      const measurement = validation.measurement || {};
      const platformName = validationPlatform(validation);
      const buyerTestTitle = data.plan?.metadata?.productManifest?.packageTitle
        || validation.sample?.item?.title
        || validation.sample?.packageTitle
        || item.name;
      const files = data.sampleDeliverables || [];
      const fileList = files.length ? `<div class="plain-list">${files.map((file) => `<article class="plain-row"><div><h3>${escapeHtml(file.name || "Product file")}</h3><p>${escapeHtml(String(file.format || "file").toUpperCase())}${file.bytes ? ` / ${escapeHtml(String(Math.ceil(file.bytes / 1024)))} KB` : ""}</p></div><div class="work-actions">${canPreview(file.format) ? `<button class="secondary-button" data-action="open-pdf" data-id="${escapeHtml(file.id)}" data-title="${escapeHtml(file.name || "Product preview")}">${icon("file-search")}Preview</button>` : ""}<a class="secondary-button" href="/api/deliverables/${encodeURIComponent(file.id)}/download">${icon("download")}Download</a></div></article>`).join("")}</div>` : "<p>The customer files are still being built or checked.</p>";
      const decision = data.decisionHandoff;
      const finalTaskStatus = validation.finalTask?.status || null;
      const inspectionEvidenceRecheckPending =
        data.plan?.metadata?.inspectionEvidenceRecheckApprovalId
        && data.plan?.metadata?.buildStatus === "inspection_evidence_repaired_pending_recheck"
        && (!finalTaskStatus || ["blocked", "waiting_approval"].includes(finalTaskStatus));
      const inspectionEvidenceRecheckRunning =
        validation.inspectionEvidenceRecheck === true
        && finalTaskStatus === "running";
      const inspectionEvidenceRecheckQueued =
        validation.inspectionEvidenceRecheck === true
        && ["queued", "planned"].includes(finalTaskStatus);
      const inspectionEvidenceRecheckTerminal = [
        "inspection_evidence_recheck_failed_terminal",
        "inspection_evidence_recheck_declined_terminal",
      ].includes(data.plan?.metadata?.buildStatus);
      const finalReviewPending = inspectionEvidenceRecheckPending || (
        data.plan?.metadata?.explicitFinalReviewApprovalId
        && data.plan?.metadata?.buildStatus === "corrected_package_waiting_for_final_review_decision"
      );
      const currentStep = inspectionEvidenceRecheckTerminal
        ? `<div class="stage-callout coral"><div><span class="section-label">Permanently stopped</span><h3>The one evidence recheck is closed</h3><p>The recheck did not pass or was declined. Pantheon will not retry it, revise this build, or approve more model spend. The exact files and result remain retained as evidence.</p></div></div>`
        : inspectionEvidenceRecheckRunning
          ? `<div class="stage-callout sky"><div><span class="section-label">Working now</span><h3>Terra is checking the complete inspection</h3><p>The unchanged package is being reviewed through the four exact local images. This is the single evidence recheck; no publication, marketplace action, retry, or model fallback is authorised.</p></div></div>`
        : inspectionEvidenceRecheckQueued
          ? `<div class="stage-callout sky"><div><span class="section-label">Approved</span><h3>The one evidence recheck is waiting to start</h3><p>The A$1.50 ceiling and four exact local images are already fixed. Pantheon will not ask for another approval or substitute a model.</p></div></div>`
        : finalReviewPending
        ? inspectionEvidenceRecheckPending
          ? `<div class="stage-callout amber"><div><span class="section-label">Needs your decision</span><h3>Recheck the complete setup-guide inspection?</h3><p>The customer files are unchanged. Jarvis regenerated only the internal inspection sheet so all three pages are visible. The one evidence recheck is capped at ${money(validation.providerPolicy?.qualityReviewerCapCents || 0)} and cannot publish, contact anyone, change an account, or spend externally.</p></div><button class="primary-button" data-view="decisions">${icon("arrow-right")}Review this decision</button></div>`
          : `<div class="stage-callout amber"><div><span class="section-label">Needs your decision</span><h3>Run one final independent check?</h3><p>Jarvis corrected the exact local files at no additional AI cost. The remaining check is capped at ${money(validation.providerPolicy?.qualityReviewerCapCents || 0)} and cannot publish, contact anyone, change an account, or spend externally.</p></div><button class="primary-button" data-view="decisions">${icon("arrow-right")}Review this decision</button></div>`
        : data.plan?.status === "quality_review"
          ? `<p>${badge("Quality review")} Pantheon is checking the corrected files. No external action is running.</p>`
          : `<p>${badge(data.plan?.status || item.status)} The product and test remain inside Pantheon until the required checks and decisions are complete.</p>`;
      const testStateLabel = inspectionEvidenceRecheckTerminal
        ? "Product stopped"
        : inspectionEvidenceRecheckRunning
          ? "Evidence recheck underway"
          : inspectionEvidenceRecheckQueued
            ? "Evidence recheck approved"
        : inspectionEvidenceRecheckPending
          ? "Complete inspection pending"
          : validation.status === "buyer_test_ready"
            ? "Buyer test ready"
            : data.plan?.status === "quality_review"
              ? "Independent quality review"
              : "One evidence gap, one product";
      const testHeroStatus = inspectionEvidenceRecheckTerminal
        ? "stopped_permanently"
        : data.pack?.status || validation.status || data.plan?.status || item.status;
      const decisionButtons = inspectionEvidenceRecheckTerminal
        ? `<p>${badge("Stopped permanently", "coral")} No retry, revision, publication, marketplace action, or additional model spend is authorised for this build.</p>`
        : decision && ["needs_operator_decision", "waiting_for_review", "waiting_approval"].includes(decision.status)
        ? `<div class="drawer-actions"><button class="primary-button" data-action="handoff-decision" data-id="${escapeHtml(decision.id)}" data-decision="approve">${icon("check")}Approve this test plan</button><button class="secondary-button" data-action="handoff-decision" data-id="${escapeHtml(decision.id)}" data-decision="changes">${icon("pencil")}Request changes</button><button class="danger-button" data-action="handoff-decision" data-id="${escapeHtml(decision.id)}" data-decision="reject">${icon("x")}Stop this test</button></div>`
        : decision ? `<p>${badge(decision.status)} This test-plan decision has been recorded.</p>` : "<p>The operator decision appears after the product passes its independent quality check.</p>";
      openDrawer(buyerTestTitle, "Pre-venture buyer test", `<div class="review-workspace">
        <section class="result-hero"><div><span class="eyebrow">${escapeHtml(testStateLabel)}</span><h3>${escapeHtml(buyerTestTitle)}</h3><p>${escapeHtml(validation.sample?.customerPromise || item.offer)}</p></div>${badge(testHeroStatus)}</section>
        ${detailSection("What this test decides", `<p class="lead-copy">${escapeHtml(measurement.qualificationQuestion || item.hypothesis)}</p><div class="review-facts"><div><span>Buyer</span><strong>${escapeHtml(validation.buyer || item.buyer)}</strong></div><div><span>Test price</span><strong>${money(validation.priceCents || item.price_cents)}</strong></div><div><span>Channel</span><strong>${escapeHtml(validation.channel?.label || item.channel)}</strong></div><div><span>Boundary</span><strong>${Number(measurement.exposureTarget || item.target_value)} visits or ${Number(measurement.durationDays || 30)} days</strong></div></div>`)}
        ${detailSection("The actual product", fileList)}
        ${detailSection("Current step", currentStep)}
        ${detailSection("Decision rules", `<div class="test-plan"><div><span>Pass</span><strong>${escapeHtml(measurement.passRule || item.expected_metric)}</strong></div><div><span>Revise one thing</span><strong>${escapeHtml(measurement.reviseRule || "Use a coherent buyer objection.")}</strong></div><div><span>Reach was too low</span><strong>${escapeHtml(measurement.inconclusiveRule || "Diagnose reach before judging demand.")}</strong></div><div><span>Stop or park</span><strong>${escapeHtml(measurement.stopRule || "Stop when the evidence rejects the offer.")}</strong></div></div>`)}
        ${detailSection(inspectionEvidenceRecheckTerminal ? "Why no action is available" : "What approval means", inspectionEvidenceRecheckTerminal
          ? decisionButtons
          : `<p>Approval accepts this test plan only. It does not create an account on ${escapeHtml(platformName)}, accept new terms, complete KYC, pay a setup fee, publish, advertise, contact buyers, or build a wider catalogue.</p>${decisionButtons}`)}
        ${detailSection("Measured results", data.results.length ? `<p>${data.results.length} real-world result record${data.results.length === 1 ? "" : "s"} has been retained.</p>` : "<p>No listing, visit, order, refund, or contribution result exists yet.</p>")}
      </div>`, { wide: true, state: { kind, id }, preserveFocus: options.preserveFocus });
      return;
    }
    openDrawer(item.name, "Business test", [
      detailSection("Hypothesis", `<p>${escapeHtml(item.hypothesis || "Not yet defined")}</p>`),
      detailSection("Buyer and offer", `<p><strong>Buyer:</strong> ${escapeHtml(item.buyer || "Not selected")}<br><strong>Offer:</strong> ${escapeHtml(item.offer || "Not selected")}<br><strong>Channel:</strong> ${escapeHtml(item.channel || "Not selected")}</p>`),
      detailSection("Measurement", `<p><strong>Expected:</strong> ${escapeHtml(item.expected_metric || "Not defined")}<br><strong>Target:</strong> ${escapeHtml(item.target_value)} ${escapeHtml(item.target_unit || "")}</p>`),
      detailSection("Recorded evidence", data.evidence.length ? `<ul>${data.evidence.map((evidence) => `<li>${escapeHtml(evidence.title)}</li>`).join("")}</ul>` : "<p>No verified evidence has been attached yet.</p>"),
      detailSection("Results", data.results.length ? `<p>${data.results.length} measured result record${data.results.length === 1 ? "" : "s"}.</p>` : "<p>No real-world result has been recorded.</p>"),
    ].join(""), { state: { kind, id }, preserveFocus: options.preserveFocus });
    return;
  }
  if (kind === "portfolio-opportunity") {
    const item = store.data.portfolio?.opportunities?.find((opportunity) => opportunity.id === id);
    if (!item) throw new Error("This opportunity is no longer in the current portfolio view.");
    const metadata = item.metadata || {};
    const validation = metadata.validation || {};
    const finance = metadata.finance || {};
    const sources = Array.isArray(validation.sources) ? validation.sources : [];
    const sourceList = sources.length
      ? `<div class="evidence-list">${sources.map((source) => {
        const url = safeExternalUrl(source.url);
        return `<article><strong>${escapeHtml(source.title || externalDomain(url) || "Market source")}</strong><p>${escapeHtml(source.publisher || "Public source retained by Pantheon.")}</p>${url ? `<small><a href="${escapeHtml(url)}" target="_blank" rel="noreferrer">Open source</a></small>` : ""}</article>`;
      }).join("")}</div>`
      : "<p>No attributable source has been retained for this candidate yet.</p>";
    openDrawer(item.title, "Portfolio opportunity", `<div class="review-workspace">
      <section class="result-hero"><div><span class="eyebrow">${escapeHtml(humanStatus(item.business_model))} / ${escapeHtml(item.geography || "global")}</span><h3>${escapeHtml(item.offer_direction || item.title)}</h3><p>${escapeHtml(item.problem)}</p></div>${badge(item.status)}</section>
      ${detailSection("Buyer and route to market", `<div class="review-facts"><div><span>Intended buyer</span><strong>${escapeHtml(item.buyer || "Not established")}</strong></div><div><span>Proposed channel</span><strong>${escapeHtml(item.channel || "Not established")}</strong></div><div><span>Discovery score</span><strong>${Number(item.overall_score || 0)}/100</strong></div><div><span>Confidence</span><strong>${escapeHtml(humanStatus(item.confidence || "low"))}</strong></div></div>`)}
      ${detailSection("Demand finding", `<p>${escapeHtml(validation.recommendation || item.recommendation || "Demand research has not completed.")}</p>${detailList(validation.evidence || [], "No direct-demand finding has been recorded yet.")}`)}
      ${detailSection("Financial finding", `<p>${escapeHtml(finance.summary || "The financial review has not completed.")}</p>${finance.work ? `<div class="review-facts"><div><span>Price</span><strong>${escapeHtml(finance.work.price || "Not quantified")}</strong></div><div><span>Margin</span><strong>${escapeHtml(finance.work.marginLogic || "Not quantified")}</strong></div><div><span>Break-even</span><strong>${escapeHtml(finance.work.breakEven || "Not quantified")}</strong></div><div><span>Downside</span><strong>${escapeHtml(finance.work.financialRisk || "Not quantified")}</strong></div></div>` : ""}`)}
      ${detailSection("Retained sources", sourceList)}
    </div>`, { wide: true, state: { kind, id }, preserveFocus: options.preserveFocus });
    return;
  }
  if (kind === "investment-case") {
    const item = await fetchJson(`/api/commercial/investment-cases/${encodeURIComponent(id)}`);
    const criterionLabels = {
      buyer_problem: "Buyer and problem",
      direct_demand: "Direct demand",
      competition_entry: "Competition and entry position",
      offer_value: "Offer and customer value",
      economics: "Price, costs, margin and break-even",
      distribution: "Route to market",
      operations: "Operating requirements",
      experiment: "Smallest useful test",
      alternatives: "Alternatives and doing nothing",
      risk: "Downside and reversal conditions",
    };
    const criteria = Object.entries(item.criteria || {});
    const sourceLinks = item.evidence_summary?.sourceUrls || [];
    openDrawer(item.offer || item.problem || "Commercial investment case", "Investment review", `<div class="review-workspace">
      <section class="result-hero"><div><span class="eyebrow">Pantheon recommendation</span><h3>${escapeHtml(humanStatus(item.recommendation))}</h3><p>${escapeHtml(item.rationale)}</p></div>${badge(item.recommendation)}</section>
      ${detailSection("Decision requirements", `<div class="investment-criteria">${criteria.map(([key, criterion]) => `<article class="${criterion.passed ? "passed" : "failed"}"><span>${icon(criterion.passed ? "check" : "x")}</span><div><strong>${escapeHtml(criterionLabels[key] || humanStatus(key))}</strong><p>${escapeHtml(criterion.reason)}</p></div></article>`).join("")}</div>`)}
      ${detailSection("Economics", `<div class="review-facts"><div><span>Price</span><strong>${escapeHtml(item.economics?.price || "Not established")}</strong></div><div><span>Margin</span><strong>${escapeHtml(item.economics?.marginLogic || "Not established")}</strong></div><div><span>Break-even</span><strong>${escapeHtml(item.economics?.breakEven || "Not established")}</strong></div><div><span>Cost limit</span><strong>${escapeHtml(item.economics?.costCap || "Not established")}</strong></div></div><p>This preserves the analysis recorded at review time. Only costs explicitly tied to this venture count toward its break-even; current Pantheon spending is shown in System &gt; Spend.</p>`)}
      ${detailSection("Market evidence", sourceLinks.length ? `<div class="evidence-list">${sourceLinks.map((url) => `<article><strong>${escapeHtml(externalDomain(url) || "Market source")}</strong><small><a href="${escapeHtml(safeExternalUrl(url) || "#")}" target="_blank" rel="noreferrer">Open source</a></small></article>`).join("")}</div>` : "<p>No attributable market source is retained. This case cannot pass direct demand without it.</p>")}
      ${detailSection("What happens next", `<p>${escapeHtml(item.next_action)}</p>${item.buyerIntentOption ? `<div class="stage-callout sky"><div><span class="section-label">Smallest useful next step</span><h3>${escapeHtml(item.buyerIntentOption.label)}</h3><p>${escapeHtml(item.buyerIntentOption.summary)} Internal AI work is capped at ${money(item.buyerIntentOption.internalAiCapCents)}. No external action is included.</p></div><button class="primary-button" data-action="prepare-buyer-intent" data-id="${escapeHtml(item.id)}" data-spec-id="${escapeHtml(item.buyerIntentOption.specId)}" data-decision-hash="${escapeHtml(item.buyerIntentOption.expectedDecisionHash)}">${icon("flask-conical")}Prepare this buyer test</button></div>` : ""}`)}
      ${item.missing_evidence?.length ? detailDisclosure("Evidence still missing", detailList(item.missing_evidence)) : ""}
    </div>`, { wide: true, state: { kind, id }, preserveFocus: options.preserveFocus });
    return;
  }
  if (kind === "service-trial") {
    const trial = store.data.portfolio?.serviceTrials?.trials?.find((item) => item.id === id);
    if (!trial) throw new Error("This service trial is no longer available.");
    openDrawer(trial.serviceName, "Research service trial", `<div class="review-workspace">
      <section class="result-hero"><div><span class="eyebrow">${escapeHtml(trial.vendor)}</span><h3>${escapeHtml(trial.hypothesis)}</h3><p>The service must materially improve a real decision before Pantheon recommends keeping it.</p></div>${badge(trial.status)}</section>
      ${detailSection("Public-data baseline", `<div class="review-facts"><div><span>Method</span><strong>${escapeHtml(trial.baseline.method || "Not recorded")}</strong></div><div><span>Useful findings</span><strong>${Number(trial.baseline.usefulFindings || 0)}</strong></div></div><p>${escapeHtml(trial.baseline.decisionGap || "")}</p>`)}
      ${detailSection("Cost and retention rule", `<div class="review-facts"><div><span>Maximum cost</span><strong>${money(trial.capCents)}</strong></div><div><span>Actual cost</span><strong>${trial.actualCostCents === null ? "Not settled" : money(trial.actualCostCents)}</strong></div><div><span>Minimum useful findings</span><strong>${Number(trial.retentionThresholds.minimumUsefulFindings || 0)}</strong></div><div><span>Maximum cost per useful finding</span><strong>${money(trial.retentionThresholds.maximumCostPerUsefulFindingCents || 0)}</strong></div></div>`)}
      ${trial.result?.baselineComparison ? detailSection("Measured result", `<p>${escapeHtml(trial.result.baselineComparison)}</p>`) : ""}
    </div>`, { wide: true, state: { kind, id }, preserveFocus: options.preserveFocus });
    return;
  }
  if (kind === "decision") {
    const item = await fetchJson(`/api/decisions/${encodeURIComponent(id)}`);
    const aiCheck = Boolean(item.provider || item.model || item.worker);
    const liveResearch = item.tools?.some((tool) => ["research_adapter", "live_web_with_approval"].includes(tool));
    const handoffDecision = item.decisionKind === "handoff";
    const qualityReview = ["quality_reviewer", "quality reviewer"]
      .includes(String(item.worker || "").trim().toLowerCase());
    const finalQualityRecheck = qualityReview && (
      item.finalQualityRecheck === true
      || Number(item.correctionNumber || 0) > 0
    );
    const catalogueBuild = item.decisionActionKind === "catalogue_build";
    const validationProductBuild = catalogueBuild && item.productBuild?.validationSample === true;
    const explicitOperatorFinalReview = item.explicitOperatorFinalReview === true;
    const inspectionEvidenceRecheck = item.inspectionEvidenceRecheck === true;
    const launchReadiness = item.decisionActionKind === "launch_readiness";
    const dataProtection = item.decisionActionKind === "data_protection";
    const validationBuildPlatform = item.productBuild?.channel?.platformName || "the selected platform";
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
    const whatHappens = dataProtection
      ? "Pantheon will activate these local record-handling rules for future work. No records will be deleted."
      : inspectionEvidenceRecheck
        ? "The Quality Reviewer will inspect the unchanged customer package using exactly four local images: two storefront previews, the workbook inspection, and the complete three-page setup-guide inspection. If it does not pass, Pantheon stops this build permanently with no retry or model fallback."
      : explicitOperatorFinalReview
        ? "The Quality Reviewer will inspect the exact corrected workbook, setup guide, calculations, and previews once. A pass advances only to buyer-test planning. A revise or stop result ends this build without another paid review."
      : validationProductBuild
      ? `Pantheon will create one functional Excel workbook, setup guide, and two previews, then independently review the exact files. It will not create an account on ${validationBuildPlatform}, publish, contact buyers, advertise, spend externally, or build a wider catalogue.`
      : catalogueBuild
      ? `Pantheon will create and retain the complete ${item.productBuild?.productCount || "planned"}-product catalogue, then run an independent quality review. The files stay local until a later launch decision.`
      : launchReadiness
        ? "Pantheon will mark the finished package ready for the separate Gumroad publishing action. It will not create an account, complete KYC, publish, post, contact anyone, or spend money."
        : handoffDecision
      ? "Pantheon will turn the reviewed result into the next internal work step. Nothing will be published or sent outside Pantheon."
      : liveResearch
        ? `${item.worker || "The Demand Validator"} will search current public sources for buyer demand, alternatives, pricing signals, and a suitable audience. It will return the evidence and recommendation here for your review.`
        : qualityReview
          ? inspectionEvidenceRecheck
            ? "The Quality Reviewer will inspect only the complete local evidence for the unchanged customer package. This is the single evidence recheck; any non-pass result ends the build."
            : finalQualityRecheck
            ? "This is the final independent content recheck after Pantheon used its one permitted product correction. If the corrected files still have a material defect, Pantheon stops. A cut-off or malformed AI answer is recorded separately and can be retried only after a new cost decision."
            : "The Quality Reviewer will inspect the exact product files. If it finds one fixable defect, Pantheon may make its single permitted internal correction and recheck it automatically within the journey's total spending limit. It stops if the corrected package still fails."
        : aiCheck
          ? `${item.worker || "The AI worker"} will complete this one check and return the result for your review.`
          : "Pantheon will carry out only the work described in this decision.";
    const limits = item.effects?.length
      ? `Only these approved effects are allowed: ${item.effects.map((effect) => String(effect).replace(/\.*$/, "")).join(", ")}.`
      : "It cannot publish, contact anyone, change an account, sign anything, or move money.";
    const costStatement = Number(item.maxCostCents || 0) > 0
      ? `The absolute cost limit is ${money(item.maxCostCents)}.${pricedBound}`
      : "No provider spend is approved by this decision.";
    const productBuild = item.productBuild
      ? detailSection("What will be built", `<div class="review-facts"><div><span>Products</span><strong>${escapeHtml(String(item.productBuild.productCount))}</strong></div><div><span>Expected formats</span><strong>${escapeHtml(item.productBuild.formats.join(", ") || "Defined in the build plan")}</strong></div></div>${item.productBuild.items?.length ? `<ol class="catalogue-decision-list">${item.productBuild.items.map((product) => `<li><strong>${escapeHtml(product.title)}</strong>${product.priceCents ? `<span>${money(product.priceCents)}</span>` : ""}</li>`).join("")}</ol>` : ""}<p>${escapeHtml(item.productBuild.qualityBar || "Every file must be complete and customer-usable.")}</p>`)
      : "";
    const reviewFiles = (explicitOperatorFinalReview || inspectionEvidenceRecheck) && item.productFiles?.length
      ? detailSection(inspectionEvidenceRecheck ? "Exact evidence files" : "Corrected files", `<div class="plain-list">${item.productFiles.map((file) => `<article class="plain-row"><div><h3>${escapeHtml(file.name || "Product file")}</h3><p>${escapeHtml(file.qualityReviewOnly ? "Internal file inspection view" : file.summary || humanStatus(file.status))}</p></div><div class="work-actions">${canPreview(file.format) ? `<button class="secondary-button" data-action="open-pdf" data-id="${escapeHtml(file.id)}" data-title="${escapeHtml(file.name || "Product preview")}">${icon("file-search")}Preview</button>` : ""}<a class="secondary-button" href="/api/deliverables/${encodeURIComponent(file.id)}/download">${icon("download")}Download</a></div></article>`).join("")}</div>`)
      : "";
    const technical = [businessContext, execution, productBuild, detailSection("Exact limits", `<p>${escapeHtml(costStatement)}<br>Risk level: ${escapeHtml(humanStatus(item.risk))}.<br>${escapeHtml(limits)}${item.tracePolicy?.providerTraceContent ? "<br>The approved non-personal input and output will be available in the OpenAI trace." : ""}</p>`)].join("");
    openDrawer(item.title, "Your decision", `<div class="review-workspace">
      <section class="result-hero decision-hero"><div><span class="eyebrow">What Pantheon recommends</span><h3>${escapeHtml(item.recommendation)}</h3><p>${escapeHtml(item.expectedUpside)}</p></div>${badge(`${humanStatus(item.risk)} risk`, item.risk === "high" ? "coral" : "amber")}</section>
      ${detailSection("What happens if you continue", `<p class="lead-copy">${escapeHtml(whatHappens)}</p><p>${escapeHtml(costStatement)}</p>`)}
      ${detailSection("What will not happen", `<p>${escapeHtml(limits)}</p>`)}
      ${reviewFiles}
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
  const retryAction = item?.action?.kind === "prepare_known_ai_retry"
    ? item.type === "pre_dispatch_recovery"
      ? `<div class="drawer-footer-copy"><strong>Try this stage again</strong><span>The local problem is fixed. This prepares a fresh exact decision and does not call OpenAI yet.</span></div><button class="primary-button" data-action="prepare-known-ai-retry" data-id="${escapeHtml(item.id)}">${icon("rotate-cw")}${escapeHtml(item.action.label)}</button>`
      : `<div class="drawer-footer-copy"><strong>Prepare one corrected attempt</strong><span>This creates a separate cost decision. It does not call OpenAI yet.</span></div><button class="primary-button" data-action="prepare-known-ai-retry" data-id="${escapeHtml(item.id)}">${icon("rotate-cw")}${escapeHtml(item.action.label)}</button>`
    : "";
  const body = [
    detailSection("What happened", `<p>${escapeHtml(item?.summary || item?.recommendation || "No additional detail is available.")}</p>`),
    item?.recommendation ? detailSection("Recommended next step", `<p>${escapeHtml(item.recommendation)}</p>`) : "",
    item?.expectedUpside ? detailSection("Why this is useful", `<p>${escapeHtml(item.expectedUpside)}</p>`) : "",
  ].join("");
  openDrawer(item?.title || "Details", kind === "review" ? "Review" : "Important work", body, {
    wide: true,
    footer: retryAction,
    state: { kind, id },
    preserveFocus: options.preserveFocus,
  });
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
  if (action === "runtime-standby") {
    const result = await postJson("/api/runtime/standby", {});
    toast("Pantheon is returning to standby.");
    setTimeout(() => { window.location.href = result.controlUrl; }, 250);
    return;
  }
  if (action === "runtime-stop") {
    if (!window.confirm("Stop Pantheon completely? No business work will run until you start it again.")) return;
    await postJson("/api/runtime/stop", {});
    document.body.innerHTML = `<main class="stopped-screen"><div>${icon("power")}<h1>Pantheon has stopped</h1><p>No Pantheon processes remain. Run START PANTHEON.cmd when you need the system again.</p></div></main>`;
    refreshIcons();
    return;
  }
  if (action === "refresh") return loadView(store.view);
  if (action === "close-drawer") return closeDrawer();
  if (action === "close-pdf") return closePdf();
  if (action === "command-mode") {
    store.commandMode = button.dataset.mode;
    return renderView();
  }
  if (action === "decision-tab") { store.decisionTab = button.dataset.tab; return renderDecisions(); }
  if (action === "portfolio-tab") {
    store.portfolioTab = button.dataset.tab;
    renderPortfolio();
    refreshIcons();
    return;
  }
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
  if (action === "open-outputs") {
    store.systemTab = "outputs";
    return loadView("system");
  }
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
      const replacementApprovalId = error.payload?.result?.replacementApprovalId;
      closeDrawer();
      await loadView("decisions", { silent: true });
      if (replacementApprovalId) await showDetail("decision", replacementApprovalId);
      toast("The research details were refreshed safely. Review them, then choose Run this market research once more.");
      return;
    }
    closeDrawer();
    const execution = payload.execution;
    toast(execution?.status === "completed"
      ? "Approved work completed. Review the new result."
      : execution?.status === "blocked"
        ? "Approved, but the work still needs setup or another exact decision."
        : execution?.status === "waiting"
          ? "Approved. An earlier work item must close before this can start; Pantheon has kept it visible."
        : `Decision ${decisionLabels[button.dataset.decision]}.`);
    return loadView(store.view, { silent: true });
  }
  if (action === "handoff-decision") {
    const decisionLabels = { approve: "approved", changes: "changes requested", reject: "declined" };
    const payload = await withRunPolling(() => postJson(`/api/agent-handoffs/${encodeURIComponent(button.dataset.id)}/${button.dataset.decision}`, {
      note: `Dashboard decision: ${decisionLabels[button.dataset.decision]}.`,
    }));
    closeDrawer();
    toast(payload.pantheonDecision?.decision === "approve"
      ? "The package is ready for the separate Gumroad publishing action. Nothing was published automatically."
      : button.dataset.decision === "approve"
        ? payload.execution?.status === "completed"
        ? "Chief of Staff saved the next recommendation. The Test Pack has not been created yet, and nothing was published or sent."
        : "The next recommendation is waiting to be saved."
      : button.dataset.decision === "changes"
        ? "Changes requested. Pantheon will not continue until the result is revised."
        : "This path was stopped. No external action occurred.");
    return loadView("cockpit", { silent: true });
  }
  if (action === "start-discovery") {
    const text = $("#command-text")?.value.trim() || "";
    if (button.dataset.mode === "idea" && !text) {
      throw new Error("Describe the business idea you want Pantheon to review.");
    }
    const payload = await postJson("/api/pantheon/journeys", button.dataset.mode === "idea"
      ? { idea: text }
      : { prompt: text || undefined });
    toast(payload.alreadyRunning
      ? "The current full journey is already open."
      : "Pantheon prepared the complete Luna journey. Continue when you are ready to run the first specialist.");
    return loadView("journey", { silent: true });
  }
  if (action === "start-portfolio-discovery") {
    const mode = button.dataset.mode || "broad";
    const text = $("#command-text")?.value.trim() || "";
    if (mode === "idea" && !text) {
      throw new Error("Describe the business idea you want Pantheon to compare.");
    }
    const payload = await postJson("/api/portfolio/discovery", {
      developerRecovery: store.data.portfolio?.nextAction?.developerRecovery === true,
      idea: mode === "idea" ? text : undefined,
      prompt: mode === "broad" && text ? text : undefined,
    });
    toast(payload.started
      ? "Pantheon prepared the next bounded market scan."
      : payload.message || "The portfolio scan is already in progress.");
    return loadView("portfolio", { silent: true });
  }
  if (action === "continue-portfolio") {
    const payload = await withRunPolling(() => postJson("/api/pantheon/run", { maxSteps: 2 }));
    toast(payload.result?.cycle?.summary || "Pantheon completed the next research step.");
    return loadView("portfolio", { silent: true });
  }
  if (action === "prepare-portfolio-retry") {
    const payload = await postJson(`/api/tasks/${encodeURIComponent(button.dataset.id)}/prepare-known-ai-retry`, {});
    toast(payload.result?.mandate?.approved
      ? "One corrected internal research attempt is ready. OpenAI has not been called yet."
      : "One corrected research attempt is ready for review. OpenAI has not been called yet.");
    return loadView("portfolio", { silent: true });
  }
  if (action === "commercial-search") {
    const query = $("#commercial-query")?.value.trim();
    if (!query) throw new Error("Enter a business question to search.");
    store.commercialSearch = await fetchJson(`/api/commercial/knowledge?query=${encodeURIComponent(query)}&limit=8`);
    renderPortfolio();
    refreshIcons();
    return;
  }
  if (action === "prepare-buyer-intent") {
    const payload = await postJson(
      `/api/commercial/investment-cases/${encodeURIComponent(button.dataset.id)}/prepare-buyer-intent-test`,
      {
        specId: button.dataset.specId,
        expectedDecisionHash: button.dataset.decisionHash,
      },
    );
    closeDrawer();
    store.decisionTab = "approvals";
    await loadView("decisions", { silent: true });
    if (payload.build?.approval?.id) await showDetail("decision", payload.build.approval.id);
    toast("The one-product buyer test is prepared. Review the exact workbook build before OpenAI is called.");
    return;
  }
  if (action === "start-journey") {
    const prompt = $("#journey-prompt")?.value.trim() || undefined;
    const payload = await postJson("/api/pantheon/journeys", { prompt });
    toast(payload.alreadyRunning ? "The current full journey is already open." : "The full Luna journey is ready. Continue when you are ready to run the first specialist.");
    return loadView("journey", { silent: true });
  }
  if (action === "restart-journey") {
    const payload = await postJson("/api/pantheon/journeys", { mode: "rehearsal", force: true });
    toast(`A clean Luna rehearsal is ready. ${money(payload.state?.exposure?.totalCents || 0)} of earlier proof exposure remains counted.`);
    return loadView("journey", { silent: true });
  }
  if (action === "continue-journey") {
    const payload = await withRunPolling(() => postJson(`/api/pantheon/journeys/${encodeURIComponent(button.dataset.id)}/continue`, {}));
    toast(payload.result?.cycle?.summary || `Journey: ${humanStatus(payload.state?.journey?.status || "complete")}.`);
    return loadView("journey", { silent: true });
  }
  if (action === "run-pantheon") {
    const payload = await withRunPolling(() => postJson("/api/pantheon/run", { maxSteps: 1 }));
    toast(payload.result?.cycle?.summary || `Pantheon: ${humanStatus(payload.result?.status || "complete")}.`);
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
  if (action === "prepare-retention-decision") {
    await postJson("/api/system/retention/prepare-decision", {});
    store.decisionTab = "approvals";
    return loadView("decisions", { silent: true });
  }
  if (action === "run-next") {
    const result = await withRunPolling(() => postJson("/api/runtime/tick", {}));
    toast(result.result?.message || `Internal work: ${humanStatus(result.result?.status || "complete")}.`);
    return loadView("system", { silent: true });
  }
  if (action === "run-task") {
    const payload = await withRunPolling(() => postJson(`/api/tasks/${encodeURIComponent(button.dataset.id)}/run`, {}));
    const incorporated = payload.continuation?.actions?.some((item) => item.type === "result_projected");
    toast(payload.result?.status === "completed"
      ? incorporated
        ? "That work completed and Pantheon applied the result."
        : "That work item completed."
      : payload.result?.message || `Work item: ${humanStatus(payload.result?.status || "complete")}.`);
    return loadView(store.view, { silent: true });
  }
  if (action === "prepare-known-ai-retry") {
    const payload = await postJson(`/api/tasks/${encodeURIComponent(button.dataset.id)}/prepare-known-ai-retry`, {});
    closeDrawer();
    await loadView("decisions", { silent: true });
    if (payload.result?.approval?.id) await showDetail("decision", payload.result.approval.id);
    toast(payload.result?.technicalRecovery
      ? "A fresh decision for the same stage is ready. OpenAI has not been called yet."
      : "The corrected Luna retry is ready for your exact cost decision. OpenAI has not been called yet.");
    return;
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
        note: "The analysis needs to be clearer or more useful before Pantheon continues.",
      });
      closeDrawer();
      toast("A better analysis was requested. Pantheon will not continue from this result.");
      return loadView("cockpit", { silent: true });
    }
    await loadView(store.view, { silent: true });
    await showDetail("agent-run", runId, { preserveFocus: true });
    toast("Review recorded. Now choose what Pantheon should do next.");
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
    headers: { "x-pantheon-bootstrap": bootstrapToken, "x-jarvis-bootstrap": bootstrapToken },
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
    setConnection(false, error.status === 401 ? "Start Pantheon" : "Offline");
    if (error.status === 401) {
      $("#view").innerHTML = emptyState(
        "Start Pantheon to open this dashboard",
        "This window does not have an operator session. Close it, run the Pantheon launcher, and use the secure dashboard window it opens.",
        "shield-alert",
      );
      refreshIcons();
    }
    toast(error.message);
  }
}

boot();
