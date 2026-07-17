const crypto = require("node:crypto");
const {
  all,
  fromJson,
  get,
  insertEvent,
  now,
  randomId,
  run,
  toJson,
} = require("../db");
const { persistApprovalScope } = require("./approval-scope");

const RETENTION_POLICY_SCHEMA = "jarvis.data-retention-policy.v1";
const DEFAULT_POLICY_ID = "retention-policy-2026-07-17-v1";
const RETENTION_APPROVAL_SCOPE = "data_retention_policy";

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .filter((key) => value[key] !== undefined)
        .map((key) => [key, canonicalValue(value[key])]),
    );
  }
  return value ?? null;
}

function hash(value) {
  return crypto.createHash("sha256").update(JSON.stringify(canonicalValue(value))).digest("hex");
}

function defaultPolicy() {
  return {
    schema: RETENTION_POLICY_SCHEMA,
    version: 1,
    title: "Jarvis data protection and retention plan",
    plainSummary: "Keep evidence that protects the business, remove short-lived clutter, minimise personal data, and keep sensitive provider storage off by default.",
    schedule: [
      {
        id: "financial_and_legal",
        label: "Financial, tax, contracts, approvals and money records",
        duration: "7 years",
        rule: "Keep accounting evidence, provider usage and cost receipts, executed contracts, consequential approvals, compliance records and linked audit evidence for seven years.",
      },
      {
        id: "accepted_venture_work",
        label: "Accepted venture work and commercial evidence",
        duration: "Active venture plus 3 years",
        rule: "Keep accepted outputs, venture decisions, sources, evaluations, final product versions and learning records while the venture is active and for three years after it closes.",
      },
      {
        id: "buyer_data",
        label: "Buyer and customer information",
        duration: "Minimum necessary",
        rule: "Keep required transaction evidence for seven years. Hash or remove direct identifiers by default, and de-identify non-financial personal detail twelve months after fulfilment, refund and dispute obligations close.",
      },
      {
        id: "identity_and_kyc",
        label: "Identity, KYC and sensitive legal documents",
        duration: "Purpose and law only",
        rule: "Keep these in the private operator area, provide task-scoped access only when necessary, review annually, and delete when the verified purpose and any legal retention duty have ended.",
      },
      {
        id: "drafts",
        label: "Rejected, superseded and temporary drafts",
        duration: "90 days",
        rule: "Remove rejected or superseded generated assets and temporary drafts after ninety days unless they are linked to an active dispute, audit or accepted decision.",
      },
      {
        id: "technical_logs",
        label: "Routine technical logs",
        duration: "90 days",
        rule: "Keep routine diagnostics for ninety days. Keep security and approval audit records for two years, or seven years when linked to finance, contracts, compliance or money movement.",
      },
      {
        id: "backups",
        label: "Encrypted backups",
        duration: "7 daily and 4 weekly",
        rule: "Let encrypted backups age out through the existing rotation. Record deletion markers so restored data is removed again instead of silently returning.",
      },
    ],
    providerPolicy: {
      providerResponseStoredByDefault: false,
      providerTraceContentByDefault: false,
      localStructuredReviewStored: true,
      rawChainOfThoughtStored: false,
      controlledNonPersonalStorageRequiresExactApproval: true,
      sensitiveProviderStorageAllowed: false,
      thirdPartyToolRetentionMustBeReviewed: true,
    },
    sourcePolicy: {
      retainUrlDateExcerptAndHash: true,
      fullPageCopiesByExceptionOnly: true,
      removedSourceEvidenceMayBeKeptWhenNeededForAnAuditOrDecision: true,
    },
    deletionPolicy: {
      destructiveCleanupRequiresSeparateOperatorAction: true,
      activeDisputesAuditsAndLegalHoldsPauseDeletion: true,
      deletionMarkersSurviveRestore: true,
    },
    sourceBasis: [
      {
        label: "OpenAI API data controls",
        url: "https://developers.openai.com/api/docs/guides/your-data#v1responses",
        note: "Responses are retained for at least 30 days by default; store false avoids response application-state retention, subject to documented feature exceptions.",
      },
      {
        label: "OAIC APP 11 guidance",
        url: "https://www.oaic.gov.au/privacy/australian-privacy-principles/australian-privacy-principles-guidelines/chapter-11-app-11-security-of-personal-information",
        note: "Protect personal information and destroy or de-identify it when no longer needed, unless a legal requirement applies.",
      },
      {
        label: "ASIC company record keeping",
        url: "https://www.asic.gov.au/for-business-and-companies/companies/company-building-blocks/company-record-keeping/",
        note: "Company financial records must generally be kept for at least seven years.",
      },
      {
        label: "ATO business record keeping",
        url: "https://www.ato.gov.au/businesses-and-organisations/preparing-lodging-and-paying/record-keeping-for-business",
        note: "Many Australian tax and business records have a five-year minimum; Jarvis uses one conservative seven-year finance standard.",
      },
    ],
    legalNote: "This is an operating control, not legal advice. A specific law, dispute, contract or regulator can require a longer hold.",
  };
}

