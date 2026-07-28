const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const workspaceRoot = path.resolve(__dirname, "..");
const powershell = path.join(
  process.env.SystemRoot || "C:\\Windows",
  "System32",
  "WindowsPowerShell",
  "v1.0",
  "powershell.exe",
);

const fakeServer = String.raw`
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { spawn } = require("node:child_process");

const port = Number(process.argv[2]);
const root = path.resolve(__dirname, "..");
const stateRoot = path.join(root, "tmp");
const instanceId = process.env.PANTHEON_RUNTIME_INSTANCE_ID;
const controlToken = process.env.PANTHEON_CONTROL_TOKEN;
fs.mkdirSync(stateRoot, { recursive: true });

const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
  stdio: "ignore",
  windowsHide: true,
});
child.unref();
fs.writeFileSync(path.join(stateRoot, "fake-child-" + port + ".pid"), String(child.pid));

const outputProbe = setInterval(() => {
  process.stdout.write("pantheon launcher output probe\n");
  process.stderr.write("pantheon launcher error probe\n");
}, 100);

const server = http.createServer((request, response) => {
  if (request.method === "GET" && request.url === "/api/health") {
    const unready = fs.existsSync(path.join(stateRoot, "fake-unready-" + port));
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({
      alive: true,
      ok: !unready,
      operationsReady: !unready,
      instanceId,
      scheduler: { enabled: true, running: true },
      monitoring: {
        reason: unready ? "test_monitor_not_ready" : null,
        job: { enabled: true },
        latestCompletedCheck: { completedAt: new Date().toISOString() },
      },
      externalActionsMode: "locked",
      paidAiArmed: Boolean(process.env.OPENAI_API_KEY),
    }));
    return;
  }
  if (request.method === "POST" && request.url === "/api/runtime/shutdown") {
    if (request.headers["x-pantheon-control"] !== controlToken) {
      response.writeHead(403).end();
      return;
    }
    response.writeHead(202, { "content-type": "application/json" });
    response.end(JSON.stringify({ ok: true, instanceId }));
    if (!fs.existsSync(path.join(stateRoot, "fake-hang-" + port))) {
      setTimeout(() => server.close(() => {
        clearInterval(outputProbe);
        process.exit(0);
      }), 20);
    }
    return;
  }
  response.writeHead(404).end();
});

server.listen(port, "127.0.0.1");
process.on("SIGTERM", () => server.close(() => process.exit(0)));
process.on("SIGINT", () => server.close(() => process.exit(0)));
`;

function makeLauncherWorkspace(name) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `pantheon-launcher-${name}-`));
  for (const directory of ["scripts", "src", "public", "node_modules", "tmp"]) {
    fs.mkdirSync(path.join(root, directory), { recursive: true });
  }
  for (const file of [
    "pantheon-launcher-common.ps1",
    "pantheon-credential-store.ps1",
    "configure-openai.ps1",
    "configure-pantheon-recovery.ps1",
    "start-pantheon.ps1",
    "stop-pantheon.ps1",
    "status-pantheon.ps1",
  ]) {
    fs.copyFileSync(path.join(workspaceRoot, "scripts", file), path.join(root, "scripts", file));
  }
  fs.writeFileSync(path.join(root, "scripts", "serve-pantheon.js"), fakeServer);
  fs.writeFileSync(path.join(root, "src", "placeholder.js"), "module.exports = {};\n");
  fs.writeFileSync(path.join(root, "public", "placeholder.txt"), "Pantheon launcher test\n");
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "pantheon-launcher-test", version: "1.0.0" }));
  fs.writeFileSync(path.join(root, "package-lock.json"), JSON.stringify({ name: "pantheon-launcher-test", lockfileVersion: 3 }));
  return root;
}

