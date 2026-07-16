const CONFIG = require("../config");
const { all, fromJson, get, insertEvent, now, randomId, run, toJson } = require("../db");
const { runResearchTask } = require("../adapters/research");
const { recordModelCall } = require("../adapters/model-router");
const { runAgentRuntimeTask } = require("./agent-runtime");
const { getSpendApprovalState } = require("./spend-gate");
const {
  addAgentTrace,
  attachWorkerDecisionContract,
  createAgentRun,
  evaluateAgentOutput,
  findAgentDefinition,
  finishAgentRun,
  recordAgentFailure,
  workerDecisionMetadata,
} = require("./ai-team");
const { isAgentToolApprovalRequiredError, requireAgentToolUse } = require("./agent-tool-gate");
const { getAgentToolPolicyForAgent } = require("./agent-tools");
const { createResearchToExperimentPlanFromResearch } = require("./research-to-experiment");
const { upsertDeliverableSection } = require("./deliverables");
const { recordPilotRunReview } = require("./agent-pilot");

const AGENT_POLICIES = {
  goal_planning: {
    modelClass: "reasoning-medium",
    maxCostCents: 10,
    allowedTools: ["runtime_state", "local_deliverables"],
    blockedTools: ["live_web", "marketplace_publish", "payments"],
  },
  market_research: {
    modelClass: "research-high",
    maxCostCents: 60,
    allowedTools: ["runtime_state", "local_deliverables"],
    blockedTools: ["live_web_until_adapter", "marketplace_publish", "payments"],
  },
  live_market_research: {
    modelClass: "research-high",
    maxCostCents: 60,
    allowedTools: ["runtime_state", "local_deliverables", "live_web_with_approval"],
    blockedTools: ["marketplace_publish", "supplier_publish", "payments"],
  },
  live_ai_worker_execution: {
    modelClass: "reasoning-high",
    maxCostCents: 100,
    allowedTools: ["runtime_state", "agent_traces", "approval_pack"],
    blockedTools: ["external_action", "publishing", "payments"],
  },
  workbench_proof: {
    modelClass: "reasoning-medium",
    maxCostCents: 10,
    allowedTools: ["runtime_state", "agent_traces", "local_deliverables"],
    blockedTools: ["external_action", "publishing", "customer_contact", "payments"],
  },
  handoff_followup: {
    modelClass: "reasoning-high",
    maxCostCents: 20,
    allowedTools: ["runtime_state", "agent_traces", "local_deliverables", "approval_pack"],
    blockedTools: ["external_action", "publishing", "customer_contact", "payments"],
  },
  offer_architecture: {
    modelClass: "reasoning-medium",
    maxCostCents: 35,
    allowedTools: ["runtime_state", "local_deliverables", "research_summary"],
    blockedTools: ["external_send", "marketplace_publish", "payments"],
  },
  product_action_plan: {
    modelClass: "creative-vision",
    maxCostCents: 45,
    allowedTools: ["runtime_state", "local_deliverables", "execution_pack_inputs"],
    blockedTools: ["image_generation_spend", "marketplace_publish", "supplier_publish"],
  },
  conversion_copy: {
    modelClass: "reasoning-medium",
    maxCostCents: 35,
    allowedTools: ["runtime_state", "local_deliverables", "execution_pack_inputs"],
    blockedTools: ["external_send", "publishing", "unsupported_claims"],
  },
  distribution_plan: {
    modelClass: "reasoning-medium",
    maxCostCents: 35,
    allowedTools: ["runtime_state", "local_deliverables", "results_ledger"],
    blockedTools: ["external_send", "marketplace_publish", "account_actions"],
  },
  commercial_analysis: {
    modelClass: "reasoning-medium",
    maxCostCents: 35,
    allowedTools: ["runtime_state", "local_deliverables"],
    blockedTools: ["payments", "accounting_write"],
  },
  feedback_analysis: {
    modelClass: "reasoning-medium",
    maxCostCents: 25,
    allowedTools: ["runtime_state", "local_deliverables", "commercial_feedback"],
    blockedTools: ["customer_reply_send", "refunds", "disputes"],
  },
  result_analysis: {
    modelClass: "reasoning-high",
    maxCostCents: 25,
    allowedTools: ["runtime_state", "commercial_results", "learning_cycles"],
    blockedTools: ["autopilot_promotion", "increase_spend", "external_action"],
  },
  risk_screen: {
    modelClass: "reasoning-high",
    maxCostCents: 30,
    allowedTools: ["runtime_state", "local_deliverables"],
    blockedTools: ["legal_determination", "marketplace_publish"],
  },
  mockup_direction: {
    modelClass: "creative-vision",
    maxCostCents: 80,
    allowedTools: ["runtime_state", "local_deliverables"],
    blockedTools: ["image_generation_spend", "supplier_publish"],
  },
  operator_pack_qc: {
    modelClass: "quality-review-high",
    maxCostCents: 25,
    allowedTools: ["runtime_state", "local_deliverables"],
    blockedTools: ["external_send", "marketplace_publish", "payments"],
  },
};

function policyForTask(task) {
  return AGENT_POLICIES[task.kind] || {
    modelClass: "fast-general",
    maxCostCents: 10,
    allowedTools: ["runtime_state"],
    blockedTools: ["external_action"],
  };
}

function hydrateWorkflow(workflow) {
  return {
    ...workflow,
    metadata: fromJson(workflow.metadata),
  };
}

function deliverablesForWorkflow(db, workflowId) {
  return all(db, "SELECT * FROM deliverables WHERE workflow_id = ? ORDER BY created_at ASC", [workflowId]).map((deliverable) => ({
    ...deliverable,
    metadata: fromJson(deliverable.metadata),
  }));
}

function commandForWorkflow(db, workflowId) {
  return get(db, "SELECT * FROM commands WHERE workflow_id = ? ORDER BY created_at DESC LIMIT 1", [workflowId]);
}

function textIncludes(text, terms) {
  const haystack = String(text || "").toLowerCase();
  return terms.some((term) => haystack.includes(term));
}

