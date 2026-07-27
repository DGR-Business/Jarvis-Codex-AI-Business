const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const CONFIG = require("../config");
const { all, fromJson, get, insertEvent, now, randomId, run, toJson } = require("../db");
const {
  LIVE_AI_WORKER_PROVIDER,
  buildOpenAIRequest,
  liveWorkerCostEstimateCents,
  normalizeOutput,
  recordLiveWorkerCost,
  recordLiveWorkerFailureCost,
  recordLiveWorkerModelCall,
  runLiveAiWorkerTask,
} = require("../adapters/live-ai-worker");
const {
  environmentDisabled,
  environmentEnabled,
  environmentValue,
  preferredEnvironmentName,
} = require("../adapters/pantheon-environment");
const {
  demandValidatorPilotOutputSchema: demandValidatorPilotSchema,
  normalizeWorkerOutput,
  productBuilderFileOutputZodSchema,
  productBuilderVisualOutputZodSchema,
  workerOutputZodSchema,
} = require("./agent-model-contracts");
const {
  buildAgentsSdkModelInput,
  buildAgentsSdkCapabilityPlan,
  extractAgentsSdkToolActivity,
  extractContainerFileCitations,
  extractGeneratedImages,
  materializeAgentsSdkTools,
  sdkInterruptionDetails,
  summarizeAgentsSdkResult,
} = require("./agent-sdk-capabilities");
const {
  AgentToolApprovalRequiredError,
  recordAgentToolObservation,
  requestAgentToolUse,
} = require("./agent-tool-gate");
const { persistAgentsSdkResearchEvidence } = require("./agent-execution-evidence");
const { estimateModelUsageAud, estimateObservedHostedToolUsageAud } = require("./model-pricing");
const { markTaskAttemptProviderDispatched } = require("./task-claims");
const {
  assertDigitalProductFactoryReady,
  composeStorefrontCover,
  normalizeProductBlueprintForFactory,
  renderDigitalProductKit,
} = require("./digital-product-file-factory");
const { productBlueprintClaimAlignmentIssues } = require("./product-claim-alignment");

const AGENTS_SDK_PROVIDER = "openai-agents-sdk";

let testSdkRunner = null;
let defaultSdkRunner = null;
let testContainerFileDownloader = null;
let testDigitalProductFactory = null;

const PRODUCT_FILE_LIMIT_BYTES = 50 * 1024 * 1024;
const PRODUCT_FILE_TOTAL_LIMIT_BYTES = 150 * 1024 * 1024;
const PRODUCT_ARCHIVE_TOTAL_LIMIT_BYTES = 250 * 1024 * 1024;
const PRODUCT_MANIFEST_SCHEMA = "pantheon.product-manifest.v1";
const PRODUCT_FILE_EXTENSIONS = new Set([
  ".csv",
  ".docx",
  ".html",
  ".jpeg",
  ".jpg",
  ".json",
  ".md",
  ".pdf",
  ".png",
  ".pptx",
  ".txt",
  ".webp",
  ".xlsx",
  ".zip",
]);
const BLOCKED_ARCHIVE_EXTENSIONS = new Set([
  ".bat",
  ".cmd",
  ".com",
  ".dll",
  ".exe",
  ".msi",
  ".ps1",
  ".scr",
]);

function safeId(value) {
  return String(value || "asset").replace(/[^a-zA-Z0-9_-]+/g, "_").slice(0, 80);
}

function taskScopedDeliverableId(prefix, taskId, index) {
  const normalized = safeId(taskId).slice(0, 48);
  const fingerprint = crypto.createHash("sha256").update(String(taskId || "task")).digest("hex").slice(0, 12);
  return `${prefix}_${normalized}_${fingerprint}_${index}`;
}

function stableSafetyIdentifier(task) {
  return `pantheon_${crypto.createHash("sha256").update(String(task.venture_id || task.workflow_id || "local-operator")).digest("hex").slice(0, 32)}`;
}

function isSdkInvalidFinalOutput(error) {
  const name = String(error?.name || "");
  const code = String(error?.code || error?.type || "");
  const message = String(error?.message || "");
  return ["invalid_output", "output_parse_error", "schema_validation_failed"].includes(code)
    || name === "ZodError"
    || (name === "ModelBehaviorError" && /output|schema|json/i.test(message))
    || /^Invalid output type:/i.test(message);
}

function sdkHttpStatus(error) {
  for (const candidate of [
    error?.status,
    error?.statusCode,
    error?.httpStatus,
    error?.response?.status,
    error?.cause?.status,
  ]) {
    const status = Number(candidate);
    if (Number.isInteger(status) && status >= 100 && status <= 599) return status;
  }
  return null;
}

function classifySdkRunError(error, dispatchStarted, traceId) {
  error.agentSdkTraceId = traceId;
  if (dispatchStarted && isSdkInvalidFinalOutput(error)) {
    error.providerCallOccurred = true;
    error.providerResponseReceived = true;
    error.outcomeUnknown = false;
    error.needsAttention = true;
    error.providerDispatchStatus = "response_received_invalid_output";
    error.errorKind = "provider_output_invalid";
    return error;
  }
  const httpStatus = sdkHttpStatus(error);
  if (dispatchStarted && httpStatus >= 400 && httpStatus < 500) {
    error.httpStatus = httpStatus;
    error.providerCallOccurred = true;
    error.providerResponseReceived = true;
    error.definiteProviderRejection = true;
    error.outcomeUnknown = false;
    error.needsAttention = false;
    error.providerDispatchStatus = "definite_rejection";
    error.errorKind = "provider_rejected";
    error.providerRequestId = error.requestID || error.requestId || null;
    error.incurredEstimateCents = 0;
    return error;
  }
  if (error.providerCallOccurred === undefined) error.providerCallOccurred = dispatchStarted;
  if (error.outcomeUnknown === undefined) error.outcomeUnknown = dispatchStarted;
  if (!error.providerDispatchStatus) {
    error.providerDispatchStatus = dispatchStarted ? "outcome_unknown" : "not_dispatched";
  }
  return error;
}

function getApprovedSdkResumeSelection(db, task) {
  if (!task.id || !task.approval_id) return null;
  const candidates = all(
    db,
    `SELECT invocations.id, invocations.approval_id, invocations.tool_id, invocations.metadata,
            approvals.status AS approval_status, approvals.payload AS approval_payload,
            approvals.expires_at
     FROM agent_tool_invocations AS invocations
     JOIN approvals ON approvals.id = invocations.approval_id
     WHERE invocations.task_id = ? AND invocations.approval_id = ?
       AND invocations.decision = 'approved_live' AND invocations.status = 'allowed'
     ORDER BY invocations.resolved_at DESC, invocations.requested_at DESC`,
    [task.id, task.approval_id],
  );
  for (const candidate of candidates) {
    const metadata = fromJson(candidate.metadata, {});
    const approvalPayload = fromJson(candidate.approval_payload, {});
    const serializedState = metadata.sdkRunState;
    const stateHash = metadata.sdkRunStateHash;
    if (!serializedState || !stateHash || candidate.approval_status !== "approved") continue;
    if (candidate.expires_at && Date.parse(candidate.expires_at) <= Date.now()) continue;
    if (approvalPayload.taskId !== task.id || approvalPayload.invocationId !== candidate.id) continue;
    if (approvalPayload.metadata?.sdkRunStateHash !== stateHash) continue;
    const actualHash = crypto.createHash("sha256").update(serializedState).digest("hex");
    if (actualHash !== stateHash) continue;
    return {
      serializedState,
      callId: approvalPayload.exactScope?.callId || approvalPayload.metadata?.sdkInterruptionCallId || metadata.sdkInterruptionCallId || null,
      toolId: approvalPayload.exactScope?.toolId || candidate.tool_id || null,
      toolArguments: approvalPayload.exactScope?.toolArguments || {},
      effects: approvalPayload.exactScope?.effects || [],
      invocationId: candidate.id,
      approvalId: candidate.approval_id,
      stateHash,
      partialModelCallId: metadata.partialModelCallId || null,
    };
  }
  return null;
}

function getApprovedSdkResumeState(db, task) {
  return getApprovedSdkResumeSelection(db, task)?.serializedState || null;
}

function sdkPricingEstimate(model, usage, approvedCapCents, toolActivity, capabilityPlan) {
  const tokenEstimate = estimateModelUsageAud(model, usage, { fallbackCents: approvedCapCents });
  const hostedToolEstimate = estimateObservedHostedToolUsageAud(toolActivity, capabilityPlan, {
    audPerUsd: tokenEstimate.audPerUsd,
  });
  const publishedEstimateReady = Number.isFinite(tokenEstimate.usdAmount)
    && Number.isFinite(hostedToolEstimate.usdAmount)
    && Number.isFinite(tokenEstimate.audPerUsd);
  const combinedUsd = publishedEstimateReady
    ? Number(tokenEstimate.usdAmount) + Number(hostedToolEstimate.usdAmount)
    : null;
  const combinedAud = publishedEstimateReady ? combinedUsd * Number(tokenEstimate.audPerUsd) : null;
  const combinedCents = publishedEstimateReady
    ? Math.max(1, Math.ceil(combinedAud * 100))
    : Math.min(
      approvedCapCents,
      Math.max(0, Number(tokenEstimate.amountCents || 0))
        + Math.max(0, Number(hostedToolEstimate.amountCents || 0)),
    );
  return {
    ...tokenEstimate,
    amountCents: Math.min(approvedCapCents, combinedCents),
    usdAmount: combinedUsd === null ? tokenEstimate.usdAmount : Number(combinedUsd.toFixed(8)),
    audAmount: combinedAud === null ? tokenEstimate.audAmount : Number(combinedAud.toFixed(8)),
    tokenAmountCents: tokenEstimate.amountCents,
    tokenUsdAmount: tokenEstimate.usdAmount ?? null,
    tokenAudAmount: tokenEstimate.audAmount ?? null,
    hostedToolCalls: toolActivity.length,
    hostedToolAmountCents: hostedToolEstimate.amountCents,
    hostedToolUsdAmount: hostedToolEstimate.usdAmount,
    hostedToolAudAmount: hostedToolEstimate.audAmount,
    hostedToolCostStatus: hostedToolEstimate.status,
    hostedToolPricing: hostedToolEstimate.details,
    note: toolActivity.length
      ? "Token and observed hosted-tool charges are included using current published prices; exact provider billing remains pending reconciliation."
      : "No hosted-tool charge applies to this run.",
  };
}

function sdkUsageDelta(db, usage, resumeSelection) {
  if (!resumeSelection?.partialModelCallId) return usage;
  const prior = get(
    db,
    "SELECT input_tokens, output_tokens, metadata FROM model_calls WHERE id = ?",
    [resumeSelection.partialModelCallId],
  );
  if (!prior) return usage;
  const priorMetadata = fromJson(prior.metadata, {});
  const priorCached = Number(
    priorMetadata.tokenUsage?.cachedInputTokens
    ?? priorMetadata.tokenUsage?.cached_input_tokens
    ?? 0,
  );
  const input = Math.max(0, Number(usage.input_tokens || 0) - Number(prior.input_tokens || 0));
  const output = Math.max(0, Number(usage.output_tokens || 0) - Number(prior.output_tokens || 0));
  const cached = Math.max(0, Number(usage.cached_input_tokens || 0) - priorCached);
  return {
    ...usage,
    input_tokens: input,
    output_tokens: output,
    total_tokens: input + output,
    cached_input_tokens: cached,
    usage_status: usage.usage_status === "unknown" ? "unknown" : "reported_delta",
  };
}

