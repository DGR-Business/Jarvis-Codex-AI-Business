const {
  getBuyerIntentValidationSpecLifecycle,
} = require("../../config/buyer-intent-validation-specs");
const {
  sha256,
  validateCommercialTestContract,
} = require("./commercial-test-contract");

const COMMERCIAL_AUTHORITY_SCHEMA = "pantheon.commercial-authority.v1";
const COMMERCIAL_TEST_CONTRACT_SCHEMA_V2 = "pantheon.commercial-test-contract.v2";
const COMMERCIAL_LIFECYCLE_EVENT_SCHEMA = "pantheon.commercial-test-lifecycle-event.v2";
const COMMERCIAL_LIFECYCLE_APPROVAL_SCOPE_SCHEMA = "pantheon.commercial-test-lifecycle-approval-scope.v1";
const EXTERNAL_EXECUTION_DESCRIPTOR_REGISTRY_SCHEMA = "pantheon.external-execution-descriptor-registry.v1";
const SEEDED_DRY_RUN_EXECUTION_CONTRACT_SCHEMA = "pantheon.seeded-dry-run-execution-contract.v1";
const COMMERCIAL_OPERATOR_ROLE = "approvals_and_guidance_only";

const LIFECYCLE_EVENT_TYPES = Object.freeze([
  "proposed",
  "accepted",
  "activated",
  "paused",
  "closed",
  "stopped",
]);
const TERMINAL_EVENT_TYPES = new Set(["closed", "stopped"]);
const HASH_PATTERN = /^sha256:[a-f0-9]{64}$/;
const LIFECYCLE_TRANSITIONS = Object.freeze({
  proposed: new Set(["accepted", "closed", "stopped"]),
  accepted: new Set(["activated", "closed", "stopped"]),
  activated: new Set(["paused", "closed", "stopped"]),
  paused: new Set(["accepted", "closed", "stopped"]),
  closed: new Set(),
  stopped: new Set(),
});

const BINDING_KEYS = new Set([
  "commercialTestContract",
  "commercial_test_contract",
  "commercialAuthority",
  "commercial_authority",
  "commercialProgram",
  "commercial_program",
  "commercialTest",
  "commercial_test",
  "testBinding",
  "test_binding",
]);
const BINDING_CONTAINER_KEYS = new Set([
  "binding",
  "contract",
  "executionDescriptor",
  "liveSpendRequest",
  "metadata",
  "pantheonCommercial",
  "pantheonProduction",
  "parameters",
  "payload",
  "request",
]);

const COMMERCIAL_EXECUTION_PATTERN = /\b(?:ads?|advert(?:ise|ises|ised|ising|isement|isements)?|buyer(?:s)?|catalog(?:ue)?s?|checkout(?:s)?|client(?:s)?|commercial|contact(?:s|ed|ing)?|conversion|customer(?:s)?|distribution|email(?:s|ed|ing)?|launch(?:es|ed|ing)?|listing(?:s)?|market(?:s|ed|ing)?|marketplace(?:s)?|offer(?:s)?|opportunit(?:y|ies)|order(?:s|ed|ing)?|outreach|payment(?:s)?|portfolio|product(?:s)?|promot(?:e|es|ed|ing|ion|ions)|prospect(?:s|ed|ing)?|publish(?:es|ed|ing)?|revenue|sale(?:s)?|sell(?:s|ing)?|venture(?:s)?)\b/i;
const COMMERCIAL_INTENT_TEXT_KEYS = new Set([
  "action",
  "action mode",
  "action type",
  "audience",
  "buyer",
  "channel",
  "command",
  "commercial intent",
  "content",
  "copy",
  "customer",
  "description",
  "details",
  "goal",
  "instruction",
  "instructions",
  "intent",
  "message",
  "note",
  "notes",
  "objective",
  "offer",
  "operation",
  "operator note",
  "problem",
  "prompt",
  "prospect",
  "purpose",
  "query",
  "reason",
  "subject",
  "summary",
  "target",
  "text",
  "title",
  "work brief",
]);
const COMMERCIAL_IDENTIFIER_KEYS = /\b(?:action|effect|integration|operation|provider|tool)(?: id| identifier| name| type)?s?\b/i;
const COMMERCIAL_EXECUTION_CONTAINER_KEYS = new Set([
  "execution descriptor",
  "external effects",
  "external action",
  "external actions",
  "expected effects",
  "live spend request",
  "parameters",
  "payload",
  "request",
  "requested tools",
  "sdk capabilities",
  "tool arguments",
  "tools",
]);
const DESCRIPTOR_SURFACE_KEYS = new Map([
  ["tool", "capability"],
  ["tools", "capability"],
  ["requested tool", "capability"],
  ["requested tools", "capability"],
  ["external effect", "effect"],
  ["external effects", "effect"],
  ["expected effect", "effect"],
  ["expected effects", "effect"],
  ["effect", "effect"],
  ["effects", "effect"],
  ["external action", "action"],
  ["external actions", "action"],
  ["provider", "provider"],
  ["provider id", "provider"],
  ["provider name", "provider"],
  ["integration", "integration"],
  ["integration id", "integration"],
  ["integration name", "integration"],
]);
const DESCRIPTOR_CONTEXT_KEYS = new Set([
  "adapter",
  "capabilities",
  "capability",
  "execution",
  "execution descriptor",
  "executor",
  "external action",
  "external actions",
  "external effect",
  "external effects",
  "expected effect",
  "expected effects",
  "live spend request",
  "request",
  "requested tool",
  "requested tools",
  "sdk capabilities",
  "tool arguments",
]);
const DESCRIPTOR_CONTEXT_BREAK_KEYS = new Set([
  "business context",
  "materialized input",
  "parameters",
  "work brief",
]);
const DESCRIPTOR_PROPAGATING_CONTEXT_KEYS = new Set([
  "adapter",
  "capabilities",
  "capability",
  "sdk capabilities",
  "tool arguments",
]);
const SAFE_DESCRIPTOR_IDS = Object.freeze({
  capability: new Set([
    "agent_traces",
    "approval_pack",
    "approved_research",
    "code_interpreter",
    "commercial_briefs",
    "commercial_feedback",
    "commercial_results",
    "cost_ledger",
    "execution_pack_inputs",
    "execution_packs",
    "hosted_tool",
    "image_generation",
    "image_generation_spend",
    "image_understanding",
    "learning_cycles",
    "live_ai_worker_adapter",
    "live_web_with_approval",
    "local_deliverables",
    "model_input",
    "notification_outbox",
    "product_file_factory",
    "research_adapter",
    "research_summary",
    "results_ledger",
    "revenue_ledger",
    "runtime_state",
    "runtime_transform",
    "scorecards",
    "visual_asset_review",
    "web_search",
  ]),
  provider: new Set([
    "bank_rate_feed",
    "local",
    "local_runtime",
    "not_selected",
    "openai",
    "openai_agents_sdk",
    "openai_responses",
    "openai_responses_live_worker",
    "openai_responses_web_search",
    "openai_web_search",
    "pantheon",
    "pantheon_local_runtime",
    "pantheon_research_adapter",
    "rba_reference",
    "responses",
  ]),
  integration: new Set([
    "ai_workers",
    "codex",
    "clickup",
    "live_research",
    "local",
    "openai",
    "pantheon",
    "slack",
  ]),
  effect: new Set([
    "artifact_read",
    "artifact_write",
    "database_read",
    "database_write",
    "external_web_access",
    "image_generation",
    "internal_event",
    "internal_notification_queue",
    "local_file_generation",
    "local_file_write",
    "model_inference",
    "no_external_effects",
  ]),
  action: new Set([
    "diagnostic",
    "dry_run",
    "local_transform",
    "plan_only",
    "read_only",
    "runtime_assurance",
  ]),
  execution_kind: new Set([
    "hosted_tool",
    "live_ai_worker",
    "live_research",
    "model_call",
    "model_input",
    "runtime_transform",
  ]),
});
const COMMERCIAL_DESCRIPTOR_CATEGORIES = new Map(Object.entries({
  ads: [
    "ad_publish",
    "ads_publish",
    "advertising_campaign_publish",
    "autopilot_promotion",
    "facebook_ad_publish",
    "google_ads_publish",
    "marketplace_ad_publish",
    "meta_ads_publish",
    "paid_ad_activate",
  ],
  buyer_contact: [
    "buyer_contact",
    "buyer_outreach",
    "contact_sequence",
    "customer_contact",
    "customer_reply_send",
    "customer_followup",
    "external_send",
    "outreach_dispatch",
    "prospect_nurture",
  ],
  email: [
    "buyer_email_sender",
    "customer_email_sender",
    "email_send",
    "mailgun_send_message",
    "send_email",
    "sendgrid_customer_email_sender",
    "sendgrid_send_message",
    "smtp_send",
  ],
  fulfilment: [
    "delivery_dispatch",
    "fulfil_order",
    "fulfilment",
    "fulfilment_dispatch",
    "fulfill_order",
    "fulfillment",
    "fulfillment_dispatch",
    "ship_order",
    "supplier_publish",
  ],
  invoice: [
    "invoice_collect",
    "invoice_issue",
    "invoice_send",
  ],
  marketplace: [
    "digital_product_adapter",
    "etsy_listing_publish",
    "etsy_upload",
    "gumroad_publish",
    "listing_publish",
    "marketplace_listing",
    "marketplace_listing_publish",
    "marketplace_publish",
    "product_launch",
    "product_listing_publish",
    "publishing",
    "sales_promotion",
  ],
  messaging: [
    "direct_message",
    "dm_send",
    "send_sms",
    "sms_send",
    "text_message",
    "text_message_send",
    "twilio_sms",
    "whatsapp_message",
    "whatsapp_send",
  ],
  payment: [
    "accounting_write",
    "charge_card",
    "checkout_create",
    "checkout_payment_capture",
    "marketplace_checkout_payment_capture",
    "money_movement",
    "order_capture",
    "payment_capture",
    "payment_collect",
    "payments",
    "stripe_charge",
  ],
  payout: [
    "payout",
    "payout_release",
    "seller_payout",
  ],
  refund: [
    "customer_refund",
    "refund",
    "refund_issue",
    "refunds",
  ],
  social: [
    "facebook_post",
    "instagram_post",
    "linkedin_post",
    "social_media_post",
    "social_post",
    "tiktok_post",
    "twitter_post",
    "x_post",
  ],
  voice: [
    "outbound_call",
    "phone_call",
    "place_call",
    "twilio_call",
    "voice_ai_call",
    "voice_ai_outbound_call",
    "voice_call",
  ],
  protected_external: [
    "account_actions",
    "disputes",
    "external_action",
    "increase_spend",
    "legal_determination",
    "live_web_until_adapter",
    "unsupported_claims",
  ],
}).flatMap(([category, identifiers]) => (
  identifiers.map((identifier) => [identifier, category])
)));
const COMMERCIAL_PROVIDER_CATEGORIES = new Map(Object.entries({
  ads: ["facebook", "google_ads", "instagram", "meta_ads", "tiktok"],
  email: ["mailgun", "sendgrid", "smtp"],
  fulfilment: ["gelato"],
  marketplace: ["etsy", "gumroad", "shopify", "woocommerce"],
  messaging: ["twilio", "whatsapp"],
  payment: ["paypal", "square", "stripe"],
  social: ["linkedin", "twitter", "x_com"],
}).flatMap(([category, identifiers]) => (
  identifiers.map((identifier) => [identifier, category])
)));
const COMMERCIAL_INTEGRATION_CATEGORIES = new Map(Object.entries({
  email: ["email"],
  fulfilment: ["gelato"],
  marketplace: [
    "digital_product",
    "digital_products",
    "etsy",
    "gumroad",
    "shopify",
    "woocommerce",
  ],
  messaging: ["twilio"],
  payment: ["paypal", "square", "stripe", "xero"],
  social: [
    "facebook",
    "instagram",
    "linkedin",
    "meta_ads",
    "tiktok",
    "twitter",
    "x_com",
  ],
}).flatMap(([category, identifiers]) => (
  identifiers.map((identifier) => [identifier, category])
)));
const SEEDED_DRY_RUN_WORKFLOW_ID = "wf-digital-product-pilot-proof";
const SEEDED_DRY_RUN_TASK_ID = "task-digital-product-dry-run";
const SEEDED_DRY_RUN_PROOF_MODE = "dry-run only; no live listing, file delivery, or paid asset generation is created";
const SEEDED_DRY_RUN_WORKFLOW_METADATA = Object.freeze({
  channel: "Digital Product",
  subject: "Digital product pilot proof",
  products: Object.freeze([
    Object.freeze({
      sku: "compact-desk-cable-template-v1",
      product: "Desk cable routing template",
      marginCents: 1900,
    }),
    Object.freeze({
      sku: "small-business-launch-checklist-v1",
      product: "Launch checklist download",
      marginCents: 1200,
    }),
  ]),
  sourceFiles: Object.freeze([
    "deliverables/digital-products/compact-desk-cable-template-proof.md",
    "deliverables/digital-products/small-business-launch-checklist-proof.md",
  ]),
  proofMode: SEEDED_DRY_RUN_PROOF_MODE,
});
const SEEDED_DRY_RUN_TASK_PAYLOAD = Object.freeze({
  integration: "digital-products",
  mode: "dry-run",
});
const SEEDED_DRY_RUN_EXECUTION_OPTIONS = Object.freeze({
  dryRun: true,
});

