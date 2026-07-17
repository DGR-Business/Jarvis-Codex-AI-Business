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
    workerId: "demand_validator",
    maxCostCents: 200,
    maxToolCalls: 3,
    maxTurns: 4,
    maxDeadlineMs: 120_000,
  },
  live_web_with_approval: {
    kind: "hosted_tool",
    sdkName: "web_search",
    workerId: "demand_validator",
    maxCostCents: 200,
    maxToolCalls: 3,
    maxTurns: 4,
    maxDeadlineMs: 120_000,
  },
  image_generation_spend: {
    kind: "hosted_tool",
    sdkName: "image_generation",
    workerId: "product_builder",
    maxCostCents: 100,
    maxToolCalls: 1,
    maxTurns: 2,
    maxDeadlineMs: 180_000,
  },
  visual_asset_review: {
    kind: "model_input",
    sdkName: "image_understanding",
    workerId: "quality_reviewer",
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
      userLocation: args.userLocation || undefined,
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
    if (capability.workerId !== agentDefinition.id) {
      throw new Error(`${toolId} is restricted to ${capability.workerId}; it cannot be attached to ${agentDefinition.id}.`);
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
    throw new Error("An approved visual asset is outside the Jarvis workspace and cannot be sent to the model.");
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

function webSources(item) {
  const sources = item?.action?.sources || item?.sources || item?.providerData?.action?.sources || [];
  return Array.isArray(sources)
    ? sources.slice(0, 20).map((source) => ({ title: source.title || null, url: source.url || null })).filter((source) => source.url)
    : [];
}

function extractAgentsSdkToolActivity(result) {
  const activity = [];
  const seen = new Set();
  for (const item of collectOutputItems(result)) {
    const raw = item?.rawItem || item;
    const type = raw?.type || raw?.providerData?.type || "";
    if (!String(type).includes("search") && !String(type).includes("image_generation") && !String(type).includes("code_interpreter")) continue;
    const id = raw.id || raw.call_id || raw.callId || `${type}_${activity.length + 1}`;
    const key = `${type}:${id}`;
    if (seen.has(key)) continue;
    seen.add(key);

    if (String(type).includes("web_search")) {
      activity.push({
        id,
        type: "web_search",
        status: raw.status || null,
        query: raw.action?.query || raw.query || null,
        sources: webSources(raw),
      });
      continue;
    }
    if (String(type).includes("image_generation")) {
      const base64 = typeof raw.result === "string" ? raw.result : null;
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
  return activity;
}

function extractGeneratedImages(result) {
  const images = [];
  const seen = new Set();
  for (const item of collectOutputItems(result)) {
    const raw = item?.rawItem || item;
    const type = raw?.type || raw?.providerData?.type || "";
    if (!String(type).includes("image_generation") || typeof raw.result !== "string") continue;
    const id = raw.id || raw.call_id || raw.callId || `image_${images.length + 1}`;
    const bytes = Buffer.from(raw.result, "base64");
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
  extractGeneratedImages,
  materializeAgentsSdkTools,
  sdkInterruptionDetails,
  serializeSdkRunState,
};
