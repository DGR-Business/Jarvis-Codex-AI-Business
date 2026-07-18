const fs = require("node:fs");
const path = require("node:path");
const CONFIG = require("../config");
const { all, fromJson, get, insertEvent, now, randomId, run, toJson } = require("../db");
const { recordProtectedWorkerOutcome } = require("./ai-team");
const { generateApprovalPack } = require("./approval-pack");
const { createCommercialExperiment } = require("./commercial-results");
const { requestLiveAiWorker } = require("./live-ai-workers");

const PRODUCT_BUILD_SPEC_SCHEMA = "pantheon.product-build-spec.v1";
const PRODUCT_MANIFEST_SCHEMA = "pantheon.product-manifest.v1";
const PRODUCTION_STAGES = new Set([
  "product_build",
  "quality_review",
  "conversion_copy",
  "distribution_plan",
]);

function safeId(value, max = 64) {
  return String(value || "pantheon")
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .slice(0, max) || "pantheon";
}

function slug(value, max = 54) {
  return String(value || "pantheon")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max) || "pantheon";
}

function parseRow(row, jsonFields = ["metadata"]) {
  if (!row) return null;
  const parsed = { ...row };
  for (const field of jsonFields) parsed[field] = fromJson(row[field], field.endsWith("s") ? [] : {});
  return parsed;
}

function productMetadata(task) {
  return fromJson(task?.payload, {})?.liveSpendRequest?.parameters?.pantheonProduction || null;
}

function taskOutput(task) {
  return fromJson(task?.result, {})?.output || {};
}

function cataloguePlan(db, planId) {
  return parseRow(
    get(db, "SELECT * FROM catalogue_plans WHERE id = ?", [planId]),
    ["audience_segments", "channels", "geographies", "languages", "metadata"],
  );
}

function catalogueItems(db, planId) {
  return all(
    db,
    "SELECT * FROM catalogue_items WHERE plan_id = ? ORDER BY created_at ASC, id ASC",
    [planId],
  ).map((row) => parseRow(row));
}

function opportunity(db, opportunityId) {
  return parseRow(
    get(db, "SELECT * FROM opportunities WHERE id = ?", [opportunityId]),
    ["evidence_ids", "metadata"],
  );
}

function roundForPlan(db, plan) {
  return parseRow(get(
    db,
    `SELECT opportunity_rounds.*
     FROM opportunity_rounds
     JOIN opportunities ON opportunities.round_id = opportunity_rounds.id
     WHERE opportunities.id = ?`,
    [plan.opportunity_id],
  ));
}

function buildProfile(opportunityRecord) {
  const descriptor = `${opportunityRecord.business_model} ${opportunityRecord.offer_direction}`.toLowerCase();
  if (/(template|spreadsheet|excel|tracker|calculator|planner|worksheet)/.test(descriptor)) {
    return {
      id: "functional_template_bundle",
      supported: true,
      productFormats: ["xlsx", "pdf", "csv", "zip"],
      qualityBar: "Every workbook must open, contain usable sample data or formulas where relevant, and include a plain-English setup guide.",
    };
  }
  if (/(course|guide|protocol|routine|plan|ebook|digital product|download)/.test(descriptor)) {
    return {
      id: "guide_and_workbook_bundle",
      supported: true,
      productFormats: ["pdf", "xlsx", "csv", "zip"],
      qualityBar: "Every guide must be complete, practical, internally consistent, and paired with usable worksheets or checklists where relevant.",
    };
  }
  if (/(affiliate|pinterest|content)/.test(descriptor)) {
    return {
      id: "affiliate_content_system",
      supported: true,
      productFormats: ["xlsx", "csv", "pdf", "zip"],
      qualityBar: "The package must contain a usable research tracker, content calendar, claim-checking checklist, and measurement workbook; it is an operating asset, not proof of an affiliate account or traffic.",
    };
  }
  if (/(print on demand|\bpod\b|art|shirt|poster|print)/.test(descriptor)) {
    return {
      id: "visual_catalogue_requires_image_pipeline",
      supported: false,
      productFormats: ["png", "pdf", "zip"],
      qualityBar: "A credible visual collection requires the separately approved image-generation and print-specification pipeline.",
    };
  }
  if (/(amazon|white label|physical|supplier)/.test(descriptor)) {
    return {
      id: "physical_product_requires_supplier_pipeline",
      supported: false,
      productFormats: ["xlsx", "pdf"],
      qualityBar: "A physical-product venture requires supplier, samples, compliance, landed-cost, and account actions before it can be called production-ready.",
    };
  }
  return {
    id: "general_digital_bundle",
    supported: true,
    productFormats: ["pdf", "xlsx", "csv", "zip"],
    qualityBar: "Every catalogue item must contain a complete, usable customer file and a short setup guide. Planning notes and placeholders do not count.",
  };
}

function buildSpec(plan, opportunityRecord, items, options = {}) {
  const profile = buildProfile(opportunityRecord);
  return {
    schema: PRODUCT_BUILD_SPEC_SCHEMA,
    planId: plan.id,
    opportunityId: opportunityRecord.id,
    ventureId: plan.venture_id,
    profile: profile.id,
    supportedByCurrentFactory: profile.supported,
    buyer: opportunityRecord.buyer,
    problem: opportunityRecord.problem,
    offerDirection: opportunityRecord.offer_direction,
    channel: opportunityRecord.channel,
    geography: opportunityRecord.geography,
    language: opportunityRecord.language,
    qualityBar: profile.qualityBar,
    allowedFormats: profile.productFormats,
    catalogueItems: items.map((item) => ({
      id: item.id,
      title: item.title,
      audience: item.audience,
      offer: item.offer,
      priceCents: Number(item.price_cents || 0),
    })),
    manifestFilename: "pantheon-product-manifest.json",
    bundleFilename: `${slug(opportunityRecord.title)}-catalogue.zip`,
    minimumReturnedFiles: 2,
    revisionNumber: Number(options.revisionNumber || 0),
    revisionFeedback: String(options.revisionFeedback || ""),
    externalActionsAllowed: false,
    publishingAllowed: false,
  };
}

