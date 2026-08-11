const CONFIG = require("../config");
const crypto = require("node:crypto");
const { refreshIntegrationHealth } = require("../adapters/registry");
const { all, fromJson, get, insertEvent, now, randomId, run, toJson } = require("../db");
const { monthlyBudgetExposure, monthlyCapCents } = require("./cost-ledger");
const {
  auditTerminalAgentAttempts,
  verifyAgentRunReceiptChain,
} = require("./agent-execution-evidence");
const { verifyAgentContextSnapshot } = require("./agent-context");
const { getCanonicalTerminalView } = require("./commercial-truth-reconciliation");
const {
  evaluatePreventureResearchReadiness,
} = require("./preventure-research-readiness");
const {
  preventureResearchApprovalScopeHash,
} = require("./preventure-research-contract");
const {
  validatePendingPreventureLifecycleApproval,
} = require("./preventure-research-owner-state");
const {
  createPreventureResearchStore,
} = require("./preventure-research-store");

const ALWAYS_ACTIONABLE_SAFETY_CATEGORIES = new Set([
  "agent_context",
  "agent_receipts",
  "approval_integrity",
  "budget",
  "chief_assignment",
  "cost",
  "integrations",
  "evidence_integrity",
  "preventure_authority",
  "runtime_oversight",
  "unknown_outcome",
  "unsafe_retry",
]);

function minutesAgo(minutes) {
  return new Date(Date.now() - minutes * 60 * 1000).toISOString();
}

function severityRank(severity) {
  return { info: 0, warn: 1, error: 2 }[severity] || 0;
}

function summarizeSeverity(findings) {
  if (findings.some((finding) => finding.severity === "error")) return "error";
  if (findings.some((finding) => finding.severity === "warn")) return "warn";
  return "info";
}

function monitorStatus(severity) {
  if (severity === "error") return "critical";
  if (severity === "warn") return "attention";
  return "ok";
}

function parseMetadata(row) {
  if (!row) return row;
  return { ...row, metadata: fromJson(row.metadata) };
}

function supersededRetryTaskIds(db) {
  const tasks = all(
    db,
    `SELECT id, status, outcome_status, payload
     FROM tasks
     WHERE kind = 'live_ai_worker_execution'
     ORDER BY created_at`,
  ).map((task) => ({ ...task, payload: fromJson(task.payload, {}) }));
  const parentByTaskId = new Map(tasks.map((task) => [
    task.id,
    task.payload?.liveSpendRequest?.parameters?.retry?.priorTaskId || null,
  ]));
  const successfulTaskIds = new Set(all(
    db,
    `SELECT DISTINCT tasks.id
     FROM tasks
     JOIN agent_runs AS runs ON runs.task_id = tasks.id
     JOIN agent_eval_results AS evals ON evals.run_id = runs.id
     JOIN agent_run_receipts AS receipts ON receipts.run_id = runs.id
     WHERE tasks.kind = 'live_ai_worker_execution'
       AND tasks.status = 'completed'
       AND tasks.outcome_status = 'known'
       AND runs.status = 'completed'
       AND evals.status = 'passed'
       AND receipts.status = 'complete'`,
  ).map((row) => row.id));
  const localRecoveryTasks = all(
    db,
    `SELECT id, status, payload
     FROM tasks
     WHERE kind IN (
       'local_product_output_recovery',
       'local_commercial_output_recovery',
       'local_production_output_recovery'
     )`,
  ).map((task) => ({ ...task, payload: fromJson(task.payload, {}) }));
  const recoveredSourceTaskIds = new Set(localRecoveryTasks
    .filter((task) => task.status === "completed")
    .map((task) => task.payload?.recovery?.sourceTaskId)
    .filter(Boolean));
  const superseded = new Set();
  const addRetryAncestors = (taskId) => {
    const seen = new Set([taskId]);
    let parentId = parentByTaskId.get(taskId);
    while (parentId && !seen.has(parentId)) {
      superseded.add(parentId);
      seen.add(parentId);
      parentId = parentByTaskId.get(parentId);
    }
  };
  for (const taskId of successfulTaskIds) {
    addRetryAncestors(taskId);
  }
  for (const sourceTaskId of recoveredSourceTaskIds) {
    superseded.add(sourceTaskId);
    addRetryAncestors(sourceTaskId);
  }
  for (const recoveryTask of localRecoveryTasks) {
    const sourceTaskId = recoveryTask.payload?.recovery?.sourceTaskId;
    if (sourceTaskId && recoveredSourceTaskIds.has(sourceTaskId)) {
      superseded.add(recoveryTask.id);
    }
  }
  return superseded;
}

function addFinding(findings, finding) {
  findings.push({
    severity: finding.severity || "info",
    category: finding.category || "runtime",
    entityType: finding.entityType || null,
    entityId: finding.entityId || null,
    title: finding.title,
    detail: finding.detail || "",
    metadata: finding.metadata || {},
    fingerprintKey: finding.fingerprintKey || null,
  });
}

function terminalViewInput(db, record = {}, overrides = {}) {
  const metadata = record.metadata && typeof record.metadata === "object"
    ? record.metadata
    : fromJson(record.metadata, {});
  const entityType = overrides.entityType || record.entityType || record.entity_type || null;
  const entityId = overrides.entityId || record.entityId || record.entity_id || null;
  const input = {
    workflowId: overrides.workflowId
      || record.workflowId
      || record.workflow_id
      || metadata.workflowId
      || metadata.workflow_id
      || null,
    taskId: overrides.taskId
      || record.taskId
      || record.task_id
      || metadata.taskId
      || metadata.task_id
      || null,
    deliverableId: overrides.deliverableId
      || record.deliverableId
      || record.deliverable_id
      || metadata.deliverableId
      || metadata.deliverable_id
      || null,
    findingId: overrides.findingId
      || record.findingId
      || record.finding_id
      || metadata.findingId
      || metadata.finding_id
      || null,
    planId: overrides.planId
      || record.planId
      || record.plan_id
      || metadata.planId
      || metadata.plan_id
      || metadata.cataloguePlanId
      || null,
    opportunityId: overrides.opportunityId
      || record.opportunityId
      || record.opportunity_id
      || metadata.opportunityId
      || metadata.opportunity_id
      || null,
    experimentId: overrides.experimentId
      || record.experimentId
      || record.experiment_id
      || metadata.experimentId
      || metadata.experiment_id
      || null,
  };

  const directBindings = {
    task: "taskId",
    deliverable: "deliverableId",
    monitor_finding: "findingId",
    catalogue_plan: "planId",
    opportunity: "opportunityId",
    commercial_experiment: "experimentId",
    workflow: "workflowId",
  };
  if (entityId && directBindings[entityType] && !input[directBindings[entityType]]) {
    input[directBindings[entityType]] = entityId;
  }

  if (!input.taskId && entityId && entityType === "task_attempt") {
    const attempt = get(db, "SELECT task_id, workflow_id FROM task_attempts WHERE id = ?", [entityId]);
    input.taskId = attempt?.task_id || null;
    input.workflowId = input.workflowId || attempt?.workflow_id || null;
  }
  if (!input.taskId && entityId && entityType === "agent_run") {
    const agentRun = get(db, "SELECT task_id, workflow_id FROM agent_runs WHERE id = ?", [entityId]);
    input.taskId = agentRun?.task_id || null;
    input.workflowId = input.workflowId || agentRun?.workflow_id || null;
  }
  if (!input.workflowId && entityId && entityType === "workflow_run") {
    input.workflowId = get(
      db,
      "SELECT workflow_id FROM workflow_runs WHERE id = ?",
      [entityId],
    )?.workflow_id || null;
  }
  if ((!input.taskId || !input.workflowId) && entityId && entityType === "approval") {
    const approval = get(
      db,
      "SELECT task_id, workflow_id FROM approvals WHERE id = ?",
      [entityId],
    );
    input.taskId = input.taskId || approval?.task_id || null;
    input.workflowId = input.workflowId || approval?.workflow_id || null;
  }
  if ((!input.taskId || !input.workflowId) && metadata.approvalId) {
    const approval = get(
      db,
      "SELECT task_id, workflow_id FROM approvals WHERE id = ?",
      [metadata.approvalId],
    );
    input.taskId = input.taskId || approval?.task_id || null;
    input.workflowId = input.workflowId || approval?.workflow_id || null;
  }

  return input;
}

function isCanonicalTerminalRecord(db, record = {}, overrides = {}) {
  const input = terminalViewInput(db, record, overrides);
  if (!Object.values(input).some(Boolean)) return false;
  return getCanonicalTerminalView(db, input).terminal;
}

