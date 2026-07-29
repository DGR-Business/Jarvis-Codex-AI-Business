const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { DatabaseSync } = require("node:sqlite");
const {
  backupKeyId,
  createBackup,
  readEncryptedHeader,
  requiredPassphrase,
  restoreBackup,
  validateRecoverySetDirectory,
  verifyBackup,
} = require("../src/runtime/backup");

const PASSPHRASE = "pantheon-test-passphrase-32-characters";

function tempRoot(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `pantheon-backup-${name}-`));
}

function createRecoveryFixture(name) {
  const root = tempRoot(name);
  const sourceRoot = path.join(root, "workspace");
  const dbPath = path.join(sourceRoot, "data", "runtime.sqlite");
  const artifactRoot = path.join(sourceRoot, "data", "artifacts");
  const approvalPackRoot = path.join(sourceRoot, "output", "pdf");
  const privateOperatorRoot = path.join(sourceRoot, "private");
  const destinationRoot = path.join(root, "backups");

  fs.mkdirSync(path.join(sourceRoot, "src"), { recursive: true });
  fs.mkdirSync(artifactRoot, { recursive: true });
  fs.mkdirSync(approvalPackRoot, { recursive: true });
  fs.mkdirSync(privateOperatorRoot, { recursive: true });
  fs.writeFileSync(path.join(sourceRoot, "src", "pantheon.js"), "module.exports = 'ready';\n");
  fs.writeFileSync(path.join(sourceRoot, "package.json"), JSON.stringify({ name: "fixture" }));
  fs.writeFileSync(path.join(artifactRoot, "commercial-brief.md"), "verified runtime artifact\n");
  fs.writeFileSync(path.join(approvalPackRoot, "operator-pack.pdf"), "fixture pdf bytes\n");
  fs.writeFileSync(
    path.join(privateOperatorRoot, "operator-reference.txt"),
    "PRIVATE-KYC-REFERENCE-MARKER\n",
  );
  fs.writeFileSync(
    path.join(privateOperatorRoot, "runtime-credentials.json"),
    JSON.stringify({ backupPassphraseProtected: "CIRCULAR-RECOVERY-SECRET-MARKER" }),
  );

  const db = new DatabaseSync(dbPath);
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE ventures (id TEXT PRIMARY KEY, title TEXT NOT NULL);
    CREATE TABLE results (
      id TEXT PRIMARY KEY,
      venture_id TEXT NOT NULL REFERENCES ventures(id)
    );
    INSERT INTO ventures VALUES ('venture-proof', 'Recovery proof');
    INSERT INTO results VALUES ('result-proof', 'venture-proof');
  `);
  db.close();

  return {
    root,
    sourceRoot,
    dbPath,
    artifactRoot,
    approvalPackRoot,
    privateOperatorRoot,
    destinationRoot,
  };
}

async function createRecoverySet(fixture, options = {}) {
  return createBackup({
    kind: "set",
    sourceRoot: fixture.sourceRoot,
    dbPath: fixture.dbPath,
    artifactRoot: fixture.artifactRoot,
    approvalPackRoot: fixture.approvalPackRoot,
    privateOperatorRoot: fixture.privateOperatorRoot,
    destinationRoot: fixture.destinationRoot,
    passphrase: PASSPHRASE,
    createdAt: options.createdAt || "2026-07-18T02:00:00.000Z",
  });
}

test("one encrypted recovery set restores source, database, artifacts, packs and private references", async () => {
  const fixture = createRecoveryFixture("complete-set");
  try {
    const backup = await createRecoverySet(fixture);
    assert.equal(backup.kind, "set");
    assert.match(path.basename(backup.destinationPath), /^pantheon-recovery-set-/);
    const header = readEncryptedHeader(backup.destinationPath).header;
    assert.equal(header.setId, backup.setId);
    assert.equal(header.manifestSha256, backup.manifestSha256);
    assert.equal(header.keyId, backupKeyId(PASSPHRASE));
    assert.equal(
      fs.readFileSync(backup.destinationPath).includes(Buffer.from("PRIVATE-KYC-REFERENCE-MARKER")),
      false,
    );

    const verification = await verifyBackup(backup.destinationPath, { passphrase: PASSPHRASE });
    assert.equal(verification.verified, true);
    assert.equal(verification.recoverySet.setId, backup.setId);
    assert.equal(verification.recoverySet.sqlite.integrityCheck, "ok");
    assert.equal(verification.recoverySet.components.source.present, true);
    assert.equal(verification.recoverySet.components.database.fileCount, 1);
    assert.equal(verification.recoverySet.components.runtimeArtifacts.present, true);
    assert.equal(verification.recoverySet.components.approvalPacks.present, true);
    assert.equal(verification.recoverySet.components.privateOperatorReferences.present, true);

    const restoredRoot = path.join(fixture.root, "restored-workspace");
    const restored = await restoreBackup(backup.destinationPath, restoredRoot, {
      passphrase: PASSPHRASE,
    });
    assert.equal(restored.recoverySet.setId, backup.setId);
    assert.equal(fs.readFileSync(path.join(restoredRoot, "src", "pantheon.js"), "utf8"), "module.exports = 'ready';\n");
    assert.equal(
      fs.readFileSync(path.join(restoredRoot, "data", "artifacts", "commercial-brief.md"), "utf8"),
      "verified runtime artifact\n",
    );
    assert.equal(
      fs.readFileSync(path.join(restoredRoot, "output", "pdf", "operator-pack.pdf"), "utf8"),
      "fixture pdf bytes\n",
    );
    assert.equal(
      fs.readFileSync(path.join(restoredRoot, "private", "operator-reference.txt"), "utf8"),
      "PRIVATE-KYC-REFERENCE-MARKER\n",
    );
    assert.equal(fs.existsSync(path.join(restoredRoot, "private", "runtime-credentials.json")), false);
    assert.equal(fs.existsSync(path.join(restoredRoot, ".pantheon-recovery", "manifest.json")), true);
    assert.equal(fs.existsSync(path.join(restoredRoot, ".pantheon-recovery", "restore-verification.json")), true);

    const restoredDb = new DatabaseSync(path.join(restoredRoot, "data", "runtime.sqlite"), { readOnly: true });
    assert.equal(restoredDb.prepare("SELECT title FROM ventures").get().title, "Recovery proof");
    restoredDb.close();
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("recovery verification rejects encrypted tampering and post-restore inventory drift", async () => {
  const fixture = createRecoveryFixture("tamper");
  try {
    const backup = await createRecoverySet(fixture);
    const tamperedPath = path.join(fixture.destinationRoot, "tampered.jbackup");
    const tampered = Buffer.from(fs.readFileSync(backup.destinationPath));
    tampered[tampered.length - 24] ^= 1;
    fs.writeFileSync(tamperedPath, tampered);
    await assert.rejects(
      verifyBackup(tamperedPath, { passphrase: PASSPHRASE }),
      /could not be decrypted or authenticated/,
    );

    const occupiedDestination = path.join(fixture.root, "occupied");
    fs.mkdirSync(occupiedDestination);
    fs.writeFileSync(path.join(occupiedDestination, "keep.txt"), "existing destination");
    await assert.rejects(
      restoreBackup(backup.destinationPath, occupiedDestination, { passphrase: PASSPHRASE }),
      /destination already exists/,
    );
    assert.equal(
      fs.readFileSync(path.join(occupiedDestination, "keep.txt"), "utf8"),
      "existing destination",
    );

    const restoredRoot = path.join(fixture.root, "restored");
    await restoreBackup(backup.destinationPath, restoredRoot, { passphrase: PASSPHRASE });
    fs.writeFileSync(path.join(restoredRoot, "src", "unmanifested-file.txt"), "unexpected");
    assert.throws(
      () => validateRecoverySetDirectory(restoredRoot),
      /inventory does not match/,
    );
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("Pantheon backup passphrase takes precedence while the Jarvis alias remains compatible", () => {
  const previousPantheon = process.env.PANTHEON_BACKUP_PASSPHRASE;
  const previousJarvis = process.env.JARVIS_BACKUP_PASSPHRASE;
  try {
    process.env.PANTHEON_BACKUP_PASSPHRASE = "pantheon-preferred-passphrase";
    process.env.JARVIS_BACKUP_PASSPHRASE = "jarvis-legacy-passphrase-value";
    assert.equal(requiredPassphrase(), "pantheon-preferred-passphrase");

    delete process.env.PANTHEON_BACKUP_PASSPHRASE;
    assert.equal(requiredPassphrase(), "jarvis-legacy-passphrase-value");
  } finally {
    if (previousPantheon === undefined) delete process.env.PANTHEON_BACKUP_PASSPHRASE;
    else process.env.PANTHEON_BACKUP_PASSPHRASE = previousPantheon;
    if (previousJarvis === undefined) delete process.env.JARVIS_BACKUP_PASSPHRASE;
    else process.env.JARVIS_BACKUP_PASSPHRASE = previousJarvis;
  }
});

test("backup and restore CLIs create one coherent set by default and support verify-only", async () => {
  const fixture = createRecoveryFixture("cli");
  try {
    const environment = {
      ...process.env,
      PANTHEON_BACKUP_PASSPHRASE: PASSPHRASE,
      JARVIS_BACKUP_PASSPHRASE: "",
    };
    const backupRun = spawnSync(
      process.execPath,
      [
        path.join(__dirname, "..", "scripts", "backup-runtime.js"),
        "--kind", "all",
        "--destination", fixture.destinationRoot,
        "--source-root", fixture.sourceRoot,
        "--database", fixture.dbPath,
        "--artifacts", fixture.artifactRoot,
        "--approval-packs", fixture.approvalPackRoot,
        "--private-operator", fixture.privateOperatorRoot,
      ],
      {
        encoding: "utf8",
        env: environment,
        windowsHide: true,
        timeout: 120_000,
      },
    );
    assert.equal(backupRun.status, 0, backupRun.stderr);
    const backupReport = JSON.parse(backupRun.stdout);
    assert.equal(backupReport.ok, true);
    assert.equal(backupReport.mode, "coherent-recovery-set");
    assert.equal(backupReport.backups.length, 1);
    assert.equal(backupReport.backups[0].kind, "set");
    assert.equal(backupReport.backups[0].verification.verified, true);

    const backupPath = backupReport.backups[0].destinationPath;
    const verifyRun = spawnSync(
      process.execPath,
      [
        path.join(__dirname, "..", "scripts", "restore-runtime.js"),
        "--source", backupPath,
        "--verify-only",
      ],
      {
        encoding: "utf8",
        env: environment,
        windowsHide: true,
        timeout: 120_000,
      },
    );
    assert.equal(verifyRun.status, 0, verifyRun.stderr);
    const verifyReport = JSON.parse(verifyRun.stdout);
    assert.equal(verifyReport.ok, true);
    assert.equal(verifyReport.mode, "verify-only");
    assert.equal(verifyReport.recoverySet.sqlite.quickCheck, "ok");

    const restoredRoot = path.join(fixture.root, "cli-restored");
    const restoreRun = spawnSync(
      process.execPath,
      [
        path.join(__dirname, "..", "scripts", "restore-runtime.js"),
        "--source", backupPath,
        "--destination", restoredRoot,
      ],
      {
        encoding: "utf8",
        env: environment,
        windowsHide: true,
        timeout: 120_000,
      },
    );
    assert.equal(restoreRun.status, 0, restoreRun.stderr);
    assert.equal(fs.existsSync(path.join(restoredRoot, "data", "runtime.sqlite")), true);
    assert.equal(fs.existsSync(path.join(restoredRoot, "private", "operator-reference.txt")), true);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});