function existingProductionTask(db, planId, stage, revisionNumber = null) {
  const rows = all(
    db,
    `SELECT * FROM tasks
     WHERE kind = 'live_ai_worker_execution'
       AND json_extract(payload, '$.liveSpendRequest.parameters.pantheonProduction.planId') = ?
       AND json_extract(payload, '$.liveSpendRequest.parameters.pantheonProduction.stage') = ?
     ORDER BY created_at DESC`,
    [planId, stage],
  );
  const match = revisionNumber === null
    ? rows[0]
    : rows.find((row) => Number(productMetadata(row)?.revisionNumber || 0) === Number(revisionNumber));
  return match ? parseRow(match, ["payload", "result"]) : null;
}

function updatePlan(db, planId, patch = {}) {
  const plan = cataloguePlan(db, planId);
  if (!plan) throw new Error(`Catalogue plan not found: ${planId}`);
  const metadata = { ...plan.metadata, ...(patch.metadata || {}) };
  run(
    db,
    `UPDATE catalogue_plans
     SET status = ?, metadata = ?, updated_at = ?
     WHERE id = ?`,
    [patch.status || plan.status, toJson(metadata), now(), planId],
  );
  return cataloguePlan(db, planId);
}

function prepareCatalogueBuild(db, input = {}) {
  const plan = cataloguePlan(db, input.planId);
  if (!plan) throw new Error(`Catalogue plan not found: ${input.planId}`);
  const opportunityRecord = opportunity(db, input.opportunityId || plan.opportunity_id);
  if (!opportunityRecord || opportunityRecord.id !== plan.opportunity_id) {
    throw new Error("Catalogue build must match the exact approved opportunity.");
  }
  const items = catalogueItems(db, plan.id);
  if (!items.length || items.length !== Number(plan.target_item_count)) {
    throw new Error("Catalogue build is blocked until every planned item has an exact specification.");
  }
  const spec = buildSpec(plan, opportunityRecord, items, input);
  if (!spec.supportedByCurrentFactory) {
    updatePlan(db, plan.id, {
      status: "requires_capability",
      metadata: {
        buildStatus: "requires_capability",
        productionProfile: spec.profile,
        capabilityBlocker: spec.qualityBar,
      },
    });
    insertEvent(db, {
      level: "warn",
      actor: "pantheon",
      type: "catalogue.build_capability_missing",
      entityType: "catalogue_plan",
      entityId: plan.id,
      message: "Pantheon stopped before claiming it could produce this catalogue with the current product factory.",
      metadata: { profile: spec.profile, opportunityId: opportunityRecord.id },
    });
    return { status: "requires_capability", spec, task: null, approval: null };
  }
  const revisionNumber = Number(input.revisionNumber || 0);
  const existing = existingProductionTask(db, plan.id, "product_build", revisionNumber);
  if (existing) {
    return {
      status: existing.status,
      spec,
      task: existing,
      approval: existing.approval_id ? get(db, "SELECT * FROM approvals WHERE id = ?", [existing.approval_id]) : null,
      existing: true,
    };
  }
  const round = roundForPlan(db, plan);
  const operatorChoiceRequired = input.operatorChoiceRequired !== false;
  const request = requestLiveAiWorker(db, round.metadata.workflowId, {
    requestKey: `catalogue_build_${safeId(plan.id)}_r${revisionNumber}`,
    requestedBy: operatorChoiceRequired ? "chief_of_staff" : "pantheon_quality_recovery",
    worker: "product_builder",
    taskTitle: revisionNumber
      ? `Correct and rebuild ${plan.title}`
      : `Build ${plan.title}`,
    approvalTitle: revisionNumber
      ? `Correct the ${plan.title} product files`
      : `Build and quality-check the ${items.length}-product catalogue`,
    estimatedCostCents: 800,
    reason: operatorChoiceRequired
      ? `Create the exact ${items.length}-item local product catalogue that Daniel reviewed. Nothing will be published, sent, or uploaded to a marketplace.`
      : "Correct the exact local product package after Pantheon's Quality Reviewer found a material defect. Nothing will be published or sent.",
    expectedOutput: `A real downloadable ${spec.bundleFilename}, ${spec.manifestFilename}, and a structured production summary. Planning prose without files is a failed build.`,
    expectedMetric: `Pantheon downloads, hashes, validates, and maps usable product files to all ${items.length} approved catalogue items.`,
    model: CONFIG.terraModel,
    maxInputTokens: 16000,
    maxOutputTokens: 2600,
    maxTurns: 8,
    maxToolCalls: 8,
    deadlineMs: 300000,
    tools: ["product_file_factory"],
    toolArguments: {
      product_file_factory: {
        memoryLimit: "1g",
      },
    },
    businessContext: {
      subject: opportunityRecord.title,
      buyer: opportunityRecord.buyer,
      problem: opportunityRecord.problem,
      offer: opportunityRecord.offer_direction,
      channel: opportunityRecord.channel,
      evidenceStandard: "Use the approved opportunity, economics, offer, and catalogue records. Do not invent buyer proof or public claims.",
    },
    workBrief: {
      objective: `Use the python tool to build the complete ${items.length}-item product catalogue described by the exact productBuildSpec.`,
      deliverable: `Return ${spec.bundleFilename} and ${spec.manifestFilename}. Cite both files in the final response so Pantheon can download them before the container expires.`,
      assetPrompt: [
        `The manifest must use schema ${PRODUCT_MANIFEST_SCHEMA} and exactly match planId ${plan.id} and opportunityId ${opportunityRecord.id}.`,
        "Its catalogueItems array must contain every exact catalogue item id. Each item must list the real customer-facing files that exist inside the returned bundle.",
        "Create complete customer-usable files, not outlines, lorem ipsum, TODO markers, empty worksheets, or claims that work was done elsewhere.",
        revisionNumber ? `Correct these review findings: ${String(input.revisionFeedback || "Rebuild the defective package.").slice(0, 1000)}` : "",
      ].filter(Boolean).join(" "),
      constraints: [
        "No internet, publishing, customer contact, account action, legal decision, or money movement.",
        "Do not include executables, scripts, macros, credentials, personal data, or external tracking.",
        "Use ordinary customer-facing language and clearly label assumptions or educational limitations.",
      ],
      acceptanceCriteria: [
        `All ${items.length} exact catalogue item IDs appear once in the manifest.`,
        "Every item maps to at least one real file in the bundle.",
        "Files open cleanly and include practical instructions or examples where useful.",
        "The final response names and cites the manifest and bundle.",
      ],
    },
    parameters: {
      operatorChoiceRequired,
      productBuildSpec: spec,
      pantheonProduction: {
        supervisorOwned: true,
        stage: "product_build",
        roundId: round.id,
        opportunityId: opportunityRecord.id,
        planId: plan.id,
        revisionNumber,
        operatorChoiceRequired,
      },
    },
    effects: [],
  });
  updatePlan(db, plan.id, {
    status: operatorChoiceRequired ? "waiting_for_build_decision" : "rebuilding",
    metadata: {
      buildStatus: operatorChoiceRequired ? "waiting_for_build_decision" : "rebuilding",
      productionProfile: spec.profile,
      buildTaskId: request.task?.id || null,
      buildApprovalId: request.approval?.id || null,
      buildRevision: revisionNumber,
      noSellableFilesClaimed: true,
    },
  });
  return { ...request, spec, existing: false };
}

