"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const authority = require("../config/preventure-research-authority-smm-scope-guard-v1");
const readinessSpec = require(
  "../config/commercial-readiness-social-media-manager-scope-guard-v1",
);
const {
  openDatabase,
  verifyDatabase,
} = require("../src/db");
const { sha256 } = require("../src/runtime/commercial-test-contract");
const {
  preventureResearchApprovalScope,
  preventureResearchApprovalScopeHash,
} = require("../src/runtime/preventure-research-contract");
const {
  HISTORICAL_PREVENTURE_APPROVAL_AUTHORITY,
  HISTORICAL_PREVENTURE_APPROVAL_DECISION_RECEIPT_SCHEMA,
  HISTORICAL_PREVENTURE_APPROVAL_DECISION_SOURCE,
  HISTORICAL_PREVENTURE_APPROVAL_DECISIONS,
  HISTORICAL_PREVENTURE_SCHEMA27_SOURCE,
} = require(
  "../src/runtime/preventure-research-historical-approval-manifest",
);
const {
  createPreventureLifecycleApproval,
  decidePreventureLifecycleApproval,
} = require("../src/runtime/preventure-research-lifecycle-decision");
const {
  createPreventureResearchStore,
  verifyPreventureResearchLedger,
} = require("../src/runtime/preventure-research-store");
const {
  issueAuthenticatedOwnerSessionAttestationForTest,
} = require("./support/authenticated-owner-session-attestation");

const HISTORICAL_TIME = "2026-08-02T03:00:00.000Z";
const PROPOSED_TIME = "2026-08-02T02:59:00.000Z";

function temporaryRuntime(t, clock = () => HISTORICAL_TIME) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pantheon-historical-approval-"));
  const dbPath = path.join(root, "runtime.sqlite");
  const db = openDatabase(dbPath, { clock });
  t.after(() => {
    try {
      db.close();
    } catch {
      // A failing assertion may already have closed the disposable database.
    }
    fs.rmSync(root, { recursive: true, force: true });
  });
  return { db, dbPath, root };
}

function captureAndSuspendTriggers(db, triggerNames, action) {
  const triggers = triggerNames.map((name) => {
    const row = db.prepare(
      "SELECT name, sql FROM sqlite_master WHERE type = 'trigger' AND name = ?",
    ).get(name);
    assert.ok(row?.sql, `Missing disposable trigger ${name}`);
    return row;
  });
  for (const trigger of triggers) db.exec(`DROP TRIGGER ${trigger.name}`);
  try {
    return action();
  } finally {
    for (const trigger of triggers) db.exec(trigger.sql);
  }
}

function receiptFor(entry) {
  const body = {
    schema: entry.receiptSchema,
    approvalId: entry.approvalId,
    authorityHash: entry.authorityHash,
    eventType: entry.eventType,
    scopeHash: entry.scopeHash,
    priorPending: {
      status: "pending",
      requestedBy: entry.requestedBy,
      requestedAt: entry.requestedAt,
      decidedAt: null,
      decidedBy: null,
      consumedAt: null,
    },
    decisionStatus: entry.decisionStatus,
    decidedBy: entry.decidedBy,
    decisionSource: entry.decisionSource,
    decidedAt: entry.decidedAt,
  };
  assert.equal(sha256(body), entry.receiptHash);
  return { ...body, receiptHash: entry.receiptHash };
}

function insertPendingApproval(db, entry) {
  const scope = preventureResearchApprovalScope(authority, entry.eventType);
  const scopeHash = preventureResearchApprovalScopeHash(authority, entry.eventType);
  assert.equal(scopeHash, entry.scopeHash);
  const title = entry.eventType === "accepted"
    ? "Accept this exact bounded research authority?"
    : "Activate this exact bounded internal research round?";
  db.prepare(
    `INSERT INTO approvals
      (id, venture_id, workflow_id, task_id, scope, title, status, risk_level,
       requested_by, requested_at, payload, scope_hash, expires_at, expected_effects)
     VALUES (?, NULL, NULL, NULL, ?, ?, 'pending', 'high', ?, ?, ?, ?, ?, '[]')`,
  ).run(
    entry.approvalId,
    JSON.stringify(scope),
    title,
    entry.requestedBy,
    entry.requestedAt,
    JSON.stringify({
      preventureResearchApprovalScope: scope,
      preventureResearchApprovalScopeHash: scopeHash,
    }),
    scopeHash,
    HISTORICAL_PREVENTURE_APPROVAL_AUTHORITY.expiresAt,
  );
}

