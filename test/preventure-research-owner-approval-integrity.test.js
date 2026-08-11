"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const v1Authority = require("../config/preventure-research-authority-smm-scope-guard-v1");
const { get, openDatabase, seedDatabase } = require("../src/db");
const { sha256 } = require("../src/runtime/commercial-test-contract");
const { createApp } = require("../src/server");
const {
  PREVENTURE_RESEARCH_APPROVAL_SCOPE_V2_SCHEMA,
  PREVENTURE_RESEARCH_AUTHORITY_V2_SCHEMA,
  RENEWAL_ADMISSIBLE_PREDECESSOR_EVENTS,
  createPreventureLifecycleEvent,
} = require("../src/runtime/preventure-research-contract");
const { getDecisionsState } = require("../src/runtime/cockpit-state");
const {
  bindAuthenticatedOwnerSessionAttestationIssuer,
  createLocalSecurity,
} = require("../src/runtime/local-security");
const {
  decidePreventureLifecycleApproval,
} = require("../src/runtime/preventure-research-lifecycle-decision");
const {
  createPreventureResearchStore,
} = require("../src/runtime/preventure-research-store");
const {
  EXPIRED_V2_ACTIVE_TEST_TIME,
  expiredNonDispatchV2Authority,
  expiredNonDispatchV2Registry,
  readinessSpec,
} = require("./support/preventure-research-v2-test-fixture");
const ACCEPT_NOTE = "Owner accepted the exact expired test-only v2 scope.";
const ACTIVATE_NOTE = "Owner activated only the exact expired test-only v2 scope.";

async function startV2App(options = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "pantheon-v2-owner-integrity-"));
  const dbPath = path.join(directory, "runtime.sqlite");
  const clock = () => EXPIRED_V2_ACTIVE_TEST_TIME;
  const db = openDatabase(dbPath, { clock });
  seedDatabase(db, { includeDemoProof: false });
  const historicalStore = createPreventureResearchStore(db, {
    clock: () => "2026-08-03T00:30:00.000Z",
    authorityRegistry: expiredNonDispatchV2Registry,
  });
  historicalStore.registerAuthority(v1Authority, readinessSpec);
  historicalStore.appendLifecycle(v1Authority.authorityHash, {
    id: "expired_v2_test_predecessor_proposed",
    eventType: "proposed",
    occurredAt: "2026-08-02T03:00:00.000Z",
    actor: "jarvis",
    reason: "Test-only predecessor history for version-two owner-integrity proof.",
    metadata: {},
  });
  if (options.terminatePredecessor !== false) {
    historicalStore.appendLifecycle(v1Authority.authorityHash, {
      id: "expired_v2_test_predecessor_revoked",
      eventType: "revoked",
      occurredAt: "2026-08-03T00:30:00.000Z",
      actor: "owner",
      reason: "Test-only predecessor closed before the expired version-two fixture.",
      metadata: {},
    });
  }
  const bootstrapSecret = "pantheon-expired-v2-owner-integrity";
  const app = createApp({
    db,
    dbPath,
    schedulerEnabled: false,
    security: true,
    sessionSecret: Buffer.alloc(32, 91),
    bootstrapSecret,
    initializePreventureResearch: true,
    preventureResearchClock: clock,
    preventureResearchAuthorityRegistry: expiredNonDispatchV2Registry,
    preventureResearchRuntime: {},
    preventureResearchArtifactRoot: path.join(directory, "artifacts"),
  });
  await new Promise((resolve, reject) => {
    app.server.once("error", reject);
    app.server.listen(0, "127.0.0.1", resolve);
  });
  return {
    ...app,
    bootstrapSecret,
    directory,
    origin: `http://127.0.0.1:${app.server.address().port}`,
  };
}

