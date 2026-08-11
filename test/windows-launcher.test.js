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
const lifecyclePhase = process.env.PANTHEON_LIFECYCLE_PHASE || "all";
const workingStartRequestTimeoutMs = 170_000;
if (!["all", "containment", "repeat"].includes(lifecyclePhase)) {
  throw new Error(`Unsupported Windows lifecycle phase: ${lifecyclePhase}`);
}

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
  for (const directory of ["scripts", "scripts/windows", "src", "public", "node_modules", "tmp"]) {
    fs.mkdirSync(path.join(root, directory), { recursive: true });
  }
  for (const file of [
    "pantheon-launcher-common.ps1",
    "pantheon-credential-store.ps1",
    "configure-openai.ps1",
    "configure-pantheon-recovery.ps1",
    "ensure-pantheon-supervisor.ps1",
    "start-pantheon.ps1",
    "start-pantheon-control.ps1",
    "stop-pantheon.ps1",
    "status-pantheon.ps1",
    "pantheon-standby.js",
  ]) {
    fs.copyFileSync(path.join(workspaceRoot, "scripts", file), path.join(root, "scripts", file));
  }
  fs.copyFileSync(
    path.join(workspaceRoot, "scripts", "windows", "PantheonSupervisor.cs"),
    path.join(root, "scripts", "windows", "PantheonSupervisor.cs"),
  );
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
    let timeoutError = null;
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      if (deadline) clearTimeout(deadline);
      if (capture) {
        child.stdout.destroy();
        child.stderr.destroy();
      }
      if (error) reject(error);
      else resolve(result);
    };
    if (capture) {
      child.stdout.on("data", (chunk) => { stdout += chunk; });
      child.stderr.on("data", (chunk) => { stderr += chunk; });
    }
    child.on("error", (error) => {
      if (!timeoutError) finish(error);
    });
    child.on(capture && resolveOnExit ? "exit" : "close", (code) => {
      if (!timeoutError) finish(null, { code, stdout, stderr });
    });
    deadline = setTimeout(() => {
      timeoutError = new Error(
        `Windows launcher command exceeded its ${timeoutMs}-millisecond test deadline.`,
      );
      // child.kill() uses the exact ChildProcess handle. Descendant cleanup is
      // left to Pantheon's ownership-verified stop path in each test's finally.
      child.kill("SIGKILL");
      finish(timeoutError);
    }, timeoutMs);
    // Keep the hard deadline referenced. On Windows, process exit can race the
    // final pipe-close notification; without this handle node:test can abandon
    // the still-pending command promise instead of completing or timing it out.
  });
}

function launcherFailureDetails(root, port, result) {
  const serverErrorPath = path.join(root, "tmp", `pantheon-server-${port}-error.log`);
  const serverError = fs.existsSync(serverErrorPath)
    ? fs.readFileSync(serverErrorPath, "utf8").trim()
    : "";
  return [
    `Pantheon launcher exited with code ${result.code}.`,
    result.stdout.trim() ? `stdout:\n${result.stdout.trim()}` : "",
    result.stderr.trim() ? `stderr:\n${result.stderr.trim()}` : "",
    serverError ? `server stderr:\n${serverError}` : "",
  ].filter(Boolean).join("\n");
}

async function fetchWithDeadline(url, options = {}, timeoutMs = 10_000) {
  const controller = new AbortController();
  const deadline = setTimeout(() => {
    controller.abort(new Error(`Local launcher request exceeded ${timeoutMs} milliseconds: ${url}`));
  }, timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const body = await response.text();
    return {
      ok: response.ok,
      status: response.status,
      headers: response.headers,
      text: async () => body,
      json: async () => JSON.parse(body),
    };
  } finally {
    clearTimeout(deadline);
  }
}

const transientProcessSnapshotProbe = String.raw`
$script:PantheonOriginalGetProcessSnapshot = (Get-Item Function:\Get-PantheonProcessSnapshot).ScriptBlock
$script:PantheonInjectedSnapshotMisses = 0
function Get-PantheonProcessSnapshot {
  param([Parameter(Mandatory = $true)][int]$ProcessId)
  if (
    [Environment]::GetEnvironmentVariable("PANTHEON_TEST_TRANSIENT_SNAPSHOT", "Process") -eq "1" -and
    $script:PantheonInjectedSnapshotMisses -lt 2
  ) {
    $script:PantheonInjectedSnapshotMisses += 1
    return $null
  }
  return & $script:PantheonOriginalGetProcessSnapshot -ProcessId $ProcessId
}
`;

