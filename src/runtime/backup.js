const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");
const { pipeline } = require("node:stream/promises");
const { DatabaseSync, backup } = require("node:sqlite");
const CONFIG = require("../config");

const MAGIC = Buffer.from("JARVISBK1", "ascii");
const AUTH_TAG_BYTES = 16;
const MAX_HEADER_BYTES = 64 * 1024;
const MAX_MANIFEST_BYTES = 16 * 1024 * 1024;
const RECOVERY_SET_FORMAT = "pantheon-recovery-set";
const RECOVERY_SET_VERSION = 1;
const RECOVERY_METADATA_DIR = ".pantheon-recovery";
const RECOVERY_MANIFEST_PATH = `${RECOVERY_METADATA_DIR}/manifest.json`;
const RECOVERY_VERIFICATION_PATH = `${RECOVERY_METADATA_DIR}/restore-verification.json`;
const BACKUP_KINDS = new Set(["source", "database", "artifacts", "set", "file"]);

function preferredEnvironment(suffix) {
  const preferred = process.env[`PANTHEON_${suffix}`];
  if (preferred !== undefined && preferred !== "") return preferred;
  const legacy = process.env[`JARVIS_${suffix}`];
  return legacy !== undefined && legacy !== "" ? legacy : undefined;
}

function requiredPassphrase(value = preferredEnvironment("BACKUP_PASSPHRASE")) {
  if (!value || value.length < 16) {
    throw new Error(
      "PANTHEON_BACKUP_PASSPHRASE must contain at least 16 characters "
      + "(JARVIS_BACKUP_PASSPHRASE remains supported as a compatibility alias).",
    );
  }
  return value;
}

function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  const fd = fs.openSync(filePath, "r");
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    let bytesRead = 0;
    do {
      bytesRead = fs.readSync(fd, buffer, 0, buffer.length, null);
      if (bytesRead) hash.update(buffer.subarray(0, bytesRead));
    } while (bytesRead);
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest("hex");
}

function readExact(fd, buffer, position) {
  let offset = 0;
  while (offset < buffer.length) {
    const bytesRead = fs.readSync(fd, buffer, offset, buffer.length - offset, position + offset);
    if (!bytesRead) throw new Error("Backup is truncated.");
    offset += bytesRead;
  }
}

function validateHeader(header) {
  if (!header || typeof header !== "object") throw new Error("Invalid backup header.");
  if (header.version !== 1 || header.algorithm !== "aes-256-gcm" || header.keyDerivation !== "scrypt") {
    throw new Error("Unsupported backup format.");
  }
  if (!BACKUP_KINDS.has(header.kind)) throw new Error("Invalid backup kind.");
  if (!Number.isSafeInteger(header.payloadBytes) || header.payloadBytes < 0) throw new Error("Invalid backup payload size.");
  if (!/^[a-f0-9]{64}$/i.test(String(header.payloadSha256 || ""))) throw new Error("Invalid backup payload hash.");
  if (!Number.isFinite(Date.parse(header.createdAt))) throw new Error("Invalid backup creation time.");
  const salt = Buffer.from(String(header.salt || ""), "base64");
  const iv = Buffer.from(String(header.iv || ""), "base64");
  if (salt.length !== 16 || iv.length !== 12) throw new Error("Invalid backup encryption parameters.");
  if (header.kind === "set" && !/^[a-f0-9-]{32,64}$/i.test(String(header.setId || ""))) {
    throw new Error("Invalid recovery-set identifier.");
  }
  if (header.kind === "set" && !/^[a-f0-9]{64}$/i.test(String(header.manifestSha256 || ""))) {
    throw new Error("Invalid recovery-set manifest hash.");
  }
  return header;
}

function readEncryptedHeader(filePath) {
  const stats = fs.statSync(filePath);
  if (stats.size < MAGIC.length + 4 + 2 + AUTH_TAG_BYTES) throw new Error("Backup is truncated.");
  const fd = fs.openSync(filePath, "r");
  try {
    const prefix = Buffer.allocUnsafe(MAGIC.length + 4);
    readExact(fd, prefix, 0);
    if (!prefix.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error("Unsupported backup format.");
    const headerLength = prefix.readUInt32BE(MAGIC.length);
    if (headerLength < 2 || headerLength > MAX_HEADER_BYTES) throw new Error("Invalid backup header.");
    const headerBytes = Buffer.allocUnsafe(headerLength);
    readExact(fd, headerBytes, prefix.length);
    let header;
    try {
      header = JSON.parse(headerBytes.toString("utf8"));
    } catch {
      throw new Error("Invalid backup header.");
    }
    validateHeader(header);
    const payloadOffset = prefix.length + headerLength;
    if (stats.size - AUTH_TAG_BYTES < payloadOffset) throw new Error("Backup payload is truncated.");
    return { header, headerBytes, payloadOffset };
  } finally {
    fs.closeSync(fd);
  }
}

function decryptPayload(sourcePath, options = {}) {
  const passphrase = requiredPassphrase(options.passphrase);
  const { header, headerBytes, payloadOffset } = readEncryptedHeader(sourcePath);
  const stats = fs.statSync(sourcePath);
  const payloadLength = stats.size - AUTH_TAG_BYTES - payloadOffset;
  if (payloadLength < 0) throw new Error("Backup payload is truncated.");
  const fd = fs.openSync(sourcePath, "r");
  const authTag = Buffer.allocUnsafe(AUTH_TAG_BYTES);
  const key = crypto.scryptSync(passphrase, Buffer.from(header.salt, "base64"), 32);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(header.iv, "base64"));
  const hash = crypto.createHash("sha256");
  const outputFd = options.destinationPath ? fs.openSync(options.destinationPath, "wx") : null;
  let restoredBytes = 0;
  try {
    readExact(fd, authTag, stats.size - AUTH_TAG_BYTES);
    decipher.setAAD(headerBytes);
    decipher.setAuthTag(authTag);
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    let position = payloadOffset;
    const payloadEnd = payloadOffset + payloadLength;
    while (position < payloadEnd) {
      const requested = Math.min(buffer.length, payloadEnd - position);
      const bytesRead = fs.readSync(fd, buffer, 0, requested, position);
      if (!bytesRead) throw new Error("Backup payload is truncated.");
      position += bytesRead;
      const plain = decipher.update(buffer.subarray(0, bytesRead));
      if (plain.length) {
        hash.update(plain);
        restoredBytes += plain.length;
        if (outputFd !== null) fs.writeSync(outputFd, plain);
      }
    }
    const final = decipher.final();
    if (final.length) {
      hash.update(final);
      restoredBytes += final.length;
      if (outputFd !== null) fs.writeSync(outputFd, final);
    }
    if (outputFd !== null) fs.fsyncSync(outputFd);
  } catch (error) {
    throw new Error(`Backup could not be decrypted or authenticated: ${error.message}`);
  } finally {
    if (outputFd !== null) fs.closeSync(outputFd);
    fs.closeSync(fd);
  }
  const restoredSha256 = hash.digest("hex");
  if (restoredBytes !== header.payloadBytes || restoredSha256 !== header.payloadSha256) {
    throw new Error("Restored backup does not match its authenticated manifest.");
  }
  return { ...header, restoredBytes, restoredSha256 };
}

