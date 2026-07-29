const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const CONFIG = require("../config");
const { fromJson, get, insertEvent, now, run, toJson } = require("../db");
const {
  BUYER_INTENT_VALIDATION_SPEC_VERSION,
  buyerIntentValidationSpecIsActive,
  getBuyerIntentValidationSpec,
} = require("../../config/buyer-intent-validation-specs");
const { claimSafetyIsConfirmed } = require("./claim-safety");
const { createCommercialExperiment, getCommercialExperiment } = require("./commercial-results");
const { getInvestmentCase } = require("./commercial-investment-review");
const { generateExecutionPack, getExecutionPack } = require("./test-execution-pack");
const { stableIdSegment } = require("./stable-id");

const BUYER_INTENT_CONTRACT_SCHEMA = "pantheon.buyer-intent-validation.v1";
const LEGACY_BUYER_INTENT_PATH_RETIRED_CODE = "legacy_commercial_path_retired";
const TERMINAL_FIXTURE_CAPABILITIES = new WeakMap();

function legacyBuyerIntentPathRetired(pathName) {
  const error = new Error(
    "This v1 buyer-intent creation path is permanently retired. "
      + "Use a validated immutable v2 commercial-test contract.",
  );
  error.name = "LegacyCommercialPathRetiredError";
  error.statusCode = 410;
  error.code = LEGACY_BUYER_INTENT_PATH_RETIRED_CODE;
  error.details = {
    path: pathName,
    replacement: "pantheon.commercial-test-contract.v2",
  };
  return error;
}