function keepActionableRecord(db, record, overrides = {}) {
  return !isCanonicalTerminalRecord(db, record, overrides);
}

function keepActionableFinding(db, finding) {
  if (ALWAYS_ACTIONABLE_SAFETY_CATEGORIES.has(finding.category)) return true;
  return keepActionableRecord(db, finding, {
    entityType: finding.entityType,
    entityId: finding.entityId,
  });
}

function findingFingerprint(finding) {
  if (finding.fingerprintKey) {
    return crypto.createHash("sha256").update([
      finding.category || "runtime",
      finding.fingerprintKey,
    ].join("|")).digest("hex");
  }
  return crypto.createHash("sha256").update([
    finding.category || "runtime",
    finding.entityType || "",
    finding.entityId || "",
    finding.title || "",
  ].join("|")).digest("hex");
}

function qualityReviewBindings(task) {
  const payload = fromJson(task.payload, {});
  const bindings = payload?.liveSpendRequest?.parameters?.reviewBindings;
  return Array.isArray(bindings) ? bindings : [];
}

function collectQualityReviewFindings(db, findings) {
  const reviewTasks = all(
    db,
    `SELECT id, workflow_id, status, error, payload, updated_at
     FROM tasks
     WHERE agent = 'quality_reviewer'
     ORDER BY updated_at DESC`,
  ).map((task) => ({ ...task, bindings: qualityReviewBindings(task) }));
  const pendingDeliverables = all(
    db,
    `SELECT id, workflow_id, human_name, title, updated_at
     FROM deliverables
     WHERE status = 'quality_review_pending'
     ORDER BY updated_at ASC`,
  );

  for (const deliverable of pendingDeliverables) {
    const reviewTask = reviewTasks.find((task) => task.bindings.some(
      (binding) => binding.deliverableId === deliverable.id,
    ));
    if (!reviewTask) {
      addFinding(findings, {
        severity: "error",
        category: "quality_review",
        entityType: "deliverable",
        entityId: deliverable.id,
        title: `Quality check missing: ${deliverable.human_name || deliverable.title}`,
        detail: "This output is being held for quality review, but no exact Quality Reviewer task is linked to it.",
        metadata: { workflowId: deliverable.workflow_id, updatedAt: deliverable.updated_at },
      });
      continue;
    }
    if (["failed", "cancelled"].includes(reviewTask.status)) {
      addFinding(findings, {
        severity: "error",
        category: "quality_review",
        entityType: "task",
        entityId: reviewTask.id,
        title: `Quality check stopped: ${deliverable.human_name || deliverable.title}`,
        detail: reviewTask.error || "The linked Quality Reviewer task stopped before producing a trusted result.",
        metadata: { deliverableId: deliverable.id, workflowId: deliverable.workflow_id, taskStatus: reviewTask.status },
      });
      continue;
    }
    if (reviewTask.status === "completed") {
      const review = get(
        db,
        `SELECT id FROM deliverable_quality_reviews
         WHERE deliverable_id = ? AND review_task_id = ?
         ORDER BY created_at DESC LIMIT 1`,
        [deliverable.id, reviewTask.id],
      );
      if (!review) {
        addFinding(findings, {
          severity: "error",
          category: "quality_review",
          entityType: "task",
          entityId: reviewTask.id,
          title: `Quality result missing: ${deliverable.human_name || deliverable.title}`,
          detail: "The Quality Reviewer task completed, but no immutable verdict was recorded for this exact output.",
          metadata: { deliverableId: deliverable.id, workflowId: deliverable.workflow_id },
        });
      }
    }
  }

  const changesRequired = all(
    db,
    `SELECT deliverables.id, deliverables.human_name, deliverables.title, deliverables.workflow_id,
            reviews.id AS review_id, reviews.verdict, reviews.quality_score, reviews.findings
     FROM deliverables
     JOIN deliverable_quality_reviews AS reviews ON reviews.deliverable_id = deliverables.id
     WHERE deliverables.status = 'needs_changes'
       AND reviews.created_at = (
         SELECT MAX(latest.created_at)
         FROM deliverable_quality_reviews AS latest
         WHERE latest.deliverable_id = deliverables.id
       )
       AND reviews.verdict IN ('changes_required', 'blocked')
     ORDER BY reviews.created_at DESC
     LIMIT 20`,
  );
  for (const item of changesRequired) {
    const reviewFindings = fromJson(item.findings, []);
    addFinding(findings, {
      severity: "warn",
      category: "quality_review",
      entityType: "deliverable",
      entityId: item.id,
      title: `Changes required: ${item.human_name || item.title}`,
      detail: reviewFindings.join(" ") || "Quality Reviewer found changes before this output can be used.",
      metadata: {
        workflowId: item.workflow_id,
        reviewId: item.review_id,
        verdict: item.verdict,
        qualityScore: item.quality_score,
      },
    });
  }
}

function collectAgentContextFindings(db, findings) {
  const snapshots = all(
    db,
    `SELECT id, venture_id, workflow_id, task_id, agent_id, snapshot_hash, snapshot
     FROM agent_context_snapshots
     ORDER BY created_at DESC`,
  );
  for (const row of snapshots) {
    const snapshot = fromJson(row.snapshot, {});
    const check = verifyAgentContextSnapshot(snapshot);
    const ownershipMatches = snapshot.ventureId === row.venture_id
      && snapshot.workflowId === row.workflow_id
      && snapshot.taskId === row.task_id
      && snapshot.agentId === row.agent_id
      && snapshot.snapshotHash === row.snapshot_hash;
    if (!check.valid || !ownershipMatches) {
      addFinding(findings, {
        severity: "error",
        category: "agent_context",
        entityType: "task",
        entityId: row.task_id,
        title: "Worker context verification failed",
        detail: check.valid
          ? "The stored worker context no longer matches its venture, workflow, task, or worker."
          : check.reason,
        metadata: { contextSnapshotId: row.id, contextSnapshotHash: row.snapshot_hash },
      });
    }
  }

  const liveTasks = all(
    db,
    `SELECT id, venture_id, workflow_id, agent, payload
     FROM tasks
     WHERE kind = 'live_ai_worker_execution' AND status <> 'cancelled'
     ORDER BY updated_at DESC`,
  );
  for (const task of liveTasks) {
    const payload = fromJson(task.payload, {});
    const context = payload.contextSnapshot;
    const reference = payload?.liveSpendRequest?.parameters?.contextSnapshot;
    if (!context && !reference) continue;
    const snapshotHash = context?.snapshotHash || reference?.hash || null;
    const stored = snapshotHash
      ? get(db, "SELECT * FROM agent_context_snapshots WHERE snapshot_hash = ?", [snapshotHash])
      : null;
    const ownershipMatches = stored
      && stored.task_id === task.id
      && stored.venture_id === task.venture_id
      && stored.workflow_id === task.workflow_id
      && stored.agent_id === task.agent;
    if (!stored || !ownershipMatches) {
      addFinding(findings, {
        severity: "error",
        category: "agent_context",
        entityType: "task",
        entityId: task.id,
        title: "Worker context record missing",
        detail: "This live worker task references business records that are not stored against the same venture, workflow, task, and worker.",
        metadata: { workflowId: task.workflow_id, workerId: task.agent, contextSnapshotHash: snapshotHash },
      });
    }
  }
}

function collectChiefAssignmentFindings(db, findings) {
  const handoffs = all(
    db,
    `SELECT id, workflow_id, status, metadata, updated_at
     FROM agent_handoffs
     WHERE from_agent_id = 'chief_of_staff'
       AND status IN (
         'specialist_assignment_prepared',
         'specialist_work_running',
         'specialist_quality_review_pending'
       )
     ORDER BY updated_at ASC`,
  );
  for (const handoff of handoffs) {
    const metadata = fromJson(handoff.metadata, {});
    const childTaskId = metadata.childTaskId;
    const childTask = childTaskId
      ? get(db, "SELECT id, title, status, error FROM tasks WHERE id = ?", [childTaskId])
      : null;
    if (!childTask) {
      addFinding(findings, {
        severity: "error",
        category: "chief_assignment",
        entityType: "agent_handoff",
        entityId: handoff.id,
        title: "Chief assignment lost its worker task",
        detail: "Chief of Staff has an open specialist assignment, but the exact child task cannot be found.",
        metadata: { workflowId: handoff.workflow_id, childTaskId: childTaskId || null },
      });
      continue;
    }
    if (["failed", "cancelled"].includes(childTask.status)) {
      addFinding(findings, {
        severity: "error",
        category: "chief_assignment",
        entityType: "task",
        entityId: childTask.id,
        title: `Chief assignment stopped: ${childTask.title}`,
        detail: childTask.error || "The specialist task stopped before Chief of Staff could close the assignment.",
        metadata: { workflowId: handoff.workflow_id, handoffId: handoff.id, taskStatus: childTask.status },
      });
    }
  }
}

