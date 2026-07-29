const crypto = require("node:crypto");
const { all, fromJson, get, now, randomId, run, toJson } = require("../db");
const { commercialContextForTask } = require("./commercial-knowledge");
const {
  getCommercialOwnerTestsState,
} = require("./commercial-owner-state");

const AGENT_CONTEXT_SCHEMA = "jarvis.agent-context-snapshot.v1";
const AGENT_CONTEXT_POLICY_VERSION = "task-scoped-context-v4";
const CONTEXT_CLASSES = Object.freeze([
  "venture",
  "evidence",
  "finance",
  "production",
  "customer",
  "legal",
  "operations",
  "learning",
]);
const CONTEXT_CLASS_SET = new Set(CONTEXT_CLASSES);
const MAX_RECORDS_PER_CLASS = 8;
const ACCOUNTING_CASH_OUTFLOW_TYPES = new Set(["cash_outflow", "prepaid_credit_purchase"]);

const WORKER_CONTEXT_PROFILES = Object.freeze({
  chief_of_staff: CONTEXT_CLASSES,
  opportunity_scout: ["venture", "evidence", "customer"],
  demand_validator: ["venture", "evidence", "customer"],
  offer_architect: ["venture", "evidence", "customer", "finance"],
  product_builder: ["venture", "evidence", "production", "legal"],
  copy_conversion_agent: ["venture", "evidence", "customer", "production", "legal"],
  distribution_operator: ["venture", "evidence", "production", "finance", "operations"],
  finance_analyst: ["venture", "finance", "production", "evidence"],
  customer_voice_agent: ["venture", "customer", "evidence"],
  growth_analyst: ["venture", "evidence", "finance", "customer", "learning"],
  quality_reviewer: ["venture", "evidence", "production", "legal", "finance"],
});

const CREDENTIAL_KEY = /(password|passphrase|secret|api[_-]?key|access[_-]?token|refresh[_-]?token|private[_-]?key|session[_-]?cookie)/i;
const PERSONAL_KEY = /(^|_)(email|phone|buyer_hash|platform_purchase_id|customer_id|contact_id|full_name|address)(_|$)/i;

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .filter((key) => value[key] !== undefined)
        .map((key) => [key, canonicalValue(value[key])]),
    );
  }
  return value ?? null;
}

function hash(value) {
  return crypto.createHash("sha256").update(JSON.stringify(canonicalValue(value))).digest("hex");
}

function commercialTestAuditRef(testId, testVersion) {
  const digest = crypto
    .createHash("sha256")
    .update(
      `pantheon.owner-commercial-test.v1\0${String(testId)}\0${String(testVersion)}`,
      "utf8",
    )
    .digest("hex")
    .slice(0, 20);
  return `test-${digest}`;
}

function text(value, max = 600) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

function uniqueList(value) {
  return [...new Set((Array.isArray(value) ? value : []).filter(Boolean).map(String))];
}

function safeContent(value, options = {}) {
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => safeContent(item, options));
  if (!value || typeof value !== "object") return typeof value === "string" ? text(value, 1200) : value;
  const result = {};
  for (const [key, child] of Object.entries(value)) {
    if (CREDENTIAL_KEY.test(key)) continue;
    if (!options.includePersonalData && PERSONAL_KEY.test(key)) continue;
    result[key] = safeContent(child, options);
  }
  return result;
}

function record(table, row, fields = {}, options = {}) {
  return {
    ref: { table, id: row.id },
    title: text(fields.title || row.title || row.name || row.id, 240),
    summary: text(fields.summary || row.summary || row.description || row.notes, 900),
    facts: safeContent(fields.facts || {}, options),
    occurredAt: fields.occurredAt || row.occurred_at || row.captured_at || row.updated_at || row.created_at || null,
    provenance: fields.provenance || null,
    sensitivity: fields.sensitivity || "business_internal",
  };
}

function contextProfile(workerId, requestedClasses) {
  const allowed = WORKER_CONTEXT_PROFILES[workerId];
  if (!allowed) throw new Error(`No task-scoped context profile exists for ${workerId}.`);
  const requested = uniqueList(requestedClasses);
  const selected = requested.length ? requested : [...allowed];
  const invalid = selected.filter((item) => !CONTEXT_CLASS_SET.has(item) || !allowed.includes(item));
  if (invalid.length) {
    throw new Error(`${workerId} cannot receive these context classes: ${invalid.join(", ")}.`);
  }
  return {
    name: `${workerId}_focused_v1`,
    allowed: [...allowed],
    selected: CONTEXT_CLASSES.filter((item) => selected.includes(item)),
  };
}

