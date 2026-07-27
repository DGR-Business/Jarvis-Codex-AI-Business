const { environmentValue } = require("../adapters/pantheon-environment");

const MODEL_PRICING_USD_PER_MILLION = {
  "gpt-5.6-luna": {
    input: 1,
    cachedInput: 0.1,
    cacheWriteInput: 1.25,
    output: 6,
    maxInputTokens: 922000,
    maxOutputTokens: 128000,
    longContextThresholdTokens: 272000,
    longContextInputMultiplier: 2,
    longContextOutputMultiplier: 1.5,
    source: "https://developers.openai.com/api/docs/pricing",
    checkedAt: "2026-07-17",
  },
  "gpt-5.6-terra": {
    input: 2.5,
    cachedInput: 0.25,
    cacheWriteInput: 3.125,
    output: 15,
    maxInputTokens: 922000,
    maxOutputTokens: 128000,
    longContextThresholdTokens: 272000,
    longContextInputMultiplier: 2,
    longContextOutputMultiplier: 1.5,
    source: "https://developers.openai.com/api/docs/pricing",
    checkedAt: "2026-07-17",
  },
  "gpt-5.6-sol": {
    input: 5,
    cachedInput: 0.5,
    cacheWriteInput: 6.25,
    output: 30,
    maxInputTokens: 922000,
    maxOutputTokens: 128000,
    longContextThresholdTokens: 272000,
    longContextInputMultiplier: 2,
    longContextOutputMultiplier: 1.5,
    source: "https://developers.openai.com/api/docs/pricing",
    checkedAt: "2026-07-17",
  },
  "gpt-5.5": {
    input: 5,
    cachedInput: 0.5,
    cacheWriteInput: 6.25,
    output: 30,
    maxInputTokens: 922000,
    maxOutputTokens: 128000,
    longContextThresholdTokens: 272000,
    longContextInputMultiplier: 2,
    longContextOutputMultiplier: 1.5,
    source: "https://developers.openai.com/api/docs/pricing",
    checkedAt: "2026-07-17",
  },
};

const MODEL_PRICING_ALIASES = {
  "gpt-5.6": "gpt-5.6-sol",
};

const TOOL_PRICING_USD_PER_THOUSAND_CALLS = {
  web_search: {
    usd: 10,
    source: "https://developers.openai.com/api/docs/pricing",
    checkedAt: "2026-07-17",
  },
  code_interpreter: {
    usd: 30,
    source: "https://developers.openai.com/api/docs/pricing#container-usage-pricing",
    checkedAt: "2026-07-18",
    note: "Conservative 1 GB container-session allowance expressed per 1,000 calls.",
  },
};

const IMAGE_GENERATION_USD_PER_OUTPUT = {
  "1024x1024": { low: 0.006, medium: 0.053, high: 0.211 },
  "1024x1536": { low: 0.005, medium: 0.041, high: 0.165 },
  "1536x1024": { low: 0.005, medium: 0.041, high: 0.165 },
};

const IMAGE_GENERATION_PRICING = {
  model: "gpt-image-2",
  source: "https://developers.openai.com/api/docs/guides/image-generation#cost-and-latency",
  checkedAt: "2026-07-17",
};

const CONSERVATIVE_AUD_PER_USD = 2;
const CONTAINER_SESSION_USD = Object.freeze({
  "1g": 0.03,
  "4g": 0.12,
  "16g": 0.48,
  "64g": 1.92,
});

function positiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function modelPricing(model) {
  const name = String(model || "").trim();
  const directPricingModel = MODEL_PRICING_ALIASES[name] || name;
  if (MODEL_PRICING_USD_PER_MILLION[directPricingModel]) {
    return { model: name, pricingModel: directPricingModel, pricing: MODEL_PRICING_USD_PER_MILLION[directPricingModel] };
  }
  for (const pricingModel of Object.keys(MODEL_PRICING_USD_PER_MILLION).sort((a, b) => b.length - a.length)) {
    if (new RegExp(`^${pricingModel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}-\\d{4}-\\d{2}-\\d{2}$`).test(name)) {
      return { model: name, pricingModel, pricing: MODEL_PRICING_USD_PER_MILLION[pricingModel] };
    }
  }
  return null;
}

