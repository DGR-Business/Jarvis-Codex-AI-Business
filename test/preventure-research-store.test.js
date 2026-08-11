"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { DatabaseSync } = require("node:sqlite");

const authority = require("../config/preventure-research-authority-smm-scope-guard-v1");
const readinessSpec = require("../config/commercial-readiness-social-media-manager-scope-guard-v1");
const {
  LATEST_SCHEMA_VERSION,
  openDatabase,
  verifyDatabase,
} = require("../src/db");
const {
  REQUIRED_READINESS_GATE_IDS,
  preventureResearchApprovalScope,
  preventureResearchApprovalScopeHash,
} = require("../src/runtime/preventure-research-contract");
const {
  bindModelCallToAttempt,
  finalizeAgentExecutionReceipt,
} = require("../src/runtime/agent-execution-evidence");
const {
  createAgentRun,
  ensureAiTeam,
  finishAgentRun,
} = require("../src/runtime/ai-team");
const { sha256 } = require("../src/runtime/commercial-test-contract");
const {
  derivePreventureResearchPublicSourceBinding,
} = require("../src/runtime/preventure-research-source-identity");
const {
  createPreventureResearchStore,
  verifyPreventureResearchLedger,
} = require("../src/runtime/preventure-research-store");
const {
  createPreventureLifecycleApproval,
  decidePreventureLifecycleApproval,
} = require("../src/runtime/preventure-research-lifecycle-decision");
const {
  downgradeDatabaseToReleasedSchema24,
  downgradeDatabaseToLegacySchema25,
  downgradeDatabaseToLastReleasedSchema26,
} = require("./support/released-schema-24-fixture");
const {
  historicalV1TestRegistry,
} = require("./support/preventure-research-test-registry");
const {
  issueAuthenticatedOwnerSessionAttestationForTest,
} = require("./support/authenticated-owner-session-attestation");

const STORE_TIME = "2026-08-02T12:30:00+10:00";
const DECISION_STORE_TIME = "2026-08-02T13:40:00+10:00";

function historicalStoreOptions(clock = () => STORE_TIME) {
  return { clock, authorityRegistry: historicalV1TestRegistry };
}

