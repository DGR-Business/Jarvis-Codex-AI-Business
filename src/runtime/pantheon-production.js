const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const CONFIG = require("../config");
const { all, fromJson, get, insertEvent, now, randomId, run, toJson } = require("../db");
const { recordAgentHandoff, recordProtectedWorkerOutcome } = require("./ai-team");
const { generateApprovalPack } = require("./approval-pack");
const { createCommercialExperiment } = require("./commercial-results");
const { buildDeliverableReviewBindings } = require("./deliverable-review-bindings");
const {
  canonicalListingIncludedFiles,
  currentPackageDefectIssues,
  exactPublicationListMatch,
  publicationSafeList,
  publicationSafeText,
  publicationTextIssues,
} = require("./publication-artifact-quality");
const { requestLiveAiWorker } = require("./live-ai-workers");
const { journeyForRound, updateJourney } = require("./pantheon-journey");
const { combinedProofExposureFromDatabase } = require("./proof-exposure-ledger");
const { finalizeBuyerIntentValidationSample } = require("./buyer-intent-validation");

const PRODUCT_BUILD_SPEC_SCHEMA = "pantheon.product-build-spec.v1";
const PRODUCT_MANIFEST_SCHEMA = "pantheon.product-manifest.v1";
const PRODUCTION_STAGES = new Set([
  "product_build",
  "storefront_visuals",
  "quality_review",
  "conversion_copy",
  "distribution_plan",
  "chief_brief",
]);

function safeId(value, max = 64) {
  return String(value || "pantheon")
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .slice(0, max) || "pantheon";
}

function withSavepoint(db, prefix, operation) {
  const name = `${safeId(prefix, 32)}_${randomId().replace(/[^a-zA-Z0-9]/g, "")}`;
  db.exec(`SAVEPOINT ${name}`);
  try {
    const value = operation();
    db.exec(`RELEASE SAVEPOINT ${name}`);
    return value;
  } catch (error) {
    db.exec(`ROLLBACK TO SAVEPOINT ${name}`);
    db.exec(`RELEASE SAVEPOINT ${name}`);
    throw error;
  }
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
  const payload = task?.payload && typeof task.payload === "object"
    ? task.payload
    : fromJson(task?.payload, {});
  return payload?.liveSpendRequest?.parameters?.pantheonProduction || null;
}

function taskOutput(task) {
  const result = task?.result && typeof task.result === "object"
    ? task.result
    : fromJson(task?.result, {});
  return result?.output || {};
}

function actualProductTitle(plan, opportunityRecord) {
  return String(
    plan?.metadata?.productManifest?.packageTitle
      || plan?.metadata?.validationSample?.sample?.item?.title
      || plan?.metadata?.validationSample?.sample?.packageTitle
      || plan?.title
      || opportunityRecord?.title
      || "",
  ).trim();
}

function actualProductPromise(plan, opportunityRecord) {
  return String(
    plan?.metadata?.productManifest?.customerPromise
      || opportunityRecord?.offer_direction
      || "",
  ).trim();
}

function actualProductOffer(plan, opportunityRecord) {
  const title = actualProductTitle(plan, opportunityRecord);
  const promise = actualProductPromise(plan, opportunityRecord);
  if (title && promise && title.toLowerCase() !== promise.toLowerCase()) {
    return `${title}: ${promise}`;
  }
  return title || promise;
}

function publicationScorecard(plan, opportunityRecord) {
  const validation = opportunityRecord.metadata?.validation || {};
  return {
    total_score: Number(opportunityRecord.overall_score || 0),
    verdict: "ready_to_test",
    confidence: opportunityRecord.confidence || "medium",
    recommendation: `The verified ${actualProductTitle(plan, opportunityRecord)} package is ready for a bounded market test; demand and willingness to pay remain unproven until real buyers act.`,
    risks: [],
    next_actions: [],
    dimensions: {
      demand_signal: {
        label: "Demand evidence",
        score: Number(opportunityRecord.demand_score || 0),
        note: publicationSafeText(validation.recommendation || "Comparable offers and recurring buyer problems support a test, but this exact package has no verified buyers yet."),
      },
      supply_gap: {
        label: "Differentiation",
        score: Number(opportunityRecord.supply_gap_score || 0),
        note: "Alternatives exist; this package must earn its price through the verified customer workflow, not presentation alone.",
      },
      unit_economics: {
        label: "Unit economics",
        score: Number(opportunityRecord.economics_score || 0),
        note: "Digital delivery supports attractive gross margins, but platform fees, refunds, conversion, and net contribution still require real sales data.",
      },
      channel_fit: {
        label: "Channel fit",
        score: Number(opportunityRecord.channel_fit_score || 0),
        note: "Gumroad Direct and a bounded two-channel organic test fit the offer; qualified reach has not yet been observed.",
      },
      execution_fit: {
        label: "Execution readiness",
        score: Number(opportunityRecord.execution_fit_score || 0),
        note: "The customer package, listing, previews, launch plan, and independent quality review are complete.",
      },
      risk_control: {
        label: "Risk control",
        score: Number(opportunityRecord.risk_score || 0),
        note: "Nothing has been published and no external spend is authorised; buyer demand, support burden, and final platform economics remain open risks.",
      },
    },
  };
}

function publicationPriceChannelHypothesis(plan, opportunityRecord) {
  const price = `A$${(Number(plan.price_floor_cents || 0) / 100).toFixed(2)}`;
  const buyer = publicationSafeText(opportunityRecord.buyer || "buyers")
    .replace(/[.!?]+$/, "")
    .toLowerCase();
  return `If qualified ${buyer} see the verified package at ${price} through Gumroad Direct and the two bounded organic channels, real views and purchases will show whether this offer deserves further investment.`;
}

function publicationWorkTaskIds(db, plan, opportunityRecord, workflowId, currentChiefTaskId = null) {
  const tasks = all(
    db,
    `SELECT * FROM tasks
     WHERE workflow_id = ? AND status = 'completed'
     ORDER BY completed_at DESC, updated_at DESC`,
    [workflowId],
  ).map((task) => parseRow(task, ["payload", "result"]));
  const scoped = (task, scopeName, scopeId) => {
    const contextScope = task.payload?.contextSnapshot?.contextScope || {};
    const production = task.payload?.liveSpendRequest?.parameters?.pantheonProduction || {};
    return contextScope[scopeName] === scopeId || production[scopeName] === scopeId;
  };
  const latest = (agent, predicate = () => true) => tasks.find(
    (task) => task.agent === agent && predicate(task),
  )?.id || null;
  return [
    opportunityRecord.metadata?.sourceTaskId,
    opportunityRecord.metadata?.validation?.taskId,
    latest("finance_analyst", (task) => scoped(task, "opportunityId", opportunityRecord.id)),
    plan.metadata?.sourceTaskId,
    plan.metadata?.buildTaskId,
    plan.metadata?.qualityTaskId,
    latest("copy_conversion_agent", (task) => (
      scoped(task, "planId", plan.id)
      || scoped(task, "opportunityId", opportunityRecord.id)
    )),
    plan.metadata?.distributionTaskId,
    currentChiefTaskId || plan.metadata?.chiefTaskId,
  ].filter(Boolean);
}

function publicationPackOptions(db, plan, opportunityRecord, workflowId, currentChiefTaskId = null) {
  const validation = opportunityRecord.metadata?.validation || {};
  const price = `A$${(Number(plan.price_floor_cents || 0) / 100).toFixed(2)}`;
  return {
    humanName: `${opportunityRecord.title} Ready-to-Publish Brief`,
    workflowStatus: "ready_to_publish",
    scorecardOverride: publicationScorecard(plan, opportunityRecord),
    decisionOverride: {
      headline: `The exact local package is ready for a no-spend ${price} launch test. Nothing has been published.`,
      approvalQuestion: "The package is ready. Publishing remains a separate protected action.",
    },
    commercialCaseOverride: {
      buyer: opportunityRecord.buyer,
      problem: opportunityRecord.problem,
      offer: actualProductOffer(plan, opportunityRecord),
      channel: opportunityRecord.channel,
      priceChannelHypothesis: publicationPriceChannelHypothesis(plan, opportunityRecord),
      smallestTest: `After separate publication approval, run the accepted 14-day organic launch sequence or stop at 50 qualified product views. Use no more than three posts across two channels and record every qualified view, purchase, buyer segment, question, and objection.`,
      successMetric: validation.metric || "Three independent paid buyers with positive cash contribution.",
      stopRule: validation.stopRule || "Revise or stop after 50 qualified views and zero sales without strong qualified interest.",
    },
    actionsOverride: [
      {
        id: "approve",
        label: "Keep ready to publish",
        effect: "Retain this exact verified package for Daniel's later protected publication action.",
      },
      {
        id: "changes",
        label: "Request changes",
        effect: "Return the package with your direction; nothing is published.",
      },
      {
        id: "deny",
        label: "Stop this launch test",
        effect: "Pause this direction without any external action.",
      },
    ],
    workTaskIdsOverride: publicationWorkTaskIds(db, plan, opportunityRecord, workflowId, currentChiefTaskId),
    presentationTransform: (value) => publicationPresentationText(value, plan),
  };
}

function firstRevenueHypothesis(plan, opportunityRecord) {
  const title = actualProductTitle(plan, opportunityRecord) || "the finished product package";
  const promise = actualProductPromise(plan, opportunityRecord);
  const buyer = publicationSafeText(opportunityRecord.buyer).replace(/[.!?]+$/, "");
  const channel = publicationSafeText(opportunityRecord.channel).replace(/[.!?]+$/, "");
  const customerPromise = publicationSafeText(promise).replace(/[.!?]+$/, "");
  return [
    `Show ${title} to ${buyer} through ${channel}.`,
    customerPromise ? `Customer promise: ${customerPromise}.` : "",
    "The test succeeds when at least three independent buyers purchase with positive cash contribution.",
  ].filter(Boolean).join(" ");
}

function conciseCatalogueContext(plan) {
  const manifest = plan?.metadata?.productManifest || {};
  const catalogue = Array.isArray(manifest.catalogueItems) ? manifest.catalogueItems : [];
  return {
    schema: "pantheon.verified-launch-context.v1",
    packageTitle: manifest.packageTitle || plan.title,
    customerPromise: manifest.customerPromise || "",
    deliveryFormat: manifest.deliveryFormat || "",
    catalogueItems: catalogue.map((item) => ({
      title: item.title,
      purpose: item.purpose,
      files: Array.isArray(item.files) ? item.files : [],
    })),
    sharedFiles: Array.isArray(manifest.sharedFiles) ? manifest.sharedFiles : [],
    storefrontPreviews: Array.isArray(manifest.storefrontPreviews) ? manifest.storefrontPreviews : [],
    listingIncludedFiles: canonicalListingIncludedFiles(manifest),
    disclaimers: Array.isArray(manifest.disclaimers) ? manifest.disclaimers : [],
    bundleFilename: manifest.bundle?.filename || "",
    canonicalManifestInsideBundle: manifest.bundle?.canonicalManifestInsideBundle === true,
    publishingStatus: manifest.publishingStatus || "not_published",
    independentQuality: {
      passed: Number(plan?.metadata?.qualityScore || 0) >= 80
        && plan?.metadata?.qualityDecision === "approve",
      score: Number(plan?.metadata?.qualityScore || 0),
      decision: plan?.metadata?.qualityDecision || "",
    },
    appliedRuntimeAdjustments: (manifest.runtimeNormalizations || []).map((item) => ({
      code: item.code,
      fieldName: item.fieldName || "",
      status: "applied_and_included_in_quality_reviewed_files",
    })),
    currentTruthRule: "This record is the current verified package. Earlier failed, truncated, or superseded attempts are audit history and must not be reported as current defects.",
  };
}

function conciseQualityContext(qualityTask) {
  const output = taskOutput(qualityTask);
  const work = output.roleOutput || {};
  return {
    taskId: qualityTask.id,
    status: qualityTask.status,
    score: Number(work.qualityScore || 0),
    decision: output.operatorDecision || "",
    claimSafety: work.claimSafety || "",
    operatorRecommendation: work.operatorRecommendation || "",
    currentRiskFindings: Array.isArray(work.riskFindings) ? work.riskFindings : [],
    currentMissingEvidence: Array.isArray(work.missingEvidence) ? work.missingEvidence : [],
  };
}

function conciseListingContext(copyTask, plan = null) {
  const output = taskOutput(copyTask);
  const work = output.roleOutput || {};
  const canonicalIncludedFiles = plan
    ? canonicalListingIncludedFiles(plan?.metadata?.productManifest || {})
    : [];
  const normalize = (value) => plan ? publicationPlanPriceText(value, plan) : value;
  const normalizeList = (value) => (
    Array.isArray(value) ? value.map((item) => normalize(item)).filter(Boolean) : []
  );
  return {
    taskId: copyTask.id,
    status: copyTask.status,
    productTitle: normalize(work.productTitle || ""),
    headline: normalize(work.headline || ""),
    description: normalize(work.description || ""),
    callToAction: normalize(work.callToAction || ""),
    includedFiles: canonicalIncludedFiles.length
      ? canonicalIncludedFiles
      : Array.isArray(work.includedFiles) ? work.includedFiles : [],
    tags: normalizeList(work.tags),
    faq: normalizeList(work.faq),
    messageVariants: normalizeList(work.messageVariants),
    claimChecks: normalizeList(work.claimChecks),
    trackingNote: normalize(work.trackingNote || ""),
  };
}

function conciseDistributionContext(distributionTask, plan = null) {
  const output = taskOutput(distributionTask);
  const work = output.roleOutput || {};
  const normalize = (value) => plan ? publicationPlanPriceText(value, plan) : value;
  return {
    taskId: distributionTask.id,
    status: distributionTask.status,
    audience: normalize(work.audience || ""),
    channelSteps: Array.isArray(work.channelSteps)
      ? work.channelSteps.map((item) => normalize(item)).filter(Boolean)
      : [],
    evidenceToCapture: Array.isArray(work.evidenceToCapture)
      ? work.evidenceToCapture.map((item) => normalize(item)).filter(Boolean)
      : [],
    successMetric: normalize(work.successMetric || ""),
    stopRule: normalize(work.stopRule || ""),
    operatorWorkload: normalize(work.operatorWorkload || ""),
  };
}

function chiefDecisionContext(plan, copyTask, distributionTask) {
  const catalogue = conciseCatalogueContext(plan);
  const listing = conciseListingContext(copyTask, plan);
  const distribution = conciseDistributionContext(distributionTask, plan);
  return {
    currentVerifiedCatalogue: {
      packageTitle: catalogue.packageTitle,
      customerPromise: catalogue.customerPromise,
      deliveryFormat: catalogue.deliveryFormat,
      catalogueItems: catalogue.catalogueItems.map((item) => item.title),
      sharedFiles: catalogue.sharedFiles,
      bundleFilename: catalogue.bundleFilename,
      canonicalManifestInsideBundle: catalogue.canonicalManifestInsideBundle,
      disclaimers: catalogue.disclaimers,
      publishingStatus: catalogue.publishingStatus,
      independentQuality: catalogue.independentQuality,
      currentTruthRule: catalogue.currentTruthRule,
    },
    currentAcceptedListing: {
      taskId: listing.taskId,
      status: listing.status,
      productTitle: listing.productTitle,
      headline: listing.headline,
      description: String(listing.description || "").slice(0, 1200),
      callToAction: listing.callToAction,
      includedFiles: listing.includedFiles,
      claimChecks: listing.claimChecks,
      trackingNote: listing.trackingNote,
    },
    currentAcceptedDistributionPlan: distribution,
  };
}

function serializedLaunchContext(value, label) {
  const serialized = JSON.stringify(value);
  if (serialized.length > 11000) {
    throw new Error(`${label} is too large for one verified worker handoff. Reduce it to current, decision-relevant facts.`);
  }
  return serialized;
}

function publicationParagraphs(value) {
  return String(value || "")
    .replace(/\\r\\n|\\n|\\r/g, "\n")
    .split(/\r?\n+/)
    .map(publicationSafeText)
    .filter(Boolean)
    .join("\n\n");
}

function publicationPlanPriceText(value, plan) {
  const text = publicationSafeText(value);
  const priceCents = Number(plan?.price_floor_cents || 0);
  if (!priceCents) return text;
  const fixed = (priceCents / 100).toFixed(2);
  const compact = fixed.replace(/\.00$/, "").replace(/(\.\d)0$/, "$1");
  const variants = [...new Set([fixed, compact])]
    .sort((left, right) => right.length - left.length)
    .map((item) => item.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|");
  const foreignPrefix = new RegExp(
    `\\b(?:US\\$|USD\\s*)(${variants})(?!\\d|\\.\\d)`,
    "gi",
  );
  const foreignSuffix = new RegExp(
    `(^|[^\\d.])(${variants})\\s*USD\\b`,
    "gi",
  );
  const audPrefix = new RegExp(
    `\\bAUD\\s*(${variants})(?!\\d|\\.\\d)`,
    "gi",
  );
  const audSuffix = new RegExp(
    `(^|[^\\d.])(${variants})\\s*AUD\\b`,
    "gi",
  );
  const barePrice = new RegExp(`(^|[^A-Za-z])\\$(${variants})(?!\\d|\\.\\d)`, "g");
  return text
    .replace(foreignPrefix, (_match, amount) => `A$${amount}`)
    .replace(foreignSuffix, (_match, prefix, amount) => `${prefix}A$${amount}`)
    .replace(audPrefix, (_match, amount) => `A$${amount}`)
    .replace(audSuffix, (_match, prefix, amount) => `${prefix}A$${amount}`)
    .replace(barePrice, (_match, prefix, amount) => `${prefix}A$${amount}`);
}

function publicationPresentationText(value, plan) {
  return publicationPlanPriceText(value, plan)
    .replace(
      /\bprepare a measured paid test rather than publish or claim validated sales\b/gi,
      "prepare the accepted measured organic test after separate publication approval rather than claim validated sales",
    );
}

function containsForeignCanonicalPrice(value, plan) {
  const priceCents = Number(plan?.price_floor_cents || 0);
  if (!priceCents) return false;
  const fixed = (priceCents / 100).toFixed(2);
  const compact = fixed.replace(/\.00$/, "").replace(/(\.\d)0$/, "$1");
  const variants = [...new Set([fixed, compact])]
    .sort((left, right) => right.length - left.length)
    .map((item) => item.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|");
  return new RegExp(
    `(?:\\bUS\\$|\\bUSD\\s*)(?:${variants})(?!\\d|\\.\\d)|(^|[^\\d.])(?:${variants})\\s*USD\\b`,
    "i",
  ).test(String(value || ""));
}

function publicationPlanPriceParagraphs(value, plan) {
  return String(value || "")
    .replace(/\\r\\n|\\n|\\r/g, "\n")
    .split(/\r?\n+/)
    .map((item) => publicationPlanPriceText(item, plan))
    .filter(Boolean)
    .join("\n\n");
}

function publicationPlanPriceList(value, plan) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => publicationPlanPriceText(item, plan)).filter(Boolean);
}

function stableCostRiskText(value) {
  return publicationSafeText(value)
    .split(/(?<=[.!?])\s+/)
    .filter((sentence) => !(
      /\bfinance record\b/i.test(sentence)
      && /\b(?:provider|tool|model|AI)\b/i.test(sentence)
      && /\bcost/i.test(sentence)
    ))
    .join(" ")
    .trim();
}

function contextRevision(task) {
  return Number(productMetadata(task)?.contextRevision || 0);
}

