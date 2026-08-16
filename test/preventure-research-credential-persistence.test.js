"use strict";

const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const authority = require("../config/preventure-research-authority-smm-scope-guard-v1");
const {
  createPreventureResearchOpenAiTransport,
} = require("../src/adapters/preventure-research-openai");
const { openDatabase } = require("../src/db");
const {
  createBackup,
  restoreBackup,
  verifyBackup,
} = require("../src/runtime/backup");
const {
  createPreventureResearchOutputStore,
} = require("../src/runtime/preventure-research-output-store");
const { createApp } = require("../src/server");
const {
  HISTORICAL_ACTIVE_V1_TIME,
  historicalV1TestRegistry,
} = require("./support/preventure-research-test-registry");

const SYNTHETIC_CREDENTIAL = "sk-fake-production-default-proof";
const SYNTHETIC_BEARER = `Bearer ${SYNTHETIC_CREDENTIAL}`;
const BACKUP_PASSPHRASE = "pantheon-synthetic-credential-backup-proof";
const PROJECT_ROOT = path.resolve(__dirname, "..");

function copyBootableSourceContract(destination) {
  fs.mkdirSync(destination, { recursive: true });
  for (const filename of ["package.json", "package-lock.json"]) {
    fs.copyFileSync(path.join(PROJECT_ROOT, filename), path.join(destination, filename));
  }
  for (const dirname of ["src", "config"]) {
    fs.cpSync(path.join(PROJECT_ROOT, dirname), path.join(destination, dirname), {
      recursive: true,
    });
  }
  fs.mkdirSync(path.join(destination, "public"), { recursive: true });
  for (const filename of ["index.html", "app.js", "styles.css"]) {
    fs.copyFileSync(
      path.join(PROJECT_ROOT, "public", filename),
      path.join(destination, "public", filename),
    );
  }
  fs.copyFileSync(
    path.join(PROJECT_ROOT, "requirements-runtime.txt"),
    path.join(destination, "requirements-runtime.txt"),
  );
  fs.mkdirSync(path.join(destination, "scripts"), { recursive: true });
  for (const filename of [
    "renderer-environment.js",
    "compose-storefront-cover.py",
    "render-approval-pack.py",
    "render-digital-product-kit.py",
  ]) {
    fs.copyFileSync(
      path.join(PROJECT_ROOT, "scripts", filename),
      path.join(destination, "scripts", filename),
    );
  }
}

function filesUnder(root) {
  if (!fs.existsSync(root)) return [];
  const files = [];
  const visit = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const target = path.join(current, entry.name);
      if (entry.isDirectory()) visit(target);
      else if (entry.isFile()) files.push(target);
    }
  };
  visit(root);
  return files;
}

function assertFilesExclude(paths, sensitiveValues) {
  for (const file of paths) {
    const bytes = fs.readFileSync(file);
    for (const value of sensitiveValues) {
      assert.equal(
        bytes.includes(Buffer.from(value)),
        false,
        `Synthetic credential material was found in ${file}.`,
      );
    }
  }
}

function spawnProductionProviderProof(root) {
  const sourceRoot = path.join(root, "workspace");
  const dataRoot = path.join(sourceRoot, "data");
  const dbPath = path.join(dataRoot, "runtime.sqlite");
  const artifactRoot = path.join(dataRoot, "artifacts");
  const approvalPackRoot = path.join(sourceRoot, "output", "pdf");
  const privateOperatorRoot = path.join(sourceRoot, "private");
  copyBootableSourceContract(sourceRoot);
  const env = {
    ...process.env,
    OPENAI_API_KEY: SYNTHETIC_CREDENTIAL,
    PANTHEON_APPROVAL_PACK_DIR: approvalPackRoot,
    PANTHEON_ARTIFACT_ROOT: artifactRoot,
    PANTHEON_BACKUP_DESTINATION: path.join(root, "runtime-backups"),
    PANTHEON_DATA_DIR: dataRoot,
    PANTHEON_DB_PATH: dbPath,
    PANTHEON_ENABLE_LIVE_RESEARCH: "1",
    PANTHEON_PRIVATE_OPERATOR_DIR: privateOperatorRoot,
    PANTHEON_SCHEDULER_ENABLED: "0",
  };
  for (const name of [
    "OPENAI_BASE_URL",
    "OPENAI_RESPONSES_URL",
    "PANTHEON_OPENAI_BASE_URL",
    "PANTHEON_OPENAI_RESPONSES_URL",
  ]) {
    delete env[name];
  }
  const result = childProcess.spawnSync(
    process.execPath,
    [path.join(__dirname, "support", "preventure-production-default-child.js"), "armed"],
    {
      cwd: PROJECT_ROOT,
      env,
      encoding: "utf8",
      timeout: 120_000,
    },
  );
  assert.equal(
    result.status,
    0,
    JSON.stringify({ stdout: result.stdout, stderr: result.stderr }),
  );
  assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, new RegExp(SYNTHETIC_CREDENTIAL));
  const summary = JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1));
  assert.equal(summary.mode, "armed");
  assert.equal(summary.providerCalls, 1);
  assert.equal(summary.recovered, true);
  assert.ok(summary.artifactFiles >= 1);
  return {
    approvalPackRoot,
    artifactRoot,
    dataRoot,
    dbPath,
    privateOperatorRoot,
    sourceRoot,
  };
}