function collectRuntimeOversightFindings(db, findings, options = {}) {
  const monitorJob = get(
    db,
    "SELECT * FROM scheduler_jobs WHERE id = 'job-monitor-cycle'",
  );
  if (!monitorJob) return;

  if (monitorJob.status !== "enabled") {
    addFinding(findings, {
      severity: "error",
      category: "runtime_oversight",
      entityType: "scheduler_job",
      entityId: monitorJob.id,
      title: "Pantheon monitoring is paused",
      detail: "Independent system checks are disabled. Restart them before relying on unattended work.",
      metadata: { status: monitorJob.status },
    });
    return;
  }

  const latestRun = get(
    db,
    `SELECT id, status, started_at, completed_at, error
     FROM scheduler_runs
     WHERE job_id = ?
     ORDER BY started_at DESC
     LIMIT 1`,
    [monitorJob.id],
  );
  if (latestRun && ["failed", "needs_attention", "abandoned"].includes(latestRun.status)) {
    addFinding(findings, {
      severity: "error",
      category: "runtime_oversight",
      entityType: "scheduler_run",
      entityId: latestRun.id,
      title: "Pantheon monitoring needs recovery",
      detail: latestRun.error || "The latest independent system check did not finish cleanly.",
      metadata: {
        jobId: monitorJob.id,
        runStatus: latestRun.status,
        startedAt: latestRun.started_at,
        completedAt: latestRun.completed_at,
      },
    });
    return;
  }

  const referenceTime = options.at || now();
  const referenceMs = Date.parse(referenceTime);
  const lockedAtMs = Date.parse(monitorJob.locked_at || "");
  const metadata = fromJson(monitorJob.metadata, {});
  const leaseSeconds = Math.max(60, Number(metadata.leaseSeconds || 15 * 60));
  if (monitorJob.lock_owner && Number.isFinite(lockedAtMs)) {
    if (Number.isFinite(referenceMs) && referenceMs - lockedAtMs > leaseSeconds * 1000) {
      addFinding(findings, {
        severity: "error",
        category: "runtime_oversight",
        entityType: "scheduler_job",
        entityId: monitorJob.id,
        title: "Pantheon monitoring appears stuck",
        detail: "The scheduled check has held its execution lease longer than its allowed window.",
        metadata: {
          lockOwner: monitorJob.lock_owner,
          lockedAt: monitorJob.locked_at,
          leaseSeconds,
        },
      });
    }
    return;
  }

  const nextRunMs = Date.parse(monitorJob.next_run_at || "");
  const intervalSeconds = Math.max(60, Number(monitorJob.interval_seconds || 15 * 60));
  const graceSeconds = Math.max(120, Math.ceil(intervalSeconds / 4));
  if (!monitorJob.last_run_at) {
    addFinding(findings, {
      severity: "warn",
      category: "runtime_oversight",
      entityType: "scheduler_job",
      entityId: monitorJob.id,
      title: "Pantheon monitoring has not completed its first check",
      detail: "The schedule is enabled, but no independent system check has completed yet.",
      metadata: { nextRunAt: monitorJob.next_run_at },
    });
  } else if (
    Number.isFinite(referenceMs)
    && Number.isFinite(nextRunMs)
    && referenceMs > nextRunMs + graceSeconds * 1000
  ) {
    addFinding(findings, {
      severity: "warn",
      category: "runtime_oversight",
      entityType: "scheduler_job",
      entityId: monitorJob.id,
      title: "Pantheon monitoring is overdue",
      detail: "The next independent system check did not start within its expected window.",
      metadata: {
        lastRunAt: monitorJob.last_run_at,
        nextRunAt: monitorJob.next_run_at,
        graceSeconds,
      },
    });
  }
}

function preventureResearchSchedulerFinding(job, dispatchableAuthorityCount) {
  if (job?.status !== "enabled" || dispatchableAuthorityCount > 0) return null;
  return {
    severity: "error",
    category: "preventure_authority",
    entityType: "scheduler_job",
    entityId: "job-preventure-research",
    title: "The bounded research scheduler is enabled without runnable authority",
    detail: "Disable the bounded research scheduler. A terminal, expired, proposed, accepted, frozen, or absent authority cannot permit provider-capable scheduled work.",
    metadata: {
      schedulerStatus: job.status,
      dispatchableAuthorityCount,
    },
    fingerprintKey: "preventure_research_scheduler_without_dispatch_authority",
  };
}

function shouldReportPreventureContraryEvidenceGap(ledger, readiness) {
  return !ledger?.terminalStopRecord
    && ledger?.decision?.completionMode !== "validated_early_stop"
    && readiness?.execution?.completionMode !== "validated_early_stop"
    && readiness?.execution?.complete === true
    && Array.isArray(readiness?.evidence?.missingContraryQuestions)
    && readiness.evidence.missingContraryQuestions.length > 0;
}

function terminalCustodyIndex() {
  return {
    assignmentHashes: new Set(),
    attemptIds: new Set(),
    costIds: new Set(),
    receiptIds: new Set(),
    reservationIds: new Set(),
    runIds: new Set(),
    taskIds: new Set(),
  };
}

function indexVerifiedTerminalCustody(index, recovery) {
  index.assignmentHashes.add(recovery.assignmentHash);
  index.attemptIds.add(recovery.originalDispatch.taskAttemptId);
  index.taskIds.add(recovery.taskId);
  if (recovery.executionClosure?.agentRunId) {
    index.runIds.add(recovery.executionClosure.agentRunId);
  }
  if (recovery.executionReceipt?.id) index.receiptIds.add(recovery.executionReceipt.id);
  if (recovery.costSnapshot?.budgetReservationId) {
    index.reservationIds.add(recovery.costSnapshot.budgetReservationId);
  }
  if (recovery.costSnapshot?.costId) index.costIds.add(recovery.costSnapshot.costId);
}

