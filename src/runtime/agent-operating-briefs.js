const { getAiTeamState } = require("./ai-team");
const { getAgentWorkbenchState } = require("./agent-workbench");
const { getAgentToolPolicyState } = require("./agent-tools");

const OPERATING_BRIEF_SCHEMA = "jarvis_agent_operating_briefs_v1";

const OWNERSHIP = {
  chief_of_staff: {
    owns: [
      "Turn specialist work into one clear operator decision.",
      "Keep the business focused on the next money move.",
      "Check that evidence, risk, cost, and approval controls are visible.",
    ],
    evidence: [
      "A plain decision packet with the recommended action, why it matters, what could go wrong, and what the operator can approve, deny, or change.",
    ],
  },
  opportunity_scout: {
    owns: [
      "Find buyer groups, painful problems, demand signals, and promising niches.",
      "Separate interesting ideas from commercially testable opportunities.",
    ],
    evidence: [
      "Specific buyer language, visible demand signal, competitor or marketplace clue, and the next validation gap.",
    ],
  },
  demand_validator: {
    owns: [
      "Check whether real people already search, buy, complain, review, or pay for a similar result.",
      "Protect the system from building on invented demand.",
    ],
    evidence: [
      "Source-backed demand verdict, source summary, confidence level, and a clear continue or stop signal.",
    ],
  },
  offer_architect: {
    owns: [
      "Convert evidence into a buyer, promise, product format, price, and buying trigger.",
      "Keep offers small enough to test before heavy building.",
    ],
    evidence: [
      "A test-ready offer with buyer, problem, promise, price logic, objections, and hypothesis.",
    ],
  },
  product_builder: {
    owns: [
      "Prepare the smallest sellable digital product asset or publishing package for the next test.",
      "Keep product work tied to the commercial hypothesis.",
    ],
    evidence: [
      "Asset plan, mockup or listing draft, quality risks, and the approval needed before any live upload or paid generation.",
    ],
  },
  copy_conversion_agent: {
    owns: [
      "Write practical conversion copy that makes the buyer action obvious.",
      "Keep claims measurable and supported.",
    ],
    evidence: [
      "Headline, description, call to action, message variants, and tracking note for the chosen channel.",
    ],
  },
  distribution_operator: {
    owns: [
      "Prepare tiny channel tests without sending, posting, or publishing until approved.",
      "Define exactly what evidence the operator should capture.",
    ],
    evidence: [
      "Manual channel steps, evidence fields, success metric, and kill rule.",
    ],
  },
  finance_analyst: {
    owns: [
      "Keep price, cost, margin, time, break-even, and spend caps honest.",
      "Stop attractive ideas from hiding weak unit economics.",
    ],
    evidence: [
      "Margin logic, break-even point, cost cap, financial risk, and decision signal.",
    ],
  },
  customer_voice_agent: {
    owns: [
      "Turn buyer replies, reviews, objections, and support signals into practical product and offer changes.",
      "Separate actual buyer wording from interpretation.",
    ],
    evidence: [
      "Buyer language, objections, requested improvements, and a recommended revision.",
    ],
  },
  growth_analyst: {
    owns: [
      "Compare expected results with actual outcomes.",
      "Recommend scale, revise, pause, or kill based on evidence rather than optimism.",
    ],
    evidence: [
      "Verdict, learning, improvement, next action, and confidence tied to real metrics.",
    ],
  },
  quality_reviewer: {
    owns: [
      "Check output quality, evidence gaps, claim safety, IP/platform risk, and operator readability.",
      "Prefer requesting changes over letting risky work move forward.",
    ],
    evidence: [
      "Quality score, risk findings, missing evidence, and an operator recommendation.",
    ],
  },
};

