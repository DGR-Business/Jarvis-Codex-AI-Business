const DECISION_INBOX_SCHEMA = "jarvis_operator_decision_inbox_v1";

const ACTIVE_HANDOFF_STATUSES = new Set(["needs_operator_decision", "waiting_for_review", "waiting_approval"]);
const LIVE_COMPARISON_SOURCE_TYPES = new Set(["agent_workbench_team_proof", "agent_model_readiness_pack"]);

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function firstText(...values) {
  for (const value of values) {
    const text = String(value || "").trim();
    if (text) return text;
  }
  return "";
}

function latestWorkflow(workflows, workflowId) {
  return workflows.find((workflow) => workflow.id === workflowId) || null;
}

function latestPdf(deliverables, workflowId) {
  return deliverables.find((deliverable) => (
    deliverable.workflow_id === workflowId
    && String(deliverable.format || "").toLowerCase() === "pdf"
    && deliverable.status === "ready_for_review"
  )) || null;
}

function itemPriority(item) {
  const riskWeight = { high: 40, medium: 20, low: 8 }[String(item.risk || "").toLowerCase()] || 12;
  const typeWeight = {
    live_comparison: 95,
    live_research: 88,
    approval: 80,
    worker_handoff: 76,
    money_move: 58,
    review_pack: 46,
    setup: 32,
  }[item.type] || 40;
  return typeWeight + riskWeight + Number(item.urgency || 0);
}

function approvalType(approval) {
  if (approval.scope === "live_ai_worker_spend" && LIVE_COMPARISON_SOURCE_TYPES.has(approval.payload?.comparisonSource?.type)) {
    return "live_comparison";
  }
  if (approval.scope === "live_ai_worker_spend") return "live_worker";
  if (approval.scope === "live_research_spend") return "live_research";
  return "approval";
}

function approvalItem(approval, context) {
  const workflow = latestWorkflow(context.workflows, approval.workflow_id);
  const deliverable = latestPdf(context.deliverables, approval.workflow_id);
  const payload = approval.payload || {};
  const workerName = payload.worker?.name || payload.liveSpendRequest?.worker?.name || payload.requestedWorkerName || "";
  const protectedEvidence = asArray(payload.protectedEvidence);
  const comparisonSource = payload.comparisonSource || {};
  const comparisonPacket = payload.comparisonPacket || {};
  const evidence = [
    payload.noSpendOccurred ? "No spend has occurred." : null,
    comparisonPacket.fixtureTitle ? `Fixture: ${comparisonPacket.fixtureTitle}` : null,
    payload.expectedMetric ? `Expected proof: ${payload.expectedMetric}` : null,
    ...protectedEvidence,
    workflow?.current_step ? `Workflow: ${workflow.current_step}` : null,
  ].filter(Boolean).slice(0, 4);
  const type = approvalType(approval);
  const estimatedCostCents = Number(payload.estimatedCostCents || payload.liveSpendRequest?.estimatedCostCents || 0);
  const isModelPackComparison = comparisonSource.type === "agent_model_readiness_pack";
  return {
    id: `approval:${approval.id}`,
    type,
    source: type === "live_comparison" ? "AI Team" : "Approval",
    title: approval.title,
    status: approval.status,
    risk: approval.risk_level || payload.riskLevel || "medium",
    requestedAt: approval.requested_at,
    workflowId: approval.workflow_id || null,
    taskId: payload.taskId || payload.liveSpendRequest?.taskId || null,
    approvalId: approval.id,
    handoffId: null,
    deliverableId: deliverable?.id || null,
    workerName,
    area: approval.scope,
    moneyMove: type === "live_comparison"
      ? isModelPackComparison
        ? "Decide whether to allow one capped model comparison against this worker's local readiness pack."
        : "Decide whether to allow one capped live worker comparison against protected proof."
      : firstText(payload.commercialPurpose, payload.reason),
    decisionNeeded: comparisonPacket.decisionNeeded || "Approve, request changes, or deny before this work can continue.",
    expectedMetric: payload.expectedMetric || "",
    evidence,
    blockers: asArray(payload.providerRequirements?.flags).concat(asArray(payload.providerRequirements?.env)).slice(0, 4),
    expectedUpsideCents: Number(workflow?.expected_profit_cents || 0),
    costCapCents: estimatedCostCents,
    noSpendOccurred: payload.noSpendOccurred !== false,
    actions: [
      { label: "Approve", action: "approval", decision: "approve", id: approval.id, tone: "success" },
      { label: "Request Changes", action: "approval", decision: "changes", id: approval.id, tone: "warning" },
      { label: "Deny", action: "approval", decision: "reject", id: approval.id, tone: "danger" },
      workflow ? { label: "Open Workflow", action: "select-record", kind: "workflow", id: workflow.id } : null,
      deliverable ? { label: "Preview Pack", action: "preview-deliverable", id: deliverable.id } : null,
    ].filter(Boolean),
  };
}