function collectPreventureResearchFindings(db, findings, options = {}) {
  const custodyIndex = terminalCustodyIndex();
  const schedulerJob = get(
    db,
    "SELECT id, status FROM scheduler_jobs WHERE id = 'job-preventure-research'",
  );
  const authorityRows = all(
    db,
    `SELECT authority_hash
     FROM preventure_research_authorities
     ORDER BY created_at, authority_hash`,
  );
  if (authorityRows.length === 0) {
    const schedulerFinding = preventureResearchSchedulerFinding(schedulerJob, 0);
    if (schedulerFinding) addFinding(findings, schedulerFinding);
    return custodyIndex;
  }

  const injectedClock = typeof options.preventureResearchClock === "function"
    ? options.preventureResearchClock
    : null;
  const observedAt = options.at || (injectedClock ? injectedClock() : now());
  const storeClock = injectedClock || (() => observedAt);
  let store;
  let authorities;
  try {
    store = createPreventureResearchStore(db, {
      clock: storeClock,
      authorityRegistry: options.preventureResearchAuthorityRegistry,
      retainedOutputStore: options.preventureResearchRetainedOutputStore,
    });
    const verification = store.verifyLedger();
    if (!verification?.ok) throw new Error("The bounded-research ledger did not return a valid integrity result.");
    authorities = store.listAuthorities();
  } catch (error) {
    addFinding(findings, {
      severity: "error",
      category: "preventure_authority",
      entityType: "runtime",
      entityId: "preventure_research_ledger",
      title: "Bounded research record failed its integrity check",
      detail: "Pantheon cannot trust this research authority, so no assignment should run until the ledger is repaired and verified.",
      metadata: { reason: String(error?.code || error?.message || "ledger_verification_failed") },
      fingerprintKey: "preventure_research_ledger_integrity",
    });
    const schedulerFinding = preventureResearchSchedulerFinding(schedulerJob, 0);
    if (schedulerFinding) addFinding(findings, schedulerFinding);
    return custodyIndex;
  }

  let currentAuthorityCount = 0;
  let dispatchableAuthorityCount = 0;
  for (const authority of authorities) {
    let ledger;
    let state;
    let readiness;
    try {
      ledger = store.readLedger(authority.authorityHash);
      state = store.readState(authority.authorityHash);
      readiness = evaluatePreventureResearchReadiness(ledger, state, {
        generatedAt: observedAt,
      });
    } catch (error) {
      addFinding(findings, {
        severity: "error",
        category: "preventure_authority",
        entityType: "preventure_research_authority",
        entityId: authority.authorityHash,
        title: "One bounded research authority cannot be verified",
        detail: "Pantheon withheld this research round because its lifecycle, assignments, costs, receipts, or evidence no longer form one trusted record.",
        metadata: { reason: String(error?.code || error?.message || "authority_verification_failed") },
      });
      continue;
    }

    const latestEvent = ledger.lifecycle.at(-1) || null;
    const terminalRecoveries = Array.isArray(ledger.terminalRecoveries)
      ? ledger.terminalRecoveries
      : [];
    terminalRecoveries.forEach((recovery) => {
      indexVerifiedTerminalCustody(custodyIndex, recovery);
      const ownerObservation = ledger.ownerBillingObservations?.find((item) => (
        item.assignmentHash === recovery.assignmentHash
        && item.predecessor?.kind === "terminal_recovery"
        && item.predecessor?.hash === recovery.recoveryHash
      )) || null;
      addFinding(findings, {
        severity: "warn",
        category: "cost",
        entityType: "preventure_research_assignment",
        entityId: recovery.assignmentHash,
        title: ownerObservation
          ? "Terminal provider billing is owner-attested, not provider-settled"
          : "Terminal provider custody is awaiting exact billing",
        detail: ownerObservation
          ? "The authenticated owner observation is retained with the sealed custody record. It is not a provider-settled receipt, cannot be used as commercial evidence, and authorises no retry or further network call."
          : "The exact provider result is sealed for custody and billing only. It cannot be retried or used as commercial evidence, and no further network call or diligence decision is authorised.",
        metadata: {
          authorityHash: recovery.authorityHash,
          assignmentHash: recovery.assignmentHash,
          recoveryHash: recovery.recoveryHash,
          receiptStatus: recovery.executionReceipt?.status || "not_available_before_custody",
          costTruth: ownerObservation ? "owner_attested" : recovery.costSnapshot.costTruth,
          exposureAudCents: ownerObservation
            ? ownerObservation.billingObservation.amountAudCents
            : recovery.costSnapshot.exposureAudCents,
          assignmentCapAudCents: recovery.assignmentCapAudCents,
          fullCapExposure:
            recovery.costSnapshot.exposureAudCents === recovery.assignmentCapAudCents,
          exactBillingPending: ownerObservation
            ? false
            : recovery.costSnapshot.exactBillingPending === true,
          ownerBillingObservationHash: ownerObservation?.observationHash || null,
          ownerBillingTruthStatus: ownerObservation?.truth?.status || null,
          providerSettled: false,
          decisionRecorded: Boolean(ledger.decision),
          retryAuthorized: recovery.controls.retryAuthorized === true,
          additionalNetworkCalls: recovery.controls.additionalNetworkCalls,
        },
        fingerprintKey: `preventure_terminal_custody_billing:${recovery.recoveryHash}`,
      });
    });
    const persistedTerminal = new Set([
      "completed",
      "expired",
      "revised",
      "revoked",
      "superseded",
    ]).has(latestEvent?.eventType) || terminalRecoveries.length > 0;
    if (!persistedTerminal) currentAuthorityCount += 1;
    if (!persistedTerminal && state.dispatchAllowed === true) {
      dispatchableAuthorityCount += 1;
    }

    if (state.expired && !persistedTerminal) {
      addFinding(findings, {
        severity: "error",
        category: "preventure_authority",
        entityType: "preventure_research_authority",
        entityId: authority.authorityHash,
        title: "Bounded research expired without a sealed stop record",
        detail: "The fixed deadline passed. Dispatch is blocked, but Pantheon still needs to seal expiry in the immutable lifecycle before the round is operationally closed.",
        metadata: { expiresAt: authority.expiresAt, latestEventType: latestEvent?.eventType || null },
      });
    }

    if (
      state.state === "activated"
      && ledger.assignments.length !== authority.assignments.length
    ) {
      addFinding(findings, {
        severity: "error",
        category: "preventure_authority",
        entityType: "preventure_research_authority",
        entityId: authority.authorityHash,
        title: "The activated research round is missing an exact assignment",
        detail: "Pantheon must have all three accepted assignments, and no extras, before any dedicated research dispatch can be trusted.",
        metadata: {
          expectedAssignments: authority.assignments.length,
          materializedAssignments: ledger.assignments.length,
        },
      });
    }

    const workRows = all(
      db,
      `SELECT assignments.assignment_hash, assignments.assignment_id,
              tasks.id AS task_id, tasks.status AS task_status,
              workflows.id AS workflow_id, workflows.status AS workflow_status,
              COUNT(CASE WHEN attempts.status = 'running' THEN 1 END) AS running_attempts,
              (SELECT COUNT(*) FROM model_calls
               WHERE model_calls.task_id = assignments.task_id
                 AND model_calls.status = 'dispatching') AS dispatching_model_calls,
              (SELECT COUNT(*) FROM model_calls
               WHERE model_calls.task_id = assignments.task_id
                 AND model_calls.status IN ('prepared', 'dispatching', 'running')) AS active_model_calls,
              (SELECT COUNT(*) FROM agent_runs
               WHERE agent_runs.task_id = assignments.task_id
                 AND agent_runs.status = 'running') AS active_agent_runs,
              (SELECT COUNT(*) FROM agent_tool_invocations
               WHERE agent_tool_invocations.task_id = assignments.task_id
                 AND agent_tool_invocations.status = 'running') AS active_tool_invocations
       FROM preventure_research_assignments AS assignments
       LEFT JOIN tasks ON tasks.id = assignments.task_id
       LEFT JOIN workflows ON workflows.id = assignments.workflow_id
       LEFT JOIN task_attempts AS attempts ON attempts.task_id = assignments.task_id
       WHERE assignments.authority_hash = ?
       GROUP BY assignments.assignment_hash, assignments.assignment_id,
                tasks.id, tasks.status, workflows.id, workflows.status`,
      [authority.authorityHash],
    );
    const activeWork = workRows.filter((row) => (
      row.task_status === "running"
      || Number(row.running_attempts || 0) > 0
      || Number(row.active_model_calls || 0) > 0
      || Number(row.active_agent_runs || 0) > 0
      || Number(row.active_tool_invocations || 0) > 0
    ));
    if ((persistedTerminal || state.expired || !state.dispatchAllowed) && activeWork.length > 0) {
      addFinding(findings, {
        severity: "error",
        category: "preventure_authority",
        entityType: "task",
        entityId: activeWork[0].task_id,
        title: "Research work is active outside its exact authority",
        detail: "Stop provider-capable work and preserve its outcome and cost. This authority is expired, terminal, or otherwise frozen.",
        metadata: {
          authorityHash: authority.authorityHash,
          activeTaskIds: activeWork.map((item) => item.task_id),
          dispatchingModelCallCount: activeWork.reduce(
            (count, item) => count + Number(item.dispatching_model_calls || 0),
            0,
          ),
          activeModelCallCount: activeWork.reduce(
            (count, item) => count + Number(item.active_model_calls || 0),
            0,
          ),
          activeAgentRunCount: activeWork.reduce(
            (count, item) => count + Number(item.active_agent_runs || 0),
            0,
          ),
          activeToolInvocationCount: activeWork.reduce(
            (count, item) => count + Number(item.active_tool_invocations || 0),
            0,
          ),
          lifecycleState: state.state,
        },
      });
    }

    const expectedPendingEvent = state.state === "proposed"
      ? "accepted"
      : state.state === "accepted" ? "activated" : null;
    const acceptanceScopeHash = preventureResearchApprovalScopeHash(authority, "accepted");
    const activationScopeHash = preventureResearchApprovalScopeHash(authority, "activated");
    const lifecycleApprovals = all(
      db,
      `SELECT id, venture_id, workflow_id, task_id, status, scope, title, risk_level,
              scope_hash, payload, expires_at, requested_by, decided_by, decided_at,
              consumed_at, expected_effects
       FROM approvals
       WHERE scope_hash IN (?, ?)
          OR json_extract(
            CASE WHEN json_valid(payload) THEN payload ELSE '{}' END,
            '$.preventureResearchApprovalScope.authority.hash'
          ) = ?
       ORDER BY requested_at, id`,
      [acceptanceScopeHash, activationScopeHash, authority.authorityHash],
    ).map((row) => ({ ...row, payload: fromJson(row.payload, {}) }));
    const pendingLifecycle = lifecycleApprovals.filter((row) => row.status === "pending");
    const exactScopeHash = expectedPendingEvent
      ? preventureResearchApprovalScopeHash(authority, expectedPendingEvent)
      : null;
    const exactPending = pendingLifecycle.filter((row) => (
      expectedPendingEvent
      && validatePendingPreventureLifecycleApproval(
        row,
        authority,
        expectedPendingEvent,
      ).valid
    ));
    if (
      (expectedPendingEvent && (pendingLifecycle.length !== 1 || exactPending.length !== 1))
      || (!expectedPendingEvent && pendingLifecycle.length > 0)
    ) {
      addFinding(findings, {
        severity: "error",
        category: "approval_integrity",
        entityType: "preventure_research_authority",
        entityId: authority.authorityHash,
        title: "The bounded research decision control is missing or ambiguous",
        detail: "Pantheon withheld lifecycle controls because the current authority does not have exactly one matching owner decision, or a stale decision remains open.",
        metadata: {
          lifecycleState: state.state,
          expectedPendingEvent,
          expectedScopeHash: exactScopeHash,
          pendingApprovalIds: pendingLifecycle.map((item) => item.id),
        },
      });
    }

    if (state.unknownProviderOutcomeCount > 0) {
      addFinding(findings, {
        severity: "error",
        category: "unknown_outcome",
        entityType: "preventure_research_authority",
        entityId: authority.authorityHash,
        title: "Bounded research has an unknown provider outcome",
        detail: "Do not retry or start another assignment until the retained provider result is reconciled and the immutable receipt chain is complete.",
        metadata: { unknownProviderOutcomeCount: state.unknownProviderOutcomeCount },
      });
    }
    if (readiness.budget.unknownCostCount > terminalRecoveries.length) {
      addFinding(findings, {
        severity: "error",
        category: "cost",
        entityType: "preventure_research_authority",
        entityId: authority.authorityHash,
        title: "Bounded research has an unknown cost",
        detail: "Pantheon froze further research until the possible charge is reconciled in both the authority ledger and the monthly budget ledger.",
        metadata: {
          unknownCostCount: readiness.budget.unknownCostCount,
          terminalCustodyUnknownCostCount: terminalRecoveries.length,
        },
      });
    }
    if (
      readiness.budget.exposureAudCents > readiness.budget.authorityCapAudCents
      || readiness.budget.exposureAudCents > readiness.budget.assignedCapAudCents
    ) {
      addFinding(findings, {
        severity: "error",
        category: "cost",
        entityType: "preventure_research_authority",
        entityId: authority.authorityHash,
        title: "Bounded research exposure exceeds its exact ceiling",
        detail: "Stop further dispatch. The retained authority-scoped exposure is above the A$2 authority or the lower total assignment cap.",
        metadata: readiness.budget,
      });
    }

    const costHeads = new Map();
    for (const event of ledger.costEvents) {
      const key = `${event.assignmentHash}\u0000${event.costKey}`;
      const prior = costHeads.get(key);
      if (!prior || Number(event.sequence || 0) > Number(prior.sequence || 0)) {
        costHeads.set(key, event);
      }
    }
    for (const costEvent of costHeads.values()) {
      const assignment = ledger.assignments.find(
        (item) => item.assignmentHash === costEvent.assignmentHash,
      );
      const reservation = costEvent.budgetReservationId
        ? get(db, "SELECT * FROM budget_reservations WHERE id = ?", [costEvent.budgetReservationId])
        : null;
      const settledCost = costEvent.costId
        ? get(db, "SELECT * FROM costs WHERE id = ?", [costEvent.costId])
        : null;
      const positiveExposure = Number(costEvent.exposureAudCents || 0) > 0;
      const costRowRequired = ["estimated", "incurred", "reconciled"].includes(
        costEvent.eventType,
      );
      const missingGenericBinding = (
        positiveExposure && !costEvent.budgetReservationId
      ) || (
        costRowRequired && !costEvent.costId
      );
      const reservationMismatch = costEvent.budgetReservationId && (
        !reservation
        || reservation.task_id !== assignment?.taskId
        || reservation.workflow_id !== assignment?.workflowId
        || reservation.venture_id !== null
        || reservation.currency !== "AUD"
        || (
          ["reserved", "unknown"].includes(costEvent.eventType)
          && Number(reservation.amount_cents) !== Number(costEvent.exposureAudCents)
        )
      );
      const settledMismatch = costEvent.costId && (
        !settledCost
        || settledCost.task_id !== assignment?.taskId
        || settledCost.workflow_id !== assignment?.workflowId
        || settledCost.venture_id !== null
        || settledCost.currency !== "AUD"
        || (
          costEvent.eventType === "reconciled"
          && Number(settledCost.amount_cents) !== Number(costEvent.amountAudCents)
        )
      );
      if (missingGenericBinding || reservationMismatch || settledMismatch) {
        addFinding(findings, {
          severity: "error",
          category: "cost",
          entityType: "preventure_research_assignment",
          entityId: costEvent.assignmentHash,
          title: "Bounded research cost disagrees with the monthly ledger",
          detail: "The authority-scoped cost receipt no longer matches its unowned Pantheon reservation or settled-cost record. Further dispatch must remain frozen.",
          metadata: {
            budgetReservationId: costEvent.budgetReservationId || null,
            costId: costEvent.costId || null,
            eventType: costEvent.eventType,
            exposureAudCents: costEvent.exposureAudCents,
            missingGenericBinding,
          },
        });
      }
    }

    for (const item of readiness.execution.items) {
      if (custodyIndex.assignmentHashes.has(item.assignmentHash)) continue;
      const taskStatus = workRows.find(
        (row) => row.assignment_hash === item.assignmentHash,
      )?.task_status || null;
      const terminalWithoutReceipt = ["completed", "failed", "needs_attention"].includes(taskStatus)
        && !item.complete;
      const stoppedAttemptWithoutReceipt = item.providerAttemptCount > 0
        && !item.complete
        && item.unresolvedAttempt !== true
        && item.unresolvedCall !== true;
      if (terminalWithoutReceipt || stoppedAttemptWithoutReceipt) {
        addFinding(findings, {
          severity: "error",
          category: "agent_receipts",
          entityType: "task",
          entityId: item.taskId,
          title: "A bounded research assignment lacks a complete immutable receipt",
          detail: "Pantheon cannot trust or reuse this assignment result until exactly one known terminal attempt is bound to a complete receipt and known cost.",
          metadata: {
            authorityHash: authority.authorityHash,
            assignmentId: item.assignmentId,
            taskStatus,
            receiptCount: item.receiptCount,
          },
        });
      }
    }

    if (readiness.evidence.orphanSourceCount || readiness.evidence.orphanEvidenceCount) {
      addFinding(findings, {
        severity: "error",
        category: "evidence_integrity",
        entityType: "preventure_research_authority",
        entityId: authority.authorityHash,
        title: "Bounded research contains evidence without a trusted assignment or source",
        detail: "Pantheon must not use orphaned source or evidence records in the final diligence recommendation.",
        metadata: {
          orphanSourceCount: readiness.evidence.orphanSourceCount,
          orphanEvidenceCount: readiness.evidence.orphanEvidenceCount,
        },
      });
    }
    if (shouldReportPreventureContraryEvidenceGap(ledger, readiness)) {
      addFinding(findings, {
        severity: "warn",
        category: "evidence_integrity",
        entityType: "preventure_research_authority",
        entityId: authority.authorityHash,
        title: "The disconfirming evidence pass is incomplete",
        detail: "All assignments finished, but one or more approved questions still lack contrary evidence. Pantheon may close the round conservatively but cannot recommend a build.",
        metadata: {
          missingQuestionIds: readiness.evidence.missingContraryQuestions,
        },
      });
    }
  }

  if (currentAuthorityCount > 1) {
    addFinding(findings, {
      severity: "error",
      category: "preventure_authority",
      entityType: "runtime",
      entityId: "preventure_research_current_authority",
      title: "More than one bounded research authority appears current",
      detail: "Pantheon will not choose between competing preparation-only authorities. Reconcile and close the extra record before any dispatch.",
      metadata: { currentAuthorityCount },
      fingerprintKey: "preventure_research_current_authority_ambiguous",
    });
  }
  const schedulerFinding = preventureResearchSchedulerFinding(
    schedulerJob,
    dispatchableAuthorityCount,
  );
  if (schedulerFinding) addFinding(findings, schedulerFinding);
  return custodyIndex;
}

