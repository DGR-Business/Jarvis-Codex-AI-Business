"use strict";

const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const authority = require("../config/preventure-research-authority-smm-scope-guard-v1");
const readinessSpec = require("../config/commercial-readiness-social-media-manager-scope-guard-v1");
const { all, get, openDatabase, seedDatabase } = require("../src/db");
const { collectFindings } = require("../src/runtime/monitor");
const { inspectSafeWorkflow, unsafeTaskReason } = require("../src/runtime/scheduler");
const { sha256 } = require("../src/runtime/commercial-test-contract");
const {
  terminatePreventureResearchAuthority,
} = require("../src/runtime/preventure-research-authority");
const {
  createPreventureResearchExecutionBridge,
} = require("../src/runtime/preventure-research-execution-bridge");
const {
  createPreventureResearchFinalizer,
} = require("../src/runtime/preventure-research-finalizer");
const { createMonotonicIsoClock } = require("../src/runtime/monotonic-iso-clock");
const { createPreventureResearchStore } = require("../src/runtime/preventure-research-store");
const { createApp, ensurePreventureResearchFoundation } = require("../src/server");
const {
  HISTORICAL_ACTIVE_V1_TIME,
  historicalV1TestRegistry,
} = require("./support/preventure-research-test-registry");
const {
  EXPIRED_V2_ACTIVE_TEST_TIME,
  expiredNonDispatchV2Authority,
  expiredNonDispatchV2Registry,
} = require("./support/preventure-research-v2-test-fixture");
const {
  addMilliseconds,
  prepareDispatchedExecution,
} = require("./support/preventure-research-terminal-recovery-fixture");

const FIXED_TIME = HISTORICAL_ACTIVE_V1_TIME;
const FINAL_AUTHORITY_HASH = "sha256:0b8dd7380f38a673e683482dd9fdbf0b4c1aff7c1eeb28341ca869927f0fa7ba";
const EXACT_OWNER_APPROVAL_NOTE = "Owner approved only the exact recorded bounded-research step.";

function trackedHistoricalRegistry() {
  let exactResolutionCount = 0;
  return {
    registry: Object.freeze({
      schema: historicalV1TestRegistry.schema,
      authorityHashes: historicalV1TestRegistry.authorityHashes,
      candidateAuthorityHash: historicalV1TestRegistry.candidateAuthorityHash,
      resolveAuthorityEntry(...args) {
        exactResolutionCount += 1;
        return historicalV1TestRegistry.resolveAuthorityEntry(...args);
      },
      resolveCandidateAuthorityEntry(...args) {
        return historicalV1TestRegistry.resolveCandidateAuthorityEntry(...args);
      },
    }),
    count: () => exactResolutionCount,
    reset: () => { exactResolutionCount = 0; },
  };
}

function runProductionDefaultChild(mode) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `pantheon-preventure-production-${mode}-`));
  const env = {
    ...process.env,
    PANTHEON_DATA_DIR: dir,
    PANTHEON_DB_PATH: path.join(dir, "runtime.sqlite"),
    PANTHEON_ARTIFACT_ROOT: path.join(dir, "artifacts"),
    PANTHEON_ENABLE_LIVE_RESEARCH: mode.startsWith("armed") ? "1" : "0",
    PANTHEON_SCHEDULER_ENABLED: "0",
  };
  if (mode.startsWith("armed")) env.OPENAI_API_KEY = "sk-fake-production-default-proof";
  else delete env.OPENAI_API_KEY;
  try {
    const result = childProcess.spawnSync(
      process.execPath,
      [path.join(__dirname, "support/preventure-production-default-child.js"), mode],
      {
        cwd: path.resolve(__dirname, ".."),
        env,
        encoding: "utf8",
        timeout: 120_000,
      },
    );
    assert.equal(
      result.status,
      0,
      JSON.stringify({ mode, stdout: result.stdout, stderr: result.stderr }),
    );
    return JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function startTestApp(name, options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `pantheon-preventure-http-${name}-`));
  const dbPath = path.join(dir, "runtime.sqlite");
  const preventureResearchClock = createMonotonicIsoClock(
    options.preventureResearchClock || (() => FIXED_TIME),
  );
  const db = openDatabase(dbPath, { clock: preventureResearchClock });
  seedDatabase(db, { includeDemoProof: false });
  const bootstrapSecret = `preventure-bootstrap-${name}`;
  const app = createApp({
    db,
    dbPath,
    schedulerEnabled: false,
    security: true,
    sessionSecret: Buffer.alloc(32, 41),
    bootstrapSecret,
    initializePreventureResearch: true,
    preventureResearchAuthorityRegistry: historicalV1TestRegistry,
    preventureResearchArtifactRoot: path.join(dir, "artifacts"),
    ...options,
    preventureResearchClock,
  });
  await new Promise((resolve, reject) => {
    app.server.once("error", reject);
    app.server.listen(0, "127.0.0.1", resolve);
  });
  return {
    ...app,
    bootstrapSecret,
    dir,
    origin: `http://127.0.0.1:${app.server.address().port}`,
    preventureResearchClock,
  };
}

async function startServerCreatedTestApp(name, clock) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `pantheon-preventure-created-${name}-`));
  const dbPath = path.join(dir, "runtime.sqlite");
  const bootstrapSecret = `preventure-created-bootstrap-${name}`;
  const app = createApp({
    dbPath,
    schedulerEnabled: false,
    security: true,
    sessionSecret: Buffer.alloc(32, 53),
    bootstrapSecret,
    initializePreventureResearch: true,
    preventureResearchClock: clock,
    preventureResearchAuthorityRegistry: historicalV1TestRegistry,
    preventureResearchArtifactRoot: path.join(dir, "artifacts"),
  });
  await new Promise((resolve, reject) => {
    app.server.once("error", reject);
    app.server.listen(0, "127.0.0.1", resolve);
  });
  return {
    ...app,
    bootstrapSecret,
    dir,
    origin: `http://127.0.0.1:${app.server.address().port}`,
  };
}

async function stopTestApp(app) {
  for (const client of app.wss.clients) client.terminate();
  await new Promise((resolve) => app.server.close(resolve));
  app.wss.close();
  app.db.close();
  fs.rmSync(app.dir, { recursive: true, force: true });
}

async function createSession(app) {
  const response = await fetch(`${app.origin}/api/session`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: app.origin,
      "x-pantheon-bootstrap": app.bootstrapSecret,
    },
    body: "{}",
  });
  const payload = await response.json();
  assert.equal(response.status, 201);
  return {
    cookie: response.headers.get("set-cookie").split(";", 1)[0],
    csrfToken: payload.csrfToken,
  };
}

async function readJson(app, pathname, session) {
  const response = await fetch(`${app.origin}${pathname}`, {
    headers: session ? { cookie: session.cookie } : {},
  });
  return { response, payload: await response.json() };
}

