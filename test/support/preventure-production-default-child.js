"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const mode = process.argv[2];
assert.ok(["blocked", "armed", "armed-no-request-header", "expired-default"].includes(mode));

const nativeFetch = globalThis.fetch;
const authority = require("../../config/preventure-research-authority-smm-scope-guard-v1");
const { OFFICIAL_OPENAI_RESPONSES_URL } = require("../../src/adapters/openai-egress-policy");
const { get, openDatabase, seedDatabase } = require("../../src/db");
const {
  HISTORICAL_ACTIVE_V1_TIME,
  historicalV1TestRegistry,
} = require("./preventure-research-test-registry");

let providerCalls = 0;
let capturedRequest = null;

function structuredInsufficientOutput() {
  const sources = [
    {
      id: "public_source_1",
      sourceClass: "public_marketplace_listing_or_result_observation",
      sourceTier: 3,
      captureStatus: "partial",
      url: "https://www.etsy.com/market/social_media_manager_template",
      title: "Public Etsy market observation",
      publisher: "Etsy",
      publishedAt: null,
      content: null,
      retainedEvidenceHash: null,
      retainedSourceSnapshotHash: null,
      limitations: ["A displayed public market page does not prove sales or buyer demand."],
    },
    {
      id: "public_source_2",
      sourceClass: "public_practitioner_discussion",
      sourceTier: 4,
      captureStatus: "partial",
      url: "https://www.reddit.com/r/socialmedia/",
      title: "Public practitioner discussion index",
      publisher: "Reddit",
      publishedAt: null,
      content: null,
      retainedEvidenceHash: null,
      retainedSourceSnapshotHash: null,
      limitations: ["Practitioner discussion is directional and not purchaser-attributable proof."],
    },
  ];
  return {
    sources,
    evidence: [{
      id: "bounded_signal_1",
      sourceId: sources[0].id,
      truthClass: "model_inference",
      polarity: "neutral",
      questionId: authority.researchQuestions[0].id,
      criterionId: null,
      claim: "One public market page was observed; it does not establish paid demand.",
      confidence: "low",
      limitations: ["No purchaser-attributable behaviour was retained."],
      details: {
        comparator: null,
        buyerEvidence: null,
        formatCase: null,
        channelCase: null,
        economicsCase: null,
        readinessGate: null,
        recommendation: null,
      },
    }],
    comparators: ["The retained sample is below the required comparator minimum."],
    buyerEvidence: ["No decision-grade purchaser evidence was established."],
    contraryEvidence: ["Displayed supply is not proof of demand or profitability."],
    limitations: ["The bounded public search ended with a validated evidence shortfall."],
  };
}

function fakeProviderResponse(init) {
  const body = JSON.parse(Buffer.from(init.body).toString("utf8"));
  capturedRequest = {
    model: body.model,
    store: body.store,
    background: body.background,
    toolChoice: body.tool_choice,
    toolCount: body.tools?.length,
  };
  const output = structuredInsufficientOutput();
  const first = output.sources[0];
  const second = output.sources[1];
  const provider = {
    id: "resp_preventure_production_default_1",
    object: "response",
    model: body.model,
    status: "completed",
    incomplete_details: null,
    output: [
      {
        id: "ws_preventure_1",
        type: "web_search_call",
        status: "completed",
        action: {
          type: "search",
          query: "etsy gumroad social media manager approval scope templates",
          sources: [{
            url: first.url,
            title: first.title,
            publisher: first.publisher,
            snippet: "A public market result was displayed.",
          }],
        },
      },
      {
        id: "ws_preventure_2",
        type: "web_search_call",
        status: "completed",
        action: {
          type: "search",
          query: "contrary evidence social media manager client approval template demand",
          sources: [{
            url: second.url,
            title: second.title,
            publisher: second.publisher,
            snippet: "A public practitioner index was displayed.",
          }],
        },
      },
      {
        id: "msg_preventure_1",
        type: "message",
        status: "completed",
        role: "assistant",
        content: [{
          type: "output_text",
          text: JSON.stringify(output),
          annotations: [first, second].map((source) => ({
            type: "url_citation",
            url: source.url,
            title: source.title,
          })),
        }],
      },
    ],
    usage: {
      input_tokens: 100,
      output_tokens: 100,
      total_tokens: 200,
    },
  };
  return new Response(JSON.stringify(provider), {
    status: 200,
    headers: {
      "content-type": "application/json",
      ...(mode === "armed-no-request-header"
        ? {}
        : { "x-request-id": "req_preventure_production_default_1" }),
    },
  });
}