function ventureRecords(db, ventureId) {
  return all(
    db,
    `SELECT records.*
     FROM venture_records AS records
     WHERE records.venture_id = ?
       AND NOT EXISTS (
         SELECT 1 FROM venture_records AS newer
         WHERE newer.supersedes_record_id = records.id
       )
     ORDER BY records.created_at DESC`,
    [ventureId],
  ).map((row) => ({
    ...row,
    content: fromJson(row.content, {}),
    metadata: fromJson(row.metadata, {}),
  }));
}

function ventureSection(db, ventureId, options = {}) {
  const venture = get(db, "SELECT * FROM ventures WHERE id = ?", [ventureId]);
  const ventureCase = get(db, "SELECT * FROM venture_cases WHERE venture_id = ?", [ventureId]);
  const records = [];
  const commercialProof = options.commercialProof;
  if (commercialProof) {
    records.push(record(
      "commercial_owner_tests_state",
      { id: `commercial_authority_${ventureId}` },
      {
        title: "Canonical commercial authority",
        summary: commercialProof.currentRecommendation?.detail
          || "No current commercial recommendation is established for this venture.",
        facts: {
          source: commercialProof.source,
          sourceSchema: commercialProof.sourceSchema,
          integrityStatus: commercialProof.integrityStatus,
          authorityStatus: commercialProof.authorityStatus,
          currentTest: commercialProof.currentTest,
          currentRecommendation: commercialProof.currentRecommendation,
          legacyRecommendationsExcluded: true,
        },
      },
    ));
  }
  if (venture) {
    records.push(record("ventures", venture, {
      title: venture.name,
      summary: venture.summary,
      facts: {
        lifecycleStage: venture.lifecycle_stage,
        status: venture.status,
        businessModel: venture.business_model,
        active: Boolean(venture.is_active),
      },
    }));
  }
  if (ventureCase) {
    records.push(record("venture_cases", ventureCase, {
      title: "Recorded venture case assumptions",
      summary: "Buyer, problem, offer, and test assumptions retained as planning context. This record is not current buyer, cash, or recommendation proof.",
      facts: {
        buyer: ventureCase.buyer,
        problem: ventureCase.problem,
        offer: ventureCase.offer,
        priceAud: Number(ventureCase.price_cents || 0) / 100,
        channel: ventureCase.channel,
        evidenceStandard: ventureCase.evidence_standard,
        expectedMetric: ventureCase.expected_metric,
        killRule: ventureCase.kill_rule,
        recordedOperatorDecision: ventureCase.operator_decision,
        commercialAuthority: "context_only",
      },
    }));
  }
  return records;
}

function evidenceSection(db, ventureId, options = {}) {
  const opportunityId = String(options.opportunityId || "").trim();
  const opportunity = opportunityId
    ? get(db, "SELECT * FROM opportunities WHERE id = ? AND venture_id = ?", [opportunityId, ventureId])
    : null;
  const opportunityMetadata = opportunity ? fromJson(opportunity.metadata, {}) : {};
  const evidenceIds = opportunity ? uniqueList(fromJson(opportunity.evidence_ids, [])) : [];
  const opportunityRecord = opportunity
    ? record("opportunities", opportunity, {
      title: `Demand validation for ${opportunity.title}`,
      summary: opportunityMetadata.validation?.recommendation || opportunity.recommendation,
      facts: {
        buyer: opportunity.buyer,
        problem: opportunity.problem,
        offerDirection: opportunity.offer_direction,
        channel: opportunity.channel,
        score: Number(opportunity.overall_score || 0),
        confidence: opportunity.confidence,
        status: opportunity.status,
        validation: opportunityMetadata.validation || null,
      },
      provenance: {
        roundId: opportunity.round_id,
        validationTaskId: opportunityMetadata.validation?.taskId || null,
      },
    })
    : null;
  const evidenceRows = evidenceIds.length
    ? all(
      db,
      `SELECT * FROM commercial_evidence
       WHERE venture_id = ? AND is_demo = 0
         AND id IN (${evidenceIds.map(() => "?").join(", ")})
       ORDER BY captured_at DESC, created_at DESC LIMIT ?`,
      [ventureId, ...evidenceIds, MAX_RECORDS_PER_CLASS - 1],
    )
    : all(
      db,
      `SELECT * FROM commercial_evidence
       WHERE venture_id = ? AND is_demo = 0
       ORDER BY captured_at DESC, created_at DESC LIMIT ?`,
      [ventureId, MAX_RECORDS_PER_CLASS],
    );
  const evidence = evidenceRows.map((row) => record("commercial_evidence", row, {
    summary: row.summary,
    facts: {
      claim: row.claim,
      metric: row.metric,
      measuredValue: row.measured_value,
      measuredUnit: row.measured_unit,
      market: row.market,
      geography: row.geography,
      observedAt: row.observed_at,
      sampleSize: row.sample_size,
      confidence: row.confidence,
    },
    provenance: {
      sourceType: row.source_type,
      sourceUrl: row.source_url || null,
      verifiedAt: row.verified_at || null,
    },
  }));
  if (opportunityRecord) {
    return [opportunityRecord, ...evidence].slice(0, MAX_RECORDS_PER_CLASS);
  }
  const sources = all(
    db,
    `SELECT sources.*, runs.provider, runs.mode, runs.status AS run_status
     FROM research_sources AS sources
     JOIN research_runs AS runs ON runs.id = sources.run_id
     WHERE runs.venture_id = ?
     ORDER BY sources.retrieved_at DESC LIMIT ?`,
    [ventureId, MAX_RECORDS_PER_CLASS - Math.min(evidence.length, MAX_RECORDS_PER_CLASS)],
  ).map((row) => record("research_sources", row, {
    summary: row.relevance,
    provenance: {
      url: row.url,
      publisher: row.publisher,
      publishedAt: row.published_at,
      retrievedAt: row.retrieved_at,
      provider: row.provider,
      mode: row.mode,
      confidence: row.confidence,
    },
  }));
  return [...evidence, ...sources].slice(0, MAX_RECORDS_PER_CLASS);
}