const ERROR_DEFINITIONS = Object.freeze({
  commercial_authority_ambiguous: {
    statusCode: 409,
    message: "More than one commercial program appears active, so Pantheon cannot choose authority safely.",
  },
  commercial_authority_unavailable: {
    statusCode: 409,
    message: "The commercial authority ledger is unavailable or failed its integrity check.",
  },
  commercial_binding_conflict: {
    statusCode: 409,
    message: "The requested work contains conflicting commercial program bindings.",
  },
  commercial_binding_invalid: {
    statusCode: 409,
    message: "The requested work does not contain a complete commercial program binding.",
  },
  commercial_binding_mismatch: {
    statusCode: 409,
    message: "The requested work belongs to a different commercial decision or program.",
  },
  commercial_binding_required: {
    statusCode: 409,
    message: "Commercial work must be bound to the exact accepted active program.",
  },
  commercial_execution_descriptor_unknown: {
    statusCode: 409,
    message: "The requested work names an external capability, action, effect, provider, or integration that Pantheon has not registered for safe classification.",
  },
  commercial_protected_action_required: {
    statusCode: 409,
    message: "The commercial program binding does not authorize this live external action. A separate exact protected-action approval and executable adapter authority are required.",
  },
  commercial_program_inactive: {
    statusCode: 409,
    message: "The bound commercial program is not currently active.",
  },
  commercial_program_terminal: {
    statusCode: 410,
    message: "The bound commercial program is permanently closed and cannot be reused.",
  },
  commercial_subject_not_found: {
    statusCode: 409,
    message: "The requested workflow, task, experiment, or execution pack could not be resolved.",
  },
});

class CommercialAuthorityError extends Error {
  constructor(assessment) {
    super(assessment?.message || ERROR_DEFINITIONS.commercial_authority_unavailable.message);
    this.name = "CommercialAuthorityError";
    this.statusCode = Number(assessment?.statusCode || 409);
    this.code = assessment?.code || "commercial_authority_unavailable";
    this.details = assessment?.details || {};
    this.assessment = assessment || null;
  }
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (isObject(value)) {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, canonical(value[key])]),
    );
  }
  return value ?? null;
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

function sameCanonical(left, right) {
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
}

function canonicalUtcTimestamp(value, label) {
  if (typeof value !== "string") {
    throw new Error(`${label} must be a canonical UTC timestamp.`);
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new Error(`${label} must be a canonical UTC timestamp ending in Z.`);
  }
  return value;
}

function parseJsonObject(value) {
  if (isObject(value)) return { value, error: null };
  if (value === null || value === undefined || value === "") {
    return { value: {}, error: null };
  }
  if (typeof value !== "string") {
    return { value: null, error: "Metadata must be a JSON object." };
  }
  try {
    const parsed = JSON.parse(value);
    if (!isObject(parsed)) {
      return { value: null, error: "Metadata must decode to a JSON object." };
    }
    return { value: parsed, error: null };
  } catch {
    return { value: null, error: "Metadata is not valid JSON." };
  }
}

function normalizedIntentText(value) {
  return String(value ?? "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function normalizedDescriptorId(value) {
  return normalizedIntentText(value).replace(/ /g, "_");
}

function descriptorRegistration(surface, rawValue) {
  const id = normalizedDescriptorId(rawValue);
  if (!id) return { id, classification: "unknown", category: null };
  const commercialCategory = COMMERCIAL_DESCRIPTOR_CATEGORIES.get(id)
    || (
      surface === "provider"
        ? COMMERCIAL_PROVIDER_CATEGORIES.get(id)
        : null
    )
    || (
      surface === "integration"
        ? COMMERCIAL_INTEGRATION_CATEGORIES.get(id)
        : null
    );
  if (commercialCategory) {
    return {
      id,
      classification: "commercial",
      category: commercialCategory,
    };
  }
  if (SAFE_DESCRIPTOR_IDS[surface]?.has(id)) {
    return {
      id,
      classification: "internal",
      category: surface,
    };
  }
  return { id, classification: "unknown", category: null };
}

function inspectExternalExecutionDescriptors(value, options = {}) {
  const descriptorSignals = [];
  const unknownExternalDescriptors = [];
  const seen = new Set();

  function record(rawValue, surface, path, allowUnknown = true) {
    if (
      rawValue === null
      || rawValue === undefined
      || rawValue === false
      || rawValue === 0
      || rawValue === ""
    ) {
      return;
    }
    if (typeof rawValue !== "string") {
      if (allowUnknown) {
        unknownExternalDescriptors.push({
          path,
          surface,
          value: `[${Array.isArray(rawValue) ? "array" : typeof rawValue}]`,
        });
      }
      return;
    }
    const registration = descriptorRegistration(surface, rawValue);
    if (registration.classification === "unknown") {
      if (allowUnknown) {
        unknownExternalDescriptors.push({
          path,
          surface,
          value: registration.id || String(rawValue).slice(0, 180),
        });
      }
      return;
    }
    descriptorSignals.push({
      path,
      surface,
      id: registration.id,
      classification: registration.classification,
      category: registration.category,
    });
  }

  function descriptorIdentitySurface(key, fallback) {
    const normalizedKey = normalizedIntentText(key);
    if (normalizedKey.includes("provider")) return "provider";
    if (normalizedKey.includes("integration")) return "integration";
    if (
      normalizedKey.includes("tool")
      || normalizedKey === "sdk name"
      || normalizedKey === "capability"
    ) {
      return "capability";
    }
    return fallback;
  }

  function inspectDescriptorValue(node, surface, path, allowUnknown = true, depth = 0) {
    if (depth > 5 || node === null || node === undefined || node === false || node === 0) {
      return;
    }
    if (typeof node === "string" || typeof node === "number" || typeof node === "boolean") {
      record(node, surface, path, allowUnknown);
      return;
    }
    if (Array.isArray(node)) {
      for (let index = 0; index < node.length; index += 1) {
        inspectDescriptorValue(
          node[index],
          surface,
          `${path}[${index}]`,
          allowUnknown,
          depth + 1,
        );
      }
      return;
    }
    if (!isObject(node)) {
      record(node, surface, path, allowUnknown);
      return;
    }

    const identityKeys = new Set([
      "action",
      "action id",
      "action name",
      "action type",
      "capability",
      "effect",
      "effect id",
      "effect name",
      "effect type",
      "id",
      "integration",
      "integration id",
      "integration name",
      "name",
      "operation",
      "provider",
      "provider id",
      "provider name",
      "sdk name",
      "tool",
      "tool id",
      "tool name",
      "type",
    ]);
    let inspectedIdentity = false;
    for (const [key, child] of Object.entries(node)) {
      const normalizedKey = normalizedIntentText(key);
      if (!identityKeys.has(normalizedKey)) continue;
      inspectedIdentity = true;
      inspectDescriptorValue(
        child,
        descriptorIdentitySurface(key, surface),
        `${path}.${key}`,
        allowUnknown,
        depth + 1,
      );
    }
    if (!inspectedIdentity && Object.keys(node).length > 0 && allowUnknown) {
      unknownExternalDescriptors.push({
        path,
        surface,
        value: "[descriptor without a registered identity field]",
      });
    }
  }

  function visit(
    node,
    path,
    depth,
    executionContext = false,
    propagatingContextDepth = 0,
  ) {
    if (depth > 10 || node === null || node === undefined) return;
    if (Array.isArray(node)) {
      for (let index = 0; index < node.length; index += 1) {
        visit(
          node[index],
          `${path}[${index}]`,
          depth + 1,
          executionContext,
          propagatingContextDepth,
        );
      }
      return;
    }
    if (!isObject(node) || seen.has(node)) return;
    seen.add(node);

    for (const [key, child] of Object.entries(node)) {
      const normalizedKey = normalizedIntentText(key);
      const childPath = `${path}.${key}`;
      const surface = DESCRIPTOR_SURFACE_KEYS.get(normalizedKey);
      const isProviderOrIntegration = surface === "provider" || surface === "integration";
      const isGenericTools = normalizedKey === "tool" || normalizedKey === "tools";
      const isGenericEffects = normalizedKey === "effect" || normalizedKey === "effects";
      const descriptorSurfaceIsExplicit = Boolean(surface) && (
        isProviderOrIntegration
          ? executionContext
          : isGenericTools || isGenericEffects
            ? executionContext || depth === 0
            : true
      );

      if (descriptorSurfaceIsExplicit) {
        inspectDescriptorValue(child, surface, childPath, true);
      } else if (isProviderOrIntegration && depth === 0) {
        inspectDescriptorValue(child, surface, childPath, false);
      } else if (
        (executionContext || depth === 0)
        && ["action", "action type", "operation", "operation type"].includes(normalizedKey)
      ) {
        inspectDescriptorValue(
          child,
          "action",
          childPath,
          executionContext,
        );
      } else if (
        executionContext
        && ["kind", "type"].includes(normalizedKey)
      ) {
        inspectDescriptorValue(child, "execution_kind", childPath, true);
      }

      if (surface && descriptorSurfaceIsExplicit) continue;
      const nextExecutionContext = DESCRIPTOR_CONTEXT_BREAK_KEYS.has(normalizedKey)
        ? false
        : DESCRIPTOR_CONTEXT_KEYS.has(normalizedKey)
          || (executionContext && propagatingContextDepth > 0);
      const nextPropagatingContextDepth =
        DESCRIPTOR_CONTEXT_BREAK_KEYS.has(normalizedKey)
          ? 0
          : DESCRIPTOR_PROPAGATING_CONTEXT_KEYS.has(normalizedKey)
            ? 1
            : Math.max(0, propagatingContextDepth - 1);
      if (Array.isArray(child) || isObject(child)) {
        visit(
          child,
          childPath,
          depth + 1,
          nextExecutionContext,
          nextPropagatingContextDepth,
        );
      }
    }
  }

  for (const descriptor of options.rootDescriptors || []) {
    const item = isObject(descriptor) ? descriptor : { value: descriptor };
    inspectDescriptorValue(
      item.value,
      item.surface || "action",
      item.path || `${options.path || "$"}.rootDescriptor`,
      false,
    );
  }
  const rootExecutionContext = options.executionRoot === true
    || /\blive request\b/.test(normalizedIntentText(options.path || ""));
  visit(value, options.path || "$", 0, rootExecutionContext, 0);

  const uniqueSignals = new Map();
  for (const signal of descriptorSignals) {
    uniqueSignals.set(
      `${signal.path}:${signal.surface}:${signal.id}:${signal.classification}`,
      signal,
    );
  }
  const uniqueUnknown = new Map();
  for (const unknown of unknownExternalDescriptors) {
    uniqueUnknown.set(
      `${unknown.path}:${unknown.surface}:${unknown.value}`,
      unknown,
    );
  }
  return {
    schema: EXTERNAL_EXECUTION_DESCRIPTOR_REGISTRY_SCHEMA,
    descriptorSignals: [...uniqueSignals.values()],
    unknownExternalDescriptors: [...uniqueUnknown.values()],
  };
}

function inspectCommercialExecutionIntent(value, options = {}) {
  const signals = [];
  const seen = new Set();
  const descriptorInspection = inspectExternalExecutionDescriptors(value, options);

  for (const descriptor of descriptorInspection.descriptorSignals) {
    if (descriptor.classification !== "commercial") continue;
    signals.push({
      path: descriptor.path,
      value: `${descriptor.category}:${descriptor.id}`,
    });
  }
  for (const descriptor of descriptorInspection.unknownExternalDescriptors) {
    signals.push({
      path: descriptor.path,
      value: `unknown_external_${descriptor.surface}:${descriptor.value}`,
    });
  }

  function inspectText(candidate, path) {
    const normalized = normalizedIntentText(candidate);
    if (!normalized || !COMMERCIAL_EXECUTION_PATTERN.test(normalized)) return;
    signals.push({
      path,
      value: normalized.slice(0, 180),
    });
  }

  function visit(node, path, depth, scanAllStrings = false) {
    if (depth > 10 || node === null || node === undefined) return;
    if (typeof node === "string") {
      if (scanAllStrings) inspectText(node, path);
      return;
    }
    if (Array.isArray(node)) {
      for (let index = 0; index < node.length; index += 1) {
        visit(node[index], `${path}[${index}]`, depth + 1, scanAllStrings);
      }
      return;
    }
    if (!isObject(node) || seen.has(node)) return;
    seen.add(node);

    if (
      node.commercial === true
      || node.commercialWork === true
      || node.externalCommercialAction === true
    ) {
      signals.push({ path, value: "explicit commercial execution marker" });
    }

    for (const [key, child] of Object.entries(node)) {
      const normalizedKey = normalizedIntentText(key);
      const childPath = `${path}.${key}`;
      const isIntentText = COMMERCIAL_INTENT_TEXT_KEYS.has(normalizedKey);
      const isIdentifier = COMMERCIAL_IDENTIFIER_KEYS.test(normalizedKey);
      const isExecutionContainer = COMMERCIAL_EXECUTION_CONTAINER_KEYS.has(normalizedKey);
      const isDescriptorSurface = DESCRIPTOR_SURFACE_KEYS.has(normalizedKey);
      const forceStrings = scanAllStrings || (
        !isDescriptorSurface
        && (isIdentifier || isExecutionContainer)
      );

      if (COMMERCIAL_EXECUTION_PATTERN.test(normalizedKey)) {
        signals.push({ path: childPath, value: normalizedKey });
      }
      if (
        typeof child === "string"
        && !isDescriptorSurface
        && (isIntentText || forceStrings)
      ) {
        inspectText(child, childPath);
      } else if (Array.isArray(child) || isObject(child)) {
        visit(child, childPath, depth + 1, forceStrings);
      }
    }
  }

  for (const [index, text] of (options.rootTexts || []).entries()) {
    inspectText(text, `${options.path || "$"}.root[${index}]`);
  }
  visit(value, options.path || "$", 0, options.scanAllStrings === true);

  const unique = new Map();
  for (const signal of signals) {
    unique.set(`${signal.path}:${signal.value}`, signal);
  }
  return {
    commercial: unique.size > 0,
    signals: [...unique.values()],
    descriptorSignals: descriptorInspection.descriptorSignals,
    unknownExternalDescriptors: descriptorInspection.unknownExternalDescriptors,
    descriptorRegistrySchema: descriptorInspection.schema,
  };
}

function tableExists(db, tableName) {
  return Boolean(
    db.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
    ).get(tableName),
  );
}

