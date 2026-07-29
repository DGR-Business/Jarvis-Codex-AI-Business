const store = {
  view: "cockpit",
  data: {},
  csrfToken: null,
  decisionTab: "approvals",
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
  journey: { title: "Full Journey", kicker: "Authorised work and evidence", endpoint: "/api/journey" },
  decisions: { title: "Decisions", kicker: "Your attention", endpoint: "/api/decisions" },
  portfolio: { title: "Portfolio", kicker: "Evidence before investment", endpoint: "/api/portfolio" },
  tests: { title: "Tests & Results", kicker: "Buyer and cash evidence", endpoint: "/api/tests" },
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
    active: "Active record",
    proving: "Proof stage",
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
    ready_to_publish: "Publication-ready record",
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
  select.disabled = true;
  select.setAttribute("aria-disabled", "true");
  select.title = "Venture switching is read-only until the protected switch control is available.";
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

function approvalButtons(item, compactButtons = false, options = {}) {
  const sizeClass = compactButtons ? "" : "";
  const action = item.decisionKind === "handoff"
    ? "handoff-decision"
    : item.decisionKind === "commercial_lifecycle"
      ? "commercial-lifecycle-decision"
      : "approval";
  const liveResearch = item.tools?.some((tool) => ["research_adapter", "live_web_with_approval"].includes(tool));
  const approvalLabel = item.approveLabel || (item.decisionKind === "handoff"
    ? "Prepare next step"
    : liveResearch
      ? "Run this market research"
      : Number(item.maxCostCents || 0) > 0 || item.provider
        ? "Start this AI check"
        : "Approve");
  const approveButton = options.allowApprove === false
    ? ""
    : `<button class="primary-button" data-action="${action}" data-id="${escapeHtml(item.id)}" data-decision="approve" data-scope-hash="${escapeHtml(item.scopeHash)}">${icon("check")}${escapeHtml(approvalLabel)}</button>`;
  return `<div class="work-actions ${sizeClass}">
    ${approveButton}
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

function workItemCanRun(item) {
  return item?.can_run === true;
}

function workItemHasRunAuthorityState(item) {
  return Boolean(item)
    && (
      Object.prototype.hasOwnProperty.call(item, "can_run")
      || typeof item.safety_reason === "string"
    );
}

function workItemIsSafeInternal(item) {
  return workItemCanRun(item) && item?.safe_to_run === true;
}

function workItemNeedsCommercialAuthority(item) {
  const classification = String(item?.safety_classification || "").toLowerCase();
  const reason = String(item?.safety_reason || "").toLowerCase();
  return classification.includes("commercial")
    || /(commercial|authority|contract|binding|venture)/.test(reason);
}

function workItemUnavailableReason(item) {
  const reason = String(item?.safety_reason || "");
  if (workItemNeedsCommercialAuthority(item)) {
    return "Current commercial authority does not allow this step";
  }
  if (/approval|decision/i.test(reason) || ["blocked", "waiting_approval"].includes(item?.status)) {
    return "A recorded decision is required";
  }
  if (/predecessor|dependency|earlier|prior/i.test(reason)) {
    return "Earlier work must finish first";
  }
  return reason ? humanStatus(reason) : "No current run authority";
}

function workItemRunControl(item, className = "primary-button") {
  if (workItemCanRun(item)) {
    return `<button class="${className}" data-action="run-task" data-id="${escapeHtml(item.id)}" data-execution-kind="${escapeHtml(item.execution_kind || "internal")}">${icon("play")}${escapeHtml(item.run_label || "Run internal step")}${Number(item.max_cost_cents || 0) > 0 ? ` / up to ${money(item.max_cost_cents)}` : ""}</button>`;
  }
  const reason = workItemUnavailableReason(item);
  const review = workItemNeedsCommercialAuthority(item)
    ? `<button class="text-button" data-view="tests">Review authority</button>`
    : ["blocked", "waiting_approval", "needs_attention"].includes(item?.status)
      ? `<button class="text-button" data-view="decisions">Review</button>`
      : "";
  return `<div class="work-actions run-unavailable"><span class="muted-text"${item?.safety_reason ? ` title="${escapeHtml(item.safety_reason)}"` : ""}>${escapeHtml(reason)}</span>${review}</div>`;
}

function renderCommandBand(data) {
  const discovery = data.commercialDiscovery || {};
  const portfolio = discovery.portfolio || {};
  const journey = data.currentJourney;
  const journeyStopped = ["cancelled", "stopped_after_correction", "stopped_unknown_outcome"].includes(journey?.status);
  const journeyRunProved = journey?.execution?.running === true;
  const journeyAuthorized = journey?.execution?.authorized === true;
  const journeyBlocked = journey?.execution?.blocked === true;
  const journeyBadge = journeyRunProved
    ? "Running"
    : journeyBlocked
      ? "Blocked"
      : journeyAuthorized
        ? "Authorised — not running"
        : "Read-only history";
  const journeyStatusClass = journeyRunProved
    ? "working"
    : journeyBlocked
      ? "needs-attention"
      : "waiting-to-start";
  const active = discovery.activeRound;
  const portfolioComplete = !active
    && Number(portfolio.evidenceRoundCount || 0) >= 2
    && portfolio.nextAction?.action == null;
  const currentTask = discovery.currentTask;
  const journeyProgress = journey
    ? `<div class="discovery-progress">
        <span class="status-dot ${journeyStatusClass}"></span>
        <div><strong>${escapeHtml(humanStatus(journey.activeStage))}</strong><p>${escapeHtml(journey.currentTask?.title || (journeyStopped ? "No further work will start automatically; review the recorded result first." : "This retained journey cannot continue without exact current commercial authority."))}</p></div>
        ${badge(journeyBadge)}
      </div>`
    : "";
  const discoveryProgress = !journey && active
    ? `<div class="discovery-progress">
        <span class="status-dot waiting-to-start"></span>
        <div><strong>Retained portfolio history</strong><p>${escapeHtml(currentTask?.title || active.prompt || "Earlier portfolio evidence retained for audit.")}</p></div>
        ${badge("Read-only history")}
      </div>`
    : "";
  return `<section class="command-band">
    <div>
      <span class="section-label">${journey ? "Recorded business journey" : active ? "Retained commercial work" : portfolioComplete ? "Research complete" : "Next commercial gate"}</span>
      <h2>${journey ? `Pantheon ${journeyRunProved ? "is working on" : journeyStopped ? "stopped at" : "last recorded"} ${escapeHtml(humanStatus(journey.activeStage))}` : active ? "The earlier portfolio round is read-only" : portfolioComplete ? escapeHtml(portfolio.nextAction?.label || "Commercial review complete") : "Commercial research needs an authorised plan"}</h2>
      <p>${journey ? journeyRunProved ? "Exact contract-bound internal work is running. Open the journey to review its progress, evidence, and costs." : journeyAuthorized ? "This journey has exact current authority, but no task is running now." : "Open the retained journey to review its workers, outputs, costs, and stop point. It cannot continue without exact current commercial authority." : active ? "Pantheon has kept this evidence for audit, but the retired broad-research controls cannot create new work." : portfolioComplete ? escapeHtml(portfolio.nextAction?.detail || "Review the retained evidence before authorising any further research.") : "No test or new research is running. Review the commercial authority record before Pantheon prepares any further market work."}</p>
    </div>
    <div class="command-controls">
      ${journey
        ? `<button type="button" class="primary-button" data-view="journey">${icon("route")}${journeyRunProved ? "Open active journey" : "Review recorded journey"}</button>`
        : active
        ? `<button type="button" class="secondary-button" data-view="portfolio">${icon("search")}View opportunities</button>`
        : portfolioComplete
          ? `<button type="button" class="primary-button" data-view="portfolio">${icon("briefcase-business")}Review investment cases</button>`
          : `<button type="button" class="primary-button" data-view="tests">${icon("shield-check")}Review commercial authority</button>`}
    </div>
    ${journeyProgress || discoveryProgress}
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
    return `<section class="priority-panel clear"><div class="priority-header"><div><span class="eyebrow">Important work</span><h2>No owner action is currently listed</h2><p>This view has no current decision or runnable item to present.</p></div>${badge("Nothing listed", "sky")}</div></section>`;
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
        : ["queued_work", "approved_work"].includes(item.type) || workItemHasRunAuthorityState(item)
          ? workItemRunControl(item)
          : `<button class="secondary-button" data-action="open-drawer" data-kind="work" data-id="${escapeHtml(item.id)}">${icon("arrow-right")}Review</button>`}
    </article>`).join("")}</div>
  </section>`;
}