function runPowerShell(
  script,
  args,
  cwd,
  capture = false,
  extraEnv = {},
  resolveOnExit = false,
  timeoutMs = 25_000,
) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      powershell,
      ["-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script, ...args.map(String)],
      {
        cwd,
        env: {
          ...process.env,
          OPENAI_API_KEY: "",
          PANTHEON_CREDENTIAL_ROOT: path.join(cwd, "tmp", "credentials"),
          PANTHEON_LAUNCHER_STATE_ROOT: path.join(cwd, "tmp"),
          ...extraEnv,
        },
        windowsHide: true,
        stdio: capture ? ["ignore", "pipe", "pipe"] : "ignore",
      },
    );
    let stdout = "";
    let stderr = "";
    let settled = false;
    let deadline = null;
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      if (deadline) clearTimeout(deadline);
      if (error) reject(error);
      else resolve(result);
    };
    if (capture) {
      child.stdout.on("data", (chunk) => { stdout += chunk; });
      child.stderr.on("data", (chunk) => { stderr += chunk; });
    }
    child.on("error", (error) => finish(error));
    child.on(capture && resolveOnExit ? "exit" : "close", (code) => {
      finish(null, { code, stdout, stderr });
    });
    deadline = setTimeout(() => {
      child.kill("SIGKILL");
      finish(new Error(`Windows launcher command exceeded its ${timeoutMs}-millisecond test deadline.`));
    }, timeoutMs);
    deadline.unref();
  });
}

test("OpenAI credentials persist outside the repository and ignore unreadable legacy recovery fields", {
  skip: process.platform !== "win32",
  timeout: 60_000,
}, async () => {
  const root = makeLauncherWorkspace("credential-store");
  const port = await freePort();
  const fakeKey = `sk-proj-pantheon-test-${"x".repeat(48)}`;
  try {
    const configured = await runPowerShell(
      path.join(root, "scripts", "configure-openai.ps1"),
      ["-UseCurrentProcess"],
      root,
      true,
      { OPENAI_API_KEY: fakeKey },
    );
    assert.equal(configured.code, 0, configured.stderr);
    assert.doesNotMatch(`${configured.stdout}\n${configured.stderr}`, new RegExp(fakeKey));

    const credentialPath = path.join(root, "tmp", "credentials", "openai-credential.json");
    assert.equal(fs.existsSync(credentialPath), true);
    const stored = fs.readFileSync(credentialPath, "utf8");
    assert.doesNotMatch(stored, new RegExp(fakeKey));
    const profile = JSON.parse(stored);
    assert.equal(profile.storage, "windows-current-user-dpapi");
    assert.ok(profile.openAiApiKeyProtected.length > 20);

    fs.mkdirSync(path.join(root, "private"), { recursive: true });
    fs.writeFileSync(path.join(root, "private", "runtime-credentials.json"), JSON.stringify({
      version: 2,
      backupPassphraseProtected: "unreadable-legacy-backup-secret",
      privacyHashKeyProtected: "unreadable-legacy-privacy-secret",
    }));

    const started = await runPowerShell(
      path.join(root, "scripts", "start-pantheon.ps1"),
      ["-Port", port, "-NoOpen", "-ReadyTimeoutSeconds", "5"],
      root,
      false,
    );
    assert.equal(started.code, 0);
    const health = await fetch(`http://127.0.0.1:${port}/api/health`).then((response) => response.json());
    assert.equal(health.paidAiArmed, true);
  } finally {
    await cleanupWorkspace(root);
  }
});