function ensureRetentionPolicy(db) {
  const policy = defaultPolicy();
  const policyHash = hash(policy);
  run(
    db,
    `INSERT INTO data_retention_policies
     (id, version, title, policy, policy_hash, created_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO NOTHING`,
    [DEFAULT_POLICY_ID, policy.version, policy.title, toJson(policy), policyHash, now()],
  );
  const stored = get(db, "SELECT * FROM data_retention_policies WHERE id = ?", [DEFAULT_POLICY_ID]);
  if (!stored || stored.policy_hash !== policyHash) {
    throw new Error("The stored data-retention proposal does not match the supported policy version.");
  }
  return {
    ...stored,
    policy: fromJson(stored.policy, {}),
  };
}

function policyApprovals(db, policy) {
  return all(
    db,
    `SELECT approvals.*, tasks.status AS task_status, tasks.result AS task_result
     FROM approvals
     LEFT JOIN tasks ON tasks.id = approvals.task_id
     WHERE approvals.scope = ?
     ORDER BY approvals.requested_at DESC`,
    [RETENTION_APPROVAL_SCOPE],
  ).map((row) => ({
    ...row,
    payload: fromJson(row.payload, {}),
    task_result: fromJson(row.task_result, {}),
  })).filter((row) => (
    row.payload.policyId === policy.id
    && row.payload.policyHash === policy.policy_hash
  ));
}

function getRetentionPolicyState(db) {
  const policy = ensureRetentionPolicy(db);
  const approvals = policyApprovals(db, policy);
  const activeApproval = approvals.find((approval) => (
    approval.status === "approved"
    && approval.task_status === "completed"
    && approval.task_result?.retentionPolicyActivated === true
  )) || null;
  const pendingApproval = approvals.find((approval) => approval.status === "pending") || null;
  const approvedPending = activeApproval
    ? null
    : approvals.find((approval) => approval.status === "approved") || null;
  const terminalApproval = approvals.find((approval) => (
    approval.status === "rejected" || approval.status === "needs_changes"
  )) || null;
  const otherPendingCount = Number(get(
    db,
    "SELECT COUNT(*) AS count FROM approvals WHERE status = 'pending' AND scope <> ?",
    [RETENTION_APPROVAL_SCOPE],
  )?.count || 0);
  const status = activeApproval
    ? "active"
    : pendingApproval
      ? "waiting_for_decision"
      : approvedPending
        ? "activation_pending"
      : terminalApproval
        ? "revision_required"
      : "proposal_ready";
  const activationNeedsAttention = approvedPending
    && !["planned", "queued", "running"].includes(approvedPending.task_status);
  return {
    id: policy.id,
    version: policy.version,
    title: policy.title,
    policyHash: policy.policy_hash,
    status,
    label: activeApproval
      ? "Active"
      : pendingApproval
        ? "Waiting for your decision"
        : approvedPending
          ? activationNeedsAttention
            ? "Needs attention"
            : "Applying plan"
        : terminalApproval?.status === "needs_changes"
          ? "Changes requested"
          : terminalApproval?.status === "rejected"
            ? "Declined"
        : otherPendingCount
          ? "Ready after the current decision"
          : "Ready to review",
    summary: activeApproval
      ? "Sensitive and long-running AI work is now checked against the approved data plan."
      : approvedPending
        ? activationNeedsAttention
          ? "The plan was approved, but its local activation did not complete. Jarvis must inspect and safely resume it."
          : "The plan is approved and its local checks are being activated. No records are being deleted."
      : terminalApproval
        ? "The previous data plan was not accepted. Jarvis must prepare a revised policy version before asking again."
      : "A plain-language data plan is prepared. It does not delete anything when approved.",
    schedule: policy.policy.schedule,
    providerPolicy: policy.policy.providerPolicy,
    sourceBasis: policy.policy.sourceBasis,
    legalNote: policy.policy.legalNote,
    approvalId: pendingApproval?.id || activeApproval?.id || approvedPending?.id || terminalApproval?.id || null,
    activeAt: activeApproval?.task_result?.activatedAt || activeApproval?.decided_at || null,
    otherPendingDecisionCount: otherPendingCount,
    canPrepareDecision: !activeApproval && !pendingApproval && !approvedPending && !terminalApproval && otherPendingCount === 0,
    nextAction: activeApproval
      ? "No action needed."
      : pendingApproval
        ? "Review this plan in Decisions."
        : approvedPending
          ? activationNeedsAttention
            ? "Jarvis must inspect and safely resume the approved activation."
            : "No action needed while Jarvis applies the approved plan."
        : terminalApproval
          ? "Jarvis must prepare a revised policy version before asking you again."
        : otherPendingCount
          ? "Finish the current decision first; Jarvis will keep this plan ready."
          : "Make this the next decision when you are ready.",
  };
}