function renderWeeklyDigest(digest) {
  if (!digest) return "";
  const metrics = digest.metrics || {};
  const commercialTruthWithheld = metrics.commercialIntegrityStatus !== "ok";
  const hasCurrentTest = metrics.currentTest?.canonicalOwnerProjection === true;
  const verifiedBuyers = !commercialTruthWithheld
    && Number.isSafeInteger(metrics.verifiedBuyerCount)
    ? metrics.verifiedBuyerCount
    : null;
  const buyerTarget = Number.isSafeInteger(metrics.buyerTarget)
    ? metrics.buyerTarget
    : hasCurrentTest
      ? 3
      : null;
  const buyerProofLabel = commercialTruthWithheld
    ? "Withheld"
    : !hasCurrentTest
      ? "No current test"
      : verifiedBuyers === null
        ? "Withheld"
    : `${verifiedBuyers}/${buyerTarget}`;
  return `<section class="weekly-brief">
    <div><span class="eyebrow">Weekly executive brief</span><h2>${escapeHtml(digest.summary)}</h2><p>${escapeHtml(shortDate(digest.period_start))} to ${escapeHtml(shortDate(digest.period_end))}</p></div>
    <dl class="brief-facts"><div><dt>Work completed</dt><dd>${metrics.completedWork || 0}</dd></div><div><dt>Buyer proof</dt><dd>${buyerProofLabel}</dd></div><div><dt>Needs attention</dt><dd>${metrics.liveImportantItems ?? (Number(metrics.openDecisions || 0) + Number(metrics.unknownOutcomes || 0))}</dd></div></dl>
  </section>`;
}

