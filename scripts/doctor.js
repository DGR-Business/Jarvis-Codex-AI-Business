const fs = require("node:fs");
const path = require("node:path");
const net = require("node:net");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");
const { DatabaseSync } = require("node:sqlite");
const CONFIG = require("../src/config");

const root = path.resolve(__dirname, "..");

function result(name, status, message, details = undefined) {
  return { name, status, message, ...(details === undefined ? {} : { details }) };
}

function checkNodeVersion() {
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  const required = String(packageJson.engines?.node || "");
  const minimumMajor = Number(required.match(/>=\s*(\d+)/)?.[1] || 0);
  const maximumMajor = Number(required.match(/<\s*(\d+)/)?.[1] || 0);
  const currentMajor = Number(process.versions.node.split(".")[0]);
  if (!minimumMajor || currentMajor < minimumMajor || (maximumMajor && currentMajor >= maximumMajor)) {
    return result("Node.js", "fail", `Node ${process.versions.node} does not satisfy ${required || "the declared engine range"}.`);
  }
  return result("Node.js", "pass", `Node ${process.versions.node} satisfies ${required}.`);
}

function checkLockfile() {
  const packagePath = path.join(root, "package.json");
  const lockPath = path.join(root, "package-lock.json");
  if (!fs.existsSync(lockPath)) return result("Dependency lock", "fail", "package-lock.json is missing.");
  try {
    const packageJson = JSON.parse(fs.readFileSync(packagePath, "utf8"));
    const lock = JSON.parse(fs.readFileSync(lockPath, "utf8"));
    const lockedRoot = lock.packages?.[""] || {};
    const declared = packageJson.dependencies || {};
    const locked = lockedRoot.dependencies || {};
    if (packageJson.name !== lock.name || packageJson.version !== lock.version || JSON.stringify(declared) !== JSON.stringify(locked)) {
      return result("Dependency lock", "fail", "package.json and package-lock.json root metadata do not match.");
    }
    const missing = Object.keys(declared).filter((name) => !fs.existsSync(path.join(root, "node_modules", ...name.split("/"), "package.json")));
    if (missing.length) return result("Dependency lock", "fail", `Installed dependencies are incomplete (${missing.length} missing).`);
    return result("Dependency lock", "pass", `${Object.keys(declared).length} declared dependencies match the lockfile and are installed.`);
  } catch (error) {
    return result("Dependency lock", "fail", `Dependency metadata could not be validated: ${error.message}`);
  }
}

function checkNodeSqlite() {
  let db;
  try {
    db = new DatabaseSync(":memory:");
    db.exec("CREATE TABLE doctor_check (value TEXT NOT NULL); INSERT INTO doctor_check VALUES ('ok');");
    const value = db.prepare("SELECT value FROM doctor_check").get().value;
    if (value !== "ok") throw new Error("unexpected query result");
    return result("Node SQLite", "pass", "node:sqlite created and queried an in-memory database.");
  } catch (error) {
    return result("Node SQLite", "fail", `node:sqlite is unavailable: ${error.message}`);
  } finally {
    if (db) db.close();
  }
}

function checkTar() {
  const command = process.platform === "win32" ? "tar.exe" : "tar";
  const probe = spawnSync(command, ["--version"], { encoding: "utf8", windowsHide: true });
  if (probe.status !== 0) return result("Archive tool", "fail", "The tar archive command is unavailable.");
  const firstLine = String(probe.stdout || probe.stderr || "tar available").split(/\r?\n/)[0].trim();
  return result("Archive tool", "pass", firstLine);
}

function pythonCandidates() {
  const candidates = [];
  if (process.env.JARVIS_PYTHON) candidates.push({ command: process.env.JARVIS_PYTHON, prefix: [] });
  const dependencyRoot = path.resolve(path.dirname(process.execPath), "..", "..");
  candidates.push({ command: path.join(dependencyRoot, "python", "python.exe"), prefix: [] });
  for (const home of [process.env.USERPROFILE, process.env.HOME].filter(Boolean)) {
    candidates.push({
      command: path.join(home, ".cache", "codex-runtimes", "codex-primary-runtime", "dependencies", "python", "python.exe"),
      prefix: [],
    });
  }
  if (process.platform === "win32") candidates.push({ command: "py", prefix: ["-3"] }, { command: "python", prefix: [] });
  else candidates.push({ command: "python3", prefix: [] }, { command: "python", prefix: [] });
  return candidates.filter((candidate, index, items) => items.findIndex((item) => item.command === candidate.command) === index);
}

function checkRenderer() {
  const renderer = path.join(root, "scripts", "render-approval-pack.py");
  if (!fs.existsSync(renderer)) return result("PDF renderer", "fail", "The approval-pack renderer script is missing.");
  for (const candidate of pythonCandidates()) {
    if (path.isAbsolute(candidate.command) && !fs.existsSync(candidate.command)) continue;
    const probe = spawnSync(
      candidate.command,
      [...candidate.prefix, "-c", "import reportlab,sys; print(sys.version_info[0]); print(reportlab.Version)"],
      { encoding: "utf8", windowsHide: true },
    );
    if (probe.status === 0) {
      const lines = String(probe.stdout || "").trim().split(/\r?\n/);
      return result("PDF renderer", "pass", `Python ${lines[0] || "3"} and ReportLab ${lines[1] || "available"} are available.`);
    }
  }
  return result("PDF renderer", "fail", "No usable Python 3 runtime with ReportLab was found. Set JARVIS_PYTHON to the approved runtime.");
}

