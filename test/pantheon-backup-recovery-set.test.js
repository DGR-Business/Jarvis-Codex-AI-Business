const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { DatabaseSync } = require("node:sqlite");
const { LATEST_SCHEMA_VERSION, openDatabase, seedDatabase } = require("../src/db");
const { sha256 } = require("../src/runtime/commercial-test-contract");
const {
  bindAuthenticatedOwnerBillingObservationIssuer,
} = require("../src/runtime/local-security");
const {
  getPreventureResearchOwnerState,
} = require("../src/runtime/preventure-research-owner-state");
const {
  createPreventureResearchOutputStore,
} = require("../src/runtime/preventure-research-output-store");
const {
  createPreventureResearchStore,
} = require("../src/runtime/preventure-research-store");
const {
  ARCHIVE_SCHEMA_COMPATIBILITY_LABELS,
  CURRENT_ARCHIVE_SCHEMA_VERSION,
  LAST_RELEASED_SCHEMA_VERSION,
  LEGACY_SUPPORTED_SCHEMA_VERSIONS,
  assertRestoreDestinationIsInactive,
  backupKeyId,
  createBackup,
  createSourceArchive,
  encryptFile,
  pruneBackups,
  readEncryptedHeader,
  requiredPassphrase,
  restoreBackup,
  validateRecoverySetDirectory,
  validateSqliteDatabase,
  verifyBackup,
} = require("../src/runtime/backup");
const {
  LEGACY_SCHEMA_VERSION,
  LEGACY_SCHEMA_25_VERSION,
  downgradeDatabaseToLegacySchema24,
  downgradeDatabaseToLegacySchema25,
} = require("./support/released-schema-24-fixture");
const {
  STORE_TIME,
  authority: preventureAuthority,
  historicalStoreOptions,
  prepareFixture,
  sealPopulatedEarlyStopRound,
} = require("./support/preventure-research-early-stop-fixture");
const {
  addMilliseconds,
  buildRecoveryInput,
  createTerminalRecoveryFixture,
  prepareDispatchedExecution,
  retainProviderArtifact,
  revokeAuthority,
} = require("./support/preventure-research-terminal-recovery-fixture");
const {
  authenticatedOwnerSecurityForTest,
} = require("./support/authenticated-owner-session-attestation");
const {
  issueOwnerBillingAttestation,
  observationInput,
  terminalRecoveryBillingFixture,
} = require("./support/preventure-research-owner-billing-observation-fixture");

const PASSPHRASE = "pantheon-test-passphrase-32-characters";
const projectRoot = path.resolve(__dirname, "..");

function copyBootableSourceContract(destination) {
  fs.mkdirSync(destination, { recursive: true });
  for (const filename of ["package.json", "package-lock.json"]) {
    fs.copyFileSync(path.join(projectRoot, filename), path.join(destination, filename));
  }
  fs.cpSync(path.join(projectRoot, "src"), path.join(destination, "src"), {
    recursive: true,
  });
  fs.cpSync(path.join(projectRoot, "config"), path.join(destination, "config"), {
    recursive: true,
  });
  fs.mkdirSync(path.join(destination, "public"), { recursive: true });
  for (const filename of ["index.html", "app.js", "styles.css"]) {
    fs.copyFileSync(
      path.join(projectRoot, "public", filename),
      path.join(destination, "public", filename),
    );
  }
  for (const filename of ["requirements-runtime.txt", "requirements-renderer-lock.txt"]) {
    fs.copyFileSync(path.join(projectRoot, filename), path.join(destination, filename));
  }
  fs.mkdirSync(path.join(destination, "scripts"), { recursive: true });
  for (const filename of [
    "renderer-environment.js",
    "compose-storefront-cover.py",
    "render-approval-pack.py",
    "render-digital-product-kit.py",
  ]) {
    fs.copyFileSync(
      path.join(projectRoot, "scripts", filename),
      path.join(destination, "scripts", filename),
    );
  }
}

function tempRoot(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `pantheon-backup-${name}-`));
}

function createRecoveryFixture(name) {
  const root = tempRoot(name);
  const sourceRoot = path.join(root, "workspace");
  const dbPath = path.join(sourceRoot, "data", "runtime.sqlite");
  const artifactRoot = path.join(sourceRoot, "data", "artifacts");
  const approvalPackRoot = path.join(sourceRoot, "output", "pdf");
  const privateOperatorRoot = path.join(sourceRoot, "private");
  const destinationRoot = path.join(root, "backups");

  copyBootableSourceContract(sourceRoot);
  fs.mkdirSync(artifactRoot, { recursive: true });
  fs.mkdirSync(approvalPackRoot, { recursive: true });
  fs.mkdirSync(privateOperatorRoot, { recursive: true });
  fs.writeFileSync(path.join(sourceRoot, "src", "pantheon.js"), "module.exports = 'ready';\n");
  fs.writeFileSync(path.join(artifactRoot, "commercial-brief.md"), "verified runtime artifact\n");
  fs.writeFileSync(path.join(approvalPackRoot, "operator-pack.pdf"), "fixture pdf bytes\n");
  fs.writeFileSync(
    path.join(privateOperatorRoot, "operator-reference.txt"),
    "PRIVATE-KYC-REFERENCE-MARKER\n",
  );
  fs.writeFileSync(
    path.join(privateOperatorRoot, "runtime-credentials.json"),
    JSON.stringify({ backupPassphraseProtected: "CIRCULAR-RECOVERY-SECRET-MARKER" }),
  );

  const db = openDatabase(dbPath);
  seedDatabase(db);
  db.prepare("UPDATE ventures SET name = ? WHERE id = ?").run(
    "Recovery proof",
    "venture-digital-products",
  );
  db.close();

  return {
    root,
    sourceRoot,
    dbPath,
    artifactRoot,
    approvalPackRoot,
    privateOperatorRoot,
    destinationRoot,
  };
}

async function createRecoverySet(fixture, options = {}) {
  return createBackup({
    kind: "set",
    sourceRoot: fixture.sourceRoot,
    dbPath: fixture.dbPath,
    artifactRoot: fixture.artifactRoot,
    approvalPackRoot: fixture.approvalPackRoot,
    privateOperatorRoot: fixture.privateOperatorRoot,
    destinationRoot: fixture.destinationRoot,
    passphrase: PASSPHRASE,
    createdAt: options.createdAt || "2026-07-18T02:00:00.000Z",
  });
}

function containsBytesInTree(root, marker) {
  const needle = Buffer.from(marker, "utf8");
  const visit = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const target = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (visit(target)) return true;
      } else if (entry.isFile() && fs.readFileSync(target).includes(needle)) {
        return true;
      }
    }
    return false;
  };
  return visit(root);
}

function retainBackupProofOutput(artifactRoot, assignment) {
  const authorityHash = assignment.authorityHash;
  const assignmentHash = assignment.assignmentHash;
  const descriptorHash = sha256("backup-hard-link-descriptor");
  const requestBodyHash = sha256("backup-hard-link-request");
  const providerResponse = {
    id: "resp_backup_hard_link_1",
    object: "response",
    model: "gpt-5-mini-2025-08-07",
    output: [],
    status: "completed",
    usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
  };
  const rawProviderBody = JSON.stringify(providerResponse);
  const billing = {
    currency: "AUD",
    costAudCents: 1,
    costStatus: "reconciled",
    modelCallId: "model_call_backup_hard_link_1",
  };
  const createStore = (root) => createPreventureResearchOutputStore({
    artifactRoot: root,
    assignmentMaxCostAudCentsForHash(hash) {
      if (hash !== assignmentHash) throw new Error("Unknown backup proof assignment.");
      return assignment.maxCostAudCents;
    },
  });
  const store = createStore(artifactRoot);
  const retained = store.retain({
    artifactKind: "canonical_known_response",
    assignmentMaxCostAudCents: assignment.maxCostAudCents,
    authorityHash,
    assignmentHash,
    descriptorHash,
    requestBodyHash,
    providerRequestId: "req_backup_hard_link_1",
    providerResponseId: providerResponse.id,
    clientRequestId: "pantheon-backup-hard-link-1",
    providerResponse,
    providerResponseHash: sha256(providerResponse),
    rawProviderBody,
    rawProviderBodyHash: sha256(rawProviderBody),
    output: "{}",
    groundedSources: [],
    groundedSourceSetHash: sha256([]),
    billing,
    billingHash: sha256(billing),
    responseMetadata: { httpStatus: 200 },
    retainedAt: "2026-08-02T04:00:00.000Z",
  });
  const artifactHex = retained.artifactHash.slice("sha256:".length);
  const identityHex = sha256({
    schema: "pantheon.preventure-provider-output.v1",
    authorityHash,
    assignmentHash,
    descriptorHash,
    requestBodyHash,
  }).slice("sha256:".length);
  return {
    createStore,
    retained,
    reference: { retainedOutputHash: retained.artifactRef, authorityHash, assignmentHash, descriptorHash },
    relativeContentPath: path.join(artifactHex.slice(0, 2), `${artifactHex}.json`),
    relativeClaimPath: path.join("claims", identityHex.slice(0, 2), `${identityHex}.json`),
  };
}

