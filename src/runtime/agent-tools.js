const { all, fromJson, now, run, toJson } = require("../db");
const { ensureAiTeam } = require("./ai-team");

const TOOL_POLICY_SCHEMA = "jarvis_agent_tool_policy_v1";

function tool(id, name, category, mode, options = {}) {
  return {
    id,
    name,
    category,
    mode,
    status: options.status || "ready",
    riskLevel: options.riskLevel || "low",
    dryRunAvailable: options.dryRunAvailable !== false,
    requiresApproval: options.requiresApproval || mode === "approval_gated" || mode === "hard_stop",
    externalAction: Boolean(options.externalAction),
    spendPossible: Boolean(options.spendPossible),
    hardStop: options.hardStop || mode === "hard_stop",
    approvalScope: options.approvalScope || null,
    integrationId: options.integrationId || null,
    providerCapability: options.providerCapability || null,
    liveFlag: options.liveFlag || null,
    description: options.description || "",
    metadata: options.metadata || {},
  };
}

const AGENT_TOOL_DEFINITIONS = [
  tool("runtime_state", "Runtime State", "internal", "read_only", {
    description: "Read current workflows, tasks, approvals, scorecards, costs, and results from the local runtime.",
  }),
  tool("local_deliverables", "Local Deliverables", "internal", "dry_run", {
    description: "Create or update local review artifacts without external publishing or spend.",
  }),
  tool("approval_pack", "Review Pack Builder", "internal", "dry_run", {
    description: "Prepare local operator review packs and PDFs without sending or publishing.",
  }),
  tool("agent_traces", "Worker Traces", "internal", "read_only", {
    description: "Read worker trace and quality-check history for handoffs and review.",
  }),
  tool("approved_research", "Approved Research Store", "research", "read_only", {
    description: "Use already captured research evidence from the runtime.",
  }),
  tool("research_summary", "Research Summary", "research", "read_only", {
    description: "Read summarized research output already held by the runtime.",
  }),
  tool("research_adapter", "Research Adapter", "research", "approval_gated", {
    riskLevel: "medium",
    dryRunAvailable: true,
    externalAction: true,
    spendPossible: true,
    approvalScope: "live_research_spend",
    integrationId: "live_research",
    providerCapability: "live_research_adapter",
    liveFlag: "JARVIS_ENABLE_LIVE_RESEARCH",
    description: "Prepare protected research by default; live web research requires approval, credentials, and the live research flag.",
  }),
  tool("live_web_with_approval", "Live Web Research", "research", "approval_gated", {
    riskLevel: "medium",
    dryRunAvailable: true,
    externalAction: true,
    spendPossible: true,
    approvalScope: "live_research_spend",
    integrationId: "live_research",
    providerCapability: "live_research_adapter",
    liveFlag: "JARVIS_ENABLE_LIVE_RESEARCH",
    description: "Live web search is available only through a capped, approved research task.",
  }),
  tool("commercial_briefs", "Commercial Briefs", "commercial", "read_only", {
    description: "Read buyer, problem, offer, channel, and evidence briefs.",
  }),
  tool("execution_packs", "Execution Packs", "commercial", "dry_run", {
    description: "Prepare and inspect local market-contact packs without sending messages.",
  }),
  tool("execution_pack_inputs", "Execution Pack Inputs", "commercial", "read_only", {
    description: "Read offer, copy, channel, and tracking inputs for pack creation.",
  }),
  tool("results_ledger", "Results Ledger", "commercial", "read_only", {
    description: "Read captured results before recommending a next commercial move.",
  }),
  tool("commercial_results", "Commercial Results", "commercial", "read_only", {
    description: "Read views, clicks, leads, sales, refunds, revenue, cost, and time records.",
  }),
  tool("commercial_feedback", "Customer Signal", "commercial", "read_only", {
    description: "Read captured buyer replies, objections, reviews, and feedback.",
  }),
  tool("learning_cycles", "Learning Cycles", "commercial", "read_only", {
    description: "Read hypothesis, actual result, learning, and improvement records.",
  }),
  tool("scorecards", "Scorecards", "commercial", "read_only", {
    description: "Read venture scorecards, risks, verdicts, and recommendations.",
  }),
  tool("cost_ledger", "Cost Ledger", "finance", "read_only", {
    description: "Read cost estimates and approved/invoiced spend records.",
  }),
  tool("revenue_ledger", "Revenue Ledger", "finance", "read_only", {
    description: "Read revenue records captured by the runtime.",
  }),
  tool("notification_outbox", "Notification Outbox", "communication", "dry_run", {
    dryRunAvailable: true,
    description: "Prepare internal protected notification records; live sending needs a separate email adapter approval.",
  }),
  tool("digital_product_adapter", "Digital Product Adapter", "publishing", "approval_gated", {
    riskLevel: "high",
    dryRunAvailable: true,
    externalAction: true,
    spendPossible: false,
    approvalScope: "publishing",
    integrationId: "digital_products",
    description: "Can prepare local publishing plans; any live upload, listing, or file delivery is approval-gated.",
  }),
  tool("live_ai_worker_adapter", "Live AI Worker Runner", "ai", "approval_gated", {
    riskLevel: "medium",
    dryRunAvailable: true,
    spendPossible: true,
    approvalScope: "live_ai_worker_spend",
    integrationId: "ai_workers",
    providerCapability: "openai_agents_sdk_runner",
    liveFlag: "JARVIS_ENABLE_LIVE_MODELS",
    description: "Run capped OpenAI Agents SDK worker tests only after approval, cost limits, and provider readiness.",
  }),
  tool("live_web_until_adapter", "Live Web Direct Access", "research", "hard_stop", {
    status: "blocked",
    riskLevel: "high",
    dryRunAvailable: false,
    externalAction: true,
    spendPossible: true,
    hardStop: true,
    description: "Direct live web access is blocked; use the approved research adapter instead.",
  }),
  tool("external_action", "External Action", "external", "hard_stop", {
    status: "blocked",
    riskLevel: "high",
    dryRunAvailable: false,
    externalAction: true,
    hardStop: true,
    description: "Generic outside-world actions are blocked until a specific protected adapter and approval path exists.",
  }),
  tool("external_send", "External Send", "communication", "hard_stop", {
    status: "blocked",
    riskLevel: "high",
    dryRunAvailable: false,
    externalAction: true,
    hardStop: true,
    description: "Sending messages or outreach is blocked until live email/provider rails are implemented and approved.",
  }),
  tool("customer_contact", "Customer Contact", "communication", "hard_stop", {
    status: "blocked",
    riskLevel: "high",
    dryRunAvailable: false,
    externalAction: true,
    hardStop: true,
    description: "Customer contact requires explicit operator approval and a live communication adapter.",
  }),
  tool("customer_reply_send", "Customer Reply Send", "communication", "hard_stop", {
    status: "blocked",
    riskLevel: "high",
    dryRunAvailable: false,
    externalAction: true,
    hardStop: true,
    description: "Sending replies to customers is a hard-stop item.",
  }),
  tool("marketplace_publish", "Marketplace Publishing", "publishing", "hard_stop", {
    status: "blocked",
    riskLevel: "high",
    dryRunAvailable: false,
    externalAction: true,
    hardStop: true,
    description: "Live marketplace publishing is blocked until a protected adapter, approval, and account-safety checks exist.",
  }),
  tool("supplier_publish", "Supplier Publishing", "publishing", "hard_stop", {
    status: "blocked",
    riskLevel: "high",
    dryRunAvailable: false,
    externalAction: true,
    hardStop: true,
    description: "Supplier push/upload actions remain blocked for the digital-product-first pilot.",
  }),
  tool("publishing", "Publishing", "publishing", "hard_stop", {
    status: "blocked",
    riskLevel: "high",
    dryRunAvailable: false,
    externalAction: true,
    hardStop: true,
    description: "Generic live publishing is blocked; use specific approved publishing rails later.",
  }),
  tool("account_actions", "Account Actions", "account", "hard_stop", {
    status: "blocked",
    riskLevel: "high",
    dryRunAvailable: false,
    externalAction: true,
    hardStop: true,
    description: "Account creation or account setting changes are hard-stop items.",
  }),
  tool("payments", "Payments", "finance", "hard_stop", {
    status: "blocked",
    riskLevel: "high",
    dryRunAvailable: false,
    externalAction: true,
    spendPossible: true,
    hardStop: true,
    description: "Money movement is blocked.",
  }),
  tool("refunds", "Refunds", "finance", "hard_stop", {
    status: "blocked",
    riskLevel: "high",
    dryRunAvailable: false,
    externalAction: true,
    spendPossible: true,
    hardStop: true,
    description: "Refunds and disputes require explicit operator handling.",
  }),
  tool("disputes", "Disputes", "finance", "hard_stop", {
    status: "blocked",
    riskLevel: "high",
    dryRunAvailable: false,
    externalAction: true,
    hardStop: true,
    description: "Customer or platform disputes are hard-stop items.",
  }),
  tool("accounting_write", "Accounting Write", "finance", "hard_stop", {
    status: "blocked",
    riskLevel: "high",
    dryRunAvailable: false,
    externalAction: true,
    hardStop: true,
    integrationId: "xero",
    description: "Writing accounting records is blocked until Xero is justified, connected, and approved.",
  }),
  tool("image_generation_spend", "Paid Asset Generation", "creative", "approval_gated", {
    status: "pilot_ready",
    riskLevel: "medium",
    dryRunAvailable: false,
    externalAction: true,
    spendPossible: true,
    requiresApproval: true,
    approvalScope: "paid_asset_generation",
    integrationId: "ai_workers",
    providerCapability: "openai_agents_sdk_runner",
    liveFlag: "JARVIS_ENABLE_IMAGE_GENERATION",
    description: "Create one capped GPT Image asset for Product Builder only after exact prompt, size, quality, cost, storage, and output approval.",
  }),
  tool("visual_asset_review", "Visual Asset Review", "creative", "approval_gated", {
    status: "pilot_ready",
    riskLevel: "low",
    dryRunAvailable: false,
    spendPossible: true,
    requiresApproval: true,
    approvalScope: "live_ai_worker_spend",
    integrationId: "ai_workers",
    providerCapability: "openai_agents_sdk_runner",
    liveFlag: "JARVIS_ENABLE_LIVE_MODELS",
    description: "Let Quality Reviewer inspect only the exact approved local asset IDs included in a capped model run; it cannot generate or alter assets.",
  }),
  tool("unsupported_claims", "Unsupported Claims", "risk", "hard_stop", {
    status: "blocked",
    riskLevel: "medium",
    dryRunAvailable: false,
    hardStop: true,
    description: "Marketing or product claims without evidence are blocked.",
  }),
  tool("legal_determination", "Legal Determination", "risk", "hard_stop", {
    status: "blocked",
    riskLevel: "high",
    dryRunAvailable: false,
    hardStop: true,
    description: "Legal, tax, compliance, IP, and platform-risk determinations are hard-stop items.",
  }),
  tool("autopilot_promotion", "Autopilot Promotion", "autonomy", "hard_stop", {
    status: "blocked",
    riskLevel: "high",
    dryRunAvailable: false,
    hardStop: true,
    description: "Autopilot promotion requires approval history, veto windows, rollback, and operator approval.",
  }),
  tool("increase_spend", "Increase Spend", "finance", "hard_stop", {
    status: "blocked",
    riskLevel: "high",
    dryRunAvailable: false,
    spendPossible: true,
    hardStop: true,
    description: "Increasing spend is blocked until a specific approval rule exists.",
  }),
];

