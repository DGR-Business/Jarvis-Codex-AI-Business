const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const CONFIG = require("../config");
const { fromJson, now } = require("../db");
const {
  journeyBudgetExposure,
  taskJourneyId,
} = require("./cost-ledger");

const TERMINAL_STATUSES = new Set([
  "completed",
  "cancelled",
  "stopped_after_correction",
  "stopped_unknown_outcome",
]);
const GENESIS_HASH = "pantheon-proof-exposure-genesis-v1";
const LEDGER_VERSION = 2;

function mainDatabasePath(db) {
  const row = db.prepare("PRAGMA database_list").all()
    .find((entry) => entry.name === "main");
  if (!row?.file) throw new Error("Pantheon could not identify the runtime database for proof accounting.");
  return path.resolve(row.file);
}

function proofExposureLedgerPath(db) {
  const configured = CONFIG.envValue("PANTHEON_PROOF_LEDGER_PATH");
  if (configured) return path.resolve(configured);
  const databaseDirectory = path.dirname(mainDatabasePath(db));
  const sharedDirectory = path.basename(databaseDirectory).toLowerCase() === "journey-rehearsal"
    ? path.dirname(databaseDirectory)
    : databaseDirectory;
  return path.join(sharedDirectory, "proof-exposure.sqlite");
}

function proofLedgerKey() {
  const secret = CONFIG.envValue("PANTHEON_PRIVACY_HASH_KEY");
  if (secret) return String(secret);
  if (process.env.NODE_ENV === "production") {
    throw new Error("Pantheon needs its protected privacy key before proof exposure can be verified.");
  }
  return "pantheon-test-only-proof-ledger-key";
}

function proofLedgerKeyId() {
  return `ppk-${crypto.createHash("sha256")
    .update(`pantheon-proof-ledger-key-v2\0${proofLedgerKey()}`)
    .digest("hex")
    .slice(0, 24)}`;
}

function hashEntry(entry) {
  const payload = JSON.stringify({
    id: entry.id,
    sourceKey: entry.sourceKey,
    sourceType: entry.sourceType,
    amountCents: entry.amountCents,
    currency: entry.currency,
    runtimeDatabaseHash: entry.runtimeDatabaseHash,
    journeyId: entry.journeyId,
    modelCallId: entry.modelCallId,
    observedAt: entry.observedAt,
    previousHash: entry.previousHash,
    metadata: entry.metadata,
  });
  return crypto.createHmac("sha256", proofLedgerKey()).update(payload).digest("hex");
}

