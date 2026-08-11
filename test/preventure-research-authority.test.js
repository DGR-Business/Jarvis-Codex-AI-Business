"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const readinessSpec = require("../config/commercial-readiness-social-media-manager-scope-guard-v1");
const authority = require("../config/preventure-research-authority-smm-scope-guard-v1");
const {
  AUTHORITY_OUTCOMES,
  PREVENTURE_RESEARCH_AUTHORITY_SCHEMA,
  REQUIRED_READINESS_GATE_IDS,
  authorityHashBody,
  calculatePreventureResearchWorstCaseExposureAud,
  createPreventureLifecycleEvent,
  createPreventureResearchAuthority,
  createPreventureResearchDecision,
  decisionHashBody,
  effectivePreventureLifecycleState,
  preventureResearchApprovalScopeHash,
  validatePreventureLifecycleChain,
  validatePreventureResearchAuthority,
  validatePreventureResearchDecision,
} = require("../src/runtime/preventure-research-contract");
const { sha256 } = require("../src/runtime/commercial-test-contract");

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function decisionInput(overrides = {}) {
  const comparatorIds = Array.from({ length: 10 }, (_, index) => `cmp_${String(index + 1).padStart(2, "0")}`);
  return {
    id: "decision_smm_scope_guard_2026_08_02_v2",
    version: "2026.08.02-v2",
    outcome: "research_more",
    completionMode: "full_round",
    earlyStopRecordHash: null,
    skippedAssignmentRecordHashes: [],
    nextEvidenceAction: null,
    decidedAt: "2026-08-02T15:00:00+10:00",
    comparatorCount: comparatorIds.length,
    estimatedInternalAiCostAudCents: 180,
    reconciledInternalAiCostAudCents: 0,
    exactBillingPending: true,
    externalCommercialSpendAudCents: 0,
    provenanceComplete: true,
    unknownProviderOutcomeCount: 0,
    unknownCostCount: 0,
    evidenceSetHash: sha256({ evidence: "fixture" }),
    receiptSetHash: sha256({ receipts: "fixture" }),
    summary: "The opportunity remains plausible, but read-only evidence does not prove exact-offer willingness to pay.",
    buyer: "Freelance social-media managers with retained clients",
    problem: "Fragmented approvals, revision control, scope impacts, and delivery evidence",
    offer: "A no-subscription operational-control kit with no legal-contract positioning",
    channel: "No channel selected; retain cash while the named gap remains",
    priceOrMargin: "A$19, A$29, and A$39 remain planning cases, not realised prices",
    evidenceStandard: "Current public sources with provenance, contrary evidence, and no sales inference from visibility",
    nextMoneyMove: "Retain cash and request only the smallest economical evidence that could change the decision",
    reviseOrStopCriteria: ["Stop if no economical path can resolve the exact-offer demand gap."],
    sourceIds: ["source_01", "source_02", "source_03"],
    comparatorIds,
    comparatorCoverage: {
      directOrNearDirectCount: 4,
      adjacentCount: 3,
      indirectCount: 3,
      maximumAcceptedOffersPerSeller: 2,
      perFormatCounts: {
        notion_client_portal: 2,
        scripts_evidence_log_micro_kit: 2,
        spreadsheet_documents_no_login: 2,
      },
      observedChannelIds: ["etsy", "gumroad"],
      selectionMethodApplied: true,
      sellerIdentityComplete: true,
    },
    formatCases: [
      { id: "notion_client_portal", disposition: "revise" },
      { id: "scripts_evidence_log_micro_kit", disposition: "retain" },
      { id: "spreadsheet_documents_no_login", disposition: "retain" },
    ],
    channelCases: [
      { id: "etsy", state: "conditional_unverified" },
      { id: "gumroad", state: "not_selected" },
      { id: "evidence_supported_lawful_alternative", state: "research_more" },
      { id: "retain_cash", state: "available" },
    ],
    economicsCases: [
      ...["etsy", "gumroad"].flatMap((channelId) => [1900, 2900, 3900].map((priceAudCents) => ({
        channelId,
        priceAudCents,
        state: "estimated",
        estimatedNetCashContributionAudCents: priceAudCents - 500,
        unknownCosts: [],
        evidenceRefs: ["source_01"],
      }))),
      ...[1900, 2900, 3900].map((priceAudCents) => ({
        channelId: "evidence_supported_lawful_alternative",
        priceAudCents,
        state: "unknown",
        estimatedNetCashContributionAudCents: null,
        unknownCosts: ["channel_fee_unknown"],
        evidenceRefs: [],
      })),
      ...[1900, 2900, 3900].map((priceAudCents) => ({
        channelId: "retain_cash",
        priceAudCents,
        state: "known_zero",
        estimatedNetCashContributionAudCents: 0,
        unknownCosts: [],
        evidenceRefs: [],
      })),
    ],
    contraryEvidence: [{ id: "contrary_01", status: "retained" }],
    materialContradictions: [],
    readinessGates: REQUIRED_READINESS_GATE_IDS.map((id) => ({
      id,
      required: true,
      status: id === "buyer_problem" ? "supported" : "unresolved",
    })),
    limitations: ["Read-only research cannot prove willingness to pay for the exact unbuilt offer."],
    nonOccurrenceRecord: {
      productBuilt: false,
      buyerContact: false,
      accountInspectedOrChanged: false,
      publishing: false,
      advertising: false,
      externalSpendAudCents: 0,
      orders: 0,
      revenueAudCents: 0,
      settledNetCashContribution: "not_settled",
    },
    ...overrides,
  };
}