async function startProjectionServer(subject) {
  const clock = () => HISTORICAL_ACTIVE_V1_TIME;
  const db = openDatabase(subject.dbPath, { clock });
  const bootstrapSecret = "synthetic-credential-projection-bootstrap";
  const app = createApp({
    db,
    dbPath: subject.dbPath,
    schedulerEnabled: false,
    security: true,
    sessionSecret: Buffer.alloc(32, 114),
    bootstrapSecret,
    initializePreventureResearch: false,
    preventureResearchArtifactRoot: subject.artifactRoot,
    preventureResearchAuthorityRegistry: historicalV1TestRegistry,
    preventureResearchClock: clock,
  });
  await new Promise((resolve, reject) => {
    app.server.once("error", reject);
    app.server.listen(0, "127.0.0.1", resolve);
  });
  return {
    ...app,
    bootstrapSecret,
    origin: `http://127.0.0.1:${app.server.address().port}`,
  };
}

async function stopProjectionServer(app) {
  for (const client of app.wss.clients) client.terminate();
  await new Promise((resolve) => app.server.close(resolve));
  app.wss.close();
  if (app.db.isOpen) app.db.close();
}

async function readOwnerApiPayloads(app) {
  const sessionResponse = await fetch(`${app.origin}/api/session`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: app.origin,
      "x-pantheon-bootstrap": app.bootstrapSecret,
    },
    body: "{}",
  });
  const sessionText = await sessionResponse.text();
  const session = JSON.parse(sessionText);
  assert.equal(sessionResponse.status, 201, sessionText);
  const cookie = sessionResponse.headers.get("set-cookie").split(";", 1)[0];
  const ownerPayloads = [];
  for (const pathname of [
    "/api/health",
    "/api/commercial/authority",
    "/api/preventure-research",
    "/api/cockpit",
    "/api/decisions",
    "/api/events",
    "/api/executive-digest",
    "/api/pantheon",
    "/api/production",
    "/api/system",
    "/api/system/health",
  ]) {
    const response = await fetch(`${app.origin}${pathname}`, {
      headers: { cookie },
    });
    const text = await response.text();
    assert.equal(response.status, 200, `${pathname}: ${text}`);
    ownerPayloads.push(text);
  }
  return {
    ownerPayloads,
    sessionPayload: sessionText,
    sessionValues: {
      bootstrapSecret: app.bootstrapSecret,
      cookie,
      cookieValue: cookie.slice(cookie.indexOf("=") + 1),
      csrfToken: session.csrfToken,
    },
  };
}