const capturedProcessStopRaceProof = String.raw`
$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "pantheon-launcher-common.ps1")

$nativeChild = $null
try {
  $nativeChild = Start-Process -FilePath (Join-Path $PSHOME "powershell.exe") -ArgumentList @(
    "-NoLogo",
    "-NoProfile",
    "-Command",
    "Start-Sleep -Seconds 30"
  ) -WindowStyle Hidden -PassThru
  $nativeExpected = $null
  $nativeDeadline = [DateTime]::UtcNow.AddSeconds(5)
  do {
    $nativeExpected = Get-PantheonProcessSnapshot -ProcessId ([int]$nativeChild.Id)
    if ($nativeExpected) { break }
    Start-Sleep -Milliseconds 50
  } while ([DateTime]::UtcNow -lt $nativeDeadline)
  if (-not $nativeExpected) { throw "The native exact-process test child identity was unavailable." }

  $invalidExpected = [pscustomobject]@{
    pid = [int]$nativeExpected.pid
    executablePath = [string]$nativeExpected.executablePath
    startFileTimeUtc = "0"
  }
  $invalidResult = Request-PantheonExactProcessTermination -Expected $invalidExpected
  if ($invalidResult.state -ne "invalid_expected_identity" -or $nativeChild.HasExited) {
    throw "An invalid captured creation time did not fail closed."
  }

  $wrongStart = [pscustomobject]@{
    pid = [int]$nativeExpected.pid
    executablePath = [string]$nativeExpected.executablePath
    startFileTimeUtc = [string](([long]$nativeExpected.startFileTimeUtc) + 1)
  }
  $wrongStartResult = Request-PantheonExactProcessTermination -Expected $wrongStart
  if ($wrongStartResult.state -ne "pid_reused" -or $nativeChild.HasExited) {
    throw "A stale creation identity was not rejected without terminating the live replacement."
  }

  $wrongPath = [pscustomobject]@{
    pid = [int]$nativeExpected.pid
    executablePath = (Join-Path $env:SystemRoot "System32\cmd.exe")
    startFileTimeUtc = [string]$nativeExpected.startFileTimeUtc
  }
  $wrongPathResult = Request-PantheonExactProcessTermination -Expected $wrongPath
  if ($wrongPathResult.state -ne "identity_mismatch" -or $nativeChild.HasExited) {
    throw "A changed executable identity was not rejected without terminating the live process."
  }

  $nativeStopResult = Request-PantheonExactProcessTermination -Expected $nativeExpected
  if ($nativeStopResult.state -notin @("termination_requested", "already_exited")) {
    throw "The native helper did not accept the exact captured process identity."
  }
  if (-not (Wait-PantheonProcessExit -ProcessId ([int]$nativeExpected.pid) -TimeoutSeconds 3)) {
    throw "The native helper did not terminate its exact captured process."
  }
} finally {
  if ($nativeChild -and -not $nativeChild.HasExited) {
    Stop-Process -Id ([int]$nativeChild.Id) -Force -ErrorAction SilentlyContinue
  }
  if ($nativeChild) { $nativeChild.Dispose() }
}

$transientUnreadablePid = 991001
$delayedExitPid = 991002
$persistentPid = 991003
$replacementAfterRequestPid = 991004
$unreadablePid = 991005
$secondPersistentPid = 991006
$initialReusedPid = 991007
$identityMismatchPid = 991008
$terminationFailedPid = 991009
$script:TransientPolls = 0
$script:DelayedPolls = 0
$script:RequestCalls = @{}

function New-TestSnapshot([int]$ProcessId, [string]$StartFileTimeUtc = "100") {
  return [pscustomobject]@{
    pid = $ProcessId
    executablePath = "C:\\Program Files\\nodejs\\node.exe"
    startFileTimeUtc = $StartFileTimeUtc
  }
}

$expectedTransientUnreadable = New-TestSnapshot -ProcessId $transientUnreadablePid
$expectedDelayed = New-TestSnapshot -ProcessId $delayedExitPid
$expectedPersistent = New-TestSnapshot -ProcessId $persistentPid
$expectedReplacementAfterRequest = New-TestSnapshot -ProcessId $replacementAfterRequestPid
$expectedUnreadable = New-TestSnapshot -ProcessId $unreadablePid
$expectedSecondPersistent = New-TestSnapshot -ProcessId $secondPersistentPid
$expectedInitialReused = New-TestSnapshot -ProcessId $initialReusedPid
$expectedIdentityMismatch = New-TestSnapshot -ProcessId $identityMismatchPid
$expectedTerminationFailed = New-TestSnapshot -ProcessId $terminationFailedPid

function Get-PantheonProcessSnapshot {
  param([Parameter(Mandatory = $true)][int]$ProcessId)
  if ($ProcessId -eq $transientUnreadablePid) {
    $script:TransientPolls += 1
    return $null
  }
  if ($ProcessId -eq $delayedExitPid) {
    $script:DelayedPolls += 1
    if ($script:DelayedPolls -ge 4) { return $null }
    return $expectedDelayed
  }
  if ($ProcessId -in @($persistentPid, $secondPersistentPid, $terminationFailedPid)) {
    return New-TestSnapshot -ProcessId $ProcessId
  }
  if ($ProcessId -eq $replacementAfterRequestPid) {
    return New-TestSnapshot -ProcessId $replacementAfterRequestPid -StartFileTimeUtc "200"
  }
  if ($ProcessId -eq $unreadablePid) { return $null }
  return $null
}

function Get-Process {
  [CmdletBinding()]
  param([Parameter(Mandatory = $true)][int]$Id)
  if ($Id -eq $unreadablePid) { return [pscustomobject]@{ Id = $Id } }
  if ($Id -eq $transientUnreadablePid -and $script:TransientPolls -lt 3) {
    return [pscustomobject]@{ Id = $Id }
  }
  return $null
}

function Request-PantheonExactProcessTermination {
  param([Parameter(Mandatory = $true)]$Expected)
  $processId = [int]$Expected.pid
  $script:RequestCalls[$processId] = 1 + [int]$script:RequestCalls[$processId]
  if ($processId -eq $initialReusedPid) {
    return [pscustomobject]@{ state = "pid_reused"; reason = "creation_time_changed"; win32Error = 0 }
  }
  if ($processId -eq $identityMismatchPid) {
    return [pscustomobject]@{ state = "identity_mismatch"; reason = "executable_path_changed"; win32Error = 0 }
  }
  if ($processId -eq $unreadablePid) {
    return [pscustomobject]@{ state = "identity_unreadable"; reason = "open_process_failed"; win32Error = 5 }
  }
  if ($processId -eq $terminationFailedPid) {
    return [pscustomobject]@{ state = "termination_failed"; reason = "terminate_process_failed"; win32Error = 5 }
  }
  return [pscustomobject]@{
    state = "termination_requested"
    reason = "exact_process_termination_requested"
    win32Error = 0
  }
}

$transientUnreadableRemaining = @(
  Stop-PantheonCapturedProcesses -Snapshots @($expectedTransientUnreadable) -TimeoutSeconds 1
)
if ($transientUnreadableRemaining.Count -ne 0 -or $script:TransientPolls -lt 3) {
  throw "Transient unreadable teardown state was falsely reported as a surviving child."
}

$delayedRemaining = @(
  Stop-PantheonCapturedProcesses -Snapshots @($expectedDelayed) -TimeoutSeconds 1
)
if ($delayedRemaining.Count -ne 0 -or $script:DelayedPolls -lt 4) {
  throw "A delayed exact-child exit was not observed within the bounded wait."
}

$persistentRemaining = @(
  Stop-PantheonCapturedProcesses -Snapshots @($expectedPersistent) -TimeoutSeconds 1
)
if (
  $persistentRemaining.Count -ne 1 -or
  [string]$persistentRemaining[0].reason -ne "process_did_not_exit"
) {
  throw "A persistent exact child was not reported with its stable exit failure."
}

$replacementAfterRequestRemaining = @(
  Stop-PantheonCapturedProcesses -Snapshots @($expectedReplacementAfterRequest) -TimeoutSeconds 1
)
if (
  $replacementAfterRequestRemaining.Count -ne 0 -or
  [int]$script:RequestCalls[$replacementAfterRequestPid] -ne 1
) {
  throw "A replacement observed after the exact stop request was targeted a second time."
}

$initialReusedRemaining = @(
  Stop-PantheonCapturedProcesses -Snapshots @($expectedInitialReused) -TimeoutSeconds 1
)
if ($initialReusedRemaining.Count -ne 0 -or [int]$script:RequestCalls[$initialReusedPid] -ne 1) {
  throw "A PID reused before handle-bound termination was not safely ignored."
}

$identityMismatchRemaining = @(
  Stop-PantheonCapturedProcesses -Snapshots @($expectedIdentityMismatch) -TimeoutSeconds 1
)
if (
  $identityMismatchRemaining.Count -ne 1 -or
  [string]$identityMismatchRemaining[0].reason -ne "executable_path_changed"
) {
  throw "A same-creation executable mismatch did not fail closed."
}

$unreadableRemaining = @(
  Stop-PantheonCapturedProcesses -Snapshots @($expectedUnreadable) -TimeoutSeconds 1
)
if (
  $unreadableRemaining.Count -ne 1 -or
  [string]$unreadableRemaining[0].reason -ne "process_identity_unreadable" -or
  [int]$script:RequestCalls[$unreadablePid] -lt 2
) {
  throw "A live process with unreadable identity did not fail closed."
}

$batchStartedAt = [DateTime]::UtcNow
$batchRemaining = @(
  Stop-PantheonCapturedProcesses -Snapshots @(
    $expectedPersistent,
    $expectedSecondPersistent,
    $expectedTerminationFailed
  ) -TimeoutSeconds 1
)
$batchElapsedMilliseconds = ([DateTime]::UtcNow - $batchStartedAt).TotalMilliseconds
if (
  $batchRemaining.Count -ne 3 -or
  $batchElapsedMilliseconds -gt 1800
) {
  throw "Captured children were not bounded by one shared shutdown deadline."
}
$terminationFailure = @($batchRemaining | Where-Object { [int]$_.pid -eq $terminationFailedPid })
$formattedFailure = Format-PantheonCapturedProcessFailures -Failures $terminationFailure
if (
  $terminationFailure.Count -ne 1 -or
  [string]$terminationFailure[0].reason -ne "terminate_process_failed" -or
  $formattedFailure -notmatch "state=exact" -or
  $formattedFailure -notmatch "reason=terminate_process_failed" -or
  $formattedFailure -notmatch "win32=5"
) {
  throw "A persistent native termination failure did not retain actionable diagnostics."
}

$unreadableRootMetadata = [pscustomobject]@{
  pid = $unreadablePid
  processStartFileTimeUtc = "100"
  executablePath = "C:\Program Files\nodejs\node.exe"
}
$unreadableRootOwnership = Test-PantheonProcessOwnership -Metadata $unreadableRootMetadata -Port 5051
if ($unreadableRootOwnership.reason -ne "process_identity_unreadable") {
  throw "A live root with unreadable identity was mistaken for an exited process."
}

$unreadableSupervisorMetadata = [pscustomobject]@{
  pid = $unreadablePid
  processStartFileTimeUtc = "100"
  executablePath = "C:\Program Files\nodejs\node.exe"
  controlPort = 5050
  workspaceRoot = (Split-Path -Parent $PSScriptRoot)
}
$unreadableSupervisorOwnership = Test-PantheonSupervisorOwnership -Metadata $unreadableSupervisorMetadata -Port 5050 -WorkspaceRoot (Split-Path -Parent $PSScriptRoot)
if ($unreadableSupervisorOwnership.reason -ne "supervisor_identity_unreadable") {
  throw "A live supervisor with unreadable identity was mistaken for an exited process."
}
`;