test("the approved authority is exact, readiness-bound, capped, and external-action-free", () => {
  assert.equal(authority.schema, PREVENTURE_RESEARCH_AUTHORITY_SCHEMA);
  assert.equal(authority.readinessBinding.id, readinessSpec.id);
  assert.equal(authority.readinessBinding.version, readinessSpec.version);
  assert.equal(authority.readinessBinding.hash, "sha256:8c76765b27486c34a4727720cb48023d9d1da184e7e916dee9435f9566572cbe");
  assert.equal(authority.readinessBinding.hash, sha256(readinessSpec));
  assert.equal(authority.commercialConstitutionVersion, "2026.07.27-v1");
  assert.equal(authority.authorityHash, "sha256:0b8dd7380f38a673e683482dd9fdbf0b4c1aff7c1eeb28341ca869927f0fa7ba");
  assert.equal(authority.internalAiSpendCapAudCents, 200);
  assert.equal(authority.externalCommercialSpendCapAudCents, 0);
  assert.equal(authority.totalWorstCaseExposureAudCents, 150);
  assert.equal(authority.assignments.reduce((total, assignment) => total + assignment.maxCostAudCents, 0), 150);
  assert.ok(authority.assignments.every((assignment) => assignment.maxInputTokens === 272000));
  assert.ok(authority.assignments.every((assignment) => assignment.localPromptPreflightMaxInputTokens === 30000));
  assert.ok(authority.assignments.every((assignment) => assignment.maxOutputTokens === 12000));
  assert.ok(authority.assignments.every((assignment) => assignment.maxToolCalls === 2));
  assert.ok(authority.assignments.every((assignment) => assignment.maximumModelPasses === 3));
  assert.ok(authority.assignments.every((assignment) => assignment.maxTurns === 1));
  assert.equal(authority.provider.model, "gpt-5-mini-2025-08-07");
  assert.equal(authority.provider.modelCard.modelId, "gpt-5-mini");
  assert.equal(authority.provider.modelCard.maxInputTokens, 272000);
  assert.equal(authority.provider.pricingPolicy.pricingTier, "standard");
  assert.equal(authority.provider.pricingPolicy.inputUsdPerMillionTokens, 0.25);
  assert.equal(authority.provider.pricingPolicy.outputUsdPerMillionTokens, 2);
  assert.deepEqual(authority.provider.requestPolicy, {
    service_tier: "default",
    background: false,
    store: false,
    tools: [{
      type: "web_search",
      external_web_access: true,
      return_token_budget: "default",
      search_context_size: "medium",
    }],
    tool_choice: "required",
    include: ["web_search_call.action.sources"],
    parallel_tool_calls: false,
    reasoning: { effort: "low" },
    text: {
      format: {
        type: "json_schema",
        name: "preventure_research_result",
        strict: true,
        schemaBinding: "server_owned_assignment_schema",
      },
    },
  });
  assert.ok(authority.provider.requestPolicySourceUrls.includes(
    "https://developers.openai.com/api/docs/guides/tools-web-search#live-internet-access",
  ));
  assert.deepEqual(authority.assignments[0].worstCaseExposure, {
    method: "integer_ceiling_published_standard_price_v1",
    currency: "AUD",
    maxInputTokensPerModelPass: 272000,
    maximumModelPasses: 3,
    maximumBillableInputTokens: 816000,
    maxOutputTokens: 12000,
    maxToolCalls: 2,
    inputCostUsdMicros: 204000,
    outputCostUsdMicros: 24000,
    webSearchCostUsdMicros: 20000,
    totalCostUsdMicros: 248000,
    audPerUsdCeilingMicros: 2000000,
    amountAudCents: 50,
    exactBillingPending: true,
  });
  assert.deepEqual(
    calculatePreventureResearchWorstCaseExposureAud(authority.provider.pricingPolicy, {
      maxInputTokens: 272000,
      maxOutputTokens: 12000,
      maxToolCalls: 2,
      maximumModelPasses: 3,
    }),
    authority.assignments[0].worstCaseExposure,
  );
  assert.match(authority.provider.pricingPolicyHash, /^sha256:[a-f0-9]{64}$/);
  assert.deepEqual(authority.priceCasesAudCents, [1900, 2900, 3900]);
  assert.deepEqual(authority.allowedOutcomes, AUTHORITY_OUTCOMES);
  assert.equal(authority.ownerInputs.find((item) => item.id === "etsy_seller_account_exists").verificationState, "owner_reported_unverified");
  assert.equal(authority.completionRules.buildMeansRecommendationOnly, true);
  assert.equal(Object.isFrozen(authority), true);
  assert.equal(validatePreventureResearchAuthority(authority, readinessSpec), authority);
});

