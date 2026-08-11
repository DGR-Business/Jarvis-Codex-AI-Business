"use strict";

const authority = require("../../config/preventure-research-authority-smm-scope-guard-v1");
const readinessSpec = require("../../config/commercial-readiness-social-media-manager-scope-guard-v1");
const {
  createPreventureResearchAuthorityRegistry,
} = require("../../src/runtime/preventure-research-authority-registry");

const HISTORICAL_ACTIVE_V1_TIME = "2026-08-02T03:00:00.000Z";

// Active-v1 tests must opt into this historical registry and a historical
// clock. The production registry and wall clock remain free to fail closed on
// the real, expired v1 authority.
const historicalV1TestRegistry = createPreventureResearchAuthorityRegistry(
  [{ authority, readinessSpec }],
  { candidateAuthorityHash: authority.authorityHash },
);

module.exports = {
  HISTORICAL_ACTIVE_V1_TIME,
  historicalV1TestRegistry,
};