function assertExactHardLink(contentPath, claimPath) {
  const content = fs.lstatSync(contentPath);
  const claim = fs.lstatSync(claimPath);
  assert.equal(content.isFile(), true);
  assert.equal(claim.isFile(), true);
  assert.equal(content.dev, claim.dev);
  assert.equal(content.ino, claim.ino);
  assert.equal(content.nlink, 2);
  assert.equal(claim.nlink, 2);
}

function retainedOutputPaths(outputRoot, identity) {
  const artifactHex = identity.artifactHash.slice("sha256:".length);
  const identityHex = sha256({
    schema: "pantheon.preventure-provider-output.v1",
    authorityHash: identity.authorityHash,
    assignmentHash: identity.assignmentHash,
    descriptorHash: identity.descriptorHash,
    requestBodyHash: identity.requestBodyHash,
  }).slice("sha256:".length);
  return {
    contentPath: path.join(outputRoot, artifactHex.slice(0, 2), `${artifactHex}.json`),
    claimPath: path.join(outputRoot, "claims", identityHex.slice(0, 2), `${identityHex}.json`),
  };
}

function restoredTerminalCustody(restoredRoot, clockValue) {
  const dbPath = path.join(restoredRoot, "data", "runtime.sqlite");
  const db = new DatabaseSync(dbPath, { readOnly: true });
  const outputRoot = path.join(restoredRoot, "data", "artifacts", "preventure-research");
  const retainedOutputStore = createPreventureResearchOutputStore({
    artifactRoot: outputRoot,
    assignmentMaxCostAudCentsForHash(assignmentHash) {
      const row = db.prepare(
        `SELECT max_cost_aud_cents
         FROM preventure_research_assignments WHERE assignment_hash = ?`,
      ).get(assignmentHash);
      if (!row) throw new Error("The restored retained-output assignment cap is unavailable.");
      return row.max_cost_aud_cents;
    },
  });
  const store = createPreventureResearchStore(
    db,
    historicalStoreOptions(() => clockValue, { retainedOutputStore }),
  );
  return { db, outputRoot, retainedOutputStore, store };
}

function captureTerminalCustodyTruth(db, store, assignmentHash) {
  const verification = store.verifyLedger();
  const ledger = store.readLedger(preventureAuthority.authorityHash);
  const recoveryRow = db.prepare(
    `SELECT * FROM preventure_research_terminal_recoveries
     WHERE assignment_hash = ?`,
  ).get(assignmentHash);
  assert.ok(recoveryRow);
  return {
    verification,
    ledger,
    ledgerHash: sha256(ledger),
    recoveryRow,
    recoveryJson: JSON.parse(recoveryRow.recovery_json),
  };
}

function capturePreventureRecoveryTruth(db) {
  const clock = () => STORE_TIME;
  const storeOptions = historicalStoreOptions(clock);
  const store = createPreventureResearchStore(db, storeOptions);
  const verification = store.verifyLedger();
  const ledger = store.readLedger(preventureAuthority.authorityHash);
  const ownerProjection = getPreventureResearchOwnerState(db, {
    clock,
    store,
    authorityRegistry: storeOptions.authorityRegistry,
  });
  const taskIds = ledger.assignments.map((item) => item.taskId);
  const taskMarkers = taskIds.map(() => "?").join(", ");
  const genericTruth = {
    approvals: db.prepare(
      `SELECT * FROM approvals
       WHERE id IN ('approval_preventure_early_stop_accept',
                    'approval_preventure_early_stop_activate')
       ORDER BY id`,
    ).all(),
    approvalDecisionReceipts: db.prepare(
      `SELECT * FROM preventure_research_approval_decisions
       WHERE authority_hash = ? ORDER BY event_type, approval_id`,
    ).all(preventureAuthority.authorityHash),
    tasks: db.prepare(
      `SELECT * FROM tasks WHERE id IN (${taskMarkers}) ORDER BY id`,
    ).all(...taskIds),
    attempts: db.prepare(
      `SELECT * FROM task_attempts WHERE task_id IN (${taskMarkers}) ORDER BY id`,
    ).all(...taskIds),
    modelCalls: db.prepare(
      `SELECT * FROM model_calls WHERE task_id IN (${taskMarkers}) ORDER BY id`,
    ).all(...taskIds),
    agentRuns: db.prepare(
      `SELECT * FROM agent_runs WHERE task_id IN (${taskMarkers}) ORDER BY id`,
    ).all(...taskIds),
    agentReceipts: db.prepare(
      `SELECT * FROM agent_run_receipts WHERE task_id IN (${taskMarkers}) ORDER BY id`,
    ).all(...taskIds),
    reservations: db.prepare(
      `SELECT * FROM budget_reservations WHERE task_id IN (${taskMarkers}) ORDER BY id`,
    ).all(...taskIds),
    genericCosts: db.prepare(
      `SELECT * FROM costs WHERE task_id IN (${taskMarkers}) ORDER BY id`,
    ).all(...taskIds),
    researchRuns: db.prepare(
      `SELECT * FROM research_runs WHERE task_id IN (${taskMarkers}) ORDER BY id`,
    ).all(...taskIds),
    researchSources: db.prepare(
      `SELECT sources.* FROM research_sources AS sources
       JOIN research_runs AS runs ON runs.id = sources.run_id
       WHERE runs.task_id IN (${taskMarkers}) ORDER BY sources.id`,
    ).all(...taskIds),
    provenance: db.prepare(
      `SELECT * FROM agent_run_provenance
       WHERE task_id IN (${taskMarkers}) ORDER BY id`,
    ).all(...taskIds),
  };
  const completion = ledger.lifecycle.find((item) => item.eventType === "completed");
  return {
    verification,
    ledger,
    ledgerHash: sha256(ledger),
    genericTruth,
    genericTruthHash: sha256(genericTruth),
    authorityHash: ledger.authority.authorityHash,
    approvalDecisionReceiptHashes: genericTruth.approvalDecisionReceipts
      .map((item) => item.decision_receipt_hash)
      .sort(),
    lifecycleEventHashes: ledger.lifecycle.map((item) => item.eventHash),
    assignmentHashes: ledger.assignments.map((item) => item.assignmentHash),
    taskAttemptIds: ledger.executionEvidence.taskAttempts.map((item) => item.id),
    modelCallIds: ledger.executionEvidence.modelCalls.map((item) => item.id),
    agentRunReceiptHashes: ledger.executionEvidence.agentRunReceipts
      .map((item) => item.receipt_hash),
    costReceiptHashes: ledger.costEvents.map((item) => item.receiptHash),
    sourceSnapshotHashes: ledger.sourceSnapshots.map((item) => item.snapshotHash),
    evidenceHashes: ledger.evidenceRecords.map((item) => item.evidenceHash),
    earlyStopRecordHash: ledger.terminalStopRecord?.earlyStopRecordHash || null,
    skippedAssignmentRecordHashes: ledger.assignmentSkips
      .map((item) => item.skipRecordHash),
    decisionHash: ledger.decision?.decisionHash || null,
    decisionOutcome: ledger.decision?.outcome || null,
    completionMode: ledger.decision?.completionMode || null,
    evidenceSetHash: ledger.decision?.evidenceSetHash || null,
    receiptSetHash: ledger.decision?.receiptSetHash || null,
    resultingReadinessHash: completion?.metadata?.resultingReadinessHash || null,
    ownerProjection,
    ownerProjectionHash: sha256(ownerProjection),
  };
}

