const crypto = require("node:crypto");

const CONFIG = require("../config");
const { all, fromJson, get } = require("../db");
const { ensureApprovalScope } = require("./approval-scope");
const { listAgentDefinitions } = require("./ai-team");
const { commercialFoundationState } = require("./venture-case");
const { ensureCapabilityAutonomy } = require("./capability-autonomy");
const { getLiveAiWorkerReadiness } = require("./live-ai-worker-readiness");
const { getLiveResearchReadiness } = require("./live-research-readiness");
const { getCanonicalOwnerDigest } = require("./executive-digest");
const { getAccountingSummary } = require("./accounting-ledger");
const { monthlyBudgetExposure } = require("./cost-ledger");
const { latestAgentRunReceipt, verifyAgentRunReceiptChain } = require("./agent-execution-evidence");
const { getRetentionPolicyState } = require("./retention-policy");
const { unsafeTaskReason } = require("./scheduler");
const { spendCostId } = require("./stable-id");
const { canPrepareReviewedRetry } = require("./live-ai-retry-policy");
const { preDispatchRecoveryStatus } = require("./live-ai-workers");
const { supersededRetryTaskIds } = require("./monitor");
const { getOpportunityState } = require("./pantheon-opportunities");
const { getProductionState } = require("./pantheon-production");
const { currentOperatorJourney } = require("./pantheon-journey");
const { getPortfolioState } = require("./portfolio-controller");
const { getAgentCostObservability } = require("./agent-cost-observability");
const {
  COMMERCIAL_LIFECYCLE_APPROVAL_SCOPE_SCHEMA,
  classifyCommercialTaskSafety,
  classifyCommercialWorkflowSafety,
} = require("./commercial-authority");
const {
  getCommercialOwnerTestsState,
} = require("./commercial-owner-state");
const {
  PREVENTURE_RESEARCH_APPROVAL_SCOPE_SCHEMA,
  PREVENTURE_RESEARCH_APPROVAL_SCOPE_V2_SCHEMA,
} = require("./preventure-research-contract");
const {
  getPreventureResearchOwnerState,
  validatePendingPreventureLifecycleApproval,
} = require("./preventure-research-owner-state");
const {
  createPreventureResearchStore,
} = require("./preventure-research-store");

const PREVENTURE_RESEARCH_APPROVAL_SCOPE_SCHEMAS = new Set([
  PREVENTURE_RESEARCH_APPROVAL_SCOPE_SCHEMA,
  PREVENTURE_RESEARCH_APPROVAL_SCOPE_V2_SCHEMA,
]);

function parseRows(rows, fields = ["metadata"]) {
  return rows.map((row) => {
    const parsed = { ...row };
    for (const field of fields) parsed[field] = fromJson(parsed[field], field.endsWith("s") ? [] : {});
    return parsed;
  });
}

function preventureRuntimeProjection(options = {}) {
  const runtime = options.preventureResearchRuntime || {};
  const finalization = runtime.finalizationControl || {};
  const assignmentControls = Array.isArray(runtime.assignmentControls)
    ? runtime.assignmentControls.filter((item) => item && typeof item === "object").map((item) => ({
      authorityHash: item.authorityHash || null,
      assignmentId: item.assignmentId || null,
      assignmentHash: item.assignmentHash || null,
      descriptorHash: item.descriptorHash || null,
      requestBodyHash: item.requestBodyHash || null,
      ready: item.ready === true,
      providerCallReady: item.providerCallReady === true,
      requiresPreparation: item.requiresPreparation === true,
      canReprocess: item.canReprocess === true,
      retainedOutputHash: item.retainedOutputHash || null,
      status: item.status || "not_ready",
      blockers: Array.isArray(item.blockers) ? item.blockers : [],
    }))
    : [];
  return {
    status: runtime.status || "not_ready",
    assignmentRunReady: runtime.assignmentRunReady === true,
    retainedOutputReprocessReady: runtime.retainedOutputReprocessReady === true,
    deterministicDecisionReady: runtime.deterministicDecisionReady === true,
    providerContactAllowed: runtime.providerContactAllowed === true,
    assignmentControls,
    finalizationControl: {
      ready: finalization.ready === true,
      authorityHash: finalization.authorityHash || null,
      evidenceSetHash: finalization.evidenceSetHash || null,
      receiptSetHash: finalization.receiptSetHash || null,
      resultingReadinessHash: finalization.resultingReadinessHash || null,
      outcome: finalization.outcome || null,
      blockers: Array.isArray(finalization.blockers) ? finalization.blockers : [],
      message: finalization.message || null,
    },
    message: runtime.message
      || "The dedicated bounded-research runner is not connected, so no provider call can start.",
  };
}

function preventureOwnerProjection(db, options = {}) {
  return getPreventureResearchOwnerState(db, {
    authorityRegistry: options.preventureResearchAuthorityRegistry,
    clock: options.preventureResearchClock,
    storeOptions: {
      clock: options.preventureResearchClock,
      authorityRegistry: options.preventureResearchAuthorityRegistry,
    },
  });
}

function journeyIdForTaskPayload(payload = {}) {
  const parameters = payload?.liveSpendRequest?.parameters || {};
  return parameters.pantheonJourney?.journeyId
    || parameters.pantheonCommercial?.journeyId
    || parameters.pantheonProduction?.journeyId
    || null;
}

function latestOperatorJourneyId(db) {
  return currentOperatorJourney(db)?.id || null;
}

function belongsToCurrentJourney(payload, currentJourneyId) {
  const journeyId = journeyIdForTaskPayload(payload);
  return !journeyId || !currentJourneyId || journeyId === currentJourneyId;
}

function humanTaskStatus(status) {
  return {
    planned: "Waiting",
    queued: "Waiting to start",
    running: "Working",
    blocked: "Needs attention",
    waiting_approval: "Needs attention",
    needs_attention: "Needs attention",
    needs_changes: "Changes requested",
    completed: "Completed",
    failed: "Needs attention",
    cancelled: "Stopped",
  }[status] || "Standby";
}

function operatorDeliverable(deliverable) {
  const humanText = (value) => String(value || "")
    .replace(/Approval Pack \(for approval\)/gi, "Decision Brief")
    .replace(/Approval Pack/gi, "Decision Brief")
    .replace(/approval pack/gi, "decision brief");
  return {
    ...deliverable,
    human_name: humanText(deliverable.human_name),
    summary: humanText(deliverable.summary),
  };
}

