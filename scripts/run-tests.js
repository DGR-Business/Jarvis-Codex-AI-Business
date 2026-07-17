const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const workspaceRoot = path.resolve(__dirname, "..");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-test-runtime-"));
const isolatedTempRoot = path.join(root, "os-temp");
const pdfTempRoot = path.join(workspaceRoot, "tmp", "pdfs");
const pdfSnapshot = path.join(root, "pre-test-pdfs");
fs.mkdirSync(isolatedTempRoot, { recursive: true });

function isInside(parent, candidate) {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function snapshotPdfTemp() {
  if (fs.existsSync(pdfTempRoot)) fs.cpSync(pdfTempRoot, pdfSnapshot, { recursive: true });
}

function restorePdfTemp() {
  const expectedParent = path.join(workspaceRoot, "tmp");
  if (!isInside(expectedParent, pdfTempRoot)) throw new Error("Refusing to clean an unexpected PDF temp path.");
  fs.rmSync(pdfTempRoot, { recursive: true, force: true });
  if (fs.existsSync(pdfSnapshot)) fs.cpSync(pdfSnapshot, pdfTempRoot, { recursive: true });
}

function requestedTestFiles(args) {
  if (!args.length) return ["test/*.test.js"];
  return args.map((value) => {
    const normalized = value.replace(/\\/g, "/");
    if (!/^test\/[a-zA-Z0-9._-]+\.test\.js$/.test(normalized)) {
      throw new Error(`Unsupported test path: ${value}`);
    }
    return normalized;
  });
}

const blockedEnvironment = new Set([
  "OPENAI_API_KEY",
  "JARVIS_ENABLE_LIVE_MODELS",
  "JARVIS_ENABLE_LIVE_RESEARCH",
  "JARVIS_LIVE_MODE",
  "JARVIS_BACKUP_PASSPHRASE",
]);
const inheritedEnvironment = Object.fromEntries(
  Object.entries(process.env).filter(([name]) => !blockedEnvironment.has(name)),
);

const env = {
  ...inheritedEnvironment,
  TEMP: isolatedTempRoot,
  TMP: isolatedTempRoot,
  TMPDIR: isolatedTempRoot,
  JARVIS_ARTIFACT_ROOT: path.join(root, "artifacts"),
  JARVIS_APPROVAL_PACK_DIR: path.join(root, "approval-packs"),
  JARVIS_BACKUP_DESTINATION: path.join(root, "backups"),
  JARVIS_DATA_DIR: path.join(root, "data"),
  JARVIS_DB_PATH: path.join(root, "data", "runtime.sqlite"),
  JARVIS_PRIVACY_HASH_KEY: "test-only-privacy-hash-key-32-bytes",
  JARVIS_ENABLE_LIVE_MODELS: "0",
  JARVIS_ENABLE_LIVE_RESEARCH: "0",
  JARVIS_LIVE_MODE: "0",
};

try {
  snapshotPdfTemp();
  const result = spawnSync(
    process.execPath,
    ["--test", "--test-isolation=none", ...requestedTestFiles(process.argv.slice(2))],
    { cwd: workspaceRoot, env, stdio: "inherit" },
  );
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} finally {
  restorePdfTemp();
  fs.rmSync(root, { recursive: true, force: true });
}
