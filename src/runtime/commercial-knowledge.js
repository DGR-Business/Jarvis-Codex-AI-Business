const crypto = require("node:crypto");
const {
  COMMERCIAL_CONSTITUTION_VERSION,
  COMMERCIAL_DOMAINS,
  DECISION_RULES,
  INVESTMENT_CRITERIA,
  MODEL_POLICY,
  SOURCE_TIERS,
} = require("../../config/commercial-constitution");
const {
  KNOWLEDGE_LIBRARY_VERSION,
  propositions,
  sources,
} = require("../../config/commercial-knowledge-v1");
const { all, fromJson, get, now, randomId, run, toJson } = require("../db");

const MAX_CONTEXT_RECORDS = 8;
const DOMAIN_SET = new Set(COMMERCIAL_DOMAINS);
const CLASS_SET = new Set(["doctrine", "market_evidence", "proven_learning"]);

const QUERY_EXPANSIONS = Object.freeze({
  buyer: ["customer", "segment", "problem", "value"],
  customer: ["buyer", "segment", "problem", "value"],
  demand: ["purchase", "transaction", "willingness", "market"],
  market: ["demand", "competition", "buyer", "entry"],
  competitor: ["competition", "substitute", "entry", "positioning"],
  competition: ["competitor", "substitute", "entry", "positioning"],
  price: ["pricing", "margin", "cost", "willingness"],
  pricing: ["price", "margin", "cost", "willingness"],
  margin: ["contribution", "cost", "price", "break-even"],
  cost: ["expense", "margin", "cashflow", "break-even"],
  channel: ["distribution", "marketing", "reach", "conversion"],
  marketing: ["distribution", "channel", "buyer", "conversion"],
  product: ["offer", "quality", "catalogue", "purpose"],
  offer: ["product", "value", "positioning", "buyer"],
  risk: ["uncertainty", "claims", "platform", "intellectual-property"],
  evidence: ["source", "provenance", "confidence", "observed"],
  experiment: ["hypothesis", "metric", "test", "learning"],
  test: ["experiment", "hypothesis", "metric", "learning"],
  finance: ["cashflow", "budget", "forecast", "records"],
  service: ["supplier", "trial", "cost", "retention"],
});

const WORKER_DOMAIN_HINTS = Object.freeze({
  chief_of_staff: COMMERCIAL_DOMAINS,
  opportunity_scout: ["customer_value", "market_structure", "competition", "positioning", "distribution", "risk"],
  demand_validator: ["customer_value", "market_structure", "competition", "pricing", "experimentation"],
  offer_architect: ["customer_value", "positioning", "product_strategy", "pricing", "distribution"],
  product_builder: ["product_strategy", "operations", "risk"],
  copy_conversion_agent: ["customer_value", "positioning", "distribution", "risk"],
  distribution_operator: ["distribution", "pricing", "operations", "experimentation", "risk"],
  finance_analyst: ["pricing", "unit_economics", "finance", "risk"],
  customer_voice_agent: ["customer_value", "product_strategy", "experimentation"],
  growth_analyst: ["distribution", "unit_economics", "experimentation", "finance"],
  quality_reviewer: ["product_strategy", "operations", "finance", "risk"],
});

