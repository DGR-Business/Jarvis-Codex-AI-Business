const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const {
  LATEST_SCHEMA_VERSION,
  all,
  get,
  openDatabase,
  putSetting,
  run,
  seedDatabase,
  toJson,
} = require("../src/db");
const {
  getAccountingSummary,
  recordAccountingCorrection,
  recordAccountingEntry,
} = require("../src/runtime/accounting-ledger");
const {
  createCommercialExperiment,
  recordCommercialFeedback,
  recordCommercialResult,
  summarizeCommercialEvidence,
} = require("../src/runtime/commercial-results");
const {
  EMPTY_OPERATIONAL_TABLES,
  STATIC_COUNTS,
  USAGE_SURVIVORS,
  assertRuntimeStopped,
  buildFirstUseDatabase,
  verifyFirstUseDatabase,
} = require("../src/runtime/first-use-reset");
const { importGumroadCsv } = require("../src/runtime/gumroad-import");
const {
  createPreventureResearchStore,
} = require("../src/runtime/preventure-research-store");
const { ensureRetentionPolicy } = require("../src/runtime/retention-policy");
const { commercialFoundationState, recordEvidence } = require("../src/runtime/venture-case");
const preventureAuthority = require("../config/preventure-research-authority-smm-scope-guard-v1");
const preventureReadiness = require("../config/commercial-readiness-social-media-manager-scope-guard-v1");

function testRuntime(name, options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `jarvis-clean-slate-${name}-`));
  const dbPath = path.join(root, "runtime.sqlite");
  const db = openDatabase(dbPath);
  seedDatabase(db, options);
  return { root, dbPath, db };
}

function closeRuntime(runtime) {
  if (runtime.db) runtime.db.close();
  fs.rmSync(runtime.root, { recursive: true, force: true });
}

const GUMROAD_CSV = [
  "Purchase ID,Item Name,Purchase Date,Sale Price ($),Fees ($),Net Total ($),Email,Referrer,Fully Refunded?",
  "sale-001,Cash Control Checklist,2026-07-14,12.00,1.70,10.30,buyer@example.com,direct,false",
].join("\n");

const SCHEMA_27_PREVENTURE_OPERATIONAL_TABLES = Object.freeze([
  "preventure_research_approval_decisions",
  "preventure_research_assignment_skips",
  "preventure_research_assignments",
  "preventure_research_authorities",
  "preventure_research_cost_events",
  "preventure_research_decisions",
  "preventure_research_evidence_records",
  "preventure_research_lifecycle_events",
  "preventure_research_provider_billing_observations",
  "preventure_research_source_snapshots",
  "preventure_research_terminal_recoveries",
  "preventure_research_terminal_stops",
]);

test("first-use reset removes proof evaluations before their immutable parent contracts", () => {
  const evaluationIndex = EMPTY_OPERATIONAL_TABLES.indexOf(
    "commercial_test_proof_evaluations",
  );
  const evidenceIndex = EMPTY_OPERATIONAL_TABLES.indexOf(
    "commercial_test_evidence_records",
  );
  const contractIndex = EMPTY_OPERATIONAL_TABLES.indexOf(
    "commercial_test_contracts",
  );
  assert.ok(evaluationIndex >= 0);
  assert.ok(evidenceIndex > evaluationIndex);
  assert.ok(contractIndex > evidenceIndex);
});

test("first-use reset explicitly empties every schema-27 preventure operational table", () => {
  const runtime = testRuntime("schema-27-reset-contract");
  try {
    const actualTables = all(
      runtime.db,
      `SELECT name FROM sqlite_schema
       WHERE type = 'table' AND name GLOB 'preventure_research_*'
       ORDER BY name`,
    ).map((row) => row.name);
    assert.deepEqual(actualTables, [...SCHEMA_27_PREVENTURE_OPERATIONAL_TABLES].sort());
    for (const table of SCHEMA_27_PREVENTURE_OPERATIONAL_TABLES) {
      assert.ok(EMPTY_OPERATIONAL_TABLES.includes(table), table);
    }
  } finally {
    closeRuntime(runtime);
  }
});