function renderCockpit() {
  const data = store.data.cockpit;
  const economics = data.economics;
  const spend = data.spend;
  const test = data.currentTest;
  const commercialTruthNotCurrent = (
    economics?.commercialIntegrityStatus === "ok"
    && economics?.buyerProofStatus === "not_current"
    && economics?.cashContributionStatus === "not_current"
  );
  const commercialTruthWithheld = (
    economics?.commercialIntegrityStatus !== "ok"
    || economics?.buyerProofStatus === "withheld"
    || economics?.cashContributionStatus === "withheld"
  );
  const cashSettled = (
    !commercialTruthWithheld
    && economics?.cashContributionStatus === "settled"
    && Number.isSafeInteger(economics?.cashContributionCents)
  );
  const verifiedBuyerCount = !commercialTruthWithheld
    && Number.isSafeInteger(economics?.independentBuyers)
    ? economics.independentBuyers
    : null;
  const verifiedBuyerTarget = Number.isSafeInteger(economics?.buyerTarget)
    ? economics.buyerTarget
    : test
      ? 3
      : null;
  const buyerProofLabel = commercialTruthWithheld
    ? "Buyer proof withheld — commercial truth needs review"
    : commercialTruthNotCurrent
      ? "No current commercial test buyer result"
      : verifiedBuyerCount === null
        ? "Buyer proof withheld — commercial truth needs review"
    : `${verifiedBuyerCount} / ${verifiedBuyerTarget} verified independent buyers`;
  const discovery = data.commercialDiscovery || {};
  const portfolio = discovery.portfolio || {};
  const journey = data.currentJourney;
  const productionPlan = discovery.production?.plans?.[0] || null;
  const verifiedJourneyRun = journey?.execution?.running === true;
  const retainedLegacyCommercialRecord = Boolean(
    journey
    || productionPlan
    || discovery.topOpportunity
    || discovery.activeRound,
  );
  const nextMoneyMove = verifiedJourneyRun
    ? `A contract-bound internal task is running for ${humanStatus(journey.activeStage).toLowerCase()}.`
    : data.nextMoneyMove
      || (retainedLegacyCommercialRecord
        ? "Review the retained commercial history; it does not provide current build, test, or publication authority."
        : "No current commercial test is authorised.");
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
      Boolean(discovery.activeRound || productionPlan || test || journey),
      journey?.status,
      null,
    )}
    <section class="money-move">
      <span class="move-icon">${icon("move-right")}</span>
      <div><span class="eyebrow">Next money move</span><h2>${escapeHtml(nextMoneyMove)}</h2><p>Internal work runs only when its recorded state and authority allow it. Protected external actions remain separate owner decisions.</p></div>
      <button class="secondary-button" data-view="portfolio">${icon("briefcase-business")}Open portfolio</button>
    </section>
    ${data.activeRuns?.length ? `<section class="active-run-strip">${sectionHeading("AI working now", "A genuine worker is running. Open the record to follow its plain-language progress.")}${data.activeRuns.map(renderAgentRunRow).join("")}</section>` : ""}
    <section>
      ${sectionHeading(
    "Business position",
    "One venture; buyer and cash proof appears only from the verified commercial ledger.",
  )}
      <div class="metric-grid">
        <div class="metric mint"><span>Active venture</span><strong>${escapeHtml(data.activeVenture.name)}</strong><small>${escapeHtml(humanStatus(data.activeVenture.lifecycle_stage))}</small></div>
        <div class="metric sky"><span>Current test</span><strong>${test ? escapeHtml(test.name) : "Not started"}</strong><small>${test ? escapeHtml(humanStatus(test.status)) : "Evidence selection comes first"}</small></div>
        <div class="metric ${commercialTruthWithheld ? "coral" : cashSettled ? economics.cashContributionCents >= 0 ? "mint" : "coral" : "amber"}"><span>Actual net cash contribution</span><strong>${commercialTruthWithheld ? "Withheld — needs review" : commercialTruthNotCurrent ? "No current test result" : cashSettled ? money(economics.cashContributionCents, "AUD") : "Not settled"}</strong><small>${escapeHtml(buyerProofLabel)}</small></div>
        <div class="metric amber"><span>Monthly AI and tool cap</span><strong>${money(spend.monthlyCapCents, spend.currency)}</strong><small>${money(spend.exposureCents, spend.currency)} used or committed; ${money(spend.availableCents, spend.currency)} available</small></div>
      </div>
    </section>
      ${renderWeeklyDigest(data.weeklyDigest)}
      <div class="two-column">
      <section class="section-block">
        ${sectionHeading(
    "Current commercial test",
    "What is being tested and what would make it worth continuing.",
  )}
        ${test ? `<div class="surface-block accent test-summary">
          <header><div><span class="eyebrow">${escapeHtml(humanStatus(test.status))}</span><h2>${escapeHtml(test.name)}</h2></div></header>
          <p>${escapeHtml(test.hypothesis || "The test hypothesis has not been written yet.")}</p>
          <dl><div><dt>Buyer</dt><dd>${escapeHtml(test.buyer || "Not stated")}</dd></div><div><dt>Problem</dt><dd>${escapeHtml(test.problem || "Not stated")}</dd></div><div><dt>Offer</dt><dd>${escapeHtml(test.offer || "Not stated")}</dd></div><div><dt>Price</dt><dd>${Number.isSafeInteger(test.price_cents) ? money(test.price_cents, "AUD") : "Not set"}</dd></div><div><dt>Channel</dt><dd>${escapeHtml(test.channel || "Not selected")}</dd></div><div><dt>Evidence period</dt><dd>${escapeHtml(ownerTestPeriodLabel(test.reportingPeriod))}</dd></div><div><dt>Proof rule</dt><dd>At least 3 verified independent paying buyers and positive settled net cash contribution after all attributable costs.</dd></div></dl>
          <button class="text-button" data-view="tests">Open Tests &amp; Results ${icon("arrow-right")}</button>
        </div>` : emptyState("No market test is running", "No current test authority or verified market result is shown here. Review Tests & Results for the canonical position.", "flask-conical")}
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
    const backendMarksRetained = (
      active.status === "retained_read_only"
      && active.readOnly === true
      && active.live === false
      && active.legacyPathRetired === true
    );
    return `<section class="portfolio-now" data-retained-source="${backendMarksRetained ? "backend" : "fail-closed"}">
      <div class="portfolio-now-mark">${icon("archive")}</div>
      <div>
        <span class="eyebrow">Retained portfolio history</span>
        <h2>${escapeHtml(task?.title || active.prompt || "Earlier portfolio round")}</h2>
        <p>${backendMarksRetained ? "This round is marked read-only by the operating record." : "This earlier round is being treated as read-only because no current authority marker is available."} Its stored status does not mean research is running or authorised now.</p>
      </div>
      <button class="secondary-button" data-view="tests">${icon("shield-check")}Review commercial authority</button>
    </section>`;
  }
  if (data.nextAction?.action === "start_portfolio_discovery") {
    return `<section class="portfolio-now">
      <div class="portfolio-now-mark">${icon("shield-check")}</div>
      <div>
        <span class="eyebrow">Current direction</span>
        <h2>Review Tests &amp; Results</h2>
        <p>The stored portfolio suggestion cannot start work. New commercial research needs an exact reviewed and activated authority record.</p>
      </div>
      <button class="primary-button" data-view="tests">${icon("shield-check")}Review commercial authority</button>
    </section>`;
  }
  return `<section class="portfolio-now">
    <div class="portfolio-now-mark ${data.selectedInvestmentCase ? "complete" : ""}">${icon(data.selectedInvestmentCase ? "badge-check" : "pause")}</div>
    <div>
      <span class="eyebrow">${data.selectedInvestmentCase ? "Historical investment review" : "Portfolio record"}</span>
      <h2>${data.selectedInvestmentCase ? "The recorded case is retained for audit" : "No current portfolio action is authorised"}</h2>
      <p>${data.selectedInvestmentCase ? "Review the historical case for context. Current direction comes from the canonical Tests & Results authority record." : "Pantheon has retained the available result without treating it as current work."}</p>
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
      data.activeRound ? "No opportunities are retained in this historical round" : "No portfolio evidence is recorded",
      data.activeRound
        ? "The earlier round is read-only and is not running a market scan now."
        : "A current authorised research plan is required before new evidence can be gathered.",
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
        <small>${escapeHtml(compact(item.rationale || `Historical direction (audit only): ${item.next_action || "None recorded"}`, 150))}</small>
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

function ownerTestUtcDateTime(value) {
  if (!value) return "Not set";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
  }).format(date);
}

function ownerTestPeriodLabel(period) {
  if (!period?.startsAt || !period?.endsAt) return "Not set";
  return `${ownerTestUtcDateTime(period.startsAt)} to ${ownerTestUtcDateTime(period.endsAt)}`;
}

function ownerTestProofPresentation(item) {
  const proof = item?.proof || {};
  const buyers = proof.buyers || {};
  const proofStatusIsExplicit = typeof proof.commercialProofReached === "boolean";
  const buyerFiguresPresent = (
    Object.prototype.hasOwnProperty.call(buyers, "verifiedPositive")
    && Object.prototype.hasOwnProperty.call(buyers, "target")
  );
  const verified = buyers.verifiedPositive;
  const target = buyers.target;
  const buyerFiguresValid = (
    proofStatusIsExplicit
    && buyerFiguresPresent
    && Number.isSafeInteger(verified)
    && verified >= 0
    && Number.isSafeInteger(target)
    && target > 0
    && (proof.commercialProofReached !== true || verified >= target)
  );
  const netCash = proof.netCashContribution || {};
  const settledCashValid = (
    proofStatusIsExplicit
    &&
    netCash.status === "settled"
    && netCash.currency === "AUD"
    && Number.isSafeInteger(netCash.amountCents)
    && (proof.commercialProofReached !== true || netCash.amountCents > 0)
  );
  const unsettledCashValid = (
    proofStatusIsExplicit
    && netCash.status === "not_settled"
    && netCash.currency === "AUD"
    && netCash.amountCents === null
  );
  const cashFiguresValid = settledCashValid || unsettledCashValid;
  return {
    verified: buyerFiguresValid ? verified : null,
    target: buyerFiguresValid ? target : null,
    buyerFiguresValid,
    buyersLabel: buyerFiguresValid ? `${verified} / ${target}` : "Withheld - needs review",
    buyersComplete: buyerFiguresValid && verified >= target,
    cashFiguresValid,
    cashSettled: settledCashValid,
    cashAmountCents: settledCashValid ? netCash.amountCents : null,
    cashLabel: settledCashValid
      ? money(netCash.amountCents, "AUD")
      : unsettledCashValid
        ? "Not settled"
        : "Withheld - needs review",
  };
}

function ownerTestEvidenceTone(status) {
  if (status === "complete") return "mint";
  if (status === "not_started") return "sky";
  if (status === "collecting") return "amber";
  return "coral";
}

function ownerTestLifecycleTone(status) {
  if (status === "activated") return "running";
  if (["closed", "completed"].includes(status)) return "complete";
  return "attention";
}

function ownerClosedTestHistory(history) {
  const items = Array.isArray(history?.items) ? history.items : [];
  const total = Number.isSafeInteger(history?.total) ? history.total : items.length;
  const rows = items.length
    ? items.map((item) => {
      const proof = ownerTestProofPresentation(item);
      const lifecycle = item.lifecycle || {};
      const evidence = item.evidenceQuality || {};
      const title = item.title || item.offer?.description || "Closed commercial test";
      const buyer = typeof item.buyer === "string" ? item.buyer : item.buyer?.summary;
      return `<article class="closed-test-row">
        <div>
          <span class="eyebrow">${escapeHtml(lifecycle.label || humanStatus(lifecycle.status || "closed"))} · ${escapeHtml(shortDate(lifecycle.closedAt || item.closedAt))}</span>
          <h3>${escapeHtml(title)}</h3>
          <p>${escapeHtml(buyer || "Buyer not stated")}</p>
        </div>
        <div class="closed-test-proof">
          <span><b>${escapeHtml(evidence.label || humanStatus(evidence.status || "incomplete"))}</b> evidence</span>
          <span><b>${escapeHtml(proof.buyersLabel)}</b> verified buyers</span>
          <span><b>${escapeHtml(proof.cashLabel)}</b> net cash</span>
        </div>
      </article>`;
    }).join("")
    : '<p class="closed-test-empty">No commercial tests have been closed yet.</p>';
  return `<details class="closed-test-history">
    <summary><span>Closed history</span><strong>${total}</strong></summary>
    <div class="closed-test-list">${rows}</div>
  </details>`;
}

function ownerTestsAttention(title, summary) {
  return `<section class="stage-callout coral owner-tests-attention" role="status">
    <div><span class="section-label">Tests &amp; Results</span><h2>${escapeHtml(title)}</h2><p>${escapeHtml(summary)}</p></div>
    ${badge("Needs attention", "coral")}
  </section>`;
}

function ownerTestsMarkup(data = {}) {
  if (data.schema !== "pantheon.owner-tests-results.v1") {
    return `<div class="view-stack owner-tests-results" data-read-only="true">${ownerTestsAttention(
      "Commercial results are not ready to display",
      "Pantheon has not produced the current verified buyer-and-cash view. No result is being assumed.",
    )}</div>`;
  }

  const integrity = data.integrity || {};
  if (integrity.status !== "ok") {
    return `<div class="view-stack owner-tests-results" data-read-only="true">${ownerTestsAttention(
      "Commercial records need reconciliation",
      integrity.message || "Pantheon cannot identify one trustworthy current commercial test, so it is withholding buyer and cash claims.",
    )}</div>`;
  }

  const history = ownerClosedTestHistory(data.closedHistory);
  const current = data.current;
  if (!current) {
    return `<div class="view-stack owner-tests-results" data-read-only="true">
      ${emptyState(
    data.emptyState?.title || "No commercial test is authorised",
    data.emptyState?.summary || "Pantheon will show one test here only after its exact offer, channel, evidence rules, and authority are recorded.",
    "flask-conical",
  )}
      ${history}
    </div>`;
  }

  const lifecycle = current.lifecycle || {};
  const evidence = current.evidenceQuality || {};
  const proof = ownerTestProofPresentation(current);
  const allowed = Array.isArray(data.controls?.allowed) ? data.controls.allowed : [];
  const canReviewDecision = (
    ["proposed", "accepted", "paused"].includes(lifecycle.status)
    && allowed.includes("review_decision")
    && current.reviewDecision?.id
  );
  const title = current.title || current.offer?.description || "Current commercial test";
  const buyer = typeof current.buyer === "string" ? current.buyer : current.buyer?.summary;
  const offer = current.offer?.description || "Not stated";
  const channel = current.channel?.label || current.channel?.id || "Not set";
  const price = (
    current.price?.currency === "AUD"
    && Number.isSafeInteger(current.price?.amountCents)
  ) ? money(current.price.amountCents, "AUD") : "Not set";
  const evidenceStatus = evidence.status || "incomplete";
  const evidenceLabel = evidence.label || humanStatus(evidenceStatus);
  const cashTone = !proof.cashFiguresValid
    ? "coral"
    : proof.cashSettled
    ? proof.cashAmountCents >= 0 ? "mint" : "coral"
    : "amber";

  return `<div class="view-stack owner-tests-results" data-read-only="true">
    <section class="portfolio-now owner-current-test">
      <span class="portfolio-now-mark ${ownerTestLifecycleTone(lifecycle.status)}">${icon("flask-conical")}</span>
      <div>
        <span class="eyebrow">Read-only commercial test · ${escapeHtml(lifecycle.label || humanStatus(lifecycle.status || "inactive"))}</span>
        <h2>${escapeHtml(title)}</h2>
        <p>${escapeHtml(current.hypothesis || "The exact test hypothesis is retained in the commercial record.")}</p>
      </div>
      ${canReviewDecision ? `<button class="primary-button" data-action="open-drawer" data-kind="decision" data-id="${escapeHtml(current.reviewDecision.id)}">${icon("circle-check-big")}Review decision</button>` : ""}
    </section>

    <section class="money-move owner-test-money-move">
      <span class="move-icon">${icon("move-right")}</span>
      <div>
        <span class="eyebrow">Next money move</span>
        <h2>${escapeHtml(current.moneyMove?.title || "Collect the exact buyer and cash evidence for this test.")}</h2>
        <p>${escapeHtml(current.moneyMove?.detail || "Pantheon will keep the test inside its recorded decision rules and protected-action gates.")}</p>
      </div>
    </section>

    <section>
      ${sectionHeading("Proof position", "Only verified independent buyers and settled Australian-dollar cash count.")}
      <div class="metric-grid owner-proof-grid">
        <div class="metric ${ownerTestEvidenceTone(evidenceStatus)}">
          <span>Evidence quality</span>
          <strong>${escapeHtml(evidenceLabel)}</strong>
          <small>${escapeHtml(evidence.summary || "The evidence set is not complete yet.")}</small>
        </div>
        <div class="metric ${!proof.buyerFiguresValid ? "coral" : proof.buyersComplete ? "mint" : "sky"}">
          <span>Verified independent buyers</span>
          <strong>${escapeHtml(proof.buyersLabel)}</strong>
          <small>${proof.buyerFiguresValid ? `Target: ${proof.target} settled buyers with positive value` : "Pantheon could not verify both buyer figures from this record."}</small>
        </div>
        <div class="metric ${cashTone}">
          <span>Actual net cash contribution</span>
          <strong>${escapeHtml(proof.cashLabel)}</strong>
          <small>${!proof.cashFiguresValid ? "Pantheon could not verify the cash status and amount from this record." : proof.cashSettled ? "Revenue, refunds, fees, fulfilment, tools, advertising, and other attributable costs reconciled in AUD." : "Shown only after the evidence period closes and all attributable costs are reconciled."}</small>
        </div>
      </div>
    </section>

    <section class="surface-block test-summary owner-test-facts">
      ${sectionHeading("What is being tested", "This is the exact current offer and measurement boundary. It cannot be edited here.")}
      <dl>
        <div><dt>Buyer</dt><dd>${escapeHtml(buyer || "Not stated")}</dd></div>
        <div><dt>Problem</dt><dd>${escapeHtml(current.problem || "Not stated")}</dd></div>
        <div><dt>Offer</dt><dd>${escapeHtml(offer)}</dd></div>
        <div><dt>Channel</dt><dd>${escapeHtml(channel)}</dd></div>
        <div><dt>Price</dt><dd>${escapeHtml(price)}</dd></div>
        <div><dt>Evidence period</dt><dd>${escapeHtml(ownerTestPeriodLabel(current.reportingPeriod))}</dd></div>
      </dl>
    </section>

    ${history}
  </div>`;
}

function renderTests() {
  $("#view").innerHTML = ownerTestsMarkup(store.data.tests || {});
}

function initials(name) {
  return String(name || "AI").split(/\s+/).map((word) => word[0]).join("").slice(0, 2).toUpperCase();
}

function aiTeamTabs() {
  return `<div class="view-tabs ai-team-tabs" role="tablist" aria-label="AI Team views">
    <button role="tab" aria-selected="${store.aiTeamTab === "team"}" class="${store.aiTeamTab === "team" ? "active" : ""}" data-action="ai-team-tab" data-tab="team">Team</button>
    <button role="tab" aria-selected="${store.aiTeamTab === "runs"}" class="${store.aiTeamTab === "runs" ? "active" : ""}" data-action="ai-team-tab" data-tab="runs">Run records</button>
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
  const body = store.aiTeamTab === "runs" ? renderLiveRuns(data) : `<section>${sectionHeading("AI team and controls", "Every worker record is visible. Each action remains subject to exact authority, approval, cost, and review controls.")}
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
    return data.queue.length ? `<div class="table-wrap"><table><thead><tr><th>Work</th><th>Worker</th><th>Status</th><th>Updated</th><th>Action</th></tr></thead><tbody>${data.queue.map((item) => `<tr><td data-label="Work"><strong>${escapeHtml(item.title)}</strong>${Number(item.max_cost_cents || 0) > 0 ? `<small>Maximum approved cost: ${money(item.max_cost_cents)}</small>` : ""}</td><td data-label="Worker">${escapeHtml(humanStatus(item.agent))}</td><td data-label="Status">${badge(item.status === "running" ? "Running" : item.approval_id && ["blocked", "waiting_approval"].includes(item.status) ? "Waiting for decision" : workItemCanRun(item) ? item.status : workItemUnavailableReason(item))}</td><td data-label="Updated">${escapeHtml(shortDate(item.updated_at))}</td><td data-label="Action">${workItemRunControl(item, "secondary-button")}</td></tr>`).join("")}</tbody></table></div>` : emptyState("The queue is empty", "No queued internal work is recorded at the moment.", "list-checks");
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
  const runnableWork = data.queue.some(workItemIsSafeInternal);
  $("#view").innerHTML = `<div class="view-stack">${systemTabs()}<section><div class="system-toolbar"><button class="secondary-button" data-action="run-next"${runnableWork ? "" : " disabled"}>${icon("play")}${runnableWork ? "Run next internal step" : "No internal step ready"}</button><button class="secondary-button" data-action="maintenance">${icon("wrench")}Run due maintenance</button></div>${renderSystemPanel(data)}</section></div>`;
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
  ready_to_publish: ["Historical publication-ready stage", "Owner record"],
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
    $("#view").innerHTML = `<div class="view-stack">
      <section class="journey-start">
        ${sectionHeading("Business journey is waiting for authority", "Pantheon can only continue a commercial journey after one exact test has been reviewed, accepted, and activated. No broad or unbound journey can be started from this screen.")}
        <div class="journey-start-footer">
          <div><strong>No work has been authorised</strong><span>${escapeHtml(data.commercialControl?.message || "Review the commercial test record before any build, validation, publishing, contact, or spend is prepared.")}</span></div>
          <button class="primary-button" data-view="tests">${icon("clipboard-check")}Review commercial authority</button>
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
  const commercialControlAllowed = data.commercialControl?.allowed === true;
  const journeyReadOnly = !commercialControlAllowed;
  const currentAction = journeyReadOnly || terminalStopped
      ? `<button class="primary-button" data-view="tests">${icon("clipboard-check")}Review commercial authority</button>`
    : finished
      ? `<span class="badge mint">${icon("check")}Recorded complete</span>`
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
  const journeySummary = journeyReadOnly
    ? "This journey is retained as read-only history. Its recorded stage, tasks, files, and costs do not prove that work is running or that build, test, customer contact, or publication is authorised now."
    : terminalStopped
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
    <section class="stage-callout ${journeyReadOnly || needsAttention || terminalStopped ? "coral" : waitingDecision ? "amber" : "mint"} journey-now">
      <div><span class="eyebrow">${journeyReadOnly ? "RETAINED JOURNEY HISTORY" : escapeHtml(journey.mode === "rehearsal" ? "ISOLATED REHEARSAL" : "AUTHORISED JOURNEY")}</span>
      <h2>${journeyReadOnly ? "Recorded stage: " : ""}${escapeHtml(humanStatus(journey.active_stage))}</h2>
      <p>${escapeHtml(journeySummary)}</p></div>
      ${currentAction}
    </section>
    <section class="metric-grid">
      <div class="metric sky"><span>${journeyReadOnly ? "Recorded worker" : terminalStopped ? "Stopped at" : "Current worker"}</span><strong>${escapeHtml(currentTask ? humanStatus(currentTask.agent) : journeyStageDetails[journey.active_stage]?.[1] || "Pantheon")}</strong><small>${escapeHtml(journeyReadOnly ? "Read-only history" : terminalStopped ? humanStatus(journey.status) : currentTask ? humanStatus(currentTask.status) : humanStatus(journey.status))}</small></div>
      <div class="metric mint"><span>Journey exposure</span><strong>${money(exposure.totalCents || 0)}</strong><small>of ${money(journey.budget_cap_cents)} maximum</small></div>
      <div class="metric amber"><span>Opportunities retained</span><strong>${Number((data.candidates || []).length)}</strong><small>Three receive comparable validation</small></div>
      <div class="metric"><span>Files retained</span><strong>${Number((data.outputs || []).length)}</strong><small>Each output remains tied to its source run</small></div>
    </section>
    ${qualityFindingBlock}
    <section>${sectionHeading("Journey progress", journeyReadOnly ? "Recorded stage history only; this journey cannot advance without current exact authority." : "One specialist completes and records each bounded stage before Pantheon advances.")}
      <div class="journey-stage-list">${stageRows}</div>
    </section>
    <div class="two-column">
      <section>${sectionHeading(selected ? "Selected opportunity and product" : "Opportunity shortlist", selection || "Pantheon keeps all findings and explains the eventual choice.")}
        ${candidateRows ? `<div class="plain-list">${candidateRows}</div>` : emptyState(journeyReadOnly ? "No shortlist is retained" : "Research has not completed yet", journeyReadOnly ? "This historical journey has no candidate shortlist to display." : "The shortlist will appear after the Opportunity Scout finishes.", "search")}
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

