"use strict";

const { sha256 } = require("./commercial-test-contract");

const IDENTITY_DERIVATION = "provider_grounded_url_v1";
const GUMROAD_RESERVED_SUBDOMAINS = new Set([
  "api",
  "app",
  "assets",
  "checkout",
  "customers",
  "discover",
  "help",
  "jobs",
  "login",
  "static",
  "status",
  "support",
  "www",
]);

function identityError(code, message) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = 409;
  return error;
}

function canonicalPublicResearchUrl(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw identityError(
      "preventure_research_source_url_invalid",
      "A retained research source URL is invalid.",
    );
  }
  const canonicalHost = parsed.hostname
    .replace(/^\[|\]$/g, "")
    .toLowerCase()
    .replace(/\.+$/g, "");
  const privateName = canonicalHost === "localhost"
    || !canonicalHost.includes(".")
    || [".localhost", ".local", ".internal", ".lan", ".home", ".corp"]
      .some((suffix) => canonicalHost.endsWith(suffix));
  const literalIp = /^(?:\d{1,3}\.){3}\d{1,3}$/.test(canonicalHost)
    || canonicalHost.includes(":");
  if (
    parsed.protocol !== "https:"
    || parsed.username
    || parsed.password
    || !canonicalHost
    || privateName
    || literalIp
    || (parsed.port && parsed.port !== "443")
  ) {
    throw identityError(
      "preventure_research_source_url_unsafe",
      "Research evidence must use a public HTTPS hostname without credentials, private names, literal IPs, or non-standard ports.",
    );
  }
  parsed.hostname = canonicalHost;
  parsed.port = "";
  parsed.hash = "";
  return {
    parsed,
    canonicalHost,
    canonicalUrl: parsed.toString(),
  };
}

function exactDomain(host, base) {
  return host === base || host.endsWith(`.${base}`);
}

function marketplaceChannelId(canonicalHost) {
  if (exactDomain(canonicalHost, "etsy.com")) return "etsy";
  if (exactDomain(canonicalHost, "gumroad.com")) return "gumroad";
  return null;
}

function offerIdentityKey(channelId, pathname) {
  if (channelId === "etsy") {
    const match = pathname.match(/^\/listing\/([1-9][0-9]*)(?:\/|$)/);
    return match ? `etsy:listing:${match[1]}` : null;
  }
  if (channelId === "gumroad") {
    const match = pathname.match(/^\/l\/([A-Za-z0-9_-]{1,255})(?:\/|$)/);
    return match ? `gumroad:product:${match[1]}` : null;
  }
  return null;
}

function stableOfferIdentityUrl(channelId, key) {
  if (!key) return null;
  if (channelId === "etsy") {
    return `https://etsy.com/listing/${key.slice("etsy:listing:".length)}`;
  }
  if (channelId === "gumroad") {
    return `https://gumroad.com/l/${key.slice("gumroad:product:".length)}`;
  }
  return null;
}

function sellerIdentityKey(channelId, canonicalHost, key) {
  if (channelId !== "gumroad" || !key) return null;
  const labels = canonicalHost.split(".");
  if (
    labels.length !== 3
    || labels[1] !== "gumroad"
    || labels[2] !== "com"
    || GUMROAD_RESERVED_SUBDOMAINS.has(labels[0])
  ) {
    return null;
  }
  return `gumroad:publisher-host:${canonicalHost}`;
}

function derivePreventureResearchSourceIdentity(value) {
  const { parsed, canonicalHost, canonicalUrl } = canonicalPublicResearchUrl(value);
  const channelId = marketplaceChannelId(canonicalHost);
  const derivedOfferIdentityKey = offerIdentityKey(channelId, parsed.pathname);
  const sourceIdentityUrl = stableOfferIdentityUrl(channelId, derivedOfferIdentityKey)
    || `${parsed.origin}${parsed.pathname}`;
  return Object.freeze({
    canonicalUrl,
    canonicalHost,
    sourceIdentityUrl,
    sourceIdentityHash: sha256({ sourceIdentityUrl }),
    marketplaceChannelId: channelId,
    offerIdentityKey: derivedOfferIdentityKey,
    sellerIdentityKey: sellerIdentityKey(channelId, canonicalHost, derivedOfferIdentityKey),
    identityDerivation: IDENTITY_DERIVATION,
  });
}

function derivePreventureResearchPublicSourceBinding(value) {
  const identity = derivePreventureResearchSourceIdentity(value);
  const publisherIdentityKey = `public-publisher-host:${identity.canonicalHost}`;
  return Object.freeze({
    ...identity,
    publisherIdentityKey,
    buyerIndependenceGroup: publisherIdentityKey,
  });
}

module.exports = {
  GUMROAD_RESERVED_SUBDOMAINS,
  IDENTITY_DERIVATION,
  canonicalPublicResearchUrl,
  derivePreventureResearchPublicSourceBinding,
  derivePreventureResearchSourceIdentity,
};
