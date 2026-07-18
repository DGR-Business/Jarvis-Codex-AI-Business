const { all, fromJson, get, insertEvent, now, randomId, run, toJson } = require("../db");
const { bindAgentRunToAttempt, sha256 } = require("./agent-execution-evidence");

const OFFICIAL_AGENT_GUIDANCE = {
  basis: "OpenAI agent guidance: define narrow specialists, keep local runtime context separate from model context, use manager-controlled orchestration where useful, pause for human review on sensitive actions, inspect traces, and evaluate workflows.",
  sources: [
    "https://developers.openai.com/api/docs/guides/agents/define-agents",
    "https://developers.openai.com/api/docs/guides/agents/running-agents",
    "https://developers.openai.com/api/docs/guides/agents/orchestration",
    "https://developers.openai.com/api/docs/guides/agents/guardrails-approvals",
    "https://developers.openai.com/api/docs/guides/agents/integrations-observability",
    "https://developers.openai.com/api/docs/guides/agent-evals",
  ],
};

const HARD_STOPS = [
  "external publishing",
  "account creation or account changes",
  "paid tools or model spend outside an approved cap",
  "money movement",
  "legal, tax, compliance, IP, or platform-risk determinations",
  "customer disputes, refunds, or customer messages",
];

const FINAL_HANDOFF_STATUSES = new Set([
  "approved_for_next_step",
  "changes_requested",
  "declined",
  "resolved",
  "completed",
  "cancelled",
]);

const AI_TEAM_DEFINITIONS = [
  {
    id: "chief_of_staff",
    name: "Chief of Staff",
    role: "manager",
    mode: "protected",
    modelClass: "reasoning-high",
    aliases: ["orchestrator", "operator_pack", "approval-pack"],
    taskKinds: ["goal_planning", "operator_pack_qc", "handoff_followup"],
    instructions: "Own the operator-facing summary. Turn specialist work into money moves, evidence, risk, expected upside, and a clear approve, deny, or request-changes decision.",
    tools: ["runtime_state", "local_deliverables", "approval_pack"],
    guardrails: ["Keep the dashboard as source of truth.", "Do not hide uncertainty.", "Pause high-risk decisions for the operator."],
    handoffTargets: ["demand_validator", "finance_analyst", "quality_reviewer", "growth_analyst"],
    inputContract: {
      required: ["operator_instruction_or_workflow", "current_runtime_state", "specialist_outputs"],
      optional: ["scorecard", "approval_pack"],
    },
    outputContract: {
      required: ["money_move", "evidence_summary", "risk_summary", "next_decision"],
      format: "plain business language for the operator",
    },
    approvalPolicy: {
      canApprove: false,
      mustPauseFor: HARD_STOPS,
    },
    evalCriteria: ["clear decision", "evidence linked", "operator simplicity", "no hidden live action"],
  },
  {
    id: "opportunity_scout",
    name: "Opportunity Scout",
    role: "specialist",
    mode: "protected",
    modelClass: "research-high",
    aliases: ["scout"],
    taskKinds: ["opportunity_scan"],
    instructions: "Find buyer problems, visible demand, niche language, marketplace gaps, and underserved audiences before product building starts.",
    tools: ["runtime_state", "local_deliverables", "approved_research"],
    guardrails: ["Label unverified assumptions.", "Do not invent demand.", "Live web research requires readiness and approval."],
    handoffTargets: ["demand_validator", "offer_architect"],
    inputContract: { required: ["business_direction", "target_channel_or_market"] },
    outputContract: { required: ["buyer", "problem", "demand_signal", "evidence_gap", "recommended_next_test"] },
    approvalPolicy: { canApprove: false, mustPauseFor: ["live research spend", ...HARD_STOPS] },
    evalCriteria: ["buyer specificity", "demand evidence", "testability", "source honesty"],
  },
  {
    id: "demand_validator",
    name: "Demand Validator",
    role: "specialist",
    mode: "protected",
    modelClass: "research-high",
    aliases: ["researcher"],
    taskKinds: ["market_research", "live_market_research"],
    instructions: "Check whether people already search, buy, complain, review, or pay for similar outcomes. Separate protected planning assumptions from live evidence.",
    tools: ["runtime_state", "research_adapter", "local_deliverables"],
    guardrails: ["Capture sources.", "Warn on stale or protected-mode evidence.", "Do not treat unsourced claims as proof."],
    handoffTargets: ["offer_architect", "chief_of_staff"],
    inputContract: { required: ["buyer", "problem_or_offer", "channel", "evidence_standard"] },
    outputContract: { required: ["demand_verdict", "source_summary", "confidence", "kill_or_continue_signal"] },
    approvalPolicy: { canApprove: false, mustPauseFor: ["live research spend", ...HARD_STOPS] },
    evalCriteria: ["source count", "freshness warning", "confidence honesty", "commercial relevance"],
  },
  {
    id: "offer_architect",
    name: "Offer Architect",
    role: "specialist",
    mode: "protected",
    modelClass: "reasoning-medium",
    aliases: ["strategist"],
    taskKinds: ["offer_architecture", "commercial_brief"],
    instructions: "Turn evidence into a specific buyer, promise, product format, price, positioning, and buying trigger.",
    tools: ["runtime_state", "commercial_briefs", "scorecards"],
    guardrails: ["Every offer needs buyer, painful problem, price, channel, and risk.", "Do not build beyond the smallest useful test."],
    handoffTargets: ["copy_conversion_agent", "finance_analyst", "distribution_operator"],
    inputContract: { required: ["buyer", "problem", "evidence", "channel"] },
    outputContract: { required: ["offer", "price", "positioning", "promise", "objections", "test_hypothesis"] },
    approvalPolicy: { canApprove: false, mustPauseFor: HARD_STOPS },
    evalCriteria: ["buyer clarity", "promise clarity", "price logic", "test readiness"],
  },
  {
    id: "product_builder",
    name: "Product Builder",
    role: "specialist",
    mode: "protected",
    modelClass: "creative-vision",
    aliases: ["designer", "publisher"],
    taskKinds: ["product_action_plan", "mockup_direction", "publish_digital_product_dry_run", "publish_gelato_dry_run"],
    instructions: "Prepare the smallest sellable product asset, mockup direction, or publishing package needed for the next safe test.",
    tools: ["local_deliverables", "digital_product_adapter", "approval_pack", "image_generation_spend"],
    guardrails: ["Protected mode by default.", "No live upload, supplier order, or paid generation without approval.", "Keep product output tied to the test hypothesis."],
    handoffTargets: ["quality_reviewer", "chief_of_staff"],
    inputContract: { required: ["offer", "product_format", "quality_bar", "channel_requirements"] },
    outputContract: { required: ["asset_plan", "mockup_or_listing_draft", "quality_risks", "approval_needed"] },
    approvalPolicy: { canApprove: false, mustPauseFor: ["paid asset generation", "publishing", ...HARD_STOPS] },
    evalCriteria: ["smallest sellable asset", "channel fit", "approval safety", "quality risk visibility"],
  },
  {
    id: "copy_conversion_agent",
    name: "Copy and Conversion Agent",
    role: "specialist",
    mode: "protected",
    modelClass: "reasoning-medium",
    aliases: ["conversion_writer"],
    taskKinds: ["conversion_copy", "execution_pack_copy"],
    instructions: "Write titles, descriptions, landing copy, emails, outreach, thumbnails, and calls to action that make the buyer decision simple.",
    tools: ["runtime_state", "execution_packs", "local_deliverables"],
    guardrails: ["Avoid unsupported claims.", "Write in ordinary business language.", "Keep calls to action tied to a measurable test."],
    handoffTargets: ["distribution_operator", "quality_reviewer"],
    inputContract: { required: ["buyer", "problem", "offer", "channel", "desired_action"] },
    outputContract: { required: ["headline", "description", "cta", "message_variants", "tracking_note"] },
    approvalPolicy: { canApprove: false, mustPauseFor: ["customer messages", "publishing", ...HARD_STOPS] },
    evalCriteria: ["clarity", "specificity", "measurable CTA", "claim safety"],
  },
  {
    id: "distribution_operator",
    name: "Distribution Agent",
    role: "specialist",
    mode: "protected",
    modelClass: "reasoning-medium",
    aliases: ["distribution"],
    taskKinds: ["distribution_plan", "market_contact_run"],
    instructions: "Prepare manual channel tests across marketplace, search, owned audience, social, or partner routes without taking external action until approved.",
    tools: ["execution_packs", "results_ledger", "notification_outbox"],
    guardrails: ["No sending or posting without operator approval.", "Use tiny tests first.", "Define result fields before the run."],
    handoffTargets: ["growth_analyst", "chief_of_staff"],
    inputContract: { required: ["offer", "channel", "message", "tracking_plan"] },
    outputContract: { required: ["channel_steps", "evidence_to_capture", "success_metric", "kill_rule"] },
    approvalPolicy: { canApprove: false, mustPauseFor: ["external send", "publishing", "account action", ...HARD_STOPS] },
    evalCriteria: ["channel realism", "manual safety", "measurable outcome", "operator workload"],
  },
  {
    id: "finance_analyst",
    name: "Finance and Unit Economics Agent",
    role: "specialist",
    mode: "protected",
    modelClass: "reasoning-medium",
    aliases: ["analyst"],
    taskKinds: ["commercial_analysis", "finance_model"],
    instructions: "Track price, gross margin, cost, time, expected upside, break-even, and capital allocation before work scales.",
    tools: ["cost_ledger", "revenue_ledger", "scorecards"],
    guardrails: ["Use estimates until real data exists.", "Flag missing costs.", "No money movement."],
    handoffTargets: ["chief_of_staff", "growth_analyst"],
    inputContract: { required: ["price", "cost_assumptions", "channel", "time_required"] },
    outputContract: { required: ["margin_logic", "break_even", "cost_cap", "financial_risk", "decision_signal"] },
    approvalPolicy: { canApprove: false, mustPauseFor: ["paid spend", "money movement", ...HARD_STOPS] },
    evalCriteria: ["unit economics", "cost honesty", "break-even clarity", "spend safety"],
  },
  {
    id: "customer_voice_agent",
    name: "Customer Voice Agent",
    role: "specialist",
    mode: "protected",
    modelClass: "reasoning-medium",
    aliases: ["customer_voice"],
    taskKinds: ["feedback_analysis", "objection_analysis"],
    instructions: "Turn reviews, objections, replies, refunds, and comments into offer and product improvements.",
    tools: ["commercial_feedback", "commercial_results", "learning_cycles"],
    guardrails: ["Do not overfit one comment.", "Separate buyer words from interpretation.", "Escalate disputes or sensitive customer issues."],
    handoffTargets: ["offer_architect", "growth_analyst"],
    inputContract: { required: ["feedback", "result_context", "current_offer"] },
    outputContract: { required: ["buyer_language", "objections", "requested_improvements", "recommended_revision"] },
    approvalPolicy: { canApprove: false, mustPauseFor: ["customer replies", "refunds", "disputes", ...HARD_STOPS] },
    evalCriteria: ["uses actual feedback", "revision clarity", "dispute safety", "commercial usefulness"],
  },
  {
    id: "growth_analyst",
    name: "Growth Analyst",
    role: "specialist",
    mode: "protected",
    modelClass: "reasoning-high",
    aliases: ["growth"],
    taskKinds: ["result_analysis", "learning_cycle"],
    instructions: "Compare expected metrics with actual results and recommend continue, revise, pause, or kill.",
    tools: ["commercial_results", "commercial_feedback", "learning_cycles", "scorecards"],
    guardrails: ["Reality beats plan.", "Do not scale without evidence.", "Explain what changed and why."],
    handoffTargets: ["chief_of_staff"],
    inputContract: { required: ["hypothesis", "expected_metric", "actual_result", "feedback"] },
    outputContract: { required: ["verdict", "learning", "improvement", "next_action", "confidence"] },
    approvalPolicy: { canApprove: false, mustPauseFor: ["autopilot promotion", "increased spend", ...HARD_STOPS] },
    evalCriteria: ["metric comparison", "clear verdict", "improvement action", "evidence discipline"],
  },
  {
    id: "quality_reviewer",
    name: "Quality Reviewer",
    role: "specialist",
    mode: "protected",
    modelClass: "quality-review-high",
    aliases: ["quality-checker", "risk_reviewer"],
    taskKinds: ["risk_screen", "design_qc", "operator_pack_qc"],
    instructions: "Check evidence quality, claim safety, IP/platform risk, output completeness, and whether the operator can decide without digging.",
    tools: ["local_deliverables", "scorecards", "approval_pack", "visual_asset_review"],
    guardrails: ["Never provide legal/compliance determinations.", "Escalate platform, IP, and account-risk concerns.", "Prefer changes over risky approval."],
    handoffTargets: ["chief_of_staff"],
    inputContract: { required: ["deliverables", "evidence", "claims", "risk_context"] },
    outputContract: { required: ["quality_score", "risk_findings", "missing_evidence", "operator_recommendation"] },
    approvalPolicy: { canApprove: false, mustPauseFor: ["legal review", "IP risk", "platform risk", ...HARD_STOPS] },
    evalCriteria: ["risk detection", "evidence completeness", "operator readability", "review-control discipline"],
  },
];