test("database startup enforces the current schema and one active venture", () => {
  const runtime = testRuntime("schema");
  try {
    assert.equal(get(runtime.db, "SELECT MAX(version) AS version FROM schema_migrations").version, LATEST_SCHEMA_VERSION);
    assert.equal(get(runtime.db, "PRAGMA busy_timeout").timeout, 5000);
    assert.throws(
      () => run(
        runtime.db,
        `INSERT INTO ventures
         (id, name, stage, status, summary, metadata, created_at, updated_at, lifecycle_stage, is_active, business_model)
         VALUES ('second-active', 'Second', 1, 'candidate', '', '{}', '2026-07-17', '2026-07-17', 'candidate', 1, 'digital_product')`,
      ),
      /unique/i,
    );
  } finally {
    closeRuntime(runtime);
  }

  const root = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-future-schema-"));
  const dbPath = path.join(root, "runtime.sqlite");
  const raw = new DatabaseSync(dbPath);
  raw.exec("CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)");
  raw.prepare("INSERT INTO schema_migrations VALUES (?, ?, ?)").run(99, "future", "2026-07-17T00:00:00.000Z");
  raw.close();
  try {
    assert.throws(() => openDatabase(dbPath), /newer than supported schema/i);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("commercial reads never overwrite operator settings", () => {
  const runtime = testRuntime("pure-settings");
  try {
    putSetting(runtime.db, "operator.workload", {
      targetMinutesPerWeek: 321,
      intensiveWeekMaximumMinutes: 654,
      timeValueCentsPerHour: 7777,
    });
    putSetting(runtime.db, "budget", {
      monthlyBudgetCents: 4321,
      currency: "AUD",
      notes: "Operator-owned value",
    });
    const before = all(
      runtime.db,
      "SELECT key, value, updated_at FROM settings WHERE key IN ('operator.workload', 'budget') ORDER BY key",
    );
    commercialFoundationState(runtime.db);
    commercialFoundationState(runtime.db);
    const after = all(
      runtime.db,
      "SELECT key, value, updated_at FROM settings WHERE key IN ('operator.workload', 'budget') ORDER BY key",
    );
    assert.deepEqual(after, before);
  } finally {
    closeRuntime(runtime);
  }
});

test("Gumroad foreign currency requires evidence and stores separate source and AUD amounts", () => {
  const runtime = testRuntime("gumroad-aud");
  const privacy = { hashKey: "test-only-privacy-hash-key-32-bytes" };
  try {
    assert.throws(
      () => importGumroadCsv(runtime.db, { ventureId: "venture-digital-products", csvText: GUMROAD_CSV, currency: "USD" }, privacy),
      /AUD conversion rate is required/i,
    );
    assert.equal(get(runtime.db, "SELECT COUNT(*) AS count FROM platform_sales").count, 0);
    assert.throws(
      () => importGumroadCsv(
        runtime.db,
        { ventureId: "venture-digital-products", csvText: GUMROAD_CSV, currency: "USD", audConversionRate: 1.5 },
        privacy,
      ),
      /AUD conversion evidence is required/i,
    );

    const imported = importGumroadCsv(
      runtime.db,
      {
        ventureId: "venture-digital-products",
        csvText: GUMROAD_CSV,
        currency: "USD",
        audConversionRate: 1.5,
        audConversionEvidence: "Bank conversion reference FX-2026-07-14",
        audConversionAt: "2026-07-14T10:00:00.000Z",
      },
      privacy,
    );
    const stored = get(runtime.db, "SELECT * FROM platform_sales WHERE platform_purchase_id = 'sale-001'");
    assert.equal(stored.currency, "USD");
    assert.equal(stored.gross_cents, 1200);
    assert.equal(stored.platform_fee_cents, 170);
    assert.equal(stored.aud_gross_cents, 1800);
    assert.equal(stored.aud_platform_fee_cents, 255);
    assert.equal(stored.aud_net_cents, 1545);
    assert.equal(stored.aud_conversion_rate, 1.5);
    assert.equal(imported.economics.salesCurrency, "AUD");
    assert.deepEqual(imported.economics.sourceCurrencies, ["USD"]);
    assert.equal(imported.economics.cashContributionCents, 1545);
    assert.equal(imported.economics.currencyMismatch, false);
  } finally {
    closeRuntime(runtime);
  }
});

test("legacy commercial evidence never verifies sales or cash truth", () => {
  const runtime = testRuntime("verified-results");
  try {
    const experiment = createCommercialExperiment(runtime.db, {
      ventureId: "venture-digital-products",
      name: "Commercial truth test",
      buyer: "Independent consultants",
      offer: "Cash control checklist",
      channel: "Gumroad Direct",
      targetValue: 3,
      targetUnit: "sales",
    });
    const unverified = recordCommercialResult(runtime.db, {
      experimentId: experiment.id,
      source: "operator_observation",
      views: 100,
      sales: 8,
      revenueCents: 8000,
      spendCents: 500,
    });
    assert.equal(unverified.verified, false);
    assert.equal(unverified.learning, null);
    assert.equal(unverified.aiTeamRun, null);
    assert.equal(get(runtime.db, "SELECT COUNT(*) AS count FROM revenue").count, 0);
    assert.equal(get(runtime.db, "SELECT COUNT(*) AS count FROM commercial_learning_cycles").count, 0);
    assert.equal(summarizeCommercialEvidence(runtime.db, { experimentId: experiment.id }).sales, 0);

    const researchEvidence = recordEvidence(runtime.db, {
      ventureId: "venture-digital-products",
      experimentId: experiment.id,
      sourceType: "source_link",
      sourceUrl: "https://example.invalid/public-market-research",
      title: "Public market research",
      summary: "Public research can inform a test but cannot prove a transaction.",
      claim: "A public source discussed the broad buyer problem.",
      verified: true,
    });
    const feedback = recordCommercialFeedback(runtime.db, {
      experimentId: experiment.id,
      source: "operator_observation",
      verified: true,
      verificationEvidenceId: researchEvidence.id,
      sentiment: "positive",
      summary: "Unverified comment",
    });
    assert.equal(feedback.verified, false);
    assert.equal(feedback.learning, null);

    assert.throws(
      () => recordCommercialResult(runtime.db, {
        experimentId: experiment.id,
        source: "operator",
        verified: true,
        verificationEvidenceId: researchEvidence.id,
        sales: 3,
        revenueCents: 3000,
      }),
      /immutable, experiment-bound commercial evidence ledger/i,
    );

    const legacyReceipt = recordEvidence(runtime.db, {
      ventureId: "venture-digital-products",
      experimentId: experiment.id,
      sourceType: "receipt",
      title: "Verified transaction export",
      summary: "A retained transaction export supports the exact manual result fixture.",
      claim: "Three paid sales and their attributable cash values were checked before entry.",
      verified: true,
      metadata: {
        sourceHash: "sha256:".concat("a".repeat(64)),
        receiptHash: "sha256:".concat("b".repeat(64)),
        receiptLocation: "test-fixture:legacy-receipt",
        transactionIds: ["transaction-1", "transaction-2", "transaction-3"],
        revenueCents: 3000,
      },
    });
    assert.throws(
      () => recordCommercialResult(runtime.db, {
        experimentId: experiment.id,
        source: "operator",
        verified: true,
        verificationNote: "Checked against the retained transaction export.",
        verificationEvidenceId: legacyReceipt.id,
        views: 50,
        sales: 3,
        revenueCents: 3000,
        spendCents: 400,
        productCostCents: 100,
        toolCostCents: 50,
        currency: "AUD",
      }),
      /legacy venture, research, operator, and platform records cannot verify financial truth/i,
    );
    assert.equal(get(runtime.db, "SELECT COUNT(*) AS count FROM revenue").count, 0);
    assert.equal(
      get(runtime.db, "SELECT COUNT(*) AS count FROM costs WHERE source = 'commercial_result'").count,
      0,
    );
    assert.equal(get(runtime.db, "SELECT COUNT(*) AS count FROM commercial_learning_cycles").count, 0);
    const summary = summarizeCommercialEvidence(runtime.db, { experimentId: experiment.id });
    assert.equal(summary.sales, 0);
    assert.equal(summary.revenueCents, 0);
    assert.equal(summary.resultCount, 0);
  } finally {
    closeRuntime(runtime);
  }
});

test("reconciled accounting is append-only and corrections use signed reversal records", () => {
  const runtime = testRuntime("accounting-correction");
  try {
    const originalInput = {
      id: "acct-original",
      entryType: "cash_outflow",
      category: "software_subscription",
      source: "Supplier",
      description: "Original reconciled charge",
      amountCents: 1000,
      occurredAt: "2026-07-10T00:00:00.000Z",
      metadata: { receipt: "R-1" },
    };
    recordAccountingEntry(runtime.db, originalInput);
    assert.equal(recordAccountingEntry(runtime.db, originalInput).amount_cents, 1000);
    assert.throws(
      () => recordAccountingEntry(runtime.db, { ...originalInput, amountCents: 900 }),
      /immutable/i,
    );
    assert.throws(
      () => run(runtime.db, "UPDATE accounting_entries SET amount_cents = 900 WHERE id = 'acct-original'"),
      /immutable/i,
    );
    const correction = recordAccountingCorrection(runtime.db, {
      originalEntryId: "acct-original",
      reversalId: "acct-original-reversal",
      reason: "Supplier receipt confirmed the lower charge.",
      occurredAt: "2026-07-11T00:00:00.000Z",
      replacement: {
        id: "acct-original-revision",
        amountCents: 800,
        description: "Corrected reconciled charge",
      },
    });
    assert.equal(correction.reversal.effect_sign, -1);
    assert.equal(correction.reversal.reverses_entry_id, "acct-original");
    assert.equal(correction.replacement.supersedes_entry_id, "acct-original");
    const summary = getAccountingSummary(runtime.db, { month: "2026-07" });
    assert.equal(summary.cashPaidCents, 800);
    assert.equal(summary.entryCount, 3);
    assert.equal(summary.currentEntryCount, 1);
    assert.equal(summary.recent.length, 1);
    assert.equal(summary.recent[0].description, "Corrected reconciled charge");
  } finally {
    closeRuntime(runtime);
  }
});

test("first-use builder preserves exact accounting and usage while removing every pilot row", () => {
  const runtime = testRuntime("reset-source", { includeDemoProof: true });
  const backupPath = path.join(runtime.root, "verified-database.jbackup");
  fs.writeFileSync(backupPath, "encrypted-backup-test-fixture");
  try {
    recordAccountingEntry(runtime.db, {
      id: "acct_chatgpt_pro_5x_recurring",
      entryType: "recurring_commitment",
      category: "software_subscription",
      source: "OpenAI ChatGPT",
      description: "ChatGPT Pro monthly subscription",
      status: "active",
      amountCents: 10000,
      occurredAt: "2026-07-05T00:00:00.000Z",
      nextDueAt: "2026-08-05T00:00:00.000Z",
      metadata: { invoice: "recurring" },
    });
    recordAccountingEntry(runtime.db, {
      id: "acct_chatgpt_pro_upgrade_2026_07_05",
      entryType: "cash_outflow",
      category: "software_subscription",
      source: "OpenAI ChatGPT",
      description: "ChatGPT Pro upgrade payment",
      amountCents: 9468,
      occurredAt: "2026-07-05T00:00:00.000Z",
      metadata: { invoice: "F86B1685-0026" },
    });
    recordAccountingEntry(runtime.db, {
      id: "acct_openai_api_credit_2026_07_16",
      entryType: "prepaid_credit_purchase",
      category: "ai_infrastructure",
      source: "OpenAI API",
      description: "OpenAI API prepaid credit",
      amountCents: 1579,
      occurredAt: "2026-07-16T00:00:00.000Z",
      metadata: { sourceCurrency: "USD", sourceTotalCents: 1100 },
    });
    for (const [index, usage] of USAGE_SURVIVORS.entries()) {
      run(
        runtime.db,
        `INSERT INTO costs
         (id, workflow_id, category, source, status, amount_cents, currency, occurred_at,
          metadata, venture_id, run_id, task_id, model_call_id)
         VALUES (?, NULL, 'live_ai_worker', 'openai-agents-sdk', ?, ?, 'AUD',
          '2026-07-16T05:39:06.519Z', ?, 'venture-digital-products', ?, ?, ?)`,
        [
          `cost-survivor-${index + 1}`,
          usage.status,
          usage.amountCents,
          toJson({ provider: "openai", allocation: index + 1 }),
          usage.runId,
          usage.taskId,
          usage.modelCallId,
        ],
      );
    }
    const retentionPolicy = ensureRetentionPolicy(runtime.db);
    run(
      runtime.db,
      `INSERT INTO data_retention_policy_activations
       (id, policy_id, policy_hash, approval_id, proof_hash, activated_at,
        activated_by, metadata, created_at)
       VALUES ('retention-activation-reset-proof', ?, ?, 'approval-reset-proof', ?, ?,
               'operator', ?, ?)`,
      [
        retentionPolicy.id,
        retentionPolicy.policy_hash,
        "a".repeat(64),
        "2026-07-17T00:00:00.000Z",
        toJson({ source: "test-approved-activation" }),
        "2026-07-17T00:00:00.000Z",
      ],
    );
    const sourceAccounting = all(runtime.db, "SELECT * FROM accounting_entries ORDER BY id");
    const sourceRetentionActivations = all(
      runtime.db,
      "SELECT * FROM data_retention_policy_activations ORDER BY id",
    );
    runtime.db.close();
    runtime.db = null;

    const built = buildFirstUseDatabase(runtime.dbPath, {
      resetId: "first-use-test-2026-07-17",
      backupReference: backupPath,
    });
    assert.equal(built.alreadyApplied, false);
    assert.ok(fs.existsSync(built.candidatePath));
    const candidate = openDatabase(built.candidatePath);
    try {
      const verified = verifyFirstUseDatabase(candidate, { resetId: built.resetId });
      assert.equal(verified.integrity.quickCheck, "ok");
      for (const [table, expected] of Object.entries(STATIC_COUNTS)) {
        assert.equal(get(candidate, `SELECT COUNT(*) AS count FROM ${table}`).count, expected);
      }
      assert.deepEqual(
        all(candidate, "SELECT id FROM scheduler_jobs ORDER BY id").map((row) => row.id),
        [
          "job-monitor-cycle",
          "job-pantheon-supervisor",
          "job-preventure-research",
          "job-safe-work-loop",
          "job-weekly-executive-digest",
        ],
      );
      const preventureJob = get(
        candidate,
        `SELECT kind, status, next_run_at, last_run_at, locked_at, lock_owner, metadata
         FROM scheduler_jobs
         WHERE id = 'job-preventure-research'`,
      );
      assert.equal(preventureJob.kind, "preventure_research");
      assert.equal(preventureJob.status, "disabled");
      assert.equal(preventureJob.next_run_at, null);
      assert.equal(preventureJob.last_run_at, null);
      assert.equal(preventureJob.locked_at, null);
      assert.equal(preventureJob.lock_owner, null);
      assert.equal(JSON.parse(preventureJob.metadata).exactAuthorityOnly, true);
      assert.equal(JSON.parse(preventureJob.metadata).externalCommercialEffectsAllowed, false);

      const assertSchedulerMutationRejected = (mutate, restore, expectedError) => {
        mutate();
        assert.throws(
          () => verifyFirstUseDatabase(candidate, { resetId: built.resetId }),
          expectedError,
        );
        restore();
      };
      assertSchedulerMutationRejected(
        () => run(
          candidate,
          "UPDATE scheduler_jobs SET id = 'job-pilot-leak' WHERE id = 'job-safe-work-loop'",
        ),
        () => run(
          candidate,
          "UPDATE scheduler_jobs SET id = 'job-safe-work-loop' WHERE id = 'job-pilot-leak'",
        ),
        /only the canonical scheduler controls/i,
      );
      assertSchedulerMutationRejected(
        () => run(
          candidate,
          "UPDATE scheduler_jobs SET status = 'enabled' WHERE id = 'job-preventure-research'",
        ),
        () => run(
          candidate,
          "UPDATE scheduler_jobs SET status = 'disabled' WHERE id = 'job-preventure-research'",
        ),
        /bounded-diligence scheduler must remain disabled/i,
      );
      assertSchedulerMutationRejected(
        () => run(
          candidate,
          "UPDATE scheduler_jobs SET next_run_at = ? WHERE id = 'job-preventure-research'",
          ["2026-08-11T00:00:00.000Z"],
        ),
        () => run(
          candidate,
          "UPDATE scheduler_jobs SET next_run_at = NULL WHERE id = 'job-preventure-research'",
        ),
        /bounded-diligence scheduler must remain disabled/i,
      );
      assertSchedulerMutationRejected(
        () => run(
          candidate,
          `UPDATE scheduler_jobs
           SET metadata = json_set(metadata, '$.exactAuthorityOnly', json('false'))
           WHERE id = 'job-preventure-research'`,
        ),
        () => run(
          candidate,
          "UPDATE scheduler_jobs SET metadata = ? WHERE id = 'job-preventure-research'",
          [preventureJob.metadata],
        ),
        /bounded-diligence scheduler must remain disabled/i,
      );
      assertSchedulerMutationRejected(
        () => run(
          candidate,
          `UPDATE scheduler_jobs
           SET metadata = json_set(metadata, '$.externalCommercialEffectsAllowed', json('true'))
           WHERE id = 'job-preventure-research'`,
        ),
        () => run(
          candidate,
          "UPDATE scheduler_jobs SET metadata = ? WHERE id = 'job-preventure-research'",
          [preventureJob.metadata],
        ),
        /bounded-diligence scheduler must remain disabled/i,
      );
      assertSchedulerMutationRejected(
        () => run(
          candidate,
          `UPDATE scheduler_jobs SET locked_at = ?, lock_owner = 'pilot-leak'
           WHERE id = 'job-preventure-research'`,
          ["2026-08-11T00:00:00.000Z"],
        ),
        () => run(
          candidate,
          `UPDATE scheduler_jobs SET locked_at = NULL, lock_owner = NULL
           WHERE id = 'job-preventure-research'`,
        ),
        /bounded-diligence scheduler must remain disabled/i,
      );
      for (const table of EMPTY_OPERATIONAL_TABLES) {
        assert.equal(get(candidate, `SELECT COUNT(*) AS count FROM ${table}`).count, 0, table);
      }
      assert.deepEqual(all(candidate, "SELECT * FROM accounting_entries ORDER BY id"), sourceAccounting);
      assert.deepEqual(
        all(candidate, "SELECT * FROM data_retention_policy_activations ORDER BY id"),
        sourceRetentionActivations,
      );
      assert.equal(get(candidate, "SELECT SUM(amount_cents) AS amount FROM costs").amount, 118);
      assert.equal(get(candidate, "SELECT COUNT(DISTINCT model_call_id) AS count FROM costs").count, 3);
      assert.equal(get(candidate, "SELECT COUNT(*) AS count FROM runtime_resets WHERE status = 'built'").count, 1);

      const preventureStore = createPreventureResearchStore(candidate, {
        clock: () => "2026-08-02T12:30:00.000+10:00",
      });
      preventureStore.registerAuthority(preventureAuthority, preventureReadiness);
      assert.equal(get(candidate, "SELECT COUNT(*) AS count FROM preventure_research_authorities").count, 1);
      assert.throws(
        () => verifyFirstUseDatabase(candidate, { resetId: built.resetId }),
        /preventure_research_authorities must be empty/i,
      );
    } finally {
      candidate.close();
    }

    const livePidPath = path.join(runtime.root, "jarvis-server.pid");
    fs.writeFileSync(livePidPath, String(process.pid));
    assert.throws(
      () => assertRuntimeStopped(runtime.dbPath, { pidPath: livePidPath }),
      /still running/i,
    );
  } finally {
    closeRuntime(runtime);
  }
});