function operatorProductionText(db, value, payload = {}) {
  const text = String(value || "");
  const parameters = payload?.liveSpendRequest?.parameters || {};
  const production = parameters.pantheonProduction || {};
  if (!production.planId || !text) return text;
  const plan = get(
    db,
    "SELECT title, metadata FROM catalogue_plans WHERE id = ?",
    [production.planId],
  );
  if (!plan) return text;
  const metadata = fromJson(plan.metadata, {});
  const canonicalTitle = String(
    metadata.productManifest?.packageTitle
      || metadata.validationSample?.sample?.item?.title
      || metadata.buyerIntentValidation?.sample?.item?.title
      || "",
  ).trim();
  if (!canonicalTitle) return text;
  const aliases = [...new Set([
    plan.title,
    metadata.validationSample?.sample?.packageTitle,
    metadata.buyerIntentValidation?.sample?.packageTitle,
    parameters.productBuildSpec?.validationSample?.packageTitle,
  ].map((item) => String(item || "").trim()).filter((item) => (
    item && item.toLowerCase() !== canonicalTitle.toLowerCase()
  )))];
  return aliases.reduce((current, alias) => (
    current.replace(
      new RegExp(alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"),
      canonicalTitle,
    )
  ), text);
}

function pendingApprovals(db, options = {}) {
  let authorities = [];
  try {
    const store = createPreventureResearchStore(db, {
      clock: options.preventureResearchClock,
      authorityRegistry: options.preventureResearchAuthorityRegistry,
    });
    if (store.verifyLedger()?.ok === true) authorities = store.listAuthorities();
  } catch {
    authorities = [];
  }
  const approvalKind = (row) => {
    const payload = fromJson(row.payload, {});
    const scope = fromJson(row.scope, {});
    const hasPreventureMarker = PREVENTURE_RESEARCH_APPROVAL_SCOPE_SCHEMAS.has(scope?.schema)
      || [
        "preventureResearchApprovalScope",
        "preventureLifecycleApprovalScope",
      ].some((key) => Object.hasOwn(payload, key))
      || [
        payload.preventureResearchApprovalScope,
        payload.preventureLifecycleApprovalScope,
        payload.approvalScope,
        payload.scope,
      ].some((candidate) => (
        PREVENTURE_RESEARCH_APPROVAL_SCOPE_SCHEMAS.has(candidate?.schema)
      ));
    let linked = false;
    for (const authority of authorities) {
      for (const eventType of ["accepted", "activated"]) {
        const validation = validatePendingPreventureLifecycleApproval(
          row,
          authority,
          eventType,
        );
        if (validation.valid) return "valid_preventure";
        if (row.scope_hash === validation.scopeHash) linked = true;
      }
    }
    return hasPreventureMarker || linked ? "invalid_preventure" : "other";
  };
  return all(db, "SELECT * FROM approvals WHERE status = 'pending' ORDER BY CASE risk_level WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, requested_at")
    .filter((row) => approvalKind(row) !== "invalid_preventure")
    .map((row) => {
      const scoped = ensureApprovalScope(db, row.id);
      return {
        ...scoped.approval,
        payload: fromJson(scoped.approval.payload),
        expectedEffects: fromJson(scoped.approval.expected_effects, []),
        taskPayload: fromJson(scoped.task?.payload, {}),
        executionScope: scoped.scope,
      };
    });
}

function decisionCard(approval, db = null) {
  const payload = approval.payload || {};
  const liveRequest = approval.taskPayload?.liveSpendRequest || {};
  const modelRoute = liveRequest.modelRoute || null;
  const fixture = approval.taskPayload?.pilotFixture || null;
  const contextSnapshot = approval.taskPayload?.contextSnapshot || null;
  const scope = approval.executionScope || {};
  const workerId = payload.worker?.id || liveRequest.worker?.id || approval.taskPayload?.requestedWorker || null;
  const tools = scope.tools || liveRequest.tools || [];
  const demandResearch = workerId === "demand_validator" && tools.includes("research_adapter");
  const controlledDemandCheck = workerId === "demand_validator" && Boolean(fixture);
  const production = liveRequest.parameters?.pantheonProduction || null;
  const productBuildSpec = liveRequest.parameters?.productBuildSpec || null;
  const preventureLifecycleApprovalScope = payload.preventureResearchApprovalScope
    || payload.preventureLifecycleApprovalScope
    || null;
  const lifecycleApprovalScope = payload.commercialTestApprovalScope
    || payload.commercialLifecycleApprovalScope
    || payload.approvalScope
    || payload.scope
    || null;
  const commercialLifecycleDecision = (
    lifecycleApprovalScope?.schema === COMMERCIAL_LIFECYCLE_APPROVAL_SCOPE_SCHEMA
    && ["accepted", "activated"].includes(lifecycleApprovalScope.eventType)
  );
  const preventureLifecycleDecision = (
    PREVENTURE_RESEARCH_APPROVAL_SCOPE_SCHEMAS.has(
      preventureLifecycleApprovalScope?.schema,
    )
    && ["accepted", "activated"].includes(preventureLifecycleApprovalScope.eventType)
  );
  const lifecycleEventType = preventureLifecycleDecision
    ? preventureLifecycleApprovalScope.eventType
    : commercialLifecycleDecision ? lifecycleApprovalScope.eventType : null;
  const dataProtectionPlan = approval.scope === "data_retention_policy";
  const catalogueBuild = production?.stage === "product_build"
    && production.operatorChoiceRequired === true;
  const validationProductBuild = catalogueBuild && Boolean(productBuildSpec?.validationSample);
  const qualityReview = production?.stage === "quality_review"
    || workerId === "quality_reviewer";
  const correctionNumber = Number(production?.revisionNumber || 0);
  const explicitOperatorFinalReview = qualityReview
    && production?.explicitOperatorFinalReview === true;
  const inspectionEvidenceRecheck = qualityReview
    && production?.inspectionEvidenceRecheck === true;
  const finalQualityRecheck = qualityReview
    && (correctionNumber > 0 || explicitOperatorFinalReview || inspectionEvidenceRecheck);
  const maxCostCents = Number(payload.maxCostCents || payload.estimatedCostCents || 0);
  const preventureAuthorityCapCents = Number(
    preventureLifecycleApprovalScope?.internalAiSpendCapAudCents || 0,
  );
  return {
    id: approval.id,
    type: "decision",
    decisionKind: preventureLifecycleDecision
      ? "preventure_research_lifecycle"
      : commercialLifecycleDecision ? "commercial_lifecycle" : "approval",
    title: preventureLifecycleDecision
      ? lifecycleEventType === "accepted"
        ? "Accept this exact bounded research proposal?"
        : "Activate this exact internal diligence round?"
      : commercialLifecycleDecision
      ? lifecycleEventType === "accepted"
        ? "Accept this exact commercial test?"
        : "Activate this exact commercial test?"
      : inspectionEvidenceRecheck
      ? "Recheck the complete setup-guide inspection?"
      : explicitOperatorFinalReview
      ? "Run one final independent check on the corrected workbook?"
      : validationProductBuild
      ? "Build the functional validation workbook?"
      : catalogueBuild
      ? `Build the ${productBuildSpec?.catalogueItems?.length || "planned"}-product catalogue?`
      : demandResearch
      ? `Decide whether to run live market research${maxCostCents > 0 ? ` (up to A$${(maxCostCents / 100).toFixed(2)})` : ""}`
      : controlledDemandCheck
        ? "Start the Demand Validator check?"
        : approval.title,
    risk: approval.risk_level,
    requestedAt: approval.requested_at,
    scopeHash: approval.scope_hash,
    expiresAt: approval.expires_at,
    recommendation: preventureLifecycleDecision
      ? lifecycleEventType === "accepted"
        ? "Accept only the fixed questions, public-data rules, three assignments, A$2 internal ceiling, A$0 external spend, expiry, and stop conditions."
        : "Activate only the already accepted preparation-only round. Product work, buyer contact, marketplace access, publishing, advertising, and external spend remain prohibited."
      : commercialLifecycleDecision
      ? lifecycleEventType === "accepted"
        ? "Accept the exact buyer, offer, channel, price, evidence period, and stop rules as the commercial decision on record."
        : "Activate only this accepted test so Pantheon can prepare contract-bound internal work and evidence collection."
      : inspectionEvidenceRecheck
      ? "Jarvis regenerated only the internal setup-guide inspection so all three pages are visible. The customer package and storefront previews remain byte-for-byte unchanged."
      : explicitOperatorFinalReview
      ? "Jarvis corrected the exact workbook, setup guide, calculations, and previews locally at no additional AI cost. Run one final independent review before Pantheon treats the product as ready for a buyer test."
      : validationProductBuild
      ? "Pantheon will create one usable local Excel workbook, setup guide, and two previews, then send the exact files through independent quality review. Nothing will be published or sent."
      : catalogueBuild
      ? "Pantheon will create the complete local product files, retain them in the venture record, and send them through an independent quality review. Nothing will be published or sent."
      : demandResearch
      ? "Demand Validator will search the web for current buyer language, competing products, price signals, and one suitable free audience channel."
      : controlledDemandCheck
        ? "Demand Validator will assess the supplied test evidence and return one recommendation for your review."
        : payload.reason || payload.commercialPurpose || "Review the evidence and choose whether this exact action should continue.",
    expectedUpside: preventureLifecycleDecision
      ? lifecycleEventType === "accepted"
        ? "Creates an accountable diligence record without starting AI work or changing the business externally."
        : "Allows only three bounded internal evidence assignments so Pantheon can decide whether retaining cash or preparing a separate build proposal is better."
      : commercialLifecycleDecision
      ? lifecycleEventType === "accepted"
        ? "Creates one accountable commercial decision without starting a test, publishing, contacting buyers, or spending money."
        : "Makes one exact test the active commercial authority while every external action remains separately protected."
      : inspectionEvidenceRecheck
      ? "Lets the independent reviewer inspect the previously unseen page once. If the unchanged package does not pass, Pantheon stops this build permanently."
      : explicitOperatorFinalReview
      ? "Confirms whether the corrected customer files are genuinely usable and truthfully represented. If they still fail, Pantheon stops rather than paying for another review."
      : validationProductBuild
      ? "Closes the product-format and usability gap with one real sample before any wider catalogue or marketplace action is considered."
      : catalogueBuild
      ? "Turns the validated offer into customer-usable files so the real launch decision can be based on an actual product rather than a plan."
      : demandResearch
      ? "The result should tell us whether this buyer can be reached and give us one measurable free test with a clear stop rule."
      : controlledDemandCheck
        ? "This checks whether the AI can produce a useful business recommendation while staying inside its exact limits."
        : payload.expectedMetric || payload.expectedUpside || "The expected benefit has not been quantified yet.",
    maxCostCents: preventureLifecycleDecision ? 0 : maxCostCents,
    authorityCapCents: preventureLifecycleDecision ? preventureAuthorityCapCents : null,
    pricedWorstCaseCostCents: Number(
      liveRequest.pricedWorstCaseCostCents
      || liveRequest.executionDescriptor?.worstCaseCost?.amountCents
      || 0,
    ),
    provider: preventureLifecycleDecision
      ? preventureLifecycleApprovalScope.provider?.id || null
      : payload.provider || null,
    model: preventureLifecycleDecision
      ? preventureLifecycleApprovalScope.provider?.model || null
      : liveRequest.model || scope.model || payload.model || null,
    modelRoute,
    worker: preventureLifecycleDecision
      ? "Demand Validator"
      : payload.worker?.name || liveRequest.worker?.name || payload.requestedWorker || null,
    productionStage: production?.stage || null,
    correctionNumber,
    finalQualityRecheck,
    explicitOperatorFinalReview,
    inspectionEvidenceRecheck,
    productFiles: (explicitOperatorFinalReview || inspectionEvidenceRecheck) && db
      ? inspectionEvidenceRecheck
        ? presentedDeliverablesByIds(
          db,
          liveRequest.parameters?.approvedAssetIds || [],
        )
        : currentBuyerIntentValidation(db, approval.venture_id, production?.planId)?.files || []
      : [],
    effects: preventureLifecycleDecision ? [] : approval.expectedEffects,
    tools: preventureLifecycleDecision ? ["web_search"] : tools,
    maxTurns: Number(scope.maxTurns || liveRequest.maxTurns || 0),
    maxOutputTokens: Number(scope.maxOutputTokens || liveRequest.maxOutputTokens || 0),
    assignment: fixture ? {
      question: fixture.question || null,
      buyer: fixture.buyer || null,
      hypothesis: fixture.hypothesis || null,
      evidenceCount: Array.isArray(fixture.sources) ? fixture.sources.length : 0,
    } : null,
    businessContext: contextSnapshot ? {
      purpose: contextSnapshot.purpose,
      accessProfile: contextSnapshot.accessProfile,
      recordClasses: contextSnapshot.recordClasses || [],
      recordCount: Number(contextSnapshot.recordCount || 0),
      snapshotHash: contextSnapshot.snapshotHash,
    } : null,
    tracePolicy: payload.tracePolicy || null,
    policySummary: Array.isArray(payload.policySummary) ? payload.policySummary : null,
    noDeletion: payload.noDeletion === true,
    attentionLabel: preventureLifecycleDecision ? "Bounded research decision ready" : commercialLifecycleDecision ? "Commercial decision ready" : inspectionEvidenceRecheck ? "Complete inspection ready" : explicitOperatorFinalReview ? "Corrected workbook ready" : validationProductBuild ? "Validation product ready" : catalogueBuild ? "Product build ready" : finalQualityRecheck ? "Final quality recheck ready" : demandResearch ? "Market research ready" : controlledDemandCheck ? "AI check ready" : "Decision ready",
    primaryActionLabel: preventureLifecycleDecision ? "Review the bounded research decision" : commercialLifecycleDecision ? "Review the exact commercial decision" : inspectionEvidenceRecheck ? "Review the evidence recheck" : explicitOperatorFinalReview ? "Review the corrected workbook" : validationProductBuild ? "Review validation product" : catalogueBuild ? "Review catalogue build" : finalQualityRecheck ? "Review final quality recheck" : demandResearch ? "Review research plan" : controlledDemandCheck ? "Review AI check" : "Review and decide",
    approveLabel: preventureLifecycleDecision
      ? lifecycleEventType === "accepted"
        ? "Accept this exact research scope"
        : "Activate this bounded research round"
      : commercialLifecycleDecision
      ? lifecycleEventType === "accepted"
        ? "Accept this exact test"
        : "Activate this exact test"
      : inspectionEvidenceRecheck
      ? "Start the evidence recheck"
      : explicitOperatorFinalReview
      ? "Run the final independent check"
      : validationProductBuild
      ? "Build this validation workbook"
      : catalogueBuild
      ? "Build this catalogue"
      : finalQualityRecheck
        ? "Start final quality recheck"
      : dataProtectionPlan
        ? "Activate this protection plan"
        : null,
    decisionActionKind: preventureLifecycleDecision
      ? "preventure_research_lifecycle"
      : commercialLifecycleDecision
      ? "commercial_lifecycle"
      : catalogueBuild
      ? "catalogue_build"
      : dataProtectionPlan
        ? "data_protection"
        : null,
    productBuild: catalogueBuild ? {
      validationSample: validationProductBuild,
      channel: productBuildSpec?.validationSample?.channel || null,
      productCount: Number(productBuildSpec?.catalogueItems?.length || 0),
      profile: productBuildSpec?.profile || null,
      formats: productBuildSpec?.allowedFormats || [],
      qualityBar: productBuildSpec?.qualityBar || null,
      items: (productBuildSpec?.catalogueItems || []).map((item) => ({
        id: item.id || null,
        title: item.title || "Untitled product",
        audience: item.audience || null,
        offer: item.offer || null,
        priceCents: Number(item.priceCents || 0),
      })),
    } : null,
    lifecycleEventType,
    decisionPrompt: preventureLifecycleDecision
      ? lifecycleEventType === "accepted"
        ? "Review the fixed questions, public-data limits, three assignments, A$2 internal ceiling, A$0 external spend, expiry, and stop conditions. Accepting does not start AI work."
        : "Confirm that the already accepted preparation-only round may start its three exact internal assignments. It still cannot build, contact buyers, access accounts, publish, advertise, or spend externally."
      : commercialLifecycleDecision
      ? lifecycleEventType === "accepted"
        ? "Review the exact buyer, offer, channel, price, evidence rules, and boundaries before accepting the test."
        : "Confirm that this accepted test should become Pantheon's one active controlled commercial test."
      : inspectionEvidenceRecheck
      ? "Review the four exact local inspection images, the one-recheck limit, and the A$1.50 ceiling before deciding."
      : explicitOperatorFinalReview
      ? "Review the corrected files, the one-review limit, and the A$1.50 maximum before deciding."
      : catalogueBuild
      ? "Review what Pantheon will create, the cost ceiling, and what remains locked."
      : demandResearch
      ? "See what the AI will research, the maximum cost, and what it cannot do."
      : controlledDemandCheck
        ? "See the evidence, limit, and exact action before starting the AI."
        : "Review what will happen before you choose.",
    actions: preventureLifecycleDecision
      ? ["approve", "reject"]
      : ["approve", "changes", "reject"],
  };
}

function pendingHandoffs(db) {
  return parseRows(all(
    db,
    `SELECT agent_handoffs.*, workflows.title AS workflow_title,
            agent_definitions.name AS from_agent_name,
            workflows.expected_profit_cents, workflows.cost_estimate_cents,
            source_tasks.payload AS source_task_payload,
            source_tasks.result AS source_task_result
     FROM agent_handoffs
     LEFT JOIN workflows ON workflows.id = agent_handoffs.workflow_id
     LEFT JOIN agent_definitions ON agent_definitions.id = agent_handoffs.from_agent_id
     LEFT JOIN tasks AS source_tasks ON source_tasks.id = agent_handoffs.task_id
     WHERE agent_handoffs.status IN ('needs_operator_decision', 'waiting_for_review', 'waiting_approval')
     ORDER BY CASE agent_handoffs.risk_level WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END,
              agent_handoffs.updated_at`,
  ), ["metadata", "source_task_payload", "source_task_result"]);
}

function handoffCard(handoff) {
  const taskKind = String(handoff.metadata?.taskKind || "").toLowerCase();
  const businessDecision = handoff.metadata?.businessDecision || {};
  const sourcePayload = handoff.source_task_payload || {};
  const sourceResult = handoff.source_task_result || {};
  const liveRequest = sourcePayload.liveSpendRequest || {};
  const controlledEvidence = Boolean(sourcePayload.pilotFixture);
  const researchSources = (
    sourceResult.output?.toolActivity
    || sourceResult.liveWorker?.output?.toolActivity
    || []
  ).flatMap((item) => Array.isArray(item.sources) ? item.sources : []);
  const liveResearch = Array.isArray(liveRequest.tools)
    && liveRequest.tools.some((toolId) => ["research_adapter", "live_web_with_approval"].includes(toolId));
  const demandResult = taskKind === "live_ai_worker_execution"
    && String(handoff.from_agent_id || "").toLowerCase() === "demand_validator";
  const launchDecision = handoff.metadata?.pantheonProduction?.action === "authorize_launch_preparation";
  const demandRecommendation = controlledEvidence
    ? "Demand Validator found a plausible recurring problem in the controlled evidence, but it did not prove real buyer demand. It recommends a free interest check before anything is built."
    : liveResearch && researchSources.length
      ? `Demand Validator completed live research with ${researchSources.length} attributable source${researchSources.length === 1 ? "" : "s"}. It recommends a small interest test; the research does not itself prove demand or willingness to pay.`
      : handoff.summary || businessDecision.evidenceSummary || "Review the recorded evidence before deciding whether Pantheon should prepare a small interest test.";
  return {
    id: handoff.id,
    type: "decision",
    decisionKind: "handoff",
    title: launchDecision
      ? "Decide whether this product should move to publish-ready"
      : demandResult
      ? "Decide whether to prepare the interest test"
      : handoff.decision_needed || `Choose the next step for ${handoff.workflow_title || "this work"}`,
    risk: demandResult
      ? (["high", "medium", "low"].includes(String(businessDecision.risk || "").toLowerCase())
          ? String(businessDecision.risk).toLowerCase()
          : "medium")
      : handoff.risk_level || "medium",
    requestedAt: handoff.updated_at || handoff.created_at,
    recommendation: launchDecision
      ? handoff.summary || "The finished product files, quality review, listing copy, and first market test are ready. Nothing has been published."
      : demandResult
      ? demandRecommendation
      : handoff.summary || handoff.reason || "Review the completed work and choose whether the team should continue.",
    expectedUpside: launchDecision
      ? "Moves the complete launch package to the separate Gumroad publishing step without making any public change automatically."
      : demandResult
      ? "A small interest check can show whether the idea deserves more work without spending money."
      : Number(handoff.expected_profit_cents || 0) > 0
        ? "Advances a bounded commercial step with the expected return shown in the work record."
        : "Keeps the venture moving without allowing an external action automatically.",
    maxCostCents: Number(handoff.cost_estimate_cents || 0),
    worker: handoff.from_agent_name || handoff.from_agent_id || null,
    workflowId: handoff.workflow_id || null,
    runId: handoff.from_run_id || null,
    attentionLabel: launchDecision ? "Launch package ready" : demandResult ? "AI result ready" : "Decision ready",
    primaryActionLabel: launchDecision ? "Review launch package" : demandResult ? "Review result" : "Review and decide",
    approveLabel: launchDecision ? "Move to publish-ready" : null,
    decisionActionKind: launchDecision ? "launch_readiness" : null,
    decisionPrompt: launchDecision
      ? "Review the finished package and choose whether to prepare the separate real publishing action."
      : demandResult
      ? "Read the result, rate the analysis, then choose whether Pantheon should prepare the test."
      : handoff.decision_needed || "Choose what Pantheon should do next.",
    actions: ["approve", "changes", "reject"],
  };
}

function safetyReason(safety, fallback) {
  return safety?.code
    || safety?.classification
    || fallback;
}

function ownerCommercialTestRef(testId, testVersion) {
  if (!testId || !testVersion) return null;
  const digest = crypto
    .createHash("sha256")
    .update(
      `pantheon.owner-commercial-test.v1\0${String(testId)}\0${String(testVersion)}`,
      "utf8",
    )
    .digest("hex")
    .slice(0, 20);
  return `test-${digest}`;
}

function exactOwnerCommercialSafety(safety, currentTest) {
  const assessment = safety?.assessment;
  const program = assessment?.program;
  const binding = assessment?.binding;
  return Boolean(
    currentTest?.canonicalOwnerProjection === true
      && currentTest.status === "activated"
      && safety?.safe === true
      && safety?.requiresCommercialAuthority === true
      && safety?.classification === "authorized_commercial"
      && program?.decisionHash
      && binding?.decisionHash
      && program.decisionHash === binding.decisionHash
      && currentTest.id === ownerCommercialTestRef(
        program.testId,
        program.testVersion,
      )
  );
}

function journeyExecutionState(db, journey, task, currentTest) {
  if (!journey) return null;
  const workflowSafety = journey.workflow_id
    ? classifyCommercialWorkflowSafety(db, journey.workflow_id)
    : null;
  const workflowAuthorized = exactOwnerCommercialSafety(
    workflowSafety,
    currentTest,
  );
  const taskSafety = task
    ? classifyCommercialTaskSafety(db, task)
    : null;
  const workflowDecisionHash = workflowSafety?.assessment?.binding?.decisionHash;
  const taskDecisionHash = taskSafety?.assessment?.binding?.decisionHash;
  const taskAuthorized = Boolean(
    workflowAuthorized
      && task
      && task.workflow_id === journey.workflow_id
      && exactOwnerCommercialSafety(taskSafety, currentTest)
      && workflowDecisionHash
      && workflowDecisionHash === taskDecisionHash
  );
  const taskRecorded = Boolean(task);
  const blocked = taskRecorded && !taskAuthorized;
  const authorized = workflowAuthorized && !blocked;
  const running = authorized && taskAuthorized && task.status === "running";
  const reason = !workflowAuthorized
    ? workflowSafety?.message
      || "This recorded journey has no exact accepted and activated commercial authority."
    : blocked
      ? taskSafety?.message
        || "The recorded task does not match this journey's exact commercial authority."
      : null;
  return {
    schema: "pantheon.owner-journey-execution.v1",
    authorized,
    taskAuthorized,
    running,
    readOnly: !authorized,
    blocked,
    status: running
      ? "running"
      : blocked
        ? "blocked"
        : authorized
          ? "authorised_not_running"
          : "read_only",
    reason,
  };
}

function preventureTaskExecutionPresentation(db, task, queueEligible, options = {}) {
  const runtime = preventureRuntimeProjection(options);
  try {
    const row = get(
      db,
      `SELECT authority_hash, assignment_hash, assignment_id, assignment_json
       FROM preventure_research_assignments
       WHERE task_id = ?`,
      [task.id],
    );
    if (!row) {
      return {
        can_run: false,
        safe_to_run: false,
        execution_kind: "preventure_research",
        safety_reason: "preventure_research_assignment_binding_missing",
        run_label: "Resolve research record",
      };
    }
    const assignment = fromJson(row.assignment_json, {});
    const store = createPreventureResearchStore(db, {
      clock: options.preventureResearchClock,
      authorityRegistry: options.preventureResearchAuthorityRegistry,
    });
    const verified = store.verifyLedger();
    const state = store.readState(row.authority_hash);
    const exactControl = runtime.assignmentControls.find((item) => (
      item.authorityHash === row.authority_hash
      && item.assignmentId === row.assignment_id
      && item.assignmentHash === row.assignment_hash
      && /^sha256:[a-f0-9]{64}$/.test(String(item.descriptorHash || ""))
      && /^sha256:[a-f0-9]{64}$/.test(String(item.requestBodyHash || ""))
    ));
    const bindingValid = verified?.ok === true
      && assignment.assignmentHash === row.assignment_hash
      && assignment.id === row.assignment_id
      && assignment.taskId === task.id;
    const authorityAllowsRun = bindingValid && state.dispatchAllowed === true;
    const requiresPreparation = task.status === "blocked"
      && exactControl?.requiresPreparation === true;
    const runnableStatus = ["planned", "queued"].includes(task.status)
      || requiresPreparation;
    const positionAllowsRun = queueEligible || requiresPreparation;
    const canRun = Boolean(
      positionAllowsRun
        && runnableStatus
        && authorityAllowsRun
        && runtime.assignmentRunReady
        && exactControl?.ready === true
    );
    const canReprocess = Boolean(
      bindingValid
        && exactControl?.canReprocess === true
        && /^sha256:[a-f0-9]{64}$/.test(String(exactControl.retainedOutputHash || ""))
    );
    const safetyReason = !bindingValid
      ? "preventure_research_assignment_binding_invalid"
      : !authorityAllowsRun
        ? state.expired
          ? "preventure_research_authority_expired"
          : "preventure_research_authority_not_dispatchable"
        : !runtime.assignmentRunReady
          ? "preventure_research_runtime_not_ready"
          : !exactControl?.ready
            ? "preventure_research_execution_descriptor_not_ready"
            : !runnableStatus
              ? `preventure_research_task_not_runnable:${task.status}`
              : null;
    return {
      can_run: canRun,
      safe_to_run: canRun,
      execution_kind: "preventure_research",
      safety_reason: safetyReason,
      safety_classification: "dedicated_bounded_research",
      workflow_safety_classification: "dedicated_bounded_research",
      commercial_authority_required: false,
      authority_hash: row.authority_hash,
      assignment_id: row.assignment_id,
      assignment_hash: row.assignment_hash,
      descriptor_hash: exactControl?.descriptorHash || null,
      request_body_hash: exactControl?.requestBodyHash || null,
      requires_preparation: requiresPreparation,
      can_reprocess: canReprocess,
      retained_output_hash: canReprocess ? exactControl.retainedOutputHash : null,
      max_cost_cents: Number(assignment.maxCostAudCents || task.cost_budget_cents || 0),
      run_label: canRun
        ? requiresPreparation
          ? "Start exact research assignment"
          : "Run exact research assignment"
        : "Dedicated runner not ready",
      reprocess_label: canReprocess ? "Reprocess retained result locally" : null,
    };
  } catch {
    return {
      can_run: false,
      safe_to_run: false,
      execution_kind: "preventure_research",
      safety_reason: "preventure_research_integrity_unavailable",
      safety_classification: "dedicated_bounded_research",
      workflow_safety_classification: "dedicated_bounded_research",
      commercial_authority_required: false,
      max_cost_cents: Number(task.cost_budget_cents || 0),
      run_label: "Resolve research record",
    };
  }
}

function taskExecutionPresentation(db, task, queueEligible = true, options = {}) {
  const immutablePreventureBinding = get(
    db,
    "SELECT 1 AS bound FROM preventure_research_assignments WHERE task_id = ? LIMIT 1",
    [task.id],
  );
  if (
    immutablePreventureBinding
    || String(task.kind || "").toLowerCase() === "preventure_research"
  ) {
    return preventureTaskExecutionPresentation(db, task, queueEligible, options);
  }
  const payload = task.payload && typeof task.payload === "object"
    ? task.payload
    : fromJson(task.payload, {});
  const unsafeReason = unsafeTaskReason({ ...task, payload });
  const workflowSafety = classifyCommercialWorkflowSafety(
    db,
    task.workflow_id,
  );
  const taskSafety = classifyCommercialTaskSafety(db, {
    ...task,
    payload,
  });
  const authorityReason = !workflowSafety.safe
    ? safetyReason(workflowSafety, "commercial_workflow_not_authorized")
    : !taskSafety.safe
      ? safetyReason(taskSafety, "commercial_task_not_authorized")
      : null;
  const authorityAllowsRun = Boolean(
    workflowSafety.safe
    && taskSafety.safe,
  );
  const canRun = Boolean(queueEligible) && authorityAllowsRun;
  const liveRequest = payload.liveSpendRequest || {};
  const maxCostCents = Math.max(
    0,
    Number(
      liveRequest.maxCostCents
      || liveRequest.executionDescriptor?.worstCaseCost?.amountCents
      || task.cost_budget_cents
      || 0,
    ),
  );
  return {
    can_run: canRun,
    safe_to_run: authorityAllowsRun && !unsafeReason,
    execution_kind: authorityReason
      ? "authority_blocked"
      : unsafeReason ? "approved_ai_or_external" : "internal",
    safety_reason: authorityReason || unsafeReason,
    safety_classification: taskSafety.classification,
    workflow_safety_classification: workflowSafety.classification,
    commercial_authority_required: Boolean(
      taskSafety.requiresCommercialAuthority
      || workflowSafety.requiresCommercialAuthority,
    ),
    max_cost_cents: maxCostCents,
    run_label: authorityReason
      ? "Review commercial authority"
      : unsafeReason
      ? maxCostCents > 0
        ? "Start approved AI work"
        : "Start approved work"
      : "Run internal step",
  };
}

function importantWork(db, currentJourneyId = latestOperatorJourneyId(db), options = {}) {
  const riskRank = { high: 0, medium: 1, low: 2 };
  const consequentialChoices = [
    ...pendingApprovals(db, options)
      .filter((approval) => belongsToCurrentJourney(approval.taskPayload, currentJourneyId))
      .map((approval) => decisionCard(approval, db)),
    ...pendingHandoffs(db)
      .filter((handoff) => belongsToCurrentJourney(handoff.source_task_payload, currentJourneyId))
      .map(handoffCard),
  ].sort((left, right) => (
    (riskRank[left.risk] ?? 3) - (riskRank[right.risk] ?? 3)
    || String(left.requestedAt || "").localeCompare(String(right.requestedAt || ""))
  ));
  const items = [];
  const unknownTasks = parseRows(all(
    db,
    `SELECT id, venture_id, workflow_id, title, kind, agent, status, outcome_status,
            error, payload, result, created_at, updated_at, '{}' AS metadata
     FROM tasks
     WHERE outcome_status = 'unknown'
        OR status = 'needs_attention'
        OR (status = 'failed' AND outcome_status = 'failed_before_effect')
     ORDER BY updated_at DESC`,
    [],
  ), ["payload", "result"]);
  const completedPilotTasks = parseRows(all(
    db,
    "SELECT id, payload, created_at FROM tasks WHERE kind = 'live_ai_worker_execution' AND status = 'completed' ORDER BY created_at DESC",
    [],
  ), ["payload"]);
  const resolvedTaskIds = supersededRetryTaskIds(db);
  const unknownOutcomeTasks = [];
  for (const task of unknownTasks) {
    if (!belongsToCurrentJourney(task.payload, currentJourneyId)) continue;
    if (resolvedTaskIds.has(task.id)) continue;
    const fixtureId = task.payload?.pilotFixture?.id;
    const correctedRun = fixtureId
      ? completedPilotTasks.find((candidate) => (
        candidate.payload?.pilotFixture?.id === fixtureId
        && Date.parse(candidate.created_at) > Date.parse(task.created_at)
      ))
      : null;
    const journeyId = task.payload?.liveSpendRequest?.parameters?.pantheonJourney?.journeyId;
    const preDispatchRecovery = preDispatchRecoveryStatus(db, task);
    const knownReviewedRetry = task.status === "needs_attention"
      && task.outcome_status === "known_provider_result_needs_review"
      && task.kind === "live_ai_worker_execution"
      && (task.agent === "demand_validator" || Boolean(journeyId));
    const latestAttempt = knownReviewedRetry
      ? get(
        db,
        "SELECT error_kind FROM task_attempts WHERE task_id = ? ORDER BY started_at DESC, id DESC LIMIT 1",
        [task.id],
      )
      : null;
    const reviewedRetryAvailable = preDispatchRecovery.available
      || (
        knownReviewedRetry
        && canPrepareReviewedRetry(task, latestAttempt?.error_kind)
      );
    if (
      task.outcome_status === "unknown"
      && !preDispatchRecovery.available
      && !knownReviewedRetry
    ) {
      unknownOutcomeTasks.push(task);
      continue;
    }
    const issueSummary = /provider tool activity was missing/i.test(String(task.error || ""))
      ? "Pantheon did not recognise the web-research record returned by OpenAI."
      : /invalid output|unterminated string/i.test(String(task.error || ""))
        ? "OpenAI returned an incomplete structured answer that Pantheon could not safely use."
        : "The AI call finished, but Pantheon could not safely accept the local result.";
    items.push({
      id: task.id,
      type: preDispatchRecovery.available
        ? "pre_dispatch_recovery"
        : knownReviewedRetry ? "known_ai_result" : "unknown_outcome",
      title: operatorProductionText(
        db,
        correctedRun ? `${task.title}: first call billing check` : task.title,
        task.payload,
      ),
      risk: preDispatchRecovery.available || knownReviewedRetry ? "medium" : "high",
      summary: preDispatchRecovery.available
        ? "Pantheon stopped locally before contacting OpenAI. No API cost occurred."
        : knownReviewedRetry
          ? `${issueSummary} Pantheon can prepare one corrected attempt; a new model call still needs its own exact approval.`
          : undefined,
      recommendation: correctedRun
        ? "The corrected run completed successfully. Reconcile only the first call's final provider charge; do not run it again."
        : preDispatchRecovery.available
          ? "Prepare a fresh exact decision and run the same stage again."
          : knownReviewedRetry
          ? reviewedRetryAvailable
            ? "Prepare one corrected Luna retry, then review its exact cost limit before it can run."
            : "Keep this result stopped while Jarvis reviews the exact failure record. Another paid call is not available yet."
          : "Check the provider outcome and reconcile any cost before deciding whether another attempt is justified.",
      expectedUpside: correctedRun
        ? "Keeps the cost record accurate without reopening completed work."
        : preDispatchRecovery.available
          ? "Resumes the journey without hiding the failed attempt or spending automatically."
          : knownReviewedRetry
          ? "Tests the repaired path without publishing, customer contact or automatic spend."
          : "Prevents duplicate work, duplicate spend and contradictory state.",
      workflowId: task.workflow_id,
      action: reviewedRetryAvailable ? {
        kind: "prepare_known_ai_retry",
        label: preDispatchRecovery.available ? "Try this stage again" : "Prepare one corrected retry",
      } : null,
    });
  }
  if (unknownOutcomeTasks.length) {
    const taskIds = unknownOutcomeTasks.map((task) => task.id);
    const unknownCost = Number(get(
      db,
      `SELECT COALESCE(SUM(amount_cents), 0) AS cents
       FROM costs
       WHERE status = 'unknown'
         AND task_id IN (${taskIds.map(() => "?").join(", ")})`,
      taskIds,
    )?.cents || 0);
    items.push({
      id: unknownOutcomeTasks[0].id,
      type: "unknown_outcomes_summary",
      title: `${unknownOutcomeTasks.length} earlier AI call${unknownOutcomeTasks.length === 1 ? "" : "s"} need billing reconciliation`,
      risk: "medium",
      recommendation: `Pantheon stopped these timed-out calls and did not retry them. ${unknownCost > 0 ? `A$${(unknownCost / 100).toFixed(2)} remains counted as possible cost until provider billing is reconciled.` : "Their final provider cost is still unknown."}`,
      expectedUpside: "The completed commercial review is preserved; this is an accounting check, not another business decision.",
      workflowId: unknownOutcomeTasks[0].workflow_id,
      action: null,
    });
  }
  const activeValidationPlan = get(
    db,
    `SELECT id, status, metadata, updated_at
     FROM catalogue_plans
     WHERE json_extract(metadata, '$.validationSample') IS NOT NULL
       AND COALESCE(json_extract(metadata, '$.archivedFromOperator'), 0) <> 1
       AND status NOT IN ('cancelled', 'paused', 'validation_sample_ready')
     ORDER BY updated_at DESC LIMIT 1`,
  );
  if (activeValidationPlan) {
    const activePlanMetadata = fromJson(activeValidationPlan.metadata, {});
    const workflowId = activePlanMetadata.validationSample?.workflowId || null;
    const latestPlanCycle = get(
      db,
      `SELECT supervisor_cycles.*
       FROM supervisor_cycles
       LEFT JOIN tasks ON tasks.id = supervisor_cycles.task_id
       WHERE (
         supervisor_cycles.workflow_id = ?
         OR json_extract(
           tasks.payload,
           '$.liveSpendRequest.parameters.pantheonProduction.planId'
         ) = ?
       )
       ORDER BY supervisor_cycles.updated_at DESC LIMIT 1`,
      [workflowId, activeValidationPlan.id],
    );
    if (
      latestPlanCycle?.status === "needs_attention"
      && latestPlanCycle.next_action_type === "developer_review_required"
      && Date.parse(latestPlanCycle.updated_at || "") >= Date.parse(activeValidationPlan.updated_at || "")
      && !items.some((item) => item.id === latestPlanCycle.task_id)
    ) {
      items.push({
        id: latestPlanCycle.id,
        type: "supervisor_failure",
        title: "Pantheon could not prepare the next product check",
        risk: "high",
        summary: "The completed files are safe, but Pantheon could not apply the next local preparation step.",
        recommendation: "Jarvis must repair the local workflow before this buyer test can continue. No paid retry is ready.",
        expectedUpside: "Restores the exact buyer-test path without repeating paid AI work or hiding the failure.",
        workflowId: latestPlanCycle.workflow_id || workflowId,
        action: null,
      });
    }
  }
  const urgent = parseRows(all(
    db,
    "SELECT * FROM messages WHERE status = 'open' AND severity = 'urgent' ORDER BY created_at DESC LIMIT 10",
  ));
  for (const message of urgent) {
    if (
      unknownOutcomeTasks.length
      && (
        ["cost", "unknown_outcome"].includes(message.metadata?.category)
        || message.metadata?.outcomeUnknown === true
      )
    ) continue;
    let messageTaskPayload = {};
    if (message.task_id) {
      const messageTask = get(db, "SELECT payload FROM tasks WHERE id = ?", [message.task_id]);
      messageTaskPayload = fromJson(messageTask?.payload, {});
      if (messageTask && !belongsToCurrentJourney(fromJson(messageTask.payload, {}), currentJourneyId)) continue;
    }
    if (items.some((item) => item.id === message.task_id || item.title === message.subject)) continue;
    items.push({
      id: message.id,
      type: "attention",
      title: operatorProductionText(db, message.subject, messageTaskPayload),
      risk: "high",
      recommendation: operatorProductionText(db, message.body, messageTaskPayload),
      expectedUpside: "Resolve the issue that is stopping trusted progress.",
    });
  }
  if (consequentialChoices.length) {
    items.push(consequentialChoices[0]);
  }
  const waitingTasks = parseRows(all(
    db,
    `SELECT tasks.id, tasks.venture_id, tasks.workflow_id, tasks.title, tasks.kind,
            tasks.agent, tasks.status, tasks.approval_id, tasks.cost_budget_cents,
            tasks.payload, tasks.result, tasks.created_at,
            tasks.updated_at, agent_definitions.name AS worker_name
     FROM tasks
     LEFT JOIN agent_definitions ON agent_definitions.id = tasks.agent
     WHERE tasks.status IN ('queued', 'planned')
       AND NOT EXISTS (
         SELECT 1 FROM tasks AS earlier
         WHERE earlier.workflow_id = tasks.workflow_id
           AND earlier.id <> tasks.id
           AND earlier.status IN ('planned', 'queued', 'running', 'blocked', 'waiting_approval', 'needs_attention')
           AND (
             earlier.priority < tasks.priority
             OR (earlier.priority = tasks.priority AND earlier.created_at < tasks.created_at)
             OR (earlier.priority = tasks.priority AND earlier.created_at = tasks.created_at AND earlier.id < tasks.id)
           )
       )
     ORDER BY CASE tasks.status WHEN 'queued' THEN 0 ELSE 1 END, tasks.priority, tasks.created_at
     LIMIT 3`,
  ), ["payload", "result"]);
  for (const task of waitingTasks) {
    if (!belongsToCurrentJourney(task.payload, currentJourneyId)) continue;
    if (items.some((item) => item.id === task.id)) continue;
    const execution = taskExecutionPresentation(db, task);
    const authorityBlocked = execution.execution_kind === "authority_blocked";
    items.push({
      id: task.id,
      type: authorityBlocked
        ? "authority_blocked_work"
        : execution.safe_to_run ? "queued_work" : "approved_work",
      title: `${operatorProductionText(db, task.title, task.payload)} ${
        authorityBlocked ? "cannot start" : "is waiting to start"
      }`,
      risk: execution.safe_to_run ? "low" : "medium",
      recommendation: authorityBlocked
        ? "This retained work is not authorised to run. Review the exact current commercial authority in Tests & Results before continuing."
        : execution.safe_to_run
        ? `${task.worker_name || task.agent || "The AI team"} has a protected internal step queued. Run this exact item now or leave it queued.`
        : `${task.worker_name || task.agent || "The AI team"} has an exact approved action ready. Starting it is not internal-only${execution.max_cost_cents > 0 ? ` and may use up to ${execution.max_cost_cents} cents AUD` : ""}.`,
      expectedUpside: authorityBlocked
        ? "Prevents unbound, terminal, or separately protected commercial work from being presented as runnable."
        : execution.safe_to_run
        ? "Advances protected work without enabling broad autopilot or an external action."
        : "Runs only the exact previously approved action while keeping its provider, tools, limits and cost cap fixed.",
      workflowId: task.workflow_id,
      ...execution,
    });
  }
  return items.slice(0, 12);
}

function testStatus(status) {
  const normalized = String(status || "").toLowerCase();
  if (["ready", "ready_to_run", "approved"].includes(normalized)) return "ready";
  if (["running", "active", "in_market"].includes(normalized)) return "running";
  if (["completed", "finished", "measured"].includes(normalized)) return "completed";
  if (["cancelled", "killed", "paused"].includes(normalized)) return "cancelled";
  return "candidate";
}

function presentedDeliverablesByIds(db, sourceIds = []) {
  const ids = [...new Set(sourceIds.filter(Boolean))];
  if (!ids.length) return [];
  const rows = all(
    db,
    `SELECT *
     FROM deliverables
     WHERE id IN (${ids.map(() => "?").join(", ")})
       AND status <> 'archived'`,
    ids,
  ).map((row) => operatorDeliverable({
    ...row,
    metadata: fromJson(row.metadata, {}),
  }));
  const byId = new Map(rows.map((row) => [row.id, row]));
  return ids.map((id) => byId.get(id)).filter(Boolean).map((row) => ({
    id: row.id,
    name: row.human_name,
    format: row.format,
    bytes: Number(row.metadata?.bytes || 0),
    status: row.status,
    summary: row.summary,
    qualityReviewOnly: row.metadata?.qualityReviewOnly === true,
    evidenceRole: row.metadata?.evidenceRole || null,
    derivedFromActualSavedFile: row.metadata?.derivedFromActualSavedFile === true,
  }));
}

function validationSampleDeliverables(db, plan) {
  const metadata = plan?.metadata || {};
  return presentedDeliverablesByIds(db, [
    ...(metadata.generatedFileIds || []),
    ...(metadata.storefrontPreviewIds || []),
  ]);
}

function currentBuyerIntentValidation(db, ventureId = null, planId = null) {
  const planRow = get(
    db,
    `SELECT *
     FROM catalogue_plans
     WHERE json_extract(metadata, '$.validationSample') IS NOT NULL
       AND COALESCE(json_extract(metadata, '$.archivedFromOperator'), 0) <> 1
       AND (? IS NULL OR venture_id = ?)
       AND (? IS NULL OR id = ?)
     ORDER BY updated_at DESC LIMIT 1`,
    [ventureId, ventureId, planId, planId],
  );
  if (!planRow) return null;
  const plan = {
    ...planRow,
    metadata: fromJson(planRow.metadata, {}),
  };
  const contract = plan.metadata.validationSample || {};
  const experiment = contract.experimentId
    ? get(db, "SELECT id, name, status, updated_at FROM commercial_experiments WHERE id = ?", [contract.experimentId])
    : null;
  const marketResultCount = experiment?.id
    ? Number(get(
      db,
      "SELECT COUNT(*) AS count FROM commercial_results WHERE experiment_id = ?",
      [experiment.id],
    )?.count || 0)
    : 0;
  const finalTaskId = plan.metadata.inspectionEvidenceRecheckTaskId
    || plan.metadata.qualityTaskId
    || plan.metadata.explicitFinalReviewTaskId
    || null;
  const finalTask = finalTaskId
    ? get(
      db,
      "SELECT id, title, status, approval_id, cost_budget_cents, updated_at FROM tasks WHERE id = ?",
      [finalTaskId],
    )
    : null;
  const recordedQualityReviewTasks = Number(get(
    db,
    `SELECT COUNT(DISTINCT json_extract(payload, '$.liveSpendRequest.parameters.pantheonProduction.reviewFingerprint')) AS count
     FROM tasks
     WHERE kind = 'live_ai_worker_execution'
       AND status IN ('running', 'completed', 'failed', 'needs_attention')
       AND json_extract(payload, '$.liveSpendRequest.parameters.pantheonProduction.planId') = ?
       AND json_extract(payload, '$.liveSpendRequest.parameters.pantheonProduction.stage') = 'quality_review'`,
    [plan.id],
  )?.count || 0);
  const recordedFiles = Array.isArray(plan.metadata.validationSampleDeliverables)
    ? plan.metadata.validationSampleDeliverables
    : [];
  const terminalInspectionRecheck = new Set([
    "inspection_evidence_recheck_failed_terminal",
    "inspection_evidence_recheck_declined_terminal",
  ]).has(plan.metadata.buildStatus);
  let status = "product_being_built";
  if (terminalInspectionRecheck) status = "stopped_permanently";
  else if (plan.status === "needs_attention") status = "product_needs_attention";
  else if (
    plan.status === "validation_sample_ready"
    && plan.metadata.validationSampleDeliverables?.length
  ) status = "buyer_test_ready";
  else if (finalTask?.status === "running") status = "final_review_running";
  else if (["blocked", "waiting_approval"].includes(finalTask?.status)) {
    status = "waiting_for_final_review_decision";
  } else if (["queued", "planned"].includes(finalTask?.status)) {
    status = "final_review_queued";
  } else if (plan.metadata.qualityReviewLimitReached === true) {
    status = "corrected_files_waiting_for_review";
  }
  return {
    planId: plan.id,
    opportunityId: plan.opportunity_id,
    experimentId: experiment?.id || contract.experimentId || null,
    name: plan.metadata.productManifest?.packageTitle
      || contract.sample?.item?.title
      || experiment?.name
      || contract.sample?.packageTitle
      || "Buyer-intent validation product",
    buyer: contract.buyer || null,
    offer: contract.offer || null,
    priceCents: Number(contract.priceCents || 0),
    channel: contract.channel || null,
    measurement: contract.measurement || null,
    status,
    planStatus: plan.status,
    buildStatus: plan.metadata.buildStatus || null,
    recordedQualityReviewTasks,
    inspectionEvidenceRecheckLimit: 1,
    inspectionEvidenceRecheckExhausted:
      plan.metadata.inspectionEvidenceRecheckExhausted === true,
    finalTask,
    finalApprovalId: finalTask?.approval_id
      || plan.metadata.inspectionEvidenceRecheckApprovalId
      || plan.metadata.explicitFinalReviewApprovalId
      || null,
    finalReviewCapCents: Number(
      contract.providerPolicy?.qualityReviewerCapCents || finalTask?.cost_budget_cents || 0,
    ),
    inspectionEvidenceRecheck:
      plan.metadata.buildStatus === "inspection_evidence_repaired_pending_recheck",
    terminal: terminalInspectionRecheck,
    terminalReason: terminalInspectionRecheck
      ? plan.metadata.buildStatus
      : null,
    marketResultCount,
    marketEvidenceRecorded: marketResultCount > 0,
    investmentCaseRemainsParked: contract.investmentCaseRemainsParked !== false,
    externalActionsAllowed: contract.externalActionsAllowed === true,
    files: recordedFiles.length ? recordedFiles : validationSampleDeliverables(db, plan),
  };
}

function digestWithCurrentAttention(
  db,
  digest,
  work,
  ventureId,
  currentJourneyId = null,
  commercialTests = null,
) {
  if (!digest) return null;
  const importantItems = work.length;
  const completedWork = Number(currentJourneyId
    ? get(
      db,
      `SELECT COUNT(*) AS count
       FROM tasks
       WHERE status = 'completed'
         AND completed_at >= ? AND completed_at < ?
         AND COALESCE(
           json_extract(payload, '$.liveSpendRequest.parameters.pantheonJourney.journeyId'),
           json_extract(payload, '$.liveSpendRequest.parameters.pantheonCommercial.journeyId'),
           json_extract(payload, '$.liveSpendRequest.parameters.pantheonProduction.journeyId')
         ) = ?`,
      [digest.period_start, digest.period_end, currentJourneyId],
    )?.count || 0
    : get(
      db,
      `SELECT COUNT(*) AS count
       FROM tasks
       WHERE venture_id = ? AND status = 'completed'
         AND completed_at >= ? AND completed_at < ?`,
      [ventureId, digest.period_start, digest.period_end],
    )?.count || 0);
  const canonicalMetrics = digest.metrics || {};
  const commercialIntegrityOk = (
    canonicalMetrics.commercialIntegrityStatus === "ok"
  );
  const currentTest = commercialIntegrityOk
    && canonicalMetrics.currentTest
    && canonicalMetrics.currentTest.canonicalOwnerProjection === true
    ? canonicalMetrics.currentTest
    : null;
  const verifiedBuyers = commercialIntegrityOk
    && Number.isSafeInteger(canonicalMetrics.verifiedBuyerCount)
    && canonicalMetrics.verifiedBuyerCount >= 0
    ? canonicalMetrics.verifiedBuyerCount
    : null;
  const buyerTarget = Number.isSafeInteger(canonicalMetrics.buyerTarget)
    ? canonicalMetrics.buyerTarget
    : currentTest
      ? 3
      : null;
  const cashSettled = (
    commercialIntegrityOk
    && canonicalMetrics.cashStatus === "settled"
    && canonicalMetrics.salesCurrency === "AUD"
    && Number.isSafeInteger(canonicalMetrics.cashContributionCents)
  );
  const buyerStatement = !commercialIntegrityOk
    ? "Verified buyer count is withheld."
    : !currentTest
      ? "No current commercial test buyer result is available."
      : verifiedBuyers === null
        ? "Verified buyer count is withheld."
        : `${verifiedBuyers} of ${buyerTarget} verified independent paying buyers recorded.`;
  const cashStatement = !commercialIntegrityOk
    ? "Net cash contribution is withheld."
    : !currentTest
      ? "No current commercial test cash result is available."
    : cashSettled
      ? `A$${(canonicalMetrics.cashContributionCents / 100).toFixed(2)} settled net cash contribution recorded.`
      : "Net cash contribution: Not settled.";
  const testStatement = !commercialIntegrityOk
    ? commercialTests?.integrity?.message
      || "Commercial test authority could not be verified."
    : currentTest
      ? `The canonical commercial test is ${String(
        currentTest.status || "recorded",
      ).replace(/[_-]+/g, " ")}.`
      : "No commercial test is authorised.";
  const summary = [
    `${completedWork} internal work item${completedWork === 1 ? "" : "s"} completed this week.`,
    buyerStatement,
    cashStatement,
    testStatement,
    importantItems
      ? `${importantItems} item${importantItems === 1 ? " needs" : "s need"} operator attention.`
      : digest.status === "attention_needed"
        ? "Commercial or operating truth needs operator attention."
        : "No consequential exception needs operator attention.",
  ].join(" ");
  return {
    ...digest,
    status: importantItems || digest.status === "attention_needed"
      ? "attention_needed"
      : "on_track",
    summary,
    metrics: {
      ...canonicalMetrics,
      completedWork,
      liveImportantItems: importantItems,
    },
  };
}

function retiredPortfolioTask(db, task) {
  const roundId = task?.payload?.liveSpendRequest?.parameters
    ?.pantheonCommercial?.roundId;
  if (!roundId) return null;
  const round = get(
    db,
    "SELECT id, mode, status FROM opportunity_rounds WHERE id = ?",
    [roundId],
  );
  if (!round || !["portfolio_discovery", "targeted_diligence"].includes(round.mode)) {
    return null;
  }
  return round;
}

function teamTaskPresentation(db, task) {
  const retainedRound = retiredPortfolioTask(db, task);
  if (retainedRound) {
    return {
      kind: "retained",
      status: "Retained history",
      assignment: "Earlier portfolio work is retained for audit; no work is running.",
      authorityClassification: "retired_portfolio_history",
    };
  }
  const safety = classifyCommercialTaskSafety(db, task);
  if (!safety.safe) {
    return {
      kind: "blocked",
      status: "Needs attention",
      assignment: `Recorded work is blocked until its exact authority is valid: ${
        operatorProductionText(db, task.title, task.payload)
      }`,
      authorityClassification: safety.classification || "authority_blocked",
    };
  }
  return {
    kind: "active",
    status: humanTaskStatus(task.status),
    assignment: operatorProductionText(db, task.title, task.payload),
    authorityClassification: safety.classification,
  };
}

function teamState(
  db,
  ventureId,
  currentJourneyId = latestOperatorJourneyId(db),
  currentJourneyTaskId = null,
) {
  ensureCapabilityAutonomy(db);
  const definitions = listAgentDefinitions(db);
  const capabilities = parseRows(all(db, "SELECT * FROM capability_autonomy ORDER BY capability_key"));
  const groups = {
    command: ["chief_of_staff"],
    evidence: ["opportunity_scout", "demand_validator"],
    venture: ["offer_architect", "product_builder", "copy_conversion_agent", "distribution_operator"],
    control: ["finance_analyst", "customer_voice_agent", "growth_analyst", "quality_reviewer"],
  };
  const groupByAgent = Object.fromEntries(Object.entries(groups).flatMap(([group, ids]) => ids.map((id) => [id, group])));
  const resolvedTaskIds = supersededRetryTaskIds(db);
  return definitions.map((definition) => {
    const latestRun = get(
      db,
      `SELECT agent_runs.*, tasks.title AS task_title, tasks.status AS task_status,
              tasks.payload AS task_payload
       FROM agent_runs LEFT JOIN tasks ON tasks.id = agent_runs.task_id
       WHERE agent_runs.agent_id = ?
         AND (agent_runs.venture_id = ? OR agent_runs.venture_id = 'venture-portfolio-controller' OR agent_runs.venture_id IS NULL)
       ORDER BY agent_runs.started_at DESC LIMIT 1`,
      [definition.id, ventureId],
    );
    const taskCandidates = parseRows(all(
      db,
      `SELECT * FROM tasks
       WHERE (venture_id = ? OR venture_id = 'venture-portfolio-controller') AND agent = ?
         AND status IN ('running','queued','blocked','waiting_approval','needs_attention')
       ORDER BY updated_at DESC LIMIT 20`,
      [ventureId, definition.id],
    ), ["payload", "result"]).filter((task) => (
      belongsToCurrentJourney(task.payload, currentJourneyId)
      && !resolvedTaskIds.has(task.id)
    ));
    const presentedTasks = taskCandidates.map((task) => ({
      task,
      presentation: teamTaskPresentation(db, task),
    }));
    const selectedTask = presentedTasks.find(
      (item) => item.task.id === currentJourneyTaskId,
    ) || presentedTasks.find(
      (item) => item.presentation.kind === "active",
    ) || presentedTasks[0] || null;
    const activeTask = selectedTask?.task || null;
    const taskPresentation = selectedTask?.presentation || null;
    const agentCapabilities = capabilities
      .filter((item) => item.agent_id === definition.id)
      .sort((left, right) => (
        Number(right.consecutive_passes || 0) - Number(left.consecutive_passes || 0)
        || Number(right.required_passes || 5) - Number(left.required_passes || 5)
        || String(left.capability_key).localeCompare(String(right.capability_key))
      ));
    const capability = agentCapabilities[0];
    const latestTaskPayload = fromJson(latestRun?.task_payload, {});
    return {
      id: definition.id,
      name: definition.name,
      group: groupByAgent[definition.id] || "control",
      status: taskPresentation?.status || "Standby",
      assignment: taskPresentation?.assignment || "No current assignment",
      lastOutcome: operatorProductionText(
        db,
        latestRun?.output_summary || "No reviewed result yet",
        latestTaskPayload,
      ),
      autonomy: capability
        ? {
            status: capability.status,
            passes: capability.consecutive_passes,
            required: capability.required_passes,
            riskTier: capability.risk_tier,
            capabilityKey: capability.capability_key,
            capabilityCount: agentCapabilities.length,
          }
        : { status: "supervised", passes: 0, required: 5, riskTier: 0, capabilityKey: null, capabilityCount: 0 },
      technical: {
        modelClass: definition.model_class,
        mode: definition.mode,
        lastRunId: latestRun?.id || null,
        authorityClassification:
          taskPresentation?.authorityClassification || "no_current_assignment",
      },
    };
  });
}

function spendState(db) {
  const budget = fromJson(get(db, "SELECT value FROM settings WHERE key = 'budget'")?.value, {});
  const month = new Date().toISOString().slice(0, 7);
  const rows = all(
    db,
    "SELECT status, COALESCE(SUM(amount_cents), 0) AS cents FROM costs WHERE substr(occurred_at, 1, 7) = ? GROUP BY status",
    [month],
  );
  const byStatus = Object.fromEntries(rows.map((row) => [row.status, Number(row.cents || 0)]));
  const reservations = all(
    db,
    "SELECT status, COALESCE(SUM(amount_cents), 0) AS cents FROM budget_reservations WHERE substr(reserved_at, 1, 7) = ? GROUP BY status",
    [month],
  );
  const reservedByStatus = Object.fromEntries(reservations.map((row) => [row.status, Number(row.cents || 0)]));
  const monthlyCap = Number(budget.monthlyBudgetCents || CONFIG.monthlyBudgetCents);
  const exposure = monthlyBudgetExposure(db, { month });
  return {
    currency: budget.currency || CONFIG.currency,
    month,
    monthlyCapCents: monthlyCap,
    exposureCents: exposure.totalCents,
    availableCents: Math.max(0, monthlyCap - exposure.totalCents),
    reconciledCents: Number(byStatus.reconciled || 0),
    incurredEstimateCents: Number(byStatus.incurred_estimate || 0),
    unknownCents: Number(byStatus.unknown || 0),
    reservedCents: Number(reservedByStatus.reserved || 0),
    accounting: getAccountingSummary(db),
  };
}

function canonicalCockpitCommercialState(ownerTests) {
  const integrityOk = ownerTests?.integrity?.status === "ok";
  const current = integrityOk
    ? ownerTests.current
    : null;
  const hasCurrent = Boolean(current);
  const netCash = current?.proof?.netCashContribution || {};
  const buyers = integrityOk && hasCurrent
    ? Number.isSafeInteger(current?.proof?.buyers?.verifiedPositive)
      ? current.proof.buyers.verifiedPositive
      : 0
    : null;
  const cashSettled = (
    integrityOk
    && netCash.status === "settled"
    && netCash.currency === "AUD"
    && Number.isSafeInteger(netCash.amountCents)
  );
  return {
    currentTest: current ? {
      id: current.auditRef,
      name: current.title,
      status: current.lifecycle?.status || "proposed",
      hypothesis: current.hypothesis,
      buyer: current.buyer,
      problem: current.problem,
      offer: current.offer?.description || "",
      channel: current.channel?.label || current.channel?.id || "",
      price_cents: current.price?.currency === "AUD"
        ? current.price.amountCents
        : null,
      reportingPeriod: current.reportingPeriod,
      proof: current.proof,
      evidenceQuality: current.evidenceQuality,
      canonicalOwnerProjection: true,
    } : null,
    economics: {
      schema: "pantheon.owner-commercial-economics.v1",
      salesCurrency: "AUD",
      independentBuyers: buyers,
      buyerTarget: integrityOk && hasCurrent
        ? Number.isSafeInteger(current?.proof?.buyers?.target)
          ? current.proof.buyers.target
          : 3
        : null,
      commercialIntegrityStatus: ownerTests?.integrity?.status || "attention",
      commercialAuthorityStatus:
        ownerTests?.integrity?.authorityStatus || "unavailable",
      buyerProofStatus: integrityOk
        ? hasCurrent ? "verified" : "not_current"
        : "withheld",
      cashContributionStatus: integrityOk
        ? hasCurrent
          ? cashSettled ? "settled" : "not_settled"
          : "not_current"
        : "withheld",
      cashContributionCents: cashSettled ? netCash.amountCents : null,
      cashContributionLabel: integrityOk
        ? hasCurrent
          ? cashSettled ? netCash.label : "Not settled"
          : "No current test result"
        : "Withheld — commercial truth needs review",
    },
  };
}

function getCockpitState(db, options = {}) {
  const commercial = commercialFoundationState(db);
  const commercialTests = getCommercialOwnerTestsState(db);
  const canonicalCommercial = canonicalCockpitCommercialState(commercialTests);
  const preventureResearch = preventureOwnerProjection(db, options);
  const preventureResearchRuntime = preventureRuntimeProjection(options);
  const preventureOwnerGate = preventureResearch.current
    || preventureResearch.history?.items?.[0]
    || null;
  const opportunity = getOpportunityState(db);
  const production = getProductionState(db);
  const currentJourney = currentOperatorJourney(db);
  const currentJourneyId = currentJourney?.id || null;
  const journeyTaskRecord = currentJourney?.metadata?.currentTaskId
    ? get(
      db,
      `SELECT id, workflow_id, title, kind, agent, status, approval_id,
              outcome_status, error, payload, updated_at
       FROM tasks WHERE id = ?`,
      [currentJourney.metadata.currentTaskId],
    )
    : null;
  const journeyTask = journeyTaskRecord
    ? {
      ...journeyTaskRecord,
      title: operatorProductionText(
        db,
        journeyTaskRecord.title,
        fromJson(journeyTaskRecord.payload, {}),
      ),
      payload: undefined,
    }
    : null;
  const journeyExecution = journeyExecutionState(
    db,
    currentJourney,
    journeyTaskRecord,
    canonicalCommercial.currentTest,
  );
  const team = teamState(
    db,
    commercial.venture.id,
    currentJourneyId,
    currentJourney?.metadata?.currentTaskId || null,
  );
  const work = importantWork(db, currentJourneyId, options);
  const legacyBuyerIntentValidation = currentBuyerIntentValidation(db);
  const buyerIntentValidation = null;
  const test = canonicalCommercial.currentTest;
  const operationalTasks = parseRows(all(
    db,
    "SELECT * FROM tasks WHERE status IN ('planned','queued','running','failed','needs_attention')",
  ), ["payload"]).filter((task) => belongsToCurrentJourney(task.payload, currentJourneyId));
  const operationalTaskStates = operationalTasks.map((task) => ({
    task,
    retained: Boolean(retiredPortfolioTask(db, task)),
    safety: classifyCommercialTaskSafety(db, task),
  }));
  const queueCount = operationalTaskStates.filter(({ task, retained, safety }) => (
    !retained
      && safety.safe
      && ["planned", "queued", "running"].includes(task.status)
  )).length;
  const failedCount = operationalTaskStates.filter(({ task, retained, safety }) => (
    !retained
      && (
        ["failed", "needs_attention"].includes(task.status)
        || !safety.safe
      )
  )).length;
  const activeRuns = getAgentRunsState(db, { state: "active", limit: 10 }).runs;
  const portfolio = getPortfolioState(db);
  return {
    generatedAt: new Date().toISOString(),
    activeVenture: commercial.venture,
    ventureCase: commercial.ventureCase,
    importantWork: work,
    currentTest: test,
    commercialTests,
    preventureResearch,
    preventureResearchRuntime,
    buyerIntentValidation,
    historicalCommercialContext: legacyBuyerIntentValidation ? {
      exists: true,
      label: "Historical buyer-intent record retained for audit only.",
      authoritative: false,
      currentBuyerOrCashEvidence: false,
    } : null,
    activeRuns,
    nextMoneyMove: commercialTests.current?.moneyMove?.title
      || preventureOwnerGate?.nextAction
      || commercialTests.emptyState?.title
      || "No commercial test is authorised.",
    economics: canonicalCommercial.economics,
    spend: spendState(db),
    teamPulse: {
      working: team.filter((agent) => agent.status === "Working").length,
      waiting: team.filter((agent) => agent.status === "Waiting to start").length,
      needsAttention: team.filter((agent) => agent.status === "Needs attention").length,
      standby: team.filter((agent) => agent.status === "Standby").length,
      retainedHistory: team.filter((agent) => agent.status === "Retained history").length,
      agents: team,
    },
    health: {
      label: failedCount > 0
        ? "Needs attention"
        : queueCount > 0
          ? "Work waiting"
          : "Operating normally",
      queuedWork: queueCount,
      importantItems: work.length,
      proofMode: CONFIG.systemProofMode === true,
      monitoring: runtimeMonitoringHealth(db),
      preventureResearch: {
        status: preventureResearch.integrity?.status || "attention",
        authorityStatus: preventureResearch.integrity?.authorityStatus || "unavailable",
        executionStatus: preventureResearchRuntime.status,
      },
    },
    weeklyDigest: digestWithCurrentAttention(
      db,
      getCanonicalOwnerDigest(db),
      work,
      commercial.venture.id,
      currentJourneyId,
      commercialTests,
    ),
    currentJourney: currentJourney ? {
      id: currentJourney.id,
      mode: currentJourney.mode,
      status: currentJourney.status,
      activeStage: currentJourney.active_stage,
      model: currentJourney.model,
      updatedAt: currentJourney.updated_at,
      currentTask: journeyTask,
      execution: journeyExecution,
    } : null,
    commercialDiscovery: {
      activeRound: opportunity.activeRound,
      latestRound: opportunity.latestRound,
      currentTask: opportunity.currentTask,
      topOpportunity: opportunity.topOpportunity,
      cataloguePlan: opportunity.cataloguePlans[0] || null,
      mandate: opportunity.mandate,
      production,
      portfolio: {
        activeRound: portfolio.activeRound,
        evidenceRoundCount: portfolio.evidenceRoundCount,
        technicalFailureCount: portfolio.technicalFailureCount,
        selectedInvestmentCase: portfolio.selectedInvestmentCase,
        nextAction: portfolio.nextAction,
      },
    },
  };
}

function getDecisionsState(db, options = {}) {
  const approvals = [
    ...pendingApprovals(db, options).map((approval) => decisionCard(approval, db)),
    ...pendingHandoffs(db).map(handoffCard),
  ];
  const reviews = parseRows(all(
    db,
    `SELECT * FROM deliverables
     WHERE status = 'ready_for_review'
     ORDER BY updated_at DESC LIMIT 20`,
  )).map(operatorDeliverable).map((deliverable) => ({
    id: deliverable.id,
    title: deliverable.human_name,
    summary: deliverable.summary,
    format: deliverable.format,
    filePath: deliverable.file_path,
    workflowId: deliverable.workflow_id,
    updatedAt: deliverable.updated_at,
  }));
  const suggestions = parseRows(all(
    db,
    `SELECT messages.*, tasks.payload AS task_payload
     FROM messages
     LEFT JOIN tasks ON tasks.id = messages.task_id
     WHERE messages.status = 'open'
       AND messages.severity NOT IN ('urgent','approval')
     ORDER BY messages.created_at DESC LIMIT 20`,
  ), ["metadata", "task_payload"]).map((message) => ({
    id: message.id,
    title: operatorProductionText(
      db,
      message.subject,
      message.task_payload || {},
    ),
    summary: operatorProductionText(
      db,
      message.body,
      message.task_payload || {},
    ),
    createdAt: message.created_at,
  }));
  const approvalHistory = parseRows(all(
    db,
    `SELECT approvals.*, tasks.payload AS task_payload
     FROM approvals
     LEFT JOIN tasks ON tasks.id = approvals.task_id
     WHERE approvals.status <> 'pending'
     ORDER BY approvals.decided_at DESC LIMIT 30`,
  )).map((approval) => ({
    id: approval.id,
    title: operatorProductionText(
      db,
      approval.title,
      fromJson(approval.task_payload, {}),
    ),
    decision: approval.status,
    note: approval.decision_note,
    decidedAt: approval.decided_at,
  }));
  const handoffHistory = parseRows(all(
    db,
    `SELECT agent_handoffs.*, source_tasks.payload AS source_task_payload
     FROM agent_handoffs
     LEFT JOIN tasks AS source_tasks ON source_tasks.id = agent_handoffs.task_id
     WHERE agent_handoffs.status NOT IN (
       'needs_operator_decision',
       'waiting_for_review',
       'waiting_approval'
     )
       AND agent_handoffs.resolved_at IS NOT NULL
     ORDER BY agent_handoffs.resolved_at DESC LIMIT 30`,
  ), ["metadata", "source_task_payload"]).map((handoff) => ({
    id: handoff.id,
    title: operatorProductionText(
      db,
      handoff.decision_needed || "AI team next step",
      handoff.source_task_payload || {},
    ),
    decision: handoff.status,
    note: operatorProductionText(
      db,
      handoff.metadata?.operatorDecision?.note || handoff.summary,
      handoff.source_task_payload || {},
    ),
    decidedAt: handoff.resolved_at,
  }));
  const history = [...approvalHistory, ...handoffHistory]
    .sort((a, b) => String(b.decidedAt || "").localeCompare(String(a.decidedAt || "")))
    .slice(0, 30);
  return { approvals, reviews, suggestions, history };
}

function getBusinessTestsState(db) {
  return getCommercialOwnerTestsState(db);
}

function getHistoricalBusinessTestsState(db) {
  const commercial = commercialFoundationState(db);
  const opportunity = getOpportunityState(db);
  const production = getProductionState(db);
  const buyerIntentValidation = currentBuyerIntentValidation(db);
  const experiments = parseRows(all(
    db,
    `SELECT commercial_experiments.*, ventures.name AS venture_name,
            ventures.is_active AS venture_is_active
     FROM commercial_experiments
     LEFT JOIN ventures ON ventures.id = commercial_experiments.venture_id
     WHERE (
         commercial_experiments.venture_id = ?
         OR json_extract(commercial_experiments.metadata, '$.buyerIntentValidation') IS NOT NULL
       )
       AND COALESCE(json_extract(commercial_experiments.metadata, '$.archivedFromOperator'), 0) <> 1
     ORDER BY commercial_experiments.updated_at DESC`,
    [commercial.venture.id],
  )).map((experiment) => {
    const currentBuyerIntentTest = buyerIntentValidation?.experimentId === experiment.id;
    return {
      ...experiment,
      name: currentBuyerIntentTest
        ? buyerIntentValidation.name
        : experiment.name,
      status: currentBuyerIntentTest && buyerIntentValidation.status !== "buyer_test_ready"
        ? buyerIntentValidation.terminal
          ? "cancelled"
          : "candidate"
        : testStatus(experiment.status),
      workflowStatus: currentBuyerIntentTest
        ? buyerIntentValidation.status
        : null,
      preVenture: Boolean(experiment.metadata?.buyerIntentValidation),
    };
  });
  const tests = { candidate: [], ready: [], running: [], completed: [], cancelled: [] };
  for (const experiment of experiments) tests[experiment.status].push(experiment);
  return {
    activeVenture: commercial.venture,
    ventureCase: commercial.ventureCase,
    economics: commercial.economics,
    pilotPolicy: fromJson(get(db, "SELECT value FROM settings WHERE key = 'commercial.pilot'")?.value, {}),
    opportunityRounds: opportunity.rounds,
    opportunities: opportunity.opportunities,
    cataloguePlans: opportunity.cataloguePlans,
    catalogueItems: opportunity.catalogueItems,
    production,
    buyerIntentValidation,
    tests,
    workPackages: parseRows(all(db, "SELECT * FROM work_packages WHERE venture_id = ? ORDER BY created_at DESC", [commercial.venture.id])),
    evidence: commercial.evidence,
    sales: parseRows(all(
      db,
      `SELECT id, product_name, sold_at, currency, gross_cents, platform_fee_cents,
              net_cents, refunded_cents, referrer, status, imported_at
       FROM platform_sales WHERE venture_id = ? ORDER BY sold_at DESC LIMIT 100`,
      [commercial.venture.id],
    )),
  };
}

const ACTIVE_RUN_STATUSES = new Set(["running", "started", "in_progress"]);

function parseTask(row) {
  return row ? {
    ...row,
    payload: fromJson(row.payload, {}),
    result: fromJson(row.result, {}),
  } : null;
}

function modelCallForRun(db, runRecord) {
  if (runRecord.model_call_id) {
    const exact = get(db, "SELECT * FROM model_calls WHERE id = ?", [runRecord.model_call_id]);
    if (exact) return { ...exact, metadata: fromJson(exact.metadata, {}) };
  }
  if (!runRecord.task_id) return null;
  const attempt = get(
    db,
    `SELECT attempt_id
     FROM agent_eval_results
     WHERE run_id = ? AND attempt_id IS NOT NULL
     ORDER BY created_at DESC, id DESC LIMIT 1`,
    [runRecord.id],
  ) || get(
    db,
    `SELECT attempt_id
     FROM agent_run_receipts
     WHERE run_id = ? AND attempt_id IS NOT NULL
     ORDER BY sequence DESC LIMIT 1`,
    [runRecord.id],
  );
  if (attempt?.attempt_id) {
    const exactAttemptCall = get(
      db,
      "SELECT * FROM model_calls WHERE attempt_id = ? ORDER BY created_at DESC, id DESC LIMIT 1",
      [attempt.attempt_id],
    );
    if (exactAttemptCall) {
      return { ...exactAttemptCall, metadata: fromJson(exactAttemptCall.metadata, {}) };
    }
  }
  const runCount = Number(get(
    db,
    "SELECT COUNT(*) AS count FROM agent_runs WHERE task_id = ?",
    [runRecord.task_id],
  )?.count || 0);
  if (runCount !== 1) return null;
  const fallback = get(
    db,
    "SELECT * FROM model_calls WHERE task_id = ? ORDER BY created_at DESC LIMIT 1",
    [runRecord.task_id],
  );
  return fallback ? { ...fallback, metadata: fromJson(fallback.metadata, {}) } : null;
}

function exactCostForRun(db, runRecord, task, modelCall) {
  if (!task) return null;
  const exact = get(db, "SELECT * FROM costs WHERE id = ?", [spendCostId(task.id)]);
  if (exact) {
    const parsed = { ...exact, metadata: fromJson(exact.metadata, {}) };
    const exactMatchesCall = modelCall && (
      parsed.metadata?.modelCallId === modelCall.id
      || (modelCall.provider_request_id && parsed.metadata?.providerResponseId === modelCall.provider_request_id)
    );
    const runCount = Number(get(
      db,
      "SELECT COUNT(*) AS count FROM agent_runs WHERE task_id = ?",
      [task.id],
    )?.count || 0);
    if (exactMatchesCall || runCount === 1) return parsed;
  }
  if (!modelCall || !task.workflow_id) return null;
  const candidates = all(
    db,
    "SELECT * FROM costs WHERE workflow_id = ? AND category IN ('live_ai_worker', 'live_research') ORDER BY occurred_at DESC",
    [task.workflow_id],
  ).map((row) => ({ ...row, metadata: fromJson(row.metadata, {}) }));
  return candidates.find((row) => (
    row.metadata?.modelCallId === modelCall.id
    || (modelCall.provider_request_id && row.metadata?.providerResponseId === modelCall.provider_request_id)
  )) || null;
}

function researchForRun(db, runRecord, runMetadata, task) {
  const result = task?.result || {};
  const researchId = runMetadata.researchRunId
    || result.researchRunId
    || result.research?.runId
    || result.output?.researchRunId
    || null;
  const row = researchId
    ? get(db, "SELECT * FROM research_runs WHERE id = ?", [researchId])
    : task?.id
      ? get(db, "SELECT * FROM research_runs WHERE task_id = ? ORDER BY created_at DESC LIMIT 1", [task.id])
      : null;
  if (!row) return { run: null, sources: [] };
  const research = { ...row, metadata: fromJson(row.metadata, {}) };
  const sources = all(
    db,
    "SELECT * FROM research_sources WHERE run_id = ? ORDER BY retrieved_at ASC, id ASC",
    [row.id],
  ).map((source) => {
    const metadata = fromJson(source.metadata, {});
    const providerGrounded = metadata.providerGrounded === true
      || ["url_citation", "web_search_action_source"].includes(metadata.sourceType);
    const grounded = Boolean(
      source.url
      && row.mode !== "dry-run"
      && source.confidence !== "pending_live_research"
      && metadata.liveCaptured === true
      && providerGrounded
    );
    return { ...source, metadata, grounded };
  });
  return { run: research, sources };
}

function observedToolsForRun(db, runId) {
  return all(
    db,
    `SELECT invocations.*, agent_tools.name AS tool_name
     FROM agent_tool_invocations AS invocations
     LEFT JOIN agent_tools ON agent_tools.id = invocations.tool_id
     WHERE invocations.run_id = ?
     ORDER BY invocations.requested_at ASC, invocations.id ASC`,
    [runId],
  ).map((row) => ({ ...row, metadata: fromJson(row.metadata, {}) }));
}

function executionKindForRun(runRecord, modelCall, task, cost, receipt) {
  const runMode = String(runRecord.mode || "").toLowerCase();
  const runMetadata = fromJson(runRecord.metadata, {});
  if (runMetadata.executionKind === "deterministic_system_step") {
    return "deterministic_system_step";
  }
  const callMode = String(modelCall?.mode || "").toLowerCase();
  const callStatus = String(modelCall?.status || "").toLowerCase();
  const costMetadata = cost?.metadata || {};
  const receiptAttempt = receipt?.receipt?.attempt || {};
  const providerEvidence = Boolean(
    modelCall?.provider_request_id
    || modelCall?.metadata?.responseId
    || modelCall?.metadata?.dispatchIntent?.status === "dispatched"
    || receiptAttempt.providerDispatchedAt
    || Number(runRecord.actual_cost_cents || 0) > 0
    || Number(cost?.amount_cents || 0) > 0
  );
  if (callStatus === "not_called" || callMode === "dry-run" || (!providerEvidence && ["dry-run", "protected"].includes(runMode))) {
    return "protected_rehearsal";
  }
  if (!providerEvidence && ["failed", "needs_attention"].includes(String(runRecord.status || "").toLowerCase())) {
    return "provider_not_contacted";
  }
  const outcomeUnknown = task?.outcome_status === "unknown"
    || modelCall?.outcome_status === "unknown"
    || ["unknown", "outcome_unknown"].includes(callStatus)
    || costMetadata.outcomeUnknown === true
    || runMetadata.outcomeUnknown === true;
  if (outcomeUnknown) return "provider_outcome_unknown";
  const terminalProviderEvidence = Boolean(
    providerEvidence
    && callMode === "live"
    && [
      "completed",
      "succeeded",
      "provider_completed",
      "failed",
      "needs_attention",
    ].includes(callStatus)
    && modelCall?.outcome_status === "known"
    && modelCall?.provider_request_id
    && modelCall?.completed_at
  );
  return terminalProviderEvidence ? "model_backed" : "provider_evidence_missing";
}

function runExecutionContext(db, runRecord, taskRow = null) {
  const runMetadata = fromJson(runRecord.metadata, {});
  const task = taskRow ? parseTask(taskRow) : parseTask(
    runRecord.task_id ? get(db, "SELECT * FROM tasks WHERE id = ?", [runRecord.task_id]) : null,
  );
  const modelCall = modelCallForRun(db, runRecord);
  const cost = exactCostForRun(db, runRecord, task, modelCall);
  const receipt = latestAgentRunReceipt(db, runRecord.id);
  const kind = executionKindForRun(runRecord, modelCall, task, cost, receipt);
  const protectedRehearsal = ["protected_rehearsal", "deterministic_system_step"].includes(kind);
  const liveRequest = task?.payload?.liveSpendRequest || {};
  const modelMetadata = modelCall?.metadata || {};
  const agentHarness = modelMetadata.agentHarness
    || runMetadata.agentHarness
    || liveRequest.agentHarness
    || null;
  const traceGroup = modelMetadata.traceGroup
    || runMetadata.traceGroup
    || liveRequest.traceGroup
    || null;
  const usageCaptured = !protectedRehearsal && Boolean(
    modelCall
    && modelCall.status !== "not_called"
    && (
      Number(modelMetadata.totalTokens || 0) > 0
      || Number(modelMetadata.usage?.total_tokens || 0) > 0
      || Number(modelCall.input_tokens || 0) > 0
      || Number(modelCall.output_tokens || 0) > 0
    )
  );
  const actualTokens = {
    input: usageCaptured ? Number(modelCall.input_tokens || 0) : null,
    output: usageCaptured ? Number(modelCall.output_tokens || 0) : null,
    total: usageCaptured
      ? Number(modelMetadata.totalTokens ?? (Number(modelCall.input_tokens || 0) + Number(modelCall.output_tokens || 0)))
      : null,
  };
  const plannedTokens = {
    input: Number.isFinite(Number(liveRequest.maxInputTokens))
      ? Number(liveRequest.maxInputTokens)
      : protectedRehearsal && modelCall ? Number(modelCall.input_tokens || 0) : null,
    output: Number.isFinite(Number(liveRequest.maxOutputTokens))
      ? Number(liveRequest.maxOutputTokens)
      : protectedRehearsal && modelCall ? Number(modelCall.output_tokens || 0) : null,
  };
  const reviewRow = get(db, "SELECT * FROM agent_pilot_reviews WHERE run_id = ?", [runRecord.id]);
  const review = reviewRow ? { ...reviewRow, criteria: fromJson(reviewRow.criteria, {}) } : null;
  const evaluationRow = get(db, "SELECT * FROM agent_eval_results WHERE run_id = ? ORDER BY created_at DESC LIMIT 1", [runRecord.id]);
  const evaluation = evaluationRow ? {
    ...evaluationRow,
    criteria: fromJson(evaluationRow.criteria, []),
    findings: fromJson(evaluationRow.findings, []),
    metadata: fromJson(evaluationRow.metadata, {}),
  } : null;
  const traces = parseRows(all(
    db,
    "SELECT * FROM agent_trace_events WHERE run_id = ? ORDER BY sequence ASC",
    [runRecord.id],
  ));
  const research = researchForRun(db, runRecord, runMetadata, task);
  const tools = observedToolsForRun(db, runRecord.id);
  const traceId = protectedRehearsal ? null : (
    review?.trace_id
    || modelMetadata.agentSdkTraceId
    || runMetadata.agentSdkTraceId
    || null
  );
  const responseId = protectedRehearsal ? null : (
    modelCall?.provider_request_id
    || modelMetadata.responseId
    || runMetadata.liveWorkerResponseId
    || null
  );
  const reconciledCents = protectedRehearsal
    ? null
    : modelCall?.cost_status === "reconciled"
      ? Number(modelCall.reconciled_cost_cents || 0)
      : cost?.status === "reconciled"
        ? Number(cost.amount_cents || 0)
        : Number(review?.reconciled_cost_cents || 0) > 0
          ? Number(review.reconciled_cost_cents)
          : null;
  const actualCostCaptured = !protectedRehearsal && Boolean(
    reconciledCents !== null
    || Number(modelCall?.actual_cost_cents || 0) > 0
    || Number(runRecord.actual_cost_cents || 0) > 0
  );
  const actualCostCents = actualCostCaptured
    ? reconciledCents !== null
      ? reconciledCents
      : Number(modelCall?.actual_cost_cents || 0)
        || Number(cost?.amount_cents || 0)
        || Number(runRecord.actual_cost_cents || 0)
    : null;
  return {
    runMetadata,
    task,
    modelCall,
    cost,
    kind,
    protectedRehearsal,
    providerAttempted: !protectedRehearsal && Boolean(
      responseId
      || modelMetadata.dispatchIntent?.status === "dispatched"
      || receipt?.receipt?.attempt?.providerDispatchedAt
      || Number(runRecord.actual_cost_cents || 0) > 0
      || Number(cost?.amount_cents || 0) > 0
    ),
    liveRequest,
    actualTokens,
    plannedTokens,
    actualCostCents,
    reconciledCents,
    costStatus: protectedRehearsal
      ? "no_provider_call"
      : modelCall?.cost_status || cost?.status || (actualCostCaptured ? "recorded" : "not_captured"),
    traceId,
    responseId,
    review,
    evaluation,
    traces,
    tools,
    research,
    receipt,
    agentHarness,
    traceGroup,
    sdkGuardrails: modelMetadata.sdkGuardrails || runMetadata.sdkGuardrails || null,
    cacheUsage: modelMetadata.cacheUsage || null,
  };
}

function executionLabel(kind) {
  return {
    protected_rehearsal: "Internal rehearsal",
    deterministic_system_step: "System-generated step",
    provider_not_contacted: "Stopped before OpenAI",
    model_backed: "OpenAI used",
    provider_outcome_unknown: "Outcome needs review",
    provider_evidence_missing: "Provider proof incomplete",
  }[kind] || "Run recorded";
}

function workGroupLabel(traceGroup, fallbackTitle) {
  if (!traceGroup) return fallbackTitle || "Recorded AI work";
  return {
    journey: "Commercial journey",
    opportunity: "Opportunity review",
    investment_case: "Investment review",
    discovery_round: "Market discovery round",
    work_package: "Business work package",
    workflow: "Business workflow",
    task: fallbackTitle || "AI task",
  }[traceGroup.scopeType] || fallbackTitle || "Related AI work";
}

function runAssuranceSummary(context) {
  const layers = context.evaluation?.metadata?.evaluationLayers
    || context.runMetadata.evaluationLayers
    || null;
  return {
    status: context.evaluation?.status || "not_reviewed",
    score: context.evaluation?.score ?? null,
    structural: layers?.structural?.status || null,
    behavioral: layers?.behavioral?.status || null,
    trace: layers?.trace?.status || null,
    operatorUsefulness: layers?.operatorUsefulness?.status || "not_reviewed",
    commercialOutcome: layers?.commercialOutcome?.status || "not_measured",
  };
}

function agentRunSummary(db, row, supersededTaskIds = new Set()) {
  const context = runExecutionContext(db, row);
  const latestTrace = context.traces.at(-1) || null;
  const active = ACTIVE_RUN_STATUSES.has(String(row.status || "").toLowerCase());
  const error = context.task?.error || context.runMetadata.error || (
    ["failed", "needs_attention"].includes(row.status) ? row.output_summary : null
  );
  const providerState = context.kind === "protected_rehearsal"
    ? "not_used"
    : context.kind === "provider_outcome_unknown"
      ? "outcome_unknown"
      : context.responseId
        ? "response_received"
        : context.providerAttempted
          ? "contacting_provider"
          : "not_contacted";
  const resolvedByRetry = Boolean(row.task_id && supersededTaskIds.has(row.task_id));
  const attentionRequired = context.receipt?.status === "incomplete"
    || (
      !resolvedByRetry
      && (
        context.kind === "provider_outcome_unknown"
        || ["needs_attention", "failed"].includes(row.status)
        || context.receipt?.status === "needs_review"
      )
  );
  const traceGroup = context.traceGroup;
  const displayTaskTitle = operatorProductionText(
    db,
    row.task_title || context.runMetadata.taskTitle || "AI worker run",
    context.task?.payload || {},
  );
  const workGroup = {
    id: traceGroup?.groupId || `pantheon_run_group_${row.id}`,
    scopeType: traceGroup?.scopeType || "task",
    scopeId: traceGroup?.scopeId || row.task_id || row.id,
    label: workGroupLabel(traceGroup, displayTaskTitle),
    versioned: Boolean(traceGroup?.groupId),
  };
  return {
    id: row.id,
    executionKind: context.kind,
    executionLabel: executionLabel(context.kind),
    providerAttempted: context.providerAttempted,
    status: row.status,
    active,
    activityState: active ? "working" : attentionRequired ? "needs_review" : "finished",
    providerState,
    attentionRequired,
    resolvedByRetry,
    workerId: row.agent_id,
    workerName: row.worker_name || row.agent_id,
    taskId: row.task_id,
    taskTitle: displayTaskTitle,
    summary: operatorProductionText(
      db,
      context.task?.result?.output?.summary || row.output_summary || "No result summary was captured.",
      context.task?.payload || {},
    ),
    error: error || null,
    provider: context.protectedRehearsal ? null : (context.modelCall?.metadata?.provider || context.liveRequest.provider || context.modelCall?.provider || null),
    requestedProvider: context.liveRequest.provider || context.modelCall?.provider || null,
    model: context.protectedRehearsal ? null : (context.modelCall?.selected_model || context.liveRequest.model || null),
    requestedModel: context.liveRequest.model || context.modelCall?.selected_model || null,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    durationMs: elapsedMilliseconds(row.started_at, row.completed_at),
    currentStage: latestTrace ? { title: latestTrace.title, detail: latestTrace.detail, at: latestTrace.ts } : null,
    plainStage: latestTrace?.title || (active ? "Preparing work" : humanTaskStatus(row.status)),
    lastProgressAt: latestTrace?.ts || row.completed_at || row.started_at,
    resultAvailable: Boolean(context.receipt?.receipt?.task?.result || context.task?.result?.output),
    actualTokens: context.actualTokens,
    plannedTokens: context.plannedTokens,
    cost: {
      status: context.costStatus,
      actualCents: context.actualCostCents,
      reconciledCents: context.reconciledCents,
      estimatedCents: Number(context.modelCall?.estimated_cost_cents || row.estimated_cost_cents || 0),
      plannedCapCents: Number(context.liveRequest.maxCostCents || context.liveRequest.estimatedCostCents || context.task?.cost_budget_cents || 0),
      currency: context.cost?.currency || CONFIG.currency,
    },
    tools: {
      requested: Array.isArray(context.liveRequest.tools) ? context.liveRequest.tools : [],
      observedCount: context.tools.length,
    },
    workGroup,
    harness: context.agentHarness ? {
      hash: context.agentHarness.harnessHash || null,
      promptPolicy: context.agentHarness.versions?.promptPolicy || null,
      assurancePolicy: context.agentHarness.versions?.assurancePolicy || null,
      guardrailPolicy: context.agentHarness.versions?.guardrailPolicy || null,
    } : null,
    assurance: runAssuranceSummary(context),
    cacheUsage: context.cacheUsage,
    groundedSourceCount: context.research.sources.filter((source) => source.grounded).length,
    reviewStatus: context.review?.operator_verdict || context.evaluation?.status || "not_reviewed",
    receipt: context.receipt ? {
      id: context.receipt.id,
      status: context.receipt.status,
      hash: context.receipt.receipt_hash,
      missingFields: context.receipt.missing_fields,
      warnings: context.receipt.warnings,
      createdAt: context.receipt.created_at,
    } : {
      id: null,
      status: active ? "recording" : "missing",
      hash: null,
      missingFields: active ? [] : ["execution receipt"],
      warnings: [],
      createdAt: null,
    },
    traceId: context.traceId,
    responseId: context.responseId,
    updatedAt: row.completed_at || latestTrace?.ts || row.started_at,
  };
}

function groupAgentRuns(runs) {
  const groups = new Map();
  for (const item of runs) {
    const identity = item.workGroup || {
      id: `pantheon_run_group_${item.id}`,
      scopeType: "task",
      scopeId: item.taskId || item.id,
      label: item.taskTitle,
      versioned: false,
    };
    const group = groups.get(identity.id) || {
      ...identity,
      runIds: [],
      workers: [],
      runCount: 0,
      activeCount: 0,
      needsReviewCount: 0,
      estimatedCostCents: 0,
      actualCostCents: 0,
      actualCostComplete: true,
      latestAt: null,
    };
    group.runIds.push(item.id);
    if (!group.workers.includes(item.workerName)) group.workers.push(item.workerName);
    group.runCount += 1;
    if (item.active) group.activeCount += 1;
    if (item.attentionRequired) group.needsReviewCount += 1;
    group.estimatedCostCents += Number(item.cost?.estimatedCents || 0);
    if (item.cost?.actualCents === null || item.cost?.actualCents === undefined) {
      group.actualCostComplete = false;
    } else {
      group.actualCostCents += Number(item.cost.actualCents || 0);
    }
    if (!group.latestAt || String(item.updatedAt || "") > String(group.latestAt)) {
      group.latestAt = item.updatedAt;
    }
    groups.set(identity.id, group);
  }
  return [...groups.values()]
    .map((group) => ({
      ...group,
      status: group.activeCount
        ? "working"
        : group.needsReviewCount
          ? "needs_review"
          : "completed",
      actualCostCents: group.actualCostComplete ? group.actualCostCents : null,
    }))
    .sort((left, right) => String(right.latestAt || "").localeCompare(String(left.latestAt || "")));
}

function getAgentRunsState(db, filters = {}) {
  const limit = Math.min(100, Math.max(1, Number(filters.limit || 50)));
  const rows = all(
    db,
    `SELECT agent_runs.*, agent_definitions.name AS worker_name,
            tasks.title AS task_title, tasks.status AS task_status,
            tasks.kind, tasks.agent, tasks.payload, tasks.result, tasks.error,
            tasks.outcome_status, tasks.cost_budget_cents, tasks.workflow_id AS task_workflow_id,
            tasks.created_at AS task_created_at, tasks.updated_at AS task_updated_at
     FROM agent_runs
     LEFT JOIN agent_definitions ON agent_definitions.id = agent_runs.agent_id
     LEFT JOIN tasks ON tasks.id = agent_runs.task_id
     ORDER BY agent_runs.started_at DESC, agent_runs.id DESC
     LIMIT 500`,
  );
  const supersededTaskIds = supersededRetryTaskIds(db);
  const summaries = rows.map((row) => agentRunSummary(db, row, supersededTaskIds));
  const execution = String(filters.execution || "all");
  const state = String(filters.state || "all");
  const status = String(filters.status || "all");
  const worker = String(filters.worker || "all");
  const matches = summaries.filter((runRecord) => {
    if (execution === "live" && runRecord.executionKind === "protected_rehearsal") return false;
    if (!["all", "live"].includes(execution) && runRecord.executionKind !== execution) return false;
    if (state === "active" && !runRecord.active) return false;
    if (state === "history" && runRecord.active) return false;
    if (status !== "all" && runRecord.status !== status) return false;
    if (worker !== "all" && runRecord.workerId !== worker) return false;
    return true;
  });
  return {
    generatedAt: new Date().toISOString(),
    filters: { execution, state, status, worker, limit },
    counts: {
      total: summaries.length,
      active: summaries.filter((item) => item.active).length,
      modelBacked: summaries.filter((item) => item.executionKind === "model_backed").length,
      protectedRehearsals: summaries.filter((item) => item.executionKind === "protected_rehearsal").length,
      deterministicSteps: summaries.filter((item) => item.executionKind === "deterministic_system_step").length,
      needsReview: summaries.filter((item) => item.attentionRequired || item.reviewStatus === "pending").length,
      reconciledCostCents: summaries.reduce((total, item) => total + Number(item.cost.reconciledCents || 0), 0),
    },
    totalMatching: matches.length,
    workGroups: groupAgentRuns(matches),
    costObservability: getAgentCostObservability(db),
    runs: matches.slice(0, limit),
  };
}

function getAiTeamState(db) {
  const commercial = commercialFoundationState(db);
  const journey = currentOperatorJourney(db);
  return {
    activeVenture: commercial.venture,
    agents: teamState(
      db,
      commercial.venture.id,
      journey?.id || null,
      journey?.metadata?.currentTaskId || null,
    ),
    liveRuns: getAgentRunsState(db, { execution: "all", limit: 100 }),
  };
}

function humanActivityMessage(event) {
  const metadata = event.metadata || {};
  const preventureMessages = {
    "preventure_research.proposed": "A fixed preparation-only research proposal was recorded. No AI work, external action, or spend started.",
    "preventure_research.acceptance_requested": "The exact bounded research proposal is ready for your acceptance decision. Accepting it does not start AI work.",
    "preventure_research.accepted": "You accepted the exact research boundaries. A separate activation decision is still required before internal AI work can start.",
    "preventure_research.activation_requested": "The accepted preparation-only research round is ready for your separate activation decision.",
    "preventure_research.activated": "You activated the bounded internal diligence round. Its three exact assignments remain subject to expiry, cost, and integrity controls.",
    "preventure_research.assignments_materialized": "Pantheon created the three exact internal research assignments. The dedicated runner must be ready before any provider call can start.",
    "preventure_research.assignment_started": "One bounded internal research assignment started within its exact provider, model, tool, time, and cost limits.",
    "preventure_research.assignment_completed": "One bounded internal research assignment finished and its cost, receipt, sources, and evidence are being checked.",
    "preventure_research.assignment_needs_reprocess": "A provider result was retained, but its local evidence conversion needs a deterministic recheck. No provider retry is allowed.",
    "preventure_research.outcome_unknown": "A research provider result or cost is uncertain. Pantheon froze further dispatch until it is reconciled.",
    "preventure_research.revoked": "You stopped the bounded research round. Remaining internal assignments were cancelled and no new provider call may start.",
    "preventure_research.expired": "The bounded research deadline passed. No further assignment may start under this authority.",
    "preventure_research.decision_completed": "The diligence recommendation was sealed. It grants no build, publishing, buyer-contact, account, advertising, or spending authority.",
    "preventure_research.initialization_withheld": "Pantheon withheld the bounded-research controls because their exact record could not be verified.",
  };
  if (preventureMessages[event.type]) return preventureMessages[event.type];
  if (event.type === "preventure_research_lifecycle.approved") {
    return metadata.lifecycleStatus === "activated"
      ? "You activated the accepted preparation-only research round."
      : "You accepted the exact bounded research proposal; no AI work started from acceptance alone.";
  }
  if (event.type === "preventure_research_lifecycle.rejected") {
    return "You declined the bounded research decision. No work may continue from that decision.";
  }
  if (event.type === "preventure_research_lifecycle.needs_changes") {
    return "You requested a different research scope. This immutable version cannot continue and must be replaced explicitly.";
  }
  if (event.type === "spend_approval.requested") {
    const subject = String(event.message || "").match(/for (.+?)\.\s*No spend/i)?.[1] || "The exact paid AI task";
    return `${subject} is ready for your decision. No charge has occurred.`;
  }
  if (event.type === "live_ai_worker.requested") {
    return `${metadata.workerName || "The AI worker"} proof is prepared. It will start only after you approve its exact scope and cost cap.`;
  }
  if (event.type === "agent_pilot.fixture_created") {
    return "Supplied evidence is locked and ready for the Demand Validator proof.";
  }
  if (event.type === "agent.handoff_decided") {
    return {
      approve: "The recommended next step was approved.",
      changes: "Changes were requested before the team can continue.",
      reject: "The recommended next step was declined.",
    }[metadata.decision] || "A consequential team decision was recorded.";
  }
  if (event.type === "workflow_run.completed") return "Internal work finished and is ready for review.";
  if (event.type === "approval_pack.generated") return "A PDF decision brief is ready to preview.";
  if (event.type === "command.planned") return "A new internal work plan was created.";
  if (event.type === "research.dry_run_created") return "An internal research plan was prepared; real market evidence is still required.";
  if (event.type === "task.completed") {
    const title = String(event.message || "Work")
      .replace(/ completed by the (?:dry-run|protected) agent runner\.?$/i, "")
      .trim();
    const liveProvider = metadata.modelPolicy?.provider
      || (String(metadata.mode || "").includes("openai") ? metadata.mode : null);
    if (liveProvider) {
      return `${title} completed one approved OpenAI run and is ready for review.`;
    }
    if (String(metadata.mode || "").includes("live-research")) {
      return `${title} completed one approved live research run and is ready for review.`;
    }
    if (String(event.message || "").includes("dry-run mode")) {
      return `${title.replace(/ completed in dry-run mode.*$/i, "")} completed internally; no external action occurred.`;
    }
    return `${title} is ready.`;
  }
  if (event.type === "venture_scorecard.updated") {
    const score = String(event.message || "").match(/(\d+)\s*\/\s*100/)?.[1];
    return score
      ? `The commercial scorecard is ${score}/100; more evidence is required.`
      : "The commercial scorecard was updated.";
  }
  return String(event.message || "Runtime activity recorded.")
    .replace(/dry[- ]run/gi, "internal")
    .replace(/research_required/gi, "more evidence needed")
    .replace(/\b[a-z]+(?:_[a-z]+)+\b/g, (value) => value.split("_").map((word) => `${word[0].toUpperCase()}${word.slice(1)}`).join(" "));
}

function activityState(db) {
  const foundationAt = get(db, "SELECT applied_at FROM schema_migrations WHERE version = 6")?.applied_at || "1970-01-01T00:00:00.000Z";
  return parseRows(all(
    db,
    `SELECT * FROM events
     WHERE ts >= ?
       AND type NOT IN (
         'scheduler.job.completed', 'monitor.completed', 'executive_digest.generated',
         'task.started', 'agent.handoff_created', 'notification.queued_dry_run'
       )
     ORDER BY id DESC LIMIT 40`,
    [foundationAt],
  )).map((event) => {
    const taskId = event.entity_type === "task"
      ? event.entity_id
      : event.metadata?.taskId || null;
    const taskPayload = taskId
      ? fromJson(get(db, "SELECT payload FROM tasks WHERE id = ?", [taskId])?.payload, {})
      : {};
    return {
      ...event,
      message: operatorProductionText(
        db,
        humanActivityMessage(event),
        taskPayload,
      ),
    };
  });
}

function operatorConnectionsState(db) {
  const current = new Set(["ai_workers", "live_research", "digital_products"]);
  return parseRows(all(db, "SELECT * FROM integrations ORDER BY name"))
    .filter((item) => current.has(item.id))
    .map((item) => {
      if (item.id === "ai_workers") {
        return {
          ...item,
          name: "OpenAI AI Team",
          metadata: { ...item.metadata, use: "Agents SDK specialists for exact, approved and capped work." },
        };
      }
      if (item.id === "live_research") {
        return {
          ...item,
          name: "OpenAI Live Research",
          metadata: { ...item.metadata, use: "Read-only market research after its own exact approval." },
        };
      }
      return {
        ...item,
        name: "Gumroad Direct",
        status: "planned",
        health: "not_configured",
        metadata: {
          ...item.metadata,
          use: "Checkout and delivery setup begins after the first product opportunity is selected.",
        },
      };
    });
}

function agentSystemChecks(db) {
  const resolvedTaskIds = supersededRetryTaskIds(db);
  const receiptRows = all(
    db,
    `SELECT receipts.*, agents.name AS worker_name, tasks.title AS task_title,
            tasks.payload AS task_payload
     FROM agent_run_receipts AS receipts
     LEFT JOIN agent_runs AS runs ON runs.id = receipts.run_id
     LEFT JOIN agent_definitions AS agents ON agents.id = runs.agent_id
     LEFT JOIN tasks ON tasks.id = receipts.task_id
     WHERE NOT EXISTS (
       SELECT 1 FROM agent_run_receipts AS later
       WHERE later.attempt_id = receipts.attempt_id
         AND later.sequence > receipts.sequence
     )
       AND receipts.status IN ('needs_review', 'incomplete')
     ORDER BY receipts.created_at DESC
     LIMIT 50`,
  )
    .filter((row) => !(row.status === "needs_review" && resolvedTaskIds.has(row.task_id)))
    .map((row) => ({
    id: row.id,
    kind: "agent_receipt",
    severity: row.status === "incomplete" ? "error" : "warning",
    status: row.status,
    title: operatorProductionText(
      db,
      row.status === "incomplete"
        ? `Execution record incomplete: ${row.task_title || "AI work"}`
        : `Execution needs review: ${row.task_title || "AI work"}`,
      fromJson(row.task_payload, {}),
    ),
    detail: [
      ...fromJson(row.missing_fields, []),
      ...fromJson(row.warnings, []),
    ].join(" ") || "Pantheon retained the run and flagged it for review.",
    workerName: row.worker_name || null,
    runId: row.run_id,
    taskId: row.task_id,
    createdAt: row.created_at,
    }));
  const missingRows = all(
    db,
    `SELECT runs.id AS run_id, runs.task_id, runs.completed_at, agents.name AS worker_name,
            tasks.title AS task_title, tasks.payload AS task_payload
     FROM agent_runs AS runs
     LEFT JOIN agent_definitions AS agents ON agents.id = runs.agent_id
     LEFT JOIN tasks ON tasks.id = runs.task_id
     WHERE runs.completed_at IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM agent_run_receipts WHERE run_id = runs.id)
     ORDER BY runs.completed_at DESC
     LIMIT 50`,
  ).map((row) => ({
    id: `missing_${row.run_id}`,
    kind: "missing_agent_receipt",
    severity: "error",
    status: "incomplete",
    title: operatorProductionText(
      db,
      `Execution record missing: ${row.task_title || "AI work"}`,
      fromJson(row.task_payload, {}),
    ),
    detail: "The worker finished without an immutable local receipt. Pantheon will keep this visible until the record is repaired.",
    workerName: row.worker_name || null,
    runId: row.run_id,
    taskId: row.task_id,
    createdAt: row.completed_at,
  }));
  const items = [...missingRows, ...receiptRows].sort((left, right) => (
    String(right.createdAt || "").localeCompare(String(left.createdAt || ""))
  ));
  const verification = verifyAgentRunReceiptChain(db);
  if (!verification.ok) {
    items.unshift({
      id: "receipt_chain_failure",
      kind: "receipt_chain_failure",
      severity: "error",
      status: "incomplete",
      title: "Execution receipt verification failed",
      detail: `${verification.failures.length} stored receipt check${verification.failures.length === 1 ? "" : "s"} did not match. Do not rely on the affected record until Jarvis repairs it.`,
      workerName: null,
      runId: null,
      taskId: null,
      createdAt: new Date().toISOString(),
    });
  }
  return {
    status: items.some((item) => item.severity === "error")
      ? "needs_attention"
      : items.length
        ? "review_recommended"
        : "operating_normally",
    openCount: items.length,
    verifiedReceiptCount: verification.checked,
    receiptChainVerified: verification.ok,
    items: items.slice(0, 50),
    monitor: monitorFindingState(db),
  };
}

function monitorFindingAction(item) {
  if (item.entity_type === "agent_run") {
    return { kind: "agent_run", id: item.entity_id, label: "Review AI run" };
  }
  if (["approvals", "approval_integrity"].includes(item.category)) {
    return { kind: "view", id: "decisions", label: "Review decisions" };
  }
  if (["cost", "budget"].includes(item.category)) {
    return { kind: "system_tab", id: "spend", label: "Review spend" };
  }
  if (["tasks", "queue", "unknown_outcome", "unsafe_retry", "chief_assignment"].includes(item.category)) {
    return { kind: "system_tab", id: "queue", label: "Open queue" };
  }
  if (item.category === "runtime_oversight") {
    return { kind: "maintenance", id: null, label: "Run check now" };
  }
  return null;
}

function monitorFindingState(db) {
  const rows = parseRows(all(
    db,
    `SELECT id, run_id, severity, category, entity_type, entity_id, title, detail,
            status, metadata, first_seen, last_seen, occurrence_count
     FROM monitor_findings
     WHERE status = 'open'
     ORDER BY CASE severity WHEN 'error' THEN 0 WHEN 'warn' THEN 1 ELSE 2 END,
              last_seen DESC
     LIMIT 50`,
  ));
  return {
    openCount: rows.length,
    criticalCount: rows.filter((item) => item.severity === "error").length,
    items: rows.map((item) => ({
      ...item,
      action: monitorFindingAction(item),
    })),
  };
}

function runtimeMonitoringHealth(db) {
  const job = get(
    db,
    "SELECT * FROM scheduler_jobs WHERE id = 'job-monitor-cycle'",
  );
  const latestMonitor = get(
    db,
    `SELECT id, status, severity, finding_count, started_at, completed_at
     FROM monitor_runs
     ORDER BY started_at DESC
     LIMIT 1`,
  );
  const latestSchedulerRun = get(
    db,
    `SELECT id, status, started_at, completed_at, error
     FROM scheduler_runs
     WHERE job_id = 'job-monitor-cycle'
     ORDER BY started_at DESC
     LIMIT 1`,
  );
  const intervalSeconds = Math.max(60, Number(job?.interval_seconds || 15 * 60));
  const graceSeconds = Math.max(120, Math.ceil(intervalSeconds / 4));
  const nowMs = Date.now();
  const nextRunMs = Date.parse(job?.next_run_at || "");
  const lockedAtMs = Date.parse(job?.locked_at || "");
  const metadata = fromJson(job?.metadata, {});
  const leaseSeconds = Math.max(60, Number(metadata.leaseSeconds || 15 * 60));
  const activeLock = Boolean(
    job?.lock_owner
    && Number.isFinite(lockedAtMs)
    && nowMs - lockedAtMs <= leaseSeconds * 1000,
  );
  const latestFailed = latestSchedulerRun
    && ["failed", "needs_attention", "abandoned"].includes(latestSchedulerRun.status);
  const overdue = Boolean(
    job?.status === "enabled"
    && !activeLock
    && Number.isFinite(nextRunMs)
    && nowMs > nextRunMs + graceSeconds * 1000,
  );

  let status = "operating";
  let label = "Operating normally";
  let summary = `Pantheon checks the system every ${Math.round(intervalSeconds / 60)} minutes.`;
  if (!job) {
    status = "starting";
    label = "Starting";
    summary = "Pantheon monitoring starts with the business runtime.";
  } else if (job.status !== "enabled") {
    status = "paused";
    label = "Needs attention";
    summary = "Independent system checks are paused.";
  } else if (latestFailed || overdue) {
    status = "needs_attention";
    label = "Needs attention";
    summary = latestFailed
      ? "The latest independent system check did not finish cleanly."
      : "The next independent system check is overdue.";
  } else if (!latestMonitor?.completed_at && !activeLock) {
    status = "starting";
    label = "Starting";
    summary = "The monitoring schedule is enabled and waiting for its first completed check.";
  } else if (activeLock) {
    status = "operating";
    label = "Checking now";
    summary = "Pantheon is checking the system now.";
  }

  return {
    status,
    label,
    summary,
    enabled: job?.status === "enabled",
    intervalMinutes: Math.round(intervalSeconds / 60),
    lastCheckAt: latestMonitor?.completed_at || job?.last_run_at || null,
    nextCheckAt: job?.next_run_at || null,
    latestReviewStatus: latestMonitor?.status || null,
    latestFindingCount: Number(latestMonitor?.finding_count || 0),
    latestRunId: latestMonitor?.id || null,
  };
}

function getSystemState(db, options = {}) {
  const preventureResearch = preventureOwnerProjection(db, options);
  const preventureResearchRuntime = preventureRuntimeProjection(options);
  const queue = parseRows(all(
    db,
    `SELECT tasks.*,
            CASE
              WHEN tasks.status IN ('planned', 'queued')
               AND NOT EXISTS (
                 SELECT 1 FROM tasks AS earlier
                 WHERE earlier.workflow_id = tasks.workflow_id
                   AND earlier.id <> tasks.id
                   AND earlier.status IN ('planned', 'queued', 'running', 'blocked', 'waiting_approval', 'needs_attention')
                   AND (
                     earlier.priority < tasks.priority
                     OR (earlier.priority = tasks.priority AND earlier.created_at < tasks.created_at)
                     OR (earlier.priority = tasks.priority AND earlier.created_at = tasks.created_at AND earlier.id < tasks.id)
                   )
               ) THEN 1 ELSE 0
            END AS can_run
     FROM tasks
     WHERE tasks.status IN ('planned', 'queued', 'running', 'blocked', 'waiting_approval', 'needs_attention')
     ORDER BY CASE tasks.status WHEN 'running' THEN 0 WHEN 'needs_attention' THEN 1 WHEN 'blocked' THEN 2 ELSE 3 END,
              tasks.updated_at DESC LIMIT 50`,
  ), ["payload", "result"]).map((task) => ({
    ...task,
    ...taskExecutionPresentation(db, task, Boolean(task.can_run), options),
  }));
  return {
    preventureResearch,
    preventureResearchRuntime,
    health: {
      database: get(db, "PRAGMA integrity_check").integrity_check,
      monitoring: runtimeMonitoringHealth(db),
      liveAi: getLiveAiWorkerReadiness(db),
      liveResearch: getLiveResearchReadiness(db),
      retention: getRetentionPolicyState(db),
      proofMode: CONFIG.systemProofMode === true,
      preventureResearch: {
        status: preventureResearch.integrity?.status || "attention",
        authorityStatus: preventureResearch.integrity?.authorityStatus || "unavailable",
        executionStatus: preventureResearchRuntime.status,
      },
    },
    queue,
    spend: spendState(db),
    connections: operatorConnectionsState(db),
    outputs: parseRows(all(
      db,
      "SELECT * FROM deliverables ORDER BY CASE status WHEN 'archived' THEN 1 ELSE 0 END, updated_at DESC LIMIT 50",
    )).map(operatorDeliverable),
    activity: activityState(db),
    checks: agentSystemChecks(db),
    weeklyDigest: getCanonicalOwnerDigest(db),
  };
}

function getHistoricalTestDetail(db, id) {
  const experiment = get(db, "SELECT * FROM commercial_experiments WHERE id = ?", [id]);
  if (!experiment) return null;
  const parsedExperiment = {
    ...experiment,
    status: testStatus(experiment.status),
    metadata: fromJson(experiment.metadata),
  };
  const packRow = get(
    db,
    `SELECT *
     FROM commercial_execution_packs
     WHERE experiment_id = ?
     ORDER BY updated_at DESC
     LIMIT 1`,
    [id],
  );
  const pack = packRow ? { ...packRow, metadata: fromJson(packRow.metadata) } : null;
  const candidateId = parsedExperiment.metadata?.candidateId || null;
  const candidateRow = candidateId
    ? get(db, "SELECT * FROM commercial_test_candidates WHERE id = ?", [candidateId])
    : null;
  const candidate = candidateRow ? { ...candidateRow, metadata: fromJson(candidateRow.metadata) } : null;
  const contract = parsedExperiment.metadata?.buyerIntentValidation
    || candidate?.metadata?.buyerIntentValidation
    || pack?.metadata?.buyerIntentValidation
    || null;
  const planRow = contract?.cataloguePlanId
    ? get(db, "SELECT * FROM catalogue_plans WHERE id = ?", [contract.cataloguePlanId])
    : null;
  const plan = planRow ? {
    ...planRow,
    audience_segments: fromJson(planRow.audience_segments, []),
    channels: fromJson(planRow.channels, []),
    geographies: fromJson(planRow.geographies, []),
    languages: fromJson(planRow.languages, []),
    metadata: fromJson(planRow.metadata, {}),
  } : null;
  const distributionRunId = pack?.metadata?.aiTeam?.distributionRun?.runId || null;
  const decisionHandoff = distributionRunId ? parseRows(all(
    db,
    `SELECT * FROM agent_handoffs
     WHERE from_run_id = ? AND to_agent_id = 'chief_of_staff'
     ORDER BY created_at DESC LIMIT 1`,
    [distributionRunId],
  ))[0] || null : null;
  const packedSampleDeliverables = Array.isArray(pack?.metadata?.sampleDeliverables)
    ? pack.metadata.sampleDeliverables
    : [];
  const plannedSampleDeliverables = Array.isArray(plan?.metadata?.validationSampleDeliverables)
    ? plan.metadata.validationSampleDeliverables
    : [];
  const sampleDeliverables = packedSampleDeliverables.length
    ? packedSampleDeliverables
    : plannedSampleDeliverables.length
      ? plannedSampleDeliverables
      : validationSampleDeliverables(db, plan);
  const displayName = plan?.metadata?.productManifest?.packageTitle
    || contract?.sample?.item?.title
    || contract?.sample?.packageTitle
    || parsedExperiment.name;
  const buyerIntentValidation = contract && plan
    ? {
      ...contract,
      ...currentBuyerIntentValidation(db, plan.venture_id, plan.id),
      sample: contract.sample,
      providerPolicy: contract.providerPolicy,
    }
    : contract;
  return {
    experiment: {
      ...parsedExperiment,
      name: displayName,
    },
    candidate,
    pack,
    plan,
    buyerIntentValidation,
    sampleDeliverables,
    decisionHandoff,
    evidence: parseRows(all(db, "SELECT * FROM commercial_evidence WHERE experiment_id = ? ORDER BY captured_at", [id])),
    results: parseRows(all(db, "SELECT * FROM commercial_results WHERE experiment_id = ? ORDER BY occurred_at", [id])),
    feedback: parseRows(all(db, "SELECT * FROM commercial_feedback WHERE experiment_id = ? ORDER BY occurred_at", [id])),
    learning: parseRows(all(db, "SELECT * FROM commercial_learning_cycles WHERE experiment_id = ? ORDER BY created_at DESC", [id])),
  };
}

function getAgentDetail(db, id) {
  const team = getAiTeamState(db).agents;
  const agent = team.find((item) => item.id === id);
  if (!agent) return null;
  return {
    agent,
    runs: parseRows(all(db, "SELECT * FROM agent_runs WHERE agent_id = ? ORDER BY started_at DESC LIMIT 30", [id])),
    evaluations: parseRows(all(db, "SELECT * FROM agent_eval_results WHERE agent_id = ? ORDER BY created_at DESC LIMIT 30", [id]), ["criteria", "findings", "metadata"]),
    capabilities: parseRows(all(db, "SELECT * FROM capability_autonomy WHERE agent_id = ?", [id])),
  };
}

function elapsedMilliseconds(startedAt, completedAt) {
  const start = Date.parse(startedAt || "");
  const end = Date.parse(completedAt || "");
  return Number.isFinite(start) && Number.isFinite(end) ? Math.max(0, end - start) : null;
}

function productionRecommendationDisplay(db, task, output, recommendation) {
  const production = task?.payload?.liveSpendRequest?.parameters?.pantheonProduction || {};
  if (!production.planId) return recommendation;
  const plan = get(
    db,
    "SELECT opportunity_id, price_floor_cents FROM catalogue_plans WHERE id = ?",
    [production.planId],
  );
  if (!plan) return recommendation;
  const opportunity = get(
    db,
    "SELECT channel FROM opportunities WHERE id = ?",
    [production.opportunityId || plan.opportunity_id],
  );
  const priceCents = Number(plan.price_floor_cents || 0);
  const fixed = (priceCents / 100).toFixed(2);
  const compact = fixed.replace(/\.00$/, "").replace(/(\.\d)0$/, "$1");
  const variants = [...new Set([fixed, compact])]
    .sort((left, right) => right.length - left.length)
    .map((item) => item.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|");
  const normalize = (value) => {
    if (typeof value !== "string") return value;
    const presented = operatorProductionText(db, value, task?.payload || {});
    if (!priceCents) return presented;
    const foreignPrefix = new RegExp(
      `\\b(?:US\\$|USD\\s*)(${variants})(?!\\d|\\.\\d)`,
      "gi",
    );
    const foreignSuffix = new RegExp(
      `(^|[^\\d.])(${variants})\\s*USD\\b`,
      "gi",
    );
    const barePrice = new RegExp(
      `(^|[^A-Za-z])\\$(${variants})(?!\\d|\\.\\d)`,
      "g",
    );
    return presented
      .replace(foreignPrefix, (_match, amount) => `A$${amount}`)
      .replace(foreignSuffix, (_match, prefix, amount) => `${prefix}A$${amount}`)
      .replace(barePrice, (_match, prefix, amount) => `${prefix}A$${amount}`);
  };
  const normalizeList = (value) => (
    Array.isArray(value) ? value.map((item) => normalize(item)) : value
  );
  const suppliedPriceChannel = normalize(recommendation.priceChannelHypothesis || "");
  const missingPriceChannel = !String(suppliedPriceChannel || "").trim()
    || /^(?:not stated|unknown|n\/a)\.?$/i.test(String(suppliedPriceChannel).trim());
  const channel = output.businessDecision?.channel || opportunity?.channel || "the approved channel";
  return {
    ...recommendation,
    evidence: normalizeList(recommendation.evidence || []),
    counterevidence: normalizeList(recommendation.counterevidence || []),
    assumptions: normalizeList(recommendation.assumptions || []),
    priceChannelHypothesis: missingPriceChannel && priceCents
      ? `Test at A$${fixed} through ${channel}.`
      : suppliedPriceChannel,
    smallestTest: normalize(recommendation.smallestTest || ""),
    metric: normalize(recommendation.metric || ""),
    killRule: normalize(recommendation.killRule || ""),
    risks: normalizeList(recommendation.risks || output.risks || []),
  };
}

function getAgentRunDetail(db, id) {
  const runRecord = get(db, "SELECT * FROM agent_runs WHERE id = ?", [id]);
  if (!runRecord) return null;
  const context = runExecutionContext(db, runRecord);
  const runMetadata = context.runMetadata;
  const definition = get(db, "SELECT id, name, role FROM agent_definitions WHERE id = ?", [runRecord.agent_id]);
  const task = context.task;
  const modelCall = context.modelCall;
  const evaluation = context.evaluation;
  const review = context.review;
  const fixtureId = review?.fixture_id || task?.payload?.pilotFixture?.id || null;
  const fixtureRow = fixtureId ? get(
    db,
    `SELECT id, venture_id, captured_at, question, buyer, hypothesis, sources,
            constraints, fixture_hash, status, created_at
     FROM agent_pilot_fixtures WHERE id = ?`,
    [fixtureId],
  ) : null;
  const fixture = fixtureRow ? {
    ...fixtureRow,
    sources: fromJson(fixtureRow.sources, []),
    constraints: fromJson(fixtureRow.constraints, {}),
  } : null;
  const handoffs = parseRows(all(
    db,
    "SELECT * FROM agent_handoffs WHERE from_run_id = ? ORDER BY created_at ASC",
    [id],
  ));
  const approvalId = task?.payload?.liveSpendRequest?.approvalId || null;
  const approval = approvalId ? get(db, "SELECT id, status, scope_hash, requested_at, decided_at, consumed_at FROM approvals WHERE id = ?", [approvalId]) : null;
  const receiptResult = context.receipt?.receipt?.task?.result || null;
  const output = receiptResult?.output
    || task?.result?.output
    || runMetadata.localReviewOutput
    || runMetadata.localStructuredOutput
    || {};
  const rawRecommendation = output.pilotRecommendation || {
    evidence: output.evidence || [],
    counterevidence: output.counterevidence || [],
    assumptions: output.assumptions || [],
    priceChannelHypothesis: output.priceChannelHypothesis || "",
    smallestTest: output.smallestTest || output.nextAction || "",
    metric: output.metric || "",
    killRule: output.killRule || "",
    confidence: output.confidence || "",
    risks: output.risks || [],
  };
  const recommendation = productionRecommendationDisplay(
    db,
    task,
    output,
    rawRecommendation,
  );
  const approvedTracePolicy = task?.payload?.liveSpendRequest?.tracePolicy || null;
  const tracePolicy = context.protectedRehearsal
    ? {
        providerResponseStored: null,
        providerTraceContent: null,
        localReviewStored: true,
        dataClass: "internal_rehearsal",
        purpose: "No provider call was made; only the local rehearsal record exists.",
      }
    : approvedTracePolicy || {
        providerResponseStored: false,
        providerTraceContent: false,
        localReviewStored: true,
        dataClass: "legacy_controlled_input",
        purpose: "The provider trace policy was not captured for this earlier run. Pantheon retained the local structured record.",
      };
  const suppliedEvidence = fixture?.sources?.length
    ? fixture.sources.map((source) => ({
        id: source.id || null,
        title: source.title || "Evidence item",
        summary: source.summary || "",
        sourceType: source.sourceType || "supplied evidence",
        url: source.url || null,
      }))
    : (task?.payload?.protectedEvidence || []).map((item, index) => ({
        id: `supplied-${index + 1}`,
        title: `Supplied evidence ${index + 1}`,
        summary: typeof item === "string" ? item : item.summary || item.title || "Evidence supplied to the worker.",
        sourceType: "supplied evidence",
        url: typeof item === "object" ? item.url || null : null,
      }));
  const observedTools = context.tools.map((tool) => ({
    id: tool.id,
    toolId: tool.tool_id,
    name: tool.tool_name || tool.metadata?.toolName || tool.tool_id,
    requestedMode: tool.requested_mode,
    status: tool.status,
    decision: tool.decision,
    inputSummary: tool.input_summary,
    outputSummary: tool.output_summary,
    requestedAt: tool.requested_at,
    resolvedAt: tool.resolved_at,
  }));
  const sources = context.research.sources.map((source) => ({
    id: source.id,
    title: source.title,
    url: source.url,
    publisher: source.publisher,
    publishedAt: source.published_at,
    retrievedAt: source.retrieved_at,
    relevance: source.relevance,
    confidence: source.confidence,
    grounded: source.grounded,
  }));
  const runError = task?.error || runMetadata.error || (
    ["failed", "needs_attention"].includes(runRecord.status) ? runRecord.output_summary : null
  );
  const contextSnapshot = task?.payload?.contextSnapshot || null;
  const businessContext = contextSnapshot ? {
    id: contextSnapshot.id,
    hash: contextSnapshot.snapshotHash,
    policyVersion: contextSnapshot.policyVersion,
    accessProfile: contextSnapshot.accessProfile,
    purpose: contextSnapshot.purpose,
    recordClasses: contextSnapshot.recordClasses || [],
    recordCount: Number(contextSnapshot.recordCount || 0),
    dataPolicy: contextSnapshot.dataPolicy || {},
    sections: Object.entries(contextSnapshot.sections || {}).map(([name, section]) => ({
      name,
      recordCount: Array.isArray(section.records) ? section.records.length : 0,
      withheldLocalOnly: Number(section.withheldLocalOnly || 0),
      truncated: section.truncated === true,
      records: (section.records || []).map((item) => ({
        title: item.title,
        summary: item.summary,
        source: item.ref?.table || null,
      })),
    })),
  } : null;
  const displayTaskTitle = operatorProductionText(
    db,
    task?.title || runMetadata.taskTitle || "AI worker run",
    task?.payload || {},
  );

  return {
    schema: "jarvis_agent_run_review_v1",
    run: {
      id: runRecord.id,
      workerId: runRecord.agent_id,
      workerName: definition?.name || runRecord.agent_id,
      workerRole: definition?.role || "Specialist worker",
      taskId: runRecord.task_id,
      taskTitle: displayTaskTitle,
      status: runRecord.status,
      executionKind: context.kind,
      executionLabel: executionLabel(context.kind),
      summary: productionRecommendationDisplay(db, task, output, {
        priceChannelHypothesis: output.summary || runRecord.output_summary || "No result summary was captured.",
      }).priceChannelHypothesis,
      error: runError || null,
      startedAt: runRecord.started_at,
      completedAt: runRecord.completed_at,
      durationMs: elapsedMilliseconds(runRecord.started_at, runRecord.completed_at),
    },
    process: {
      explanation: "This is a structured account of the evidence, judgement and result. It does not expose hidden private model chain-of-thought.",
      question: operatorProductionText(
        db,
        fixture?.question || task?.title || task?.payload?.subject || "No question was recorded.",
        task?.payload || {},
      ),
      buyer: fixture?.buyer || output.businessDecision?.buyer || "No buyer was recorded.",
      hypothesis: productionRecommendationDisplay(db, task, output, {
        priceChannelHypothesis: fixture?.hypothesis
          || output.businessDecision?.continuousImprovement?.hypothesis
          || "No hypothesis was recorded.",
      }).priceChannelHypothesis,
      suppliedEvidence,
      businessContext,
      supportingEvidence: recommendation.evidence || [],
      counterevidence: recommendation.counterevidence || [],
      assumptions: recommendation.assumptions || [],
      conclusion: productionRecommendationDisplay(db, task, output, {
        priceChannelHypothesis: output.summary || runRecord.output_summary || "No conclusion was captured.",
      }).priceChannelHypothesis,
      priceChannelHypothesis: recommendation.priceChannelHypothesis || "Not stated.",
      smallestTest: recommendation.smallestTest || "Not stated.",
      metric: recommendation.metric || "Not stated.",
      stopRule: recommendation.killRule || "Not stated.",
      confidence: recommendation.confidence || output.confidence || "not stated",
      risks: recommendation.risks || output.risks || [],
      nextAction: productionRecommendationDisplay(db, task, output, {
        priceChannelHypothesis: output.nextAction
          || recommendation.smallestTest
          || "Review before continuing.",
      }).priceChannelHypothesis,
      operatorDecision: output.operatorDecision || "needs_evidence",
    },
    review: review ? {
      deterministicStatus: review.deterministic_status,
      operatorVerdict: review.operator_verdict,
      usefulnessScore: review.usefulness_score,
      note: review.note,
      criteria: review.criteria,
      outputHash: review.output_hash,
      reviewedAt: review.reviewed_at,
    } : null,
    execution: {
      kind: context.kind,
      label: executionLabel(context.kind),
      systemProof: task?.payload?.systemProof === true,
      providerAttempted: context.providerAttempted,
      provider: context.protectedRehearsal ? null : (modelCall?.metadata?.provider || review?.provider || context.liveRequest.provider || modelCall?.provider || null),
      requestedProvider: context.liveRequest.provider || modelCall?.provider || null,
      model: context.protectedRehearsal ? null : (modelCall?.selected_model || context.liveRequest.model || null),
      requestedModel: context.liveRequest.model || modelCall?.selected_model || null,
      modelRoute: context.liveRequest.modelRoute || null,
      responseId: context.responseId,
      traceId: context.traceId,
      inputTokens: context.actualTokens.input,
      outputTokens: context.actualTokens.output,
      totalTokens: context.actualTokens.total,
      actualTokens: context.actualTokens,
      plannedTokens: context.plannedTokens,
      rawResponses: context.protectedRehearsal ? null : Number(modelCall?.metadata?.rawResponseCount || 0),
      interruptions: context.protectedRehearsal ? null : Number(modelCall?.metadata?.interruptionCount || 0),
      sdkTools: Array.isArray(context.liveRequest.tools) ? context.liveRequest.tools : [],
      requestedTools: Array.isArray(context.liveRequest.tools) ? context.liveRequest.tools : [],
      observedTools,
      sources,
      groundedSources: sources.filter((source) => source.grounded),
      research: context.research.run ? {
        id: context.research.run.id,
        status: context.research.run.status,
        mode: context.research.run.mode,
        summary: context.research.run.summary,
      } : null,
      sdkHandoffs: 0,
      runtimeHandoffs: handoffs.map((handoff) => ({
        id: handoff.id,
        from: handoff.from_agent_id,
        to: handoff.to_agent_id,
        status: handoff.status,
        summary: handoff.summary,
        decisionNeeded: handoff.decision_needed,
        riskLevel: handoff.risk_level,
        resolvedAt: handoff.resolved_at,
      })),
      externalEffects: task?.payload?.liveSpendRequest?.effects || [],
      workGroup: context.traceGroup ? {
        id: context.traceGroup.groupId || null,
        scopeType: context.traceGroup.scopeType || null,
        scopeId: context.traceGroup.scopeId || null,
        label: workGroupLabel(context.traceGroup, displayTaskTitle),
      } : null,
      harness: context.agentHarness ? {
        hash: context.agentHarness.harnessHash || null,
        versions: context.agentHarness.versions || {},
      } : null,
      sdkGuardrails: context.sdkGuardrails,
      cacheUsage: context.cacheUsage,
      tracePolicy: {
        ...tracePolicy,
        legacyPolicyInferred: !context.protectedRehearsal && approvedTracePolicy === null,
      },
      businessContext: businessContext ? {
        id: businessContext.id,
        hash: businessContext.hash,
        accessProfile: businessContext.accessProfile,
        recordClasses: businessContext.recordClasses,
        recordCount: businessContext.recordCount,
      } : null,
      cost: {
        status: context.costStatus,
        actualCents: context.actualCostCents,
        estimatedCents: Number(modelCall?.estimated_cost_cents || 0),
        plannedCapCents: Number(context.liveRequest.maxCostCents || context.liveRequest.estimatedCostCents || task?.cost_budget_cents || 0),
        reconciledCents: context.reconciledCents,
        providerSpendOccurred: !context.protectedRehearsal && context.actualCostCents !== null,
        currency: context.cost?.currency || CONFIG.currency,
      },
      output,
      error: runError || null,
    },
    quality: evaluation ? {
      status: evaluation.status,
      score: evaluation.score,
      criteria: evaluation.criteria,
      findings: evaluation.findings,
      evaluationId: evaluation.id,
      evaluatorVersion: evaluation.evaluator_version || null,
      layers: evaluation.metadata?.evaluationLayers
        || runMetadata.evaluationLayers
        || null,
    } : null,
    receipt: context.receipt ? {
      id: context.receipt.id,
      status: context.receipt.status,
      outcomeStatus: context.receipt.outcome_status,
      hash: context.receipt.receipt_hash,
      previousHash: context.receipt.previous_hash,
      missingFields: context.receipt.missing_fields,
      warnings: context.receipt.warnings,
      createdAt: context.receipt.created_at,
    } : null,
    developer: {
      fixtureId,
      fixtureHash: fixture?.fixture_hash || task?.payload?.liveSpendRequest?.fixtureHash || null,
      contextSnapshotHash: businessContext?.hash || null,
      approval,
      modelCallId: modelCall?.id || null,
      researchRunId: context.research.run?.id || null,
      structuredOutput: output,
      traceEvents: context.traces,
      agentHarness: context.agentHarness,
      traceGroup: context.traceGroup,
      sdkGuardrails: context.sdkGuardrails,
      cacheUsage: context.cacheUsage,
    },
  };
}

module.exports = {
  getAgentDetail,
  getAgentRunDetail,
  getAgentRunsState,
  getAiTeamState,
  getBusinessTestsState,
  getCockpitState,
  getDecisionsState,
  getHistoricalBusinessTestsState,
  getHistoricalTestDetail,
  getSystemState,
  humanTaskStatus,
  spendState,
};
