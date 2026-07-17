const CONFIG = require("../config");
const { all, fromJson, get, insertEvent, now, randomId, run, toJson } = require("../db");

const REALIZED_COST_STATUSES = new Set(["actual", "completed", "incurred", "paid", "reconciled", "recorded", "spent"]);
const UNRESOLVED_COST_STATUSES = new Set(["incurred_estimate", "unknown"]);
const UNRESOLVED_RESERVATION_STATUSES = new Set(["reserved", "incurred_estimate", "unknown"]);

function monthlyCapCents(db) {
  const setting = get(db, "SELECT value FROM settings WHERE key = 'budget'");
  return Number(fromJson(setting?.value, {}).monthlyBudgetCents || CONFIG.monthlyBudgetCents);
}

function reservedThisMonth(db) {
  const month = new Date().toISOString().slice(0, 7);
  return Number(get(
    db,
    `SELECT COALESCE(SUM(amount_cents), 0) AS cents
     FROM budget_reservations
     WHERE substr(reserved_at, 1, 7) = ? AND status IN ('reserved', 'incurred_estimate', 'unknown')`,
    [month],
  )?.cents || 0);
}

function monthlyBudgetExposure(db, options = {}) {
  const month = String(options.month || new Date().toISOString().slice(0, 7));
  const costs = all(
    db,
    "SELECT * FROM costs WHERE substr(occurred_at, 1, 7) = ? ORDER BY occurred_at, id",
    [month],
  );
  const reservations = all(
    db,
    "SELECT * FROM budget_reservations WHERE substr(reserved_at, 1, 7) = ? ORDER BY reserved_at, id",
    [month],
  );
  const taskRows = all(db, "SELECT id, payload FROM tasks");
  const modelCalls = all(db, "SELECT id, task_id FROM model_calls");
  const tasks = new Map(taskRows.map((row) => [row.id, fromJson(row.payload, {}) ]));
  const modelCallTasks = new Map(modelCalls.map((row) => [row.id, row.task_id]));
  const reservationByApproval = new Map(reservations.filter((row) => row.approval_id).map((row) => [row.approval_id, row]));
  const costByApproval = new Map();
  for (const row of costs) {
    const metadata = fromJson(row.metadata, {});
    if (metadata.approvalId) costByApproval.set(metadata.approvalId, row);
  }

  const groups = new Map();
  function add(groupKey, entry) {
    const group = groups.get(groupKey) || { key: groupKey, realizedCents: 0, unresolvedCents: 0, entries: [] };
    if (entry.kind === "realized") group.realizedCents = Math.max(group.realizedCents, entry.amountCents);
    else group.unresolvedCents = Math.max(group.unresolvedCents, entry.amountCents);
    group.entries.push(entry);
    groups.set(groupKey, group);
  }
  function assertAud(row, dateField) {
    if (row.currency !== CONFIG.currency) {
      throw new Error(`Monthly budget exposure cannot use unconverted ${row.currency || "unknown"} at ${row[dateField]}.`);
    }
  }
  function requestSource(taskId, fallback) {
    const request = tasks.get(taskId)?.liveSpendRequest || {};
    return String(request.provider || request.source || fallback || "unspecified");
  }

  for (const row of costs) {
    if (!REALIZED_COST_STATUSES.has(row.status) && !UNRESOLVED_COST_STATUSES.has(row.status)) continue;
    assertAud(row, "occurred_at");
    const metadata = fromJson(row.metadata, {});
    const taskId = row.task_id
      || metadata.taskId
      || modelCallTasks.get(row.model_call_id)
      || modelCallTasks.get(metadata.modelCallId)
      || reservationByApproval.get(metadata.approvalId)?.task_id
      || null;
    const source = String(row.source || requestSource(taskId, row.category));
    const key = taskId ? `task:${taskId}|source:${source}` : `cost:${row.id}|source:${source}`;
    add(key, {
      kind: REALIZED_COST_STATUSES.has(row.status) ? "realized" : "unresolved",
      sourceType: "cost",
      id: row.id,
      taskId,
      source,
      status: row.status,
      amountCents: Math.max(0, Number(row.amount_cents || 0)),
    });
  }

  for (const row of reservations) {
    if (!UNRESOLVED_RESERVATION_STATUSES.has(row.status)) continue;
    assertAud(row, "reserved_at");
    const metadata = fromJson(row.metadata, {});
    const approvalCost = row.approval_id ? costByApproval.get(row.approval_id) : null;
    const source = String(metadata.source || approvalCost?.source || requestSource(row.task_id, "budget_reservation"));
    add(`task:${row.task_id}|source:${source}`, {
      kind: "unresolved",
      sourceType: "reservation",
      id: row.id,
      taskId: row.task_id,
      source,
      status: row.status,
      amountCents: Math.max(0, Number(row.amount_cents || 0)),
    });
  }

  const exposureGroups = [...groups.values()].map((group) => ({
    ...group,
    amountCents: group.realizedCents > 0 ? group.realizedCents : group.unresolvedCents,
    countedAs: group.realizedCents > 0 ? "realized" : "unresolved",
  }));
  return {
    month,
    currency: CONFIG.currency,
    totalCents: exposureGroups.reduce((sum, group) => sum + group.amountCents, 0),
    realizedCents: exposureGroups.reduce((sum, group) => sum + group.realizedCents, 0),
    unresolvedCents: exposureGroups.reduce((sum, group) => sum + (group.realizedCents > 0 ? 0 : group.unresolvedCents), 0),
    groups: exposureGroups,
  };
}