globalThis.fetch = async (input, init) => {
  const url = input instanceof Request ? input.url : String(input);
  if (url === OFFICIAL_OPENAI_RESPONSES_URL) {
    providerCalls += 1;
    if (mode === "blocked") throw new Error("Blocked production mode must not reach fetch.");
    return fakeProviderResponse(init);
  }
  return nativeFetch(input, init);
};

const { createApp } = require("../../src/server");

async function request(origin, pathname, options = {}) {
  const response = await globalThis.fetch(`${origin}${pathname}`, options);
  return { response, payload: await response.json() };
}

async function main() {
  const dbPath = process.env.PANTHEON_DB_PATH;
  const activeHistoricalProof = mode !== "expired-default";
  const historicalClock = () => HISTORICAL_ACTIVE_V1_TIME;
  const db = openDatabase(
    dbPath,
    activeHistoricalProof ? { clock: historicalClock } : {},
  );
  seedDatabase(db, { includeDemoProof: false });
  const bootstrapSecret = "production-default-bootstrap";
  const app = createApp({
    db,
    dbPath,
    schedulerEnabled: false,
    security: true,
    sessionSecret: Buffer.alloc(32, 77),
    bootstrapSecret,
    initializePreventureResearch: true,
    ...(activeHistoricalProof ? {
      preventureResearchClock: historicalClock,
      preventureResearchAuthorityRegistry: historicalV1TestRegistry,
    } : {}),
  });
  await new Promise((resolve, reject) => {
    app.server.once("error", reject);
    app.server.listen(0, "127.0.0.1", resolve);
  });
  const origin = `http://127.0.0.1:${app.server.address().port}`;
  try {
    if (mode === "expired-default") {
      assert.ok(Date.parse(get(db, "SELECT pantheon_current_time() AS value").value) >= Date.parse(authority.expiresAt));
      assert.equal(app.runtimeState.preventureResearch.initialization.status, "withheld");
      assert.equal(
        app.runtimeState.preventureResearch.initialization.reason,
        "preventure_research_authority_expired",
      );
      assert.equal(providerCalls, 0);
      assert.equal(get(db, "SELECT COUNT(*) AS count FROM task_attempts").count, 0);
      assert.equal(get(db, "SELECT COUNT(*) AS count FROM model_calls").count, 0);
      assert.equal(get(db, "SELECT COUNT(*) AS count FROM costs").count, 0);
      assert.equal(get(db, "SELECT COUNT(*) AS count FROM preventure_research_assignments").count, 0);
      process.stdout.write(`${JSON.stringify({ mode, providerCalls, expired: true })}\n`);
      return;
    }

    const sessionResponse = await request(origin, "/api/session", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin,
        "x-pantheon-bootstrap": bootstrapSecret,
      },
      body: "{}",
    });
    assert.equal(sessionResponse.response.status, 201);
    const cookie = sessionResponse.response.headers.get("set-cookie").split(";", 1)[0];
    const session = {
      cookie,
      csrfToken: sessionResponse.payload.csrfToken,
    };
    const read = (pathname) => request(origin, pathname, {
      headers: { cookie: session.cookie },
    });
    const post = (pathname, body) => request(origin, pathname, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: session.cookie,
        origin,
        "x-pantheon-csrf": session.csrfToken,
      },
      body: JSON.stringify(body),
    });
    for (const lifecycle of ["accepted", "activated"]) {
      const owner = await read("/api/preventure-research");
      assert.equal(owner.response.status, 200);
      assert.equal(owner.payload.current.reviewDecision.eventType, lifecycle);
      const decision = owner.payload.current.reviewDecision;
      const approved = await post(
        `/api/preventure-research/lifecycle-decisions/${encodeURIComponent(decision.id)}/approve`,
        { scopeHash: decision.scopeHash },
      );
      assert.equal(approved.response.status, 200, JSON.stringify(approved.payload));
    }
    const system = await read("/api/system");
    assert.equal(system.response.status, 200);
    const control = system.payload.preventureResearchRuntime.assignmentControls.find(
      (item) => item.assignmentId === authority.assignments[0].id,
    );
    assert.ok(control?.descriptorHash);
    assert.ok(control?.requestBodyHash);
    const runBody = {
      authorityHash: authority.authorityHash,
      assignmentHash: control.assignmentHash,
      descriptorHash: control.descriptorHash,
      requestBodyHash: control.requestBodyHash,
    };
    if (mode === "blocked") {
      assert.equal(system.payload.preventureResearchRuntime.assignmentRunReady, false);
      assert.equal(system.payload.preventureResearchRuntime.providerContactAllowed, false);
      assert.ok(control.blockers.some((item) => item.code === "openai_credential_not_configured"));
      assert.ok(control.blockers.some((item) => item.code === "live_research_not_enabled"));
      const blocked = await post(
        `/api/preventure-research/assignments/${encodeURIComponent(control.assignmentId)}/run`,
        runBody,
      );
      assert.equal(blocked.response.status, 503);
      assert.equal(providerCalls, 0);
      assert.equal(get(db, "SELECT COUNT(*) AS count FROM task_attempts").count, 0);
      assert.equal(get(db, "SELECT COUNT(*) AS count FROM model_calls").count, 0);
      assert.equal(get(db, "SELECT COUNT(*) AS count FROM costs").count, 0);
      assert.equal(
        get(db, "SELECT status FROM scheduler_jobs WHERE id = 'job-preventure-research'").status,
        "disabled",
      );
      process.stdout.write(`${JSON.stringify({ mode, providerCalls, blocked: true })}\n`);
      return;
    }

    assert.equal(system.payload.preventureResearchRuntime.assignmentRunReady, true);
    assert.equal(control.requiresPreparation, true);
    assert.equal(system.payload.preventureResearchRuntime.providerContactAllowed, false);
    db.exec(`CREATE TRIGGER test_preventure_recovery
      BEFORE INSERT ON preventure_research_terminal_stops
      BEGIN
        SELECT RAISE(ABORT, 'test local recovery boundary');
      END`);
    const firstRun = await post(
      `/api/preventure-research/assignments/${encodeURIComponent(control.assignmentId)}/run`,
      runBody,
    );
    const latestServerError = get(
      db,
      "SELECT message, metadata FROM events WHERE type = 'server.error' ORDER BY id DESC LIMIT 1",
    );
    assert.equal(
      firstRun.response.status,
      200,
      JSON.stringify({ payload: firstRun.payload, latestServerError }),
    );
    assert.equal(providerCalls, 1);
    const recoverySystem = await read("/api/system");
    const recovery = recoverySystem.payload.preventureResearchRuntime.assignmentControls.find(
      (item) => item.assignmentId === control.assignmentId,
    );
    assert.equal(recovery.canReprocess, true, JSON.stringify(recovery));
    assert.match(recovery.retainedOutputHash, /^sha256:[a-f0-9]{64}$/);
    const beforeRecovery = {
      providerCalls,
      attempts: get(db, "SELECT COUNT(*) AS count FROM task_attempts").count,
      modelCalls: get(db, "SELECT COUNT(*) AS count FROM model_calls").count,
      costs: get(db, "SELECT COUNT(*) AS count FROM costs").count,
      reservations: get(db, "SELECT COUNT(*) AS count FROM budget_reservations").count,
      authorityCosts: get(db, "SELECT COUNT(*) AS count FROM preventure_research_cost_events").count,
      exposure: get(db, "SELECT COALESCE(SUM(amount_cents), 0) AS amount FROM costs").amount,
    };
    const beforeRecoveryCost = get(
      db,
      `SELECT sequence, receipt_hash, event_type, amount_aud_cents, exposure_aud_cents,
              task_attempt_id, model_call_id
       FROM preventure_research_cost_events
       WHERE assignment_hash = ? ORDER BY sequence DESC LIMIT 1`,
      [control.assignmentHash],
    );
    db.exec("DROP TRIGGER test_preventure_recovery");
    const recovered = await post(
      `/api/preventure-research/assignments/${encodeURIComponent(control.assignmentId)}/reprocess`,
      {
        authorityHash: authority.authorityHash,
        assignmentHash: control.assignmentHash,
        descriptorHash: recovery.descriptorHash,
        retainedOutputHash: recovery.retainedOutputHash,
      },
    );
    assert.equal(recovered.response.status, 200, JSON.stringify(recovered.payload));
    assert.equal(providerCalls, 1);
    const afterRecovery = {
      providerCalls,
      attempts: get(db, "SELECT COUNT(*) AS count FROM task_attempts").count,
      modelCalls: get(db, "SELECT COUNT(*) AS count FROM model_calls").count,
      costs: get(db, "SELECT COUNT(*) AS count FROM costs").count,
      reservations: get(db, "SELECT COUNT(*) AS count FROM budget_reservations").count,
      authorityCosts: get(db, "SELECT COUNT(*) AS count FROM preventure_research_cost_events").count,
      exposure: get(db, "SELECT COALESCE(SUM(amount_cents), 0) AS amount FROM costs").amount,
    };
    assert.deepEqual({
      ...afterRecovery,
      authorityCosts: beforeRecovery.authorityCosts,
    }, beforeRecovery);
    assert.equal(afterRecovery.authorityCosts, beforeRecovery.authorityCosts + 1);
    const reboundCost = get(
      db,
      `SELECT sequence, previous_receipt_hash, event_type, amount_aud_cents,
              exposure_aud_cents, task_attempt_id, model_call_id, agent_run_receipt_id
       FROM preventure_research_cost_events
       WHERE assignment_hash = ? ORDER BY sequence DESC LIMIT 1`,
      [control.assignmentHash],
    );
    assert.equal(reboundCost.sequence, beforeRecoveryCost.sequence + 1);
    assert.equal(reboundCost.previous_receipt_hash, beforeRecoveryCost.receipt_hash);
    for (const key of [
      "event_type",
      "amount_aud_cents",
      "exposure_aud_cents",
      "task_attempt_id",
      "model_call_id",
    ]) assert.equal(reboundCost[key], beforeRecoveryCost[key], key);
    assert.ok(reboundCost.agent_run_receipt_id);
    const finalized = await post(
      "/api/scheduler/jobs/job-preventure-research/run",
      { force: true },
    );
    assert.equal(finalized.response.status, 200, JSON.stringify(finalized.payload));
    assert.deepEqual({
      providerCalls,
      attempts: get(db, "SELECT COUNT(*) AS count FROM task_attempts").count,
      modelCalls: get(db, "SELECT COUNT(*) AS count FROM model_calls").count,
      costs: get(db, "SELECT COUNT(*) AS count FROM costs").count,
      reservations: get(db, "SELECT COUNT(*) AS count FROM budget_reservations").count,
      authorityCosts: get(db, "SELECT COUNT(*) AS count FROM preventure_research_cost_events").count,
      exposure: get(db, "SELECT COALESCE(SUM(amount_cents), 0) AS amount FROM costs").amount,
    }, afterRecovery);
    const sealedDecision = get(
      db,
      `SELECT outcome, completion_mode
       FROM preventure_research_decisions WHERE authority_hash = ?`,
      [authority.authorityHash],
    );
    assert.deepEqual({ ...sealedDecision }, {
      outcome: "research_more",
      completion_mode: "validated_early_stop",
    });
    assert.equal(
      get(
        db,
        `SELECT event_type FROM preventure_research_lifecycle_events
         WHERE authority_hash = ? ORDER BY sequence DESC LIMIT 1`,
        [authority.authorityHash],
      ).event_type,
      "completed",
    );
    assert.equal(
      get(db, "SELECT status FROM scheduler_jobs WHERE id = 'job-preventure-research'").status,
      "disabled",
    );
    const statuses = db.prepare(
      `SELECT assignments.assignment_id, tasks.status
       FROM preventure_research_assignments AS assignments
       JOIN tasks ON tasks.id = assignments.task_id
       WHERE assignments.authority_hash = ?`,
    ).all(authority.authorityHash);
    assert.equal(statuses.find((item) => item.assignment_id === authority.assignments[0].id).status, "completed");
    assert.ok(statuses.filter((item) => item.assignment_id !== authority.assignments[0].id)
      .every((item) => item.status === "skipped"));
    const terminalStop = get(
      db,
      `SELECT trigger_assignment_id, trigger_outcome_class, reason_class, commercial_inference
       FROM preventure_research_terminal_stops WHERE authority_hash = ?`,
      [authority.authorityHash],
    );
    assert.deepEqual({ ...terminalStop }, {
      trigger_assignment_id: authority.assignments[0].id,
      trigger_outcome_class: "validated_evidence_shortfall",
      reason_class: "evidence",
      commercial_inference: "none",
    });
    const skipped = db.prepare(
      `SELECT assignment_id, dispatch_state, task_attempt_count, model_call_count,
              agent_run_receipt_count, research_run_count, agent_run_count,
              tool_invocation_count, budget_reservation_count, cost_record_count,
              cost_event_count, source_snapshot_count, evidence_record_count,
              total_aud_cost_cents
       FROM preventure_research_assignment_skips
       WHERE authority_hash = ? ORDER BY assignment_order`,
    ).all(authority.authorityHash);
    assert.deepEqual(
      skipped.map((item) => item.assignment_id),
      authority.assignments.slice(1).map((item) => item.id),
    );
    assert.ok(skipped.every((item) => (
      item.dispatch_state === "not_dispatched"
      && Object.entries(item).every(([key, value]) => (
        ["assignment_id", "dispatch_state"].includes(key) || value === 0
      ))
    )));
    const finalCost = get(
      db,
      `SELECT event_type, amount_aud_cents, exposure_aud_cents, task_attempt_id,
              model_call_id, agent_run_receipt_id
       FROM preventure_research_cost_events
       WHERE assignment_hash = ? ORDER BY sequence DESC LIMIT 1`,
      [control.assignmentHash],
    );
    assert.ok(["estimated", "incurred", "reconciled"].includes(finalCost.event_type));
    assert.ok(finalCost.amount_aud_cents >= 0);
    assert.ok(finalCost.amount_aud_cents <= authority.assignments[0].maxCostAudCents);
    assert.equal(finalCost.exposure_aud_cents, finalCost.amount_aud_cents);
    assert.ok(finalCost.task_attempt_id);
    assert.ok(finalCost.model_call_id);
    assert.ok(finalCost.agent_run_receipt_id);
    const finalReceipt = JSON.parse(db.prepare(
      `SELECT receipts.receipt
       FROM agent_run_receipts AS receipts
       JOIN preventure_research_assignments AS assignments
         ON assignments.task_id = receipts.task_id
       WHERE assignments.authority_hash = ?
         AND assignments.assignment_id = ?
       ORDER BY receipts.sequence DESC LIMIT 1`,
    ).get(authority.authorityHash, control.assignmentId).receipt);
    assert.equal(
      finalReceipt.provider.providerRequestId,
      mode === "armed-no-request-header" ? null : "req_preventure_production_default_1",
    );
    assert.equal(
      finalReceipt.provider.providerResponseId,
      "resp_preventure_production_default_1",
    );
    assert.equal(
      finalReceipt.provider.metadata.providerResponseId,
      "resp_preventure_production_default_1",
    );
    assert.notEqual(
      finalReceipt.provider.providerRequestId,
      finalReceipt.provider.providerResponseId,
    );
    const artifactDir = path.join(process.env.PANTHEON_ARTIFACT_ROOT, "preventure-research");
    const artifactFiles = fs.readdirSync(artifactDir, { recursive: true })
      .filter((entry) => String(entry).endsWith(".json"));
    assert.ok(artifactFiles.length >= 1);
    assert.deepEqual(capturedRequest, {
      model: authority.provider.model,
      store: false,
      background: false,
      toolChoice: "required",
      toolCount: 1,
    });
    const persistedFiles = [
      dbPath,
      `${dbPath}-wal`,
      `${dbPath}-shm`,
      ...artifactFiles.map((entry) => path.join(artifactDir, String(entry))),
    ].filter((file) => fs.existsSync(file) && fs.statSync(file).isFile());
    const sensitiveValues = [
      "sk-fake-production-default-proof",
      "Bearer sk-fake-production-default-proof",
      bootstrapSecret,
      session.cookie,
      session.cookie.slice(session.cookie.indexOf("=") + 1),
      session.csrfToken,
    ];
    for (const file of persistedFiles) {
      const bytes = fs.readFileSync(file);
      for (const sensitiveValue of sensitiveValues) {
        assert.equal(
          bytes.includes(Buffer.from(sensitiveValue)),
          false,
          `Sensitive runtime value was persisted in ${path.basename(file)}.`,
        );
      }
    }
    process.stdout.write(`${JSON.stringify({
      mode,
      providerCalls,
      recovered: true,
      artifactFiles: artifactFiles.length,
      providerRequestId: finalReceipt.provider.providerRequestId,
      providerResponseId: finalReceipt.provider.providerResponseId,
    })}\n`);
  } finally {
    for (const client of app.wss.clients) client.terminate();
    await new Promise((resolve) => app.server.close(resolve));
    app.wss.close();
    db.close();
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