function currentTestVentureId(db, auditRef) {
  if (typeof auditRef !== "string" || auditRef.trim() === "") return null;
  const matches = all(
    db,
    `SELECT test_id, test_version, venture_id
     FROM commercial_test_contracts`,
  ).filter((row) => (
    commercialTestAuditRef(row.test_id, row.test_version) === auditRef
  ));
  return matches.length === 1 ? matches[0].venture_id : null;
}

function canonicalCommercialProof(db, ventureId) {
  const ownerTests = getCommercialOwnerTestsState(db);
  const rawCurrent = ownerTests?.integrity?.status === "ok"
    ? ownerTests?.current
    : null;
  let scopedVentureId = null;
  if (rawCurrent) {
    try {
      scopedVentureId = currentTestVentureId(db, rawCurrent.auditRef);
    } catch {
      scopedVentureId = null;
    }
  }
  const scopeMatches = !rawCurrent || scopedVentureId === ventureId;
  const integrityOk = (
    ownerTests?.integrity?.status === "ok"
    && scopeMatches
  );
  const current = integrityOk ? rawCurrent : null;
  const verifiedBuyerCount = (
    Number.isSafeInteger(current?.proof?.buyers?.verifiedPositive)
    && current.proof.buyers.verifiedPositive >= 0
  )
    ? current.proof.buyers.verifiedPositive
    : null;
  const buyerTarget = (
    Number.isSafeInteger(current?.proof?.buyers?.target)
    && current.proof.buyers.target > 0
  )
    ? current.proof.buyers.target
    : null;
  const netCash = current?.proof?.netCashContribution;
  const cashSettled = (
    integrityOk
    && netCash?.status === "settled"
    && netCash.currency === "AUD"
    && Number.isSafeInteger(netCash.amountCents)
  );
  const recommendation = (
    typeof current?.moneyMove?.title === "string"
    && current.moneyMove.title.trim() !== ""
    && typeof current?.moneyMove?.detail === "string"
    && current.moneyMove.detail.trim() !== ""
  ) ? {
      title: text(current.moneyMove.title, 240),
      detail: text(current.moneyMove.detail, 900),
    } : null;

  return {
    sourceSchema: ownerTests?.schema || null,
    source: "canonical_commercial_test_ledger",
    integrityStatus: integrityOk
      ? "ok"
      : ownerTests?.integrity?.status === "ok"
        ? "attention"
        : ownerTests?.integrity?.status || "attention",
    integrityMessage: scopeMatches
      ? ownerTests?.integrity?.message || null
      : "The current canonical commercial test belongs to a different venture. Buyer, cash, and recommendation claims are withheld.",
    authorityStatus: scopeMatches
      ? ownerTests?.integrity?.authorityStatus || "unavailable"
      : "scope_mismatch",
    currentTest: current ? {
      ventureId,
      auditRef: current.auditRef,
      title: current.title,
      lifecycleStatus: current.lifecycle?.status || null,
      lifecycleLabel: current.lifecycle?.label || null,
    } : null,
    currentRecommendation: recommendation,
    verifiedBuyerCount,
    buyerTarget,
    netCashContribution: {
      status: cashSettled ? "settled" : "not_settled",
      label: cashSettled ? "Settled" : "Not settled",
      currency: "AUD",
      amountCents: cashSettled ? netCash.amountCents : null,
    },
    commercialProofReached: current
      ? (
        current.proof?.commercialProofReached === true
        && cashSettled
        && verifiedBuyerCount !== null
        && buyerTarget !== null
        && verifiedBuyerCount >= buyerTarget
      )
      : null,
    legacySalesAndResultsExcluded: true,
  };
}