function sha256(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function cleanText(value, max = 4000) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function uniqueStrings(values) {
  return [...new Set((Array.isArray(values) ? values : []).map((value) => cleanText(value, 80)).filter(Boolean))];
}

function ensureCommercialKnowledge(db) {
  const timestamp = now();
  for (const source of sources) {
    run(
      db,
      `INSERT INTO commercial_knowledge_sources
       (id, title, publisher, url, source_tier, source_type, jurisdiction,
        published_at, reviewed_at, expires_at, methodology, licence, metadata,
        created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         title = excluded.title,
         publisher = excluded.publisher,
         url = excluded.url,
         source_tier = excluded.source_tier,
         source_type = excluded.source_type,
         jurisdiction = excluded.jurisdiction,
         published_at = excluded.published_at,
         reviewed_at = excluded.reviewed_at,
         expires_at = excluded.expires_at,
         methodology = excluded.methodology,
         licence = excluded.licence,
         metadata = excluded.metadata,
         updated_at = excluded.updated_at`,
      [
        source.id,
        source.title,
        source.publisher,
        source.url,
        source.sourceTier,
        source.sourceType,
        source.jurisdiction,
        source.publishedAt || null,
        source.reviewedAt,
        source.expiresAt,
        source.methodology,
        source.licence,
        toJson(source.metadata),
        timestamp,
        timestamp,
      ],
    );
  }
  for (const item of propositions) {
    run(
      db,
      `INSERT INTO commercial_knowledge
       (id, source_id, knowledge_class, domain, title, proposition, applicability,
        limitations, contrary_evidence, confidence, jurisdiction, tags,
        effective_at, review_date, expires_at, status, version, supersedes_id,
        source_quote_hash, metadata, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', 1, NULL, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         source_id = excluded.source_id,
         knowledge_class = excluded.knowledge_class,
         domain = excluded.domain,
         title = excluded.title,
         proposition = excluded.proposition,
         applicability = excluded.applicability,
         limitations = excluded.limitations,
         contrary_evidence = excluded.contrary_evidence,
         confidence = excluded.confidence,
         jurisdiction = excluded.jurisdiction,
         tags = excluded.tags,
         effective_at = excluded.effective_at,
         review_date = excluded.review_date,
         expires_at = excluded.expires_at,
         source_quote_hash = excluded.source_quote_hash,
         metadata = excluded.metadata,
         updated_at = excluded.updated_at`,
      [
        item.id,
        item.sourceId,
        item.knowledgeClass,
        item.domain,
        item.title,
        item.proposition,
        item.applicability,
        item.limitations,
        item.contraryEvidence,
        item.confidence,
        item.jurisdiction,
        toJson(item.tags),
        item.effectiveAt,
        item.reviewDate,
        item.expiresAt,
        sha256(`${item.sourceId}:${item.proposition}`),
        toJson({ libraryVersion: KNOWLEDGE_LIBRARY_VERSION }),
        timestamp,
        timestamp,
      ],
    );
  }
  return commercialKnowledgeState(db);
}

function commercialKnowledgeState(db) {
  const counts = all(
    db,
    `SELECT knowledge_class, domain, COUNT(*) AS count
     FROM commercial_knowledge
     WHERE status = 'active'
     GROUP BY knowledge_class, domain
     ORDER BY knowledge_class, domain`,
  );
  return {
    constitutionVersion: COMMERCIAL_CONSTITUTION_VERSION,
    libraryVersion: KNOWLEDGE_LIBRARY_VERSION,
    sourceCount: Number(get(db, "SELECT COUNT(*) AS count FROM commercial_knowledge_sources")?.count || 0),
    propositionCount: Number(get(db, "SELECT COUNT(*) AS count FROM commercial_knowledge WHERE status = 'active'")?.count || 0),
    byClassAndDomain: counts,
    sourceTiers: SOURCE_TIERS,
    retrieval: {
      engine: "sqlite_fts5",
      embeddingsEnabled: false,
      maxTaskRecords: MAX_CONTEXT_RECORDS,
    },
  };
}

function tokenizeQuery(query) {
  const base = String(query || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]+/g, " ")
    .split(/\s+/)
    .map((token) => token.replace(/^-+|-+$/g, ""))
    .filter((token) => token.length >= 3 && token.length <= 40);
  const expanded = [...base];
  for (const token of base) expanded.push(...(QUERY_EXPANSIONS[token] || []));
  return uniqueStrings(expanded).slice(0, 24);
}

function ftsExpression(query) {
  return tokenizeQuery(query)
    .map((token) => `"${token.replace(/"/g, "")}"*`)
    .join(" OR ");
}

function parseKnowledgeRow(row) {
  return {
    id: row.id,
    knowledgeClass: row.knowledge_class,
    domain: row.domain,
    title: row.title,
    proposition: row.proposition,
    applicability: row.applicability,
    limitations: row.limitations,
    contraryEvidence: row.contrary_evidence,
    confidence: row.confidence,
    jurisdiction: row.jurisdiction,
    tags: fromJson(row.tags, []),
    reviewDate: row.review_date,
    expiresAt: row.expires_at,
    source: {
      id: row.source_id,
      title: row.source_title,
      publisher: row.publisher,
      url: row.url,
      tier: row.source_tier,
      type: row.source_type,
      jurisdiction: row.source_jurisdiction,
      reviewedAt: row.source_reviewed_at,
      expiresAt: row.source_expires_at,
    },
    rank: Number.isFinite(Number(row.rank)) ? Number(row.rank) : null,
  };
}

