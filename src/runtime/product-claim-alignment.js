const COMPARATIVE_CLAIMS = [
  {
    pattern: /\b(?:better|fewer|faster|improv(?:e|es|ed|ing|ement)|reduc(?:e|es|ed|ing|tion)|increas(?:e|es|ed|ing)|boost(?:s|ed|ing)?|maximi[sz](?:e|es|ed|ing)|minimi[sz](?:e|es|ed|ing))\b/i,
    description: "an unmeasured comparative outcome",
  },
  {
    pattern: /\b(?:save(?:s|d)?\s+time|time[- ]saving|prevent(?:s|ed|ing)?|eliminat(?:e|es|ed|ing)|guarantee(?:s|d)?|ensure(?:s|d)?)\b/i,
    description: "an outcome that the files cannot prove before a measured customer test",
  },
];

const STOP_WORDS = new Set([
  "a",
  "all",
  "an",
  "and",
  "each",
  "for",
  "from",
  "in",
  "of",
  "on",
  "or",
  "the",
  "to",
  "with",
  "your",
]);

function compact(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalize(value) {
  return compact(value).toLowerCase();
}

function assertedCapabilityText(value) {
  return compact(value)
    .replace(/\b(?:instead of|rather than|without)\b[^.;]*/gi, "")
    .replace(/\b(?:do|does|will|can|must|is|are)\s+not\b[^.;]*/gi, "")
    .replace(
      /\bno\s+(?:notion|airtable|client\s+portal|hosted\s+portal|web\s+app|mobile\s+app|crm|automation|integration|two-way\s+sync)\b[^.;]*/gi,
      "",
    );
}

function significantTokens(value) {
  return normalize(value)
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 2 && !STOP_WORDS.has(token));
}

function targetIsNamed(target, support) {
  const supportText = normalize(support);
  const tokens = significantTokens(target);
  return tokens.length > 0 && tokens.every((token) => supportText.includes(token));
}