function approvedEvidencePurpose(file, previewNumber = 1) {
  const role = approvedEvidenceRole(file);
  if (role === "storefront_preview") return `Storefront preview ${previewNumber}`;
  if (role === "workbook_inspection") return "Workbook inspection";
  if (role === "setup_guide_inspection") return "Setup-guide inspection";
  return "Unverified evidence role";
}

function approvedEvidenceRole(file) {
  const identity = `${file?.name || ""} ${file?.summary || ""}`.toLowerCase();
  const explicitRole = String(file?.evidenceRole || "").trim();
  if (file?.qualityReviewOnly !== true) {
    if (explicitRole) return null;
    return identity.includes("storefront") || identity.includes("preview")
      ? "storefront_preview"
      : null;
  }
  if (explicitRole === "workbook_inspection") return "workbook_inspection";
  if (explicitRole === "setup_guide_inspection") return "setup_guide_inspection";
  return null;
}

function inspectApprovedEvidenceSet(files) {
  const source = Array.isArray(files) ? files : [];
  let previewNumber = 0;
  const entries = source.map((file) => {
    const role = approvedEvidenceRole(file);
    if (role === "storefront_preview") previewNumber += 1;
    return {
      file,
      role,
      purpose: approvedEvidencePurpose(file, previewNumber),
    };
  });
  const countRole = (role) => entries.filter((entry) => entry.role === role).length;
  const previewCount = countRole("storefront_preview");
  const workbookCount = countRole("workbook_inspection");
  const setupGuideCount = countRole("setup_guide_inspection");
  const fileIds = source.map((file) => String(file?.id || "").trim());
  const distinctFileIds = (
    fileIds.every(Boolean)
    && new Set(fileIds).size === source.length
  );
  const missing = [];
  if (previewCount !== 2) missing.push("exactly two distinct storefront previews");
  if (workbookCount !== 1) missing.push("one explicit workbook inspection");
  if (setupGuideCount !== 1) missing.push("one explicit setup-guide inspection");
  if (!distinctFileIds || source.length !== 4) missing.push("four distinct retained file IDs");
  const validRoleCount = (
    Math.min(previewCount, 2)
    + (workbookCount === 1 ? 1 : 0)
    + (setupGuideCount === 1 ? 1 : 0)
  );
  return {
    complete: (
      source.length === 4
      && distinctFileIds
      && previewCount === 2
      && workbookCount === 1
      && setupGuideCount === 1
      && entries.every((entry) => entry.role)
    ),
    entries,
    missing,
    validRoleCount,
  };
}