function nextActionId(task) {
  const suffix = String(task.payload?.handoffId || task.id || randomId())
    .replace(/^agent_handoff_/, "")
    .replace(/^task_/, "")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .slice(0, 48);
  return `next_action_${suffix || randomId().slice(0, 8)}`;
}

function inferHandoffNextAction(task) {
  const payload = task.payload || {};
  const combined = [
    payload.handoffSummary,
    payload.decisionNeeded,
    payload.taskTitle,
    payload.workflowTitle,
  ].filter(Boolean).join(" ");
  const highRisk = String(payload.riskLevel || "").toLowerCase() === "high"
    || textIncludes(combined, ["risk", "legal", "trademark", "platform", "publish", "customer", "refund", "dispute"]);
  if (highRisk) {
    return {
      type: "resolve_risk_before_external_action",
      title: "Clear the risk before any outside action",
      recommendation: "Use the approved handoff to identify the exact risk, missing evidence, and safest internal fix before any sending, publishing, spend, or customer contact.",
      action: "Open the workflow, review the risk notes, and request changes or a review pack update before moving toward market contact.",
      successMetric: "Risk is either cleared, reduced to a safe manual test, or escalated for human/specialist review.",
      killCriteria: "Stop or request changes if the risk, buyer claim, platform rule, or legal/compliance question is unclear.",
    };
  }
  if (textIncludes(combined, ["market-contact", "manual test", "execution pack", "channel", "distribution", "buyer signal", "run the test"])) {
    return {
      type: "prepare_manual_market_test",
      title: "Prepare the next manual market test",
      recommendation: "Turn the approved handoff into one small test pack with buyer, offer, channel, copy, tracking, and a result button before any outside action happens.",
      action: "Open the workflow, plan the next test, generate the review pack if needed, then use the execution pack only for a manual operator-approved test.",
      successMetric: "A manual test is ready with buyer, problem, offer, channel, expected metric, cap, and stop rule.",
      killCriteria: "Do not run the test if the buyer, offer, channel, metric, or stop rule is vague.",
    };
  }
  if (textIncludes(combined, ["research", "evidence", "source", "demand", "competitor", "pricing"])) {
    return {
      type: "strengthen_demand_evidence",
      title: "Strengthen demand evidence",
      recommendation: "Use the approved handoff to prepare the smallest evidence-gathering step, keeping live research and paid model calls behind separate approval.",
      action: "Open the workflow and request a capped live research test only when the provider setup and approval are ready.",
      successMetric: "Current demand, competitor, pricing, and risk evidence is captured with confidence and sources.",
      killCriteria: "Stop or revise if evidence shows weak demand, poor economics, or no reachable buyer channel.",
    };
  }
  return {
    type: "choose_next_internal_business_step",
    title: "Choose the next internal business step",
    recommendation: "Convert the approved worker handoff into one clear protected action so the operator can steer without digging through task records.",
    action: "Open the workflow, generate or update the review pack, and decide the next smallest business test.",
    successMetric: "The next action is visible as a money move with evidence, risk, cap, and a clear decision path.",
    killCriteria: "Request changes if the work cannot name buyer, problem, offer, channel, metric, and risk.",
  };
}

function commercialNextActionForHandoff(task, output) {
  const payload = task.payload || {};
  const inferred = inferHandoffNextAction(task);
  const costCapCents = Math.max(0, Number(task.cost_budget_cents || 0));
  return {
    id: nextActionId(task),
    type: inferred.type,
    title: inferred.title,
    status: "recommended",
    recommendation: inferred.recommendation,
    hypothesis: "If the AI team turns approved handoffs into one visible next move, the operator can make faster commercial decisions while the runtime keeps risky actions locked.",
    action: inferred.action,
    successMetric: inferred.successMetric,
    killCriteria: inferred.killCriteria,
    learningSignal: "The operator decision and next result should improve future handoff recommendations.",
    expectedUpsideCents: 0,
    costCapCents,
    risk: payload.riskLevel || "medium",
    workflowId: task.workflow_id || null,
    taskId: task.id || null,
    handoffId: payload.handoffId || null,
    sourceRunId: payload.sourceRunId || null,
    sourceAgent: payload.fromAgentId || null,
    nextOwner: payload.toAgentId || task.agent || "chief_of_staff",
    evidence: output.evidence || [],
    operatorDecisionRequired: true,
    externalActionsAllowed: false,
    hardStops: ["publishing", "external sending", "customer contact", "paid spend", "money movement", "legal or compliance decisions"],
    dashboardActions: ["Open Follow-Up", "Open Workflow", "Plan Next Test", "Generate Review Pack"],
  };
}

