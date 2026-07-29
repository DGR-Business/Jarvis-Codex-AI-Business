"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  openDatabase,
  seedDatabase,
} = require("../src/db");
const {
  commercialLifecycleApprovalScope,
  commercialLifecycleApprovalScopeHash,
} = require("../src/runtime/commercial-authority");
const {
  createCommercialTestStore,
} = require("../src/runtime/commercial-test-store");
const {
  ensureVentureKitRegistry,
} = require("../src/runtime/venture-kit-registry");
const {
  buildActivatedCommercialTestFixture,
} = require("./support/commercial-authority-fixture");
const { createApp } = require("../src/server");

const appSource = fs.readFileSync(
  path.join(__dirname, "..", "public", "app.js"),
  "utf8",
);

function prepareProposedContract(db, suffix) {
  ensureVentureKitRegistry(db);
  const fixture = buildActivatedCommercialTestFixture(suffix);
  const store = createCommercialTestStore(db);
  store.registerContract(fixture.contract);
  store.appendLifecycle(fixture.contract.decisionHash, {
    eventId: `owner-control-${suffix}-proposed`,
    eventType: "proposed",
    reason: "Prepared for exact owner review.",
    occurredAt: "2026-07-29T00:00:00.000Z",
  });
  return { ...fixture, store };
}

function insertPendingLifecycleApproval(db, contract, eventType, id) {
  const scope = commercialLifecycleApprovalScope(contract, eventType);
  const scopeHash = commercialLifecycleApprovalScopeHash(contract, eventType);
  db.prepare(
    `INSERT INTO approvals
      (id, venture_id, workflow_id, scope, title, status, risk_level,
       requested_by, requested_at, payload, scope_hash)
     VALUES (?, ?, NULL, ?, ?, 'pending', 'high', 'jarvis', ?, ?, ?)`,
  ).run(
    id,
    contract.ventureId,
    `commercial_test_${eventType}`,
    eventType === "accepted"
      ? "Accept this exact commercial test?"
      : "Activate this exact commercial test?",
    "2026-07-29T00:01:00.000Z",
    JSON.stringify({
      commercialTestApprovalScope: scope,
      commercialTestApprovalScopeHash: scopeHash,
    }),
    scopeHash,
  );
  return { id, scope, scopeHash };
}

function lifecycleWriteSnapshot(db, approvalId) {
  return {
    approval: db.prepare(
      `SELECT status, decided_at, consumed_at, decision_note
       FROM approvals WHERE id = ?`,
    ).get(approvalId),
    lifecycleEvents: db.prepare(
      "SELECT COUNT(*) AS count FROM commercial_test_lifecycle_events",
    ).get().count,
    auditEvents: db.prepare(
      "SELECT COUNT(*) AS count FROM events",
    ).get().count,
  };
}

async function startFixtureApp(name) {
  const dir = fs.mkdtempSync(
    path.join(os.tmpdir(), `pantheon-owner-lifecycle-${name}-`),
  );
  const dbPath = path.join(dir, "runtime.sqlite");
  const db = openDatabase(dbPath);
  seedDatabase(db);
  const app = createApp({
    db,
    dbPath,
    schedulerEnabled: false,
    security: false,
  });
  await new Promise((resolve, reject) => {
    app.server.once("error", reject);
    app.server.listen(0, "127.0.0.1", resolve);
  });
  return {
    ...app,
    dir,
    origin: `http://127.0.0.1:${app.server.address().port}`,
  };
}

async function stopFixtureApp(app) {
  for (const client of app.wss.clients) client.terminate();
  await new Promise((resolve) => app.server.close(resolve));
  app.wss.close();
  app.db.close();
  fs.rmSync(app.dir, { recursive: true, force: true });
}

