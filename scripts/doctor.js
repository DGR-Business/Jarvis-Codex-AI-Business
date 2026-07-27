const fs = require("node:fs");
const path = require("node:path");
const net = require("node:net");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");
const { DatabaseSync } = require("node:sqlite");
const CONFIG = require("../src/config");
const {
  preferredEnvironment,
  readEncryptedHeader,
  requiredPassphrase,
  verifyBackup,
} = require("../src/runtime/backup");
const {
  IMAGE_GENERATION_PRICING,
  MODEL_PRICING_USD_PER_MILLION,
  TOOL_PRICING_USD_PER_THOUSAND_CALLS,
} = require("../src/runtime/model-pricing");

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

function checkPricingFreshness(options = {}) {
  const nowValue = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
  const maxAgeDays = Number(options.maxAgeDays || 30);
  const entries = [
    ...Object.entries(MODEL_PRICING_USD_PER_MILLION).map(([name, pricing]) => ({ name: `model:${name}`, ...pricing })),
    ...Object.entries(TOOL_PRICING_USD_PER_THOUSAND_CALLS).map(([name, pricing]) => ({ name: `tool:${name}`, ...pricing })),
    { name: `image:${IMAGE_GENERATION_PRICING.model}`, ...IMAGE_GENERATION_PRICING },
  ];
  const invalid = entries.filter((entry) => Number.isNaN(new Date(entry.checkedAt).getTime()));
  if (invalid.length) {
    return result("Pricing data", "fail", `Pantheon has ${invalid.length} pricing record(s) without a valid review date.`);
  }
  const stale = entries.filter((entry) => (
    (nowValue.getTime() - new Date(entry.checkedAt).getTime()) / 86400000 > maxAgeDays
  ));
  if (stale.length) {
    return result(
      "Pricing data",
      "warn",
      `${stale.length} model or tool price record(s) are older than ${maxAgeDays} days; refresh them before approving paid work.`,
      { stale: stale.map((entry) => ({ name: entry.name, checkedAt: entry.checkedAt, source: entry.source })) },
    );
  }
  return result("Pricing data", "pass", `${entries.length} model and tool price records were reviewed within ${maxAgeDays} days.`);
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
  const configuredPython = preferredEnvironment("PYTHON");
  if (configuredPython) candidates.push({ command: configuredPython, prefix: [] });
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
      [
        ...candidate.prefix,
        "-c",
        [
          "import openpyxl,PIL,reportlab,sys",
          "print(sys.version_info[0])",
          "print(reportlab.Version)",
          "print(openpyxl.__version__)",
          "print(PIL.__version__)",
        ].join(";"),
      ],
      { encoding: "utf8", windowsHide: true },
    );
    if (probe.status === 0) {
      const lines = String(probe.stdout || "").trim().split(/\r?\n/);
      return result(
        "PDF renderer",
        "pass",
        `Python ${lines[0] || "3"}, ReportLab ${lines[1] || "available"}, `
          + `openpyxl ${lines[2] || "available"}, and Pillow ${lines[3] || "available"} are available.`,
      );
    }
  }
  return result(
    "PDF renderer",
    "fail",
    "No usable Python 3 runtime with Pantheon's pinned ReportLab, openpyxl, and Pillow dependencies was found. "
      + "Install requirements-runtime.txt and set PANTHEON_PYTHON "
      + "(or the legacy JARVIS_PYTHON alias) to the approved runtime.",
  );
}