test("recovery credentials persist outside the repository, retain legacy restore keys, and reject conflicts", {
  skip: process.platform !== "win32",
  timeout: 60_000,
}, async () => {
  const root = makeLauncherWorkspace("recovery-credential-store");
  const destination = path.join(root, "backups");
  const activeKey = `pantheon-active-${"a".repeat(40)}`;
  const legacyKey = `pantheon-legacy-${"b".repeat(40)}`;
  const conflictKey = `pantheon-conflict-${"c".repeat(40)}`;
  try {
    const configured = await runPowerShell(
      path.join(root, "scripts", "configure-pantheon-recovery.ps1"),
      ["-Destination", destination],
      root,
      true,
      {
        PANTHEON_BACKUP_PASSPHRASE: activeKey,
        JARVIS_BACKUP_PASSPHRASE: legacyKey,
      },
    );
    assert.equal(configured.code, 0, configured.stderr);
    assert.doesNotMatch(`${configured.stdout}\n${configured.stderr}`, new RegExp(activeKey));
    assert.doesNotMatch(`${configured.stdout}\n${configured.stderr}`, new RegExp(legacyKey));

    const recoveryPath = path.join(root, "tmp", "credentials", "recovery-credential.json");
    assert.equal(fs.existsSync(recoveryPath), true);
    const stored = fs.readFileSync(recoveryPath, "utf8");
    assert.doesNotMatch(stored, new RegExp(activeKey));
    assert.doesNotMatch(stored, new RegExp(legacyKey));
    const profile = JSON.parse(stored);
    assert.equal(profile.storage, "windows-current-user-dpapi");
    assert.match(profile.activeBackupKeyId, /^pbk-[a-f0-9]{20}$/);
    assert.equal(profile.legacyBackupKeys.length, 1);

    const reconfigured = await runPowerShell(
      path.join(root, "scripts", "configure-pantheon-recovery.ps1"),
      ["-Destination", destination],
      root,
      true,
      { PANTHEON_BACKUP_PASSPHRASE: "", JARVIS_BACKUP_PASSPHRASE: "" },
    );
    assert.equal(reconfigured.code, 0, reconfigured.stderr);
    assert.equal(JSON.parse(fs.readFileSync(recoveryPath, "utf8")).activeBackupKeyId, profile.activeBackupKeyId);

    const port = await freePort();
    const conflictedStart = await runPowerShell(
      path.join(root, "scripts", "start-pantheon.ps1"),
      ["-Port", port, "-NoOpen", "-ReadyTimeoutSeconds", "5"],
      root,
      true,
      { PANTHEON_BACKUP_PASSPHRASE: conflictKey, JARVIS_BACKUP_PASSPHRASE: "" },
    );
    assert.notEqual(conflictedStart.code, 0);
    assert.match(conflictedStart.stderr, /conflicts with Pantheon's\s+protected recovery profile/i);
  } finally {
    await cleanupWorkspace(root);
  }
});

function processAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

async function waitForExit(pid, timeoutMs = 8_000) {
  const deadline = Date.now() + timeoutMs;
  while (processAlive(pid) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return !processAlive(pid);
}

async function cleanupWorkspace(root) {
  if (!root) return;
  const stopScript = path.join(root, "scripts", "stop-pantheon.ps1");
  if (fs.existsSync(stopScript)) {
    const stopped = await runPowerShell(
      stopScript,
      ["-All", "-GracefulTimeoutSeconds", "1"],
      root,
      true,
    ).catch((error) => ({ code: 1, stdout: "", stderr: error.message }));
    if (stopped.code !== 0) {
      throw new Error(`launcher cleanup failed:\n${stopped.stdout}\n${stopped.stderr}`);
    }
  }
  fs.rmSync(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
}

test("Windows launchers are PowerShell 5.1 compatible, idempotent, and stop production plus rehearsal trees", {
  skip: process.platform !== "win32",
  timeout: 90_000,
}, async () => {
  const root = makeLauncherWorkspace("lifecycle");
  const productionPort = await freePort();
  const rehearsalPort = await freePort();
  const unrelated = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
    stdio: "ignore",
    windowsHide: true,
  });
  unrelated.unref();

  try {
    const startScript = path.join(root, "scripts", "start-pantheon.ps1");
    const concurrent = await Promise.all([
      runPowerShell(
        startScript,
        ["-Port", productionPort, "-NoOpen", "-ReadyTimeoutSeconds", "5"],
        root,
        true,
        {},
        true,
      ),
      runPowerShell(
        startScript,
        ["-Port", productionPort, "-NoOpen", "-ReadyTimeoutSeconds", "5"],
        root,
        true,
        {},
        true,
      ),
    ]);
    const concurrentDiagnostics = concurrent
      .map((result, index) => `start ${index + 1}:\n${result.stdout}\n${result.stderr}`)
      .join("\n");
    assert.deepEqual(concurrent.map((result) => result.code), [0, 0], concurrentDiagnostics);

    const productionMetadataPath = path.join(root, "tmp", `pantheon-server-${productionPort}.json`);
    const productionMetadata = JSON.parse(fs.readFileSync(productionMetadataPath, "utf8"));
    assert.equal(productionMetadata.metadataVersion, 2);
    assert.equal(productionMetadata.mode, "production");
    assert.ok(processAlive(productionMetadata.pid));

    const thirdStart = await runPowerShell(
      startScript,
      ["-Port", productionPort, "-NoOpen", "-ReadyTimeoutSeconds", "5"],
      root,
    );
    assert.equal(thirdStart.code, 0, thirdStart.stderr);
    assert.equal(JSON.parse(fs.readFileSync(productionMetadataPath, "utf8")).pid, productionMetadata.pid);

    const rehearsalStart = await runPowerShell(
      startScript,
      ["-Port", rehearsalPort, "-JourneyRehearsal", "-NoOpen", "-ReadyTimeoutSeconds", "5"],
      root,
    );
    assert.equal(rehearsalStart.code, 0, rehearsalStart.stderr);
    const rehearsalMetadata = JSON.parse(fs.readFileSync(path.join(root, "tmp", `pantheon-server-${rehearsalPort}.json`), "utf8"));
    assert.equal(rehearsalMetadata.mode, "rehearsal");

    const status = await runPowerShell(
      path.join(root, "scripts", "status-pantheon.ps1"),
      ["-Port", productionPort, "-Json"],
      root,
      true,
    );
    assert.equal(status.code, 0, status.stderr);
    assert.equal(JSON.parse(status.stdout).state, "ready");

    const productionChildPid = Number(fs.readFileSync(path.join(root, "tmp", `fake-child-${productionPort}.pid`), "utf8"));
    const rehearsalChildPid = Number(fs.readFileSync(path.join(root, "tmp", `fake-child-${rehearsalPort}.pid`), "utf8"));
    assert.ok(processAlive(productionChildPid));
    assert.ok(processAlive(rehearsalChildPid));

    const stopped = await runPowerShell(
      path.join(root, "scripts", "stop-pantheon.ps1"),
      ["-All", "-GracefulTimeoutSeconds", "3"],
      root,
    );
    assert.equal(stopped.code, 0, `${stopped.stdout}\n${stopped.stderr}`);
    for (const pid of [productionMetadata.pid, rehearsalMetadata.pid, productionChildPid, rehearsalChildPid]) {
      assert.equal(await waitForExit(pid), true, `expected launcher-owned process ${pid} to exit`);
    }
    assert.equal(processAlive(unrelated.pid), true, "an unrelated Node process must never be stopped");
    assert.equal(fs.existsSync(productionMetadataPath), false);
    assert.equal(fs.existsSync(path.join(root, "tmp", `pantheon-server-${rehearsalPort}.json`)), false);
  } finally {
    if (processAlive(unrelated.pid)) process.kill(unrelated.pid);
    await cleanupWorkspace(root);
  }
});

test("Windows stop refuses a changed process identity and succeeds after exact ownership is restored", {
  skip: process.platform !== "win32",
  timeout: 60_000,
}, async () => {
  const root = makeLauncherWorkspace("identity");
  const port = await freePort();
  let metadataPath = null;
  let metadata = null;
  try {
    const start = await runPowerShell(
      path.join(root, "scripts", "start-pantheon.ps1"),
      ["-Port", port, "-NoOpen", "-ReadyTimeoutSeconds", "5"],
      root,
    );
    assert.equal(start.code, 0, start.stderr);

    metadataPath = path.join(root, "tmp", `pantheon-server-${port}.json`);
    metadata = JSON.parse(fs.readFileSync(metadataPath, "utf8"));
    const tampered = { ...metadata, processStartFileTimeUtc: "0" };
    fs.writeFileSync(metadataPath, JSON.stringify(tampered));

    const refused = await runPowerShell(
      path.join(root, "scripts", "stop-pantheon.ps1"),
      ["-Port", port, "-GracefulTimeoutSeconds", "1"],
      root,
    );
    assert.notEqual(refused.code, 0);
    assert.equal(processAlive(metadata.pid), true, "identity mismatch must leave the process untouched");
    const refusedStatus = await runPowerShell(
      path.join(root, "scripts", "status-pantheon.ps1"),
      ["-Port", port, "-Json"],
      root,
      true,
    );
    assert.equal(JSON.parse(refusedStatus.stdout).state, "ownership_mismatch");

    fs.writeFileSync(metadataPath, JSON.stringify(metadata));
    const stopped = await runPowerShell(
      path.join(root, "scripts", "stop-pantheon.ps1"),
      ["-Port", port, "-GracefulTimeoutSeconds", "2"],
      root,
    );
    assert.equal(stopped.code, 0, `${stopped.stdout}\n${stopped.stderr}`);
    assert.equal(await waitForExit(metadata.pid), true);
  } finally {
    if (metadataPath && metadata && processAlive(metadata.pid)) {
      fs.writeFileSync(metadataPath, JSON.stringify(metadata));
    }
    await cleanupWorkspace(root);
  }
});

test("Windows launcher recovers safely when a stale Pantheon PID has been reused", {
  skip: process.platform !== "win32",
  timeout: 60_000,
}, async () => {
  const root = makeLauncherWorkspace("reused-pid");
  const port = await freePort();
  const unrelated = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
    stdio: "ignore",
    windowsHide: true,
  });
  unrelated.unref();
  try {
    const metadataPath = path.join(root, "tmp", `pantheon-server-${port}.json`);
    fs.writeFileSync(metadataPath, JSON.stringify({
      metadataVersion: 2,
      pid: unrelated.pid,
      port,
      instanceId: "stale-reused-pid",
      mode: "production",
      executablePath: process.execPath,
      processStartFileTimeUtc: "1",
      processStartTimeUtc: "2026-01-01T00:00:00.000Z",
      serverScriptPath: path.join(root, "scripts", "serve-pantheon.js"),
      workspaceRoot: root,
      expectedDbPath: path.join(root, "data", "runtime.sqlite"),
      configFingerprint: "stale",
      bootstrapProtected: "",
      controlProtected: "",
      startedAt: "2026-01-01T00:00:00.000Z",
    }));

    const staleStatus = await runPowerShell(
      path.join(root, "scripts", "status-pantheon.ps1"),
      ["-Port", port, "-Json"],
      root,
      true,
    );
    assert.equal(staleStatus.code, 0, staleStatus.stderr);
    assert.equal(JSON.parse(staleStatus.stdout).state, "stale_metadata");

    const started = await runPowerShell(
      path.join(root, "scripts", "start-pantheon.ps1"),
      ["-Port", port, "-NoOpen", "-ReadyTimeoutSeconds", "5"],
      root,
      false,
    );
    assert.equal(started.code, 0);
    assert.equal(processAlive(unrelated.pid), true, "PID recovery must not stop the unrelated process");

    const replacement = JSON.parse(fs.readFileSync(metadataPath, "utf8"));
    assert.notEqual(replacement.instanceId, "stale-reused-pid");
    assert.notEqual(replacement.pid, unrelated.pid);
    const health = await fetch(`http://127.0.0.1:${port}/api/health`).then((response) => response.json());
    assert.equal(health.ok, true);
  } finally {
    if (processAlive(unrelated.pid)) process.kill(unrelated.pid);
    await cleanupWorkspace(root);
  }
});

