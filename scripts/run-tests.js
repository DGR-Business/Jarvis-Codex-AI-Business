const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-test-runtime-"));
const env = {
  ...process.env,
  JARVIS_ARTIFACT_ROOT: path.join(root, "artifacts"),
  JARVIS_APPROVAL_PACK_DIR: path.join(root, "approval-packs"),
  JARVIS_DB_PATH: path.join(root, "runtime.sqlite"),
  JARVIS_PRIVACY_HASH_KEY: "test-only-privacy-hash-key-32-bytes",
};

try {
  const result = spawnSync(
    process.execPath,
    ["--test", "--test-isolation=none", "test/*.test.js"],
    { cwd: path.resolve(__dirname, ".."), env, stdio: "inherit" },
  );
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