function fromBoolean(value) {
  return value ? 1 : 0;
}

function parseTool(row) {
  if (!row) return null;
  return {
    ...row,
    dry_run_available: Boolean(row.dry_run_available),
    requires_approval: Boolean(row.requires_approval),
    external_action: Boolean(row.external_action),
    spend_possible: Boolean(row.spend_possible),
    hard_stop: Boolean(row.hard_stop),
    metadata: fromJson(row.metadata, {}),
  };
}

function parseAssignment(row) {
  if (!row) return null;
  return {
    ...row,
    metadata: fromJson(row.metadata, {}),
    tool: parseTool({
      id: row.tool_id,
      name: row.tool_name,
      category: row.tool_category,
      status: row.tool_status,
      mode: row.tool_mode,
      risk_level: row.tool_risk_level,
      dry_run_available: row.tool_dry_run_available,
      requires_approval: row.tool_requires_approval,
      external_action: row.tool_external_action,
      spend_possible: row.tool_spend_possible,
      hard_stop: row.tool_hard_stop,
      approval_scope: row.tool_approval_scope,
      integration_id: row.tool_integration_id,
      provider_capability: row.tool_provider_capability,
      live_flag: row.tool_live_flag,
      description: row.tool_description,
      metadata: row.tool_metadata,
      created_at: row.tool_created_at,
      updated_at: row.tool_updated_at,
    }),
  };
}