function estimateInputTokensUpperBound(value, overheadTokens = 0) {
  const serialized = typeof value === "string" ? value : JSON.stringify(value ?? null);
  return Buffer.byteLength(serialized, "utf8") + Math.max(0, Math.ceil(Number(overheadTokens || 0)));
}

function normalizedTools(tools) {
  const aliases = {
    research_adapter: "web_search",
    live_web_with_approval: "web_search",
    web_search: "web_search",
    image_generation_spend: "image_generation",
    image_generation: "image_generation",
    product_file_factory: "",
    code_interpreter: "code_interpreter",
    visual_asset_review: "",
  };
  return [...new Set((Array.isArray(tools) ? tools : []).map((tool) => {
    const id = typeof tool === "string" ? tool : tool?.id || tool?.type || tool?.toolId;
    const key = String(id || "").trim();
    return Object.hasOwn(aliases, key) ? aliases[key] : key;
  }).filter(Boolean))];
}

function requestedTools(tools) {
  return [...new Set((Array.isArray(tools) ? tools : []).map((tool) => {
    const id = typeof tool === "string" ? tool : tool?.id || tool?.type || tool?.toolId;
    return String(id || "").trim();
  }).filter(Boolean))];
}

function imageGenerationPrice(input = {}) {
  const toolArguments = input.toolArguments || {};
  const requested = toolArguments.image_generation_spend
    || toolArguments.image_generation
    || toolArguments;
  const size = String(requested.size || "1024x1024");
  const quality = String(requested.quality || "low");
  const usd = IMAGE_GENERATION_USD_PER_OUTPUT[size]?.[quality];
  if (!Number.isFinite(usd)) {
    throw new Error(`Live execution is blocked because GPT Image pricing is not registered for ${size} at ${quality} quality.`);
  }
  return {
    usd,
    size,
    quality,
    ...IMAGE_GENERATION_PRICING,
  };
}

function runtimeAudPerUsd() {
  return positiveNumber(environmentValue("apiCreditAudPerUsd"));
}

function estimateObservedHostedToolUsageAud(activity = [], capabilityPlan = {}, options = {}) {
  const items = Array.isArray(activity) ? activity : [];
  const audPerUsd = positiveNumber(options.audPerUsd) || runtimeAudPerUsd();
  if (!items.length) {
    return {
      amountCents: 0,
      usdAmount: 0,
      audAmount: 0,
      callCount: 0,
      status: "not_applicable",
      exactBillingPending: false,
      details: [],
    };
  }

  const specs = Array.isArray(capabilityPlan?.specs) ? capabilityPlan.specs : [];
  const details = [];
  let usdAmount = 0;
  for (const item of items) {
    if (item?.type === "web_search") {
      const usd = TOOL_PRICING_USD_PER_THOUSAND_CALLS.web_search.usd / 1000;
      usdAmount += usd;
      details.push({ type: item.type, id: item.id || null, usd, pricingUnit: "call" });
      continue;
    }
    if (item?.type === "code_interpreter") {
      const spec = specs.find((candidate) => candidate.sdkName === "code_interpreter");
      const memoryLimit = String(spec?.options?.container?.memory_limit || "1g").toLowerCase();
      const usd = CONTAINER_SESSION_USD[memoryLimit];
      if (!Number.isFinite(usd)) {
        throw new Error(`Observed Code Interpreter cost cannot be priced for memory limit ${memoryLimit}.`);
      }
      usdAmount += usd;
      details.push({ type: item.type, id: item.id || null, usd, memoryLimit, pricingUnit: "container_session" });
      continue;
    }
    if (item?.type === "image_generation") {
      const spec = specs.find((candidate) => candidate.sdkName === "image_generation");
      const price = imageGenerationPrice({
        toolArguments: {
          image_generation: {
            size: spec?.options?.size,
            quality: spec?.options?.quality,
          },
        },
      });
      usdAmount += price.usd;
      details.push({
        type: item.type,
        id: item.id || null,
        usd: price.usd,
        size: price.size,
        quality: price.quality,
        pricingUnit: "output",
      });
      continue;
    }
    throw new Error(`Observed hosted tool cost is not registered: ${item?.type || "unknown"}.`);
  }

  if (!audPerUsd) {
    return {
      amountCents: null,
      usdAmount: Number(usdAmount.toFixed(8)),
      audAmount: null,
      audPerUsd: null,
      callCount: items.length,
      status: "exchange_rate_missing",
      exactBillingPending: true,
      details,
    };
  }
  const audAmount = usdAmount * audPerUsd;
  return {
    amountCents: Math.ceil(audAmount * 100),
    usdAmount: Number(usdAmount.toFixed(8)),
    audAmount: Number(audAmount.toFixed(8)),
    audPerUsd,
    callCount: items.length,
    status: "published_price_estimate",
    exactBillingPending: true,
    details,
  };
}