function normalizeJson(value, fallback) {
  if (Array.isArray(value) || (value && typeof value === "object")) return value;
  return fallback;
}

function listValue(value) {
  return Array.isArray(value) ? value : [];
}

function textValue(value, fallback = "") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function usefulValue(value) {
  if (typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.length > 0;
  if (value && typeof value === "object") return Object.keys(value).length > 0;
  return Boolean(textValue(value));
}

function workerOutputContract(definition) {
  return definition.output_contract || definition.outputContract || {};
}

function workflowMetadata(workflow = {}) {
  return normalizeJson(workflow.metadata, {});
}

function contractFieldValue(field, task = {}, workflow = {}, output = {}) {
  const metadata = workflowMetadata(workflow);
  const payload = normalizeJson(task.payload, {});
  const details = normalizeJson(output.details, {});
  const priorDecision = normalizeJson(output.businessDecision, {});
  const priorLearning = normalizeJson(priorDecision.continuousImprovement, {});
  const subject = payload.subject || metadata.subject || workflow.title || "this opportunity";
  const buyer = payload.buyer || metadata.buyer || priorDecision.buyer || details.Buyer || "Buyer segment needs stronger evidence.";
  const problem = payload.problem || metadata.problem || priorDecision.problem || `The buyer needs a faster, simpler way to solve ${String(subject).toLowerCase()}.`;
  const offer = payload.offer || metadata.offer || priorDecision.offer || details.Promise || details["Core asset"] || output.moneyMove || output.summary;
  const channel = payload.channel || metadata.channel || priorDecision.channel || details.Channel || "Manual channel test";
  const evidenceSummary = listValue(output.evidence).join(" ");
  const riskSummary = listValue(output.risks).join("; ") || details["Do not build yet"] || "No specific risk finding captured.";
  const normalized = String(field || "").toLowerCase();
  const values = {
    asset_plan: details["Core asset"] || details["Must include"] || offer,
    approval_needed: output.nextAction || "Operator review is required before risky action.",
    break_even: details["Break-even"] || "Break-even needs real price, cost, conversion, refund, and time evidence.",
    buyer,
    buyer_language: details["Capture exactly"] || "Capture the buyer's exact words from the next signal.",
    channel_steps: details.Channel || output.nextAction || channel,
    confidence: output.confidence || "medium",
    cost_cap: `${Number(task.cost_budget_cents || 0)} cents`,
    cta: details.CTA || output.nextAction || "Ask for a clear buyer decision.",
    demand_signal: output.confidence?.includes("live") ? "Live evidence captured." : "Demand signal still needs live buyer evidence.",
    demand_verdict: output.verdict || output.confidence || "Evidence still developing.",
    decision_signal: output.nextAction || "Review the next safest commercial action.",
    description: details.Description || output.summary,
    evidence_gap: evidenceSummary || "Evidence gap not captured.",
    evidence_summary: evidenceSummary || "No evidence summary captured.",
    evidence_to_capture: details.Track || "Views, clicks, replies, leads, sales, objections, refunds, spend, and time.",
    financial_risk: details["Do not build yet"] || output.costRisk || "Do not spend before buyer and margin evidence improve.",
    headline: details.Headline || output.heading,
    improvement: priorLearning.improvement || "Improve the offer, channel, proof, or stop rule after the next measured result.",
    kill_or_continue_signal: output.verdict || output.nextAction || "Continue only after evidence improves.",
    kill_rule: details["Stop rule"] || "Stop or revise if the test produces exposure but no useful buyer action.",
    learning: priorLearning.learning || "No real-world result has been recorded yet; learn from the next operator decision or buyer signal.",
    margin_logic: details["Cost/risk"] || "Margin must be checked against price, tool spend, refunds, and time.",
    message_variants: details["Message variant"] || details.CTA || output.nextAction,
    missing_evidence: output.confidence?.includes("low") ? "Live demand, pricing, or buyer signal is still weak." : "No major missing evidence flagged by this worker.",
    mockup_or_listing_draft: details["Core asset"] || details.Format || offer,
    money_move: priorDecision.moneyMove || output.moneyMove || output.commercialNextAction?.title || output.nextAction || "Choose the next smallest commercial move.",
    next_action: output.nextAction,
    next_decision: output.operatorDecision || output.verdict || "Decide whether to approve, request changes, deny, or gather more evidence.",
    objections: details["Primary objection"] || details["Ask buyers"] || "Buyer objections still need to be captured.",
    operator_recommendation: output.nextAction || output.summary,
    offer,
    positioning: details["Buying trigger"] || "Position around a practical shortcut and measurable buyer outcome.",
    price: metadata.price || details.Price || (workflow.expected_profit_cents ? `${workflow.expected_profit_cents} cents expected profit signal` : "Price needs validation."),
    problem,
    promise: details.Promise || offer,
    quality_risks: details["Do not build yet"] || "Quality risk must stay visible before review.",
    quality_score: output.qualityScore || details["Quality score"] || "Quality score needs review evidence.",
    recommended_next_test: output.nextAction || "Prepare the next measured test.",
    recommended_revision: output.nextAction || "Revise from buyer evidence before scaling.",
    requested_improvements: details.Request || details["Requested improvements"] || output.nextAction || "Use the next buyer signal to decide the improvement.",
    risk_findings: riskSummary,
    risk_summary: riskSummary,
    source_summary: evidenceSummary || "No source summary captured.",
    success_metric: priorDecision.successMetric || details.Track || "A measurable buyer signal is recorded.",
    test_hypothesis: priorLearning.hypothesis || `A small test can prove whether ${buyer} wants ${offer}.`,
    tracking_note: details.Track || "Track views, clicks, replies, leads, sales, refunds, spend, time, and objections.",
    verdict: output.operatorDecision || output.verdict || "needs_evidence",
  };
  return textValue(values[normalized], output.nextAction || output.summary || "Captured by worker output.");
}

function buildContractOutput(task, workflow, output, definition) {
  const contract = workerOutputContract(definition);
  const required = listValue(contract.required);
  return Object.fromEntries(required.map((field) => [field, contractFieldValue(field, task, workflow, output)]));
}

function buildBusinessDecision(task = {}, workflow = {}, output = {}, definition = {}, options = {}) {
  const metadata = workflowMetadata(workflow);
  const payload = normalizeJson(task.payload, {});
  const details = normalizeJson(output.details, {});
  const priorDecision = normalizeJson(output.businessDecision, {});
  const priorLearning = normalizeJson(priorDecision.continuousImprovement, {});
  const subject = payload.subject || metadata.subject || workflow.title || "this opportunity";
  const buyer = payload.buyer || metadata.buyer || priorDecision.buyer || details.Buyer || "Buyer segment needs stronger evidence.";
  const problem = payload.problem || metadata.problem || priorDecision.problem || `The buyer needs a clearer, faster way to solve ${String(subject).toLowerCase()}.`;
  const offer = payload.offer || metadata.offer || priorDecision.offer || details.Promise || details["Core asset"] || output.moneyMove || output.summary;
  const channel = payload.channel || metadata.channel || priorDecision.channel || details.Channel || "Manual channel test";
  const evidence = listValue(output.evidence);
  const costCapCents = Math.max(0, Number(task.cost_budget_cents || options.policy?.maxCostCents || options.costCapCents || 0));
  const approvalRequired = Boolean(options.humanReviewRequired || options.approvalRequired || task.approval_id || options.spendApproval?.required);
  const risk = output.risks?.length || String(task.kind || "").includes("risk") || approvalRequired ? "medium" : "low";
  const successMetric = priorDecision.successMetric || details.Track
    || output.commercialNextAction?.successMetric
    || "A measurable buyer signal, decision, evidence result, cost, or risk change is recorded.";
  const killCriteria = priorDecision.killCriteria || details["Stop rule"]
    || output.commercialNextAction?.killCriteria
    || "Stop or request changes if buyer, offer, channel, metric, economics, or risk is unclear.";
  const moneyMove = priorDecision.moneyMove || output.moneyMove || output.commercialNextAction?.title || output.nextAction || "Choose the next smallest commercial move.";

  return {
    schema: "jarvis_worker_business_decision_v1",
    workerId: definition.id || task.agent || "ai_worker",
    workerName: definition.name || task.agent || "AI worker",
    taskKind: task.kind || "protected_worker_outcome",
    buyer,
    problem,
    offer,
    channel,
    moneyMove,
    evidenceSummary: evidence.slice(0, 3).join(" ") || "No evidence captured yet.",
    risk,
    expectedUpsideCents: Math.max(0, Number(workflow.expected_profit_cents || output.commercialNextAction?.expectedUpsideCents || 0)),
    costCapCents,
    nextAction: output.nextAction || moneyMove,
    successMetric,
    killCriteria,
    approvalRequired,
    externalActionsAllowed: false,
    hardStops: HARD_STOPS,
    continuousImprovement: {
      hypothesis: priorLearning.hypothesis || output.commercialNextAction?.hypothesis || `If ${buyer} has this problem, a small protected action can test whether ${offer} deserves more work.`,
      smallestUsefulAction: priorLearning.smallestUsefulAction || output.commercialNextAction?.action || output.nextAction || "Choose the next protected action.",
      expectedMetric: priorLearning.expectedMetric || successMetric,
      actualResult: priorLearning.actualResult || (output.liveEvidence ? "Live evidence was captured for this worker output." : "No real-world commercial result has been recorded from this worker output yet."),
      learning: priorLearning.learning || "Use the next recorded result or operator decision to improve the offer, channel, spend gate, or stop rule.",
      improvement: priorLearning.improvement || output.commercialNextAction?.learningSignal || "Scale, revise, pause, or kill based on the next measured result.",
    },
  };
}

function attachWorkerDecisionContract(task, workflow, output, definition, options = {}) {
  const contract = workerOutputContract(definition);
  const contractOutput = buildContractOutput(task, workflow, output, definition);
  const missing = listValue(contract.required).filter((field) => !usefulValue(contractOutput[field]));
  output.contractOutput = contractOutput;
  output.outputContract = {
    schema: "jarvis_worker_contract_v1",
    required: listValue(contract.required),
    satisfied: Object.keys(contractOutput).filter((field) => usefulValue(contractOutput[field])),
    missing,
    format: contract.format || "structured business output",
  };
  output.businessDecision = {
    ...buildBusinessDecision(task, workflow, output, definition, options),
    contractOutput,
  };
  return output;
}

function workerDecisionMetadata(output = {}) {
  const decision = output.businessDecision;
  if (!decision) return null;
  return {
    schema: decision.schema,
    workerId: decision.workerId,
    workerName: decision.workerName,
    buyer: decision.buyer,
    problem: decision.problem,
    offer: decision.offer,
    channel: decision.channel,
    moneyMove: decision.moneyMove,
    evidenceSummary: decision.evidenceSummary,
    nextAction: decision.nextAction,
    successMetric: decision.successMetric,
    killCriteria: decision.killCriteria,
    risk: decision.risk,
    expectedUpsideCents: Number(decision.expectedUpsideCents || 0),
    costCapCents: Number(decision.costCapCents || 0),
    approvalRequired: Boolean(decision.approvalRequired),
    externalActionsAllowed: decision.externalActionsAllowed === true,
    contractSatisfied: output.outputContract?.missing?.length === 0,
    missingContractFields: listValue(output.outputContract?.missing),
  };
}

function ensureAiTeam(db) {
  const ts = now();
  for (const definition of AI_TEAM_DEFINITIONS) {
    run(
      db,
      `INSERT INTO agent_definitions
        (id, name, role, status, mode, model_class, instructions, tools, guardrails,
         handoff_targets, input_contract, output_contract, approval_policy, eval_criteria,
         metadata, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         role = excluded.role,
         status = excluded.status,
         mode = excluded.mode,
         model_class = excluded.model_class,
         instructions = excluded.instructions,
         tools = excluded.tools,
         guardrails = excluded.guardrails,
         handoff_targets = excluded.handoff_targets,
         input_contract = excluded.input_contract,
         output_contract = excluded.output_contract,
         approval_policy = excluded.approval_policy,
         eval_criteria = excluded.eval_criteria,
         metadata = excluded.metadata,
         updated_at = excluded.updated_at`,
      [
        definition.id,
        definition.name,
        definition.role,
        "ready",
        definition.mode,
        definition.modelClass,
        definition.instructions,
        toJson(definition.tools),
        toJson(definition.guardrails),
        toJson(definition.handoffTargets),
        toJson(definition.inputContract),
        toJson(definition.outputContract),
        toJson(definition.approvalPolicy),
        toJson(definition.evalCriteria),
        toJson({
          aliases: definition.aliases,
          taskKinds: definition.taskKinds,
          officialGuidance: OFFICIAL_AGENT_GUIDANCE,
        }),
        ts,
        ts,
      ],
    );
  }
}

function parseDefinition(row) {
  if (!row) return null;
  return {
    ...row,
    tools: fromJson(row.tools, []),
    guardrails: fromJson(row.guardrails, []),
    handoff_targets: fromJson(row.handoff_targets, []),
    input_contract: fromJson(row.input_contract, {}),
    output_contract: fromJson(row.output_contract, {}),
    approval_policy: fromJson(row.approval_policy, {}),
    eval_criteria: fromJson(row.eval_criteria, []),
    metadata: fromJson(row.metadata, {}),
  };
}

function listAgentDefinitions(db) {
  ensureAiTeam(db);
  return all(db, "SELECT * FROM agent_definitions ORDER BY CASE role WHEN 'manager' THEN 0 ELSE 1 END, name ASC").map(parseDefinition);
}

function findAgentDefinition(db, task = {}) {
  ensureAiTeam(db);
  const definitions = listAgentDefinitions(db);
  const kind = String(task.kind || "").toLowerCase();
  const agent = String(task.agent || "").toLowerCase();
  const requestedWorker = String(task.payload?.requestedWorker || task.payload?.worker || "").toLowerCase();
  return definitions.find((definition) => [agent, requestedWorker].includes(String(definition.id || "").toLowerCase()))
    || definitions.find((definition) => [agent, requestedWorker].some((key) => key && (definition.metadata.aliases || []).includes(key)))
    || definitions.find((definition) => (definition.metadata.aliases || []).includes(agent))
    || definitions.find((definition) => (definition.metadata.taskKinds || []).includes(kind))
    || definitions.find((definition) => definition.id === "chief_of_staff");
}

function createAgentRun(db, definition, task, options = {}) {
  const runId = `agent_run_${randomId()}`;
  const ts = now();
  run(
    db,
    `INSERT INTO agent_runs
      (id, agent_id, workflow_id, task_id, venture_id, mode, status, input_summary,
       approval_required, metadata, started_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      runId,
      definition.id,
      task.workflow_id || null,
      task.id || null,
      task.venture_id || null,
      options.mode || "dry-run",
      "running",
      options.inputSummary || task.title || "",
      options.approvalRequired ? 1 : 0,
       toJson({
         taskKind: task.kind || null,
         taskAgent: task.agent || null,
         taskAttemptId: options.attemptId || null,
         modelClass: definition.model_class,
         officialGuidance: OFFICIAL_AGENT_GUIDANCE,
       }),
      ts,
    ],
  );
  if (options.attemptId) bindAgentRunToAttempt(db, options.attemptId, runId);
  addAgentTrace(db, runId, "run_started", "Worker started", `${definition.name} started ${task.title || "a task"}.`, {
    workflowId: task.workflow_id || null,
    taskId: task.id || null,
    taskAttemptId: options.attemptId || null,
  });
  return { id: runId, agentId: definition.id, startedAt: ts, attemptId: options.attemptId || null };
}

function nextTraceSequence(db, runId) {
  const row = get(db, "SELECT COALESCE(MAX(sequence), 0) + 1 AS next FROM agent_trace_events WHERE run_id = ?", [runId]);
  return row?.next || 1;
}

function addAgentTrace(db, runId, type, title, detail, metadata = {}) {
  run(
    db,
    `INSERT INTO agent_trace_events (id, run_id, sequence, type, title, detail, metadata, ts)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [`agent_trace_${randomId()}`, runId, nextTraceSequence(db, runId), type, title, detail || "", toJson(metadata), now()],
  );
}

function evaluateAgentOutput(db, definition, runRecord, task, output, context = {}) {
  const attemptId = context.attemptId || null;
  if (attemptId) bindAgentRunToAttempt(db, attemptId, runRecord.id);
  const criteria = normalizeJson(definition.eval_criteria, []);
  const findings = [];
  let score = 100;

  if (!output?.summary) {
    findings.push("Missing a plain-language summary.");
    score -= 25;
  }
  if (!Array.isArray(output?.evidence) || output.evidence.length === 0) {
    findings.push("Missing evidence or checks.");
    score -= 25;
  }
  if (!output?.nextAction) {
    findings.push("Missing next action.");
    score -= 20;
  }
  if (context.requiresApproval && !output?.nextAction) {
    findings.push("Approval-sensitive work did not state the next gate.");
    score -= 20;
  }
  if (context.research?.mode === "dry-run" && output?.confidence && !String(output.confidence).includes("blocked")) {
    findings.push("Dry-run research confidence should stay clearly qualified.");
    score -= 10;
  }
  if (definition.id === "demand_validator" && context.research?.mode === "live") {
    const groundedSources = (context.research.sources || []).filter((source) => /^https?:\/\//i.test(source?.url || ""));
    if (groundedSources.length === 0) {
      findings.push("Live demand research returned no provider-grounded source URLs.");
      score -= 35;
    }
    if (context.research.status && context.research.status !== "completed_live") {
      findings.push("Live demand research did not complete with grounded evidence.");
      score -= 20;
    }
  }

  const requiredBusinessDecisionFields = [
    "schema",
    "workerId",
    "workerName",
    "taskKind",
    "buyer",
    "problem",
    "offer",
    "channel",
    "moneyMove",
    "evidenceSummary",
    "risk",
    "nextAction",
    "successMetric",
    "killCriteria",
  ];
  const requiredLearningFields = ["hypothesis", "smallestUsefulAction", "expectedMetric", "actualResult", "learning", "improvement"];
  const decision = output?.businessDecision;
  const missingBusinessDecisionFields = [];
  if (!decision || typeof decision !== "object") {
    findings.push("Missing worker business decision contract.");
    score -= 30;
  } else {
    for (const field of requiredBusinessDecisionFields) {
      if (!usefulValue(decision[field])) missingBusinessDecisionFields.push(field);
    }
    for (const field of requiredLearningFields) {
      if (!usefulValue(decision.continuousImprovement?.[field])) {
        missingBusinessDecisionFields.push(`continuousImprovement.${field}`);
      }
    }
    if (decision.schema !== "jarvis_worker_business_decision_v1") {
      missingBusinessDecisionFields.push("schema");
    }
    if (typeof decision.approvalRequired !== "boolean") {
      missingBusinessDecisionFields.push("approvalRequired");
    }
    if (context.requiresApproval && decision.approvalRequired !== true) {
      findings.push("Approval-sensitive work did not mark the operator review requirement.");
      score -= 15;
    }
    if (decision.externalActionsAllowed !== false) {
      findings.push("Worker output must keep external actions locked.");
      score -= 20;
    }
    if (!Array.isArray(decision.hardStops) || decision.hardStops.length === 0) {
      missingBusinessDecisionFields.push("hardStops");
    }
    if (missingBusinessDecisionFields.length) {
      findings.push(`Business decision is missing: ${missingBusinessDecisionFields.join(", ")}.`);
      score -= Math.min(30, missingBusinessDecisionFields.length * 4);
    }
  }

  const contract = workerOutputContract(definition);
  const requiredOutputFields = listValue(contract.required);
  const contractOutput = output?.contractOutput || output?.businessDecision?.contractOutput || {};
  const missingContractFields = [
    ...new Set([
      ...listValue(output?.outputContract?.missing),
      ...requiredOutputFields.filter((field) => !usefulValue(contractOutput[field])),
    ]),
  ];
  if (requiredOutputFields.length && output?.outputContract?.schema !== "jarvis_worker_contract_v1") {
    findings.push("Missing worker output contract record.");
    score -= 20;
  }
  if (missingContractFields.length) {
    findings.push(`Worker output contract is missing: ${missingContractFields.join(", ")}.`);
    score -= Math.min(25, missingContractFields.length * 5);
  }

  const finalScore = Math.max(0, Math.min(100, score));
  const status = finalScore >= 80 ? "passed" : finalScore >= 60 ? "needs_review" : "failed";
  const evalId = `agent_eval_${randomId()}`;

  run(
    db,
    `INSERT INTO agent_eval_results
      (id, run_id, agent_id, task_id, attempt_id, status, score, criteria, findings, metadata,
       evaluator_version, subject_hash, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      evalId,
      runRecord.id,
      definition.id,
      task.id || null,
      attemptId,
      status,
      finalScore,
      toJson(criteria),
      toJson(findings),
      toJson({
        outputHeading: output?.heading || null,
        requiresApproval: Boolean(context.requiresApproval),
        researchMode: context.research?.mode || null,
        deliverablesTouched: context.deliverables || [],
        businessDecisionSchema: decision?.schema || null,
        missingBusinessDecisionFields,
        missingContractFields,
      }),
      "local-structural-v2",
      sha256(output || {}),
      now(),
    ],
  );
  addAgentTrace(db, runRecord.id, "eval_completed", "Worker output checked", `${definition.name} evaluation ${status} with score ${finalScore}/100.`, {
    evalId,
    findings,
  });
  return { id: evalId, attemptId, status, score: finalScore, findings, criteria };
}

function recordTerminalAgentEvaluation(db, definition, runRecord, task, input = {}) {
  const attemptId = input.attemptId || null;
  if (attemptId) bindAgentRunToAttempt(db, attemptId, runRecord.id);
  const existing = attemptId
    ? get(db, "SELECT * FROM agent_eval_results WHERE attempt_id = ? ORDER BY created_at DESC, id DESC LIMIT 1", [attemptId])
    : null;
  if (existing) {
    return {
      ...existing,
      criteria: fromJson(existing.criteria, []),
      findings: fromJson(existing.findings, []),
      metadata: fromJson(existing.metadata, {}),
      existing: true,
    };
  }

  const outcomeUnknown = input.outcomeUnknown === true || input.outcomeStatus === "unknown";
  const status = outcomeUnknown ? "unknown" : "not_evaluable";
  const findings = [outcomeUnknown
    ? "Provider outcome is unknown, so deterministic output evaluation cannot be completed."
    : "No accepted terminal output was available for deterministic evaluation."];
  if (input.error) findings.push(String(input.error));
  const evalId = `agent_eval_${randomId()}`;
  const createdAt = now();
  const metadata = {
    terminal: true,
    evaluable: false,
    scoreKnown: false,
    numericScoreCompatibility: 0,
    providerOutcome: outcomeUnknown ? "unknown" : (input.outcomeStatus || "failed"),
    errorKind: input.errorKind || null,
    providerRequestId: input.providerRequestId || null,
    providerCallOccurred: input.providerCallOccurred === true,
    noAutomaticRetry: input.providerCallOccurred === true || outcomeUnknown,
  };
  run(
    db,
    `INSERT INTO agent_eval_results
      (id, run_id, agent_id, task_id, attempt_id, status, score, criteria, findings, metadata,
       evaluator_version, subject_hash, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 0, '[]', ?, ?, 'local-terminal-outcome-v1', ?, ?)`,
    [
      evalId,
      runRecord.id,
      definition.id,
      task.id || null,
      attemptId,
      status,
      toJson(findings),
      toJson(metadata),
      sha256({
        attemptId,
        runId: runRecord.id,
        status,
        outcomeStatus: input.outcomeStatus || null,
        errorKind: input.errorKind || null,
        providerRequestId: input.providerRequestId || null,
      }),
      createdAt,
    ],
  );
  addAgentTrace(
    db,
    runRecord.id,
    outcomeUnknown ? "eval_unknown" : "eval_not_evaluable",
    outcomeUnknown ? "Evaluation outcome unknown" : "Output not evaluable",
    findings[0],
    { evalId, attemptId, ...metadata },
  );
  return { id: evalId, attemptId, status, score: null, findings, criteria: [], metadata };
}

function finishAgentRun(db, runId, payload) {
  const completedAt = now();
  const currentRun = get(db, "SELECT * FROM agent_runs WHERE id = ?", [runId]);
  const status = payload.status || "completed";
  run(
    db,
    `UPDATE agent_runs
     SET status = ?, output_summary = ?, model_call_id = ?, estimated_cost_cents = ?,
         actual_cost_cents = ?, approval_required = ?, handoff_to = ?, eval_status = ?,
         metadata = ?, completed_at = ?
     WHERE id = ?`,
    [
      status,
      payload.outputSummary || "",
      payload.modelCallId || null,
      Number(payload.estimatedCostCents || 0),
      Number(payload.actualCostCents || 0),
      payload.approvalRequired ? 1 : 0,
      payload.handoffTo || null,
      payload.evalStatus || "not_evaluated",
      toJson(payload.metadata || {}),
      completedAt,
      runId,
    ],
  );
  const traceType = status === "failed"
    ? "run_failed"
    : status === "waiting_approval"
      ? "run_paused"
      : "run_completed";
  const traceTitle = status === "failed"
    ? "Worker failed"
    : status === "waiting_approval"
      ? "Worker paused"
      : "Worker completed";
  addAgentTrace(db, runId, traceType, traceTitle, payload.outputSummary || "", payload.metadata || {});
  if (payload.handoffTo && !["failed", "waiting_approval"].includes(status)) {
    recordAgentHandoff(db, currentRun, payload);
  }
  return { completedAt };
}

function handoffStatus(payload) {
  if (payload.handoffStatus) return payload.handoffStatus;
  if (payload.approvalRequired) return "needs_operator_decision";
  return "ready_for_next_worker";
}

function handoffRisk(payload, sourceRun) {
  if (payload.handoffRiskLevel) return payload.handoffRiskLevel;
  const metadata = payload.metadata || {};
  const taskKind = String(metadata.taskKind || sourceRun?.metadata?.taskKind || "").toLowerCase();
  const businessRisk = String(metadata.businessDecision?.risk || "").toLowerCase();
  if (["high", "medium", "low"].includes(businessRisk)) return businessRisk;
  if (taskKind.includes("risk")) return "high";
  if (taskKind.includes("live")) return "medium";
  if (payload.approvalRequired) return "medium";
  return "low";
}

function handoffDecisionNeeded(payload, sourceRun) {
  if (payload.handoffDecisionNeeded) return payload.handoffDecisionNeeded;
  const metadata = payload.metadata || {};
  const taskKind = String(metadata.taskKind || sourceRun?.metadata?.taskKind || "").toLowerCase();
  if (taskKind === "live_ai_worker_execution") return "Decide whether Jarvis should prepare the recommended next step.";
  if (taskKind === "live_market_research") return "Decide whether this evidence is strong enough to continue.";
  if (taskKind === "operator_pack_qc") return "Decide whether this review is ready to use.";
  if (taskKind === "risk_screen") return "Decide how Jarvis should respond to the identified risks.";
  return "Choose what Jarvis should do with this result.";
}

function recordAgentHandoff(db, sourceRun, payload) {
  if (!sourceRun || !payload?.handoffTo) return null;
  const sourceMetadata = fromJson(sourceRun.metadata, {});
  const mergedMetadata = {
    ...sourceMetadata,
    ...(payload.metadata || {}),
    officialGuidance: OFFICIAL_AGENT_GUIDANCE,
  };
  const ts = now();
  const status = handoffStatus(payload);
  const summary = payload.outputSummary || "Worker finished and handed the work to the next owner.";
  const decisionNeeded = handoffDecisionNeeded(payload, { ...sourceRun, metadata: sourceMetadata });
  const riskLevel = handoffRisk(payload, { ...sourceRun, metadata: sourceMetadata });
  const existing = get(
    db,
    "SELECT * FROM agent_handoffs WHERE from_run_id = ? AND to_agent_id = ? LIMIT 1",
    [sourceRun.id, payload.handoffTo],
  );

  if (existing) {
    run(
      db,
      `UPDATE agent_handoffs
       SET status = ?, reason = ?, summary = ?, decision_needed = ?, risk_level = ?,
           approval_required = ?, metadata = ?, updated_at = ?
       WHERE id = ?`,
      [
        status,
        payload.handoffReason || "Worker output needs the next owner to review and steer the work.",
        summary,
        decisionNeeded,
        riskLevel,
        payload.approvalRequired ? 1 : 0,
        toJson(mergedMetadata),
        ts,
        existing.id,
      ],
    );
    addAgentTrace(db, sourceRun.id, "handoff_updated", "Handoff updated", `${humanAgentName(sourceRun.agent_id)} updated the handoff to ${humanAgentName(payload.handoffTo)}.`, {
      handoffId: existing.id,
      toAgentId: payload.handoffTo,
      status,
    });
    return { id: existing.id, status };
  }

  const handoffId = `agent_handoff_${randomId()}`;
  run(
    db,
    `INSERT INTO agent_handoffs
      (id, workflow_id, task_id, from_run_id, from_agent_id, to_agent_id, status,
       reason, summary, decision_needed, risk_level, approval_required, metadata,
       created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      handoffId,
      sourceRun.workflow_id || null,
      sourceRun.task_id || null,
      sourceRun.id,
      sourceRun.agent_id,
      payload.handoffTo,
      status,
      payload.handoffReason || "Worker output needs the next owner to review and steer the work.",
      summary,
      decisionNeeded,
      riskLevel,
      payload.approvalRequired ? 1 : 0,
      toJson(mergedMetadata),
      ts,
      ts,
    ],
  );
  addAgentTrace(db, sourceRun.id, "handoff_recorded", "Handoff queued", `${humanAgentName(sourceRun.agent_id)} handed work to ${humanAgentName(payload.handoffTo)}.`, {
    handoffId,
    toAgentId: payload.handoffTo,
    status,
  });
  insertEvent(db, {
    actor: sourceRun.agent_id,
    type: "agent.handoff_created",
    entityType: "agent_handoff",
    entityId: handoffId,
    message: `${humanAgentName(sourceRun.agent_id)} handed work to ${humanAgentName(payload.handoffTo)}.`,
    metadata: { workflowId: sourceRun.workflow_id || null, taskId: sourceRun.task_id || null, status },
  });
  return { id: handoffId, status };
}

function humanAgentName(agentId) {
  return AI_TEAM_DEFINITIONS.find((definition) => definition.id === agentId)?.name
    || String(agentId || "AI worker").replace(/[_-]+/g, " ");
}

function recordAgentFailure(db, runRecord, definition, error, metadata = {}) {
  if (!runRecord?.id) return null;
  const evalStatus = metadata.evaluation?.status
    || (error.outcomeUnknown === true ? "unknown" : "not_evaluable");
  finishAgentRun(db, runRecord.id, {
    status: "failed",
    outputSummary: error.message,
    evalStatus,
    metadata: { error: error.message, ...metadata },
  });
  insertEvent(db, {
    level: "error",
    actor: definition?.id || "ai_team",
    type: "agent.run_failed",
    entityType: "agent_run",
    entityId: runRecord.id,
    message: `${definition?.name || "AI worker"} failed: ${error.message}`,
  });
  return runRecord.id;
}

function recordProtectedWorkerOutcome(db, taskLike = {}, output = {}, options = {}) {
  ensureAiTeam(db);
  const definition = findAgentDefinition(db, taskLike);
  const runRecord = createAgentRun(db, definition, taskLike, {
    mode: options.mode || "dry-run",
    inputSummary: options.inputSummary || taskLike.title || output.heading || "Protected worker outcome",
    approvalRequired: Boolean(options.approvalRequired),
    attemptId: options.attemptId || null,
  });
  addAgentTrace(
    db,
    runRecord.id,
    "guardrails_checked",
    "Guardrails checked",
    options.guardrailDetail || "Protected worker outcome stayed inside dry-run controls with no external action.",
    options.guardrailMetadata || {},
  );
  if (options.trace) {
    for (const trace of options.trace) {
      addAgentTrace(db, runRecord.id, trace.type, trace.title, trace.detail, trace.metadata || {});
    }
  }
  attachWorkerDecisionContract(taskLike, options.workflow || {}, output, definition, {
    approvalRequired: Boolean(options.approvalRequired),
    costCapCents: Number(options.estimatedCostCents || 0),
  });
  addAgentTrace(
    db,
    runRecord.id,
    "contract_checked",
    "Business decision ready",
    `${definition.name} produced a buyer, offer, evidence, risk, next action, and learning check for operator review.`,
    {
      contract: output.outputContract,
      businessDecision: workerDecisionMetadata(output),
    },
  );
  const evalResult = evaluateAgentOutput(db, definition, runRecord, taskLike, output, {
    attemptId: options.attemptId || null,
    requiresApproval: Boolean(options.approvalRequired),
    research: options.research || null,
    deliverables: options.deliverables || [],
  });
  finishAgentRun(db, runRecord.id, {
    status: options.status || "completed",
    outputSummary: output.summary || output.heading || "",
    modelCallId: options.modelCallId || null,
    estimatedCostCents: Number(options.estimatedCostCents || 0),
    actualCostCents: Number(options.actualCostCents || 0),
    approvalRequired: Boolean(options.approvalRequired),
    handoffTo: options.handoffTo || null,
    handoffReason: options.handoffReason || null,
    handoffDecisionNeeded: options.handoffDecisionNeeded || null,
    handoffRiskLevel: options.handoffRiskLevel || null,
    evalStatus: evalResult.status,
    metadata: {
      taskKind: taskLike.kind || null,
      taskTitle: taskLike.title || null,
      outputHeading: output.heading || null,
      evalId: evalResult.id,
      evalScore: evalResult.score,
      businessDecision: workerDecisionMetadata(output),
      outputContract: output.outputContract,
      ...(options.metadata || {}),
    },
  });
  return {
    agentId: definition.id,
    agentName: definition.name,
    runId: runRecord.id,
    evalId: evalResult.id,
    evalStatus: evalResult.status,
    evalScore: evalResult.score,
  };
}

function parseHandoff(row) {
  return row ? { ...row, metadata: fromJson(row.metadata, {}) } : null;
}

function handoffSelectSql(whereClause = "") {
  return `SELECT agent_handoffs.*,
       from_definitions.name AS from_agent_name,
       to_definitions.name AS to_agent_name,
       workflows.title AS workflow_title,
       tasks.title AS task_title
     FROM agent_handoffs
     LEFT JOIN agent_definitions AS from_definitions ON from_definitions.id = agent_handoffs.from_agent_id
     LEFT JOIN agent_definitions AS to_definitions ON to_definitions.id = agent_handoffs.to_agent_id
     LEFT JOIN workflows ON workflows.id = agent_handoffs.workflow_id
     LEFT JOIN tasks ON tasks.id = agent_handoffs.task_id
     ${whereClause}`;
}

function getAgentHandoff(db, handoffId) {
  return parseHandoff(get(db, `${handoffSelectSql("WHERE agent_handoffs.id = ?")} LIMIT 1`, [handoffId]));
}

function normalizeHandoffDecision(decision) {
  const key = String(decision || "").toLowerCase();
  return {
    approve: "approve",
    approved: "approve",
    changes: "changes",
    request_changes: "changes",
    needs_changes: "changes",
    revise: "changes",
    reject: "reject",
    rejected: "reject",
    deny: "reject",
    denied: "reject",
  }[key] || null;
}

function handoffDecisionStatus(decision) {
  return {
    approve: "approved_for_next_step",
    changes: "changes_requested",
    reject: "declined",
  }[decision];
}

function handoffDecisionMessage(decision, handoff) {
  const route = `${humanAgentName(handoff.from_agent_id)} to ${humanAgentName(handoff.to_agent_id)}`;
  if (decision === "approve") return `Handoff approved: ${route}.`;
  if (decision === "changes") return `Changes requested on handoff: ${route}.`;
  return `Handoff declined: ${route}.`;
}

function followupTaskIdForHandoff(handoffId) {
  const suffix = String(handoffId || randomId()).replace(/^agent_handoff_/, "").replace(/[^a-zA-Z0-9]+/g, "_").slice(0, 36);
  return `task_handoff_followup_${suffix || randomId().slice(0, 8)}`;
}

function nextTaskPriority(db, workflowId) {
  const row = get(db, "SELECT COALESCE(MAX(priority), 0) + 1 AS priority FROM tasks WHERE workflow_id = ?", [workflowId]);
  return row?.priority || 1;
}

function createHandoffFollowupTask(db, handoff, note, ts) {
  if (!handoff.workflow_id) return null;
  const taskId = followupTaskIdForHandoff(handoff.id);
  const existing = get(db, "SELECT * FROM tasks WHERE id = ?", [taskId]);
  if (existing) return existing;

  const payload = {
    handoffId: handoff.id,
    sourceRunId: handoff.from_run_id,
    sourceTaskId: handoff.task_id || null,
    fromAgentId: handoff.from_agent_id,
    toAgentId: handoff.to_agent_id,
    workflowTitle: handoff.workflow_title || null,
    taskTitle: handoff.task_title || null,
    handoffSummary: handoff.summary || "",
    decisionNeeded: handoff.decision_needed || "",
    riskLevel: handoff.risk_level || "medium",
    operatorDecision: "approve",
    operatorNote: note || "",
    sourceBusinessDecision: handoff.metadata?.businessDecision || null,
  };
  run(
    db,
    `INSERT INTO tasks
      (id, workflow_id, title, kind, agent, status, priority, max_retries, cost_budget_cents, payload, result, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      taskId,
      handoff.workflow_id,
      "Chief of Staff handoff follow-up",
      "handoff_followup",
      handoff.to_agent_id || "chief_of_staff",
      "queued",
      nextTaskPriority(db, handoff.workflow_id),
      2,
      20,
      toJson(payload),
      toJson({ waitingFor: "chief_of_staff_followup", handoffId: handoff.id }),
      ts,
      ts,
    ],
  );
  run(
    db,
    `UPDATE workflows
     SET status = 'agent_running', current_step = 'chief of staff follow-up queued', approval_required = 0, updated_at = ?
     WHERE id = ?`,
    [ts, handoff.workflow_id],
  );
  run(
    db,
    `INSERT INTO messages (id, task_id, severity, status, subject, body, created_at, metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      `msg_${randomId()}`,
      taskId,
      "info",
      "open",
      "Chief of Staff follow-up queued",
      "A worker handoff was approved, so the Chief of Staff will turn it into the next safe business move before any external action is considered.",
      ts,
      toJson({ handoffId: handoff.id, workflowId: handoff.workflow_id, taskId }),
    ],
  );
  insertEvent(db, {
    actor: "chief_of_staff",
    type: "agent.handoff_followup_queued",
    entityType: "task",
    entityId: taskId,
    message: "Chief of Staff follow-up was queued for an approved worker handoff.",
    metadata: { handoffId: handoff.id, workflowId: handoff.workflow_id },
  });
  return get(db, "SELECT * FROM tasks WHERE id = ?", [taskId]);
}

function applyHandoffWorkflowDecision(db, handoff, decision, note, ts) {
  if (!handoff.workflow_id || decision === "approve") return;
  const step = decision === "changes" ? "worker handoff needs changes" : "worker handoff declined";
  run(
    db,
    `UPDATE workflows
     SET status = 'needs_changes', current_step = ?, approval_required = 1, updated_at = ?
     WHERE id = ?`,
    [step, ts, handoff.workflow_id],
  );
  run(
    db,
    `INSERT INTO messages (id, task_id, severity, status, subject, body, created_at, metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      `msg_${randomId()}`,
      handoff.task_id || null,
      decision === "changes" ? "warning" : "urgent",
      "open",
      decision === "changes" ? "Worker handoff needs changes" : "Worker handoff declined",
      note || handoff.decision_needed || "Review the worker handoff before continuing this workflow.",
      ts,
      toJson({ handoffId: handoff.id, workflowId: handoff.workflow_id, decision }),
    ],
  );
}

function decideAgentHandoff(db, handoffId, decision, note = "", options = {}) {
  ensureAiTeam(db);
  const normalizedDecision = normalizeHandoffDecision(decision);
  if (!normalizedDecision) {
    throw new Error("Handoff decision must be approve, changes, or reject.");
  }

  const handoff = getAgentHandoff(db, handoffId);
  if (!handoff) {
    throw new Error("Worker handoff not found.");
  }

  if (FINAL_HANDOFF_STATUSES.has(handoff.status)) {
    return {
      changed: false,
      decision: normalizedDecision,
      handoff,
      message: "This worker handoff was already decided.",
    };
  }

  const ts = now();
  const status = handoffDecisionStatus(normalizedDecision);
  const followupTask = normalizedDecision === "approve" ? createHandoffFollowupTask(db, handoff, note, ts) : null;
  const metadata = {
    ...(handoff.metadata || {}),
    operatorDecision: {
      decision: normalizedDecision,
      status,
      note: note || "",
      decidedAt: ts,
      decidedBy: options.decidedBy || "operator",
      followupTaskId: followupTask?.id || null,
    },
  };

  run(
    db,
    `UPDATE agent_handoffs
     SET status = ?, metadata = ?, updated_at = ?, resolved_at = ?
     WHERE id = ?`,
    [status, toJson(metadata), ts, ts, handoff.id],
  );
  if (handoff.task_id) {
    run(
      db,
      `UPDATE messages
       SET status = 'resolved', resolved_at = COALESCE(resolved_at, ?)
       WHERE task_id = ? AND status = 'open' AND severity = 'approval'`,
      [ts, handoff.task_id],
    );
  }
  addAgentTrace(
    db,
    handoff.from_run_id,
    "handoff_decided",
    "Handoff decided",
    note || handoffDecisionMessage(normalizedDecision, handoff),
    { handoffId: handoff.id, decision: normalizedDecision, status, followupTaskId: followupTask?.id || null },
  );
  if (followupTask) {
    addAgentTrace(
      db,
      handoff.from_run_id,
      "handoff_followup_queued",
      "Follow-up queued",
      "Chief of Staff follow-up was queued so the approved handoff becomes a concrete next step.",
      { handoffId: handoff.id, followupTaskId: followupTask.id },
    );
  }
  applyHandoffWorkflowDecision(db, handoff, normalizedDecision, note, ts);
  insertEvent(db, {
    actor: options.decidedBy || "operator",
    type: "agent.handoff_decided",
    entityType: "agent_handoff",
    entityId: handoff.id,
    message: handoffDecisionMessage(normalizedDecision, handoff),
    metadata: {
      workflowId: handoff.workflow_id || null,
      taskId: handoff.task_id || null,
      decision: normalizedDecision,
      status,
      note: note || "",
      followupTaskId: followupTask?.id || null,
    },
  });

  return {
    changed: true,
    decision: normalizedDecision,
    handoff: getAgentHandoff(db, handoff.id),
    followupTask,
  };
}

function listAgentHandoffs(db) {
  return all(
    db,
    `${handoffSelectSql()}
     ORDER BY CASE agent_handoffs.status
       WHEN 'needs_operator_decision' THEN 0
       WHEN 'waiting_for_review' THEN 1
       WHEN 'ready_for_next_worker' THEN 2
       ELSE 3
     END, agent_handoffs.updated_at DESC
     LIMIT 120`,
  ).map(parseHandoff);
}

function getAiTeamState(db) {
  ensureAiTeam(db);
  const definitions = listAgentDefinitions(db);
  const runs = all(
    db,
    `SELECT agent_runs.*, agent_definitions.name AS agent_name, agent_definitions.role AS agent_role
     FROM agent_runs
     LEFT JOIN agent_definitions ON agent_definitions.id = agent_runs.agent_id
     ORDER BY started_at DESC LIMIT 120`,
  ).map((row) => ({ ...row, metadata: fromJson(row.metadata, {}) }));
  const traceEvents = all(db, "SELECT * FROM agent_trace_events ORDER BY ts DESC, sequence DESC LIMIT 200").map((row) => ({
    ...row,
    metadata: fromJson(row.metadata, {}),
  }));
  const evalResults = all(
    db,
    `SELECT agent_eval_results.*, agent_definitions.name AS agent_name
     FROM agent_eval_results
     LEFT JOIN agent_definitions ON agent_definitions.id = agent_eval_results.agent_id
     ORDER BY created_at DESC LIMIT 120`,
  ).map((row) => ({
    ...row,
    criteria: fromJson(row.criteria, []),
    findings: fromJson(row.findings, []),
    metadata: fromJson(row.metadata, {}),
  }));
  const handoffs = listAgentHandoffs(db);
  const activeHandoffs = handoffs.filter((handoff) => !FINAL_HANDOFF_STATUSES.has(handoff.status));
  const latestRunByAgent = Object.fromEntries(runs.map((runRecord) => [runRecord.agent_id, runRecord]));

  return {
    guidance: OFFICIAL_AGENT_GUIDANCE,
    hardStops: HARD_STOPS,
    definitions: definitions.map((definition) => ({
      ...definition,
      latestRun: latestRunByAgent[definition.id] || null,
    })),
    runs,
    handoffs,
    traceEvents,
    evalResults,
    metrics: {
      workers: definitions.length,
      readyWorkers: definitions.filter((definition) => definition.status === "ready").length,
      runs: runs.length,
      running: runs.filter((runRecord) => runRecord.status === "running").length,
      completed: runs.filter((runRecord) => runRecord.status === "completed").length,
      failed: runs.filter((runRecord) => runRecord.status === "failed").length,
      evals: evalResults.length,
      evalsPassed: evalResults.filter((result) => result.status === "passed").length,
      evalsNeedingReview: evalResults.filter((result) => result.status !== "passed").length,
      handoffs: handoffs.length,
      activeHandoffs: activeHandoffs.length,
      decisionHandoffs: activeHandoffs.filter((handoff) => handoff.status === "needs_operator_decision").length,
      protectedMode: definitions.filter((definition) => definition.mode === "protected").length,
    },
  };
}

module.exports = {
  AI_TEAM_DEFINITIONS,
  OFFICIAL_AGENT_GUIDANCE,
  addAgentTrace,
  attachWorkerDecisionContract,
  createAgentRun,
  decideAgentHandoff,
  ensureAiTeam,
  evaluateAgentOutput,
  findAgentDefinition,
  finishAgentRun,
  getAiTeamState,
  listAgentDefinitions,
  listAgentHandoffs,
  recordAgentHandoff,
  recordProtectedWorkerOutcome,
  recordAgentFailure,
  recordTerminalAgentEvaluation,
  workerDecisionMetadata,
};
