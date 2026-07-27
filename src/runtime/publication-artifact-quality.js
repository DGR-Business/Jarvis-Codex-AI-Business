const path = require("node:path");

const INTERNAL_DRAFTING_PATTERNS = [
  /\bwe need (?:to )?(?:avoid|make|keep|simplify|shorten|revise|change)\b/i,
  /\bmaybe (?:simplify|shorten|rewrite|revise|remove|add)\b/i,
  /\b(?:this|the) (?:answer|response|output|copy) should\b/i,
  /\bas an ai\b/i,
  /\bi should (?:avoid|add|remove|rewrite|mention|say)\b/i,
];

const CURRENT_PACKAGE_DEFECT_PATTERNS = [
  /\b(?:reconcile|repair|fix|correct)\b[^.\n]{0,120}\b(?:listing|manifest|filename|file list|package)\b/i,
  /\b(?:listing|manifest|filename|file list|package)\b[^.\n]{0,80}\b(?:is|remains|contains|has)\b[^.\n]{0,30}\b(?:malformed|truncated|incomplete|mismatched)\b/i,
  /\b(?:malformed|truncated|incomplete|mismatched)\b[^.\n]{0,60}\b(?:listing|manifest|filename|file list|package)\b/i,
  /\bmalformed\b[^.\n]{0,120}\.(?:csv|xlsx|pdf|zip)\b/i,
];

function normalizePublicationText(value) {
  return String(value ?? "")
    .replace(/\u00e2\u20ac\u201c/g, "-")
    .replace(/\u00e2\u20ac\u201d/g, "-")
    .replace(/\u00e2\u20ac\u02dc/g, "'")
    .replace(/\u00e2\u20ac\u2122/g, "'")
    .replace(/\u00e2\u20ac\u0153/g, '"')
    .replace(/\u00e2\u20ac\u009d/g, '"')
    .replace(/\u2013|\u2014/g, "-")
    .replace(/\u2018|\u2019/g, "'")
    .replace(/\u201c|\u201d/g, '"')
    .replace(/\u00c2(?=\s|A\$|US\$|\$)/g, "")
    .replace(/[^\S\r\n]+/g, " ")
    .trim();
}

function splitSentences(value) {
  return normalizePublicationText(value)
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function publicationSafeText(value) {
  return splitSentences(value)
    .filter((sentence) => !INTERNAL_DRAFTING_PATTERNS.some((pattern) => pattern.test(sentence)))
    .join(" ")
    .trim();
}

function publicationSafeList(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map(publicationSafeText)
    .filter(Boolean);
}

function collectStrings(value, target = []) {
  if (typeof value === "string") {
    target.push(value);
    return target;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, target);
    return target;
  }
  if (value && typeof value === "object") {
    for (const item of Object.values(value)) collectStrings(item, target);
  }
  return target;
}

function publicationTextIssues(value, label = "Publication output") {
  const strings = collectStrings(value);
  const issues = [];
  if (strings.some((text) => (
    /\uFFFD/.test(text)
    || /\u00c3[\u0080-\u00ff]/.test(text)
    || /\u00e2\u20ac/.test(text)
    || /\u00c2(?=\s|A\$|US\$|\$)/.test(text)
  ))) {
    issues.push(`${label} contains broken character encoding.`);
  }
  if (strings.some((text) => INTERNAL_DRAFTING_PATTERNS.some((pattern) => pattern.test(text)))) {
    issues.push(`${label} contains internal drafting commentary instead of finished customer-facing text.`);
  }
  return issues;
}

function currentPackageDefectIssues(value, label = "Publication output") {
  const strings = collectStrings(value);
  if (strings.some((text) => CURRENT_PACKAGE_DEFECT_PATTERNS.some((pattern) => pattern.test(text)))) {
    return [`${label} describes an unresolved current package defect, so it cannot be treated as ready to publish.`];
  }
  return [];
}

function basename(value) {
  return path.posix.basename(String(value || "").replaceAll("\\", "/"));
}

function pluralized(count, singular, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function canonicalListingIncludedFiles(manifest = {}) {
  const catalogue = Array.isArray(manifest.catalogueItems) ? manifest.catalogueItems : [];
  const catalogueFiles = catalogue.flatMap((item) => (
    Array.isArray(item.files) ? item.files : []
  ));
  const workbookNames = catalogueFiles.filter((file) => /\.xlsx$/i.test(file)).map(basename);
  const csvNames = catalogueFiles.filter((file) => /\.csv$/i.test(file)).map(basename);
  const sharedNames = (Array.isArray(manifest.sharedFiles) ? manifest.sharedFiles : []).map(basename);
  const previewNames = (Array.isArray(manifest.storefrontPreviews) ? manifest.storefrontPreviews : []).map(basename);
  const bundleName = basename(manifest.bundle?.filename);
  const entries = [];

  if (workbookNames.length) {
    entries.push(`${pluralized(workbookNames.length, "editable Excel workbook")}: ${workbookNames.join(", ")}`);
  }
  if (csvNames.length) {
    entries.push(`${pluralized(csvNames.length, "matching sample CSV file")}: ${csvNames.join(", ")}`);
  }
  if (sharedNames.length) {
    entries.push(`${pluralized(sharedNames.length, "PDF setup guide")}: ${sharedNames.join(", ")}`);
  }
  if (previewNames.length) {
    entries.push(`${pluralized(previewNames.length, "storefront preview image")}: ${previewNames.join(", ")}`);
  }
  if (bundleName) entries.push(`1 ZIP download bundle: ${bundleName}`);
  return entries;
}

function comparableList(value) {
  return (Array.isArray(value) ? value : [])
    .map((item) => normalizePublicationText(item).toLowerCase())
    .filter(Boolean);
}

function exactPublicationListMatch(actual, expected) {
  const left = comparableList(actual);
  const right = comparableList(expected);
  return left.length === right.length && left.every((item, index) => item === right[index]);
}

module.exports = {
  canonicalListingIncludedFiles,
  currentPackageDefectIssues,
  exactPublicationListMatch,
  normalizePublicationText,
  publicationSafeList,
  publicationSafeText,
  publicationTextIssues,
};