function generatedProductResult(task) {
  const generated = taskOutput(task).generatedFiles;
  if (!generated || !Array.isArray(generated.files) || !generated.manifest) {
    throw new Error("A completed Product Builder task has no validated local product-file package.");
  }
  return generated;
}

function queueQualityReview(db, plan, opportunityRecord, buildTask, generated) {
  const existing = existingProductionTask(db, plan.id, "quality_review");
  if (existing) return { task: existing, existing: true };
  const files = generated.files.map((file) => ({
    id: file.id,
    name: file.humanName,
    format: file.format,
    bytes: file.bytes,
    sha256: file.sha256,
  }));
  return requestLiveAiWorker(db, buildTask.workflow_id, {
    requestKey: `catalogue_quality_${safeId(plan.id)}_r${Number(productMetadata(buildTask)?.revisionNumber || 0)}`,
    requestedBy: "pantheon_supervisor",
    worker: "quality_reviewer",
    taskTitle: `Review the finished product package for ${opportunityRecord.title}`,
    approvalTitle: `Run the product quality review for ${opportunityRecord.title}`,
    estimatedCostCents: 200,
    reason: "Independently check the exact locally stored product package before any launch preparation.",
    expectedOutput: "A clear pass, revise, or stop verdict with quality score, file coverage, usability risks, unsupported claims, and exact corrections.",
    expectedMetric: "All catalogue items are covered, deterministic file validation passed, and semantic review scores at least 80/100 with no unresolved high-risk finding.",
    model: CONFIG.terraModel,
    maxInputTokens: 12000,
    maxOutputTokens: 1600,
    maxTurns: 1,
    maxToolCalls: 0,
    tools: [],
    businessContext: {
      subject: opportunityRecord.title,
      buyer: opportunityRecord.buyer,
      problem: opportunityRecord.problem,
      offer: opportunityRecord.offer_direction,
      channel: opportunityRecord.channel,
      evidenceStandard: "Treat local file hashes and manifest coverage as proven; do not claim unseen binary content was manually inspected.",
    },
    workBrief: {
      objective: "Review the exact product manifest, deterministic file checks, commercial promise, claim safety, usability, and catalogue completeness.",
      deliverable: "A decision-quality review that clearly distinguishes verified file facts from semantic judgements and remaining inspection limits.",
      assetPrompt: JSON.stringify({
        manifest: generated.manifest,
        files,
        buildSummary: taskOutput(buildTask).summary || "",
        builderWork: taskOutput(buildTask).roleOutput || {},
      }),
      constraints: [
        "Fail the package if any catalogue item lacks a real file.",
        "Do not approve unsupported legal, financial, medical, fitness, income, or performance claims.",
        "State any visual or formula inspection limitation honestly.",
      ],
      acceptanceCriteria: [
        "Quality score is reasoned rather than cosmetic.",
        "Material defects identify an exact correction.",
        "Approval means ready for launch preparation, not already published or sold.",
      ],
    },
    parameters: {
      reviewOfTaskId: buildTask.id,
      pantheonProduction: {
        supervisorOwned: true,
        stage: "quality_review",
        roundId: productMetadata(buildTask).roundId,
        opportunityId: opportunityRecord.id,
        planId: plan.id,
        buildTaskId: buildTask.id,
        revisionNumber: Number(productMetadata(buildTask)?.revisionNumber || 0),
      },
    },
    effects: [],
  });
}