function permissionForTool(toolRecord) {
  if (!toolRecord) return "needs_review";
  if (toolRecord.hard_stop) return "blocked";
  if (toolRecord.requires_approval || toolRecord.mode === "approval_gated") return "requires_approval";
  return "allowed";
}

function assignmentId(agentId, toolId) {
  return `agent_tool_${agentId}_${toolId}`.replace(/[^a-zA-Z0-9_:-]/g, "_");
}

function ensureAgentTools(db) {
  ensureAiTeam(db);
  const ts = now();

  for (const definition of AGENT_TOOL_DEFINITIONS) {
    run(
      db,
      `INSERT INTO agent_tools
        (id, name, category, status, mode, risk_level, dry_run_available,
         requires_approval, external_action, spend_possible, hard_stop,
         approval_scope, integration_id, provider_capability, live_flag,
         description, metadata, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         category = excluded.category,
         status = excluded.status,
         mode = excluded.mode,
         risk_level = excluded.risk_level,
         dry_run_available = excluded.dry_run_available,
         requires_approval = excluded.requires_approval,
         external_action = excluded.external_action,
         spend_possible = excluded.spend_possible,
         hard_stop = excluded.hard_stop,
         approval_scope = excluded.approval_scope,
         integration_id = excluded.integration_id,
         provider_capability = excluded.provider_capability,
         live_flag = excluded.live_flag,
         description = excluded.description,
         metadata = excluded.metadata,
         updated_at = excluded.updated_at`,
      [
        definition.id,
        definition.name,
        definition.category,
        definition.status,
        definition.mode,
        definition.riskLevel,
        fromBoolean(definition.dryRunAvailable),
        fromBoolean(definition.requiresApproval),
        fromBoolean(definition.externalAction),
        fromBoolean(definition.spendPossible),
        fromBoolean(definition.hardStop),
        definition.approvalScope,
        definition.integrationId,
        definition.providerCapability,
        definition.liveFlag,
        definition.description,
        toJson({ schema: TOOL_POLICY_SCHEMA, ...definition.metadata }),
        ts,
        ts,
      ],
    );
  }

  const toolRows = new Map(all(db, "SELECT * FROM agent_tools").map((row) => [row.id, parseTool(row)]));
  const definitions = all(db, "SELECT id, tools FROM agent_definitions");
  for (const definition of definitions) {
    const assignedToolIds = fromJson(definition.tools, []);
    for (const toolId of assignedToolIds) {
      let toolRecord = toolRows.get(toolId);
      if (!toolRecord) {
        run(
          db,
          `INSERT INTO agent_tools
            (id, name, category, status, mode, risk_level, dry_run_available,
             requires_approval, external_action, spend_possible, hard_stop,
             description, metadata, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO NOTHING`,
          [
            toolId,
            toolId.replaceAll("_", " "),
            "unknown",
            "needs_review",
            "unknown",
            "medium",
            0,
            1,
            0,
            0,
            0,
            "Unregistered tool name found in a worker definition.",
            toJson({ schema: TOOL_POLICY_SCHEMA, generatedPlaceholder: true }),
            ts,
            ts,
          ],
        );
        toolRecord = parseTool(all(db, "SELECT * FROM agent_tools WHERE id = ?", [toolId])[0]);
        toolRows.set(toolId, toolRecord);
      }
      const permission = permissionForTool(toolRecord);
      run(
        db,
        `INSERT INTO agent_tool_assignments
          (id, agent_id, tool_id, status, permission, approval_scope, cost_cap_cents, metadata, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(agent_id, tool_id) DO UPDATE SET
           status = excluded.status,
           permission = excluded.permission,
           approval_scope = excluded.approval_scope,
           cost_cap_cents = excluded.cost_cap_cents,
           metadata = excluded.metadata,
           updated_at = excluded.updated_at`,
        [
          assignmentId(definition.id, toolId),
          definition.id,
          toolId,
          toolRecord.status === "needs_review" ? "needs_review" : "active",
          permission,
          toolRecord.approval_scope || null,
          toolRecord.spend_possible ? 100 : 0,
          toJson({
            schema: TOOL_POLICY_SCHEMA,
            source: "agent_definition.tools",
            dryRunAvailable: toolRecord.dry_run_available,
            hardStop: toolRecord.hard_stop,
          }),
          ts,
          ts,
        ],
      );
    }
  }
}

