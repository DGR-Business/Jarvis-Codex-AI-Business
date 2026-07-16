const MODEL_PRICING_USD_PER_MILLION = {
  "gpt-5.6-terra": {
    input: 2.5,
    cachedInput: 0.25,
    output: 15,
    source: "https://developers.openai.com/api/docs/models/gpt-5.6-terra",
    checkedAt: "2026-07-16",
  },
};

function positiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function estimateModelUsageAud(model, usage = {}, options = {}) {
  const pricing = MODEL_PRICING_USD_PER_MILLION[model];
  const fallbackCents = Math.max(0, Number(options.fallbackCents || 0));
  const audPerUsd = positiveNumber(options.audPerUsd)
    || positiveNumber(process.env.JARVIS_API_CREDIT_AUD_PER_USD);
  const inputTokens = Math.max(0, Number(usage.input_tokens || 0));
  const outputTokens = Math.max(0, Number(usage.output_tokens || 0));
  const cachedInputTokens = Math.min(inputTokens, Math.max(0, Number(usage.cached_input_tokens || 0)));
  if (!pricing || !audPerUsd || inputTokens + outputTokens === 0) {
    return {
      amountCents: fallbackCents,
      method: "approved_cap_fallback",
      exactBillingPending: true,
      model,
    };
  }
  const uncachedInputTokens = inputTokens - cachedInputTokens;
  const usd = (
    uncachedInputTokens * pricing.input
    + cachedInputTokens * pricing.cachedInput
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
    outputTokens,
    usdAmount: Number(usd.toFixed(8)),
    audAmount: Number(aud.toFixed(8)),
    audPerUsd,
    pricingUsdPerMillion: pricing,
  };
}

module.exports = {
  MODEL_PRICING_USD_PER_MILLION,
  estimateModelUsageAud,
};
