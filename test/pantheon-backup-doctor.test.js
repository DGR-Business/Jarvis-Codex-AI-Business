const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { DatabaseSync } = require("node:sqlite");
const { LATEST_SCHEMA_VERSION, openDatabase, seedDatabase } = require("../src/db");
const {
  ARCHIVE_SCHEMA_COMPATIBILITY_LABELS,
  LAST_RELEASED_SCHEMA_VERSION,
  createBackup,
} = require("../src/runtime/backup");
const {
  assessOperationsReady,
  checkBackupConfiguration,
  checkLockfile,
  checkPricingFreshness,
  checkRenderer,
  checkRecoverySet,
  checkRuntimeDatabase,
  restoredBootEnvironment,
  restoredHealthReady,
} = require("../scripts/doctor");
const {
  LEGACY_SCHEMA_VERSION,
  downgradeDatabaseToLastReleasedSchema26,
  downgradeDatabaseToLegacySchema24,
} = require("./support/released-schema-24-fixture");

const PASSPHRASE = "pantheon-doctor-passphrase-32-characters";
const projectRoot = path.resolve(__dirname, "..");

function copyBootableSourceContract(destination) {
  fs.mkdirSync(destination, { recursive: true });
  for (const filename of ["package.json", "package-lock.json"]) {
    fs.copyFileSync(path.join(projectRoot, filename), path.join(destination, filename));
  }
  fs.cpSync(path.join(projectRoot, "src"), path.join(destination, "src"), {
    recursive: true,
  });
  fs.cpSync(path.join(projectRoot, "config"), path.join(destination, "config"), {
    recursive: true,
  });
  fs.mkdirSync(path.join(destination, "public"), { recursive: true });
  for (const filename of ["index.html", "app.js", "styles.css"]) {
    fs.copyFileSync(
      path.join(projectRoot, "public", filename),
      path.join(destination, "public", filename),
    );
  }
  fs.copyFileSync(
    path.join(projectRoot, "requirements-runtime.txt"),
    path.join(destination, "requirements-runtime.txt"),
  );
  fs.mkdirSync(path.join(destination, "scripts"), { recursive: true });
  for (const filename of [
    "compose-storefront-cover.py",
    "render-approval-pack.py",
    "render-digital-product-kit.py",
  ]) {
    fs.copyFileSync(
      path.join(projectRoot, "scripts", filename),
      path.join(destination, "scripts", filename),
    );
  }
}

test("pricing freshness warns only after the configured review window", () => {
  const fresh = checkPricingFreshness({ now: "2026-07-22T00:00:00.000Z", maxAgeDays: 30 });
  assert.equal(fresh.status, "pass");

  const stale = checkPricingFreshness({ now: "2026-09-01T00:00:00.000Z", maxAgeDays: 30 });
  assert.equal(stale.status, "warn");
  assert.match(stale.message, /older than 30 days/i);
  assert.ok(stale.details.stale.length > 0);
});

test("restored boot proof requires an explicit runtime-readiness signal", () => {
  assert.equal(restoredHealthReady({ alive: true, ok: true }), false);
  assert.equal(restoredHealthReady({
    alive: true,
    ok: true,
    runtimeReady: false,
    operationsReady: false,
  }), false);
  assert.equal(restoredHealthReady({ alive: true, runtimeReady: true }), true);
  assert.equal(restoredHealthReady({ alive: true, operationsReady: true }), true);
});