function worstCaseExecutionCostAud(input = {}) {
  const priced = modelPricing(input.model);
  if (!priced) throw new Error(`Live execution is blocked because model pricing is not registered: ${input.model || "not selected"}.`);

  const approvedTools = requestedTools(input.tools);
  const tools = normalizedTools(approvedTools);
  const unknownTools = tools.filter((tool) => (
    !TOOL_PRICING_USD_PER_THOUSAND_CALLS[tool] && tool !== "image_generation"
  ));
  if (unknownTools.length) {
    throw new Error(`Live execution is blocked because worst-case tool pricing is not registered: ${unknownTools.join(", ")}.`);
  }

  const maxTurns = Math.max(1, Math.floor(Number(input.maxTurns || 1)));
  const maxToolCalls = Math.max(0, Math.floor(Number(input.maxToolCalls || 0)));
  if (tools.length && maxToolCalls < 1) {
    throw new Error("Live execution is blocked because tools were requested without an explicit tool-call limit.");
  }
  if (!tools.length && maxToolCalls > 0) {
    throw new Error("Live execution is blocked because the tool-call limit is non-zero but no priced tool is approved.");
  }

  const maxOutputTokensPerTurn = Math.max(1, Math.ceil(Number(input.maxOutputTokens || 0)));
  if (maxOutputTokensPerTurn > priced.pricing.maxOutputTokens) {
    throw new Error(`Live execution output limit exceeds the registered ${priced.pricingModel} maximum.`);
  }
  const materializedInputTokens = estimateInputTokensUpperBound(input.materializedInput, input.inputOverheadTokens);
  const explicitInputLimit = positiveNumber(input.maxInputTokens);
  const maxInputTokensPerTurn = Math.ceil(explicitInputLimit || (tools.length ? priced.pricing.maxInputTokens : materializedInputTokens));
  if (maxInputTokensPerTurn < materializedInputTokens) {
    throw new Error(`Live execution input requires up to ${materializedInputTokens} tokens, above the approved ${maxInputTokensPerTurn}-token limit.`);
  }
  if (maxInputTokensPerTurn > priced.pricing.maxInputTokens) {
    throw new Error(`Live execution input limit exceeds the registered ${priced.pricingModel} maximum.`);
  }

  const audPerUsd = positiveNumber(input.audPerUsd)
    || runtimeAudPerUsd()
    || CONSERVATIVE_AUD_PER_USD;
  const totalInputTokens = maxInputTokensPerTurn * maxTurns;
  const totalOutputTokens = maxOutputTokensPerTurn * maxTurns;
  const longContext = maxInputTokensPerTurn > Number(priced.pricing.longContextThresholdTokens || Number.MAX_SAFE_INTEGER);
  const inputRate = priced.pricing.input * (longContext ? Number(priced.pricing.longContextInputMultiplier || 1) : 1);
  const outputRate = priced.pricing.output * (longContext ? Number(priced.pricing.longContextOutputMultiplier || 1) : 1);
  const tokenUsd = (totalInputTokens * inputRate + totalOutputTokens * outputRate) / 1_000_000;
  const imagePrice = tools.includes("image_generation") ? imageGenerationPrice(input) : null;
  const toolUsd = tools.reduce((sum, tool) => {
    if (tool === "image_generation") return sum + (maxToolCalls * imagePrice.usd);
    return sum + (maxToolCalls * TOOL_PRICING_USD_PER_THOUSAND_CALLS[tool].usd / 1000);
  }, 0);
  const usdAmount = tokenUsd + toolUsd;
  const audAmount = usdAmount * audPerUsd;

  return {
    amountCents: Math.max(1, Math.ceil(audAmount * 100)),
    currency: "AUD",
    method: "priced_worst_case_bound",
    model: priced.model,
    pricingModel: priced.pricingModel,
    materializedInputTokens,
    maxInputTokensPerTurn,
    maxOutputTokensPerTurn,
    maxTurns,
    totalInputTokens,
    totalOutputTokens,
    tools: approvedTools,
    pricingTools: tools,
    maxToolCalls,
    usdAmount: Number(usdAmount.toFixed(8)),
    audAmount: Number(audAmount.toFixed(8)),
    audPerUsd,
    exchangeRateSource: positiveNumber(input.audPerUsd)
      ? "request"
      : runtimeAudPerUsd()
        ? "runtime_accounting_rate"
        : "conservative_safety_bound",
    longContext,
    pricingUsdPerMillion: priced.pricing,
    toolPricingUsdPerThousandCalls: Object.fromEntries(tools.map((tool) => [tool, TOOL_PRICING_USD_PER_THOUSAND_CALLS[tool]])),
    imageGenerationPricing: imagePrice,
  };
}