function mapManifestToItems(db, plan, generated) {
  const bundle = generated.files.find((file) => /\.zip$/i.test(file.humanName))
    || generated.files.find((file) => !file.manifest);
  if (!bundle) throw new Error("The validated product package has no customer-facing bundle.");
  for (const manifestItem of generated.manifest.catalogueItems) {
    const itemId = String(manifestItem.id || manifestItem.catalogueItemId || "");
    const item = get(db, "SELECT id, metadata FROM catalogue_items WHERE id = ? AND plan_id = ?", [itemId, plan.id]);
    if (!item) throw new Error(`Product manifest references an unknown catalogue item: ${itemId}.`);
    run(
      db,
      `UPDATE catalogue_items
       SET status = 'built', quality_status = 'pending_review', deliverable_id = ?,
           metadata = ?, updated_at = ?
       WHERE id = ?`,
      [
        bundle.id,
        toJson({
          ...fromJson(item.metadata, {}),
          productFiles: manifestItem.files || [],
          buildDeliverableId: bundle.id,
          buildManifestVersion: generated.manifest.version || 1,
        }),
        now(),
        itemId,
      ],
    );
  }
  return bundle;
}

function projectProductBuild(db, task, plan, opportunityRecord) {
  const generated = generatedProductResult(task);
  const bundle = mapManifestToItems(db, plan, generated);
  const revisionNumber = Number(productMetadata(task)?.revisionNumber || 0);
  updatePlan(db, plan.id, {
    status: "quality_review",
    metadata: {
      buildStatus: "built_pending_quality_review",
      buildTaskId: task.id,
      buildRevision: revisionNumber,
      generatedFileIds: generated.files.map((file) => file.id),
      productManifest: generated.manifest,
      productBundleDeliverableId: bundle.id,
      noSellableFilesClaimed: false,
    },
  });
  const review = queueQualityReview(db, cataloguePlan(db, plan.id), opportunityRecord, task, generated);
  insertEvent(db, {
    actor: "pantheon",
    type: "catalogue.files_built",
    entityType: "catalogue_plan",
    entityId: plan.id,
    message: `Pantheon stored and validated ${generated.files.length} product-package files; independent quality review is next.`,
    metadata: { taskId: task.id, bundleId: bundle.id, revisionNumber },
  });
  return { next: review, bundle, generated };
}

function qualityPassed(output) {
  const work = output.roleOutput || {};
  const score = Number(work.qualityScore || 0);
  const decision = String(output.operatorDecision || "");
  const highRisk = (output.risks || []).some((risk) => /\b(high risk|unsafe|illegal|materially false)\b/i.test(String(risk)));
  return {
    passed: score >= 80 && decision === "approve" && !highRisk,
    score,
    highRisk,
    decision,
    findings: [
      ...(work.riskFindings || []),
      ...(work.missingEvidence || []),
      ...(output.risks || []),
    ].filter(Boolean),
  };
}

function queueConversionCopy(db, plan, opportunityRecord, qualityTask) {
  const existing = existingProductionTask(db, plan.id, "conversion_copy");
  if (existing) return { task: existing, existing: true };
  return requestLiveAiWorker(db, qualityTask.workflow_id, {
    requestKey: `catalogue_copy_${safeId(plan.id)}`,
    requestedBy: "pantheon_supervisor",
    worker: "copy_conversion_agent",
    taskTitle: `Prepare the listing copy for ${opportunityRecord.title}`,
    approvalTitle: `Run the listing-copy preparation for ${opportunityRecord.title}`,
    estimatedCostCents: 150,
    reason: "Prepare truthful listing copy for the quality-passed local product package. No copy will be published or sent.",
    expectedOutput: "A clear title, product description, included-file summary, buyer promise, objections, calls to action, and claim checks.",
    expectedMetric: "Copy matches the real product files, buyer, channel, price hypothesis, and evidence without unsupported claims.",
    model: CONFIG.terraModel,
    maxOutputTokens: 1600,
    maxTurns: 1,
    maxToolCalls: 0,
    tools: [],
    businessContext: {
      subject: opportunityRecord.title,
      buyer: opportunityRecord.buyer,
      problem: opportunityRecord.problem,
      offer: opportunityRecord.offer_direction,
      channel: opportunityRecord.channel,
      evidenceStandard: "Only claim what the validated opportunity evidence and actual product manifest support.",
    },
    workBrief: {
      objective: "Write conversion copy for the exact quality-passed catalogue and its first commercial test.",
      deliverable: "One primary listing plus concise message variants and claim checks in ordinary buyer language.",
      assetPrompt: JSON.stringify({
        productManifest: plan.metadata.productManifest,
        qualityReview: taskOutput(qualityTask),
        priceFloorCents: plan.price_floor_cents,
        priceCeilingCents: plan.price_ceiling_cents,
      }),
      constraints: ["No fabricated scarcity, testimonials, sales, guarantees, or performance claims.", "No publishing or customer contact."],
      acceptanceCriteria: ["The offer is clear at a glance.", "Included files are accurate.", "The call to action is measurable."],
    },
    parameters: {
      pantheonProduction: {
        supervisorOwned: true,
        stage: "conversion_copy",
        roundId: productMetadata(qualityTask).roundId,
        opportunityId: opportunityRecord.id,
        planId: plan.id,
        qualityTaskId: qualityTask.id,
      },
    },
    effects: [],
  });
}