async function stopV2App(app) {
  for (const client of app.wss.clients) client.terminate();
  await new Promise((resolve) => app.server.close(resolve));
  app.wss.close();
  if (app.db.isOpen) app.db.close();
  fs.rmSync(app.directory, { recursive: true, force: true });
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

function issueAttestationFromSecurityInstance(security, bootstrapSecret, input) {
  const origin = "http://127.0.0.1:5051";
  let cookie = "";
  const request = {
    method: "POST",
    url: "/api/session",
    headers: {
      host: "127.0.0.1:5051",
      origin,
      "content-type": "application/json",
      "x-pantheon-bootstrap": bootstrapSecret,
    },
  };
  const response = {
    setHeader(name, value) {
      if (String(name).toLowerCase() === "set-cookie") {
        cookie = String(value).split(";", 1)[0];
      }
    },
  };
  const session = security.createSession(request, response);
  request.url = `/api/preventure-research/lifecycle-decisions/${encodeURIComponent(input.approvalId)}/${input.decision}`;
  request.headers.cookie = cookie;
  request.headers["x-pantheon-csrf"] = session.csrfToken;
  return security.issueAuthenticatedOwnerSessionAttestation(request, session, {
    approvalId: input.approvalId,
    decidedAt: input.decidedAt,
    decision: input.decision,
    decisionNoteHash: sha256(input.note),
    expectedScopeHash: input.expectedScopeHash,
  });
}

async function ownerState(app, session) {
  const response = await fetch(`${app.origin}/api/preventure-research`, {
    headers: { cookie: session.cookie },
  });
  const payload = await response.json();
  assert.equal(response.status, 200, JSON.stringify(payload));
  return payload;
}

async function decide(app, session, approval, decision, note) {
  const response = await fetch(
    `${app.origin}/api/preventure-research/lifecycle-decisions/${encodeURIComponent(approval.id)}/${decision}`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: session.cookie,
        origin: app.origin,
        "x-pantheon-csrf": session.csrfToken,
      },
      body: JSON.stringify({ scopeHash: approval.scopeHash, note }),
    },
  );
  const payload = await response.json();
  assert.equal(response.status, 200, JSON.stringify(payload));
  return payload;
}

function assertDirectUpdateRejected(db, approvalId) {
  assert.throws(
    () => db.prepare(
      `UPDATE approvals
       SET status = 'approved', decided_at = ?, decided_by = 'owner'
       WHERE id = ?`,
    ).run(EXPIRED_V2_ACTIVE_TEST_TIME, approvalId),
    /owner approval decision identity|attestation/i,
  );
  assert.equal(get(db, "SELECT status FROM approvals WHERE id = ?", [approvalId]).status, "pending");
}