function collectFindings(db, options = {}) {
  const findings = [];
  const completedRetryPredecessors = supersededRetryTaskIds(db);
  const staleTaskCutoff = minutesAgo(Number(options.staleTaskMinutes || 30));
  const staleRunCutoff = minutesAgo(Number(options.staleRunMinutes || 30));
  const staleQueuedCutoff = minutesAgo(Number(options.staleQueuedMinutes || 24 * 60));

  collectRuntimeOversightFindings(db, findings, options);
  const verifiedTerminalCustody = collectPreventureResearchFindings(db, findings, options);

  const pendingApprovals = all(
    db,
    `SELECT id, workflow_id, task_id, title, risk_level
     FROM approvals
     WHERE status = 'pending'
     ORDER BY requested_at ASC`,
  ).filter((approval) => keepActionableRecord(db, approval, {
    entityType: "approval",
    entityId: approval.id,
  }));
  const pendingApprovalIds = new Set(pendingApprovals.map((approval) => approval.id));
  if (pendingApprovals.length > 0) {
    addFinding(findings, {
      severity: "warn",
      category: "approvals",
      entityType: "approval",
      entityId: pendingApprovals[0].id,
      title: `${pendingApprovals.length} approval${pendingApprovals.length === 1 ? "" : "s"} pending`,
      detail: "Operator approval is required before blocked work can continue.",
      metadata: { approvals: pendingApprovals },
      fingerprintKey: "pending_approvals",
    });
  }

  const expiredApprovals = all(
    db,
    `SELECT id, workflow_id, task_id, title, expires_at
     FROM approvals
     WHERE status = 'pending'
       AND expires_at IS NOT NULL
       AND expires_at <= ?
     ORDER BY expires_at ASC`,
    [options.at || now()],
  ).filter((approval) => keepActionableRecord(db, approval, {
    entityType: "approval",
    entityId: approval.id,
  }));
  for (const approval of expiredApprovals) {
    addFinding(findings, {
      severity: "warn",
      category: "approval_integrity",
      entityType: "approval",
      entityId: approval.id,
      title: `Decision expired: ${approval.title}`,
      detail: "This approval can no longer start work. Prepare a fresh exact decision if the action is still justified.",
      metadata: { expiresAt: approval.expires_at },
    });
  }

  const continuedAfterDenial = all(
    db,
    `SELECT approvals.id AS approval_id, approvals.title, approvals.decided_at,
            tasks.id AS task_id, tasks.workflow_id, tasks.title AS task_title,
            tasks.status, tasks.updated_at
     FROM approvals
     JOIN tasks ON tasks.approval_id = approvals.id
     WHERE approvals.status IN ('rejected', 'needs_changes')
       AND tasks.status IN ('running', 'completed')
       AND approvals.decided_at IS NOT NULL
       AND tasks.updated_at >= approvals.decided_at
     ORDER BY tasks.updated_at DESC`,
  );
  for (const item of continuedAfterDenial) {
    addFinding(findings, {
      severity: "error",
      category: "approval_integrity",
      entityType: "task",
      entityId: item.task_id,
      title: `Work continued after a stop decision: ${item.task_title}`,
      detail: "The linked decision was declined or sent back for changes, but the work record later shows execution.",
      metadata: {
        approvalId: item.approval_id,
        approvalTitle: item.title,
        decidedAt: item.decided_at,
        taskStatus: item.status,
      },
    });
  }

  const openEscalations = all(
    db,
    `SELECT id, task_id, subject, severity, metadata
     FROM messages
     WHERE status = 'open'
       AND severity IN ('urgent', 'approval')
       AND NOT (
         json_extract(metadata, '$.source') = 'runtime_monitor'
         OR (
           json_extract(metadata, '$.source') IS NULL
           AND subject LIKE 'Runtime monitor:%'
         )
       )
     ORDER BY created_at ASC`,
  ).filter((message) => keepActionableRecord(db, message, {
    entityType: "message",
    entityId: message.id,
  })).filter((message) => {
    if (message.severity !== "approval") return true;
    const linkedApprovalId = fromJson(message.metadata, {}).approvalId;
    return !linkedApprovalId || !pendingApprovalIds.has(linkedApprovalId);
  });
  if (openEscalations.length > 0) {
    addFinding(findings, {
      severity: openEscalations.some((message) => message.severity === "urgent") ? "error" : "warn",
      category: "messages",
      entityType: "message",
      entityId: openEscalations[0].id,
      title: `${openEscalations.length} open escalation${openEscalations.length === 1 ? "" : "s"}`,
      detail: "Open urgent or approval messages need operator attention.",
      metadata: { messages: openEscalations },
      fingerprintKey: "open_escalations",
    });
  }

  const staleQueuedTasks = all(
    db,
    `SELECT id, title, workflow_id, status, updated_at
     FROM tasks
     WHERE status IN ('planned', 'queued')
       AND updated_at < ?
     ORDER BY updated_at ASC
     LIMIT 25`,
    [staleQueuedCutoff],
  ).filter((task) => keepActionableRecord(db, task, {
    entityType: "task",
    entityId: task.id,
  }));
  for (const task of staleQueuedTasks) {
    addFinding(findings, {
      severity: "warn",
      category: "queue",
      entityType: "task",
      entityId: task.id,
      title: `Queued work has not moved: ${task.title}`,
      detail: "This work has stayed ready or planned beyond its expected window. Confirm it is still the right next step or stop it.",
      metadata: {
        workflowId: task.workflow_id,
        status: task.status,
        updatedAt: task.updated_at,
        staleQueuedMinutes: Number(options.staleQueuedMinutes || 24 * 60),
      },
    });
  }

  const staleTasks = all(
    db,
    "SELECT id, title, workflow_id, updated_at FROM tasks WHERE status = 'running' AND updated_at < ? ORDER BY updated_at ASC",
    [staleTaskCutoff],
  ).filter((task) => keepActionableRecord(db, task, {
    entityType: "task",
    entityId: task.id,
  }));
  for (const task of staleTasks) {
    addFinding(findings, {
      severity: "error",
      category: "tasks",
      entityType: "task",
      entityId: task.id,
      title: `Task may be stuck: ${task.title}`,
      detail: `Task has been running since ${task.updated_at}.`,
      metadata: { workflowId: task.workflow_id, staleTaskCutoff },
    });
  }

  const failedTasks = all(
    db,
    `SELECT tasks.id, tasks.title, tasks.workflow_id, tasks.error
     FROM tasks
     WHERE tasks.status = 'failed'
       AND NOT (
         tasks.outcome_status = 'known_provider_result_needs_review'
         AND EXISTS (
           SELECT 1 FROM events
           WHERE events.type = 'task.reviewed_failure_closed_for_retry'
             AND events.entity_id = tasks.id
         )
         AND NOT EXISTS (
           SELECT 1 FROM messages
           WHERE messages.task_id = tasks.id AND messages.status = 'open'
         )
       )
       AND NOT (
         tasks.outcome_status = 'known'
         AND EXISTS (
           SELECT 1 FROM costs
           WHERE costs.workflow_id = tasks.workflow_id AND costs.status = 'reconciled'
         )
         AND EXISTS (
           SELECT 1 FROM events
           WHERE events.type = 'provider_usage.task_reconciled'
             AND events.entity_id = tasks.id
         )
         AND NOT EXISTS (
           SELECT 1 FROM messages
           WHERE messages.task_id = tasks.id AND messages.status = 'open'
         )
       )
     ORDER BY tasks.updated_at DESC LIMIT 10`,
  ).filter((task) => (
    !completedRetryPredecessors.has(task.id)
    && keepActionableRecord(db, task, {
      entityType: "task",
      entityId: task.id,
    })
  ));
  if (failedTasks.length > 0) {
    addFinding(findings, {
      severity: "error",
      category: "tasks",
      entityType: "task",
      entityId: failedTasks[0].id,
      title: `${failedTasks.length} failed task${failedTasks.length === 1 ? "" : "s"}`,
      detail: "Failed tasks require recovery or operator review before this workflow can be trusted.",
      metadata: { failedTasks },
      fingerprintKey: "failed_tasks",
    });
  }

  const unknownAttempts = all(
    db,
    `SELECT attempts.id, attempts.task_id, attempts.provider_request_id,
            attempts.completed_at, tasks.title
     FROM task_attempts AS attempts
     LEFT JOIN tasks ON tasks.id = attempts.task_id
     WHERE attempts.outcome_status = 'unknown'
     ORDER BY attempts.completed_at DESC`,
  ).filter((attempt) => !verifiedTerminalCustody.attemptIds.has(attempt.id));
  for (const attempt of unknownAttempts) {
    addFinding(findings, {
      severity: "error",
      category: "unknown_outcome",
      entityType: "task_attempt",
      entityId: attempt.id,
      title: `Provider outcome is unknown: ${attempt.title || attempt.task_id}`,
      detail: "Do not retry this work until the provider outcome and any cost are reconciled.",
      metadata: {
        taskId: attempt.task_id,
        providerRequestId: attempt.provider_request_id,
        completedAt: attempt.completed_at,
      },
    });
  }

  const unsafeRetries = all(
    db,
    `SELECT earlier.id AS unknown_attempt_id, later.id AS later_attempt_id,
            earlier.task_id, tasks.title, later.started_at
     FROM task_attempts AS earlier
     JOIN task_attempts AS later
       ON later.task_id = earlier.task_id
      AND later.started_at > COALESCE(earlier.completed_at, earlier.started_at)
     LEFT JOIN tasks ON tasks.id = earlier.task_id
     WHERE earlier.outcome_status = 'unknown'
     ORDER BY later.started_at DESC`,
  );
  for (const retry of unsafeRetries) {
    addFinding(findings, {
      severity: "error",
      category: "unsafe_retry",
      entityType: "task_attempt",
      entityId: retry.later_attempt_id,
      title: `Work restarted before an unknown outcome was resolved: ${retry.title || retry.task_id}`,
      detail: "A later attempt exists after a provider outcome became unknown. Stop further execution and reconcile both attempts.",
      metadata: {
        taskId: retry.task_id,
        unknownAttemptId: retry.unknown_attempt_id,
        laterAttemptId: retry.later_attempt_id,
        laterStartedAt: retry.started_at,
      },
    });
  }

  const staleWorkflowRuns = all(
    db,
    "SELECT id, workflow_id, started_at FROM workflow_runs WHERE status = 'running' AND started_at < ? ORDER BY started_at ASC",
    [staleRunCutoff],
  ).filter((workflowRun) => keepActionableRecord(db, workflowRun, {
    entityType: "workflow_run",
    entityId: workflowRun.id,
  }));
  for (const workflowRun of staleWorkflowRuns) {
    addFinding(findings, {
      severity: "error",
      category: "workflow_runs",
      entityType: "workflow_run",
      entityId: workflowRun.id,
      title: "Workflow run may be stuck",
      detail: `Safe-loop run started at ${workflowRun.started_at} and has not completed.`,
      metadata: { workflowId: workflowRun.workflow_id, staleRunCutoff },
    });
  }

  const staleAgentRuns = all(
    db,
    `SELECT runs.id, runs.agent_id, runs.task_id, runs.workflow_id,
            runs.started_at, tasks.title
     FROM agent_runs AS runs
     LEFT JOIN tasks ON tasks.id = runs.task_id
     WHERE runs.status = 'running' AND runs.started_at < ?
     ORDER BY runs.started_at ASC`,
    [staleRunCutoff],
  ).filter((agentRun) => keepActionableRecord(db, agentRun, {
    entityType: "agent_run",
    entityId: agentRun.id,
  }));
  for (const agentRun of staleAgentRuns) {
    addFinding(findings, {
      severity: "error",
      category: "agent_runs",
      entityType: "agent_run",
      entityId: agentRun.id,
      title: `AI work may be stuck: ${agentRun.title || agentRun.agent_id}`,
      detail: "The worker has not recorded progress within the expected window. Pantheon will not assume the provider call is safe to repeat.",
      metadata: { taskId: agentRun.task_id, startedAt: agentRun.started_at, staleRunCutoff },
    });
  }

  const incompleteReceipts = all(
    db,
    `SELECT receipts.id, receipts.run_id, receipts.task_id, receipts.status,
            receipts.missing_fields, receipts.warnings, tasks.title
     FROM agent_run_receipts AS receipts
     LEFT JOIN tasks ON tasks.id = receipts.task_id
     WHERE NOT EXISTS (
       SELECT 1 FROM agent_run_receipts AS later
       WHERE later.attempt_id = receipts.attempt_id
         AND later.sequence > receipts.sequence
     )
       AND receipts.status IN ('needs_review', 'incomplete')
     ORDER BY receipts.created_at DESC
     LIMIT 50`,
  );
  for (const receipt of incompleteReceipts) {
    if (verifiedTerminalCustody.receiptIds.has(receipt.id)) continue;
    if (receipt.status === "needs_review" && completedRetryPredecessors.has(receipt.task_id)) continue;
    const missingFields = fromJson(receipt.missing_fields, []);
    const warnings = fromJson(receipt.warnings, []);
    addFinding(findings, {
      severity: receipt.status === "incomplete" ? "error" : "warn",
      category: "agent_receipts",
      entityType: "agent_run",
      entityId: receipt.run_id,
      title: receipt.status === "incomplete"
        ? `Execution record incomplete: ${receipt.title || receipt.task_id}`
        : `Execution needs review: ${receipt.title || receipt.task_id}`,
      detail: [...missingFields, ...warnings].join(" ") || "The immutable execution receipt needs developer or operator review.",
      metadata: { receiptId: receipt.id, taskId: receipt.task_id, missingFields, warnings },
    });
  }

  const missingReceipts = all(
    db,
    `SELECT runs.id, runs.task_id, runs.completed_at, tasks.title
     FROM agent_runs AS runs
     LEFT JOIN tasks ON tasks.id = runs.task_id
     WHERE runs.completed_at IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM agent_run_receipts WHERE run_id = runs.id)
     ORDER BY runs.completed_at DESC
     LIMIT 50`,
  );
  for (const agentRun of missingReceipts) {
    if (verifiedTerminalCustody.runIds.has(agentRun.id)) continue;
    addFinding(findings, {
      severity: "error",
      category: "agent_receipts",
      entityType: "agent_run",
      entityId: agentRun.id,
      title: `Execution record missing: ${agentRun.title || agentRun.task_id}`,
      detail: "The AI worker finished without an immutable local receipt. This run must be audited before its result is trusted.",
      metadata: { taskId: agentRun.task_id, completedAt: agentRun.completed_at },
    });
  }

  const receiptVerification = verifyAgentRunReceiptChain(db);
  if (!receiptVerification.ok) {
    addFinding(findings, {
      severity: "error",
      category: "agent_receipts",
      entityType: "runtime",
      entityId: "receipt_chain",
      title: "Execution receipt verification failed",
      detail: `${receiptVerification.failures.length} receipt integrity check${receiptVerification.failures.length === 1 ? "" : "s"} failed.`,
      metadata: receiptVerification,
    });
  }

  collectQualityReviewFindings(db, findings);
  collectAgentContextFindings(db, findings);
  collectChiefAssignmentFindings(db, findings);

  const budgetCents = monthlyCapCents(db);
  const budgetExposure = monthlyBudgetExposure(db);
  const spendCents = budgetExposure.totalCents;
  if (spendCents > budgetCents) {
    addFinding(findings, {
      severity: "error",
      category: "budget",
      entityType: "budget",
      entityId: "monthly",
      title: "Monthly budget exceeded",
      detail: `${spendCents} cents spent against ${budgetCents} cents budget.`,
      metadata: {
        spendCents,
        realizedCents: budgetExposure.realizedCents,
        unresolvedCents: budgetExposure.unresolvedCents,
        budgetCents,
        currency: CONFIG.currency,
      },
      fingerprintKey: "monthly_budget",
    });
  }

  const unknownCosts = all(
    db,
    `SELECT id, task_id, workflow_id, amount_cents, currency, occurred_at
     FROM costs
     WHERE status = 'unknown'
     ORDER BY occurred_at ASC`,
  ).filter((cost) => !verifiedTerminalCustody.costIds.has(cost.id));
  const unknownReservations = all(
    db,
    `SELECT id, task_id, workflow_id, amount_cents, currency, reserved_at
     FROM budget_reservations
     WHERE status = 'unknown'
     ORDER BY reserved_at ASC`,
  ).filter((reservation) => !verifiedTerminalCustody.reservationIds.has(reservation.id));
  if (unknownCosts.length || unknownReservations.length) {
    addFinding(findings, {
      severity: "error",
      category: "cost",
      entityType: "budget",
      entityId: "unknown_costs",
      title: "Provider cost needs reconciliation",
      detail: "At least one provider attempt has an unknown charge. Reconcile it before approving more spend for the same work.",
      metadata: { costs: unknownCosts, reservations: unknownReservations },
      fingerprintKey: "unknown_costs",
    });
  }

  const staleReservedCutoff = minutesAgo(Number(options.staleReservationMinutes || 60));
  const staleReservations = all(
    db,
    `SELECT reservations.id, reservations.task_id, reservations.amount_cents,
            reservations.currency, reservations.reserved_at, tasks.title, tasks.status AS task_status
     FROM budget_reservations AS reservations
     LEFT JOIN tasks ON tasks.id = reservations.task_id
     WHERE reservations.status = 'reserved'
       AND reservations.reserved_at < ?
       AND COALESCE(tasks.status, '') <> 'running'
     ORDER BY reservations.reserved_at ASC`,
    [staleReservedCutoff],
  );
  for (const reservation of staleReservations) {
    addFinding(findings, {
      severity: "warn",
      category: "cost",
      entityType: "budget_reservation",
      entityId: reservation.id,
      title: `Unused budget is still reserved: ${reservation.title || reservation.task_id}`,
      detail: "The work is not running, but its budget remains held. Release or reconcile the reservation.",
      metadata: reservation,
    });
  }

  const coreConnections = all(
    db,
    "SELECT id, name, status, health FROM integrations WHERE id IN ('ai_workers', 'live_research', 'digital_products') ORDER BY id",
  );
  const notReady = coreConnections.filter((integration) => !["ok", "dry_run_only"].includes(integration.health));
  if (notReady.length > 0) {
    addFinding(findings, {
      severity: "info",
      category: "integrations",
      entityType: "integration",
      entityId: notReady[0].id,
      title: `${notReady.length} core connection${notReady.length === 1 ? " needs" : "s need"} setup`,
      detail: "AI work, live research, or digital-product preparation is unavailable until the listed connection is ready.",
      metadata: { integrations: notReady },
    });
  }

  return findings
    .filter((finding) => keepActionableFinding(db, finding))
    .sort((a, b) => severityRank(b.severity) - severityRank(a.severity));
}