function tempRuntime() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pantheon-preventure-store-"));
  const dbPath = path.join(dir, "runtime.sqlite");
  const db = openDatabase(dbPath, { clock: () => DECISION_STORE_TIME });
  return {
    dir,
    dbPath,
    db,
    close() {
      try { db.close(); } catch {}
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

function createWorkflowAndTasks(db) {
  const createdAt = "2026-08-02T12:00:00+10:00";
  db.prepare(
    `INSERT INTO workflows
     (id, type, title, status, current_step, priority, metadata, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    "workflow_preventure_store_test",
    "preventure_research",
    "Bounded pre-venture research",
    "planned",
    "awaiting authority",
    1,
    "{}",
    createdAt,
    createdAt,
  );
  for (const template of authority.assignments) {
    db.prepare(
      `INSERT INTO tasks
       (id, workflow_id, title, kind, agent, status, priority, payload, result, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      `task_preventure_${template.id}`,
      "workflow_preventure_store_test",
      template.title,
      "preventure_research",
      "researcher",
      "queued",
      1,
      "{}",
      "{}",
      createdAt,
      createdAt,
    );
  }
}

function activate(store, db) {
  store.registerAuthority(authority, readinessSpec);
  store.appendLifecycle(authority.authorityHash, {
    id: "preventure_event_proposed",
    eventType: "proposed",
    occurredAt: "2026-08-02T12:00:30+10:00",
    actor: "jarvis",
    reason: "Bounded diligence proposed for owner control.",
    metadata: {},
  });
  const accepted = createPreventureLifecycleApproval(
    db,
    authority.authorityHash,
    "accepted",
    {
      approvalId: "approval_preventure_accept",
      requestedAt: "2026-08-02T12:01:00+10:00",
      storeOptions: historicalStoreOptions(),
    },
  );
  const acceptanceNote = "Owner accepted the exact bounded preparation scope.";
  decidePreventureLifecycleApproval(
    db,
    accepted.approval.id,
    "approve",
    acceptanceNote,
    {
      actor: "owner",
      expectedScopeHash: accepted.scopeHash,
      decidedAt: "2026-08-02T12:02:00+10:00",
      ownerSessionAttestation: issueAuthenticatedOwnerSessionAttestationForTest({
        db,
        approvalId: accepted.approval.id,
        decidedAt: "2026-08-02T12:02:00+10:00",
        decision: "approve",
        note: acceptanceNote,
        expectedScopeHash: accepted.scopeHash,
      }),
      storeOptions: historicalStoreOptions(),
    },
  );
  const activated = createPreventureLifecycleApproval(
    db,
    authority.authorityHash,
    "activated",
    {
      approvalId: "approval_preventure_activate",
      requestedAt: "2026-08-02T12:02:30+10:00",
      storeOptions: historicalStoreOptions(),
    },
  );
  const activationNote = "Owner activated the exact bounded preparation scope.";
  decidePreventureLifecycleApproval(
    db,
    activated.approval.id,
    "approve",
    activationNote,
    {
      actor: "owner",
      expectedScopeHash: activated.scopeHash,
      decidedAt: "2026-08-02T12:03:00+10:00",
      ownerSessionAttestation: issueAuthenticatedOwnerSessionAttestationForTest({
        db,
        approvalId: activated.approval.id,
        decidedAt: "2026-08-02T12:03:00+10:00",
        decision: "approve",
        note: activationNote,
        expectedScopeHash: activated.scopeHash,
      }),
      storeOptions: historicalStoreOptions(),
    },
  );
  return store.loadLifecycle(authority.authorityHash).at(-1);
}

function materializeAll(store, activation, db) {
  db.prepare("UPDATE workflows SET status = ?, metadata = ? WHERE id = ?").run(
    "blocked",
    JSON.stringify({
      schema: "pantheon.preventure-research-workflow.v1",
      authorityHash: authority.authorityHash,
      activationEventHash: activation.eventHash,
      assignmentPlanHash: sha256("store test exact assignment plan"),
      preparationOnly: true,
      externalEffects: [],
      externalCommercialSpendCapAudCents: 0,
      buildAuthorized: false,
      commercialTestAuthorized: false,
      externalActionAuthorized: false,
    }),
    "workflow_preventure_store_test",
  );
  for (const template of authority.assignments) {
    db.prepare(
      `UPDATE tasks
       SET agent = 'demand_validator', status = 'blocked', priority = 1,
           max_retries = 0, approval_id = NULL, cost_budget_cents = ?,
           due_at = ?, payload = ?
       WHERE id = ?`,
    ).run(
      template.maxCostAudCents,
      authority.expiresAt,
      JSON.stringify({
        schema: "pantheon.preventure-research-task-envelope.v1",
        authorityHash: authority.authorityHash,
        activationEventHash: activation.eventHash,
        assignmentId: template.id,
        assignmentVersion: template.version,
        templateHash: sha256(template),
        provider: template.provider,
        model: template.model,
        method: "openai_responses_web_search",
        tool: "web_search",
        limits: {
          maxCostAudCents: template.maxCostAudCents,
          maxAttempts: template.maxAttempts,
          maxToolCalls: template.maxToolCalls,
          maximumModelPasses: template.maximumModelPasses,
          maxInputTokens: template.maxInputTokens,
          localPromptPreflightMaxInputTokens: template.localPromptPreflightMaxInputTokens,
          maxOutputTokens: template.maxOutputTokens,
          maxTurns: template.maxTurns,
          deadlineMs: template.deadlineMs,
          worstCaseExposure: template.worstCaseExposure,
        },
        expiresAt: authority.expiresAt,
        preparationOnly: true,
        externalEffects: [],
        externalCommercialSpendCapAudCents: 0,
        buildAuthorized: false,
        commercialTestAuthorized: false,
        externalActionAuthorized: false,
      }),
      `task_preventure_${template.id}`,
    );
  }
  return authority.assignments.map((template) => store.createAssignment(
    authority.authorityHash,
    template.id,
    {
      workflowId: "workflow_preventure_store_test",
      taskId: `task_preventure_${template.id}`,
      activationEventHash: activation.eventHash,
      assignedAt: "2026-08-02T12:04:00+10:00",
    },
  ).assignment);
}

function insertTerminalReceipt(db, assignment, index) {
  const attemptId = `attempt_preventure_terminal_${index}`;
  const modelCallId = `model_call_preventure_terminal_${index}`;
  const researchRunId = `research_run_preventure_terminal_${index}`;
  const sourceRecordId = `research_source_preventure_terminal_${index}`;
  const provenanceId = `provenance_preventure_terminal_${index}`;
  const providerRequestId = `provider_request_preventure_${index}`;
  const providerResponseId = `resp_preventure_terminal_${index}`;
  const clientRequestId = `preventure_client_request_${index}`;
  const sourceUrl = index === 2
    ? "https://www.etsy.com/legal/fees/"
    : index === 3
      ? "https://gumroad.com/help/article/66-gumroads-fees"
      : `https://www.etsy.com/listing/${1000 + index}/scope-kit-${index}?ref=fixture`;
  const sourceTitle = `Retained public source ${index}`;
  const sourcePublisher = "Public source fixture";
  const sourceIdentity = derivePreventureResearchPublicSourceBinding(sourceUrl);
  const sourceRetrievedAt = `2026-08-02T12:${10 + index}:45+10:00`;
  const sourceContentHash = sha256(`public source ${index}`);
  const sourceContentLocation = `C:\\tmp\\preventure-source-${index}.json#source=${sourceRecordId}`;
  const sourceLimitations = ["Grounded provider metadata does not retain independent page content."];
  db.prepare(
    `INSERT INTO task_attempts
     (id, task_id, workflow_id, claim_token, status, outcome_status,
      started_at, metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    attemptId,
    assignment.taskId,
    assignment.workflowId,
    `claim_preventure_terminal_${index}`,
    "running",
    "not_started",
    `2026-08-02T12:${10 + index}:00+10:00`,
    JSON.stringify({ clientRequestId }),
  );
  ensureAiTeam(db);
  const definition = db.prepare("SELECT * FROM agent_definitions WHERE id = 'demand_validator'").get();
  const task = db.prepare("SELECT * FROM tasks WHERE id = ?").get(assignment.taskId);
  const run = createAgentRun(db, definition, task, {
    attemptId,
    mode: "preventure-research",
    inputSummary: `Exact assignment ${assignment.id}`,
  });
  db.prepare(
    `INSERT INTO model_calls
     (id, workflow_id, task_id, venture_id, provider, model_class, selected_model,
      mode, status, input_tokens, output_tokens, estimated_cost_cents,
      actual_cost_cents, approval_required, metadata, created_at,
      provider_request_id, cost_status, incurred_estimate_cents,
      reconciled_cost_cents, outcome_status, completed_at)
     VALUES (?, ?, ?, NULL, ?, 'flagship', ?, 'live', 'completed',
             100, 50, 10, 10, 0, ?, ?, ?, 'reconciled', 10, 10, 'known', ?)`,
  ).run(
    modelCallId,
    assignment.workflowId,
    assignment.taskId,
    assignment.provider,
    assignment.model,
    JSON.stringify({
      tokenUsage: {
        status: "reported",
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
      },
      providerResponseId,
      clientRequestId,
    }),
    `2026-08-02T12:${10 + index}:30+10:00`,
    providerRequestId,
    `2026-08-02T12:${11 + index}:00+10:00`,
  );
  bindModelCallToAttempt(db, attemptId, modelCallId);
  db.prepare(
    `INSERT INTO research_runs
     (id, workflow_id, task_id, venture_id, query, provider, mode, status,
      budget_cents, actual_cents, summary, metadata, created_at, completed_at)
     VALUES (?, ?, ?, NULL, ?, ?, 'live', 'completed', ?, 10, ?, ?, ?, ?)`,
  ).run(
    researchRunId,
    assignment.workflowId,
    assignment.taskId,
    `Exact bounded public-source question for ${assignment.id}`,
    assignment.provider,
    assignment.maxCostAudCents,
    `Retained public-source result for ${assignment.id}`,
    JSON.stringify({ attemptId, modelCallId }),
    `2026-08-02T12:${10 + index}:30+10:00`,
    `2026-08-02T12:${11 + index}:00+10:00`,
  );
  db.prepare(
    `INSERT INTO research_sources
     (id, run_id, title, url, publisher, published_at, retrieved_at,
      relevance, confidence, metadata)
     VALUES (?, ?, ?, ?, ?, NULL, ?, ?, 'provider_grounded', ?)`,
  ).run(
    sourceRecordId,
    researchRunId,
    sourceTitle,
    sourceUrl,
    sourcePublisher,
    sourceRetrievedAt,
    "Grounded source retained for the exact assignment.",
    JSON.stringify({
      providerGrounded: true,
      directArtifactCaptured: false,
      contentHash: sourceContentHash,
      contentLocation: sourceContentLocation,
      limitations: sourceLimitations,
      ...sourceIdentity,
    }),
  );
  db.prepare(
    `INSERT INTO agent_run_provenance
     (id, fingerprint, run_id, attempt_id, task_id, model_call_id,
      research_run_id, research_source_id, kind, title, url, grounding_type,
      output_hash, metadata, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'web_source', ?, ?, ?, ?, '{}', ?)`,
  ).run(
    provenanceId,
    sha256({ assignmentHash: assignment.assignmentHash, sourceRecordId }),
    run.id,
    attemptId,
    assignment.taskId,
    modelCallId,
    researchRunId,
    sourceRecordId,
    sourceTitle,
    sourceUrl,
    "web_search_action_source",
    sourceContentHash,
    sourceRetrievedAt,
  );
  const additionalSources = [];
  if (assignment.id === "comparator_and_buyer_evidence") {
    for (let offerIndex = 2; offerIndex <= 10; offerIndex += 1) {
      const additionalSourceRecordId = `${sourceRecordId}_${offerIndex}`;
      const additionalProvenanceId = `${provenanceId}_${offerIndex}`;
      const additionalUrl = offerIndex % 2 === 0
        ? `https://gumroad.com/l/scopeKit${offerIndex}?ref=fixture`
        : `https://www.etsy.com/listing/${1000 + offerIndex}/scope-kit-${offerIndex}?ref=fixture`;
      const additionalTitle = `Retained marketplace offer ${offerIndex}`;
      const additionalPublisher = offerIndex % 2 === 0 ? "Gumroad" : "Etsy";
      const additionalContentHash = sha256(`public marketplace source ${offerIndex}`);
      const additionalContentLocation = `C:\\tmp\\preventure-source-${index}-${offerIndex}.json#source=${additionalSourceRecordId}`;
      const additionalIdentity = derivePreventureResearchPublicSourceBinding(additionalUrl);
      db.prepare(
        `INSERT INTO research_sources
         (id, run_id, title, url, publisher, published_at, retrieved_at,
          relevance, confidence, metadata)
         VALUES (?, ?, ?, ?, ?, NULL, ?, ?, 'provider_grounded', ?)`,
      ).run(
        additionalSourceRecordId,
        researchRunId,
        additionalTitle,
        additionalUrl,
        additionalPublisher,
        sourceRetrievedAt,
        "Grounded marketplace offer retained for exact comparator coverage.",
        JSON.stringify({
          providerGrounded: true,
          directArtifactCaptured: false,
          contentHash: additionalContentHash,
          contentLocation: additionalContentLocation,
          limitations: sourceLimitations,
          ...additionalIdentity,
        }),
      );
      db.prepare(
        `INSERT INTO agent_run_provenance
         (id, fingerprint, run_id, attempt_id, task_id, model_call_id,
          research_run_id, research_source_id, kind, title, url, grounding_type,
          output_hash, metadata, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'web_source', ?, ?, ?, ?, '{}', ?)`,
      ).run(
        additionalProvenanceId,
        sha256({ assignmentHash: assignment.assignmentHash, additionalSourceRecordId }),
        run.id,
        attemptId,
        assignment.taskId,
        modelCallId,
        researchRunId,
        additionalSourceRecordId,
        additionalTitle,
        additionalUrl,
        "web_search_action_source",
        additionalContentHash,
        sourceRetrievedAt,
      );
      additionalSources.push({
        sourceRecordId: additionalSourceRecordId,
        provenanceId: additionalProvenanceId,
        sourceUrl: additionalUrl,
        sourceTitle: additionalTitle,
        sourcePublisher: additionalPublisher,
        sourceRetrievedAt,
        sourceContentHash: additionalContentHash,
        sourceContentLocation: additionalContentLocation,
        sourceLimitations,
        sourceIdentity: additionalIdentity,
      });
    }
  }
  db.prepare(
    `UPDATE task_attempts
     SET status = 'completed', outcome_status = 'known', provider_request_id = ?,
         provider_dispatched_at = ?, provider_dispatch_model_call_id = ?, completed_at = ?
     WHERE id = ?`,
  ).run(
    providerRequestId,
    `2026-08-02T12:${10 + index}:30+10:00`,
    modelCallId,
    `2026-08-02T12:${11 + index}:00+10:00`,
    attemptId,
  );
  db.prepare(
    `UPDATE tasks
     SET status = 'completed', outcome_status = 'known', result = ?,
         completed_at = ?, updated_at = ?
     WHERE id = ?`,
  ).run(
    JSON.stringify({
      providerRequestId,
      providerResponseId,
      clientRequestId,
    }),
    `2026-08-02T12:${11 + index}:00+10:00`,
    `2026-08-02T12:${11 + index}:00+10:00`,
    assignment.taskId,
  );
  finishAgentRun(db, run.id, {
    status: "completed",
    outputSummary: `Exact retained assignment ${assignment.id} result`,
    modelCallId,
    estimatedCostCents: 10,
    actualCostCents: 10,
    evalStatus: "passed",
    metadata: { assignmentHash: assignment.assignmentHash },
  });
  db.prepare(
    `INSERT INTO agent_eval_results
     (id, run_id, agent_id, task_id, attempt_id, status, score,
      criteria, findings, metadata, evaluator_version, subject_hash, created_at)
     VALUES (?, ?, 'demand_validator', ?, ?, 'passed', 100,
             '[]', '[]', '{}', 'preventure-test-v1', ?, ?)`,
  ).run(
    `agent_eval_preventure_terminal_${index}`,
    run.id,
    assignment.taskId,
    attemptId,
    sha256({ assignmentHash: assignment.assignmentHash, attemptId }),
    `2026-08-02T12:${11 + index}:30+10:00`,
  );
  const receipt = finalizeAgentExecutionReceipt(db, { attemptId, runId: run.id });
  assert.equal(receipt.status, "complete");
  return {
    attemptId,
    receiptId: receipt.id,
    modelCallId,
    providerRequestId,
    providerResponseId,
    clientRequestId,
    researchRunId,
    runId: run.id,
    sourceRecordId,
    provenanceId,
    sourceUrl,
    sourceTitle,
    sourcePublisher,
    sourceRetrievedAt,
    sourceContentHash,
    sourceContentLocation,
    sourceLimitations,
    sourceIdentity,
    additionalSources,
  };
}

function decisionInput(overrides = {}) {
  return {
    id: "decision_smm_scope_guard_store_v2",
    version: "2026.08.02-store-v2",
    outcome: "research_more",
    completionMode: "full_round",
    earlyStopRecordHash: null,
    skippedAssignmentRecordHashes: [],
    nextEvidenceAction: null,
    decidedAt: "2026-08-02T13:30:00+10:00",
    summary: "The retained read-only evidence supports further bounded work but does not prove exact-offer willingness to pay.",
    buyer: "Freelance social-media managers with retained clients",
    problem: "Fragmented approvals, revision control, scope impacts, and delivery evidence",
    offer: "A no-subscription operational-control kit with no legal-contract positioning",
    channel: "No commercial channel selected; retaining cash remains explicit",
    priceOrMargin: "A$19, A$29, and A$39 remain planning cases",
    evidenceStandard: "Retained public sources, exact provider receipts, contrary evidence, and no sales inference",
    nextMoneyMove: "Retain cash until the smallest justified next authority is separately approved",
    reviseOrStopCriteria: ["Stop if no economical path can resolve the exact-offer demand gap."],
    formatCases: [
      { id: "notion_client_portal", disposition: "revise" },
      { id: "scripts_evidence_log_micro_kit", disposition: "retain" },
      { id: "spreadsheet_documents_no_login", disposition: "retain" },
    ],
    channelCases: [
      { id: "etsy", state: "conditional_unverified" },
      { id: "evidence_supported_lawful_alternative", state: "research_more" },
      { id: "gumroad", state: "not_selected" },
      { id: "retain_cash", state: "available" },
    ],
    economicsCases: [
      ...["etsy", "gumroad"].flatMap((channelId) => [1900, 2900, 3900].map((priceAudCents) => ({
        channelId,
        priceAudCents,
        state: "estimated",
        estimatedNetCashContributionAudCents: priceAudCents - 500,
        unknownCosts: [],
        evidenceRefs: [`economics_evidence_${channelId}_${priceAudCents}`],
      }))),
      ...[1900, 2900, 3900].map((priceAudCents) => ({
        channelId: "evidence_supported_lawful_alternative",
        priceAudCents,
        state: "unknown",
        estimatedNetCashContributionAudCents: null,
        unknownCosts: ["channel_fee_unknown"],
        evidenceRefs: [`economics_evidence_evidence_supported_lawful_alternative_${priceAudCents}`],
      })),
      ...[1900, 2900, 3900].map((priceAudCents) => ({
        channelId: "retain_cash",
        priceAudCents,
        state: "known_zero",
        estimatedNetCashContributionAudCents: 0,
        unknownCosts: [],
        evidenceRefs: [`economics_evidence_retain_cash_${priceAudCents}`],
      })),
    ],
    materialContradictions: [],
    readinessGates: REQUIRED_READINESS_GATE_IDS.map((id) => ({
      id,
      required: true,
      status: id === "direct_demand" ? "unresolved" : "supported",
    })),
    limitations: ["Read-only diligence cannot prove exact-offer paid demand."],
    ...overrides,
  };
}

function evidenceDetails(overrides = {}) {
  return {
    buyerEvidence: null,
    comparator: null,
    formatCase: null,
    channelCase: null,
    economicsCase: null,
    readinessGate: null,
    recommendation: null,
    ...overrides,
  };
}

test("schema 27 installs and verifies the exact append-only research ledger", () => {
  const runtime = tempRuntime();
  try {
    const version = runtime.db.prepare(
      "SELECT MAX(version) AS version FROM schema_migrations",
    ).get().version;
    assert.equal(version, LATEST_SCHEMA_VERSION);
    for (const table of [
      "preventure_research_authorities",
      "preventure_research_approval_decisions",
      "preventure_research_lifecycle_events",
      "preventure_research_assignments",
      "preventure_research_cost_events",
      "preventure_research_terminal_stops",
      "preventure_research_assignment_skips",
      "preventure_research_source_snapshots",
      "preventure_research_evidence_records",
      "preventure_research_decisions",
    ]) {
      assert.ok(runtime.db.prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
      ).get(table));
    }
    assert.ok(runtime.db.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_task_attempts_one_running_per_task'",
    ).get());
    assert.ok(runtime.db.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'trigger' AND name = 'trg_preventure_research_decision_admission_insert'",
    ).get());
    assert.deepEqual(verifyDatabase(runtime.db), {
      quickCheck: "ok",
      foreignKeyFailures: 0,
      schemaVersion: 27,
    });
    assert.deepEqual(verifyPreventureResearchLedger(runtime.db), {
      ok: true,
      authorities: 0,
      approvalDecisions: 0,
      lifecycleEvents: 0,
      assignments: 0,
      costEvents: 0,
      ownerBillingObservations: 0,
      terminalRecoveries: 0,
      terminalStops: 0,
      assignmentSkips: 0,
      sourceSnapshots: 0,
      evidenceRecords: 0,
      decisions: 0,
    });
  } finally {
    runtime.close();
  }
});

