const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const CONFIG = require("../src/config");
const { get, openDatabase, run, seedDatabase, toJson } = require("../src/db");
const {
  activeJourney,
  currentOperatorJourney,
  getJourneyState,
  isTerminalJourneyStatus,
  startPantheonJourney,
} = require("../src/runtime/pantheon-journey");
const {
  appendProofExposure,
  readProofExposure,
} = require("../src/runtime/proof-exposure-ledger");

const RETIRED_PATH = "pantheon_opportunity_round_start";
const RETIRED_REPLACEMENT = "bounded_preventure_research_authority_pending";
const SIDE_EFFECT_TABLES = Object.freeze([
  "pantheon_journeys",
  "opportunity_rounds",
  "opportunities",
  "workflows",
  "tasks",
  "approvals",
  "agent_handoffs",
  "research_runs",
  "model_calls",
  "catalogue_plans",
  "deliverables",
  "costs",
  "platform_sales",
  "commercial_experiments",
  "commercial_results",
  "events",
]);

test("journey safety and commercial authority decisions use normal view loading", () => {
  const dashboardSource = fs.readFileSync(
    path.join(__dirname, "..", "public", "app.js"),
    "utf8",
  );
  assert.match(
    dashboardSource,
    /if \(action === "prepare-retention-decision"\)[\s\S]*?return loadView\("decisions", \{ silent: true \}\);/,
  );
  assert.match(
    dashboardSource,
    /data\.correction\?\.kind === "prepare_known_ai_retry"/,
  );
  assert.match(dashboardSource, /Review the corrected package/);
  assert.match(dashboardSource, /journeyTaskOutcome/);
  assert.match(dashboardSource, /catalogue-decision-list/);
  assert.match(dashboardSource, /single permitted internal correction/);
  assert.match(dashboardSource, /This is the final independent content recheck/);
  assert.match(
    dashboardSource,
    /A cut-off or malformed AI answer is recorded separately/,
  );
  assert.match(dashboardSource, /data\.currentJourney/);
  assert.match(dashboardSource, /Review commercial authority/);
  assert.match(dashboardSource, /Business journey is waiting for authority/);
  assert.match(
    dashboardSource,
    /corrected product package still had a material quality issue/,
  );
  assert.match(dashboardSource, /review the recorded result first/i);
  assert.match(dashboardSource, /No further work will start automatically/);
  assert.match(dashboardSource, /No decision is waiting/);
  assert.match(dashboardSource, /Why it stopped/);
  assert.match(dashboardSource, /The product did not fully match its promise/);
  assert.match(dashboardSource, /What must change/);
  const opportunitySource = fs.readFileSync(
    path.join(
      __dirname,
      "..",
      "src",
      "runtime",
      "pantheon-opportunities.js",
    ),
    "utf8",
  );
  assert.match(
    opportunitySource,
    /each catalogue item must be truthfully deliverable as one Excel workbook/,
  );
  assert.match(
    opportunitySource,
    /Do not promise Notion or Airtable workspaces, reusable databases/,
  );
  assert.match(dashboardSource, /Review the catalogue build/);
  assert.doesNotMatch(dashboardSource, /action === "start-discovery"/);
  assert.doesNotMatch(
    dashboardSource,
    /postJson\("\/api\/pantheon\/journeys",/,
  );
  assert.doesNotMatch(dashboardSource, /Review the final decision/);
  assert.doesNotMatch(dashboardSource, /syncNavigation\(/);
  assert.match(dashboardSource, /const requestedView = view;/);
  assert.match(
    dashboardSource,
    /if \(store\.view !== requestedView\) return data;/,
  );
  assert.match(dashboardSource, /Try this stage again/);
  assert.match(dashboardSource, /A fresh decision for the same stage is ready/);
});

function runtimeDb(name) {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), `pantheon-journey-hardening-${name}-`),
  );
  const databasePath = path.join(root, "runtime.sqlite");
  const db = openDatabase(databasePath);
  seedDatabase(db);
  return { root, databasePath, db };
}