function writeTextDeliverable(db, task, filename, title, content, metadata = {}) {
  const outputDir = path.join(CONFIG.artifactRoot, "workflows", safeId(task.workflow_id), "launch");
  fs.mkdirSync(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, filename);
  const bytes = Buffer.from(String(content), "utf8");
  const hash = require("node:crypto").createHash("sha256").update(bytes).digest("hex");
  if (!fs.existsSync(outputPath) || require("node:crypto").createHash("sha256").update(fs.readFileSync(outputPath)).digest("hex") !== hash) {
    const temporary = `${outputPath}.${process.pid}.${randomId().slice(0, 8)}.tmp`;
    fs.writeFileSync(temporary, bytes, { flag: "wx" });
    fs.renameSync(temporary, outputPath);
  }
  const id = `deliv_${safeId(path.basename(filename, path.extname(filename)))}_${safeId(task.workflow_id, 24)}`;
  const ts = now();
  run(
    db,
    `INSERT INTO deliverables
     (id, workflow_id, task_id, venture_id, title, human_name, audience, format, status,
      file_path, summary, metadata, content_hash, version, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'operator', 'text/markdown', 'ready_for_review', ?, ?, ?, ?, 1, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       task_id = excluded.task_id, title = excluded.title, human_name = excluded.human_name,
       status = excluded.status, file_path = excluded.file_path, summary = excluded.summary,
       metadata = excluded.metadata, content_hash = excluded.content_hash,
       version = CASE WHEN deliverables.content_hash IS NOT excluded.content_hash THEN deliverables.version + 1 ELSE deliverables.version END,
       updated_at = excluded.updated_at`,
    [
      id,
      task.workflow_id,
      task.id,
      task.venture_id,
      title,
      title,
      path.relative(CONFIG.rootDir, outputPath).replace(/\\/g, "/"),
      "Pantheon launch material prepared from quality-passed product files.",
      toJson(metadata),
      hash,
      ts,
      ts,
    ],
  );
  return get(db, "SELECT * FROM deliverables WHERE id = ?", [id]);
}

function projectQualityReview(db, task, plan, opportunityRecord) {
  const output = taskOutput(task);
  const verdict = qualityPassed(output);
  const revisionNumber = Number(productMetadata(task)?.revisionNumber || 0);
  if (!verdict.passed) {
    updatePlan(db, plan.id, {
      status: revisionNumber < 1 ? "rebuilding" : "needs_attention",
      metadata: {
        buildStatus: revisionNumber < 1 ? "automatic_correction_prepared" : "quality_review_failed",
        qualityTaskId: task.id,
        qualityScore: verdict.score,
        qualityFindings: verdict.findings,
        qualityDecision: verdict.decision,
      },
    });
    run(
      db,
      "UPDATE catalogue_items SET quality_status = 'needs_changes', updated_at = ? WHERE plan_id = ?",
      [now(), plan.id],
    );
    if (revisionNumber < 1) {
      const revision = prepareCatalogueBuild(db, {
        planId: plan.id,
        opportunityId: opportunityRecord.id,
        revisionNumber: revisionNumber + 1,
        revisionFeedback: verdict.findings.join("; ") || output.summary,
        operatorChoiceRequired: false,
      });
      return { next: revision, verdict, correctionPrepared: true };
    }
    insertEvent(db, {
      level: "error",
      actor: "pantheon",
      type: "catalogue.quality_failed",
      entityType: "catalogue_plan",
      entityId: plan.id,
      message: "Pantheon stopped launch preparation because the corrected product package still failed quality review.",
      metadata: { taskId: task.id, score: verdict.score, findings: verdict.findings },
    });
    return { next: null, verdict, correctionPrepared: false };
  }
  run(
    db,
    "UPDATE catalogue_items SET status = 'ready', quality_status = 'passed', updated_at = ? WHERE plan_id = ?",
    [now(), plan.id],
  );
  run(
    db,
    `UPDATE deliverables SET status = 'quality_passed', updated_at = ?
     WHERE id IN (SELECT deliverable_id FROM catalogue_items WHERE plan_id = ? AND deliverable_id IS NOT NULL)`,
    [now(), plan.id],
  );
  const updated = updatePlan(db, plan.id, {
    status: "preparing_launch",
    metadata: {
      buildStatus: "quality_passed",
      qualityTaskId: task.id,
      qualityScore: verdict.score,
      qualityFindings: verdict.findings,
      qualityDecision: verdict.decision,
    },
  });
  const copy = queueConversionCopy(db, updated, opportunityRecord, task);
  insertEvent(db, {
    actor: "pantheon",
    type: "catalogue.quality_passed",
    entityType: "catalogue_plan",
    entityId: plan.id,
    message: `The product package passed independent quality review at ${verdict.score}/100; launch copy is next.`,
    metadata: { taskId: task.id, score: verdict.score },
  });
  return { next: copy, verdict };
}