function detectedImageMediaType(bytes) {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return "image/png";
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 12
    && bytes.subarray(0, 4).toString("ascii") === "RIFF"
    && bytes.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

function persistGeneratedAssets(db, task, capabilityPlan, result) {
  const generated = extractGeneratedImages(result);
  const imageSpec = capabilityPlan.specs.find((spec) => spec.sdkName === "image_generation");
  if (!imageSpec) return [];
  if (generated.length !== 1) {
    throw new Error(`The approved Product Builder action required exactly one image, but OpenAI returned ${generated.length}.`);
  }
  const format = imageSpec?.options?.outputFormat || "png";
  const extension = ["png", "jpeg", "webp"].includes(format) ? format : "png";
  const outputDir = path.join(CONFIG.artifactRoot, "workflows", safeId(task.workflow_id), "generated-assets");
  fs.mkdirSync(outputDir, { recursive: true });
  const ts = now();
  const productionStage = task.payload?.liveSpendRequest?.parameters?.pantheonProduction?.stage;
  const assetStatus = productionStage === "storefront_visuals"
    ? "built_pending_quality_review"
    : "draft";
  return generated.map((image, index) => {
    const composition = productionStage === "storefront_visuals"
      ? composeStorefrontCover(task, image.bytes, {
        artifactRoot: CONFIG.artifactRoot,
        title: task.payload?.subject || task.title,
        subtitle: task.payload?.liveSpendRequest?.parameters?.pantheonProduction?.customerPromise,
      })
      : null;
    const persistedBytes = composition?.bytes || image.bytes;
    const persistedHash = composition?.sha256 || image.hash;
    const mediaType = detectedImageMediaType(persistedBytes);
    const expectedMediaType = composition
      ? "image/png"
      : `image/${extension === "jpeg" ? "jpeg" : extension}`;
    if (!mediaType || mediaType !== expectedMediaType) {
      throw new Error(`OpenAI returned an asset that did not match the approved ${expectedMediaType} format.`);
    }
    const deliverableId = taskScopedDeliverableId("deliv_generated", task.id, index + 1);
    const persistedExtension = composition ? "png" : extension;
    const outputPath = path.join(outputDir, `${deliverableId}_${persistedHash.slice(0, 12)}.${persistedExtension}`);
    if (fs.existsSync(outputPath)) {
      const storedHash = crypto.createHash("sha256").update(fs.readFileSync(outputPath)).digest("hex");
      if (storedHash !== persistedHash) throw new Error("The generated asset path already contains different bytes.");
    } else {
      const temporaryPath = `${outputPath}.${process.pid}.${randomId().slice(0, 8)}.tmp`;
      fs.writeFileSync(temporaryPath, persistedBytes, { flag: "wx" });
      fs.renameSync(temporaryPath, outputPath);
    }
    const relativePath = path.relative(CONFIG.rootDir, outputPath).replace(/\\/g, "/");
    const humanName = productionStage === "storefront_visuals"
      ? `${task.payload?.subject || task.title || "Product"} Storefront Cover`
      : `${task.payload?.subject || task.title || "Product"} Visual Asset ${index + 1}`;
    run(
      db,
      `INSERT INTO deliverables
       (id, workflow_id, command_id, task_id, venture_id, title, human_name, audience,
        format, status, file_path, summary, metadata, content_hash, version, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         workflow_id = excluded.workflow_id,
         command_id = excluded.command_id,
         task_id = excluded.task_id,
         venture_id = excluded.venture_id,
         human_name = excluded.human_name,
         status = excluded.status,
         file_path = excluded.file_path,
         summary = excluded.summary,
         metadata = excluded.metadata,
         content_hash = excluded.content_hash,
         version = CASE
           WHEN deliverables.content_hash IS NOT excluded.content_hash THEN deliverables.version + 1
           ELSE deliverables.version
         END,
         updated_at = excluded.updated_at`,
      [
        deliverableId,
        task.workflow_id,
        task.payload?.commandId || null,
        task.id,
        task.venture_id,
        "Generated Product Asset",
        humanName,
        "operator",
        mediaType,
        assetStatus,
        relativePath,
        composition
          ? "Storefront cover made from the approved AI-generated background with a deterministic product-title overlay. Review it before publishing."
          : "Capped AI-generated visual asset. Review brand fit, text accuracy, IP/platform risk, and product usefulness before any publishing.",
        toJson({
          provider: AGENTS_SDK_PROVIDER,
          model: imageSpec?.options?.model || "gpt-image-2",
          quality: imageSpec?.options?.quality || "low",
          size: imageSpec?.options?.size || "1024x1024",
          revisedPrompt: image.revisedPrompt,
          sha256: persistedHash,
          bytes: persistedBytes.length,
          providerBackgroundSha256: composition?.sourceSha256 || image.hash,
          composedLocally: Boolean(composition),
          compositionRenderer: composition?.renderer || null,
          compositionFingerprint: composition?.fingerprint || null,
          compositionSubtitle: composition?.subtitle || null,
          approvalId: task.approval_id || task.payload?.liveSpendRequest?.approvalId || null,
        }),
        persistedHash,
        ts,
        ts,
      ],
    );
    return {
      id: deliverableId,
      humanName,
      filePath: relativePath,
      format: mediaType,
      status: assetStatus,
      bytes: persistedBytes.length,
      sha256: persistedHash,
    };
  });
}

function safeProductFilename(value, fallback) {
  const base = path.basename(String(value || fallback || "product-file"))
    .replace(/[^a-zA-Z0-9._ -]+/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 140);
  return base || fallback || "product-file";
}

function productMediaType(extension) {
  return {
    ".csv": "text/csv",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".html": "text/html",
    ".jpeg": "image/jpeg",
    ".jpg": "image/jpeg",
    ".json": "application/json",
    ".md": "text/markdown",
    ".pdf": "application/pdf",
    ".png": "image/png",
    ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ".txt": "text/plain",
    ".webp": "image/webp",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".zip": "application/zip",
  }[extension] || "application/octet-stream";
}

function validateArchive(bytes, extension) {
  const AdmZip = require("adm-zip");
  let archive;
  try {
    archive = new AdmZip(bytes);
  } catch {
    throw new Error(`OpenAI returned an invalid ${extension.slice(1).toUpperCase()} archive.`);
  }
  const entries = archive.getEntries();
  if (!entries.length || entries.length > 300) {
    throw new Error("The generated product archive must contain between 1 and 300 entries.");
  }
  let expandedBytes = 0;
  const names = [];
  for (const entry of entries) {
    const normalized = String(entry.entryName || "").replace(/\\/g, "/");
    if (!normalized || normalized.startsWith("/") || /^[a-z]:/i.test(normalized)
        || normalized.split("/").includes("..")) {
      throw new Error("The generated product archive contains an unsafe path.");
    }
    const entryExtension = path.extname(normalized).toLowerCase();
    if (BLOCKED_ARCHIVE_EXTENSIONS.has(entryExtension)) {
      throw new Error(`The generated product archive contains a blocked executable file: ${normalized}.`);
    }
    expandedBytes += Number(entry.header?.size || 0);
    if (expandedBytes > PRODUCT_ARCHIVE_TOTAL_LIMIT_BYTES) {
      throw new Error("The generated product archive expands beyond Pantheon's 250 MB safety limit.");
    }
    if (!entry.isDirectory) names.push(normalized);
  }
  if (extension === ".xlsx" && !names.some((name) => name.startsWith("xl/"))) {
    throw new Error("The generated XLSX file does not contain a valid workbook structure.");
  }
  if (extension === ".docx" && !names.some((name) => name.startsWith("word/"))) {
    throw new Error("The generated DOCX file does not contain a valid document structure.");
  }
  if (extension === ".pptx" && !names.some((name) => name.startsWith("ppt/"))) {
    throw new Error("The generated PPTX file does not contain a valid presentation structure.");
  }
  return { entries: names, expandedBytes };
}

function validateProductFile(bytes, filename) {
  if (!Buffer.isBuffer(bytes) || !bytes.length) throw new Error(`Generated product file ${filename} is empty.`);
  if (bytes.length > PRODUCT_FILE_LIMIT_BYTES) {
    throw new Error(`Generated product file ${filename} exceeds Pantheon's 50 MB per-file limit.`);
  }
  const extension = path.extname(filename).toLowerCase();
  if (!PRODUCT_FILE_EXTENSIONS.has(extension)) {
    throw new Error(`Generated product file ${filename} uses an unsupported file type.`);
  }
  if (extension === ".pdf" && bytes.subarray(0, 5).toString("ascii") !== "%PDF-") {
    throw new Error(`Generated product file ${filename} is not a valid PDF.`);
  }
  if ([".zip", ".xlsx", ".docx", ".pptx"].includes(extension)) {
    if (bytes.subarray(0, 2).toString("ascii") !== "PK") {
      throw new Error(`Generated product file ${filename} is not a valid ZIP-based file.`);
    }
    return { extension, archive: validateArchive(bytes, extension) };
  }
  if (extension === ".json") {
    try {
      return { extension, json: JSON.parse(bytes.toString("utf8")) };
    } catch {
      throw new Error(`Generated product file ${filename} is not valid JSON.`);
    }
  }
  if ([".csv", ".html", ".md", ".txt"].includes(extension) && bytes.includes(0)) {
    throw new Error(`Generated product file ${filename} contains invalid binary text.`);
  }
  const imageType = detectedImageMediaType(bytes);
  if ([".png", ".jpeg", ".jpg", ".webp"].includes(extension) && !imageType) {
    throw new Error(`Generated product file ${filename} is not a valid image.`);
  }
  return { extension };
}

async function defaultContainerFileDownloader(citation) {
  const OpenAIModule = require("openai");
  const OpenAI = OpenAIModule.default || OpenAIModule;
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const [metadata, response] = await Promise.all([
    client.containers.files.retrieve(citation.fileId, { container_id: citation.containerId }),
    client.containers.files.content.retrieve(citation.fileId, { container_id: citation.containerId }),
  ]);
  return {
    filename: metadata?.path ? path.basename(metadata.path) : citation.filename,
    bytes: Buffer.from(await response.arrayBuffer()),
    metadata,
  };
}

function normalizedArchiveName(value) {
  return String(value || "").replace(/\\/g, "/").replace(/^\.?\//, "").toLowerCase();
}

function validateProductManifest(downloads, task) {
  const spec = task.payload?.liveSpendRequest?.parameters?.productBuildSpec || {};
  const manifestName = String(spec.manifestFilename || "pantheon-product-manifest.json").toLowerCase();
  const manifestFile = downloads.find((file) => file.filename.toLowerCase() === manifestName)
    || downloads.find((file) => file.validation.json?.schema === PRODUCT_MANIFEST_SCHEMA);
  if (!manifestFile) {
    throw new Error(`Product Builder did not return the required ${manifestName} file.`);
  }
  const manifest = manifestFile.validation.json;
  if (!manifest || manifest.schema !== PRODUCT_MANIFEST_SCHEMA) {
    throw new Error("Product Builder returned a manifest with the wrong schema.");
  }
  if (String(manifest.planId || "") !== String(spec.planId || "")) {
    throw new Error("The generated product manifest does not match the approved catalogue plan.");
  }
  if (String(manifest.opportunityId || "") !== String(spec.opportunityId || "")) {
    throw new Error("The generated product manifest does not match the approved opportunity.");
  }
  const expectedItemIds = Array.isArray(spec.catalogueItems)
    ? spec.catalogueItems.map((item) => String(item.id))
    : [];
  const manifestItems = Array.isArray(manifest.catalogueItems) ? manifest.catalogueItems : [];
  const actualItemIds = manifestItems.map((item) => String(item.id || item.catalogueItemId || ""));
  if (!expectedItemIds.length || expectedItemIds.some((id) => !actualItemIds.includes(id))) {
    throw new Error("The generated product manifest does not cover every approved catalogue item.");
  }
  if (new Set(actualItemIds).size !== actualItemIds.length) {
    throw new Error("The generated product manifest contains duplicate catalogue item identifiers.");
  }
  const availableNames = new Set();
  for (const file of downloads) {
    availableNames.add(normalizedArchiveName(file.filename));
    for (const entry of file.validation.archive?.entries || []) availableNames.add(normalizedArchiveName(entry));
  }
  for (const item of manifestItems) {
    const files = Array.isArray(item.files) ? item.files.filter(Boolean).map(normalizedArchiveName) : [];
    if (!files.length) throw new Error(`Catalogue item ${item.id || item.catalogueItemId || "unknown"} has no product file in the manifest.`);
    if (files.some((filename) => !availableNames.has(filename))) {
      throw new Error(`Catalogue item ${item.id || item.catalogueItemId || "unknown"} references a product file that Pantheon did not receive.`);
    }
  }
  const requiredPreviewCount = Math.max(0, Number(spec.storefrontPreviewCount || 0));
  const storefrontPreviews = Array.isArray(manifest.storefrontPreviews)
    ? manifest.storefrontPreviews.map(normalizedArchiveName).filter(Boolean)
    : [];
  if (requiredPreviewCount && storefrontPreviews.length !== requiredPreviewCount) {
    throw new Error(`Product Builder must return exactly ${requiredPreviewCount} storefront previews derived from the real product files.`);
  }
  if (new Set(storefrontPreviews).size !== storefrontPreviews.length) {
    throw new Error("The generated product manifest contains duplicate storefront preview paths.");
  }
  const approvedPreviewDirectory = normalizedArchiveName(
    spec.storefrontPreviewDirectory || "storefront-previews",
  );
  if (storefrontPreviews.some((filename) => !filename.startsWith(`${approvedPreviewDirectory}/`))) {
    throw new Error("A storefront preview is outside the approved preview directory.");
  }
  if (storefrontPreviews.some((filename) => !availableNames.has(filename))) {
    throw new Error("The product manifest references a storefront preview Pantheon did not receive.");
  }
  if (storefrontPreviews.some((filename) => path.extname(filename).toLowerCase() !== ".png")) {
    throw new Error("Storefront previews must be PNG images.");
  }
  if (downloads.length < Math.max(2, Number(spec.minimumReturnedFiles || 2))) {
    throw new Error("Product Builder returned too few files for the approved product package.");
  }
  const bundleName = String(spec.bundleFilename || manifest.bundle?.filename || "").toLowerCase();
  const bundleFile = downloads.find((file) => (
    file.validation.extension === ".zip"
    && (!bundleName || file.filename.toLowerCase() === bundleName)
  ));
  if (!bundleFile) {
    throw new Error("Product Builder did not return the exact approved customer bundle.");
  }
  const embeddedManifest = archiveEntryBytes([bundleFile], manifestFile.filename);
  if (!embeddedManifest) {
    throw new Error("The customer bundle does not contain the canonical product manifest.");
  }
  if (!embeddedManifest.equals(manifestFile.bytes)) {
    throw new Error("The product manifest inside the customer bundle differs from the standalone manifest.");
  }
  const inventory = Array.isArray(manifest.files) ? manifest.files : [];
  if (!inventory.length) {
    throw new Error("The product manifest does not contain a verifiable archive inventory.");
  }
  for (const item of inventory) {
    const entryBytes = archiveEntryBytes([bundleFile], item.path);
    if (!entryBytes) throw new Error(`The customer bundle is missing inventoried file ${item.path}.`);
    const hash = crypto.createHash("sha256").update(entryBytes).digest("hex");
    if (Number(item.bytes || 0) !== entryBytes.length || String(item.sha256 || "") !== hash) {
      throw new Error(`The customer bundle does not match the recorded bytes and hash for ${item.path}.`);
    }
  }
  return {
    manifest,
    manifestFile,
    storefrontPreviews,
    bundleFile,
    embeddedManifestMatches: true,
    archiveInventoryVerified: true,
  };
}

function archiveEntryBytes(downloads, entryName) {
  const target = normalizedArchiveName(entryName);
  const AdmZip = require("adm-zip");
  for (const file of downloads) {
    if (file.validation.extension !== ".zip") continue;
    const archive = new AdmZip(file.bytes);
    const entry = archive.getEntries().find((candidate) => normalizedArchiveName(candidate.entryName) === target);
    if (entry && !entry.isDirectory) return entry.getData();
  }
  return null;
}

function persistStorefrontPreviews(db, task, downloads, previewNames, options = {}) {
  if (!previewNames.length) return [];
  const packageFingerprint = crypto
    .createHash("sha256")
    .update(downloads.map((file) => `${file.filename}:${file.sha256}`).sort().join("|"))
    .digest("hex")
    .slice(0, 16);
  const outputDir = path.join(
    options.artifactRoot || CONFIG.artifactRoot,
    "workflows",
    safeId(task.workflow_id),
    "storefront-previews",
    safeId(task.id),
    packageFingerprint,
  );
  fs.mkdirSync(outputDir, { recursive: true });
  const ts = now();
  return previewNames.map((entryName, index) => {
    const bytes = archiveEntryBytes(downloads, entryName);
    if (!bytes) throw new Error(`Pantheon could not extract storefront preview ${entryName}.`);
    const validation = validateProductFile(bytes, path.basename(entryName));
    if (validation.extension !== ".png") throw new Error("Storefront previews must be valid PNG images.");
    const hash = crypto.createHash("sha256").update(bytes).digest("hex");
    const deliverableId = taskScopedDeliverableId("deliv_preview", task.id, index + 1);
    const filename = `${String(index + 1).padStart(2, "0")}-${safeProductFilename(path.basename(entryName), `preview-${index + 1}.png`)}`;
    const outputPath = path.join(outputDir, filename);
    if (fs.existsSync(outputPath)) {
      const existingHash = crypto.createHash("sha256").update(fs.readFileSync(outputPath)).digest("hex");
      if (existingHash !== hash) throw new Error(`Storefront preview path ${filename} already contains different bytes.`);
    } else {
      const temporaryPath = `${outputPath}.${process.pid}.${randomId().slice(0, 8)}.tmp`;
      fs.writeFileSync(temporaryPath, bytes, { flag: "wx" });
      fs.renameSync(temporaryPath, outputPath);
    }
    const relativePath = path.relative(CONFIG.rootDir, outputPath).replace(/\\/g, "/");
    run(
      db,
      `INSERT INTO deliverables
       (id, workflow_id, command_id, task_id, venture_id, title, human_name, audience,
        format, status, file_path, summary, metadata, content_hash, version, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'Storefront Preview', ?, 'operator', 'image/png',
        'built_pending_quality_review', ?, ?, ?, ?, 1, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         workflow_id = excluded.workflow_id, command_id = excluded.command_id,
         task_id = excluded.task_id, venture_id = excluded.venture_id,
         human_name = excluded.human_name, status = excluded.status,
         file_path = excluded.file_path, summary = excluded.summary,
         metadata = excluded.metadata, content_hash = excluded.content_hash,
         version = CASE WHEN deliverables.content_hash IS NOT excluded.content_hash THEN deliverables.version + 1 ELSE deliverables.version END,
         updated_at = excluded.updated_at`,
      [
        deliverableId,
        task.workflow_id,
        task.payload?.commandId || null,
        task.id,
        task.venture_id,
        `Storefront Preview ${index + 1}`,
        relativePath,
        "Preview derived from the actual generated customer files and retained for storefront and quality review.",
        toJson({
          sourceArchiveEntry: entryName,
          derivedFromProductFiles: true,
          sha256: hash,
          bytes: bytes.length,
          approvalId: task.approval_id || task.payload?.liveSpendRequest?.approvalId || null,
          localRecovery: options.localRecovery || undefined,
        }),
        hash,
        ts,
        ts,
      ],
    );
    return {
      id: deliverableId,
      humanName: `Storefront Preview ${index + 1}`,
      filePath: relativePath,
      format: "image/png",
      status: "built_pending_quality_review",
      bytes: bytes.length,
      sha256: hash,
      sourceArchiveEntry: entryName,
    };
  });
}

async function persistGeneratedProductFiles(db, task, capabilityPlan, result, options = {}) {
  const localSpec = capabilityPlan.specs.find((spec) => (
    spec.kind === "runtime_transform" && spec.sdkName === "product_file_factory"
  ));
  const codeSpec = capabilityPlan.specs.find((spec) => spec.sdkName === "code_interpreter");
  if (!localSpec && !codeSpec) return [];
  const downloads = [];
  let totalBytes = 0;
  let preparedFiles = [];
  let sourceType = "openai_code_interpreter";
  let localRender = null;
  if (localSpec) {
    const blueprint = result?.finalOutput?.work?.productBlueprint;
    const buildSpec = task?.payload?.liveSpendRequest?.parameters?.productBuildSpec || {};
    const normalized = normalizeProductBlueprintForFactory(blueprint);
    const claimIssues = productBlueprintClaimAlignmentIssues(normalized.blueprint, buildSpec);
    if (claimIssues.length) {
      const error = new Error(`Product claim preflight failed: ${claimIssues.join(" ")}`);
      error.code = "PANTHEON_PRODUCT_CLAIM_ALIGNMENT_FAILED";
      error.claimAlignmentIssues = claimIssues;
      throw error;
    }
    const factory = testDigitalProductFactory || renderDigitalProductKit;
    const rendered = await factory(task, blueprint, {
      capabilityPlan,
      artifactRoot: options.artifactRoot || CONFIG.artifactRoot,
    });
    localRender = rendered;
    preparedFiles = Array.isArray(rendered?.files) ? rendered.files : [];
    sourceType = rendered?.renderer || "pantheon-local-digital-product-factory-v1";
    if (!preparedFiles.length) {
      throw new Error("Pantheon's local product factory returned no files.");
    }
  } else {
    const citations = extractContainerFileCitations(result);
    if (!citations.length) {
      throw new Error("Product Builder used Code Interpreter but returned no downloadable product files.");
    }
    const downloader = testContainerFileDownloader || defaultContainerFileDownloader;
    for (const citation of citations) {
      const downloaded = await downloader(citation, { task, capabilityPlan });
      preparedFiles.push({ ...downloaded, citation });
    }
  }
  for (let index = 0; index < preparedFiles.length; index += 1) {
    const downloaded = preparedFiles[index];
    const citation = downloaded.citation || {};
    const filename = safeProductFilename(downloaded.filename || citation.filename, `product-file-${index + 1}`);
    const bytes = Buffer.isBuffer(downloaded.bytes) ? downloaded.bytes : Buffer.from(downloaded.bytes || []);
    totalBytes += bytes.length;
    if (totalBytes > PRODUCT_FILE_TOTAL_LIMIT_BYTES) {
      throw new Error("Generated product files exceed Pantheon's 150 MB total download limit.");
    }
    downloads.push({
      citation,
      filename,
      bytes,
      validation: validateProductFile(bytes, filename),
      sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
      sourceMetadata: downloaded.metadata || {},
    });
  }
  const {
    manifest,
    manifestFile,
    storefrontPreviews,
    bundleFile,
    embeddedManifestMatches,
    archiveInventoryVerified,
  } = validateProductManifest(downloads, task);
  const packageFingerprint = crypto
    .createHash("sha256")
    .update(downloads.map((file) => `${file.filename}:${file.sha256}`).sort().join("|"))
    .digest("hex")
    .slice(0, 16);
  const outputDir = path.join(
    options.artifactRoot || CONFIG.artifactRoot,
    "workflows",
    safeId(task.workflow_id),
    "product-files",
    safeId(task.id),
    packageFingerprint,
  );
  fs.mkdirSync(outputDir, { recursive: true });
  const ts = now();
  const persisted = [];
  for (let index = 0; index < downloads.length; index += 1) {
    const file = downloads[index];
    const extension = path.extname(file.filename).toLowerCase();
    const deliverableId = taskScopedDeliverableId("deliv_product", task.id, index + 1);
    const outputName = `${String(index + 1).padStart(2, "0")}-${file.filename}`;
    const outputPath = path.join(outputDir, outputName);
    if (fs.existsSync(outputPath)) {
      const existingHash = crypto.createHash("sha256").update(fs.readFileSync(outputPath)).digest("hex");
      if (existingHash !== file.sha256) throw new Error(`Product file path ${outputName} already contains different bytes.`);
    } else {
      const temporaryPath = `${outputPath}.${process.pid}.${randomId().slice(0, 8)}.tmp`;
      fs.writeFileSync(temporaryPath, file.bytes, { flag: "wx" });
      fs.renameSync(temporaryPath, outputPath);
    }
    const relativePath = path.relative(CONFIG.rootDir, outputPath).replace(/\\/g, "/");
    const mediaType = productMediaType(extension);
    run(
      db,
      `INSERT INTO deliverables
       (id, workflow_id, command_id, task_id, venture_id, title, human_name, audience,
        format, status, file_path, summary, metadata, content_hash, version, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'operator', ?, 'built_pending_quality_review', ?, ?, ?, ?, 1, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         workflow_id = excluded.workflow_id,
         command_id = excluded.command_id,
         task_id = excluded.task_id,
         venture_id = excluded.venture_id,
         human_name = excluded.human_name,
         status = excluded.status,
         file_path = excluded.file_path,
         summary = excluded.summary,
         metadata = excluded.metadata,
         content_hash = excluded.content_hash,
         version = CASE WHEN deliverables.content_hash IS NOT excluded.content_hash THEN deliverables.version + 1 ELSE deliverables.version END,
         updated_at = excluded.updated_at`,
      [
        deliverableId,
        task.workflow_id,
        task.payload?.commandId || null,
        task.id,
        task.venture_id,
        file === manifestFile ? "Product Manifest" : "Generated Product File",
        file.filename,
        mediaType,
        relativePath,
        file === manifestFile
          ? "Machine-readable catalogue manifest used by Pantheon to verify product coverage."
          : localSpec
            ? "Product package rendered deterministically from the approved Luna blueprint and retained locally for quality review."
            : "Product file generated in an isolated Code Interpreter workspace and retained locally for quality review.",
        toJson({
          provider: localSpec ? "pantheon-local-runtime" : AGENTS_SDK_PROVIDER,
          renderer: localSpec ? sourceType : null,
          containerId: file.citation.containerId || null,
          providerFileId: file.citation.fileId || null,
          sourceMetadata: file.sourceMetadata,
          runtimeNormalizations: localSpec ? localRender?.runtimeNormalizations || [] : [],
          sha256: file.sha256,
          bytes: file.bytes.length,
          validation: {
            extension: file.validation.extension,
            archiveEntries: file.validation.archive?.entries?.length || 0,
            expandedBytes: file.validation.archive?.expandedBytes || 0,
            canonicalManifestInsideBundle: file === bundleFile ? embeddedManifestMatches : undefined,
            archiveInventoryVerified: file === bundleFile ? archiveInventoryVerified : undefined,
          },
          productManifest: file === manifestFile ? manifest : undefined,
          approvalId: task.approval_id || task.payload?.liveSpendRequest?.approvalId || null,
          localRecovery: options.localRecovery || undefined,
        }),
        file.sha256,
        ts,
        ts,
      ],
    );
    persisted.push({
      id: deliverableId,
      humanName: file.filename,
      filePath: relativePath,
      format: mediaType,
      status: "built_pending_quality_review",
      bytes: file.bytes.length,
      sha256: file.sha256,
      containerId: file.citation.containerId || null,
      providerFileId: file.citation.fileId || null,
      manifest: file === manifestFile,
    });
  }
  const previews = persistStorefrontPreviews(db, task, downloads, storefrontPreviews, options);
  const blueprint = localSpec ? result?.finalOutput?.work?.productBlueprint || null : null;
  return {
    files: persisted,
    manifest,
    previews,
    sourceType,
    manifestEmbeddedIdentical: embeddedManifestMatches,
    archiveInventoryVerified,
    blueprint,
    blueprintHash: blueprint
      ? crypto.createHash("sha256").update(JSON.stringify(blueprint)).digest("hex")
      : null,
    renderedBlueprintHash: localSpec ? localRender?.renderedBlueprintHash || null : null,
    runtimeNormalizations: localSpec ? localRender?.runtimeNormalizations || [] : [],
  };
}

function recoverStoredProductBlueprint(task, options = {}) {
  const result = task.result && typeof task.result === "object"
    ? task.result
    : fromJson(task.result, {});
  const retained = result.output?.generatedFiles?.blueprint;
  if (retained) return retained;
  const production = task.payload?.liveSpendRequest?.parameters?.pantheonProduction || {};
  const spec = task.payload?.liveSpendRequest?.parameters?.productBuildSpec || {};
  const stageRoot = path.join(
    options.artifactRoot || CONFIG.artifactRoot,
    ".staging",
    "digital-product-kits",
    safeId(task.id),
  );
  if (!fs.existsSync(stageRoot)) {
    throw new Error("Pantheon cannot re-render this package because its approved Product Builder blueprint is unavailable.");
  }
  const candidates = fs.readdirSync(stageRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(stageRoot, entry.name, "factory-input.json"))
    .filter((candidate) => fs.existsSync(candidate))
    .map((candidate) => {
      const input = JSON.parse(fs.readFileSync(candidate, "utf8"));
      return { candidate, input, modified: fs.statSync(candidate).mtimeMs };
    })
    .filter(({ input }) => (
      input.schema === "pantheon.digital-product-factory-input.v1"
      && String(input.spec?.planId || "") === String(spec.planId || production.planId || "")
      && Number(input.spec?.revisionNumber || 0) === Number(production.revisionNumber || 0)
    ))
    .sort((left, right) => right.modified - left.modified);
  if (!candidates.length || !candidates[0].input.blueprint) {
    throw new Error("Pantheon cannot re-render this package because no matching frozen Product Builder blueprint was found.");
  }
  return candidates[0].input.blueprint;
}

async function refreshLocalDigitalProductFiles(db, taskId, options = {}) {
  const row = get(db, "SELECT * FROM tasks WHERE id = ?", [taskId]);
  if (!row) throw new Error(`Product Builder task not found: ${taskId}`);
  const task = { ...row, payload: fromJson(row.payload, {}), result: fromJson(row.result, {}) };
  const request = task.payload?.liveSpendRequest || {};
  const production = request.parameters?.pantheonProduction || {};
  if (
    task.status !== "completed"
    || task.agent !== "product_builder"
    || !Array.isArray(request.tools)
    || !request.tools.includes("product_file_factory")
    || production.stage !== "product_build"
  ) {
    throw new Error("Only a completed, locally rendered Product Builder package can use deterministic re-render recovery.");
  }
  const blueprint = recoverStoredProductBlueprint(task, options);
  const previousGeneratedFiles = task.result?.output?.generatedFiles || {};
  const previousBlueprintHash = previousGeneratedFiles.blueprintHash
    || crypto.createHash("sha256").update(JSON.stringify(blueprint)).digest("hex");
  const generatedFiles = await persistGeneratedProductFiles(
    db,
    task,
    {
      specs: [{
        kind: "runtime_transform",
        sdkName: "product_file_factory",
      }],
    },
    { finalOutput: { work: { productBlueprint: blueprint } } },
    options,
  );
  if (generatedFiles.blueprintHash !== previousBlueprintHash) {
    throw new Error("Pantheon refused the local renderer refresh because the approved Product Builder blueprint changed.");
  }
  const refreshedAt = now();
  const rendererRevision = String(options.rendererRevision || "unspecified-local-renderer-revision");
  const localRendererRefresh = {
    schema: "pantheon.local-renderer-refresh.v1",
    refreshedAt,
    rendererRevision,
    sourceTaskId: task.id,
    blueprintHash: generatedFiles.blueprintHash,
    noProviderCall: true,
    externalAction: false,
    previousFiles: (previousGeneratedFiles.files || []).map((file) => ({
      id: file.id,
      sha256: file.sha256,
      filePath: file.filePath,
    })),
    currentFiles: (generatedFiles.files || []).map((file) => ({
      id: file.id,
      sha256: file.sha256,
      filePath: file.filePath,
    })),
  };
  const result = task.result;
  result.output = {
    ...(result.output || {}),
    generatedFiles,
    localRendererRefresh,
  };
  run(
    db,
    "UPDATE tasks SET result = ?, updated_at = ? WHERE id = ?",
    [toJson(result), refreshedAt, task.id],
  );
  if (production.planId) {
    const plan = get(db, "SELECT metadata FROM catalogue_plans WHERE id = ?", [production.planId]);
    if (plan) {
      const metadata = {
        ...fromJson(plan.metadata, {}),
        productManifest: generatedFiles.manifest,
        generatedFileIds: generatedFiles.files.map((file) => file.id),
        storefrontPreviewIds: generatedFiles.previews.map((preview) => preview.id),
        productBundleDeliverableId: generatedFiles.files.find((file) => /\.zip$/i.test(file.humanName))?.id || null,
        localRendererRefreshedAt: refreshedAt,
        localRendererRefresh,
      };
      run(
        db,
        "UPDATE catalogue_plans SET metadata = ?, updated_at = ? WHERE id = ?",
        [toJson(metadata), refreshedAt, production.planId],
      );
    }
  }
  insertEvent(db, {
    actor: "jarvis",
    type: "catalogue.local_renderer_refreshed",
    entityType: "task",
    entityId: task.id,
    message: "Jarvis re-rendered the exact approved product blueprint after a tested local file-factory correction; no provider call or external action occurred.",
    metadata: {
      planId: production.planId || null,
      revisionNumber: Number(production.revisionNumber || 0),
      rendererRevision,
      blueprintHash: generatedFiles.blueprintHash,
      previousFiles: localRendererRefresh.previousFiles,
      currentFiles: localRendererRefresh.currentFiles,
      noProviderCall: true,
      externalAction: false,
      fileIds: generatedFiles.files.map((file) => file.id),
      previewIds: generatedFiles.previews.map((preview) => preview.id),
    },
  });
  return generatedFiles;
}

function refreshLocalStorefrontCover(db, taskId, options = {}) {
  const row = get(db, "SELECT * FROM tasks WHERE id = ?", [taskId]);
  if (!row) throw new Error(`Storefront visual task not found: ${taskId}`);
  const task = { ...row, payload: fromJson(row.payload, {}), result: fromJson(row.result, {}) };
  const request = task.payload?.liveSpendRequest || {};
  const production = request.parameters?.pantheonProduction || {};
  if (
    task.status !== "completed"
    || task.agent !== "product_builder"
    || production.stage !== "storefront_visuals"
  ) {
    throw new Error("Only a completed Product Builder storefront cover can use deterministic composition recovery.");
  }
  const deliverables = all(
    db,
    `SELECT * FROM deliverables
     WHERE task_id = ? AND title = 'Generated Product Asset' AND status <> 'superseded'
     ORDER BY created_at, id`,
    [task.id],
  );
  if (deliverables.length !== 1) {
    throw new Error("Pantheon needs exactly one retained storefront cover for deterministic composition recovery.");
  }
  const deliverable = deliverables[0];
  const priorMetadata = fromJson(deliverable.metadata, {});
  const sourceHash = String(priorMetadata.providerBackgroundSha256 || "");
  if (!sourceHash) {
    throw new Error("The retained storefront cover has no exact provider-background hash.");
  }
  const sourceRoot = path.join(
    options.artifactRoot || CONFIG.artifactRoot,
    ".staging",
    "storefront-covers",
    safeId(task.id),
  );
  const sourcePath = fs.existsSync(sourceRoot)
    ? fs.readdirSync(sourceRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(sourceRoot, entry.name, "provider-background.png"))
      .find((candidate) => {
        if (!fs.existsSync(candidate)) return false;
        return crypto.createHash("sha256").update(fs.readFileSync(candidate)).digest("hex") === sourceHash;
      })
    : null;
  if (!sourcePath) {
    throw new Error("Pantheon cannot recompose this cover because its exact generated background is unavailable.");
  }
  const composition = composeStorefrontCover(task, fs.readFileSync(sourcePath), {
    artifactRoot: options.artifactRoot || CONFIG.artifactRoot,
    title: task.payload?.subject || task.title,
    subtitle: options.subtitle
      || production.customerPromise
      || task.payload?.offer,
  });
  if (composition.sourceSha256 !== sourceHash) {
    throw new Error("Pantheon refused the cover refresh because the generated background changed.");
  }
  const outputDir = path.join(
    options.artifactRoot || CONFIG.artifactRoot,
    "workflows",
    safeId(task.workflow_id),
    "generated-assets",
  );
  fs.mkdirSync(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, `${deliverable.id}_${composition.sha256.slice(0, 12)}.png`);
  if (fs.existsSync(outputPath)) {
    const existingHash = crypto.createHash("sha256").update(fs.readFileSync(outputPath)).digest("hex");
    if (existingHash !== composition.sha256) {
      throw new Error("The refreshed storefront-cover path already contains different bytes.");
    }
  } else {
    const temporaryPath = `${outputPath}.${process.pid}.${randomId().slice(0, 8)}.tmp`;
    fs.writeFileSync(temporaryPath, composition.bytes, { flag: "wx" });
    fs.renameSync(temporaryPath, outputPath);
  }
  const relativePath = path.relative(CONFIG.rootDir, outputPath).replace(/\\/g, "/");
  const refreshedAt = now();
  const localCoverRefresh = {
    schema: "pantheon.local-cover-refresh.v1",
    refreshedAt,
    rendererRevision: String(options.rendererRevision || composition.renderer),
    sourceTaskId: task.id,
    sourceSha256: sourceHash,
    noProviderCall: true,
    externalAction: false,
    previousAsset: {
      id: deliverable.id,
      sha256: deliverable.content_hash,
      filePath: deliverable.file_path,
      renderer: priorMetadata.compositionRenderer || null,
    },
    currentAsset: {
      id: deliverable.id,
      sha256: composition.sha256,
      filePath: relativePath,
      renderer: composition.renderer,
      subtitle: composition.subtitle,
    },
  };
  run(
    db,
    `UPDATE deliverables
     SET file_path = ?, metadata = ?, content_hash = ?,
         version = CASE WHEN content_hash <> ? THEN version + 1 ELSE version END,
         updated_at = ?
     WHERE id = ?`,
    [
      relativePath,
      toJson({
        ...priorMetadata,
        sha256: composition.sha256,
        bytes: composition.bytes.length,
        compositionRenderer: composition.renderer,
        compositionFingerprint: composition.fingerprint,
        compositionSubtitle: composition.subtitle,
        localCoverRefresh,
      }),
      composition.sha256,
      composition.sha256,
      refreshedAt,
      deliverable.id,
    ],
  );
  const result = task.result;
  const previousAssets = Array.isArray(result.output?.generatedAssets)
    ? result.output.generatedAssets
    : [];
  result.output = {
    ...(result.output || {}),
    generatedAssets: previousAssets.map((asset) => asset.id === deliverable.id ? {
      ...asset,
      filePath: relativePath,
      bytes: composition.bytes.length,
      sha256: composition.sha256,
    } : asset),
    localCoverRefresh,
  };
  run(
    db,
    "UPDATE tasks SET result = ?, updated_at = ? WHERE id = ?",
    [toJson(result), refreshedAt, task.id],
  );
  if (production.planId) {
    const plan = get(db, "SELECT metadata FROM catalogue_plans WHERE id = ?", [production.planId]);
    if (plan) {
      run(
        db,
        "UPDATE catalogue_plans SET metadata = ?, updated_at = ? WHERE id = ?",
        [
          toJson({
            ...fromJson(plan.metadata, {}),
            localCoverRefreshedAt: refreshedAt,
            localCoverRefresh,
          }),
          refreshedAt,
          production.planId,
        ],
      );
    }
  }
  insertEvent(db, {
    actor: "jarvis",
    type: "catalogue.local_cover_refreshed",
    entityType: "task",
    entityId: task.id,
    message: "Jarvis recomposed the exact approved storefront background after a tested local layout correction; no provider call or external action occurred.",
    metadata: localCoverRefresh,
  });
  return {
    asset: {
      id: deliverable.id,
      humanName: deliverable.human_name,
      filePath: relativePath,
      format: "image/png",
      status: deliverable.status,
      bytes: composition.bytes.length,
      sha256: composition.sha256,
    },
    localCoverRefresh,
  };
}

function deterministicProductBuilderResult(task, generatedFiles) {
  const spec = task.payload?.liveSpendRequest?.parameters?.productBuildSpec || {};
  const catalogueItems = Array.isArray(spec.catalogueItems) ? spec.catalogueItems : [];
  const files = Array.isArray(generatedFiles?.files) ? generatedFiles.files : [];
  const previews = Array.isArray(generatedFiles?.previews) ? generatedFiles.previews : [];
  const manifestItems = Array.isArray(generatedFiles?.manifest?.catalogueItems)
    ? generatedFiles.manifest.catalogueItems
    : [];
  const producedFiles = files.map((file) => file.humanName).filter(Boolean).slice(0, 5);
  const coverage = manifestItems
    .map((item) => String(item.id || item.catalogueItemId || ""))
    .filter(Boolean)
    .slice(0, 5);
  return {
    summary: `Product Builder designed ${catalogueItems.length} approved catalogue items and Pantheon rendered and validated the exact customer package.`,
    recommendation: "Send the retained files and previews to the independent Quality Reviewer before preparing any listing or publication action.",
    evidence: [
      `${files.length} generated package files were opened, hashed, and retained locally by Pantheon.`,
      `The manifest covers ${coverage.length} exact catalogue items and ${previews.length} storefront previews derived from the customer package.`,
    ],
    risks: [
      "The files are technically valid but still require independent semantic, visual, claim, and customer-usability review.",
    ],
    nextAction: "Run the independent Quality Reviewer against the exact retained files, manifest, and previews.",
    operatorDecision: "approve",
    confidence: "high",
    work: {
      productFormat: String(spec.profile || "Validated digital product package"),
      assetPlan: catalogueItems.map((item) => String(item.title || item.id)).filter(Boolean).slice(0, 5),
      productionMethod: generatedFiles?.sourceType === "pantheon-local-digital-product-factory-v1"
        ? "Luna defined the exact product blueprint once; Pantheon then rendered, opened, hashed, and validated the files locally."
        : "Luna produced the package in an isolated workspace; Pantheon then downloaded, opened, hashed, and validated the files locally.",
      producedFiles,
      catalogueCoverage: coverage,
      qualityChecks: [
        "Manifest schema and approved plan identity matched",
        "Every approved catalogue item mapped to a real file",
        "Archive paths and file types passed safety validation",
        "Storefront previews were extracted from the real package",
      ],
      limitations: [
        "No buyer demand, conversion, or customer satisfaction result exists until the finished offer is published and measured.",
      ],
      approvalNeeded: "Independent Quality Reviewer pass and Daniel's later publication decision.",
      channelFit: "Local Gumroad-ready digital download package; nothing has been uploaded or published.",
    },
  };
}

async function renderRetainedProductBuilderOutput(db, task, retainedOutput, options = {}) {
  const request = task?.payload?.liveSpendRequest || {};
  const production = request.parameters?.pantheonProduction || {};
  if (
    task?.agent !== "jarvis"
    || task?.kind !== "local_product_output_recovery"
    || production.stage !== "product_build"
    || !request.parameters?.productBuildSpec
    || request.provider !== "pantheon-local-runtime"
  ) {
    throw new Error("Retained Product Builder output can only be rendered by an exact Pantheon local-recovery task.");
  }
  const blueprint = retainedOutput?.work?.productBlueprint;
  if (!blueprint) {
    throw new Error("The retained provider result does not contain a Product Builder blueprint.");
  }
  const generatedFiles = await persistGeneratedProductFiles(
    db,
    task,
    {
      specs: [{
        kind: "runtime_transform",
        sdkName: "product_file_factory",
        toolId: "product_file_factory",
      }],
    },
    { finalOutput: retainedOutput },
    {
      ...options,
      localRecovery: {
        schema: "pantheon.retained-provider-output-recovery.v1",
        sourceTaskId: options.sourceTaskId || null,
        sourceRunId: options.sourceRunId || null,
        sourceAttemptId: options.sourceAttemptId || null,
        sourceModelCallId: options.sourceModelCallId || null,
        sourceProviderRequestId: options.sourceProviderRequestId || null,
        sourceOutputHash: options.sourceOutputHash || null,
        noNewProviderCall: true,
      },
    },
  );
  return {
    generatedFiles,
    acceptedOutput: deterministicProductBuilderResult(task, generatedFiles),
  };
}

function packageAvailable(name) {
  try {
    require.resolve(name);
    return true;
  } catch {
    return false;
  }
}

function isAgentRuntimeSdkAvailable() {
  return getAgentRuntimeReadiness().primaryReady;
}

function getAgentRuntimeReadiness() {
  const sdkInstalled = packageAvailable("@openai/agents");
  const zodInstalled = packageAvailable("zod");
  const sdkDisabled = environmentDisabled("disableAgentsSdk");
  const liveWorkerDisabled = environmentDisabled("disableLiveAiWorkerAdapter");
  const hostedTools = {
    webSearch: false,
    imageGeneration: false,
    codeInterpreter: false,
  };
  if (sdkInstalled) {
    const sdk = require("@openai/agents");
    hostedTools.webSearch = typeof sdk.webSearchTool === "function";
    hostedTools.imageGeneration = typeof sdk.imageGenerationTool === "function";
    hostedTools.codeInterpreter = typeof sdk.codeInterpreterTool === "function";
  }
  const hostedToolsReady = Object.values(hostedTools).every(Boolean);
  const sdkReady = sdkInstalled && zodInstalled && hostedToolsReady && !sdkDisabled && !liveWorkerDisabled;
  const responsesFallbackReady = !liveWorkerDisabled;
  const blockers = [];
  if (!sdkInstalled) blockers.push("@openai/agents is not installed.");
  if (!zodInstalled) blockers.push("zod is not installed.");
  if (sdkInstalled && !hostedTools.webSearch) blockers.push("The installed Agents SDK does not expose web search.");
  if (sdkInstalled && !hostedTools.imageGeneration) blockers.push("The installed Agents SDK does not expose image generation.");
  if (sdkInstalled && !hostedTools.codeInterpreter) blockers.push("The installed Agents SDK does not expose Code Interpreter.");
  if (sdkDisabled) blockers.push(`OpenAI Agents SDK runner is disabled by ${preferredEnvironmentName("disableAgentsSdk")}.`);
  if (liveWorkerDisabled) blockers.push(`Live AI worker adapter is disabled by ${preferredEnvironmentName("disableLiveAiWorkerAdapter")}.`);

  return {
    primaryProvider: AGENTS_SDK_PROVIDER,
    primaryReady: sdkReady,
    sdkInstalled,
    zodInstalled,
    hostedTools,
    hostedToolsReady,
    sdkDisabled,
    liveWorkerDisabled,
    fallbackProvider: LIVE_AI_WORKER_PROVIDER,
    fallbackReady: responsesFallbackReady,
    ready: sdkReady,
    blockers,
  };
}

function loadAgentsSdk() {
  const sdk = require("@openai/agents");
  const { z } = require("zod");
  return {
    Agent: sdk.Agent,
    Runner: sdk.Runner,
    RunState: sdk.RunState,
    codeInterpreterTool: sdk.codeInterpreterTool,
    generateTraceId: sdk.generateTraceId,
    imageGenerationTool: sdk.imageGenerationTool,
    webSearchTool: sdk.webSearchTool,
    z,
  };
}

function getDefaultSdkRunner(Runner) {
  if (!defaultSdkRunner) defaultSdkRunner = new Runner();
  return defaultSdkRunner;
}

function zodOutputSchema(z) {
  const continuousImprovement = z.object({
    hypothesis: z.string(),
    smallestUsefulAction: z.string(),
    expectedMetric: z.string(),
    actualResult: z.string(),
    learning: z.string(),
    improvement: z.string(),
  }).strict();

  const businessDecision = z.object({
    buyer: z.string(),
    problem: z.string(),
    offer: z.string(),
    channel: z.string(),
    moneyMove: z.string(),
    evidenceSummary: z.string(),
    risk: z.enum(["low", "medium", "high"]),
    nextAction: z.string(),
    successMetric: z.string(),
    killCriteria: z.string(),
    approvalRequired: z.boolean(),
    externalActionsAllowed: z.boolean(),
    hardStops: z.array(z.string()),
    continuousImprovement,
  }).strict();

  return z.object({
    heading: z.string(),
    summary: z.string(),
    moneyMove: z.string(),
    evidence: z.array(z.string()),
    counterevidence: z.array(z.string()),
    priceChannelHypothesis: z.string(),
    smallestTest: z.string(),
    metric: z.string(),
    killRule: z.string(),
    risks: z.array(z.string()),
    nextAction: z.string(),
    operatorDecision: z.enum(["approve", "revise", "deny", "needs_evidence"]),
    confidence: z.enum(["low", "medium", "high"]),
    expectedUpside: z.string(),
    costRisk: z.string(),
    assumptions: z.array(z.string()),
    businessDecision,
  }).strict();
}

function demandValidatorPilotOutputSchema(z) {
  return demandValidatorPilotSchema(z);
}

function sdkUsage(result) {
  const usage = result?.runContext?.usage || result?.state?._context?.usage || {};
  const rawResponses = Array.isArray(result?.rawResponses) ? result.rawResponses : [];
  const lastUsage = rawResponses.length ? rawResponses[rawResponses.length - 1]?.usage || {} : {};
  const inputDetails = usage.inputTokensDetails
    || lastUsage.inputTokensDetails
    || lastUsage.input_tokens_details
    || {};
  const metric = (primaryKeys, secondaryKeys = primaryKeys) => {
    for (const key of primaryKeys) {
      if (Object.prototype.hasOwnProperty.call(usage, key) && usage[key] !== null && usage[key] !== undefined) {
        const value = Number(usage[key]);
        if (Number.isFinite(value) && value >= 0) return { known: true, value };
      }
    }
    for (const key of secondaryKeys) {
      if (Object.prototype.hasOwnProperty.call(lastUsage, key) && lastUsage[key] !== null && lastUsage[key] !== undefined) {
        const value = Number(lastUsage[key]);
        if (Number.isFinite(value) && value >= 0) return { known: true, value };
      }
    }
    return { known: false, value: 0 };
  };
  const input = metric(["inputTokens", "input_tokens"], ["inputTokens", "input_tokens"]);
  const output = metric(["outputTokens", "output_tokens"], ["outputTokens", "output_tokens"]);
  const total = metric(["totalTokens", "total_tokens"], ["totalTokens", "total_tokens"]);
  const cachedValue = inputDetails.cachedTokens ?? inputDetails.cached_tokens;
  const cachedKnown = cachedValue !== null && cachedValue !== undefined && Number.isFinite(Number(cachedValue));
  const knownCount = [input, output, total].filter((item) => item.known).length;
  return {
    input_tokens: input.value,
    output_tokens: output.value,
    total_tokens: total.value,
    cached_input_tokens: cachedKnown ? Number(cachedValue) : 0,
    input_tokens_known: input.known,
    output_tokens_known: output.known,
    total_tokens_known: total.known,
    cached_input_tokens_known: cachedKnown,
    usage_status: knownCount === 0 ? "unknown" : knownCount === 3 ? "reported" : "partial",
  };
}

function sdkResponseId(result) {
  if (result?.lastResponseId) return result.lastResponseId;
  const rawResponses = Array.isArray(result?.rawResponses) ? result.rawResponses : [];
  return rawResponses.length ? rawResponses[rawResponses.length - 1]?.responseId || null : null;
}

function sdkOutputText(finalOutput) {
  if (typeof finalOutput === "string") return finalOutput;
  if (finalOutput && typeof finalOutput === "object") return JSON.stringify(finalOutput);
  return "";
}

function usesDeterministicProductFileResult(agentDefinition, capabilityPlan) {
  return agentDefinition?.id === "product_builder"
    && capabilityPlan?.specs?.some((spec) => ["code_interpreter", "product_file_factory"].includes(spec.sdkName));
}

function sdkInterruptionCallId(interruption) {
  const raw = typeof interruption?.toJSON === "function" ? interruption.toJSON() : interruption;
  return raw?.id || raw?.callId || raw?.rawItem?.call_id || raw?.rawItem?.id || null;
}

function approveSelectedSdkInterruption(state, callId) {
  if (!callId) throw new Error("A specific SDK interruption call ID is required to resume an approved tool call.");
  const interruptions = state.getInterruptions();
  const matching = interruptions.filter((interruption) => sdkInterruptionCallId(interruption) === callId);
  if (matching.length !== 1) {
    throw new Error(`Expected exactly one approved SDK interruption for call ${callId}; found ${matching.length}.`);
  }
  state.approve(matching[0]);
  return matching[0];
}

function approvedTracePolicy(task) {
  const policy = task.payload?.liveSpendRequest?.tracePolicy || {};
  return {
    providerResponseStored: policy.providerResponseStored === true,
    providerTraceContent: policy.providerTraceContent === true,
    localReviewStored: true,
    dataClass: String(policy.dataClass || "business_internal"),
    purpose: String(policy.purpose || "Keep a local operator and developer review record for this run."),
  };
}

function lifecycleToolName(tool) {
  return tool?.name || tool?.id || tool?.type || "approved tool";
}

function attachSdkLifecycleHooks(runner, task, callback) {
  if (!runner?.on || typeof callback !== "function") return () => {};
  const belongsToTask = (context) => !context?.context?.taskId || context.context.taskId === task.id;
  const emit = (context, event) => {
    if (!belongsToTask(context)) return;
    try {
      callback(event);
    } catch {
      // A dashboard trace failure must not turn a provider result into a paid retry.
    }
  };
  const listeners = [
    ["agent_start", (context, agent) => emit(context, {
      type: "sdk_agent_started",
      title: "OpenAI worker started",
      detail: `${agent?.name || "The approved worker"} started processing the supplied business context.`,
      metadata: { agentName: agent?.name || null },
    })],
    ["agent_end", (context, agent) => emit(context, {
      type: "sdk_agent_finished",
      title: "OpenAI worker finished",
      detail: `${agent?.name || "The approved worker"} finished its model work; Pantheon is checking and storing the result.`,
      metadata: { agentName: agent?.name || null },
    })],
    ["agent_handoff", (context, fromAgent, toAgent) => emit(context, {
      type: "sdk_agent_handoff",
      title: "Specialist handoff",
      detail: `${fromAgent?.name || "A worker"} handed the task to ${toAgent?.name || "another approved worker"}.`,
      metadata: { fromAgent: fromAgent?.name || null, toAgent: toAgent?.name || null },
    })],
    ["agent_tool_start", (context, agent, tool, details) => emit(context, {
      type: "sdk_tool_started",
      title: `${lifecycleToolName(tool)} started`,
      detail: `${agent?.name || "The approved worker"} started an approved ${lifecycleToolName(tool)} action.`,
      metadata: {
        agentName: agent?.name || null,
        toolName: lifecycleToolName(tool),
        callId: details?.toolCall?.callId || details?.toolCall?.id || null,
      },
    })],
    ["agent_tool_end", (context, agent, tool, result, details) => emit(context, {
      type: "sdk_tool_finished",
      title: `${lifecycleToolName(tool)} finished`,
      detail: `${agent?.name || "The approved worker"} finished the approved ${lifecycleToolName(tool)} action.`,
      metadata: {
        agentName: agent?.name || null,
        toolName: lifecycleToolName(tool),
        callId: details?.toolCall?.callId || details?.toolCall?.id || null,
        resultCharacters: typeof result === "string" ? result.length : null,
      },
    })],
  ];
  for (const [event, listener] of listeners) runner.on(event, listener);
  return () => {
    for (const [event, listener] of listeners) runner.off(event, listener);
  };
}

async function runSdkAgent(requestBody, task, agentDefinition, policy, options = {}) {
  const sdk = loadAgentsSdk();
  const { Agent, Runner, RunState, generateTraceId, z } = sdk;
  const traceId = options.traceId || generateTraceId();
  const tracePolicy = approvedTracePolicy(task);
  const capabilityPlan = options.capabilityPlan || buildAgentsSdkCapabilityPlan(task, agentDefinition);
  if (testSdkRunner) {
    let dispatchStarted = false;
    try {
      if (typeof options.beforeDispatch === "function") {
        options.beforeDispatch({ traceId, capabilityPlan });
      }
      dispatchStarted = true;
      const result = await testSdkRunner({ requestBody, task, agentDefinition, policy, options, traceId, tracePolicy, capabilityPlan });
      return { result, traceId };
    } catch (error) {
      classifySdkRunError(error, dispatchStarted, traceId);
      throw error;
    }
  }

  const sdkTools = materializeAgentsSdkTools(sdk, capabilityPlan);
  const deterministicProductFileResult = usesDeterministicProductFileResult(agentDefinition, capabilityPlan);
  const productVisualResult = agentDefinition?.id === "product_builder"
    && capabilityPlan?.specs?.some((spec) => spec.sdkName === "image_generation");
  const agentOptions = {
    name: agentDefinition.name,
    instructions: requestBody.input[0].content,
    model: requestBody.model,
    tools: sdkTools,
    handoffs: [],
    modelSettings: {
      maxTokens: Math.min(8000, Number(requestBody.max_output_tokens || 1200)),
      toolChoice: capabilityPlan.toolChoice,
      parallelToolCalls: capabilityPlan.parallelToolCalls,
      store: tracePolicy.providerResponseStored,
      providerData: {
        max_tool_calls: capabilityPlan.maxToolCalls || undefined,
        include: capabilityPlan.specs.some((spec) => spec.sdkName === "web_search")
          ? ["web_search_call.action.sources"]
          : undefined,
        safety_identifier: stableSafetyIdentifier(task),
        prompt_cache_key: `pantheon_${agentDefinition.id}_${requestBody.metadata.packet_schema}`,
      },
    },
  };
  agentOptions.outputType = task.payload?.pilotFixture
    ? demandValidatorPilotOutputSchema(z)
    : deterministicProductFileResult
      ? productBuilderFileOutputZodSchema(
        z,
        task.payload?.liveSpendRequest?.parameters?.productBuildSpec,
      )
      : productVisualResult
        ? productBuilderVisualOutputZodSchema(z)
        : workerOutputZodSchema(z, agentDefinition.id);
  const agent = new Agent(agentOptions);
  const runner = options.runner || getDefaultSdkRunner(Runner);
  let sdkInput = options.modelInput || requestBody.input[1].content;
  if (options.resumeState) {
    try {
      const state = await RunState.fromString(agent, options.resumeState);
      if (typeof state.clearTrace === "function") state.clearTrace();
      approveSelectedSdkInterruption(state, options.resumeInterruptionCallId);
      sdkInput = state;
    } catch (error) {
      error.agentSdkTraceId = traceId;
      error.providerCallOccurred = false;
      error.outcomeUnknown = false;
      error.providerDispatchStatus = "not_dispatched";
      throw error;
    }
  }
  const signal = options.signal || (typeof AbortSignal?.timeout === "function" ? AbortSignal.timeout(capabilityPlan.deadlineMs) : undefined);
  const detachLifecycleHooks = attachSdkLifecycleHooks(runner, task, options.onLifecycleEvent);
  let dispatchStarted = false;
  try {
    if (typeof options.beforeDispatch === "function") {
      options.beforeDispatch({ traceId, capabilityPlan });
    }
    dispatchStarted = true;
    const result = await runner.run(agent, sdkInput, {
      maxTurns: capabilityPlan.maxTurns,
      traceId,
      workflowName: `Pantheon ${agentDefinition.name} controlled run`,
      traceIncludeSensitiveData: tracePolicy.providerTraceContent,
      signal,
      traceMetadata: {
        venture_id: String(task.venture_id || ""),
        workflow_id: String(task.workflow_id || ""),
        task_id: String(task.id || ""),
        fixture_hash: String(task.payload?.liveSpendRequest?.fixtureHash || ""),
        provider_response_stored: String(tracePolicy.providerResponseStored),
        provider_trace_content: String(tracePolicy.providerTraceContent),
        data_class: tracePolicy.dataClass,
      },
      context: {
        workflowId: task.workflow_id,
        taskId: task.id,
        agentId: agentDefinition.id,
        provider: AGENTS_SDK_PROVIDER,
        externalActionsAllowed: false,
        approvedSdkTools: capabilityPlan.requestedTools,
      },
    });
    return { result, traceId };
  } catch (error) {
    classifySdkRunError(error, dispatchStarted, traceId);
    throw error;
  } finally {
    detachLifecycleHooks();
  }
}

async function runAgentsSdkWorkerTask(db, task, agentDefinition, policy, options = {}) {
  if (!environmentEnabled("enableLiveModels")) {
    throw new Error(`${preferredEnvironmentName("enableLiveModels")} must be set to 1 for live AI worker execution.`);
  }
  if (!isAgentRuntimeSdkAvailable()) {
    throw new Error(`OpenAI Agents SDK runner is not ready: ${getAgentRuntimeReadiness().blockers.join(" ")}`);
  }

  const requestBody = buildOpenAIRequest(db, task, agentDefinition, policy);
  const approvedCapCents = liveWorkerCostEstimateCents(task);
  const tracePolicy = approvedTracePolicy(task);
  const capabilityPlan = buildAgentsSdkCapabilityPlan(task, agentDefinition);
  if (
    usesDeterministicProductFileResult(agentDefinition, capabilityPlan)
    && capabilityPlan.specs.some((spec) => spec.sdkName === "product_file_factory")
    && !testDigitalProductFactory
  ) {
    assertDigitalProductFactoryReady();
  }
  const modelInput = buildAgentsSdkModelInput(db, task, requestBody.input[1].content, capabilityPlan);
  const inputAssets = modelInput.assets;
  const resumeSelection = getApprovedSdkResumeSelection(db, task);
  const resumeState = resumeSelection?.serializedState || null;
  const toolInvocations = capabilityPlan.specs.map((spec) => ({
    spec,
    gate: requestAgentToolUse(db, {
      agentId: agentDefinition.id,
      agentName: agentDefinition.name,
      runId: options.agentRunId || null,
      attemptId: options.taskClaim?.attemptId || null,
      task,
      toolId: spec.toolId,
      mode: "live",
      approvalId: task.approval_id || task.payload?.liveSpendRequest?.approvalId || null,
      reason: `Use the exact approved ${spec.sdkName} capability inside this capped Agents SDK run.`,
      toolArguments: resumeSelection?.toolId === spec.toolId
        ? resumeSelection.toolArguments
        : task.payload?.liveSpendRequest?.toolArguments?.[spec.toolId] || task.payload?.liveSpendRequest?.toolArguments || {},
      effects: resumeSelection?.toolId === spec.toolId
        ? resumeSelection.effects
        : task.payload?.liveSpendRequest?.effects || [],
      callId: resumeSelection?.toolId === spec.toolId ? resumeSelection.callId : null,
      resumeStateHash: resumeSelection?.toolId === spec.toolId ? resumeSelection.stateHash : null,
    }),
  }));
  const blockedTool = toolInvocations.find((item) => !item.gate.allowed);
  if (blockedTool) {
    throw new Error(`${blockedTool.spec.toolId} did not pass the Pantheon worker tool gate: ${blockedTool.gate.reason || blockedTool.gate.decision || "blocked"}.`);
  }
  let dispatchCall = null;
  let result;
  let traceId = null;
  try {
    const sdkRun = await runSdkAgent(requestBody, task, agentDefinition, policy, {
      ...options,
      capabilityPlan,
      resumeState,
      resumeInterruptionCallId: resumeSelection?.callId || null,
      modelInput: modelInput.input,
      inputAssets,
      beforeDispatch: ({ traceId: assignedTraceId }) => {
        dispatchCall = recordLiveWorkerModelCall(db, task, null, approvedCapCents, requestBody.model, "dispatching", {
          reservedCostCents: approvedCapCents,
          provider: AGENTS_SDK_PROVIDER,
          sdkRunner: true,
          agentRunId: options.agentRunId || null,
          taskAttemptId: options.taskClaim?.attemptId || null,
          dispatchIntent: { status: "dispatched", recordedAt: now(), deadlineMs: capabilityPlan.deadlineMs },
          agentSdkTraceId: assignedTraceId,
          tracePolicy,
          capabilityPlan,
          inputAssets,
        });
        if (options.taskClaim) {
          markTaskAttemptProviderDispatched(db, options.taskClaim, {
            modelCallId: dispatchCall.id,
            provider: AGENTS_SDK_PROVIDER,
            model: requestBody.model,
            traceId: assignedTraceId,
          });
        }
        if (typeof options.onLifecycleEvent === "function") {
          options.onLifecycleEvent({
            type: "provider_dispatch",
            title: "Contacting OpenAI",
            detail: `${agentDefinition.name} sent the approved, capped request to OpenAI.`,
            metadata: {
              modelCallId: dispatchCall.id,
              provider: AGENTS_SDK_PROVIDER,
              model: requestBody.model,
              traceId: assignedTraceId,
            },
          });
        }
      },
    });
    result = sdkRun.result;
    traceId = sdkRun.traceId;
  } catch (error) {
    const dispatched = Boolean(dispatchCall);
    if (error.outcomeUnknown === undefined) error.outcomeUnknown = dispatched && error.providerCallOccurred !== false;
    if (error.providerCallOccurred === undefined) error.providerCallOccurred = dispatched;
    if (!error.providerDispatchStatus) error.providerDispatchStatus = error.outcomeUnknown ? "outcome_unknown" : "not_dispatched";
    const providerResponseReceived = error.providerResponseReceived === true;
    const definiteProviderRejection = error.definiteProviderRejection === true;
    const pricedWorstCaseCents = Math.min(
      approvedCapCents,
      Math.max(
        0,
        Number(
          task.payload?.liveSpendRequest?.pricedWorstCaseCostCents
          || task.payload?.liveSpendRequest?.executionDescriptor?.worstCaseCost?.amountCents
          || approvedCapCents,
        ),
      ),
    );
    if (providerResponseReceived && !definiteProviderRejection) {
      error.outcomeUnknown = false;
      error.needsAttention = true;
      error.errorKind = error.errorKind || "provider_output_invalid";
      error.incurredEstimateCents = pricedWorstCaseCents;
    }
    traceId = error.agentSdkTraceId || null;
    error.agentRunId = options.agentRunId || null;
    error.taskAttemptId = options.taskClaim?.attemptId || null;
    error.modelCallId = dispatchCall?.id || error.modelCallId || null;
    for (const invocation of toolInvocations) {
      recordAgentToolObservation(db, invocation.gate.id, {
        attemptId: options.taskClaim?.attemptId || null,
        status: definiteProviderRejection ? "failed" : error.outcomeUnknown === true ? "unknown" : "missing",
        toolName: invocation.spec.sdkName,
        toolId: invocation.spec.toolId,
        activity: null,
        outputSummary: definiteProviderRejection
          ? `${invocation.spec.sdkName} did not run because OpenAI definitively rejected the request before model or tool execution.`
          : error.outcomeUnknown === true
          ? `${invocation.spec.sdkName} was approved, but provider activity is unknown because the provider outcome is unresolved.`
          : `${invocation.spec.sdkName} was approved, but no matching provider activity was observed before the run failed.`,
      });
    }
    recordLiveWorkerFailureCost(db, task, error);
    const failedCall = recordLiveWorkerModelCall(
      db,
      task,
      null,
      definiteProviderRejection ? 0 : providerResponseReceived ? pricedWorstCaseCents : approvedCapCents,
      requestBody.model,
      "failed",
      {
      modelCallId: dispatchCall?.id,
      reservedCostCents: approvedCapCents,
      provider: AGENTS_SDK_PROVIDER,
      sdkRunner: true,
      agentRunId: options.agentRunId || null,
      taskAttemptId: options.taskClaim?.attemptId || null,
      agentSdkTraceId: traceId,
      error: error.message,
      outcomeUnknown: error.outcomeUnknown === true,
      providerResponseReceived,
      definiteProviderRejection,
      providerRequestId: error.providerRequestId || error.requestID || null,
      httpStatus: error.httpStatus || error.status || null,
      errorKind: error.errorKind
        || (error.outcomeUnknown === true ? "provider_outcome_unknown" : "failed_before_provider_dispatch"),
      providerDispatchStatus: error.providerDispatchStatus,
      tracePolicy,
      inputAssets,
      },
    );
    error.modelCallId = failedCall.id;
    error.providerReceipt = {
      modelCallId: failedCall.id,
      providerRequestId: error.providerRequestId || error.requestID || null,
      provider: AGENTS_SDK_PROVIDER,
      status: error.providerDispatchStatus,
      traceId,
      deadlineMs: capabilityPlan.deadlineMs,
    };
    error.incurredEstimateCents = Math.max(0, Number(error.incurredEstimateCents || 0));
    insertEvent(db, {
      level: "error",
      actor: "agent-runtime",
      type: "live_ai_worker.failed",
      entityType: "task",
      entityId: task.id,
      message: `Agents SDK worker failed before usable output was captured: ${error.message}`,
      metadata: {
        workflowId: task.workflow_id,
        taskId: task.id,
        modelCallId: failedCall.id,
        provider: AGENTS_SDK_PROVIDER,
        agentSdkTraceId: traceId,
        outcomeUnknown: error.outcomeUnknown === true,
        providerResponseReceived,
        providerDispatchStatus: error.providerDispatchStatus,
      },
    });
    throw error;
  }

  const toolActivity = extractAgentsSdkToolActivity(result);
  const sdkItemSummary = summarizeAgentsSdkResult(result);
  const responseId = sdkResponseId(result) || `agents_sdk_${randomId()}`;
  const cumulativeUsage = sdkUsage(result);
  const usage = sdkUsageDelta(db, cumulativeUsage, resumeSelection);
  const pricingEstimate = sdkPricingEstimate(requestBody.model, usage, approvedCapCents, toolActivity, capabilityPlan);
  const estimateCents = pricingEstimate.amountCents;
  const providerCall = recordLiveWorkerModelCall(db, task, { id: responseId, usage, output: [] }, estimateCents, requestBody.model, "provider_completed", {
    modelCallId: dispatchCall.id,
    provider: AGENTS_SDK_PROVIDER,
    sdkRunner: true,
    agentRunId: options.agentRunId || null,
    taskAttemptId: options.taskClaim?.attemptId || null,
    agentSdkTraceId: traceId,
    rawResponseCount: Array.isArray(result.rawResponses) ? result.rawResponses.length : 0,
    sdkItemSummary,
    cumulativeUsage,
    reservedCostCents: approvedCapCents,
    pricingEstimate,
    tracePolicy,
    capabilityPlan,
    toolActivity,
    inputAssets,
    providerReceiptRecordedAt: now(),
  });
  recordLiveWorkerCost(db, task, estimateCents, { id: responseId }, {
    provider: AGENTS_SDK_PROVIDER,
    model: requestBody.model,
    modelCallId: providerCall.id,
    agentRunId: options.agentRunId || null,
    taskAttemptId: options.taskClaim?.attemptId || null,
    sdkRunner: true,
    agentSdkTraceId: traceId,
    approvedCapCents,
    pricingEstimate,
    tracePolicy,
    capabilityPlan,
    toolActivity,
    inputAssets,
  });
  const providerReceipt = {
    modelCallId: providerCall.id,
    providerRequestId: responseId,
    provider: AGENTS_SDK_PROVIDER,
    status: "completed",
    traceId,
    incurredEstimateCents: estimateCents,
    deadlineMs: capabilityPlan.deadlineMs,
  };
  let sdkResearch = null;
  try {
  const interruptions = sdkInterruptionDetails(result);
  if (interruptions.length) {
    const interruption = interruptions[0];
    const interruptedSpec = capabilityPlan.specs.find((spec) => [spec.sdkName, spec.toolId].includes(interruption.toolName));
    const toolId = interruptedSpec?.toolId || interruption.toolName;
    if (!toolId || !interruption.serializedRunState) {
      const error = new Error("The Agents SDK paused, but its tool identity or resumable state was missing.");
      error.agentSdkTraceId = traceId;
      error.outcomeUnknown = false;
      throw error;
    }
    sdkResearch = persistAgentsSdkResearchEvidence(db, {
      task,
      runId: options.agentRunId,
      attemptId: options.taskClaim?.attemptId || null,
      modelCallId: providerCall.id,
      responseId,
      traceId,
      toolActivity,
    });
    const pausedCall = recordLiveWorkerModelCall(db, task, { id: responseId, usage, output: [] }, estimateCents, requestBody.model, "waiting_approval", {
      modelCallId: providerCall.id,
      provider: AGENTS_SDK_PROVIDER,
      sdkRunner: true,
      agentRunId: options.agentRunId || null,
      taskAttemptId: options.taskClaim?.attemptId || null,
      agentSdkTraceId: traceId,
      rawResponseCount: Array.isArray(result.rawResponses) ? result.rawResponses.length : 0,
      sdkItemSummary,
      cumulativeUsage,
      interruptionCount: interruptions.length,
      reservedCostCents: approvedCapCents,
      pricingEstimate,
      tracePolicy,
      capabilityPlan,
      toolActivity,
      sdkResearch,
      inputAssets,
      outcomeUnknown: false,
    });
    for (const invocation of toolInvocations) {
      const interruptedInvocation = invocation.spec === interruptedSpec;
      recordAgentToolObservation(db, invocation.gate.id, {
        attemptId: options.taskClaim?.attemptId || null,
        status: interruptedInvocation ? "interrupted" : "missing",
        toolName: invocation.spec.sdkName,
        toolId: invocation.spec.toolId,
        activity: interruptedInvocation ? {
          callId: interruption.callId || null,
          toolName: interruption.toolName || null,
          arguments: interruption.arguments || null,
          status: "waiting_approval",
        } : null,
        outputSummary: interruptedInvocation
          ? `${invocation.spec.sdkName} reached provider approval interruption ${interruption.callId || "without a call id"}; it has not completed.`
          : `${invocation.spec.sdkName} was approved, but no matching provider activity was observed before the SDK run paused.`,
      });
    }
    const sdkRunStateHash = crypto.createHash("sha256").update(interruption.serializedRunState).digest("hex");
    const gate = requestAgentToolUse(db, {
      agentId: agentDefinition.id,
      agentName: agentDefinition.name,
      runId: options.agentRunId || null,
      attemptId: options.taskClaim?.attemptId || null,
      task,
      toolId,
      mode: "live",
      ignoreTaskApproval: true,
      reason: `Approve or reject the exact paused ${interruption.toolName || toolId} call before the same Agents SDK run resumes.`,
      inputSummary: `${interruption.toolName || toolId} call ${interruption.callId || "without an id"}: ${String(interruption.arguments || "No arguments captured.").slice(0, 500)}`,
      toolArguments: interruption.arguments || {},
      effects: [],
      callId: interruption.callId || null,
      resumeStateHash: sdkRunStateHash,
      metadata: {
        sdkRunState: interruption.serializedRunState,
        sdkRunStateHash,
        sdkInterruptionCallId: interruption.callId,
        sdkInterruptionArguments: interruption.arguments,
        parentApprovalId: task.approval_id || task.payload?.liveSpendRequest?.approvalId || null,
        partialModelCallId: pausedCall.id,
        providerResponseId: responseId,
        agentSdkTraceId: traceId,
      },
    });
    if (!gate.approvalRequired) {
      const error = new Error(`The paused SDK tool ${toolId} did not produce a Pantheon approval interruption.`);
      error.agentSdkTraceId = traceId;
      error.outcomeUnknown = false;
      throw error;
    }
    insertEvent(db, {
      level: "warn",
      actor: "agent-runtime",
      type: "live_ai_worker.paused_for_tool_approval",
      entityType: "task",
      entityId: task.id,
      message: `${agentDefinition.name} paused before ${toolId}; the same SDK run is stored for an operator decision.`,
      metadata: { approvalId: gate.approvalId, invocationId: gate.id, toolId, responseId, traceId, sdkRunStateHash, incurredEstimateCents: estimateCents },
    });
    const error = new AgentToolApprovalRequiredError(gate, {
      agentId: agentDefinition.id,
      runId: options.agentRunId || null,
      task,
      toolId,
      providerCallOccurred: true,
      incurredEstimateCents: estimateCents,
      providerRequestId: responseId,
      agentSdkTraceId: traceId,
    });
    error.outcomeUnknown = false;
    error.modelCallId = pausedCall.id;
    throw error;
  }

  const generatedAssets = persistGeneratedAssets(db, task, capabilityPlan, result);
  const rawText = sdkOutputText(result.finalOutput);
  const generatedFiles = await persistGeneratedProductFiles(db, task, capabilityPlan, result);
  if (generatedFiles?.sourceType === "pantheon-local-digital-product-factory-v1") {
    toolActivity.push({
      id: `local_product_factory_${safeId(task.id)}`,
      type: "product_file_factory",
      status: "completed",
      local: true,
      renderer: generatedFiles.sourceType,
      fileCount: generatedFiles.files.length,
      previewCount: generatedFiles.previews.length,
    });
  }
  const missingProviderTools = [];
  for (const invocation of toolInvocations) {
    const observed = invocation.spec.kind === "model_input"
      ? { type: invocation.spec.sdkName, status: "completed", assets: inputAssets }
      : toolActivity.find((item) => item.type === invocation.spec.sdkName);
    recordAgentToolObservation(db, invocation.gate.id, {
      attemptId: options.taskClaim?.attemptId || null,
      status: observed ? (observed.status === "failed" ? "failed" : "completed") : "missing",
      toolName: invocation.spec.sdkName,
      toolId: invocation.spec.toolId,
      activity: observed || null,
      limits: {
        maxToolCalls: capabilityPlan.maxToolCalls,
        deadlineMs: capabilityPlan.deadlineMs,
        approvedCostCapCents: capabilityPlan.approvedCostCapCents,
      },
      outputSummary: observed
        ? invocation.spec.kind === "model_input"
          ? `${inputAssets.length} exact approved visual asset${inputAssets.length === 1 ? " was" : "s were"} supplied for model review; hashes and limits were recorded locally.`
          : invocation.spec.kind === "runtime_transform"
            ? "Pantheon's approved local file factory rendered and validated the exact Luna product blueprint."
          : `${invocation.spec.sdkName} completed; provider activity and provenance were recorded for review.`
        : `${invocation.spec.sdkName} was approved but no matching provider tool-call item was returned. Review the trace before accepting the run.`,
    });
    if (!observed && invocation.spec.kind === "hosted_tool") missingProviderTools.push(invocation.spec.sdkName);
  }
  sdkResearch = persistAgentsSdkResearchEvidence(db, {
    task,
    runId: options.agentRunId,
    attemptId: options.taskClaim?.attemptId || null,
    modelCallId: providerCall.id,
    responseId,
    traceId,
    toolActivity,
  });
  if (missingProviderTools.length) {
    const error = new Error(`Approved provider tool activity was missing for: ${missingProviderTools.join(", ")}.`);
    error.errorKind = "approved_provider_tool_activity_missing";
    error.missingProviderTools = missingProviderTools;
    throw error;
  }

  const deterministicProductFileResult = usesDeterministicProductFileResult(agentDefinition, capabilityPlan);
  let acceptedFinalOutput = result.finalOutput;
  if (deterministicProductFileResult) {
    acceptedFinalOutput = deterministicProductBuilderResult(task, generatedFiles);
  } else if (!result.finalOutput || typeof result.finalOutput !== "object" || Array.isArray(result.finalOutput)) {
    const error = new Error("The Agents SDK worker returned output that did not match the required structured format.");
    error.errorKind = "malformed_structured_output";
    throw error;
  }
  const roleOutput = normalizeWorkerOutput(
    agentDefinition.id,
    acceptedFinalOutput,
    agentDefinition.name,
  );
  const output = normalizeOutput(roleOutput, rawText);
  output.roleOutput = roleOutput?.roleOutput || null;
  const responseLike = {
    id: responseId,
    usage,
    output: [],
  };
  const modelCall = recordLiveWorkerModelCall(db, task, responseLike, estimateCents, requestBody.model, "completed", {
    modelCallId: providerCall.id,
    provider: AGENTS_SDK_PROVIDER,
    sdkRunner: true,
    agentRunId: options.agentRunId || null,
    taskAttemptId: options.taskClaim?.attemptId || null,
    agentSdkTraceId: traceId,
    rawResponseCount: Array.isArray(result.rawResponses) ? result.rawResponses.length : 0,
    sdkItemSummary,
    cumulativeUsage,
    interruptionCount: interruptions.length,
    finalAgent: result.lastAgent?.name || agentDefinition.name,
    reservedCostCents: approvedCapCents,
    pricingEstimate,
    tracePolicy,
    capabilityPlan,
    toolActivity,
    inputAssets,
    generatedAssets,
    generatedFiles,
    sdkResearch,
    reason: capabilityPlan.requestedTools.length
      ? "Live AI worker used only the exact approved SDK capability; no publishing, contact, account action, legal decision, or money movement was exposed."
      : "Live AI worker used the OpenAI Agents SDK runner after approval; no external tools or side effects were exposed.",
  });

  insertEvent(db, {
    actor: "agent-runtime",
    type: "live_ai_worker.completed",
    entityType: "task",
    entityId: task.id,
    message: `Agents SDK worker completed ${task.title} with a capped model call.`,
    metadata: {
      workflowId: task.workflow_id,
      taskId: task.id,
      modelCallId: modelCall.id,
      estimatedCostCents: estimateCents,
      approvedCapCents,
      responseId,
      agentSdkTraceId: traceId,
      provider: AGENTS_SDK_PROVIDER,
      tracePolicy,
      capabilityPlan,
      toolActivity,
      sdkResearch,
      inputAssets,
      generatedAssets,
      generatedFiles,
    },
  });

  return {
    id: responseId,
    mode: AGENTS_SDK_PROVIDER,
    provider: AGENTS_SDK_PROVIDER,
    model: requestBody.model,
    status: "completed",
    actualCents: 0,
    incurredEstimateCents: estimateCents,
    reconciledCostCents: 0,
    costStatus: "incurred_estimate",
    exactBillingPending: true,
    modelCall,
    providerReceipt,
    output: {
      heading: output.heading,
      summary: output.summary,
      evidence: [
        deterministicProductFileResult
          ? "The approved Agents SDK worker returned real product files that Pantheon downloaded and validated against the exact manifest."
          : "The approved Agents SDK worker returned a structured specialist recommendation.",
        ...output.evidence,
      ],
      details: {
        "Money move": output.moneyMove,
        "Expected upside": output.expectedUpside,
        "Cost/risk": output.costRisk,
        "Operator decision": output.operatorDecision,
        Assumptions: output.assumptions.join("; ") || "None stated.",
      },
      risks: output.risks,
      nextAction: output.nextAction,
      confidence: output.confidence,
      liveEvidence: toolActivity.some((item) => item.type === "web_search" && item.sources?.length),
      modelGenerated: true,
      operatorDecision: output.operatorDecision,
      businessDecision: output.businessDecision,
      roleOutput: output.roleOutput,
      toolActivity,
      sdkResearch,
      inputAssets,
      generatedAssets,
      generatedFiles,
      pilotRecommendation: {
        evidence: output.evidence,
        counterevidence: output.counterevidence,
        assumptions: output.assumptions,
        priceChannelHypothesis: output.priceChannelHypothesis,
        smallestTest: output.smallestTest,
        metric: output.metric,
        killRule: output.killRule,
        confidence: output.confidence,
        risks: output.risks,
        sources: toolActivity.flatMap((item) => item.sources || []),
      },
    },
    raw: {
      responseId,
      traceId,
      sdkRunner: true,
      provider: AGENTS_SDK_PROVIDER,
      structuredOutput: !deterministicProductFileResult
        && Boolean(result.finalOutput && typeof result.finalOutput === "object"),
      deterministicProductFileResult,
      rawResponseCount: Array.isArray(result.rawResponses) ? result.rawResponses.length : 0,
      sdkItemSummary,
      cumulativeUsage,
      interruptions: Array.isArray(result.interruptions) ? result.interruptions.length : 0,
      usage,
      pricingEstimate,
      tracePolicy,
      capabilityPlan,
      toolActivity,
      sdkResearch,
      inputAssets,
      generatedAssets,
      toolInvocations: toolInvocations.map((item) => ({ id: item.gate.id, toolId: item.spec.toolId, sdkName: item.spec.sdkName })),
    },
  };
  } catch (error) {
    const localStructuredOutput = result?.finalOutput
      && typeof result.finalOutput === "object"
      && !Array.isArray(result.finalOutput)
      ? result.finalOutput
      : null;
    error.providerCallOccurred = true;
    error.providerResponseReceived = true;
    error.incurredEstimateCents = Number(error.incurredEstimateCents || estimateCents);
    error.providerRequestId = error.providerRequestId || responseId;
    error.modelCallId = error.modelCallId || providerCall.id;
    error.agentSdkTraceId = error.agentSdkTraceId || traceId;
    error.providerReceipt = error.providerReceipt || providerReceipt;
    error.localStructuredOutput = error.localStructuredOutput || localStructuredOutput;
    if (!error.agentToolApprovalRequired) {
      recordLiveWorkerFailureCost(db, task, error);
      error.outcomeUnknown = false;
      error.needsAttention = true;
      error.providerDispatchStatus = "completed";
      error.errorKind = error.errorKind || "local_processing_after_provider_success";
      recordLiveWorkerModelCall(db, task, { id: responseId, usage, output: [] }, estimateCents, requestBody.model, "needs_attention", {
        modelCallId: providerCall.id,
        provider: AGENTS_SDK_PROVIDER,
        sdkRunner: true,
        agentRunId: options.agentRunId || null,
        taskAttemptId: options.taskClaim?.attemptId || null,
        agentSdkTraceId: traceId,
        rawResponseCount: Array.isArray(result.rawResponses) ? result.rawResponses.length : 0,
        sdkItemSummary,
        error: error.message,
        errorKind: error.errorKind,
        providerReceipt,
        pricingEstimate,
        tracePolicy,
        capabilityPlan,
        toolActivity,
        inputAssets,
        localStructuredOutput,
      });
      insertEvent(db, {
        level: "error",
        actor: "agent-runtime",
        type: "live_ai_worker.local_processing_needs_attention",
        entityType: "task",
        entityId: task.id,
        message: "The provider call completed, but Pantheon could not finish local processing. The receipt and incurred estimate were retained.",
        metadata: { ...providerReceipt, error: error.message },
      });
    }
    throw error;
  }
}

async function runAgentRuntimeTask(db, task, agentDefinition, policy, options = {}) {
  const approvedProvider = task.payload?.liveSpendRequest?.provider || null;
  const provider = options.provider
    || approvedProvider
    || environmentValue("agentRuntimeProvider")
    || CONFIG.liveModelProvider
    || AGENTS_SDK_PROVIDER;
  if (approvedProvider && options.provider && options.provider !== approvedProvider) {
    throw new Error(`The requested runtime provider does not match the approved provider ${approvedProvider}.`);
  }
  if (provider === LIVE_AI_WORKER_PROVIDER || provider === "responses") {
    const result = await runLiveAiWorkerTask(db, task, agentDefinition, policy, options);
    return {
      ...result,
      runtimeProvider: LIVE_AI_WORKER_PROVIDER,
      primaryProvider: AGENTS_SDK_PROVIDER,
    };
  }
  if (provider === AGENTS_SDK_PROVIDER) {
    return runAgentsSdkWorkerTask(db, task, agentDefinition, policy, options);
  }
  throw new Error(`Unsupported agent runtime provider: ${provider}.`);
}

function __setAgentRuntimeSdkRunnerForTests(runner) {
  testSdkRunner = runner;
}

function __setContainerFileDownloaderForTests(downloader) {
  testContainerFileDownloader = downloader;
}

function __setDigitalProductFactoryForTests(factory) {
  testDigitalProductFactory = factory;
}

module.exports = {
  AGENTS_SDK_PROVIDER,
  PRODUCT_MANIFEST_SCHEMA,
  __setAgentRuntimeSdkRunnerForTests,
  __setContainerFileDownloaderForTests,
  __setDigitalProductFactoryForTests,
  approveSelectedSdkInterruption,
  demandValidatorPilotOutputSchema,
  getApprovedSdkResumeState,
  getApprovedSdkResumeSelection,
  getAgentRuntimeReadiness,
  isAgentRuntimeSdkAvailable,
  renderRetainedProductBuilderOutput,
  refreshLocalDigitalProductFiles,
  refreshLocalStorefrontCover,
  runAgentRuntimeTask,
  runAgentsSdkWorkerTask,
  zodOutputSchema,
};