function recordCommercialNextAction(db, agentRun, task, output) {
  const action = output?.commercialNextAction;
  if (task.kind !== "handoff_followup" || !action) return null;
  const ts = now();
  const metadata = { commercialNextAction: action, workflowId: task.workflow_id || null, taskId: task.id };
  run(
    db,
    `INSERT INTO messages (id, task_id, severity, status, subject, body, created_at, metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      `msg_next_action_${randomId()}`,
      task.id,
      "info",
      "open",
      "Chief of Staff next business action ready",
      `${action.title}: ${action.recommendation}`,
      ts,
      toJson(metadata),
    ],
  );
  insertEvent(db, {
    actor: "chief_of_staff",
    type: "commercial.next_action_recommended",
    entityType: "task",
    entityId: task.id,
    message: `Chief of Staff recommended the next business action: ${action.title}.`,
    metadata,
  });
  addAgentTrace(
    db,
    agentRun.id,
    "commercial_next_action_recommended",
    "Next business action ready",
    action.recommendation,
    metadata,
  );
  return action;
}

function outputForTask(task, workflow, command) {
  const subject = task.payload.subject || workflow.metadata.subject || "the business idea";
  const channel = task.payload.channel || workflow.metadata.channel || "Business Idea";
  const instruction = workflow.metadata.originalInstruction || command?.raw_text || "No operator instruction captured.";

  if (task.kind === "goal_planning") {
    return {
      heading: "Goal and success criteria",
      summary: `Turn the operator instruction into a controlled ${channel} validation workflow for ${subject}.`,
      evidence: [
        "Goal has been reduced into research, commercial, risk, design, and QC tasks.",
        "Live external actions remain blocked until adapters, credentials, and approval rules are proven.",
      ],
      nextAction: "Run market research with a live research adapter when available; use dry-run assumptions until then.",
      originalInstruction: instruction,
    };
  }

  if (task.kind === "market_research") {
    return {
      heading: "Market research dry-run",
      summary: `Prepared the research frame for ${subject}; this is not yet live market evidence.`,
      evidence: [
        "Demand must be proven with current marketplace/search data before money is spent.",
        "Competitor, pricing, and trend checks are listed as required live-research adapter inputs.",
      ],
      nextAction: "Connect live research/search tooling, then rerun this task for commercial-grade evidence.",
      confidence: "low_until_live_research",
    };
  }

  if (task.kind === "offer_architecture") {
    return {
      heading: "Offer architecture",
      summary: `Turned ${subject} into a buyer-facing offer frame for ${channel}.`,
      evidence: [
        "The offer is framed around a named buyer, painful problem, promise, format, price assumption, and buying trigger.",
        "The offer remains a test hypothesis until market contact or live research proves demand.",
      ],
      details: {
        Buyer: task.payload.buyer || workflow.metadata.buyer || "Specific buyer segment still needs live evidence.",
        Promise: `A focused shortcut that helps the buyer solve ${subject.toLowerCase()} with less setup effort.`,
        Format: channel === "Digital Product" ? "Small downloadable template, checklist, or workspace asset." : "Smallest sellable test asset.",
        "Buying trigger": "The buyer wants a faster, lower-effort way to solve the problem this week.",
        "Primary objection": "Buyer may not believe the promise is specific enough without proof or examples.",
      },
      nextAction: "Use this offer frame to prepare conversion copy and the smallest safe market-contact test.",
      confidence: "medium_for_offer_structure_low_for_demand",
    };
  }

  if (task.kind === "product_action_plan") {
    return {
      heading: "Product action plan",
      summary: `Outlined the smallest sellable version of ${subject} for a protected commercial test.`,
      evidence: [
        "The product plan is intentionally small so buyer demand can be tested before more build time is spent.",
        "No live file delivery, paid asset generation, upload, or external publishing is allowed from this task.",
      ],
      details: {
        "Core asset": channel === "Digital Product" ? "Template or checklist plus short setup guide." : "Proof asset matched to the channel.",
        "Must include": "Clear outcome, one-page instructions, example use case, and a simple next-step checklist.",
        "Quality bar": "Useful enough for a buyer to understand the promise without a sales call.",
        "Do not build yet": "Advanced variants, automations, branding polish, or paid media assets.",
      },
      nextAction: "Prepare copy and distribution steps for a manual market-contact run before building more.",
      confidence: "medium_for_scope",
    };
  }

  if (task.kind === "conversion_copy") {
    return {
      heading: "Copy and conversion kit",
      summary: `Prepared protected-mode conversion copy for ${subject}.`,
      evidence: [
        "The copy uses plain buyer language and avoids unsupported income, legal, compliance, or guarantee claims.",
        "The call to action is measurable so results can feed the learning loop.",
      ],
      details: {
        Headline: `${subject}: a simpler way to get the outcome without heavy setup`,
        Description: `A compact ${channel.toLowerCase()} test for buyers who want the practical shortcut before investing more time.`,
        CTA: `Reply if you want the pilot version of ${subject}.`,
        "Message variant": `I am testing ${subject} for a small buyer group. Would this solve a real problem for you?`,
      },
      nextAction: "Use this copy in the execution pack or manual channel test only after the operator approves any external contact.",
      confidence: "medium_for_copy_low_for_conversion",
    };
  }

  if (task.kind === "distribution_plan") {
    return {
      heading: "Distribution and market-contact plan",
      summary: `Prepared a manual, no-spend channel test for ${subject}.`,
      evidence: [
        "Distribution is scoped to small manual contact or posting so there is no account, reputation, or automation risk.",
        "The plan defines what evidence must be captured before the system recommends scale, revise, pause, or stop.",
      ],
      details: {
        Channel: channel === "Digital Product" ? "Small manual sample in relevant communities, owned audience, or direct replies." : "Smallest reachable buyer channel.",
        "Touchpoint target": "20-50 relevant views, replies, or direct buyer touchpoints.",
        "Track": "Views, clicks, replies, leads, sales, objections, refunds, spend, and time.",
        "Stop rule": "Stop or revise if the test produces exposure but no useful buyer action.",
      },
      nextAction: "Generate or use an execution pack, run the test manually, then record the result in the Results tab.",
      confidence: "medium_for_manual_channel_plan",
    };
  }

  if (task.kind === "live_market_research") {
    return {
      heading: "Live market research",
      summary: `Prepared the approved live research execution path for ${subject}.`,
      evidence: [
        "This task may only run after spend approval, provider credentials, and adapter readiness all pass.",
        "The live adapter must capture citations, source freshness, cost, assumptions, and confidence before any go decision.",
      ],
      nextAction: "Run the vetted live research adapter and capture current commercial evidence.",
      confidence: "pending_live_provider_execution",
    };
  }

  if (task.kind === "live_ai_worker_execution") {
    return {
      heading: "Live AI worker test",
      summary: `Prepared the approved live worker execution path for ${subject}.`,
      evidence: [
        "This task may only run after spend approval, OpenAI credentials, live-model flag, and adapter readiness all pass.",
        "The live worker must return traceable output, cost records, quality checks, and an operator-readable recommendation.",
      ],
      nextAction: "Run the approved live worker and review its recommendation before any external action.",
      confidence: "pending_live_worker_execution",
    };
  }

  if (task.kind === "workbench_proof") {
    const workerName = task.payload.workerName || task.agent || "AI worker";
    const proofGoal = task.payload.proofGoal || "Prove this worker can produce a useful business decision contract without live spend.";
    const requiredOutputs = Array.isArray(task.payload.requiredOutputs) && task.payload.requiredOutputs.length
      ? task.payload.requiredOutputs.map((field) => String(field).replaceAll("_", " ")).join(", ")
      : "buyer, problem, offer, evidence, risk, next action, and learning";
    return {
      heading: `${workerName} protected proof`,
      summary: `${workerName} completed a protected Workbench proof for ${subject}. The result is suitable for judging worker readiness, not for external action.`,
      evidence: [
        "The proof used the local runtime ledger only; no live model call, customer contact, publishing, account action, or spend occurred.",
        `The worker produced the required business-decision fields for: ${requiredOutputs}.`,
        "The output is recorded for Workbench promotion review before any capped live comparison is considered.",
      ],
      details: {
        Worker: workerName,
        "Proof goal": proofGoal,
        Buyer: task.payload.buyer || workflow.metadata.buyer || "Digital product buyers",
        Offer: task.payload.offer || workflow.metadata.offer || "Protected digital-product proof before external work.",
        Channel: task.payload.channel || workflow.metadata.channel || "Digital Product",
        "Readiness question": "Can this worker produce a useful, safe, operator-readable decision without live tools?",
      },
      nextAction: "Review this proof in the AI Team Workbench. Only consider a capped live comparison after provider setup, budget, and approval controls pass.",
      confidence: "protected_proof_passed_no_live_evidence",
      qualityScore: 84,
    };
  }

  if (task.kind === "handoff_followup") {
    const fromAgent = task.payload.fromAgentId || "previous worker";
    const toAgent = task.payload.toAgentId || "Chief of Staff";
    const note = task.payload.operatorNote || "Approved for internal follow-up.";
    const output = {
      heading: "Chief of Staff handoff follow-up",
      summary: `Reviewed the approved handoff from ${fromAgent} to ${toAgent} and converted it into the next safe internal business step.`,
      evidence: [
        task.payload.handoffSummary || "The source worker handed over its recommendation for operator review.",
        `Operator decision: approved. Note: ${note}`,
        `Risk level remains ${task.payload.riskLevel || "medium"} until the next evidence check is complete.`,
      ],
      details: {
        "Source worker": fromAgent,
        "Next owner": toAgent,
        "Original decision needed": task.payload.decisionNeeded || "Review the worker output and choose the next safe move.",
        "Review stance": "Continue internally; do not send, publish, spend, or contact customers from this task.",
      },
      nextAction: "Run the next protected workflow step or prepare a review pack; external action still requires a separate operator approval.",
      confidence: "approved_for_internal_followup",
      qualityScore: 78,
    };
    output.commercialNextAction = commercialNextActionForHandoff(task, output);
    return output;
  }

  if (task.kind === "commercial_analysis") {
    return {
      heading: "Commercial viability dry-run",
      summary: `Built the unit-economics checklist for ${subject}.`,
      evidence: [
        "Gross margin, refund risk, platform fees, ad spend, and supplier costs must be checked before publishing.",
        "The workflow remains zero-spend in dry-run mode.",
      ],
      nextAction: "Require live supplier/platform pricing before a go decision.",
      confidence: "medium_for_structure_low_for_numbers",
    };
  }

  if (task.kind === "feedback_analysis") {
    return {
      heading: "Customer signal and objection plan",
      summary: `Prepared the feedback capture plan for ${subject}.`,
      evidence: [
        "Customer signal must be captured as buyer language, objections, requests, refunds, and confusion points.",
        "The agent does not send customer replies or handle disputes; those remain operator-gated.",
      ],
      details: {
        "Ask buyers": "What would stop you buying this today?",
        "Capture exactly": "The buyer's words about price, promise, format, timing, trust, and missing proof.",
        "Useful signal": "A specific objection or requested change is more useful than a vague like.",
        "Escalate": "Refund, dispute, legal/compliance, or sensitive customer issue.",
      },
      nextAction: "After any market contact, record replies or objections so the learning loop can revise the offer.",
      confidence: "medium_for_feedback_design",
    };
  }

  if (task.kind === "result_analysis") {
    return {
      heading: "Result analysis and learning plan",
      summary: `Prepared the measurement rules for ${subject}.`,
      evidence: [
        "The system will compare the hypothesis and expected metric against actual views, clicks, leads, sales, refunds, spend, time, and feedback.",
        "Reality overrides the plan: weak signals should revise or stop the offer instead of creating more process work.",
      ],
      details: {
        Continue: "Sales or qualified leads appear with manageable spend, refund risk, and buyer objections.",
        Revise: "Clicks, replies, or objections appear but paid demand is weak or economics are poor.",
        Stop: "Enough exposure happens with no meaningful buyer action.",
        "Needs evidence": "The test has not reached a useful sample or has not been recorded yet.",
      },
      nextAction: "Run the manual market-contact test and record actual results so Growth can recommend continue, revise, pause, or stop.",
      confidence: "medium_for_measurement_rules",
    };
  }

  if (task.kind === "risk_screen") {
    return {
      heading: "Risk and platform screen",
      summary: `Created the risk screen for ${subject}.`,
      evidence: [
        "IP, trademark, platform policy, supplier quality, refund, and customer support risks are explicit gates.",
        "Legal/compliance determinations stay human-review or specialist-review only.",
      ],
      nextAction: "Escalate any trademark, regulated claim, or account-risk issue before publishing.",
      confidence: "medium_for_process",
    };
  }

  if (task.kind === "mockup_direction") {
    return {
      heading: "Mockup direction dry-run",
      summary: `Created a concept direction frame for ${subject}.`,
      evidence: [
        "The design task can prepare visual lanes, but paid image generation remains blocked until approval or budget policy allows it.",
        "Final mockups should be attached to an approval pack before supplier upload.",
      ],
      nextAction: "Use the image/design adapter after the concept lane and cost limit are approved.",
      confidence: "medium_for_direction",
    };
  }

  if (task.kind === "operator_pack_qc") {
    return {
      heading: "Operator pack QC",
      summary: `Checked whether ${subject} is ready for operator review.`,
      evidence: [
        "All dry-run task outputs are traceable in the task ledger.",
        "The pack is useful for process proof, but not yet a commercial go decision without live research and real numbers.",
      ],
      nextAction: "Ask the operator to approve live research/tool integration before treating this as a profit decision.",
      confidence: "process_ready_commercial_evidence_pending",
      qualityScore: 72,
    };
  }

  return {
    heading: task.title,
    summary: "Generic dry-run task execution recorded.",
    evidence: ["No specialized agent template exists for this task kind yet."],
    nextAction: "Add a specialized agent executor before using this task commercially.",
  };
}

function targetDeliverables(task, deliverables) {
  const titleMatch = {
    goal_planning: ["Decision Pack", "Evidence Brief"],
    market_research: ["Evidence Brief"],
    live_market_research: ["Evidence Brief", "Decision Pack"],
    live_ai_worker_execution: ["Decision Pack"],
    workbench_proof: ["Decision Pack"],
    handoff_followup: ["Decision Pack", "Commercial"],
    offer_architecture: ["Test Pack", "Decision Pack"],
    product_action_plan: ["Publish Pack", "Decision Pack"],
    conversion_copy: ["Decision Pack", "Commercial"],
    distribution_plan: ["Commercial", "Decision Pack"],
    commercial_analysis: ["Commercial"],
    feedback_analysis: ["Decision Pack", "Commercial"],
    result_analysis: ["Decision Pack", "Commercial"],
    risk_screen: ["Decision Pack", "Research Brief"],
    mockup_direction: ["Mockup Direction"],
    operator_pack_qc: ["Decision Pack"],
  }[task.kind] || [];

  return deliverables.filter((deliverable) => titleMatch.some((fragment) => deliverable.title.includes(fragment)));
}

function writeDeliverableSection(db, deliverable, task, output) {
  if (deliverable.metadata?.materialize === false) return false;
  upsertDeliverableSection(db, deliverable.id, task, output, Number(task.priority || 0));
  return true;
}

function updateDeliverables(db, task, output) {
  const ts = now();
  const deliverables = deliverablesForWorkflow(db, task.workflow_id);
  const targeted = targetDeliverables(task, deliverables);

  for (const deliverable of targeted) {
    const wroteFile = writeDeliverableSection(db, deliverable, task, output);
    run(
      db,
      `UPDATE deliverables SET status = ?, metadata = ?, updated_at = ? WHERE id = ?`,
      [
        task.kind === "operator_pack_qc" ? "ready_for_review" : "drafting",
        toJson({ ...deliverable.metadata, lastAgentTask: task.id, lastAgent: task.agent, wroteFile }),
        ts,
        deliverable.id,
      ],
    );
  }

  if (task.kind === "operator_pack_qc") {
    run(db, "UPDATE deliverables SET status = 'ready_for_review', updated_at = ? WHERE workflow_id = ? AND status IN ('planned', 'drafting')", [ts, task.workflow_id]);
  }

  return targeted.map((deliverable) => deliverable.id);
}

function enforceBudget(task, policy) {
  const taskBudget = Number(task.cost_budget_cents) || policy.maxCostCents;
  if (policy.maxCostCents > taskBudget) {
    throw new Error(`Agent policy cost cap ${policy.maxCostCents}c exceeds task budget ${taskBudget}c.`);
  }
}

function applyFailureProofControls(task) {
  const proof = task.payload.failureProof || {};
  if (proof.failFirstAttempt && Number(task.retries || 0) === 0) {
    throw new Error(proof.message || "Injected recoverable dry-run agent failure before external action.");
  }
  if (proof.alwaysFail) {
    throw new Error(proof.message || "Injected permanent dry-run agent failure before external action.");
  }
}

function workerHasTool(agentDefinition, toolId) {
  return Array.isArray(agentDefinition.tools) && agentDefinition.tools.includes(toolId);
}

function checkWorkerTool(db, agentRun, task, agentDefinition, toolId, options = {}) {
  if (!options.strict && !workerHasTool(agentDefinition, toolId)) return null;
  return requireAgentToolUse(db, {
    agentId: agentDefinition.id,
    agentName: agentDefinition.name,
    runId: agentRun.id,
    task,
    toolId,
    mode: options.mode || "protected",
    reason: options.reason,
    inputSummary: options.inputSummary || `${agentDefinition.name} requested ${toolId} for ${task.title}.`,
  });
}

function summarizeToolCheck(check) {
  if (!check) return null;
  return {
    id: check.id,
    toolId: check.tool?.id || null,
    toolName: check.tool?.name || null,
    status: check.status,
    decision: check.decision,
    approvalId: check.approvalId || null,
  };
}

function summarizeResearchBridge(bridge) {
  if (!bridge || bridge.skipped) return bridge ? { skipped: true, reason: bridge.reason } : null;
  return {
    skipped: false,
    alreadyCreated: Boolean(bridge.alreadyCreated),
    sourceResearchRunId: bridge.researchRun?.id || null,
    briefId: bridge.brief?.id || null,
    candidateCount: bridge.candidates?.length || 0,
    recommendedCandidateId: bridge.recommended?.id || null,
    recommendedTitle: bridge.recommended?.title || null,
    recommendedAction: bridge.recommended?.smallest_action || null,
    successMetric: bridge.recommended?.success_metric || null,
    killCriteria: bridge.recommended?.kill_criteria || null,
    confidence: bridge.recommended?.confidence || null,
    evidenceScore: bridge.recommended?.evidence_score || null,
  };
}

async function runAgentTask(db, task) {
  const workflow = hydrateWorkflow(get(db, "SELECT * FROM workflows WHERE id = ?", [task.workflow_id]));
  const command = commandForWorkflow(db, task.workflow_id);
  const policy = policyForTask(task);
  const agentDefinition = findAgentDefinition(db, task);
  const toolAccess = getAgentToolPolicyForAgent(db, agentDefinition.id);
  const isLiveResearchTask = task.kind === "live_market_research";
  const isLiveAiWorkerTask = task.kind === "live_ai_worker_execution";
  const humanReviewRequired = task.kind === "operator_pack_qc" || task.kind === "risk_screen" || isLiveResearchTask || isLiveAiWorkerTask;
  const agentRun = createAgentRun(db, agentDefinition, task, {
    mode: isLiveResearchTask ? "approval-gated-live-ready" : isLiveAiWorkerTask ? "openai-agents-sdk" : "dry-run",
    inputSummary: `${task.title} for workflow ${task.workflow_id}`,
    approvalRequired: humanReviewRequired,
  });

  let modelCall = null;
  let research = null;
  let output = null;
  let touchedDeliverables = [];
  let effectiveModelCall = null;
  let spendApproval = null;
  let researchBridge = null;
  const toolChecks = [];

  try {
    addAgentTrace(db, agentRun.id, "policy_selected", "Worker policy selected", `${agentDefinition.name} uses ${policy.modelClass} with a ${policy.maxCostCents}c cap.`, {
      allowedTools: policy.allowedTools,
      blockedTools: policy.blockedTools,
      workerToolPolicy: {
        status: toolAccess.status,
        allowed: toolAccess.allowed.map((assignment) => assignment.tool_id),
        approvalRequired: toolAccess.approvalRequired.map((assignment) => assignment.tool_id),
        blocked: toolAccess.blocked.map((assignment) => assignment.tool_id),
      },
    });
    enforceBudget(task, policy);
    applyFailureProofControls(task);
    toolChecks.push(summarizeToolCheck(checkWorkerTool(db, agentRun, task, agentDefinition, "runtime_state", {
      reason: "Read local runtime state before worker execution.",
    })));

    spendApproval = getSpendApprovalState(db, task);
    addAgentTrace(db, agentRun.id, "guardrails_checked", "Guardrails checked", "Spend, tool, and approval rules were checked before work continued.", {
      spendApproval,
      humanReviewRequired,
      workerToolPolicy: {
        status: toolAccess.status,
        summary: toolAccess.summary,
        externalActionsRequireApproval: toolAccess.externalActionsRequireApproval,
        spendRequiresApproval: toolAccess.spendRequiresApproval,
      },
    });

    if (isLiveAiWorkerTask) {
      const liveWorker = await runAgentRuntimeTask(db, task, agentDefinition, policy);
      addAgentTrace(
        db,
        agentRun.id,
        "model_call_completed",
        "Live worker model call complete",
        `${liveWorker.model} returned an operator-ready worker result with a capped model call.`,
        {
          modelCallId: liveWorker.modelCall.id,
          responseId: liveWorker.raw.responseId,
          agentSdkTraceId: liveWorker.raw.traceId || null,
          structuredOutput: liveWorker.raw.structuredOutput,
          provider: liveWorker.provider,
        },
      );
      output = liveWorker.output;
      attachWorkerDecisionContract(task, workflow, output, agentDefinition, { policy, spendApproval, humanReviewRequired: true });
      addAgentTrace(
        db,
        agentRun.id,
        "contract_checked",
        "Business decision ready",
        `${agentDefinition.name} returned buyer, offer, evidence, risk, next action, and learning details in a structured business format.`,
        {
          contract: output.outputContract,
          businessDecision: workerDecisionMetadata(output),
        },
      );
      toolChecks.push(summarizeToolCheck(checkWorkerTool(db, agentRun, task, agentDefinition, "local_deliverables", {
        reason: "Update local review outputs with the live worker result.",
      })));
      touchedDeliverables = updateDeliverables(db, task, output);
      addAgentTrace(db, agentRun.id, "deliverables_updated", "Review outputs updated", `${touchedDeliverables.length} deliverable${touchedDeliverables.length === 1 ? "" : "s"} updated by ${agentDefinition.name}.`, {
        deliverables: touchedDeliverables,
        outputHeading: output.heading,
      });
      effectiveModelCall = liveWorker.modelCall;
      const evalResult = evaluateAgentOutput(db, agentDefinition, agentRun, task, output, {
        requiresApproval: humanReviewRequired,
        deliverables: touchedDeliverables,
      });
      finishAgentRun(db, agentRun.id, {
        status: "completed",
        outputSummary: output.summary,
        modelCallId: effectiveModelCall.id,
        estimatedCostCents: effectiveModelCall.estimatedCostCents,
        actualCostCents: effectiveModelCall.actualCostCents,
        approvalRequired: true,
        handoffTo: "chief_of_staff",
        evalStatus: evalResult.status,
        metadata: {
          taskKind: task.kind,
          taskTitle: task.title,
          outputHeading: output.heading,
          evalId: evalResult.id,
          evalScore: evalResult.score,
          deliverables: touchedDeliverables,
          liveWorkerResponseId: liveWorker.raw.responseId,
          agentSdkTraceId: liveWorker.raw.traceId || null,
          structuredOutput: liveWorker.raw.structuredOutput,
          businessDecision: workerDecisionMetadata(output),
          outputContract: output.outputContract,
          toolPolicy: {
            status: toolAccess.status,
            summary: toolAccess.summary,
            allowed: toolAccess.allowed.map((assignment) => assignment.tool_id),
            approvalRequired: toolAccess.approvalRequired.map((assignment) => assignment.tool_id),
            blocked: toolAccess.blocked.map((assignment) => assignment.tool_id),
          },
          toolGate: toolChecks.filter(Boolean),
        },
      });
      const pilotReview = recordPilotRunReview(db, {
        runId: agentRun.id,
        task,
        output,
        liveWorker,
      });

      return {
        mode: liveWorker.mode || "openai-agents-sdk",
        agent: task.agent,
        taskKind: task.kind,
        aiTeam: {
          agentId: agentDefinition.id,
          agentName: agentDefinition.name,
          runId: agentRun.id,
          evalId: evalResult.id,
          evalStatus: evalResult.status,
          evalScore: evalResult.score,
          handoffTo: "chief_of_staff",
        },
        modelPolicy: {
          callId: effectiveModelCall.id,
          provider: effectiveModelCall.provider,
          class: effectiveModelCall.class,
          selectedModel: effectiveModelCall.selectedModel,
          mode: effectiveModelCall.mode,
          status: effectiveModelCall.status,
          estimatedCostCents: effectiveModelCall.estimatedCostCents,
          actualCostCents: effectiveModelCall.actualCostCents,
          exactBillingPending: Boolean(effectiveModelCall.exactBillingPending),
          reason: liveWorker.provider === "openai-agents-sdk"
            ? "Live AI worker used the approved OpenAI Agents SDK runner. No external tools or side effects were exposed."
            : "Live AI worker used the preserved approved OpenAI Responses API fallback path. No external tools or side effects were exposed.",
        },
        toolPolicy: {
          allowed: policy.allowedTools,
          blocked: policy.blockedTools,
          workerStatus: toolAccess.status,
          workerAllowed: toolAccess.allowed.map((assignment) => assignment.tool_id),
          workerApprovalRequired: toolAccess.approvalRequired.map((assignment) => assignment.tool_id),
          workerBlocked: toolAccess.blocked.map((assignment) => assignment.tool_id),
          externalActionsAllowed: false,
          liveModelCallAllowed: true,
        },
        toolGate: toolChecks.filter(Boolean),
        cost: {
          budgetCents: Number(task.cost_budget_cents) || policy.maxCostCents,
          estimatedCents: effectiveModelCall.estimatedCostCents,
          actualCents: effectiveModelCall.actualCostCents,
          currency: CONFIG.currency,
          exactBillingPending: Boolean(effectiveModelCall.exactBillingPending),
        },
        spendApproval,
        output,
        deliverables: touchedDeliverables,
        humanReviewRequired,
        pilotReview,
      };
    }

    modelCall = isLiveResearchTask ? null : recordModelCall(db, task, policy);
    if (modelCall) {
      addAgentTrace(db, agentRun.id, "model_route_recorded", "AI usage route recorded", `${modelCall.selectedModel} is recorded in protected mode; no paid model call was made.`, {
        modelCallId: modelCall.id,
        estimatedCostCents: modelCall.estimatedCostCents,
      });
    }

    const isResearchTask = ["market_research", "live_market_research"].includes(task.kind);
    if (isResearchTask) {
      toolChecks.push(summarizeToolCheck(checkWorkerTool(db, agentRun, task, agentDefinition, "research_adapter", {
        strict: true,
        mode: isLiveResearchTask ? "live" : "protected",
        reason: isLiveResearchTask
          ? "Use approved live research only after the operator approval and provider gates pass."
          : "Use the protected research adapter path without live web spend.",
      })));
    }
    research = isResearchTask ? await runResearchTask(db, task, workflow, command, { live: isLiveResearchTask }) : null;
    if (research) {
      addAgentTrace(db, agentRun.id, "tool_result_recorded", "Research tool result recorded", `Research captured ${research.sources.length} source record${research.sources.length === 1 ? "" : "s"}.`, {
        researchRunId: research.id,
        mode: research.mode,
        status: research.status,
      });
    }

    output = outputForTask(task, workflow, command);
    if (research) {
      output.evidence = [
        `Research run ${research.id} captured ${research.sources.length} source record${research.sources.length === 1 ? "" : "s"}.`,
        ...output.evidence,
      ];
      if (research.mode === "live") {
        output.summary = research.summary;
        output.nextAction = research.recommendation || "Review live research and decide keep, revise, or kill.";
        output.confidence = research.confidence || "medium_with_live_research";
        output.liveEvidence = true;
        output.verdict = research.verdict;
        output.evidence.push(`Live research verdict: ${research.verdict || "research_inconclusive"}.`);
        researchBridge = createResearchToExperimentPlanFromResearch(db, research.id, {
          createdBy: agentDefinition.id,
        });
        if (researchBridge && !researchBridge.skipped) {
          const bridgeSummary = summarizeResearchBridge(researchBridge);
          output.nextAction = bridgeSummary.recommendedTitle
            ? `Review the top next-test option: ${bridgeSummary.recommendedTitle}.`
            : output.nextAction;
          output.evidence.push(`${bridgeSummary.candidateCount} ranked commercial test option${bridgeSummary.candidateCount === 1 ? "" : "s"} prepared from live research.`);
          output.commercialTestBridge = bridgeSummary;
          addAgentTrace(
            db,
            agentRun.id,
            "research_test_candidates_created",
            "Next commercial tests prepared",
            bridgeSummary.recommendedTitle
              ? `Live research now has a recommended next test: ${bridgeSummary.recommendedTitle}.`
              : "Live research was converted into ranked commercial test options.",
            bridgeSummary,
          );
        }
      } else {
        output.nextAction = "Approve/connect live research before treating this as commercial evidence.";
        output.confidence = "blocked_pending_live_research";
      }
    }

    attachWorkerDecisionContract(task, workflow, output, agentDefinition, { policy, spendApproval, humanReviewRequired });
    addAgentTrace(
      db,
      agentRun.id,
      "contract_checked",
      "Business decision ready",
      `${agentDefinition.name} prepared buyer, offer, evidence, risk, next action, and learning details in a structured business format.`,
      {
        contract: output.outputContract,
        businessDecision: workerDecisionMetadata(output),
      },
    );

    toolChecks.push(summarizeToolCheck(checkWorkerTool(db, agentRun, task, agentDefinition, "local_deliverables", {
      reason: "Update local review outputs with the worker result.",
    })));
    touchedDeliverables = updateDeliverables(db, task, output);
    addAgentTrace(db, agentRun.id, "deliverables_updated", "Review outputs updated", `${touchedDeliverables.length} deliverable${touchedDeliverables.length === 1 ? "" : "s"} updated by ${agentDefinition.name}.`, {
      deliverables: touchedDeliverables,
      outputHeading: output.heading,
    });
    const commercialNextAction = recordCommercialNextAction(db, agentRun, task, output);

    effectiveModelCall = research?.modelCall || modelCall || {
      id: null,
      provider: "openai",
      class: policy.modelClass,
      selectedModel: "live-research-provider",
      mode: "live",
      status: "completed",
      estimatedCostCents: Number(research?.actualCents || 0),
      actualCostCents: Number(research?.actualCents || 0),
      exactBillingPending: Boolean(research?.exactBillingPending),
    };
    const actualCostCents = Number(research?.actualCents ?? effectiveModelCall.actualCostCents ?? 0);
    const evalResult = evaluateAgentOutput(db, agentDefinition, agentRun, task, output, {
      requiresApproval: humanReviewRequired,
      research,
      deliverables: touchedDeliverables,
    });

    finishAgentRun(db, agentRun.id, {
      status: "completed",
      outputSummary: output.summary,
      modelCallId: effectiveModelCall.id,
      estimatedCostCents: effectiveModelCall.estimatedCostCents,
      actualCostCents,
      approvalRequired: humanReviewRequired,
      handoffTo: humanReviewRequired ? "chief_of_staff" : null,
      evalStatus: evalResult.status,
      metadata: {
        taskKind: task.kind,
        taskTitle: task.title,
        outputHeading: output.heading,
        evalId: evalResult.id,
        evalScore: evalResult.score,
        deliverables: touchedDeliverables,
        researchRunId: research?.id || null,
        researchBridge: summarizeResearchBridge(researchBridge),
        commercialNextActionId: commercialNextAction?.id || null,
        businessDecision: workerDecisionMetadata(output),
        outputContract: output.outputContract,
        toolPolicy: {
          status: toolAccess.status,
          summary: toolAccess.summary,
          allowed: toolAccess.allowed.map((assignment) => assignment.tool_id),
          approvalRequired: toolAccess.approvalRequired.map((assignment) => assignment.tool_id),
          blocked: toolAccess.blocked.map((assignment) => assignment.tool_id),
        },
        toolGate: toolChecks.filter(Boolean),
      },
    });

    return {
      mode: research?.mode === "live" ? "live-research-agent" : "dry-run-agent",
      agent: task.agent,
      taskKind: task.kind,
      aiTeam: {
        agentId: agentDefinition.id,
        agentName: agentDefinition.name,
        runId: agentRun.id,
        evalId: evalResult.id,
        evalStatus: evalResult.status,
        evalScore: evalResult.score,
        handoffTo: humanReviewRequired ? "chief_of_staff" : null,
      },
      modelPolicy: {
        callId: effectiveModelCall.id,
        provider: effectiveModelCall.provider,
        class: effectiveModelCall.class,
        selectedModel: effectiveModelCall.selectedModel,
        mode: effectiveModelCall.mode,
        status: effectiveModelCall.status,
        estimatedCostCents: effectiveModelCall.estimatedCostCents,
        actualCostCents: effectiveModelCall.actualCostCents,
        exactBillingPending: Boolean(effectiveModelCall.exactBillingPending),
        reason: research?.mode === "live"
          ? "Live research used the approved OpenAI Responses API web search adapter. Exact billing reconciliation is still pending."
          : "The runtime is proving orchestration, permissions, and output handling before live model spend.",
      },
      toolPolicy: {
        allowed: policy.allowedTools,
        blocked: policy.blockedTools,
        workerStatus: toolAccess.status,
        workerAllowed: toolAccess.allowed.map((assignment) => assignment.tool_id),
        workerApprovalRequired: toolAccess.approvalRequired.map((assignment) => assignment.tool_id),
        workerBlocked: toolAccess.blocked.map((assignment) => assignment.tool_id),
        externalActionsAllowed: research?.mode === "live",
      },
      toolGate: toolChecks.filter(Boolean),
      cost: {
        budgetCents: Number(task.cost_budget_cents) || policy.maxCostCents,
        estimatedCents: effectiveModelCall.estimatedCostCents,
        actualCents: actualCostCents,
        currency: CONFIG.currency,
        exactBillingPending: Boolean(research?.exactBillingPending),
      },
      spendApproval,
      output,
      research,
      researchBridge: summarizeResearchBridge(researchBridge),
      deliverables: touchedDeliverables,
      humanReviewRequired,
    };
  } catch (error) {
    if (isAgentToolApprovalRequiredError(error)) {
      addAgentTrace(
        db,
        agentRun.id,
        "run_paused",
        "Worker paused for approval",
        `${agentDefinition.name} paused because ${error.result?.tool?.name || error.toolId || "a worker tool"} needs your approval before live use.`,
        {
          approvalId: error.approvalId,
          invocationId: error.invocationId,
          toolId: error.toolId,
          workflowId: task.workflow_id,
          taskId: task.id,
        },
      );
      finishAgentRun(db, agentRun.id, {
        status: "waiting_approval",
        outputSummary: error.message,
        approvalRequired: true,
        evalStatus: "waiting_for_review",
        metadata: {
          taskKind: task.kind,
          taskTitle: task.title,
          workflowId: task.workflow_id,
          toolApproval: {
            approvalId: error.approvalId,
            invocationId: error.invocationId,
            toolId: error.toolId,
            status: error.result?.status,
            decision: error.result?.decision,
          },
          toolPolicy: {
            status: toolAccess.status,
            summary: toolAccess.summary,
            allowed: toolAccess.allowed.map((assignment) => assignment.tool_id),
            approvalRequired: toolAccess.approvalRequired.map((assignment) => assignment.tool_id),
            blocked: toolAccess.blocked.map((assignment) => assignment.tool_id),
          },
          toolGate: toolChecks.filter(Boolean),
        },
      });
      throw error;
    }

    recordAgentFailure(db, agentRun, agentDefinition, error, {
      taskKind: task.kind,
      workflowId: task.workflow_id,
    });
    throw error;
  }
}

function isAgentTaskKind(kind) {
  return Object.prototype.hasOwnProperty.call(AGENT_POLICIES, kind);
}

module.exports = {
  AGENT_POLICIES,
  isAgentTaskKind,
  runAgentTask,
};
