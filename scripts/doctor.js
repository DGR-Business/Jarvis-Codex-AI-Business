const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const net = require("node:net");
const crypto = require("node:crypto");
const { spawn, spawnSync } = require("node:child_process");
const { DatabaseSync } = require("node:sqlite");
const CONFIG = require("../src/config");
const { verifyDatabase } = require("../src/db");
const { factoryReadiness } = require("../src/runtime/digital-product-file-factory");
const {
  preferredEnvironment,
  readEncryptedHeader,
  requiredPassphrase,
  restoreBackup,
  sha256File,
  validateRecoverySourceBundle,
} = require("../src/runtime/backup");
const {
  IMAGE_GENERATION_PRICING,
  MODEL_PRICING_USD_PER_MILLION,
  TOOL_PRICING_USD_PER_THOUSAND_CALLS,
} = require("../src/runtime/model-pricing");

const root = path.resolve(__dirname, "..");
const RESTORED_BOOT_OS_ENVIRONMENT_ALLOWLIST = new Set([
  "COMSPEC",
  "LANG",
  "LC_ALL",
  "NUMBER_OF_PROCESSORS",
  "OS",
  "PATH",
  "PATHEXT",
  "PROCESSOR_ARCHITECTURE",
  "SYSTEMDRIVE",
  "SYSTEMROOT",
  "TEMP",
  "TMP",
  "TMPDIR",
  "TZ",
  "WINDIR",
]);

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

function checkLockfile(options = {}) {
  const rootDir = path.resolve(options.rootDir || root);
  const packagePath = path.join(rootDir, "package.json");
  const lockPath = path.join(rootDir, "package-lock.json");
  if (!fs.existsSync(lockPath)) return result("Dependency lock", "fail", "package-lock.json is missing.");
  try {
    const packageJson = JSON.parse(fs.readFileSync(packagePath, "utf8"));
    const lock = JSON.parse(fs.readFileSync(lockPath, "utf8"));
    const lockedRoot = lock.packages?.[""] || {};
    const declaredGroups = {
      dependencies: packageJson.dependencies || {},
      devDependencies: packageJson.devDependencies || {},
    };
    const lockedGroups = {
      dependencies: lockedRoot.dependencies || {},
      devDependencies: lockedRoot.devDependencies || {},
    };
    const sameEntries = (left, right) => {
      const leftEntries = Object.entries(left).sort(([a], [b]) => a.localeCompare(b));
      const rightEntries = Object.entries(right).sort(([a], [b]) => a.localeCompare(b));
      return JSON.stringify(leftEntries) === JSON.stringify(rightEntries);
    };
    if (
      packageJson.name !== lock.name
      || packageJson.version !== lock.version
      || !sameEntries(declaredGroups.dependencies, lockedGroups.dependencies)
      || !sameEntries(declaredGroups.devDependencies, lockedGroups.devDependencies)
    ) {
      return result("Dependency lock", "fail", "package.json and package-lock.json root metadata do not match.");
    }
    const declared = { ...declaredGroups.dependencies, ...declaredGroups.devDependencies };
    const missing = [];
    const mismatched = [];
    const versions = {};
    for (const name of Object.keys(declared)) {
      const installedPath = path.join(rootDir, "node_modules", ...name.split("/"), "package.json");
      const lockedPackage = lock.packages?.[`node_modules/${name}`];
      if (!fs.existsSync(installedPath) || !lockedPackage?.version) {
        missing.push(name);
        continue;
      }
      const installed = JSON.parse(fs.readFileSync(installedPath, "utf8"));
      versions[name] = {
        installed: String(installed.version || ""),
        locked: String(lockedPackage.version),
      };
      if (versions[name].installed !== versions[name].locked) mismatched.push(name);
    }
    if (missing.length) return result("Dependency lock", "fail", `Installed dependencies are incomplete (${missing.length} missing).`);
    if (mismatched.length) {
      return result(
        "Dependency lock",
        "fail",
        `Installed dependency versions do not match the lockfile (${mismatched.length} mismatch(es)).`,
        { mismatched, versions },
      );
    }
    return result(
      "Dependency lock",
      "pass",
      `${Object.keys(declared).length} declared dependencies match the lockfile and exact installed versions.`,
      { versions },
    );
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
  const probe = spawnSync(command, ["--version"], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 10_000,
  });
  if (probe.status !== 0) return result("Archive tool", "fail", "The tar archive command is unavailable.");
  const firstLine = String(probe.stdout || probe.stderr || "tar available").split(/\r?\n/)[0].trim();
  return result("Archive tool", "pass", firstLine);
}