test("authority mutation, widened spend, repeated dispatch, and removed hard stops fail closed", () => {
  const readinessTamper = clone(authority);
  readinessTamper.readinessBinding.hash = sha256({ different: true });
  assert.throws(
    () => validatePreventureResearchAuthority(readinessTamper, readinessSpec),
    /exact readiness record bytes/i,
  );

  const spendTamper = clone(authority);
  spendTamper.internalAiSpendCapAudCents = 201;
  assert.throws(
    () => validatePreventureResearchAuthority(spendTamper, readinessSpec),
    /A\$2\.00/i,
  );

  const retryTamper = clone(authority);
  retryTamper.assignments[0].maxAttempts = 2;
  assert.throws(
    () => validatePreventureResearchAuthority(retryTamper, readinessSpec),
    /stop after one provider attempt/i,
  );

  const actionTamper = clone(authority);
  actionTamper.prohibitedActions = actionTamper.prohibitedActions.filter((item) => item !== "buyer_contact");
  assert.throws(
    () => validatePreventureResearchAuthority(actionTamper, readinessSpec),
    /Prohibited actions|prohibit buyer_contact/i,
  );
});

test("lifecycle acceptance and activation are separate exact approvals and terminal states cannot reopen", () => {
  const proposed = createPreventureLifecycleEvent(authority, [], {
    id: "preventure_event_proposed",
    eventType: "proposed",
    occurredAt: "2026-08-02T11:30:00+10:00",
    actor: "jarvis",
    reason: "The exact owner-approved authority was registered without creating work.",
  });
  assert.equal(proposed.sequence, 1);
  assert.equal(proposed.previousEventHash, null);

  assert.throws(
    () => createPreventureLifecycleEvent(authority, [proposed], {
      id: "preventure_event_accepted_missing_scope",
      eventType: "accepted",
      occurredAt: "2026-08-02T11:31:00+10:00",
      actor: "owner",
      reason: "Missing exact approval scope.",
    }),
    /exact approved scope/i,
  );

  const accepted = createPreventureLifecycleEvent(authority, [proposed], {
    id: "preventure_event_accepted",
    eventType: "accepted",
    approvalId: "approval_preventure_accept",
    approvalScopeHash: preventureResearchApprovalScopeHash(authority, "accepted"),
    occurredAt: "2026-08-02T11:31:00+10:00",
    actor: "owner",
    reason: "Daniel accepted the exact questions, evidence boundaries, and caps.",
  });
  const activated = createPreventureLifecycleEvent(authority, [proposed, accepted], {
    id: "preventure_event_activated",
    eventType: "activated",
    approvalId: "approval_preventure_activate",
    approvalScopeHash: preventureResearchApprovalScopeHash(authority, "activated"),
    occurredAt: "2026-08-02T11:32:00+10:00",
    actor: "owner",
    reason: "Daniel activated this exact internal diligence round.",
  });
  const revoked = createPreventureLifecycleEvent(authority, [proposed, accepted, activated], {
    id: "preventure_event_revoked",
    eventType: "revoked",
    occurredAt: "2026-08-02T11:33:00+10:00",
    actor: "owner",
    reason: "The owner stopped all further research dispatch.",
  });
  assert.equal(activated.previousEventHash, accepted.eventHash);
  assert.throws(
    () => createPreventureLifecycleEvent(authority, [proposed, accepted, activated, revoked], {
      id: "preventure_event_reopened",
      eventType: "activated",
      approvalId: "approval_preventure_reopen",
      approvalScopeHash: preventureResearchApprovalScopeHash(authority, "activated"),
      occurredAt: "2026-08-02T11:34:00+10:00",
      actor: "owner",
      reason: "A terminal authority must not reopen.",
    }),
    /cannot move/i,
  );
});

