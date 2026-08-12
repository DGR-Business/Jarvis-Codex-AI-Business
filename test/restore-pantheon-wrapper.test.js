const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "..");
const POWERSHELL = process.platform === "win32"
  ? path.join(
      process.env.SystemRoot || "C:\\Windows",
      "System32",
      "WindowsPowerShell",
      "v1.0",
      "powershell.exe",
    )
  : null;

const ACTIVE_SECRET = "synthetic-active-recovery-passphrase-1234";
const LEGACY_SECRET = "synthetic-legacy-recovery-passphrase-5678";

function createHarness() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pantheon-restore-wrapper-"));
  const wrapperPath = path.join(tempRoot, "restore-pantheon.ps1");
  const credentialStorePath = path.join(tempRoot, "pantheon-credential-store.ps1");
  const restoreRuntimePath = path.join(tempRoot, "restore-runtime.js");
  const archivePath = path.join(tempRoot, "synthetic-backup.jbackup");

  fs.copyFileSync(path.join(ROOT, "scripts", "restore-pantheon.ps1"), wrapperPath);
  fs.writeFileSync(
    credentialStorePath,
    `function Read-PantheonRecoveryCredential {
  return [pscustomobject]@{
    activeKeyId = "active-test-key"
    backupPassphrase = "${ACTIVE_SECRET}"
    legacyBackupKeys = @(
      [pscustomobject]@{
        keyId = "legacy-test-key"
        passphrase = "${LEGACY_SECRET}"
      }
    )
  }
}
`,
    "utf8",
  );
  fs.writeFileSync(
    restoreRuntimePath,
    `const expected = process.env.PANTHEON_TEST_EXPECTED_RECOVERY_KEY;
if (process.env.PANTHEON_BACKUP_PASSPHRASE !== expected) {
  process.stderr.write("synthetic authentication failure\\n");
  process.exit(7);
}
process.stdout.write(JSON.stringify({ ok: true, mode: "verify-only" }) + "\\n");
`,
    "utf8",
  );
  fs.writeFileSync(archivePath, "synthetic encrypted bytes", "utf8");

  return { tempRoot, wrapperPath, archivePath };
}

function runVerify(expectedKey, { nodeUnavailable = false } = {}) {
  const harness = createHarness();
  try {
    const escapedWrapper = harness.wrapperPath.replaceAll("'", "''");
    const escapedArchive = harness.archivePath.replaceAll("'", "''");
    const wrapperArguments = [
      "-NoLogo",
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      `$expectedPantheon = [Environment]::GetEnvironmentVariable('PANTHEON_BACKUP_PASSPHRASE', 'Process');
$expectedJarvis = [Environment]::GetEnvironmentVariable('JARVIS_BACKUP_PASSPHRASE', 'Process');
$expectedNodeWarnings = [Environment]::GetEnvironmentVariable('NODE_NO_WARNINGS', 'Process');
$wrapperFailed = $false;
${nodeUnavailable ? "$global:LASTEXITCODE = 0;" : ""}
try { & '${escapedWrapper}' -Source '${escapedArchive}' -VerifyOnly } catch { $wrapperFailed = $true; [Console]::Error.WriteLine($_.Exception.Message) }
$environmentRestored =
  [Environment]::GetEnvironmentVariable('PANTHEON_BACKUP_PASSPHRASE', 'Process') -ceq $expectedPantheon -and
  [Environment]::GetEnvironmentVariable('JARVIS_BACKUP_PASSPHRASE', 'Process') -ceq $expectedJarvis -and
  [Environment]::GetEnvironmentVariable('NODE_NO_WARNINGS', 'Process') -ceq $expectedNodeWarnings;
Write-Output "__PANTHEON_ENV_RESTORED__=$($environmentRestored.ToString().ToLowerInvariant())";
if ($wrapperFailed) { exit 1 }`,
    ];
    return spawnSync(
      POWERSHELL,
      wrapperArguments,
      {
        cwd: harness.tempRoot,
        encoding: "utf8",
        env: {
          ...process.env,
          PANTHEON_TEST_EXPECTED_RECOVERY_KEY: expectedKey,
          PANTHEON_BACKUP_PASSPHRASE: "must-be-restored-after-test",
          JARVIS_BACKUP_PASSPHRASE: "must-not-be-used",
          NODE_NO_WARNINGS: "restore-after-test",
          ...(nodeUnavailable ? { Path: harness.tempRoot, PATH: harness.tempRoot } : {}),
        },
        timeout: 20_000,
      },
    );
  } finally {
    fs.rmSync(harness.tempRoot, { recursive: true, force: true });
  }
}

function assertNoSecretOutput(result) {
  const output = `${result.stdout || ""}\n${result.stderr || ""}`;
  assert.doesNotMatch(output, new RegExp(ACTIVE_SECRET));
  assert.doesNotMatch(output, new RegExp(LEGACY_SECRET));
}

function assertEnvironmentRestored(result) {
  assert.match(result.stdout, /__PANTHEON_ENV_RESTORED__=true/);
}

test(
  "restore wrapper verifies with the active recovery key first",
  { skip: process.platform !== "win32" },
  () => {
    const result = runVerify(ACTIVE_SECRET);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /active-test-key \(active\)/);
    assertEnvironmentRestored(result);
    assertNoSecretOutput(result);
  },
);

test(
  "restore wrapper advances from active-key native stderr to a retained legacy key",
  { skip: process.platform !== "win32" },
  () => {
    const result = runVerify(LEGACY_SECRET);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /legacy-test-key \(legacy-restore-only\)/);
    assert.doesNotMatch(result.stdout, /synthetic authentication failure/);
    assertEnvironmentRestored(result);
    assertNoSecretOutput(result);
  },
);

test(
  "restore wrapper fails closed when no recovery key authenticates",
  { skip: process.platform !== "win32" },
  () => {
    const result = runVerify("synthetic-nonmatching-key");
    assert.notEqual(result.status, 0);
    assert.match(
      `${result.stdout || ""}\n${result.stderr || ""}`,
      /could not authenticate this backup with its active or retained legacy recovery keys/i,
    );
    assertEnvironmentRestored(result);
    assertNoSecretOutput(result);
  },
);

test(
  "restore wrapper rejects an unavailable Node application despite a stale zero exit code",
  { skip: process.platform !== "win32" },
  () => {
    const result = runVerify(ACTIVE_SECRET, { nodeUnavailable: true });
    assert.notEqual(result.status, 0);
    assert.match(
      `${result.stdout || ""}\n${result.stderr || ""}`,
      /could not locate the Node\.js application required for recovery verification/i,
    );
    assert.doesNotMatch(result.stdout, /Verified with recovery key ID/i);
    assertEnvironmentRestored(result);
    assertNoSecretOutput(result);
  },
);