function parsePinnedRuntimeRequirements(requirementsPath) {
  const pins = {};
  for (const rawLine of fs.readFileSync(requirementsPath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^([A-Za-z0-9_.-]+)==([^\s]+)$/);
    if (!match) throw new Error(`Runtime requirement is not exactly pinned: ${line}`);
    pins[match[1]] = match[2];
  }
  return pins;
}

function checkRenderer(options = {}) {
  const rootDir = path.resolve(options.rootDir || root);
  const requirementsPath = path.resolve(
    options.requirementsPath || path.join(rootDir, "requirements-runtime.txt"),
  );
  const scripts = [
    path.join(rootDir, "scripts", "render-approval-pack.py"),
    path.join(rootDir, "scripts", "render-digital-product-kit.py"),
    path.join(rootDir, "scripts", "compose-storefront-cover.py"),
  ];
  const missingScripts = scripts.filter((scriptPath) => !fs.existsSync(scriptPath));
  if (missingScripts.length) {
    return result(
      "PDF renderer",
      "fail",
      `Pantheon's product renderer is incomplete (${missingScripts.length} script(s) missing).`,
      { missingScripts },
    );
  }
  if (!fs.existsSync(requirementsPath)) {
    return result("PDF renderer", "fail", "requirements-runtime.txt is missing.");
  }

  const readiness = factoryReadiness({ refresh: true });
  if (!readiness.ready) {
    return result(
      "PDF renderer",
      "fail",
      `Pantheon's exact production Python is not renderer-ready: ${readiness.reason}`,
      { python: readiness.python, renderer: readiness.renderer },
    );
  }

  try {
    const pins = parsePinnedRuntimeRequirements(requirementsPath);
    const requiredPackages = ["openpyxl", "Pillow", "pypdfium2", "reportlab"];
    const missingPins = requiredPackages.filter((name) => !pins[name]);
    if (missingPins.length) {
      return result(
        "PDF renderer",
        "fail",
        `Pantheon's renderer requirements are missing ${missingPins.length} exact pin(s).`,
        { missingPins },
      );
    }
    const pythonProbe = [
      "import importlib.metadata,json,sys",
      "from pathlib import Path",
      "scripts=sys.argv[1:]",
      "[compile(Path(item).read_text(encoding='utf-8'),item,'exec') for item in scripts]",
      `names=${JSON.stringify(requiredPackages)}`,
      "print(json.dumps({'python':sys.version.split()[0],'packages':{name:importlib.metadata.version(name) for name in names}}))",
    ].join(";");
    const probe = spawnSync(
      readiness.python,
      ["-c", pythonProbe, ...scripts],
      {
        cwd: rootDir,
        encoding: "utf8",
        windowsHide: true,
        timeout: 20_000,
        maxBuffer: 1024 * 1024,
      },
    );
    if (probe.error?.code === "ETIMEDOUT") {
      return result("PDF renderer", "fail", "Pantheon's exact renderer check exceeded its 20-second deadline.");
    }
    if (probe.error || probe.status !== 0) {
      return result(
        "PDF renderer",
        "fail",
        `Pantheon's exact renderer check failed: ${String(probe.error?.message || probe.stderr || probe.stdout || "unknown error").trim()}`,
        { python: readiness.python },
      );
    }
    const metadata = JSON.parse(String(probe.stdout || "").trim());
    const mismatched = requiredPackages.filter((name) => String(metadata.packages?.[name] || "") !== pins[name]);
    if (mismatched.length) {
      return result(
        "PDF renderer",
        "fail",
        `Installed renderer package versions do not match requirements-runtime.txt (${mismatched.length} mismatch(es)).`,
        { mismatched, installed: metadata.packages, pinned: pins, python: readiness.python },
      );
    }
    return result(
      "PDF renderer",
      "pass",
      `Pantheon's exact Python ${metadata.python} product renderer and four pinned packages are ready.`,
      {
        python: readiness.python,
        scripts: scripts.map((scriptPath) => path.basename(scriptPath)),
        packages: metadata.packages,
        pinned: Object.fromEntries(requiredPackages.map((name) => [name, pins[name]])),
      },
    );
  } catch (error) {
    return result("PDF renderer", "fail", `Pantheon's renderer contract could not be validated: ${error.message}`);
  }
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
    const proof = verifyDatabase(db);
    return result(
      "Runtime database",
      "pass",
      `Pantheon schema ${proof.schemaVersion} passed structural, SQLite, and ownership checks.`,
      { path: dbPath, ...proof },
    );
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

function freeLoopbackPort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close((error) => {
        if (error) reject(error);
        else resolve(address.port);
      });
    });
  });
}

