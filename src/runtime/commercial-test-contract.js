"use strict";

const crypto = require("node:crypto");

const COMMERCIAL_TEST_CONTRACT_SCHEMA = "pantheon.commercial-test-contract.v2";
const COMMERCIAL_TEST_EVIDENCE_SCHEMA = "pantheon.commercial-test-evidence.v2";
const COMMERCIAL_TEST_PROOF_SCHEMA = "pantheon.commercial-test-proof-evaluation.v2";
const OPERATOR_ROLE = "approvals_and_guidance_only";
const PREPARATION_EXTERNAL_SPEND_CAP_AUD = 0;

const PROTECTED_ACTION_KEYS = Object.freeze([
  "public_publishing",
  "first_stage_customer_contact",
  "account_creation",
  "kyc_oauth_or_mfa",
  "paid_advertising_activation",
  "money_movement",
  "legal_agreements",
  "consequential_disputes",
]);

const COST_CATEGORIES = Object.freeze([
  "platform_fees",
  "payment_fees",
  "tax",
  "advertising",
  "fulfilment",
  "paid_tools",
  "model_usage",
  "other_attributable",
]);

const EVIDENCE_SOURCE_KINDS = Object.freeze([
  "imported_platform",
  "operator_attested_manual",
]);

const EVIDENCE_KINDS = Object.freeze([
  "transaction",
  "cost",
  "manual_verification",
  "terminal_stop",
  "evidence_set_manifest",
]);

const VERIFICATION_STATUSES = Object.freeze(["pending", "verified", "rejected"]);
const COST_STATES = Object.freeze(["unknown", "estimated", "incurred", "reconciled"]);
const TRANSACTION_STATUSES = Object.freeze([
  "pending",
  "settled",
  "refunded",
  "disputed",
  "cancelled",
]);
const TRANSACTION_EVENT_TYPES = Object.freeze([
  "original",
  "correction",
  "refund",
  "reversal",
]);
const SETTLEMENT_STATES = Object.freeze([
  "pending",
  "platform_balance",
  "cash_settled",
  "unknown",
  "not_applicable",
]);
const COST_EVENT_TYPES = Object.freeze(["original", "correction", "reversal"]);
const DECISION_RULE_KEYS = Object.freeze(["pass", "revise", "inconclusive", "stop"]);

const HASH_PATTERN = /^sha256:[a-f0-9]{64}$/;
const BUYER_PATTERN = /^buyer_[a-f0-9]{64}$/;
const SAFE_ID_PATTERN = /^[a-z0-9][a-z0-9._:-]{0,127}$/i;
const CURRENCY_PATTERN = /^[A-Z]{3}$/;
const RAW_CONTACT_KEY_PATTERN = /(?:email|phone|address|contact|firstname|lastname|fullname|customername|buyername|billingname|shippingname|rawcontact)$/i;
const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const PHONE_PATTERN = /(?:^|\s)\+?\d[\d ()-]{7,}\d(?:$|\s)/;

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

function sameCanonical(left, right) {
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
}

function sha256(value) {
  const bytes = Buffer.isBuffer(value)
    ? value
    : Buffer.from(JSON.stringify(canonical(value)), "utf8");
  return `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

function cleanText(value, label, minimumLength = 1) {
  const result = String(value ?? "").replace(/\s+/g, " ").trim();
  if (result.length < minimumLength) {
    throw new Error(`${label} must contain at least ${minimumLength} character${minimumLength === 1 ? "" : "s"}.`);
  }
  return result;
}

function safeId(value, label) {
  const result = cleanText(value, label);
  if (!SAFE_ID_PATTERN.test(result)) {
    throw new Error(`${label} must be a stable non-contact identifier.`);
  }
  return result;
}

function exactHash(value, label) {
  const result = cleanText(value, label).toLowerCase();
  if (!HASH_PATTERN.test(result)) {
    throw new Error(`${label} must be a sha256-prefixed lowercase digest.`);
  }
  return result;
}

function safeInteger(value, label, options = {}) {
  const result = Number(value);
  const minimum = options.minimum ?? Number.MIN_SAFE_INTEGER;
  const maximum = options.maximum ?? Number.MAX_SAFE_INTEGER;
  if (!Number.isSafeInteger(result) || result < minimum || result > maximum) {
    throw new Error(`${label} must be a safe whole number between ${minimum} and ${maximum}.`);
  }
  return result;
}

function positiveInteger(value, label) {
  return safeInteger(value, label, { minimum: 1 });
}

function utcTimestamp(value, label) {
  if (typeof value !== "string") {
    throw new Error(`${label} must be a canonical UTC timestamp.`);
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new Error(`${label} must be a canonical UTC timestamp ending in Z.`);
  }
  return value;
}

function normalizedPeriod(value, label) {
  if (!isObject(value)) throw new Error(`${label} must be an object.`);
  const result = {
    startsAt: utcTimestamp(value.startsAt, `${label}.startsAt`),
    endsAt: utcTimestamp(value.endsAt, `${label}.endsAt`),
  };
  if (Date.parse(result.endsAt) <= Date.parse(result.startsAt)) {
    throw new Error(`${label}.endsAt must be later than startsAt.`);
  }
  return result;
}

function uniqueSortedStrings(value, label, normalizer = cleanText) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${label} must be a non-empty list.`);
  }
  const result = value.map((item, index) => normalizer(item, `${label}[${index}]`)).sort();
  if (new Set(result).size !== result.length) {
    throw new Error(`${label} must not contain duplicates.`);
  }
  return result;
}

function exactSet(value, expected, label) {
  const result = uniqueSortedStrings(value, label);
  const required = [...expected].sort();
  if (!sameCanonical(result, required)) {
    throw new Error(`${label} must contain exactly: ${required.join(", ")}.`);
  }
  return result;
}

function normalizedProtectedActions(value) {
  if (!isObject(value)) throw new Error("protectedActions must be an object.");
  const unknown = Object.keys(value).filter((key) => !PROTECTED_ACTION_KEYS.includes(key));
  if (unknown.length) {
    throw new Error(`protectedActions contains unsupported flags: ${unknown.join(", ")}.`);
  }
  return Object.fromEntries(PROTECTED_ACTION_KEYS.map((key) => {
    if (value[key] !== true) {
      throw new Error(`protectedActions.${key} must remain true during preparation.`);
    }
    return [key, true];
  }));
}

function normalizedRule(value, name) {
  if (!isObject(value)) throw new Error(`decisionRules.${name} must be an object.`);
  return {
    criteria: uniqueSortedStrings(
      value.criteria,
      `decisionRules.${name}.criteria`,
      (item, label) => cleanText(item, label, 3),
    ),
    nextAction: cleanText(value.nextAction, `decisionRules.${name}.nextAction`, 3),
  };
}

function normalizedDecisionRules(value) {
  if (!isObject(value)) throw new Error("decisionRules must be an object.");
  const unknown = Object.keys(value).filter(
    (key) => !DECISION_RULE_KEYS.includes(key) && key !== "proofThreshold",
  );
  if (unknown.length) {
    throw new Error(`decisionRules contains unsupported rules: ${unknown.join(", ")}.`);
  }
  const expectedThreshold = {
    minPositiveIndependentBuyers: 3,
    requiresPositiveActualAudNetCashContribution: true,
    requiresClosedEvidenceManifest: true,
    requiresSettledCashRevenue: true,
    requiresReconciledCashCosts: true,
  };
  if (value.proofThreshold && !sameCanonical(value.proofThreshold, expectedThreshold)) {
    throw new Error("decisionRules.proofThreshold cannot weaken Pantheon's proof gate.");
  }
  return {
    ...Object.fromEntries(
      DECISION_RULE_KEYS.map((key) => [key, normalizedRule(value[key], key)]),
    ),
    proofThreshold: expectedThreshold,
  };
}

function normalizedOffer(value, label = "offer") {
  if (!isObject(value)) throw new Error(`${label} must be an object.`);
  const result = {
    id: safeId(value.id, `${label}.id`),
    version: safeId(value.version, `${label}.version`),
    sku: safeId(value.sku, `${label}.sku`),
    description: cleanText(value.description, `${label}.description`, 3),
    contentHash: exactHash(value.contentHash, `${label}.contentHash`),
  };
  result.hash = exactHash(value.hash, `${label}.hash`);
  if (result.hash !== offerDefinitionHash(result)) {
    throw new Error(`${label}.hash must match the canonical offer definition and retained content hash.`);
  }
  return result;
}

function offerDefinitionHash(value) {
  return sha256({
    domain: "pantheon.commercial-offer-definition.v1",
    id: safeId(value.id, "offer.id"),
    version: safeId(value.version, "offer.version"),
    sku: safeId(value.sku, "offer.sku"),
    description: cleanText(value.description, "offer.description", 3),
    contentHash: exactHash(value.contentHash, "offer.contentHash"),
  });
}

function normalizedVentureKit(value, label = "ventureKit") {
  if (!isObject(value)) throw new Error(`${label} must be an object.`);
  return {
    id: safeId(value.id, `${label}.id`),
    version: positiveInteger(value.version, `${label}.version`),
    hash: exactHash(value.hash, `${label}.hash`),
  };
}

function normalizedAdapter(value, label = "adapter") {
  if (!isObject(value)) throw new Error(`${label} must be an object.`);
  return {
    id: safeId(value.id, `${label}.id`),
    version: safeId(value.version, `${label}.version`),
    hash: exactHash(value.hash, `${label}.hash`),
  };
}

function normalizedRequiredSource(value, index) {
  const label = `evidenceRules.requiredSources[${index}]`;
  if (!isObject(value)) throw new Error(`${label} must be an object.`);
  return {
    id: safeId(value.id, `${label}.id`),
    acceptedKinds: exactSet(
      value.acceptedKinds,
      EVIDENCE_SOURCE_KINDS,
      `${label}.acceptedKinds`,
    ),
    providerNamespace: safeId(value.providerNamespace, `${label}.providerNamespace`),
    accountHash: exactHash(value.accountHash, `${label}.accountHash`),
    sourceSystem: safeId(value.sourceSystem, `${label}.sourceSystem`),
    exportType: safeId(value.exportType, `${label}.exportType`),
  };
}

function normalizedEvidenceRules(value, channel) {
  if (!isObject(value)) throw new Error("evidenceRules must be an object.");
  const requiredTrue = [
    "sourceHashRequired",
    "sourceRowHashRequired",
    "receiptRequired",
    "manualVerificationRequired",
    "closedPeriodManifestRequired",
    "unknownCostsBlockProof",
    "estimatedCostsBlockProof",
    "incurredCostsBlockProof",
    "rejectedEvidenceBlocksProof",
    "outOfScopeEvidenceBlocksProof",
  ];
  for (const key of requiredTrue) {
    if (value[key] !== true) throw new Error(`evidenceRules.${key} must be true.`);
  }
  if (value.transactionDeduplication !== "provider_account_transaction_hash") {
    throw new Error("evidenceRules.transactionDeduplication must be provider_account_transaction_hash.");
  }
  if (value.buyerPseudonymization !== "contract_bound_hmac_sha256") {
    throw new Error("evidenceRules.buyerPseudonymization must be contract_bound_hmac_sha256.");
  }
  const requiredSources = (value.requiredSources || [])
    .map(normalizedRequiredSource)
    .sort((left, right) => left.id.localeCompare(right.id));
  if (!requiredSources.length || new Set(requiredSources.map((source) => source.id)).size !== requiredSources.length) {
    throw new Error("evidenceRules.requiredSources must contain unique, exact source definitions.");
  }
  for (const source of requiredSources) {
    if (
      source.providerNamespace !== channel.providerNamespace
      || source.accountHash !== channel.accountHash
    ) {
      throw new Error("Every required evidence source must use the contract's one provider and hashed account.");
    }
  }
  return {
    acceptedSourceKinds: exactSet(
      value.acceptedSourceKinds,
      EVIDENCE_SOURCE_KINDS,
      "evidenceRules.acceptedSourceKinds",
    ),
    requiredCostCategories: exactSet(
      value.requiredCostCategories,
      COST_CATEGORIES,
      "evidenceRules.requiredCostCategories",
    ),
    requiredSources,
    sourceHashRequired: true,
    sourceRowHashRequired: true,
    receiptRequired: true,
    manualVerificationRequired: true,
    closedPeriodManifestRequired: true,
    transactionDeduplication: "provider_account_transaction_hash",
    buyerPseudonymization: "contract_bound_hmac_sha256",
    unknownCostsBlockProof: true,
    estimatedCostsBlockProof: true,
    incurredCostsBlockProof: true,
    rejectedEvidenceBlocksProof: true,
    outOfScopeEvidenceBlocksProof: true,
  };
}