function handoffItem(handoff, context) {
  const workflow = latestWorkflow(context.workflows, handoff.workflow_id);
  const evidence = [
    handoff.summary,
    handoff.decision_needed,
    workflow?.current_step ? `Workflow: ${workflow.current_step}` : null,
  ].filter(Boolean).slice(0, 4);
  return {
    id: `handoff:${handoff.id}`,
    type: "worker_handoff",
    source: "AI Team",
    title: handoff.decision_needed || "Review worker handoff",
    status: handoff.status,
    risk: handoff.risk_level || "medium",
    requestedAt: handoff.updated_at || handoff.created_at,
    workflowId: handoff.workflow_id || null,
    taskId: handoff.task_id || null,
    approvalId: null,
    handoffId: handoff.id,
    deliverableId: null,
    workerName: handoff.from_agent_name || handoff.from_agent_id || "",
    area: "worker_handoff",
    moneyMove: handoff.summary || "Choose the next safe worker step.",
    decisionNeeded: handoff.decision_needed || "Approve, request changes, or deny this worker handoff.",
    evidence,
    blockers: [],
    expectedUpsideCents: Number(workflow?.expected_profit_cents || 0),
    costCapCents: Number(workflow?.cost_estimate_cents || 0),
    noSpendOccurred: true,
    actions: [
      { label: "Approve", action: "handoff", decision: "approve", id: handoff.id, tone: "success" },
      { label: "Request Changes", action: "handoff", decision: "changes", id: handoff.id, tone: "warning" },
      { label: "Deny", action: "handoff", decision: "reject", id: handoff.id, tone: "danger" },
      workflow ? { label: "Open Workflow", action: "select-record", kind: "workflow", id: workflow.id } : null,
    ].filter(Boolean),
  };
}

function moneyMoveItem(move, context, seenLinks) {
  if (move.approvalId && seenLinks.has(`approval:${move.approvalId}`)) return null;
  if (move.handoffId && seenLinks.has(`handoff:${move.handoffId}`)) return null;
  const workflow = latestWorkflow(context.workflows, move.workflowId);
  const actions = [
    move.approvalId ? { label: "Approve", action: "approval", decision: "approve", id: move.approvalId, tone: "success" } : null,
    move.approvalId ? { label: "Request Changes", action: "approval", decision: "changes", id: move.approvalId, tone: "warning" } : null,
    move.approvalId ? { label: "Deny", action: "approval", decision: "reject", id: move.approvalId, tone: "danger" } : null,
    move.handoffId ? { label: "Approve", action: "handoff", decision: "approve", id: move.handoffId, tone: "success" } : null,
    move.handoffId ? { label: "Request Changes", action: "handoff", decision: "changes", id: move.handoffId, tone: "warning" } : null,
    move.handoffId ? { label: "Deny", action: "handoff", decision: "reject", id: move.handoffId, tone: "danger" } : null,
    move.taskId && move.type === "chief_of_staff_next_action" ? { label: "Open Follow-Up", action: "select-record", kind: "task", id: move.taskId } : null,
    move.deliverableId ? { label: "Preview Pack", action: "preview-deliverable", id: move.deliverableId } : null,
    move.candidateId && move.type === "next_test" ? { label: "Promote Test", action: "promote-test-candidate", id: move.candidateId, tone: "success" } : null,
    move.experimentId && move.type === "execution_pack_needed" ? { label: "Generate Pack", action: "generate-execution-pack", experimentId: move.experimentId, tone: "success" } : null,
    move.executionPackId ? { label: "Open Pack", action: "select-record", kind: "commercial_execution_pack", id: move.executionPackId } : null,
    move.executionPackId && move.workflowId ? { label: "Record Result", action: "open-result-entry", id: move.workflowId, workflowId: move.workflowId, experimentId: move.experimentId || "", executionPackId: move.executionPackId, tone: "success" } : null,
    move.workflowId ? { label: "Open Workflow", action: "select-record", kind: "workflow", id: move.workflowId } : null,
  ].filter(Boolean);
  if (!actions.length) return null;
  return {
    id: `money:${move.id}`,
    type: "money_move",
    source: "Commercial Brain",
    title: move.title,
    status: "waiting_for_review",
    risk: move.risk || "medium",
    requestedAt: move.createdAt || workflow?.updated_at || "",
    workflowId: move.workflowId || null,
    taskId: move.taskId || null,
    approvalId: move.approvalId || null,
    handoffId: move.handoffId || null,
    deliverableId: move.deliverableId || null,
    workerName: move.workerName || "",
    area: move.type || "money_move",
    moneyMove: move.recommendation || move.moneyMove || "",
    decisionNeeded: move.nextAction || "Choose the next business move.",
    expectedMetric: move.expectedMetric || "",
    evidence: asArray(move.evidence).slice(0, 4),
    blockers: asArray(move.blockers).slice(0, 4),
    expectedUpsideCents: Number(move.expectedUpsideCents || 0),
    costCapCents: Number(move.costCapCents || 0),
    noSpendOccurred: Number(move.costCapCents || 0) === 0,
    actions,
    urgency: Number(move.priority || 0) / 10,
  };
}