function waitForChildExit(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve({ code: child.exitCode, signal: child.signalCode });
  }
  return new Promise((resolve, reject) => {
    const deadline = setTimeout(() => {
      cleanup();
      reject(new Error(`Restored Pantheon did not exit within ${timeoutMs} milliseconds.`));
    }, timeoutMs);
    const onExit = (code, signal) => {
      cleanup();
      resolve({ code, signal });
    };
    const onError = (error) => {
      cleanup();
      reject(error);
    };
    const cleanup = () => {
      clearTimeout(deadline);
      child.off("exit", onExit);
      child.off("error", onError);
    };
    child.once("exit", onExit);
    child.once("error", onError);
  });
}

function loopbackPortAvailable(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.listen({ host: "127.0.0.1", port, exclusive: true }, () => {
      server.close(() => resolve(true));
    });
  });
}

function restoredHealthReady(body) {
  return body?.runtimeReady === true || body?.operationsReady === true;
}

function restoredBootEnvironment({
  controlToken,
  dataRoot,
  dbPath,
  drillRoot,
  instanceId,
  port,
  sourceEnvironment = process.env,
} = {}) {
  const environment = {};
  for (const [name, value] of Object.entries(sourceEnvironment || {})) {
    if (RESTORED_BOOT_OS_ENVIRONMENT_ALLOWLIST.has(name.toUpperCase())) {
      environment[name] = value;
    }
  }
  return {
    ...environment,
    NODE_ENV: "production",
    NODE_PATH: path.join(root, "node_modules"),
    PORT: String(port),
    PANTHEON_DATA_DIR: dataRoot,
    PANTHEON_DB_PATH: dbPath,
    PANTHEON_ARTIFACT_ROOT: path.join(dataRoot, "artifacts"),
    PANTHEON_PROOF_LEDGER_PATH: path.join(dataRoot, "proof-ledger.jsonl"),
    PANTHEON_APPROVAL_PACK_DIR: path.join(drillRoot, "approval-packs"),
    PANTHEON_BACKUP_DESTINATION: path.join(drillRoot, "backups"),
    PANTHEON_PRIVATE_OPERATOR_DIR: path.join(drillRoot, "private"),
    PANTHEON_PRIVACY_HASH_KEY: "doctor-only-privacy-hash-key-32-bytes",
    PANTHEON_OPERATOR_BOOTSTRAP: crypto.randomBytes(32).toString("base64url"),
    PANTHEON_CONTROL_TOKEN: controlToken,
    PANTHEON_RUNTIME_INSTANCE_ID: instanceId,
    PANTHEON_PUBLIC_BASE_URL: `http://127.0.0.1:${port}`,
    PANTHEON_SCHEDULER_ENABLED: "1",
    PANTHEON_SCHEDULER_POLL_SECONDS: "60",
    PANTHEON_SYSTEM_PROOF_MODE: "0",
    PANTHEON_LIVE_MODE: "0",
    PANTHEON_ENABLE_LIVE_MODELS: "0",
    PANTHEON_ENABLE_LIVE_RESEARCH: "0",
    PANTHEON_ENABLE_IMAGE_GENERATION: "0",
    PANTHEON_DISABLE_OPENAI_AGENTS_SDK: "1",
    PANTHEON_DISABLE_LIVE_AI_WORKER_ADAPTER: "1",
    PANTHEON_DISABLE_LIVE_RESEARCH_ADAPTER: "1",
    JARVIS_LIVE_MODE: "0",
    JARVIS_ENABLE_LIVE_MODELS: "0",
    JARVIS_ENABLE_LIVE_RESEARCH: "0",
    JARVIS_ENABLE_IMAGE_GENERATION: "0",
  };
}

