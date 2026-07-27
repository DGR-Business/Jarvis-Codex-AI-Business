const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const CONFIG = require("../config");
const { get } = require("../db");

const SDK_CAPABILITY_SCHEMA = "jarvis_agents_sdk_capability_plan_v1";
const VISUAL_ASSET_BINDING_SCHEMA = "jarvis_visual_asset_binding_v1";
const DEFAULT_DEADLINE_MS = 60_000;
const MAX_VISUAL_ASSET_BYTES = 10 * 1024 * 1024;
const MAX_VISUAL_INPUT_BYTES = 20 * 1024 * 1024;

const IMAGE_MEDIA_TYPES = {
  ".gif": "image/gif",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

const CAPABILITIES = {
  research_adapter: {
    kind: "hosted_tool",
    sdkName: "web_search",
    workerIds: ["opportunity_scout", "demand_validator"],
    maxCostCents: 500,
    maxToolCalls: 6,
    maxTurns: 6,
    maxDeadlineMs: 120_000,
  },
  live_web_with_approval: {
    kind: "hosted_tool",
    sdkName: "web_search",
    workerIds: ["demand_validator"],
    maxCostCents: 200,
    maxToolCalls: 3,
    maxTurns: 4,
    maxDeadlineMs: 120_000,
  },
  image_generation_spend: {
    kind: "hosted_tool",
    sdkName: "image_generation",
    workerIds: ["product_builder"],
    maxCostCents: 100,
    maxToolCalls: 1,
    maxTurns: 2,
    maxDeadlineMs: 180_000,
  },
  product_file_factory: {
    kind: "runtime_transform",
    sdkName: "product_file_factory",
    workerIds: ["product_builder"],
    maxCostCents: 200,
    maxToolCalls: 0,
    maxTurns: 1,
    maxDeadlineMs: 180_000,
  },
  visual_asset_review: {
    kind: "model_input",
    sdkName: "image_understanding",
    workerIds: ["quality_reviewer"],
    maxCostCents: 100,
    maxToolCalls: 0,
    maxTurns: 1,
    maxDeadlineMs: 90_000,
  },
};

function integer(value, fallback, min, max) {
  const parsed = Number(value);
  const chosen = Number.isFinite(parsed) ? Math.round(parsed) : fallback;
  return Math.min(max, Math.max(min, chosen));
}

function uniqueList(value) {
  return [...new Set(Array.isArray(value) ? value.filter(Boolean).map(String) : [])];
}

function normalizeUserLocation(value) {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Web-search user location must be an approximate location object.");
  }
  if (value.type !== undefined && value.type !== "approximate") {
    throw new Error("Web-search user location type must be approximate.");
  }
  const location = { type: "approximate" };
  for (const field of ["city", "region", "timezone"]) {
    if (value[field] === undefined || value[field] === null || value[field] === "") continue;
    const normalized = String(value[field]).trim();
    if (!normalized || normalized.length > 100) {
      throw new Error(`Web-search user location ${field} must be a non-empty string of 100 characters or fewer.`);
    }
    location[field] = normalized;
  }
  if (value.country !== undefined && value.country !== null && value.country !== "") {
    const country = String(value.country).trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(country)) {
      throw new Error("Web-search user location country must be a two-letter ISO country code.");
    }
    location.country = country;
  }
  return location;
}

function requestFor(task) {
  return task.payload?.liveSpendRequest || {};
}

function assertNoExternalEffects(request) {
  const effects = uniqueList(request.effects);
  if (effects.length) {
    throw new Error("Agents SDK hosted-tool pilots cannot include publishing, contact, account, payment, or other external effects.");
  }
}

function capabilityOptions(toolId, request) {
  const args = request.toolArguments?.[toolId] || request.toolArguments || {};
  if (["research_adapter", "live_web_with_approval"].includes(toolId)) {
    const allowedDomains = uniqueList(args.allowedDomains).slice(0, 12);
    if (args.searchContextSize && args.searchContextSize !== "low") {
      throw new Error("The first live web capability is restricted to low search context until a larger context is separately priced and approved.");
    }
    return {
      searchContextSize: "low",
      externalWebAccess: true,
      allowedDomains,
      userLocation: normalizeUserLocation(args.userLocation),
    };
  }
  if (toolId === "image_generation_spend") {
    const quality = ["low", "medium", "high"].includes(args.quality) ? args.quality : "low";
    const size = ["1024x1024", "1024x1536", "1536x1024"].includes(args.size) ? args.size : "1024x1024";
    return {
      model: "gpt-image-2",
      quality,
      size,
      outputFormat: ["png", "jpeg", "webp"].includes(args.outputFormat) ? args.outputFormat : "png",
      background: "auto",
      moderation: "auto",
      partialImages: 0,
    };
  }
  if (toolId === "product_file_factory") return { renderer: "pantheon-local-digital-product-factory-v1" };
  if (toolId === "visual_asset_review") {
    const assetIds = uniqueList(args.assetIds || taskAssetIds(request)).slice(0, 4);
    if (!assetIds.length) throw new Error("Visual review requires one or more exact approved asset IDs.");
    return { assetIds, detail: ["low", "high", "auto"].includes(args.detail) ? args.detail : "high" };
  }
  return {};
}

