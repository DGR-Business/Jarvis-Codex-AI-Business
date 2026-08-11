const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const workspaceRoot = path.resolve(__dirname, "..");
const helperPath = path.join(workspaceRoot, "scripts", "copy-pantheon-recovery-passphrase.ps1");
const procedurePath = path.join(workspaceRoot, "docs", "operator", "RECOVERY-KEY-CUSTODY.md");
const powershell = path.join(
  process.env.SystemRoot || "C:\\Windows",
  "System32",
  "WindowsPowerShell",
  "v1.0",
  "powershell.exe",
);

function runPowerShell(script, args, cwd, extraEnv = {}, timeoutMs = 10_000) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      powershell,
      ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", script, ...args],
      {
        cwd,
        env: { ...process.env, ...extraEnv },
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      if (error) reject(error);
      else resolve(result);
    };
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", (error) => finish(error));
    child.once("close", (code) => finish(null, { code, stdout, stderr }));
    const deadline = setTimeout(() => {
      child.kill("SIGKILL");
      finish(new Error(`PowerShell helper exceeded its ${timeoutMs}-millisecond test deadline.`));
    }, timeoutMs);
  });
}

test("recovery clipboard helper keeps the transfer narrow and history-excluded", () => {
  const source = fs.readFileSync(helperPath, "utf8");

  assert.match(source, /ExcludeClipboardContentFromMonitorProcessing/);
  assert.match(source, /CanIncludeInClipboardHistory/);
  assert.match(source, /CanUploadToCloudClipboard/);
  assert.match(source, /PantheonRecoveryPassphraseClipboard\/v1/);
  assert.match(source, /ClearIfTransferMarked/);
  assert.match(source, /-FailsafeClear -TransferId \$TransferId/);
  assert.match(source, /Start-Sleep -Seconds 60/);
  assert.match(source, /-WindowStyle Hidden/);
  assert.match(source, /ClearIfMarked/);
  assert.match(source, /CreateWindowEx/);
  assert.match(source, /HwndMessage/);
  assert.match(source, /OpenClipboard\(ownerWindow\)/);
  assert.doesNotMatch(source, /OpenClipboard\(IntPtr\.Zero\)/);
  assert.doesNotMatch(source, /Read-PantheonRecoveryCredential/);
  assert.doesNotMatch(source, /privacyHashKey|legacyBackupKeys|legacyPassphrase/i);
  assert.doesNotMatch(source, /Get-Clipboard|GetText|ContainsText/);
  assert.doesNotMatch(source, /text \+ "\\0"/);
  assert.match(source, /ConvertTo-SecureString \$Profile\.protectedValue/);
  assert.match(source, /Get-PantheonBackupKeyId -Passphrase \$plaintext/);

  const exclusions = source.indexOf("SetRegisteredBytes(ExcludeMonitorFormat");
  const plaintext = source.indexOf("SetUnicodeText(text)");
  assert.ok(exclusions >= 0 && plaintext > exclusions, "clipboard exclusions must precede plaintext");

  const credentialImport = source.lastIndexOf('. (Join-Path $PSScriptRoot "pantheon-credential-store.ps1")');
  const profileRead = source.indexOf("$profile = Read-PantheonActiveRecoveryProfile");
  assert.ok(credentialImport >= 0 && profileRead > credentialImport, "credential helpers must load in copy scope");

  const failsafeStart = source.lastIndexOf("Start-PantheonClipboardFailsafe");
  const unprotect = source.lastIndexOf("Unprotect-PantheonActiveRecoveryPassphrase");
  assert.ok(failsafeStart >= 0 && unprotect > failsafeStart, "failsafe must start before plaintext is materialized");
});

