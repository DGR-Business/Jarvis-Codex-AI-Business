const assert = require("node:assert/strict");
const test = require("node:test");

const {
  COMMERCIAL_CONSTITUTION_VERSION,
  INVESTMENT_CRITERIA,
  SOURCE_TIERS,
} = require("../config/commercial-constitution");
const spec = require("../config/commercial-readiness-social-media-manager-scope-guard-v1");

test("readiness record retains the opportunity but revises it before build", () => {
  assert.equal(spec.schema, "pantheon_commercial_readiness_spec_v1");
  assert.equal(spec.version, "2026.07.29-v1");
  assert.equal(spec.commercialConstitutionVersion, COMMERCIAL_CONSTITUTION_VERSION);
  assert.equal(spec.opportunity.name, "Social Media Manager Client Approval & Scope Guard Kit");
  assert.equal(spec.opportunity.lifecycle, "distinct_new_hypothesis");
  assert.equal(spec.opportunity.distinctFromStoppedWork, true);
  assert.equal(spec.decision.status, "research_more");
  assert.equal(spec.decision.offerDisposition, "revise");
  assert.equal(spec.decision.productionReady, false);
  assert.equal(spec.decision.externalTestReady, false);
});

test("preparation has no external authority, spend, active build, or active test", () => {
  assert.equal(spec.authority.externalAuthority, "none");
  assert.equal(spec.authority.externalSpendCapAudCents, 0);
  assert.equal(spec.authority.preparationOnly, true);
  assert.equal(spec.authority.buildAuthorized, false);
  assert.equal(spec.authority.buildActive, false);
  assert.equal(spec.authority.commercialTestAuthorized, false);
  assert.equal(spec.authority.commercialTestActive, false);
  assert.equal(spec.authority.separateProtectedApprovalRequired, true);
  assert.ok(spec.authority.prohibitedActions.includes("buyer_contact"));
  assert.ok(spec.authority.prohibitedActions.includes("publication"));
  assert.ok(spec.authority.prohibitedActions.includes("external_spend"));
});

test("A$29, Etsy, Gumroad, and product format remain explicit hypotheses", () => {
  assert.deepEqual(
    {
      status: spec.hypotheses.price.status,
      currency: spec.hypotheses.price.currency,
      amountCents: spec.hypotheses.price.amountCents,
      label: spec.hypotheses.price.label,
    },
    { status: "hypothesis", currency: "AUD", amountCents: 2900, label: "A$29" },
  );
  assert.equal(spec.hypotheses.price.evidenceState, "plausible_not_proved");
  assert.equal(spec.hypotheses.primaryChannel.name, "Etsy");
  assert.equal(spec.hypotheses.primaryChannel.status, "hypothesis");
  assert.equal(spec.hypotheses.primaryChannel.selectionState, "conditional_not_selected");
  assert.equal(spec.hypotheses.fallbackChannel.name, "Gumroad");
  assert.equal(spec.hypotheses.fallbackChannel.status, "hypothesis");
  assert.equal(spec.hypotheses.fallbackChannel.selectionState, "not_selected");
  assert.equal(spec.hypotheses.productFormat.status, "hypothesis");
  assert.equal(spec.hypotheses.productFormat.candidates.length, 3);
});

test("all twelve readiness gates are explicit and cover every constitutional criterion", () => {
  assert.equal(spec.readinessGates.length, 12);
  assert.equal(new Set(spec.readinessGates.map((gate) => gate.id)).size, 12);
  assert.ok(spec.readinessGates.every((gate) => gate.required === true));
  assert.ok(spec.readinessGates.every((gate) => gate.status && gate.finding && gate.unresolved && gate.nextEvidence));

  const expectedCriteria = INVESTMENT_CRITERIA.map((criterion) => criterion.id).sort();
  const coveredCriteria = [...new Set(spec.readinessGates.flatMap((gate) => gate.constitutionCriteria))].sort();
  assert.deepEqual(spec.constitutionRequiredCriteria.slice().sort(), expectedCriteria);
  assert.deepEqual(coveredCriteria, expectedCriteria);

  const directDemand = spec.readinessGates.find((gate) => gate.id === "direct_demand");
  const offer = spec.readinessGates.find((gate) => gate.id === "offer_value");
  const risk = spec.readinessGates.find((gate) => gate.id === "risk");
  assert.equal(directDemand.status, "unresolved");
  assert.equal(offer.status, "revise");
  assert.equal(risk.status, "owner_decision_required");
});