function listAssignments(db) {
  return all(
    db,
    `SELECT agent_tool_assignments.*,
       agent_definitions.name AS agent_name,
       agent_tools.name AS tool_name,
       agent_tools.category AS tool_category,
       agent_tools.status AS tool_status,
       agent_tools.mode AS tool_mode,
       agent_tools.risk_level AS tool_risk_level,
       agent_tools.dry_run_available AS tool_dry_run_available,
       agent_tools.requires_approval AS tool_requires_approval,
       agent_tools.external_action AS tool_external_action,
       agent_tools.spend_possible AS tool_spend_possible,
       agent_tools.hard_stop AS tool_hard_stop,
       agent_tools.approval_scope AS tool_approval_scope,
       agent_tools.integration_id AS tool_integration_id,
       agent_tools.provider_capability AS tool_provider_capability,
       agent_tools.live_flag AS tool_live_flag,
       agent_tools.description AS tool_description,
       agent_tools.metadata AS tool_metadata,
       agent_tools.created_at AS tool_created_at,
       agent_tools.updated_at AS tool_updated_at
     FROM agent_tool_assignments
     LEFT JOIN agent_definitions ON agent_definitions.id = agent_tool_assignments.agent_id
     LEFT JOIN agent_tools ON agent_tools.id = agent_tool_assignments.tool_id
     ORDER BY agent_definitions.name ASC, agent_tools.name ASC`,
  ).map(parseAssignment);
}