function authorityUnavailable(reason, issues = []) {
  return {
    schema: COMMERCIAL_AUTHORITY_SCHEMA,
    status: "unavailable",
    reason,
    activeProgram: null,
    contracts: [],
    counts: {
      contracts: 0,
      active: 0,
      terminal: 0,
      inactive: 0,
    },
    issues,
  };
}

function contractBinding(row) {
  return {
    contractSchema: row.contract_schema,
    decisionHash: row.decision_hash,
    programId: row.program_id,
    programVersion: row.program_version,
    testId: row.test_id,
    testVersion: row.test_version,
    ventureId: row.venture_id,
    ventureKitId: row.venture_kit_id,
    ventureKitVersion: row.venture_kit_version,
    ventureKitHash: row.venture_kit_hash,
    offerId: row.offer_id,
    offerVersion: row.offer_version,
    offerHash: row.offer_hash,
    offerSku: row.offer_sku,
    experimentId: row.experiment_id,
    experimentVersion: row.experiment_version,
    cohortId: row.cohort_id,
  };
}

function validateContractRow(row) {
  const issues = [];
  const parsed = parseJsonObject(row.contract_json);
  if (parsed.error) issues.push(parsed.error);
  const contract = parsed.value;

  if (!HASH_PATTERN.test(String(row.decision_hash || ""))) {
    issues.push("decision_hash is not a valid sha256 digest.");
  }
  if (row.contract_schema !== COMMERCIAL_TEST_CONTRACT_SCHEMA_V2) {
    issues.push(`contract_schema must be ${COMMERCIAL_TEST_CONTRACT_SCHEMA_V2}.`);
  }
  if (row.operator_role !== COMMERCIAL_OPERATOR_ROLE) {
    issues.push(`operator_role must be ${COMMERCIAL_OPERATOR_ROLE}.`);
  }
  if (row.external_spend_cap_cents !== 0) {
    issues.push("external_spend_cap_cents must remain zero before external approval.");
  }
  if (!HASH_PATTERN.test(String(row.venture_kit_hash || ""))) {
    issues.push("venture_kit_hash is not a valid sha256 digest.");
  }

  if (contract) {
    try {
      validateCommercialTestContract(contract);
    } catch (error) {
      issues.push(`contract_json failed semantic validation: ${error.message}`);
    }

    const exactFields = [
      ["schema", contract.schema, row.contract_schema],
      ["decisionHash", contract.decisionHash, row.decision_hash],
      ["programId", contract.programId, row.program_id],
      ["programVersion", contract.programVersion, row.program_version],
      ["testId", contract.testId, row.test_id],
      ["testVersion", contract.testVersion, row.test_version],
      ["ventureId", contract.ventureId, row.venture_id],
      ["ventureKit.id", contract.ventureKit?.id, row.venture_kit_id],
      ["ventureKit.version", contract.ventureKit?.version, row.venture_kit_version],
      ["ventureKit.hash", contract.ventureKit?.hash, row.venture_kit_hash],
      ["offer.id", contract.offer?.id, row.offer_id],
      ["offer.version", contract.offer?.version, row.offer_version],
      ["offer.hash", contract.offer?.hash, row.offer_hash],
      ["offer.sku", contract.offer?.sku, row.offer_sku],
      ["experiment.id", contract.experiment?.id, row.experiment_id],
      ["experiment.version", contract.experiment?.version, row.experiment_version],
      ["cohort.id", contract.cohort?.id, row.cohort_id],
      ["channel.id", contract.channel?.id, row.channel_id],
      ["channel.providerNamespace", contract.channel?.providerNamespace, row.provider_namespace],
      ["channel.accountHash", contract.channel?.accountHash, row.account_hash],
      ["channel.adapter.id", contract.channel?.adapter?.id, row.adapter_id],
      ["channel.adapter.version", contract.channel?.adapter?.version, row.adapter_version],
      ["channel.adapter.hash", contract.channel?.adapter?.hash, row.adapter_hash],
      ["reportingPeriod.startsAt", contract.reportingPeriod?.startsAt, row.reporting_starts_at],
      ["reportingPeriod.endsAt", contract.reportingPeriod?.endsAt, row.reporting_ends_at],
      ["buyerIdentity.keyId", contract.buyerIdentity?.keyId, row.buyer_key_id],
      ["buyerIdentity.keyVersion", contract.buyerIdentity?.keyVersion, row.buyer_key_version],
      [
        "buyerIdentity.independenceBasis",
        contract.buyerIdentity?.independenceBasis,
        row.buyer_independence_basis,
      ],
      ["price.amountAudCents", contract.price?.amountAudCents, row.price_aud_cents],
      ["operatorRole", contract.operatorRole, row.operator_role],
    ];
    for (const [field, actual, expected] of exactFields) {
      if (actual !== expected) {
        issues.push(`contract_json.${field} does not match its immutable ledger column.`);
      }
    }
    const spendCents = Number.isFinite(contract.externalSpendCapAud)
      ? Math.round(contract.externalSpendCapAud * 100)
      : NaN;
    if (spendCents !== row.external_spend_cap_cents) {
      issues.push("contract_json.externalSpendCapAud does not match its immutable ledger column.");
    }
  }

  return { contract, issues };
}