test("production transport refuses injected provider credentials before any output can persist", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pantheon-preventure-no-di-secret-"));
  const registeredAssignmentCaps = new Map();
  let fetchCalls = 0;
  try {
    const outputStore = createPreventureResearchOutputStore({
      artifactRoot: root,
      assignmentMaxCostAudCentsForHash(assignmentHash) {
        const cap = registeredAssignmentCaps.get(assignmentHash);
        if (!Number.isSafeInteger(cap) || cap < 0) {
          const error = new Error("The exact registered assignment cost cap is unavailable.");
          error.code = "preventure_test_assignment_cap_unavailable";
          throw error;
        }
        return cap;
      },
    });
    assert.throws(
      () => createPreventureResearchOpenAiTransport({
        authority,
        outputStore,
        apiKey: SYNTHETIC_CREDENTIAL,
        fetchImpl: async () => {
          fetchCalls += 1;
          throw new Error("A forbidden injected transport must never dispatch.");
        },
      }),
      (error) => (
        error.code === "preventure_transport_test_override_forbidden"
        && !String(error.message).includes(SYNTHETIC_CREDENTIAL)
      ),
    );
    assert.equal(fetchCalls, 0);
    assert.deepEqual(filesUnder(root), []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("one synthetic production credential is absent from runtime bytes, owner APIs, logs, and restored backups", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pantheon-preventure-credential-persistence-"));
  let app = null;
  try {
    const subject = spawnProductionProviderProof(root);
    app = await startProjectionServer(subject);
    const ownerApi = await readOwnerApiPayloads(app);
    const runtimeSensitiveValues = [
      SYNTHETIC_CREDENTIAL,
      SYNTHETIC_BEARER,
      ...Object.values(ownerApi.sessionValues),
    ];
    for (const payload of ownerApi.ownerPayloads) {
      for (const value of runtimeSensitiveValues) {
        assert.equal(payload.includes(value), false);
      }
    }
    for (const value of [
      SYNTHETIC_CREDENTIAL,
      SYNTHETIC_BEARER,
      ownerApi.sessionValues.bootstrapSecret,
      ownerApi.sessionValues.cookie,
      ownerApi.sessionValues.cookieValue,
    ]) {
      assert.equal(ownerApi.sessionPayload.includes(value), false);
    }

    const sqliteFiles = [
      subject.dbPath,
      `${subject.dbPath}-wal`,
      `${subject.dbPath}-shm`,
    ];
    for (const file of sqliteFiles) {
      assert.equal(fs.existsSync(file), true, `${path.basename(file)} was not available to scan.`);
    }
    const retainedFiles = filesUnder(subject.artifactRoot);
    assert.ok(retainedFiles.length >= 1);
    assertFilesExclude([...sqliteFiles, ...retainedFiles], runtimeSensitiveValues);
    assertFilesExclude(filesUnder(subject.dataRoot), runtimeSensitiveValues);

    await stopProjectionServer(app);
    app = null;

    fs.mkdirSync(path.join(subject.privateOperatorRoot, "nested"), { recursive: true });
    fs.writeFileSync(
      path.join(subject.privateOperatorRoot, "operator-reference.txt"),
      "synthetic non-secret operator reference\n",
    );
    fs.writeFileSync(
      path.join(subject.privateOperatorRoot, "runtime-credentials.json"),
      JSON.stringify({ openAiApiKey: SYNTHETIC_CREDENTIAL }),
    );
    fs.writeFileSync(
      path.join(subject.privateOperatorRoot, "nested", "runtime-credentials.json"),
      JSON.stringify({ providerToken: SYNTHETIC_CREDENTIAL }),
    );
    fs.writeFileSync(
      path.join(subject.sourceRoot, "synthetic-security-proof.txt"),
      "safe source bytes\n",
    );

    const backupRoot = path.join(root, "backups");
    const recoverySet = await createBackup({
      kind: "set",
      sourceRoot: subject.sourceRoot,
      dbPath: subject.dbPath,
      artifactRoot: subject.artifactRoot,
      approvalPackRoot: subject.approvalPackRoot,
      privateOperatorRoot: subject.privateOperatorRoot,
      destinationRoot: backupRoot,
      passphrase: BACKUP_PASSPHRASE,
      createdAt: "2026-08-05T00:00:00.000Z",
    });
    assert.equal((await verifyBackup(recoverySet.destinationPath, {
      passphrase: BACKUP_PASSPHRASE,
    })).verified, true);
    assertFilesExclude(
      [recoverySet.destinationPath],
      [SYNTHETIC_CREDENTIAL, SYNTHETIC_BEARER, BACKUP_PASSPHRASE],
    );

    const restoredRoot = path.join(root, "restored-recovery-set");
    await restoreBackup(recoverySet.destinationPath, restoredRoot, {
      passphrase: BACKUP_PASSPHRASE,
    });
    assert.equal(
      fs.readFileSync(path.join(restoredRoot, "synthetic-security-proof.txt"), "utf8"),
      "safe source bytes\n",
    );
    assert.equal(
      fs.readFileSync(path.join(restoredRoot, "private", "operator-reference.txt"), "utf8"),
      "synthetic non-secret operator reference\n",
    );
    assert.equal(
      fs.existsSync(path.join(restoredRoot, "private", "runtime-credentials.json")),
      false,
    );
    assert.equal(
      fs.existsSync(path.join(restoredRoot, "private", "nested", "runtime-credentials.json")),
      false,
    );
    assertFilesExclude(
      filesUnder(restoredRoot),
      [SYNTHETIC_CREDENTIAL, SYNTHETIC_BEARER, BACKUP_PASSPHRASE],
    );
  } finally {
    if (app) await stopProjectionServer(app);
    fs.rmSync(root, { recursive: true, force: true });
  }
});