function stableHash(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function parseRow(row, fields = ["metadata"]) {
  if (!row) return null;
  const parsed = { ...row };
  for (const field of fields) parsed[field] = fromJson(parsed[field], field.endsWith("s") ? [] : {});
  return parsed;
}

function exactIds(spec, investmentCase) {
  const segment = stableIdSegment(
    [
      spec.id,
      investmentCase.venture_id,
      investmentCase.id,
      investmentCase.decision_hash,
    ].join(":"),
    64,
    "buyer_intent",
  );
  return {
    workflowId: `wf_buyer_intent_${segment}`,
    briefId: `brief_buyer_intent_${segment}`,
    candidateId: `test_buyer_intent_${segment}`,
    experimentId: `exp_buyer_intent_${segment}`,
    planId: `catalogue_validation_${segment}`,
    itemId: `catalogue_item_${segment}`,
  };
}

function validationContract(spec, investmentCase, ids) {
  const contract = {
    schema: BUYER_INTENT_CONTRACT_SCHEMA,
    registryVersion: BUYER_INTENT_VALIDATION_SPEC_VERSION,
    specId: spec.id,
    specVersion: spec.version,
    decisionCaseId: investmentCase.id,
    decisionHash: investmentCase.decision_hash,
    opportunityId: investmentCase.opportunity_id,
    ventureId: investmentCase.venture_id,
    workflowId: ids.workflowId,
    briefId: ids.briefId,
    candidateId: ids.candidateId,
    experimentId: ids.experimentId,
    cataloguePlanId: ids.planId,
    catalogueItemId: ids.itemId,
    buyer: spec.buyer,
    problem: spec.problem,
    offer: spec.offer,
    priceCents: spec.priceCents,
    channel: spec.channel,
    measurement: spec.measurement,
    providerPolicy: spec.providerPolicy,
    sample: spec.sample,
    sourceRecords: spec.sourceRecords,
    externalActionsAllowed: false,
    investmentCaseRemainsParked: true,
  };
  return { ...contract, contractHash: stableHash(contract) };
}

function assertFrozenContract(existing, contract, label) {
  if (!existing) return;
  const existingContract = existing.metadata?.buyerIntentValidation;
  if (!existingContract || existingContract.contractHash !== contract.contractHash) {
    throw new Error(`${label} already exists with a different buyer-intent contract.`);
  }
}

function opportunityRecord(db, investmentCase, spec) {
  const opportunity = parseRow(
    get(db, "SELECT * FROM opportunities WHERE id = ?", [investmentCase.opportunity_id]),
    ["evidence_ids", "metadata"],
  );
  if (!opportunity) throw new Error("The investment case no longer has its exact opportunity record.");
  if (opportunity.title !== spec.opportunityTitle) {
    throw new Error("The selected buyer-intent specification does not match this opportunity.");
  }
  return opportunity;
}

function ensureWorkflow(db, contract, investmentCase, spec) {
  const existing = parseRow(get(db, "SELECT * FROM workflows WHERE id = ?", [contract.workflowId]));
  assertFrozenContract(existing, contract, "Buyer-intent workflow");
  if (existing) return existing;
  const timestamp = now();
  run(
    db,
    `INSERT INTO workflows
     (id, venture_id, type, title, status, current_step, priority, quality_score,
      expected_profit_cents, cost_estimate_cents, approval_required, metadata, created_at, updated_at)
     VALUES (?, ?, 'buyer_intent_validation', ?, 'preparing', 'Prepare validation sample',
             2, 0, 0, ?, 1, ?, ?, ?)`,
    [
      contract.workflowId,
      investmentCase.venture_id,
      `Buyer-intent proof: ${spec.opportunityTitle}`,
      Number(spec.providerPolicy.combinedCapCents || 0),
      toJson({
        buyer: spec.buyer,
        problem: spec.problem,
        offer: spec.offer,
        channel: spec.channel.label,
        priceCents: spec.priceCents,
        buyerIntentValidation: contract,
      }),
      timestamp,
      timestamp,
    ],
  );
  return parseRow(get(db, "SELECT * FROM workflows WHERE id = ?", [contract.workflowId]));
}

function ensureBrief(db, contract, investmentCase, opportunity, spec) {
  const existing = parseRow(get(db, "SELECT * FROM commercial_briefs WHERE id = ?", [contract.briefId]));
  assertFrozenContract(existing, contract, "Buyer-intent brief");
  if (existing) return existing;
  const timestamp = now();
  run(
    db,
    `INSERT INTO commercial_briefs
     (id, workflow_id, venture_id, source, status, title, idea, buyer, problem,
      evidence_summary, research_basis, metadata, created_at, updated_at)
     VALUES (?, ?, ?, 'commercial_investment_review', 'exact_test_ready', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      contract.briefId,
      contract.workflowId,
      investmentCase.venture_id,
      `Buyer-intent proof for ${opportunity.title}`,
      opportunity.title,
      spec.buyer,
      spec.problem,
      `The investment case passed nine commercial gates but lacks direct willingness-to-pay, format acceptance, and reconciled all-in contribution evidence.`,
      `Frozen investment case ${investmentCase.id} at decision hash ${investmentCase.decision_hash}.`,
      toJson({
        dryRunOnly: true,
        noExternalAction: true,
        buyerIntentValidation: contract,
      }),
      timestamp,
      timestamp,
    ],
  );
  return parseRow(get(db, "SELECT * FROM commercial_briefs WHERE id = ?", [contract.briefId]));
}

function ensureCandidate(db, contract, investmentCase, spec) {
  const existing = parseRow(get(db, "SELECT * FROM commercial_test_candidates WHERE id = ?", [contract.candidateId]));
  assertFrozenContract(existing, contract, "Buyer-intent candidate");
  if (existing) return existing;
  const timestamp = now();
  run(
    db,
    `INSERT INTO commercial_test_candidates
     (id, brief_id, workflow_id, venture_id, rank, status, title, buyer, problem,
      offer, channel, price_cents, gross_margin_cents, cost_cap_cents, evidence_score,
      confidence, hypothesis, smallest_action, expected_metric, target_value,
      target_unit, success_metric, kill_criteria, risk, rationale,
      promoted_experiment_id, metadata, created_at, updated_at)
     VALUES (?, ?, ?, ?, 1, 'planned_test', ?, ?, ?, ?, ?, ?, 0, ?, 90, 'medium',
             ?, ?, ?, 3, 'independent paid orders', ?, ?, 'medium', ?, NULL, ?, ?, ?)`,
    [
      contract.candidateId,
      contract.briefId,
      contract.workflowId,
      investmentCase.venture_id,
      `One-listing buyer test: ${spec.sample.item.title}`,
      spec.buyer,
      spec.problem,
      spec.offer,
      spec.channel.label,
      spec.priceCents,
      Number(spec.channel.externalSpendCapCents || 0),
      `If ${spec.buyer} can inspect and buy the functional workbook at A$${(spec.priceCents / 100).toFixed(2)} through ${spec.channel.platformName || "the selected channel"}, the test should produce the exact paid-order and contribution signals defined in the frozen measurement contract.`,
      `Build and quality-check one functional sample, then prepare ${spec.channel.testActionLabel || spec.channel.label} without publishing it.`,
      spec.measurement.passRule,
      spec.measurement.passRule,
      spec.measurement.stopRule,
      `This is the smallest useful test that can close the investment case's willingness-to-pay, Excel-format, and all-in contribution gaps without building a speculative catalogue.`,
      toJson({
        dryRunOnly: true,
        unitEconomicsVerified: false,
        buyerIntentValidation: contract,
      }),
      timestamp,
      timestamp,
    ],
  );
  return parseRow(get(db, "SELECT * FROM commercial_test_candidates WHERE id = ?", [contract.candidateId]));
}