test("an operations-unready production start fails cleanly without leaving its process tree", {
  skip: process.platform !== "win32",
  timeout: 60_000,
}, async () => {
  const root = makeLauncherWorkspace("unready");
  const port = await freePort();
  fs.writeFileSync(path.join(root, "tmp", `fake-unready-${port}`), "1");
  try {
    const result = await runPowerShell(
      path.join(root, "scripts", "start-pantheon.ps1"),
      ["-Port", port, "-NoOpen", "-StartupTimeoutSeconds", "5", "-ReadyTimeoutSeconds", "2"],
      root,
    );
    assert.notEqual(result.code, 0);

    const childPidPath = path.join(root, "tmp", `fake-child-${port}.pid`);
    assert.equal(fs.existsSync(childPidPath), true);
    const childPid = Number(fs.readFileSync(childPidPath, "utf8"));
    assert.equal(await waitForExit(childPid), true, "failed startup must clean its child process");
    assert.equal(fs.existsSync(path.join(root, "tmp", `pantheon-server-${port}.json`)), false);
  } finally {
    await cleanupWorkspace(root);
  }
});

test("operator command files use native Windows PowerShell and the main stop command covers every owned instance", () => {
  const startCommand = fs.readFileSync(path.join(workspaceRoot, "START PANTHEON.cmd"), "utf8");
  const rehearsalCommand = fs.readFileSync(path.join(workspaceRoot, "START PANTHEON REHEARSAL.cmd"), "utf8");
  const stopCommand = fs.readFileSync(path.join(workspaceRoot, "STOP PANTHEON.cmd"), "utf8");
  assert.match(startCommand, /System32\\WindowsPowerShell\\v1\.0\\powershell\.exe/i);
  assert.match(rehearsalCommand, /-JourneyRehearsal/);
  assert.match(stopCommand, /stop-pantheon\.ps1" -All/i);
});
