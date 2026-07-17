const { all, fromJson, get, insertEvent, now, randomId, run, toJson } = require("../db");
const { recordAgentHandoff } = require("./ai-team");
const {
  buildDeliverableReviewBindings,
  deliverableReviewInput,
} = require("./deliverable-review-bindings");
const { requestLiveAiWorker } = require("./live-ai-workers");

const QUALITY_REVIEW_SCHEMA = "jarvis.deliverable-quality-review.v1";

function text(value, max = 1200) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function requestedReviewer(task) {
  return task.payload?.liveSpendRequest?.parameters?.requiredReviewer
    || task.payload?.chiefAssignment?.requiredReviewer
    || null;
}

function prepareRequiredQualityReview(db, input = {}) {
  const sourceTask = input.task;
  const sourceRun = input.run;
  const deliverableIds = [...new Set((input.deliverableIds || []).filter(Boolean).map(String))];
  if (!sourceTask || !sourceRun) throw new Error("Quality review preparation needs the source task and run.");
  if (requestedReviewer(sourceTask) !== "quality_reviewer") return { status: "not_required" };
  if (sourceTask.agent === "quality_reviewer") return { status: "already_reviewing" };
  if (!deliverableIds.length) {
    return { status: "needs_attention", reason: "The specialist produced no registered deliverable for Quality Reviewer." };
  }
  const bindings = buildDeliverableReviewBindings(db, sourceTask.workflow_id, deliverableIds);
  const imageIds = bindings
    .filter((binding) => /^image\//i.test(binding.format || ""))
    .map((binding) => binding.deliverableId);
  const review = requestLiveAiWorker(db, sourceTask.workflow_id, {
    requestKey: `quality_review_${sourceRun.id}`,
    requestedBy: "chief_of_staff",
    worker: "quality_reviewer",
    taskTitle: "Quality Reviewer: inspect the exact specialist output",
    approvalTitle: "Approve Quality Reviewer for this output",
    estimatedCostCents: 100,
    reason: "Independently inspect the exact registered output before it is shown as ready for business use.",
    expectedOutput: "A concise quality verdict covering completeness, evidence, claims, commercial usefulness, and any changes required.",
    expectedMetric: "The exact frozen deliverable passes with a score of at least 75, no missing material evidence, and no unsafe claim.",
    contextPurpose: "Review only the exact specialist output and the venture records needed to judge it.",
    contextClasses: ["venture", "evidence", "production", "legal", "finance"],
    tools: imageIds.length ? ["visual_asset_review"] : [],
    maxTurns: 1,
    maxToolCalls: imageIds.length ? 0 : 0,
    toolArguments: imageIds.length ? {
      visual_asset_review: {
        assetIds: imageIds,
        detail: "high",
      },
    } : {},
    parameters: {
      reviewOfRunId: sourceRun.id,
      reviewOfTaskId: sourceTask.id,
      reviewBindings: bindings,
      approvedAssetIds: imageIds,
      requiredReviewer: "quality_reviewer",
    },
    effects: [],
  });
  for (const binding of bindings) {
    run(
      db,
      `UPDATE deliverables
       SET status = 'quality_review_pending', updated_at = ?
       WHERE id = ? AND workflow_id = ?`,
      [now(), binding.deliverableId, sourceTask.workflow_id],
    );
  }
  const handoff = recordAgentHandoff(db, sourceRun, {
    handoffTo: "quality_reviewer",
    handoffStatus: "quality_review_prepared",
    approvalRequired: false,
    outputSummary: "The specialist output is frozen and waiting for an independent Quality Reviewer check.",
    handoffReason: "Do not show this deliverable as ready until Quality Reviewer checks the exact approved input.",
    handoffDecisionNeeded: "Review the separate Quality Reviewer model-cost approval.",
    handoffRiskLevel: "medium",
    metadata: {
      qualityReviewTaskId: review.task.id,
      qualityReviewApprovalId: review.approval?.id || null,
      reviewBindings: bindings,
    },
  });
  insertEvent(db, {
    actor: "jarvis",
    type: "quality.review_prepared",
    entityType: "task",
    entityId: review.task.id,
    message: "Quality Reviewer approval is ready for the exact specialist output.",
    metadata: {
      sourceTaskId: sourceTask.id,
      sourceRunId: sourceRun.id,
      reviewTaskId: review.task.id,
      approvalId: review.approval?.id || null,
      deliverableIds,
    },
  });
  return {
    status: "waiting_for_approval",
    task: review.task,
    approval: review.approval,
    handoff,
    bindings,
  };
}

function reviewVerdict(output) {
  const work = output?.roleOutput || output?.work || {};
  const qualityScore = Math.max(0, Math.min(100, Math.round(Number(work.qualityScore || 0))));
  const missingEvidence = Array.isArray(work.missingEvidence) ? work.missingEvidence.filter(Boolean).map(String) : [];
  const riskFindings = Array.isArray(work.riskFindings) ? work.riskFindings.filter(Boolean).map(String) : [];
  const claimSafety = text(work.claimSafety, 240);
  const claimsSafe = /^(safe|supported|acceptable)\b/i.test(claimSafety);
  const findings = [
    ...new Set([
      ...missingEvidence,
      ...riskFindings,
      ...(claimsSafe ? [] : [`Claim safety was not confirmed: ${claimSafety || "not stated"}`]),
    ]),
  ].slice(0, 10);
  const passed = output?.operatorDecision === "approve"
    && qualityScore >= 75
    && missingEvidence.length === 0
    && claimsSafe;
  return {
    verdict: passed ? "passed" : output?.operatorDecision === "deny" ? "blocked" : "changes_required",
    qualityScore,
    findings,
    claimSafety,
    operatorRecommendation: text(work.operatorRecommendation || output?.recommendation || output?.nextAction),
  };
}

function recordCompletedQualityReview(db, input = {}) {
  const task = input.task;
  const reviewRun = input.run;
  if (!task || !reviewRun || task.agent !== "quality_reviewer") return { status: "not_quality_review" };
  const parameters = task.payload?.liveSpendRequest?.parameters || {};
  const bindings = Array.isArray(parameters.reviewBindings) ? parameters.reviewBindings : [];
  if (!bindings.length) return { status: "not_deliverable_review" };
  const existingRows = all(
    db,
    `SELECT *
     FROM deliverable_quality_reviews
     WHERE review_run_id = ?
     ORDER BY created_at, deliverable_id`,
    [reviewRun.id],
  );
  if (existingRows.length) {
    const expectedIds = [...new Set(bindings.map((binding) => binding.deliverableId))].sort();
    const existingIds = [...new Set(existingRows.map((row) => row.deliverable_id))].sort();
    if (JSON.stringify(existingIds) !== JSON.stringify(expectedIds)) {
      throw new Error("The stored Quality Reviewer result does not match this run's exact deliverables.");
    }
    const results = existingRows.map((row) => ({
      id: row.id,
      deliverableId: row.deliverable_id,
      verdict: row.verdict,
      qualityScore: row.quality_score,
      findings: fromJson(row.findings, []),
    }));
    return {
      status: results.every((result) => result.verdict === "passed") ? "passed" : "changes_required",
      results,
      alreadyRecorded: true,
    };
  }
  const evaluated = reviewVerdict(input.output);
  const sourceRunId = parameters.reviewOfRunId || null;
  const results = [];
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const binding of bindings) {
      const current = deliverableReviewInput(db, task.workflow_id, binding.deliverableId);
      const changed = current.inputHash !== binding.inputHash;
      const verdict = changed ? "blocked" : evaluated.verdict;
      const findings = changed
        ? ["The deliverable changed after Quality Reviewer approval. Prepare a new review for the current version.", ...evaluated.findings]
        : evaluated.findings;
      const id = `quality_review_${randomId()}`;
      run(
        db,
        `INSERT INTO deliverable_quality_reviews
         (id, venture_id, workflow_id, deliverable_id, source_run_id, review_task_id,
          review_run_id, reviewer_agent_id, input_hash, verdict, quality_score, findings,
          operator_recommendation, metadata, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'quality_reviewer', ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          task.venture_id,
          task.workflow_id,
          binding.deliverableId,
          sourceRunId,
          task.id,
          reviewRun.id,
          binding.inputHash,
          verdict,
          evaluated.qualityScore,
          toJson(findings),
          evaluated.operatorRecommendation,
          toJson({
            schema: QUALITY_REVIEW_SCHEMA,
            approvedInputHash: binding.inputHash,
            currentInputHash: current.inputHash,
            changedAfterApproval: changed,
          }),
          now(),
        ],
      );
      run(
        db,
        "UPDATE deliverables SET status = ?, updated_at = ? WHERE id = ?",
        [verdict === "passed" ? "ready_for_review" : "needs_changes", now(), binding.deliverableId],
      );
      results.push({ id, deliverableId: binding.deliverableId, verdict, qualityScore: evaluated.qualityScore, findings });
    }
    const allPassed = results.every((result) => result.verdict === "passed");
    run(
      db,
      `UPDATE workflows
       SET status = ?, current_step = ?, approval_required = 1, updated_at = ?
       WHERE id = ?`,
      [
        allPassed ? "ready_for_review" : "needs_changes",
        allPassed ? "quality review passed; operator review ready" : "quality review requires changes",
        now(),
        task.workflow_id,
      ],
    );
    insertEvent(db, {
      level: allPassed ? "info" : "warn",
      actor: "quality_reviewer",
      type: "quality.review_completed",
      entityType: "agent_run",
      entityId: reviewRun.id,
      message: allPassed
        ? "Quality Reviewer passed the exact output for operator review."
        : "Quality Reviewer found changes required before the output is ready.",
      metadata: { results, sourceRunId, reviewTaskId: task.id },
    });
    db.exec("COMMIT");
    return { status: allPassed ? "passed" : "changes_required", results };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

module.exports = {
  QUALITY_REVIEW_SCHEMA,
  buildDeliverableReviewBindings,
  deliverableReviewInput,
  prepareRequiredQualityReview,
  recordCompletedQualityReview,
};
