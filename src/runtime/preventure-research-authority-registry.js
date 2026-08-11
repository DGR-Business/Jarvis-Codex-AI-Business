"use strict";

const v1Authority = require("../../config/preventure-research-authority-smm-scope-guard-v1");
const v1ReadinessSpec = require("../../config/commercial-readiness-social-media-manager-scope-guard-v1");
const {
  PREVENTURE_RESEARCH_AUTHORITY_V2_SCHEMA,
  validatePreventureResearchAuthority,
  validatePreventureResearchProviderFactRecord,
} = require("./preventure-research-contract");

const PREVENTURE_RESEARCH_AUTHORITY_REGISTRY_SCHEMA =
  "pantheon.preventure-research-authority-registry.v2";
const HASH_PATTERN = /^sha256:[a-f0-9]{64}$/;

class PreventureResearchAuthorityRegistryError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "PreventureResearchAuthorityRegistryError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new PreventureResearchAuthorityRegistryError(code, message);
}

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(value, expected, label) {
  if (!isPlainObject(value)) {
    fail("preventure_research_authority_registry_invalid", `${label} must be one object.`);
  }
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) {
    fail(
      "preventure_research_authority_registry_invalid",
      `${label} fields must be exactly: ${wanted.join(", ")}.`,
    );
  }
}

function cloneAndFreeze(value, label = "Registry value") {
  if (value === null || ["string", "number", "boolean"].includes(typeof value)) {
    if (typeof value === "number" && !Number.isFinite(value)) {
      fail("preventure_research_authority_registry_invalid", `${label} contains a non-finite number.`);
    }
    return value;
  }
  if (Array.isArray(value)) {
    return Object.freeze(value.map((item, index) => cloneAndFreeze(item, `${label} ${index + 1}`)));
  }
  if (!isPlainObject(value)) {
    fail("preventure_research_authority_registry_invalid", `${label} contains unsupported content.`);
  }
  const clone = {};
  for (const key of Object.keys(value).sort()) {
    if (value[key] === undefined) {
      fail("preventure_research_authority_registry_invalid", `${label} contains an undefined field.`);
    }
    clone[key] = cloneAndFreeze(value[key], `${label}.${key}`);
  }
  return Object.freeze(clone);
}