function normalizeLifecycleEvent(input) {
  if (!isObject(input)) throw new Error("Lifecycle event must be an object.");
  if (
    input.schema !== undefined
    && input.schema !== COMMERCIAL_LIFECYCLE_EVENT_SCHEMA
  ) {
    throw new Error(`Lifecycle event schema must be ${COMMERCIAL_LIFECYCLE_EVENT_SCHEMA}.`);
  }
  const id = String(input.id || "").trim();
  if (!/^[a-z0-9][a-z0-9._:-]{0,127}$/i.test(id)) {
    throw new Error("Lifecycle event id must be a stable identifier.");
  }
  const decisionHash = String(input.decisionHash || "").trim();
  if (!HASH_PATTERN.test(decisionHash)) {
    throw new Error("Lifecycle decisionHash must be a sha256-prefixed lowercase digest.");
  }
  const sequence = Number(input.sequence);
  if (!Number.isSafeInteger(sequence) || sequence < 0) {
    throw new Error("Lifecycle sequence must be a non-negative whole number.");
  }
  const previousEventHash = input.previousEventHash ?? null;
  if (
    (sequence === 0 && previousEventHash !== null)
    || (sequence > 0 && !HASH_PATTERN.test(String(previousEventHash || "")))
  ) {
    throw new Error("Lifecycle previousEventHash does not match its sequence position.");
  }
  const eventType = String(input.eventType || "").trim();
  if (!LIFECYCLE_EVENT_TYPES.includes(eventType)) {
    throw new Error(`Unsupported lifecycle event type ${eventType}.`);
  }
  if (sequence === 0 && eventType !== "proposed") {
    throw new Error("Lifecycle sequence zero must be proposed.");
  }
  const approvalId = input.approvalId ?? null;
  const approvalScopeHash = input.approvalScopeHash ?? null;
  if (
    approvalId !== null
    && (typeof approvalId !== "string" || approvalId.trim() === "")
  ) {
    throw new Error("Lifecycle approvalId must be null or a non-empty identifier.");
  }
  if (
    approvalScopeHash !== null
    && !HASH_PATTERN.test(String(approvalScopeHash))
  ) {
    throw new Error("Lifecycle approvalScopeHash must be null or a sha256 digest.");
  }
  if ((approvalId === null) !== (approvalScopeHash === null)) {
    throw new Error("Lifecycle approvalId and approvalScopeHash must be supplied together.");
  }
  if (
    ["accepted", "activated"].includes(eventType)
    && (approvalId === null || approvalScopeHash === null)
  ) {
    throw new Error(`${eventType} lifecycle events require an exact approval and scope hash.`);
  }
  if (eventType === "proposed" && (approvalId !== null || approvalScopeHash !== null)) {
    throw new Error("Proposed lifecycle events cannot carry approval authority.");
  }
  if (!isObject(input.metadata ?? {})) {
    throw new Error("Lifecycle metadata must be a JSON object.");
  }
  const payload = {
    schema: COMMERCIAL_LIFECYCLE_EVENT_SCHEMA,
    id,
    decisionHash,
    sequence,
    previousEventHash,
    eventType,
    approvalId,
    approvalScopeHash,
    reason: String(input.reason ?? "").replace(/\s+/g, " ").trim(),
    metadata: canonical(input.metadata ?? {}),
    occurredAt: canonicalUtcTimestamp(input.occurredAt, "Lifecycle occurredAt"),
  };
  const eventHash = sha256(payload);
  if (
    input.eventHash !== undefined
    && String(input.eventHash) !== eventHash
  ) {
    throw new Error("Lifecycle eventHash does not match the canonical event payload.");
  }
  return { ...payload, eventHash };
}

function createCommercialLifecycleEvent(input) {
  return deepFreeze(normalizeLifecycleEvent(input));
}

function commercialLifecycleApprovalScope(contract, eventType = "accepted") {
  validateCommercialTestContract(contract);
  if (!["accepted", "activated"].includes(eventType)) {
    throw new Error("Only acceptance or activation may establish commercial lifecycle authority.");
  }
  return deepFreeze({
    schema: COMMERCIAL_LIFECYCLE_APPROVAL_SCOPE_SCHEMA,
    eventType,
    decisionHash: contract.decisionHash,
    programId: contract.programId,
    programVersion: contract.programVersion,
    testId: contract.testId,
    testVersion: contract.testVersion,
    ventureId: contract.ventureId,
    ventureKit: {
      id: contract.ventureKit.id,
      version: contract.ventureKit.version,
      hash: contract.ventureKit.hash,
    },
    offer: {
      id: contract.offer.id,
      version: contract.offer.version,
      hash: contract.offer.hash,
      sku: contract.offer.sku,
    },
    experiment: {
      id: contract.experiment.id,
      version: contract.experiment.version,
    },
    cohortId: contract.cohort.id,
    channel: {
      id: contract.channel.id,
      providerNamespace: contract.channel.providerNamespace,
      accountHash: contract.channel.accountHash,
      adapter: {
        id: contract.channel.adapter.id,
        version: contract.channel.adapter.version,
        hash: contract.channel.adapter.hash,
      },
    },
    reportingPeriod: {
      startsAt: contract.reportingPeriod.startsAt,
      endsAt: contract.reportingPeriod.endsAt,
    },
    priceAudCents: contract.price.amountAudCents,
    operatorRole: contract.operatorRole,
    externalSpendCapAud: contract.externalSpendCapAud,
  });
}

function commercialLifecycleApprovalScopeHash(contract, eventType = "accepted") {
  return sha256(commercialLifecycleApprovalScope(contract, eventType));
}

function validateLifecycleEvent(row) {
  const issues = [];
  const parsed = parseJsonObject(row.event_json);
  if (parsed.error) issues.push(parsed.error);
  let event = null;
  if (parsed.value) {
    try {
      event = normalizeLifecycleEvent(parsed.value);
      if (!sameCanonical(event, parsed.value)) {
        issues.push("event_json contains unsupported or non-normalized fields.");
      }
    } catch (error) {
      issues.push(`event_json failed semantic validation: ${error.message}`);
    }
  }
  if (event) {
    const metadata = parseJsonObject(row.metadata);
    if (metadata.error) issues.push(metadata.error);
    const exactFields = [
      ["id", event.id, row.id],
      ["decisionHash", event.decisionHash, row.decision_hash],
      ["sequence", event.sequence, row.sequence],
      ["previousEventHash", event.previousEventHash, row.previous_event_hash],
      ["eventType", event.eventType, row.event_type],
      ["eventHash", event.eventHash, row.event_hash],
      ["approvalId", event.approvalId, row.approval_id],
      ["approvalScopeHash", event.approvalScopeHash, row.approval_scope_hash],
      ["reason", event.reason, row.reason],
      ["occurredAt", event.occurredAt, row.occurred_at],
    ];
    for (const [field, actual, expected] of exactFields) {
      if (actual !== expected) {
        issues.push(`event_json.${field} does not match its immutable ledger column.`);
      }
    }
    if (!metadata.error && !sameCanonical(event.metadata, metadata.value)) {
      issues.push("event_json.metadata does not match its immutable ledger column.");
    }
  }
  try {
    canonicalUtcTimestamp(row.created_at, "Lifecycle created_at");
  } catch (error) {
    issues.push(error.message);
  }
  return { ...row, event, issues };
}

function lifecycleForContract(events, contract, approvalsById) {
  const ordered = [...events].sort(
    (left, right) => Number(left.sequence) - Number(right.sequence),
  );
  const chainIssues = [];
  const seenSequences = new Set();
  const seenHashes = new Set();
  const usedAuthorityApprovals = new Map();
  let latestPause = null;

  for (let index = 0; index < ordered.length; index += 1) {
    const current = ordered[index];
    const previous = ordered[index - 1] || null;
    if (seenSequences.has(current.sequence)) {
      chainIssues.push(`Lifecycle sequence ${current.sequence} is duplicated.`);
    }
    seenSequences.add(current.sequence);
    if (seenHashes.has(current.event_hash)) {
      chainIssues.push(`Lifecycle event hash ${current.event_hash} is duplicated.`);
    }
    seenHashes.add(current.event_hash);
    if (current.sequence !== index) {
      chainIssues.push(`Lifecycle sequence must be contiguous from zero; expected ${index}.`);
    }
    if (index === 0) {
      if (current.previous_event_hash !== null) {
        chainIssues.push("The proposed lifecycle event must have no predecessor.");
      }
      if (current.event_type !== "proposed") {
        chainIssues.push("The lifecycle chain must begin with proposed.");
      }
    } else {
      if (current.previous_event_hash !== previous.event_hash) {
        chainIssues.push(`Lifecycle sequence ${current.sequence} does not bind the previous event hash.`);
      }
      if (
        Number.isFinite(Date.parse(current.occurred_at))
        && Number.isFinite(Date.parse(previous.occurred_at))
        && Date.parse(current.occurred_at) < Date.parse(previous.occurred_at)
      ) {
        chainIssues.push(`Lifecycle sequence ${current.sequence} moves backward in time.`);
      }
      const allowed = LIFECYCLE_TRANSITIONS[previous.event_type] || new Set();
      if (!allowed.has(current.event_type)) {
        chainIssues.push(
          `Invalid lifecycle transition ${previous.event_type} -> ${current.event_type}.`,
        );
      }
      if (TERMINAL_EVENT_TYPES.has(previous.event_type)) {
        chainIssues.push(`Lifecycle event ${current.id} appears after a terminal event.`);
      }
    }
    if (["accepted", "activated"].includes(current.event_type)) {
      const priorApprovalUse = usedAuthorityApprovals.get(current.approval_id);
      if (priorApprovalUse) {
        chainIssues.push(
          `${current.event_type} lifecycle event ${current.id} reuses approval ${current.approval_id} already bound to ${priorApprovalUse.id}.`,
        );
      } else if (current.approval_id) {
        usedAuthorityApprovals.set(current.approval_id, current);
      }
    }
    if (["accepted", "activated"].includes(current.event_type) && contract) {
      try {
        const expectedScopeHash = commercialLifecycleApprovalScopeHash(
          contract,
          current.event_type,
        );
        if (current.approval_scope_hash !== expectedScopeHash) {
          chainIssues.push(
            `${current.event_type} lifecycle event ${current.id} does not bind the exact commercial scope.`,
          );
        }
        const approval = approvalsById.get(current.approval_id);
        if (!approval) {
          chainIssues.push(
            `${current.event_type} lifecycle event ${current.id} references a missing approval.`,
          );
        } else {
          if (approval.status !== "approved") {
            chainIssues.push(
              `${current.event_type} lifecycle event ${current.id} is not backed by an approved decision.`,
            );
          }
          if (approval.scope_hash !== current.approval_scope_hash) {
            chainIssues.push(
              `${current.event_type} lifecycle event ${current.id} does not match its approval ledger scope.`,
            );
          }
          const decisionTime = Date.parse(String(approval.decided_at || ""));
          if (!Number.isFinite(decisionTime)) {
            chainIssues.push(
              `${current.event_type} lifecycle event ${current.id} has no valid approval decision time.`,
            );
          } else if (decisionTime > Date.parse(current.occurred_at)) {
            chainIssues.push(
              `${current.event_type} lifecycle event ${current.id} predates its approval decision.`,
            );
          } else if (
            latestPause
            && (
              !Number.isFinite(Date.parse(latestPause.occurred_at))
              || decisionTime <= Date.parse(latestPause.occurred_at)
            )
          ) {
            chainIssues.push(
              `${current.event_type} lifecycle event ${current.id} is not backed by a fresh approval decided after pause ${latestPause.id}.`,
            );
          }
        }
      } catch (error) {
        chainIssues.push(
          `Accepted lifecycle scope could not be validated: ${error.message}`,
        );
      }
    }
    if (current.event_type === "paused") latestPause = current;
  }

  const latestEvent = ordered.at(-1) || null;
  const terminalEvent = ordered.find(
    (event) => TERMINAL_EVENT_TYPES.has(event.event_type),
  ) || null;
  const acceptedEvent = [...ordered].reverse().find(
    (event) => event.event_type === "accepted",
  ) || null;

  if (terminalEvent) {
    return {
      status: "terminal",
      reason: `${terminalEvent.event_type}_is_irreversible`,
      latestEvent,
      terminalEvent,
      acceptedEvent,
      issues: chainIssues,
    };
  }
  if (!latestEvent) {
    return {
      status: "inactive",
      reason: "no_lifecycle_event",
      latestEvent: null,
      terminalEvent: null,
      acceptedEvent: null,
      issues: chainIssues,
    };
  }
  if (
    latestEvent.event_type === "activated"
    && ordered.at(-2)?.event_type === "accepted"
  ) {
    return {
      status: "active",
      reason: "accepted_then_activated",
      latestEvent,
      terminalEvent: null,
      acceptedEvent: ordered.at(-2),
      issues: chainIssues,
    };
  }
  return {
    status: "inactive",
    reason: latestEvent.event_type === "activated"
      ? "activated_without_immediately_prior_acceptance"
      : `latest_event_${latestEvent.event_type}`,
    latestEvent,
    terminalEvent: null,
    acceptedEvent,
    issues: chainIssues,
  };
}