function authenticateEncryptedBackup(filePath, options = {}) {
  return decryptPayload(filePath, options);
}

async function encryptFile(sourcePath, destinationPath, options = {}) {
  const passphrase = requiredPassphrase(options.passphrase);
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const header = {
    version: 1,
    algorithm: "aes-256-gcm",
    keyDerivation: "scrypt",
    createdAt: options.createdAt || new Date().toISOString(),
    kind: options.kind || "file",
    payloadBytes: fs.statSync(sourcePath).size,
    payloadSha256: sha256File(sourcePath),
    salt: salt.toString("base64"),
    iv: iv.toString("base64"),
    ...(options.setId ? { setId: options.setId } : {}),
    ...(options.manifestSha256 ? { manifestSha256: options.manifestSha256 } : {}),
  };
  validateHeader(header);
  const headerBytes = Buffer.from(JSON.stringify(header), "utf8");
  const headerLength = Buffer.allocUnsafe(4);
  headerLength.writeUInt32BE(headerBytes.length);
  const key = crypto.scryptSync(passphrase, salt, 32);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(headerBytes);

  const destination = path.resolve(destinationPath);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  if (fs.existsSync(destination)) throw new Error(`Backup destination already exists: ${destination}`);
  const temporaryPath = path.join(
    path.dirname(destination),
    `.${path.basename(destination)}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.partial`,
  );
  try {
    fs.writeFileSync(temporaryPath, Buffer.concat([MAGIC, headerLength, headerBytes]), { flag: "wx" });
    await pipeline(fs.createReadStream(sourcePath), cipher, fs.createWriteStream(temporaryPath, { flags: "a" }));
    fs.appendFileSync(temporaryPath, cipher.getAuthTag());
    const fd = fs.openSync(temporaryPath, "r+");
    try {
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    authenticateEncryptedBackup(temporaryPath, { passphrase });
    fs.renameSync(temporaryPath, destination);
    return { ...header, destinationPath: destination, backupSha256: sha256File(destination) };
  } catch (error) {
    fs.rmSync(temporaryPath, { force: true });
    throw error;
  }
}

async function decryptFile(sourcePath, destinationPath, options = {}) {
  const destination = path.resolve(destinationPath);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const temporaryPath = path.join(
    path.dirname(destination),
    `.${path.basename(destination)}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.partial`,
  );
  try {
    const proof = decryptPayload(sourcePath, { ...options, destinationPath: temporaryPath });
    if (fs.existsSync(destination)) fs.rmSync(destination, { force: true });
    fs.renameSync(temporaryPath, destination);
    return { ...proof, restoredPath: destination };
  } catch (error) {
    fs.rmSync(temporaryPath, { force: true });
    throw error;
  }
}

function tarExecutable() {
  return process.platform === "win32" ? "tar.exe" : "tar";
}

function runTar(args) {
  const result = spawnSync(tarExecutable(), args, { encoding: "utf8", windowsHide: true });
  if (result.status !== 0) {
    throw new Error(`Archive command failed: ${(result.stderr || result.stdout || "unknown error").trim()}`);
  }
  return result.stdout || "";
}

function toArchivePath(value) {
  return value.split(path.sep).join("/");
}

function relativePathWithin(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  if (!relative || relative === ".") return ".";
  if (relative.startsWith("..") || path.isAbsolute(relative)) return null;
  return toArchivePath(relative);
}

function createSourceArchive(sourceRoot, archivePath, options = {}) {
  const root = path.resolve(sourceRoot);
  const excludes = new Set([
    ".git", "*/.git", "node_modules", "*/node_modules", ".playwright-cli",
    "tmp", "output", "backups", "data", "private", "*/private", RECOVERY_METADATA_DIR,
  ]);
  for (const candidate of [options.artifactRoot, options.dbPath, options.backupDestination].filter(Boolean)) {
    const relative = relativePathWithin(root, candidate);
    if (!relative) continue;
    if (relative === ".") throw new Error("Source backup root overlaps a runtime or backup destination.");
    excludes.add(relative);
    if (candidate === options.dbPath) {
      excludes.add(`${relative}-wal`);
      excludes.add(`${relative}-shm`);
    }
  }
  const args = ["-cf", archivePath, ...[...excludes].map((item) => `--exclude=${item}`), "-C", root, "."];
  runTar(args);
  return archivePath;
}

function copyDirectoryContents(source, destination) {
  fs.mkdirSync(destination, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) {
      throw new Error(`Managed backup data cannot contain symbolic links: ${path.join(source, entry.name)}`);
    }
    fs.cpSync(path.join(source, entry.name), path.join(destination, entry.name), {
      recursive: true,
      dereference: false,
      force: false,
      errorOnExist: true,
    });
  }
}

