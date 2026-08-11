"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const readinessSpec = require("../config/commercial-readiness-social-media-manager-scope-guard-v1");
const v1Authority = require("../config/preventure-research-authority-smm-scope-guard-v1");
const {
  createPreventureResearchAuthorityV2,
  createPreventureResearchProviderFactRecord,
  createPreventureResearchProviderReviewV2,
  PREVENTURE_RESEARCH_APPROVAL_SCOPE_V2_SCHEMA,
  PREVENTURE_RESEARCH_AUTHORITY_V2_SCHEMA,
  preventureResearchApprovalScope,
  preventureResearchProviderFactHashes,
  validatePreventureResearchAuthority,
  validatePreventureResearchProviderFactRecord,
} = require("../src/runtime/preventure-research-contract");
const { sha256 } = require("../src/runtime/commercial-test-contract");
const {
  PREVENTURE_RESEARCH_AUTHORITY_REGISTRY_SCHEMA,
  createPreventureResearchAuthorityRegistry,
  defaultPreventureResearchAuthorityRegistry,
} = require("../src/runtime/preventure-research-authority-registry");

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function sourceRecordHashes(urls, label) {
  return Object.fromEntries([...urls].sort().map((url) => [
    url,
    sha256({ fixture: "expired_non_dispatch_provider_source", label, url }),
  ]));
}

function providerFactRecordBundle(provider, checkedAt, label = "test_only") {
  const retrievedAt = new Date(Date.parse(checkedAt) - 60 * 60 * 1000).toISOString();
  const facts = preventureResearchProviderFactHashes(provider);
  const categories = {
    model: {
      urls: [provider.modelCard.sourceUrl],
      reviewedFactsHash: facts.model,
      reviewedFacts: [
        { id: "context_window", statement: `Test-only reviewed context window: ${provider.modelCard.contextWindowTokens} tokens.` },
        { id: "model_snapshot", statement: `Test-only reviewed model snapshot: ${provider.modelCard.snapshot}.` },
        { id: "output_limit", statement: `Test-only reviewed maximum model output: ${provider.modelCard.maxOutputTokens} tokens.` },
      ],
      anchors: [{ kind: "section", label: "Model page: model snapshot and token-limit fields" }],
    },
    toolPolicy: {
      urls: provider.requestPolicySourceUrls,
      reviewedFactsHash: facts.toolPolicy,
      reviewedFacts: [
        { id: "external_access", statement: `Test-only reviewed external web access: ${provider.externalWebAccess}.` },
        { id: "response_storage", statement: `Test-only reviewed provider response storage: ${provider.responseStorage}.` },
        { id: "tool_policy", statement: `Test-only reviewed hosted tool: ${provider.tool} with required tool choice.` },
      ],
      anchors: [{ kind: "section", label: "Web-search and Responses references: request-policy fields" }],
    },
    pricing: {
      urls: provider.pricingPolicy.sourceUrls,
      reviewedFactsHash: facts.pricing,
      reviewedFacts: [
        { id: "input_rate", statement: `Test-only reviewed input rate: USD ${provider.pricingPolicy.inputUsdPerMillionTokens} per million tokens.` },
        { id: "output_rate", statement: `Test-only reviewed output rate: USD ${provider.pricingPolicy.outputUsdPerMillionTokens} per million tokens.` },
        { id: "web_search_rate", statement: `Test-only reviewed web-search rate: USD ${provider.pricingPolicy.webSearchUsdPerThousandCalls} per thousand calls.` },
      ],
      anchors: [{ kind: "section", label: "Pricing references: model-token and web-search price rows" }],
    },
  };
  const records = [];
  const hashes = { model: {}, toolPolicy: {}, pricing: {} };
  for (const [category, spec] of Object.entries(categories)) {
    for (const [index, url] of [...spec.urls].sort().entries()) {
      const record = createPreventureResearchProviderFactRecord({
        id: `${label}_${category}_${index + 1}`,
        url,
        retrievedAt,
        checkedAt,
        reviewedFactsHash: spec.reviewedFactsHash,
        reviewedFacts: spec.reviewedFacts,
        anchors: spec.anchors,
      });
      records.push(record);
      hashes[category][url] = record.sourceRecordHash;
    }
  }
  return { records, sourceRecordHashes: hashes };
}