function reserveBudget(db, task, approval, amountCents) {
  const amount = Math.max(0, Number(amountCents || 0));
  const id = `reserve_${randomId()}`;
  const reservedAt = now();
  let reservationId = id;
  db.exec("BEGIN IMMEDIATE");
  try {
    const existing = get(
      db,
      "SELECT * FROM budget_reservations WHERE task_id = ? AND status IN ('reserved', 'incurred_estimate', 'unknown') ORDER BY reserved_at DESC LIMIT 1",
      [task.id],
    );
    if (existing) {
      reservationId = existing.id;
      db.exec("COMMIT");
      return existing;
    }
    const committed = monthlyBudgetExposure(db).totalCents;
    const cap = monthlyCapCents(db);
    if (amount > Number(task.cost_budget_cents || amount)) {
      throw new Error("Requested cost exceeds the task budget.");
    }
    if (committed + amount > cap) {
      throw new Error(`This request would exceed the monthly pre-revenue cap of ${cap} cents.`);
    }
    const request = typeof task.payload === "string" ? fromJson(task.payload, {})?.liveSpendRequest : task.payload?.liveSpendRequest;
    run(
      db,
      `INSERT INTO budget_reservations
       (id, venture_id, workflow_id, task_id, approval_id, status, amount_cents, currency, reserved_at, metadata)
       VALUES (?, ?, ?, ?, ?, 'reserved', ?, ?, ?, ?)`,
      [
        id,
        task.venture_id,
        task.workflow_id,
        task.id,
        approval?.id || null,
        amount,
        CONFIG.currency,
        reservedAt,
        toJson({
          taskId: task.id,
          source: request?.provider || request?.type || "paid_ai",
          scopeHash: approval?.scope_hash || null,
          executionDescriptorHash: request?.executionDescriptor?.descriptorHash || null,
        }),
      ],
    );
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return get(db, "SELECT * FROM budget_reservations WHERE id = ?", [reservationId]);
}

function resolveReservation(db, taskId, status, options = {}) {
  const allowed = new Set(["released", "incurred_estimate", "unknown", "reconciled"]);
  if (!allowed.has(status)) throw new Error(`Unsupported reservation status: ${status}`);
  const reservation = get(
    db,
    "SELECT * FROM budget_reservations WHERE task_id = ? AND status IN ('reserved', 'incurred_estimate', 'unknown') ORDER BY reserved_at DESC LIMIT 1",
    [taskId],
  );
  if (!reservation) return null;
  const amount = options.amountCents === undefined ? reservation.amount_cents : Math.max(0, Number(options.amountCents));
  const resolvedAt = ["released", "reconciled"].includes(status) ? now() : null;
  run(
    db,
    `UPDATE budget_reservations SET status = ?, amount_cents = ?, resolved_at = ?, metadata = ? WHERE id = ?`,
    [status, amount, resolvedAt, toJson({ ...fromJson(reservation.metadata), ...options.metadata }), reservation.id],
  );
  return get(db, "SELECT * FROM budget_reservations WHERE id = ?", [reservation.id]);
}

function providerTraceId(allocation = {}) {
  const traceId = String(allocation.agentSdkTraceId || "").trim();
  if (traceId && !/^trace_[A-Za-z0-9_-]+$/.test(traceId)) {
    throw new Error("Provider trace IDs must use the OpenAI trace_ format.");
  }
  return traceId || null;
}

function persistAgentSdkTrace(db, task, traceId, evidence) {
  if (!traceId) return;
  const agentRun = get(db, "SELECT * FROM agent_runs WHERE task_id = ? ORDER BY started_at DESC LIMIT 1", [task.id]);
  if (agentRun) {
    run(
      db,
      "UPDATE agent_runs SET metadata = ? WHERE id = ?",
      [
        toJson({
          ...fromJson(agentRun.metadata, {}),
          agentSdkTraceId: traceId,
          agentSdkTraceEvidence: evidence,
        }),
        agentRun.id,
      ],
    );
    run(db, "UPDATE agent_pilot_reviews SET trace_id = ? WHERE run_id = ?", [traceId, agentRun.id]);
  }
}

function reconciledTaskResult(rawResult, amountCents, reconciliation) {
  const result = fromJson(rawResult, {});
  if (result.cost) {
    result.cost.actualCents = amountCents;
    result.cost.reconciledCents = amountCents;
    result.cost.costStatus = "reconciled";
    result.cost.exactBillingPending = false;
  }
  if (result.modelPolicy) {
    result.modelPolicy.actualCostCents = amountCents;
    result.modelPolicy.reconciledCostCents = amountCents;
    result.modelPolicy.costStatus = "reconciled";
    result.modelPolicy.exactBillingPending = false;
  }
  if (result.pilotReview) result.pilotReview.reconciled_cost_cents = amountCents;
  if (reconciliation.agentSdkTraceId) {
    result.providerTrace = {
      id: reconciliation.agentSdkTraceId,
      source: reconciliation.evidence?.source || "provider_evidence",
      responseId: reconciliation.responseId || null,
    };
  }
  result.costReconciliation = reconciliation;
  return result;
}

function reconcileProviderUsageBatch(db, input = {}) {
  const allocations = Array.isArray(input.allocations) ? input.allocations : [];
  if (!allocations.length) throw new Error("Provider reconciliation needs at least one exact task allocation.");
  const ventureId = String(input.ventureId || "").trim();
  const provider = String(input.provider || "").trim();
  const evidence = input.evidence && typeof input.evidence === "object" ? input.evidence : {};
  const totalAudCents = Number(input.totalAudCents);
  if (!ventureId || !provider || !evidence.source) {
    throw new Error("Provider reconciliation needs a venture, provider and evidence source.");
  }
  if (!Number.isInteger(totalAudCents) || totalAudCents < 0) {
    throw new Error("Provider reconciliation total must be a non-negative whole number of AUD cents.");
  }
  const taskIds = new Set();
  const allowedTaskStatuses = new Set(["completed", "failed", "needs_attention"]);
  const allowedWorkflowStatuses = new Set(["completed", "failed", "needs_attention"]);
  const allowedOutcomeStatuses = new Set(["known", "unknown"]);
  let allocatedCents = 0;
  for (const allocation of allocations) {
    const amountCents = Number(allocation.amountCents);
    if (!allocation.taskId || !allocation.costId || !allocation.modelCallId) {
      throw new Error("Every provider allocation needs exact task, cost and model-call IDs.");
    }
    if (taskIds.has(allocation.taskId)) throw new Error("A task can appear only once in a provider reconciliation batch.");
    if (!Number.isInteger(amountCents) || amountCents < 0) {
      throw new Error("Every provider allocation must use non-negative whole AUD cents.");
    }
    if (allocation.taskStatus && !allowedTaskStatuses.has(allocation.taskStatus)) {
      throw new Error("Provider reconciliation cannot assign an unsupported task status.");
    }
    if (allocation.workflowStatus && !allowedWorkflowStatuses.has(allocation.workflowStatus)) {
      throw new Error("Provider reconciliation cannot assign an unsupported workflow status.");
    }
    if (allocation.outcomeStatus && !allowedOutcomeStatuses.has(allocation.outcomeStatus)) {
      throw new Error("Provider reconciliation cannot assign an unsupported outcome status.");
    }
    providerTraceId(allocation);
    taskIds.add(allocation.taskId);
    allocatedCents += amountCents;
  }
  if (allocatedCents !== totalAudCents) {
    throw new Error("Provider allocations must add up exactly to the reconciled AUD total.");
  }

  const batchId = String(input.batchId || `provider_reconciliation_${randomId()}`);
  const reconciledAt = input.reconciledAt || now();
  const existingBatch = get(
    db,
    "SELECT * FROM events WHERE type = 'provider_usage.batch_reconciled' AND json_extract(metadata, '$.batchId') = ? ORDER BY id DESC LIMIT 1",
    [batchId],
  );
  if (existingBatch) {
    const existingResults = [];
    db.exec("BEGIN IMMEDIATE");
    try {
      for (const allocation of allocations) {
        const task = get(db, "SELECT * FROM tasks WHERE id = ?", [allocation.taskId]);
        const cost = get(db, "SELECT * FROM costs WHERE id = ?", [allocation.costId]);
        const modelCall = get(db, "SELECT * FROM model_calls WHERE id = ?", [allocation.modelCallId]);
        const costReconciliation = fromJson(cost?.metadata, {}).reconciliation;
        if (
          !task
          || task.venture_id !== ventureId
          || !cost
          || cost.status !== "reconciled"
          || Number(cost.amount_cents) !== Number(allocation.amountCents)
          || costReconciliation?.batchId !== batchId
          || !modelCall
          || modelCall.task_id !== task.id
          || modelCall.provider !== provider
          || modelCall.cost_status !== "reconciled"
        ) {
          throw new Error("The existing provider reconciliation batch does not match the supplied records.");
        }
        if (allocation.responseId && modelCall.provider_request_id !== allocation.responseId) {
          throw new Error("The provider response ID does not match the reconciled model call.");
        }
        const traceId = providerTraceId(allocation);
        if (traceId) {
          const traceEvidence = {
            batchId,
            source: evidence.source,
            reconciledAt,
            responseId: allocation.responseId || modelCall.provider_request_id || null,
          };
          run(
            db,
            "UPDATE model_calls SET metadata = ? WHERE id = ?",
            [
              toJson({
                ...fromJson(modelCall.metadata, {}),
                agentSdkTraceId: traceId,
                agentSdkTraceEvidence: traceEvidence,
              }),
              modelCall.id,
            ],
          );
          run(
            db,
            "UPDATE tasks SET result = ? WHERE id = ?",
            [
              toJson(reconciledTaskResult(task.result, Number(allocation.amountCents), {
                ...costReconciliation,
                agentSdkTraceId: traceId,
                responseId: traceEvidence.responseId,
              })),
              task.id,
            ],
          );
          persistAgentSdkTrace(db, task, traceId, traceEvidence);
        }
        run(
          db,
          `UPDATE messages
           SET status = 'resolved', resolved_at = COALESCE(resolved_at, ?)
           WHERE task_id = ? AND status = 'open' AND subject LIKE 'Check provider outcome:%'`,
          [reconciledAt, task.id],
        );
        existingResults.push({
          taskId: task.id,
          costId: cost.id,
          modelCallId: modelCall.id,
          amountCents: Number(allocation.amountCents),
          taskStatus: task.status,
          outcomeStatus: task.outcome_status,
          reservationId: null,
          agentSdkTraceId: traceId,
        });
      }
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    return {
      batchId,
      ventureId,
      provider,
      totalAudCents,
      reconciledAt,
      evidence,
      allocations: existingResults,
      alreadyReconciled: true,
    };
  }
  const results = [];
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const allocation of allocations) {
      const task = get(db, "SELECT * FROM tasks WHERE id = ?", [allocation.taskId]);
      if (!task || task.venture_id !== ventureId) throw new Error(`Reconciliation task is missing or belongs to another venture: ${allocation.taskId}`);
      const cost = get(db, "SELECT * FROM costs WHERE id = ?", [allocation.costId]);
      if (!cost || cost.workflow_id !== task.workflow_id) throw new Error(`Reconciliation cost does not match task: ${allocation.costId}`);
      const modelCall = get(db, "SELECT * FROM model_calls WHERE id = ?", [allocation.modelCallId]);
      if (!modelCall || modelCall.task_id !== task.id) throw new Error(`Reconciliation model call does not match task: ${allocation.modelCallId}`);
      if (modelCall.provider !== provider) throw new Error("The reconciliation provider does not match the model-call provider.");
      if (allocation.responseId && modelCall.provider_request_id !== allocation.responseId) {
        throw new Error("The provider response ID does not match the reconciled model call.");
      }
      const amountCents = Number(allocation.amountCents);
      const traceId = providerTraceId(allocation);
      const allocationEvidence = {
        batchId,
        provider,
        reconciledAt,
        aggregateProviderEvidence: true,
        exactPerCallAllocation: allocation.exactPerCallAllocation === true,
        allocationMethod: String(allocation.allocationMethod || "aggregate_provider_total"),
        agentSdkTraceId: traceId,
        responseId: allocation.responseId || modelCall.provider_request_id || null,
        evidence,
      };
      const costMetadata = {
        ...fromJson(cost.metadata, {}),
        exactBillingPending: false,
        reconciliation: allocationEvidence,
      };
      const modelMetadata = {
        ...fromJson(modelCall.metadata, {}),
        exactBillingPending: false,
        ...(traceId ? { agentSdkTraceId: traceId } : {}),
        reconciliation: allocationEvidence,
      };
      const taskStatus = allocation.taskStatus || task.status;
      const outcomeStatus = allocation.outcomeStatus || task.outcome_status;
      const result = reconciledTaskResult(task.result, amountCents, allocationEvidence);

      run(
        db,
        "UPDATE costs SET status = 'reconciled', amount_cents = ?, occurred_at = ?, metadata = ? WHERE id = ?",
        [amountCents, reconciledAt, toJson(costMetadata), cost.id],
      );
      run(
        db,
        `UPDATE model_calls
         SET actual_cost_cents = ?, reconciled_cost_cents = ?, cost_status = 'reconciled',
             outcome_status = ?, metadata = ? WHERE id = ?`,
        [amountCents, amountCents, outcomeStatus, toJson(modelMetadata), modelCall.id],
      );
      run(
        db,
        `UPDATE tasks
         SET status = ?, outcome_status = ?, cost_actual_cents = ?, result = ?, updated_at = ?
         WHERE id = ?`,
        [taskStatus, outcomeStatus, amountCents, toJson(result), reconciledAt, task.id],
      );
      if (outcomeStatus === "known") {
        run(
          db,
          `UPDATE messages
           SET status = 'resolved', resolved_at = ?
           WHERE task_id = ? AND status = 'open' AND subject LIKE 'Check provider outcome:%'`,
          [reconciledAt, task.id],
        );
      }
      run(db, "UPDATE agent_runs SET actual_cost_cents = ? WHERE task_id = ?", [amountCents, task.id]);
      persistAgentSdkTrace(db, task, traceId, {
        batchId,
        source: evidence.source,
        reconciledAt,
        responseId: allocationEvidence.responseId,
      });
      run(
        db,
        `UPDATE agent_pilot_reviews SET reconciled_cost_cents = ?
         WHERE run_id IN (SELECT id FROM agent_runs WHERE task_id = ?)`,
        [amountCents, task.id],
      );
      const reservation = get(
        db,
        "SELECT * FROM budget_reservations WHERE task_id = ? AND status IN ('reserved', 'incurred_estimate', 'unknown') ORDER BY reserved_at DESC LIMIT 1",
        [task.id],
      );
      if (reservation) {
        run(
          db,
          `UPDATE budget_reservations
           SET status = 'reconciled', amount_cents = ?, resolved_at = ?, metadata = ? WHERE id = ?`,
          [
            amountCents,
            reconciledAt,
            toJson({ ...fromJson(reservation.metadata, {}), reconciliation: allocationEvidence }),
            reservation.id,
          ],
        );
      }
      if (allocation.workflowStatus) {
        run(
          db,
          "UPDATE workflows SET status = ?, current_step = ?, updated_at = ? WHERE id = ?",
          [allocation.workflowStatus, String(allocation.workflowStep || "Provider outcome and cost reconciled."), reconciledAt, task.workflow_id],
        );
      }
      insertEvent(db, {
        actor: input.reconciledBy || "operator",
        type: "provider_usage.task_reconciled",
        entityType: "task",
        entityId: task.id,
        message: `${provider} usage was reconciled for ${task.title} at ${amountCents} AUD cents using aggregate provider evidence.`,
        metadata: { ...allocationEvidence, costId: cost.id, modelCallId: modelCall.id, amountCents },
      });
      results.push({
        taskId: task.id,
        costId: cost.id,
        modelCallId: modelCall.id,
        amountCents,
        taskStatus,
        outcomeStatus,
        reservationId: reservation?.id || null,
        agentSdkTraceId: traceId,
      });
    }
    insertEvent(db, {
      actor: input.reconciledBy || "operator",
      type: "provider_usage.batch_reconciled",
      entityType: "venture",
      entityId: ventureId,
      message: `${provider} usage batch reconciled at ${totalAudCents} AUD cents across ${allocations.length} calls.`,
      metadata: { batchId, provider, totalAudCents, evidence, allocations: results },
    });
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return { batchId, ventureId, provider, totalAudCents, reconciledAt, evidence, allocations: results };
}

module.exports = {
  monthlyBudgetExposure,
  monthlyCapCents,
  reconcileProviderUsageBatch,
  reserveBudget,
  reservedThisMonth,
  resolveReservation,
};