async function postJson(origin, pathname, body = {}) {
  const response = await fetch(`${origin}${pathname}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return {
    response,
    payload: await response.json(),
  };
}

test("owner lifecycle HTTP control accepts then activates exact scope atomically and idempotently", async () => {
  const app = await startFixtureApp("advance");
  try {
    const fixture = prepareProposedContract(app.db, "owner-control-advance");
    const acceptance = insertPendingLifecycleApproval(
      app.db,
      fixture.contract,
      "accepted",
      "approval-owner-acceptance",
    );

    const testsBefore = await fetch(`${app.origin}/api/tests`).then(
      (response) => response.json(),
    );
    assert.equal(testsBefore.current.lifecycle.status, "proposed");
    assert.equal(testsBefore.current.reviewDecision.id, acceptance.id);
    assert.deepEqual(testsBefore.controls.allowed, ["review_decision"]);

    const decision = await fetch(
      `${app.origin}/api/decisions/${encodeURIComponent(acceptance.id)}`,
    ).then((response) => response.json());
    assert.equal(decision.decisionKind, "commercial_lifecycle");
    assert.equal(decision.decisionActionKind, "commercial_lifecycle");
    assert.equal(decision.lifecycleEventType, "accepted");
    assert.equal(decision.scopeHash, acceptance.scopeHash);

    const beforeWrongHash = lifecycleWriteSnapshot(app.db, acceptance.id);
    const wrongHash = await postJson(
      app.origin,
      `/api/commercial/lifecycle-decisions/${acceptance.id}/approve`,
      {
        scopeHash: "wrong-scope-hash",
        note: "This stale decision must not write.",
      },
    );
    assert.equal(wrongHash.response.status, 409);
    assert.equal(wrongHash.payload.code, "commercial_lifecycle_scope_changed");
    assert.deepEqual(
      lifecycleWriteSnapshot(app.db, acceptance.id),
      beforeWrongHash,
    );

    const generic = await postJson(
      app.origin,
      `/api/approvals/${acceptance.id}/approve`,
      {
        scopeHash: acceptance.scopeHash,
        note: "The generic approval route must not decide this lifecycle.",
      },
    );
    assert.equal(generic.response.status, 409);
    assert.equal(generic.payload.code, "commercial_lifecycle_decision_required");
    assert.deepEqual(
      lifecycleWriteSnapshot(app.db, acceptance.id),
      beforeWrongHash,
    );

    const accepted = await postJson(
      app.origin,
      `/api/commercial/lifecycle-decisions/${acceptance.id}/approve`,
      {
        scopeHash: acceptance.scopeHash,
        note: "Owner accepted the exact test.",
      },
    );
    assert.equal(accepted.response.status, 200);
    assert.equal(accepted.payload.result.changed, true);
    assert.equal(accepted.payload.result.lifecycleChanged, true);
    assert.equal(accepted.payload.result.lifecycleStatus, "accepted");
    assert.equal(accepted.payload.tests.current.lifecycle.status, "accepted");
    const acceptedApproval = app.db.prepare(
      "SELECT status, decided_at, consumed_at FROM approvals WHERE id = ?",
    ).get(acceptance.id);
    assert.equal(acceptedApproval.status, "approved");
    assert.ok(acceptedApproval.decided_at);
    assert.equal(acceptedApproval.consumed_at, acceptedApproval.decided_at);
    assert.equal(
      app.db.prepare(
        `SELECT COUNT(*) AS count
         FROM commercial_test_lifecycle_events
         WHERE approval_id = ? AND event_type = 'accepted'`,
      ).get(acceptance.id).count,
      1,
    );

    const afterAcceptance = lifecycleWriteSnapshot(app.db, acceptance.id);
    const replay = await postJson(
      app.origin,
      `/api/commercial/lifecycle-decisions/${acceptance.id}/approve`,
      {
        scopeHash: acceptance.scopeHash,
        note: "A repeated browser request must not write again.",
      },
    );
    assert.equal(replay.response.status, 200);
    assert.equal(replay.payload.result.changed, false);
    assert.equal(replay.payload.result.lifecycleChanged, false);
    assert.equal(replay.payload.result.lifecycleStatus, "accepted");
    assert.deepEqual(
      lifecycleWriteSnapshot(app.db, acceptance.id),
      afterAcceptance,
    );

    const activation = insertPendingLifecycleApproval(
      app.db,
      fixture.contract,
      "activated",
      "approval-owner-activation",
    );
    const acceptedTests = await fetch(`${app.origin}/api/tests`).then(
      (response) => response.json(),
    );
    assert.equal(acceptedTests.current.lifecycle.status, "accepted");
    assert.equal(acceptedTests.current.reviewDecision.id, activation.id);

    const activated = await postJson(
      app.origin,
      `/api/commercial/lifecycle-decisions/${activation.id}/approve`,
      {
        scopeHash: activation.scopeHash,
        note: "Owner activated the exact controlled test.",
      },
    );
    assert.equal(activated.response.status, 200);
    assert.equal(activated.payload.result.lifecycleStatus, "activated");
    assert.equal(activated.payload.tests.current.lifecycle.status, "activated");
    assert.equal(activated.payload.tests.current.reviewDecision, null);
    assert.deepEqual(activated.payload.tests.controls.allowed, []);
    assert.equal(fixture.store.readLedger(fixture.contract.decisionHash).state, "activated");
  } finally {
    await stopFixtureApp(app);
  }
});

test("lifecycle approval for the wrong current step rolls back every write", async () => {
  const app = await startFixtureApp("wrong-step");
  try {
    const fixture = prepareProposedContract(app.db, "owner-control-wrong-step");
    const activation = insertPendingLifecycleApproval(
      app.db,
      fixture.contract,
      "activated",
      "approval-owner-premature-activation",
    );
    const before = lifecycleWriteSnapshot(app.db, activation.id);

    const response = await postJson(
      app.origin,
      `/api/commercial/lifecycle-decisions/${activation.id}/approve`,
      {
        scopeHash: activation.scopeHash,
        note: "Activation cannot skip acceptance.",
      },
    );

    assert.equal(response.response.status, 409);
    assert.equal(
      response.payload.code,
      "commercial_lifecycle_transition_invalid",
    );
    assert.deepEqual(lifecycleWriteSnapshot(app.db, activation.id), before);
    assert.equal(
      fixture.store.readLedger(fixture.contract.decisionHash).state,
      "proposed",
    );
  } finally {
    await stopFixtureApp(app);
  }
});

test("a paused test needs fresh acceptance and activation decisions before it resumes", async () => {
  const app = await startFixtureApp("pause-resume");
  try {
    const fixture = prepareProposedContract(app.db, "owner-control-pause-resume");
    const originalAcceptance = insertPendingLifecycleApproval(
      app.db,
      fixture.contract,
      "accepted",
      "approval-owner-original-acceptance",
    );
    const accepted = await postJson(
      app.origin,
      `/api/commercial/lifecycle-decisions/${originalAcceptance.id}/approve`,
      {
        scopeHash: originalAcceptance.scopeHash,
        note: "Owner accepted the original exact test.",
      },
    );
    assert.equal(accepted.response.status, 200);

    const originalActivation = insertPendingLifecycleApproval(
      app.db,
      fixture.contract,
      "activated",
      "approval-owner-original-activation",
    );
    const activated = await postJson(
      app.origin,
      `/api/commercial/lifecycle-decisions/${originalActivation.id}/approve`,
      {
        scopeHash: originalActivation.scopeHash,
        note: "Owner activated the original exact test.",
      },
    );
    assert.equal(activated.response.status, 200);
    const originalActivationRow = app.db.prepare(
      "SELECT decided_at FROM approvals WHERE id = ?",
    ).get(originalActivation.id);
    const pausedAt = new Date(
      Date.parse(originalActivationRow.decided_at) + 1,
    ).toISOString();
    fixture.store.appendLifecycle(fixture.contract.decisionHash, {
      eventId: "owner-control-pause-resume-paused",
      eventType: "paused",
      reason: "Owner checkpoint required before the test can resume.",
      occurredAt: pausedAt,
    });
    await new Promise((resolve) => setTimeout(resolve, 10));

    const pausedWithoutDecision = await fetch(`${app.origin}/api/tests`).then(
      (response) => response.json(),
    );
    assert.equal(pausedWithoutDecision.current.lifecycle.status, "paused");
    assert.equal(pausedWithoutDecision.current.reviewDecision, null);
    assert.deepEqual(pausedWithoutDecision.controls.allowed, []);

    const beforeOldReplay = lifecycleWriteSnapshot(
      app.db,
      originalActivation.id,
    );
    const oldActivationReplay = await postJson(
      app.origin,
      `/api/commercial/lifecycle-decisions/${originalActivation.id}/approve`,
      {
        scopeHash: originalActivation.scopeHash,
        note: "An old activation response must not resume a paused test.",
      },
    );
    assert.equal(oldActivationReplay.response.status, 200);
    assert.equal(oldActivationReplay.payload.result.changed, false);
    assert.equal(oldActivationReplay.payload.result.lifecycleChanged, false);
    assert.equal(
      oldActivationReplay.payload.tests.current.lifecycle.status,
      "paused",
    );
    assert.deepEqual(
      lifecycleWriteSnapshot(app.db, originalActivation.id),
      beforeOldReplay,
    );

    const resumedAcceptance = insertPendingLifecycleApproval(
      app.db,
      fixture.contract,
      "accepted",
      "approval-owner-resumed-acceptance",
    );
    const pausedWithDecision = await fetch(`${app.origin}/api/tests`).then(
      (response) => response.json(),
    );
    assert.equal(pausedWithDecision.current.lifecycle.status, "paused");
    assert.equal(
      pausedWithDecision.current.reviewDecision.id,
      resumedAcceptance.id,
    );
    const resumedAcceptanceDetail = await fetch(
      `${app.origin}/api/decisions/${resumedAcceptance.id}`,
    ).then((response) => response.json());
    assert.equal(resumedAcceptanceDetail.lifecycleEventType, "accepted");

    const reaccepted = await postJson(
      app.origin,
      `/api/commercial/lifecycle-decisions/${resumedAcceptance.id}/approve`,
      {
        scopeHash: resumedAcceptance.scopeHash,
        note: "Owner freshly accepted the paused test.",
      },
    );
    assert.equal(reaccepted.response.status, 200);
    assert.equal(reaccepted.payload.result.lifecycleStatus, "accepted");
    assert.equal(reaccepted.payload.tests.current.lifecycle.status, "accepted");

    const resumedActivation = insertPendingLifecycleApproval(
      app.db,
      fixture.contract,
      "activated",
      "approval-owner-resumed-activation",
    );
    const acceptedWithActivation = await fetch(`${app.origin}/api/tests`).then(
      (response) => response.json(),
    );
    assert.equal(acceptedWithActivation.current.lifecycle.status, "accepted");
    assert.equal(
      acceptedWithActivation.current.reviewDecision.id,
      resumedActivation.id,
    );
    const reactivated = await postJson(
      app.origin,
      `/api/commercial/lifecycle-decisions/${resumedActivation.id}/approve`,
      {
        scopeHash: resumedActivation.scopeHash,
        note: "Owner freshly activated the re-accepted test.",
      },
    );
    assert.equal(reactivated.response.status, 200);
    assert.equal(reactivated.payload.result.lifecycleStatus, "activated");
    assert.equal(reactivated.payload.tests.current.lifecycle.status, "activated");

    const lifecycle = fixture.store.readLedger(
      fixture.contract.decisionHash,
    ).lifecycle;
    assert.deepEqual(
      lifecycle.map((event) => event.eventType),
      ["proposed", "accepted", "activated", "paused", "accepted", "activated"],
    );
    assert.deepEqual(
      lifecycle
        .filter((event) => ["accepted", "activated"].includes(event.eventType))
        .map((event) => event.approvalId),
      [
        originalAcceptance.id,
        originalActivation.id,
        resumedAcceptance.id,
        resumedActivation.id,
      ],
    );
  } finally {
    await stopFixtureApp(app);
  }
});

test("asking for lifecycle changes records the decision but never advances the test", async () => {
  const app = await startFixtureApp("changes");
  try {
    const fixture = prepareProposedContract(app.db, "owner-control-changes");
    const acceptance = insertPendingLifecycleApproval(
      app.db,
      fixture.contract,
      "accepted",
      "approval-owner-changes",
    );
    const changed = await postJson(
      app.origin,
      `/api/commercial/lifecycle-decisions/${acceptance.id}/changes`,
      {
        scopeHash: acceptance.scopeHash,
        note: "Revise the exact test before asking again.",
      },
    );
    assert.equal(changed.response.status, 200);
    assert.equal(changed.payload.result.changed, true);
    assert.equal(changed.payload.result.decision, "needs_changes");
    assert.equal(changed.payload.result.lifecycleChanged, false);
    assert.equal(changed.payload.tests.current.lifecycle.status, "proposed");
    assert.equal(
      fixture.store.readLedger(fixture.contract.decisionHash).lifecycle.length,
      1,
    );

    const afterChanges = lifecycleWriteSnapshot(app.db, acceptance.id);
    const replay = await postJson(
      app.origin,
      `/api/commercial/lifecycle-decisions/${acceptance.id}/changes`,
      {
        scopeHash: acceptance.scopeHash,
        note: "Repeated change request.",
      },
    );
    assert.equal(replay.response.status, 200);
    assert.equal(replay.payload.result.changed, false);
    assert.equal(replay.payload.result.lifecycleChanged, false);
    assert.deepEqual(lifecycleWriteSnapshot(app.db, acceptance.id), afterChanges);

    const conflictingApproval = await postJson(
      app.origin,
      `/api/commercial/lifecycle-decisions/${acceptance.id}/approve`,
      {
        scopeHash: acceptance.scopeHash,
        note: "A decided change request cannot later become approval.",
      },
    );
    assert.equal(conflictingApproval.response.status, 409);
    assert.equal(
      conflictingApproval.payload.code,
      "commercial_lifecycle_decision_already_recorded",
    );
    assert.deepEqual(lifecycleWriteSnapshot(app.db, acceptance.id), afterChanges);
    assert.equal(
      fixture.store.readLedger(fixture.contract.decisionHash).state,
      "proposed",
    );
  } finally {
    await stopFixtureApp(app);
  }
});

test("rejecting a lifecycle decision never advances the test and replays without writes", async () => {
  const app = await startFixtureApp("reject");
  try {
    const fixture = prepareProposedContract(app.db, "owner-control-reject");
    const acceptance = insertPendingLifecycleApproval(
      app.db,
      fixture.contract,
      "accepted",
      "approval-owner-reject",
    );
    const rejected = await postJson(
      app.origin,
      `/api/commercial/lifecycle-decisions/${acceptance.id}/reject`,
      {
        scopeHash: acceptance.scopeHash,
        note: "Do not continue this exact test.",
      },
    );
    assert.equal(rejected.response.status, 200);
    assert.equal(rejected.payload.result.decision, "rejected");
    assert.equal(rejected.payload.result.lifecycleChanged, false);
    assert.equal(rejected.payload.tests.current.lifecycle.status, "proposed");
    assert.equal(
      fixture.store.readLedger(fixture.contract.decisionHash).lifecycle.length,
      1,
    );

    const afterReject = lifecycleWriteSnapshot(app.db, acceptance.id);
    const replay = await postJson(
      app.origin,
      `/api/commercial/lifecycle-decisions/${acceptance.id}/reject`,
      {
        scopeHash: acceptance.scopeHash,
        note: "Repeated rejection.",
      },
    );
    assert.equal(replay.response.status, 200);
    assert.equal(replay.payload.result.changed, false);
    assert.equal(replay.payload.result.lifecycleChanged, false);
    assert.deepEqual(lifecycleWriteSnapshot(app.db, acceptance.id), afterReject);
    assert.equal(
      fixture.store.readLedger(fixture.contract.decisionHash).state,
      "proposed",
    );
  } finally {
    await stopFixtureApp(app);
  }
});

test("owner UI sends lifecycle decisions only to the protected lifecycle route", () => {
  assert.match(
    appSource,
    /item\.decisionKind === "commercial_lifecycle"[\s\S]*"commercial-lifecycle-decision"/,
  );
  assert.match(
    appSource,
    /action === "commercial-lifecycle-decision"[\s\S]*\/api\/commercial\/lifecycle-decisions\//,
  );
  assert.match(
    appSource,
    /The exact commercial test was accepted\. Activation remains a separate decision\./,
  );
  assert.match(
    appSource,
    /External actions remain separately locked\./,
  );
  assert.doesNotMatch(
    appSource,
    /action === "commercial-lifecycle-decision"[\s\S]{0,600}\/api\/approvals\//,
  );
});