test("owner-only Etsy identity, legal, accountability, and design decisions remain unresolved", () => {
  assert.equal(spec.unresolvedOwnerDecisions.length, 4);
  assert.ok(spec.unresolvedOwnerDecisions.every((decision) => decision.status === "unresolved"));
  assert.ok(spec.unresolvedOwnerDecisions.every((decision) => decision.requiresOwner === true));
  assert.ok(spec.unresolvedOwnerDecisions.every((decision) => decision.protectedAction === true));
  assert.ok(spec.unresolvedOwnerDecisions.every((decision) => decision.blockingForEtsySelection === true));
  assert.ok(spec.unresolvedOwnerDecisions.some((decision) => /government-ID\/selfie/i.test(decision.question)));
  assert.ok(spec.unresolvedOwnerDecisions.some((decision) => /seller terms/i.test(decision.question)));
  assert.ok(spec.unresolvedOwnerDecisions.some((decision) => /accountable designer\/owner/i.test(decision.question)));
  assert.ok(spec.unresolvedOwnerDecisions.some((decision) => /another lawful channel/i.test(decision.question)));
});

test("provisional economics cannot be confused with buyers, settled cash, or proof", () => {
  assert.equal(spec.provisionalEconomics.status, "estimate_not_actual");
  assert.equal(spec.provisionalEconomics.etsyDomesticExample.priceAudCents, 2900);
  assert.equal(spec.provisionalEconomics.etsyDomesticExample.estimatedProceedsBeforeOtherCostsAudCents, 2571);
  assert.equal(spec.provisionalEconomics.gumroadThreeBuyerExample.grossAudCents, 8700);
  assert.equal(spec.provisionalEconomics.gumroadThreeBuyerExample.status, "unsettled_hypothesis");
  assert.equal(spec.proofStandard.presentResult.buyers, 0);
  assert.equal(spec.proofStandard.presentResult.revenueAudCents, 0);
  assert.equal(spec.proofStandard.presentResult.externalSpendAudCents, 0);
  assert.equal(spec.proofStandard.presentResult.netCashContribution, "not_settled");
  assert.equal(spec.proofStandard.presentResult.commercialProofReached, false);
});

test("every cited readiness source has retained provenance and a limitation", () => {
  const sources = new Map(spec.sources.map((source) => [source.id, source]));
  const requiredTierByKind = new Map([
    ["marketplace_listing_observation", 3],
    ["marketplace_result_observation", 3],
    ["official_vendor_pricing", 1],
    ["official_vendor_documentation", 1],
    ["official_reference_rate", 1],
    ["official_platform_policy", 1],
    ["established_professional_guidance", 2],
    ["practitioner_discussion", 4],
  ]);
  assert.equal(sources.size, spec.sources.length);
  assert.ok(spec.sources.every((source) => Number.isInteger(source.tier) && source.tier >= 1 && source.tier <= 4));
  assert.equal(SOURCE_TIERS[3], "Methodologically disclosed commercial research and marketplace observations");
  assert.ok(spec.sources.every((source) => (
    !requiredTierByKind.has(source.kind)
    || source.tier === requiredTierByKind.get(source.kind)
  )));
  assert.ok(spec.sources.every((source) => source.url.startsWith("https://")));
  assert.ok(spec.sources.every((source) => source.observedAt === "2026-07-29"));
  assert.ok(spec.sources.every((source) => source.supports && source.limitation));

  for (const gate of spec.readinessGates) {
    for (const sourceId of gate.evidenceRefs) {
      assert.ok(sources.has(sourceId), `Missing source ${sourceId} for gate ${gate.id}`);
    }
  }
});

test("the readiness record is deeply immutable and records no external occurrence", () => {
  assert.equal(Object.isFrozen(spec), true);
  assert.equal(Object.isFrozen(spec.authority), true);
  assert.equal(Object.isFrozen(spec.readinessGates), true);
  assert.equal(Object.isFrozen(spec.readinessGates[0]), true);
  assert.equal(Object.isFrozen(spec.sources), true);
  assert.equal(Object.isFrozen(spec.sources[0]), true);

  assert.equal(spec.nonOccurrenceRecord.buyerContact, false);
  assert.equal(spec.nonOccurrenceRecord.calls, false);
  assert.equal(spec.nonOccurrenceRecord.emails, false);
  assert.equal(spec.nonOccurrenceRecord.accountsCreatedOrChanged, false);
  assert.equal(spec.nonOccurrenceRecord.kyc, false);
  assert.equal(spec.nonOccurrenceRecord.legalAcceptance, false);
  assert.equal(spec.nonOccurrenceRecord.publishing, false);
  assert.equal(spec.nonOccurrenceRecord.advertising, false);
  assert.equal(spec.nonOccurrenceRecord.purchases, false);
  assert.equal(spec.nonOccurrenceRecord.externalSpendAudCents, 0);
  assert.equal(spec.nonOccurrenceRecord.orders, 0);
  assert.equal(spec.nonOccurrenceRecord.revenueAudCents, 0);
  assert.equal(spec.nonOccurrenceRecord.actualNetCashContribution, "not_settled");
});