function prepareRetentionPolicyDecision(db) {
  const state = getRetentionPolicyState(db);
  if (
    state.status === "active"
    || state.status === "waiting_for_decision"
    || state.status === "activation_pending"
    || state.status === "revision_required"
  ) {
    return { prepared: false, reason: state.nextAction, state };
  }
  if (state.otherPendingDecisionCount > 0) {
    return {
      prepared: false,
      reason: "Finish the current decision first. The data plan remains ready and will not be lost.",
      state,
    };
  }

  const policy = ensureRetentionPolicy(db);
  const suffix = policy.id.replace(/[^a-zA-Z0-9_-]+/g, "_");
  const workflowId = `wf_${suffix}`;
  const taskId = `task_activate_${suffix}`;
  const approvalId = `appr_activate_${suffix}`;
  const ts = now();
  const effect = "Activate the stated local data-retention rules for future work. This decision deletes no records.";

  db.exec("SAVEPOINT prepare_retention_policy");
  try {
    run(
      db,
      `INSERT INTO workflows
       (id, venture_id, type, title, status, current_step, priority, quality_score,
        expected_profit_cents, cost_estimate_cents, approval_required, metadata, created_at, updated_at)
       VALUES (?, NULL, 'governance_policy', ?, 'blocked_for_approval', ?, 1, 0, 0, 0, 1, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         status = excluded.status,
         current_step = excluded.current_step,
         approval_required = 1,
         updated_at = excluded.updated_at`,
      [
        workflowId,
        "Approve the Jarvis data protection plan",
        "Waiting for Daniel to review the plain-language retention plan",
        toJson({ policyId: policy.id, policyHash: policy.policy_hash }),
        ts,
        ts,
      ],
    );
    run(
      db,
      `INSERT INTO tasks
       (id, workflow_id, venture_id, title, kind, agent, status, priority, max_retries,
        approval_id, cost_budget_cents, payload, result, outcome_status, created_at, updated_at)
       VALUES (?, ?, NULL, ?, 'activate_retention_policy', 'runtime-monitor', 'blocked', 1, 0,
               ?, 0, ?, '{}', 'not_started', ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         status = 'blocked',
         approval_id = excluded.approval_id,
         payload = excluded.payload,
         result = '{}',
         outcome_status = 'not_started',
         error = NULL,
         updated_at = excluded.updated_at`,
      [
        taskId,
        workflowId,
        "Activate the approved data protection plan",
        approvalId,
        toJson({
          retentionPolicy: { id: policy.id, hash: policy.policy_hash, version: policy.version },
          mode: "policy_activation",
          noDeletion: true,
        }),
        ts,
        ts,
      ],
    );
    run(
      db,
      `INSERT INTO approvals
       (id, workflow_id, venture_id, task_id, scope, title, status, risk_level,
        requested_by, requested_at, payload, expected_effects)
       VALUES (?, ?, NULL, ?, ?, ?, 'pending', 'medium', 'jarvis', ?, ?, ?)`,
      [
        approvalId,
        workflowId,
        taskId,
        RETENTION_APPROVAL_SCOPE,
        "Approve the Jarvis data protection plan",
        ts,
        toJson({
          policyId: policy.id,
          policyHash: policy.policy_hash,
          policyVersion: policy.version,
          reason: "Approve one clear rule for how Jarvis keeps business evidence, minimises personal data, and removes short-lived clutter before sensitive AI work expands.",
          expectedMetric: "Future sensitive and live-web tasks are automatically checked against one approved plan.",
          expectedUpside: "Workers can use the records they genuinely need while provider storage stays controlled and the dashboard remains uncluttered.",
          policySummary: policy.policy.schedule.map((item) => ({
            label: item.label,
            duration: item.duration,
            rule: item.rule,
          })),
          providerPolicy: policy.policy.providerPolicy,
          noSpendOccurred: true,
          noDeletion: true,
          maxCostCents: 0,
          provider: "local-runtime",
          tracePolicy: {
            providerResponseStored: false,
            providerTraceContent: false,
            localReviewStored: true,
            dataClass: "governance_policy",
          },
        }),
        toJson([effect]),
      ],
    );
    persistApprovalScope(db, approvalId);
    run(
      db,
      `INSERT INTO messages
       (id, task_id, severity, status, subject, body, created_at, metadata)
       VALUES (?, ?, 'approval', 'open', ?, ?, ?, ?)`,
      [
        `msg_retention_${randomId()}`,
        taskId,
        "Data protection plan ready",
        "Review one plain-language schedule. Approval activates future checks but deletes nothing.",
        ts,
        toJson({ approvalId, policyId: policy.id, policyHash: policy.policy_hash }),
      ],
    );
    insertEvent(db, {
      actor: "jarvis",
      type: "retention_policy.decision_prepared",
      entityType: "data_retention_policy",
      entityId: policy.id,
      message: "The data protection plan is ready for operator review. No records were deleted.",
      metadata: { approvalId, workflowId, taskId, policyHash: policy.policy_hash },
    });
    db.exec("RELEASE SAVEPOINT prepare_retention_policy");
  } catch (error) {
    db.exec("ROLLBACK TO SAVEPOINT prepare_retention_policy");
    db.exec("RELEASE SAVEPOINT prepare_retention_policy");
    throw error;
  }

  return { prepared: true, state: getRetentionPolicyState(db) };
}