function estimateModelUsageAud(model, usage = {}, options = {}) {
  const priced = modelPricing(model);
  const pricing = priced?.pricing;
  const fallbackCents = Math.max(0, Number(options.fallbackCents || 0));
  const audPerUsd = positiveNumber(options.audPerUsd)
    || runtimeAudPerUsd();
  const inputTokens = Math.max(0, Number(usage.input_tokens || 0));
  const outputTokens = Math.max(0, Number(usage.output_tokens || 0));
  const cachedInputTokens = Math.min(inputTokens, Math.max(0, Number(usage.cached_input_tokens || 0)));
  const cacheWriteInputTokens = Math.min(
    inputTokens - cachedInputTokens,
    Math.max(
      0,
      Number(
        usage.cache_write_input_tokens
        ?? usage.input_cache_write_tokens
        ?? usage.cacheWriteInputTokens
        ?? 0,
      ),
    ),
  );
  if (!pricing || !audPerUsd || inputTokens + outputTokens === 0) {
    return {
      amountCents: fallbackCents,
      method: "approved_cap_fallback",
      exactBillingPending: true,
      model,
    };
  }
  const uncachedInputTokens = inputTokens - cachedInputTokens - cacheWriteInputTokens;
  const usd = (
    uncachedInputTokens * pricing.input
    + cachedInputTokens * pricing.cachedInput
    + cacheWriteInputTokens * pricing.cacheWriteInput
    + outputTokens * pricing.output
  ) / 1_000_000;
  const aud = usd * audPerUsd;
  return {
    amountCents: Math.max(1, Math.ceil(aud * 100)),
    method: "published_token_price_converted_to_aud",
    exactBillingPending: true,
    model,
    inputTokens,
    cachedInputTokens,
    cacheWriteInputTokens,
    outputTokens,
    usdAmount: Number(usd.toFixed(8)),
    audAmount: Number(aud.toFixed(8)),
    audPerUsd,
    pricingUsdPerMillion: pricing,
  };
}

module.exports = {
  CONSERVATIVE_AUD_PER_USD,
  IMAGE_GENERATION_PRICING,
  IMAGE_GENERATION_USD_PER_OUTPUT,
  MODEL_PRICING_ALIASES,
  MODEL_PRICING_USD_PER_MILLION,
  TOOL_PRICING_USD_PER_THOUSAND_CALLS,
  estimateModelUsageAud,
  estimateObservedHostedToolUsageAud,
  estimateInputTokensUpperBound,
  modelPricing,
  worstCaseExecutionCostAud,
};