function financeSection(db, ventureId, options = {}) {
  const accounting = get(
    db,
    `SELECT
       COALESCE(SUM(CASE
         WHEN venture_id = ? AND status = 'reconciled'
          AND entry_type IN ('cash_outflow', 'prepaid_credit_purchase')
         THEN amount_cents * effect_sign ELSE 0 END), 0) AS venture_cash_outflow_cents,
       COALESCE(SUM(CASE
         WHEN venture_id IS NULL AND status = 'reconciled'
          AND entry_type IN ('cash_outflow', 'prepaid_credit_purchase')
         THEN amount_cents * effect_sign ELSE 0 END), 0) AS shared_cash_outflow_cents,
       COALESCE(SUM(CASE
         WHEN venture_id = ? AND status = 'active' AND entry_type = 'recurring_commitment'
         THEN amount_cents * effect_sign ELSE 0 END), 0) AS venture_recurring_cents,
       COALESCE(SUM(CASE
         WHEN venture_id IS NULL AND status = 'active' AND entry_type = 'recurring_commitment'
         THEN amount_cents * effect_sign ELSE 0 END), 0) AS shared_recurring_cents,
       COUNT(*) AS entry_count
     FROM accounting_entries
     WHERE (venture_id = ? OR venture_id IS NULL) AND currency = 'AUD'`,
    [ventureId, ventureId, ventureId],
  );
  const costs = get(
    db,
    `SELECT
       COALESCE(SUM(CASE WHEN venture_id = ? AND status = 'reconciled'
         THEN amount_cents ELSE 0 END), 0) AS venture_reconciled_cents,
       COALESCE(SUM(CASE WHEN venture_id IS NULL AND status = 'reconciled'
         THEN amount_cents ELSE 0 END), 0) AS shared_reconciled_cents,
       COALESCE(SUM(CASE WHEN venture_id = ? AND status <> 'reconciled'
         THEN amount_cents ELSE 0 END), 0) AS venture_pending_cents,
       COALESCE(SUM(CASE WHEN venture_id IS NULL AND status <> 'reconciled'
         THEN amount_cents ELSE 0 END), 0) AS shared_pending_cents,
       COUNT(*) AS cost_count
     FROM costs
     WHERE (venture_id = ? OR venture_id IS NULL) AND currency = 'AUD'`,
    [ventureId, ventureId, ventureId],
  );
  const commercialProof = options.commercialProof
    || canonicalCommercialProof(db, ventureId);
  const records = [record("finance_summary", { id: `finance_${ventureId}` }, {
    title: "Canonical commercial proof and operating cost context",
    summary: commercialProof.netCashContribution.status === "settled"
      ? "Buyer count and settled AUD net cash contribution come only from Pantheon's verified commercial-test ledger. Operational costs remain separate context."
      : "Commercial net cash contribution is not settled, so no cash amount is supplied. Operational costs remain separate context and do not prove sales.",
    facts: {
      commercialProof,
      operatingCostContext: {
        purpose: "operational_cost_context_only",
        doesNotProveSalesOrCommercialContribution: true,
        currency: "AUD",
        reconciledOutflowsAud: (
          Number(accounting?.venture_cash_outflow_cents || 0)
          + Number(accounting?.shared_cash_outflow_cents || 0)
        ) / 100,
        ventureCashOutflowsAud: Number(accounting?.venture_cash_outflow_cents || 0) / 100,
        sharedCashOutflowsAud: Number(accounting?.shared_cash_outflow_cents || 0) / 100,
        ventureRecurringCommitmentsAud: Number(accounting?.venture_recurring_cents || 0) / 100,
        sharedRecurringCommitmentsAud: Number(accounting?.shared_recurring_cents || 0) / 100,
        accountingEntries: Number(accounting?.entry_count || 0),
        reconciledProviderAndToolCostsAud: (
          Number(costs?.venture_reconciled_cents || 0)
          + Number(costs?.shared_reconciled_cents || 0)
        ) / 100,
        ventureReconciledProviderAndToolCostsAud: Number(costs?.venture_reconciled_cents || 0) / 100,
        sharedReconciledProviderAndToolCostsAud: Number(costs?.shared_reconciled_cents || 0) / 100,
        pendingOrEstimatedCostsAud: (
          Number(costs?.venture_pending_cents || 0)
          + Number(costs?.shared_pending_cents || 0)
        ) / 100,
        venturePendingOrEstimatedCostsAud: Number(costs?.venture_pending_cents || 0) / 100,
        sharedPendingOrEstimatedCostsAud: Number(costs?.shared_pending_cents || 0) / 100,
      },
    },
  })];
  const recent = all(
    db,
    `SELECT * FROM accounting_entries
     WHERE (venture_id = ? OR venture_id IS NULL) AND currency = 'AUD'
     ORDER BY occurred_at DESC, created_at DESC LIMIT ?`,
    [ventureId, MAX_RECORDS_PER_CLASS - 1],
  ).map((row) => record("accounting_entries", row, {
    title: row.category,
    summary: row.description,
    facts: {
      entryType: row.entry_type,
      status: row.status,
      amountAud: Number(row.amount_cents || 0) / 100,
      cashDirection: ACCOUNTING_CASH_OUTFLOW_TYPES.has(row.entry_type)
        ? (Number(row.effect_sign || 1) < 0 ? "outflow_reversal" : "outflow")
        : "non_cash_commitment",
      correctionEffect: Number(row.effect_sign || 1) < 0 ? "reversal" : "original_or_replacement",
      costScope: row.venture_id ? "venture" : "shared_operating_cost",
      source: row.source,
      nextDueAt: row.next_due_at || null,
    },
  }));
  return [...records, ...recent];
}