test("OpenAI credentials persist outside the repository and ignore unreadable legacy recovery fields", {
  skip: process.platform !== "win32",
  timeout: 60_000,
}, async (context) => {
  const root = makeLauncherWorkspace("credential-store");
  let port = await freePort();
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
    fs.appendFileSync(
      path.join(root, "scripts", "pantheon-launcher-common.ps1"),
      transientProcessSnapshotProbe,
    );

    const startPantheon = (candidatePort) => runPowerShell(
      path.join(root, "scripts", "start-pantheon.ps1"),
      ["-Port", candidatePort, "-NoOpen", "-ReadyTimeoutSeconds", "5"],
      root,
      true,
      { PANTHEON_TEST_TRANSIENT_SNAPSHOT: "1" },
      true,
    );
    let started = await startPantheon(port);
    let failureDetails = launcherFailureDetails(root, port, started);
    if (
      started.code !== 0
      && /Port \d+ is already in use by a process Pantheon does not own/i.test(failureDetails)
    ) {
      context.diagnostic(`Windows reclaimed test port ${port}; retrying once on a newly verified port.`);
      port = await freePort();
      started = await startPantheon(port);
      failureDetails = launcherFailureDetails(root, port, started);
    }
    assert.equal(started.code, 0, failureDetails);
    const health = await fetchWithDeadline(
      `http://127.0.0.1:${port}/api/health`,
    ).then((response) => response.json());
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

async function portAvailable(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.listen(port, "127.0.0.1", () => {
      server.close(() => resolve(true));
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

async function waitForCondition(condition, message, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(message);
}

async function startControlSession(root, controlPort, workingPort, suffix, extraEnv = {}) {
  const operatorUrlPath = path.join(root, "tmp", `control-url-${suffix}.txt`);
  const result = await runPowerShell(
    path.join(root, "scripts", "start-pantheon-control.ps1"),
    [
      "-Port",
      controlPort,
      "-WorkingPort",
      workingPort,
      "-NoOpen",
      "-LifecycleProof",
      "-OperatorUrlFile",
      operatorUrlPath,
      "-StartupTimeoutSeconds",
      "8",
    ],
    root,
    true,
    extraEnv,
    true,
    20_000,
  );
  assert.equal(result.code, 0, `${result.stdout}\n${result.stderr}`);

  const operatorUrl = fs.readFileSync(operatorUrlPath, "utf8").trim();
  const parsedUrl = new URL(operatorUrl);
  const bootstrap = new URLSearchParams(parsedUrl.hash.slice(1)).get("bootstrap");
  assert.ok(bootstrap);
  const origin = `http://127.0.0.1:${controlPort}`;
  const sessionResponse = await fetchWithDeadline(`${origin}/api/session`, {
    method: "POST",
    headers: { "content-type": "application/json", origin },
    body: JSON.stringify({ bootstrap }),
  });
  const sessionBody = await sessionResponse.text();
  assert.equal(sessionResponse.status, 201, sessionBody);
  const session = JSON.parse(sessionBody);
  const cookie = sessionResponse.headers.get("set-cookie").split(";")[0];
  return { origin, session, cookie };
}

async function startWorkingFromControl(controlSession, workingPort) {
  const response = await fetchWithDeadline(
    `${controlSession.origin}/api/control/start`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: controlSession.origin,
        cookie: controlSession.cookie,
        "x-pantheon-csrf": controlSession.session.csrfToken,
      },
      body: "{}",
    },
    workingStartRequestTimeoutMs,
  );
  const responseBody = await response.text();
  assert.equal(response.status, 200, responseBody);
  const result = JSON.parse(responseBody);
  assert.match(result.operatorUrl, new RegExp(`^http://127\\.0\\.0\\.1:${workingPort}/`));
}

async function cleanupWorkspace(root) {
  if (!root) return;
  const cleanupFailures = [];
  const stopScript = path.join(root, "scripts", "stop-pantheon.ps1");
  if (fs.existsSync(stopScript)) {
    const stopped = await runPowerShell(
      stopScript,
      ["-All", "-GracefulTimeoutSeconds", "1"],
      root,
      true,
    ).catch((error) => ({ code: 1, stdout: "", stderr: error.message }));
    if (stopped.code !== 0) {
      cleanupFailures.push(`launcher stop failed:\n${stopped.stdout}\n${stopped.stderr}`);
    }
  }
  if (!cleanupFailures.length) {
    try {
      fs.rmSync(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
    } catch (error) {
      cleanupFailures.push(`launcher workspace removal failed:\n${error.message}`);
    }
  }
  if (cleanupFailures.length) {
    throw new Error(cleanupFailures.join("\n"));
  }
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

test("standalone shutdown refuses an unsafe partial forced tree stop and succeeds on a graceful retry", {
  skip: process.platform !== "win32",
  timeout: 60_000,
}, async () => {
  const root = makeLauncherWorkspace("standalone-forced-stop");
  const port = await freePort();
  const hangPath = path.join(root, "tmp", `fake-hang-${port}`);
  let metadata = null;
  let childPid = null;
  try {
    const started = await runPowerShell(
      path.join(root, "scripts", "start-pantheon.ps1"),
      ["-Port", port, "-NoOpen", "-ReadyTimeoutSeconds", "5"],
      root,
      true,
    );
    assert.equal(started.code, 0, `${started.stdout}\n${started.stderr}`);
    const metadataPath = path.join(root, "tmp", `pantheon-server-${port}.json`);
    metadata = JSON.parse(fs.readFileSync(metadataPath, "utf8"));
    childPid = Number(fs.readFileSync(path.join(root, "tmp", `fake-child-${port}.pid`), "utf8"));
    fs.writeFileSync(hangPath, "hold graceful exit for forced-stop proof\n");

    const refused = await runPowerShell(
      path.join(root, "scripts", "stop-pantheon.ps1"),
      ["-Port", port, "-GracefulTimeoutSeconds", "1"],
      root,
      true,
      {},
      true,
    );
    assert.notEqual(refused.code, 0);
    assert.match(`${refused.stdout}\n${refused.stderr}`, /forced_tree_stop_requires_supervisor/);
    assert.equal(processAlive(metadata.pid), true, "standalone root must remain owned after refusal");
    assert.equal(processAlive(childPid), true, "standalone child must not be partially stopped");
    assert.equal(fs.existsSync(metadataPath), true, "ownership metadata must remain for retry");

    fs.rmSync(hangPath, { force: true });
    const stopped = await runPowerShell(
      path.join(root, "scripts", "stop-pantheon.ps1"),
      ["-Port", port, "-GracefulTimeoutSeconds", "2"],
      root,
      true,
    );
    assert.equal(stopped.code, 0, `${stopped.stdout}\n${stopped.stderr}`);
    assert.equal(await waitForExit(metadata.pid), true);
    assert.equal(await waitForExit(childPid), true);
  } finally {
    fs.rmSync(hangPath, { force: true });
    await cleanupWorkspace(root);
  }
});

test("reused root cleanup stops exact recorded children without touching the replacement", {
  skip: process.platform !== "win32",
  timeout: 60_000,
}, async () => {
  const root = makeLauncherWorkspace("reused-root-recorded-child");
  const port = await freePort();
  const hangPath = path.join(root, "tmp", `fake-hang-${port}`);
  const metadataPath = path.join(root, "tmp", `pantheon-server-${port}.json`);
  let originalMetadata = null;
  let childPid = null;
  let replacement = null;
  try {
    const started = await runPowerShell(
      path.join(root, "scripts", "start-pantheon.ps1"),
      ["-Port", port, "-NoOpen", "-ReadyTimeoutSeconds", "5"],
      root,
      true,
    );
    assert.equal(started.code, 0, `${started.stdout}\n${started.stderr}`);
    originalMetadata = JSON.parse(fs.readFileSync(metadataPath, "utf8"));
    childPid = Number(fs.readFileSync(path.join(root, "tmp", `fake-child-${port}.pid`), "utf8"));
    fs.writeFileSync(hangPath, "retain process tree for retry proof\n");

    const refused = await runPowerShell(
      path.join(root, "scripts", "stop-pantheon.ps1"),
      ["-Port", port, "-GracefulTimeoutSeconds", "1"],
      root,
      true,
      {},
      true,
    );
    assert.notEqual(refused.code, 0);
    const retainedMetadata = JSON.parse(fs.readFileSync(metadataPath, "utf8"));
    assert.ok(retainedMetadata.shutdownDescendants.some((item) => item.pid === childPid));

    process.kill(originalMetadata.pid);
    assert.equal(await waitForExit(originalMetadata.pid), true);
    assert.equal(processAlive(childPid), true, "recorded child must survive until exact retry cleanup");
    replacement = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
      stdio: "ignore",
      windowsHide: true,
    });
    replacement.unref();
    retainedMetadata.pid = replacement.pid;
    retainedMetadata.executablePath = process.execPath;
    retainedMetadata.processStartFileTimeUtc = "1";
    fs.writeFileSync(metadataPath, JSON.stringify(retainedMetadata));
    fs.rmSync(hangPath, { force: true });

    const cleaned = await runPowerShell(
      path.join(root, "scripts", "stop-pantheon.ps1"),
      ["-Port", port, "-GracefulTimeoutSeconds", "2"],
      root,
      true,
    );
    assert.equal(cleaned.code, 0, `${cleaned.stdout}\n${cleaned.stderr}`);
    assert.equal(await waitForExit(childPid), true, "exact recorded child was not cleaned up");
    assert.equal(processAlive(replacement.pid), true, "reused-PID replacement must remain untouched");
    assert.equal(fs.existsSync(metadataPath), false);
  } finally {
    fs.rmSync(hangPath, { force: true });
    if (replacement && processAlive(replacement.pid)) process.kill(replacement.pid);
    if (originalMetadata && processAlive(originalMetadata.pid)) process.kill(originalMetadata.pid);
    await cleanupWorkspace(root);
  }
});

test("captured child shutdown handles exit races without touching replacement processes", {
  skip: process.platform !== "win32",
  timeout: 15_000,
}, async () => {
  const root = makeLauncherWorkspace("captured-process-stop-race");
  try {
    const proofPath = path.join(root, "scripts", "captured-process-stop-race-proof.ps1");
    fs.writeFileSync(proofPath, capturedProcessStopRaceProof);
    const result = await runPowerShell(proofPath, [], root, true);
    assert.equal(result.code, 0, `${result.stdout}\n${result.stderr}`);
  } finally {
    await cleanupWorkspace(root);
  }
});

async function runSupervisorCycleProof(context, name, crashFirstCycle) {
  const root = makeLauncherWorkspace(name);
  const controlPort = await freePort();
  const workingPort = await freePort();
  if (crashFirstCycle) {
    fs.appendFileSync(
      path.join(root, "scripts", "pantheon-launcher-common.ps1"),
      transientProcessSnapshotProbe,
    );
    const standbyPath = path.join(root, "scripts", "pantheon-standby.js");
    const standbySource = fs.readFileSync(standbyPath, "utf8");
    const shutdownLine = "    stopControlShell({ removeMetadata: false });";
    assert.equal(standbySource.includes(shutdownLine), true);
    fs.writeFileSync(
      standbyPath,
      standbySource.replace(
        shutdownLine,
        [
          "    if (!fs.existsSync(path.join(stateRoot, `fake-control-hang-${port}`))) {",
          "      stopControlShell({ removeMetadata: false });",
          "    }",
        ].join("\n"),
      ),
    );
  }
  const unrelated = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
    stdio: "ignore",
    windowsHide: true,
  });
  unrelated.unref();

  let proofError = null;
  let cleanupError = null;
  try {
    for (let cycle = 1; cycle <= 5; cycle += 1) {
      const cycleStartedAt = Date.now();
      const cycleLabel = `${name}, cycle ${cycle}`;
      process.stderr.write(`[windows-lifecycle] ${cycleLabel} started.\n`);
      const controlSession = await startControlSession(
        root,
        controlPort,
        workingPort,
        `${name}-${cycle}`,
        crashFirstCycle && cycle === 1
          ? { PANTHEON_TEST_TRANSIENT_SNAPSHOT: "1" }
          : {},
      );
      const controlMetadataPath = path.join(root, "tmp", `pantheon-server-${controlPort}.json`);
      const supervisorMetadataPath = path.join(root, "tmp", `pantheon-supervisor-${controlPort}.json`);
      const controlMetadata = JSON.parse(fs.readFileSync(controlMetadataPath, "utf8"));
      const supervisorMetadata = JSON.parse(fs.readFileSync(supervisorMetadataPath, "utf8"));
      assert.equal(controlMetadata.supervised, true);
      assert.equal(controlMetadata.pid, supervisorMetadata.childPid);
      assert.ok(processAlive(controlMetadata.pid));
      assert.ok(processAlive(supervisorMetadata.pid));

      const standbyHealth = await fetchWithDeadline(`${controlSession.origin}/api/health`).then(
        (response) => response.json(),
      );
      assert.ok(
        standbyHealth.memoryMb < 100,
        `${cycleLabel} used ${standbyHealth.memoryMb} MB`,
      );

      await startWorkingFromControl(controlSession, workingPort);
      const workingMetadataPath = path.join(root, "tmp", `pantheon-server-${workingPort}.json`);
      await waitForCondition(
        () => fs.existsSync(workingMetadataPath),
        `${cycleLabel} did not create working ownership metadata`,
      );
      const workingMetadata = JSON.parse(fs.readFileSync(workingMetadataPath, "utf8"));
      const workingChildPid = Number(
        fs.readFileSync(path.join(root, "tmp", `fake-child-${workingPort}.pid`), "utf8"),
      );
      assert.ok(processAlive(workingMetadata.pid));
      assert.ok(processAlive(workingChildPid));

      if (crashFirstCycle && cycle === 1) {
        process.kill(supervisorMetadata.pid);
        for (const pid of [
          supervisorMetadata.pid,
          controlMetadata.pid,
          workingMetadata.pid,
          workingChildPid,
        ]) {
          assert.equal(
            await waitForExit(pid, 10_000),
            true,
            `supervisor crash containment left process ${pid} running`,
          );
        }
        for (const cleanupPort of [workingPort, controlPort]) {
          const cleaned = await runPowerShell(
            path.join(root, "scripts", "stop-pantheon.ps1"),
            ["-Port", cleanupPort, "-GracefulTimeoutSeconds", "2"],
            root,
            true,
          );
          assert.equal(cleaned.code, 0, `${cleaned.stdout}\n${cleaned.stderr}`);
        }
      } else if (crashFirstCycle && cycle === 2) {
        const hangPath = path.join(root, "tmp", `fake-control-hang-${controlPort}`);
        fs.writeFileSync(hangPath, "hold control exit for supervised forced-stop proof\n");
        const stoppedControl = await runPowerShell(
          path.join(root, "scripts", "stop-pantheon.ps1"),
          ["-Port", controlPort, "-GracefulTimeoutSeconds", "1"],
          root,
          true,
        );
        fs.rmSync(hangPath, { force: true });
        assert.equal(stoppedControl.code, 0, `${stoppedControl.stdout}\n${stoppedControl.stderr}`);
        for (const pid of [
          supervisorMetadata.pid,
          controlMetadata.pid,
          workingMetadata.pid,
          workingChildPid,
        ]) {
          assert.equal(await waitForExit(pid, 10_000), true, `supervised forced stop left ${pid} running`);
        }
        const cleanedWorking = await runPowerShell(
          path.join(root, "scripts", "stop-pantheon.ps1"),
          ["-Port", workingPort, "-GracefulTimeoutSeconds", "2"],
          root,
          true,
        );
        assert.equal(cleanedWorking.code, 0, `${cleanedWorking.stdout}\n${cleanedWorking.stderr}`);
      } else {
        const stoppedWorking = await runPowerShell(
          path.join(root, "scripts", "stop-pantheon.ps1"),
          ["-Port", workingPort, "-GracefulTimeoutSeconds", "2"],
          root,
          true,
        );
        assert.equal(stoppedWorking.code, 0, `${stoppedWorking.stdout}\n${stoppedWorking.stderr}`);
        assert.equal(await waitForExit(workingMetadata.pid), true);
        assert.equal(await waitForExit(workingChildPid), true);
        assert.equal(processAlive(controlMetadata.pid), true);

        const stoppedControl = await runPowerShell(
          path.join(root, "scripts", "stop-pantheon.ps1"),
          ["-Port", controlPort, "-GracefulTimeoutSeconds", "2"],
          root,
          true,
        );
        assert.equal(stoppedControl.code, 0, `${stoppedControl.stdout}\n${stoppedControl.stderr}`);
        assert.equal(await waitForExit(controlMetadata.pid), true);
        assert.equal(await waitForExit(supervisorMetadata.pid), true);
      }

      await waitForCondition(
        async () => (
          await portAvailable(controlPort)
          && await portAvailable(workingPort)
        ),
        `${cycleLabel} left a lifecycle port occupied`,
      );
      assert.equal(fs.existsSync(controlMetadataPath), false);
      assert.equal(fs.existsSync(workingMetadataPath), false);
      assert.equal(fs.existsSync(supervisorMetadataPath), false);
      assert.equal(processAlive(unrelated.pid), true);
      const cycleDurationMs = Date.now() - cycleStartedAt;
      process.stderr.write(
        `[windows-lifecycle] ${cycleLabel} completed in ${cycleDurationMs} ms.\n`,
      );
      context.diagnostic(
        `${cycleLabel} completed in ${cycleDurationMs} ms `
        + "without an owned process or port leak",
      );
    }
  } catch (error) {
    proofError = error;
  } finally {
    if (processAlive(unrelated.pid)) process.kill(unrelated.pid);
    try {
      await cleanupWorkspace(root);
    } catch (error) {
      cleanupError = error;
    }
  }
  if (proofError && cleanupError) {
    throw new AggregateError(
      [proofError, cleanupError],
      "Windows supervisor proof and its accountable cleanup both failed.",
    );
  }
  if (cleanupError) throw cleanupError;
  if (proofError) throw proofError;
}

test("Windows supervisor contains the full runtime tree across five control cycles", {
  skip: process.platform !== "win32" || lifecyclePhase === "repeat",
  timeout: 420_000,
}, async (context) => {
  await runSupervisorCycleProof(context, "supervisor-containment", true);
});

test("Windows supervisor repeats five additional control cycles without leaks", {
  skip: process.platform !== "win32" || lifecyclePhase === "containment",
  timeout: 420_000,
}, async (context) => {
  await runSupervisorCycleProof(context, "supervisor-repeat", false);
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
    const health = await fetchWithDeadline(
      `http://127.0.0.1:${port}/api/health`,
    ).then((response) => response.json());
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
  assert.match(startCommand, /start-pantheon-control\.ps1/i);
});