function taskAssetIds(request) {
  return Array.isArray(request.parameters?.approvedAssetIds) ? request.parameters.approvedAssetIds : [];
}

function buildAgentsSdkCapabilityPlan(task, agentDefinition) {
  const request = requestFor(task);
  const requestedTools = uniqueList(request.tools);
  assertNoExternalEffects(request);

  const maxCostCents = integer(request.maxCostCents || request.estimatedCostCents || task.cost_budget_cents, 0, 0, 100_000);
  const specs = requestedTools.map((toolId) => {
    const capability = CAPABILITIES[toolId];
    if (!capability) throw new Error(`Agents SDK tool ${toolId} is not implemented by the runtime capability bridge.`);
    if (!capability.workerIds.includes(agentDefinition.id)) {
      throw new Error(`${toolId} is restricted to ${capability.workerIds.join(" or ")}; it cannot be attached to ${agentDefinition.id}.`);
    }
    if (!(agentDefinition.tools || []).includes(toolId)) {
      throw new Error(`${toolId} is not assigned to ${agentDefinition.name}.`);
    }
    if (maxCostCents > capability.maxCostCents) {
      throw new Error(`${toolId} is capped at A$${(capability.maxCostCents / 100).toFixed(2)} for its controlled pilot.`);
    }
    return {
      toolId,
      ...capability,
      options: capabilityOptions(toolId, request),
    };
  });

  const hosted = specs.filter((spec) => spec.kind === "hosted_tool");
  const configuredToolCalls = integer(request.maxToolCalls, hosted.length ? hosted[0].maxToolCalls : 0, 0, 20);
  const maxAllowedToolCalls = hosted.length ? Math.min(...hosted.map((spec) => spec.maxToolCalls)) : 0;
  if (configuredToolCalls > maxAllowedToolCalls) {
    throw new Error(`This controlled SDK capability permits at most ${maxAllowedToolCalls} hosted tool call${maxAllowedToolCalls === 1 ? "" : "s"}.`);
  }
  const maxAllowedTurns = specs.length ? Math.min(...specs.map((spec) => spec.maxTurns)) : 1;
  const maxTurns = integer(request.maxTurns, specs.length ? maxAllowedTurns : 1, 1, 20);
  if (maxTurns > maxAllowedTurns) throw new Error(`This controlled SDK capability permits at most ${maxAllowedTurns} turns.`);
  const maxDeadlineMs = specs.length ? Math.min(...specs.map((spec) => spec.maxDeadlineMs)) : DEFAULT_DEADLINE_MS;
  const deadlineMs = integer(request.deadlineMs, Math.min(DEFAULT_DEADLINE_MS, maxDeadlineMs), 5_000, maxDeadlineMs);

  return {
    schema: SDK_CAPABILITY_SCHEMA,
    workerId: agentDefinition.id,
    requestedTools,
    specs,
    hostedToolCount: hosted.length,
    maxToolCalls: configuredToolCalls,
    maxTurns,
    deadlineMs,
    toolChoice: hosted.length ? "required" : "none",
    parallelToolCalls: false,
    effects: [],
    approvedCostCapCents: maxCostCents,
  };
}