function productionSection(db, ventureId, options = {}) {
  const workflowId = String(options.workflowId || "").trim();
  const packages = (workflowId
    ? all(
      db,
      `SELECT * FROM work_packages
       WHERE venture_id = ? AND workflow_id = ?
       ORDER BY updated_at DESC LIMIT ?`,
      [ventureId, workflowId, 4],
    )
    : all(
      db,
      `SELECT * FROM work_packages
       WHERE venture_id = ?
       ORDER BY updated_at DESC LIMIT ?`,
      [ventureId, 4],
    )).map((row) => record("work_packages", row, {
    summary: row.decision_needed,
    facts: { kind: row.kind, status: row.status, ownerGroup: row.owner_group, artifactId: row.artifact_id },
  }));
  const deliverables = (workflowId
    ? all(
      db,
      `SELECT * FROM deliverables
       WHERE venture_id = ? AND workflow_id = ?
         AND status <> 'superseded'
       ORDER BY updated_at DESC LIMIT ?`,
      [ventureId, workflowId, MAX_RECORDS_PER_CLASS - Math.min(packages.length, 4)],
    )
    : all(
      db,
      `SELECT * FROM deliverables
       WHERE venture_id = ?
         AND status <> 'superseded'
       ORDER BY updated_at DESC LIMIT ?`,
      [ventureId, MAX_RECORDS_PER_CLASS - Math.min(packages.length, 4)],
    )).map((row) => {
    const sections = all(
      db,
      `SELECT task_id, sequence, content, updated_at
       FROM deliverable_sections
       WHERE deliverable_id = ?
       ORDER BY sequence ASC LIMIT 4`,
      [row.id],
    ).map((section) => ({
      taskId: section.task_id,
      sequence: section.sequence,
      content: fromJson(section.content, {}),
      updatedAt: section.updated_at,
    }));
    return record("deliverables", row, {
      title: row.human_name || row.title,
      summary: row.summary,
      facts: {
        status: row.status,
        format: row.format,
        audience: row.audience,
        version: row.version,
        contentHash: row.content_hash || fromJson(row.metadata, {}).sha256 || null,
        sections,
      },
    });
  });
  return [...packages, ...deliverables].slice(0, MAX_RECORDS_PER_CLASS);
}