test("a versioned diligence decision remains capped and build fails closed on unresolved proof", () => {
  const researchMore = createPreventureResearchDecision(authority, decisionInput());
  assert.equal(researchMore.outcome, "research_more");
  assert.equal(researchMore.buildAuthorized, false);
  assert.equal(researchMore.commercialTestAuthorized, false);
  assert.equal(researchMore.externalActionAuthorized, false);

  assert.throws(
    () => createPreventureResearchDecision(authority, decisionInput({ estimatedInternalAiCostAudCents: 201 })),
    /exceeds its internal AI cost cap/i,
  );
  assert.throws(
    () => createPreventureResearchDecision(authority, decisionInput({ comparatorCount: 9 })),
    /10 to 15 comparator/i,
  );
  assert.throws(
    () => createPreventureResearchDecision(authority, decisionInput({ outcome: "build" })),
    /build recommendation requires/i,
  );
});

test("freshly rehashed safety-policy changes and unknown authority fields still fail closed", () => {
  for (const mutate of [
    (candidate) => { candidate.provider.responseStorage = true; },
    (candidate) => { candidate.provider.tool = "computer_use"; },
    (candidate) => { candidate.provider.model = "gpt-5-mini"; },
    (candidate) => { candidate.provider.modelCard.maxInputTokens = 272001; },
    (candidate) => { candidate.provider.requestPolicy.service_tier = "priority"; },
    (candidate) => { candidate.provider.requestPolicy.tools[0].external_web_access = false; },
    (candidate) => { candidate.provider.requestPolicy.tools[0].return_token_budget = "unlimited"; },
    (candidate) => { candidate.provider.requestPolicy.tools[0].search_context_size = "low"; },
    (candidate) => { candidate.provider.requestPolicy.reasoning.effort = "medium"; },
    (candidate) => { candidate.provider.requestPolicy.text.format.strict = false; },
    (candidate) => {
      candidate.provider.pricingPolicy.outputUsdPerMillionTokens = 1;
      candidate.provider.pricingPolicyHash = sha256(candidate.provider.pricingPolicy);
    },
    (candidate) => { candidate.assignments[0].maxInputTokens = 271999; },
    (candidate) => { candidate.assignments[0].localPromptPreflightMaxInputTokens = 30001; },
    (candidate) => { candidate.assignments[0].maxOutputTokens = 12001; },
    (candidate) => { candidate.assignments[0].maxToolCalls = 3; },
    (candidate) => { candidate.assignments[0].maximumModelPasses = 2; },
    (candidate) => { candidate.assignments[0].worstCaseExposure.amountAudCents = 49; },
    (candidate) => { candidate.totalWorstCaseExposureAudCents = 149; },
    (candidate) => { candidate.sourcePolicy.disallowedAccess = []; },
    (candidate) => { candidate.comparatorScope.etsyEvidenceRequired = false; },
    (candidate) => { candidate.completionRules.stopOnUnknownProviderOutcomeOrCost = false; },
    (candidate) => { candidate.allowPublishing = true; },
  ]) {
    const candidate = clone(authority);
    mutate(candidate);
    candidate.authorityHash = sha256(authorityHashBody(candidate));
    assert.throws(
      () => validatePreventureResearchAuthority(candidate, readinessSpec),
      /must remain|fields must be exactly|policy|boundary|requirement|provider tool|reviewed|exposure|input|output|search|reasoning/i,
    );
  }
});

