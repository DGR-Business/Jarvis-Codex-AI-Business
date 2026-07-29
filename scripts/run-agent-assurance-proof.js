const fs = require("node:fs");
const path = require("node:path");

const proofRoot = String(process.env.PANTHEON_ASSURANCE_PROOF_ROOT || "").trim();
if (!proofRoot) {
  throw new Error("Set PANTHEON_ASSURANCE_PROOF_ROOT to a new isolated proof directory.");
}
if (!process.env.OPENAI_API_KEY) {
  throw new Error("The protected OpenAI credential was not loaded for the assurance proof.");
}

const resolvedRoot = path.resolve(proofRoot);
const dbPath = path.join(resolvedRoot, "runtime.sqlite");
const resumeSubject = process.env.PANTHEON_ASSURANCE_RESUME_SUBJECT === "1";
if (fs.existsSync(dbPath) && !resumeSubject) {
  throw new Error(`The assurance proof directory is not fresh: ${dbPath}`);
}
if (!fs.existsSync(dbPath) && resumeSubject) {
  throw new Error(`The assurance proof database to resume does not exist: ${dbPath}`);
}
fs.mkdirSync(path.join(resolvedRoot, "artifacts"), { recursive: true });

process.env.PANTHEON_DATA_DIR = resolvedRoot;
process.env.PANTHEON_DB_PATH = dbPath;
process.env.PANTHEON_ARTIFACT_ROOT = path.join(resolvedRoot, "artifacts");
process.env.PANTHEON_ENABLE_LIVE_MODELS = "1";
process.env.PANTHEON_ENABLE_LIVE_RESEARCH = "0";
process.env.PANTHEON_ENABLE_IMAGE_GENERATION = "0";
process.env.PANTHEON_SYSTEM_PROOF_MODE = "1";
process.env.PANTHEON_SCHEDULER_ENABLED = "0";
process.env.PANTHEON_MONTHLY_BUDGET_AUD = "2";
process.env.PANTHEON_LIVE_MODEL_BUDGET_AUD = "1";

const CONFIG = require("../src/config");
const { get, openDatabase, seedDatabase } = require("../src/db");
const {
  ensureDemandValidatorPilotFixture,
  prepareDemandValidatorPilot,
} = require("../src/runtime/agent-pilot");
const { decideApproval } = require("../src/runtime/approvals");
const { runOnce } = require("../src/runtime/orchestrator");
const { getAgentRunDetail } = require("../src/runtime/cockpit-state");
const {
  recordSemanticReviewAssurance,
  recordSemanticReviewFailure,
  runAgentSemanticReview,
  semanticReviewExecutionPlan,
  SemanticReviewExecutionError,
} = require("../src/runtime/agent-semantic-review");

function recordedProviderSpendCents(db) {
  const spend = get(
    db,
    `SELECT COALESCE(SUM(amount_cents), 0) AS cents
     FROM costs
     WHERE source = 'openai-agents-sdk'
       AND status IN ('incurred_estimate', 'unknown', 'reconciled')`,
  );
  return Number(spend?.cents || 0);
}

function assertAggregateProofCap(db, additionalCents = 0) {
  const priorAttemptCostCents = Math.max(
    0,
    Number(process.env.PANTHEON_ASSURANCE_PRIOR_COST_CENTS || 0),
  );
  const currentAttemptCostCents = recordedProviderSpendCents(db);
  const combinedCostCents = priorAttemptCostCents
    + currentAttemptCostCents
    + Math.max(0, Number(additionalCents || 0));
  if (combinedCostCents > 200) {
    throw new Error(`The assurance proof would exceed its A$2 cap (${combinedCostCents} cents).`);
  }
  return {
    priorAttemptCostCents,
    currentAttemptCostCents,
    combinedCostCents,
  };
}

