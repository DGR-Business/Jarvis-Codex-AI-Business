const labState = {
  state: null,
  active: "command",
};

const concepts = [
  { id: "command", title: "Dark Command Center", note: "alerts, safety, operator focus" },
  { id: "executive", title: "Light Executive Suite", note: "clean, calm, highly legible" },
  { id: "growth", title: "Venture Scorecard", note: "product pipeline and business signal" },
  { id: "timeline", title: "Timeline Operations", note: "sequence, evidence, accountability" },
  { id: "ledger", title: "Control Room Ledger", note: "dense queue plus sticky inspector" },
];

const icons = {
  shield:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 19 6v5c0 4.8-2.9 8.5-7 10-4.1-1.5-7-5.2-7-10V6l7-3Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>',
  queue:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M5 12h14M5 17h9" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  approval:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 12l2 2 4-5M5 4h14v16H5z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>',
  product:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7l8-4 8 4v10l-8 4-8-4V7Zm8 4 8-4M12 11 4 7m8 4v10" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>',
  finance:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2v20M17 6.5c-1-1-2.5-1.5-4.2-1.5-2.1 0-3.8 1-3.8 2.7 0 3.8 8 1.8 8 6.2 0 1.9-1.8 3.1-4.2 3.1-2 0-3.8-.7-4.8-1.8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  plug:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 7V3m6 4V3M7 7h10v4a5 5 0 0 1-10 0V7Zm5 9v5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  pulse:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12h4l2-6 4 12 2-6h6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  clock:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 8v5l3 2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  alert:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 10 18H2L12 3Zm0 6v5m0 3h.01" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  check:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><path d="m8 12 3 3 5-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
};

function $(selector) {
  return document.querySelector(selector);
}

function money(cents, currency = "AUD") {
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format((Number(cents) || 0) / 100);
}

function shortDate(value) {
  if (!value) return "just now";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "just now";
  return date.toLocaleTimeString("en-AU", { hour: "2-digit", minute: "2-digit" });
}

function toneFor(status) {
  const value = String(status || "").toLowerCase();
  if (value.includes("blocked") || value.includes("pending") || value.includes("approval")) return "#f6b84b";
  if (value.includes("failed") || value.includes("error") || value.includes("risk")) return "#ff5c7a";
  if (value.includes("ready") || value.includes("complete") || value.includes("ok")) return "#34c759";
  if (value.includes("dry")) return "#4c8dff";
  return "#38bdf8";
}

function prettyStatus(value) {
  const status = String(value || "idle");
  if (status === "blocked_for_approval") return "needs your approval";
  if (status === "ready_for_review") return "ready for review";
  if (status === "dry_run_complete") return "practice run complete";
  if (status === "dry_run_only") return "practice only";
  if (status === "not_configured" || status === "needs_credentials") return "needs setup";
  if (status === "research_required") return "research needed";
  if (status === "not_generated") return "not scored yet";
  if (status === "monitor.completed") return "system check complete";
  if (status === "scheduler.job.completed") return "scheduled check complete";
  return status.replaceAll("_", " ");
}

function getModel() {
  const state = labState.state || {};
  const metrics = state.metrics || {};
  const workflow = (state.workflows || [])[0] || {};
  const approvals = state.approvals || [];
  const tasks = state.tasks || [];
  const events = state.events || [];
  const integrations = state.integrations || [];
  const products = workflow.metadata?.products || [];
  const pendingApprovals = approvals.filter((item) => item.status === "pending");
  const blockedTasks = tasks.filter((task) => ["blocked", "queued", "planned"].includes(task.status)).slice(0, 5);
  const queueRows = [
    ...pendingApprovals.map((approval) => ({
      kind: "Approval",
      title: approval.title,
      state: approval.status,
      stage: approval.scope,
      gate: approval.risk_level,
      cost: "0",
      updated: approval.requested_at,
      icon: "approval",
      tone: "#f6b84b",
    })),
    ...blockedTasks.map((task) => ({
      kind: "Task",
      title: task.title,
      state: task.status,
      stage: task.kind,
      gate: task.agent,
      cost: money(task.cost_budget_cents, state.runtime?.currency),
      updated: task.updated_at,
      icon: task.status === "blocked" ? "alert" : "queue",
      tone: toneFor(task.status),
    })),
  ].slice(0, 6);

  return {
    state,
    metrics,
    workflow,
    products,
    approvals,
    pendingApprovals,
    tasks,
    events,
    integrations,
    queueRows,
    currency: state.runtime?.currency || "AUD",
    health: state.runtime?.health || {},
    budget: metrics.budget || {},
    monitor: metrics.monitor || {},
    scheduler: metrics.scheduler || {},
    scorecards: metrics.scorecards || {},
    research: metrics.research || {},
  };
}

