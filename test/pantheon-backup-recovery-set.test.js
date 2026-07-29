const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { DatabaseSync } = require("node:sqlite");
const { LATEST_SCHEMA_VERSION, openDatabase, seedDatabase } = require("../src/db");
const {
  assertRestoreDestinationIsInactive,
  backupKeyId,
  createBackup,
  readEncryptedHeader,
  requiredPassphrase,
  restoreBackup,
  validateRecoverySetDirectory,
  validateSqliteDatabase,
  verifyBackup,
} = require("../src/runtime/backup");
const {
  RELEASED_SCHEMA_VERSION,
  downgradeDatabaseToReleasedSchema24,
} = require("./support/released-schema-24-fixture");

const PASSPHRASE = "pantheon-test-passphrase-32-characters";
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

  copyBootableSourceContract(sourceRoot);
  fs.mkdirSync(artifactRoot, { recursive: true });
  fs.mkdirSync(approvalPackRoot, { recursive: true });
  fs.mkdirSync(privateOperatorRoot, { recursive: true });
  fs.writeFileSync(path.join(sourceRoot, "src", "pantheon.js"), "module.exports = 'ready';\n");
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

  const db = openDatabase(dbPath);
  seedDatabase(db);
  db.prepare("UPDATE ventures SET name = ? WHERE id = ?").run(
    "Recovery proof",
    "venture-digital-products",
  );
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
    assert.equal(verification.recoverySet.sqlite.schemaVersion, LATEST_SCHEMA_VERSION);
    assert.equal(verification.recoverySet.sqlite.compatibility, "current_ready");
    assert.equal(verification.recoverySet.source.startPath, "src/server.js");
    assert.deepEqual(
      verification.recoverySet.source.requiredFiles,
      [
        "package-lock.json",
        "package.json",
        "public/app.js",
        "public/index.html",
        "public/styles.css",
        "requirements-runtime.txt",
        "scripts/compose-storefront-cover.py",
        "scripts/render-approval-pack.py",
        "scripts/render-digital-product-kit.py",
        "src/server.js",
      ],
    );
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
    assert.equal(
      restoredDb.prepare("SELECT name FROM ventures WHERE id = 'venture-digital-products'").get().name,
      "Recovery proof",
    );
    restoredDb.close();
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("recovery-set restore refuses every active component path, including external layouts", async () => {
  const root = tempRoot("active-component-overlap");
  const active = {
    rootDir: path.join(root, "active-workspace"),
    dbPath: path.join(root, "external-data", "runtime.sqlite"),
    artifactRoot: path.join(root, "external-artifacts"),
    approvalPackRoot: path.join(root, "external-approval-packs"),
    privateOperatorRoot: path.join(root, "external-private"),
  };
  try {
    for (const [label, destination] of [
      ["source workspace", active.rootDir],
      ["runtime database", path.dirname(active.dbPath)],
      ["runtime artifacts", active.artifactRoot],
      ["approval packs", active.approvalPackRoot],
      ["private operator references", active.privateOperatorRoot],
    ]) {
      assert.throws(
        () => assertRestoreDestinationIsInactive("set", destination, active),
        new RegExp(`overlaps active ${label}`, "i"),
      );
    }
    assert.doesNotThrow(() => assertRestoreDestinationIsInactive(
      "set",
      path.join(root, "independent-restore"),
      active,
    ));

    const fixture = createRecoveryFixture("live-external-overlap");
    try {
      const backup = await createRecoverySet(fixture);
      const previousPack = process.env.PANTHEON_APPROVAL_PACK_DIR;
      const previousPrivate = process.env.PANTHEON_PRIVATE_OPERATOR_DIR;
      try {
        process.env.PANTHEON_APPROVAL_PACK_DIR = active.approvalPackRoot;
        process.env.PANTHEON_PRIVATE_OPERATOR_DIR = active.privateOperatorRoot;
        await assert.rejects(
          restoreBackup(
            backup.destinationPath,
            active.approvalPackRoot,
            { passphrase: PASSPHRASE },
          ),
          /overlaps active approval packs/i,
        );
        await assert.rejects(
          restoreBackup(
            backup.destinationPath,
            active.privateOperatorRoot,
            { passphrase: PASSPHRASE },
          ),
          /overlaps active private operator references/i,
        );
      } finally {
        if (previousPack === undefined) delete process.env.PANTHEON_APPROVAL_PACK_DIR;
        else process.env.PANTHEON_APPROVAL_PACK_DIR = previousPack;
        if (previousPrivate === undefined) delete process.env.PANTHEON_PRIVATE_OPERATOR_DIR;
        else process.env.PANTHEON_PRIVATE_OPERATOR_DIR = previousPrivate;
      }
    } finally {
      fs.rmSync(fixture.root, { recursive: true, force: true });
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("encrypted recovery preserves released schema 24 and proves its disposable migration", async () => {
  const fixture = createRecoveryFixture("released-schema-24");
  try {
    downgradeDatabaseToReleasedSchema24(fixture.dbPath);
    const sourceBefore = fs.readFileSync(fixture.dbPath);
    const backup = await createRecoverySet(fixture);
    const verified = await verifyBackup(backup.destinationPath, {
      passphrase: PASSPHRASE,
    });
    assert.equal(verified.recoverySet.sqlite.schemaVersion, RELEASED_SCHEMA_VERSION);
    assert.equal(verified.recoverySet.sqlite.compatibility, "supported_last_release");
    assert.deepEqual(verified.recoverySet.sqlite.migrationProof, {
      completed: true,
      sourceUnchanged: true,
      fromSchemaVersion: RELEASED_SCHEMA_VERSION,
      toSchemaVersion: LATEST_SCHEMA_VERSION,
      openedWith: "openDatabase",
    });
    assert.deepEqual(fs.readFileSync(fixture.dbPath), sourceBefore);

    const restoredRoot = path.join(fixture.root, "restored-schema-24");
    const restored = await restoreBackup(
      backup.destinationPath,
      restoredRoot,
      { passphrase: PASSPHRASE },
    );
    assert.equal(restored.recoverySet.sqlite.schemaVersion, RELEASED_SCHEMA_VERSION);
    const restoredDb = new DatabaseSync(
      path.join(restoredRoot, "data", "runtime.sqlite"),
      { readOnly: true },
    );
    try {
      assert.equal(
        restoredDb.prepare("SELECT MAX(version) AS version FROM schema_migrations").get().version,
        RELEASED_SCHEMA_VERSION,
      );
      assert.equal(
        restoredDb.prepare("SELECT name FROM ventures WHERE id = ?")
          .get("venture-digital-products").name,
        "Recovery proof",
      );
    } finally {
      restoredDb.close();
    }
    assert.deepEqual(fs.readFileSync(fixture.dbPath), sourceBefore);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("backup compatibility rejects schemas outside the explicit release window", async () => {
  for (const [name, version] of [
    ["unsupported-older", RELEASED_SCHEMA_VERSION - 1],
    ["unsupported-newer", LATEST_SCHEMA_VERSION + 1],
  ]) {
    const fixture = createRecoveryFixture(name);
    try {
      if (version < RELEASED_SCHEMA_VERSION) {
        downgradeDatabaseToReleasedSchema24(fixture.dbPath);
      }
      const db = new DatabaseSync(fixture.dbPath);
      try {
        if (version < RELEASED_SCHEMA_VERSION) {
          db.prepare("DELETE FROM schema_migrations WHERE version = ?")
            .run(RELEASED_SCHEMA_VERSION);
        } else {
          db.prepare(
            "INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)",
          ).run(version, "unsupported-test-version", "2026-07-29T00:00:00.000Z");
        }
        db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
        db.prepare("PRAGMA journal_mode = DELETE").get();
      } finally {
        db.close();
      }
      await assert.rejects(
        createRecoverySet(fixture),
        /not a supported archive schema/i,
      );
    } finally {
      fs.rmSync(fixture.root, { recursive: true, force: true });
    }
  }
});

test("released schema 24 is accepted only when its migrated copy meets the exact database contract", () => {
  for (const [name, damage, expected] of [
    [
      "released-missing-column",
      (db) => db.exec("ALTER TABLE accounting_entries DROP COLUMN metadata"),
      /accounting_entries.*missing|accounting_entries.*exact supported definition/i,
    ],
    [
      "released-missing-index",
      (db) => db.exec("DROP INDEX idx_accounting_entries_occurred"),
      /missing required index idx_accounting_entries_occurred/i,
    ],
    [
      "released-altered-trigger",
      (db) => db.exec(`
        DROP TRIGGER trg_tasks_venture_match_insert;
        CREATE TRIGGER trg_tasks_venture_match_insert
        BEFORE INSERT ON tasks
        WHEN 0
        BEGIN
          SELECT RAISE(ABORT, 'Task venture ownership is required.');
        END;
      `),
      /trg_tasks_venture_match_insert.*exact supported definition/i,
    ],
    [
      "released-missing-trigger",
      (db) => db.exec("DROP TRIGGER trg_accounting_reconciled_immutable_update"),
      /missing required (?:fail-closed )?trigger trg_accounting_reconciled_immutable_update/i,
    ],
  ]) {
    const fixture = createRecoveryFixture(name);
    try {
      downgradeDatabaseToReleasedSchema24(fixture.dbPath);
      const db = new DatabaseSync(fixture.dbPath);
      try {
        damage(db);
        db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
        db.prepare("PRAGMA journal_mode = DELETE").get();
      } finally {
        db.close();
      }
      const sourceBefore = fs.readFileSync(fixture.dbPath);
      assert.throws(
        () => validateSqliteDatabase(fixture.dbPath),
        expected,
      );
      assert.deepEqual(fs.readFileSync(fixture.dbPath), sourceBefore);
    } finally {
      fs.rmSync(fixture.root, { recursive: true, force: true });
    }
  }
});

test("recovery-set creation fails closed when source startup proof is incomplete", async () => {
  for (const [name, mutate, expected] of [
    [
      "missing-package",
      (fixture) => fs.rmSync(path.join(fixture.sourceRoot, "package.json")),
      /missing required file package\.json/i,
    ],
    [
      "missing-lock",
      (fixture) => fs.rmSync(path.join(fixture.sourceRoot, "package-lock.json")),
      /missing required file package-lock\.json/i,
    ],
    [
      "missing-server",
      (fixture) => fs.rmSync(path.join(fixture.sourceRoot, "src", "server.js")),
      /missing required file src\/server\.js/i,
    ],
    [
      "missing-dashboard",
      (fixture) => fs.rmSync(path.join(fixture.sourceRoot, "public", "app.js")),
      /missing required file public\/app\.js/i,
    ],
    [
      "missing-renderer",
      (fixture) => fs.rmSync(
        path.join(fixture.sourceRoot, "scripts", "render-digital-product-kit.py"),
      ),
      /missing required file scripts\/render-digital-product-kit\.py/i,
    ],
    [
      "corrupt-lock",
      (fixture) => fs.writeFileSync(
        path.join(fixture.sourceRoot, "package-lock.json"),
        "{not-json",
        "utf8",
      ),
      /package-lock\.json is not valid JSON/i,
    ],
    [
      "mismatched-lock-dependencies",
      (fixture) => {
        const lockPath = path.join(fixture.sourceRoot, "package-lock.json");
        const lock = JSON.parse(fs.readFileSync(lockPath, "utf8"));
        delete lock.packages[""].dependencies.openai;
        fs.writeFileSync(lockPath, JSON.stringify(lock), "utf8");
      },
      /does not match package\.json dependency metadata/i,
    ],
    [
      "missing-configured-start",
      (fixture) => {
        const packagePath = path.join(fixture.sourceRoot, "package.json");
        const packageJson = JSON.parse(fs.readFileSync(packagePath, "utf8"));
        packageJson.scripts.start = "node src/not-restored.js";
        fs.writeFileSync(packagePath, JSON.stringify(packageJson), "utf8");
      },
      /missing its configured start path src\/not-restored\.js/i,
    ],
  ]) {
    const fixture = createRecoveryFixture(name);
    try {
      mutate(fixture);
      await assert.rejects(createRecoverySet(fixture), expected);
    } finally {
      fs.rmSync(fixture.root, { recursive: true, force: true });
    }
  }
});

test("backup verification rejects internally valid SQLite that is not Pantheon", async () => {
  const root = tempRoot("non-pantheon-database");
  try {
    const dbPath = path.join(root, "generic.sqlite");
    const db = new DatabaseSync(dbPath);
    db.exec("CREATE TABLE proof (value TEXT NOT NULL); INSERT INTO proof VALUES ('valid sqlite');");
    db.close();
    await assert.rejects(
      createBackup({
        kind: "database",
        dbPath,
        destinationRoot: path.join(root, "backups"),
        passphrase: PASSPHRASE,
      }),
      /valid, compatible Pantheon database|schema_migrations/i,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("backup verification rejects Pantheon data when an ownership trigger is missing", async () => {
  const root = tempRoot("unsafe-pantheon-database");
  try {
    const dbPath = path.join(root, "runtime.sqlite");
    const db = openDatabase(dbPath);
    seedDatabase(db);
    db.exec("DROP TRIGGER trg_tasks_venture_match_insert");
    db.close();
    await assert.rejects(
      createBackup({
        kind: "database",
        dbPath,
        destinationRoot: path.join(root, "backups"),
        passphrase: PASSPHRASE,
      }),
      /missing required fail-closed trigger/i,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
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