test("lifecycle validator rejects forged chains, approval reuse, and post-expiry activation", () => {
  const proposed = createPreventureLifecycleEvent(authority, [], {
    id: "preventure_chain_proposed",
    eventType: "proposed",
    occurredAt: "2026-08-02T12:00:00+10:00",
    actor: "jarvis",
    reason: "Register the exact reviewed authority.",
  });
  const accepted = createPreventureLifecycleEvent(authority, [proposed], {
    id: "preventure_chain_accepted",
    eventType: "accepted",
    approvalId: "approval_chain_accept",
    approvalScopeHash: preventureResearchApprovalScopeHash(authority, "accepted"),
    occurredAt: "2026-08-02T12:01:00+10:00",
    actor: "owner",
    reason: "Accept the exact bounded policy.",
  });

  assert.throws(
    () => createPreventureLifecycleEvent(authority, [proposed, accepted], {
      id: "preventure_chain_reused_approval",
      eventType: "activated",
      approvalId: "approval_chain_accept",
      approvalScopeHash: preventureResearchApprovalScopeHash(authority, "activated"),
      occurredAt: "2026-08-02T12:02:00+10:00",
      actor: "owner",
      reason: "A reused decision cannot activate work.",
    }),
    /distinct single-use approvals/i,
  );

  const forged = clone(accepted);
  forged.previousEventHash = sha256({ forged: true });
  const { eventHash: _oldHash, ...forgedBody } = forged;
  forged.eventHash = sha256(forgedBody);
  assert.throws(
    () => validatePreventureLifecycleChain(authority, [proposed, forged]),
    /previous event hash/i,
  );

  assert.throws(
    () => createPreventureLifecycleEvent(authority, [proposed, accepted], {
      id: "preventure_chain_expired_activation",
      eventType: "activated",
      approvalId: "approval_chain_activate",
      approvalScopeHash: preventureResearchApprovalScopeHash(authority, "activated"),
      occurredAt: "2026-08-09T11:29:40.4051170+10:00",
      actor: "owner",
      reason: "Expired authority cannot dispatch work.",
    }),
    /after authority expiry/i,
  );

  const activated = createPreventureLifecycleEvent(authority, [proposed, accepted], {
    id: "preventure_chain_activated",
    eventType: "activated",
    approvalId: "approval_chain_activate_distinct",
    approvalScopeHash: preventureResearchApprovalScopeHash(authority, "activated"),
    occurredAt: "2026-08-02T12:02:00+10:00",
    actor: "owner",
    reason: "Activate the exact bounded assignments.",
  });
  assert.equal(
    effectivePreventureLifecycleState(authority, [proposed, accepted, activated], "2026-08-10T00:00:00+10:00"),
    "expired",
  );
  assert.throws(
    () => createPreventureLifecycleEvent(authority, [proposed, accepted, activated], {
      id: "preventure_chain_unbound_completion",
      eventType: "completed",
      occurredAt: "2026-08-02T12:03:00+10:00",
      actor: "pantheon",
      reason: "An unbound completion must fail.",
      metadata: {},
    }),
    /completed lifecycle metadata fields/i,
  );
});