function normalizedContract(input) {
  if (!isObject(input)) throw new Error("Commercial test contract input must be an object.");
  if (input.schema !== undefined && input.schema !== COMMERCIAL_TEST_CONTRACT_SCHEMA) {
    throw new Error(`Commercial test contract schema must be ${COMMERCIAL_TEST_CONTRACT_SCHEMA}.`);
  }
  if (input.channels !== undefined) {
    throw new Error("Commercial test contract v2 binds exactly one channel.");
  }
  if (input.operatorRole !== OPERATOR_ROLE) {
    throw new Error(`operatorRole must be ${OPERATOR_ROLE}.`);
  }
  if (input.externalSpendCapAud !== PREPARATION_EXTERNAL_SPEND_CAP_AUD) {
    throw new Error("externalSpendCapAud must remain 0 during preparation.");
  }

  const ventureKit = normalizedVentureKit(input.ventureKit);
  const offer = normalizedOffer(input.offer);
  if (input.offerId !== offer.id) {
    throw new Error("offerId must match offer.id.");
  }
  const reportingPeriod = normalizedPeriod(input.reportingPeriod, "reportingPeriod");
  const attributionWindow = normalizedPeriod(
    input.attributionRules?.window,
    "attributionRules.window",
  );
  if (
    Date.parse(attributionWindow.startsAt) < Date.parse(reportingPeriod.startsAt)
    || Date.parse(attributionWindow.endsAt) > Date.parse(reportingPeriod.endsAt)
  ) {
    throw new Error("The UTC attribution window must stay within the reporting period.");
  }
  if (!isObject(input.channel)) throw new Error("channel must identify exactly one channel.");
  const channel = {
    id: safeId(input.channel.id, "channel.id"),
    providerNamespace: safeId(
      input.channel.providerNamespace,
      "channel.providerNamespace",
    ),
    accountHash: exactHash(input.channel.accountHash, "channel.accountHash"),
    adapter: normalizedAdapter(input.channel.adapter, "channel.adapter"),
  };
  if (!isObject(input.price) || input.price.currency !== "AUD") {
    throw new Error("price must be an AUD price expressed in integer cents.");
  }
  const amountMinorUnits = safeInteger(input.price.amountMinorUnits, "price.amountMinorUnits", {
    minimum: 1,
  });
  const amountAudCents = safeInteger(input.price.amountAudCents, "price.amountAudCents", {
    minimum: 1,
  });
  if (amountMinorUnits !== amountAudCents) {
    throw new Error("Native AUD price minor units must exactly equal AUD cents.");
  }
  if (!isObject(input.buyerIdentity)) throw new Error("buyerIdentity must be an object.");
  if (input.buyerIdentity.method !== "hmac_sha256") {
    throw new Error("buyerIdentity.method must be hmac_sha256.");
  }
  if (!isObject(input.experiment)) throw new Error("experiment must be an object.");
  if (!isObject(input.cohort)) throw new Error("cohort must be an object.");
  if (!isObject(input.attributionRules)) throw new Error("attributionRules must be an object.");
  if (input.attributionRules.unresolvedOutcome !== "inconclusive") {
    throw new Error("attributionRules.unresolvedOutcome must be inconclusive.");
  }
  const allowedTouchpoints = uniqueSortedStrings(
    input.attributionRules.allowedTouchpoints,
    "attributionRules.allowedTouchpoints",
    safeId,
  );
  const requiredTouchpoints = uniqueSortedStrings(
    input.attributionRules.requiredTouchpoints,
    "attributionRules.requiredTouchpoints",
    safeId,
  );
  for (const touchpoint of requiredTouchpoints) {
    if (!allowedTouchpoints.includes(touchpoint)) {
      throw new Error("Every required touchpoint must also be allowed.");
    }
  }

  const normalized = {
    schema: COMMERCIAL_TEST_CONTRACT_SCHEMA,
    programId: safeId(input.programId, "programId"),
    programVersion: safeId(input.programVersion, "programVersion"),
    testId: safeId(input.testId, "testId"),
    testVersion: safeId(input.testVersion, "testVersion"),
    ventureId: safeId(input.ventureId, "ventureId"),
    ventureKit,
    offerId: offer.id,
    offer,
    buyer: cleanText(input.buyer, "buyer", 3),
    problem: cleanText(input.problem, "problem", 3),
    experiment: {
      id: safeId(input.experiment.id, "experiment.id"),
      version: safeId(input.experiment.version, "experiment.version"),
      hypothesis: cleanText(input.experiment.hypothesis, "experiment.hypothesis", 8),
      primaryMetric: safeId(input.experiment.primaryMetric, "experiment.primaryMetric"),
      deadlineAt: utcTimestamp(input.experiment.deadlineAt, "experiment.deadlineAt"),
    },
    cohort: {
      id: safeId(input.cohort.id, "cohort.id"),
      definition: cleanText(input.cohort.definition, "cohort.definition", 3),
    },
    reportingPeriod,
    channel,
    price: {
      currency: "AUD",
      amountMinorUnits,
      amountAudCents,
      conversion: {
        kind: "native_aud",
        minorUnitExponent: 2,
      },
    },
    buyerIdentity: {
      method: "hmac_sha256",
      keyId: safeId(input.buyerIdentity.keyId, "buyerIdentity.keyId"),
      keyVersion: positiveInteger(
        input.buyerIdentity.keyVersion,
        "buyerIdentity.keyVersion",
      ),
      independenceBasis: safeId(
        input.buyerIdentity.independenceBasis,
        "buyerIdentity.independenceBasis",
      ),
    },
    protectedActions: normalizedProtectedActions(input.protectedActions),
    attributionRules: {
      method: safeId(input.attributionRules.method, "attributionRules.method"),
      window: attributionWindow,
      allowedTouchpoints,
      requiredTouchpoints,
      unresolvedOutcome: "inconclusive",
    },
    evidenceRules: normalizedEvidenceRules(input.evidenceRules, channel),
    decisionRules: normalizedDecisionRules(input.decisionRules),
    operatorRole: OPERATOR_ROLE,
    externalSpendCapAud: PREPARATION_EXTERNAL_SPEND_CAP_AUD,
  };
  if (Date.parse(normalized.experiment.deadlineAt) < Date.parse(reportingPeriod.endsAt)) {
    throw new Error("experiment.deadlineAt cannot precede the reporting period end.");
  }
  normalized.decisionHash = sha256(normalized);
  if (
    input.decisionHash !== undefined
    && exactHash(input.decisionHash, "decisionHash") !== normalized.decisionHash
  ) {
    throw new Error("decisionHash does not match the immutable commercial test decision.");
  }
  return normalized;
}

function createCommercialTestContract(input) {
  return deepFreeze(normalizedContract(input));
}

function validateCommercialTestContract(contract) {
  const normalized = normalizedContract(contract);
  if (!sameCanonical(normalized, contract)) {
    throw new Error("Commercial test contract contains unsupported or non-normalized fields.");
  }
  return true;
}

function normalizedSecret(secret) {
  const bytes = Buffer.isBuffer(secret) ? secret : Buffer.from(String(secret ?? ""), "utf8");
  if (bytes.length < 16) {
    throw new Error("Buyer pseudonymization requires a secret of at least 16 bytes.");
  }
  return bytes;
}

function pseudonymizeBuyer(contract, buyerReference, secret) {
  validateCommercialTestContract(contract);
  const reference = cleanText(buyerReference, "buyerReference").toLowerCase();
  const binding = [
    contract.programId,
    contract.testId,
    contract.decisionHash,
    contract.buyerIdentity.keyId,
    contract.buyerIdentity.keyVersion,
    contract.buyerIdentity.independenceBasis,
    reference,
  ].join("\0");
  return `buyer_${crypto.createHmac("sha256", normalizedSecret(secret)).update(binding).digest("hex")}`;
}

function routeIndependentTransactionKey(providerNamespace, accountHash, rawTransactionId) {
  return transactionKeyFromIdHash(
    providerNamespace,
    accountHash,
    sha256({
      domain: "pantheon.raw-transaction-id.v1",
      rawTransactionId: cleanText(rawTransactionId, "rawTransactionId"),
    }),
  );
}

function transactionKeyFromIdHash(providerNamespace, accountHash, transactionIdHash) {
  return sha256({
    domain: "pantheon.route-independent-transaction-key.v1",
    providerNamespace: safeId(providerNamespace, "providerNamespace"),
    accountHash: exactHash(accountHash, "accountHash"),
    transactionIdHash: exactHash(transactionIdHash, "transactionIdHash"),
  });
}

function routeIndependentCostKey(providerNamespace, accountHash, rawCostId) {
  return costKeyFromIdHash(
    providerNamespace,
    accountHash,
    sha256({
      domain: "pantheon.raw-cost-id.v1",
      rawCostId: cleanText(rawCostId, "rawCostId"),
    }),
  );
}

function costKeyFromIdHash(providerNamespace, accountHash, costIdHash) {
  return sha256({
    domain: "pantheon.route-independent-cost-key.v1",
    providerNamespace: safeId(providerNamespace, "providerNamespace"),
    accountHash: exactHash(accountHash, "accountHash"),
    costIdHash: exactHash(costIdHash, "costIdHash"),
  });
}

function roundRationalHalfAwayFromZero(value, numerator, denominator) {
  const product = BigInt(value) * BigInt(numerator);
  const divisor = BigInt(denominator);
  const sign = product < 0n ? -1n : 1n;
  const absolute = product < 0n ? -product : product;
  const quotient = absolute / divisor;
  const remainder = absolute % divisor;
  const rounded = remainder * 2n >= divisor ? quotient + 1n : quotient;
  const result = rounded * sign;
  const numeric = Number(result);
  if (!Number.isSafeInteger(numeric)) {
    throw new Error("Converted AUD cents exceed JavaScript's safe integer range.");
  }
  return numeric;
}