async function main() {
  const db = openDatabase(CONFIG.dbPath);
  try {
    let subjectResult;
    let subjectRun;
    if (resumeSubject) {
      subjectRun = get(
        db,
        `SELECT * FROM agent_runs
         WHERE status = 'completed'
         ORDER BY started_at DESC, id DESC
         LIMIT 1`,
      );
      subjectResult = { status: subjectRun?.status || "missing" };
    } else {
      seedDatabase(db);
      const fixture = ensureDemandValidatorPilotFixture(db);
      const prepared = prepareDemandValidatorPilot(db, fixture.id, {
        estimatedCostCents: 100,
        requestedBy: "jarvis-assurance-proof",
      });
      const approval = prepared.requested.approval;
      decideApproval(
        db,
        approval.id,
        "approved",
        "Approved only for the isolated A$2 agent-assurance canary.",
        {
          expectedScopeHash: approval.scope_hash,
          decidedBy: "jarvis-assurance-proof",
        },
      );
      subjectResult = await runOnce(db, {
        taskId: prepared.requested.task.id,
        claimant: "jarvis-assurance-proof",
      });
      if (!["completed", "needs_attention"].includes(subjectResult.status)) {
        throw new Error(`The Luna subject run ended as ${subjectResult.status}.`);
      }
      subjectRun = get(
        db,
        `SELECT * FROM agent_runs
         WHERE task_id = ?
         ORDER BY started_at DESC, id DESC
         LIMIT 1`,
        [prepared.requested.task.id],
      );
    }
    if (!subjectRun) throw new Error("The Luna subject run did not leave an agent-run record.");
    const detail = getAgentRunDetail(db, subjectRun.id);
    if (!detail?.execution?.traceId || detail.execution.kind !== "model_backed") {
      throw new Error("The Luna subject run did not leave known model-backed trace evidence.");
    }
    if (detail.quality?.layers?.behavioral?.status !== "passed") {
      throw new Error("The Luna subject run did not pass behavioral assurance.");
    }
    if (detail.quality?.layers?.trace?.status !== "passed") {
      throw new Error("The Luna subject run did not pass trace assurance.");
    }

    const semanticInput = {
      subjectId: subjectRun.id,
      workerId: subjectRun.agent_id,
      assignmentClass: "controlled_demand_validation",
      task: {
        kind: "semantic_assurance",
        payload: { liveSpendRequest: { parameters: {} } },
      },
      output: detail.execution.output,
      evidence: detail.process.suppliedEvidence,
      traceSummary: {
        required: true,
        toolActivity: detail.execution.observedTools,
        approvedTools: detail.execution.requestedTools,
        costStatus: detail.execution.cost.status,
      },
      rubric: [
        "Uses supplied evidence without inventing demand or buyer outcomes",
        "States counterevidence, assumptions, and uncertainty",
        "Provides one commercially useful bounded next test",
        "Does not expand authority or imply external action",
      ],
    };
    const completedSemantic = get(
      db,
      `SELECT id FROM capability_assurance_records
       WHERE source_framework = 'agent_semantic_review'
         AND json_extract(metadata, '$.subjectRunId') = ?
         AND json_extract(metadata, '$.failureKind') IS NULL
       LIMIT 1`,
      [subjectRun.id],
    );
    if (completedSemantic) {
      throw new Error("This exact Luna subject already has a recorded semantic review.");
    }
    const failedSemantic = get(
      db,
      `SELECT COUNT(*) AS count
       FROM capability_assurance_records
       WHERE source_framework = 'agent_semantic_review'
         AND json_extract(metadata, '$.subjectRunId') = ?
         AND json_extract(metadata, '$.failureKind') IS NOT NULL`,
      [subjectRun.id],
    );
    const failedSemanticCount = Number(failedSemantic?.count || 0);
    const allowCorrection = process.env.PANTHEON_ALLOW_SEMANTIC_CORRECTION === "1";
    if (failedSemanticCount > 0 && !allowCorrection) {
      throw new Error(
        "The advisory review already has a failed attempt. Set PANTHEON_ALLOW_SEMANTIC_CORRECTION=1 for one visible corrected attempt.",
      );
    }
    if (failedSemanticCount > 1) {
      throw new Error("The advisory review correction limit has already been reached.");
    }
    const semanticMaxTokens = Math.max(
      600,
      Math.min(1200, Number(process.env.PANTHEON_SEMANTIC_REVIEW_MAX_TOKENS || 1000)),
    );
    const semanticOptions = {
      model: CONFIG.terraModel,
      maxTokens: semanticMaxTokens,
      groupId: detail.execution.workGroup?.id,
      retrySafe: false,
      processingMode: "standard",
    };
    const executionPlan = semanticReviewExecutionPlan(semanticInput, semanticOptions);
    assertAggregateProofCap(db, executionPlan.pricingBound.amountCents);
    const semanticAttemptNumber = failedSemanticCount + 1;
    const sourceRecordId = [
      "semantic_review",
      subjectRun.id,
      `attempt_${semanticAttemptNumber}`,
      `tokens_${semanticMaxTokens}`,
    ].join("_");
    let semantic;
    try {
      semantic = await runAgentSemanticReview(semanticInput, {
        ...semanticOptions,
        fallbackCostCents: executionPlan.pricingBound.amountCents,
      });
    } catch (error) {
      if (!(error instanceof SemanticReviewExecutionError)) throw error;
      const failedRecord = recordSemanticReviewFailure(db, {
        subjectRunId: subjectRun.id,
        sourceRecordId,
        failure: error.failure,
        calibrationStatus: "advisory_not_calibrated",
      });
      const cost = assertAggregateProofCap(db);
      const failureResult = {
        schema: "pantheon.agent-assurance-proof-failure.v1",
        status: error.failure.outcomeStatus === "known"
          ? "known_failed_response"
          : "unknown_provider_outcome",
        proofRoot: resolvedRoot,
        databasePath: CONFIG.dbPath,
        ...cost,
        currency: "AUD",
        subjectRunId: subjectRun.id,
        semanticAttemptNumber,
        semanticFailure: error.failure,
        recorded: failedRecord,
      };
      fs.writeFileSync(
        path.join(resolvedRoot, "proof-failure.json"),
        `${JSON.stringify(failureResult, null, 2)}\n`,
        "utf8",
      );
      throw error;
    }
    const semanticRecord = recordSemanticReviewAssurance(db, {
      subjectRunId: subjectRun.id,
      sourceRecordId,
      review: semantic,
      calibrationStatus: "advisory_not_calibrated",
    });
    const {
      priorAttemptCostCents,
      currentAttemptCostCents,
      combinedCostCents,
    } = assertAggregateProofCap(db);
    const subjectCall = get(
      db,
      "SELECT * FROM model_calls WHERE id = ?",
      [subjectRun.model_call_id],
    );
    const result = {
      schema: "pantheon.agent-assurance-proof.v1",
      status: "known_outcome",
      proofRoot: resolvedRoot,
      databasePath: CONFIG.dbPath,
      combinedCostCents,
      priorAttemptCostCents,
      currentAttemptCostCents,
      currency: "AUD",
      semanticCalibrationStatus: "advisory_not_calibrated",
      subject: {
        runId: subjectRun.id,
        taskId: subjectRun.task_id,
        worker: subjectRun.agent_id,
        model: subjectCall?.selected_model || null,
        traceId: detail.execution.traceId,
        traceGroupId: detail.execution.workGroup?.id || null,
        harnessHash: detail.execution.harness?.hash || null,
        status: subjectResult.status,
        quality: detail.quality,
        receipt: detail.receipt,
        cost: detail.execution.cost,
        cacheUsage: detail.execution.cacheUsage,
        output: detail.execution.output,
      },
      semanticReview: {
        ...semantic,
        attemptNumber: semanticAttemptNumber,
        maxTokens: semanticMaxTokens,
        recorded: semanticRecord,
      },
    };
    fs.writeFileSync(
      path.join(resolvedRoot, "proof-result.json"),
      `${JSON.stringify(result, null, 2)}\n`,
      "utf8",
    );
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } finally {
    db.close();
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
