const path = require("node:path");

const ROOT_DIR = path.resolve(__dirname, "..");
const ENV_SUFFIXES = [
  "DATA_DIR",
  "DB_PATH",
  "ARTIFACT_ROOT",
  "BACKUP_DESTINATION",
  "BACKUP_PASSPHRASE",
  "PRIVACY_HASH_KEY",
  "CURRENCY",
  "AUTONOMY_STAGE",
  "MONTHLY_BUDGET_AUD",
  "LIVE_RESEARCH_BUDGET_AUD",
  "LIVE_RESEARCH_PROVIDER",
  "LIVE_RESEARCH_MODEL",
  "LIVE_RESEARCH_MAX_INPUT_TOKENS",
  "LIVE_RESEARCH_MAX_OUTPUT_TOKENS",
  "LIVE_MODEL_BUDGET_AUD",
  "LIVE_MODEL_PROVIDER",
  "LIVE_MODEL",
  "LUNA_MODEL",
  "TERRA_MODEL",
  "SOL_MODEL",
  "SYSTEM_PROOF_MODE",
  "LIVE_MODEL_TOOL_MAX_INPUT_TOKENS",
  "LIVE_MODEL_MAX_OUTPUT_TOKENS",
  "TARGET_APPROVAL_RATE",
  "APPROVAL_PROMOTION_MINIMUM",
  "OPERATOR_EMAIL",
  "PUBLIC_BASE_URL",
  "APPROVAL_TOKEN_TTL_HOURS",
  "SCHEDULER_ENABLED",
  "SCHEDULER_POLL_SECONDS",
  "SCHEDULER_MAX_JOBS_PER_TICK",
  "LIVE_MODE",
  "ENABLE_LIVE_MODELS",
  "ENABLE_LIVE_RESEARCH",
  "ENABLE_IMAGE_GENERATION",
  "AGENT_RUNTIME_PROVIDER",
  "API_CREDIT_AUD_PER_USD",
  "DISABLE_OPENAI_AGENTS_SDK",
  "DISABLE_LIVE_AI_WORKER_ADAPTER",
  "DISABLE_LIVE_RESEARCH_ADAPTER",
  "APPROVAL_PACK_DIR",
  "PYTHON",
  "TASK_CLAIM_LEASE_MS",
  "OPERATOR_BOOTSTRAP",
  "CONTROL_TOKEN",
  "RUNTIME_INSTANCE_ID",
];

for (const suffix of ENV_SUFFIXES) {
  const preferred = `PANTHEON_${suffix}`;
  const legacy = `JARVIS_${suffix}`;
  if (process.env[preferred] === undefined && process.env[legacy] !== undefined) {
    process.env[preferred] = process.env[legacy];
  }
  if (process.env[legacy] === undefined && process.env[preferred] !== undefined) {
    process.env[legacy] = process.env[preferred];
  }
}

function envValue(name, fallback = undefined) {
  const preferred = process.env[name];
  if (preferred !== undefined && preferred !== "") return preferred;
  const legacyName = name.startsWith("PANTHEON_")
    ? name.replace(/^PANTHEON_/, "JARVIS_")
    : "";
  const legacy = legacyName ? process.env[legacyName] : undefined;
  return legacy !== undefined && legacy !== "" ? legacy : fallback;
}

const DATA_DIR = envValue("PANTHEON_DATA_DIR", path.join(ROOT_DIR, "data"));
const DB_PATH = envValue("PANTHEON_DB_PATH", path.join(DATA_DIR, "runtime.sqlite"));
const ARTIFACT_ROOT = envValue("PANTHEON_ARTIFACT_ROOT", path.join(DATA_DIR, "artifacts"));
const BACKUP_DESTINATION = envValue(
  "PANTHEON_BACKUP_DESTINATION",
  path.join(process.env.OneDrive || path.join(process.env.USERPROFILE || ROOT_DIR, "OneDrive"), "Pantheon-Backups"),
);