async function postJson(app, pathname, body, session, options = {}) {
  const headers = { "content-type": "application/json" };
  if (session) {
    headers.cookie = session.cookie;
    headers.origin = app.origin;
    if (options.csrf !== false) headers["x-pantheon-csrf"] = session.csrfToken;
  }
  const response = await fetch(`${app.origin}${pathname}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  return { response, payload: await response.json() };
}

function collectHistoricalFindings(db, options = {}) {
  return collectFindings(db, {
    ...options,
    preventureResearchAuthorityRegistry: historicalV1TestRegistry,
  });
}

async function approveLifecycle(app, session, decision) {
  const current = await readJson(app, "/api/preventure-research", session);
  assert.equal(current.response.status, 200);
  assert.ok(current.payload.current?.reviewDecision);
  const approval = current.payload.current.reviewDecision;
  const result = await postJson(
    app,
    `/api/preventure-research/lifecycle-decisions/${encodeURIComponent(approval.id)}/${decision}`,
    {
      scopeHash: approval.scopeHash,
      note: decision === "approve"
        ? EXACT_OWNER_APPROVAL_NOTE
        : "Owner declined this bounded-research path.",
    },
    session,
  );
  const latestServerError = get(
    app.db,
    "SELECT message, metadata FROM events WHERE type = 'server.error' ORDER BY id DESC LIMIT 1",
  );
  assert.equal(
    result.response.status,
    200,
    JSON.stringify({
      payload: result.payload,
      latestServerError,
      databaseClock: get(app.db, "SELECT pantheon_current_time() AS value")?.value,
      authorityExpiry: get(
        app.db,
        "SELECT expires_at FROM preventure_research_authorities WHERE authority_hash = ?",
        [authority.authorityHash],
      )?.expires_at,
      activeCommercialAuthorities: all(
        app.db,
        `SELECT contracts.decision_hash
         FROM commercial_test_contracts AS contracts
         WHERE (SELECT event_type FROM commercial_test_lifecycle_events AS events
                WHERE events.decision_hash = contracts.decision_hash
                ORDER BY sequence DESC LIMIT 1) = 'activated'`,
      ),
    }),
  );
  return result.payload;
}

test("production default registry fails closed after immutable v1 expiry", () => {
  const expired = runProductionDefaultChild("expired-default");
  assert.deepEqual(expired, {
    mode: "expired-default",
    providerCalls: 0,
    expired: true,
  });
});

test("historical test wiring proves credential and retained-output gates", () => {
  const blocked = runProductionDefaultChild("blocked");
  assert.deepEqual(blocked, {
    mode: "blocked",
    providerCalls: 0,
    blocked: true,
  });
  const armed = runProductionDefaultChild("armed");
  assert.equal(armed.mode, "armed");
  assert.equal(armed.providerCalls, 1);
  assert.equal(armed.recovered, true);
  assert.ok(armed.artifactFiles >= 1);
  assert.equal(armed.providerRequestId, "req_preventure_production_default_1");
  assert.equal(armed.providerResponseId, "resp_preventure_production_default_1");
  const withoutRequestHeader = runProductionDefaultChild("armed-no-request-header");
  assert.equal(withoutRequestHeader.providerCalls, 1);
  assert.equal(withoutRequestHeader.recovered, true);
  assert.equal(withoutRequestHeader.providerRequestId, null);
  assert.equal(
    withoutRequestHeader.providerResponseId,
    "resp_preventure_production_default_1",
  );
});

test("a server-created database uses the same historical authority clock and expires at the exact boundary", async () => {
  let clockValue = FIXED_TIME;
  const clock = () => clockValue;
  const app = await startServerCreatedTestApp("single-clock", clock);
  try {
    const runtimeClock = app.preventureResearchMonitorOptions.preventureResearchClock;
    const runtimeTime = runtimeClock();
    const databaseTime = get(app.db, "SELECT pantheon_current_time() AS value").value;
    assert.equal(Date.parse(databaseTime), Date.parse(runtimeTime) + 1);
    assert.equal(app.runtimeState.preventureResearch.initialization.status, "ready");
    assert.equal(
      get(
        app.db,
        "SELECT expires_at FROM preventure_research_authorities WHERE authority_hash = ?",
        [authority.authorityHash],
      ).expires_at,
      authority.expiresAt,
    );

    const session = await createSession(app);
    await approveLifecycle(app, session, "approve");
    await approveLifecycle(app, session, "approve");
    assert.equal(
      Number(get(app.db, "SELECT COUNT(*) AS count FROM preventure_research_assignments").count),
      authority.assignments.length,
    );

    const beforeExpiry = {
      attempts: Number(get(app.db, "SELECT COUNT(*) AS count FROM task_attempts").count),
      calls: Number(get(app.db, "SELECT COUNT(*) AS count FROM model_calls").count),
      costs: Number(get(app.db, "SELECT COUNT(*) AS count FROM costs").count),
    };
    clockValue = authority.expiresAt;
    assert.equal(
      get(app.db, "SELECT pantheon_current_time() AS value").value,
      new Date(authority.expiresAt).toISOString(),
    );
    const boundary = ensurePreventureResearchFoundation(app.db, {
      authorityRegistry: historicalV1TestRegistry,
      authority,
      readinessSpec,
      clock: runtimeClock,
    });
    assert.equal(boundary.expiry.status, "sealed");
    assert.equal(boundary.state, "expired");
    const expiryLifecycle = get(
      app.db,
      `SELECT occurred_at FROM preventure_research_lifecycle_events
       WHERE authority_hash = ? AND event_type = 'expired'`,
      [authority.authorityHash],
    );
    const expiryEvent = get(
      app.db,
      `SELECT ts, metadata FROM events
       WHERE type = 'preventure_research.expired' AND entity_id = ?
       ORDER BY id DESC LIMIT 1`,
      [authority.authorityHash],
    );
    assert.equal(expiryLifecycle.occurred_at, authority.expiresAt);
    assert.equal(JSON.parse(expiryEvent.metadata).terminalAt, authority.expiresAt);
    assert.equal(JSON.parse(expiryEvent.metadata).recordedAt, expiryEvent.ts);
    assert.ok(Date.parse(expiryEvent.ts) >= Date.parse(authority.expiresAt));
    assert.equal(
      get(
        app.db,
        "SELECT expires_at FROM preventure_research_authorities WHERE authority_hash = ?",
        [authority.authorityHash],
      ).expires_at,
      authority.expiresAt,
    );
    assert.deepEqual({
      attempts: Number(get(app.db, "SELECT COUNT(*) AS count FROM task_attempts").count),
      calls: Number(get(app.db, "SELECT COUNT(*) AS count FROM model_calls").count),
      costs: Number(get(app.db, "SELECT COUNT(*) AS count FROM costs").count),
    }, beforeExpiry);
  } finally {
    await stopTestApp(app);
  }
});

test("owner, decision, and monitor projections retain the server's exact authority registry", async () => {
  const tracked = trackedHistoricalRegistry();
  const app = await startTestApp("registry-threading", {
    preventureResearchAuthorityRegistry: tracked.registry,
  });
  try {
    const session = await createSession(app);

    tracked.reset();
    const decisions = await readJson(app, "/api/decisions", session);
    assert.equal(decisions.response.status, 200);
    assert.ok(tracked.count() > 0);

    tracked.reset();
    const system = await readJson(app, "/api/system", session);
    assert.equal(system.response.status, 200);
    assert.ok(tracked.count() > 0);

    tracked.reset();
    const monitor = await postJson(app, "/api/monitor/run", {}, session);
    assert.equal(monitor.response.status, 200);
    assert.ok(tracked.count() > 0);
    const retainedOptions = JSON.parse(get(
      app.db,
      "SELECT metadata FROM monitor_runs WHERE id = ?",
      [monitor.payload.result.id],
    ).metadata).options;
    assert.equal(Object.hasOwn(retainedOptions, "preventureResearchAuthorityRegistry"), false);
    assert.equal(Object.hasOwn(retainedOptions, "preventureResearchClock"), false);
    assert.equal(Object.hasOwn(retainedOptions, "preventureResearchRetainedOutputStore"), false);

    tracked.reset();
    const scheduledMonitor = await postJson(
      app,
      "/api/scheduler/jobs/job-monitor-cycle/run",
      { force: true },
      session,
    );
    assert.equal(scheduledMonitor.response.status, 200);
    assert.ok(tracked.count() > 0);
  } finally {
    await stopTestApp(app);
  }
});

test("a registered noncandidate authority remains readable but cannot create or run fresh work", async () => {
  const app = await startTestApp("historical-noncandidate");
  try {
    const session = await createSession(app);
    await approveLifecycle(app, session, "approve");
    await approveLifecycle(app, session, "approve");
    const store = createPreventureResearchStore(app.db, {
      clock: app.preventureResearchMonitorOptions.preventureResearchClock,
      authorityRegistry: expiredNonDispatchV2Registry,
    });
    const assignment = store.listAssignments(authority.authorityHash)[0];
    assert.ok(assignment);
    const finalizer = createPreventureResearchFinalizer({
      db: app.db,
      store,
      authority,
      readinessSpec,
      authorityRegistry: expiredNonDispatchV2Registry,
      clock: app.preventureResearchMonitorOptions.preventureResearchClock,
    });
    const bridge = createPreventureResearchExecutionBridge({
      db: app.db,
      store,
      authority,
      authorityRegistry: expiredNonDispatchV2Registry,
      finalizeDecision: finalizer,
      clock: app.preventureResearchMonitorOptions.preventureResearchClock,
      artifactRoot: path.join(app.dir, "historical-noncandidate-artifacts"),
      allowTestOverrides: true,
      apiKey: "test-only-noncandidate-must-not-dispatch",
      liveResearchEnabled: true,
      fetchImpl: async () => {
        throw new Error("A historical noncandidate authority must never reach the provider.");
      },
    });
    const readiness = bridge.readiness({
      authorityHash: authority.authorityHash,
      assignmentId: assignment.id,
      assignmentHash: assignment.assignmentHash,
    });
    assert.equal(readiness.ready, false);
    assert.equal(readiness.canPrepare, false);
    assert.equal(readiness.status, "historical_authority");
    assert.deepEqual(readiness.blockers.map((item) => item.code), [
      "preventure_research_authority_not_candidate",
    ]);
    assert.throws(
      () => bridge.prepareAssignment({
        authorityHash: authority.authorityHash,
        assignmentId: assignment.id,
        expectedAssignmentHash: assignment.assignmentHash,
        expectedDescriptorHash: null,
        expectedRequestBodyHash: null,
      }),
      (error) => error.code === "preventure_bridge_preparation_stale",
    );
    const before = {
      approvals: Number(get(app.db, "SELECT COUNT(*) AS count FROM approvals").count),
      assignments: Number(get(
        app.db,
        "SELECT COUNT(*) AS count FROM preventure_research_assignments",
      ).count),
    };
    const foundation = ensurePreventureResearchFoundation(app.db, {
      authorityRegistry: expiredNonDispatchV2Registry,
      authority,
      readinessSpec,
      clock: app.preventureResearchMonitorOptions.preventureResearchClock,
    });
    assert.equal(foundation.status, "withheld");
    assert.equal(foundation.reason, "historical_authority_not_candidate");
    assert.deepEqual({
      approvals: Number(get(app.db, "SELECT COUNT(*) AS count FROM approvals").count),
      assignments: Number(get(
        app.db,
        "SELECT COUNT(*) AS count FROM preventure_research_assignments",
      ).count),
    }, before);
    const finalization = finalizer.describeFinalization({
      authorityHash: authority.authorityHash,
    });
    assert.equal(finalization.ready, false);
    assert.equal(
      finalization.code,
      "preventure_research_finalizer_authority_not_candidate",
    );
  } finally {
    await stopTestApp(app);
  }
});

test("a renewal candidate stays withheld until its exact predecessor is durably terminal", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pantheon-preventure-renewal-lineage-"));
  const dbPath = path.join(dir, "runtime.sqlite");
  let clockValue = FIXED_TIME;
  const clock = createMonotonicIsoClock(() => clockValue);
  const db = openDatabase(dbPath, { clock });
  seedDatabase(db, { includeDemoProof: false });
  let app = null;
  try {
    const v1Foundation = ensurePreventureResearchFoundation(db, {
      authorityRegistry: historicalV1TestRegistry,
      authority,
      readinessSpec,
      clock,
    });
    assert.equal(v1Foundation.status, "ready");
    assert.equal(v1Foundation.state, "proposed");
    clockValue = EXPIRED_V2_ACTIVE_TEST_TIME;
    const before = {
      approvals: Number(get(db, "SELECT COUNT(*) AS count FROM approvals").count),
      authorities: Number(get(
        db,
        "SELECT COUNT(*) AS count FROM preventure_research_authorities",
      ).count),
    };
    const withheld = ensurePreventureResearchFoundation(db, {
      authorityRegistry: expiredNonDispatchV2Registry,
      authority: expiredNonDispatchV2Authority,
      readinessSpec,
      clock,
    });
    assert.equal(withheld.status, "withheld");
    assert.equal(withheld.reason, "candidate_predecessor_not_terminal");
    assert.equal(withheld.predecessorAuthorityHash, authority.authorityHash);
    assert.deepEqual({
      approvals: Number(get(db, "SELECT COUNT(*) AS count FROM approvals").count),
      authorities: Number(get(
        db,
        "SELECT COUNT(*) AS count FROM preventure_research_authorities",
      ).count),
    }, before);
    const store = createPreventureResearchStore(db, {
      clock,
      authorityRegistry: expiredNonDispatchV2Registry,
    });
    const latestV1 = store.loadLifecycle(authority.authorityHash).at(-1);
    terminatePreventureResearchAuthority(
      store,
      authority.authorityHash,
      "revoked",
      {
        expectedLatestEventHash: latestV1.eventHash,
        occurredAt: "2026-08-03T01:30:00.000Z",
        actor: "owner",
        reason: "The owner closed the historical test authority before reviewing its renewal.",
      },
    );
    const admitted = ensurePreventureResearchFoundation(db, {
      authorityRegistry: expiredNonDispatchV2Registry,
      authority: expiredNonDispatchV2Authority,
      readinessSpec,
      clock,
    });
    assert.equal(admitted.status, "ready");
    assert.equal(admitted.proposalCreated, true);
    assert.equal(admitted.approvalCreated, true);
    assert.equal(admitted.state, "proposed");
    const bootstrapSecret = "preventure-renewal-lineage-bootstrap";
    app = createApp({
      db,
      dbPath,
      schedulerEnabled: false,
      security: true,
      sessionSecret: Buffer.alloc(32, 61),
      bootstrapSecret,
      initializePreventureResearch: true,
      preventureResearchClock: clock,
      preventureResearchAuthorityRegistry: expiredNonDispatchV2Registry,
      preventureResearchAuthority: expiredNonDispatchV2Authority,
      preventureResearchReadinessSpec: readinessSpec,
      preventureResearchArtifactRoot: path.join(dir, "artifacts"),
    });
    await new Promise((resolve, reject) => {
      app.server.once("error", reject);
      app.server.listen(0, "127.0.0.1", resolve);
    });
    Object.assign(app, {
      bootstrapSecret,
      dir,
      origin: `http://127.0.0.1:${app.server.address().port}`,
    });
    const session = await createSession(app);
    await approveLifecycle(app, session, "approve");
    await approveLifecycle(app, session, "approve");
    const coexistenceStore = createPreventureResearchStore(db, {
      clock,
      authorityRegistry: expiredNonDispatchV2Registry,
    });
    assert.equal(coexistenceStore.verifyLedger().ok, true);
    assert.equal(coexistenceStore.readState(authority.authorityHash).state, "revoked");
    assert.equal(
      coexistenceStore.readState(expiredNonDispatchV2Authority.authorityHash).state,
      "activated",
    );
    assert.equal(
      coexistenceStore.listAssignments(expiredNonDispatchV2Authority.authorityHash).length,
      expiredNonDispatchV2Authority.assignments.length,
    );
  } finally {
    if (app) await stopTestApp(app);
    else {
      db.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

test("authenticated owner-session controls activate exact blocked work while every generic and unavailable runner path stays fail-closed", async () => {
  const app = await startTestApp("lifecycle");
  try {
    assert.equal(authority.authorityHash, FINAL_AUTHORITY_HASH);
    const unauthenticated = await readJson(app, "/api/preventure-research");
    assert.equal(unauthenticated.response.status, 401);

    const session = await createSession(app);
    const proposed = await readJson(app, "/api/preventure-research", session);
    assert.equal(proposed.response.status, 200);
    assert.equal(proposed.payload.integrity.status, "ok");
    assert.equal(proposed.payload.current.lifecycle.status, "proposed");
    assert.equal(proposed.payload.current.authority.hash, FINAL_AUTHORITY_HASH);
    assert.equal(proposed.payload.current.budget.authorityCapAudCents, 200);
    assert.equal(proposed.payload.current.budget.externalCommercialSpendCapAudCents, 0);
    assert.equal(proposed.payload.runtime.status, "not_ready");
    assert.equal(proposed.payload.runtime.providerContactAllowed, false);

    const lifecyclePath = `/api/preventure-research/lifecycle-decisions/${encodeURIComponent(proposed.payload.current.reviewDecision.id)}/approve`;
    const exactLifecycleBody = {
      scopeHash: proposed.payload.current.reviewDecision.scopeHash,
    };
    const unauthenticatedMutation = await postJson(
      app,
      lifecyclePath,
      exactLifecycleBody,
      null,
    );
    assert.equal(unauthenticatedMutation.response.status, 401);
    assert.equal(
      Number(get(
        app.db,
        "SELECT COUNT(*) AS count FROM preventure_research_approval_decisions",
      ).count),
      0,
    );
    assert.equal(
      Number(get(
        app.db,
        "SELECT COUNT(*) AS count FROM preventure_research_lifecycle_events WHERE event_type = 'accepted'",
      ).count),
      0,
    );

    const missingCsrf = await postJson(
      app,
      lifecyclePath,
      exactLifecycleBody,
      session,
      { csrf: false },
    );
    assert.equal(missingCsrf.response.status, 403);
    assert.equal(
      Number(get(
        app.db,
        "SELECT COUNT(*) AS count FROM preventure_research_approval_decisions",
      ).count),
      0,
    );
    assert.equal(
      Number(get(
        app.db,
        "SELECT COUNT(*) AS count FROM preventure_research_lifecycle_events WHERE event_type = 'accepted'",
      ).count),
      0,
    );

    const acceptanceViaGenericRoute = await postJson(
      app,
      `/api/approvals/${encodeURIComponent(proposed.payload.current.reviewDecision.id)}/approve`,
      { scopeHash: proposed.payload.current.reviewDecision.scopeHash },
      session,
    );
    assert.equal(acceptanceViaGenericRoute.response.status, 409);
    assert.equal(
      acceptanceViaGenericRoute.payload.code,
      "preventure_research_lifecycle_decision_required",
    );

    await approveLifecycle(app, session, "approve");
    const acceptanceReceipt = get(
      app.db,
      `SELECT decision_receipt_hash, approval_id, authority_hash, event_type, scope_hash, decided_by,
              decision_source, decision_status, receipt_json
       FROM preventure_research_approval_decisions
       WHERE approval_id = ?`,
      [proposed.payload.current.reviewDecision.id],
    );
    assert.equal(acceptanceReceipt.authority_hash, FINAL_AUTHORITY_HASH);
    assert.equal(acceptanceReceipt.event_type, "accepted");
    assert.equal(acceptanceReceipt.scope_hash, exactLifecycleBody.scopeHash);
    assert.equal(acceptanceReceipt.decided_by, "owner");
    assert.equal(
      acceptanceReceipt.decision_source,
      "authenticated_owner_session_attestation",
    );
    assert.equal(acceptanceReceipt.decision_status, "approved");
    const durableAttestation = JSON.parse(acceptanceReceipt.receipt_json);
    assert.equal(
      durableAttestation.schema,
      "pantheon.preventure-research-approval-decision.v2",
    );
    assert.equal(
      durableAttestation.decisionNoteHash,
      sha256(EXACT_OWNER_APPROVAL_NOTE),
    );
    assert.equal(durableAttestation.receiptHash, acceptanceReceipt.decision_receipt_hash);
    assert.equal(acceptanceReceipt.receipt_json.includes(session.csrfToken), false);
    assert.equal(acceptanceReceipt.receipt_json.includes(session.cookie), false);
    const accepted = await readJson(app, "/api/preventure-research", session);
    assert.equal(accepted.payload.current.lifecycle.status, "accepted");
    assert.equal(accepted.payload.current.assignments.materialized, 0);
    assert.equal(accepted.payload.controls.allowed.includes("review_activation"), true);

    await approveLifecycle(app, session, "approve");
    const activated = await readJson(app, "/api/preventure-research", session);
    assert.equal(activated.payload.current.lifecycle.status, "activated");
    assert.equal(activated.payload.current.assignments.materialized, 3);
    assert.equal(activated.payload.current.assignments.expected, 3);

    app.db.prepare("UPDATE scheduler_jobs SET status = 'disabled'").run();
    app.db.prepare(
      `UPDATE scheduler_jobs
       SET status = 'enabled', next_run_at = ?, locked_at = NULL
       WHERE id = 'job-preventure-research'`,
    ).run(FIXED_TIME);
    const beforeGenericMaintenance = {
      attempts: Number(get(app.db, "SELECT COUNT(*) AS count FROM task_attempts").count),
      calls: Number(get(app.db, "SELECT COUNT(*) AS count FROM model_calls").count),
      costs: Number(get(app.db, "SELECT COUNT(*) AS count FROM costs").count),
    };
    const genericMaintenance = await postJson(
      app,
      "/api/system/maintenance/run-due",
      { limit: 10 },
      session,
    );
    assert.equal(genericMaintenance.response.status, 200);
    const protectedRun = genericMaintenance.payload.result.runs.find(
      (item) => item.jobId === "job-preventure-research",
    );
    assert.equal(protectedRun.status, "skipped");
    assert.equal(
      protectedRun.result.reason,
      "exact_preventure_research_control_required",
    );
    assert.deepEqual({
      attempts: Number(get(app.db, "SELECT COUNT(*) AS count FROM task_attempts").count),
      calls: Number(get(app.db, "SELECT COUNT(*) AS count FROM model_calls").count),
      costs: Number(get(app.db, "SELECT COUNT(*) AS count FROM costs").count),
    }, beforeGenericMaintenance);

    const tasks = all(
      app.db,
      `SELECT id, workflow_id, kind, status, payload
       FROM tasks WHERE kind = 'preventure_research' ORDER BY id`,
    );
    assert.equal(tasks.length, 3);
    assert.deepEqual([...new Set(tasks.map((task) => task.status))], ["blocked"]);
    const genericReconciliation = await postJson(
      app,
      "/api/system/spend/reconcile-provider-usage",
      { allocations: [{ taskId: tasks[0].id }] },
      session,
    );
    assert.equal(genericReconciliation.response.status, 409);
    assert.equal(
      genericReconciliation.payload.code,
      "preventure_research_dedicated_reconciliation_required",
    );

    app.db.prepare(
      "UPDATE tasks SET status = 'needs_attention', updated_at = ? WHERE id = ?",
    ).run(FIXED_TIME, tasks[0].id);
    const restartedFoundation = ensurePreventureResearchFoundation(app.db, {
      authority,
      readinessSpec,
      clock: app.preventureResearchMonitorOptions.preventureResearchClock,
      authorityRegistry: historicalV1TestRegistry,
    });
    assert.equal(restartedFoundation.status, "ready");
    assert.equal(restartedFoundation.materialized, false);
    app.db.prepare(
      "UPDATE tasks SET status = 'blocked', updated_at = ? WHERE id = ?",
    ).run(FIXED_TIME, tasks[0].id);

    assert.equal(unsafeTaskReason(tasks[0]), "preventure_research_dedicated_runner");
    assert.equal(
      inspectSafeWorkflow(app.db, tasks[0].workflow_id).reason,
      "preventure_research_dedicated_runner",
    );

    const genericTask = await postJson(
      app,
      `/api/tasks/${encodeURIComponent(tasks[0].id)}/run`,
      {},
      session,
    );
    assert.equal(genericTask.response.status, 409);
    assert.equal(genericTask.payload.code, "preventure_research_dedicated_runner_required");

    for (const suffix of ["run", "run-until-blocked"]) {
      const genericWorkflow = await postJson(
        app,
        `/api/workflows/${encodeURIComponent(tasks[0].workflow_id)}/${suffix}`,
        suffix === "run" ? {} : { maxSteps: 3 },
        session,
      );
      assert.equal(genericWorkflow.response.status, 409);
      assert.equal(genericWorkflow.payload.code, "preventure_research_dedicated_runner_required");
    }

    const originalWorkflow = get(
      app.db,
      "SELECT type FROM workflows WHERE id = ?",
      [tasks[0].workflow_id],
    );
    const beforeTamperedGenericPaths = {
      attempts: Number(get(app.db, "SELECT COUNT(*) AS count FROM task_attempts").count),
      calls: Number(get(app.db, "SELECT COUNT(*) AS count FROM model_calls").count),
      costs: Number(get(app.db, "SELECT COUNT(*) AS count FROM costs").count),
      reservations: Number(get(app.db, "SELECT COUNT(*) AS count FROM budget_reservations").count),
      approvals: Number(get(app.db, "SELECT COUNT(*) AS count FROM approvals").count),
      events: Number(get(app.db, "SELECT COUNT(*) AS count FROM events").count),
    };
    app.db.prepare(
      "UPDATE tasks SET kind = 'protected_internal', status = 'queued', payload = '{}' WHERE id = ?",
    ).run(tasks[0].id);
    app.db.prepare(
      "UPDATE workflows SET type = 'ordinary_internal_work' WHERE id = ?",
    ).run(tasks[0].workflow_id);
    const tamperedSystem = await readJson(app, "/api/system", session);
    const tamperedWork = tamperedSystem.payload.queue.find((item) => item.id === tasks[0].id);
    assert.equal(tamperedWork.execution_kind, "preventure_research");
    assert.equal(tamperedWork.can_run, false);
    assert.equal(
      tamperedWork.safety_reason,
      "preventure_research_integrity_unavailable",
    );
    const tamperedGenericPaths = [
      [`/api/tasks/${encodeURIComponent(tasks[0].id)}/run`, {}],
      [`/api/tasks/${encodeURIComponent(tasks[0].id)}/prepare-known-ai-retry`, {}],
      [`/api/workflows/${encodeURIComponent(tasks[0].workflow_id)}/run`, {}],
      [`/api/workflows/${encodeURIComponent(tasks[0].workflow_id)}/run-until-blocked`, { maxSteps: 3 }],
      [`/api/workflows/${encodeURIComponent(tasks[0].workflow_id)}/approval-pack`, {}],
      [`/api/workflows/${encodeURIComponent(tasks[0].workflow_id)}/request-live-research`, {}],
      [`/api/workflows/${encodeURIComponent(tasks[0].workflow_id)}/request-live-ai-worker`, {}],
      [`/api/workflows/${encodeURIComponent(tasks[0].workflow_id)}/product-builder/prepare-asset`, {}],
    ];
    for (const [pathname, body] of tamperedGenericPaths) {
      const rejected = await postJson(app, pathname, body, session);
      assert.equal(rejected.response.status, 409, pathname);
      assert.equal(
        rejected.payload.code,
        "preventure_research_dedicated_runner_required",
        pathname,
      );
    }
    const untargetedTick = await postJson(app, "/api/runtime/tick", {}, session);
    assert.equal(untargetedTick.response.status, 200);
    assert.equal(untargetedTick.payload.result.status, "idle");
    assert.equal(untargetedTick.payload.result.reason, "no_safe_internal_task");
    assert.deepEqual(
      {
        attempts: Number(get(app.db, "SELECT COUNT(*) AS count FROM task_attempts").count),
        calls: Number(get(app.db, "SELECT COUNT(*) AS count FROM model_calls").count),
        costs: Number(get(app.db, "SELECT COUNT(*) AS count FROM costs").count),
        reservations: Number(get(app.db, "SELECT COUNT(*) AS count FROM budget_reservations").count),
        approvals: Number(get(app.db, "SELECT COUNT(*) AS count FROM approvals").count),
        events: Number(get(app.db, "SELECT COUNT(*) AS count FROM events").count),
      },
      beforeTamperedGenericPaths,
    );
    app.db.prepare(
      "UPDATE workflows SET type = ? WHERE id = ?",
    ).run(originalWorkflow.type, tasks[0].workflow_id);
    app.db.prepare(
      "UPDATE tasks SET kind = ?, status = ?, payload = ? WHERE id = ?",
    ).run(tasks[0].kind, tasks[0].status, tasks[0].payload, tasks[0].id);

    const assignmentRow = get(
      app.db,
      `SELECT assignment_id, assignment_hash
       FROM preventure_research_assignments WHERE task_id = ?`,
      [tasks[0].id],
    );
    const before = {
      attempts: Number(get(app.db, "SELECT COUNT(*) AS count FROM task_attempts").count),
      calls: Number(get(app.db, "SELECT COUNT(*) AS count FROM model_calls").count),
      costs: Number(get(app.db, "SELECT COUNT(*) AS count FROM costs").count),
      reservations: Number(get(app.db, "SELECT COUNT(*) AS count FROM budget_reservations").count),
      authorityCosts: Number(get(app.db, "SELECT COUNT(*) AS count FROM preventure_research_cost_events").count),
    };
    const blockedSystem = await readJson(app, "/api/system", session);
    const blockedControl = blockedSystem.payload.preventureResearchRuntime.assignmentControls
      .find((item) => item.assignmentId === assignmentRow.assignment_id);
    assert.ok(blockedControl?.descriptorHash);
    assert.ok(blockedControl?.requestBodyHash);
    const dedicated = await postJson(
      app,
      `/api/preventure-research/assignments/${encodeURIComponent(assignmentRow.assignment_id)}/run`,
      {
        authorityHash: authority.authorityHash,
        assignmentHash: assignmentRow.assignment_hash,
        descriptorHash: blockedControl.descriptorHash,
        requestBodyHash: blockedControl.requestBodyHash,
      },
      session,
    );
    assert.equal(dedicated.response.status, 503);
    assert.equal(dedicated.payload.code, "preventure_research_runtime_not_ready");
    assert.equal(dedicated.payload.readiness.providerContactAllowed, false);

    const widenedRun = await postJson(
      app,
      `/api/preventure-research/assignments/${encodeURIComponent(assignmentRow.assignment_id)}/run`,
      {
        authorityHash: authority.authorityHash,
        assignmentHash: assignmentRow.assignment_hash,
        descriptorHash: `sha256:${"0".repeat(64)}`,
        requestBodyHash: `sha256:${"5".repeat(64)}`,
        tools: ["web_search", "browser"],
      },
      session,
    );
    assert.equal(widenedRun.response.status, 400);
    assert.equal(widenedRun.payload.code, "preventure_research_request_scope_changed");

    const reprocess = await postJson(
      app,
      `/api/preventure-research/assignments/${encodeURIComponent(assignmentRow.assignment_id)}/reprocess`,
      {
        authorityHash: authority.authorityHash,
        assignmentHash: assignmentRow.assignment_hash,
        descriptorHash: `sha256:${"0".repeat(64)}`,
        retainedOutputHash: `sha256:${"1".repeat(64)}`,
      },
      session,
    );
    assert.equal(reprocess.response.status, 503);
    assert.equal(reprocess.payload.code, "preventure_research_reprocess_not_ready");

    const finalize = await postJson(
      app,
      "/api/preventure-research/finalize",
      {
        authorityHash: authority.authorityHash,
        evidenceSetHash: `sha256:${"2".repeat(64)}`,
        receiptSetHash: `sha256:${"3".repeat(64)}`,
        resultingReadinessHash: `sha256:${"4".repeat(64)}`,
      },
      session,
    );
    assert.equal(finalize.response.status, 503);
    assert.equal(finalize.payload.code, "preventure_research_decision_runtime_not_ready");
    const after = {
      attempts: Number(get(app.db, "SELECT COUNT(*) AS count FROM task_attempts").count),
      calls: Number(get(app.db, "SELECT COUNT(*) AS count FROM model_calls").count),
      costs: Number(get(app.db, "SELECT COUNT(*) AS count FROM costs").count),
      reservations: Number(get(app.db, "SELECT COUNT(*) AS count FROM budget_reservations").count),
      authorityCosts: Number(get(app.db, "SELECT COUNT(*) AS count FROM preventure_research_cost_events").count),
    };
    assert.deepEqual(after, before);

    const [cockpit, system] = await Promise.all([
      readJson(app, "/api/cockpit", session),
      readJson(app, "/api/system", session),
    ]);
    assert.equal(cockpit.response.status, 200);
    assert.equal(cockpit.payload.preventureResearch.current.lifecycle.status, "activated");
    assert.equal(cockpit.payload.preventureResearchRuntime.status, "not_ready");
    assert.equal(system.response.status, 200);
    assert.equal(system.payload.preventureResearch.current.lifecycle.status, "activated");
    const queueItem = system.payload.queue.find((item) => item.id === tasks[0].id);
    assert.equal(queueItem.execution_kind, "preventure_research");
    assert.equal(queueItem.can_run, false);
    assert.equal(queueItem.safety_reason, "preventure_research_runtime_not_ready");

    const latestHash = activated.payload.current.lifecycle.latestEventHash;
    const revoked = await postJson(
      app,
      "/api/preventure-research/revoke",
      {
        authorityHash: authority.authorityHash,
        expectedLatestEventHash: latestHash,
        confirm: "REVOKE PREVENTURE RESEARCH",
        note: "Owner stopped this bounded internal diligence round.",
      },
      session,
    );
    assert.equal(revoked.response.status, 200, JSON.stringify(revoked.payload));
    assert.equal(revoked.payload.result.state.state, "revoked");
    assert.equal(
      Number(get(app.db, "SELECT COUNT(*) AS count FROM tasks WHERE kind = 'preventure_research' AND status = 'cancelled'").count),
      3,
    );
    const ownedEvents = Number(get(
      app.db,
      `SELECT COUNT(*) AS count FROM events
       WHERE (type LIKE 'preventure_research.%' OR type LIKE 'preventure_research_lifecycle.%')
         AND venture_id IS NOT NULL`,
    ).count);
    assert.equal(ownedEvents, 0);
  } finally {
    await stopTestApp(app);
  }
});

test("a security-disabled server cannot mint a protected owner approval", async () => {
  const app = await startTestApp("security-disabled-owner", { security: false });
  try {
    const proposed = await readJson(app, "/api/preventure-research");
    assert.equal(proposed.response.status, 200);
    const approval = proposed.payload.current.reviewDecision;
    const attempted = await postJson(
      app,
      `/api/preventure-research/lifecycle-decisions/${encodeURIComponent(approval.id)}/approve`,
      { scopeHash: approval.scopeHash, note: EXACT_OWNER_APPROVAL_NOTE },
    );
    assert.equal(attempted.response.status, 403);
    assert.equal(
      attempted.payload.code,
      "preventure_research_lifecycle_owner_session_required",
    );
    assert.equal(
      get(app.db, "SELECT status FROM approvals WHERE id = ?", [approval.id]).status,
      "pending",
    );
    assert.equal(
      get(app.db, "SELECT COUNT(*) AS count FROM preventure_research_approval_decisions").count,
      0,
    );
  } finally {
    await stopTestApp(app);
  }
});

test("owner revocation atomically terminalizes an in-flight provider assignment at full pending exposure", async () => {
  let rawTime = FIXED_TIME;
  const app = await startTestApp("active-owner-revoke", {
    preventureResearchClock: () => rawTime,
  });
  try {
    const session = await createSession(app);
    await approveLifecycle(app, session, "approve");
    await approveLifecycle(app, session, "approve");
    const store = createPreventureResearchStore(app.db, {
      clock: app.preventureResearchClock,
      authorityRegistry: historicalV1TestRegistry,
    });
    const assignment = store.listAssignments(authority.authorityHash)[0];
    const currentTime = get(app.db, "SELECT pantheon_current_time() AS value").value;
    rawTime = addMilliseconds(currentTime, 100);
    const execution = prepareDispatchedExecution({
      db: app.db,
      store,
      assignment,
      get clockValue() { return rawTime; },
      setClock(value) {
        rawTime = value;
        return value;
      },
    }, {
      dispatchedAt: rawTime,
      productionRunIdentity: true,
    });
    rawTime = addMilliseconds(execution.dispatchedAt, 100);
    const ownerState = await readJson(app, "/api/preventure-research", session);
    assert.equal(ownerState.response.status, 200);
    const response = await postJson(
      app,
      "/api/preventure-research/revoke",
      {
        authorityHash: authority.authorityHash,
        expectedLatestEventHash: ownerState.payload.current.lifecycle.latestEventHash,
        confirm: "REVOKE PREVENTURE RESEARCH",
        note: "Owner revocation must win immediately over this in-flight bounded call.",
      },
      session,
    );
    assert.equal(response.response.status, 200, JSON.stringify(response.payload));
    assert.equal(response.payload.result.state.state, "revoked");
    assert.deepEqual(response.payload.result.inflightSafety, {
      affectedTasks: 1,
      providerOutcomesUnknown: 1,
    });
    assert.deepEqual({ ...get(
      app.db,
      `SELECT tasks.status AS task_status, tasks.outcome_status AS task_outcome,
              tasks.claim_token AS task_claim, attempts.status AS attempt_status,
              attempts.error_kind AS attempt_error, calls.status AS model_status,
              calls.outcome_status AS model_outcome, calls.cost_status AS model_cost_status,
              reservations.status AS reservation_status, reservations.amount_cents AS reservation_amount,
              costs.status AS cost_status, costs.amount_cents AS cost_amount
       FROM tasks
       JOIN task_attempts AS attempts ON attempts.id = ?
       JOIN model_calls AS calls ON calls.id = ?
       JOIN budget_reservations AS reservations ON reservations.id = ?
       JOIN costs ON costs.id = ?
       WHERE tasks.id = ?`,
      [
        execution.ids.attemptId,
        execution.ids.modelCallId,
        execution.ids.reservationId,
        execution.ids.costId,
        assignment.taskId,
      ],
    ) }, {
      task_status: "needs_attention",
      task_outcome: "unknown",
      task_claim: null,
      attempt_status: "needs_attention",
      attempt_error: "operator_emergency_stop",
      model_status: "needs_attention",
      model_outcome: "unknown",
      model_cost_status: "unknown",
      reservation_status: "unknown",
      reservation_amount: assignment.maxCostAudCents,
      cost_status: "unknown",
      cost_amount: assignment.maxCostAudCents,
    });
    const ledger = store.readLedger(authority.authorityHash);
    const head = ledger.costEvents.filter(
      (event) => event.assignmentHash === assignment.assignmentHash,
    ).at(-1);
    assert.equal(head.eventType, "unknown");
    assert.equal(head.exposureAudCents, assignment.maxCostAudCents);
    assert.equal(head.emergencyStop.schema, "pantheon.preventure-research-emergency-cost-transition.v1");
    assert.equal(store.verifyLedger().ok, true);
    assert.equal(get(
      app.db,
      "SELECT status FROM scheduler_jobs WHERE id = 'job-preventure-research'",
    ).status, "disabled");
    assert.equal(get(
      app.db,
      "SELECT COUNT(*) AS count FROM preventure_research_terminal_recoveries",
    ).count, 0);
    assert.equal(get(
      app.db,
      "SELECT COUNT(*) AS count FROM preventure_research_evidence_records",
    ).count, 0);
    assert.equal(get(
      app.db,
      "SELECT COUNT(*) AS count FROM preventure_research_decisions",
    ).count, 0);
  } finally {
    await stopTestApp(app);
  }
});

test("monitor surfaces bounded-research expiry and incomplete terminal receipt without treating blocked work as completed", async () => {
  let clockValue = FIXED_TIME;
  const app = await startTestApp("monitor", {
    preventureResearchClock: () => clockValue,
  });
  try {
    const session = await createSession(app);
    await approveLifecycle(app, session, "approve");
    await approveLifecycle(app, session, "approve");
    const task = get(
      app.db,
      "SELECT id FROM tasks WHERE kind = 'preventure_research' ORDER BY id LIMIT 1",
    );

    const ordinary = collectHistoricalFindings(app.db, { at: FIXED_TIME });
    assert.equal(
      ordinary.some((finding) => (
        finding.category === "agent_receipts"
        && finding.entityId === task.id
      )),
      false,
    );

    const assignment = get(
      app.db,
      `SELECT assignment_hash
       FROM preventure_research_assignments WHERE task_id = ?`,
      [task.id],
    );
    clockValue = "2026-08-02T03:00:02.000Z";
    const researchStore = createPreventureResearchStore(app.db, {
      clock: app.preventureResearchMonitorOptions.preventureResearchClock,
      authorityRegistry: historicalV1TestRegistry,
    });
    researchStore.appendCostEvent(assignment.assignment_hash, {
      costKey: `preventure_cost_${assignment.assignment_hash.slice(-24)}`,
      eventType: "reserved",
      amountAudCents: 50,
      exposureAudCents: 50,
      occurredAt: "2026-08-02T03:00:01.000Z",
    });
    const unboundCost = collectHistoricalFindings(app.db, {
      at: "2026-08-02T03:00:02.000Z",
    });
    assert.equal(
      unboundCost.some((finding) => (
        finding.category === "cost"
        && finding.metadata?.missingGenericBinding === true
      )),
      true,
    );
    researchStore.appendCostEvent(assignment.assignment_hash, {
      costKey: `preventure_cost_${assignment.assignment_hash.slice(-24)}`,
      eventType: "released",
      amountAudCents: 0,
      exposureAudCents: 0,
      occurredAt: "2026-08-02T03:00:02.000Z",
    });

    app.db.prepare(
      "UPDATE tasks SET status = 'completed', updated_at = ? WHERE id = ?",
    ).run(FIXED_TIME, task.id);
    const missingReceipt = collectHistoricalFindings(app.db, { at: FIXED_TIME });
    assert.equal(
      missingReceipt.some((finding) => (
        finding.category === "agent_receipts"
        && finding.entityId === task.id
      )),
      true,
    );
    app.db.prepare(
      "UPDATE tasks SET status = 'blocked', updated_at = ? WHERE id = ?",
    ).run(FIXED_TIME, task.id);

    const expired = collectHistoricalFindings(app.db, {
      at: "2026-08-10T00:00:00.000Z",
    });
    assert.equal(
      expired.some((finding) => (
        finding.category === "preventure_authority"
        && finding.title.includes("expired without a sealed stop record")
      )),
      true,
    );
  } finally {
    await stopTestApp(app);
  }
});

test("monitor withholds a tampered bounded-research owner decision", async () => {
  const app = await startTestApp("approval-integrity");
  try {
    const session = await createSession(app);
    const approval = get(
      app.db,
      `SELECT id, scope_hash FROM approvals
       WHERE status = 'pending'
         AND json_extract(payload, '$.preventureResearchApprovalScope.eventType') = 'accepted'
       ORDER BY requested_at LIMIT 1`,
    );
    assert.ok(approval?.id);
    app.db.prepare(
      "UPDATE approvals SET scope_hash = ? WHERE id = ?",
    ).run(`sha256:${"9".repeat(64)}`, approval.id);

    const ownerState = await readJson(app, "/api/preventure-research", session);
    assert.equal(ownerState.response.status, 200);
    assert.equal(
      ownerState.payload.controls.allowed.includes("review_acceptance"),
      false,
    );
    assert.equal(ownerState.payload.current?.reviewDecision || null, null);

    const tamperedDecisions = await readJson(app, "/api/decisions", session);
    assert.equal(tamperedDecisions.response.status, 200);
    assert.equal(
      tamperedDecisions.payload.approvals.some((item) => item.id === approval.id),
      false,
    );

    const rejected = await postJson(
      app,
      `/api/preventure-research/lifecycle-decisions/${encodeURIComponent(approval.id)}/approve`,
      { scopeHash: approval.scope_hash },
      session,
    );
    assert.equal(rejected.response.status, 409);
    assert.equal(
      Number(get(
        app.db,
        "SELECT COUNT(*) AS count FROM preventure_research_approval_decisions",
      ).count),
      0,
    );
    assert.equal(
      Number(get(
        app.db,
        "SELECT COUNT(*) AS count FROM preventure_research_lifecycle_events WHERE event_type = 'accepted'",
      ).count),
      0,
    );

    const findings = collectHistoricalFindings(app.db, { at: FIXED_TIME });
    assert.equal(
      findings.some((finding) => (
        finding.category === "approval_integrity"
        && finding.entityType === "preventure_research_authority"
        && finding.metadata?.pendingApprovalIds?.includes(approval.id)
      )),
      true,
    );

    app.db.prepare(
      "UPDATE approvals SET scope_hash = ?, scope = '{}', payload = '{}' WHERE id = ?",
    ).run(approval.scope_hash, approval.id);
    const damagedGeneric = await postJson(
      app,
      `/api/approvals/${encodeURIComponent(approval.id)}/approve`,
      { scopeHash: approval.scope_hash },
      session,
    );
    assert.equal(damagedGeneric.response.status, 409);
    assert.equal(
      damagedGeneric.payload.code,
      "preventure_research_lifecycle_decision_required",
    );
    const damagedDecisions = await readJson(app, "/api/decisions", session);
    assert.equal(
      damagedDecisions.payload.approvals.some((item) => item.id === approval.id),
      false,
    );

    app.db.prepare("DELETE FROM approvals WHERE id = ?").run(approval.id);
    const missingOwnerState = await readJson(app, "/api/preventure-research", session);
    assert.equal(missingOwnerState.payload.integrity.status, "attention");
    assert.equal(missingOwnerState.payload.integrity.authorityStatus, "invalid_approval");
    assert.equal(missingOwnerState.payload.current?.reviewDecision || null, null);
    assert.deepEqual(missingOwnerState.payload.controls.allowed, []);
    const missingFindings = collectHistoricalFindings(app.db, { at: FIXED_TIME });
    assert.equal(
      missingFindings.some((finding) => (
        finding.category === "approval_integrity"
        && finding.entityType === "preventure_research_authority"
        && finding.metadata?.expectedPendingEvent === "accepted"
      )),
      true,
    );
  } finally {
    await stopTestApp(app);
  }
});

test("startup maintenance seals an expired bounded round without a provider call", async () => {
  let clockValue = FIXED_TIME;
  const app = await startTestApp("expiry-seal", {
    preventureResearchClock: () => clockValue,
  });
  try {
    const session = await createSession(app);
    await approveLifecycle(app, session, "approve");
    await approveLifecycle(app, session, "approve");
    const before = {
      attempts: Number(get(app.db, "SELECT COUNT(*) AS count FROM task_attempts").count),
      calls: Number(get(app.db, "SELECT COUNT(*) AS count FROM model_calls").count),
      costs: Number(get(app.db, "SELECT COUNT(*) AS count FROM costs").count),
    };
    clockValue = "2026-08-10T00:00:00.000+10:00";
    const result = ensurePreventureResearchFoundation(app.db, {
      authority,
      readinessSpec,
      clock: app.preventureResearchMonitorOptions.preventureResearchClock,
      authorityRegistry: historicalV1TestRegistry,
    });
    assert.equal(result.status, "ready");
    assert.equal(result.expiry.status, "sealed");
    assert.equal(result.state, "expired");
    assert.deepEqual(
      {
        attempts: Number(get(app.db, "SELECT COUNT(*) AS count FROM task_attempts").count),
        calls: Number(get(app.db, "SELECT COUNT(*) AS count FROM model_calls").count),
        costs: Number(get(app.db, "SELECT COUNT(*) AS count FROM costs").count),
      },
      before,
    );
    assert.equal(
      Number(get(
        app.db,
        "SELECT COUNT(*) AS count FROM preventure_research_lifecycle_events WHERE event_type = 'expired'",
      ).count),
      1,
    );
    const owner = await readJson(app, "/api/preventure-research", session);
    assert.equal(owner.payload.current, null);
    assert.equal(owner.payload.history.items[0].lifecycle.status, "expired");
    assert.deepEqual(
      all(
        app.db,
        "SELECT DISTINCT status FROM tasks WHERE id IN (SELECT task_id FROM preventure_research_assignments)",
      ).map((row) => row.status),
      ["cancelled"],
    );
  } finally {
    await stopTestApp(app);
  }
});

test("owner activation enables the dedicated scheduler and calls only the next exact assignment", async () => {
  const descriptorHash = `sha256:${"b".repeat(64)}`;
  const requestBodyHash = `sha256:${"c".repeat(64)}`;
  const prepared = new Set();
  const calls = [];
  let dbRef = null;
  const app = await startTestApp("dedicated-scheduler", {
    preventureResearchRuntimeFactory: ({ db }) => {
      dbRef = db;
      return {
      readiness: (input = {}) => {
        if (!input.assignmentHash || !dbRef) {
          return { ready: false, blockers: [{ code: "assignment_required" }] };
        }
        const isPrepared = prepared.has(input.assignmentHash);
        return {
          ready: isPrepared,
          canPrepare: !isPrepared,
          credentialConfigured: true,
          egressReady: true,
          requestExact: true,
          artifactStoreReady: true,
          descriptorHash,
          requestBodyHash,
          blockers: [],
        };
      },
      prepareAssignment: async (input) => {
        prepared.add(input.expectedAssignmentHash);
        input.db.prepare(
          `UPDATE tasks SET status = 'queued', updated_at = ?
           WHERE id = (
             SELECT task_id FROM preventure_research_assignments
             WHERE assignment_hash = ?
           ) AND status = 'blocked'`,
        ).run(FIXED_TIME, input.expectedAssignmentHash);
        return { status: "prepared_test_only" };
      },
      runAssignment: async (input) => {
        calls.push(input);
        return { status: "callable_test_seam_no_provider" };
      },
      };
    },
  });
  try {
    const session = await createSession(app);
    await approveLifecycle(app, session, "approve");
    await approveLifecycle(app, session, "approve");
    assert.equal(
      get(
        app.db,
        "SELECT status FROM scheduler_jobs WHERE id = 'job-preventure-research'",
      ).status,
      "enabled",
    );
    const before = {
      attempts: Number(get(app.db, "SELECT COUNT(*) AS count FROM task_attempts").count),
      calls: Number(get(app.db, "SELECT COUNT(*) AS count FROM model_calls").count),
      costs: Number(get(app.db, "SELECT COUNT(*) AS count FROM costs").count),
    };
    const scheduled = await postJson(
      app,
      "/api/scheduler/jobs/job-preventure-research/run",
      {},
      session,
    );
    assert.equal(scheduled.response.status, 200);
    assert.equal(scheduled.payload.result.status, "completed");
    assert.equal(scheduled.payload.result.result.kind, "preventure_research");
    assert.equal(calls.length, 1);
    const firstAssignment = get(
      app.db,
      `SELECT assignment_id, assignment_hash
       FROM preventure_research_assignments WHERE assignment_id = ?`,
      [authority.assignments[0].id],
    );
    assert.equal(calls[0].assignmentId, firstAssignment.assignment_id);
    assert.equal(calls[0].expectedAssignmentHash, firstAssignment.assignment_hash);
    assert.deepEqual(
      {
        attempts: Number(get(app.db, "SELECT COUNT(*) AS count FROM task_attempts").count),
        calls: Number(get(app.db, "SELECT COUNT(*) AS count FROM model_calls").count),
        costs: Number(get(app.db, "SELECT COUNT(*) AS count FROM costs").count),
      },
      before,
    );
  } finally {
    await stopTestApp(app);
  }
});

test("server projects and revalidates the exact deterministic finalization control", async () => {
  const hashes = {
    evidenceSetHash: `sha256:${"1".repeat(64)}`,
    receiptSetHash: `sha256:${"2".repeat(64)}`,
    resultingReadinessHash: `sha256:${"3".repeat(64)}`,
  };
  const calls = [];
  const app = await startTestApp("finalization-control", {
    preventureResearchRuntime: {
      describeFinalization: () => ({
        ready: true,
        authorityHash: authority.authorityHash,
        ...hashes,
        outcome: "research_more",
        blockers: [],
      }),
      finalizeDecision: async (input) => {
        calls.push(input);
        return { created: false, status: "described_test_only" };
      },
    },
  });
  try {
    const session = await createSession(app);
    await approveLifecycle(app, session, "approve");
    await approveLifecycle(app, session, "approve");
    const system = await readJson(app, "/api/system", session);
    assert.equal(system.response.status, 200);
    assert.deepEqual(
      system.payload.preventureResearchRuntime.finalizationControl,
      {
        ready: true,
        authorityHash: authority.authorityHash,
        ...hashes,
        outcome: "research_more",
        blockers: [],
        message: "The retained evidence is ready for a deterministic diligence decision.",
      },
    );

    const stale = await postJson(
      app,
      "/api/preventure-research/finalize",
      {
        authorityHash: authority.authorityHash,
        ...hashes,
        receiptSetHash: `sha256:${"4".repeat(64)}`,
      },
      session,
    );
    assert.equal(stale.response.status, 409);
    assert.equal(stale.payload.code, "preventure_research_decision_scope_stale");
    assert.equal(calls.length, 0);

    const exact = await postJson(
      app,
      "/api/preventure-research/finalize",
      { authorityHash: authority.authorityHash, ...hashes },
      session,
    );
    assert.equal(exact.response.status, 200);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].expectedEvidenceSetHash, hashes.evidenceSetHash);
    assert.equal(calls[0].expectedReceiptSetHash, hashes.receiptSetHash);
    assert.equal(
      calls[0].expectedResultingReadinessHash,
      hashes.resultingReadinessHash,
    );

    const active = await readJson(app, "/api/preventure-research", session);
    const revoked = await postJson(
      app,
      "/api/preventure-research/revoke",
      {
        authorityHash: authority.authorityHash,
        expectedLatestEventHash: active.payload.current.lifecycle.latestEventHash,
        confirm: "REVOKE PREVENTURE RESEARCH",
        note: "Owner closed the bounded round after testing the summary control.",
      },
      session,
    );
    assert.equal(revoked.response.status, 200);
    const closedSystem = await readJson(app, "/api/system", session);
    assert.equal(
      closedSystem.payload.preventureResearchRuntime.finalizationControl.ready,
      false,
    );
    assert.match(
      closedSystem.payload.preventureResearchRuntime.finalizationControl.message,
      /already closed/i,
    );
  } finally {
    await stopTestApp(app);
  }
});

