const crypto = require("node:crypto");
const { all, fromJson, get, now, randomId, run, toJson } = require("../db");
const { commercialContextForTask } = require("./commercial-knowledge");

const AGENT_CONTEXT_SCHEMA = "jarvis.agent-context-snapshot.v1";
const AGENT_CONTEXT_POLICY_VERSION = "task-scoped-context-v2";
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

function ventureSection(db, ventureId) {
  const venture = get(db, "SELECT * FROM ventures WHERE id = ?", [ventureId]);
  const ventureCase = get(db, "SELECT * FROM venture_cases WHERE venture_id = ?", [ventureId]);
  const records = [];
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
      title: "Current venture case",
      summary: ventureCase.latest_learning,
      facts: {
        buyer: ventureCase.buyer,
        problem: ventureCase.problem,
        offer: ventureCase.offer,
        priceAud: Number(ventureCase.price_cents || 0) / 100,
        channel: ventureCase.channel,
        evidenceStandard: ventureCase.evidence_standard,
        expectedMetric: ventureCase.expected_metric,
        killRule: ventureCase.kill_rule,
        nextMoneyMove: ventureCase.next_money_move,
        operatorDecision: ventureCase.operator_decision,
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

function financeSection(db, ventureId) {
  const accounting = get(
    db,
    `SELECT
       COALESCE(SUM(CASE WHEN effect_sign > 0 THEN amount_cents ELSE 0 END), 0) AS inflow_cents,
       COALESCE(SUM(CASE WHEN effect_sign < 0 THEN amount_cents ELSE 0 END), 0) AS outflow_cents,
       COUNT(*) AS entry_count
     FROM accounting_entries
     WHERE venture_id = ? AND currency = 'AUD' AND status = 'reconciled'`,
    [ventureId],
  );
  const sales = get(
    db,
    `SELECT
       COALESCE(SUM(aud_gross_cents), 0) AS gross_cents,
       COALESCE(SUM(aud_platform_fee_cents), 0) AS fee_cents,
       COALESCE(SUM(aud_refunded_cents), 0) AS refunded_cents,
       COALESCE(SUM(aud_net_cents), 0) AS net_cents,
       COUNT(*) AS sale_count
     FROM platform_sales
     WHERE venture_id = ?`,
    [ventureId],
  );
  const costs = get(
    db,
    `SELECT
       COALESCE(SUM(CASE WHEN status = 'reconciled' THEN amount_cents ELSE 0 END), 0) AS reconciled_cents,
       COALESCE(SUM(CASE WHEN status <> 'reconciled' THEN amount_cents ELSE 0 END), 0) AS pending_cents,
       COUNT(*) AS cost_count
     FROM costs
     WHERE venture_id = ? AND currency = 'AUD'`,
    [ventureId],
  );
  const records = [record("finance_summary", { id: `finance_${ventureId}` }, {
    title: "Venture financial position",
    summary: "AUD-only totals from the local accounting, cost, and sales ledgers. Estimates and unreconciled amounts remain separate.",
    facts: {
      reconciledInflowsAud: Number(accounting?.inflow_cents || 0) / 100,
      reconciledOutflowsAud: Number(accounting?.outflow_cents || 0) / 100,
      accountingEntries: Number(accounting?.entry_count || 0),
      grossSalesAud: Number(sales?.gross_cents || 0) / 100,
      platformFeesAud: Number(sales?.fee_cents || 0) / 100,
      refundsAud: Number(sales?.refunded_cents || 0) / 100,
      netSalesAud: Number(sales?.net_cents || 0) / 100,
      salesCount: Number(sales?.sale_count || 0),
      reconciledProviderAndToolCostsAud: Number(costs?.reconciled_cents || 0) / 100,
      pendingOrEstimatedCostsAud: Number(costs?.pending_cents || 0) / 100,
    },
  })];
  const recent = all(
    db,
    `SELECT * FROM accounting_entries
     WHERE venture_id = ? AND currency = 'AUD'
     ORDER BY occurred_at DESC, created_at DESC LIMIT ?`,
    [ventureId, MAX_RECORDS_PER_CLASS - 1],
  ).map((row) => record("accounting_entries", row, {
    title: row.category,
    summary: row.description,
    facts: {
      entryType: row.entry_type,
      status: row.status,
      amountAud: Number(row.amount_cents || 0) / 100,
      effect: Number(row.effect_sign || 0) > 0 ? "inflow" : "outflow",
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

function customerSection(db, ventureId) {
  return all(
    db,
    `SELECT * FROM commercial_feedback
     WHERE venture_id = ?
     ORDER BY occurred_at DESC, created_at DESC LIMIT ?`,
    [ventureId, MAX_RECORDS_PER_CLASS],
  ).map((row) => record("commercial_feedback", row, {
    title: "Buyer feedback",
    summary: row.summary,
    facts: {
      sentiment: row.sentiment,
      rating: row.rating,
      objection: row.objection,
      request: row.request,
      verified: Boolean(row.verified),
      source: row.source,
    },
    sensitivity: "personal",
  }));
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

function learningSection(db, ventureId) {
  const cycles = all(
    db,
    `SELECT cycles.*
     FROM commercial_learning_cycles AS cycles
     LEFT JOIN workflows ON workflows.id = cycles.workflow_id
     WHERE workflows.venture_id = ?
     ORDER BY cycles.created_at DESC LIMIT ?`,
    [ventureId, 5],
  ).map((row) => record("commercial_learning_cycles", row, {
    title: row.verdict || "Commercial learning",
    summary: row.learning,
    facts: {
      status: row.status,
      hypothesis: row.hypothesis,
      expectedMetric: row.expected_metric,
      actualResult: row.actual_result,
      improvement: row.improvement,
      nextAction: row.next_action,
      confidence: row.confidence,
    },
  }));
  const digests = all(
    db,
    `SELECT * FROM executive_digests
     WHERE venture_id = ?
     ORDER BY period_end DESC LIMIT ?`,
    [ventureId, MAX_RECORDS_PER_CLASS - Math.min(cycles.length, 5)],
  ).map((row) => record("executive_digests", row, {
    title: "Executive digest",
    summary: row.summary,
    facts: {
      status: row.status,
      decisions: fromJson(row.decisions, []),
      learning: fromJson(row.learning, []),
      nextActions: fromJson(row.next_actions, []),
    },
  }));
  return [...cycles, ...digests].slice(0, MAX_RECORDS_PER_CLASS);
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
  if (className === "venture") built = ventureSection(db, ventureId);
  if (className === "evidence") built = evidenceSection(db, ventureId, options);
  if (className === "finance") built = financeSection(db, ventureId);
  if (className === "production") built = productionSection(db, ventureId, options);
  if (className === "customer") built = customerSection(db, ventureId);
  if (className === "operations") built = operationsSection(db, ventureId, options);
  if (className === "learning") built = learningSection(db, ventureId);

  const matching = generic.filter((row) => row.record_class === className);
  const visible = matching.filter((row) => row.provider_policy !== "local_only");
  const localOnly = matching.length - visible.length;
  built.push(...visible.map((row) => genericRecordForModel(row, options)));
  return {
    records: built.slice(0, MAX_RECORDS_PER_CLASS),
    withheldLocalOnly: localOnly,
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
