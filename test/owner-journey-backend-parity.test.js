"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  all,
  get,
  openDatabase,
  run,
  seedDatabase,
  toJson,
} = require("../src/db");
const {
  getAiTeamState,
  getCockpitState,
  getSystemState,
} = require("../src/runtime/cockpit-state");
const {
  createCommercialLifecycleEvent,
} = require("../src/runtime/commercial-authority");
const {
  getPortfolioState,
} = require("../src/runtime/portfolio-controller");
const {
  getJourneyState,
} = require("../src/runtime/pantheon-journey");
const { createApp } = require("../src/server");
const {
  installActivatedCommercialTestFixture,
} = require("./support/commercial-authority-fixture");

function makeRuntime(name) {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), `pantheon-owner-backend-${name}-`),
  );
  const dbPath = path.join(root, "runtime.sqlite");
  const db = openDatabase(dbPath);
  seedDatabase(db);
  return { root, dbPath, db };
}

async function startRuntime(runtime) {
  const app = createApp({
    db: runtime.db,
    dbPath: runtime.dbPath,
    schedulerEnabled: false,
    security: false,
  });
  await new Promise((resolve, reject) => {
    app.server.once("error", reject);
    app.server.listen(0, "127.0.0.1", resolve);
  });
  return {
    ...app,
    origin: `http://127.0.0.1:${app.server.address().port}`,
  };
}

async function closeRuntime(runtime, app = null) {
  if (app) {
    for (const client of app.wss.clients) client.terminate();
    await new Promise((resolve) => app.server.close(resolve));
    app.wss.close();
  }
  runtime.db.close();
  fs.rmSync(runtime.root, { recursive: true, force: true });
}

function insertQueueWork(db, options) {
  const timestamp = options.createdAt;
  run(
    db,
    `INSERT INTO workflows
     (id, venture_id, type, title, status, current_step, priority, metadata,
      created_at, updated_at)
     VALUES (?, 'venture-digital-products', ?, ?, 'planned', '', 1, ?, ?, ?)`,
    [
      options.workflowId,
      options.workflowType,
      options.workflowTitle,
      toJson(options.workflowMetadata || {
        agentRunner: {
          mode: "plan_only",
          liveModels: false,
          liveTools: false,
        },
      }),
      timestamp,
      timestamp,
    ],
  );
  run(
    db,
    `INSERT INTO tasks
     (id, workflow_id, venture_id, title, kind, agent, status, priority,
      cost_budget_cents, payload, result, created_at, updated_at)
     VALUES (?, ?, 'venture-digital-products', ?, ?, 'chief_of_staff', ?, 1,
      0, ?, '{}', ?, ?)`,
    [
      options.taskId,
      options.workflowId,
      options.taskTitle,
      options.taskKind,
      options.status || "queued",
      toJson(options.payload || {}),
      timestamp,
      timestamp,
    ],
  );
}

function insertJourney(db, options) {
  const timestamp = options.updatedAt;
  run(
    db,
    `INSERT INTO pantheon_journeys
     (id, venture_id, mode, status, active_stage, model, model_locked,
      budget_cap_cents, carried_exposure_cents, round_id, workflow_id,
      selected_opportunity_id, metadata, started_at, completed_at, created_at,
      updated_at)
     VALUES (?, 'venture-digital-products', 'production', ?, 'demand_validation',
      'fixture-model', 1, 1000, 0, NULL, ?, NULL, ?, ?, NULL, ?, ?)`,
    [
      options.id,
      options.status || "running",
      options.workflowId,
      toJson({
        currentTaskId: options.currentTaskId,
        externalActionsAllowed: false,
      }),
      timestamp,
      timestamp,
      timestamp,
    ],
  );
}