test("decision coverage, non-occurrence truth, and persisted hashes fail closed", () => {
  assert.throws(
    () => createPreventureResearchDecision(authority, decisionInput({ decidedAt: "2026-08-01T12:00:00+10:00" })),
    /within the approved authority window/i,
  );
  assert.throws(
    () => createPreventureResearchDecision(authority, decisionInput({ version: authority.readinessBinding.version })),
    /new version that supersedes/i,
  );
  assert.throws(
    () => createPreventureResearchDecision(authority, decisionInput({ readinessGates: [] })),
    /every required pre-venture readiness gate/i,
  );
  assert.throws(
    () => createPreventureResearchDecision(authority, decisionInput({
      formatCases: Array.from({ length: 3 }, () => ({ id: "notion_client_portal", disposition: "retain" })),
    })),
    /exact format cases/i,
  );
  assert.throws(
    () => createPreventureResearchDecision(authority, decisionInput({
      channelCases: Array.from({ length: 4 }, () => ({ id: "etsy", state: "not_selected" })),
    })),
    /exact Etsy, Gumroad/i,
  );
  assert.throws(
    () => createPreventureResearchDecision(authority, decisionInput({ contraryEvidence: [] })),
    /contrary-evidence pass/i,
  );
  assert.throws(
    () => createPreventureResearchDecision(authority, decisionInput({ economicsCases: [] })),
    /every approved channel.*economics case/i,
  );
  assert.throws(
    () => createPreventureResearchDecision(authority, decisionInput({
      comparatorCoverage: {
        ...decisionInput().comparatorCoverage,
        perFormatCounts: {
          notion_client_portal: 999,
          scripts_evidence_log_micro_kit: 999,
          spreadsheet_documents_no_login: 999,
        },
      },
    })),
    /exceeds the accepted comparator ledger/i,
  );
  assert.throws(
    () => createPreventureResearchDecision(authority, decisionInput({
      channelCases: decisionInput().channelCases.map((item) => (
        item.id === "etsy" ? { ...item, externalActionAuthorized: true } : item
      )),
    })),
    /channel case.*fields must be exactly/i,
  );
  assert.throws(
    () => createPreventureResearchDecision(authority, decisionInput({ unknownCostCount: 1 })),
    /cannot be sealed.*unknown/i,
  );
  assert.throws(
    () => createPreventureResearchDecision(authority, decisionInput({
      nonOccurrenceRecord: {
        ...decisionInput().nonOccurrenceRecord,
        productBuilt: true,
      },
    })),
    /productBuilt must remain false/i,
  );

  const decision = createPreventureResearchDecision(authority, decisionInput());
  assert.equal(validatePreventureResearchDecision(authority, decision), decision);
  const tampered = clone(decision);
  tampered.buildAuthorized = true;
  tampered.decisionHash = sha256(decisionHashBody(tampered));
  assert.throws(
    () => validatePreventureResearchDecision(authority, tampered),
    /unsupported or non-canonical/i,
  );
});

test("nested authority content is deeply frozen even when an input parent was pre-frozen", () => {
  const input = authorityHashBody(clone(authority));
  delete input.schema;
  delete input.readinessBinding;
  Object.freeze(input.sourcePolicy);
  const candidate = createPreventureResearchAuthority(input, readinessSpec);
  assert.equal(Object.isFrozen(candidate.sourcePolicy), true);
  assert.equal(Object.isFrozen(candidate.sourcePolicy.classes), true);
});