function checkWritableDirectory(name, directory) {
  const target = path.resolve(directory);
  const probe = path.join(target, `.pantheon-doctor-${process.pid}-${crypto.randomBytes(4).toString("hex")}`);
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

function checkRuntimeDatabase(options = {}) {
  const dbPath = path.resolve(options.dbPath || CONFIG.dbPath);
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

function checkBackupConfiguration(options = {}) {
  const destination = path.resolve(options.destinationRoot || CONFIG.backupDestination);
  try {
    requiredPassphrase(options.passphrase);
  } catch {
    return result(
      "Backup encryption",
      "fail",
      "The Pantheon backup passphrase is not available to this process or is too short. "
        + "No credential value was displayed.",
      { path: destination, preferredVariable: "PANTHEON_BACKUP_PASSPHRASE", compatibilityAlias: "JARVIS_BACKUP_PASSPHRASE" },
    );
  }
  return result(
    "Backup encryption",
    "pass",
    "The Pantheon backup passphrase is present and passed a length check. No credential value was displayed.",
    { path: destination, preferredVariable: "PANTHEON_BACKUP_PASSPHRASE", compatibilityAlias: "JARVIS_BACKUP_PASSPHRASE" },
  );
}

function backupAgeHours(createdAt, now = new Date()) {
  return (now.getTime() - new Date(createdAt).getTime()) / 3600000;
}

async function checkRecoverySet(options = {}) {
  const destinationRoot = path.resolve(options.destinationRoot || CONFIG.backupDestination);
  const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
  const configuredMaxAge = Number(
    options.maxAgeHours
      ?? preferredEnvironment("BACKUP_MAX_AGE_HOURS")
      ?? 36,
  );
  const maxAgeHours = Number.isFinite(configuredMaxAge) && configuredMaxAge > 0
    ? configuredMaxAge
    : 36;
  if (!fs.existsSync(destinationRoot)) {
    return result(
      "Recovery set",
      "warn",
      "No Pantheon recovery set exists yet. Create and verify one before relying on this installation.",
      { path: destinationRoot, maxAgeHours },
    );
  }

  const candidates = fs.readdirSync(destinationRoot)
    .filter((name) => name.endsWith(".jbackup"))
    .map((name) => path.join(destinationRoot, name));
  const sets = [];
  const unreadable = [];
  for (const candidate of candidates) {
    try {
      const { header } = readEncryptedHeader(candidate);
      if (header.kind === "set") {
        sets.push({ filePath: candidate, header, createdAt: new Date(header.createdAt) });
      }
    } catch (error) {
      unreadable.push({ filePath: candidate, error: error.message });
    }
  }
  if (!sets.length) {
    return result(
      "Recovery set",
      unreadable.length ? "fail" : "warn",
      unreadable.length
        ? "Backup files exist, but no readable Pantheon recovery set could be identified."
        : "No coherent Pantheon recovery set exists yet; legacy component backups are not a complete recovery proof.",
      { path: destinationRoot, unreadableCount: unreadable.length, maxAgeHours },
    );
  }

  sets.sort((left, right) => right.createdAt - left.createdAt);
  let verified = null;
  const invalidSets = [...unreadable];
  for (const candidate of sets) {
    try {
      const proof = await verifyBackup(candidate.filePath, { passphrase: options.passphrase });
      verified = { ...candidate, proof };
      break;
    } catch (error) {
      invalidSets.push({ filePath: candidate.filePath, error: error.message });
    }
  }
  if (!verified) {
    return result(
      "Recovery set",
      "fail",
      "Pantheon found recovery-set files, but none passed decryption, manifest, inventory, and database verification.",
      { path: destinationRoot, invalidCount: invalidSets.length, maxAgeHours },
    );
  }

  const ageHours = backupAgeHours(verified.header.createdAt, now);
  const futureDated = ageHours < -0.25;
  const stale = ageHours > maxAgeHours;
  const newerInvalid = invalidSets.some((item) => {
    try {
      return new Date(readEncryptedHeader(item.filePath).header.createdAt) > verified.createdAt;
    } catch {
      return fs.statSync(item.filePath).mtime > verified.createdAt;
    }
  });
  const details = {
    path: verified.filePath,
    setId: verified.proof.recoverySet.setId,
    createdAt: verified.header.createdAt,
    ageHours: Number(ageHours.toFixed(2)),
    maxAgeHours,
    fileCount: verified.proof.recoverySet.fileCount,
    components: Object.fromEntries(
      Object.entries(verified.proof.recoverySet.components).map(([name, component]) => [
        name,
        {
          present: component.present,
          fileCount: component.fileCount,
          bytes: component.bytes,
        },
      ]),
    ),
    sqlite: verified.proof.recoverySet.sqlite,
    invalidCount: invalidSets.length,
  };
  if (futureDated) {
    return result("Recovery set", "warn", "The newest valid recovery set is dated in the future; check the system clock.", details);
  }
  if (newerInvalid) {
    return result("Recovery set", "warn", "A valid recovery set exists, but a newer backup file failed verification.", details);
  }
  if (stale) {
    return result(
      "Recovery set",
      "warn",
      `The newest valid recovery set is older than the ${maxAgeHours}-hour readiness target.`,
      details,
    );
  }
  return result(
    "Recovery set",
    "pass",
    "A recent encrypted Pantheon recovery set passed manifest, file-inventory, and SQLite verification.",
    details,
  );
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
        resolve(result("Dashboard port", "warn", `Port ${port} is already in use; this is normal when Pantheon is running.`));
      } else {
        resolve(result("Dashboard port", "fail", `Port ${port} could not be checked: ${error.message}`));
      }
    });
    server.listen({ host: "127.0.0.1", port: Number(port), exclusive: true }, () => {
      server.close(() => resolve(result("Dashboard port", "pass", `Port ${port} is available on loopback.`)));
    });
  });
}