function defaultArtifactRoot(sourceRoot) {
  return path.resolve(sourceRoot) === path.resolve(CONFIG.rootDir)
    ? path.resolve(CONFIG.artifactRoot)
    : path.join(path.resolve(sourceRoot), "data", "artifacts");
}

function createArtifactArchive(sourceRoot, archivePath, options = {}) {
  const root = path.resolve(sourceRoot);
  const artifactRoot = path.resolve(options.artifactRoot || defaultArtifactRoot(root));
  const approvalPackRoot = path.resolve(
    options.approvalPackRoot
      || preferredEnvironment("APPROVAL_PACK_DIR")
      || path.join(root, "output", "pdf"),
  );
  const stageRoot = fs.mkdtempSync(path.join(path.dirname(path.resolve(archivePath)), "pantheon-artifacts-stage-"));
  const included = [];
  try {
    if (fs.existsSync(artifactRoot)) {
      copyDirectoryContents(artifactRoot, path.join(stageRoot, "artifact-root"));
      included.push("artifact-root");
    }
    const packsAreInsideArtifacts = relativePathWithin(artifactRoot, approvalPackRoot) !== null;
    if (fs.existsSync(approvalPackRoot) && !packsAreInsideArtifacts) {
      copyDirectoryContents(approvalPackRoot, path.join(stageRoot, "approval-packs"));
      included.push("approval-packs");
    }
    if (!included.length) throw new Error("No managed runtime artifacts exist to back up.");
    fs.writeFileSync(
      path.join(stageRoot, "manifest.json"),
      JSON.stringify({ version: 1, kind: "artifacts", included }, null, 2),
      "utf8",
    );
    runTar(["-cf", archivePath, "-C", stageRoot, "."]);
    return archivePath;
  } finally {
    fs.rmSync(stageRoot, { recursive: true, force: true });
  }
}

function validateSqliteDatabase(dbPath) {
  let db;
  try {
    db = new DatabaseSync(dbPath, { readOnly: true });
    const quick = db.prepare("PRAGMA quick_check").all();
    const integrity = db.prepare("PRAGMA integrity_check").all();
    const foreignKeys = db.prepare("PRAGMA foreign_key_check").all();
    const quickOk = quick.length === 1 && Object.values(quick[0])[0] === "ok";
    const integrityOk = integrity.length === 1 && Object.values(integrity[0])[0] === "ok";
    if (!quickOk || !integrityOk || foreignKeys.length) {
      throw new Error(`SQLite validation failed (quick=${quickOk}, integrity=${integrityOk}, foreignKeys=${foreignKeys.length}).`);
    }
    return { quickCheck: "ok", integrityCheck: "ok", foreignKeyViolations: 0 };
  } catch (error) {
    throw new Error(`Database backup is not a valid, consistent SQLite database: ${error.message}`);
  } finally {
    if (db) db.close();
  }
}

function removeSqliteSidecars(dbPath) {
  for (const suffix of ["-wal", "-shm"]) {
    const sidecar = `${dbPath}${suffix}`;
    if (fs.existsSync(sidecar)) fs.rmSync(sidecar, { force: true });
  }
}

function normalizeStandaloneSqliteDatabase(dbPath) {
  let db;
  try {
    db = new DatabaseSync(dbPath);
    db.exec("PRAGMA busy_timeout = 5000;");
    db.exec("PRAGMA wal_checkpoint(TRUNCATE);");
    const row = db.prepare("PRAGMA journal_mode = DELETE").get();
    const mode = String(Object.values(row || {})[0] || "").toLowerCase();
    if (mode !== "delete") {
      throw new Error(`SQLite journal mode remained ${mode || "unknown"}.`);
    }
  } catch (error) {
    throw new Error(`Database backup could not be made standalone: ${error.message}`);
  } finally {
    if (db) db.close();
  }
  removeSqliteSidecars(dbPath);
  return validateSqliteDatabase(dbPath);
}

async function createDatabaseSnapshot(dbPath, snapshotPath) {
  if (!fs.existsSync(dbPath)) throw new Error(`Runtime database does not exist: ${dbPath}`);
  fs.mkdirSync(path.dirname(snapshotPath), { recursive: true });
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    await backup(db, snapshotPath);
  } finally {
    db.close();
  }
  normalizeStandaloneSqliteDatabase(snapshotPath);
  return snapshotPath;
}

