const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { DatabaseSync } = require("node:sqlite");
const { createBackup } = require("../src/runtime/backup");
const {
  assessOperationsReady,
  checkBackupConfiguration,
  checkPricingFreshness,
  checkRecoverySet,
} = require("../scripts/doctor");

const PASSPHRASE = "pantheon-doctor-passphrase-32-characters";

test("pricing freshness warns only after the configured review window", () => {
  const fresh = checkPricingFreshness({ now: "2026-07-22T00:00:00.000Z", maxAgeDays: 30 });
  assert.equal(fresh.status, "pass");

  const stale = checkPricingFreshness({ now: "2026-09-01T00:00:00.000Z", maxAgeDays: 30 });
  assert.equal(stale.status, "warn");
  assert.match(stale.message, /older than 30 days/i);
  assert.ok(stale.details.stale.length > 0);
});

function fixtureRoot(name) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `pantheon-doctor-${name}-`));
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
  fs.writeFileSync(path.join(sourceRoot, "src", "index.js"), "module.exports = true;\n");
  fs.writeFileSync(path.join(artifactRoot, "artifact.txt"), "artifact");
  fs.writeFileSync(path.join(privateOperatorRoot, "reference.txt"), "private reference");
  const db = new DatabaseSync(dbPath);
  db.exec("CREATE TABLE proof (value TEXT NOT NULL); INSERT INTO proof VALUES ('ok');");
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

async function addSet(fixture, createdAt) {
  return createBackup({
    kind: "set",
    sourceRoot: fixture.sourceRoot,
    dbPath: fixture.dbPath,
    artifactRoot: fixture.artifactRoot,
    approvalPackRoot: fixture.approvalPackRoot,
    privateOperatorRoot: fixture.privateOperatorRoot,
    destinationRoot: fixture.destinationRoot,
    passphrase: PASSPHRASE,
    createdAt,
  });
}

test("doctor passes a recent fully verified recovery set and warns when it becomes stale", async () => {
  const fixture = fixtureRoot("fresh-stale");
  try {
    await addSet(fixture, "2026-07-18T02:00:00.000Z");
    const fresh = await checkRecoverySet({
      destinationRoot: fixture.destinationRoot,
      passphrase: PASSPHRASE,
      now: "2026-07-18T03:00:00.000Z",
      maxAgeHours: 36,
    });
    assert.equal(fresh.status, "pass");
    assert.equal(fresh.details.components.database.fileCount, 1);
    assert.equal(fresh.details.components.privateOperatorReferences.present, true);

    const stale = await checkRecoverySet({
      destinationRoot: fixture.destinationRoot,
      passphrase: PASSPHRASE,
      now: "2026-07-20T03:00:00.000Z",
      maxAgeHours: 36,
    });
    assert.equal(stale.status, "warn");
    assert.match(stale.message, /older than/);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("doctor does not treat a corrupt newer file as the latest usable recovery proof", async () => {
  const fixture = fixtureRoot("corrupt-newest");
  try {
    await addSet(fixture, "2026-07-18T02:00:00.000Z");
    const newer = await addSet(fixture, "2026-07-18T03:00:00.000Z");
    const tampered = Buffer.from(fs.readFileSync(newer.destinationPath));
    tampered[tampered.length - 20] ^= 1;
    fs.writeFileSync(newer.destinationPath, tampered);

    const report = await checkRecoverySet({
      destinationRoot: fixture.destinationRoot,
      passphrase: PASSPHRASE,
      now: "2026-07-18T04:00:00.000Z",
      maxAgeHours: 36,
    });
    assert.equal(report.status, "warn");
    assert.match(report.message, /newer backup file failed verification/);
    assert.equal(report.details.createdAt, "2026-07-18T02:00:00.000Z");
    assert.equal(report.details.invalidCount, 1);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("operations-ready requires every recovery-critical doctor check to pass", () => {
  const names = [
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
  const passing = names.map((name) => ({ name, status: "pass", message: `${name} passed.` }));
  passing.push({ name: "Dashboard port", status: "warn", message: "Pantheon is already running." });
  assert.deepEqual(assessOperationsReady(passing), {
    operationsReady: true,
    readinessBlockers: [],
  });

  const stale = passing.map((item) => (
    item.name === "Recovery set"
      ? { ...item, status: "warn", message: "Recovery set is stale." }
      : item
  ));
  const notReady = assessOperationsReady(stale);
  assert.equal(notReady.operationsReady, false);
  assert.deepEqual(notReady.readinessBlockers, ["Recovery set is stale."]);
});

test("backup configuration reports Pantheon as preferred without exposing the passphrase", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pantheon-doctor-config-"));
  try {
    const result = checkBackupConfiguration({
      destinationRoot: root,
      passphrase: PASSPHRASE,
    });
    assert.equal(result.status, "pass");
    assert.equal(result.details.preferredVariable, "PANTHEON_BACKUP_PASSPHRASE");
    assert.equal(JSON.stringify(result).includes(PASSPHRASE), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("doctor operations-ready CLI passes against a complete local recovery fixture", async () => {
  const fixture = fixtureRoot("cli-ready");
  try {
    await addSet(fixture, new Date().toISOString());
    const environment = {
      ...process.env,
      PANTHEON_DATA_DIR: path.dirname(fixture.dbPath),
      PANTHEON_DB_PATH: fixture.dbPath,
      PANTHEON_ARTIFACT_ROOT: fixture.artifactRoot,
      PANTHEON_APPROVAL_PACK_DIR: fixture.approvalPackRoot,
      PANTHEON_PRIVATE_OPERATOR_DIR: fixture.privateOperatorRoot,
      PANTHEON_BACKUP_DESTINATION: fixture.destinationRoot,
      PANTHEON_BACKUP_PASSPHRASE: PASSPHRASE,
    };
    const run = spawnSync(
      process.execPath,
      [
        path.join(__dirname, "..", "scripts", "doctor.js"),
        "--json",
        "--operations-ready",
      ],
      { encoding: "utf8", env: environment, windowsHide: true },
    );
    assert.equal(run.status, 0, run.stderr || run.stdout);
    const report = JSON.parse(run.stdout);
    assert.equal(report.ok, true);
    assert.equal(report.operationsReady, true);
    assert.equal(report.readinessBlockers.length, 0);
    assert.equal(report.results.find((item) => item.name === "Recovery set").status, "pass");
    assert.equal(JSON.stringify(report).includes(PASSPHRASE), false);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});