function summarizeAgentPolicy(assignments) {
  const allowed = assignments.filter((assignment) => assignment.permission === "allowed");
  const approvalRequired = assignments.filter((assignment) => assignment.permission === "requires_approval");
  const blocked = assignments.filter((assignment) => assignment.permission === "blocked");
  const needsReview = assignments.filter((assignment) => assignment.permission === "needs_review" || assignment.status === "needs_review");
  const externalActions = assignments.filter((assignment) => assignment.tool?.external_action);
  const spendTools = assignments.filter((assignment) => assignment.tool?.spend_possible);
  const status = blocked.length
    ? "blocked"
    : needsReview.length
      ? "needs_review"
      : approvalRequired.length
        ? "approval_gated"
        : "safe_internal";
  return {
    status,
    assignments,
    allowed,
    approvalRequired,
    blocked,
    needsReview,
    externalActions,
    spendTools,
    allToolsRegistered: needsReview.length === 0,
    noHardStopToolsAssigned: blocked.length === 0,
    externalActionsRequireApproval: externalActions.every((assignment) => assignment.permission === "requires_approval"),
    spendRequiresApproval: spendTools.every((assignment) => assignment.permission === "requires_approval"),
    summary: blocked.length
      ? `${blocked.length} blocked tool${blocked.length === 1 ? "" : "s"} assigned.`
      : approvalRequired.length
        ? `${approvalRequired.length} tool${approvalRequired.length === 1 ? "" : "s"} ${approvalRequired.length === 1 ? "requires" : "require"} approval before live use.`
        : "Only protected internal tools are assigned.",
  };
}

function getAgentToolPolicyState(db) {
  ensureAgentTools(db);
  const tools = all(db, "SELECT * FROM agent_tools ORDER BY category ASC, name ASC").map(parseTool);
  const assignments = listAssignments(db);
  const definitions = all(db, "SELECT id, name FROM agent_definitions ORDER BY name ASC");
  const byAgent = {};
  for (const definition of definitions) {
    byAgent[definition.id] = {
      agentId: definition.id,
      agentName: definition.name,
      ...summarizeAgentPolicy(assignments.filter((assignment) => assignment.agent_id === definition.id)),
    };
  }
  const hardStopTools = tools.filter((toolRecord) => toolRecord.hard_stop);
  const approvalTools = tools.filter((toolRecord) => toolRecord.requires_approval && !toolRecord.hard_stop);
  const assignedHardStops = assignments.filter((assignment) => assignment.tool?.hard_stop);

  return {
    schema: TOOL_POLICY_SCHEMA,
    status: assignedHardStops.length ? "blocked" : "ready",
    summary: assignedHardStops.length
      ? `${assignedHardStops.length} hard-stop tool assignment${assignedHardStops.length === 1 ? "" : "s"} need removal.`
      : "Worker tool permissions are registered; live, spend, publishing, account, customer, and finance actions remain approval-gated or blocked.",
    metrics: {
      tools: tools.length,
      assignments: assignments.length,
      approvalTools: approvalTools.length,
      hardStopTools: hardStopTools.length,
      assignedHardStops: assignedHardStops.length,
      workersWithApprovalTools: Object.values(byAgent).filter((policy) => policy.approvalRequired.length).length,
      workersSafeInternalOnly: Object.values(byAgent).filter((policy) => policy.status === "safe_internal").length,
    },
    tools,
    assignments,
    byAgent,
    hardStopTools,
    approvalTools,
  };
}

function getAgentToolPolicyForAgent(db, agentId) {
  return getAgentToolPolicyState(db).byAgent[agentId] || summarizeAgentPolicy([]);
}

module.exports = {
  AGENT_TOOL_DEFINITIONS,
  ensureAgentTools,
  getAgentToolPolicyForAgent,
  getAgentToolPolicyState,
};