function existingProductionContextTask(db, planId, stage, revision) {
  const rows = all(
    db,
    `SELECT * FROM tasks
     WHERE kind = 'live_ai_worker_execution'
       AND json_extract(payload, '$.liveSpendRequest.parameters.pantheonProduction.planId') = ?
       AND json_extract(payload, '$.liveSpendRequest.parameters.pantheonProduction.stage') = ?
     ORDER BY created_at DESC`,
    [planId, stage],
  );
  const match = rows.find((row) => contextRevision(row) === Number(revision || 0));
  return match ? parseRow(match, ["payload", "result"]) : null;
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

function journeyForPlan(db, plan) {
  const round = roundForPlan(db, plan);
  return round ? journeyForRound(db, round.id) : null;
}

function journeyParameters(journey) {
  return journey ? {
    pantheonJourney: {
      journeyId: journey.id,
      mode: journey.mode,
      model: journey.model,
      modelLocked: journey.model_locked === 1,
      budgetCapCents: journey.budget_cap_cents,
    },
  } : {};
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

function normalizedRevisionCorrections(options = {}) {
  const supplied = Array.isArray(options.revisionCorrections)
    ? options.revisionCorrections
    : String(options.revisionFeedback || "").split(/\s*;\s*|\r?\n+/);
  return [...new Set(
    supplied
      .filter(Boolean)
      .map((item) => String(item).replace(/\s+/g, " ").trim().slice(0, 700))
      .filter(Boolean),
  )].slice(0, 6);
}

function buildSpec(plan, opportunityRecord, items, options = {}) {
  const profile = buildProfile(opportunityRecord);
  const fullJourney = Boolean(plan.metadata.journeyId);
  const validationSample = plan.metadata.validationSample || null;
  const validationPackageTitle = validationSample
    ? String(
      validationSample.sample?.item?.title
      || validationSample.sample?.packageTitle
      || opportunityRecord.title,
    ).trim()
    : null;
  const needsStorefrontPreviews = fullJourney || Boolean(validationSample);
  const revisionCorrections = normalizedRevisionCorrections(options);
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
    bundleFilename: validationSample
      ? `${slug(validationPackageTitle)}.zip`
      : `${slug(opportunityRecord.title)}-catalogue.zip`,
    minimumReturnedFiles: 2,
    storefrontPreviewCount: needsStorefrontPreviews ? 2 : 0,
    storefrontPreviewDirectory: needsStorefrontPreviews ? "storefront-previews" : null,
    ventureKit: needsStorefrontPreviews ? "digital_product_v1" : null,
    validationSample: validationSample ? {
      schema: validationSample.schema,
      specId: validationSample.specId,
      contractHash: validationSample.contractHash,
      packageTitle: validationPackageTitle,
      customerPromise: validationSample.sample?.customerPromise,
      setupSteps: validationSample.sample?.setupSteps || [],
      disclaimers: validationSample.sample?.disclaimers || [],
      channel: validationSample.channel || null,
      exactItemBlueprint: {
        ...(validationSample.sample?.item || {}),
        id: items[0]?.id || validationSample.sample?.item?.id,
        title: items[0]?.title || validationSample.sample?.item?.title,
      },
      testMeasurement: validationSample.measurement,
      noFullCatalogueAuthorised: true,
    } : null,
    revisionNumber: Number(options.revisionNumber || 0),
    revisionCorrections,
    revisionFeedback: revisionCorrections.join("; ").slice(0, 1800),
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

function reviewFingerprint(reviewBindings, qualityReviewPacket) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify({
      reviewBindings: Array.isArray(reviewBindings) ? reviewBindings : [],
      qualityReviewPacket: qualityReviewPacket || null,
    }))
    .digest("hex");
}

function qualityReviewFingerprintForTask(task) {
  const payload = task?.payload && typeof task.payload === "object"
    ? task.payload
    : fromJson(task?.payload, {});
  const parameters = payload?.liveSpendRequest?.parameters || {};
  return parameters?.pantheonProduction?.reviewFingerprint
    || reviewFingerprint(parameters.reviewBindings, parameters.qualityReviewPacket);
}

function existingQualityReviewTask(db, planId, revisionNumber, fingerprint, options = {}) {
  const rows = all(
    db,
    `SELECT * FROM tasks
     WHERE kind = 'live_ai_worker_execution'
       AND status <> 'cancelled'
       AND json_extract(payload, '$.liveSpendRequest.parameters.pantheonProduction.planId') = ?
       AND json_extract(payload, '$.liveSpendRequest.parameters.pantheonProduction.stage') = 'quality_review'
     ORDER BY created_at DESC`,
    [planId],
  ).map((row) => parseRow(row, ["payload", "result"]));
  const sameRevision = rows.filter((row) => (
    Number(productMetadata(row)?.revisionNumber || 0) === Number(revisionNumber)
  ));
  const matching = sameRevision.find((row) => qualityReviewFingerprintForTask(row) === fingerprint);
  const reviewedFingerprints = new Set(
    sameRevision.map(qualityReviewFingerprintForTask).filter(Boolean),
  );
  if (matching) return { task: matching, existing: true, sequence: reviewedFingerprints.size };
  const planMetadata = fromJson(
    get(db, "SELECT metadata FROM catalogue_plans WHERE id = ?", [planId])?.metadata,
    {},
  );
  const validationSample = planMetadata.validationSample || null;
  const explicitOperatorFinalReview = options.explicitOperatorFinalReview === true;
  const inspectionEvidenceRecheck = options.inspectionEvidenceRecheck === true;
  if (validationSample) {
    const correctionLimit = Math.max(
      0,
      Number(validationSample.providerPolicy?.correctionLimit || 0),
    );
    if (explicitOperatorFinalReview) {
      throw new Error("The retired final-review override cannot create another paid review.");
    }
    if (inspectionEvidenceRecheck) {
      const priorEvidenceRechecks = all(
        db,
        `SELECT * FROM tasks
         WHERE kind = 'live_ai_worker_execution'
           AND json_extract(payload, '$.liveSpendRequest.parameters.pantheonProduction.planId') = ?
           AND json_extract(payload, '$.liveSpendRequest.parameters.pantheonProduction.stage') = 'quality_review'
           AND json_extract(payload, '$.liveSpendRequest.parameters.pantheonProduction.inspectionEvidenceRecheck') = 1`,
        [planId],
      ).map((row) => parseRow(row, ["payload", "result"])).filter((row) => (
        Number(productMetadata(row)?.revisionNumber || 0) === Number(revisionNumber)
      ));
      if (priorEvidenceRechecks.length > 0) {
        throw new Error("Pantheon already used the one inspection-evidence recheck for this product revision.");
      }
      if (sameRevision.length !== 1) {
        throw new Error(
          "An inspection-evidence recheck requires exactly one completed review of the unchanged product revision.",
        );
      }
      if (Number(revisionNumber) > correctionLimit) {
        throw new Error("Pantheon has reached the buyer-intent correction limit.");
      }
      return { task: null, existing: false, sequence: rows.length + 1 };
    }
    if (sameRevision.length > 0) {
      throw new Error(
        "Pantheon already reviewed this product revision. Changed files require a new bounded revision.",
      );
    }
    if (Number(revisionNumber) > correctionLimit) {
      throw new Error("Pantheon has reached the buyer-intent correction limit.");
    }
    return { task: null, existing: false, sequence: rows.length + 1 };
  }
  // One product correction may require bounded rechecks when Jarvis fixes the
  // deterministic renderer or applies an exact claim-safety finding without
  // asking the model to redesign the product.
  if (reviewedFingerprints.size >= 4) {
    throw new Error("Pantheon has already used the one operator-authorised final quality review for this product revision.");
  }
  if (reviewedFingerprints.size >= 3 && !explicitOperatorFinalReview) {
    throw new Error("Pantheon stopped before creating another quality review for the same product revision.");
  }
  return { task: null, existing: false, sequence: reviewedFingerprints.size + 1 };
}

function assertQualityReviewRecheckAvailable(db, planId, revisionNumber) {
  const rows = all(
    db,
    `SELECT payload
     FROM tasks
     WHERE kind = 'live_ai_worker_execution'
       AND status <> 'cancelled'
       AND json_extract(payload, '$.liveSpendRequest.parameters.pantheonProduction.planId') = ?
       AND json_extract(payload, '$.liveSpendRequest.parameters.pantheonProduction.stage') = 'quality_review'`,
    [planId],
  ).map((row) => parseRow(row, ["payload"])).filter((row) => (
    Number(productMetadata(row)?.revisionNumber || 0) === Number(revisionNumber)
  ));
  const reviewedFingerprints = new Set(
    rows.map(qualityReviewFingerprintForTask).filter(Boolean),
  );
  if (reviewedFingerprints.size >= 3) {
    throw new Error("Pantheon stopped before creating another quality review for the same product revision.");
  }
  return {
    reviewedFingerprints: reviewedFingerprints.size,
    remainingRechecks: Math.max(0, 3 - reviewedFingerprints.size),
  };
}

function assertBuyerIntentProviderBudget(db, plan, requestedCapCents) {
  const validationSample = plan?.metadata?.validationSample;
  if (!validationSample) return;
  const combinedCapCents = Math.max(
    0,
    Number(validationSample.providerPolicy?.combinedCapCents || 0),
  );
  if (!combinedCapCents) {
    throw new Error("The buyer-intent provider budget is missing.");
  }
  const taskRows = all(
    db,
    `SELECT id
     FROM tasks
     WHERE kind = 'live_ai_worker_execution'
       AND status NOT IN ('cancelled', 'superseded')
       AND json_extract(payload, '$.liveSpendRequest.parameters.pantheonProduction.planId') = ?
       AND json_extract(payload, '$.liveSpendRequest.parameters.pantheonProduction.stage')
           IN ('product_build', 'quality_review')`,
    [plan.id],
  );
  const taskIds = taskRows.map((row) => row.id);
  let committed = 0;
  if (taskIds.length) {
    const placeholders = taskIds.map(() => "?").join(", ");
    const costs = all(
      db,
      `SELECT task_id, COALESCE(SUM(amount_cents), 0) AS cents
       FROM costs
       WHERE task_id IN (${placeholders})
         AND status NOT IN ('released', 'cancelled')
         AND amount_cents > 0
       GROUP BY task_id`,
      taskIds,
    );
    const reservations = all(
      db,
      `SELECT task_id, COALESCE(MAX(amount_cents), 0) AS cents
       FROM budget_reservations
       WHERE task_id IN (${placeholders})
         AND status IN ('reserved', 'incurred_estimate', 'unknown')
       GROUP BY task_id`,
      taskIds,
    );
    const costByTask = new Map(costs.map((row) => [row.task_id, Number(row.cents || 0)]));
    const reservationByTask = new Map(
      reservations.map((row) => [row.task_id, Number(row.cents || 0)]),
    );
    committed = taskIds.reduce(
      (total, taskId) => total + Math.max(
        costByTask.get(taskId) || 0,
        reservationByTask.get(taskId) || 0,
      ),
      0,
    );
  }
  const requested = Math.max(0, Number(requestedCapCents || 0));
  if (committed + requested > combinedCapCents) {
    throw new Error(
      `Pantheon stopped because this request would exceed the buyer-intent AI limit of `
      + `A$${(combinedCapCents / 100).toFixed(2)}.`,
    );
  }
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

function terminalizeInspectionEvidenceRecheckPersistence(db, plan) {
  const contract = plan?.metadata?.validationSample || {};
  const experimentId = String(contract.experimentId || "").trim();
  const candidateId = String(contract.candidateId || "").trim();
  const timestamp = now();

  if (experimentId) {
    run(
      db,
      `UPDATE commercial_experiments
       SET status = 'cancelled', ended_at = COALESCE(ended_at, ?), updated_at = ?
       WHERE id = ? AND status <> 'cancelled'`,
      [timestamp, timestamp, experimentId],
    );
  }

  const candidateSelectors = [];
  const candidateValues = [];
  if (candidateId) {
    candidateSelectors.push("id = ?");
    candidateValues.push(candidateId);
  }
  if (experimentId) {
    candidateSelectors.push("promoted_experiment_id = ?");
    candidateValues.push(experimentId);
  }
  if (candidateSelectors.length) {
    run(
      db,
      `UPDATE commercial_test_candidates
       SET status = 'cancelled', updated_at = ?
       WHERE status <> 'cancelled' AND (${candidateSelectors.join(" OR ")})`,
      [timestamp, ...candidateValues],
    );
  }

  const artifactIds = [...new Set([
    ...(Array.isArray(plan?.metadata?.generatedFileIds) ? plan.metadata.generatedFileIds : []),
    ...(Array.isArray(plan?.metadata?.storefrontPreviewIds) ? plan.metadata.storefrontPreviewIds : []),
    ...(Array.isArray(plan?.metadata?.qualityReviewImageIds) ? plan.metadata.qualityReviewImageIds : []),
  ].filter(Boolean).map(String))];
  if (artifactIds.length) {
    run(
      db,
      `UPDATE deliverables
       SET status = 'needs_changes', updated_at = ?
       WHERE id IN (${artifactIds.map(() => "?").join(", ")})
         AND status <> 'needs_changes'`,
      [timestamp, ...artifactIds],
    );
  }

  return {
    experimentId: experimentId || null,
    candidateId: candidateId || null,
    artifactIds,
  };
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
  const journey = journeyForPlan(db, plan);
  const validationSample = plan.metadata.validationSample || null;
  const workflowId = validationSample?.workflowId || round.metadata.workflowId;
  if (!workflowId) throw new Error("The product build has no exact owning workflow.");
  const requestedRoute = validationSample?.providerPolicy?.productBuilderRoute || null;
  const selectedModel = requestedRoute === "luna"
    ? CONFIG.lunaModel
    : requestedRoute === "terra"
      ? CONFIG.terraModel
      : journey?.model || CONFIG.terraModel;
  const productTitle = actualProductTitle(plan, opportunityRecord);
  const estimatedCostCents = Number(
    validationSample?.providerPolicy?.productBuilderCapCents || 200,
  );
  assertBuyerIntentProviderBudget(db, plan, estimatedCostCents);
  const operatorChoiceRequired = input.operatorChoiceRequired !== false;
  const request = requestLiveAiWorker(db, workflowId, {
    requestKey: `catalogue_build_${safeId(plan.id)}_r${revisionNumber}`,
    requestedBy: operatorChoiceRequired ? "chief_of_staff" : "pantheon_quality_recovery",
    worker: "product_builder",
    taskTitle: revisionNumber
      ? `Correct and rebuild ${productTitle}`
      : validationSample
        ? `Build the ${productTitle} validation workbook`
        : `Build ${productTitle}`,
    approvalTitle: revisionNumber
      ? `Correct the ${productTitle} product files`
      : validationSample
        ? `Build the ${productTitle} validation package`
        : `Build and quality-check the ${items.length}-product catalogue`,
    estimatedCostCents,
    reason: operatorChoiceRequired
      ? validationSample
        ? "Create one exact local validation workbook and two previews so willingness to pay and Excel-format acceptance can be tested. Nothing will be published, sent, or uploaded."
        : `Create the exact ${items.length}-item local product catalogue that Daniel reviewed. Nothing will be published, sent, or uploaded to a marketplace.`
      : "Correct the exact local product package after Pantheon's Quality Reviewer found a material defect. Nothing will be published or sent.",
    expectedOutput: `A real downloadable ${spec.bundleFilename}, ${spec.manifestFilename}, and a structured production summary. Planning prose without files is a failed build.`,
    expectedMetric: `Pantheon downloads, hashes, validates, and maps usable product files to all ${items.length} approved catalogue items.`,
    model: selectedModel,
    modelLocked: validationSample ? true : journey?.model_locked === 1,
    maxInputTokens: validationSample ? 40000 : 64000,
    maxOutputTokens: validationSample ? 6000 : 8000,
    maxTurns: 1,
    maxToolCalls: 0,
    deadlineMs: 180000,
    contextClasses: validationSample
      ? ["venture", "production", "legal"]
      : undefined,
    tools: ["product_file_factory"],
    toolArguments: {
      product_file_factory: {
        renderer: "pantheon-local-digital-product-factory-v1",
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
      objective: validationSample
        ? "Design the exact customer contents for the one validation workbook in approvedProductBuildSpec."
        : `Design the exact customer contents for the complete ${items.length}-item catalogue in approvedProductBuildSpec.`,
      deliverable: `Return one strict Product Builder result containing a complete productBlueprint. Pantheon will turn it into ${spec.bundleFilename} and ${spec.manifestFilename} locally after validation.`,
      assetPrompt: [
        `The manifest must use schema ${PRODUCT_MANIFEST_SCHEMA} and exactly match planId ${plan.id} and opportunityId ${opportunityRecord.id}.`,
        validationSample
          ? "Use approvedProductBuildSpec.validationSample.exactItemBlueprint as the required minimum structure. Preserve its exact item ID, named fields, status options, formulas, sample records, setup steps, customer promise, and limitations. Improve clarity only when every required function remains present."
          : null,
        "Its catalogueItems array must contain every exact catalogue item id. Each item must list the real customer-facing files that exist inside the returned bundle.",
        "Define complete customer-usable trackers, instructions, fields, and realistic examples. Do not return outlines, lorem ipsum, TODO markers, empty worksheets, or claims that files already exist.",
        "Keep the strict blueprint compact: one short sentence per purpose, instruction, and field guide; use one realistic sample row unless a second is essential; do not repeat the same explanation.",
        "Calculations are row-level only. The supported operations are sum, subtract, multiply, and percent_of using values from columns in the same row and the same catalogue item. Never request grouping, cross-row totals, SUMIF or SUMIFS logic, lookups, counts, running totals, or date arithmetic. Make category, month, or other aggregate totals user-entered reviewed fields and omit them from calculations.",
        "For any promised row-level calculator, every calculation target and input must exactly copy a column.name from that same catalogue item, with no explanatory prose added to an input name. For percent_of use exactly [numerator column name, denominator column name]. Use an empty calculations array when no supported row-level formula is required. For any promised email or message scripts, include an Email Body, Message Copy, Script Text, or Script Wording field with actual editable wording in the sample data.",
        "Every column must include options. Use [] for non-status fields. For every status field, list all 2-12 allowed dropdown values explicitly in options. Copy each sample status value character-for-character from that field's options; never append punctuation, translations, symbols, or commentary.",
        "Every catalogue item must include a dedicated Status, Workflow Status, Message Status, Contact Status, or Completion Status field. Give that field a recognised successful value such as Complete, Sent, Closed, Approved, Confirmed, or Ready so the Dashboard counts the correct workflow field.",
        "When a product promises a finite sequence of up to three steps, include one realistic sample row for every promised step and include every step name in that field's options.",
        "Map every approved catalogue promise to exact visible support in that item's fields, instructions, formulas, checklist, validation options, or statuses.",
        "If an approved offer says confirm, verify, approve, complete, or organize something, implement the named target and the exact confirmation, completeness, approval, index, or status mechanism. If the promise is not supportable, narrow the customer-facing purpose to a literal functional description.",
      ].filter(Boolean).join(" "),
      requiredCorrections: revisionNumber
        ? (spec.revisionCorrections.length ? spec.revisionCorrections : ["Rebuild the defective package and resolve the recorded quality finding."])
        : [],
      constraints: [
        "No internet, publishing, customer contact, account action, legal decision, or money movement.",
        "Do not include executables, scripts, macros, credentials, personal data, or external tracking.",
        "Use ordinary customer-facing language and clearly label assumptions or educational limitations.",
        "Do not claim better, fewer, faster, improved, reduced, guaranteed, or completed outcomes before real customer measurement.",
        "Prefer functional verbs such as organize, track, record, display, calculate, and plan.",
      ],
      acceptanceCriteria: [
        ...(revisionNumber ? ["Every requiredCorrections item is visibly resolved in the corrected customer files."] : []),
        `All ${items.length} exact catalogue item IDs appear once in the manifest.`,
        "Every item maps to at least one real file in the bundle.",
        "Files open cleanly and include practical instructions or examples where useful.",
        "Every customer-facing purpose and approved offer is supported by an exact field, instruction, formula, checklist, validation option, or status.",
        ...(spec.storefrontPreviewCount
          ? [`Create exactly ${spec.storefrontPreviewCount} PNG storefront previews in ${spec.storefrontPreviewDirectory}/, derived from the actual customer files rather than invented mockups, and list them in manifest.storefrontPreviews.`]
          : []),
        "Every sample row has exactly one value for every defined column.",
        "Every controlled field contains the complete promised option set, every sample status value exactly equals one declared option, and every item has a dedicated workflow-status field used by its Dashboard.",
        "Every calculation uses only supported row-level logic and exact same-item column names; aggregate or cross-row values are user-entered rather than represented as formulas.",
        "Every item declares calculations as an array. Use an empty array only when that item makes no calculation promise.",
      ],
    },
    parameters: {
      ...journeyParameters(journey),
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
        journeyId: journey?.id || null,
        buyerIntentValidation: validationSample ? {
          specId: validationSample.specId,
          contractHash: validationSample.contractHash,
        } : null,
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
  if (journey) {
    updateJourney(db, journey.id, {
      status: operatorChoiceRequired ? "waiting_for_operator" : "running",
      activeStage: "product_build",
      selectedOpportunityId: opportunityRecord.id,
      metadata: {
        currentTaskId: request.task?.id || null,
        currentApprovalId: request.approval?.id || null,
        cataloguePlanId: plan.id,
      },
      stageEvent: {
        stage: "product_build",
        status: request.task?.status || "waiting_to_start",
        taskId: request.task?.id || null,
        workerId: "product_builder",
        note: revisionNumber ? "A corrected product build was prepared." : "The complete product build was prepared.",
      },
    });
  }
  return { ...request, spec, existing: false };
}

function generatedProductResult(task) {
  const generated = taskOutput(task).generatedFiles;
  if (!generated || !Array.isArray(generated.files) || !generated.manifest) {
    throw new Error("A completed Product Builder task has no validated local product-file package.");
  }
  return generated;
}

function markCatalogueDeliverablesQualityPassed(db, plan, generated) {
  const visualIds = [
    ...(plan.metadata.storefrontVisualIds || []),
    ...(plan.metadata.storefrontPreviewIds || []),
    ...(plan.metadata.qualityReviewImageIds || []),
    ...(generated.previews || []).map((preview) => preview.id),
    ...(generated.qualityReviewImages || []).map((image) => image.id),
  ];
  const reviewedDeliverableIds = [...new Set([
    ...(generated.files || []).map((file) => file.id).filter(Boolean),
    ...visualIds,
  ])];
  if (reviewedDeliverableIds.length) {
    const placeholders = reviewedDeliverableIds.map(() => "?").join(", ");
    run(
      db,
      `UPDATE deliverables SET status = 'quality_passed', updated_at = ?
       WHERE id IN (${placeholders})`,
      [now(), ...reviewedDeliverableIds],
    );
  }
  run(
    db,
    `UPDATE deliverables SET status = 'quality_passed', updated_at = ?
     WHERE id IN (SELECT deliverable_id FROM catalogue_items WHERE plan_id = ? AND deliverable_id IS NOT NULL)`,
    [now(), plan.id],
  );
  return reviewedDeliverableIds;
}

function supersedeUnstartedProductionTask(db, task, reason) {
  const evidence = get(
    db,
    `SELECT
       (SELECT COUNT(*) FROM task_attempts WHERE task_id = ?) AS attempts,
       (SELECT COUNT(*) FROM model_calls WHERE task_id = ?) AS model_calls,
       (SELECT COUNT(*) FROM agent_runs WHERE task_id = ?) AS agent_runs,
       (SELECT COUNT(*) FROM costs
        WHERE task_id = ? AND status IN ('reserved', 'incurred_estimate', 'unknown', 'reconciled')) AS costs`,
    [task.id, task.id, task.id, task.id],
  );
  if (
    !["queued", "planned", "blocked", "waiting_approval"].includes(task.status)
    || Object.values(evidence || {}).some((count) => Number(count || 0) > 0)
  ) {
    throw new Error(
      "Pantheon cannot replace this product-stage request because execution evidence already exists.",
    );
  }
  const ts = now();
  run(
    db,
    `UPDATE tasks
     SET status = 'cancelled', outcome_status = 'failed_before_effect',
         error = ?, completed_at = COALESCE(completed_at, ?), updated_at = ?
     WHERE id = ?`,
    [reason, ts, ts, task.id],
  );
  if (task.approval_id) {
    run(
      db,
      `UPDATE approvals
       SET status = 'superseded', decided_at = COALESCE(decided_at, ?),
           decision_note = ?
       WHERE id = ? AND status IN ('pending', 'approved')`,
      [ts, reason, task.approval_id],
    );
    run(
      db,
      `UPDATE approval_action_tokens
       SET status = 'superseded', used_at = COALESCE(used_at, ?)
       WHERE approval_id = ? AND status IN ('active', 'approved')`,
      [ts, task.approval_id],
    );
  }
  run(
    db,
    `UPDATE messages
     SET status = 'resolved', resolved_at = COALESCE(resolved_at, ?)
     WHERE task_id = ? AND status = 'open'`,
    [ts, task.id],
  );
  insertEvent(db, {
    level: "info",
    actor: "jarvis",
    type: "production.unstarted_request_superseded",
    entityType: "task",
    entityId: task.id,
    message: "Pantheon retired an unstarted product-stage request because its exact input package changed.",
    metadata: {
      approvalId: task.approval_id || null,
      reason,
      noProviderCall: true,
      noSpendOccurred: true,
    },
  });
}

function queueStorefrontVisual(db, plan, opportunityRecord, buildTask, generated) {
  const revisionNumber = Number(productMetadata(buildTask)?.revisionNumber || 0);
  const existing = existingProductionTask(db, plan.id, "storefront_visuals", revisionNumber);
  if (existing) {
    const existingBuildTaskId = productMetadata(existing)?.buildTaskId || null;
    if (existingBuildTaskId === buildTask.id) {
      return { task: existing, existing: true };
    }
    supersedeUnstartedProductionTask(
      db,
      existing,
      "The exact locally rendered product package changed before storefront work began.",
    );
  }
  const journey = journeyForPlan(db, plan);
  const productTitle = actualProductTitle(plan, opportunityRecord);
  const request = requestLiveAiWorker(db, buildTask.workflow_id, {
    requestKey: `catalogue_storefront_visual_${safeId(plan.id)}_r${revisionNumber}`,
    requestedBy: "pantheon_supervisor",
    worker: "product_builder",
    taskTitle: `Create the storefront cover for ${productTitle}`,
    approvalTitle: `Create one storefront cover for ${productTitle}`,
    estimatedCostCents: 100,
    reason: "Create one exact, capped local storefront cover for the finished product. Nothing will be published or sent.",
    expectedOutput: "One locally stored cover image, a concise production note, and honest limitations.",
    expectedMetric: "Exactly one truthful cover image is stored and linked to the finished product before independent review.",
    model: journey?.model || CONFIG.terraModel,
    modelLocked: journey?.model_locked === 1,
    maxOutputTokens: 2400,
    maxTurns: 2,
    maxToolCalls: 1,
    deadlineMs: 180000,
    tools: ["image_generation_spend"],
    toolArguments: {
      image_generation_spend: {
        quality: "low",
        size: "1024x1024",
        outputFormat: "png",
      },
    },
    businessContext: {
      subject: opportunityRecord.title,
      buyer: opportunityRecord.buyer,
      problem: opportunityRecord.problem,
      offer: opportunityRecord.offer_direction,
      channel: "Gumroad digital product",
      evidenceStandard: "The cover may represent the real product theme, but must not depict features, testimonials, results, brands, or included files that do not exist.",
    },
    workBrief: {
      objective: `Create a clean storefront cover background for ${opportunityRecord.title}.`,
      deliverable: "One square PNG background that Pantheon will finish with an exact local product-title overlay for the Gumroad product card.",
      assetPrompt: `Professional, clean digital-product cover artwork for ${opportunityRecord.title}, designed for ${opportunityRecord.buyer}. Show an abstract workflow using restrained geometric panels and connecting lines. Do not include people, human silhouettes, profile symbols, user icons, stars, ratings, review marks, badges, logos, trademarks, testimonials, screenshots, numbers, or readable text. Use a composed business-ready layout with clear central space for a later title overlay. Do not imitate a named brand or artist.`,
      constraints: [
        "No readable text, logos, trademarks, people or people-related pictograms, stars, ratings, review symbols, testimonials, prices, guarantees, or unsupported product features.",
        "No publishing or external action.",
      ],
      acceptanceCriteria: [
        "Exactly one 1024x1024 PNG is returned.",
        "The background is relevant to the real product and leaves clean space for Pantheon's exact local title overlay.",
        "The visual does not misrepresent the included product files.",
      ],
    },
    parameters: {
      ...journeyParameters(journey),
      ...(journey ? {} : { requiredReviewer: "quality_reviewer" }),
      pantheonProduction: {
        supervisorOwned: true,
        stage: "storefront_visuals",
        roundId: productMetadata(buildTask).roundId,
        opportunityId: opportunityRecord.id,
        planId: plan.id,
        buildTaskId: buildTask.id,
        revisionNumber,
        journeyId: journey?.id || null,
        customerPromise: actualProductPromise(plan, opportunityRecord),
      },
    },
    effects: [],
    tracePolicy: {
      providerResponseStored: false,
      providerTraceContent: false,
      dataClass: "business_internal",
      purpose: "Retain the generated asset locally while keeping the provider trace free of private content.",
    },
  });
  if (journey) {
    updateJourney(db, journey.id, {
      status: "running",
      activeStage: "storefront_visuals",
      metadata: {
        currentTaskId: request.task?.id || null,
        currentApprovalId: request.approval?.id || null,
      },
      stageEvent: {
        stage: "storefront_visuals",
        status: request.task?.status || "waiting_to_start",
        taskId: request.task?.id || null,
        workerId: "product_builder",
        note: "A truthful storefront cover is ready to generate from the finished product direction.",
      },
    });
  }
  return request;
}

function compactReviewText(value, max = 500) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}

function reviewDeliverableFact(db, deliverableId) {
  const row = get(
    db,
    `SELECT id, human_name, title, format, status, content_hash, metadata
     FROM deliverables WHERE id = ?`,
    [deliverableId],
  );
  if (!row) throw new Error(`Quality review asset not found: ${deliverableId}`);
  const metadata = fromJson(row.metadata, {});
  return {
    id: row.id,
    name: row.human_name || row.title,
    format: row.format,
    status: row.status,
    bytes: Number(metadata.bytes || 0),
    sha256: row.content_hash || metadata.sha256 || null,
    derivedFromProductFiles: metadata.derivedFromProductFiles === true,
    inspectionCoverage: metadata.inspectionCoverage || null,
  };
}

function formulaRangeFact(range, formula = "") {
  const match = /^([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/.exec(String(range || "").toUpperCase());
  if (!match || (match[3] && match[1] !== match[3])) return null;
  const startRow = Number(match[2]);
  const endRow = Number(match[4] || match[2]);
  if (endRow < startRow) return null;
  return {
    sheet: "Tracker",
    range: String(range).toUpperCase(),
    count: endRow - startRow + 1,
    firstFormula: String(formula || ""),
    lastFormula: "",
  };
}

function formulaCellCovered(formula, coverage) {
  const cellMatch = /^([A-Z]+)(\d+)$/.exec(String(formula?.cell || "").toUpperCase());
  if (!cellMatch) return false;
  return coverage.some((item) => {
    if (String(item.sheet || "") !== String(formula.sheet || "")) return false;
    const rangeMatch = /^([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/.exec(String(item.range || "").toUpperCase());
    if (!rangeMatch || cellMatch[1] !== rangeMatch[1] || (rangeMatch[3] && cellMatch[1] !== rangeMatch[3])) return false;
    const row = Number(cellMatch[2]);
    return row >= Number(rangeMatch[2]) && row <= Number(rangeMatch[4] || rangeMatch[2]);
  });
}

function formulaCoverageForValidation(validation = {}) {
  const explicit = Array.isArray(validation.formulaCoverage) ? validation.formulaCoverage : [];
  if (explicit.length) return explicit;
  const calculatedCoverage = (Array.isArray(validation.calculatedFields) ? validation.calculatedFields : [])
    .map((field) => formulaRangeFact(field?.range, field?.formula))
    .filter(Boolean);
  const standalone = (Array.isArray(validation.formulas) ? validation.formulas : [])
    .filter((formula) => !formulaCellCovered(formula, calculatedCoverage))
    .map((formula) => ({
      sheet: String(formula.sheet || ""),
      range: String(formula.cell || ""),
      count: 1,
      firstFormula: String(formula.formula || ""),
      lastFormula: String(formula.formula || ""),
    }));
  return [...calculatedCoverage, ...standalone];
}

function completeFormulaEvidence(validation = {}) {
  const totalFormulaCells = Number(validation.formulaCells || 0);
  const samples = Array.isArray(validation.formulas) ? validation.formulas : [];
  const coverage = formulaCoverageForValidation(validation);
  const coveredFormulaCells = coverage.reduce(
    (total, item) => total + Math.max(0, Number(item?.count || 0)),
    0,
  );
  if (totalFormulaCells === 0) {
    return samples.length === 0 && coveredFormulaCells === 0;
  }
  return coverage.length > 0
    ? coveredFormulaCells === totalFormulaCells
    : samples.length === totalFormulaCells;
}

function buildQualityReviewPacket(
  db,
  plan,
  opportunityRecord,
  buildTask,
  generated,
  visualAssetIds,
  reviewAssetIds,
) {
  const manifest = generated.manifest || {};
  const manifestItems = Array.isArray(manifest.catalogueItems) ? manifest.catalogueItems : [];
  const manifestFiles = Array.isArray(manifest.files) ? manifest.files : [];
  const bundleFile = (generated.files || []).find((file) => /\.zip$/i.test(String(file.humanName || "")));
  const builderOutput = taskOutput(buildTask);
  const approvedCatalogueItems = catalogueItems(db, plan.id);
  const exactExpectedIds = approvedCatalogueItems.map((item) => item.id);
  const actualIds = manifestItems.map((item) => String(item.id || item.catalogueItemId || ""));
  return {
    schema: "pantheon.product-quality-review-packet.v3",
    planId: plan.id,
    opportunityId: opportunityRecord.id,
    buildTaskId: buildTask.id,
    revisionNumber: Number(productMetadata(buildTask)?.revisionNumber || 0),
    constructionMode: generated.constructionMode || "not_recorded",
    constructionExplanation: generated.constructionMode === "contract_defined_model_assisted"
      ? "The approved buyer-test contract defined the customer-file structure; the model supplied bounded judgement and wording before deterministic rendering."
      : "The model blueprint was rendered deterministically into the retained customer files.",
    packageTitle: compactReviewText(manifest.packageTitle, 240),
    customerPromise: compactReviewText(manifest.customerPromise, 500),
    assetProvenance: manifest.assetProvenance ? {
      sourceType: compactReviewText(manifest.assetProvenance.sourceType, 120),
      externalAssetsUsed: (manifest.assetProvenance.externalAssetsUsed || [])
        .map((value) => compactReviewText(value, 240)),
      customerDataUsed: manifest.assetProvenance.customerDataUsed === true,
      statement: compactReviewText(manifest.assetProvenance.statement, 700),
    } : null,
    deliveryFormat: compactReviewText(manifest.deliveryFormat, 320),
    customerInstructionSource: String(manifest.customerInstructionSource || "unknown"),
    expectedCatalogueCount: Number(plan.target_item_count || 0),
    approvedCatalogueItems: approvedCatalogueItems.map((item) => ({
      id: item.id,
      title: compactReviewText(item.title, 240),
      audience: compactReviewText(item.audience, 360),
      promisedOffer: compactReviewText(item.offer, 600),
      priceCents: Number(item.price_cents || 0),
    })),
    catalogueItems: manifestItems.map((item) => ({
      id: String(item.id || item.catalogueItemId || ""),
      title: compactReviewText(item.title, 240),
      purpose: compactReviewText(item.purpose, 420),
      files: (Array.isArray(item.files) ? item.files : []).map(String),
      validation: {
        sheets: (item.validation?.sheets || []).map(String),
        columns: Number(item.validation?.columns || 0),
        sampleRows: Number(item.validation?.sampleRows || 0),
        formulaCells: Number(item.validation?.formulaCells || 0),
        reopened: item.validation?.reopened === true,
        instructionColumns: ["cell", "text"],
        instructions: (item.validation?.instructions || []).map((instruction) => [
          String(instruction.cell || ""),
          compactReviewText(instruction.text, 420),
        ]),
        fieldColumns: ["name", "type", "guidance", "trackerHeader", "readMeCell", "readMeText"],
        fields: (item.validation?.fields || []).map((field) => [
          compactReviewText(field.name, 120),
          compactReviewText(field.type, 60),
          compactReviewText(field.guidance, 320),
          compactReviewText(field.trackerHeader, 120),
          String(field.readMeCell || ""),
          compactReviewText(field.readMeText, 320),
        ]),
        sampleData: {
          headers: (item.validation?.sampleData?.headers || []).map((value) => compactReviewText(value, 160)),
          rows: (item.validation?.sampleData?.rows || []).map((row) => (
            (Array.isArray(row) ? row : []).map((value) => compactReviewText(value, 160))
          )),
        },
        formulaColumns: ["sheet", "cell", "formula"],
        formulas: (item.validation?.formulas || []).map((formula) => [
          String(formula.sheet || ""),
          String(formula.cell || ""),
          compactReviewText(formula.formula, 240),
        ]),
        calculatedFieldColumns: ["target", "operation", "inputs", "formula", "range"],
        calculatedFields: (item.validation?.calculatedFields || []).map((field) => [
          compactReviewText(field.target, 120),
          compactReviewText(field.operation, 80),
          (field.inputs || []).map((value) => compactReviewText(value, 120)),
          compactReviewText(field.formula, 240),
          String(field.range || ""),
        ]),
        sampleCalculationChecks: (item.validation?.sampleCalculationChecks || []).map((check) => ({
          trackerRow: Number(check.trackerRow || 0),
          record: compactReviewText(check.record, 120),
          results: (check.results || []).map((result) => ({
            target: compactReviewText(result.target, 120),
            operation: compactReviewText(result.operation, 80),
            inputs: (result.inputs || []).map((value) => compactReviewText(value, 120)),
            value: Number.isFinite(Number(result.value)) ? Number(result.value) : null,
            display: compactReviewText(result.display, 80),
          })),
        })),
        dashboardExpectedResults: item.validation?.dashboardExpectedResults || null,
        formulaEvidence: {
          totalFormulaCells: Number(item.validation?.formulaCells || 0),
          sampleCount: Array.isArray(item.validation?.formulas) ? item.validation.formulas.length : 0,
          samplePolicy: String(item.validation?.formulaSamplePolicy || (
            Number(item.validation?.formulaCells || 0) > (item.validation?.formulas || []).length
              ? "compact_samples_with_complete_ranges"
              : "complete"
          )),
          coverageColumns: ["sheet", "range", "count", "firstFormula", "lastFormula"],
          coverage: formulaCoverageForValidation(item.validation).map((coverage) => [
            String(coverage.sheet || ""),
            String(coverage.range || ""),
            Number(coverage.count || 0),
            compactReviewText(coverage.firstFormula, 240),
            compactReviewText(coverage.lastFormula, 240),
          ]),
          completeCoverage: completeFormulaEvidence(item.validation),
        },
        dataValidationColumns: ["sheet", "type", "formula", "range", "allowBlank"],
        dataValidations: (item.validation?.dataValidations || []).map((validation) => [
          String(validation.sheet || ""),
          String(validation.type || ""),
          compactReviewText(validation.formula, 240),
          String(validation.range || ""),
          validation.allowBlank === true,
        ]),
        statusFields: (item.validation?.statusFields || []).map((statusField) => ({
          field: compactReviewText(statusField.field, 120),
          column: String(statusField.column || ""),
          options: (statusField.options || []).map((value) => compactReviewText(value, 80)),
          positiveStatus: compactReviewText(statusField.positiveStatus, 80) || null,
        })),
        dashboardMetric: item.validation?.dashboardMetric ? {
          label: compactReviewText(item.validation.dashboardMetric.label, 160),
          formula: compactReviewText(item.validation.dashboardMetric.formula, 240),
          statusField: compactReviewText(item.validation.dashboardMetric.statusField, 120),
          countedValue: compactReviewText(item.validation.dashboardMetric.countedValue, 80) || null,
          countedValueInValidation: item.validation.dashboardMetric.countedValueInValidation === true,
        } : null,
        sheetSummaryColumns: ["sheet", "summary"],
        sheetSummary: Object.entries(item.validation?.sheetSummary || {}).map(([sheet, summary]) => [
          String(sheet),
          compactReviewText(summary, 260),
        ]),
      },
    })),
    sharedFiles: (Array.isArray(manifest.sharedFiles) ? manifest.sharedFiles : []).map(String),
    setupGuide: manifest.setupGuide ? {
      path: String(manifest.setupGuide.path || ""),
      contentSource: String(manifest.setupGuide.contentSource || ""),
      quickStart: (manifest.setupGuide.quickStart || []).map((value) => compactReviewText(value, 420)),
      products: (manifest.setupGuide.products || []).map((item) => ({
        title: compactReviewText(item.title, 180),
        purpose: compactReviewText(item.purpose, 600),
        instructions: (item.instructions || []).map((value) => compactReviewText(value, 420)),
        fieldColumns: ["name", "guidance"],
        fields: (item.fields || []).map((field) => [
          compactReviewText(Array.isArray(field) ? field[0] : field?.name, 100),
          compactReviewText(Array.isArray(field) ? field[1] : field?.guidance, 320),
        ]),
      })),
      disclaimers: (manifest.setupGuide.disclaimers || []).map((value) => compactReviewText(value, 500)),
    } : null,
    archiveInventory: manifestFiles.map((file) => ({
      path: String(file.path || ""),
      bytes: Number(file.bytes || 0),
      sha256: String(file.sha256 || ""),
    })),
    bundle: bundleFile ? {
      filename: String(bundleFile.humanName || manifest.bundle?.filename || ""),
      bytes: Number(bundleFile.bytes || 0),
      sha256: String(bundleFile.sha256 || ""),
      canonicalManifestInsideBundle: generated.manifestEmbeddedIdentical === true,
      archiveInventoryVerified: generated.archiveInventoryVerified === true,
    } : null,
    packageDeliverables: (generated.files || []).map((file) => ({
      id: file.id,
      name: file.humanName,
      format: file.format,
      bytes: Number(file.bytes || 0),
      sha256: file.sha256 || null,
    })),
    storefrontPreviews: (generated.previews || []).map((preview) => reviewDeliverableFact(db, preview.id)),
    fileInspectionVisuals: (generated.qualityReviewImages || []).map((image) => reviewDeliverableFact(db, image.id)),
    storefrontVisuals: visualAssetIds.map((id) => reviewDeliverableFact(db, id)),
    approvedVisualReviewIds: reviewAssetIds,
    deterministicChecks: {
      manifestSchemaValid: manifest.schema === PRODUCT_MANIFEST_SCHEMA,
      exactCatalogueCoverage: (
        actualIds.length === exactExpectedIds.length
        && new Set(actualIds).size === actualIds.length
        && exactExpectedIds.every((id) => actualIds.includes(id))
      ),
      everyItemHasFiles: manifestItems.every((item) => Array.isArray(item.files) && item.files.length > 0),
      everyWorkbookReopened: manifestItems.every((item) => item.validation?.reopened === true),
      archiveInventoryRecorded: manifestFiles.length > 0,
      standaloneManifestMatchesArchive: generated.manifestEmbeddedIdentical === true,
      archiveInventoryVerified: generated.archiveInventoryVerified === true,
      workbookSemanticsExposed: manifestItems.every((item) => (
        Array.isArray(item.validation?.instructions)
        && item.validation.instructions.length >= 2
        && Array.isArray(item.validation?.fields)
        && item.validation.fields.length === Number(item.validation?.columns || 0)
        && Array.isArray(item.validation?.sampleData?.rows)
        && item.validation.sampleData.rows.length === Number(item.validation?.sampleRows || 0)
        && Array.isArray(item.validation?.formulas)
        && completeFormulaEvidence(item.validation)
      )),
      formulaCoverageComplete: manifestItems.every((item) => completeFormulaEvidence(item.validation)),
      customerInstructionsDerivedFromActualFiles: (
        manifest.customerInstructionSource === "generated_from_actual_files_by_local_factory"
      ),
      assetProvenanceDeclared: (
        manifest.assetProvenance?.sourceType === "pantheon_local_generation"
        && Array.isArray(manifest.assetProvenance?.externalAssetsUsed)
        && manifest.assetProvenance.externalAssetsUsed.length === 0
        && manifest.assetProvenance?.customerDataUsed === false
      ),
      dashboardStatusMetricsMatchDropdowns: manifestItems.every((item) => (
        !item.validation?.dashboardMetric
        || item.validation.dashboardMetric.countedValueInValidation === true
      )),
      sampleCalculationsIndependentlyChecked: manifestItems.every((item) => {
        const calculations = Array.isArray(item.validation?.calculatedFields)
          ? item.validation.calculatedFields
          : [];
        if (!calculations.length) return true;
        const checks = Array.isArray(item.validation?.sampleCalculationChecks)
          ? item.validation.sampleCalculationChecks
          : [];
        return checks.length === Number(item.validation?.sampleRows || 0)
          && checks.every((check) => (
            Array.isArray(check.results)
            && check.results.length === calculations.length
            && check.results.every((result) => Number.isFinite(Number(result.value)))
          ));
      }),
      setupGuideContentExposed: (
        manifest.setupGuide?.contentSource === "same_claim_safe_blueprint_used_to_render_pdf"
        && Array.isArray(manifest.setupGuide.products)
        && manifest.setupGuide.products.length === manifestItems.length
      ),
      externalActionsTaken: Array.isArray(manifest.externalActionsTaken)
        ? manifest.externalActionsTaken.map(String)
        : [],
      publishingStatus: String(manifest.publishingStatus || "unknown"),
    },
    builderSummary: compactReviewText(builderOutput.summary, 500),
    builderQualityChecks: (builderOutput.roleOutput?.qualityChecks || []).map((item) => compactReviewText(item, 240)).slice(0, 8),
    reviewInstructions: [
      "Treat deterministic checks and hashes as file-integrity evidence, not as proof of buyer value.",
      "Formula samples are intentionally compact for large workbooks. Use formulaEvidence.totalFormulaCells, coverage ranges, and completeCoverage to judge deterministic coverage; do not treat the sample count as the workbook's formula count.",
      "Use sampleCalculationChecks as Pantheon's independent arithmetic verification of the exact sample rows; the saved workbook remains configured to recalculate formulas when opened in Excel.",
      "Use assetProvenance to distinguish locally generated package elements from third-party assets; do not request external rights evidence when externalAssetsUsed is empty.",
      "Inspect every approved visual for clipping, misleading motifs, unsupported claims, and consistency with the real package.",
      "QA-only file inspection visuals are rendered from the exact saved XLSX and PDF and are not customer-facing storefront assets.",
      "Compare each approved catalogue promise with the exact workbook fields, instructions, sample data, and delivery format. Do not pass a technically valid but commercially empty or misrepresented package.",
      `Pass only when the complete ${manifestItems.length}-part package is usable, truthfully represented, and has no unresolved material defect.`,
    ],
  };
}

function queueQualityReview(
  db,
  plan,
  opportunityRecord,
  buildTask,
  generated,
  visualAssetIds = [],
  options = {},
) {
  const revisionNumber = Number(productMetadata(buildTask)?.revisionNumber || 0);
  const journey = journeyForPlan(db, plan);
  const validationSample = plan.metadata.validationSample || null;
  const productTitle = actualProductTitle(plan, opportunityRecord);
  const explicitOperatorFinalReview = options.explicitOperatorFinalReview === true;
  const inspectionEvidenceRecheck = options.inspectionEvidenceRecheck === true;
  const operatorReviewRequired = explicitOperatorFinalReview || inspectionEvidenceRecheck;
  const requestedRoute = validationSample?.providerPolicy?.qualityReviewerRoute || null;
  const selectedModel = requestedRoute === "luna"
    ? CONFIG.lunaModel
    : requestedRoute === "terra"
      ? CONFIG.terraModel
      : journey?.model || CONFIG.terraModel;
  const estimatedCostCents = Number(
    validationSample?.providerPolicy?.qualityReviewerCapCents || 100,
  );
  const files = generated.files.map((file) => ({
    id: file.id,
    name: file.humanName,
    format: file.format,
    bytes: file.bytes,
    sha256: file.sha256,
  }));
  const reviewAssetIds = [...new Set(validationSample ? [
    ...(generated.qualityReviewImages || []).map((image) => image.id),
    ...(generated.previews || []).map((preview) => preview.id),
    ...visualAssetIds,
  ] : [
    ...visualAssetIds,
    ...(generated.previews || []).map((preview) => preview.id),
    ...(generated.qualityReviewImages || []).map((image) => image.id),
  ])].slice(0, 4);
  for (const visualId of visualAssetIds) {
    run(
      db,
      `UPDATE deliverables
       SET status = 'built_pending_quality_review', updated_at = ?
       WHERE id = ? AND status = 'draft'`,
      [now(), visualId],
    );
  }
  const reviewBindings = buildDeliverableReviewBindings(
    db,
    buildTask.workflow_id,
    generated.files.map((file) => file.id),
  );
  const qualityReviewPacket = buildQualityReviewPacket(
    db,
    plan,
    opportunityRecord,
    buildTask,
    generated,
    visualAssetIds,
    reviewAssetIds,
  );
  if (options.requireFormulaEvidenceRepair === true && (
    qualityReviewPacket.deterministicChecks.workbookSemanticsExposed !== true
    || qualityReviewPacket.deterministicChecks.formulaCoverageComplete !== true
  )) {
    throw new Error("The local evidence repair did not prove complete workbook semantics and formula coverage.");
  }
  const fingerprint = reviewFingerprint(reviewBindings, qualityReviewPacket);
  const staleReviews = all(
    db,
    `SELECT * FROM tasks
     WHERE kind = 'live_ai_worker_execution'
       AND status IN ('queued', 'planned', 'blocked', 'waiting_approval')
       AND json_extract(payload, '$.liveSpendRequest.parameters.pantheonProduction.planId') = ?
       AND json_extract(payload, '$.liveSpendRequest.parameters.pantheonProduction.stage') = 'quality_review'
     ORDER BY created_at, id`,
    [plan.id],
  ).map((row) => parseRow(row, ["payload", "result"])).filter((row) => (
    Number(productMetadata(row)?.revisionNumber || 0) === revisionNumber
    && qualityReviewFingerprintForTask(row) !== fingerprint
  ));
  for (const staleReview of staleReviews) {
    supersedeUnstartedProductionTask(
      db,
      staleReview,
      "The exact product files or review packet changed before this quality review began.",
    );
  }
  const prior = existingQualityReviewTask(db, plan.id, revisionNumber, fingerprint, options);
  if (prior.task) {
    return {
      task: prior.task,
      approval: prior.task.approval_id
        ? get(db, "SELECT * FROM approvals WHERE id = ?", [prior.task.approval_id])
        : null,
      existing: true,
    };
  }
  assertBuyerIntentProviderBudget(db, plan, estimatedCostCents);
  const requestKeySuffix = options.requestKeySuffix
    ? `_${safeId(options.requestKeySuffix)}`
    : "";
  const request = requestLiveAiWorker(db, buildTask.workflow_id, {
    requestKey: `catalogue_quality_${safeId(plan.id)}_r${revisionNumber}_${fingerprint.slice(0, 12)}${requestKeySuffix}`,
    requestedBy: "pantheon_supervisor",
    worker: "quality_reviewer",
    taskTitle: explicitOperatorFinalReview
      ? `Run the final independent check on the corrected workbook for ${productTitle}`
      : inspectionEvidenceRecheck
        ? `Check the complete setup-guide inspection for ${productTitle}`
      : validationSample
      ? `Review the functional validation workbook for ${productTitle}`
      : `Review the finished product package for ${productTitle}`,
    approvalTitle: explicitOperatorFinalReview
      ? `Run one final independent check on the corrected ${productTitle} workbook`
      : inspectionEvidenceRecheck
        ? `Check the repaired setup-guide inspection for ${productTitle}`
      : validationSample
      ? `Check the ${productTitle} validation workbook before the buyer test`
      : `Run the product quality review for ${productTitle}`,
    estimatedCostCents,
    manualApprovalRequired: operatorReviewRequired,
    reason: explicitOperatorFinalReview
      ? "Jarvis corrected the exact local workbook, setup guide, calculations, and previews at no additional AI cost. Three independent review attempts are already retained, so one final review requires Daniel's exact approval."
      : inspectionEvidenceRecheck
        ? "Jarvis regenerated only the internal inspection sheet so it now shows every setup-guide page. The customer files are byte-for-byte unchanged. One independently approved recheck can verify the previously unseen page."
      : validationSample
      ? "Independently check the exact locally stored workbook, guide, and previews before Pantheon prepares a buyer test."
      : "Independently check the exact locally stored product package before any launch preparation.",
    expectedOutput: "A clear pass, revise, or stop verdict with quality score, file coverage, usability risks, unsupported claims, and exact corrections.",
    expectedMetric: "All catalogue items are covered, deterministic file validation passed, and semantic review scores at least 80/100 with no unresolved high-risk finding.",
    model: selectedModel,
    modelLocked: validationSample ? true : journey?.model_locked === 1,
    maxInputTokens: validationSample ? 72000 : 96000,
    maxOutputTokens: 2400,
    maxTurns: 1,
    maxToolCalls: 0,
    tools: reviewAssetIds.length ? ["visual_asset_review"] : [],
    toolArguments: reviewAssetIds.length ? {
      visual_asset_review: { assetIds: reviewAssetIds },
    } : {},
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
      deliverable: validationSample
        ? "A decision-quality pass, revise, or stop review of the one functional validation sample, clearly distinguishing verified file facts from semantic judgements."
        : "A decision-quality review that clearly distinguishes verified file facts from semantic judgements and remaining inspection limits.",
      assetPrompt: `Use the complete frozen qualityReviewPacket, exact qualityReviewTargets, and all ${reviewAssetIds.length} approved visual inputs. Do not infer from a shortened narrative excerpt.`,
      constraints: [
        "Fail the package if any catalogue item lacks a real file.",
        "Do not approve unsupported legal, financial, medical, fitness, income, or performance claims.",
        "State any visual or formula inspection limitation honestly.",
      ],
      acceptanceCriteria: [
        "Quality score is reasoned rather than cosmetic.",
        "Material defects identify an exact correction.",
        explicitOperatorFinalReview
          ? "This is the one operator-authorised final review. Pass means the corrected validation sample may advance to buyer-test planning; revise or stop ends the build without another paid review."
          : inspectionEvidenceRecheck
            ? "Review the unchanged customer package using the complete PDF inspection sheet. This one evidence recheck cannot redesign the product or create another retry."
          : validationSample
          ? "Approval means ready to prepare the exact buyer test, not ready for a full catalogue, publication, or sale."
          : "Approval means ready for launch preparation, not already published or sold.",
      ],
    },
    parameters: {
      ...journeyParameters(journey),
      ...(operatorReviewRequired ? {
        manualApprovalRequired: true,
        operatorChoiceRequired: true,
      } : {}),
      approvedAssetIds: reviewAssetIds,
      reviewOfTaskId: buildTask.id,
      reviewBindings,
      qualityReviewPacket,
      pantheonProduction: {
        supervisorOwned: true,
        stage: "quality_review",
        roundId: productMetadata(buildTask).roundId,
        opportunityId: opportunityRecord.id,
        planId: plan.id,
        buildTaskId: buildTask.id,
        revisionNumber,
        reviewFingerprint: fingerprint,
        reviewSequence: prior.sequence,
        explicitOperatorFinalReview,
        inspectionEvidenceRecheck,
        inspectionEvidenceSourceQualityTaskId:
          options.inspectionEvidenceSourceQualityTaskId || null,
        journeyId: journey?.id || null,
        buyerIntentValidation: validationSample ? {
          specId: validationSample.specId,
          contractHash: validationSample.contractHash,
        } : null,
      },
    },
    effects: [],
  });
  if (journey) {
    const waitingForOperator = ["blocked", "waiting_approval"].includes(String(request.task?.status || ""));
    const terminalReset = options.allowTerminalRecovery === true
      || options.allowTerminalAuditRepair === true;
    updateJourney(db, journey.id, {
      allowTerminalRecovery: options.allowTerminalRecovery === true,
      allowTerminalAuditRepair: options.allowTerminalAuditRepair === true,
      status: waitingForOperator ? "waiting_for_operator" : "running",
      activeStage: "quality_review",
      completedAt: terminalReset ? null : undefined,
      metadata: {
        currentTaskId: request.task?.id || null,
        currentApprovalId: request.approval?.id || null,
        reviewAssetIds,
        qualityReviewFingerprint: fingerprint,
        ...(terminalReset ? {
          blocker: null,
          correctionLimitReached: false,
        } : {}),
      },
      stageEvent: {
        stage: "quality_review",
        status: request.task?.status || "waiting_to_start",
        taskId: request.task?.id || null,
        workerId: "quality_reviewer",
        note: prior.sequence > 1
          ? explicitOperatorFinalReview
            ? "The corrected package is frozen under exact hashes and awaiting Daniel's decision on one final independent check."
            : "The locally corrected package is frozen under new hashes and ready for a fresh independent review."
          : "The exact product files, previews, and cover are ready for independent review.",
      },
    });
  }
  return request;
}

function prepareExplicitFinalValidationReview(db, planId) {
  const plan = cataloguePlan(db, planId);
  if (!plan?.metadata?.validationSample) {
    throw new Error("This catalogue plan is not an evidence-bound buyer-intent validation sample.");
  }
  throw new Error(
    "Pantheon's final-review override is retired. Start a newly approved bounded revision instead.",
  );
}

function exactHashSnapshotMatches(left = [], right = []) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
  const valid = (item) => (
    item
    && typeof item.id === "string"
    && item.id
    && /^[a-f0-9]{64}$/i.test(String(item.sha256 || ""))
  );
  if (!left.every(valid) || !right.every(valid)) return false;
  const leftIds = new Set(left.map((item) => item.id));
  const rightIds = new Set(right.map((item) => item.id));
  if (leftIds.size !== left.length || rightIds.size !== right.length) return false;
  const rightById = new Map(right.map((item) => [item.id, item]));
  return left.every((item) => item.sha256 === rightById.get(item.id)?.sha256);
}

function inspectionEvidenceRole(item = {}) {
  const explicit = String(item.evidenceRole || "").trim();
  if (["workbook_inspection", "setup_guide_inspection"].includes(explicit)) return explicit;
  const identity = [
    item.humanName,
    item.name,
    item.filename,
    item.filePath,
    item.inspectionCoverage?.inspectionFile,
    item.inspectionCoverage?.inspectionRelativePath,
  ].filter(Boolean).join(" ");
  if (/\b(?:setup[-_ ]guide|actual-setup-guide)\b/i.test(identity)) {
    return "setup_guide_inspection";
  }
  if (/\b(?:workbook|actual-workbook)\b/i.test(identity)) return "workbook_inspection";
  return null;
}

function inspectionEvidenceByRole(items = []) {
  if (!Array.isArray(items) || items.length !== 2) return null;
  const byRole = new Map();
  for (const item of items) {
    const role = inspectionEvidenceRole(item);
    if (
      !role
      || byRole.has(role)
      || !/^[a-f0-9]{64}$/i.test(String(item?.sha256 || ""))
    ) {
      return null;
    }
    byRole.set(role, item);
  }
  return byRole.size === 2 ? byRole : null;
}

function canonicalJson(value) {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, canonicalJson(value[key])]),
    );
  }
  return value;
}

function sha256Json(value) {
  return crypto.createHash("sha256").update(JSON.stringify(canonicalJson(value))).digest("hex");
}

function managedFilePath(filePath) {
  if (!filePath) return null;
  const candidate = path.resolve(
    path.isAbsolute(filePath) ? filePath : path.join(CONFIG.rootDir, filePath),
  );
  if (!fs.existsSync(candidate) || !fs.statSync(candidate).isFile()) return null;
  const realCandidate = fs.realpathSync(candidate);
  if (!CONFIG.artifactRoot || !fs.existsSync(CONFIG.artifactRoot)) return null;
  const managedRoot = fs.realpathSync(CONFIG.artifactRoot);
  const relative = path.relative(managedRoot, realCandidate);
  const inside = relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
  return inside ? realCandidate : null;
}

function managedDeliverableSnapshotVerified(db, buildTask, item) {
  if (
    !item?.id
    || !/^[a-f0-9]{64}$/i.test(String(item.sha256 || ""))
  ) {
    return false;
  }
  const deliverable = get(
    db,
    `SELECT id, workflow_id, task_id, file_path, content_hash
     FROM deliverables WHERE id = ?`,
    [item.id],
  );
  const deliverablePath = managedFilePath(deliverable?.file_path);
  const snapshotPath = item.filePath ? managedFilePath(item.filePath) : null;
  if (
    !deliverable
    || deliverable.workflow_id !== buildTask.workflow_id
    || deliverable.task_id !== buildTask.id
    || deliverable.content_hash !== item.sha256
    || !deliverablePath
    || (item.filePath && (!snapshotPath || snapshotPath !== deliverablePath))
  ) {
    return false;
  }
  const actualHash = crypto.createHash("sha256").update(fs.readFileSync(deliverablePath)).digest("hex");
  return actualHash === item.sha256;
}

function managedSnapshotVerified(db, buildTask, items = []) {
  return Array.isArray(items)
    && items.length > 0
    && items.every((item) => managedDeliverableSnapshotVerified(db, buildTask, item));
}

function sourceReviewEvidence(qualityTask) {
  const request = qualityTask?.payload?.liveSpendRequest || {};
  const parameters = request.parameters || {};
  const packet = parameters.qualityReviewPacket || {};
  const files = Array.isArray(packet.packageDeliverables) ? packet.packageDeliverables : [];
  const previews = Array.isArray(packet.storefrontPreviews) ? packet.storefrontPreviews : [];
  const inspections = Array.isArray(packet.fileInspectionVisuals)
    ? packet.fileInspectionVisuals
    : [];
  const assetBinding = parameters.approvedAssetBinding
    || request.toolArguments?.visual_asset_review?.approvedAssetBinding
    || {};
  const assets = Array.isArray(assetBinding.assets) ? assetBinding.assets : [];
  const expectedVisuals = [...previews, ...inspections];
  const visualBindingExact = (
    assets.length === 4
    && expectedVisuals.length === 4
    && new Set(assets.map((asset) => asset.id)).size === 4
    && expectedVisuals.every((item) => assets.some((asset) => (
      asset.id === item.id && asset.sha256 === item.sha256
    )))
  );
  return {
    files,
    previews,
    inspections,
    inspectionsByRole: inspectionEvidenceByRole(inspections),
    visualBindingExact,
  };
}

function completeGuideInspectionCoverage(coverage, guideFile, guideInspection) {
  if (!coverage || !guideFile || !guideInspection) return false;
  const pages = Array.isArray(coverage.pages) ? coverage.pages : [];
  const canonicalPages = pages.map((page) => ({
    pageNumber: Number(page.pageNumber || 0),
    width: Number(page.width || 0),
    height: Number(page.height || 0),
    rasterSha256: String(page.rasterSha256 || ""),
  }));
  const orderedPagesValid = (
    canonicalPages.length === 3
    && canonicalPages.every((page, index) => (
      page.pageNumber === index + 1
      && page.width > 0
      && page.height > 0
      && /^[a-f0-9]{64}$/i.test(page.rasterSha256)
    ))
  );
  return (
    coverage.sourceFile === "00-customer-setup-guide.pdf"
    && coverage.sourceRelativePath === "customer-files/00-customer-setup-guide.pdf"
    && coverage.sourceSha256 === guideFile.sha256
    && coverage.inspectionFile === "actual-setup-guide.png"
    && coverage.inspectionRelativePath === "quality-review/actual-setup-guide.png"
    && coverage.inspectionSha256 === guideInspection.sha256
    && Number(coverage.sourcePageCount || 0) === 3
    && Number(coverage.renderedPageCount || 0) === 3
    && coverage.completeCoverage === true
    && Number.isInteger(Number(coverage.columns))
    && Number(coverage.columns) > 0
    && Number.isInteger(Number(coverage.rows))
    && Number(coverage.rows) > 0
    && Number(coverage.columns) * Number(coverage.rows) >= 3
    && orderedPagesValid
    && coverage.orderedPageIdentitySha256 === sha256Json(canonicalPages)
  );
}

function qualityFindingIsMaterial(value) {
  const text = String(value || "").trim();
  if (!text) return false;
  const withoutExplicitAbsence = text.replace(
    /\bno (?:new or )?(?:unsafe|illegal|misleading|unsupported|incorrect|broken|materially false) (?:claim|claims|finding|findings|issue|issues|defect|defects)\b/gi,
    "",
  ).replace(
    /\bno (?:(?:known|remaining|identified)\s+)?(?:material|major|high[- ]risk) (?:finding|findings|issue|issues|defect|defects)\b/gi,
    "",
  );
  return /\b(?:unsafe|illegal|misleading|unsupported|incorrect|broken|unusable|illegible|not legible|not complete|incomplete|material defect|clipp\w*|overflow\w*|formula error|wrong result)\b/i.test(withoutExplicitAbsence);
}

function inspectionEvidenceOnlyFailure(qualityTask) {
  const output = taskOutput(qualityTask);
  const verdict = qualityPassed(output, { requireCompleteEvidence: true });
  const roleOutput = output.roleOutput || {};
  const missingEvidence = Array.isArray(roleOutput.missingEvidence)
    ? roleOutput.missingEvidence.map(String).filter(Boolean)
    : [];
  const riskFindings = Array.isArray(roleOutput.riskFindings)
    ? roleOutput.riskFindings
    : null;
  const outputRisks = Array.isArray(output.risks) ? output.risks : null;
  const disqualifyingDefect = (value) => qualityFindingIsMaterial(value);
  const defectOutsideInspectionUncertainty = (value) => disqualifyingDefect(
    String(value || "").replace(
      /\b(?:cannot|can't|could not|unable to|not possible to)(?:\s+be)?\s+(?:check|inspect|verify|confirm|assess|review)\w*\s+(?:for\s+)?(?:(?:clipping|legibility|disclaimer presentation|overflow)(?:\s*,\s*|\s+or\s+|\s+and\s+)?)+/gi,
      "cannot be inspected",
    ),
  );
  const inspectionGap = (value) => (
    /\b(?:pages?|pdf|setup[- ]guide)\b/i.test(String(value))
    && /\b(?:inspect|visual|render|shown|seen|evidence|check|verify|confirm|assess|review)\w*\b/i.test(String(value))
    && /\b(?:missing|lacks?|cannot|can't|could not|unable|not possible|not shown|only|uninspect)\b/i.test(String(value))
    && !defectOutsideInspectionUncertainty(value)
  );
  const acceptableFinding = (value) => (
    inspectionGap(value)
    || (
      /\b(?:complete|legible|consistent|verified|confirms?|accurately describe)\b/i.test(String(value))
      && !/\b(?:not|isn't|aren't|cannot|can't|incomplete|illegible|unusable)\b/i.test(String(value))
      && !disqualifyingDefect(value)
    )
  );
  const acceptableBackgroundRisk = (value) => (
    /\b(?:buyer demand|willingness to pay|market demand|conversion)\b/i.test(String(value))
    && /\b(?:unproven|unknown|not (?:yet )?proven)\b/i.test(String(value))
    && !disqualifyingDefect(value)
  );
  const acceptableBoundedScopeRisk = (value) => (
    /\b(?:narrow|bounded)\b.*\bvalidation sample\b/i.test(String(value))
    && /\b(?:only|limited)\b.*\b(?:buyer test|validation test|test)\b/i.test(String(value))
    && !disqualifyingDefect(value)
  );
  const claimSafety = String(roleOutput.claimSafety || "");
  return (
    !verdict.passed
    && verdict.score >= 80
    && ["revise", "needs_evidence"].includes(verdict.decision)
    && Array.isArray(riskFindings)
    && Array.isArray(outputRisks)
    && missingEvidence.length > 0
    && missingEvidence.every(inspectionGap)
    && riskFindings.every(acceptableFinding)
    && outputRisks.every((risk) => (
      inspectionGap(risk) || acceptableBackgroundRisk(risk) || acceptableBoundedScopeRisk(risk)
    ))
    && /\b(?:safe|supported|accurately|consistent)\b/i.test(claimSafety)
    && !defectOutsideInspectionUncertainty(claimSafety)
    && inspectionGap(
      `${output.summary || ""} ${output.nextAction || ""} ${roleOutput.operatorRecommendation || ""}`,
    )
  );
}

function reconcileExistingInspectionEvidenceRecheck(db, plan, qualityTask, existingRecheck) {
  const approval = existingRecheck.approval_id
    ? get(db, "SELECT * FROM approvals WHERE id = ?", [existingRecheck.approval_id])
    : null;
  const sourceVerdict = qualityPassed(
    taskOutput(qualityTask),
    { requireCompleteEvidence: true },
  );
  const declined = existingRecheck.status === "cancelled" || approval?.status === "rejected";
  const completed = (
    existingRecheck.status === "completed"
    && existingRecheck.outcome_status === "known"
  );
  const completedVerdict = completed
    ? qualityPassed(taskOutput(existingRecheck), { requireCompleteEvidence: true })
    : null;
  const failed = completed && completedVerdict?.passed !== true;
  const preparedAt = productMetadata(existingRecheck)?.inspectionEvidencePreparedAt
    || existingRecheck.created_at
    || now();
  if (declined) {
    updatePlan(db, plan.id, {
      status: "needs_attention",
      metadata: {
        buildStatus: "inspection_evidence_recheck_declined_terminal",
        supersededQualityTaskId: qualityTask.id,
        qualityTaskId: existingRecheck.id,
        qualityReviewFingerprint: qualityReviewFingerprintForTask(existingRecheck),
        qualityScore: sourceVerdict.score,
        qualityDecision: "inspection_evidence_recheck_declined",
        qualityFindings: sourceVerdict.findings,
        correctionPrepared: false,
        correctionRequiresNewBudget: false,
        inspectionEvidenceRecheckTaskId: existingRecheck.id,
        inspectionEvidenceRecheckApprovalId: approval?.id || null,
        inspectionEvidenceRecheckPreparedAt: preparedAt,
        inspectionEvidenceRecheckExhausted: true,
      },
    });
    terminalizeInspectionEvidenceRecheckPersistence(db, plan);
  } else if (failed) {
    updatePlan(db, plan.id, {
      status: "needs_attention",
      metadata: {
        buildStatus: "inspection_evidence_recheck_failed_terminal",
        supersededQualityTaskId: qualityTask.id,
        qualityTaskId: existingRecheck.id,
        qualityReviewFingerprint: qualityReviewFingerprintForTask(existingRecheck),
        qualityScore: completedVerdict.score,
        qualityDecision: completedVerdict.decision,
        qualityFindings: completedVerdict.findings,
        correctionPrepared: false,
        correctionRequiresNewBudget: false,
        inspectionEvidenceRecheckTaskId: existingRecheck.id,
        inspectionEvidenceRecheckApprovalId: approval?.id || null,
        inspectionEvidenceRecheckPreparedAt: preparedAt,
        inspectionEvidenceRecheckExhausted: true,
      },
    });
    terminalizeInspectionEvidenceRecheckPersistence(db, plan);
  } else if (!completed && (
    plan.metadata.qualityTaskId !== existingRecheck.id
    || plan.metadata.inspectionEvidenceRecheckTaskId !== existingRecheck.id
  )) {
    updatePlan(db, plan.id, {
      status: "quality_review",
      metadata: {
        buildStatus: "inspection_evidence_repaired_pending_recheck",
        supersededQualityTaskId: qualityTask.id,
        qualityTaskId: existingRecheck.id,
        qualityReviewFingerprint: qualityReviewFingerprintForTask(existingRecheck),
        qualityScore: null,
        qualityDecision: null,
        qualityFindings: [],
        inspectionEvidenceRecheckTaskId: existingRecheck.id,
        inspectionEvidenceRecheckApprovalId: approval?.id || null,
        inspectionEvidenceRecheckPreparedAt: preparedAt,
        inspectionEvidenceRecheckExhausted: false,
      },
    });
  }
  if (!get(
    db,
    "SELECT id FROM events WHERE type = ? AND entity_id = ? ORDER BY ts LIMIT 1",
    [
      declined
        ? "quality_review.pdf_inspection_recheck_declined"
        : "quality_review.pdf_inspection_recheck_ready",
      existingRecheck.id,
    ],
  )) {
    insertEvent(db, {
      level: declined ? "warn" : "info",
      actor: declined ? "operator" : "jarvis",
      type: declined
        ? "quality_review.pdf_inspection_recheck_declined"
        : "quality_review.pdf_inspection_recheck_ready",
      entityType: "task",
      entityId: existingRecheck.id,
      message: declined
        ? "The one inspection-evidence recheck was declined and cannot be prepared again."
        : "Pantheon reconciled the existing single-use inspection-evidence recheck without creating another task or approval.",
      metadata: {
        sourceQualityTaskId: qualityTask.id,
        approvalId: approval?.id || null,
        singleUseConsumed: true,
        noProviderCall: true,
        externalAction: false,
      },
    });
  }
  return {
    recovered: true,
    existing: true,
    terminal: declined || failed || completed,
    passed: completedVerdict?.passed === true,
    singleUseConsumed: true,
    sourceQualityTask: qualityTask,
    task: existingRecheck,
    approval,
    noProviderCall: true,
    externalAction: false,
  };
}

function recoverValidationQualityReviewAfterInspectionRepairOperation(db, qualityTaskId) {
  const qualityTask = parseRow(
    get(db, "SELECT * FROM tasks WHERE id = ?", [qualityTaskId]),
    ["payload", "result"],
  );
  const metadata = productMetadata(qualityTask);
  if (
    !qualityTask
    || qualityTask.kind !== "live_ai_worker_execution"
    || qualityTask.agent !== "quality_reviewer"
    || qualityTask.status !== "completed"
    || qualityTask.outcome_status !== "known"
    || metadata?.stage !== "quality_review"
    || !metadata.planId
    || !metadata.buildTaskId
    || metadata.inspectionEvidenceRecheck === true
  ) {
    throw new Error("This task is not an eligible initial Quality Reviewer result.");
  }
  if (!inspectionEvidenceOnlyFailure(qualityTask)) {
    throw new Error("The completed review did not fail solely because PDF inspection evidence was incomplete.");
  }

  const plan = cataloguePlan(db, metadata.planId);
  const existingRecheck = parseRow(get(
    db,
    `SELECT * FROM tasks
     WHERE kind = 'live_ai_worker_execution'
       AND json_extract(payload, '$.liveSpendRequest.parameters.pantheonProduction.planId') = ?
       AND json_extract(payload, '$.liveSpendRequest.parameters.pantheonProduction.stage') = 'quality_review'
       AND json_extract(payload, '$.liveSpendRequest.parameters.pantheonProduction.inspectionEvidenceRecheck') = 1
       AND json_extract(payload, '$.liveSpendRequest.parameters.pantheonProduction.inspectionEvidenceSourceQualityTaskId') = ?
     ORDER BY created_at DESC LIMIT 1`,
    [metadata.planId, qualityTask.id],
  ), ["payload", "result"]);
  if (existingRecheck) {
    return reconcileExistingInspectionEvidenceRecheck(
      db,
      plan,
      qualityTask,
      existingRecheck,
    );
  }
  const opportunityRecord = opportunity(db, metadata.opportunityId || plan?.opportunity_id);
  const buildTask = parseRow(
    get(db, "SELECT * FROM tasks WHERE id = ?", [metadata.buildTaskId]),
    ["payload", "result"],
  );
  if (
    !plan?.metadata?.validationSample
    || !opportunityRecord
    || !buildTask
    || buildTask.status !== "completed"
    || plan.metadata.qualityTaskId !== qualityTask.id
  ) {
    throw new Error("Pantheon cannot bind the inspection repair to the exact active validation package.");
  }

  const generated = generatedProductResult(buildTask);
  const refresh = generated.localRendererRefresh || plan.metadata.localRendererRefresh || {};
  const sourceEvidence = sourceReviewEvidence(qualityTask);
  const previousFiles = refresh.previousFiles || [];
  const currentFiles = refresh.currentFiles || [];
  const previousPreviews = refresh.previousPreviews || [];
  const currentPreviews = refresh.currentPreviews || [];
  const previousInspections = refresh.previousQualityReviewImages || [];
  const currentInspections = refresh.currentQualityReviewImages || [];
  const previousInspectionsByRole = inspectionEvidenceByRole(previousInspections);
  const currentInspectionsByRole = inspectionEvidenceByRole(currentInspections);
  const generatedInspectionsByRole = inspectionEvidenceByRole(
    generated.qualityReviewImages || [],
  );
  const sourceInspectionsByRole = sourceEvidence.inspectionsByRole;
  const sourceWorkbook = sourceInspectionsByRole?.get("workbook_inspection");
  const sourceGuide = sourceInspectionsByRole?.get("setup_guide_inspection");
  const previousWorkbook = previousInspectionsByRole?.get("workbook_inspection");
  const previousGuide = previousInspectionsByRole?.get("setup_guide_inspection");
  const currentWorkbook = currentInspectionsByRole?.get("workbook_inspection");
  const currentGuide = currentInspectionsByRole?.get("setup_guide_inspection");
  const generatedWorkbook = generatedInspectionsByRole?.get("workbook_inspection");
  const generatedGuide = generatedInspectionsByRole?.get("setup_guide_inspection");
  const currentGuideFiles = currentFiles.filter((file) => (
    [
      file.humanName,
      file.archiveEntry,
      file.filePath,
    ].filter(Boolean).some((identity) => (
      path.basename(String(identity).replace(/\\/g, "/")).toLowerCase()
        === "00-customer-setup-guide.pdf"
    ))
  ));
  const currentGuideFile = currentGuideFiles.length === 1 ? currentGuideFiles[0] : null;
  const currentGeneratedInspections = generated.qualityReviewImages || [];
  const unchangedCustomerPackage = (
    exactHashSnapshotMatches(sourceEvidence.files, previousFiles)
    && exactHashSnapshotMatches(sourceEvidence.files, currentFiles)
    && exactHashSnapshotMatches(sourceEvidence.previews, previousPreviews)
    && exactHashSnapshotMatches(sourceEvidence.previews, currentPreviews)
  );
  const exactInspectionTransition = Boolean(
    sourceInspectionsByRole
    && previousInspectionsByRole
    && currentInspectionsByRole
    && generatedInspectionsByRole
    && sourceWorkbook.id === previousWorkbook.id
    && sourceWorkbook.sha256 === previousWorkbook.sha256
    && sourceGuide.id === previousGuide.id
    && sourceGuide.sha256 === previousGuide.sha256
    && currentWorkbook.id !== sourceWorkbook.id
    && currentWorkbook.id === generatedWorkbook.id
    && currentWorkbook.filePath === generatedWorkbook.filePath
    && currentWorkbook.sha256 === sourceWorkbook.sha256
    && currentGuide.id !== sourceGuide.id
    && currentGuide.id === generatedGuide.id
    && currentGuide.filePath === generatedGuide.filePath
    && currentGuide.sha256 !== sourceGuide.sha256
    && generatedWorkbook.sha256 === currentWorkbook.sha256
    && generatedGuide.sha256 === currentGuide.sha256
    && previousGuide.filePath !== currentGuide.filePath
    && completeGuideInspectionCoverage(
      currentGuide.inspectionCoverage,
      currentGuideFile,
      currentGuide,
    )
  );
  const managedEvidenceVerified = (
    managedSnapshotVerified(db, buildTask, currentFiles)
    && managedSnapshotVerified(db, buildTask, currentPreviews)
    && managedSnapshotVerified(db, buildTask, currentInspections)
    && managedSnapshotVerified(db, buildTask, currentGeneratedInspections)
    && managedSnapshotVerified(db, buildTask, sourceEvidence.inspections)
  );
  const inspectionRepairProven = (
    refresh.schema === "pantheon.local-renderer-refresh.v1"
    && refresh.sourceTaskId === buildTask.id
    && refresh.noProviderCall === true
    && refresh.externalAction === false
    && Boolean(refresh.rendererRevision)
    && refresh.blueprintHash === generated.blueprintHash
    && sourceEvidence.visualBindingExact
    && sourceEvidence.previews.length === 2
    && sourceEvidence.inspections.length === 2
    && unchangedCustomerPackage
    && exactInspectionTransition
    && managedEvidenceVerified
  );
  if (!inspectionRepairProven) {
    throw new Error(
      "Pantheon cannot prove a zero-spend inspection repair with unchanged customer files and complete PDF page coverage.",
    );
  }

  const replacement = queueQualityReview(
    db,
    plan,
    opportunityRecord,
    buildTask,
    generated,
    [],
    {
      inspectionEvidenceRecheck: true,
      inspectionEvidenceSourceQualityTaskId: qualityTask.id,
      requestKeySuffix: `inspection_evidence_recheck_${qualityTask.id}_${refresh.rendererRevision}`,
    },
  );
  if (replacement.task.id === qualityTask.id) {
    throw new Error("The inspection repair did not create a distinct exact quality review.");
  }
  const replacementFingerprint = qualityReviewFingerprintForTask(replacement.task);
  updatePlan(db, plan.id, {
    status: "quality_review",
    metadata: {
      buildStatus: "inspection_evidence_repaired_pending_recheck",
      supersededQualityTaskId: qualityTask.id,
      qualityTaskId: replacement.task.id,
      qualityReviewFingerprint: replacementFingerprint,
      qualityScore: null,
      qualityDecision: null,
      qualityFindings: [],
      inspectionEvidenceRecheckTaskId: replacement.task.id,
      inspectionEvidenceRecheckApprovalId: replacement.approval?.id || null,
      inspectionEvidenceRecheckPreparedAt: now(),
      inspectionEvidenceRecheckExhausted: false,
    },
  });
  run(
    db,
    "UPDATE messages SET status = 'resolved', resolved_at = COALESCE(resolved_at, ?) WHERE task_id = ? AND status = 'open'",
    [now(), qualityTask.id],
  );
  insertEvent(db, {
    actor: "jarvis",
    type: "quality_review.pdf_inspection_recheck_ready",
    entityType: "task",
    entityId: replacement.task.id,
    message: "Jarvis preserved every customer file and prepared one approved recheck using a complete all-page PDF inspection sheet.",
    metadata: {
      sourceQualityTaskId: qualityTask.id,
      buildTaskId: buildTask.id,
      rendererRevision: refresh.rendererRevision,
      replacementFingerprint,
      unchangedCustomerPackage: true,
      completePageCoverage: currentGuide.inspectionCoverage,
      noProviderCall: true,
      externalAction: false,
    },
  });
  return {
    recovered: true,
    sourceQualityTask: qualityTask,
    task: replacement.task,
    approval: replacement.approval,
    rendererRevision: refresh.rendererRevision,
    unchangedCustomerPackage: true,
    completePageCoverage: currentGuide.inspectionCoverage,
    noProviderCall: true,
    externalAction: false,
  };
}

function recoverValidationQualityReviewAfterInspectionRepair(db, qualityTaskId) {
  return withSavepoint(
    db,
    "recover_validation_inspection",
    () => recoverValidationQualityReviewAfterInspectionRepairOperation(db, qualityTaskId),
  );
}

function recoverQualityReviewAfterEvidenceRepair(db, qualityTaskId) {
  const qualityTask = parseRow(
    get(db, "SELECT * FROM tasks WHERE id = ?", [qualityTaskId]),
    ["payload", "result"],
  );
  const metadata = productMetadata(qualityTask);
  const priorPacket = qualityTask?.payload?.liveSpendRequest?.parameters?.qualityReviewPacket || {};
  if (
    !qualityTask
    || qualityTask.kind !== "live_ai_worker_execution"
    || qualityTask.agent !== "quality_reviewer"
    || qualityTask.status !== "completed"
    || qualityTask.outcome_status !== "known"
    || metadata.stage !== "quality_review"
    || !metadata.planId
    || !metadata.buildTaskId
  ) {
    throw new Error("This task is not an eligible completed Quality Reviewer result.");
  }
  if (
    priorPacket.schema === "pantheon.product-quality-review-packet.v3"
    && priorPacket.deterministicChecks?.workbookSemanticsExposed === true
    && priorPacket.deterministicChecks?.formulaCoverageComplete === true
  ) {
    throw new Error("The completed review already used the current complete workbook evidence packet.");
  }

  const plan = cataloguePlan(db, metadata.planId);
  const opportunityRecord = opportunity(db, metadata.opportunityId || plan?.opportunity_id);
  const buildTask = parseRow(
    get(db, "SELECT * FROM tasks WHERE id = ?", [metadata.buildTaskId]),
    ["payload", "result"],
  );
  const journey = plan ? journeyForPlan(db, plan) : null;
  if (!plan || !opportunityRecord || !buildTask || buildTask.status !== "completed") {
    throw new Error("Pantheon cannot bind the evidence repair to the exact completed product package.");
  }
  if (!journey || journey.status !== "stopped_after_correction") {
    throw new Error("Only the exact journey stopped after its bounded correction may use this evidence repair.");
  }

  const generated = generatedProductResult(buildTask);
  const replacement = queueQualityReview(
    db,
    plan,
    opportunityRecord,
    buildTask,
    generated,
    Array.isArray(plan.metadata.storefrontVisualIds) ? plan.metadata.storefrontVisualIds : [],
    {
      allowTerminalRecovery: true,
      requireFormulaEvidenceRepair: true,
      requestKeySuffix: `evidence_repair_${qualityTask.id}`,
    },
  );
  if (replacement.existing || replacement.task.id === qualityTask.id) {
    throw new Error("The repaired evidence packet did not create a distinct exact quality review.");
  }
  const replacementFingerprint = qualityReviewFingerprintForTask(replacement.task);
  updatePlan(db, plan.id, {
    status: "quality_review",
    metadata: {
      buildStatus: "evidence_repaired_pending_quality_review",
      supersededQualityTaskId: qualityTask.id,
      qualityTaskId: replacement.task.id,
      qualityReviewFingerprint: replacementFingerprint,
    },
  });
  run(
    db,
    "UPDATE messages SET status = 'resolved', resolved_at = COALESCE(resolved_at, ?) WHERE task_id = ? AND status = 'open'",
    [now(), qualityTask.id],
  );
  insertEvent(db, {
    actor: "jarvis",
    type: "quality_review.evidence_packet_recovered",
    entityType: "task",
    entityId: replacement.task.id,
    message: "Jarvis refreshed the exact unchanged product package with complete workbook evidence. No provider call or external action occurred.",
    metadata: {
      sourceQualityTaskId: qualityTask.id,
      buildTaskId: buildTask.id,
      journeyId: journey.id,
      priorPacketSchema: priorPacket.schema || "unknown",
      replacementPacketSchema: replacement.task.payload.liveSpendRequest.parameters.qualityReviewPacket.schema,
      replacementFingerprint,
      noProviderCall: true,
      externalAction: false,
    },
  });
  return {
    recovered: true,
    sourceQualityTask: qualityTask,
    task: replacement.task,
    approval: replacement.approval,
    journeyId: journey.id,
    noProviderCall: true,
  };
}

function recoverQualityReviewAfterLocalRendererRepair(db, qualityTaskId) {
  const qualityTask = parseRow(
    get(db, "SELECT * FROM tasks WHERE id = ?", [qualityTaskId]),
    ["payload", "result"],
  );
  const metadata = productMetadata(qualityTask);
  const priorBindings = qualityTask?.payload?.liveSpendRequest?.parameters?.reviewBindings || [];
  const priorVerdict = qualityTask ? qualityPassed(taskOutput(qualityTask)) : null;
  if (
    !qualityTask
    || qualityTask.kind !== "live_ai_worker_execution"
    || qualityTask.agent !== "quality_reviewer"
    || qualityTask.status !== "completed"
    || qualityTask.outcome_status !== "known"
    || metadata?.stage !== "quality_review"
    || !metadata.planId
    || !metadata.buildTaskId
    || !Array.isArray(priorBindings)
    || !priorBindings.length
  ) {
    throw new Error("This task is not an eligible completed Quality Reviewer result.");
  }

  const plan = cataloguePlan(db, metadata.planId);
  const opportunityRecord = opportunity(db, metadata.opportunityId || plan?.opportunity_id);
  const buildTask = parseRow(
    get(db, "SELECT * FROM tasks WHERE id = ?", [metadata.buildTaskId]),
    ["payload", "result"],
  );
  const journey = plan ? journeyForPlan(db, plan) : null;
  if (!plan || !opportunityRecord || !buildTask || buildTask.status !== "completed") {
    throw new Error("Pantheon cannot bind the renderer repair to the exact completed product package.");
  }
  const stoppedCorrectionRecovery = !priorVerdict.passed
    && journey?.status === "stopped_after_correction";
  const completedAuditRecertification = priorVerdict.passed
    && journey?.status === "completed";
  if (!stoppedCorrectionRecovery && !completedAuditRecertification) {
    throw new Error(
      "A local renderer refresh may reopen only the exact stopped correction or a completed publish-ready journey whose prior review passed.",
    );
  }
  if (stoppedCorrectionRecovery && Number(metadata.revisionNumber || 0) < 1) {
    throw new Error("The normal bounded Product Builder correction must run before a local renderer repair.");
  }

  const rendererRefresh = plan.metadata.localRendererRefresh || {};
  const coverRefresh = plan.metadata.localCoverRefresh || {};
  const generated = generatedProductResult(buildTask);
  const currentBindings = buildDeliverableReviewBindings(
    db,
    buildTask.workflow_id,
    generated.files.map((file) => file.id),
  );
  const priorById = new Map(priorBindings.map((binding) => [binding.deliverableId, binding.inputHash]));
  const bindingChanged = currentBindings.some((binding) => (
    priorById.get(binding.deliverableId) !== binding.inputHash
  ));
  const previousById = new Map(
    (rendererRefresh.previousFiles || []).map((file) => [file.id, file.sha256]),
  );
  const packageChanged = (rendererRefresh.currentFiles || []).some((file) => (
    previousById.get(file.id) !== file.sha256
  ));
  const currentFilesMatchRefresh = generated.files.every((file) => (
    (rendererRefresh.currentFiles || []).some((current) => (
      current.id === file.id && current.sha256 === file.sha256
    ))
  ));
  const rendererRepairProven = (
    rendererRefresh.schema === "pantheon.local-renderer-refresh.v1"
    && rendererRefresh.sourceTaskId === buildTask.id
    && rendererRefresh.noProviderCall === true
    && rendererRefresh.externalAction === false
    && Boolean(rendererRefresh.rendererRevision)
    && rendererRefresh.blueprintHash === generated.blueprintHash
    && packageChanged
    && bindingChanged
    && currentFilesMatchRefresh
  );

  const visualAssetIds = Array.isArray(plan.metadata.storefrontVisualIds)
    ? plan.metadata.storefrontVisualIds
    : [];
  const refreshedCover = coverRefresh.currentAsset?.id
    ? get(
      db,
      "SELECT id, content_hash, file_path FROM deliverables WHERE id = ? AND status <> 'superseded'",
      [coverRefresh.currentAsset.id],
    )
    : null;
  const coverChanged = Boolean(
    coverRefresh.previousAsset?.id
    && coverRefresh.currentAsset?.id === coverRefresh.previousAsset.id
    && coverRefresh.currentAsset.sha256
    && coverRefresh.previousAsset.sha256 !== coverRefresh.currentAsset.sha256,
  );
  const coverRepairProven = (
    coverRefresh.schema === "pantheon.local-cover-refresh.v1"
    && visualAssetIds.includes(coverRefresh.currentAsset?.id)
    && coverRefresh.noProviderCall === true
    && coverRefresh.externalAction === false
    && Boolean(coverRefresh.rendererRevision)
    && coverChanged
    && refreshedCover?.content_hash === coverRefresh.currentAsset.sha256
    && refreshedCover?.file_path === coverRefresh.currentAsset.filePath
  );
  if (!rendererRepairProven && !coverRepairProven) {
    throw new Error("Pantheon cannot prove a zero-spend local renderer repair with new exact package hashes.");
  }
  if (!visualAssetIds.length || visualAssetIds.some((id) => !get(
    db,
    "SELECT id FROM deliverables WHERE id = ? AND status <> 'superseded'",
    [id],
  ))) {
    throw new Error("The repaired package no longer has its exact approved storefront cover.");
  }
  const refresh = rendererRepairProven ? rendererRefresh : coverRefresh;
  const repairKind = rendererRepairProven ? "product_renderer" : "storefront_cover";
  const repairStatusPrefix = rendererRepairProven ? "local_renderer" : "local_cover";
  const refreshDescription = rendererRepairProven
    ? "deterministic product renderer produced new customer-package bytes"
    : "deterministic storefront compositor produced new cover artwork";
  const previousFiles = rendererRepairProven
    ? rendererRefresh.previousFiles
    : [coverRefresh.previousAsset];
  const currentFiles = rendererRepairProven
    ? rendererRefresh.currentFiles
    : [coverRefresh.currentAsset];

  const invalidatedAt = now();
  let queuePlan = plan;
  let nextContextRevision = Number(plan.metadata.launchContextRevision || 0);
  let supersededLaunchTaskIds = [];
  if (completedAuditRecertification) {
    const launchRows = all(
      db,
      `SELECT * FROM tasks
       WHERE kind = 'live_ai_worker_execution'
         AND json_extract(payload, '$.liveSpendRequest.parameters.pantheonProduction.planId') = ?
         AND json_extract(payload, '$.liveSpendRequest.parameters.pantheonProduction.stage')
           IN ('conversion_copy', 'distribution_plan', 'chief_brief')`,
      [plan.id],
    );
    nextContextRevision = Math.max(
      nextContextRevision + 1,
      ...launchRows.map((row) => contextRevision(row) + 1),
    );
    queuePlan = updatePlan(db, plan.id, {
      status: "quality_review",
      metadata: {
        buildStatus: `${repairStatusPrefix}_refreshed_pending_quality_recertification`,
        previousQualityTaskId: qualityTask.id,
        supersededQualityTaskId: qualityTask.id,
        qualityTaskId: null,
        qualityScore: null,
        qualityDecision: null,
        qualityFindings: [],
        qualityReviewFingerprint: null,
        previousLaunchDecision: plan.metadata.launchDecision || null,
        launchDecision: null,
        launchDecisionAt: null,
        launchDecisionNote: null,
        launchDecisionHandoffId: null,
        listingCopyDeliverableId: null,
        launchPackDeliverableId: null,
        chiefBriefDeliverableId: null,
        approvalPackDeliverableId: null,
        launchContextRevision: nextContextRevision,
        publicationReadinessInvalidatedAt: invalidatedAt,
        publicationReadinessInvalidatedReason:
          `The ${refreshDescription} and requires exact quality recertification.`,
      },
    });
    const retired = retireSupersededLaunchContextRecords(
      db,
      queuePlan,
      nextContextRevision,
    );
    supersededLaunchTaskIds = retired.supersededTaskIds;
    run(
      db,
      "UPDATE catalogue_items SET status = 'built', quality_status = 'pending_review', updated_at = ? WHERE plan_id = ?",
      [invalidatedAt, plan.id],
    );
    const reviewAssetIds = [...new Set([
      ...visualAssetIds,
      ...(generated.previews || []).map((preview) => preview.id),
      ...generated.files.map((file) => file.id),
    ])];
    if (reviewAssetIds.length) {
      const placeholders = reviewAssetIds.map(() => "?").join(", ");
      run(
        db,
        `UPDATE deliverables SET status = 'built_pending_quality_review', updated_at = ?
         WHERE id IN (${placeholders}) AND status <> 'superseded'`,
        [invalidatedAt, ...reviewAssetIds],
      );
    }
    run(
      db,
      "UPDATE opportunities SET status = 'quality_review', updated_at = ? WHERE id = ?",
      [invalidatedAt, opportunityRecord.id],
    );
    run(
      db,
      "UPDATE opportunity_rounds SET status = 'quality_review', updated_at = ? WHERE id = ?",
      [invalidatedAt, metadata.roundId],
    );
    run(
      db,
      `UPDATE workflows
       SET status = 'in_progress',
           current_step = 'Updated product assets require independent quality review',
           updated_at = ?
       WHERE id = ?`,
      [invalidatedAt, buildTask.workflow_id],
    );
    run(
      db,
      `UPDATE messages SET status = 'resolved', resolved_at = COALESCE(resolved_at, ?)
       WHERE status = 'open'
         AND (
           id = ?
           OR json_extract(metadata, '$.planId') = ?
           OR json_extract(metadata, '$.pantheonProduction.planId') = ?
         )`,
      [invalidatedAt, `msg_publish_${safeId(plan.id)}`, plan.id, plan.id],
    );
    queuePlan = cataloguePlan(db, plan.id);
  }

  const replacement = queueQualityReview(
    db,
    queuePlan,
    opportunityRecord,
    buildTask,
    generated,
    visualAssetIds,
    {
      allowTerminalRecovery: stoppedCorrectionRecovery,
      allowTerminalAuditRepair: completedAuditRecertification,
      requestKeySuffix: completedAuditRecertification
        ? `${repairKind}_recertification_${qualityTask.id}_${refresh.rendererRevision}`
        : `${repairKind}_repair_${qualityTask.id}`,
    },
  );
  if (replacement.existing || replacement.task.id === qualityTask.id) {
    throw new Error("The local asset repair did not create a distinct exact quality review.");
  }
  const replacementFingerprint = qualityReviewFingerprintForTask(replacement.task);
  updatePlan(db, plan.id, {
    status: "quality_review",
    metadata: {
      buildStatus: completedAuditRecertification
        ? `${repairStatusPrefix}_refreshed_pending_quality_recertification`
        : `${repairStatusPrefix}_repaired_pending_quality_review`,
      supersededQualityTaskId: qualityTask.id,
      qualityTaskId: replacement.task.id,
      qualityReviewFingerprint: replacementFingerprint,
      qualityScore: null,
      qualityDecision: null,
      qualityFindings: [],
    },
  });
  if (completedAuditRecertification) {
    updateJourney(db, journey.id, {
      metadata: {
        previousCompletedAt: journey.completed_at,
        previousFinalDecision: journey.metadata.finalDecision || null,
        finalDecision: null,
        finalDecisionNote: null,
        externalActionCompleted: false,
        publicationReadinessInvalidatedAt: invalidatedAt,
        publicationReadinessInvalidatedReason:
          `The ${refreshDescription} and requires exact quality recertification.`,
        launchContextRevision: nextContextRevision,
      },
    });
  }
  run(
    db,
    "UPDATE messages SET status = 'resolved', resolved_at = COALESCE(resolved_at, ?) WHERE task_id = ? AND status = 'open'",
    [now(), qualityTask.id],
  );
  insertEvent(db, {
    actor: "jarvis",
    type: completedAuditRecertification
      ? rendererRepairProven
        ? "quality_review.local_renderer_recertification_ready"
        : "quality_review.local_cover_recertification_ready"
      : rendererRepairProven
        ? "quality_review.local_renderer_repair_ready"
        : "quality_review.local_cover_repair_ready",
    entityType: "task",
    entityId: replacement.task.id,
    message: completedAuditRecertification
      ? "Jarvis withdrew the earlier publish-ready state and prepared independent quality recertification for the changed exact product asset."
      : "Jarvis corrected the local product asset, preserved the approved Product Builder source work, and prepared a review of its new hash.",
    metadata: {
      sourceQualityTaskId: qualityTask.id,
      buildTaskId: buildTask.id,
      journeyId: journey.id,
      repairKind,
      rendererRevision: refresh.rendererRevision,
      blueprintHash: generated.blueprintHash,
      replacementFingerprint,
      previousFiles,
      currentFiles,
      reusedStorefrontVisualIds: visualAssetIds,
      completedAuditRecertification,
      nextContextRevision,
      supersededLaunchTaskIds,
      noProviderCall: true,
      externalAction: false,
    },
  });
  return {
    recovered: true,
    sourceQualityTask: qualityTask,
    task: replacement.task,
    approval: replacement.approval,
    journeyId: journey.id,
    repairKind,
    rendererRevision: refresh.rendererRevision,
    completedAuditRecertification,
    nextContextRevision,
    supersededLaunchTaskIds,
    noProviderCall: true,
    externalAction: false,
  };
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
  const journey = journeyForPlan(db, plan);
  updatePlan(db, plan.id, {
    status: journey ? "storefront_visuals" : "quality_review",
    metadata: {
      buildStatus: "built_pending_quality_review",
      buildTaskId: task.id,
      buildRevision: revisionNumber,
      generatedFileIds: generated.files.map((file) => file.id),
      storefrontPreviewIds: (generated.previews || []).map((preview) => preview.id),
      qualityReviewImageIds: (generated.qualityReviewImages || []).map((image) => image.id),
      productManifest: generated.manifest,
      productBundleDeliverableId: bundle.id,
      noSellableFilesClaimed: false,
    },
  });
  const next = journey
    ? queueStorefrontVisual(db, cataloguePlan(db, plan.id), opportunityRecord, task, generated)
    : queueQualityReview(db, cataloguePlan(db, plan.id), opportunityRecord, task, generated);
  insertEvent(db, {
    actor: "pantheon",
    type: "catalogue.files_built",
    entityType: "catalogue_plan",
    entityId: plan.id,
    message: `Pantheon stored and validated ${generated.files.length} product-package files; independent quality review is next.`,
    metadata: { taskId: task.id, bundleId: bundle.id, revisionNumber },
  });
  return { next, bundle, generated };
}

function projectStorefrontVisual(db, task, plan, opportunityRecord) {
  const metadata = productMetadata(task);
  const output = taskOutput(task);
  const visualAssets = Array.isArray(output.generatedAssets) ? output.generatedAssets : [];
  if (visualAssets.length !== 1) {
    throw new Error("The storefront visual stage did not retain exactly one generated cover image.");
  }
  const buildTask = get(db, "SELECT * FROM tasks WHERE id = ?", [metadata.buildTaskId]);
  if (!buildTask || buildTask.status !== "completed") {
    throw new Error("The storefront visual is not bound to a completed product build.");
  }
  const generated = generatedProductResult(parseRow(buildTask, ["payload", "result"]));
  const updated = updatePlan(db, plan.id, {
    status: "quality_review",
    metadata: {
      buildStatus: "storefront_visual_ready",
      storefrontVisualTaskId: task.id,
      storefrontVisualIds: visualAssets.map((asset) => asset.id),
      storefrontPreviewIds: (generated.previews || []).map((preview) => preview.id),
      qualityReviewImageIds: (generated.qualityReviewImages || []).map((image) => image.id),
    },
  });
  const review = queueQualityReview(
    db,
    updated,
    opportunityRecord,
    parseRow(buildTask, ["payload", "result"]),
    generated,
    visualAssets.map((asset) => asset.id),
  );
  insertEvent(db, {
    actor: "pantheon",
    type: "catalogue.storefront_visual_ready",
    entityType: "catalogue_plan",
    entityId: plan.id,
    message: "Pantheon retained one storefront cover and passed the exact product visuals to independent review.",
    metadata: {
      taskId: task.id,
      visualAssetIds: visualAssets.map((asset) => asset.id),
      previewIds: (generated.previews || []).map((preview) => preview.id),
    },
  });
  return { next: review, visualAssets };
}

function qualityPassed(output, options = {}) {
  const work = output.roleOutput || {};
  const score = Number(work.qualityScore || 0);
  const decision = String(output.operatorDecision || "");
  const riskFindings = Array.isArray(work.riskFindings) ? work.riskFindings : null;
  const missingEvidence = Array.isArray(work.missingEvidence) ? work.missingEvidence : null;
  const outputRisks = Array.isArray(output.risks) ? output.risks : [];
  const claimSafety = String(work.claimSafety || "").trim();
  const claimSafetyPassed = /^(?:safe|supported|acceptable)\b/i.test(claimSafety)
    && !qualityFindingIsMaterial(claimSafety);
  const highRisk = outputRisks.some((risk) => (
    /\b(high risk|unsafe|illegal|materially false)\b/i.test(String(risk))
    || qualityFindingIsMaterial(risk)
  ));
  const materialFinding = (riskFindings || []).some(qualityFindingIsMaterial);
  const baselinePassed = score >= 80 && decision === "approve" && !highRisk;
  const requireCompleteEvidence = options.requireCompleteEvidence === true;
  return {
    passed: baselinePassed && (
      !requireCompleteEvidence
      || (
        Array.isArray(riskFindings)
        && Array.isArray(missingEvidence)
        && missingEvidence.length === 0
        && claimSafetyPassed
        && !materialFinding
      )
    ),
    score,
    highRisk,
    materialFinding,
    claimSafetyPassed,
    decision,
    findings: [
      ...(riskFindings || []),
      ...(missingEvidence || []),
      ...outputRisks,
    ].filter(Boolean),
  };
}

function qualityRevisionCorrections(output, verdict) {
  const roleOutput = output.roleOutput || {};
  const actionableFindings = (verdict.findings || []).filter((finding) => (
    !/^no (?:major |unresolved )/i.test(String(finding))
    && /clipp|overflow|misrepresent|usability|layout|visual|workbook|formula|content|grammar|wording|copy|claim|contact|history|instruction|payment|field|status/i.test(String(finding))
  ));
  return [...new Set([
    output.nextAction,
    roleOutput.operatorRecommendation,
    ...actionableFindings,
  ].filter(Boolean).map((item) => String(item).replace(/\s+/g, " ").trim()))].slice(0, 6);
}

function queueConversionCopy(db, plan, opportunityRecord, qualityTask, options = {}) {
  const revision = Number(options.contextRevision || 0);
  const existing = existingProductionContextTask(db, plan.id, "conversion_copy", revision);
  if (existing) return { task: existing, existing: true };
  const journey = journeyForPlan(db, plan);
  const productTitle = actualProductTitle(plan, opportunityRecord);
  const verifiedCatalogue = conciseCatalogueContext(plan);
  const expectedIncludedFiles = verifiedCatalogue.listingIncludedFiles;
  const verifiedState = {
    contextRevision: revision,
    stage: "conversion_copy",
    qualityPassed: verifiedCatalogue.independentQuality.passed,
    qualityScore: verifiedCatalogue.independentQuality.score,
    catalogueItemCount: verifiedCatalogue.catalogueItems.length,
    bundleFilename: verifiedCatalogue.bundleFilename,
    customerPromise: verifiedCatalogue.customerPromise,
    canonicalManifestInsideBundle: verifiedCatalogue.canonicalManifestInsideBundle,
    currentPackageReconciled: true,
    expectedIncludedFiles,
    supersededErrorsAreCurrent: false,
  };
  const request = requestLiveAiWorker(db, qualityTask.workflow_id, {
    requestKey: `catalogue_copy_${safeId(plan.id)}_context_${revision}`,
    requestedBy: "pantheon_supervisor",
    worker: "copy_conversion_agent",
    taskTitle: revision
      ? `Correct the listing copy from verified files for ${productTitle}`
      : `Prepare the listing copy for ${productTitle}`,
    approvalTitle: revision
      ? `Correct the listing copy from the verified ${productTitle} files`
      : `Run the listing-copy preparation for ${productTitle}`,
    estimatedCostCents: 150,
    reason: "Prepare truthful listing copy for the quality-passed local product package. No copy will be published or sent.",
    expectedOutput: "A Gumroad-ready product title, headline, description, included-file summary, tags, FAQ, buyer promise, calls to action, message variants, tracking note, and claim checks.",
    expectedMetric: "Copy matches the real product files, buyer, channel, price hypothesis, and evidence without unsupported claims.",
    model: journey?.model || CONFIG.terraModel,
    modelLocked: journey?.model_locked === 1,
    maxOutputTokens: 2400,
    maxTurns: 1,
    maxToolCalls: 0,
    tools: [],
    contextClasses: ["venture", "evidence"],
    businessContext: {
      subject: opportunityRecord.title,
      buyer: opportunityRecord.buyer,
      problem: opportunityRecord.problem,
      offer: actualProductOffer(plan, opportunityRecord),
      channel: opportunityRecord.channel,
      evidenceStandard: "Only claim what the validated opportunity evidence and actual product manifest support.",
    },
    workBrief: {
      objective: "Write conversion copy for the exact quality-passed catalogue and its first commercial test.",
      deliverable: "One complete Gumroad listing plus concise message variants and claim checks in ordinary buyer language.",
      assetPrompt: serializedLaunchContext({
        currentVerifiedCatalogue: verifiedCatalogue,
        currentQualityReview: conciseQualityContext(qualityTask),
        requiredIncludedFileSummary: expectedIncludedFiles,
        currency: CONFIG.currency,
        priceFloorCents: plan.price_floor_cents,
        priceCeilingCents: plan.price_ceiling_cents,
      }, "The verified listing-copy context"),
      requiredCorrections: revision ? [
        "Use only the current verified catalogue and quality review. Do not report a superseded truncation, parser error, missing workflow-status field, or earlier failed attempt as a current defect.",
        "Describe this as an editable workbook-and-guide toolkit, never as a client portal, automated system, or service.",
      ] : [],
      constraints: [
        "No fabricated scarcity, testimonials, sales, guarantees, or performance claims.",
        "No publishing or customer contact.",
        `Use ${CONFIG.currency} for the proposed listing price and every current commercial total. Foreign marketplace comparisons must be clearly labelled as source evidence, not as the Pantheon price.`,
      ],
      acceptanceCriteria: [
        "The product title and offer are clear at a glance.",
        "Return requiredIncludedFileSummary exactly as includedFiles, in the same order and without adding or removing entries.",
        "Tags and FAQ are specific, useful, and free of unsupported claims.",
        "The call to action is measurable.",
        `The tracking note uses the exact ${CONFIG.currency} price supplied in the verified context.`,
      ],
    },
    parameters: {
      ...journeyParameters(journey),
      pantheonProduction: {
        supervisorOwned: true,
        currentTruthOnly: true,
        stage: "conversion_copy",
        roundId: productMetadata(qualityTask).roundId,
        opportunityId: opportunityRecord.id,
        planId: plan.id,
        qualityTaskId: qualityTask.id,
        journeyId: journey?.id || null,
        contextRevision: revision,
        verifiedLaunchState: verifiedState,
      },
    },
    effects: [],
  });
  if (journey) {
    updateJourney(db, journey.id, {
      status: "running",
      activeStage: "conversion_copy",
      metadata: {
        currentTaskId: request.task?.id || null,
        currentApprovalId: request.approval?.id || null,
      },
      stageEvent: {
        stage: "conversion_copy",
        status: request.task?.status || "waiting_to_start",
        taskId: request.task?.id || null,
        workerId: "copy_conversion_agent",
        note: "Truthful Gumroad listing copy is ready to prepare from the quality-passed files.",
      },
    });
  }
  return request;
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

function deliverableTextIssues(deliverable, label) {
  if (!deliverable) return [`${label} is missing.`];
  const root = path.resolve(CONFIG.rootDir);
  const artifactRoot = path.resolve(CONFIG.artifactRoot);
  const filePath = path.resolve(root, String(deliverable.file_path || ""));
  const managed = [root, artifactRoot].some((allowedRoot) => (
    filePath === allowedRoot || filePath.startsWith(`${allowedRoot}${path.sep}`)
  ));
  if (!managed) {
    return [`${label} points outside Pantheon's managed workspace.`];
  }
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    return [`${label} is not available on disk.`];
  }
  const text = fs.readFileSync(filePath, "utf8");
  return [
    ...publicationTextIssues(text, label),
    ...currentPackageDefectIssues(text, label),
  ];
}

function launchReadinessIssues(db, plan, options = {}) {
  const issues = [];
  const manifest = plan?.metadata?.productManifest || {};
  const expectedIncludedFiles = canonicalListingIncludedFiles(manifest);
  if (!manifest.bundle?.filename || manifest.bundle?.canonicalManifestInsideBundle !== true) {
    issues.push("The canonical product bundle and embedded manifest are not reconciled.");
  }
  if (Number(plan?.metadata?.qualityScore || 0) < 80 || plan?.metadata?.qualityDecision !== "approve") {
    issues.push("The current exact product package has not passed independent quality review.");
  }
  if (!expectedIncludedFiles.length) {
    issues.push("The canonical product manifest does not describe the customer package.");
  }

  const listingDeliverable = options.listingDeliverable || get(
    db,
    "SELECT * FROM deliverables WHERE id = ? AND status <> 'superseded'",
    [plan?.metadata?.listingCopyDeliverableId || ""],
  );
  issues.push(...deliverableTextIssues(listingDeliverable, "The current listing copy"));
  if (listingDeliverable && expectedIncludedFiles.length) {
    const listingPath = path.resolve(CONFIG.rootDir, String(listingDeliverable.file_path || ""));
    if (fs.existsSync(listingPath)) {
      const listingText = fs.readFileSync(listingPath, "utf8");
      for (const item of expectedIncludedFiles) {
        if (!listingText.includes(`- ${item}`)) {
          issues.push(`The current listing copy is missing canonical package entry: ${item}`);
        }
      }
    }
  }

  const launchDeliverable = options.launchDeliverable || get(
    db,
    "SELECT * FROM deliverables WHERE id = ? AND status <> 'superseded'",
    [plan?.metadata?.launchPackDeliverableId || ""],
  );
  if (options.requireLaunchPack !== false) {
    issues.push(...deliverableTextIssues(launchDeliverable, "The current launch pack"));
  }

  if (options.requireChiefBrief === true) {
    const chiefDeliverable = options.chiefDeliverable || get(
      db,
      "SELECT * FROM deliverables WHERE id = ? AND status <> 'superseded'",
      [plan?.metadata?.chiefBriefDeliverableId || ""],
    );
    issues.push(...deliverableTextIssues(chiefDeliverable, "The current operator brief"));
  }
  return [...new Set(issues)];
}

function projectQualityReview(db, task, plan, opportunityRecord) {
  const metadata = productMetadata(task);
  const buildTaskRow = metadata.buildTaskId
    ? get(db, "SELECT * FROM tasks WHERE id = ?", [metadata.buildTaskId])
    : null;
  if (!buildTaskRow || buildTaskRow.status !== "completed") {
    throw new Error("Quality review is no longer bound to a completed product package.");
  }
  const buildTask = parseRow(buildTaskRow, ["payload", "result"]);
  const generated = generatedProductResult(buildTask);
  const currentReview = queueQualityReview(
    db,
    plan,
    opportunityRecord,
    buildTask,
    generated,
    Array.isArray(plan.metadata.storefrontVisualIds) ? plan.metadata.storefrontVisualIds : [],
  );
  if (currentReview.task.id !== task.id) {
    updatePlan(db, plan.id, {
      status: "quality_review",
      metadata: {
        buildStatus: "locally_repaired_pending_quality_review",
        supersededQualityTaskId: task.id,
        qualityTaskId: currentReview.task.id,
        qualityReviewFingerprint: qualityReviewFingerprintForTask(currentReview.task),
      },
    });
    insertEvent(db, {
      actor: "jarvis",
      type: "catalogue.quality_review_superseded",
      entityType: "task",
      entityId: task.id,
      message: "Pantheon preserved the earlier quality result but did not apply it to a locally corrected package with different verified hashes.",
      metadata: {
        planId: plan.id,
        replacementTaskId: currentReview.task.id,
        reviewedFingerprint: qualityReviewFingerprintForTask(task),
        currentFingerprint: qualityReviewFingerprintForTask(currentReview.task),
      },
    });
    return {
      next: currentReview,
      staleReviewSuperseded: true,
      supersededTaskId: task.id,
    };
  }
  const output = taskOutput(task);
  const verdict = qualityPassed(output, {
    requireCompleteEvidence: Boolean(plan.metadata.validationSample),
  });
  const revisionNumber = Number(productMetadata(task)?.revisionNumber || 0);
  if (!verdict.passed) {
    if (metadata.inspectionEvidenceRecheck === true) {
      updatePlan(db, plan.id, {
        status: "needs_attention",
        metadata: {
          buildStatus: "inspection_evidence_recheck_failed_terminal",
          qualityTaskId: task.id,
          qualityScore: verdict.score,
          qualityFindings: verdict.findings,
          qualityDecision: verdict.decision,
          correctionPrepared: false,
          correctionRequiresNewBudget: false,
          inspectionEvidenceRecheckTaskId: task.id,
          inspectionEvidenceRecheckExhausted: true,
        },
      });
      terminalizeInspectionEvidenceRecheckPersistence(db, plan);
      run(
        db,
        "UPDATE catalogue_items SET quality_status = 'needs_changes', updated_at = ? WHERE plan_id = ?",
        [now(), plan.id],
      );
      insertEvent(db, {
        level: "warn",
        actor: "pantheon",
        type: "catalogue.validation_inspection_recheck_failed_terminal",
        entityType: "catalogue_plan",
        entityId: plan.id,
        message: "Pantheon stopped the validation package permanently because its single inspection-evidence recheck did not pass.",
        metadata: {
          taskId: task.id,
          sourceQualityTaskId: metadata.inspectionEvidenceSourceQualityTaskId || null,
          score: verdict.score,
          decision: verdict.decision,
          findings: verdict.findings,
          correctionPrepared: false,
          additionalApprovalRequired: false,
          retryAllowed: false,
        },
      });
      return {
        next: null,
        verdict,
        correctionPrepared: false,
        additionalApprovalRequired: false,
        terminal: true,
      };
    }
    if (plan.metadata.validationSample) {
      const correctionLimit = Math.max(
        0,
        Number(plan.metadata.validationSample.providerPolicy?.correctionLimit || 0),
      );
      const revisionCorrections = qualityRevisionCorrections(output, verdict);
      if (revisionNumber < correctionLimit) {
        try {
          const revision = prepareCatalogueBuild(db, {
            planId: plan.id,
            opportunityId: opportunityRecord.id,
            revisionNumber: revisionNumber + 1,
            revisionCorrections: revisionCorrections.length
              ? revisionCorrections
              : [output.summary],
            operatorChoiceRequired: false,
          });
          updatePlan(db, plan.id, {
            status: "rebuilding",
            metadata: {
              buildStatus: "validation_sample_correction_prepared",
              qualityTaskId: task.id,
              qualityScore: verdict.score,
              qualityFindings: verdict.findings,
              qualityDecision: verdict.decision,
              correctionPrepared: true,
              correctionRequiresNewBudget: false,
              correctionTaskId: revision.task?.id || null,
            },
          });
          run(
            db,
            "UPDATE catalogue_items SET quality_status = 'needs_changes', updated_at = ? WHERE plan_id = ?",
            [now(), plan.id],
          );
          insertEvent(db, {
            level: "warn",
            actor: "pantheon",
            type: "catalogue.validation_sample_correction_prepared",
            entityType: "catalogue_plan",
            entityId: plan.id,
            message: "Pantheon prepared the one permitted internal correction after the validation sample failed review.",
            metadata: {
              taskId: task.id,
              correctionTaskId: revision.task?.id || null,
              score: verdict.score,
              findings: verdict.findings,
              combinedBudgetCents: Number(
                plan.metadata.validationSample.providerPolicy?.combinedCapCents || 0,
              ),
            },
          });
          return {
            next: revision,
            verdict,
            correctionPrepared: true,
            additionalApprovalRequired: false,
          };
        } catch (error) {
          if (!/buyer-intent AI limit/i.test(String(error.message || ""))) throw error;
        }
      }
      updatePlan(db, plan.id, {
        status: "needs_attention",
        metadata: {
          buildStatus: "validation_sample_quality_review_failed",
          qualityTaskId: task.id,
          qualityScore: verdict.score,
          qualityFindings: verdict.findings,
          qualityDecision: verdict.decision,
          correctionPrepared: false,
          correctionRequiresNewBudget: true,
        },
      });
      run(
        db,
        "UPDATE catalogue_items SET quality_status = 'needs_changes', updated_at = ? WHERE plan_id = ?",
        [now(), plan.id],
      );
      insertEvent(db, {
        level: "warn",
        actor: "pantheon",
        type: "catalogue.validation_sample_quality_failed",
        entityType: "catalogue_plan",
        entityId: plan.id,
        message: revisionNumber >= correctionLimit
          ? "Pantheon stopped after the permitted validation-sample correction still failed quality review."
          : "Pantheon stopped because the validation sample could not be corrected inside its approved AI limit.",
        metadata: {
          taskId: task.id,
          score: verdict.score,
          findings: verdict.findings,
          combinedBudgetCents: Number(plan.metadata.validationSample.providerPolicy?.combinedCapCents || 0),
          additionalApprovalRequired: true,
        },
      });
      return {
        next: null,
        verdict,
        correctionPrepared: false,
        additionalApprovalRequired: true,
      };
    }
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
      const revisionCorrections = qualityRevisionCorrections(output, verdict);
      const revision = prepareCatalogueBuild(db, {
        planId: plan.id,
        opportunityId: opportunityRecord.id,
        revisionNumber: revisionNumber + 1,
        revisionCorrections: revisionCorrections.length ? revisionCorrections : [output.summary],
        operatorChoiceRequired: false,
      });
      const journey = journeyForPlan(db, plan);
      if (journey) {
        updateJourney(db, journey.id, {
          status: "running",
          activeStage: "product_build",
          metadata: {
            currentTaskId: revision.task?.id || null,
            currentApprovalId: revision.approval?.id || null,
            correctionReason: verdict.findings.join("; ") || output.summary,
          },
          stageEvent: {
            stage: "quality_review",
            status: "revision_required",
            taskId: task.id,
            workerId: "quality_reviewer",
            note: "One bounded product correction was prepared from the exact review findings.",
          },
        });
      }
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
    const journey = journeyForPlan(db, plan);
    if (journey) {
      updateJourney(db, journey.id, {
        status: "stopped_after_correction",
        activeStage: "quality_review",
        completedAt: now(),
        metadata: {
          blocker: "The corrected product package still failed independent quality review.",
          currentTaskId: null,
          currentApprovalId: null,
        },
        stageEvent: {
          stage: "quality_review",
          status: "stopped_after_correction",
          taskId: task.id,
          workerId: "quality_reviewer",
          note: "The single permitted correction did not reach the quality threshold.",
        },
      });
    }
    return { next: null, verdict, correctionPrepared: false };
  }
  run(
    db,
    "UPDATE catalogue_items SET status = 'ready', quality_status = 'passed', updated_at = ? WHERE plan_id = ?",
    [now(), plan.id],
  );
  markCatalogueDeliverablesQualityPassed(db, plan, generated);
  if (plan.metadata.validationSample) {
    updatePlan(db, plan.id, {
      status: "validation_sample_ready",
      metadata: {
        buildStatus: "validation_sample_quality_passed",
        qualityTaskId: task.id,
        qualityScore: verdict.score,
        qualityFindings: verdict.findings,
        qualityDecision: verdict.decision,
        investmentCaseRemainsParked: true,
      },
    });
    const finalized = finalizeBuyerIntentValidationSample(db, {
      planId: plan.id,
      buildTaskId: buildTask.id,
      qualityTaskId: task.id,
      generated,
    });
    insertEvent(db, {
      actor: "pantheon",
      type: "catalogue.validation_sample_quality_passed",
      entityType: "catalogue_plan",
      entityId: plan.id,
      message: `The functional validation sample passed independent quality review at ${verdict.score}/100; its exact buyer test is ready for review.`,
      metadata: {
        taskId: task.id,
        score: verdict.score,
        executionPackId: finalized.pack.id,
        noExternalAction: true,
      },
    });
    return {
      next: null,
      verdict,
      validationSampleReady: true,
      executionPack: finalized.pack,
    };
  }
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
  const copy = queueConversionCopy(db, updated, opportunityRecord, task, {
    contextRevision: Number(updated.metadata.launchContextRevision || 0),
  });
  insertEvent(db, {
    actor: "pantheon",
    type: "catalogue.quality_passed",
    entityType: "catalogue_plan",
    entityId: plan.id,
    message: `The product package passed independent quality review at ${verdict.score}/100; launch copy is next.`,
    metadata: { taskId: task.id, score: verdict.score },
  });
  const journey = journeyForPlan(db, plan);
  if (journey) {
    updateJourney(db, journey.id, {
      status: "running",
      activeStage: "conversion_copy",
      metadata: {
        qualityScore: verdict.score,
        qualityTaskId: task.id,
      },
      stageEvent: {
        stage: "quality_review",
        status: "completed",
        taskId: task.id,
        workerId: "quality_reviewer",
        note: `The exact product and storefront assets passed at ${verdict.score}/100.`,
      },
    });
  }
  return { next: copy, verdict };
}

function queueDistributionPlan(db, plan, opportunityRecord, copyTask, options = {}) {
  const revision = Number(options.contextRevision ?? contextRevision(copyTask));
  const existing = existingProductionContextTask(db, plan.id, "distribution_plan", revision);
  if (existing) return { task: existing, existing: true };
  const journey = journeyForPlan(db, plan);
  const productTitle = actualProductTitle(plan, opportunityRecord);
  const verifiedCatalogue = conciseCatalogueContext(plan);
  const verifiedState = {
    contextRevision: revision,
    stage: "distribution_plan",
    qualityPassed: verifiedCatalogue.independentQuality.passed,
    qualityScore: verifiedCatalogue.independentQuality.score,
    catalogueItemCount: verifiedCatalogue.catalogueItems.length,
    bundleFilename: verifiedCatalogue.bundleFilename,
    customerPromise: verifiedCatalogue.customerPromise,
    currentPackageReconciled: true,
    expectedIncludedFiles: verifiedCatalogue.listingIncludedFiles,
    copyTaskId: copyTask.id,
    copyTaskStatus: copyTask.status,
    supersededErrorsAreCurrent: false,
  };
  const request = requestLiveAiWorker(db, copyTask.workflow_id, {
    requestKey: `catalogue_distribution_${safeId(plan.id)}_context_${revision}`,
    requestedBy: "pantheon_supervisor",
    worker: "distribution_operator",
    taskTitle: `Prepare the first market test for ${productTitle}`,
    approvalTitle: `Run the market-test preparation for ${productTitle}`,
    estimatedCostCents: 150,
    reason: "Prepare a channel-specific, measurable launch plan for operator review. No post, listing, ad, message, or spend will occur.",
    expectedOutput: "A 14-day or 50-qualified-view launch plan, up to three organic posts across no more than two channels, tracking requirements, stop rule, and operator workload.",
    expectedMetric: "The plan can test three independent buyers and positive cash contribution without unapproved public or paid action.",
    model: journey?.model || CONFIG.terraModel,
    modelLocked: journey?.model_locked === 1,
    maxOutputTokens: 4000,
    maxTurns: 1,
    maxToolCalls: 0,
    tools: [],
    contextClasses: ["venture", "evidence", "finance", "operations"],
    businessContext: {
      subject: opportunityRecord.title,
      buyer: opportunityRecord.buyer,
      problem: opportunityRecord.problem,
      offer: actualProductOffer(plan, opportunityRecord),
      channel: opportunityRecord.channel,
      evidenceStandard: "Use the actual product package, approved opportunity evidence, and conservative unit economics.",
    },
    workBrief: {
      objective: "Prepare the smallest credible first-revenue test for the finished product package.",
      deliverable: "Channel sequence, post concepts, measurement plan, 14-day/50-view stop rule, and exact operator-only external actions.",
      assetPrompt: serializedLaunchContext({
        currentVerifiedCatalogue: verifiedCatalogue,
        currentAcceptedListing: conciseListingContext(copyTask, plan),
        currency: CONFIG.currency,
        priceFloorCents: plan.price_floor_cents,
        priceCeilingCents: plan.price_ceiling_cents,
      }, "The verified distribution context"),
      requiredCorrections: revision ? [
        "Use the current accepted listing and verified catalogue only. Earlier failed or truncated attempts are audit history, not current product defects.",
        "Do not describe the workbook-and-guide toolkit as a client portal or automated system.",
      ] : [],
      constraints: ["At most three organic posts across two channels initially.", "No automatic posting, account action, contact, or spend.", "A$25 paid test is optional only after organic reach is insufficient."],
      acceptanceCriteria: ["Every step has a metric.", "Daniel's external actions are short and explicit.", "Stop, revise, and continue conditions are unambiguous."],
    },
    parameters: {
      ...journeyParameters(journey),
      pantheonProduction: {
        supervisorOwned: true,
        currentTruthOnly: true,
        stage: "distribution_plan",
        roundId: productMetadata(copyTask).roundId,
        opportunityId: opportunityRecord.id,
        planId: plan.id,
        copyTaskId: copyTask.id,
        journeyId: journey?.id || null,
        contextRevision: revision,
        verifiedLaunchState: verifiedState,
      },
    },
    effects: [],
  });
  if (journey) {
    updateJourney(db, journey.id, {
      status: "running",
      activeStage: "distribution_plan",
      metadata: {
        currentTaskId: request.task?.id || null,
        currentApprovalId: request.approval?.id || null,
      },
      stageEvent: {
        stage: "distribution_plan",
        status: request.task?.status || "waiting_to_start",
        taskId: request.task?.id || null,
        workerId: "distribution_operator",
        note: "The measured launch plan and up to three initial posts are ready to prepare.",
      },
    });
  }
  return request;
}

function projectConversionCopy(db, task, plan, opportunityRecord) {
  const output = taskOutput(task);
  const work = output.roleOutput || {};
  const expectedIncludedFiles = canonicalListingIncludedFiles(plan.metadata.productManifest || {});
  const outputIssues = [
    ...publicationTextIssues(output, "The accepted listing"),
    ...currentPackageDefectIssues(output, "The accepted listing"),
  ];
  if (!exactPublicationListMatch(work.includedFiles, expectedIncludedFiles)) {
    outputIssues.push("The accepted listing does not contain the exact canonical included-file summary.");
  }
  const customerPriceText = [
    work.productTitle,
    work.headline,
    work.description,
    work.callToAction,
    work.trackingNote,
    ...(Array.isArray(work.messageVariants) ? work.messageVariants : []),
  ].filter(Boolean).join("\n");
  if (containsForeignCanonicalPrice(customerPriceText, plan)) {
    outputIssues.push("The accepted listing presents Pantheon's canonical AUD test price as a foreign-currency price.");
  }
  if (outputIssues.length) {
    throw new Error(`Pantheon refused to publish malformed listing material: ${outputIssues.join(" ")}`);
  }
  const content = listingCopyContent(plan, opportunityRecord, task);
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
    metadata: {
      copyTaskId: task.id,
      listingCopyDeliverableId: deliverable.id,
      launchContextRevision: contextRevision(task),
    },
  });
  const next = queueDistributionPlan(db, updated, opportunityRecord, task, {
    contextRevision: contextRevision(task),
  });
  const journey = journeyForPlan(db, plan);
  if (journey) {
    updateJourney(db, journey.id, {
      stageEvent: {
        stage: "conversion_copy",
        status: "completed",
        taskId: task.id,
        workerId: "copy_conversion_agent",
        note: "The complete Gumroad listing copy, tags, FAQ, and claim checks were retained.",
      },
    });
  }
  return { next, deliverable };
}

function listingCopyContent(plan, opportunityRecord, task) {
  const output = taskOutput(task);
  const work = output.roleOutput || {};
  const expectedIncludedFiles = canonicalListingIncludedFiles(plan.metadata.productManifest || {});
  return [
    `# ${opportunityRecord.title} Listing Copy`,
    "",
    "## Product Title",
    publicationPlanPriceText(work.productTitle || opportunityRecord.title, plan),
    "",
    `## Headline`,
    publicationPlanPriceText(work.headline || output.summary || opportunityRecord.title, plan),
    "",
    "## Description",
    publicationPlanPriceParagraphs(work.description || output.recommendation || "", plan),
    "",
    "## Included Files",
    ...expectedIncludedFiles.map((item) => `- ${item}`),
    "",
    "## Tags",
    publicationPlanPriceList(work.tags, plan).join(", "),
    "",
    "## Frequently Asked Questions",
    ...publicationPlanPriceList(work.faq, plan).map((item) => `- ${item}`),
    "",
    "## Call To Action",
    publicationPlanPriceText(work.callToAction || output.nextAction || "", plan),
    "",
    "## Message Variants",
    ...publicationPlanPriceList(work.messageVariants, plan).map((item) => `- ${item}`),
    "",
    "## Claim Checks",
    ...publicationPlanPriceList(work.claimChecks, plan).map((item) => `- ${item}`),
    "",
    "## Tracking",
    publicationPlanPriceText(work.trackingNote || "", plan),
  ].join("\n");
}

function launchPackContent(plan, opportunityRecord, distributionTask, copyTask, productFiles) {
  const distribution = taskOutput(distributionTask);
  const copy = taskOutput(copyTask);
  const work = distribution.roleOutput || {};
  const includedFiles = canonicalListingIncludedFiles(plan.metadata.productManifest || {});
  return [
    `# ${opportunityRecord.title} Launch Pack`,
    "",
    "## Decision",
    "The product files passed Pantheon's local checks and independent review. Nothing has been published, sent, or spent yet.",
    "",
    "## Product",
    `Buyer: ${opportunityRecord.buyer}`,
    `Problem: ${opportunityRecord.problem}`,
    `Offer: ${actualProductOffer(plan, opportunityRecord)}`,
    `Target price: A$${(Number(plan.price_floor_cents || 0) / 100).toFixed(2)}`,
    "",
    "## Files Ready",
    ...productFiles.map((file) => `- ${publicationSafeText(file.human_name)} (${publicationSafeText(file.format)})`),
    "",
    "## Package Contents",
    ...includedFiles.map((file) => `- ${file}`),
    "",
    "## Listing",
    publicationPlanPriceText(copy.roleOutput?.headline || copy.summary || "", plan),
    publicationPlanPriceParagraphs(copy.roleOutput?.description || copy.recommendation || "", plan),
    `Call to action: ${publicationPlanPriceText(copy.roleOutput?.callToAction || copy.nextAction || "", plan)}`,
    "",
    "## First Market Test",
    ...publicationPlanPriceList(work.channelSteps, plan).map((item) => `- ${item}`),
    "",
    `Success metric: ${publicationPlanPriceText(work.successMetric || "3 independent buyers and positive cash contribution", plan)}`,
    `Stop rule: ${publicationPlanPriceText(work.stopRule || "Revise or stop after 14 days or 50 qualified views if there is no meaningful buyer signal.", plan)}`,
    `Operator workload: ${publicationPlanPriceText(work.operatorWorkload || "Create or sign in to the approved marketplace account, review the final listing, and press Publish.", plan)}`,
    "",
    "## Still Protected",
    "- Marketplace account creation, KYC, publishing, posts, advertising activation, customer contact, refunds, agreements, and money movement still require Daniel or a later exact approval.",
  ].join("\n");
}

function queueChiefBrief(db, plan, opportunityRecord, distributionTask, copyTask, launchDeliverable, experiment, productFiles, options = {}) {
  const revision = Number(options.contextRevision ?? contextRevision(distributionTask));
  const existing = existingProductionContextTask(db, plan.id, "chief_brief", revision);
  if (existing) return { task: existing, existing: true };
  const journey = journeyForPlan(db, plan);
  const productTitle = actualProductTitle(plan, opportunityRecord);
  const verifiedCatalogue = conciseCatalogueContext(plan);
  const decisionContext = chiefDecisionContext(plan, copyTask, distributionTask);
  const verifiedState = {
    contextRevision: revision,
    stage: "chief_brief",
    qualityPassed: verifiedCatalogue.independentQuality.passed,
    qualityScore: verifiedCatalogue.independentQuality.score,
    catalogueItemCount: verifiedCatalogue.catalogueItems.length,
    bundleFilename: verifiedCatalogue.bundleFilename,
    customerPromise: verifiedCatalogue.customerPromise,
    currentPackageReconciled: true,
    expectedIncludedFiles: verifiedCatalogue.listingIncludedFiles,
    copyTaskId: copyTask.id,
    copyTaskStatus: copyTask.status,
    distributionTaskId: distributionTask.id,
    distributionTaskStatus: distributionTask.status,
    launchPackDeliverableId: launchDeliverable.id,
    supersededErrorsAreCurrent: false,
  };
  const request = requestLiveAiWorker(db, distributionTask.workflow_id, {
    requestKey: `catalogue_chief_brief_${safeId(plan.id)}_context_${revision}`,
    requestedBy: "pantheon_supervisor",
    worker: "chief_of_staff",
    taskTitle: `Prepare the final operator brief for ${productTitle}`,
    approvalTitle: `Prepare the final operator brief for ${productTitle}`,
    estimatedCostCents: 100,
    reason: "Turn the verified specialist outputs into one concise operator decision. No public or account action will occur.",
    expectedOutput: "One plain-language brief stating the product, evidence, economics, exact files, launch plan, cost, risks, decision, success metric, and stop rule.",
    expectedMetric: "Daniel can understand and decide the exact ready-to-publish package without opening multiple technical records.",
    model: journey?.model || CONFIG.terraModel,
    modelLocked: journey?.model_locked === 1,
    maxOutputTokens: 4000,
    maxTurns: 1,
    maxToolCalls: 0,
    tools: [],
    contextClasses: ["venture", "evidence", "finance", "operations", "learning"],
    businessContext: {
      subject: opportunityRecord.title,
      buyer: opportunityRecord.buyer,
      problem: opportunityRecord.problem,
      offer: actualProductOffer(plan, opportunityRecord),
      channel: opportunityRecord.channel,
      evidenceStandard: "Summarise only the exact retained product, source, cost, quality, copy, and distribution records. Do not invent results or imply publication.",
    },
    workBrief: {
      objective: "Create the final concise decision brief for the complete pre-publication journey.",
      deliverable: "Money move, why now, expected upside, cost/risk, exact decision needed, success metric, and stop rule.",
      assetPrompt: serializedLaunchContext({
        opportunity: {
          title: opportunityRecord.title,
          buyer: opportunityRecord.buyer,
          problem: opportunityRecord.problem,
          offer: actualProductOffer(plan, opportunityRecord),
          score: opportunityRecord.overall_score,
          confidence: opportunityRecord.confidence,
        },
        ...decisionContext,
        retainedCustomerPackages: productFiles.map((file) => ({ name: file.human_name, format: file.format })),
        launchPackDeliverableId: launchDeliverable.id,
        experimentId: experiment.id,
      }, "The verified Chief of Staff context"),
      requiredCorrections: revision ? [
        "Treat the current quality-passed catalogue, accepted listing, and accepted distribution plan as authoritative. Do not revive superseded truncation, parser, status-field, or earlier quality findings.",
        "The exact operator decision is whether to mark the local package ready to publish. This does not publish it or claim that demand is proven.",
        "Describe the product as an editable workbook-and-guide toolkit, never as a client portal or automated system.",
      ] : [],
      constraints: [
        "No claim that the product is public, selling, proven, or earning revenue.",
        "No account action, customer contact, publishing, advertising, or money movement.",
        "Use ordinary business language and one clear decision.",
        "Do not treat superseded failed attempts as current product or launch defects.",
        "Do not state a current numeric provider or tool exposure; Pantheon appends the authoritative amount after this call completes.",
      ],
      acceptanceCriteria: [
        "The next money move is immediately clear.",
        "The brief states exact evidence and remaining uncertainty.",
        "The decision does not grant authority beyond moving the package to ready to publish.",
      ],
    },
    parameters: {
      ...journeyParameters(journey),
      pantheonProduction: {
        supervisorOwned: true,
        currentTruthOnly: true,
        stage: "chief_brief",
        roundId: productMetadata(distributionTask).roundId,
        opportunityId: opportunityRecord.id,
        planId: plan.id,
        distributionTaskId: distributionTask.id,
        copyTaskId: copyTask.id,
        launchPackDeliverableId: launchDeliverable.id,
        experimentId: experiment.id,
        journeyId: journey?.id || null,
        contextRevision: revision,
        verifiedLaunchState: verifiedState,
      },
    },
    effects: [],
  });
  if (journey) {
    updateJourney(db, journey.id, {
      status: "running",
      activeStage: "chief_brief",
      metadata: {
        currentTaskId: request.task?.id || null,
        currentApprovalId: request.approval?.id || null,
        launchPackDeliverableId: launchDeliverable.id,
      },
      stageEvent: {
        stage: "chief_brief",
        status: request.task?.status || "waiting_to_start",
        taskId: request.task?.id || null,
        workerId: "chief_of_staff",
        note: "The final operator brief is ready to prepare from verified specialist work.",
      },
    });
  }
  return request;
}

function projectDistribution(db, task, plan, opportunityRecord) {
  const metadata = productMetadata(task);
  const copyTask = get(db, "SELECT * FROM tasks WHERE id = ?", [metadata.copyTaskId]);
  if (!copyTask || copyTask.status !== "completed") throw new Error("Launch preparation is missing its completed listing-copy task.");
  const distributionOutput = taskOutput(task);
  const outputIssues = [
    ...publicationTextIssues(distributionOutput, "The accepted launch plan"),
    ...currentPackageDefectIssues(distributionOutput, "The accepted launch plan"),
  ];
  if (outputIssues.length) {
    throw new Error(`Pantheon refused to publish malformed launch material: ${outputIssues.join(" ")}`);
  }
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
      hypothesis: firstRevenueHypothesis(plan, opportunityRecord),
      buyer: opportunityRecord.buyer,
      offer: actualProductOffer(plan, opportunityRecord),
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
  } else {
    const experimentMetadata = fromJson(experiment.metadata, {});
    run(
      db,
      `UPDATE commercial_experiments
       SET status = 'ready', hypothesis = ?, buyer = ?, offer = ?, channel = ?,
         price_cents = ?, expected_metric = ?, target_value = 3, target_unit = 'buyers',
         metadata = ?, updated_at = ?
      WHERE id = ?`,
      [
        firstRevenueHypothesis(plan, opportunityRecord),
        opportunityRecord.buyer,
        actualProductOffer(plan, opportunityRecord),
        opportunityRecord.channel,
        Number(plan.price_floor_cents || 0),
        "independent paid buyers and positive cash contribution",
        toJson({
          ...experimentMetadata,
          launchPackDeliverableId: launchDeliverable.id,
          contextRevision: contextRevision(task),
          realStartConfirmed: false,
        }),
        now(),
        experiment.id,
      ],
    );
    experiment = get(db, "SELECT * FROM commercial_experiments WHERE id = ?", [experiment.id]);
  }
  const journey = journeyForPlan(db, plan);
  if (journey) {
    const updatedPlan = updatePlan(db, plan.id, {
      status: "chief_brief",
      metadata: {
        distributionTaskId: task.id,
        launchPackDeliverableId: launchDeliverable.id,
        experimentId: experiment.id,
        buildStatus: "preparing_final_operator_brief",
        launchContextRevision: contextRevision(task),
      },
    });
    const chief = queueChiefBrief(
      db,
      updatedPlan,
      opportunityRecord,
      task,
      parseRow(copyTask, ["payload", "result"]),
      launchDeliverable,
      experiment,
      productFiles,
      { contextRevision: contextRevision(task) },
    );
    updateJourney(db, journey.id, {
      stageEvent: {
        stage: "distribution_plan",
        status: "completed",
        taskId: task.id,
        workerId: "distribution_operator",
        note: "The measured launch plan, tracking fields, stop rules, and initial channel work were retained.",
      },
    });
    return { chief, launchDeliverable, experiment };
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
  const approvalPack = generateApprovalPack(db, task.workflow_id, {
    authoritativeExposureCents: combinedProofExposureFromDatabase(db).totalCents,
  });
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

function chiefBriefContent(db, plan, opportunityRecord, task, productFiles) {
  const output = taskOutput(task);
  const work = output.roleOutput || {};
  const evidence = Array.isArray(output.evidence) ? output.evidence : [];
  const risks = Array.isArray(output.risks) ? output.risks : [];
  const exposure = combinedProofExposureFromDatabase(db);
  const stableCostRisk = publicationPlanPriceText(stableCostRiskText(work.costRisk || ""), plan);
  return [
    `# ${opportunityRecord.title} Ready-to-Publish Brief`,
    "",
    "## The Decision",
    publicationPlanPriceText(work.decisionNeeded || output.nextAction || "Decide whether this exact product package should move to ready to publish.", plan),
    "",
    "## Recommended Money Move",
    publicationPlanPriceText(work.moneyMove || output.moneyMove || output.recommendation || "", plan),
    "",
    "## Why This Product",
    publicationPlanPriceParagraphs(output.summary || "", plan),
    publicationPlanPriceParagraphs(work.whyNow || "", plan),
    "",
    "## What Is Ready",
    `- Buyer: ${opportunityRecord.buyer}`,
    `- Problem: ${opportunityRecord.problem}`,
    `- Offer: ${actualProductOffer(plan, opportunityRecord)}`,
    `- Catalogue: ${plan.target_item_count} product items`,
    `- Target price: A$${(Number(plan.price_floor_cents || 0) / 100).toFixed(2)}`,
    `- Quality score: ${plan.metadata.qualityScore || "not recorded"}/100`,
    ...productFiles.map((file) => `- File: ${publicationSafeText(file.human_name)} (${publicationSafeText(file.format)})`),
    "",
    "## Evidence",
    ...(evidence.length ? publicationPlanPriceList(evidence, plan).map((item) => `- ${item}`) : ["- No additional evidence summary was supplied by the Chief of Staff."]),
    "",
    "## Expected Upside",
    publicationPlanPriceText(work.expectedUpside || "The first market test can establish whether real buyers will pay for the finished offer.", plan),
    "",
    "## Cost And Risk",
    `Current tracked pre-publication AI and tool exposure: A$${(Number(exposure.totalCents || 0) / 100).toFixed(2)} estimated or committed; exact provider billing remains pending.`,
    ...(stableCostRisk ? [stableCostRisk] : []),
    ...(risks.length ? publicationPlanPriceList(risks, plan).map((item) => `- ${item}`) : ["- Sales are not proven until independent buyers complete real purchases."]),
    "",
    "## How Success Will Be Judged",
    `Success metric: ${publicationPlanPriceText(work.successMetric || "Three independent paid buyers and positive cash contribution.", plan)}`,
    `Stop rule: ${publicationPlanPriceText(work.stopRule || "Revise or stop after 14 days or 50 qualified views without a meaningful buyer signal.", plan)}`,
    "",
    "## What Approval Does",
    "Approval marks this exact local package as ready to publish. It does not create a Gumroad account, complete KYC, upload files, publish posts, contact customers, activate advertising, or move money.",
  ].filter((line) => line !== undefined && line !== null).join("\n");
}

function projectChiefBrief(db, task, plan, opportunityRecord) {
  const metadata = productMetadata(task);
  const sourceRun = get(
    db,
     `SELECT * FROM agent_runs
     WHERE task_id = ? AND status = 'completed'
     ORDER BY completed_at DESC, started_at DESC LIMIT 1`,
    [task.id],
  );
  if (!sourceRun) throw new Error("The final Chief of Staff task has no completed Agents SDK run.");
  const launchDeliverable = get(db, "SELECT * FROM deliverables WHERE id = ?", [metadata.launchPackDeliverableId]);
  if (!launchDeliverable) throw new Error("The final Chief of Staff task is missing its exact launch pack.");
  const experiment = get(db, "SELECT * FROM commercial_experiments WHERE id = ?", [metadata.experimentId]);
  if (!experiment) throw new Error("The final Chief of Staff task is missing its first-revenue experiment.");
  const chiefOutput = taskOutput(task);
  const chiefOutputIssues = [
    ...publicationTextIssues(chiefOutput, "The final Chief of Staff output"),
    ...currentPackageDefectIssues(chiefOutput, "The final Chief of Staff output"),
    ...launchReadinessIssues(db, plan, { launchDeliverable }),
  ];
  if (chiefOutputIssues.length) {
    throw new Error(`Pantheon refused to prepare a publish-readiness decision: ${chiefOutputIssues.join(" ")}`);
  }
  const productFiles = all(
    db,
    `SELECT DISTINCT deliverables.*
     FROM deliverables
     JOIN catalogue_items ON catalogue_items.deliverable_id = deliverables.id
     WHERE catalogue_items.plan_id = ?
     ORDER BY deliverables.created_at ASC`,
    [plan.id],
  );
  const output = taskOutput(task);
  const briefDeliverable = writeTextDeliverable(
    db,
    task,
    `${slug(opportunityRecord.title)}-ready-to-publish-brief.md`,
    `${opportunityRecord.title} Ready-to-Publish Brief`,
    chiefBriefContent(db, plan, opportunityRecord, task, productFiles),
    {
      planId: plan.id,
      opportunityId: opportunityRecord.id,
      sourceTaskId: task.id,
      sourceRunId: sourceRun.id,
      launchPackDeliverableId: launchDeliverable.id,
      experimentId: experiment.id,
    },
  );
  const finalArtifactIssues = launchReadinessIssues(db, {
    ...plan,
    metadata: {
      ...plan.metadata,
      chiefBriefDeliverableId: briefDeliverable.id,
    },
  }, {
    launchDeliverable,
    chiefDeliverable: briefDeliverable,
    requireChiefBrief: true,
  });
  if (finalArtifactIssues.length) {
    throw new Error(`Pantheon refused to create the final operator decision: ${finalArtifactIssues.join(" ")}`);
  }
  const handoff = recordAgentHandoff(db, sourceRun, {
    handoffTo: "distribution_operator",
    outputSummary: output.summary || `${opportunityRecord.title} is ready for Daniel's publication decision.`,
    approvalRequired: true,
    handoffReason: "The complete internally verified product and Gumroad package is ready for Daniel's exact external-action decision.",
    handoffDecisionNeeded: `Decide whether to mark ${opportunityRecord.title} ready to publish.`,
    handoffRiskLevel: "medium",
    metadata: {
      pantheonProduction: {
        action: "authorize_launch_preparation",
        roundId: metadata.roundId,
        opportunityId: opportunityRecord.id,
        planId: plan.id,
        experimentId: experiment.id,
        launchPackDeliverableId: launchDeliverable.id,
        chiefBriefDeliverableId: briefDeliverable.id,
        journeyId: metadata.journeyId || null,
      },
    },
  });
  const approvalPack = generateApprovalPack(db, task.workflow_id, {
    authoritativeExposureCents: combinedProofExposureFromDatabase(db).totalCents,
    ...publicationPackOptions(db, plan, opportunityRecord, task.workflow_id, task.id),
  });
  updatePlan(db, plan.id, {
    status: "launch_decision",
    metadata: {
      chiefTaskId: task.id,
      chiefRunId: sourceRun.id,
      chiefBriefDeliverableId: briefDeliverable.id,
      launchDecisionHandoffId: handoff?.id || null,
      approvalPackDeliverableId: approvalPack?.id || null,
      buildStatus: "ready_for_launch_decision",
    },
  });
  const ts = now();
  run(db, "UPDATE opportunities SET status = 'ready_to_launch', updated_at = ? WHERE id = ?", [ts, opportunityRecord.id]);
  run(db, "UPDATE opportunity_rounds SET status = 'ready_to_launch', updated_at = ? WHERE id = ?", [ts, metadata.roundId]);
  run(
    db,
    `UPDATE workflows SET status = 'ready_for_review', current_step = 'Launch decision ready',
      approval_required = 1, updated_at = ? WHERE id = ?`,
    [ts, task.workflow_id],
  );
  const journey = journeyForPlan(db, plan);
  if (journey) {
    updateJourney(db, journey.id, {
      status: "waiting_for_operator",
      activeStage: "launch_decision",
      metadata: {
        currentTaskId: null,
        currentApprovalId: null,
        chiefTaskId: task.id,
        chiefRunId: sourceRun.id,
        chiefBriefDeliverableId: briefDeliverable.id,
        launchDecisionHandoffId: handoff?.id || null,
        approvalPackDeliverableId: approvalPack?.id || null,
      },
      stageEvent: {
        stage: "chief_brief",
        status: "completed",
        taskId: task.id,
        workerId: "chief_of_staff",
        note: "The final Luna Chief of Staff brief was retained and one exact ready-to-publish decision was prepared.",
      },
    });
  }
  return { handoff, launchDeliverable, briefDeliverable, approvalPack, experiment };
}

function refreshPublicationArtifacts(db, planId) {
  return withSavepoint(db, "refresh_publication_artifacts", () => {
    const plan = cataloguePlan(db, planId);
    if (!plan) throw new Error(`Catalogue plan not found: ${planId}`);
    if (!["launch_decision", "ready_to_publish"].includes(plan.status)) {
      throw new Error(`Publication artifacts can only be refreshed from a verified launch state; this plan is ${plan.status}.`);
    }
    const opportunityRecord = opportunity(db, plan.opportunity_id);
    if (!opportunityRecord) throw new Error("The publication package is missing its exact opportunity record.");
    const taskFor = (taskId, label) => {
      const task = parseRow(get(db, "SELECT * FROM tasks WHERE id = ?", [taskId]), ["payload", "result"]);
      if (!task || task.status !== "completed") {
        throw new Error(`${label} is not backed by a completed retained task.`);
      }
      return task;
    };
    const copyTask = taskFor(plan.metadata.copyTaskId, "The accepted listing");
    const distributionTask = taskFor(plan.metadata.distributionTaskId, "The accepted launch plan");
    const chiefTask = taskFor(plan.metadata.chiefTaskId, "The final operator brief");
    const buildTask = taskFor(plan.metadata.buildTaskId, "The accepted customer package");
    const qualityTask = taskFor(plan.metadata.qualityTaskId, "The accepted quality review");
    const qualityVerdict = qualityPassed(taskOutput(qualityTask));
    if (!qualityVerdict.passed) {
      throw new Error("Publication artifacts cannot be refreshed because the retained quality review did not pass.");
    }
    markCatalogueDeliverablesQualityPassed(db, plan, generatedProductResult(buildTask));
    const sourceRun = get(
      db,
      `SELECT * FROM agent_runs
       WHERE task_id = ? AND status = 'completed'
       ORDER BY completed_at DESC, started_at DESC LIMIT 1`,
      [chiefTask.id],
    );
    if (!sourceRun) throw new Error("The final operator brief has no completed Agents SDK source run.");
    const productFiles = all(
      db,
      `SELECT DISTINCT deliverables.*
       FROM deliverables
       JOIN catalogue_items ON catalogue_items.deliverable_id = deliverables.id
       WHERE catalogue_items.plan_id = ?
       ORDER BY deliverables.created_at ASC`,
      [plan.id],
    );

    const listingDeliverable = writeTextDeliverable(
      db,
      copyTask,
      `${slug(opportunityRecord.title)}-listing-copy.md`,
      `${opportunityRecord.title} Listing Copy`,
      listingCopyContent(plan, opportunityRecord, copyTask),
      { planId: plan.id, opportunityId: opportunityRecord.id, sourceTaskId: copyTask.id },
    );
    const launchDeliverable = writeTextDeliverable(
      db,
      distributionTask,
      `${slug(opportunityRecord.title)}-launch-pack.md`,
      `${opportunityRecord.title} Launch Pack`,
      launchPackContent(plan, opportunityRecord, distributionTask, copyTask, productFiles),
      { planId: plan.id, opportunityId: opportunityRecord.id, sourceTaskId: distributionTask.id },
    );
    const briefDeliverable = writeTextDeliverable(
      db,
      chiefTask,
      `${slug(opportunityRecord.title)}-ready-to-publish-brief.md`,
      `${opportunityRecord.title} Ready-to-Publish Brief`,
      chiefBriefContent(db, plan, opportunityRecord, chiefTask, productFiles),
      {
        planId: plan.id,
        opportunityId: opportunityRecord.id,
        sourceTaskId: chiefTask.id,
        sourceRunId: sourceRun.id,
        launchPackDeliverableId: launchDeliverable.id,
        experimentId: plan.metadata.experimentId || null,
      },
    );
    const refreshedPlan = {
      ...plan,
      metadata: {
        ...plan.metadata,
        listingCopyDeliverableId: listingDeliverable.id,
        launchPackDeliverableId: launchDeliverable.id,
        chiefBriefDeliverableId: briefDeliverable.id,
      },
    };
    const issues = launchReadinessIssues(db, refreshedPlan, {
      listingDeliverable,
      launchDeliverable,
      chiefDeliverable: briefDeliverable,
      requireChiefBrief: true,
    });
    if (issues.length) {
      throw new Error(`Pantheon refused to retain refreshed publication files: ${issues.join(" ")}`);
    }
    const approvalPack = generateApprovalPack(db, chiefTask.workflow_id, {
      authoritativeExposureCents: combinedProofExposureFromDatabase(db).totalCents,
      ...publicationPackOptions(db, plan, opportunityRecord, chiefTask.workflow_id),
    });
    const experiment = get(
      db,
      "SELECT * FROM commercial_experiments WHERE json_extract(metadata, '$.cataloguePlanId') = ? LIMIT 1",
      [plan.id],
    );
    if (experiment) {
      run(
        db,
        `UPDATE commercial_experiments
         SET hypothesis = ?, buyer = ?, offer = ?, channel = ?, price_cents = ?, updated_at = ?
         WHERE id = ?`,
        [
          firstRevenueHypothesis(plan, opportunityRecord),
          opportunityRecord.buyer,
          actualProductOffer(plan, opportunityRecord),
          opportunityRecord.channel,
          Number(plan.price_floor_cents || 0),
          now(),
          experiment.id,
        ],
      );
    }
    updatePlan(db, plan.id, {
      metadata: {
        listingCopyDeliverableId: listingDeliverable.id,
        launchPackDeliverableId: launchDeliverable.id,
        chiefBriefDeliverableId: briefDeliverable.id,
        approvalPackDeliverableId: approvalPack?.id || plan.metadata.approvalPackDeliverableId || null,
        publicationArtifactsRefreshedAt: now(),
      },
    });
    const journey = journeyForPlan(db, plan);
    if (journey) {
      const selectionRationale = String(journey.metadata.selectionRationale || "")
        .replace(
          "complete, medium-confidence paid-test case",
          "complete, medium-confidence case for a small first-revenue test",
        );
      updateJourney(db, journey.id, {
        metadata: {
          blocker: null,
          selectionRationale,
        },
      });
    }
    insertEvent(db, {
      actor: "jarvis",
      type: "production.publication_artifacts_refreshed",
      entityType: "catalogue_plan",
      entityId: plan.id,
      message: "Jarvis regenerated the accepted listing, launch pack, operator brief, and decision pack from current verified state without another model call.",
      metadata: {
        listingDeliverableId: listingDeliverable.id,
        launchPackDeliverableId: launchDeliverable.id,
        chiefBriefDeliverableId: briefDeliverable.id,
        approvalPackDeliverableId: approvalPack?.id || null,
        noProviderCall: true,
        noExternalAction: true,
      },
    });
    return {
      refreshed: true,
      plan: cataloguePlan(db, plan.id),
      listingDeliverable,
      launchDeliverable,
      briefDeliverable,
      approvalPack,
      issues: [],
      noProviderCall: true,
      noExternalAction: true,
    };
  });
}

function markProjected(db, planId, taskId) {
  const plan = cataloguePlan(db, planId);
  const projectedTaskIds = [...new Set([...(plan.metadata.projectedTaskIds || []), taskId])];
  updatePlan(db, planId, { metadata: { projectedTaskIds } });
}

function projectCompletedProductionTask(db, taskId) {
  return withSavepoint(db, "project_production", () => {
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
    if (
      ["conversion_copy", "distribution_plan", "chief_brief"].includes(metadata.stage)
      && contextRevision(task) < Number(plan.metadata.launchContextRevision || 0)
    ) {
      markProjected(db, plan.id, task.id);
      insertEvent(db, {
        actor: "pantheon",
        type: "production.superseded_launch_context_ignored",
        entityType: "task",
        entityId: task.id,
        message: "Pantheon retained an earlier launch-stage result as audit history without applying it to the current product record.",
        metadata: {
          planId: plan.id,
          stage: metadata.stage,
          taskContextRevision: contextRevision(task),
          currentContextRevision: Number(plan.metadata.launchContextRevision || 0),
        },
      });
      return { projected: false, reason: "superseded_launch_context", plan: cataloguePlan(db, plan.id) };
    }
    const opportunityRecord = opportunity(db, metadata.opportunityId || plan.opportunity_id);
    if (!opportunityRecord) throw new Error("Production task is missing its exact opportunity.");
    let result;
    if (metadata.stage === "product_build") result = projectProductBuild(db, task, plan, opportunityRecord);
    else if (metadata.stage === "storefront_visuals") result = projectStorefrontVisual(db, task, plan, opportunityRecord);
    else if (metadata.stage === "quality_review") result = projectQualityReview(db, task, plan, opportunityRecord);
    else if (metadata.stage === "conversion_copy") result = projectConversionCopy(db, task, plan, opportunityRecord);
    else if (metadata.stage === "distribution_plan") result = projectDistribution(db, task, plan, opportunityRecord);
    else if (metadata.stage === "chief_brief") result = projectChiefBrief(db, task, plan, opportunityRecord);
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
  });
}

function pendingProductionTask(db, workflowId = null) {
  const workflowFilter = workflowId ? "AND tasks.workflow_id = ?" : "";
  const row = get(
    db,
    `SELECT tasks.* FROM tasks
     JOIN workflows ON workflows.id = tasks.workflow_id
     JOIN opportunity_rounds
       ON opportunity_rounds.id = json_extract(
         tasks.payload,
         '$.liveSpendRequest.parameters.pantheonProduction.roundId'
       )
     JOIN catalogue_plans
       ON catalogue_plans.id = json_extract(
         tasks.payload,
         '$.liveSpendRequest.parameters.pantheonProduction.planId'
       )
     LEFT JOIN pantheon_journeys
       ON pantheon_journeys.id = json_extract(
         tasks.payload,
         '$.liveSpendRequest.parameters.pantheonJourney.journeyId'
       )
     WHERE tasks.kind = 'live_ai_worker_execution'
       AND json_extract(tasks.payload, '$.liveSpendRequest.parameters.pantheonProduction.supervisorOwned') = 1
       AND tasks.status IN ('queued', 'planned', 'blocked', 'waiting_approval', 'running', 'needs_attention')
       AND NOT EXISTS (
         SELECT 1
         FROM json_each(catalogue_plans.metadata, '$.recoverySupersededTaskIds') AS superseded
         WHERE superseded.value = tasks.id
       )
       AND workflows.status NOT IN ('failed', 'cancelled', 'completed')
       AND opportunity_rounds.status NOT IN (
         'failed', 'cancelled', 'completed', 'paused', 'ready_to_publish',
         'stopped_unknown_outcome', 'stopped_after_correction'
       )
       AND (
         pantheon_journeys.id IS NULL
         OR pantheon_journeys.status IN ('starting', 'running', 'waiting_for_operator', 'needs_attention')
       )
       ${workflowFilter}
     ORDER BY tasks.priority ASC, tasks.created_at ASC LIMIT 1`,
    workflowId ? [workflowId] : [],
  );
  return row ? parseRow(row, ["payload", "result"]) : null;
}

function completedUnprojectedProductionTask(db, workflowId = null) {
  const tasks = all(
    db,
    `SELECT * FROM tasks
     WHERE kind = 'live_ai_worker_execution'
       AND status = 'completed'
       AND json_extract(payload, '$.liveSpendRequest.parameters.pantheonProduction.supervisorOwned') = 1
     ORDER BY completed_at ASC, created_at ASC`,
  );
  return tasks.find((task) => {
    if (workflowId && task.workflow_id !== workflowId) return false;
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
  if (approved) {
    const readinessIssues = launchReadinessIssues(db, plan, {
      requireChiefBrief: Boolean(plan.metadata.chiefBriefDeliverableId || journeyForPlan(db, plan)),
    });
    if (readinessIssues.length) {
      throw new Error(`Pantheon cannot mark this package ready to publish: ${readinessIssues.join(" ")}`);
    }
  }
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
  const journey = journeyForPlan(db, plan);
  if (journey) {
    updateJourney(db, journey.id, {
      status: approved ? "completed" : changes ? "needs_attention" : "cancelled",
      activeStage: approved ? "ready_to_publish" : "launch_decision",
      completedAt: approved || !changes ? ts : null,
      metadata: {
        currentTaskId: null,
        currentApprovalId: null,
        blocker: null,
        finalDecision: normalized,
        finalDecisionNote: note || "",
        externalActionCompleted: false,
      },
      stageEvent: {
        stage: approved ? "ready_to_publish" : "launch_decision",
        status: approved ? "completed" : changes ? "needs_attention" : "cancelled",
        workerId: "operator",
        note: approved
          ? "Daniel marked the exact product and Gumroad package ready to publish; no external action was performed."
          : changes
            ? "Daniel requested changes before publication."
            : "Daniel stopped the proposed launch.",
      },
    });
  }
  return { decision: normalized, plan: cataloguePlan(db, plan.id), externalActionCompleted: false };
}

function retireSupersededLaunchContextRecords(db, plan, currentRevision) {
  const launchRows = all(
    db,
    `SELECT * FROM tasks
     WHERE kind = 'live_ai_worker_execution'
       AND json_extract(payload, '$.liveSpendRequest.parameters.pantheonProduction.planId') = ?
       AND json_extract(payload, '$.liveSpendRequest.parameters.pantheonProduction.stage')
         IN ('conversion_copy', 'distribution_plan', 'chief_brief')
     ORDER BY created_at ASC`,
    [plan.id],
  );
  const supersededRows = launchRows.filter((row) => contextRevision(row) < Number(currentRevision || 0));
  const supersededTaskIds = supersededRows.map((row) => row.id);
  if (!supersededTaskIds.length) return { supersededTaskIds: [] };
  const retiredUnstartedTaskIds = [];
  for (const row of supersededRows) {
    if (!["queued", "planned", "blocked", "waiting_approval"].includes(row.status)) continue;
    supersedeUnstartedProductionTask(
      db,
      parseRow(row, ["payload", "result"]),
      "A newer verified launch context replaced this unstarted decision before any provider call or spend.",
    );
    retiredUnstartedTaskIds.push(row.id);
  }
  const placeholders = supersededTaskIds.map(() => "?").join(", ");
  const ts = now();
  run(
    db,
    `UPDATE agent_handoffs
     SET status = 'superseded', resolved_at = COALESCE(resolved_at, ?), updated_at = ?
     WHERE task_id IN (${placeholders})
       AND status IN ('needs_operator_decision', 'waiting_for_review', 'ready_for_next_worker', 'waiting_approval')`,
    [ts, ts, ...supersededTaskIds],
  );
  run(
    db,
    `UPDATE messages SET status = 'resolved'
     WHERE task_id IN (${placeholders}) AND status = 'open'`,
    supersededTaskIds,
  );
  run(
    db,
    `UPDATE deliverables SET status = 'superseded', updated_at = ?
     WHERE json_extract(metadata, '$.planId') = ?
       AND (
         task_id IN (${placeholders})
         OR json_extract(metadata, '$.sourceTaskId') IN (${placeholders})
       )`,
    [ts, plan.id, ...supersededTaskIds, ...supersededTaskIds],
  );
  updatePlan(db, plan.id, {
    metadata: {
      projectedTaskIds: [
        ...new Set([...(plan.metadata.projectedTaskIds || []), ...supersededTaskIds]),
      ],
      supersededLaunchTaskIds: [
        ...new Set([...(plan.metadata.supersededLaunchTaskIds || []), ...supersededTaskIds]),
      ],
      launchDecisionHandoffId: null,
      chiefBriefDeliverableId: null,
      approvalPackDeliverableId: null,
    },
  });
  return { supersededTaskIds, retiredUnstartedTaskIds };
}

function reconcileVerifiedLaunchContextRepair(db, planId) {
  return withSavepoint(db, "reconcile_launch_context", () => {
    const plan = cataloguePlan(db, planId);
    if (!plan) throw new Error("The launch-context reconciliation needs an existing catalogue plan.");
    const currentRevision = Number(plan.metadata.launchContextRevision || 0);
    if (currentRevision < 1) {
      return { reconciled: false, reason: "no_launch_context_repair", plan };
    }
    const retired = retireSupersededLaunchContextRecords(db, plan, currentRevision);
    const refreshed = updatePlan(db, plan.id, {
      status: "preparing_launch",
      metadata: {
        buildStatus: "verified_launch_context_repair",
        launchDecisionHandoffId: null,
        chiefBriefDeliverableId: null,
        approvalPackDeliverableId: null,
      },
    });
    insertEvent(db, {
      actor: "jarvis",
      type: "production.launch_context_reconciled",
      entityType: "catalogue_plan",
      entityId: plan.id,
      message: "Jarvis retired late-arriving launch decisions that were built from superseded context.",
      metadata: {
        currentRevision,
        supersededTaskIds: retired.supersededTaskIds,
      },
    });
    return {
      reconciled: true,
      currentRevision,
      supersededTaskIds: retired.supersededTaskIds,
      plan: refreshed,
    };
  });
}

function prepareVerifiedLaunchContextRepair(db, input = {}) {
  return withSavepoint(db, "repair_launch_context", () => {
    const plan = cataloguePlan(db, input.planId);
    if (!plan) throw new Error("The launch-context repair needs an existing catalogue plan.");
    const qualityTask = get(db, "SELECT * FROM tasks WHERE id = ?", [plan.metadata.qualityTaskId]);
    if (!qualityTask || qualityTask.status !== "completed") {
      throw new Error("The launch-context repair needs the current completed independent quality review.");
    }
    if (Number(plan.metadata.qualityScore || 0) < 80 || plan.metadata.qualityDecision !== "approve") {
      throw new Error("The launch-context repair cannot bypass a failed or unresolved quality review.");
    }
    const manifest = plan.metadata.productManifest || {};
    if (!manifest.bundle?.filename || manifest.bundle?.canonicalManifestInsideBundle !== true) {
      throw new Error("The launch-context repair needs a reconciled canonical manifest and customer bundle.");
    }
    const opportunityRecord = opportunity(db, plan.opportunity_id);
    if (!opportunityRecord) throw new Error("The launch-context repair is missing its exact opportunity.");
    const launchRows = all(
      db,
      `SELECT * FROM tasks
       WHERE kind = 'live_ai_worker_execution'
         AND json_extract(payload, '$.liveSpendRequest.parameters.pantheonProduction.planId') = ?
         AND json_extract(payload, '$.liveSpendRequest.parameters.pantheonProduction.stage')
           IN ('conversion_copy', 'distribution_plan', 'chief_brief')
       ORDER BY created_at ASC`,
      [plan.id],
    );
    const nextRevision = Math.max(0, ...launchRows.map(contextRevision)) + 1;
    const supersededTaskIds = launchRows.map((row) => row.id);
    run(
      db,
      `UPDATE deliverables SET status = 'superseded', updated_at = ?
       WHERE json_extract(metadata, '$.planId') = ?
         AND task_id IN (
           SELECT id FROM tasks
           WHERE json_extract(payload, '$.liveSpendRequest.parameters.pantheonProduction.planId') = ?
             AND json_extract(payload, '$.liveSpendRequest.parameters.pantheonProduction.stage')
               IN ('conversion_copy', 'distribution_plan', 'chief_brief')
         )`,
      [now(), plan.id, plan.id],
    );
    const updated = updatePlan(db, plan.id, {
      status: "preparing_launch",
      metadata: {
        buildStatus: "verified_launch_context_repair",
        launchContextRevision: nextRevision,
        launchContextRepairReason: String(input.reason || "Pantheon replaced clipped launch context with the current verified package record."),
        supersededLaunchTaskIds: [
          ...new Set([...(plan.metadata.supersededLaunchTaskIds || []), ...supersededTaskIds]),
        ],
        projectedTaskIds: [
          ...new Set([...(plan.metadata.projectedTaskIds || []), ...supersededTaskIds]),
        ],
        launchDecisionHandoffId: null,
        chiefBriefDeliverableId: null,
        approvalPackDeliverableId: null,
      },
    });
    retireSupersededLaunchContextRecords(db, updated, nextRevision);
    let journey = journeyForPlan(db, updated);
    if (journey?.status === "completed") {
      journey = updateJourney(db, journey.id, {
        status: "running",
        activeStage: "conversion_copy",
        completedAt: null,
        allowTerminalAuditRepair: true,
        metadata: {
          previousCompletedAt: journey.completed_at,
          previousFinalDecision: journey.metadata.finalDecision || null,
          finalDecision: null,
          finalDecisionNote: null,
          publicationReadinessInvalidatedAt: now(),
          publicationReadinessInvalidatedReason: String(
            input.reason || "A direct artifact audit found launch material that must be corrected.",
          ),
        },
        stageEvent: {
          stage: "conversion_copy",
          status: "audit_repair_started",
          workerId: "jarvis",
          note: "Jarvis invalidated the earlier publish-ready result after direct artifact inspection found a material launch-pack defect.",
        },
      });
    }
    const request = queueConversionCopy(db, updated, opportunityRecord, parseRow(qualityTask, ["payload", "result"]), {
      contextRevision: nextRevision,
    });
    journey = journeyForPlan(db, updated);
    if (journey) {
      updateJourney(db, journey.id, {
        status: "running",
        activeStage: "conversion_copy",
        completedAt: null,
        metadata: {
          currentTaskId: request.task?.id || null,
          currentApprovalId: request.approval?.id || null,
          blocker: null,
          launchContextRevision: nextRevision,
          launchContextRepairReason: String(input.reason || "Current verified launch context prepared."),
        },
        stageEvent: {
          stage: "conversion_copy",
          status: request.task?.status || "waiting_to_start",
          taskId: request.task?.id || null,
          workerId: "copy_conversion_agent",
          note: "Jarvis replaced clipped launch context with one compact current-truth record; earlier attempts remain audit history only.",
        },
      });
    }
    insertEvent(db, {
      actor: "jarvis",
      type: "production.launch_context_repaired",
      entityType: "catalogue_plan",
      entityId: plan.id,
      message: "Jarvis prepared corrected launch work from the exact current product, quality, and file records.",
      metadata: {
        contextRevision: nextRevision,
        supersededTaskIds,
        replacementTaskId: request.task?.id || null,
        noExternalAction: true,
      },
    });
    return {
      repaired: true,
      contextRevision: nextRevision,
      supersededTaskIds,
      task: request.task,
      approval: request.approval,
      plan: cataloguePlan(db, plan.id),
    };
  });
}

function getProductionState(db) {
  const plans = all(
    db,
    `SELECT * FROM catalogue_plans
     WHERE status NOT IN ('planned')
       AND COALESCE(json_extract(metadata, '$.archivedFromOperator'), 0) <> 1
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
  assertQualityReviewRecheckAvailable,
  buildProfile,
  completedUnprojectedProductionTask,
  getProductionState,
  pendingProductionTask,
  prepareCatalogueBuild,
  prepareExplicitFinalValidationReview,
  prepareVerifiedLaunchContextRepair,
  publicationPlanPriceText,
  publicationPriceChannelHypothesis,
  publicationPresentationText,
  publicationScorecard,
  projectCompletedProductionTask,
  refreshPublicationArtifacts,
  reconcileVerifiedLaunchContextRepair,
  recoverQualityReviewAfterEvidenceRepair,
  recoverQualityReviewAfterLocalRendererRepair,
  recoverValidationQualityReviewAfterInspectionRepair,
};
