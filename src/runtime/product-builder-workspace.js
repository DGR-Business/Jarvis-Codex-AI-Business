const crypto = require("node:crypto");
const { get } = require("../db");
const { requestLiveAiWorker } = require("./live-ai-workers");

const PRODUCT_ASSET_SPEC_SCHEMA = "jarvis.product-asset-spec.v1";
const ALLOWED_SIZES = new Set(["1024x1024", "1024x1536", "1536x1024"]);
const ALLOWED_QUALITIES = new Set(["low", "medium", "high"]);
const ALLOWED_FORMATS = new Set(["png", "jpeg", "webp"]);
const SECRET_PATTERN = /(api[_ -]?key|password|secret|bearer\s+[a-z0-9._-]+|sk-[a-z0-9_-]+)/i;

function cleanText(value, max) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function cleanList(value, maxItems = 6) {
  return Array.isArray(value)
    ? value.filter(Boolean).map((item) => cleanText(item, 500)).filter(Boolean).slice(0, maxItems)
    : [];
}

function prepareProductBuilderAsset(db, workflowId, input = {}) {
  const workflow = get(db, "SELECT id, venture_id, title, metadata FROM workflows WHERE id = ?", [workflowId]);
  if (!workflow) throw new Error(`Workflow not found: ${workflowId}`);

  const prompt = cleanText(input.prompt, 2400);
  if (prompt.length < 30) {
    throw new Error("Product Builder needs a specific visual prompt of at least 30 characters.");
  }
  if (SECRET_PATTERN.test(prompt)) {
    throw new Error("Product asset prompts cannot contain credentials or authentication secrets.");
  }
  const purpose = cleanText(input.purpose || input.deliverable, 600);
  if (!purpose) throw new Error("Product Builder needs the business purpose of this visual asset.");
  const acceptanceCriteria = cleanList(input.acceptanceCriteria);
  if (!acceptanceCriteria.length) {
    throw new Error("Product Builder needs at least one clear acceptance criterion for the asset.");
  }

  const quality = ALLOWED_QUALITIES.has(input.quality) ? input.quality : "low";
  const size = ALLOWED_SIZES.has(input.size) ? input.size : "1024x1024";
  const outputFormat = ALLOWED_FORMATS.has(input.outputFormat) ? input.outputFormat : "png";
  const assetSpec = {
    schema: PRODUCT_ASSET_SPEC_SCHEMA,
    purpose,
    prompt,
    size,
    quality,
    outputFormat,
    acceptanceCriteria,
    constraints: cleanList(input.constraints),
    quantity: 1,
    publishingAllowed: false,
  };
  const specHash = crypto.createHash("sha256").update(JSON.stringify(assetSpec)).digest("hex");
  const subject = cleanText(input.subject || workflow.title || "product", 300);
  const result = requestLiveAiWorker(db, workflowId, {
    requestKey: `product_asset_${specHash.slice(0, 16)}`,
    requestedBy: input.requestedBy || "operator",
    worker: "product_builder",
    taskTitle: `Create one reviewed visual for ${subject}`,
    approvalTitle: `Approve one Product Builder visual for ${subject}`,
    estimatedCostCents: Math.min(100, Math.max(40, Math.round(Number(input.estimatedCostCents || 100)))),
    reason: "Create one exact, capped local visual asset for the accepted product direction. Nothing will be published or sent externally.",
    expectedOutput: "One locally stored visual asset plus a concise production note, quality checks, and any limitations.",
    expectedMetric: "Exactly one asset is returned, stored locally, linked to its approval and receipt, and held for Quality Reviewer.",
    contextPurpose: "Create only the exact approved product visual using the venture offer, evidence, production, and legal-risk records.",
    contextClasses: ["venture", "evidence", "production", "legal"],
    businessContext: {
      subject,
      buyer: input.buyer,
      problem: input.problem,
      offer: input.offer,
      channel: input.channel || "Digital Product",
      evidenceStandard: input.evidenceStandard,
    },
    workBrief: {
      objective: purpose,
      deliverable: `One ${size} ${outputFormat.toUpperCase()} visual at ${quality} draft quality.`,
      assetPrompt: prompt,
      constraints: assetSpec.constraints,
      acceptanceCriteria,
    },
    tools: ["image_generation_spend"],
    toolArguments: {
      image_generation_spend: {
        quality,
        size,
        outputFormat,
      },
    },
    maxTurns: 2,
    maxToolCalls: 1,
    deadlineMs: 180_000,
    maxOutputTokens: 1000,
    parameters: {
      assetSpec,
      assetSpecHash: specHash,
      requiredReviewer: "quality_reviewer",
    },
    effects: [],
    tracePolicy: {
      providerResponseStored: false,
      providerTraceContent: false,
      dataClass: "business_internal",
      purpose: "Keep a local receipt and review record without storing private trace content at the provider.",
    },
  });
  return {
    ...result,
    assetSpec,
    assetSpecHash: specHash,
  };
}

module.exports = {
  PRODUCT_ASSET_SPEC_SCHEMA,
  prepareProductBuilderAsset,
};