function appendStoppedLifecycle(db, fixture, occurredAt) {
  const previous = get(
    db,
    `SELECT sequence, event_hash
     FROM commercial_test_lifecycle_events
     WHERE decision_hash = ?
     ORDER BY sequence DESC LIMIT 1`,
    [fixture.contract.decisionHash],
  );
  const event = createCommercialLifecycleEvent({
    id: `owner-parity-${fixture.contract.testId}-stopped`,
    decisionHash: fixture.contract.decisionHash,
    sequence: Number(previous.sequence) + 1,
    previousEventHash: previous.event_hash,
    eventType: "stopped",
    approvalId: null,
    approvalScopeHash: null,
    reason: "Retained terminal fixture for queue truth.",
    metadata: { fixtureOnly: true },
    occurredAt,
  });
  run(
    db,
    `INSERT INTO commercial_test_lifecycle_events
     (id, decision_hash, sequence, previous_event_hash, event_type, event_hash,
      approval_id, approval_scope_hash, reason, metadata, event_json,
      occurred_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      event.id,
      event.decisionHash,
      event.sequence,
      event.previousEventHash,
      event.eventType,
      event.eventHash,
      event.approvalId,
      event.approvalScopeHash,
      event.reason,
      toJson(event.metadata),
      toJson(event),
      event.occurredAt,
      event.occurredAt,
    ],
  );
}

function tableSnapshot(db, tables) {
  return Object.fromEntries(tables.map((table) => [
    table,
    all(db, `SELECT * FROM ${table} ORDER BY rowid`),
  ]));
}

function byId(rows, id) {
  const item = rows.find((row) => row.id === id);
  assert.ok(item, `Expected ${id} in the owner queue.`);
  return item;
}

test("Cockpit and System use the same exact read-only authority result for queue controls", async () => {
  const runtime = makeRuntime("queue-parity");
  let app = null;
  try {
    app = await startRuntime(runtime);

    insertQueueWork(runtime.db, {
      workflowId: "workflow-owner-terminal",
      taskId: "task-owner-terminal",
      workflowType: "commercial_test",
      workflowTitle: "Retained terminal buyer test",
      taskTitle: "Continue retained terminal buyer test",
      taskKind: "market_research",
      createdAt: "2026-07-29T01:00:01.000Z",
    });
    const terminalFixture = installActivatedCommercialTestFixture(runtime.db, {
      suffix: "owner-queue-terminal",
      workflowIds: ["workflow-owner-terminal"],
      taskIds: ["task-owner-terminal"],
    });
    appendStoppedLifecycle(
      runtime.db,
      terminalFixture,
      "2026-07-29T01:00:02.000Z",
    );

    insertQueueWork(runtime.db, {
      workflowId: "workflow-owner-unbound",
      taskId: "task-owner-unbound",
      workflowType: "commercial_test",
      workflowTitle: "Unbound commercial outreach analysis",
      taskTitle: "Prepare buyer outreach",
      taskKind: "market_research",
      createdAt: "2026-07-29T01:00:03.000Z",
      payload: {
        buyer: "Independent service professionals",
        offer: "A low-touch operational kit",
      },
    });
    insertQueueWork(runtime.db, {
      workflowId: "workflow-owner-protected",
      taskId: "task-owner-protected",
      workflowType: "commercial_test",
      workflowTitle: "Protected customer contact",
      taskTitle: "Email prospective buyers",
      taskKind: "customer_contact",
      createdAt: "2026-07-29T01:00:04.000Z",
      payload: {
        tools: ["customer_email_sender"],
      },
    });
    insertQueueWork(runtime.db, {
      workflowId: "workflow-owner-valid",
      taskId: "task-owner-valid",
      workflowType: "commercial_test",
      workflowTitle: "Exact internal offer review",
      taskTitle: "Review exact offer evidence",
      taskKind: "internal_analysis",
      status: "completed",
      createdAt: "2026-07-29T01:00:05.000Z",
    });
    const activeFixture = installActivatedCommercialTestFixture(runtime.db, {
      suffix: "owner-queue-active",
      workflowIds: [
        "workflow-owner-protected",
        "workflow-owner-valid",
      ],
      taskIds: [
        "task-owner-protected",
        "task-owner-valid",
      ],
    });
    assert.ok(activeFixture.binding.decisionHash);
    const protectedTask = get(
      runtime.db,
      "SELECT payload FROM tasks WHERE id = 'task-owner-protected'",
    );
    run(
      runtime.db,
      "UPDATE tasks SET payload = ? WHERE id = 'task-owner-protected'",
      [
        toJson({
          ...JSON.parse(protectedTask.payload),
          tools: ["customer_email_sender"],
        }),
      ],
    );

    insertQueueWork(runtime.db, {
      workflowId: "workflow-owner-diagnostic",
      taskId: "task-owner-diagnostic",
      workflowType: "runtime_assurance",
      workflowTitle: "Runtime database health diagnostic",
      workflowMetadata: { systemProof: true },
      taskTitle: "Verify runtime database integrity",
      taskKind: "runtime_integrity_check",
      status: "completed",
      createdAt: "2026-07-29T01:00:06.000Z",
    });

    const protectedTables = [
      "workflows",
      "tasks",
      "commercial_test_contracts",
      "commercial_test_lifecycle_events",
      "commercial_test_evidence_records",
    ];
    const beforeBlockedReads = tableSnapshot(runtime.db, protectedTables);
    const cockpitBlocked = getCockpitState(runtime.db);
    const systemBlocked = getSystemState(runtime.db);
    const cockpitBlockedHttp = await fetch(`${app.origin}/api/cockpit`).then(
      (response) => response.json(),
    );
    const systemBlockedHttp = await fetch(`${app.origin}/api/system`).then(
      (response) => response.json(),
    );
    assert.deepEqual(
      tableSnapshot(runtime.db, protectedTables),
      beforeBlockedReads,
    );

    for (const expectation of [
      {
        id: "task-owner-unbound",
        reason: "commercial_binding_required",
      },
      {
        id: "task-owner-terminal",
        reason: "commercial_program_terminal",
      },
      {
        id: "task-owner-protected",
        reason: "commercial_protected_action_required",
      },
    ]) {
      const cockpitItem = byId(cockpitBlocked.importantWork, expectation.id);
      const systemItem = byId(systemBlocked.queue, expectation.id);
      const cockpitHttpItem = byId(
        cockpitBlockedHttp.importantWork,
        expectation.id,
      );
      const systemHttpItem = byId(systemBlockedHttp.queue, expectation.id);
      for (const item of [
        cockpitItem,
        systemItem,
        cockpitHttpItem,
        systemHttpItem,
      ]) {
        assert.equal(item.can_run, false, expectation.id);
        assert.equal(item.safe_to_run, false, expectation.id);
        assert.equal(item.execution_kind, "authority_blocked", expectation.id);
        assert.equal(item.safety_reason, expectation.reason, expectation.id);
      }
      assert.equal(cockpitItem.type, "authority_blocked_work");
      assert.doesNotMatch(cockpitItem.recommendation, /approved action ready/i);
    }

    run(
      runtime.db,
      `UPDATE tasks
       SET status = 'completed'
       WHERE id IN (
         'task-owner-unbound',
         'task-owner-terminal',
         'task-owner-protected'
       )`,
    );
    run(
      runtime.db,
      `UPDATE tasks
       SET status = 'queued'
       WHERE id IN ('task-owner-valid', 'task-owner-diagnostic')`,
    );
    const beforeRunnableReads = tableSnapshot(runtime.db, protectedTables);
    const cockpitRunnable = getCockpitState(runtime.db);
    const systemRunnable = getSystemState(runtime.db);
    const cockpitRunnableHttp = await fetch(`${app.origin}/api/cockpit`).then(
      (response) => response.json(),
    );
    const systemRunnableHttp = await fetch(`${app.origin}/api/system`).then(
      (response) => response.json(),
    );
    assert.deepEqual(
      tableSnapshot(runtime.db, protectedTables),
      beforeRunnableReads,
    );

    for (const id of ["task-owner-valid", "task-owner-diagnostic"]) {
      const items = [
        byId(cockpitRunnable.importantWork, id),
        byId(systemRunnable.queue, id),
        byId(cockpitRunnableHttp.importantWork, id),
        byId(systemRunnableHttp.queue, id),
      ];
      for (const item of items) {
        assert.equal(item.can_run, true, id);
        assert.equal(item.safe_to_run, true, id);
        assert.equal(item.execution_kind, "internal", id);
        assert.equal(item.safety_reason, null, id);
      }
    }
    assert.equal(
      byId(systemRunnable.queue, "task-owner-valid").safety_classification,
      "authorized_commercial",
    );
    assert.equal(
      byId(systemRunnable.queue, "task-owner-diagnostic").safety_classification,
      "diagnostic",
    );
  } finally {
    await closeRuntime(runtime, app);
  }
});

test("Command Center, Full Journey, and AI Team agree on exact journey task authority", async () => {
  const runtime = makeRuntime("journey-control-parity");
  let app = null;
  try {
    app = await startRuntime(runtime);
    const journeyId = "journey-owner-authority-proof";
    insertQueueWork(runtime.db, {
      workflowId: "workflow-journey-authorized",
      taskId: "task-journey-authorized",
      workflowType: "commercial_test",
      workflowTitle: "Exact authorised commercial journey",
      taskTitle: "Review the exact approved offer evidence",
      taskKind: "internal_analysis",
      status: "running",
      createdAt: "2026-07-29T01:30:00.000Z",
      payload: {
        liveSpendRequest: {
          parameters: {
            pantheonJourney: { journeyId },
          },
        },
      },
    });
    installActivatedCommercialTestFixture(runtime.db, {
      suffix: "journey-authority-proof",
      workflowIds: ["workflow-journey-authorized"],
      taskIds: ["task-journey-authorized"],
    });
    insertJourney(runtime.db, {
      id: journeyId,
      workflowId: "workflow-journey-authorized",
      currentTaskId: "task-journey-authorized",
      updatedAt: "2026-07-29T01:30:01.000Z",
    });

    const authorisedCockpit = getCockpitState(runtime.db);
    const authorisedJourney = getJourneyState(runtime.db, journeyId);
    const authorisedTeam = getAiTeamState(runtime.db);
    const authorisedCockpitHttp = await fetch(`${app.origin}/api/cockpit`).then(
      (response) => response.json(),
    );
    const authorisedJourneyHttp = await fetch(
      `${app.origin}/api/journey?id=${encodeURIComponent(journeyId)}`,
    ).then((response) => response.json());
    const authorisedTeamHttp = await fetch(`${app.origin}/api/ai-team`).then(
      (response) => response.json(),
    );
    for (const state of [authorisedCockpit, authorisedCockpitHttp]) {
      assert.equal(state.currentJourney.execution.authorized, true);
      assert.equal(state.currentJourney.execution.taskAuthorized, true);
      assert.equal(state.currentJourney.execution.running, true);
      assert.equal(state.currentJourney.execution.readOnly, false);
    }
    for (const state of [authorisedJourney, authorisedJourneyHttp]) {
      assert.equal(state.commercialControl.allowed, true);
      assert.equal(state.commercialControl.workflowAllowed, true);
      assert.equal(state.commercialControl.currentTaskAllowed, true);
    }
    for (const state of [authorisedTeam, authorisedTeamHttp]) {
      const chief = state.agents.find((agent) => agent.id === "chief_of_staff");
      assert.equal(chief.status, "Working");
      assert.equal(
        chief.technical.authorityClassification,
        "authorized_commercial",
      );
    }

    insertQueueWork(runtime.db, {
      workflowId: "workflow-journey-unbound",
      taskId: "task-journey-unbound",
      workflowType: "commercial_test",
      workflowTitle: "Unrelated historical commercial work",
      taskTitle: "Run unrelated historical buyer work",
      taskKind: "market_research",
      status: "running",
      createdAt: "2026-07-29T01:30:02.000Z",
      payload: {
        liveSpendRequest: {
          parameters: {
            pantheonJourney: { journeyId },
          },
        },
      },
    });
    run(
      runtime.db,
      `UPDATE pantheon_journeys
       SET metadata = ?, updated_at = ?
       WHERE id = ?`,
      [
        toJson({
          currentTaskId: "task-journey-unbound",
          externalActionsAllowed: false,
        }),
        "2026-07-29T01:30:03.000Z",
        journeyId,
      ],
    );

    const blockedCockpit = getCockpitState(runtime.db);
    const blockedJourney = getJourneyState(runtime.db, journeyId);
    const blockedTeam = getAiTeamState(runtime.db);
    const blockedCockpitHttp = await fetch(`${app.origin}/api/cockpit`).then(
      (response) => response.json(),
    );
    const blockedJourneyHttp = await fetch(
      `${app.origin}/api/journey?id=${encodeURIComponent(journeyId)}`,
    ).then((response) => response.json());
    const blockedTeamHttp = await fetch(`${app.origin}/api/ai-team`).then(
      (response) => response.json(),
    );
    for (const state of [blockedCockpit, blockedCockpitHttp]) {
      assert.equal(state.currentJourney.currentTask.status, "running");
      assert.equal(state.currentJourney.execution.authorized, false);
      assert.equal(state.currentJourney.execution.taskAuthorized, false);
      assert.equal(state.currentJourney.execution.running, false);
      assert.equal(state.currentJourney.execution.readOnly, true);
      assert.equal(state.currentJourney.execution.blocked, true);
    }
    for (const state of [blockedJourney, blockedJourneyHttp]) {
      assert.equal(state.commercialControl.workflowAllowed, true);
      assert.equal(state.commercialControl.currentTaskAllowed, false);
      assert.equal(state.commercialControl.allowed, false);
    }
    for (const state of [blockedTeam, blockedTeamHttp]) {
      const chief = state.agents.find((agent) => agent.id === "chief_of_staff");
      assert.equal(chief.status, "Needs attention");
      assert.match(chief.assignment, /blocked until its exact authority is valid/i);
      assert.notEqual(
        chief.technical.authorityClassification,
        "authorized_commercial",
      );
    }
  } finally {
    await closeRuntime(runtime, app);
  }
});

test("portfolio state and HTTP retain legacy rounds as read-only evidence, never live work", async () => {
  const runtime = makeRuntime("portfolio-truth");
  let app = null;
  try {
    app = await startRuntime(runtime);
    const timestamp = "2026-07-29T02:00:00.000Z";
    run(
      runtime.db,
      `INSERT INTO opportunity_rounds
       (id, venture_id, status, mode, prompt, geography, language,
        max_candidates, started_at, created_by, metadata, created_at, updated_at)
       VALUES (
         'round-retained-owner-proof',
         'venture-digital-products',
         'researching',
         'portfolio_discovery',
         'Earlier broad market scan',
         'global',
         'English',
         5,
         ?,
         'pantheon',
         ?,
         ?,
         ?
       )`,
      [
        timestamp,
        toJson({
          portfolioControllerV1: true,
          currentTaskId: "task-retained-owner-proof",
        }),
        timestamp,
        timestamp,
      ],
    );
    run(
      runtime.db,
      `INSERT INTO workflows
       (id, venture_id, type, title, status, current_step, priority, metadata,
        created_at, updated_at)
       VALUES (
         'workflow-retained-owner-proof',
         'venture-digital-products',
         'commercial_research',
         'Earlier broad market scan',
         'planned',
         '',
         1,
         '{}',
         ?,
         ?
       )`,
      [timestamp, timestamp],
    );
    run(
      runtime.db,
      `INSERT INTO tasks
       (id, workflow_id, venture_id, title, kind, agent, status, priority,
        cost_budget_cents, payload, result, created_at, updated_at)
       VALUES (
         'task-retained-owner-proof',
         'workflow-retained-owner-proof',
         'venture-digital-products',
         'Earlier portfolio research task',
         'live_ai_worker_execution',
         'opportunity_scout',
         'queued',
         1,
         0,
         ?,
         '{}',
         ?,
         ?
       )`,
      [
        toJson({
          liveSpendRequest: {
            parameters: {
              pantheonCommercial: {
                roundId: "round-retained-owner-proof",
                supervisorOwned: true,
              },
            },
          },
        }),
        timestamp,
        timestamp,
      ],
    );

    const protectedTables = [
      "opportunity_rounds",
      "opportunities",
      "workflows",
      "tasks",
    ];
    const before = tableSnapshot(runtime.db, protectedTables);
    const direct = getPortfolioState(runtime.db);
    const response = await fetch(`${app.origin}/api/portfolio`);
    const httpState = await response.json();
    const cockpit = getCockpitState(runtime.db);
    const aiTeam = getAiTeamState(runtime.db);
    const cockpitHttp = await fetch(`${app.origin}/api/cockpit`).then(
      (item) => item.json(),
    );
    const aiTeamHttp = await fetch(`${app.origin}/api/ai-team`).then(
      (item) => item.json(),
    );
    assert.equal(response.status, 200);
    assert.deepEqual(tableSnapshot(runtime.db, protectedTables), before);

    for (const state of [direct, httpState]) {
      assert.equal(state.status, "retained_read_only");
      assert.equal(state.readOnly, true);
      assert.equal(state.liveWork, false);
      assert.equal(state.legacyCreationPath, "retired");
      assert.equal(
        state.requiredAuthority,
        "bounded_preventure_research_authority_pending",
      );
      assert.equal(state.activeRound.status, "retained_read_only");
      assert.equal(state.activeRound.recordedStatus, "researching");
      assert.equal(state.activeRound.readOnly, true);
      assert.equal(state.activeRound.live, false);
      assert.equal(state.currentTask.status, "retained_read_only");
      assert.equal(state.currentTask.recordedStatus, "queued");
      assert.equal(state.currentTask.live, false);
      assert.equal(state.nextAction.status, "retained_read_only");
      assert.equal(state.nextAction.action, null);
      assert.match(state.nextAction.detail, /read-only|no portfolio research is running/i);
      assert.doesNotMatch(
        JSON.stringify(state.nextAction),
        /Pantheon is working|start_portfolio_discovery/i,
      );
    }
    for (const state of [cockpit, cockpitHttp]) {
      const scout = state.teamPulse.agents.find(
        (agent) => agent.id === "opportunity_scout",
      );
      assert.equal(scout.status, "Retained history");
      assert.match(scout.assignment, /retained for audit; no work is running/i);
      assert.equal(
        scout.technical.authorityClassification,
        "retired_portfolio_history",
      );
      assert.equal(
        state.teamPulse.agents.filter(
          (agent) => ["Working", "Waiting to start"].includes(agent.status),
        ).some((agent) => agent.id === "opportunity_scout"),
        false,
      );
      assert.ok(state.teamPulse.retainedHistory >= 1);
    }
    for (const state of [aiTeam, aiTeamHttp]) {
      const scout = state.agents.find(
        (agent) => agent.id === "opportunity_scout",
      );
      assert.equal(scout.status, "Retained history");
      assert.match(scout.assignment, /retained for audit; no work is running/i);
      assert.equal(
        scout.technical.authorityClassification,
        "retired_portfolio_history",
      );
    }
  } finally {
    await closeRuntime(runtime, app);
  }
});