function searchCommercialKnowledge(db, input = {}) {
  const query = cleanText(input.query, 1200);
  if (!query) return [];
  const limit = Math.max(1, Math.min(Number(input.limit || MAX_CONTEXT_RECORDS), 20));
  const classes = uniqueStrings(input.classes).filter((value) => CLASS_SET.has(value));
  const domains = uniqueStrings(input.domains).filter((value) => DOMAIN_SET.has(value));
  const jurisdiction = cleanText(input.jurisdiction, 80);
  const expression = ftsExpression(query);
  const conditions = [
    "knowledge.status = 'active'",
    "(knowledge.expires_at IS NULL OR knowledge.expires_at >= date('now'))",
    "(sources.expires_at IS NULL OR sources.expires_at >= date('now'))",
  ];
  const parameters = [];
  if (classes.length) {
    conditions.push(`knowledge.knowledge_class IN (${classes.map(() => "?").join(", ")})`);
    parameters.push(...classes);
  }
  if (domains.length) {
    conditions.push(`knowledge.domain IN (${domains.map(() => "?").join(", ")})`);
    parameters.push(...domains);
  }
  if (jurisdiction) {
    conditions.push("(lower(knowledge.jurisdiction) IN ('global', lower(?)) OR lower(sources.jurisdiction) IN ('global', lower(?)))");
    parameters.push(jurisdiction, jurisdiction);
  }
  let rows = [];
  if (expression) {
    rows = all(
      db,
      `SELECT knowledge.*, sources.title AS source_title, sources.publisher, sources.url,
              sources.source_tier, sources.source_type,
              sources.jurisdiction AS source_jurisdiction,
              sources.reviewed_at AS source_reviewed_at,
              sources.expires_at AS source_expires_at,
              bm25(commercial_knowledge_fts, 0.0, 2.5, 4.0, 1.5, 0.5, 0.25) AS rank
       FROM commercial_knowledge_fts
       JOIN commercial_knowledge AS knowledge
         ON knowledge.id = commercial_knowledge_fts.knowledge_id
       JOIN commercial_knowledge_sources AS sources
         ON sources.id = knowledge.source_id
       WHERE commercial_knowledge_fts MATCH ?
         AND ${conditions.join("\n         AND ")}
       ORDER BY rank ASC, sources.source_tier ASC, knowledge.review_date DESC
       LIMIT ?`,
      [expression, ...parameters, limit],
    );
  }
  if (!rows.length) {
    const like = `%${query.toLowerCase()}%`;
    rows = all(
      db,
      `SELECT knowledge.*, sources.title AS source_title, sources.publisher, sources.url,
              sources.source_tier, sources.source_type,
              sources.jurisdiction AS source_jurisdiction,
              sources.reviewed_at AS source_reviewed_at,
              sources.expires_at AS source_expires_at,
              NULL AS rank
       FROM commercial_knowledge AS knowledge
       JOIN commercial_knowledge_sources AS sources ON sources.id = knowledge.source_id
       WHERE ${conditions.join("\n         AND ")}
         AND (
           lower(knowledge.title) LIKE ?
           OR lower(knowledge.proposition) LIKE ?
           OR lower(knowledge.applicability) LIKE ?
           OR lower(knowledge.tags) LIKE ?
         )
       ORDER BY sources.source_tier ASC, knowledge.review_date DESC
       LIMIT ?`,
      [...parameters, like, like, like, like, limit],
    );
  }
  return rows.map(parseKnowledgeRow);
}

function commercialContextForTask(db, input = {}) {
  if (!get(db, "SELECT id FROM commercial_knowledge WHERE status = 'active' LIMIT 1")) {
    ensureCommercialKnowledge(db);
  }
  const workerId = cleanText(input.workerId, 80);
  const hints = WORKER_DOMAIN_HINTS[workerId] || [];
  const requestedDomains = uniqueStrings(input.domains).filter((value) => DOMAIN_SET.has(value));
  const domains = requestedDomains.length ? requestedDomains : hints;
  const query = [
    input.purpose,
    input.subject,
    input.buyer,
    input.problem,
    input.offer,
    input.channel,
    ...domains,
  ].filter(Boolean).join(" ");
  const records = searchCommercialKnowledge(db, {
    query,
    classes: input.classes || ["doctrine", "proven_learning"],
    domains,
    jurisdiction: input.jurisdiction || "Australia",
    limit: input.limit || MAX_CONTEXT_RECORDS,
  });
  return {
    constitutionVersion: COMMERCIAL_CONSTITUTION_VERSION,
    libraryVersion: KNOWLEDGE_LIBRARY_VERSION,
    workerId,
    queryHash: sha256(query),
    domains,
    recordCount: records.length,
    records,
    decisionRules: DECISION_RULES,
    instruction: "Apply only relevant propositions. Cite source URLs. Keep doctrine separate from current market evidence and state limitations or contrary evidence.",
  };
}