// This fixture is deliberately expired, file-local, and transport-free. It
// proves only contract/registry mechanics and must never become a production
// authority, configured candidate, owner approval, or provider dispatch.
function expiredNonDispatchRenewalBundle(overrides = {}) {
  const input = clone(v1Authority);
  delete input.schema;
  delete input.readinessBinding;
  delete input.authorityHash;
  const checkedAt = overrides.checkedAt || "2026-08-03T00:00:00.000Z";
  const provider = {
    ...input.provider,
    modelCard: {
      ...input.provider.modelCard,
      checkedAt,
    },
    pricingPolicy: {
      ...input.provider.pricingPolicy,
      checkedAt,
    },
  };
  provider.pricingPolicyHash = sha256(provider.pricingPolicy);
  Object.assign(input, {
    id: "test_only_expired_preventure_smm_scope_guard_renewal",
    version: "test-only-expired-2026.08.03-v2",
    approvedAt: "2026-08-03T01:00:00.000Z",
    expiresAt: "2026-08-04T01:00:00.000Z",
    supersedesAuthorityHash: v1Authority.authorityHash,
    provider,
    ...overrides,
  });
  delete input.checkedAt;
  const provenance = providerFactRecordBundle(input.provider, checkedAt);
  input.providerReview = createPreventureResearchProviderReviewV2(input.provider, {
    checkedAt,
    sourceRecordHashes: provenance.sourceRecordHashes,
  });
  return {
    authority: createPreventureResearchAuthorityV2(input, readinessSpec),
    providerFactRecords: provenance.records,
  };
}

function expiredNonDispatchRenewalAuthority(overrides = {}) {
  return expiredNonDispatchRenewalBundle(overrides).authority;
}

function renewalRegistryEntry(bundle) {
  return {
    authority: bundle.authority,
    readinessSpec,
    providerFactRecords: bundle.providerFactRecords,
  };
}

function rehash(value) {
  const body = clone(value);
  delete body.authorityHash;
  return { ...body, authorityHash: sha256(body) };
}

function rebuildProviderReview(value, label) {
  const checkedAt = value.provider.modelCard.checkedAt;
  value.providerReview = createPreventureResearchProviderReviewV2(value.provider, {
    checkedAt,
    sourceRecordHashes: {
      model: sourceRecordHashes([value.provider.modelCard.sourceUrl], `${label}_model`),
      toolPolicy: sourceRecordHashes(value.provider.requestPolicySourceUrls, `${label}_tool_policy`),
      pricing: sourceRecordHashes(value.provider.pricingPolicy.sourceUrls, `${label}_pricing`),
    },
  });
  return value;
}

function rehashProviderReview(review) {
  const body = clone(review);
  delete body.reviewHash;
  return { ...body, reviewHash: sha256(body) };
}

function withProviderSourceHash(authority, category, sourceRecordHash) {
  const changed = clone(authority);
  changed.providerReview[category].sourceReferences[0].sourceRecordHash = sourceRecordHash;
  changed.providerReview = rehashProviderReview(changed.providerReview);
  return rehash(changed);
}

function providerFactRecordInput(record) {
  const input = clone(record);
  delete input.schema;
  delete input.contentFactHash;
  delete input.sourceRecordHash;
  return input;
}