function normalizedMoney(value, label, options = {}) {
  if (!isObject(value)) throw new Error(`${label} must be an object.`);
  const currency = cleanText(value.currency, `${label}.currency`).toUpperCase();
  if (!CURRENCY_PATTERN.test(currency)) {
    throw new Error(`${label}.currency must be a three-letter ISO currency code.`);
  }
  const minimum = options.allowNegative ? Number.MIN_SAFE_INTEGER : 0;
  const originalMinorUnits = safeInteger(
    value.originalMinorUnits,
    `${label}.originalMinorUnits`,
    { minimum },
  );
  const audCents = safeInteger(value.audCents, `${label}.audCents`, { minimum });
  if (!isObject(value.conversion)) throw new Error(`${label}.conversion must be an object.`);
  const minorUnitExponent = safeInteger(
    value.conversion.minorUnitExponent,
    `${label}.conversion.minorUnitExponent`,
    { minimum: 0, maximum: 6 },
  );
  let conversion;
  if (value.conversion.kind === "native_aud") {
    if (currency !== "AUD" || minorUnitExponent !== 2 || audCents !== originalMinorUnits) {
      throw new Error(`${label} native AUD evidence must explicitly use exponent 2 and exact cents.`);
    }
    conversion = { kind: "native_aud", minorUnitExponent: 2 };
  } else if (value.conversion.kind === "fx") {
    if (currency === "AUD") {
      throw new Error(`${label} AUD evidence must use native_aud conversion.`);
    }
    const rateNumerator = positiveInteger(
      value.conversion.rateNumerator,
      `${label}.conversion.rateNumerator`,
    );
    const rateDenominator = positiveInteger(
      value.conversion.rateDenominator,
      `${label}.conversion.rateDenominator`,
    );
    if (value.conversion.rounding !== "half_away_from_zero") {
      throw new Error(`${label}.conversion.rounding must be half_away_from_zero.`);
    }
    if (!isObject(value.conversion.source)) {
      throw new Error(`${label}.conversion.source must retain the FX evidence.`);
    }
    const expectedAudCents = roundRationalHalfAwayFromZero(
      originalMinorUnits,
      rateNumerator,
      rateDenominator,
    );
    if (audCents !== expectedAudCents) {
      throw new Error(`${label}.audCents does not reproduce from the retained FX rate.`);
    }
    conversion = {
      kind: "fx",
      minorUnitExponent,
      rateNumerator,
      rateDenominator,
      rounding: "half_away_from_zero",
      source: {
        provider: safeId(value.conversion.source.provider, `${label}.conversion.source.provider`),
        reference: safeId(
          value.conversion.source.reference,
          `${label}.conversion.source.reference`,
        ),
        sourceHash: exactHash(
          value.conversion.source.sourceHash,
          `${label}.conversion.source.sourceHash`,
        ),
        observedAt: utcTimestamp(
          value.conversion.source.observedAt,
          `${label}.conversion.source.observedAt`,
        ),
      },
    };
  } else {
    throw new Error(`${label}.conversion.kind must be native_aud or fx.`);
  }
  return { currency, originalMinorUnits, audCents, conversion };
}

function sourceCoverageHash(value) {
  return sha256({
    domain: "pantheon.commercial-source-coverage.v1",
    basis: cleanText(value.basis, "coverage.basis"),
    declaredRowCount: positiveInteger(
      value.declaredRowCount,
      "coverage.declaredRowCount",
    ),
    reportingPeriod: normalizedPeriod(value.reportingPeriod, "coverage.reportingPeriod"),
    sourceHash: exactHash(value.sourceHash, "coverage.sourceHash"),
    receiptHash: exactHash(value.receiptHash, "coverage.receiptHash"),
  });
}

function normalizedCoverage(value, context, label) {
  if (!isObject(value)) throw new Error(`${label} must be an object.`);
  const expectedBasis = context.kind === "imported_platform"
    ? "unfiltered_full_reporting_period"
    : "single_retained_source";
  if (value.basis !== expectedBasis) {
    throw new Error(`${label}.basis must be ${expectedBasis}.`);
  }
  const declaredRowCount = positiveInteger(
    value.declaredRowCount,
    `${label}.declaredRowCount`,
  );
  if (context.kind === "operator_attested_manual" && declaredRowCount !== 1) {
    throw new Error(`${label} manual retained sources must declare exactly one row.`);
  }
  const result = {
    basis: expectedBasis,
    declaredRowCount,
    controlHash: exactHash(value.controlHash, `${label}.controlHash`),
  };
  const expectedHash = sourceCoverageHash({
    ...result,
    reportingPeriod: context.reportingPeriod,
    sourceHash: context.sourceHash,
    receiptHash: context.receiptHash,
  });
  if (result.controlHash !== expectedHash) {
    throw new Error(`${label}.controlHash does not bind the source, receipt, period, and row count.`);
  }
  return result;
}

function ensureNoRawContactData(value, path = "evidence", allowEphemeral = false) {
  if (Array.isArray(value)) {
    value.forEach((child, index) => ensureNoRawContactData(child, `${path}[${index}]`, allowEphemeral));
    return;
  }
  if (!isObject(value)) return;
  for (const [key, child] of Object.entries(value)) {
    const compactKey = key.replace(/[^a-z]/gi, "").toLowerCase();
    if (
      RAW_CONTACT_KEY_PATTERN.test(compactKey)
      && !(allowEphemeral && key === "buyerReference")
    ) {
      throw new Error(`${path}.${key} must not contain raw buyer contact data.`);
    }
    if (allowEphemeral && ["buyerReference", "rawTransactionId", "rawCostId"].includes(key)) {
      continue;
    }
    if (typeof child === "string" && (EMAIL_PATTERN.test(child) || PHONE_PATTERN.test(child))) {
      throw new Error(`${path}.${key} appears to contain raw buyer contact data.`);
    }
    ensureNoRawContactData(child, `${path}.${key}`, allowEphemeral);
  }
}

function normalizedSource(source, label, options = {}) {
  if (!isObject(source)) throw new Error(`${label} must be an object.`);
  if (!EVIDENCE_SOURCE_KINDS.includes(source.kind)) {
    throw new Error(`${label}.kind must be one of: ${EVIDENCE_SOURCE_KINDS.join(", ")}.`);
  }
  if (!VERIFICATION_STATUSES.includes(source.verificationStatus)) {
    throw new Error(`${label}.verificationStatus must be pending, verified, or rejected.`);
  }
  if (!isObject(source.receipt)) throw new Error(`${label}.receipt must preserve an ID and hash.`);
  const result = {
    kind: source.kind,
    sourceId: safeId(source.sourceId, `${label}.sourceId`),
    providerNamespace: safeId(source.providerNamespace, `${label}.providerNamespace`),
    accountHash: exactHash(source.accountHash, `${label}.accountHash`),
    sourceSystem: safeId(source.sourceSystem, `${label}.sourceSystem`),
    exportType: safeId(source.exportType, `${label}.exportType`),
    sourceHash: exactHash(source.sourceHash, `${label}.sourceHash`),
    sourceRowHash: exactHash(source.sourceRowHash, `${label}.sourceRowHash`),
    receipt: {
      id: safeId(source.receipt.id, `${label}.receipt.id`),
      hash: exactHash(source.receipt.hash, `${label}.receipt.hash`),
      locationReference: safeId(
        source.receipt.locationReference,
        `${label}.receipt.locationReference`,
      ),
    },
    verificationStatus: source.verificationStatus,
    reportingPeriod: normalizedPeriod(source.reportingPeriod, `${label}.reportingPeriod`),
    capturedAt: utcTimestamp(source.capturedAt, `${label}.capturedAt`),
  };
  result.coverage = normalizedCoverage(source.coverage, {
    kind: result.kind,
    reportingPeriod: result.reportingPeriod,
    sourceHash: result.sourceHash,
    receiptHash: result.receipt.hash,
  }, `${label}.coverage`);
  if (source.kind === "imported_platform") {
    result.generatedAt = utcTimestamp(source.generatedAt, `${label}.generatedAt`);
    result.importedAt = utcTimestamp(source.importedAt, `${label}.importedAt`);
    result.importBatchId = safeId(source.importBatchId, `${label}.importBatchId`);
    if (Date.parse(result.importedAt) < Date.parse(result.generatedAt)) {
      throw new Error(`${label}.importedAt cannot precede generatedAt.`);
    }
  } else {
    result.manualReferenceHash = exactHash(
      source.manualReferenceHash,
      `${label}.manualReferenceHash`,
    );
    result.attestedBy = safeId(source.attestedBy, `${label}.attestedBy`);
    result.attestationNote = cleanText(source.attestationNote, `${label}.attestationNote`, 8);
    result.entryReason = cleanText(source.entryReason, `${label}.entryReason`, 8);
    if (options.manualOriginal && result.verificationStatus !== "pending") {
      throw new Error("A manual transaction or cost original must remain pending until a separate verification record exists.");
    }
  }
  if (options.requireVerified && result.verificationStatus !== "verified") {
    throw new Error(`${label}.verificationStatus must be verified for this evidence kind.`);
  }
  return result;
}

function scopeFromContract(contract) {
  return {
    ventureId: contract.ventureId,
    ventureKit: contract.ventureKit,
    offer: contract.offer,
    experiment: {
      id: contract.experiment.id,
      version: contract.experiment.version,
    },
    cohortId: contract.cohort.id,
    reportingPeriod: contract.reportingPeriod,
  };
}

function normalizedScope(value, label = "evidence.scope") {
  if (!isObject(value)) throw new Error(`${label} must be an object.`);
  if (!isObject(value.experiment)) throw new Error(`${label}.experiment must be an object.`);
  return {
    ventureId: safeId(value.ventureId, `${label}.ventureId`),
    ventureKit: normalizedVentureKit(value.ventureKit, `${label}.ventureKit`),
    offer: normalizedOffer(value.offer, `${label}.offer`),
    experiment: {
      id: safeId(value.experiment.id, `${label}.experiment.id`),
      version: safeId(value.experiment.version, `${label}.experiment.version`),
    },
    cohortId: safeId(value.cohortId, `${label}.cohortId`),
    reportingPeriod: normalizedPeriod(value.reportingPeriod, `${label}.reportingPeriod`),
  };
}

function normalizedTouchpoints(value, label) {
  if (!Array.isArray(value)) throw new Error(`${label} must be a list.`);
  const result = value.map((touchpoint, index) => {
    const itemLabel = `${label}[${index}]`;
    if (!isObject(touchpoint)) throw new Error(`${itemLabel} must be an object.`);
    return {
      type: safeId(touchpoint.type, `${itemLabel}.type`),
      referenceHash: exactHash(touchpoint.referenceHash, `${itemLabel}.referenceHash`),
    };
  }).sort((left, right) => {
    const type = left.type.localeCompare(right.type);
    return type || left.referenceHash.localeCompare(right.referenceHash);
  });
  const identities = result.map((item) => `${item.type}:${item.referenceHash}`);
  if (new Set(identities).size !== identities.length) {
    throw new Error(`${label} must not contain duplicates.`);
  }
  return result;
}

function normalizedAttribution(value, label = "evidence.attribution") {
  if (!isObject(value)) throw new Error(`${label} must be an object.`);
  if (!["attributed", "unattributed", "unknown"].includes(value.status)) {
    throw new Error(`${label}.status must be attributed, unattributed, or unknown.`);
  }
  return {
    status: value.status,
    channelId: safeId(value.channelId, `${label}.channelId`),
    providerNamespace: safeId(value.providerNamespace, `${label}.providerNamespace`),
    accountHash: exactHash(value.accountHash, `${label}.accountHash`),
    adapter: normalizedAdapter(value.adapter, `${label}.adapter`),
    touchpoints: normalizedTouchpoints(value.touchpoints, `${label}.touchpoints`),
  };
}

function bindingFromContract(contract) {
  return {
    programId: contract.programId,
    programVersion: contract.programVersion,
    testId: contract.testId,
    testVersion: contract.testVersion,
    ventureId: contract.ventureId,
    ventureKitId: contract.ventureKit.id,
    ventureKitVersion: contract.ventureKit.version,
    ventureKitHash: contract.ventureKit.hash,
    offerId: contract.offer.id,
    offerVersion: contract.offer.version,
    offerHash: contract.offer.hash,
    offerSku: contract.offer.sku,
    experimentId: contract.experiment.id,
    experimentVersion: contract.experiment.version,
    cohortId: contract.cohort.id,
    decisionHash: contract.decisionHash,
  };
}