function publicLifecycleEvent(event) {
  if (!event) return null;
  return {
    id: event.id,
    type: event.event_type,
    approvalId: event.approval_id || null,
    approvalScopeHash: event.approval_scope_hash || null,
    sequence: event.sequence,
    reason: event.event?.reason || "",
    occurredAt: event.occurred_at,
  };
}

function getCommercialAuthorityState(db) {
  if (!db || typeof db.prepare !== "function") {
    return authorityUnavailable("database_handle_missing", ["A SQLite database handle is required."]);
  }

  const requiredTables = [
    "commercial_test_contracts",
    "commercial_test_lifecycle_events",
    "approvals",
  ];
  try {
    const missingTables = requiredTables.filter((table) => !tableExists(db, table));
    if (missingTables.length > 0) {
      return authorityUnavailable(
        "authority_tables_missing",
        missingTables.map((table) => `Missing table: ${table}.`),
      );
    }
  } catch (error) {
    return authorityUnavailable("authority_schema_unreadable", [error.message]);
  }

  let contractRows;
  let eventRows;
  let approvalRows;
  try {
    contractRows = db.prepare(
      "SELECT rowid AS __rowid, * FROM commercial_test_contracts",
    ).all();
    eventRows = db.prepare(
      "SELECT rowid AS __rowid, * FROM commercial_test_lifecycle_events",
    ).all();
    approvalRows = db.prepare(
      "SELECT id, status, scope_hash, decided_at FROM approvals",
    ).all();
  } catch (error) {
    return authorityUnavailable("authority_ledger_unreadable", [error.message]);
  }

  const eventsByDecision = new Map();
  const approvalsById = new Map(approvalRows.map((row) => [row.id, row]));
  const globalIssues = [];
  for (const eventRow of eventRows) {
    const event = validateLifecycleEvent(eventRow);
    if (event.issues.length > 0) {
      globalIssues.push(...event.issues.map(
        (issue) => `${event.id || "unknown lifecycle event"}: ${issue}`,
      ));
    }
    const events = eventsByDecision.get(event.decision_hash) || [];
    events.push(event);
    eventsByDecision.set(event.decision_hash, events);
  }

  const knownDecisions = new Set(contractRows.map((row) => row.decision_hash));
  for (const decisionHash of eventsByDecision.keys()) {
    if (!knownDecisions.has(decisionHash)) {
      globalIssues.push(`Lifecycle events reference missing contract ${decisionHash}.`);
    }
  }

  const contracts = contractRows.map((row) => {
    const validation = validateContractRow(row);
    const events = eventsByDecision.get(row.decision_hash) || [];
    const lifecycle = lifecycleForContract(
      events,
      validation.contract,
      approvalsById,
    );
    const issues = [
      ...validation.issues,
      ...events.flatMap((event) => event.issues),
      ...lifecycle.issues,
    ];
    return {
      decisionHash: row.decision_hash,
      contractSchema: row.contract_schema,
      programId: row.program_id,
      programVersion: row.program_version,
      testId: row.test_id,
      testVersion: row.test_version,
      ventureId: row.venture_id,
      ventureKit: {
        id: row.venture_kit_id,
        version: row.venture_kit_version,
        hash: row.venture_kit_hash,
      },
      operatorRole: row.operator_role,
      externalSpendCapCents: row.external_spend_cap_cents,
      contract: validation.contract,
      binding: contractBinding(row),
      status: lifecycle.status,
      lifecycleReason: lifecycle.reason,
      acceptedEvent: publicLifecycleEvent(lifecycle.acceptedEvent),
      latestEvent: publicLifecycleEvent(lifecycle.latestEvent),
      terminalEvent: publicLifecycleEvent(lifecycle.terminalEvent),
      issues,
    };
  });

  const contractIssues = contracts.flatMap((contract) => contract.issues.map(
    (issue) => `${contract.decisionHash || "unknown contract"}: ${issue}`,
  ));
  const issues = [...new Set([...globalIssues, ...contractIssues])];
  const activeContracts = contracts.filter(
    (contract) => contract.status === "active" && contract.issues.length === 0,
  );
  const counts = {
    contracts: contracts.length,
    active: activeContracts.length,
    terminal: contracts.filter((contract) => contract.status === "terminal").length,
    inactive: contracts.filter((contract) => contract.status === "inactive").length,
  };

  if (issues.length > 0) {
    return {
      schema: COMMERCIAL_AUTHORITY_SCHEMA,
      status: "invalid",
      reason: "authority_integrity_failed",
      activeProgram: null,
      contracts,
      counts,
      issues,
    };
  }
  if (activeContracts.length > 1) {
    return {
      schema: COMMERCIAL_AUTHORITY_SCHEMA,
      status: "ambiguous",
      reason: "multiple_active_programs",
      activeProgram: null,
      contracts,
      counts,
      issues: [],
    };
  }
  if (activeContracts.length === 0) {
    return {
      schema: COMMERCIAL_AUTHORITY_SCHEMA,
      status: "inactive",
      reason: "no_accepted_active_program",
      activeProgram: null,
      contracts,
      counts,
      issues: [],
    };
  }
  return {
    schema: COMMERCIAL_AUTHORITY_SCHEMA,
    status: "active",
    reason: "one_accepted_active_program",
    activeProgram: activeContracts[0],
    contracts,
    counts,
    issues: [],
  };
}

function resolveAcceptedActiveCommercialProgram(db) {
  const state = getCommercialAuthorityState(db);
  return state.status === "active" ? state.activeProgram : null;
}

function bindingValue(value, camelName, snakeName) {
  if (!isObject(value)) return undefined;
  return value[camelName] ?? value[snakeName];
}

function normalizeBinding(value) {
  if (!isObject(value)) return null;
  const ventureKit = isObject(value.ventureKit)
    ? value.ventureKit
    : isObject(value.venture_kit)
      ? value.venture_kit
      : {};
  const offer = isObject(value.offer) ? value.offer : {};
  const experiment = isObject(value.experiment) ? value.experiment : {};
  const cohort = isObject(value.cohort) ? value.cohort : {};
  const schemaValue = bindingValue(value, "contractSchema", "contract_schema")
    ?? (value.schema === COMMERCIAL_TEST_CONTRACT_SCHEMA_V2 ? value.schema : undefined);
  return {
    contractSchema: schemaValue,
    decisionHash: bindingValue(value, "decisionHash", "decision_hash"),
    programId: bindingValue(value, "programId", "program_id"),
    programVersion: bindingValue(value, "programVersion", "program_version"),
    testId: bindingValue(value, "testId", "test_id"),
    testVersion: bindingValue(value, "testVersion", "test_version"),
    ventureId: bindingValue(value, "ventureId", "venture_id"),
    ventureKitId: bindingValue(value, "ventureKitId", "venture_kit_id")
      ?? bindingValue(ventureKit, "id", "id"),
    ventureKitVersion: bindingValue(value, "ventureKitVersion", "venture_kit_version")
      ?? bindingValue(ventureKit, "version", "version"),
    ventureKitHash: bindingValue(value, "ventureKitHash", "venture_kit_hash")
      ?? bindingValue(ventureKit, "hash", "hash"),
    offerId: bindingValue(value, "offerId", "offer_id")
      ?? bindingValue(offer, "id", "id"),
    offerVersion: bindingValue(value, "offerVersion", "offer_version")
      ?? bindingValue(offer, "version", "version"),
    offerHash: bindingValue(value, "offerHash", "offer_hash")
      ?? bindingValue(offer, "hash", "hash"),
    offerSku: bindingValue(value, "offerSku", "offer_sku")
      ?? bindingValue(offer, "sku", "sku"),
    experimentId: bindingValue(value, "experimentId", "experiment_id")
      ?? bindingValue(experiment, "id", "id"),
    experimentVersion: bindingValue(value, "experimentVersion", "experiment_version")
      ?? bindingValue(experiment, "version", "version"),
    cohortId: bindingValue(value, "cohortId", "cohort_id")
      ?? bindingValue(cohort, "id", "id"),
  };
}

function looksLikeBinding(value) {
  if (!isObject(value)) return false;
  return [
    "contractSchema",
    "contract_schema",
    "decisionHash",
    "decision_hash",
    "programId",
    "program_id",
    "testId",
    "test_id",
  ].some((key) => Object.hasOwn(value, key))
    || value.schema === COMMERCIAL_TEST_CONTRACT_SCHEMA_V2;
}

function collectBindingCandidates(value, options = {}) {
  const candidates = [];
  const seen = new Set();

  function visit(node, path, depth, forced = false) {
    if (depth > 8 || node === null || node === undefined) return;
    if (typeof node === "string") {
      const trimmed = node.trim();
      if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return;
      try {
        visit(JSON.parse(trimmed), path, depth + 1, forced);
      } catch {
        if (forced) candidates.push({ path, raw: node, binding: null });
      }
      return;
    }
    if (Array.isArray(node)) {
      for (let index = 0; index < node.length; index += 1) {
        visit(node[index], `${path}[${index}]`, depth + 1, forced);
      }
      return;
    }
    if (!isObject(node) || seen.has(node)) return;
    seen.add(node);

    if (forced || looksLikeBinding(node)) {
      candidates.push({ path, raw: node, binding: normalizeBinding(node) });
    }
    for (const [key, child] of Object.entries(node)) {
      if (BINDING_KEYS.has(key)) {
        visit(child, `${path}.${key}`, depth + 1, true);
      } else if (BINDING_CONTAINER_KEYS.has(key)) {
        visit(child, `${path}.${key}`, depth + 1, false);
      }
    }
  }

  visit(value, options.path || "$", 0, options.forced === true);
  return candidates;
}