function queueDistributionPlan(db, plan, opportunityRecord, copyTask) {
  const existing = existingProductionTask(db, plan.id, "distribution_plan");
  if (existing) return { task: existing, existing: true };
  return requestLiveAiWorker(db, copyTask.workflow_id, {
    requestKey: `catalogue_distribution_${safeId(plan.id)}`,
    requestedBy: "pantheon_supervisor",
    worker: "distribution_operator",
    taskTitle: `Prepare the first market test for ${opportunityRecord.title}`,
    approvalTitle: `Run the market-test preparation for ${opportunityRecord.title}`,
    estimatedCostCents: 150,
    reason: "Prepare a channel-specific, measurable launch plan for operator review. No post, listing, ad, message, or spend will occur.",
    expectedOutput: "A 14-day or 50-qualified-view launch plan, up to three organic posts across no more than two channels, tracking requirements, stop rule, and operator workload.",
    expectedMetric: "The plan can test three independent buyers and positive cash contribution without unapproved public or paid action.",
    model: CONFIG.terraModel,
    maxOutputTokens: 1500,
    maxTurns: 1,
    maxToolCalls: 0,
    tools: [],
    businessContext: {
      subject: opportunityRecord.title,
      buyer: opportunityRecord.buyer,
      problem: opportunityRecord.problem,
      offer: opportunityRecord.offer_direction,
      channel: opportunityRecord.channel,
      evidenceStandard: "Use the actual product package, approved opportunity evidence, and conservative unit economics.",
    },
    workBrief: {
      objective: "Prepare the smallest credible first-revenue test for the finished product package.",
      deliverable: "Channel sequence, post concepts, measurement plan, 14-day/50-view stop rule, and exact operator-only external actions.",
      assetPrompt: JSON.stringify({
        listingCopy: taskOutput(copyTask),
        productManifest: plan.metadata.productManifest,
        priceFloorCents: plan.price_floor_cents,
        priceCeilingCents: plan.price_ceiling_cents,
      }),
      constraints: ["At most three organic posts across two channels initially.", "No automatic posting, account action, contact, or spend.", "A$25 paid test is optional only after organic reach is insufficient."],
      acceptanceCriteria: ["Every step has a metric.", "Daniel's external actions are short and explicit.", "Stop, revise, and continue conditions are unambiguous."],
    },
    parameters: {
      pantheonProduction: {
        supervisorOwned: true,
        stage: "distribution_plan",
        roundId: productMetadata(copyTask).roundId,
        opportunityId: opportunityRecord.id,
        planId: plan.id,
        copyTaskId: copyTask.id,
      },
    },
    effects: [],
  });
}

function projectConversionCopy(db, task, plan, opportunityRecord) {
  const output = taskOutput(task);
  const work = output.roleOutput || {};
  const content = [
    `# ${opportunityRecord.title} Listing Copy`,
    "",
    `## Headline`,
    work.headline || output.summary || opportunityRecord.title,
    "",
    "## Description",
    work.description || output.recommendation || "",
    "",
    "## Call To Action",
    work.callToAction || output.nextAction || "",
    "",
    "## Message Variants",
    ...(work.messageVariants || []).map((item) => `- ${item}`),
    "",
    "## Claim Checks",
    ...(work.claimChecks || []).map((item) => `- ${item}`),
    "",
    "## Tracking",
    work.trackingNote || "",
  ].join("\n");
  const deliverable = writeTextDeliverable(
    db,
    task,
    `${slug(opportunityRecord.title)}-listing-copy.md`,
    `${opportunityRecord.title} Listing Copy`,
    content,
    { planId: plan.id, opportunityId: opportunityRecord.id, sourceTaskId: task.id },
  );
  const updated = updatePlan(db, plan.id, {
    status: "preparing_launch",
    metadata: { copyTaskId: task.id, listingCopyDeliverableId: deliverable.id },
  });
  return { next: queueDistributionPlan(db, updated, opportunityRecord, task), deliverable };
}

function launchPackContent(plan, opportunityRecord, distributionTask, copyTask, productFiles) {
  const distribution = taskOutput(distributionTask);
  const copy = taskOutput(copyTask);
  const work = distribution.roleOutput || {};
  return [
    `# ${opportunityRecord.title} Launch Pack`,
    "",
    "## Decision",
    "The product files passed Pantheon's local checks and independent review. Nothing has been published, sent, or spent yet.",
    "",
    "## Product",
    `Buyer: ${opportunityRecord.buyer}`,
    `Problem: ${opportunityRecord.problem}`,
    `Offer: ${opportunityRecord.offer_direction}`,
    `Target price: A$${(Number(plan.price_floor_cents || 0) / 100).toFixed(2)}`,
    "",
    "## Files Ready",
    ...productFiles.map((file) => `- ${file.human_name} (${file.format})`),
    "",
    "## Listing",
    copy.roleOutput?.headline || copy.summary || "",
    copy.roleOutput?.description || copy.recommendation || "",
    `Call to action: ${copy.roleOutput?.callToAction || copy.nextAction || ""}`,
    "",
    "## First Market Test",
    ...(work.channelSteps || []).map((item) => `- ${item}`),
    "",
    `Success metric: ${work.successMetric || "3 independent buyers and positive cash contribution"}`,
    `Stop rule: ${work.stopRule || "Revise or stop after 14 days or 50 qualified views if there is no meaningful buyer signal."}`,
    `Operator workload: ${work.operatorWorkload || "Create or sign in to the approved marketplace account, review the final listing, and press Publish."}`,
    "",
    "## Still Protected",
    "- Marketplace account creation, KYC, publishing, posts, advertising activation, customer contact, refunds, agreements, and money movement still require Daniel or a later exact approval.",
  ].join("\n");
}