function reviewPackItem(deliverable, context, seenWorkflowIds) {
  if (!deliverable.workflow_id || seenWorkflowIds.has(deliverable.workflow_id)) return null;
  const workflow = latestWorkflow(context.workflows, deliverable.workflow_id);
  return {
    id: `review_pack:${deliverable.id}`,
    type: "review_pack",
    source: "Review Outputs",
    title: deliverable.human_name || deliverable.title || "Review pack ready",
    status: deliverable.status,
    risk: "low",
    requestedAt: deliverable.updated_at || "",
    workflowId: deliverable.workflow_id,
    taskId: null,
    approvalId: null,
    handoffId: null,
    deliverableId: deliverable.id,
    workerName: "",
    area: "review_pack",
    moneyMove: "Review the prepared decision material before steering the next step.",
    decisionNeeded: "Preview the pack and decide whether to continue, revise, or stop.",
    evidence: [
      workflow?.title ? `Workflow: ${workflow.title}` : null,
      deliverable.file_path ? "Local PDF is ready for preview." : null,
    ].filter(Boolean),
    blockers: [],
    expectedUpsideCents: Number(workflow?.expected_profit_cents || 0),
    costCapCents: Number(workflow?.cost_estimate_cents || 0),
    noSpendOccurred: true,
    actions: [
      { label: "Preview Pack", action: "preview-deliverable", id: deliverable.id },
      workflow ? { label: "Open Workflow", action: "select-record", kind: "workflow", id: workflow.id } : null,
    ].filter(Boolean),
  };
}

function buildDecisionInbox({
  approvals = [],
  handoffs = [],
  workflows = [],
  deliverables = [],
  commercialBrain = {},
  preOpenAiReadiness = null,
}) {
  const context = { workflows, deliverables };
  const items = [];
  const seenLinks = new Set();
  for (const approval of approvals.filter((approval) => approval.status === "pending")) {
    const item = approvalItem(approval, context);
    items.push(item);
    seenLinks.add(`approval:${approval.id}`);
  }
  for (const handoff of handoffs.filter((handoff) => ACTIVE_HANDOFF_STATUSES.has(handoff.status))) {
    const item = handoffItem(handoff, context);
    items.push(item);
    seenLinks.add(`handoff:${handoff.id}`);
  }
  for (const move of asArray(commercialBrain.moneyMoves)) {
    const item = moneyMoveItem(move, context, seenLinks);
    if (item) items.push(item);
  }
  const seenWorkflowIds = new Set(items.map((item) => item.workflowId).filter(Boolean));
  for (const deliverable of deliverables.filter((item) => (
    String(item.format || "").toLowerCase() === "pdf"
    && item.status === "ready_for_review"
  )).slice(0, 8)) {
    const item = reviewPackItem(deliverable, context, seenWorkflowIds);
    if (item) items.push(item);
  }

  const sorted = items
    .map((item) => ({ ...item, priority: itemPriority(item) }))
    .sort((a, b) => b.priority - a.priority || String(b.requestedAt || "").localeCompare(String(a.requestedAt || "")))
    .slice(0, 16);

  const estimatedCostCents = sorted.reduce((sum, item) => sum + Number(item.costCapCents || 0), 0);
  const liveComparisonCount = sorted.filter((item) => item.type === "live_comparison").length;
  const highRiskCount = sorted.filter((item) => item.risk === "high").length;
  return {
    schema: DECISION_INBOX_SCHEMA,
    status: sorted.length ? "decisions_waiting" : "clear",
    summary: sorted.length
      ? `${sorted.length} operator decision${sorted.length === 1 ? "" : "s"} waiting. The AI Team can continue only after you approve, deny, or request changes where needed.`
      : "No operator decision is waiting right now.",
    preOpenAiStatus: preOpenAiReadiness?.status || null,
    metrics: {
      total: sorted.length,
      approvals: sorted.filter((item) => Boolean(item.approvalId)).length,
      handoffs: sorted.filter((item) => Boolean(item.handoffId)).length,
      moneyMoves: sorted.filter((item) => item.type === "money_move").length,
      reviewPacks: sorted.filter((item) => item.type === "review_pack").length,
      liveComparisons: liveComparisonCount,
      highRisk: highRiskCount,
      estimatedCostCents,
      zeroSpendItems: sorted.filter((item) => item.noSpendOccurred).length,
    },
    topAction: sorted[0] || null,
    items: sorted,
  };
}

module.exports = {
  buildDecisionInbox,
  DECISION_INBOX_SCHEMA,
};