function normalizedChain(value, label, eventType) {
  if (!isObject(value)) throw new Error(`${label} must be an object.`);
  const sequence = safeInteger(value.sequence, `${label}.sequence`, { minimum: 0 });
  const predecessorRecordHash = value.predecessorRecordHash === null
    ? null
    : exactHash(value.predecessorRecordHash, `${label}.predecessorRecordHash`);
  const reversesRecordHash = value.reversesRecordHash === null
    ? null
    : exactHash(value.reversesRecordHash, `${label}.reversesRecordHash`);
  if (eventType === "original") {
    if (sequence !== 0 || predecessorRecordHash !== null || reversesRecordHash !== null) {
      throw new Error(`${label} original events require sequence 0 and no predecessor or reversal.`);
    }
  } else if (sequence < 1 || predecessorRecordHash === null) {
    throw new Error(`${label} appended events require a positive sequence and predecessor.`);
  }
  if (eventType === "reversal" && reversesRecordHash === null) {
    throw new Error(`${label} reversal events must identify the exact record reversed.`);
  }
  if (eventType !== "reversal" && reversesRecordHash !== null) {
    throw new Error(`${label} only reversal events may set reversesRecordHash.`);
  }
  return { sequence, predecessorRecordHash, reversesRecordHash };
}

function zeroLike(money) {
  return { ...money, originalMinorUnits: 0, audCents: 0 };
}

function transactionEconomicPayload(record) {
  const { transactionEconomicHash: ignored, ...transaction } = record.transaction;
  return {
    scope: record.scope,
    attribution: record.attribution,
    transaction: {
      ...transaction,
      chain: {
        sequence: transaction.chain.sequence,
        predecessorRecordHash: null,
        reversesRecordHash: transaction.chain.reversesRecordHash ? "route_bound_reversal" : null,
      },
    },
  };
}

function transactionEconomicHash(record) {
  if (!record?.transaction) throw new Error("Transaction economic hash requires transaction evidence.");
  return sha256(transactionEconomicPayload(record));
}

function normalizedPersistedTransaction(contract, value, recordContext) {
  const label = "evidence.transaction";
  if (!isObject(value)) throw new Error(`${label} must be an object.`);
  if (!TRANSACTION_EVENT_TYPES.includes(value.eventType)) {
    throw new Error(`${label}.eventType must be original, correction, refund, or reversal.`);
  }
  if (!TRANSACTION_STATUSES.includes(value.status)) {
    throw new Error(`${label}.status is unsupported.`);
  }
  if (!isObject(value.buyer)) throw new Error(`${label}.buyer must be an object.`);
  const chain = normalizedChain(value.chain, `${label}.chain`, value.eventType);
  const occurredAt = utcTimestamp(value.occurredAt, `${label}.occurredAt`);
  const settledAt = value.settledAt === null
    ? null
    : utcTimestamp(value.settledAt, `${label}.settledAt`);
  if (settledAt && Date.parse(settledAt) < Date.parse(occurredAt)) {
    throw new Error(`${label}.settledAt cannot precede occurredAt.`);
  }
  const grossRevenue = normalizedMoney(value.grossRevenue, `${label}.grossRevenue`);
  const refunds = normalizedMoney(value.refunds, `${label}.refunds`);
  if (grossRevenue.currency !== refunds.currency) {
    throw new Error(`${label} gross revenue and refunds must use the same original currency.`);
  }
  if (value.eventType === "original" && (grossRevenue.audCents <= 0 || refunds.audCents !== 0)) {
    throw new Error(`${label} original events require positive gross revenue and zero refunds.`);
  }
  if (
    value.eventType === "refund"
    && (grossRevenue.audCents <= 0 || refunds.audCents <= 0 || value.status !== "refunded")
  ) {
    throw new Error(`${label} refund snapshots require positive gross and refund amounts plus refunded status.`);
  }
  if (refunds.audCents > grossRevenue.audCents) {
    throw new Error(`${label} refunds cannot exceed gross revenue in a full transaction snapshot.`);
  }
  if (!isObject(value.settlement) || !SETTLEMENT_STATES.includes(value.settlement.state)) {
    throw new Error(`${label}.settlement must state whether cash is settled, pending, or only a platform balance.`);
  }
  const settlement = {
    state: value.settlement.state,
    referenceHash: value.settlement.referenceHash === null
      ? null
      : exactHash(value.settlement.referenceHash, `${label}.settlement.referenceHash`),
  };
  if (settlement.state === "cash_settled" && (!settledAt || !settlement.referenceHash)) {
    throw new Error(`${label} cash settlement requires settledAt and a retained settlement reference hash.`);
  }
  if (settlement.state !== "cash_settled" && settlement.referenceHash !== null) {
    throw new Error(`${label} non-cash settlement states must not claim a cash settlement reference.`);
  }
  const transaction = {
    transactionKey: exactHash(value.transactionKey, `${label}.transactionKey`),
    transactionIdHash: exactHash(value.transactionIdHash, `${label}.transactionIdHash`),
    transactionEconomicHash: exactHash(
      value.transactionEconomicHash,
      `${label}.transactionEconomicHash`,
    ),
    eventType: value.eventType,
    chain,
    buyer: {
      pseudonym: cleanText(value.buyer.pseudonym, `${label}.buyer.pseudonym`),
      keyId: safeId(value.buyer.keyId, `${label}.buyer.keyId`),
      keyVersion: positiveInteger(value.buyer.keyVersion, `${label}.buyer.keyVersion`),
      independenceBasis: safeId(
        value.buyer.independenceBasis,
        `${label}.buyer.independenceBasis`,
      ),
    },
    status: value.status,
    occurredAt,
    settledAt,
    settlement,
    grossRevenue,
    refunds,
    grossRevenueAudCents: safeInteger(
      value.grossRevenueAudCents,
      `${label}.grossRevenueAudCents`,
      { minimum: 0 },
    ),
    refundsAudCents: safeInteger(
      value.refundsAudCents,
      `${label}.refundsAudCents`,
      { minimum: 0 },
    ),
  };
  if (!BUYER_PATTERN.test(transaction.buyer.pseudonym)) {
    throw new Error(`${label}.buyer.pseudonym must be a one-way buyer digest.`);
  }
  if (
    transaction.transactionKey !== transactionKeyFromIdHash(
      recordContext.source.providerNamespace,
      recordContext.source.accountHash,
      transaction.transactionIdHash,
    )
  ) {
    throw new Error(`${label}.transactionKey does not match its provider, hashed account, and transaction ID digest.`);
  }
  if (
    transaction.buyer.keyId !== contract.buyerIdentity.keyId
    || transaction.buyer.keyVersion !== contract.buyerIdentity.keyVersion
    || transaction.buyer.independenceBasis !== contract.buyerIdentity.independenceBasis
  ) {
    throw new Error(`${label}.buyer must remain bound to the contract's key and independence basis.`);
  }
  if (
    transaction.grossRevenueAudCents !== grossRevenue.audCents
    || transaction.refundsAudCents !== refunds.audCents
  ) {
    throw new Error(`${label} AUD projections must match the retained money evidence.`);
  }
  const candidateRecord = { ...recordContext, transaction };
  if (transaction.transactionEconomicHash !== transactionEconomicHash(candidateRecord)) {
    throw new Error(`${label}.transactionEconomicHash does not match its economics.`);
  }
  return transaction;
}

function costEconomicPayload(record) {
  const { costEconomicHash: ignored, ...cost } = record.cost;
  return {
    scope: record.scope,
    attribution: record.attribution,
    cost: {
      ...cost,
      chain: {
        sequence: cost.chain.sequence,
        predecessorRecordHash: null,
        reversesRecordHash: cost.chain.reversesRecordHash ? "route_bound_reversal" : null,
      },
    },
  };
}

function costEconomicHash(record) {
  if (!record?.cost) throw new Error("Cost economic hash requires cost evidence.");
  return sha256(costEconomicPayload(record));
}

function normalizedPersistedCost(contract, value, recordContext) {
  const label = "evidence.cost";
  if (!isObject(value)) throw new Error(`${label} must be an object.`);
  if (!COST_EVENT_TYPES.includes(value.eventType)) {
    throw new Error(`${label}.eventType must be original, correction, or reversal.`);
  }
  const category = safeId(value.category, `${label}.category`);
  if (!COST_CATEGORIES.includes(category)) {
    throw new Error(`${label}.category is outside Pantheon's fixed cost taxonomy.`);
  }
  if (!COST_STATES.includes(value.state)) throw new Error(`${label}.state is unsupported.`);
  const chain = normalizedChain(value.chain, `${label}.chain`, value.eventType);
  let amount = null;
  if (value.state === "unknown") {
    if (value.amount !== null) throw new Error(`${label}.amount must be null while state is unknown.`);
  } else {
    amount = normalizedMoney(value.amount, `${label}.amount`);
  }
  const cost = {
    costKey: exactHash(value.costKey, `${label}.costKey`),
    costIdHash: exactHash(value.costIdHash, `${label}.costIdHash`),
    costEconomicHash: exactHash(value.costEconomicHash, `${label}.costEconomicHash`),
    eventType: value.eventType,
    chain,
    category,
    state: value.state,
    occurredAt: utcTimestamp(value.occurredAt, `${label}.occurredAt`),
    amount,
    amountAudCents: value.amountAudCents === null
      ? null
      : safeInteger(value.amountAudCents, `${label}.amountAudCents`, { minimum: 0 }),
  };
  if (cost.amountAudCents !== (amount?.audCents ?? null)) {
    throw new Error(`${label}.amountAudCents must match the retained money evidence.`);
  }
  if (
    cost.costKey !== costKeyFromIdHash(
      recordContext.source.providerNamespace,
      recordContext.source.accountHash,
      cost.costIdHash,
    )
  ) {
    throw new Error(`${label}.costKey does not match its provider, hashed account, and cost ID digest.`);
  }
  const candidateRecord = { ...recordContext, cost };
  if (cost.costEconomicHash !== costEconomicHash(candidateRecord)) {
    throw new Error(`${label}.costEconomicHash does not match its economics.`);
  }
  return cost;
}

function manualFactsForRecord(record) {
  if (!record || !["transaction", "cost"].includes(record.kind)) {
    throw new Error("Manual verification can bind only a transaction or cost original.");
  }
  if (record.source.kind !== "operator_attested_manual") {
    throw new Error("Manual verification can bind only operator-attested manual evidence.");
  }
  if (record.kind === "cost") {
    if (!record.cost.amount) throw new Error("Unknown-cost manual evidence has no amount to verify.");
    return {
      originalRecordHash: record.recordHash,
      referenceHash: record.source.manualReferenceHash,
      amountRole: "cost",
      originalMinorUnits: record.cost.amount.originalMinorUnits,
      currency: record.cost.amount.currency,
      audCents: record.cost.amount.audCents,
      occurredAt: record.cost.occurredAt,
      economicHash: record.cost.costEconomicHash,
    };
  }
  const gross = record.transaction.grossRevenue;
  const refunds = record.transaction.refunds;
  if (gross.currency !== refunds.currency) {
    throw new Error("Manual transaction verification requires one original currency.");
  }
  const amountRole = refunds.audCents > 0
    ? "net_transaction"
    : gross.audCents > 0
      ? "gross_revenue"
      : "reversed_transaction";
  return {
    originalRecordHash: record.recordHash,
    referenceHash: record.source.manualReferenceHash,
    amountRole,
    originalMinorUnits: gross.originalMinorUnits - refunds.originalMinorUnits,
    currency: gross.currency,
    audCents: gross.audCents - refunds.audCents,
    occurredAt: record.transaction.occurredAt,
    economicHash: record.transaction.transactionEconomicHash,
  };
}