function projectDistribution(db, task, plan, opportunityRecord) {
  const metadata = productMetadata(task);
  const copyTask = get(db, "SELECT * FROM tasks WHERE id = ?", [metadata.copyTaskId]);
  if (!copyTask || copyTask.status !== "completed") throw new Error("Launch preparation is missing its completed listing-copy task.");
  const productFiles = all(
    db,
    `SELECT DISTINCT deliverables.*
     FROM deliverables
     JOIN catalogue_items ON catalogue_items.deliverable_id = deliverables.id
     WHERE catalogue_items.plan_id = ?
     ORDER BY deliverables.created_at ASC`,
    [plan.id],
  );
  const content = launchPackContent(plan, opportunityRecord, task, parseRow(copyTask, ["payload", "result"]), productFiles);
  const launchDeliverable = writeTextDeliverable(
    db,
    task,
    `${slug(opportunityRecord.title)}-launch-pack.md`,
    `${opportunityRecord.title} Launch Pack`,
    content,
    { planId: plan.id, opportunityId: opportunityRecord.id, sourceTaskId: task.id },
  );
  let experiment = get(
    db,
    "SELECT * FROM commercial_experiments WHERE json_extract(metadata, '$.cataloguePlanId') = ? LIMIT 1",
    [plan.id],
  );
  if (!experiment) {
    experiment = createCommercialExperiment(db, {
      workflowId: task.workflow_id,
      ventureId: plan.venture_id,
      name: `${opportunityRecord.title} first-revenue test`,
      status: "ready",
      hypothesis: `If ${opportunityRecord.buyer} sees the finished ${opportunityRecord.offer_direction} through ${opportunityRecord.channel}, at least three independent buyers will purchase with positive cash contribution.`,
      buyer: opportunityRecord.buyer,
      offer: opportunityRecord.offer_direction,
      channel: opportunityRecord.channel,
      priceCents: Number(plan.price_floor_cents || 0),
      expectedMetric: "independent paid buyers and positive cash contribution",
      targetValue: 3,
      targetUnit: "buyers",
      costCapCents: 2500,
      metadata: {
        roundId: metadata.roundId,
        opportunityId: opportunityRecord.id,
        cataloguePlanId: plan.id,
        launchPackDeliverableId: launchDeliverable.id,
        durationDays: 14,
        qualifiedViewLimit: 50,
        realStartConfirmed: false,
      },
    });
  }
  const chief = recordProtectedWorkerOutcome(
    db,
    {
      kind: "launch_readiness_decision",
      agent: "chief_of_staff",
      workflow_id: task.workflow_id,
      venture_id: plan.venture_id,
      title: `Decide whether to launch ${opportunityRecord.title}`,
      payload: {
        buyer: opportunityRecord.buyer,
        problem: opportunityRecord.problem,
        offer: opportunityRecord.offer_direction,
        channel: opportunityRecord.channel,
      },
    },
    {
      heading: "Product and launch pack ready",
      summary: `${opportunityRecord.title} now has validated local product files, quality-passed catalogue coverage, listing copy, and a measurable first-revenue test. No public action has occurred.`,
      moneyMove: "Review the launch pack, then decide whether to prepare the Gumroad listing and initial approved posts.",
      evidence: [
        `${plan.target_item_count} catalogue items passed the local quality gate.`,
        `${productFiles.length} customer-facing bundle${productFiles.length === 1 ? "" : "s"} are stored locally.`,
        `Independent quality score: ${plan.metadata.qualityScore || "not recorded"}/100.`,
        "The test targets three independent buyers and positive cash contribution.",
      ],
      risks: [
        "Demand evidence and a quality-passed product do not guarantee sales.",
        "Marketplace setup, KYC, publishing, posts, and any advertising still require an exact external action.",
      ],
      nextAction: "Approve launch preparation, request changes, or stop this venture before anything becomes public.",
      operatorDecision: "approve",
      confidence: "medium",
    },
    {
      approvalRequired: true,
      handoffTo: "distribution_operator",
      handoffReason: "The complete internal product and launch package is ready for Daniel's external-action decision.",
      handoffDecisionNeeded: `Decide whether Pantheon should move ${opportunityRecord.title} to ready-to-publish.`,
      handoffRiskLevel: "medium",
      metadata: {
        pantheonProduction: {
          action: "authorize_launch_preparation",
          roundId: metadata.roundId,
          opportunityId: opportunityRecord.id,
          planId: plan.id,
          experimentId: experiment.id,
          launchPackDeliverableId: launchDeliverable.id,
        },
      },
    },
  );
  const approvalPack = generateApprovalPack(db, task.workflow_id);
  updatePlan(db, plan.id, {
    status: "launch_decision",
    metadata: {
      distributionTaskId: task.id,
      launchPackDeliverableId: launchDeliverable.id,
      launchDecisionHandoffId: chief.handoff?.id || null,
      approvalPackDeliverableId: approvalPack?.id || null,
      experimentId: experiment.id,
      buildStatus: "ready_for_launch_decision",
    },
  });
  run(
    db,
    "UPDATE opportunities SET status = 'ready_to_launch', updated_at = ? WHERE id = ?",
    [now(), opportunityRecord.id],
  );
  run(
    db,
    `UPDATE opportunity_rounds SET status = 'ready_to_launch', updated_at = ?
     WHERE id = ?`,
    [now(), metadata.roundId],
  );
  run(
    db,
    `UPDATE workflows SET status = 'ready_for_review', current_step = 'Launch decision ready',
      approval_required = 1, updated_at = ? WHERE id = ?`,
    [now(), task.workflow_id],
  );
  return { chief, launchDeliverable, approvalPack, experiment };
}

function markProjected(db, planId, taskId) {
  const plan = cataloguePlan(db, planId);
  const projectedTaskIds = [...new Set([...(plan.metadata.projectedTaskIds || []), taskId])];
  updatePlan(db, planId, { metadata: { projectedTaskIds } });
}

function projectCompletedProductionTask(db, taskId) {
  const task = get(db, "SELECT * FROM tasks WHERE id = ?", [taskId]);
  if (!task || task.status !== "completed") return { projected: false, reason: "task_not_completed" };
  const metadata = productMetadata(task);
  if (!metadata?.planId || !PRODUCTION_STAGES.has(metadata.stage)) {
    return { projected: false, reason: "not_pantheon_production_work" };
  }
  const plan = cataloguePlan(db, metadata.planId);
  if (!plan) throw new Error(`Catalogue plan not found: ${metadata.planId}`);
  if ((plan.metadata.projectedTaskIds || []).includes(task.id)) {
    return { projected: false, reason: "already_projected", plan };
  }
  const opportunityRecord = opportunity(db, metadata.opportunityId || plan.opportunity_id);
  if (!opportunityRecord) throw new Error("Production task is missing its exact opportunity.");
  let result;
  if (metadata.stage === "product_build") result = projectProductBuild(db, task, plan, opportunityRecord);
  else if (metadata.stage === "quality_review") result = projectQualityReview(db, task, plan, opportunityRecord);
  else if (metadata.stage === "conversion_copy") result = projectConversionCopy(db, task, plan, opportunityRecord);
  else if (metadata.stage === "distribution_plan") result = projectDistribution(db, task, plan, opportunityRecord);
  markProjected(db, plan.id, task.id);
  insertEvent(db, {
    actor: "pantheon",
    type: "production.step_projected",
    entityType: "task",
    entityId: task.id,
    message: `Pantheon incorporated the ${metadata.stage.replaceAll("_", " ")} result into the product record.`,
    metadata: { planId: plan.id, opportunityId: opportunityRecord.id, stage: metadata.stage },
  });
  return { projected: true, stage: metadata.stage, plan: cataloguePlan(db, plan.id), opportunity: opportunityRecord, result };
}