function validateBindingShape(binding) {
  if (!binding) return { valid: false, missing: ["binding"] };
  const required = [
    "contractSchema",
    "decisionHash",
    "programId",
    "programVersion",
    "testId",
    "testVersion",
    "ventureId",
    "ventureKitId",
    "ventureKitHash",
    "offerId",
    "offerVersion",
    "offerHash",
    "offerSku",
    "experimentId",
    "experimentVersion",
    "cohortId",
  ];
  const missing = required.filter(
    (field) => typeof binding[field] !== "string" || binding[field].trim() === "",
  );
  if (
    binding.contractSchema
    && binding.contractSchema !== COMMERCIAL_TEST_CONTRACT_SCHEMA_V2
  ) {
    missing.push("contractSchema(v2)");
  }
  if (binding.decisionHash && !HASH_PATTERN.test(binding.decisionHash)) {
    missing.push("decisionHash(sha256)");
  }
  if (
    !Number.isSafeInteger(Number(binding.ventureKitVersion))
    || Number(binding.ventureKitVersion) < 1
  ) {
    missing.push("ventureKitVersion(positive integer)");
  }
  if (
    binding.ventureKitHash
    && !HASH_PATTERN.test(String(binding.ventureKitHash))
  ) {
    missing.push("ventureKitHash(sha256)");
  }
  if (binding.offerHash && !HASH_PATTERN.test(String(binding.offerHash))) {
    missing.push("offerHash(sha256)");
  }
  return { valid: missing.length === 0, missing: [...new Set(missing)] };
}

function stableBindingKey(binding) {
  return JSON.stringify([
    binding.contractSchema,
    binding.decisionHash,
    binding.programId,
    binding.programVersion,
    binding.testId,
    binding.testVersion,
    binding.ventureId,
    binding.ventureKitId ?? null,
    binding.ventureKitVersion ?? null,
    binding.ventureKitHash ?? null,
    binding.offerId ?? null,
    binding.offerVersion ?? null,
    binding.offerHash ?? null,
    binding.offerSku ?? null,
    binding.experimentId ?? null,
    binding.experimentVersion ?? null,
    binding.cohortId ?? null,
  ]);
}

function inspectBindings(value, path = "$") {
  const candidates = collectBindingCandidates(value, { path });
  if (candidates.length === 0) {
    return { status: "missing", binding: null, candidates: [], missing: [] };
  }
  const invalid = candidates
    .map((candidate) => ({
      ...candidate,
      validation: validateBindingShape(candidate.binding),
    }))
    .filter((candidate) => !candidate.validation.valid);
  if (invalid.length > 0) {
    return {
      status: "invalid",
      binding: null,
      candidates,
      missing: [...new Set(invalid.flatMap((candidate) => candidate.validation.missing))],
    };
  }
  const unique = new Map();
  for (const candidate of candidates) {
    unique.set(stableBindingKey(candidate.binding), candidate.binding);
  }
  if (unique.size > 1) {
    return {
      status: "conflict",
      binding: null,
      candidates,
      missing: [],
    };
  }
  return {
    status: "valid",
    binding: [...unique.values()][0],
    candidates,
    missing: [],
  };
}

function extractCommercialTestBinding(value) {
  const inspection = inspectBindings(value);
  return inspection.status === "valid" ? inspection.binding : null;
}

function collectLegacySpecIds(value) {
  const found = new Set();
  const seen = new Set();

  function visit(node, depth) {
    if (depth > 10 || node === null || node === undefined) return;
    if (typeof node === "string") {
      const trimmed = node.trim();
      if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return;
      try {
        visit(JSON.parse(trimmed), depth + 1);
      } catch {
        return;
      }
      return;
    }
    if (Array.isArray(node)) {
      for (const child of node) visit(child, depth + 1);
      return;
    }
    if (!isObject(node) || seen.has(node)) return;
    seen.add(node);

    if (
      typeof node.specId === "string"
      && (
        String(node.schema || "").includes("buyer-intent-validation")
        || Object.hasOwn(node, "externalActionsAllowed")
      )
    ) {
      found.add(node.specId);
    }
    for (const [key, child] of Object.entries(node)) {
      if (
        key === "buyerIntentValidation"
        && isObject(child)
        && typeof child.specId === "string"
      ) {
        found.add(child.specId);
      }
      visit(child, depth + 1);
    }
  }

  visit(value, 0);
  return [...found];
}

function terminalLegacySpec(specId) {
  const lifecycle = getBuyerIntentValidationSpecLifecycle(specId);
  if (!lifecycle) return null;
  const status = String(lifecycle.status || "").toLowerCase();
  if (
    lifecycle.reuseAllowed === false
    || status.includes("terminal")
    || status.includes("stopped")
    || status.includes("closed")
  ) {
    return { specId, lifecycle };
  }
  return null;
}

function querySubjectRow(db, table, id) {
  if (!id || !tableExists(db, table)) return null;
  return db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id) || null;
}

function directOrLoadedRow(db, direct, table, id) {
  if (isObject(direct)) return direct;
  return querySubjectRow(db, table, id);
}

function makeLayer(kind, row, field) {
  if (!row) return { kind, row: null, content: null, parseError: null };
  const parsed = parseJsonObject(row[field]);
  return {
    kind,
    id: row.id || null,
    row,
    content: parsed.value,
    parseError: parsed.error,
  };
}

function inferTargetKind(target) {
  if (typeof target === "string") return "workflow";
  if (!isObject(target)) return null;
  const explicit = target.targetType || target.resourceType;
  if (["workflow", "task", "experiment", "pack"].includes(explicit)) return explicit;
  if (target.pack || target.packId) return "pack";
  if (target.experiment || target.experimentId) return "experiment";
  if (target.task || target.taskId) return "task";
  if (target.workflow || target.workflowId) return "workflow";
  if (target.experiment_id && Object.hasOwn(target, "offer_page_copy")) return "pack";
  if (Object.hasOwn(target, "hypothesis") && Object.hasOwn(target, "metadata")) return "experiment";
  if (Object.hasOwn(target, "payload") && Object.hasOwn(target, "kind")) return "task";
  if (Object.hasOwn(target, "metadata") && Object.hasOwn(target, "type")) return "workflow";
  return null;
}

function subjectLayers(db, target) {
  if (isObject(target) && Object.hasOwn(target, "binding")) {
    return {
      layers: [{
        kind: "binding",
        id: null,
        row: target,
        content: target.binding,
        parseError: null,
      }],
      error: null,
    };
  }

  const kind = inferTargetKind(target);
  if (!kind) {
    return {
      layers: [],
      error: {
        code: "commercial_subject_not_found",
        details: { reason: "subject_kind_missing" },
      },
    };
  }
  const selector = typeof target === "string" ? { workflowId: target } : target;
  const layers = [];

  if (kind === "workflow") {
    const row = directOrLoadedRow(
      db,
      selector.workflow,
      "workflows",
      selector.workflowId || selector.id || (selector.type ? selector.id : null),
    );
    layers.push(makeLayer("workflow", row, "metadata"));
  }

  if (kind === "task") {
    const task = directOrLoadedRow(
      db,
      selector.task || (
        Object.hasOwn(selector, "payload") ? selector : null
      ),
      "tasks",
      selector.taskId || selector.id,
    );
    layers.push(makeLayer("task", task, "payload"));
    const workflowId = task?.workflow_id || selector.workflowId;
    const workflow = directOrLoadedRow(
      db,
      selector.workflow,
      "workflows",
      workflowId,
    );
    layers.push(makeLayer("workflow", workflow, "metadata"));
  }

  if (kind === "experiment") {
    const experiment = directOrLoadedRow(
      db,
      selector.experiment || (
        Object.hasOwn(selector, "hypothesis") ? selector : null
      ),
      "commercial_experiments",
      selector.experimentId || selector.id,
    );
    layers.push(makeLayer("experiment", experiment, "metadata"));
    const workflowId = experiment?.workflow_id || selector.workflowId;
    const workflow = directOrLoadedRow(
      db,
      selector.workflow,
      "workflows",
      workflowId,
    );
    layers.push(makeLayer("workflow", workflow, "metadata"));
  }

  if (kind === "pack") {
    const pack = directOrLoadedRow(
      db,
      selector.pack || (
        Object.hasOwn(selector, "experiment_id") ? selector : null
      ),
      "commercial_execution_packs",
      selector.packId || selector.id,
    );
    layers.push(makeLayer("pack", pack, "metadata"));
    const experiment = directOrLoadedRow(
      db,
      selector.experiment,
      "commercial_experiments",
      pack?.experiment_id || selector.experimentId,
    );
    layers.push(makeLayer("experiment", experiment, "metadata"));
    const workflowId = pack?.workflow_id || experiment?.workflow_id || selector.workflowId;
    const workflow = directOrLoadedRow(
      db,
      selector.workflow,
      "workflows",
      workflowId,
    );
    layers.push(makeLayer("workflow", workflow, "metadata"));
  }

  const missing = layers.filter((layer) => !layer.row);
  if (missing.length > 0) {
    return {
      layers,
      error: {
        code: "commercial_subject_not_found",
        details: {
          missingLayers: missing.map((layer) => layer.kind),
        },
      },
    };
  }
  return { layers, error: null };
}

function bindingMatchesContract(binding, contract) {
  const exactFields = [
    ["contractSchema", "contractSchema"],
    ["decisionHash", "decisionHash"],
    ["programId", "programId"],
    ["programVersion", "programVersion"],
    ["testId", "testId"],
    ["testVersion", "testVersion"],
    ["ventureId", "ventureId"],
    ["ventureKitId", "ventureKitId"],
    ["ventureKitVersion", "ventureKitVersion"],
    ["ventureKitHash", "ventureKitHash"],
    ["offerId", "offerId"],
    ["offerVersion", "offerVersion"],
    ["offerHash", "offerHash"],
    ["offerSku", "offerSku"],
    ["experimentId", "experimentId"],
    ["experimentVersion", "experimentVersion"],
    ["cohortId", "cohortId"],
  ];
  const mismatches = exactFields
    .filter(([bindingField, contractField]) => (
      binding[bindingField] !== contract.binding[contractField]
    ))
    .map(([bindingField]) => bindingField);
  return { matches: mismatches.length === 0, mismatches };
}

function assessmentFailure(code, authority, details = {}, message) {
  const definition = ERROR_DEFINITIONS[code] || ERROR_DEFINITIONS.commercial_authority_unavailable;
  return {
    schema: COMMERCIAL_AUTHORITY_SCHEMA,
    allowed: false,
    statusCode: definition.statusCode,
    code,
    message: message || definition.message,
    authority,
    program: null,
    binding: details.binding || null,
    details,
  };
}