function pathWithin(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function approvedAssetPath(filePath) {
  if (!filePath) throw new Error("An approved visual asset has no local file.");
  const candidate = path.resolve(path.isAbsolute(filePath) ? filePath : path.join(CONFIG.rootDir, filePath));
  if (!fs.existsSync(candidate) || !fs.statSync(candidate).isFile()) {
    throw new Error("An approved visual asset file is missing.");
  }
  const realCandidate = fs.realpathSync(candidate);
  const allowedRoots = [CONFIG.rootDir, CONFIG.artifactRoot]
    .filter((root) => fs.existsSync(root))
    .map((root) => fs.realpathSync(root));
  if (!allowedRoots.some((root) => pathWithin(root, realCandidate))) {
    throw new Error("An approved visual asset is outside the Pantheon workspace and cannot be sent to the model.");
  }
  return realCandidate;
}

function loadVisualAssets(db, task, visualSpec) {
  const assets = [];
  let totalBytes = 0;
  for (const assetId of visualSpec.options.assetIds) {
    const deliverable = get(
      db,
      `SELECT id, human_name, format, file_path, metadata
       FROM deliverables WHERE id = ? AND workflow_id = ?`,
      [assetId, task.workflow_id],
    );
    if (!deliverable) throw new Error(`Approved visual asset ${assetId} does not belong to this workflow.`);
    const filePath = approvedAssetPath(deliverable.file_path);
    const mediaType = IMAGE_MEDIA_TYPES[path.extname(filePath).toLowerCase()];
    if (!mediaType) throw new Error(`Approved visual asset ${assetId} is not a supported image file.`);
    const bytes = fs.readFileSync(filePath);
    if (bytes.length > MAX_VISUAL_ASSET_BYTES) throw new Error(`Approved visual asset ${assetId} exceeds the 10 MB per-file limit.`);
    totalBytes += bytes.length;
    if (totalBytes > MAX_VISUAL_INPUT_BYTES) throw new Error("Approved visual assets exceed the 20 MB total input limit.");
    assets.push({
      id: deliverable.id,
      name: deliverable.human_name,
      mediaType,
      bytes,
      byteLength: bytes.length,
      sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
      detail: visualSpec.options.detail,
    });
  }
  return assets;
}

function visualBindingFromAssets(task, assets) {
  const binding = {
    schema: VISUAL_ASSET_BINDING_SCHEMA,
    taskId: task.id || null,
    workflowId: task.workflow_id || null,
    assets: assets.map((asset) => ({
      id: asset.id,
      mediaType: asset.mediaType,
      bytes: asset.byteLength,
      sha256: asset.sha256,
      detail: asset.detail,
    })),
  };
  return { ...binding, bindingHash: crypto.createHash("sha256").update(JSON.stringify(binding)).digest("hex") };
}

function buildVisualAssetApprovalBinding(db, task, plan) {
  const visualSpec = plan.specs.find((spec) => spec.kind === "model_input" && spec.sdkName === "image_understanding");
  if (!visualSpec) return null;
  return visualBindingFromAssets(task, loadVisualAssets(db, task, visualSpec));
}

function approvedVisualAssetBinding(task) {
  const request = requestFor(task);
  return request.parameters?.approvedAssetBinding
    || request.toolArguments?.visual_asset_review?.approvedAssetBinding
    || null;
}

function assertVisualBinding(task, actualBinding) {
  const approved = approvedVisualAssetBinding(task);
  if (!approved && task.approval_id) {
    throw new Error("Visual review approval is missing the exact asset byte hashes. Prepare a new approval before sending any image.");
  }
  if (!approved) return;
  const { bindingHash: approvedHash, ...approvedCore } = approved;
  const { bindingHash: actualHash, ...actualCore } = actualBinding;
  const expectedApprovedHash = crypto.createHash("sha256").update(JSON.stringify(approvedCore)).digest("hex");
  if (approved.schema !== VISUAL_ASSET_BINDING_SCHEMA || approvedHash !== expectedApprovedHash) {
    throw new Error("The approved visual-asset binding is invalid. Prepare a new approval before sending any image.");
  }
  if (approvedHash !== actualHash || JSON.stringify(approvedCore) !== JSON.stringify(actualCore)) {
    throw new Error("An approved visual asset changed after approval. Prepare a new approval for the current file bytes.");
  }
}

function buildAgentsSdkModelInput(db, task, textInput, plan) {
  const visualSpec = plan.specs.find((spec) => spec.kind === "model_input" && spec.sdkName === "image_understanding");
  if (!visualSpec) return { input: textInput, assets: [] };

  const loadedAssets = loadVisualAssets(db, task, visualSpec);
  const binding = visualBindingFromAssets(task, loadedAssets);
  assertVisualBinding(task, binding);
  const assets = [];
  const content = [{ type: "input_text", text: textInput }];
  for (const asset of loadedAssets) {
    content.push({
      type: "input_image",
      image: `data:${asset.mediaType};base64,${asset.bytes.toString("base64")}`,
      detail: asset.detail,
    });
    assets.push({
      id: asset.id,
      name: asset.name,
      mediaType: asset.mediaType,
      bytes: asset.byteLength,
      sha256: asset.sha256,
      detail: asset.detail,
    });
  }
  return {
    input: [{ type: "message", role: "user", content }],
    assets,
    binding,
  };
}

function materializeAgentsSdkTools(sdk, plan) {
  return plan.specs
    .filter((spec) => spec.kind === "hosted_tool")
    .map((spec) => {
      if (spec.sdkName === "web_search") {
        return sdk.webSearchTool({
          searchContextSize: spec.options.searchContextSize,
          externalWebAccess: spec.options.externalWebAccess,
          filters: spec.options.allowedDomains.length ? { allowedDomains: spec.options.allowedDomains } : undefined,
          userLocation: spec.options.userLocation,
        });
      }
      if (spec.sdkName === "image_generation") {
        return sdk.imageGenerationTool(spec.options);
      }
      if (spec.sdkName === "code_interpreter") {
        return sdk.codeInterpreterTool(spec.options);
      }
      throw new Error(`SDK hosted tool ${spec.sdkName} is not materialized.`);
    });
}

function collectOutputItems(result) {
  const items = [];
  for (const response of result?.rawResponses || []) {
    if (Array.isArray(response?.output)) items.push(...response.output);
  }
  if (Array.isArray(result?.output)) items.push(...result.output);
  for (const item of result?.newItems || []) {
    if (item?.rawItem) items.push(item.rawItem);
    else if (typeof item?.toJSON === "function") items.push(item.toJSON());
  }
  return items;
}

function providerActivityType(raw) {
  const candidates = [
    raw?.type,
    raw?.name,
    raw?.providerData?.type,
    raw?.providerData?.name,
  ].filter(Boolean).map(String);
  if (candidates.some((value) => value.includes("web_search"))) return "web_search";
  if (candidates.some((value) => value.includes("image_generation"))) return "image_generation";
  if (candidates.some((value) => value.includes("code_interpreter"))) return "code_interpreter";
  return null;
}

function summarizeAgentsSdkResult(result) {
  return collectOutputItems(result).slice(0, 50).map((item) => {
    const raw = item?.rawItem || item;
    return {
      id: raw?.id || raw?.call_id || raw?.callId || null,
      type: raw?.type || null,
      name: raw?.name || null,
      providerType: raw?.providerData?.type || null,
      activityType: providerActivityType(raw),
      status: raw?.status || null,
    };
  });
}

function webSources(item) {
  const sources = item?.action?.sources || item?.sources || item?.providerData?.action?.sources || [];
  return Array.isArray(sources)
    ? sources.slice(0, 50).map((source) => ({
      title: source.title || source.name || null,
      url: source.url || null,
      publisher: source.publisher || source.site_name || source.siteName || null,
      publishedAt: source.published_at || source.publishedAt || null,
      groundingType: "provider_search_source",
    })).filter((source) => source.url)
    : [];
}

function webQueries(item) {
  const action = item?.action || item?.providerData?.action || {};
  const values = [
    ...(Array.isArray(action.queries) ? action.queries : []),
    ...(Array.isArray(item?.queries) ? item.queries : []),
    action.query,
    item?.query,
  ];
  return [...new Set(values.filter(Boolean).map((value) => String(value).trim()).filter(Boolean))];
}

function outputCitationSources(items) {
  const sources = [];
  const seen = new Set();
  for (const item of items) {
    const raw = item?.rawItem || item;
    const content = Array.isArray(raw?.content) ? raw.content : [];
    for (const part of content) {
      for (const annotation of part?.annotations || []) {
        const citation = annotation?.url_citation || annotation?.urlCitation || annotation;
        const type = citation?.type || annotation?.type || "";
        const url = citation?.url || null;
        if (!url || (!String(type).includes("citation") && !/^https?:\/\//i.test(url))) continue;
        if (seen.has(url)) continue;
        seen.add(url);
        sources.push({
          title: citation.title || url,
          url,
          publisher: citation.publisher || null,
          publishedAt: citation.published_at || citation.publishedAt || null,
          groundingType: "output_url_citation",
        });
      }
    }
  }
  return sources;
}

function extractAgentsSdkToolActivity(result) {
  const activity = [];
  const seen = new Set();
  const outputItems = collectOutputItems(result);
  const citationSources = outputCitationSources(outputItems);
  for (const item of outputItems) {
    const raw = item?.rawItem || item;
    const type = providerActivityType(raw);
    if (!type) continue;
    const id = raw.id || raw.call_id || raw.callId || `${type}_${activity.length + 1}`;
    const key = `${type}:${id}`;
    if (seen.has(key)) continue;
    seen.add(key);

    if (type === "web_search") {
      const queries = webQueries(raw);
      activity.push({
        id,
        type: "web_search",
        status: raw.status || null,
        query: queries[0] || null,
        queries,
        sources: webSources(raw),
      });
      continue;
    }
    if (type === "image_generation") {
      const base64 = [raw.result, raw.output, raw.providerData?.result].find((value) => typeof value === "string") || null;
      const bytes = base64 ? Buffer.from(base64, "base64") : null;
      activity.push({
        id,
        type: "image_generation",
        status: raw.status || null,
        revisedPrompt: raw.revised_prompt || raw.revisedPrompt || null,
        assetBytesEstimate: bytes?.length || 0,
        assetSha256: bytes ? crypto.createHash("sha256").update(bytes).digest("hex") : null,
      });
      continue;
    }
    activity.push({
      id,
      type: "code_interpreter",
      status: raw.status || null,
      containerId: raw.container_id || raw.containerId || null,
    });
  }
  if (citationSources.length) {
    const search = activity.find((item) => item.type === "web_search");
    if (search) {
      const byUrl = new Map((search.sources || []).map((source) => [source.url, source]));
      for (const source of citationSources) {
        if (!byUrl.has(source.url)) byUrl.set(source.url, source);
      }
      search.sources = [...byUrl.values()];
    } else {
      activity.push({
        id: "web_search_citations",
        type: "web_search",
        status: "completed",
        query: null,
        queries: [],
        sources: citationSources,
      });
    }
  }
  return activity;
}

function extractGeneratedImages(result) {
  const images = [];
  const seen = new Set();
  for (const item of collectOutputItems(result)) {
    const raw = item?.rawItem || item;
    if (providerActivityType(raw) !== "image_generation") continue;
    const base64 = [raw.result, raw.output, raw.providerData?.result].find((value) => typeof value === "string");
    if (!base64) continue;
    const id = raw.id || raw.call_id || raw.callId || `image_${images.length + 1}`;
    const bytes = Buffer.from(base64, "base64");
    const hash = crypto.createHash("sha256").update(bytes).digest("hex");
    if (seen.has(hash)) continue;
    seen.add(hash);
    images.push({
      id,
      hash,
      revisedPrompt: raw.revised_prompt || raw.revisedPrompt || null,
      bytes,
    });
  }
  return images;
}

function extractContainerFileCitations(result) {
  const files = [];
  const seen = new Set();
  for (const item of collectOutputItems(result)) {
    const raw = item?.rawItem || item;
    const content = Array.isArray(raw?.content) ? raw.content : [];
    for (const part of content) {
      for (const annotation of part?.annotations || []) {
        const type = String(annotation?.type || "");
        if (type !== "container_file_citation") continue;
        const containerId = annotation.container_id || annotation.containerId || null;
        const fileId = annotation.file_id || annotation.fileId || null;
        if (!containerId || !fileId) continue;
        const key = `${containerId}:${fileId}`;
        if (seen.has(key)) continue;
        seen.add(key);
        files.push({
          containerId,
          fileId,
          filename: annotation.filename || annotation.name || fileId,
        });
      }
    }
  }
  return files;
}

function serializeSdkRunState(result) {
  if (!result?.state || typeof result.state.toString !== "function") return null;
  return result.state.toString({ includeTracingApiKey: false });
}

function sdkInterruptionDetails(result) {
  const serializedRunState = serializeSdkRunState(result);
  return (result?.interruptions || []).map((interruption) => {
    const raw = typeof interruption?.toJSON === "function" ? interruption.toJSON() : interruption;
    return {
      toolName: raw?.name || raw?.toolName || raw?.rawItem?.name || raw?.rawItem?.tool_name || null,
      callId: raw?.id || raw?.callId || raw?.rawItem?.call_id || raw?.rawItem?.id || null,
      arguments: raw?.arguments || raw?.rawItem?.arguments || null,
      serializedRunState,
    };
  });
}

module.exports = {
  CAPABILITIES,
  DEFAULT_DEADLINE_MS,
  SDK_CAPABILITY_SCHEMA,
  VISUAL_ASSET_BINDING_SCHEMA,
  buildAgentsSdkModelInput,
  buildAgentsSdkCapabilityPlan,
  buildVisualAssetApprovalBinding,
  extractAgentsSdkToolActivity,
  extractContainerFileCitations,
  extractGeneratedImages,
  materializeAgentsSdkTools,
  sdkInterruptionDetails,
  serializeSdkRunState,
  summarizeAgentsSdkResult,
};