function pendingProductionTask(db) {
  const row = get(
    db,
    `SELECT * FROM tasks
     WHERE kind = 'live_ai_worker_execution'
       AND json_extract(payload, '$.liveSpendRequest.parameters.pantheonProduction.supervisorOwned') = 1
       AND status IN ('queued', 'planned', 'blocked', 'waiting_approval', 'running', 'needs_attention')
     ORDER BY priority ASC, created_at ASC LIMIT 1`,
  );
  return row ? parseRow(row, ["payload", "result"]) : null;
}

function completedUnprojectedProductionTask(db) {
  const tasks = all(
    db,
    `SELECT * FROM tasks
     WHERE kind = 'live_ai_worker_execution'
       AND status = 'completed'
       AND json_extract(payload, '$.liveSpendRequest.parameters.pantheonProduction.supervisorOwned') = 1
     ORDER BY completed_at ASC, created_at ASC`,
  );
  return tasks.find((task) => {
    const metadata = productMetadata(task);
    const plan = metadata?.planId ? cataloguePlan(db, metadata.planId) : null;
    return plan && !(plan.metadata.projectedTaskIds || []).includes(task.id);
  }) || null;
}

function applyPantheonHandoffDecision(db, handoff, decision, note = "") {
  const handoffMetadata = handoff?.metadata && typeof handoff.metadata === "object"
    ? handoff.metadata
    : fromJson(handoff?.metadata, {});
  const metadata = handoffMetadata?.pantheonProduction;
  if (!metadata?.planId || metadata.action !== "authorize_launch_preparation") return null;
  const plan = cataloguePlan(db, metadata.planId);
  if (!plan) throw new Error("Pantheon launch decision refers to a missing catalogue plan.");
  const ts = now();
  const normalized = String(decision || "").toLowerCase();
  const approved = normalized === "approve";
  const changes = normalized === "changes";
  const planStatus = approved ? "ready_to_publish" : changes ? "needs_changes" : "paused";
  updatePlan(db, plan.id, {
    status: planStatus,
    metadata: {
      launchDecision: normalized,
      launchDecisionNote: note || "",
      launchDecisionAt: ts,
      buildStatus: approved ? "ready_to_publish" : planStatus,
    },
  });
  run(
    db,
    "UPDATE opportunities SET status = ?, updated_at = ? WHERE id = ?",
    [approved ? "ready_to_publish" : planStatus, ts, metadata.opportunityId],
  );
  run(
    db,
    "UPDATE opportunity_rounds SET status = ?, updated_at = ? WHERE id = ?",
    [approved ? "ready_to_publish" : planStatus, ts, metadata.roundId],
  );
  if (approved) {
    run(
      db,
      `INSERT INTO messages (id, severity, status, subject, body, created_at, metadata)
       VALUES (?, 'approval', 'open', ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET body = excluded.body, metadata = excluded.metadata`,
      [
        `msg_publish_${safeId(plan.id)}`,
        "Publish the approved product test",
        "The complete launch pack is ready. Daniel still needs to create or sign in to Gumroad, complete any private KYC, review the listing, and press Publish. Pantheon will not claim the test is running until that real action is confirmed.",
        ts,
        toJson({ ...metadata, operatorAction: "publish_on_gumroad", externalActionNotCompleted: true }),
      ],
    );
  }
  insertEvent(db, {
    actor: "operator",
    type: "production.launch_decision_recorded",
    entityType: "catalogue_plan",
    entityId: plan.id,
    message: approved
      ? "Daniel approved launch preparation; the product is ready for the separate real Gumroad publishing action."
      : changes
        ? "Daniel requested product or launch changes."
        : "Daniel stopped this product launch.",
    metadata: { decision: normalized, note: note || "", ...metadata },
  });
  return { decision: normalized, plan: cataloguePlan(db, plan.id), externalActionCompleted: false };
}

function getProductionState(db) {
  const plans = all(
    db,
    `SELECT * FROM catalogue_plans
     WHERE status NOT IN ('planned')
     ORDER BY updated_at DESC LIMIT 30`,
  ).map((row) => parseRow(row, ["audience_segments", "channels", "geographies", "languages", "metadata"]));
  return {
    schema: "pantheon_production_state_v1",
    currentTask: pendingProductionTask(db),
    plans,
    readyToPublish: plans.filter((plan) => plan.status === "ready_to_publish"),
    needsAttention: plans.filter((plan) => ["needs_attention", "requires_capability", "needs_changes"].includes(plan.status)),
  };
}

module.exports = {
  PRODUCT_BUILD_SPEC_SCHEMA,
  PRODUCTION_STAGES,
  applyPantheonHandoffDecision,
  buildProfile,
  completedUnprojectedProductionTask,
  getProductionState,
  pendingProductionTask,
  prepareCatalogueBuild,
  projectCompletedProductionTask,
};