function addCommercialKnowledge(db, input = {}) {
  const knowledgeClass = cleanText(input.knowledgeClass, 40);
  const domain = cleanText(input.domain, 80);
  if (!CLASS_SET.has(knowledgeClass)) throw new Error(`Unsupported commercial knowledge class: ${knowledgeClass}`);
  if (!DOMAIN_SET.has(domain)) throw new Error(`Unsupported commercial knowledge domain: ${domain}`);
  const source = get(db, "SELECT * FROM commercial_knowledge_sources WHERE id = ?", [input.sourceId]);
  if (!source) throw new Error("Commercial knowledge requires a registered source.");
  if (!cleanText(input.proposition)) throw new Error("Commercial knowledge requires a proposition.");
  if (!cleanText(input.applicability) || !cleanText(input.limitations)) {
    throw new Error("Commercial knowledge requires applicability and limitations.");
  }
  const timestamp = now();
  const id = input.id || `commercial_${knowledgeClass}_${randomId()}`;
  run(
    db,
    `INSERT INTO commercial_knowledge
     (id, source_id, knowledge_class, domain, title, proposition, applicability,
      limitations, contrary_evidence, confidence, jurisdiction, tags,
      effective_at, review_date, expires_at, status, version, supersedes_id,
      source_quote_hash, metadata, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      source.id,
      knowledgeClass,
      domain,
      cleanText(input.title || input.proposition, 240),
      cleanText(input.proposition),
      cleanText(input.applicability),
      cleanText(input.limitations),
      cleanText(input.contraryEvidence),
      ["high", "medium", "low"].includes(input.confidence) ? input.confidence : "low",
      cleanText(input.jurisdiction || source.jurisdiction || "global", 80),
      toJson(uniqueStrings(input.tags)),
      input.effectiveAt || null,
      input.reviewDate || timestamp.slice(0, 10),
      input.expiresAt || null,
      input.status || "active",
      Math.max(1, Number(input.version || 1)),
      input.supersedesId || null,
      input.sourceQuoteHash || sha256(`${source.id}:${input.proposition}`),
      toJson(input.metadata || {}),
      timestamp,
      timestamp,
    ],
  );
  return parseKnowledgeRow(get(
    db,
    `SELECT knowledge.*, sources.title AS source_title, sources.publisher, sources.url,
            sources.source_tier, sources.source_type,
            sources.jurisdiction AS source_jurisdiction,
            sources.reviewed_at AS source_reviewed_at,
            sources.expires_at AS source_expires_at,
            NULL AS rank
     FROM commercial_knowledge AS knowledge
     JOIN commercial_knowledge_sources AS sources ON sources.id = knowledge.source_id
     WHERE knowledge.id = ?`,
    [id],
  ));
}

function getCommercialConstitution() {
  return {
    version: COMMERCIAL_CONSTITUTION_VERSION,
    domains: COMMERCIAL_DOMAINS,
    sourceTiers: SOURCE_TIERS,
    criteria: INVESTMENT_CRITERIA,
    decisionRules: DECISION_RULES,
    modelPolicy: MODEL_POLICY,
  };
}

function createCommercialContextProvider(db) {
  return Object.freeze({
    contract: "CommercialContextProvider.v1",
    constitution: getCommercialConstitution,
    state: () => commercialKnowledgeState(db),
    search: (input) => searchCommercialKnowledge(db, input),
    forTask: (input) => commercialContextForTask(db, input),
  });
}

module.exports = {
  MAX_CONTEXT_RECORDS,
  addCommercialKnowledge,
  commercialContextForTask,
  commercialKnowledgeState,
  createCommercialContextProvider,
  ensureCommercialKnowledge,
  getCommercialConstitution,
  searchCommercialKnowledge,
  tokenizeQuery,
};