function assertForgedReceiptRejected(db, approval) {
  const scope = JSON.parse(approval.scope);
  const noteHash = sha256("forged v2 direct writer");
  const body = {
    schema: "pantheon.preventure-research-approval-decision.v2",
    approvalId: approval.id,
    authorityHash: scope.authority.hash,
    eventType: scope.eventType,
    scopeHash: approval.scope_hash,
    priorPending: {
      status: "pending",
      requestedBy: approval.requested_by,
      requestedAt: approval.requested_at,
      decidedAt: null,
      decidedBy: null,
      consumedAt: null,
    },
    decisionStatus: "approved",
    decidedBy: "owner",
    decisionSource: "authenticated_owner_session_attestation",
    decisionNoteHash: noteHash,
    decidedAt: EXPIRED_V2_ACTIVE_TEST_TIME,
  };
  const receipt = { ...body, receiptHash: sha256(body) };
  assert.throws(
    () => db.prepare(
      `INSERT INTO preventure_research_approval_decisions
       (decision_receipt_hash, approval_id, authority_hash, event_type, scope_hash,
        requested_by, requested_at, decided_by, decision_source,
        decision_status, decided_at, receipt_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      receipt.receiptHash,
      receipt.approvalId,
      receipt.authorityHash,
      receipt.eventType,
      receipt.scopeHash,
      receipt.priorPending.requestedBy,
      receipt.priorPending.requestedAt,
      receipt.decidedBy,
      receipt.decisionSource,
      receipt.decisionStatus,
      receipt.decidedAt,
      JSON.stringify(receipt),
      receipt.decidedAt,
    ),
    /authenticated local owner-session attestation/i,
  );
}

function candidateRowCounts(db) {
  const authorityHash = expiredNonDispatchV2Authority.authorityHash;
  return {
    lifecycle: Number(get(
      db,
      "SELECT COUNT(*) AS count FROM preventure_research_lifecycle_events WHERE authority_hash = ?",
      [authorityHash],
    ).count),
    approvals: Number(get(
      db,
      `SELECT COUNT(*) AS count FROM approvals
       WHERE json_extract(scope, '$.authority.hash') = ?`,
      [authorityHash],
    ).count),
    receipts: Number(get(
      db,
      `SELECT COUNT(*) AS count FROM preventure_research_approval_decisions
       WHERE authority_hash = ?`,
      [authorityHash],
    ).count),
    assignments: Number(get(
      db,
      `SELECT COUNT(*) AS count FROM preventure_research_assignments
       WHERE authority_hash = ?`,
      [authorityHash],
    ).count),
  };
}

test("a v2 candidate stays withheld and every transition rejects a nonterminal predecessor", async () => {
  assert.deepEqual(RENEWAL_ADMISSIBLE_PREDECESSOR_EVENTS, [
    "completed",
    "revoked",
    "expired",
  ]);
  assert.equal(Object.isFrozen(RENEWAL_ADMISSIBLE_PREDECESSOR_EVENTS), true);
  const app = await startV2App({ terminatePredecessor: false });
  try {
    const renewalTriggerSql = get(
      app.db,
      `SELECT sql FROM sqlite_master
       WHERE type = 'trigger'
         AND name = 'trg_preventure_research_renewal_predecessor_terminal_insert'`,
    ).sql;
    const terminalClause = renewalTriggerSql.match(
      /predecessor_event\.event_type\s+IN\s*\(([^)]+)\)/i,
    );
    assert.ok(terminalClause, renewalTriggerSql);
    assert.deepEqual(
      [...terminalClause[1].matchAll(/'([^']+)'/g)].map((match) => match[1]),
      RENEWAL_ADMISSIBLE_PREDECESSOR_EVENTS,
    );
    const session = await createSession(app);
    const withheld = await ownerState(app, session);
    assert.equal(withheld.initialization.status, "withheld");
    assert.equal(withheld.initialization.reason, "candidate_predecessor_not_terminal");
    assert.equal(
      withheld.initialization.predecessorAuthorityHash,
      v1Authority.authorityHash,
    );
    assert.equal(withheld.current.authority.hash, v1Authority.authorityHash);
    assert.equal(withheld.current.lifecycle.status, "proposed");
    assert.equal(
      get(
        app.db,
        `SELECT COUNT(*) AS count FROM preventure_research_authorities
         WHERE authority_hash = ?`,
        [expiredNonDispatchV2Authority.authorityHash],
      ).count,
      0,
    );
    assert.deepEqual(candidateRowCounts(app.db), {
      lifecycle: 0,
      approvals: 0,
      receipts: 0,
      assignments: 0,
    });

    const store = createPreventureResearchStore(app.db, {
      clock: () => EXPIRED_V2_ACTIVE_TEST_TIME,
      authorityRegistry: expiredNonDispatchV2Registry,
    });
    store.registerAuthority(expiredNonDispatchV2Authority, readinessSpec);
    const before = candidateRowCounts(app.db);
    for (const eventType of ["proposed", "accepted", "activated"]) {
      assert.throws(
        () => store.appendLifecycle(expiredNonDispatchV2Authority.authorityHash, {
          id: `nonterminal_predecessor_${eventType}`,
          eventType,
          occurredAt: EXPIRED_V2_ACTIVE_TEST_TIME,
          actor: eventType === "proposed" ? "jarvis" : "owner",
          reason: `The ${eventType} transition must recheck its durable predecessor.`,
          metadata: {},
        }),
        (error) => {
          assert.equal(error.code, "preventure_research_predecessor_not_terminal");
          return true;
        },
      );
      assert.deepEqual(candidateRowCounts(app.db), before);
    }

    const forgedProposal = createPreventureLifecycleEvent(
      expiredNonDispatchV2Authority,
      [],
      {
        id: "direct_sql_nonterminal_predecessor_proposal",
        eventType: "proposed",
        occurredAt: EXPIRED_V2_ACTIVE_TEST_TIME,
        actor: "direct_writer",
        reason: "A direct writer must not bypass the durable predecessor gate.",
        metadata: {},
      },
    );
    assert.throws(
      () => app.db.prepare(
        `INSERT INTO preventure_research_lifecycle_events
         (id, authority_hash, sequence, previous_event_hash, event_type, event_hash,
          approval_id, approval_scope_hash, actor, reason, metadata, decision_hash,
          successor_authority_hash, event_json, occurred_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        forgedProposal.id,
        forgedProposal.authorityHash,
        forgedProposal.sequence,
        forgedProposal.previousEventHash,
        forgedProposal.eventType,
        forgedProposal.eventHash,
        forgedProposal.approvalId,
        forgedProposal.approvalScopeHash,
        forgedProposal.actor,
        forgedProposal.reason,
        JSON.stringify(forgedProposal.metadata),
        forgedProposal.metadata.decisionHash ?? null,
        forgedProposal.metadata.successorAuthorityHash ?? null,
        JSON.stringify(forgedProposal),
        forgedProposal.occurredAt,
        forgedProposal.occurredAt,
      ),
      /exact predecessor.*durably terminal|renewal authority requires/i,
    );
    assert.deepEqual(candidateRowCounts(app.db), before);
    assert.equal(store.readState(v1Authority.authorityHash).state, "proposed");
    assert.equal(
      store.readState(expiredNonDispatchV2Authority.authorityHash).state,
      "unregistered",
    );
    assert.equal(store.verifyLedger().ok, true);
  } finally {
    await stopV2App(app);
  }
});

