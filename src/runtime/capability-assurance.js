const { all, fromJson, get, now, randomId, run, toJson } = require("../db");

function upsertAssurance(db, input) {
  const timestamp = now();
  const id = input.id || `assurance_${randomId()}`;
  run(
    db,
    `INSERT INTO capability_assurance_records
     (id, capability_key, proof_kind, source_framework, source_record_id, status,
      input_hash, output_hash, provider, model, trace_id, cost_cents, verdict,
      criteria, metadata, occurred_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(source_framework, source_record_id) DO UPDATE SET
       capability_key = excluded.capability_key,
       proof_kind = excluded.proof_kind,
       status = excluded.status,
       input_hash = excluded.input_hash,
       output_hash = excluded.output_hash,
       provider = excluded.provider,
       model = excluded.model,
       trace_id = excluded.trace_id,
       cost_cents = excluded.cost_cents,
       verdict = excluded.verdict,
       criteria = excluded.criteria,
       metadata = excluded.metadata,
       occurred_at = excluded.occurred_at,
       updated_at = excluded.updated_at`,
    [
      id,
      input.capabilityKey,
      input.proofKind,
      input.sourceFramework,
      input.sourceRecordId,
      input.status,
      input.inputHash || null,
      input.outputHash || null,
      input.provider || null,
      input.model || null,
      input.traceId || null,
      input.costCents === null || input.costCents === undefined ? null : Number(input.costCents),
      input.verdict || "",
      toJson(input.criteria || {}),
      toJson(input.metadata || {}),
      input.occurredAt || null,
      timestamp,
      timestamp,
    ],
  );
  return get(
    db,
    "SELECT * FROM capability_assurance_records WHERE source_framework = ? AND source_record_id = ?",
    [input.sourceFramework, input.sourceRecordId],
  );
}

function ensureCapabilityAssurance(db) {
  const pilotReviews = all(
    db,
    `SELECT reviews.*, calls.selected_model AS model,
            COALESCE(NULLIF(reviews.reconciled_cost_cents, 0),
                     NULLIF(reviews.incurred_estimate_cents, 0),
                     reviews.estimated_cost_cents, 0) AS cost_cents
     FROM agent_pilot_reviews AS reviews
     JOIN agent_runs AS runs ON runs.id = reviews.run_id
     LEFT JOIN model_calls AS calls ON calls.id = runs.model_call_id`,
  );
  for (const row of pilotReviews) {
    const operatorPassed = row.operator_verdict === "useful";
    const deterministicPassed = row.deterministic_status === "passed";
    upsertAssurance(db, {
      capabilityKey: row.capability_key,
      proofKind: "live",
      sourceFramework: "agent_pilot_review",
      sourceRecordId: row.id,
      status: deterministicPassed && operatorPassed ? "passed" : row.operator_verdict === "pending" ? "review_needed" : "failed",
      provider: row.provider,
      model: row.model,
      traceId: row.trace_id,
      costCents: row.cost_cents,
      verdict: row.operator_verdict,
      criteria: fromJson(row.criteria, {}),
      metadata: { historicalCompatibility: true, runId: row.run_id, fixtureId: row.fixture_id },
      occurredAt: row.reviewed_at || row.created_at,
    });
  }

  const readinessPacks = all(db, "SELECT * FROM agent_model_readiness_packs");
  for (const row of readinessPacks) {
    upsertAssurance(db, {
      capabilityKey: `${row.agent_id}.model_readiness`,
      proofKind: "operational",
      sourceFramework: "agent_model_readiness_pack",
      sourceRecordId: row.id,
      status: row.status,
      provider: row.provider,
      model: row.model,
      verdict: `${row.readiness_score}/100`,
      criteria: { readinessScore: row.readiness_score, checks: fromJson(row.readiness_checks, []) },
      metadata: { historicalCompatibility: true, agentId: row.agent_id },
      occurredAt: row.updated_at,
    });
  }

  const comparisonPackets = all(db, "SELECT * FROM agent_model_comparison_packets");
  for (const row of comparisonPackets) {
    upsertAssurance(db, {
      capabilityKey: `${row.agent_id}.model_comparison`,
      proofKind: "comparison",
      sourceFramework: "agent_model_comparison_packet",
      sourceRecordId: row.id,
      status: row.status,
      provider: row.provider,
      model: row.model,
      costCents: row.estimated_cost_cents,
      verdict: fromJson(row.operator_decision, {}).decision || "",
      criteria: fromJson(row.eval_plan, {}),
      metadata: { historicalCompatibility: true, workflowId: row.workflow_id, taskId: row.task_id },
      occurredAt: row.updated_at,
    });
  }

  const legacyProofWorkflows = all(
    db,
    `SELECT id, type, status, metadata, created_at, updated_at
     FROM workflows
     WHERE type LIKE 'agent_workbench%'
        OR type LIKE 'agent_playbook%'`,
  );
  for (const row of legacyProofWorkflows) {
    const framework = row.type.startsWith("agent_workbench") ? "agent_workbench" : "agent_playbook";
    const metadata = fromJson(row.metadata, {});
    upsertAssurance(db, {
      capabilityKey: metadata.agentId
        ? `${metadata.agentId}.${framework}`
        : `ai_team.${framework}`,
      proofKind: "rehearsal",
      sourceFramework: framework,
      sourceRecordId: row.id,
      status: row.status,
      verdict: metadata.verdict || "",
      criteria: metadata.eval || {},
      metadata: { historicalCompatibility: true, workflowType: row.type },
      occurredAt: row.updated_at || row.created_at,
    });
  }
  return getCapabilityAssuranceState(db);
}