function removeRuntime(runtime) {
  runtime.db?.close();
  fs.rmSync(runtime.root, { recursive: true, force: true });
}

function sideEffectCounts(db) {
  return Object.fromEntries(SIDE_EFFECT_TABLES.map((table) => [
    table,
    get(db, `SELECT COUNT(*) AS count FROM ${table}`).count,
  ]));
}

function assertRetiredJourneyStart(db, input) {
  assert.throws(
    () => startPantheonJourney(db, input),
    (error) => {
      assert.equal(error.statusCode, 410);
      assert.equal(error.code, "legacy_commercial_path_retired");
      assert.equal(error.details?.path, RETIRED_PATH);
      assert.equal(error.details?.replacement, RETIRED_REPLACEMENT);
      assert.match(error.message, /pre-venture commercial discovery is retired/i);
      return true;
    },
  );
}

function insertHistoricalJourney(db, options = {}) {
  const ventureId = get(
    db,
    "SELECT id FROM ventures WHERE is_active = 1 ORDER BY updated_at DESC LIMIT 1",
  ).id;
  const id = options.id || "journey-historical";
  const createdAt = options.createdAt || "2026-07-01T00:00:00.000Z";
  const updatedAt = options.updatedAt || createdAt;
  const completedAt = isTerminalJourneyStatus(options.status)
    ? options.completedAt || updatedAt
    : null;
  run(
    db,
    `INSERT INTO pantheon_journeys
     (id, venture_id, mode, status, active_stage, model, model_locked,
      budget_cap_cents, carried_exposure_cents, round_id, workflow_id,
      selected_opportunity_id, metadata, started_at, completed_at, created_at,
      updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, NULL, NULL, NULL, ?, ?, ?, ?, ?)`,
    [
      id,
      ventureId,
      options.mode || "rehearsal",
      options.status || "running",
      options.activeStage || "opportunity_scout",
      CONFIG.lunaModel,
      options.budgetCapCents || CONFIG.journeyBudgetCapCents,
      options.carriedExposureCents || 0,
      toJson({
        historicalReadOnly: true,
        externalActionsAllowed: false,
        ...(options.metadata || {}),
      }),
      createdAt,
      completedAt,
      createdAt,
      updatedAt,
    ],
  );
  return get(db, "SELECT * FROM pantheon_journeys WHERE id = ?", [id]);
}

test("legacy broad journey start is a repeatable 410 with zero side effects", () => {
  const runtime = runtimeDb("retired-start");
  try {
    const pristine = sideEffectCounts(runtime.db);
    const base = {
      mode: "rehearsal",
      model: CONFIG.lunaModel,
      budgetCapCents: CONFIG.journeyBudgetCapCents,
      prompt: "Attempt retired broad commercial discovery.",
    };
    for (const input of [
      base,
      { ...base },
      { ...base, force: true },
      { ...base, restart: true, force: true },
      {
        ...base,
        mode: "production",
        carriedExposureCents: 999999,
      },
      {
        ...base,
        model: "unapproved-model",
        externalActionsAllowed: true,
      },
    ]) {
      assertRetiredJourneyStart(runtime.db, input);
      assert.deepEqual(sideEffectCounts(runtime.db), pristine);
      assert.equal(activeJourney(runtime.db), null);
    }

    const emptyState = getJourneyState(runtime.db);
    assert.equal(emptyState.journey, null);
    assert.equal(emptyState.currentTask, null);
    assert.equal(emptyState.currentProduct, null);
    assert.equal(emptyState.commercialControl.allowed, false);
    assert.equal(emptyState.commercialControl.status, "not_authorised");
  } finally {
    removeRuntime(runtime);
  }
});