test("expired test-only v2 accepts and activates only through an authenticated owner session", async () => {
  const app = await startV2App();
  try {
    const session = await createSession(app);
    const proposed = await ownerState(app, session);
    assert.ok(proposed.current, JSON.stringify(proposed));
    assert.equal(proposed.current.authority.hash, expiredNonDispatchV2Authority.authorityHash);
    assert.equal(proposed.current.lifecycle.status, "proposed");

    const acceptance = get(
      app.db,
      "SELECT * FROM approvals WHERE id = ?",
      [proposed.current.reviewDecision.id],
    );
    assert.equal(JSON.parse(acceptance.scope).schema, PREVENTURE_RESEARCH_APPROVAL_SCOPE_V2_SCHEMA);
    assert.equal(acceptance.venture_id, null);
    const acceptanceCard = getDecisionsState(app.db, {
      preventureResearchClock: () => EXPIRED_V2_ACTIVE_TEST_TIME,
      preventureResearchAuthorityRegistry: expiredNonDispatchV2Registry,
    }).approvals.find((item) => item.id === acceptance.id);
    assert.equal(acceptanceCard.decisionKind, "preventure_research_lifecycle");
    assert.match(acceptanceCard.title, /Accept this exact bounded research proposal/i);
    const invalidV2MarkerId = "invalid_v2_marker_must_not_become_generic_decision";
    app.db.prepare(
      `INSERT INTO approvals
       (id, workflow_id, scope, title, status, risk_level, requested_by, requested_at,
        decided_at, decision_note, payload, venture_id, task_id, scope_hash,
        expires_at, consumed_at, expected_effects, decided_by)
       SELECT ?, workflow_id, ?, 'Invalid test-only v2 marker', 'pending', risk_level,
              'jarvis', requested_at, NULL, NULL, '{}', venture_id, task_id, ?,
              expires_at, NULL, '[]', NULL
       FROM approvals WHERE id = ?`,
    ).run(
      invalidV2MarkerId,
      JSON.stringify({ schema: PREVENTURE_RESEARCH_APPROVAL_SCOPE_V2_SCHEMA }),
      sha256("invalid test-only v2 scope marker"),
      acceptance.id,
    );
    assert.equal(
      getDecisionsState(app.db, {
        preventureResearchClock: () => EXPIRED_V2_ACTIVE_TEST_TIME,
        preventureResearchAuthorityRegistry: expiredNonDispatchV2Registry,
      }).approvals.some((item) => item.id === invalidV2MarkerId),
      false,
    );
    app.db.prepare("DELETE FROM approvals WHERE id = ?").run(invalidV2MarkerId);
    const secondIssuerBootstrap = "pantheon-unbound-second-owner-issuer";
    const secondSecurity = createLocalSecurity({
      enabled: true,
      secret: Buffer.alloc(32, 92),
      bootstrapSecret: secondIssuerBootstrap,
    });
    assert.throws(
      () => bindAuthenticatedOwnerSessionAttestationIssuer(app.db, secondSecurity),
      /already bound to another Pantheon (?:owner-session issuer|local-security instance)/i,
    );
    const secondIssuerNote = "A second security instance cannot authorise this owner action.";
    const secondIssuerAttestation = issueAttestationFromSecurityInstance(
      secondSecurity,
      secondIssuerBootstrap,
      {
      approvalId: acceptance.id,
      decidedAt: EXPIRED_V2_ACTIVE_TEST_TIME,
      decision: "approve",
        note: secondIssuerNote,
      expectedScopeHash: acceptance.scope_hash,
      },
    );
    assert.throws(
      () => decidePreventureLifecycleApproval(
        app.db,
        acceptance.id,
        "approve",
        secondIssuerNote,
        {
          actor: "owner",
          decidedAt: EXPIRED_V2_ACTIVE_TEST_TIME,
          expectedScopeHash: acceptance.scope_hash,
          ownerSessionAttestation: secondIssuerAttestation,
          storeOptions: {
            clock: () => EXPIRED_V2_ACTIVE_TEST_TIME,
            authorityRegistry: expiredNonDispatchV2Registry,
          },
        },
      ),
      /attestation.*(?:missing|stale|reused)|bound to another decision/i,
    );
    assert.throws(
      () => decidePreventureLifecycleApproval(
        app.db,
        acceptance.id,
        "approve",
        secondIssuerNote,
        {
          actor: "owner",
          decidedAt: EXPIRED_V2_ACTIVE_TEST_TIME,
          expectedScopeHash: acceptance.scope_hash,
          ownerSessionAttestation: secondIssuerAttestation,
          storeOptions: {
            clock: () => EXPIRED_V2_ACTIVE_TEST_TIME,
            authorityRegistry: expiredNonDispatchV2Registry,
          },
        },
      ),
      /attestation.*(?:missing|stale|reused)|missing, stale, reused/i,
    );
    assert.equal(get(app.db, "SELECT status FROM approvals WHERE id = ?", [acceptance.id]).status, "pending");
    assert.equal(
      get(
        app.db,
        "SELECT COUNT(*) AS count FROM preventure_research_approval_decisions WHERE approval_id = ?",
        [acceptance.id],
      ).count,
      0,
    );
    assertDirectUpdateRejected(app.db, acceptance.id);
    assertForgedReceiptRejected(app.db, acceptance);
    await decide(app, session, proposed.current.reviewDecision, "approve", ACCEPT_NOTE);

    const accepted = await ownerState(app, session);
    assert.equal(accepted.current.lifecycle.status, "accepted");
    const activation = get(
      app.db,
      "SELECT * FROM approvals WHERE id = ?",
      [accepted.current.reviewDecision.id],
    );
    assert.equal(JSON.parse(activation.scope).schema, PREVENTURE_RESEARCH_APPROVAL_SCOPE_V2_SCHEMA);
    const activationCard = getDecisionsState(app.db, {
      preventureResearchClock: () => EXPIRED_V2_ACTIVE_TEST_TIME,
      preventureResearchAuthorityRegistry: expiredNonDispatchV2Registry,
    }).approvals.find((item) => item.id === activation.id);
    assert.equal(activationCard.decisionKind, "preventure_research_lifecycle");
    assert.match(activationCard.title, /Activate this exact internal diligence round/i);
    assertDirectUpdateRejected(app.db, activation.id);
    await decide(app, session, accepted.current.reviewDecision, "approve", ACTIVATE_NOTE);

    const activated = await ownerState(app, session);
    assert.equal(activated.current.lifecycle.status, "activated");
    assert.equal(activated.current.assignments.materialized, 3);
    const storedAuthority = get(
      app.db,
      `SELECT authority_schema, supersedes_authority_hash
       FROM preventure_research_authorities WHERE authority_hash = ?`,
      [expiredNonDispatchV2Authority.authorityHash],
    );
    assert.equal(storedAuthority.authority_schema, PREVENTURE_RESEARCH_AUTHORITY_V2_SCHEMA);
    assert.equal(
      storedAuthority.supersedes_authority_hash,
      expiredNonDispatchV2Authority.supersedesAuthorityHash,
    );
    assert.equal(
      get(
        app.db,
        `SELECT COUNT(*) AS count FROM preventure_research_approval_decisions
         WHERE authority_hash = ?
           AND decision_source = 'authenticated_owner_session_attestation'`,
        [expiredNonDispatchV2Authority.authorityHash],
      ).count,
      2,
    );
  } finally {
    await stopV2App(app);
  }
});