test("recovery custody procedure uses a reserved site and a masked-only proof", () => {
  const procedure = fs.readFileSync(procedurePath, "utf8");

  assert.match(procedure, /https:\/\/pantheon-recovery\.invalid/);
  assert.match(procedure, /pantheon-backup-key-<active-key-id>/);
  assert.match(procedure, /masked/i);
  assert.match(procedure, /2-Step Verification/);
  assert.match(procedure, /-EntryMetadata/);
  assert.match(procedure, /-Clear/);
  assert.doesNotMatch(procedure, /export.*csv|csv.*export/i);
});

test("recovery clipboard helper checks disposable profile metadata without changing clipboard", {
  skip: process.platform !== "win32",
  timeout: 30_000,
}, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pantheon-recovery-clipboard-"));
  const scripts = path.join(root, "scripts");
  const credentialRoot = path.join(root, "credentials");
  const backupDestination = path.join(root, "backups");
  const activePassphrase = `test-only-active-${"a".repeat(48)}`;
  const legacyPassphrase = `test-only-legacy-${"b".repeat(48)}`;
  fs.mkdirSync(scripts, { recursive: true });

  for (const name of [
    "pantheon-credential-store.ps1",
    "configure-pantheon-recovery.ps1",
    "copy-pantheon-recovery-passphrase.ps1",
  ]) {
    fs.copyFileSync(path.join(workspaceRoot, "scripts", name), path.join(scripts, name));
  }

  const environment = {
    PANTHEON_CREDENTIAL_ROOT: credentialRoot,
    PANTHEON_BACKUP_PASSPHRASE: activePassphrase,
    JARVIS_BACKUP_PASSPHRASE: legacyPassphrase,
  };

  try {
    const configured = await runPowerShell(
      path.join(scripts, "configure-pantheon-recovery.ps1"),
      ["-Destination", backupDestination],
      root,
      environment,
    );
    assert.equal(configured.code, 0, configured.stderr);

    const profile = JSON.parse(fs.readFileSync(path.join(credentialRoot, "recovery-credential.json"), "utf8"));
    const inspected = await runPowerShell(
      path.join(scripts, "copy-pantheon-recovery-passphrase.ps1"),
      ["-Copy", "-WhatIf"],
      root,
      environment,
    );
    const output = `${inspected.stdout}\n${inspected.stderr}`;

    assert.equal(inspected.code, 0, output);
    assert.match(output, /not started|what if/i);
    assert.doesNotMatch(output, new RegExp(activePassphrase));
    assert.doesNotMatch(output, new RegExp(legacyPassphrase));
    assert.doesNotMatch(output, new RegExp(profile.activeBackupKeyId));

    const entryMetadata = await runPowerShell(
      path.join(scripts, "copy-pantheon-recovery-passphrase.ps1"),
      ["-EntryMetadata"],
      root,
      environment,
    );
    const entryOutput = `${entryMetadata.stdout}\n${entryMetadata.stderr}`;
    assert.equal(entryMetadata.code, 0, entryOutput);
    assert.match(entryOutput, /Website: https:\/\/pantheon-recovery\.invalid/);
    assert.match(entryOutput, new RegExp(`Username: pantheon-backup-key-${profile.activeBackupKeyId}`));
    assert.doesNotMatch(entryOutput, new RegExp(activePassphrase));
    assert.doesNotMatch(entryOutput, new RegExp(legacyPassphrase));

    const cleared = await runPowerShell(
      path.join(scripts, "copy-pantheon-recovery-passphrase.ps1"),
      ["-Clear", "-WhatIf"],
      root,
      environment,
    );
    assert.equal(cleared.code, 0, cleared.stderr);
    assert.match(`${cleared.stdout}\n${cleared.stderr}`, /what if.*clear/i);

    const failsafe = await runPowerShell(
      path.join(scripts, "copy-pantheon-recovery-passphrase.ps1"),
      ["-FailsafeClear", "-TransferId", "0123456789abcdef0123456789abcdef", "-WhatIf"],
      root,
      environment,
      5_000,
    );
    assert.equal(failsafe.code, 0, failsafe.stderr);
    assert.match(`${failsafe.stdout}\n${failsafe.stderr}`, /what if.*clear/i);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
