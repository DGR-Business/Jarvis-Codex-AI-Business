const { all, fromJson, get, now, run, toJson } = require("../db");

const DIGITAL_PRODUCT_V1 = Object.freeze({
  id: "digital_product_v1",
  version: 1,
  status: "active",
  name: "Digital Product",
  businessModels: [
    "digital_product",
    "download",
    "template",
    "spreadsheet",
    "workbook",
    "guide",
    "course",
    "ebook",
    "toolkit",
  ],
  eligibilityRules: {
    descriptorPattern: "digital|download|template|spreadsheet|excel|tracker|calculator|planner|worksheet|workbook|guide|course|ebook|protocol|routine|checklist|toolkit|bundle",
    excludedDescriptorPattern: "print.?on.?demand|\\bpod\\b|white.?label|physical|affiliate|productized.?service|remote.?service|software|saas|ecommerce|manufactur|inventory|fulfil",
    locallyBuildable: true,
    publicationActionIncluded: false,
  },
  evidenceRequirements: {
    directDemand: true,
    competitorSample: true,
    priceAndMargin: true,
    channelFit: true,
    buyerProblem: true,
  },
  capabilityRequirements: [
    "opportunity_research",
    "demand_validation",
    "financial_analysis",
    "offer_architecture",
    "digital_product_build",
    "quality_review",
    "conversion_copy",
    "distribution_plan",
  ],
  channelPolicy: {
    fixedPlatform: null,
    instruction: "Select one or more channels from buyer access, traffic quality, fees, control, integration burden, and unit economics.",
  },
  acceptanceCriteria: {
    realCustomerFiles: true,
    filesOpen: true,
    claimsMappedToProduct: true,
    previewMatchesFiles: true,
    economicsReconciled: true,
    noExternalPublication: true,
  },
  metadata: {
    compatibilityAdapter: "existing_pantheon_full_journey",
    universalPipeline: false,
  },
});

function parseKit(row) {
  if (!row) return null;
  return {
    id: row.id,
    version: row.version,
    status: row.status,
    name: row.name,
    businessModels: fromJson(row.business_models, []),
    eligibilityRules: fromJson(row.eligibility_rules, {}),
    evidenceRequirements: fromJson(row.evidence_requirements, {}),
    capabilityRequirements: fromJson(row.capability_requirements, []),
    channelPolicy: fromJson(row.channel_policy, {}),
    acceptanceCriteria: fromJson(row.acceptance_criteria, {}),
    metadata: fromJson(row.metadata, {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function registerVentureKit(db, definition) {
  if (!definition?.id || !definition?.version || !definition?.name) {
    throw new Error("A venture kit requires an id, version, and name.");
  }
  const timestamp = now();
  run(
    db,
    `INSERT INTO venture_kits
     (id, version, status, name, business_models, eligibility_rules,
      evidence_requirements, capability_requirements, channel_policy,
      acceptance_criteria, metadata, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id, version) DO UPDATE SET
       status = excluded.status,
       name = excluded.name,
       business_models = excluded.business_models,
       eligibility_rules = excluded.eligibility_rules,
       evidence_requirements = excluded.evidence_requirements,
       capability_requirements = excluded.capability_requirements,
       channel_policy = excluded.channel_policy,
       acceptance_criteria = excluded.acceptance_criteria,
       metadata = excluded.metadata,
       updated_at = excluded.updated_at`,
    [
      definition.id,
      definition.version,
      definition.status || "draft",
      definition.name,
      toJson(definition.businessModels || []),
      toJson(definition.eligibilityRules || {}),
      toJson(definition.evidenceRequirements || {}),
      toJson(definition.capabilityRequirements || []),
      toJson(definition.channelPolicy || {}),
      toJson(definition.acceptanceCriteria || {}),
      toJson(definition.metadata || {}),
      timestamp,
      timestamp,
    ],
  );
  return getVentureKit(db, definition.id, definition.version);
}

function ensureVentureKitRegistry(db) {
  registerVentureKit(db, DIGITAL_PRODUCT_V1);
  return listVentureKits(db);
}

function getVentureKit(db, id, version = null) {
  const row = version
    ? get(db, "SELECT * FROM venture_kits WHERE id = ? AND version = ?", [id, version])
    : get(db, "SELECT * FROM venture_kits WHERE id = ? ORDER BY version DESC LIMIT 1", [id]);
  return parseKit(row);
}

function listVentureKits(db, options = {}) {
  const rows = options.includeInactive
    ? all(db, "SELECT * FROM venture_kits ORDER BY id, version DESC")
    : all(db, "SELECT * FROM venture_kits WHERE status = 'active' ORDER BY id, version DESC");
  return rows.map(parseKit);
}

function assessVentureKitEligibility(db, opportunity = {}) {
  if (!get(db, "SELECT id FROM venture_kits WHERE status = 'active' LIMIT 1")) {
    ensureVentureKitRegistry(db);
  }
  const descriptor = [
    opportunity.business_model,
    opportunity.businessModel,
    opportunity.offer_direction,
    opportunity.offerDirection,
    opportunity.title,
  ].filter(Boolean).join(" ").toLowerCase();
  return listVentureKits(db).map((kit) => {
    const pattern = kit.eligibilityRules.descriptorPattern
      ? new RegExp(kit.eligibilityRules.descriptorPattern, "i")
      : null;
    const excludedPattern = kit.eligibilityRules.excludedDescriptorPattern
      ? new RegExp(kit.eligibilityRules.excludedDescriptorPattern, "i")
      : null;
    const suppliedModels = [opportunity.business_model, opportunity.businessModel]
      .filter(Boolean)
      .map((model) => String(model).toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim());
    const modelMatch = kit.businessModels.some((model) => suppliedModels.includes(
      String(model).toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim(),
    ));
    const descriptorMatch = pattern
      ? pattern.test(descriptor) && !(excludedPattern && excludedPattern.test(descriptor))
      : false;
    const eligible = Boolean(modelMatch || descriptorMatch);
    return {
      kitId: kit.id,
      version: kit.version,
      name: kit.name,
      eligible,
      reason: eligible
        ? `The opportunity matches the registered ${kit.name} operating kit.`
        : `The opportunity does not match the current ${kit.name} eligibility rules.`,
      universalPipeline: kit.metadata.universalPipeline === true,
    };
  });
}

function selectVentureKit(db, opportunity = {}) {
  const assessments = assessVentureKitEligibility(db, opportunity);
  const match = assessments.find((item) => item.eligible);
  return {
    selected: match || null,
    assessments,
    buildableNow: Boolean(match),
    instruction: match
      ? "Use the selected kit only after the opportunity passes commercial investment review."
      : "Keep the opportunity eligible for investment analysis, but do not build it until its own venture kit exists.",
  };
}

function createVentureKitRegistry(db) {
  return Object.freeze({
    contract: "VentureKitRegistry.v1",
    ensure: () => ensureVentureKitRegistry(db),
    list: (options) => listVentureKits(db, options),
    select: (opportunity) => selectVentureKit(db, opportunity),
  });
}

module.exports = {
  DIGITAL_PRODUCT_V1,
  assessVentureKitEligibility,
  createVentureKitRegistry,
  ensureVentureKitRegistry,
  getVentureKit,
  listVentureKits,
  registerVentureKit,
  selectVentureKit,
};