test("one encrypted recovery set restores source, database, artifacts, packs and private references", async () => {
  const fixture = createRecoveryFixture("complete-set");
  try {
    const backup = await createRecoverySet(fixture);
    assert.equal(backup.kind, "set");
    assert.match(path.basename(backup.destinationPath), /^pantheon-recovery-set-/);
    const header = readEncryptedHeader(backup.destinationPath).header;
    assert.equal(header.setId, backup.setId);
    assert.equal(header.manifestSha256, backup.manifestSha256);
    assert.equal(header.keyId, backupKeyId(PASSPHRASE));
    assert.equal(
      fs.readFileSync(backup.destinationPath).includes(Buffer.from("PRIVATE-KYC-REFERENCE-MARKER")),
      false,
    );

    const verification = await verifyBackup(backup.destinationPath, { passphrase: PASSPHRASE });
    assert.equal(verification.verified, true);
    assert.equal(verification.recoverySet.setId, backup.setId);
    assert.equal(verification.recoverySet.sqlite.integrityCheck, "ok");
    assert.equal(verification.recoverySet.sqlite.schemaVersion, LATEST_SCHEMA_VERSION);
    assert.equal(verification.recoverySet.sqlite.compatibility, "current_ready");
    assert.equal(verification.recoverySet.source.startPath, "src/server.js");
    assert.deepEqual(
      verification.recoverySet.source.requiredFiles,
      [
        "package-lock.json",
        "package.json",
        "public/app.js",
        "public/index.html",
        "public/styles.css",
        "requirements-renderer-lock.txt",
        "requirements-runtime.txt",
        "scripts/compose-storefront-cover.py",
        "scripts/render-approval-pack.py",
        "scripts/render-digital-product-kit.py",
        "scripts/renderer-environment.js",
        "src/runtime/renderer-environment.js",
        "src/server.js",
      ],
    );
    assert.equal(verification.recoverySet.components.source.present, true);
    assert.equal(verification.recoverySet.components.database.fileCount, 1);
    assert.equal(verification.recoverySet.components.runtimeArtifacts.present, true);
    assert.equal(verification.recoverySet.components.approvalPacks.present, true);
    assert.equal(verification.recoverySet.components.privateOperatorReferences.present, true);

    const restoredRoot = path.join(fixture.root, "restored-workspace");
    const restored = await restoreBackup(backup.destinationPath, restoredRoot, {
      passphrase: PASSPHRASE,
    });
    assert.equal(restored.recoverySet.setId, backup.setId);
    assert.equal(fs.readFileSync(path.join(restoredRoot, "src", "pantheon.js"), "utf8"), "module.exports = 'ready';\n");
    assert.equal(
      fs.readFileSync(path.join(restoredRoot, "data", "artifacts", "commercial-brief.md"), "utf8"),
      "verified runtime artifact\n",
    );
    assert.equal(
      fs.readFileSync(path.join(restoredRoot, "output", "pdf", "operator-pack.pdf"), "utf8"),
      "fixture pdf bytes\n",
    );
    assert.equal(
      fs.readFileSync(path.join(restoredRoot, "private", "operator-reference.txt"), "utf8"),
      "PRIVATE-KYC-REFERENCE-MARKER\n",
    );
    assert.equal(fs.existsSync(path.join(restoredRoot, "private", "runtime-credentials.json")), false);
    assert.deepEqual(
      fs.readFileSync(path.join(restoredRoot, "requirements-renderer-lock.txt")),
      fs.readFileSync(path.join(projectRoot, "requirements-renderer-lock.txt")),
    );
    assert.equal(fs.existsSync(path.join(restoredRoot, ".venv-renderer")), false);
    assert.equal(fs.existsSync(path.join(restoredRoot, ".pantheon-recovery", "manifest.json")), true);
    assert.equal(fs.existsSync(path.join(restoredRoot, ".pantheon-recovery", "restore-verification.json")), true);

    const restoredDb = new DatabaseSync(path.join(restoredRoot, "data", "runtime.sqlite"), { readOnly: true });
    assert.equal(
      restoredDb.prepare("SELECT name FROM ventures WHERE id = 'venture-digital-products'").get().name,
      "Recovery proof",
    );
    restoredDb.close();
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("recovery sets rebuild and verify the exact immutable provider-output claim hard link", async () => {
  const fixture = createRecoveryFixture("preventure-output-hard-link");
  const outputRoot = path.join(fixture.artifactRoot, "preventure-research");
  let sourceDb;
  try {
    sourceDb = openDatabase(fixture.dbPath, { clock: () => STORE_TIME });
    const prepared = prepareFixture(sourceDb, { clock: () => STORE_TIME });
    sourceDb.close();
    sourceDb = null;
    const proof = retainBackupProofOutput(outputRoot, prepared.assignments[0]);
    const sourceContent = path.join(outputRoot, proof.relativeContentPath);
    const sourceClaim = path.join(outputRoot, proof.relativeClaimPath);
    assertExactHardLink(sourceContent, sourceClaim);

    await assert.rejects(
      createBackup({
        kind: "artifacts",
        sourceRoot: fixture.sourceRoot,
        artifactRoot: fixture.artifactRoot,
        approvalPackRoot: fixture.approvalPackRoot,
        destinationRoot: fixture.destinationRoot,
        passphrase: PASSPHRASE,
        createdAt: "2026-08-02T04:30:00.000Z",
      }),
      /requires a full recovery-set backup/i,
    );

    const backup = await createRecoverySet(fixture, {
      createdAt: "2026-08-02T05:00:00.000Z",
    });
    const verified = await verifyBackup(backup.destinationPath, { passphrase: PASSPHRASE });
    assert.equal(verified.verified, true);
    assert.equal(verified.recoverySet.hardLinkCount, 1);
    assert.deepEqual(
      verified.recoverySet.manifest.hardLinks.map((item) => item.kind),
      ["preventure_output_claim_v1"],
    );

    const restoreAndLoad = async (name) => {
      const restoredRoot = path.join(fixture.root, name);
      const restored = await restoreBackup(backup.destinationPath, restoredRoot, {
        passphrase: PASSPHRASE,
      });
      assert.equal(restored.recoverySet.hardLinkCount, 1);
      const restoredOutputRoot = path.join(restoredRoot, "data", "artifacts", "preventure-research");
      const contentPath = path.join(restoredOutputRoot, proof.relativeContentPath);
      const claimPath = path.join(restoredOutputRoot, proof.relativeClaimPath);
      return {
        restoredRoot,
        store: proof.createStore(restoredOutputRoot),
        contentPath,
        claimPath,
      };
    };

    const intact = await restoreAndLoad("restored-preventure-output-intact");
    assertExactHardLink(intact.contentPath, intact.claimPath);
    assert.equal(intact.store.load(proof.reference).artifactHash, proof.retained.artifactHash);
    assert.equal(validateRecoverySetDirectory(intact.restoredRoot).hardLinkCount, 1);

    const missing = await restoreAndLoad("restored-preventure-output-missing");
    fs.rmSync(missing.contentPath);
    assert.throws(
      () => missing.store.load(proof.reference),
      { code: "preventure_output_artifact_missing" },
    );
    assert.throws(
      () => validateRecoverySetDirectory(missing.restoredRoot),
      /inventory does not match|hard-link|missing/i,
    );

    const independent = await restoreAndLoad("restored-preventure-output-independent-claim");
    fs.unlinkSync(independent.claimPath);
    fs.copyFileSync(independent.contentPath, independent.claimPath);
    assert.notEqual(
      fs.lstatSync(independent.contentPath).ino,
      fs.lstatSync(independent.claimPath).ino,
    );
    assert.throws(
      () => independent.store.load(proof.reference),
      { code: "preventure_output_artifact_changed" },
    );
    assert.throws(
      () => validateRecoverySetDirectory(independent.restoredRoot),
      /not linked|hard-link/i,
    );
  } finally {
    try { sourceDb?.close(); } catch {}
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("Windows recovery fsync rebuilds retained-output custody without EPERM", {
  skip: process.platform !== "win32",
}, async () => {
  const fixture = createRecoveryFixture("windows-hard-link-fsync");
  const outputRoot = path.join(fixture.artifactRoot, "preventure-research");
  let sourceDb;
  try {
    sourceDb = openDatabase(fixture.dbPath, { clock: () => STORE_TIME });
    const prepared = prepareFixture(sourceDb, { clock: () => STORE_TIME });
    sourceDb.close();
    sourceDb = null;
    const proof = retainBackupProofOutput(outputRoot, prepared.assignments[0]);
    const backup = await createRecoverySet(fixture, {
      createdAt: "2026-08-02T05:30:00.000Z",
    });
    const restoredRoot = path.join(fixture.root, "restored-windows-hard-link-fsync");
    const restored = await restoreBackup(backup.destinationPath, restoredRoot, {
      passphrase: PASSPHRASE,
    });
    assert.equal(restored.recoverySet.hardLinkCount, 1);
    const restoredOutputRoot = path.join(
      restoredRoot,
      "data",
      "artifacts",
      "preventure-research",
    );
    const contentPath = path.join(restoredOutputRoot, proof.relativeContentPath);
    const claimPath = path.join(restoredOutputRoot, proof.relativeClaimPath);
    assertExactHardLink(contentPath, claimPath);
    assert.equal(
      proof.createStore(restoredOutputRoot).load(proof.reference).artifactHash,
      proof.retained.artifactHash,
    );
  } finally {
    try { sourceDb?.close(); } catch {}
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("schema 27 encrypted recovery preserves terminal custody plus owner-attested billing and fails closed", async () => {
  const fixture = createRecoveryFixture("schema-27-terminal-custody");
  const credentialMarker = "TERMINAL-CUSTODY-PROVIDER-CREDENTIAL-MUST-NOT-RESTORE";
  const outputRoot = path.join(fixture.artifactRoot, "preventure-research");
  let subject;
  try {
    fs.writeFileSync(
      path.join(fixture.privateOperatorRoot, "runtime-credentials.json"),
      JSON.stringify({ openAiApiKey: credentialMarker }),
    );
    fs.mkdirSync(path.join(fixture.privateOperatorRoot, "nested"), { recursive: true });
    fs.writeFileSync(
      path.join(fixture.privateOperatorRoot, "nested", "runtime-credentials.json"),
      JSON.stringify({ providerToken: credentialMarker }),
    );
    for (const managedRoot of [fixture.artifactRoot, fixture.approvalPackRoot]) {
      fs.mkdirSync(path.join(managedRoot, "nested"), { recursive: true });
      fs.writeFileSync(
        path.join(managedRoot, "nested", "runtime-credentials.json"),
        JSON.stringify({ misplacedCredential: credentialMarker }),
      );
    }

    subject = terminalRecoveryBillingFixture({
      artifactRoot: outputRoot,
      providerRequestId: null,
    });
    fixture.dbPath = subject.dbPath;
    const execution = subject.execution;
    const artifact = subject.artifact;
    const committed = subject.recovered;
    const ownerSecurity = authenticatedOwnerSecurityForTest(subject.db);
    bindAuthenticatedOwnerBillingObservationIssuer(
      subject.db,
      ownerSecurity.security,
    );
    const billingInput = observationInput(subject, { amountAudCents: 0 });
    const billingAttestation = issueOwnerBillingAttestation(
      ownerSecurity.security,
      ownerSecurity.bootstrapSecret,
      billingInput,
      execution.assignment.assignmentHash,
    );
    const billing = subject.store.recordOwnerAttestedProviderBillingObservation(
      execution.assignment.assignmentHash,
      billingInput,
      { ownerSessionAttestation: billingAttestation },
    );
    assert.equal(billing.created, true);
    assert.deepEqual(committed.recovery.controls, {
      additionalAiCostAudCents: 0,
      additionalNetworkCalls: 0,
      executionSealed: true,
      retryAuthorized: false,
      evidenceEligible: false,
      decisionEligible: false,
      completionEligible: false,
      commercialInference: "none",
    });
    const reference = {
      retainedOutputHash: artifact.retained.artifactRef,
      authorityHash: preventureAuthority.authorityHash,
      assignmentHash: execution.assignment.assignmentHash,
      descriptorHash: execution.descriptor.descriptorHash,
    };
    const identity = {
      artifactHash: artifact.retained.artifactHash,
      authorityHash: preventureAuthority.authorityHash,
      assignmentHash: execution.assignment.assignmentHash,
      descriptorHash: execution.descriptor.descriptorHash,
      requestBodyHash: execution.descriptor.request.requestBodyHash,
    };
    const beforeArtifact = JSON.parse(JSON.stringify(subject.outputStore.load(reference)));
    const before = captureTerminalCustodyTruth(
      subject.db,
      subject.store,
      execution.assignment.assignmentHash,
    );
    assert.equal(before.verification.ok, true);
    assert.equal(before.verification.terminalRecoveries, 1);
    assert.equal(before.verification.ownerBillingObservations, 1);
    assert.equal(before.ledger.terminalRecoveries.length, 1);
    assert.equal(before.ledger.ownerBillingObservations.length, 1);
    assert.equal(before.ledger.costEvents.at(-2).eventType, "unknown");
    assert.equal(before.ledger.costEvents.at(-2).amountAudCents, null);
    assert.equal(
      before.ledger.costEvents.at(-2).exposureAudCents,
      execution.assignment.maxCostAudCents,
    );
    assert.equal(before.ledger.costEvents.at(-1).eventType, "reconciled");
    assert.equal(before.ledger.costEvents.at(-1).amountAudCents, 0);
    assert.equal(before.ledger.costEvents.at(-1).exposureAudCents, 0);
    assert.equal(
      before.ledger.ownerBillingObservations[0].observationHash,
      billing.observation.observationHash,
    );
    assert.equal(
      before.ledger.terminalRecoveries[0].recoveryHash,
      committed.recovery.recoveryHash,
    );
    const custodyClock = subject.clockValue;
    subject.db.close();

    // Runtime artifacts are preserved byte-for-byte and must be secret-free.
    // Exact credential stores are excluded from every recovery-set component.
    const backup = await createRecoverySet(fixture, {
      createdAt: "2026-08-04T02:00:00.000Z",
    });
    assert.equal(
      fs.readFileSync(backup.destinationPath).includes(Buffer.from(credentialMarker)),
      false,
    );
    const verified = await verifyBackup(backup.destinationPath, { passphrase: PASSPHRASE });
    assert.equal(verified.verified, true);
    assert.equal(verified.recoverySet.sqlite.schemaVersion, LATEST_SCHEMA_VERSION);
    assert.equal(verified.recoverySet.hardLinkCount, 1);
    assert.equal(verified.recoverySet.terminalCustodyCount, 1);
    assert.deepEqual(
      verified.recoverySet.manifest.hardLinks.map((item) => ({
        artifactHash: item.artifactHash,
        assignmentHash: item.assignmentHash,
        rawProviderBytesHash: item.rawProviderBytesHash,
      })),
      [{
        artifactHash: artifact.retained.artifactHash,
        assignmentHash: execution.assignment.assignmentHash,
        rawProviderBytesHash: artifact.retained.rawProviderBytesHash,
      }],
    );

    const sourcePaths = retainedOutputPaths(outputRoot, identity);
    fs.rmSync(sourcePaths.contentPath);
    fs.rmSync(sourcePaths.claimPath);
    await assert.rejects(
      createRecoverySet(fixture, { createdAt: "2026-08-04T03:00:00.000Z" }),
      /terminal retained-output recovery.*missing or changed/i,
    );

    const intactRoot = path.join(fixture.root, "restored-terminal-custody-intact");
    await restoreBackup(backup.destinationPath, intactRoot, { passphrase: PASSPHRASE });
    const intact = restoredTerminalCustody(intactRoot, custodyClock);
    try {
      const paths = retainedOutputPaths(intact.outputRoot, identity);
      assertExactHardLink(paths.contentPath, paths.claimPath);
      assert.deepEqual(intact.retainedOutputStore.load(reference), beforeArtifact);
      assert.deepEqual(
        captureTerminalCustodyTruth(
          intact.db,
          intact.store,
          execution.assignment.assignmentHash,
        ),
        before,
      );
      const intactValidation = validateRecoverySetDirectory(intactRoot);
      assert.equal(intactValidation.hardLinkCount, 1);
      assert.equal(intactValidation.terminalCustodyCount, 1);
      assert.equal(containsBytesInTree(intactRoot, credentialMarker), false);
    } finally {
      intact.db.close();
    }

    const missingRoot = path.join(fixture.root, "restored-terminal-custody-missing");
    await restoreBackup(backup.destinationPath, missingRoot, { passphrase: PASSPHRASE });
    const missing = restoredTerminalCustody(missingRoot, custodyClock);
    try {
      const paths = retainedOutputPaths(missing.outputRoot, identity);
      fs.rmSync(paths.contentPath);
      assert.throws(
        () => missing.retainedOutputStore.load(reference),
        { code: "preventure_output_artifact_missing" },
      );
      assert.throws(
        () => missing.store.readLedger(preventureAuthority.authorityHash),
        { code: "preventure_research_terminal_recovery_artifact_missing" },
      );
      assert.throws(
        () => missing.store.verifyLedger(),
        { code: "preventure_research_terminal_recovery_artifact_missing" },
      );
      assert.throws(
        () => validateRecoverySetDirectory(missingRoot),
        /inventory does not match|hard-link|missing/i,
      );
    } finally {
      missing.db.close();
    }

    const changedRoot = path.join(fixture.root, "restored-terminal-custody-independent");
    await restoreBackup(backup.destinationPath, changedRoot, { passphrase: PASSPHRASE });
    const changed = restoredTerminalCustody(changedRoot, custodyClock);
    try {
      const paths = retainedOutputPaths(changed.outputRoot, identity);
      fs.unlinkSync(paths.claimPath);
      fs.copyFileSync(paths.contentPath, paths.claimPath);
      assert.notEqual(
        fs.lstatSync(paths.contentPath).ino,
        fs.lstatSync(paths.claimPath).ino,
      );
      assert.throws(
        () => changed.retainedOutputStore.load(reference),
        { code: "preventure_output_artifact_changed" },
      );
      assert.throws(
        () => changed.store.readLedger(preventureAuthority.authorityHash),
        { code: "preventure_research_terminal_recovery_artifact_missing" },
      );
      assert.throws(
        () => changed.store.verifyLedger(),
        { code: "preventure_research_terminal_recovery_artifact_missing" },
      );
      assert.throws(
        () => validateRecoverySetDirectory(changedRoot),
        /not linked|hard-link/i,
      );
    } finally {
      changed.db.close();
    }
  } finally {
    try { subject?.close(); } catch {}
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("schema 27 encrypted recovery preserves the complete sealed pre-venture truth without credentials", async () => {
  const fixture = createRecoveryFixture("schema-27-preventure-ledger");
  const credentialMarker = "PREVENTURE-PROVIDER-CREDENTIAL-MUST-NOT-RESTORE";
  const safeArtifact = "Secret-free retained business artifact for the sealed research_more decision.\n";
  let sourceDb;
  try {
    fs.writeFileSync(
      path.join(fixture.privateOperatorRoot, "runtime-credentials.json"),
      JSON.stringify({ openAiApiKey: credentialMarker }),
    );
    fs.mkdirSync(path.join(fixture.privateOperatorRoot, "nested"), { recursive: true });
    fs.writeFileSync(
      path.join(fixture.privateOperatorRoot, "nested", "runtime-credentials.json"),
      JSON.stringify({ providerToken: credentialMarker }),
    );

    sourceDb = openDatabase(fixture.dbPath, { clock: () => STORE_TIME });
    const sealed = sealPopulatedEarlyStopRound(sourceDb, { clock: () => STORE_TIME });
    assert.equal(sealed.recorded.created, true);
    assert.equal(sealed.recorded.decision.outcome, "research_more");
    assert.equal(sealed.recorded.decision.completionMode, "validated_early_stop");
    assert.equal(sealed.executions.length, 1);
    assert.ok(sealed.executions[0].retainedEvidence?.sourceSnapshot.snapshotHash);
    assert.ok(sealed.executions[0].retainedEvidence?.evidence.evidenceHash);

    const before = capturePreventureRecoveryTruth(sourceDb);
    assert.deepEqual(
      {
        authorities: before.verification.authorities,
        approvalDecisions: before.verification.approvalDecisions,
        lifecycleEvents: before.verification.lifecycleEvents,
        assignments: before.verification.assignments,
        costEvents: before.verification.costEvents,
        sourceSnapshots: before.verification.sourceSnapshots,
        evidenceRecords: before.verification.evidenceRecords,
        terminalStops: before.verification.terminalStops,
        assignmentSkips: before.verification.assignmentSkips,
        decisions: before.verification.decisions,
      },
      {
        authorities: 1,
        approvalDecisions: 2,
        lifecycleEvents: 4,
        assignments: 3,
        costEvents: 1,
        sourceSnapshots: 1,
        evidenceRecords: 1,
        terminalStops: 1,
        assignmentSkips: 2,
        decisions: 1,
      },
    );
    assert.equal(before.verification.ok, true);
    assert.equal(before.approvalDecisionReceiptHashes.length, 2);
    assert.equal(
      before.genericTruth.approvalDecisionReceipts.every((item) => (
        item.decided_by === "owner"
        && item.decision_source === "authenticated_owner_session_attestation"
        && item.decision_status === "approved"
      )),
      true,
    );
    assert.equal(before.genericTruth.tasks.length, 3);
    assert.equal(before.genericTruth.attempts.length, 1);
    assert.equal(before.genericTruth.modelCalls.length, 1);
    assert.equal(before.genericTruth.agentRuns.length, 1);
    assert.equal(before.genericTruth.agentReceipts.length, 1);
    assert.equal(before.genericTruth.reservations.length, 1);
    assert.equal(before.genericTruth.genericCosts.length, 1);
    assert.equal(before.genericTruth.researchRuns.length, 1);
    assert.equal(before.genericTruth.researchSources.length, 1);
    assert.equal(before.genericTruth.provenance.length, 1);
    assert.equal(before.taskAttemptIds.length, 1);
    assert.equal(before.modelCallIds.length, 1);
    assert.equal(before.agentRunReceiptHashes.length, 1);
    assert.equal(before.costReceiptHashes.length, 1);
    assert.equal(before.sourceSnapshotHashes.length, 1);
    assert.equal(before.evidenceHashes.length, 1);
    assert.equal(before.skippedAssignmentRecordHashes.length, 2);
    assert.equal(before.decisionOutcome, "research_more");
    assert.equal(before.completionMode, "validated_early_stop");
    assert.equal(before.ownerProjection.history.total, 1);
    assert.equal(before.ownerProjection.current, null);
    assert.equal(before.ownerProjection.businessTruth.commercialValidationOccurred, false);
    assert.equal(before.ownerProjection.businessTruth.externalSpendAudCents, 0);

    // Runtime artifacts are intentionally preserved whole. They must therefore be
    // secret-free before backup; credential stores are excluded by exact filename.
    fs.writeFileSync(path.join(fixture.artifactRoot, "sealed-preventure-result.txt"), safeArtifact);
    sourceDb.close();
    sourceDb = null;

    const backup = await createRecoverySet(fixture, {
      createdAt: "2026-08-03T02:00:00.000Z",
    });
    assert.equal(
      fs.readFileSync(backup.destinationPath).includes(Buffer.from(credentialMarker)),
      false,
    );
    const verified = await verifyBackup(backup.destinationPath, { passphrase: PASSPHRASE });
    assert.equal(verified.verified, true);
    assert.equal(verified.recoverySet.sqlite.schemaVersion, LATEST_SCHEMA_VERSION);
    assert.equal(verified.recoverySet.sqlite.compatibility, "current_ready");

    const restoredRoot = path.join(fixture.root, "restored-schema-27-preventure");
    await restoreBackup(backup.destinationPath, restoredRoot, { passphrase: PASSPHRASE });
    assert.equal(
      fs.readFileSync(
        path.join(restoredRoot, "data", "artifacts", "sealed-preventure-result.txt"),
        "utf8",
      ),
      safeArtifact,
    );
    assert.equal(
      fs.existsSync(path.join(restoredRoot, "private", "runtime-credentials.json")),
      false,
    );
    assert.equal(
      fs.existsSync(path.join(restoredRoot, "private", "nested", "runtime-credentials.json")),
      false,
    );
    assert.equal(containsBytesInTree(restoredRoot, credentialMarker), false);

    const restoredDb = new DatabaseSync(
      path.join(restoredRoot, "data", "runtime.sqlite"),
      { readOnly: true },
    );
    try {
      const after = capturePreventureRecoveryTruth(restoredDb);
      assert.deepEqual(after, before);
    } finally {
      restoredDb.close();
    }
  } finally {
    try { sourceDb?.close(); } catch {}
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("configured in-workspace private and approval roots restore only through canonical components", async () => {
  const fixture = createRecoveryFixture("configured-component-roots");
  try {
    const configuredPrivateRoot = path.join(fixture.sourceRoot, "configured-operator-vault");
    const configuredApprovalPackRoot = path.join(fixture.sourceRoot, "configured-approval-packs");
    fs.renameSync(fixture.privateOperatorRoot, configuredPrivateRoot);
    fs.renameSync(fixture.approvalPackRoot, configuredApprovalPackRoot);
    fixture.privateOperatorRoot = configuredPrivateRoot;
    fixture.approvalPackRoot = configuredApprovalPackRoot;
    fs.mkdirSync(path.join(configuredPrivateRoot, "nested"), { recursive: true });
    fs.writeFileSync(
      path.join(configuredPrivateRoot, "nested", "runtime-credentials.json"),
      "NESTED-CIRCULAR-RECOVERY-SECRET-MARKER",
    );

    const backup = await createRecoverySet(fixture);
    const restoredRoot = path.join(fixture.root, "restored-configured-components");
    await restoreBackup(backup.destinationPath, restoredRoot, { passphrase: PASSPHRASE });

    assert.equal(fs.existsSync(path.join(restoredRoot, "configured-operator-vault")), false);
    assert.equal(fs.existsSync(path.join(restoredRoot, "configured-approval-packs")), false);
    assert.equal(
      fs.readFileSync(path.join(restoredRoot, "private", "operator-reference.txt"), "utf8"),
      "PRIVATE-KYC-REFERENCE-MARKER\n",
    );
    assert.equal(
      fs.readFileSync(path.join(restoredRoot, "output", "pdf", "operator-pack.pdf"), "utf8"),
      "fixture pdf bytes\n",
    );
    assert.equal(fs.existsSync(path.join(restoredRoot, "private", "runtime-credentials.json")), false);
    assert.equal(
      fs.existsSync(path.join(restoredRoot, "private", "nested", "runtime-credentials.json")),
      false,
    );
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("retention cannot let an authenticated malformed recovery set evict a verified set", async () => {
  const fixture = createRecoveryFixture("semantic-set-retention");
  try {
    const restorable = await createRecoverySet(fixture, {
      createdAt: "2026-07-18T02:00:00.000Z",
    });
    const malformedArchive = path.join(fixture.root, "malformed-recovery-set.tar");
    createSourceArchive(fixture.sourceRoot, malformedArchive, {
      artifactRoot: fixture.artifactRoot,
      dbPath: fixture.dbPath,
      backupDestination: fixture.destinationRoot,
      approvalPackRoot: fixture.approvalPackRoot,
      privateOperatorRoot: fixture.privateOperatorRoot,
    });
    const authenticatedButInvalid = path.join(
      fixture.destinationRoot,
      "newer-invalid-recovery-set.jbackup",
    );
    await encryptFile(malformedArchive, authenticatedButInvalid, {
      kind: "set",
      passphrase: PASSPHRASE,
      createdAt: "2026-07-19T02:00:00.000Z",
      setId: "00000000-0000-4000-8000-000000000000",
      manifestSha256: "0".repeat(64),
    });

    const retention = pruneBackups(fixture.destinationRoot, {
      passphrase: PASSPHRASE,
      dailyLimit: 1,
      weeklyLimit: 0,
    });
    assert.equal(fs.existsSync(restorable.destinationPath), true);
    assert.equal(fs.existsSync(authenticatedButInvalid), true);
    assert.equal(retention.removed.includes(restorable.destinationPath), false);
    assert.equal(
      retention.invalid.some((item) => item.filePath === authenticatedButInvalid),
      true,
    );
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("recovery-set restore refuses every active component path, including external layouts", async () => {
  const root = tempRoot("active-component-overlap");
  const active = {
    rootDir: path.join(root, "active-workspace"),
    dbPath: path.join(root, "external-data", "runtime.sqlite"),
    artifactRoot: path.join(root, "external-artifacts"),
    approvalPackRoot: path.join(root, "external-approval-packs"),
    privateOperatorRoot: path.join(root, "external-private"),
  };
  try {
    for (const [label, destination] of [
      ["source workspace", active.rootDir],
      ["runtime database", path.dirname(active.dbPath)],
      ["runtime artifacts", active.artifactRoot],
      ["approval packs", active.approvalPackRoot],
      ["private operator references", active.privateOperatorRoot],
    ]) {
      assert.throws(
        () => assertRestoreDestinationIsInactive("set", destination, active),
        new RegExp(`overlaps active ${label}`, "i"),
      );
    }
    assert.doesNotThrow(() => assertRestoreDestinationIsInactive(
      "set",
      path.join(root, "independent-restore"),
      active,
    ));

    const fixture = createRecoveryFixture("live-external-overlap");
    try {
      const backup = await createRecoverySet(fixture);
      const previousPack = process.env.PANTHEON_APPROVAL_PACK_DIR;
      const previousPrivate = process.env.PANTHEON_PRIVATE_OPERATOR_DIR;
      try {
        process.env.PANTHEON_APPROVAL_PACK_DIR = active.approvalPackRoot;
        process.env.PANTHEON_PRIVATE_OPERATOR_DIR = active.privateOperatorRoot;
        await assert.rejects(
          restoreBackup(
            backup.destinationPath,
            active.approvalPackRoot,
            { passphrase: PASSPHRASE },
          ),
          /overlaps active approval packs/i,
        );
        await assert.rejects(
          restoreBackup(
            backup.destinationPath,
            active.privateOperatorRoot,
            { passphrase: PASSPHRASE },
          ),
          /overlaps active private operator references/i,
        );
      } finally {
        if (previousPack === undefined) delete process.env.PANTHEON_APPROVAL_PACK_DIR;
        else process.env.PANTHEON_APPROVAL_PACK_DIR = previousPack;
        if (previousPrivate === undefined) delete process.env.PANTHEON_PRIVATE_OPERATOR_DIR;
        else process.env.PANTHEON_PRIVATE_OPERATOR_DIR = previousPrivate;
      }
    } finally {
      fs.rmSync(fixture.root, { recursive: true, force: true });
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("encrypted recovery preserves legacy schema 24 and proves its disposable migration", async () => {
  const fixture = createRecoveryFixture("legacy-schema-24");
  try {
    downgradeDatabaseToLegacySchema24(fixture.dbPath);
    const legacyDb = new DatabaseSync(fixture.dbPath, { readOnly: true });
    try {
      assert.equal(
        legacyDb.prepare(
          `SELECT COUNT(*) AS count
           FROM sqlite_master
           WHERE name GLOB '*preventure*' OR sql GLOB '*preventure*'`,
        ).get().count,
        0,
      );
      assert.equal(
        legacyDb.prepare("PRAGMA table_info(approvals)").all()
          .some((column) => column.name === "decided_by"),
        false,
      );
    } finally {
      legacyDb.close();
    }
    const sourceBefore = fs.readFileSync(fixture.dbPath);
    const backup = await createRecoverySet(fixture);
    const verified = await verifyBackup(backup.destinationPath, {
      passphrase: PASSPHRASE,
    });
    assert.equal(verified.recoverySet.sqlite.schemaVersion, LEGACY_SCHEMA_VERSION);
    assert.equal(
      verified.recoverySet.sqlite.compatibility,
      ARCHIVE_SCHEMA_COMPATIBILITY_LABELS[LEGACY_SCHEMA_VERSION],
    );
    assert.deepEqual(verified.recoverySet.sqlite.migrationProof, {
      completed: true,
      sourceUnchanged: true,
      fromSchemaVersion: LEGACY_SCHEMA_VERSION,
      toSchemaVersion: LATEST_SCHEMA_VERSION,
      openedWith: "openDatabase",
    });
    assert.deepEqual(fs.readFileSync(fixture.dbPath), sourceBefore);

    const restoredRoot = path.join(fixture.root, "restored-schema-24");
    const restored = await restoreBackup(
      backup.destinationPath,
      restoredRoot,
      { passphrase: PASSPHRASE },
    );
    assert.equal(restored.recoverySet.sqlite.schemaVersion, LEGACY_SCHEMA_VERSION);
    const restoredDb = new DatabaseSync(
      path.join(restoredRoot, "data", "runtime.sqlite"),
      { readOnly: true },
    );
    try {
      assert.equal(
        restoredDb.prepare("SELECT MAX(version) AS version FROM schema_migrations").get().version,
        LEGACY_SCHEMA_VERSION,
      );
      assert.equal(
        restoredDb.prepare("SELECT name FROM ventures WHERE id = ?")
          .get("venture-digital-products").name,
        "Recovery proof",
      );
    } finally {
      restoredDb.close();
    }
    assert.deepEqual(fs.readFileSync(fixture.dbPath), sourceBefore);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("backup compatibility names both legacy schemas, the last release, and current schema explicitly", () => {
  assert.deepEqual(LEGACY_SUPPORTED_SCHEMA_VERSIONS, [24, 25]);
  assert.equal(LEGACY_SCHEMA_VERSION, 24);
  assert.equal(LEGACY_SCHEMA_25_VERSION, 25);
  assert.equal(LAST_RELEASED_SCHEMA_VERSION, 26);
  assert.equal(CURRENT_ARCHIVE_SCHEMA_VERSION, 27);
  assert.deepEqual(ARCHIVE_SCHEMA_COMPATIBILITY_LABELS, {
    24: "supported_legacy_24",
    25: "supported_legacy_25",
    26: "supported_last_release",
    27: "current_ready",
  });
});

test("legacy schema 25 is accepted only after disposable migration without changing its bytes", () => {
  const fixture = createRecoveryFixture("legacy-schema-25");
  try {
    downgradeDatabaseToLegacySchema25(fixture.dbPath);
    const sourceBefore = fs.readFileSync(fixture.dbPath);
    const proof = validateSqliteDatabase(fixture.dbPath);
    assert.equal(proof.schemaVersion, LEGACY_SCHEMA_25_VERSION);
    assert.equal(
      proof.compatibility,
      ARCHIVE_SCHEMA_COMPATIBILITY_LABELS[LEGACY_SCHEMA_25_VERSION],
    );
    assert.deepEqual(proof.migrationProof, {
      completed: true,
      sourceUnchanged: true,
      fromSchemaVersion: LEGACY_SCHEMA_25_VERSION,
      toSchemaVersion: CURRENT_ARCHIVE_SCHEMA_VERSION,
      openedWith: "openDatabase",
    });
    assert.deepEqual(fs.readFileSync(fixture.dbPath), sourceBefore);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("backup compatibility rejects schemas outside the explicit release window", async () => {
  for (const [name, version] of [
    ["unsupported-older", LEGACY_SCHEMA_VERSION - 1],
    ["unsupported-newer", LATEST_SCHEMA_VERSION + 1],
  ]) {
    const fixture = createRecoveryFixture(name);
    try {
      if (version < LEGACY_SCHEMA_VERSION) {
        downgradeDatabaseToLegacySchema24(fixture.dbPath);
      }
      const db = new DatabaseSync(fixture.dbPath);
      try {
        if (version < LEGACY_SCHEMA_VERSION) {
          db.prepare("DELETE FROM schema_migrations WHERE version = ?")
            .run(LEGACY_SCHEMA_VERSION);
        } else {
          db.prepare(
            "INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)",
          ).run(version, "unsupported-test-version", "2026-07-29T00:00:00.000Z");
        }
        db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
        db.prepare("PRAGMA journal_mode = DELETE").get();
      } finally {
        db.close();
      }
      await assert.rejects(
        createRecoverySet(fixture),
        /not a supported archive schema/i,
      );
    } finally {
      fs.rmSync(fixture.root, { recursive: true, force: true });
    }
  }
});

test("legacy schema 24 is accepted only when its migrated copy meets the exact database contract", () => {
  for (const [name, damage, expected] of [
    [
      "released-missing-column",
      (db) => db.exec("ALTER TABLE accounting_entries DROP COLUMN metadata"),
      /accounting_entries.*missing|accounting_entries.*exact supported definition/i,
    ],
    [
      "released-missing-index",
      (db) => db.exec("DROP INDEX idx_accounting_entries_occurred"),
      /missing required index idx_accounting_entries_occurred/i,
    ],
    [
      "released-altered-trigger",
      (db) => db.exec(`
        DROP TRIGGER trg_tasks_venture_match_insert;
        CREATE TRIGGER trg_tasks_venture_match_insert
        BEFORE INSERT ON tasks
        WHEN 0
        BEGIN
          SELECT RAISE(ABORT, 'Task venture ownership is required.');
        END;
      `),
      /trg_tasks_venture_match_insert.*exact supported definition/i,
    ],
    [
      "released-missing-trigger",
      (db) => db.exec("DROP TRIGGER trg_accounting_reconciled_immutable_update"),
      /missing required (?:fail-closed )?trigger trg_accounting_reconciled_immutable_update/i,
    ],
  ]) {
    const fixture = createRecoveryFixture(name);
    try {
      downgradeDatabaseToLegacySchema24(fixture.dbPath);
      const db = new DatabaseSync(fixture.dbPath);
      try {
        damage(db);
        db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
        db.prepare("PRAGMA journal_mode = DELETE").get();
      } finally {
        db.close();
      }
      const sourceBefore = fs.readFileSync(fixture.dbPath);
      assert.throws(
        () => validateSqliteDatabase(fixture.dbPath),
        expected,
      );
      assert.deepEqual(fs.readFileSync(fixture.dbPath), sourceBefore);
    } finally {
      fs.rmSync(fixture.root, { recursive: true, force: true });
    }
  }
});

test("recovery-set creation fails closed when source startup proof is incomplete", async () => {
  for (const [name, mutate, expected] of [
    [
      "missing-package",
      (fixture) => fs.rmSync(path.join(fixture.sourceRoot, "package.json")),
      /missing required file package\.json/i,
    ],
    [
      "missing-lock",
      (fixture) => fs.rmSync(path.join(fixture.sourceRoot, "package-lock.json")),
      /missing required file package-lock\.json/i,
    ],
    [
      "missing-renderer-lock",
      (fixture) => fs.rmSync(path.join(fixture.sourceRoot, "requirements-renderer-lock.txt")),
      /missing required file requirements-renderer-lock\.txt/i,
    ],
    [
      "missing-server",
      (fixture) => fs.rmSync(path.join(fixture.sourceRoot, "src", "server.js")),
      /missing required file src\/server\.js/i,
    ],
    [
      "missing-dashboard",
      (fixture) => fs.rmSync(path.join(fixture.sourceRoot, "public", "app.js")),
      /missing required file public\/app\.js/i,
    ],
    [
      "missing-renderer",
      (fixture) => fs.rmSync(
        path.join(fixture.sourceRoot, "scripts", "render-digital-product-kit.py"),
      ),
      /missing required file scripts\/render-digital-product-kit\.py/i,
    ],
    [
      "missing-renderer-bootstrap-module",
      (fixture) => fs.rmSync(
        path.join(fixture.sourceRoot, "src", "runtime", "renderer-environment.js"),
      ),
      /missing required file src\/runtime\/renderer-environment\.js/i,
    ],
    [
      "missing-renderer-check-command",
      (fixture) => {
        const packagePath = path.join(fixture.sourceRoot, "package.json");
        const packageJson = JSON.parse(fs.readFileSync(packagePath, "utf8"));
        delete packageJson.scripts["renderer:check"];
        fs.writeFileSync(packagePath, JSON.stringify(packageJson), "utf8");
      },
      /must expose exact renderer scripts \(renderer:check\)/i,
    ],
    [
      "corrupt-lock",
      (fixture) => fs.writeFileSync(
        path.join(fixture.sourceRoot, "package-lock.json"),
        "{not-json",
        "utf8",
      ),
      /package-lock\.json is not valid JSON/i,
    ],
    [
      "mismatched-lock-dependencies",
      (fixture) => {
        const lockPath = path.join(fixture.sourceRoot, "package-lock.json");
        const lock = JSON.parse(fs.readFileSync(lockPath, "utf8"));
        delete lock.packages[""].dependencies.openai;
        fs.writeFileSync(lockPath, JSON.stringify(lock), "utf8");
      },
      /does not match package\.json dependency metadata/i,
    ],
    [
      "missing-configured-start",
      (fixture) => {
        const packagePath = path.join(fixture.sourceRoot, "package.json");
        const packageJson = JSON.parse(fs.readFileSync(packagePath, "utf8"));
        packageJson.scripts.start = "node src/not-restored.js";
        fs.writeFileSync(packagePath, JSON.stringify(packageJson), "utf8");
      },
      /missing its configured start path src\/not-restored\.js/i,
    ],
  ]) {
    const fixture = createRecoveryFixture(name);
    try {
      mutate(fixture);
      await assert.rejects(createRecoverySet(fixture), expected);
    } finally {
      fs.rmSync(fixture.root, { recursive: true, force: true });
    }
  }
});

test("backup verification rejects internally valid SQLite that is not Pantheon", async () => {
  const root = tempRoot("non-pantheon-database");
  try {
    const dbPath = path.join(root, "generic.sqlite");
    const db = new DatabaseSync(dbPath);
    db.exec("CREATE TABLE proof (value TEXT NOT NULL); INSERT INTO proof VALUES ('valid sqlite');");
    db.close();
    await assert.rejects(
      createBackup({
        kind: "database",
        dbPath,
        destinationRoot: path.join(root, "backups"),
        passphrase: PASSPHRASE,
      }),
      /valid, compatible Pantheon database|schema_migrations/i,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("backup verification rejects Pantheon data when an ownership trigger is missing", async () => {
  const root = tempRoot("unsafe-pantheon-database");
  try {
    const dbPath = path.join(root, "runtime.sqlite");
    const db = openDatabase(dbPath);
    seedDatabase(db);
    db.exec("DROP TRIGGER trg_tasks_venture_match_insert");
    db.close();
    await assert.rejects(
      createBackup({
        kind: "database",
        dbPath,
        destinationRoot: path.join(root, "backups"),
        passphrase: PASSPHRASE,
      }),
      /missing required fail-closed trigger/i,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("recovery verification rejects encrypted tampering and post-restore inventory drift", async () => {
  const fixture = createRecoveryFixture("tamper");
  try {
    const backup = await createRecoverySet(fixture);
    const tamperedPath = path.join(fixture.destinationRoot, "tampered.jbackup");
    const tampered = Buffer.from(fs.readFileSync(backup.destinationPath));
    tampered[tampered.length - 24] ^= 1;
    fs.writeFileSync(tamperedPath, tampered);
    await assert.rejects(
      verifyBackup(tamperedPath, { passphrase: PASSPHRASE }),
      /could not be decrypted or authenticated/,
    );

    const occupiedDestination = path.join(fixture.root, "occupied");
    fs.mkdirSync(occupiedDestination);
    fs.writeFileSync(path.join(occupiedDestination, "keep.txt"), "existing destination");
    await assert.rejects(
      restoreBackup(backup.destinationPath, occupiedDestination, { passphrase: PASSPHRASE }),
      /destination already exists/,
    );
    assert.equal(
      fs.readFileSync(path.join(occupiedDestination, "keep.txt"), "utf8"),
      "existing destination",
    );

    const restoredRoot = path.join(fixture.root, "restored");
    await restoreBackup(backup.destinationPath, restoredRoot, { passphrase: PASSPHRASE });
    fs.writeFileSync(path.join(restoredRoot, "src", "unmanifested-file.txt"), "unexpected");
    assert.throws(
      () => validateRecoverySetDirectory(restoredRoot),
      /inventory does not match/,
    );
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("Pantheon backup passphrase takes precedence while the Jarvis alias remains compatible", () => {
  const previousPantheon = process.env.PANTHEON_BACKUP_PASSPHRASE;
  const previousJarvis = process.env.JARVIS_BACKUP_PASSPHRASE;
  try {
    process.env.PANTHEON_BACKUP_PASSPHRASE = "pantheon-preferred-passphrase";
    process.env.JARVIS_BACKUP_PASSPHRASE = "jarvis-legacy-passphrase-value";
    assert.equal(requiredPassphrase(), "pantheon-preferred-passphrase");

    delete process.env.PANTHEON_BACKUP_PASSPHRASE;
    assert.equal(requiredPassphrase(), "jarvis-legacy-passphrase-value");
  } finally {
    if (previousPantheon === undefined) delete process.env.PANTHEON_BACKUP_PASSPHRASE;
    else process.env.PANTHEON_BACKUP_PASSPHRASE = previousPantheon;
    if (previousJarvis === undefined) delete process.env.JARVIS_BACKUP_PASSPHRASE;
    else process.env.JARVIS_BACKUP_PASSPHRASE = previousJarvis;
  }
});

test("backup and restore CLIs create one coherent set by default and support verify-only", async () => {
  const fixture = createRecoveryFixture("cli");
  try {
    const environment = {
      ...process.env,
      PANTHEON_BACKUP_PASSPHRASE: PASSPHRASE,
      JARVIS_BACKUP_PASSPHRASE: "",
    };
    const backupRun = spawnSync(
      process.execPath,
      [
        path.join(__dirname, "..", "scripts", "backup-runtime.js"),
        "--kind", "all",
        "--destination", fixture.destinationRoot,
        "--source-root", fixture.sourceRoot,
        "--database", fixture.dbPath,
        "--artifacts", fixture.artifactRoot,
        "--approval-packs", fixture.approvalPackRoot,
        "--private-operator", fixture.privateOperatorRoot,
      ],
      {
        encoding: "utf8",
        env: environment,
        windowsHide: true,
        timeout: 120_000,
      },
    );
    assert.equal(backupRun.status, 0, backupRun.stderr);
    const backupReport = JSON.parse(backupRun.stdout);
    assert.equal(backupReport.ok, true);
    assert.equal(backupReport.mode, "coherent-recovery-set");
    assert.equal(backupReport.backups.length, 1);
    assert.equal(backupReport.backups[0].kind, "set");
    assert.equal(backupReport.backups[0].verification.verified, true);

    const backupPath = backupReport.backups[0].destinationPath;
    const verifyRun = spawnSync(
      process.execPath,
      [
        path.join(__dirname, "..", "scripts", "restore-runtime.js"),
        "--source", backupPath,
        "--verify-only",
      ],
      {
        encoding: "utf8",
        env: environment,
        windowsHide: true,
        timeout: 120_000,
      },
    );
    assert.equal(verifyRun.status, 0, verifyRun.stderr);
    const verifyReport = JSON.parse(verifyRun.stdout);
    assert.equal(verifyReport.ok, true);
    assert.equal(verifyReport.mode, "verify-only");
    assert.equal(verifyReport.recoverySet.sqlite.quickCheck, "ok");

    const restoredRoot = path.join(fixture.root, "cli-restored");
    const restoreRun = spawnSync(
      process.execPath,
      [
        path.join(__dirname, "..", "scripts", "restore-runtime.js"),
        "--source", backupPath,
        "--destination", restoredRoot,
      ],
      {
        encoding: "utf8",
        env: environment,
        windowsHide: true,
        timeout: 120_000,
      },
    );
    assert.equal(restoreRun.status, 0, restoreRun.stderr);
    assert.equal(fs.existsSync(path.join(restoredRoot, "data", "runtime.sqlite")), true);
    assert.equal(fs.existsSync(path.join(restoredRoot, "private", "operator-reference.txt")), true);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});