test("schema 27 atomically upgrades the supported released schema 24, 25, and 26 contracts", async (t) => {
  const downgrade = new Map([
    [24, downgradeDatabaseToReleasedSchema24],
    [25, downgradeDatabaseToLegacySchema25],
    [26, downgradeDatabaseToLastReleasedSchema26],
  ]);
  for (const priorVersion of [24, 25, 26]) {
    await t.test(`schema ${priorVersion} to 27`, () => {
      const runtime = tempRuntime();
      runtime.db.close();
      downgrade.get(priorVersion)(runtime.dbPath);
      const db = openDatabase(runtime.dbPath, { clock: () => DECISION_STORE_TIME });
      assert.equal(db.prepare("SELECT MAX(version) AS version FROM schema_migrations").get().version, 27);
      assert.equal(verifyDatabase(db).schemaVersion, 27);
      db.close();
      fs.rmSync(runtime.dir, { recursive: true, force: true });
    });
  }
});

test("only an authenticated owner-session attestation can establish lifecycle authority", () => {
  const runtime = tempRuntime();
  try {
    const store = createPreventureResearchStore(runtime.db, historicalStoreOptions());
    store.registerAuthority(authority, readinessSpec);
    store.appendLifecycle(authority.authorityHash, {
      id: "preventure_authenticity_proposed",
      eventType: "proposed",
      occurredAt: "2026-08-02T12:00:30+10:00",
      actor: "jarvis",
      reason: "Authenticity probe proposed the exact bounded authority.",
      metadata: {},
    });
    runtime.db.prepare(
      `INSERT INTO ventures
       (id, name, stage, status, summary, metadata, created_at, updated_at, is_active)
       VALUES ('venture_approval_contamination', 'Approval contamination probe', 1,
               'active', '', '{}', ?, ?, 1)`,
    ).run("2026-08-02T12:00:31+10:00", "2026-08-02T12:00:31+10:00");
    const scope = preventureResearchApprovalScope(authority, "accepted");
    const scopeHash = preventureResearchApprovalScopeHash(authority, "accepted");
    assert.throws(
      () => runtime.db.prepare(
        `INSERT INTO approvals
         (id, venture_id, workflow_id, task_id, scope, title, status, risk_level,
          requested_by, requested_at, decided_at, decided_by, payload, scope_hash,
          expires_at, expected_effects)
         VALUES ('approval_direct_forgery', NULL, NULL, NULL, ?, ?, 'approved',
                 'high', 'jarvis', ?, ?, 'owner', ?, ?, ?, '[]')`,
      ).run(
        JSON.stringify(scope),
        "Accept this exact bounded research authority?",
        "2026-08-02T12:01:00+10:00",
        "2026-08-02T12:02:00+10:00",
        JSON.stringify({
          preventureResearchApprovalScope: scope,
          preventureResearchApprovalScopeHash: scopeHash,
        }),
        scopeHash,
        authority.expiresAt,
      ),
      /pending decision path/i,
    );
    const pending = createPreventureLifecycleApproval(
      runtime.db,
      authority.authorityHash,
      "accepted",
      {
        approvalId: "approval_missing_decision_receipt",
        requestedAt: "2026-08-02T12:01:00+10:00",
        storeOptions: historicalStoreOptions(),
      },
    );
    assert.equal(pending.approval.venture_id, null);
    assert.equal(pending.approval.workflow_id, null);
    assert.equal(pending.approval.task_id, null);
    assert.throws(
      () => runtime.db.prepare(
        `UPDATE approvals
         SET status = 'approved', decided_at = ?, decided_by = 'owner'
         WHERE id = ?`,
      ).run("2026-08-02T12:02:00+10:00", pending.approval.id),
      /owner approval decision identity|attestation/i,
    );
    const forgedReceiptBody = {
      schema: "pantheon.preventure-research-approval-decision.v2",
      approvalId: pending.approval.id,
      authorityHash: authority.authorityHash,
      eventType: "accepted",
      scopeHash,
      priorPending: {
        status: "pending",
        requestedBy: "jarvis",
        requestedAt: pending.approval.requested_at,
        decidedAt: null,
        decidedBy: null,
        consumedAt: null,
      },
      decisionStatus: "approved",
      decidedBy: "owner",
      decisionSource: "authenticated_owner_session_attestation",
      decisionNoteHash: sha256("forged direct database writer"),
      decidedAt: "2026-08-02T12:02:00+10:00",
    };
    const forgedReceipt = {
      ...forgedReceiptBody,
      receiptHash: sha256(forgedReceiptBody),
    };
    assert.throws(
      () => runtime.db.prepare(
        `INSERT INTO preventure_research_approval_decisions
         (decision_receipt_hash, approval_id, authority_hash, event_type, scope_hash,
          requested_by, requested_at, decided_by, decision_source,
          decision_status, decided_at, receipt_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        forgedReceipt.receiptHash,
        forgedReceipt.approvalId,
        forgedReceipt.authorityHash,
        forgedReceipt.eventType,
        forgedReceipt.scopeHash,
        forgedReceipt.priorPending.requestedBy,
        forgedReceipt.priorPending.requestedAt,
        forgedReceipt.decidedBy,
        forgedReceipt.decisionSource,
        forgedReceipt.decisionStatus,
        forgedReceipt.decidedAt,
        JSON.stringify(forgedReceipt),
        forgedReceipt.decidedAt,
      ),
      /authenticated local owner-session attestation/i,
    );
    assert.throws(
      () => decidePreventureLifecycleApproval(
        runtime.db,
        pending.approval.id,
        "approve",
        "A source label alone must not be treated as owner approval.",
        {
          actor: "owner",
          expectedScopeHash: scopeHash,
          decidedAt: "2026-08-02T12:02:00+10:00",
          storeOptions: historicalStoreOptions(),
        },
      ),
      /authenticated owner-session attestation/i,
    );
    const singleUseNote = "One exact owner action cannot be reused after any failed attempt.";
    const singleUseAttestation = issueAuthenticatedOwnerSessionAttestationForTest({
      db: runtime.db,
      approvalId: pending.approval.id,
      decidedAt: "2026-08-02T12:02:00+10:00",
      decision: "approve",
      note: singleUseNote,
      expectedScopeHash: scopeHash,
    });
    assert.throws(
      () => decidePreventureLifecycleApproval(
        runtime.db,
        pending.approval.id,
        "approve",
        singleUseNote,
        {
          actor: "owner",
          expectedScopeHash: sha256("deliberately stale scope"),
          decidedAt: "2026-08-02T12:02:00+10:00",
          ownerSessionAttestation: singleUseAttestation,
          storeOptions: historicalStoreOptions(),
        },
      ),
      /attestation|bound to another decision/i,
    );
    assert.throws(
      () => decidePreventureLifecycleApproval(
        runtime.db,
        pending.approval.id,
        "approve",
        singleUseNote,
        {
          actor: "owner",
          expectedScopeHash: scopeHash,
          decidedAt: "2026-08-02T12:02:00+10:00",
          ownerSessionAttestation: singleUseAttestation,
          storeOptions: historicalStoreOptions(),
        },
      ),
      /attestation.*(?:missing|stale|reused)|missing, stale, reused/i,
    );
    assert.throws(
      () => store.appendLifecycle(authority.authorityHash, {
        id: "preventure_authenticity_forged_acceptance",
        eventType: "accepted",
        approvalId: pending.approval.id,
        approvalScope: scope,
        occurredAt: "2026-08-02T12:02:00+10:00",
        actor: "owner",
        reason: "This direct update lacks the immutable owner-decision receipt.",
        metadata: {},
      }),
      /owner-decision receipt|approval identity|approved Pantheon approval/i,
    );
    assert.equal(store.loadLifecycle(authority.authorityHash).at(-1).eventType, "proposed");
    assert.equal(runtime.db.prepare(
      "SELECT consumed_at FROM approvals WHERE id = ?",
    ).get(pending.approval.id).consumed_at, null);
  } finally {
    runtime.close();
  }
});

test("exact owner approvals activate authority and materialize only immutable assignments", () => {
  const runtime = tempRuntime();
  try {
    createWorkflowAndTasks(runtime.db);
    const store = createPreventureResearchStore(runtime.db, historicalStoreOptions());
    const activation = activate(store, runtime.db);
    const assignments = materializeAll(store, activation, runtime.db);
    assert.equal(runtime.db.prepare(
      "SELECT venture_id FROM workflows WHERE id = 'workflow_preventure_store_test'",
    ).get().venture_id, null);
    assert.ok(runtime.db.prepare(
      "SELECT COUNT(*) AS count FROM tasks WHERE kind = 'preventure_research' AND venture_id IS NULL",
    ).get().count === 3);
    assert.equal(assignments.length, 3);
    assert.equal(assignments.reduce((sum, item) => sum + item.maxCostAudCents, 0), 150);
    assert.equal(assignments[0].maxInputTokens, 272000);
    assert.equal(assignments[0].localPromptPreflightMaxInputTokens, 30000);
    assert.equal(assignments[0].maxOutputTokens, 12000);
    assert.equal(assignments[0].maxToolCalls, 2);
    assert.equal(assignments[0].maximumModelPasses, 3);
    assert.equal(assignments[0].worstCaseExposure.amountAudCents, 50);
    assert.equal(assignments[0].maxTurns, 1);
    assert.equal(store.readState(authority.authorityHash).dispatchAllowed, true);
    assert.equal(store.verifyLedger().assignments, 3);
    assert.throws(
      () => store.withAtomicEvidenceBatch((batch) => {
        const source = batch.recordSourceSnapshot(assignments[0].assignmentHash, {
          id: "rolled_back_source",
          version: "v1",
          sourceClass: authority.assignments[0].requiredSourceClasses[0],
          sourceTier: 1,
          captureStatus: "unavailable",
          limitations: ["The source was deliberately unavailable for rollback proof."],
          retrievedAt: "2026-08-02T12:09:00+10:00",
        }).sourceSnapshot;
        batch.recordEvidence(assignments[0].assignmentHash, {
          id: "rolled_back_evidence",
          version: "v1",
          sourceSnapshotHash: source.snapshotHash,
          truthClass: "observed_fact",
          polarity: "neutral",
          questionId: "outside_exact_authority",
          claim: "This invalid record must roll back the full batch.",
          confidence: "unknown",
          limitations: ["This invalid fixture must never be retained."],
          capturedAt: "2026-08-02T12:09:01+10:00",
        });
      }),
      /approved research question/i,
    );
    assert.equal(runtime.db.prepare(
      "SELECT COUNT(*) AS count FROM preventure_research_source_snapshots",
    ).get().count, 0);
    assert.equal(runtime.db.prepare(
      "SELECT COUNT(*) AS count FROM preventure_research_evidence_records",
    ).get().count, 0);
    runtime.db.prepare(
      `INSERT INTO ventures
       (id, name, stage, status, summary, metadata, created_at, updated_at, is_active)
       VALUES ('venture_event_ownership_fixture', 'Ownership fixture', 1, 'active',
               '', '{}', ?, ?, 1)`,
    ).run("2026-08-02T12:03:30+10:00", "2026-08-02T12:03:30+10:00");
    const preventureEvent = runtime.db.prepare(
      `INSERT INTO events
       (ts, level, actor, type, entity_type, entity_id, message, metadata)
       VALUES (?, 'info', 'pantheon', 'preventure_research.activated',
               'preventure_research_authority', ?, ?, '{}')`,
    ).run(
      "2026-08-02T12:04:00+10:00",
      authority.authorityHash,
      "Bounded pre-venture authority activated.",
    );
    assert.equal(runtime.db.prepare(
      "SELECT venture_id FROM events WHERE id = ?",
    ).get(preventureEvent.lastInsertRowid).venture_id, null);
    const ordinaryEvent = runtime.db.prepare(
      `INSERT INTO events
       (ts, level, actor, type, entity_type, entity_id, message, metadata)
       VALUES (?, 'info', 'pantheon', 'runtime.test', 'runtime', 'pantheon', ?, '{}')`,
    ).run("2026-08-02T12:04:01+10:00", "Ordinary runtime event.");
    assert.ok(runtime.db.prepare(
      "SELECT venture_id FROM events WHERE id = ?",
    ).get(ordinaryEvent.lastInsertRowid).venture_id);
    const activeVentureId = runtime.db.prepare(
      "SELECT id FROM ventures WHERE is_active = 1 ORDER BY created_at LIMIT 1",
    ).get().id;
    assert.throws(
      () => runtime.db.prepare(
        `INSERT INTO events
         (ts, level, actor, type, entity_type, entity_id, message, metadata, venture_id)
         VALUES (?, 'info', 'pantheon', 'preventure_research.activated',
                 'preventure_research_authority', ?, ?, '{}', ?)`,
      ).run(
        "2026-08-02T12:04:02+10:00",
        authority.authorityHash,
        "Invalid venture-owned pre-venture event.",
        activeVentureId,
      ),
      /outside venture ownership/i,
    );
    const payload = JSON.parse(runtime.db.prepare(
      "SELECT payload FROM tasks WHERE id = ?",
    ).get(assignments[0].taskId).payload);
    assert.equal(payload.preventureResearchAssignment.assignmentHash, assignments[0].assignmentHash);
    assert.throws(
      () => store.appendLifecycle(authority.authorityHash, {
        id: "invented_completion",
        eventType: "completed",
        occurredAt: "2026-08-02T12:10:00+10:00",
        actor: "pantheon",
        reason: "Invented completion must not be accepted.",
        metadata: {
          decisionHash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        },
      }),
      /atomically/i,
    );
    runtime.db.prepare(
      `INSERT INTO task_attempts
       (id, task_id, workflow_id, claim_token, status, outcome_status, started_at, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      "attempt_preventure_one",
      assignments[0].taskId,
      assignments[0].workflowId,
      "claim_preventure_one",
      "running",
      "not_started",
      "2026-08-02T12:05:00+10:00",
      "{}",
    );
    assert.equal(runtime.db.prepare(
      "SELECT venture_id FROM task_attempts WHERE id = 'attempt_preventure_one'",
    ).get().venture_id, null);
    assert.throws(
      () => runtime.db.prepare(
        `INSERT INTO task_attempts
         (id, task_id, workflow_id, claim_token, status, outcome_status, started_at, metadata)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        "attempt_preventure_two",
        assignments[0].taskId,
        assignments[0].workflowId,
        "claim_preventure_two",
        "running",
        "not_started",
        "2026-08-02T12:06:00+10:00",
        "{}",
      ),
      /one provider attempt/i,
    );
    const firstCost = store.appendCostEvent(assignments[1].assignmentHash, {
      costKey: "bounded_cost_key_one",
      eventType: "estimated",
      amountAudCents: 40,
      exposureAudCents: 40,
      occurredAt: "2026-08-02T12:07:00+10:00",
    });
    const replayedCost = store.appendCostEvent(assignments[1].assignmentHash, {
      costKey: "bounded_cost_key_one",
      eventType: "estimated",
      amountAudCents: 40,
      exposureAudCents: 40,
      occurredAt: "2026-08-02T12:07:00+10:00",
    });
    assert.equal(firstCost.created, true);
    assert.equal(replayedCost.created, false);
    assert.equal(replayedCost.costEvent.receiptHash, firstCost.costEvent.receiptHash);
    assert.throws(
      () => store.appendCostEvent(assignments[1].assignmentHash, {
        costKey: "bounded_cost_key_two",
        eventType: "estimated",
        amountAudCents: 30,
        exposureAudCents: 30,
        occurredAt: "2026-08-02T12:08:00+10:00",
      }),
      /assignment.*cap|cost.*cap/i,
    );
  } finally {
    runtime.close();
  }
});

test("authority evidence savepoints see a final receipt inside the caller transaction and roll back cleanly", () => {
  const runtime = tempRuntime();
  let outerTransactionOpen = false;
  try {
    createWorkflowAndTasks(runtime.db);
    const store = createPreventureResearchStore(runtime.db, historicalStoreOptions());
    const activation = activate(store, runtime.db);
    const assignments = materializeAll(store, activation, runtime.db);
    const assignment = assignments[0];
    runtime.db.exec("BEGIN IMMEDIATE");
    outerTransactionOpen = true;
    const execution = insertTerminalReceipt(runtime.db, assignment, 8);
    assert.throws(
      () => store.withAtomicEvidenceBatch((batch) => {
        const source = batch.recordSourceSnapshot(assignment.assignmentHash, {
          id: "outer_transaction_source",
          version: "v1",
          sourceClass: "public_marketplace_listing_or_result_observation",
          sourceTier: 1,
          captureStatus: "partial",
          url: execution.sourceUrl,
          title: execution.sourceTitle,
          publisher: execution.sourcePublisher,
          contentHash: execution.sourceContentHash,
          contentLocation: execution.sourceContentLocation,
          researchRunId: execution.researchRunId,
          sourceRecordId: execution.sourceRecordId,
          provenanceId: execution.provenanceId,
          agentRunReceiptId: execution.receiptId,
          limitations: execution.sourceLimitations,
          retrievedAt: execution.sourceRetrievedAt,
        }).sourceSnapshot;
        batch.recordEvidence(assignment.assignmentHash, {
          id: "outer_transaction_invalid_evidence",
          version: "v1",
          sourceSnapshotHash: source.snapshotHash,
          truthClass: "model_inference",
          polarity: "neutral",
          questionId: "outside_exact_authority",
          claim: "The invalid second write must roll back the complete authority batch.",
          confidence: "unknown",
          limitations: ["This invalid fixture must never be retained."],
          capturedAt: "2026-08-02T12:20:01+10:00",
        });
      }),
      /approved research question/i,
    );
    runtime.db.exec("ROLLBACK");
    outerTransactionOpen = false;
    assert.equal(runtime.db.prepare(
      "SELECT COUNT(*) AS count FROM task_attempts WHERE task_id = ?",
    ).get(assignment.taskId).count, 0);
    assert.equal(runtime.db.prepare(
      "SELECT COUNT(*) AS count FROM agent_run_receipts WHERE task_id = ?",
    ).get(assignment.taskId).count, 0);
    assert.equal(runtime.db.prepare(
      "SELECT COUNT(*) AS count FROM research_runs WHERE task_id = ?",
    ).get(assignment.taskId).count, 0);
    assert.equal(runtime.db.prepare(
      "SELECT COUNT(*) AS count FROM preventure_research_source_snapshots WHERE authority_hash = ?",
    ).get(authority.authorityHash).count, 0);
    assert.equal(runtime.db.prepare(
      "SELECT COUNT(*) AS count FROM preventure_research_evidence_records WHERE authority_hash = ?",
    ).get(authority.authorityHash).count, 0);
  } finally {
    if (outerTransactionOpen) {
      try { runtime.db.exec("ROLLBACK"); } catch {}
    }
    runtime.close();
  }
});

test("full-round decision stays open when public grounding cannot prove seller identity", () => {
  const runtime = tempRuntime();
  try {
    createWorkflowAndTasks(runtime.db);
    const store = createPreventureResearchStore(
      runtime.db,
      historicalStoreOptions(() => DECISION_STORE_TIME),
    );
    const activation = activate(store, runtime.db);
    const assignments = materializeAll(store, activation, runtime.db);
    const sources = [];
    const comparatorSources = [];
    assignments.forEach((assignment, index) => {
      const execution = insertTerminalReceipt(runtime.db, assignment, index + 1);
      const reservationId = `reservation_preventure_terminal_${index + 1}`;
      const costId = `cost_preventure_terminal_${index + 1}`;
      runtime.db.prepare(
        `INSERT INTO budget_reservations
         (id, venture_id, workflow_id, task_id, status, amount_cents,
          currency, reserved_at, resolved_at, metadata)
         VALUES (?, NULL, ?, ?, 'incurred_estimate', 10, 'AUD', ?, NULL, '{}')`,
      ).run(
        reservationId,
        assignment.workflowId,
        assignment.taskId,
        `2026-08-02T12:${19 + index}:00+10:00`,
      );
      runtime.db.prepare(
        `INSERT INTO costs
         (id, workflow_id, venture_id, run_id, task_id, model_call_id,
          category, source, status, amount_cents, currency, occurred_at, metadata)
         VALUES (?, ?, NULL, ?, ?, ?, 'preventure_research', 'openai',
                 'incurred_estimate', 10, 'AUD', ?, '{}')`,
      ).run(
        costId,
        assignment.workflowId,
        execution.runId,
        assignment.taskId,
        execution.modelCallId,
        `2026-08-02T12:${20 + index}:00+10:00`,
      );
      store.appendCostEvent(assignment.assignmentHash, {
        costKey: `openai_assignment_cost_${index + 1}`,
        eventType: "estimated",
        amountAudCents: 10,
        exposureAudCents: 10,
        taskAttemptId: execution.attemptId,
        modelCallId: execution.modelCallId,
        budgetReservationId: reservationId,
        costId,
        agentRunReceiptId: execution.receiptId,
        occurredAt: `2026-08-02T12:${20 + index}:00+10:00`,
      });
      const primarySource = store.recordSourceSnapshot(assignment.assignmentHash, {
        id: `source_0${index + 1}`,
        version: "v1",
        sourceClass: authority.assignments[index].requiredSourceClasses[0],
        sourceTier: index + 1,
        captureStatus: "partial",
        url: execution.sourceUrl,
        title: execution.sourceTitle,
        publisher: execution.sourcePublisher,
        contentHash: execution.sourceContentHash,
        contentLocation: execution.sourceContentLocation,
        researchRunId: execution.researchRunId,
        sourceRecordId: execution.sourceRecordId,
        provenanceId: execution.provenanceId,
        agentRunReceiptId: execution.receiptId,
        limitations: execution.sourceLimitations,
        retrievedAt: execution.sourceRetrievedAt,
      }).sourceSnapshot;
      sources.push(primarySource);
      if (assignment.id === "comparator_and_buyer_evidence") {
        comparatorSources.push(primarySource);
        for (const [additionalIndex, retained] of execution.additionalSources.entries()) {
          comparatorSources.push(store.recordSourceSnapshot(assignment.assignmentHash, {
            id: `source_01_offer_${additionalIndex + 2}`,
            version: "v1",
            sourceClass: authority.assignments[index].requiredSourceClasses[0],
            sourceTier: 3,
            captureStatus: "partial",
            url: retained.sourceUrl,
            title: retained.sourceTitle,
            publisher: retained.sourcePublisher,
            contentHash: retained.sourceContentHash,
            contentLocation: retained.sourceContentLocation,
            researchRunId: execution.researchRunId,
            sourceRecordId: retained.sourceRecordId,
            provenanceId: retained.provenanceId,
            agentRunReceiptId: execution.receiptId,
            limitations: retained.sourceLimitations,
            retrievedAt: retained.sourceRetrievedAt,
          }).sourceSnapshot);
        }
      }
    });
    const categories = [
      ...Array(4).fill("direct_or_near_direct"),
      ...Array(3).fill("adjacent"),
      ...Array(3).fill("indirect"),
    ];
    const questions = authority.researchQuestions.map((item) => item.id);
    for (let index = 0; index < 10; index += 1) {
      const assignment = assignments[0];
      const source = comparatorSources[index];
      store.recordEvidence(assignment.assignmentHash, {
        id: `cmp_${String(index + 1).padStart(2, "0")}`,
        version: "v1",
        sourceSnapshotHash: source.snapshotHash,
        truthClass: "model_inference",
        polarity: index === 0 ? "contrary" : "supporting",
        questionId: questions[index % questions.length],
        claim: `Comparator ${index + 1} is a retained public observation and does not by itself prove sales.`,
        confidence: "high",
        limitations: ["Provider grounding does not independently capture the marketplace page."],
        details: evidenceDetails({
          comparator: {
            id: source.offerIdentityKey,
            category: categories[index],
            sellerId: null,
            channelId: source.marketplaceChannelId,
            formatIds: [authority.formats[index % authority.formats.length]],
            reviewObservationCount: 0,
          },
        }),
        capturedAt: `2026-08-02T12:${30 + index}:00+10:00`,
      });
    }
    const backedDecision = decisionInput();
    const formatAssignment = assignments.find((item) => item.id === "format_channel_and_economics");
    const formatSource = sources[assignments.indexOf(formatAssignment)];
    const readinessAssignment = assignments.find((item) => item.id === "independent_readiness_review");
    const readinessSource = sources[assignments.indexOf(readinessAssignment)];
    let evidenceMinute = 0;
    const recordCaseEvidence = (assignment, source, input) => {
      store.recordEvidence(assignment.assignmentHash, {
        id: input.id,
        version: "v1",
        sourceSnapshotHash: source.snapshotHash,
        truthClass: input.truthClass || "model_inference",
        polarity: "supporting",
        questionId: questions[evidenceMinute % questions.length],
        criterionId: input.criterionId || null,
        claim: input.claim,
        confidence: "medium",
        limitations: ["This conclusion remains model inference over partial provider grounding."],
        details: input.details,
        capturedAt: `2026-08-02T13:${String(evidenceMinute).padStart(2, "0")}:00+10:00`,
      });
      evidenceMinute += 1;
    };
    backedDecision.formatCases.forEach((item) => recordCaseEvidence(
      formatAssignment,
      formatSource,
      {
        id: `format_evidence_${item.id}`,
        criterionId: `format_case:${item.id}`,
        claim: `Retained public evidence supports the exact format disposition for ${item.id}.`,
        details: evidenceDetails({ formatCase: item }),
      },
    ));
    backedDecision.channelCases.forEach((item) => recordCaseEvidence(
      formatAssignment,
      formatSource,
      {
        id: `channel_evidence_${item.id}`,
        criterionId: `channel_case:${item.id}`,
        claim: `Retained public evidence supports the exact channel state for ${item.id}.`,
        details: evidenceDetails({ channelCase: item }),
      },
    ));
    backedDecision.economicsCases.forEach((item) => {
      const { evidenceRefs: _evidenceRefs, ...economicsCase } = item;
      recordCaseEvidence(formatAssignment, formatSource, {
        id: item.evidenceRefs[0],
        criterionId: `economics_case:${item.channelId}:${item.priceAudCents}`,
        claim: `Retained public evidence supports the exact economics state for ${item.channelId} at ${item.priceAudCents}.`,
        details: evidenceDetails({ economicsCase }),
      });
    });
    backedDecision.readinessGates.forEach((item) => recordCaseEvidence(
      readinessAssignment,
      readinessSource,
      {
        id: `readiness_evidence_${item.id}`,
        criterionId: `readiness_gate:${item.id}`,
        claim: `Independent retained review supports the exact readiness status for ${item.id}.`,
        details: evidenceDetails({ readinessGate: item }),
      },
    ));
    const recommendation = Object.fromEntries([
      "outcome", "summary", "buyer", "problem", "offer", "channel", "priceOrMargin",
      "evidenceStandard", "nextMoneyMove", "reviseOrStopCriteria",
      "materialContradictions", "limitations",
    ].map((key) => [key, backedDecision[key]]));
    recordCaseEvidence(readinessAssignment, readinessSource, {
      id: "independent_recommendation_evidence",
      truthClass: "model_inference",
      claim: "Independent review retains the exact bounded recommendation, limitations, and next money move.",
      details: evidenceDetails({ recommendation }),
    });
    assert.throws(
      () => store.recordDecision(
        authority.authorityHash,
        decisionInput({ formatCases: decisionInput().formatCases.slice(0, 2) }),
        { occurredAt: "2026-08-02T13:31:00+10:00" },
      ),
      /comparator mix|seller/i,
    );
    assert.equal(runtime.db.prepare(
      "SELECT COUNT(*) AS count FROM preventure_research_decisions",
    ).get().count, 0);
    assert.equal(store.loadLifecycle(authority.authorityHash).at(-1).eventType, "activated");
    assert.equal(store.loadLifecycle(authority.authorityHash).at(-1).eventType, "activated");
    assert.equal(store.verifyLedger().decisions, 0);
  } finally {
    runtime.close();
  }
});

test("unknown cost freezes dispatch and row-level verification detects tampering", () => {
  const runtime = tempRuntime();
  try {
    createWorkflowAndTasks(runtime.db);
    const store = createPreventureResearchStore(runtime.db, historicalStoreOptions());
    const activation = activate(store, runtime.db);
    const assignments = materializeAll(store, activation, runtime.db);
    const unknown = store.appendCostEvent(assignments[0].assignmentHash, {
      costKey: "openai_assignment_cost",
      eventType: "unknown",
      amountAudCents: null,
      exposureAudCents: assignments[0].maxCostAudCents,
      occurredAt: "2026-08-02T12:05:00+10:00",
    }).costEvent;
    const state = store.readState(authority.authorityHash);
    assert.equal(state.dispatchAllowed, false);
    assert.equal(state.unknownCostCount, 1);
    assert.throws(
      () => runtime.db.prepare(
        "UPDATE preventure_research_cost_events SET exposure_aud_cents = 0 WHERE receipt_hash = ?",
      ).run(unknown.receiptHash),
      /append-only/i,
    );
    runtime.db.exec("DROP TRIGGER trg_preventure_research_cost_events_immutable_update");
    runtime.db.prepare(
      `UPDATE preventure_research_cost_events
       SET exposure_aud_cents = 0,
           cost_json = json_set(cost_json, '$.exposureAudCents', 0)
       WHERE receipt_hash = ?`,
    ).run(unknown.receiptHash);
    assert.throws(() => store.verifyLedger(), /hash is invalid|projection|contradicts/i);
  } finally {
    runtime.close();
  }
});