function compareCanonicalText(left, right) {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function normalizeProviderFactRecords(authority, records, entryIndex) {
  if (!Array.isArray(records) || records.length < 1) {
    fail(
      "preventure_research_provider_fact_records_missing",
      `Authority registry entry ${entryIndex + 1} requires retained provider fact records.`,
    );
  }
  const recordsByHash = Object.create(null);
  const recordIds = new Set();
  for (const [recordIndex, input] of records.entries()) {
    try {
      validatePreventureResearchProviderFactRecord(input);
    } catch (error) {
      fail(
        "preventure_research_provider_fact_record_invalid",
        `Authority registry entry ${entryIndex + 1} provider fact record ${recordIndex + 1} is invalid: ${error.message}`,
      );
    }
    const record = cloneAndFreeze(
      input,
      `Authority registry entry ${entryIndex + 1} provider fact record ${recordIndex + 1}`,
    );
    try {
      validatePreventureResearchProviderFactRecord(record);
    } catch (error) {
      fail(
        "preventure_research_provider_fact_record_invalid",
        `Authority registry entry ${entryIndex + 1} provider fact record ${recordIndex + 1} changed during retention: ${error.message}`,
      );
    }
    if (recordsByHash[record.sourceRecordHash] || recordIds.has(record.id)) {
      fail(
        "preventure_research_provider_fact_record_ambiguous",
        "Provider fact record hashes and IDs must be unique within one authority entry.",
      );
    }
    recordsByHash[record.sourceRecordHash] = record;
    recordIds.add(record.id);
  }

  const sourceReferences = [
    ...authority.providerReview.model.sourceReferences,
    ...authority.providerReview.toolPolicy.sourceReferences,
    ...authority.providerReview.pricing.sourceReferences,
  ];
  const referencedHashes = new Set();
  for (const reference of sourceReferences) {
    const record = recordsByHash[reference.sourceRecordHash];
    if (!record) {
      fail(
        "preventure_research_provider_fact_record_missing",
        "A provider review source hash does not resolve to retained local structured review bytes.",
      );
    }
    if (
      record.url !== reference.url
      || record.checkedAt !== reference.checkedAt
      || record.reviewedFactsHash !== reference.reviewedFactsHash
    ) {
      fail(
        "preventure_research_provider_fact_record_mismatch",
        "A retained provider fact record does not match its exact URL, check time, and reviewed-facts binding.",
      );
    }
    referencedHashes.add(reference.sourceRecordHash);
  }
  if (referencedHashes.size !== Object.keys(recordsByHash).length) {
    fail(
      "preventure_research_provider_fact_record_unreferenced",
      "Provider fact records must be all and only the immutable records referenced by this authority.",
    );
  }
  return Object.freeze(
    Object.values(recordsByHash).sort((left, right) => (
      compareCanonicalText(left.sourceRecordHash, right.sourceRecordHash)
    )),
  );
}

function normalizeEntry(input, index) {
  const isV2 = input?.authority?.schema === PREVENTURE_RESEARCH_AUTHORITY_V2_SCHEMA;
  exactKeys(
    input,
    isV2 ? ["authority", "readinessSpec", "providerFactRecords"] : ["authority", "readinessSpec"],
    `Authority registry entry ${index + 1}`,
  );
  try {
    validatePreventureResearchAuthority(input.authority, input.readinessSpec);
  } catch (error) {
    fail(
      "preventure_research_authority_registry_invalid",
      `Authority registry entry ${index + 1} is not an intact readiness-bound authority: ${error.message}`,
    );
  }
  const authority = cloneAndFreeze(input.authority, `Authority registry entry ${index + 1} authority`);
  const readinessSpec = cloneAndFreeze(
    input.readinessSpec,
    `Authority registry entry ${index + 1} readiness`,
  );
  try {
    validatePreventureResearchAuthority(authority, readinessSpec);
  } catch (error) {
    fail(
      "preventure_research_authority_registry_invalid",
      `Authority registry entry ${index + 1} changed during canonical retention: ${error.message}`,
    );
  }
  if (!isV2) return Object.freeze({ authority, readinessSpec });
  const providerFactRecords = normalizeProviderFactRecords(
    authority,
    input.providerFactRecords,
    index,
  );
  return Object.freeze({ authority, readinessSpec, providerFactRecords });
}

function assertNoSupersessionCycle(entriesByHash, entry) {
  const visited = new Set();
  let current = entry;
  while (current.authority.supersedesAuthorityHash) {
    const predecessorHash = current.authority.supersedesAuthorityHash;
    if (visited.has(predecessorHash) || predecessorHash === entry.authority.authorityHash) {
      fail(
        "preventure_research_authority_registry_invalid",
        "Pre-venture authority supersession cannot contain a cycle.",
      );
    }
    visited.add(predecessorHash);
    current = entriesByHash[predecessorHash];
    if (!current) {
      fail(
        "preventure_research_authority_registry_invalid",
        "A registered pre-venture authority is missing its exact historical predecessor.",
      );
    }
  }
}

function assertRenewalLineage(entriesByHash, entry) {
  const predecessorHash = entry.authority.supersedesAuthorityHash;
  if (!predecessorHash) return;
  const predecessor = entriesByHash[predecessorHash];
  if (!predecessor) {
    fail(
      "preventure_research_authority_registry_invalid",
      "A renewable pre-venture authority is missing its exact registered predecessor.",
    );
  }
  if (predecessor.authority.opportunity?.id !== entry.authority.opportunity?.id) {
    fail(
      "preventure_research_authority_registry_invalid",
      "A renewable pre-venture authority must retain the predecessor opportunity identity.",
    );
  }
  if (Date.parse(entry.authority.approvedAt) <= Date.parse(predecessor.authority.approvedAt)) {
    fail(
      "preventure_research_authority_registry_invalid",
      "A renewable pre-venture authority must be approved after its exact predecessor.",
    );
  }
}

function createPreventureResearchAuthorityRegistry(entries, options = {}) {
  exactKeys(options, ["candidateAuthorityHash"], "Authority registry options");
  if (!Array.isArray(entries) || entries.length < 1) {
    fail(
      "preventure_research_authority_registry_invalid",
      "The authority registry must retain at least one exact approved authority.",
    );
  }

  const entriesByHash = Object.create(null);
  const identityKeys = new Set();
  const supersededHashes = new Set();
  for (const [index, input] of entries.entries()) {
    const entry = normalizeEntry(input, index);
    const { authority } = entry;
    if (!HASH_PATTERN.test(String(authority.authorityHash || ""))) {
      fail("preventure_research_authority_registry_invalid", "A registered authority hash is invalid.");
    }
    if (entriesByHash[authority.authorityHash]) {
      fail("preventure_research_authority_registry_invalid", "Authority registry hashes must be unique.");
    }
    const identityKey = `${authority.id}\u0000${authority.version}`;
    if (identityKeys.has(identityKey)) {
      fail(
        "preventure_research_authority_registry_invalid",
        "Authority registry ID and version pairs must be unique.",
      );
    }
    if (authority.supersedesAuthorityHash) {
      if (supersededHashes.has(authority.supersedesAuthorityHash)) {
        fail(
          "preventure_research_authority_registry_invalid",
          "One historical authority cannot have multiple registered direct successors.",
        );
      }
      supersededHashes.add(authority.supersedesAuthorityHash);
    }
    identityKeys.add(identityKey);
    entriesByHash[authority.authorityHash] = entry;
  }

  for (const entry of Object.values(entriesByHash)) {
    assertNoSupersessionCycle(entriesByHash, entry);
    assertRenewalLineage(entriesByHash, entry);
  }

  const providerFactRecordsByHash = Object.create(null);
  for (const entry of Object.values(entriesByHash)) {
    for (const record of entry.providerFactRecords || []) {
      const existing = providerFactRecordsByHash[record.sourceRecordHash];
      if (existing && JSON.stringify(existing) !== JSON.stringify(record)) {
        fail(
          "preventure_research_provider_fact_record_conflict",
          "One provider fact record hash is bound to different retained review bytes.",
        );
      }
      providerFactRecordsByHash[record.sourceRecordHash] = record;
    }
  }

  const candidateAuthorityHash = options.candidateAuthorityHash;
  if (
    candidateAuthorityHash !== null
    && (
      !HASH_PATTERN.test(String(candidateAuthorityHash || ""))
      || !entriesByHash[candidateAuthorityHash]
    )
  ) {
    fail(
      "preventure_research_authority_registry_invalid",
      "The configured candidate must be one exact registered authority hash or null.",
    );
  }
  if (candidateAuthorityHash && supersededHashes.has(candidateAuthorityHash)) {
    fail(
      "preventure_research_authority_registry_invalid",
      "The configured candidate must be an unsuperseded leaf authority.",
    );
  }

  Object.freeze(entriesByHash);
  Object.freeze(providerFactRecordsByHash);
  const authorityHashes = Object.freeze(Object.keys(entriesByHash).sort());
  const providerFactRecordHashes = Object.freeze(
    Object.keys(providerFactRecordsByHash).sort(),
  );

  function resolveAuthorityEntry(authorityHash, expected = {}) {
    exactKeys(expected, ["id", "version"].filter((key) => Object.hasOwn(expected, key)), "Authority identity");
    if (!HASH_PATTERN.test(String(authorityHash || ""))) {
      fail("preventure_research_authority_unknown", "An exact registered authority hash is required.");
    }
    const entry = entriesByHash[authorityHash];
    if (!entry) {
      fail(
        "preventure_research_authority_unknown",
        "The pre-venture authority hash is not present in the immutable registry.",
      );
    }
    if (
      (Object.hasOwn(expected, "id") && expected.id !== entry.authority.id)
      || (Object.hasOwn(expected, "version") && expected.version !== entry.authority.version)
    ) {
      fail(
        "preventure_research_authority_identity_mismatch",
        "The stored authority ID or version does not match its registered hash.",
      );
    }
    return entry;
  }

  function resolveCandidateAuthorityEntry() {
    if (candidateAuthorityHash === null) return null;
    return resolveAuthorityEntry(candidateAuthorityHash);
  }

  function resolveProviderFactRecord(sourceRecordHash) {
    if (!HASH_PATTERN.test(String(sourceRecordHash || ""))) {
      fail(
        "preventure_research_provider_fact_record_unknown",
        "An exact provider fact source-record hash is required.",
      );
    }
    const record = providerFactRecordsByHash[sourceRecordHash];
    if (!record) {
      fail(
        "preventure_research_provider_fact_record_unknown",
        "The provider fact source-record hash is not retained in the immutable registry.",
      );
    }
    return record;
  }

  return Object.freeze({
    schema: PREVENTURE_RESEARCH_AUTHORITY_REGISTRY_SCHEMA,
    authorityHashes,
    providerFactRecordHashes,
    candidateAuthorityHash,
    resolveAuthorityEntry,
    resolveCandidateAuthorityEntry,
    resolveProviderFactRecord,
  });
}

const defaultPreventureResearchAuthorityRegistry = createPreventureResearchAuthorityRegistry(
  [{ authority: v1Authority, readinessSpec: v1ReadinessSpec }],
  { candidateAuthorityHash: v1Authority.authorityHash },
);

function resolveAuthorityEntry(authorityHash, expected) {
  return defaultPreventureResearchAuthorityRegistry.resolveAuthorityEntry(authorityHash, expected);
}

function resolveCandidateAuthorityEntry() {
  return defaultPreventureResearchAuthorityRegistry.resolveCandidateAuthorityEntry();
}

function resolveProviderFactRecord(sourceRecordHash) {
  return defaultPreventureResearchAuthorityRegistry.resolveProviderFactRecord(sourceRecordHash);
}

module.exports = {
  PREVENTURE_RESEARCH_AUTHORITY_REGISTRY_SCHEMA,
  PreventureResearchAuthorityRegistryError,
  createPreventureResearchAuthorityRegistry,
  defaultPreventureResearchAuthorityRegistry,
  resolveAuthorityEntry,
  resolveCandidateAuthorityEntry,
  resolveProviderFactRecord,
};