function insertHistoricalReceipt(db, entry) {
  const receipt = receiptFor(entry);
  db.prepare(
    `INSERT INTO preventure_research_approval_decisions
     (decision_receipt_hash, approval_id, authority_hash, event_type, scope_hash,
      requested_by, requested_at, decided_by, decision_source,
      decision_status, decided_at, receipt_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    entry.receiptHash,
    entry.approvalId,
    entry.authorityHash,
    entry.eventType,
    entry.scopeHash,
    entry.requestedBy,
    entry.requestedAt,
    entry.decidedBy,
    entry.decisionSource,
    entry.decisionStatus,
    entry.decidedAt,
    JSON.stringify(receipt),
    entry.createdAt,
  );
}

function registerHistoricalAuthority(db) {
  const store = createPreventureResearchStore(db, { clock: () => HISTORICAL_TIME });
  store.registerAuthority(authority, readinessSpec);
  store.appendLifecycle(authority.authorityHash, {
    id: "preventure_historical_compatibility_proposed",
    eventType: "proposed",
    occurredAt: PROPOSED_TIME,
    actor: "jarvis",
    reason: "Retain the exact bounded historical authority.",
    metadata: {},
  });
  return store;
}

function seedExactHistoricalApprovalPair(db) {
  const store = registerHistoricalAuthority(db);
  for (const entry of HISTORICAL_PREVENTURE_APPROVAL_DECISIONS) {
    insertPendingApproval(db, entry);
  }
  captureAndSuspendTriggers(
    db,
    [
      "trg_preventure_research_approval_decision_update",
      "trg_preventure_research_approval_attestation_insert",
    ],
    () => {
      for (const entry of HISTORICAL_PREVENTURE_APPROVAL_DECISIONS) {
        db.prepare(
          `UPDATE approvals
           SET status = ?, decided_at = ?, decided_by = ?
           WHERE id = ? AND status = 'pending'`,
        ).run(
          entry.decisionStatus,
          entry.decidedAt,
          entry.decidedBy,
          entry.approvalId,
        );
        insertHistoricalReceipt(db, entry);
      }
    },
  );
  captureAndSuspendTriggers(
    db,
    ["trg_preventure_research_lifecycle_approval_insert"],
    () => {
      for (const entry of HISTORICAL_PREVENTURE_APPROVAL_DECISIONS) {
        store.appendLifecycle(authority.authorityHash, {
          id: `preventure_historical_compatibility_${entry.eventType}`,
          eventType: entry.eventType,
          approvalId: entry.approvalId,
          approvalScope: preventureResearchApprovalScope(authority, entry.eventType),
          occurredAt: entry.decidedAt,
          actor: "owner",
          reason: `Retain the exact historical ${entry.eventType} decision.`,
          metadata: {},
        });
      }
    },
  );
  return store;
}

test("the historical manifest is deeply frozen and pins only the exact expired pair", () => {
  assert.equal(Object.isFrozen(HISTORICAL_PREVENTURE_APPROVAL_AUTHORITY), true);
  assert.equal(Object.isFrozen(HISTORICAL_PREVENTURE_APPROVAL_DECISIONS), true);
  assert.equal(Object.isFrozen(HISTORICAL_PREVENTURE_SCHEMA27_SOURCE), true);
  assert.equal(
    Object.isFrozen(HISTORICAL_PREVENTURE_SCHEMA27_SOURCE.namespaceRowCounts),
    true,
  );
  assert.equal(
    Object.isFrozen(HISTORICAL_PREVENTURE_SCHEMA27_SOURCE.namespaceLogicalRowSha256),
    true,
  );
  assert.equal(HISTORICAL_PREVENTURE_APPROVAL_DECISIONS.length, 2);
  assert.deepEqual(
    HISTORICAL_PREVENTURE_APPROVAL_DECISIONS.map((entry) => entry.eventType),
    ["accepted", "activated"],
  );
  assert.ok(
    HISTORICAL_PREVENTURE_APPROVAL_DECISIONS.every((entry) => (
      Object.isFrozen(entry)
      && entry.authorityHash === authority.authorityHash
      && entry.receiptSchema === HISTORICAL_PREVENTURE_APPROVAL_DECISION_RECEIPT_SCHEMA
      && entry.decisionSource === HISTORICAL_PREVENTURE_APPROVAL_DECISION_SOURCE
      && entry.decidedAt === HISTORICAL_TIME
    )),
  );
  assert.ok(Date.parse(HISTORICAL_PREVENTURE_APPROVAL_AUTHORITY.expiresAt) < Date.now());
});

test("only the complete pinned v1 pair is readable as historical evidence", (t) => {
  const { db } = temporaryRuntime(t);
  const store = seedExactHistoricalApprovalPair(db);
  const lifecycle = store.loadLifecycle(authority.authorityHash);
  assert.deepEqual(
    lifecycle.map((event) => event.eventType),
    ["proposed", "accepted", "activated"],
  );
  assert.equal(store.readState(authority.authorityHash).state, "activated");
  assert.equal(verifyPreventureResearchLedger(db).ok, true);
  assert.deepEqual(verifyDatabase(db), {
    quickCheck: "ok",
    foreignKeyFailures: 0,
    schemaVersion: 27,
  });
});

test("a partial historical receipt set fails closed", (t) => {
  const { db } = temporaryRuntime(t);
  const store = seedExactHistoricalApprovalPair(db);
  captureAndSuspendTriggers(
    db,
    ["trg_preventure_research_approval_decisions_immutable_delete"],
    () => db.prepare(
      "DELETE FROM preventure_research_approval_decisions WHERE decision_receipt_hash = ?",
    ).run(HISTORICAL_PREVENTURE_APPROVAL_DECISIONS[1].receiptHash),
  );
  assert.throws(
    () => store.loadLifecycle(authority.authorityHash),
    /not the exact complete pinned pair/i,
  );
});

test("a hash-invalid mutation of a pinned v1 body is not readable", (t) => {
  const { db } = temporaryRuntime(t);
  const store = seedExactHistoricalApprovalPair(db);
  const accepted = HISTORICAL_PREVENTURE_APPROVAL_DECISIONS[0];
  const receipt = receiptFor(accepted);
  receipt.unrecordedClaim = "A legacy source label cannot gain stronger meaning.";
  captureAndSuspendTriggers(
    db,
    ["trg_preventure_research_approval_decisions_immutable_update"],
    () => db.prepare(
      `UPDATE preventure_research_approval_decisions
       SET receipt_json = ? WHERE decision_receipt_hash = ?`,
    ).run(JSON.stringify(receipt), accepted.receiptHash),
  );
  assert.throws(
    () => store.loadLifecycle(authority.authorityHash),
    /changed from its exact pinned record/i,
  );
});

test("post-migration SQL cannot insert even one exact historical v1 receipt", (t) => {
  const { db } = temporaryRuntime(t);
  registerHistoricalAuthority(db);
  const entry = HISTORICAL_PREVENTURE_APPROVAL_DECISIONS[0];
  insertPendingApproval(db, entry);
  assert.throws(
    () => insertHistoricalReceipt(db, entry),
    /authenticated local owner-session attestation/i,
  );
  assert.equal(
    db.prepare(
      "SELECT COUNT(*) AS count FROM preventure_research_approval_decisions",
    ).get().count,
    0,
  );
});

test("the table CHECK refuses any third legacy receipt even without the insert guard", (t) => {
  const { db } = temporaryRuntime(t);
  registerHistoricalAuthority(db);
  const template = HISTORICAL_PREVENTURE_APPROVAL_DECISIONS[0];
  const third = {
    ...template,
    approvalId: "approval_preventure_unpinned_legacy_third",
  };
  const thirdReceipt = receiptFor({
    ...third,
    receiptHash: sha256({
      schema: third.receiptSchema,
      approvalId: third.approvalId,
      authorityHash: third.authorityHash,
      eventType: third.eventType,
      scopeHash: third.scopeHash,
      priorPending: {
        status: "pending",
        requestedBy: third.requestedBy,
        requestedAt: third.requestedAt,
        decidedAt: null,
        decidedBy: null,
        consumedAt: null,
      },
      decisionStatus: third.decisionStatus,
      decidedBy: third.decidedBy,
      decisionSource: third.decisionSource,
      decidedAt: third.decidedAt,
    }),
  });
  db.prepare(
    `INSERT INTO approvals
     (id, scope, title, status, risk_level, requested_by, requested_at,
      payload, scope_hash, expected_effects)
     VALUES (?, 'historical-third-probe', 'Historical third probe', 'pending',
             'high', 'jarvis', ?, '{}', ?, '[]')`,
  ).run(third.approvalId, third.requestedAt, third.scopeHash);
  captureAndSuspendTriggers(
    db,
    ["trg_preventure_research_approval_attestation_insert"],
    () => assert.throws(
      () => db.prepare(
        `INSERT INTO preventure_research_approval_decisions
         (decision_receipt_hash, approval_id, authority_hash, event_type, scope_hash,
          requested_by, requested_at, decided_by, decision_source,
          decision_status, decided_at, receipt_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        thirdReceipt.receiptHash,
        third.approvalId,
        third.authorityHash,
        third.eventType,
        third.scopeHash,
        third.requestedBy,
        third.requestedAt,
        third.decidedBy,
        third.decisionSource,
        third.decisionStatus,
        third.decidedAt,
        JSON.stringify(thirdReceipt),
        third.createdAt,
      ),
      /CHECK constraint failed/i,
    ),
  );
});