function customerSection(db, ventureId, options = {}) {
  const commercialProof = options.commercialProof
    || canonicalCommercialProof(db, ventureId);
  return [record(
    "commercial_owner_tests_state",
    { id: `commercial_buyers_${ventureId}` },
    {
      title: "Canonical buyer evidence",
      summary: commercialProof.verifiedBuyerCount === null
        ? "No verified buyer count is established for this venture."
        : `${commercialProof.verifiedBuyerCount} verified positive buyer${
          commercialProof.verifiedBuyerCount === 1 ? "" : "s"
        } are recorded in the canonical commercial-test ledger.`,
      facts: {
        source: commercialProof.source,
        sourceSchema: commercialProof.sourceSchema,
        integrityStatus: commercialProof.integrityStatus,
        currentTest: commercialProof.currentTest,
        verifiedBuyerCount: commercialProof.verifiedBuyerCount,
        buyerTarget: commercialProof.buyerTarget,
        legacyFeedbackExcluded: true,
      },
    },
  )];
}

function operationsSection(db, ventureId, options = {}) {
  const workflowId = String(options.workflowId || "").trim();
  const tasks = (workflowId
    ? all(
      db,
      `SELECT * FROM tasks
       WHERE venture_id = ? AND workflow_id = ? AND status NOT IN ('completed', 'cancelled')
       ORDER BY priority ASC, updated_at DESC LIMIT ?`,
      [ventureId, workflowId, 5],
    )
    : all(
      db,
      `SELECT * FROM tasks
       WHERE venture_id = ? AND status NOT IN ('completed', 'cancelled')
       ORDER BY priority ASC, updated_at DESC LIMIT ?`,
      [ventureId, 5],
    )).map((row) => record("tasks", row, {
    summary: row.error || row.setup_block_reason || "",
    facts: {
      worker: row.agent,
      kind: row.kind,
      status: row.status,
      outcomeStatus: row.outcome_status,
      dueAt: row.due_at,
    },
  }));
  const findings = all(
    db,
    `SELECT * FROM monitor_findings
     WHERE venture_id = ? AND status = 'open'
     ORDER BY last_seen DESC LIMIT ?`,
    [ventureId, MAX_RECORDS_PER_CLASS - Math.min(tasks.length, 5)],
  ).map((row) => record("monitor_findings", row, {
    summary: row.detail,
    facts: {
      severity: row.severity,
      category: row.category,
      occurrenceCount: row.occurrence_count,
    },
  }));
  return [...tasks, ...findings].slice(0, MAX_RECORDS_PER_CLASS);
}

function learningSection(db, ventureId, options = {}) {
  const commercialProof = options.commercialProof
    || canonicalCommercialProof(db, ventureId);
  return [record(
    "commercial_owner_tests_state",
    { id: `commercial_recommendation_${ventureId}` },
    {
      title: "Canonical commercial recommendation",
      summary: commercialProof.currentRecommendation?.detail
        || "No current commercial recommendation is established for this venture.",
      facts: {
        source: commercialProof.source,
        sourceSchema: commercialProof.sourceSchema,
        integrityStatus: commercialProof.integrityStatus,
        currentTest: commercialProof.currentTest,
        currentRecommendation: commercialProof.currentRecommendation,
        commercialProofReached: commercialProof.commercialProofReached,
        legacyLearningAndDigestsExcluded: true,
      },
    },
  )];
}

function genericRecordForModel(row, options = {}) {
  const base = record("venture_records", row, {
    title: row.title,
    summary: row.summary,
    occurredAt: row.effective_at || row.created_at,
    provenance: {
      sourceKind: row.source_kind,
      sourceReference: row.source_reference,
      expiresAt: row.expires_at,
    },
    sensitivity: row.sensitivity,
  }, options);
  if (row.provider_policy === "full") base.facts = safeContent(row.content, options);
  return base;
}

function classRecords(db, ventureId, className, generic, options = {}) {
  let built = [];
  if (className === "venture") built = ventureSection(db, ventureId, options);
  if (className === "evidence") built = evidenceSection(db, ventureId, options);
  if (className === "finance") built = financeSection(db, ventureId, options);
  if (className === "production") built = productionSection(db, ventureId, options);
  if (className === "customer") built = customerSection(db, ventureId, options);
  if (className === "operations") built = operationsSection(db, ventureId, options);
  if (className === "learning") built = learningSection(db, ventureId, options);

  const matching = generic.filter((row) => row.record_class === className);
  const visible = matching.filter((row) => row.provider_policy !== "local_only");
  const localOnly = matching.length - visible.length;
  const nonCanonicalCommercialContext = (
    className === "customer"
    || className === "learning"
  );
  if (!nonCanonicalCommercialContext) {
    built.push(...visible.map((row) => genericRecordForModel(row, options)));
  }
  return {
    records: built.slice(0, MAX_RECORDS_PER_CLASS),
    withheldLocalOnly: localOnly,
    withheldNonCanonical: nonCanonicalCommercialContext ? visible.length : 0,
    truncated: built.length > MAX_RECORDS_PER_CLASS,
  };
}