function openProofLedger(db, options = {}) {
  const ledgerPath = options.ledgerPath
    ? path.resolve(options.ledgerPath)
    : proofExposureLedgerPath(db);
  fs.mkdirSync(path.dirname(ledgerPath), { recursive: true });
  const ledger = new DatabaseSync(ledgerPath);
  try {
    ledger.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = FULL;
      CREATE TABLE IF NOT EXISTS proof_exposure_entries (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        id TEXT NOT NULL UNIQUE,
        source_key TEXT NOT NULL,
        source_type TEXT NOT NULL,
        amount_cents INTEGER NOT NULL CHECK(amount_cents >= 0),
        currency TEXT NOT NULL,
        runtime_database_hash TEXT NOT NULL,
        journey_id TEXT,
        model_call_id TEXT,
        observed_at TEXT NOT NULL,
        previous_hash TEXT NOT NULL,
        entry_hash TEXT NOT NULL UNIQUE,
        metadata TEXT NOT NULL DEFAULT '{}',
        UNIQUE(source_key, amount_cents)
      );
      CREATE TABLE IF NOT EXISTS proof_exposure_ledger_metadata (
        singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
        version INTEGER NOT NULL,
        key_id TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS proof_exposure_recoveries (
        id TEXT PRIMARY KEY,
        reason TEXT NOT NULL,
        prior_ledger_sha256 TEXT NOT NULL,
        prior_entry_count INTEGER NOT NULL,
        prior_total_cents INTEGER NOT NULL,
        rebuilt_entry_count INTEGER NOT NULL,
        rebuilt_total_cents INTEGER NOT NULL,
        active_journey_cents INTEGER NOT NULL,
        combined_total_cents INTEGER NOT NULL,
        quarantine_path TEXT NOT NULL,
        recovered_at TEXT NOT NULL,
        metadata TEXT NOT NULL DEFAULT '{}'
      );
      CREATE TRIGGER IF NOT EXISTS proof_exposure_entries_immutable_update
      BEFORE UPDATE ON proof_exposure_entries
      BEGIN
        SELECT RAISE(ABORT, 'Proof exposure entries are immutable');
      END;
      CREATE TRIGGER IF NOT EXISTS proof_exposure_entries_immutable_delete
      BEFORE DELETE ON proof_exposure_entries
      BEGIN
        SELECT RAISE(ABORT, 'Proof exposure entries are immutable');
      END;
      CREATE TRIGGER IF NOT EXISTS proof_exposure_metadata_immutable_update
      BEFORE UPDATE ON proof_exposure_ledger_metadata
      BEGIN
        SELECT RAISE(ABORT, 'Proof exposure metadata is immutable');
      END;
      CREATE TRIGGER IF NOT EXISTS proof_exposure_metadata_immutable_delete
      BEFORE DELETE ON proof_exposure_ledger_metadata
      BEGIN
        SELECT RAISE(ABORT, 'Proof exposure metadata is immutable');
      END;
      CREATE TRIGGER IF NOT EXISTS proof_exposure_recoveries_immutable_update
      BEFORE UPDATE ON proof_exposure_recoveries
      BEGIN
        SELECT RAISE(ABORT, 'Proof exposure recovery records are immutable');
      END;
      CREATE TRIGGER IF NOT EXISTS proof_exposure_recoveries_immutable_delete
      BEFORE DELETE ON proof_exposure_recoveries
      BEGIN
        SELECT RAISE(ABORT, 'Proof exposure recovery records are immutable');
      END;
    `);
    const entryCount = Number(ledger.prepare(
      "SELECT COUNT(*) AS count FROM proof_exposure_entries",
    ).get()?.count || 0);
    const keyMetadata = ledger.prepare(
      "SELECT * FROM proof_exposure_ledger_metadata WHERE singleton = 1",
    ).get();
    if (keyMetadata && keyMetadata.key_id !== proofLedgerKeyId()) {
      throw new Error(
        "Pantheon's shared proof exposure ledger was signed by a different protected privacy key.",
      );
    }
    if (!keyMetadata && entryCount === 0) {
      ledger.prepare(
        `INSERT INTO proof_exposure_ledger_metadata
         (singleton, version, key_id, created_at) VALUES (1, ?, ?, ?)`,
      ).run(LEDGER_VERSION, proofLedgerKeyId(), now());
    }
    return {
      ledger,
      ledgerPath,
      keyMetadataMissing: !keyMetadata && entryCount > 0,
    };
  } catch (error) {
    ledger.close();
    throw error;
  }
}

function runtimeDatabaseHash(db) {
  return crypto.createHash("sha256")
    .update(mainDatabasePath(db).toLowerCase())
    .digest("hex");
}

function verifyRows(rows) {
  let previousHash = GENESIS_HASH;
  for (const row of rows) {
    const entry = {
      id: row.id,
      sourceKey: row.source_key,
      sourceType: row.source_type,
      amountCents: Number(row.amount_cents),
      currency: row.currency,
      runtimeDatabaseHash: row.runtime_database_hash,
      journeyId: row.journey_id || null,
      modelCallId: row.model_call_id || null,
      observedAt: row.observed_at,
      previousHash: row.previous_hash,
      metadata: row.metadata,
    };
    if (entry.previousHash !== previousHash || hashEntry(entry) !== row.entry_hash) {
      throw new Error("Pantheon's shared proof exposure ledger failed its integrity check.");
    }
    previousHash = row.entry_hash;
  }
  return previousHash;
}

function adoptVerifiedLegacyKeyMetadata(ledger, keyMetadataMissing) {
  if (!keyMetadataMissing) return;
  ledger.prepare(
    `INSERT INTO proof_exposure_ledger_metadata
     (singleton, version, key_id, created_at) VALUES (1, ?, ?, ?)`,
  ).run(LEDGER_VERSION, proofLedgerKeyId(), now());
}

function readProofExposure(db) {
  const { ledger, ledgerPath, keyMetadataMissing } = openProofLedger(db);
  try {
    const rows = ledger.prepare(
      "SELECT * FROM proof_exposure_entries ORDER BY sequence",
    ).all();
    verifyRows(rows);
    adoptVerifiedLegacyKeyMetadata(ledger, keyMetadataMissing);
    const sources = new Map();
    for (const row of rows) {
      const amountCents = Math.max(0, Number(row.amount_cents || 0));
      const previous = sources.get(row.source_key);
      if (!previous || amountCents > previous.amountCents) {
        sources.set(row.source_key, {
          sourceKey: row.source_key,
          sourceType: row.source_type,
          amountCents,
          journeyId: row.journey_id || null,
          modelCallId: row.model_call_id || null,
          observedAt: row.observed_at,
        });
      }
    }
    return {
      ledgerPath,
      currency: CONFIG.currency,
      totalCents: [...sources.values()].reduce((sum, source) => sum + source.amountCents, 0),
      sources: [...sources.values()],
      entryCount: rows.length,
      integrity: "verified",
    };
  } finally {
    ledger.close();
  }
}

function insertProofEntry(ledger, db, input, previousHash) {
  const amountCents = Math.max(0, Math.round(Number(input.amountCents || 0)));
  const existing = ledger.prepare(
    "SELECT id FROM proof_exposure_entries WHERE source_key = ? AND amount_cents = ?",
  ).get(String(input.sourceKey), amountCents);
  if (existing) return previousHash;
  const entry = {
    id: input.id || `proof_exposure_${crypto.randomUUID()}`,
    sourceKey: String(input.sourceKey),
    sourceType: String(input.sourceType || "proof_exposure"),
    amountCents,
    currency: CONFIG.currency,
    runtimeDatabaseHash: input.runtimeDatabaseHash || runtimeDatabaseHash(db),
    journeyId: input.journeyId ? String(input.journeyId) : null,
    modelCallId: input.modelCallId ? String(input.modelCallId) : null,
    observedAt: input.observedAt || now(),
    previousHash,
    metadata: typeof input.metadata === "string"
      ? input.metadata
      : JSON.stringify(input.metadata || {}),
  };
  const entryHash = hashEntry(entry);
  ledger.prepare(
    `INSERT INTO proof_exposure_entries
     (id, source_key, source_type, amount_cents, currency, runtime_database_hash,
      journey_id, model_call_id, observed_at, previous_hash, entry_hash, metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    entry.id,
    entry.sourceKey,
    entry.sourceType,
    entry.amountCents,
    entry.currency,
    entry.runtimeDatabaseHash,
    entry.journeyId,
    entry.modelCallId,
    entry.observedAt,
    entry.previousHash,
    entryHash,
    entry.metadata,
  );
  return entryHash;
}

function appendProofExposure(db, input) {
  const amountCents = Math.max(0, Math.round(Number(input.amountCents || 0)));
  if (!amountCents) return readProofExposure(db);
  const { ledger, keyMetadataMissing } = openProofLedger(db);
  try {
    ledger.exec("BEGIN IMMEDIATE");
    const rows = ledger.prepare(
      "SELECT * FROM proof_exposure_entries ORDER BY sequence",
    ).all();
    const previousHash = verifyRows(rows);
    adoptVerifiedLegacyKeyMetadata(ledger, keyMetadataMissing);
    insertProofEntry(ledger, db, { ...input, amountCents }, previousHash);
    ledger.exec("COMMIT");
  } catch (error) {
    try { ledger.exec("ROLLBACK"); } catch {}
    throw error;
  } finally {
    ledger.close();
  }
  return readProofExposure(db);
}

function ensureProofExposureAtLeast(db, totalCents, metadata = {}) {
  const targetCents = Math.max(0, Math.round(Number(totalCents || 0)));
  const current = readProofExposure(db);
  if (current.totalCents >= targetCents) return current;
  return appendProofExposure(db, {
    sourceKey: `baseline-adjustment:${crypto.randomUUID()}`,
    sourceType: "verified_carried_baseline",
    amountCents: targetCents - current.totalCents,
    metadata: {
      ...metadata,
      targetCents,
      previousVerifiedCents: current.totalCents,
    },
  });
}

function unboundCallAmount(row) {
  const reconciled = Math.max(0, Number(row.reconciled_cost_cents || 0));
  const incurred = Math.max(0, Number(row.incurred_estimate_cents || 0));
  if (reconciled > 0) return reconciled;
  if (incurred > 0) return incurred;
  if (row.outcome_status === "unknown" || row.status === "dispatching") {
    return Math.max(0, Number(row.reserved_cost_cents || 0));
  }
  return 0;
}

function fileSha256(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function assertPathInside(basePath, targetPath) {
  const relative = path.relative(path.resolve(basePath), path.resolve(targetPath));
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Pantheon refused an unsafe proof-ledger quarantine path.");
  }
}

function latestRawSources(rows) {
  const sources = new Map();
  for (const row of rows) {
    const amountCents = Math.max(0, Number(row.amount_cents || 0));
    const previous = sources.get(row.source_key);
    if (!previous || amountCents > previous.amountCents) {
      sources.set(row.source_key, {
        sourceKey: row.source_key,
        sourceType: row.source_type,
        amountCents,
        currency: row.currency,
        runtimeDatabaseHash: row.runtime_database_hash,
        journeyId: row.journey_id || null,
        modelCallId: row.model_call_id || null,
        observedAt: row.observed_at,
        metadata: row.metadata,
        firstSequence: Number(previous?.firstSequence || row.sequence),
      });
    }
  }
  return [...sources.values()].sort((left, right) => left.firstSequence - right.firstSequence);
}

function authoritativeRecoverySource(db, source, recoveryId) {
  if (source.currency !== CONFIG.currency) {
    throw new Error(`Proof source ${source.sourceKey} is not recorded in ${CONFIG.currency}.`);
  }
  let authoritativeAmountCents = 0;
  if (source.sourceKey.startsWith("journey:")) {
    const journeyId = source.sourceKey.slice("journey:".length);
    const journey = db.prepare("SELECT * FROM pantheon_journeys WHERE id = ?").get(journeyId);
    if (!journey || source.journeyId !== journeyId) {
      throw new Error(`Proof source ${source.sourceKey} has no matching runtime journey.`);
    }
    authoritativeAmountCents = journeyBudgetExposure(db, journeyId, 0).localCents;
  } else if (source.sourceKey.startsWith("model-call:")) {
    const modelCallId = source.sourceKey.slice("model-call:".length);
    const call = db.prepare(
      `SELECT model_calls.*, tasks.payload
       FROM model_calls
       LEFT JOIN tasks ON tasks.id = model_calls.task_id
       WHERE model_calls.id = ?`,
    ).get(modelCallId);
    if (
      !call
      || source.modelCallId !== modelCallId
      || taskJourneyId({ payload: fromJson(call.payload, {}) })
    ) {
      throw new Error(`Proof source ${source.sourceKey} has no matching unbound model call.`);
    }
    authoritativeAmountCents = unboundCallAmount(call);
  } else {
    throw new Error(`Proof source ${source.sourceKey} cannot be rebuilt from runtime truth.`);
  }
  if (authoritativeAmountCents !== source.amountCents) {
    throw new Error(
      `Proof source ${source.sourceKey} differs from runtime truth `
      + `(${source.amountCents} vs ${authoritativeAmountCents} cents).`,
    );
  }
  return {
    sourceKey: source.sourceKey,
    sourceType: source.sourceType,
    amountCents: authoritativeAmountCents,
    journeyId: source.journeyId,
    modelCallId: source.modelCallId,
    observedAt: source.observedAt,
    metadata: {
      ...fromJson(source.metadata, {}),
      ledgerRecovery: {
        recoveryId,
        basis: "source amount independently matched retained runtime truth",
        priorRuntimeDatabaseHash: source.runtimeDatabaseHash,
      },
    },
  };
}

function recoverProofExposureLedger(db, options = {}) {
  if (options.allowIntegrityRecovery !== true) {
    throw new Error("Proof-ledger recovery requires an explicit integrity-recovery instruction.");
  }
  const reason = String(options.reason || "").trim();
  if (!reason) throw new Error("Proof-ledger recovery requires a recorded reason.");
  const expectedTotalCents = Math.max(0, Math.round(Number(options.expectedTotalCents)));
  if (!Number.isFinite(expectedTotalCents) || expectedTotalCents <= 0) {
    throw new Error("Proof-ledger recovery requires a positive independently verified total.");
  }

  const ledgerPath = proofExposureLedgerPath(db);
  if (!fs.existsSync(ledgerPath)) {
    throw new Error("Pantheon cannot recover a proof ledger that does not exist.");
  }
  const legacy = new DatabaseSync(ledgerPath);
  let rows;
  try {
    legacy.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    rows = legacy.prepare(
      "SELECT * FROM proof_exposure_entries ORDER BY sequence",
    ).all();
  } finally {
    legacy.close();
  }
  if (!rows.length) throw new Error("Pantheon found no proof entries to recover.");

  const recoveryId = `proof_recovery_${crypto.randomUUID()}`;
  const recoveredAt = now();
  const rawSources = latestRawSources(rows);
  const recoveredSources = rawSources.map(
    (source) => authoritativeRecoverySource(db, source, recoveryId),
  );
  const rawTotalCents = rawSources.reduce((sum, source) => sum + source.amountCents, 0);
  const rebuiltTotalCents = recoveredSources.reduce(
    (sum, source) => sum + source.amountCents,
    0,
  );
  const activeJourneys = db.prepare(
    `SELECT id FROM pantheon_journeys
     WHERE status NOT IN ('completed', 'cancelled', 'stopped_after_correction', 'stopped_unknown_outcome')
     ORDER BY created_at, id`,
  ).all();
  const activeJourneyIds = new Set(activeJourneys.map((journey) => journey.id));
  const activeJourneyCents = activeJourneys.reduce(
    (sum, journey) => sum + journeyBudgetExposure(db, journey.id, 0).localCents,
    0,
  );
  const reopenedSharedCents = recoveredSources
    .filter((source) => source.journeyId && activeJourneyIds.has(source.journeyId))
    .reduce((sum, source) => sum + source.amountCents, 0);
  const combinedTotalCents = rebuiltTotalCents - reopenedSharedCents + activeJourneyCents;
  if (
    rawTotalCents !== rebuiltTotalCents
    || combinedTotalCents !== expectedTotalCents
  ) {
    throw new Error(
      "Pantheon refused proof-ledger recovery because the independently verified totals differ "
      + `(${rawTotalCents} raw, ${rebuiltTotalCents} rebuilt, `
      + `${combinedTotalCents} combined, ${expectedTotalCents} expected cents).`,
    );
  }

  const ledgerDirectory = path.dirname(ledgerPath);
  const safeTimestamp = recoveredAt.replace(/[:.]/g, "-");
  const quarantinePath = path.join(
    ledgerDirectory,
    "quarantine",
    `proof-exposure-${safeTimestamp}-${recoveryId.slice(-8)}`,
  );
  assertPathInside(ledgerDirectory, quarantinePath);
  const temporaryPath = `${ledgerPath}.${recoveryId}.replacement`;
  const priorLedgerSha256 = fileSha256(ledgerPath);

  const replacement = openProofLedger(db, { ledgerPath: temporaryPath });
  try {
    replacement.ledger.exec("BEGIN IMMEDIATE");
    let previousHash = GENESIS_HASH;
    for (const source of recoveredSources) {
      previousHash = insertProofEntry(
        replacement.ledger,
        db,
        source,
        previousHash,
      );
    }
    replacement.ledger.prepare(
      `INSERT INTO proof_exposure_recoveries
       (id, reason, prior_ledger_sha256, prior_entry_count, prior_total_cents,
        rebuilt_entry_count, rebuilt_total_cents, active_journey_cents,
        combined_total_cents, quarantine_path, recovered_at, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      recoveryId,
      reason,
      priorLedgerSha256,
      rows.length,
      rawTotalCents,
      recoveredSources.length,
      rebuiltTotalCents,
      activeJourneyCents,
      combinedTotalCents,
      quarantinePath,
      recoveredAt,
      JSON.stringify({
        keyId: proofLedgerKeyId(),
        recoveryMethod: "runtime-source-reconciliation",
        reopenedSharedCents,
        activeJourneyIds: [...activeJourneyIds],
        operatorNote: String(options.operatorNote || ""),
      }),
    );
    replacement.ledger.exec("COMMIT");
    replacement.ledger.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    const replacementRows = replacement.ledger.prepare(
      "SELECT * FROM proof_exposure_entries ORDER BY sequence",
    ).all();
    verifyRows(replacementRows);
  } catch (error) {
    try { replacement.ledger.exec("ROLLBACK"); } catch {}
    throw error;
  } finally {
    replacement.ledger.close();
  }

  fs.mkdirSync(quarantinePath, { recursive: true });
  const movedPaths = [];
  try {
    for (const suffix of ["", "-wal", "-shm"]) {
      const sourcePath = `${ledgerPath}${suffix}`;
      if (!fs.existsSync(sourcePath)) continue;
      const destinationPath = path.join(
        quarantinePath,
        `${path.basename(ledgerPath)}${suffix}`,
      );
      fs.renameSync(sourcePath, destinationPath);
      movedPaths.push({ sourcePath, destinationPath });
    }
    fs.renameSync(temporaryPath, ledgerPath);
  } catch (error) {
    if (!fs.existsSync(ledgerPath)) {
      for (const moved of movedPaths.reverse()) {
        if (fs.existsSync(moved.destinationPath)) {
          fs.renameSync(moved.destinationPath, moved.sourcePath);
        }
      }
    }
    throw error;
  } finally {
    for (const suffix of ["-wal", "-shm"]) {
      const replacementSidecar = `${temporaryPath}${suffix}`;
      if (fs.existsSync(replacementSidecar)) fs.rmSync(replacementSidecar, { force: true });
    }
  }

  const verified = readProofExposure(db);
  return {
    ...verified,
    recoveryId,
    priorEntryCount: rows.length,
    rebuiltEntryCount: recoveredSources.length,
    priorTotalCents: rawTotalCents,
    activeJourneyCents,
    combinedTotalCents,
    quarantinePath,
    priorLedgerSha256,
  };
}

function syncProofExposureFromDatabase(db) {
  const journeys = db.prepare(
    "SELECT * FROM pantheon_journeys ORDER BY created_at, id",
  ).all();
  const earliestCarried = journeys.length
    ? Math.max(0, Number(journeys[0].carried_exposure_cents || 0))
    : 0;
  if (earliestCarried > 0) {
    ensureProofExposureAtLeast(db, earliestCarried, {
      reason: "Earliest retained journey carried baseline",
      journeyId: journeys[0].id,
    });
  }

  for (const journey of journeys) {
    if (!TERMINAL_STATUSES.has(String(journey.status || ""))) continue;
    const exposure = journeyBudgetExposure(db, journey.id, 0);
    if (exposure.localCents > 0) {
      appendProofExposure(db, {
        sourceKey: `journey:${journey.id}`,
        sourceType: "terminal_journey",
        amountCents: exposure.localCents,
        journeyId: journey.id,
        observedAt: journey.completed_at || journey.updated_at || now(),
        metadata: {
          mode: journey.mode,
          status: journey.status,
          localExposureCents: exposure.localCents,
        },
      });
    }
  }

  const proofStartedAt = journeys.length ? journeys[0].created_at : null;
  if (proofStartedAt) {
    const calls = db.prepare(
      `SELECT model_calls.*, tasks.payload
       FROM model_calls
       LEFT JOIN tasks ON tasks.id = model_calls.task_id
       WHERE model_calls.created_at >= ?
       ORDER BY model_calls.created_at, model_calls.id`,
    ).all(proofStartedAt);
    for (const call of calls) {
      const payload = fromJson(call.payload, {});
      if (taskJourneyId({ payload })) continue;
      const amountCents = unboundCallAmount(call);
      if (!amountCents) continue;
      appendProofExposure(db, {
        sourceKey: `model-call:${call.id}`,
        sourceType: "unbound_proof_model_call",
        amountCents,
        modelCallId: call.id,
        observedAt: call.created_at,
        metadata: {
          provider: call.provider,
          model: call.selected_model,
          status: call.status,
          outcomeStatus: call.outcome_status,
        },
      });
    }
  }
  return readProofExposure(db);
}

function combinedProofExposureFromDatabase(db) {
  const shared = syncProofExposureFromDatabase(db);
  const activeJourneys = db.prepare(
    `SELECT id FROM pantheon_journeys
     WHERE status NOT IN ('completed', 'cancelled', 'stopped_after_correction', 'stopped_unknown_outcome')
     ORDER BY created_at, id`,
  ).all();
  const activeJourneyLocalCents = activeJourneys.reduce(
    (sum, journey) => sum + journeyBudgetExposure(db, journey.id, 0).localCents,
    0,
  );
  const activeJourneyIds = new Set(activeJourneys.map((journey) => journey.id));
  const reopenedJourneySharedCents = shared.sources
    .filter((source) => source.journeyId && activeJourneyIds.has(source.journeyId))
    .reduce((sum, source) => sum + Number(source.amountCents || 0), 0);
  const sharedCents = Math.max(0, shared.totalCents - reopenedJourneySharedCents);
  return {
    ...shared,
    immutableLedgerCents: shared.totalCents,
    reopenedJourneySharedCents,
    sharedCents,
    activeJourneyLocalCents,
    totalCents: sharedCents + activeJourneyLocalCents,
    activeJourneyIds: [...activeJourneyIds],
  };
}

module.exports = {
  appendProofExposure,
  combinedProofExposureFromDatabase,
  ensureProofExposureAtLeast,
  proofExposureLedgerPath,
  readProofExposure,
  recoverProofExposureLedger,
  syncProofExposureFromDatabase,
};