function renderDecisionEvidenceFiles(item, inspectedSet = null) {
  const files = Array.isArray(item?.productFiles) ? item.productFiles : [];
  if (!files.length) return "";
  const evidenceRecheck = item.inspectionEvidenceRecheck === true;
  const evidenceSet = inspectedSet || inspectApprovedEvidenceSet(files);
  const scopeSummary = evidenceRecheck
    ? evidenceSet.complete
      ? `<div class="stage-callout neutral"><div><span class="section-label">Exact approval scope</span><h3>All four exact approved inputs are available</h3><p>The reviewer will see two storefront previews, the workbook inspection, and the complete three-page setup-guide inspection. You can open every file before deciding.</p></div>${badge("4 files", "mint")}</div>`
      : `<div class="stage-callout coral"><div><span class="section-label">Approval set incomplete</span><h3>The four exact evidence roles are not all proven</h3><p>Approval is unavailable until Pantheon provides ${escapeHtml(evidenceSet.missing.join(", "))}. File count alone does not prove that the approval set is complete.</p></div>${badge(`${evidenceSet.validRoleCount}/4 roles`, "coral")}</div>`
    : `<p>These ${files.length} exact file${files.length === 1 ? "" : "s"} are included in this decision.</p>`;
  const fileRows = evidenceSet.entries.map(({ file, purpose }, index) => `<article class="plain-row">
    <div><span class="eyebrow">${escapeHtml(purpose)}</span><h3>${escapeHtml(file.name || `Evidence file ${index + 1}`)}</h3><p>${escapeHtml(file.qualityReviewOnly ? "Internal inspection made from the exact saved customer file." : file.summary || humanStatus(file.status))}</p></div>
    <div class="work-actions">${canPreview(file.format, file.id) ? `<button class="secondary-button" data-action="open-pdf" data-id="${escapeHtml(file.id)}" data-title="${escapeHtml(file.name || `Evidence file ${index + 1}`)}">${icon("file-search")}Preview</button>` : ""}<a class="secondary-button" href="/api/deliverables/${encodeURIComponent(file.id)}/download">${icon("download")}Download</a></div>
  </article>`).join("");
  return detailSection(
    evidenceRecheck ? "Four exact evidence files" : "Files included in this decision",
    `${scopeSummary}<div class="plain-list">${fileRows}</div>`,
  );
}