function isSafeRelativeArchivePath(value) {
  const normalized = String(value || "").replace(/\\/g, "/").replace(/^\.\//, "");
  if (!normalized || normalized === ".") return false;
  const parts = normalized.split("/").filter(Boolean);
  return !path.posix.isAbsolute(normalized)
    && !/^[a-zA-Z]:/.test(normalized)
    && !parts.includes("..");
}

function recoveryComponentForPath(relativePath) {
  const normalized = toArchivePath(relativePath);
  if (normalized === "data/runtime.sqlite") return "database";
  if (normalized.startsWith("data/artifacts/")) return "runtimeArtifacts";
  if (normalized.startsWith("output/pdf/")) return "approvalPacks";
  if (normalized.startsWith("private/")) return "privateOperatorReferences";
  return "source";
}

function inventoryDirectory(root, options = {}) {
  const base = path.resolve(root);
  const excludedPrefixes = new Set(
    (options.excludePrefixes || [RECOVERY_METADATA_DIR])
      .map((value) => String(value).replace(/\\/g, "/").replace(/\/+$/, "")),
  );
  const inventory = [];

  function visit(directory) {
    const entries = fs.readdirSync(directory, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const absolutePath = path.join(directory, entry.name);
      const relativePath = toArchivePath(path.relative(base, absolutePath));
      if ([...excludedPrefixes].some((prefix) => relativePath === prefix || relativePath.startsWith(`${prefix}/`))) {
        continue;
      }
      const stats = fs.lstatSync(absolutePath);
      if (stats.isSymbolicLink()) {
        throw new Error(`Recovery data cannot contain symbolic links: ${relativePath}`);
      }
      if (stats.isDirectory()) {
        visit(absolutePath);
        continue;
      }
      if (!stats.isFile()) {
        throw new Error(`Recovery data contains an unsupported filesystem entry: ${relativePath}`);
      }
      inventory.push({
        path: relativePath,
        bytes: stats.size,
        sha256: sha256File(absolutePath),
        component: recoveryComponentForPath(relativePath),
      });
    }
  }

  visit(base);
  return inventory.sort((left, right) => left.path.localeCompare(right.path));
}

function summarizeInventory(inventory, component) {
  const records = inventory.filter((item) => item.component === component);
  const digest = crypto.createHash("sha256");
  for (const item of records) {
    digest.update(`${item.path}\0${item.bytes}\0${item.sha256}\n`, "utf8");
  }
  return {
    fileCount: records.length,
    bytes: records.reduce((sum, item) => sum + item.bytes, 0),
    inventorySha256: digest.digest("hex"),
  };
}

function defaultPrivateOperatorRoot(sourceRoot) {
  return path.resolve(
    preferredEnvironment("PRIVATE_OPERATOR_DIR")
      || path.join(path.resolve(sourceRoot), "private"),
  );
}

async function createRecoverySetArchive(sourceRoot, archivePath, options = {}) {
  const root = path.resolve(sourceRoot);
  const dbPath = path.resolve(options.dbPath || CONFIG.dbPath);
  const artifactRoot = path.resolve(options.artifactRoot || defaultArtifactRoot(root));
  const approvalPackRoot = path.resolve(
    options.approvalPackRoot
      || preferredEnvironment("APPROVAL_PACK_DIR")
      || path.join(root, "output", "pdf"),
  );
  const privateOperatorRoot = path.resolve(
    options.privateOperatorRoot || defaultPrivateOperatorRoot(root),
  );
  const setId = options.setId || crypto.randomUUID();
  const createdAt = options.createdAt || new Date().toISOString();
  const stageRoot = fs.mkdtempSync(path.join(path.dirname(path.resolve(archivePath)), "pantheon-set-stage-"));
  const sourceArchive = path.join(path.dirname(stageRoot), `${path.basename(stageRoot)}-source.tar`);
  try {
    createSourceArchive(root, sourceArchive, {
      artifactRoot,
      dbPath,
      backupDestination: options.backupDestination,
    });
    validateArchiveEntries(sourceArchive, "source");
    runTar(["-xf", sourceArchive, "-C", stageRoot]);

    const restoredDbPath = path.join(stageRoot, "data", "runtime.sqlite");
    await createDatabaseSnapshot(dbPath, restoredDbPath);

    const restoredArtifactRoot = path.join(stageRoot, "data", "artifacts");
    fs.mkdirSync(restoredArtifactRoot, { recursive: true });
    const artifactsPresent = fs.existsSync(artifactRoot);
    if (artifactsPresent) copyDirectoryContents(artifactRoot, restoredArtifactRoot);

    const restoredPackRoot = path.join(stageRoot, "output", "pdf");
    fs.mkdirSync(restoredPackRoot, { recursive: true });
    const packsInsideArtifacts = pathsOverlap(artifactRoot, approvalPackRoot)
      && relativePathWithin(artifactRoot, approvalPackRoot) !== null;
    const approvalPacksPresent = fs.existsSync(approvalPackRoot) && !packsInsideArtifacts;
    if (approvalPacksPresent) copyDirectoryContents(approvalPackRoot, restoredPackRoot);

    const restoredPrivateRoot = path.join(stageRoot, "private");
    fs.mkdirSync(restoredPrivateRoot, { recursive: true });
    const privateOperatorReferencesPresent = fs.existsSync(privateOperatorRoot);
    if (privateOperatorReferencesPresent) copyDirectoryContents(privateOperatorRoot, restoredPrivateRoot);

    const inventory = inventoryDirectory(stageRoot);
    const components = {
      source: {
        required: true,
        present: true,
        restorePath: ".",
        ...summarizeInventory(inventory, "source"),
      },
      database: {
        required: true,
        present: true,
        restorePath: "data/runtime.sqlite",
        ...summarizeInventory(inventory, "database"),
        sqlite: validateSqliteDatabase(restoredDbPath),
      },
      runtimeArtifacts: {
        required: false,
        present: artifactsPresent,
        restorePath: "data/artifacts",
        ...summarizeInventory(inventory, "runtimeArtifacts"),
      },
      approvalPacks: {
        required: false,
        present: approvalPacksPresent,
        restorePath: "output/pdf",
        ...summarizeInventory(inventory, "approvalPacks"),
      },
      privateOperatorReferences: {
        required: false,
        present: privateOperatorReferencesPresent,
        restorePath: "private",
        ...summarizeInventory(inventory, "privateOperatorReferences"),
      },
    };
    const manifest = {
      format: RECOVERY_SET_FORMAT,
      version: RECOVERY_SET_VERSION,
      setId,
      createdAt,
      product: "Pantheon",
      restoreLayout: "ready-workspace",
      components,
      inventory,
    };
    const metadataRoot = path.join(stageRoot, RECOVERY_METADATA_DIR);
    fs.mkdirSync(metadataRoot, { recursive: true });
    fs.writeFileSync(
      path.join(stageRoot, RECOVERY_MANIFEST_PATH),
      `${JSON.stringify(manifest, null, 2)}\n`,
      { encoding: "utf8", flag: "wx" },
    );
    runTar(["-cf", archivePath, "-C", stageRoot, "."]);
    return {
      archivePath,
      manifest,
      manifestSha256: sha256File(path.join(stageRoot, RECOVERY_MANIFEST_PATH)),
    };
  } finally {
    fs.rmSync(sourceArchive, { force: true });
    fs.rmSync(stageRoot, { recursive: true, force: true });
  }
}

function parseRecoveryManifest(restoredRoot) {
  const manifestPath = path.join(path.resolve(restoredRoot), RECOVERY_MANIFEST_PATH);
  if (!fs.existsSync(manifestPath)) throw new Error("Recovery set is missing its manifest.");
  const stats = fs.statSync(manifestPath);
  if (!stats.isFile() || stats.size < 2 || stats.size > MAX_MANIFEST_BYTES) {
    throw new Error("Recovery-set manifest size is invalid.");
  }
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  } catch {
    throw new Error("Recovery-set manifest is not valid JSON.");
  }
  if (manifest?.format !== RECOVERY_SET_FORMAT || manifest?.version !== RECOVERY_SET_VERSION) {
    throw new Error("Unsupported recovery-set manifest.");
  }
  if (!/^[a-f0-9-]{32,64}$/i.test(String(manifest.setId || ""))) {
    throw new Error("Recovery-set manifest has an invalid identifier.");
  }
  if (!Number.isFinite(Date.parse(manifest.createdAt))) {
    throw new Error("Recovery-set manifest has an invalid creation time.");
  }
  if (!manifest.components || typeof manifest.components !== "object" || !Array.isArray(manifest.inventory)) {
    throw new Error("Recovery-set manifest is incomplete.");
  }
  return manifest;
}