test("the authenticated v2 owner route remains the only live approval route", (t) => {
  const { db } = temporaryRuntime(t);
  const store = registerHistoricalAuthority(db);
  const pending = createPreventureLifecycleApproval(
    db,
    authority.authorityHash,
    "accepted",
    {
      approvalId: "approval_authenticated_v2_route_unchanged",
      requestedAt: "2026-08-02T02:59:30.000Z",
      storeOptions: { clock: () => HISTORICAL_TIME },
    },
  );
  const note = "The current owner route remains issuer-bound and v2.";
  const attestation = issueAuthenticatedOwnerSessionAttestationForTest({
    db,
    approvalId: pending.approval.id,
    decidedAt: HISTORICAL_TIME,
    decision: "approve",
    note,
    expectedScopeHash: pending.scopeHash,
  });
  const result = decidePreventureLifecycleApproval(
    db,
    pending.approval.id,
    "approve",
    note,
    {
      actor: "owner",
      decidedAt: HISTORICAL_TIME,
      expectedScopeHash: pending.scopeHash,
      ownerSessionAttestation: attestation,
      storeOptions: { clock: () => HISTORICAL_TIME },
    },
  );
  assert.equal(result.changed, true);
  const row = db.prepare(
    `SELECT decision_source, receipt_json
     FROM preventure_research_approval_decisions WHERE approval_id = ?`,
  ).get(pending.approval.id);
  const receipt = JSON.parse(row.receipt_json);
  assert.equal(row.decision_source, "authenticated_owner_session_attestation");
  assert.equal(receipt.schema, "pantheon.preventure-research-approval-decision.v2");
  assert.match(receipt.decisionNoteHash, /^sha256:[a-f0-9]{64}$/);
  assert.equal(store.loadLifecycle(authority.authorityHash).at(-1).eventType, "accepted");
});
