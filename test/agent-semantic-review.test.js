const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { AGENT_ASSURANCE_CASES } = require("../config/agent-assurance-cases");
const { get, openDatabase, run, seedDatabase } = require("../src/db");
const { ensureAiTeam } = require("../src/runtime/ai-team");
const {
  buildSemanticReviewPacket,
  calibrateSemanticReviewer,
  recordSemanticReviewAssurance,
  recordSemanticReviewFailure,
  runAgentSemanticReview,
  SemanticReviewExecutionError,
  semanticReviewUsage,
} = require("../src/runtime/agent-semantic-review");

test("semantic reviewer never receives the hidden expected label", () => {
  const source = AGENT_ASSURANCE_CASES.find((item) => item.expectedStatus === "failed");
  const packet = buildSemanticReviewPacket({ case: source });
  const serialized = JSON.stringify(packet);

  assert.ok(packet.rubric.length);
  assert.equal(serialized.includes("expectedStatus"), false);
  assert.equal(serialized.includes("expectedCheck"), false);
  assert.equal(serialized.includes("reviewerReason"), false);
  assert.equal(packet.authority.advisoryOnly, true);
  assert.equal(packet.authority.mayApproveWork, false);
});

test("semantic review output is structured and advisory only", async () => {
  const review = await runAgentSemanticReview({
    case: AGENT_ASSURANCE_CASES[0],
  }, {
    model: "test-semantic-reviewer",
    reviewFn: async () => ({
      verdict: "pass",
      confidence: "medium",
      evidenceUse: 4,
      uncertaintyCalibration: 5,
      commercialUsefulness: 4,
      scopeCompliance: 5,
      findings: [],
      recommendation: "Retain the bounded next test.",
    }),
  });

  assert.equal(review.verdict, "pass");
  assert.equal(review.authority, "advisory_only");
  assert.ok(review.subjectHash);
  assert.equal(review.scores.scopeCompliance, 5);
});

test("semantic calibration cannot gain authority below reviewed thresholds", async () => {
  const calibration = await calibrateSemanticReviewer(AGENT_ASSURANCE_CASES.slice(0, 8), {
    reviewFn: async () => ({
      verdict: "pass",
      confidence: "high",
      evidenceUse: 5,
      uncertaintyCalibration: 5,
      commercialUsefulness: 5,
      scopeCompliance: 5,
      findings: [],
      recommendation: "Advisory result only.",
    }),
  });

  assert.equal(calibration.status, "advisory_not_calibrated");
  assert.equal(calibration.authority, "advisory_only");
  assert.equal(calibration.caseCount, 8);
});

test("semantic calibration requires both overall and held-out agreement", async () => {
  const labels = new Map(AGENT_ASSURANCE_CASES.map((item) => [
    item.id,
    item.expectedStatus === "passed" ? "pass" : "fail",
  ]));
  const calibration = await calibrateSemanticReviewer(AGENT_ASSURANCE_CASES, {
    reviewFn: async (packet) => ({
      verdict: labels.get(packet.subjectId),
      confidence: "medium",
      evidenceUse: 4,
      uncertaintyCalibration: 4,
      commercialUsefulness: 4,
      scopeCompliance: 5,
      findings: [],
      recommendation: "Calibration fixture result.",
    }),
  });

  assert.equal(calibration.status, "calibrated_advisory");
  assert.equal(calibration.agreement, 1);
  assert.equal(calibration.heldOutAgreement, 1);
  assert.equal(calibration.authority, "advisory_only");
});

test("semantic review usage preserves measured cache evidence", () => {
  const usage = semanticReviewUsage({
    runContext: {
      usage: {
        inputTokens: 900,
        outputTokens: 120,
        totalTokens: 1020,
        inputTokensDetails: {
          cachedTokens: 400,
          cacheWriteTokens: 50,
        },
      },
    },
  });

  assert.deepEqual(usage, {
    input_tokens: 900,
    output_tokens: 120,
    total_tokens: 1020,
    cached_input_tokens: 400,
    cache_write_input_tokens: 50,
  });
});

test("semantic reviewer constructs against the installed Agents SDK and Zod contract", async () => {
  const review = await runAgentSemanticReview({
    case: AGENT_ASSURANCE_CASES[0],
  }, {
    model: "gpt-5.6-terra",
    tracingDisabled: true,
    runner: {
      async run() {
        return {
          finalOutput: {
            verdict: "pass",
            confidence: "medium",
            evidenceUse: 4,
            uncertaintyCalibration: 4,
            commercialUsefulness: 4,
            scopeCompliance: 5,
            findings: [],
            recommendation: "Keep this result advisory.",
          },
          rawResponses: [{
            responseId: "resp-semantic-contract",
            usage: { input_tokens: 100, output_tokens: 50, total_tokens: 150 },
          }],
        };
      },
    },
  });

  assert.equal(review.verdict, "pass");
  assert.equal(review.responseId, "resp-semantic-contract");
  assert.equal(review.usage.total_tokens, 150);
});