test("the default registry resolves only the exact historical v1 hash", () => {
  assert.equal(
    defaultPreventureResearchAuthorityRegistry.schema,
    PREVENTURE_RESEARCH_AUTHORITY_REGISTRY_SCHEMA,
  );
  assert.deepEqual(defaultPreventureResearchAuthorityRegistry.authorityHashes, [v1Authority.authorityHash]);
  const entry = defaultPreventureResearchAuthorityRegistry.resolveAuthorityEntry(
    v1Authority.authorityHash,
    { id: v1Authority.id, version: v1Authority.version },
  );
  assert.deepEqual(entry.authority, v1Authority);
  assert.deepEqual(entry.readinessSpec, readinessSpec);
  assert.equal(Object.isFrozen(entry), true);
  assert.equal(Object.isFrozen(entry.authority.provider.requestPolicy), true);
  assert.equal(
    defaultPreventureResearchAuthorityRegistry.resolveCandidateAuthorityEntry(),
    entry,
  );

  assert.throws(
    () => defaultPreventureResearchAuthorityRegistry.resolveAuthorityEntry(
      "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    ),
    /not present in the immutable registry/i,
  );
  assert.throws(
    () => defaultPreventureResearchAuthorityRegistry.resolveAuthorityEntry(
      v1Authority.authorityHash,
      { version: "invented-v99" },
    ),
    /does not match its registered hash/i,
  );
  assert.throws(
    () => { entry.authority.version = "mutated"; },
    TypeError,
  );
});

test("an explicit expired non-dispatch v2 renewal can coexist with v1 without latest-version fallback", () => {
  const v2 = expiredNonDispatchRenewalBundle();
  const v2Authority = v2.authority;
  const registry = createPreventureResearchAuthorityRegistry([
    { authority: v1Authority, readinessSpec },
    renewalRegistryEntry(v2),
  ], { candidateAuthorityHash: v2Authority.authorityHash });

  assert.equal(
    registry.resolveAuthorityEntry(v1Authority.authorityHash).authority.authorityHash,
    v1Authority.authorityHash,
  );
  assert.equal(
    registry.resolveAuthorityEntry(v2Authority.authorityHash, {
      id: v2Authority.id,
      version: v2Authority.version,
    }).authority.authorityHash,
    v2Authority.authorityHash,
  );
  assert.equal(registry.resolveCandidateAuthorityEntry().authority.authorityHash, v2Authority.authorityHash);

  const noCandidate = createPreventureResearchAuthorityRegistry([
    { authority: v1Authority, readinessSpec },
    renewalRegistryEntry(v2),
  ], { candidateAuthorityHash: null });
  assert.equal(noCandidate.resolveCandidateAuthorityEntry(), null);
});

test("v2 provenance resolves exact concise immutable fact records while v1 remains record-free", () => {
  const v2 = expiredNonDispatchRenewalBundle();
  const registry = createPreventureResearchAuthorityRegistry([
    { authority: v1Authority, readinessSpec },
    renewalRegistryEntry(v2),
  ], { candidateAuthorityHash: v2.authority.authorityHash });
  const entry = registry.resolveAuthorityEntry(v2.authority.authorityHash);
  const expectedHashes = v2.providerFactRecords
    .map((record) => record.sourceRecordHash)
    .sort();

  assert.deepEqual(registry.providerFactRecordHashes, expectedHashes);
  assert.equal(defaultPreventureResearchAuthorityRegistry.providerFactRecordHashes.length, 0);
  assert.equal(entry.providerFactRecords.length, expectedHashes.length);
  for (const record of entry.providerFactRecords) {
    assert.equal(validatePreventureResearchProviderFactRecord(record), record);
    assert.equal(registry.resolveProviderFactRecord(record.sourceRecordHash), record);
    assert.match(record.url, /^https:\/\/developers\.openai\.com\//);
    assert.equal(Object.hasOwn(record, "rawContent"), false);
    assert.equal(Object.isFrozen(record), true);
    assert.equal(Object.isFrozen(record.reviewedFacts), true);
    assert.equal(Object.isFrozen(record.reviewedFacts[0]), true);
    assert.equal(record.reviewedFacts.every((fact) => fact.statement.length <= 280), true);
  }
  assert.throws(
    () => { entry.providerFactRecords[0].reviewedFacts[0].statement = "mutated"; },
    TypeError,
  );
  assert.throws(
    () => registry.resolveProviderFactRecord(sha256({ invented: "not_retained" })),
    /not retained in the immutable registry/i,
  );
  assert.throws(
    () => defaultPreventureResearchAuthorityRegistry.resolveProviderFactRecord("not-a-hash"),
    /exact provider fact source-record hash is required/i,
  );
});

test("v2 registry rejects missing, altered, mismatched, arbitrary, and unreferenced provenance", () => {
  const v2 = expiredNonDispatchRenewalBundle();
  assert.throws(
    () => createPreventureResearchAuthorityRegistry([
      { authority: v1Authority, readinessSpec },
      { authority: v2.authority, readinessSpec },
    ], { candidateAuthorityHash: v2.authority.authorityHash }),
    /fields must be exactly: authority, providerFactRecords, readinessSpec/i,
  );
  assert.throws(
    () => createPreventureResearchAuthorityRegistry([
      { authority: v1Authority, readinessSpec },
      { authority: v2.authority, readinessSpec, providerFactRecords: [] },
    ], { candidateAuthorityHash: v2.authority.authorityHash }),
    /requires retained provider fact records/i,
  );

  const alteredRecords = clone(v2.providerFactRecords);
  alteredRecords[0].reviewedFacts[0].statement = "Altered after review.";
  assert.throws(
    () => createPreventureResearchAuthorityRegistry([
      { authority: v1Authority, readinessSpec },
      { authority: v2.authority, readinessSpec, providerFactRecords: alteredRecords },
    ], { candidateAuthorityHash: v2.authority.authorityHash }),
    /content hash does not match|source-record hash does not match/i,
  );

  const arbitraryHashAuthority = withProviderSourceHash(
    v2.authority,
    "model",
    sha256({ invented: "arbitrary_unretained_source" }),
  );
  assert.equal(validatePreventureResearchAuthority(arbitraryHashAuthority, readinessSpec), arbitraryHashAuthority);
  assert.throws(
    () => createPreventureResearchAuthorityRegistry([
      { authority: v1Authority, readinessSpec },
      {
        authority: arbitraryHashAuthority,
        readinessSpec,
        providerFactRecords: v2.providerFactRecords,
      },
    ], { candidateAuthorityHash: arbitraryHashAuthority.authorityHash }),
    /does not resolve to retained local structured review bytes/i,
  );

  const pricingRecord = v2.providerFactRecords.find((record) => (
    v2.authority.providerReview.pricing.sourceReferences.some((reference) => (
      reference.sourceRecordHash === record.sourceRecordHash
    ))
  ));
  const mismatchedAuthority = withProviderSourceHash(
    v2.authority,
    "model",
    pricingRecord.sourceRecordHash,
  );
  assert.throws(
    () => createPreventureResearchAuthorityRegistry([
      { authority: v1Authority, readinessSpec },
      {
        authority: mismatchedAuthority,
        readinessSpec,
        providerFactRecords: v2.providerFactRecords,
      },
    ], { candidateAuthorityHash: mismatchedAuthority.authorityHash }),
    /does not match its exact URL, check time, and reviewed-facts binding/i,
  );

  const extraRecordInput = providerFactRecordInput(v2.providerFactRecords[0]);
  extraRecordInput.id = "test_only_unreferenced_provider_fact";
  extraRecordInput.reviewedFacts = [{
    id: "unreferenced",
    statement: "Test-only fact record that no authority source reference selects.",
  }];
  const extraRecord = createPreventureResearchProviderFactRecord(extraRecordInput);
  assert.throws(
    () => createPreventureResearchAuthorityRegistry([
      { authority: v1Authority, readinessSpec },
      {
        authority: v2.authority,
        readinessSpec,
        providerFactRecords: [...v2.providerFactRecords, extraRecord],
      },
    ], { candidateAuthorityHash: v2.authority.authorityHash }),
    /all and only the immutable records referenced/i,
  );
});

test("provider fact records reject non-official, non-canonical, or page-sized retained content", () => {
  const v2 = expiredNonDispatchRenewalBundle();
  const baseInput = providerFactRecordInput(v2.providerFactRecords[0]);

  assert.throws(
    () => createPreventureResearchProviderFactRecord({
      ...baseInput,
      url: "https://example.com/invented-provider-doc",
    }),
    /official developers\.openai\.com HTTPS reference/i,
  );
  assert.throws(
    () => createPreventureResearchProviderFactRecord({
      ...baseInput,
      checkedAt: "2026-08-03T00:00:00Z",
    }),
    /canonical ISO-8601 UTC bytes/i,
  );
  assert.throws(
    () => createPreventureResearchProviderFactRecord({
      ...baseInput,
      reviewedFacts: [{ id: "page_copy", statement: "x".repeat(281) }],
    }),
    /concise statements of at most 280 characters/i,
  );
  assert.throws(
    () => createPreventureResearchProviderFactRecord({
      ...baseInput,
      rawContent: "A full copied provider page is not retained here.",
    }),
    /fields must be exactly/i,
  );
});

test("registry construction rejects ambiguity, mutation, and implicit candidates", () => {
  const v2 = expiredNonDispatchRenewalBundle();
  const v2Authority = v2.authority;
  const duplicateIdentity = expiredNonDispatchRenewalBundle({
    approvedAt: "2026-08-03T02:00:00.000Z",
    expiresAt: "2026-08-04T02:00:00.000Z",
  });

  assert.throws(
    () => createPreventureResearchAuthorityRegistry([
      { authority: v1Authority, readinessSpec },
      renewalRegistryEntry(v2),
      renewalRegistryEntry(duplicateIdentity),
    ], { candidateAuthorityHash: v2Authority.authorityHash }),
    /ID and version pairs must be unique/i,
  );
  assert.throws(
    () => createPreventureResearchAuthorityRegistry([
      { authority: v1Authority, readinessSpec: { ...readinessSpec, version: "changed" } },
    ], { candidateAuthorityHash: v1Authority.authorityHash }),
    /not an intact readiness-bound authority/i,
  );
  assert.throws(
    () => createPreventureResearchAuthorityRegistry([
      { authority: v1Authority, readinessSpec },
      renewalRegistryEntry(v2),
    ]),
    /fields must be exactly: candidateAuthorityHash/i,
  );
});

test("expired test-only v2 binds fresh provider facts, immutable sources, exposure, and approval scope", () => {
  const v2Authority = expiredNonDispatchRenewalAuthority();
  const facts = preventureResearchProviderFactHashes(v2Authority.provider);
  assert.equal(v2Authority.schema, PREVENTURE_RESEARCH_AUTHORITY_V2_SCHEMA);
  assert.equal(v2Authority.supersedesAuthorityHash, v1Authority.authorityHash);
  assert.equal(Date.parse(v2Authority.expiresAt) < Date.parse("2026-08-10T00:00:00.000Z"), true);
  assert.deepEqual({
    model: v2Authority.providerReview.model.factsHash,
    toolPolicy: v2Authority.providerReview.toolPolicy.factsHash,
    pricing: v2Authority.providerReview.pricing.factsHash,
  }, facts);
  assert.equal(v2Authority.totalWorstCaseExposureAudCents, 150);
  assert.equal(
    v2Authority.assignments.every((assignment) => (
      assignment.maxCostAudCents === 50
      && assignment.worstCaseExposure.amountAudCents === 50
    )),
    true,
  );
  assert.equal(validatePreventureResearchAuthority(v2Authority, readinessSpec), v2Authority);

  const scope = preventureResearchApprovalScope(v2Authority, "accepted");
  assert.equal(scope.schema, PREVENTURE_RESEARCH_APPROVAL_SCOPE_V2_SCHEMA);
  assert.equal(scope.authority.schema, PREVENTURE_RESEARCH_AUTHORITY_V2_SCHEMA);
  assert.equal(scope.authority.supersedesAuthorityHash, v1Authority.authorityHash);
  assert.equal(scope.provider.providerReviewHash, v2Authority.providerReview.reviewHash);
  assert.equal(scope.provider.modelFactsHash, facts.model);
  assert.equal(scope.provider.toolPolicyFactsHash, facts.toolPolicy);
  assert.equal(scope.provider.pricingFactsHash, facts.pricing);
  assert.equal(scope.totalWorstCaseExposureAudCents, 150);
  assert.equal(scope.externalCommercialSpendCapAudCents, 0);
});

test("v2 rejects provider, tool, pricing, freshness, source, and schema mutation", () => {
  const v2Authority = expiredNonDispatchRenewalAuthority();
  const mutations = [
    (value) => {
      value.provider.modelCard.snapshot = "invented-model-snapshot";
      rebuildProviderReview(value, "changed_model");
    },
    (value) => {
      value.provider.requestPolicy.store = true;
      rebuildProviderReview(value, "changed_tool_policy");
    },
    (value) => {
      value.provider.pricingPolicy.inputUsdPerMillionTokens = 0.5;
      value.provider.pricingPolicyHash = sha256(value.provider.pricingPolicy);
      rebuildProviderReview(value, "changed_pricing");
    },
    (value) => {
      value.providerReview.model.sourceReferences[0].url = "https://example.com/not-official";
      value.providerReview = rehashProviderReview(value.providerReview);
    },
    (value) => { value.schema = "pantheon.preventure-research-authority.v999"; },
  ];
  for (const mutate of mutations) {
    const changed = clone(v2Authority);
    mutate(changed);
    assert.throws(
      () => validatePreventureResearchAuthority(rehash(changed), readinessSpec),
      /provider|pricing|source|schema|review|model|tool/i,
    );
  }

  const stale = clone(v2Authority);
  const checkedAt = "2026-08-01T00:00:00.000Z";
  stale.provider.modelCard.checkedAt = checkedAt;
  stale.provider.pricingPolicy.checkedAt = checkedAt;
  stale.provider.pricingPolicyHash = sha256(stale.provider.pricingPolicy);
  stale.providerReview = createPreventureResearchProviderReviewV2(stale.provider, {
    checkedAt,
    sourceRecordHashes: {
      model: sourceRecordHashes([stale.provider.modelCard.sourceUrl], "stale_model"),
      toolPolicy: sourceRecordHashes(stale.provider.requestPolicySourceUrls, "stale_tool_policy"),
      pricing: sourceRecordHashes(stale.provider.pricingPolicy.sourceUrls, "stale_pricing"),
    },
  });
  assert.throws(
    () => validatePreventureResearchAuthority(rehash(stale), readinessSpec),
    /no more than 24 hours/i,
  );

  const beyondReviewHorizon = clone(v2Authority);
  beyondReviewHorizon.approvedAt = "2026-08-03T23:00:00.000Z";
  beyondReviewHorizon.expiresAt = "2026-08-10T22:00:00.000Z";
  assert.throws(
    () => validatePreventureResearchAuthority(rehash(beyondReviewHorizon), readinessSpec),
    /cannot outlive the seven-day provider-facts review horizon/i,
  );
});

test("registry requires one exact same-opportunity predecessor and an unsuperseded candidate leaf", () => {
  const v2 = expiredNonDispatchRenewalBundle();
  const v2Authority = v2.authority;
  assert.throws(
    () => createPreventureResearchAuthorityRegistry([
      renewalRegistryEntry(v2),
    ], { candidateAuthorityHash: v2Authority.authorityHash }),
    /missing its exact historical predecessor|missing its exact registered predecessor/i,
  );
  assert.throws(
    () => createPreventureResearchAuthorityRegistry([
      { authority: v1Authority, readinessSpec },
      renewalRegistryEntry(v2),
    ], { candidateAuthorityHash: v1Authority.authorityHash }),
    /unsuperseded leaf/i,
  );

  const wrongOpportunity = expiredNonDispatchRenewalBundle({
    id: "test_only_expired_other_opportunity_renewal",
    opportunity: {
      ...clone(v1Authority.opportunity),
      id: "test_only_different_opportunity",
    },
  });
  assert.throws(
    () => createPreventureResearchAuthorityRegistry([
      { authority: v1Authority, readinessSpec },
      renewalRegistryEntry(wrongOpportunity),
    ], { candidateAuthorityHash: wrongOpportunity.authority.authorityHash }),
    /retain the predecessor opportunity identity/i,
  );

  const secondSuccessor = expiredNonDispatchRenewalBundle({
    id: "test_only_expired_second_direct_renewal",
    version: "test-only-expired-2026.08.03-v2b",
  });
  assert.throws(
    () => createPreventureResearchAuthorityRegistry([
      { authority: v1Authority, readinessSpec },
      renewalRegistryEntry(v2),
      renewalRegistryEntry(secondSuccessor),
    ], { candidateAuthorityHash: v2Authority.authorityHash }),
    /multiple registered direct successors/i,
  );

  const olderThanPredecessor = expiredNonDispatchRenewalBundle({
    checkedAt: "2026-08-01T00:00:00.000Z",
    id: "test_only_expired_backdated_renewal",
    approvedAt: "2026-08-01T01:00:00.000Z",
    expiresAt: "2026-08-02T00:00:00.000Z",
  });
  assert.throws(
    () => createPreventureResearchAuthorityRegistry([
      { authority: v1Authority, readinessSpec },
      renewalRegistryEntry(olderThanPredecessor),
    ], { candidateAuthorityHash: olderThanPredecessor.authority.authorityHash }),
    /approved after its exact predecessor/i,
  );
});