test("force, duplicate, retry, and reopen inputs cannot alter retained journeys", () => {
  const runtime = runtimeDb("retained-start-attempts");
  try {
    insertHistoricalJourney(runtime.db, {
      id: "journey-retained-active",
      status: "running",
      updatedAt: "2026-07-05T00:00:00.000Z",
    });
    const activeBefore = get(
      runtime.db,
      "SELECT * FROM pantheon_journeys WHERE id = 'journey-retained-active'",
    );
    const activeCounts = sideEffectCounts(runtime.db);
    for (const input of [
      { mode: "rehearsal" },
      { mode: "rehearsal", force: true },
      { mode: "rehearsal", retry: true },
      {
        mode: "rehearsal",
        force: true,
        restartJourneyId: activeBefore.id,
      },
    ]) {
      assertRetiredJourneyStart(runtime.db, input);
      assert.deepEqual(sideEffectCounts(runtime.db), activeCounts);
      assert.deepEqual(
        get(
          runtime.db,
          "SELECT * FROM pantheon_journeys WHERE id = ?",
          [activeBefore.id],
        ),
        activeBefore,
      );
    }

    run(
      runtime.db,
      `UPDATE pantheon_journeys
       SET status = 'completed', active_stage = 'ready_to_publish',
           completed_at = ?, updated_at = ?
       WHERE id = ?`,
      [
        "2026-07-06T00:00:00.000Z",
        "2026-07-06T00:00:00.000Z",
        activeBefore.id,
      ],
    );
    const completedBefore = get(
      runtime.db,
      "SELECT * FROM pantheon_journeys WHERE id = ?",
      [activeBefore.id],
    );
    const completedCounts = sideEffectCounts(runtime.db);
    for (const input of [
      { mode: "production", reopenJourneyId: completedBefore.id },
      {
        mode: "production",
        force: true,
        reopenJourneyId: completedBefore.id,
      },
      {
        mode: "production",
        postCompletionLaunchAudit: true,
        journeyId: completedBefore.id,
      },
    ]) {
      assertRetiredJourneyStart(runtime.db, input);
      assert.deepEqual(sideEffectCounts(runtime.db), completedCounts);
      assert.deepEqual(
        get(
          runtime.db,
          "SELECT * FROM pantheon_journeys WHERE id = ?",
          [completedBefore.id],
        ),
        completedBefore,
      );
    }
  } finally {
    removeRuntime(runtime);
  }
});

test("retained journey selection remains read-only and prefers active history", () => {
  const runtime = runtimeDb("historical-selection");
  try {
    const active = insertHistoricalJourney(runtime.db, {
      id: "journey-older-active",
      status: "waiting_for_operator",
      activeStage: "quality_review",
      createdAt: "2026-07-01T00:00:00.000Z",
      updatedAt: "2026-07-02T00:00:00.000Z",
    });
    const terminal = insertHistoricalJourney(runtime.db, {
      id: "journey-newer-terminal",
      status: "stopped_unknown_outcome",
      activeStage: "opportunity_scout",
      createdAt: "2026-07-03T00:00:00.000Z",
      updatedAt: "2026-07-04T00:00:00.000Z",
    });
    const beforeRead = sideEffectCounts(runtime.db);

    assert.equal(activeJourney(runtime.db).id, active.id);
    assert.equal(currentOperatorJourney(runtime.db).id, active.id);
    const state = getJourneyState(runtime.db);
    assert.equal(state.journey.id, active.id);
    assert.equal(state.currentTask, null);
    assert.equal(state.currentProduct, null);
    assert.equal(state.correction, null);
    assert.equal(state.commercialControl.allowed, false);
    assert.match(
      state.commercialControl.message,
      /no exact accepted and activated commercial authority/i,
    );
    assert.deepEqual(sideEffectCounts(runtime.db), beforeRead);

    run(
      runtime.db,
      `UPDATE pantheon_journeys
       SET status = 'cancelled', completed_at = ?, updated_at = ?
       WHERE id = ?`,
      [
        "2026-07-02T12:00:00.000Z",
        "2026-07-02T12:00:00.000Z",
        active.id,
      ],
    );
    assert.equal(activeJourney(runtime.db), null);
    assert.equal(currentOperatorJourney(runtime.db).id, terminal.id);
  } finally {
    removeRuntime(runtime);
  }
});

