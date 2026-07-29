"use strict";

const crypto = require("node:crypto");

const VENTURE_KIT_DEFINITION_SCHEMA = "pantheon.venture-kit-definition.v1";

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (isObject(value)) {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, canonical(value[key])]),
    );
  }
  return value ?? null;
}

function parseJson(value, fallback) {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value !== "string") return value;
  const parsed = JSON.parse(value);
  return parsed;
}

function cleanId(value, label) {
  const result = String(value || "").trim();
  if (!/^[a-z0-9][a-z0-9._:-]{0,127}$/i.test(result)) {
    throw new Error(`${label} must be a stable identifier.`);
  }
  return result;
}

function cleanText(value, label) {
  const result = String(value || "").replace(/\s+/g, " ").trim();
  if (!result) throw new Error(`${label} is required.`);
  return result;
}

function normalizeVentureKitDefinition(input) {
  if (!isObject(input)) throw new Error("Venture Kit definition must be an object.");
  const version = Number(input.version);
  if (!Number.isSafeInteger(version) || version < 1) {
    throw new Error("Venture Kit version must be a positive whole number.");
  }
  const businessModels = parseJson(
    input.businessModels ?? input.business_models,
    [],
  );
  const capabilityRequirements = parseJson(
    input.capabilityRequirements ?? input.capability_requirements,
    [],
  );
  if (!Array.isArray(businessModels) || !Array.isArray(capabilityRequirements)) {
    throw new Error("Venture Kit list fields must be arrays.");
  }
  return canonical({
    schema: VENTURE_KIT_DEFINITION_SCHEMA,
    id: cleanId(input.id, "Venture Kit id"),
    version,
    name: cleanText(input.name, "Venture Kit name"),
    businessModels,
    eligibilityRules: parseJson(
      input.eligibilityRules ?? input.eligibility_rules,
      {},
    ),
    evidenceRequirements: parseJson(
      input.evidenceRequirements ?? input.evidence_requirements,
      {},
    ),
    capabilityRequirements,
    channelPolicy: parseJson(
      input.channelPolicy ?? input.channel_policy,
      {},
    ),
    acceptanceCriteria: parseJson(
      input.acceptanceCriteria ?? input.acceptance_criteria,
      {},
    ),
    metadata: parseJson(input.metadata, {}),
  });
}

function ventureKitContentHash(input) {
  const definition = normalizeVentureKitDefinition(input);
  return `sha256:${crypto.createHash("sha256")
    .update(JSON.stringify(definition), "utf8")
    .digest("hex")}`;
}

module.exports = {
  VENTURE_KIT_DEFINITION_SCHEMA,
  normalizeVentureKitDefinition,
  ventureKitContentHash,
};
