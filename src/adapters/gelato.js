const { randomUUID } = require("node:crypto");

function buildGelatoDraft(workflow) {
  const products = workflow.metadata.products || [];
  return {
    provider: "gelato",
    mode: "dry-run",
    externalId: `dry_gelato_${randomUUID()}`,
    products: products.map((product) => ({
      sku: product.sku,
      product: product.product,
      status: "draft_validated",
      estimatedProfitCents: product.marginCents || 0,
    })),
    checks: [
      "supplier-push rail selected",
      "no Etsy direct API call attempted",
      "no live product created",
      "operator approval captured before publish simulation",
    ],
  };
}

async function createProductDraft(workflow, options = {}) {
  const dryRun = options.dryRun !== false;
  if (!dryRun) {
    throw new Error("Live Gelato publishing is intentionally locked until a live adapter is implemented and separately approved.");
  }
  return buildGelatoDraft(workflow);
}

module.exports = {
  createProductDraft,
};