function validateRecoverySetDirectory(restoredRoot, options = {}) {
  const root = path.resolve(restoredRoot);
  const manifest = parseRecoveryManifest(root);
  if (options.header?.setId && options.header.setId !== manifest.setId) {
    throw new Error("Recovery-set header and manifest identifiers do not match.");
  }
  if (options.header?.createdAt && options.header.createdAt !== manifest.createdAt) {
    throw new Error("Recovery-set header and manifest creation times do not match.");
  }
  if (
    options.header?.manifestSha256
    && options.header.manifestSha256 !== sha256File(path.join(root, RECOVERY_MANIFEST_PATH))
  ) {
    throw new Error("Recovery-set header and manifest hashes do not match.");
  }

  const expectedInventory = manifest.inventory;
  const seen = new Set();
  for (const item of expectedInventory) {
    if (!item || !isSafeRelativeArchivePath(item.path) || seen.has(item.path)) {
      throw new Error("Recovery-set manifest contains an invalid or duplicate file path.");
    }
    seen.add(item.path);
    if (!Number.isSafeInteger(item.bytes) || item.bytes < 0 || !/^[a-f0-9]{64}$/i.test(String(item.sha256 || ""))) {
      throw new Error(`Recovery-set manifest has invalid file metadata: ${item.path}`);
    }
    if (item.component !== recoveryComponentForPath(item.path)) {
      throw new Error(`Recovery-set manifest assigns a file to the wrong component: ${item.path}`);
    }
  }

  const actualInventory = inventoryDirectory(root);
  if (actualInventory.length !== expectedInventory.length) {
    throw new Error(
      `Recovery-set inventory does not match (expected ${expectedInventory.length} files, found ${actualInventory.length}).`,
    );
  }
  for (let index = 0; index < expectedInventory.length; index += 1) {
    const expected = expectedInventory[index];
    const actual = actualInventory[index];
    if (
      expected.path !== actual.path
      || expected.bytes !== actual.bytes
      || expected.sha256 !== actual.sha256
      || expected.component !== actual.component
    ) {
      throw new Error(`Recovery-set file verification failed: ${expected.path || actual.path}`);
    }
  }

  const componentNames = [
    "source",
    "database",
    "runtimeArtifacts",
    "approvalPacks",
    "privateOperatorReferences",
  ];
  const componentDefinitions = {
    source: { required: true, restorePath: "." },
    database: { required: true, restorePath: "data/runtime.sqlite" },
    runtimeArtifacts: { required: false, restorePath: "data/artifacts" },
    approvalPacks: { required: false, restorePath: "output/pdf" },
    privateOperatorReferences: { required: false, restorePath: "private" },
  };
  const unexpectedComponents = Object.keys(manifest.components)
    .filter((name) => !componentNames.includes(name));
  if (unexpectedComponents.length) {
    throw new Error(`Recovery-set manifest contains unexpected components: ${unexpectedComponents.join(", ")}`);
  }
  for (const componentName of componentNames) {
    const expected = manifest.components[componentName];
    if (!expected || typeof expected !== "object") {
      throw new Error(`Recovery-set manifest is missing component: ${componentName}`);
    }
    const definition = componentDefinitions[componentName];
    if (
      expected.required !== definition.required
      || expected.restorePath !== definition.restorePath
      || typeof expected.present !== "boolean"
      || (expected.required && !expected.present)
    ) {
      throw new Error(`Recovery-set manifest has invalid component policy: ${componentName}`);
    }
    const actual = summarizeInventory(actualInventory, componentName);
    if (
      expected.fileCount !== actual.fileCount
      || expected.bytes !== actual.bytes
      || expected.inventorySha256 !== actual.inventorySha256
    ) {
      throw new Error(`Recovery-set component verification failed: ${componentName}`);
    }
  }
  if (manifest.components.database.fileCount !== 1) {
    throw new Error("Recovery set must contain exactly one runtime database snapshot.");
  }
  const databaseInventory = actualInventory.filter((item) => item.component === "database");
  if (databaseInventory[0]?.path !== "data/runtime.sqlite") {
    throw new Error("Recovery set does not contain the runtime database at its canonical restore path.");
  }
  for (const requiredDirectory of ["data/artifacts", "output/pdf", "private", RECOVERY_METADATA_DIR]) {
    const directoryPath = path.join(root, requiredDirectory);
    if (!fs.existsSync(directoryPath) || !fs.statSync(directoryPath).isDirectory()) {
      throw new Error(`Recovery set is missing its canonical directory: ${requiredDirectory}`);
    }
  }
  const sqlite = validateSqliteDatabase(path.join(root, "data", "runtime.sqlite"));
  return {
    format: manifest.format,
    version: manifest.version,
    setId: manifest.setId,
    createdAt: manifest.createdAt,
    fileCount: actualInventory.length,
    bytes: actualInventory.reduce((sum, item) => sum + item.bytes, 0),
    components: manifest.components,
    sqlite,
    manifest,
  };
}