function listValue(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function humanize(value) {
  return String(value || "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function sentenceList(values, fallback) {
  const clean = listValue(values).map((value) => String(value).trim()).filter(Boolean);
  return clean.length ? clean : listValue(fallback);
}

function toolNames(assignments = []) {
  return listValue(assignments).map((assignment) => assignment.tool?.name || assignment.name || humanize(assignment.tool_id || assignment.id));
}

function plainContractFields(contract) {
  const required = listValue(contract?.required);
  return required.map(humanize);
}

function proofLabel(bench) {
  if (!bench) return "No workbench evidence yet.";
  if (bench.comparison?.dryRun) {
    return `Protected proof: ${humanize(bench.comparison.dryRun.status)} / ${humanize(bench.comparison.dryRun.evalStatus)} / ${Number(bench.comparison.dryRun.evalScore || 0)}/100.`;
  }
  return "Protected proof has not been run yet.";
}

function connectionReadiness(bench) {
  if (!bench) {
    return {
      status: "needs_worker_evidence",
      label: "Needs worker evidence first",
      detail: "Run protected proof before any model connection is considered.",
    };
  }
  if (bench.promotionGate?.status === "ready_for_narrow_live_use") {
    return {
      status: "ready_for_narrow_live_use",
      label: "Ready only for narrow capped live use",
      detail: "This worker has passed protected and live comparison evidence, but external actions still need their own approvals.",
    };
  }
  if (bench.canPrepareLiveTest || bench.status === "ready_after_setup" || bench.status === "ready_for_capped_live_test") {
    return {
      status: "ready_for_one_capped_comparison",
      label: "Ready for one capped comparison after provider setup",
      detail: "Prepare only a capped, approval-gated live comparison when the operator accepts model spend.",
    };
  }
  return {
    status: "keep_protected",
    label: "Keep protected",
    detail: bench.nextAction || "Close the next proof, tool, or approval gap before model connection.",
  };
}

function buildOperatingBrief(definition, context = {}) {
  const bench = context.workbench?.byAgent?.[definition.id] || null;
  const policy = context.toolPolicy?.byAgent?.[definition.id] || bench?.toolPolicy || null;
  const ownership = OWNERSHIP[definition.id] || {};
  const allowedTools = toolNames(policy?.allowed);
  const approvalTools = toolNames(policy?.approvalRequired);
  const blockedTools = toolNames(policy?.blocked);
  const outputFields = plainContractFields(definition.output_contract);
  const inputFields = plainContractFields(definition.input_contract);
  const qualityChecks = sentenceList(definition.eval_criteria, ["Clear business decision", "Evidence linked", "Approval safety"]);
  const hardStops = sentenceList(definition.approval_policy?.mustPauseFor, ["External action", "Paid spend", "Publishing", "Account action"]);
  const handoffTargets = sentenceList(definition.handoff_targets, ["Chief of Staff"]).map(humanize);
  const readiness = connectionReadiness(bench);

  return {
    schema: OPERATING_BRIEF_SCHEMA,
    agentId: definition.id,
    name: definition.name,
    role: definition.role,
    status: definition.status,
    mode: definition.mode,
    mission: definition.instructions,
    owns: sentenceList(ownership.owns, [definition.instructions]),
    primaryInputs: inputFields.length ? inputFields : ["Business instruction", "Runtime state", "Evidence"],
    mustProduce: outputFields.length ? outputFields : ["Money Move", "Evidence Summary", "Risk Summary", "Next Decision"],
    evidenceStandard: sentenceList(ownership.evidence, [
      `Output must satisfy: ${qualityChecks.join(", ")}.`,
    ]),
    qualityChecks,
    handoffTargets,
    toolSummary: policy?.summary || "Tool permissions are still being registered.",
    allowedTools: allowedTools.length ? allowedTools : ["Protected runtime records"],
    approvalRequiredTools: approvalTools,
    lockedTools: blockedTools,
    hardStops,
    currentProof: proofLabel(bench),
    readinessScore: Number(bench?.readinessScore || 0),
    proofStatus: bench?.status || "needs_protected_proof",
    nextSafeAction: bench?.nextAction || "Run protected proof before live model testing.",
    connectionReadiness: readiness,
    operatorDecision: {
      question: readiness.status === "ready_for_one_capped_comparison"
        ? "Do you want to prepare one capped live comparison for this worker?"
        : "Should this worker run protected proof or wait?",
      defaultChoice: readiness.status === "keep_protected" ? "Keep protected and close the evidence gap." : "Run the next protected proof step.",
    },
    continuousImprovement: {
      hypothesis: "This worker improves the business only if it produces a clearer decision, stronger evidence, or a faster money move.",
      expectedMetric: "Higher quality score, fewer missing evidence gaps, lower operator effort, or better commercial result.",
      actualResultSource: "Worker runs, evals, traces, handoffs, market results, feedback, and learning cycles.",
      improvementRule: "If the proof is weak, request changes or revise the worker contract before widening use.",
    },
  };
}

function buildSummary(briefs, workbench) {
  const total = briefs.length;
  const withBrief = briefs.filter((brief) => brief.mission && brief.mustProduce.length && brief.hardStops.length).length;
  const readyForComparison = briefs.filter((brief) => brief.connectionReadiness.status === "ready_for_one_capped_comparison").length;
  const keepProtected = briefs.filter((brief) => brief.connectionReadiness.status === "keep_protected" || brief.connectionReadiness.status === "needs_worker_evidence").length;
  const protectedProofs = Number(workbench?.metrics?.dryRunProven || 0);
  return {
    total,
    complete: withBrief,
    protectedProofs,
    readyForComparison,
    keepProtected,
    summary: `${withBrief}/${total} worker operating briefs are ready. ${protectedProofs} protected proof${protectedProofs === 1 ? "" : "s"} exist before any OpenAI model connection.`,
    nextAction: keepProtected > 0
      ? "Run protected proof for the next worker and review the quality result."
      : "Only prepare a capped live comparison when the operator accepts provider setup and model spend.",
  };
}

function getAgentOperatingBriefsState(db, context = {}) {
  const aiTeam = context.aiTeam || getAiTeamState(db);
  const workbench = context.agentWorkbench || context.workbench || getAgentWorkbenchState(db);
  const toolPolicy = context.agentToolPolicy || context.toolPolicy || getAgentToolPolicyState(db);
  const definitions = aiTeam.definitions || [];
  const briefs = definitions.map((definition) => buildOperatingBrief(definition, { workbench, toolPolicy }));
  return {
    schema: OPERATING_BRIEF_SCHEMA,
    status: briefs.every((brief) => brief.mustProduce.length && brief.hardStops.length) ? "ready" : "needs_review",
    summary: buildSummary(briefs, workbench),
    byAgent: Object.fromEntries(briefs.map((brief) => [brief.agentId, brief])),
    briefs,
  };
}

module.exports = {
  OPERATING_BRIEF_SCHEMA,
  buildOperatingBrief,
  getAgentOperatingBriefsState,
};