test("owner revocation wins over retained output and closes normal evidence reprocessing", async () => {
  const descriptorHash = `sha256:${"6".repeat(64)}`;
  const requestBodyHash = `sha256:${"7".repeat(64)}`;
  const retainedOutputHash = `sha256:${"8".repeat(64)}`;
  const calls = [];
  let recoveryPending = true;
  const app = await startTestApp("reprocess-control", {
    preventureResearchRuntime: {
      readiness: () => ({
        ready: false,
        canReprocess: recoveryPending,
        descriptorHash,
        requestBodyHash,
        retainedOutputHash: recoveryPending ? retainedOutputHash : null,
        status: "known_provider_result_needs_reprocess",
        blockers: [],
      }),
      reprocessAssignment: async (input) => {
        calls.push(input);
        recoveryPending = false;
        return { status: "reprocessed_test_only" };
      },
    },
  });
  try {
    const session = await createSession(app);
    await approveLifecycle(app, session, "approve");
    await approveLifecycle(app, session, "approve");
    const system = await readJson(app, "/api/system", session);
    const work = system.payload.queue.find(
      (item) => item.execution_kind === "preventure_research",
    );
    assert.ok(work);
    assert.equal(work.can_reprocess, true);
    assert.equal(work.descriptor_hash, descriptorHash);
    assert.equal(work.retained_output_hash, retainedOutputHash);

    const ownerState = await readJson(app, "/api/preventure-research", session);
    const revoke = await postJson(
      app,
      "/api/preventure-research/revoke",
      {
        authorityHash: authority.authorityHash,
        expectedLatestEventHash: ownerState.payload.current.lifecycle.latestEventHash,
        confirm: "REVOKE PREVENTURE RESEARCH",
      },
      session,
    );
    assert.equal(revoke.response.status, 200);
    assert.equal(revoke.payload.result.state.state, "revoked");
    assert.deepEqual({
      sources: Number(get(
        app.db,
        "SELECT COUNT(*) AS count FROM preventure_research_source_snapshots",
      ).count),
      evidence: Number(get(
        app.db,
        "SELECT COUNT(*) AS count FROM preventure_research_evidence_records",
      ).count),
      decisions: Number(get(
        app.db,
        "SELECT COUNT(*) AS count FROM preventure_research_decisions",
      ).count),
      completed: Number(get(
        app.db,
        "SELECT COUNT(*) AS count FROM preventure_research_lifecycle_events WHERE event_type = 'completed'",
      ).count),
    }, {
      sources: 0,
      evidence: 0,
      decisions: 0,
      completed: 0,
    });
    assert.equal(
      get(app.db, "SELECT status FROM scheduler_jobs WHERE id = 'job-preventure-research'").status,
      "disabled",
    );

    const exactBody = {
      authorityHash: authority.authorityHash,
      assignmentHash: work.assignment_hash,
      descriptorHash,
      retainedOutputHash,
    };
    const terminalReprocess = await postJson(
      app,
      `/api/preventure-research/assignments/${encodeURIComponent(work.assignment_id)}/reprocess`,
      exactBody,
      session,
    );
    assert.equal(terminalReprocess.response.status, 409);
    assert.equal(
      terminalReprocess.payload.code,
      "preventure_research_terminal_custody_required",
    );
    assert.equal(calls.length, 0);
  } finally {
    await stopTestApp(app);
  }
});

