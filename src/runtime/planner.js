const { get, insertEvent, now, randomId, run, toJson } = require("../db");
const { renderDeliverable } = require("./deliverables");

function titleCase(value) {
  return String(value || "")
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

function compactText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function slugForId(value) {
  return String(value || "item")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 38) || "item";
}

function inferIntent(text) {
  const lower = text.toLowerCase();
  if (/(find|discover|identify).*(profitable|business|venture|idea)/.test(lower)) return "find_profitable_venture";
  if (/(worth|pursu|viable|research|validate|advise|evaluate)/.test(lower)) return "evaluate_business_idea";
  if (/(mockup|mock-up|design|prototype|concept)/.test(lower)) return "create_mockup_pipeline";
  return "business_goal";
}

function inferChannel(text) {
  const lower = text.toLowerCase();
  if (/(pod|print on demand|shirt|t-shirt|tee|hoodie|sweatshirt|mug|etsy|gelato)/.test(lower)) return "POD";
  if (/(digital product|template|notion|spreadsheet|planner|download)/.test(lower)) return "Digital Product";
  if (/(affiliate|content site|newsletter|seo|blog)/.test(lower)) return "Content";
  return "Business Idea";
}

function inferSubject(text, channel) {
  const lower = text.toLowerCase();
  if (/car.*shirt|shirt.*car|car.*tee|tee.*car/.test(lower)) return "Car Shirt Design";
  if (/nurse/.test(lower)) return "Nurse Product";
  if (/pilates/.test(lower)) return "Pilates Product";
  if (/business idea|profitable idea|venture idea/.test(lower)) return "New Venture Idea";

  const cleaned = compactText(text)
    .replace(/^(please\s+)?(can you\s+)?(find|research|evaluate|advise|create|make|build|run)\s+/i, "")
    .replace(/\b(profitable|business|idea|mockups?|research|advise|worth|pursuing|pipeline|approval)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  const words = cleaned.split(" ").filter(Boolean).slice(0, 5).join(" ");
  return titleCase(words || `${channel} Idea`);
}

function workflowTitle(intent, channel, subject) {
  if (intent === "find_profitable_venture") return `${channel} - Profit Search and Concept Pipeline`;
  if (intent === "create_mockup_pipeline") return `${channel} - ${subject} Mockup Pipeline`;
  return `${channel} - ${subject} Viability Pipeline`;
}

function deliverableTemplates(intent, channel, subject, wantsMockups) {
  const prefix = channel === "Business Idea" ? "Business Idea" : channel;
  const base = `${prefix} - ${subject}`;
  const deliverables = [
    {
      title: "Evidence Brief",
      humanName: `${base} Evidence Brief`,
      format: "pdf_preferred",
      summary: "Human-friendly research brief covering target market, demand signals, competitors, risks, and recommendation.",
      sections: ["Executive summary", "Target customer", "Market signals", "Competitor notes", "Risks", "Recommendation"],
    },
    {
      title: "Test Pack",
      humanName: `${base} Test Pack`,
      format: "pdf_preferred",
      summary: "Plain-English viability snapshot covering expected costs, margin logic, traffic assumptions, and go/no-go criteria.",
      sections: ["Cost assumptions", "Revenue path", "Margin check", "Traffic/distribution plan", "Kill or continue rule"],
    },
    {
      title: "Publish Pack",
      humanName: `${base} Publish Pack`,
      format: "pdf_preferred",
      summary: "The smallest product, listing, distribution and tracking package needed for an approved market test.",
      sections: ["Product contents", "Listing copy", "Channel steps", "Tracking", "Publishing checklist"],
    },
    {
      title: "Decision Pack",
      humanName: `${base} Decision Pack`,
      format: "pdf_preferred",
      summary: "Final approval pack that gives the operator a clear continue, revise, or kill decision.",
      sections: ["Decision needed", "Recommended next action", "Evidence", "Open questions", "Approval options"],
    },
  ];

  return deliverables;
}

function taskTemplates(intent, wantsMockups) {
  return [
    ["Prepare the Evidence Brief", "market_research", "demand_validator", 1, "evidence_brief", ["opportunity_scout", "demand_validator"]],
    ["Prepare the Test Pack", "offer_architecture", "offer_architect", 2, "test_pack", ["offer_architect", "finance_analyst", "quality_reviewer"]],
    ["Prepare the Publish Pack", "product_action_plan", "product_builder", 3, "publish_pack", ["product_builder", "copy_conversion_agent", "distribution_operator"]],
    ["Prepare the Decision Pack", "operator_pack_qc", "chief_of_staff", 4, "decision_pack", ["customer_voice_agent", "growth_analyst", "finance_analyst", "chief_of_staff"]],
  ];
}

function taskBudgetCents(kind) {
  return {
    goal_planning: 10,
    market_research: 60,
    offer_architecture: 35,
    product_action_plan: 45,
    conversion_copy: 35,
    distribution_plan: 35,
    commercial_analysis: 35,
    feedback_analysis: 25,
    result_analysis: 25,
    risk_screen: 30,
    mockup_direction: 80,
    operator_pack_qc: 25,
  }[kind] || 10;
}

function createCommandPlan(db, input) {
  const rawText = compactText(input.text);
  if (!rawText) throw new Error("Command text is required.");

  const ts = now();
  const intent = inferIntent(rawText);
  const channel = inferChannel(rawText);
  const subject = inferSubject(rawText, channel);
  const wantsMockups = /(mockup|mock-up|design|prototype|concept|visual)/i.test(rawText);
  if (channel === "POD") throw new Error("Print-on-demand is paused until the digital-product pilot proves repeatable sales.");
  const mode = input.mode || "plan_only";
  if (!new Set(["plan_only", "run_protected"]).has(mode)) throw new Error("Mode must be plan_only or run_protected.");
  const activeVenture = get(db, "SELECT * FROM ventures WHERE is_active = 1 ORDER BY updated_at DESC LIMIT 1")
    || get(db, "SELECT * FROM ventures WHERE id = 'venture-digital-products'");
  const ventureId = input.ventureId || activeVenture?.id;
  if (!ventureId) throw new Error("An active venture is required before work can be planned.");
  const commandId = `cmd_${slugForId(subject)}_${randomId().slice(0, 8)}`;
  const workflowId = `wf_${slugForId(subject)}_${randomId().slice(0, 8)}`;
  const title = workflowTitle(intent, channel, subject);
  const summary = `Planned ${channel.toLowerCase()} workflow for ${subject}. Safe dry-run agent execution is available; live model/tool spend remains locked.`;

  run(
    db,
    `INSERT INTO workflows (id, venture_id, type, title, status, current_step, priority,
      quality_score, expected_profit_cents, cost_estimate_cents, approval_required, metadata, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      workflowId,
      ventureId,
      intent,
      title,
      "planned",
      "ready for dry-run agent execution",
      2,
      0,
      0,
      0,
      0,
      toJson({
        commandId,
        channel,
        subject,
        originalInstruction: rawText,
        agentRunner: { mode, liveModels: false, liveTools: false },
      }),
      ts,
      ts,
    ],
  );

  run(
    db,
    `INSERT INTO commands (id, source, raw_text, intent, status, workflow_id, summary, metadata, created_at, updated_at, venture_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      commandId,
      input.source || "dashboard",
      rawText,
      intent,
      "planned",
      workflowId,
      summary,
      toJson({ channel, subject, wantsMockups }),
      ts,
      ts,
      ventureId,
    ],
  );

  const tasks = taskTemplates(intent, wantsMockups).map(([taskTitle, kind, agent, priority, packageKind, contributors]) => {
    const taskId = `task_${slugForId(kind)}_${randomId().slice(0, 8)}`;
    const packageId = `package_${slugForId(packageKind)}_${randomId().slice(0, 8)}`;
    run(
      db,
      `INSERT INTO work_packages
       (id, venture_id, workflow_id, kind, title, status, owner_group, metadata, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [packageId, ventureId, workflowId, packageKind, taskTitle, "planned", packageKind, toJson({ contributors }), ts, ts],
    );
    run(
      db,
      `INSERT INTO tasks (id, workflow_id, venture_id, title, kind, agent, status, priority, max_retries, cost_budget_cents, payload, result, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        taskId,
        workflowId,
        ventureId,
        taskTitle,
        kind,
        agent,
        "planned",
        priority,
        2,
        taskBudgetCents(kind),
        toJson({ commandId, subject, channel, budgetCents: taskBudgetCents(kind), packageId, packageKind, contributors }),
        toJson({ waitingFor: "agent_runner" }),
        ts,
        ts,
      ],
    );
    return { id: taskId, title: taskTitle, kind, agent, status: "planned", priority, packageId, packageKind };
  });

  const deliverables = deliverableTemplates(intent, channel, subject, wantsMockups).map((template) => {
    const deliverableId = `deliv_${slugForId(template.title)}_${randomId().slice(0, 8)}`;
    const artifactKey = `${slugForId(template.title)}-${workflowId}`;
    run(
      db,
      `INSERT INTO deliverables (id, workflow_id, command_id, venture_id, title, human_name, audience, format, status, file_path, summary, metadata, artifact_key, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        deliverableId,
        workflowId,
        commandId,
        ventureId,
        template.title,
        template.humanName,
        "operator",
        template.format,
        "planned",
        null,
        template.summary,
        toJson({ sections: template.sections, pdfPreferred: template.format.includes("pdf"), materialize: input.createFiles !== false }),
        artifactKey,
        ts,
        ts,
      ],
    );
    const rendered = input.createFiles === false ? null : renderDeliverable(db, deliverableId);
    return { id: deliverableId, humanName: template.humanName, status: "planned", filePath: rendered?.storedPath || null };
  });

  run(
    db,
    `INSERT INTO messages (id, severity, status, subject, body, created_at, metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      `msg_${slugForId(subject)}_${randomId().slice(0, 8)}`,
      "info",
      "open",
      `${subject} workflow planned`,
      "The runtime created the workflow, staged dry-run agent tasks, and registered human-facing deliverables. Live model/tool execution is still locked until credentials, adapters, cost controls, and approvals are proven.",
      ts,
      toJson({ commandId, workflowId }),
    ],
  );

  insertEvent(db, {
    actor: "orchestrator",
    type: "command.planned",
    entityType: "command",
    entityId: commandId,
    message: `Created workflow plan: ${title}.`,
    metadata: { workflowId, intent, channel, subject, deliverables: deliverables.length, tasks: tasks.length },
  });

  return {
    command: { id: commandId, rawText, intent, status: "planned", workflowId, summary },
    workflow: get(db, "SELECT * FROM workflows WHERE id = ?", [workflowId]),
    tasks,
    deliverables,
  };
}

module.exports = {
  createCommandPlan,
  inferIntent,
  inferSubject,
};