function checkWritableDirectory(name, directory) {
  const target = path.resolve(directory);
  const probe = path.join(target, `.jarvis-doctor-${process.pid}-${crypto.randomBytes(4).toString("hex")}`);
  try {
    fs.mkdirSync(target, { recursive: true });
    fs.writeFileSync(probe, "ok", { flag: "wx" });
    fs.rmSync(probe, { force: true });
    return result(name, "pass", `${name} is writable.`, { path: target });
  } catch (error) {
    fs.rmSync(probe, { force: true });
    return result(name, "fail", `${name} is not writable: ${error.message}`, { path: target });
  }
}

function checkRuntimeDatabase() {
  const dbPath = path.resolve(CONFIG.dbPath);
  if (!fs.existsSync(dbPath)) return result("Runtime database", "warn", "No runtime database exists yet; first startup must create it.", { path: dbPath });
  let db;
  try {
    db = new DatabaseSync(dbPath, { readOnly: true });
    const quick = db.prepare("PRAGMA quick_check").all();
    const foreignKeys = db.prepare("PRAGMA foreign_key_check").all();
    const quickOk = quick.length === 1 && Object.values(quick[0])[0] === "ok";
    if (!quickOk || foreignKeys.length) throw new Error(`quick_check=${quickOk ? "ok" : "failed"}, foreign_key_violations=${foreignKeys.length}`);
    return result("Runtime database", "pass", "SQLite quick_check passed with no foreign-key violations.", { path: dbPath });
  } catch (error) {
    return result("Runtime database", "fail", `Runtime database validation failed: ${error.message}`, { path: dbPath });
  } finally {
    if (db) db.close();
  }
}

function checkBackupConfiguration() {
  const destination = path.resolve(CONFIG.backupDestination);
  if (!process.env.JARVIS_BACKUP_PASSPHRASE || process.env.JARVIS_BACKUP_PASSPHRASE.length < 16) {
    return result("Backup encryption", "fail", "The backup passphrase is not available to this process or is too short. No credential value was displayed.", { path: destination });
  }
  return result("Backup encryption", "pass", "The backup passphrase is present and passed a length check. No credential value was displayed.", { path: destination });
}

function checkPort(port = CONFIG.port) {
  return new Promise((resolve) => {
    if (!Number.isInteger(Number(port)) || Number(port) < 1 || Number(port) > 65535) {
      resolve(result("Dashboard port", "fail", `Port ${port} is outside the valid range.`));
      return;
    }
    const server = net.createServer();
    server.unref();
    server.once("error", (error) => {
      if (error.code === "EADDRINUSE") {
        resolve(result("Dashboard port", "warn", `Port ${port} is already in use; this is normal when Jarvis is running.`));
      } else {
        resolve(result("Dashboard port", "fail", `Port ${port} could not be checked: ${error.message}`));
      }
    });
    server.listen({ host: "127.0.0.1", port: Number(port), exclusive: true }, () => {
      server.close(() => resolve(result("Dashboard port", "pass", `Port ${port} is available on loopback.`)));
    });
  });
}

async function runDoctor() {
  const results = [
    checkNodeVersion(),
    checkLockfile(),
    checkNodeSqlite(),
    checkTar(),
    checkRenderer(),
    checkWritableDirectory("Data directory", CONFIG.dataDir),
    checkWritableDirectory("Artifact directory", CONFIG.artifactRoot),
    checkWritableDirectory("Backup destination", CONFIG.backupDestination),
    checkRuntimeDatabase(),
    checkBackupConfiguration(),
    await checkPort(),
  ];
  return {
    ok: results.every((item) => item.status !== "fail"),
    warningCount: results.filter((item) => item.status === "warn").length,
    failureCount: results.filter((item) => item.status === "fail").length,
    results,
  };
}

function printHuman(report) {
  for (const item of report.results) {
    const marker = item.status === "pass" ? "PASS" : item.status === "warn" ? "WARN" : "FAIL";
    console.log(`[${marker}] ${item.name}: ${item.message}`);
  }
  console.log(report.ok
    ? `Jarvis doctor passed${report.warningCount ? ` with ${report.warningCount} warning(s)` : ""}.`
    : `Jarvis doctor found ${report.failureCount} blocking problem(s).`);
}

async function main() {
  const report = await runDoctor();
  if (process.argv.includes("--json")) console.log(JSON.stringify(report, null, 2));
  else printHuman(report);
  if (!report.ok) process.exitCode = 1;
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`Jarvis doctor failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  checkBackupConfiguration,
  checkLockfile,
  checkNodeSqlite,
  checkNodeVersion,
  checkPort,
  checkRenderer,
  checkRuntimeDatabase,
  checkTar,
  checkWritableDirectory,
  runDoctor,
};
