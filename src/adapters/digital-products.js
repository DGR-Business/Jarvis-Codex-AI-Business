const { randomUUID } = require("node:crypto");

function buildDigitalProductDraft(workflow) {
  const products = workflow.metadata.products || [];
  return {
    provider: "digital-products",
    mode: "dry-run",
    externalId: `dry_digital_${randomUUID()}`,
    products: products.map((product) => ({
      sku: product.sku,
      product: product.product,
      status: "listing_plan_validated",
      estimatedProfitCents: product.marginCents || 0,
    })),
    checks: [
      "digital product pilot selected",
      "no marketplace listing created",
      "no paid asset generation started",
      "operator approval captured before publish simulation",
    ],
  };
}

async function createDigitalProductDraft(workflow, options = {}) {
  const dryRun = options.dryRun !== false;
  if (!dryRun) {
    throw new Error("Live digital-product publishing is locked until a live adapter is implemented and separately approved.");
  }
  return buildDigitalProductDraft(workflow);
}

module.exports = {
  createDigitalProductDraft,
};
