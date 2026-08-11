const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const CONFIG = require("../src/config");
const {
  createBackup,
  encryptFile,
  pruneBackups,
  restoreBackup,
} = require("../src/runtime/backup");
const {
  ensureSchedulerJobs,
  inspectSafeWorkflow,
  recoverExpiredSchedulerLocks,
  runSchedulerJob,
  setSchedulerJobStatus,
} = require("../src/runtime/scheduler");
const { runDoctor } = require("../scripts/doctor");
const { get, openDatabase, run, seedDatabase, toJson } = require("../src/db");

const PASSPHRASE = "test-only-backup-passphrase-32-bytes";

function tempRoot(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `jarvis-ops-${name}-`));
}

function closeAndRemove(db, root) {
  if (db) db.close();
  fs.rmSync(root, { recursive: true, force: true });
}

function createRuntime(name) {
  const root = tempRoot(name);
  const db = openDatabase(path.join(root, "runtime.sqlite"));
  seedDatabase(db);
  return { root, db };
}

test("source, database and artifact backups contain distinct managed data", async () => {
  const root = tempRoot("partitioned-backups");
  const sourceRoot = path.join(root, "workspace");
  const artifactRoot = path.join(root, "managed-artifacts");
  const approvalPackRoot = path.join(root, "managed-packs");
  const backupRoot = path.join(root, "backups");
  try {
    fs.mkdirSync(path.join(sourceRoot, "src"), { recursive: true });
    fs.mkdirSync(path.join(sourceRoot, "data", "artifacts"), { recursive: true });
    fs.mkdirSync(path.join(sourceRoot, "output", "pdf"), { recursive: true });
    fs.mkdirSync(artifactRoot, { recursive: true });
    fs.mkdirSync(approvalPackRoot, { recursive: true });
    fs.writeFileSync(path.join(sourceRoot, "src", "app.js"), "module.exports = true;\n");
    fs.writeFileSync(path.join(sourceRoot, "data", "runtime.sqlite"), "not-a-snapshot");
    fs.writeFileSync(path.join(sourceRoot, "data", "artifacts", "legacy.txt"), "must-not-enter-source");
    fs.writeFileSync(path.join(sourceRoot, "output", "pdf", "legacy.pdf"), "must-not-enter-source");
    fs.writeFileSync(path.join(artifactRoot, "deliverable.md"), "managed artifact");
    fs.writeFileSync(path.join(approvalPackRoot, "decision.pdf"), "managed pack");

    const source = await createBackup({
      kind: "source",
      sourceRoot,
      artifactRoot,
      dbPath: path.join(sourceRoot, "data", "runtime.sqlite"),
      destinationRoot: backupRoot,
      passphrase: PASSPHRASE,
    });
    const artifacts = await createBackup({
      kind: "artifacts",
      sourceRoot,
      artifactRoot,
      approvalPackRoot,
      destinationRoot: backupRoot,
      passphrase: PASSPHRASE,
    });

    const sourceRestore = path.join(root, "source-restore");
    const artifactRestore = path.join(root, "artifact-restore");
    await restoreBackup(source.destinationPath, sourceRestore, { passphrase: PASSPHRASE });
    await restoreBackup(artifacts.destinationPath, artifactRestore, { passphrase: PASSPHRASE });

    assert.equal(fs.readFileSync(path.join(sourceRestore, "src", "app.js"), "utf8"), "module.exports = true;\n");
    assert.equal(fs.existsSync(path.join(sourceRestore, "data")), false);
    assert.equal(fs.existsSync(path.join(sourceRestore, "output")), false);
    assert.equal(fs.readFileSync(path.join(artifactRestore, "artifact-root", "deliverable.md"), "utf8"), "managed artifact");
    assert.equal(fs.readFileSync(path.join(artifactRestore, "approval-packs", "decision.pdf"), "utf8"), "managed pack");
    assert.equal(fs.readdirSync(backupRoot).some((name) => name.endsWith(".partial")), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("retention fully verifies candidates, preserves keep sidecars and never trusts corrupt newest files", async () => {
  const root = tempRoot("authenticated-retention");
  try {
    const sourceRoot = path.join(root, "source");
    fs.mkdirSync(sourceRoot, { recursive: true });
    fs.writeFileSync(path.join(sourceRoot, "app.js"), "module.exports = true;\n");
    const createSource = (createdAt) => createBackup({
      kind: "source",
      sourceRoot,
      destinationRoot: root,
      passphrase: PASSPHRASE,
      createdAt,
    });
    const newest = (await createSource("2026-07-17T00:00:00.000Z")).destinationPath;
    const pinned = (await createSource("2026-06-01T00:00:00.000Z")).destinationPath;
    const expired = (await createSource("2026-05-01T00:00:00.000Z")).destinationPath;
    const corrupt = (await createSource("2026-07-18T00:00:00.000Z")).destinationPath;
    fs.writeFileSync(`${pinned}.keep`, "operator-retained\n");
    const tampered = fs.readFileSync(corrupt);
    tampered[tampered.length - 20] ^= 1;
    fs.writeFileSync(corrupt, tampered);

    const retention = pruneBackups(root, {
      passphrase: PASSPHRASE,
      dailyLimit: 1,
      weeklyLimit: 1,
    });
    assert.equal(fs.existsSync(newest), true);
    assert.equal(fs.existsSync(pinned), true);
    assert.equal(fs.existsSync(corrupt), true);
    assert.equal(fs.existsSync(expired), false);
    assert.deepEqual(retention.pinned, [pinned]);
    assert.equal(retention.invalid.some((item) => item.filePath === corrupt), true);
    assert.equal(retention.removed.includes(expired), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("retention cannot let a newer authenticated but un-restorable backup evict a verified backup", async () => {
  const root = tempRoot("semantic-retention");
  try {
    const sourceRoot = path.join(root, "source");
    fs.mkdirSync(sourceRoot, { recursive: true });
    fs.writeFileSync(path.join(sourceRoot, "app.js"), "module.exports = true;\n");
    const restorable = await createBackup({
      kind: "source",
      sourceRoot,
      destinationRoot: root,
      passphrase: PASSPHRASE,
      createdAt: "2026-07-17T00:00:00.000Z",
    });
    const malformedPayload = path.join(root, "not-an-archive.txt");
    const authenticatedButInvalid = path.join(root, "newer-invalid-source.jbackup");
    fs.writeFileSync(malformedPayload, "authenticated bytes that are not a source archive");
    await encryptFile(malformedPayload, authenticatedButInvalid, {
      kind: "source",
      passphrase: PASSPHRASE,
      createdAt: "2026-07-18T00:00:00.000Z",
    });

    const retention = pruneBackups(root, {
      passphrase: PASSPHRASE,
      dailyLimit: 1,
      weeklyLimit: 0,
    });
    assert.equal(fs.existsSync(restorable.destinationPath), true);
    assert.equal(fs.existsSync(authenticatedButInvalid), true);
    assert.equal(retention.removed.includes(restorable.destinationPath), false);
    assert.equal(
      retention.invalid.some((item) => item.filePath === authenticatedButInvalid),
      true,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("database restore is staged, integrity checked and refused for the active runtime path", async () => {
  const root = tempRoot("database-restore");
  try {
    const sourceDbPath = path.join(root, "source.sqlite");
    const sourceDb = openDatabase(sourceDbPath);
    seedDatabase(sourceDb);
    sourceDb.prepare("UPDATE ventures SET name = ? WHERE id = ?").run(
      "Staged restore proof",
      "venture-digital-products",
    );
    sourceDb.close();
    const backup = await createBackup({
      kind: "database",
      dbPath: sourceDbPath,
      destinationRoot: path.join(root, "backups"),
      passphrase: PASSPHRASE,
    });
    const restoredPath = path.join(root, "restored", "runtime.sqlite");
    const restored = await restoreBackup(backup.destinationPath, restoredPath, { passphrase: PASSPHRASE });
    assert.equal(restored.sqlite.quickCheck, "ok");
    const restoredDb = new DatabaseSync(restoredPath, { readOnly: true });
    assert.equal(
      restoredDb.prepare("SELECT name FROM ventures WHERE id = ?")
        .get("venture-digital-products").name,
      "Staged restore proof",
    );
    assert.equal(Object.values(restoredDb.prepare("PRAGMA journal_mode").get())[0], "delete");
    restoredDb.close();
    assert.equal(fs.existsSync(`${restoredPath}-wal`), false);
    assert.equal(fs.existsSync(`${restoredPath}-shm`), false);
    assert.deepEqual(
      fs.readdirSync(path.dirname(restoredPath)).filter((name) => name.startsWith(".runtime.sqlite.restore-")),
      [],
    );
    await assert.rejects(
      restoreBackup(backup.destinationPath, CONFIG.dbPath, { passphrase: PASSPHRASE, replace: true }),
      /active runtime database/,
    );

    const invalidPayload = path.join(root, "invalid.sqlite");
    const invalidBackup = path.join(root, "invalid-database.jbackup");
    fs.writeFileSync(invalidPayload, "this is not SQLite");
    await encryptFile(invalidPayload, invalidBackup, { kind: "database", passphrase: PASSPHRASE });
    await assert.rejects(
      restoreBackup(invalidBackup, path.join(root, "invalid-restore.sqlite"), { passphrase: PASSPHRASE }),
      /valid, compatible Pantheon database/,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("manual and timed scheduler paths share one atomic lease", async () => {
  const runtime = createRuntime("scheduler-lease");
  try {
    ensureSchedulerJobs(runtime.db);
    const results = await Promise.all([
      runSchedulerJob(runtime.db, "job-monitor-cycle", { manual: true }),
      runSchedulerJob(runtime.db, "job-monitor-cycle", { manual: true }),
    ]);
    assert.equal(results.filter((item) => item.status === "completed").length, 1);
    const skipped = results.find((item) => item.status === "skipped");
    assert.equal(skipped.result.reason, "job_already_running");
    assert.equal(get(runtime.db, "SELECT COUNT(*) AS count FROM scheduler_runs").count, 1);
    assert.equal(get(runtime.db, "SELECT lock_owner FROM scheduler_jobs WHERE id = 'job-monitor-cycle'").lock_owner, null);
  } finally {
    closeAndRemove(runtime.db, runtime.root);
  }
});

test("expired scheduler leases are abandoned and recovered before the next claim", async () => {
  const runtime = createRuntime("scheduler-recovery");
  try {
    ensureSchedulerJobs(runtime.db);
    const staleAt = "2026-07-16T00:00:00.000Z";
    run(
      runtime.db,
      `INSERT INTO scheduler_runs (id, job_id, status, started_at, metadata, result)
       VALUES ('sched_stale', 'job-monitor-cycle', 'running', ?, '{}', '{}')`,
      [staleAt],
    );
    run(
      runtime.db,
      `UPDATE scheduler_jobs
       SET locked_at = ?, lock_owner = 'sched_stale', next_run_at = ?
       WHERE id = 'job-monitor-cycle'`,
      [staleAt, staleAt],
    );
    const recovered = recoverExpiredSchedulerLocks(runtime.db, { recoveredAt: "2026-07-17T00:00:00.000Z", leaseSeconds: 60 });
    assert.deepEqual(recovered, [{ jobId: "job-monitor-cycle", abandonedRunId: "sched_stale" }]);
    assert.equal(get(runtime.db, "SELECT status FROM scheduler_runs WHERE id = 'sched_stale'").status, "abandoned");
    assert.equal(get(runtime.db, "SELECT lock_owner FROM scheduler_jobs WHERE id = 'job-monitor-cycle'").lock_owner, null);
    const rerun = await runSchedulerJob(runtime.db, "job-monitor-cycle", { manual: true, leaseSeconds: 60 });
    assert.equal(rerun.status, "completed");
  } finally {
    closeAndRemove(runtime.db, runtime.root);
  }
});

test("safe scheduler categorically refuses provider, spend and approval-bound tasks", async () => {
  const runtime = createRuntime("safe-scheduler-policy");
  try {
    ensureSchedulerJobs(runtime.db);
    const ventureId = get(runtime.db, "SELECT id FROM ventures WHERE is_active = 1").id;
    const ts = new Date().toISOString();
    run(
      runtime.db,
      `INSERT INTO workflows
       (id, venture_id, type, title, status, current_step, priority, metadata, created_at, updated_at)
       VALUES ('wf-unsafe-provider', ?, 'test', 'Unsafe provider work', 'planned', 'queued', 1, ?, ?, ?)`,
      [ventureId, toJson({ agentRunner: { mode: "run_protected", liveModels: false, liveTools: false } }), ts, ts],
    );
    run(
      runtime.db,
      `INSERT INTO tasks
       (id, workflow_id, venture_id, title, kind, agent, status, priority, cost_budget_cents, payload, result, created_at, updated_at)
       VALUES ('task-unsafe-provider', 'wf-unsafe-provider', ?, 'Call a paid provider', 'live_ai_worker_execution',
         'demand_validator', 'queued', 1, 200, ?, '{}', ?, ?)`,
      [ventureId, toJson({ liveSpendRequest: { amountCents: 200, provider: "openai" } }), ts, ts],
    );
    setSchedulerJobStatus(runtime.db, "job-safe-work-loop", "enabled");
    const inspection = inspectSafeWorkflow(runtime.db, "wf-unsafe-provider");
    assert.equal(inspection.safe, false);
    assert.equal(inspection.reason, "live_or_external_task");

    const normalRun = await runSchedulerJob(runtime.db, "job-safe-work-loop", { manual: true });
    assert.equal(normalRun.status, "completed");
    assert.equal(normalRun.result.status, "idle");
    const targetedRun = await runSchedulerJob(runtime.db, "job-safe-work-loop", {
      manual: true,
      workflowId: "wf-unsafe-provider",
    });
    assert.equal(targetedRun.status, "completed");
    assert.equal(targetedRun.result.status, "safety_blocked");
    assert.equal(get(runtime.db, "SELECT status FROM tasks WHERE id = 'task-unsafe-provider'").status, "queued");
    assert.equal(get(runtime.db, "SELECT COUNT(*) AS count FROM model_calls").count, 0);
  } finally {
    closeAndRemove(runtime.db, runtime.root);
  }
});

test("doctor checks the local runtime without revealing credential values", async () => {
  const previousPassphrase = process.env.JARVIS_BACKUP_PASSPHRASE;
  process.env.JARVIS_BACKUP_PASSPHRASE = PASSPHRASE;
  try {
    const report = await runDoctor();
    const serialized = JSON.stringify(report);
    assert.equal(report.failureCount, 0);
    assert.equal(serialized.includes(PASSPHRASE), false);
    assert.ok(report.results.some((item) => item.name === "PDF renderer" && item.status === "pass"));
    assert.ok(report.results.some((item) => item.name === "Node SQLite" && item.status === "pass"));
  } finally {
    if (previousPassphrase === undefined) delete process.env.JARVIS_BACKUP_PASSPHRASE;
    else process.env.JARVIS_BACKUP_PASSPHRASE = previousPassphrase;
  }
});
