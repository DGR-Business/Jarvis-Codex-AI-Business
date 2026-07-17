const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { WebSocket } = require("ws");
const {
  createBackup,
  decryptFile,
  encryptFile,
  pruneBackups,
  restoreBackup,
  sha256File,
} = require("../src/runtime/backup");
const { decideApproval } = require("../src/runtime/approvals");
const { consumeApproval, ensureApprovalScope, validateApprovalScope } = require("../src/runtime/approval-scope");
const { promoteCapability, recordCapabilityReview } = require("../src/runtime/capability-autonomy");
const { createCommercialExperiment } = require("../src/runtime/commercial-results");
const { demandValidatorPilotOutputSchema } = require("../src/runtime/agent-runtime");
const { getAccountingSummary, recordAccountingEntry } = require("../src/runtime/accounting-ledger");
const { reconcileProviderUsageBatch, reserveBudget, reservedThisMonth, resolveReservation } = require("../src/runtime/cost-ledger");
const { estimateModelUsageAud } = require("../src/runtime/model-pricing");
const { renderDeliverable, upsertDeliverableSection } = require("../src/runtime/deliverables");
const { generateWeeklyDigest } = require("../src/runtime/executive-digest");
const { collectFindings } = require("../src/runtime/monitor");
const { getGumroadSalesState, importGumroadCsv } = require("../src/runtime/gumroad-import");
const {
  PILOT_CAPABILITY,
  createPilotFixture,
  ensureDemandValidatorPilotFixture,
  prepareDemandValidatorPilot,
  prepareDemandValidatorPilotRetry,
} = require("../src/runtime/agent-pilot");
const { createCommandPlan } = require("../src/runtime/planner");
const { claimNextTask, completeTaskClaim } = require("../src/runtime/task-claims");
const { runOnce } = require("../src/runtime/orchestrator");
const { requestLiveAiWorker } = require("../src/runtime/live-ai-workers");
const { recoverSetupBlockedTasks } = require("../src/runtime/spend-gate");
const { createApp } = require("../src/server");
const { getCockpitState, getDecisionsState, getSystemState } = require("../src/runtime/cockpit-state");
const { commercialFoundationState, recordEvidence, setExperimentState } = require("../src/runtime/venture-case");
const { all, get, openDatabase, run, seedDatabase, toJson } = require("../src/db");

const PASSPHRASE = "test-only-passphrase-keep-out-of-production";

function runtimeDb(name) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `jarvis-foundation-${name}-`));
  const dbPath = path.join(root, "runtime.sqlite");
  const db = openDatabase(dbPath);
  seedDatabase(db, { includeDemoProof: true });
  return { db, dbPath, root };
}

function closeRuntime(runtime) {
  runtime.db.close();
  fs.rmSync(runtime.root, { recursive: true, force: true });
}

