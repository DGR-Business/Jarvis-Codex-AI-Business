const { run, now, toJson } = require("../db");
const { isAgentRuntimeSdkAvailable } = require("../runtime/agent-runtime");

function integrationDefinitions() {
  const openaiReady = Boolean(process.env.OPENAI_API_KEY);
  const liveResearchReady = openaiReady && process.env.JARVIS_ENABLE_LIVE_RESEARCH === "1" && process.env.JARVIS_DISABLE_LIVE_RESEARCH_ADAPTER !== "1";
  const liveAiWorkersReady = openaiReady && process.env.JARVIS_ENABLE_LIVE_MODELS === "1" && isAgentRuntimeSdkAvailable();
  return [
    {
      id: "codex",
      name: "Codex",
      kind: "engineering",
      status: "ready",
      mode: "local",
      health: "ok",
      metadata: { role: "engineering/admin runtime maintainer" },
    },
    {
      id: "openai",
      name: "OpenAI API",
      kind: "ai",
      status: openaiReady ? "configured" : "needs_credentials",
      mode: "api",
      health: openaiReady ? "ok" : "not_configured",
      metadata: { use: "future agent workflows, tracing, image/API scale" },
    },
    {
      id: "live_research",
      name: "Live Research Adapter",
      kind: "research",
      status: liveResearchReady ? "configured" : "planned",
      mode: "openai-web-search",
      health: liveResearchReady ? "ok" : "not_configured",
      metadata: { use: "approved live market, competitor, pricing, and risk research" },
    },
    {
      id: "ai_workers",
      name: "AI Worker Execution",
      kind: "ai",
      status: liveAiWorkersReady ? "configured" : "planned",
      mode: "openai-agents-sdk",
      health: liveAiWorkersReady ? "ok" : "not_configured",
      metadata: { use: "approved live OpenAI-backed specialist worker execution" },
    },
    {
      id: "digital_products",
      name: "Digital Product Publishing",
      kind: "marketplace",
      status: "ready",
      mode: "dry-run",
      health: "ok",
      metadata: { use: "digital product listing, file-delivery, and approval-pack proof path" },
    },
    {
      id: "gelato",
      name: "Gelato",
      kind: "supplier",
      status: process.env.GELATO_API_KEY ? "configured" : "needs_credentials",
      mode: "api-or-dashboard",
      health: process.env.GELATO_API_KEY ? "ok" : "dry_run_only",
      metadata: { use: "POD product creation and supplier-push to Etsy" },
    },
    {
      id: "etsy",
      name: "Etsy",
      kind: "marketplace",
      status: "via_gelato",
      mode: "partner",
      health: "limited",
      metadata: { directApi: "denied; do not retry", liveActionRisk: "seller account visible action" },
    },
    {
      id: "xero",
      name: "Xero",
      kind: "accounting",
      status: process.env.XERO_CLIENT_ID ? "configured" : "planned",
      mode: "oauth",
      health: process.env.XERO_CLIENT_ID ? "ok" : "not_configured",
      metadata: { use: "finance reconciliation after commercial traction" },
    },
    {
      id: "email",
      name: "Email escalation",
      kind: "notification",
      status: process.env.SMTP_HOST ? "configured" : "planned",
      mode: "smtp-or-provider",
      health: process.env.SMTP_HOST ? "ok" : "not_configured",
      metadata: { use: "urgent approvals and escalations" },
    },
    {
      id: "slack",
      name: "Slack",
      kind: "control-plane",
      status: process.env.SLACK_BOT_TOKEN ? "configured" : "optional",
      mode: "api",
      health: process.env.SLACK_BOT_TOKEN ? "ok" : "not_configured",
      metadata: { use: "optional agent command channel" },
    },
    {
      id: "clickup",
      name: "ClickUp",
      kind: "work-management",
      status: process.env.CLICKUP_API_TOKEN ? "configured" : "optional",
      mode: "api",
      health: process.env.CLICKUP_API_TOKEN ? "ok" : "not_configured",
      metadata: { use: "optional task mirror; dashboard remains source of truth" },
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
  refreshIntegrationHealth,
};