function persistFindings(db, runId, findings) {
  const ts = now();
  const activeFingerprints = [];
  for (const finding of findings) {
    const fingerprint = findingFingerprint(finding);
    activeFingerprints.push(fingerprint);
    run(
      db,
      `INSERT INTO monitor_findings
       (id, run_id, severity, category, entity_type, entity_id, title, detail, status, metadata,
        created_at, fingerprint, first_seen, last_seen, occurrence_count, resolved_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, NULL)
       ON CONFLICT(fingerprint) WHERE fingerprint IS NOT NULL DO UPDATE SET
         run_id = excluded.run_id,
         severity = excluded.severity,
         title = excluded.title,
         detail = excluded.detail,
         status = 'open',
         metadata = excluded.metadata,
         last_seen = excluded.last_seen,
         occurrence_count = monitor_findings.occurrence_count + 1,
         resolved_at = NULL`,
      [
        `finding_${randomId()}`,
        runId,
        finding.severity,
        finding.category,
        finding.entityType,
        finding.entityId,
        finding.title,
        finding.detail,
        "open",
        toJson(finding.metadata),
        ts,
        fingerprint,
        ts,
        ts,
      ],
    );
  }
  if (activeFingerprints.length) {
    const placeholders = activeFingerprints.map(() => "?").join(", ");
    run(
      db,
      `UPDATE monitor_findings SET status = 'resolved', resolved_at = ?
       WHERE status = 'open' AND fingerprint IS NOT NULL AND fingerprint NOT IN (${placeholders})`,
      [ts, ...activeFingerprints],
    );
  } else {
    run(db, "UPDATE monitor_findings SET status = 'resolved', resolved_at = ? WHERE status = 'open'", [ts]);
  }
}