function ensureExperiment(db, contract, spec) {
  let experiment = getCommercialExperiment(db, contract.experimentId);
  assertFrozenContract(experiment, contract, "Buyer-intent experiment");
  if (!experiment) {
    experiment = createCommercialExperiment(db, {
      id: contract.experimentId,
      workflowId: contract.workflowId,
      ventureId: contract.ventureId,
      name: `Buyer-intent proof: ${spec.sample.item.title}`,
      status: "candidate",
      hypothesis: `If ${spec.buyer} can inspect and buy the functional workbook at A$${(spec.priceCents / 100).toFixed(2)} through ${spec.channel.platformName || "the selected channel"}, the exact test should produce paid orders while retaining positive actual contribution.`,
      buyer: spec.buyer,
      offer: spec.offer,
      channel: spec.channel.label,
      priceCents: spec.priceCents,
      expectedMetric: spec.measurement.passRule,
      targetValue: 3,
      targetUnit: "independent paid orders",
      costCapCents: spec.channel.externalSpendCapCents,
      metadata: {
        source: "commercial_investment_review",
        candidateId: contract.candidateId,
        briefId: contract.briefId,
        buyerIntentValidation: contract,
        dryRunOnly: true,
        realStartConfirmed: false,
      },
    });
  }
  return getCommercialExperiment(db, experiment.id);
}