test("invalid structured output becomes a priced known failure without an automatic retry", async () => {
  const { ModelBehaviorError } = require("@openai/agents");
  let providerAttempts = 0;

  await assert.rejects(
    runAgentSemanticReview({
      case: AGENT_ASSURANCE_CASES[0],
    }, {
      model: "gpt-5.6-terra",
      maxTokens: 600,
      tracingDisabled: true,
      runner: {
        async run() {
          providerAttempts += 1;
          throw new ModelBehaviorError(
            "Invalid output type: Unterminated string in JSON at position 889",
          );
        },
      },
    }),
    (error) => {
      assert.ok(error instanceof SemanticReviewExecutionError);
      assert.equal(error.failure.failureKind, "semantic_output_invalid");
      assert.equal(error.failure.outcomeStatus, "known");
      assert.equal(error.failure.providerResponseReceived, true);
      assert.equal(error.failure.retryPolicy, "separate_visible_correction_only");
      assert.equal(error.failure.maxTokens, 600);
      assert.ok(error.failure.pricingEstimate.amountCents > 0);
      return true;
    },
  );
  assert.equal(providerAttempts, 1);
});

test("advisory semantic review records provider cost without gaining authority", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pantheon-semantic-record-"));
  const db = openDatabase(path.join(root, "runtime.sqlite"));
  try {
    seedDatabase(db);
    ensureAiTeam(db);
    const ts = "2026-07-28T00:00:00.000Z";
    run(
      db,
      `INSERT INTO workflows
       (id, venture_id, type, title, status, current_step, priority,
        metadata, created_at, updated_at)
       VALUES ('wf-semantic', 'venture-digital-products', 'assurance',
        'Semantic assurance proof', 'completed', '', 1, '{}', ?, ?)`,
      [ts, ts],
    );
    run(
      db,
      `INSERT INTO tasks
       (id, workflow_id, venture_id, title, kind, agent, status, priority,
        payload, result, created_at, updated_at)
       VALUES ('task-semantic', 'wf-semantic', 'venture-digital-products',
        'Review supplied evidence', 'live_ai_worker_execution',
        'demand_validator', 'completed', 1, '{}', '{}', ?, ?)`,
      [ts, ts],
    );
    run(
      db,
      `INSERT INTO agent_runs
       (id, agent_id, workflow_id, task_id, venture_id, mode, status,
        input_summary, output_summary, metadata, started_at, completed_at)
       VALUES ('run-semantic-subject', 'demand_validator', 'wf-semantic',
        'task-semantic', 'venture-digital-products', 'openai-agents-sdk',
        'completed', 'Evidence', 'Bounded recommendation', '{}', ?, ?)`,
      [ts, ts],
    );
    const recorded = recordSemanticReviewAssurance(db, {
      subjectRunId: "run-semantic-subject",
      sourceRecordId: "semantic-review-test",
      review: {
        policyVersion: "semantic-v1",
        assurancePolicyVersion: "assurance-v1",
        authority: "advisory_only",
        verdict: "pass",
        confidence: "medium",
        scores: {
          evidenceUse: 4,
          uncertaintyCalibration: 4,
          commercialUsefulness: 4,
          scopeCompliance: 5,
        },
        findings: [],
        recommendation: "Retain as advisory evidence only.",
        traceId: "trace-semantic",
        groupId: "group-semantic",
        model: "gpt-5.6-terra",
        subjectHash: "subject-hash",
        processing: { requested: "standard", serviceTier: null },
        usage: {
          input_tokens: 1000,
          output_tokens: 100,
          total_tokens: 1100,
          cached_input_tokens: 0,
          cache_write_input_tokens: 0,
        },
        pricingEstimate: { amountCents: 2, method: "test-estimate" },
      },
    });

    assert.equal(recorded.costCents, 2);
    assert.equal(get(db, "SELECT status FROM capability_assurance_records WHERE source_record_id = 'semantic-review-test'").status, "review_needed");
    assert.equal(get(db, "SELECT cost_status FROM model_calls WHERE id = ?", [recorded.modelCallId]).cost_status, "incurred_estimate");
    assert.equal(get(db, "SELECT amount_cents FROM costs WHERE id = ?", [recorded.costId]).amount_cents, 2);

    const failed = recordSemanticReviewFailure(db, {
      subjectRunId: "run-semantic-subject",
      sourceRecordId: "semantic-review-failure-test",
      failure: {
        policyVersion: "semantic-v1",
        assurancePolicyVersion: "assurance-v1",
        authority: "advisory_only",
        failureKind: "semantic_output_invalid",
        outcomeStatus: "known",
        providerResponseReceived: true,
        retryPolicy: "separate_visible_correction_only",
        errorName: "ModelBehaviorError",
        message: "Invalid output type: truncated JSON.",
        traceId: "trace-semantic-failure",
        groupId: "group-semantic",
        responseId: null,
        model: "gpt-5.6-terra",
        subjectHash: "subject-hash-failed",
        processing: { requested: "standard", serviceTier: null },
        maxTokens: 600,
        usage: {},
        pricingEstimate: { amountCents: 3, method: "priced_worst_case_bound_for_known_failed_response" },
      },
    });
    const duplicate = recordSemanticReviewFailure(db, {
      subjectRunId: "run-semantic-subject",
      sourceRecordId: "semantic-review-failure-test",
      failure: {},
    });

    assert.equal(failed.costCents, 3);
    assert.equal(duplicate.existing, true);
    assert.equal(get(db, "SELECT status FROM capability_assurance_records WHERE source_record_id = 'semantic-review-failure-test'").status, "failed");
    const failedCall = get(
      db,
      "SELECT status, cost_status, outcome_status FROM model_calls WHERE id = ?",
      [failed.modelCallId],
    );
    assert.equal(failedCall.status, "failed");
    assert.equal(failedCall.cost_status, "incurred_estimate");
    assert.equal(failedCall.outcome_status, "known");
    assert.equal(
      get(db, "SELECT COUNT(*) AS count FROM model_calls WHERE model_class = 'semantic-assurance'").count,
      2,
    );
  } finally {
    db.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
