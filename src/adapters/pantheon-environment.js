// Pantheon names are authoritative. JARVIS_* entries are read-only
// compatibility aliases for installations that predate the product rename.
const ENVIRONMENT_ALIASES = Object.freeze({
  agentRuntimeProvider: Object.freeze({
    preferred: "PANTHEON_AGENT_RUNTIME_PROVIDER",
    legacy: "JARVIS_AGENT_RUNTIME_PROVIDER",
  }),
  apiCreditAudPerUsd: Object.freeze({
    preferred: "PANTHEON_API_CREDIT_AUD_PER_USD",
    legacy: "JARVIS_API_CREDIT_AUD_PER_USD",
  }),
  disableAgentsSdk: Object.freeze({
    preferred: "PANTHEON_DISABLE_OPENAI_AGENTS_SDK",
    legacy: "JARVIS_DISABLE_OPENAI_AGENTS_SDK",
  }),
  disableLiveAiWorkerAdapter: Object.freeze({
    preferred: "PANTHEON_DISABLE_LIVE_AI_WORKER_ADAPTER",
    legacy: "JARVIS_DISABLE_LIVE_AI_WORKER_ADAPTER",
  }),
  disableLiveResearchAdapter: Object.freeze({
    preferred: "PANTHEON_DISABLE_LIVE_RESEARCH_ADAPTER",
    legacy: "JARVIS_DISABLE_LIVE_RESEARCH_ADAPTER",
  }),
  enableImageGeneration: Object.freeze({
    preferred: "PANTHEON_ENABLE_IMAGE_GENERATION",
    legacy: "JARVIS_ENABLE_IMAGE_GENERATION",
  }),
  enableLiveModels: Object.freeze({
    preferred: "PANTHEON_ENABLE_LIVE_MODELS",
    legacy: "JARVIS_ENABLE_LIVE_MODELS",
  }),
  enableLiveResearch: Object.freeze({
    preferred: "PANTHEON_ENABLE_LIVE_RESEARCH",
    legacy: "JARVIS_ENABLE_LIVE_RESEARCH",
  }),
  liveModel: Object.freeze({
    preferred: "PANTHEON_LIVE_MODEL",
    legacy: "JARVIS_LIVE_MODEL",
  }),
  liveResearchModel: Object.freeze({
    preferred: "PANTHEON_LIVE_RESEARCH_MODEL",
    legacy: "JARVIS_LIVE_RESEARCH_MODEL",
  }),
  taskClaimLeaseMs: Object.freeze({
    preferred: "PANTHEON_TASK_CLAIM_LEASE_MS",
    legacy: "JARVIS_TASK_CLAIM_LEASE_MS",
  }),
});

function aliasFor(key) {
  const alias = ENVIRONMENT_ALIASES[key];
  if (!alias) throw new Error(`Unknown Pantheon environment setting: ${key}.`);
  return alias;
}

function environmentResolution(key) {
  const alias = aliasFor(key);
  const preferred = process.env[alias.preferred];
  if (preferred !== undefined && preferred !== "") {
    // Older runtime modules may still inspect the former name directly. Keep
    // that compatibility view aligned without ever letting it override Pantheon.
    process.env[alias.legacy] = preferred;
    return { ...alias, value: preferred, source: "preferred" };
  }
  const legacy = process.env[alias.legacy];
  if (legacy !== undefined && legacy !== "") {
    return { ...alias, value: legacy, source: "legacy_compatibility" };
  }
  return { ...alias, value: undefined, source: "unset" };
}

function environmentValue(key, fallback = undefined) {
  return environmentResolution(key).value ?? fallback;
}

function environmentEnabled(key) {
  return environmentValue(key) === "1";
}

function environmentDisabled(key) {
  return environmentValue(key) === "1";
}

function preferredEnvironmentName(key) {
  return aliasFor(key).preferred;
}

function configuredEnvironmentName(key) {
  const resolved = environmentResolution(key);
  return resolved.source === "legacy_compatibility" ? resolved.legacy : resolved.preferred;
}

module.exports = {
  ENVIRONMENT_ALIASES,
  configuredEnvironmentName,
  environmentDisabled,
  environmentEnabled,
  environmentResolution,
  environmentValue,
  preferredEnvironmentName,
};