async function waitForRestoredHealth(child, origin, diagnostics, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastFailure = "health endpoint did not answer";
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(
        `Restored Pantheon exited before health proof (${diagnostics() || "no process output"}).`,
      );
    }
    try {
      const response = await fetch(`${origin}/api/health`, {
        signal: AbortSignal.timeout(1_500),
      });
      const body = await response.json();
      const ready = restoredHealthReady(body);
      if (
        response.status === 200
        && body?.alive === true
        && ready
        && body?.externalActionsMode === "locked"
      ) {
        return {
          status: response.status,
          alive: true,
          ready: true,
          readinessField: body.runtimeReady === true
            ? "runtimeReady"
            : "operationsReady",
          externalActionsMode: body.externalActionsMode,
          instanceId: String(body.instanceId || ""),
        };
      }
      lastFailure = `status=${response.status}, alive=${body?.alive}, ready=${ready}, externalActionsMode=${body?.externalActionsMode}`;
    } catch (error) {
      lastFailure = error.message;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(
    `Restored Pantheon did not produce a ready locked /api/health response: ${lastFailure}.`,
  );
}

async function runRestoredPantheonDrill(restoredRoot, options = {}) {
  const workspaceRoot = path.resolve(restoredRoot);
  const source = validateRecoverySourceBundle(workspaceRoot);
  const sourceDbPath = path.join(workspaceRoot, "data", "runtime.sqlite");
  if (!fs.existsSync(sourceDbPath) || !fs.statSync(sourceDbPath).isFile()) {
    throw new Error("Restored Pantheon is missing data/runtime.sqlite for its boot drill.");
  }
  const sourceDbSha256 = sha256File(sourceDbPath);
  const drillRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pantheon-restored-boot-"));
  const dataRoot = path.join(drillRoot, "data");
  const dbPath = path.join(dataRoot, "runtime.sqlite");
  const port = await freeLoopbackPort();
  const controlToken = crypto.randomBytes(32).toString("base64url");
  const instanceId = `doctor-${crypto.randomUUID()}`;
  const entrypoint = path.resolve(workspaceRoot, ...source.startPath.split("/"));
  fs.mkdirSync(dataRoot, { recursive: true });
  fs.copyFileSync(sourceDbPath, dbPath, fs.constants.COPYFILE_EXCL);
  let stdout = "";
  let stderr = "";
  let child = null;
  const appendBounded = (current, chunk) => (
    `${current}${chunk}`.slice(-64 * 1024)
  );
  const diagnostics = () => [stdout.trim(), stderr.trim()].filter(Boolean).join("\n");
  try {
    child = spawn(process.execPath, [entrypoint], {
      cwd: workspaceRoot,
      env: restoredBootEnvironment({
        controlToken,
        dataRoot,
        dbPath,
        drillRoot,
        instanceId,
        port,
      }),
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout.on("data", (chunk) => { stdout = appendBounded(stdout, chunk); });
    child.stderr.on("data", (chunk) => { stderr = appendBounded(stderr, chunk); });
    const origin = `http://127.0.0.1:${port}`;
    const health = await waitForRestoredHealth(
      child,
      origin,
      diagnostics,
      Number(options.healthTimeoutMs || 30_000),
    );
    const shutdownResponse = await fetch(`${origin}/api/runtime/shutdown`, {
      method: "POST",
      headers: { "x-pantheon-control": controlToken },
      signal: AbortSignal.timeout(5_000),
    });
    const shutdownBody = await shutdownResponse.json();
    if (shutdownResponse.status !== 202 || shutdownBody?.ok !== true) {
      throw new Error(
        `Restored Pantheon rejected controlled shutdown (status ${shutdownResponse.status}).`,
      );
    }
    const exit = await waitForChildExit(child, Number(options.shutdownTimeoutMs || 10_000));
    if (exit.code !== 0 || exit.signal !== null) {
      throw new Error(
        `Restored Pantheon did not stop cleanly (exit=${exit.code}, signal=${exit.signal || "none"}).`,
      );
    }
    const portReleased = await loopbackPortAvailable(port);
    if (!portReleased) throw new Error("Restored Pantheon left its disposable port occupied.");
    if (sha256File(sourceDbPath) !== sourceDbSha256) {
      throw new Error("Restored source database changed during the disposable boot drill.");
    }
    return {
      completed: true,
      source,
      dependencyProof: {
        mode: "current_workspace_node_modules",
        cleanInstallProved: false,
        statement: "Boot compatibility was checked with the currently installed dependency tree; clean installation from the recovered lockfile is a separate release proof.",
      },
      databaseCopy: {
        sourceUnchanged: true,
        sourceSha256: sourceDbSha256,
      },
      health,
      shutdown: {
        accepted: true,
        exited: true,
        exitCode: exit.code,
        signal: exit.signal,
        portReleased,
      },
    };
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
      await waitForChildExit(child, 5_000).catch(() => {});
    }
    fs.rmSync(drillRoot, { recursive: true, force: true });
  }
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
    const drillRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pantheon-doctor-restore-"));
    try {
      const proof = await restoreBackup(
        candidate.filePath,
        path.join(drillRoot, "restored-workspace"),
        { passphrase: options.passphrase },
      );
      const boot = await runRestoredPantheonDrill(
        path.join(drillRoot, "restored-workspace"),
        {
          healthTimeoutMs: options.healthTimeoutMs,
          shutdownTimeoutMs: options.shutdownTimeoutMs,
        },
      );
      verified = { ...candidate, proof, boot };
      break;
    } catch (error) {
      invalidSets.push({ filePath: candidate.filePath, error: error.message });
    } finally {
      fs.rmSync(drillRoot, { recursive: true, force: true });
    }
  }
  if (!verified) {
    return result(
      "Recovery set",
      "fail",
      "Pantheon found recovery-set files, but none completed a disposable authenticated restore drill.",
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
    source: verified.proof.recoverySet.source,
    restoreDrill: {
      completed: true,
      verifiedAt: verified.proof.verificationRecord?.verifiedAt || null,
      destinationRetained: false,
      sourceDatabaseUnchanged: verified.boot.databaseCopy.sourceUnchanged,
      dependencyProof: verified.boot.dependencyProof,
      health: verified.boot.health,
      shutdown: verified.boot.shutdown,
    },
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
    "A recent encrypted Pantheon recovery set completed a disposable authenticated restore drill.",
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
  const requiredInstallationPasses = [
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
  ];
  const installationBlockers = [];
  for (const name of requiredInstallationPasses) {
    const item = byName.get(name);
    if (!item || item.status !== "pass") {
      installationBlockers.push(item?.message || `${name} was not checked.`);
    }
  }
  for (const item of results.filter((entry) => entry.status === "fail" && entry.name !== "Recovery set")) {
    if (!installationBlockers.includes(item.message)) installationBlockers.push(item.message);
  }
  const recovery = byName.get("Recovery set");
  const recoveryBlockers = recovery?.status === "pass"
    ? []
    : [recovery?.message || "Recovery set was not checked."];
  const installationReady = installationBlockers.length === 0;
  const recoveryReady = recoveryBlockers.length === 0;
  const readinessBlockers = [...new Set([...installationBlockers, ...recoveryBlockers])];
  return {
    installationReady,
    recoveryReady,
    runtimeReady: null,
    readinessScope: "installation_and_recovery",
    operationsReady: installationReady && recoveryReady,
    operationsReadyAliasFor: "installationReady && recoveryReady",
    installationBlockers,
    recoveryBlockers,
    readinessBlockers,
  };
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
    await checkPort(options.port ?? CONFIG.port),
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
    ? "Pantheon's installation and recovery set are ready."
    : `Pantheon's installation or recovery set is not ready (${report.readinessBlockers.length} blocker(s)).`);
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
  restoredHealthReady,
  restoredBootEnvironment,
  runRestoredPantheonDrill,
  runDoctor,
};
