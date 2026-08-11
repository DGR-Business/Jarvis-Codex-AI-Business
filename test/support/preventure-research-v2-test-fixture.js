"use strict";

const readinessSpec = require("../../config/commercial-readiness-social-media-manager-scope-guard-v1");
const v1Authority = require("../../config/preventure-research-authority-smm-scope-guard-v1");
const {
  createPreventureResearchAuthorityV2,
  createPreventureResearchProviderFactRecord,
  createPreventureResearchProviderReviewV2,
  preventureResearchProviderFactHashes,
} = require("../../src/runtime/preventure-research-contract");
const { sha256 } = require("../../src/runtime/commercial-test-contract");
const {
  createPreventureResearchAuthorityRegistry,
} = require("../../src/runtime/preventure-research-authority-registry");

const EXPIRED_V2_ACTIVE_TEST_TIME = "2026-08-03T02:00:00.000Z";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function retainedProviderFacts(provider, checkedAt) {
  const hashes = preventureResearchProviderFactHashes(provider);
  const groups = [
    {
      id: "model",
      urls: [provider.modelCard.sourceUrl],
      reviewedFactsHash: hashes.model,
      statement: "Model facts match the exact provider configuration used by this expired test-only authority.",
    },
    {
      id: "tool_policy",
      urls: provider.requestPolicySourceUrls,
      reviewedFactsHash: hashes.toolPolicy,
      statement: "Tool-policy facts match the exact web-search constraints used by this expired test-only authority.",
    },
    {
      id: "pricing",
      urls: provider.pricingPolicy.sourceUrls,
      reviewedFactsHash: hashes.pricing,
      statement: "Pricing facts match the exact conservative cost policy used by this expired test-only authority.",
    },
  ];
  const records = [];
  const sourceRecordHashes = {};
  for (const group of groups) {
    sourceRecordHashes[group.id] = {};
    for (const [index, url] of [...group.urls].sort().entries()) {
      const record = createPreventureResearchProviderFactRecord({
        id: `expired_v2_${group.id}_${index + 1}`,
        url,
        retrievedAt: checkedAt,
        checkedAt,
        reviewedFactsHash: group.reviewedFactsHash,
        reviewedFacts: [{ id: `${group.id}_binding`, statement: group.statement }],
        anchors: [{ kind: "section", label: "Test-only retained structured provider fact" }],
      });
      records.push(record);
      sourceRecordHashes[group.id][url] = record.sourceRecordHash;
    }
  }
  return { records, sourceRecordHashes };
}

// Deliberately expired, test-only, and never imported by production config.
// It proves versioned approval mechanics without creating current authority.
function createExpiredNonDispatchV2Authority() {
  const input = clone(v1Authority);
  delete input.schema;
  delete input.readinessBinding;
  delete input.authorityHash;
  const checkedAt = "2026-08-03T00:00:00.000Z";
  const provider = {
    ...input.provider,
    modelCard: { ...input.provider.modelCard, checkedAt },
    pricingPolicy: { ...input.provider.pricingPolicy, checkedAt },
  };
  provider.pricingPolicyHash = sha256(provider.pricingPolicy);
  Object.assign(input, {
    id: "test_only_expired_preventure_smm_scope_guard_renewal",
    version: "test-only-expired-2026.08.03-v2",
    approvedAt: "2026-08-03T01:00:00.000Z",
    expiresAt: "2026-08-04T01:00:00.000Z",
    supersedesAuthorityHash: v1Authority.authorityHash,
    provider,
  });
  delete input.checkedAt;
  const retainedFacts = retainedProviderFacts(input.provider, checkedAt);
  input.providerReview = createPreventureResearchProviderReviewV2(input.provider, {
    checkedAt,
    sourceRecordHashes: {
      model: retainedFacts.sourceRecordHashes.model,
      toolPolicy: retainedFacts.sourceRecordHashes.tool_policy,
      pricing: retainedFacts.sourceRecordHashes.pricing,
    },
  });
  return {
    authority: createPreventureResearchAuthorityV2(input, readinessSpec),
    providerFactRecords: retainedFacts.records,
  };
}

const expiredV2 = createExpiredNonDispatchV2Authority();
const expiredNonDispatchV2Authority = expiredV2.authority;
const expiredNonDispatchV2ProviderFactRecords = expiredV2.providerFactRecords;
const expiredNonDispatchV2Registry = createPreventureResearchAuthorityRegistry([
  { authority: v1Authority, readinessSpec },
  {
    authority: expiredNonDispatchV2Authority,
    readinessSpec,
    providerFactRecords: expiredNonDispatchV2ProviderFactRecords,
  },
], { candidateAuthorityHash: expiredNonDispatchV2Authority.authorityHash });

module.exports = {
  EXPIRED_V2_ACTIVE_TEST_TIME,
  expiredNonDispatchV2Authority,
  expiredNonDispatchV2ProviderFactRecords,
  expiredNonDispatchV2Registry,
  readinessSpec,
};