function normalizedManualVerification(value) {
  const label = "evidence.manualVerification";
  if (!isObject(value)) throw new Error(`${label} must be an object.`);
  if (!["verified", "rejected"].includes(value.status)) {
    throw new Error(`${label}.status must be verified or rejected.`);
  }
  if (!isObject(value.boundFacts)) throw new Error(`${label}.boundFacts must be an object.`);
  return {
    status: value.status,
    reviewerId: safeId(value.reviewerId, `${label}.reviewerId`),
    reviewedAt: utcTimestamp(value.reviewedAt, `${label}.reviewedAt`),
    boundFacts: {
      originalRecordHash: exactHash(
        value.boundFacts.originalRecordHash,
        `${label}.boundFacts.originalRecordHash`,
      ),
      referenceHash: exactHash(
        value.boundFacts.referenceHash,
        `${label}.boundFacts.referenceHash`,
      ),
      amountRole: safeId(value.boundFacts.amountRole, `${label}.boundFacts.amountRole`),
      originalMinorUnits: safeInteger(
        value.boundFacts.originalMinorUnits,
        `${label}.boundFacts.originalMinorUnits`,
      ),
      currency: cleanText(value.boundFacts.currency, `${label}.boundFacts.currency`).toUpperCase(),
      audCents: safeInteger(value.boundFacts.audCents, `${label}.boundFacts.audCents`),
      occurredAt: utcTimestamp(
        value.boundFacts.occurredAt,
        `${label}.boundFacts.occurredAt`,
      ),
      economicHash: exactHash(
        value.boundFacts.economicHash,
        `${label}.boundFacts.economicHash`,
      ),
    },
  };
}

function normalizedTerminalStop(value) {
  const label = "evidence.terminalStop";
  if (!isObject(value)) throw new Error(`${label} must be an object.`);
  return {
    code: safeId(value.code, `${label}.code`),
    reason: cleanText(value.reason, `${label}.reason`, 8),
    stoppedAt: utcTimestamp(value.stoppedAt, `${label}.stoppedAt`),
    approvalId: value.approvalId === null
      ? null
      : safeId(value.approvalId, `${label}.approvalId`),
  };
}

function normalizedManifestSource(value, index) {
  const label = `evidence.manifest.sources[${index}]`;
  if (!isObject(value)) throw new Error(`${label} must be an object.`);
  const result = {
    sourceId: safeId(value.sourceId, `${label}.sourceId`),
    sourceKind: cleanText(value.sourceKind, `${label}.sourceKind`),
    providerNamespace: safeId(value.providerNamespace, `${label}.providerNamespace`),
    accountHash: exactHash(value.accountHash, `${label}.accountHash`),
    sourceSystem: safeId(value.sourceSystem, `${label}.sourceSystem`),
    exportType: safeId(value.exportType, `${label}.exportType`),
    sourceHash: exactHash(value.sourceHash, `${label}.sourceHash`),
    receiptId: safeId(value.receiptId, `${label}.receiptId`),
    receiptHash: exactHash(value.receiptHash, `${label}.receiptHash`),
    reportingPeriod: normalizedPeriod(value.reportingPeriod, `${label}.reportingPeriod`),
  };
  if (!EVIDENCE_SOURCE_KINDS.includes(result.sourceKind)) {
    throw new Error(`${label}.sourceKind is unsupported.`);
  }
  result.coverage = normalizedCoverage(value.coverage, {
    kind: result.sourceKind,
    reportingPeriod: result.reportingPeriod,
    sourceHash: result.sourceHash,
    receiptHash: result.receiptHash,
  }, `${label}.coverage`);
  return result;
}

function manifestSourceIdentity(source) {
  return [
    source.sourceId,
    source.sourceKind,
    source.sourceHash,
    source.receiptId,
    source.receiptHash,
  ].join(":");
}

function normalizedManifest(value) {
  const label = "evidence.manifest";
  if (!isObject(value)) throw new Error(`${label} must be an object.`);
  if (value.status !== "closed") throw new Error(`${label}.status must be closed.`);
  const recordHashes = uniqueSortedStrings(
    value.recordHashes,
    `${label}.recordHashes`,
    exactHash,
  );
  const sources = (value.sources || [])
    .map(normalizedManifestSource)
    .sort((left, right) => manifestSourceIdentity(left).localeCompare(manifestSourceIdentity(right)));
  if (!sources.length || new Set(sources.map(manifestSourceIdentity)).size !== sources.length) {
    throw new Error(`${label}.sources must contain unique exact source receipts.`);
  }
  return {
    algorithm: value.algorithm === "pantheon.closed-evidence-set.v1"
      ? value.algorithm
      : (() => {
        throw new Error(`${label}.algorithm must be pantheon.closed-evidence-set.v1.`);
      })(),
    revision: normalizedChain(
      value.revision,
      `${label}.revision`,
      Number(value.revision?.sequence) === 0 ? "original" : "correction",
    ),
    status: "closed",
    reportingPeriod: normalizedPeriod(value.reportingPeriod, `${label}.reportingPeriod`),
    closedAt: utcTimestamp(value.closedAt, `${label}.closedAt`),
    recordHashes,
    sources,
  };
}

function recordPayload(record) {
  const { recordHash: ignored, ...payload } = record;
  return payload;
}

function emptyRecord(contract, input, sourceOptions = {}) {
  const kind = cleanText(input.kind, "evidence.kind");
  if (!EVIDENCE_KINDS.includes(kind)) {
    throw new Error(`Commercial evidence kind must be one of: ${EVIDENCE_KINDS.join(", ")}.`);
  }
  const source = normalizedSource(input.source, "evidence.source", sourceOptions);
  return {
    schema: COMMERCIAL_TEST_EVIDENCE_SCHEMA,
    evidenceId: safeId(input.evidenceId, "evidenceId"),
    evidenceVersion: safeId(input.evidenceVersion, "evidenceVersion"),
    testBinding: bindingFromContract(contract),
    kind,
    source,
    scope: normalizedScope(input.scope || scopeFromContract(contract)),
    attribution: normalizedAttribution(input.attribution),
    supersedesRecordHash: null,
    transaction: null,
    cost: null,
    manualVerification: null,
    terminalStop: null,
    manifest: null,
  };
}

function createTransactionRecord(contract, input, options) {
  const manualOriginal = input.source?.kind === "operator_attested_manual";
  const record = emptyRecord(contract, input, { manualOriginal });
  if (!isObject(input.transaction)) throw new Error("Transaction evidence requires transaction details.");
  const eventType = cleanText(input.transaction.eventType, "transaction.eventType");
  if (!TRANSACTION_EVENT_TYPES.includes(eventType)) {
    throw new Error("transaction.eventType is unsupported.");
  }
  const chain = normalizedChain(input.transaction.chain, "transaction.chain", eventType);
  const source = record.source;
  const grossRevenue = normalizedMoney(input.transaction.grossRevenue, "transaction.grossRevenue");
  const refunds = normalizedMoney(input.transaction.refunds, "transaction.refunds");
  const transaction = {
    transactionKey: routeIndependentTransactionKey(
      source.providerNamespace,
      source.accountHash,
      input.transaction.rawTransactionId,
    ),
    transactionIdHash: sha256({
      domain: "pantheon.raw-transaction-id.v1",
      rawTransactionId: cleanText(
        input.transaction.rawTransactionId,
        "transaction.rawTransactionId",
      ),
    }),
    transactionEconomicHash: sha256("placeholder"),
    eventType,
    chain,
    buyer: {
      pseudonym: pseudonymizeBuyer(contract, input.buyerReference, options.pseudonymizationKey),
      keyId: contract.buyerIdentity.keyId,
      keyVersion: contract.buyerIdentity.keyVersion,
      independenceBasis: contract.buyerIdentity.independenceBasis,
    },
    status: input.transaction.status,
    occurredAt: input.transaction.occurredAt,
    settledAt: input.transaction.settledAt ?? null,
    settlement: input.transaction.settlement,
    grossRevenue,
    refunds,
    grossRevenueAudCents: grossRevenue.audCents,
    refundsAudCents: refunds.audCents,
  };
  record.transaction = transaction;
  record.supersedesRecordHash = chain.predecessorRecordHash;
  transaction.transactionEconomicHash = transactionEconomicHash(record);
  record.transaction = normalizedPersistedTransaction(contract, transaction, record);
  record.recordHash = sha256(recordPayload(record));
  return record;
}

function createCostRecord(contract, input) {
  const manualOriginal = input.source?.kind === "operator_attested_manual";
  const record = emptyRecord(contract, input, { manualOriginal });
  if (!isObject(input.cost)) throw new Error("Cost evidence requires cost details.");
  const eventType = cleanText(input.cost.eventType, "cost.eventType");
  if (!COST_EVENT_TYPES.includes(eventType)) throw new Error("cost.eventType is unsupported.");
  const chain = normalizedChain(input.cost.chain, "cost.chain", eventType);
  const state = cleanText(input.cost.state, "cost.state");
  const amount = state === "unknown"
    ? null
    : normalizedMoney(input.cost.amount, "cost.amount");
  const cost = {
    costKey: routeIndependentCostKey(
      record.source.providerNamespace,
      record.source.accountHash,
      input.cost.rawCostId,
    ),
    costIdHash: sha256({
      domain: "pantheon.raw-cost-id.v1",
      rawCostId: cleanText(input.cost.rawCostId, "cost.rawCostId"),
    }),
    costEconomicHash: sha256("placeholder"),
    eventType,
    chain,
    category: input.cost.category,
    state,
    occurredAt: input.cost.occurredAt,
    amount,
    amountAudCents: amount?.audCents ?? null,
  };
  record.cost = cost;
  record.supersedesRecordHash = chain.predecessorRecordHash;
  cost.costEconomicHash = costEconomicHash(record);
  record.cost = normalizedPersistedCost(contract, cost, record);
  record.recordHash = sha256(recordPayload(record));
  return record;
}

function createSpecialRecord(contract, input) {
  const requireVerified = ["terminal_stop", "evidence_set_manifest"].includes(input.kind);
  const record = emptyRecord(contract, input, { requireVerified });
  if (input.kind === "manual_verification") {
    record.manualVerification = normalizedManualVerification(input.manualVerification);
    if (record.source.kind !== "operator_attested_manual") {
      throw new Error("Manual verification must retain an operator-attested verification receipt.");
    }
    if (record.source.verificationStatus !== record.manualVerification.status) {
      throw new Error("Manual verification source status must match its immutable verdict.");
    }
  } else if (input.kind === "terminal_stop") {
    record.terminalStop = normalizedTerminalStop(input.terminalStop);
  } else if (input.kind === "evidence_set_manifest") {
    record.manifest = normalizedManifest(input.manifest);
    record.supersedesRecordHash = record.manifest.revision.predecessorRecordHash;
  } else {
    throw new Error(`Unsupported special evidence kind ${input.kind}.`);
  }
  record.recordHash = sha256(recordPayload(record));
  return record;
}

function createCommercialEvidenceRecord(contract, input, options = {}) {
  validateCommercialTestContract(contract);
  if (!isObject(input)) throw new Error("Commercial evidence input must be an object.");
  ensureNoRawContactData(input, "evidence", true);
  let record;
  if (input.kind === "transaction") {
    record = createTransactionRecord(contract, input, options);
  } else if (input.kind === "cost") {
    record = createCostRecord(contract, input);
  } else {
    record = createSpecialRecord(contract, input);
  }
  ensureNoRawContactData(record);
  if (
    input.recordHash !== undefined
    && exactHash(input.recordHash, "recordHash") !== record.recordHash
  ) {
    throw new Error("recordHash does not match the immutable evidence record.");
  }
  return deepFreeze(record);
}

function createManualVerificationRecord(contract, originalRecord, input) {
  validateCommercialEvidenceRecord(contract, originalRecord);
  const boundFacts = manualFactsForRecord(originalRecord);
  return createCommercialEvidenceRecord(contract, {
    ...input,
    kind: "manual_verification",
    manualVerification: {
      status: input.status,
      reviewerId: input.reviewerId,
      reviewedAt: input.reviewedAt,
      boundFacts,
    },
  });
}