function icon(name) {
  return icons[name] || icons.pulse;
}

function nav(active, items = ["Command", "Queue", "Approvals", "Products", "Finance", "Integrations", "Monitor", "Timeline"]) {
  const map = {
    Command: "shield",
    Queue: "queue",
    Approvals: "approval",
    Products: "product",
    Finance: "finance",
    Integrations: "plug",
    Monitor: "pulse",
    Timeline: "clock",
  };
  return `<div class="side-nav">${items
    .map((item) => `<div class="side-item ${item === active ? "active" : ""}">${icon(map[item])}<span>${item}</span></div>`)
    .join("")}</div>`;
}

function statusChips(model) {
  return `
    <span class="status-chip">${icon("shield")} ${model.health.liveActionsLocked ? "Protected mode" : "Live actions enabled"}</span>
    <span class="status-chip">${icon("pulse")} ${prettyStatus(model.monitor.latestStatus || "not_run")}</span>
    <span class="status-chip">${icon("approval")} ${model.pendingApprovals.length} approvals</span>
    <span class="status-chip">${icon("finance")} ${money(model.budget.monthlySpendCents, model.currency)} spent</span>
  `;
}

function queueTable(model, className = "queue-table") {
  const rows = model.queueRows.length
    ? model.queueRows
    : [
        {
          kind: "Idle",
          title: "No immediate operator action",
          state: "watch",
          stage: "monitor",
          gate: "safe",
          cost: "0",
          updated: new Date().toISOString(),
          icon: "check",
          tone: "#34c759",
        },
      ];
  return `<table class="${className}">
    <thead><tr><th>Status</th><th>Workflow</th><th>Stage</th><th>Gate</th><th>Cost</th><th>Updated</th></tr></thead>
    <tbody>${rows
      .map(
        (row) => `<tr style="--tone:${row.tone}">
          <td><span class="state-pill" style="--chipBg:${row.tone}22;--chipLine:${row.tone}66;--chipText:${row.tone}">${prettyStatus(row.state)}</span></td>
          <td><div class="workflow-cell"><span class="thumb">${icon(row.icon)}</span><div><strong>${escapeHtml(row.title)}</strong><span>${row.kind} - ${escapeHtml(row.cost)} - ${shortDate(row.updated)}</span></div></div></td>
          <td>${escapeHtml(row.stage)}</td>
          <td>${escapeHtml(row.gate)}</td>
          <td>${escapeHtml(row.cost)}</td>
          <td>${shortDate(row.updated)}</td>
        </tr>`,
      )
      .join("")}</tbody>
  </table>`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function metric(label, value, note, iconName = "pulse") {
  return `<article class="metric-card"><div class="metric-top"><span>${label}</span><span class="metric-icon">${icon(iconName)}</span></div><strong>${value}</strong><p>${note}</p></article>`;
}

function events(model, count = 4) {
  return (model.events || [])
    .slice(0, count)
    .map(
      (event) => `<div class="event-mini"><strong>${escapeHtml(prettyStatus(event.type))}</strong><span>${shortDate(event.ts)} - ${escapeHtml(String(event.message || "").replaceAll("dry-run", "practice"))}</span></div>`,
    )
    .join("");
}

function attentionRows(model, count = 4) {
  const source = model.queueRows.length ? model.queueRows : [];
  return source
    .slice(0, count)
    .map(
      (row) => `<div class="attention-row" style="--tone:${row.tone}"><span class="rail"></span><div><strong>${escapeHtml(row.title)}</strong><span>${escapeHtml(prettyStatus(row.state))} - ${escapeHtml(row.stage)}</span></div><span class="mini-icon">${icon(row.icon)}</span></div>`,
    )
    .join("") || `<div class="attention-row" style="--tone:#34c759"><span class="rail"></span><div><strong>No immediate approval</strong><span>Watch monitor and queue</span></div><span class="mini-icon">${icon("check")}</span></div>`;
}

function productRows(model) {
  return model.products
    .map(
      (product, index) => `<div class="pilot-row" style="--tone:${index ? "#4c8dff" : "#34d399"}"><span class="rail"></span><div><strong>${escapeHtml(product.product)}</strong><span>${escapeHtml(product.sku)} - ${money(product.marginCents, model.currency)} estimate</span></div><span class="product-thumb">D${index + 1}</span></div>`,
    )
    .join("");
}

function renderCommand(model) {
  return `<section class="concept-screen screen-dark" style="--side:#0d1220;--right:#0d1220;--panel:#121a2a;--panel2:#172033;--line:#263249;--muted:#97a4b8;--accent:#38bdf8;--active:#173451;--activeText:#e6f7ff;--chipBg:#142035;--chipLine:#2b4162;--chipText:#f4f7fb;--thumb:#20334c;--thumbText:#9be7ff">
    <div class="cockpit-grid">
      <aside class="lab-sidebar"><div class="brand"><span class="mark">JC</span><div><strong>Jarvis-Codex</strong><span>Command center</span></div></div>${nav("Command")}</aside>
      <main class="main-zone">
        <div class="top-status"><div class="title-block"><h2>Command Center</h2><p>Safety, queue, approval, and cost state in one operating surface.</p></div>${statusChips(model)}</div>
        <div class="metric-grid">
          ${metric("Pilot stage", prettyStatus(model.workflow.status), model.workflow.current_step || "No active step", "product")}
          ${metric("Approvals", String(model.pendingApprovals.length), "human decisions waiting", "approval")}
          ${metric("Budget left", money(model.budget.remainingCents, model.currency), `${money(model.budget.monthlyBudgetCents, model.currency)} cap`, "finance")}
          ${metric("Monitor", model.monitor.latestStatus || "not run", `${model.monitor.openFindings || 0} open findings`, "pulse")}
        </div>
        <div class="content-grid">
          <article class="panel"><div class="panel-head"><h3>Active Work Queue</h3><span>State -> gate -> cost -> freshness</span></div>${queueTable(model)}</article>
          <article class="panel"><div class="panel-head"><h3>Digital Product Pilot</h3><span>${model.workflow.quality_score || 0} quality</span></div><div class="pilot-list">${productRows(model)}</div></article>
        </div>
        <div class="timeline-strip">${events(model, 4)}</div>
      </main>
      <aside class="right-zone"><div class="inspector-card"><article class="panel"><h3>Operator Attention</h3><div class="attention-list">${attentionRows(model)}</div></article><article class="panel"><h4>Selected Gate</h4><div class="detail-grid"><div class="detail"><span>Risk</span><strong>${model.pendingApprovals[0]?.risk_level || "low"}</strong></div><div class="detail"><span>Spend</span><strong>${money(0, model.currency)}</strong></div><div class="detail"><span>Live</span><strong>Locked</strong></div><div class="detail"><span>Next</span><strong>Approve or revise</strong></div></div></article></div></aside>
    </div>
  </section>`;
}

function renderExecutive(model) {
  return `<section class="concept-screen screen-light" style="--side:#ffffff;--panel:#ffffff;--panel2:#f8fafc;--line:#e3e7ed;--muted:#667085;--accent:#0f3a6d;--active:#f1e7d7;--activeText:#0f233f;--chipBg:#eef4ff;--chipLine:#b7cdfb;--chipText:#1d4ed8;--thumb:#e9f1fb;--thumbText:#173a63;--chartBg:#f7f9fc;--accent2:#d6b16a;--donutCenter:#ffffff">
    <div class="lite-grid">
      <aside class="lab-sidebar"><div class="brand"><span class="mark">JC</span><div><strong>Jarvis-Codex</strong><span>Executive suite</span></div></div>${nav("Command", ["Command", "Queue", "Approvals", "Products", "Finance", "Monitor", "Timeline"])}</aside>
      <main class="light-main">
        <div class="light-topbar"><div><h2>Good evening, operator</h2><p class="muted">Here is the current business control state.</p></div><div class="light-search">${icon("queue")} Search workflows, approvals, events...</div></div>
        <div class="light-metrics">
          ${metric("Active workflows", String(model.metrics.workflowStats?.active || 0), "portfolio work in motion", "queue")}
          ${metric("Tasks due", String(model.tasks.filter((task) => task.status === "blocked").length), "need approval or setup", "approval")}
          ${metric("Budget left", money(model.budget.remainingCents, model.currency), "monthly guardrail", "finance")}
          ${metric("Integrations", `${model.health.integrationsReady || 0}/${model.health.integrationsTotal || 0}`, "ready connectors", "plug")}
        </div>
        <div class="light-board">
          <div class="light-section-grid">
            <article class="light-card"><div class="panel-head"><h3>Pilot Overview</h3><span>by stage</span></div><div class="donut" style="--accent:#0f3a6d"><strong>${model.workflow.quality_score || 0}</strong></div></article>
            <article class="light-card"><div class="panel-head"><h3>Upcoming Actions</h3><span>operator first</span></div><div class="light-list">${attentionRows(model, 4)}</div></article>
            <article class="light-card"><div class="panel-head"><h3>Cost Pace</h3><span>practice proof</span></div><div class="bar-chart" style="--accent:#0f3a6d;--accent2:#d6b16a">${["38","52","61","70","84","96"].map((h) => `<span class="bar" style="--h:${h}%"></span>`).join("")}</div></article>
            <article class="light-card"><div class="panel-head"><h3>Recent Activity</h3><span>latest proof</span></div><div class="light-list">${(model.events || []).slice(0,3).map((event) => `<div class="light-row" style="--tone:#0f3a6d"><span class="rail"></span><div><strong>${escapeHtml(event.type)}</strong><span>${escapeHtml(event.message)}</span></div><span>${shortDate(event.ts)}</span></div>`).join("")}</div></article>
          </div>
          <article class="light-card"><div class="panel-head"><h3>Tasks Due</h3><span>all queues</span></div>${queueTable(model)}</article>
        </div>
      </main>
    </div>
  </section>`;
}

function renderGrowth(model) {
  const stages = ["Idea", "Research", "Build", "Pack", "Approval", "Launch"];
  return `<section class="concept-screen screen-growth" style="--side:#0d1320;--right:#101725;--panel:#121824;--panel2:#182030;--line:#273246;--muted:#98a6ba;--accent:#37d399;--active:#123827;--activeText:#d7ffe8;--chipBg:#152034;--chipLine:#2e3d54;--chipText:#f4f7fb;--thumb:#143426;--thumbText:#a3ffd0;--track:#293346">
    <div class="cockpit-grid">
      <aside class="lab-sidebar"><div class="brand"><span class="mark">AI</span><div><strong>Venture OS</strong><span>Growth cockpit</span></div></div>${nav("Products", ["Command", "Products", "Scorecards", "Finance", "Approvals", "Timeline"])}</aside>
      <main class="main-zone">
        <div class="top-status"><div class="title-block"><h2>Venture Scorecard Cockpit</h2><p>Product validation, cost exposure, and operator gates for the digital pilot.</p></div>${statusChips(model)}</div>
        <div class="metric-grid">
          ${metric("Validation score", `${model.scorecards.latestScore || model.workflow.quality_score || 0}/100`, prettyStatus(model.scorecards.latestVerdict || "proof seed"), "pulse")}
          ${metric("Revenue signal", money((model.products[0]?.marginCents || 0) * 3, model.currency), "prototype upside", "finance")}
          ${metric("Cost exposure", money(model.budget.monthlySpendCents, model.currency), "actual spend", "finance")}
          ${metric("Human gates", String(model.pendingApprovals.length), "operator decision count", "approval")}
        </div>
        <div class="content-grid">
          <article class="panel"><div class="panel-head"><h3>Digital Product Funnel</h3><span>next safe stage</span></div><div class="funnel">${stages.map((stage, index) => `<div class="funnel-step"><strong>${stage}</strong><div class="progress-track"><span style="--w:${index < 4 ? 100 : index === 4 ? 58 : 14}%;--tone:${index < 4 ? "#37d399" : "#f6b44b"}"></span></div><span class="small-chip" style="--chipBg:${index < 4 ? "#37d39922" : "#f6b44b22"};--chipLine:${index < 4 ? "#37d39966" : "#f6b44b66"};--chipText:${index < 4 ? "#37d399" : "#f6b44b"}">${index < 4 ? "done" : index === 4 ? "gate" : "locked"}</span></div>`).join("")}</div></article>
          <article class="panel"><div class="panel-head"><h3>Operator Attention</h3><span>approval and risk</span></div><div class="attention-list">${attentionRows(model)}</div></article>
        </div>
        <div class="timeline-strip">${events(model, 4)}</div>
      </main>
      <aside class="right-zone"><article class="panel"><div class="panel-head"><h3>Product Thumbnails</h3><span>pilot assets</span></div><div class="pilot-list">${productRows(model)}</div></article><article class="panel" style="margin-top:12px;padding:14px"><h3>Cost Burn</h3><svg class="sparkline" viewBox="0 0 320 120"><path d="M5 92 C40 88 50 70 82 75 S130 95 160 62 210 38 238 48 280 72 315 28"/></svg></article></aside>
    </div>
  </section>`;
}

function renderTimeline(model) {
  const timelineEvents = [
    { type: "Now", title: model.workflow.title || "Digital product pilot", detail: model.workflow.current_step || "awaiting action", tone: "#f6b84b", icon: "product", time: "now" },
    ...model.events.slice(0, 5).map((event) => ({ type: event.type, title: event.actor || "runtime", detail: event.message, tone: toneFor(event.level || event.type), icon: event.type?.includes("monitor") ? "pulse" : "clock", time: shortDate(event.ts) })),
  ];
  return `<section class="concept-screen screen-timeline" style="--side:#121720;--right:#151b25;--panel:#171b22;--panel2:#202631;--line:#303846;--muted:#9aa6b2;--accent:#4c8dff;--active:#1b3154;--activeText:#d9e8ff;--chipBg:#182233;--chipLine:#33445f;--chipText:#f4f7fa;--thumb:#223045;--thumbText:#cfe2ff">
    <div class="timeline-layout">
      <aside class="lab-sidebar"><div class="brand"><span class="mark">TL</span><div><strong>Operations</strong><span>Timeline board</span></div></div>${nav("Timeline", ["Operations", "Timeline", "Queue", "Approvals", "Products", "Finance", "Logs"])}</aside>
      <main class="main-zone">
        <div class="top-status"><div class="title-block"><h2>Operations / Now</h2><p>What happened, what is blocked, and what needs the operator.</p></div>${statusChips(model)}</div>
        <div class="timeline-board"><span class="now-line"></span>${timelineEvents.map((event) => `<article class="timeline-event" style="--tone:${event.tone}"><span class="time">${event.time}</span><div class="workflow-cell"><span class="thumb">${icon(event.icon)}</span><div><strong>${escapeHtml(event.title)}</strong><span>${escapeHtml(event.detail)}</span></div></div><span class="state-pill" style="--chipBg:${event.tone}22;--chipLine:${event.tone}66;--chipText:${event.tone}">${escapeHtml(event.type)}</span></article>`).join("")}</div>
      </main>
      <aside class="right-zone"><article class="panel"><div class="panel-head"><h3>Needs Operator</h3><span>grouped urgency</span></div><div class="attention-list">${attentionRows(model)}</div></article><article class="panel" style="margin-top:12px"><div class="panel-head"><h3>Lower Strip</h3><span>scorecards</span></div><div class="detail-grid" style="padding:14px"><div class="detail"><span>Score</span><strong>${model.scorecards.latestScore || 0}</strong></div><div class="detail"><span>Health</span><strong>${model.monitor.latestStatus || "watch"}</strong></div></div></article></aside>
    </div>
  </section>`;
}

function renderLedger(model) {
  return `<section class="concept-screen screen-ledger" style="--side:#101720;--right:#101720;--panel:#121822;--panel2:#182131;--line:#263244;--muted:#93a1b3;--accent:#5dd6c8;--active:#5dd6c8;--activeText:#06120f;--chipBg:#172232;--chipLine:#2d3c51;--chipText:#f4f7fa;--thumb:#1d3435;--thumbText:#a8fff6">
    <div class="ledger-layout">
      <aside class="icon-rail">${["shield","queue","approval","product","finance","plug","pulse"].map((name, index) => `<span class="rail-icon ${index === 0 ? "active" : ""}">${icon(name)}</span>`).join("")}</aside>
      <aside class="lab-sidebar"><div class="brand"><span class="mark">CR</span><div><strong>Control Room</strong><span>Queue ledger</span></div></div>${nav("Queue", ["Command", "Queue", "Approvals", "Products", "Finance", "Integrations", "Timeline"])}</aside>
      <main class="ledger-main">
        <div class="top-status"><div class="title-block"><h2>Active Work Queue</h2><p>Dense ledger with sticky inspector and event proof.</p></div>${statusChips(model)}</div>
        <div class="ledger-tabs"><span class="ledger-tab active">Now</span><span class="ledger-tab">Blocked ${model.tasks.filter((task) => task.status === "blocked").length}</span><span class="ledger-tab">Approvals ${model.pendingApprovals.length}</span><span class="ledger-tab">Completed</span></div>
        <article class="panel">${queueTable(model, "ledger-table")}</article>
        <div class="timeline-strip">${events(model, 4)}</div>
      </main>
      <aside class="right-zone"><div class="inspector-card"><article class="panel"><h3>Inspector</h3><p class="muted">${escapeHtml(model.queueRows[0]?.title || "No selected row")}</p><div class="detail-grid"><div class="detail"><span>State</span><strong>${escapeHtml(model.queueRows[0]?.state || "watch")}</strong></div><div class="detail"><span>Gate</span><strong>${escapeHtml(model.queueRows[0]?.gate || "safe")}</strong></div><div class="detail"><span>Cost</span><strong>${escapeHtml(model.queueRows[0]?.cost || "0")}</strong></div><div class="detail"><span>Updated</span><strong>${shortDate(model.queueRows[0]?.updated)}</strong></div></div></article><article class="panel"><h4>Related Events</h4><div class="event-stack">${events(model, 3)}</div></article></div></aside>
    </div>
  </section>`;
}

function renderTabs() {
  $("#concept-tabs").innerHTML = concepts
    .map(
      (concept, index) => `<button class="concept-tab ${labState.active === concept.id ? "active" : ""}" data-concept="${concept.id}" type="button"><strong>${index + 1}. ${concept.title}</strong><span>${concept.note}</span></button>`,
    )
    .join("");
}

function render() {
  renderTabs();
  const model = getModel();
  const renderers = {
    command: renderCommand,
    executive: renderExecutive,
    growth: renderGrowth,
    timeline: renderTimeline,
    ledger: renderLedger,
  };
  $("#concept-root").innerHTML = renderers[labState.active](model);
}

async function loadState() {
  const response = await fetch("/api/state");
  labState.state = await response.json();
  render();
}

document.addEventListener("click", (event) => {
  const tab = event.target.closest("[data-concept]");
  if (tab) {
    labState.active = tab.dataset.concept;
    render();
  }
});

$("#refresh-state").addEventListener("click", () => {
  loadState().catch((error) => {
    $("#concept-root").innerHTML = `<div class="loading-panel">Failed to load runtime state: ${escapeHtml(error.message)}</div>`;
  });
});

loadState().catch((error) => {
  $("#concept-root").innerHTML = `<div class="loading-panel">Failed to load runtime state: ${escapeHtml(error.message)}</div>`;
});
