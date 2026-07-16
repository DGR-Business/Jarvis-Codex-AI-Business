const path = require("node:path");

const ROOT_DIR = path.resolve(__dirname, "..");
const DATA_DIR = process.env.JARVIS_DATA_DIR || path.join(ROOT_DIR, "data");
const DB_PATH = process.env.JARVIS_DB_PATH || path.join(DATA_DIR, "runtime.sqlite");
const ARTIFACT_ROOT = process.env.JARVIS_ARTIFACT_ROOT || path.join(DATA_DIR, "artifacts");
const BACKUP_DESTINATION = process.env.JARVIS_BACKUP_DESTINATION
  || path.join(process.env.OneDrive || path.join(process.env.USERPROFILE || ROOT_DIR, "OneDrive"), "Jarvis-Codex-Backups");

function numberFromEnv(name, fallback) {
  const raw = process.env[name];
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
  currency: process.env.JARVIS_CURRENCY || "AUD",
  autonomyStage: numberFromEnv("JARVIS_AUTONOMY_STAGE", 1),
  monthlyBudgetCents: Math.round(numberFromEnv("JARVIS_MONTHLY_BUDGET_AUD", 100) * 100),
  liveResearchDefaultBudgetCents: Math.round(numberFromEnv("JARVIS_LIVE_RESEARCH_BUDGET_AUD", 2) * 100),
  liveResearchProvider: process.env.JARVIS_LIVE_RESEARCH_PROVIDER || "openai-web-search",
  liveResearchModel: process.env.JARVIS_LIVE_RESEARCH_MODEL || "gpt-5.5",
  openaiResponsesUrl: process.env.OPENAI_RESPONSES_URL || "https://api.openai.com/v1/responses",
  liveResearchMaxOutputTokens: Math.max(800, numberFromEnv("JARVIS_LIVE_RESEARCH_MAX_OUTPUT_TOKENS", 2400)),
  liveModelDefaultBudgetCents: Math.round(numberFromEnv("JARVIS_LIVE_MODEL_BUDGET_AUD", 1) * 100),
  liveModelProvider: process.env.JARVIS_LIVE_MODEL_PROVIDER || "openai-agents-sdk",
  liveModel: process.env.JARVIS_LIVE_MODEL || "gpt-5.5",
  liveModelMaxOutputTokens: Math.max(400, numberFromEnv("JARVIS_LIVE_MODEL_MAX_OUTPUT_TOKENS", 1200)),
  targetFirstPassApprovalRate: numberFromEnv("JARVIS_TARGET_APPROVAL_RATE", 0.9),
  approvalPromotionMinimum: numberFromEnv("JARVIS_APPROVAL_PROMOTION_MINIMUM", 20),
  operatorEmail: process.env.JARVIS_OPERATOR_EMAIL || process.env.OPERATOR_EMAIL || "",
  publicBaseUrl: process.env.JARVIS_PUBLIC_BASE_URL || `http://127.0.0.1:${PORT}`,
  approvalTokenTtlHours: numberFromEnv("JARVIS_APPROVAL_TOKEN_TTL_HOURS", 72),
  schedulerEnabled: process.env.JARVIS_SCHEDULER_ENABLED !== "0",
  schedulerPollMs: Math.max(10, numberFromEnv("JARVIS_SCHEDULER_POLL_SECONDS", 60)) * 1000,
  schedulerMaxJobsPerTick: Math.max(1, Math.min(numberFromEnv("JARVIS_SCHEDULER_MAX_JOBS_PER_TICK", 2), 10)),
  dryRun: process.env.JARVIS_LIVE_MODE !== "1",
};

module.exports = CONFIG;