function createTerminalStopRecord(contract, input) {
  return createCommercialEvidenceRecord(contract, {
    ...input,
    kind: "terminal_stop",
    terminalStop: {
      code: input.code,
      reason: input.reason,
      stoppedAt: input.stoppedAt,
      approvalId: input.approvalId ?? null,
    },
  });
}

function sourceToManifestEntry(source) {
  return {
    sourceId: source.sourceId,
    sourceKind: source.kind,
    providerNamespace: source.providerNamespace,
    accountHash: source.accountHash,
    sourceSystem: source.sourceSystem,
    exportType: source.exportType,
    sourceHash: source.sourceHash,
    receiptId: source.receipt.id,
    receiptHash: source.receipt.hash,
    reportingPeriod: source.reportingPeriod,
    coverage: source.coverage,
  };
}

function createEvidenceSetManifest(contract, records, input) {
  if (!Array.isArray(records) || records.length === 0) {
    throw new Error("Evidence-set manifest requires the complete non-manifest evidence list.");
  }
  for (const record of records) validateCommercialEvidenceRecord(contract, record);
  const predecessorManifest = input.predecessorManifest || null;
  if (predecessorManifest) {
    validateCommercialEvidenceRecord(contract, predecessorManifest);
    if (predecessorManifest.kind !== "evidence_set_manifest") {
      throw new Error("predecessorManifest must be an evidence-set manifest.");
    }
  }
  const included = records.filter(
    (record) => !["evidence_set_manifest", "terminal_stop"].includes(record.kind),
  );
  const sourceMap = new Map();
  for (const record of included) {
    const entry = sourceToManifestEntry(record.source);
    sourceMap.set(manifestSourceIdentity(entry), entry);
  }
  return createCommercialEvidenceRecord(contract, {
    ...input,
    kind: "evidence_set_manifest",
    manifest: {
      algorithm: "pantheon.closed-evidence-set.v1",
      revision: {
        sequence: predecessorManifest ? predecessorManifest.manifest.revision.sequence + 1 : 0,
        predecessorRecordHash: predecessorManifest?.recordHash || null,
        reversesRecordHash: null,
      },
      status: "closed",
      reportingPeriod: input.reportingPeriod || contract.reportingPeriod,
      closedAt: input.closedAt,
      recordHashes: [...new Set(included.map((record) => record.recordHash))].sort(),
      sources: [...sourceMap.values()],
    },
  });
}

function normalizedPersistedRecord(contract, record) {
  if (!isObject(record)) throw new Error("Commercial evidence record must be an object.");
  if (record.schema !== COMMERCIAL_TEST_EVIDENCE_SCHEMA) {
    throw new Error(`Commercial evidence schema must be ${COMMERCIAL_TEST_EVIDENCE_SCHEMA}.`);
  }
  ensureNoRawContactData(record);
  if (!sameCanonical(record.testBinding, bindingFromContract(contract))) {
    throw new Error("Commercial evidence belongs to a different immutable test decision.");
  }
  const sourceOptions = {
    manualOriginal: ["transaction", "cost"].includes(record.kind)
      && record.source?.kind === "operator_attested_manual",
    requireVerified: ["terminal_stop", "evidence_set_manifest"].includes(record.kind),
  };
  const normalized = {
    schema: COMMERCIAL_TEST_EVIDENCE_SCHEMA,
    evidenceId: safeId(record.evidenceId, "evidenceId"),
    evidenceVersion: safeId(record.evidenceVersion, "evidenceVersion"),
    testBinding: bindingFromContract(contract),
    kind: cleanText(record.kind, "kind"),
    source: normalizedSource(record.source, "evidence.source", sourceOptions),
    scope: normalizedScope(record.scope),
    attribution: normalizedAttribution(record.attribution),
    supersedesRecordHash: record.supersedesRecordHash === null
      ? null
      : exactHash(record.supersedesRecordHash, "supersedesRecordHash"),
    transaction: null,
    cost: null,
    manualVerification: null,
    terminalStop: null,
    manifest: null,
  };
  if (!EVIDENCE_KINDS.includes(normalized.kind)) throw new Error("Evidence kind is unsupported.");
  if (normalized.kind === "transaction") {
    normalized.transaction = normalizedPersistedTransaction(contract, record.transaction, normalized);
    if (normalized.supersedesRecordHash !== normalized.transaction.chain.predecessorRecordHash) {
      throw new Error("Transaction supersession must match its chain predecessor.");
    }
  } else if (normalized.kind === "cost") {
    normalized.cost = normalizedPersistedCost(contract, record.cost, normalized);
    if (normalized.supersedesRecordHash !== normalized.cost.chain.predecessorRecordHash) {
      throw new Error("Cost supersession must match its chain predecessor.");
    }
  } else {
    if (normalized.kind === "manual_verification") {
      if (normalized.supersedesRecordHash !== null) {
        throw new Error("Manual verification records cannot supersede prior records.");
      }
      normalized.manualVerification = normalizedManualVerification(record.manualVerification);
      if (
        normalized.source.kind !== "operator_attested_manual"
        || normalized.source.verificationStatus !== normalized.manualVerification.status
      ) {
        throw new Error("Manual verification provenance must match its verdict.");
      }
    } else if (normalized.kind === "terminal_stop") {
      if (normalized.supersedesRecordHash !== null) {
        throw new Error("Terminal stop records cannot supersede prior records.");
      }
      normalized.terminalStop = normalizedTerminalStop(record.terminalStop);
    } else {
      normalized.manifest = normalizedManifest(record.manifest);
      if (normalized.supersedesRecordHash !== normalized.manifest.revision.predecessorRecordHash) {
        throw new Error("Manifest supersession must match its revision predecessor.");
      }
    }
  }
  normalized.recordHash = exactHash(record.recordHash, "recordHash");
  if (normalized.recordHash !== sha256(recordPayload(normalized))) {
    throw new Error("Commercial evidence recordHash does not match its current contents.");
  }
  return normalized;
}

function validateCommercialEvidenceRecord(contract, record) {
  validateCommercialTestContract(contract);
  const normalized = normalizedPersistedRecord(contract, record);
  if (!sameCanonical(normalized, record)) {
    throw new Error("Commercial evidence contains unsupported or non-normalized fields.");
  }
  return true;
}

function blocker(code, detail, recordHash = null) {
  return { code, detail, recordHash };
}

function sortedUniqueBlockers(values) {
  const map = new Map();
  for (const value of values) map.set(JSON.stringify(canonical(value)), value);
  return [...map.values()].sort((left, right) => {
    const code = left.code.localeCompare(right.code);
    if (code) return code;
    const hash = String(left.recordHash || "").localeCompare(String(right.recordHash || ""));
    return hash || left.detail.localeCompare(right.detail);
  });
}

function expectedSourceFor(contract, source) {
  return contract.evidenceRules.requiredSources.find((candidate) => candidate.id === source.sourceId);
}

function commonRecordBlockers(contract, record) {
  const result = [];
  const expectedScope = scopeFromContract(contract);
  if (!sameCanonical(record.scope, expectedScope)) {
    result.push(blocker("scope_mismatch", "Evidence scope does not match the immutable venture, kit, offer, experiment, cohort, and reporting period.", record.recordHash));
  }
  const expectedSource = expectedSourceFor(contract, record.source);
  if (!expectedSource) {
    result.push(blocker("unexpected_source", `Source ${record.source.sourceId} is not in the contract.`, record.recordHash));
  } else if (
    !expectedSource.acceptedKinds.includes(record.source.kind)
    || expectedSource.providerNamespace !== record.source.providerNamespace
    || expectedSource.accountHash !== record.source.accountHash
    || expectedSource.sourceSystem !== record.source.sourceSystem
    || expectedSource.exportType !== record.source.exportType
  ) {
    result.push(blocker("source_scope_mismatch", `Source ${record.source.sourceId} does not match its exact contract definition.`, record.recordHash));
  }
  if (!sameCanonical(record.source.reportingPeriod, contract.reportingPeriod)) {
    result.push(blocker("source_period_mismatch", "Evidence source reporting period differs from the contract.", record.recordHash));
  }
  const attribution = record.attribution;
  if (attribution.status !== "attributed") {
    result.push(blocker("unresolved_attribution", `Evidence attribution is ${attribution.status}.`, record.recordHash));
  }
  if (
    attribution.channelId !== contract.channel.id
    || attribution.providerNamespace !== contract.channel.providerNamespace
    || attribution.accountHash !== contract.channel.accountHash
    || !sameCanonical(attribution.adapter, contract.channel.adapter)
  ) {
    result.push(blocker("channel_mismatch", "Evidence is outside the contract's one channel, account, or adapter.", record.recordHash));
  }
  const types = new Set(attribution.touchpoints.map((touchpoint) => touchpoint.type));
  const unsupported = [...types].filter(
    (touchpoint) => !contract.attributionRules.allowedTouchpoints.includes(touchpoint),
  );
  const missing = contract.attributionRules.requiredTouchpoints.filter(
    (touchpoint) => !types.has(touchpoint),
  );
  if (unsupported.length) {
    result.push(blocker("touchpoint_out_of_scope", `Unsupported touchpoints: ${unsupported.sort().join(", ")}.`, record.recordHash));
  }
  if (
    ["transaction", "cost"].includes(record.kind)
    && missing.length
  ) {
    result.push(blocker("required_touchpoint_missing", `Missing required touchpoints: ${missing.join(", ")}.`, record.recordHash));
  }
  return result;
}

function occurredAtFor(record) {
  return record.transaction?.occurredAt || record.cost?.occurredAt || null;
}

function temporalBlockers(contract, record) {
  const occurredAt = occurredAtFor(record);
  if (!occurredAt) return [];
  const timestamp = Date.parse(occurredAt);
  const withinReporting = (
    timestamp >= Date.parse(contract.reportingPeriod.startsAt)
    && timestamp <= Date.parse(contract.reportingPeriod.endsAt)
  );
  const withinAttribution = (
    timestamp >= Date.parse(contract.attributionRules.window.startsAt)
    && timestamp <= Date.parse(contract.attributionRules.window.endsAt)
  );
  const result = [];
  if (!withinReporting) {
    result.push(blocker("outside_reporting_period", "Evidence occurred outside the contract reporting period.", record.recordHash));
  }
  if (!withinAttribution) {
    result.push(blocker("outside_attribution_window", "Evidence occurred outside the UTC attribution window.", record.recordHash));
  }
  return result;
}

function factsMatchVerification(original, verification) {
  try {
    return sameCanonical(manualFactsForRecord(original), verification.manualVerification.boundFacts);
  } catch {
    return false;
  }
}

function resolveManualVerification(records, blockers) {
  const originals = new Map(
    records
      .filter((record) => (
        ["transaction", "cost"].includes(record.kind)
        && record.source.kind === "operator_attested_manual"
      ))
      .map((record) => [record.recordHash, record]),
  );
  const byOriginal = new Map();
  for (const record of records.filter((item) => item.kind === "manual_verification")) {
    const originalHash = record.manualVerification.boundFacts.originalRecordHash;
    if (!originals.has(originalHash)) {
      blockers.push(blocker("orphan_manual_verification", "Manual verification does not bind an included manual original.", record.recordHash));
      continue;
    }
    const list = byOriginal.get(originalHash) || [];
    list.push(record);
    byOriginal.set(originalHash, list);
  }
  const verified = new Set();
  for (const [originalHash, original] of originals) {
    const verifications = byOriginal.get(originalHash) || [];
    if (!verifications.length) {
      blockers.push(blocker("manual_verification_pending", "Manual evidence has no separate immutable verification record.", originalHash));
      continue;
    }
    const semantic = new Map();
    for (const verification of verifications) {
      if (!factsMatchVerification(original, verification)) {
        blockers.push(blocker("manual_verification_mismatch", "Manual verification does not match the original hash, amount, date, reference, and economics.", verification.recordHash));
        continue;
      }
      semantic.set(sha256(verification.manualVerification), verification);
    }
    if (semantic.size > 1) {
      blockers.push(blocker("manual_verification_conflict", "Conflicting manual verification verdicts exist for one original.", originalHash));
      continue;
    }
    const verification = [...semantic.values()][0];
    if (!verification) continue;
    if (verification.manualVerification.status === "rejected") {
      blockers.push(blocker("manual_evidence_rejected", "A reviewer rejected the manual evidence.", originalHash));
    } else {
      verified.add(originalHash);
    }
  }
  return verified;
}