test("journey terminal-status utility remains explicit and fail closed", () => {
  for (const status of [
    "completed",
    "cancelled",
    "stopped_after_correction",
    "stopped_unknown_outcome",
  ]) {
    assert.equal(isTerminalJourneyStatus(status), true, status);
  }
  for (const status of [
    "",
    "starting",
    "running",
    "waiting_for_operator",
    "needs_attention",
    "unknown",
  ]) {
    assert.equal(isTerminalJourneyStatus(status), false, status);
  }
});

test("the durable proof ledger ignores temporary control-token changes", () => {
  const runtime = runtimeDb("persistent-proof-key");
  const previous = {
    privacy: process.env.PANTHEON_PRIVACY_HASH_KEY,
    legacyPrivacy: process.env.JARVIS_PRIVACY_HASH_KEY,
    control: process.env.PANTHEON_CONTROL_TOKEN,
    legacyControl: process.env.JARVIS_CONTROL_TOKEN,
  };
  try {
    process.env.PANTHEON_PRIVACY_HASH_KEY = "persistent-proof-key-a-32-bytes";
    process.env.JARVIS_PRIVACY_HASH_KEY = process.env.PANTHEON_PRIVACY_HASH_KEY;
    process.env.PANTHEON_CONTROL_TOKEN = "temporary-session-one";
    process.env.JARVIS_CONTROL_TOKEN = process.env.PANTHEON_CONTROL_TOKEN;
    appendProofExposure(runtime.db, {
      sourceKey: "durable-key-test",
      sourceType: "test",
      amountCents: 12,
    });
    process.env.PANTHEON_CONTROL_TOKEN = "temporary-session-two";
    process.env.JARVIS_CONTROL_TOKEN = process.env.PANTHEON_CONTROL_TOKEN;
    assert.equal(readProofExposure(runtime.db).totalCents, 12);
  } finally {
    for (const [name, value] of Object.entries({
      PANTHEON_PRIVACY_HASH_KEY: previous.privacy,
      JARVIS_PRIVACY_HASH_KEY: previous.legacyPrivacy,
      PANTHEON_CONTROL_TOKEN: previous.control,
      JARVIS_CONTROL_TOKEN: previous.legacyControl,
    })) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    removeRuntime(runtime);
  }
});

test("production proof accounting never falls back to a temporary control token", () => {
  const runtime = runtimeDb("no-control-token-fallback");
  const previous = {
    nodeEnv: process.env.NODE_ENV,
    privacy: process.env.PANTHEON_PRIVACY_HASH_KEY,
    legacyPrivacy: process.env.JARVIS_PRIVACY_HASH_KEY,
    control: process.env.PANTHEON_CONTROL_TOKEN,
    legacyControl: process.env.JARVIS_CONTROL_TOKEN,
  };
  try {
    process.env.NODE_ENV = "production";
    delete process.env.PANTHEON_PRIVACY_HASH_KEY;
    delete process.env.JARVIS_PRIVACY_HASH_KEY;
    process.env.PANTHEON_CONTROL_TOKEN = "temporary-session-only";
    process.env.JARVIS_CONTROL_TOKEN = process.env.PANTHEON_CONTROL_TOKEN;
    assert.throws(
      () => readProofExposure(runtime.db),
      /protected privacy key/i,
    );
  } finally {
    for (const [name, value] of Object.entries({
      NODE_ENV: previous.nodeEnv,
      PANTHEON_PRIVACY_HASH_KEY: previous.privacy,
      JARVIS_PRIVACY_HASH_KEY: previous.legacyPrivacy,
      PANTHEON_CONTROL_TOKEN: previous.control,
      JARVIS_CONTROL_TOKEN: previous.legacyControl,
    })) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    removeRuntime(runtime);
  }
});