function evaluateCommercialAuthority(db, target) {
  let resolved;
  try {
    resolved = subjectLayers(db, target);
  } catch (error) {
    return assessmentFailure(
      "commercial_authority_unavailable",
      authorityUnavailable("subject_resolution_failed", [error.message]),
      { reason: "subject_resolution_failed" },
    );
  }
  if (resolved.error) {
    return assessmentFailure(
      resolved.error.code,
      getCommercialAuthorityState(db),
      resolved.error.details,
    );
  }

  const terminalLegacy = resolved.layers
    .flatMap((layer) => collectLegacySpecIds(layer.content))
    .map(terminalLegacySpec)
    .find(Boolean);
  if (terminalLegacy) {
    return assessmentFailure(
      "commercial_program_terminal",
      getCommercialAuthorityState(db),
      {
        historicalSpecId: terminalLegacy.specId,
        lifecycleStatus: terminalLegacy.lifecycle.status,
        terminalAt: terminalLegacy.lifecycle.terminalAt || null,
      },
      "This work is tied to a permanently stopped historical validation specification.",
    );
  }

  const layerDescriptorInspections = resolved.layers.map((layer) => ({
    kind: layer.kind,
    id: layer.id,
    inspection: layer.parseError
      ? null
      : inspectCommercialExecutionIntent(layer.content, {
        path: `$.${layer.kind}`,
        executionRoot: layer.kind === "task",
        rootDescriptors: [{
          value: layer.row?.kind || layer.row?.type,
          surface: "action",
          path: `$.${layer.kind}.kind`,
        }],
        rootTexts: [
          layer.row?.kind,
          layer.row?.type,
          layer.row?.title,
        ],
      }),
  }));
  const unknownDescriptorLayer = layerDescriptorInspections.find(
    (layer) => layer.inspection?.unknownExternalDescriptors?.length > 0,
  );
  if (unknownDescriptorLayer) {
    return assessmentFailure(
      "commercial_execution_descriptor_unknown",
      getCommercialAuthorityState(db),
      {
        layer: unknownDescriptorLayer.kind,
        layerId: unknownDescriptorLayer.id,
        registrySchema: unknownDescriptorLayer.inspection.descriptorRegistrySchema,
        unknownExternalDescriptors:
          unknownDescriptorLayer.inspection.unknownExternalDescriptors,
      },
    );
  }

  const layerInspections = resolved.layers.map((layer) => ({
    kind: layer.kind,
    id: layer.id,
    parseError: layer.parseError,
    inspection: layer.parseError
      ? { status: "invalid", binding: null, candidates: [], missing: ["validJsonMetadata"] }
      : inspectBindings(layer.content, `$.${layer.kind}`),
  }));
  const invalidLayer = layerInspections.find(
    (layer) => layer.parseError || layer.inspection.status === "invalid",
  );
  if (invalidLayer) {
    return assessmentFailure(
      "commercial_binding_invalid",
      getCommercialAuthorityState(db),
      {
        layer: invalidLayer.kind,
        layerId: invalidLayer.id,
        missing: invalidLayer.inspection.missing,
      },
    );
  }
  const conflictingLayer = layerInspections.find(
    (layer) => layer.inspection.status === "conflict",
  );
  if (conflictingLayer) {
    return assessmentFailure(
      "commercial_binding_conflict",
      getCommercialAuthorityState(db),
      { layer: conflictingLayer.kind, layerId: conflictingLayer.id },
    );
  }
  const missingLayers = layerInspections.filter(
    (layer) => layer.inspection.status === "missing",
  );
  if (missingLayers.length > 0) {
    return assessmentFailure(
      "commercial_binding_required",
      getCommercialAuthorityState(db),
      { missingLayers: missingLayers.map((layer) => layer.kind) },
    );
  }

  const bindings = layerInspections.map((layer) => layer.inspection.binding);
  const uniqueBindings = new Map(
    bindings.map((binding) => [stableBindingKey(binding), binding]),
  );
  if (uniqueBindings.size > 1) {
    return assessmentFailure(
      "commercial_binding_conflict",
      getCommercialAuthorityState(db),
      { layers: layerInspections.map((layer) => layer.kind) },
    );
  }
  const binding = bindings[0];
  const authority = getCommercialAuthorityState(db);
  const boundContract = authority.contracts.find(
    (contract) => contract.decisionHash === binding.decisionHash,
  );

  if (authority.status === "unavailable" || authority.status === "invalid") {
    return assessmentFailure(
      "commercial_authority_unavailable",
      authority,
      { binding, reason: authority.reason },
    );
  }
  if (boundContract) {
    const match = bindingMatchesContract(binding, boundContract);
    if (!match.matches) {
      return assessmentFailure(
        "commercial_binding_mismatch",
        authority,
        { binding, mismatches: match.mismatches },
      );
    }
    if (boundContract.status === "terminal") {
      return assessmentFailure(
        "commercial_program_terminal",
        authority,
        {
          binding,
          terminalEvent: boundContract.terminalEvent,
        },
      );
    }
  }
  if (authority.status === "ambiguous") {
    return assessmentFailure(
      "commercial_authority_ambiguous",
      authority,
      { binding, activeCount: authority.counts.active },
    );
  }
  if (!boundContract || !authority.activeProgram) {
    return assessmentFailure(
      boundContract ? "commercial_program_inactive" : "commercial_binding_mismatch",
      authority,
      { binding },
    );
  }
  if (boundContract.status !== "active") {
    return assessmentFailure(
      "commercial_program_inactive",
      authority,
      { binding, lifecycleReason: boundContract.lifecycleReason },
    );
  }
  if (authority.activeProgram.decisionHash !== binding.decisionHash) {
    return assessmentFailure(
      "commercial_binding_mismatch",
      authority,
      { binding, activeDecisionHash: authority.activeProgram.decisionHash },
    );
  }

  const registeredExternalDescriptors = layerDescriptorInspections.flatMap(
    (layer) => (layer.inspection?.descriptorSignals || [])
      .filter((signal) => signal.classification === "commercial")
      .map((signal) => ({
        layer: layer.kind,
        layerId: layer.id,
        path: signal.path,
        surface: signal.surface,
        id: signal.id,
        category: signal.category,
      })),
  );
  if (registeredExternalDescriptors.length > 0) {
    return assessmentFailure(
      "commercial_protected_action_required",
      authority,
      {
        binding,
        registrySchema: EXTERNAL_EXECUTION_DESCRIPTOR_REGISTRY_SCHEMA,
        registeredExternalDescriptors,
        externalSpendCapCents: boundContract.externalSpendCapCents,
        protectedActions: boundContract.contract?.protectedActions || null,
      },
    );
  }

  return {
    schema: COMMERCIAL_AUTHORITY_SCHEMA,
    allowed: true,
    statusCode: 200,
    code: "commercial_authority_granted",
    message: "The requested work is bound to the one accepted active commercial program.",
    authority,
    program: authority.activeProgram,
    binding,
    details: {
      layers: layerInspections.map((layer) => ({
        kind: layer.kind,
        id: layer.id,
      })),
    },
  };
}

function assertCommercialAuthority(db, target) {
  const assessment = evaluateCommercialAuthority(db, target);
  if (!assessment.allowed) throw new CommercialAuthorityError(assessment);
  return assessment;
}

function commercialAuthorityErrorPayload(errorOrAssessment) {
  const assessment = errorOrAssessment instanceof CommercialAuthorityError
    ? errorOrAssessment.assessment
    : errorOrAssessment;
  const code = assessment?.code || errorOrAssessment?.code || "commercial_authority_unavailable";
  const definition = ERROR_DEFINITIONS[code] || ERROR_DEFINITIONS.commercial_authority_unavailable;
  const binding = assessment?.binding || assessment?.details?.binding || null;
  return {
    error: assessment?.message || errorOrAssessment?.message || definition.message,
    code,
    commercialAuthority: {
      schema: COMMERCIAL_AUTHORITY_SCHEMA,
      allowed: false,
      authorityStatus: assessment?.authority?.status || "unavailable",
      decisionHash: binding?.decisionHash || null,
      programId: binding?.programId || null,
    },
  };
}

function commercialRouteGuard(db, target) {
  const assessment = evaluateCommercialAuthority(db, target);
  if (assessment.allowed) return assessment;
  return {
    ...assessment,
    payload: commercialAuthorityErrorPayload(assessment),
  };
}

function isExactSeededDryRunFixture(workflow, metadata) {
  return (
    workflow.id === SEEDED_DRY_RUN_WORKFLOW_ID
    && workflow.venture_id === "venture-digital-products"
    && workflow.type === "digital_product_publish"
    && workflow.title === "Digital product pilot proof"
    && sameCanonical(metadata, SEEDED_DRY_RUN_WORKFLOW_METADATA)
  );
}

function isGenuineRuntimeAssurance(workflow, metadata, intent) {
  if (workflow.type !== "runtime_assurance") return false;
  if (intent?.commercial || intent?.unknownExternalDescriptors?.length) return false;
  if (!sameCanonical(metadata, { systemProof: true })) return false;
  return /\b(?:runtime|system|database|backup|recovery|health|monitor|integrity|assurance|diagnostic)\b/i
    .test(String(workflow.title || "").replace(/[_-]+/g, " "));
}

function unknownDescriptorSafety(intent, scope) {
  const definition = ERROR_DEFINITIONS.commercial_execution_descriptor_unknown;
  return {
    safe: false,
    safeToRun: false,
    classification: "commercial_execution_descriptor_unknown",
    requiresCommercialAuthority: true,
    statusCode: definition.statusCode,
    code: "commercial_execution_descriptor_unknown",
    message: definition.message,
    details: {
      scope,
      registrySchema: intent.descriptorRegistrySchema,
      unknownExternalDescriptors: intent.unknownExternalDescriptors,
    },
    intent,
  };
}