function chainGroups(records, keySelector) {
  const groups = new Map();
  for (const record of records) {
    const key = keySelector(record);
    const list = groups.get(key) || [];
    list.push(record);
    groups.set(key, list);
  }
  return groups;
}

function resolveAppendOnlyChain(records, options, blockers) {
  const bySequence = new Map();
  for (const record of records) {
    const sequence = options.chain(record).sequence;
    const list = bySequence.get(sequence) || [];
    list.push(record);
    bySequence.set(sequence, list);
  }
  const sequences = [...bySequence.keys()].sort((left, right) => left - right);
  if (!sequences.length || sequences[0] !== 0) {
    blockers.push(blocker(`${options.prefix}_chain_missing_original`, `${options.label} chain has no sequence-zero original.`));
    return null;
  }
  for (let index = 0; index < sequences.length; index += 1) {
    if (sequences[index] !== index) {
      blockers.push(blocker(`${options.prefix}_chain_gap`, `${options.label} chain is not contiguous.`));
      return null;
    }
  }
  const selected = [];
  let priorHashes = new Set();
  for (const sequence of sequences) {
    const candidates = bySequence.get(sequence).sort((left, right) => left.recordHash.localeCompare(right.recordHash));
    const economicHashes = new Set(candidates.map(options.economicHash));
    if (economicHashes.size > 1) {
      blockers.push(blocker(`${options.prefix}_route_conflict`, `Conflicting route evidence exists at ${options.label} sequence ${sequence}.`));
      return null;
    }
    if (sequence > 0) {
      const invalidPredecessor = candidates.some(
        (record) => !priorHashes.has(options.chain(record).predecessorRecordHash),
      );
      if (invalidPredecessor) {
        blockers.push(blocker(`${options.prefix}_chain_predecessor`, `${options.label} chain has an invalid predecessor at sequence ${sequence}.`));
        return null;
      }
    }
    selected.push(candidates[0]);
    priorHashes = new Set(candidates.map((record) => record.recordHash));
  }
  return selected;
}

function resolveTransactions(records, eligibleHashes, blockers) {
  const groups = chainGroups(
    records.filter((record) => record.kind === "transaction"),
    (record) => record.transaction.transactionKey,
  );
  const results = [];
  let duplicateRouteCount = 0;
  for (const key of [...groups.keys()].sort()) {
    const all = groups.get(key);
    const chain = resolveAppendOnlyChain(all, {
      prefix: "transaction",
      label: `transaction ${key}`,
      chain: (record) => record.transaction.chain,
      economicHash: (record) => record.transaction.transactionEconomicHash,
    }, blockers);
    duplicateRouteCount += all.length - new Set(all.map(
      (record) => `${record.transaction.chain.sequence}:${record.transaction.transactionEconomicHash}`,
    )).size;
    if (!chain || all.some((record) => !eligibleHashes.has(record.recordHash))) continue;
    if (chain[0].transaction.eventType !== "original") {
      blockers.push(blocker("transaction_chain_invalid_original", `Transaction ${key} sequence zero is not original.`));
      continue;
    }
    let chainValid = true;
    const priorRecords = new Map();
    const buyer = chain[0].transaction.buyer.pseudonym;
    const occurredAt = chain[0].transaction.occurredAt;
    for (let index = 0; index < chain.length; index += 1) {
      const record = chain[index];
      const transaction = record.transaction;
      if (transaction.buyer.pseudonym !== buyer) {
        blockers.push(blocker("transaction_buyer_conflict", `Transaction ${key} changes buyer identity within its chain.`, record.recordHash));
        chainValid = false;
      }
      if (transaction.occurredAt !== occurredAt) {
        blockers.push(blocker("transaction_date_conflict", `Transaction ${key} changes its purchase date within the chain.`, record.recordHash));
        chainValid = false;
      }
      if (index > 0) {
        const predecessor = priorRecords.get(transaction.chain.predecessorRecordHash);
        if (
          predecessor
          && Date.parse(record.source.capturedAt) < Date.parse(predecessor.source.capturedAt)
        ) {
          blockers.push(blocker("transaction_chain_time_regression", `Transaction ${key} was captured before its predecessor.`, record.recordHash));
          chainValid = false;
        }
        if (
          transaction.eventType === "correction"
          && predecessor
          && transaction.status === predecessor.transaction.status
          && transaction.settledAt === predecessor.transaction.settledAt
          && transaction.grossRevenueAudCents === predecessor.transaction.grossRevenueAudCents
          && transaction.refundsAudCents === predecessor.transaction.refundsAudCents
        ) {
          blockers.push(blocker("transaction_empty_correction", `Transaction ${key} correction does not change the full snapshot.`, record.recordHash));
          chainValid = false;
        }
      }
      if (transaction.eventType === "reversal") {
        const target = priorRecords.get(transaction.chain.reversesRecordHash);
        if (!target) {
          blockers.push(blocker("transaction_reversal_invalid", `Transaction ${key} reversal target is missing from its prior chain.`, record.recordHash));
          chainValid = false;
        } else {
          const restored = target.transaction.chain.predecessorRecordHash
            ? priorRecords.get(target.transaction.chain.predecessorRecordHash)
            : null;
          const expectedGross = restored?.transaction.grossRevenueAudCents ?? 0;
          const expectedRefunds = restored?.transaction.refundsAudCents ?? 0;
          if (
            transaction.grossRevenueAudCents !== expectedGross
            || transaction.refundsAudCents !== expectedRefunds
          ) {
            blockers.push(blocker("transaction_reversal_amount_mismatch", `Transaction ${key} reversal does not restore the exact prior full snapshot.`, record.recordHash));
            chainValid = false;
          }
        }
      }
      priorRecords.set(record.recordHash, record);
    }
    const head = chain.at(-1).transaction;
    const resolvedCancellation = (
      head.status === "cancelled"
      && head.settlement.state === "not_applicable"
      && head.grossRevenueAudCents === 0
      && head.refundsAudCents === 0
    );
    if (
      !resolvedCancellation
      && (
        !["settled", "refunded"].includes(head.status)
        || head.settlement.state !== "cash_settled"
      )
    ) {
      blockers.push(blocker("unsettled_transaction", `Transaction ${key} is not supported by settled cash evidence.`, chain.at(-1).recordHash));
      chainValid = false;
    }
    const grossRevenueAudCents = head.grossRevenueAudCents;
    const refundsAudCents = head.refundsAudCents;
    if (grossRevenueAudCents < 0 || refundsAudCents < 0 || refundsAudCents > grossRevenueAudCents) {
      blockers.push(blocker("transaction_economics_invalid", `Transaction ${key} resolves to impossible gross or refund totals.`));
      chainValid = false;
    }
    if (chainValid) {
      results.push({
        transactionKey: key,
        buyerPseudonym: buyer,
        grossRevenueAudCents,
        refundsAudCents,
        netRevenueAudCents: grossRevenueAudCents - refundsAudCents,
        sequence: chain.length - 1,
      });
    }
  }
  return { results, duplicateRouteCount };
}

function resolveCosts(records, eligibleHashes, blockers) {
  const groups = chainGroups(
    records.filter((record) => record.kind === "cost"),
    (record) => record.cost.costKey,
  );
  const effective = [];
  let duplicateRouteCount = 0;
  for (const key of [...groups.keys()].sort()) {
    const all = groups.get(key);
    const chain = resolveAppendOnlyChain(all, {
      prefix: "cost",
      label: `cost ${key}`,
      chain: (record) => record.cost.chain,
      economicHash: (record) => record.cost.costEconomicHash,
    }, blockers);
    duplicateRouteCount += all.length - new Set(all.map(
      (record) => `${record.cost.chain.sequence}:${record.cost.costEconomicHash}`,
    )).size;
    if (!chain || all.some((record) => !eligibleHashes.has(record.recordHash))) continue;
    if (chain[0].cost.eventType !== "original") {
      blockers.push(blocker("cost_chain_invalid_original", `Cost ${key} sequence zero is not original.`));
      continue;
    }
    const category = chain[0].cost.category;
    const priorRecords = new Map();
    let chainValid = true;
    for (let index = 0; index < chain.length; index += 1) {
      const record = chain[index];
      const cost = record.cost;
      if (cost.category !== category) {
        blockers.push(blocker("cost_category_conflict", `Cost ${key} changes category within its chain.`, record.recordHash));
        chainValid = false;
      }
      if (index > 0) {
        const predecessor = priorRecords.get(cost.chain.predecessorRecordHash);
        if (
          predecessor
          && Date.parse(record.source.capturedAt) < Date.parse(predecessor.source.capturedAt)
        ) {
          blockers.push(blocker("cost_chain_time_regression", `Cost ${key} was captured before its predecessor.`, record.recordHash));
          chainValid = false;
        }
        if (
          cost.eventType === "correction"
          && predecessor
          && cost.state === predecessor.cost.state
          && cost.amountAudCents === predecessor.cost.amountAudCents
        ) {
          blockers.push(blocker("cost_empty_correction", `Cost ${key} correction does not change the full snapshot.`, record.recordHash));
          chainValid = false;
        }
      }
      if (cost.eventType === "reversal") {
        const target = priorRecords.get(cost.chain.reversesRecordHash);
        if (!target) {
          blockers.push(blocker("cost_reversal_invalid", `Cost ${key} reversal target is missing from its prior chain.`, record.recordHash));
          chainValid = false;
        } else {
          const restored = target.cost.chain.predecessorRecordHash
            ? priorRecords.get(target.cost.chain.predecessorRecordHash)
            : null;
          const expectedState = restored?.cost.state ?? "reconciled";
          const expectedAmount = restored?.cost.amountAudCents ?? 0;
          if (cost.state !== expectedState || cost.amountAudCents !== expectedAmount) {
            blockers.push(blocker("cost_reversal_amount_mismatch", `Cost ${key} reversal does not restore the exact prior full snapshot.`, record.recordHash));
            chainValid = false;
          }
        }
      }
      priorRecords.set(record.recordHash, record);
    }
    if (!chainValid) continue;
    const latest = chain.at(-1).cost;
    effective.push({
      costKey: key,
      category: latest.category,
      state: latest.state,
      amountAudCents: latest.amountAudCents,
    });
  }
  return { effective, duplicateRouteCount };
}

function expectedManifestSources(records) {
  const map = new Map();
  for (const record of records) {
    if (["evidence_set_manifest", "terminal_stop"].includes(record.kind)) continue;
    const entry = sourceToManifestEntry(record.source);
    map.set(manifestSourceIdentity(entry), entry);
  }
  return [...map.values()].sort(
    (left, right) => manifestSourceIdentity(left).localeCompare(manifestSourceIdentity(right)),
  );
}