function recordCapabilityAssurance(db, input = {}) {
  if (!input.capabilityKey || !input.proofKind || !input.sourceFramework || !input.sourceRecordId || !input.status) {
    throw new Error("Capability assurance requires capability, proof kind, source framework, source record, and status.");
  }
  return upsertAssurance(db, input);
}

function parseAssurance(row) {
  return {
    id: row.id,
    capabilityKey: row.capability_key,
    proofKind: row.proof_kind,
    sourceFramework: row.source_framework,
    sourceRecordId: row.source_record_id,
    status: row.status,
    provider: row.provider,
    model: row.model,
    traceId: row.trace_id,
    costCents: row.cost_cents,
    verdict: row.verdict,
    criteria: fromJson(row.criteria, {}),
    metadata: fromJson(row.metadata, {}),
    occurredAt: row.occurred_at,
    updatedAt: row.updated_at,
  };
}

function getCapabilityAssuranceState(db, options = {}) {
  const limit = Math.max(1, Math.min(Number(options.limit || 100), 500));
  const rows = all(
    db,
    `SELECT * FROM capability_assurance_records
     ORDER BY COALESCE(occurred_at, updated_at) DESC, updated_at DESC
     LIMIT ?`,
    [limit],
  ).map(parseAssurance);
  const capabilities = new Map();
  for (const row of rows) {
    const current = capabilities.get(row.capabilityKey) || {
      capabilityKey: row.capabilityKey,
      latestStatus: row.status,
      latestProofAt: row.occurredAt || row.updatedAt,
      proofCount: 0,
      passes: 0,
      failures: 0,
      records: [],
    };
    current.proofCount += 1;
    if (row.status === "passed" || row.status === "ready") current.passes += 1;
    if (row.status === "failed" || row.status === "blocked") current.failures += 1;
    current.records.push(row);
    capabilities.set(row.capabilityKey, current);
  }
  return {
    schema: "pantheon.capability-assurance.v1",
    compatibilityFrameworks: [
      "agent_pilot_review",
      "agent_model_readiness_pack",
      "agent_model_comparison_packet",
      "agent_workbench",
      "agent_playbook",
    ],
    capabilities: [...capabilities.values()],
    records: rows,
  };
}

module.exports = {
  ensureCapabilityAssurance,
  getCapabilityAssuranceState,
  recordCapabilityAssurance,
};