test("restored boot uses an allowlisted locked environment without parent credentials or Node hooks", () => {
  const environment = restoredBootEnvironment({
    controlToken: "doctor-control-token",
    dataRoot: "C:\\disposable\\data",
    dbPath: "C:\\disposable\\data\\runtime.sqlite",
    drillRoot: "C:\\disposable",
    instanceId: "doctor-instance",
    port: 54321,
    sourceEnvironment: {
      PATH: "C:\\Windows\\System32",
      TEMP: "C:\\Temp",
      OPENAI_API_KEY: "must-not-cross",
      SMTP_PASSWORD: "must-not-cross",
      TWILIO_AUTH_TOKEN: "must-not-cross",
      PANTHEON_BACKUP_PASSPHRASE: "must-not-cross",
      JARVIS_BACKUP_PASSPHRASE: "must-not-cross",
      NODE_OPTIONS: "--require=must-not-cross",
      NODE_TEST_CONTEXT: "must-not-cross",
    },
  });
  assert.equal(environment.PATH, "C:\\Windows\\System32");
  assert.equal(environment.TEMP, "C:\\Temp");
  for (const name of [
    "OPENAI_API_KEY",
    "SMTP_PASSWORD",
    "TWILIO_AUTH_TOKEN",
    "PANTHEON_BACKUP_PASSPHRASE",
    "JARVIS_BACKUP_PASSPHRASE",
    "NODE_OPTIONS",
    "NODE_TEST_CONTEXT",
  ]) {
    assert.equal(environment[name], undefined, `${name} must not cross the recovery boundary`);
  }
  assert.equal(environment.PANTHEON_LIVE_MODE, "0");
  assert.equal(environment.PANTHEON_ENABLE_LIVE_MODELS, "0");
  assert.equal(environment.PANTHEON_ENABLE_LIVE_RESEARCH, "0");
  assert.equal(environment.PANTHEON_BACKUP_DESTINATION, "C:\\disposable\\backups");
});