function actionMatches(claim) {
  const matches = [];
  const text = compact(claim);
  const confirmation = /\b(confirm|verify|validate|approve)\s+(?:the\s+)?([a-z0-9][a-z0-9 &'/-]{1,60}?)(?=\s+(?:and\s+)?(?:confirm|verify|validate|approve|complete|organize|organise)\b|[,.;:]|$)/gi;
  const completion = /\b(complete)\s+(?:the\s+|all\s+)?((?:required|project|client|customer|order|scope|information|details|records?|fields?)[a-z0-9 &'/-]{0,48}?)(?=\s+(?:and\s+)?(?:confirm|verify|validate|approve|complete|organize|organise)\b|[,.;:]|$)/gi;
  const organization = /\b(organize|organise)\s+(?:the\s+)?((?:files?|documents?|records?)[a-z0-9 &'/-]{0,36}?)(?=\s+(?:and\s+)?(?:confirm|verify|validate|approve|complete|organize|organise)\b|[,.;:]|$)/gi;
  for (const [pattern, type] of [
    [confirmation, "confirmation"],
    [completion, "completion"],
    [organization, "organization"],
  ]) {
    let match = pattern.exec(text);
    while (match) {
      matches.push({
        type,
        verb: normalize(match[1]),
        target: compact(match[2]),
      });
      match = pattern.exec(text);
    }
  }
  return matches;
}

function claimAlignmentIssues(claim, support, label) {
  const text = compact(claim);
  if (!text) return [];
  const supportText = normalize(support);
  const issues = [];
  const assertedOutcomeText = text
    .replace(
      /\b(?:do|does|will|can|must)\s+not\s+(?:promise|claim|guarantee)\b[^.;]*/gi,
      "",
    )
    .replace(
      /\b(?:no|without)\s+(?:a\s+)?(?:promise(?:d|s|ing)?|claim(?:ed|s|ing)?|guarantee(?:d|s|ing)?)\b[^.;]*/gi,
      "",
    )
    .replace(
      /\b(?:rather than|instead of)\s+(?:an?\s+|the\s+)?(?:promise(?:d|s|ing)?|claim(?:ed|s|ing)?|guarantee(?:d|s|ing)?)\b[^.;]*/gi,
      "",
    );
  for (const rule of COMPARATIVE_CLAIMS) {
    if (rule.pattern.test(assertedOutcomeText)) {
      issues.push(`${label} promises ${rule.description}. Use a literal functional claim until real results support an outcome claim.`);
    }
  }
  for (const action of actionMatches(text)) {
    if (!targetIsNamed(action.target, supportText)) {
      issues.push(`${label} says "${action.verb} ${action.target}" but the named target is not explicit in a field, instruction, or included tool.`);
      continue;
    }
    if (
      action.type === "confirmation"
      && !/\b(confirm(?:ed|ation)?|verify|validat|approv|accept|sign[- ]?off|status)\b/i.test(supportText)
    ) {
      issues.push(`${label} promises confirmation or approval without an explicit confirmation, approval, sign-off, or status mechanism.`);
    }
    if (
      action.type === "completion"
      && !/\b(required|complete|completion|missing|checklist|criteria|criterion|status)\b/i.test(supportText)
    ) {
      issues.push(`${label} promises completeness without required-field, checklist, missing-item, or completion criteria.`);
    }
    if (
      action.type === "organization"
      && !/\b(file|document|record).{0,24}\b(index|location|folder|path|name|status)\b|\b(index|location|folder|path|name|status).{0,24}\b(file|document|record)\b/i.test(supportText)
    ) {
      issues.push(`${label} promises organized files or records without an explicit index, location, path, name, or status mechanism.`);
    }
  }
  if (
    /\b(?:calculat(?:e|es|ed|ing|ion)|calculator|compute)\b/i.test(text)
    && !/\b(?:formula|calculated|multiply|sum|subtract|percent_of)\b/i.test(supportText)
  ) {
    issues.push(`${label} promises a calculation without an explicit calculated field and operation.`);
  }
  if (
    /\b(?:email|message)\s+(?:script|scripts|template|templates|wording)\b/i.test(text)
    && !/\b(?:email|message)\s+(?:body|copy|text|wording)|script\s+(?:body|copy|text|wording)\b/i.test(supportText)
  ) {
    issues.push(`${label} promises communication wording without an explicit body, copy, text, or wording field.`);
  }
  return issues;
}

function offerClaimAlignmentIssues(work = {}) {
  const items = Array.isArray(work.catalogueItems) ? work.catalogueItems : [];
  const issues = [];
  const allSupport = items.flatMap((item) => [
    item?.title,
    ...(Array.isArray(item?.includedTools) ? item.includedTools : []),
    item?.differentiation,
  ]).join(" ");
  issues.push(...claimAlignmentIssues(work.promise, allSupport, "The main offer promise"));
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index] || {};
    const support = [
      item.title,
      ...(Array.isArray(item.includedTools) ? item.includedTools : []),
      item.differentiation,
    ].join(" ");
    issues.push(...claimAlignmentIssues(
      item.outcome,
      support,
      `Catalogue item ${index + 1} (${compact(item.title) || "untitled"})`,
    ));
  }
  return [...new Set(issues)];
}

function digitalProductKitCompatibilityIssues(work = {}) {
  const items = Array.isArray(work.catalogueItems) ? work.catalogueItems : [];
  const issues = [];
  const unsupported = [
    {
      pattern: /\b(?:notion|airtable)\b/i,
      description: "a platform-specific workspace that Pantheon's current Excel product factory does not create",
    },
    {
      pattern: /\b(?:client\s+portal|hosted\s+portal|web\s+app|mobile\s+app|crm)\b/i,
      description: "hosted software or a portal that the current local product factory does not create",
    },
    {
      pattern: /\b(?:reusable\s+databases?|project\s+index|separate\s+(?:views|pages|databases?))\b/i,
      description: "multiple data structures that are not implemented by the current three-sheet workbook format",
    },
    {
      pattern: /\b(?:automat(?:e|es|ed|ing|ion)|integrat(?:e|es|ed|ing|ion)|two-way\s+sync)\b/i,
      description: "automation or integration that the current downloadable files do not perform",
    },
  ];
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index] || {};
    const claimText = assertedCapabilityText([
      item.format,
      item.outcome,
      item.differentiation,
    ].map(compact).filter(Boolean).join(" "));
    for (const rule of unsupported) {
      if (rule.pattern.test(claimText)) {
        issues.push(
          `Catalogue item ${index + 1} (${compact(item.title) || "untitled"}) promises ${rule.description}. Narrow it to one truthful Excel workbook, sample CSV, setup guide, and the exact fields it contains.`,
        );
      }
    }
  }
  return [...new Set(issues)];
}

function productBlueprintClaimAlignmentIssues(blueprint = {}, buildSpec = {}) {
  const blueprintItems = Array.isArray(blueprint.catalogueItems) ? blueprint.catalogueItems : [];
  const approvedItems = Array.isArray(buildSpec.catalogueItems) ? buildSpec.catalogueItems : [];
  const approvedById = new Map(approvedItems.map((item) => [String(item.id || ""), item]));
  const actualIds = blueprintItems.map((item) => String(item?.id || ""));
  const issues = [];

  if (actualIds.some((id) => !id) || new Set(actualIds).size !== actualIds.length) {
    issues.push("The Product Builder blueprint contains a missing or duplicate catalogue item id.");
  }
  const missingIds = approvedItems
    .map((item) => String(item.id || ""))
    .filter((id) => id && !actualIds.includes(id));
  const unknownIds = actualIds.filter((id) => id && !approvedById.has(id));
  if (missingIds.length) issues.push(`The Product Builder blueprint is missing approved catalogue items: ${missingIds.join(", ")}.`);
  if (unknownIds.length) issues.push(`The Product Builder blueprint contains unapproved catalogue items: ${unknownIds.join(", ")}.`);

  const allSupport = blueprintItems.flatMap((item) => [
    item?.title,
    ...(Array.isArray(item?.instructions) ? item.instructions : []),
    ...(Array.isArray(item?.columns)
      ? item.columns.flatMap((column) => [column?.name, column?.guidance])
      : []),
    ...(Array.isArray(item?.calculations)
      ? item.calculations.flatMap((calculation) => [
        calculation?.target,
        calculation?.operation,
        ...(Array.isArray(calculation?.inputs) ? calculation.inputs : []),
        "calculated formula",
      ])
      : []),
  ]).join(" ");
  issues.push(...claimAlignmentIssues(blueprint.customerPromise, allSupport, "The package promise"));

  for (let index = 0; index < blueprintItems.length; index += 1) {
    const item = blueprintItems[index] || {};
    const approved = approvedById.get(String(item.id || "")) || {};
    const support = [
      item.title,
      ...(Array.isArray(item.instructions) ? item.instructions : []),
      ...(Array.isArray(item.columns)
        ? item.columns.flatMap((column) => [column?.name, column?.guidance])
        : []),
      ...(Array.isArray(item.calculations)
        ? item.calculations.flatMap((calculation) => [
          calculation?.target,
          calculation?.operation,
          ...(Array.isArray(calculation?.inputs) ? calculation.inputs : []),
          "calculated formula",
        ])
        : []),
    ].join(" ");
    const itemLabel = `Catalogue item ${index + 1} (${compact(item.title) || compact(approved.title) || "untitled"})`;
    issues.push(...claimAlignmentIssues(item.purpose, support, `${itemLabel} purpose`));
    issues.push(...claimAlignmentIssues(approved.offer, support, `${itemLabel} approved offer`));
  }
  return [...new Set(issues)];
}

module.exports = {
  claimAlignmentIssues,
  digitalProductKitCompatibilityIssues,
  offerClaimAlignmentIssues,
  productBlueprintClaimAlignmentIssues,
};
