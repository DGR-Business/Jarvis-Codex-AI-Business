const {
  CommercialAuthorityError,
  classifyCommercialWorkflowSafety,
  commercialRouteGuard,
  extractCommercialTestBinding,
  inspectCommercialExecutionIntent,
} = require("./commercial-authority");

function blockedAssessment(db, workflow, workflowId, safety) {
  if (safety?.assessment) return safety.assessment;
  return commercialRouteGuard(
    db,
    workflow ? { workflow } : { workflowId },
  );
}

function throwBlocked(db, workflow, workflowId, safety, details = {}) {
  const assessment = blockedAssessment(db, workflow, workflowId, safety);
  throw new CommercialAuthorityError({
    ...assessment,
    details: {
      ...(assessment.details || {}),
      ...details,
    },
  });
}

function preflightCommercialWrite(db, input = {}) {
  const workflow = input.workflow || null;
  const workflowId = input.workflowId || workflow?.id || null;
  const options = input.options || {};
  const workflowSafety = classifyCommercialWorkflowSafety(
    db,
    workflow || workflowId,
  );
  if (!workflowSafety.safe) {
    throwBlocked(db, workflow, workflowId, workflowSafety);
  }

  const requestIntent = inspectCommercialExecutionIntent(options, {
    path: "$.liveRequest",
    rootTexts: input.rootTexts || [],
  });
  if (
    requestIntent.commercial
    && !workflowSafety.requiresCommercialAuthority
  ) {
    throwBlocked(db, workflow, workflowId, null, {
      reason: "commercial_request_on_noncommercial_workflow",
      requestSignals: requestIntent.signals,
    });
  }

  const commercialTestContract = workflowSafety.assessment?.binding
    || extractCommercialTestBinding(workflow?.metadata);
  if (workflowSafety.requiresCommercialAuthority) {
    const prospectiveTask = {
      id: input.taskId || `prewrite_${input.taskKind || "commercial_request"}`,
      workflow_id: workflowId,
      venture_id: workflow?.venture_id || null,
      title: input.taskTitle || "Commercial request pre-write check",
      kind: input.taskKind || "commercial_request",
      payload: {
        ...(commercialTestContract ? { commercialTestContract } : {}),
        request: options,
      },
    };
    const assessment = commercialRouteGuard(db, {
      task: prospectiveTask,
      workflow,
    });
    if (!assessment.allowed) {
      throw new CommercialAuthorityError(assessment);
    }
  }

  return {
    commercialTestContract: commercialTestContract || null,
    requestIntent,
    workflowSafety,
  };
}

function requireExistingCommercialTaskBinding(db, input = {}) {
  if (!input.task || !input.workflowSafety?.requiresCommercialAuthority) {
    return null;
  }
  const assessment = commercialRouteGuard(db, {
    task: input.task,
    workflow: input.workflow,
  });
  if (!assessment.allowed) {
    throw new CommercialAuthorityError(assessment);
  }
  return assessment;
}

module.exports = {
  preflightCommercialWrite,
  requireExistingCommercialTaskBinding,
};