function numberFromEnv(name, fallback) {
  const raw = envValue(name);
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

const PORT = numberFromEnv("PORT", 5051);

const CONFIG = {
  rootDir: ROOT_DIR,
  dataDir: DATA_DIR,
  dbPath: DB_PATH,
  artifactRoot: ARTIFACT_ROOT,
  backupDestination: BACKUP_DESTINATION,
  port: PORT,
  currency: envValue("PANTHEON_CURRENCY", "AUD"),
  autonomyStage: numberFromEnv("PANTHEON_AUTONOMY_STAGE", 1),
  monthlyBudgetCents: Math.round(numberFromEnv("PANTHEON_MONTHLY_BUDGET_AUD", 100) * 100),
  liveResearchDefaultBudgetCents: Math.round(numberFromEnv("PANTHEON_LIVE_RESEARCH_BUDGET_AUD", 2) * 100),
  liveResearchProvider: envValue("PANTHEON_LIVE_RESEARCH_PROVIDER", "openai-web-search"),
  liveResearchModel: envValue("PANTHEON_LIVE_RESEARCH_MODEL", "gpt-5.5"),
  openaiResponsesUrl: process.env.OPENAI_RESPONSES_URL || "https://api.openai.com/v1/responses",
  liveResearchMaxInputTokens: Math.max(8000, numberFromEnv("PANTHEON_LIVE_RESEARCH_MAX_INPUT_TOKENS", 32000)),
  liveResearchMaxOutputTokens: Math.max(800, numberFromEnv("PANTHEON_LIVE_RESEARCH_MAX_OUTPUT_TOKENS", 2400)),
  liveModelDefaultBudgetCents: Math.round(numberFromEnv("PANTHEON_LIVE_MODEL_BUDGET_AUD", 1) * 100),
  liveModelProvider: envValue("PANTHEON_LIVE_MODEL_PROVIDER", "openai-agents-sdk"),
  liveModel: envValue("PANTHEON_LIVE_MODEL", "gpt-5.6-terra"),
  lunaModel: envValue("PANTHEON_LUNA_MODEL", "gpt-5.6-luna"),
  terraModel: envValue("PANTHEON_TERRA_MODEL", envValue("PANTHEON_LIVE_MODEL", "gpt-5.6-terra")),
  solModel: envValue("PANTHEON_SOL_MODEL", "gpt-5.6-sol"),
  systemProofMode: envValue("PANTHEON_SYSTEM_PROOF_MODE") === "1",
  liveModelToolMaxInputTokens: Math.max(8000, numberFromEnv("PANTHEON_LIVE_MODEL_TOOL_MAX_INPUT_TOKENS", 32000)),
  liveModelMaxOutputTokens: Math.max(400, numberFromEnv("PANTHEON_LIVE_MODEL_MAX_OUTPUT_TOKENS", 1200)),
  targetFirstPassApprovalRate: numberFromEnv("PANTHEON_TARGET_APPROVAL_RATE", 0.9),
  approvalPromotionMinimum: numberFromEnv("PANTHEON_APPROVAL_PROMOTION_MINIMUM", 20),
  operatorEmail: envValue("PANTHEON_OPERATOR_EMAIL", process.env.OPERATOR_EMAIL || ""),
  publicBaseUrl: envValue("PANTHEON_PUBLIC_BASE_URL", `http://127.0.0.1:${PORT}`),
  approvalTokenTtlHours: numberFromEnv("PANTHEON_APPROVAL_TOKEN_TTL_HOURS", 72),
  schedulerEnabled: envValue("PANTHEON_SCHEDULER_ENABLED", "1") !== "0",
  schedulerPollMs: Math.max(10, numberFromEnv("PANTHEON_SCHEDULER_POLL_SECONDS", 60)) * 1000,
  schedulerMaxJobsPerTick: Math.max(1, Math.min(numberFromEnv("PANTHEON_SCHEDULER_MAX_JOBS_PER_TICK", 2), 10)),
  dryRun: envValue("PANTHEON_LIVE_MODE", "0") !== "1",
};

CONFIG.envValue = envValue;

module.exports = CONFIG;