test("the protected local custody control is terminal-only, exact, and replay-safe", async () => {
  const descriptorHash = `sha256:${"9".repeat(64)}`;
  const requestBodyHash = `sha256:${"a".repeat(64)}`;
  const retainedOutputHash = `sha256:${"b".repeat(64)}`;
  const calls = [];
  let recorded = false;
  const app = await startTestApp("terminal-custody-control", {
    preventureResearchRuntime: {
      readiness: () => ({
        ready: false,
        canReprocess: false,
        canRecoverCustody: !recorded,
        descriptorHash,
        requestBodyHash,
        retainedOutputHash,
        status: recorded
          ? "terminal_retained_output_custody_recorded"
          : "terminal_retained_output_pending_accounting",
        blockers: [],
      }),
      recoverTerminalRetainedOutput: async (input) => {
        calls.push(input);
        const created = !recorded;
        recorded = true;
        return {
          status: "terminal_provider_artifact_retained_pending_reconciliation",
          created,
          terminalState: "revoked",
          accountingState: "pending_reconciliation",
          additionalAiCostAudCents: 0,
          retryAuthorized: false,
        };
      },
    },
  });
  try {
    const session = await createSession(app);
    await approveLifecycle(app, session, "approve");
    await approveLifecycle(app, session, "approve");
    const terminalAt = get(app.db, "SELECT pantheon_current_time() AS value").value;
    const store = createPreventureResearchStore(app.db, {
      clock: () => terminalAt,
      authorityRegistry: historicalV1TestRegistry,
    });
    const assignment = store.listAssignments(authority.authorityHash)[0];
    const body = {
      authorityHash: authority.authorityHash,
      assignmentHash: assignment.assignmentHash,
      descriptorHash,
      retainedOutputHash,
    };
    const activeAttempt = await postJson(
      app,
      `/api/preventure-research/assignments/${encodeURIComponent(assignment.id)}/recover-custody`,
      body,
      session,
    );
    assert.equal(activeAttempt.response.status, 409);
    assert.equal(
      activeAttempt.payload.code,
      "preventure_research_terminal_custody_not_terminal",
    );
    assert.equal(calls.length, 0);

    const latest = store.loadLifecycle(authority.authorityHash).at(-1);
    terminatePreventureResearchAuthority(store, authority.authorityHash, "revoked", {
      expectedLatestEventHash: latest.eventHash,
      occurredAt: terminalAt,
      actor: "owner",
      reason: "Owner ended the bounded round before local custody accounting.",
    });
    const widened = await postJson(
      app,
      `/api/preventure-research/assignments/${encodeURIComponent(assignment.id)}/recover-custody`,
      { ...body, retry: true },
      session,
    );
    assert.equal(widened.response.status, 400);
    assert.equal(widened.payload.code, "preventure_research_request_scope_changed");
    assert.equal(calls.length, 0);

    const first = await postJson(
      app,
      `/api/preventure-research/assignments/${encodeURIComponent(assignment.id)}/recover-custody`,
      body,
      session,
    );
    assert.equal(first.response.status, 200, JSON.stringify(first.payload));
    assert.equal(first.payload.result.created, true);
    assert.equal(first.payload.result.additionalAiCostAudCents, 0);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].expectedAssignmentHash, assignment.assignmentHash);
    assert.equal(calls[0].expectedDescriptorHash, descriptorHash);
    assert.equal(calls[0].retainedOutputHash, retainedOutputHash);
    assert.equal(
      get(app.db, "SELECT status FROM scheduler_jobs WHERE id = 'job-preventure-research'").status,
      "disabled",
    );

    const replay = await postJson(
      app,
      `/api/preventure-research/assignments/${encodeURIComponent(assignment.id)}/recover-custody`,
      body,
      session,
    );
    assert.equal(replay.response.status, 200, JSON.stringify(replay.payload));
    assert.equal(replay.payload.result.created, false);
    assert.equal(calls.length, 2);
    assert.equal(Number(get(
      app.db,
      `SELECT COUNT(*) AS count FROM events
       WHERE type = 'preventure_research.terminal_artifact_custody_recorded'`,
    ).count), 1);
    assert.deepEqual({
      sources: Number(get(
        app.db,
        "SELECT COUNT(*) AS count FROM preventure_research_source_snapshots",
      ).count),
      evidence: Number(get(
        app.db,
        "SELECT COUNT(*) AS count FROM preventure_research_evidence_records",
      ).count),
      decisions: Number(get(
        app.db,
        "SELECT COUNT(*) AS count FROM preventure_research_decisions",
      ).count),
      completed: Number(get(
        app.db,
        "SELECT COUNT(*) AS count FROM preventure_research_lifecycle_events WHERE event_type = 'completed'",
      ).count),
    }, { sources: 0, evidence: 0, decisions: 0, completed: 0 });
  } finally {
    await stopTestApp(app);
  }
});