function assessOperationsReady(results) {
  const byName = new Map(results.map((item) => [item.name, item]));
  const requiredPasses = [
    "Node.js",
    "Dependency lock",
    "Node SQLite",
    "Archive tool",
    "PDF renderer",
    "Data directory",
    "Artifact directory",
    "Backup destination",
    "Runtime database",
    "Backup encryption",
    "Recovery set",
  ];
  const blockers = [];
  for (const name of requiredPasses) {
    const item = byName.get(name);
    if (!item || item.status !== "pass") {
      blockers.push(item?.message || `${name} was not checked.`);
    }
  }
  for (const item of results.filter((entry) => entry.status === "fail")) {
    if (!blockers.includes(item.message)) blockers.push(item.message);
  }
  return { operationsReady: blockers.length === 0, readinessBlockers: blockers };
}

async function runDoctor(options = {}) {
  const destinationRoot = options.destinationRoot || CONFIG.backupDestination;
  const results = [
    checkNodeVersion(),
    checkLockfile(),
    checkNodeSqlite(),
    checkPricingFreshness({ now: options.now, maxAgeDays: options.pricingMaxAgeDays }),
    checkTar(),
    checkRenderer(),
    checkWritableDirectory("Data directory", options.dataDir || CONFIG.dataDir),
    checkWritableDirectory("Artifact directory", options.artifactRoot || CONFIG.artifactRoot),
    checkWritableDirectory("Backup destination", destinationRoot),
    checkRuntimeDatabase({ dbPath: options.dbPath }),
    checkBackupConfiguration({ destinationRoot, passphrase: options.passphrase }),
    await checkRecoverySet({
      destinationRoot,
      passphrase: options.passphrase,
      maxAgeHours: options.maxAgeHours,
      now: options.now,
    }),
    await checkPort(options.port || CONFIG.port),
  ];
  const readiness = assessOperationsReady(results);
  return {
    ok: results.every((item) => item.status !== "fail"),
    ...readiness,
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
    ? `Pantheon doctor passed${report.warningCount ? ` with ${report.warningCount} warning(s)` : ""}.`
    : `Pantheon doctor found ${report.failureCount} blocking problem(s).`);
  console.log(report.operationsReady
    ? "Pantheon is operations-ready, including a recent validated recovery set."
    : `Pantheon is not yet operations-ready (${report.readinessBlockers.length} readiness blocker(s)).`);
}

async function main() {
  const report = await runDoctor();
  if (process.argv.includes("--json")) console.log(JSON.stringify(report, null, 2));
  else printHuman(report);
  if (!report.ok || (process.argv.includes("--operations-ready") && !report.operationsReady)) {
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`Pantheon doctor failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  assessOperationsReady,
  checkBackupConfiguration,
  checkLockfile,
  checkNodeSqlite,
  checkNodeVersion,
  checkPort,
  checkPricingFreshness,
  checkRenderer,
  checkRecoverySet,
  checkRuntimeDatabase,
  checkTar,
  checkWritableDirectory,
  runDoctor,
};
