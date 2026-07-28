const crypto = require("node:crypto");
const { COMMERCIAL_CONSTITUTION_VERSION } = require("../../config/commercial-constitution");
const {
  MODEL_PACKET_SCHEMA,
  WORKER_OUTPUT_SCHEMA,
} = require("./agent-model-contracts");
const { SDK_CAPABILITY_SCHEMA } = require("./agent-sdk-capabilities");
const { MODEL_ROUTING_POLICY_VERSION } = require("./model-routing");

const AGENT_HARNESS_SCHEMA = "pantheon.agent-harness.v1";
const AGENT_TRACE_GROUP_SCHEMA = "pantheon.agent-trace-group.v1";
const WORKER_PROMPT_POLICY_VERSION = "2026-07-28.1";
const AGENT_ASSURANCE_POLICY_VERSION = "pantheon-agent-assurance-v3";
const SDK_GUARDRAIL_POLICY_VERSION = "pantheon-sdk-guardrails-v1";

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

function canonicalHash(value) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(canonicalValue(value)))
    .digest("hex");
}

function harnessBody(value = {}) {
  const { harnessHash, ...body } = value && typeof value === "object" ? value : {};
  return body;
}

function buildAgentHarnessDescriptor(worker = {}) {
  const body = canonicalValue({
    schema: AGENT_HARNESS_SCHEMA,
    worker: {
      id: String(worker.id || "").trim(),
      definitionHash: String(worker.definitionHash || "").trim(),
    },
    versions: {
      commercialConstitution: COMMERCIAL_CONSTITUTION_VERSION,
      modelPacket: MODEL_PACKET_SCHEMA,
      workerOutput: WORKER_OUTPUT_SCHEMA,
      sdkCapability: SDK_CAPABILITY_SCHEMA,
      modelRouting: MODEL_ROUTING_POLICY_VERSION,
      promptPolicy: WORKER_PROMPT_POLICY_VERSION,
      assurancePolicy: AGENT_ASSURANCE_POLICY_VERSION,
      guardrailPolicy: SDK_GUARDRAIL_POLICY_VERSION,
    },
  });
  if (!body.worker.id || !body.worker.definitionHash) {
    throw new Error("The agent harness requires an exact worker and worker-definition hash.");
  }
  return { ...body, harnessHash: canonicalHash(body) };
}

function verifyAgentHarnessDescriptor(harness) {
  if (!harness || typeof harness !== "object") {
    return { valid: false, reason: "The approved AI work has no versioned agent harness." };
  }
  if (harness.schema !== AGENT_HARNESS_SCHEMA) {
    return { valid: false, reason: "The approved AI work uses an unsupported agent harness." };
  }
  const body = canonicalValue(harnessBody(harness));
  const currentHash = canonicalHash(body);
  if (!harness.harnessHash || harness.harnessHash !== currentHash) {
    return { valid: false, reason: "The agent harness changed after it was created.", currentHash };
  }
  const expectedVersions = buildAgentHarnessDescriptor({
    id: harness.worker?.id,
    definitionHash: harness.worker?.definitionHash,
  });
  if (canonicalHash(harness.versions) !== canonicalHash(expectedVersions.versions)) {
    return {
      valid: false,
      reason: "The agent rules or evaluation policy changed after approval was requested.",
      currentHash,
      expectedHarnessHash: expectedVersions.harnessHash,
    };
  }
  return { valid: true, currentHash, harness };
}

function firstNonEmpty(...values) {
  for (const value of values) {
    const text = String(value || "").trim();
    if (text) return text;
  }
  return null;
}

function traceScopeForTask(task = {}) {
  const request = task.payload?.liveSpendRequest || {};
  const parameters = request.parameters || {};
  const journey = parameters.pantheonJourney || {};
  const commercial = parameters.pantheonCommercial || {};
  const production = parameters.pantheonProduction || {};
  const investmentCase = parameters.commercialInvestmentCase || {};
  const scopes = [
    ["journey", firstNonEmpty(journey.journeyId, commercial.journeyId, production.journeyId)],
    ["opportunity", firstNonEmpty(commercial.opportunityId, production.opportunityId, investmentCase.opportunityId)],
    ["investment_case", firstNonEmpty(commercial.investmentCaseId, investmentCase.id)],
    ["discovery_round", firstNonEmpty(commercial.roundId, production.roundId)],
    ["work_package", firstNonEmpty(parameters.workPackageId, parameters.workPackage?.id)],
    ["workflow", task.workflow_id],
    ["task", task.id],
  ];
  return scopes.find(([, id]) => id) || ["task", "unknown-task"];
}

function buildAgentTraceGroup(task = {}) {
  const [scopeType, scopeId] = traceScopeForTask(task);
  const body = canonicalValue({
    schema: AGENT_TRACE_GROUP_SCHEMA,
    scopeType,
    scopeId,
    ventureId: firstNonEmpty(task.venture_id),
  });
  const groupHash = canonicalHash(body);
  return {
    ...body,
    groupId: `pantheon_group_${groupHash.slice(0, 40)}`,
    groupHash,
  };
}

function verifyAgentTraceGroup(traceGroup, task = null) {
  if (!traceGroup || typeof traceGroup !== "object") {
    return { valid: false, reason: "The approved AI work has no trace-group identity." };
  }
  if (traceGroup.schema !== AGENT_TRACE_GROUP_SCHEMA) {
    return { valid: false, reason: "The approved AI work uses an unsupported trace-group identity." };
  }
  const body = canonicalValue({
    schema: traceGroup.schema,
    scopeType: traceGroup.scopeType,
    scopeId: traceGroup.scopeId,
    ventureId: traceGroup.ventureId,
  });
  const currentHash = canonicalHash(body);
  if (!traceGroup.groupHash
      || traceGroup.groupHash !== currentHash
      || traceGroup.groupId !== `pantheon_group_${currentHash.slice(0, 40)}`) {
    return { valid: false, reason: "The trace-group identity changed after it was created.", currentHash };
  }
  if (task) {
    const expected = buildAgentTraceGroup(task);
    if (expected.groupHash !== traceGroup.groupHash) {
      return {
        valid: false,
        reason: "The commercial work group changed after approval was requested.",
        currentHash,
        expectedGroupHash: expected.groupHash,
      };
    }
  }
  return { valid: true, currentHash, traceGroup };
}

module.exports = {
  AGENT_ASSURANCE_POLICY_VERSION,
  AGENT_HARNESS_SCHEMA,
  AGENT_TRACE_GROUP_SCHEMA,
  SDK_GUARDRAIL_POLICY_VERSION,
  WORKER_PROMPT_POLICY_VERSION,
  buildAgentHarnessDescriptor,
  buildAgentTraceGroup,
  verifyAgentHarnessDescriptor,
  verifyAgentTraceGroup,
};