function listArchiveEntries(archivePath) {
  return runTar(["-tf", archivePath])
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function validateArchiveEntryTypes(archivePath) {
  const lines = runTar(["-tvf", archivePath])
    .split(/\r?\n/)
    .map((line) => line.trimStart())
    .filter(Boolean);
  for (const line of lines) {
    const type = line[0];
    if (type !== "-" && type !== "d") {
      throw new Error("Archive contains a symbolic link, hard link, or unsupported filesystem entry.");
    }
  }
  return lines.length;
}

function validateArchiveEntries(archivePath, kind) {
  const entries = listArchiveEntries(archivePath);
  for (const entry of entries) {
    const normalized = entry.replace(/\\/g, "/").replace(/^\.\//, "");
    if (!normalized) continue;
    const parts = normalized.split("/").filter(Boolean);
    if (path.posix.isAbsolute(normalized) || /^[a-zA-Z]:/.test(normalized) || parts.includes("..")) {
      throw new Error(`Archive contains an unsafe path: ${entry}`);
    }
    if (kind === "artifacts" && /(?:^|\/)[^/]+\.sqlite(?:-wal|-shm)?$/i.test(normalized)) {
      throw new Error(`Artifact backup unexpectedly contains a database file: ${entry}`);
    }
  }
  validateArchiveEntryTypes(archivePath);
  return entries;
}

function extractArchive(archivePath, destinationRoot) {
  validateArchiveEntries(archivePath, "source");
  fs.mkdirSync(destinationRoot, { recursive: true });
  runTar(["-xf", archivePath, "-C", destinationRoot]);
  return destinationRoot;
}

function timestampForFile(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, "-");
}

async function createBackup(options = {}) {
  const kind = options.kind || "source";
  const sourceRoot = path.resolve(options.sourceRoot || CONFIG.rootDir);
  const destinationRoot = path.resolve(options.destinationRoot || CONFIG.backupDestination);
  const dbPath = path.resolve(options.dbPath || CONFIG.dbPath);
  const artifactRoot = path.resolve(options.artifactRoot || defaultArtifactRoot(sourceRoot));
  const workRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pantheon-backup-"));
  const stampDate = options.createdAt ? new Date(options.createdAt) : new Date();
  if (!Number.isFinite(stampDate.getTime())) throw new Error("Backup creation time is invalid.");
  const stamp = timestampForFile(stampDate);
  const rawPath = path.join(workRoot, kind === "database" ? "runtime.sqlite" : `${kind}.tar`);
  const encryptedPath = path.join(
    destinationRoot,
    kind === "set"
      ? `pantheon-recovery-set-${stamp}.jbackup`
      : `pantheon-${kind}-${stamp}.jbackup`,
  );
  let recoverySet;
  try {
    if (kind === "database") {
      await createDatabaseSnapshot(dbPath, rawPath);
    } else if (kind === "source") {
      createSourceArchive(sourceRoot, rawPath, {
        artifactRoot,
        dbPath,
        backupDestination: destinationRoot,
      });
    } else if (kind === "artifacts") {
      createArtifactArchive(sourceRoot, rawPath, {
        artifactRoot,
        approvalPackRoot: options.approvalPackRoot,
      });
    } else if (kind === "set") {
      recoverySet = await createRecoverySetArchive(sourceRoot, rawPath, {
        setId: options.setId,
        createdAt: stampDate.toISOString(),
        dbPath,
        artifactRoot,
        approvalPackRoot: options.approvalPackRoot,
        privateOperatorRoot: options.privateOperatorRoot,
        backupDestination: destinationRoot,
      });
    } else {
      throw new Error(`Unsupported backup kind: ${kind}`);
    }
    const result = await encryptFile(rawPath, encryptedPath, {
      kind,
      passphrase: options.passphrase,
      createdAt: stampDate.toISOString(),
      setId: recoverySet?.manifest.setId,
      manifestSha256: recoverySet?.manifestSha256,
    });
    return {
      ...result,
      kind,
      sourceRoot,
      artifactRoot: ["artifacts", "set"].includes(kind) ? artifactRoot : undefined,
      ...(recoverySet
        ? {
          setId: recoverySet.manifest.setId,
          manifestSha256: recoverySet.manifestSha256,
          components: recoverySet.manifest.components,
        }
        : {}),
    };
  } finally {
    fs.rmSync(workRoot, { recursive: true, force: true });
  }
}

function pathsOverlap(left, right) {
  const a = path.resolve(left);
  const b = path.resolve(right);
  if (process.platform === "win32") {
    const lowerA = a.toLowerCase();
    const lowerB = b.toLowerCase();
    return lowerA === lowerB
      || lowerA.startsWith(`${lowerB}${path.sep}`)
      || lowerB.startsWith(`${lowerA}${path.sep}`);
  }
  return a === b || a.startsWith(`${b}${path.sep}`) || b.startsWith(`${a}${path.sep}`);
}

function assertRestoreDestinationIsInactive(kind, destinationPath) {
  const destination = path.resolve(destinationPath);
  if (kind === "database" && pathsOverlap(destination, CONFIG.dbPath)) {
    throw new Error("Restore refused: destination is the active runtime database. Restore to a separate location, verify it, stop Pantheon, then perform a controlled swap.");
  }
  if (kind === "source" && pathsOverlap(destination, CONFIG.rootDir)) {
    throw new Error("Restore refused: destination overlaps the active source workspace.");
  }
  if (kind === "set" && pathsOverlap(destination, CONFIG.rootDir)) {
    throw new Error("Restore refused: recovery-set destination overlaps the active Pantheon workspace.");
  }
  if (kind === "artifacts") {
    const activePackRoot = preferredEnvironment("APPROVAL_PACK_DIR") || path.join(CONFIG.rootDir, "output", "pdf");
    if (pathsOverlap(destination, CONFIG.artifactRoot) || pathsOverlap(destination, activePackRoot)) {
      throw new Error("Restore refused: destination overlaps active runtime artifacts.");
    }
  }
}

function commitStagedRestore(stagedPath, destinationPath, options = {}) {
  const destination = path.resolve(destinationPath);
  if (fs.existsSync(destination) && options.replace !== true) {
    throw new Error(`Restore destination already exists: ${destination}`);
  }
  const previousPath = `${destination}.previous-${process.pid}-${crypto.randomBytes(5).toString("hex")}`;
  let movedPrevious = false;
  let movedStaged = false;
  try {
    if (fs.existsSync(destination)) {
      fs.renameSync(destination, previousPath);
      movedPrevious = true;
    }
    fs.renameSync(stagedPath, destination);
    movedStaged = true;
    const verification = typeof options.verifyCommitted === "function"
      ? options.verifyCommitted(destination)
      : null;
    if (movedPrevious) fs.rmSync(previousPath, { recursive: true, force: true });
    return verification;
  } catch (error) {
    if (movedStaged && fs.existsSync(destination)) {
      fs.rmSync(destination, { recursive: true, force: true });
    }
    if (movedPrevious && fs.existsSync(previousPath)) {
      fs.renameSync(previousPath, destination);
    }
    throw error;
  }
}

async function restoreBackup(sourcePath, destinationPath, options = {}) {
  const workRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pantheon-restore-"));
  const rawPath = path.join(workRoot, "payload");
  let stagedPath = null;
  try {
    const resolvedSource = path.resolve(sourcePath);
    const resolvedDestination = path.resolve(destinationPath);
    if (pathsOverlap(resolvedSource, resolvedDestination)) {
      throw new Error("Restore refused: destination overlaps the encrypted backup file.");
    }
    const proof = await decryptFile(resolvedSource, rawPath, options);
    const kind = proof.kind;
    if (!["source", "artifacts", "database", "set"].includes(kind)) throw new Error(`Unsupported backup kind: ${kind}`);
    assertRestoreDestinationIsInactive(kind, resolvedDestination);

    const destination = resolvedDestination;
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    stagedPath = path.join(
      path.dirname(destination),
      `.${path.basename(destination)}.restore-${process.pid}-${crypto.randomBytes(6).toString("hex")}`,
    );
    if (kind === "database") {
      validateSqliteDatabase(rawPath);
      fs.copyFileSync(rawPath, stagedPath, fs.constants.COPYFILE_EXCL);
      normalizeStandaloneSqliteDatabase(stagedPath);
      const sqliteProof = commitStagedRestore(stagedPath, destination, {
        ...options,
        verifyCommitted: validateSqliteDatabase,
      });
      stagedPath = null;
      return { ...proof, destinationPath: destination, sqlite: sqliteProof };
    }

    validateArchiveEntries(rawPath, kind);
    fs.mkdirSync(stagedPath, { recursive: false });
    runTar(["-xf", rawPath, "-C", stagedPath]);
    if (kind === "set") {
      const verification = validateRecoverySetDirectory(stagedPath, { header: proof });
      const verificationRecord = {
        format: "pantheon-restore-verification",
        version: 1,
        verifiedAt: new Date().toISOString(),
        setId: verification.setId,
        createdAt: verification.createdAt,
        encryptedBackupSha256: sha256File(path.resolve(sourcePath)),
        payloadSha256: proof.payloadSha256,
        restoredFileCount: verification.fileCount,
        restoredBytes: verification.bytes,
        sqlite: verification.sqlite,
      };
      fs.writeFileSync(
        path.join(stagedPath, RECOVERY_VERIFICATION_PATH),
        `${JSON.stringify(verificationRecord, null, 2)}\n`,
        { encoding: "utf8", flag: "wx" },
      );
      const committedVerification = commitStagedRestore(stagedPath, destination, {
        ...options,
        verifyCommitted: (committedPath) => validateRecoverySetDirectory(committedPath, { header: proof }),
      });
      stagedPath = null;
      return {
        ...proof,
        destinationPath: destination,
        recoverySet: committedVerification,
        verificationRecord,
      };
    }
    commitStagedRestore(stagedPath, destination, options);
    stagedPath = null;
    return { ...proof, destinationPath: destination };
  } finally {
    if (stagedPath) fs.rmSync(stagedPath, { recursive: true, force: true });
    fs.rmSync(workRoot, { recursive: true, force: true });
  }
}

async function verifyBackup(sourcePath, options = {}) {
  const workRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pantheon-verify-"));
  const rawPath = path.join(workRoot, "payload");
  const extractedPath = path.join(workRoot, "extracted");
  try {
    const proof = await decryptFile(path.resolve(sourcePath), rawPath, options);
    if (proof.kind === "database") {
      return { ...proof, sqlite: validateSqliteDatabase(rawPath), verified: true };
    }
    if (proof.kind === "file") {
      return { ...proof, verified: true };
    }
    if (!["source", "artifacts", "set"].includes(proof.kind)) {
      throw new Error(`Unsupported backup kind: ${proof.kind}`);
    }
    const entries = validateArchiveEntries(rawPath, proof.kind);
    fs.mkdirSync(extractedPath, { recursive: false });
    runTar(["-xf", rawPath, "-C", extractedPath]);
    if (proof.kind === "set") {
      return {
        ...proof,
        verified: true,
        archiveEntries: entries.length,
        recoverySet: validateRecoverySetDirectory(extractedPath, { header: proof }),
      };
    }
    inventoryDirectory(extractedPath, { excludePrefixes: [] });
    return { ...proof, verified: true, archiveEntries: entries.length };
  } finally {
    fs.rmSync(workRoot, { recursive: true, force: true });
  }
}

function weekKey(date) {
  const value = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  value.setUTCDate(value.getUTCDate() + 4 - (value.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(value.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((value - yearStart) / 86400000) + 1) / 7);
  return `${value.getUTCFullYear()}-${String(week).padStart(2, "0")}`;
}

function keepSidecarExists(filePath) {
  return fs.existsSync(`${filePath}.keep`) || fs.existsSync(filePath.replace(/\.jbackup$/i, ".keep"));
}

function pruneBackups(destinationRoot = CONFIG.backupDestination, options = {}) {
  if (!fs.existsSync(destinationRoot)) return { kept: [], removed: [], pinned: [], invalid: [] };
  const dailyLimit = options.dailyLimit ?? 7;
  const weeklyLimit = options.weeklyLimit ?? 4;
  const candidates = fs.readdirSync(destinationRoot)
    .filter((name) => name.endsWith(".jbackup"))
    .map((name) => ({ filePath: path.join(destinationRoot, name), name }));
  const authenticated = [];
  const kept = [];
  const removed = [];
  const pinned = [];
  const invalid = [];

  for (const file of candidates) {
    if (keepSidecarExists(file.filePath)) {
      kept.push(file.filePath);
      pinned.push(file.filePath);
      continue;
    }
    try {
      const header = authenticateEncryptedBackup(file.filePath, { passphrase: options.passphrase });
      authenticated.push({ ...file, header, createdAt: new Date(header.createdAt) });
    } catch (error) {
      kept.push(file.filePath);
      invalid.push({ filePath: file.filePath, error: error.message });
    }
  }

  authenticated.sort((a, b) => b.createdAt - a.createdAt);
  const dailyKeys = new Map();
  const weeklyKeys = new Map();
  for (const file of authenticated) {
    const kind = file.header.kind;
    const day = file.createdAt.toISOString().slice(0, 10);
    const week = weekKey(file.createdAt);
    const kindDays = dailyKeys.get(kind) || new Set();
    const kindWeeks = weeklyKeys.get(kind) || new Set();
    dailyKeys.set(kind, kindDays);
    weeklyKeys.set(kind, kindWeeks);
    const keepDaily = !kindDays.has(day) && kindDays.size < dailyLimit;
    const keepWeekly = !kindWeeks.has(week) && kindWeeks.size < weeklyLimit;
    if (keepDaily || keepWeekly) {
      kindDays.add(day);
      kindWeeks.add(week);
      kept.push(file.filePath);
    } else {
      fs.rmSync(file.filePath, { force: true });
      removed.push(file.filePath);
    }
  }
  return { kept, removed, pinned, invalid };
}

module.exports = {
  authenticateEncryptedBackup,
  createBackup,
  createArtifactArchive,
  createDatabaseSnapshot,
  createRecoverySetArchive,
  createSourceArchive,
  decryptFile,
  encryptFile,
  extractArchive,
  inventoryDirectory,
  listArchiveEntries,
  parseRecoveryManifest,
  preferredEnvironment,
  pruneBackups,
  readEncryptedHeader,
  requiredPassphrase,
  restoreBackup,
  sha256File,
  validateArchiveEntries,
  validateRecoverySetDirectory,
  validateSqliteDatabase,
  verifyBackup,
};