function escalateCriticalFindings(db, runId, findings) {
  const criticalFindings = findings.filter((item) => item.severity === "error" && item.category !== "messages");
  const activeFingerprints = criticalFindings.map(findingFingerprint);
  const resolvedAt = now();
  run(
    db,
    `UPDATE messages SET status = 'resolved', resolved_at = ?
     WHERE status = 'open'
       AND json_extract(metadata, '$.source') IS NULL
       AND subject LIKE 'Runtime monitor:%'`,
    [resolvedAt],
  );
  if (activeFingerprints.length) {
    const placeholders = activeFingerprints.map(() => "?").join(", ");
    run(
      db,
      `UPDATE messages SET status = 'resolved', resolved_at = ?
       WHERE status = 'open'
         AND json_extract(metadata, '$.source') = 'runtime_monitor'
         AND json_extract(metadata, '$.monitorFingerprint') NOT IN (${placeholders})`,
      [resolvedAt, ...activeFingerprints],
    );
  } else {
    run(
      db,
      `UPDATE messages SET status = 'resolved', resolved_at = ?
       WHERE status = 'open'
         AND (
           json_extract(metadata, '$.source') = 'runtime_monitor'
           OR (
             json_extract(metadata, '$.source') IS NULL
             AND subject LIKE 'Runtime monitor:%'
           )
         )`,
      [resolvedAt],
    );
  }

  for (const finding of criticalFindings) {
    const monitorFingerprint = findingFingerprint(finding);
    const subject = `Runtime monitor: ${finding.title}`;
    const existing = get(
      db,
      `SELECT id FROM messages
       WHERE status = 'open'
         AND (
           (
             json_extract(metadata, '$.source') = 'runtime_monitor'
             AND json_extract(metadata, '$.monitorFingerprint') = ?
           )
           OR (
             json_extract(metadata, '$.source') IS NULL
             AND subject = ?
           )
         )
       ORDER BY created_at DESC LIMIT 1`,
      [monitorFingerprint, subject],
    );
    if (existing) continue;
    run(
      db,
      `INSERT INTO messages (id, severity, status, subject, body, created_at, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        `msg_monitor_${randomId()}`,
        "urgent",
        "open",
        subject,
        finding.detail || "Runtime monitor found a critical issue.",
        now(),
        toJson({
          source: "runtime_monitor",
          monitorFingerprint,
          runId,
          category: finding.category,
          entityType: finding.entityType,
          entityId: finding.entityId,
        }),
      ],
    );
  }
}

function runMonitorCycle(db, options = {}) {
  const startedAt = now();
  const runId = `monitor_${randomId()}`;
  const persistedOptions = { ...options };
  delete persistedOptions.preventureResearchAuthorityRegistry;
  delete persistedOptions.preventureResearchClock;
  delete persistedOptions.preventureResearchRetainedOutputStore;
  run(
    db,
    `INSERT INTO monitor_runs (id, status, severity, finding_count, started_at, metadata)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [runId, "running", "info", 0, startedAt, toJson({ options: persistedOptions })],
  );

  const integrationResult = refreshIntegrationHealth(db);
  const receiptAudit = auditTerminalAgentAttempts(db);
  const findings = collectFindings(db, options);
  const severity = summarizeSeverity(findings);
  const status = monitorStatus(severity);
  persistFindings(db, runId, findings);
  escalateCriticalFindings(db, runId, findings);
  const completedAt = now();
  const categoryCounts = findings.reduce((counts, finding) => {
    counts[finding.category] = (counts[finding.category] || 0) + 1;
    return counts;
  }, {});

  run(
    db,
    `UPDATE monitor_runs
     SET status = ?, severity = ?, finding_count = ?, completed_at = ?, metadata = ?
     WHERE id = ?`,
    [
      status,
      severity,
      findings.length,
      completedAt,
      toJson({
        integrationResult,
        receiptAuditCount: receiptAudit.length,
        categoryCounts,
        options: persistedOptions,
      }),
      runId,
    ],
  );

  insertEvent(db, {
    level: severity === "error" ? "error" : severity === "warn" ? "warn" : "info",
    actor: "runtime-monitor",
    type: "monitor.completed",
    entityType: "monitor_run",
    entityId: runId,
    message: `Runtime monitor completed with status ${status} and ${findings.length} finding${findings.length === 1 ? "" : "s"}.`,
    metadata: { severity, status, findingCount: findings.length, receiptAuditCount: receiptAudit.length, categoryCounts },
  });

  return {
    id: runId,
    status,
    severity,
    findingCount: findings.length,
    startedAt,
    completedAt,
    findings,
  };
}

function latestMonitorRun(db) {
  const row = get(db, "SELECT * FROM monitor_runs ORDER BY started_at DESC LIMIT 1");
  return parseMetadata(row);
}

module.exports = {
  collectFindings,
  collectPreventureResearchFindings,
  latestMonitorRun,
  preventureResearchSchedulerFinding,
  runMonitorCycle,
  shouldReportPreventureContraryEvidenceGap,
  supersededRetryTaskIds,
};