function checkManifest(contract, records, blockers) {
  const manifests = records.filter((record) => record.kind === "evidence_set_manifest");
  if (!manifests.length) {
    blockers.push(blocker("manifest_missing", "Commercial proof requires a closed evidence-set manifest."));
    return null;
  }
  const chain = resolveAppendOnlyChain(manifests, {
    prefix: "manifest",
    label: "evidence-set manifest",
    chain: (record) => record.manifest.revision,
    economicHash: (record) => sha256(record.manifest),
  }, blockers);
  if (!chain) return null;
  const record = chain.at(-1);
  const manifest = record.manifest;
  if (!sameCanonical(manifest.reportingPeriod, contract.reportingPeriod)) {
    blockers.push(blocker("manifest_period_mismatch", "Evidence manifest does not close the contract reporting period.", record.recordHash));
  }
  if (Date.parse(manifest.closedAt) < Date.parse(contract.reportingPeriod.endsAt)) {
    blockers.push(blocker("manifest_closed_too_early", "Evidence manifest was closed before the reporting period ended.", record.recordHash));
  }
  const expectedHashes = [...new Set(records
    .filter((item) => !["evidence_set_manifest", "terminal_stop"].includes(item.kind))
    .map((item) => item.recordHash))].sort();
  if (!sameCanonical(manifest.recordHashes, expectedHashes)) {
    blockers.push(blocker("manifest_record_set_mismatch", "Evidence manifest does not enumerate every exact proof record and only those records.", record.recordHash));
  }
  const expectedSources = expectedManifestSources(records);
  if (!sameCanonical(manifest.sources, expectedSources)) {
    blockers.push(blocker("manifest_source_set_mismatch", "Evidence manifest does not enumerate every exact source receipt and only those receipts.", record.recordHash));
  }
  const sourceRows = new Map();
  for (const item of records.filter(
    (candidate) => !["evidence_set_manifest", "terminal_stop"].includes(candidate.kind),
  )) {
    const entry = sourceToManifestEntry(item.source);
    const identity = manifestSourceIdentity(entry);
    const rows = sourceRows.get(identity) || new Set();
    rows.add(item.source.sourceRowHash);
    sourceRows.set(identity, rows);
  }
  for (const source of expectedSources) {
    const importedRows = sourceRows.get(manifestSourceIdentity(source)) || new Set();
    if (importedRows.size !== source.coverage.declaredRowCount) {
      blockers.push(blocker(
        "source_control_total_mismatch",
        `Source ${source.sourceId} declares ${source.coverage.declaredRowCount} rows but ${importedRows.size} unique rows are present.`,
        record.recordHash,
      ));
    }
  }
  for (const required of contract.evidenceRules.requiredSources) {
    const present = expectedSources.some((source) => (
      source.sourceId === required.id
      && required.acceptedKinds.includes(source.sourceKind)
      && source.providerNamespace === required.providerNamespace
      && source.accountHash === required.accountHash
      && source.sourceSystem === required.sourceSystem
      && source.exportType === required.exportType
    ));
    if (!present) {
      blockers.push(blocker("required_source_missing", `Required source ${required.id} is absent from the closed evidence set.`, record.recordHash));
    }
  }
  const lateRecords = records.filter((item) => (
    !["evidence_set_manifest", "terminal_stop"].includes(item.kind)
    && Date.parse(item.source.capturedAt) > Date.parse(manifest.closedAt)
  ));
  for (const late of lateRecords) {
    blockers.push(blocker("record_after_manifest_cutoff", "Evidence was captured after the current manifest closed and requires a new manifest revision.", late.recordHash));
  }
  return record;
}

function evaluateCommercialProof(contract, evidenceRecords) {
  validateCommercialTestContract(contract);
  if (!Array.isArray(evidenceRecords)) {
    throw new Error("Commercial proof evaluation requires an evidence list.");
  }
  const normalized = evidenceRecords.map((record) => {
    validateCommercialEvidenceRecord(contract, record);
    return record;
  });
  const sortedRecords = [...normalized].sort((left, right) => left.recordHash.localeCompare(right.recordHash));
  const evidenceSetHash = sha256(sortedRecords.map((record) => record.recordHash));
  const blockers = [];
  const identityMap = new Map();
  const uniqueByHash = new Map();
  for (const record of sortedRecords) {
    uniqueByHash.set(record.recordHash, record);
    const identity = `${record.evidenceId}@${record.evidenceVersion}`;
    const hashes = identityMap.get(identity) || new Set();
    hashes.add(record.recordHash);
    identityMap.set(identity, hashes);
  }
  for (const [identity, hashes] of identityMap) {
    if (hashes.size > 1) {
      blockers.push(blocker("evidence_identity_conflict", `Evidence identity ${identity} has conflicting immutable records.`));
    }
  }
  const records = [...uniqueByHash.values()].sort(
    (left, right) => left.recordHash.localeCompare(right.recordHash),
  );
  const localBlockerHashes = new Set();
  for (const record of records) {
    const issues = [
      ...commonRecordBlockers(contract, record),
      ...temporalBlockers(contract, record),
    ];
    if (record.source.kind === "imported_platform" && record.source.verificationStatus !== "verified") {
      issues.push(blocker(
        record.source.verificationStatus === "rejected" ? "imported_evidence_rejected" : "imported_evidence_unverified",
        `Imported evidence is ${record.source.verificationStatus}.`,
        record.recordHash,
      ));
    }
    if (
      ["manual_verification", "terminal_stop", "evidence_set_manifest"].includes(record.kind)
      && record.source.verificationStatus !== "verified"
    ) {
      issues.push(blocker("control_evidence_unverified", `${record.kind} evidence is not verified.`, record.recordHash));
    }
    if (issues.length) localBlockerHashes.add(record.recordHash);
    blockers.push(...issues);
  }

  const manuallyVerified = resolveManualVerification(records, blockers);
  for (const record of records) {
    if (
      ["transaction", "cost"].includes(record.kind)
      && record.source.kind === "operator_attested_manual"
      && !manuallyVerified.has(record.recordHash)
    ) {
      localBlockerHashes.add(record.recordHash);
    }
  }
  const manifestHead = checkManifest(contract, records, blockers);

  const eligibleHashes = new Set(
    records
      .filter((record) => (
        !localBlockerHashes.has(record.recordHash)
        && (
          record.source.kind === "imported_platform"
            ? record.source.verificationStatus === "verified"
            : !["transaction", "cost"].includes(record.kind)
              || manuallyVerified.has(record.recordHash)
        )
      ))
      .map((record) => record.recordHash),
  );
  const transactionResolution = resolveTransactions(records, eligibleHashes, blockers);
  const costResolution = resolveCosts(records, eligibleHashes, blockers);

  const positiveBuyers = new Set(
    transactionResolution.results
      .filter((transaction) => transaction.netRevenueAudCents > 0)
      .map((transaction) => transaction.buyerPseudonym),
  );
  const settledRevenueAudCents = transactionResolution.results.reduce(
    (total, transaction) => total + transaction.grossRevenueAudCents,
    0,
  );
  const refundsAudCents = transactionResolution.results.reduce(
    (total, transaction) => total + transaction.refundsAudCents,
    0,
  );

  const byCategory = Object.fromEntries(COST_CATEGORIES.map((category) => [category, []]));
  for (const cost of costResolution.effective) byCategory[cost.category].push(cost);
  for (const category of COST_CATEGORIES) {
    if (!byCategory[category].length) {
      blockers.push(blocker("cost_category_missing", `No final ${category} cost truth exists.`));
    }
  }
  for (const cost of costResolution.effective) {
    if (cost.state !== "reconciled") {
      blockers.push(blocker(
        `cost_${cost.state}`,
        `${cost.category} cost ${cost.costKey} remains ${cost.state}; only reconciled cash costs count as actual.`,
      ));
    }
  }
  const reconciledCostsAudCents = costResolution.effective
    .filter((cost) => cost.state === "reconciled")
    .reduce((total, cost) => total + cost.amountAudCents, 0);
  const actualNetCashContributionAudCents = (
    settledRevenueAudCents - refundsAudCents - reconciledCostsAudCents
  );
  const terminalStops = records
    .filter((record) => record.kind === "terminal_stop")
    .map((record) => ({
      recordHash: record.recordHash,
      ...record.terminalStop,
    }))
    .sort((left, right) => left.recordHash.localeCompare(right.recordHash));
  const finalBlockers = sortedUniqueBlockers(blockers);
  const distinctPositiveBuyers = positiveBuyers.size;
  const buyerSignalOnly = distinctPositiveBuyers === 1 || distinctPositiveBuyers === 2;
  const proofReached = (
    terminalStops.length === 0
    && finalBlockers.length === 0
    && distinctPositiveBuyers >= 3
    && actualNetCashContributionAudCents > 0
  );
  const outcome = terminalStops.length
    ? "stop"
    : proofReached
      ? "pass"
      : finalBlockers.length === 0 && distinctPositiveBuyers >= 3
        ? "revise"
        : "inconclusive";
  const result = {
    schema: COMMERCIAL_TEST_PROOF_SCHEMA,
    decisionHash: contract.decisionHash,
    evidenceSetHash,
    outcome,
    applicableRule: contract.decisionRules[outcome],
    proofReached,
    buyerSignalOnly,
    terminalStops,
    blockers: finalBlockers,
    evidence: {
      suppliedRecords: evidenceRecords.length,
      uniqueRecords: records.length,
      routeDuplicateCount: (
        transactionResolution.duplicateRouteCount + costResolution.duplicateRouteCount
      ),
      positiveTransactions: transactionResolution.results.filter(
        (transaction) => transaction.netRevenueAudCents > 0,
      ).length,
      distinctPositiveBuyers,
      manualOriginals: records.filter((record) => (
        ["transaction", "cost"].includes(record.kind)
        && record.source.kind === "operator_attested_manual"
      )).length,
      manuallyVerifiedOriginals: manuallyVerified.size,
      closedManifestPresent: Boolean(manifestHead),
      manifestRevision: manifestHead?.manifest.revision.sequence ?? null,
    },
    financials: {
      currency: "AUD",
      settledRevenueAudCents,
      refundsAudCents,
      reconciledCostsAudCents,
      actualNetCashContributionAudCents,
      settledRevenueAud: settledRevenueAudCents / 100,
      refundsAud: refundsAudCents / 100,
      reconciledCostsAud: reconciledCostsAudCents / 100,
      actualNetCashContributionAud: actualNetCashContributionAudCents / 100,
      costTruthComplete: COST_CATEGORIES.every(
        (category) => (
          byCategory[category].length > 0
          && byCategory[category].every((cost) => cost.state === "reconciled")
        ),
      ),
    },
    proofRequirements: {
      minPositiveIndependentBuyers: 3,
      positiveIndependentBuyersSatisfied: distinctPositiveBuyers >= 3,
      positiveActualAudNetCashContribution: actualNetCashContributionAudCents > 0,
      onlySettledRevenueCounted: true,
      onlyReconciledCostsCounted: true,
      closedEvidenceManifest: Boolean(manifestHead),
      allEvidenceInScopeVerifiedReconciledAndComplete: finalBlockers.length === 0,
    },
  };
  result.evaluationHash = sha256(result);
  return deepFreeze(result);
}

module.exports = {
  COMMERCIAL_TEST_CONTRACT_SCHEMA,
  COMMERCIAL_TEST_EVIDENCE_SCHEMA,
  COMMERCIAL_TEST_PROOF_SCHEMA,
  COST_CATEGORIES,
  COST_STATES,
  EVIDENCE_KINDS,
  EVIDENCE_SOURCE_KINDS,
  OPERATOR_ROLE,
  PREPARATION_EXTERNAL_SPEND_CAP_AUD,
  PROTECTED_ACTION_KEYS,
  SETTLEMENT_STATES,
  TRANSACTION_EVENT_TYPES,
  TRANSACTION_STATUSES,
  VERIFICATION_STATUSES,
  costEconomicHash,
  createCommercialEvidenceRecord,
  createCommercialTestContract,
  createEvidenceSetManifest,
  createManualVerificationRecord,
  createTerminalStopRecord,
  evaluateCommercialProof,
  offerDefinitionHash,
  pseudonymizeBuyer,
  routeIndependentTransactionKey,
  sha256,
  sourceCoverageHash,
  transactionEconomicHash,
  validateCommercialEvidenceRecord,
  validateCommercialTestContract,
};