function classifyCommercialWorkflowSafety(db, workflowOrId) {
  let workflow;
  try {
    workflow = typeof workflowOrId === "string"
      ? querySubjectRow(db, "workflows", workflowOrId)
      : workflowOrId;
  } catch (error) {
    return {
      safe: false,
      safeToRun: false,
      classification: "authority_unavailable",
      requiresCommercialAuthority: false,
      statusCode: 409,
      code: "commercial_authority_unavailable",
      message: error.message,
    };
  }
  if (!isObject(workflow)) {
    return {
      safe: false,
      safeToRun: false,
      classification: "workflow_not_found",
      requiresCommercialAuthority: false,
      statusCode: 409,
      code: "commercial_subject_not_found",
      message: ERROR_DEFINITIONS.commercial_subject_not_found.message,
    };
  }
  const parsed = parseJsonObject(workflow.metadata);
  if (parsed.error) {
    return {
      safe: false,
      safeToRun: false,
      classification: "invalid_workflow_metadata",
      requiresCommercialAuthority: true,
      statusCode: 409,
      code: "commercial_binding_invalid",
      message: parsed.error,
    };
  }

  const metadata = parsed.value;
  const intent = inspectCommercialExecutionIntent(metadata, {
    path: "$.workflow.metadata",
    rootDescriptors: [{
      value: workflow.type,
      surface: "action",
      path: "$.workflow.type",
    }],
    rootTexts: [workflow.type, workflow.title],
  });
  if (intent.unknownExternalDescriptors.length > 0) {
    return unknownDescriptorSafety(intent, "workflow");
  }
  const bindingInspection = inspectBindings(metadata, "$.workflow");
  const legacySpecIds = collectLegacySpecIds(metadata);
  const hasCommercialBinding = bindingInspection.status !== "missing";
  const hasLegacyBinding = legacySpecIds.length > 0;

  if (hasCommercialBinding || hasLegacyBinding) {
    const assessment = evaluateCommercialAuthority(db, { workflow });
    return {
      safe: assessment.allowed,
      safeToRun: assessment.allowed,
      classification: assessment.allowed
        ? "authorized_commercial"
        : assessment.code,
      requiresCommercialAuthority: true,
      statusCode: assessment.statusCode,
      code: assessment.code,
      message: assessment.message,
      assessment,
      intent,
    };
  }
  if (isExactSeededDryRunFixture(workflow, metadata)) {
    return {
      safe: true,
      safeToRun: true,
      classification: "diagnostic",
      requiresCommercialAuthority: false,
      statusCode: 200,
      code: "diagnostic_workflow",
      message: "This is the exact seeded dry-run fixture and cannot perform external commercial work.",
      intent,
    };
  }
  if (intent.commercial) {
    const assessment = evaluateCommercialAuthority(db, { workflow });
    return {
      safe: false,
      safeToRun: false,
      classification: assessment.code,
      requiresCommercialAuthority: true,
      statusCode: assessment.statusCode,
      code: assessment.code,
      message: assessment.message,
      assessment,
      intent,
    };
  }
  if (isGenuineRuntimeAssurance(workflow, metadata, intent)) {
    return {
      safe: true,
      safeToRun: true,
      classification: "diagnostic",
      requiresCommercialAuthority: false,
      statusCode: 200,
      code: "diagnostic_workflow",
      message: "This is a non-commercial runtime assurance workflow.",
      intent,
    };
  }
  return {
    safe: true,
    safeToRun: true,
    classification: "non_commercial",
    requiresCommercialAuthority: false,
    statusCode: 200,
    code: "non_commercial_workflow",
    message: "This workflow has no commercial claim or external commercial binding.",
    intent,
  };
}

function isExactSeededDryRunTaskFixture(task, workflow, payload) {
  const workflowMetadata = parseJsonObject(workflow?.metadata).value;
  return Boolean(
    task?.id === SEEDED_DRY_RUN_TASK_ID
      && task.workflow_id === SEEDED_DRY_RUN_WORKFLOW_ID
      && task.venture_id === "venture-digital-products"
      && task.title === "Prepare digital product listing and delivery plan in dry-run mode"
      && task.kind === "publish_digital_product_dry_run"
      && task.agent === "publisher"
      && task.approval_id === "appr-digital-product-dry-run"
      && task.max_retries === 2
      && sameCanonical(payload, SEEDED_DRY_RUN_TASK_PAYLOAD)
      && workflowMetadata
      && isExactSeededDryRunFixture(workflow, workflowMetadata)
  );
}

function executeSeededDryRunHandler(workflow, options) {
  if (!sameCanonical(options, SEEDED_DRY_RUN_EXECUTION_OPTIONS)) {
    const error = new Error(
      "The seeded digital-product proof can only execute the fixed local dry-run options.",
    );
    error.code = "seeded_dry_run_execution_contract_mismatch";
    error.statusCode = 409;
    throw error;
  }
  const products = Array.isArray(workflow.metadata?.products)
    ? workflow.metadata.products
    : [];
  return {
    provider: "digital-products",
    mode: "dry-run",
    externalId: `dry_digital_seed_${workflow.id}`,
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

function prepareSeededDryRunExecutionContract(task, workflow, options) {
  const taskPayload = parseJsonObject(task?.payload);
  const workflowMetadata = parseJsonObject(workflow?.metadata);
  if (taskPayload.error || workflowMetadata.error) return null;
  const hydratedWorkflow = {
    ...workflow,
    metadata: workflowMetadata.value,
  };
  if (
    !isExactSeededDryRunTaskFixture(
      task,
      hydratedWorkflow,
      taskPayload.value,
    )
  ) {
    return null;
  }
  if (!sameCanonical(options, SEEDED_DRY_RUN_EXECUTION_OPTIONS)) {
    const error = new Error(
      "The seeded digital-product proof execution options do not match the reviewed local dry-run contract.",
    );
    error.code = "seeded_dry_run_execution_contract_mismatch";
    error.statusCode = 409;
    throw error;
  }

  const workflowSnapshot = deepFreeze(canonical({
    id: hydratedWorkflow.id,
    venture_id: hydratedWorkflow.venture_id,
    type: hydratedWorkflow.type,
    title: hydratedWorkflow.title,
    metadata: hydratedWorkflow.metadata,
  }));
  const executionOptions = deepFreeze(canonical(
    SEEDED_DRY_RUN_EXECUTION_OPTIONS,
  ));
  let consumed = false;
  return Object.freeze({
    schema: SEEDED_DRY_RUN_EXECUTION_CONTRACT_SCHEMA,
    handlerId: "pantheon.seeded-digital-product-local-dry-run.v1",
    options: executionOptions,
    externalEffectsAllowed: false,
    execute() {
      if (consumed) {
        const error = new Error(
          "The seeded digital-product proof execution contract is single use.",
        );
        error.code = "seeded_dry_run_execution_contract_consumed";
        error.statusCode = 409;
        throw error;
      }
      consumed = true;
      return executeSeededDryRunHandler(
        workflowSnapshot,
        executionOptions,
      );
    },
  });
}

function classifyCommercialTaskSafety(db, taskOrId) {
  let task;
  try {
    task = typeof taskOrId === "string"
      ? querySubjectRow(db, "tasks", taskOrId)
      : taskOrId;
  } catch (error) {
    return {
      safe: false,
      safeToRun: false,
      classification: "authority_unavailable",
      requiresCommercialAuthority: false,
      statusCode: 409,
      code: "commercial_authority_unavailable",
      message: error.message,
    };
  }
  if (!isObject(task)) {
    return {
      safe: false,
      safeToRun: false,
      classification: "task_not_found",
      requiresCommercialAuthority: false,
      statusCode: 409,
      code: "commercial_subject_not_found",
      message: ERROR_DEFINITIONS.commercial_subject_not_found.message,
    };
  }
  const workflow = querySubjectRow(db, "workflows", task.workflow_id);
  if (!workflow) {
    return {
      safe: false,
      safeToRun: false,
      classification: "workflow_not_found",
      requiresCommercialAuthority: false,
      statusCode: 409,
      code: "commercial_subject_not_found",
      message: ERROR_DEFINITIONS.commercial_subject_not_found.message,
    };
  }
  const parsed = parseJsonObject(task.payload);
  if (parsed.error) {
    return {
      safe: false,
      safeToRun: false,
      classification: "invalid_task_payload",
      requiresCommercialAuthority: true,
      statusCode: 409,
      code: "commercial_binding_invalid",
      message: parsed.error,
    };
  }

  const payload = parsed.value;
  const intent = inspectCommercialExecutionIntent(payload, {
    path: "$.task.payload",
    executionRoot: true,
    rootDescriptors: [{
      value: task.kind,
      surface: "action",
      path: "$.task.kind",
    }],
    rootTexts: [task.kind, task.title],
  });
  if (intent.unknownExternalDescriptors.length > 0) {
    return unknownDescriptorSafety(intent, "task");
  }
  const workflowSafety = classifyCommercialWorkflowSafety(db, workflow);
  if (
    workflowSafety.safe
    && workflowSafety.classification === "diagnostic"
    && isExactSeededDryRunTaskFixture(task, workflow, payload)
  ) {
    const executionContract = prepareSeededDryRunExecutionContract(
      task,
      workflow,
      SEEDED_DRY_RUN_EXECUTION_OPTIONS,
    );
    return {
      safe: true,
      safeToRun: true,
      classification: "diagnostic",
      requiresCommercialAuthority: false,
      statusCode: 200,
      code: "diagnostic_task",
      message: "This is the exact seeded dry-run task and cannot perform an external commercial action.",
      executionContract,
      workflowSafety,
      intent,
    };
  }

  const bindingInspection = inspectBindings(payload, "$.task");
  const hasCommercialBinding = bindingInspection.status !== "missing";
  const hasLegacyBinding = collectLegacySpecIds(payload).length > 0;
  const requiresCommercialAuthority = Boolean(
    workflowSafety.requiresCommercialAuthority
      || hasCommercialBinding
      || hasLegacyBinding
      || intent.commercial
  );

  if (!workflowSafety.safe) {
    return {
      ...workflowSafety,
      requiresCommercialAuthority,
      workflowSafety,
      intent,
    };
  }
  if (!requiresCommercialAuthority) {
    return {
      safe: true,
      safeToRun: true,
      classification: workflowSafety.classification === "diagnostic"
        ? "diagnostic"
        : "non_commercial",
      requiresCommercialAuthority: false,
      statusCode: 200,
      code: workflowSafety.classification === "diagnostic"
        ? "diagnostic_task"
        : "non_commercial_task",
      message: "This task has no commercial action, effect, tool, or external commercial binding.",
      workflowSafety,
      intent,
    };
  }

  const assessment = evaluateCommercialAuthority(db, { task });
  return {
    safe: assessment.allowed,
    safeToRun: assessment.allowed,
    classification: assessment.allowed
      ? "authorized_commercial"
      : assessment.code,
    requiresCommercialAuthority: true,
    statusCode: assessment.statusCode,
    code: assessment.code,
    message: assessment.message,
    assessment,
    workflowSafety,
    intent,
  };
}

const classifySafeWorkflow = classifyCommercialWorkflowSafety;
const requireCommercialAuthority = assertCommercialAuthority;

module.exports = {
  COMMERCIAL_AUTHORITY_SCHEMA,
  COMMERCIAL_LIFECYCLE_APPROVAL_SCOPE_SCHEMA,
  COMMERCIAL_LIFECYCLE_EVENT_SCHEMA,
  COMMERCIAL_OPERATOR_ROLE,
  COMMERCIAL_TEST_CONTRACT_SCHEMA_V2,
  EXTERNAL_EXECUTION_DESCRIPTOR_REGISTRY_SCHEMA,
  SEEDED_DRY_RUN_EXECUTION_CONTRACT_SCHEMA,
  CommercialAuthorityError,
  LIFECYCLE_EVENT_TYPES,
  assertCommercialAuthority,
  classifyCommercialTaskSafety,
  classifyCommercialWorkflowSafety,
  classifySafeWorkflow,
  commercialLifecycleApprovalScope,
  commercialLifecycleApprovalScopeHash,
  commercialAuthorityErrorPayload,
  commercialRouteGuard,
  createCommercialLifecycleEvent,
  evaluateCommercialAuthority,
  extractCommercialTestBinding,
  getCommercialAuthorityState,
  inspectCommercialExecutionIntent,
  prepareSeededDryRunExecutionContract,
  requireCommercialAuthority,
  resolveAcceptedActiveCommercialProgram,
};