test("Doctor accepts only the current Pantheon database contract", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pantheon-doctor-schema-"));
  try {
    const genericPath = path.join(root, "generic.sqlite");
    const generic = new DatabaseSync(genericPath);
    generic.exec("CREATE TABLE proof (value TEXT NOT NULL); INSERT INTO proof VALUES ('valid sqlite');");
    generic.close();
    const rejected = checkRuntimeDatabase({ dbPath: genericPath });
    assert.equal(rejected.status, "fail");
    assert.match(rejected.message, /schema_migrations|Pantheon|schema/i);

    const pantheonPath = path.join(root, "pantheon.sqlite");
    const pantheon = openDatabase(pantheonPath);
    seedDatabase(pantheon);
    pantheon.close();
    const accepted = checkRuntimeDatabase({ dbPath: pantheonPath });
    assert.equal(accepted.status, "pass");
    assert.equal(accepted.details.schemaVersion, LATEST_SCHEMA_VERSION);
    assert.equal(accepted.details.foreignKeyFailures, 0);

    const damaged = new DatabaseSync(pantheonPath);
    damaged.exec("DROP TRIGGER trg_tasks_venture_match_insert");
    damaged.close();
    const unsafe = checkRuntimeDatabase({ dbPath: pantheonPath });
    assert.equal(unsafe.status, "fail");
    assert.match(unsafe.message, /missing required fail-closed trigger/i);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("Doctor verifies exact installed direct dependency versions against the lockfile", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pantheon-doctor-lock-"));
  try {
    const packageJson = {
      name: "dependency-fixture",
      version: "1.0.0",
      dependencies: { alpha: "1.0.0" },
      devDependencies: { beta: "2.0.0" },
    };
    const lock = {
      name: packageJson.name,
      version: packageJson.version,
      lockfileVersion: 3,
      packages: {
        "": {
          name: packageJson.name,
          version: packageJson.version,
          dependencies: packageJson.dependencies,
          devDependencies: packageJson.devDependencies,
        },
        "node_modules/alpha": { version: "1.0.0" },
        "node_modules/beta": { version: "2.0.0", dev: true },
      },
    };
    fs.mkdirSync(path.join(root, "node_modules", "alpha"), { recursive: true });
    fs.mkdirSync(path.join(root, "node_modules", "beta"), { recursive: true });
    fs.writeFileSync(path.join(root, "package.json"), JSON.stringify(packageJson));
    fs.writeFileSync(path.join(root, "package-lock.json"), JSON.stringify(lock));
    fs.writeFileSync(path.join(root, "node_modules", "alpha", "package.json"), JSON.stringify({ name: "alpha", version: "1.0.0" }));
    fs.writeFileSync(path.join(root, "node_modules", "beta", "package.json"), JSON.stringify({ name: "beta", version: "2.0.0" }));

    const passing = checkLockfile({ rootDir: root });
    assert.equal(passing.status, "pass");
    assert.equal(passing.details.versions.alpha.installed, "1.0.0");
    assert.equal(passing.details.versions.beta.locked, "2.0.0");

    fs.writeFileSync(path.join(root, "node_modules", "alpha", "package.json"), JSON.stringify({ name: "alpha", version: "9.0.0" }));
    const mismatched = checkLockfile({ rootDir: root });
    assert.equal(mismatched.status, "fail");
    assert.deepEqual(mismatched.details.mismatched, ["alpha"]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("Doctor checks the exact production Python, renderer scripts, and package pins", () => {
  const ready = checkRenderer();
  assert.equal(ready.status, "pass", ready.message);
  assert.deepEqual(
    ready.details.scripts.sort(),
    [
      "compose-storefront-cover.py",
      "render-approval-pack.py",
      "render-digital-product-kit.py",
    ],
  );
  assert.deepEqual(ready.details.packages, ready.details.pinned);

  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pantheon-doctor-renderer-pin-"));
  try {
    const requirementsPath = path.join(root, "requirements-runtime.txt");
    const requirements = fs.readFileSync(path.join(__dirname, "..", "requirements-runtime.txt"), "utf8");
    fs.writeFileSync(
      requirementsPath,
      requirements.replace(/^pypdfium2==.+$/m, "pypdfium2==0.0.0"),
    );
    const mismatched = checkRenderer({ requirementsPath });
    assert.equal(mismatched.status, "fail");
    assert.deepEqual(mismatched.details.mismatched, ["pypdfium2"]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }

  const previousPython = process.env.PANTHEON_PYTHON;
  try {
    process.env.PANTHEON_PYTHON = process.execPath;
    const exactInterpreterFailure = checkRenderer();
    assert.equal(exactInterpreterFailure.status, "fail");
    assert.match(exactInterpreterFailure.message, /exact production Python/i);
  } finally {
    if (previousPython === undefined) delete process.env.PANTHEON_PYTHON;
    else process.env.PANTHEON_PYTHON = previousPython;
  }
});

function fixtureRoot(name) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `pantheon-doctor-${name}-`));
  const sourceRoot = path.join(root, "workspace");
  const dbPath = path.join(sourceRoot, "data", "runtime.sqlite");
  const artifactRoot = path.join(sourceRoot, "data", "artifacts");
  const approvalPackRoot = path.join(sourceRoot, "output", "pdf");
  const privateOperatorRoot = path.join(sourceRoot, "private");
  const destinationRoot = path.join(root, "backups");
  copyBootableSourceContract(sourceRoot);
  fs.mkdirSync(artifactRoot, { recursive: true });
  fs.mkdirSync(approvalPackRoot, { recursive: true });
  fs.mkdirSync(privateOperatorRoot, { recursive: true });
  fs.writeFileSync(path.join(sourceRoot, "src", "index.js"), "module.exports = true;\n");
  fs.writeFileSync(path.join(artifactRoot, "artifact.txt"), "artifact");
  fs.writeFileSync(path.join(privateOperatorRoot, "reference.txt"), "private reference");
  const db = openDatabase(dbPath);
  seedDatabase(db);
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
    const sourceBeforeDrill = fs.readFileSync(path.join(fixture.sourceRoot, "src", "index.js"), "utf8");
    const fresh = await checkRecoverySet({
      destinationRoot: fixture.destinationRoot,
      passphrase: PASSPHRASE,
      now: "2026-07-18T03:00:00.000Z",
      maxAgeHours: 36,
    });
    assert.equal(fresh.status, "pass");
    assert.equal(fresh.details.components.database.fileCount, 1);
    assert.equal(fresh.details.components.privateOperatorReferences.present, true);
    assert.equal(fresh.details.sqlite.schemaVersion, LATEST_SCHEMA_VERSION);
    assert.equal(fresh.details.sqlite.compatibility, "current_ready");
    assert.equal(fresh.details.source.startPath, "src/server.js");
    assert.deepEqual(
      {
        completed: fresh.details.restoreDrill.completed,
        destinationRetained: fresh.details.restoreDrill.destinationRetained,
        sourceDatabaseUnchanged: fresh.details.restoreDrill.sourceDatabaseUnchanged,
        healthAlive: fresh.details.restoreDrill.health.alive,
        shutdownAccepted: fresh.details.restoreDrill.shutdown.accepted,
        shutdownExitCode: fresh.details.restoreDrill.shutdown.exitCode,
        portReleased: fresh.details.restoreDrill.shutdown.portReleased,
      },
      {
        completed: true,
        destinationRetained: false,
        sourceDatabaseUnchanged: true,
        healthAlive: true,
        shutdownAccepted: true,
        shutdownExitCode: 0,
        portReleased: true,
      },
    );
    assert.deepEqual(fresh.details.restoreDrill.dependencyProof, {
      mode: "current_workspace_node_modules",
      cleanInstallProved: false,
      statement: "Boot compatibility was checked with the currently installed dependency tree; clean installation from the recovered lockfile is a separate release proof.",
    });
    assert.ok(fresh.details.restoreDrill.verifiedAt);
    assert.equal(
      fs.readFileSync(path.join(fixture.sourceRoot, "src", "index.js"), "utf8"),
      sourceBeforeDrill,
    );
    assert.equal(fs.existsSync(path.join(fixture.sourceRoot, ".pantheon-recovery")), false);

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

test("Doctor accepts the last released schema 26 only after disposable migration and restored boot proof", async () => {
  const fixture = fixtureRoot("last-released-schema-26");
  try {
    downgradeDatabaseToLastReleasedSchema26(fixture.dbPath);
    const sourceBefore = fs.readFileSync(fixture.dbPath);
    const currentRuntimeCheck = checkRuntimeDatabase({ dbPath: fixture.dbPath });
    assert.equal(currentRuntimeCheck.status, "fail");
    assert.match(currentRuntimeCheck.message, /does not match supported schema/i);
    await addSet(fixture, "2026-07-18T02:00:00.000Z");
    const report = await checkRecoverySet({
      destinationRoot: fixture.destinationRoot,
      passphrase: PASSPHRASE,
      now: "2026-07-18T03:00:00.000Z",
      maxAgeHours: 36,
    });
    assert.equal(report.status, "pass", report.message);
    assert.equal(report.details.sqlite.schemaVersion, LAST_RELEASED_SCHEMA_VERSION);
    assert.equal(
      report.details.sqlite.compatibility,
      ARCHIVE_SCHEMA_COMPATIBILITY_LABELS[LAST_RELEASED_SCHEMA_VERSION],
    );
    assert.equal(report.details.sqlite.currentReady, false);
    assert.deepEqual(report.details.sqlite.migrationProof, {
      completed: true,
      sourceUnchanged: true,
      fromSchemaVersion: LAST_RELEASED_SCHEMA_VERSION,
      toSchemaVersion: LATEST_SCHEMA_VERSION,
      openedWith: "openDatabase",
    });
    assert.equal(report.details.restoreDrill.health.alive, true);
    assert.equal(report.details.restoreDrill.shutdown.portReleased, true);
    assert.deepEqual(fs.readFileSync(fixture.dbPath), sourceBefore);
    const unchanged = new DatabaseSync(fixture.dbPath, { readOnly: true });
    assert.equal(
      unchanged.prepare("SELECT MAX(version) AS version FROM schema_migrations").get().version,
      LAST_RELEASED_SCHEMA_VERSION,
    );
    unchanged.close();
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("Doctor restores and starts legacy schema 24 without changing its archived bytes", async () => {
  const fixture = fixtureRoot("legacy-schema-24");
  try {
    downgradeDatabaseToLegacySchema24(fixture.dbPath);
    const sourceBefore = fs.readFileSync(fixture.dbPath);
    await addSet(fixture, "2026-07-18T02:00:00.000Z");
    const report = await checkRecoverySet({
      destinationRoot: fixture.destinationRoot,
      passphrase: PASSPHRASE,
      now: "2026-07-18T03:00:00.000Z",
      maxAgeHours: 36,
    });
    assert.equal(report.status, "pass", report.message);
    assert.equal(report.details.sqlite.schemaVersion, LEGACY_SCHEMA_VERSION);
    assert.equal(
      report.details.sqlite.compatibility,
      ARCHIVE_SCHEMA_COMPATIBILITY_LABELS[LEGACY_SCHEMA_VERSION],
    );
    assert.deepEqual(report.details.sqlite.migrationProof, {
      completed: true,
      sourceUnchanged: true,
      fromSchemaVersion: LEGACY_SCHEMA_VERSION,
      toSchemaVersion: LATEST_SCHEMA_VERSION,
      openedWith: "openDatabase",
    });
    assert.equal(report.details.restoreDrill.health.alive, true);
    assert.equal(report.details.restoreDrill.health.ready, true);
    assert.equal(report.details.restoreDrill.health.externalActionsMode, "locked");
    assert.equal(report.details.restoreDrill.shutdown.exitCode, 0);
    assert.equal(report.details.restoreDrill.shutdown.portReleased, true);
    assert.equal(report.details.restoreDrill.sourceDatabaseUnchanged, true);
    assert.deepEqual(fs.readFileSync(fixture.dbPath), sourceBefore);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("Doctor restored child cannot observe parent provider, messaging, backup, or Node-hook secrets", async () => {
  const fixture = fixtureRoot("environment-isolation");
  const sentinel = "PANTHEON-DOCTOR-PARENT-SECRET-MUST-NOT-CROSS";
  const secretNames = [
    "OPENAI_API_KEY",
    "SMTP_PASSWORD",
    "TWILIO_AUTH_TOKEN",
    "PANTHEON_BACKUP_PASSPHRASE",
    "JARVIS_BACKUP_PASSPHRASE",
    "NODE_OPTIONS",
    "NODE_TEST_CONTEXT",
  ];
  const previous = Object.fromEntries(secretNames.map((name) => [name, process.env[name]]));
  try {
    for (const name of secretNames) process.env[name] = sentinel;
    fs.writeFileSync(
      path.join(fixture.sourceRoot, "src", "server.js"),
      `
        const http = require("node:http");
        const sentinel = ${JSON.stringify(sentinel)};
        const forbidden = ${JSON.stringify(secretNames)};
        if (forbidden.some((name) => process.env[name] === sentinel)) process.exit(91);
        const server = http.createServer((req, res) => {
          if (req.method === "GET" && req.url === "/api/health") {
            res.writeHead(200, { "content-type": "application/json" });
            res.end(JSON.stringify({
              alive: true,
              runtimeReady: true,
              externalActionsMode: "locked",
              instanceId: process.env.PANTHEON_RUNTIME_INSTANCE_ID,
            }));
            return;
          }
          if (req.method === "POST" && req.url === "/api/runtime/shutdown") {
            if (req.headers["x-pantheon-control"] !== process.env.PANTHEON_CONTROL_TOKEN) {
              res.writeHead(403, { "content-type": "application/json" });
              res.end(JSON.stringify({ ok: false }));
              return;
            }
            res.writeHead(202, { "content-type": "application/json" });
            res.end(JSON.stringify({ ok: true }), () => {
              server.close(() => process.exit(0));
            });
            return;
          }
          res.writeHead(404);
          res.end();
        });
        server.listen(Number(process.env.PORT), "127.0.0.1");
      `,
      "utf8",
    );
    await addSet(fixture, "2026-07-18T02:00:00.000Z");
    const report = await checkRecoverySet({
      destinationRoot: fixture.destinationRoot,
      passphrase: PASSPHRASE,
      now: "2026-07-18T03:00:00.000Z",
      maxAgeHours: 36,
    });
    assert.equal(report.status, "pass", report.message);
    assert.equal(report.details.restoreDrill.health.alive, true);
    assert.equal(report.details.restoreDrill.shutdown.exitCode, 0);
  } finally {
    for (const name of secretNames) {
      if (previous[name] === undefined) delete process.env[name];
      else process.env[name] = previous[name];
    }
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("Doctor rejects a recovery set whose restored start path cannot prove health", async () => {
  const fixture = fixtureRoot("missing-health");
  try {
    fs.writeFileSync(
      path.join(fixture.sourceRoot, "src", "server.js"),
      "process.exit(0);\n",
      "utf8",
    );
    await addSet(fixture, "2026-07-18T02:00:00.000Z");
    const report = await checkRecoverySet({
      destinationRoot: fixture.destinationRoot,
      passphrase: PASSPHRASE,
      now: "2026-07-18T03:00:00.000Z",
      maxAgeHours: 36,
      healthTimeoutMs: 3_000,
    });
    assert.equal(report.status, "fail");
    assert.match(report.message, /none completed a disposable authenticated restore drill/i);
    assert.equal(report.details.invalidCount, 1);
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
    assert.equal(report.status, "warn", report.message);
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
    installationReady: true,
    recoveryReady: true,
    runtimeReady: null,
    readinessScope: "installation_and_recovery",
    operationsReady: true,
    operationsReadyAliasFor: "installationReady && recoveryReady",
    installationBlockers: [],
    recoveryBlockers: [],
    readinessBlockers: [],
  });

  const stale = passing.map((item) => (
    item.name === "Recovery set"
      ? { ...item, status: "warn", message: "Recovery set is stale." }
      : item
  ));
  const notReady = assessOperationsReady(stale);
  assert.equal(notReady.installationReady, true);
  assert.equal(notReady.recoveryReady, false);
  assert.equal(notReady.runtimeReady, null);
  assert.equal(notReady.readinessScope, "installation_and_recovery");
  assert.equal(notReady.operationsReady, false);
  assert.equal(notReady.operationsReadyAliasFor, "installationReady && recoveryReady");
  assert.deepEqual(notReady.installationBlockers, []);
  assert.deepEqual(notReady.recoveryBlockers, ["Recovery set is stale."]);
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
      {
        encoding: "utf8",
        env: environment,
        windowsHide: true,
        timeout: 60_000,
      },
    );
    assert.equal(run.status, 0, `${run.stderr}\n${run.stdout}`);
    const report = JSON.parse(run.stdout);
    assert.equal(report.ok, true);
    assert.equal(report.installationReady, true);
    assert.equal(report.recoveryReady, true);
    assert.equal(report.runtimeReady, null);
    assert.equal(report.readinessScope, "installation_and_recovery");
    assert.equal(report.operationsReady, true);
    assert.equal(report.operationsReadyAliasFor, "installationReady && recoveryReady");
    assert.equal(report.readinessBlockers.length, 0);
    const recovery = report.results.find((item) => item.name === "Recovery set");
    assert.equal(recovery.status, "pass");
    assert.equal(recovery.details.restoreDrill.completed, true);
    assert.equal(recovery.details.restoreDrill.destinationRetained, false);
    assert.equal(recovery.details.restoreDrill.health.alive, true);
    assert.equal(recovery.details.restoreDrill.shutdown.portReleased, true);
    assert.equal(JSON.stringify(report).includes(PASSPHRASE), false);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});