function retentionMaintenancePreview(db, asOf = new Date()) {
  const cutoff90 = new Date(asOf.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString();
  const draftOutputs = Number(get(
    db,
    `SELECT COUNT(*) AS count
     FROM deliverables
     WHERE status IN ('draft', 'needs_changes', 'archived') AND updated_at < ?`,
    [cutoff90],
  )?.count || 0);
  const routineEvents = Number(get(
    db,
    `SELECT COUNT(*) AS count
     FROM events
     WHERE ts < ?
       AND type NOT LIKE 'approval.%'
       AND type NOT LIKE 'security.%'
       AND type NOT LIKE 'provider_usage.%'
       AND type NOT LIKE 'retention_policy.%'`,
    [cutoff90],
  )?.count || 0);
  return {
    asOf: asOf.toISOString(),
    deletionRun: false,
    eligibleDraftOutputs: draftOutputs,
    eligibleRoutineEvents: routineEvents,
    note: "This is a preview only. Destructive cleanup needs a separate operator action.",
  };
}

function activateRetentionPolicy(db, task, approval) {
  const reference = task.payload?.retentionPolicy || {};
  const policy = ensureRetentionPolicy(db);
  if (reference.id !== policy.id || reference.hash !== policy.policy_hash) {
    throw new Error("The data protection plan changed after approval was requested.");
  }
  const approvalPayload = fromJson(approval?.payload, {});
  if (
    approval?.status !== "approved"
    || !approval?.consumed_at
    || approvalPayload.policyId !== policy.id
    || approvalPayload.policyHash !== policy.policy_hash
  ) {
    throw new Error("The exact data protection plan has not been approved and consumed.");
  }
  const activatedAt = now();
  const preview = retentionMaintenancePreview(db);
  insertEvent(db, {
    actor: "runtime-monitor",
    type: "retention_policy.activated",
    entityType: "data_retention_policy",
    entityId: policy.id,
    message: "The approved data protection plan is active. No records were deleted.",
    metadata: {
      approvalId: approval.id,
      policyHash: policy.policy_hash,
      activatedAt,
      preview,
    },
  });
  return {
    retentionPolicyActivated: true,
    activatedAt,
    policyId: policy.id,
    policyHash: policy.policy_hash,
    noRecordsDeleted: true,
    maintenancePreview: preview,
    output: {
      heading: "Data protection plan active",
      summary: "Future sensitive and live-web AI work will be checked against the approved plan. This activation deleted no records.",
      qualityScore: 100,
    },
  };
}

function retentionRequirementsForTask(db, task) {
  const payload = task?.payload && typeof task.payload === "object"
    ? task.payload
    : fromJson(task?.payload, {});
  const request = payload.liveSpendRequest;
  if (!request || request.requested !== true) return [];

  const tracePolicy = request.executionDescriptor?.tracePolicy || request.tracePolicy || {};
  const dataClass = String(tracePolicy.dataClass || "business_internal").toLowerCase();
  const tools = Array.isArray(request.executionDescriptor?.tools)
    ? request.executionDescriptor.tools
    : Array.isArray(request.tools)
      ? request.tools
      : [];
  const contextSnapshot = payload.contextSnapshot || {};
  const includePersonalData = contextSnapshot.includePersonalData === true;
  const providerStorage = tracePolicy.providerResponseStored === true
    || tracePolicy.providerTraceContent === true;
  const sensitiveClass = /(personal|customer|buyer|identity|kyc|legal|finance|sensitive)/i.test(dataClass);
  const fixture = payload.pilotFixture || {};
  const constraints = fixture.constraints || {};
  const comparison = request.comparisonSource || payload.comparisonSource || {};
  const controlledFixture = dataClass === "controlled_fixture_no_personal_data"
    && task?.kind === "live_ai_worker_execution"
    && task?.agent === "demand_validator"
    && request.scope === "live_ai_worker_spend"
    && request.worker?.id === "demand_validator"
    && includePersonalData === false
    && comparison.type === "versioned_agent_pilot_fixture"
    && typeof fixture.id === "string"
    && fixture.id === comparison.fixtureId
    && typeof fixture.hash === "string"
    && fixture.hash === comparison.fixtureHash
    && fixture.hash === request.fixtureHash
    && fixture.baselineExcluded === true
    && constraints.evaluationOnly === true
    && constraints.realBusinessEvidence === false
    && constraints.externalActionsAllowed === false
    && Array.isArray(constraints.tools)
    && constraints.tools.length === 0
    && Array.isArray(constraints.handoffs)
    && constraints.handoffs.length === 0
    && tools.length === 0
    && request.maxTurns === 1
    && request.maxToolCalls === 0
    && Number(request.maxOutputTokens) <= 1200
    && Number(request.maxCostCents) <= 100
    && Array.isArray(request.effects)
    && request.effects.length === 0;

  if (controlledFixture) return [];
  if (sensitiveClass && providerStorage) {
    return [{
      kind: "safety",
      name: "sensitive_provider_storage",
      message: "Sensitive business or personal records cannot be stored in provider responses or trace content. Keep both storage settings off.",
    }];
  }

  const liveWeb = tools.some((tool) => ["research_adapter", "live_web_with_approval", "web_search"].includes(tool));
  const policyNeeded = includePersonalData || sensitiveClass || providerStorage || liveWeb;
  if (!policyNeeded) return [];
  const state = getRetentionPolicyState(db);
  if (state.status === "active") return [];
  return [{
    kind: "policy",
    name: "data_retention_policy",
    message: "Approve the Jarvis data protection plan before this work uses sensitive records, live web research, or provider-side storage.",
  }];
}

module.exports = {
  DEFAULT_POLICY_ID,
  RETENTION_APPROVAL_SCOPE,
  RETENTION_POLICY_SCHEMA,
  activateRetentionPolicy,
  defaultPolicy,
  ensureRetentionPolicy,
  getRetentionPolicyState,
  prepareRetentionPolicyDecision,
  retentionMaintenancePreview,
  retentionRequirementsForTask,
};