function buildAgentContextSnapshot(db, input = {}) {
  const ventureId = String(input.ventureId || "").trim();
  const taskId = String(input.taskId || "").trim();
  const agentId = String(input.agentId || "").trim();
  if (!ventureId || !taskId || !agentId) {
    throw new Error("Agent context needs an exact venture, task, and worker.");
  }
  if (!get(db, "SELECT id FROM ventures WHERE id = ?", [ventureId])) {
    throw new Error(`Agent context venture not found: ${ventureId}`);
  }
  const profile = contextProfile(agentId, input.recordClasses);
  const includePersonalData = input.includePersonalData === true;
  const generic = ventureRecords(db, ventureId);
  const commercialProof = canonicalCommercialProof(db, ventureId);
  const contextScope = {
    workflowId: String(input.workflowId || "").trim() || null,
    journeyId: String(input.journeyId || "").trim() || null,
    roundId: String(input.roundId || "").trim() || null,
    opportunityId: String(input.opportunityId || "").trim() || null,
    planId: String(input.planId || "").trim() || null,
  };
  const sections = {};
  for (const className of profile.selected) {
    sections[className] = classRecords(db, ventureId, className, generic, {
      includePersonalData,
      commercialProof,
      ...contextScope,
    });
  }
  const recordRefs = Object.values(sections)
    .flatMap((section) => section.records)
    .map((item) => item.ref);
  const commercialKnowledge = commercialContextForTask(db, {
    workerId: agentId,
    purpose: input.purpose,
    subject: input.subject,
    buyer: input.buyer,
    problem: input.problem,
    offer: input.offer,
    channel: input.channel,
    jurisdiction: input.jurisdiction,
  });
  const core = {
    schema: AGENT_CONTEXT_SCHEMA,
    policyVersion: AGENT_CONTEXT_POLICY_VERSION,
    ventureId,
    workflowId: input.workflowId || null,
    taskId,
    agentId,
    accessProfile: profile.name,
    purpose: text(input.purpose || "Complete the exact assigned business task.", 600),
    recordClasses: profile.selected,
    contextScope,
    includePersonalData,
    dataPolicy: {
      taskScoped: true,
      exactVentureOnly: true,
      workflowScopedOperationalRecords: Boolean(contextScope.workflowId),
      selectedOpportunityEvidenceOnly: Boolean(contextScope.opportunityId),
      credentialsExcluded: true,
      directCustomerIdentifiersExcluded: !includePersonalData,
      localOnlyRecordsExcluded: true,
      providerStorageDefault: false,
      commercialDoctrineIsNotMarketEvidence: true,
      commercialClaimsUseCanonicalOwnerProjection: true,
      legacyCommercialRowsExcludedFromCurrentRecommendations: true,
      nonCanonicalCustomerAndLearningRecordsWithheld: true,
    },
    sections,
    commercialKnowledge,
    recordRefs,
    commercialKnowledgeRefs: commercialKnowledge.records.map((item) => item.id),
    recordCount: recordRefs.length + commercialKnowledge.recordCount,
  };
  const snapshotHash = hash(core);
  return {
    id: `context_${taskId}_${snapshotHash.slice(0, 12)}`,
    ...core,
    snapshotHash,
    createdAt: now(),
  };
}

function verifyAgentContextSnapshot(snapshot) {
  if (!snapshot || snapshot.schema !== AGENT_CONTEXT_SCHEMA) {
    return { valid: false, reason: "The worker context snapshot is missing or unsupported." };
  }
  const { id, snapshotHash, createdAt, ...core } = snapshot;
  const currentHash = hash(core);
  if (!snapshotHash || snapshotHash !== currentHash) {
    return { valid: false, reason: "The worker context snapshot changed after it was prepared.", currentHash };
  }
  return { valid: true, currentHash };
}