function inspectionEvidenceStopBoundary(item) {
  if (item?.inspectionEvidenceRecheck !== true) return "";
  return detailSection("Permanent stop boundary", `<div class="stage-callout coral"><div>
    <span class="section-label">This is not a normal retry</span>
    <h3>A non-pass result permanently ends this product build</h3>
    <p>This decision allows one evidence recheck only. It does not allow another product correction, another recheck, or a fallback model. If the reviewer returns revise, stop, or any other non-pass quality result, Pantheon closes this build and keeps the files and findings only as evidence.</p>
  </div>${badge("One recheck only", "coral")}</div>`);
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
      ${detailSection("Historical direction (audit only)", `<p>${escapeHtml(item.next_action || "No historical direction was recorded.")}</p><p>This retained suggestion cannot create current work or buyer evidence.</p>`)}
      ${detailSection("Current direction", `<div class="stage-callout sky"><div><span class="section-label">Canonical control</span><h3>Use Tests &amp; Results</h3><p>Any new commercial work must use the exact reviewed and activated authority record shown there.</p></div><button class="primary-button" data-view="tests">${icon("clipboard-check")}Review commercial authority</button></div>`)}
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
    const commercialLifecycle = item.decisionActionKind === "commercial_lifecycle";
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
    const whatHappens = commercialLifecycle
      ? item.lifecycleEventType === "accepted"
        ? "Pantheon will record your acceptance of this exact commercial test. The test will not become active yet, and nothing will be published, sent, purchased, or spent."
        : "Pantheon will make this accepted contract its one active controlled commercial test. This grants no publishing, customer-contact, account, advertising, or spending permission."
      : dataProtection
      ? "Pantheon will activate these local record-handling rules for future work. No records will be deleted."
      : inspectionEvidenceRecheck
        ? "This is a one-time evidence review, not a product repair or an ordinary retry. The Quality Reviewer will inspect the unchanged customer package using exactly four local images: two storefront previews, the workbook inspection, and the complete three-page setup-guide inspection. If the result is not a pass, Pantheon stops this build permanently."
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
    const inspectedEvidenceSet = inspectionEvidenceRecheck
      ? inspectApprovedEvidenceSet(item.productFiles)
      : null;
    const reviewFiles = renderDecisionEvidenceFiles(item, inspectedEvidenceSet);
    const permanentStopBoundary = inspectionEvidenceStopBoundary(item);
    const technical = [businessContext, execution, productBuild, detailSection("Exact limits", `<p>${escapeHtml(costStatement)}<br>Risk level: ${escapeHtml(humanStatus(item.risk))}.<br>${escapeHtml(limits)}${item.tracePolicy?.providerTraceContent ? "<br>The approved non-personal input and output will be available in the OpenAI trace." : ""}</p>`)].join("");
    const footerCopy = inspectionEvidenceRecheck
      ? inspectedEvidenceSet?.complete
        ? `<div class="drawer-footer-copy"><strong>Approve only if you accept the permanent stop boundary</strong><span>This starts one exact evidence recheck. It does not approve a correction, ordinary retry, or model fallback.</span></div>`
        : `<div class="drawer-footer-copy"><strong>Approval is unavailable</strong><span>The exact four-role evidence set is incomplete or ambiguous. Ask for changes or stop this path.</span></div>`
      : `<div class="drawer-footer-copy"><strong>Choose what happens next</strong><span>Your choice applies only to the work shown here.</span></div>`;
    openDrawer(item.title, "Your decision", `<div class="review-workspace">
      <section class="result-hero decision-hero"><div><span class="eyebrow">What Pantheon recommends</span><h3>${escapeHtml(item.recommendation)}</h3><p>${escapeHtml(item.expectedUpside)}</p></div>${badge(`${humanStatus(item.risk)} risk`, item.risk === "high" ? "coral" : "amber")}</section>
      ${detailSection("What happens if you continue", `<p class="lead-copy">${escapeHtml(whatHappens)}</p><p>${escapeHtml(costStatement)}</p>`)}
      ${permanentStopBoundary}
      ${reviewFiles}
      ${detailSection("What will not happen", `<p>${escapeHtml(limits)}</p>`)}
      ${assignment}
      ${policySummary}
      ${detailDisclosure("Technical details", technical)}
    </div>`, {
      wide: true,
      state: { kind, id },
      preserveFocus: options.preserveFocus,
      footer: `${footerCopy}${approvalButtons(item, false, {
        allowApprove: !inspectionEvidenceRecheck || inspectedEvidenceSet?.complete === true,
      })}`,
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

function maintenanceRunSummary(result) {
  const due = result?.dueCount;
  const claimed = result?.claimedCount;
  const runs = Array.isArray(result?.runs) ? result.runs : null;
  if (
    !Number.isSafeInteger(due)
    || due < 0
    || !Number.isSafeInteger(claimed)
    || claimed < 0
    || claimed > due
    || !runs
  ) {
    return "The maintenance response needs review; no completion is being assumed.";
  }
  const skipped = runs.filter((item) => item?.status === "skipped").length;
  if (runs.length !== due || claimed + skipped !== due) {
    return "The maintenance counts need review; no completion is being assumed.";
  }
  return `Maintenance check: ${due} due; ${claimed} claimed; ${skipped} skipped.`;
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
  if (action === "decision-tab") { store.decisionTab = button.dataset.tab; return renderDecisions(); }
  if (action === "portfolio-tab") {
    store.portfolioTab = button.dataset.tab;
    renderPortfolio();
    refreshIcons();
    return;
  }
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
  if (action === "commercial-lifecycle-decision") {
    const decisionLabels = {
      approve: "approved",
      changes: "sent back for changes",
      reject: "not approved",
    };
    const payload = await postJson(
      `/api/commercial/lifecycle-decisions/${encodeURIComponent(button.dataset.id)}/${button.dataset.decision}`,
      {
        scopeHash: button.dataset.scopeHash,
        note: `Dashboard commercial decision: ${decisionLabels[button.dataset.decision]}.`,
      },
    );
    closeDrawer();
    const lifecycleStatus = payload.result?.lifecycleStatus;
    toast(payload.result?.lifecycleChanged
      ? lifecycleStatus === "accepted"
        ? "The exact commercial test was accepted. Activation remains a separate decision."
        : "The exact commercial test is now active. External actions remain separately locked."
      : payload.result?.changed === false
        ? "That commercial decision was already recorded; nothing changed."
        : "Your commercial decision was recorded. The test did not advance.");
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
  if (action === "commercial-search") {
    const query = $("#commercial-query")?.value.trim();
    if (!query) throw new Error("Enter a business question to search.");
    store.commercialSearch = await fetchJson(`/api/commercial/knowledge?query=${encodeURIComponent(query)}&limit=8`);
    renderPortfolio();
    refreshIcons();
    return;
  }
  if (action === "continue-journey") {
    const payload = await withRunPolling(() => postJson(`/api/pantheon/journeys/${encodeURIComponent(button.dataset.id)}/continue`, {}));
    toast(payload.result?.cycle?.summary || `Journey: ${humanStatus(payload.state?.journey?.status || "complete")}.`);
    return loadView("journey", { silent: true });
  }
  if (action === "maintenance") {
    const payload = await postJson("/api/system/maintenance/run-due", {});
    toast(maintenanceRunSummary(payload.result));
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
  document.body.addEventListener("submit", async (event) => {
    const form = event.target.closest("form[data-action]");
    if (!form) return;
    event.preventDefault();
    const submitButton = form.querySelector("[type='submit']");
    try {
      if (submitButton) submitButton.disabled = true;
      await handleAction(form);
    } catch (error) {
      toast(error.message);
    } finally {
      if (submitButton?.isConnected) submitButton.disabled = false;
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
