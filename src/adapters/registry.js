const { run, now, toJson } = require("../db");
const { isAgentRuntimeSdkAvailable } = require("../runtime/agent-runtime");
const {
  environmentDisabled,
  environmentEnabled,
} = require("./pantheon-environment");
const { inspectOpenAiEgressPolicy } = require("./openai-egress-policy");

function integrationDefinitions() {
  const openaiConfigured = Boolean(process.env.OPENAI_API_KEY);
  const openaiEgress = inspectOpenAiEgressPolicy();
  const openaiReady = openaiConfigured && openaiEgress.ready;
  const liveResearchReady = openaiReady
    && environmentEnabled("enableLiveResearch")
    && !environmentDisabled("disableLiveResearchAdapter");
  const liveAiWorkersReady = openaiReady
    && environmentEnabled("enableLiveModels")
    && isAgentRuntimeSdkAvailable();
  return [
    {
      id: "codex",
      name: "Pantheon Engineering & Monitoring",
      kind: "engineering",
      status: "ready",
      mode: "local",
      health: "ok",
      metadata: { role: "Pantheon engineering, monitoring, maintenance, and improvement" },
    },
    {
      id: "openai",
      name: "OpenAI API",
      kind: "ai",
      status: openaiReady
        ? "configured"
        : openaiConfigured
          ? "blocked"
          : "needs_credentials",
      mode: "api",
      health: openaiReady
        ? "ok"
        : openaiConfigured
          ? "blocked"
          : "not_configured",
      metadata: {
        use: "Pantheon agent work, research, tracing, and approved asset generation",
        egressPolicy: openaiEgress,
      },
    },
    {
      id: "live_research",
      name: "OpenAI Live Research",
      kind: "research",
      status: liveResearchReady ? "configured" : "planned",
      mode: "openai-web-search",
      health: liveResearchReady ? "ok" : "not_configured",
      metadata: { use: "approved live market, competitor, pricing, and risk research" },
    },
    {
      id: "ai_workers",
      name: "OpenAI Agent Workers",
      kind: "ai",
      status: liveAiWorkersReady ? "configured" : "planned",
      mode: "openai-agents-sdk",
      health: liveAiWorkersReady ? "ok" : "not_configured",
      metadata: { use: "approved live OpenAI-backed specialist worker execution" },
    },
    {
      id: "digital_products",
      name: "Local Product File Preparation",
      kind: "local-capability",
      status: "ready",
      mode: "local-dry-run",
      health: "ok",
      metadata: {
        use: "Prepares local product files, listing drafts, and approval packs without publishing or changing a marketplace account.",
        localOnly: true,
        externalEffect: false,
        liveMarketplacePublishing: false,
      },
    },
    {
      id: "gelato",
      name: "Gelato",
      kind: "supplier",
      status: "planned",
      mode: "not-implemented",
      health: "not_implemented",
      metadata: { use: "Later POD product creation and supplier push", credentialDetected: Boolean(process.env.GELATO_API_KEY) },
    },
    {
      id: "etsy",
      name: "Etsy",
      kind: "marketplace",
      status: "unselected",
      mode: "not-implemented",
      health: "not_verified",
      metadata: {
        use: "Unselected marketplace hypothesis. Pantheon has not inspected, connected, or verified an Etsy seller account.",
        accountInspection: "not_performed",
        technicalConnection: "not_connected",
        livePublishingAdapter: "not_implemented",
        publishingAuthority: "none",
        liveActionRisk: "seller account visible action",
      },
    },
    {
      id: "xero",
      name: "Xero",
      kind: "accounting",
      status: "planned",
      mode: "not-implemented",
      health: "not_implemented",
      metadata: { use: "Later finance reconciliation after commercial traction", credentialDetected: Boolean(process.env.XERO_CLIENT_ID) },
    },
    {
      id: "email",
      name: "Email escalation",
      kind: "notification",
      status: "planned",
      mode: "not-implemented",
      health: "not_implemented",
      metadata: { use: "Later urgent approvals and escalations", credentialDetected: Boolean(process.env.SMTP_HOST) },
    },
    {
      id: "slack",
      name: "Slack",
      kind: "control-plane",
      status: "optional",
      mode: "not-implemented",
      health: "not_implemented",
      metadata: { use: "Possible later command channel", credentialDetected: Boolean(process.env.SLACK_BOT_TOKEN) },
    },
    {
      id: "clickup",
      name: "ClickUp",
      kind: "work-management",
      status: "optional",
      mode: "not-implemented",
      health: "not_implemented",
      metadata: { use: "Possible later task mirror; the dashboard remains source of truth", credentialDetected: Boolean(process.env.CLICKUP_API_TOKEN) },
    },
  ];
}

function refreshIntegrationHealth(db) {
  const ts = now();
  const definitions = integrationDefinitions();
  for (const integration of definitions) {
    run(
      db,
      `INSERT INTO integrations (id, name, kind, status, mode, health, last_checked_at, metadata, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         kind = excluded.kind,
         status = excluded.status,
         mode = excluded.mode,
         health = excluded.health,
         last_checked_at = excluded.last_checked_at,
         metadata = excluded.metadata,
         updated_at = excluded.updated_at`,
      [
        integration.id,
        integration.name,
        integration.kind,
        integration.status,
        integration.mode,
        integration.health,
        ts,
        toJson(integration.metadata),
        ts,
      ],
    );
  }
  run(
    db,
    `UPDATE integrations SET last_checked_at = ?, updated_at = ?, metadata = metadata WHERE id = 'codex'`,
    [ts, ts],
  );
  return { checkedAt: ts, updated: definitions.length };
}

module.exports = {
  integrationDefinitions,
  refreshIntegrationHealth,
};