function persistAgentContextSnapshot(db, snapshot) {
  const check = verifyAgentContextSnapshot(snapshot);
  if (!check.valid) throw new Error(check.reason);
  const task = get(db, "SELECT id, workflow_id, venture_id, agent FROM tasks WHERE id = ?", [snapshot.taskId]);
  if (!task) throw new Error("The worker context cannot be stored before its task exists.");
  if (task.venture_id !== snapshot.ventureId || task.workflow_id !== snapshot.workflowId || task.agent !== snapshot.agentId) {
    throw new Error("The worker context does not match its task ownership.");
  }
  run(
    db,
    `INSERT INTO agent_context_snapshots
     (id, venture_id, workflow_id, task_id, agent_id, policy_version, access_profile,
      record_classes, record_count, snapshot_hash, snapshot, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(snapshot_hash) DO NOTHING`,
    [
      snapshot.id,
      snapshot.ventureId,
      snapshot.workflowId,
      snapshot.taskId,
      snapshot.agentId,
      snapshot.policyVersion,
      snapshot.accessProfile,
      toJson(snapshot.recordClasses),
      snapshot.recordCount,
      snapshot.snapshotHash,
      JSON.stringify(canonicalValue(snapshot)),
      snapshot.createdAt,
    ],
  );
  const stored = get(db, "SELECT * FROM agent_context_snapshots WHERE snapshot_hash = ?", [snapshot.snapshotHash]);
  if (!stored || stored.task_id !== snapshot.taskId || stored.agent_id !== snapshot.agentId) {
    throw new Error("The worker context snapshot could not be reconciled with its task.");
  }
  return {
    ...stored,
    record_classes: fromJson(stored.record_classes, []),
    snapshot: fromJson(stored.snapshot, {}),
  };
}

function addVentureRecord(db, input = {}) {
  const ventureId = String(input.ventureId || "").trim();
  const recordClass = String(input.recordClass || "").trim();
  if (!get(db, "SELECT id FROM ventures WHERE id = ?", [ventureId])) throw new Error(`Venture not found: ${ventureId}`);
  if (!CONTEXT_CLASS_SET.has(recordClass)) throw new Error(`Unsupported venture record class: ${recordClass}`);
  const content = input.content && typeof input.content === "object" ? input.content : {};
  const serialized = JSON.stringify(content);
  if (CREDENTIAL_KEY.test(serialized)) {
    throw new Error("Credentials and authentication secrets must remain in environment or connector storage, not venture records.");
  }
  const id = input.id || `venture_record_${randomId()}`;
  const createdAt = now();
  const contentHash = hash({
    recordClass,
    recordType: input.recordType || "record",
    title: input.title,
    summary: input.summary || "",
    content,
    sourceKind: input.sourceKind || "operator_record",
    sourceReference: input.sourceReference || null,
    effectiveAt: input.effectiveAt || null,
  });
  run(
    db,
    `INSERT INTO venture_records
     (id, venture_id, record_class, record_type, title, summary, content, sensitivity,
      provider_policy, source_kind, source_reference, content_hash, effective_at,
      expires_at, supersedes_record_id, metadata, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      ventureId,
      recordClass,
      String(input.recordType || "record"),
      text(input.title || "Venture record", 240),
      text(input.summary || "", 2000),
      toJson(content),
      String(input.sensitivity || "business_internal"),
      String(input.providerPolicy || "summary_only"),
      String(input.sourceKind || "operator_record"),
      input.sourceReference || null,
      contentHash,
      input.effectiveAt || null,
      input.expiresAt || null,
      input.supersedesRecordId || null,
      toJson(input.metadata || {}),
      createdAt,
    ],
  );
  return get(db, "SELECT * FROM venture_records WHERE id = ?", [id]);
}

function contextForModel(snapshot) {
  const check = verifyAgentContextSnapshot(snapshot);
  if (!check.valid) throw new Error(check.reason);
  return {
    schema: snapshot.schema,
    snapshotId: snapshot.id,
    snapshotHash: snapshot.snapshotHash,
    policyVersion: snapshot.policyVersion,
    accessProfile: snapshot.accessProfile,
    purpose: snapshot.purpose,
    recordClasses: snapshot.recordClasses,
    recordCount: snapshot.recordCount,
    contextScope: snapshot.contextScope,
    dataPolicy: snapshot.dataPolicy,
    sections: snapshot.sections,
    commercialKnowledge: snapshot.commercialKnowledge,
  };
}

module.exports = {
  AGENT_CONTEXT_POLICY_VERSION,
  AGENT_CONTEXT_SCHEMA,
  CONTEXT_CLASSES,
  WORKER_CONTEXT_PROFILES,
  addVentureRecord,
  buildAgentContextSnapshot,
  contextForModel,
  contextProfile,
  persistAgentContextSnapshot,
  verifyAgentContextSnapshot,
};