test("production seed starts with truthful empty operating records", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-production-seed-"));
  const db = openDatabase(path.join(root, "runtime.sqlite"));
  try {
    assert.equal(seedDatabase(db), true);
    assert.equal(get(db, "SELECT COUNT(*) AS count FROM ventures").count, 1);
    assert.equal(get(db, "SELECT COUNT(*) AS count FROM ventures WHERE is_active = 1").count, 1);
    assert.equal(get(db, "SELECT COUNT(*) AS count FROM workflows").count, 0);
    assert.equal(get(db, "SELECT COUNT(*) AS count FROM tasks").count, 0);
    assert.equal(get(db, "SELECT COUNT(*) AS count FROM approvals").count, 0);
    assert.equal(get(db, "SELECT COUNT(*) AS count FROM deliverables").count, 0);
    assert.equal(get(db, "SELECT COUNT(*) AS count FROM messages").count, 0);
    assert.equal(get(db, "SELECT COUNT(*) AS count FROM accounting_entries").count, 0);
    assert.equal(get(db, "SELECT COUNT(*) AS count FROM integrations").count > 0, true);
  } finally {
    db.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("runtime health ignores optional connections and reports genuine core blockers", () => {
  const runtime = runtimeDb("core-connection-health");
  try {
    run(runtime.db, "UPDATE integrations SET health = 'ok' WHERE id IN ('ai_workers', 'live_research', 'digital_products')");
    run(runtime.db, "UPDATE integrations SET health = 'not_configured' WHERE id = 'email'");
    assert.equal(collectFindings(runtime.db).some((finding) => finding.category === "integrations"), false);

    run(runtime.db, "UPDATE integrations SET health = 'not_configured' WHERE id = 'ai_workers'");
    const blocked = collectFindings(runtime.db).find((finding) => finding.category === "integrations");
    assert.equal(blocked.entityId, "ai_workers");
    assert.equal(blocked.title, "1 core connection needs setup");
    assert.match(blocked.detail, /AI work/);
  } finally {
    closeRuntime(runtime);
  }
});

test("AUD accounting records cash outflow and recurring overhead without consuming the AI cap", () => {
  const runtime = runtimeDb("aud-accounting");
  try {
    recordAccountingEntry(runtime.db, {
      id: "acct-api-credit",
      entryType: "prepaid_credit_purchase",
      category: "ai_infrastructure",
      source: "OpenAI API",
      description: "OpenAI API prepaid credit",
      amountCents: 1579,
      occurredAt: "2026-07-16T00:00:00+10:00",
      metadata: { sourceCurrency: "USD", sourceTotalCents: 1100 },
    });
    recordAccountingEntry(runtime.db, {
      id: "acct-chatgpt-pro-payment",
      entryType: "cash_outflow",
      category: "software_subscription",
      source: "OpenAI ChatGPT",
      description: "ChatGPT Pro upgrade payment",
      amountCents: 9468,
      occurredAt: "2026-07-05T00:00:00+10:00",
    });
    recordAccountingEntry(runtime.db, {
      id: "acct-chatgpt-pro-recurring",
      entryType: "recurring_commitment",
      category: "software_subscription",
      source: "OpenAI ChatGPT",
      description: "ChatGPT Pro monthly subscription",
      status: "active",
      amountCents: 10000,
      occurredAt: "2026-07-05T00:00:00+10:00",
      nextDueAt: "2026-08-05T00:00:00+10:00",
    });
    const summary = getAccountingSummary(runtime.db, { month: "2026-07" });
    assert.equal(summary.cashPaidCents, 11047);
    assert.equal(summary.recurringMonthlyCents, 10000);
    assert.equal(summary.entryCount, 3);
    assert.equal(reservedThisMonth(runtime.db), 0);
  } finally {
    closeRuntime(runtime);
  }
});

test("Terra token pricing remains an AUD estimate separate from the approved cap", () => {
  const estimate = estimateModelUsageAud("gpt-5.6-terra", {
    input_tokens: 1000,
    cached_input_tokens: 100,
    output_tokens: 1000,
  }, { audPerUsd: 1.579, fallbackCents: 100 });
  assert.equal(estimate.method, "published_token_price_converted_to_aud");
  assert.equal(estimate.amountCents, 3);
  assert.equal(estimate.audPerUsd, 1.579);
  assert.equal(estimateModelUsageAud("unknown-model", { input_tokens: 1 }, { fallbackCents: 100 }).amountCents, 100);
});

test("Demand Validator pilot output stays lean enough for the approved response cap", () => {
  const { z } = require("zod");
  const parsed = demandValidatorPilotOutputSchema(z).safeParse({
    summary: "The fixture identifies a repeated problem but contains no willingness-to-pay evidence.",
    moneyMove: "Run a small interest test before building.",
    evidence: ["Repeated cash-control tasks were missed."],
    counterevidence: ["No paid buyers or product views were supplied."],
    assumptions: ["The evaluation fixture is accurate but is not live evidence."],
    priceChannelHypothesis: "Test one low-risk price through one qualified channel.",
    smallestTest: "Show a concise offer to a small qualified audience.",
    metric: "Qualified views, buyer actions and paid conversions.",
    killRule: "Stop or revise at the declared sample without buyer action.",
    risks: ["Demand and willingness to pay remain unproven."],
    nextAction: "Prepare the bounded interest test.",
    operatorDecision: "needs_evidence",
    confidence: "low",
  });
  assert.equal(parsed.success, true);
  assert.equal(Object.hasOwn(parsed.data, "businessDecision"), false);
});

test("encrypted backups authenticate and restore exact file bytes", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-backup-test-"));
  try {
    const source = path.join(root, "source.txt");
    const encrypted = path.join(root, "source.jbackup");
    const restored = path.join(root, "restored.txt");
    fs.writeFileSync(source, "commercial truth\n", "utf8");
    await encryptFile(source, encrypted, { kind: "file", passphrase: PASSPHRASE });
    await decryptFile(encrypted, restored, { passphrase: PASSPHRASE });
    assert.equal(fs.readFileSync(restored, "utf8"), "commercial truth\n");
    assert.equal(sha256File(source), sha256File(restored));

    const tampered = Buffer.from(fs.readFileSync(encrypted));
    tampered[tampered.length - 20] ^= 1;
    fs.writeFileSync(encrypted, tampered);
    await assert.rejects(
      decryptFile(encrypted, restored, { passphrase: PASSPHRASE }),
      /could not be decrypted|hash does not match/,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("retention keeps source and database backups independently", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-retention-test-"));
  try {
    const source = path.join(root, "jarvis-source-2026-07-14.jbackup");
    const database = path.join(root, "jarvis-database-2026-07-14.jbackup");
    fs.writeFileSync(source, "source");
    fs.writeFileSync(database, "database");
    const result = pruneBackups(root, { dailyLimit: 1, weeklyLimit: 1 });
    assert.deepEqual(new Set(result.kept), new Set([source, database]));
    assert.equal(result.removed.length, 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("source backup excludes reproducible and transient directories", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-source-test-"));
  const destinationRoot = path.join(root, "backups");
  const sourceRoot = path.join(root, "workspace");
  const restoreRoot = path.join(root, "restore");
  try {
    fs.mkdirSync(path.join(sourceRoot, "src"), { recursive: true });
    fs.mkdirSync(path.join(sourceRoot, "node_modules", "pkg"), { recursive: true });
    fs.mkdirSync(path.join(sourceRoot, "tmp"), { recursive: true });
    fs.mkdirSync(path.join(sourceRoot, "private"), { recursive: true });
    fs.writeFileSync(path.join(sourceRoot, "src", "app.js"), "module.exports = true;\n");
    fs.writeFileSync(path.join(sourceRoot, "node_modules", "pkg", "index.js"), "ignored\n");
    fs.writeFileSync(path.join(sourceRoot, "tmp", "scratch.txt"), "ignored\n");
    fs.writeFileSync(path.join(sourceRoot, "private", "runtime-credentials.json"), "ignored\n");
    const result = await createBackup({
      kind: "source",
      sourceRoot,
      destinationRoot,
      passphrase: PASSPHRASE,
    });
    await restoreBackup(result.destinationPath, restoreRoot, { passphrase: PASSPHRASE });
    assert.equal(fs.readFileSync(path.join(restoreRoot, "src", "app.js"), "utf8"), "module.exports = true;\n");
    assert.equal(fs.existsSync(path.join(restoreRoot, "node_modules")), false);
    assert.equal(fs.existsSync(path.join(restoreRoot, "tmp")), false);
    assert.equal(fs.existsSync(path.join(restoreRoot, "private")), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("SQLite runtime backup restores a readable consistent database", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-db-backup-test-"));
  try {
    const dbPath = path.join(root, "runtime.sqlite");
    const destinationRoot = path.join(root, "backups");
    const restoredPath = path.join(root, "restored", "runtime.sqlite");
    const db = new DatabaseSync(dbPath);
    db.exec("CREATE TABLE proof (value TEXT NOT NULL); INSERT INTO proof VALUES ('restorable');");
    db.close();
    const result = await createBackup({
      kind: "database",
      dbPath,
      destinationRoot,
      passphrase: PASSPHRASE,
    });
    await restoreBackup(result.destinationPath, restoredPath, { passphrase: PASSPHRASE });
    const restored = new DatabaseSync(restoredPath, { readOnly: true });
    assert.equal(restored.prepare("SELECT value FROM proof").get().value, "restorable");
    restored.close();
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("versioned migrations preserve state and assign every operational record to the active venture", () => {
  const runtime = runtimeDb("migrations");
  const ts = new Date().toISOString();
  try {
    assert.deepEqual(all(runtime.db, "SELECT version FROM schema_migrations ORDER BY version").map((row) => row.version), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
    run(
      runtime.db,
      `INSERT INTO workflows
       (id, type, title, status, current_step, priority, metadata, created_at, updated_at)
       VALUES ('wf-ownership-proof', 'foundation_test', 'Ownership proof', 'planned', 'test', 1, '{}', ?, ?)`,
      [ts, ts],
    );
    run(
      runtime.db,
      `INSERT INTO tasks
       (id, workflow_id, title, kind, agent, status, priority, payload, result, created_at, updated_at)
       VALUES ('task-ownership-proof', 'wf-ownership-proof', 'Ownership proof', 'market_research',
               'demand_validator', 'planned', 1, '{}', '{}', ?, ?)`,
      [ts, ts],
    );
    run(
      runtime.db,
      `INSERT INTO messages (id, task_id, severity, status, subject, body, created_at, metadata)
       VALUES ('msg-ownership-proof', 'task-ownership-proof', 'info', 'open', 'Ownership', 'Proof', ?, '{}')`,
      [ts],
    );
    run(
      runtime.db,
      `INSERT INTO events (ts, level, actor, type, entity_type, entity_id, message, metadata)
       VALUES (?, 'info', 'test', 'ownership.proof', 'task', 'task-ownership-proof', 'Proof', '{}')`,
      [ts],
    );

    for (const table of ["workflows", "tasks", "messages", "events"]) {
      const row = get(runtime.db, `SELECT venture_id FROM ${table} ORDER BY rowid DESC LIMIT 1`);
      assert.equal(row.venture_id, "venture-digital-products", `${table} should inherit the active venture`);
    }

    runtime.db.close();
    runtime.db = openDatabase(runtime.dbPath);
    assert.equal(get(runtime.db, "SELECT title FROM workflows WHERE id = 'wf-ownership-proof'").title, "Ownership proof");
    assert.equal(all(runtime.db, "SELECT * FROM schema_migrations").length, 14);
  } finally {
    closeRuntime(runtime);
  }
});

test("foundation reset archives unsupported demo state without deleting its audit history", () => {
  const runtime = runtimeDb("legacy-demo-reset");
  const ts = "2026-07-07T09:00:00.000Z";
  try {
    const experiment = createCommercialExperiment(runtime.db, {
      name: "Protected demo incorrectly shown as live",
      buyer: "Fixture buyer",
      offer: "Fixture offer",
      channel: "Protected rehearsal",
    });
    run(
      runtime.db,
      "UPDATE commercial_experiments SET status = 'running', started_at = ?, metadata = ? WHERE id = ?",
      [ts, toJson({ dryRunOnly: true }), experiment.id],
    );
    run(
      runtime.db,
      `INSERT INTO workflows
       (id, venture_id, type, title, status, current_step, priority, metadata, created_at, updated_at)
       VALUES ('wf-stale-live-proof', 'venture-digital-products', 'live_worker', 'Stale live setup',
               'blocked', 'waiting for credentials', 1, '{}', ?, ?)`,
      [ts, ts],
    );
    run(
      runtime.db,
      `INSERT INTO approvals
       (id, workflow_id, venture_id, scope, title, status, risk_level, requested_by,
        requested_at, payload, expected_effects)
       VALUES ('appr-stale-live-proof', 'wf-stale-live-proof', 'venture-digital-products',
               'live_ai_worker_spend', 'Old live proof', 'pending', 'medium', 'test', ?, '{}', '[]')`,
      [ts],
    );
    run(
      runtime.db,
      `INSERT INTO tasks
       (id, workflow_id, venture_id, title, kind, agent, status, priority, approval_id,
        payload, result, setup_block_reason, created_at, updated_at)
       VALUES ('task-stale-live-proof', 'wf-stale-live-proof', 'venture-digital-products',
               'Old provider setup', 'live_ai_worker_execution', 'demand_validator', 'blocked', 1,
               'appr-stale-live-proof', '{}', '{}', 'credentials missing', ?, ?)`,
      [ts, ts],
    );
    run(
      runtime.db,
      `INSERT INTO messages
       (id, task_id, venture_id, severity, status, subject, body, created_at, metadata)
       VALUES ('msg-stale-live-proof', 'task-stale-live-proof', 'venture-digital-products',
               'urgent', 'open', 'Old provider setup', 'No live work ran.', ?, '{}')`,
      [ts],
    );
    run(
      runtime.db,
      `INSERT INTO deliverables
       (id, workflow_id, venture_id, title, human_name, audience, format, status,
        summary, metadata, created_at, updated_at)
       VALUES ('deliv-stale-live-proof', 'wf-stale-live-proof', 'venture-digital-products',
               'Old protected pack', 'Old protected pack', 'operator', 'pdf', 'ready_for_review',
               'Historical proof only.', '{}', ?, ?)`,
      [ts, ts],
    );
    run(
      runtime.db,
      `INSERT INTO workflows
       (id, venture_id, type, title, status, current_step, priority, metadata, created_at, updated_at)
       VALUES ('wf-old-proof-mode', 'venture-digital-products', 'foundation_test', 'Old proof mode',
               'completed', 'proof complete', 3, ?, ?, ?)`,
      [toJson({ proofMode: "dry-run only" }), ts, ts],
    );
    run(
      runtime.db,
      `INSERT INTO deliverables
       (id, workflow_id, venture_id, title, human_name, audience, format, status,
        file_path, summary, metadata, created_at, updated_at)
       VALUES ('deliv-old-planned-output', 'wf-old-proof-mode', 'venture-digital-products',
               'Old planned output', 'Old planned output', 'operator', 'markdown', 'planned',
               'deliverables/old-planned-output.md', 'Never materialized.', '{}', ?, ?)`,
      [ts, ts],
    );
    run(
      runtime.db,
      `INSERT INTO deliverables
       (id, workflow_id, venture_id, title, human_name, audience, format, status,
        summary, metadata, created_at, updated_at)
       VALUES ('deliv-old-proof-mode', 'wf-old-proof-mode', 'venture-digital-products',
               'Old proof pack', 'Old proof pack', 'operator', 'pdf', 'ready_for_review',
               'Historical proof only.', '{}', ?, ?)`,
      [ts, ts],
    );
    run(
      runtime.db,
      `INSERT INTO messages
       (id, venture_id, severity, status, subject, body, created_at, metadata)
       VALUES ('msg-old-workflow-plan', 'venture-digital-products', 'info', 'open',
               'Old proof workflow planned',
               'Live model/tool execution is still locked until setup is approved.', ?, '{}')`,
      [ts],
    );

    run(runtime.db, "DELETE FROM schema_migrations WHERE version = 6");
    run(runtime.db, "DELETE FROM schema_migrations WHERE version = 7");
    run(runtime.db, "DELETE FROM schema_migrations WHERE version = 8");
    run(runtime.db, "DELETE FROM schema_migrations WHERE version = 9");
    runtime.db.close();
    runtime.db = openDatabase(runtime.dbPath);

    const archived = get(runtime.db, "SELECT * FROM commercial_experiments WHERE id = ?", [experiment.id]);
    assert.equal(archived.status, "cancelled");
    assert.equal(archived.started_at, null);
    assert.match(JSON.parse(archived.metadata).archivedReason, /no verified real-world start/i);
    assert.equal(get(runtime.db, "SELECT status FROM approvals WHERE id = 'appr-stale-live-proof'").status, "superseded");
    assert.equal(get(runtime.db, "SELECT status FROM tasks WHERE id = 'task-stale-live-proof'").status, "cancelled");
    assert.equal(get(runtime.db, "SELECT status FROM messages WHERE id = 'msg-stale-live-proof'").status, "resolved");
    assert.equal(get(runtime.db, "SELECT status FROM workflows WHERE id = 'wf-stale-live-proof'").status, "archived");
    assert.equal(get(runtime.db, "SELECT status FROM workflows WHERE id = 'wf-old-proof-mode'").status, "archived");
    assert.equal(get(runtime.db, "SELECT status FROM deliverables WHERE id = 'deliv-stale-live-proof'").status, "archived");
    assert.equal(get(runtime.db, "SELECT status FROM deliverables WHERE id = 'deliv-old-proof-mode'").status, "archived");
    const oldPlannedOutput = get(runtime.db, "SELECT status, file_path FROM deliverables WHERE id = 'deliv-old-planned-output'");
    assert.equal(oldPlannedOutput.status, "archived");
    assert.equal(
      oldPlannedOutput.file_path,
      "archive/historical/local-artifacts/legacy-generated-deliverables-pre-foundation/old-planned-output.md",
    );
    assert.equal(get(runtime.db, "SELECT status FROM messages WHERE id = 'msg-old-workflow-plan'").status, "resolved");
    assert.equal(get(runtime.db, "SELECT status FROM approvals WHERE id = 'appr-digital-product-dry-run'").status, "pending");
    assert.equal(get(runtime.db, "SELECT name FROM commercial_experiments WHERE id = ?", [experiment.id]).name, "Protected demo incorrectly shown as live");
  } finally {
    closeRuntime(runtime);
  }
});

test("atomic task claims prevent the same provider-bound work from being taken twice", () => {
  const runtime = runtimeDb("claims");
  try {
    const planned = createCommandPlan(runtime.db, {
      text: "Evaluate one digital checklist product",
      source: "test",
      createFiles: false,
    });
    const task = get(runtime.db, "SELECT * FROM tasks WHERE workflow_id = ? ORDER BY priority LIMIT 1", [planned.workflow.id]);
    run(runtime.db, "UPDATE tasks SET status = 'cancelled' WHERE workflow_id = ?", [planned.workflow.id]);
    run(runtime.db, "UPDATE tasks SET status = 'queued' WHERE id = ?", [task.id]);

    const first = claimNextTask(runtime.db, { workflowId: planned.workflow.id, claimant: "worker-a" });
    const second = claimNextTask(runtime.db, { workflowId: planned.workflow.id, claimant: "worker-b" });
    assert.equal(first.task.id, task.id);
    assert.equal(second, null);
    assert.equal(get(runtime.db, "SELECT COUNT(*) AS count FROM task_attempts WHERE task_id = ?", [task.id]).count, 1);

    completeTaskClaim(runtime.db, first, { result: { proof: true }, reconciledCostCents: 0 });
    const completed = get(runtime.db, "SELECT * FROM tasks WHERE id = ?", [task.id]);
    assert.equal(completed.status, "completed");
    assert.equal(completed.claim_token, null);
    assert.equal(completed.outcome_status, "known");
  } finally {
    closeRuntime(runtime);
  }
});

test("deliverables render idempotently to one canonical isolated artifact", () => {
  const runtime = runtimeDb("artifact-isolation");
  const artifactRoot = path.join(runtime.root, "test-artifacts");
  try {
    const planned = createCommandPlan(runtime.db, {
      text: "Evaluate one digital checklist product",
      source: "test",
      createFiles: false,
    });
    const deliverable = get(runtime.db, "SELECT * FROM deliverables WHERE workflow_id = ? ORDER BY created_at LIMIT 1", [planned.workflow.id]);
    const task = get(runtime.db, "SELECT * FROM tasks WHERE workflow_id = ? ORDER BY priority LIMIT 1", [planned.workflow.id]);
    const first = renderDeliverable(runtime.db, deliverable.id, { artifactRoot });
    const second = renderDeliverable(runtime.db, deliverable.id, { artifactRoot });
    assert.equal(second.filePath, first.filePath);
    assert.equal(second.contentHash, first.contentHash);
    assert.equal(second.version, 1);

    const output = {
      heading: "Evidence result",
      summary: "One repeatable result.",
      evidence: ["Versioned test evidence"],
      details: { state: "Completed" },
      risks: ["Still needs real buyer evidence"],
      nextAction: "Review before a real market action.",
    };
    const changed = upsertDeliverableSection(runtime.db, deliverable.id, task, output, 1, { artifactRoot });
    const repeated = upsertDeliverableSection(runtime.db, deliverable.id, task, output, 1, { artifactRoot });
    assert.equal(changed.version, 2);
    assert.equal(repeated.version, 2);
    assert.equal(repeated.contentHash, changed.contentHash);
    assert.deepEqual(fs.readdirSync(path.dirname(repeated.filePath)), [path.basename(repeated.filePath)]);
    assert.equal(repeated.filePath.startsWith(artifactRoot), true);
  } finally {
    closeRuntime(runtime);
  }
});

test("approvals expire, invalidate on scope changes, and can be consumed only once", () => {
  const runtime = runtimeDb("approval-scope");
  try {
    const fixture = ensureDemandValidatorPilotFixture(runtime.db);
    const prepared = prepareDemandValidatorPilot(runtime.db, fixture.id, { estimatedCostCents: 100 });
    const approvalId = prepared.requested.approval.id;
    const taskId = prepared.requested.task.id;
    const scoped = ensureApprovalScope(runtime.db, approvalId);
    assert.equal(scoped.scope.ventureId, "venture-digital-products");
    assert.equal(scoped.scope.workerId, "demand_validator");
    assert.equal(scoped.scope.fixtureHash, fixture.fixture_hash);
    assert.deepEqual(scoped.scope.tools, []);
    assert.deepEqual(scoped.scope.toolArguments, {});
    assert.equal(scoped.scope.parameters.modelRoute.tier, "sol");
    assert.equal(scoped.scope.parameters.modelRoute.policyVersion, "2026-07-17.1");
    assert.equal(scoped.scope.parameters.modelRoute.automaticFallbackAllowed, false);
    assert.deepEqual(scoped.scope.effects, []);
    assert.equal(scoped.scope.tracePolicy.providerResponseStored, true);
    assert.equal(scoped.scope.tracePolicy.providerTraceContent, true);
    assert.equal(scoped.scope.tracePolicy.localReviewStored, true);
    assert.equal(scoped.scope.tracePolicy.dataClass, "controlled_fixture_no_personal_data");
    assert.equal(scoped.scope.maxTurns, 1);
    assert.equal(scoped.scope.maxOutputTokens, 1200);
    assert.equal(scoped.scope.maxCostCents, 100);
    const decision = getDecisionsState(runtime.db).approvals.find((item) => item.id === approvalId);
    assert.equal(decision.modelRoute.tier, "sol");
    assert.equal(decision.model, "gpt-5.6-sol");
    assert.equal(decision.pricedWorstCaseCostCents > 0, true);
    assert.equal(decision.pricedWorstCaseCostCents <= decision.maxCostCents, true);
    assert.deepEqual(decision.tools, []);
    assert.deepEqual(decision.effects, []);
    assert.equal(decision.maxTurns, 1);
    assert.equal(decision.maxOutputTokens, 1200);
    assert.equal(decision.assignment.question, fixture.question);
    assert.equal(decision.assignment.evidenceCount, fixture.sources.length);

    run(runtime.db, "UPDATE approvals SET expires_at = '2000-01-01T00:00:00.000Z' WHERE id = ?", [approvalId]);
    assert.match(validateApprovalScope(runtime.db, approvalId).reason, /expired/i);
    run(runtime.db, "UPDATE approvals SET expires_at = '2099-01-01T00:00:00.000Z' WHERE id = ?", [approvalId]);

    const originalPayload = get(runtime.db, "SELECT payload FROM tasks WHERE id = ?", [taskId]).payload;
    const changedPayload = JSON.parse(originalPayload);
    changedPayload.liveSpendRequest.maxTurns = 2;
    run(runtime.db, "UPDATE tasks SET payload = ? WHERE id = ?", [toJson(changedPayload), taskId]);
    assert.match(validateApprovalScope(runtime.db, approvalId, null, scoped.scopeHash).reason, /scope changed/i);
    run(runtime.db, "UPDATE tasks SET payload = ? WHERE id = ?", [originalPayload, taskId]);
    assert.equal(validateApprovalScope(runtime.db, approvalId, null, scoped.scopeHash).valid, true);

    decideApproval(runtime.db, approvalId, "approved", "test approval", { expectedScopeHash: scoped.scopeHash });
    const task = get(runtime.db, "SELECT * FROM tasks WHERE id = ?", [taskId]);
    consumeApproval(runtime.db, approvalId, task);
    assert.throws(() => consumeApproval(runtime.db, approvalId, task), /already been used/i);
  } finally {
    closeRuntime(runtime);
  }
});

test("cost reservations keep estimates, unknown outcomes, reconciliation, and releases distinct", () => {
  const runtime = runtimeDb("cost-truth");
  try {
    const planned = createCommandPlan(runtime.db, {
      text: "Evaluate a cash checklist digital product",
      source: "test",
      createFiles: false,
    });
    const task = get(runtime.db, "SELECT * FROM tasks WHERE workflow_id = ? AND kind = 'market_research'", [planned.workflow.id]);
    const reserved = reserveBudget(runtime.db, task, null, 50);
    assert.equal(reserved.status, "reserved");
    assert.equal(reservedThisMonth(runtime.db), 50);

    assert.equal(resolveReservation(runtime.db, task.id, "incurred_estimate", { amountCents: 40 }).status, "incurred_estimate");
    assert.equal(reservedThisMonth(runtime.db), 40);
    assert.equal(resolveReservation(runtime.db, task.id, "unknown").status, "unknown");
    const reconciled = resolveReservation(runtime.db, task.id, "reconciled", { amountCents: 35 });
    assert.equal(reconciled.status, "reconciled");
    assert.equal(reconciled.amount_cents, 35);
    assert.ok(reconciled.resolved_at);
    assert.equal(reservedThisMonth(runtime.db), 0);

    reserveBudget(runtime.db, task, null, 25);
    const released = resolveReservation(runtime.db, task.id, "released", { amountCents: 0 });
    assert.equal(released.status, "released");
    assert.equal(released.amount_cents, 0);
  } finally {
    closeRuntime(runtime);
  }
});

test("aggregate provider usage reconciliation updates exact runtime records atomically", () => {
  const runtime = runtimeDb("provider-usage-reconciliation");
  try {
    const firstPlan = createCommandPlan(runtime.db, {
      text: "First controlled provider call",
      source: "test",
      createFiles: false,
    });
    const secondPlan = createCommandPlan(runtime.db, {
      text: "Corrected controlled provider call",
      source: "test",
      createFiles: false,
    });
    const firstTask = get(runtime.db, "SELECT * FROM tasks WHERE workflow_id = ? ORDER BY priority LIMIT 1", [firstPlan.workflow.id]);
    const secondTask = get(runtime.db, "SELECT * FROM tasks WHERE workflow_id = ? ORDER BY priority LIMIT 1", [secondPlan.workflow.id]);
    run(runtime.db, "UPDATE tasks SET cost_budget_cents = 100 WHERE id IN (?, ?)", [firstTask.id, secondTask.id]);
    firstTask.cost_budget_cents = 100;
    secondTask.cost_budget_cents = 100;
    reserveBudget(runtime.db, firstTask, null, 100);
    reserveBudget(runtime.db, secondTask, null, 100);
    const ts = new Date().toISOString();
    for (const [sequence, task, status, amount] of [
      [1, firstTask, "unknown", 100],
      [2, secondTask, "incurred_estimate", 2],
    ]) {
      run(
        runtime.db,
        `INSERT INTO model_calls
         (id, workflow_id, task_id, provider, model_class, selected_model, mode, status,
          input_tokens, output_tokens, estimated_cost_cents, actual_cost_cents,
          approval_required, metadata, created_at, venture_id, provider_request_id,
          cost_status, reserved_cost_cents, incurred_estimate_cents, reconciled_cost_cents,
          outcome_status)
         VALUES (?, ?, ?, 'openai', 'live-ai-worker', 'gpt-test', 'live', ?,
                 10, 5, ?, 0, 1, '{}', ?, ?, ?, ?, 100, ?, 0, ?)`,
        [
          `model-reconcile-${sequence}`,
          task.workflow_id,
          task.id,
          status === "unknown" ? "failed" : "completed",
          amount,
          ts,
          task.venture_id,
          `response-reconcile-${sequence}`,
          status,
          status === "unknown" ? 0 : amount,
          status === "unknown" ? "unknown" : "known",
        ],
      );
      run(
        runtime.db,
        `INSERT INTO costs
         (id, workflow_id, category, source, status, amount_cents, currency, occurred_at, metadata, venture_id)
         VALUES (?, ?, 'live_ai_worker', 'openai-agents-sdk', ?, ?, 'AUD', ?, '{}', ?)`,
        [`cost-reconcile-${sequence}`, task.workflow_id, status, amount, ts, task.venture_id],
      );
      run(
        runtime.db,
        "UPDATE tasks SET status = ?, outcome_status = ?, result = ? WHERE id = ?",
        [
          status === "unknown" ? "needs_attention" : "completed",
          status === "unknown" ? "unknown" : "known",
          toJson({ cost: { estimatedCents: amount, actualCents: 0, exactBillingPending: true } }),
          task.id,
        ],
      );
    }
    run(
      runtime.db,
      `INSERT INTO messages
       (id, task_id, severity, status, subject, body, created_at, metadata, venture_id)
       VALUES ('msg-provider-reconcile', ?, 'urgent', 'open', ?, ?, ?, '{}', ?)`,
      [
        firstTask.id,
        `Check provider outcome: ${firstTask.title}`,
        "Do not retry until the provider outcome and cost are reconciled.",
        ts,
        firstTask.venture_id,
      ],
    );

    const allocations = [
      {
        taskId: firstTask.id,
        costId: "cost-reconcile-1",
        modelCallId: "model-reconcile-1",
        amountCents: 3,
        taskStatus: "failed",
        outcomeStatus: "known",
        workflowStatus: "failed",
        workflowStep: "Initial provider call reconciled as a known technical failure.",
        allocationMethod: "aggregate_total_less_known_success_estimate",
      },
      {
        taskId: secondTask.id,
        costId: "cost-reconcile-2",
        modelCallId: "model-reconcile-2",
        amountCents: 2,
        taskStatus: "completed",
        outcomeStatus: "known",
        allocationMethod: "published_token_estimate_within_aggregate_total",
      },
    ];
    assert.throws(
      () => reconcileProviderUsageBatch(runtime.db, {
        ventureId: firstTask.venture_id,
        provider: "openai",
        totalAudCents: 4,
        evidence: { source: "provider_usage_dashboard" },
        allocations,
      }),
      /add up exactly/i,
    );
    assert.throws(
      () => reconcileProviderUsageBatch(runtime.db, {
        ventureId: firstTask.venture_id,
        provider: "another-provider",
        totalAudCents: 5,
        evidence: { source: "provider_usage_dashboard" },
        allocations,
      }),
      /provider does not match/i,
    );
    assert.throws(
      () => reconcileProviderUsageBatch(runtime.db, {
        ventureId: firstTask.venture_id,
        provider: "openai",
        totalAudCents: 5,
        evidence: { source: "provider_usage_dashboard" },
        allocations: [{ ...allocations[0], taskStatus: "invented" }, allocations[1]],
      }),
      /unsupported task status/i,
    );
    assert.equal(get(runtime.db, "SELECT status FROM costs WHERE id = 'cost-reconcile-1'").status, "unknown");

    const reconciled = reconcileProviderUsageBatch(runtime.db, {
      batchId: "provider-reconciliation-test",
      ventureId: firstTask.venture_id,
      provider: "openai",
      totalAudCents: 5,
      reconciledBy: "test",
      evidence: {
        source: "provider_usage_dashboard",
        requests: 2,
        totalTokens: 2742,
        totalUsd: 0.03,
        audPerUsd: 1.579,
      },
      allocations,
    });
    assert.equal(reconciled.totalAudCents, 5);
    assert.equal(reservedThisMonth(runtime.db), 0);
    assert.deepEqual(
      all(runtime.db, "SELECT status, amount_cents FROM costs WHERE id LIKE 'cost-reconcile-%' ORDER BY id")
        .map((row) => [row.status, row.amount_cents]),
      [["reconciled", 3], ["reconciled", 2]],
    );
    assert.equal(get(runtime.db, "SELECT status, outcome_status, cost_actual_cents FROM tasks WHERE id = ?", [firstTask.id]).status, "failed");
    assert.equal(get(runtime.db, "SELECT outcome_status FROM tasks WHERE id = ?", [firstTask.id]).outcome_status, "known");
    assert.equal(get(runtime.db, "SELECT cost_actual_cents FROM tasks WHERE id = ?", [firstTask.id]).cost_actual_cents, 3);
    assert.equal(get(runtime.db, "SELECT cost_status FROM model_calls WHERE id = 'model-reconcile-2'").cost_status, "reconciled");
    assert.equal(get(runtime.db, "SELECT actual_cost_cents FROM model_calls WHERE id = 'model-reconcile-2'").actual_cost_cents, 2);
    const secondResult = JSON.parse(get(runtime.db, "SELECT result FROM tasks WHERE id = ?", [secondTask.id]).result);
    assert.equal(secondResult.cost.actualCents, 2);
    assert.equal(secondResult.cost.exactBillingPending, false);
    assert.equal(secondResult.costReconciliation.aggregateProviderEvidence, true);
    assert.equal(get(runtime.db, "SELECT status FROM messages WHERE id = 'msg-provider-reconcile'").status, "resolved");
    assert.equal(get(runtime.db, "SELECT COUNT(*) AS count FROM events WHERE type = 'provider_usage.batch_reconciled'").count, 1);
    run(runtime.db, "UPDATE messages SET status = 'open', resolved_at = NULL WHERE id = 'msg-provider-reconcile'");
    const tracedAllocations = allocations.map((allocation, index) => ({
      ...allocation,
      responseId: `response-reconcile-${index + 1}`,
      agentSdkTraceId: `trace_${String(index + 1).repeat(32)}`,
    }));
    const repeated = reconcileProviderUsageBatch(runtime.db, {
      batchId: "provider-reconciliation-test",
      ventureId: firstTask.venture_id,
      provider: "openai",
      totalAudCents: 5,
      reconciledBy: "test",
      evidence: { source: "provider_usage_dashboard" },
      allocations: tracedAllocations,
    });
    assert.equal(repeated.alreadyReconciled, true);
    assert.equal(get(runtime.db, "SELECT status FROM messages WHERE id = 'msg-provider-reconcile'").status, "resolved");
    assert.equal(get(runtime.db, "SELECT COUNT(*) AS count FROM events WHERE type = 'provider_usage.batch_reconciled'").count, 1);
    const tracedModelCall = get(runtime.db, "SELECT metadata FROM model_calls WHERE id = 'model-reconcile-2'");
    assert.equal(JSON.parse(tracedModelCall.metadata).agentSdkTraceId, `trace_${"2".repeat(32)}`);
    const tracedTask = get(runtime.db, "SELECT result FROM tasks WHERE id = ?", [secondTask.id]);
    assert.equal(JSON.parse(tracedTask.result).providerTrace.id, `trace_${"2".repeat(32)}`);
    assert.equal(collectFindings(runtime.db).some((finding) => finding.title.includes("failed task")), false);
  } finally {
    closeRuntime(runtime);
  }
});

test("approved setup-blocked work becomes resumable when its credential requirement appears", async () => {
  const runtime = runtimeDb("setup-recovery");
  const previousKey = process.env.OPENAI_API_KEY;
  const previousLiveModels = process.env.JARVIS_ENABLE_LIVE_MODELS;
  const previousDisabledAdapter = process.env.JARVIS_DISABLE_LIVE_AI_WORKER_ADAPTER;
  const previousDisabledSdk = process.env.JARVIS_DISABLE_OPENAI_AGENTS_SDK;
  delete process.env.OPENAI_API_KEY;
  process.env.JARVIS_ENABLE_LIVE_MODELS = "1";
  delete process.env.JARVIS_DISABLE_LIVE_AI_WORKER_ADAPTER;
  delete process.env.JARVIS_DISABLE_OPENAI_AGENTS_SDK;
  try {
    const planned = createCommandPlan(runtime.db, {
      text: "Evaluate a cash checklist digital product",
      source: "test",
      createFiles: false,
    });
    run(runtime.db, "UPDATE tasks SET status = 'cancelled' WHERE workflow_id = ?", [planned.workflow.id]);
    const requested = requestLiveAiWorker(runtime.db, planned.workflow.id, {
      worker: "demand_validator",
      model: "gpt-5.6-terra",
      estimatedCostCents: 100,
      maxOutputTokens: 600,
    });
    decideApproval(runtime.db, requested.approval.id, "approved", "setup recovery proof", {
      expectedScopeHash: requested.approval.scope_hash,
    });
    const blocked = await runOnce(runtime.db, { taskId: requested.task.id });
    assert.equal(blocked.status, "blocked");
    assert.equal(get(runtime.db, "SELECT status FROM tasks WHERE id = ?", [requested.task.id]).status, "blocked");
    const blockedTask = get(runtime.db, "SELECT setup_block_reason, result FROM tasks WHERE id = ?", [requested.task.id]);
    assert.match(blockedTask.setup_block_reason, /incomplete/i);
    assert.match(blockedTask.result, /OPENAI_API_KEY/);

    process.env.OPENAI_API_KEY = "configured-for-test";
    const recovered = recoverSetupBlockedTasks(runtime.db);
    assert.deepEqual(recovered.recovered, [requested.task.id]);
    const resumed = get(runtime.db, "SELECT status, setup_block_reason FROM tasks WHERE id = ?", [requested.task.id]);
    assert.equal(resumed.status, "queued");
    assert.equal(resumed.setup_block_reason, null);
  } finally {
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousKey;
    if (previousLiveModels === undefined) delete process.env.JARVIS_ENABLE_LIVE_MODELS;
    else process.env.JARVIS_ENABLE_LIVE_MODELS = previousLiveModels;
    if (previousDisabledAdapter === undefined) delete process.env.JARVIS_DISABLE_LIVE_AI_WORKER_ADAPTER;
    else process.env.JARVIS_DISABLE_LIVE_AI_WORKER_ADAPTER = previousDisabledAdapter;
    if (previousDisabledSdk === undefined) delete process.env.JARVIS_DISABLE_OPENAI_AGENTS_SDK;
    else process.env.JARVIS_DISABLE_OPENAI_AGENTS_SDK = previousDisabledSdk;
    closeRuntime(runtime);
  }
});

test("Demand Validator pilot preparation excludes the protected baseline and never repeats a fixture", () => {
  const runtime = runtimeDb("pilot-isolation");
  try {
    const fixture = ensureDemandValidatorPilotFixture(runtime.db);
    const stored = get(runtime.db, "SELECT * FROM agent_pilot_fixtures WHERE id = ?", [fixture.id]);
    const prepared = prepareDemandValidatorPilot(runtime.db, fixture.id);
    const taskPayload = JSON.parse(get(runtime.db, "SELECT payload FROM tasks WHERE id = ?", [prepared.requested.task.id]).payload);
    const serialized = JSON.stringify(taskPayload);

    assert.ok(stored.baseline_output.length > 2);
    assert.ok(stored.baseline_hash);
    assert.equal(serialized.includes("protectedBaseline"), false);
    assert.equal(serialized.includes(stored.baseline_hash), false);
    assert.equal(taskPayload.pilotFixture.hash, fixture.fixture_hash);
    assert.deepEqual(taskPayload.liveSpendRequest.tools, []);
    assert.deepEqual(taskPayload.liveSpendRequest.effects, []);
    assert.equal(taskPayload.liveSpendRequest.maxTurns, 1);
    assert.equal(taskPayload.liveSpendRequest.tracePolicy.providerResponseStored, true);
    assert.equal(taskPayload.liveSpendRequest.tracePolicy.providerTraceContent, true);
    assert.equal(taskPayload.liveSpendRequest.tracePolicy.localReviewStored, true);
    assert.equal(get(runtime.db, "SELECT COUNT(*) AS count FROM agent_runs").count, 0);
    assert.throws(() => prepareDemandValidatorPilot(runtime.db, fixture.id), /already prepared or completed/i);

    for (let sequence = 2; sequence <= 5; sequence += 1) {
      createPilotFixture(runtime.db, {
        id: `pilot-fixture-${sequence}`,
        question: `Should fixture ${sequence} advance?`,
        buyer: `Buyer segment ${sequence}`,
        hypothesis: `Hypothesis ${sequence}`,
        sources: [{ id: `source-${sequence}`, title: `Source ${sequence}`, sourceType: "test_fixture", summary: "Evaluation evidence only." }],
        constraints: { evaluationOnly: true },
      });
    }
    assert.throws(
      () => createPilotFixture(runtime.db, {
        id: "pilot-fixture-6",
        question: "Should fixture 6 advance?",
        buyer: "Buyer segment 6",
        hypothesis: "Hypothesis 6",
        sources: [{ id: "source-6", title: "Source 6", sourceType: "test_fixture", summary: "Evaluation evidence only." }],
      }),
      /limited to five distinct fixtures/i,
    );
  } finally {
    closeRuntime(runtime);
  }
});

test("Demand Validator technical retry preserves the unknown attempt and creates a fresh scoped approval", () => {
  const runtime = runtimeDb("pilot-technical-retry");
  try {
    const fixture = ensureDemandValidatorPilotFixture(runtime.db);
    const first = prepareDemandValidatorPilot(runtime.db, fixture.id);
    const firstTask = get(runtime.db, "SELECT * FROM tasks WHERE id = ?", [first.requested.task.id]);
    const firstScope = ensureApprovalScope(runtime.db, first.requested.approval.id);
    decideApproval(runtime.db, first.requested.approval.id, "approved", "approve first controlled proof", {
      expectedScopeHash: firstScope.scopeHash,
    });
    consumeApproval(runtime.db, first.requested.approval.id, firstTask);
    run(runtime.db, "UPDATE tasks SET status = 'needs_attention', error = ? WHERE id = ?", [
      "Structured output was not captured.",
      firstTask.id,
    ]);

    assert.throws(
      () => prepareDemandValidatorPilotRetry(runtime.db, fixture.id, { previousTaskId: firstTask.id }),
      /explicitly acknowledged/i,
    );
    assert.throws(
      () => prepareDemandValidatorPilotRetry(runtime.db, fixture.id, {
        previousTaskId: "wrong-task",
        acknowledgeUnknownOutcome: true,
      }),
      /does not match/i,
    );

    const second = prepareDemandValidatorPilotRetry(runtime.db, fixture.id, {
      previousTaskId: firstTask.id,
      acknowledgeUnknownOutcome: true,
      operatorNote: "Approve one corrected attempt under the unchanged A$1 cap.",
      requestedBy: "daniel",
    });
    const preserved = get(runtime.db, "SELECT status, error FROM tasks WHERE id = ?", [firstTask.id]);
    const firstApproval = get(runtime.db, "SELECT consumed_at, scope_hash FROM approvals WHERE id = ?", [first.requested.approval.id]);
    const secondApproval = ensureApprovalScope(runtime.db, second.requested.approval.id);
    const secondPayload = JSON.parse(get(runtime.db, "SELECT payload FROM tasks WHERE id = ?", [second.requested.task.id]).payload);

    assert.equal(preserved.status, "needs_attention");
    assert.equal(preserved.error, "Structured output was not captured.");
    assert.ok(firstApproval.consumed_at);
    assert.notEqual(second.requested.task.id, firstTask.id);
    assert.notEqual(second.requested.approval.id, first.requested.approval.id);
    assert.notEqual(secondApproval.scopeHash, firstApproval.scope_hash);
    assert.equal(second.requested.approval.status, "pending");
    assert.equal(secondPayload.liveSpendRequest.parameters.attemptNumber, 2);
    assert.equal(secondPayload.liveSpendRequest.parameters.retryOfTaskId, firstTask.id);
    assert.equal(secondPayload.liveSpendRequest.parameters.priorOutcome, "unknown");
    assert.equal(get(runtime.db, "SELECT COUNT(*) AS count FROM tasks WHERE kind = 'live_ai_worker_execution'").count, 2);
    assert.equal(get(runtime.db, "SELECT COUNT(*) AS count FROM events WHERE type = 'agent_pilot.unknown_outcome_acknowledged'").count, 1);
    assert.equal(get(runtime.db, "SELECT COUNT(*) AS count FROM events WHERE type = 'agent_pilot.technical_retry_prepared'").count, 1);

    run(runtime.db, "UPDATE tasks SET status = 'completed', outcome_status = 'known', completed_at = ? WHERE id = ?", [
      new Date().toISOString(),
      second.requested.task.id,
    ]);
    const firstAttemptWork = getCockpitState(runtime.db).importantWork.find((item) => item.id === firstTask.id);
    assert.match(firstAttemptWork.title, /first call billing check/i);
    assert.match(firstAttemptWork.recommendation, /corrected run completed successfully/i);
    assert.doesNotMatch(firstAttemptWork.recommendation, /before retrying/i);

    run(runtime.db, "UPDATE tasks SET status = 'needs_attention' WHERE id = ?", [second.requested.task.id]);
    assert.throws(
      () => prepareDemandValidatorPilotRetry(runtime.db, fixture.id, {
        previousTaskId: second.requested.task.id,
        acknowledgeUnknownOutcome: true,
      }),
      /limited to one history-preserving technical retry/i,
    );
  } finally {
    closeRuntime(runtime);
  }
});

test("capability autonomy requires five reviewed successes and explicit operator promotion", () => {
  const runtime = runtimeDb("capability-promotion");
  try {
    let capability;
    for (let index = 0; index < 5; index += 1) {
      capability = recordCapabilityReview(runtime.db, PILOT_CAPABILITY, {
        operatorReviewed: true,
        useful: true,
        scopeViolation: false,
        costViolation: false,
        riskViolation: false,
        outcomeKnown: true,
        fixtureSequence: index + 1,
      });
    }
    assert.equal(capability.status, "eligible");
    assert.equal(capability.consecutive_passes, 5);
    capability = promoteCapability(runtime.db, PILOT_CAPABILITY, "reviewed proof");
    assert.equal(capability.status, "promoted");

    capability = recordCapabilityReview(runtime.db, PILOT_CAPABILITY, {
      operatorReviewed: true,
      useful: false,
      scopeViolation: false,
      costViolation: false,
      riskViolation: false,
      outcomeKnown: true,
    });
    assert.equal(capability.status, "suspended");
    assert.equal(capability.consecutive_passes, 0);
    assert.ok(get(runtime.db, "SELECT id FROM messages WHERE subject = 'Worker capability needs review' AND status = 'open'"));
  } finally {
    closeRuntime(runtime);
  }
});

test("Gumroad imports are idempotent and retain no raw buyer identity", () => {
  const runtime = runtimeDb("gumroad-import");
  const csv = [
    "Purchase ID,Item Name,Purchase Date,Sale Price ($),Fees ($),Net Total ($),Email,Referrer,Fully Refunded?",
    "sale-001,Cash Control Checklist,2026-07-14,12.00,1.70,10.30,buyer@example.com,https://example.com/article,false",
  ].join("\n");
  try {
    const options = { hashKey: "test-only-privacy-hash-key-32-bytes" };
    const importPayload = {
      ventureId: "venture-digital-products",
      csvText: csv,
      currency: "USD",
      audConversionRate: 1.5,
      audConversionEvidence: "Test bank conversion reference",
      audConversionAt: "2026-07-14T10:00:00.000Z",
    };
    const first = importGumroadCsv(runtime.db, importPayload, options);
    const second = importGumroadCsv(runtime.db, importPayload, options);
    assert.equal(first.inserted, 1);
    assert.equal(second.inserted, 0);
    assert.equal(second.updated, 1);
    assert.equal(get(runtime.db, "SELECT COUNT(*) AS count FROM platform_sales").count, 1);

    const stored = get(runtime.db, "SELECT * FROM platform_sales WHERE platform_purchase_id = 'sale-001'");
    assert.match(stored.buyer_hash, /^[a-f0-9]{64}$/);
    assert.equal(stored.referrer, "example.com");
    assert.equal(JSON.stringify(stored).includes("buyer@example.com"), false);
    const publicState = getGumroadSalesState(runtime.db);
    assert.equal(Object.hasOwn(publicState.sales[0], "buyer_hash"), false);
    assert.equal(publicState.economics.independentBuyers, 1);
    assert.equal(publicState.economics.cashContributionCents, 1545);
    assert.equal(publicState.economics.successThresholdMet, false);
  } finally {
    closeRuntime(runtime);
  }
});

test("weekly executive digest is concise, idempotent, and does not create an interruption", () => {
  const runtime = runtimeDb("weekly-digest");
  try {
    const urgentBefore = get(runtime.db, "SELECT COUNT(*) AS count FROM messages WHERE status = 'open' AND severity = 'urgent'").count;
    const first = generateWeeklyDigest(runtime.db, { at: "2026-07-14T12:00:00.000Z" });
    const second = generateWeeklyDigest(runtime.db, { at: "2026-07-16T12:00:00.000Z" });
    assert.equal(second.id, first.id);
    assert.equal(get(runtime.db, "SELECT COUNT(*) AS count FROM executive_digests").count, 1);
    assert.match(second.summary, /paying buyer/i);
    assert.ok(second.nextActions.includes("Rank three digital-product opportunities and select one evidence-backed test."));
    assert.equal(get(runtime.db, "SELECT COUNT(*) AS count FROM messages WHERE status = 'open' AND severity = 'urgent'").count, urgentBefore);
  } finally {
    closeRuntime(runtime);
  }
});

test("system activity keeps business events and hides housekeeping jargon", () => {
  const runtime = runtimeDb("plain-activity");
  const ts = new Date().toISOString();
  try {
    run(
      runtime.db,
      `INSERT INTO events
       (ts, level, actor, type, entity_type, entity_id, message, metadata, venture_id)
       VALUES (?, 'info', 'scheduler', 'scheduler.job.completed', 'scheduler_job', 'job-test',
               'Scheduler job test completed.', '{}', 'venture-digital-products')`,
      [ts],
    );
    run(
      runtime.db,
      `INSERT INTO events
       (ts, level, actor, type, entity_type, entity_id, message, metadata, venture_id)
       VALUES (?, 'info', 'demand_validator', 'task.completed', 'task', 'task-test',
               'Prepare the Evidence Brief completed by the dry-run agent runner.', '{}', 'venture-digital-products')`,
      [ts],
    );
    const activity = getSystemState(runtime.db).activity;
    assert.equal(activity.some((event) => event.type === "scheduler.job.completed"), false);
    assert.ok(activity.some((event) => event.message === "Prepare the Evidence Brief is ready."));
    assert.equal(activity.some((event) => /dry[- ]run|scheduler\.job/i.test(event.message)), false);
  } finally {
    closeRuntime(runtime);
  }
});

test("commercial tests only become running after a confirmed real-world start", () => {
  const runtime = runtimeDb("honest-test-state");
  try {
    const experiment = createCommercialExperiment(runtime.db, {
      name: "Real-world state proof",
      buyer: "Solo consultants",
      offer: "Cash checklist",
      channel: "Gumroad Direct",
    });
    assert.equal(experiment.status, "candidate");
    assert.equal(experiment.started_at, null);
    assert.throws(
      () => createCommercialExperiment(runtime.db, { name: "False start", status: "running" }),
      /real-world start/i,
    );
    assert.throws(() => setExperimentState(runtime.db, experiment.id, "running"), /real-world start/i);
    const running = setExperimentState(runtime.db, experiment.id, "running", { realStart: true });
    assert.equal(running.status, "running");
    assert.ok(running.started_at);
    assert.equal(JSON.parse(running.metadata).realStartConfirmed, true);

    recordEvidence(runtime.db, {
      ventureId: "venture-digital-products",
      sourceType: "test_fixture",
      title: "Evaluation-only fixture",
      isDemo: true,
    });
    recordEvidence(runtime.db, {
      ventureId: "venture-digital-products",
      sourceType: "operator_observation",
      title: "Real operator observation",
    });
    const foundation = commercialFoundationState(runtime.db);
    assert.deepEqual(foundation.evidence.map((item) => item.title), ["Real operator observation"]);
  } finally {
    closeRuntime(runtime);
  }
});

test("local HTTP mutations and WebSocket updates require the same signed operator session", async () => {
  const runtime = runtimeDb("local-security");
  const app = createApp({
    db: runtime.db,
    security: true,
    sessionSecret: Buffer.alloc(32, 7),
    bootstrapSecret: "test-bootstrap-secret",
  });
  await new Promise((resolve, reject) => {
    app.server.once("error", reject);
    app.server.listen(0, "127.0.0.1", resolve);
  });
  const port = app.server.address().port;
  const origin = `http://127.0.0.1:${port}`;
  const websocketUrl = `ws://127.0.0.1:${port}`;
  try {
    assert.equal(app.server.requestTimeout, 15_000);
    assert.equal(app.server.headersTimeout, 10_000);
    assert.equal(app.server.keepAliveTimeout, 5_000);
    assert.equal(app.server.maxHeadersCount, 100);

    const unauthenticatedRead = await fetch(`${origin}/api/cockpit`);
    assert.equal(unauthenticatedRead.status, 401);

    const rejectedHostStatus = await new Promise((resolve, reject) => {
      const request = http.request({
        host: "127.0.0.1",
        port,
        path: "/api/health",
        headers: { Host: "untrusted.example" },
      }, (response) => {
        response.resume();
        response.once("end", () => resolve(response.statusCode));
      });
      request.once("error", reject);
      request.end();
    });
    assert.equal(rejectedHostStatus, 403);

    const sessionResponse = await fetch(`${origin}/api/session`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin,
        "x-jarvis-bootstrap": "test-bootstrap-secret",
      },
      body: "{}",
    });
    const session = await sessionResponse.json();
    const cookie = sessionResponse.headers.get("set-cookie").split(";", 1)[0];
    assert.equal(sessionResponse.status, 201);

    const focusedReads = {
      "/api/ventures": "ventures",
      "/api/cockpit": "activeVenture",
      "/api/decisions": "approvals",
      "/api/tests": "tests",
      "/api/ai-team": "agents",
      "/api/system": "health",
    };
    for (const [endpoint, key] of Object.entries(focusedReads)) {
      const response = await fetch(`${origin}${endpoint}`, { headers: { cookie } });
      const payload = await response.json();
      assert.equal(response.status, 200);
      assert.equal(Object.hasOwn(payload, key), true, `${endpoint} should expose ${key}`);
    }

    const unrestrictedState = await fetch(`${origin}/api/state`, { headers: { cookie } });
    assert.equal(unrestrictedState.status, 410);

    const siblingRoot = path.join(__dirname, "..", `publicity-security-${Date.now()}`);
    fs.mkdirSync(siblingRoot, { recursive: true });
    fs.writeFileSync(path.join(siblingRoot, "outside.txt"), "must not be served");
    try {
      const traversalStatus = await new Promise((resolve, reject) => {
        const request = http.request({
          host: "127.0.0.1",
          port,
          path: `/%2e%2e%2f${encodeURIComponent(path.basename(siblingRoot))}%2foutside.txt`,
          headers: { Cookie: cookie },
        }, (response) => {
          response.resume();
          response.once("end", () => resolve(response.statusCode));
        });
        request.once("error", reject);
        request.end();
      });
      assert.equal([403, 404].includes(traversalStatus), true);
    } finally {
      fs.rmSync(siblingRoot, { recursive: true, force: true });
    }

    const outsidePreviewPath = path.join(__dirname, "..", "tmp", `outside-preview-${Date.now()}.pdf`);
    fs.mkdirSync(path.dirname(outsidePreviewPath), { recursive: true });
    fs.writeFileSync(outsidePreviewPath, "%PDF-1.4\n%%EOF\n");
    const deliverable = get(runtime.db, "SELECT id FROM deliverables LIMIT 1");
    run(runtime.db, "UPDATE deliverables SET format = 'pdf', file_path = ? WHERE id = ?", [outsidePreviewPath, deliverable.id]);
    try {
      const outsidePreview = await fetch(`${origin}/api/deliverables/${encodeURIComponent(deliverable.id)}/file`, { headers: { cookie } });
      assert.equal(outsidePreview.status, 403);
    } finally {
      fs.rmSync(outsidePreviewPath, { force: true });
    }

    const rejected = await fetch(`${origin}/api/monitor/run`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    assert.equal(rejected.status, 401);

    const accepted = await fetch(`${origin}/api/monitor/run`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin,
        cookie,
        "x-jarvis-csrf": session.csrfToken,
      },
      body: "{}",
    });
    assert.equal(accepted.status, 200);

    const malformedJson = await fetch(`${origin}/api/monitor/run`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin,
        cookie,
        "x-jarvis-csrf": session.csrfToken,
      },
      body: "{",
    });
    assert.equal(malformedJson.status, 400);

    const oversizedJson = await fetch(`${origin}/api/monitor/run`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin,
        cookie,
        "x-jarvis-csrf": session.csrfToken,
      },
      body: JSON.stringify({ padding: "x".repeat(1_000_000) }),
    });
    assert.equal(oversizedJson.status, 413);

    const websocketRejection = await new Promise((resolve, reject) => {
      const socket = new WebSocket(websocketUrl, { headers: { Origin: origin } });
      socket.once("unexpected-response", (_request, response) => resolve(response.statusCode));
      socket.once("open", () => reject(new Error("WebSocket unexpectedly opened without a signed session.")));
      socket.once("error", () => {});
    });
    assert.equal(websocketRejection, 403);

    const connected = await new Promise((resolve, reject) => {
      const socket = new WebSocket(websocketUrl, { headers: { Origin: origin, Cookie: cookie } });
      socket.once("message", (data) => {
        resolve(JSON.parse(data.toString()));
        socket.close();
      });
      socket.once("error", reject);
    });
    assert.equal(connected.type, "connected");
  } finally {
    for (const client of app.wss.clients) client.terminate();
    await new Promise((resolve) => app.server.close(resolve));
    app.wss.close();
    closeRuntime(runtime);
  }
});