function ensureCataloguePlan(db, contract, investmentCase, opportunity, spec) {
  const existingPlan = parseRow(
    get(db, "SELECT * FROM catalogue_plans WHERE id = ?", [contract.cataloguePlanId]),
    ["audience_segments", "channels", "geographies", "languages", "metadata"],
  );
  assertFrozenContract(existingPlan, contract, "Validation product plan");
  const timestamp = now();
  if (!existingPlan) {
    run(
      db,
      `INSERT INTO catalogue_plans
       (id, venture_id, opportunity_id, status, title, rationale, target_item_count,
        target_variant_count, audience_segments, channels, geographies, languages,
        price_floor_cents, price_ceiling_cents, estimated_build_cost_cents,
        estimated_unit_cost_cents, metadata, created_at, updated_at)
       VALUES (?, ?, ?, 'planned', ?, ?, 1, 0, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
      [
        contract.cataloguePlanId,
        investmentCase.venture_id,
        opportunity.id,
        spec.sample.packageTitle,
        "Build one usable validation product to test willingness to pay and format acceptance before a wider catalogue is authorised.",
        toJson([spec.buyer]),
        toJson([spec.channel.label]),
        toJson([opportunity.geography || "Australia"]),
        toJson([opportunity.language || "English"]),
        spec.priceCents,
        spec.priceCents,
        Number(spec.providerPolicy.combinedCapCents || 0),
        toJson({
          productManifest: {
            packageTitle: spec.sample.packageTitle,
            customerPromise: spec.sample.customerPromise,
          },
          validationSample: contract,
          buyerIntentValidation: contract,
          noFullCatalogueAuthorised: true,
          noSellableFilesClaimed: true,
        }),
        timestamp,
        timestamp,
      ],
    );
  }
  const existingItem = parseRow(get(db, "SELECT * FROM catalogue_items WHERE id = ?", [contract.catalogueItemId]));
  assertFrozenContract(existingItem, contract, "Validation product item");
  if (!existingItem) {
    run(
      db,
      `INSERT INTO catalogue_items
       (id, plan_id, venture_id, parent_item_id, status, quality_status, title,
        product_type, audience, geography, language, offer, price_cents,
        deliverable_id, metadata, created_at, updated_at)
       VALUES (?, ?, ?, NULL, 'planned', 'not_reviewed', ?, 'functional_template',
               ?, ?, ?, ?, ?, NULL, ?, ?, ?)`,
      [
        contract.catalogueItemId,
        contract.cataloguePlanId,
        investmentCase.venture_id,
        spec.sample.item.title,
        spec.buyer,
        opportunity.geography || "Australia",
        opportunity.language || "English",
        spec.sample.item.purpose,
        spec.priceCents,
        toJson({
          blueprint: spec.sample.item,
          buyerIntentValidation: contract,
        }),
        timestamp,
        timestamp,
      ],
    );
  }
  return parseRow(
    get(db, "SELECT * FROM catalogue_plans WHERE id = ?", [contract.cataloguePlanId]),
    ["audience_segments", "channels", "geographies", "languages", "metadata"],
  );
}

function runningUnderNodeTest() {
  return Boolean(process.env.NODE_TEST_CONTEXT)
    || process.execArgv.some((argument) => (
      argument === "--test" || argument.startsWith("--test-")
    ));
}

function prepareBuyerIntentValidationRecordsOperation(
  db,
  caseId,
  input = {},
  terminalFixtureCapability = null,
) {
  const spec = getBuyerIntentValidationSpec(input.specId);
  if (
    !spec
    || (
      !buyerIntentValidationSpecIsActive(spec.id)
      && TERMINAL_FIXTURE_CAPABILITIES.get(terminalFixtureCapability) !== db
    )
  ) {
    const error = new Error("This buyer-intent validation specification is permanently stopped and cannot be prepared again.");
    error.statusCode = 410;
    throw error;
  }
  const investmentCase = getInvestmentCase(db, caseId);
  if (!investmentCase) throw new Error(`Investment case not found: ${caseId}`);
  if (!input.expectedDecisionHash) throw new Error("The expected investment-case hash is required.");
  if (input.expectedDecisionHash !== investmentCase.decision_hash) {
    throw new Error("The investment case changed. Review the current evidence before preparing this test.");
  }
  if (spec.decisionHash !== investmentCase.decision_hash) {
    throw new Error("This buyer-intent specification is not bound to the current investment case.");
  }
  if (!["research_more", "park"].includes(investmentCase.recommendation)) {
    throw new Error("This path is reserved for a parked case with one exact buyer-evidence gap.");
  }

  const opportunity = opportunityRecord(db, investmentCase, spec);
  const ids = exactIds(spec, investmentCase);
  const contract = validationContract(spec, investmentCase, ids);
  const savepoint = `buyer_intent_${stableIdSegment(spec.id, 32, "validation")}`;
  db.exec(`SAVEPOINT ${savepoint}`);
  try {
    ensureWorkflow(db, contract, investmentCase, spec);
    const brief = ensureBrief(db, contract, investmentCase, opportunity, spec);
    const candidate = ensureCandidate(db, contract, investmentCase, spec);
    const experiment = ensureExperiment(db, contract, spec);
    const plan = ensureCataloguePlan(db, contract, investmentCase, opportunity, spec);
    run(
      db,
      `UPDATE workflows
       SET status = 'waiting_for_operator', current_step = 'Review validation product build',
           approval_required = 1, updated_at = ?
       WHERE id = ?`,
      [now(), contract.workflowId],
    );
    insertEvent(db, {
      actor: "commercial-engine",
      type: "buyer_intent.prepared",
      entityType: "commercial_decision_case",
      entityId: investmentCase.id,
      message: "One evidence-bound buyer-intent test was prepared without advancing the parked investment case.",
      metadata: {
        specId: spec.id,
        contractHash: contract.contractHash,
        opportunityId: opportunity.id,
        experimentId: experiment.id,
        cataloguePlanId: plan.id,
        externalActionsAllowed: false,
      },
    });
    db.exec(`RELEASE SAVEPOINT ${savepoint}`);
    return {
      schema: BUYER_INTENT_CONTRACT_SCHEMA,
      prepared: true,
      investmentCase,
      opportunity,
      workflow: parseRow(get(db, "SELECT * FROM workflows WHERE id = ?", [contract.workflowId])),
      brief,
      candidate,
      experiment,
      plan,
      contract,
    };
  } catch (error) {
    db.exec(`ROLLBACK TO SAVEPOINT ${savepoint}`);
    db.exec(`RELEASE SAVEPOINT ${savepoint}`);
    throw error;
  }
}

function prepareBuyerIntentValidationRecords(db, caseId, input = {}) {
  void db;
  void caseId;
  void input;
  throw legacyBuyerIntentPathRetired("buyer_intent_validation_preparation");
}

function prepareBuyerIntentValidationRecordsForTest(db, caseId, input = {}) {
  if (!CONFIG.dryRun || !runningUnderNodeTest()) {
    throw new Error("Terminal buyer-intent fixtures are available only in the isolated dry-run test harness.");
  }
  const capability = Object.freeze({});
  TERMINAL_FIXTURE_CAPABILITIES.set(capability, db);
  try {
    return prepareBuyerIntentValidationRecordsOperation(
      db,
      caseId,
      input,
      capability,
    );
  } finally {
    TERMINAL_FIXTURE_CAPABILITIES.delete(capability);
  }
}

function finalizedValidation(db, plan) {
  const executionPackId = plan?.metadata?.validationExecutionPackId;
  if (!executionPackId) return null;
  const pack = getExecutionPack(db, executionPackId);
  return pack ? { pack, alreadyFinalized: true } : null;
}

function completedProductionTask(db, taskId, expected = {}) {
  const task = parseRow(
    get(db, "SELECT * FROM tasks WHERE id = ?", [taskId]),
    ["payload", "result"],
  );
  const production = task?.payload?.liveSpendRequest?.parameters?.pantheonProduction || {};
  if (
    !task
    || task.status !== "completed"
    || task.outcome_status !== "known"
    || task.agent !== expected.agent
    || task.workflow_id !== expected.workflowId
    || task.venture_id !== expected.ventureId
    || production.planId !== expected.planId
    || production.stage !== expected.stage
  ) {
    throw new Error(
      `The exact ${expected.label} task is not a completed, known, correctly scoped live-worker record.`,
    );
  }
  return { task, production };
}

function materialQualityFinding(value) {
  const finding = String(value || "").trim();
  if (!finding) return false;
  const materialPattern = /\b(?:high[- ]risk|major|material(?:ly)?|critical|severe|unsafe|illegal|misleading|unsupported|inaccurate|incorrect|broken|unusable|unreliable|untrustworthy|illegible|not legible|not complete|incomplete|clipp\w*|overflow\w*|formula error|wrong result|data loss|does not work|cannot be used|cannot be trusted|cannot be relied upon|does not reconcile|fail\w* to reconcile|overstat\w*|exaggerat\w*|deceptive|corrupt\w*)\b/gi;
  let match = materialPattern.exec(finding);
  while (match) {
    const phrase = match[0].toLowerCase();
    if (/^(?:not legible|not complete|does not work|cannot be used)$/.test(phrase)) return true;
    const prefix = finding.slice(Math.max(0, match.index - 48), match.index);
    const explicitlyAbsent = /\b(?:no|without|not)\s+(?:(?:known|remaining|material|major|credible|identified)\s+){0,3}$/i.test(
      prefix,
    );
    if (!explicitlyAbsent) return true;
    match = materialPattern.exec(finding);
  }
  return false;
}

function qualityVerdictPassed(task) {
  const output = task.result?.output || {};
  const roleOutput = output.roleOutput || {};
  const score = Number(roleOutput.qualityScore || 0);
  const decision = String(output.operatorDecision || "");
  const riskFindings = Array.isArray(roleOutput.riskFindings)
    ? roleOutput.riskFindings.map(String).filter((finding) => finding.trim())
    : null;
  const missingEvidence = Array.isArray(roleOutput.missingEvidence)
    ? roleOutput.missingEvidence
    : null;
  const claimSafety = String(roleOutput.claimSafety || "").trim();
  const claimSafetyPassed = claimSafetyIsConfirmed(claimSafety)
    && !materialQualityFinding(claimSafety);
  const outputRisks = Array.isArray(output.risks) ? output.risks : [];
  const highRisk = outputRisks.some((risk) => materialQualityFinding(risk));
  const materialRiskFinding = (riskFindings || []).some((risk) => materialQualityFinding(risk));
  return (
    score >= 80
    && decision === "approve"
    && Array.isArray(riskFindings)
    && Array.isArray(missingEvidence)
    && missingEvidence.length === 0
    && claimSafetyPassed
    && !materialRiskFinding
    && !highRisk
  );
}

function resolveVerifiedArtifact(filePath) {
  if (!filePath) return null;
  const candidate = path.isAbsolute(filePath)
    ? path.resolve(filePath)
    : path.resolve(CONFIG.rootDir, filePath);
  const artifactRoot = path.resolve(CONFIG.artifactRoot);
  const relative = path.relative(artifactRoot, candidate);
  if (relative.startsWith("..") || path.isAbsolute(relative)) return null;
  return candidate;
}

function verifiedSampleDeliverables(db, plan, buildTask, generated) {
  const supplied = [
    ...(generated.files || []).filter((file) => file.manifest !== true),
    ...(generated.previews || []),
  ];
  const seen = new Set();
  return supplied.map((file) => {
    if (!file?.id || seen.has(file.id)) {
      throw new Error("The customer package contains a missing or duplicate deliverable identity.");
    }
    seen.add(file.id);
    const record = get(
      db,
      `SELECT id, workflow_id, task_id, venture_id, human_name, format, status,
              file_path, content_hash, metadata
       FROM deliverables
       WHERE id = ?`,
      [file.id],
    );
    const metadata = fromJson(record?.metadata, {});
    const expectedHash = String(file.sha256 || "");
    const recordedHash = String(record?.content_hash || metadata.sha256 || "");
    const artifactPath = resolveVerifiedArtifact(record?.file_path);
    if (
      !record
      || record.workflow_id !== buildTask.workflow_id
      || record.task_id !== buildTask.id
      || record.venture_id !== plan.venture_id
      || record.status !== "quality_passed"
      || !expectedHash
      || recordedHash !== expectedHash
      || !artifactPath
      || !fs.existsSync(artifactPath)
      || !fs.statSync(artifactPath).isFile()
    ) {
      throw new Error("A buyer-test file is not the exact quality-passed artifact bound to this build.");
    }
    const bytes = fs.readFileSync(artifactPath);
    const actualHash = crypto.createHash("sha256").update(bytes).digest("hex");
    if (actualHash !== expectedHash) {
      throw new Error("A buyer-test file changed after quality review.");
    }
    return {
      id: record.id,
      name: record.human_name || file.humanName || file.name || "Product file",
      format: record.format,
      bytes: bytes.length,
      sha256: actualHash,
    };
  });
}

function finalizeBuyerIntentValidationSampleOperation(db, input = {}) {
  const plan = parseRow(
    get(db, "SELECT * FROM catalogue_plans WHERE id = ?", [input.planId]),
    ["audience_segments", "channels", "geographies", "languages", "metadata"],
  );
  if (!plan?.metadata?.validationSample) {
    throw new Error("This catalogue plan is not an evidence-bound buyer-intent sample.");
  }
  const prior = finalizedValidation(db, plan);
  if (prior) return prior;
  const contract = plan.metadata.validationSample;
  const experiment = getCommercialExperiment(db, contract.experimentId);
  if (!experiment) throw new Error("The buyer-intent experiment no longer exists.");
  const { task: buildTask } = completedProductionTask(db, input.buildTaskId, {
    agent: "product_builder",
    workflowId: contract.workflowId,
    ventureId: contract.ventureId,
    planId: plan.id,
    stage: "product_build",
    label: "Product Builder",
  });
  const { task: qualityTask, production: qualityProduction } = completedProductionTask(
    db,
    input.qualityTaskId,
    {
      agent: "quality_reviewer",
      workflowId: contract.workflowId,
      ventureId: contract.ventureId,
      planId: plan.id,
      stage: "quality_review",
      label: "Quality Reviewer",
    },
  );
  const reviewOfTaskId = qualityTask.payload?.liveSpendRequest?.parameters?.reviewOfTaskId;
  if (
    reviewOfTaskId !== buildTask.id
    || qualityProduction.buildTaskId !== buildTask.id
    || !qualityVerdictPassed(qualityTask)
  ) {
    throw new Error("The Quality Reviewer did not pass the exact Product Builder output.");
  }
  const generated = buildTask.result?.output?.generatedFiles;
  if (!generated?.manifest || !Array.isArray(generated.files) || generated.files.length < 2) {
    throw new Error("The buyer test cannot proceed without the validated customer package.");
  }
  if (
    String(generated.manifest.planId || "") !== plan.id
    || String(generated.manifest.opportunityId || "") !== plan.opportunity_id
  ) {
    throw new Error("The persisted product manifest does not match this buyer-intent plan.");
  }
  const sampleDeliverables = verifiedSampleDeliverables(db, plan, buildTask, generated);
  const packResult = generateExecutionPack(db, {
    experimentId: experiment.id,
    title: `Buyer test pack: ${experiment.name}`,
    source: "quality_passed_validation_sample",
    metadata: {
      buyerIntentValidation: contract,
      sampleDeliverables,
      actualWorkerTasks: {
        productBuilder: buildTask.id,
        qualityReviewer: qualityTask.id,
      },
    },
  });
  const timestamp = now();
  run(
    db,
    `UPDATE commercial_experiments
     SET status = 'ready', updated_at = ?
     WHERE id = ? AND status = 'candidate'`,
    [timestamp, experiment.id],
  );
  run(
    db,
    `UPDATE commercial_test_candidates
     SET status = 'promoted', promoted_experiment_id = ?, updated_at = ?
     WHERE id = ? AND status IN ('candidate', 'planned_test')`,
    [experiment.id, timestamp, contract.candidateId],
  );
  run(
    db,
    `UPDATE catalogue_plans
     SET status = 'validation_sample_ready',
         metadata = json_set(
           metadata,
           '$.validationExecutionPackId', ?,
           '$.validationBuildTaskId', ?,
           '$.validationQualityTaskId', ?,
           '$.validationSampleDeliverables', json(?),
           '$.noSellableFilesClaimed', json('false')
         ),
         updated_at = ?
     WHERE id = ?`,
    [
      packResult.pack.id,
      buildTask.id,
      qualityTask.id,
      JSON.stringify(sampleDeliverables),
      timestamp,
      plan.id,
    ],
  );
  run(
    db,
    `UPDATE workflows
     SET status = 'blocked', current_step = 'Review buyer test',
         approval_required = 1, updated_at = ?
     WHERE id = ?`,
    [timestamp, contract.workflowId],
  );
  insertEvent(db, {
    actor: "pantheon",
    type: "buyer_intent.sample_ready",
    entityType: "commercial_execution_pack",
    entityId: packResult.pack.id,
    message: "The functional validation sample passed quality review and its exact buyer test is ready for operator review.",
    metadata: {
      planId: plan.id,
      experimentId: experiment.id,
      buildTaskId: buildTask.id,
      qualityTaskId: qualityTask.id,
      sampleDeliverableIds: sampleDeliverables.map((file) => file.id),
      externalActionsAllowed: false,
      investmentCaseRemainsParked: true,
    },
  });
  return {
    pack: getExecutionPack(db, packResult.pack.id),
    alreadyFinalized: false,
    sampleDeliverables,
  };
}

function finalizeBuyerIntentValidationSample(db, input = {}) {
  void db;
  void input;
  throw legacyBuyerIntentPathRetired("buyer_intent_validation_finalization");
}

function finalizeBuyerIntentValidationSampleForTest(db, input = {}) {
  if (!CONFIG.dryRun || !runningUnderNodeTest()) {
    throw new Error("Terminal buyer-intent fixtures are available only in the isolated dry-run test harness.");
  }
  const savepoint = `finalize_buyer_intent_${crypto.randomBytes(6).toString("hex")}`;
  db.exec(`SAVEPOINT ${savepoint}`);
  try {
    const result = finalizeBuyerIntentValidationSampleOperation(db, input);
    db.exec(`RELEASE SAVEPOINT ${savepoint}`);
    return result;
  } catch (error) {
    db.exec(`ROLLBACK TO SAVEPOINT ${savepoint}`);
    db.exec(`RELEASE SAVEPOINT ${savepoint}`);
    throw error;
  }
}

module.exports = {
  BUYER_INTENT_CONTRACT_SCHEMA,
  LEGACY_BUYER_INTENT_PATH_RETIRED_CODE,
  finalizeBuyerIntentValidationSample,
  finalizeBuyerIntentValidationSampleForTest,
  prepareBuyerIntentValidationRecords,
  prepareBuyerIntentValidationRecordsForTest,
};
